import ExcelJS from 'exceljs';
import { RangeReadout, isYyyymm } from '../trademap/rangeEngine';

// ---------------------------------------------------------------------------
// Effective range from the DOWNLOADED FILE (PRD §16, §19).
//
// Calibrated 2026-08-17: the new Trade Map beta does NOT clip columns — it renders
// every month of the REQUESTED range and pads months a country lacks with 0. So the
// DOM/URL column span is always the requested range and cannot tell us availability.
// The truthful effective range is therefore read from the exported workbook itself:
// the first→last month that carries actual (non-zero) data across any row.
//
// The decision logic (`dataMonthsRange`) is PURE and unit-tested; the workbook
// reader extracts month columns + their values and delegates to it.
// ---------------------------------------------------------------------------

/** A cell counts as real data if it is a non-zero finite number (0 = month with no data). */
function isDataValue(v: number | string | null | undefined): boolean {
  if (typeof v === 'number') return Number.isFinite(v) && v !== 0;
  if (typeof v === 'string') {
    const n = Number(v.trim());
    return v.trim() !== '' && Number.isFinite(n) && n !== 0;
  }
  return false;
}

/**
 * PURE. Given each month column and all its row values, return the first→last month
 * that carries data (min/max of months with any non-zero value), or null if none.
 */
export function dataMonthsRange(
  columns: Array<{ month: string; values: Array<number | string | null | undefined> }>,
): RangeReadout | null {
  const withData: string[] = [];
  for (const col of columns) {
    if (!isYyyymm(col.month)) continue;
    if (col.values.some(isDataValue)) withData.push(col.month);
  }
  if (withData.length === 0) return null;
  withData.sort(); // YYYYMM fixed-width → lexical == chronological
  return { start: withData[0], end: withData[withData.length - 1] };
}

/**
 * Read the effective (data-bearing) month range from an exported Trade Map workbook.
 * Opens the file (exceljs throws if it is not a real workbook — e.g. an HTML error
 * page), collects the `YYYYMM …` month columns and every row's value, and returns the
 * first→last month with actual data. Returns null when the file has no month data.
 */
export async function readEffectiveRangeFromWorkbook(filePath: string): Promise<RangeReadout | null> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  if (!ws) return null;

  // Identify month columns from the header row (headers look like "202606 (USD Thousand)").
  const header = ws.getRow(1);
  const monthCols: Array<{ c: number; month: string }> = [];
  for (let c = 1; c <= ws.columnCount; c++) {
    const h = String(header.getCell(c).value ?? '').trim();
    const m = h.match(/^(\d{6})/);
    if (m && isYyyymm(m[1])) monthCols.push({ c, month: m[1] });
  }
  if (monthCols.length === 0) return null;

  // Collect each month column's values across all data rows (row 1 is the header).
  const columns = monthCols.map((mc) => ({ month: mc.month, values: [] as Array<number | string | null | undefined> }));
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    for (let i = 0; i < monthCols.length; i++) {
      const v = row.getCell(monthCols[i].c).value;
      columns[i].values.push(typeof v === 'number' || typeof v === 'string' ? v : null);
    }
  }

  return dataMonthsRange(columns);
}
