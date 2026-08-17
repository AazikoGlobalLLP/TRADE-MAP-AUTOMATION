// ---------------------------------------------------------------------------
// Configurable filename generation (PRD §19–20). The template lives in config,
// so changing the naming convention is a config edit, not a code edit. Filenames
// use the EFFECTIVE range so the name truthfully describes the file's contents
// (DECISIONS 2026-08-17). Moved here from save-validate.ts in Phase 2.
// ---------------------------------------------------------------------------

/**
 * Render a filename template against a token map, then sanitize for the filesystem.
 * `{token}` is replaced when present; an unknown `{token}` is left literal so a
 * typo is visible in the output name rather than silently dropped (PRD §20).
 */
export function generateFilename(template: string, tokens: Record<string, string>): string {
  const rendered = template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : whole,
  );
  return sanitizeFilename(rendered);
}

/**
 * Make a rendered name safe to write on Windows (production target is
 * `D:\TradeMap\Exports`). The resolver now accepts arbitrary country names, so a
 * name could contain a path separator or a reserved character; replace all of
 * `\ / : * ? " < > |` and control chars with `_`, then trim trailing dots/spaces
 * (Windows silently drops those and would break a later exists() check).
 */
export function sanitizeFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
  return cleaned.replace(/[ .]+$/g, '');
}
