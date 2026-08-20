import * as path from 'path';
import * as readline from 'readline';
import { chromium, BrowserContext, Page } from 'playwright';

/**
 * Launch a headed browser using a DEDICATED persistent profile (PRD §22–23).
 * The profile directory owns cookies / localStorage / Trade Map login, so a manual
 * login done once survives across runs and restarts. Never the user's everyday Chrome.
 */
export async function launchSession(
  profileDir: string,
  baseUrl: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await chromium.launchPersistentContext(path.resolve(profileDir), {
    headless: false,
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  return { context, page };
}

/**
 * Is the browser currently sitting on Trade Map's login page? We detect the LOGIN PAGE
 * directly (robust) rather than guessing "am I logged in?" on the home page (fragile).
 * Multi-signal — any one is enough:
 *   1. a visible password field (near-certain login signal),
 *   2. a login-ish URL,
 *   3. the known Market Analysis Tools banner text (confirmed live:
 *      "... Your gateway to ITC's Market Analysis Tools ...").
 */
export async function isLoginPage(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase();
  // High-precision URL markers (a data page URL never contains these). `connexion` = the French
  // login path (ITC is bilingual). If the friend's live login URL uses another word, add it here —
  // it is captured/confirmed from a real redirect, never guessed into a false positive.
  if (url.includes('login') || url.includes('signin') || url.includes('logon') || url.includes('connexion')) {
    return true;
  }

  const hasPasswordField = await page
    .locator('input[type="password"]')
    .first()
    .isVisible({ timeout: 1500 })
    .catch(() => false);
  if (hasPasswordField) {
    return true;
  }

  const body = (await page.locator('body').innerText().catch(() => '')).toLowerCase();
  return body.includes('gateway to itc');
}

/**
 * Pause the run and wait for the user to log in manually, then press ENTER (PRD §22).
 * No credentials are ever typed, stored, or logged by this automation.
 */
export function promptManualLogin(message?: string): Promise<void> {
  const text =
    message ??
    '\n[ACTION REQUIRED] Trade Map is showing its login page.\n' +
      '  1. Log in inside the opened browser window.\n' +
      '  2. Come back here and press ENTER to continue... ';
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<void>((resolve) => {
    rl.question(text, () => {
      rl.close();
      resolve();
    });
  });
}
