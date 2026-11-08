/**
 * Musa Publisher — envío por destino.
 * · Live-gate de 2 candados: PUBLISH_LIVE=1 en el servidor Y mode='live' en el pedido.
 *   Si falta uno, los destinos quedan skipped_dry_run y no sale ningún fetch a una red.
 * · Fan-out independiente: cada destino tiene su estado; el fallo de uno no toca a los demás.
 * · Sin disparos automáticos: esto corre cuando la persona aprieta Publicar o Reintentar.
 * · Idempotencia: un destino se «toma» con locked_at; otro pedido no lo vuelve a enviar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getProvider } from "./index.js";
import { open, seal } from "./crypto.js";
import { ProviderError, type PublisherAccount, type Tokens } from "./types.js";

export const MAX_ATTEMPTS = 5;
const LOCK_MS = 2 * 60 * 1000;

export function liveEnabled() {
  return String(process.env.PUBLISH_LIVE || "") === "1";
}

export async function appFor(sb: SupabaseClient, workspaceId: string, provider: string) {
  const { data } = await sb.from("publisher_oauth_apps").select("client_id, client_secret_encrypted").eq("workspace_id", workspaceId).eq("provider", provider).maybeSingle();
  if (!data) return null;
  return { clientId: data.client_id as string, clientSecret: await open(data.client_secret_encrypted) };
}

/** Descifra la cuenta y renueva el token si vence en menos de 5 min. */
export async function loadAccount(sb: SupabaseClient, row: any, opts: { forceRefresh?: boolean } = {}): Promise<PublisherAccount> {
  const provider = getProvider(row.provider);
  if (!provider) throw new ProviderError(`Red desconocida: ${row.provider}`);
  let tokens: Tokens = { accessToken: (await open(row.access_token_encrypted)) || "", refreshToken: await open(row.refresh_token_encrypted), expiresAt: row.expires_at };
  const soon = tokens.expiresAt && new Date(tokens.expiresAt).getTime() < Date.now() + 5 * 60 * 1000;
  if (provider.refresh && (soon || opts.forceRefresh)) {
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
  }
  return { id: row.id, provider: row.provider, externalId: row.external_id, displayName: row.display_name, username: row.username, options: row.options || {}, tokens };
}

function mediaLoader(url: string, maxBytes: () => number) {
  let p: Promise<Blob> | null = null;
  return () => {
    if (!p) p = fetch(url).then(async (r) => {
      if (!r.ok) throw new ProviderError(`No se pudo leer la imagen (${r.status})`);
      return r.blob();
    });
    return p.then((b) => {
      if (b.size > maxBytes()) throw new ProviderError(`La imagen pesa ${(b.size / 1048576).toFixed(1)} MB y esta red acepta hasta ${(maxBytes() / 1048576).toFixed(0)} MB`);
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
  return status;
}

/** Envía los destinos pendientes (queued o failed con intentos disponibles) de un job. */
export async function runJob(sb: SupabaseClient, jobId: string, opts: { only?: string[] } = {}) {
  const { data: job } = await sb.from("publish_jobs").select("*").eq("id", jobId).maybeSingle();
  if (!job) throw new Error("Publicación no encontrada");
  const live = job.mode === "live" && liveEnabled();
  let q = sb.from("publish_targets").select("*").eq("job_id", jobId).in("status", ["queued", "failed"]).lt("attempts", MAX_ATTEMPTS);
  if (opts.only?.length) q = q.in("id", opts.only);
  const { data: targets } = await q;
  const now = () => new Date().toISOString();

  if (!live) {
    // Candado cerrado: nada sale a ninguna red.
    console.log(`[publisher] gate=dry-run job=${jobId} mode=${job.mode} PUBLISH_LIVE=${liveEnabled() ? 1 : 0} targets=${(targets || []).length}`);
    if (targets?.length) await sb.from("publish_targets").update({ status: "skipped_dry_run", error: null }).in("id", targets.map((t: any) => t.id));
    return finishJob(sb, jobId);
  }
  console.log(`[publisher] gate=live job=${jobId} targets=${(targets || []).length}`);

  let limitBytes = 5 * 1024 * 1024;
  const media = mediaLoader(job.media_url, () => limitBytes);
  // Una red a la vez (comparten la imagen descargada; el límite de tamaño es por red).
  for (const t of targets || []) {
    const stale = new Date(Date.now() - LOCK_MS).toISOString();
    const { data: claimed } = await sb.from("publish_targets")
      .update({ locked_at: now(), attempts: (t.attempts || 0) + 1 })
      .eq("id", t.id).in("status", ["queued", "failed"]).or(`locked_at.is.null,locked_at.lt.${stale}`)
      .select("id");
    if (!claimed?.length) continue; // otro pedido ya lo está enviando
    try {
      const provider = getProvider(t.provider);
      if (!provider) throw new ProviderError(`Red desconocida: ${t.provider}`);
      const { data: row } = await sb.from("publisher_accounts").select("*").eq("id", t.account_id).maybeSingle();
      if (!row) throw new ProviderError("La cuenta ya no está conectada");
      const account = await loadAccount(sb, row);
      limitBytes = provider.limits.maxBytes;
      const res = await provider.post(account, { mediaUrl: job.media_url, mediaMime: job.media_mime, caption: job.caption || "", media });
      await sb.from("publish_targets").update({ status: "published", external_id: res.externalId, external_url: res.externalUrl, error: null, published_at: now(), locked_at: null }).eq("id", t.id);
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 800);
      await sb.from("publish_targets").update({ status: "failed", error: msg, locked_at: null }).eq("id", t.id);
      if (e instanceof ProviderError && e.auth && t.account_id) {
        await sb.from("publisher_accounts").update({ status: "expired", last_error: msg, checked_at: now() }).eq("id", t.account_id);
      }
    }
  }
  return finishJob(sb, jobId);
}
