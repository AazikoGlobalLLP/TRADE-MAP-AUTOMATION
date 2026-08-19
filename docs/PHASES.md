# Phases — Trade Map Automated Export System

Each phase touches ≤8 files and produces exactly one demoable thing.
These are BUILD phases. They map onto the PRD's test milestones (PRD §51) but are
sized for incremental delivery. Do phases in order; do not start N+1 until N demos.

Legend: **Demo** = the one observable thing that proves the phase is done.

## Status
| Phase | Status |
|---|---|
| 1 — Single-country PoC (Dominica) | ✅ DONE — verified live 2026-08-17 |
| 2 — Config engine + resolver + filename | ✅ DONE — headless AC green 2026-08-17 (live Dominica re-run recommended) |
| 3 — Range isolation (India→Pakistan→China) | ✅ DONE — headless 29/29 + live 3-file run, truthful effective range 2026-08-17 |
| 4 — Batch loop + retry + failure evidence | ✅ DONE — headless 22/22 + live `--batch` proven via 4-country smoke (fresh Dominica SUCCESS) 2026-08-17 |
| 5 — Manifest + resume + idempotency + collision | ✅ DONE — headless 24/24 + live resume/skip proven (smoke rerun, 0-attempt manifest skip) 2026-08-17 |
| 7 — Full 204-country production + acceptance | ✅ DONE — 204/204 SUCCESS, verified (input==manifest==disk, ranges vary, workbooks open) 2026-08-17 |
| 6 — Session-expiry + query gate + report | ✅ DONE — run-report.xlsx + explicit session-expiry pause/resume; headless report 8/8 + batch 22/22 + manifest 24/24 green 2026-08-18 |
| 8 — Interactive dynamic query builder | 🟨 CODE COMPLETE 2026-08-18 — spec-locked (19 rows) + built; `test:runplan` 19/19, tsc clean. **By-exporter works LIVE** (imports 4/4 proven); by-product errors (uncalibrated → Phase 9). Detail/NTL prompt added |
| 9 — Live-DOM-driven + anti-block redesign | 🟨 OFFLINE SLICE BUILT 2026-08-19 — build-time spec-lock (rows 28–29): **randomized throttle** (break after a random 1–5 countries for a random 2–7 min, re-drawn each break), **NTL token captured = `10`** (NTL exports; uncaptured levels hard-error). byProduct URL builder+parser (reproduces the real URL byte-for-byte), Detail tokens NTL/HS2/4/6, randomized anti-block throttle, Monthly-PRO warning all wired + tested (isolation 36, batch 26, runplan 20; tsc clean; adversarial review clean/fixed). **Still HEADED:** live-DOM questionnaire (row 20) + byProduct `readShownRange`/heading calibration |

