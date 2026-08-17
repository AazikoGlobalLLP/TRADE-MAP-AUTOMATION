# SPEC LOCK — Phase 4: Batch loop + countries.xlsx reader + per-country retry + failure evidence

Read an ordered country list from `input/countries.xlsx`, loop **sequentially** over the
proven `runCountry()` isolation boundary, retry each country up to 3×, and on failure capture
a screenshot + URL + filters + timestamp — then **continue the batch**. A single country's
failure must never stop the rest. (PRD §5/§35 sequential; PRD §7 resolver; PRD §36 evidence.)

Like Phase 3, the acceptance *demo* needs a live login, so Phase 4 is split:

- **4A (build now, prove headless):** all 4 new files + `input/countries.xlsx` + a deterministic
  offline batch harness (`npm run test:batch`) that proves the loop/retry/evidence/summary logic
  with a **fake `runCountry`**, zero browser. This is what a session with no login can do.
- **4B (live, user runs):** one real `npm run export -- --batch` over ~5 countries incl. one
  deliberately-failing name → evidence bundle for the failing one, completed files for the rest.

Phase 4 is **code-complete** when 4A is green; **fully accepted** when 4B is green.

| # | Ambiguity | Locked value | Why this default |
|---|-----------|--------------|------------------|
| 1 | countries.xlsx **format** | Sheet 1, **column A only**. Row 1 skipped iff A1 ∈ {country, countries, name} (case-insens.), else read as data. One name per non-empty cell; **row order = run order**; each value trimmed. `readCountries(path): string[]`. | Simplest deterministic contract; tolerates header-or-no-header |
| 2 | **blank / dup / reserved** | Skip empty/whitespace cells; skip `_`-prefixed; skip `World` (exporter const `000`, never an importer) → log `country.reserved_skipped`; de-dup case-insensitively **first-wins** → log `country.duplicate_skipped`. | Mirrors resolver's `_note`/case-insensitive logic; a real edited file has these |
| 3 | zero countries read | throw `BATCH_EMPTY`; batch aborts; **exit 2**. | Empty run is a user error, not a silent no-op |
| 4 | "**retry up to 3×**" | **3 total attempts** per country (1 initial + 2 retries), from `batch.maxAttemptsPerCountry` (default 3). Inter-attempt backoff `batch.retryDelayMs` (default 2000ms) — a deliberate pause, **not** a state-wait (conv. #1 kept; documented). Tests inject `delayMs:0`. | "3×" = 3 tries; backoff configurable + 0 in tests |
| 5 | what is **retryable** | Per-country errors (`DOWNLOAD_TIMEOUT`, `QUERY_INVALID`, `FILTER_*`, `COUNTRY_UI_RESOLUTION_FAILED`, validation) → retry then record `FAILED`, **continue**. `LOGIN_REQUIRED` → **not retryable, aborts the whole batch (exit 2)**. `isRetryable(err)` in `retry.ts`. | A dead session fails every remaining country identically; Phase 6 adds pause/resume |
| 6 | `SKIPPED` (file exists, overwrite:false) | Counts as **completed** — not failed, not retried; batch continues. | Matches `runCountry`'s existing SKIPPED contract |
| 7 | **evidence** | Per **failed attempt**: `screenshots/failures/<runId>/<Country>_attempt<N>_<ts>.png` (fullPage) + sidecar `.json` `{runId, country, attempt, maxAttempts, timestamp(ISO), url, filters(parseFiltersFromUrl), error:{name,message}, screenshot}`. `<ts>`=`toISOString().replace(/[:.]/g,'-')`. `captureFailure(page, {...}): Promise<string\|null>`. | PROJECT_MAP puts failures in `screenshots/failures/`; filters via existing URL parser; ts matches `runId` convention |
| 8 | evidence capture **itself throws** | Best-effort: try/catch, log `evidence.capture_failed`, **never mask the original error**; return `null`. | Page may be closed/crashed; evidence must not hide the real fault |
| 9 | **CLI / invocation** | `--country X` unchanged (single, existing path). New: `npm run export -- --batch [--countries <path>]`; default input `./input/countries.xlsx`. New npm scripts `batch` + `test:batch`. | Back-compat; batch is opt-in |
| 10 | **summary + exit code** | End: `batch.summary` log + stdout table (country · status · attempts · effective range). Exit **0** all SUCCESS/SKIPPED · **1** any FAILED · **2** aborted/empty. `runBatch(...)` returns `BatchSummary`. | Non-zero on failure so a run can't lie about success (AC-09 spirit) |
| 11 | **config additions** | Optional `batch` block, all defaulted so existing config still validates: `inputFile:"./input/countries.xlsx"`, `maxAttemptsPerCountry:3`, `retryDelayMs:2000`, `continueOnFailure:true`, `evidenceDir:"./screenshots/failures"`. | Nothing hardcoded (conv. #3); back-compat |
| 12 | shipped `input/countries.xlsx` | `[China, India, Pakistan, Dominica]`, col A, header `Country`. | Real known-good codes; user edits freely |
| 13 | **`runBatch` signature** | `runBatch(page, countries, global, config, codes, log, deps?)` where `deps` injects `{runCountry, captureFailure, sleep}` so the harness swaps a fake. Default deps = the real modules. | Same offline-provability trick as Phase 3's pure core |
| 14 | New dependencies | None. `exceljs` already present (reads xlsx); harness uses Node built-in `assert`; build stays `tsc`. | CLAUDE.md "boring standard"; Phases 1–3 added zero deps |

## OUT OF SCOPE for Phase 4 (will NOT build)
- Manifest / resume / idempotency / collision modes → **Phase 5** (a killed batch re-runs from the top for now).
- Session-expiry pause/resume + `run-report.xlsx` → **Phase 6** (Phase 4 aborts on `LOGIN_REQUIRED`; summary is stdout + per-failure JSON only).
- Parallel country runs — **sequential only** (DECISIONS 2026-08-17 sequential).
- Resolver UI-search / filter DOM calibration — stays uncalibrated; an unknown country **is** a valid deliberate-failure path.
- Producing real `.xlsx` output files — that's 4B, needs a login.

## ACCEPTANCE CRITERIA (binary, testable)
**4A — provable headless now:**
- [ ] `npm run build` compiles clean (tsc, zero errors) with all 4 new files.
- [ ] `npm run test:isolation` still exits 0 (29/29) — no regression.
- [ ] `npm run test:batch` exits 0 and prints all-pass; it proves, with a **fake `runCountry`**:
  - reads a multi-row xlsx fixture in **exact row order**; skips header, blank, duplicate, `World`;
  - a country failing every attempt is retried **exactly** `maxAttemptsPerCountry` times, recorded `FAILED`, and **later countries still run**;
  - a country succeeding on attempt 2 is recorded `SUCCESS` with `attempts:2`;
  - `SKIPPED` is not retried and counts as completed;
  - `captureFailure` is invoked once per failed attempt;
  - summary counts (success/skipped/failed) are correct; exit code is **1** when any FAILED, **0** when all ok, **2** when the list is empty.
  - `isRetryable(LOGIN_REQUIRED)` is `false`; a `LOGIN_REQUIRED` from `runCountry` aborts the batch without exhausting retries and without running later countries.
- [ ] `readCountries('./input/countries.xlsx')` returns `['China','India','Pakistan','Dominica']` (order-preserving).
- [ ] `captureFailure` (unit, with a fake Page) writes one PNG + one JSON under `screenshots/failures/<runId>/`; JSON contains country, attempt, ISO timestamp, url, filters, error.name, error.message.

**4B — user runs, one live session (carried, not blocking 4A):**
- [ ] `npm run export -- --batch` over 5 countries incl. one bogus name → the bogus one yields a PNG+JSON evidence bundle after 3 attempts; the other four produce valid `.xlsx` files; batch exit code 1.

## RISKS
- **Live batch needs manual login** → the live AC can't be automated. Mitigation: prove every branch offline in `test:batch` with a fake `runCountry`, exactly like Phase 3's `isolation-check` (29/29).
- **`LOGIN_REQUIRED` misclassified** → whole batch wasted or a dead session burns retries. Mitigation: `isRetryable` unit-tested; `LOGIN_REQUIRED` aborts immediately.
- **Screenshot capture on a closed/crashed page throws** → masks the real fault. Mitigation: `captureFailure` is best-effort try/catch, returns null, logs `evidence.capture_failed`, original error propagates.
- **User-edited xlsx** (merged cells, extra columns, no header). Mitigation: read only column A, tolerate header, skip blanks/dupes.

**APPROVED 2026-08-17** — `go`. Split into 4A (headless, build now) + 4B (live, user runs).
This table is the contract for Phase 4. Any later change = add a row + one-word approval.
