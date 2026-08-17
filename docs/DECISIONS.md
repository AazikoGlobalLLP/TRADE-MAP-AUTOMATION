# Decisions — Trade Map Automated Export System

Append-only. One row per decision that a future session must not silently reverse.
Format: date · decision · why · alternative rejected.

- **2026-08-17 · Playwright + TypeScript, deterministic RPA.** Why: PRD §9/§53 — core
  workflow must be reproducible via DOM/URL/download events, not AI visual guessing.
  Rejected: AI-driven browser agent (unreliable for normal execution; PRD §46).
- **2026-08-17 · Trigger Trade Map's own Save/export; never scrape rows.** Why: Save
  returns the complete dataset (up to 30k rows) as one file (PRD §34). Rejected: HTML
  pagination scraping (out of MVP scope, PRD §46).
- **2026-08-17 · `requestedRange` global+immutable; `effectiveRange` per-country, never
  carried forward.** Why: core risk — Pakistan (2024→) must not clip China (PRD §4/§39).
- **2026-08-17 · Persistent browser profile for auth; manual first login; no password in
  code/config.** Why: PRD §22/§43 security. Rejected: storing credentials in config.json.
- **2026-08-17 · Everything config-driven (dates, filters, path, filename template).**
  Why: PRD §13/§20 — monthly end-date changes must need config edits only, no code.
- **2026-08-17 · Sequential processing for MVP.** Why: simpler auth, less session
  interference, easier debugging (PRD §35). Rejected: parallel Trade Map tabs.
- **2026-08-17 · Default output `./output` (dev); production sets `D:\TradeMap\Exports`.**
  Why: repo-local default avoids writing outside the project during testing (PRD §21).
- **2026-08-17 · Filenames use the EFFECTIVE range.** Why: name truthfully describes file
  contents (PRD §19). Rejected: requested range in filename.
- **2026-08-17 · Auth is login-PAGE-driven, not logged-in-guess-driven.** Why: the "am I
  logged in?" heuristic on the home page failed silently and the run crashed on the login
  page. We now detect the login page (password field / login URL / "gateway to ITC" banner),
  PAUSE for manual login + ENTER, then re-navigate. Rejected: guessing session state.
- **2026-08-17 · PRD §6 canonical URL confirmed correct (Dominica).** Live run landed on
  `.../imports/c/212/c/000/p/ALL/byPartner/month/200001-202606/mirror/values/USD/table` and
  exported successfully. URL-navigation is the trusted PRIMARY query mechanism.
- **2026-08-17 · Effective range read from the URL segment — for FULL_RANGE only so far.**
  Worked for Dominica. OPEN: a CLIPPED country may keep the requested range in the URL;
  `readRangeFromDom()` must be built + proven before trusting clipped detection (Phase 3).
- **2026-08-17 · Config validation is hand-rolled, no new dependency (Phase 2).** Why: PRD §8
  asks for a "configuration validator" but names no library; CLAUDE.md "boring standard" +
  keep `tsc` the only build gate. Plain type guards in `src/config/schema.ts` throw one
  `CONFIG_INVALID: <field> — <problem>` and run BEFORE any browser launch. Rejected: zod/ajv.
- **2026-08-17 · Country resolution moved AFTER the browser launches (Phase 2).** Why: the
  PRD §7 UI-search fallback needs a live page; the local-map fast path never touches it, so
  Dominica behaves identically. Rejected: resolving pre-launch (would leave UI fallback pageless).
- **2026-08-17 · UI-search fallback is structured now, DOM-calibrated in Phase 3.** Why: the
  real Trade Map search selectors can't be pinned without a live login (same rule as
  `readRangeFromDom()`). It logs `country.ui_resolution_used` first, then reads the numeric
  code from the URL; if the DOM doesn't match it THROWS — never returns a guessed code.
