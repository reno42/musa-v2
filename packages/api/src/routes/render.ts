/**
 * Render & Export Routes
 * ──────────────────────────────────────────────────────────────
 * Server-side rendering of design templates to PNG/JPG (via
 * Puppeteer) and SVG (direct generation, no browser needed).
 *
 * @module routes/render
 *
 * Database impact:
 *   - Templates: SELECT data → feeds render engine
 *   - Render logs (render_logs table):
 *       id TEXT PK, template_id TEXT FK, status TEXT, format TEXT,
 *       url TEXT, error TEXT, metadata JSONB, created_at, completed_at
 *   - Storage: design-exports bucket ← rendered files written here
 *
 * External dependency: Puppeteer (chrome-aws-lambda / @sparticuz/chromium)
 *
 * @webhook Fires: render.complete | render.failed (see webhooks route)
 */

import { Router } from "express";
import * as renderer from "../services/renderer.js";

export const renderRoutes = Router();

const renderStore = new Map<string, any>();

/**
 * POST /api/templates/:id/render
 * ──────────────────────────────────────────────────────────────
 * Trigger a render job. Returns immediately with a job ID;
 * actual rendering happens in the background (fire-and-forget
 * or polling via GET /:renderId).
 *
 * @param {string} id         Template ID
 * @body {string} [format=png]  png | jpg | svg
 * @body {number} [scale=2]     Output scale multiplier (1-4)
 * @body {number} [width]       Override canvas width
 * @body {number} [height]      Override canvas height
 *
 * @returns {202} { success, data: { id, status: "pending" } }
 * @returns {404} Template not found
 *
 * DB: INSERT INTO render_logs (id, template_id, status, format)
 * Storage: design-exports/<templateId>/<renderId>.png
 */
renderRoutes.post("/:id/render", async (req, res) => {
  try {
    const { format = "png", scale = 2, width, height } = req.body;
    const result = await renderer.renderTemplate(req.params.id, { format, scale, width, height });
    if (!result) return res.status(404).json({ success: false, error: "Template not found" });

    // Store in memory for polling (until persisted to render_logs)
    renderStore.set(result.id, result);
    res.status(202).json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/templates/:id/render/:renderId
 * ──────────────────────────────────────────────────────────────
 * Poll render job status. Once complete, returns the public URL.
 *
 * @param {string} id         Template ID
 * @param {string} renderId   Job ID from POST response
 *
 * @returns {200} { success, data: { id, status, url?, error? } }
 * @returns {404} Render job not found
 *
 * DB: SELECT status, url, error FROM render_logs WHERE id = :renderId
 */
renderRoutes.get("/:id/render/:renderId", async (req, res) => {
  try {
    const job = renderStore.get(req.params.renderId);
    if (!job) return res.status(404).json({ success: false, error: "Render job not found" });
    res.json({ success: true, data: job });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
