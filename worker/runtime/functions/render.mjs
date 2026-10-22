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
 *   GET  /api/render/:templateId/video      → video export page (WebM via
 *                                             MediaRecorder, ?key= authorized,
 *                                             params fps/spf/scale/crossfade)
 *
 * @module functions/render
 */

import { JSON_UTF8_CONTENT_TYPE, parseHandlerJson } from "./http-encoding.mjs";

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
    // The video page is reached by browser navigation (no headers possible),
    // so video_export's exportUrl carries the key as ?key= — forward it.
    const qkey = event?.queryStringParameters?.key;
    if (qkey && !headers["x-api-key"]) headers["x-api-key"] = qkey;
    // The Express bridge sets apiBase so a local key hits the local API
    // instead of silently resolving against production.
    const base = event?.apiBase || API_BASE;
    const res = await fetch(`${base}/api/templates/${id}`, { headers });
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

function buildRenderPageHtml(tpl, width, height, format, scale, templateId, capture = null) {
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
  // REQ-032 render_frame_png — modo asset (upload=1): tras rasterizar, la
  // página sube el PNG vía el tool MCP upload_image (mismo key del caller)
  // y muestra el JSON final { assetId, url, ... } en pantalla para que un
  // agente lo lea (visión/DOM). capture=null → página de descarga normal.
  const captureJson = JSON.stringify(capture);

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
<pre id="upload-result" style="display:none;max-width:800px;width:100%;background:#0f172a;color:#d2ff02;font-size:12px;padding:14px;border-radius:8px;white-space:pre-wrap;word-break:break-all;margin-top:12px;"></pre>
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
  var CAPTURE = ${captureJson};

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
          if (CAPTURE) { window.doCapture(); } // modo asset: auto-subir tras renderizar
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

  // REQ-032 — modo asset: rasteriza → sube vía /mcp upload_image → imprime
  // el JSON { assetId, url, width, height, bytes } en <pre id="upload-result">.
  window.__uploadPng = function() {
    var canvas = document.getElementById('render-target');
    var status = document.getElementById('status');
    try {
      var dataUrl = canvas.toDataURL('image/png');
      status.textContent = 'Uploading PNG…';
      status.style.color = '#666';
      fetch('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': CAPTURE.key || '' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'upload_image', arguments: { data: dataUrl, name: CAPTURE.assetName, workspaceId: CAPTURE.workspaceId, tags: ['render', 'frame'] } } })
      }).then(function(r) { return r.json(); }).then(function(json) {
        if (json.error) throw new Error(json.error.message || 'upload_image failed');
        var text = json.result && json.result.content && json.result.content[0] && json.result.content[0].text;
        var tool = text ? JSON.parse(text) : (json.result || {});
        var out = { assetId: tool.assetId, url: tool.url, width: w, height: h, bytes: tool.sizeBytes, name: CAPTURE.assetName };
        if (CAPTURE.includeBase64) out.base64 = dataUrl;
        var pre = document.getElementById('upload-result');
        pre.textContent = JSON.stringify(out, null, 2);
        pre.style.display = 'block';
        status.textContent = 'Uploaded ✓ — read the JSON below';
        status.style.color = '#059669';
      }).catch(function(err) {
        status.textContent = 'Upload failed: ' + (err && err.message ? err.message : err);
        status.style.color = '#dc2626';
      });
    } catch (err) {
      status.textContent = 'Upload failed: ' + (err && err.message ? err.message : err);
      status.style.color = '#dc2626';
    }
  };

  // ── DIFF-ALGO-BEGIN — copia exacta en render.mjs (paridad en QA) ──
  function resampleNearest(data, w, h, nw, nh) {
    var out = new Uint8ClampedArray(nw * nh * 4);
    for (var y = 0; y < nh; y++) {
      var sy = Math.min(h - 1, Math.floor((y * h) / nh));
      for (var x = 0; x < nw; x++) {
        var sx = Math.min(w - 1, Math.floor((x * w) / nw));
        var si = (sy * w + sx) * 4, di = (y * nw + x) * 4;
        out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2]; out[di + 3] = data[si + 3];
      }
    }
    return out;
  }

  function diffFrames(a, b, opts) {
    var block = (opts && opts.block) || 32;
    var threshold = (opts && opts.threshold != null) ? opts.threshold : 0.12;
    var topN = (opts && opts.topN) || 8;
    var width = Math.min(a.width, b.width), height = Math.min(a.height, b.height);
    var ad = (a.width === width && a.height === height) ? a.data : resampleNearest(a.data, a.width, a.height, width, height);
    var bd = (b.width === width && b.height === height) ? b.data : resampleNearest(b.data, b.width, b.height, width, height);
    var cols = Math.ceil(width / block), rows = Math.ceil(height / block);
    var scores = new Float64Array(cols * rows);
    var kinds = new Array(cols * rows);
    for (var z = 0; z < kinds.length; z++) kinds[z] = "";
    for (var by = 0; by < rows; by++) {
      for (var bx = 0; bx < cols; bx++) {
        var x0 = bx * block, y0 = by * block;
        var x1 = Math.min(x0 + block, width), y1 = Math.min(y0 + block, height);
        var sumR = 0, sumG = 0, sumB = 0, sumLA = 0, sumLB = 0, sumLA2 = 0, sumLB2 = 0, sumD = 0, sumD2 = 0, n = 0;
        for (var y = y0; y < y1; y++) {
          for (var x = x0; x < x1; x++) {
            var i = (y * width + x) * 4;
            var dr = Math.abs(ad[i] - bd[i]), dg = Math.abs(ad[i + 1] - bd[i + 1]), db = Math.abs(ad[i + 2] - bd[i + 2]);
            sumR += dr; sumG += dg; sumB += db;
            var la = 0.2126 * ad[i] + 0.7152 * ad[i + 1] + 0.0722 * ad[i + 2];
            var lb = 0.2126 * bd[i] + 0.7152 * bd[i + 1] + 0.0722 * bd[i + 2];
            sumLA += la; sumLB += lb; sumLA2 += la * la; sumLB2 += lb * lb;
            var d = (dr + dg + db) / 3;
            sumD += d; sumD2 += d * d;
            n++;
          }
        }
        var score = Math.max(sumR, sumG, sumB) / n / 255;
        var idx = by * cols + bx;
        scores[idx] = score;
        if (score <= threshold) continue;
        // Heurística de kind: señala DÓNDE y qué CLASE de cambio — no qué es.
        var meanLA = sumLA / n, meanLB = sumLB / n;
        var stdLA = Math.sqrt(Math.max(0, sumLA2 / n - meanLA * meanLA));
        var stdLB = Math.sqrt(Math.max(0, sumLB2 / n - meanLB * meanLB));
        var meanD = sumD / n;
        var stdD = Math.sqrt(Math.max(0, sumD2 / n - meanD * meanD));
        var FLAT = 6; // bloque con luminancia ~uniforme
        if (stdLA < FLAT && stdLB < FLAT) kinds[idx] = "color-shift";
        else if (stdLA < FLAT) kinds[idx] = "missing-element"; // plano en render, estructura en referencia
        else if (stdLB < FLAT) kinds[idx] = "extra-element"; // estructura en render, plano en referencia
        else kinds[idx] = stdD > 12 ? "text-shape-shift" : "color-shift";
      }
    }
    // Fusiona bloques divergentes adyacentes en bounding boxes (conexas 4-vecinas)
    var seen = new Uint8Array(cols * rows);
    var comps = [];
    for (var s = 0; s < cols * rows; s++) {
      if (!kinds[s] || seen[s]) continue;
      var queue = [s];
      seen[s] = 1;
      var minX = cols, minY = rows, maxX = -1, maxY = -1, sumScore = 0, count = 0;
      var kindCount = {};
      while (queue.length) {
        var cur = queue.pop();
        var cx = cur % cols, cy = Math.floor(cur / cols);
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        sumScore += scores[cur];
        count++;
        kindCount[kinds[cur]] = (kindCount[kinds[cur]] || 0) + 1;
        var nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var q = 0; q < 4; q++) {
          var nx = cx + nb[q][0], ny = cy + nb[q][1];
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          var nIdx = ny * cols + nx;
          if (kinds[nIdx] && !seen[nIdx]) { seen[nIdx] = 1; queue.push(nIdx); }
        }
      }
      var bestKind = "", bestCount = 0;
      for (var kind in kindCount) if (kindCount[kind] > bestCount) { bestKind = kind; bestCount = kindCount[kind]; }
      comps.push({ x: minX * block, y: minY * block, w: Math.min((maxX + 1) * block, width) - minX * block, h: Math.min((maxY + 1) * block, height) - minY * block, kind: bestKind, score: Math.round((sumScore / count) * 10000) / 10000, _sum: sumScore });
    }
    comps.sort(function (p, q2) { return q2._sum - p._sum; });
    var top = [];
    for (var t = 0; t < comps.length && t < topN; t++) {
      top.push({ x: comps[t].x, y: comps[t].y, w: comps[t].w, h: comps[t].h, kind: comps[t].kind, score: comps[t].score });
    }
    var divergent = 0;
    for (var dv = 0; dv < kinds.length; dv++) if (kinds[dv]) divergent++;
    return {
      width: width, height: height, block: block, threshold: threshold,
      divergentAreaPct: Math.round((divergent / (cols * rows)) * 10000) / 100,
      topDivergences: top,
    };
  }
  // ── DIFF-ALGO-END ──

  // REQ-032 Tool 3 — modo diff (?diff=1): baja la referencia, normaliza
  // tamaños, diff por bloques (32px, umbral default 12%) y sube el compuesto
  // por el MISMO tool upload_image. score mode imprime solo el JSON.
  window.__diffPng = function() {
    var canvas = document.getElementById('render-target');
    var status = document.getElementById('status');
    function fail(msg) {
      status.textContent = 'Diff failed: ' + msg;
      status.style.color = '#dc2626';
    }
    if (!CAPTURE.diff || !CAPTURE.diff.ref) { fail('missing reference URL'); return; }
    status.textContent = 'Loading reference…';
    var ref = new Image();
    ref.crossOrigin = 'anonymous';
    ref.onload = function() {
      try {
        status.textContent = 'Computing diff…';
        var sctx = canvas.getContext('2d');
        var a = sctx.getImageData(0, 0, canvas.width, canvas.height);
        var rc = document.createElement('canvas');
        rc.width = ref.naturalWidth; rc.height = ref.naturalHeight;
        var rctx = rc.getContext('2d');
        rctx.drawImage(ref, 0, 0);
        var b = rctx.getImageData(0, 0, rc.width, rc.height);
        var res = diffFrames({ data: a.data, width: a.width, height: a.height }, { data: b.data, width: b.width, height: b.height }, { block: 32, threshold: CAPTURE.diff.threshold });
        var mode = CAPTURE.diff.mode || 'heatmap';
        var out = null;
        if (mode === 'side-by-side') {
          var H = Math.min(a.height, b.height);
          var aw = Math.round(a.width * (H / a.height)), bw = Math.round(b.width * (H / b.height));
          out = document.createElement('canvas');
          out.width = aw + bw + 8; out.height = H;
          var octx = out.getContext('2d');
          octx.fillStyle = '#111827';
          octx.fillRect(0, 0, out.width, out.height);
          octx.drawImage(rc, 0, 0, rc.width, rc.height, 0, 0, bw, H);
          octx.drawImage(canvas, 0, 0, canvas.width, canvas.height, bw + 8, 0, aw, H);
        } else if (mode === 'heatmap') {
          out = document.createElement('canvas');
          out.width = a.width; out.height = a.height;
          var hctx = out.getContext('2d');
          hctx.drawImage(canvas, 0, 0);
          hctx.fillStyle = 'rgba(255, 0, 60, 0.45)';
          for (var hi = 0; hi < res.topDivergences.length; hi++) {
            var d = res.topDivergences[hi];
            hctx.fillRect(d.x, d.y, d.w, d.h);
          }
        }
        var finish = function(tool) {
          var pre = document.getElementById('upload-result');
          var payload = { divergentAreaPct: res.divergentAreaPct, topDivergences: res.topDivergences, mode: mode, threshold: res.threshold };
          if (tool) { payload.url = tool.url; payload.assetId = tool.assetId; payload.width = out.width; payload.height = out.height; }
          else payload._note = 'score mode: JSON only — use side-by-side or heatmap to get a composite image';
          pre.textContent = JSON.stringify(payload, null, 2);
          pre.style.display = 'block';
          status.textContent = 'Diff done ✓ — read the JSON below';
          status.style.color = '#059669';
        };
        if (mode === 'score' || !out) { finish(null); return; }
        status.textContent = 'Uploading diff…';
        var dataUrl = out.toDataURL('image/png');
        fetch('/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': CAPTURE.key || '' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'upload_image', arguments: { data: dataUrl, name: CAPTURE.assetName, workspaceId: CAPTURE.workspaceId, tags: ['render', 'diff'] } } })
        }).then(function(r) { return r.json(); }).then(function(json) {
          if (json.error) throw new Error(json.error.message || 'upload_image failed');
          var text = json.result && json.result.content && json.result.content[0] && json.result.content[0].text;
          finish(text ? JSON.parse(text) : (json.result || {}));
        }).catch(function(err) { fail(err && err.message ? err.message : err); });
      } catch (err) {
        fail((err && err.message ? err.message : err) + ' — tainted canvas? la referencia necesita CORS');
      }
    };
    ref.onerror = function() { fail('reference failed to load (404 or CORS): ' + CAPTURE.diff.ref); };
    ref.src = CAPTURE.diff.ref;
  };

  window.doCapture = function() {
    if (CAPTURE && CAPTURE.diff) { window.__diffPng(); return; }
    if (CAPTURE) { window.__uploadPng(); return; }
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

/**
 * Video export page — same zero-binary philosophy as buildRenderPageHtml:
 * each frame is rasterized in-browser via SVG foreignObject, then sequenced
 * onto a canvas recorded with MediaRecorder (WebM). The page embeds all frame
 * data (already authorized server-side via fetchTemplate) and auto-downloads
 * on completion. Crossfades and pacing run in real time so MediaRecorder's
 * wall-clock timestamps stay correct.
 */
function buildVideoPageHtml(tpl, frames, opts) {
  const safeName = (tpl.name || opts.templateId || "video")
    .replace(/[<>:"/\\|?*]/g, "_");
  const width = Math.round((frames[0].width || 1080) * opts.scale);
  const height = Math.round((frames[0].height || 1080) * opts.scale);
  const pageFrames = frames.map(f => ({
    id: f.id,
    name: f.name || f.id,
    w: Math.round(f.width || 1080),
    h: Math.round(f.height || 1080),
    html: f.html || "",
    css: f.css || "",
    bg: f.background || tpl.background || extractBodyBackground(f.css || "") || "#ffffff",
  }));
  const durationSec = Math.round(pageFrames.length * opts.spf * 10) / 10;
  const framesJson = JSON.stringify(pageFrames);
  const nameJson = JSON.stringify(safeName);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeName} — Futuraria Video Export</title>
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
  #bar-wrap { width:100%; max-width:800px; height:6px; background:#d1d5db; border-radius:3px; margin-bottom:12px; overflow:hidden; }
  #bar { height:100%; width:0%; background:#3B82F6; border-radius:3px; transition: width .2s; }
  #vc { background:#fff; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.12); max-width:100%; height:auto; }
  .info { margin-top:10px; font-size:11px; color:#888; }
</style>
</head>
<body>
<div class="toolbar">
  <h2>${safeName} — video</h2>
  <span id="status" style="font-size:12px;color:#666">Preparando…</span>
</div>
<div id="bar-wrap"><div id="bar"></div></div>
<canvas id="vc" width="${width}" height="${height}" style="width:${width}px"></canvas>
<div class="info">${width}×${height}px · ${pageFrames.length} frames × ${opts.spf}s ≈ ${durationSec}s · ${opts.fps} fps${opts.crossfade > 0 ? ` · crossfade ${opts.crossfade}s` : ""}</div>
<script>
(function() {
  var FRAMES = ${framesJson};
  var safeName = ${nameJson};
  var FPS = ${opts.fps}, SPF = ${opts.spf}, XF = ${opts.crossfade}, SCALE = ${opts.scale};
  var W = FRAMES[0].w * SCALE, H = FRAMES[0].h * SCALE;
  var canvas = document.getElementById('vc');
  var ctx = canvas.getContext('2d');
  var statusEl = document.getElementById('status');
  var barEl = document.getElementById('bar');

  function setStatus(msg, color) { statusEl.textContent = msg; statusEl.style.color = color || '#666'; }
  function setBar(p) { barEl.style.width = Math.round(p * 100) + '%'; }

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

  // One shared cache: the same Storage asset repeated across frames is
  // fetched and inlined exactly once.
  var imgCache = {};
  function collectUrls(text, out) {
    var re = /url\\((['"]?)(https?:\\/\\/[^'")]+)\\1\\)/g, m;
    while ((m = re.exec(text)) !== null) out[m[2]] = 1;
    var imgRe = /<img[^>]+src=["'](https?:\\/\\/[^"']+)["']/g, m2;
    while ((m2 = imgRe.exec(text)) !== null) out[m2[1]] = 1;
  }

  function fetchAsDataUri(url) {
    return fetch(url).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var contentType = r.headers.get('content-type') || 'image/png';
      return r.arrayBuffer().then(function(buf) {
        var bytes = new Uint8Array(buf), binary = '';
        for (var k = 0; k < bytes.length; k += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
        imgCache[url] = 'data:' + contentType + ';base64,' + btoa(binary);
      });
    }).catch(function() { imgCache[url] = url; });
  }

  function inlineAssets(done) {
    var urls = {};
    FRAMES.forEach(function(f) {
      collectUrls(f.html, urls);
      collectUrls(f.css.replace(/@import\\s+url\\([^)]*\\)[^;]*;/g, ''), urls);
    });
    var list = Object.keys(urls);
    var remaining = list.length;
    if (!remaining) { done(); return; }
    list.forEach(function(url) {
      fetchAsDataUri(url).then(function() {
        remaining--;
        setBar(0.3 * (list.length - remaining) / list.length);
        if (remaining === 0) done();
      });
    });
  }

  function swapUrls(text) {
    for (var url in imgCache) { if (imgCache[url] !== url) text = text.split(url).join(imgCache[url]); }
    return text;
  }

  function inlineGoogleFonts(importUrls, done) {
    if (importUrls.length === 0) { done(''); return; }
    var results = [];
    var remaining = importUrls.length;
    importUrls.forEach(function(cssUrl, idx) {
      fetch(cssUrl).then(function(r) { return r.text(); }).then(function(cssText) {
        var fontUrls = [];
        var re = /url\\((https:[^)]+)\\)/g, m;
        while ((m = re.exec(cssText)) !== null) if (fontUrls.indexOf(m[1]) === -1) fontUrls.push(m[1]);
        var pending = fontUrls.length;
        if (pending === 0) { results[idx] = cssText; if (--remaining === 0) done(results.join('\\n')); return; }
        fontUrls.forEach(function(fontUrl) {
          fetch(fontUrl).then(function(r) { return r.arrayBuffer(); }).then(function(buf) {
            var bytes = new Uint8Array(buf), binary = '';
            for (var i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            cssText = cssText.split(fontUrl).join('data:font/woff2;base64,' + btoa(binary));
            if (--pending === 0) { results[idx] = cssText; if (--remaining === 0) done(results.join('\\n')); }
          }).catch(function() { if (--pending === 0) { results[idx] = cssText; if (--remaining === 0) done(results.join('\\n')); } });
        });
      }).catch(function() { results[idx] = ''; if (--remaining === 0) done(results.join('\\n')); });
    });
  }

  function loadFrameImage(i, fontCss, done) {
    var f = FRAMES[i];
    var scopedCss = mapBodySelectors(swapUrls(f.css)).replace(/@import\\s+url\\([^)]*\\)[^;]*;/g, '');
    var xhtml = toXhtml(swapUrls(f.html));
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + f.w + '" height="' + f.h + '">'
      + '<foreignObject width="100%" height="100%">'
      + '<div xmlns="http://www.w3.org/1999/xhtml" style="width:' + f.w + 'px;height:' + f.h + 'px;position:relative;background:' + f.bg + ';overflow:hidden">'
      + '<style>' + fontCss + '\\n#__df_content{width:' + f.w + 'px;height:' + f.h + 'px;overflow:hidden}\\n' + scopedCss + '</style>' + xhtml + '</div></foreignObject></svg>';
    var img = new Image();
    img.onload = function() { setTimeout(function() { done(img); }, 120); };
    img.onerror = function() { done(null); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function preloadAll(fontCss, done) {
    var imgs = new Array(FRAMES.length);
    var i = 0;
    function next() {
      if (i >= FRAMES.length) { done(imgs); return; }
      setStatus('Rasterizando frame ' + (i + 1) + ' de ' + FRAMES.length + '…');
      setBar(0.3 + 0.4 * i / FRAMES.length);
      loadFrameImage(i, fontCss, function(img) { imgs[i] = img; i++; next(); });
    }
    next();
  }

  function pickMime() {
    var candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    if (!window.MediaRecorder) return '';
    for (var i = 0; i < candidates.length; i++) {
      try { if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i]; } catch (e) {}
    }
    return '';
  }

  function record(imgs) {
    var mime = pickMime();
    if (!mime) { setStatus('Tu navegador no soporta grabación de video (MediaRecorder). Usa Chrome o Edge.', '#dc2626'); return; }
    setStatus('Grabando video en tiempo real…');
    setBar(0.75);
    var stream = canvas.captureStream(0);
    var track = stream.getVideoTracks()[0];
    var rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12000000 });
    var chunks = [];
    rec.ondataavailable = function(e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = function() {
      setBar(1);
      var blob = new Blob(chunks, { type: mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = safeName + '.' + (mime.indexOf('mp4') !== -1 ? 'mp4' : 'webm');
      a.click();
      setStatus('Video descargado ✓ (' + FRAMES.length + ' frames, ${durationSec}s)', '#059669');
    };
    function draw(img, alpha) {
      ctx.save();
      if (alpha !== undefined) ctx.globalAlpha = alpha;
      ctx.drawImage(img, 0, 0, W, H);
      ctx.restore();
    }
    if (imgs[0]) draw(imgs[0]);
    rec.start();
    var total = FRAMES.length * SPF * 1000;
    var t0 = performance.now();
    function tick(now) {
      var t = now - t0;
      if (t >= total) { rec.stop(); return; }
      var idx = Math.min(Math.floor(t / (SPF * 1000)), FRAMES.length - 1);
      if (imgs[idx]) draw(imgs[idx]);
      var tIn = t - idx * SPF * 1000;
      if (XF > 0 && idx < FRAMES.length - 1 && tIn > (SPF - XF) * 1000 && imgs[idx + 1]) {
        draw(imgs[idx + 1], (tIn - (SPF - XF) * 1000) / (XF * 1000));
      }
      if (track.requestFrame) track.requestFrame();
      setBar(0.75 + 0.25 * t / total);
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  var imports = [];
  var importRe = /@import\\s+url\\(['\"]?([^'\")]+)['\"]?\\)/g, im;
  FRAMES.forEach(function(f) {
    var mm;
    while ((mm = importRe.exec(f.css)) !== null) {
      if (mm[1].indexOf('fonts.googleapis.com') !== -1 && imports.indexOf(mm[1]) === -1) imports.push(mm[1]);
    }
  });

  setStatus('Incrustando imágenes…');
  setBar(0.05);
  inlineAssets(function() {
    setStatus('Cargando fuentes…');
    inlineGoogleFonts(imports, function(fontCss) {
      preloadAll(fontCss, record);
    });
  });
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
      // REQ-032 render_frame_png: upload=1 convierte la página de captura en
      // flujo asset — rasteriza y sube el PNG vía /mcp (upload_image) usando
      // el MISMO key que autorizó fetchTemplate (?key=, convención del video).
      const qs = event.queryStringParameters || {};
      const capture = qs.upload === "1" ? {
        key: qs.key || "",
        workspaceId: qs.workspaceId || "default",
        assetName: qs.assetName || `render_${templateId}_${frameId}_x${scale}`,
        includeBase64: qs.base64 === "1",
        // REQ-032 Tool 3 — modo diff (?diff=1): la página compara el render
        // contra la referencia (URL firmada/pública en ?ref=) por bloques de
        // 32px con el umbral dado y sube el compuesto. Localización, no oráculo.
        diff: qs.diff === "1" ? {
          ref: qs.ref || "",
          mode: ["side-by-side", "heatmap", "score"].indexOf(qs.mode) !== -1 ? qs.mode : "heatmap",
          threshold: isFinite(parseFloat(qs.threshold)) ? parseFloat(qs.threshold) : 0.12,
        } : null,
      } : null;
      const html = buildRenderPageHtml(frameTpl, width, height, format, scale, templateId + "_" + frameId, capture);
      return { statusCode: 200, headers: htmlHeaders, body: html };
    }
  }

  // ── Video export: GET /api/render/:templateId/video ──
  // Serves the self-contained MediaRecorder page (see buildVideoPageHtml).
  // Authorization happens inside fetchTemplate via forwarded headers or ?key=;
  // without credentials the internal template fetch 401s and this returns 404.
  if (event.httpMethod === "GET" && /\/video$/.test(rawPath)) {
    const match = rawPath.match(/^\/api\/render\/(.+?)\/video$/);
    if (match) {
      const templateId = match[1];
      const tpl = await fetchTemplate(templateId, event);
      if (!tpl) {
        return { statusCode: 404, headers: jsonHeaders, body: JSON.stringify({ error: "Template not found", templateId }) };
      }
      const q = event.queryStringParameters || {};
      const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
      const fps = clamp(parseInt(String(q.fps || "30"), 10) || 30, 5, 60);
      const spf = clamp(parseFloat(String(q.spf || "2")) || 2, 0.2, 30);
      const scale = clamp(parseInt(String(q.scale || "1"), 10) || 1, 1, 4);
      const crossfade = Math.min(Math.max(parseFloat(String(q.crossfade || "0")) || 0, 0), Math.min(spf, 2));
      const requestedIds = q.frameIds ? String(q.frameIds).split(",").filter(Boolean) : null;
      let frames = Array.isArray(tpl.frames) && tpl.frames.length
        ? tpl.frames
        : [{ id: tpl.id || templateId, name: tpl.name || "Frame", width: tpl.width || 1080, height: tpl.height || 1080, html: tpl.html || "", css: tpl.css || "" }];
      if (requestedIds && requestedIds.length) frames = frames.filter(f => requestedIds.includes(f.id));
      if (!frames.length) {
        return { statusCode: 404, headers: jsonHeaders, body: JSON.stringify({ error: "No frames matched", templateId, requestedIds }) };
      }
      // Cap: a WebM recorded in real time — 60 × 30s would already be 30 minutes.
      frames = frames.slice(0, 60);
      const html = buildVideoPageHtml(tpl, frames, { fps, spf, scale, crossfade, templateId });
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
      body = parseHandlerJson(event);
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
