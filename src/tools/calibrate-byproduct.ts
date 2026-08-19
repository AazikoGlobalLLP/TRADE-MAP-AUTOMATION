import * as fs from 'fs';
import * as path from 'path';
import { Page } from 'playwright';
import { launchSession, isLoginPage, promptManualLogin } from '../auth/session';
import { loadConfig } from '../config/loadConfig';
import {
  buildCanonicalUrl,
  readShownRange,
  readHeadingCandidates,
  UrlFilters,
} from '../trademap/driver';
import { parseRange } from '../trademap/rangeEngine';

// ---------------------------------------------------------------------------
// byProduct Calibration Probe (Phase 9B, DEV-ONLY, READ-ONLY).
//
// I (the automation author) cannot see your browser, so this is my eyes for the
// ONE headed byProduct calibration run. Unlike calibrate-probe.ts (which lets you
// hand-navigate a byPartner page), this probe navigates to the EXACT byProduct URL
// that `buildCanonicalUrl` produces for the real export — so it TESTS the actual
// export path — then dumps the three things Phase 9 needs to pin, and NOTHING else:
//
//   Q1  Does Trade Map keep our explicit YYYYMM-YYYYMM range in byProduct, or
//       clamp it to `default`?  → the finalUrl after navigation + the served range.
//   Q2  Do readShownRange()/readHeadingCandidates() read the byProduct DATA TABLE?
//       → we call the REAL functions and also dump the raw month-column tokens +
//         control-panel structure (so if the byPartner selectors are wrong for
//         byProduct I can calibrate OFFLINE from one run, without a second one).
//   Q3  What are the real optionsReader CDK-overlay selectors for Data source /
//       Data type / Currency / Detail?  → open each control, read the NEWEST CDK
//       pane after its options actually render, dump it, Escape, wait for close.
//
// STRICTLY READ-ONLY: it NEVER clicks Save, NEVER downloads, and only opens/closes
// menus with Escape (never commits a selection). Range + heading are read BEFORE any
// overlay is touched, and the primary evidence (Q1/Q2 + full HTML + screenshot) is
// WRITTEN TO DISK before the fragile Q3 overlay loop runs — so nothing that happens
// during Q3 can erase the answers we already have.
//
// SECURITY (CLAUDE.md danger zone): dumps only DOM/HTML/screenshot to logs/calibration/
// — NEVER cookies, storage, or tokens. logs/ is git-ignored.
//
// RUN COMPILED (CLAUDE.md `__name` gotcha): the npm script does `tsc && node
// dist/tools/calibrate-byproduct.js`, because this uses page.evaluate/waitForFunction.
// It PAUSES on a readline ENTER at the login page, so it is the USER's to run, never
// a tool shell (a tool shell has no stdin and would hang the headed browser).
// ---------------------------------------------------------------------------

type Logger = (level: 'info' | 'warn' | 'error', event: string, data?: Record<string, unknown>) => void;

interface OverlayCapture {
  control: string;
  label: string;
  triggerFound: boolean;
  strategy: number; // which trigger-location strategy worked (-1 = none)
  options: string[];
  overlayHtml: string | null;
}

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined;
}

/** Wait (on real state, never a blind sleep) for every CDK overlay's option rows to be gone. */
async function waitForOverlayClosed(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () =>
        document.querySelectorAll(
          '.cdk-overlay-pane mat-option, .cdk-overlay-pane [role="option"], .cdk-overlay-pane .mat-mdc-option',
        ).length === 0,
      { timeout: 2000 },
    )
    .catch(() => undefined);
}

/**
 * Open ONE advanced control, wait for its CDK pane to actually render, dump the
 * NEWEST pane's option list + HTML, then Escape and wait for it to close. Reading
 * the NEWEST pane (`.cdk-overlay-pane.last()`) — not the whole shared container —
 * structurally prevents a still-closing previous control's options bleeding into
 * this one. Best-effort + non-destructive: it tries form-field-scoped location
 * first (the visible field label lives in a sibling <mat-label>, NOT inside the
 * mat-select), then a broad text match; any miss returns triggerFound:false rather
 * than throwing, and always tries to dismiss whatever it opened.
 */
