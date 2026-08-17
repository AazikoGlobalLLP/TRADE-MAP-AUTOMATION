# Trade Map Multi-Country Automated Export System

## Product Requirements Document — V1.0

**Status:** Final Architecture  
**Primary Goal:** Automatically export Trade Map monthly data for a supplied list of countries into locally stored Excel files with deterministic filters, independent date-range handling, naming rules, retry/resume support, and zero manual country switching.

---

# 1. Product Goal

The system must automate this manual workflow:

```text
Open Trade Map
↓
Login / reuse logged-in session
↓
Select Country 1
↓
Apply fixed Trade Map filters
↓
Force requested maximum date range
↓
Wait for results
↓
Click Save
↓
Download complete dataset
↓
Save file to defined local folder
↓
Rename using defined naming convention
↓
Validate file
↓
Select Country 2
↓
Repeat
```

Example input:

```text
India
Pakistan
China
Angola
Argentina
Australia
Dominica
...
```

Expected result:

```text
D:\TradeMap\Exports\
    India_TradeMap_Imports_Monthly_Mirror_200001-202606.xlsx
    Pakistan_TradeMap_Imports_Monthly_Mirror_202401-202606.xlsx
    China_TradeMap_Imports_Monthly_Mirror_200001-202606.xlsx
    Angola_TradeMap_Imports_Monthly_Mirror_....xlsx
    ...
```

The system must work whether the Trade Map export contains:

- 100 rows
- 134 rows
- 5,000 rows
- 30,000 rows

The automation should **not scrape those 30,000 rows from the HTML table** if Trade Map's own Save function already exports the complete dataset.

The browser automation only needs to produce the correct query and trigger the authorized Trade Map export.

---

# 2. Locked Trade Map Query

Unless overridden in configuration, every country uses:

| Setting | Required Value |
|---|---|
| Section | Goods |
| Mode | Time series |
| Trade flow | Imports |
| Importer | Current country |
| Exporter | World |
| Product | All products |
| View by | Exporter |
| Frequency | Monthly |
| Requested Start | Jan-2000 |
| Requested End | Jun-2026 |
| Data source | Mirror |
| Data type | Values |
| Currency | USD |
| View | Table |
| Export | Trade Map Save |

These are **global desired settings**.

They are reapplied for **every single country**.

---

# 3. Critical Date-Range Problem

## Problem

Consider:

```text
India
Available data: 2000 → 2026

Pakistan
Available data: 2024 → 2026

China
Available data: 2000 → 2026
```

A naive browser flow could do:

```text
India
2000 → 2026

↓ change country

Pakistan
Trade Map adjusts range:
2024 → 2026

↓ change country

China
Browser retains:
2024 → 2026
```

That would incorrectly export only:

```text
China 2024 → 2026
```

even though China has older data.

This is unacceptable.

---

# 4. Final Date-Range Solution

The automation must maintain two different concepts:

## A. Requested Range

Global configuration:

```text
requestedStart = 2000-01
requestedEnd   = 2026-06
```

This value **never changes during the run**.

Pakistan cannot modify it.

India cannot modify it.

China cannot modify it.

---

## B. Effective Range

The actual period Trade Map returns for an individual country.

Example:

```text
Country       Requested        Effective

India         2000-2026        2000-2026
Pakistan      2000-2026        2024-2026
China         2000-2026        2000-2026
```

Pakistan's:

```text
effectiveStart = 2024
```

must NEVER become:

```text
nextRequestedStart = 2024
```

That distinction is mandatory.

---

# 5. Country Job Isolation

Every country runs as an independent job.

Pseudo-flow:

```text
for country in countries:

    requestedRange = GLOBAL_RANGE

    select country

    RESET all filters

    apply requestedRange

    wait for Trade Map

    determine effectiveRange

    export

    save

    validate

    close country job
```

When the next country starts:

```text
NO STATE FROM PREVIOUS COUNTRY
```

is allowed to control the query.

---

# 6. Even Stronger Implementation: Canonical URL

