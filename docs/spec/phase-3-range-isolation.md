# SPEC LOCK — Phase 3: Range isolation across India → Pakistan → China

The most important functional test in the project. `requestedRange` is GLOBAL and immutable;
`effectiveRange` is per-country and must NEVER bleed into the next country's request (PRD §5,
§39, §40; convention #2). Phase 3 is split because the acceptance *demo* needs a live login and
real country codes, which cannot be produced headless or invented.

- **3A (build now, prove headless):** all 4 new files + a deterministic offline isolation
  harness that proves the *logic* with zero browser. This is what a session with no login can do.
- **3B (live, user runs, carried forward):** real India/Pakistan/China codes + DOM calibration
  + the 3 real `.xlsx` files. Needs a manual login.

Phase 3 is **code-complete** when 3A is green; **fully accepted** when 3B is green.

| # | Ambiguity | Locked value | Why this default |
|---|-----------|--------------|------------------|
| 1 | What "done" means with no login | Split 3A / 3B as above. 3A demoable now; 3B carried like Phase 2's live Dominica run. | Core *risk* (§39 bleed) is pure logic, provable offline; codes can't be invented (CLAUDE.md) |
| 2 | `rangeEngine.ts` API | `computeEffectiveRange(global: {requestedStart,requestedEnd}, domReadout: {start,end}\|null): EffectiveRange`. Pure, no `Page`. `FULL_RANGE` iff `start==requestedStart && end==requestedEnd`, else `CLIPPED_BY_AVAILABILITY`. Throws `DATE_ERROR` on null/malformed. Owns `parseRange`, `isYyyymm`. | §14 MAX_WITHIN_REQUESTED_RANGE; isolate the risk in one testable pure module |
| 3 | The isolation boundary | `runCountry(page, country, GLOBAL, config, codes, log)` takes the global range **by value**, **returns** `{effective, status, targetPath, fileStatus}`. NEVER writes a per-country value anywhere the next call reads. Global range `Object.freeze`d in `index.ts`. | §5/§39 contract; structural guarantee beats a comment |
| 4 | `filters.ts` — `ensure*` pattern | `ensureAllFilters(page, filters, requestedRange, log)` runs the 9 §40 checks (tradeFlow, exporter=World, product=ALL, viewBy, frequency, source, dataType, currency, range). Each: read current → change only if wrong → log `filter.corrected` when it does. DOM readers/setters structured, marked `VERIFY live (3B)`; unreadable filter → throw, never assume. | §40 verbatim; convention #4 |
| 5 | `verifyQuery.ts` — hard Save gate | `verifyQuery(page, expected, log)` blocks Save unless heading names importer (reuse `verifyCountryHeading`) AND every filter reads back correct AND range matches. Mismatch → throw `QUERY_INVALID: <what>`. Caller never reaches Save on throw. | §42 + convention #5; one gate, fail-loud |
| 6 | `runCountry.ts` | Extract the per-country body of `index.ts main()` verbatim: resolve → canonical URL from **GLOBAL** range → `gotoAuthenticated` → `ensureAllFilters` → `verifyQuery` gate → `computeEffectiveRange` → filename → save → `validateXlsx`. Dominica behaviour identical. | Reuse not rewrite; makes Phase 4 batch trivial |
| 7 | `index.ts` rewiring | `main()` freezes the GLOBAL range, calls `runCountry()` once (still `--country`, single country). Batch loop stays Phase 4. | Keep Phase 3 within file budget |
| 8 | `readRangeFromDom()` clipped trap | DOM readout takes precedence over the URL segment **for clipped detection** — a clipped country may keep the requested range in the URL. Selectors marked `VERIFY live (3B)`; null → `DATE_ERROR`, never a guess. | CLAUDE.md gotcha + DECISIONS clipped-URL risk |
| 9 | Offline isolation harness (3A demo) | `npm run test:isolation` (compiled node, Node built-in `assert`, no browser) feeds synthetic readouts India `200001-202606` → Pakistan `202401-202606` → China `200001-202606` through `computeEffectiveRange` in sequence and asserts: each call's requested input == frozen GLOBAL; China effective == `200001-202606` (NOT `202401`); Pakistan status == CLIPPED; India FULL. Prints PASS/FAIL, exits non-zero on any fail. | Proves §39 without a login; the demoable thing for 3A |
| 10 | Country codes | `country-codes.json` stays **World=000, Dominica=212 only**. India/Pakistan/China added in 3B after live URL verification. | CLAUDE.md "do not invent codes"; HANDOFF |
| 11 | New dependencies | None. Harness uses Node built-in `assert`; build stays `tsc`. | CLAUDE.md "boring standard"; Phase 1–2 added zero deps |

## OUT OF SCOPE for Phase 3 (will NOT build)
- Live-calibrating any DOM selectors (`ensure*` readers, `verifyQuery` readback, `readRangeFromDom`,
  resolver UI) — 3B, needs a login.
- Adding India/Pakistan/China (or any) real codes — 3B, after live verification.
- Batch loop / `countries.xlsx` (Phase 4), manifest/resume (Phase 5), expiry-pause/run-report (Phase 6).
- Producing the 3 real `.xlsx` files — 3B.

## ACCEPTANCE CRITERIA (binary, testable)
**3A — provable headless now:**
- [ ] `npm run build` compiles clean (zero errors) after extracting `runCountry` + 3 new files.
- [ ] `npm run test:isolation` exits 0 and prints all-pass; flipping China's requested-start
      assertion to `202401` makes it exit non-zero (proves the test bites).
- [ ] Harness proves: requested input to every country == frozen GLOBAL `200001-202606`;
      China effective `200001-202606`; Pakistan `CLIPPED_BY_AVAILABILITY` / `202401-202606`;
      India `FULL_RANGE`.
- [ ] `computeEffectiveRange(global, null)` throws `DATE_ERROR`; a clipped DOM readout while the
      URL still shows the full range yields `CLIPPED_BY_AVAILABILITY` (DOM wins).
- [ ] `verifyQuery` throws `QUERY_INVALID:` when any single filter/heading/range is wrong;
      Save is unreachable on throw.
- [ ] `country-codes.json` still contains only World=000 and Dominica=212.

**3B — user runs, one live session (carried, not blocking 3A):**
- [ ] `npm run export -- --country Dominica` produces the identical filename/range as Phase 1.
- [ ] After live login: India → Pakistan → China yield 3 valid files — China `200001-202606`,
      Pakistan `202401-202606`, India `200001-202606`, each header verified before Save.

## RISKS
- **Clipped-URL trap:** a reduced-availability country may keep the *requested* range in the URL,
  so URL-parsing would falsely report FULL_RANGE. Mitigation: `readRangeFromDom` precedence for
  clipped detection (row 8); harness proves the precedence offline before 3B trusts it live.
- **Extraction regression:** moving the per-country body could shift Dominica. Mitigation: verbatim
  move, identical wiring, `tsc` cross-check; 3B Dominica re-run confirms.
- **`ensure*`/`verifyQuery` DOM unknown until 3B.** Mitigation: same structured-but-flagged pattern
  proven on the resolver/`readRangeFromDom` — fail-loud on unreadable, never assume carryover.

**APPROVED 2026-08-17** — `go`. Split into 3A (headless, build now) + 3B (live, user runs).
This table is the contract for Phase 3. Any later change = add a row + one-word approval.
