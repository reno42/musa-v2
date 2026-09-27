/**
 * Content Calendar API — one row per piece of content.
 *
 * GET    /api/content?workspaceId=&from=&to=   list, optionally windowed
 * POST   /api/content                          create
 * PATCH  /api/content/:id                      update one field or many
 * DELETE /api/content/:id                      remove
 *
 * Paid and organic share every dimension except spend, so they are one table
 * told apart by `kind`. campaign and ad_set are optional throughout: a post
 * with neither is still a post, and inventing a placeholder would erase the
 * difference between planned work and loose work — the same rule the brand
 * graph follows.
 */

import { Router } from "express";
import { asyncRoute } from "../middleware/asyncRoute.js";
import { getSupabase, getSupabaseAdmin } from "../services/supabase.js";
import { canAccessWorkspace } from "../services/tenancy.js";
import {
  createSocialPublisher, listBufferAccounts, listZernioAccounts, newPublishRequestId, parseZernioWebhook, verifyZernioSignature, validateSocialAccounts, syncBufferDestinations, summarizeBufferDestinations, pickAccountsByIds,
  syncZernioInbox, replyZernioComment, replyZernioMessage,
  parseZernioInboxWebhookEvent, subscribeZernioWebhook, newZernioWebhookSecret,
  type SocialContentType, type SocialPublishMode, type ZernioAccount,
} from "../services/socialPublishing.js";
// REQ-029 Item 3: la cadena captura → timeline (match de autor + touchpoint).
import { buildCaptureInteraction, matchCapturedContact } from "../services/crmInboxCapture.js";
import { decryptWorkspaceSecret, encryptWorkspaceSecret } from "../services/secrets.js";
import { SOCIAL_CAPABILITIES, pickPublishProvider, platformToChannel, publishProviderOrder, type SocialAccountRef, type SocialProviderId } from "../../../shared/socialProviders.ts";
import { zonedDateTimeToIso } from "../../../shared/socialSchedule.ts";
import { publicSocialMediaUrl, socialMediaType } from "../../../shared/socialPublishRequest.ts";

export const contentRoutes = Router();

const KINDS = new Set(["organic", "ad"]);
const STATUSES = new Set(["idea", "diseño", "aprobación", "programado", "publicado"]);
const TIME_ZONES = new Set(["UTC", ...Intl.supportedValuesOf("timeZone")]);
const SOCIAL_PROVIDERS = new Set(["buffer", "zernio"]);
const SOCIAL_CONTENT_TYPES = new Set<SocialContentType>(["post", "story", "reel"]);

type SocialConnectionSecret = { apiKey: string; webhookSecret?: string };
type SocialConnectionConfig = {
  /** Workspace-level default: one account per platform. */
  accounts?: Record<string, string>;
  /** Per-brand destination picks: brandId → account ids. Overrides the
   *  default when the piece has a brand. */
  brandAccounts?: Record<string, string[]>;
  /** Cache of the provider's last account list — the schedule dialog's
   *  picker renders from it without a live call. Refreshed on save/test. */
  knownAccounts?: ZernioAccount[];
  isDefault?: boolean;
  /** Filled by the subscribe route: the endpoint registered on the provider
   *  (id/url/events). The signing secret lives ONLY in encrypted
   *  credentials — never here. */
  webhookId?: string | null;
  webhookUrl?: string;
  webhookEvents?: string[];
};

async function socialConnections(sb: any, workspaceId: string, provider?: string) {
  let query = sb.from("workspace_mcp_connections")
    .select("id, workspace_id, provider, enabled, public_config, credentials_encrypted")
    .eq("workspace_id", workspaceId).eq("enabled", true);
  if (provider) query = query.eq("provider", provider);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function resolveSocialConnection(
  sb: any,
  workspaceId: string,
  requestedProvider?: string,
  fallbackOrder: SocialProviderId[] = ["buffer", "zernio"],
) {
  const rows = await socialConnections(sb, workspaceId);
  const connected = rows.filter((item: any) => SOCIAL_PROVIDERS.has(item.provider) && item.credentials_encrypted);
  const row = requestedProvider
    ? connected.find((item: any) => item.provider === requestedProvider)
    // No explicit provider: the capability order decides. Buffer first so a
    // routine post spends Buffer's quota, not Zernio credits (freemium rule);
    // stories/reels arrive with a Zernio-only order.
    : fallbackOrder
      .map(id => connected.find((item: any) => item.provider === id))
      .find(Boolean);
  if (!row) {
    throw new Error(requestedProvider
      ? `Conecta ${requestedProvider === "buffer" ? "Buffer" : "Zernio"} en Configuración antes de publicar`
      : "Conecta Buffer o Zernio en Configuración antes de publicar");
  }
  const credentials = decryptWorkspaceSecret<SocialConnectionSecret>(row.credentials_encrypted);
  if (!credentials.apiKey) throw new Error(`La conexión de ${row.provider} no tiene API key`);
  return { row, credentials, config: (row.public_config || {}) as SocialConnectionConfig };
}

/** Only these can be written, and each is normalised on the way in. */
function buildPatch(body: Record<string, any>): Record<string, any> {
  const patch: Record<string, any> = {};
  const text = (v: unknown) => {
    const s = String(v ?? "").trim();
    return s === "" ? null : s;
  };

  if (body.scheduled_date !== undefined) patch.scheduled_date = text(body.scheduled_date);
  if (body.scheduled_time !== undefined) patch.scheduled_time = text(body.scheduled_time);
  if (body.topic !== undefined) patch.topic = text(body.topic);
  if (body.copy !== undefined) patch.copy = text(body.copy);
  if (body.campaign !== undefined) patch.campaign = text(body.campaign);
  if (body.ad_set !== undefined) patch.ad_set = text(body.ad_set);
  // REQ Planilla v2: la dirección (segmento, conversión esperada, formato del
  // catálogo) viaja con la pieza — la IA la lee para decidir copy y gráfico.
  if (body.icp !== undefined) patch.icp = text(body.icp);
  if (body.conversion_goal !== undefined) patch.conversion_goal = text(body.conversion_goal);
  if (body.visual_type !== undefined) patch.visual_type = text(body.visual_type);
  if (body.template_id !== undefined) patch.template_id = text(body.template_id);
  // REQ-023: the exact frame inside that file — a grid has several designs
  // side by side, and "which file" alone cannot say which one is this piece.
  if (body.frame_id !== undefined) patch.frame_id = text(body.frame_id);
  if (body.asset_id !== undefined) patch.asset_id = text(body.asset_id);
  if (body.external_url !== undefined) patch.external_url = text(body.external_url);
  if (body.permalink !== undefined) patch.permalink = text(body.permalink);
  if (body.notes !== undefined) patch.notes = text(body.notes);
  if (body.brand_id !== undefined) patch.brand_id = text(body.brand_id);
  if (body.published_at !== undefined) patch.published_at = text(body.published_at);

  // Plan and actual figures. Empty means "no plan", which is not the same as
  // zero — a projection of 0 is a promise to spend nothing, and pacing has to
  // be able to tell those apart.
  for (const key of [
    "plan_spend", "plan_impressions", "plan_reach", "plan_clicks", "plan_views",
    "actual_spend", "actual_impressions", "actual_reach", "actual_clicks", "actual_views",
  ]) {
    if (body[key] === undefined) continue;
    const raw = String(body[key] ?? "").trim();
    if (raw === "") { patch[key] = null; continue; }
    const parsed = Number(raw.replace(/[^0-9.-]/g, ""));
    patch[key] = Number.isFinite(parsed) ? parsed : null;
  }

  if (body.kind !== undefined) {
    const kind = String(body.kind || "").trim();
    patch.kind = KINDS.has(kind) ? kind : "organic";
  }
  if (body.status !== undefined) {
    const status = String(body.status || "").trim();
    patch.status = STATUSES.has(status) ? status : "idea";
  }
  if (body.channels !== undefined) {
    // Always an array, deduplicated: a channel listed twice would double-count
    // the post in every per-channel roll-up downstream.
    const list = Array.isArray(body.channels) ? body.channels : [];
    patch.channels = [...new Set(list.map((c: unknown) => String(c).trim()).filter(Boolean))];
  }
  return patch;
}

const dbOr503 = (res: any) => {
  const sb = getSupabase();
  if (!sb) { res.status(503).json({ success: false, error: "Supabase no está configurado" }); return null; }
  return sb;
};

/**
 * PostgREST answers "Could not find the table 'public.content_calendar' in the
 * schema cache" (PGRST205) when v22 has not been run. That is a setup step,
 * not a failure — surfacing it as a 500 tells the user nothing about what to
 * do, which is exactly how this shipped and exactly what it cost.
 */
export function isMissingTable(error: unknown): boolean {
  const err = error as { code?: string; message?: string } | null;
  if (err?.code === "PGRST205" || err?.code === "42P01") return true;
  const message = String(err?.message ?? "").toLowerCase();
  return message.includes("content_calendar")
    && (message.includes("schema cache") || message.includes("does not exist"));
}

const SETUP_MESSAGE =
  "Falta crear la tabla del calendario. Ejecuta supabase_migrations_v22.sql en el "
  + "proyecto de Supabase que usa producción y recarga el esquema "
  + "(Settings → API → Reload schema cache).";

/**
 * PostgREST raises 42703 when the row exists but the frame_id column does
 * not — v22 ran, v34 did not. Same shape as the missing table above: a setup
 * step, surfaced with the exact file to run, not a 500 the user stares at.
 */
export function isMissingColumn(error: unknown): boolean {
  const err = error as { code?: string; message?: string } | null;
  if (err?.code === "42703") return true;
  const message = String(err?.message ?? "").toLowerCase();
  return (message.includes("frame_id") || message.includes("publishing_"))
    && (message.includes("does not exist") || message.includes("no existe"));
}

const COLUMN_SETUP_MESSAGE =
  "Faltan columnas en content_calendar. Ejecuta las migraciones pendientes (v34, v42 y v51) "
  + "en el proyecto de Supabase que usa producción (son idempotentes, se pueden "
  + "re-ejecutar) y recarga el esquema (Settings → API → Reload schema cache).";

/** Wraps a handler so a missing table or column reads as setup, with the step. */
function withSetupCheck(fn: (req: any, res: any) => Promise<unknown>) {
  return asyncRoute(async (req: any, res: any) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (isMissingTable(err)) {
        return res.status(503).json({ success: false, error: SETUP_MESSAGE, setupRequired: true });
      }
      if (isMissingColumn(err)) {
        return res.status(503).json({ success: false, error: COLUMN_SETUP_MESSAGE, setupRequired: true });
      }
      throw err;
    }
  });
}

