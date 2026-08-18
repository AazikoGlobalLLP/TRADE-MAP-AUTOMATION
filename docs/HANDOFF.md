# HANDOFF — Trade Map Automated Export System — Phase 8 — 2026-08-18

## Done
- **Phase 8 spec-locked (18 rows) then built:** `npm run export -- --interactive` (alias `-i`, or
  `npm run export:interactive`) turns each run into an interactive query builder. It confirms the country
  count BEFORE launching a browser, then — POST-launch, against the live DOM — walks the user through
  Dataset → Trade flow → View by → Time → Time range → Data source → Data type → Currency → Numbers display,
  and drives the EXISTING batch engine with the answers. `--batch` / `--country` are untouched.
- **Answers → effective config, engine unchanged:** pure `applyRunPlan(config, answers)` returns a NEW
  `AppConfig` (filters + datePolicy + filenameTemplate overridden, input never mutated) that feeds
  `runBatch`/`runCountry` verbatim — all the tested isolation / `ensure*` / query-gate / save / manifest /
  report machinery is reused.
- **Flow-aware filenames** (spec row 16): `india-export-country__2001-01_to_2026-06__monthly-mirror-USD.xlsx`
  (imports → `india-import-country…`). Added alongside the existing tokens, so the country-first `--batch`
  template is unchanged.
- **Adversarial review (4 finders + skeptic verify) caught + fixed 1 HIGH bug:** interactive runs reused the
  batch resume manifest (keyed on country + range only), so an Exports run at the shipped imports range would
  silently SKIP all 204 and export nothing. Fixed by query-scoping the manifest/report path (spec row 18).
- **Proven offline:** `npm run test:runplan` **18/18**, `tsc` clean, and `test:batch` 22/22 · `test:manifest`
  24/24 · `test:report` 8/8 · `test:isolation` 29/29 all still green (engine untouched). Real-CLI check:
  non-TTY `--interactive` refuses (`INTERACTIVE_REQUIRES_TTY`, exit 2, no browser).

## Files changed / added
- `docs/spec/phase-8-interactive-query-builder.md` — NEW, the locked contract (18 rows + ACs).
- `src/config/runPlan.ts` — NEW: `applyRunPlan` (pure), option lists, interactive filename template,
  `queryIdentitySlug`/`scopePathByQuery` (the resume-scoping fix), `describePlan`.
- `src/cli/prompt.ts` — NEW: pure parsers + injectable-`Ask` flow (`confirmProceed`, `collectRunPlan`,
  `createStdinAsk`).
- `src/trademap/optionsReader.ts` — NEW: live CDK-overlay option reader; logged fallback; selectors UNCALIBRATED.
- `src/config/runplan-check.ts` — NEW: offline harness (`npm run test:runplan`, 18/18).
- `src/files/filename.ts` — `deriveFlowTokens` (flowWord/viewWord/timeWord/sourceWord).
- `src/orchestrator/runCountry.ts` — spread the flow tokens into the filename token map.
- `src/index.ts` — the `--interactive` branch + exit-2 aborts (`DATASET_UNSUPPORTED`/`INTERACTIVE_REQUIRES_TTY`).
- `package.json` — `export:interactive` + `test:runplan` scripts.
- `docs/PHASES.md`, `docs/DECISIONS.md`, `docs/spec/GLOSSARY.md` — Phase 8 recorded.

## Decisions made
- Only **Time series** is built this phase; other datasets prompt then exit `DATASET_UNSUPPORTED` (row 4).
- Importer / Product / World-partner (000) / `view` are left DEFAULT — flipping `tradeFlow` is all Exports
  needs, so the country stays in the first `/c/<code>/` slot (row 6, flagged to confirm live).
- Monthly login check is a SOFT warn via `isLoginPage` (never hard-fail), honouring the CLAUDE.md
  "detect the login PAGE, don't guess logged-in" gotcha (row 9).
- Live option LISTS are read for the prompts only; everything is still driven by the canonical URL. A
  read miss falls back to the locked static list + logs `options.fallback` — never guesses a value (row 14).
- Interactive resume uses a query-scoped manifest/report path so a different query can't false-skip (row 18).

## Known broken / deliberately skipped
- **Not pushed** — everything is committed locally on `phase-1-poc` (misnamed; now holds Phases 1–8). Push a
  properly-named branch before opening a PR (see Next).
- **LIVE acceptance is the USER's to run** — the interactive export is headed and PAUSES on a login page
  (terminal ENTER), so it can't be driven from a tool shell. The offline half is fully green; the on-browser
  half (a real `india-export-*.xlsx`, the Exports URL-slot order, the `viewWord=country` reading) is pending.
- **`optionsReader` selectors are UNCALIBRATED** (same status filters/resolver once had). Until pinned live,
  the Data source / Data type / Currency prompts show the LOCKED fallback lists (and log `options.fallback`),
  not the live ones. This is by design (spec OUT OF SCOPE) — calibrate in a headed session.
- Numbers display is prompted + recorded (log `plan.confirmed`) but NOT DOM-driven (not URL-encoded, row 13).

## Next session starts here
1. **Phase 8 LIVE run (yours):** `npm run export:interactive` → answer prompts (try flow = **Exports**) → on
   ONE real export confirm the `india-export-country…xlsx` lands + validates, and that the Exports `/c/<code>/`
   slot + `viewWord=country` read correctly (the two flagged risks — one export settles both).
2. **Push a properly-named branch + PR** (carries Phases 1–8): e.g.
   `git checkout -b phase-8-interactive-query-builder` then `git push -u origin phase-8-interactive-query-builder`.
3. Optional: pin the `optionsReader` overlay selectors against the live DOM so the advanced prompts show the
   REAL option lists; then production output can move to `D:\TradeMap\Exports`.
- Watch out for: do NOT re-run the Phase 7 204-country imports export to "check" anything — it's still valid.
  And the interactive path writes a SEPARATE query-scoped manifest, so an interactive imports run will NOT
  see the batch's `latest-run.json` (by design — it prevents the false-skip, but means no cross-entry resume).
