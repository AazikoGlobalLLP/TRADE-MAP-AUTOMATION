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
 * Ensure the session is authenticated. If the page looks logged-out, PAUSE and ask the
 * user to log in manually, then wait for ENTER (PRD §22 "press Continue"). No credentials
 * are ever stored, typed, or logged by this automation.
 */
export async function ensureLoggedIn(page: Page, baseUrl: string): Promise<void> {
  if (await looksLoggedOut(page)) {
    await waitForEnter(
      '\n[ACTION REQUIRED] Please log in to Trade Map in the opened browser window,\n' +
        'then return here and press ENTER to continue... ',
    );
    // Re-load so the freshly-authenticated session is reflected before we build the query.
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  }
}

/**
 * Heuristic logged-out detector. A logged-out Trade Map exposes a Login/Sign-in
 * affordance. VERIFY these selectors against the live DOM (docs/spec RISKS).
 * Defaults to "prompt" when uncertain — pressing ENTER when already logged in is harmless.
 */
async function looksLoggedOut(page: Page): Promise<boolean> {
  const loginMarker = page
    .locator('a:has-text("Login"), a:has-text("Sign in"), a:has-text("Log in"), #ctl00_MenuControl_Login')
    .first();
  const hasLogin = await loginMarker.isVisible({ timeout: 3000 }).catch(() => false);
  return hasLogin;
}

/** Block until the user presses ENTER on stdin. */
function waitForEnter(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<void>((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}