contentRoutes.get("/integrations/social", asyncRoute(async (req, res) => {
  const workspaceId = String(req.query.workspaceId || "");
  if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
  if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "viewer"))) return res.status(403).json({ success: false, error: "Workspace access is required" });
  const sb = getSupabaseAdmin() || getSupabase();
  if (!sb) return res.status(503).json({ success: false, error: "Supabase no está configurado" });
  const rows = await socialConnections(sb, workspaceId);
  const social = rows.filter((row: any) => SOCIAL_PROVIDERS.has(row.provider));
  const connected = social.filter((row: any) => row.credentials_encrypted).map((row: any) => row.provider);
  res.json({
    success: true,
    // The provider the routing policy would pick right now — the UI badges it.
    publishProvider: pickPublishProvider(connected),
    data: social.map((row: any) => ({
      id: row.id, provider: row.provider, enabled: row.enabled, hasCredentials: Boolean(row.credentials_encrypted),
      accounts: row.public_config?.accounts || {}, isDefault: Boolean(row.public_config?.isDefault),
      brandAccounts: row.public_config?.brandAccounts || {},
      knownAccounts: row.public_config?.knownAccounts || [],
      webhookUrl: row.provider === "zernio" ? `/api/content/webhooks/zernio/${row.id}` : null,
      capabilities: SOCIAL_CAPABILITIES[row.provider as SocialProviderId] ?? null,
    })),
  });
}));

contentRoutes.put("/integrations/social/:provider", asyncRoute(async (req, res) => {
  const provider = String(req.params.provider || "").toLowerCase();
  const workspaceId = String(req.body.workspaceId || "");
  if (!SOCIAL_PROVIDERS.has(provider)) return res.status(400).json({ success: false, error: "Proveedor inválido" });
  if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
  if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "admin"))) return res.status(403).json({ success: false, error: "Admin access is required" });
  const apiKey = String(req.body.apiKey || "").trim();
  const webhookSecret = String(req.body.webhookSecret || "").trim();
  const sb = getSupabaseAdmin() || getSupabase();
  if (!sb) return res.status(503).json({ success: false, error: "Supabase no está configurado" });
  const existing = (await socialConnections(sb, workspaceId, provider))[0];
  // An update that omits accounts (saving a key from the Conexiones popover,
  // or persisting brand defaults) keeps the saved mapping — defaulting to {}
  // here silently disconnected every configured account.
  let accounts: Record<string, string> = req.body.accounts && typeof req.body.accounts === "object" && !Array.isArray(req.body.accounts)
    ? req.body.accounts
    : ((existing?.public_config as SocialConnectionConfig | null)?.accounts || {});
  let credentials: SocialConnectionSecret;
  if (apiKey) credentials = { apiKey, ...(webhookSecret ? { webhookSecret } : {}) };
  else if (existing?.credentials_encrypted) {
    credentials = decryptWorkspaceSecret<SocialConnectionSecret>(existing.credentials_encrypted);
    if (webhookSecret) credentials.webhookSecret = webhookSecret;
  } else return res.status(400).json({ success: false, error: "Ingresa la API key" });
  const brandAccountsIn = req.body.brandAccounts !== undefined;
  let available: ZernioAccount[] = [];
  let brandAccounts: Record<string, string[]> = {};
  try {
    available = provider === "buffer" ? await listBufferAccounts(credentials.apiKey) : await listZernioAccounts(credentials.apiKey);
    accounts = validateSocialAccounts(accounts, available);
    if (brandAccountsIn) {
      // Per-brand MERGE: the UI (and the MCP tool) save one brand at a time
      // ("Guardar como destinos predeterminados de {marca}"), so replacing
      // the whole map would erase every OTHER brand's saved defaults. Brands
      // present in the payload are revalidated — ids the provider no longer
      // knows are dropped and [] clears that brand — while brands absent
      // from the payload keep their saved mapping untouched.
      const byId = new Map(available.map(account => [account.id, account]));
      const saved = (existing?.public_config as SocialConnectionConfig | null)?.brandAccounts || {};
      brandAccounts = { ...saved };
      const incoming = req.body.brandAccounts && typeof req.body.brandAccounts === "object" && !Array.isArray(req.body.brandAccounts)
        ? req.body.brandAccounts as Record<string, unknown>
        : {};
      for (const [brandId, ids] of Object.entries(incoming)) {
        if (!brandId) continue;
        const valid = (Array.isArray(ids) ? ids : []).map(id => String(id ?? "").trim()).filter(id => id && byId.has(id));
        if (valid.length > 0) brandAccounts[brandId] = [...new Set(valid)];
        else delete brandAccounts[brandId];
      }
    } else {
      brandAccounts = (existing?.public_config as SocialConnectionConfig | null)?.brandAccounts || {};
    }
  } catch (error) {
    return res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Cuentas inválidas" });
  }
  const isDefault = req.body.isDefault !== false;
  if (isDefault) {
    const others = await socialConnections(sb, workspaceId);
    for (const other of others.filter((row: any) => SOCIAL_PROVIDERS.has(row.provider))) {
      const { error } = await sb.from("workspace_mcp_connections").update({ public_config: { ...(other.public_config || {}), isDefault: false } }).eq("id", other.id).eq("workspace_id", workspaceId);
      if (error) throw error;
    }
  }
  const record = {
    workspace_id: workspaceId, name: provider === "zernio" ? "Zernio" : "Buffer", kind: "mcp", provider,
    endpoint_url: provider === "zernio" ? "https://zernio.com/api/v1" : "https://api.buffer.com", enabled: true,
    public_config: { accounts, brandAccounts, knownAccounts: available, isDefault },
    credentials_encrypted: encryptWorkspaceSecret(credentials), updated_at: new Date().toISOString(),
  };
  const result = existing
    ? await sb.from("workspace_mcp_connections").update(record).eq("id", existing.id).eq("workspace_id", workspaceId).select("id").single()
    : await sb.from("workspace_mcp_connections").insert({ ...record, created_by: req.auth.userId }).select("id").single();
  if (result.error) throw result.error;
  res.json({ success: true, data: { id: result.data.id, provider, accounts, brandAccounts, isDefault, hasCredentials: true } });
}));

