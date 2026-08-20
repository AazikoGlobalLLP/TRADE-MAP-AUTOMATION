import { strict as assert } from 'node:assert';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import ExcelJS from 'exceljs';
import { Page } from 'playwright';
import { AppConfig, BATCH_DEFAULTS, FiltersConfig, validateConfig, SPEED_PROFILE_PRESETS } from '../config/schema';
import { RequestedRange } from '../trademap/rangeEngine';
import { CountryResult, Logger } from './runCountry';
import { runBatch, renderSummaryTable, BatchDeps } from './runBatch';
import { withRetry, isRetryable } from './retry';
import { normalizeCountryList, readCountries } from '../input/readCountries';
import { captureFailure, EvidencePage } from '../evidence/captureFailure';
import { emptyManifest, upsertEntry } from '../manifest/manifest';

// ---------------------------------------------------------------------------
// Batch harness (Phase 4A demo). Proves the batch loop / retry / evidence /
// summary control flow deterministically with ZERO browser, using a FAKE
// runCountry + captureFailure injected via BatchDeps (spec-lock rows 4–6,10,13).
// Run: `npm run test:batch`. Exits non-zero on any failure.
// ---------------------------------------------------------------------------

let passed = 0;
const failures: string[] = [];

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    process.stdout.write(`  PASS  ${name}\n`);
  } catch (e) {
    failures.push(`${name}: ${(e as Error).message}`);
    process.stdout.write(`  FAIL  ${name}\n`);
  }
}

const log: Logger = () => undefined; // silent during the harness

const FILTERS: FiltersConfig = {
  tradeFlow: 'imports',
  exporter: 'world',
  exporterCode: '000',
  product: 'ALL',
  viewBy: 'exporter',
  frequency: 'monthly',
  source: 'mirror',
  dataType: 'values',
  currency: 'USD',
  view: 'table',
};

const GLOBAL: RequestedRange = Object.freeze({ requestedStart: '200001', requestedEnd: '202606' });
const PAGE = {} as unknown as Page; // never actually used — fakes ignore it
const CODES: Record<string, string> = {};

function cfg(over: Partial<AppConfig['batch']> = {}): AppConfig {
  return {
    tradeMapBaseUrl: 'https://www.trademap.org',
    outputDirectory: './output',
    browserProfileDir: './browser-profile',
    logsDir: './logs',
    countryCodesFile: './config/country-codes.json',
    filters: FILTERS,
    datePolicy: { requestedStart: '200001', requestedEnd: '202606', mode: 'MAX_WITHIN_REQUESTED_RANGE' },
    download: { format: 'xlsx', overwrite: false, timeoutMs: 1000, downloadAttempts: 1 },
    batch: { ...BATCH_DEFAULTS, retryDelayMs: 0, ...over }, // delay 0 → no real waiting in tests
    filenameTemplate: '{country}.{extension}',
  };
}

function mkResult(country: string, status: 'SUCCESS' | 'SKIPPED'): CountryResult {
  return {
    country,
    importerCode: '000',
    codeSource: 'MAP',
    requestedRange: '200001-202606',
    effectiveRange: '200001-202606',
    rangeStatus: 'FULL_RANGE',
    status,
    file: `${country}.xlsx`,
    targetPath: `/out/${country}.xlsx`,
  };
}

/** Wrap a fake runCountry with a call counter + evidence recorder. */
function makeDeps(runCountry: BatchDeps['runCountry']): {
  deps: BatchDeps;
  captureCalls: Array<{ country: string; attempt: number }>;
} {
  const captureCalls: Array<{ country: string; attempt: number }> = [];
  const deps: BatchDeps = {
    runCountry,
    captureFailure: async (_page, ctx) => {
      captureCalls.push({ country: ctx.country, attempt: ctx.attempt });
      return null;
    },
    sleep: async () => undefined,
  };
  return { deps, captureCalls };
}

