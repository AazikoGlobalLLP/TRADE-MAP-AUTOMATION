import { strict as assert } from 'node:assert';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import ExcelJS from 'exceljs';
import { Page } from 'playwright';
import { AppConfig, BATCH_DEFAULTS, FiltersConfig } from '../config/schema';
import { RequestedRange } from '../trademap/rangeEngine';
import { CountryResult, Logger } from '../orchestrator/runCountry';
import { runBatch, BatchDeps, BatchSummary, CountryOutcome } from '../orchestrator/runBatch';
import { buildReportRows, writeRunReport } from './runReport';
import { isSessionExpired, sessionExpiredAbortReason } from '../auth/expiry';

// ---------------------------------------------------------------------------
// Phase 6 demo harness. Proves the run-report + session-expiry logic
// deterministically with ZERO browser: pure row-building, a real .xlsx
// round-trip (written to os.tmpdir then read back), the pure session-expiry
// classifier, and a fake-runCountry runBatch that hits an expired session.
// Run: `npm run test:report`. Exits non-zero on any failure.
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
const RANGE = '200001-202606';
const GLOBAL: RequestedRange = Object.freeze({ requestedStart: '200001', requestedEnd: '202606' });
const PAGE = {} as unknown as Page;
const CODES: Record<string, string> = {};

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

/** Config with the manifest DISABLED (simplest path — the report needs no manifest). */
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
    manifestFile: undefined,
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

/** A representative summary: one SUCCESS (clipped), one SKIPPED, one FAILED. */
function sampleSummary(): BatchSummary {
  const outcomes: CountryOutcome[] = [
    {
      country: 'India',
      status: 'SUCCESS',
      attempts: 1,
      effectiveRange: '200001-202606',
      rangeStatus: 'FULL_RANGE',
      file: 'India.xlsx',
      targetPath: '/out/India.xlsx',
    },
    {
      country: 'Pakistan',
      status: 'SUCCESS',
      attempts: 2,
      effectiveRange: '202401-202606',
      rangeStatus: 'CLIPPED_BY_AVAILABILITY',
      file: 'Pakistan.xlsx',
      targetPath: '/out/Pakistan.xlsx',
    },
    { country: 'Nowhere', status: 'FAILED', attempts: 3, error: 'DOWNLOAD_TIMEOUT: boom' },
  ];
  return {
    runId: 'R-report',
    total: 3,
    success: 2,
    skipped: 0,
    failed: 1,
    aborted: false,
    sessionExpired: false,
    exitCode: 1,
    outcomes,
  };
}

function makeDeps(runCountry: BatchDeps['runCountry']): BatchDeps {
  return {
    runCountry,
    captureFailure: async () => null,
    sleep: async () => undefined,
  };
}

