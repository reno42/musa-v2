/**
 * Render Function — Self-rendering HTML with auto-download
 * ──────────────────────────────────────────────────────────────
 * Returns a self-contained HTML page that renders Futuraria
 * design templates via Fabric.js v5 CDN in the browser, then
 * auto-downloads the result as PNG. Zero server-side binary
 * dependencies (avoids Chromium/libnss3 issues on Netlify).
 *
 * Endpoints:
 *   POST /api/templates/:id/render          → render + auto-download
 *   POST /api/render/:templateId            → legacy compat
 *   GET  /api/render/:templateId/:jobId     → retrieve stored render
 *
 * @module functions/render
 */

import { store } from "../../api/src/services/store.js";

const API_BASE = process.env.URL || "https://bejewelled-llama-a6719d.netlify.app";

// ─── Helpers ─────────────────────────────────────────────────

/** Fetch template from REST API (reads Supabase across containers) */
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

/**
 * Extract unique Google Font families from template canvas objects.
 */
function extractFonts(tpl) {
  const fonts = new Set();
  const walk = (objs) => {
    for (const o of objs || []) {
      if (o.fontFamily && o.fontFamily !== "Inter" && o.fontFamily !== "sans-serif") {
        fonts.add(o.fontFamily);
      }
      if (o.objects) walk(o.objects);
    }
  };
  walk(tpl.canvas?.objects || []);
  return [...fonts];
}

/**
 * Build Google Fonts CSS link tags for fonts used in the template.
 * Always includes Inter (the editor default) plus any template-specific fonts.
 * Loads weights 400,500,700,800 for full design coverage.
 */
function googleFontsLinks(tpl) {
  const fonts = extractFonts(tpl);
  // Inter is always needed as the base UI/design font
  const allFonts = ["Inter", ...fonts.filter(f => f !== "Inter")];
  return allFonts.map(f =>
    `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${f.replace(/ /g, "+")}:wght@400;500;700;800&display=swap">`
  ).join("\n");
}

