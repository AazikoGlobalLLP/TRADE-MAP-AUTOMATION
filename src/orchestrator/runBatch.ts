import { Page } from 'playwright';
import { AppConfig } from '../config/schema';
import { RequestedRange } from '../trademap/rangeEngine';
import { runCountry as realRunCountry, CountryResult, Logger } from './runCountry';
import { captureFailure as realCaptureFailure, EvidencePage } from '../evidence/captureFailure';
import { withRetry } from './retry';
import { resolveCollisionMode } from '../files/collision';
import { validateXlsx } from '../files/save-validate';
import {
  Manifest,
  ManifestEntry,
  emptyManifest,
  findEntry,
  loadManifest as realLoadManifest,
  upsertEntry,
  writeManifest as realWriteManifest,
} from '../manifest/manifest';
import { isAlreadyDone } from '../manifest/resume';
import { isSessionExpired, sessionExpiredAbortReason } from '../auth/expiry';

// ---------------------------------------------------------------------------
// Batch orchestrator (Phase 4, PRD §35/§36; spec-lock rows 4–6,10,13).
//
// Loop SEQUENTIALLY over the proven `runCountry()` isolation boundary. Each
// country gets up to `maxAttemptsPerCountry` tries; on every failed attempt we
// capture a screenshot+URL+filters+timestamp bundle, then move on. A single
// country's failure NEVER stops the rest (`continueOnFailure`). A dead session
// (`LOGIN_REQUIRED`) is fatal and aborts the whole batch (Phase 6 adds resume).
//
// `deps` is injected so the offline harness (`npm run test:batch`) swaps a fake
// `runCountry`/`captureFailure`/`sleep` and proves this control flow with zero
// browser — the same offline-provability trick as Phase 3's pure range core.
// Isolation is unchanged: `global` is the frozen GLOBAL range, passed BY VALUE
// to every country and never written back.
// ---------------------------------------------------------------------------

export type CountryStatus = 'SUCCESS' | 'SKIPPED' | 'FAILED';

export interface CountryOutcome {
  country: string;
  status: CountryStatus;
  skipReason?: 'ALREADY_DONE' | 'FILE_EXISTS'; // present on SKIPPED (Phase 5)
  attempts: number; // how many times runCountry actually ran (0 for a resume/idempotency skip)
  effectiveRange?: string; // present on SUCCESS/SKIPPED
  rangeStatus?: string;
  file?: string;
  targetPath?: string;
  error?: string; // present on FAILED
}

export interface BatchSummary {
  runId: string;
  total: number;
  success: number;
  skipped: number;
  failed: number;
  aborted: boolean; // a fatal error (LOGIN_REQUIRED) stopped the batch early
  abortReason?: string;
  sessionExpired: boolean; // the abort cause was an expired session (§28/AC-08) — re-login + rerun to resume
  exitCode: 0 | 1 | 2; // 0 all ok · 1 any FAILED · 2 aborted/empty
  outcomes: CountryOutcome[];
}

/** Injectable collaborators — real modules by default, fakes in the harness. The
 *  manifest collaborators (Phase 5) are OPTIONAL so a Phase-4 fake `deps` still
 *  satisfies the type; they are only consulted when a `manifestFile` is configured. */
