import { Page, Download } from 'playwright';
import {
  EffectiveRange,
  RangeReadout,
  parseRange,
  chooseReadout,
  computeEffectiveRange,
  rangeFromColumnClasses,
} from './rangeEngine';

// The range logic (status decision, parsing, YYYYMM checks) lives in rangeEngine
// so it can be proven offline. `EffectiveRange` is re-exported for existing callers.
export { EffectiveRange } from './rangeEngine';

/** Filter values needed to build the canonical query URL (subset of config.filters). */
export interface UrlFilters {
  tradeFlow: string;
  exporterCode: string;
  product: string;
  viewBy: string;
  frequency: string;
  source: string;
  dataType: string;
  currency: string;
  view: string;
  detail?: string; // Phase 9: product-detail granularity — ONLY used when viewBy=product (byProduct)
}

// Trade Map URL vocabulary. Map config words → the tokens the site's URL uses.
const FREQ_URL: Record<string, string> = { monthly: 'month', quarterly: 'quarter', yearly: 'year' };
const VIEWBY_URL: Record<string, string> = { exporter: 'byPartner', product: 'byProduct' };

// Detail (product-detail granularity) URL tokens for the byProduct view (Phase 9, spec row 21).
// Decoded from the user's real byProduct URL, which showed HS2 encoded as `2`; by the same
// scheme HS4=`4`, HS6=`6`. NTL is DELIBERATELY ABSENT: its URL token has never been captured,
// and inventing one is forbidden (CLAUDE.md — "never invent a … field name … not written down").
const DETAIL_URL_TOKENS: Record<string, string> = { hs2: '2', hs4: '4', hs6: '6' };

/**
 * PURE. Map a Detail label (NTL / HS2 / HS4 / HS6) to its byProduct URL token.
 * Throws `DETAIL_TOKEN_UNCAPTURED` for NTL (token not yet captured) or any unknown value,
 * so a Product-view run fails LOUD rather than exporting a guessed/invented URL. The user
 * chose "hard-error" over silently substituting HS6 — this is the single enforcement point.
 */
export function resolveDetailUrlToken(detail: string): string {
  const key = detail.trim().toLowerCase();
  const token = DETAIL_URL_TOKENS[key];
  if (token) return token;
  if (key === 'ntl') {
    throw new Error(
      'DETAIL_TOKEN_UNCAPTURED: the byProduct URL token for Detail=NTL has not been captured yet. ' +
        'Capture one real …/byProduct/{freq}/{range}/<NTL-token>/… URL from a logged-in session and add it ' +
        'to DETAIL_URL_TOKENS in driver.ts before running an NTL byProduct export — never invent it (CLAUDE.md). ' +
        'Choose Detail=HS6 instead if you do not need national-tariff-line granularity.',
    );
  }
  throw new Error(
    `DETAIL_TOKEN_UNCAPTURED: unknown Detail value "${detail}" — no known byProduct URL token. ` +
      'Known tokens: HS2, HS4, HS6. NTL is uncaptured. Capture a real URL before wiring a new Detail value.',
  );
}

/**
 * Build the canonical Trade Map query URL (PRD §6). This is our PRIMARY, deterministic
 * way to set the full query state, immune to stale dropdown carryover.
 *
 * Produces e.g. (byPartner / View by = Exporter):
 *   https://www.trademap.org/en/goods/time-series/imports/c/212/c/000/p/ALL/byPartner/month/200001-202606/mirror/values/USD/table
 *
 * byProduct (View by = Product) INSERTS a Detail segment between range and source
 * (Phase 9, spec row 21, decoded from the user's real URL) — byPartner has none:
 *   …/byProduct/{freq}/{range}/{detail}/{source}/{dataType}/{currency}/{view}
 * The range is emitted as the explicit YYYYMM-YYYYMM window (consistent with byPartner and the
 * frozen GLOBAL range). NOTE: the user's captured byProduct URL used the literal `default`
 * there (= MAX); whether byProduct honours an explicit range is a HEADED calibration follow-up.
 *
 * RISK: the live path segments may differ from the PRD template — verify against a real
 * logged-in query before trusting URL-navigation, and fall back to dropdown driving.
 */
export function buildCanonicalUrl(
  baseUrl: string,
  importerCode: string,
  filters: UrlFilters,
  start: string,
  end: string,
): string {
  const freq = FREQ_URL[filters.frequency] ?? filters.frequency;
  const viewBy = VIEWBY_URL[filters.viewBy] ?? filters.viewBy;
  const root = baseUrl.replace(/\/+$/, '');
  const segments = [
    root,
    'en',
    'goods',
    'time-series',
    filters.tradeFlow,
    'c',
    importerCode,
    'c',
    filters.exporterCode,
    'p',
    filters.product,
    viewBy,
    freq,
    `${start}-${end}`,
  ];
  // byProduct inserts a Detail segment here (spec row 21); byPartner has none. Resolving the
  // token throws for NTL/unknown (never invent), so a Product-view run cannot ship a guessed URL.
  if (viewBy === 'byProduct') {
    if (!filters.detail) {
      throw new Error('DETAIL_REQUIRED: a byProduct (View by = Product) query needs a Detail value (e.g. HS6) — none was set.');
    }
    segments.push(resolveDetailUrlToken(filters.detail));
  }
  segments.push(filters.source, filters.dataType, filters.currency, filters.view);
  return segments.join('/');
}

