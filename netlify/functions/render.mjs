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

import { JSON_UTF8_CONTENT_TYPE, parseNetlifyJson } from "./http-encoding.mjs";

const API_BASE = process.env.URL || "https://design.futuraria.com";

// ─── Auth ─────────────────────────────────────────────────

function checkApiKey(event) {
  const adminKey = process.env.MCP_ADMIN_KEY;
  if (!adminKey) return true; // Dev mode: no auth required

  const apiKey = (event.headers || {})["x-api-key"] || "";
  const bearer = (event.headers || {}).authorization || "";
  if (apiKey === adminKey) return true;

  // For non-admin keys: at minimum require *some* key header
  // Full api_keys table validation happens at the Express layer
  return apiKey.length > 0 || /^Bearer\s+\S+/i.test(bearer);
}

// ─── Helpers ─────────────────────────────────────────────────

/** Fetch template from REST API (reads Supabase across containers) */
async function fetchTemplate(id, event) {
  try {
    const incoming = event?.headers || {};
    const headers = {};
    if (incoming.authorization) headers.Authorization = incoming.authorization;
    if (incoming["x-api-key"]) headers["x-api-key"] = incoming["x-api-key"];
    const res = await fetch(`${API_BASE}/api/templates/${id}`, { headers });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.success ? json.data : null;
  } catch {
    return null;
  }
}

// ─── Render Function handler ─────────────────────────────────

/**
 * Extract Google Fonts @import URLs from CSS and convert to <link> tags,
 * for humans reading the page while it renders (the capture path below
 * inlines fonts as data URIs separately, so the canvas draw never depends
 * on these having finished loading).
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

/** Extract a concrete body background color from CSS.
 *  Returns null if the body background uses a CSS variable, is transparent,
 *  or isn't found — so callers can fall back safely. */
