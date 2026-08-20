import { Page } from 'playwright';
import { isLoginPage, promptManualLogin } from '../auth/session';
import {
  buildCanonicalUrl,
  verifyCountryHeading,
  triggerSaveAndDownload,
  waitForDataReady,
  DEFAULT_DATA_READY_TIMEOUT_MS,
} from '../trademap/driver';
import { ensureAllFilters } from '../trademap/filters';
import { verifyQuery } from '../trademap/verifyQuery';
import { RequestedRange, computeEffectiveRange } from '../trademap/rangeEngine';
import { saveDownload, validateXlsx } from '../files/save-validate';
import { CollisionMode, resolveCollisionMode } from '../files/collision';
import { readEffectiveRangeFromWorkbook } from '../files/effective-range';
import { generateFilename, deriveFlowTokens } from '../files/filename';
import { AppConfig } from '../config/schema';
import { resolveCountryCode } from '../country/resolver';

// ---------------------------------------------------------------------------
// Per-country job (PRD §5 "Country Job Isolation"). ONE country, start to
// finish, as an independent unit. THE isolation boundary of the whole system:
//
//   • `global` (the requested range) is received BY VALUE and only ever READ.
//     index.ts Object.freeze()s it, so this function cannot mutate it even by
//     accident — no per-country value can leak into the next country's request.
//   • The per-country EFFECTIVE range is RETURNED, never stored anywhere the
//     next runCountry() call can read (convention #2, PRD §39).
//
// Extracted verbatim from index.ts's original single-country flow (Phase 1/2),
// now with the §40 ensureAllFilters sweep and the §42 verifyQuery Save-gate.
// ---------------------------------------------------------------------------

/** Structured logger shared with index.ts (structural typing). */
export type Logger = (level: 'info' | 'warn' | 'error', event: string, data?: Record<string, unknown>) => void;

export interface CountryResult {
  country: string;
  importerCode: string;
  codeSource: 'MAP' | 'UI';
  requestedRange: string; // "YYYYMM-YYYYMM" — the GLOBAL range, echoed for the report
  effectiveRange: string; // "YYYYMM-YYYYMM" — what Trade Map served THIS country
  rangeStatus: 'FULL_RANGE' | 'CLIPPED_BY_AVAILABILITY';
  status: 'SUCCESS' | 'SKIPPED';
  skipReason?: 'FILE_EXISTS'; // present when status is SKIPPED by a collision (Phase 5)
  file: string; // filename only (may be a `_vN` variant under `version` collision mode)
  targetPath: string; // absolute path
}

/** Per-run overrides for the country job (Phase 5). */
export interface RunCountryOptions {
  /** Collision mode for the save step; defaults to the config-derived mode. `--force` passes `overwrite`. */
  collisionMode?: CollisionMode;
}

