import { strict as assert } from 'node:assert';
import { Page } from 'playwright';
import { AppConfig, BATCH_DEFAULTS, FiltersConfig } from './schema';
import {
  applyRunPlan,
  describePlan,
  RunPlanAnswers,
  DEFAULT_INTERACTIVE_FILENAME_TEMPLATE,
  DATASET_UNSUPPORTED_MESSAGE,
} from './runPlan';
import { generateFilename, deriveFlowTokens } from '../files/filename';
import {
  Ask,
  parseMenuChoice,
  parseTimeRange,
  parseYesNo,
  defaultIndexForLabel,
  renderMenu,
  confirmProceed,
  collectRunPlan,
} from '../cli/prompt';
import { readLiveOptions } from '../trademap/optionsReader';
import { Logger } from '../orchestrator/runCountry';

// ---------------------------------------------------------------------------
// Phase 8 demo harness. Proves the interactive query builder deterministically
// with ZERO browser: the pure run-plan/filename/parser logic, the whole prompt
// FLOW driven by a scripted `Ask`, and the options-reader fallback against a
// fake page. Run: `npm run test:runplan`. Exits non-zero on any failure.
// ---------------------------------------------------------------------------

let passed = 0;
const failures: string[] = [];

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    process.stdout.write(`  PASS  ${name}\n`);
  } catch (e) {
    failures.push(`${name}: ${(e as Error).message}`);
    process.stdout.write(`  FAIL  ${name}\n`);
  }
}

const noLog: Logger = () => undefined;

/** A scripted Ask: returns queued answers in order, then '' (bare ENTER) forever. */
function scriptedAsk(answers: string[]): Ask {
  let i = 0;
  return async () => (i < answers.length ? answers[i++] : '');
}

/** A fake page where every locator is invisible/empty → optionsReader falls back,
 *  and isLoginPage() reads "not the login page" (no url/password/banner signal). */
function fakeLoggedInPage(): Page {
  const loc: Record<string, unknown> = {
    first: () => loc,
    isVisible: async () => false,
    innerText: async () => '',
    allInnerTexts: async () => [] as string[],
  };
  return {
    url: () => 'https://www.trademap.org/en/goods/time-series/imports/c/699/c/000/p/ALL/byPartner/month/200001-202606/mirror/values/USD/table',
    keyboard: { press: async () => undefined },
    locator: () => loc,
  } as unknown as Page;
}

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

function cfg(): AppConfig {
  return {
    tradeMapBaseUrl: 'https://www.trademap.org',
    outputDirectory: './output',
    browserProfileDir: './browser-profile',
    logsDir: './logs',
    countryCodesFile: './config/country-codes.json',
    filters: { ...FILTERS },
    datePolicy: { requestedStart: '200001', requestedEnd: '202606', mode: 'MAX_WITHIN_REQUESTED_RANGE' },
    download: { format: 'xlsx', overwrite: false, timeoutMs: 1000, downloadAttempts: 1 },
    batch: { ...BATCH_DEFAULTS },
    filenameTemplate: '{country}.{extension}',
    runReportFile: undefined,
    manifestFile: undefined,
  };
}

const DEFAULT_RANGE = { start: '200001', end: '202606' };

/** The all-defaults answers (bare ENTER everywhere) the flow should produce. */
const DEFAULT_ANSWERS: RunPlanAnswers = {
  dataset: 'time-series',
  tradeFlow: 'imports',
  viewBy: 'exporter',
  frequency: 'monthly',
  requestedStart: '200001',
  requestedEnd: '202606',
  dataSource: 'mirror',
  dataType: 'values',
  currency: 'USD',
  numbersDisplay: 'smart',
};