Your current Trade Map URL already contains the query state:

```text
/en/goods/time-series/imports/
c/212/
c/000/
p/ALL/
byPartner/
month/
200001-202606/
mirror/
values/
USD/
table
```

Therefore, wherever reliable, the automation should avoid depending only on dropdown state.

It should construct or verify a canonical query equivalent to:

```text
IMPORTER = current country
EXPORTER = World
PRODUCT = ALL
VIEW = byPartner/exporter
FREQUENCY = month
RANGE = 200001-202606
SOURCE = mirror
TYPE = values
CURRENCY = USD
VIEW = table
```

This gives us a second protection against stale UI state.

---

# 7. Country Code Resolver

Each country will internally have:

```text
name
Trade Map / numeric country code
```

Example conceptually:

```text
Dominica → 212
World    → 000
```

Input may contain only:

```text
Dominica
China
India
Pakistan
```

The system will resolve the numeric identifier through a local country-code map.

Architecture:

```text
Country Name
      ↓
CountryCodeResolver
      ↓
Trade Map numeric code
      ↓
Canonical query
```

Fallback:

If a code cannot be resolved:

```text
use Trade Map country-search UI
```

and log that UI resolution was used.

---

# 8. Technology Stack

## Core

```text
Node.js
TypeScript
Playwright
```

## Supporting Modules

```text
filesystem/path
configuration validator
Excel reader for country input
structured logger
```

The Trade Map-exported Excel itself should **not be recreated** unless necessary.

Prefer:

```text
Trade Map generated XLSX
        ↓
download
        ↓
saveAs(target path)
```

This preserves Trade Map's original workbook.

---

# 9. Why Playwright Instead of AI Clicking

Core workflow must be deterministic.

Use:

```text
DOM selectors
roles
labels
URLs
download events
explicit waits
state validation
```

Not:

```text
"AI visually guess where country dropdown is"
```

AI can optionally help later with error analysis.

It should not be responsible for normal execution.

---

# 10. System Components

Architecture:

```text
┌─────────────────────────────┐
│       countries.xlsx        │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│       Config Manager        │
│ filters / path / dates      │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│      Job Orchestrator       │
│ country-by-country loop     │
└─────────────┬───────────────┘
              │
       ┌──────▼───────┐
       │ Auth Manager │
       └──────┬───────┘
              │
              ▼
┌─────────────────────────────┐
│      TradeMap Driver        │
│ Page Object / locators      │
└─────────────┬───────────────┘
              │
        ┌─────▼─────┐
        │ Range     │
        │ Engine    │
        └─────┬─────┘
              │
              ▼
┌─────────────────────────────┐
│      Export Manager         │
│ Save button / download      │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│      File Manager           │
│ rename / target path        │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│      Validator              │
│ file exists / XLSX valid    │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Run Manifest / Resume State │
└─────────────────────────────┘
```

---

# 11. Input Design

## countries.xlsx

Primary input workbook:

| order | country | enabled |
|---:|---|---|
| 1 | India | TRUE |
| 2 | Pakistan | TRUE |
| 3 | China | TRUE |
| 4 | Angola | TRUE |
| 5 | Argentina | TRUE |

Order must be preserved.

If:

```text
India
Pakistan
China
```

is supplied in that sequence, automation processes:

```text
India → Pakistan → China
```

not alphabetical order.

---

# 12. Configuration

Example:

```json
{
  "tradeMapBaseUrl": "https://www.trademap.org/en/",
  "outputDirectory": "D:\\TradeMap\\Exports",

  "filters": {
    "tradeFlow": "imports",
    "exporter": "world",
    "product": "ALL",
    "viewBy": "exporter",
    "frequency": "monthly",
    "source": "mirror",
    "dataType": "values",
    "currency": "USD"
  },

  "datePolicy": {
    "requestedStart": "200001",
    "requestedEnd": "202606",
    "mode": "MAX_WITHIN_REQUESTED_RANGE"
  },

  "download": {
    "format": "xlsx",
    "overwrite": false
  },

  "retry": {
    "countryAttempts": 3,
    "downloadAttempts": 2
  }
}
```

