// ---------------------------------------------------------------------------
// Config schema + hand-rolled validator (PRD §8 "configuration validator").
// No external dependency (no zod/ajv) — plain type guards keep `tsc` the only
// build gate and stay debuggable. On any problem we throw a single, precise
// `CONFIG_INVALID: <field> — <problem>` so a typo is caught BEFORE a browser
// launches. This file is the one typed source of truth for the config shape.
// ---------------------------------------------------------------------------

import { CollisionMode, COLLISION_MODES } from '../files/collision';

/** The locked query filters (PRD §2). Structurally a superset of driver's `UrlFilters`. */
export interface FiltersConfig {
  tradeFlow: string;
  exporter: string;
  exporterCode: string;
  product: string;
  viewBy: string;
  frequency: string;
  source: string;
  dataType: string;
  currency: string;
  view: string;
  detail?: string; // Phase 9: product-detail granularity (NTL/HS2/HS4/HS6) — only for viewBy=product
}

export interface DatePolicy {
  requestedStart: string; // YYYYMM, immutable for the whole run
  requestedEnd: string; // YYYYMM
  mode: string; // only MAX_WITHIN_REQUESTED_RANGE is defined today (PRD §14)
}

export interface DownloadConfig {
  format: string;
  overwrite: boolean; // legacy; still honoured as the DEFAULT when collisionMode is unset
  collisionMode?: CollisionMode; // Phase 5 (§37); when unset, derived from `overwrite`
  timeoutMs: number;
  downloadAttempts: number;
  // Phase 9B: how long to wait for the data table to render BEFORE clicking Save. byProduct
  // (esp. NTL) renders slowly and Save before data exists yields no download; byPartner is
  // instant. Optional; when unset, DEFAULT_DATA_READY_TIMEOUT_MS (driver.ts) applies.
  dataReadyTimeoutMs?: number;
}

export interface AuthConfig {
  maxLoginAttempts?: number;
}

/** Batch loop settings (Phase 4). Every field is optional in config.json and
 *  filled from BATCH_DEFAULTS, so an existing Phase 1–3 config still validates. */
export interface BatchConfig {
  inputFile: string; // ordered country list (.xlsx), column A
  maxAttemptsPerCountry: number; // total tries per country (1 initial + N−1 retries)
  retryDelayMs: number; // inter-attempt backoff (not a state-wait)
  continueOnFailure: boolean; // false → the first FAILED country aborts the batch
  evidenceDir: string; // base dir for failure screenshots + JSON
  // Phase 9 (spec rows 23,28) RANDOMIZED anti-block throttle. Each break comes after a RANDOM
  // burst of [throttleEveryMin, throttleEveryMax] countries that ran, and lasts a RANDOM
  // [throttlePauseMinMs, throttlePauseMaxMs]; both re-drawn every break so the cadence keeps
  // changing (harder to fingerprint, more human-like). throttleEveryMax = 0 disables the throttle.
  throttleEveryMin: number; // fewest countries in a burst before a break (≥ 1 when enabled)
  throttleEveryMax: number; // most countries in a burst before a break (0 = throttle disabled)
  throttlePauseMinMs: number; // shortest anti-block pause, in ms
  throttlePauseMaxMs: number; // longest anti-block pause, in ms
  // Phase 10: after the MAIN pass, any still-FAILED country is queued and retried in up to this
  // many extra END-OF-RUN rounds (each still throttled). 0 = no end-of-run retry (engine default,
  // keeps the offline batch harness unchanged). The production configs set 3. A LOGIN_REQUIRED in a
  // retry round aborts like anywhere else; SKIPPED/SUCCESS leave the queue.
  finalRetryRounds: number;
  // Phase 10: ONE-WORD convenience that sets the four throttle numbers from a named preset
  // (safe | balanced | fast). Any throttle*/finalRetry field set EXPLICITLY still overrides the
  // preset. It NEVER disables the throttle (compliance boundary). Optional; absent → BATCH_DEFAULTS.
  speedProfile?: SpeedProfile;
}

export interface AppConfig {
  tradeMapBaseUrl: string;
  outputDirectory: string;
  browserProfileDir: string;
  logsDir: string;
  countryCodesFile: string;
  filters: FiltersConfig;
  auth?: AuthConfig;
  datePolicy: DatePolicy;
  download: DownloadConfig;
  batch: BatchConfig;
  manifestFile?: string; // Phase 5 (§30); when set, the batch writes/reads a resume manifest here
  runReportFile?: string; // Phase 6 (§31); human-readable run-report.xlsx path (batch mode)
  filenameTemplate: string;
}

