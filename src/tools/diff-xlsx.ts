import ExcelJS from 'exceljs';
import * as path from 'path';
import { isYyyymm } from '../trademap/rangeEngine';

// ---------------------------------------------------------------------------
// Workbook DIFF tool (Phase 9 diagnostic, OFFLINE + READ-ONLY).
//
// WHY this exists: the friend's 204-country run left an OPEN question — a manual
// export and the automated export of the same country differ by "~7 rows + 1
// month". Because the byProduct export is SERVER-SIDE, the most likely cause is
// data TIMING (the two files were downloaded at different moments), but that is
// UNVERIFIED. To confirm or deny it you must diff the two actual workbooks.
//
// This turns that check into ONE command:
//     npm run diff-xlsx -- "path\to\manual.xlsx" "path\to\automated.xlsx"
//
// It NEVER opens a browser, NEVER touches Trade Map, NEVER writes any file — it
// only READS the two workbooks and prints a plain-language comparison:
//   - row count delta (and WHICH product/tariff codes are extra or missing)
//   - month-column span delta (which months one file has that the other lacks)
//   - the effective data range (first→last non-zero month) of each file
//   - among the shared codes+months, how many cells actually differ (+ examples)
//
// It reuses the SAME month-column detection as readEffectiveRangeFromWorkbook
// (`src/files/effective-range.ts`): a header cell like "202606 (USD Thousand)"
// is a month column when it STARTS with a valid YYYYMM token. Everything to the
// LEFT of the first month column is treated as the row's label/code (its identity).
// ---------------------------------------------------------------------------

/** Coerce any exceljs cell value to a number, or NaN. Handles formula cells `{result}`. */
function numOf(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return NaN;
    const n = Number(t.replace(/,/g, ''));
    return Number.isFinite(n) ? n : NaN;
  }
  if (v && typeof v === 'object' && 'result' in (v as Record<string, unknown>)) {
    return numOf((v as Record<string, unknown>).result);
  }
  return NaN;
}

/** A month cell carries real data when it is a non-zero finite number (0 = no data). */
function isData(n: number): boolean {
  return Number.isFinite(n) && n !== 0;
}

interface Sheet {
  file: string;
  monthTokens: string[]; // sorted list of YYYYMM month columns present
  rowsByKey: Map<string, { code: string; label: string; vals: Map<string, number> }>;
  rowCount: number;
  dataRange: { start: string; end: string } | null;
}

/**
 * Read one exported workbook into a comparable shape. Throws a friendly error if
 * the file is not a real Trade Map export (no YYYYMM month-column header found).
 */
