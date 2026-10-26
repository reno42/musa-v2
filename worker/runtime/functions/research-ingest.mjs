// REQ-051 — Research ingestion (Copywriting / Research).
//
// Reads due research_sources (RSS or Nitter feed URLs), filters items by the
// source's include/exclude keywords, dedupes by link hash per workspace and
// stores the rest as research_items cards. Runs from two doors:
//   - the 5-min Worker cron (sweep of due sources — RESEARCH_INGEST_ENABLED
//     kill switch, same contract as the webhook dispatch sweep), and
//   - research_refresh_sources (manual refresh, the pane's button and the
//     MCP tool).
//
// Feeds are fetched with the SAME guarded fetch the flows engine uses
// (flows-sources.mjs) — HTTPS-only, SSRF-guarded, size-limited.
//
// The encargo briefing (buildResearchBriefing) also lives here: REST and MCP
// build the exact same text, so the bandeja the user's AI polls is identical
// no matter which door created the request.

import { createHash, randomBytes } from "node:crypto";
import { fetchNitterArticles, fetchRssArticles } from "./flows-sources.mjs";
import {
  isResearchFormat,
  isResearchNetwork,
  RESEARCH_FORMATS,
  RESEARCH_NETWORKS,
} from "../../../shared/researchNetworks.ts";

// Freemium caps — a research workspace stays small by design; the pane is a
// reading queue, not an archive.
export const RESEARCH_LIMITS = {
  maxSourcesPerWorkspace: 12,
  maxItemsPerIngest: 30,      // new cards per source per run
  maxItemsPerWorkspace: 200,  // prune target
  itemRetentionDays: 30,      // non-used items older than this are pruned
  minRefreshMinutes: 30,      // per-source floor (also a DB CHECK)
  sweepPerTick: 25,           // max sources refreshed per cron tick
  requestTtlMinutes: 240,     // encargo expiry — same default as the waits (REQ-042)
};

/** Capability token for research_ai_complete — same idiom as the flow resume
 *  tokens (`rw_` + base36 randoms), with the request's own prefix. */
export function newResumeToken() {
  const bytes = randomBytes(16);
  return "rrq_" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 24);
}

/** Lowercase, trimmed, deduped keyword list (cap 20 × 60 chars). */
export function normalizeKeywords(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value.map((k) => String(k ?? "").trim().toLowerCase()).filter(Boolean),
  )].slice(0, 20).map((k) => k.slice(0, 60));
}

/** Pure editorial filter: include (ANY match, empty = pass all) then exclude
 *  (ANY match drops). Matching is substring over title+summary, lowercase —
 *  the same semantics the DB column comments document. */
export function articlePassesFilters(article, includeKeywords, excludeKeywords) {
  const text = `${article.title || ""} ${article.summary || ""}`.toLowerCase();
  if (includeKeywords.length && !includeKeywords.some((k) => text.includes(k))) return false;
  if (excludeKeywords.some((k) => text.includes(k))) return false;
  return true;
}

/** Dedupe key: sha256 of the normalized link. Same link via two feeds (or two
 *  runs) is ONE card — enforced by UNIQUE(workspace_id, link_hash) too. */
export function linkHash(link) {
  return createHash("sha256").update(String(link ?? "").trim()).digest("hex");
}

/**
 * Fetch one source and store its new items. Returns { added, total }.
 * Throws on fetch failure — callers decide whether that marks the source
 * errored (sweep / refresh do) or aborts (create_source validation).
 */
