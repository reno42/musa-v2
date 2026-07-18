import express from "express";
import cors from "cors";
import { auth } from "./middleware/auth.js";
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
import { commentRoutes } from "./routes/comments.js";
import { variableRoutes } from "./routes/variables.js";
import { colorRoutes } from "./routes/colors.js";
import { fontRoutes } from "./routes/fonts.js";
import { componentRoutes } from "./routes/components.js";
import { recipeRoutes } from "./routes/recipes.js";
import { assetRoutes } from "./routes/assets.js";
import { designSystemRoutes } from "./routes/designSystem.js";
import { sectionRoutes } from "./routes/sections.js";
import { metricsRoutes } from "./routes/metrics.js";
import { designMetaRoutes } from "./routes/designMeta.js";
import { storageRoutes } from "./routes/storage.js";
import { getSupabase } from "./services/supabase.js";
import fontCatalog from "./data/google-fonts.json" with { type: "json" };
import { handler as mcpHandler } from "../../netlify/functions/mcp.mjs";

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(rateLimit);
app.use(auth);

// Local development bridge for the same MCP handler used by Netlify.
app.post("/mcp", async (req, res) => {
  try {
    const result = await mcpHandler({
      httpMethod: "POST",
      headers: Object.fromEntries(Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : value || ""])),
      body: JSON.stringify(req.body),
    });
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

// Storage health: answers "is Supabase actually connected?" so the
// Settings UI can show honest indicators for data persistence vs realtime.
app.get("/api/health/storage", (_req, res) => {
  const sb = getSupabase();
  const supabaseConnected = sb !== null;

  // Realtime requires the browser-side VITE_* vars, which we can't check
  // server-side. The Dashboard queries this to show the correct status.
  const hasRealtimeVars = !!(
    process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY
  );

  // Also check Netlify-side env vars as fallback
  const hasFallbackVars = !!(
    (process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL_DE_REPO_DESIGN) &&
    (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY_DE_REPO_DESIGN)
  );

  res.json({
    supabase: supabaseConnected,
    mode: supabaseConnected ? "supabase" : "memory",
    realtime: hasRealtimeVars || hasFallbackVars,
  });
});

// Route groups
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
app.use("/api/templates", commentRoutes);
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
// ── Design Knowledge Graph ──
// GET /api/graph?workspaceId=&brand=&tag=&format=
app.get("/api/graph", async (req, res) => {
  try {
    const { workspaceId, brand, tag, format } = req.query;
    const sb = getSupabase();
    if (!sb) return res.json({ success: true, data: { nodes: [], edges: [] } });

    let query = sb.from("design_file_meta").select("*, templates!inner(id, name, thumbnail)");
    if (workspaceId) query = query.eq("workspace_id", workspaceId as string);
    if (brand) query = query.eq("brand", brand as string);
    if (tag) query = query.contains("tags", [tag as string]);
    if (format) query = query.eq("format", format as string);

    const { data, error } = await query;
    if (error) throw error;

    const nodes = (data || []).map((r: any) => ({
      id: r.template_id,
      name: r.templates?.name || r.template_id,
      brand: r.brand,
      tags: r.tags || [],
      theme: r.theme,
      format: r.format,
      file_type: r.file_type,
      cover: r.cover_image_url || r.templates?.thumbnail || null,
      obsidian_link: r.obsidian_link,
    }));

    const edges: { source: string; target: string; kind: string }[] = [];
    const brandGroups = new Map<string, string[]>();
    const tagGroups = new Map<string, string[]>();
    for (const n of nodes) {
      if (n.brand) {
        const group = brandGroups.get(n.brand) || [];
        group.push(n.id);
        brandGroups.set(n.brand, group);
      }
      for (const t of n.tags) {
        const group = tagGroups.get(t) || [];
        group.push(n.id);
        tagGroups.set(t, group);
      }
    }
    for (const [, ids] of brandGroups) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          edges.push({ source: ids[i], target: ids[j], kind: "brand" });
        }
      }
    }
    for (const [, ids] of tagGroups) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          edges.push({ source: ids[i], target: ids[j], kind: "tag" });
        }
      }
    }

    res.json({ success: true, data: { nodes, edges } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.use("/api/meta", designMetaRoutes);
app.use("/api/storage", storageRoutes);

// ── Google Fonts Catalog ──
// Global endpoint: search/browse 94 popular Google Fonts by name or category
// GET /api/fonts/catalog?search=mont&category=sans-serif&limit=20&offset=0
app.get("/api/fonts/catalog", (req, res) => {
  try {
    const search = (req.query.search as string || "").toLowerCase();
    const category = req.query.category as string || "";
    let fonts = fontCatalog as Array<{family:string; category:string; variants:string[]}>;
    if (category) {
      fonts = fonts.filter(f => f.category === category);
    }
    if (search) {
      fonts = fonts.filter(f =>
        f.family.toLowerCase().includes(search) ||
        f.category.toLowerCase().includes(search)
      );
    }
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const total = fonts.length;
    const paged = fonts.slice(offset, offset + limit);
    res.json({ success: true, data: { fonts: paged, total, limit, offset } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default app;
