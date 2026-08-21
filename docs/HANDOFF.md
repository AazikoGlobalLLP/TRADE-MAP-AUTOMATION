# HANDOFF — Trade Map Automated Export System — Phase 10 — 2026-08-21

## Done
- **Live on GitHub:** the whole codebase is pushed to `main` at
  https://github.com/AazikoGlobalLLP/TRADE-MAP-AUTOMATION (no secrets — `.auth/`, `browser-profile/`, output, logs all gitignored).
- **QUANTITIES exports work.** Data type = Quantities uses the SINGULAR URL token `quantity` (not `quantities`) and
  currency `na` (quantities have no currency). User's device: **143 NTL-quantities files** landed (verified: 0 empty, 4.2 GB).
- **End-of-run RETRY QUEUE** (`batch.finalRetryRounds`, default 3): failed countries are queued and retried at the end, still throttled.
- **Emoji CONSOLE logs**: terminal shows `🔄 country / 💾 saving / ⏳ still exporting (Xm) / ✅ / ❌ / ⏸ pause`; full JSON still in the log file. `--raw-logs` restores JSON.
- **One-word `speedProfile`** (safe/balanced/fast) sets the anti-block throttle; never disables it.
- **Root causes of the 61 failures found + fixed (both data types):**
  - **45 "mirror-only" countries** (Syria, Moldova, Vietnam, Bangladesh, Cuba…) have NO Direct data → `.../direct/...` redirects to `.../6/mirror/...` → FILTER_DRIFT on `source`. Fix = **source=mirror + detail=HS6** (quantities: currency=na; values: currency=USD).
  - **15 big countries** (USA, Canada, Singapore…) failed on a 30s Save-click timeout → raised to **3 min** (`SAVE_CLICK_TIMEOUT_MS`).
- **`npm run diagnose`** writes a single `diagnostics-report.txt` (no secrets) so another PC's run can be debugged remotely.

## Files changed
- `src/trademap/driver.ts` — DATATYPE_URL (quantities→quantity); 3-min Save-click timeout; Save/data-ready heartbeats.
- `src/trademap/filters.ts` — DATATYPE_FROM_URL (quantity→quantities) so the gate round-trips.
- `src/orchestrator/runBatch.ts` — end-of-run retry queue + shared throttle/exec helpers.
- `src/orchestrator/runCountry.ts` — data.loading / export.saving / export.waiting heartbeats + dataType filename token.
- `src/logging/console.ts` (+ console-check.ts) — emoji console formatter.
- `src/config/schema.ts` — `speedProfile` + `finalRetryRounds`.
- `src/tools/collect-diagnostics.ts` (`npm run diagnose`), `src/tools/diff-xlsx.ts` (`npm run diff-xlsx`).
- `config/config.production-ntl.json` — quantities + currency=na + speedProfile + finalRetryRounds.
- `config/config.production-hs6-fallback.json` — 45 mirror-only, QUANTITIES (mirror+HS6+na).
- `config/config.production-hs6-mirror-values.json` — 45 mirror-only, VALUES (mirror+HS6+USD) — for the friend.
- `config/config.production-big-ntl.json` + `input/countries-big.xlsx` — 15 big countries (NTL+direct+Save-fix).
- `input/countries-no-ntl.xlsx` — the 45 mirror-only countries.

## Decisions made
- Quantities = URL token `quantity` (singular) + currency `na`. Values = `values` + `USD`. (Live-captured.)
- Mirror-only countries → `source=mirror` + `detail=HS6` (mirror data exists only at HS6). Same 45 for values and quantities.
- Big Direct countries need only the 3-min Save-click timeout (not a source/detail change).
- Failures split into targeted per-cause configs+lists (own manifests) so no run re-grinds another's doomed countries and the 143/159 finished files are never touched.

## Known broken / deliberately skipped
- **Palestine (1)** — DATE_ERROR (range read); not yet resolved. Try it inside a mirror/HS6 run.
- **~6 historical/duplicate country names** ("Sudan (before 2012)", "Serbia and Montenegro", "Netherlands Antilles"…) resolve to COUNTRY_NOT_FOUND — no live code; expected, low value.
- **User's device (QUANTITIES)** not yet at 204: 143 NTL done, 45 mirror-fallback nearly done, **big-15 NTL not run yet**.
- **Friend's device (VALUES)**: 159 done, the 45 mirror-only still to run with the new VALUES-mirror config. Friend has latest code (commit 3ccd5e3) but a locally-edited `config.production-ntl.json` (values, old manifest name) — `git pull` brings the new configs cleanly (new files, no conflict).

## Next session starts here
- **Finish coverage on both devices** (no restart — all runs are resume-safe, own manifests).
- **First commands:**
  - User (quantities): `npm run batch -- --config config/config.production-big-ntl.json`  (the 15 big; mirror-45 already finishing)
  - Friend (values): `git pull` then `npm run batch -- --config config/config.production-hs6-mirror-values.json`  (the 45 mirror-only)
- **Watch out for:** on a machine that never did that data-type's run, `--retry-failed` finds an empty manifest and exits "nothing to do" — use the plain command (no `--retry-failed`) for a fresh data-type.
