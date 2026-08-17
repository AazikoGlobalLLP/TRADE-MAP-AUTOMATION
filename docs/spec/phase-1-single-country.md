# SPEC LOCK — Phase 1: Single-country proof of concept (Dominica)

One perfect automated export for ONE country. No batch, no manifest, no resume, no
multi-country retry — those are later phases. Goal: prove the end-to-end mechanism.

| # | Ambiguity | Locked value | Why this default |
|---|-----------|--------------|------------------|
| 1 | Runtime + package manager | Node.js ≥ 20.11 LTS, npm | LTS, matches Playwright support matrix |
| 2 | Language + build | TypeScript 5.x, `tsc` strict mode, output to `dist/` | PRD §8 mandates TS; strict catches carryover-state bugs early |
| 3 | Browser automation lib | Playwright latest 1.x, Chromium engine | PRD §8/§53 |
| 4 | Session persistence mechanism | `launchPersistentContext(userDataDir)` → `./browser-profile/` (headed) | PRD §22–23: dedicated profile owns cookies/login, survives restarts |
| 5 | Manual-login handshake | Headed browser opens Trade Map; CLI prints "Please login, then press ENTER"; blocks on stdin until ENTER | PRD §22 step 5 "press Continue"; simplest deterministic gate |
| 6 | Which country / code source | Dominica → ISO-numeric **212**; World → **000**; from `config/country-codes.json` | PRD §7 example; 212 is the real ISO-3166 numeric for Dominica |
| 7 | How the query is built | Navigate a **canonical URL** built from PRD §6 template; verify heading + filters after load; fall back to dropdowns if URL doesn't reproduce state | PRD §6 "second protection against stale UI state" |
| 8 | Locked filter values | imports · exporter=World(000) · product=ALL · viewBy=Exporter · monthly · mirror · values · USD · table | PRD §2 exact table |
| 9 | Requested date range | `requestedStart=200001`, `requestedEnd=202606` (from config, never hardcoded) | PRD §2/§4/§12 |
| 10 | Effective-range detection | Read the min & max month actually shown in the results (range control bounds / period columns); record as `YYYYMM-YYYYMM` | PRD §16 "read the displayed range before Save" |
| 11 | Range status value | `FULL_RANGE` if effective==requested, else `CLIPPED_BY_AVAILABILITY` | PRD §16 |
| 12 | Save → download capture | `page.waitForEvent('download')` fired concurrently with Save click; if Save opens a menu, pick XLSX; `download.saveAs(target)` | PRD §18 |
| 13 | Download timeout | `300000` ms (5 min), from config `download.timeoutMs` | PRD §26 |
| 14 | Output directory | config `outputDirectory`, default `./output` (production sets `D:\TradeMap\Exports`) | PRD §21; repo-local default is safe for dev |
| 15 | Filename template (default) | `{country}_TradeMap_Imports_AllProducts_byExporter_{frequency}_{source}_{start}-{end}_{currency}.{extension}` using **effective** range | PRD §19 (truthful filename) + §20 configurable |
| 16 | Filename example (Dominica, full range) | `Dominica_TradeMap_Imports_AllProducts_byExporter_Monthly_Mirror_200001-202606_USD.xlsx` | Derived from row 15 |
| 17 | File validation (all must pass) | (a) exists, (b) size>0, (c) ext=.xlsx, (d) opens as workbook via `exceljs`, (e) NOT an HTML login/error page (first bytes are ZIP `50 4B 03 04`, not `<`) | PRD §25 checks 1–5 |
| 18 | Collision behavior | `overwrite:false` → if target exists, skip with a logged notice (versioning is Phase 5) | PRD §37 default |
| 19 | Retry (Phase 1 scope) | One download retry (`downloadAttempts:2`); no multi-country loop retry yet | PRD §12/§27; keep PoC tight |
| 20 | Logging | Structured JSON to stdout + `logs/runs/phase1-<passed-in-runId>.log`; NEVER log cookies/tokens | PRD §8/§43; runId passed via CLI (no `Date.now()` in logic) |
| 21 | Country input for Phase 1 | CLI flag `--country Dominica` (default Dominica); `countries.xlsx` reader is Phase 4 | Keeps Phase 1 to ≤8 files |

## OUT OF SCOPE for Phase 1 (will NOT build)
- Multi-country batch loop, `countries.xlsx` reader, ordered processing
- Run manifest, resume, idempotency skip, filename versioning
- Session-expiry pause/resume, per-country 3× retry, failure screenshots
- `run-report.xlsx`, HTML scraping, desktop UI, any AI/OCR

## ACCEPTANCE CRITERIA (binary, testable)
- [ ] `npm install && npx playwright install chromium && npm run build` all succeed with zero errors.
- [ ] First run with no saved session opens a headed browser and blocks on the CLI prompt until ENTER.
- [ ] After login, session persists: a second run does NOT ask to log in again.
- [ ] Before Save, the page heading contains "Dominica" and its imports (country verification passes).
- [ ] The run records `requested=200001-202606` and an `effective=YYYYMM-YYYYMM` value read from the UI.
- [ ] Exactly one `.xlsx` file appears in `./output`, named per row 15 using the effective range.
- [ ] The output file opens as a workbook via `exceljs` and its first bytes are `50 4B 03 04` (not HTML).
- [ ] A zero-byte or HTML "download" is rejected and the run exits non-zero (no false SUCCESS).
- [ ] No password, cookie, or session token appears anywhere in `logs/` or committed files.
- [ ] `.auth/` and `browser-profile/` are git-ignored.

## RISKS
- **Trade Map URL structure** may differ from the PRD §6 template. Cheapest check: during
  Phase 1 build, log in manually, copy the real URL for a Dominica imports query, and diff
  it against our constructed URL before trusting URL-navigation. Fallback = dropdown driving.
- **Effective-range readout** depends on Trade Map's DOM. Cheapest check: inspect the live
  range control / period columns for Dominica and pin selectors against real markup.
- **XLSX vs xls / menu format labels** — verify the Save menu's actual option text/format live.
- **212 code assumption** — verify the constructed URL for `c/212` actually loads Dominica.

**APPROVED 2026-08-17** — `go`, with `outputDirectory` confirmed as `./output` for dev.
This table is now the contract for Phase 1. Any new decision = add a row + one-word approval.
