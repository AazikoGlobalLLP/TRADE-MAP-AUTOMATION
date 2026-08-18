import * as path from 'path';
import * as fs from 'fs';
import ExcelJS from 'exceljs';
import { BatchSummary, CountryOutcome } from '../orchestrator/runBatch';

// ---------------------------------------------------------------------------
// Human-readable run report (Phase 6, PRD §31, AC-08 audit).
//
// The machine-readable record of a run is the JSON manifest (Phase 5). This is
// its human twin: one `run-report.xlsx` per run, so a non-developer can audit
// requested-vs-effective range, status, attempts and file at a glance.
//
// `buildReportRows` is PURE (no fs, no ExcelJS), so the exact rows are proven
// offline by `npm run test:report`. `writeRunReport` is the thin ExcelJS shell
// (ExcelJS is already a dependency, used by save-validate/effective-range).
//
// Columns follow the PRD §31 table (Country · Requested · Effective · Status ·
// File · Attempts) and append two ALREADY-COMPUTED audit columns — Range status
// and Error — read straight off the batch outcomes. Nothing is invented; every
// value comes from a field the batch already produced.
// ---------------------------------------------------------------------------

export interface ReportRow {
  country: string;
  requested: string;
  effective: string;
  rangeStatus: string;
  status: string; // title-cased for humans: Success / Skipped / Failed
  attempts: number;
  file: string;
  error: string;
}

/** Placeholder for a cell with no value (e.g. a FAILED country has no effective range). */
const DASH = '—';

/** "SUCCESS" → "Success" (matches the PRD §31 example table's capitalisation). */
const titleCase = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);

/**
 * PURE: batch outcomes → report rows, in INPUT ORDER (AC-11 — order preserved).
 * `requestedRange` is the immutable GLOBAL range (the same for every country);
 * it is passed in rather than read off an outcome because CountryOutcome does
 * not carry it (only the manifest entry does).
 */
export function buildReportRows(summary: BatchSummary, requestedRange: string): ReportRow[] {
  return summary.outcomes.map((o: CountryOutcome) => ({
    country: o.country,
    requested: requestedRange,
    effective: o.effectiveRange ?? DASH,
    rangeStatus: o.rangeStatus ?? DASH,
    status: titleCase(o.status),
    attempts: o.attempts,
    file: o.file ?? o.targetPath ?? DASH,
    error: o.error ?? '',
  }));
}

/** Extra context for the report footer — never affects the data table. */
export interface RunReportMeta {
  generatedAt: string; // ISO timestamp (injected so callers control it)
  sessionExpired?: boolean; // the run paused/stopped on session expiry (§28/AC-08)
  abortReason?: string; // present when the run aborted (session expiry or fatal)
}

/**
 * Write the run report to `filePath` as an .xlsx. Header row is row 1 (bold,
 * frozen); one data row per country follows in order; a small metadata + totals
 * footer sits two rows below the table. Creates the parent directory if needed.
 * Best-effort by contract: the CALLER wraps this so a write failure never masks
 * the actual run result (like the manifest write).
 */
export async function writeRunReport(
  filePath: string,
  summary: BatchSummary,
  requestedRange: string,
  meta: RunReportMeta,
): Promise<void> {
  const rows = buildReportRows(summary, requestedRange);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Trade Map Automated Export System';
  const ws = wb.addWorksheet('Run Report');

  ws.columns = [
    { header: 'Country', key: 'country', width: 26 },
    { header: 'Requested', key: 'requested', width: 16 },
    { header: 'Effective', key: 'effective', width: 16 },
    { header: 'Range status', key: 'rangeStatus', width: 24 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Attempts', key: 'attempts', width: 9 },
    { header: 'File', key: 'file', width: 60 },
    { header: 'Error', key: 'error', width: 50 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  for (const r of rows) ws.addRow(r);

  // Footer: a blank spacer row, then run metadata + totals (plain text cells in
  // column A so they never collide with the typed data columns above).
  const footStart = ws.rowCount + 2;
  const meta1 = ws.getCell(`A${footStart}`);
  meta1.value = `Run ${summary.runId} · generated ${meta.generatedAt}`;
  meta1.font = { italic: true };

  const totals = ws.getCell(`A${footStart + 1}`);
  totals.value =
    `Total ${summary.total} · Success ${summary.success} · Skipped ${summary.skipped} · ` +
    `Failed ${summary.failed}` +
    (summary.aborted ? ` · ABORTED (exit ${summary.exitCode})` : ` · exit ${summary.exitCode}`);
  totals.font = { bold: true };

  if (meta.sessionExpired) {
    const note = ws.getCell(`A${footStart + 2}`);
    note.value = `SESSION EXPIRED — re-login and rerun the same command to resume. ${meta.abortReason ?? ''}`.trim();
    note.font = { bold: true };
  }

  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  await wb.xlsx.writeFile(filePath);
}
