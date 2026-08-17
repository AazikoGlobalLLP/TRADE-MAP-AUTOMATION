# Handoff

**Phase 1 starts here.**

## State right now
- Greenfield. Only the PRD + this docs spine exist. No code, no `package.json`, not yet a
  git repository.
- Phase 1 is fully specced and locked in `docs/spec/phase-1-single-country.md`
  (pending the user's `go`).

## To resume / start Phase 1
1. Get `go` on `docs/spec/phase-1-single-country.md` (or apply requested `change` rows).
2. (Optional, recommended) `git init` + commit this docs spine before writing code.
3. Scaffold the 8 Phase-1 files listed in `docs/PHASES.md` → Phase 1.
4. First: verify the live Trade Map URL structure & effective-range DOM (see spec RISKS)
   before trusting URL-navigation; pin selectors against real markup.
5. Done when every acceptance checkbox in the Phase 1 spec passes and a validated
   `Dominica_...xlsx` is in `./output`.

## Open questions for the user
- Confirm production `outputDirectory` (`D:\TradeMap\Exports` per PRD, or keep `./output`).
- Confirm Trade Map account/login will be done manually on first run (no creds stored).
- Should this become a git repo now? (Not initialized yet.)
