# HANDOFF — Trade Map Automated Export System — Phase 5A + code-harvest prep — 2026-08-17

## Done
- **Phase 5A code-complete and green offline.** `npm run test:manifest` → **24/24**, `npm run build`
  clean (tsc, 0 errors), no regression: `npm run test:isolation` **29/29**, `npm run test:batch` **22/22**.
  Resume manifest (atomic `manifests/latest-run.json`), pre-download idempotency skip (§36, re-validates the
  file on disk), collision modes `skip|overwrite|version`, and `--force` (ignore manifest + overwrite) all work.
- **204-country production list is loaded and readable.** `input/countries-full.xlsx` was generated from
  `countries list.txt` (leading serial number + the trailing `y` flag stripped); the batch reader parses all
  **204** names cleanly (no dupes, no bad rows).
- **Country-code harvester built + compiles.** `npm run harvest` (`src/tools/harvest-codes.ts`) uses Trade
  Map's own top search box to look up each country, reads the numeric code from the resulting URL, and
  CONFIRMS it against the live page heading — no code is ever invented. Resume-safe + incremental (writes
  `config/country-codes.json` atomically after each confirmation; a rerun skips already-known codes).
- **Country-selector calibrated from a live capture** (`logs/calibration/country-list.*`): the selector is a
  type-to-search **autocomplete** (no native `<select>`, so the full list is never in the DOM at once). The
  search input is `input[placeholder^="Type (min 2 characters)"]`, results are `<mat-option>`, and the
  selected country's code appears in the URL (`…/c/<code>/…`). Codes are **UN-Comtrade** (e.g. Algeria=012,
  USA=842, France=251), not always ISO — confirmed live, e.g. heading "Algeria's imports from World".
- **Plain-language project overview published** as an Artifact (visual "what does it do" one-pager).

## Files changed (this session)
- input/countries-full.xlsx — NEW: the 204-country production list (col A). The proven 4-country
  `input/countries.xlsx` fixture is UNTOUCHED so `test:batch` stays 22/22.
- src/tools/harvest-codes.ts — NEW: country-code harvester (search → URL code → heading confirm; resume-safe).
- src/manifest/{manifest,resume,manifest-check}.ts, src/files/collision.ts — NEW (Phase 5A, see prior handoff).
- src/orchestrator/runBatch.ts, src/files/save-validate.ts, src/orchestrator/runCountry.ts, src/index.ts,
  src/config/schema.ts, config/config.json — Phase 5A wiring (manifest/idempotency/collision/`--force`).
- package.json — added `harvest` + `test:manifest` scripts (note: user added an empty `"dev": ""` — harmless).
- docs/spec/phase-5-manifest-resume-collision.md — NEW spec lock. DECISIONS/GLOSSARY/PHASES/PROJECT_MAP/STATUS updated.
- logs/calibration/country-list.* — live capture (gitignored) used to calibrate the search selector.

## Decisions made
- Harvest codes from Trade Map's own search (autocomplete → URL code → heading confirm), NOT from a bulk
  dropdown (there isn't one) and NOT from ISO/memory (Trade Map uses Comtrade codes). Every code confirmed live.
- Production list lives in a SEPARATE file (`countries-full.xlsx`) so the 4-country test fixture — and the
  offline `test:batch` that pins it — never regress. Full run uses `--countries input/countries-full.xlsx`.
- Phase 5 split 5A (built, offline-proven) + 5B (live, carried) — same 3B/4B pattern.

## Known broken / deliberately skipped
- **⚠️ GIT: only Phase 1 is committed.** All of Phases 2–5 + this session's work are UNCOMMITTED on branch
  `phase-1-poc` (safe on disk; `/clear` will not lose them). Needs a commit + a proper branch before it's "real".
- **~200 country codes NOT yet harvested** — only 4/204 known (Dominica, India, Pakistan, China). Needs one
  login session: run the harvester. Until then a full 204 run would fail ~200 countries.
- **Full 204-country export has NEVER run** — 0 real output files for the production list yet.
- **5B (live resume demo) + 4B (live batch) carried** — logic proven offline, live confirmation pending.
- **Phase 6 (mid-run re-login + run-report.xlsx) and Phase 7 (production hardening + final acceptance) — to do.**
- Harvester autocomplete interaction is a FIRST version — may need a timing/selector tweak after the 3-country test.

## Next session starts here
- **Harvest the country codes** (the immediate blocker), then run the first real 204-country export.
- First command: `npm run harvest -- --limit 3`  (a 3-country test; login once, then paste the ✓/✗ output).
  If clean → `npm run harvest` (all ~200), then `npm run export -- --batch --countries input/countries-full.xlsx`.
- Watch out for: the harvester's autocomplete step is unproven live — if the 3-country test shows ✗ (no options,
  or wrong option picked for ambiguous names like "Congo"), fix the `mat-option` match/timing in harvest-codes.ts
  BEFORE running all 200. And commit the uncommitted Phases 2–5 work.
