# Trade Map NTL Export — Setup & Run Guide

**For:** running the full **204-country byProduct NTL** export on a fresh Windows PC (your friend's machine).
**Follow every step in order.** Commands are meant to be copied exactly. Where it says `>` that is the
PowerShell prompt — do not type the `>`.

---

## 0. What this tool does (30-second version)

It opens a real Chrome window, logs into Trade Map **once** (you do this by hand), then for each of 204
countries it: builds the exact query (India-style **Imports · by Product · Detail = NTL · Monthly · Direct ·
USD**), waits for the data table to load, clicks **Save**, downloads the Excel file, and saves it with a
truthful name. It pauses politely between countries so the account is not blocked. If it stops, you re-run
the same command and it **continues where it left off** — it never re-downloads a country that is already done.

> ⚠️ **You need a Trade Map _PRO_ account.** "Monthly" data is PRO-locked. With a free account the run will
> keep stopping at the login page. Have the PRO email + password ready.

---

## 1. Prerequisites (install these first)

1. **Node.js 20.11 or newer** (LTS recommended — 20.x or 22.x).
   - Download the Windows installer from <https://nodejs.org> → run it → accept defaults.
   - Verify (open a **new** PowerShell window afterwards):
     ```
     > node -v
     > npm -v
     ```
     `node -v` must print **v20.11.0 or higher**. If it prints an older version, install a newer Node.

2. **Disk space:** keep at least **~10 GB free** (204 NTL files are ~30 MB each ≈ 6–7 GB, plus the browser
   and dependencies).

3. **Power settings:** the run takes a **long time** (see §6). Set the PC to **never sleep** while plugged in
   (Windows Settings → System → Power → Screen and sleep → "When plugged in, put my device to sleep" =
   **Never**). A laptop should stay on charger.

---

## 2. Get the project onto the friend's PC

**Pick ONE method.** Method A (clone from GitHub) is now the easiest.

### Method A — clone from GitHub (recommended, needs internet + git)

The project now lives at **https://github.com/AazikoGlobalLLP/TRADE-MAP-AUTOMATION**. On the
**friend's** PC, in a folder where they want the project (e.g. `C:\Work`):
```
> cd C:\Work
> git clone https://github.com/AazikoGlobalLLP/TRADE-MAP-AUTOMATION.git
> cd TRADE-MAP-AUTOMATION
```
To get later fixes, just `git pull` (then `npm install` and `npm run build`). This replaces the old
"copy a bundle" step — everyone stays on the same, latest code.

### Method B — git bundle (offline, needs git on both PCs)

On **your** PC (the one that has the project), in the project folder:
```
> git bundle create trademap-repo.bundle --branches --tags
```
This makes one file, `trademap-repo.bundle`. Send it to your friend (USB / Google Drive / WhatsApp Desktop).

On the **friend's** PC, in a folder where they want the project (e.g. `C:\Work`):
```
> git clone trademap-repo.bundle AAZIKO-AUTOMATION
> cd AAZIKO-AUTOMATION
> git checkout phase-1-poc
```

### Method C — copy the folder (no git needed, fully offline)

On **your** PC, make a copy of the project folder, then **delete these sub-folders from the copy** before
zipping (they are large and rebuild automatically — never copy them):
`node_modules`, `dist`, `browser-profile`, `.auth`, `output`, `logs`, `manifests`, `screenshots`.
Zip the cleaned copy, send it, and unzip it on the friend's PC. Then open PowerShell **inside** the unzipped
folder:
```
> cd C:\Work\AAZIKO-AUTOMATION
```

> ✅ Either way, confirm you are in the right place — this must list files including `package.json`:
> ```
> > dir
> ```

---

## 3. Install dependencies (one time)

Inside the project folder:
```
> npm install
> npx playwright install chromium
```
- `npm install` downloads the code libraries (~1–2 min).
- `npx playwright install chromium` downloads the browser the tool drives (~1 min). **Do not skip it.**

Verify it compiles cleanly (should print nothing but the build line, no red errors):
```
> npm run build
```

---

## 4. First run — log in once

The **first** time you run it, the tool opens Chrome and lands on the Trade Map **login page**, then **pauses**
and waits for you in the PowerShell window.

1. Start the run (this is the real command — see §5 for what it does):
   ```
   > npm run batch -- --config config/config.production-ntl.json
   ```
2. A Chrome window opens. If it shows the **login page**, switch to it and **log in with the PRO account**.
3. Come back to the PowerShell window and press **Enter**.
4. The login is now saved in the `browser-profile` folder on this PC — you will **not** have to log in again on
   later runs (unless the session expires, in which case it just pauses and asks again).

> 🔒 Never share or commit the `browser-profile` / `.auth` folders — they hold the login. They stay on this PC only.

---

## 5. Run the full 204-country NTL export

This is the one command that does everything:
```
> npm run batch -- --config config/config.production-ntl.json
```

What that config does (already set for you — you do **not** edit anything):
- **Countries:** all **204** from `input/countries-full.xlsx`.
- **Query:** Imports · **View by = Product** · **Detail = NTL** · Monthly · Data source = Direct · USD.
- **Anti-block throttle:** after every random **1–5 countries** it takes a random **2–7 minute** break, so
  the account is not hammered. This is a politeness pause, not a trick — leave it on.
- **Heavy-table waits:** NTL tables are big, so it waits up to **15 min** for each to load and up to **10 min**
  for each download. Most are much faster; this is just headroom.

---

## 6. While it runs — what you'll see and how long

- A Chrome window drives itself, country by country. **Do not click inside it** and **do not close it.**
- The PowerShell window prints one JSON line per step. Good signs per country:
  `country.resolved` → `query.verified` → `data.ready` → `export.attempt` → `range.detected` → `run.done … SUCCESS`.
- **How long:** NTL is the heaviest option. Expect **roughly 1–3 days** of running (each country is a few
  minutes of loading + download, plus the throttle breaks). That is normal for a one-time full NTL pull.
- You can leave it running overnight. Keep the PC awake and on the internet.

---

## 7. If it stops (closed window, crash, power cut, you paused it) — how to resume

Just run the **exact same command** again:
```
> npm run batch -- --config config/config.production-ntl.json
```
It reads a progress file (`manifests/latest-run-ntl.json`) and **skips every country already saved**, then
continues with the rest. It is safe to stop and resume as many times as you like.

---

## 8. Where the files land and how they're named

- All Excel files go into the **`output`** folder inside the project.
- Each is named with the country, flow, **the detail level (NTL)**, and the date range, e.g.:
  ```
  India__Imports-from-World__NTL__2007-04_to_2026-05__Monthly-Direct-USD.xlsx
  ```
  The **NTL** in the name is important — an NTL file and an HS6 file for the same country never overwrite each
  other.
- A human-readable summary of the whole run is written to `manifests/run-report-ntl.xlsx` (one row per country:
  requested range, served range, status, attempts).

---

## 9. Troubleshooting

| What you see | What to do |
|---|---|
| It keeps stopping at the **login page** | The account isn't logged in or isn't **PRO**. Log in with the PRO account in the Chrome window, press Enter. Monthly needs PRO. |
| `INTERACTIVE_REQUIRES_TTY` or it won't pause for login | You must run it in a **normal PowerShell window** you typed into — not inside an automated/agent shell. |
| One country shows `FAILED` | It is retried 3× automatically, a screenshot is saved in `screenshots/failures`, and the batch **keeps going**. You can re-run at the end to retry failures. |
| Chrome window closed by accident | Nothing lost. Re-run the same command (§7); it resumes. |
| Worried about the account being blocked | The throttle already spaces requests out. If you still see blocks, **stop**, and increase the pause numbers in `config/config.production-ntl.json` (`throttlePauseMinMs` / `throttlePauseMaxMs`) — bigger = safer. Do not remove the throttle. |
| Want a quick sanity test before the full run | Change `--config config/config.production-ntl.json` to point at a small list first, or ask Shivam to hand you a 1-country test config. |

---

## 10. Do NOT do these (safety)

- ❌ Do **not** use the tool on your everyday Chrome — it uses its own dedicated `browser-profile` only.
- ❌ Do **not** click inside or close the automated Chrome window while it runs.
- ❌ Do **not** copy or share the `browser-profile` / `.auth` folders (they hold the login).
- ❌ Do **not** delete `manifests/latest-run-ntl.json` mid-run — that's the resume memory; deleting it makes it
  start over.
- ❌ Do **not** try to bypass a CAPTCHA, a disabled button, or a site limit. If the site refuses, let it record
  the failure and move on.

---

**Questions?** Send Shivam the last ~20 lines the PowerShell window printed and the contents of the newest file
in `logs/runs/` — that's enough to diagnose almost anything.
