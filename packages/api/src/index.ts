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

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);

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
app.use("/api/webhooks", webhookRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Futuraria API running at http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
});

export default app;
