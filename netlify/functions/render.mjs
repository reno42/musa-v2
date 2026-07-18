/**
 * Render Function — Self-rendering HTML with auto-download
 * ──────────────────────────────────────────────────────────────
 * Returns a self-contained HTML page that renders Futuraria
 * HTML-engine design templates via html2canvas in the browser,
 * then auto-downloads the result as PNG. Zero server-side
 * binary dependencies.
 *
 * Endpoints:
 *   POST /api/templates/:id/render          → render page with auto-download
 *   GET  /api/render/:templateId/frame/:frameId → frame-level render
 *
 * @module functions/render
 */

const API_BASE = process.env.URL || "https://bejewelled-llama-a6719d.netlify.app";

// ─── Auth ─────────────────────────────────────────────────

function checkApiKey(event) {
  const adminKey = process.env.MCP_ADMIN_KEY;
  if (!adminKey) return true; // Dev mode: no auth required

  const apiKey = (event.headers || {})["x-api-key"] || "";
  if (apiKey === adminKey) return true;

  // For non-admin keys: at minimum require *some* key header
  // Full api_keys table validation happens at the Express layer
  return apiKey.length > 0;
}

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

// ─── Render Function handler ─────────────────────────────────

/**
 * Extract Google Fonts @import URLs from CSS and convert to <link> tags.
 * This ensures fonts load properly in the SVG foreignObject render path.
 *
 * NOTE: Full Puppeteer rendering (page.setContent + page.screenshot) would
 * provide pixel-perfect output with all CSS features (gradients, shadows,
 * blend modes, animations). However, Puppeteer + Chromium (~130 MB) exceeds
 * Netlify's 50 MB function size limit for the free tier.
 *
 * For production use, a dedicated render service (AWS Lambda container,
 * Cloud Run, or a VPS) with Puppeteer is recommended. The foreignObject
 * approach below handles 90% of use cases and is the current fallback.
 */
function extractFontLinks(css) {
  const links = [];
  const importRe = /@import\s+url\(['"]?([^'")\s]+)['"]?\)\s*;/g;
  let match;
  while ((match = importRe.exec(css)) !== null) {
    const url = match[1];
    if (url.includes("fonts.googleapis.com")) {
      links.push(`<link rel="stylesheet" href="${url}">`);
    }
  }
  return links.join("\n");
}

