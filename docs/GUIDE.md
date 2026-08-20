# Trade Map Automation — The Complete Guide

**What this is:** the one guide that explains *everything* — how to install it, run it, read the
screen, change the settings, fix problems, and get updates. Plain language, copy-paste commands.

> Commands are typed in **PowerShell** (Windows) inside the project folder. Where a line starts with
> `>` that is just the prompt — don't type the `>`.

For the focused "fresh PC, run the 204-country NTL batch" walkthrough see
[FRIEND_SETUP_GUIDE.md](FRIEND_SETUP_GUIDE.md). This guide is the full reference.

---

## Table of contents
1. [What the tool does](#1-what-the-tool-does)
2. [Get the code from GitHub (and get updates)](#2-get-the-code-from-github-and-get-updates)
3. [One-time setup](#3-one-time-setup)
4. [Logging in (PRO account)](#4-logging-in-pro-account)
5. [Running it — every mode](#5-running-it--every-mode)
6. [Reading the screen — emoji legend](#6-reading-the-screen--emoji-legend)
7. [The retry queue (failed countries)](#7-the-retry-queue-failed-countries)
8. [Speed vs account-block — the honest truth](#8-speed-vs-account-block--the-honest-truth)
9. [The config file, every setting explained](#9-the-config-file-every-setting-explained)
10. [Where your files go](#10-where-your-files-go)
11. [Stopping and resuming](#11-stopping-and-resuming)
12. [Comparing two Excel files](#12-comparing-two-excel-files)
13. [Troubleshooting](#13-troubleshooting)
14. [Safety rules (never break these)](#14-safety-rules-never-break-these)
15. [Command cheat-sheet](#15-command-cheat-sheet)
16. [Quick map — where to change what](#16-quick-map--where-to-change-what)

---

## 1. What the tool does

It opens a real Chrome window, you log into **Trade Map** once by hand, and then for each country in
your list it:

1. builds the exact query (e.g. **Imports · by Product · Detail = NTL · Monthly · Direct · USD**),
2. waits for the data table to finish loading,
3. clicks **Save** and downloads the Excel file,
4. saves it with a truthful, self-describing name,
5. pauses politely between countries so the account is **not blocked**.

If it stops for any reason, you re-run the **same command** and it **continues where it left off** — it
never re-downloads a country that is already done.

---

## 2. Get the code from GitHub (and get updates)

The project now lives here: **https://github.com/AazikoGlobalLLP/TRADE-MAP-AUTOMATION**

### First time (clone it)
Open PowerShell in the folder where you want the project (e.g. `C:\Work`):
```
> cd C:\Work
> git clone https://github.com/AazikoGlobalLLP/TRADE-MAP-AUTOMATION.git
> cd TRADE-MAP-AUTOMATION
```

### Later, to get the newest fixes (update)
Inside the project folder:
```
> git pull
> npm install
> npm run build
```
> **Important:** whenever you change PCs or hand this to someone, they must `git pull` (or re-clone)
> to get the latest code. Old copies do **not** have the newest fixes.

---

## 3. One-time setup

1. **Install Node.js 20.11 or newer** from <https://nodejs.org> (LTS). Then, in a **new** PowerShell:
   ```
   > node -v      (must be v20.11.0 or higher)
   > npm -v
   ```
2. **Install the project's dependencies** (inside the project folder):
   ```
   > npm install
   ```
3. **Install the browser** Playwright uses:
   ```
   > npx playwright install chromium
   ```
4. **Build once** (compiles the code; must finish with no errors):
   ```
   > npm run build
   ```
5. **Disk space & power:** keep ~10 GB free; set the PC to **never sleep** while plugged in (a full
   run takes hours).

---

## 4. Logging in (PRO account)

- The first time you run anything headed, Chrome opens. If it shows the **Trade Map login page**, the
  tool **pauses** and the terminal shows `🔐 Login needed …`. Log in **in that Chrome window**, then
  press **Enter** in the terminal. The login is remembered in a private profile folder, so you don't
  log in every time.
- **You need a Trade Map _PRO_ account** for **Monthly** data — "Monthly" is PRO-locked. With a free
  account the run keeps stopping at the login page. (Yearly / Quarterly are free.)
- The tool **never** stores or logs your password/cookies, and **never** bypasses the login or a
  CAPTCHA. If Save is refused, it records the failure and moves on.

---

## 5. Running it — every mode

All runs are **headed** (a real browser opens) and may pause for login — so **you** run them in a real
terminal, not in the background.

### A) Full production batch — 204 countries, NTL
```
> npm run batch -- --config config/config.production-ntl.json
```
Runs the whole list from `input/countries-full.xlsx`. Resume-safe: re-run the same line to continue.

### B) Retry only the countries that failed
After a batch, to re-run **just the failures** (skips re-checking every big finished file):
```
> npm run batch -- --config config/config.production-ntl.json --retry-failed
```

### C) One country only (quick test)
```
> npm run export -- --country India
```

### D) HS6 instead of NTL (lighter & faster data)
NTL files are huge (8-digit tariff lines). For a lighter dataset, use an HS6 config (Detail = HS6).
Everything else is the same; the filename automatically says `HS6` so files never clash with NTL.
```
> npm run batch -- --config config/config.production-hs6.json
```
> (If that config doesn't exist yet, copy `config.production-ntl.json`, change `"detail": "NTL"` to
> `"detail": "HS6"`, and give it its own `manifestFile`/`runReportFile` name.)

### E) Interactive — pick options at run time
```
> npm run export:interactive
```
It asks you (flow, view, time range, detail, etc.), reading the live options from the page, then runs.

### Useful extra flags (add to any batch command)
| Flag | What it does |
|---|---|
| `--retry-failed` | run only the FAILED countries from the last run |
| `--force` | ignore "already done", re-download and overwrite everything |
| `--raw-logs` | show the full technical JSON in the terminal (for debugging) |
| `--countries <file.xlsx>` | use a different country list than the config's |
| `--config <path>` | use a specific config file |

---

## 6. Reading the screen — emoji legend

The terminal now shows one clean line per country. Full technical detail still goes to the log file
(`logs/runs/<runId>.log`) — the screen is just the friendly view.

| You see | Meaning |
|---|---|
| `📋 Batch: 204 countries · up to 3 end-of-run retry rounds` | the run is starting |
| `🔄 [45/204] India …` | now working on India (45th of 204) |
| `✅ India — SUCCESS (200704-202605, 1 attempt)` | done; file saved; the real month range in the file |
| `⏭️ Brazil — SKIPPED (already done)` | already finished earlier; not re-downloaded |
| `❌ China — FAILED after 3 attempts: DOWNLOAD_TIMEOUT` | couldn't finish; it goes into the retry queue |
| `⏸️ Anti-block pause 2m14s (protecting your account) …` | a polite pause so the account isn't blocked |
| `🔁 Retry round 1/3 — 7 countries still to fix` | end-of-run retry round starting |
| `✅ China — recovered on retry` | a previously-failed country succeeded on retry |
| `🔐 Login needed …` / `🔐 Session expired mid-run …` | log in in the Chrome window to continue |
| `🛑 …` | the run stopped (usually session expired — re-login and re-run to resume) |
| `📊 Done — ✅ 198 success ⏭️ 0 skipped ❌ 6 failed (of 204)` | the final tally |

---

## 7. The retry queue (failed countries)

- During the run, each country is tried a few times immediately (`maxAttemptsPerCountry`, default 3).
- Any country that still fails is put in a **queue**.
- After the whole list finishes, the tool runs **extra retry rounds** over just the queue
  (`finalRetryRounds`, set to **3** in the production config). A country that succeeds leaves the queue
  and its result is corrected everywhere (screen, manifest, report).
- Retries are **still throttled** (polite pauses), so this never hammers the site.
- Want more end-of-run attempts? In the config change `"finalRetryRounds": 3` to e.g. `6`.

---

## 8. Speed vs account-block — the honest truth

**The slow part is not our tool.** Most of the time is Trade Map building each heavy **NTL** table on
**its own servers** (minutes per country) before it can be saved. The polite pause between countries is
only a small slice of the total. So making the pauses aggressive saves little time but **greatly raises
the risk of the account being blocked** — a bad trade.

Two honest ways to go genuinely faster:
1. **Use HS6 instead of NTL** (see [5D](#5-running-it--every-mode)) — much lighter/faster data.
2. **Change one word** — `speedProfile` — accepting more block risk.

### The `speedProfile` dial (in the config's `batch` block)
| Value | Pause between bursts | Risk |
|---|---|---|
| `"safe"` | ~2–7 min | lowest block risk, slowest |
| `"balanced"` | ~45s–2.5 min | **default** |
| `"fast"` | ~30–90s | fastest, **higher block risk** |

Change only this one word. **If the account ever gets blocked, set it back to `"safe"`** and raise the
pauses. The throttle can never be turned fully off — that's a safety rule of the tool.

---

## 9. The config file, every setting explained

Configs live in `config/`. `config/config.production-ntl.json` is the real 204-country run. You change
the run by editing config, **not** code. Key settings:

**`filters`** — the query itself:
- `tradeFlow` — `imports` or `exports`
- `viewBy` — `product` (byProduct) or `exporter` (byPartner)
- `detail` — only for byProduct: `NTL` (8-digit tariff lines, biggest), `HS6`, `HS4`, `HS2`
- `frequency` — `monthly` (PRO), `quarterly`, `yearly`
- `source` — `direct` (byProduct must use `direct`; Mirror is disabled there)
- `dataType` — `values`, `quantities`, …
- `currency` — `USD`, `EUR`, …

**`datePolicy`** — the requested time window:
- `requestedStart` / `requestedEnd` — `YYYYMM` (e.g. `200001` to `202606`). Trade Map clamps this to
  what's actually available and writes the real range into each file's name.

**`download`:**
- `dataReadyTimeoutMs` — how long to wait for a heavy table to load before Save (NTL needs ~15 min =
  `900000`)
- `timeoutMs` — how long to wait for the file to download (NTL: `600000` = 10 min)
- `downloadAttempts` — Save/download tries per country
- `collisionMode` — `skip` (keep existing files), `overwrite`, or `version` (make `_v2` copies)

**`batch`:**
- `inputFile` — the country list (`.xlsx`, column A). `countries-full.xlsx` = all 204.
- `maxAttemptsPerCountry` — immediate tries per country during the main pass (default 3)
- `speedProfile` — `safe` / `balanced` / `fast` (see [§8](#8-speed-vs-account-block--the-honest-truth))
- `finalRetryRounds` — end-of-run retry rounds over failed countries (production: 3)
- `continueOnFailure` — `true` = a bad country never stops the batch

**`filenameTemplate`** — how files are named. Available pieces include `{countrySlug}`, `{flow}`,
`{detailWord}` (NTL/HS6/…), `{startPretty}`/`{endPretty}`, `{frequency}`, `{source}`, `{currency}`,
`{extension}`.

**`manifestFile` / `runReportFile`** — where the resume record and the human report are written.

---

## 10. Where your files go

| Folder | What's in it |
|---|---|
| `output/` | the downloaded Excel files (this is what you want) |
| `manifests/latest-run-ntl.json` | the resume record — which countries are done/failed |
| `manifests/run-report-ntl.xlsx` | a human-readable report: each country's status, range, attempts |
| `logs/runs/<runId>.log` | the full technical log of a run (for diagnosing failures) |
| `screenshots/failures/` | a screenshot + details captured whenever a country fails |

These folders are **not** on GitHub (they're local outputs) — that's on purpose.

---

## 11. Stopping and resuming

- **To stop:** close the terminal / press `Ctrl+C`. Nothing already downloaded is lost.
- **To resume:** run the **same command** again. Finished countries are skipped (`⏭️ SKIPPED (already
  done)`); it picks up where it stopped.
- **Session expired mid-run** (`🛑 Session expired …`): log back into Trade Map, then re-run the same
  command to continue.

---

## 12. Comparing two Excel files

To check whether two exports (e.g. a manual one vs the tool's) hold the same data:
```
> npm run diff-xlsx -- "path\to\manual.xlsx" "path\to\automated.xlsx"
```
It reads both (no browser, changes nothing) and prints, in plain language: how many rows differ and
which codes, which month is missing, which values differ, and a final verdict.

---

## 13. Troubleshooting

| Symptom | What it means / what to do |
|---|---|
| Keeps stopping at the login page | Not logged in, or a **free** (non-PRO) account for Monthly data. Log in with a PRO account. |
| `🔐 Session expired mid-run` | Log back in in the Chrome window; re-run the same command to resume. |
| Many countries fail together / account **blocked** | The site was hit too hard. Set `speedProfile` to `"safe"`, and raise the pauses. Wait a while before retrying. Do **not** keep hammering. |
| `DOWNLOAD_TIMEOUT` on one country | The heavy table didn't finish in time. The retry queue will try it again; you can also raise `dataReadyTimeoutMs`. |
| Wrong country's data | Country codes are UN-COMTRADE numbers, not ISO. Confirm the code from a real logged-in URL, or run `npm run harvest`. |
| "Monthly 🔒PRO" | Monthly needs a PRO account. Use Yearly/Quarterly if you don't have PRO. |
| Nothing downloads at all | Make sure you ran `npm run build` after `git pull`, and that Chromium is installed (`npx playwright install chromium`). |

---

## 14. Safety rules (never break these)

- **Never** commit or share the `.auth/` or `browser-profile/` folders — they hold your login session.
  (They're already blocked from GitHub.)
- **Never** bypass a CAPTCHA, a disabled Save button, or a Trade Map limit. If an export is refused, the
  tool records it and moves on — that's correct behaviour.
- The throttle is a **politeness** buffer, not a limit-bypass. Don't turn it off.
- Use the tool's dedicated browser profile — not your everyday Chrome.

---

## 15. Command cheat-sheet

```
npm install                      # install dependencies (once, and after git pull)
npx playwright install chromium  # install the browser (once)
npm run build                    # compile (after any git pull)

npm run batch -- --config config/config.production-ntl.json                 # full 204 NTL run
npm run batch -- --config config/config.production-ntl.json --retry-failed  # retry only failures
npm run export -- --country India                                           # one country
npm run export:interactive                                                  # pick options at run time
npm run diff-xlsx -- "A.xlsx" "B.xlsx"                                       # compare two files

git pull ; npm install ; npm run build   # get + apply the latest updates
```

---

## 16. Quick map — where to change what

| I want to… | Change this |
|---|---|
| Run different countries | `input/countries-full.xlsx` (or `batch.inputFile`) |
| Go faster / safer | `batch.speedProfile` = `safe` / `balanced` / `fast` |
| More end-of-run retries | `batch.finalRetryRounds` (e.g. `6`) |
| Switch NTL ↔ HS6 | `filters.detail` = `NTL` / `HS6` (+ its own manifest/report names) |
| Imports ↔ Exports | `filters.tradeFlow` |
| Change the time window | `datePolicy.requestedStart` / `requestedEnd` |
| Rename the output files | `filenameTemplate` |
| Keep vs overwrite existing files | `download.collisionMode` |

---

*Made for the Trade Map Automated Export System. When in doubt: change **config, not code**, and if the
account looks at risk, slow down (`speedProfile: "safe"`).*
