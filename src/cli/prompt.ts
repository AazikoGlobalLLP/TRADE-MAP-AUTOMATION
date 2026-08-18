import * as readline from 'readline';
import { Page } from 'playwright';
import { isLoginPage } from '../auth/session';
import { readLiveOptions, OptionControl } from '../trademap/optionsReader';
import {
  RunPlanAnswers,
  DatasetKey,
  DATASET_OPTIONS,
  DATASET_KEYS,
  DATASET_DEFAULT_INDEX,
  DATASET_UNSUPPORTED_MESSAGE,
  TRADE_FLOW_OPTIONS,
  TRADE_FLOW_DEFAULT_INDEX,
  VIEW_BY_OPTIONS,
  VIEW_BY_DEFAULT_INDEX,
  FREQUENCY_OPTIONS,
  FREQUENCY_DEFAULT_INDEX,
  DATA_SOURCE_OPTIONS_FALLBACK,
  DATA_SOURCE_DEFAULT_LABEL,
  DATA_TYPE_OPTIONS_FALLBACK,
  DATA_TYPE_DEFAULT_LABEL,
  CURRENCY_OPTIONS_FALLBACK,
  CURRENCY_DEFAULT_LABEL,
  NUMBERS_DISPLAY_OPTIONS,
  NUMBERS_DISPLAY_DEFAULT_INDEX,
} from '../config/runPlan';

// ---------------------------------------------------------------------------
// Phase 8 — Interactive CLI prompts (spec rows 3,4,5,7,8,9,10,11,12,13,17).
//
// Two layers, kept apart so the flow is testable without a real terminal:
//   • PURE parsers (parseMenuChoice / parseTimeRange / parseYesNo / renderMenu /
//     defaultIndexForLabel) — proven by `npm run test:runplan`.
//   • An async flow (`confirmProceed`, `collectRunPlan`) that takes an injectable
//     `Ask` (a `question → answer` function). Production uses `createStdinAsk()`
//     (readline); the test harness injects a scripted `Ask` to drive whole runs.
//
// UX (spec row 17): numbered menus, bare ENTER = the (default) option, an invalid
// entry RE-PROMPTS (never crashes, never proceeds on garbage). All of this runs
// AFTER the browser launches, against the live DOM; only confirmProceed is
// pre-launch (spec row 3) — the caller enforces that ordering.
// ---------------------------------------------------------------------------

/** Matches the structured logger created in index.ts (structural typing). */
type Logger = (level: 'info' | 'warn' | 'error', event: string, data?: Record<string, unknown>) => void;

/** A single question → answer. Injectable so the flow is testable without stdin. */
export type Ask = (question: string) => Promise<string>;

// --- Pure parsers -----------------------------------------------------------

/**
 * PURE. Parse a menu answer into a 0-based index. Bare input → `defaultIndex`.
 * Anything that is not an integer in `[1, optionCount]` → `null` (caller re-prompts).
 */
export function parseMenuChoice(input: string, optionCount: number, defaultIndex: number): number | null {
  const s = input.trim();
  if (s === '') return defaultIndex;
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (n < 1 || n > optionCount) return null;
  return n - 1;
}

function isYyyymm(s: string): boolean {
  if (!/^\d{6}$/.test(s)) return false;
  const month = Number(s.slice(4, 6));
  return month >= 1 && month <= 12;
}

/**
 * PURE. Parse a `YYYYMM-YYYYMM` time range. Bare input → `dflt` (the config MAX,
 * spec row 10). Malformed / reversed / out-of-month-range → `null` (re-prompt).
 */
export function parseTimeRange(
  input: string,
  dflt: { start: string; end: string },
): { start: string; end: string; usedDefault: boolean } | null {
  const s = input.trim();
  if (s === '') return { ...dflt, usedDefault: true };
  const m = /^(\d{6})\s*-\s*(\d{6})$/.exec(s);
  if (!m) return null;
  const [, start, end] = m;
  if (!isYyyymm(start) || !isYyyymm(end) || start > end) return null;
  return { start, end, usedDefault: false };
}

/** PURE. Yes/no with a default on bare ENTER; unrecognised → `null` (re-prompt). */
export function parseYesNo(input: string, dflt: boolean): boolean | null {
  const s = input.trim().toLowerCase();
  if (s === '') return dflt;
  if (s === 'y' || s === 'yes') return true;
  if (s === 'n' || s === 'no') return false;
  return null;
}

