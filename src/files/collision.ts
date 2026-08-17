// ---------------------------------------------------------------------------
// Filename collision modes (Phase 5, PRD §37; spec-lock rows 5–6).
//
// When the target filename already exists on disk, one of three modes decides
// what to do — DEFAULT `skip`, plus `overwrite` and `version`:
//   • skip      → do not overwrite; record SKIPPED (skipReason FILE_EXISTS).
//   • overwrite → replace the existing file in place.
//   • version   → write `<name>_v2.xlsx`, `_v3`, … the first free name.
//
// This is applied AT SAVE TIME, keyed on the EFFECTIVE filename (which is only
// known AFTER the download — the new Trade Map beta forces download-before-naming,
// DECISIONS 2026-08-17). The PRE-download idempotency skip is a separate mechanism
// that keys on the manifest entry (src/manifest/resume.ts), not the effective name.
//
// PURE: `resolveCollision` takes an injected `exists(name)` predicate and never
// touches the filesystem, so the whole decision is proven offline by the manifest
// harness (`npm run test:manifest`) — the same offline-provability trick as the
// range core and the batch loop.
// ---------------------------------------------------------------------------

export type CollisionMode = 'skip' | 'overwrite' | 'version';

export const COLLISION_MODES: readonly CollisionMode[] = ['skip', 'overwrite', 'version'];

/** Cap on version probing so a pathological directory can never loop forever (spec-lock row 5). */
const MAX_VERSION = 999;

export interface CollisionDecision {
  action: 'save' | 'skip';
  finalName: string; // the name to actually write under (may be a `_vN` variant)
  versioned: boolean; // true iff we chose a `_vN` name
}

/**
 * Resolve the shipped default: `collisionMode` wins if set, otherwise derive it
 * from the legacy `overwrite` boolean (`true → overwrite`, `false → skip`) so an
 * existing pre-Phase-5 config keeps behaving exactly as before (spec-lock row 5).
 */
export function resolveCollisionMode(download: { overwrite: boolean; collisionMode?: CollisionMode }): CollisionMode {
  if (download.collisionMode) return download.collisionMode;
  return download.overwrite ? 'overwrite' : 'skip';
}

/**
 * Insert a `_vN` suffix before the final extension.
 *   `India.xlsx`          → `India_v2.xlsx`
 *   `India_...USD.xlsx`   → `India_...USD_v2.xlsx`
 *   `noext`               → `noext_v2`
 */
export function versionedName(filename: string, n: number): string {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return `${filename}_v${n}`; // no extension (or leading dot only)
  return `${filename.slice(0, dot)}_v${n}${filename.slice(dot)}`;
}

/**
 * PURE collision decision. `exists(name)` reports whether a file of that name is
 * already present in the target directory (injected — no fs here).
 *
 * `version` probes `_v2.._v${MAX_VERSION}` and returns the first free name; if all
 * are taken it throws `COLLISION_EXHAUSTED` rather than looping forever.
 */
export function resolveCollision(
  filename: string,
  mode: CollisionMode,
  exists: (name: string) => boolean,
): CollisionDecision {
  if (!exists(filename)) {
    return { action: 'save', finalName: filename, versioned: false };
  }

  switch (mode) {
    case 'skip':
      return { action: 'skip', finalName: filename, versioned: false };
    case 'overwrite':
      return { action: 'save', finalName: filename, versioned: false };
    case 'version': {
      for (let n = 2; n <= MAX_VERSION; n++) {
        const candidate = versionedName(filename, n);
        if (!exists(candidate)) return { action: 'save', finalName: candidate, versioned: true };
      }
      throw new Error(`COLLISION_EXHAUSTED: no free version name for "${filename}" up to _v${MAX_VERSION}`);
    }
  }
}
