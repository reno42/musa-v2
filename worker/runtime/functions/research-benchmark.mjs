/**
 * REQ-075 — Research: benchmark de competidores (IG profiles + Meta Ad Library).
 *
 * Dos caminos por diseño (honestidad > promesas):
 *   1. RUN server-side best-effort: IG expone un endpoint público de perfil
 *      (web_profile_info) que a veces acepta llamadas sin login desde el
 *      worker; si IG lo bloquea (bloqueo a datacenter IPs, 401/429), el
 *      resultado lo dice y entrega el runbook de importación.
 *   2. IMPORT: los scrapers OSS (insta-dl/instaloader/gallery-dl para perfiles,
 *      2scraper/facebook-ads-scraper para el Ad Library — público por ley)
 *      corren donde el usuario quiera y el JSON resultante entra por
 *      research_benchmark_import → ranking por engagement → tarjetas en
 *      research_items (el mismo pane de Research que los feeds RSS).
 *
 * Por qué tarjetas y no una tabla aparte de resultados: el pane de Research
 * ya tiene el ciclo completo (tarjeta → encargo → pieza). Un post ganador de
 * un competidor ES una tarjeta: el agente la convierte en encargo y replica
 * el hook con los tokens de la marca del workspace.
 *
 * Tenancy: misma disciplina que los cases research_* — cliente Supabase del
 * módulo + filtro explícito .eq("workspace_id", …) en TODA lectura/escritura.
 */

import { createHash } from "node:crypto";

const IG_APP_ID = "936619743392459"; // web app id público de instagram.com
const UA_BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const TIMEOUT_MS = 25_000;

export const BENCHMARK_KINDS = ["ig_profile", "meta_ads"];

export function linkHash(link) {
  return createHash("sha256").update(String(link)).digest("hex").slice(0, 32);
}

