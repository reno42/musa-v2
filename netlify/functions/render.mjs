/**
 * Render Function — Server-side template rendering via Puppeteer
 * ──────────────────────────────────────────────────────────────
 * Renders Futuraria design templates to PNG/JPG using headless
 * Chromium. Designed for Netlify Free tier (10s timeout, 50MB limit).
 *
 * Endpoints:
 *   POST /api/render/:templateId  → synchronous render (returns image)
 *
 * Dependencies: chrome-aws-lambda, puppeteer-core
 * Chromium binary: ~44MB (external — not bundled by esbuild)
 *
 * @module functions/render
 */

import puppeteer from "puppeteer-core";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const chromium = require("@sparticuz/chromium");
import { getSupabase } from "../../api/src/services/supabase.js";
import { store } from "../../api/src/services/store.js";

// ─── Helpers ─────────────────────────────────────────────────

/** Fetch template from Supabase or fall back to in-memory store */
async function getTemplate(id) {
  const sb = getSupabase();
  if (sb) {
    try {
      const { data, error } = await sb.from("templates")
        .select("*").eq("id", id).single();
      if (!error && data?.data) return data.data;
    } catch { /* fall through */ }
  }
  return store.getTemplate(id);
}

/**
 * Build a self-contained HTML page that renders the template
 * via Fabric.js v5 CDN, then signals readiness via window.__renderDone.
 *
 * Uses Fabric.js v5 CDN for reliable global `fabric` object.
 * v5 StaticCanvas.loadFromJSON is compatible with v6 serialized JSON
 * for all core shape types (rect, circle, text, group, path, image).
 */
function buildRenderHtml(tpl, width, height) {
  const canvasJson = typeof tpl.canvas === "string"
    ? tpl.canvas
    : JSON.stringify(tpl.canvas);
  // Inject viewport and dimensions so loadFromJSON respects them
  const injectJson = JSON.stringify({
    ...JSON.parse(canvasJson),
    width,
    height,
  });

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<script src="https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js"></script>
<style>
  body { margin:0; padding:0; overflow:hidden; background:#fff; }
  canvas { display:block; }
</style>
</head>
<body>
<canvas id="c" width="${width}" height="${height}"></canvas>
<script>
(function() {
  var canvas = new fabric.StaticCanvas('c', {
    width: ${width},
    height: ${height},
    renderOnAddRemove: false
  });
  var json = ${injectJson};
  canvas.loadFromJSON(json, function() {
    canvas.renderAll();
    // Double-render to ensure all async objects (images) settle
    setTimeout(function() {
      canvas.renderAll();
      window.__renderDone = true;
    }, 300);
  });
})();
</script>
</body></html>`;
}

/** Build a simple HTML page for SVG export (no browser needed) */
function buildSvgHtml(tpl, width, height) {
  const canvasJson = typeof tpl.canvas === "string"
    ? tpl.canvas
    : JSON.stringify(tpl.canvas);
  const injectJson = JSON.stringify({
    ...JSON.parse(canvasJson),
    width,
    height,
  });

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<script src="https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js"></script>
<style>body{margin:0;padding:0;overflow:hidden}</style>
</head>
<body>
<canvas id="c" width="${width}" height="${height}"></canvas>
<script>
(function() {
  var canvas = new fabric.StaticCanvas('c', { width:${width}, height:${height} });
  canvas.loadFromJSON(${injectJson}, function() {
    canvas.renderAll();
    window.__svg = canvas.toSVG();
    window.__renderDone = true;
  });
})();
</script></body></html>`;
}

// ─── Render engine (synchronous — returns result directly) ─────

async function doRenderSync(templateId, format, scale, providedTemplate) {
  const t0 = Date.now();
  try {
    // 1. Load template (from provided data, Supabase, or in-memory fallback)
    const tpl = providedTemplate || await getTemplate(templateId);
    if (!tpl) {
      return { status: "failed", error: "Template not found", elapsedMs: Date.now() - t0 };
    }

    const baseW = tpl.width || 1080;
    const baseH = tpl.height || 1080;
    const width = Math.round(baseW * scale);
    const height = Math.round(baseH * scale);
    const isSvg = format === "svg";

    // 2. Build render HTML
    const html = isSvg
      ? buildSvgHtml(tpl, width, height)
      : buildRenderHtml(tpl, width, height);

    // 3. Launch headless Chromium via @sparticuz/chromium
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { ...chromium.defaultViewport, width, height, deviceScaleFactor: 1 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
      timeout: 8000,
    });

    let result;
    try {
      const page = await browser.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: scale });

      // Set content (loads Fabric.js from CDN)
      await page.setContent(html, {
        waitUntil: "networkidle0",
        timeout: 8000,
      });

      // Wait for Fabric.js to signal render completion
      await page.waitForFunction("window.__renderDone === true", {
        timeout: 6000,
      });

      if (isSvg) {
        result = await page.evaluate(() => window.__svg);
      } else {
        // Screenshot the canvas element directly for crisp output
        const canvasEl = await page.$("#c");
        const buffer = await canvasEl.screenshot({
          type: format === "jpg" ? "jpeg" : "png",
          quality: format === "jpg" ? 92 : undefined,
        });
        const base64 = buffer.toString("base64");
        const mime = format === "jpg" ? "image/jpeg" : "image/png";
        result = `data:${mime};base64,${base64}`;
      }
    } finally {
      await browser.close();
    }

    const elapsed = Date.now() - t0;
    return {
      status: "complete",
      templateId,
      format,
      scale,
      width,
      height,
      dataUrl: result,
      elapsedMs: elapsed,
    };
  } catch (err) {
    const elapsed = Date.now() - t0;
    return {
      status: "failed",
      error: err.message || "Render failed",
      elapsedMs: elapsed,
    };
  }
}

