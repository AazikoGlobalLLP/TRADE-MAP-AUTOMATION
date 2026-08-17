# Trade Map Automated Export System

Deterministic Playwright RPA that logs into Trade Map once, then exports monthly
import data (Save → XLSX) for a list of countries into local Excel files.
Greenfield: only the PRD exists today. First scaffolding lands in Phase 1.

## Commands (available after Phase 1 scaffolding)
- Install:   `npm install`  then  `npx playwright install chromium`
- Build:     `npm run build`      (tsc, must compile clean — no errors)
- Run:       `npm run export -- --country Dominica`   (Phase 1: single country)
- Lint:      `npm run lint`       (currently `tsc --noEmit`; eslint added later)
- Test:      acceptance is manual/headed for now; unit tests arrive Phase 3+

## The 5 conventions this codebase follows
1. Deterministic only: DOM selectors, roles, labels, URLs, download events, explicit
   waits. Never AI visual guessing. Never `sleep(n)` as a "wait" — wait on real state.
2. `requestedRange` is GLOBAL and immutable for the whole run. `effectiveRange` is
   per-country and must NEVER feed the next country's request. (This is the core risk.)
3. Nothing hardcoded in business logic: dates, filters, paths, filename template all
   come from config. Changing the run = changing config, not code.
4. After every country switch, re-verify ALL locked filters with the `ensure*` pattern:
   read current value → change only if wrong. Never assume carryover is correct.
5. Validate the query (importer heading + every filter + range) BEFORE clicking Save.

## Danger zones (do not touch casually)
- `.auth/`, `browser-profile/` — authenticated session state. NEVER commit, NEVER log
  cookies/tokens/passwords. Must stay in `.gitignore`.
- Compliance boundary: never bypass CAPTCHA, disabled Save buttons, or Trade Map limits.
  If export is refused, record the failure status and continue. Do not circumvent.
- Do not automate the user's everyday Chrome — use the dedicated profile only.

## Gotchas (learned the hard way)
- Handle auth by detecting the LOGIN PAGE (password field / login URL / "gateway to ITC"
  banner) and pausing — never by guessing "am I logged in?" on the home page. Guessing
  crashed the first run. See `src/auth/session.ts` `isLoginPage`.
- PRD §6 canonical URL is confirmed working; a CLIPPED-availability country may keep the
  requested range in the URL, so don't trust the URL range segment for those — build the
  DOM readout (`readRangeFromDom`) and prove it in Phase 3 before the isolation test.

## Sibling repos / contracts
None. Standalone tool. No `contracts/` directory.

## What "done" means here
- `npm run build` compiles clean (tsc, zero errors).
- The phase's acceptance criteria in `docs/spec/<phase>.md` all pass (binary checks).
- For any export phase: a real `.xlsx` lands in the output folder AND passes file
  validation (opens as a workbook, correct query, non-empty) — not just "download fired".

## Where things live
- Spec & phase plan: `docs/PHASES.md`, `docs/spec/`
- Decisions log: `docs/DECISIONS.md`   ·   Glossary: `docs/spec/GLOSSARY.md`
- Session handoff: `docs/HANDOFF.md`    ·   Source PRD: `Trade Map ... PRD & Architecture.md`
