// ---------------------------------------------------------------------------
// Per-country retry policy (Phase 4, PRD §36). Generic + browser-free so the
// batch harness proves it offline (spec-lock rows 4–5, 13).
//
//   • A country gets up to `maxAttempts` tries (1 initial + N−1 retries).
//   • Between attempts we pause `delayMs` — a DELIBERATE inter-attempt backoff,
//     NOT a "sleep as a wait" (convention #1): we are spacing out independent
//     retries, not polling for a page state. Tests inject `delayMs: 0`.
//   • `isRetryable(err)` decides retryable-vs-fatal. A dead session
//     (`LOGIN_REQUIRED`) is FATAL: retrying fails every remaining country
//     identically, so it must abort the whole batch (Phase 6 adds pause/resume).
// ---------------------------------------------------------------------------

/** Errors that must NOT be retried — retrying cannot possibly help. */
const FATAL_MARKERS = [
  'LOGIN_REQUIRED', // session is dead; every country would fail the same way
  'BATCH_EMPTY',
  'BATCH_INPUT_MISSING',
  'CONFIG_INVALID',
];

/**
 * PURE. True if `err` is worth retrying. Config/auth/input faults are fatal
 * (retrying is pointless); everything else (download timeout, transient nav,
 * a flaky query gate) is retryable. Fail-safe default is `true` — an unknown
 * error gets its retries rather than being silently swallowed as fatal.
 */
export function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return !FATAL_MARKERS.some((m) => msg.includes(m));
}

export interface RetryOptions {
  maxAttempts: number;
  delayMs: number;
  /** Called after each FAILED attempt (for evidence capture + logging). Best-effort; its own throw is ignored. */
  onAttemptError?: (err: unknown, attempt: number) => Promise<void> | void;
  /** Injected pause; defaults to a real `setTimeout`. Tests pass `() => Promise.resolve()`. */
  sleep?: (ms: number) => Promise<void>;
  /** Classifier; defaults to `isRetryable`. */
  shouldRetry?: (err: unknown) => boolean;
}

export interface RetryOutcome<T> {
  ok: boolean;
  value?: T; // present iff ok
  error?: unknown; // present iff !ok
  attempts: number; // how many times `fn` actually ran
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` up to `maxAttempts` times. Returns a structured outcome instead of
 * throwing, so the batch loop can record a FAILED country and CONTINUE. A FATAL
 * error (`shouldRetry` returns false) stops retries immediately and is re-THROWN
 * — the caller distinguishes "this country failed" (outcome.ok === false) from
 * "abort the batch" (a thrown fatal error).
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions,
): Promise<RetryOutcome<T>> {
  const sleep = opts.sleep ?? realSleep;
  const shouldRetry = opts.shouldRetry ?? isRetryable;
  const maxAttempts = Math.max(1, opts.maxAttempts);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const value = await fn(attempt);
      return { ok: true, value, attempts: attempt };
    } catch (err) {
      lastErr = err;

      // Fatal → do not retry, do not swallow: propagate so the batch aborts.
      if (!shouldRetry(err)) throw err;

      // Evidence/logging for this failed attempt (never let it mask the fault).
      if (opts.onAttemptError) {
        try {
          await opts.onAttemptError(err, attempt);
        } catch {
          /* evidence capture is best-effort; ignore */
        }
      }

      if (attempt < maxAttempts) await sleep(opts.delayMs);
    }
  }
  return { ok: false, error: lastErr, attempts: maxAttempts };
}
