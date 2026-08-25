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
import { batchRoutes } from "./routes/batch.js";
import { specRoutes } from "./routes/specs.js";
import { styleRoutes } from "./routes/styles.js";
import { versionRoutes } from "./routes/versions.js";
import { designCommentRoutes } from "./routes/designComments.js";
import { commentShareRoutes } from "./routes/commentShare.js";
import { variableRoutes } from "./routes/variables.js";
import { colorRoutes } from "./routes/colors.js";
import { fontRoutes } from "./routes/fonts.js";
import { componentRoutes } from "./routes/components.js";
import { recipeRoutes } from "./routes/recipes.js";
import { assetRoutes } from "./routes/assets.js";
import { designSystemRoutes } from "./routes/designSystem.js";
import { sectionRoutes } from "./routes/sections.js";
import { metricsRoutes } from "./routes/metrics.js";
import { designMetaRoutes, getDesignGraph } from "./routes/designMeta.js";
import { getBrandGraph } from "./routes/brandGraph.js";
import { storageRoutes } from "./routes/storage.js";
import { segmentationRoutes } from "./routes/segmentation.js";
import { contentRoutes } from "./routes/contentCalendar.js";
import { chatRoutes } from "./routes/chatHistory.js";
import { bugReportRoutes } from "./routes/bugReports.js";
import { accountRoutes, invitationRoutes, workspaceSaasRoutes } from "./routes/saas.js";
import { getPublicSupabaseConfig, getSupabase, getSupabaseAdmin, getSupabaseAuthClient } from "./services/supabase.js";
import { enforceWorkspaceKeyScope, requireResourceAccess, requireTemplateAccess } from "./services/tenancy.js";
import fontCatalog from "./data/google-fonts.json" with { type: "json" };
import { buildCatalog, licensedNote } from "./services/fontCatalog.js";
import { asyncRoute } from "./middleware/asyncRoute.js";
import { handler as mcpHandler } from "../../netlify/functions/mcp.mjs";

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));
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
app.use("/api/invitations", invitationRoutes);
app.use("/api/account", requireUserSession, accountRoutes);
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
app.use("/api/design-system", designSystemRoutes);
app.use("/api/webhooks", webhookRoutes);
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

app.use("/api/content", contentRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/meta", designMetaRoutes);
app.use("/api/storage", storageRoutes);
app.use("/api/segment", segmentationRoutes);

// ── Google Fonts Catalog ──
// Global endpoint: search/browse 94 popular Google Fonts by name or category
// GET /api/fonts/catalog?search=mont&category=sans-serif&limit=20&offset=0
app.get("/api/fonts/catalog", asyncRoute(async (req, res) => {
  const search = (req.query.search as string || "").toLowerCase();
  const category = req.query.category as string || "";

  // System fonts first, then Google — bundled, or the full ~1800 when
  // GOOGLE_FONTS_API_KEY is set.
  let fonts = await buildCatalog(fontCatalog as Array<{family: string; category: string; variants: string[]}>);
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

  res.json({ success: true, data: { fonts: paged, total, limit, offset, note } });
}));

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
