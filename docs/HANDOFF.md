# HANDOFF — Trade Map Automated Export System — Phase 9 (offline slice) — 2026-08-19

## Done
- **byProduct (View by = Product) is wired by URL and verified against ground truth.** `buildCanonicalUrl`
  inserts the `{detail}` segment (`…/byProduct/{freq}/{range}/{detail}/{source}/…`) and `parseFiltersFromUrl`
  skips it, so the pre-Save query gate reads source/dataType/currency from the correct positions. A test
  reproduces the user's REAL India URL byte-for-byte.
- **Detail tokens are all from real captured URLs, never invented:** NTL=`10` (captured 2026-08-19 from the
  user's real India `c/699` imports byProduct URL), HS2=`2`, HS4=`4`, HS6=`6`. NTL now EXPORTS. Any still-uncaptured
  level (e.g. HS8) hard-errors `DETAIL_TOKEN_UNCAPTURED` — never invented, never substituted.
- **Randomized anti-block throttle:** `runBatch` takes a break after a random **1–5 countries** that ran, for a
  random **2–7 min**, both re-drawn every break. Pause is taken BEFORE the next run, so resume-skips never waste a
  pause and none trails the last country. `throttleEveryMax=0` disables; RNG injected for deterministic tests.
- **Monthly** warning now says PRO-locked (row 24).
- Offline green: `tsc` clean; isolation 36, batch 26, runplan 20, manifest 24, report 8 (114 total, 0 failed).
- **Adversarial multi-agent review** (8 agents): byProduct URL / parser / NTL-never-invent dimensions clean; 3
  throttle findings (vacuous last-country test + wasted trailing pauses on resume) all fixed by the randomized redesign.

## Files changed (this session)
- `src/trademap/driver.ts` — byProduct branch in `buildCanonicalUrl`; `resolveDetailUrlToken` (NTL=10/HS2/4/6, else throws).
- `src/trademap/filters.ts` — `parseFiltersFromUrl` skips the byProduct `{detail}` segment.
- `src/orchestrator/runBatch.ts` — randomized throttle (injectable `random`, pause-before-run, burst re-drawn each break).
- `src/config/schema.ts` — `FiltersConfig.detail` optional; `batch.throttleEvery{Min,Max}` + `throttlePause{Min,Max}Ms` + validation.
- `config/config.json` — throttle bounds 1/5 countries, 120000/420000 ms.
- `src/config/runPlan.ts` — thread `answers.detail` into effective filters; Detail fallback `['NTL','HS6']`.
- `src/cli/prompt.ts` — Monthly PRO warning; `src/orchestrator/retry.ts` — `DETAIL_*` fatal markers.
- `src/index.ts` — byProduct/NTL pre-flight before any browser export; exit-2 classification.
- Tests: `isolation-check.ts` (byProduct URL + NTL=10 ground truth), `batch-check.ts` (randomized throttle), `runplan-check.ts` (detail thread).
- Docs: `docs/spec/phase-8-*` (rows 25–29), `docs/DECISIONS.md`, `docs/PHASES.md`, `CLAUDE.md`, `docs/STATUS.md`.

## Decisions made
- Randomized throttle (1–5 countries / 2–7 min, re-drawn each break; pause-before-run) supersedes the fixed N=5/M=120s.
- NTL byProduct token = `10`, captured from a real URL + user-confirmed (not assumed — `10` is opaque vs HS2/4/6).
- byProduct range emitted explicitly as `YYYYMM-YYYYMM` (consistent with byPartner); whether the site requires the
  literal `default` is a HEADED follow-up (never emitted speculatively).

## Known broken / deliberately skipped
- **byProduct execution is UNVERIFIED end-to-end live** — the URL builds correctly, but `readShownRange`/heading were
  calibrated only for byPartner, and it is unknown whether the site accepts an explicit range or only `default`. HEADED task.
- **`optionsReader` overlay selectors UNCALIBRATED** — Data source/type/Currency prompts still show fallback lists + log `options.fallback`.
- **Live-DOM re-analyse-after-each-answer questionnaire (row 20) NOT built** — needs the user's headed session.
- **Not pushed** — everything committed locally on `phase-1-poc` (holds Phases 1–9 offline). Push a properly-named branch before a PR.

## Next session starts here
- Phase 9 (headed): run ONE byProduct export live and calibrate — does Trade Map accept the explicit range or only `default`? do `readShownRange`/heading read the byProduct table? then pin the `optionsReader` selectors.
- First command: `npm run export:interactive` — choose View by = Product, Detail = HS6 (or NTL), and watch the query gate + the served range.
- Watch out for: **do NOT re-run the full 204 export to "check"** (accounts block) — one country is enough to calibrate; and the interactive headed run is the USER's to run (a tool shell has no stdin and will hang the browser).
