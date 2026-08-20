# HANDOFF — Trade Map Automated Export System — Phase 9 — 2026-08-20

## Done
- **byProduct (View by = Product) exports work END-TO-END, LIVE-VALIDATED** with real workbooks:
  - **HS6:** India → 6,117 product rows × 230 monthly cols, range `200704-202605`, real values.
  - **NTL:** India → 13,995 tariff-line rows (real 8-digit codes, e.g. 29415000), range `200704-202605`.
- **Q1 answered live:** byProduct **accepts an explicit `YYYYMM-YYYYMM` range and CLAMPS it to availability**,
  writing the clamped window into the URL (`200001-202606` → `200704-202605`). `buildCanonicalUrl` needs no
  change; no `default` required. (This is the OPPOSITE of byPartner, whose URL keeps the requested range.)
- **Q2 answered:** `readShownRange` does NOT serve byProduct (the heavy NTL table doesn't render), but the URL
  carries the true clamped range → new `chooseGateRange(viewBy)` feeds the pre-Save gate from the **URL** for
  byProduct, the **DOM** for byPartner. Save now **waits for data-ready** (loader gone + rows settled) first.
- **Q3 answered:** the advanced controls are custom `<app-single-picker>` (`.label` + `.form-container`
  `cdkoverlayorigin`; overlay rows `.options-modal .option span.text`). `optionsReader` calibrated to them.
- **Filenames carry the Detail level** (NTL/HS6) so an HS6 file and an NTL file never overwrite each other.
- **Production config** `config/config.production-ntl.json` (204 countries, byProduct NTL, randomized throttle,
  own resume manifest) + a **word-by-word friend setup guide** (`docs/FRIEND_SETUP_GUIDE.md`).
- **Friend ran the full 204 batch: 143 SUCCESS / 57 FAILED.** Follow-up fixes shipped (see below).
- Offline green: `tsc` clean; **isolation 44 / batch 26 / manifest 26 / report 8 / runplan 20**, 0 failed.

## Files changed (this session)
- `src/tools/calibrate-byproduct.ts` — NEW read-only byProduct calibration probe (navigates the real built URL; dumps range/heading/overlays).
- `src/trademap/rangeEngine.ts` — `chooseGateRange(viewBy, dom, url)`: byProduct→URL, byPartner→DOM.
- `src/trademap/verifyQuery.ts` — the pre-Save gate reads the range via `chooseGateRange`.
- `src/trademap/driver.ts` — `waitForDataReady` (loader-gone **and** DATA-row count settled before Save).
- `src/trademap/optionsReader.ts` — calibrated to `app-single-picker` / `.options-modal .option span.text`.
- `src/orchestrator/runCountry.ts` — `waitForDataReady` before Save + **mid-country login pause/recover**.
- `src/config/schema.ts` — `download.dataReadyTimeoutMs`.
- `src/files/filename.ts` — `{detailWord}` token (NTL/HS6/HS4/HS2 or AllProducts).
- `src/manifest/manifest.ts` — `failedCountries()`; `src/index.ts` — `--retry-failed`.
- `src/auth/session.ts` — `isLoginPage` also matches `connexion` (FR login).
- `config/config.json` — filename template uses `{detailWord}`; `config/config.production-ntl.json` — NEW.
- `docs/FRIEND_SETUP_GUIDE.md` — NEW. Tests updated: isolation (+8), manifest (+2), runplan (deepEqual).

## Decisions made
- byProduct **clamps the requested range into the URL** (byPartner lies) → gate trusts the URL for byProduct.
- The byProduct **export is server-side** (the file holds the full dataset, not a screen scrape) → Save must
  wait for the FETCH to finish (loader gone + rows settled), not for a full DOM render.
- **NTL is mandatory and works** (heavy — relies on the 15-min data-ready wait). Detail goes in the filename.
- `--retry-failed` re-runs only the manifest's FAILED countries (skips re-validating every large SUCCESS file).

## Known broken / deliberately skipped
- **DATA COMPLETENESS unconfirmed:** friend's manual vs automated file differ by **~7 rows + 1 month**. Most
  likely data-timing (downloaded at different times; the export is server-side) but UNVERIFIED — needs BOTH
  files to diff. The row-settle wait is the mitigation if it turns out to be a real truncation.
- **57/204 FAILED** on the friend's run — root cause UNKNOWN (need `manifests/run-report-ntl.xlsx` + the newest
  `logs/runs/*.log`). Could be session expiry (now mid-run-paused), heavy-table timeout, or blocking.
- **Real login/session-expiry URL UNCAPTURED** — `isLoginPage` matches login/signin/logon/connexion + password
  field + "gateway to itc"; add the friend's actual URL once captured.
- **Friend's PC has the OLD code** — must get the updated repo (fresh `git bundle` / re-copy) or the fixes don't apply.
- **Throwaway test configs** `config/config.byproduct-test.json`, `config/config.byproduct-hs6-test.json` are
  UNCOMMITTED (delete when done).
- **NOT pushed** — committed locally on `phase-1-poc` (no git remote configured). Push a named branch for a PR.

## Next session starts here
- Diagnose the friend's run: read the 57 failure reasons + **diff the two workbooks** for the data gap, then
  pin `isLoginPage` to the real login URL. Get the updated code onto the friend's PC first.
- First command (friend's PC, after updating code): `npm run batch -- --config config/config.production-ntl.json --retry-failed`
- Watch out for: if the 57 failures were **blocking**, do NOT shrink the throttle further — RAISE
  `throttlePause{Min,Max}Ms`; and the friend MUST update the code before re-running or none of the fixes apply.