contentRoutes.delete("/integrations/social/:provider", asyncRoute(async (req, res) => {
  const provider = String(req.params.provider || "").toLowerCase();
  const workspaceId = String(req.body.workspaceId || "");
  if (!workspaceId || !SOCIAL_PROVIDERS.has(provider)) return res.status(400).json({ success: false, error: "Workspace o proveedor inválido" });
  if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "admin"))) return res.status(403).json({ success: false, error: "Admin access is required" });
  const sb = getSupabaseAdmin() || getSupabase();
  if (!sb) return res.status(503).json({ success: false, error: "Supabase no está configurado" });
  const { error } = await sb.from("workspace_mcp_connections")
    .update({ enabled: false, credentials_encrypted: null, public_config: {}, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId).eq("provider", provider);
  if (error) throw error;
  res.json({ success: true });
}));

contentRoutes.post("/integrations/social/:provider/test", asyncRoute(async (req, res) => {
  const provider = String(req.params.provider || "").toLowerCase();
  const workspaceId = String(req.body.workspaceId || "");
  if (!SOCIAL_PROVIDERS.has(provider)) return res.status(400).json({ success: false, error: "Proveedor inválido" });
  if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "admin"))) return res.status(403).json({ success: false, error: "Admin access is required" });
  const sb = getSupabaseAdmin() || getSupabase();
  if (!sb) return res.status(503).json({ success: false, error: "Supabase no está configurado" });
  const enteredKey = String(req.body.apiKey || "").trim();
  const apiKey = enteredKey || (await resolveSocialConnection(sb, workspaceId, provider)).credentials.apiKey;
  const accounts = provider === "buffer" ? await listBufferAccounts(apiKey) : await listZernioAccounts(apiKey);
  res.json({ success: true, data: { accounts } });
}));

contentRoutes.get("/integrations/social/:provider/accounts", asyncRoute(async (req, res) => {
  const provider = String(req.params.provider || "").toLowerCase();
  const workspaceId = String(req.query.workspaceId || "");
  if (!SOCIAL_PROVIDERS.has(provider)) return res.status(400).json({ success: false, error: "Proveedor inválido" });
  if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
  if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "editor"))) return res.status(403).json({ success: false, error: "Editor access is required" });
  const sb = getSupabaseAdmin() || getSupabase();
  if (!sb) return res.status(503).json({ success: false, error: "Supabase no está configurado" });
  let apiKey: string;
  try { apiKey = (await resolveSocialConnection(sb, workspaceId, provider)).credentials.apiKey; }
  catch (error) { return res.status(409).json({ success: false, error: error instanceof Error ? error.message : "Conecta el proveedor" }); }
  const accounts = provider === "buffer" ? await listBufferAccounts(apiKey) : await listZernioAccounts(apiKey);
  // Cache the fresh list so the next dialog open renders without a live call.
  const existing = (await socialConnections(sb, workspaceId, provider))[0];
  if (existing) {
    const { error } = await sb.from("workspace_mcp_connections").update({
      public_config: { ...(existing.public_config || {}), knownAccounts: accounts },
      updated_at: new Date().toISOString(),
    }).eq("id", existing.id).eq("workspace_id", workspaceId);
    if (error) throw error;
  }
  res.json({ success: true, data: { accounts } });
}));

// ── Zernio inbox: messages and comments. Buffer has no conversation surface,
// so every route here resolves the Zernio connection only. State (respondido /
// capturado) lives in social_inbox (v43) and survives reloads. ──

function isInboxMissingTable(error: unknown): boolean {
  const message = String((error as any)?.message ?? "").toLowerCase();
  return message.includes("social_inbox")
    && (message.includes("schema cache") || message.includes("does not exist") || message.includes("no existe"));
}

const INBOX_SETUP_MESSAGE =
  "Falta la tabla del inbox. Ejecuta supabase_migrations_v43.sql en el proyecto de Supabase "
  + "de producción (idempotente) y recarga el esquema (Settings → API → Reload schema cache).";

contentRoutes.post("/integrations/social/zernio/webhook/subscribe", asyncRoute(async (req, res) => {
  const workspaceId = String(req.body.workspaceId || "");
  if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
  if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "admin"))) return res.status(403).json({ success: false, error: "Admin access is required" });
  const sb = getSupabaseAdmin() || getSupabase();
  if (!sb) return res.status(503).json({ success: false, error: "Supabase no está configurado" });
  const origin = String(req.body.origin || "").trim().replace(/\/+$/, "");
  if (!origin || !(/^https:\/\//.test(origin) || /^http:\/\/localhost/.test(origin))) {
    return res.status(400).json({ success: false, error: "Pasa origin con la URL pública de esta instalación (https://… o http://localhost:… para pruebas)" });
  }
  const connection = await resolveSocialConnection(sb, workspaceId, "zernio");
  // Zernio signs deliveries with exactly the secret sent here — generated
  // fresh, stored encrypted on the connection, never returned to the client.
  const secret = newZernioWebhookSecret();
  const events = ["message.received", "comment.received"];
  const url = `${origin}/api/content/webhooks/zernio/${connection.row.id}`;
  const webhookId = await subscribeZernioWebhook(connection.credentials.apiKey, {
    name: `Musa ${workspaceId.slice(0, 8)}`,
    url,
    secret,
    events,
  });
  const credentials = { ...connection.credentials, webhookSecret: secret };
  const { error: saveError } = await sb.from("workspace_mcp_connections").update({
    credentials_encrypted: encryptWorkspaceSecret(credentials),
    public_config: { ...(connection.config || {}), webhookId, webhookUrl: url, webhookEvents: events },
    updated_at: new Date().toISOString(),
  }).eq("id", connection.row.id).eq("workspace_id", workspaceId);
  if (saveError) throw saveError;
  res.json({ success: true, data: { webhookId, url, events } });
}));

