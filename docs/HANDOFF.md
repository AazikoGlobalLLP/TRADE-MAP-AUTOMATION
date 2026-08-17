# HANDOFF — Trade Map Automated Export System — Phase 5B/live prep (code harvester) — 2026-08-17

## Done
- **The country-code harvester now works LIVE, hands-off.** `npm run harvest -- --limit 3`
  auto-seeds a data page, opens the Importer picker, types each country, reads the code from
  the URL, and confirms it against the page heading — with NO manual clicking. Confirmed live
  this session: USA=842, Germany=276, UK=826, then (fully unattended) Hong Kong China=344,
  France=251, Japan=392. France=251 matches the CLAUDE.md warning (not ISO 250).
- **`config/country-codes.json` now holds 10 real countries** (+ World): Dominica, Pakistan,
  India, China, USA, Germany, UK, Hong Kong China, France, Japan. **194 of 204 still to harvest.**
- **All Phases 2–5 are now committed** (were uncommitted at session start). Build is clean (tsc, 0 errors).

## Files changed
- src/tools/harvest-codes.ts — rewrote the picker interaction to match the REAL Trade Map DOM:
  seed a data page via `buildCanonicalUrl` (homepage has no picker), CLICK the collapsed Importer
  picker open, match the result by visible text inside the CDK overlay (`.cdk-overlay-container`),
  and dump the open overlay HTML on a no-match. Old code used `<mat-option>` (never rendered) and
  started on the bare homepage — both wrong.
- CLAUDE.md — corrected the country-selector gotcha (was "results are `<mat-option>`"; now: click the
  collapsed Importer picker, results live in the CDK overlay, match by text).
- config/country-codes.json — +6 confirmed codes from this session's live runs.
- (earlier this session) 41 files from Phases 2–5 committed as `c1aa0db`.

## Decisions made
- Harvest by DRIVING the real picker (seed data page → click Importer open → type → pick overlay
  option by text → read `/c/<code>/` → confirm via heading), because Trade Map's picker is a custom
  `<app-country-picker>` on a CDK overlay, NOT a Material autocomplete. No code is ever invented.
- Seed the search page from an ALREADY-KNOWN code (first real entry in country-codes.json), so the
  harvester never depends on the bare homepage (which has no picker at all).

## Known broken / deliberately skipped
- **194/204 codes NOT yet harvested** — only 10 real countries known. Needs one login session to run
  the full harvest; expect ~10–25 countries to fail auto-match on spelling (e.g. Russia, Korea,
  Türkiye, the two Congos) and need a manual name fix — each failure dumps its overlay HTML to
  `logs/calibration/picker-open-*.html` for reconciliation.
- **Full 200+ export has NEVER run** — 0 production output files yet. Batch/resume/retry/manifest are
  proven OFFLINE only. Realistic effort for all 200+: a supervised half-day (harvest ~1–1.5h incl.
  manual name fixes, then export in resumable passes ~2–5h).
- **Phase 6 (auto re-login on session expiry) NOT built** — a multi-hour export can drop its session
  and fail countries until manual re-login + a resume rerun. This is the biggest blocker to a truly
  hands-off full run.
- **Nothing pushed** — all work is committed locally on branch `phase-1-poc` (misnamed; now holds
  Phases 1–5 + harvester). Push a properly-named branch before opening a PR.

## Next session starts here
- **#1 PRIORITY: harvest all remaining codes, then run the first real 200+ export.**
- First command: `npm run harvest`  (all remaining ~194; login once, leave it running).
  Then reconcile any `✗` names (check `logs/calibration/picker-open-*.html`), rerun harvest to
  finish them, then: `npm run export -- --batch --countries input/countries-full.xlsx`
- Watch out for: **session expiry during the long export** (Phase 6 isn't built) — if many countries
  start failing, re-login and rerun the SAME export command; resume skips everything already done.