const cap = (s: string): string => (s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * Filesystem-friendly country slug for the filename: NFC, then any run of
 * non-letter/non-digit chars (spaces, commas, apostrophes, dots, parens) collapses
 * to a single '-', with edge hyphens trimmed. Accented letters are KEPT (NTFS is
 * Unicode). "Korea, Republic of" → "Korea-Republic-of"; "Côte d'Ivoire" → "Côte-d-Ivoire".
 */
const countrySlug = (name: string): string =>
  name
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');

/** "200101" → "2001-01" (human-readable YYYY-MM). Non-6-digit input passes through unchanged. */
const prettyYYYYMM = (s: string): string => (/^\d{6}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4)}` : s);

/**
 * Run one country's export end to end and return its result. `global` is the
 * immutable GLOBAL requested range — read here, never written back.
 */
export async function runCountry(
  page: Page,
  country: string,
  global: RequestedRange,
  config: AppConfig,
  codes: Record<string, string>,
  log: Logger,
  options: RunCountryOptions = {},
): Promise<CountryResult> {
  const { requestedStart, requestedEnd } = global;
  const collisionMode = options.collisionMode ?? resolveCollisionMode(config.download);

  // Resolve name → Trade Map numeric code: local map first, UI-search fallback (PRD §7).
  const resolved = await resolveCountryCode(page, country, codes, config.tradeMapBaseUrl, log);
  const importerCode = resolved.code;
  log('info', 'country.resolved', { country, importerCode, source: resolved.source });

  // Build the canonical query URL from the GLOBAL requested range (never a carried-over
  // value) and navigate deterministically (PRD §4A, §6, §15). On a login bounce, PAUSE
  // for a manual login and re-navigate — never crash on the login page.
  const url = buildCanonicalUrl(config.tradeMapBaseUrl, importerCode, config.filters, requestedStart, requestedEnd);
  log('info', 'query.navigate', { country, importerCode, url });
  await gotoAuthenticated(page, url, config.auth?.maxLoginAttempts ?? 3, log);

  // Early country-verification gate (PRD §42).
  await verifyCountryHeading(page, country);

  // §40 filter-carryover sweep: re-verify ALL locked filters after the country switch,
  // correcting only the wrong ones. Never assume carryover is correct (convention #4).
  await ensureAllFilters(page, config.filters, log);

  // Hard pre-Save gate (PRD §42, convention #5): heading + every filter + the requested
  // range must all be correct, or this throws QUERY_INVALID and Save is never reached.
  await verifyQuery(page, country, config.filters, { start: requestedStart, end: requestedEnd }, log);

  // Data must be LOADED before Save (Phase 9B). byPartner passed the gate by reading the DOM table,
  // so its data is already present (fast no-op); a byProduct query passes the gate from the URL, so
  // the heavy product table (esp. NTL) may still be rendering — and Save before the rows exist yields
  // NO download (confirmed live 2026-08-19). Tunable via download.dataReadyTimeoutMs. On timeout we
  // still attempt Save (no worse than before) but record it so a no-download is explained.
  const dataReadyTimeout = config.download.dataReadyTimeoutMs ?? DEFAULT_DATA_READY_TIMEOUT_MS;
  let dataReady = await waitForDataReady(page, dataReadyTimeout);

  // If the data never appeared, a mid-run SESSION EXPIRY (login redirect during load) is the likely
  // cause. Detect the LOGIN PAGE and PAUSE for a manual re-login + re-navigate (PRD §28) — never fail
  // the country on a recoverable auth bounce — then re-verify the query and wait once more. If login
  // is abandoned, gotoAuthenticated throws LOGIN_REQUIRED, which the batch turns into a resume-able stop.
  if (!dataReady && (await isLoginPage(page).catch(() => false))) {
    log('warn', 'auth.login_midrun', { country, url: page.url() });
    await gotoAuthenticated(page, url, config.auth?.maxLoginAttempts ?? 3, log);
    await verifyCountryHeading(page, country);
    await ensureAllFilters(page, config.filters, log);
    await verifyQuery(page, country, config.filters, { start: requestedStart, end: requestedEnd }, log);
    dataReady = await waitForDataReady(page, dataReadyTimeout);
  }
  log(dataReady ? 'info' : 'warn', dataReady ? 'data.ready' : 'data.not_ready', {
    country,
    ...(dataReady ? {} : { note: 'data table did not render before Save; attempting Save anyway' }),
  });

  // Trigger Save + capture the download FIRST (PRD §18, §26–27). In the new Trade Map beta
  // the rendered/URL columns ALWAYS span the full requested range (months a country lacks
  // are padded with 0), so the truthful effective range must be read from the FILE, not the
  // DOM — hence we download before naming. (Pre-download collision skip returns in Phase 5.)
  let download;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= config.download.downloadAttempts; attempt++) {
    try {
      log('info', 'export.attempt', { country, attempt });
      download = await triggerSaveAndDownload(page, config.download.timeoutMs);
      break;
    } catch (e) {
      lastErr = e;
      log('warn', 'export.attempt_failed', { country, attempt, error: String(e) });
    }
  }
  if (!download) {
    throw new Error(`DOWNLOAD_TIMEOUT: all ${config.download.downloadAttempts} attempts failed (${String(lastErr)})`);
  }

  // Effective range = first→last month that carries real data in the exported file (PRD §16).
  // `global` is only READ here; computeEffectiveRange classifies FULL vs CLIPPED against it.
  const rawPath = await download.path();
  if (!rawPath) {
    throw new Error('DOWNLOAD_ERROR: the download produced no file to read the effective range from.');
  }
  const served = await readEffectiveRangeFromWorkbook(rawPath);
  const eff = computeEffectiveRange(global, served);
  log('info', 'range.detected', {
    country,
    requested: `${requestedStart}-${requestedEnd}`,
    effective: `${eff.start}-${eff.end}`,
    rangeStatus: eff.status,
    dataSource: 'file',
  });

  // Generate the target filename from the EFFECTIVE (data) range (PRD §19 — truthful name).
  const filename = generateFilename(config.filenameTemplate, {
    country, // raw name (kept for backward compatibility with older templates)
    countrySlug: countrySlug(country), // clean, hyphen-joined name for the new convention
    flow: cap(config.filters.tradeFlow), // "Imports" — truthful if the flow ever changes
    frequency: cap(config.filters.frequency),
    source: cap(config.filters.source),
    currency: config.filters.currency,
    start: eff.start, // raw YYYYMM (kept for backward compatibility)
    end: eff.end,
    startPretty: prettyYYYYMM(eff.start), // "2001-01"
    endPretty: prettyYYYYMM(eff.end), // "2026-06"
    extension: config.download.format,
    // Phase 8 flow-aware tokens (spec row 16): flowWord/viewWord/timeWord/sourceWord.
    // Harmless for older templates (unreferenced keys are ignored).
    ...deriveFlowTokens(config.filters),
  });

  const base = {
    country,
    importerCode,
    codeSource: resolved.source,
    requestedRange: `${requestedStart}-${requestedEnd}`,
    effectiveRange: `${eff.start}-${eff.end}`,
    rangeStatus: eff.status,
  };

  // Save under the truthful name, applying the collision mode (PRD §25, §37, AC-09).
  const result = await saveDownload(download, config.outputDirectory, filename, collisionMode);
  if (!result.saved) {
    log('info', 'file.skip', { country, targetPath: result.targetPath, reason: 'exists', collisionMode });
    return { ...base, status: 'SKIPPED', skipReason: 'FILE_EXISTS', file: result.filename, targetPath: result.targetPath };
  }
  // Validate the (possibly versioned) written file before declaring success.
  await validateXlsx(result.targetPath);
  if (result.versioned) log('info', 'file.versioned', { country, file: result.filename });

  return { ...base, status: 'SUCCESS', file: result.filename, targetPath: result.targetPath };
}

/**
 * Navigate to the query URL and ensure we land on the DATA page, not the login page.
 * On a login redirect (first run or expired session, PRD §22/§28) we pause for a manual
 * login and re-navigate — up to maxLoginAttempts — instead of crashing on the login page.
 */
async function gotoAuthenticated(page: Page, url: string, maxLoginAttempts: number, log: Logger): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);

  let attempts = 0;
  while (await isLoginPage(page)) {
    attempts += 1;
    if (attempts > maxLoginAttempts) {
      throw new Error(
        `LOGIN_REQUIRED: still on the Trade Map login page after ${maxLoginAttempts} manual attempt(s).`,
      );
    }
    log('warn', 'auth.login_required', { attempt: attempts, url: page.url() });
    await promptManualLogin();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
  }
  log('info', 'auth.ok', { url: page.url() });
}
