# Project Map — Trade Map Automated Export System

Where things are (and will be). `[planned]` = not yet built; created in the noted phase.

```
AAZIKO-AUTOMATION/
├── Trade Map ... PRD & Architecture.md   Source PRD (the spec of record)
├── CLAUDE.md                             Project rules, commands, conventions
├── docs/
│   ├── PHASES.md                         Build phases (≤8 files each, one demo each)
│   ├── DECISIONS.md                      Locked decisions, append-only
│   ├── PROJECT_MAP.md                    This file
│   ├── HANDOFF.md                        Session handoff / where to resume
│   └── spec/
│       ├── GLOSSARY.md                   Fixed term meanings
│       └── phase-1-single-country.md     Phase 1 locked spec (SPEC LOCK table)
│
├── config/                     [P1] config.json, country-codes.json
├── input/                      [P4] countries.xlsx (ordered country list)
├── src/
│   ├── index.ts                [P1] entry: single-country run (--country)
│   ├── auth/                   [P1] session.ts (persistent login)  · [P6] expiry.ts
│   ├── trademap/               [P1] driver.ts · [P3] filters.ts, rangeEngine.ts, verifyQuery.ts
│   ├── config/                 [P2] loadConfig.ts, schema.ts
│   ├── country/                [P2] resolver.ts (name → ISO numeric)
│   ├── files/                  [P1] save-validate.ts · [P2] filename.ts · [P5] collision.ts
│   ├── input/                  [P4] readCountries.ts
│   ├── orchestrator/           [P3] runCountry.ts · [P4] runBatch.ts, retry.ts
│   ├── evidence/               [P4] captureFailure.ts (screenshots)
│   ├── manifest/               [P5] manifest.ts, resume.ts
│   ├── report/                 [P6] runReport.ts (run-report.xlsx)
│   └── logging/                [P7] logger.ts
│
├── output/                     [P1] downloaded/renamed .xlsx files (gitignored)
├── logs/                       [P1] runs/ + errors/ (gitignored)
├── screenshots/failures/       [P4] failure evidence (gitignored)
├── manifests/                  [P5] latest-run.json (gitignored)
├── .auth/  · browser-profile/  [P1] session state — GITIGNORED, never committed
├── package.json · tsconfig.json  [P1]
└── .gitignore                  [P1] auth, profile, output, logs, node_modules, dist
```

Component flow (PRD §10/§52): countries → Config → Orchestrator → Auth → TradeMap Driver
→ Range Engine → Export/Save → File Manager → Validator → Manifest/Report.