async function captureOverlay(page: Page, control: { key: string; label: string }, log: Logger): Promise<OverlayCapture> {
  // Strategy 0: the mat-form-field whose label text is `control.label` → its select/trigger inside.
  // Strategy 1: a broad control element that itself contains the label text (some layouts inline it).
  const strategies: Array<() => import('playwright').Locator> = [
    () =>
      page
        .locator('mat-form-field, .mat-mdc-form-field, .mat-form-field', { hasText: control.label })
        .locator('mat-select, .mat-mdc-select-trigger, [role="combobox"], button')
        .first(),
    () =>
      page
        .locator('button, [role="button"], mat-select, .mat-mdc-select-trigger, [role="combobox"]', {
          hasText: control.label,
        })
        .first(),
  ];

  for (let i = 0; i < strategies.length; i++) {
    try {
      const trigger = strategies[i]();
      if (!(await trigger.isVisible({ timeout: 1500 }).catch(() => false))) continue;
      await trigger.click().catch(() => undefined);

      // Wait for the NEWEST pane's options to actually render before reading (real state).
      const pane = page.locator('.cdk-overlay-pane').last();
      await pane
        .locator('mat-option, [role="option"], .mat-mdc-option')
        .first()
        .waitFor({ state: 'visible', timeout: 3000 })
        .catch(() => undefined);

      const optionNodes = pane.locator('mat-option, [role="option"], .mat-mdc-option, li, button');
      const rawTexts = await optionNodes.allInnerTexts().catch(() => [] as string[]);
      const overlayHtml = await pane.innerHTML().catch(() => null);

      await page.keyboard.press('Escape').catch(() => undefined);
      await waitForOverlayClosed(page);

      const options = rawTexts.map((t) => t.trim()).filter((t) => t.length > 0);
      if (options.length === 0 && !overlayHtml) {
        log('warn', 'overlay.empty', { control: control.key, strategy: i });
        continue; // opened nothing useful — try the next strategy
      }
      log('info', 'overlay.captured', { control: control.key, strategy: i, count: options.length });
      return {
        control: control.key,
        label: control.label,
        triggerFound: true,
        strategy: i,
        options,
        // Cap the HTML so the JSON stays readable; the full page HTML is saved separately.
        overlayHtml: overlayHtml ? overlayHtml.slice(0, 20000) : null,
      };
    } catch (e) {
      log('warn', 'overlay.error', { control: control.key, strategy: i, message: e instanceof Error ? e.message : String(e) });
      await page.keyboard.press('Escape').catch(() => undefined);
      await waitForOverlayClosed(page);
    }
  }

  log('warn', 'overlay.trigger_not_found', { control: control.key, label: control.label });
  return { control: control.key, label: control.label, triggerFound: false, strategy: -1, options: [], overlayHtml: null };
}