export async function ingestSource(sb, source, {
  fetchRss = fetchRssArticles,
  fetchNitter = fetchNitterArticles,
  now = new Date(),
} = {}) {
  const config = {
    url: source.url,
    label: source.name,
    limit: RESEARCH_LIMITS.maxItemsPerIngest,
    includeReposts: false,
  };
  const fetcher = source.type === "nitter" ? fetchNitter : fetchRss;
  const articles = await fetcher(config);

  const include = normalizeKeywords(source.include_keywords);
  const exclude = normalizeKeywords(source.exclude_keywords);
  const rows = [];
  const seen = new Set();
  for (const article of articles) {
    if (!article.title || !article.link) continue;
    if (!articlePassesFilters(article, include, exclude)) continue;
    const hash = linkHash(article.link);
    if (seen.has(hash)) continue;
    seen.add(hash);
    rows.push({
      workspace_id: source.workspace_id,
      source_id: source.id,
      title: String(article.title).slice(0, 300),
      summary: article.summary ? String(article.summary).slice(0, 2000) : null,
      link: String(article.link),
      link_hash: hash,
      image_url: article.imageUrl ? String(article.imageUrl) : null,
      author: article.author || article.creator || null,
      source_name: article.source || source.name,
      published_at: article.publishedAt || now.toISOString(),
    });
    if (rows.length >= RESEARCH_LIMITS.maxItemsPerIngest) break;
  }

  let added = 0;
  if (rows.length) {
    // ignoreDuplicates: the UNIQUE(workspace_id, link_hash) drops links the
    // workspace already has; the representation returns only the NEW rows.
    const { data, error } = await sb.from("research_items")
      .upsert(rows, { onConflict: "workspace_id,link_hash", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`research_items insert falló: ${error.message}`);
    added = (data || []).length;
  }

  await sb.from("research_sources").update({
    last_fetched_at: now.toISOString(),
    last_status: "ok",
    last_error: null,
    updated_at: now.toISOString(),
  }).eq("id", source.id);

  return { added, total: articles.length };
}

/** Mark a failed fetch without throwing — the sweep must survive one dead feed. */
async function markSourceError(sb, source, error, now) {
  try {
    await sb.from("research_sources").update({
      last_fetched_at: now.toISOString(),
      last_status: "error",
      last_error: String(error?.message || error || "error").slice(0, 500),
      updated_at: now.toISOString(),
    }).eq("id", source.id);
  } catch { /* diagnostics are best-effort */ }
}

/** Prune old, unattended items so a busy workspace stays under the cap.
 *  Items with requests (or 'used') are NEVER pruned: they are the provenance
 *  of content the calendar already links to (and the FK cascades would take
 *  the request history with them). */
export async function pruneWorkspaceItems(sb, workspaceId, { now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - RESEARCH_LIMITS.itemRetentionDays * 86_400_000).toISOString();
  const [refs, old] = await Promise.all([
    sb.from("research_requests").select("item_id").eq("workspace_id", workspaceId).limit(1000),
    sb.from("research_items").select("id, status").eq("workspace_id", workspaceId)
      .lt("created_at", cutoff).order("created_at", { ascending: true }).limit(1000),
  ]);
  const protectedIds = new Set((refs.data || []).map((r) => r.item_id));
  const deletable = (old.data || [])
    .filter((r) => r.status !== "used" && !protectedIds.has(r.id))
    .map((r) => r.id);
  if (deletable.length) await sb.from("research_items").delete().in("id", deletable);
  return { pruned: deletable.length };
}

/**
 * Sweep: every active source whose refresh window elapsed (or that was never
 * fetched). Per-source errors mark the source and continue — one dead feed
 * never takes down the tick. `forceSourceIds` (refresh manual) bypasses the
 * due filter for exactly those sources. `workspaceId` scopes the sweep to a
 * single workspace (manual refresh); the cron omits it for the global pass.
 */
export async function ingestDueSources(sb, { now = new Date(), forceSourceIds = null, workspaceId = null } = {}) {
  let q = sb.from("research_sources").select("*").eq("active", true);
  if (workspaceId) q = q.eq("workspace_id", workspaceId);
  // Coarse DB-side filter: nothing refreshed in the last minRefreshMinutes
  // can be due (the per-source refresh_minutes floor is also 30).
  const coarseCutoff = new Date(now.getTime() - RESEARCH_LIMITS.minRefreshMinutes * 60_000).toISOString();
  q = q.or(`last_fetched_at.is.null,last_fetched_at.lte.${coarseCutoff}`);
  if (Array.isArray(forceSourceIds) && forceSourceIds.length) {
    q = q.in("id", forceSourceIds.map((id) => String(id)));
  }
  q = q.order("last_fetched_at", { ascending: true, nullsFirst: true })
    .limit(Array.isArray(forceSourceIds) ? RESEARCH_LIMITS.maxSourcesPerWorkspace : RESEARCH_LIMITS.sweepPerTick);
  const { data: sources, error } = await q;
  if (error) throw new Error(`research_sources read falló: ${error.message}`);

  let refreshed = 0;
  let added = 0;
  const errors = [];
  for (const source of sources || []) {
    const last = source.last_fetched_at ? Date.parse(source.last_fetched_at) : 0;
    const dueMs = (Number(source.refresh_minutes) || 60) * 60_000;
    const isDue = now.getTime() - last >= dueMs;
    const forced = Array.isArray(forceSourceIds) && forceSourceIds.includes(source.id);
    if (!isDue && !forced) continue;
    try {
      const result = await ingestSource(sb, source, { now });
      refreshed += 1;
      added += result.added;
      if (result.added > 0) await pruneWorkspaceItems(sb, source.workspace_id, { now });
    } catch (error) {
      await markSourceError(sb, source, error, now);
      errors.push({ sourceId: source.id, name: source.name, error: String(error?.message || error).slice(0, 200) });
    }
  }
  return { due: (sources || []).length, refreshed, added, errors };
}

// ── El briefing del encargo («un click») ────────────────────────────────────
// Contrato espejo de ai_task (REQ-042): el texto ES la tarea. La IA del
// usuario lo descubre con research_ai_tasks, trabaja con TODAS las tools de
// Musa (nada de proveedores server-side) y entrega con research_ai_complete.
// Este texto lo construyen igual REST y MCP — una sola fuente.

/** Validation error raised by normalizeRequestArgs — REST maps it to 400,
 *  MCP maps it to -32602 (invalid params). */
export class ResearchArgsError extends Error {}

/**
 * Shared validation for the encargo args, used by BOTH doors (REST
 * POST /api/research/requests and MCP research_create_request) so they can
 * never disagree on what a valid request is. `brandId` is trimmed here but
 * must be validated against the workspace's brands by the caller (needs DB).
 */
export function normalizeRequestArgs(args) {
  const raw = args && typeof args === "object" ? args : {};
  const invalid = (msg) => { throw new ResearchArgsError(msg); };

  const pickIds = (value, isKnown, label, validIds) => {
    if (!Array.isArray(value)) invalid(`${label} es obligatorio: array de ids (${validIds.join(", ")})`);
    const picked = [...new Set(value.map((v) => String(v ?? "").trim().toLowerCase()).filter(Boolean))];
    const unknown = picked.filter((v) => !isKnown(v));
    if (unknown.length) invalid(`${label} desconocida(s): ${unknown.join(", ")}. Válidas: ${validIds.join(", ")}`);
    if (!picked.length) invalid(`${label} es obligatorio: al menos un id (${validIds.join(", ")})`);
    return picked;
  };

  const networks = pickIds(
    raw.networks, isResearchNetwork, "networks",
    RESEARCH_NETWORKS.map((n) => n.id),
  );
  const formats = pickIds(
    raw.formats, isResearchFormat, "formats",
    RESEARCH_FORMATS.map((f) => f.id),
  );

  const notesRaw = String(raw.notes ?? "").trim();
  const dateRaw = String(raw.scheduledDate ?? "").trim();
  if (dateRaw && !/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
    invalid("scheduledDate debe tener formato YYYY-MM-DD");
  }

  return {
    networks,
    formats,
    includeDesign: raw.includeDesign === true || raw.includeDesign === "true",
    brandId: String(raw.brandId ?? "").trim() || null,
    notes: notesRaw ? notesRaw.slice(0, 2000) : null,
    scheduledDate: dateRaw || null,
  };
}

export function buildResearchBriefing({
  item,
  networks,
  formats,
  includeDesign,
  brandName = null,
  notes = null,
  scheduledDate = null,
  resumeToken,
  sourceName = null,
}) {
  const networkLines = RESEARCH_NETWORKS
    .filter((n) => networks.includes(n.id))
    .map((n) => `   - ${n.id}: ${n.note}`)
    .join("\n");
  const formatLines = RESEARCH_FORMATS
    .filter((f) => formats.includes(f.id))
    .map((f) => `   - ${f.id} (${f.width}x${f.height}): ${f.note}`)
    .join("\n");

  return `[Encargo Research] Convierte esta noticia en contenido para redes sociales.

NOTICIA
Título: ${item.title}
${item.summary ? `Resumen: ${item.summary}\n` : ""}Enlace: ${item.link}
${item.image_url ? `Imagen: ${item.image_url}\n` : ""}Fuente: ${sourceName || item.source_name || "research"}
${item.published_at ? `Publicada: ${item.published_at}\n` : ""}
QUÉ PRODUCIR: un copy nativo por cada red × formato${includeDesign ? " + su diseño" : ""}.
Redes:
${networkLines}
Formatos:
${formatLines}

PASOS
1. Contexto ANTES de redactar: si la marca es "${brandName || "(sin marca — usa el tono general del workspace)"}", lee su design system / brand guideline; lee list_copy_recipes y aplica las recetas que apliquen (menciona cuáles en notes).
2. Redacta un copy nativo de CADA red elegida — no repitas el mismo texto. Gancho, cuerpo, CTA y hashtags según la red; el gancho sirve de topic.
3. Crea UNA entrada de calendario por pieza: add_content_idea { scheduledDate: "${scheduledDate || "(hoy)"}", topic: gancho, channels: [red], campaign: "research", notes: referencia del encargo } y luego update_content con el copy completo y status "diseño". NO publiques (publish_content no): todo queda como borrador para revisión humana.
${includeDesign
    ? `4. Diseña cada pieza: busca la plantilla maestra del workspace para el formato (list_templates) y clónala con duplicate_template llenando el contenido con las tools de frames; si no hay maestra, créala desde cero con el design system de la marca (${RESEARCH_FORMATS.filter((f) => formats.includes(f.id)).map((f) => `${f.id} ${f.width}x${f.height}`).join(", ")}). Pinea el frame en la entrada con update_content { templateId, frameId }.`
    : "4. Diseños NO: este encargo es solo copy."}
5. ENTREGA: llama research_ai_complete { resumeToken: "${resumeToken}", payload: { entries: [{ entryId, network, format${includeDesign ? ", templateId, frameId" : ""} }, ...], notes } } — payload es un OBJETO con el array "entries" anidado; entryId es el id de cada entrada creada. Si falta "entries" el payload es RECHAZADO: corrige y reintenta con el MISMO token.
${notes ? `\nNOTAS DEL HUMANO: ${notes}\n` : ""}
Si una red falla, continúa con las demás y explícalo en notes. Escribir en Musa exige cuidado con los ids: verifica cada entrada con list_calendar_entries antes de entregar.`;
}
