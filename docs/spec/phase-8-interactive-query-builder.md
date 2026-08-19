# SPEC LOCK — Phase 8: Interactive dynamic query builder

Today the whole query is fixed in `config.json`. Phase 8 makes each RUN interactive: the tool
confirms the country count, launches the headed browser, reads the LIVE Trade Map option lists
from the DOM, asks the user what they want, then drives the existing batch pipeline with those
answers. Because many options are inter-dependent (chosen dataset → which advanced options exist →
which values each offers), the DOM is re-read after each choice — never assumed. Answers become an
in-memory **run plan** that overrides `config.filters` + `datePolicy` for that run only; the tested
engine (URL nav, `ensure*` sweep, query gate, isolation, save/collision, manifest, report) is reused
unchanged. Nothing is invented: option lists are read live, and the flow-aware filename template is
locked below.

| # | Ambiguity | Locked value | Why this default |
|---|-----------|--------------|------------------|
| 1 | How interactive mode launches | New flag `--interactive` (alias `-i`) on the existing entry, plus `npm run export:interactive`. `--batch` / `--country` paths unchanged. | Explicit opt-in keeps the shipped headless tests and muscle memory intact; nothing implicit changes behaviour. |
| 2 | Runs where stdin isn't a terminal | If `!process.stdin.isTTY`, refuse: print `INTERACTIVE_REQUIRES_TTY`, exit 2, **launch no browser**. | CLAUDE.md: the headed run is the user's; a tool shell has no stdin and would hang a headed browser. |
| 3 | Country-count confirmation | X = row count from `batch.inputFile` (existing `input/countries.xlsx`), read **before browser launch**. Prompt `[Y/n]`, ENTER = Yes; `n`/`no` aborts exit 0. This is the **only** pre-launch prompt. | Needs no DOM and gates whether a browser opens at all; fail-fast on empty file (exit 2) before any browser. |
| 4 | Dataset options + coverage | Prompt `[1 Time series (default), 2 Trade indicators, 3 Companies, 4 Trade in services]`. **Only Time series is built this phase**; choosing 2–4 exits 2 with `DATASET_UNSUPPORTED: only Time series is available in this version`. | Time series is the confirmed default/most-used; other datasets have unread option trees — scoping them out keeps Phase 8 shippable. |
| 5 | Trade flow | Prompt `[1 Imports (default), 2 Exports]`. | Imports is listed first and matches today's shipped `config.filters.tradeFlow`. |
| 6 | Reporter / partner / product slots | Chosen country fills the **first** `/c/<code>/` (reporter) slot; partner stays `000` (World); Product stays `ALL`. Imports → country is the importer; Exports → country is the exporter. Importer & Product prompts are **not shown** (locked to default). | Matches the request ("Importer and Product left in DEFAULT, untouched"); the country is the only per-country variable (convention #2). |
| 7 | View by (+ Detail) | Prompt `[1 Exporter/Country (default), 2 Product]`. **Detail is not prompted** when View by = Exporter; when View by = Product it IS prompted (see row 19). | Confirmed default from the request; Detail is suppressed by the request when View by = Exporter. |
| 8 | Time (frequency) | Prompt `[1 Yearly, 2 Quarterly, 3 Monthly (default)]`. | Confirmed default from the request. |
| 9 | Monthly login signal | On Monthly, check `isLoginPage(page)` on the already-open post-launch page. If it looks like the login page (or no trademap cookie present), **WARN** `Monthly data needs a login — log in when the run pauses` and **continue** (never hard-fail). | Honours the request's soft-warn; uses the login-PAGE signal the codebase already trusts, per the CLAUDE.md gotcha (never guess "am I logged in"). |
| 10 | Time range | Prompt `Time range YYYYMM-YYYYMM [ENTER = MAX]`. Empty → config `requestedStart-requestedEnd`. Malformed input re-prompts (no crash). This value is the GLOBAL frozen range. | Confirmed "empty ENTER → default MAX"; range stays immutable/global (convention #2). |
| 11 | "Data type: [Values, Mirror, Quantities…]" vs "Data source = Mirror" | Two distinct controls kept: **Data source** `[Direct, Mirror (default)]` and **Data type** `[Values (default), Quantities, …]`, each read live. Defaults: source=`mirror`, dataType=`values` (today's config). | The request conflates them; config already separates `source` and `dataType`. Splitting matches the live site and the shipped config. |
| 12 | Currency | Read live; default USD. Prompt shows the live list (usually `[USD (default), EUR]`). | Confirmed default USD from the request. |
| 13 | Numbers display | Prompt `[1 Smart (default), 2 Thousands, 3 Millions]`. **Recorded** in the run plan + report but **not DOM-driven** this phase (it is display scaling, not in the canonical URL, and does not change exported data values). | Keeps the proven URL-driven path; driving a non-URL control is deferred (see OUT OF SCOPE) rather than guessed. |
| 14 | "Read live option lists" mechanism | New `src/trademap/optionsReader.ts` reads each control's options from the live Angular CDK overlay / mat-menu (same pattern as the country picker), re-read after each dependent choice. On selector miss/offline: fall back to the locked static list for that control, log `options.fallback`, **never abort, never auto-pick**. | CLAUDE.md: read live, never guess; the fallback keeps a miscalibrated selector from bricking the run while staying honest (logged). |
| 15 | Answers → export | Prompts build a `RunPlan` (`src/config/runPlan.ts`) that overrides `config.filters` + `datePolicy` **in memory for this run only**, then the existing `runBatch`/`runCountry` pipeline runs unchanged (URL-driven, `ensure*` sweep, `verifyQuery` gate, isolation, save/collision, manifest, report all reused). | Reuses every tested path; the plan changes inputs, not the engine. |
| 16 | Flow-aware filename template | Default interactive template: `{countrySlug}-{flowWord}-{viewWord}__{startPretty}_to_{endPretty}__{timeWord}-{sourceWord}-{currency}.{extension}` → e.g. `india-export-country__2001-01_to_2026-06__monthly-mirror-USD.xlsx`. New tokens: `flowWord` `{imports:import, exports:export}`, `viewWord` `{exporter:country, product:product}`, `timeWord` `{monthly,quarterly,yearly}`, `sourceWord` `{mirror,direct}`. Existing tokens still populated; today's country-first template stays valid and unchanged for `--batch`/`--country`. | Matches the request's `india-export-country…` example; adds tokens without breaking existing configs (unknown tokens already pass through literally). |
| 17 | Prompt UX + launch boundary | Numbered menus; type the number; bare ENTER = the `(default)` option; invalid entry re-prompts (never crashes/proceeds on garbage). **All option prompts (rows 4–13) run after browser launch, against the live DOM; only the row-3 count confirmation is pre-launch.** | Live reading needs the browser up; keeping rows 4–13 in one post-launch block preserves the read-after-each-choice loop. |
| 18 | Interactive resume identity (added post-review) | Interactive runs use a **query-scoped** manifest + run-report path: `applyRunPlan` inserts a slug of the chosen query (`tradeFlow-viewBy-frequency-source-dataType-currency`) before the extension, e.g. `./manifests/latest-run.exports-exporter-monthly-mirror-values-usd.json`. The fixed-config `--batch` manifest (`latest-run.json`) is left untouched. Same plan → same path (same-query resume preserved). | The Phase 5 resume skip keys on **country + range only**; without scoping, an interactive Exports run at the shipped imports range would silently SKIP all 204 and export nothing (caught in the Phase 8 adversarial review). Scoping fixes it with no manifest-schema/resume change. |
| 19 | Detail prompt for View by = Product | When (and only when) View by = Product, prompt **Detail**, default **NTL**. Read live (fallback list `['NTL']` — the only value the requirement fixes; the rest come from the live DOM once calibrated). Recorded in the run plan as `answers.detail`. ⚠️ **The byProduct query is NOT yet a working export:** the `byProduct` URL segment, the Detail URL encoding, the heading text, and the month-column range readout (`readShownRange`) were all calibrated ONLY for "by exporter" — a Product-view run errors per-country until one real logged-in byProduct URL is captured and those readers are calibrated (CLAUDE.md: never invent a URL). | User request: ask Detail (default NTL) on Product view. The prompt is deterministic and shipped now; the byProduct execution path needs live calibration, so it is flagged, not guessed. |

## Phase 9 — Live-DOM-driven + anti-block redesign (rows 20–24, spec-locked 2026-08-19, NEXT build)

These rows are a coherent NEXT iteration (call it **Phase 9**): make the questionnaire truly dynamic off the live DOM, wire the byProduct query from the real URL the user provided, and stop accounts getting blocked. Most of this needs a **live headed session** to calibrate DOM extraction — it is the user's to run — so it is spec-locked now and built next session, not guessed here.

| # | Ambiguity | Locked value | Why this default |
|---|-----------|--------------|------------------|
| 20 | Live-DOM-driven questionnaire | After the count-confirm + Yes, navigate STRAIGHT to a live data page (the byProduct reference URL, row 21) and drive the WHOLE questionnaire from the LIVE DOM: extract the available controls + option lists, ask, then **re-analyse the DOM after EVERY answer** and ask the next question from the refreshed state. Discover the dependencies live — e.g. does changing Trade flow or View by change which Advanced options appear/what values they offer — and reshape the remaining questions to match. Replaces today's "collect all answers, then build one URL". | User requirement: questions must reflect what the live page actually offers for the chosen flow/view (options are inter-dependent), discovered by DOM extraction — not assumed. |
| 21 | byProduct URL structure (decoded from the user's real URL) | Real URL: `…/time-series/exports/c/000/c/000/p/ALL/byProduct/year/default/2/direct/values/USD/table`. byProduct inserts a **Detail** segment between range and source: `…/byProduct/{freq}/{range}/{detail}/{source}/{dataType}/{currency}/{view}` — byPartner has NO detail segment. Detail codes seen: **HS2=`2`** (image), so HS4=`4`, HS6=`6`; ⚠️ **NTL's URL token is UNKNOWN** — capture one `Detail=NTL` URL before wiring it. The range may be the literal word **`default`** (= MAX). Frequency `year`=Yearly. | Ground truth the user provided; `buildCanonicalUrl` must branch on viewBy=product and must NOT invent the NTL token. |
| 22 | Detail (and same-shape) selection: preferred → fallback | Where Detail appears (byProduct), select **NTL** first; if NTL is not offered, select **HS6** (`6`). Apply the same "read the LIVE list → pick the preferred value → else the locked fallback" rule to **Data source** and the other advanced options. | Updates row 19 (was NTL-only). World / aggregate reporters often don't offer NTL, so HS6 is the safe fallback the user specified. |
| 23 | Anti-block throttle buffer | Insert a **configurable pause BETWEEN country exports** so a long run doesn't get the account blocked — e.g. a break after every _N_ countries for _M_ seconds (exact N + M to be spec-locked at build; user floated "after 1" or "after 10"). Compliance: a politeness throttle, NEVER a limit-bypass. Reuse `runBatch`'s injectable `sleep`. | User: "accounts block ho rahe hain baar baar." A deterministic throttle spreads load; CLAUDE.md compliance boundary forbids bypassing limits. |
| 24 | Accounts must not get blocked | The run must not trigger repeated blocks: throttle (row 23); do NOT re-run the full export to "check"; and respect that **Monthly is a PRO-locked feature** (the image shows "Monthly 🔒PRO") — so row 9's Monthly signal becomes "needs a PRO account", not merely "needs login". | Observed live + from the image; hammering the site / PRO-gated features causes account blocks. |

### Phase 9 — OUT OF SCOPE / notes
- Calibrating the live DOM extraction + the byProduct `readShownRange`/heading readers is a HEADED task (the user's session) — build the structure, flag selectors `UNCALIBRATED` as before.
- Do NOT invent NTL's URL token — capture a real `Detail=NTL` URL first.
- Exact throttle N + pause M are spec-lock-at-build values (don't guess).

## OUT OF SCOPE for Phase 8 (will NOT build)
- Trade indicators / Companies / Trade in services datasets (prompted, then graceful `DATASET_UNSUPPORTED` exit).
- **DOM-driving** Numbers display or any control not encoded in the canonical URL (recorded only).
- Importer / Product pickers (locked to World / All).
- Persisting answers to a file / replaying a saved plan (each run re-prompts).
- Re-calibrating the live option-overlay selectors here — that is a headed calibration task, not a spec task.

## ACCEPTANCE CRITERIA (binary, testable)
- [ ] `npm run export -- --interactive` in a TTY prints "About to export data for N countries — proceed?" where N == rows in `batch.inputFile`.
- [ ] The count confirmation prints **before** any browser process starts; the option prompts (rows 4–13) print **after** the browser launches.
- [ ] Piping / no-TTY → prints `INTERACTIVE_REQUIRES_TTY`, exit code 2, no browser process starts.
- [ ] Selecting dataset 2, 3, or 4 → prints `DATASET_UNSUPPORTED…`, exit 2, no export attempted.
- [ ] Bare ENTER at the time-range prompt uses config `requestedStart-requestedEnd`; a log line records `default`.
- [ ] Choosing Monthly while on the login page prints the WARN string and the run continues (does not exit).
- [ ] A completed run with flow = Exports, country = India produces an output filename beginning `india-export-`.
- [ ] Changing only prompt answers (no code edit) changes the exported query and the filenames.
- [ ] An interactive Exports run at the default range does NOT skip against the shipped imports manifest — it writes to a query-scoped manifest (`latest-run.<query-slug>.json`) and actually exports (row 18).
- [ ] A forced option-read failure logs `options.fallback` and the run still offers that control's static list (not aborted).
- [ ] `npm run build` compiles clean; `test:batch` 22/22, `test:manifest` 24/24, `test:report` 8/8 still green (engine untouched).

## RISKS
- Live overlay selectors for the advanced-option controls are **uncalibrated** (as the country picker once was). Fallback lists mitigate, but a wrong selector could show stale options — cheapest check: one headed dry-run reading each control vs. what's on screen.
- Two interpretations of an ambiguous request could be wrong: filename `viewWord=country` (row 16) and the Data source / Data type split (row 11). Confirm both against **one** real export before the full country run.
- Exports reporter/partner URL slot order (row 6) is unverified — one live `…/exports/c/<code>/…` URL confirms it.
- Monthly signal uses `isLoginPage` rather than a named cookie; if ITC changes login markers the warn could misfire — but it is soft / non-blocking, so blast radius is low.

**APPROVED 2026-08-18** — `go`. This table is now the contract for Phase 8.
Any later change = add a row + one-word approval.
