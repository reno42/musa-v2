import express from "express";
import cors from "cors";
import { auth, requireUserSession } from "./middleware/auth.js";
import { rateLimit } from "./middleware/rateLimit.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { templateRoutes } from "./routes/templates.js";
import { layerRoutes } from "./routes/layers.js";
import { frameRoutes } from "./routes/frames.js";
import { toolRoutes } from "./routes/tools.js";
import { renderRoutes } from "./routes/render.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { openApiRoutes } from "./routes/openapi.js";
import { batchRoutes } from "./routes/batch.js";
import { specRoutes } from "./routes/specs.js";
import { styleRoutes } from "./routes/styles.js";
import { versionRoutes } from "./routes/versions.js";
import { designCommentRoutes } from "./routes/designComments.js";
import { commentShareRoutes } from "./routes/commentShare.js";
import { variableRoutes } from "./routes/variables.js";
import { colorRoutes } from "./routes/colors.js";
import { fontRoutes } from "./routes/fonts.js";
import { skillsCatalogRoutes } from "./routes/skillsCatalog.js";
import { componentRoutes } from "./routes/components.js";
import { recipeRoutes } from "./routes/recipes.js";
import { assetRoutes } from "./routes/assets.js";
import { photoRoutes } from "./routes/photos.js";
import { designSystemRoutes } from "./routes/designSystem.js";
import { sectionRoutes } from "./routes/sections.js";
import { metricsRoutes } from "./routes/metrics.js";
import { designMetaRoutes, getDesignGraph } from "./routes/designMeta.js";
import { getBrandGraph } from "./routes/brandGraph.js";
import { getEntityBrainNote, postBrainNotesBackfill, putBrainNoteHuman } from "./routes/brainNotes.js";
import { storageRoutes } from "./routes/storage.js";
import { segmentationRoutes } from "./routes/segmentation.js";
import { contentRoutes } from "./routes/contentCalendar.js";
import { copyRecipeRoutes } from "./routes/copyRecipes.js";
import { chatRoutes } from "./routes/chatHistory.js";
import { bugReportRoutes } from "./routes/bugReports.js";
import { accountRoutes, invitationRoutes, workspaceSaasRoutes } from "./routes/saas.js";
import { keysStubRoutes } from "./routes/keysStub.js";
import { llmProxyRoutes } from "./routes/llmProxy.js";
import { getPublicSupabaseConfig, getSupabase, getSupabaseAdmin, getSupabaseAuthClient } from "./services/supabase.js";
import { enforceWorkspaceKeyScope, requireResourceAccess, requireTemplateAccess } from "./services/tenancy.js";
import { buildCatalog, licensedNote } from "./services/fontCatalog.js";
import { customFontRoutes } from "./routes/customFonts.js";
import { designImportRoutes } from "./routes/designImports.js";
import { videoProjectRoutes } from "./routes/videoProjects.js";
import { personalizedOnboardingRoutes } from "./routes/onboarding.js";
import { asyncRoute } from "./middleware/asyncRoute.js";
import { handler as mcpHandler, createFlowToolBridge } from "../../netlify/functions/mcp.mjs";
import { handler as renderHandler } from "../../netlify/functions/render.mjs";
// REQ-027 — Flows builder: runtime compartido (idempotencia, cap de
// concurrencia, cifrado de credenciales) y límites del engine.
import { createFlowRuntime, flowsDisabled, webhookTriggerMatches, oauth2StateDecode } from "../../netlify/functions/flows-runtime.mjs";
import { encrypt } from "../../netlify/functions/keys.mjs";
import { LIMITS } from "../../netlify/functions/flows-core.mjs";

const app = express();

app.use(cors());
app.use(express.json({
  // 120mb: base64 reel uploads (POST /api/storage/video) — a 30s 1080×1920
  // reel at ~9 Mbps is ~35MB → ~47MB as base64. TODO(worker): chunked upload
  // before deploying this to CF (worker JSON parse + 128MB isolate limit).
  limit: "120mb",
  verify: (req, _res, buffer) => {
    if ((req as any).originalUrl?.startsWith("/api/content/webhooks/zernio/")) (req as any).rawBody = Buffer.from(buffer);
  },
}));
app.use(rateLimit);
app.use(auth);
app.use(enforceWorkspaceKeyScope);
app.use("/api/templates/:templateId", requireTemplateAccess);
app.use("/api/assets/:resourceId", requireResourceAccess("assets", ["upload", "upload-file", "trash", "migrate-base64"]));
app.use("/api/recipes/:resourceId", requireResourceAccess("recipes"));
app.use("/api/meta/:templateId", requireTemplateAccess);

