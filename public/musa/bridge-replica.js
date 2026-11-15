/* bridge-replica.js — réplicas 100 % editables en el editor de diseño (QA Instinct, 2026-11-11).
 *
 * Ronda R3 (bugs): el menú Crear y los diálogos «mx» (Nuevo diseño…) se exponen con roles accesibles
 * (menu/menuitem, dialog + foco en el primer campo); elegir archivo usa un control VISIBLE que funciona aunque el
 * navegador no abra la ventana nativa al primer clic; al importar se informa qué quedó editable y qué es raster.
 *
 * Spec de herramientas nuevas (todas crean capas nativas y existen también por MCP, mismos atributos):
 *   1 Vectorizar (motor propio, sin IA) · 2 OCR → capas de texto con fuente del catálogo · 3 Separar sujeto/fondo ·
 *   4 ASCII como texto mono (pegar o convertir una imagen) · 5 Halftone no destructivo · 6 SVG → capas por forma ·
 *   7 Máscara con forma, tamaño y centro · 8 Borrar zona (reversible) · 9 Texturas paramétricas (grano, papel,
 *   crayón, ruido) · 10 Emoji como vector · 11 Texto vertical y en trayectoria (arco, círculo, onda).
 * Al exportar, lo que html2canvas no sabe dibujar (texto vertical, texto en trayectoria) se pinta antes en un canvas
 * con las mismas fuentes (RB._preShot). */
