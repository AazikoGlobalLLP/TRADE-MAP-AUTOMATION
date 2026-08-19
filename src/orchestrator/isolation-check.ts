import { strict as assert } from 'node:assert';
import {
  computeEffectiveRange,
  chooseReadout,
  rangeFromColumnClasses,
  RequestedRange,
  RangeReadout,
} from '../trademap/rangeEngine';
import { assertQueryValid, ExpectedQuery, ActualQuery } from '../trademap/verifyQuery';
import { expectedFilters, filterMismatches, parseFiltersFromUrl } from '../trademap/filters';
import { buildCanonicalUrl, resolveDetailUrlToken } from '../trademap/driver';
import { dataMonthsRange } from '../files/effective-range';
import { FiltersConfig } from '../config/schema';

// ---------------------------------------------------------------------------
// Isolation harness (Phase 3A demo). Proves the CORE RISK deterministically with
// ZERO browser: the GLOBAL requested range is immutable and a clipped country's
// effective range NEVER bleeds into the next country's request (PRD §39,
// convention #2). Run: `npm run test:isolation`. Exits non-zero on any failure.
// ---------------------------------------------------------------------------

let passed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  PASS  ${name}\n`);
  } catch (e) {
    failures.push(`${name}: ${(e as Error).message}`);
    process.stdout.write(`  FAIL  ${name}\n`);
  }
}

// The immutable GLOBAL requested range for the whole run (PRD §4A). Frozen so a
// buggy country job physically cannot write a clipped value back into it.
const GLOBAL: RequestedRange = Object.freeze({ requestedStart: '200001', requestedEnd: '202606' });

// The §39 acceptance scenario. Each country's SERVED window is what Trade Map
// returns for THAT country — fed in independently, exactly as the live DOM readout
// would be. Pakistan is clipped; India and China are full.
const SCENARIO: Array<{ country: string; served: RangeReadout; expectStatus: string }> = [
  { country: 'India', served: { start: '200001', end: '202606' }, expectStatus: 'FULL_RANGE' },
  { country: 'Pakistan', served: { start: '202401', end: '202606' }, expectStatus: 'CLIPPED_BY_AVAILABILITY' },
  { country: 'China', served: { start: '200001', end: '202606' }, expectStatus: 'FULL_RANGE' },
];

process.stdout.write('\nRange isolation (India → Pakistan → China):\n');

// Drive the full sequence. The isolation guarantee: every call reads the SAME
// frozen GLOBAL — Pakistan's clip has no channel to reach China's request.
const results: Record<string, { start: string; end: string; status: string }> = {};
for (const step of SCENARIO) {
  check(`${step.country}: requested input is the frozen GLOBAL 200001-202606`, () => {
    assert.equal(GLOBAL.requestedStart, '200001', 'GLOBAL start drifted mid-run');
    assert.equal(GLOBAL.requestedEnd, '202606', 'GLOBAL end drifted mid-run');
  });

  const eff = computeEffectiveRange(GLOBAL, step.served);
  results[step.country] = { start: eff.start, end: eff.end, status: eff.status };

  check(`${step.country}: status = ${step.expectStatus}`, () => {
    assert.equal(eff.status, step.expectStatus);
  });
}

check('India effective = 200001-202606', () => {
  assert.deepEqual(results.India, { start: '200001', end: '202606', status: 'FULL_RANGE' });
});

check('Pakistan effective = 202401-202606 (CLIPPED)', () => {
  assert.deepEqual(results.Pakistan, { start: '202401', end: '202606', status: 'CLIPPED_BY_AVAILABILITY' });
});

// THE critical assertion (PRD §39): China must NOT inherit Pakistan's 202401.
check('China effective = 200001-202606, did NOT inherit Pakistan 202401', () => {
  assert.equal(results.China.start, '200001', 'China start bled from Pakistan');
  assert.notEqual(results.China.start, '202401', 'China inherited Pakistan clip — ISOLATION BROKEN');
  assert.equal(results.China.end, '202606');
});

check('GLOBAL requested range is frozen (mutation throws)', () => {
  assert.throws(() => {
    (GLOBAL as unknown as { requestedStart: string }).requestedStart = '202401';
  }, /Cannot assign|read only|read-only/i);
});

process.stdout.write('\nEffective-range detection:\n');

check('null readout → DATE_ERROR (never assumes full range)', () => {
  assert.throws(() => computeEffectiveRange(GLOBAL, null), /DATE_ERROR/);
});

check('clipped DOM readout wins over a full-range URL', () => {
  const fromUrl: RangeReadout = { start: '200001', end: '202606' }; // clipped country's URL can lie
  const fromDom: RangeReadout = { start: '202401', end: '202606' }; // the DOM tells the truth
  const eff = computeEffectiveRange(GLOBAL, chooseReadout(fromDom, fromUrl));
  assert.equal(eff.status, 'CLIPPED_BY_AVAILABILITY');
  assert.equal(eff.start, '202401');
});

process.stdout.write('\nQuery-validation gate (§42):\n');

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
const EXPECTED: ExpectedQuery = {
  importer: 'China',
  filters: expectedFilters(FILTERS),
  range: { start: '200001', end: '202606' },
};
const goodActual: ActualQuery = {
  headingText: "China's imports from World, by exporter (Mirror)",
  filters: expectedFilters(FILTERS),
  range: { start: '200001', end: '202606' },
};

check('valid query passes the gate', () => {
  assertQueryValid(EXPECTED, goodActual);
});

check('wrong heading → QUERY_INVALID', () => {
  assert.throws(() => assertQueryValid(EXPECTED, { ...goodActual, headingText: "Pakistan's imports from World" }), /QUERY_INVALID/);
});

check('wrong filter (currency) → QUERY_INVALID', () => {
  const filters = { ...expectedFilters(FILTERS), currency: 'EUR' };
  assert.throws(() => assertQueryValid(EXPECTED, { ...goodActual, filters }), /QUERY_INVALID/);
});

check('unreadable filter (missing) → QUERY_INVALID', () => {
  const filters = { ...expectedFilters(FILTERS) };
  delete (filters as { currency?: string }).currency;
  assert.throws(() => assertQueryValid(EXPECTED, { ...goodActual, filters }), /QUERY_INVALID/);
});

check('CLIPPED served window (subset of global) PASSES the gate', () => {
  // A reduced-availability country (e.g. real Pakistan 200801-202512) is legitimate.
  assertQueryValid(EXPECTED, { ...goodActual, range: { start: '200801', end: '202512' } });
});

check('served window starting BEFORE global → QUERY_INVALID', () => {
  assert.throws(() => assertQueryValid(EXPECTED, { ...goodActual, range: { start: '199501', end: '202606' } }), /QUERY_INVALID/);
});

check('served window ending AFTER global → QUERY_INVALID', () => {
  assert.throws(() => assertQueryValid(EXPECTED, { ...goodActual, range: { start: '200001', end: '203012' } }), /QUERY_INVALID/);
});

check('inverted served window (start > end) → QUERY_INVALID', () => {
  assert.throws(() => assertQueryValid(EXPECTED, { ...goodActual, range: { start: '202606', end: '200001' } }), /QUERY_INVALID/);
});

check('unreadable range (null) → QUERY_INVALID', () => {
  assert.throws(() => assertQueryValid(EXPECTED, { ...goodActual, range: null }), /QUERY_INVALID/);
});

process.stdout.write('\nLive calibration (real captured Pakistan fixtures, 2026-08-17):\n');

// The exact URL Trade Map served for Pakistan imports (from logs/calibration/pakistan.json).
const REAL_PK_URL =
  'https://www.trademap.org/en/goods/time-series/imports/c/586/c/000/p/ALL/byPartner/month/200801-202512/mirror/values/USD/table';

check('parseFiltersFromUrl(real Pakistan URL) → all 8 locked filters correct', () => {
  const parsed = parseFiltersFromUrl(REAL_PK_URL, FILTERS);
  assert.deepEqual(filterMismatches(expectedFilters(FILTERS), parsed), []);
});

check('parseFiltersFromUrl catches a tampered filter (byProduct instead of byPartner)', () => {
  const wrongUrl = REAL_PK_URL.replace('byPartner', 'byProduct');
  const parsed = parseFiltersFromUrl(wrongUrl, FILTERS);
  assert.notEqual(filterMismatches(expectedFilters(FILTERS), parsed).length, 0);
});

// Real month-column header classes captured from the Pakistan data table.
const REAL_PK_COLUMN_CLASSES = [
  'mat-mdc-header-cell mdc-data-table__header-cell cdk-header-cell col-year cdk-column-200801 mat-column-200801',
  'mat-mdc-header-cell mdc-data-table__header-cell cdk-header-cell col-year cdk-column-201506 mat-column-201506',
  'mat-mdc-header-cell mdc-data-table__header-cell cdk-header-cell col-year cdk-column-202512 mat-column-202512',
];

check('rangeFromColumnClasses(real Pakistan headers) → 200801-202512', () => {
  assert.deepEqual(rangeFromColumnClasses(REAL_PK_COLUMN_CLASSES), { start: '200801', end: '202512' });
});

check('rangeFromColumnClasses(no month columns) → null (→ DATE_ERROR upstream)', () => {
  assert.equal(rangeFromColumnClasses(['mat-mdc-header-cell col-country']), null);
});

check('real Pakistan served window is CLIPPED within global (not FULL)', () => {
  const eff = computeEffectiveRange(GLOBAL, rangeFromColumnClasses(REAL_PK_COLUMN_CLASSES));
  assert.equal(eff.status, 'CLIPPED_BY_AVAILABILITY');
  assert.equal(eff.start, '200801');
  assert.equal(eff.end, '202512');
});

process.stdout.write('\nEffective range from downloaded file (beta pads unavailable months with 0):\n');

check('dataMonthsRange: leading/trailing zeros are excluded (India-like)', () => {
  // Mirrors the real India file: 200001/200002 = 0, real data from 200003.
  const cols = [
    { month: '200001', values: [0, 0] },
    { month: '200002', values: [0] },
    { month: '200003', values: [38, 5] },
    { month: '202605', values: [36954310] },
    { month: '202606', values: [24159431] },
  ];
  assert.deepEqual(dataMonthsRange(cols), { start: '200003', end: '202606' });
});

check('dataMonthsRange: any non-zero row keeps the month; all-zero/empty → null', () => {
  assert.deepEqual(dataMonthsRange([{ month: '201005', values: [0, '', 7] }]), { start: '201005', end: '201005' });
  assert.equal(dataMonthsRange([{ month: '200001', values: [0, 0, ''] }]), null);
});

check('file range 200003-202606 → CLIPPED vs global; 200001-202606 → FULL', () => {
  assert.equal(computeEffectiveRange(GLOBAL, { start: '200003', end: '202606' }).status, 'CLIPPED_BY_AVAILABILITY');
  assert.equal(computeEffectiveRange(GLOBAL, { start: '200001', end: '202606' }).status, 'FULL_RANGE');
});

// ---------------------------------------------------------------------------
process.stdout.write('\nbyProduct URL wiring + Detail token (Phase 9, spec rows 21-22):\n');

// byPartner (View by = Exporter) shape is UNCHANGED — no detail segment (regression guard).
check('buildCanonicalUrl(byPartner) is unchanged — no Detail segment', () => {
  const url = buildCanonicalUrl('https://www.trademap.org', '586', FILTERS, '200801', '202512');
  assert.equal(
    url,
    'https://www.trademap.org/en/goods/time-series/imports/c/586/c/000/p/ALL/byPartner/month/200801-202512/mirror/values/USD/table',
  );
});

// byProduct (View by = Product) INSERTS the Detail token between range and source (row 21).
const PRODUCT_FILTERS: FiltersConfig = { ...FILTERS, tradeFlow: 'exports', viewBy: 'product', source: 'direct', detail: 'HS6' };

check('buildCanonicalUrl(byProduct) inserts the Detail token between range and source', () => {
  const url = buildCanonicalUrl('https://www.trademap.org', '842', PRODUCT_FILTERS, '200001', '202606');
  assert.equal(
    url,
    'https://www.trademap.org/en/goods/time-series/exports/c/842/c/000/p/ALL/byProduct/month/200001-202606/6/direct/values/USD/table',
  );
});

check('parseFiltersFromUrl round-trips a well-formed byProduct URL (detail segment skipped)', () => {
  const url = buildCanonicalUrl('https://www.trademap.org', '842', PRODUCT_FILTERS, '200001', '202606');
  const parsed = parseFiltersFromUrl(url, PRODUCT_FILTERS);
  // source/dataType/currency must read from the RIGHT positions despite the extra {detail} segment.
  assert.deepEqual(filterMismatches(expectedFilters(PRODUCT_FILTERS), parsed), []);
  assert.equal(parsed.viewBy, 'product');
  assert.equal(parsed.source, 'direct'); // NOT the '6' detail token
});

check('resolveDetailUrlToken maps NTL/HS2/HS4/HS6 to real captured tokens; unknown still throws', () => {
  assert.equal(resolveDetailUrlToken('NTL'), '10'); // captured 2026-08-19 from a real India byProduct URL
  assert.equal(resolveDetailUrlToken('ntl'), '10');
  assert.equal(resolveDetailUrlToken('HS2'), '2');
  assert.equal(resolveDetailUrlToken('hs4'), '4');
  assert.equal(resolveDetailUrlToken('HS6'), '6');
  assert.throws(() => resolveDetailUrlToken('HS8'), /DETAIL_TOKEN_UNCAPTURED/); // uncaptured → never invented
});

// GROUND TRUTH: buildCanonicalUrl must reproduce the user's REAL captured byProduct URL byte-for-byte.
check('buildCanonicalUrl reproduces the real India byProduct/NTL URL exactly (token 10)', () => {
  const url = buildCanonicalUrl(
    'https://www.trademap.org',
    '699', // India
    { ...PRODUCT_FILTERS, tradeFlow: 'imports', detail: 'NTL' }, // imports, byProduct, source=direct, freq=monthly
    '200704',
    '202605',
  );
  assert.equal(
    url,
    'https://www.trademap.org/en/goods/time-series/imports/c/699/c/000/p/ALL/byProduct/month/200704-202605/10/direct/values/USD/table',
  );
});

check('buildCanonicalUrl(byProduct, uncaptured Detail) still hard-errors — never invents a token', () => {
  assert.throws(
    () => buildCanonicalUrl('https://www.trademap.org', '842', { ...PRODUCT_FILTERS, detail: 'HS8' }, '200001', '202606'),
    /DETAIL_TOKEN_UNCAPTURED/,
  );
});

check('buildCanonicalUrl(byProduct) with no Detail set → DETAIL_REQUIRED', () => {
  const noDetail: FiltersConfig = { ...PRODUCT_FILTERS, detail: undefined };
  assert.throws(() => buildCanonicalUrl('https://www.trademap.org', '842', noDetail, '200001', '202606'), /DETAIL_REQUIRED/);
});

process.stdout.write(`\nIsolation harness: ${passed} passed, ${failures.length} failed\n`);
if (failures.length > 0) {
  for (const f of failures) process.stdout.write(`  - ${f}\n`);
  process.exit(1);
}
process.stdout.write('ALL PASS\n');
