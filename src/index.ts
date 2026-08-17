import * as fs from 'fs';
import * as path from 'path';
import { Page } from 'playwright';
import { launchSession, isLoginPage, promptManualLogin } from './auth/session';
import {
  buildCanonicalUrl,
  verifyCountryHeading,
  detectEffectiveRange,
  triggerSaveAndDownload,
  UrlFilters,
} from './trademap/driver';
import { generateFilename, saveDownload, validateXlsx } from './files/save-validate';

// ---------------------------------------------------------------------------
// Config shape (parsed from config/config.json — nothing hardcoded, PRD §13/§20).
// ---------------------------------------------------------------------------
interface FiltersConfig extends UrlFilters {
  exporter: string;
}
interface AppConfig {
  tradeMapBaseUrl: string;
  outputDirectory: string;
  browserProfileDir: string;
  logsDir: string;
  countryCodesFile: string;
  filters: FiltersConfig;
  auth?: { maxLoginAttempts?: number };
  datePolicy: { requestedStart: string; requestedEnd: string; mode: string };
  download: { format: string; overwrite: boolean; timeoutMs: number; downloadAttempts: number };
  filenameTemplate: string;
}

// ---------------------------------------------------------------------------
// Tiny CLI arg reader: --key value
// ---------------------------------------------------------------------------
function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined;
}

// ---------------------------------------------------------------------------
// Structured logger. JSON lines to stdout + logs/runs/<runId>.log. Never logs secrets.
// ---------------------------------------------------------------------------
type Logger = (level: 'info' | 'warn' | 'error', event: string, data?: Record<string, unknown>) => void;
function makeLogger(logFile: string): Logger {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  return (level, event, data = {}) => {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...data });
    process.stdout.write(line + '\n');
    fs.appendFileSync(logFile, line + '\n');
  };
}

const cap = (s: string): string => (s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * Navigate to the query URL and ensure we land on the DATA page, not the login page.
 * On a login redirect (first run or expired session, PRD §22/§28) we pause for a manual
 * login and re-navigate — up to maxLoginAttempts — instead of crashing on the login page.
 */
async function gotoAuthenticated(
  page: Page,
  url: string,
  maxLoginAttempts: number,
  log: Logger,
): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);

  let attempts = 0;
  while (await isLoginPage(page)) {
    attempts += 1;
    if (attempts > maxLoginAttempts) {
      throw new Error(
        `LOGIN_REQUIRED: still on the Trade Map login page after ${maxLoginAttempts} manual attempt(s).`,
      );
    }
    log('warn', 'auth.login_required', { attempt: attempts, url: page.url() });
    await promptManualLogin();
    // Re-navigate to the real query URL now that the user has (hopefully) logged in.
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
  }
  log('info', 'auth.ok', { url: page.url() });
}

async function main(): Promise<void> {
  const country = getArg('country') ?? 'Dominica';
  const runId = getArg('run-id') ?? new Date().toISOString().replace(/[:.]/g, '-');
  const configPath = getArg('config') ?? path.resolve('config/config.json');

  const config: AppConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const log = makeLogger(path.join(config.logsDir, 'runs', `${runId}.log`));
  log('info', 'run.start', { runId, country, mode: config.datePolicy.mode });

  // Resolve the country to its Trade Map numeric code (PRD §7). Phase 1: must exist in the
  // local map; the UI-search fallback is Phase 2.
  const codes: Record<string, string> = JSON.parse(
    fs.readFileSync(path.resolve(config.countryCodesFile), 'utf8'),
  );
  const importerCode = codes[country];
  if (!importerCode) {
    throw new Error(
      `COUNTRY_NOT_FOUND: "${country}" is not in ${config.countryCodesFile} ` +
        `(Phase 2 adds the UI-search fallback).`,
    );
  }

  const { requestedStart, requestedEnd } = config.datePolicy;

  const { context, page } = await launchSession(config.browserProfileDir, config.tradeMapBaseUrl);
  try {
    // Build the canonical query URL from the GLOBAL requested range (never a carried-over
    // value) and navigate deterministically (PRD §4A, §6, §15). If Trade Map bounces us to
    // its login page, PAUSE for a manual login and re-navigate — never crash on it.
    const url = buildCanonicalUrl(
      config.tradeMapBaseUrl,
      importerCode,
      config.filters,
      requestedStart,
      requestedEnd,
    );
    log('info', 'query.navigate', { country, importerCode, url });
    await gotoAuthenticated(page, url, config.auth?.maxLoginAttempts ?? 3, log);

    // Country verification gate before anything else (PRD §42).
    await verifyCountryHeading(page, country);

    // Effective range = what Trade Map actually served (PRD §16). Requested is immutable.
    const eff = await detectEffectiveRange(page, requestedStart, requestedEnd);
    log('info', 'range.detected', {
      country,
      requested: `${requestedStart}-${requestedEnd}`,
      effective: `${eff.start}-${eff.end}`,
      rangeStatus: eff.status,
    });

    // Generate the target filename BEFORE export, using the EFFECTIVE range (PRD §19).
    const filename = generateFilename(config.filenameTemplate, {
      country,
      frequency: cap(config.filters.frequency),
      source: cap(config.filters.source),
      currency: config.filters.currency,
      start: eff.start,
      end: eff.end,
      extension: config.download.format,
    });

    // Collision short-circuit (PRD §37): if the file already exists and overwrite is off,
    // skip before triggering a redundant download.
    const targetPath = path.join(path.resolve(config.outputDirectory), filename);
    if (fs.existsSync(targetPath) && !config.download.overwrite) {
      log('info', 'file.skip', { country, targetPath, reason: 'exists and overwrite:false' });
      log('info', 'run.done', { country, status: 'SKIPPED', file: filename });
      return;
    }

    // Trigger Save + capture download, with the configured retry count (PRD §18, §26–27).
    let download;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= config.download.downloadAttempts; attempt++) {
      try {
        log('info', 'export.attempt', { country, attempt });
        download = await triggerSaveAndDownload(page, config.download.timeoutMs);
        break;
      } catch (e) {
        lastErr = e;
        log('warn', 'export.attempt_failed', { country, attempt, error: String(e) });
      }
    }
    if (!download) {
      throw new Error(`DOWNLOAD_TIMEOUT: all ${config.download.downloadAttempts} attempts failed (${String(lastErr)})`);
    }

    // Save under the target path, then validate before declaring success (PRD §25, AC-09).
    const result = await saveDownload(download, config.outputDirectory, filename, config.download.overwrite);
    if (!result.saved) {
      log('info', 'file.skip', { country, targetPath: result.targetPath, reason: 'exists and overwrite:false' });
      log('info', 'run.done', { country, status: 'SKIPPED', file: filename });
      return;
    }
    await validateXlsx(result.targetPath);

    log('info', 'run.done', {
      country,
      status: 'SUCCESS',
      requestedRange: `${requestedStart}-${requestedEnd}`,
      effectiveRange: `${eff.start}-${eff.end}`,
      rangeStatus: eff.status,
      file: result.targetPath,
    });
  } finally {
    await context.close();
  }
}

main().catch((err: unknown) => {
  // One consistent failure surface: log, then exit non-zero so no false SUCCESS (AC-09).
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'run.failed', error: message }) + '\n');
  process.exitCode = 1;
});
