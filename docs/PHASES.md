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
| 8 — Interactive dynamic query builder | 🟨 CODE COMPLETE 2026-08-18 — spec-locked (18 rows) + built; offline `test:runplan` 18/18, tsc clean, existing 22/24/8/29 unchanged; adversarial review clean after 1 fix. **Live headed run is the user's** (AC pending) |

## Now
**Phase 8 CODE COMPLETE (2026-08-18) — interactive dynamic query builder is built + offline-verified.**
`npm run export -- --interactive` (or `-i`) now: confirms the country count PRE-launch, launches the headed
browser, walks the user through the query against the LIVE DOM (dataset → flow → view → time → range → data
source/type → currency → numbers display), and drives the EXISTING batch engine with the answers. Only **Time
series** is built (others exit `DATASET_UNSUPPORTED`); Importer/Product/World-partner stay default; Monthly
soft-warns if not logged in; flow-aware filenames (`india-export-country…`). Answers → `applyRunPlan` → a NEW
effective config (engine untouched). An adversarial review caught + fixed a silent resume false-skip
(interactive runs now use a **query-scoped** manifest/report path). Proven offline: `test:runplan` **18/18**,
`tsc` clean, existing `test:batch` 22/22 · `test:manifest` 24/24 · `test:report` 8/8 · `test:isolation` 29/29
all unchanged. Committed on `phase-1-poc`; **not yet pushed**. (Phase 7's 204-file imports export is unaffected
— do NOT re-run it.)

## Next 3
1. **#1 — Phase 8 LIVE acceptance (the user's headed run).** Run `npm run export:interactive`, answer the
   prompts (try flow = **Exports**), and confirm on ONE real export: (a) a `india-export-country…xlsx` lands
   and validates; (b) the Exports `/c/<code>/` URL slot order is correct; (c) `viewWord=country` reads right.
   These are the two flagged spec risks — one live export settles both. It PAUSES on a login page (ENTER to
   continue), so it can't be launched from a tool shell — it's yours to run.
2. **Make it durable: push a properly-named branch + open a PR** (carries Phases 1–8). e.g.
   `git checkout -b phase-8-interactive-query-builder` then `git push -u origin phase-8-interactive-query-builder`.
3. Optional: while calibrating, pin the `optionsReader` overlay selectors against the live DOM so the advanced
   prompts show the REAL Data type/Currency lists (they fall back to the locked lists + log `options.fallback`
   until then). Move production output to `D:\TradeMap\Exports` if that is the deliverable target.

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