---

# 13. End-Date Handling

The end date must also be configuration-driven.

Today your desired period may be:

```text
200001 → 202606
```

Later it could become:

```text
200001 → 202607
```

or:

```text
200001 → 202612
```

Therefore no date should be hardcoded into business logic.

Only configuration changes.

---

# 14. Range Policy

Default:

```text
MAX_WITHIN_REQUESTED_RANGE
```

Meaning:

> Request Jan-2000 to Jun-2026 for every country and use whatever valid subset Trade Map actually makes available.

Examples:

### Country A

Available:

```text
2000-01 → 2026-06
```

Effective:

```text
2000-01 → 2026-06
```

### Country B

Available:

```text
2024-01 → 2026-06
```

Effective:

```text
2024-01 → 2026-06
```

### Country C

Available:

```text
2005-01 → 2025-12
```

Effective:

```text
2005-01 → 2025-12
```

---

# 15. Mandatory Range Reset

Immediately after changing importer, automation executes:

```text
ResetRangeToGlobalDefault()
```

This is mandatory.

It does NOT ask:

```text
What date was selected for previous country?
```

Instead:

```text
start = config.requestedStart
end   = config.requestedEnd
```

every time.

---

# 16. Range Validation

Before clicking Save, automation must read the displayed range.

Example:

```text
UI says:
Jan 24 – Jun 26
```

System records:

```text
requested:
200001-202606

effective:
202401-202606

rangeStatus:
CLIPPED_BY_AVAILABILITY
```

For China:

```text
requested:
200001-202606

effective:
200001-202606

rangeStatus:
FULL_RANGE
```

---

# 17. Query Validation Before Export

Save must NOT be clicked until the system verifies:

```text
Importer == expected country
Trade Flow == Imports
Exporter == World
Product == All products
Frequency == Monthly
Data Source == Mirror
Data Type == Values
Currency == USD
View By == Exporter
```

Plus:

```text
date range has been processed
```

This prevents downloading a perfectly valid Excel file for the wrong query.

---

# 18. Export Workflow

After validation:

```text
waitForEvent("download")

↓ simultaneously

click Save
```

If Save first opens a menu:

```text
Save
 ↓
Excel/XLSX
```

then automation selects the correct format.

After download begins:

```text
await download
```

Then save directly to:

```text
targetFolder + generatedFilename
```

The browser's random/default filename does not matter.

---

# 19. Filename Strategy

Filename must be generated before export.

Recommended default:

```text
{Country}_TradeMap_Imports_AllProducts_byExporter_Monthly_Mirror_{EffectiveStart}-{EffectiveEnd}_USD.xlsx
```

Examples:

```text
India_TradeMap_Imports_AllProducts_byExporter_Monthly_Mirror_200001-202606_USD.xlsx
```

Pakistan:

```text
Pakistan_TradeMap_Imports_AllProducts_byExporter_Monthly_Mirror_202401-202606_USD.xlsx
```

China:

```text
China_TradeMap_Imports_AllProducts_byExporter_Monthly_Mirror_200001-202606_USD.xlsx
```

Using the **effective** date range is preferable because filename truthfully describes the contents.

---

# 20. Custom Naming Convention

The template must be configurable:

```json
{
  "filenameTemplate":
  "{country}_TradeMap_{frequency}_{source}_{start}-{end}.{extension}"
}
```

Could generate:

```text
Dominica_TradeMap_Monthly_Mirror_200001-202606.xlsx
```

or your own convention later.

No code change should be required.

---

# 21. Folder Architecture

Recommended:

```text
trade-map-automation/
│
├── config/
│   ├── config.json
│   └── country-codes.json
│
├── input/
│   └── countries.xlsx
│
├── auth/
│   └── trademap-state.json
│
├── output/
│
├── logs/
│   ├── runs/
│   └── errors/
│
├── screenshots/
│   └── failures/
│
├── manifests/
│   └── latest-run.json
│
├── src/
│   ├── auth/
│   ├── browser/
│   ├── trademap/
│   ├── download/
│   ├── files/
│   ├── validation/
│   └── orchestrator/
│
└── package.json
```