/** A deterministic [0,1) RNG for the throttle tests: returns `values` in order, then 0 forever. */
function scriptedRandom(values: number[]): () => number {
  let i = 0;
  return () => (i < values.length ? values[i++] : 0);
}

void (async () => {
  // -------------------------------------------------------------------------
  process.stdout.write('\nCountry-list normalisation (order / skip / dedup):\n');

  await check('preserves row order', () => {
    assert.deepEqual(normalizeCountryList(['China', 'India', 'Pakistan']), ['China', 'India', 'Pakistan']);
  });
  await check('skips a "Country" header row', () => {
    assert.deepEqual(normalizeCountryList(['Country', 'China', 'India']), ['China', 'India']);
  });
  await check('skips blank / whitespace rows', () => {
    assert.deepEqual(normalizeCountryList(['Country', 'China', '', '   ', 'India']), ['China', 'India']);
  });
  await check('de-dups case-insensitively, first wins', () => {
    assert.deepEqual(normalizeCountryList(['China', 'china', 'India', 'CHINA']), ['China', 'India']);
  });
  await check('skips reserved World + `_`-metadata', () => {
    assert.deepEqual(normalizeCountryList(['Country', 'World', '_note', 'China']), ['China']);
  });
  await check('trims surrounding whitespace', () => {
    assert.deepEqual(normalizeCountryList(['  China  ']), ['China']);
  });
  await check('all-skipped input → empty list', () => {
    assert.deepEqual(normalizeCountryList(['Country']), []);
    assert.deepEqual(normalizeCountryList(['World', '_x', '', '   ']), []);
  });

  // -------------------------------------------------------------------------
  process.stdout.write('\nreadCountries (real xlsx):\n');

  await check("shipped input/countries.xlsx → ['China','India','Pakistan','Dominica']", async () => {
    const list = await readCountries(path.resolve('input/countries.xlsx'));
    assert.deepEqual(list, ['China', 'India', 'Pakistan', 'Dominica']);
  });

  await check('header-only workbook → rejects with BATCH_EMPTY', async () => {
    const tmp = path.join(os.tmpdir(), `tm-empty-${Date.now()}.xlsx`);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.getCell('A1').value = 'Country';
    await wb.xlsx.writeFile(tmp);
    await assert.rejects(() => readCountries(tmp), /BATCH_EMPTY/);
    fs.rmSync(tmp, { force: true });
  });

  // -------------------------------------------------------------------------
  process.stdout.write('\nRetry policy (isRetryable / withRetry):\n');

  await check('LOGIN_REQUIRED + CONFIG_INVALID are NOT retryable; others are', () => {
    assert.equal(isRetryable(new Error('LOGIN_REQUIRED: session dead')), false);
    assert.equal(isRetryable(new Error('CONFIG_INVALID: bad')), false);
    assert.equal(isRetryable(new Error('DOWNLOAD_TIMEOUT: x')), true);
    assert.equal(isRetryable('some random string'), true);
  });

  await check('withRetry: fails twice then succeeds → ok, attempts=3, onError×2', async () => {
    let n = 0;
    const errs: number[] = [];
    const out = await withRetry(
      async () => {
        n += 1;
        if (n < 3) throw new Error('DOWNLOAD_TIMEOUT');
        return 'value';
      },
      { maxAttempts: 3, delayMs: 0, onAttemptError: (_e, a) => void errs.push(a) },
    );
    assert.equal(out.ok, true);
    assert.equal(out.value, 'value');
    assert.equal(out.attempts, 3);
    assert.deepEqual(errs, [1, 2]);
  });

  await check('withRetry: always fails → ok=false, attempts=max, onError each attempt', async () => {
    const errs: number[] = [];
    const out = await withRetry(
      async () => {
        throw new Error('QUERY_INVALID');
      },
      { maxAttempts: 2, delayMs: 0, onAttemptError: (_e, a) => void errs.push(a) },
    );
    assert.equal(out.ok, false);
    assert.equal(out.attempts, 2);
    assert.match((out.error as Error).message, /QUERY_INVALID/);
    assert.deepEqual(errs, [1, 2]);
  });

  await check('withRetry: fatal error re-throws immediately, onError NOT called', async () => {
    let onErr = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            throw new Error('LOGIN_REQUIRED: dead');
          },
          { maxAttempts: 3, delayMs: 0, onAttemptError: () => void (onErr += 1) },
        ),
      /LOGIN_REQUIRED/,
    );
    assert.equal(onErr, 0);
  });

  // -------------------------------------------------------------------------
  process.stdout.write('\nrunBatch control flow (fake runCountry):\n');

  await check('a failing country is retried maxAttempts× and the batch CONTINUES', async () => {
    const { deps, captureCalls } = makeDeps(async (_page: Page, country: string) => {
      if (country === 'Bravo') throw new Error('DOWNLOAD_TIMEOUT: simulated');
      return mkResult(country, 'SUCCESS');
    });
    const s = await runBatch(PAGE, ['Alpha', 'Bravo', 'Charlie'], GLOBAL, cfg(), CODES, log, 'run-A', deps);

    assert.deepEqual(s.outcomes.map((o) => o.country), ['Alpha', 'Bravo', 'Charlie']); // order + all ran
    const bravo = s.outcomes.find((o) => o.country === 'Bravo')!;
    assert.equal(bravo.status, 'FAILED');
    assert.equal(bravo.attempts, 3);
    assert.equal(s.outcomes.find((o) => o.country === 'Alpha')!.status, 'SUCCESS');
    assert.equal(s.outcomes.find((o) => o.country === 'Charlie')!.status, 'SUCCESS');
    assert.equal(s.success, 2);
    assert.equal(s.failed, 1);
    assert.equal(s.exitCode, 1);
    // captureFailure once per failed Bravo attempt (attempts 1,2,3), none for the others.
    assert.deepEqual(captureCalls, [
      { country: 'Bravo', attempt: 1 },
      { country: 'Bravo', attempt: 2 },
      { country: 'Bravo', attempt: 3 },
    ]);
  });

  await check('a country that succeeds on attempt 2 → SUCCESS, attempts=2, one evidence bundle', async () => {
    let n = 0;
    const { deps, captureCalls } = makeDeps(async (_page: Page, country: string) => {
      n += 1;
      if (n < 2) throw new Error('QUERY_INVALID: transient');
      return mkResult(country, 'SUCCESS');
    });
    const s = await runBatch(PAGE, ['Solo'], GLOBAL, cfg(), CODES, log, 'run-B', deps);
    assert.equal(s.outcomes[0].status, 'SUCCESS');
    assert.equal(s.outcomes[0].attempts, 2);
    assert.equal(s.exitCode, 0);
    assert.deepEqual(captureCalls, [{ country: 'Solo', attempt: 1 }]);
  });

  await check('SKIPPED counts as completed, is not retried', async () => {
    const { deps, captureCalls } = makeDeps(async (_page: Page, country: string) => mkResult(country, 'SKIPPED'));
    const s = await runBatch(PAGE, ['Skip'], GLOBAL, cfg(), CODES, log, 'run-C', deps);
    assert.equal(s.outcomes[0].status, 'SKIPPED');
    assert.equal(s.outcomes[0].attempts, 1);
    assert.equal(s.skipped, 1);
    assert.equal(s.exitCode, 0);
    assert.equal(captureCalls.length, 0);
  });

  await check('LOGIN_REQUIRED aborts the batch: no retries, later countries not run, exit 2', async () => {
    let calls = 0;
    const { deps, captureCalls } = makeDeps(async (_page: Page, country: string) => {
      calls += 1;
      if (country === 'Two') throw new Error('LOGIN_REQUIRED: session expired');
      return mkResult(country, 'SUCCESS');
    });
    const s = await runBatch(PAGE, ['One', 'Two', 'Three'], GLOBAL, cfg(), CODES, log, 'run-D', deps);
    assert.equal(s.aborted, true);
    assert.equal(s.exitCode, 2);
    assert.deepEqual(s.outcomes.map((o) => o.country), ['One', 'Two']); // Three never ran
    assert.equal(s.outcomes.find((o) => o.country === 'Two')!.status, 'FAILED');
    assert.equal(calls, 2); // One once + Two once — retries NOT exhausted
    assert.equal(captureCalls.length, 0); // fatal is thrown before evidence capture
    assert.match(s.abortReason ?? '', /LOGIN_REQUIRED/);
  });

  await check('all-success batch → exit 0, no failures', async () => {
    const { deps } = makeDeps(async (_page: Page, country: string) => mkResult(country, 'SUCCESS'));
    const s = await runBatch(PAGE, ['A', 'B'], GLOBAL, cfg(), CODES, log, 'run-E', deps);
    assert.equal(s.success, 2);
    assert.equal(s.failed, 0);
    assert.equal(s.exitCode, 0);
  });

  await check('continueOnFailure=false stops after the first FAILED (exit 1, not aborted)', async () => {
    const { deps } = makeDeps(async (_page: Page, country: string) => {
      if (country === 'Q') throw new Error('DOWNLOAD_TIMEOUT');
      return mkResult(country, 'SUCCESS');
    });
    const s = await runBatch(PAGE, ['P', 'Q', 'R'], GLOBAL, cfg({ continueOnFailure: false }), CODES, log, 'run-F', deps);
    assert.deepEqual(s.outcomes.map((o) => o.country), ['P', 'Q']); // R never ran
    assert.equal(s.outcomes.find((o) => o.country === 'Q')!.attempts, 3); // still retried its country
    assert.equal(s.aborted, false); // a deliberate stop, not a fatal abort
    assert.equal(s.exitCode, 1);
    assert.match(s.abortReason ?? '', /continueOnFailure/);
  });

  await check('honours maxAttemptsPerCountry from config', async () => {
    const { deps, captureCalls } = makeDeps(async () => {
      throw new Error('DOWNLOAD_TIMEOUT');
    });
    const s = await runBatch(PAGE, ['X'], GLOBAL, cfg({ maxAttemptsPerCountry: 5 }), CODES, log, 'run-G', deps);
    assert.equal(s.outcomes[0].attempts, 5);
    assert.equal(captureCalls.length, 5);
    assert.equal(s.exitCode, 1);
  });

  // -------------------------------------------------------------------------
  process.stdout.write('\nRandomized anti-block throttle (Phase 9, spec rows 23,28):\n');

  const THROTTLE_BOUNDS = { throttleEveryMin: 1, throttleEveryMax: 5, throttlePauseMinMs: 120000, throttlePauseMaxMs: 420000 };

  await check('throttle: random burst sizes + random pause durations, both re-drawn each break', async () => {
    const sleeps: number[] = [];
    // RNG script (consumed in order): initial burst 0.7→4; then per break: pause-rnd, burst-rnd.
    // 0.7→burst4 | 0.5→pause270000,0.0→burst1 | 0.0→pause120000,0.3→burst2 | 0.9→pause390000,0.9→burst5.
    const rng = scriptedRandom([0.7, 0.5, 0.0, 0.0, 0.3, 0.9, 0.9]);
    const deps: BatchDeps = {
      runCountry: async (_page: Page, country: string) => mkResult(country, 'SUCCESS'),
      captureFailure: async () => null,
      sleep: async (ms) => void sleeps.push(ms),
      random: rng,
    };
    const countries = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12'];
    const s = await runBatch(PAGE, countries, GLOBAL, cfg(THROTTLE_BOUNDS), CODES, log, 'run-thr', deps);
    assert.equal(s.success, 12);
    // Bursts 4,1,2,5 → breaks BEFORE C5, C6, C8; each pause a distinct random value within [2min,7min].
    assert.deepEqual(sleeps, [270000, 120000, 390000]);
    for (const ms of sleeps) assert.ok(ms >= 120000 && ms <= 420000, `pause ${ms} within [120000,420000]`);
  });

  await check('throttle: throttleEveryMax=0 disables it (RNG never consulted)', async () => {
    const sleeps: number[] = [];
    const deps: BatchDeps = {
      runCountry: async (_page: Page, country: string) => mkResult(country, 'SUCCESS'),
      captureFailure: async () => null,
      sleep: async (ms) => void sleeps.push(ms),
      random: () => {
        throw new Error('RNG must not be called when the throttle is disabled');
      },
    };
    const s = await runBatch(PAGE, ['A', 'B', 'C'], GLOBAL, cfg({ ...THROTTLE_BOUNDS, throttleEveryMax: 0 }), CODES, log, 'run-thr0', deps);
    assert.equal(s.success, 3);
    assert.deepEqual(sleeps, []);
  });

  await check('throttle: NO pause trails the last country even when it completes a burst (kills the guard-coverage gap)', async () => {
    const sleeps: number[] = [];
    // burst=2 throughout (0.3→2). 4 countries: break BEFORE C3; C4 completes the 2nd burst but is
    // LAST, so NO pause fires after it. Exactly ONE pause proves nothing trails the final run.
    const rng = scriptedRandom([0.3, 0.0, 0.3]); // initBurst2 | pause120000, nextBurst2
    const deps: BatchDeps = {
      runCountry: async (_page: Page, country: string) => mkResult(country, 'SUCCESS'),
      captureFailure: async () => null,
      sleep: async (ms) => void sleeps.push(ms),
      random: rng,
    };
    const s = await runBatch(PAGE, ['A', 'B', 'C', 'D'], GLOBAL, cfg(THROTTLE_BOUNDS), CODES, log, 'run-thr-last', deps);
    assert.equal(s.success, 4);
    assert.deepEqual(sleeps, [120000]); // one pause (before C), none after D
  });

  await check('throttle: trailing resume-SKIPS never trigger a wasted pause (pause is BEFORE the next run)', async () => {
    const sleeps: number[] = [];
    // E, F already SUCCESS+valid → early-skip (`continue` before the throttle check).
    const seed = upsertEntry(
      upsertEntry(emptyManifest('seed', '200001-202606', 'now'), {
        country: 'E', requestedRange: '200001-202606', status: 'SUCCESS', attempts: 1, updatedAt: 'now', file: 'E.xlsx', targetPath: '/out/E.xlsx',
      }),
      { country: 'F', requestedRange: '200001-202606', status: 'SUCCESS', attempts: 1, updatedAt: 'now', file: 'F.xlsx', targetPath: '/out/F.xlsx' },
    );
    const rng = scriptedRandom([0.3, 0.0, 0.3]); // initBurst2 | pause120000, nextBurst2
    const deps: BatchDeps = {
      runCountry: async (_page: Page, country: string) => mkResult(country, 'SUCCESS'),
      captureFailure: async () => null,
      sleep: async (ms) => void sleeps.push(ms),
      loadManifest: () => seed,
      writeManifest: () => undefined,
      validateFile: async () => true,
      now: () => 'now',
      random: rng,
    };
    const config: AppConfig = { ...cfg(THROTTLE_BOUNDS), manifestFile: './manifests/thr.json' };
    const s = await runBatch(PAGE, ['A', 'B', 'C', 'D', 'E', 'F'], GLOBAL, config, CODES, log, 'run-thr-skip', deps);
    assert.equal(s.skipped, 2); // E, F
    assert.equal(s.success, 4); // A, B, C, D
    // A,B run (burst 2) → break BEFORE C; C,D run; D completes burst 2 but E,F are skips that
    // `continue` before the throttle check, so NO pause is wasted. Exactly one pause total.
    assert.deepEqual(sleeps, [120000]);
  });

  // -------------------------------------------------------------------------
  process.stdout.write('\nEnd-of-run retry queue (Phase 10, finalRetryRounds):\n');

  await check('a country that fails the main pass but recovers in a retry round → final SUCCESS, attempts accumulate', async () => {
    let bravo = 0;
    const { deps } = makeDeps(async (_page: Page, country: string) => {
      if (country === 'Bravo') {
        bravo += 1;
        if (bravo <= 3) throw new Error('DOWNLOAD_TIMEOUT: transient'); // fails all 3 main-pass attempts
        return mkResult(country, 'SUCCESS'); // succeeds on the first retry-round attempt (call 4)
      }
      return mkResult(country, 'SUCCESS');
    });
    const s = await runBatch(PAGE, ['Alpha', 'Bravo', 'Charlie'], GLOBAL, cfg({ finalRetryRounds: 3 }), CODES, log, 'run-rq1', deps);
    assert.deepEqual(s.outcomes.map((o) => o.country), ['Alpha', 'Bravo', 'Charlie']); // order preserved (replaced in place)
    const b = s.outcomes.find((o) => o.country === 'Bravo')!;
    assert.equal(b.status, 'SUCCESS');
    assert.equal(b.attempts, 4); // 3 main-pass + 1 retry-round attempt, accumulated
    assert.equal(s.success, 3);
    assert.equal(s.failed, 0);
    assert.equal(s.exitCode, 0);
  });

  await check('a country that fails EVERY round stays FAILED with attempts summed across all rounds', async () => {
    const { deps, captureCalls } = makeDeps(async () => {
      throw new Error('DOWNLOAD_TIMEOUT');
    });
    const s = await runBatch(PAGE, ['X'], GLOBAL, cfg({ finalRetryRounds: 2, maxAttemptsPerCountry: 2 }), CODES, log, 'run-rq2', deps);
    assert.equal(s.outcomes[0].status, 'FAILED');
    assert.equal(s.outcomes[0].attempts, 6); // main 2 + round1 2 + round2 2
    assert.equal(captureCalls.length, 6); // one evidence bundle per failed attempt across all passes
    assert.equal(s.failed, 1);
    assert.equal(s.exitCode, 1);
  });

  await check('finalRetryRounds=0 (engine default) → no retry queue, a FAILED country stays FAILED after the main pass', async () => {
    const { deps, captureCalls } = makeDeps(async (_page: Page, country: string) => {
      if (country === 'Z') throw new Error('DOWNLOAD_TIMEOUT');
      return mkResult(country, 'SUCCESS');
    });
    const s = await runBatch(PAGE, ['Y', 'Z'], GLOBAL, cfg(), CODES, log, 'run-rq0', deps); // cfg() → BATCH_DEFAULTS.finalRetryRounds=0
    assert.equal(s.outcomes.find((o) => o.country === 'Z')!.attempts, 3); // only the main pass, no extra rounds
    assert.equal(captureCalls.length, 3);
    assert.equal(s.failed, 1);
  });

  await check('LOGIN_REQUIRED during a retry round aborts the whole batch (exit 2)', async () => {
    let bad = 0;
    const { deps } = makeDeps(async (_page: Page, country: string) => {
      if (country === 'Bad') {
        bad += 1;
        if (bad <= 3) throw new Error('DOWNLOAD_TIMEOUT'); // fails the main pass → queued
        throw new Error('LOGIN_REQUIRED: session died'); // fatal during the retry round
      }
      return mkResult(country, 'SUCCESS');
    });
    const s = await runBatch(PAGE, ['Good', 'Bad'], GLOBAL, cfg({ finalRetryRounds: 3 }), CODES, log, 'run-rq3', deps);
    assert.equal(s.aborted, true);
    assert.equal(s.exitCode, 2);
    assert.equal(s.outcomes.find((o) => o.country === 'Good')!.status, 'SUCCESS');
    assert.equal(s.outcomes.find((o) => o.country === 'Bad')!.status, 'FAILED');
    assert.match(s.abortReason ?? '', /LOGIN_REQUIRED/);
  });

  await check('continueOnFailure=false disables the retry queue (a deliberate stop, not a queue)', async () => {
    const { deps } = makeDeps(async (_page: Page, country: string) => {
      if (country === 'Q') throw new Error('DOWNLOAD_TIMEOUT');
      return mkResult(country, 'SUCCESS');
    });
    const s = await runBatch(PAGE, ['P', 'Q', 'R'], GLOBAL, cfg({ continueOnFailure: false, finalRetryRounds: 3 }), CODES, log, 'run-rq4', deps);
    assert.deepEqual(s.outcomes.map((o) => o.country), ['P', 'Q']); // stopped at Q, R never ran, no retry queue
    assert.equal(s.outcomes.find((o) => o.country === 'Q')!.attempts, 3); // just the main-pass attempts
    assert.equal(s.exitCode, 1);
  });

  // -------------------------------------------------------------------------
  process.stdout.write('\nSpeed profile + finalRetryRounds config (Phase 10):\n');

  // Minimal valid raw config; `batch` overrides are merged in for each assertion.
  const rawCfg = (batch: Record<string, unknown>): unknown => ({
    tradeMapBaseUrl: 'https://www.trademap.org',
    outputDirectory: './output',
    browserProfileDir: './browser-profile',
    logsDir: './logs',
    countryCodesFile: './config/country-codes.json',
    filenameTemplate: '{country}.{extension}',
    filters: { ...FILTERS },
    datePolicy: { requestedStart: '200001', requestedEnd: '202606', mode: 'MAX_WITHIN_REQUESTED_RANGE' },
    download: { format: 'xlsx', overwrite: false, timeoutMs: 1000, downloadAttempts: 1 },
    batch: { inputFile: './input/countries.xlsx', ...batch },
  });

  await check('speedProfile "balanced" sets the four throttle numbers from the preset', () => {
    const c = validateConfig(rawCfg({ speedProfile: 'balanced' }));
    assert.equal(c.batch.speedProfile, 'balanced');
    assert.equal(c.batch.throttleEveryMin, SPEED_PROFILE_PRESETS.balanced.throttleEveryMin);
    assert.equal(c.batch.throttleEveryMax, SPEED_PROFILE_PRESETS.balanced.throttleEveryMax);
    assert.equal(c.batch.throttlePauseMinMs, SPEED_PROFILE_PRESETS.balanced.throttlePauseMinMs);
    assert.equal(c.batch.throttlePauseMaxMs, SPEED_PROFILE_PRESETS.balanced.throttlePauseMaxMs);
  });

  await check('speedProfile "fast" is faster than "safe" (fewer/shorter pauses) yet never disables the throttle', () => {
    const fast = validateConfig(rawCfg({ speedProfile: 'fast' })).batch;
    const safe = validateConfig(rawCfg({ speedProfile: 'safe' })).batch;
    assert.ok(fast.throttlePauseMaxMs < safe.throttlePauseMaxMs, 'fast pauses are shorter');
    assert.ok(fast.throttleEveryMax > safe.throttleEveryMax, 'fast runs more countries per burst');
    assert.ok(fast.throttleEveryMax > 0, 'throttle stays ON (never disabled by a profile)');
  });

  await check('an explicit throttle field overrides the speedProfile preset', () => {
    const c = validateConfig(rawCfg({ speedProfile: 'safe', throttlePauseMinMs: 5000 })).batch;
    assert.equal(c.throttlePauseMinMs, 5000); // explicit wins
    assert.equal(c.throttlePauseMaxMs, SPEED_PROFILE_PRESETS.safe.throttlePauseMaxMs); // untouched fields still from preset
  });

  await check('an unknown speedProfile is rejected with CONFIG_INVALID', () => {
    assert.throws(() => validateConfig(rawCfg({ speedProfile: 'ludicrous' })), /CONFIG_INVALID: batch\.speedProfile/);
  });

  await check('finalRetryRounds parses (non-negative int) and defaults to 0', () => {
    assert.equal(validateConfig(rawCfg({ finalRetryRounds: 5 })).batch.finalRetryRounds, 5);
    assert.equal(validateConfig(rawCfg({})).batch.finalRetryRounds, 0);
    assert.throws(() => validateConfig(rawCfg({ finalRetryRounds: -1 })), /CONFIG_INVALID: batch\.finalRetryRounds/);
  });

  // -------------------------------------------------------------------------
  process.stdout.write('\nSummary table + real captureFailure:\n');

  await check('renderSummaryTable shows statuses + exit code', async () => {
    const { deps } = makeDeps(async (_page: Page, country: string) => {
      if (country === 'Bad') throw new Error('DOWNLOAD_TIMEOUT: boom');
      return mkResult(country, 'SUCCESS');
    });
    const s = await runBatch(PAGE, ['Good', 'Bad'], GLOBAL, cfg(), CODES, log, 'run-H', deps);
    const table = renderSummaryTable(s);
    assert.match(table, /Good\s+SUCCESS/);
    assert.match(table, /Bad\s+FAILED/);
    assert.match(table, /FAILED 1/);
    assert.match(table, /exit 1/);
  });

  await check('captureFailure writes one PNG + one JSON with url/filters/error', async () => {
    const evDir = path.join(os.tmpdir(), `tm-ev-${Date.now()}`);
    const url =
      'https://www.trademap.org/en/goods/time-series/imports/c/699/c/000/p/ALL/byPartner/month/200001-202606/mirror/values/USD/table';
    const fakePage: EvidencePage = {
      url: () => url,
      screenshot: async (o) => {
        fs.writeFileSync(o.path, Buffer.from('PNG'));
        return undefined;
      },
    };
    const png = await captureFailure(fakePage, {
      runId: 'unit-run',
      country: 'India',
      attempt: 2,
      maxAttempts: 3,
      error: new Error('QUERY_INVALID: boom'),
      filters: FILTERS,
      evidenceDir: evDir,
      timestamp: '2026-08-17T00-00-00-000Z',
      log,
    });

    const dir = path.join(evDir, 'unit-run');
    const files = fs.readdirSync(dir);
    const pngs = files.filter((f) => f.endsWith('.png'));
    const jsons = files.filter((f) => f.endsWith('.json'));
    assert.equal(pngs.length, 1, 'exactly one PNG');
    assert.equal(jsons.length, 1, 'exactly one JSON');
    assert.ok(png && png.endsWith('.png'));

    const rec = JSON.parse(fs.readFileSync(path.join(dir, jsons[0]), 'utf8'));
    assert.equal(rec.country, 'India');
    assert.equal(rec.attempt, 2);
    assert.equal(rec.timestamp, '2026-08-17T00-00-00-000Z');
    assert.equal(rec.url, url);
    assert.equal(rec.filters.currency, 'USD'); // filters parsed from the URL
    assert.equal(rec.filters.tradeFlow, 'imports');
    assert.equal(rec.error.name, 'Error');
    assert.match(rec.error.message, /QUERY_INVALID/);
    assert.ok(String(rec.screenshot).endsWith('.png'));

    fs.rmSync(evDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  process.stdout.write(`\nBatch harness: ${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) {
    for (const f of failures) process.stdout.write(`  - ${f}\n`);
    process.exit(1);
  }
  process.stdout.write('ALL PASS\n');
})();
