# HANDOFF — Trade Map Automated Export System — Phase 7 prep (harvest done, live batch proven) — 2026-08-17

## Done
- **Full country-code set harvested, 0 unresolved.** `npm run harvest` confirmed all 194
  remaining countries live (heading-verified, never invented) → `config/country-codes.json`
  now holds **205 countries**. All 204 names in `input/countries-full.xlsx` resolve from the
  map, so the export will NOT need UI resolution. Committed `8e5cb1f`.
- **Live batch pipeline PROVEN end-to-end (4-country smoke test).** `npm run export -- --batch`:
  Dominica downloaded fresh → `SUCCESS` with a truthful effective range (`200101-202606`,
  read from the workbook); the pre-existing China/India/Pakistan `SKIPPED`. A second run
  showed all 4 `SKIPPED` — Dominica with **0 attempts** = the resume manifest working.
  So: fresh download + file-validation + idempotent skip + manifest/resume + exit codes all green.
- **New country-first, human-readable filename convention.** Committed `f18abcc`. Example:
  `Korea-Republic-of__Imports-from-World__AllProducts__2001-03_to_2026-06__Monthly-Mirror-USD.xlsx`.
  Build clean; previewed against tricky names (commas, apostrophes, accents).

## Files changed
- `config/country-codes.json` — +194 live-confirmed codes (now 205). (`8e5cb1f`)
- `config/config.json` — `filenameTemplate` → the new country-first convention. (`f18abcc`)
- `src/orchestrator/runCountry.ts` — added filename tokens at the single call site:
  `countrySlug` (NFC; non-alphanumeric runs → single `-`; accents kept), `startPretty`/`endPretty`
  (`YYYY-MM`), `flow`; old tokens kept (backward compatible). (`f18abcc`)
- `docs/DECISIONS.md` — logged the naming-convention decision. (`f18abcc`)

## Decisions made
- Filename convention is now country-first and human-readable (see DECISIONS 2026-08-17). The
  deliverable is 204 files a person browses, so the country leads and the folder groups by country.
- Do NOT build Phase 6/7 hardening before the first full run — the pipeline is proven live; hardening
  is better informed by what a real multi-hour run actually strains.

## Known broken / deliberately skipped
- **The full 204 export has NEVER run — 0 production files yet.** Only the 4 smoke files exist,
  and 3 of those use the OLD filename. Clear them + the old manifest before the full run (step 1
  below) so all 204 come out uniformly named.
- **Phase 6 (auto re-login on session expiry) NOT built.** A multi-hour export can drop its session;
  mitigation is proven — re-login in the browser and rerun the SAME command, resume skips completed.
- **Nothing pushed.** All work is committed locally on branch `phase-1-poc` (misnamed; holds Phases
  1–5 + harvester + naming). Push a properly-named branch before opening a PR.

## Next session starts here
- Phase 7: run the first full **204-country production export** and validate the output set.
- First command (clear the 4 old-named test files + old manifest, then run — resumable):
  ```
  Remove-Item output\*.xlsx -Force
  Remove-Item manifests\latest-run.json -Force
  npm run export -- --batch --countries input/countries-full.xlsx
  ```
- Watch out for: **session expiry mid-run** (a sudden cluster of `FAILED`). Don't panic — re-login
  inside the browser window and rerun the exact same command; resume skips everything already done.
