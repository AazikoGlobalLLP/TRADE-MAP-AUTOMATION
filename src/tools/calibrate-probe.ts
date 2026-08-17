import * as fs from 'fs';
import * as path from 'path';
import { launchSession, isLoginPage, promptManualLogin } from '../auth/session';
import { loadConfig } from '../config/loadConfig';

// ---------------------------------------------------------------------------
// Calibration Probe (Phase 3B, DEV-ONLY, READ-ONLY).
//
// I (the automation author) cannot see your browser, so this tool is my eyes: it
// opens the SAME logged-in profile, lets you navigate to a country's imports page
// by hand, then DUMPS the live DOM structure (headings, filter <select>s, radio
// groups, Save/export buttons, the full page HTML, and a screenshot) to
// logs/calibration/<label>.*. Those files are then read to write exact selectors
// for readCurrentFilters() / readRangeFromDom() and to record the real country code.
//
// SECURITY: dumps only DOM/HTML/screenshot — NEVER cookies, storage, or tokens
// (CLAUDE.md danger zone). logs/ is git-ignored. Nothing here is typed or saved
// as a credential.
// ---------------------------------------------------------------------------

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined;
}

async function main(): Promise<void> {
  const label = (getArg('label') ?? 'probe').replace(/[^a-z0-9_-]/gi, '_');
  const configPath = getArg('config') ?? path.resolve('config/config.json');
  const config = loadConfig(configPath);

  const outDir = path.join(path.resolve(config.logsDir), 'calibration');
  fs.mkdirSync(outDir, { recursive: true });

  const { context, page } = await launchSession(config.browserProfileDir, config.tradeMapBaseUrl);
  try {
    // Pause on the login page until the user has logged in (never guess "am I in?").
    let attempts = 0;
    while (await isLoginPage(page)) {
      attempts += 1;
      if (attempts > 5) throw new Error('Still on the Trade Map login page after 5 attempts.');
      await promptManualLogin();
    }

    // Hand control to the user to navigate to the country's imports page by hand.
    await promptManualLogin(
      `\n[ACTION] Browser window me "${label.toUpperCase()}" ka IMPORTS page kholiye:\n` +
        `   • country search me country type karke Imports par jaiye,\n` +
        `   • filters set kariye: Monthly · Mirror · by Exporter · All products · USD,\n` +
        `   • jab data TABLE screen par dikhe, tab yahan wapas aakar ENTER dabaiye...\n` +
        `   (Usi tab me navigate kariye — naya tab kholenge to bhi last tab hi capture hoga.)\n> `,
    );

    // Capture the most recently active tab (in case a new tab was opened).
    const pages = context.pages();
    const target = pages[pages.length - 1] ?? page;

    // Structured DOM readout — everything needed to pin selectors, and nothing sensitive.
    const dump = await target.evaluate(() => {
      const clean = (s: string | null | undefined): string => (s ? s.replace(/\s+/g, ' ').trim() : '');

      const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
        .map((h) => clean(h.textContent))
        .filter(Boolean)
        .slice(0, 40);

      const selects = Array.from(document.querySelectorAll('select')).map((el) => {
        const s = el as HTMLSelectElement;
        return {
          id: s.id || null,
          name: s.name || null,
          ariaLabel: s.getAttribute('aria-label'),
          className: typeof s.className === 'string' ? s.className : null,
          selected: s.options[s.selectedIndex] ? clean(s.options[s.selectedIndex].text) : null,
          options: Array.from(s.options).slice(0, 80).map((o) => clean(o.text)),
        };
      });

      const inputs = Array.from(document.querySelectorAll('input[type="radio"], input[type="checkbox"]')).map((el) => {
        const i = el as HTMLInputElement;
        return {
          type: i.type,
          id: i.id || null,
          name: i.name || null,
          value: i.value || null,
          checked: i.checked,
          ariaLabel: i.getAttribute('aria-label'),
        };
      });

      const clickables = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="submit"]'))
        .map((el) => {
          const b = el as HTMLElement;
          return {
            tag: b.tagName.toLowerCase(),
            text: clean(b.textContent || (b as HTMLInputElement).value || ''),
            title: b.getAttribute('title'),
            ariaLabel: b.getAttribute('aria-label'),
            id: b.id || null,
            className: typeof b.className === 'string' ? b.className : null,
          };
        })
        .filter((b) => /save|export|xlsx|excel|download/i.test([b.text, b.title, b.ariaLabel, b.id, b.className].join(' ')))
        .slice(0, 40);

      return { url: location.href, title: document.title, headings, selects, inputs, clickables };
    });

    // Persist: structured JSON (for selectors), full HTML (for deep reading), screenshot (for layout).
    const jsonPath = path.join(outDir, `${label}.json`);
    const htmlPath = path.join(outDir, `${label}.html`);
    const pngPath = path.join(outDir, `${label}.png`);
    fs.writeFileSync(jsonPath, JSON.stringify(dump, null, 2), 'utf8');
    fs.writeFileSync(htmlPath, await target.content(), 'utf8');
    await target.screenshot({ path: pngPath, fullPage: true }).catch(() => undefined);

    const codeMatch = dump.url.match(/\/c\/(\d{2,4})(?:\/|$)/);
    process.stdout.write('\n---------------------------------------------\n');
    process.stdout.write(`Captured "${label}"\n`);
    process.stdout.write(`  URL:  ${dump.url}\n`);
    process.stdout.write(`  Code in URL: ${codeMatch ? codeMatch[1] : '(none found — check the URL)'}\n`);
    process.stdout.write(`  Heading[0]: ${dump.headings[0] ?? '(none)'}\n`);
    process.stdout.write(`  <select> controls: ${dump.selects.length} · radio/checkbox: ${dump.inputs.length}\n`);
    process.stdout.write(`  Saved:\n    ${jsonPath}\n    ${htmlPath}\n    ${pngPath}\n`);
    process.stdout.write('---------------------------------------------\n');
    process.stdout.write(`Ab mujhe batayein: "${label} done". Main files padh kar aage calibrate karunga.\n`);
  } finally {
    await context.close();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`calibrate-probe failed: ${message}\n`);
  process.exitCode = 1;
});