/** Default resume-manifest path (spec-lock row 1). Applied by validateConfig when unset. */
export const DEFAULT_MANIFEST_FILE = './manifests/latest-run.json';

/** Default human-readable run-report path (Phase 6, §31). Applied by validateConfig when unset. */
export const DEFAULT_RUN_REPORT_FILE = './manifests/run-report.xlsx';

/** Defaults for the optional `batch` block (spec-lock row 11; Phase 9 row 28 randomized throttle). */
export const BATCH_DEFAULTS: BatchConfig = {
  inputFile: './input/countries.xlsx',
  maxAttemptsPerCountry: 3,
  retryDelayMs: 2000,
  continueOnFailure: true,
  evidenceDir: './screenshots/failures',
  // spec-locked at build 2026-08-19: break after a random 1–5 countries, for a random 2–7 minutes.
  throttleEveryMin: 1,
  throttleEveryMax: 5,
  throttlePauseMinMs: 120000, // 2 minutes
  throttlePauseMaxMs: 420000, // 7 minutes
  // Engine default OFF (0) so the offline batch harness behaviour is unchanged; the production
  // configs turn it on. See BatchConfig.finalRetryRounds.
  finalRetryRounds: 0,
};

/** The named speed presets for `batch.speedProfile` (Phase 10). Anchored to written-down numbers:
 *  `safe` = the original BATCH_DEFAULTS (1–5 countries / 2–7 min), `balanced` = the tuned
 *  production throttle (3–6 / 45s–2.5min). `fast` is a MODEST step from balanced (6–10 / 30–90s) —
 *  still a real politeness buffer, never a limit-bypass; documented as higher block-risk. A profile
 *  only ever SETS throttle numbers; the throttle can never be disabled through it. */
export type SpeedProfile = 'safe' | 'balanced' | 'fast';
export const SPEED_PROFILES: readonly SpeedProfile[] = ['safe', 'balanced', 'fast'] as const;
export const SPEED_PROFILE_PRESETS: Record<
  SpeedProfile,
  Pick<BatchConfig, 'throttleEveryMin' | 'throttleEveryMax' | 'throttlePauseMinMs' | 'throttlePauseMaxMs'>
> = {
  safe: { throttleEveryMin: 1, throttleEveryMax: 5, throttlePauseMinMs: 120000, throttlePauseMaxMs: 420000 },
  balanced: { throttleEveryMin: 3, throttleEveryMax: 6, throttlePauseMinMs: 45000, throttlePauseMaxMs: 150000 },
  fast: { throttleEveryMin: 6, throttleEveryMax: 10, throttlePauseMinMs: 30000, throttlePauseMaxMs: 90000 },
};

/** The only range mode the PRD defines (§14). Unknown modes are rejected. */
export const RANGE_MODES = ['MAX_WITHIN_REQUESTED_RANGE'] as const;

/** The 10 filter keys the canonical query needs (PRD §2). */
const FILTER_KEYS: Array<keyof FiltersConfig> = [
  'tradeFlow',
  'exporter',
  'exporterCode',
  'product',
  'viewBy',
  'frequency',
  'source',
  'dataType',
  'currency',
  'view',
];

class ConfigError extends Error {
  constructor(field: string, problem: string) {
    super(`CONFIG_INVALID: ${field} — ${problem}`);
    this.name = 'ConfigError';
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function reqObject(v: unknown, field: string): Record<string, unknown> {
  if (!isObject(v)) throw new ConfigError(field, 'must be an object');
  return v;
}

function reqString(v: unknown, field: string): string {
  if (typeof v !== 'string') throw new ConfigError(field, 'must be a string');
  if (v.trim() === '') throw new ConfigError(field, 'must not be empty');
  return v;
}

function reqBoolean(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') throw new ConfigError(field, 'must be true or false');
  return v;
}

function reqPositiveInt(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
    throw new ConfigError(field, 'must be a positive integer');
  }
  return v;
}

function reqNonNegativeInt(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw new ConfigError(field, 'must be a non-negative integer');
  }
  return v;
}

/** YYYYMM: 6 digits, month 01–12, year 1900–2999 (sanity, not a business rule). */
function reqYyyymm(v: unknown, field: string): string {
  const s = reqString(v, field);
  if (!/^\d{6}$/.test(s)) throw new ConfigError(field, `must be YYYYMM (6 digits), got "${s}"`);
  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(4, 6));
  if (year < 1900 || year > 2999) throw new ConfigError(field, `year out of range in "${s}"`);
  if (month < 1 || month > 12) throw new ConfigError(field, `month must be 01–12 in "${s}"`);
  return s;
}

