# Decisions — Trade Map Automated Export System

Append-only. One row per decision that a future session must not silently reverse.
Format: date · decision · why · alternative rejected.

- **2026-08-17 · Playwright + TypeScript, deterministic RPA.** Why: PRD §9/§53 — core
  workflow must be reproducible via DOM/URL/download events, not AI visual guessing.
  Rejected: AI-driven browser agent (unreliable for normal execution; PRD §46).
- **2026-08-17 · Trigger Trade Map's own Save/export; never scrape rows.** Why: Save
  returns the complete dataset (up to 30k rows) as one file (PRD §34). Rejected: HTML
  pagination scraping (out of MVP scope, PRD §46).
- **2026-08-17 · `requestedRange` global+immutable; `effectiveRange` per-country, never
  carried forward.** Why: core risk — Pakistan (2024→) must not clip China (PRD §4/§39).
- **2026-08-17 · Persistent browser profile for auth; manual first login; no password in
  code/config.** Why: PRD §22/§43 security. Rejected: storing credentials in config.json.
- **2026-08-17 · Everything config-driven (dates, filters, path, filename template).**
  Why: PRD §13/§20 — monthly end-date changes must need config edits only, no code.
- **2026-08-17 · Sequential processing for MVP.** Why: simpler auth, less session
  interference, easier debugging (PRD §35). Rejected: parallel Trade Map tabs.
- **2026-08-17 · Default output `./output` (dev); production sets `D:\TradeMap\Exports`.**
  Why: repo-local default avoids writing outside the project during testing (PRD §21).
- **2026-08-17 · Filenames use the EFFECTIVE range.** Why: name truthfully describes file
  contents (PRD §19). Rejected: requested range in filename.
- **2026-08-17 · Auth is login-PAGE-driven, not logged-in-guess-driven.** Why: the "am I
  logged in?" heuristic on the home page failed silently and the run crashed on the login
  page. We now detect the login page (password field / login URL / "gateway to ITC" banner),
  PAUSE for manual login + ENTER, then re-navigate. Rejected: guessing session state.
- **2026-08-17 · PRD §6 canonical URL confirmed correct (Dominica).** Live run landed on
  `.../imports/c/212/c/000/p/ALL/byPartner/month/200001-202606/mirror/values/USD/table` and
  exported successfully. URL-navigation is the trusted PRIMARY query mechanism.
- **2026-08-17 · Effective range read from the URL segment — for FULL_RANGE only so far.**
  Worked for Dominica. OPEN: a CLIPPED country may keep the requested range in the URL;
  `readRangeFromDom()` must be built + proven before trusting clipped detection (Phase 3).