/** Parse an SVG path 'd' string into Fabric.js path command arrays */
function parseSvgPathData(d) {
  const commands = [];
  const re = /([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g;
  let m;
  while ((m = re.exec(d)) !== null) {
    const cmd = m[1];
    const args = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    commands.push([cmd, ...args]);
  }
  return commands;
}

/** Convert an SVG-like gradient description to Fabric.js v5 gradient format */
function svgGradientToFabric(grad) {
  const angle = grad.angle || 0;
  const stops = (grad.colorStops || grad.stops || []).map(s => ({
    offset: s.offset != null ? s.offset : s.position,
    color: s.color || "",
  }));
  const rad = (angle - 90) * Math.PI / 180;
  const x1 = grad.x1 != null ? grad.x1 : 0.5 - Math.cos(rad) * 0.5;
  const y1 = grad.y1 != null ? grad.y1 : 0.5 - Math.sin(rad) * 0.5;
  const x2 = grad.x2 != null ? grad.x2 : 0.5 + Math.cos(rad) * 0.5;
  const y2 = grad.y2 != null ? grad.y2 : 0.5 + Math.sin(rad) * 0.5;
  return {
    type: "linear",
    coords: { x1, y1, x2, y2 },
    colorStops: stops,
  };
}

/**
 * Pre-process canvas JSON for the browser-side Fabric.js renderer:
 * - Converts SVG pathData strings to Fabric.js path command arrays
 * - Converts gradient objects to Fabric.js v5-compatible format
 * - Extracts backgroundImage for async loading after loadFromJSON
 */
function prepareCanvasJson(tpl) {
  const rawCanvas = typeof tpl.canvas === "object"
    ? JSON.parse(JSON.stringify(tpl.canvas))
    : JSON.parse(tpl.canvas || "{}");
  const bgImage = rawCanvas.backgroundImage || null;
  delete rawCanvas.backgroundImage;

  function walk(objs) {
    for (const o of objs || []) {
      if (o.type === "path" && typeof o.pathData === "string" && (!o.path || !o.path.length)) {
        o.path = parseSvgPathData(o.pathData);
        delete o.pathData;
      }
      if (o.fill && typeof o.fill === "object" && o.fill.type === "linear") {
        o.fill = svgGradientToFabric(o.fill);
      }
      if (o.objects) walk(o.objects);
      if (o._objects) walk(o._objects);
    }
  }
  walk(rawCanvas.objects || []);

  return { canvas: rawCanvas, bgImage };
}

/**
 * Build a self-contained HTML page that renders the template
 * via Fabric.js v5 CDN and auto-downloads as PNG on load.
 */
function buildRenderPage(tpl, width, height, format, scale, templateId) {
  const { canvas: canvasData, bgImage } = prepareCanvasJson(tpl);
  const canvasJson = JSON.stringify(canvasData);

  const safeName = (tpl.name || templateId || "template")
    .replace(/[<>:"/\\|?*]/g, "_");

  const fontsCss = googleFontsLinks(tpl);
  const bgImageJson = bgImage ? JSON.stringify(bgImage) : "null";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeName} — Futuraria Render</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js"></script>
${fontsCss}
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #e5e7eb;
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: 100vh;
    padding: 16px;
  }
  .toolbar {
    background: #fff;
    border-radius: 8px;
    padding: 10px 18px;
    margin-bottom: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
    max-width: 800px;
    width: 100%;
  }
  .toolbar h2 {
    font-size: 15px;
    margin-right: auto;
    color: #333;
  }
  .toolbar button {
    padding: 7px 14px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
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
    padding: 16px;
    overflow: auto;
    max-width: 100vw;
  }
  .canvas-wrap canvas { display:block; }
  .info {
    margin-top: 10px;
    font-size: 11px;
    color: #888;
  }
  .status-msg {
    padding: 6px 12px;
    border-radius: 5px;
    font-size: 12px;
  }
  .status-ok { background:#D1FAE5; color:#065F46; }
  .status-err { background:#FEE2E2; color:#991B1B; }
</style>
</head>
<body>
<div class="toolbar">
  <h2>${safeName}</h2>
  <button class="btn-download" onclick="downloadCanvas('png')">⬇ PNG</button>
  <button class="btn-download-jpg" onclick="downloadCanvas('jpg')">⬇ JPG</button>
  <button class="btn-download-svg" onclick="downloadSvg()">⬇ SVG</button>
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
  var safeName = "${safeName}";
  var bgImage = ${bgImageJson};

  var canvas = new fabric.StaticCanvas('c', {
    width: width,
    height: height,
    renderOnAddRemove: true,
    backgroundColor: '#ffffff'
  });

  /** Parse an SVG path 'd' string into Fabric.js path command arrays */
  function parseSvgPathData(d) {
    var commands = [];
    var re = /([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g;
    var m;
    while ((m = re.exec(d)) !== null) {
      var cmd = m[1];
      var args = m[2].trim().split(/[\\s,]+/).filter(Boolean).map(Number);
      commands.push([cmd].concat(args));
    }
    return commands;
  }

  /** Walk objects and convert pathData strings to Fabric path arrays + gradients */
  function preprocessObjects(objects) {
    for (var i = 0; i < (objects || []).length; i++) {
      var o = objects[i];
      if (o.type === 'path' && typeof o.pathData === 'string' && (!o.path || !o.path.length)) {
        o.path = parseSvgPathData(o.pathData);
        delete o.pathData;
      }
      if (o.fill && typeof o.fill === 'object' && o.fill.type === 'linear' && o.fill.coords) {
        o.fill = new fabric.Gradient(o.fill);
      }
      if (o.objects) preprocessObjects(o.objects);
      if (o._objects) preprocessObjects(o._objects);
    }
  }

  var canvasData = ${canvasJson};
  preprocessObjects(canvasData.objects || []);

  /** Normalize type values that may arrive as strings from JSON serialization */
  function normalizeTypes(objects) {
    for (var i = 0; i < (objects || []).length; i++) {
      var o = objects[i];
      if (o.fontWeight != null && typeof o.fontWeight === 'string') {
        var w = parseInt(o.fontWeight, 10);
        o.fontWeight = isNaN(w) ? 400 : w;
      }
      if (o.charSpacing != null && typeof o.charSpacing === 'string') {
        o.charSpacing = parseFloat(o.charSpacing) || 0;
      }
      if (o.lineHeight != null && typeof o.lineHeight === 'string') {
        o.lineHeight = parseFloat(o.lineHeight) || 1.2;
      }
      if (o.fontSize != null && typeof o.fontSize === 'string') {
        o.fontSize = parseInt(o.fontSize, 10) || 24;
      }
      if (o.fontStyle === '') o.fontStyle = 'normal';
      if (o.objects) normalizeTypes(o.objects);
      if (o._objects) normalizeTypes(o._objects);
    }
  }
  normalizeTypes(canvasData.objects || []);

  function doRender() {
    canvas.loadFromJSON(canvasData, function() {
      canvas.renderAll();

      // ── Auto-download helper ──
      function finishRender() {
        canvas.renderAll();
        var autoUrl = canvas.toDataURL({ format: 'png', multiplier: 2 });
        var a = document.createElement('a');
        a.href = autoUrl;
        a.download = safeName + '.png';
        a.click();
      }

      // ── Background image support ──
      if (bgImage) {
        fabric.Image.fromURL(bgImage, function(img) {
          var scaleX = canvas.width / img.width;
          var scaleY = canvas.height / img.height;
          var scale = typeof bgImage === 'object' && bgImage.fit === 'cover'
            ? Math.max(scaleX, scaleY)
            : typeof bgImage === 'object' && bgImage.fit === 'contain'
              ? Math.min(scaleX, scaleY)
              : Math.min(scaleX, scaleY);
          canvas.setBackgroundImage(img, function() {
            canvas.renderAll();
            setTimeout(finishRender, 400);
          }, {
            scaleX: scale,
            scaleY: scale,
            originX: 'center',
            originY: 'center',
            left: canvas.width / 2,
            top: canvas.height / 2
          });
        });
      } else {
        setTimeout(finishRender, 500);
      }
    });
  }

  /** Wait for Google Fonts to finish loading before rendering canvas.
   *  Without this, Fabric.js fillText() falls back to system serif (Times New Roman),
   *  breaking fontFamily, fontWeight, charSpacing, and fontSize. */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(doRender);
  } else {
    setTimeout(doRender, 800);
  }

  // ── Manual download helpers ──
  window.downloadCanvas = function(fmt) {
    var dataUrl;
    if (fmt === 'jpg') {
      dataUrl = canvas.toDataURL({ format: 'jpeg', quality: 0.92, multiplier: 2 });
    } else {
      dataUrl = canvas.toDataURL({ format: 'png', multiplier: 2 });
    }
    var a = document.createElement('a');
    a.href = dataUrl;
    a.download = safeName + '.' + fmt;
    a.click();
  };

  window.downloadSvg = function() {
    var svg = canvas.toSVG();
    var blob = new Blob([svg], { type: 'image/svg+xml' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = safeName + '.svg';
    a.click();
    URL.revokeObjectURL(url);
  };
})();
</script>
</body></html>`;
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
  const htmlHeaders = {
    ...jsonHeaders,
    "Content-Type": "text/html; charset=utf-8",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: jsonHeaders };
  }

  const rawPath = event.path || "";

  // ── Legacy: /api/render/:templateId[/:jobId] ──
  if (rawPath.startsWith("/api/render/")) {
    const path = rawPath.replace(/^\/api\/render\/?/, "");
    const parts = path.split("/").filter(Boolean);
    const templateId = parts[0];
    const jobId = parts[1];

    // GET polling
    if (event.httpMethod === "GET" && jobId) {
      const storedJob = store.getRenderJob(jobId);
      if (!storedJob) {
        return { statusCode: 404, headers: jsonHeaders, body: JSON.stringify({ error: "Render job not found", jobId }) };
      }
      if (storedJob.url && storedJob.status === "complete") {
        return { statusCode: 200, headers: htmlHeaders, body: storedJob.url };
      }
      return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify({ ...storedJob }) };
    }

    // POST render
    if (event.httpMethod === "POST" && templateId) {
      let body = {};
      try { body = JSON.parse(event.body || "{}"); } catch { /* defaults */ }
      const format = ["png", "jpg"].includes(body.format) ? body.format : "png";
      const scale = Math.min(Math.max(parseInt(String(body.scale), 10) || 1, 1), 4);
      const tpl = body.template || await fetchTemplate(templateId);
      if (!tpl) {
        return { statusCode: 404, headers: jsonHeaders, body: JSON.stringify({ error: "Template not found", templateId }) };
      }
      const baseW = tpl.width || 1080;
      const baseH = tpl.height || 1080;
      const width = Math.round(baseW * scale);
      const height = Math.round(baseH * scale);
      const html = buildRenderPage(tpl, width, height, format, scale, templateId);
      const job = store.createRenderJob(templateId, format, scale);
      job.status = "complete";
      job.url = html;
      job.completedAt = new Date().toISOString();
      if (event.headers?.accept?.includes("text/html") || body.returnHtml) {
        return { statusCode: 200, headers: htmlHeaders, body: html };
      }
      return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify({ jobId: job.id, status: "complete", templateId, format, scale, width, height, html, _links: { view: "/api/render/" + templateId + "/" + job.id } }) };
    }
  }

  // ── New route: /api/templates/:id/render[/:jobId] ──
  const path = rawPath.replace(/^\/api\/templates\//, "");
  const parts = path.split("/").filter(Boolean);
  const templateId = parts[0];
  const action = parts[1]; // "render"
  const jobId = parts[2];

  // GET polling
  if (event.httpMethod === "GET" && templateId && jobId) {
    const storedJob = store.getRenderJob(jobId);
    if (!storedJob) {
      return { statusCode: 404, headers: jsonHeaders, body: JSON.stringify({ error: "Render job not found", jobId }) };
    }
    if (storedJob.url && storedJob.status === "complete") {
      return { statusCode: 200, headers: htmlHeaders, body: storedJob.url };
    }
    return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify({ jobId: storedJob.id, status: storedJob.status, templateId: storedJob.templateId, format: storedJob.format, scale: storedJob.scale, createdAt: storedJob.createdAt, ...(storedJob.completedAt && { completedAt: storedJob.completedAt }), ...(storedJob.error && { error: storedJob.error }) }) };
  }

  // POST render
  if (event.httpMethod === "POST" && templateId && action === "render") {
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch { /* defaults */ }
    const format = ["png", "jpg"].includes(body.format) ? body.format : "png";
    const scale = Math.min(Math.max(parseInt(String(body.scale), 10) || 1, 1), 4);
    const tpl = body.template || await fetchTemplate(templateId);
    if (!tpl) {
      return { statusCode: 404, headers: jsonHeaders, body: JSON.stringify({ error: "Template not found", templateId }) };
    }
    const baseW = tpl.width || 1080;
    const baseH = tpl.height || 1080;
    const width = Math.round(baseW * scale);
    const height = Math.round(baseH * scale);
    const html = buildRenderPage(tpl, width, height, format, scale, templateId);
    const job = store.createRenderJob(templateId, format, scale);
    job.status = "complete";
    job.url = html;
    job.completedAt = new Date().toISOString();
    if (event.headers?.accept?.includes("text/html") || body.returnHtml) {
      return { statusCode: 200, headers: htmlHeaders, body: html };
    }
    return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify({ jobId: job.id, status: "complete", templateId, format, scale, width, height, html, _links: { view: "/api/templates/" + templateId + "/render/" + job.id } }) };
  }

  return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ error: "POST /api/templates/:id/render to render, GET /api/templates/:id/render/:jobId to poll" }) };
};