export interface BatchDeps {
  runCountry: typeof realRunCountry;
  captureFailure: typeof realCaptureFailure;
  sleep: (ms: number) => Promise<void>;
  /** True iff the recorded target file still exists and re-validates on disk (idempotency, §36). */
  validateFile?: (targetPath: string) => Promise<boolean>;
  loadManifest?: typeof realLoadManifest;
  writeManifest?: typeof realWriteManifest;
  /** ISO timestamp source; injectable so the harness is deterministic. */
  now?: () => string;
  /** [0,1) RNG for the randomized anti-block throttle; injectable so the harness is deterministic. */
  random?: () => number;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Inclusive random integer in [lo, hi] using the injected [0,1) RNG. Returns lo when hi ≤ lo. */
function drawInt(lo: number, hi: number, rnd: () => number): number {
  if (hi <= lo) return lo;
  return lo + Math.floor(rnd() * (hi - lo + 1));
}

/** Real idempotency re-validation: `validateXlsx` throws on any problem → treat as "not done". */
const realValidateFile = async (targetPath: string): Promise<boolean> => {
  try {
    await validateXlsx(targetPath);
    return true;
  } catch {
    return false;
  }
};

export const defaultBatchDeps: BatchDeps = {
  runCountry: realRunCountry,
  captureFailure: realCaptureFailure,
  sleep: realSleep,
  validateFile: realValidateFile,
  loadManifest: realLoadManifest,
  writeManifest: realWriteManifest,
  now: () => new Date().toISOString(),
  random: () => Math.random(),
};

/** Build a manifest entry from a completed outcome (Phase 5). */
function outcomeToEntry(o: CountryOutcome, requestedRange: string, now: string): ManifestEntry {
  return {
    country: o.country,
    requestedRange,
    effectiveRange: o.effectiveRange,
    rangeStatus: o.rangeStatus,
    status: o.status,
    skipReason: o.skipReason,
    file: o.file,
    targetPath: o.targetPath,
    attempts: o.attempts,
    updatedAt: now,
    error: o.error,
  };
}

/** ISO timestamp with `:`/`.` → `-`, matching the runId / evidence filename convention. */
function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Run the whole batch and return a structured summary. Never throws for a single
 * country's failure — it records FAILED and continues. Throws only if the caller
 * passed an empty list (guarded here as a safety net; `readCountries` already
 * blocks empty input) — a fatal `LOGIN_REQUIRED` is caught and turned into an
 * `aborted` summary rather than a throw, so the caller always gets a report.
 */
export async function runBatch(
  page: Page,
  countries: string[],
  global: RequestedRange,
  config: AppConfig,
  codes: Record<string, string>,
  log: Logger,
  runId: string,
  deps: BatchDeps = defaultBatchDeps,
  force = false,
): Promise<BatchSummary> {
  const { maxAttemptsPerCountry, retryDelayMs, continueOnFailure, evidenceDir, finalRetryRounds } = config.batch;
  const { throttleEveryMin, throttleEveryMax, throttlePauseMinMs, throttlePauseMaxMs } = config.batch;
  const outcomes: CountryOutcome[] = [];
  let aborted = false;
  let abortReason: string | undefined;
  let sessionExpired = false;
  // Randomized anti-block throttle bookkeeping (Phase 9, spec rows 23,28). `ranSinceBreak` counts
  // only countries that actually hit the browser (a resume-skip `continue`s before it). `breakAfter`
  // is the current burst size — re-drawn after every break so the cadence keeps changing. The RNG is
  // injected so the offline harness is fully deterministic.
  const rnd = deps.random ?? (() => Math.random());
  const throttleOn = throttleEveryMax > 0;
  const drawBurst = (): number => drawInt(Math.max(1, throttleEveryMin), throttleEveryMax, rnd);
  let ranSinceBreak = 0;
  let breakAfter = throttleOn ? drawBurst() : 0;

  const requestedRange = `${global.requestedStart}-${global.requestedEnd}`;
  // `--force` overrides the collision mode to `overwrite` for the whole run (spec-lock row 4).
  const collisionMode = force ? 'overwrite' : resolveCollisionMode(config.download);

  // Resume manifest (Phase 5, §29/§30). Enabled iff a manifestFile is configured — the
  // Phase-4 batch harness constructs a config WITHOUT one, so its behaviour is unchanged.
  const manifestPath = config.manifestFile;
  const manifestEnabled = !!manifestPath;
  const nowFn = deps.now ?? (() => new Date().toISOString());
  const loadManifest = deps.loadManifest ?? realLoadManifest;
  const writeManifest = deps.writeManifest ?? realWriteManifest;
  const validateFile = deps.validateFile ?? realValidateFile;
  let manifest: Manifest = manifestEnabled
    ? loadManifest(manifestPath!, runId, requestedRange, nowFn())
    : emptyManifest(runId, requestedRange, nowFn());

  /** Persist the manifest after an outcome — best-effort; a write failure never aborts the run (row 9). */
  const recordAndPersist = (outcome: CountryOutcome): void => {
    if (!manifestEnabled) return;
    manifest = upsertEntry(manifest, outcomeToEntry(outcome, requestedRange, nowFn()));
    try {
      writeManifest(manifestPath!, manifest);
    } catch (e) {
      log('error', 'manifest.write_failed', { country: outcome.country, error: e instanceof Error ? e.message : String(e) });
    }
  };

  log('info', 'batch.start', {
    runId,
    total: countries.length,
    maxAttemptsPerCountry,
    continueOnFailure,
    collisionMode,
    force,
    manifest: manifestEnabled ? manifestPath : 'disabled',
    throttle: throttleOn
      ? `random ${throttleEveryMin}-${throttleEveryMax} countries, ${throttlePauseMinMs}-${throttlePauseMaxMs}ms pause`
      : 'disabled',
    finalRetryRounds,
  });

  // Anti-block throttle helper (Phase 9/10): BEFORE running `country`, if the current burst is
  // complete, take a random break of a random duration and draw a fresh burst size. Shared by the
  // MAIN loop AND the end-of-run retry rounds, so retries stay exactly as polite (compliance boundary).
  const maybeThrottleBefore = async (country: string): Promise<void> => {
    if (throttleOn && ranSinceBreak >= breakAfter) {
      const pauseMs = drawInt(throttlePauseMinMs, throttlePauseMaxMs, rnd);
      const nextBurst = drawBurst();
      log('info', 'batch.throttle', { beforeCountry: country, ranInBurst: ranSinceBreak, pauseMs, nextBurst });
      await deps.sleep(pauseMs);
      ranSinceBreak = 0;
      breakAfter = nextBurst;
    }
  };

  // Run ONE country's attempts (up to maxAttemptsPerCountry, per-attempt evidence). Returns the raw
  // retry outcome; a FATAL error (LOGIN_REQUIRED) is re-thrown so the caller aborts the whole batch.
  const execCountry = (country: string) =>
    withRetry<CountryResult>(
      () => deps.runCountry(page, country, global, config, codes, log, { collisionMode }),
      {
        maxAttempts: maxAttemptsPerCountry,
        delayMs: retryDelayMs,
        sleep: deps.sleep,
        onAttemptError: async (err, attempt) => {
          log('warn', 'country.attempt_failed', {
            country,
            attempt,
            of: maxAttemptsPerCountry,
            error: err instanceof Error ? err.message : String(err),
          });
          await deps.captureFailure(page as EvidencePage, {
            runId,
            country,
            attempt,
            maxAttempts: maxAttemptsPerCountry,
            error: err,
            filters: config.filters,
            evidenceDir,
            timestamp: stamp(),
            log,
          });
        },
      },
    );

  // Turn a thrown FATAL into the abort bookkeeping + a FAILED outcome (session expiry is the
  // expected fatal — remaining countries stay untouched so a resume re-run finishes them).
  const handleFatal = (country: string, fatal: unknown): CountryOutcome => {
    const message = fatal instanceof Error ? fatal.message : String(fatal);
    aborted = true;
    if (isSessionExpired(fatal)) {
      sessionExpired = true;
      abortReason = sessionExpiredAbortReason(country, message);
      log('warn', 'batch.session_expired', { country });
    } else {
      abortReason = message;
      log('error', 'batch.aborted', { country, error: message });
    }
    return { country, status: 'FAILED', attempts: 1, error: message };
  };

  for (let idx = 0; idx < countries.length; idx++) {
    const country = countries[idx];
    log('info', 'country.start', { country, index: idx + 1, of: countries.length });

    // Idempotency / resume (§36): skip BEFORE download if the manifest says SUCCESS under this
    // requested range AND the recorded file still validates on disk. `--force` bypasses this.
    if (manifestEnabled && (await isAlreadyDone(manifest, country, requestedRange, force, validateFile))) {
      const prev = findEntry(manifest, country); // known SUCCESS — carried, not downgraded
      log('info', 'country.skip_resume', { country, reason: 'ALREADY_DONE', file: prev?.file });
      outcomes.push({
        country,
        status: 'SKIPPED',
        skipReason: 'ALREADY_DONE',
        attempts: 0,
        effectiveRange: prev?.effectiveRange,
        rangeStatus: prev?.rangeStatus,
        file: prev?.file,
        targetPath: prev?.targetPath,
      });
      continue; // manifest entry left as SUCCESS (spec-lock row 7)
    }

    // Randomized anti-block throttle (Phase 9, spec rows 23,28): BEFORE running this country, if the
    // current burst is complete, take a RANDOM break of a RANDOM duration, then draw a fresh random
    // burst size. Taking the pause BEFORE the run (not after) means trailing resume-skips never
    // trigger a pause and no pause ever trails the last country that runs. This is a politeness
    // buffer that spreads load; it NEVER bypasses a site limit (CLAUDE.md compliance boundary).
    await maybeThrottleBefore(country);

    try {
      const outcome = await execCountry(country);

      if (outcome.ok && outcome.value) {
        // SUCCESS/SKIPPED on attempt `outcome.attempts` (1 if it worked first try).
        const result = outcome.value;
        log('info', 'country.done', {
          country,
          status: result.status,
          attempts: outcome.attempts,
          effectiveRange: result.effectiveRange,
          rangeStatus: result.rangeStatus,
          file: result.targetPath,
        });
        const oc: CountryOutcome = {
          country,
          status: result.status,
          skipReason: result.skipReason,
          attempts: outcome.attempts,
          effectiveRange: result.effectiveRange,
          rangeStatus: result.rangeStatus,
          file: result.file,
          targetPath: result.targetPath,
        };
        outcomes.push(oc);
        recordAndPersist(oc);
      } else {
        // Exhausted all retries → FAILED, but the batch continues (unless configured not to).
        const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
        log('error', 'country.failed', { country, attempts: outcome.attempts, error: message });
        const oc: CountryOutcome = { country, status: 'FAILED', attempts: outcome.attempts, error: message };
        outcomes.push(oc);
        recordAndPersist(oc);
        if (!continueOnFailure) {
          abortReason = `continueOnFailure=false; stopped after ${country} failed`;
          log('warn', 'batch.stopped_on_failure', { country });
          break;
        }
      }
    } catch (fatal) {
      // withRetry re-throws a FATAL error (e.g. LOGIN_REQUIRED) instead of retrying:
      // a dead session fails every remaining country identically, so abort the batch.
      // Session expiry (§28/AC-08) is the expected fatal here: remaining countries are
      // NOT touched (loop breaks → they stay PENDING), and the abort reason tells the
      // user how to resume. A non-auth fatal keeps the generic abort message.
      const oc = handleFatal(country, fatal);
      outcomes.push(oc);
      recordAndPersist(oc);
      break;
    }

    // This country reached runCountry (a resume-skip `continue`s above; an abort/stop `break`s out
    // before here), so count it toward the current burst. The pause itself is taken at the TOP of
    // the NEXT running iteration, so no pause ever trails the run.
    ranSinceBreak += 1;
  }

  // ---------------------------------------------------------------------------
  // Phase 10 — END-OF-RUN RETRY QUEUE. Any country still FAILED after the main pass is queued and
  // retried in up to `finalRetryRounds` more rounds. Each retried country still runs its full
  // per-country retry (maxAttemptsPerCountry) and is STILL throttled between runs (same buffer),
  // so this never hammers the site (compliance boundary). A recovered country's FAILED outcome is
  // REPLACED in place (and in the manifest, so a later --retry-failed won't re-run it); a
  // LOGIN_REQUIRED anywhere aborts the whole batch. Skipped when the batch already aborted, when
  // continueOnFailure=false (a deliberate stop), or when disabled (rounds=0 — the engine default).
  // ---------------------------------------------------------------------------
  if (finalRetryRounds > 0 && !aborted && continueOnFailure) {
    let abortedInRetry = false;
    for (let round = 1; round <= finalRetryRounds && !abortedInRetry; round++) {
      const queue = outcomes.filter((o) => o.status === 'FAILED').map((o) => o.country);
      if (queue.length === 0) break;
      log('info', 'retry.round_start', { round, of: finalRetryRounds, remaining: queue.length });

      for (const country of queue) {
        await maybeThrottleBefore(country);
        const idx = outcomes.findIndex((o) => o.country === country);
        const priorAttempts = idx >= 0 ? outcomes[idx].attempts : 0;
        try {
          const outcome = await execCountry(country);
          if (outcome.ok && outcome.value) {
            const result = outcome.value;
            log('info', 'retry.recovered', { country, round, status: result.status, attempts: outcome.attempts });
            const oc: CountryOutcome = {
              country,
              status: result.status,
              skipReason: result.skipReason,
              attempts: priorAttempts + outcome.attempts,
              effectiveRange: result.effectiveRange,
              rangeStatus: result.rangeStatus,
              file: result.file,
              targetPath: result.targetPath,
            };
            if (idx >= 0) outcomes[idx] = oc;
            else outcomes.push(oc);
            recordAndPersist(oc);
          } else {
            const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
            log('warn', 'retry.still_failed', { country, round, of: finalRetryRounds, attempts: outcome.attempts, error: message });
            const oc: CountryOutcome = { country, status: 'FAILED', attempts: priorAttempts + outcome.attempts, error: message };
            if (idx >= 0) outcomes[idx] = oc;
            else outcomes.push(oc);
            recordAndPersist(oc);
          }
          ranSinceBreak += 1;
        } catch (fatal) {
          const oc = handleFatal(country, fatal);
          if (idx >= 0) outcomes[idx] = oc;
          else outcomes.push(oc);
          recordAndPersist(oc);
          abortedInRetry = true;
          break;
        }
      }
    }
  }

  const success = outcomes.filter((o) => o.status === 'SUCCESS').length;
  const skipped = outcomes.filter((o) => o.status === 'SKIPPED').length;
  const failed = outcomes.filter((o) => o.status === 'FAILED').length;
  const exitCode: 0 | 1 | 2 = aborted ? 2 : failed > 0 ? 1 : 0;

  const summary: BatchSummary = {
    runId,
    total: countries.length,
    success,
    skipped,
    failed,
    aborted,
    abortReason,
    sessionExpired,
    exitCode,
    outcomes,
  };
  log('info', 'batch.summary', { runId, total: summary.total, success, skipped, failed, aborted, sessionExpired, exitCode });
  return summary;
}

// ---------------------------------------------------------------------------
// Human-readable summary table (PURE, so the harness can assert on it).
// ---------------------------------------------------------------------------

/** Render the batch summary as a fixed-width text table for stdout. */
export function renderSummaryTable(summary: BatchSummary): string {
  const rows = summary.outcomes.map((o) => ({
    country: o.country,
    status: o.status,
    attempts: String(o.attempts),
    range: o.status === 'FAILED' ? (o.error ?? '') : `${o.effectiveRange ?? '—'} (${o.rangeStatus ?? '—'})`,
  }));

  const wCountry = Math.max(7, ...rows.map((r) => r.country.length));
  const wStatus = Math.max(6, ...rows.map((r) => r.status.length));
  const wAtt = Math.max(4, ...rows.map((r) => r.attempts.length));

  const pad = (s: string, w: number): string => s + ' '.repeat(Math.max(0, w - s.length));
  const lines: string[] = [];
  lines.push(`${pad('Country', wCountry)}  ${pad('Status', wStatus)}  ${pad('Att', wAtt)}  Effective range / error`);
  lines.push(`${'-'.repeat(wCountry)}  ${'-'.repeat(wStatus)}  ${'-'.repeat(wAtt)}  ${'-'.repeat(23)}`);
  for (const r of rows) {
    lines.push(`${pad(r.country, wCountry)}  ${pad(r.status, wStatus)}  ${pad(r.attempts, wAtt)}  ${r.range}`);
  }
  lines.push('');
  lines.push(
    `Total ${summary.total} · SUCCESS ${summary.success} · SKIPPED ${summary.skipped} · ` +
      `FAILED ${summary.failed}${summary.aborted ? ' · ABORTED' : ''} · exit ${summary.exitCode}`,
  );
  if (summary.abortReason) lines.push(`Reason: ${summary.abortReason}`);
  if (summary.sessionExpired) lines.push('SESSION EXPIRED — re-login and rerun the same command to resume (completed countries are skipped).');
  return lines.join('\n');
}