// ─── Periodic cleanup ─────────────────────────────────────────

// Idle render jobs are evicted after 10 minutes (container lifetime)
const JOB_EVICT_MS = 10 * 60 * 1000;

setInterval(() => {
  const cutoff = Date.now() - JOB_EVICT_MS;
  for (const [id, job] of store.renderJobs) {
    if (job.status !== "processing") {
      const created = new Date(job.createdAt).getTime();
      if (created < cutoff) store.renderJobs.delete(id);
    }
  }
}, 60_000).unref?.();

// ─── Netlify Function handler ─────────────────────────────────

/**
 * POST /api/render/:templateId  → synchronous render, returns image + jobId
 * GET  /api/render/:templateId/:jobId → poll job status
 */
export const handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    "Content-Type": "application/json",
  };

  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers };
  }

  // Parse path: /api/render/:templateId[/:jobId]
  const path = (event.path || "").replace(/^\/api\/render\/?/, "");
  const parts = path.split("/").filter(Boolean);
  const templateId = parts[0];
  const jobId = parts[1];

  // ── GET /api/render/:templateId/:jobId — poll job status ──
  if (event.httpMethod === "GET" && templateId && jobId) {
    const storedJob = store.getRenderJob(jobId);
    if (!storedJob) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Render job not found or expired", jobId }),
      };
    }
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        jobId: storedJob.id,
        status: storedJob.status,
        templateId: storedJob.templateId,
        format: storedJob.format,
        scale: storedJob.scale,
        createdAt: storedJob.createdAt,
        // Include result if complete
        ...(storedJob.url && { dataUrl: storedJob.url }),
        ...(storedJob.completedAt && { completedAt: storedJob.completedAt }),
        ...(storedJob.error && { error: storedJob.error }),
      }),
    };
  }

  // ── POST /api/render/:templateId — synchronous render ──
  if (event.httpMethod === "POST" && templateId && !jobId) {
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch { /* use defaults */ }

    const format = ["png", "jpg", "svg"].includes(body.format) ? body.format : "png";
    const scale = Math.min(Math.max(parseInt(String(body.scale), 10) || 2, 1), 4);
    // Accept template data directly (avoids cross-container lookup on Netlify)
    const providedTemplate = body.template || null;

    // Create render job record
    const job = store.createRenderJob(templateId, format, scale);

    // Synchronous render — completes within 6-8s (under 10s Netlify limit)
    const result = await doRenderSync(templateId, format, scale, providedTemplate);

    // Update job with result
    if (result.status === "complete") {
      job.status = "complete";
      job.url = result.dataUrl;
      job.completedAt = new Date().toISOString();
    } else {
      job.status = "failed";
      job.error = result.error;
      job.completedAt = new Date().toISOString();
    }

    if (result.status === "failed") {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ jobId: job.id, status: "failed", error: result.error }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        jobId: job.id,
        status: "complete",
        templateId,
        format,
        scale,
        width: result.width,
        height: result.height,
        dataUrl: result.dataUrl,
        elapsedMs: result.elapsedMs,
      }),
    };
  }

  // ── Fallback ──
  return {
    statusCode: 400,
    headers,
    body: JSON.stringify({
      error: "POST /api/render/:templateId to render, GET /api/render/:templateId/:jobId to poll",
    }),
  };
};
