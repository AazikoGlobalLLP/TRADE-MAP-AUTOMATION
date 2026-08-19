import { Page } from 'playwright';
import { FiltersConfig } from '../config/schema';

// ---------------------------------------------------------------------------
// Filter Carryover Protection — the `ensure*` pattern (PRD §40, convention #4).
//
// Changing the importer NEVER guarantees the other filters kept correct values.
// After every country switch we re-verify ALL locked filters: read the current
// value, and change it ONLY if wrong. We never assume carryover is correct — an
// unreadable filter is a hard error, not a silent pass.
//
// The pure comparison (`filterMismatches`) is browser-free and unit-tested. The
// DOM read/write shell (`readCurrentFilters`, `applyFilter`) is structured but
// UNCALIBRATED — pin the selectors + label normalisation against the live DOM in
// Phase 3B (same rule as readRangeFromDom / the resolver UI).
// ---------------------------------------------------------------------------

/**
 * The 8 non-range filters that must be re-verified after each country switch
 * (PRD §40). `range` is the 9th ensure and is checked separately because it is
 * compared against the immutable GLOBAL range, not a config constant.
 */
export const LOCKED_FILTER_KEYS = [
  'tradeFlow',
  'exporter',
  'product',
  'viewBy',
  'frequency',
  'source',
  'dataType',
  'currency',
] as const;

export type LockedFilterKey = (typeof LOCKED_FILTER_KEYS)[number];

/** Expected value per locked filter, in OUR internal vocabulary (config words). */
export type FilterSet = Record<LockedFilterKey, string>;

/** What we actually read back from the page (a key may be unreadable → undefined). */
export type FilterReadout = Partial<Record<LockedFilterKey, string>>;

/**
 * The expected filter values for the locked query, taken straight from config so
 * nothing is hardcoded in business logic (convention #3). Comparison is
 * case-insensitive/trimmed, so a live reader that returns "Imports" still matches
 * the config's "imports".
 */
export function expectedFilters(filters: FiltersConfig): FilterSet {
  return {
    tradeFlow: filters.tradeFlow,
    exporter: filters.exporter,
    product: filters.product,
    viewBy: filters.viewBy,
    frequency: filters.frequency,
    source: filters.source,
    dataType: filters.dataType,
    currency: filters.currency,
  };
}

/** Normalise a filter value for comparison (trim + lower-case). */
function norm(v: string): string {
  return v.trim().toLowerCase();
}

// Reverse of driver.ts's forward maps: Trade Map URL token → our config vocabulary.
const FREQ_FROM_URL: Record<string, string> = { month: 'monthly', quarter: 'quarterly', year: 'yearly' };
const VIEWBY_FROM_URL: Record<string, string> = { bypartner: 'exporter', byproduct: 'product' };

/**
 * PURE. Read the locked filters back from Trade Map's canonical URL — the deterministic
 * source of truth (PRD §6, convention #1). Calibrated live 2026-08-17: Trade Map's filters
 * are Angular-Material components (no native `<select>`), so the URL, not the DOM, is the
 * reliable read. Structure (from buildCanonicalUrl):
 *   .../time-series/{flow}/c/{importer}/c/{exporter}/p/{product}/{viewBy}/{freq}/{range}/{source}/{dataType}/{currency}/{view}
 * Any segment we cannot read is left undefined → counted as a mismatch (fail loud).
 */
export function parseFiltersFromUrl(url: string, filters: FiltersConfig): FilterReadout {
  const readout: FilterReadout = {};
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }
  const segs = pathname.split('/').filter(Boolean);
  const ts = segs.indexOf('time-series');
  if (ts < 0) return readout; // unknown structure → all undefined → mismatches
  const r = segs.slice(ts + 1);

  let i = 0;
  const flow = r[i++];
  if (r[i] === 'c') i++; // 'c' marker
  i++; // importer code — not a locked filter, skip it
  let exporterCode: string | undefined;
  if (r[i] === 'c') {
    i++;
    exporterCode = r[i++];
  }
  let product: string | undefined;
  if (r[i] === 'p') {
    i++;
    product = r[i++];
  }
  const viewBy = r[i++];
  const freq = r[i++];
  i++; // range segment (verified separately against the served columns)
  // byProduct inserts an extra {detail} segment between range and source (Phase 9, spec row 21);
  // skip it so source/dataType/currency read from the correct positions. byPartner has no such segment.
  if (viewBy !== undefined && viewBy.toLowerCase() === 'byproduct') i++;
  const source = r[i++];
  const dataType = r[i++];
  const currency = r[i++];

  if (flow) readout.tradeFlow = flow;
  if (exporterCode !== undefined) {
    // Represent World by its config word when the code matches, so it compares equal to "world".
    readout.exporter = exporterCode === filters.exporterCode ? filters.exporter : exporterCode;
  }
  if (product !== undefined) readout.product = product;
  if (viewBy !== undefined) readout.viewBy = VIEWBY_FROM_URL[viewBy.toLowerCase()] ?? viewBy;
  if (freq !== undefined) readout.frequency = FREQ_FROM_URL[freq.toLowerCase()] ?? freq;
  if (source !== undefined) readout.source = source;
  if (dataType !== undefined) readout.dataType = dataType;
  if (currency !== undefined) readout.currency = currency;

  return readout;
}

