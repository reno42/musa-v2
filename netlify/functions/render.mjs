/**
 * Render Function — Server-side PNG/JPG rendering via chrome-aws-lambda
 * ──────────────────────────────────────────────────────────────
 * Renders Futuraria design templates to PNG/JPG using headless
 * Chromium. Templates are fetched from the REST API (avoids broken
 * cross-function imports that fail in Netlify's per-function bundles).
 *
 * Endpoints:
 *   POST /api/templates/:id/render          → render PNG/JPG
 *   GET  /api/templates/:id/render/:jobId   → poll job status
 *
 * @module functions/render
 */

import _chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { store } from "../../api/src/services/store.js";

// esbuild CJS/ESM interop: @sparticuz/chromium exports may be
// wrapped in .default depending on bundler version
const chromium = _chromium.default || _chromium;

const API_BASE = process.env.URL || "https://bejewelled-llama-a6719d.netlify.app";

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Fetch template from REST API (reads Supabase).
 * Replaces broken cross-function import with an HTTP call
 * that works regardless of Netlify's per-function esbuild bundling.
 */
async function fetchTemplate(id) {
  try {
    const res = await fetch(`${API_BASE}/api/templates/${id}`);
    if (!res.ok) return null;
    const json = await res.json();
    return json?.success ? json.data : null;
  } catch {
    return null;
  }
}

/** Minimal HTML page for headless Chromium to screenshot */
function buildRenderHtml(tpl, width, height) {
  const canvasJson = typeof tpl.canvas === "string"
    ? tpl.canvas
    : JSON.stringify(tpl.canvas);

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<script src="https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js"></script>
<style>*{margin:0;padding:0}body{background:#fff}</style>
</head><body>
<canvas id="c" width="${width}" height="${height}"></canvas>
<script>
var c = new fabric.StaticCanvas('c', {
  width:${width}, height:${height},
  renderOnAddRemove:true, backgroundColor:'#ffffff'
});
c.loadFromJSON(${canvasJson}, function() {
  c.renderAll();
  setTimeout(function(){ c.renderAll(); }, 300);
});
</script></body></html>`;
}

// ─── Periodic cleanup ─────────────────────────────────────────

const JOB_EVICT_MS = 10 * 60 * 1000;

setInterval(() => {
  const cutoff = Date.now() - JOB_EVICT_MS;
  for (const [id, job] of store.renderJobs) {
    if (job.status !== "processing") {
      if (new Date(job.createdAt).getTime() < cutoff) store.renderJobs.delete(id);
    }
  }
}, 60_000).unref?.();

// ─── Netlify Function handler ─────────────────────────────────

export const handler = async (event) => {
  const jsonHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: jsonHeaders };
  }

  // Parse path: /api/templates/:id/render[/:jobId]
  const path = (event.path || "").replace(/^\/api\/templates\//, "");
  const parts = path.split("/").filter(Boolean);
  const templateId = parts[0];
  const action = parts[1]; // "render"
  const jobId = parts[2];  // optional

  // ── GET /api/templates/:id/render/:jobId — poll status ──
  if (event.httpMethod === "GET" && templateId && jobId) {
    const storedJob = store.getRenderJob(jobId);
    if (!storedJob) {
      return {
        statusCode: 404, headers: jsonHeaders,
        body: JSON.stringify({ error: "Render job not found or expired", jobId }),
      };
    }
    if (storedJob.status === "complete" && storedJob.url) {
      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": storedJob.format === "jpg" ? "image/jpeg" : "image/png",
        },
        body: storedJob.url,
        isBase64Encoded: true,
      };
    }
    return {
      statusCode: 200, headers: jsonHeaders,
      body: JSON.stringify({
        jobId: storedJob.id, status: storedJob.status,
        templateId: storedJob.templateId, format: storedJob.format,
        scale: storedJob.scale, createdAt: storedJob.createdAt,
        ...(storedJob.completedAt && { completedAt: storedJob.completedAt }),
        ...(storedJob.error && { error: storedJob.error }),
      }),
    };
  }

  // ── POST /api/templates/:id/render — render PNG/JPG ──
  if (event.httpMethod === "POST" && templateId && action === "render" && !jobId) {
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch { /* defaults */ }

    const format = ["png", "jpg"].includes(body.format) ? body.format : "png";
    const scale = Math.min(Math.max(parseInt(String(body.scale), 10) || 1, 1), 4);

    // ★ Fetch template from REST API (no broken cross-function import)
    const tpl = await fetchTemplate(templateId);
    if (!tpl) {
      return {
        statusCode: 404, headers: jsonHeaders,
        body: JSON.stringify({ error: "Template not found", templateId }),
      };
    }

    const width = Math.round((tpl.width || 1080) * scale);
    const height = Math.round((tpl.height || 1080) * scale);

    const job = store.createRenderJob(templateId, format, scale);
    job.status = "processing";

    try {
      const browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: { width, height },
        executablePath: await Promise.resolve(chromium.executablePath),
        headless: chromium.headless,
      });

      const page = await browser.newPage();
      const html = buildRenderHtml(tpl, width, height);
      await page.setContent(html, { waitUntil: "networkidle0" });

      const screenshotOpts = format === "jpg"
        ? { type: "jpeg", quality: 92 }
        : { type: "png" };

      const buffer = await page.screenshot(screenshotOpts);
      await browser.close();

      const base64 = buffer.toString("base64");

      job.status = "complete";
      job.url = base64;
      job.completedAt = new Date().toISOString();

      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": format === "jpg" ? "image/jpeg" : "image/png",
        },
        body: base64,
        isBase64Encoded: true,
      };
    } catch (e) {
      job.status = "failed";
      job.error = e.message;
      return {
        statusCode: 500, headers: jsonHeaders,
        body: JSON.stringify({ error: "Render failed", message: e.message }),
      };
    }
  }

  return {
    statusCode: 400, headers: jsonHeaders,
    body: JSON.stringify({ error: "POST /api/templates/:id/render to render, GET /api/templates/:id/render/:jobId to poll" }),
  };
};
