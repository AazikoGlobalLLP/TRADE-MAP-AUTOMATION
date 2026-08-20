import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Run manifest (Phase 5, PRD §30; spec-lock rows 1–2). A machine-readable,
// per-country record of what happened, so a killed run can RESUME the remaining
// countries (§29) instead of restarting from country 1.
//
// Written ATOMICALLY (temp `.tmp` → rename) after EVERY country outcome, so a
// mid-run kill/crash always leaves valid JSON on disk (spec-lock row 1). The
// entry is keyed by country name (case-insensitive); a new run upserts the
// countries it processes and leaves prior entries untouched — a killed run's
// SUCCESS entries survive into the next run's manifest and drive the resume skip.
//
// The pure parts (`emptyManifest`, `findEntry`, `upsertEntry`) are proven offline
// by `npm run test:manifest`; `loadManifest`/`writeManifest` are thin fs shells.
// Never contains cookies/tokens — only country / range / filename (CLAUDE.md).
// ---------------------------------------------------------------------------

export type ManifestStatus = 'SUCCESS' | 'SKIPPED' | 'FAILED';
export type SkipReason = 'ALREADY_DONE' | 'FILE_EXISTS';

export interface ManifestEntry {
  country: string;
  requestedRange: string; // "YYYYMM-YYYYMM" — the GLOBAL range this entry was produced under
  effectiveRange?: string; // present on SUCCESS/SKIPPED
  rangeStatus?: string;
  status: ManifestStatus;
  skipReason?: SkipReason;
  file?: string; // filename only
  targetPath?: string; // absolute path (what the resume check re-validates)
  attempts: number;
  updatedAt: string; // ISO timestamp
  error?: string; // present on FAILED
}

export interface Manifest {
  schemaVersion: 1;
  runId: string;
  updatedAt: string;
  requestedRange: string; // the GLOBAL range of the LATEST run that touched this manifest
  countries: ManifestEntry[];
}

const SCHEMA_VERSION = 1 as const;

/** A fresh, empty manifest for a run. */
export function emptyManifest(runId: string, requestedRange: string, now: string): Manifest {
  return { schemaVersion: SCHEMA_VERSION, runId, updatedAt: now, requestedRange, countries: [] };
}

/** Case-insensitive lookup by country name (matches the resolver's tolerance). */
export function findEntry(manifest: Manifest, country: string): ManifestEntry | undefined {
  const key = country.trim().toLowerCase();
  return manifest.countries.find((e) => e.country.trim().toLowerCase() === key);
}

/**
 * PURE. The set of country names the manifest recorded as FAILED (case preserved).
 * Used by `--retry-failed` to re-run ONLY the failures without re-validating every
 * SUCCESS file on disk (which, for 200+ large NTL workbooks, is the slow part).
 */
export function failedCountries(manifest: Manifest): string[] {
  return manifest.countries.filter((e) => e.status === 'FAILED').map((e) => e.country);
}

/**
 * PURE. Return a NEW manifest with `entry` replacing any same-country entry
 * (case-insensitive, position preserved) or appended if new. Bumps `updatedAt`.
 * Never mutates the input.
 */
export function upsertEntry(manifest: Manifest, entry: ManifestEntry): Manifest {
  const key = entry.country.trim().toLowerCase();
  const idx = manifest.countries.findIndex((e) => e.country.trim().toLowerCase() === key);
  const countries = manifest.countries.slice();
  if (idx >= 0) countries[idx] = entry;
  else countries.push(entry);
  return { ...manifest, countries, updatedAt: entry.updatedAt };
}

/**
 * Load the manifest from disk, reconciled to the CURRENT run. If the file is
 * missing or unparseable we start empty (a corrupt manifest must never crash a
 * run — worst case is "resume nothing"). Prior country entries are carried so
 * the resume check can see them; `runId`/`updatedAt`/`requestedRange` are updated
 * to the current run. The resume decision itself (src/manifest/resume.ts) guards
 * on `entry.requestedRange === current`, so entries from a DIFFERENT requested
 * range never trigger a false skip.
 */
export function loadManifest(manifestPath: string, runId: string, requestedRange: string, now: string): Manifest {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return emptyManifest(runId, requestedRange, now);
  }
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as Manifest).countries)) {
    return emptyManifest(runId, requestedRange, now);
  }
  const prev = raw as Manifest;
  return {
    schemaVersion: SCHEMA_VERSION,
    runId,
    updatedAt: now,
    requestedRange,
    countries: prev.countries,
  };
}

/**
 * Write the manifest ATOMICALLY: serialise to a sibling `.tmp` then rename over
 * the target (rename is atomic on a single volume). A reader — including the next
 * run's resume — therefore never sees a half-written file, even if the process is
 * killed mid-write.
 */
export function writeManifest(manifestPath: string, manifest: Manifest): void {
  const dir = path.dirname(manifestPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${manifestPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf8');
  fs.renameSync(tmp, manifestPath);
}