async function readSheet(filePath: string): Promise<Sheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error(`No worksheet in "${filePath}".`);

  // Find the header row: the first row (scan the first 12) that has a YYYYMM cell.
  // Real exports sometimes carry a title/blank row before the real header.
  let headerRow = -1;
  let monthCols: Array<{ c: number; month: string }> = [];
  for (let r = 1; r <= Math.min(12, ws.rowCount); r++) {
    const found: Array<{ c: number; month: string }> = [];
    const row = ws.getRow(r);
    for (let c = 1; c <= ws.columnCount; c++) {
      const h = String(row.getCell(c).value ?? '').trim();
      const m = h.match(/^(\d{6})/);
      if (m && isYyyymm(m[1])) found.push({ c, month: m[1] });
    }
    if (found.length > 0) {
      headerRow = r;
      monthCols = found;
      break;
    }
  }
  if (headerRow === -1) {
    throw new Error(
      `No month columns (a "YYYYMM ..." header) found in "${filePath}" — is it a real Trade Map export?`,
    );
  }

  const firstMonthCol = Math.min(...monthCols.map((mc) => mc.c));
  const labelCols: number[] = [];
  for (let c = 1; c < firstMonthCol; c++) labelCols.push(c);

  const rowsByKey = new Map<string, { code: string; label: string; vals: Map<string, number> }>();
  let rowCount = 0;
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const labels = labelCols.map((c) => String(row.getCell(c).value ?? '').trim());
    const key = labels.join(' | ').trim();
    if (key === '' || key.replace(/\|/g, '').trim() === '') continue; // skip blank/footer rows

    const vals = new Map<string, number>();
    for (const mc of monthCols) {
      const n = numOf(row.getCell(mc.c).value);
      if (Number.isFinite(n)) vals.set(mc.month, n);
    }
    rowCount++;
    const code = labels.find((l) => l !== '') ?? key;
    const label = labels.length > 1 ? labels[labels.length - 1] : '';
    if (!rowsByKey.has(key)) rowsByKey.set(key, { code, label, vals });
  }

  // Effective data range = first→last month with any non-zero value across all rows.
  const monthsWithData = new Set<string>();
  for (const { vals } of rowsByKey.values()) {
    for (const [m, n] of vals) if (isData(n)) monthsWithData.add(m);
  }
  const sortedData = [...monthsWithData].sort();
  const dataRange = sortedData.length
    ? { start: sortedData[0], end: sortedData[sortedData.length - 1] }
    : null;

  const monthTokens = monthCols.map((mc) => mc.month).sort();
  return { file: filePath, monthTokens, rowsByKey, rowCount, dataRange };
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function span(tokens: string[]): string {
  if (tokens.length === 0) return '(none)';
  return `${tokens[0]}..${tokens[tokens.length - 1]} (${tokens.length} cols)`;
}

