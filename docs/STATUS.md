# Status — Trade Map Automated Export System

**Updated:** 2026-08-19

**Working on right now:** Getting the tool ready to also download the "by product" view of the trade data, and adding polite, randomised pauses so the account stops getting blocked during long runs.

**Done this week:**
- The tool can now build the correct web address for the "by product" reports (previously it only handled the "by exporter" view).
- Wired up the "NTL" (most-detailed) product level using a real example you supplied, so it downloads instead of stopping.
- Added human-like breaks: after every 1–5 countries the tool now pauses for a random 2–7 minutes, and the pattern keeps changing, so the site is less likely to flag the account.
- An automated safety review checked the changes end to end; every issue it found was fixed, and all 114 automated checks pass.

**Blocked on:** Nothing to build — but the "by product" download needs one real test run in a logged-in browser to confirm the website accepts it (that run is yours to do, not the tool's, to avoid getting the account blocked).

**Next:** Do one logged-in "by product" test export to confirm it works live, then package this up for review.