void (async () => {
  // -------------------------------------------------------------------------
  process.stdout.write('\nReport rows (pure):\n');

  await check('buildReportRows preserves input order (AC-11) and maps every field', () => {
    const rows = buildReportRows(sampleSummary(), RANGE);
    assert.deepEqual(rows.map((r) => r.country), ['India', 'Pakistan', 'Nowhere']);
    assert.equal(rows[0].requested, RANGE);
    assert.equal(rows[0].status, 'Success'); // title-cased for humans
    assert.equal(rows[0].effective, '200001-202606');
    assert.equal(rows[0].rangeStatus, 'FULL_RANGE');
    assert.equal(rows[1].attempts, 2);
    assert.equal(rows[1].rangeStatus, 'CLIPPED_BY_AVAILABILITY');
  });

  await check('FAILED row: no effective/range → dashes, error carried, status title-cased', () => {
    const rows = buildReportRows(sampleSummary(), RANGE);
    const bad = rows[2];
    assert.equal(bad.status, 'Failed');
    assert.equal(bad.effective, '—');
    assert.equal(bad.rangeStatus, '—');
    assert.match(bad.error, /DOWNLOAD_TIMEOUT/);
    assert.equal(bad.file, '—'); // no file and no targetPath on a failure
  });

  // -------------------------------------------------------------------------
  process.stdout.write('\nRun report .xlsx round-trip (real fs):\n');

  await check('writeRunReport → header row + one data row per country, in order', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-report-'));
    const file = path.join(dir, 'run-report.xlsx');
    await writeRunReport(file, sampleSummary(), RANGE, { generatedAt: '2026-08-18T00:00:00.000Z' });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.worksheets[0];
    assert.equal(ws.name, 'Run Report');
    // Row 1 = header.
    assert.deepEqual(
      (ws.getRow(1).values as unknown[]).slice(1, 9),
      ['Country', 'Requested', 'Effective', 'Range status', 'Status', 'Attempts', 'File', 'Error'],
    );
    // Rows 2-4 = the three countries in order.
    assert.equal(ws.getCell('A2').value, 'India');
    assert.equal(ws.getCell('A3').value, 'Pakistan');
    assert.equal(ws.getCell('A4').value, 'Nowhere');
    assert.equal(ws.getCell('E2').value, 'Success');
    assert.equal(ws.getCell('F3').value, 2); // Pakistan attempts, as a number
    assert.equal(ws.getCell('C3').value, '202401-202606');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await check('writeRunReport on a session-expired run writes the resume note', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-report-'));
    const file = path.join(dir, 'run-report.xlsx');
    const s: BatchSummary = { ...sampleSummary(), aborted: true, sessionExpired: true, exitCode: 2,
      abortReason: sessionExpiredAbortReason('Pakistan', 'LOGIN_REQUIRED: dead') };
    await writeRunReport(file, s, RANGE, { generatedAt: 'T0', sessionExpired: true, abortReason: s.abortReason });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.worksheets[0];
    // Find the footer note cell in column A.
    let found = false;
    ws.eachRow((row) => {
      const v = row.getCell(1).value;
      if (typeof v === 'string' && /SESSION EXPIRED/.test(v)) found = true;
    });
    assert.equal(found, true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  process.stdout.write('\nSession-expiry classifier (pure):\n');

  await check('isSessionExpired: LOGIN_REQUIRED / SESSION_EXPIRED → true; others → false', () => {
    assert.equal(isSessionExpired(new Error('LOGIN_REQUIRED: still on login page')), true);
    assert.equal(isSessionExpired(new Error('SESSION_EXPIRED mid-run')), true);
    assert.equal(isSessionExpired(new Error('DOWNLOAD_TIMEOUT: x')), false);
    assert.equal(isSessionExpired('some random string'), false);
  });

  await check('sessionExpiredAbortReason keeps the original text (log greps still match) + adds resume steps', () => {
    const r = sessionExpiredAbortReason('India', 'LOGIN_REQUIRED: session dead');
    assert.match(r, /LOGIN_REQUIRED/); // preserved for existing greps
    assert.match(r, /rerun the SAME command/i);
    assert.match(r, /India/);
  });

  // -------------------------------------------------------------------------
  process.stdout.write('\nrunBatch on session expiry (fake runCountry):\n');

  await check('expired session mid-run → aborts, flags sessionExpired, does NOT run later countries', async () => {
    const deps = makeDeps(async (_p: Page, country: string) => {
      if (country === 'Two') throw new Error('LOGIN_REQUIRED: session expired mid-run');
      return mkResult(country, 'SUCCESS');
    });
    const s = await runBatch(PAGE, ['One', 'Two', 'Three'], GLOBAL, cfg(), CODES, log, 'R-exp', deps, false);
    assert.equal(s.aborted, true);
    assert.equal(s.sessionExpired, true);
    assert.equal(s.exitCode, 2);
    // 'Three' is never processed — it stays PENDING (not FAILED). AC-08.
    assert.deepEqual(s.outcomes.map((o) => o.country), ['One', 'Two']);
    assert.match(s.abortReason ?? '', /rerun the SAME command/i);
    assert.match(s.abortReason ?? '', /LOGIN_REQUIRED/);
  });

  await check('a NON-auth fatal is not flagged as session expiry', async () => {
    // A plain error string with no fatal marker is retryable, so it FAILS the country
    // (not a fatal abort). Prove sessionExpired stays false on the ordinary failure path.
    const deps = makeDeps(async (_p: Page, country: string) => {
      if (country === 'Two') throw new Error('DOWNLOAD_TIMEOUT: boom');
      return mkResult(country, 'SUCCESS');
    });
    const s = await runBatch(PAGE, ['One', 'Two', 'Three'], GLOBAL, cfg(), CODES, log, 'R-fail', deps, false);
    assert.equal(s.sessionExpired, false);
    assert.equal(s.failed, 1);
    assert.equal(s.success, 2); // Three still ran (continueOnFailure default true)
  });

  // -------------------------------------------------------------------------
  process.stdout.write(`\nReport harness: ${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) {
    for (const f of failures) process.stdout.write(`  - ${f}\n`);
    process.exit(1);
  }
  process.stdout.write('ALL PASS\n');
})();