// Local development bridge for the same MCP handler used by Netlify.
// mcpHandler is untyped .mjs — this mirrors the Netlify lambda event fields
// it reads: headers + queryStringParameters (REQ-011 key fallback).
type McpBridgeEvent = {
  httpMethod: string;
  headers: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  body: string;
};
app.post("/mcp", async (req, res) => {
  try {
    const result = await mcpHandler({
      httpMethod: "POST",
      headers: Object.fromEntries(Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : value || ""])),
      // REQ-011: sin esto la key por query string solo funciona en Netlify —
      // el bridge Express local la descartaba.
      queryStringParameters: req.query as Record<string, string>,
      body: JSON.stringify(req.body),
    } as McpBridgeEvent);
    for (const [name, value] of Object.entries(result.headers || {})) res.setHeader(name, String(value));
    res.status(result.statusCode || 200).send(result.body || "");
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || "MCP bridge failed" });
  }
});

// Local bridge for the render function (PNG frame pages + video export
// pages). Same pattern as the /mcp bridge; apiBase points render.mjs's own
// fetchTemplate back at this server so a local key resolves local data
// instead of silently hitting production.
type RenderBridgeEvent = {
  httpMethod: string;
  path: string;
  headers: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  apiBase: string;
  body: string;
};
app.use("/api/render", async (req, res) => {
  try {
    const result = await renderHandler({
      httpMethod: req.method,
      // Netlify's event.path never carries the query string (it lives in
      // queryStringParameters) — strip it or the handler's /video$ regex misses.
      path: `/api/render${req.url.split("?")[0]}`,
      headers: Object.fromEntries(Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : value || ""])),
      queryStringParameters: req.query as Record<string, string>,
      apiBase: `${req.protocol}://${req.headers.host || "localhost"}`,
      body: "",
    } as RenderBridgeEvent);
    for (const [name, value] of Object.entries(result.headers || {})) res.setHeader(name, String(value));
    res.status(result.statusCode || 200).send(result.body || "");
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || "Render bridge failed" });
  }
});

// REQ-027 — Trigger webhook de Flows: el secreto ES la credencial (la URL se
// muestra UNA vez al crearla/rotarla; en DB vive su sha256). Sin sesión de
// usuario — pasa por auth.ts como ruta pública igual que el dispatch interno
// de webhooks. Estabilidad > velocidad: responde con el RESULTADO del run
// (presupuesto ~25s), idempotente por x-request-id y con cap de concurrencia.
// MCP-first: ejecuta el MISMO engine que flow_run, con el puente al
// dispatcher real de herramientas de Musa.
app.post("/api/flows/webhook/:flowId/:secret", async (req, res) => {
  try {
    if (flowsDisabled()) return res.status(503).json({ ok: false, code: "DISABLED", error: "Flows disabled" });
    const sb = getSupabaseAdmin();
    if (!sb) return res.status(503).json({ ok: false, code: "CONFIG", error: "Storage unavailable" });
    const runtime = createFlowRuntime({ sb, callTool: createFlowToolBridge() });
    const flow = await runtime.store.getFlow(String(req.params.flowId ?? ""), null);
    const match = webhookTriggerMatches(flow, String(req.params.secret ?? ""));
    if (!match.ok) {
      return res.status(match.status || 404).json({ ok: false, code: match.code, error: match.message });
    }
    const input = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    if (JSON.stringify(input).length > LIMITS.inputBytes) {
      return res.status(413).json({ ok: false, code: "INPUT_TOO_LARGE", error: `input supera ${LIMITS.inputBytes} bytes` });
    }
    const headerRequestId = Array.isArray(req.headers["x-request-id"]) ? req.headers["x-request-id"][0] : req.headers["x-request-id"];
    const requestId = String(headerRequestId || (input as any).requestId || "").trim().slice(0, 120) || null;
    // REQ-040: el wake del run (si queda waiting) usa el waitUntil puenteado
    // por el worker (globalThis.__musaWaitUntil, misma convención que
    // services/webhooks.ts); en Node/long-lived cae a promesa flotante.
    const musaWaitUntil = (globalThis as any).__musaWaitUntil;
    const result = await runtime.runFlow(flow, { input, requestId, waitUntil: typeof musaWaitUntil === "function" ? musaWaitUntil : null });
    // F5: trigger.respond = "lastNode" → la respuesta HTTP lleva los outputs de
    // los nodos terminales (estilo n8n "Respond: Last Node"). waiting → 202 SIN
    // resumeToken: la URL del webhook es pública y el token es una capability
    // de reanudación — se recupera por flow_history, no por aquí.
    const triggerCfg = (flow as any)?.trigger ?? null;
    if (triggerCfg?.respond === "lastNode") {
      if (result.status === "success") {
        return res.status(200).json({ ok: true, runId: result.runId, status: result.status, data: result.outputs ?? {} });
      }
      if (result.status === "waiting") {
        return res.status(202).json({ ok: true, runId: result.runId, status: "waiting" });
      }
      return res.status(500).json({ ok: false, runId: result.runId, status: result.status, ...(result.error ? { error: result.error } : {}) });
    }
    return res.status(200).json({
      ok: result.status === "success",
      runId: result.runId,
      status: result.status,
      steps: result.steps,
      ...(result.error ? { error: result.error } : {}),
    });
  } catch (error: any) {
    const code = error?.flowCode;
    // FLOW_RATE_LIMITED (fase 3): mismo trato que CONCURRENCY_LIMIT — 429 le
    // dice al emisor del webhook "backoff", no "reintenta ya".
    const status = code === "CONCURRENCY_LIMIT" || code === "FLOW_RATE_LIMITED" ? 429 : code === "VALIDATION" ? 400 : code === "STORAGE" || code === "CONFIG" ? 503 : 500;
    return res.status(status).json({ ok: false, code: code || "RUN_ERROR", error: error?.message || "flow webhook failed" });
  }
});