Actual export folder may instead be:

```text
D:\TradeMap\Exports\
```

---

# 22. Authentication Design

## Credentials MUST NOT be stored in config.json

First execution:

```text
1. Start dedicated automation browser.
2. Navigate to Trade Map.
3. If not logged in:
      show message:
      "Please login to Trade Map."
4. User manually logs in.
5. User presses Continue.
6. Save authenticated browser state locally.
```

Future runs:

```text
Load saved authenticated state
↓
Open Trade Map
↓
Already logged in
```

If login expires:

```text
SESSION_EXPIRED
↓
Pause automation
↓
Ask user to login
↓
Update state
↓
Resume from current country
```

No countries already completed should be lost.

---

# 23. Dedicated Browser Profile

Do not automate the user's everyday Chrome profile.

Create:

```text
D:\TradeMapAutomation\BrowserProfile\
```

for the automation.

This profile owns:

```text
cookies
local storage
Trade Map login state
```

but does not interfere with normal Chrome.

---

# 24. Country Execution State Machine

Every country follows exactly:

```text
PENDING
  ↓
OPENING_QUERY
  ↓
COUNTRY_SELECTED
  ↓
FILTERS_RESET
  ↓
DATE_REQUESTED
  ↓
DATE_VALIDATED
  ↓
QUERY_VALIDATED
  ↓
EXPORT_REQUESTED
  ↓
DOWNLOADING
  ↓
FILE_SAVED
  ↓
FILE_VALIDATED
  ↓
SUCCESS
```

Possible failure states:

```text
LOGIN_REQUIRED
COUNTRY_NOT_FOUND
FILTER_ERROR
DATE_ERROR
SAVE_DISABLED
DOWNLOAD_TIMEOUT
INVALID_FILE
TRADEMAP_ERROR
UNKNOWN_ERROR
```

---

# 25. Download Validation

After download:

### Check 1

File exists:

```text
exists == true
```

### Check 2

File size:

```text
size > 0
```

### Check 3

Correct extension:

```text
.xlsx
```

### Check 4

Can workbook be opened?

```text
YES → success
NO  → invalid download
```

### Check 5 — optional stronger validation

Inspect first worksheet for expected Trade Map markers.

If downloaded response is actually:

```text
login HTML page
error page
access denied page
```

the system must reject it.

---

# 26. Download Timeout

Large 30,000-row export may take longer.

Never use:

```text
sleep(5 seconds)
```

and assume complete.

Use:

```text
wait until browser download completes
```

with a configurable maximum timeout.

Example:

```text
downloadTimeout = 5 minutes
```

---

# 27. Retry Strategy

Each country:

```text
Maximum attempts = 3
```

Example:

```text
Attempt 1
Download timeout

Attempt 2
Trade Map temporary error

Attempt 3
Success
```

If all attempts fail:

```text
mark FAILED
continue next country
```

Do not stop entire 30-country batch because one country failed.

---

# 28. Session Expiry Exception

Authentication failure is different.

If Trade Map redirects to login:

```text
PAUSE ENTIRE RUN
```

not:

```text
retry country 3 times
```

User logs back in.

Then:

```text
resume current country
```

---

# 29. Resume System

Suppose:

```text
30 countries total
```

Automation completes:

```text
1–17
```

and PC restarts.

Next run reads manifest:

```text
1–17 = SUCCESS
18–30 = PENDING
```

It starts at:

```text
18
```

not country 1.

---

# 30. Run Manifest

Example:

