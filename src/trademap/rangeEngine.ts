// ---------------------------------------------------------------------------
// Range Engine (PRD §14 "MAX_WITHIN_REQUESTED_RANGE", §16, §39).
//
// THE CORE RISK OF THE WHOLE PROJECT lives here (convention #2, DECISIONS
// 2026-08-17): `requestedRange` is GLOBAL and immutable; `effectiveRange` is
// per-country and must NEVER feed the next country's request. This module is
// deliberately PURE (no Playwright `Page`, no I/O) so the isolation logic can be
// proven deterministically offline — see the `test:isolation` harness. The
// browser-facing DOM readout is passed IN; the decision is made here.
// ---------------------------------------------------------------------------

/** The per-country date window Trade Map actually served (PRD §4B, §16). */
export interface EffectiveRange {
  start: string; // YYYYMM
  end: string; // YYYYMM
  status: 'FULL_RANGE' | 'CLIPPED_BY_AVAILABILITY';
}

/** The GLOBAL requested window — immutable for the whole run (PRD §4A). */
export interface RequestedRange {
  requestedStart: string; // YYYYMM
  requestedEnd: string; // YYYYMM
}

/** A raw start/end month readout (from the DOM or a URL segment). */
export interface RangeReadout {
  start: string; // YYYYMM
  end: string; // YYYYMM
}

/** True iff `s` is a 6-digit YYYYMM with month 01–12 (sanity, not a business rule). */
export function isYyyymm(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{6}$/.test(s)) return false;
  const month = Number(s.slice(4, 6));
  return month >= 1 && month <= 12;
}

/** Read a "NNNNNN-NNNNNN" month range out of a string (e.g. a URL), if present. */
export function parseRange(text: string): RangeReadout | null {
  const m = text.match(/(\d{6})-(\d{6})/);
  if (!m) return null;
  if (!isYyyymm(m[1]) || !isYyyymm(m[2])) return null;
  return { start: m[1], end: m[2] };
}

/**
 * Read the EFFECTIVE served range from Trade Map's data-table month columns. Each
 * month header cell carries a `mat-column-YYYYMM` class (calibrated live 2026-08-17
 * against the real Angular-Material DOM); the served window is the min→max of those
 * month tokens. PURE, so it is proven offline against captured header classes.
 * Returns null when no month column is found (→ a loud DATE_ERROR upstream).
 */
export function rangeFromColumnClasses(classAttrs: string[]): RangeReadout | null {
  const months = new Set<string>();
  for (const cls of classAttrs) {
    const re = /mat-column-(\d{6})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(cls)) !== null) {
      if (isYyyymm(m[1])) months.add(m[1]);
    }
  }
  if (months.size === 0) return null;
  const sorted = [...months].sort(); // YYYYMM is zero-padded & fixed-width → lexical == chronological
  return { start: sorted[0], end: sorted[sorted.length - 1] };
}

/** True iff `readout` is a non-empty sub-window of (or equal to) the global range. */
export function isWithinRequested(global: RequestedRange, readout: RangeReadout): boolean {
  return (
    isYyyymm(readout.start) &&
    isYyyymm(readout.end) &&
    readout.start <= readout.end &&
    readout.start >= global.requestedStart &&
    readout.end <= global.requestedEnd
  );
}

/**
 * Decide the effective range for ONE country from the GLOBAL requested range and
 * whatever Trade Map actually served (`domReadout`). PURE and stateless: the only
 * inputs are this country's own readout and the immutable global range, so there
 * is structurally no channel for a previous country's effective range to leak in.
 *
 * `global` is read but never mutated. Status is FULL_RANGE only when the served
 * window matches the requested window exactly; any shortfall is
 * CLIPPED_BY_AVAILABILITY (PRD §16). A missing/malformed readout is a hard
 * DATE_ERROR — we never fall back to the requested range and pretend it was full.
 */
export function computeEffectiveRange(
  global: RequestedRange,
  domReadout: RangeReadout | null,
): EffectiveRange {
  if (!isYyyymm(global.requestedStart) || !isYyyymm(global.requestedEnd)) {
    throw new Error(
      `DATE_ERROR: global requested range is not YYYYMM-YYYYMM ` +
        `(got "${global.requestedStart}-${global.requestedEnd}").`,
    );
  }
  if (!domReadout || !isYyyymm(domReadout.start) || !isYyyymm(domReadout.end)) {
    throw new Error(
      'DATE_ERROR: could not read a valid effective range for this country. ' +
        'Calibrate readRangeFromDom() against the live Trade Map range control (Phase 3B); ' +
        'never assume the requested range was served in full.',
    );
  }

  const status: EffectiveRange['status'] =
    domReadout.start === global.requestedStart && domReadout.end === global.requestedEnd
      ? 'FULL_RANGE'
      : 'CLIPPED_BY_AVAILABILITY';

  return { start: domReadout.start, end: domReadout.end, status };
}

/**
 * Choose the trustworthy readout for effective-range detection. The URL segment is
 * fine for a FULL_RANGE country, but a CLIPPED country may keep the *requested*
 * range in its URL (CLAUDE.md gotcha, DECISIONS 2026-08-17) — so the DOM readout,
 * when present, ALWAYS wins. Returns null only when neither source is available,
 * which `computeEffectiveRange` turns into a loud DATE_ERROR.
 */
export function chooseReadout(
  fromDom: RangeReadout | null,
  fromUrl: RangeReadout | null,
): RangeReadout | null {
  return fromDom ?? fromUrl;
}

/**
 * Choose which served-range readout the pre-Save GATE should trust, BY VIEW. The two views
 * write the range differently (both confirmed live) so the trustworthy source differs:
 *
 *  • byPartner (View by = Exporter): the URL LIES — it keeps the *requested* range and pads
 *    unavailable months with 0 (CLAUDE.md gotcha, DECISIONS 2026-08-17). Only the DOM table
 *    tells the truth, so use the DOM readout and nothing else.
 *  • byProduct (View by = Product): the URL is CLAMPED to the real availability window
 *    (confirmed live 2026-08-19: requested 200001-202606 → served 200704-202605 in the URL,
 *    matching the Time-range control), AND the product table (esp. NTL, ~thousands of rows ×
 *    all months) is frequently too heavy to render — so the URL is the trustworthy source and
 *    the DOM is only a fallback.
 *
 * PURE, so the per-view policy is proven offline (test:isolation). Returns null only when the
 * chosen source(s) are unavailable, which the gate turns into a QUERY_INVALID (never a Save).
 */
export function chooseGateRange(
  viewBy: string,
  fromDom: RangeReadout | null,
  fromUrl: RangeReadout | null,
): RangeReadout | null {
  return (viewBy || '').trim().toLowerCase() === 'product' ? (fromUrl ?? fromDom) : fromDom;
}
