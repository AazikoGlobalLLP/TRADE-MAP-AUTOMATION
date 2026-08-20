// ---------------------------------------------------------------------------
// Human-friendly CONSOLE formatter (Phase 10).
//
// WHY: the run's structured logger emits one JSON line per event. That JSON is
// exactly what we WANT in the log FILE (it's the evidence you diagnose a run
// from), but it is painful to read live in the terminal. This turns the events
// that a WATCHER cares about into short emoji lines — country name + status —
// and returns `null` for the noisy internal events so they stay in the file
// only. Errors are NEVER hidden: an unlisted error-level event still prints.
//
// PURE (no I/O), so it is unit-tested offline (`npm run test:console`). The file
// logger keeps the full JSON; index.ts calls this only for what reaches stdout.
// ---------------------------------------------------------------------------

export type LogLevel = 'info' | 'warn' | 'error';

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Trim a long error message so one console line stays readable (the full text is in the log file). */
function shorten(s: string, max = 140): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + '…' : oneLine;
}

/** ms → "45s" / "2m14s" for the anti-block pause line. */
export function prettyDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return `${ms}ms`;
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m === 0 ? `${s}s` : `${m}m${s.toString().padStart(2, '0')}s`;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/**
 * Render ONE structured log event as a friendly console line, or `null` to print
 * nothing (the event still went to the JSON log file). Country-facing events get
 * an emoji + the country + its status; internal chatter is suppressed.
 */
export function formatConsoleLine(level: LogLevel, event: string, data: Record<string, unknown> = {}): string | null {
  const country = str(data.country);

  switch (event) {
    case 'run.start':
      return '🚀 Run started';

    case 'batch.start': {
      const total = num(data.total) ?? 0;
      const rounds = num(data.finalRetryRounds) ?? 0;
      const extra = rounds > 0 ? ` · up to ${rounds} end-of-run retry ${plural(rounds, 'round', 'rounds')}` : '';
      return `\n📋 Batch: ${total} ${plural(total, 'country', 'countries')}${extra}`;
    }

    case 'country.start': {
      const i = num(data.index);
      const of = num(data.of);
      const pos = i && of ? `[${i}/${of}] ` : '';
      return `\n🔄 ${pos}${country} …`;
    }

    case 'country.done': {
      const status = str(data.status);
      const attempts = num(data.attempts);
      const att = attempts ? `, ${attempts} ${plural(attempts, 'attempt', 'attempts')}` : '';
      if (status === 'SKIPPED') return `⏭️  ${country} — SKIPPED (file already exists)`;
      return `✅ ${country} — SUCCESS (${str(data.effectiveRange)}${att})`;
    }

    case 'country.skip_resume':
      return `⏭️  ${country} — SKIPPED (already done)`;

    case 'country.failed': {
      const attempts = num(data.attempts);
      const att = attempts ? ` after ${attempts} ${plural(attempts, 'attempt', 'attempts')}` : '';
      return `❌ ${country} — FAILED${att}: ${shorten(str(data.error))}`;
    }

    case 'batch.throttle':
      return `⏸️  Anti-block pause ${prettyDuration(num(data.pauseMs) ?? 0)} (protecting your account) …`;

    case 'retry.round_start': {
      const round = num(data.round);
      const of = num(data.of);
      const remaining = num(data.remaining) ?? 0;
      return `\n🔁 Retry round ${round}/${of} — ${remaining} ${plural(remaining, 'country', 'countries')} still to fix`;
    }

    case 'retry.recovered':
      return `✅ ${country} — recovered on retry`;

    case 'retry.still_failed':
      return `❌ ${country} — still failing (round ${num(data.round)}/${num(data.of)})`;

    case 'auth.login_required':
      return '🔐 Login needed — log in in the browser window; the run continues automatically after.';

    case 'auth.login_midrun':
      return '🔐 Session expired mid-run — log in again in the browser window to continue.';

    case 'batch.session_expired':
      return `🛑 Session expired at ${country} — re-login and re-run the SAME command to resume.`;

    case 'batch.aborted':
      return `🛑 Aborted at ${country}: ${shorten(str(data.error))}`;

    case 'report.written':
      return `📝 Report saved: ${str(data.file)}`;

    case 'batch.summary': {
      const total = num(data.total) ?? 0;
      const s = num(data.success) ?? 0;
      const sk = num(data.skipped) ?? 0;
      const f = num(data.failed) ?? 0;
      return `\n📊 Done — ✅ ${s} success   ⏭️ ${sk} skipped   ❌ ${f} failed   (of ${total})`;
    }

    case 'run.done':
      return `✅ ${country} — ${str(data.status)}`;

    default:
      // Never hide a genuine error, even an unlisted one; keep info/warn chatter out of the console.
      if (level === 'error') return `❗ ${event}${data.error ? ': ' + shorten(str(data.error)) : ''}`;
      return null;
  }
}