```json
{
  "runId": "2026-08-17-001",

  "countries": [
    {
      "country": "India",
      "requestedRange": "200001-202606",
      "effectiveRange": "200001-202606",
      "status": "SUCCESS",
      "file": "India_TradeMap_....xlsx"
    },

    {
      "country": "Pakistan",
      "requestedRange": "200001-202606",
      "effectiveRange": "202401-202606",
      "status": "SUCCESS",
      "rangeStatus": "CLIPPED_BY_AVAILABILITY"
    },

    {
      "country": "China",
      "requestedRange": "200001-202606",
      "effectiveRange": "200001-202606",
      "status": "SUCCESS"
    }
  ]
}
```

This manifest is essential.

---

# 31. Human-Readable Run Report

Also create:

```text
run-report.xlsx
```

Example:

| Country | Requested | Effective | Status | File | Attempts |
|---|---|---|---|---|---:|
| India | 200001-202606 | 200001-202606 | Success | India...xlsx | 1 |
| Pakistan | 200001-202606 | 202401-202606 | Success | Pakistan...xlsx | 1 |
| China | 200001-202606 | 200001-202606 | Success | China...xlsx | 1 |

This makes auditing very easy.

---

# 32. Failure Evidence

Whenever a country fails:

capture:

```text
screenshot
current URL
country
current filter values
requested range
visible range
error
timestamp
```

Example:

```text
screenshots/failures/
    Argentina_20260817_142201.png
```

---

# 33. Save Button Disabled

Trade Map may restrict downloading for certain data.

If:

```text
Save button missing
or
Save disabled
```

do NOT attempt to bypass it.

Record:

```text
status = EXPORT_NOT_AVAILABLE
```

and continue.

---

# 34. Large Data Rule

If Trade Map's Save function returns the entire dataset:

```text
30,000 rows
```

the automation does not need:

```text
page 1
page 2
page 3
...
```

The workflow is simply:

```text
prepare query
↓
Save
↓
download full file
```

This is the preferred architecture.

HTML scraping is only a fallback and is **out of scope for MVP**.

---

# 35. Sequential Processing

MVP must process countries sequentially:

```text
Country 1
↓
Country 2
↓
Country 3
```

Do NOT run 10 Trade Map tabs simultaneously.

Reasons:

```text
simpler authentication
less session interference
less server pressure
easier debugging
predictable downloads
```

Parallel processing is not required.

---

# 36. Idempotency

Before starting a country:

```text
if manifest says SUCCESS
and expected file exists
and file validates
```

then:

```text
SKIP
```

Unless user runs:

```text
--force
```

This prevents duplicate downloads.

---

# 37. Existing Filename Collision

If:

```text
India_....xlsx
```

already exists:

Default:

```text
do not overwrite
```

Possible modes:

```text
skip
overwrite
version
```

Version example:

```text
India_...._v2.xlsx
```

---

# 38. Main Orchestrator Logic

Conceptually:

```text
loadConfig()

countries = loadCountries()

authenticate()

for country of countries:

    if alreadySuccessful(country):
        continue

    startCountry(country)

    try:

        navigateToCountry(country)

        applyLockedFilters()

        applyRequestedRange(
            globalStart,
            globalEnd
        )

        effectiveRange =
            detectEffectiveRange()

        validateQuery()

        targetFilename =
            generateFilename(
                country,
                effectiveRange
            )

        download =
            triggerTradeMapSave()

        saveDownload(
            targetFilename
        )

        validateFile()

        markSuccess()

    catch LoginExpired:

        pauseForLogin()

        retryCurrentCountry()

    catch Error:

        captureFailureEvidence()

        retryOrFail()

generateRunReport()
```

---

# 39. India → Pakistan → China Expected Behaviour

This scenario must be an acceptance test.

## India

Input:

```text
GLOBAL = 200001-202606
```

System explicitly requests:

```text
200001-202606
```

Trade Map:

```text
200001-202606
```

Export:

```text
India_..._200001-202606.xlsx
```

---

## Pakistan

System does NOT inherit India's selection.

It again requests:

```text
200001-202606
```

Trade Map only supports:

```text
202401-202606
```

System records:

```text
requested = 200001-202606
effective = 202401-202606
status = CLIPPED_BY_AVAILABILITY
```

