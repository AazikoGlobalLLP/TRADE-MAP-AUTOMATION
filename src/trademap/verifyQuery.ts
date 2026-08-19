import { Page } from 'playwright';
import { FiltersConfig } from '../config/schema';
import {
  FilterSet,
  FilterReadout,
  expectedFilters,
  filterMismatches,
  readCurrentFilters,
} from './filters';
import { readHeadingCandidates, readShownRange } from './driver';
import { RangeReadout, isWithinRequested, parseRange, chooseGateRange } from './rangeEngine';

// ---------------------------------------------------------------------------
// Query Validation Gate (PRD §42, convention #5): NEVER click Save unless the
// heading names the current importer AND every locked filter reads back correct
// AND the range the query will export is a valid window WITHIN the immutable GLOBAL
// requested range. Any single mismatch blocks Save — a wrong query must never
// produce a (wrongly-named) file.
//
// Range semantics (calibrated 2026-08-17): the served window may legitimately be
// CLIPPED to a country's availability, so the gate accepts any non-empty subset of
// the global range and blocks only a window that falls OUTSIDE it (a sign of stale
// or carried-over state). The strong isolation guarantee lives upstream (the URL is
// always built from the frozen global range) and in computeEffectiveRange.
//
// The gate LOGIC (`assertQueryValid`) is PURE and browser-free, so "one wrong
// field ⇒ blocked" is proven deterministically offline. The page-reading wrapper
// (`verifyQuery`) fills an ActualQuery from the calibrated readers and applies it.
// ---------------------------------------------------------------------------

/** What the query MUST be before Save. `range` is the GLOBAL requested range. */
export interface ExpectedQuery {
  importer: string; // country name that must appear in the heading
  filters: FilterSet; // locked filter values, in config vocabulary
  range: { start: string; end: string }; // the immutable GLOBAL requested range
}

/** What was actually read back off the page (any field may be unreadable). */
export interface ActualQuery {
  headingText: string; // concatenated heading/title text
  filters: FilterReadout; // filter values read back (missing key = unreadable)
  range: RangeReadout | null; // the range the query will export (served/shown window)
}

/**
 * PURE gate. Collect EVERY problem (heading, each filter, range) and throw a
 * single `QUERY_INVALID: <all problems>` if any exist. Reporting all at once
 * makes a live mis-calibration one fix instead of a whack-a-mole. Passes silently
 * only when heading, all 8 filters, and the range are correct.
 */
export function assertQueryValid(expected: ExpectedQuery, actual: ActualQuery): void {
  const problems: string[] = [];

  // Heading must name the importer (PRD §42).
  if (!actual.headingText || !actual.headingText.toLowerCase().includes(expected.importer.toLowerCase())) {
    problems.push(
      `heading does not name "${expected.importer}" (saw "${(actual.headingText || '').slice(0, 120)}")`,
    );
  }

  // Every locked filter must read back correct (PRD §40).
  problems.push(...filterMismatches(expected.filters, actual.filters));

  // The window the query will export must be a non-empty subset of the GLOBAL range.
  // A CLIPPED window is fine; a window OUTSIDE the global range means stale/carried state.
  const global = { requestedStart: expected.range.start, requestedEnd: expected.range.end };
  if (!actual.range) {
    problems.push(`range: could not read the served window (expected within ${expected.range.start}-${expected.range.end})`);
  } else if (!isWithinRequested(global, actual.range)) {
    problems.push(
      `range: served window ${actual.range.start}-${actual.range.end} is outside the requested ${expected.range.start}-${expected.range.end}`,
    );
  }

  if (problems.length > 0) {
    throw new Error(`QUERY_INVALID: ${problems.join('; ')}`);
  }
}

/** Matches the structured logger created in index.ts (structural typing). */
type Logger = (level: 'info' | 'warn' | 'error', event: string, data?: Record<string, unknown>) => void;

/**
 * Read the live query state and apply the gate. Called AFTER ensureAllFilters and
 * BEFORE any Save. Throws `QUERY_INVALID:` (or a reader's own error) on any
 * mismatch — the caller never reaches Save on throw.
 */
export async function verifyQuery(
  page: Page,
  importer: string,
  filters: FiltersConfig,
  requestedRange: { start: string; end: string },
  log: Logger,
): Promise<void> {
  const actual: ActualQuery = {
    headingText: await readHeadingCandidates(page),
    filters: await readCurrentFilters(page, filters),
    // By-view range source (chooseGateRange): byPartner trusts the DOM table (its URL lies);
    // byProduct trusts the URL (it clamps to real availability and the heavy product table often
    // does not render). Confirmed live 2026-08-19 — see chooseGateRange.
    range: chooseGateRange(filters.viewBy, await readShownRange(page), parseRange(page.url())),
  };
  assertQueryValid({ importer, filters: expectedFilters(filters), range: requestedRange }, actual);
  log('info', 'query.verified', { importer, requestedRange: `${requestedRange.start}-${requestedRange.end}` });
}
