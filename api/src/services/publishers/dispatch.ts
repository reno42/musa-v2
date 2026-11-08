/**
 * Musa Publisher — envío por destino.
 * · Live-gate de 2 candados: PUBLISH_LIVE=1 en el servidor Y mode='live' en el pedido.
 *   Si falta uno, los destinos quedan skipped_dry_run y no sale ningún fetch a una red.
 * · Fan-out independiente: cada destino tiene su estado; el fallo de uno no toca a los demás.
 * · Sin disparos automáticos: esto corre cuando la persona aprieta Publicar o Reintentar.
 * · En tandas: cada pedido gasta hasta BUDGET llamadas externas (plan gratis de Workers: 50)
 *   y deja el resto en cola; el navegador pide la siguiente tanda (/jobs/:id/run) hasta terminar.
 *   Así una agencia publica en decenas de cuentas de sus clientes de una vez.
 * · Idempotencia: un destino se «toma» con locked_at; otro pedido no lo vuelve a enviar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getProvider, appKeyOf } from "./index.js";
import { open, seal } from "./crypto.js";
import { ProviderError, type PublisherAccount, type Tokens } from "./types.js";

export const MAX_ATTEMPTS = 5;
const LOCK_MS = 2 * 60 * 1000;
/** Llamadas externas por pedido (Supabase incluido), con margen bajo el tope de 50. */
const BUDGET = 40;
/** Llamadas a Supabase por destino (tomar, leer cuenta, guardar resultado). */
const DB_PER_TARGET = 3;

export function liveEnabled() {
  return String(process.env.PUBLISH_LIVE || "") === "1";
}

export async function appFor(sb: SupabaseClient, workspaceId: string, provider: string) {
  const p = getProvider(provider);
  const key = p ? appKeyOf(p) : provider;
  const { data } = await sb.from("publisher_oauth_apps").select("client_id, client_secret_encrypted").eq("workspace_id", workspaceId).eq("provider", key).maybeSingle();
  if (!data) return null;
  return { clientId: data.client_id as string, clientSecret: await open(data.client_secret_encrypted) };
}

