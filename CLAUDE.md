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
- **View by = Product (byProduct)** is a DIFFERENT URL shape from byPartner. As of Phase 9 (2026-08-19) it is
  PROVEN LIVE end-to-end 2026-08-20 (real HS6 6,117-row + NTL 13,995-row India workbooks, range 200704-202605). Real byProduct URL (confirmed 2026-08-19):
  `…/time-series/exports/c/000/c/000/p/ALL/byProduct/year/default/2/direct/values/USD/table` — it inserts a
  **Detail** segment between range and source (`…/byProduct/{freq}/{range}/{detail}/{source}/{dataType}/{currency}/{view}`);
  byPartner has none. `buildCanonicalUrl` (driver.ts) now branches on `viewBy=product` to insert it and
  `parseFiltersFromUrl` (filters.ts) skips it. Detail tokens (all from REAL captured URLs, never invented, in
  `DETAIL_URL_TOKENS`): **NTL=`10`** (captured 2026-08-19 from a real India `c/699` imports byProduct URL
  `…/byProduct/month/200704-202605/10/direct/…`; `buildCanonicalUrl` reproduces it byte-for-byte), HS2=`2`, HS4=`4`, HS6=`6`.
  Any STILL-uncaptured level (e.g. HS8) → `resolveDetailUrlToken` HARD-ERRORS (`DETAIL_TOKEN_UNCAPTURED`), never
  invents/substitutes. To add one: capture its real URL, add the token to `DETAIL_URL_TOKENS`. Range is emitted
  explicitly as `YYYYMM-YYYYMM`; the captured URLs used the literal `default` (=MAX) too — whether byProduct requires
  `default` is CONFIRMED LIVE: byProduct HONOURS the explicit range and CLAMPS it to availability, writing the clamped window
  INTO the URL (200001-202606 -> 200704-202605). So — OPPOSITE of byPartner (whose URL lies) — byProduct's URL is the
  TRUTHFUL effective-range source: `readShownRange` returns null (the heavy NTL table barely renders) and
  `chooseGateRange(viewBy)` (rangeEngine.ts) makes the pre-Save gate read the range from the URL for byProduct, the DOM
  for byPartner. Detail default = NTL.
  **CALIBRATED LIVE 2026-08-20 (no longer headed):**
  - The byProduct EXPORT IS SERVER-SIDE (the file holds the full dataset, not a screen scrape), but Save yields NO
    download unless the data has FETCHED first. `runCountry` calls `waitForDataReady` (no visible `<app-loader>` AND the
    data-row count has stopped growing) before Save; timeout `download.dataReadyTimeoutMs` (NTL needs ~15 min). It is
    also login-aware there: a login page mid-load PAUSES for a manual re-login instead of failing the country.
  - Advanced controls (Data source/type/Currency/Detail) are custom `<app-single-picker>`, NOT mat-select: label in
    `.label`, trigger `.form-container[cdkoverlayorigin]`, overlay `.options-modal .option > .text-container > span.text`
    (`.selected`/`.disabled`). `optionsReader` reads that. **Mirror is DISABLED for byProduct — use `source=direct`.**
  - Production NTL run: `npm run batch -- --config config/config.production-ntl.json` (204 countries; see
    `docs/FRIEND_SETUP_GUIDE.md`). Re-run only failures: add `--retry-failed`. Filenames carry the Detail level
    (`{detailWord}` = NTL/HS6/...) so HS6 and NTL files never collide. Read-only calibration probe:
    `npm run calibrate:byproduct`.
- **Monthly frequency is PRO-locked** (the beta shows "Monthly 🔒PRO"). The Monthly signal is "needs a PRO account",
  not just "needs login". Yearly/Quarterly are free.
- **Data-type URL tokens are NOT the config word (Phase 10, live-captured).** `Quantities` → SINGULAR `quantity` in the
  URL + currency `na` (quantities have no money unit); `Values` → `values` + `USD`. Building the plural `quantities` leaves
  the page's Data type on "Choose" + "Error loading time series". Handled by `DATATYPE_URL` (driver, build) +
  `DATATYPE_FROM_URL` (filters, parse) — same pattern as freq/viewBy. Never invent a token; capture a real working URL.
- **~45 "mirror-only" countries have NO Direct data (Phase 10, live).** Navigating `.../direct/...` for Syria, Moldova,
  Vietnam, Bangladesh, Cuba, Bhutan, etc. REDIRECTS to `.../6/mirror/...` → the gate throws FILTER_DRIFT on `source`. Fix:
  `source=mirror` + `detail=HS6` (mirror data exists only at HS6). Same 45 for both data types — see
  `config/config.production-hs6-fallback.json` (quantities, na) and `config.production-hs6-mirror-values.json` (values, USD),
  list `input/countries-no-ntl.xlsx`. This is NOT a mirror-bypass; mirror is the only data offered (the earlier
  "mirror disabled for byProduct" note was a Direct-reporting country). Big Direct countries (USA, …) are the opposite: they
  only needed the Save-click timeout raised 30s→3min (`SAVE_CLICK_TIMEOUT_MS`).
- **Debugging another PC:** `npm run diagnose` writes one `diagnostics-report.txt` (git commit, manifest counts, newest log
  tail — NO secrets) to send back. On a machine that never ran a data type, `--retry-failed` finds an empty manifest and
  exits "nothing to do" — use the plain command for a fresh data type.
- **Accounts get blocked if the site is hammered.** Do NOT re-run a full export to check; space runs out. The
  RANDOMIZED anti-block THROTTLE now exists (Phase 9): `runBatch` takes a break after a random
  `batch.throttleEveryMin..throttleEveryMax` (default 1–5) countries that ran, for a random
  `batch.throttlePauseMinMs..throttlePauseMaxMs` (default 120000–420000 = 2–7 min); both re-drawn each break. The pause
  is taken BEFORE the next run, so resume-skips never waste a pause and none trails the last country. `throttleEveryMax=0`
  disables. RNG is injected (`BatchDeps.random`) for deterministic tests. Tune in config only, no code. A politeness
  throttle, NEVER a limit-bypass (compliance boundary).

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
