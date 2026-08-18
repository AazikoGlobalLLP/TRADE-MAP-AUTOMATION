import * as fs from 'fs';
import * as path from 'path';
import { launchSession } from './auth/session';
import { AppConfig } from './config/schema';
import { loadConfig } from './config/loadConfig';
import { RequestedRange } from './trademap/rangeEngine';
import { runCountry, Logger } from './orchestrator/runCountry';
import { readCountries } from './input/readCountries';
import { runBatch, renderSummaryTable } from './orchestrator/runBatch';
import { writeRunReport } from './report/runReport';

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
  const force = hasFlag('force'); // Phase 5 (§36): ignore the resume manifest + overwrite existing files
  const country = getArg('country') ?? 'Dominica';
  const runId = getArg('run-id') ?? new Date().toISOString().replace(/[:.]/g, '-');
  const configPath = getArg('config') ?? path.resolve('config/config.json');

  const config: AppConfig = loadConfig(configPath);
  const log = makeLogger(path.join(config.logsDir, 'runs', `${runId}.log`));
  log('info', 'run.start', {
    runId,
    mode: config.datePolicy.mode,
    ...(force ? { force: true } : {}),
    ...(batchMode ? { batch: true } : { country }),
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

  // In batch mode, read + normalise the ordered country list BEFORE launching the
  // browser, so a bad/empty input file fails fast (exit 2) without a browser.
  const inputFile = getArg('countries') ?? config.batch.inputFile;
  const countries = batchMode ? await readCountries(path.resolve(inputFile), log) : [];

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
  // A bad/empty batch input file is an abort (exit 2), not a run failure (exit 1) — spec row 3.
  process.exitCode = /BATCH_EMPTY|BATCH_INPUT_MISSING/.test(message) ? 2 : 1;
});