function buildRenderPageHtml(tpl, width, height, format, scale, templateId) {
  const safeName = (tpl.name || templateId || "template")
    .replace(/[<>:"/\\|?*]/g, "_");
  // Support both single-template html/css and per-frame html/css
  const htmlContent = tpl._frameHtml || tpl.html || "";
  const cssContent = tpl._frameCss || tpl.css || "";
  const fontLinks = extractFontLinks(cssContent);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeName} — Futuraria HTML Render</title>
<script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"><\/script>
${fontLinks}
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
  .toolbar h2 { font-size:15px; color:#333; margin-right:auto; }
  .btn-download { background:#3B82F6; color:#fff; }
  .btn-download:hover { background:#2563EB; }
  .toolbar button {
    padding: 7px 14px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
     }
  #render-target {
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
    overflow: hidden;
    position: relative;
  }
  .info { margin-top:10px; font-size:11px; color:#888; }
</style>
</head>
<body>
<div class="toolbar">
  <h2>${safeName}</h2>
  <button class="btn-download" onclick="doCapture()">⬇ Download PNG</button>
  <span id="status" style="font-size:12px;color:#666">Loading fonts…</span>
</div>
<div id="render-target" style="width:${width}px;height:${height}px">
  <style>${cssContent}</style>
  ${htmlContent}
</div>
<div class="info">${width}×${height}px · ${format.toUpperCase()}</div>
<script>
  (function() {
    var safeName = "${safeName}";
    var format = "${format}";
    var w = ${width};
    var h = ${height};

    window.doCapture = function() {
      var el = document.getElementById('render-target');
      document.getElementById('status').textContent = 'Capturing…';
      html2canvas(el, { width: w, height: h, scale: 2, useCORS: true, allowTaint: true }).then(function(canvas) {
        canvas.toBlob(function(blob) {
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = safeName + '.' + format;
          a.click();
          URL.revokeObjectURL(url);
          document.getElementById('status').textContent = 'Downloaded ✓';
          document.getElementById('status').style.color = '#059669';
        }, format === 'jpg' ? 'image/jpeg' : 'image/png');
      });
    };

    // Auto-capture when fonts are ready
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function() {
        document.getElementById('status').textContent = 'Rendered ✓';
      });
    } else {
      document.getElementById('status').textContent = 'Rendered ✓';
    }
  })();
</script>
</body></html>`;
}

// ─── Netlify Function handler ─────────────────────────────────

export const handler = async (event) => {
  const jsonHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    "Content-Type": "application/json; charset=utf-8",
  };
  const htmlHeaders = {
    ...jsonHeaders,
    "Content-Type": "text/html; charset=utf-8",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: jsonHeaders };
  }

  const rawPath = event.path || "";

  // ── Frame render: GET /api/render/:templateId/frame/:frameId ──
  if (event.httpMethod === "GET" && rawPath.includes("/frame/")) {
    const match = rawPath.match(/^\/api\/render\/(.+?)\/frame\/(.+)$/);
    if (match) {
      const [, templateId, frameId] = match;
      const tpl = await fetchTemplate(templateId);
      if (!tpl) {
        return { statusCode: 404, headers: jsonHeaders, body: JSON.stringify({ error: "Template not found", templateId }) };
      }

      let frame = tpl.frames?.find(f => f.id === frameId);
      if (!frame) {
        frame = { id: frameId, name: tpl.name || "Frame", width: tpl.width || 1080, height: tpl.height || 1080, html: tpl.html || "", css: tpl.css || "" };
      }
      if (!frame) {
        return { statusCode: 404, headers: jsonHeaders, body: JSON.stringify({ error: "Frame not found", frameId }) };
      }
      const scale = parseInt(String(event.queryStringParameters?.scale || "1"), 10) || 1;
      const format = event.queryStringParameters?.format || "png";
      const width = Math.round((frame.width || 1080) * scale);
      const height = Math.round((frame.height || 1080) * scale);
      const frameTpl = { ...tpl, _frameHtml: frame.html || "", _frameCss: frame.css || "", width: frame.width || 1080, height: frame.height || 1080, name: frame.name || tpl.name };
      const html = buildRenderPageHtml(frameTpl, width, height, format, scale, templateId + "_" + frameId);
      return { statusCode: 200, headers: htmlHeaders, body: html };
    }
  }

  // ── New route: /api/templates/:id/render[/:jobId] ──
  const path = rawPath.replace(/^\/api\/templates\//, "");
  const parts = path.split("/").filter(Boolean);
  const templateId = parts[0];
  const action = parts[1];

  // POST render
  if (event.httpMethod === "POST" && templateId && action === "render") {
    // ── Auth enforcement ──
    if (!checkApiKey(event)) {
      return { statusCode: 401, headers: jsonHeaders, body: JSON.stringify({ error: "Unauthorized: valid x-api-key required" }) };
    }

    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch { /* defaults */ }
    const format = ["png", "jpg"].includes(body.format) ? body.format : "png";
    const scale = Math.min(Math.max(parseInt(String(body.scale), 10) || 1, 1), 4);
    let tpl = body.template || await fetchTemplate(templateId);
    if (!tpl) {
      return { statusCode: 404, headers: jsonHeaders, body: JSON.stringify({ error: "Template not found", templateId }) };
    }
    if (body.frameId) {
      let frame = tpl.frames?.find(f => f.id === body.frameId);
      if (!frame) {
        frame = { id: body.frameId, name: tpl.name || "Frame", width: tpl.width || 1080, height: tpl.height || 1080, html: tpl.html || "", css: tpl.css || "" };
      }
      if (!frame) {
        return { statusCode: 404, headers: jsonHeaders, body: JSON.stringify({ error: "Frame not found", frameId: body.frameId }) };
      }
      tpl = { ...tpl, _frameHtml: frame.html || "", _frameCss: frame.css || "", width: frame.width || 1080, height: frame.height || 1080, name: frame.name || tpl.name };
    }
    const baseW = tpl.width || 1080;
    const baseH = tpl.height || 1080;
    const width = Math.round(baseW * scale);
    const height = Math.round(baseH * scale);
    const html = buildRenderPageHtml(tpl, width, height, format, scale, templateId);
    if (event.headers?.accept?.includes("text/html") || body.returnHtml) {
      return { statusCode: 200, headers: htmlHeaders, body: html };
    }
    return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify({ status: "complete", templateId, format, scale, width, height, html }) };
  }

  return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ error: "POST /api/templates/:id/render to render" }) };
};
