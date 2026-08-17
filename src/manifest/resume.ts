import { Manifest, ManifestEntry, findEntry } from './manifest';

// ---------------------------------------------------------------------------
// Resume / idempotency decision (Phase 5, PRD §36 + §29; spec-lock rows 3–4,6).
//
// Before a country is (re-)downloaded, decide whether it is ALREADY DONE and can
// be skipped. Per §36 the bar is three-fold and ALL must hold:
//   1. the manifest says this country succeeded UNDER THE CURRENT requested range,
//   2. a target file was recorded, and
//   3. that file still exists AND re-validates on disk right now.
//
// (3) is why we never trust the manifest blindly (HANDOFF note): a file can be
// deleted or corrupted between runs, so a manifest SUCCESS alone is not enough.
//
// `--force` (row 4) skips the whole check → every country re-runs.
//
// The manifest half is a PURE predicate (`shouldSkipByManifest`); the on-disk
// re-validation is an injected async `validateFile`, so `isAlreadyDone` is proven
// offline with a fake validator (including the deleted-file → re-run case).
// ---------------------------------------------------------------------------

/**
 * PURE. True iff the manifest alone clears this country for a skip (still subject
 * to the on-disk re-validation done by `isAlreadyDone`). `--force` always returns
 * false. Guards on requestedRange so a SUCCESS recorded for a DIFFERENT global
 * range never triggers a false skip (spec-lock row 6).
 */
export function shouldSkipByManifest(
  entry: ManifestEntry | undefined,
  requestedRange: string,
  force: boolean,
): boolean {
  if (force) return false;
  if (!entry) return false;
  if (entry.status !== 'SUCCESS') return false;
  if (entry.requestedRange !== requestedRange) return false;
  if (!entry.targetPath) return false;
  return true;
}

/**
 * Full idempotency check: manifest predicate AND the recorded file still validates
 * on disk. `validateFile` returns true iff the file exists and passes validation
 * (the real impl wraps `validateXlsx`; a throw/false means "not done → re-run").
 */
export async function isAlreadyDone(
  manifest: Manifest,
  country: string,
  requestedRange: string,
  force: boolean,
  validateFile: (targetPath: string) => Promise<boolean>,
): Promise<boolean> {
  const entry = findEntry(manifest, country);
  if (!shouldSkipByManifest(entry, requestedRange, force)) return false;
  return validateFile(entry!.targetPath!);
}
