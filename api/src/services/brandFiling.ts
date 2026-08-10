/**
 * Brand Filing — the pure rules deciding where a design file hangs in the
 * brand graph: which brand owns it, and which of the brand's four branches it
 * sits on.
 *
 * Kept apart from brandGraph.ts, which imports Supabase, so these can be
 * tested on their own (the same split versionDiff.ts has from
 * versionHistory.ts). QA/brand-graph-filing.test.mjs covers them.
 */

/** The branch labels a file may be filed under. Anything else means Archivos. */
export const DESIGN_SYSTEM = "Design System";
export const PLANTILLAS = "Plantillas";
export const ASSETS = "Assets";
export const ARCHIVOS = "Archivos";
export const CATEGORY_LABELS = [DESIGN_SYSTEM, PLANTILLAS, ASSETS, ARCHIVOS];

export function normalizeName(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

/**
 * Decides which brand owns each file, once, for the whole workspace.
 *
 * brand_id wins over the free-text `brand`: the text is a denormalised mirror
 * that goes stale the moment anything writes a name without resolving it, and
 * when the two disagreed the old per-brand loop filed the file under BOTH,
 * emitting `tpl:<id>` twice — duplicate ids collapse the canvas byId map and
 * hand the data table two rows with the same React key.
 */
export function resolveTemplateOwners(
  templateIds: string[],
  brands: Array<{ id: string; name: string }>,
  metaByTemplate: Map<string, { brand_id?: string | null; brand?: string | null }>,
): Map<string, string> {
  const byId = new Map(brands.map(b => [b.id, b]));
  const byName = new Map(brands.map(b => [normalizeName(b.name), b]));
  const owners = new Map<string, string>();
  for (const id of templateIds) {
    const meta = metaByTemplate.get(id);
    if (!meta) continue;
    const owner = (meta.brand_id ? byId.get(meta.brand_id) : null)
      ?? (meta.brand ? byName.get(normalizeName(meta.brand)) : null);
    if (owner) owners.set(id, owner.id);
  }
  return owners;
}

/**
 * Splits a brand's files across the four branches using the category the user
 * picked in the table (design_file_meta.category, v21). No category — every
 * row written before v21 — means Archivos, which is what this graph always
 * assumed a design file was.
 */
export function bucketByCategory<T extends { id: string }>(
  templates: T[],
  metaByTemplate: Map<string, { category?: string | null }>,
): Map<string, T[]> {
  const filed = new Map<string, T[]>(CATEGORY_LABELS.map(label => [label, [] as T[]]));
  for (const tpl of templates) {
    const stored = metaByTemplate.get(tpl.id)?.category;
    const label = stored && CATEGORY_LABELS.includes(stored) ? stored : ARCHIVOS;
    filed.get(label)!.push(tpl);
  }
  return filed;
}

/**
 * Where an asset's bytes actually live. A Content Machine run can pull photos
 * from half a dozen sites, and the difference between "this is ours now" and
 * "this still depends on someone else's server" is the thing worth being able
 * to see at a glance.
 */
export function assetOrigin(url: string | null | undefined): "bucket" | "external" | "unknown" {
  const value = (url || "").trim();
  if (!value) return "unknown";
  if (value.startsWith("/assets/")) return "bucket";          // local disk fallback
  if (/\/storage\/v1\/object\//.test(value)) return "bucket"; // Supabase Storage
  if (/^https?:\/\//i.test(value)) return "external";
  return "unknown";
}
