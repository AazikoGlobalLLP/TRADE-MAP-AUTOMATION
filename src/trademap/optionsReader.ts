import { Page } from 'playwright';

// ---------------------------------------------------------------------------
// Phase 8 — Live option-list reader (spec row 14).
//
// The advanced-option values (Data source, Data type, Currency, …) are read from
// the LIVE DOM so a prompt shows the real, dataset-dependent choices — never a
// guessed list. Trade Map's controls are Angular-Material: clicking a trigger
// renders the options into a `.cdk-overlay-container` CDK OVERLAY (the same shape
// as the country picker — see CLAUDE.md), NOT a native <select>.
//
// SAFETY CONTRACT: this NEVER throws and NEVER auto-picks. On any miss (selector
// wrong, offline, not on a data page, empty overlay) it returns the caller's
// locked fallback list and logs `options.fallback`, so a miscalibrated selector
// degrades to the static list instead of bricking the run.
//
// The overlay selectors are UNCALIBRATED — like readCurrentFilters()/the resolver
// UI they must be pinned against the live DOM in a headed session (Phase 8B). We
// read via locator APIs only (no `page.evaluate`) so this behaves identically
// under `tsx` and compiled `node` (CLAUDE.md `__name` gotcha).
// ---------------------------------------------------------------------------

/** Matches the structured logger created in index.ts (structural typing). */
type Logger = (level: 'info' | 'warn' | 'error', event: string, data?: Record<string, unknown>) => void;

/** One live-readable control: a key for logging, a visible trigger label, and a fallback list. */
export interface OptionControl {
  key: string; // e.g. 'dataType' — used in the log line only
  triggerLabel: string; // visible text of the control trigger to click, e.g. 'Data type'
  fallback: readonly string[]; // locked static list used if the live read fails
}

export interface OptionReadResult {
  options: string[]; // the choices to offer the user (live or fallback)
  source: 'live' | 'fallback'; // provenance, for logging + tests
}

/**
 * Read a control's options from the live DOM, or fall back. Best-effort and
 * side-effect-light: it opens the control's overlay, reads the visible option
 * texts, then closes the overlay again (Escape) so the page is left as found.
 */
export async function readLiveOptions(page: Page, control: OptionControl, log: Logger): Promise<OptionReadResult> {
  try {
    // 1. Find + open the control trigger by its visible label. UNCALIBRATED selector.
    const trigger = page.locator('button, [role="button"], mat-select, .mat-mdc-select-trigger', {
      hasText: control.triggerLabel,
    }).first();
    if (!(await trigger.isVisible({ timeout: 2000 }).catch(() => false))) {
      throw new Error(`trigger "${control.triggerLabel}" not visible`);
    }
    await trigger.click();

    // 2. Read the option texts from the CDK overlay (custom pickers render here,
    //    not as <mat-option>). Match the option rows generically. UNCALIBRATED.
    const overlay = page.locator('.cdk-overlay-container');
    const optionNodes = overlay.locator('mat-option, [role="option"], .mat-mdc-option, li');
    const rawTexts = await optionNodes.allInnerTexts().catch(() => [] as string[]);

    // 3. Restore the page — dismiss the overlay whether or not we found anything.
    await page.keyboard.press('Escape').catch(() => undefined);

    const options = rawTexts.map((t) => t.trim()).filter((t) => t.length > 0);
    if (options.length === 0) {
      throw new Error('overlay produced no option text');
    }
    log('info', 'options.live', { control: control.key, count: options.length });
    return { options, source: 'live' };
  } catch (e) {
    // Never abort, never guess a VALUE — offer the locked list and record why (spec row 14).
    log('warn', 'options.fallback', { control: control.key, reason: e instanceof Error ? e.message : String(e) });
    return { options: [...control.fallback], source: 'fallback' };
  }
}
