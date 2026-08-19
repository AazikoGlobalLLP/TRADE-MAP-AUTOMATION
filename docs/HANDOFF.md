# HANDOFF — Trade Map Automated Export System — Phase 8 → 9 — 2026-08-19

## Done
- **Phase 8 interactive builder is built and works LIVE for View by = Exporter.** `npm run export:interactive`
  confirms the country count, launches headed, walks the query prompts, and drives the existing batch engine.
  A real run exported all 4 fixture countries (China/India/Pakistan/Dominica) SUCCESS on imports/by-exporter.
- **Detail/NTL prompt added** (shows only when View by = Product, default NTL) and the silent resume false-skip
  from the earlier review is fixed (interactive runs use a query-scoped manifest/report path).
- **Phase 9 spec-locked** (rows 20–24 in the Phase 8 spec) from the real byProduct URL + DOM the user provided:
  a live-DOM-driven questionnaire, byProduct URL wiring, Detail NTL→HS6, and a throttle so accounts stop blocking.
- Offline green: `test:runplan` 19/19, `tsc` clean, existing `test:batch` 22/22 · `test:manifest` 24/24 ·
  `test:report` 8/8 · `test:isolation` 29/29 all unchanged.

## Files changed (this session)
- `docs/spec/phase-8-interactive-query-builder.md` — spec-lock (rows 1–19) + Phase 9 rows 20–24 (byProduct URL decoded).
- `src/config/runPlan.ts` — `applyRunPlan`, option lists, flow-aware template, query-scoped manifest/report, Detail NTL.
- `src/cli/prompt.ts` — pure parsers + injectable-`Ask` flow; Detail prompt for Product view.
- `src/trademap/optionsReader.ts` — live CDK-overlay option reader with logged fallback (selectors UNCALIBRATED).
- `src/files/filename.ts` — `deriveFlowTokens`; `src/orchestrator/runCountry.ts` — flow tokens in the filename map.
- `src/index.ts` — `--interactive` branch (TTY guard, confirm, plan, reuse runBatch) + exit-2 aborts.
- `src/config/runplan-check.ts` — NEW harness (`npm run test:runplan`, 19/19).
- `docs/PHASES.md`, `docs/DECISIONS.md`, `docs/spec/GLOSSARY.md`, `CLAUDE.md` — Phase 8 done + Phase 9 recorded.

## Decisions made
- By-exporter works live; by-product errors because that query shape was never calibrated (not a code bug — a calibration gap).
- byProduct URL decoded from the user's real URL: it adds a Detail segment (HS2=2/HS4=4/HS6=6; **NTL token UNKNOWN**), range may be `default`.
- Monthly is a **PRO-locked** feature; accounts block if the site is hammered → Phase 9 adds a throttle (compliance: throttle, never bypass).
- Phase 9 spec-locked but NOT built this turn: DOM extraction + byProduct calibration need a live headed session, and the throttle N + pause M are spec-lock-at-build values.

## Known broken / deliberately skipped
- **View by = Product errors per-country** — uncalibrated byProduct URL/heading/range readers. Phase 9.
- **`optionsReader` selectors UNCALIBRATED** — Data source / Data type / Currency prompts show the locked fallback lists + log `options.fallback` (expected, not a failure) until pinned live.
- **Not pushed** — everything committed locally on `phase-1-poc` (holds Phases 1–8). Push a properly-named branch before a PR.
- **Accounts getting blocked** — interim: don't re-run the full export to "check"; the throttle buffer is the #1 Phase 9 fix.

## Next session starts here
- Phase 9: build the live-DOM-driven + anti-block redesign from spec rows 20–24 (dynamic questionnaire, byProduct wiring, Detail NTL→HS6, throttle-between-countries).
- First command: `/boot` — then `/spec-lock` the exact throttle N + pause M, and **capture a real `Detail=NTL` URL** (from the browser) before wiring NTL — never invent its token.
- Watch out for: **do not guess the byProduct/NTL URL or the throttle numbers** (CLAUDE.md), and the whole DOM-extraction part needs the USER's live headed session — it can't be driven from a tool shell.