async function main(): Promise<void> {
  // All overridable; defaults reproduce the user's REAL captured India byProduct/NTL URL
  // (imports · direct · values · USD · monthly · c/699 · c/000 · p/ALL), except the RANGE,
  // which is the config MAX (200001-202606) on purpose — to see whether the site honours an
  // explicit non-availability window or rewrites it. NTL→token 10 (never invented; captured).
  const code = getArg('code') ?? '699';
  const country = getArg('country') ?? 'India'; // for the heading check only; matches --code default
  const detail = getArg('detail') ?? 'NTL';
  const flow = getArg('flow') ?? 'imports';
  const freq = getArg('freq') ?? 'monthly';
  const source = getArg('source') ?? 'direct';
  const dataType = getArg('dataType') ?? 'values';
  const currency = getArg('currency') ?? 'USD';
  const label = (getArg('label') ?? `byproduct-${code}-${detail}`).replace(/[^a-z0-9_-]/gi, '_');
  const configPath = getArg('config') ?? path.resolve('config/config.json');
  const config = loadConfig(configPath);

  const start = config.datePolicy.requestedStart;
  const end = config.datePolicy.requestedEnd;

  const filters: UrlFilters = {
    tradeFlow: flow,
    exporterCode: '000', // World partner — left default (spec row 6)
    product: 'ALL',
    viewBy: 'product', // byProduct — the whole point of this probe
    frequency: freq,
    source,
    dataType,
    currency,
    view: 'table',
    detail, // NTL → resolveDetailUrlToken('NTL') = '10' (captured, not invented)
  };
  // Built by the SAME function the export uses — so a passing probe proves the export URL.
  const url = buildCanonicalUrl(config.tradeMapBaseUrl, code, filters, start, end);

  const outDir = path.join(path.resolve(config.logsDir), 'calibration');
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `${label}.json`);
  const htmlPath = path.join(outDir, `${label}.html`);
  const pngPath = path.join(outDir, `${label}.png`);

  const structuredLog: Array<{ level: string; event: string; data: Record<string, unknown> | null }> = [];
  const log: Logger = (level, event, data) => {
    structuredLog.push({ level, event, data: data ?? null });
    process.stdout.write(`[${level}] ${event} ${data ? JSON.stringify(data) : ''}\n`);
  };

  process.stdout.write('\n=============================================\n');
  process.stdout.write('byProduct calibration probe (READ-ONLY — no Save, no download)\n');
  process.stdout.write(`Target URL (built by buildCanonicalUrl — the real export path):\n  ${url}\n`);
  process.stdout.write('=============================================\n');

  const { context, page } = await launchSession(config.browserProfileDir, config.tradeMapBaseUrl);
  try {
    // Navigate to the built URL; pause on the login page and re-navigate after login.
    let attempts = 0;
    for (;;) {
      await page
        .goto(url, { waitUntil: 'domcontentloaded' })
        .catch((e: unknown) => log('warn', 'goto.error', { message: e instanceof Error ? e.message : String(e) }));
      if (!(await isLoginPage(page).catch(() => false))) break;
      attempts += 1;
      if (attempts > 5) throw new Error('Still on the Trade Map login page after 5 attempts.');
      await promptManualLogin(
        '\n[ACTION] Login page dikh raha hai — browser me PRO account se log in kariye ' +
          '(Monthly PRO-locked hai), phir yahan ENTER dabaiye. Main dobara byProduct URL par jaunga...\n> ',
      );
    }

    // Wait on REAL state (never a blind sleep, convention #1): let the network settle, then
    // wait for SOME table indicator to appear. Both are best-effort — if neither fires we still
    // capture the raw DOM so a wrong assumption is visible in the dump rather than a silent hang.
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => undefined);
    await page
      .locator('.mat-mdc-header-cell, mat-table, table')
      .first()
      .waitFor({ state: 'visible', timeout: 30000 })
      .catch(() => log('warn', 'table.not_visible', { note: 'no obvious table selector visible within 30s' }));

    // --- Q1 + Q2: read range/heading with the REAL functions BEFORE touching any menu ---
    const finalUrl = page.url();
    const shownRange = await readShownRange(page).catch((e: unknown) => {
      log('warn', 'readShownRange.threw', { message: e instanceof Error ? e.message : String(e) });
      return null;
    });
    const heading = await readHeadingCandidates(page).catch(() => '');

    const urlRange = parseRange(finalUrl); // what range the site kept in the URL after loading
    const rangeKeptExplicit = !!urlRange && urlRange.start === start && urlRange.end === end;

    // Persist the deep-read artifacts NOW (menus still closed = clean control-panel structure),
    // so any later throw in the dump/overlay phase can never erase them.
    const pageHtml = await page.content().catch(() => '');
    if (pageHtml) fs.writeFileSync(htmlPath, pageHtml, 'utf8');
    await page.screenshot({ path: pngPath, fullPage: true }).catch(() => undefined);

    // Raw structural dump (compiled → page.evaluate is safe). GUARDED like every other read:
    // if it throws (e.g. a client-side URL rewrite — exactly Q1's hypothesis — destroys the
    // context), we keep null and still persist Q1/Q2. Bounded selectors so an NTL table with
    // thousands of body cells can't blow up or saturate the month-token read (headers only).
    const dump = await page
      .evaluate(() => {
        const clean = (s: string | null | undefined): string => (s ? s.replace(/\s+/g, ' ').trim() : '');
        const cls = (el: Element): string => (typeof el.className === 'string' ? el.className : '');
        const months = (els: Element[]): string[] => {
          const set = new Set<string>();
          for (const el of els) {
            const re = /mat-column-(\d{6})/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(cls(el))) !== null) {
              const mm = Number(m[1].slice(4, 6));
              if (mm >= 1 && mm <= 12) set.add(m[1]);
            }
          }
          return [...set].sort(); // YYYYMM zero-padded → lexical == chronological
        };

        const headerCellEls = Array.from(document.querySelectorAll('.mat-mdc-header-cell'));
        const colHeaderEls = Array.from(document.querySelectorAll('[role="columnheader"], thead th'));
        const anyMatColumn = Array.from(document.querySelectorAll('[class*="mat-column-"]')).slice(0, 50);

        // Control-panel candidates — the Q3 OFFLINE fallback: if the live overlay capture misses a
        // control, these outerHTMLs let me pin the trigger/label association without a second run.
        const controlCandidates = Array.from(
          document.querySelectorAll('mat-form-field, .mat-mdc-form-field, mat-select, .mat-mdc-select-trigger, [role="combobox"]'),
        )
          .slice(0, 60)
          .map((el) => ({
            tag: el.tagName.toLowerCase(),
            cls: cls(el),
            aria: el.getAttribute('aria-label'),
            role: el.getAttribute('role'),
            text: clean(el.textContent).slice(0, 80),
            outerHtml: (el.outerHTML || '').slice(0, 1500),
          }));

        return {
          url: location.href,
          title: document.title,
          headings: Array.from(document.querySelectorAll('h1, h2, h3'))
            .map((h) => clean(h.textContent))
            .filter(Boolean)
            .slice(0, 40),
          headerCellCount: headerCellEls.length,
          headerCellSample: headerCellEls.slice(0, 60).map((el) => ({ cls: cls(el), text: clean(el.textContent).slice(0, 40) })),
          colHeaderSample: colHeaderEls.slice(0, 60).map((el) => ({ tag: el.tagName.toLowerCase(), cls: cls(el), text: clean(el.textContent).slice(0, 40) })),
          // The true served month span, read three independent ways (distinct tokens, never saturates):
          monthTokensFromHeaderCells: months(headerCellEls),
          monthTokensFromColHeaders: months(colHeaderEls),
          monthTokensFromAnySample: months(anyMatColumn),
          anyMatColumnSample: anyMatColumn.map((el) => ({ tag: el.tagName.toLowerCase(), cls: cls(el) })),
          rowCount: document.querySelectorAll('.mat-mdc-row, mat-row, tbody tr').length,
          controlCandidates,
        };
      })
      .catch((e: unknown) => {
        log('warn', 'dump.threw', { message: e instanceof Error ? e.message : String(e) });
        return null;
      });

    // The true served range from the raw month tokens — an independent cross-check of readShownRange.
    const rawMonths =
      (dump?.monthTokensFromHeaderCells.length ? dump.monthTokensFromHeaderCells : null) ??
      (dump?.monthTokensFromColHeaders.length ? dump.monthTokensFromColHeaders : null) ??
      (dump?.monthTokensFromAnySample.length ? dump.monthTokensFromAnySample : null);
    const rawServedRange = rawMonths ? { start: rawMonths[0], end: rawMonths[rawMonths.length - 1], count: rawMonths.length } : null;

    const headingNamesCountry = heading.toLowerCase().includes(country.toLowerCase());

    // Build the primary result and WRITE IT NOW — before the fragile Q3 overlay loop.
    const baseResult = {
      capturedAt: process.env.PROBE_TIMESTAMP ?? '(set PROBE_TIMESTAMP to stamp; unset = live run)',
      inputs: { code, country, detail, flow, freq, source, dataType, currency, requestedStart: start, requestedEnd: end },
      targetUrl: url,
      finalUrl,
      // Q1 answer, at a glance:
      q1_rangeKeptExplicitInUrl: rangeKeptExplicit,
      q1_urlRangeAfterLoad: urlRange,
      // Q2 answer, at a glance:
      q2_readShownRange: shownRange,
      q2_rawServedRangeFromTokens: rawServedRange,
      q2_heading: heading,
      q2_headingNamesCountry: headingNamesCountry,
      // raw structure to calibrate against if the real functions came back empty:
      dump,
      // Q3 — filled in below; persisted empty first so a Q3-phase failure can't lose Q1/Q2:
      overlays: [] as OverlayCapture[],
      structuredLog,
    };
    fs.writeFileSync(jsonPath, JSON.stringify(baseResult, null, 2), 'utf8');
    log('info', 'persist.primary', { jsonPath });

    // --- Q3: advanced-option overlays. Try to expand an Advanced panel first (best-effort). ---
    const advanced = page.locator('button, [role="button"], a', { hasText: /advanced/i }).first();
    if (await advanced.isVisible({ timeout: 1500 }).catch(() => false)) {
      await advanced.click().catch(() => undefined);
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
      log('info', 'advanced.clicked', {});
    }

    const controls = [
      { key: 'dataSource', label: 'Data source' },
      { key: 'dataType', label: 'Data type' },
      { key: 'currency', label: 'Currency' },
      { key: 'detail', label: 'Detail' },
    ];
    const overlays: OverlayCapture[] = [];
    for (const c of controls) {
      overlays.push(await captureOverlay(page, c, log));
    }

    // Re-write the JSON with the overlays now included (primary evidence was already safe above).
    fs.writeFileSync(jsonPath, JSON.stringify({ ...baseResult, overlays, structuredLog }, null, 2), 'utf8');

    // Human-readable summary — the headline answers, then where the full evidence is.
    process.stdout.write('\n---------------------------------------------\n');
    process.stdout.write(`Captured "${label}"\n`);
    process.stdout.write(`  Target URL : ${url}\n`);
    process.stdout.write(`  Final URL  : ${finalUrl}\n`);
    process.stdout.write(
      `  Q1 range   : ${rangeKeptExplicit ? 'KEPT our explicit ' + start + '-' + end : 'REWRITTEN → ' + (urlRange ? urlRange.start + '-' + urlRange.end : '(no YYYYMM-YYYYMM in URL)')}\n`,
    );
    process.stdout.write(
      `  Q2 readFn  : readShownRange → ${shownRange ? shownRange.start + '-' + shownRange.end : 'NULL (byPartner selector missed the byProduct table — see dump)'}\n`,
    );
    process.stdout.write(
      `  Q2 tokens  : rawServedRange → ${rawServedRange ? rawServedRange.start + '-' + rawServedRange.end + ' (' + rawServedRange.count + ' months)' : 'NONE (no mat-column-YYYYMM in headers — see dump.anyMatColumnSample)'}\n`,
    );
    process.stdout.write(
      `  Q2 heading : "${(heading || '(none)').slice(0, 90)}"${headingNamesCountry ? '  ✓ names ' + country : '  ✗ does NOT name ' + country}\n`,
    );
    process.stdout.write(
      `  Q2 table   : ${dump ? dump.headerCellCount + ' header cells · ' + dump.rowCount + ' rows · ' + dump.controlCandidates.length + ' control candidates' : 'DUMP FAILED (see dump.threw in log)'}\n`,
    );
    for (const o of overlays) {
      process.stdout.write(
        `  Q3 ${o.label.padEnd(12)}: ${o.triggerFound ? o.options.length + ' options ' + JSON.stringify(o.options.slice(0, 8)) : 'trigger NOT found (calibrate from dump.controlCandidates)'}\n`,
      );
    }
    process.stdout.write(`  Saved:\n    ${jsonPath}\n    ${htmlPath}\n    ${pngPath}\n`);
    process.stdout.write('---------------------------------------------\n');
    process.stdout.write('Ab mujhe batayein: "byproduct done". Main JSON padh kar selectors calibrate karunga.\n');
  } finally {
    await context.close();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`calibrate-byproduct failed: ${message}\n`);
  process.exitCode = 1;
});
