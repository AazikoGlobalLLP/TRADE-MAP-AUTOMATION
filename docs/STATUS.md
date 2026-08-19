# Status — Trade Map Automated Export System

**Updated:** 2026-08-19

**Working on right now:** Turning the exporter into an interactive tool where you pick the data options each run, and making it reliable enough to not get the account blocked.

**Done this week:**
- The tool can now ask you what data you want (import or export, time period, currency, and more) before it runs, instead of the choices being fixed in a settings file.
- Running it for all countries at once works and produces correctly named Excel files — proven on a real run.
- Added the extra "Detail" question you asked for, which only appears when you view data by product.
- Caught and fixed a hidden bug that would have made a run quietly skip every country and produce nothing.

**Blocked on:** Two things need you at the keyboard: (1) the "view by product" option isn't working yet and needs one real page opened in the browser so we can see how that page is built; (2) the account keeps getting blocked when the tool runs too much.

**Next:** Rebuild the question flow so it reads the live website page as it asks, and add automatic short pauses between countries so the account stops getting blocked.
