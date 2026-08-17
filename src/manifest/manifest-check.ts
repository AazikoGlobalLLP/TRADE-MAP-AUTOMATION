import { strict as assert } from 'node:assert';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Page } from 'playwright';
import { AppConfig, BATCH_DEFAULTS, FiltersConfig } from '../config/schema';
import { RequestedRange } from '../trademap/rangeEngine';
import { CountryResult, Logger } from '../orchestrator/runCountry';
import { runBatch, BatchDeps } from '../orchestrator/runBatch';
import {
  emptyManifest,
  findEntry,
  upsertEntry,
  loadManifest,
  writeManifest,
  Manifest,
  ManifestEntry,
} from './manifest';
import { shouldSkipByManifest, isAlreadyDone } from './resume';
import { resolveCollision, resolveCollisionMode, versionedName } from '../files/collision';

// ---------------------------------------------------------------------------
// Phase 5A demo harness. Proves the manifest / resume / idempotency / collision
// logic deterministically with ZERO browser, using pure functions + injected
// fakes (fake runCountry, in-memory manifest, fake validateFile). Run:
// `npm run test:manifest`. Exits non-zero on any failure.
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

const log: Logger = () => undefined;

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
const RANGE = '200001-202606';
const PAGE = {} as unknown as Page;
const CODES: Record<string, string> = {};

/** Config with the manifest ENABLED (a manifestFile is set) — the Phase-5 path. */
function cfg(over: Partial<AppConfig> = {}): AppConfig {
  return {
    tradeMapBaseUrl: 'https://www.trademap.org',
    outputDirectory: './output',
    browserProfileDir: './browser-profile',
    logsDir: './logs',
    countryCodesFile: './config/country-codes.json',
    filters: FILTERS,
    datePolicy: { requestedStart: '200001', requestedEnd: '202606', mode: 'MAX_WITHIN_REQUESTED_RANGE' },
    download: { format: 'xlsx', overwrite: false, timeoutMs: 1000, downloadAttempts: 1 },
    batch: { ...BATCH_DEFAULTS, retryDelayMs: 0 },
    manifestFile: './manifests/test-run.json',
    filenameTemplate: '{country}.{extension}',
    ...over,
  };
}

function mkResult(country: string, status: 'SUCCESS' | 'SKIPPED'): CountryResult {
  return {
    country,
    importerCode: '000',
    codeSource: 'MAP',
    requestedRange: RANGE,
    effectiveRange: RANGE,
    rangeStatus: 'FULL_RANGE',
    status,
    file: `${country}.xlsx`,
    targetPath: `/out/${country}.xlsx`,
  };
}

function successEntry(country: string, requestedRange = RANGE): ManifestEntry {
  return {
    country,
    requestedRange,
    effectiveRange: RANGE,
    rangeStatus: 'FULL_RANGE',
    status: 'SUCCESS',
    file: `${country}.xlsx`,
    targetPath: `/out/${country}.xlsx`,
    attempts: 1,
    updatedAt: 'T0',
  };
}

/**
 * In-memory manifest deps: a seeded manifest, a set of "valid" target paths, a
 * deterministic clock, and a `ran` list recording which countries runCountry saw.
 */
function makeDeps(opts: {
  seed?: ManifestEntry[];
  validPaths?: Set<string>;
  runCountry: BatchDeps['runCountry'];
}): { deps: BatchDeps; ran: string[]; writes: Manifest[] } {
  const ran: string[] = [];
  const writes: Manifest[] = [];
  const valid = opts.validPaths ?? new Set<string>();
  let clock = 0;
  const wrappedRun: BatchDeps['runCountry'] = (page, country, ...rest) => {
    ran.push(country);
    return opts.runCountry(page, country, ...rest);
  };
  const deps: BatchDeps = {
    runCountry: wrappedRun,
    captureFailure: async () => null,
    sleep: async () => undefined,
    validateFile: async (p: string) => valid.has(p),
    loadManifest: (_path, runId, requestedRange, now) => {
      const m = emptyManifest(runId, requestedRange, now);
      return { ...m, countries: (opts.seed ?? []).slice() };
    },
    writeManifest: (_path, m) => {
      // deep clone so later mutation of `manifest` can't retroactively change a captured write
      writes.push(JSON.parse(JSON.stringify(m)));
    },
    now: () => `T${++clock}`,
  };
  return { deps, ran, writes };
}

