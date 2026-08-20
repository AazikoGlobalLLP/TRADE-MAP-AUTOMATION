# Status — Trade Map Automated Export System

**Updated:** 2026-08-20

**Working on right now:** Making the detailed "by product" trade-data download work reliably across all 204 countries, and fixing the issues that showed up on the first full run.

**Done this week:**
- The tool now downloads the "by product" reports for real — proven with actual India files at both the summary level and the most-detailed ("NTL") level, with the correct dates and full data.
- Set up the complete 204-country automated run with polite, randomised pauses, and wrote a plain step-by-step guide so a colleague can run it on a fresh PC.
- Ran the full 204-country batch: 143 downloaded successfully, 57 need a retry — added a simple "retry only the failed ones" option so we don't redo the 143 that worked.
- Made the tool wait for each report to fully load before saving (so files aren't cut short), and pause for re-login if the session drops mid-run instead of failing that country.
- Every downloaded file is now named with the country, date range, and detail level, so files never overwrite each other.

**Blocked on:** Two things from the colleague's PC to finish diagnosing — the list of which 57 countries failed and why, and one manual-vs-automated file pair to check a small reported data difference (about 7 rows and one month). The colleague also needs the latest version of the tool before re-running.

**Next:** Diagnose the 57 failures and the small data difference, then re-run just the failures on the updated tool.