/** PURE. Index of the first case-insensitive label match, else `fallbackIndex`. */
export function defaultIndexForLabel(options: string[], preferredLabel: string, fallbackIndex: number): number {
  const want = preferredLabel.trim().toLowerCase();
  const i = options.findIndex((o) => o.trim().toLowerCase() === want);
  return i >= 0 ? i : Math.min(fallbackIndex, Math.max(0, options.length - 1));
}

/** PURE. Render a numbered menu with the default marked. */
export function renderMenu(title: string, options: readonly string[], defaultIndex: number): string {
  const lines = options.map((o, i) => `  ${i + 1}) ${o}${i === defaultIndex ? '  (default)' : ''}`);
  return `\n${title} (1-${options.length}, ENTER = default):\n${lines.join('\n')}\n> `;
}

// --- Async flow -------------------------------------------------------------

/** Ask a numbered menu until a valid choice is given; returns the chosen 0-based index. */
async function chooseFromMenu(
  ask: Ask,
  title: string,
  options: readonly string[],
  defaultIndex: number,
): Promise<number> {
  let prompt = renderMenu(title, options, defaultIndex);
  // Bounded re-prompt loop: a valid answer (incl. bare ENTER) returns; garbage re-asks.
  for (;;) {
    const answer = await ask(prompt);
    const idx = parseMenuChoice(answer, options.length, defaultIndex);
    if (idx !== null) return idx;
    prompt = `  Please enter a number 1-${options.length} (or ENTER for the default).\n> `;
  }
}

/**
 * Pre-launch confirmation (spec row 3). ENTER/`y` proceeds, `n` aborts.
 * The count is the number of countries read from the input list.
 */
export async function confirmProceed(ask: Ask, count: number): Promise<boolean> {
  let prompt = `\nAbout to export data for ${count} ${count === 1 ? 'country' : 'countries'} — proceed? [Y/n] `;
  for (;;) {
    const answer = await ask(prompt);
    const yn = parseYesNo(answer, true);
    if (yn !== null) return yn;
    prompt = '  Please answer y or n (or ENTER to proceed).\n> ';
  }
}

/** Live-read a control's option list, then let the user pick; returns the chosen label. */
async function chooseLiveOption(
  ask: Ask,
  page: Page,
  log: Logger,
  title: string,
  control: OptionControl,
  preferredDefaultLabel: string,
): Promise<string> {
  const { options } = await readLiveOptions(page, control, log);
  const defaultIndex = defaultIndexForLabel(options, preferredDefaultLabel, 0);
  const idx = await chooseFromMenu(ask, title, options, defaultIndex);
  return options[idx];
}

/**
 * Run the ordered interactive questionnaire against the LIVE page and return the
 * chosen RunPlanAnswers. Throws `DATASET_UNSUPPORTED` (→ exit 2) for a dataset
 * Phase 8 does not build. Every value comes from a user choice or a locked
 * default — nothing is invented.
 */
