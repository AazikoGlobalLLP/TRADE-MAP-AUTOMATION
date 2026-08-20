import * as fs from 'fs';
import * as path from 'path';
import { launchSession } from './auth/session';
import { AppConfig } from './config/schema';
import { loadConfig } from './config/loadConfig';
import { RequestedRange } from './trademap/rangeEngine';
import { runCountry, Logger } from './orchestrator/runCountry';
import { readCountries } from './input/readCountries';
import { loadManifest, failedCountries } from './manifest/manifest';
import { runBatch, renderSummaryTable } from './orchestrator/runBatch';
import { writeRunReport } from './report/runReport';
import { confirmProceed, collectRunPlan, createStdinAsk } from './cli/prompt';
import { applyRunPlan, describePlan } from './config/runPlan';
import { resolveDetailUrlToken } from './trademap/driver';

// ---------------------------------------------------------------------------
// Tiny CLI arg reader: --key value
// ---------------------------------------------------------------------------
function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined;
}

/** Boolean flag: present anywhere in argv (e.g. `--batch`). */
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

// ---------------------------------------------------------------------------
// Structured logger. JSON lines to stdout + logs/runs/<runId>.log. Never logs secrets.
// ---------------------------------------------------------------------------
function makeLogger(logFile: string): Logger {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  return (level, event, data = {}) => {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...data });
    process.stdout.write(line + '\n');
    fs.appendFileSync(logFile, line + '\n');
  };
}