/* ── Scrape best-effort de un perfil IG (endpoint público web_profile_info) ── */
export async function scrapeIgProfile(username) {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
  const resp = await fetch(url, {
    headers: {
      "User-Agent": UA_BROWSER,
      "x-ig-app-id": IG_APP_ID,
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined,
  });
  if (!resp.ok) {
    return {
      ok: false,
      httpStatus: resp.status,
      reason: resp.status === 401 || resp.status === 403 || resp.status === 429
        ? "IG_BLOCKED_FROM_SERVER: Instagram bloquea IPs de datacenter. Usa el camino de importación (runbook en la respuesta)."
        : `IG_HTTP_${resp.status}`,
    };
  }
  const data = await resp.json().catch(() => null);
  const user = data?.data?.user;
  if (!user) return { ok: false, httpStatus: 200, reason: "IG_EMPTY: la respuesta no trajo user (perfil privado o inexistente)." };
  const edges = user.edge_owner_to_timeline_media?.edges || [];
  const followers = user.edge_followed_by?.count || 0;
  const posts = edges.map((e) => {
    const n = e.node || {};
    const likes = n.edge_liked_by?.count ?? n.edge_media_preview_like?.count ?? 0;
    const comments = n.edge_media_to_comment?.count ?? 0;
    const views = n.video_view_count ?? null;
    return {
      id: n.shortcode,
      url: `https://www.instagram.com/p/${n.shortcode || ""}/`,
      username,
      caption: (n.edge_media_to_caption?.edges?.[0]?.node?.text || "").slice(0, 1200),
      likes,
      comments,
      views,
      imageUrl: n.thumbnail_src || n.display_url || null,
      isVideo: n.is_video === true,
      takenAt: n.taken_at_timestamp ? new Date(n.taken_at_timestamp * 1000).toISOString() : null,
    };
  });
  return {
    ok: true,
    profile: {
      username,
      followers,
      fullName: user.full_name || null,
      category: user.category_name || null,
      isPrivate: user.is_private === true,
    },
    posts: rankPosts(posts, followers),
  };
}

/* ── Ranking: engagement normalizado por seguidores ──
   score = (likes + 4×comments + views/10) / max(1, followers)
   Los comentarios pesan 4× (señal más fuerte que un like); las vistas entran
   amortiguadas. Sin seguidores conocidos (import de ads) usa la mediana de
   likes del set como denominador — ranking RELATIVO dentro del propio set. */
export function rankPosts(posts, followers) {
  const clean = (posts || []).filter((p) => p && (p.url || p.id));
  if (!clean.length) return [];
  const likeList = clean.map((p) => Number(p.likes) || 0).sort((a, b) => a - b);
  const medianLikes = likeList[Math.floor(likeList.length / 2)] || 1;
  const denom = Math.max(1, Number(followers) > 0 ? Number(followers) : medianLikes);
  return clean
    .map((p) => ({
      ...p,
      engagementScore: Math.round(((Number(p.likes) || 0) + 4 * (Number(p.comments) || 0) + (Number(p.views) || 0) / 10) / denom * 10000) / 10000,
    }))
    .sort((a, b) => b.engagementScore - a.engagementScore);
}

/* ── Normalizadores de los formatos JSON de los repos OSS ── */
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const txt = (v, cap = 1200) => (v == null ? "" : String(v)).slice(0, cap);

/** Acepta filas de insta-dl / instaloader JSON, gallery-dl y 2scraper ads. */
export function normalizeImportRows(rawRows) {
  const out = [];
  for (const r of rawRows || []) {
    if (!r || typeof r !== "object") continue;
    const g = (...keys) => { for (const k of keys) { if (r[k] != null && r[k] !== "") return r[k]; } return null; };
    const id = g("shortcode", "id", "ad_archive_id", "adArchiveId", "post_id");
    const url = g("url", "link", "post_url", "adLibraryUrl", "ad_library_url") ||
      (id ? `https://www.instagram.com/p/${id}/` : null);
    if (!url) continue;
    const caption = txt(g("caption", "description", "body", "content", "ad_creative_body", "title"));
    const likes = num(g("likes", "like_count", "edge_liked_by_count", "favorites", "likes_count"));
    const comments = num(g("comments", "comment_count", "comments_count"));
    const views = num(g("views", "view_count", "video_view_count", "plays", "impressions", "impressions__lower"));
    const image = g("imageUrl", "image_url", "display_url", "thumbnail", "video_preview_image_url", "video_preview_images") ||
      (typeof g("media") === "object" && r.media?.[0]?.display_url) || null;
    out.push({
      id: txt(id, 80) || linkHash(url),
      url: String(url),
      username: txt(g("username", "page_name", "pageName", "owner_username", "profile"), 80) || null,
      caption,
      likes: likes ?? 0,
      comments: comments ?? 0,
      views,
      imageUrl: image,
      isVideo: Boolean(g("video_url", "is_video")) || /video|mp4/i.test(String(g("media_type", "type") || "")),
      takenAt: g("taken_at", "date_utc", "start_date", "created_at", "timestamp") || null,
    });
  }
  return out;
}

/* ── Tarjetas → research_items (el pane existente) ──
   Máx N por corrida (default 10): el pane es para DECIDIR, no un dump. */
export async function writeBenchmarkCards(sb, { workspaceId, label, kind, target, posts, limit = 10 }) {
  const top = (posts || []).slice(0, Math.max(1, Math.min(Number(limit) || 10, 30)));
  if (!top.length) return { inserted: 0, cards: [] };
  const now = new Date().toISOString();
  const rows = top.map((p) => ({
    workspace_id: workspaceId,
    source_id: null,
    title: `${label || target}: ${p.caption ? p.caption.slice(0, 80) : (p.isVideo ? "video" : "post")}`.slice(0, 300),
    summary: [
      `Score ${p.engagementScore ?? "?"}`,
      p.likes != null ? `${p.likes} likes` : null,
      p.comments != null ? `${p.comments} comentarios` : null,
      p.views != null ? `${p.views} vistas` : null,
      p.username ? `@${p.username}` : null,
      kind === "meta_ads" ? "ad activo/pasado" : null,
    ].filter(Boolean).join(" · ").slice(0, 2000),
    link: p.url,
    link_hash: linkHash(`benchmark:${workspaceId}:${p.url}`),
    image_url: p.imageUrl || null,
    author: p.username ? `@${p.username}` : null,
    source_name: `Benchmark ${kind === "meta_ads" ? "Ads" : "IG"}: ${label || target}`,
    published_at: p.takenAt || now,
  }));
  const { data, error } = await sb.from("research_items")
    .upsert(rows, { onConflict: "workspace_id,link_hash", ignoreDuplicates: true })
    .select("id, title, link");
  if (error) throw new Error(`research_items upsert falló: ${error.message}`);
  return { inserted: (data || []).length, cards: data || [] };
}

/** Runbook de importación — la vía robusta cuando el scrape server-side está bloqueado. */
export function importRunbook(kind, target) {
  if (kind === "meta_ads") {
    return {
      recommended: "2scraper/facebook-ads-scraper (MIT, sin login — el Ad Library es público por ley)",
      install: "git clone https://github.com/2scraper/facebook-ads-scraper && pip install -r requirements.txt && playwright install chromium",
      run: `python playwright_scraper.py --query "${target || "marca competidora"}" --country PE --output ads.json`,
      also: "athm793/meta-ads-scraper (Apache-2.0, workbench con SQLite local) · lucasgrow/ads-library-scraper (un comando → report.md)",
      then: "research_benchmark_import { kind:'meta_ads', rows:<contenido de ads.json> }",
    };
  }
  return {
    recommended: "subzeroid/insta-dl (backend HikerAPI = sin riesgo de ban, o aiograpi con cuenta descartable)",
    install: "pipx install instagram-dl  # + export HIKERAPI_TOKEN=…",
    run: `insta-dl --backend hiker --dest ./out ${target || "usuario_competidor"}  # sidecars JSON por post`,
    also: "instaloader/instaloader (gratis, batte-tested, quema la cuenta si vas agresivo) · gallery-dl (multi-red)",
    then: "Pega los JSON sidecar en un array y llamar research_benchmark_import { kind:'ig_profile', rows:[…] }",
  };
}
