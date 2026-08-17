# SPEC LOCK — Phase 2: Config engine + country-code resolver + filename generator

Externalize and harden what Phase 1 read inline. Three deliverables: a validated config
loader, a name→ISO-numeric country resolver with a UI-search fallback, and a configurable
filename generator. No new runtime behavior on the happy path — same output, but now
driven and validated from config, and reusable by later phases.

| # | Ambiguity | Locked value | Why this default |
|---|-----------|--------------|------------------|
| 1 | Config loading | New `src/config/loadConfig.ts` reads + parses `config.json`, applies defaults, validates via `schema.ts`, returns a typed `AppConfig`. Replaces the inline `JSON.parse` in `index.ts`. | PRD §8 "configuration validator"; one typed source of truth |
| 2 | Validation library | **Hand-rolled type guards** in `schema.ts` — NO new dependency (no zod/ajv). | CLAUDE.md "boring standard"; Phase 1 added zero validation deps; `tsc` stays the only gate |
| 3 | Validation rule set | Fail-fast `CONFIG_INVALID: <field> — <problem>` on: missing required field, wrong type, empty string, `requestedStart`/`requestedEnd` not 6-digit `YYYYMM`, start > end, unknown `datePolicy.mode`, non-positive `timeoutMs`/`downloadAttempts`. | Catch config typos before launching a browser |
| 4 | Required vs optional fields | Required: `tradeMapBaseUrl, outputDirectory, browserProfileDir, logsDir, countryCodesFile, filters`(10 keys), `datePolicy`(start/end/mode), `download`(format/overwrite/timeoutMs/downloadAttempts), `filenameTemplate`. Optional-with-default: `auth.maxLoginAttempts = 3`. | Mirrors exactly what `index.ts` already reads today |
| 5 | Resolver API | `src/country/resolver.ts` → `resolveCountryCode(page, name, codesMap, log)` returns `{ code, source: 'MAP' \| 'UI' }`. Order: exact map hit → trimmed/case-insensitive map hit → UI-search fallback. | PRD §7 flow |
| 6 | Local map lookup | Case-insensitive + trimmed match; codes stay **strings** (preserve leading zeros, `"000"`). | Robustness without inventing codes |
| 7 | UI-search fallback | Structured function: open Trade Map country search, type the name, read the numeric code; logs `country.ui_resolution_used` **before** attempting. DOM selectors marked `VERIFY against live DOM (Phase 3)` — same live-calibration pattern as `readRangeFromDom()`. | PRD §7 "use country-search UI … log UI resolution was used"; DOM can't be calibrated without a live login |
| 8 | No invented codes | `country-codes.json` stays **World=000, Dominica=212 only**. India/Pakistan/China added in Phase 3 after live verification. | CLAUDE.md "do not invent codes"; HANDOFF + DECISIONS |
| 9 | Filename generator | Move `generateFilename` to `src/files/filename.ts`; `save-validate.ts` imports it (no behavior change). Unknown `{token}` left literal. Tokens: `country, frequency, source, start, end, currency, extension`. Uses **effective** range. | PRD §19/§20; DECISIONS "filenames use effective range" |
| 10 | Filename sanitization (NEW) | After rendering, replace Windows-illegal chars `\ / : * ? " < > \|` and control chars with `_`; trim trailing dots/spaces. Letters/digits/`_ - .` pass through. | Target is Windows (`D:\TradeMap\Exports`); resolver now accepts arbitrary names — avoid save failures |
| 11 | Zero-code reconfig (the Demo) | Changing `config.json` `requestedEnd` (e.g. `202512`) OR `filenameTemplate` → output filename/range changes; `npm run build` still clean; zero `.ts` edits. Unknown country → `country.ui_resolution_used` logged. | Phase 2 Demo + PRD §20 "No code change should be required" |
| 12 | `index.ts` rewiring | `index.ts` is touched: swap inline parse → `loadConfig()`, swap inline code lookup → `resolveCountryCode()`, swap import of `generateFilename` to `files/filename.ts`. Behavior identical for Dominica. | Externalizing is the point of the phase |

## OUT OF SCOPE for Phase 2 (will NOT build)
- Live-calibrating the UI-search DOM selectors (needs a manual login — Phase 3).
- Adding India/Pakistan/China (or any) codes — Phase 3, after live verification.
- Batch loop, manifest, resume, retry-per-country, screenshots, run-report.
- `readRangeFromDom()` calibration (Phase 3), collision versioning (Phase 5).

## ACCEPTANCE CRITERIA (binary, testable)
- [ ] `npm run build` compiles clean (zero errors) after the refactor.
- [ ] `npm run export -- --country Dominica` still produces the identical filename/range as Phase 1 (no regression).
- [ ] Editing `config.json` `requestedEnd` to `202512` changes the output filename's end segment with **zero** `.ts` edits.
- [ ] Editing `filenameTemplate` (e.g. PRD §20 short form) changes the output filename with zero `.ts` edits.
- [ ] An invalid `config.json` (e.g. `requestedStart:"2000"`) fails fast with a `CONFIG_INVALID:` message and non-zero exit — no browser launch.
- [ ] Running with an unknown country logs `country.ui_resolution_used` (UI path entered) rather than the Phase-1 `COUNTRY_NOT_FOUND` throw.
- [ ] `country-codes.json` still contains only World=000 and Dominica=212 (no invented codes).

## RISKS
- **UI-search DOM** is unknown until a live login. Mitigation: structure the fallback now,
  selectors flagged for Phase 3 calibration — it must reach the "UI resolution used" log and
  fail loudly (not silently return a wrong code) if the DOM doesn't match.
- **Hand-rolled validation drift** from the actual `AppConfig` type. Mitigation: the loader
  returns the same `AppConfig` interface the validator checks; `tsc strict` cross-checks shape.

**APPROVED 2026-08-17** — `go`. This table is now the contract for Phase 2.
Any later change = add a row + one-word approval.
