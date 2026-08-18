// ---------------------------------------------------------------------------
// Phase 8 — Run plan (spec: docs/spec/phase-8-interactive-query-builder.md).
//
// The interactive prompts produce a RunPlanAnswers. `applyRunPlan` turns those
// answers + the loaded config into an EFFECTIVE AppConfig that the UNCHANGED
// runBatch/runCountry engine then executes. The plan only overrides the query
// inputs the user chose (spec rows 5,7,8,10,11,12,16); Importer, Product,
// exporter partner (World/000) and `view` are LEFT UNTOUCHED (spec row 6).
//
// PURE + browser-free: `applyRunPlan` returns a NEW config and never mutates the
// input (isolation, convention #2), so it is unit-proven by `npm run test:runplan`.
// Nothing here is hardcoded into business logic — the option LISTS below are the
// locked fallbacks (spec rows 4,5,7,8,11,12,13); the live lists are read at run
// time by optionsReader and override these for display only.
// ---------------------------------------------------------------------------

import { AppConfig } from './schema';

/** The four datasets Trade Map offers; only `time-series` is built in Phase 8 (spec row 4). */
export type DatasetKey = 'time-series' | 'trade-indicators' | 'companies' | 'trade-in-services';

/**
 * The user's answers for ONE interactive run. Values are stored in OUR internal
 * config vocabulary (lower-case: 'imports'/'exports', 'monthly', 'mirror', …) so
 * they drop straight into `filters`/`datePolicy` and read back equal from the URL.
 */
export interface RunPlanAnswers {
  dataset: DatasetKey; // only 'time-series' proceeds; others abort DATASET_UNSUPPORTED
  tradeFlow: string; // 'imports' | 'exports'
  viewBy: string; // 'exporter' | 'product'
  frequency: string; // 'yearly' | 'quarterly' | 'monthly'
  requestedStart: string; // YYYYMM — the GLOBAL range for this run
  requestedEnd: string; // YYYYMM
  dataSource: string; // 'direct' | 'mirror'  → filters.source
  dataType: string; // 'values' | 'quantities' | …  → filters.dataType
  currency: string; // 'USD' | 'EUR' | …
  numbersDisplay: string; // 'smart' | 'thousands' | 'millions' — RECORDED only (not URL-encoded, spec row 13)
}

// --- Locked option lists (spec rows 4,5,7,8,11,12,13) -----------------------
// Display labels shown in the menus; the *_VALUES maps turn a chosen label into
// our internal config word. The live reader (optionsReader) may replace the
// data-source/type/currency label lists at run time, but these remain the
// deterministic fallback so a miscalibrated selector never bricks the run.

export const DATASET_OPTIONS = ['Time series', 'Trade indicators', 'Companies', 'Trade in services'] as const;
export const DATASET_KEYS: DatasetKey[] = ['time-series', 'trade-indicators', 'companies', 'trade-in-services'];
export const DATASET_DEFAULT_INDEX = 0; // Time series (spec row 4)

export const TRADE_FLOW_OPTIONS = ['Imports', 'Exports'] as const;
export const TRADE_FLOW_DEFAULT_INDEX = 0; // Imports (spec row 5)

export const VIEW_BY_OPTIONS = ['Exporter', 'Product'] as const;
export const VIEW_BY_DEFAULT_INDEX = 0; // Exporter (spec row 7)

export const FREQUENCY_OPTIONS = ['Yearly', 'Quarterly', 'Monthly'] as const;
export const FREQUENCY_DEFAULT_INDEX = 2; // Monthly (spec row 8)

export const DATA_SOURCE_OPTIONS_FALLBACK = ['Direct', 'Mirror'] as const;
export const DATA_SOURCE_DEFAULT_LABEL = 'Mirror'; // spec row 11

export const DATA_TYPE_OPTIONS_FALLBACK = ['Values', 'Quantities'] as const;
export const DATA_TYPE_DEFAULT_LABEL = 'Values'; // spec row 11

export const CURRENCY_OPTIONS_FALLBACK = ['USD', 'EUR'] as const;
export const CURRENCY_DEFAULT_LABEL = 'USD'; // spec row 12

export const NUMBERS_DISPLAY_OPTIONS = ['Smart', 'Thousands', 'Millions'] as const;
export const NUMBERS_DISPLAY_DEFAULT_INDEX = 0; // Smart (spec row 13)