Exports:

```text
Pakistan_..._202401-202606.xlsx
```

---

## China

This is the critical test.

System must NOT use:

```text
202401
```

from Pakistan.

Instead:

```text
requestedStart =
GLOBAL.requestedStart
=
200001
```

Trade Map returns:

```text
200001-202606
```

Exports:

```text
China_..._200001-202606.xlsx
```

If China exports only 2024 onward, the automation fails validation.

---

# 40. Filter Carryover Protection

The same rule applies to every filter.

Never assume that changing importer preserves correct values.

After selecting every country execute:

```text
ensureTradeFlow(Imports)
ensureExporter(World)
ensureProduct(All Products)
ensureViewBy(Exporter)
ensureFrequency(Monthly)
ensureSource(Mirror)
ensureDataType(Values)
ensureCurrency(USD)
ensureRange(GlobalRange)
```

`ensure` means:

```text
read current value

if correct:
    do nothing

if incorrect:
    change it
```

---

# 41. Page Load Strategy

After any filter change:

do not immediately click Save.

Wait for one of:

```text
loading indicator disappears

or

table becomes stable

or

URL reaches expected state

or

query heading changes to expected country
```

Then validate.

---

# 42. Country Verification

Before Save, page heading should contain current importer.

Example:

```text
Dominica's imports from World, by exporter (Mirror)
```

For China job, expected:

```text
China's imports from World...
```

If automation is processing:

```text
China
```

but heading says:

```text
Pakistan's imports...
```

then export is blocked.

---

# 43. Security Requirements

Never:

```text
store Trade Map password in source code
commit authenticated state to Git
send auth state to cloud
log cookies
log session tokens
```

Auth directory must be ignored:

```text
.auth/
browser-profile/
```

---

# 44. Compliance Boundary

The system automates the same Save operation available to the authenticated user.

It must NOT:

```text
bypass CAPTCHA
bypass download restrictions
circumvent disabled Save buttons
reverse engineer protected authentication
evade Trade Map limits
```

If Trade Map refuses export:

```text
record failure
```

not bypass it.

---

# 45. MVP Scope

Version 1 must support:

- Read country list
- Manual first login
- Persistent authenticated session
- Sequential country loop
- Country switching
- Locked filters
- Mandatory global date reset
- Effective-date detection
- Save button automation
- XLSX download capture
- Custom path
- Custom filename
- File validation
- Retry
- Resume
- Run manifest
- Error screenshots
- Final summary report

---

# 46. Explicitly Out of Scope for MVP

Not needed initially:

- AI browser agent
- OCR
- HTML scraping of 30,000 rows
- cloud server
- database
- parallel Trade Map sessions
- automatic CAPTCHA solving
- bypassing disabled downloads
- mobile app

Keep V1 focused.

---

# 47. Phase 2

After MVP is stable:

## Desktop UI

Simple interface:

```text
Trade Map Automation
────────────────────

Country List:
[ countries.xlsx ]

Output:
[ D:\TradeMap\Exports ]

Requested Range:
[ Jan-2000 ] → [ Jun-2026 ]

[ ] Force overwrite

[ LOGIN ]
[ START ]
[ PAUSE ]
[ RESUME ]

Progress:
18 / 30

Current:
Argentina

Status:
Downloading...
```

---

# 48. Phase 2 Additional Features

Potential additions:

- drag-and-drop country Excel
- progress bar
- estimated completion count
- failed-country retry button
- open output folder
- export history
- multiple presets
- scheduling
- automatic latest-month selection

---

# 49. Future Dynamic Maximum Range

Currently:

```text
end = 202606
```

Later we can add:

```text
endMode = LATEST_AVAILABLE
```

Then automation could determine the newest month displayed by Trade Map before processing.

Requested range becomes:

```text
200001 → latest available
```

without manually changing config every month.

But for V1, explicit:

```text
200001-202606
```

is safer and easier to test.

---

# 50. Acceptance Criteria

System is ready only when all are true.

## AC-01

Given:

