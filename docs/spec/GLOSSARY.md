# Glossary — fixed project meanings

Terms below have ONE meaning in this project. Do not redefine them in later sessions.

- **Requested range** — the global `requestedStart`–`requestedEnd` from config
  (default `200001`–`202606`). Immutable for the entire run. Every country is asked for
  this exact range. No country may modify it. (PRD §4A, §15)
- **Effective range** — the actual `YYYYMM`–`YYYYMM` period Trade Map returns for one
  country. Per-country. MUST NEVER become the next country's requested range. (PRD §4B)
- **Range status** — `FULL_RANGE` (effective == requested) or `CLIPPED_BY_AVAILABILITY`
  (effective is a subset). (PRD §16)
- **Locked filters** — the fixed query in PRD §2: imports · World exporter · ALL products ·
  by Exporter · monthly · mirror · values · USD · table. Re-applied for every country.
- **ensure\*** pattern — read the current UI value; change it ONLY if wrong. Used for every
  filter after each country switch. (PRD §40)
- **Canonical URL** — the deterministic Trade Map URL that encodes the full query
  (country/flow/exporter/product/view/freq/range/source/type/currency/view). Primary way to
  set query state; dropdowns are the fallback. (PRD §6)
- **Country code** — ISO-3166 numeric used by Trade Map (Dominica=212, World=000), resolved
  from `config/country-codes.json`; UI search is the documented fallback. (PRD §7)
- **Save** — Trade Map's own export/Save function that produces the complete dataset as a
  file. We trigger it and capture the download; we do NOT scrape the HTML table. (PRD §34)
- **Isolation boundary** — `runCountry()` (`src/orchestrator/runCountry.ts`): one country
  start-to-finish. Receives the GLOBAL range BY VALUE (frozen in `index.ts`), only reads it,
  and RETURNS the per-country effective range — never stores it where the next call reads.
  This is the structural enforcement of "effective must not bleed into the next request". (PRD §5)
- **Query gate** — `verifyQuery()` / pure `assertQueryValid()` (`src/trademap/verifyQuery.ts`):
  the hard pre-Save check. Save is unreachable unless heading names the importer AND every
  locked filter reads back correct AND the query requests the GLOBAL range. Any mismatch throws
  `QUERY_INVALID:`. (PRD §42, convention #5)
- **Isolation harness** — `npm run test:isolation` (`src/orchestrator/isolation-check.ts`): a
  deterministic, browser-free proof of the India→Pakistan→China isolation logic (PRD §39). It
  is the Phase 3A demo; the live 3-file run is Phase 3B.
- **Batch** — a sequential run over an ordered country list from `input/countries.xlsx`
  (`runBatch` in `src/orchestrator/runBatch.ts`), one `runCountry()` at a time. A single
  country's failure never stops the rest. (PRD §35) — introduced Phase 4.
- **Retry policy** — each country gets up to `batch.maxAttemptsPerCountry` (default **3**) TOTAL
  attempts (1 initial + 2 retries), with a `batch.retryDelayMs` backoff between them. `LOGIN_REQUIRED`
  is fatal (aborts the batch); other errors retry then record `FAILED`. (`src/orchestrator/retry.ts`, PRD §36)
- **Failure evidence** — a PNG + sidecar JSON written per FAILED attempt under
  `screenshots/failures/<runId>/` (URL, filters, error, timestamp). Best-effort; never masks the
  original error. (`src/evidence/captureFailure.ts`, PRD §36) — introduced Phase 4.
- **Batch exit code** — `0` all SUCCESS/SKIPPED · `1` any `FAILED` · `2` aborted (`LOGIN_REQUIRED`)
  or empty input (`BATCH_EMPTY`). (Phase 4)
- **Batch harness** — `npm run test:batch` (`src/orchestrator/batch-check.ts`): a deterministic,
  browser-free proof (22/22) of the batch loop / retry / evidence / abort / exit-code logic using a
  FAKE `runCountry`. It is the Phase 4A demo; the live 5-country run is Phase 4B.
- **Run manifest** — machine-readable per-country status/range/file record enabling resume, written
  atomically (`.tmp`→rename) after every country to `manifests/latest-run.json` (config `manifestFile`;
  absent ⇒ manifest disabled). Entries keyed by country name (case-insensitive). (`src/manifest/manifest.ts`,
  PRD §30) — introduced Phase 5.
- **Idempotency / resume skip** — a country is skipped BEFORE download iff its manifest entry is `SUCCESS`
  under the CURRENT requested range AND its recorded file still `validateXlsx`es on disk (never trust the
  manifest alone). `--force` bypasses it. Summary shows `SKIPPED (ALREADY_DONE)`; the manifest entry stays
  `SUCCESS`. (`src/manifest/resume.ts` `shouldSkipByManifest`/`isAlreadyDone`, PRD §36/§29) — Phase 5.
- **Collision mode** — how an existing target filename is handled AT SAVE TIME (keyed on the effective
  filename): `skip` (default; leave it, `SKIPPED (FILE_EXISTS)`), `overwrite`, or `version` (`_vN` from `_v2`,
  first free, cap `_v999`). `download.collisionMode`; when unset, derived from legacy `overwrite`
  (`true→overwrite`, `false→skip`). (`src/files/collision.ts`, PRD §37) — Phase 5.
- **`--force`** — CLI flag: ignore the resume manifest (re-run every country) AND force collision `overwrite`
  for the run. Applies to batch and single-country. (PRD §36) — Phase 5.
- **Manifest harness** — `npm run test:manifest` (`src/manifest/manifest-check.ts`): a deterministic,
  browser-free proof (24/24) of the collision / manifest / resume / idempotency logic using pure functions +
  a fake `runCountry` + in-memory manifest. It is the Phase 5A demo; the live kill-and-resume run is Phase 5B.
- **Effective vs requested filename** — generated filenames use the EFFECTIVE range so the
  name truthfully describes the file's contents. (PRD §19)
- **Done** — see CLAUDE.md: build compiles clean, phase acceptance criteria pass, and (for
  export phases) a real validated `.xlsx` exists — not merely "download event fired".
