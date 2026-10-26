/**
 * Tag suggestions — REQ-061 Fase 2 («sugerencias automáticas de tags por
 * similitud de contenido»).
 * ──────────────────────────────────────────────────────────────
 * Motor PURA y determinista (cero LLM, cero costo): puntúa el vocabulario
 * existente del workspace (nubes de uso + registry workspace/global) contra
 * el contexto del archivo (nombre, tema, categoría, marca, tags actuales) y
 * la co-ocurrencia histórica del workspace. Sirve por igual a la UI
 * (chips «Sugerencias» del panel de info) y al MCP (design_tag_suggest).
 *
 * Consumidores: api/src/routes/designMeta.ts, worker/runtime/functions/mcp.mjs.
 */

export interface TagSuggestCandidate {
  /** Tag name / dotted path, normalized lowercase by the caller. */
  name: string;
  /** Times the tag appears in design_file_meta of the workspace. */
  count?: number;
  /** Registry flags — internal tags never surface as suggestions. */
  isInternal?: boolean;
  /** Parent path from the registry (sibling boost), when registered. */
  parent?: string | null;
}

export interface TagSuggestContext {
  fileName?: string | null;
  theme?: string | null;
  category?: string | null;
  brand?: string | null;
  contentKind?: string | null;
  /** Tags the file already carries — excluded from the output. */
  currentTags?: string[];
}

export interface TagSuggestOptions {
  /** Max suggestions returned (default 5). */
  limit?: number;
  /** candidate tag → how often it co-occurs with this file's seed context. */
  cooccurrence?: Map<string, number> | Record<string, number>;
}

export interface TagSuggestion {
  name: string;
  score: number;
  reasons: string[];
}

const MIN_TOKEN_LEN = 3;

/** Lowercase, strip accents, split on anything non-alphanumeric. */
export function tokenizeForTags(value: string | null | undefined): string[] {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= MIN_TOKEN_LEN);
}

/** Co-occurrence counts for a file's seed context, from the workspace's
 *  design_file_meta rows. Seeds = current tags when the file has any, else
 *  its category (cold start). Rows that share a seed contribute their other
 *  tags. Pure — the callers hand in the rows they already fetched. */
export function buildCooccurrence(
  rows: Array<{ tags?: unknown; category?: unknown }>,
  seed: { currentTags?: string[]; category?: string | null },
): Map<string, number> {
  const seedTags = (seed.currentTags || []).map(t => String(t).trim().toLowerCase()).filter(Boolean);
  const seedCategory = String(seed.category || "").trim().toLowerCase();
  const co = new Map<string, number>();
  if (!seedTags.length && !seedCategory) return co;
  for (const row of rows) {
    const rowTags = Array.isArray(row.tags) ? row.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean) : [];
    if (!rowTags.length) continue;
    const related = seedTags.length
      ? rowTags.some(t => seedTags.includes(t))
      : Boolean(seedCategory) && String(row.category || "").trim().toLowerCase() === seedCategory;
    if (!related) continue;
    for (const t of rowTags) {
      if (seedTags.includes(t)) continue;
      co.set(t, (co.get(t) || 0) + 1);
    }
  }
  return co;
}

/** Score every candidate; deterministic order (score desc, name asc). */
export function suggestTags(
  ctx: TagSuggestContext,
  candidates: TagSuggestCandidate[],
  options: TagSuggestOptions = {},
): TagSuggestion[] {
  const limit = Math.max(0, options.limit ?? 5);
  if (limit === 0) return [];
  const current = new Set((ctx.currentTags || []).map(t => String(t).trim().toLowerCase()).filter(Boolean));
  const contextTokens = new Set([
    ...tokenizeForTags(ctx.fileName),
    ...tokenizeForTags(ctx.theme),
    ...tokenizeForTags(ctx.category),
    ...tokenizeForTags(ctx.brand),
    ...tokenizeForTags(ctx.contentKind),
  ]);
  const co = options.cooccurrence instanceof Map
    ? options.cooccurrence
    : new Map(Object.entries(options.cooccurrence || {}));
  const scored: TagSuggestion[] = [];
  for (const candidate of candidates) {
    const name = String(candidate.name || "").trim().toLowerCase();
    if (!name || current.has(name) || candidate.isInternal) continue;
    const segments = name.split(".");
    let score = 0;
    const reasons: string[] = [];
    // 1. Content similarity: candidate segments vs the file's own tokens.
    const hits = [...new Set(segments)].filter(seg => contextTokens.has(seg));
    if (hits.length) {
      score += Math.min(4, hits.length * 2);
      reasons.push(`coincide con el contenido (${hits.join(", ")})`);
    }
    // 2. Sibling vocabulary: registered parent shared with a current tag.
    const parent = candidate.parent ? String(candidate.parent).toLowerCase() : null;
    if (parent) {
      const sibling = [...current].find(t => t === parent || t.startsWith(`${parent}.`));
      if (sibling) {
        score += 1.2;
        reasons.push(`hermana de "${sibling}"`);
      }
    }
    // 3. Workspace popularity (usage prior).
    const count = Number(candidate.count || 0);
    if (count > 0) {
      score += Math.min(1.5, count * 0.15);
      if (count >= 2) reasons.push(`usada en ${count} archivos`);
    }
    // 4. Co-occurrence with the file's seed context.
    const coCount = co.get(name) || 0;
    if (coCount > 0) {
      score += Math.min(3, coCount * 0.75);
      reasons.push(`suele ir con tu contexto (${coCount}×)`);
    }
    if (score > 0) scored.push({ name, score: Math.round(score * 100) / 100, reasons });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}