- **2026-08-17 · Country-first, human-readable filename convention (pre-full-run).** Template is now
  `{countrySlug}__{flow}-from-World__AllProducts__{startPretty}_to_{endPretty}__{frequency}-{source}-{currency}.{extension}`
  → e.g. `Korea-Republic-of__Imports-from-World__AllProducts__2001-03_to_2026-06__Monthly-Mirror-USD.xlsx`.
  Why: the deliverable is 204 files a human browses — country leads (folder sorts/groups by country), `__`
  separates sections, dates are `YYYY-MM`. Two new tokens added to the (single) call site in `runCountry.ts`:
  `countrySlug` (NFC; non-alphanumeric runs → single `-`; accents kept) and `startPretty`/`endPretty`
  (`YYYY-MM`); `flow` too. Old tokens (`country`, `start`, `end`) kept — backward compatible. Filenames still
  use the EFFECTIVE range. NOTE: because the name changed, the 4 pre-existing old-named test files + the old
  manifest must be cleared before the full run so all 204 come out uniformly named (see HANDOFF step 1).
- **2026-08-17 · Filenames are sanitized for Windows (Phase 2).** Why: production writes to
  `D:\TradeMap\Exports` and the resolver now accepts arbitrary names; replace `\ / : * ? " < > |`
  + control chars with `_` and trim trailing dots/spaces. `generateFilename` moved to
  `src/files/filename.ts` (single source of truth); filenames still use the EFFECTIVE range.
- **2026-08-17 · Range isolation enforced structurally, not by convention (Phase 3).** Why: the
  core risk (§39 clipped-country bleed). The GLOBAL requested range is `Object.freeze`d in
  `index.ts`; `runCountry()` receives it by value, only reads it, and RETURNS the per-country
  effective range — no per-country value is stored where the next call reads. The range decision
  is a PURE function (`computeEffectiveRange` in `src/trademap/rangeEngine.ts`) so it is proven
  offline by `npm run test:isolation`. Rejected: a "don't reuse the variable" comment.
- **2026-08-17 · DOM readout beats the URL segment for CLIPPED detection (Phase 3).** Why: a
  reduced-availability country may keep the *requested* range in its URL (CLAUDE.md gotcha), which
  would falsely read FULL_RANGE. `chooseReadout(fromDom, fromUrl)` prefers the DOM; a missing
  readout is a hard `DATE_ERROR`, never an assumed full range. (`readRangeFromDom` selectors are
  still UNCALIBRATED — Phase 3B.)
- **2026-08-17 · Hard query gate before Save (Phase 3).** Why: convention #5 / §42. `verifyQuery`
  blocks Save unless heading + every locked filter + the requested range are all correct; the pure
  `assertQueryValid` reports ALL problems and throws `QUERY_INVALID:`. `ensureAllFilters` runs the
  §40 `ensure*` sweep first (correct only the wrong ones). Rejected: trusting canonical-URL nav alone.
