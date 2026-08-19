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

/** Inputs the flow-aware tokens are derived from (a subset of FiltersConfig). */
export interface FlowTokenInput {
  tradeFlow: string; // 'imports' | 'exports'
  viewBy: string; // 'exporter' | 'product'
  frequency: string; // 'monthly' | 'quarterly' | 'yearly'
  source: string; // 'mirror' | 'direct'
  detail?: string; // Phase 9: 'NTL' | 'HS6' | 'HS4' | 'HS2' — only set for viewBy=product
}

// Word maps for the Phase 8 flow-aware filename (spec row 16). Singular flow word
// to match the `india-export-country…` example; viewBy "exporter" renders as
// "country" (rows are partner countries). An unmapped value passes through
// lower-cased rather than being invented, so a new option is visible in the name.
const FLOW_WORD: Record<string, string> = { imports: 'import', exports: 'export' };
const VIEW_WORD: Record<string, string> = { exporter: 'country', product: 'product' };
const SOURCE_WORD: Record<string, string> = { mirror: 'mirror', direct: 'direct' };

/**
 * PURE. Derive the Phase 8 flow-aware filename tokens from the (effective) filters.
 * Added to the token map alongside the existing tokens, so today's country-first
 * templates are unaffected (they simply never reference these keys). (spec row 16)
 */
export function deriveFlowTokens(f: FlowTokenInput): Record<string, string> {
  const lc = (s: string): string => s.trim().toLowerCase();
  return {
    flowWord: FLOW_WORD[lc(f.tradeFlow)] ?? lc(f.tradeFlow),
    viewWord: VIEW_WORD[lc(f.viewBy)] ?? lc(f.viewBy),
    timeWord: lc(f.frequency),
    sourceWord: SOURCE_WORD[lc(f.source)] ?? lc(f.source),
    // Phase 9: the product-detail level for the filename (spec: name must carry the granularity so
    // an HS6 file and an NTL file for the same country/range never collide). byProduct → 'NTL'/'HS6'/…
    // (kept UPPER-cased, they are acronyms); byPartner has no detail → 'AllProducts'.
    detailWord: f.detail && f.detail.trim() ? f.detail.trim().toUpperCase() : 'AllProducts',
  };
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
