import * as fs from 'fs';
import * as path from 'path';
import { FiltersConfig } from '../config/schema';
import { parseFiltersFromUrl } from '../trademap/filters';

// ---------------------------------------------------------------------------
// Failure evidence (Phase 4, PRD §36; spec-lock rows 7–8).
//
// When a country's attempt fails we capture, side by side under
// `screenshots/failures/<runId>/`:
//   • a full-page PNG of the browser as it stands, and
//   • a sidecar JSON: which country, which attempt, the ISO timestamp, the live
//     URL, the filters parsed from that URL, and the error name+message.
//
// Capture is BEST-EFFORT: a closed/crashed page must not turn a real fault into
// a confusing "screenshot failed" — every step is guarded and the original error
// always propagates untouched. We NEVER log cookies/tokens/passwords (CLAUDE.md).
// ---------------------------------------------------------------------------

/** Matches the structured logger created in index.ts (structural typing). */
type Logger = (level: 'info' | 'warn' | 'error', event: string, data?: Record<string, unknown>) => void;

/**
 * Minimal structural slice of Playwright's Page we actually need — lets the batch
 * harness pass a fake page (no browser) to unit-test the evidence writer.
 */
export interface EvidencePage {
  url(): string;
  screenshot(options: { path: string; fullPage: boolean }): Promise<unknown>;
}

export interface FailureContext {
  runId: string;
  country: string;
  attempt: number;
  maxAttempts: number;
  error: unknown;
  filters: FiltersConfig; // config filters, so parseFiltersFromUrl can map URL tokens → our vocabulary
  evidenceDir: string; // base dir, e.g. "./screenshots/failures"
  timestamp: string; // ISO-ish, already `:`/`.`-sanitised by the caller (matches runId convention)
  log: Logger;
}

/** Windows-safe basename fragment: strip anything not filename-friendly. */
function safe(fragment: string): string {
  return fragment.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

/**
 * Write the evidence bundle for one failed attempt. Returns the PNG path on
 * success, or `null` if capture failed (already logged) — the caller's original
 * error is never masked. The JSON is written even if the screenshot step throws,
 * so we always have the URL/filters/error record.
 */
export async function captureFailure(page: EvidencePage, ctx: FailureContext): Promise<string | null> {
  const dir = path.join(ctx.evidenceDir, safe(ctx.runId));
  const base = `${safe(ctx.country)}_attempt${ctx.attempt}_${safe(ctx.timestamp)}`;
  const pngPath = path.join(dir, `${base}.png`);
  const jsonPath = path.join(dir, `${base}.json`);

  let url = '';
  try {
    url = page.url();
  } catch {
    url = '';
  }

  let screenshotWritten = false;
  try {
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: pngPath, fullPage: true });
    screenshotWritten = true;
  } catch (e) {
    ctx.log('warn', 'evidence.capture_failed', { country: ctx.country, attempt: ctx.attempt, error: String(e) });
  }

  const err = ctx.error;
  const record = {
    runId: ctx.runId,
    country: ctx.country,
    attempt: ctx.attempt,
    maxAttempts: ctx.maxAttempts,
    timestamp: ctx.timestamp,
    url,
    filters: url ? parseFiltersFromUrl(url, ctx.filters) : {},
    error: {
      name: err instanceof Error ? err.name : 'Error',
      message: err instanceof Error ? err.message : String(err),
    },
    screenshot: screenshotWritten ? path.basename(pngPath) : null,
  };

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(record, null, 2), 'utf8');
  } catch (e) {
    ctx.log('warn', 'evidence.capture_failed', { country: ctx.country, attempt: ctx.attempt, error: String(e) });
    return screenshotWritten ? pngPath : null;
  }

  ctx.log('info', 'evidence.captured', {
    country: ctx.country,
    attempt: ctx.attempt,
    screenshot: screenshotWritten ? pngPath : null,
    json: jsonPath,
  });
  return screenshotWritten ? pngPath : null;
}