async function main(): Promise<void> {
  const batchMode = hasFlag('batch');
  const interactive = process.argv.includes('--interactive') || process.argv.includes('-i'); // Phase 8
  const force = hasFlag('force'); // Phase 5 (§36): ignore the resume manifest + overwrite existing files
  const retryFailed = hasFlag('retry-failed'); // Phase 9B: re-run ONLY the manifest's FAILED countries
  const country = getArg('country') ?? 'Dominica';
  const runId = getArg('run-id') ?? new Date().toISOString().replace(/[:.]/g, '-');
  const configPath = getArg('config') ?? path.resolve('config/config.json');

  const config: AppConfig = loadConfig(configPath);
  const log = makeLogger(path.join(config.logsDir, 'runs', `${runId}.log`));
  log('info', 'run.start', {
    runId,
    mode: config.datePolicy.mode,
    ...(force ? { force: true } : {}),
    ...(interactive ? { interactive: true } : batchMode ? { batch: true } : { country }),
  });

  // Load the local country-code map (PRD §7). Resolution runs AFTER the browser launches
  // so the UI-search fallback (name not in the map) has a live page to search on.
  const codes: Record<string, string> = JSON.parse(
    fs.readFileSync(path.resolve(config.countryCodesFile), 'utf8'),
  );

  // The GLOBAL requested range is immutable for the whole run (PRD §4A, convention #2).
  // Freeze it so no per-country job can mutate it — the isolation guarantee is structural,
  // not just a comment. runCountry() receives it by value and only ever reads it.
  const global: RequestedRange = Object.freeze({
    requestedStart: config.datePolicy.requestedStart,
    requestedEnd: config.datePolicy.requestedEnd,
  });

  // -------------------------------------------------------------------------
  // Phase 8 — interactive dynamic query builder (spec: docs/spec/phase-8-*).
  // Confirm the country count + TTY BEFORE launching a browser (spec rows 2,3),
  // then read the live-DOM prompts AFTER launch (spec row 17) and drive the
  // EXISTING batch engine with the resulting run plan (spec row 15).
  // -------------------------------------------------------------------------
  if (interactive) {
    // Row 2 — a headed, question/answer run needs a real terminal; refuse otherwise.
    if (!process.stdin.isTTY) {
      process.stderr.write('INTERACTIVE_REQUIRES_TTY: --interactive needs a real terminal (stdin is not a TTY).\n');
      process.exitCode = 2;
      return;
    }
    // Row 3 — read the ordered country list + confirm the count, PRE-launch.
    const listFile = getArg('countries') ?? config.batch.inputFile;
    const listCountries = await readCountries(path.resolve(listFile), log);
    const { ask, close } = createStdinAsk();
    try {
      if (!(await confirmProceed(ask, listCountries.length))) {
        log('info', 'interactive.aborted', { reason: 'user_declined' });
        process.exitCode = 0;
        return;
      }
      // Rows 4-13 — launch, THEN collect the live-DOM prompts.
      const { context, page } = await launchSession(config.browserProfileDir, config.tradeMapBaseUrl);
      try {
        const answers = await collectRunPlan(
          ask,
          page,
          { start: global.requestedStart, end: global.requestedEnd },
          log,
        );
        log('info', 'plan.confirmed', { plan: describePlan(answers) });

        // Phase 9 (spec rows 21,22) — byProduct (View by = Product) needs a Detail URL token.
        // Resolve it BEFORE any browser export so an uncaptured token (NTL) refuses the whole
        // run up front instead of hitting every country. The user chose "hard-error" over
        // silently substituting HS6; HS2/HS4/HS6 resolve fine. Never invents a token (CLAUDE.md).
        if (answers.viewBy === 'product') {
          try {
            resolveDetailUrlToken(answers.detail ?? '');
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            log('error', 'plan.detail_unsupported', { detail: answers.detail, error: msg });
            process.stderr.write(msg + '\n');
            process.exitCode = 2;
            return;
          }
        }

        // Row 15 — answers → effective config; the untouched engine runs it. The
        // plan's range is the new immutable GLOBAL for this run (convention #2).
        const effectiveConfig = applyRunPlan(config, answers);
        const effectiveGlobal: RequestedRange = Object.freeze({
          requestedStart: effectiveConfig.datePolicy.requestedStart,
          requestedEnd: effectiveConfig.datePolicy.requestedEnd,
        });
        const rangeStr = `${effectiveGlobal.requestedStart}-${effectiveGlobal.requestedEnd}`;

        const summary = await runBatch(
          page,
          listCountries,
          effectiveGlobal,
          effectiveConfig,
          codes,
          log,
          runId,
          undefined,
          force,
        );

        // Phase 6 (§31) run report — same best-effort write as the batch path.
        if (effectiveConfig.runReportFile) {
          try {
            await writeRunReport(path.resolve(effectiveConfig.runReportFile), summary, rangeStr, {
              generatedAt: new Date().toISOString(),
              sessionExpired: summary.sessionExpired,
              abortReason: summary.abortReason,
            });
            log('info', 'report.written', { file: effectiveConfig.runReportFile });
          } catch (e) {
            log('error', 'report.write_failed', { error: e instanceof Error ? e.message : String(e) });
          }
        }

        process.stdout.write('\n' + renderSummaryTable(summary) + '\n');
        if (summary.sessionExpired) {
          process.stdout.write('\n[SESSION EXPIRED] ' + (summary.abortReason ?? '') + '\n');
        }
        process.exitCode = summary.exitCode;
      } finally {
        await context.close();
      }
    } finally {
      close(); // release readline whether we finished, declined, or threw
    }
    return;
  }

  // In batch mode, read + normalise the ordered country list BEFORE launching the
  // browser, so a bad/empty input file fails fast (exit 2) without a browser.
  const inputFile = getArg('countries') ?? config.batch.inputFile;
  let countries = batchMode ? await readCountries(path.resolve(inputFile), log) : [];

  // Phase 9B: `--retry-failed` narrows the run to ONLY the countries the manifest recorded as FAILED,
  // so a re-run touches just those (no re-validating every large SUCCESS workbook). Resumes normally
  // otherwise. Requires a manifest; an empty result is a clean exit-0 "nothing to retry".
  if (batchMode && retryFailed) {
    if (!config.manifestFile) {
      process.stderr.write('RETRY_FAILED_NO_MANIFEST: --retry-failed needs a manifestFile in the config.\n');
      process.exitCode = 2;
      return;
    }
    const requestedRange = `${global.requestedStart}-${global.requestedEnd}`;
    const manifest = loadManifest(path.resolve(config.manifestFile), runId, requestedRange, new Date().toISOString());
    const failedSet = new Set(failedCountries(manifest).map((c) => c.trim().toLowerCase()));
    const fromInput = countries.length;
    countries = countries.filter((c) => failedSet.has(c.trim().toLowerCase()));
    log('info', 'batch.retry_failed', { failedInManifest: failedSet.size, willRetry: countries.length, ofInput: fromInput });
    if (countries.length === 0) {
      process.stdout.write('\nNo FAILED countries in the manifest to retry — nothing to do.\n');
      process.exitCode = 0;
      return;
    }
    process.stdout.write(`\nRetrying ${countries.length} FAILED countries only.\n`);
  }

  const { context, page } = await launchSession(config.browserProfileDir, config.tradeMapBaseUrl);
  try {
    if (batchMode) {
      // Phase 4: sequential batch over runCountry() with per-country retry + failure evidence.
      // Phase 5: resume manifest + idempotency skip + collision modes (`force` bypasses the skip).
      const summary = await runBatch(page, countries, global, config, codes, log, runId, undefined, force);

      // Phase 6 (§31): emit the human-readable run report. Best-effort — a report
      // write failure must never mask the actual run result (same rule as the manifest).
      if (config.runReportFile) {
        try {
          await writeRunReport(
            path.resolve(config.runReportFile),
            summary,
            `${global.requestedStart}-${global.requestedEnd}`,
            { generatedAt: new Date().toISOString(), sessionExpired: summary.sessionExpired, abortReason: summary.abortReason },
          );
          log('info', 'report.written', { file: config.runReportFile });
        } catch (e) {
          log('error', 'report.write_failed', { error: e instanceof Error ? e.message : String(e) });
        }
      }

      process.stdout.write('\n' + renderSummaryTable(summary) + '\n');
      // Phase 6 (§28/AC-08): make an expired session impossible to miss on the console.
      if (summary.sessionExpired) {
        process.stdout.write('\n[SESSION EXPIRED] ' + (summary.abortReason ?? '') + '\n');
      }
      process.exitCode = summary.exitCode; // 0 all ok · 1 any FAILED · 2 aborted/empty
      return;
    }

    // Single-country path (unchanged from Phase 3): `npm run export -- --country X`.
    // `--force` still forces overwrite here (there is no manifest in single-country mode).
    const result = await runCountry(page, country, global, config, codes, log, {
      collisionMode: force ? 'overwrite' : undefined,
    });
    log('info', 'run.done', {
      country: result.country,
      status: result.status,
      requestedRange: result.requestedRange,
      effectiveRange: result.effectiveRange,
      rangeStatus: result.rangeStatus,
      file: result.targetPath,
    });
  } finally {
    await context.close();
  }
}

main().catch((err: unknown) => {
  // One consistent failure surface: log, then exit non-zero so no false SUCCESS (AC-09).
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(
    JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'run.failed', error: message }) + '\n',
  );
  // A bad/empty batch input file — or a Phase 8 dataset/TTY abort, or a Phase 9 uncaptured/absent
  // byProduct Detail token — is an abort (exit 2), not a run failure (exit 1). (Phase 4 spec row 3;
  // Phase 8 spec rows 2,4; Phase 9 spec rows 21,22.)
  process.exitCode = /BATCH_EMPTY|BATCH_INPUT_MISSING|DATASET_UNSUPPORTED|INTERACTIVE_REQUIRES_TTY|DETAIL_TOKEN_UNCAPTURED|DETAIL_REQUIRED/.test(
    message,
  )
    ? 2
    : 1;
});