// F6 — Callback OAuth2 (apps propias del usuario): el proveedor redirige aquí
// con ?code&state tras el consentimiento. PÚBLICO por diseño (auth.ts): la
// única llave es el state cifrado (AES-256-GCM, expira en 10 min) que solo
// flow_oauth2_connect puede emitir y que ata la conexión a ESA credencial del
// workspace. El exchange usa fetch directo (no guardedFetch): el tokenUrl lo
// configuró el dueño de la credencial (HTTPS validado al guardar) y los E2E
// locales apuntan a un mock http — el engine (nodos http) sí mantiene su
// guard SSRF estricto.
app.get("/api/flows/oauth2/callback", async (req, res) => {
  const page = (ok: boolean, msg: string) =>
    res.status(ok ? 200 : 400).type("html").send(
      `<!doctype html><html lang="es"><meta charset="utf-8"><title>Musa OAuth2</title><body style="font-family:system-ui,sans-serif;background:#0b0d12;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0"><div style="text-align:center;padding:24px"><div style="font-size:13px;letter-spacing:.18em;opacity:.5;margin-bottom:12px">MUSA BY FUTURARIA</div><div style="font-size:22px;font-weight:600">${ok ? "Credencial conectada" : "No se pudo completar"}</div><p style="opacity:.75;max-width:460px;line-height:1.5">${msg}</p><p style="opacity:.45;font-size:13px">Puedes cerrar esta ventana.</p></div></body></html>`
    );
  try {
    if (flowsDisabled()) return page(false, "Flows está deshabilitado en este entorno.");
    const providerError = String((req.query.error as string) ?? "").slice(0, 120);
    if (providerError) return page(false, `El proveedor rechazó la autorización (${providerError}).`);
    const code = String((req.query.code as string) ?? "").slice(0, 2_000);
    const stateRaw = String((req.query.state as string) ?? "").slice(0, 8_000);
    if (!code || !stateRaw) return page(false, "Faltan los parámetros code/state del proveedor.");
    const state = oauth2StateDecode(stateRaw);
    if (!state) return page(false, "El state es inválido o expiró: genera una URL nueva con flow_oauth2_connect.");
    const sb = getSupabaseAdmin();
    if (!sb) return page(false, "Storage no disponible; intenta de nuevo en unos minutos.");
    const runtime = createFlowRuntime({ sb, callTool: createFlowToolBridge() });
    const credential = await (runtime as any).getCredentialDecrypted(null, String((state as any).credentialId ?? ""));
    if (!credential || credential.workspace_id !== (state as any).workspaceId) return page(false, "La credencial ya no existe en este workspace.");
    if (credential.type !== "oauth2") return page(false, "La credencial no es de tipo oauth2.");
    const cfgOauth = (credential as any).oauth_config && typeof (credential as any).oauth_config === "object" ? (credential as any).oauth_config : {};
    if (!cfgOauth.tokenUrl || !cfgOauth.clientId) return page(false, "La credencial está incompleta (clientId/tokenUrl); vuélvela a guardar con flow_credentials_set.");
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: String((state as any).redirectUri ?? ""),
      client_id: String(cfgOauth.clientId),
      client_secret: String(credential.secret ?? ""),
    });
    const tokenRes = await fetch(String(cfgOauth.tokenUrl), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: form.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const rawToken = (await tokenRes.text()).slice(0, 20_000);
    if (!tokenRes.ok) return page(false, `El exchange falló (HTTP ${tokenRes.status}): revisa client_id/client_secret y que redirectUri esté registrada en la app del proveedor.`);
    let tokens: any = null;
    try { tokens = JSON.parse(rawToken); } catch { tokens = null; }
    if (!tokens || typeof tokens !== "object" || !tokens.access_token) return page(false, "El proveedor no devolvió access_token; revisa la config de la credencial.");
    const persist: Record<string, unknown> = {
      access_token: String(tokens.access_token),
      expires_at: Date.now() + (Number(tokens.expires_in) > 0 ? Number(tokens.expires_in) * 1000 : 3_600_000),
      ...(tokens.refresh_token ? { refresh_token: String(tokens.refresh_token) } : {}),
    };
    await runtime.store.updateCredentialTokens(credential.id, encrypt(JSON.stringify(persist)));
    return page(true, `La credencial "${String(credential.name).slice(0, 80)}" quedó conectada: ya puedes usarla en nodos http (credentialId).`);
  } catch (error: any) {
    return page(false, `Error inesperado: ${String(error?.message ?? error).slice(0, 160)}`);
  }
});