/**
 * Collect the page's heading/title text (joined) for importer verification. Shared
 * by `verifyCountryHeading` and the pre-Save gate in verifyQuery.ts so both read
 * the heading the same way. VERIFY these selectors against live DOM (Phase 3B).
 */
export async function readHeadingCandidates(page: Page): Promise<string> {
  const candidates: string[] = [];

  const title = await page.title().catch(() => '');
  if (title) candidates.push(title);

  const headingTexts = await page
    .locator('h1, h2, h3, [class*="title" i], [class*="heading" i]')
    .allInnerTexts()
    .catch(() => [] as string[]);
  candidates.push(...headingTexts);

  return candidates.join(' | ').trim();
}

/**
 * Verify the page heading names the expected importer (PRD §42). Blocks Save if we are
 * looking at the wrong country. VERIFY heading selector against live DOM.
 */
export async function verifyCountryHeading(page: Page, countryName: string): Promise<void> {
  const needle = countryName.toLowerCase();
  const seen = await readHeadingCandidates(page);
  if (seen.toLowerCase().includes(needle)) {
    return;
  }
  if (!seen) {
    throw new Error(
      `COUNTRY_NOT_FOUND: found no heading/title text to verify "${countryName}". ` +
        `Calibrate the heading selector in driver.ts against the live DOM.`,
    );
  }
  throw new Error(
    `COUNTRY_NOT_FOUND: page heading/title does not mention "${countryName}". ` +
      `Saw: "${seen.slice(0, 200)}". If this looks like the login page, the auth step should ` +
      `have paused first; otherwise calibrate the heading selector in driver.ts.`,
  );
}

/**
 * Detect the effective range Trade Map served for this country (PRD §16).
 * PRIMARY strategy: parse the YYYYMM-YYYYMM segment Trade Map writes into the URL after
 * loading the canonical query (the URL encodes the range, PRD §6). FALLBACK: read the
 * visible range control from the DOM (selectors need calibration).
 */
export async function detectEffectiveRange(
  page: Page,
  requestedStart: string,
  requestedEnd: string,
): Promise<EffectiveRange> {
  // DOM readout takes precedence over the URL segment: a CLIPPED country may keep
  // the requested range in its URL (CLAUDE.md gotcha, DECISIONS 2026-08-17), which
  // would falsely read as FULL_RANGE. chooseReadout + computeEffectiveRange (pure,
  // in rangeEngine) own that precedence and the FULL/CLIPPED decision.
  const fromDom = await readShownRange(page);
  const fromUrl = parseRange(page.url());
  const chosen = chooseReadout(fromDom, fromUrl);
  return computeEffectiveRange({ requestedStart, requestedEnd }, chosen);
}

/**
 * Trigger Trade Map's own Save/export and capture the download (PRD §18). We wait for the
 * download event and click Save concurrently; if Save opens a format menu, we pick XLSX.
 * VERIFY the Save/XLSX selectors against the live DOM.
 */
export async function triggerSaveAndDownload(page: Page, timeoutMs: number): Promise<Download> {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: timeoutMs }),
    clickSave(page),
  ]);
  return download;
}

async function clickSave(page: Page): Promise<void> {
  // The EXPORT Save is a Material menu trigger labelled EXACTLY "Save" (calibrated
  // 2026-08-17). A separate "Save query" button also exists and appears FIRST in the
  // DOM — the old `:has-text("Save").first()` would have clicked the wrong one.
  let saveButton = page.getByRole('button', { name: 'Save', exact: true }).first();
  if (!(await saveButton.isVisible({ timeout: 3000 }).catch(() => false))) {
    saveButton = page.locator('button.mat-mdc-menu-trigger', { hasText: 'Save' }).first();
  }
  await saveButton.click();

  // Save opens a Material menu of export formats; pick the XLSX/Excel item.
  const xlsxItem = page.getByRole('menuitem', { name: /xlsx|excel/i }).first();
  if (await xlsxItem.isVisible({ timeout: 3000 }).catch(() => false)) {
    await xlsxItem.click();
    return;
  }
  const xlsxText = page.getByText(/xlsx|excel/i).first();
  if (await xlsxText.isVisible({ timeout: 2000 }).catch(() => false)) {
    await xlsxText.click();
  }
}

/**
 * Read the EFFECTIVE served range from the data table's month columns. This is the
 * trusted source for CLIPPED detection (the URL can lie for a reduced-availability
 * country). CALIBRATED 2026-08-17: each month header cell carries a
 * `mat-column-YYYYMM` class; the served window is min→max of those tokens.
 *
 * Uses locator `getAttribute` (no `page.evaluate`) so it runs identically under
 * `tsx` and compiled `node`. Returns null when no month column is found → a loud
 * DATE_ERROR upstream rather than a silent wrong range.
 */
export async function readShownRange(page: Page): Promise<RangeReadout | null> {
  const cells = page.locator('.mat-mdc-header-cell.col-year');
  const n = await cells.count().catch(() => 0);
  if (n === 0) return null;
  const classAttrs: string[] = [];
  for (let i = 0; i < n; i++) {
    const cls = await cells.nth(i).getAttribute('class').catch(() => null);
    if (cls) classAttrs.push(cls);
  }
  return rangeFromColumnClasses(classAttrs);
}
