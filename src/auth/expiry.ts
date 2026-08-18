// ---------------------------------------------------------------------------
// Session-expiry handling (Phase 6, PRD §22/§28, AC-08).
//
// Trade Map auth is DIFFERENT from a normal country failure. If the site
// redirects to its login page mid-run, the correct response is to PAUSE the whole
// run and let the user log back in — NOT to retry the country 3× and NOT to mark
// every remaining country FAILED (AC-08). The live pause already happens at
// navigation time in runCountry's `gotoAuthenticated`: it detects the login page
// and waits on a manual login + ENTER, up to `maxLoginAttempts`, then re-navigates
// (that IS "resume current country", PRD §28). Only if the user abandons login
// after that many prompts does it throw the FATAL `LOGIN_REQUIRED`.
//
// This module names that signal and turns it into an actionable STOP: the batch
// aborts (it does NOT fail the remaining countries — the loop simply breaks, so
// they stay PENDING) and tells the user exactly how to resume — re-login and
// rerun the SAME command; the manifest's completed SUCCESS countries are skipped
// on the next run (§29), so no finished work is lost.
//
// Pure + browser-free, so `npm run test:report` proves the classification offline.
// Never inspects or logs cookies/tokens/passwords (CLAUDE.md danger zone).
// ---------------------------------------------------------------------------

/** Error-message markers that mean "the authenticated session is gone". */
const SESSION_EXPIRED_MARKERS = ['LOGIN_REQUIRED', 'SESSION_EXPIRED'] as const;

/** True iff `err` is a dead/expired-session signal (as opposed to a normal country failure). */
export function isSessionExpired(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return SESSION_EXPIRED_MARKERS.some((m) => msg.includes(m));
}

/**
 * Human-actionable reason string for a run paused/stopped by session expiry.
 * Keeps the original error text verbatim (so existing log greps for
 * `LOGIN_REQUIRED` still match) and appends the resume instructions (§29):
 * no completed country is lost — SUCCESS entries are skipped on the next run.
 */
export function sessionExpiredAbortReason(country: string, originalMessage: string): string {
  return (
    `SESSION_EXPIRED while processing "${country}": ${originalMessage} ` +
    `— log back in inside the open browser and rerun the SAME command to resume. ` +
    `Countries already SUCCESS in the manifest are skipped on resume, so no completed work is lost.`
  );
}