function extractBodyBackground(css) {
  if (!css) return null;
  // Match body or #__df_content background declaration
  const m = css.match(/(?:body|#__df_content)\s*\{[^}]*background\s*:\s*([^;}\n]+)/);
  if (!m) return null;
  const val = m[1].trim();
  // Only concrete colors — no CSS variables, no gradients, no url()
  if (/^(#[0-9a-fA-F]{3,8}|rgb\([^)]+\)|rgba\([^)]+\)|hsl\([^)]+\)|hsla\([^)]+\)|[a-z]+)$/.test(val)) {
    return val;
  }
  return null;
}

function buildRenderPageHtml(tpl, width, height, format, scale, templateId) {
  const safeName = (tpl.name || templateId || "template")
    .replace(/[<>:"/\\|?*]/g, "_");
  // Support both single-template html/css and per-frame html/css
  const htmlContent = tpl._frameHtml || tpl.html || "";
  const cssContent = tpl._frameCss || tpl.css || "";
  // Prefer CSS body background over frame.background when the latter is the
  // default #ffffff (or missing) — fixes white-on-white when the implementer
  // writes dark CSS but forgets to set background on create_html_frame.
  const cssBodyBg = extractBodyBackground(cssContent);
  const background = tpl._frameBackground || tpl.background || cssBodyBg || "#ffffff";
  const fontLinks = extractFontLinks(cssContent);
  // Passed into the page's own <script> below as JSON literals — this file
  // never executes them, it only emits the string.
  const htmlJson = JSON.stringify(htmlContent);
  const cssJson = JSON.stringify(cssContent);
  const bgJson = JSON.stringify(background);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeName} — Futuraria HTML Render</title>
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
    max-width: 100%;
    height: auto;
  }
  .info { margin-top:10px; font-size:11px; color:#888; }
</style>
</head>
<body>
<div class="toolbar">
  <h2>${safeName}</h2>
  <button class="btn-download" onclick="doCapture()">⬇ Download ${format.toUpperCase()}</button>
  <span id="status" style="font-size:12px;color:#666">Rendering…</span>
</div>
<canvas id="render-target" width="${width}" height="${height}" style="width:${width}px"></canvas>
<div class="info">${width}×${height}px · ${format.toUpperCase()}</div>
<script>
(function() {
  // Same technique as src/lib/frameCapture.ts (the editor's export pipeline):
  // paint through an SVG <foreignObject> so the browser's own CSS engine
  // renders the design — filters, gradients and shadows all come out right,
  // which a DOM-cloning capture library cannot guarantee.
  var safeName = ${JSON.stringify(safeName)};
  var format = ${JSON.stringify(format)};
  var w = ${width};
  var h = ${height};
  var html = ${htmlJson};
  var css = ${cssJson};
  var background = ${bgJson};

  function mapBodySelectors(text) {
    return text
      .replace(/([{}]\\s*|,\\s*|^\\s*)html\\b/gm, "$1#__df_content")
      .replace(/([{}]\\s*|,\\s*|^\\s*)body\\b/gm, "$1#__df_content")
      .replace(/(\\s)html\\b/g, "$1#__df_content")
      .replace(/(\\s)body\\b/g, "$1#__df_content");
  }

  function toXhtml(innerHtml) {
    var container = document.createElement("div");
    container.id = "__df_content";
    container.innerHTML = innerHtml;
    return new XMLSerializer().serializeToString(container);
  }

  // When this SVG is loaded as an <img> (below), browsers are explicitly
  // permitted to skip loading any EXTERNAL resource referenced inside a
  // <foreignObject> — text and CSS painting still work, but an
  // <img src="https://…"> pointing at Storage shows the broken-image icon.
  // Bake every external image into a data: URI first, same treatment as fonts.
  function inlineImages(rawHtml, rawCss, done) {
    var container = document.createElement("div");
    container.innerHTML = rawHtml;
    var urls = [];
    function addUrl(u) { if (urls.indexOf(u) === -1) urls.push(u); }
    var imgs = container.querySelectorAll("img[src]");
    for (var i = 0; i < imgs.length; i++) {
      var src = imgs[i].getAttribute("src") || "";
      if (/^https?:\\/\\//.test(src)) addUrl(src);
    }
    var styled = container.querySelectorAll("[style*=url]");
    for (var j = 0; j < styled.length; j++) {
      var style = styled[j].getAttribute("style") || "";
      var re1 = /url\\((['"]?)(https?:\\/\\/[^'")]+)\\1\\)/g, m1;
      while ((m1 = re1.exec(style)) !== null) addUrl(m1[2]);
    }
    var cssNoImports = rawCss.replace(/@import\\s+url\\([^)]*\\)[^;]*;/g, "");
    var re2 = /url\\((['"]?)(https?:\\/\\/[^'")]+)\\1\\)/g, m2;
    while ((m2 = re2.exec(cssNoImports)) !== null) addUrl(m2[2]);

    if (urls.length === 0) { done(rawHtml, rawCss); return; }

    var map = {};
    var remaining = urls.length;
    urls.forEach(function(url) {
      fetch(url).then(function(r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        var contentType = r.headers.get("content-type") || "image/png";
        return r.arrayBuffer().then(function(buf) {
          var bytes = new Uint8Array(buf), binary = "";
          for (var k = 0; k < bytes.length; k += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
          map[url] = "data:" + contentType + ";base64," + btoa(binary);
        });
      }).catch(function() { map[url] = url; })
        .then(function() { if (--remaining === 0) finish(); });
    });

    function finish() {
      for (var i2 = 0; i2 < imgs.length; i2++) {
        var src2 = imgs[i2].getAttribute("src") || "";
        if (map[src2] && map[src2] !== src2) imgs[i2].setAttribute("src", map[src2]);
      }
      for (var j2 = 0; j2 < styled.length; j2++) {
        var style2 = styled[j2].getAttribute("style") || "";
        for (var url2 in map) { if (map[url2] !== url2) style2 = style2.split(url2).join(map[url2]); }
        styled[j2].setAttribute("style", style2);
      }
      var nextCss = rawCss;
      for (var url3 in map) { if (map[url3] !== url3) nextCss = nextCss.split(url3).join(map[url3]); }
      done(container.innerHTML, nextCss);
    }
  }

  function inlineGoogleFonts(importUrls, done) {
    if (importUrls.length === 0) { done(""); return; }
    var results = [];
    var remaining = importUrls.length;
    importUrls.forEach(function(cssUrl, idx) {
      fetch(cssUrl).then(function(r) { return r.text(); }).then(function(cssText) {
        var fontUrls = [];
        var re = /url\\((https:[^)]+)\\)/g, m;
        while ((m = re.exec(cssText)) !== null) if (fontUrls.indexOf(m[1]) === -1) fontUrls.push(m[1]);
        var pending = fontUrls.length;
        if (pending === 0) { results[idx] = cssText; if (--remaining === 0) done(results.join("\\n")); return; }
        fontUrls.forEach(function(fontUrl) {
          fetch(fontUrl).then(function(r) { return r.arrayBuffer(); }).then(function(buf) {
            var bytes = new Uint8Array(buf), binary = "";
            for (var i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            cssText = cssText.split(fontUrl).join("data:font/woff2;base64," + btoa(binary));
            if (--pending === 0) { results[idx] = cssText; if (--remaining === 0) done(results.join("\\n")); }
          }).catch(function() { if (--pending === 0) { results[idx] = cssText; if (--remaining === 0) done(results.join("\\n")); } });
        });
      }).catch(function() { results[idx] = ""; if (--remaining === 0) done(results.join("\\n")); });
    });
  }

  function render() {
    var importUrls = [];
    var re = /@import\\s+url\\(['"]?([^'")]+)['"]?\\)/g, m;
    while ((m = re.exec(css)) !== null) if (m[1].indexOf("fonts.googleapis.com") !== -1) importUrls.push(m[1]);

    inlineImages(html, css, function(inlinedHtml, inlinedCss) {
    inlineGoogleFonts(importUrls, function(fontCss) {
      var scopedCss = mapBodySelectors(inlinedCss).replace(/@import\\s+url\\([^)]*\\)[^;]*;/g, "");
      var xhtml = toXhtml(inlinedHtml);
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">'
        + '<foreignObject width="100%" height="100%">'
        + '<div xmlns="http://www.w3.org/1999/xhtml" style="width:' + w + 'px;height:' + h + 'px;position:relative;background:' + background + ';overflow:hidden">'
        + '<style>' + fontCss + '\\n#__df_content{width:' + w + 'px;height:' + h + 'px;overflow:hidden}\\n' + scopedCss + '</style>' + xhtml + '</div></foreignObject></svg>';

      var img = new Image();
      img.onload = function() {
        setTimeout(function() {
          var canvas = document.getElementById('render-target');
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          document.getElementById('status').textContent = 'Rendered ✓';
          document.getElementById('status').style.color = '#059669';
        }, 350); // fonts/images inside the foreignObject decode asynchronously
      };
      img.onerror = function() {
        document.getElementById('status').textContent = 'Render failed — the design markup may be malformed.';
        document.getElementById('status').style.color = '#dc2626';
      };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    });
    });
  }

  window.doCapture = function() {
    var canvas = document.getElementById('render-target');
    document.getElementById('status').textContent = 'Preparing download…';
    canvas.toBlob(function(blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = safeName + '.' + format;
      a.click();
      URL.revokeObjectURL(url);
      document.getElementById('status').textContent = 'Downloaded ✓';
      document.getElementById('status').style.color = '#059669';
    }, format === 'jpg' ? 'image/jpeg' : 'image/png', format === 'jpg' ? 0.92 : undefined);
  };

  render();
})();
</script>
</body></html>`;
}

// ─── Netlify Function handler ─────────────────────────────────

export const handler = async (event) => {
  const jsonHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    "Content-Type": JSON_UTF8_CONTENT_TYPE,
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
      const tpl = await fetchTemplate(templateId, event);
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
      const frameTpl = { ...tpl, _frameHtml: frame.html || "", _frameCss: frame.css || "", _frameBackground: frame.background || tpl.background || undefined, width: frame.width || 1080, height: frame.height || 1080, name: frame.name || tpl.name };
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

    let body;
    try {
      body = parseNetlifyJson(event);
    } catch {
      return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ error: "Request body must be valid UTF-8 JSON" }) };
    }
    const format = ["png", "jpg"].includes(body.format) ? body.format : "png";
    const scale = Math.min(Math.max(parseInt(String(body.scale), 10) || 1, 1), 4);
    const authorizedTemplate = await fetchTemplate(templateId, event);
    let tpl = body.template || authorizedTemplate;
    if (!authorizedTemplate) {
      return { statusCode: 404, headers: jsonHeaders, body: JSON.stringify({ error: "Template not found", templateId }) };
    }
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
      tpl = { ...tpl, _frameHtml: frame.html || "", _frameCss: frame.css || "", _frameBackground: frame.background || tpl.background || undefined, width: frame.width || 1080, height: frame.height || 1080, name: frame.name || tpl.name };
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
