import * as fs from 'fs';
import * as path from 'path';
import { Page, Locator } from 'playwright';
import { launchSession, isLoginPage, promptManualLogin } from '../auth/session';
import { buildCanonicalUrl, readHeadingCandidates } from '../trademap/driver';
import { readCountries } from '../input/readCountries';
import { loadConfig } from '../config/loadConfig';

// ---------------------------------------------------------------------------
// Country-code harvester (DEV tool). Turns the country-name list into confirmed
// Trade Map (UN-Comtrade) numeric codes, written to config/country-codes.json.
//
// It NEVER invents a code: for each country it uses Trade Map's own top search box
// (calibrated 2026-08-17 from logs/calibration/country-list.*: an input with
// placeholder "Type (min 2 characters)...", results as <mat-option>), selects the
// matching option, then reads the code straight from the resulting URL (…/c/<code>/…)
// and CONFIRMS it against the live page heading ("<Country>'s imports from World…").
// A country that doesn't confirm is reported as UNRESOLVED — never guessed.
//
// Resume-safe + incremental: codes already in country-codes.json are skipped, and
// the file is rewritten atomically after EVERY new confirmation, so a kill mid-run
// loses nothing and a rerun continues where it left off (same idea as the manifest).
//
// Uses NO page.evaluate, so it runs fine compiled (`npm run harvest`). Read-only to
// the browser session; never logs cookies/tokens (CLAUDE.md).
// ---------------------------------------------------------------------------

function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

