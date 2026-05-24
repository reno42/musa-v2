// packages/api/src/app.ts
// Express app configuration (no side effects — no app.listen)
// Used by both the standalone server (index.ts) and Netlify functions.

import "dotenv/config";
import express from "express";
import cors from "cors";
import { templateRoutes } from "./routes/templates";
import { layerRoutes } from "./routes/layers";
import { renderRoutes } from "./routes/render";
import { webhookRoutes } from "./routes/webhooks";
import { styleRoutes } from "./routes/styles";
import { componentRoutes } from "./routes/components";
import { commentRoutes } from "./routes/comments";
import { versionRoutes } from "./routes/versions";
import { variableRoutes } from "./routes/variables";
import { branchRoutes } from "./routes/branches";
import { apiKeyRoutes } from "./routes/api-keys";
import csvProxyRoutes from "./routes/csv-proxy";
import batchRoutes from "./routes/batch-routes";
import cssRoutes from "./routes/css-routes";
import autoRenameRoutes from "./routes/auto-rename-routes";
import { authenticate, crudRateLimit, renderRateLimit } from "./middleware";

const app = express();

// ── CORS Configuration ──
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim())
  : [
      "https://design.futuraria.com",
      "https://editor.futuraria.com",
      "http://localhost:3000",
      "http://localhost:5173",
    ];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
        return callback(null, true);
      }
      callback(new Error(`CORS: Origin ${origin} not allowed`));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-API-Key", "Authorization"],
    exposedHeaders: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
    credentials: true,
    maxAge: 86400,
  })
);

// ── Body Parser ──
app.use(express.json({ limit: "50mb" }));

// ── Health Check (no auth required) ──
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "3.0.0",
    features: ["templates", "layers", "render", "webhooks", "styles", "components", "comments", "versions", "variables", "sections", "branches", "batch", "css-export", "auto-rename"],
  });
});

// ── Public Config Endpoint (no auth required) ──
app.get("/api/config", (_req, res) => {
  res.json({
    version: "3.0.0",
    features: ["templates", "layers", "render", "webhooks", "styles", "components", "comments", "versions", "variables", "sections", "branches", "csv-proxy", "batch", "css-export", "auto-rename"],
  });
});

// ── CSV Proxy (no auth required — Google Sheets fetch) ──
app.use("/api", csvProxyRoutes);

// ── Apply Authentication to all API routes ──
app.use("/api/templates", authenticate);
app.use("/api/webhooks", authenticate);
app.use("/api/styles", authenticate);
app.use("/api/components", authenticate);
app.use("/api/comments", authenticate);

// ── Apply Rate Limiting ──
app.use("/api/templates", crudRateLimit);
app.use("/api/webhooks", crudRateLimit);
app.use("/api/styles", crudRateLimit);
app.use("/api/components", crudRateLimit);
app.use("/api/comments", crudRateLimit);

// ── Routes ──
app.use("/api/templates", templateRoutes);
app.use("/api/templates", layerRoutes);
app.use("/api/templates", authenticate, crudRateLimit, branchRoutes);
app.use("/api/templates", versionRoutes);
app.use("/api/templates", renderRateLimit, renderRoutes);
app.use("/api/templates", authenticate, crudRateLimit, batchRoutes);
app.use("/api/templates", authenticate, crudRateLimit, cssRoutes);
app.use("/api/templates", authenticate, crudRateLimit, autoRenameRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/api/styles", styleRoutes);
app.use("/api/components", componentRoutes);
app.use("/api/comments", commentRoutes);

app.use("/api/variables", authenticate);
app.use("/api/variables", crudRateLimit);
app.use("/api/variables", variableRoutes);

// ── API Keys Routes ──
app.use("/api/api-keys", authenticate);
app.use("/api/api-keys", crudRateLimit);
app.use("/api/api-keys", apiKeyRoutes);

// ── Error Handler ──
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("[ERROR]", err.message);
    if (err.message.startsWith("CORS:")) {
      return res.status(403).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
);

export { app };
