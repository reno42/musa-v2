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
import fontCatalog from "./data/google-fonts.json";

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(rateLimit);
app.use(auth);

// Health
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
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
app.use("/api/webhooks", webhookRoutes);

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