void (async () => {
  // -------------------------------------------------------------------------
  process.stdout.write('\napplyRunPlan (pure + isolation):\n');

  await check('applyRunPlan overrides only the chosen query inputs (rows 5,7,8,10,11,12,16)', () => {
    const answers: RunPlanAnswers = {
      ...DEFAULT_ANSWERS,
      tradeFlow: 'exports',
      viewBy: 'product',
      frequency: 'yearly',
      requestedStart: '201501',
      requestedEnd: '202012',
      dataSource: 'direct',
      dataType: 'quantities',
      currency: 'EUR',
    };
    const eff = applyRunPlan(cfg(), answers);
    assert.equal(eff.filters.tradeFlow, 'exports');
    assert.equal(eff.filters.viewBy, 'product');
    assert.equal(eff.filters.frequency, 'yearly');
    assert.equal(eff.filters.source, 'direct');
    assert.equal(eff.filters.dataType, 'quantities');
    assert.equal(eff.filters.currency, 'EUR');
    assert.equal(eff.datePolicy.requestedStart, '201501');
    assert.equal(eff.datePolicy.requestedEnd, '202012');
    assert.equal(eff.filenameTemplate, DEFAULT_INTERACTIVE_FILENAME_TEMPLATE);
    // Row 6: partner (World/000), product, and view are LEFT UNTOUCHED.
    assert.equal(eff.filters.exporter, 'world');
    assert.equal(eff.filters.exporterCode, '000');
    assert.equal(eff.filters.product, 'ALL');
    assert.equal(eff.filters.view, 'table');
  });

  await check('applyRunPlan does NOT mutate the input config (isolation, convention #2)', () => {
    const original = cfg();
    applyRunPlan(original, { ...DEFAULT_ANSWERS, tradeFlow: 'exports', requestedStart: '201501' });
    assert.equal(original.filters.tradeFlow, 'imports'); // unchanged
    assert.equal(original.datePolicy.requestedStart, '200001'); // unchanged
    assert.equal(original.filenameTemplate, '{country}.{extension}'); // unchanged
  });

  // -------------------------------------------------------------------------
  process.stdout.write('\nFlow-aware filename (row 16):\n');

  await check('deriveFlowTokens maps flow/view/time/source; unknown passes through lower-cased', () => {
    assert.deepEqual(deriveFlowTokens({ tradeFlow: 'Exports', viewBy: 'Exporter', frequency: 'Monthly', source: 'Mirror' }), {
      flowWord: 'export',
      viewWord: 'country',
      timeWord: 'monthly',
      sourceWord: 'mirror',
    });
    assert.equal(deriveFlowTokens({ tradeFlow: 'reexports', viewBy: 'x', frequency: 'y', source: 'z' }).flowWord, 'reexports');
  });

  await check('interactive template renders india-export-country…', () => {
    const name = generateFilename(DEFAULT_INTERACTIVE_FILENAME_TEMPLATE, {
      countrySlug: 'india',
      startPretty: '2001-01',
      endPretty: '2026-06',
      currency: 'USD',
      extension: 'xlsx',
      ...deriveFlowTokens({ tradeFlow: 'exports', viewBy: 'exporter', frequency: 'monthly', source: 'mirror' }),
    });
    assert.equal(name, 'india-export-country__2001-01_to_2026-06__monthly-mirror-USD.xlsx');
  });

  await check('imports renders india-import-country…', () => {
    const name = generateFilename(DEFAULT_INTERACTIVE_FILENAME_TEMPLATE, {
      countrySlug: 'india',
      startPretty: '2001-01',
      endPretty: '2026-06',
      currency: 'USD',
      extension: 'xlsx',
      ...deriveFlowTokens({ tradeFlow: 'imports', viewBy: 'exporter', frequency: 'monthly', source: 'mirror' }),
    });
    assert.equal(name, 'india-import-country__2001-01_to_2026-06__monthly-mirror-USD.xlsx');
  });

  // -------------------------------------------------------------------------
  process.stdout.write('\nPure parsers (row 17):\n');

  await check('parseMenuChoice: ENTER→default, valid→idx, out-of-range/garbage→null', () => {
    assert.equal(parseMenuChoice('', 3, 2), 2); // bare ENTER → default index
    assert.equal(parseMenuChoice('1', 3, 0), 0);
    assert.equal(parseMenuChoice('3', 3, 0), 2);
    assert.equal(parseMenuChoice('0', 3, 0), null);
    assert.equal(parseMenuChoice('4', 3, 0), null);
    assert.equal(parseMenuChoice('x', 3, 0), null);
    assert.equal(parseMenuChoice('1.5', 3, 0), null);
  });

  await check('parseTimeRange: ENTER→default(usedDefault), valid→parsed, reversed/bad→null', () => {
    assert.deepEqual(parseTimeRange('', DEFAULT_RANGE), { start: '200001', end: '202606', usedDefault: true });
    assert.deepEqual(parseTimeRange('201501-202012', DEFAULT_RANGE), { start: '201501', end: '202012', usedDefault: false });
    assert.deepEqual(parseTimeRange(' 201501 - 202012 ', DEFAULT_RANGE), { start: '201501', end: '202012', usedDefault: false });
    assert.equal(parseTimeRange('202012-201501', DEFAULT_RANGE), null); // reversed
    assert.equal(parseTimeRange('201513-202012', DEFAULT_RANGE), null); // month 13
    assert.equal(parseTimeRange('2015-2020', DEFAULT_RANGE), null); // not YYYYMM
    assert.equal(parseTimeRange('garbage', DEFAULT_RANGE), null);
  });

  await check('parseYesNo: ENTER→default, y/n variants, garbage→null', () => {
    assert.equal(parseYesNo('', true), true);
    assert.equal(parseYesNo('', false), false);
    assert.equal(parseYesNo('y', false), true);
    assert.equal(parseYesNo('YES', false), true);
    assert.equal(parseYesNo('n', true), false);
    assert.equal(parseYesNo('no', true), false);
    assert.equal(parseYesNo('maybe', true), null);
  });

  await check('defaultIndexForLabel: found→index, missing→fallback', () => {
    assert.equal(defaultIndexForLabel(['Direct', 'Mirror'], 'Mirror', 0), 1);
    assert.equal(defaultIndexForLabel(['Values', 'Quantities'], 'values', 0), 0);
    assert.equal(defaultIndexForLabel(['A', 'B'], 'Zzz', 0), 0); // not found → fallback
  });

  await check('renderMenu marks the default option', () => {
    const menu = renderMenu('Trade flow', ['Imports', 'Exports'], 0);
    assert.match(menu, /1\) Imports {2}\(default\)/);
    assert.match(menu, /2\) Exports/);
    assert.doesNotMatch(menu, /2\) Exports {2}\(default\)/);
  });

  // -------------------------------------------------------------------------
  process.stdout.write('\noptionsReader fallback (row 14):\n');

  await check('readLiveOptions returns the fallback list + logs options.fallback when uncalibrated', async () => {
    const events: string[] = [];
    const log: Logger = (_l, e) => void events.push(e);
    const res = await readLiveOptions(fakeLoggedInPage(), { key: 'currency', triggerLabel: 'Currency', fallback: ['USD', 'EUR'] }, log);
    assert.equal(res.source, 'fallback');
    assert.deepEqual(res.options, ['USD', 'EUR']);
    assert.ok(events.includes('options.fallback'), 'expected an options.fallback log event');
  });

  // -------------------------------------------------------------------------
  process.stdout.write('\nInteractive flow (scripted Ask, fake page):\n');

  await check('all-default answers (bare ENTER) → the confirmed defaults', async () => {
    const answers = await collectRunPlan(scriptedAsk([]), fakeLoggedInPage(), DEFAULT_RANGE, noLog);
    assert.deepEqual(answers, DEFAULT_ANSWERS);
  });

  await check('choosing a non-Time-series dataset throws DATASET_UNSUPPORTED (row 4)', async () => {
    await assert.rejects(
      () => collectRunPlan(scriptedAsk(['2']), fakeLoggedInPage(), DEFAULT_RANGE, noLog),
      (e: Error) => e.message === DATASET_UNSUPPORTED_MESSAGE,
    );
  });

  await check('scripted Exports + custom range → answers feed applyRunPlan → exports filename', async () => {
    // dataset ENTER, flow '2' (Exports), view ENTER, time ENTER (monthly),
    // range '201501-202012', source ENTER, type ENTER, currency ENTER, numbers ENTER.
    const answers = await collectRunPlan(scriptedAsk(['', '2', '', '', '201501-202012']), fakeLoggedInPage(), DEFAULT_RANGE, noLog);
    assert.equal(answers.tradeFlow, 'exports');
    assert.equal(answers.requestedStart, '201501');
    assert.equal(answers.requestedEnd, '202012');
    const eff = applyRunPlan(cfg(), answers);
    const name = generateFilename(eff.filenameTemplate, {
      countrySlug: 'india',
      startPretty: '2015-01',
      endPretty: '2020-12',
      currency: eff.filters.currency,
      extension: eff.download.format,
      ...deriveFlowTokens(eff.filters),
    });
    assert.match(name, /^india-export-country__/);
    assert.ok(describePlan(answers).includes('flow=exports'));
  });

  await check('confirmProceed: ENTER→true, n→false, garbage then y re-prompts→true', async () => {
    assert.equal(await confirmProceed(scriptedAsk(['']), 5), true);
    assert.equal(await confirmProceed(scriptedAsk(['n']), 5), false);
    assert.equal(await confirmProceed(scriptedAsk(['garbage', 'y']), 5), true);
  });

  // -------------------------------------------------------------------------
  process.stdout.write(`\nRun-plan harness: ${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) {
    for (const f of failures) process.stdout.write(`  - ${f}\n`);
    process.exit(1);
  }
  process.stdout.write('ALL PASS\n');
})();