## Now
**Phase 9 offline slice is BUILT (spec rows 28–29 locked with the user 2026-08-19).** The byProduct query is wired by
URL: `buildCanonicalUrl` inserts the `{detail}` segment (`…/byProduct/{freq}/{range}/{detail}/{source}/…`),
`parseFiltersFromUrl` skips it so the query gate reads the right positions. Detail tokens are all from REAL captured
URLs: **NTL=`10`** (the user's real India URL — NTL now exports), HS2/HS4/HS6 = `2`/`4`/`6`; any uncaptured level
hard-errors (never invented/substituted). The **randomized anti-block throttle** takes a break after a random **1–5
countries** that ran, for a random **2–7 min**, both re-drawn each break (`batch.throttleEvery{Min,Max}` /
`throttlePause{Min,Max}Ms`; RNG injected; pause taken BEFORE the next run so resume-skips/last-country never waste a
pause; `throttleEveryMax=0` disables). Monthly warning says **PRO-locked**. Green: isolation 36, batch 26, runplan 20
(manifest 24 / report 8 unchanged), tsc clean; adversarial multi-agent review clean (3 throttle findings fixed).
Committed on `phase-1-poc`; **not yet pushed**.

**Still HEADED (needs the user's live session, NOT built):** the live-DOM re-analyse-after-each-answer questionnaire
(row 20), and the byProduct `readShownRange`/heading calibration. byProduct export (HS6 + NTL) is wired by URL but
unverified end-to-end live.

## Next 3
1. **#1 — HEADED calibration session (the user's).** With a logged-in browser, run a byProduct export and confirm it
   works end-to-end: does Trade Map accept the explicit `YYYYMM-YYYYMM` range or only the literal `default`? Do
   `readShownRange`/heading read the byProduct data table? Also pin the `optionsReader` overlay selectors so Data
   source/type/Currency read live, not the fallback lists.
2. **Verify the randomized throttle on a real longer run** — confirm the 1–5 country / 2–7 min random breaks actually
   stop the account blocking; adjust the `throttle*` bounds in config only (no code) if blocking persists. Monthly is
   PRO-locked — don't hammer it.
3. **Push a properly-named branch + PR** (carries Phases 1–9 offline): e.g.
   `git checkout -b phase-9-byproduct-throttle` then `git push -u origin phase-9-byproduct-throttle`.

## Carried into Phase 3 (from Phase 2)
- One live `npm run export -- --country Dominica` to confirm the refactor didn't regress
  the real download (needs manual login; all headless AC already pass).
- The resolver's UI-search selectors are structured but UNCALIBRATED — pin them against the
  live DOM when adding India/Pakistan/China.

---

## Phase 1 — Single-country proof of concept (Dominica)  ✅ DONE (2026-08-17)
Scaffold the project, log in once (manual, persistent session), build the canonical
query for ONE country, detect its effective range, click Save, capture the XLSX,
save+rename to the configured folder, and validate the file.
Full locked spec: `docs/spec/phase-1-single-country.md`
**Demo:** one valid `Dominica_TradeMap_...xlsx` in `./output`, passing all 5 file checks.
Files: package.json, tsconfig.json, config/config.json, config/country-codes.json,
src/index.ts, src/trademap/driver.ts, src/auth/session.ts, src/files/save-validate.ts

## Phase 2 — Config engine + country-code resolver + filename generator  ✅ DONE (2026-08-17)
Externalize all filters/dates/paths; ISO-numeric country-code map with UI-search
fallback; configurable filename template rendered from effective range.
Full locked spec: `docs/spec/phase-2-config-resolver-filename.md`
**Demo:** change `config.json` (dates or filename template) → output filename/range
changes with zero code edits. Unknown country → resolver logs "UI resolution used".
Files: src/config/loadConfig.ts, src/config/schema.ts, src/country/resolver.ts,
src/files/filename.ts, config/config.json, config/country-codes.json

## Phase 3 — Range isolation across 3 countries (India → Pakistan → China)  ← NEXT
Reset filters + global range after EVERY country switch; prove Pakistan's clipped
start (202401) does not bleed into China. This is the most important functional test.
**Demo (AC-01):** 3 files — China `200001-202606`, Pakistan `202401-202606`,
India `200001-202606`; each header verified before Save.
Files: src/orchestrator/runCountry.ts, src/trademap/filters.ts,
src/trademap/rangeEngine.ts, src/trademap/verifyQuery.ts

## Phase 4 — Batch loop + countries.xlsx reader + per-country retry + failure evidence
Read ordered country list from Excel; loop sequentially; retry each country up to 3×;
on failure capture screenshot + URL + filters + timestamp and continue the batch.
**Demo:** 5-country batch; one deliberately-failing country still yields a screenshot
+ error log and the remaining countries complete.
Files: src/input/readCountries.ts, src/orchestrator/runBatch.ts,
src/orchestrator/retry.ts, src/evidence/captureFailure.ts, input/countries.xlsx

## Phase 5 — Run manifest + resume + idempotency + collision modes
Write a run manifest as countries complete; on restart, resume only PENDING countries;
skip already-SUCCESS+validated files unless `--force`; skip/overwrite/version collisions.
**Demo (AC-07):** kill the run after country 2 of 5; rerun starts at country 3.
Files: src/manifest/manifest.ts, src/manifest/resume.ts, src/files/collision.ts,
src/orchestrator/runBatch.ts

## Phase 6 — Session-expiry pause/resume + query-validation gate + run report
Detect login redirect → PAUSE the whole run (not fail-3×), let user re-login, resume
current country. Hard gate: never Save unless every filter+heading matches. Emit
human-readable `run-report.xlsx`.
**Demo (AC-08):** expire the session mid-run → automation pauses and prompts login,
then resumes; `run-report.xlsx` lists requested/effective/status/attempts per country.
Files: src/auth/expiry.ts, src/orchestrator/runBatch.ts, src/report/runReport.ts,
src/trademap/verifyQuery.ts

## Phase 7 — 30-country production hardening + full acceptance
Large-download timeouts, structured logging polish, and an end-to-end run validating
every acceptance criterion AC-01…AC-12.
**Demo:** full 30-country batch completes with manifest + run-report; AC checklist green.
Files: src/logging/logger.ts, config/config.json, docs/spec/acceptance.md,
src/orchestrator/runBatch.ts

## Phase 8 — Interactive dynamic query builder  ← #1 PRIORITY (needs spec-lock first)
Today the whole query is fixed in `config.json`. Phase 8 makes each RUN interactive:
the tool reads the live Trade Map options from the DOM, asks the user what they want
BEFORE launching the export, then drives the batch with those answers. Because many
options are inter-dependent (chosen dataset → which advanced options exist → which
values each offers), the DOM is re-read after each choice — never assumed.

**Country list source:** one editable location (e.g. `input/countries.xlsx` / a config
path) holds the exporter country list; editing it changes what the auto-run processes,
no code change.

**Startup confirmation + prompts (in order):**
- Confirm: "About to export data for **X** countries — proceed?"
- Dataset: `[Time series, Trade indicators, Companies]` (or Trade in services). Default/most: Time series.
- If **Time series**:
  - Trade flow: `[Imports, Exports]`
  - **Exporter** = the given country list (this is what varies per country)
  - **Importer** and **Product** — left in their DEFAULT state, untouched
  - View by: `[Product / Exporter]`
  - Advanced options (revealed after the above):
    - Time: `[Yearly, Quarterly, Monthly]` — if **Monthly**, first verify a login cookie
      exists in the browser profile; if not, WARN "you must log in first" (don't hard-fail)
    - Time range: user types it; empty ENTER → use the default MAX
    - Detail: NOT shown when View by = Exporter
    - Data type: `[Values, Mirror, Quantities, …]` — options read live (can differ)
    - Currency: read live (mainly `USD`, `EUR`)
    - Numbers display: `[Smart, Thousands, Millions]`
- The confirmed defaults from the request: View by = Exporter; Advanced = Monthly,
  Time range MAX, Data source = Mirror, Currency = USD, Numbers display = Smart.

**Flow-aware filename:** name reflects whose data + which flow, e.g. India's export data
→ `india-export-country…`, India's import data → `india-import-country…` (exact template
locked in spec-lock; today's convention is country-first `Country__Imports-from-World__…`).

**Demo:** run the command → answer the prompts → the batch exports exactly the chosen
query for the chosen countries, with flow-aware filenames; re-running with different
answers changes the output with zero code edits.
Files (planned): src/cli/prompt.ts, src/trademap/optionsReader.ts (live DOM option lists),
src/config/runPlan.ts (answers → run plan), src/files/filename.ts (flow-aware), config/config.json
**Blocked on:** spec-lock — dataset-type coverage, the exact dynamic option lists, the
Monthly cookie-check signal, and the final filename template are not yet nailed to
binary acceptance criteria. Lock those before building.

---

### Recommended session split
- **Session "PoC"** — Phase 1
- **Session "Config & Codes"** — Phases 2 + 3
- **Session "Batch & Resilience"** — Phases 4 + 5
- **Session "Auth & Reporting"** — Phase 6
- **Session "Production"** — Phase 7
