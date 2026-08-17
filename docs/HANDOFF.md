# HANDOFF — Trade Map Automated Export System — Phase 1 — 2026-08-17

## Done
- Phase 1 works end-to-end on a real Trade Map login. One command exports one country.
- Verified live: `npm run export -- --country Dominica` produced a 369 KB
  `Dominica_TradeMap_Imports_AllProducts_byExporter_Monthly_Mirror_200001-202606_USD.xlsx`
  in `./output`, status SUCCESS, effective range `200001-202606` (FULL_RANGE).
- Manual-login flow works: script pauses on the login page, waits for ENTER, resumes;
  session persists in `browser-profile/` so later runs don't re-prompt.
- The PRD §6 canonical URL is CORRECT as built (log `auth.ok` landed on the exact URL).
- URL-based effective-range detection works; XLSX validation (ZIP magic bytes + workbook
  open) passed on the real file.

## Files changed (Phase 1)
- package.json, tsconfig.json — Node 20 + TS 5 strict, CommonJS; `build`/`export`/`lint`.
- config/config.json — all filters/dates/path/template/auth knobs (nothing hardcoded).
- config/country-codes.json — only PRD-written codes: World=000, Dominica=212.
- src/auth/session.ts — persistent profile launch + login-PAGE detection + ENTER pause.
- src/trademap/driver.ts — canonical-URL builder, heading gate, effective-range detect,
  Save→download capture.
- src/files/save-validate.ts — filename render, saveAs, 5-check XLSX validation.
- src/index.ts — orchestrator: requested-range → query → auth → verify → range → export
  → validate; `gotoAuthenticated` login loop.

## Decisions made
- Auth is LOGIN-PAGE-driven, not "am-I-logged-in?"-guess-driven (the guess was the bug).
- Canonical URL from PRD §6 is trusted as PRIMARY (verified live for Dominica).
- Effective range read from the URL's `NNNNNN-NNNNNN` segment (worked for a FULL_RANGE
  country); DOM fallback still a stub — see below.

## Known broken / deliberately skipped
- `readRangeFromDom()` is still a stub — because the only country tested (Dominica) was
  FULL_RANGE, so the URL segment sufficed. A CLIPPED country (e.g. Pakistan) may keep the
  requested range in the URL; the DOM readout must be built and proven in Phase 3.
- India/Pakistan/China codes NOT in country-codes.json — because their numeric codes were
  not written in the PRD; add them (verified) in Phase 3.
- No batch loop / manifest / resume / retry-per-country / screenshots — later phases.
- No git remote configured, so nothing is pushed.

## Next session starts here
- Phase 2: Config engine + country-code resolver (name → ISO numeric, UI-search fallback)
  + configurable filename generator — externalize/verify what Phase 1 hardcoded lightly.
- First command: `git checkout main && git merge phase-1-poc` (land Phase 1), then start
  Phase 2 on a new branch; or continue on `phase-1-poc` if not merging yet.
- Watch out for: the CLIPPED-range case. Do NOT trust the URL segment alone for a
  reduced-availability country — build and prove `readRangeFromDom()` before Phase 3’s
  India→Pakistan→China isolation test (this is the core project risk, PRD §39/AC-01).