/**
 * The flow-aware default filename template for interactive runs (spec row 16).
 * e.g. `india-export-country__2001-01_to_2026-06__monthly-mirror-USD.xlsx`.
 * The country-first `--batch`/`--country` template in config.json is left as-is.
 */
export const DEFAULT_INTERACTIVE_FILENAME_TEMPLATE =
  '{countrySlug}-{flowWord}-{viewWord}__{startPretty}_to_{endPretty}__{timeWord}-{sourceWord}-{currency}.{extension}';

/** Thrown when the user picks a dataset Phase 8 does not build (spec row 4). Exit code 2. */
export const DATASET_UNSUPPORTED_MESSAGE = 'DATASET_UNSUPPORTED: only Time series is available in this version';

/**
 * PURE. A short, filesystem-safe slug of the query IDENTITY the answers select —
 * everything that changes the exported CONTENT or filename: flow · viewBy ·
 * frequency · source · dataType · currency. Range is deliberately excluded: the
 * resume check already guards on requestedRange, so it need not be in the path.
 */
export function queryIdentitySlug(answers: RunPlanAnswers): string {
  return [
    answers.tradeFlow,
    answers.viewBy,
    answers.frequency,
    answers.dataSource,
    answers.dataType,
    answers.currency,
  ]
    .map((s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'))
    .join('-')
    .replace(/^-+|-+$/g, '');
}

/**
 * PURE. Insert the query-identity slug before a path's extension so DIFFERENT
 * queries never share a resume manifest / run report (spec row 18). e.g.
 * `./manifests/latest-run.json` → `./manifests/latest-run.exports-exporter-monthly-mirror-values-usd.json`.
 * A path with no extension just gets `.slug` appended.
 */
export function scopePathByQuery(filePath: string, answers: RunPlanAnswers): string {
  const slug = queryIdentitySlug(answers);
  const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  const dot = filePath.lastIndexOf('.');
  if (dot > lastSep) return `${filePath.slice(0, dot)}.${slug}${filePath.slice(dot)}`;
  return `${filePath}.${slug}`;
}

/**
 * PURE. Build the EFFECTIVE run config from the loaded config + the interactive
 * answers. Returns a NEW AppConfig — the input `config`, its `filters` and its
 * `datePolicy` are never mutated (proven by the isolation test), so a run plan
 * can never leak back into the on-disk defaults.
 *
 * Overridden (spec): tradeFlow, viewBy, frequency (filters); source←dataSource,
 * dataType, currency; requestedStart/End (datePolicy); filenameTemplate.
 * LEFT UNTOUCHED (spec row 6): exporter, exporterCode, product, view — the World
 * partner (000) and All-products defaults stay put; the country fills the reporter
 * slot via runCountry's resolver, and flipping tradeFlow is all Exports needs.
 * `numbersDisplay` is NOT a URL filter, so it is recorded by the caller, not here.
 *
 * The manifest + run-report paths are QUERY-SCOPED (spec row 18) so an interactive
 * run cannot false-skip against a manifest written for a DIFFERENT query (e.g. the
 * shipped imports batch) — the Phase-8-review defect. Same-query resume is kept:
 * an identical plan yields an identical path.
 */
export function applyRunPlan(config: AppConfig, answers: RunPlanAnswers): AppConfig {
  return {
    ...config,
    filters: {
      ...config.filters,
      tradeFlow: answers.tradeFlow,
      viewBy: answers.viewBy,
      frequency: answers.frequency,
      source: answers.dataSource,
      dataType: answers.dataType,
      currency: answers.currency,
    },
    datePolicy: {
      ...config.datePolicy,
      requestedStart: answers.requestedStart,
      requestedEnd: answers.requestedEnd,
    },
    filenameTemplate: DEFAULT_INTERACTIVE_FILENAME_TEMPLATE,
    manifestFile: config.manifestFile ? scopePathByQuery(config.manifestFile, answers) : config.manifestFile,
    runReportFile: config.runReportFile ? scopePathByQuery(config.runReportFile, answers) : config.runReportFile,
  };
}

/** A one-line human summary of the chosen query (spec row 13 "recorded"). */
export function describePlan(a: RunPlanAnswers): string {
  return (
    `dataset=${a.dataset} flow=${a.tradeFlow} viewBy=${a.viewBy} ` +
    `range=${a.requestedStart}-${a.requestedEnd} freq=${a.frequency} ` +
    `source=${a.dataSource} dataType=${a.dataType} currency=${a.currency} numbers=${a.numbersDisplay}`
  );
}
