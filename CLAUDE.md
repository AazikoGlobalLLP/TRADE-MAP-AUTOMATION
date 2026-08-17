# Trade Map Automated Export System

Deterministic Playwright RPA that logs into Trade Map once, then exports monthly
import data (Save → XLSX) for a list of countries into local Excel files.
Greenfield: only the PRD exists today. First scaffolding lands in Phase 1.

## Commands (available after Phase 1 scaffolding)
- Install:   `npm install`  then  `npx playwright install chromium`
- Build:     `npm run build`      (tsc, must compile clean — no errors)
- Run:       `npm run export -- --country Dominica`   (Phase 1: single country)
- Lint:      `npm run lint`       (currently `tsc --noEmit`; eslint added later)
- Test:      acceptance is manual/headed for now; unit tests arrive Phase 3+

## The 5 conventions this codebase follows
1. Deterministic only: DOM selectors, roles, labels, URLs, download events, explicit
   waits. Never AI visual guessing. Never `sleep(n)` as a "wait" — wait on real state.
2. `requestedRange` is GLOBAL and immutable for the whole run. `effectiveRange` is
   per-country and must NEVER feed the next country's request. (This is the core risk.)
3. Nothing hardcoded in business logic: dates, filters, paths, filename template all
   come from config. Changing the run = changing config, not code.
4. After every country switch, re-verify ALL locked filters with the `ensure*` pattern:
   read current value → change only if wrong. Never assume carryover is correct.
5. Validate the query (importer heading + every filter + range) BEFORE clicking Save.

## Danger zones (do not touch casually)
- `.auth/`, `browser-profile/` — authenticated session state. NEVER commit, NEVER log
  cookies/tokens/passwords. Must stay in `.gitignore`.
- Compliance boundary: never bypass CAPTCHA, disabled Save buttons, or Trade Map limits.
  If export is refused, record the failure status and continue. Do not circumvent.
- Do not automate the user's everyday Chrome — use the dedicated profile only.

## Gotchas (learned the hard way)
- Handle auth by detecting the LOGIN PAGE (password field / login URL / "gateway to ITC"
  banner) and pausing — never by guessing "am I logged in?" on the home page. Guessing
  crashed the first run. See `src/auth/session.ts` `isLoginPage`.
- EFFECTIVE RANGE COMES FROM THE DOWNLOADED FILE, never the DOM/URL. The new Trade Map beta does
  NOT clip columns — it renders the full requested range and pads unavailable months with `0`. So
  the DOM/URL month span is ALWAYS the requested range and will lie (false FULL_RANGE). Read the
  real range from the workbook (`readEffectiveRangeFromWorkbook` → first→last non-zero month).
- Trade Map codes are UN-COMTRADE numbers, NOT ISO-3166 (India=699, not 356; Pakistan=586,
  China=156, Dominica=212 happen to match; USA=842 not 840; France=251 not 250). Confirm every
  new code from a real logged-in URL (`…/c/<code>/…`) — never invent, never assume ISO. To add
  many codes, run `npm run harvest` (`src/tools/harvest-codes.ts`): it types each country into
  Trade Map's search, reads the code from the URL, and confirms it against the page heading.
- The country selector is a type-to-search AUTOCOMPLETE (no native `<select>`, so the full country
  list is NEVER in the DOM at once). Search input `placeholder^="Type (min 2 characters)"`, selected
  code appears in the URL. Don't try to scrape a bulk dropdown — there isn't one. TWO live facts
  (confirmed 2026-08-17, the hard way): (1) the Importer picker is COLLAPSED by default — you must
  CLICK it (`app-country-picker` whose text contains "Importer") before the search `<input>` renders;
  (2) results are NOT `<mat-option>` — the custom `<app-country-picker>` renders them into an Angular
  CDK OVERLAY (`.cdk-overlay-container`). Match the option by its VISIBLE TEXT inside that overlay,
  not by a tag. The bare homepage has no picker at all; it exists only on a `/time-series/` data page.
- Filters are Angular-Material components with NO native `<select>`. Read/verify filters from the
  canonical URL (`parseFiltersFromUrl`), not the DOM. The export Save is the mat-menu button labelled
  exactly "Save" (a separate "Save query" button exists and comes first in the DOM).
- Any browser script that uses `page.evaluate` MUST run compiled (`node dist/...`), not `tsx`:
  esbuild injects a `__name` helper that is undefined in the browser → `ReferenceError`. `export`
  and `calibrate` npm scripts already do `tsc && node dist/...`.
- The export run is INTERACTIVE + HEADED and is the USER's to run, never Claude's via a tool shell.
  It opens a real browser and, on a login page, PAUSES on a terminal `readline` ENTER
  (`promptManualLogin`). A non-interactive tool shell has no stdin → the prompt would hang a headed
  browser with no way to answer. Hand the user the command; don't launch it in the background.
- To VERIFY a finished export, read `manifests/latest-run.json` + the files on disk — do NOT re-run
  the export "just to check" (it re-downloads all 204). Acceptance = input count == manifest entries
  == files on disk, every SUCCESS→existing non-zero file, effective ranges vary (isolation held).

## Sibling repos / contracts
None. Standalone tool. No `contracts/` directory.

## What "done" means here
- `npm run build` compiles clean (tsc, zero errors).
- The phase's acceptance criteria in `docs/spec/<phase>.md` all pass (binary checks).
- For any export phase: a real `.xlsx` lands in the output folder AND passes file
  validation (opens as a workbook, correct query, non-empty) — not just "download fired".

## Where things live
- Spec & phase plan: `docs/PHASES.md`, `docs/spec/`
- Decisions log: `docs/DECISIONS.md`   ·   Glossary: `docs/spec/GLOSSARY.md`
- Session handoff: `docs/HANDOFF.md`    ·   Source PRD: `Trade Map ... PRD & Architecture.md`
