import * as fs from 'fs';
import * as path from 'path';
import { Page } from 'playwright';
import { launchSession, isLoginPage, promptManualLogin } from '../auth/session';
import { readHeadingCandidates } from '../trademap/driver';
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

/**
 * Harvest one country's code via the top search box. Returns the confirmed numeric
 * code, or null (with a reason logged) if it can't be confirmed — never a guess.
 */
async function harvestOne(page: Page, baseUrl: string, name: string, timeoutMs: number): Promise<string | null> {
  // The search box lives in the app shell; if it's gone (after a navigation) reload home.
  let box = page.locator('input[placeholder^="Type (min"]').first();
  if (!(await box.isVisible({ timeout: 2000 }).catch(() => false))) {
    await page.goto(baseUrl.replace(/\/+$/, ''), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    box = page.locator('input[placeholder^="Type (min"]').first();
    if (!(await box.isVisible({ timeout: 4000 }).catch(() => false))) {
      process.stdout.write(`  ✗ ${name}: search box not found\n`);
      return null;
    }
  }

  const urlBefore = page.url();
  await box.click();
  await box.fill('');
  await box.type(name, { delay: 15 });

  // Wait for the autocomplete options to render (min 2 chars → results).
  const options = page.locator('mat-option');
  if (!(await options.first().waitFor({ state: 'visible', timeout: timeoutMs }).then(() => true).catch(() => false))) {
    process.stdout.write(`  ✗ ${name}: no autocomplete options appeared\n`);
    return null;
  }

  // Pick the option whose text matches the name (exact-normalised, else prefix).
  const count = await options.count();
  const texts: string[] = [];
  let target = -1;
  for (let i = 0; i < count; i++) {
    const t = (await options.nth(i).innerText().catch(() => '')) || '';
    texts.push(t);
    if (norm(t) === norm(name)) { target = i; break; }
  }
  if (target < 0) target = texts.findIndex((t) => norm(t).startsWith(norm(name)));
  if (target < 0) {
    process.stdout.write(`  ✗ ${name}: no matching option. Saw: [${texts.map((t) => t.trim()).slice(0, 6).join(' | ')}]\n`);
    return null;
  }

  await options.nth(target).click();
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

  const { context, page } = await launchSession(config.browserProfileDir, config.tradeMapBaseUrl);
  const confirmed: string[] = [];
  const unresolved: string[] = [];
  try {
    let attempts = 0;
    while (await isLoginPage(page)) {
      if (++attempts > 5) throw new Error('Still on the Trade Map login page after 5 attempts.');
      await promptManualLogin();
    }

    for (const name of target) {
      const code = await harvestOne(page, config.tradeMapBaseUrl, name, perCountryTimeout).catch((e) => {
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