contentRoutes.get("/integrations/social/zernio/inbox", asyncRoute(async (req, res) => {
  const workspaceId = String(req.query.workspaceId || "");
  if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
  if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "viewer"))) return res.status(403).json({ success: false, error: "Workspace access is required" });
  const admin = getSupabaseAdmin();
  if (!admin) return res.status(503).json({ success: false, error: "Supabase admin no está configurado" });
  let connection;
  try { connection = await resolveSocialConnection(admin, workspaceId, "zernio"); }
  catch (error) { return res.status(409).json({ success: false, error: error instanceof Error ? error.message : "Conecta Zernio" }); }
  try {
    const remote = await syncZernioInbox(connection.credentials.apiKey);
    if (remote.length > 0) {
      // ignoreDuplicates: a re-sync never rewrites what the team already
      // answered or captured — only genuinely new items become rows.
      const { error: upsertError } = await admin.from("social_inbox").upsert(
        remote.map(item => ({
          workspace_id: workspaceId,
          connection_id: connection.row.id,
          provider: "zernio",
          external_id: item.externalId,
          kind: item.kind,
          platform: item.platform || null,
          author_name: item.authorName || null,
          author_handle: item.authorHandle || null,
          author_email: item.authorEmail || null,
          content: item.content || null,
          occurred_at: item.occurredAt,
          raw: item as unknown as Record<string, unknown>,
        })),
        { onConflict: "provider,external_id", ignoreDuplicates: true },
      );
      if (upsertError) throw upsertError;
    }
  } catch (error) {
    if (isInboxMissingTable(error)) {
      return res.status(503).json({ success: false, error: INBOX_SETUP_MESSAGE, setupRequired: true });
    }
    throw error;
  }
  const { data, error: readError } = await admin.from("social_inbox")
    .select("*").eq("workspace_id", workspaceId).eq("provider", "zernio")
    .order("occurred_at", { ascending: false, nullsFirst: false }).limit(200);
  if (readError) {
    if (isInboxMissingTable(readError)) {
      return res.status(503).json({ success: false, error: INBOX_SETUP_MESSAGE, setupRequired: true });
    }
    throw readError;
  }
  res.json({ success: true, data: data || [] });
}));

contentRoutes.post("/integrations/social/zernio/inbox/:itemId/reply", asyncRoute(async (req, res) => {
  const workspaceId = String(req.body.workspaceId || "");
  const itemId = String(req.params.itemId || "");
  if (!workspaceId || !itemId) return res.status(400).json({ success: false, error: "workspaceId e itemId son obligatorios" });
  const content = String(req.body.content || "").trim();
  if (!content) return res.status(400).json({ success: false, error: "Escribe la respuesta antes de enviarla" });
  if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "editor"))) return res.status(403).json({ success: false, error: "Editor access is required" });
  const admin = getSupabaseAdmin();
  if (!admin) return res.status(503).json({ success: false, error: "Supabase admin no está configurado" });
  const { data: item, error: readError } = await admin.from("social_inbox")
    .select("id, external_id, kind, raw").eq("id", itemId).eq("workspace_id", workspaceId).maybeSingle();
  if (readError) throw readError;
  if (!item) return res.status(404).json({ success: false, error: "Conversación no encontrada" });
  const connection = await resolveSocialConnection(admin, workspaceId, "zernio");
  // The real contract routes every reply: comments answer via the post's
  // thread (accountId + commentId), DMs via the conversation. Both ids ride
  // in raw since the webhook/sync stored them.
  const raw = (item.raw || {}) as { conversationId?: string | null; accountId?: string | null; postId?: string | null; platformPostId?: string | null };
  const apiKey = connection.credentials.apiKey;
  if (item.kind === "comment") {
    const postId = raw.postId || raw.platformPostId;
    if (!postId || !raw.accountId) {
      return res.status(409).json({ success: false, error: "Esta entrada no tiene los datos del proveedor (postId/accountId). Sincroniza la bandeja y vuelve a intentar." });
    }
    await replyZernioComment(apiKey, postId, raw.accountId, item.external_id, content);
  } else {
    if (!raw.conversationId || !raw.accountId) {
      return res.status(409).json({ success: false, error: "Esta entrada no tiene la conversación del proveedor (conversationId/accountId). Sincroniza la bandeja y vuelve a intentar." });
    }
    await replyZernioMessage(apiKey, raw.conversationId, raw.accountId, content);
  }
  const { data, error } = await admin.from("social_inbox").update({
    status: "respondido", reply_text: content, replied_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", item.id).select("*").single();
  if (error) throw error;
  res.json({ success: true, data });
}));

contentRoutes.post("/integrations/social/zernio/inbox/:itemId/capture", asyncRoute(async (req, res) => {
  const workspaceId = String(req.body.workspaceId || "");
  const itemId = String(req.params.itemId || "");
  if (!workspaceId || !itemId) return res.status(400).json({ success: false, error: "workspaceId e itemId son obligatorios" });
  if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "editor"))) return res.status(403).json({ success: false, error: "Editor access is required" });
  const admin = getSupabaseAdmin();
  if (!admin) return res.status(503).json({ success: false, error: "Supabase admin no está configurado" });
  const { data: item, error: readError } = await admin.from("social_inbox")
    .select("*").eq("id", itemId).eq("workspace_id", workspaceId).maybeSingle();
  if (readError) throw readError;
  if (!item) return res.status(404).json({ success: false, error: "Conversación no encontrada" });
  if (item.status === "capturado") return res.status(409).json({ success: false, error: "Este contacto ya fue capturado" });
  // Same columns the CRM's own contact route writes — a captured lead must be
  // indistinguishable from a hand-typed one once it lands in Contactos.
  const name = String(item.author_name || "").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  const email = typeof item.author_email === "string" && /.+@.+\..+/.test(item.author_email) ? item.author_email : null;
  const handle = item.author_handle ? ` (@${item.author_handle})` : "";
  // REQ-CW3: link de vuelta a la conversación — el sync/webhook guarda el
  // item completo del proveedor en raw (permalink parseado de postUrl/url);
  // sin permalink la nota queda sin link, nunca uno inventado.
  const rawItem = (item.raw || {}) as { permalink?: string | null; postUrl?: string | null };
  const permalink = rawItem.permalink || rawItem.postUrl || null;
  // REQ-029 Item 3: capturar dos veces al mismo autor NO duplica personas —
  // el match (email > handle > nombre exacto, matchCapturedContact) corre solo
  // contra contactos capturados de la Bandeja (tag zernio): los manuales
  // jamás se pisan.
  const { data: capturedContacts, error: capturedError } = await admin.from("crm_contacts")
    .select("id, brand_id, first_name, last_name, email, notes, tags")
    .eq("workspace_id", workspaceId).contains("tags", ["zernio"]);
  if (capturedError) throw capturedError;
  const match = matchCapturedContact(item, capturedContacts || []);
  const matched = Boolean(match.contact);
  let contact: NonNullable<typeof match.contact>;
  if (match.contact) {
    contact = match.contact;
  } else {
    const { data: created, error: contactError } = await admin.from("crm_contacts").insert({
      workspace_id: workspaceId,
      first_name: parts[0] || "Sin nombre",
      last_name: parts.slice(1).join(" ") || null,
      email,
      status: "lead",
      tags: ["zernio", item.platform || "social"].filter(Boolean),
      notes: `Capturado desde Zernio — ${item.kind === "comment" ? "comentario" : "mensaje"}`
        + `${item.platform ? ` en ${item.platform}` : ""}${handle}: ${String(item.content || "").slice(0, 300)}`
        + (permalink ? ` — conversación: ${permalink}` : ""),
      created_by: req.auth.userId,
    }).select("*").single();
    if (contactError) throw contactError;
    contact = created;
  }
  const { data, error } = await admin.from("social_inbox").update({
    status: "capturado", crm_contact_id: contact.id, updated_at: new Date().toISOString(),
  }).eq("id", item.id).select("*").single();
  if (error) throw error;
  // REQ-029 Item 3: la captura deja el touchpoint en el timeline de la
  // persona (tipo «comentario», data con el origen para el link de la ficha).
  // Best-effort: si la base aún no corrió v58 (brand_id NOT NULL o el CHECK
  // sin 'comentario'), la captura IGUAL funciona — solo se pierde el apunte.
  let warning: string | null = null;
  const { error: interactionError } = await admin.from("crm_interactions")
    .insert(buildCaptureInteraction(item, contact, workspaceId));
  if (interactionError) {
    warning = "Contacto capturado, pero la interacción no pudo registrarse en su timeline (¿falta correr supabase_migrations_v58.sql?).";
    console.warn("[crmInboxCapture] crm_interactions insert failed:", interactionError.message);
  }
  res.json({ success: true, data, contact, permalink, matched, matchedBy: match.matchedBy ?? null, warning });
}));