// Health
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Supabase's anon key is a public browser credential. Serving it at runtime
// keeps authentication working even when Netlify did not receive VITE_* vars
// during the frontend build. The service-role key is never returned.
app.get("/api/auth/config", (_req, res) => {
  const config = getPublicSupabaseConfig();
  res.setHeader("Cache-Control", "no-store");
  res.json({
    success: true,
    data: {
      configured: Boolean(config),
      authRequired: Boolean(getSupabaseAuthClient() || getSupabaseAdmin()),
      ...(config || {}),
    },
  });
});

// Storage health: answers "is Supabase actually connected?" so the
// Settings UI can show honest indicators for data persistence vs realtime.
app.get("/api/health/storage", (_req, res) => {
  const sb = getSupabase();
  const supabaseConnected = sb !== null;

  // Realtime can use build-time VITE_* values or the runtime publishable key.
  const hasRealtimeVars = !!(
    process.env.VITE_SUPABASE_URL &&
    (process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY)
  );

  const hasRuntimeBrowserConfig = Boolean(getPublicSupabaseConfig());

  res.json({
    supabase: supabaseConnected,
    mode: supabaseConnected ? "supabase" : "memory",
    realtime: hasRealtimeVars || hasRuntimeBrowserConfig,
  });
});

// Route groups
// Stub SOLO local de /api/keys: en producción netlify.toml force-redirecta
// esas rutas a la función keys antes de que lleguen al Express.
app.use("/api/keys", keysStubRoutes);
// Vitrina de skills (solo lectura): catálogo de los SKILL.md de
// .agents/skills — pública, sin datos de usuario, cacheada.
app.use("/api/skills-catalog", skillsCatalogRoutes);
// Proxy LLM same-origin: BYOK sin exponer la key al browser (z.ai y otros
// proveedores no permiten fetch directo por CORS). Auth JWT dentro del router.
app.use("/api/llm", llmProxyRoutes);
app.use("/api/invitations", invitationRoutes);
app.use("/api/account", requireUserSession, accountRoutes);
app.use("/api/onboarding", requireUserSession, personalizedOnboardingRoutes);
app.use("/api/workspaces", workspaceSaasRoutes);
app.use("/api/workspaces", workspaceRoutes);
app.use("/api/templates", templateRoutes);
app.use("/api/templates", layerRoutes);
app.use("/api/templates", frameRoutes);
app.use("/api/templates", toolRoutes);
app.use("/api/templates", renderRoutes);
app.use("/api/templates", batchRoutes);
app.use("/api/templates", specRoutes);
app.use("/api/templates", styleRoutes);
app.use("/api/templates", versionRoutes);
app.use("/api/templates", designCommentRoutes);
app.use("/api/templates", variableRoutes);
app.use("/api/templates", colorRoutes);
app.use("/api/templates", fontRoutes);
app.use("/api/templates", componentRoutes);
app.use("/api/recipes", recipeRoutes);
app.use("/api/assets", assetRoutes);
app.use("/api/photos", photoRoutes);
app.use("/api/design-system", designSystemRoutes);
app.use("/api/webhooks", webhookRoutes);
// ── OpenAPI spec (public, para Make/Zapier/Postman) ──
app.use("/api", openApiRoutes);
app.use("/api/templates", sectionRoutes);
app.use("/api/metrics", metricsRoutes);
// ── Bug Reports (public, no auth) ──
app.use("/api/bug-reports", bugReportRoutes);

