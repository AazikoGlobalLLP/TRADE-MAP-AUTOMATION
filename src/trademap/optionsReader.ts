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
// The overlay selectors are CALIBRATED (2026-08-19, live byProduct DOM): the controls
// are custom `<app-single-picker>` whose overlay renders `.options-modal .option span.text`
// rows — see readLiveOptions. We read via locator APIs only (no `page.evaluate`) so this
// behaves identically under `tsx` and compiled `node` (CLAUDE.md `__name` gotcha).
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
 *
 * CALIBRATED 2026-08-19 against a live byProduct DOM. The advanced controls (Data
 * source / Data type / Currency / Detail / Numbers display) are custom
 * `<app-single-picker>` components — NOT mat-select: the visible field label lives
 * in an inner `.label`, and clicking `.form-container` (a `cdkoverlayorigin`) opens
 * a CDK overlay `.options-modal` whose rows are `.option > .text-container > span.text`
 * (with `.selected`/`.disabled` state). We read that clean value span, not the row's
 * whole text (which also carries `.sub-text` and Pro badges).
 */
export async function readLiveOptions(page: Page, control: OptionControl, log: Logger): Promise<OptionReadResult> {
  try {
    // 1. Find + open the control trigger by its visible label. The real Trade Map control is a
    //    custom app-single-picker whose `.label` == the field name; click its cdkoverlayorigin
    //    trigger. Fall back to a Material mat-select layout, then a broad text match.
    const trigger = page
      .locator('app-single-picker, app-country-picker, app-inline-selector')
      .filter({ has: page.locator('.label', { hasText: control.triggerLabel }) })
      .locator('.form-container, [cdkoverlayorigin]')
      .first();
    let opened = trigger;
    if (!(await trigger.isVisible({ timeout: 2000 }).catch(() => false))) {
      opened = page
        .locator('mat-form-field, .mat-mdc-form-field', { hasText: control.triggerLabel })
        .locator('mat-select, .mat-mdc-select-trigger, [role="combobox"], button')
        .first();
      if (!(await opened.isVisible({ timeout: 1500 }).catch(() => false))) {
        opened = page
          .locator('button, [role="button"], mat-select, .mat-mdc-select-trigger, [role="combobox"]', {
            hasText: control.triggerLabel,
          })
          .first();
      }
    }
    if (!(await opened.isVisible({ timeout: 1500 }).catch(() => false))) {
      throw new Error(`trigger "${control.triggerLabel}" not visible`);
    }
    await opened.click();

    // 2. Wait for the NEWEST overlay pane to render content (real state, not a blind sleep), then
    //    read the option VALUE spans. Read from `.last()` pane so a still-closing prior pane can't
    //    bleed in. Custom picker rows are `.option span.text`; mat-select/menu fall back to roles.
    const pane = page.locator('.cdk-overlay-pane').last();
    await pane.waitFor({ state: 'visible', timeout: 3000 }).catch(() => undefined);
    await page
      .waitForFunction(
        () => {
          const panes = document.querySelectorAll('.cdk-overlay-pane');
          const last = panes[panes.length - 1];
          return !!last && (last.textContent || '').trim().length > 0;
        },
        { timeout: 3000 },
      )
      .catch(() => undefined);

    let rawTexts = await pane
      .locator('.options-modal .option .text-container span.text, .option span.text')
      .allInnerTexts()
      .catch(() => [] as string[]);
    if (rawTexts.length === 0) {
      // mat-select / mat-menu style controls
      rawTexts = await pane
        .locator('mat-option, [role="option"], .mat-mdc-option, .mat-mdc-menu-item, [role="menuitem"]')
        .allInnerTexts()
        .catch(() => [] as string[]);
    }

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