```text
India
Pakistan
China
```

Pakistan's reduced start date must not affect China.

---

## AC-02

Every country receives the global requested range independently.

---

## AC-03

All locked filters are verified before Save.

---

## AC-04

Downloaded file is saved under the configured directory.

---

## AC-05

Filename follows configured naming convention.

---

## AC-06

30,000-row export does not require HTML pagination if Save already exports everything.

---

## AC-07

If browser closes halfway through 30 countries, next run resumes remaining countries.

---

## AC-08

If login expires, automation pauses instead of marking every remaining country failed.

---

## AC-09

Invalid/zero-byte download cannot receive SUCCESS status.

---

## AC-10

Failure screenshot and log are produced.

---

## AC-11

Input country order is preserved.

---

## AC-12

No credentials appear in source files or logs.

---

# 51. Recommended Development Phases

## Phase 1 — Single-Country Proof of Concept

Use:

```text
Dominica
```

Implement:

```text
login
query
range
Save
download
rename
validate
```

Goal:

one perfect automated export.

---

## Phase 2 — Date-Range Test

Countries:

```text
India
Pakistan
China
```

Goal:

prove country-range isolation.

This is the **most important functional test**.

---

## Phase 3 — Five-Country Batch

Use:

```text
Angola
Anguilla
Argentina
Armenia
Australia
```

Test:

```text
loop
download
naming
retry
logs
```

---

## Phase 4 — Thirty Countries

Full production batch.

Test:

```text
session duration
resume
large downloads
errors
```

---

# 52. Final Recommended Architecture

```text
                 ┌──────────────────┐
                 │ countries.xlsx   │
                 └────────┬─────────┘
                          │
                 ┌────────▼─────────┐
                 │ Config + Rules   │
                 └────────┬─────────┘
                          │
                 ┌────────▼──────────┐
                 │ Job Orchestrator  │
                 └────────┬──────────┘
                          │
                 ┌────────▼──────────┐
                 │ Playwright        │
                 │ Authenticated     │
                 │ Browser           │
                 └────────┬──────────┘
                          │
               ┌──────────▼───────────┐
               │ Trade Map Page Layer │
               └──────────┬───────────┘
                          │
          ┌───────────────▼────────────────┐
          │ Reset ALL Filters Per Country  │
          │ Requested range = 2000 → 2026  │
          └───────────────┬────────────────┘
                          │
                 ┌────────▼─────────┐
                 │ Effective Range  │
                 │ Detection        │
                 └────────┬─────────┘
                          │
                 ┌────────▼─────────┐
                 │ Query Validation │
                 └────────┬─────────┘
                          │
                 ┌────────▼─────────┐
                 │ Trade Map Save   │
                 └────────┬─────────┘
                          │
                 ┌────────▼─────────┐
                 │ Download Capture │
                 └────────┬─────────┘
                          │
                 ┌────────▼─────────┐
                 │ Rename / saveAs  │
                 │ Local Directory  │
                 └────────┬─────────┘
                          │
                 ┌────────▼─────────┐
                 │ XLSX Validation  │
                 └────────┬─────────┘
                          │
                 ┌────────▼─────────┐
                 │ Manifest / Log   │
                 └──────────────────┘
```

---

# 53. Final Decision

**Core technology:** Playwright + TypeScript

**Automation model:** Deterministic RPA/browser automation

**Login:** Manual first login + reusable local authenticated session

**Country input:** Excel list

**Processing:** Sequential

**Data retrieval:** Trade Map's own Save/export function

**Date strategy:** Global requested range reapplied independently for every country

**Reduced-country availability:** Accept reduced effective range but NEVER carry it to next country

**Output:** Original downloaded Excel file

**Storage:** User-defined local directory

**Naming:** Configurable

**Reliability:** Validation + retry + resume + screenshots + manifest

**Security:** No password embedded in automation

This architecture directly solves the major risk:

> **Pakistan having data only from 2024 must never cause China's export to begin from 2024.**

Every country begins from a clean global query specification.