function listCodes(keys: string[], sheet: Sheet, cap = 30): string {
  if (keys.length === 0) return '(none)';
  const codes = keys.map((k) => sheet.rowsByKey.get(k)!.code);
  if (codes.length <= cap) return codes.join(', ');
  return `${codes.slice(0, cap).join(', ')} … and ${fmt(codes.length - cap)} more`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (args.length < 2) {
    console.error('Usage: npm run diff-xlsx -- "<fileA.xlsx>" "<fileB.xlsx>"');
    console.error('  Compares two Trade Map exports and prints what differs.');
    console.error('  Tip: the MANUAL file first, the AUTOMATED file second.');
    process.exit(1);
    return;
  }
  const [aPath, bPath] = args;

  let A: Sheet;
  let B: Sheet;
  try {
    A = await readSheet(aPath);
  } catch (e) {
    console.error(`\nCould not read FILE A ("${aPath}"):\n  ${(e as Error).message}\n`);
    process.exit(2);
    return;
  }
  try {
    B = await readSheet(bPath);
  } catch (e) {
    console.error(`\nCould not read FILE B ("${bPath}"):\n  ${(e as Error).message}\n`);
    process.exit(2);
    return;
  }

  const nameA = path.basename(aPath);
  const nameB = path.basename(bPath);

  // ---- month span comparison ----
  const bMonths = new Set(B.monthTokens);
  const aMonths = new Set(A.monthTokens);
  const monthsOnlyA = A.monthTokens.filter((m) => !bMonths.has(m));
  const monthsOnlyB = B.monthTokens.filter((m) => !aMonths.has(m));
  const sharedMonths = A.monthTokens.filter((m) => bMonths.has(m));

  // ---- code (row identity) comparison ----
  const aKeys = [...A.rowsByKey.keys()];
  const bKeySet = new Set(B.rowsByKey.keys());
  const aKeySet = new Set(aKeys);
  const onlyA = aKeys.filter((k) => !bKeySet.has(k));
  const onlyB = [...bKeySet].filter((k) => !aKeySet.has(k));
  const shared = aKeys.filter((k) => bKeySet.has(k));

  // ---- value diffs among shared codes + shared months ----
  let rowsWithValueDiff = 0;
  const examples: Array<{ code: string; month: string; a: number; b: number }> = [];
  for (const k of shared) {
    const av = A.rowsByKey.get(k)!.vals;
    const bv = B.rowsByKey.get(k)!.vals;
    let firstEx: { month: string; a: number; b: number } | null = null;
    for (const m of sharedMonths) {
      const x = av.get(m) ?? 0;
      const y = bv.get(m) ?? 0;
      if (Math.abs(x - y) > 1e-9) {
        firstEx = { month: m, a: x, b: y };
        break;
      }
    }
    if (firstEx) {
      rowsWithValueDiff++;
      if (examples.length < 10) examples.push({ code: A.rowsByKey.get(k)!.code, ...firstEx });
    }
  }

  // ---- report ----
  const line = '─'.repeat(72);
  console.log(`\n${line}`);
  console.log('WORKBOOK DIFF');
  console.log(line);
  console.log(`FILE A: ${nameA}`);
  console.log(`        ${fmt(A.rowCount)} data rows · months ${span(A.monthTokens)} · data ${A.dataRange ? `${A.dataRange.start}..${A.dataRange.end}` : '(none)'}`);
  console.log(`FILE B: ${nameB}`);
  console.log(`        ${fmt(B.rowCount)} data rows · months ${span(B.monthTokens)} · data ${B.dataRange ? `${B.dataRange.start}..${B.dataRange.end}` : '(none)'}`);
  console.log(line);

  // Rows
  const rowDelta = A.rowCount - B.rowCount;
  if (rowDelta === 0) {
    console.log(`ROWS:    same count (${fmt(A.rowCount)}).`);
  } else if (rowDelta > 0) {
    console.log(`ROWS:    A has ${fmt(rowDelta)} MORE row(s) than B   (A=${fmt(A.rowCount)}, B=${fmt(B.rowCount)}).`);
  } else {
    console.log(`ROWS:    B has ${fmt(-rowDelta)} MORE row(s) than A   (A=${fmt(A.rowCount)}, B=${fmt(B.rowCount)}).`);
  }
  console.log(`         codes only in A (${fmt(onlyA.length)}): ${listCodes(onlyA, A)}`);
  console.log(`         codes only in B (${fmt(onlyB.length)}): ${listCodes(onlyB, B)}`);

  // Months
  if (monthsOnlyA.length === 0 && monthsOnlyB.length === 0) {
    console.log(`MONTHS:  same ${fmt(A.monthTokens.length)} month columns.`);
  } else {
    console.log(`MONTHS:  months in A but not B (${fmt(monthsOnlyA.length)}): ${monthsOnlyA.join(', ') || '(none)'}`);
    console.log(`         months in B but not A (${fmt(monthsOnlyB.length)}): ${monthsOnlyB.join(', ') || '(none)'}`);
  }

  // Values
  console.log(`VALUES:  ${fmt(shared.length)} shared codes compared over ${fmt(sharedMonths.length)} shared months.`);
  if (rowsWithValueDiff === 0) {
    console.log(`         no differing values.`);
  } else {
    console.log(`         ${fmt(rowsWithValueDiff)} code(s) have at least one differing monthly value. Examples:`);
    for (const ex of examples) {
      console.log(`           code ${ex.code} @ ${ex.month}:  A=${fmt(ex.a)}  B=${fmt(ex.b)}`);
    }
  }

  console.log(line);
  const identical =
    rowDelta === 0 &&
    onlyA.length === 0 &&
    onlyB.length === 0 &&
    monthsOnlyA.length === 0 &&
    monthsOnlyB.length === 0 &&
    rowsWithValueDiff === 0;
  console.log(
    identical
      ? 'VERDICT: the two files hold the SAME data.'
      : 'VERDICT: the files DIFFER (see above). If only the newest month and a few codes differ, the most likely cause is DATA TIMING — the files were downloaded at different moments.',
  );
  console.log(`${line}\n`);
}

main().catch((e) => {
  console.error(`diff-xlsx failed: ${(e as Error).message}`);
  process.exit(1);
});