contentRoutes.post("/webhooks/zernio/:connectionId", asyncRoute(async (req, res) => {
  const sb = getSupabaseAdmin();
  if (!sb) return res.status(503).json({ success: false, error: "Supabase admin no está configurado" });
  const { data: connection, error: connectionError } = await sb.from("workspace_mcp_connections")
    .select("id, workspace_id, credentials_encrypted").eq("id", req.params.connectionId).eq("provider", "zernio").eq("enabled", true).maybeSingle();
  if (connectionError) throw connectionError;
  if (!connection?.credentials_encrypted) return res.status(404).json({ success: false, error: "Conexión Zernio no encontrada" });
  const secret = decryptWorkspaceSecret<SocialConnectionSecret>(connection.credentials_encrypted).webhookSecret?.trim();
  if (!secret) return res.status(503).json({ success: false, error: "Configura el secreto webhook de esta conexión" });
  const rawBody = (req as any).rawBody as Buffer | undefined;
  const signature = req.header("x-zernio-signature") || req.header("x-late-signature") || undefined;
  if (!rawBody || !verifyZernioSignature(rawBody, signature, secret)) {
    return res.status(401).json({ success: false, error: "Firma de Zernio inválida" });
  }
  const update = parseZernioWebhook(req.body);
  if (!update) {
    // Inbox events mirror into social_inbox (webhook-first: this is the
    // realtime path the Bandeja reads). Anything else — webhook.test,
    // delivery receipts, reactions — is acked so Zernio marks the endpoint
    // healthy. Redeliveries stay idempotent via the provider,external_id
    // unique key with ignoreDuplicates.
    const inboxItems = parseZernioInboxWebhookEvent(req.body);
    if (inboxItems.length === 0) return res.json({ success: true, ignored: true });
    const { error: upsertError } = await sb.from("social_inbox").upsert(
      inboxItems.map(item => ({
        workspace_id: connection.workspace_id,
        connection_id: connection.id,
        provider: "zernio",
        external_id: item.externalId,
        kind: item.kind,
        platform: item.platform || null,
        author_name: item.authorName || null,
        author_handle: item.authorHandle || null,
        author_email: item.authorEmail || null,
        content: item.content || null,
        occurred_at: item.occurredAt,
        raw: item as unknown as Record<string, unknown>,
      })),
      { onConflict: "provider,external_id", ignoreDuplicates: true },
    );
    if (upsertError) throw upsertError;
    return res.json({ success: true, received: true, stored: inboxItems.length });
  }
  const { data: existing, error: readError } = await sb.from("content_calendar")
    .select("id, permalink, published_at, publishing_event_at, publishing_platform_urls")
    .eq("publishing_provider", "zernio")
    .eq("workspace_id", connection.workspace_id)
    .eq("publishing_connection_id", connection.id)
    .eq("publishing_external_id", update.externalId)
    .maybeSingle();
  if (readError) throw readError;
  if (!existing) return res.status(202).json({ success: true, ignored: true });

  if (existing.publishing_event_at && Date.parse(existing.publishing_event_at) >= Date.parse(update.eventAt)) {
    const { error: staleEventError } = await sb.from("social_publish_events")
      .insert({ provider: "zernio", event_id: update.eventId });
    if (staleEventError && staleEventError.code !== "23505") throw staleEventError;
    return res.json({ success: true, ignored: true, duplicate: staleEventError?.code === "23505" });
  }

  const failed = update.status === "failed" || update.status === "partial";
  const publishingError = failed
    ? update.error || (update.status === "partial" ? "Zernio publicó solo algunos canales" : "Zernio no pudo publicar el contenido")
    : null;
  const { error } = await sb.from("content_calendar").update({
    publishing_status: failed ? "error" : "publicado",
    publishing_error: publishingError,
    publishing_retry_pending: false,
    publishing_event_at: update.eventAt,
    publishing_platform_urls: { ...(existing.publishing_platform_urls || {}), ...update.platformUrls },
    permalink: update.permalink || existing.permalink || null,
    published_at: failed ? null : existing.published_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", existing.id)
    .or(`publishing_event_at.is.null,publishing_event_at.lt.${update.eventAt}`);
  if (error) throw error;
  const { error: eventError } = await sb.from("social_publish_events")
    .insert({ provider: "zernio", event_id: update.eventId });
  if (eventError && eventError.code !== "23505") throw eventError;
  return res.json({ success: true, duplicate: eventError?.code === "23505" });
}));

contentRoutes.get("/", withSetupCheck(async (req, res) => {
  const sb = dbOr503(res);
  if (!sb) return;
  const workspaceId = String(req.query.workspaceId || "");
  if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
  if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "viewer"))) {
    return res.status(403).json({ success: false, error: "Workspace access is required" });
  }

  let query = sb.from("content_calendar").select("*").eq("workspace_id", workspaceId);
  // Windowed by date so a calendar month does not pull three years of history.
  if (req.query.from) query = query.gte("scheduled_date", String(req.query.from));
  if (req.query.to) query = query.lte("scheduled_date", String(req.query.to));
  const { data, error } = await query.order("scheduled_date").limit(1000);
  if (error) throw error;
  res.json({ success: true, data: data || [] });
}));

/** REQ Planilla v2 §4 — Atribución pieza → conversación en 3 niveles de
 *  confianza declarados (la honestidad ES el producto): directa (la Bandeja
 *  conoce el post de origen), asistida (el contacto declaró origen) y
 *  correlación (pico en ventana 48h tras publicar — se REPORTA como
 *  asociada, nunca como generada). 4 lecturas planas + agregación en JS:
 *  el volumen por workspace es de agencia y los tres niveles se cruzan con
 *  piezas, contactos y deals de todas formas. */
const ATTRIBUTION_SETUP_MESSAGE =
  "Falta el esquema de Atribución (tabla crm_signals y columnas origin_* en "
  + "crm_contacts). Ejecuta supabase_migrations_v51.sql (idempotente) y recarga "
  + "el esquema (Settings → API → Reload schema cache).";

/** 48h después de publicar: la ventana de la correlación (nivel 3). */
const CORRELATION_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Los errores de schema de Atribución no pasan por los heuristics de
 *  frame_id/publishing_ — el mensaje debe apuntar a v51, no a v34. */
function isMissingAttributionSchema(error: unknown): boolean {
  const err = error as { code?: string; message?: string } | null;
  if (err?.code === "42P01" || err?.code === "42703" || err?.code === "PGRST205") return true;
  return /does not exist|no existe|schema cache/i.test(String(err?.message ?? ""));
}