// ── Guest mobile comments (public, no auth — /c/:templateId share links) ──
// GET preview + comments, POST comment (+ optional Kanban card).
app.use("/api/comments-share", commentShareRoutes);

// ── Design Knowledge Graph ──
// GET /api/graph?workspaceId=&brand=&tag=&format=
app.get("/api/graph", getDesignGraph);

// ── Brand Hierarchy Graph (Red de Marcas) ──
// GET /api/brand-graph?workspaceId=
app.get("/api/brand-graph", getBrandGraph);

// ── Second Brain (brain_notes, v47) ──
// GET  /api/brain-notes/entity?workspaceId=&kind=&brandId=|templateId=&personaIndex=
// PUT  /api/brain-notes/:slug/human        { workspaceId, humanMd }
// POST /api/brain-notes/backfill           { workspaceId }
app.get("/api/brain-notes/entity", getEntityBrainNote);
app.put("/api/brain-notes/:slug/human", putBrainNoteHuman);
app.post("/api/brain-notes/backfill", postBrainNotesBackfill);

app.use("/api/content", contentRoutes);
app.use("/api/copy-recipes", copyRecipeRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/meta", designMetaRoutes);
app.use("/api/storage", storageRoutes);
app.use("/api/design-imports", designImportRoutes);
app.use("/api/segment", segmentationRoutes);
app.use("/api/fonts/custom", customFontRoutes);
// ── REQ-VID10: Video standalone (modelo CapCut) — superficie REST del humano.
// La IA edita lo mismo vía MCP tools video_*; ambos comparten
// services/videoProjects.ts (mismas tablas musa_video_*).
app.use("/api/video-projects", requireUserSession, videoProjectRoutes);

// ── Google Fonts Catalog ──
// Global endpoint: search/browse the WHOLE Google Fonts library by name or
// category. Nothing is bundled — when the live API is unreachable the response
// says so (live: false) and the picker surfaces a retry, rather than silently
// serving a shrunken list as if it were the full library.
// GET /api/fonts/catalog?search=mont&category=sans-serif&limit=20&offset=0
app.get("/api/fonts/catalog", asyncRoute(async (req, res) => {
  const search = (req.query.search as string || "").toLowerCase();
  const category = req.query.category as string || "";

  const { fonts: allFonts, live } = await buildCatalog();
  let fonts = allFonts;
  if (category) fonts = fonts.filter(f => f.category === category);
  if (search) {
    fonts = fonts.filter(f =>
      f.family.toLowerCase().includes(search) || f.category.toLowerCase().includes(search));
  }

  const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
  const offset = parseInt(req.query.offset as string) || 0;
  const total = fonts.length;
  const paged = fonts.slice(offset, offset + limit);

  // A search that found nothing because the font is licensed gets told so,
  // with what to use instead. An empty list on its own reads as a broken
  // editor rather than as an unavailable typeface.
  const note = paged.length === 0 ? licensedNote(search) : null;

  res.json({ success: true, data: { fonts: paged, total, limit, offset, note, live } });
}));

// ── Unmatched /api routes answer JSON ──
// Express's default 404 writes HTML ("Cannot POST /api/…"). Route drift —
// a frontend newer than its deployed function bundle, or a stale local
// server — then surfaces in the UI as "Unexpected token '<' … is not valid
// JSON" instead of a nameable missing endpoint. Must stay after every route
// group so it only catches fall-throughs, and before the error handler.
app.use("/api", (req: express.Request, res: express.Response) => {
  res.status(404).json({ success: false, error: `Ruta no encontrada: ${req.method} ${req.originalUrl}`, reason: "route_not_found" });
});

/**
 * Last resort. Anything that reaches `next(err)` — a rejected async gate, a
 * body parser refusing malformed input, a throw in a route without its own
 * catch — answers here with JSON.
 *
 * Without it Express falls through to finalhandler, which writes the response
 * with writeHead/end on the raw socket. The Netlify adapter fakes `res` and
 * implements neither, so the invocation would hang to the platform timeout and
 * surface as a bodyless 503. Must stay last: Express picks error handlers by
 * arity and by position.
 */
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = Number(err?.status || err?.statusCode) || 500;
  const message = err?.message || "Internal error";
  console.error(`[api] ${req.method} ${req.path} failed:`, message, err?.stack || "");
  if (res.headersSent) return;
  res.status(status).json({ success: false, error: message });
});

export default app;
