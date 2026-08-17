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
- **Run manifest** — machine-readable per-country status/range/file record enabling resume.
  (PRD §30) — introduced Phase 5.
- **Effective vs requested filename** — generated filenames use the EFFECTIVE range so the
  name truthfully describes the file's contents. (PRD §19)
- **Done** — see CLAUDE.md: build compiles clean, phase acceptance criteria pass, and (for
  export phases) a real validated `.xlsx` exists — not merely "download event fired".