contentRoutes.get("/attribution", withSetupCheck(async (req, res) => {
  const sb = dbOr503(res);
  if (!sb) return;
  const workspaceId = String(req.query.workspaceId || "");
  if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
  if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "viewer"))) {
    return res.status(403).json({ success: false, error: "Workspace access is required" });
  }
  const campaignFilter = String(req.query.campaign || "").trim();
  const contentFilter = String(req.query.contentId || "").trim();

  const [piecesRes, signalsRes, originContactsRes, dealsRes] = await Promise.all([
    sb.from("content_calendar")
      .select("id, topic, campaign, brand_id, status, conversion_goal, scheduled_date, scheduled_time, published_at")
      .eq("workspace_id", workspaceId).order("scheduled_date").limit(1000),
    sb.from("crm_signals")
      .select("id, brand_id, contact_id, origin_content_id, signal_type, confidence, external_ref, occurred_at")
      .eq("workspace_id", workspaceId).order("occurred_at", { ascending: false }).limit(5000),
    sb.from("crm_contacts")
      .select("id, first_name, last_name, origin_source, origin_content_id, created_at")
      .eq("workspace_id", workspaceId).not("origin_source", "is", null).limit(5000),
    sb.from("crm_deals").select("id, primary_contact_id").eq("workspace_id", workspaceId).limit(5000),
  ]);
  for (const r of [piecesRes, signalsRes, originContactsRes, dealsRes]) {
    if (r.error) {
      if (isMissingAttributionSchema(r.error)) {
        return res.status(503).json({ success: false, error: ATTRIBUTION_SETUP_MESSAGE, setupRequired: true });
      }
      throw r.error;
    }
  }

  const pieces = piecesRes.data || [];
  const signals = signalsRes.data || [];
  const originContacts = originContactsRes.data || [];
  const deals = dealsRes.data || [];

  // Nombres para las listas: las señales referencian contactos por id.
  const signalContactIds = [...new Set(signals.map((s: any) => s.contact_id).filter(Boolean))];
  const contactNames = new Map<string, string>();
  if (signalContactIds.length > 0) {
    const { data: nameRows, error: nameError } = await sb.from("crm_contacts")
      .select("id, first_name, last_name").eq("workspace_id", workspaceId).in("id", signalContactIds);
    if (nameError) {
      if (isMissingAttributionSchema(nameError)) {
        return res.status(503).json({ success: false, error: ATTRIBUTION_SETUP_MESSAGE, setupRequired: true });
      }
      throw nameError;
    }
    for (const c of nameRows || []) {
      contactNames.set(c.id, [c.first_name, c.last_name].filter(Boolean).join(" ") || "Contacto");
    }
  }
  const contactName = (id: string | null) => (id && contactNames.get(id)) || "Contacto";

  const dealsByContact = new Map<string, number>();
  for (const d of deals) {
    if (!d.primary_contact_id) continue;
    dealsByContact.set(d.primary_contact_id, (dealsByContact.get(d.primary_contact_id) || 0) + 1);
  }

  interface AttrLevel { count: number; items: Array<Record<string, unknown>> }
  const emptyLevel = (): AttrLevel => ({ count: 0, items: [] });
  interface AttrEntry {
    id: string; topic: string; campaign: string | null; status: string;
    conversionGoal: string | null; publishedAt: string | null; brandId: string | null;
    directa: AttrLevel; asistida: AttrLevel; correlacion: AttrLevel;
    contacts: number; deals: number;
  }
  const report = new Map<string, AttrEntry>();
  for (const p of pieces) {
    report.set(p.id, {
      id: p.id,
      topic: p.topic || "(sin tema)",
      campaign: p.campaign || null,
      status: p.status,
      conversionGoal: p.conversion_goal || null,
      // Ventana de correlación: cuándo se publicó. published_at es la verdad;
      // una pieza publicada sin timestamp usa su fecha agendada como fallback.
      publishedAt: p.published_at || (p.status === "publicado" && p.scheduled_date
        ? `${p.scheduled_date}T${p.scheduled_time || "09:00"}:00`
        : null),
      brandId: p.brand_id || null,
      directa: emptyLevel(), asistida: emptyLevel(), correlacion: emptyLevel(),
      contacts: 0, deals: 0,
    });
  }

  const push = (level: AttrLevel, s: any, associated = false) => {
    level.count += 1;
    if (level.items.length < 50) {
      level.items.push({
        id: s.id, signalType: s.signal_type, occurredAt: s.occurred_at,
        contactName: contactName(s.contact_id), externalRef: s.external_ref || null,
        ...(associated ? { associated: true } : {}),
      });
    }
  };

  // Niveles 1 y 2 explícitos: la señal trae confidence y ancla.
  const unattributed: any[] = [];
  for (const s of signals) {
    if (!s.origin_content_id) { unattributed.push(s); continue; }
    const entry = report.get(s.origin_content_id);
    if (!entry) continue; // pieza fuera del listado (ventana/limite)
    if (s.confidence === "directa") push(entry.directa, s);
    else if (s.confidence === "asistida") push(entry.asistida, s);
    else if (s.confidence === "correlacion") push(entry.correlacion, s, true);
  }

  // Nivel 3 computado: cada señal sin ancla se asocia a la pieza publicada
  // más reciente dentro de su ventana de 48h (misma marca cuando ambas la
  // tienen). A UNA pieza por señal — repartirla inflaría los totales.
  for (const s of unattributed) {
    const at = new Date(s.occurred_at).getTime();
    if (!Number.isFinite(at)) continue;
    let best: AttrEntry | null = null;
    let bestFrom = -Infinity;
    for (const entry of report.values()) {
      if (!entry.publishedAt) continue;
      if (s.brand_id && entry.brandId && s.brand_id !== entry.brandId) continue;
      const from = new Date(entry.publishedAt).getTime();
      if (!Number.isFinite(from) || from > at || at > from + CORRELATION_WINDOW_MS) continue;
      if (from > bestFrom) { bestFrom = from; best = entry; }
    }
    if (best) push(best.correlacion, s, true);
  }

  // Conversión a contacto → a deal: contactos con origen declarado en la pieza.
  for (const c of originContacts) {
    if (!c.origin_content_id) continue;
    const entry = report.get(c.origin_content_id);
    if (!entry) continue;
    entry.contacts += 1;
    entry.deals += dealsByContact.get(c.id) || 0;
  }

  // Filtros AL FINAL: la agregación es sobre todo el workspace, así el UI
  // puede filtrar por campaña del lado cliente sin re-consultar.
  const filteredSet = new Set(
    pieces
      .filter(p => !contentFilter || p.id === contentFilter)
      .filter(p => !campaignFilter || (p.campaign || "") === campaignFilter)
      .map(p => p.id),
  );
  const shown = [...report.values()].filter(e => filteredSet.has(e.id));

  const campaignMap = new Map<string, Record<string, number | string>>();
  for (const e of [...report.values()]) {
    const key = e.campaign || "(sin campaña)";
    const row = (campaignMap.get(key) || {
      campaign: key, pieces: 0, directa: 0, asistida: 0, correlacion: 0, contacts: 0, deals: 0,
    }) as Record<string, number | string>;
    row.pieces = (row.pieces as number) + 1;
    row.directa = (row.directa as number) + e.directa.count;
    row.asistida = (row.asistida as number) + e.asistida.count;
    row.correlacion = (row.correlacion as number) + e.correlacion.count;
    row.contacts = (row.contacts as number) + e.contacts;
    row.deals = (row.deals as number) + e.deals;
    campaignMap.set(key, row);
  }

  res.json({
    success: true,
    data: {
      totals: {
        directa: shown.reduce((n, e) => n + e.directa.count, 0),
        asistida: shown.reduce((n, e) => n + e.asistida.count, 0),
        correlacion: shown.reduce((n, e) => n + e.correlacion.count, 0),
        contacts: shown.reduce((n, e) => n + e.contacts, 0),
        deals: shown.reduce((n, e) => n + e.deals, 0),
      },
      campaigns: [...campaignMap.values()].sort((a, b) =>
        ((b.directa as number) + (b.asistida as number) + (b.correlacion as number))
        - ((a.directa as number) + (a.asistida as number) + (a.correlacion as number))),
      pieces: shown,
    },
  });
}));

contentRoutes.post("/", withSetupCheck(async (req, res) => {
  const sb = dbOr503(res);
  if (!sb) return;
  const workspaceId = String(req.body.workspaceId || "");
  if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
  if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "editor"))) {
    return res.status(403).json({ success: false, error: "Editor access to the workspace is required" });
  }
  const patch = buildPatch(req.body);
  if (!patch.scheduled_date) {
    return res.status(400).json({ success: false, error: "scheduled_date is required" });
  }
  patch.workspace_id = workspaceId;
  patch.kind ??= "organic";
  patch.status ??= "idea";
  patch.channels ??= [];

  const { data, error } = await sb.from("content_calendar").insert(patch).select("*").single();
  if (error) throw error;
  res.status(201).json({ success: true, data });
}));

