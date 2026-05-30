/**
 * Render Function — Template visualization via self-rendering HTML
 * ──────────────────────────────────────────────────────────────
 * Returns a self-contained HTML page that renders Futuraria design
 * templates using Fabric.js in the browser. No server-side binaries
 * required (avoids Chromium/libnss3 issues on Netlify Lambda).
 *
 * Endpoints:
 *   POST /api/render/:templateId  → returns self-rendering HTML page
 *   GET  /api/render/:templateId/:jobId → poll/retrieve stored render
 *
 * @module functions/render
 */

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
 * via Fabric.js v5 CDN with interactive UI for visualization
 * and PNG download.
 */
function buildRenderPage(tpl, width, height, format, scale, templateId) {
  const canvasJson = typeof tpl.canvas === "string"
    ? tpl.canvas
    : JSON.stringify(tpl.canvas);

  const safeName = (tpl.name || templateId || "template")
    .replace(/[<>:"/\\|?*]/g, "_");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeName} — Futuraria Render</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js"></script>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #f0f0f0;
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: 100vh;
    padding: 20px;
  }
  .toolbar {
    background: #fff;
    border-radius: 8px;
    padding: 12px 20px;
    margin-bottom: 16px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
  }
  .toolbar h2 {
    font-size: 16px;
    margin-right: auto;
    color: #333;
  }
  .toolbar button {
    padding: 8px 16px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: background 0.15s;
  }
  .btn-download { background:#3B82F6; color:#fff; }
  .btn-download:hover { background:#2563EB; }
  .btn-download-jpg { background:#059669; color:#fff; }
  .btn-download-jpg:hover { background:#047857; }
  .btn-download-svg { background:#7C3AED; color:#fff; }
  .btn-download-svg:hover { background:#6D28D9; }
  .canvas-wrap {
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
    padding: 20px;
    overflow: auto;
  }
  .canvas-wrap canvas { display:block; }
  .info {
    margin-top: 12px;
    font-size: 12px;
    color: #888;
  }
  .status-msg {
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 13px;
  }
  .status-ok { background:#D1FAE5; color:#065F46; }
  .status-err { background:#FEE2E2; color:#991B1B; }
</style>
</head>
<body>
<div class="toolbar">
  <h2>${safeName}</h2>
  <button class="btn-download" onclick="downloadCanvas('png')">⬇ Download PNG</button>
  <button class="btn-download-jpg" onclick="downloadCanvas('jpg')">⬇ Download JPG</button>
  <button class="btn-download-svg" onclick="downloadSvg()">⬇ Download SVG</button>
  <span id="status" class="status-msg status-ok">Rendered ✓</span>
</div>
<div class="canvas-wrap">
  <canvas id="c" width="${width}" height="${height}"></canvas>
</div>
<div class="info">
  ${width}×${height}px · scale ${scale}× · ${format.toUpperCase()}
</div>

<script>
(function() {
  var width = ${width};
  var height = ${height};
  var format = "${format}";

  var fabricCanvas = new fabric.StaticCanvas('c', {
    width: width,
    height: height,
    renderOnAddRemove: true,
    backgroundColor: '#ffffff'
  });

  fabricCanvas.loadFromJSON(${canvasJson}, function() {
    fabricCanvas.renderAll();
    // Double render for async objects
    setTimeout(function() {
      fabricCanvas.renderAll();
    }, 200);
  });

  // ── Download helpers ──
  window.downloadCanvas = function(fmt) {
    var dataUrl;
    if (fmt === 'jpg') {
      dataUrl = fabricCanvas.toDataURL({ format: 'jpeg', quality: 0.92, multiplier: 1 });
    } else {
      dataUrl = fabricCanvas.toDataURL({ format: 'png', multiplier: 1 });
    }
    var a = document.createElement('a');
    a.href = dataUrl;
    a.download = '${safeName}.' + fmt;
    a.click();
  };

  window.downloadSvg = function() {
    var svg = fabricCanvas.toSVG();
    var blob = new Blob([svg], { type: 'image/svg+xml' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '${safeName}.svg';
    a.click();
    URL.revokeObjectURL(url);
  };
})();
</script>
</body></html>`;
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
 * POST /api/render/:templateId  → returns self-rendering HTML page
 * GET  /api/render/:templateId/:jobId → retrieve stored render job
 */
export const handler = async (event) => {
  const jsonHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    "Content-Type": "application/json",
  };
  const htmlHeaders = {
    ...jsonHeaders,
    "Content-Type": "text/html; charset=utf-8",
  };

  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: jsonHeaders };
  }

  // Parse path: /api/render/:templateId[/:jobId]
  const path = (event.path || "").replace(/^\/api\/render\/?/, "");
  const parts = path.split("/").filter(Boolean);
  const templateId = parts[0];
  const jobId = parts[1];

  // ── GET /api/render/:templateId/:jobId — poll/retrieve job ──
  if (event.httpMethod === "GET" && templateId && jobId) {
    const storedJob = store.getRenderJob(jobId);
    if (!storedJob) {
      return {
        statusCode: 404,
        headers: jsonHeaders,
        body: JSON.stringify({ error: "Render job not found or expired", jobId }),
      };
    }
    // If an HTML page was stored, serve it
    if (storedJob.url && storedJob.status === "complete") {
      return {
        statusCode: 200,
        headers: htmlHeaders,
        body: storedJob.url,
      };
    }
    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({
        jobId: storedJob.id,
        status: storedJob.status,
        templateId: storedJob.templateId,
        format: storedJob.format,
        scale: storedJob.scale,
        createdAt: storedJob.createdAt,
        ...(storedJob.completedAt && { completedAt: storedJob.completedAt }),
        ...(storedJob.error && { error: storedJob.error }),
      }),
    };
  }

  // ── POST /api/render/:templateId — generate HTML page ──
  if (event.httpMethod === "POST" && templateId && !jobId) {
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch { /* use defaults */ }

    const format = ["png", "jpg", "svg"].includes(body.format) ? body.format : "png";
    const scale = Math.min(Math.max(parseInt(String(body.scale), 10) || 1, 1), 4);
    // Accept template data directly (avoids cross-container lookup on Netlify)
    const providedTemplate = body.template || null;

    // Load template
    const tpl = providedTemplate || await getTemplate(templateId);
    if (!tpl) {
      return {
        statusCode: 404,
        headers: jsonHeaders,
        body: JSON.stringify({ error: "Template not found", templateId }),
      };
    }

    const baseW = tpl.width || 1080;
    const baseH = tpl.height || 1080;
    const width = Math.round(baseW * scale);
    const height = Math.round(baseH * scale);

    // Build self-rendering HTML page
    const html = buildRenderPage(tpl, width, height, format, scale, templateId);

    // Store render job for polling
    const job = store.createRenderJob(templateId, format, scale);
    job.status = "complete";
    job.url = html;
    job.completedAt = new Date().toISOString();

    // Check if client wants JSON or HTML
    const acceptHeader = event.headers?.accept || "";
    const wantsHtml = acceptHeader.includes("text/html") || body.returnHtml;

    if (wantsHtml) {
      return {
        statusCode: 200,
        headers: htmlHeaders,
        body: html,
      };
    }

    // Default: return JSON with HTML content and jobId
    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({
        jobId: job.id,
        status: "complete",
        templateId,
        format,
        scale,
        width,
        height,
        html: html,
        _links: {
          view: `/api/render/${templateId}/${job.id}`,
        },
      }),
    };
  }

  // ── Fallback ──
  return {
    statusCode: 400,
    headers: jsonHeaders,
    body: JSON.stringify({
      error: "POST /api/render/:templateId to render, GET /api/render/:templateId/:jobId to poll",
    }),
  };
};
