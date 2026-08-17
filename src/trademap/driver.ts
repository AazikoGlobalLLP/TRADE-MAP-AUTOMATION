import { Page, Download } from 'playwright';

/** The per-country date window Trade Map actually served (PRD §4B, §16). */
export interface EffectiveRange {
  start: string; // YYYYMM
  end: string; // YYYYMM
  status: 'FULL_RANGE' | 'CLIPPED_BY_AVAILABILITY';
}

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
}

// Trade Map URL vocabulary. Map config words → the tokens the site's URL uses.
const FREQ_URL: Record<string, string> = { monthly: 'month', quarterly: 'quarter', yearly: 'year' };
const VIEWBY_URL: Record<string, string> = { exporter: 'byPartner', product: 'byProduct' };

/**
 * Build the canonical Trade Map query URL (PRD §6). This is our PRIMARY, deterministic
 * way to set the full query state, immune to stale dropdown carryover.
 *
 * Produces e.g.:
 *   https://www.trademap.org/en/goods/time-series/imports/c/212/c/000/p/ALL/byPartner/month/200001-202606/mirror/values/USD/table
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
  return [
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
    filters.source,
    filters.dataType,
    filters.currency,
    filters.view,
  ].join('/');
}

/**
 * Verify the page heading names the expected importer (PRD §42). Blocks Save if we are
 * looking at the wrong country. VERIFY heading selector against live DOM.
 */
export async function verifyCountryHeading(page: Page, countryName: string): Promise<void> {
  const needle = countryName.toLowerCase();
  const candidates: string[] = [];

  const title = await page.title().catch(() => '');
  if (title) candidates.push(title);

  const headingTexts = await page
    .locator('h1, h2, h3, [class*="title" i], [class*="heading" i]')
    .allInnerTexts()
    .catch(() => [] as string[]);
  candidates.push(...headingTexts);

  const seen = candidates.join(' | ').trim();
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
  const fromUrl = parseRange(page.url());
  const fromDom = fromUrl ? null : await readRangeFromDom(page);
  const parsed = fromUrl ?? fromDom;
  if (!parsed) {
    throw new Error(
      'DATE_ERROR: could not read the effective range from the URL or DOM. ' +
        'Calibrate readRangeFromDom() in driver.ts against the live Trade Map range control.',
    );
  }
  const status: EffectiveRange['status'] =
    parsed.start === requestedStart && parsed.end === requestedEnd
      ? 'FULL_RANGE'
      : 'CLIPPED_BY_AVAILABILITY';
  return { start: parsed.start, end: parsed.end, status };
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
  const saveButton = page
    .locator('button:has-text("Save"), a:has-text("Save"), [title*="Save" i], [aria-label*="Save" i]')
    .first();
  await saveButton.click();
  const xlsxOption = page.getByText(/xlsx|excel/i).first();
  if (await xlsxOption.isVisible({ timeout: 2000 }).catch(() => false)) {
    await xlsxOption.click();
  }
}

/** Read a "NNNNNN-NNNNNN" month range out of a URL, if present. */
function parseRange(url: string): { start: string; end: string } | null {
  const m = url.match(/(\d{6})-(\d{6})/);
  return m ? { start: m[1], end: m[2] } : null;
}

/**
 * DOM fallback for the effective range. Returns null until calibrated against the live
 * range control (start/end month selects or the visible "Jan 2000 – Jun 2026" label).
 */
async function readRangeFromDom(_page: Page): Promise<{ start: string; end: string } | null> {
  // TODO(Phase 1 live calibration): read the real range control here, e.g. two <select>
  // month/year pairs, and normalise to YYYYMM. Returning null forces an explicit
  // DATE_ERROR rather than a silent wrong range.
  return null;
}
