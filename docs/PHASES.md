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
| 4 — Batch loop + retry + failure evidence | 🟦 4A DONE — headless 22/22 + build clean 2026-08-17 · 4B (live `--batch` run) carried |
| 5 — Manifest + resume + idempotency + collision | 🟦 5A DONE — headless 24/24 + build clean 2026-08-17 · 5B (live kill/resume) carried |
| 6 — Session-expiry + query gate + report | ⬜ todo |
| 7 — 30-country production + acceptance | ⬜ todo |

## Now
Phase 5A complete (headless 24/24 + build clean; isolation 29/29, batch 22/22). Resume manifest, idempotency
skip (§36), collision modes, and `--force` all work offline. **Now prepping the real 204-country production
run:** `input/countries-full.xlsx` (built from `countries list.txt`, 204 countries) reads cleanly, and the
country-code harvester (`npm run harvest`) is built — it looks each country up on Trade Map's search,
reads the numeric code from the URL, and confirms via the page heading (no code invented). **Blocker: only
4/204 codes are known; ~200 must be harvested in one login session before the export can run.** The Trade Map
country selector is a type-to-search autocomplete (calibrated from `logs/calibration/country-list.*`).
**⚠️ Git: only Phase 1 is committed — Phases 2–5 are uncommitted on `phase-1-poc`.**

## Next 3
1. **Harvest codes** — `npm run harvest -- --limit 3` (test), then `npm run harvest` (all ~200), then the first
   real `npm run export -- --batch --countries input/countries-full.xlsx`. Commit Phases 2–5 first.
2. Phase 6 — session-expiry pause/resume + query-validation gate polish + `run-report.xlsx` (§28/§31).
3. Phase 5B / 4B (live, carried) — kill-and-resume demo + one live `--batch` incl. a bogus name; fold into Phase 7.

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

---

### Recommended session split
- **Session "PoC"** — Phase 1
- **Session "Config & Codes"** — Phases 2 + 3
- **Session "Batch & Resilience"** — Phases 4 + 5
- **Session "Auth & Reporting"** — Phase 6
- **Session "Production"** — Phase 7
