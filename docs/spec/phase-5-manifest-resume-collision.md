# Phase 5 — Run manifest + resume + idempotency + collision modes (SPEC LOCK)

**Locked:** 2026-08-17 · **Status:** 5A (headless/offline) buildable now · 5B (live) carried.
This file is the contract. A future session with zero memory of the chat must build the
identical thing from this table. Implementation may not introduce a value not written here.

Grounded in PRD §29 (Resume), §30 (Run Manifest), §36 (Idempotency), §37 (Filename Collision),
§38 (Orchestrator `if alreadySuccessful(country): continue`).

## SPEC LOCK table

| # | Ambiguity | Locked value | Why |
|---|-----------|--------------|-----|
| 1 | Manifest location | `./manifests/latest-run.json`, optional config key `manifestFile`. Written **atomically** (temp `.tmp` → `fs.renameSync`) after **every** country outcome — a mid-run kill always leaves valid JSON. | PROJECT_MAP reserves this path (gitignored); atomic-per-country is what makes AC-07 resume work. |
| 2 | Manifest schema | `{ schemaVersion:1, runId, updatedAt, requestedRange:"YYYYMM-YYYYMM", countries:[ {country, requestedRange, effectiveRange?, rangeStatus?, status, file?, targetPath?, attempts, updatedAt} ] }` | Superset of §30's example; `attempts`/`updatedAt`/`schemaVersion` support the Phase-6 report + kill-safety. |
| 3 | Resume / idempotency rule (§36) | **Before download**, SKIP a country iff manifest entry `status==="SUCCESS"` **AND** `validateXlsx(targetPath)` passes on disk; else RUN. Pure `shouldSkipByManifest(entry, force)` + injected `validateFile`. | §36 verbatim; re-validating on disk = never trust the manifest blindly (HANDOFF). |
| 4 | `--force` | Ignores manifest (re-runs **every** country) **and** forces this run's collision mode to `overwrite`. | §36 bypass; "I want fresh files" means the fresh download must replace the stale one. |
| 5 | Collision modes (§37) | `download.collisionMode: 'skip'|'overwrite'|'version'`. Default **derived from existing `download.overwrite`** when unset (`true→overwrite`, `false→skip`). `version` → append `_vN` (start `_v2`) before extension, first free name; cap `_v999` then throw `COLLISION_EXHAUSTED`. | §37 lists exactly these 3 modes + `_v2` example; derived default keeps the shipped config working unedited. |
| 6 | Pre-download skip vs download-before-naming | Pre-download skip keys on the **manifest entry (country + requested query)** — known before download. Collision mode keys on the **effective filename** — resolved *after* download inside `saveDownload`. | Reconciles HANDOFF: effective range comes from the FILE, so only the manifest is predictable pre-download. |
| 7 | Summary status vs manifest status | Idempotency-skip → **summary** `SKIPPED` (`skipReason:ALREADY_DONE`), **manifest** entry left `SUCCESS`. Collision-skip → both `SKIPPED` (`skipReason:FILE_EXISTS`). | Keeps the resume fast-path stable; an un-validated collision file is not promoted to SUCCESS. |
| 8 | Status enum | Unchanged 3 values `SUCCESS|SKIPPED|FAILED` + optional `skipReason`. Exit codes unchanged (0/1/2); an all-idempotency-skipped run = exit 0. | Minimises ripple into summary/report; a resumed run that does no work is a success. |
| 9 | Manifest write failure | Best-effort: on write error log `manifest.write_failed` at `error` and **continue** the run — never abort over a manifest hiccup. | A failed manifest write must not discard good exports (data-safety). |
| 10 | Files touched | **New:** `src/manifest/manifest.ts`, `src/manifest/resume.ts`, `src/files/collision.ts`, `src/manifest/manifest-check.ts`. **Modified:** `src/orchestrator/runBatch.ts`, `src/files/save-validate.ts`, `src/orchestrator/runCountry.ts`, `src/index.ts` (`--force`), `src/config/schema.ts`, `config/config.json`, `package.json`. | PHASES.md lists the 4 core files; collision plumbing threads through save-validate/runCountry/index/schema. |
| 11 | Phase split | **5A** (this): headless, offline-proven, builds clean. **5B** (carried, user runs live): kill after country 2 of 5 → rerun starts at country 3. | Same 3B/4B live-deferral pattern. |

## OUT OF SCOPE (will NOT build)
- `run-report.xlsx` (§31 — Phase 6).
- Session-expiry pause/resume (§28 — Phase 6) and `EXPORT_NOT_AVAILABLE` (§33 — Phase 6/7).
- Any parallelism (§35 sequential-only stays).
- Live browser run (carried 5B).

## ACCEPTANCE CRITERIA (binary)
- [ ] `npm run build` compiles clean (tsc, 0 errors).
- [ ] `npm run test:manifest` exits 0 (new offline harness, browser-free).
- [ ] `npm run test:isolation` still **29/29** and `npm run test:batch` still **22/22** (no regression).
- [ ] **Resume proof:** manifest with countries[0,1]=SUCCESS + valid files → runBatch over 5 countries calls fake `runCountry` **only** for [2,3,4]; [0,1] summary=SKIPPED(ALREADY_DONE); exit 0.
- [ ] **Force proof:** same manifest + `force=true` → fake `runCountry` called for **all 5**; effective collision mode = overwrite.
- [ ] **Collision `version`:** `India.xlsx` exists → `India_v2.xlsx`; `India.xlsx`+`India_v2.xlsx` → `India_v3.xlsx`.
- [ ] **Collision `skip`/`overwrite`:** existing file → skip returns no-save; overwrite returns save same name.
- [ ] **Kill-safety:** after each simulated outcome the on-disk manifest is valid JSON holding exactly the completed countries; write→load round-trips deep-equal.
- [ ] **Deleted-file safety:** manifest SUCCESS but file removed from disk → country re-runs (not skipped).

## RISKS
- Manifest trusted blindly → re-validate on disk (row 3); harness deletes a file and asserts re-run.
- Versioning infinite loop → bounded `_v2.._v999` then `COLLISION_EXHAUSTED`.
- `overwrite`-derived default surprises someone → documented in DECISIONS + GLOSSARY; current config behavior unchanged.