export async function collectRunPlan(
  ask: Ask,
  page: Page,
  defaultRange: { start: string; end: string },
  log: Logger,
): Promise<RunPlanAnswers> {
  // Row 4 — Dataset. Only Time series is built this phase.
  const datasetIdx = await chooseFromMenu(ask, 'Dataset', DATASET_OPTIONS, DATASET_DEFAULT_INDEX);
  const dataset: DatasetKey = DATASET_KEYS[datasetIdx];
  if (dataset !== 'time-series') {
    throw new Error(DATASET_UNSUPPORTED_MESSAGE);
  }

  // Row 5 — Trade flow.
  const flowIdx = await chooseFromMenu(ask, 'Trade flow', TRADE_FLOW_OPTIONS, TRADE_FLOW_DEFAULT_INDEX);
  const tradeFlow = TRADE_FLOW_OPTIONS[flowIdx].toLowerCase(); // 'imports' | 'exports'

  // Row 7 — View by. (Row 6: Importer/Product are left default, never prompted.
  //          Row 7: Detail is not prompted when View by = Exporter.)
  const viewIdx = await chooseFromMenu(ask, 'View by', VIEW_BY_OPTIONS, VIEW_BY_DEFAULT_INDEX);
  const viewBy = VIEW_BY_OPTIONS[viewIdx].toLowerCase(); // 'exporter' | 'product'

  // Row 8 — Time (frequency).
  const freqIdx = await chooseFromMenu(ask, 'Time', FREQUENCY_OPTIONS, FREQUENCY_DEFAULT_INDEX);
  const frequency = FREQUENCY_OPTIONS[freqIdx].toLowerCase(); // 'yearly' | 'quarterly' | 'monthly'

  // Row 9 — Monthly login signal. Soft WARN only; never hard-fail.
  if (frequency === 'monthly' && (await isLoginPage(page).catch(() => false))) {
    const warning = 'Monthly data needs a login — log in when the run pauses';
    log('warn', 'auth.monthly_login_warning', { message: warning });
    process.stdout.write(`\n[WARNING] ${warning}\n`);
  }

  // Row 10 — Time range. Bare ENTER → config MAX (logged as `default`).
  const range = await promptTimeRange(ask, defaultRange, log);

  // Row 11 — Data source, then Data type (read live, fall back if uncalibrated).
  const dataSourceLabel = await chooseLiveOption(
    ask,
    page,
    log,
    'Data source',
    { key: 'dataSource', triggerLabel: 'Data source', fallback: DATA_SOURCE_OPTIONS_FALLBACK },
    DATA_SOURCE_DEFAULT_LABEL,
  );
  const dataTypeLabel = await chooseLiveOption(
    ask,
    page,
    log,
    'Data type',
    { key: 'dataType', triggerLabel: 'Data type', fallback: DATA_TYPE_OPTIONS_FALLBACK },
    DATA_TYPE_DEFAULT_LABEL,
  );

  // Row 12 — Currency (read live).
  const currencyLabel = await chooseLiveOption(
    ask,
    page,
    log,
    'Currency',
    { key: 'currency', triggerLabel: 'Currency', fallback: CURRENCY_OPTIONS_FALLBACK },
    CURRENCY_DEFAULT_LABEL,
  );

  // Row 13 — Numbers display (static list; recorded, not URL-driven).
  const numbersIdx = await chooseFromMenu(ask, 'Numbers display', NUMBERS_DISPLAY_OPTIONS, NUMBERS_DISPLAY_DEFAULT_INDEX);
  const numbersDisplay = NUMBERS_DISPLAY_OPTIONS[numbersIdx].toLowerCase();

  return {
    dataset,
    tradeFlow,
    viewBy,
    frequency,
    requestedStart: range.start,
    requestedEnd: range.end,
    dataSource: dataSourceLabel.toLowerCase(), // 'mirror' | 'direct' → filters.source
    dataType: dataTypeLabel.toLowerCase(), // 'values' | 'quantities' | …
    currency: currencyLabel.trim(), // 'USD' | 'EUR' — currency codes keep their case
    numbersDisplay,
  };
}

/** Ask the time range until valid; logs `plan.time_range` with whether the default was used. */
async function promptTimeRange(
  ask: Ask,
  dflt: { start: string; end: string },
  log: Logger,
): Promise<{ start: string; end: string }> {
  let prompt = `\nTime range YYYYMM-YYYYMM [ENTER = MAX ${dflt.start}-${dflt.end}]\n> `;
  for (;;) {
    const answer = await ask(prompt);
    const parsed = parseTimeRange(answer, dflt);
    if (parsed) {
      log('info', 'plan.time_range', {
        start: parsed.start,
        end: parsed.end,
        source: parsed.usedDefault ? 'default' : 'user',
      });
      return { start: parsed.start, end: parsed.end };
    }
    prompt = '  Enter as YYYYMM-YYYYMM with start ≤ end (or ENTER for MAX).\n> ';
  }
}

/**
 * Production `Ask` backed by readline over stdin/stdout. Returns the ask fn plus a
 * `close` to release the interface (call it in a finally). No credentials are ever
 * read or logged here — these are query choices only.
 */
export function createStdinAsk(): { ask: Ask; close: () => void } {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask: Ask = (question) => new Promise<string>((resolve) => rl.question(question, (a) => resolve(a)));
  return { ask, close: () => rl.close() };
}