(function () {
  "use strict";
  var RB = window.__musaReal; if (!RB || RB._replica) return; RB._replica = true;
  function T(s) { return s; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var cl = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var r2 = function (v) { return Math.round(v * 100) / 100; };
  var numv = function (v, d) { v = parseFloat(v); return isFinite(v) ? v : d; };
  function say(m) { try { if (typeof toast === "function") toast(m); } catch (e) {} }

  /* ═════════════ R3-1 · accesibilidad del menú Crear y de los diálogos ═════════════ */
  var lastOpener = null;
  document.addEventListener("pointerdown", function (e) { var b = e.target.closest && e.target.closest("button,[role=button]"); if (b) lastOpener = b; }, true);
  document.addEventListener("keydown", function (e) { if ((e.key === "Enter" || e.key === " ") && document.activeElement && document.activeElement.tagName === "BUTTON") lastOpener = document.activeElement; }, true);
  function a11yMenu(m) {
    if (m.__a11y) return; m.__a11y = 1;
    m.setAttribute("role", "menu");
    var op = lastOpener && lastOpener.isConnected && !m.contains(lastOpener) ? lastOpener : null;
    if (op) { op.setAttribute("aria-haspopup", "menu"); op.setAttribute("aria-expanded", "true"); var lab = (op.getAttribute("aria-label") || op.textContent || "").trim().slice(0, 40); if (lab) m.setAttribute("aria-label", lab); }
    var items = [].filter.call(m.querySelectorAll("button,a[href]"), function (b) { return !b.disabled; });
    items.forEach(function (b, i) {
      b.setAttribute("role", "menuitem"); b.tabIndex = i ? -1 : 0;
      var sm = b.querySelector("small"), main = "";
      [].forEach.call(b.childNodes, function (n) { if (n.nodeType === 3) main += n.textContent; });
      if (!b.getAttribute("aria-label") && main.trim()) b.setAttribute("aria-label", main.trim() + (sm ? ". " + sm.textContent.trim() : ""));
    });
    m.addEventListener("keydown", function (e) {
      var k = e.key, i = items.indexOf(document.activeElement); if (!/^(ArrowDown|ArrowUp|Home|End)$/.test(k)) return;
      e.preventDefault();
      var n = k === "Home" ? 0 : k === "End" ? items.length - 1 : (i + (k === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      if (items[n]) items[n].focus();
    });
    if (items[0] && !m.querySelector("input,textarea,select")) setTimeout(function () { try { if (m.isConnected) items[0].focus({ preventScroll: true }); } catch (e) {} }, 0);
    var obs = new MutationObserver(function () { if (!m.isConnected) { obs.disconnect(); if (op) op.setAttribute("aria-expanded", "false"); } });
    obs.observe(document.body, { childList: true, subtree: false });
  }
  function a11yDialog(d) {
    /* un diálogo oculto deja de ser diálogo (quedaban dos [role=dialog] en la página; QA lanzamiento #4) */
    if (d && d.hidden) { var hb = d.querySelector(".mx-box"); if (hb) { hb.removeAttribute("role"); hb.removeAttribute("aria-modal"); } return; }
    if (!d) return;
    var box = d.querySelector(".mx-box") || d; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
    var h = box.querySelector("h3"); if (h) { if (!h.id) h.id = "mxT" + Date.now().toString(36); box.setAttribute("aria-labelledby", h.id); }
    var x = box.querySelector("[data-mx=close].x,.ch .x"); if (x && !x.getAttribute("aria-label")) x.setAttribute("aria-label", "Cerrar");
    [].forEach.call(box.querySelectorAll("input,select,textarea"), function (c) {
      if (c.getAttribute("aria-label") || (c.id && box.querySelector('label[for="' + c.id + '"]'))) return;
      var l = c.closest(".mbc-f,.fx-f,label"), t = l && l.querySelector(".fx-lbl,span,b"); if (t) c.setAttribute("aria-label", t.textContent.replace(/\*$/, "").trim());
    });
    if (!box.contains(document.activeElement)) { var f = box.querySelector("input:not([type=hidden]),select,textarea,button.pri"); if (f) setTimeout(function () { try { f.focus({ preventScroll: true }); } catch (e) {} }, 30); }
  }
  new MutationObserver(function (muts) {
    muts.forEach(function (m) {
      if (m.type === "attributes") { if (m.target.classList && m.target.classList.contains("mx")) a11yDialog(m.target); return; }
      [].forEach.call(m.addedNodes, function (n) {
        if (n.nodeType !== 1) return;
        if (n.classList.contains("fx-menu")) a11yMenu(n);
        else if (n.childElementCount < 40 && n.querySelector) { var fm = n.querySelector(".fx-menu"); if (fm) a11yMenu(fm); }
        if (n.classList.contains("mx")) a11yDialog(n);
        if (n.getAttribute && n.getAttribute("data-musa-dialog") === "import-report") importReport(n);
        else if (n.querySelector && n.childElementCount < 40) { var ir = n.querySelector('[data-musa-dialog="import-report"]'); if (ir) importReport(ir); }
      });
    });
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  [].forEach.call(document.querySelectorAll(".mx"), function (d) { var o = new MutationObserver(function () { a11yDialog(d); }); o.observe(d, { childList: true }); });
  var mxWatch = new MutationObserver(function () { [].forEach.call(document.querySelectorAll(".mx:not([hidden])"), a11yDialog); });
  [].forEach.call(document.querySelectorAll(".mx"), function (d) { mxWatch.observe(d, { childList: true }); });

  /* ═════════════ R3-2/3 · elegir archivo con un control visible ═════════════ */
  var stl = document.createElement("style");
  stl.textContent = ".mr-pick{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483000;display:flex;gap:10px;align-items:center;background:#141414;color:#fff;border:1px solid #333;border-radius:14px;padding:10px 12px;box-shadow:0 18px 40px rgba(0,0,0,.45);font:600 13px/1.2 Inter,system-ui,sans-serif}"
    + ".mr-pick b{font-weight:700;max-width:280px}.mr-pbtn{position:relative;overflow:hidden;background:#ff5e00;color:#fff;border-radius:10px;padding:9px 14px;cursor:pointer;font-weight:700}"
    + ".mr-pbtn input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%}.mr-pbtn:focus-within{outline:2px solid #fff;outline-offset:2px}"
    + ".mr-px{background:#262626;color:#ddd;border:0;border-radius:10px;padding:9px 12px;cursor:pointer;font:inherit}"
    + ".mr-sec .ed-row{flex-wrap:wrap}.mr-sec .ed-row button{min-width:46%}.mr-sec .ef{min-width:0}.mr-sec .ef span{flex-shrink:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"
    + ".mr-zone{position:fixed;border:2px dashed #ff00ff;background:rgba(255,0,255,.12);z-index:60;pointer-events:none}";
  document.head.appendChild(stl);
  RB.pickFileVisible = function (accept, label) {
    return new Promise(function (res) {
      var old = document.querySelector(".mr-pick"); if (old) old.__fin && old.__fin(null);
      var box = document.createElement("div"); box.className = "mr-pick"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", label || "Elegir archivo");
      box.innerHTML = "<b>" + esc(label || "Elegir archivo") + '</b><label class="mr-pbtn">Elegir archivo<input type="file" accept="' + esc(accept || "") + '" aria-label="' + esc(label || "Elegir archivo") + '" data-musa-file="' + esc(label || "archivo") + '"></label><button type="button" class="mr-px">Cancelar</button>';
      var inp = box.querySelector("input"), done = false;
      var fin = box.__fin = function (f) { if (done) return; done = true; box.remove(); document.removeEventListener("keydown", onKey, true); res(f || null); };
      var onKey = function (e) { if (e.key === "Escape") fin(null); };
      inp.addEventListener("change", function () { fin(inp.files && inp.files[0]); });
      /* si la ventana nativa se cierra sin archivo (o un navegador automatizado la cancela), el panel sigue a la vista */
      box.querySelector(".mr-px").onclick = function () { fin(null); };
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(box);
      try { inp.click(); } catch (e) {}
      setTimeout(function () { if (!done && document.activeElement === document.body) try { inp.focus(); } catch (e) {} }, 400);
    });
  };

  /* ═════════════ informe raster vs vector (al importar y desde Props) ═════════════ */
  function kindOfNode(n) {
    var tag = n.tagName.toLowerCase(), st = n.getAttribute("style") || "";
    if (n.getAttribute("data-mr-tp")) return "texto en trayectoria";
    var fx = n.getAttribute("data-mr-fx") || "";
    if (/"t":"halftone"/.test(fx)) return "halftone (vector)";
    if (/"t":"texture"/.test(fx)) return "textura (paramétrica)";
    if (tag === "svg" || (n.children.length === 1 && n.firstElementChild.tagName.toLowerCase() === "svg")) return "vector";
    var bg = /url\(["']?([^"')]+)/.exec(st), src = tag === "img" ? n.getAttribute("src") : bg && bg[1];
    if (src) return /\.svg(\?|$)|^data:image\/svg/i.test(src) ? "vector (archivo SVG)" : "imagen (raster)";
    var own = [].some.call(n.childNodes, function (c) { return c.nodeType === 3 && c.textContent.trim(); });
    if (own || (/^(p|h\d|span|pre|a|button|li)$/.test(tag) && n.textContent.trim())) return "texto";
    return "forma / color";
  }
  function reportOf(frames) {
    var out = { counts: {}, raster: [] };
    frames.forEach(function (f) {
      var d = new DOMParser().parseFromString("<body>" + (f.html || "") + "</body>", "text/html");
      var nodes = d.body.querySelectorAll("[data-layer-id]");
      /* recién importado todavía no tiene ids de capa (el editor los pone al abrir): se cuentan las piezas visibles */
      if (!nodes.length) nodes = [].filter.call(d.body.querySelectorAll("*"), function (n) {
        var t = n.tagName.toLowerCase(); if (/^(style|script|link|meta|br|defs|title)$/.test(t) || (n.parentNode.closest && n.parentNode.closest("svg"))) return false;
        if (t === "img" || t === "svg") return true;
        var own = [].some.call(n.childNodes, function (c) { return c.nodeType === 3 && c.textContent.trim(); });
        return own || (!n.children.length && /(background|clip-path|border)/.test(n.getAttribute("style") || "") ) || (!n.children.length && n.className);
      });
      [].forEach.call(nodes, function (n) {
        if (n.closest("svg") && n.tagName.toLowerCase() !== "svg") return;
        if (/display\s*:\s*none/.test(n.getAttribute("style") || "")) return;
        var k = kindOfNode(n); out.counts[k] = (out.counts[k] || 0) + 1;
        if (k === "imagen (raster)") out.raster.push((f.name ? f.name + " › " : "") + (n.getAttribute("data-layer-name") || n.getAttribute("data-layer-id")));
      });
    });
    return out;
  }
  function reportHtml(r) {
    var ed = ["texto", "vector", "vector (archivo SVG)", "forma / color", "texto en trayectoria", "halftone (vector)", "textura (paramétrica)"];
    var nEd = ed.reduce(function (n, k) { return n + (r.counts[k] || 0); }, 0), nR = r.counts["imagen (raster)"] || 0;
    return '<div class="mr-rep" style="margin:6px 0 10px;padding:10px 12px;border-radius:10px;background:rgba(127,127,127,.12)"><p class="msg" style="margin:0 0 4px"><b>Editable: ' + nEd + " capa" + (nEd === 1 ? "" : "s") + "</b> · " + ed.filter(function (k) { return r.counts[k]; }).map(function (k) { return r.counts[k] + " " + k; }).join(" · ")
      + "</p><p class=\"msg\" style=\"margin:0\"><b>Raster: " + nR + "</b>" + (nR ? " — " + r.raster.slice(0, 8).map(esc).join(", ") + (r.raster.length > 8 ? "…" : "") + ". Las fotos reales son raster; ilustraciones, íconos y tramas se pueden pasar a vector con «Vectorizar» o «Halftone» en Props." : " — nada quedó como imagen.") + "</p></div>";
  }
  function importReport(dlg) {
    if (dlg.__rep) return; dlg.__rep = 1;
    var tries = 0;
    var go = function () {
      var id = ED && ED.doc && ED.doc._id; if (!id) { if (++tries < 20) setTimeout(go, 300); return; }
      var api = window.parent.__musaBridge && window.parent.__musaBridge.api; if (!api) return;
      api("/rest/v1/templates?id=eq." + encodeURIComponent(id) + "&select=fr:data->frames").then(function (rows) {
        var fr = (rows && rows[0] && rows[0].fr) || []; if (!fr.length || !dlg.isConnected) return;
        var names = [].map.call(dlg.querySelectorAll(".msg b"), function (b) { return b.textContent; }).join(" ");
        var mine = fr.slice(-Math.max(1, parseInt((/(\d+) frame/.exec(names) || [0, 1])[1], 10)));
        var host = dlg.querySelector(".imp-cmp") || dlg.querySelector(".msg"); if (host) host.insertAdjacentHTML("beforebegin", reportHtml(reportOf(mine)));
      }, function () {});
    };
    setTimeout(go, 400);
  }

  /* ═════════════ utilidades del editor ═════════════ */
  function edOn() { return typeof ED !== "undefined" && ED.open && ED.doc && ED.doc._real; }
  function cur() { if (!edOn() || !ED.sel) return null; var f = ED.doc.frames[ED.sel.f]; if (!f) return null; return { f: f, fi: ED.sel.f, ei: ED.sel.e, o: ED.sel.e != null ? f.els[ED.sel.e] : null }; }
  function nodeUrl(o) {
    if (!o || !o._n) return null; var n = o._n;
    if (n.tagName === "IMG") return n.currentSrc || n.getAttribute("src");
    var m = /url\(["']?([^"')]+)["']?\)/.exec(n.style.backgroundImage || getComputedStyle(n).backgroundImage || ""); if (m) return m[1];
    var im = n.querySelector && n.children.length === 1 && n.querySelector("img"); return im ? im.getAttribute("src") : null;
  }
  var seq = 0; function lid(p) { return (p || "musa") + "_" + Date.now().toString(36) + "_" + (seq++).toString(36); }
  function fxOf(n) { try { return JSON.parse(n.getAttribute("data-mr-fx") || "null"); } catch (e) { return null; } }
  function tpOf(n) { try { return JSON.parse(n.getAttribute("data-mr-tp") || "null"); } catch (e) { return null; } }
  function addLayer(f, html, name, kind, after, box) {
    var t = document.createElement("div"); t.innerHTML = html; var n = t.firstElementChild;
    n.setAttribute("data-layer-id", lid()); n.setAttribute("data-layer-name", name); n.setAttribute("data-layer-kind", kind);
    if (after && after.parentNode) after.parentNode.insertBefore(n, after.nextSibling); else (f._content || f._root).appendChild(n);
    var e = RB._mk(n, f), at = after ? f.els.findIndex(function (x) { return x._n === after; }) + 1 : f.els.length;
    if (at <= 0) at = f.els.length;
    f.els.splice(at, 0, e);
    if (box) { try { e.x = box.x; e.y = box.y; } catch (x) {} }
    return { e: e, n: n, at: at };
  }
  function focusLayer(fi, at) { ED.sel = { f: fi, e: at }; edRender(); edLayers(); edProps(); }
  function boxOf(o) { return { x: o.x, y: o.y, w: o.w, h: o.h }; }
  var absCss = function (b) { return "position:absolute;left:" + r2(b.x) + "px;top:" + r2(b.y) + "px;width:" + r2(b.w) + "px;height:" + r2(b.h) + "px;margin:0;box-sizing:border-box"; };
  function useFont(f, fam) {
    if (!fam || /^(inter|arial|helvetica|georgia|monospace|serif|sans-serif|system-ui)$/i.test(fam)) return;
    var href = "https://fonts.googleapis.com/css?family=" + encodeURIComponent(fam).replace(/%20/g, "+") + ":400,500,700,900&display=swap";
    var src = f._src; if (src && (src.css || "").indexOf(href) < 0) { try { src.css = '@import url("' + href + '");\n' + (src.css || ""); } catch (e) {} }
    if (!document.querySelector('link[data-mr-font="' + fam + '"]')) { var l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; l.setAttribute("data-mr-font", fam); document.head.appendChild(l); }
  }
  var IMGC = {};
  function pixels(url, max) {
    var key = url + "|" + (max || 0);
    if (IMGC[key]) return IMGC[key];
    return IMGC[key] = new Promise(function (ok, ko) {
      var im = new Image(); im.crossOrigin = "anonymous";
      im.onload = function () {
        var s = Math.min(1, (max || 1200) / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(im.naturalWidth * s)); c.height = Math.max(1, Math.round(im.naturalHeight * s));
        var g = c.getContext("2d"); g.drawImage(im, 0, 0, c.width, c.height);
        try { ok({ c: c, w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data }); } catch (e) { delete IMGC[key]; ko(new Error("la imagen no permite leer sus píxeles")); }
      };
      im.onerror = function () { delete IMGC[key]; ko(new Error("no se pudo leer la imagen")); }; im.src = url;
    });
  }
  function lum(r, g, b) { return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; }
  function saveFirst() { return new Promise(function (r) { RB._ownAt = Date.now(); if (RB._ed) RB._ed.save(); setTimeout(r, 2600); }); }
  function reopenSelect(layerId) {
    var id = ED.doc._id; RB._ownAt = Date.now(); RB.openDesign(id);
    var n = 0, iv = setInterval(function () {
      if (++n > 60) return clearInterval(iv);
      if (!edOn() || ED.doc._id !== id || !ED.doc.frames.length || !ED.doc.frames[0].els) return;
      clearInterval(iv); if (!layerId) return;
      ED.doc.frames.some(function (f, fi) { var e = f.els.findIndex(function (x) { return x._n && x._n.getAttribute("data-layer-id") === layerId; }); if (e >= 0) { setTimeout(function () { focusLayer(fi, e); }, 200); return true; } });
    }, 250);
  }
  function serverOp(title, tool, args, after) {
    var pg = RB.progress ? RB.progress(title, "Guardando tus cambios…") : null;
    var call = function () { return RB.mcp(tool, args); };
    return saveFirst().then(function () { if (pg) pg.set(30, "Trabajando…"); return call().catch(function (e) { if (!/503|502|timeout|exceeded/i.test(String(e && e.message))) throw e; if (pg) pg.set(55, "El servidor estaba ocupado, reintentando…"); return new Promise(function (r) { setTimeout(r, 2500); }).then(call); }); })
      .then(function (r) { if (pg) pg.close(); return after ? after(r) : r; }, function (e) { if (pg) pg.close(); var m = String(e && e.message || e); say(title + ": " + (/NO_VISION|NO_GEMINI|llave|key/i.test(m) ? m.replace(/^NO_\w+:\s*/, "") : m)); throw e; });
  }
  function frameId(f) { return f._src && f._src.id; }
  function layerIdOf(o) { return o && o._n && o._n.getAttribute("data-layer-id"); }

  /* ── generadores (los mismos que mcp-v2-replica.mjs) ── */
  function maskCss(shape, size, cx, cy, radius) {
    var s = cl(numv(size, 100), 5, 100) / 100, x = cl(numv(cx, 50), 0, 100), y = cl(numv(cy, 50), 0, 100);
    var poly = function (pts) { return "polygon(" + pts.map(function (q) { return r2(x + (q[0] - 50) * s) + "% " + r2(y + (q[1] - 50) * s) + "%"; }).join(",") + ")"; };
    switch (shape) {
      case "circle": return "circle(" + r2(50 * s) + "% at " + x + "% " + y + "%)";
      case "ellipse": return "ellipse(" + r2(50 * s) + "% " + r2(50 * s) + "% at " + x + "% " + y + "%)";
      case "rounded": return "inset(" + r2(y - 50 * s) + "% " + r2(100 - (x + 50 * s)) + "% " + r2(100 - (y + 50 * s)) + "% " + r2(x - 50 * s) + "% round " + cl(numv(radius, 12), 0, 50) + "%)";
      case "diamond": return poly([[50, 0], [100, 50], [50, 100], [0, 50]]);
      case "triangle": return poly([[50, 0], [100, 100], [0, 100]]);
      case "hexagon": return poly([[25, 0], [75, 0], [100, 50], [75, 100], [25, 100], [0, 50]]);
      case "star": { var pts = []; for (var i = 0; i < 10; i++) { var rr = i % 2 ? 20 : 50, a = (i * 36 - 90) * Math.PI / 180; pts.push([50 + rr * Math.cos(a), 52 + rr * Math.sin(a)]); } return poly(pts); }
      default: return "";
    }
  }
  function asciiFrom(P, cols, ramp, invert) {
    cols = cl(Math.round(cols), 8, 300); ramp = ramp || " .:-=+*#%@";
    var w = P.w, h = P.h, d = P.d, rows = Math.max(1, Math.round(cols * (h / w) * 0.55)), cw = w / cols, ch = h / rows, out = [];
    for (var r = 0; r < rows; r++) {
      var line = "";
      for (var c = 0; c < cols; c++) {
        var sum = 0, a = 0, n = 0, sy = Math.max(1, Math.floor(ch / 3)), sx = Math.max(1, Math.floor(cw / 3));
        for (var yy = Math.floor(r * ch); yy < Math.min(h, Math.floor((r + 1) * ch)); yy += sy) for (var xx = Math.floor(c * cw); xx < Math.min(w, Math.floor((c + 1) * cw)); xx += sx) { var i = (yy * w + xx) * 4; sum += lum(d[i], d[i + 1], d[i + 2]); a += d[i + 3] / 255; n++; }
        var L = n ? sum / n : 1, A = n ? a / n : 0;
        if (A < 0.1) { line += " "; continue; }
        var v = invert ? 1 - L : L; line += ramp[Math.min(ramp.length - 1, Math.floor(v * ramp.length))];
      }
      out.push(line.replace(/\s+$/, ""));
    }
    return out.join("\n");
  }
  function halftoneSvg(P, box, o) {
    var cell = cl(numv(o.cell, 10), 3, 80), ang = numv(o.angle, 45) * Math.PI / 180, shape = o.shape || "circle", color = o.color || "#111111", thr = cl(numv(o.threshold, 0), 0, 100) / 100;
    var cos = Math.cos(ang), sin = Math.sin(ang), W = box.w, H = box.h, diag = Math.hypot(W, H), cx = W / 2, cy = H / 2, marks = [], n = 0, d = P.d;
    for (var v = -diag / 2; v <= diag / 2 && n < 16000; v += cell) for (var u = -diag / 2; u <= diag / 2 && n < 16000; u += cell) {
      var X = cx + u * cos - v * sin, Y = cy + u * sin + v * cos; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      var i = (Math.floor(Y / H * P.h) * P.w + Math.floor(X / W * P.w)) * 4; if (d[i + 3] < 25) continue;
      var dk = 1 - lum(d[i], d[i + 1], d[i + 2]); if (dk <= thr + 0.02) continue;
      var k = Math.sqrt(dk);
      if (shape === "square") { var s = r2(cell * 0.92 * k); marks.push('<rect x="' + r2(X - s / 2) + '" y="' + r2(Y - s / 2) + '" width="' + s + '" height="' + s + '"/>'); }
      else if (shape === "line") { var t = r2(cell * 0.9 * dk); marks.push('<rect x="' + r2(X - cell / 2) + '" y="' + r2(Y - t / 2) + '" width="' + r2(cell) + '" height="' + t + '" transform="rotate(' + r2(numv(o.angle, 45)) + " " + r2(X) + " " + r2(Y) + ')"/>'); }
      else marks.push('<circle cx="' + r2(X) + '" cy="' + r2(Y) + '" r="' + r2(cell * 0.56 * k) + '"/>');
      n++;
    }
    return '<svg viewBox="0 0 ' + r2(W) + " " + r2(H) + '" width="100%" height="100%" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">' + (o.background ? '<rect width="100%" height="100%" fill="' + esc(o.background) + '"/>' : "") + '<g fill="' + esc(color) + '">' + marks.join("") + "</g></svg>";
  }
  function textPathSvg(cfg, w, h) {
    var curve = cl(numv(cfg.curve, 50), -100, 100), size = numv(cfg.size, 48), id = cfg.pid || lid("tp"), d;
    if (cfg.mode === "circle") { var r = Math.max(10, Math.min(w, h) / 2 - size * 0.7), cx = w / 2, cy = h / 2; d = "M " + r2(cx) + " " + r2(cy + r) + " A " + r2(r) + " " + r2(r) + " 0 1 1 " + r2(cx + 0.01) + " " + r2(cy + r); }
    else if (cfg.mode === "wave") { var a = h / 2 * Math.abs(curve) / 100 * 0.8, y = h / 2, q = w / 4; d = "M 0 " + r2(y) + " Q " + r2(q) + " " + r2(y - a) + " " + r2(2 * q) + " " + r2(y) + " T " + r2(w) + " " + r2(y); }
    else { var y0 = curve >= 0 ? h - size * 0.4 : size, k = (curve / 100) * (h - size); d = "M 0 " + r2(y0) + " Q " + r2(w / 2) + " " + r2(y0 - 2 * k) + " " + r2(w) + " " + r2(y0); }
    var fam = String(cfg.font || "Inter").replace(/["<>]/g, "");
    return '<svg viewBox="0 0 ' + r2(w) + " " + r2(h) + '" width="100%" height="100%" overflow="visible" xmlns="http://www.w3.org/2000/svg"><path id="' + id + '" d="' + d + '" fill="none"/><text font-family="\'' + fam + '\', sans-serif" font-size="' + r2(size) + '" font-weight="' + numv(cfg.weight, 700) + '" fill="' + esc(cfg.color || "#111111") + '" letter-spacing="' + numv(cfg.ls, 0) + '"><textPath href="#' + id + '" startOffset="50%" text-anchor="middle">' + esc(cfg.text || "") + "</textPath></text></svg>";
  }
  var TEXTURES = {
    grain: function (k, id) { return '<filter id="' + id + '" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="n"/><feColorMatrix in="n" type="saturate" values="0" result="g"/><feComponentTransfer in="g" result="a"><feFuncA type="linear" slope="' + r2(0.6 * k) + '"/></feComponentTransfer><feComposite in="a" in2="SourceGraphic" operator="in" result="m"/><feBlend in="SourceGraphic" in2="m" mode="multiply"/></filter>'; },
    paper: function (k, id) { return '<filter id="' + id + '"><feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="4" seed="7" result="n"/><feDiffuseLighting in="n" lighting-color="#ffffff" surfaceScale="' + r2(2 * k) + '" result="l"><feDistantLight azimuth="45" elevation="60"/></feDiffuseLighting><feComposite in="l" in2="SourceGraphic" operator="in" result="m"/><feBlend in="SourceGraphic" in2="m" mode="multiply"/></filter>'; },
    crayon: function (k, id) { return '<filter id="' + id + '"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" seed="11" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="' + r2(2 + 4 * k) + '" xChannelSelector="R" yChannelSelector="G" result="d"/><feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="1" seed="5" result="g"/><feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ' + r2(-2.2 * k) + " " + r2(1 + 0.9 * k) + '" result="holes"/><feComposite in="d" in2="holes" operator="in"/></filter>'; },
    noise: function (k, id) { return '<filter id="' + id + '"><feTurbulence type="turbulence" baseFrequency="0.65" numOctaves="3" seed="2" result="n"/><feColorMatrix in="n" type="saturate" values="0" result="g"/><feComponentTransfer in="g" result="a"><feFuncA type="linear" slope="' + r2(0.8 * k) + '"/></feComponentTransfer><feComposite in="a" in2="SourceGraphic" operator="in" result="m"/><feBlend in="SourceGraphic" in2="m" mode="overlay"/></filter>'; },
  };
  function twemojiUrl(emoji) {
    var cps = Array.from(String(emoji).trim()).map(function (c) { return c.codePointAt(0).toString(16); });
    var keep = cps.indexOf("200d") >= 0 ? cps : cps.filter(function (c) { return c !== "fe0f"; });
    return "https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/" + keep.join("-") + ".svg";
  }
  function cleanSvg(s) {
    s = String(s || ""); var i = s.search(/<svg[\s>]/i); if (i < 0) return null; s = s.slice(i);
    if (window.DOMPurify) s = DOMPurify.sanitize(s, { USE_PROFILES: { svg: true, svgFilters: true } });
    else s = s.replace(/<script[\s\S]*?<\/script\s*>/gi, "").replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    return /<svg/i.test(s) ? s : null;
  }
  function svgParts(svg) {
    var doc = new DOMParser().parseFromString(svg, "image/svg+xml"), root = doc.documentElement; if (!root || root.nodeName.toLowerCase() !== "svg") return [svg];
    var SH = /^(defs|style|title|desc|metadata|lineargradient|radialgradient|clippath|mask|pattern|filter|symbol)$/i, DR = function (n) { return !SH.test(n.nodeName); };
    var kids = [].filter.call(root.children, DR);
    if (kids.length === 1 && /^g$/i.test(kids[0].nodeName) && !kids[0].getAttribute("transform") && [].filter.call(kids[0].children, DR).length >= 2) {
      var g = kids[0]; [].slice.call(g.attributes).forEach(function (at) { if (at.name !== "id" && !root.hasAttribute(at.name)) root.setAttribute(at.name, at.value); });
      [].slice.call(g.children).forEach(function (c) { root.insertBefore(c, g); }); root.removeChild(g);
      kids = [].filter.call(root.children, DR);
    }
    if (kids.length < 2) return [svg];
    var ser = new XMLSerializer();
    return kids.slice(0, 60).map(function (keep, ki) { var c = root.cloneNode(true); [].filter.call(c.children, DR).forEach(function (n, i) { if (i !== ki) c.removeChild(n); }); return ser.serializeToString(c); });
  }
  function svgSize(svg) {
    var vb = /viewBox\s*=\s*["']\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([-\d.e]+)[\s,]+([-\d.e]+)/i.exec(svg);
    if (vb) return [+vb[1], +vb[2]];
    var w = /\swidth\s*=\s*["']?([\d.]+)/i.exec(svg), h = /\sheight\s*=\s*["']?([\d.]+)/i.exec(svg); return [w ? +w[1] : 100, h ? +h[1] : 100];
  }
  function fitSvg(s) { return s.replace(/<svg\b([^>]*)>/i, function (m, at) { at = at.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ""); if (!/viewBox/i.test(at)) { var z = svgSize(s); at += ' viewBox="0 0 ' + z[0] + " " + z[1] + '"'; } return '<svg width="100%" height="100%"' + at + ">"; }); }

  /* ═════════════ herramientas ═════════════ */
  var TOOLS = {};
  /* 1 · Vectorizar */
  /* «Vectorizar» unificado (anexo de Instinct): Normal (gratis), Por color (capa por región y por letra), Con IA (Quiver,
     muestra el costo y pide confirmar). La sección vive en Props de la imagen; esto solo la abre. */
  var VZ = { id: null, mode: "trace", colors: [], picking: false, open: false };
  TOOLS.vectorize = function () {
    var c = cur(), o = c && c.o; if (!nodeUrl(o)) return say("Elige una capa de imagen para vectorizar");
    VZ.open = true; edProps();
    setTimeout(function () { var d = props.querySelector("details[data-mr-vz]"); if (d) { d.open = true; d.scrollIntoView({ block: "start" }); } }, 50);
  };
  function vzOpts() {
    var g = function (k, d) { var el = props.querySelector('[data-mr="vz.' + k + '"]'); return el ? (el.type === "checkbox" ? el.checked : el.value) : d; };
    if (VZ.mode === "color_layers") return { colors: VZ.colors.length ? VZ.colors : undefined, maxColors: +g("max", 6), tolerance: +g("tol", 60), simplify: +g("simp", 0.8), lettersAsLayers: g("letters", true), keepBackground: g("bg", false) };
    if (VZ.mode === "ai") return { model: g("model", "arrow-1.1") };
    return { colormode: g("cm", "color"), colorPrecision: +g("cp", 8), filterSpeckle: +g("fs", 4), cornerThreshold: +g("ct", 60), pathPrecision: +g("pp", 6), hierarchical: g("hi", "stacked"), removeBackground: g("rb", false) };
  }
  TOOLS.vectorizeRun = function () {
    var c = cur(), o = c && c.o, url = nodeUrl(o); if (!url) return say("Elige una capa de imagen");
    var mode = VZ.mode, opts = vzOpts();
    var call = function (extra) {
      return pixels(url, mode === "color_layers" ? 600 : mode === "ai" ? 1600 : 900).then(function (P) {
        return serverOp(mode === "ai" ? "Vectorizar con IA" : "Vectorizar", "layer_vectorize", Object.assign({ templateId: ED.doc._id, frameId: frameId(c.f), layerId: layerIdOf(o), imageBase64: P.c.toDataURL("image/png"), engine: mode, options: opts }, extra || {}));
      });
    };
    return call().then(function (r) {
      if (r && r.needsConfirmation) {
        return RB.confirmBox("Vectorizar con Quiver (" + r.model + ") cuesta " + r.estimate + ", con tu llave de Quiver. Los modos Normal y Por color son gratis. ¿Sigo?", { title: "Costo de la IA", ok: "Pagar y vectorizar", action: "vz-cost" })
          .then(function (ok) { return ok ? call({ confirmCost: true }) : null; });
      }
      return r;
    }).then(function (r) {
      if (!r || r.needsConfirmation) return;
      VZ.picking = false;
      var names = (r.layers || []).map(function (l) { return l.name; });
      var modo = { trace: "Normal", color_layers: "Por color", ai: "Con IA · " + (r.model || "") }[r.engine] || r.engine;
      reopenSelect(r.groupId);
      RB.dialog({ title: "Vectorizado", action: "vz-report", ok: "Listo", cancel: false,
        body: '<p class="msg"><b>' + r.vectorLayers + " capas vectoriales</b> en el grupo «Vector · " + esc(o.name || "imagen") + "» (" + esc(modo) + ").</p>"
          + '<p class="msg">' + esc(names.slice(0, 24).join(", ")) + (names.length > 24 ? "…" : "") + "</p>"
          + '<p class="msg"><b>Raster:</b> ' + (r.rasterResidual && r.rasterResidual.length ? esc(r.rasterResidual.join(", ")) : "nada") + ". Cada capa se recolorea en Props.</p>"
          + (r.estimate ? '<p class="msg">Costo: ' + esc(r.estimate) + "</p>" : "") });
    }).catch(function () {});
  };
  function vzSection(o) {
    if (VZ.id !== layerIdOf(o)) { VZ.id = layerIdOf(o); VZ.colors = []; VZ.picking = false; }
    var m = VZ.mode;
    var sw = VZ.colors.map(function (c, i) { return '<button type="button" data-mra="vzdel" data-i="' + i + '" title="Quitar ' + c + '" aria-label="Quitar ' + c + '" style="width:26px;height:26px;border-radius:6px;border:2px solid rgba(255,255,255,.3);background:' + c + ';min-width:0;flex:none;padding:0"></button>'; }).join("");
    var body = selH("vz.mode", "Modo", m, [["trace", "Normal (gratis)"], ["color_layers", "Separar en capas por color (gratis)"], ["ai", "Con IA · Quiver (tiene costo)"]]);
    if (m === "trace") body += selH("vz.cm", "Color", "color", [["color", "A color"], ["bw", "Blanco y negro"]]) + numH("vz.cp", "Colores", 8, 1) + numH("vz.fs", "Limpiar manchas (px)", 4, 1, true)
      + numH("vz.ct", "Esquinas °", 60, 5) + numH("vz.pp", "Precisión", 6, 1) + selH("vz.hi", "Capas", "stacked", [["stacked", "Apiladas (stacked)"], ["cutout", "Recortadas (cutout)"]])
      + '<label class="ef full"><span>Quitar el fondo blanco</span><input type="checkbox" data-mr="vz.rb" style="flex:0"></label>'
      + '<div class="ed-note" style="grid-column:1/-1">Ilustraciones planas, íconos y logos: una capa por color, con curvas.</div>';
    if (m === "color_layers") body += '<div class="ed-note" style="grid-column:1/-1">Una capa con nombre por región («forma rosa 3») y las letras claras dentro de un manchón como capas propias («letra 1»…). Pica los colores sobre la imagen o deja que Musa los elija.</div>'
      + '<div style="grid-column:1/-1;display:flex;gap:6px;flex-wrap:wrap;align-items:center">' + (sw || '<small style="opacity:.7">Colores: automáticos</small>') + "</div>"
      + '<div class="ed-row">' + btn("vzpick", VZ.picking ? "Listo, dejar de picar" : "Picar colores en la imagen") + (VZ.colors.length ? btn("vzclear", "Automáticos") : "") + "</div>"
      + numH("vz.max", "Colores auto", 6, 1) + numH("vz.tol", "Tolerancia", 60, 5) + numH("vz.simp", "Simplificar", 0.8, 0.1, true)
      + '<label class="ef full"><span>Letras como capas</span><input type="checkbox" data-mr="vz.letters" checked style="flex:0"></label><label class="ef full"><span>Incluir el fondo</span><input type="checkbox" data-mr="vz.bg" style="flex:0"></label>';
    if (m === "ai") body += selH("vz.model", "Modelo", "arrow-1.1", [["arrow-1.1", "arrow-1.1 (1 crédito)"], ["arrow-2", "arrow-2 (por tokens)"], ["arrow-2-telos", "arrow-2-telos (mayor fidelidad)"]])
      + '<div class="ed-note" style="grid-column:1/-1">Para ilustraciones densas donde el modo Normal se ve duro. Antes de cobrar te muestro el costo. Usa tu llave de Quiver (Configuración › Integraciones).</div>';
    body += '<div class="ed-row">' + btn("vzrun", m === "ai" ? "Ver costo y vectorizar" : "Vectorizar") + "</div>";
    return '<details class="ed-sec mr-sec" data-mr-vz' + (VZ.open || VZ.picking || m !== "trace" ? " open" : "") + '><summary>Vectorizar</summary><div class="ed-sb">' + body + "</div></details>";
  }
  /* picar un color: clic sobre la imagen mientras está activo */
  document.addEventListener("pointerdown", function (e) {
    if (!VZ.picking) return; var c = cur(), o = c && c.o; if (!o || !o._n || !nodeUrl(o)) return;
    var r = o._n.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    e.preventDefault(); e.stopImmediatePropagation();
    pixels(nodeUrl(o), 600).then(function (P) {
      var x = Math.min(P.w - 1, Math.floor((e.clientX - r.left) / r.width * P.w)), y = Math.min(P.h - 1, Math.floor((e.clientY - r.top) / r.height * P.h)), i = (y * P.w + x) * 4;
      var hx = "#" + [P.d[i], P.d[i + 1], P.d[i + 2]].map(function (v) { return v.toString(16).padStart(2, "0"); }).join("");
      if (VZ.colors.indexOf(hx) < 0) VZ.colors.push(hx);
      say("Color " + hx + " agregado"); edProps();
    });
  }, true);
  RB.replicaVectorize = TOOLS.vectorize;
  /* 2 · OCR */
  TOOLS.ocr = function (ascii) {
    var c = cur(), o = c && c.o, url = nodeUrl(o); if (!url) return say("Elige la imagen de referencia");
    return serverOp(ascii ? "Leer ASCII" : "Extraer textos", "image_extract_text_layers", { templateId: ED.doc._id, frameId: frameId(c.f), layerId: layerIdOf(o), imageUrl: url, ascii: !!ascii }, function (r) {
      var bl = r.blocks || [];
      say(bl.length + " textos creados como capas reales" + (bl.length ? " · confianza media " + Math.round(bl.reduce(function (s, b) { return s + b.confidence; }, 0) / bl.length * 100) + " %" : ""));
      reopenSelect(bl[0] && bl[0].layerId);
      if (bl.length) RB.dialog({ title: "Textos encontrados", action: "mr-ocr", ok: "Listo", cancel: false, message: bl.slice(0, 30).map(function (b) { return "• " + b.text.replace(/\s+/g, " ").slice(0, 50) + " — " + b.font + " " + Math.round(b.size) + " px · " + Math.round(b.confidence * 100) + " %"; }).join("\n") });
    }).catch(function () {});
  };
  /* referencia → capas: sube la imagen como capa (bloqueada, 35 %) y le pasa el OCR */
  TOOLS.reference = function () {
    var c = cur(); if (!c) return say("Elige un frame");
    RB.pickFileVisible("image/*", "Imagen de referencia").then(function (file) {
      if (!file) return;
      var fr = new FileReader(); fr.onload = function () {
        (RB.uploadData ? RB.uploadData(fr.result, file.name) : Promise.reject(new Error("sin subida"))).then(function (u) {
          snap();
          var im = new Image(); im.onload = function () {
            var f = c.f, s = Math.min(f.w / im.naturalWidth, f.h / im.naturalHeight), w = Math.round(im.naturalWidth * s), h = Math.round(im.naturalHeight * s), b = { x: Math.round((f.w - w) / 2), y: Math.round((f.h - h) / 2), w: w, h: h };
            var L = addLayer(f, '<img src="' + esc(u) + '" alt="" style="' + absCss(b) + ';object-fit:contain;opacity:.35">', "Referencia · " + file.name.replace(/\.[^.]+$/, ""), "image", null, b);
            L.n.setAttribute("data-locked", "true");
            focusLayer(c.fi, L.at); setTimeout(function () { TOOLS.ocr(false); }, 300);
          }; im.src = u;
        }).catch(function (e) { say("No se pudo subir: " + (e && e.message || e)); });
      }; fr.readAsDataURL(file);
    });
  };
  /* 3 · Separar sujeto y fondo */
  TOOLS.split = function () {
    var c = cur(), o = c && c.o; if (!nodeUrl(o)) return say("Elige una foto");
    return serverOp("Separar sujeto y fondo (≈30 s)", "layer_split_subject", { templateId: ED.doc._id, frameId: frameId(c.f), layerId: layerIdOf(o) }, function (r) {
      say("Listo: «sujeto» (PNG transparente) y «fondo» encima de la original, que quedó intacta"); reopenSelect(r.subjectLayerId);
    }).catch(function () {});
  };
  /* 4 · ASCII */
  function addAscii(c, text, b, color, font, name) {
    var lines = text.split("\n"), cols = Math.max.apply(null, lines.map(function (l) { return l.length; }).concat([1]));
    var fs = b && b.w ? b.w / (cols * 0.6) : 14; font = font || "Space Mono"; useFont(c.f, font); snap();
    var html = '<pre style="position:absolute;left:' + r2(b ? b.x : 40) + "px;top:" + r2(b ? b.y : 40) + "px;margin:0;padding:0;font-family:'" + font + "',monospace;font-size:" + r2(fs) + "px;line-height:1;letter-spacing:0;white-space:pre;font-variant-ligatures:none;color:" + esc(color || "#111111") + '">' + esc(text) + "</pre>";
    var L = addLayer(c.f, html, name || "ASCII", "text", c.o && c.o._n, b);
    L.n.setAttribute("data-mr-ascii", "1"); return L;
  }
  TOOLS.asciiFromImage = function () {
    var c = cur(), o = c && c.o, url = nodeUrl(o); if (!url) return say("Elige una imagen");
    return RB.dialog({ title: "Imagen a ASCII", action: "mr-ascii", ok: "Convertir", message: "Crea una capa de TEXTO monoespaciado (Space Mono) con el dibujo hecho de caracteres: editable carácter por carácter.",
      fields: [{ name: "cols", label: "Columnas", type: "number", value: 90 }, { name: "ramp", label: "Caracteres (de claro a oscuro)", value: " .:-=+*#%@" }, { name: "color", label: "Color del texto", value: "#ff5e00" },
        { name: "inv", label: "Invertir (texto oscuro sobre fondo claro)", type: "checkbox", value: false }, { name: "hide", label: "Ocultar la imagen original", type: "checkbox", value: true }] })
      .then(function (v) {
        if (!v) return;
        return pixels(url, 900).then(function (P) {
          var txt = asciiFrom(P, numv(v.cols, 90), v.ramp || " .:-=+*#%@", !v.inv);
          var L = addAscii(c, txt, boxOf(o), v.color, "Space Mono", "ASCII · " + (o.name || "imagen"));
          if (v.hide) o.hidden = true;
          focusLayer(c.fi, L.at); say("ASCII creado como texto real (" + txt.split("\n").length + " filas)");
        });
      }).catch(function (e) { say("ASCII: " + (e && e.message || e)); });
  };
  TOOLS.asciiPaste = function () {
    var c = cur(); if (!c) return say("Elige un frame");
    return RB.dialog({ title: "Pegar ASCII como texto", action: "mr-ascii-paste", ok: "Crear", wide: true, message: "Se respetan espacios y saltos de línea; line-height 1 y tracking 0 atados a la grilla.",
      fields: [{ name: "t", label: "Texto ASCII", type: "textarea", rows: 12, required: true }, { name: "font", label: "Fuente monoespaciada", value: "Space Mono" }, { name: "size", label: "Tamaño (px)", type: "number", value: 14 }, { name: "color", label: "Color", value: "#111111" }] })
      .then(function (v) {
        if (!v || !v.t) return;
        var txt = String(v.t).replace(/\r\n?/g, "\n"), cols = Math.max.apply(null, txt.split("\n").map(function (l) { return l.length; }));
        var L = addAscii({ f: c.f, o: null }, txt, { x: 40, y: 40, w: numv(v.size, 14) * 0.6 * cols }, v.color, v.font || "Space Mono", "ASCII");
        focusLayer(c.fi, L.at);
      });
  };
  /* 5 · Halftone */
  function applyHalftone(c, o, opts, existing) {
    var srcNode = existing ? null : o._n, fx = existing ? fxOf(existing._n) : null;
    var url = fx ? fx.src : nodeUrl(o); if (!url) return Promise.reject(new Error("sin imagen"));
    var b = fx ? boxOf(existing) : boxOf(o);
    return pixels(url, 1000).then(function (P) {
      var o2 = Object.assign({ cell: 10, angle: 45, shape: "circle", color: "#111111", background: "", threshold: 0 }, fx || {}, opts || {});
      var svg = halftoneSvg(P, b, o2), meta = JSON.stringify({ t: "halftone", orig: fx ? fx.orig : srcNode.getAttribute("data-layer-id"), src: url, cell: o2.cell, angle: o2.angle, shape: o2.shape, color: o2.color, background: o2.background, threshold: o2.threshold });
      if (existing) { existing._n.innerHTML = svg; existing._n.setAttribute("data-mr-fx", meta); edRender(); return existing; }
      snap();
      var L = addLayer(c.f, '<div style="' + absCss(b) + '">' + svg + "</div>", "Halftone · " + (o.name || "imagen"), "svg", srcNode, b);
      L.n.setAttribute("data-mr-fx", meta); o.hidden = true;
      focusLayer(c.fi, L.at); return L.e;
    });
  }
  TOOLS.halftone = function () { var c = cur(), o = c && c.o; if (!nodeUrl(o)) return say("Elige una imagen"); applyHalftone(c, o, {}).then(function () { say("Halftone aplicado: ajusta celda, ángulo y forma en Props"); }, function (e) { say("Halftone: " + e.message); }); };
  /* 8 · Borrar zona */
  var ZONE = null;
  function drawZone() {
    var z = document.querySelector(".mr-zone"); var c = cur(), o = c && c.o;
    if (!ZONE || !o || !o._n || ZONE.id !== layerIdOf(o)) { if (z) z.remove(); return; }
    var r = o._n.getBoundingClientRect(); if (!z) { z = document.createElement("div"); z.className = "mr-zone"; document.body.appendChild(z); }
    z.style.left = r.left + r.width * ZONE.x + "px"; z.style.top = r.top + r.height * ZONE.y + "px"; z.style.width = r.width * ZONE.w + "px"; z.style.height = r.height * ZONE.h + "px";
  }
  TOOLS.inpaint = function () {
    var c = cur(), o = c && c.o, url = nodeUrl(o); if (!url || !ZONE) return say("Marca la zona primero");
    var z = ZONE;
    pixels(url, 1600).then(function (P) {
      var cv = document.createElement("canvas"); cv.width = P.w; cv.height = P.h; var g = cv.getContext("2d"); g.drawImage(P.c, 0, 0);
      g.strokeStyle = "#ff00ff"; g.lineWidth = Math.max(4, P.w / 160); g.strokeRect(z.x * P.w, z.y * P.h, z.w * P.w, z.h * P.h);
      return serverOp("Borrar zona (≈20 s)", "image_inpaint_region", { templateId: ED.doc._id, frameId: frameId(c.f), layerId: layerIdOf(o), region: { x: z.x, y: z.y, w: z.w, h: z.h }, markedImageBase64: cv.toDataURL("image/jpeg", 0.92) }, function () {
        ZONE = null; drawZone(); say("Zona borrada · «Deshacer borrado» devuelve la foto original"); reopenSelect(layerIdOf(o));
      });
    }).catch(function (e) { say("Borrar zona: " + (e && e.message || e)); });
  };
  TOOLS.inpaintUndo = function () {
    var c = cur(), o = c && c.o; if (!o || !o._n.getAttribute("data-orig-src")) return;
    serverOp("Deshacer borrado", "image_inpaint_region", { templateId: ED.doc._id, frameId: frameId(c.f), layerId: layerIdOf(o), restore: true }, function () { reopenSelect(layerIdOf(o)); say("Foto original de vuelta"); }).catch(function () {});
  };
  /* 6 · SVG como capas */
  TOOLS.svgImport = function () {
    var c = cur(); if (!c) return say("Elige un frame");
    RB.pickFileVisible(".svg,image/svg+xml", "SVG a importar como capas").then(function (file) {
      if (!file) return;
      file.text().then(function (txt) {
        var clean = cleanSvg(txt); if (!clean) return say("No es un SVG válido");
        var z = svgSize(clean), w = Math.min(c.f.w * 0.8, z[0] < 64 ? 400 : z[0]), h = w * z[1] / z[0], b = { x: Math.round((c.f.w - w) / 2), y: Math.round((c.f.h - h) / 2), w: Math.round(w), h: Math.round(h) };
        var parts = svgParts(clean), name = file.name.replace(/\.svg$/i, ""), last = null; snap();
        parts.forEach(function (p, i) { last = addLayer(c.f, '<div style="' + absCss(b) + '">' + fitSvg(p) + "</div>", parts.length > 1 ? name + " · " + (i + 1) : name, "svg", null, b); });
        focusLayer(c.fi, last.at); say(parts.length + (parts.length === 1 ? " capa vectorial" : " capas vectoriales") + ": cada una se recolorea en Props");
      });
    });
  };
  /* 10 · Emoji como vector */
  function emojiLayer(c, emoji, b, color) {
    return fetch(twemojiUrl(emoji)).then(function (r) { if (!r.ok) throw new Error("no encontré ese emoji como vector"); return r.text(); }).then(function (svg) {
      svg = cleanSvg(svg); if (color) svg = svg.replace(/fill="#[0-9a-fA-F]{3,8}"/g, 'fill="' + color + '"');
      snap(); var L = addLayer(c.f, '<div style="' + absCss(b) + '">' + fitSvg(svg) + "</div>", "Emoji " + emoji, "svg", c.o && c.o._n, b);
      return L;
    });
  }
  TOOLS.emoji = function () {
    var c = cur(); if (!c) return say("Elige un frame");
    RB.dialog({ title: "Emoji como vector", action: "mr-emoji", ok: "Insertar", message: "Twemoji (CC-BY 4.0) como capa vectorial: cambias el color de cada forma en Props.", fields: [{ name: "e", label: "Emoji", value: "🔥", required: true }, { name: "s", label: "Tamaño (px)", type: "number", value: 200 }] })
      .then(function (v) { if (!v || !v.e) return; var s = numv(v.s, 200); return emojiLayer(c, v.e, { x: Math.round((c.f.w - s) / 2), y: Math.round((c.f.h - s) / 2), w: s, h: s }).then(function (L) { focusLayer(c.fi, L.at); say("Emoji vectorial agregado"); }); })
      .catch(function (e) { say("Emoji: " + (e && e.message || e)); });
  };
  TOOLS.emojiFromText = function () {
    var c = cur(), o = c && c.o; if (!o) return;
    var t = (o._n.textContent || "").trim(), b = boxOf(o), s = Math.max(b.h, numv(getComputedStyle(o._n).fontSize, 48));
    emojiLayer(c, t, { x: b.x, y: b.y, w: s, h: s }).then(function (L) { o.hidden = true; focusLayer(c.fi, L.at); say("El emoji ahora es vector (el texto quedó oculto)"); }, function (e) { say("Emoji: " + e.message); });
  };
  /* informe */
  TOOLS.report = function () {
    if (!edOn()) return;
    var payload = RB._ed && RB._ed.payload(); var r = reportOf(payload ? payload.frames : []);
    RB.dialog({ title: "Editable vs raster", action: "mr-report", ok: "Listo", cancel: false, body: reportHtml(r) });
  };

  /* ═════════════ Props ═════════════ */
  var SHAPES = [["none", "Sin máscara"], ["circle", "Círculo"], ["ellipse", "Elipse"], ["rounded", "Rectángulo redondeado"], ["diamond", "Rombo"], ["triangle", "Triángulo"], ["hexagon", "Hexágono"], ["star", "Estrella"]];
  function selH(k, l, v, opts) { return '<label class="ef full"><span>' + l + '</span><select data-mr="' + k + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (String(o[0]) === String(v) ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>"; }
  function numH(k, l, v, st, full) { return '<label class="ef' + (full ? " full" : "") + '"><span>' + l + '</span><input type="number" step="' + (st || 1) + '" data-mr="' + k + '" value="' + r2(v) + '"></label>'; }
  function colH(k, l, v) { return '<label class="ef"><span>' + l + '</span><input type="color" data-mr="' + k + '" value="' + (/^#[0-9a-f]{6}$/i.test(v || "") ? v : "#111111") + '"></label>'; }
  function btn(a, l) { return '<button data-mra="' + a + '">' + l + "</button>"; }
  function sec(t, body, open) { return '<details class="ed-sec mr-sec"' + (open ? " open" : "") + "><summary>" + t + '</summary><div class="ed-sb">' + body + "</div></details>"; }
  function isEmojiOnly(t) { t = String(t || "").trim(); return !!t && t.length <= 16 && /\p{Extended_Pictographic}/u.test(t) && !/[\p{L}\p{N}]/u.test(t.replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "")); }
  function propsHtml() {
    var c = cur(); if (!c) return "";
    var o = c.o, h = "";
    if (!o) {
      return sec("Réplica editable", '<div class="ed-note" style="grid-column:1/-1">Herramientas para pasar una referencia a capas nativas.</div><div class="ed-row">'
        + btn("reference", "Referencia → capas (OCR)") + btn("svgimp", "SVG → capas") + btn("asciipaste", "Pegar ASCII") + btn("emoji", "Emoji vectorial") + btn("report", "Informe editable/raster") + "</div>", true);
    }
    var n = o._n, fx = fxOf(n), tp = tpOf(n), url = nodeUrl(o), isText = o.type === "text" && !tp && !n.getAttribute("data-mr-ascii");
    var svgLayer = n.tagName.toLowerCase() === "svg" || (n.children.length === 1 && n.firstElementChild.tagName.toLowerCase() === "svg");
    if (fx && fx.t === "halftone") {
      h += sec("Halftone (no destructivo)", numH("ht.cell", "Celda (px)", fx.cell, 1) + numH("ht.angle", "Ángulo°", fx.angle, 5) + selH("ht.shape", "Forma", fx.shape, [["circle", "Puntos"], ["square", "Cuadros"], ["line", "Líneas"]])
        + colH("ht.color", "Color", fx.color) + numH("ht.threshold", "Umbral %", fx.threshold || 0, 5) + '<label class="ef"><span>Fondo</span><input data-mr="ht.background" value="' + esc(fx.background || "") + '" placeholder="transparente"></label>'
        + '<div class="ed-row">' + btn("htoff", "Quitar efecto (vuelve la imagen)") + "</div>", true);
    } else if (url) {
      h += vzSection(o);
      h += sec("Réplica editable · imagen", '<div class="ed-row">' + btn("ocr", "Extraer textos (OCR)") + btn("split", "Separar sujeto y fondo") + btn("ascii", "Convertir a ASCII…") + btn("asciiocr", "Leer ASCII (OCR)") + btn("halftone", "Halftone") + "</div>"
        + '<div class="ed-note" style="grid-column:1/-1"><b>Borrar zona</b> (texto o logo horneado): marca la zona en % de la imagen; se verá en el lienzo.</div>'
        + numH("z.x", "X %", ZONE ? ZONE.x * 100 : 10, 1) + numH("z.y", "Y %", ZONE ? ZONE.y * 100 : 10, 1) + numH("z.w", "Ancho %", ZONE ? ZONE.w * 100 : 30, 1) + numH("z.h", "Alto %", ZONE ? ZONE.h * 100 : 15, 1)
        + '<div class="ed-row">' + btn("zone", ZONE && ZONE.id === layerIdOf(o) ? "Ocultar zona" : "Marcar zona") + btn("inpaint", "Borrar zona") + (n.getAttribute("data-orig-src") ? btn("inpaintundo", "Deshacer borrado") : "") + "</div>", true);
    }
    if (tp) {
      h += sec("Texto en trayectoria", '<label class="ef full"><span>Texto</span><textarea rows="2" data-mr="tp.text">' + esc(tp.text) + "</textarea></label>"
        + selH("tp.mode", "Forma", tp.mode, [["arc", "Arco"], ["circle", "Círculo"], ["wave", "Onda"]]) + numH("tp.curve", "Curvatura", tp.curve, 5) + numH("tp.size", "Tamaño (px)", tp.size, 1)
        + '<label class="ef full"><span>Fuente</span><input data-mr="tp.font" value="' + esc(tp.font) + '"></label>' + colH("tp.color", "Color", tp.color) + numH("tp.ls", "Interletraje", tp.ls || 0, 0.5)
        + '<div class="ed-row">' + btn("tpoff", "Volver a texto normal") + "</div>", true);
    } else if (isText) {
      var dir = n.getAttribute("data-mr-dir") || "horizontal";
      h += sec("Dirección y trayectoria", selH("dir", "Dirección", dir, [["horizontal", "Horizontal"], ["vertical", "Vertical (letras apiladas)"], ["vertical-down", "Vertical, girado (lee hacia abajo)"], ["vertical-up", "Vertical, girado (lee hacia arriba)"]])
        + selH("tpnew", "Texto en trayectoria", "", [["", "—"], ["arc", "Arco"], ["circle", "Círculo"], ["wave", "Onda"]])
        + (isEmojiOnly(n.textContent) ? '<div class="ed-row">' + btn("emojitext", "Emoji a vector (recoloreable)") + "</div>" : ""), true);
    }
    if (svgLayer && !(fx && fx.t === "halftone") && !tp) {
      var tex = (n.querySelector("g[data-mr-tex]") || {}).getAttribute ? n.querySelector("g[data-mr-tex]").getAttribute("data-mr-tex") : "none";
      h += sec("Textura", selH("tex", "Textura", tex, [["none", "Ninguna"], ["grain", "Grano"], ["paper", "Papel"], ["crayon", "Crayón"], ["noise", "Ruido"]]) + numH("texk", "Intensidad %", n.getAttribute("data-mr-texk") || 60, 5, true)
        + '<div class="ed-note" style="grid-column:1/-1">Es un filtro vectorial: recolorear las formas no la pierde y exporta nítido.</div>', tex !== "none");
    } else if (!tp && o.type !== "text") {
      var tl = (ED.doc.frames[c.fi].els || []).find(function (x) { var f2 = x._n && fxOf(x._n); return f2 && f2.t === "texture" && f2.target === layerIdOf(o); });
      var tf = tl ? fxOf(tl._n) : null;
      h += sec("Textura", selH("tex", "Textura", tf ? tf.texture : "none", [["none", "Ninguna"], ["grain", "Grano"], ["paper", "Papel"], ["crayon", "Crayón"], ["noise", "Ruido"]]) + numH("texk", "Intensidad %", tf ? tf.amount : 60, 5, true), !!tf);
    }
    var mk = (function () { try { return JSON.parse(n.getAttribute("data-mr-mask") || "null"); } catch (e) { return null; } })() || { shape: "none", size: 100, cx: 50, cy: 50, radius: 12 };
    h += sec("Máscara", selH("mk.shape", "Forma", mk.shape, SHAPES) + numH("mk.size", "Tamaño %", mk.size, 1) + numH("mk.radius", "Redondeo %", mk.radius, 1) + numH("mk.cx", "Centro X %", mk.cx, 1) + numH("mk.cy", "Centro Y %", mk.cy, 1)
      + '<div class="ed-note" style="grid-column:1/-1">Se guarda en la capa y sobrevive reabrir y exportar.</div>', mk.shape !== "none");
    return h;
  }
  var _props = edProps;
  edProps = function () {
    var r = _props.apply(this, arguments);
    try {
      var box = eq("#edProps"); if (!box || ED.panel !== "props" || !edOn()) return r;
      var h = propsHtml(); if (!h) return r;
      var ph = box.querySelector(".ed-ph"); if (ph) ph.insertAdjacentHTML("afterend", h); else box.insertAdjacentHTML("afterbegin", h);
    } catch (e) { console.warn("[replica] props", e); }
    drawZone();
    return r;
  };
  var props = eq("#edProps");
  props.addEventListener("focusin", function (e) { if (e.target.dataset && e.target.dataset.mr) snap(); });
  var htT = null;
  props.addEventListener("input", function (e) {
    var k = e.target.dataset && e.target.dataset.mr; if (!k) return;
    var c = cur(), o = c && c.o; if (!o) return;
    var v = e.target.value, n = o._n;
    if (k.indexOf("mk.") === 0) {
      var mk = {}; ["shape", "size", "radius", "cx", "cy"].forEach(function (q) { var el = props.querySelector('[data-mr="mk.' + q + '"]'); mk[q] = el ? (q === "shape" ? el.value : numv(el.value, 0)) : null; });
      var cp = maskCss(mk.shape, mk.size, mk.cx, mk.cy, mk.radius);
      n.style.clipPath = cp || ""; n.style.webkitClipPath = cp || "";
      if (cp) n.setAttribute("data-mr-mask", JSON.stringify(mk)); else n.removeAttribute("data-mr-mask");
      if (n.tagName === "IMG" && cp) n.style.objectFit = n.style.objectFit || "cover";
      edRender(); return;
    }
    if (k.indexOf("z.") === 0) { ZONE = ZONE || { id: layerIdOf(o), x: 0.1, y: 0.1, w: 0.3, h: 0.15 }; ZONE[k.slice(2)] = cl(numv(v, 0), 0, 100) / 100; ZONE.id = layerIdOf(o); drawZone(); return; }
    if (k.indexOf("ht.") === 0) { var p = {}; p[k.slice(3)] = /cell|angle|threshold/.test(k) ? numv(v, 0) : v; clearTimeout(htT); htT = setTimeout(function () { applyHalftone(c, null, p, o).catch(function (x) { say("Halftone: " + x.message); }); }, 150); return; }
    if (k.indexOf("tp.") === 0) {
      var cfg = tpOf(n) || {}; cfg[k.slice(3)] = /curve|size|ls/.test(k) ? numv(v, 0) : v;
      if (k === "tp.font") useFont(c.f, v);
      n.setAttribute("data-mr-tp", JSON.stringify(cfg)); n.innerHTML = textPathSvg(cfg, o.w, o.h); edRender(); return;
    }
    if (k === "texk" || k === "tex") return applyTexture(c, o);
  });
  props.addEventListener("change", function (e) {
    var k = e.target.dataset && e.target.dataset.mr; if (!k) return;
    var c = cur(), o = c && c.o; if (!o) return; var n = o._n, v = e.target.value;
    if (k === "vz.mode") { VZ.mode = v; VZ.open = true; edProps(); return; }
    if (k === "dir") { snap(); setDir(n, v); edRender(); edProps(); return; }
    if (k === "tpnew" && v) { snap(); toTextPath(c, o, v); return; }
    if (k === "tp.mode") { edProps(); return; }
    if (k === "mk.shape") edProps();
  });
  props.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-mra]"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var a = b.dataset.mra, c = cur(), o = c && c.o;
    var map = { vectorize: TOOLS.vectorize, ocr: function () { TOOLS.ocr(false); }, asciiocr: function () { TOOLS.ocr(true); }, split: TOOLS.split, ascii: TOOLS.asciiFromImage, halftone: TOOLS.halftone, inpaint: TOOLS.inpaint, inpaintundo: TOOLS.inpaintUndo,
      reference: TOOLS.reference, svgimp: TOOLS.svgImport, asciipaste: TOOLS.asciiPaste, emoji: TOOLS.emoji, emojitext: TOOLS.emojiFromText, report: TOOLS.report };
    if (map[a]) return map[a]();
    if (a === "vzrun") return TOOLS.vectorizeRun();
    if (a === "vzpick") { VZ.picking = !VZ.picking; VZ.open = true; edProps(); return say(VZ.picking ? "Haz clic sobre la imagen para picar cada color" : "Listo"); }
    if (a === "vzclear") { VZ.colors = []; edProps(); return; }
    if (a === "vzdel") { VZ.colors.splice(+b.dataset.i, 1); edProps(); return; }
    if (a === "zone") { if (ZONE && ZONE.id === layerIdOf(o)) ZONE = null; else { var g = function (q, d) { var el = props.querySelector('[data-mr="z.' + q + '"]'); return el ? cl(numv(el.value, d), 0, 100) / 100 : d / 100; }; ZONE = { id: layerIdOf(o), x: g("x", 10), y: g("y", 10), w: g("w", 30), h: g("h", 15) }; } drawZone(); edProps(); return; }
    if (a === "htoff" && o) { var fx = fxOf(o._n); snap(); var orig = fx && ED.doc.frames[c.fi].els.find(function (x) { return x._n && x._n.getAttribute("data-layer-id") === fx.orig; }); o._n.remove(); ED.doc.frames[c.fi].els.splice(c.ei, 1); if (orig) orig.hidden = false; ED.sel = { f: c.fi, e: orig ? ED.doc.frames[c.fi].els.indexOf(orig) : null }; edRender(); edLayers(); edProps(); return say("Halftone quitado: la imagen original volvió"); }
    if (a === "tpoff" && o) { snap(); fromTextPath(c, o); return; }
  }, true);
  window.addEventListener("resize", drawZone); document.addEventListener("scroll", drawZone, true);
  setInterval(function () { if (ZONE) drawZone(); }, 400);

  /* 9 · textura */
  function applyTexture(c, o) {
    var n = o._n, tex = (props.querySelector('[data-mr="tex"]') || {}).value || "none", k = cl(numv((props.querySelector('[data-mr="texk"]') || {}).value, 60), 0, 100) / 100;
    var svg = n.tagName.toLowerCase() === "svg" ? n : n.children.length === 1 && n.firstElementChild.tagName.toLowerCase() === "svg" ? n.firstElementChild : null;
    var fid = "mrtex_" + (layerIdOf(o) || "x").replace(/[^\w-]/g, "");
    if (svg) {
      var old = svg.querySelector("filter#" + fid); if (old) { var dd = old.parentNode; old.remove(); if (dd && dd.tagName.toLowerCase() === "defs" && !dd.children.length) dd.remove(); }
      var g = svg.querySelector(":scope > g[data-mr-tex]"); if (g) { while (g.firstChild) svg.insertBefore(g.firstChild, g); g.remove(); }
      if (tex !== "none") {
        var ng = document.createElementNS("http://www.w3.org/2000/svg", "g"); ng.setAttribute("data-mr-tex", tex); ng.setAttribute("filter", "url(#" + fid + ")");
        while (svg.firstChild) ng.appendChild(svg.firstChild); svg.appendChild(ng);
        var defs = document.createElementNS("http://www.w3.org/2000/svg", "defs"); defs.innerHTML = TEXTURES[tex](Math.max(0.05, k), fid); svg.insertBefore(defs, ng);
      }
      n.setAttribute("data-mr-texk", Math.round(k * 100)); edRender(); return;
    }
    var f = ED.doc.frames[c.fi], idx = f.els.findIndex(function (x) { var q = x._n && fxOf(x._n); return q && q.t === "texture" && q.target === layerIdOf(o); });
    if (idx >= 0) { f.els[idx]._n.remove(); f.els.splice(idx, 1); }
    if (tex !== "none") {
      var b = boxOf(o), L = addLayer(f, '<div style="' + absCss(b) + ';pointer-events:none;mix-blend-mode:multiply"><svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><defs>' + TEXTURES[tex](Math.max(0.05, k), fid) + '</defs><rect width="100%" height="100%" fill="#ffffff" filter="url(#' + fid + ')"/></svg></div>', "Textura · " + tex, "svg", o._n, b);
      L.n.setAttribute("data-mr-fx", JSON.stringify({ t: "texture", target: layerIdOf(o), texture: tex, amount: Math.round(k * 100) }));
    }
    edRender(); edLayers();
  }
  /* 11 · dirección y trayectoria */
  function setDir(n, v) {
    n.style.writingMode = v === "horizontal" ? "" : "vertical-rl";
    n.style.textOrientation = v === "vertical" ? "upright" : v === "horizontal" ? "" : "mixed";
    n.style.rotate = v === "vertical-up" ? "180deg" : (n.getAttribute("data-mr-dir") === "vertical-up" ? "" : n.style.rotate);
    if (v === "horizontal") n.removeAttribute("data-mr-dir"); else n.setAttribute("data-mr-dir", v);
    n.style.width = ""; n.style.height = "";
  }
  function toTextPath(c, o, mode) {
    var n = o._n, s = getComputedStyle(n), text = (n.innerText || n.textContent || "").trim(), size = parseFloat(s.fontSize) || 48;
    var cfg = { text: text, mode: mode, curve: 50, font: (s.fontFamily || "Inter").split(",")[0].replace(/['"]/g, "").trim(), size: size, color: (typeof hex === "function" ? hex(s.color) : s.color), weight: parseFloat(s.fontWeight) || 700, ls: parseFloat(s.letterSpacing) || 0, pid: lid("tp") };
    var w = Math.max(o.w, size * Math.max(4, text.length) * 0.62), h = mode === "circle" ? w : Math.max(o.h, size * 3), b = { x: o.x, y: o.y, w: w, h: h };
    var L = addLayer(c.f, '<div style="' + absCss(b) + '">' + textPathSvg(cfg, w, h) + "</div>", o.name || "Texto en trayectoria", "svg", n, b);
    L.n.setAttribute("data-mr-tp", JSON.stringify(cfg)); L.n.setAttribute("data-mr-from", layerIdOf(o) || "");
    n.remove(); c.f.els.splice(c.f.els.indexOf(o), 1);
    focusLayer(c.fi, c.f.els.indexOf(L.e)); say("Texto en trayectoria: el contenido, la fuente y el tamaño se editan en Props");
  }
  function fromTextPath(c, o) {
    var cfg = tpOf(o._n) || {}, b = boxOf(o);
    var L = addLayer(c.f, "<div style=\"position:absolute;left:" + b.x + "px;top:" + b.y + "px;margin:0;font-family:'" + esc(cfg.font) + "',sans-serif;font-size:" + cfg.size + "px;font-weight:" + cfg.weight + ";color:" + esc(cfg.color) + ";letter-spacing:" + (cfg.ls || 0) + "px;white-space:pre-wrap\">" + esc(cfg.text) + "</div>", o.name || "Texto", "text", o._n, { x: b.x, y: b.y });
    o._n.remove(); c.f.els.splice(c.f.els.indexOf(o), 1);
    focusLayer(c.fi, c.f.els.indexOf(L.e));
  }

  /* ═════════════ exportación: lo que html2canvas no dibuja ═════════════ */
  function fontOf(cs) { return (cs.fontStyle === "italic" ? "italic " : "") + (cs.fontWeight || 400) + " " + cs.fontSize + " " + cs.fontFamily; }
  function toImg(n, cv, w, h) { var im = document.createElement("img"); im.src = cv.toDataURL("image/png"); im.style.cssText = "display:block;width:" + w + "px;height:" + h + "px"; n.innerHTML = ""; n.appendChild(im); n.style.writingMode = "horizontal-tb"; n.style.textOrientation = ""; }
  RB._preShot = function (inner, scale) {
    var k = Math.max(1, scale || 1) * 2;
    var jobs = [];
    [].forEach.call(inner.querySelectorAll("[data-mr-dir]"), function (n) {
      var cs = getComputedStyle(n), w = n.offsetWidth, h = n.offsetHeight; if (!w || !h) return;
      var mode = n.getAttribute("data-mr-dir"), fs = parseFloat(cs.fontSize) || 16, lh = (parseFloat(cs.lineHeight) || fs * 1.2), cv = document.createElement("canvas");
      cv.width = Math.ceil(w * k); cv.height = Math.ceil(h * k); var g = cv.getContext("2d"); g.scale(k, k); g.font = fontOf(cs); g.fillStyle = cs.color;
      var lines = (n.innerText || n.textContent || "").split("\n");
      if (mode === "vertical") {
        g.textAlign = "center"; g.textBaseline = "middle";
        lines.forEach(function (line, i) { var x = w - (i + 0.5) * lh; Array.from(line).forEach(function (ch, j) { g.fillText(ch, x, (j + 0.5) * fs * 1.05); }); });
      } else {
        g.translate(w, 0); g.rotate(Math.PI / 2); g.textBaseline = "alphabetic"; g.textAlign = "left";
        lines.forEach(function (line, i) { g.fillText(line, 0, (i + 0.78) * lh); });
      }
      toImg(n, cv, w, h);
    });
    [].forEach.call(inner.querySelectorAll("[data-mr-tp]"), function (n) {
      var svg = n.querySelector("svg"), path = svg && svg.querySelector("path"), cfg = tpOf(n); if (!path || !cfg) return;
      var w = n.offsetWidth, h = n.offsetHeight, vb = svg.viewBox.baseVal, sx = vb && vb.width ? w / vb.width : 1, sy = vb && vb.height ? h / vb.height : 1;
      var cv = document.createElement("canvas"); cv.width = Math.ceil(w * k); cv.height = Math.ceil(h * k); var g = cv.getContext("2d"); g.scale(k, k);
      g.font = (cfg.weight || 700) + " " + cfg.size * sy + "px '" + cfg.font + "', sans-serif"; g.fillStyle = cfg.color || "#111"; g.textBaseline = "alphabetic";
      var L = path.getTotalLength(), chars = Array.from(cfg.text || ""), ls = (cfg.ls || 0) * sx, widths = chars.map(function (c) { return g.measureText(c).width / sx; });
      var tot = widths.reduce(function (a, b) { return a + b; }, 0) + ls / sx * Math.max(0, chars.length - 1), pos = L / 2 - tot / 2;
      chars.forEach(function (ch, i) {
        var mid = pos + widths[i] / 2; if (mid < 0 || mid > L) { pos += widths[i] + ls / sx; return; }
        var p1 = path.getPointAtLength(Math.max(0, mid - 0.5)), p2 = path.getPointAtLength(Math.min(L, mid + 0.5)), pm = path.getPointAtLength(mid);
        g.save(); g.translate(pm.x * sx, pm.y * sy); g.rotate(Math.atan2((p2.y - p1.y) * sy, (p2.x - p1.x) * sx)); g.fillText(ch, -widths[i] * sx / 2, 0); g.restore();
        pos += widths[i] + ls / sx;
      });
      toImg(n, cv, w, h);
    });
    return Promise.all(jobs);
  };

  /* ═════════════ QA Instinct · lote 2 ═════════════ */
  /* #8 · exportar: si el navegador ya no deja descargar sola (la exportación tardó y se perdió el «clic»), queda un
     panel «Archivo listo» con un enlace de descarga real. Lo usan PNG, JPG, SVG y JSON del editor. */
  RB.fileReady = function (blob, name) {
    var url = URL.createObjectURL(blob), auto = !!(navigator.userActivation && navigator.userActivation.isActive);
    if (auto) { var a = document.createElement("a"); a.href = url; a.download = name; a.style.display = "none"; document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 1500); say(name + " descargado"); }
    else RB.dialog({ title: "Archivo listo", action: "file-ready", ok: "Cerrar", cancel: false,
      body: '<p class="msg"><b data-no-i18n>' + esc(name) + "</b> · " + (blob.size > 1048576 ? (blob.size / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(blob.size / 1024)) + " KB") + '</p><p class="msg">Tócalo para guardarlo en tu equipo.</p><p><a class="b-ok" data-file-ready href="' + url + '" download="' + esc(name) + '" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#ff5e00;color:#fff;font-weight:700;text-decoration:none">Descargar ' + esc((name.split(".").pop() || "").toUpperCase()) + "</a></p>" });
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 10 * 60 * 1000);
    return auto;
  };
  /* #10 · Ctrl+X no existía en el editor (copiar, pegar y duplicar sí) */
  function edKeys(e) {
    if (typeof ED === "undefined" || !ED.open || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    var t = e.target, typing = t && t.closest && t.closest("input,textarea,select,[contenteditable=true]");
    if (typing || String(e.key).toLowerCase() !== "x" || !ED.sel || ED.sel.e == null) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (typeof snap === "function") snap();
    act("copy"); act("delete"); say("Cortado: pégalo con Ctrl+V");
  }
  document.addEventListener("keydown", edKeys, true);
  /* las teclas que llegan a la página contenedora (un navegador automatizado o el foco fuera del lienzo) van al editor */
  try {
    var pdoc = window.parent && window.parent !== window ? window.parent.document : null;
    if (pdoc) pdoc.addEventListener("keydown", function (e) {
      if (typeof ED === "undefined" || !ED.open || e.__musaFwd) return;
      var t = e.target; if (t && t.closest && t.closest("input,textarea,select,[contenteditable=true]")) return;
      if (t && t.tagName === "IFRAME") return;
      var ev = new KeyboardEvent("keydown", { key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, repeat: e.repeat, bubbles: true, cancelable: true });
      ev.__musaFwd = true;
      (document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body).dispatchEvent(ev);
      if (ev.defaultPrevented) e.preventDefault();
    }, true);
  } catch (x) {}
  /* rotación: el campo se llamaba solo «°» */
  var _propsRot = edProps;
  edProps = function () {
    var r = _propsRot.apply(this, arguments);
    try { var i = eq('#edProps input[data-k="rot"]'), sp = i && i.closest("label") && i.closest("label").querySelector("span"); if (sp && sp.textContent.trim() === "°") { sp.textContent = "Rotación°"; i.setAttribute("aria-label", "Rotación en grados"); } } catch (e) {}
    return r;
  };
  /* #7 · eliminar el diseño abierto desde el editor (también hay un botón en cada tarjeta de Mis diseños) */
  if (typeof MENUS !== "undefined" && MENUS.editor) {
    var _mEd = MENUS.editor;
    MENUS.editor = function () {
      var it = _mEd.apply(this, arguments);
      if (!edOn()) return it;
      var doc = ED.doc;
      return it.concat(["-", { h: "Archivo" }, { l: "Eliminar este diseño…", d: "Va a la Papelera: lo restauras durante 30 días", fn: function () {
        if (!RB.delItems) return say("No pude eliminar ahora; inténtalo desde Mis diseños");
        RB.delItems([{ type: "design", id: doc._id, name: doc.name || "Diseño" }]);
        /* delItems no devuelve su promesa (confirma primero): se espera a que quede en la Papelera y se cierra el editor */
        var api = window.parent.__musaBridge && window.parent.__musaBridge.api, tries = 0;
        var iv = setInterval(function () {
          if (++tries > 40 || !api || ED.doc !== doc || !ED.open) return clearInterval(iv);
          if (!document.querySelector('[data-musa-dialog="eliminar"]') && tries > 3 && tries % 2) {
            api("/rest/v1/templates?id=eq." + encodeURIComponent(doc._id) + "&select=deleted_at").then(function (r) {
              if (r && r[0] && r[0].deleted_at && ED.doc === doc) { clearInterval(iv); if (RB.tpl) RB.tpl = RB.tpl.filter(function (t) { return t.id !== doc._id; }); edClose(); location.hash = "crear/disenos"; say("Diseño enviado a la Papelera"); }
              else if (tries > 12) clearInterval(iv);
            }, function () {});
          }
        }, 800);
      } }]);
    };
  }

  /* #5 · al volver a Mis diseños (cerrar el editor no siempre cambia el hash) se suma lo nuevo sin recargar */
  if (typeof go === "function") {
    var _goList = go, lastTop = 0;
    go = function () {
      var r = _goList.apply(this, arguments);
      try { if (RB.tplRefreshTop && /^#?crear\/disenos\/?$/.test(location.hash) && Date.now() - lastTop > 4000) { lastTop = Date.now(); setTimeout(RB.tplRefreshTop, 60); } } catch (e) {}
      return r;
    };
  }
})();