void (async () => {
  // -------------------------------------------------------------------------
  process.stdout.write('\nCollision resolution (pure):\n');

  await check('no existing file → save under the original name', () => {
    const d = resolveCollision('India.xlsx', 'version', () => false);
    assert.deepEqual(d, { action: 'save', finalName: 'India.xlsx', versioned: false });
  });

  await check('skip mode: existing file → action skip, same name', () => {
    const d = resolveCollision('India.xlsx', 'skip', () => true);
    assert.equal(d.action, 'skip');
    assert.equal(d.finalName, 'India.xlsx');
  });

  await check('overwrite mode: existing file → save same name', () => {
    const d = resolveCollision('India.xlsx', 'overwrite', () => true);
    assert.deepEqual(d, { action: 'save', finalName: 'India.xlsx', versioned: false });
  });

  await check('version mode: India.xlsx exists → India_v2.xlsx', () => {
    const present = new Set(['India.xlsx']);
    const d = resolveCollision('India.xlsx', 'version', (n) => present.has(n));
    assert.deepEqual(d, { action: 'save', finalName: 'India_v2.xlsx', versioned: true });
  });

  await check('version mode: India.xlsx + India_v2.xlsx exist → India_v3.xlsx', () => {
    const present = new Set(['India.xlsx', 'India_v2.xlsx']);
    const d = resolveCollision('India.xlsx', 'version', (n) => present.has(n));
    assert.equal(d.finalName, 'India_v3.xlsx');
    assert.equal(d.versioned, true);
  });

  await check('version mode inserts _vN before the real extension', () => {
    assert.equal(versionedName('India_TradeMap_USD.xlsx', 2), 'India_TradeMap_USD_v2.xlsx');
    assert.equal(versionedName('noext', 3), 'noext_v3');
  });

  await check('version mode: all _v2.._v999 taken → COLLISION_EXHAUSTED', () => {
    assert.throws(() => resolveCollision('x.xlsx', 'version', () => true), /COLLISION_EXHAUSTED/);
  });

  await check('resolveCollisionMode: explicit mode wins, else derived from overwrite', () => {
    assert.equal(resolveCollisionMode({ overwrite: false }), 'skip');
    assert.equal(resolveCollisionMode({ overwrite: true }), 'overwrite');
    assert.equal(resolveCollisionMode({ overwrite: false, collisionMode: 'version' }), 'version');
    assert.equal(resolveCollisionMode({ overwrite: true, collisionMode: 'skip' }), 'skip');
  });

  // -------------------------------------------------------------------------
  process.stdout.write('\nManifest model (pure) + round-trip (real fs):\n');

  await check('upsertEntry appends a new country, preserves order', () => {
    let m = emptyManifest('R1', RANGE, 'T0');
    m = upsertEntry(m, successEntry('India'));
    m = upsertEntry(m, successEntry('Pakistan'));
    assert.deepEqual(m.countries.map((e) => e.country), ['India', 'Pakistan']);
  });

  await check('upsertEntry replaces same country (case-insensitive), position kept', () => {
    let m = emptyManifest('R1', RANGE, 'T0');
    m = upsertEntry(m, successEntry('India'));
    m = upsertEntry(m, successEntry('Pakistan'));
    m = upsertEntry(m, { ...successEntry('india'), status: 'FAILED', error: 'boom', attempts: 3 });
    assert.equal(m.countries.length, 2);
    assert.deepEqual(m.countries.map((e) => e.country), ['india', 'Pakistan']);
    assert.equal(findEntry(m, 'INDIA')!.status, 'FAILED');
  });

  await check('upsertEntry does not mutate the input manifest', () => {
    const m0 = emptyManifest('R1', RANGE, 'T0');
    const m1 = upsertEntry(m0, successEntry('India'));
    assert.equal(m0.countries.length, 0);
    assert.equal(m1.countries.length, 1);
  });

  await check('writeManifest → loadManifest round-trips deep-equal countries', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-manifest-'));
    const file = path.join(dir, 'latest-run.json');
    let m = emptyManifest('R1', RANGE, 'T0');
    m = upsertEntry(m, successEntry('India'));
    m = upsertEntry(m, { ...successEntry('Pakistan'), effectiveRange: '200801-202512', rangeStatus: 'CLIPPED_BY_AVAILABILITY' });
    writeManifest(file, m);
    const back = loadManifest(file, 'R2', RANGE, 'T9'); // new run reads it
    assert.deepEqual(back.countries, m.countries); // country records carried verbatim
    assert.equal(back.runId, 'R2'); // reconciled to the current run
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await check('loadManifest on a missing/corrupt file → empty manifest, no throw', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-manifest-'));
    const missing = path.join(dir, 'nope.json');
    assert.deepEqual(loadManifest(missing, 'R1', RANGE, 'T0').countries, []);
    const corrupt = path.join(dir, 'corrupt.json');
    fs.writeFileSync(corrupt, '{ not json');
    assert.deepEqual(loadManifest(corrupt, 'R1', RANGE, 'T0').countries, []);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  process.stdout.write('\nResume decision (pure + injected validateFile):\n');

  await check('shouldSkipByManifest: SUCCESS + same range + target → true', () => {
    assert.equal(shouldSkipByManifest(successEntry('India'), RANGE, false), true);
  });

  await check('shouldSkipByManifest: force → always false', () => {
    assert.equal(shouldSkipByManifest(successEntry('India'), RANGE, true), false);
  });

  await check('shouldSkipByManifest: FAILED / missing / different range → false', () => {
    assert.equal(shouldSkipByManifest(undefined, RANGE, false), false);
    assert.equal(shouldSkipByManifest({ ...successEntry('India'), status: 'FAILED' }, RANGE, false), false);
    assert.equal(shouldSkipByManifest(successEntry('India', '201501-202512'), RANGE, false), false);
    assert.equal(shouldSkipByManifest({ ...successEntry('India'), targetPath: undefined }, RANGE, false), false);
  });

  await check('isAlreadyDone: SUCCESS but file no longer valid on disk → re-run (false)', async () => {
    let m = emptyManifest('R1', RANGE, 'T0');
    m = upsertEntry(m, successEntry('India'));
    const validNone = async () => false; // file deleted / corrupt
    const validAll = async () => true;
    assert.equal(await isAlreadyDone(m, 'India', RANGE, false, validNone), false);
    assert.equal(await isAlreadyDone(m, 'India', RANGE, false, validAll), true);
  });

  // -------------------------------------------------------------------------
  process.stdout.write('\nrunBatch resume integration (fake runCountry, in-memory manifest):\n');

  await check('RESUME: manifest has countries[0,1]=SUCCESS + valid files → only [2,3,4] run', async () => {
    const list = ['China', 'India', 'Pakistan', 'Dominica', 'Brazil'];
    const { deps, ran } = makeDeps({
      seed: [successEntry('China'), successEntry('India')],
      validPaths: new Set(['/out/China.xlsx', '/out/India.xlsx']),
      runCountry: async (_p, country) => mkResult(country, 'SUCCESS'),
    });
    const s = await runBatch(PAGE, list, GLOBAL, cfg(), CODES, log, 'R2', deps, false);

    assert.deepEqual(ran, ['Pakistan', 'Dominica', 'Brazil']); // China + India NOT re-run
    const china = s.outcomes.find((o) => o.country === 'China')!;
    assert.equal(china.status, 'SKIPPED');
    assert.equal(china.skipReason, 'ALREADY_DONE');
    assert.equal(china.attempts, 0);
    assert.equal(s.skipped, 2);
    assert.equal(s.success, 3);
    assert.equal(s.exitCode, 0);
  });

  await check('FORCE: same seed + force=true → all 5 re-run, no idempotency skip', async () => {
    const list = ['China', 'India', 'Pakistan', 'Dominica', 'Brazil'];
    const { deps, ran } = makeDeps({
      seed: [successEntry('China'), successEntry('India')],
      validPaths: new Set(['/out/China.xlsx', '/out/India.xlsx']),
      runCountry: async (_p, country) => mkResult(country, 'SUCCESS'),
    });
    const s = await runBatch(PAGE, list, GLOBAL, cfg(), CODES, log, 'R3', deps, true);
    assert.deepEqual(ran, list); // every country ran
    assert.equal(s.skipped, 0);
    assert.equal(s.success, 5);
    assert.equal(s.exitCode, 0);
  });

  await check('DELETED FILE: manifest SUCCESS but file invalid → country re-runs', async () => {
    const { deps, ran } = makeDeps({
      seed: [successEntry('China')],
      validPaths: new Set(), // China's file is gone
      runCountry: async (_p, country) => mkResult(country, 'SUCCESS'),
    });
    const s = await runBatch(PAGE, ['China'], GLOBAL, cfg(), CODES, log, 'R4', deps, false);
    assert.deepEqual(ran, ['China']);
    assert.equal(s.outcomes[0].status, 'SUCCESS');
    assert.equal(s.skipped, 0);
  });

  await check('KILL-SAFETY: manifest written after EVERY completed country', async () => {
    const { deps, writes } = makeDeps({
      seed: [],
      runCountry: async (_p, country) => mkResult(country, 'SUCCESS'),
    });
    await runBatch(PAGE, ['A', 'B', 'C'], GLOBAL, cfg(), CODES, log, 'R5', deps, false);
    // one write per completed country, each a valid manifest holding exactly the done-so-far set
    assert.equal(writes.length, 3);
    assert.deepEqual(writes[0].countries.map((e) => e.country), ['A']);
    assert.deepEqual(writes[1].countries.map((e) => e.country), ['A', 'B']);
    assert.deepEqual(writes[2].countries.map((e) => e.country), ['A', 'B', 'C']);
    assert.equal(writes[2].countries[0].status, 'SUCCESS');
  });

  await check('IDEMPOTENCY-SKIP does not downgrade the manifest SUCCESS entry', async () => {
    const { deps, writes } = makeDeps({
      seed: [successEntry('China')],
      validPaths: new Set(['/out/China.xlsx']),
      runCountry: async (_p, country) => mkResult(country, 'SUCCESS'),
    });
    await runBatch(PAGE, ['China', 'India'], GLOBAL, cfg(), CODES, log, 'R6', deps, false);
    // Only India (which actually ran) triggers a manifest write; China's skip writes nothing.
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].countries.map((e) => e.country), ['China', 'India']);
    assert.equal(findEntry(writes[0], 'China')!.status, 'SUCCESS'); // still SUCCESS
    assert.equal(findEntry(writes[0], 'India')!.status, 'SUCCESS');
  });

  await check('FAILED country is recorded in the manifest with its error + attempts', async () => {
    const { deps, writes } = makeDeps({
      seed: [],
      runCountry: async (_p, country) => {
        if (country === 'Bad') throw new Error('DOWNLOAD_TIMEOUT: boom');
        return mkResult(country, 'SUCCESS');
      },
    });
    const s = await runBatch(PAGE, ['Good', 'Bad'], GLOBAL, cfg(), CODES, log, 'R7', deps, false);
    assert.equal(s.exitCode, 1);
    const last = writes[writes.length - 1];
    const bad = findEntry(last, 'Bad')!;
    assert.equal(bad.status, 'FAILED');
    assert.equal(bad.attempts, 3);
    assert.match(bad.error ?? '', /DOWNLOAD_TIMEOUT/);
  });

  await check('manifest DISABLED (no manifestFile) → no skips, behaves like Phase 4', async () => {
    const { deps, ran, writes } = makeDeps({
      seed: [successEntry('China')], // would be skipped if manifest were on
      validPaths: new Set(['/out/China.xlsx']),
      runCountry: async (_p, country) => mkResult(country, 'SUCCESS'),
    });
    const noManifest = cfg({ manifestFile: undefined });
    const s = await runBatch(PAGE, ['China'], GLOBAL, noManifest, CODES, log, 'R8', deps, false);
    assert.deepEqual(ran, ['China']); // ran despite the seed — manifest off
    assert.equal(writes.length, 0); // nothing persisted
    assert.equal(s.success, 1);
  });

  // -------------------------------------------------------------------------
  process.stdout.write(`\nManifest harness: ${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) {
    for (const f of failures) process.stdout.write(`  - ${f}\n`);
    process.exit(1);
  }
  process.stdout.write('ALL PASS\n');
})();