/** One import, 500 rows — beyond that the UI should batch by month. */
const IMPORT_MAX_ROWS = 500;

contentRoutes.post("/import", withSetupCheck(async (req, res) => {
  const sb = dbOr503(res);
  if (!sb) return;
  const workspaceId = String(req.body.workspaceId || "");
  if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
  if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "editor"))) {
    return res.status(403).json({ success: false, error: "Editor access to the workspace is required" });
  }
  const incoming = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (incoming.length === 0) return res.status(400).json({ success: false, error: "No hay filas para importar" });
  if (incoming.length > IMPORT_MAX_ROWS) {
    return res.status(400).json({ success: false, error: `Máximo ${IMPORT_MAX_ROWS} filas por importación` });
  }

  // The import must never be a second, looser way in: every row goes through
  // the same buildPatch validation the manual create uses, invalid dates
  // included — the client already told the human about those.
  const inserts = incoming
    .map((row: Record<string, unknown>) => {
      const item = buildPatch(row);
      item.workspace_id = workspaceId;
      item.kind ??= "organic";
      item.status ??= "idea";
      item.channels ??= [];
      return item;
    })
    .filter((item: Record<string, unknown>) => Boolean(item.scheduled_date));

  // Brand ids arrive as names resolved client-side; re-verify against this
  // workspace so a crafted file cannot attach rows to someone else's brand.
  const brandIds = [...new Set(inserts.map((item: any) => item.brand_id).filter(Boolean))];
  if (brandIds.length > 0) {
    const { data: validBrands, error: brandError } = await sb.from("brands")
      .select("id").eq("workspace_id", workspaceId).in("id", brandIds);
    if (brandError) throw brandError;
    const valid = new Set((validBrands || []).map((b: any) => b.id));
    for (const item of inserts) {
      if (item.brand_id && !valid.has(item.brand_id)) item.brand_id = null;
    }
  }

  // Chunked so a full-year import never builds one giant statement.
  const created: Record<string, unknown>[] = [];
  for (let i = 0; i < inserts.length; i += 200) {
    const { data, error } = await sb.from("content_calendar")
      .insert(inserts.slice(i, i + 200)).select("*");
    if (error) throw error;
    created.push(...(data || []));
  }
  res.status(201).json({
    success: true,
    data: created,
    imported: created.length,
    rejected: incoming.length - inserts.length,
  });
}));

contentRoutes.patch("/:id", withSetupCheck(async (req, res) => {
  const sb = dbOr503(res);
  if (!sb) return;
  const { data: existing, error: readError } = await sb.from("content_calendar")
    .select("id, workspace_id").eq("id", req.params.id).maybeSingle();
  if (readError) throw readError;
  if (!existing) return res.status(404).json({ success: false, error: "Contenido no encontrado" });
  if (!req.auth || !(await canAccessWorkspace(req.auth, existing.workspace_id, "editor"))) {
    return res.status(403).json({ success: false, error: "Editor access to the workspace is required" });
  }

  const patch = buildPatch(req.body);
  if (Object.keys(patch).length === 0) {
    // A 200 here is how a table ends up looking broken: the request succeeds,
    // the cell snaps back, and nothing anywhere says why.
    return res.status(400).json({ success: false, error: "Nada que actualizar" });
  }
  patch.updated_at = new Date().toISOString();
  const { data, error } = await sb.from("content_calendar")
    .update(patch).eq("id", req.params.id).select("*").single();
  if (error) throw error;
  res.json({ success: true, data });
}));

contentRoutes.post("/:id/sync", withSetupCheck(async (req, res) => {
  const sb = dbOr503(res);
  if (!sb) return;
  const { data: existing, error: readError } = await sb.from("content_calendar").select("*").eq("id", req.params.id).maybeSingle();
  if (readError) throw readError;
  if (!existing) return res.status(404).json({ success: false, error: "Contenido no encontrado" });
  if (!req.auth || !(await canAccessWorkspace(req.auth, existing.workspace_id, "editor"))) return res.status(403).json({ success: false, error: "Editor access is required" });
  if (existing.publishing_provider !== "buffer") return res.status(400).json({ success: false, error: "La actualización manual es para Buffer" });
  if (!Object.keys(existing.publishing_destinations || {}).length) return res.status(409).json({ success: false, error: "Publicación sin registro por destino; consulta Buffer" });
  const admin = getSupabaseAdmin();
  if (!admin) return res.status(503).json({ success: false, error: "Supabase admin no está configurado" });
  const connection = await resolveSocialConnection(admin, existing.workspace_id, "buffer");
  if (connection.row.id !== existing.publishing_connection_id) return res.status(409).json({ success: false, error: "Reconecta la cuenta original" });
  const destinations = await syncBufferDestinations(connection.credentials.apiKey, existing.publishing_destinations);
  const result = summarizeBufferDestinations(destinations);
  const status = result.status === "published" ? "publicado" : result.status === "scheduled" ? "programado" : result.status === "publishing" ? "publicando" : "error";
  const { data, error } = await sb.from("content_calendar").update({
    publishing_destinations: destinations, publishing_status: status, publishing_platform_urls: result.platformUrls,
    publishing_error: result.error, permalink: result.permalink || existing.permalink,
    published_at: status === "publicado" ? existing.published_at || new Date().toISOString() : existing.published_at,
    updated_at: new Date().toISOString(),
  }).eq("id", existing.id).eq("workspace_id", existing.workspace_id).eq("updated_at", existing.updated_at).select("*").maybeSingle();
  if (error) throw error;
  if (!data) return res.status(409).json({ success: false, error: "El contenido cambió mientras se actualizaba. Recarga e intenta nuevamente." });
  res.json({ success: true, data });
}));