/**
 * Validate raw parsed JSON into a typed AppConfig, or throw CONFIG_INVALID.
 * Order of checks is top-down so the FIRST problem reported is the outermost one.
 */
export function validateConfig(raw: unknown): AppConfig {
  const c = reqObject(raw, 'config');

  const tradeMapBaseUrl = reqString(c.tradeMapBaseUrl, 'tradeMapBaseUrl');
  const outputDirectory = reqString(c.outputDirectory, 'outputDirectory');
  const browserProfileDir = reqString(c.browserProfileDir, 'browserProfileDir');
  const logsDir = reqString(c.logsDir, 'logsDir');
  const countryCodesFile = reqString(c.countryCodesFile, 'countryCodesFile');
  const filenameTemplate = reqString(c.filenameTemplate, 'filenameTemplate');
  // manifestFile — optional (Phase 5); when unset, defaults so the batch always has a resume manifest.
  const manifestFile = c.manifestFile !== undefined ? reqString(c.manifestFile, 'manifestFile') : DEFAULT_MANIFEST_FILE;
  // runReportFile — optional (Phase 6); when unset, defaults alongside the manifest.
  const runReportFile =
    c.runReportFile !== undefined ? reqString(c.runReportFile, 'runReportFile') : DEFAULT_RUN_REPORT_FILE;

  // filters — all 10 keys required, each a non-empty string.
  const rawFilters = reqObject(c.filters, 'filters');
  const filters = {} as FiltersConfig;
  for (const key of FILTER_KEYS) {
    filters[key] = reqString(rawFilters[key], `filters.${key}`);
  }
  // detail — optional (Phase 9); only meaningful for viewBy=product. Non-empty string if present.
  if (rawFilters.detail !== undefined) filters.detail = reqString(rawFilters.detail, 'filters.detail');

  // datePolicy — YYYYMM start/end, start ≤ end, known mode.
  const rawDate = reqObject(c.datePolicy, 'datePolicy');
  const requestedStart = reqYyyymm(rawDate.requestedStart, 'datePolicy.requestedStart');
  const requestedEnd = reqYyyymm(rawDate.requestedEnd, 'datePolicy.requestedEnd');
  if (requestedStart > requestedEnd) {
    throw new ConfigError(
      'datePolicy',
      `requestedStart (${requestedStart}) must be ≤ requestedEnd (${requestedEnd})`,
    );
  }
  const mode = reqString(rawDate.mode, 'datePolicy.mode');
  if (!(RANGE_MODES as readonly string[]).includes(mode)) {
    throw new ConfigError('datePolicy.mode', `unknown mode "${mode}"; expected one of ${RANGE_MODES.join(', ')}`);
  }

  // download — format string, overwrite bool, positive timeout + attempts.
  const rawDownload = reqObject(c.download, 'download');
  const download: DownloadConfig = {
    format: reqString(rawDownload.format, 'download.format'),
    overwrite: reqBoolean(rawDownload.overwrite, 'download.overwrite'),
    timeoutMs: reqPositiveInt(rawDownload.timeoutMs, 'download.timeoutMs'),
    downloadAttempts: reqPositiveInt(rawDownload.downloadAttempts, 'download.downloadAttempts'),
  };
  // dataReadyTimeoutMs — optional (Phase 9B); positive int if present, else the driver default.
  if (rawDownload.dataReadyTimeoutMs !== undefined) {
    download.dataReadyTimeoutMs = reqPositiveInt(rawDownload.dataReadyTimeoutMs, 'download.dataReadyTimeoutMs');
  }
  // collisionMode — optional (Phase 5, §37); when unset, save-time behaviour is derived from
  // `overwrite` (true→overwrite, false→skip), so a pre-Phase-5 config is unchanged.
  if (rawDownload.collisionMode !== undefined) {
    const m = reqString(rawDownload.collisionMode, 'download.collisionMode');
    if (!(COLLISION_MODES as readonly string[]).includes(m)) {
      throw new ConfigError('download.collisionMode', `unknown mode "${m}"; expected one of ${COLLISION_MODES.join(', ')}`);
    }
    download.collisionMode = m as CollisionMode;
  }

  // auth — optional; only maxLoginAttempts, positive int if present.
  let auth: AuthConfig | undefined;
  if (c.auth !== undefined) {
    const rawAuth = reqObject(c.auth, 'auth');
    if (rawAuth.maxLoginAttempts !== undefined) {
      auth = { maxLoginAttempts: reqPositiveInt(rawAuth.maxLoginAttempts, 'auth.maxLoginAttempts') };
    } else {
      auth = {};
    }
  }

  // batch — optional; each field falls back to BATCH_DEFAULTS so a pre-Phase-4
  // config still validates. Present fields are type-checked like any other.
  const batch: BatchConfig = { ...BATCH_DEFAULTS };
  if (c.batch !== undefined) {
    const rawBatch = reqObject(c.batch, 'batch');
    if (rawBatch.inputFile !== undefined) batch.inputFile = reqString(rawBatch.inputFile, 'batch.inputFile');
    if (rawBatch.maxAttemptsPerCountry !== undefined) {
      batch.maxAttemptsPerCountry = reqPositiveInt(rawBatch.maxAttemptsPerCountry, 'batch.maxAttemptsPerCountry');
    }
    if (rawBatch.retryDelayMs !== undefined) {
      // 0 is a valid backoff (tests / no pause), so this allows non-negative, not positive.
      const v = rawBatch.retryDelayMs;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
        throw new ConfigError('batch.retryDelayMs', 'must be a non-negative integer');
      }
      batch.retryDelayMs = v;
    }
    if (rawBatch.continueOnFailure !== undefined) {
      batch.continueOnFailure = reqBoolean(rawBatch.continueOnFailure, 'batch.continueOnFailure');
    }
    if (rawBatch.evidenceDir !== undefined) batch.evidenceDir = reqString(rawBatch.evidenceDir, 'batch.evidenceDir');
    // Phase 10: speedProfile — a ONE-WORD preset for the four throttle numbers. Applied FIRST so
    // any throttle field the user ALSO sets explicitly (below) still wins. Never disables the throttle.
    if (rawBatch.speedProfile !== undefined) {
      const p = reqString(rawBatch.speedProfile, 'batch.speedProfile');
      if (!(SPEED_PROFILES as readonly string[]).includes(p)) {
        throw new ConfigError('batch.speedProfile', `unknown profile "${p}"; expected one of ${SPEED_PROFILES.join(', ')}`);
      }
      const preset = SPEED_PROFILE_PRESETS[p as SpeedProfile];
      batch.throttleEveryMin = preset.throttleEveryMin;
      batch.throttleEveryMax = preset.throttleEveryMax;
      batch.throttlePauseMinMs = preset.throttlePauseMinMs;
      batch.throttlePauseMaxMs = preset.throttlePauseMaxMs;
      batch.speedProfile = p as SpeedProfile;
    }
    // Phase 9 (row 28) RANDOMIZED anti-block throttle. Each field is a non-negative integer;
    // min ≤ max per pair. throttleEveryMax = 0 disables the throttle. Set here → overrides speedProfile.
    if (rawBatch.throttleEveryMin !== undefined) batch.throttleEveryMin = reqNonNegativeInt(rawBatch.throttleEveryMin, 'batch.throttleEveryMin');
    if (rawBatch.throttleEveryMax !== undefined) batch.throttleEveryMax = reqNonNegativeInt(rawBatch.throttleEveryMax, 'batch.throttleEveryMax');
    if (rawBatch.throttlePauseMinMs !== undefined) batch.throttlePauseMinMs = reqNonNegativeInt(rawBatch.throttlePauseMinMs, 'batch.throttlePauseMinMs');
    if (rawBatch.throttlePauseMaxMs !== undefined) batch.throttlePauseMaxMs = reqNonNegativeInt(rawBatch.throttlePauseMaxMs, 'batch.throttlePauseMaxMs');
    // Phase 10: finalRetryRounds — non-negative int; 0 (default) = no end-of-run retry queue.
    if (rawBatch.finalRetryRounds !== undefined) {
      batch.finalRetryRounds = reqNonNegativeInt(rawBatch.finalRetryRounds, 'batch.finalRetryRounds');
    }
    if (batch.throttleEveryMin > batch.throttleEveryMax && batch.throttleEveryMax > 0) {
      throw new ConfigError('batch.throttleEveryMin', `must be ≤ throttleEveryMax (${batch.throttleEveryMax})`);
    }
    if (batch.throttlePauseMinMs > batch.throttlePauseMaxMs) {
      throw new ConfigError('batch.throttlePauseMinMs', `must be ≤ throttlePauseMaxMs (${batch.throttlePauseMaxMs})`);
    }
  }

  return {
    tradeMapBaseUrl,
    outputDirectory,
    browserProfileDir,
    logsDir,
    countryCodesFile,
    filters,
    auth,
    datePolicy: { requestedStart, requestedEnd, mode },
    download,
    batch,
    manifestFile,
    runReportFile,
    filenameTemplate,
  };
}