/**
 * PURE, browser-free. Compare the expected filter set against what was read back
 * and return one human-readable message per mismatch (empty array = all correct).
 * An unreadable filter (undefined in `actual`) counts as a mismatch — we never
 * treat "couldn't read it" as "it's fine".
 */
export function filterMismatches(expected: FilterSet, actual: FilterReadout): string[] {
  const problems: string[] = [];
  for (const key of LOCKED_FILTER_KEYS) {
    const want = expected[key];
    const got = actual[key];
    if (got === undefined) {
      problems.push(`${key}: could not read current value (expected "${want}")`);
      continue;
    }
    if (norm(got) !== norm(want)) {
      problems.push(`${key}: is "${got}", expected "${want}"`);
    }
  }
  return problems;
}

/** Matches the structured logger created in index.ts (structural typing). */
type Logger = (level: 'info' | 'warn' | 'error', event: string, data?: Record<string, unknown>) => void;

/**
 * Run the §40 `ensure*` sweep after a country switch: read every locked filter,
 * correct only the wrong ones (logging `filter.corrected`), then confirm all are
 * right. Throws `FILTER_UNREADABLE` / `FILTER_UNCORRECTABLE` rather than proceed
 * on a filter it cannot verify — a wrong filter must never reach Save.
 *
 * The range is verified separately by verifyQuery against the GLOBAL range.
 */
export async function ensureAllFilters(page: Page, filters: FiltersConfig, log: Logger): Promise<void> {
  const expected = expectedFilters(filters);

  const before = await readCurrentFilters(page, filters);
  const initialProblems = filterMismatches(expected, before);
  if (initialProblems.length === 0) {
    log('info', 'filters.ok', { checked: LOCKED_FILTER_KEYS.length });
    return;
  }

  // Correct only the wrong ones (the `ensure` contract: change iff incorrect).
  for (const key of LOCKED_FILTER_KEYS) {
    const want = expected[key];
    const got = before[key];
    if (got === undefined) {
      throw new Error(
        `FILTER_UNREADABLE: could not read "${key}" to verify carryover. ` +
          `Calibrate readCurrentFilters() in filters.ts against the live DOM (Phase 3B).`,
      );
    }
    if (norm(got) !== norm(want)) {
      log('warn', 'filter.corrected', { filter: key, was: got, now: want });
      await applyFilter(page, key, want);
    }
  }

  // Re-verify: after correction, everything must read back clean or we refuse.
  const after = await readCurrentFilters(page, filters);
  const remaining = filterMismatches(expected, after);
  if (remaining.length > 0) {
    throw new Error(`FILTER_UNCORRECTABLE: ${remaining.join('; ')}`);
  }
  log('info', 'filters.ok', { checked: LOCKED_FILTER_KEYS.length, corrected: true });
}

/**
 * Read the current value of every locked filter. CALIBRATED 2026-08-17: Trade Map's
 * filters are Angular-Material components with no native `<select>`, so we read the
 * deterministic canonical URL (which encodes the full query) rather than fragile DOM
 * controls. A segment that cannot be parsed is left undefined (→ counted as a
 * mismatch), never guessed.
 */
export async function readCurrentFilters(page: Page, filters: FiltersConfig): Promise<FilterReadout> {
  return parseFiltersFromUrl(page.url(), filters);
}

/**
 * "Correct" a drifted filter. Because we drive the query by canonical URL (the PRIMARY,
 * deterministic mechanism, PRD §6), the right correction for any drift is to RE-NAVIGATE
 * the canonical URL — not to poke individual Angular-Material controls. If a mismatch
 * survives the URL navigation it is a genuine anomaly, so this fails loud rather than
 * silently manipulating the DOM.
 */
export async function applyFilter(_page: Page, key: LockedFilterKey, value: string): Promise<void> {
  throw new Error(
    `FILTER_DRIFT: "${key}" is still wrong after canonical-URL navigation (wanted "${value}"). ` +
      `The query URL did not take effect — investigate rather than DOM-poke.`,
  );
}