contentRoutes.post("/:id/publish", withSetupCheck(async (req, res) => {
  const sb = dbOr503(res);
  if (!sb) return;
  const { data: existing, error: readError } = await sb.from("content_calendar")
    .select("*")
    .eq("id", req.params.id).maybeSingle();
  if (readError) throw readError;
  if (!existing) return res.status(404).json({ success: false, error: "Contenido no encontrado" });
  if (!req.auth || !(await canAccessWorkspace(req.auth, existing.workspace_id, "editor"))) {
    return res.status(403).json({ success: false, error: "Editor access to the workspace is required" });
  }

  const snapshot = existing.publishing_payload;
  const input = snapshot || req.body;
  const mode = String(input.mode || "") as SocialPublishMode;
  if (mode !== "now" && mode !== "schedule") {
    return res.status(400).json({ success: false, error: "mode debe ser now o schedule" });
  }
  let channels = Array.isArray(input.channels)
    ? [...new Set<string>(input.channels.reduce((list: string[], value: unknown) => {
      const channel = String(value).trim();
      if (channel) list.push(channel);
      return list;
    }, []))]
    : existing.channels || [];
  // Explicit multi-account picks: one id per destination — two Instagram
  // accounts arrive as two ids. Resolved against the provider's live list
  // once the connection is known (below); unknown or inactive ids fail
  // before the row locks.
  const accountIds = !snapshot && Array.isArray(req.body.accountIds) ? req.body.accountIds : null;
  const timezone = String(input.timezone || "UTC").trim();
  if (!TIME_ZONES.has(timezone)) {
    return res.status(400).json({ success: false, error: "Zona horaria inválida" });
  }
  const scheduledFor = mode === "schedule" ? String(input.scheduledFor || "") : undefined;
  let scheduledInstant: string | undefined;
  if (mode === "schedule" && !snapshot) {
    const match = scheduledFor?.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):00$/);
    if (!match) return res.status(400).json({ success: false, error: "Fecha y hora de programación inválidas" });
    try { scheduledInstant = zonedDateTimeToIso(match[1], match[2], timezone); } catch (error) {
      return res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Programación inválida" });
    }
    if (Date.parse(scheduledInstant) <= Date.now()) {
      return res.status(400).json({ success: false, error: "La programación debe quedar en el futuro" });
    }
  }
  const content = String(snapshot ? snapshot.content : existing.copy || existing.topic || "").trim();
  if (!content) return res.status(400).json({ success: false, error: "Agrega un copy antes de publicar" });
  const contentType = String(input.contentType || "post") as SocialContentType;
  if (!SOCIAL_CONTENT_TYPES.has(contentType)) return res.status(400).json({ success: false, error: "Tipo de contenido inválido" });
  const mediaUrl = String(snapshot ? snapshot.mediaUrl || "" : req.body.mediaUrl || existing.external_url || "").trim() || undefined;
  if (!snapshot && (existing.template_id || existing.frame_id) && !req.body.mediaUrl) {
    return res.status(400).json({ success: false, error: "Exporta y adjunta el diseño vinculado antes de publicar; no se enviará sólo texto" });
  }
  if (mediaUrl) {
    try { publicSocialMediaUrl(mediaUrl); socialMediaType(mediaUrl, contentType); } catch (error) {
      return res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Adjunta una URL HTTPS pública de imagen o video" });
    }
  }
  if ((contentType === "story" || contentType === "reel") && !mediaUrl) {
    return res.status(400).json({ success: false, error: `${contentType === "story" ? "La Story" : "El Reel"} necesita una URL de imagen o video` });
  }

  const requestedProvider = String(req.body.provider || "").trim().toLowerCase() || undefined;
  if (requestedProvider && !SOCIAL_PROVIDERS.has(requestedProvider)) return res.status(400).json({ success: false, error: "Proveedor inválido" });
  let connection;
  const admin = getSupabaseAdmin();
  if (!admin) return res.status(503).json({ success: false, error: "Supabase admin no está configurado" });
  try {
    connection = await resolveSocialConnection(
      admin,
      existing.workspace_id,
      existing.publishing_request_id ? existing.publishing_provider : requestedProvider,
      publishProviderOrder(contentType),
    );
  } catch (error) {
    // Buffer-only workspace asking for a story gets the fix, not the policy text.
    const base = error instanceof Error ? error.message : "Conecta un proveedor social";
    const message = contentType !== "post" && !requestedProvider && !existing.publishing_request_id
      ? "Stories y Reels requieren una conexión Zernio"
      : base;
    return res.status(409).json({ success: false, error: message });
  }
  if (contentType !== "post" && connection.row.provider !== "zernio") {
    return res.status(400).json({ success: false, error: "Stories y Reels requieren una conexión Zernio" });
  }
  if (existing.publishing_request_id && existing.publishing_connection_id !== connection.row.id) {
    return res.status(409).json({ success: false, error: "Reconecta la cuenta original antes de reintentar esta publicación" });
  }
  if (existing.publishing_request_id && existing.publishing_provider === "buffer" && !existing.publishing_payload) {
    return res.status(409).json({ success: false, error: "Publicación antigua sin registro por destino. Revisa Buffer para evitar duplicados." });
  }
  let accountRefs: SocialAccountRef[] | undefined;
  if (accountIds) {
    // A retry replays the original payload — same destinations by design, so
    // new picks need a fresh piece rather than silently overriding.
    const live = connection.row.provider === "buffer"
      ? await listBufferAccounts(connection.credentials.apiKey)
      : await listZernioAccounts(connection.credentials.apiKey);
    try { accountRefs = pickAccountsByIds(live, accountIds); }
    catch (error) {
      return res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Cuentas inválidas" });
    }
    // Record channels stay in the calendar's vocabulary (Instagram, X…),
    // deduplicated across the picked accounts.
    channels = [...new Set(accountRefs.map(ref => platformToChannel(ref.platform)).filter(Boolean))];
  }
  if (channels.length === 0) {
    return res.status(400).json({ success: false, error: "Elige al menos un canal" });
  }
  const provider = createSocialPublisher(connection.credentials.apiKey, connection.config.accounts || {}, connection.row.provider);
  const retriesExternalPost = provider.name === "zernio" && existing.publishing_status === "error" && existing.publishing_provider === "zernio" && Boolean(existing.publishing_external_id);
  const requestId = retriesExternalPost
    ? (existing.publishing_retry_pending ? existing.publishing_request_id : newPublishRequestId())
    : existing.publishing_request_id || newPublishRequestId();
  const publishPayload = existing.publishing_payload || { requestId, content, channels, mode, accountRefs, scheduledFor: provider.name === "zernio" ? scheduledFor : scheduledInstant, timezone, contentType, mediaUrl };
  const { data: locked, error: lockError } = await sb.from("content_calendar")
    .update({
      publishing_status: "publicando",
      publishing_provider: provider.name,
      publishing_connection_id: connection.row.id,
      publishing_channels: publishPayload.channels,
      publishing_payload: publishPayload,
      publishing_scheduled_for: existing.publishing_payload ? existing.publishing_scheduled_for : scheduledInstant || null,
      publishing_timezone: publishPayload.timezone,
      publishing_request_id: requestId,
      publishing_retry_pending: retriesExternalPost,
      publishing_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id)
    .in("publishing_status", ["borrador", "error"])
    .select("*").maybeSingle();
  if (lockError) throw lockError;
  if (!locked) {
    return res.status(409).json({ success: false, error: "Esta publicación ya está en proceso o programada" });
  }

  try {
    const result = retriesExternalPost
      ? await provider.retry(existing.publishing_external_id, requestId)
      : await provider.publish({ ...publishPayload, requestId, destinations: existing.publishing_destinations || {},
        saveDestinations: async destinations => {
          const { data, error } = await sb.from("content_calendar").update({ publishing_destinations: destinations })
            .eq("id", existing.id).eq("workspace_id", existing.workspace_id).eq("publishing_request_id", requestId).select("id").single();
          if (error || !data) throw error || new Error("No se pudo guardar el progreso de publicación");
        },
      });
    const terminalError = result.status === "failed" || result.status === "partial";
    const publishingStatus = result.status === "published"
      ? "publicado"
      : result.status === "scheduled" ? "programado" : terminalError ? "error" : "publicando";
    const { data, error } = await sb.from("content_calendar").update({
      publishing_status: publishingStatus,
      publishing_external_id: result.externalId,
      permalink: result.permalink,
      publishing_platform_urls: result.platformUrls,
      published_at: publishingStatus === "publicado" ? new Date().toISOString() : null,
      publishing_error: terminalError
        ? result.error || (result.status === "partial" ? "Se publicaron solo algunos canales" : "No se pudo publicar el contenido")
        : null,
      publishing_retry_pending: false,
      updated_at: new Date().toISOString(),
    }).eq("id", existing.id).eq("publishing_request_id", requestId).select("*").single();
    if (error) throw error;
    return terminalError
      ? res.status(502).json({ success: false, error: data.publishing_error, data })
      : res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo enviar a Zernio";
    const { data } = await sb.from("content_calendar").update({
      publishing_status: "error",
      publishing_error: message,
      updated_at: new Date().toISOString(),
    }).eq("id", existing.id).eq("publishing_request_id", requestId).select("*").maybeSingle();
    return res.status(502).json({ success: false, error: message, data });
  }
}));

contentRoutes.delete("/:id", withSetupCheck(async (req, res) => {
  const sb = dbOr503(res);
  if (!sb) return;
  const { data: existing } = await sb.from("content_calendar")
    .select("id, workspace_id").eq("id", req.params.id).maybeSingle();
  if (!existing) return res.status(404).json({ success: false, error: "Contenido no encontrado" });
  if (!req.auth || !(await canAccessWorkspace(req.auth, existing.workspace_id, "editor"))) {
    return res.status(403).json({ success: false, error: "Editor access to the workspace is required" });
  }
  const { error } = await sb.from("content_calendar").delete().eq("id", req.params.id);
  if (error) throw error;
  res.json({ success: true });
}));