/** Descifra la cuenta y renueva el token si vence en menos de 5 min. */
export async function loadAccount(sb: SupabaseClient, row: any, opts: { forceRefresh?: boolean } = {}): Promise<PublisherAccount> {
  const provider = getProvider(row.provider);
  if (!provider) throw new ProviderError(`Red desconocida: ${row.provider}`);
  let tokens: Tokens = { accessToken: (await open(row.access_token_encrypted)) || "", refreshToken: await open(row.refresh_token_encrypted), expiresAt: row.expires_at };
  const soon = tokens.expiresAt && new Date(tokens.expiresAt).getTime() < Date.now() + 5 * 60 * 1000;
  if (provider.refresh && (soon || opts.forceRefresh) && (tokens.refreshToken || provider.id === "threads")) {
    const app = await appFor(sb, row.workspace_id, row.provider);
    if (!app) throw new ProviderError("Falta la app de developer de esta red: vuelve a configurarla", true);
    try {
      tokens = await provider.refresh({ app, tokens });
    } catch (e: any) {
      await sb.from("publisher_accounts").update({ status: "expired", last_error: String(e?.message || e).slice(0, 500), checked_at: new Date().toISOString() }).eq("id", row.id);
      throw new ProviderError(`La conexión venció y no se pudo renovar: ${e?.message || e}`, true);
    }
    await sb.from("publisher_accounts").update({
      access_token_encrypted: await seal(tokens.accessToken),
      refresh_token_encrypted: tokens.refreshToken ? await seal(tokens.refreshToken) : row.refresh_token_encrypted,
      expires_at: tokens.expiresAt || null, status: "active", last_error: null, checked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", row.id);
  } else if (soon && tokens.expiresAt && new Date(tokens.expiresAt).getTime() < Date.now()) {
    throw new ProviderError("La conexión venció: vuelve a apretar Conectar", true);
  }
  return { id: row.id, provider: row.provider, externalId: row.external_id, displayName: row.display_name, username: row.username, options: row.options || {}, tokens };
}

/** Descarga cada imagen una sola vez por pedido y la comparte entre redes. */
function mediaCache() {
  const cache = new Map<string, Promise<Blob>>();
  return (url: string, maxBytes: number) => () => {
    if (!cache.has(url)) cache.set(url, fetch(url).then(async (r) => {
      if (!r.ok) throw new ProviderError(`No se pudo leer la imagen (${r.status})`);
      return r.blob();
    }));
    return cache.get(url)!.then((b) => {
      if (b.size > maxBytes) throw new ProviderError(`La imagen pesa ${(b.size / 1048576).toFixed(1)} MB y esta red acepta hasta ${(maxBytes / 1048576).toFixed(maxBytes < 1048576 ? 2 : 0)} MB`);
      return b;
    });
  };
}

async function finishJob(sb: SupabaseClient, jobId: string) {
  const { data: ts } = await sb.from("publish_targets").select("status").eq("job_id", jobId);
  const st = (ts || []).map((t: any) => t.status);
  const status = !st.length ? "failed"
    : st.every((s) => s === "skipped_dry_run") ? "dry-run"
    : st.some((s) => s === "queued") ? "running"
    : st.every((s) => s === "published") ? "published"
    : st.some((s) => s === "published") ? "partial" : "failed";
  await sb.from("publish_jobs").update({ status, updated_at: new Date().toISOString() }).eq("id", jobId);
  return { status, remaining: st.filter((s) => s === "queued").length };
}

/**
 * Envía una tanda de destinos pendientes de un job.
 * retry=false: solo los que están en cola. retry=true: también los que fallaron (con intentos disponibles).
 */
export async function runJob(sb: SupabaseClient, jobId: string, opts: { only?: string[]; retry?: boolean } = {}) {
  const { data: job } = await sb.from("publish_jobs").select("*").eq("id", jobId).maybeSingle();
  if (!job) throw new Error("Publicación no encontrada");
  const live = job.mode === "live" && liveEnabled();
  let q = sb.from("publish_targets").select("*").eq("job_id", jobId).in("status", opts.retry ? ["queued", "failed"] : ["queued"]).lt("attempts", MAX_ATTEMPTS).order("created_at");
  if (opts.only?.length) q = q.in("id", opts.only);
  const { data: found } = await q;
  const now = () => new Date().toISOString();
  // Reintento: todos los fallidos vuelven a la cola de una vez; si no caben en esta tanda, siguen en /run.
  const failedIds = (found || []).filter((t: any) => t.status === "failed").map((t: any) => t.id);
  if (failedIds.length) await sb.from("publish_targets").update({ status: "queued", error: null }).in("id", failedIds);
  const targets = (found || []).map((t: any) => ({ ...t, status: "queued" }));

  if (!live) {
    // Candado cerrado: nada sale a ninguna red.
    console.log(`[publisher] gate=dry-run job=${jobId} mode=${job.mode} PUBLISH_LIVE=${liveEnabled() ? 1 : 0} targets=${(targets || []).length}`);
    if (targets?.length) await sb.from("publish_targets").update({ status: "skipped_dry_run", error: null }).in("id", targets.map((t: any) => t.id));
    return finishJob(sb, jobId);
  }

  let spent = 4; // leer job, destinos, cerrar job
  const media = mediaCache();
  const captions = (job.captions || {}) as Record<string, string>;
  let sent = 0;
  for (const t of targets || []) {
    const provider = getProvider(t.provider);
    const cost = DB_PER_TARGET + (provider?.cost || 3) + 2; // +2: renovar token / bajar la imagen
    if (sent > 0 && spent + cost > BUDGET) break; // el resto, en la siguiente tanda
    spent += cost;
    const stale = new Date(Date.now() - LOCK_MS).toISOString();
    const { data: claimed } = await sb.from("publish_targets")
      .update({ locked_at: now(), attempts: (t.attempts || 0) + 1 })
      .eq("id", t.id).eq("status", "queued").or(`locked_at.is.null,locked_at.lt.${stale}`)
      .select("id");
    if (!claimed?.length) continue; // otro pedido ya lo está enviando
    sent++;
    try {
      if (!provider) throw new ProviderError(`Red desconocida: ${t.provider}`);
      const { data: row } = await sb.from("publisher_accounts").select("*").eq("id", t.account_id).maybeSingle();
      if (!row) throw new ProviderError("La cuenta ya no está conectada");
      const account = await loadAccount(sb, row);
      const small = provider.limits.maxBytes < 2 * 1048576 && job.media_small_url;
      const url = small ? job.media_small_url : job.media_url;
      const mime = small ? "image/jpeg" : job.media_mime;
      const caption = captions[t.provider] ?? job.caption ?? "";
      const res = await provider.post(account, { mediaUrl: url, mediaMime: mime, caption, media: media(url, provider.limits.maxBytes) });
      await sb.from("publish_targets").update({ status: "published", external_id: res.externalId, external_url: res.externalUrl, error: null, published_at: now(), locked_at: null }).eq("id", t.id);
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 800);
      await sb.from("publish_targets").update({ status: "failed", error: msg, locked_at: null }).eq("id", t.id);
      if (e instanceof ProviderError && e.auth && t.account_id) {
        await sb.from("publisher_accounts").update({ status: "expired", last_error: msg, checked_at: now() }).eq("id", t.account_id);
      }
    }
  }
  const r = await finishJob(sb, jobId);
  console.log(`[publisher] gate=live job=${jobId} sent=${sent} remaining=${r.remaining} status=${r.status}`);
  return r;
}