/** Normalise for name↔option matching: NFC, collapse spaces, strip case. */
function norm(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

interface CodeMap {
  [key: string]: string;
}

/** Atomic write (temp → rename) so a kill never leaves a half-written JSON. */
function writeCodes(file: string, map: CodeMap): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(map, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

/** Escape a string for safe literal use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Return the Importer search box, first ensuring (a) we are on a Trade Map DATA page that
 * renders the picker, and (b) the Importer picker is OPENED so its `<input>` exists.
 *
 * Two facts learned live (2026-08-17):
 *   - The bare homepage has NO country picker — it lives only on a time-series data page,
 *     so if the picker is absent we navigate to `seedUrl` (a canonical imports page built
 *     from an ALREADY-KNOWN code) and look again.
 *   - The Importer picker is COLLAPSED by default (shows only the "Importer" label + the
 *     current value); the search `<input placeholder="Type (min...">` renders only AFTER
 *     the picker is clicked open. So we click the Importer picker to reveal the input.
 */
async function ensurePickerVisible(page: Page, seedUrl: string, timeoutMs: number): Promise<Locator | null> {
  const inputSel = 'input[placeholder^="Type (min"]';

  // Open the Importer picker (if needed) and return its now-visible search input.
  const tryOpen = async (waitMs: number): Promise<Locator | null> => {
    const box = page.locator(inputSel).first();
    if (await box.isVisible({ timeout: 800 }).catch(() => false)) return box; // already open

    // Scope to the IMPORTER picker: both Importer/Exporter are <app-country-picker>, but
    // only the importer's text contains "Importer" ("Exporter" does not include it).
    const importer = page.locator('app-country-picker', { hasText: 'Importer' }).first();
    if (!(await importer.isVisible({ timeout: waitMs }).catch(() => false))) return null;

    const trigger = importer.locator('.form-container').first();
    const clickTarget = (await trigger.isVisible({ timeout: 1000 }).catch(() => false)) ? trigger : importer;
    for (let i = 0; i < 2; i++) {
      await clickTarget.click().catch(() => undefined);
      if (await box.isVisible({ timeout: 2000 }).catch(() => false)) return box;
    }
    return null;
  };

  const box = await tryOpen(2000);
  if (box) return box;

  await page.goto(seedUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  return tryOpen(Math.max(6000, Math.floor(timeoutMs / 2)));
}

/**
 * Harvest one country's code via the Importer search box. Returns the confirmed numeric
 * code, or null (with a reason logged) if it can't be confirmed — never a guess.
 *
 * The picker is a custom <app-country-picker> that renders its results into an Angular
 * CDK OVERLAY (`.cdk-overlay-container`) — NOT <mat-option> (confirmed from the live
 * capture). So we match the result by its visible text inside that overlay, which is
 * element-agnostic. If nothing matches, we dump the OPEN overlay's HTML to `dumpDir`
 * so the real option markup can be read, and report the country UNRESOLVED.
 */
async function harvestOne(
  page: Page,
  seedUrl: string,
  name: string,
  timeoutMs: number,
  dumpDir: string,
): Promise<string | null> {
  const box = await ensurePickerVisible(page, seedUrl, timeoutMs);
  if (!box) {
    process.stdout.write(`  ✗ ${name}: search box not found\n`);
    return null;
  }

  const urlBefore = page.url();
  await box.click();
  await box.fill('');
  await box.type(name, { delay: 40 });

  // Results render into the CDK overlay. Match the option by its visible text
  // (exact-normalised first, then prefix) rather than by a guessed element tag.
  const overlay = page.locator('.cdk-overlay-container');
  const escaped = escapeRegExp(norm(name));
  const exactRx = new RegExp(`^\\s*${escaped}\\s*$`, 'i');
  const prefixRx = new RegExp(`^\\s*${escaped}`, 'i');

  let target = overlay.getByText(exactRx).first();
  let ok = await target.waitFor({ state: 'visible', timeout: timeoutMs }).then(() => true).catch(() => false);
  if (!ok) {
    target = overlay.getByText(prefixRx).first();
    ok = await target.isVisible({ timeout: 1500 }).catch(() => false);
  }
  if (!ok) {
    const seen = (await overlay.innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 160);
    let dumpNote = ' (overlay empty — no results rendered)';
    try {
      const html = await overlay.innerHTML();
      if (html.trim()) {
        const dumpPath = path.join(dumpDir, `picker-open-${name.replace(/[^a-z0-9]+/gi, '_')}.html`);
        fs.writeFileSync(dumpPath, html, 'utf8');
        dumpNote = ` Dumped open overlay → ${dumpPath}`;
      }
    } catch {
      /* leave the default note */
    }
    process.stdout.write(`  ✗ ${name}: no matching option. Overlay text: "${seen}".${dumpNote}\n`);
    return null;
  }

  await target.click();
  // Selecting a country navigates to its page; wait for the importer code to appear/change.
  await page
    .waitForFunction(
      (prev) => location.href !== prev && /\/c\/\d{2,4}\//.test(location.href),
      urlBefore,
      { timeout: timeoutMs },
    )
    .catch(() => undefined);
  await page.waitForLoadState('networkidle').catch(() => undefined);

  const m = page.url().match(/\/c\/(\d{2,4})(?:\/|$)/); // first /c/ = importer
  if (!m) {
    process.stdout.write(`  ✗ ${name}: no code in URL after select (${page.url().slice(0, 80)}…)\n`);
    return null;
  }
  const code = m[1];

  // Confirm the code is really this country: the heading must name it.
  const heading = await readHeadingCandidates(page);
  if (!norm(heading).includes(norm(name))) {
    process.stdout.write(`  ✗ ${name}: code ${code} but heading didn't confirm ("${heading.slice(0, 80)}…")\n`);
    return null;
  }
  process.stdout.write(`  ✓ ${name} = ${code}\n`);
  return code;
}

async function main(): Promise<void> {
  const configPath = getArg('config') ?? path.resolve('config/config.json');
  const config = loadConfig(configPath);
  const listPath = path.resolve(getArg('countries') ?? 'input/countries-full.xlsx');
  const codesPath = path.resolve(config.countryCodesFile);
  const limit = Number(getArg('limit') ?? '0'); // 0 = all
  const perCountryTimeout = Number(getArg('timeout') ?? '15000');

  const countries = await readCountries(listPath);
  const map: CodeMap = fs.existsSync(codesPath) ? JSON.parse(fs.readFileSync(codesPath, 'utf8')) : {};
  const known = new Set(Object.keys(map).filter((k) => !k.startsWith('_')).map((k) => norm(k)));

  const todo = countries.filter((c) => !known.has(norm(c)));
  const target = limit > 0 ? todo.slice(0, limit) : todo;
  process.stdout.write(
    `Harvest: ${countries.length} in list · ${known.size} already known · ${todo.length} to do` +
      (limit > 0 ? ` · this run: ${target.length} (--limit ${limit})` : '') +
      `\n`,
  );

  // The Importer picker only exists on a DATA page; seed it from an ALREADY-KNOWN code
  // (never invented). Requires at least one known real country in country-codes.json.
  const seedEntry = Object.entries(map).find(
    ([k, v]) => !k.startsWith('_') && norm(k) !== 'world' && /^\d{2,4}$/.test(String(v)),
  );
  if (!seedEntry) {
    throw new Error(
      `Harvest needs at least one already-known country code in ${codesPath} to open the ` +
        'search page (found none besides World). Confirm one code manually first, then rerun.',
    );
  }
  const [seedName, seedCode] = seedEntry;
  const seedUrl = buildCanonicalUrl(
    config.tradeMapBaseUrl,
    seedCode,
    config.filters,
    config.datePolicy.requestedStart,
    config.datePolicy.requestedEnd,
  );
  const dumpDir = path.join(path.resolve(config.logsDir), 'calibration');
  fs.mkdirSync(dumpDir, { recursive: true });
  process.stdout.write(`Search page seeded from known country: ${seedName} (${seedCode})\n`);

  const { context, page } = await launchSession(config.browserProfileDir, config.tradeMapBaseUrl);
  const confirmed: string[] = [];
  const unresolved: string[] = [];
  try {
    // Land on a DATA page (which has the Importer picker) before anything else; if the
    // session expired, this data page — not the marketing homepage — reliably trips the
    // login detector.
    await page.goto(seedUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);

    let attempts = 0;
    while (await isLoginPage(page)) {
      if (++attempts > 5) throw new Error('Still on the Trade Map login page after 5 attempts.');
      await promptManualLogin();
      await page.goto(seedUrl, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
      await page.waitForLoadState('networkidle').catch(() => undefined);
    }

    for (const name of target) {
      const code = await harvestOne(page, seedUrl, name, perCountryTimeout, dumpDir).catch((e) => {
        process.stdout.write(`  ✗ ${name}: ${(e as Error).message}\n`);
        return null;
      });
      if (code) {
        map[name] = code;
        writeCodes(codesPath, map); // incremental + atomic — resume-safe
        confirmed.push(name);
      } else {
        unresolved.push(name);
      }
    }
  } finally {
    await context.close();
  }

  process.stdout.write('\n---------------------------------------------\n');
  process.stdout.write(`Confirmed this run: ${confirmed.length}\n`);
  process.stdout.write(`Unresolved: ${unresolved.length}${unresolved.length ? ' → ' + unresolved.join(', ') : ''}\n`);
  process.stdout.write(`Codes file: ${codesPath} (now ${Object.keys(map).filter((k) => !k.startsWith('_')).length} countries)\n`);
  process.stdout.write('---------------------------------------------\n');
}

main().catch((err: unknown) => {
  process.stderr.write(`harvest-codes failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
