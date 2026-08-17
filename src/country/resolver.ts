import { Page } from 'playwright';

// ---------------------------------------------------------------------------
// Country Code Resolver (PRD §7). Turns a country NAME into Trade Map's numeric
// code. Primary path: the local country-code map (config/country-codes.json).
// Fallback: Trade Map's own country-search UI — and we LOG that UI resolution
// was used. We never invent a numeric code; if the UI can't yield one we fail
// loudly rather than return a wrong code that would export the wrong country.
// ---------------------------------------------------------------------------

export type CodeSource = 'MAP' | 'UI';

export interface ResolvedCountry {
  code: string; // Trade Map ISO-3166 numeric, kept as a string to preserve leading zeros ("000")
  source: CodeSource;
}

/** Matches the structured logger created in index.ts (structural typing). */
type Logger = (level: 'info' | 'warn' | 'error', event: string, data?: Record<string, unknown>) => void;

/**
 * Resolve a country name to its Trade Map numeric code.
 * Order (PRD §7): exact map hit → trimmed/case-insensitive map hit → UI search.
 */
export async function resolveCountryCode(
  page: Page,
  name: string,
  codesMap: Record<string, string>,
  baseUrl: string,
  log: Logger,
): Promise<ResolvedCountry> {
  // 1. Exact map hit (fast path, no browser work). Skip meta keys like "_note".
  const exact = codesMap[name];
  if (typeof exact === 'string' && !name.startsWith('_')) {
    return { code: exact, source: 'MAP' };
  }

  // 2. Trimmed / case-insensitive map hit (so "dominica" / " Dominica " resolve).
  const target = name.trim().toLowerCase();
  for (const [key, value] of Object.entries(codesMap)) {
    if (key.startsWith('_')) continue; // metadata, not a country
    if (key.trim().toLowerCase() === target) {
      return { code: value, source: 'MAP' };
    }
  }

  // 3. Fallback: Trade Map country-search UI. Log FIRST (PRD §7 requires it), then
  //    attempt. A failure here throws — we never guess a code.
  log('warn', 'country.ui_resolution_used', { country: name });
  const code = await resolveViaUi(page, name, baseUrl);
  return { code, source: 'UI' };
}

/**
 * Resolve a country via Trade Map's country-search UI.
 *
 * STRUCTURE ONLY (Phase 2): the real search-box and result selectors CANNOT be
 * pinned without a live logged-in session, so they are best-effort and MUST be
 * calibrated against the live DOM in Phase 3 (same rule as `readRangeFromDom()`
 * in driver.ts). Contract: return a numeric code string, or throw — never return
 * a wrong/empty code silently.
 */
async function resolveViaUi(page: Page, name: string, baseUrl: string): Promise<string> {
  await page.goto(baseUrl.replace(/\/+$/, ''), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);

  // TODO(Phase 3 live calibration): pin these against the real Trade Map search UI.
  const searchBox = page
    .locator('input[type="search"], input[name*="country" i], input[placeholder*="country" i], input[aria-label*="search" i]')
    .first();

  if (!(await searchBox.isVisible({ timeout: 3000 }).catch(() => false))) {
    throw new Error(
      `COUNTRY_UI_RESOLUTION_FAILED: could not find the Trade Map country-search box for "${name}". ` +
        `Calibrate the search selectors in resolver.ts against the live DOM (Phase 3).`,
    );
  }

  await searchBox.fill(name);
  await searchBox.press('Enter').catch(() => undefined);
  await page.waitForLoadState('networkidle').catch(() => undefined);

  // Trade Map encodes the selected country as a numeric code in the URL (…/c/<code>/…).
  // Reading it back from the URL is the most deterministic confirmation available.
  const match = page.url().match(/\/c\/(\d{2,4})(?:\/|$)/);
  if (!match) {
    throw new Error(
      `COUNTRY_UI_RESOLUTION_FAILED: searched for "${name}" but no numeric code appeared in the URL. ` +
        `Calibrate the result-selection selectors in resolver.ts against the live DOM (Phase 3).`,
    );
  }
  return match[1];
}