- **2026-08-17 · Filters read from the canonical URL, not the DOM (Phase 3B calibration).** Why: a
  live Pakistan capture showed Trade Map's filters are Angular-Material components with NO native
  `<select>` — DOM reading is fragile, but the URL deterministically encodes the full query (PRD §6,
  convention #1). `parseFiltersFromUrl()` reverse-maps URL tokens → config vocabulary; proven offline
  against the real captured URL. Filter "drift" is corrected by re-navigating the canonical URL, not
  by poking Material controls (`applyFilter` fails loud instead).
- **2026-08-17 · Effective range read from data-table month columns (Phase 3B calibration).**
  ⚠️ SUPERSEDED same day — see next entry. (Was: `rangeFromColumnClasses` min→max of `mat-column-YYYYMM`.)
- **2026-08-17 · Effective range computed from the DOWNLOADED FILE, not the DOM (Phase 3B).** Why: the
  first live 4-country run revealed the new Trade Map beta does NOT clip columns — it renders EVERY
  month of the requested range and pads months a country lacks with `0`. So the DOM column span (and
  the URL) is ALWAYS the requested range → `readShownRange` reported false `FULL_RANGE` for everyone.
  Truth is now read from the exported workbook: `readEffectiveRangeFromWorkbook` → first→last month with
  a non-zero value (`dataMonthsRange`, pure + unit-tested). Verified on the real files: China 200001-202606
  (FULL), India/Pakistan 200003-202606, Dominica 200101-202606 (CLIPPED). Consequence: `runCountry`
  now downloads BEFORE naming (filename uses the file-derived effective range); the pre-download
  collision skip moves to Phase 5. `readShownRange` stays only as the verifyQuery "query loaded" check.
- **2026-08-17 · Real-world note: the beta never column-clips, so the PRD §39 "clip bleed" cannot occur.**
  The isolation logic stays (correct + harmless), but availability now shows as leading zero-months, which
  the file-based effective range captures truthfully.
- **2026-08-17 · Query gate accepts a CLIPPED subset, blocks only OUT-OF-RANGE (Phase 3B).** Why: real
  Pakistan availability is 200801–202512, so a clipped window is legitimate and must not be blocked.
  The gate now passes any non-empty window WITHIN the global range and blocks one that falls outside
  it (stale/carried state). Strong isolation stays upstream (URL built from frozen global) + in
  computeEffectiveRange. Replaces the earlier strict-equality range check.
- **2026-08-17 · Export Save button pinned to exact "Save" menu-trigger (Phase 3B).** Why: the capture
  revealed TWO buttons — "Save query" (appears first in DOM) and the export "Save" (a
  `mat-mdc-menu-trigger`). The old `:has-text("Save").first()` risked clicking the wrong one; now
  `getByRole('button', {name:'Save', exact:true})`, then pick XLSX from the Material menu.
- **2026-08-17 · Real Trade Map max month is 202512; Pakistan=586 (Phase 3B).** Why: data currently
  runs to Dec-2025, so every country clips at the end vs our requested 202606 — the PRD's illustrative
  `202401-202606` was an example, not live truth. Pakistan code 586 confirmed from its real URL (not
  invented). India/China codes pending their probe captures.
- **2026-08-17 · Phase 3 split into 3A (headless, built) + 3B (live, user-run).** Why: the §39 demo
  needs a manual login and real India/Pakistan/China codes (can't be invented — CLAUDE.md). 3A builds
  all logic + proves isolation offline (18/18 green); 3B calibrates the DOM readers and produces the 3
  real files. Same live/DOM deferral pattern as Phase 2's Dominica run. Codes file still World+Dominica only.
- **2026-08-17 · "Retry up to 3×" = 3 TOTAL attempts per country (Phase 4).** Why: the common reading
  of "3×"; `batch.maxAttemptsPerCountry` (default 3) = 1 initial + 2 retries. Inter-attempt backoff
  `batch.retryDelayMs` (default 2000ms) is a DELIBERATE pause between independent retries, NOT a
  "sleep-as-wait" (convention #1) — tests inject `delayMs:0`. Rejected: 3 retries after the first (4 total).
- **2026-08-17 · `LOGIN_REQUIRED` aborts the whole batch; per-country errors retry then continue (Phase 4).**
  Why: a dead session fails every remaining country identically, so burning retries on it is pointless —
  `isRetryable()` marks `LOGIN_REQUIRED`/`CONFIG_INVALID`/`BATCH_*` fatal, everything else retryable.
  A single country's failure NEVER stops the batch (`continueOnFailure`, default true). Proper session
  pause/resume is Phase 6. Rejected: fail-3× on a login bounce (wastes the whole run).
- **2026-08-17 · Batch exit codes: 0 all ok · 1 any FAILED · 2 aborted/empty (Phase 4).** Why: a run
  must not report success when a country failed (AC-09 spirit); an empty/bad input file is an abort, not
  a per-country failure. `readCountries` throws `BATCH_EMPTY` before the browser launches (fail fast).
- **2026-08-17 · `countries.xlsx`: column A only, tolerant reader (Phase 4).** Why: a human-edited file
  has headers/blanks/dupes. `normalizeCountryList` (pure, unit-tested) reads col A top-to-bottom = run
  order; skips a "Country"/"Countries"/"Name" header, blanks, `_`-metadata, reserved `World` (the exporter
  const 000, never an importer), and case-insensitive duplicates (first wins). Rejected: rigid schema.
- **2026-08-17 · Failure evidence = PNG + sidecar JSON per FAILED attempt (Phase 4).** Why: PRD §36. Under
  `screenshots/failures/<runId>/<Country>_attempt<N>_<ts>.png` + `.json` (runId, country, attempt, ISO ts,
  URL, filters via `parseFiltersFromUrl`, error name+message). Capture is BEST-EFFORT (try/catch) so a
  closed/crashed page never masks the real fault; never logs cookies/tokens (CLAUDE.md). Rejected: log-only.
- **2026-08-17 · `runBatch` takes injectable `deps` (runCountry/captureFailure/sleep) (Phase 4).** Why: the
  same offline-provability trick as Phase 3's pure range core — `npm run test:batch` (22/22) proves the
  loop/retry/evidence/abort/exit-code flow with a FAKE runCountry, zero browser. Isolation unchanged:
  frozen GLOBAL passed by value to every country. Rejected: only testable via a live login (Phase 4B).
- **2026-08-17 · Phase 4 split into 4A (headless, built) + 4B (live, user-run).** Why: the batch *demo*
  needs a manual login (same rule as Phases 2/3). 4A builds all 4 files + `input/countries.xlsx` + proves
  the logic offline (22/22 + build clean + isolation still 29/29); 4B is one live `--batch` run over ~5
  countries incl. a bogus name → evidence bundle for the bogus one, real files for the rest.
- **2026-08-17 · Phase 4B (live batch run) DEFERRED; proceed to Phase 5.** Why: user decision — the batch
  loop is `runCountry` (already proven live in Phase 3B) wrapped in flow proven offline (22/22), so the
  live run is low-risk confirmation, not new capability. Run it opportunistically before the Phase 7
  production run. Rejected: blocking Phase 5 on a manual login session now.
- **2026-08-17 · Resume manifest is a single atomic file `manifests/latest-run.json` (Phase 5).** Why: PRD
  §29/§30. Written temp `.tmp` → `fs.renameSync` after EVERY country outcome, so a mid-run kill always
  leaves valid JSON to resume from. Entries keyed by country name (case-insensitive); a new run reconciles
  `runId`/`updatedAt`/`requestedRange` and upserts processed countries while leaving prior entries — a
  killed run's SUCCESS survives. Optional `manifestFile` config; when absent the manifest is DISABLED (so
  the Phase-4 batch harness is unchanged). Rejected: per-runId manifest files + a pointer (over-built for MVP).
- **2026-08-17 · Idempotency skip re-validates the file on disk; never trusts the manifest alone (Phase 5).**
  Why: PRD §36 + HANDOFF — a file can be deleted/corrupted between runs. A country is skipped BEFORE download
  iff `manifest.status===SUCCESS` AND `entry.requestedRange===current` AND `validateXlsx(targetPath)` passes
  now. The manifest half is a pure predicate (`shouldSkipByManifest`); the disk check is injected
  (`validateFile`) so it is proven offline (incl. deleted-file → re-run). Rejected: skip on manifest SUCCESS alone.
- **2026-08-17 · Pre-download skip keys on the MANIFEST, collision keys on the EFFECTIVE filename (Phase 5).**
  Why: reconciles "download-before-naming" (effective range comes from the FILE, DECISIONS 2026-08-17) with
  the §36 pre-download skip. The only thing predictable before download is the manifest entry (country +
  requested range) — so idempotency skips there. Collision (§37) runs AT SAVE TIME on the real effective name.
- **2026-08-17 · Collision modes skip|overwrite|version; default DERIVED from legacy `overwrite` (Phase 5).**
  Why: PRD §37. New `download.collisionMode`; when unset, `overwrite:true→overwrite`, `false→skip`, so a
  pre-Phase-5 config behaves identically. `version` appends `_vN` (from `_v2`) before the extension, first
  free name, capped `_v999` then throws `COLLISION_EXHAUSTED`. Pure `resolveCollision(exists)` — proven offline.
- **2026-08-17 · `--force` ignores the manifest AND forces collision `overwrite` for the run (Phase 5).**
  Why: §36 says `--force` bypasses the skip; the coherent "I want fresh files" intent means the fresh
  download must also replace the stale file. Applies to batch and single-country. Rejected: `--force` only
  affecting the manifest (would then collision-skip its own fresh download under the default skip mode).
- **2026-08-17 · Idempotency-skip = summary SKIPPED(ALREADY_DONE) but manifest entry stays SUCCESS (Phase 5).**
  Why: keeps the resume fast-path stable across runs (a skipped country must still skip next time). Collision-
  skip = SKIPPED(FILE_EXISTS) in both. A manifest write failure logs `manifest.write_failed` and CONTINUES —
  never abort a run over a manifest hiccup (data-safety). Exit codes unchanged; an all-skipped run = exit 0.
- **2026-08-17 · Phase 5 split into 5A (headless, built) + 5B (live, user-run).** Why: same 3B/4B pattern.
  5A builds manifest/resume/collision + proves it offline (`npm run test:manifest` 24/24, build clean,
  isolation 29/29 + batch 22/22 unchanged). 5B is the live AC-07 demo: kill after country 2 of 5 → rerun
  starts at country 3. Carried with 4B.
- **2026-08-17 · Country codes are harvested from Trade Map's own search, never invented (production-list prep).**
  Why: the 204-country list needs a Trade Map numeric code each, and CLAUDE.md forbids inventing them. A live
  capture (`logs/calibration/country-list.*`) showed the country selector is a type-to-search AUTOCOMPLETE
  (no native `<select>`, so no bulk list in the DOM) — input `placeholder^="Type (min 2 characters)"`, results
  `<mat-option>`, selected code in the URL (`…/c/<code>/…`). `src/tools/harvest-codes.ts` (`npm run harvest`)
  types each name, picks the matching option, reads the code from the URL, and CONFIRMS via the page heading;
  writes `config/country-codes.json` atomically per code (resume-safe). Rejected: ISO codes / memory (Trade Map
  uses UN-Comtrade — USA=842 not ISO 840, France=251 not 250, India=699 not 356) and a bulk dropdown scrape (none exists).
- **2026-08-17 · Production country list is a SEPARATE file `input/countries-full.xlsx` (204).** Why: overwriting
  the shipped 4-country `input/countries.xlsx` would break the offline `test:batch` that pins it to
  `[China,India,Pakistan,Dominica]`. Built from `countries list.txt` (strip the leading serial number + trailing
  `y` flag). The full run uses `--countries input/countries-full.xlsx`; the default `batch.inputFile` stays the
  4-country fixture until codes are harvested (so an accidental `npm run batch` can't launch a ~200-fail run).
- **2026-08-17 · The harvester DRIVES the real Trade Map picker; the earlier `<mat-option>` assumption was wrong (live-proven).**
  Why: a fresh live capture + a live run showed the country selector is a custom `<app-country-picker>` on an
  Angular CDK OVERLAY, not a Material autocomplete. Three corrections, each confirmed live: (1) the picker exists
  only on a `/time-series/` DATA page — the bare homepage has none, so seed a data page via `buildCanonicalUrl`
  from an already-known code; (2) the Importer picker is COLLAPSED by default — CLICK it (the `app-country-picker`
  whose text contains "Importer") before its search `<input>` renders; (3) results are matched by VISIBLE TEXT
  inside `.cdk-overlay-container`, never by `<mat-option>` (which never appears). On a no-match the open overlay
  HTML is dumped to `logs/calibration/picker-open-*.html` for name reconciliation. Confirmed hands-off:
  USA=842, Germany=276, UK=826, Hong Kong China=344, France=251, Japan=392. Rejected: the prior `<mat-option>`
  path (never matched) and starting on the homepage (no picker). CLAUDE.md gotcha corrected to match.
- **2026-08-17 · Phase 7 = a RUN, not a build; no new code, verify from the manifest + disk (production).**
  Why: the pipeline was already proven live end-to-end (Phases 3B–5), so the full 204-country export needed
  no new capability — only execution at scale. The user ran `npm run export -- --batch --countries
  input/countries-full.xlsx` (interactive/headed: it opens a real browser and, on a login page, PAUSES on a
  terminal `readline` ENTER — so it CANNOT be launched from a non-interactive tool shell; it is the user's to
  run). Result: 204/204 SUCCESS, 0 FAILED, ~32 min, clean exit. Acceptance is verified WITHOUT re-running:
  input(204)==manifest(204)==files(204), every SUCCESS→existing non-zero file, effective ranges vary
  (47 FULL / 157 CLIPPED = isolation held), sample workbooks open. Rejected: re-exporting to "check" (would
  re-download all 204 — verification reads the manifest + disk instead).
- **2026-08-17 · Pre-run cleanup is move-to-backup, never bare hard-delete (data-safety).** Why: the 5
  old-named smoke files + old manifest had to be cleared for uniform naming, but CLAUDE.md forbids discarding
  work. They were MOVED to the session scratchpad `pre-phase7-backup/` first (reversible), then removed from
  `output/`/`manifests/`. Rejected: `Remove-Item` straight off (irreversible even for gitignored generated data).
