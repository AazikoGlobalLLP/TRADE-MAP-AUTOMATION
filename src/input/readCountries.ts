import ExcelJS from 'exceljs';

// ---------------------------------------------------------------------------
// Ordered country-list reader (Phase 4, PRD §35 sequential batch).
//
// The batch's run order IS the row order of column A in `countries.xlsx`. The
// contract is deliberately forgiving of a human-edited file (spec-lock rows 1–2):
//   • read column A only (any extra columns are ignored);
//   • row 1 is treated as a HEADER and skipped iff it reads like one
//     ("Country"/"Countries"/"Name"), otherwise row 1 is data;
//   • blank/whitespace cells, `_`-prefixed metadata, and the reserved word
//     `World` (the exporter constant 000, never an importer) are skipped;
//   • duplicates are dropped case-insensitively, FIRST occurrence wins.
//
// Nothing here is business logic guessing — an unreadable/absent file throws,
// and an empty result is a hard `BATCH_EMPTY` so a no-op run can't pass silently.
// The pure decision core (`normalizeCountryList`) is browser-free + unit-tested
// by `npm run test:batch`; the exceljs shell only extracts column A.
// ---------------------------------------------------------------------------

/** Matches the structured logger created in index.ts (structural typing). */
type Logger = (level: 'info' | 'warn' | 'error', event: string, data?: Record<string, unknown>) => void;

const HEADER_WORDS = new Set(['country', 'countries', 'name']);
const RESERVED = new Set(['world']); // the World exporter constant (000) is never an importer target

const noopLog: Logger = () => undefined;

/**
 * PURE. Turn the raw column-A cell strings (top-to-bottom) into the ordered,
 * de-duplicated country list actually run. Skips a leading header row, blanks,
 * `_`-metadata, `World`, and case-insensitive duplicates (first wins). Logs each
 * skip so an edited file's surprises are visible, never silent.
 */
export function normalizeCountryList(rawCells: Array<string | null | undefined>, log: Logger = noopLog): string[] {
  const cells = rawCells.map((c) => (typeof c === 'string' ? c.trim() : ''));

  // Drop a leading header row iff the first non-empty cell reads like a header.
  let start = 0;
  const firstNonEmpty = cells.findIndex((c) => c !== '');
  if (firstNonEmpty >= 0 && HEADER_WORDS.has(cells[firstNonEmpty].toLowerCase())) {
    start = firstNonEmpty + 1;
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = start; i < cells.length; i++) {
    const name = cells[i];
    if (name === '') continue; // blank/whitespace row
    if (name.startsWith('_')) {
      log('info', 'country.reserved_skipped', { name, reason: 'metadata' });
      continue;
    }
    const key = name.toLowerCase();
    if (RESERVED.has(key)) {
      log('info', 'country.reserved_skipped', { name, reason: 'exporter constant, not an importer' });
      continue;
    }
    if (seen.has(key)) {
      log('info', 'country.duplicate_skipped', { name });
      continue;
    }
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Read the ordered country list from `filePath` (an .xlsx). Extracts column A of
 * sheet 1 top-to-bottom, then delegates to `normalizeCountryList`. Throws
 * `BATCH_INPUT_MISSING` if the workbook has no sheet, and `BATCH_EMPTY` if no
 * country survives normalisation — never returns an empty list silently.
 */
export async function readCountries(filePath: string, log: Logger = noopLog): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath); // exceljs throws if the file is missing / not a real workbook
  const ws = wb.worksheets[0];
  if (!ws) {
    throw new Error(`BATCH_INPUT_MISSING: "${filePath}" has no worksheet to read the country list from.`);
  }

  const rawCells: Array<string | null | undefined> = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const v = ws.getRow(r).getCell(1).value; // column A
    rawCells.push(v == null ? '' : String(v));
  }

  const countries = normalizeCountryList(rawCells, log);
  if (countries.length === 0) {
    throw new Error(`BATCH_EMPTY: "${filePath}" yielded no country names in column A.`);
  }
  log('info', 'batch.input_loaded', { file: filePath, count: countries.length, order: countries });
  return countries;
}
