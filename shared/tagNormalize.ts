/**
 * Tag normalization (REQ-061) — pure helpers, zero I/O.
 * ──────────────────────────────────────────────────────────────
 * Membership lives in design_file_meta.tags TEXT[]; this module only
 * shapes inputs before persistence and resolves aliases → canonical names.
 * Consumed by the REST meta route and the MCP tools (tag_template,
 * set_file_meta) so a human chip and an AI call produce the same value.
 */

/** Lowercase, trimmed, whitespace-collapsed, ≤60 chars. Null when useless. */
export function normalizeTagInput(tag: unknown): string | null {
  const s = String(tag ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!s || s.length > 60) return null;
  return s;
}

/** Normalize a whole incoming list; dedupes; caps at 50 tags. */
export function normalizeTagList(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const t of tags) {
    const n = normalizeTagInput(t);
    if (n && !out.includes(n)) out.push(n);
    if (out.length >= 50) break;
  }
  return out;
}

/** Rows from design_tag_aliases joined with their canonical tag name. */
export interface TagAliasRow {
  alias: string;
  canonicalName: string;
}

/** alias → canonical map; later rows win (PK guarantees one per alias). */
export function buildAliasMap(rows: TagAliasRow[] | null | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const r of rows || []) {
    const a = normalizeTagInput(r.alias);
    const c = normalizeTagInput(r.canonicalName);
    if (a && c) map[a] = c;
  }
  return map;
}

/** Replace each tag through the alias map (aliases themselves are dropped). */
export function applyTagAliases(tags: string[], aliasMap: Record<string, string>): string[] {
  return tags.map(t => aliasMap[t] || t);
}
