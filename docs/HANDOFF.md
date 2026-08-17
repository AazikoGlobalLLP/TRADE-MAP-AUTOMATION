# Handoff

**Phase 1 — scaffolded and compiling. Remaining work is LIVE calibration.**

## State right now (2026-08-17)
- Git repo initialized. Baseline docs on `main`; Phase 1 code on branch `phase-1-poc`.
- Phase 1 spec APPROVED (`docs/spec/phase-1-single-country.md`), `outputDirectory=./output`.
- 8 Phase-1 files written; `npm run build` compiles clean (tsc, exit 0).
- Deps installed WITHOUT the Playwright browser (used PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1).

## What works vs. what needs a live login
Implemented and type-checked: canonical-URL builder (PRD §6), persistent-session launch +
manual-login ENTER gate, country-heading verify gate, effective-range detection (URL-first,
DOM fallback stub), Save→download capture with retry, and the 5-check XLSX validation
(rejects zero-byte / HTML-login pages via ZIP magic bytes).

NOT yet verified against the real site (needs one manual Trade Map login):
1. **Real URL structure** vs PRD §6 template — log in, copy a real Dominica imports URL,
   diff against `buildCanonicalUrl()`; adjust segment order/tokens if needed.
2. **Effective-range DOM fallback** — `readRangeFromDom()` in `driver.ts` returns null; if
   Trade Map keeps the *requested* range in the URL even when clipped, implement the real
   range-control readout so CLIPPED_BY_AVAILABILITY is detected correctly.
3. **Selectors** — heading, Login marker, Save button, XLSX menu option (all marked VERIFY).

## To run Phase 1 (on a machine with a Trade Map login)
```
npm install
npx playwright install chromium      # the browser skipped during scaffold
npm run export -- --country Dominica  # headed; log in when prompted, press ENTER
```
Done when: a validated `Dominica_TradeMap_...200001-202606_USD.xlsx` lands in `./output`
and every checkbox in the Phase 1 spec passes.

## Next session (per PHASES.md)
Finish Phase 1 live calibration, then Phase 2 (config engine + country-code resolver +
filename generator). Session split: "Config & Codes" covers Phases 2 + 3.

## Open item for the user
- Confirm production `outputDirectory` when going live (`D:\TradeMap\Exports` per PRD).
