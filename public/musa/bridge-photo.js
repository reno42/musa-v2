/* bridge-photo.js — el editor de fotos sobre el modelo único «Musa Photo Code» (photo-code-core.js / photo-code-lang.js).
 *
 *   fuente (imagen o CÓDIGO) → retoque → geometría → revelado → filtros → capas → salida
 *
 *  · Motor: el revelado y los filtros corren en JS puro (mismo resultado en Chrome, Safari y al exportar; antes el
 *    desenfoque dependía de `ctx.filter`, que Safari no tiene, y Enfoque/Claridad/Reducir ruido no hacían nada ahí).
 *  · Nada se pierde: capas (pintura, texto, imagen, forma), máscaras de pincel y filtros viajan con la foto
 *    (en la capa del diseño: data-photo; en Crear › Fotos: source_meta.doc). Los píxeles pintados se suben como archivo.
 *  · La fuente puede ser código (canvas, Three.js, p5, WebGL, shader, SVG, HTML/CSS, Python): corre aislado, se ve como
 *    foto y se revela, filtra y compone igual que una foto.
 *  · Persona y IA a la vez: el documento tiene revisión; lo que llega por MCP se mezcla a tres bandas con lo abierto.
 *
 * Este archivo es la base (motor, documento, capas, guardado, fuente de código, exportar, sincronía).
 * bridge-photo-code.js: panel de código, pegar/importar, pasos a diseño y video, biblioteca.
 * bridge-photo-tools.js: selecciones, retoque, filtros, capas, pluma y menús.
 */
(function boot(n) {
  "use strict";
  var RB = window.__musaReal, PC = window.MusaPhotoCode, ML = window.MusaVideoLive;
  var ok = RB && PC && PC.toCode && ML && typeof PH !== "undefined" && typeof phProcess === "function" && typeof phApply === "function" && /savePhoto/.test(String(phApply)) && RB.photoToVideo && window.__musaCode;
  if (!ok) { if ((n || 0) < 900) setTimeout(function () { boot((n || 0) + 1); }, 150); return; }
  if (window.__phx) return;
  var X = window.__phx = { by: {}, pool: {}, PC: PC, jobs: {}, pending: false, preRev: 0 };
  var clone = PC.clone, clamp = PC.clamp;
  var COARSE = false; try { COARSE = matchMedia("(pointer: coarse)").matches; } catch (e) { /* sin matchMedia */ }
  var LMAX = COARSE || (navigator.deviceMemory && navigator.deviceMemory <= 4) ? 1600 : 2400;

  function bridge() { try { return window.parent !== window && window.parent.__musaBridge; } catch (e) { return null; } }
  function api(path, init) { var b = bridge(); if (!b) return Promise.reject(new Error("sin conexión con Musa")); return b.api(path, init); }
  function jreq(method, body, ms) { return { method: method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), timeoutMs: ms || 90000 }; }
  function origin() { try { return window.parent.location.origin; } catch (e) { return location.origin; } }
  function errOf(e) { return (e && (e.message || e.error)) || String(e); }
  function say(m) { if (PH.open) phToast(m); else if (typeof toast === "function") toast(m); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function copyCv(c) { var o = phCanvas(c.width, c.height); o.getContext("2d").drawImage(c, 0, 0); return o; }
  function loadImg(url) { return new Promise(function (res, rej) { var im = new Image(); if (!/^(blob:|data:)/.test(url)) im.crossOrigin = "anonymous"; im.onload = function () { res(im); }; im.onerror = function () { rej(new Error("no se pudo leer " + String(url).slice(0, 80))); }; im.src = url; }); }
  function toCanvas(im, max) { var w = im.naturalWidth || im.width, h = im.naturalHeight || im.height, k = max ? Math.min(1, max / Math.max(w, h)) : 1, c = phCanvas(w * k, h * k); c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); return c; }
  function blobOf(cv, type, q) { return new Promise(function (res) { cv.toBlob(res, type || "image/png", q); }); }
  function dataOf(blob) { return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(blob); }); }
  function hasAlpha(cv) { try { var t = phCanvas(96, Math.max(1, Math.round(96 * cv.height / cv.width))), g = t.getContext("2d"); g.drawImage(cv, 0, 0, t.width, t.height); var d = g.getImageData(0, 0, t.width, t.height).data; for (var i = 3; i < d.length; i += 4) if (d[i] < 250) return true; } catch (e) { /* sin lectura */ } return false; }
  function isEmpty(cv) { try { var d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data; for (var i = 3; i < d.length; i += 4) if (d[i]) return false; return true; } catch (e) { return false; } }
  function pixSig(cv) { try { var d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data, h = 2166136261; for (var i = 0; i < d.length; i += 3) h = Math.imul(h ^ d[i], 16777619); return cv.width + "x" + cv.height + ":" + (h >>> 0).toString(36); } catch (e) { return "x" + Math.random(); } }
  /* sube un lienzo como archivo interno del espacio (no aparece en Fotos). Baja de tamaño si pasa de 4,6 MB. */
  function uploadCv(cv, name, o) {
    o = o || {};
    var type = o.type || "image/png", go = function (c, q) {
      return blobOf(c, type, q).then(function (b) {
        if (b.size > 4.6 * 1048576) { if (type !== "image/png" && q > 0.62) return go(c, q - 0.1); var s = phCanvas(c.width * 0.8, c.height * 0.8); s.getContext("2d").drawImage(c, 0, 0, s.width, s.height); return go(s, type === "image/png" ? undefined : 0.85); }
        return dataOf(b).then(function (data) { return api("/api/assets/upload", jreq("POST", { name: name, data: data, workspaceId: RB.ws, tags: o.tags || ["musa:sistema", "foto"], replaceAssetId: o.replace || undefined })); });
      });
    };
    return go(cv, type === "image/png" ? undefined : 0.92).then(function (x) { var a = x.data || x.asset || x, url = a.url || (a.asset && a.asset.url); if (!url) throw new Error("no se pudo subir " + name); return { url: url, id: a.assetId || a.id || (a.asset && a.asset.id) }; });
  }
  X.uploadCv = uploadCv; X.loadImg = loadImg; X.toCanvas = toCanvas; X.copyCv = copyCv; X.hasAlpha = hasAlpha; X.api = api; X.jreq = jreq; X.say = say; X.esc = esc; X.errOf = errOf; X.origin = origin;

  /* ═════════════ estado por foto ═════════════ */
  function st(key) { var k = key || PH.key || "_"; return X.by[k] || (X.by[k] = { filters: [], source: null, url: null, fmask: {}, rev: null, base: null, out: null }); }
  X.st = st;
  function lres() {
    if (!PH.src) return PH.base ? [PH.base.w, PH.base.h] : [1000, 1000];
    var o = PC.outSize(PH.src.width, PH.src.height, PH.r.geo), k = Math.min(1, LMAX / Math.max(o[0], o[1]));
    return [Math.max(1, Math.round(o[0] * k)), Math.max(1, Math.round(o[1] * k))];
  }
  X.lres = lres;
  function ensureRecipe() { if (PH.r && (PH.r.detail.dehaze === undefined || (PH.r.masks || []).some(function (m) { return !m.adj || m.adj.clarity === undefined; }))) { var same = JSON.stringify(PH.r) === PH.r0; PH.r = PC.normRecipe(PH.r); if (same) PH.r0 = JSON.stringify(PH.r); } }

  /* ═════════════ motor ═════════════ */
  phBlur = function (B, px) { return PC.gauss(B.d, B.w, B.h, px); };
  var _build = phBuild;
  phBuild = function (src, geo, max) {
    var B = _build(src, geo, max);
    if (src !== PH.src || !PH.r) return B;
    var pre = phLayers().filter(function (L) { return L.pre && L.vis && L.kind === "paint"; });
    if (!pre.length) return B;
    var x = B.cv.getContext("2d"), box = PC.reboxForCrop({ x: 0, y: 0, w: 1, h: 1 }, PH.r.geo.crop, geo.crop);
    x.setTransform(1, 0, 0, 1, 0, 0); x.imageSmoothingQuality = "high";
    pre.forEach(function (L) { x.globalAlpha = L.op / 100; x.globalCompositeOperation = L.blend === "normal" ? "source-over" : L.blend; x.drawImage(viewOf(L), box.x * B.w, box.y * B.h, box.w * B.w, box.h * B.h); });
    x.globalAlpha = 1; x.globalCompositeOperation = "source-over";
    B.d = x.getImageData(0, 0, B.w, B.h).data;
    return B;
  };
  function fitCv(c, w, h) { if (c.width === w && c.height === h) return c; var o = phCanvas(w, h); o.getContext("2d").drawImage(c, 0, 0, w, h); return o; }
  phEnsureBase = function () {
    var g = phGeo(), k = JSON.stringify(g) + "|" + X.preRev;
    if (PH.base && PH.bkey === k) return;
    var old = PH.base;
    PH.base = phBuild(PH.src, g, PH_WORK); PH.bkey = k; PH.bS = PH.bL = null;
    if (old && (old.w !== PH.base.w || old.h !== PH.base.h)) {
      Object.keys(PH.brushCv).forEach(function (id) { PH.brushCv[id] = fitCv(PH.brushCv[id], PH.base.w, PH.base.h); });
      var s = st(); Object.keys(s.fmask).forEach(function (id) { s.fmask[id] = fitCv(s.fmask[id], PH.base.w, PH.base.h); });
    }
    if (PH.mode !== "crop") { var sz = lres(); phLayers().forEach(function (L) { if (L.cv.width !== sz[0] || L.cv.height !== sz[1]) { L.cv = fitCv(L.cv, sz[0], sz[1]); if (L.mcv) L.mcv = fitCv(L.mcv, sz[0], sz[1]); L.dv = null; phLayerRender(L); } }); if (X.onResize && old && (old.w !== PH.base.w || old.h !== PH.base.h)) X.onResize(sz); }
    phView.width = PH.base.w; phView.height = PH.base.h;
    phMountLayers();
  };
  function maskData(cv, w, h) { var c = fitCv(cv, w, h); return c.getContext("2d").getImageData(0, 0, w, h).data; }
  phProcess = function (B, r, o) {
    o = Object.assign({}, o, { alpha: true });
    if (!o.bS || !o.bL) { var nd = PC.needs(r), sg = PC.sigmas(B.w); if (nd.S && !o.bS) o.bS = PC.gauss(B.d, B.w, B.h, sg.S); if (nd.L && !o.bL) o.bL = PC.gauss(B.d, B.w, B.h, sg.L); if (B === PH.base) { PH.bS = PH.bS || o.bS; PH.bL = PH.bL || o.bL; } }
    var out = PC.process(B, r, o), s = st(), fl = (PH.mode === "crop" && !o.forceFilters) || o.noFilters ? [] : s.filters;
    if (fl.length && !o.overlay) {
      var masks = {}; fl.forEach(function (f) { if (f.mask && s.fmask[f.id]) masks[f.id] = maskData(s.fmask[f.id], B.w, B.h); });
      var keep = o.split != null && o.split > 0 ? new Uint8ClampedArray(out.data) : null;
      var res = PC.applyFilters(out, fl, { k: B.w / ((B.full && B.full[0]) || B.w), masks: masks, code: X.thumbs ? function (f, px) { return px; } : codeRun });
      if (res.pending) X.pending = true;
      if (keep) { var sw = Math.round(o.split * B.w); for (var y = 0; y < B.h; y++) { var a = y * B.w * 4, e = a + sw * 4; res.data.set(keep.subarray(a, e), a); } }
      out = res;
    }
    return new ImageData(out.data, out.width, out.height);
  };
  var _thumbs = phPresetThumbs;
  phPresetThumbs = function () { X.thumbs = true; try { return _thumbs.apply(this, arguments); } finally { X.thumbs = false; } };
  phApplyPreset = function (r, patch) {
    var nr = PC.normRecipe(r), base = PC.recipe0();
    ["basic", "wb", "color", "detail", "fx", "bw", "grade", "curve"].forEach(function (k) { nr[k] = base[k]; });
    PC.deepMerge(nr, patch);
    return PC.normRecipe(nr);
  };
  /* la vista de una capa: sus píxeles, recortados por su máscara si tiene */
  function viewOf(L) {
    if (!L.mcv) return L.cv;
    if (!L.dv || L.dv.width !== L.cv.width || L.dv.height !== L.cv.height) L.dv = phCanvas(L.cv.width, L.cv.height);
    var x = L.dv.getContext("2d"); x.globalCompositeOperation = "source-over"; x.clearRect(0, 0, L.dv.width, L.dv.height); x.drawImage(L.cv, 0, 0);
    x.globalCompositeOperation = "destination-in"; x.drawImage(L.mcv, 0, 0, L.dv.width, L.dv.height); x.globalCompositeOperation = "source-over";
    return L.dv;
  }
  X.viewOf = viewOf;
  phMountLayers = function () {
    var box = pq("#phLys"); box.innerHTML = "";
    if (PH.mode === "crop") return;
    phLayers().forEach(function (L) { if (L.pre) return; var c = viewOf(L); Object.assign(c.style, { opacity: L.vis ? L.op / 100 : 0, mixBlendMode: L.blend, transform: "" }); box.appendChild(c); });
  };
  phFlatten = function (max) {
    var B = max === PH_WORK && PH.mode !== "crop" && PH.base ? PH.base : phBuild(PH.src, PH.r.geo, max), r = PH.r, brush = {};
    r.masks.forEach(function (m) { if (m.kind === "brush" && PH.brushCv[m.id]) brush[m.id] = maskData(PH.brushCv[m.id], B.w, B.h); });
    var cv = phCanvas(B.w, B.h), x = cv.getContext("2d");
    x.putImageData(phProcess(B, r, { brush: brush, forceFilters: true }), 0, 0);
    x.imageSmoothingQuality = "high";
    phLayers().forEach(function (L) { if (!L.vis || L.pre) return; x.globalAlpha = L.op / 100; x.globalCompositeOperation = L.blend === "normal" ? "source-over" : L.blend; x.drawImage(viewOf(L), 0, 0, B.w, B.h); });
    x.globalAlpha = 1; x.globalCompositeOperation = "source-over";
    return cv;
  };
  function waitJobs() { var js = Object.keys(X.jobs).map(function (k) { return X.jobs[k]; }); return js.length ? Promise.all(js.map(function (p) { return p.catch(function () {}); })) : new Promise(function (r) { setTimeout(r, 60); }); }
  /* aplanar esperando a los filtros de código (corren aislados y a su ritmo) */
  function flattenAsync(max) {
    return new Promise(function (res, rej) {
      var tries = 0;
      (function go() { var cv; X.pending = false; try { cv = phFlatten(max); } catch (e) { return rej(e); } if (!X.pending || tries++ > 60) return res(cv); waitJobs().then(go); })();
    });
  }
  X.flattenAsync = flattenAsync;
  function maxOut() { var s = st(), m = Math.min(4096, Math.max(PH.src ? PH.src.width : 2400, PH.src ? PH.src.height : 2400)); return s.out && s.out.maxW ? Math.min(m, s.out.maxW) : m; }
  X.maxOut = maxOut;

  /* ═════════════ filtros de código: corren en un Worker dentro de un iframe aislado (sin acceso a Musa) ═════════════ */
  var FXBOX = null, FXQ = {}, FXN = 0, FXC = {}, FXK = [];
  function boxMain() {
    var wsrc = "onmessage=function(e){var d=e.data,px=new Uint8ClampedArray(d.buf);try{var c=String(d.code).trim();if(!/^(?:async\\s+)?(?:function\\b|\\([^)]*\\)\\s*=>|[A-Za-z_$][\\w$]*\\s*=>)/.test(c))c='function(px,w,h,p){'+c+'\\n}';var fn=(0,eval)('('+c+')');if(typeof fn!=='function')throw new Error('el filtro debe ser una función (px, w, h, p) => { … }');var r=fn(px,d.w,d.h,d.values||{});var out=r&&r.length===px.length?r:px;if(!(out instanceof Uint8ClampedArray))out=Uint8ClampedArray.from(out);postMessage({id:d.id,buf:out.buffer},[out.buffer]);}catch(err){postMessage({id:d.id,err:String(err&&err.message||err)});}};";
    var url = null; try { url = URL.createObjectURL(new Blob([wsrc], { type: "text/javascript" })); } catch (e) { url = null; }
    addEventListener("message", function (e) {
      var d = e.data; if (!d || d.__phfx !== 1) return;
      var done = function (m, tr) { parent.postMessage(Object.assign({ __phfx: 2 }, m), "*", tr || []); };
      var w; try { w = new Worker(url); } catch (er) { w = null; }
      if (!w) return done({ id: d.id, err: "este navegador no deja correr el filtro aislado" });
      var to = setTimeout(function () { w.terminate(); done({ id: d.id, err: "el filtro tardó más de 10 s (¿un bucle sin fin?)" }); }, 10000);
      w.onmessage = function (m) { clearTimeout(to); w.terminate(); done(m.data, m.data.buf ? [m.data.buf] : []); };
      w.onerror = function (er) { clearTimeout(to); w.terminate(); done({ id: d.id, err: String(er.message || "error en el filtro") }); };
      w.postMessage(d, [d.buf]);
    });
    parent.postMessage({ __phfx: 0 }, "*");
  }
  function fxBox() {
    if (FXBOX) return FXBOX.ready;
    var f = document.createElement("iframe"); f.setAttribute("sandbox", "allow-scripts"); f.setAttribute("aria-hidden", "true"); f.tabIndex = -1; f.title = "filtros de código";
    f.style.cssText = "position:fixed;left:-9999px;top:0;width:10px;height:10px;border:0;opacity:0;pointer-events:none";
    FXBOX = { f: f };
    FXBOX.ready = new Promise(function (res) {
      window.addEventListener("message", function (e) {
        var d = e.data; if (!d || e.source !== f.contentWindow) return;
        if (d.__phfx === 0) return res(f);
        if (d.__phfx === 2 && FXQ[d.id]) { var q = FXQ[d.id]; delete FXQ[d.id]; if (d.err) q.j(new Error(d.err)); else q.r(new Uint8ClampedArray(d.buf)); }
      });
    });
    f.srcdoc = "<!doctype html><meta charset='utf-8'><script>" + boxMain.toString() + ";boxMain();<\/script>";
    document.body.appendChild(f);
    return FXBOX.ready;
  }
  function runCodeFilter(code, px, w, h, values) {
    return fxBox().then(function (f) { return new Promise(function (r, j) { var id = ++FXN, buf = new Uint8ClampedArray(px).buffer; FXQ[id] = { r: r, j: j }; f.contentWindow.postMessage({ __phfx: 1, id: id, code: code, buf: buf, w: w, h: h, values: values || {} }, "*", [buf]); }); });
  }
  X.runCodeFilter = runCodeFilter;
  function sampleHash(px) { var h = 2166136261, stp = Math.max(4, (px.length / 20000 | 0) * 4 + 1); for (var i = 0; i < px.length; i += stp) h = Math.imul(h ^ px[i], 16777619); return (h >>> 0).toString(36); }
  function codeRun(f, px, w, h) {
    var key = f.id + "|" + ML.hash(f.code + JSON.stringify(f.values || {})) + "|" + w + "x" + h + "|" + sampleHash(px), c = FXC[key];
    if (c) { if (c.err) { if (!c.told) { c.told = true; say("Filtro de código: " + c.err); } f._err = c.err; return px; } delete f._err; return new Uint8ClampedArray(c); }
    if (!X.jobs[key]) {
      X.jobs[key] = runCodeFilter(f.code, px, w, h, f.values).then(function (out) { FXC[key] = out; }, function (e) { FXC[key] = { err: errOf(e) }; }).then(function () {
        delete X.jobs[key]; FXK.push(key); while (FXK.length > 14) delete FXC[FXK.shift()];
        if (PH.open) { phDraw(); if (X.onCodeFilter) X.onCodeFilter(); }
      });
    }
    return null;
  }

  /* ═════════════ capas ═════════════ */
  function fontOf(name) { return (typeof FONTS !== "undefined" && FONTS[name]) || (/[,"']/.test(name) ? name : '"' + name + '", sans-serif'); }
  function paintText(x, t, W, H) {
    var px = t.size * H, lines = String(t.s).split("\n"), lh = px * (t.lh || 1.15);
    x.save();
    x.font = (t.italic ? "italic " : "") + (t.weight || 400) + " " + px + "px " + fontOf(t.font);
    x.textBaseline = "top"; x.textAlign = t.vert ? "left" : t.align || "left";
    try { if ("letterSpacing" in x) x.letterSpacing = (t.ls || 0) * px + "px"; } catch (e) { /* navegador sin espaciado */ }
    x.translate(t.x * W, t.y * H); if (t.rot) x.rotate(t.rot * Math.PI / 180);
    if (t.bg && !t.vert) { var mw = 0; lines.forEach(function (l) { mw = Math.max(mw, x.measureText(l).width); }); var pad = px * 0.25, bx = t.align === "center" ? -mw / 2 : t.align === "right" ? -mw : 0; x.fillStyle = t.bg; x.fillRect(bx - pad, -pad, mw + pad * 2, lines.length * lh + pad * 2); }
    if (t.shadow) { x.shadowColor = "rgba(" + PC.hex(t.shadow.color).join(",") + "," + (t.shadow.op == null ? 0.6 : t.shadow.op / 100) + ")"; x.shadowBlur = t.shadow.blur * H; x.shadowOffsetX = t.shadow.x * H; x.shadowOffsetY = t.shadow.y * H; }
    lines.forEach(function (l, i) {
      var put = function (s, dx, dy) { if (t.stroke) { x.lineWidth = t.stroke.w * px * 2; x.strokeStyle = t.stroke.color; x.lineJoin = "round"; x.strokeText(s, dx, dy); } x.fillStyle = t.color; x.fillText(s, dx, dy); };
      if (t.vert) Array.from(l).forEach(function (ch, k) { put(ch, i * px * 1.1, k * px * 1.05); }); else put(l, 0, i * lh);
    });
    x.restore();
  }
  function shapePath(x, L, W, H) {
    var s = L.shape, b = L.box;
    x.beginPath();
    if (s.pts) {
      s.pts.forEach(function (p, i) { if (!i) x.moveTo(p[0] * W, p[1] * H); else if (p.length >= 6) x.bezierCurveTo(p[2] * W, p[3] * H, p[4] * W, p[5] * H, p[0] * W, p[1] * H); else x.lineTo(p[0] * W, p[1] * H); });
      if (s.closed && s.type !== "line") x.closePath();
      return;
    }
    var w = b.w * W, h = b.h * H;
    x.translate((b.x + b.w / 2) * W, (b.y + b.h / 2) * H); if (b.rot) x.rotate(b.rot * Math.PI / 180);
    if (s.type === "ellipse") x.ellipse(0, 0, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
    else { var r = Math.min(s.radius * Math.min(W, H), Math.abs(w / 2), Math.abs(h / 2)); if (r > 0 && x.roundRect) x.roundRect(-w / 2, -h / 2, w, h, r); else x.rect(-w / 2, -h / 2, w, h); }
  }
  function paintShape(x, L, W, H) {
    var s = L.shape; x.save(); shapePath(x, L, W, H);
    if (s.fill && s.fill !== "none") { x.fillStyle = s.fill; x.fill(); }
    if (s.stroke && s.stroke !== "none" && s.sw > 0) { x.strokeStyle = s.stroke; x.lineWidth = s.sw * Math.min(W, H); x.lineJoin = "round"; x.lineCap = "round"; x.stroke(); }
    x.restore();
  }
  function paintImage(x, img, L, W, H) {
    var b = L.box, w = b.w * W, h = b.h * H, iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    x.save(); x.imageSmoothingQuality = "high";
    x.translate((b.x + b.w / 2) * W, (b.y + b.h / 2) * H); if (b.rot) x.rotate(b.rot * Math.PI / 180);
    if (L.fit === "fill" || !iw) x.drawImage(img, -w / 2, -h / 2, w, h);
    else { var k = L.fit === "contain" ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih), dw = iw * k, dh = ih * k; x.beginPath(); x.rect(-w / 2, -h / 2, w, h); x.clip(); x.drawImage(img, -dw / 2, -dh / 2, dw, dh); }
    x.restore();
  }
  X.paintText = paintText; X.paintShape = paintShape; X.paintImage = paintImage; X.shapePath = shapePath;
  phLayerRender = function (L) {
    if (L.kind === "paint") return;
    var x = L.cv.getContext("2d"), W = L.cv.width, H = L.cv.height;
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, H);
    if (L.kind === "text" && L.text) paintText(x, L.text, W, H);
    else if (L.kind === "shape" && L.shape) paintShape(x, L, W, H);
    else if (L.kind === "image" && L.img) paintImage(x, L.img, L, W, H);
    L.dv = null;
    if (L.mcv && L.cv.parentNode) phMountLayers();
  };
  var NAMES = { paint: "Capa", image: "Imagen", text: "Texto", shape: "Forma" };
  phNewLayer = function (kind, o) {
    o = o || {};
    var sz = lres(), n = phLayers().filter(function (q) { return q.kind === kind; }).length + 1;
    var L = Object.assign({ id: ++phLid, uid: PC.uid("l"), kind: kind, name: kind === "text" ? "Texto" : NAMES[kind] + " " + n, cv: phCanvas(sz[0], sz[1]), op: 100, blend: "normal", vis: true }, o);
    if (kind === "text") L.text = Object.assign({}, PC.TEXT0, L.text || {});
    if (kind === "paint" && !L.box) L.box = { x: 0, y: 0, w: 1, h: 1, rot: 0 };
    phLayers().push(L); X.pool[L.id] = L; PH.layer = L.id;
    phLayerRender(L); phMountLayers();
    return L;
  };
  phStamp = function (L, u, v, erase) {
    var x = L.cv.getContext("2d"), W = L.cv.width, H = L.cv.height, rad = PH.brush.size / 2 * (W / (PH.base ? PH.base.w : W)), hard = PH.brush.hard / 100;
    x.save();
    x.globalCompositeOperation = erase ? "destination-out" : "source-over";
    x.globalAlpha = PH.brush.op / 100 * (hard >= 1 ? 1 : 0.55);
    var g = x.createRadialGradient(u * W, v * H, rad * hard, u * W, v * H, rad), col = erase ? "0,0,0" : phHex(PH.front).join(",");
    g.addColorStop(0, "rgba(" + col + ",1)"); g.addColorStop(1, "rgba(" + col + ",0)");
    x.fillStyle = hard >= 1 ? "rgb(" + col + ")" : g;
    x.beginPath(); x.arc(u * W, v * H, rad, 0, 7); x.fill();
    x.restore();
  };
  function specOf(L) {
    var o = { id: L.uid, kind: L.kind, name: L.name, op: L.op, blend: L.blend, vis: L.vis };
    if (L.lock) o.lock = true; if (L.maskSrc && L.mcv) o.mask = L.maskSrc;
    if (L.kind === "paint") { if (L.src) o.src = L.src; if (L.pre) o.pre = true; o.box = L.box || { x: 0, y: 0, w: 1, h: 1 }; }
    if (L.kind === "image") { o.src = L.src || "pending:" + L.uid; o.box = L.box; if (L.fit) o.fit = L.fit; }
    if (L.kind === "text") o.text = L.text;
    if (L.kind === "shape") { o.shape = L.shape; if (L.box) o.box = L.box; }
    return o;
  }
  function byUid(u) { var ls = phLayers(); for (var i = 0; i < ls.length; i++) if (ls[i].uid === u) return ls[i]; var ks = Object.keys(X.pool); for (var j = 0; j < ks.length; j++) if (X.pool[ks[j]].uid === u) return X.pool[ks[j]]; return null; }
  /* pone las capas del editor según el documento (crea, actualiza, quita y ordena). Devuelve una promesa: los píxeles llegan después */
  function syncLayers(specs) {
    var sz = lres(), jobs = [], out = [];
    (specs || []).forEach(function (s) {
      var L = byUid(s.id), fresh = !L;
      if (!L) { L = { id: ++phLid, uid: s.id, kind: s.kind, cv: phCanvas(sz[0], sz[1]) }; X.pool[L.id] = L; }
      if (L.kind !== s.kind) { L.kind = s.kind; L.cv = phCanvas(sz[0], sz[1]); L.img = null; L.src = null; }
      L.name = s.name; L.op = s.op; L.blend = s.blend; L.vis = s.vis; L.lock = !!s.lock; L.pre = !!s.pre;
      if (s.kind === "text") L.text = clone(s.text);
      if (s.kind === "shape") { L.shape = clone(s.shape); L.box = s.box ? clone(s.box) : null; }
      if (s.kind === "image") { L.box = clone(s.box); L.fit = s.fit; if (s.src !== L.src && !/^pending:/.test(s.src)) { L.src = s.src; jobs.push(loadImg(s.src).then(function (im) { L.img = im; phLayerRender(L); }, function () { L.bad = true; })); } }
      if (s.kind === "paint") {
        L.box = clone(s.box);
        if (s.src && s.src !== L.src) { L.src = s.src; jobs.push(loadImg(s.src).then(function (im) { var x = L.cv.getContext("2d"); x.clearRect(0, 0, L.cv.width, L.cv.height); x.drawImage(im, 0, 0, L.cv.width, L.cv.height); L.sig = pixSig(L.cv); if (L.pre) touchPre(); }, function () { L.bad = true; })); }
        else if (!s.src && L.src && !fresh) { L.src = null; L.cv.getContext("2d").clearRect(0, 0, L.cv.width, L.cv.height); L.sig = null; }
      }
      if (s.mask && s.mask !== L.maskSrc) { L.maskSrc = s.mask; jobs.push(loadImg(s.mask).then(function (im) { L.mcv = phCanvas(L.cv.width, L.cv.height); L.mcv.getContext("2d").drawImage(im, 0, 0, L.mcv.width, L.mcv.height); L.msig = pixSig(L.mcv); L.dv = null; }, function () {})); }
      else if (!s.mask && L.maskSrc) { L.maskSrc = null; L.mcv = null; L.dv = null; }
      phLayerRender(L);
      out.push(L);
    });
    PH.layersBy[PH.key] = out;
    if (!out.some(function (L) { return L.id === PH.layer; })) PH.layer = null;
    touchPre(true);
    return Promise.all(jobs).then(function () { if (PH.open) { phMountLayers(); phDraw(); } });
  }
  function touchPre(soft) { X.preRev++; if (!soft && PH.open) phDraw(); }
  X.touchPre = touchPre; X.specOf = specOf; X.syncLayers = syncLayers; X.byUid = byUid;

  /* ═════════════ historial: receta + filtros + estructura de capas (y los píxeles cuando hace falta) ═════════════ */
  function layerMeta() { return phLayers().map(function (L) { return { id: L.id, name: L.name, op: L.op, blend: L.blend, vis: L.vis, pre: !!L.pre, lock: !!L.lock, fit: L.fit, box: L.box ? clone(L.box) : null, text: L.text ? clone(L.text) : null, shape: L.shape ? clone(L.shape) : null }; }); }
  function snapState(full) {
    var s = st(), o = { r: JSON.stringify(PH.r), f: JSON.stringify(s.filters), ly: layerMeta(), src: JSON.stringify(s.source), url: s.url, sel: X.selGet ? X.selGet() : null };
    if (PH.mode === "brush" && PH.mask && PH.brushCv[PH.mask]) { o.bm = {}; o.bm[PH.mask] = copyCv(PH.brushCv[PH.mask]); }
    if (full) { o.px = {}; phLayers().forEach(function (L) { if (L.kind === "paint") o.px[L.id] = copyCv(L.cv); if (L.mcv) o.px["m" + L.id] = copyCv(L.mcv); }); o.bm = {}; Object.keys(PH.brushCv).forEach(function (id) { o.bm[id] = copyCv(PH.brushCv[id]); }); o.fm = {}; Object.keys(s.fmask).forEach(function (id) { o.fm[id] = copyCv(s.fmask[id]); }); }
    return o;
  }
  function trimHist() { var px = 0; for (var i = PH.hist.length - 1; i >= 0; i--) { var h = PH.hist[i]; if (h.cvs || h.px) { px++; if (px > 24) { PH.hist.splice(0, i + 1); break; } } } if (PH.hist.length > 120) PH.hist.splice(0, PH.hist.length - 120); }
  phSnap = function () { PH.hist.push(snapState(false)); trimHist(); PH.fut = []; phTopBtns(); };
  X.snapFull = function () { PH.hist.push(snapState(true)); trimHist(); PH.fut = []; phTopBtns(); };
  function pixEntry(L) { return { id: L.id, cvs: copyCv(L.cv), mcv: L.mcv ? copyCv(L.mcv) : null, text: L.text ? clone(L.text) : null, box: L.box ? clone(L.box) : null, shape: L.shape ? clone(L.shape) : null }; }
  phSnapLayer = function (L) { PH.hist.push(pixEntry(L)); trimHist(); PH.fut = []; phTopBtns(); };
  function putCv(dst, src) { var x = dst.getContext("2d"); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "source-over"; x.globalAlpha = 1; x.clearRect(0, 0, dst.width, dst.height); x.drawImage(src, 0, 0, dst.width, dst.height); }
  function restoreLayers(meta) {
    var cur = {}; phLayers().forEach(function (L) { cur[L.id] = L; });
    PH.layersBy[PH.key] = meta.map(function (m) { var L = cur[m.id] || X.pool[m.id]; if (!L) return null; L.name = m.name; L.op = m.op; L.blend = m.blend; L.vis = m.vis; L.pre = m.pre; L.lock = m.lock; L.fit = m.fit; L.box = m.box ? clone(m.box) : L.box; if (m.text) L.text = clone(m.text); if (m.shape) L.shape = clone(m.shape); phLayerRender(L); return L; }).filter(Boolean);
    if (!phLayers().some(function (L) { return L.id === PH.layer; })) PH.layer = null;
  }
  phUndo = function (redo) {
    var from = redo ? PH.fut : PH.hist, to = redo ? PH.hist : PH.fut, s = from.pop();
    if (!s) return;
    if (s.r) {
      var now = snapState(!!s.px); if (s.bm && !now.bm) { now.bm = {}; Object.keys(s.bm).forEach(function (id) { if (PH.brushCv[id]) now.bm[id] = copyCv(PH.brushCv[id]); }); }
      to.push(now);
      var S = st(), srcCh = s.src !== JSON.stringify(S.source) || s.url !== S.url;
      PH.r = JSON.parse(s.r); S.filters = JSON.parse(s.f || "[]"); if (s.ly) restoreLayers(s.ly);
      if (s.px) phLayers().forEach(function (L) { if (s.px[L.id]) { if (L.cv.width !== s.px[L.id].width || L.cv.height !== s.px[L.id].height) L.cv = phCanvas(s.px[L.id].width, s.px[L.id].height); putCv(L.cv, s.px[L.id]); } if (s.px["m" + L.id]) { L.mcv = copyCv(s.px["m" + L.id]); } L.dv = null; });
      if (s.bm) Object.keys(s.bm).forEach(function (id) { PH.brushCv[id] = copyCv(s.bm[id]); });
      if (s.fm) Object.keys(s.fm).forEach(function (id) { S.fmask[id] = copyCv(s.fm[id]); });
      if (X.selSet) X.selSet(s.sel || null);
      if (!PH.r.masks.some(function (m) { return m.id === PH.mask; })) { PH.mask = null; if (PH.mode === "brush") PH.mode = "edit"; }
      PH.base = null; PH.bkey = ""; touchPre(true);
      if (srcCh) { S.source = JSON.parse(s.src || "null"); S.url = s.url || null; reloadSource(); }
    } else {
      var L = phLayers().find(function (q) { return q.id === s.id; }) || X.pool[s.id];
      if (!L) return phUndo(redo);
      to.push(pixEntry(L));
      if (L.kind === "paint") putCv(L.cv, s.cvs);
      if (s.mcv) L.mcv = copyCv(s.mcv); else if (L.mcv && !s.mcv) L.mcv = null;
      if (s.text) L.text = s.text; if (s.box) L.box = s.box; if (s.shape) L.shape = s.shape;
      L.dv = null; phLayerRender(L);
      if (L.pre) touchPre(true);
      phMountLayers();
    }
    if (X.onChange) X.onChange("undo");
    phAll();
  };

  /* ═════════════ el documento: leerlo del editor y ponerlo en el editor ═════════════ */
  function origUrl() {
    var s = st(); if (s.url) return s.url;
    var e = phEl(), d = PH.doc && PH.doc._photo;
    if (e && e.photo && e.photo.orig) return e.photo.orig;
    if (d) return d.src;
    if (e) return phUrlOf(e.fill);
    if (PH.t && PH.t.kind === "ext" && PH.ups[PH.t.u] && PH.ups[PH.t.u].url) return PH.ups[PH.t.u].url;
    return null;
  }
  function sourceNow() { var s = st(); if (s.source) return s.source; var u = origUrl(); return u && !/^blob:/.test(u) ? { kind: "url", url: u } : null; }
  function docNow() {
    var s = st(), d = { source: sourceNow(), recipe: PH.r, filters: s.filters, layers: phLayers().map(specOf) };
    if (s.out) d.out = s.out;
    return PC.normalize(d);
  }
  X.docNow = docNow; X.origUrl = origUrl;
  function loadBrush(m) {
    if (m.kind !== "brush" || !m.src || (PH.brushCv[m.id] && PH.brushCv[m.id]._src === m.src)) return null;
    return loadImg(m.src).then(function (im) { var w = PH.base ? PH.base.w : im.naturalWidth, h = PH.base ? PH.base.h : im.naturalHeight, c = phCanvas(w, h); c.getContext("2d").drawImage(im, 0, 0, w, h); c._src = m.src; c._sig = pixSig(c); PH.brushCv[m.id] = c; }, function () {});
  }
  function loadFmask(f) {
    var s = st(); if (!f.mask || (s.fmask[f.id] && s.fmask[f.id]._src === f.mask)) return null;
    return loadImg(f.mask).then(function (im) { var w = PH.base ? PH.base.w : im.naturalWidth, h = PH.base ? PH.base.h : im.naturalHeight, c = phCanvas(w, h); c.getContext("2d").drawImage(im, 0, 0, w, h); c._src = f.mask; c._sig = pixSig(c); s.fmask[f.id] = c; }, function () {});
  }
  function reloadSource() {
    var key = PH.key, t = PH.t; if (!t) return Promise.resolve();
    pq("#phMsg").hidden = false; pq("#phMsg").textContent = st().source ? "Dibujando el código…" : "Abriendo la foto…";
    return phSrcFor(t).then(function (c) {
      if (PH.key !== key || !PH.open) return;
      PH.src = c; PH.base = null; PH.bkey = ""; pq("#phMsg").hidden = true;
      var s = st(); if (s._cropPx) { var d = PC.resolveCropPx({ recipe: PH.r, _cropPx: s._cropPx }, c.width, c.height); PH.r.geo.crop = d.recipe.geo.crop; delete s._cropPx; }
      phAll(); if (X.onChange) X.onChange("source");
    });
  }
  X.reloadSource = reloadSource;
  /* pone un documento en el editor. o: { snap (por defecto true), keepSel } */
  function setDoc(doc, o) {
    o = o || {};
    var px = doc && doc._cropPx, d = PC.normalize(doc), s = st(), was = sourceNow();
    if (o.snap !== false) phSnap();
    PH.r = clone(d.recipe); s.filters = clone(d.filters); s.out = d.out || null;
    Object.keys(PH.brushCv).forEach(function (id) { if (!PH.r.masks.some(function (m) { return m.id === id; })) delete PH.brushCv[id]; });
    if (!PH.r.masks.some(function (m) { return m.id === PH.mask; })) { PH.mask = null; if (PH.mode === "brush") PH.mode = "edit"; }
    var jobs = [syncLayers(d.layers)];
    PH.r.masks.forEach(function (m) { var j = loadBrush(m); if (j) jobs.push(j); else if (m.kind === "brush" && !PH.brushCv[m.id] && PH.base) PH.brushCv[m.id] = phCanvas(PH.base.w, PH.base.h); });
    s.filters.forEach(function (f) { var j = loadFmask(f); if (j) jobs.push(j); if (!f.mask) delete s.fmask[f.id]; });
    if (px) s._cropPx = px;
    var srcCh = d.source && !PC.same(d.source, was);
    if (srcCh) { if (d.source.kind === "code") { s.source = d.source; s.url = null; } else { s.source = null; s.url = d.source.url; } jobs.push(reloadSource()); }
    else if (px && PH.src) { var r2 = PC.resolveCropPx({ recipe: PH.r, _cropPx: px }, PH.src.width, PH.src.height); PH.r.geo.crop = r2.recipe.geo.crop; delete s._cropPx; }
    PH.base = null; PH.bkey = "";
    phAll();
    return Promise.all(jobs).then(function () { if (PH.open) phAll(); });
  }
  X.setDoc = setDoc;

  /* lo que se guarda con la foto (en la capa del diseño o en el archivo de Fotos) */
  function metaOf(doc, orig, prev) {
    var m = { orig: orig, recipe: doc.recipe, edited: true, rev: PC.uid("r") };
    if (doc.filters.length) m.filters = doc.filters;
    if (doc.layers.length) m.layers = doc.layers;
    if (doc.source && doc.source.kind === "code") m.source = doc.source;
    if (doc.out) m.out = doc.out;
    if (prev && prev.versions) m.versions = prev.versions;
    return m;
  }
  function docOfMeta(ph, fallbackUrl) {
    if (!ph) return PC.normalize({ source: fallbackUrl ? { kind: "url", url: fallbackUrl } : null });
    return PC.normalize({ source: ph.source || (ph.orig || fallbackUrl ? { kind: "url", url: ph.orig || fallbackUrl } : null), recipe: ph.recipe, filters: ph.filters, layers: ph.layers, out: ph.out });
  }
  X.metaOf = metaOf; X.docOfMeta = docOfMeta;
  /* documento guardado de lo que se va a abrir (capa de diseño o foto suelta) */
  function storedFor(t) {
    if (!PH.doc || !t) return null;
    var lp = PH.doc._photo;
    if (lp) { var a = lp.asset, d = a.doc ? PC.normalize(a.doc) : PC.normalize({ source: { kind: "url", url: lp.src }, recipe: a.recipe || undefined }); if (!d.source) d.source = { kind: "url", url: lp.src }; return { doc: d, rev: a.rev || null, has: !!(a.doc || a.recipe) }; }
    if (t.kind !== "image") return null;
    var e = PH.doc.frames[t.f].els[t.e], ph = e && e.photo;
    if (!ph) return null;
    return { doc: docOfMeta(ph, phUrlOf(e.fill)), rev: ph.rev || null, has: true, stale: !!ph.stale };
  }
  function prime(key, t) {
    var sd = storedFor(t), s = X.by[key];
    if (s && s.rev === (sd ? sd.rev : null)) return;                       /* misma versión que ya está en memoria */
    if (s && s.base && sd && sd.has) { s.incoming = sd; return; }           /* cambió por fuera con esta foto ya abierta antes: se mezcla al cargar */
    s = X.by[key] = { filters: [], source: null, url: null, fmask: {}, rev: sd ? sd.rev : null, base: null, out: null };
    if (!sd || !sd.has) return;
    s.filters = clone(sd.doc.filters); s.out = sd.doc.out || null; s.todo = sd.doc;
    if (sd.doc.source && sd.doc.source.kind === "code") s.source = sd.doc.source;
    PH.recipes[key] = clone(sd.doc.recipe);
    delete PH.layersBy[key];
  }
  var _load = phLoad;
  phLoad = function (t) {
    var key = PH.fi + ":" + t.key;
    try { prime(key, t); } catch (e) { console.warn("[fotos] no se pudo leer la foto guardada", e); }
    return Promise.resolve(_load.apply(this, arguments)).then(function () {
      if (PH.key !== key || !PH.open) return;
      var s = st();
      ensureRecipe();
      var jobs = [];
      if (s.todo) { var d = s.todo; delete s.todo; jobs.push(syncLayers(d.layers)); PH.r.masks.forEach(function (m) { var j = loadBrush(m); if (j) jobs.push(j); }); s.filters.forEach(function (f) { var j = loadFmask(f); if (j) jobs.push(j); }); PH.r0 = JSON.stringify(PH.r); }
      return Promise.all(jobs).then(function () {
        if (PH.key !== key) return;
        if (!s.base) s.base = docNow();
        if (s.incoming) { var inc = s.incoming; delete s.incoming; mergeIn(inc.doc, inc.rev); }
        phAll(); if (X.onLoad) X.onLoad();
      });
    });
  };
  var _chrome = phChrome;
  phChrome = function () { ensureRecipe(); return _chrome.apply(this, arguments); };
  var _close = phClose;
  phClose = function () { if (X.onClose) try { X.onClose(); } catch (e) { /* panel */ } return _close.apply(this, arguments); };
  /* «con cambios» también mira filtros y capas, no solo la receta */
  X.dirty = function () { var s = st(); if (!PH.r || !PH.src) return false; return !s.base ? JSON.stringify(PH.r) !== PH.r0 || phLayers().length > 0 || s.filters.length > 0 : !PC.same(docNow(), s.base) || pixelsDirty(); };
  function pixelsDirty() { return phLayers().some(function (L) { return L.kind === "paint" && L._touched; }) || Object.keys(PH.brushCv).some(function (id) { return PH.brushCv[id]._touched; }); }

  /* ═════════════ la fuente de la foto: imagen o código ═════════════ */
  var SRCC = {}, SRCK = [];
  function srcKey(s) { return ML.hash(JSON.stringify([s.lang, s.code, s.w, s.h, s.t, s.input || "", s.capture || "", !!s.transparent])); }
  function renderSource(s, onStage) {
    var key = srcKey(s);
    if (SRCC[key]) return Promise.resolve(SRCC[key]);
    var p = s.lang === "svg" ? renderSvg(s) : s.lang === "glsl" ? renderGlsl(s) : s.lang === "py" ? renderPy(s, onStage) : renderWeb(s);
    return p.then(function (cv) { if (!cv || !cv.width) throw new Error("el código no dibujó ninguna imagen"); SRCC[key] = cv; SRCK.push(key); while (SRCK.length > 8) delete SRCC[SRCK.shift()]; return cv; });
  }
  X.renderSource = renderSource;
  function injectHead(html, tag) {
    var m = /<head[^>]*>/i.exec(html); if (m) return html.slice(0, m.index + m[0].length) + tag + html.slice(m.index + m[0].length);
    var b = /<html[^>]*>/i.exec(html); if (b) return html.slice(0, b.index + b[0].length) + tag + html.slice(b.index + b[0].length);
    var d = /<!doctype[^>]*>/i.exec(html); if (d) return html.slice(0, d.index + d[0].length) + tag + html.slice(d.index + d[0].length);
    return tag + html;
  }
  /* dentro del espacio aislado: la foto de entrada (INPUT) y las imágenes se piden con permiso de lectura */
  function preludeJs(s) {
    return "window.INPUT=" + JSON.stringify(s.input || "") + ";window.musaInput=window.INPUT;window.MUSA={width:" + s.w + ",height:" + s.h + ",time:" + (s.t || 0) + ",input:window.INPUT};"
      + "(function(){try{var d=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');if(d&&d.set)Object.defineProperty(HTMLImageElement.prototype,'src',{configurable:true,enumerable:true,get:d.get,set:function(v){if(!this.crossOrigin&&!/^(data:|blob:)/.test(String(v)))this.crossOrigin='anonymous';d.set.call(this,v);}});}catch(e){}})();";
  }
  function webDoc(s) {
    var code = s.code, pre = preludeJs(s);
    if (ML.isHtml(code)) return injectHead(code, "<script>" + pre + "<\/script>");
    return null;
  }
  function renderWeb(s) {
    var code = s.code, canvasy = s.capture ? s.capture === "canvas" : /getContext\s*\(|THREE\.|WebGLRenderer|new\s+p5\b|createCanvas\s*\(|PIXI\.|<canvas/i.test(code);
    if (!canvasy) return pageShot(s);
    return liveFrame(s).catch(function (e) { if (s.capture === "canvas" || !/sin lienzo/.test(errOf(e))) throw e; return pageShot(s); });
  }
  function liveFrame(s) {
    var html = webDoc(s), src = html || (preludeJs(s) + "\n" + s.code);
    if (!html && ML.isCanvasCode(src)) src = ML.prep(src);
    else if (!html) src = "<!doctype html><html><head><meta charset='utf-8'><style>html,body{margin:0}</style></head><body><script>" + src.replace(/<\/script/gi, "<\\/script") + "<\/script></body></html>";
    var L = { src: src, kind: "html" }, cli;
    try { cli = ML.client({ src: ML.runSrc(L), kind: "html", sel: -1, ov: {}, W: s.w, H: s.h, fps: 30, dur: Math.max(10, (s.t || 0) + 1), r3: false }); } catch (e) { return Promise.reject(e); }
    return cli.ready.then(function (stt) { if (!stt || !stt.n) throw new Error("sin lienzo"); return cli.frame(s.t || 0); }).then(function (r) {
      if (!r || r.none || !r.bmp) throw new Error((r && r.err) || "el código no dibujó nada");
      var cv = phCanvas(r.w, r.h); cv.getContext("2d").drawImage(r.bmp, 0, 0); try { r.bmp.close(); } catch (e) { /* ya cerrado */ }
      cli.destroy(); return cv;
    }, function (e) { try { cli.destroy(); } catch (x) { /* idem */ } throw e; });
  }
  /* página (HTML/CSS/texto): se dibuja con html2canvas dentro del espacio aislado */
  function shotMain(cfg) {
    function post(m, tr) { parent.postMessage(Object.assign({ __phpg: cfg.tok }, m), "*", tr || []); }
    function fail(e) { post({ err: String(e && e.message || e) }); }
    function toData(url) { return fetch(url, { mode: "cors" }).then(function (r) { if (!r.ok) throw new Error("x"); return r.blob(); }).then(function (b) { return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(b); }); }); }
    function abs(u, base) { try { return new URL(u, base).href; } catch (e) { return u; } }
    /* url(...) de un CSS → incrustadas (dentro de una imagen SVG nada se puede pedir a la red) */
    function inlineCss(css, base) {
      var urls = [], re = /url\(\s*(["']?)([^"')]+)\1\s*\)/g, m;
      while ((m = re.exec(css))) if (!/^(data:|#)/.test(m[2]) && urls.indexOf(m[2]) < 0) urls.push(m[2]);
      return Promise.all(urls.slice(0, 40).map(function (u) { return toData(abs(u, base)).then(function (d) { return [u, d]; }, function () { return null; }); })).then(function (ps) { ps.forEach(function (p) { if (p) css = css.split(p[0]).join(p[1]); }); return css; });
    }
    function go() {
      try { if (document.getAnimations) document.getAnimations().forEach(function (a) { try { a.pause(); a.currentTime = cfg.t * 1000; } catch (e) { /* animación sin tiempo */ } }); } catch (e) { /* sin WAAPI */ }
      var jobs = [];
      [].forEach.call(document.querySelectorAll('link[rel~="stylesheet"][href]'), function (l) { jobs.push(fetch(l.href, { mode: "cors" }).then(function (r) { return r.text(); }).then(function (css) { return inlineCss(css, l.href); }).then(function (css) { var st = document.createElement("style"); st.textContent = css; l.parentNode.replaceChild(st, l); }, function () {})); });
      [].forEach.call(document.querySelectorAll("style"), function (st) { if (/url\(/.test(st.textContent)) jobs.push(inlineCss(st.textContent, document.baseURI).then(function (css) { st.textContent = css; })); });
      [].forEach.call(document.querySelectorAll("[style*='url(']"), function (el) { jobs.push(inlineCss(el.getAttribute("style"), document.baseURI).then(function (css) { el.setAttribute("style", css); })); });
      [].forEach.call(document.images, function (im) { var u = im.currentSrc || im.src; im.removeAttribute("srcset"); im.removeAttribute("loading"); if (u && !/^data:/.test(u)) jobs.push(toData(u).then(function (d) { im.src = d; }, function () {})); });
      [].forEach.call(document.querySelectorAll("canvas"), function (c) { try { var im = document.createElement("img"); im.src = c.toDataURL(); im.width = c.width; im.height = c.height; im.style.cssText = c.style.cssText; im.className = c.className; c.parentNode.replaceChild(im, c); } catch (e) { /* lienzo sin lectura */ } });
      Promise.all(jobs).then(function () {
        [].forEach.call(document.querySelectorAll("script,noscript,iframe"), function (n) { n.parentNode.removeChild(n); });
        var cs = getComputedStyle(document.body), hs = getComputedStyle(document.documentElement), z = /^(rgba\(0, 0, 0, 0\)|transparent)$/;
        var bg = cfg.transparent ? null : !z.test(cs.backgroundColor) ? null : !z.test(hs.backgroundColor) ? null : "#ffffff";
        /* los valores de formularios y el tamaño de letra base viajan como atributos */
        [].forEach.call(document.querySelectorAll("input,textarea"), function (i) { if (i.type === "checkbox" || i.type === "radio") { if (i.checked) i.setAttribute("checked", ""); } else if (i.tagName === "TEXTAREA") i.textContent = i.value; else i.setAttribute("value", i.value); });
        var xml = new XMLSerializer().serializeToString(document.documentElement);
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + cfg.w + '" height="' + cfg.h + '"><foreignObject x="0" y="0" width="' + cfg.w + '" height="' + cfg.h + '">' + xml + "</foreignObject></svg>";
        var im = new Image();
        im.onload = function () {
          var cv = document.createElement("canvas"); cv.width = cfg.w; cv.height = cfg.h; var x = cv.getContext("2d");
          if (bg) { x.fillStyle = bg; x.fillRect(0, 0, cfg.w, cfg.h); }
          x.drawImage(im, 0, 0);
          try { cv.toBlob(function (b) { if (!b) return fail("no se pudo leer la página"); b.arrayBuffer().then(function (buf) { post({ buf: buf, w: cv.width, h: cv.height }, [buf]); }, fail); }, "image/png"); }
          catch (e) { fail("este navegador no deja convertir una página HTML en imagen (pasa en Safari): usa Chrome, o dibuja con canvas o SVG"); }
        };
        im.onerror = function () { fail("la página no se pudo convertir en imagen (HTML mal formado)"); };
        im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      }, fail);
    }
    function ready() { var f = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve(); f.then(function () { setTimeout(go, 350 + Math.min(8000, cfg.t * 1000 * (cfg.js ? 1 : 0))); }, function () { setTimeout(go, 350); }); }
    if (document.readyState === "complete") ready(); else addEventListener("load", ready);
    setTimeout(function () { fail("la página no terminó de cargar en 40 s"); }, 40000);
  }
  function pageShot(s) {
    var tok = "pg" + Math.random().toString(36).slice(2), code = s.code, pre = "<script>" + preludeJs(s) + "<\/script>";
    var tail = "<script>(" + shotMain.toString() + ")(" + JSON.stringify({ tok: tok, w: s.w, h: s.h, t: s.t || 0, transparent: !!s.transparent, js: /<script|=>|function\s*\(/.test(code) }) + ");<\/script>";
    var doc = ML.isHtml(code) ? injectHead(code, "<meta charset='utf-8'>" + pre) : "<!doctype html><html><head><meta charset='utf-8'><style>html,body{margin:0}</style>" + pre + "</head><body><script>" + code.replace(/<\/script/gi, "<\\/script") + "<\/script></body></html>";
    var bi = doc.toLowerCase().lastIndexOf("</body>"); doc = bi >= 0 ? doc.slice(0, bi) + tail + doc.slice(bi) : doc + tail;   /* sin replace(): el código de la función trae «$» */
    return new Promise(function (res, rej) {
      var f = document.createElement("iframe"); f.setAttribute("sandbox", "allow-scripts"); f.setAttribute("aria-hidden", "true"); f.tabIndex = -1; f.title = "página";
      f.style.cssText = "position:fixed;left:-30000px;top:0;border:0;opacity:0;pointer-events:none;width:" + s.w + "px;height:" + s.h + "px";
      var done = function () { window.removeEventListener("message", on); clearTimeout(to); try { f.remove(); } catch (e) { /* ya no está */ } };
      var on = function (e) {
        var d = e.data; if (!d || d.__phpg !== tok || e.source !== f.contentWindow) return;
        done();
        if (d.err) return rej(new Error(d.err));
        createImageBitmap(new Blob([d.buf], { type: "image/png" })).then(function (bmp) { var cv = phCanvas(bmp.width, bmp.height); cv.getContext("2d").drawImage(bmp, 0, 0); res(cv); }, rej);
      };
      var to = setTimeout(function () { done(); rej(new Error("la página no respondió en 60 s")); }, 60000);
      window.addEventListener("message", on);
      f.srcdoc = doc; document.body.appendChild(f);
    });
  }
  function fetchData(url) { return fetch(url, { mode: "cors" }).then(function (r) { if (!r.ok) throw new Error("no se pudo leer " + url.slice(0, 60)); return r.blob(); }).then(dataOf); }
  function renderSvg(s) {
    var code = s.code, hrefs = [], re = /(?:xlink:href|href)\s*=\s*(["'])(https?:\/\/[^"']+)\1/g, m;
    while ((m = re.exec(code))) if (hrefs.indexOf(m[2]) < 0) hrefs.push(m[2]);
    if (s.input) code = code.split("INPUT").join(s.input);
    /* dentro de una imagen el SVG no puede pedir archivos: lo de afuera se incrusta */
    return Promise.all(hrefs.slice(0, 12).map(function (u) { return fetchData(u).then(function (d) { return [u, d]; }, function () { return null; }); })).then(function (pairs) {
      pairs.filter(Boolean).forEach(function (p) { code = code.split(p[0]).join(p[1]); });
      if (!/<svg[^>]*\bxmlns\s*=/.test(code)) code = code.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"');
      var tag = /<svg\b[^>]*>/i.exec(code); if (!tag) throw new Error("no encontré la etiqueta <svg>");
      var t2 = tag[0];
      if (!/\bviewBox\s*=/.test(t2)) { var w0 = /\bwidth\s*=\s*["']([\d.]+)/.exec(t2), h0 = /\bheight\s*=\s*["']([\d.]+)/.exec(t2); t2 = t2.replace(/<svg\b/i, '<svg viewBox="0 0 ' + (w0 ? w0[1] : s.w) + " " + (h0 ? h0[1] : s.h) + '"'); }
      t2 = t2.replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi, "").replace(/<svg\b/i, '<svg width="' + s.w + '" height="' + s.h + '"');
      code = code.replace(tag[0], t2);
      return loadImg("data:image/svg+xml;charset=utf-8," + encodeURIComponent(code)).then(function (im) { var cv = phCanvas(s.w, s.h), x = cv.getContext("2d"); if (!s.transparent && !/<rect[^>]*width\s*=\s*["']100%/.test(code)) { /* un SVG sin fondo queda transparente: así se puede componer */ } x.drawImage(im, 0, 0, s.w, s.h); cv.getContext("2d").getImageData(0, 0, 1, 1); return cv; }, function () { throw new Error("el SVG tiene un error de sintaxis"); });
    });
  }
  /* shader (estilo ShaderToy o gl_FragColor): corre en WebGL aquí mismo — un shader no puede salir de su lienzo */
  function renderGlsl(s) {
    var inp = s.input ? loadImg(s.input).catch(function () { return null; }) : Promise.resolve(null);
    return inp.then(function (img) {
      var cv = phCanvas(s.w, s.h), gl = cv.getContext("webgl", { preserveDrawingBuffer: true, premultipliedAlpha: false }) || cv.getContext("experimental-webgl", { preserveDrawingBuffer: true });
      if (!gl) throw new Error("este navegador no tiene WebGL");
      var toy = /void\s+mainImage\s*\(/.test(s.code), head = "precision highp float;\nuniform vec3 iResolution;uniform float iTime;uniform vec4 iMouse;uniform sampler2D iChannel0;uniform vec2 u_resolution;uniform float u_time;uniform sampler2D u_image;uniform sampler2D u_texture;\n";
      var body = s.code.replace(/^\s*precision\s+\w+\s+float\s*;/m, "").replace(/^\s*uniform\s+(?:vec3\s+iResolution|float\s+iTime|vec4\s+iMouse|sampler2D\s+iChannel0|vec2\s+u_resolution|float\s+u_time|sampler2D\s+u_image|sampler2D\s+u_texture)\s*;/gm, "").replace(/^\s*#version[^\n]*/m, "");
      var fsrc = head + body + (toy ? "\nvoid main(){vec4 c=vec4(0.0,0.0,0.0,1.0);mainImage(c,gl_FragCoord.xy);gl_FragColor=c;}" : "");
      var mk = function (type, src) { var sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { var log = gl.getShaderInfoLog(sh) || "", ln = /ERROR:\s*\d+:(\d+)/.exec(log); throw new Error("el shader no compila" + (ln ? " (línea " + Math.max(1, +ln[1] - 2) + ")" : "") + ": " + log.split("\n")[0].replace(/ERROR:\s*\d+:\d+:\s*/, "")); } return sh; };
      var pr = gl.createProgram(); gl.attachShader(pr, mk(gl.VERTEX_SHADER, "attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}")); gl.attachShader(pr, mk(gl.FRAGMENT_SHADER, fsrc)); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error("el shader no enlaza: " + (gl.getProgramInfoLog(pr) || ""));
      gl.useProgram(pr);
      var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      var loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      var U = function (n) { return gl.getUniformLocation(pr, n); };
      gl.uniform3f(U("iResolution"), s.w, s.h, 1); gl.uniform2f(U("u_resolution"), s.w, s.h); gl.uniform1f(U("iTime"), s.t || 0); gl.uniform1f(U("u_time"), s.t || 0); gl.uniform4f(U("iMouse"), 0, 0, 0, 0);
      if (img) { var tx = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tx); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); ["iChannel0", "u_image", "u_texture"].forEach(function (n) { var l = U(n); if (l) gl.uniform1i(l, 0); }); }
      gl.viewport(0, 0, s.w, s.h); gl.drawArrays(gl.TRIANGLES, 0, 6);
      var out = phCanvas(s.w, s.h); out.getContext("2d").drawImage(cv, 0, 0);
      try { var ex = gl.getExtension("WEBGL_lose_context"); if (ex) ex.loseContext(); } catch (e) { /* sin extensión */ }
      return out;
    });
  }
  /* Python (Pillow, numpy, matplotlib, OpenCV…) con Pyodide, dentro de un iframe aislado que queda vivo para repetir rápido */
  var PYV = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/", PYBOX = null, PYQ = {}, PYN = 0;
  function pyMain(cfg) {
    var py = null, boot = null;
    function post(m, tr) { parent.postMessage(Object.assign({ __phpy: cfg.tok }, m), "*", tr || []); }
    function load() {
      return boot || (boot = new Promise(function (res, rej) {
        var sc = document.createElement("script"); sc.src = cfg.base + "pyodide.js";
        sc.onload = function () { loadPyodide({ indexURL: cfg.base }).then(function (p) { py = p; res(p); }, rej); };
        sc.onerror = function () { rej(new Error("no se pudo cargar Python: revisa tu conexión")); };
        document.head.appendChild(sc);
      }));
    }
    var FIND = ["def __musa_out():", "    import os, io, sys", "    try:", "        from PIL import Image", "    except Exception:", "        Image = None", "    g = globals()", "    im = None", "    best = None",
      "    for f in os.listdir('.'):", "        if f.lower().rsplit('.', 1)[-1] in ('png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff') and f not in __musa_inputs:", "            t = os.path.getmtime(f)", "            if best is None or t >= best[0]: best = (t, f)",
      "    if best is not None and Image is not None:", "        im = Image.open(best[1]); im.load()",
      "    if im is None and 'matplotlib.pyplot' in sys.modules:", "        plt = sys.modules['matplotlib.pyplot']", "        if plt.get_fignums():", "            b = io.BytesIO(); plt.gcf().savefig(b, format='png'); plt.close('all'); return b.getvalue()",
      "    if im is None:", "        for k in ('result', 'out', 'output', 'img', 'image', 'im', 'canvas', 'frame', 'arr', 'data'):", "            v = g.get(k)", "            if v is None: continue", "            if Image is not None and isinstance(v, Image.Image):", "                im = v; break",
      "            try:", "                import numpy as np", "                if isinstance(v, np.ndarray) and v.ndim in (2, 3):", "                    a = v", "                    if a.dtype != np.uint8:", "                        a = (np.clip(a, 0, 1) * 255).astype('uint8') if float(a.max()) <= 1.0 else np.clip(a, 0, 255).astype('uint8')",
      "                    if __musa_bgr and a.ndim == 3 and a.shape[2] >= 3:", "                        a = a[:, :, [2, 1, 0] + ([3] if a.shape[2] == 4 else [])]", "                    im = Image.fromarray(a); break", "            except Exception:", "                pass",
      "    if im is None and Image is not None:", "        cand = [v for v in list(g.values()) if isinstance(v, Image.Image)]", "        if cand: im = cand[-1]", "    if im is None: return None",
      "    if im.mode not in ('RGB', 'RGBA'): im = im.convert('RGBA' if ('A' in im.mode or im.mode == 'P') else 'RGB')", "    b = io.BytesIO(); im.save(b, format='PNG'); return b.getvalue()", "__musa_out()"].join("\n");
    addEventListener("message", function (e) {
      var d = e.data; if (!d || d.__phpyRun !== cfg.tok) return;
      (async function () {
        try {
          post({ id: d.id, stage: "Cargando Python (la primera vez tarda unos segundos)…" });
          var p = await load();
          post({ id: d.id, stage: "Cargando las librerías del script…" });
          await p.loadPackagesFromImports(d.code);
          if (/\bPIL\b|\bImage\b/.test(d.code) || d.files.length) { try { await p.loadPackage("pillow"); } catch (x) { /* ya está */ } }
          var dir = "/musa" + d.id; p.FS.mkdirTree(dir); p.FS.chdir(dir);
          d.files.forEach(function (f) { var parts = f.name.split("/"); if (parts.length > 1) { try { p.FS.mkdirTree(parts.slice(0, -1).join("/")); } catch (x) { /* existe */ } } p.FS.writeFile(f.name, new Uint8Array(f.buf)); });
          var ns = p.globals.get("dict")();
          ns.set("__musa_inputs", p.toPy(d.files.map(function (f) { return f.name; }))); ns.set("__musa_bgr", /import\s+cv2|from\s+cv2/.test(d.code));
          ns.set("MUSA_WIDTH", d.w); ns.set("MUSA_HEIGHT", d.h); ns.set("MUSA_TIME", d.t);
          post({ id: d.id, stage: "Corriendo el script…" });
          await p.runPythonAsync("import os\nos.environ['MPLBACKEND'] = 'Agg'\n", { globals: ns });
          await p.runPythonAsync(d.code, { globals: ns });
          var out = await p.runPythonAsync(FIND, { globals: ns });
          if (!out) throw new Error("el script terminó pero no dejó una imagen: guárdala (img.save('salida.png')) o déjala en una variable img / result");
          var bytes = out.toJs ? out.toJs() : out; if (out.destroy) out.destroy(); ns.destroy();
          var buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          post({ id: d.id, buf: buf }, [buf]);
        } catch (er) {
          var msg = String(er && er.message || er), tb = msg.split("\n").filter(function (l) { return l.trim(); }), last = tb[tb.length - 1] || msg, ln = null;
          tb.forEach(function (l) { var m = /File "<exec>", line (\d+)/.exec(l); if (m) ln = m[1]; });
          post({ id: d.id, err: (ln ? "línea " + ln + ": " : "") + last });
        }
      })();
    });
    post({ ready: 1 });
  }
  function pyBox() {
    if (PYBOX) return PYBOX.ready;
    var tok = "py" + Math.random().toString(36).slice(2), f = document.createElement("iframe");
    f.setAttribute("sandbox", "allow-scripts"); f.setAttribute("aria-hidden", "true"); f.tabIndex = -1; f.title = "python";
    f.style.cssText = "position:fixed;left:-9999px;top:0;width:10px;height:10px;border:0;opacity:0;pointer-events:none";
    PYBOX = { f: f, tok: tok };
    PYBOX.ready = new Promise(function (res) {
      window.addEventListener("message", function (e) {
        var d = e.data; if (!d || d.__phpy !== tok || e.source !== f.contentWindow) return;
        if (d.ready) return res(PYBOX);
        var q = PYQ[d.id]; if (!q) return;
        if (d.stage) { if (q.stage) q.stage(d.stage); return; }
        delete PYQ[d.id]; clearTimeout(q.to);
        if (d.err) q.j(new Error(d.err)); else q.r(d.buf);
      });
    });
    f.srcdoc = "<!doctype html><meta charset='utf-8'><body><script>(" + pyMain.toString() + ")(" + JSON.stringify({ tok: tok, base: PYV }) + ");<\/script></body>";
    document.body.appendChild(f);
    return PYBOX.ready;
  }
  function renderPy(s, onStage) {
    var names = [], re = /(?:Image\.open|imread|imageio\.v[23]\.imread|open)\(\s*r?["']([^"']+\.(?:png|jpe?g|webp|bmp|gif|tiff?))["']/gi, m;
    while ((m = re.exec(s.code))) if (names.indexOf(m[1]) < 0 && !/^https?:/.test(m[1])) names.push(m[1].replace(/^\.?\//, ""));
    if (names.length && !s.input) return Promise.reject(new Error("el script abre «" + names[0] + "»: abre una foto en el editor y pega el script ahí, así esa foto es su entrada"));
    var inp = names.length ? fetch(s.input, { mode: "cors" }).then(function (r) { if (!r.ok) throw new Error("no se pudo leer la foto de entrada"); return r.arrayBuffer(); }) : Promise.resolve(null);
    return Promise.all([pyBox(), inp]).then(function (a) {
      var box = a[0], buf = a[1], id = ++PYN;
      return new Promise(function (res, rej) {
        var q = PYQ[id] = { r: res, j: rej, stage: onStage || function (t) { if (PH.open) { var el = pq("#phMsg"); if (el && !el.hidden) el.textContent = t; } } };
        q.to = setTimeout(function () { delete PYQ[id]; try { PYBOX.f.remove(); } catch (e) { /* idem */ } PYBOX = null; rej(new Error("Python tardó más de 4 minutos: el iframe se reinició")); }, 240000);
        var files = buf ? names.map(function (nm) { return { name: nm, buf: buf.slice(0) }; }) : [];
        box.f.contentWindow.postMessage({ __phpyRun: box.tok, id: id, code: s.code, files: files, w: s.w, h: s.h, t: s.t || 0 }, "*");
      });
    }).then(function (buf) { return createImageBitmap(new Blob([buf], { type: "image/png" })); }).then(function (bmp) { var cv = phCanvas(bmp.width, bmp.height); cv.getContext("2d").drawImage(bmp, 0, 0); return cv; });
  }
  function errorCanvas(s, msg) {
    var cv = phCanvas(s.w, s.h), x = cv.getContext("2d"), u = Math.max(14, Math.round(Math.min(s.w, s.h) / 28));
    x.fillStyle = "#161616"; x.fillRect(0, 0, s.w, s.h); x.fillStyle = "#ff7a45"; x.font = "600 " + u + "px Inter, system-ui, sans-serif"; x.textBaseline = "top";
    x.fillText("El código no dibujó una imagen", u, u);
    x.fillStyle = "#cfcfcf"; x.font = Math.round(u * 0.72) + "px ui-monospace, Menlo, Consolas, monospace";
    var words = String(msg).split(/\s+/), line = "", y = u * 2.6;
    words.forEach(function (w) { var t = line ? line + " " + w : w; if (x.measureText(t).width > s.w - u * 2 && line) { x.fillText(line, u, y); y += u; line = w; } else line = t; });
    if (line) x.fillText(line, u, y);
    cv._err = msg;
    return cv;
  }
  function loadUrl(url) {
    if (PH_SRC.has(url)) return Promise.resolve(PH_SRC.get(url));
    return loadImg(url).then(function (im) { var c = toCanvas(im); PH_SRC.set(url, c); return c; });
  }
  var _srcFor = phSrcFor;
  phSrcFor = function (t) {
    var s = st(PH.fi + ":" + t.key), self = this, args = arguments;
    if (s.source && s.source.kind === "code") return renderSource(s.source).then(function (c) { s.codeErr = null; return c; }, function (e) { s.codeErr = errOf(e); say("El código no dibujó: " + s.codeErr); return errorCanvas(s.source, s.codeErr); });
    if (s.url) return loadUrl(s.url).catch(function () { say("No se pudo leer la imagen de la fuente"); return _srcFor.apply(self, args); });
    return _srcFor.apply(this, arguments);
  };

  /* ═════════════ dibujar un documento sin abrir el editor (fotos «por pintar», pasos a diseño/video, miniaturas) ═════════════ */
  function sourceCanvas(src) {
    if (!src) return Promise.reject(new Error("la foto no tiene fuente"));
    return src.kind === "code" ? renderSource(src) : loadImg(src.url).then(function (im) { return toCanvas(im); });
  }
  function renderDoc(doc, max) {
    var d = PC.normalize(doc);
    return sourceCanvas(d.source).then(function (src) {
      var lay = d.layers.map(function (L) { return L.src && !/^pending:/.test(L.src) ? loadImg(L.src).catch(function () { return null; }) : Promise.resolve(null); });
      var lmk = d.layers.map(function (L) { return L.mask ? loadImg(L.mask).catch(function () { return null; }) : Promise.resolve(null); });
      var bms = d.recipe.masks.map(function (m) { return m.src ? loadImg(m.src).catch(function () { return null; }) : Promise.resolve(null); });
      var fms = d.filters.map(function (f) { return f.mask ? loadImg(f.mask).catch(function () { return null; }) : Promise.resolve(null); });
      return Promise.all([Promise.all(lay), Promise.all(lmk), Promise.all(bms), Promise.all(fms)]).then(function (A) {
        var o = PC.outSize(src.width, src.height, d.recipe.geo), lim = Math.min(max || 4096, d.out && d.out.maxW ? d.out.maxW : 1e9);
        var B = _build(src, d.recipe.geo, lim), x0 = B.cv.getContext("2d"), pre = false;
        x0.setTransform(1, 0, 0, 1, 0, 0);
        d.layers.forEach(function (L, i) { if (L.kind === "paint" && L.pre && L.vis && A[0][i]) { x0.globalAlpha = L.op / 100; x0.drawImage(A[0][i], 0, 0, B.w, B.h); pre = true; } });
        x0.globalAlpha = 1; if (pre) B.d = x0.getImageData(0, 0, B.w, B.h).data;
        var brush = {}, masks = {};
        d.recipe.masks.forEach(function (m, i) { if (A[2][i]) brush[m.id] = maskData(toCanvas(A[2][i]), B.w, B.h); });
        d.filters.forEach(function (f, i) { if (A[3][i]) masks[f.id] = maskData(toCanvas(A[3][i]), B.w, B.h); });
        var base = PC.process(B, d.recipe, { brush: brush, alpha: true });
        var run = function () {
          var pend = false, res = PC.applyFilters({ data: new Uint8ClampedArray(base.data), width: B.w, height: B.h }, d.filters, { k: B.w / B.full[0], masks: masks, code: codeRun });
          if (res.pending) return waitJobs().then(run);
          var cv = phCanvas(B.w, B.h), x = cv.getContext("2d");
          x.putImageData(new ImageData(res.data, B.w, B.h), 0, 0); x.imageSmoothingQuality = "high";
          d.layers.forEach(function (L, i) {
            if (!L.vis || (L.kind === "paint" && L.pre)) return;
            var t = phCanvas(B.w, B.h), g = t.getContext("2d");
            if (L.kind === "paint") { if (!A[0][i]) return; g.drawImage(A[0][i], 0, 0, B.w, B.h); }
            else if (L.kind === "image") { if (!A[0][i]) return; paintImage(g, A[0][i], L, B.w, B.h); }
            else if (L.kind === "text") paintText(g, L.text, B.w, B.h);
            else paintShape(g, L, B.w, B.h);
            if (A[1][i]) { g.globalCompositeOperation = "destination-in"; g.drawImage(A[1][i], 0, 0, B.w, B.h); }
            x.globalAlpha = L.op / 100; x.globalCompositeOperation = L.blend === "normal" ? "source-over" : L.blend; x.drawImage(t, 0, 0);
          });
          x.globalAlpha = 1; x.globalCompositeOperation = "source-over";
          return cv;
        };
        return run();
      });
    });
  }
  X.renderDoc = renderDoc;

  /* ═════════════ guardar: los píxeles pintados se suben y la foto queda con su documento ═════════════ */
  var MINE = {};   /* archivos subidos en esta sesión: se pueden reemplazar sin dejar huérfanos */
  function upBitmap(cv, name, prevUrl) {
    var prev = prevUrl && MINE[prevUrl];
    return uploadCv(cv, name, { replace: prev || undefined }).then(function (r) { var u = r.url + (prev ? (r.url.indexOf("?") < 0 ? "?" : "&") + "v=" + Date.now().toString(36) : ""); if (r.id) MINE[u] = r.id; return u; });
  }
  function ensureBitmaps() {
    var jobs = [], s = st(), nm = (PH.t && PH.t.name) || "foto";
    phLayers().forEach(function (L) {
      if (L.kind === "paint") {
        var sig = pixSig(L.cv);
        if (isEmpty(L.cv)) { L.src = null; L.sig = sig; }
        else if (!L.src || L.sig !== sig) jobs.push(upBitmap(L.cv, nm + " · " + L.name + ".png", L.src).then(function (u) { L.src = u; L.sig = sig; }));
        L._touched = false;
      }
      if (L.kind === "image" && L.img && (!L.src || /^(blob:|data:)/.test(L.src))) jobs.push(upBitmap(toCanvas(L.img, 2400), nm + " · " + L.name + ".png", null).then(function (u) { L.src = u; }));
      if (L.mcv) { var ms = pixSig(L.mcv); if (!L.maskSrc || L.msig !== ms) jobs.push(upBitmap(L.mcv, nm + " · máscara de " + L.name + ".png", L.maskSrc).then(function (u) { L.maskSrc = u; L.msig = ms; })); }
    });
    PH.r.masks.forEach(function (m) {
      var c = PH.brushCv[m.id]; if (m.kind !== "brush" || !c) return;
      var sig = pixSig(c);
      if (!m.src || c._sig !== sig) jobs.push(upBitmap(c, nm + " · máscara.png", m.src).then(function (u) { m.src = u; c._src = u; c._sig = sig; }));
      c._touched = false;
    });
    s.filters.forEach(function (f) { var c = s.fmask[f.id]; if (!c) { delete f.mask; return; } var sig = pixSig(c); if (!f.mask || c._sig !== sig) jobs.push(upBitmap(c, nm + " · zona del filtro.png", f.mask).then(function (u) { f.mask = u; c._src = u; c._sig = sig; })); });
    return Promise.all(jobs);
  }
  X.ensureBitmaps = ensureBitmaps;
  /* la fuente de código necesita su imagen guardada (para que el original de la capa exista sin volver a correr el código) */
  function ensurePoster() {
    var s = st(); if (!s.source || s.source.kind !== "code" || !PH.src || PH.src._err) return Promise.resolve(null);
    var k = srcKey(s.source); if (s.posterKey === k && s.source.poster) return Promise.resolve(s.source.poster);
    return uploadCv(PH.src, ((PH.t && PH.t.name) || "foto") + " · fuente.png", { type: hasAlpha(PH.src) ? "image/png" : "image/jpeg" }).then(function (r) { s.source = Object.assign({}, s.source, { poster: r.url }); s.posterKey = k; return r.url; });
  }
  function outBlob(cv, fmt, q) {
    var type = fmt === "png" || (!fmt && hasAlpha(cv)) ? "image/png" : fmt === "webp" ? "image/webp" : "image/jpeg";
    return blobOf(cv, type, q == null ? 0.92 : q).then(function (b) { if (!b) throw new Error("no se pudo crear la imagen"); return b; });
  }
  X.outBlob = outBlob;
  function busy(on) { PH.busy = on; phOutBar(); }
  /* aplicar a la capa del diseño (o insertar la foto en el diseño) */
  function applyToDesign(all) {
    var t = PH.t, doc0 = PH.doc, fi = PH.fi;
    var list = all ? phInstances() : null;
    var go = function () {
      busy(true);
      return Promise.all([ensureBitmaps(), ensurePoster()]).then(function () { return flattenAsync(Math.min(maxOut(), 2400)); }).then(function (cv) {
        return uploadCv(cv, ((t && t.name) || "foto") + ".jpg", { type: hasAlpha(cv) ? "image/png" : "image/jpeg", tags: ["foto-revelada"] }).then(function (up) { return { cv: cv, url: up.url }; });
      }).then(function (o) {
        var d = docNow(), s = st(), fill = "url('" + o.url + "') center/cover no-repeat", sel, msg;
        PH_SRC.set(o.url, o.cv);
        if (t.kind === "image") {
          var e = phEl(), orig = (d.source && d.source.kind === "code" ? d.source.poster : null) || (e.photo && e.photo.orig) || s.url || phUrlOf(e.fill) || o.url;
          (all ? list : [e]).forEach(function (el) { el.photo = metaOf(d, orig, el.photo); el.fill = fill; });
          s.rev = e.photo.rev; s.base = docNow(); PH.recipes[PH.key] = clone(PH.r); PH.r0 = JSON.stringify(PH.r);
          sel = { f: t.f, e: t.e }; msg = all ? "Revelado aplicado a " + list.length + " capas" : "Aplicado a «" + e.name + "» · el original y todas sus capas quedan guardados";
        } else {
          var fr = t.kind === "frame" ? t.f : (typeof ED !== "undefined" && ED.sel && doc0.frames[ED.sel.f] ? ED.sel.f : 0), f = doc0.frames[fr];
          var W = t.kind === "frame" ? f.w : Math.round(Math.min(f.w * 0.6, o.cv.width)), H = t.kind === "frame" ? f.h : Math.round(W * o.cv.height / o.cv.width);
          var keep = t.kind === "ext" && d.source && (d.source.kind === "code" || (PH.ups[t.u] && PH.ups[t.u].url));
          var meta = keep ? metaOf(d, d.source.kind === "code" ? d.source.poster || o.url : PH.ups[t.u].url, null) : { orig: o.url, recipe: PC.recipe0(), rev: PC.uid("r") };
          var el2 = Object.assign({}, DEF, { type: "image", tag: "img", name: t.kind === "frame" ? "Frame pixel — " + f.name : t.name, x: t.kind === "frame" ? 0 : Math.round((f.w - W) / 2), y: t.kind === "frame" ? 0 : Math.round((f.h - H) / 2), w: W, h: H, fill: fill, photo: meta });
          f.els.push(el2);
          sel = { f: fr, e: f.els.length - 1 }; msg = t.kind === "frame" ? "«" + f.name + "» revelado entró como capa nueva" : "«" + t.name + "» insertada en " + f.name;
        }
        PH.busy = false;
        PH.retSel = Object.assign({ fi: fi }, sel, { msg: msg });
        location.hash = "crear/disenos/" + fi;
        setTimeout(function () { try { if (RB._ed && RB._ed.save) RB._ed.save(); } catch (e2) { /* editor cerrado */ } }, 500);
      }).catch(function (e) { busy(false); phToast("No se aplicó: " + errOf(e)); });
    };
    if (all) return RB.confirmBox("¿Aplicar este revelado a las " + list.length + " capas que usan la misma foto?", { ok: "Aplicar a todas" }).then(function (y) { if (y) return go(); });
    return go();
  }
  /* guardar una foto de Crear › Fotos. mode: "save" (misma foto editada) | "copy" (otra) */
  function saveLoose(mode) {
    var d = PH.doc._photo, a = d.asset, s = st();
    var sel = pq("#phSaveTo"), to = sel ? sel.value : "same", sid = null;
    if (/^drive:/.test(to)) { sid = to.slice(6); to = "drive"; }
    var base = d.orig || a, isEd = !!(a.edited || a.code || a.from), over = mode !== "copy" && isEd && a.source === "musa" && to !== "drive";
    var toMusa = over || to === "musa" || (to === "same" && base.source !== "drive");
    busy(true);
    return Promise.all([ensureBitmaps(), ensurePoster()]).then(function () { return flattenAsync(maxOut()); }).then(function (cv) {
      var fmt = hasAlpha(cv) ? "png" : "jpg";
      var tryQ = function (q, scale) {
        var c = cv; if (scale < 1) { c = phCanvas(cv.width * scale, cv.height * scale); c.getContext("2d").drawImage(cv, 0, 0, c.width, c.height); }
        return outBlob(c, fmt, q).then(function (b) { if (toMusa && b.size > 4.6 * 1048576) return fmt === "jpg" && q > 0.6 ? tryQ(q - 0.1, scale) : tryQ(0.85, scale * 0.8); return { b: b, w: c.width, h: c.height }; });
      };
      return tryQ(0.92, 1);
    }).then(function (o) { return dataOf(o.b).then(function (data) { return { data: data, w: o.w, h: o.h }; }); }).then(function (o) {
      var doc = docNow(), code = doc.source && doc.source.kind === "code";
      var name = over ? a.name : code && !a.from ? (a.name || "Foto con código") : (a.name || "Foto").replace(/ · editada( \d+)?$/, "") + " · editada";
      return api("/api/photo-sources/save", jreq("POST", { workspaceId: RB.ws, fromAssetId: over ? undefined : (code && !base.from && a.code ? undefined : base.id), replaceAssetId: over ? a.id : undefined, expectRev: over ? (s.rev || null) : undefined,
        data: o.data, width: o.w, height: o.h, name: name, recipe: doc.recipe, doc: doc, saveTo: toMusa ? "musa" : to === "drive" ? "drive" : "same", sourceId: sid, tags: (base.tags || a.tags || []).filter(function (t) { return t !== "musa:sistema"; }) }, 120000));
    }).then(function (x) {
      if (x && x.conflict) { PH.busy = false; mergeIn(x.doc, x.rev); phToast("Alguien más cambió esta foto: junté sus cambios con los tuyos. Revisa y guarda otra vez."); phOutBar(); return; }
      PH.busy = false; PH.r0 = JSON.stringify(PH.r);
      var na = x.asset || {}; s.rev = na.rev || null; s.base = docNow();
      if (x.updated) Object.assign(a, na);
      toast("Foto guardada en " + (x.savedTo === "drive" ? "Google Drive" + (x.account ? " (" + x.account + ")" : "") + ", carpeta «Musa»" : "Musa") + (x.updated ? "." : ". El original no se tocó."));
      var FO = window.__musaFotos; if (FO) { FO.F.rows = null; if (!x.updated && na.from) FO.F.filter = FO.F.filter === "todas" ? "todas" : "editadas"; }
      if (X.afterSave) X.afterSave(x);
      if (X.keepOpen) { X.keepOpen = false; phOutBar(); return x; }
      location.hash = "crear/fotos";
      return x;
    }, function (e) { PH.busy = false; phOutBar(); phToast("No se guardó: " + errOf(e)); });
  }
  X.saveLoose = saveLoose; X.applyToDesign = applyToDesign;
  phApply = function (all) {
    if (PH.busy) return;
    if (PH.doc && PH.doc._photo) return saveLoose("save");
    return applyToDesign(!!all);
  };

  /* ═════════════ exportar (tamaño real, formato y calidad) ═════════════ */
  function exportDialog(preset) {
    var full = PH.base ? PH.base.full : [PH.src.width, PH.src.height], maxSide = Math.max(full[0], full[1]), ar = full[0] / full[1];
    var name = ((PH.t && PH.t.name) || "foto").replace(/[\\/:*?"<>|]+/g, "").trim() || "foto";
    var dlg = document.createElement("div"); dlg.className = "mdlg phx-dlg"; dlg.setAttribute("role", "dialog"); dlg.setAttribute("aria-modal", "true"); dlg.setAttribute("aria-label", "Exportar la foto"); dlg.dataset.musaDialog = "photo-export";
    var sizes = [[maxSide, "Tamaño real"], [4096, "4096 px"], [2400, "2400 px"], [1600, "1600 px"], [1080, "1080 px"]].filter(function (o, i) { return !i || o[0] < maxSide; });
    dlg.innerHTML = '<form class="phx-card"><h3>Exportar la foto</h3>'
      + '<label>Formato<select name="fmt"><option value="jpg">JPG — fotos</option><option value="png">PNG — sin pérdida y con transparencia</option><option value="webp">WebP — liviano para web</option></select></label>'
      + '<label>Lado más largo<select name="size">' + sizes.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + "</option>"; }).join("") + '<option value="custom">Otro…</option></select></label>'
      + '<label class="phx-custom" hidden>Píxeles del lado más largo<input name="px" type="number" min="16" max="8192" value="' + Math.min(maxSide, 2000) + '"></label>'
      + '<label class="phx-q">Calidad <output>92</output><input name="q" type="range" min="40" max="100" value="92"></label>'
      + '<p class="phx-info" aria-live="polite"></p>'
      + '<div class="phx-row"><button type="button" data-x="cancel">Cancelar</button><button type="submit" class="pri">Descargar</button></div></form>';
    document.body.appendChild(dlg);
    var f = dlg.querySelector("form"), info = dlg.querySelector(".phx-info");
    if (preset) f.fmt.value = preset; else if (PH.src && hasAlpha(PH.src)) f.fmt.value = "png";
    var side = function () { return f.size.value === "custom" ? clamp(Math.round(+f.px.value || maxSide), 16, 8192) : +f.size.value; };
    var upd = function () {
      dlg.querySelector(".phx-custom").hidden = f.size.value !== "custom"; dlg.querySelector(".phx-q").hidden = f.fmt.value === "png"; f.q.previousElementSibling.textContent = f.q.value;
      var sd = side(), w = ar >= 1 ? sd : Math.round(sd * ar), h = ar >= 1 ? Math.round(sd / ar) : sd;
      info.textContent = w + " × " + h + " px" + (sd > maxSide ? " · más grande que la foto: se amplía" : "") + (f.fmt.value === "jpg" && X.lastAlpha ? " · JPG no guarda transparencia: el fondo queda negro" : "");
    };
    f.addEventListener("input", upd); upd();
    var close = function () { dlg.remove(); document.removeEventListener("keydown", onKey, true); };
    var onKey = function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", onKey, true);
    dlg.addEventListener("pointerdown", function (e) { if (e.target === dlg) close(); });
    f.querySelector("[data-x=cancel]").onclick = close;
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = f.querySelector("button[type=submit]"), sd = side(), fmt = f.fmt.value, q = +f.q.value / 100;
      btn.disabled = true; btn.textContent = "Preparando…";
      flattenAsync(Math.min(sd, 8192)).then(function (cv) {
        var want = ar >= 1 ? sd : Math.round(sd * ar);
        if (cv.width !== want) { var c2 = phCanvas(want, Math.round(want * cv.height / cv.width)), g = c2.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(cv, 0, 0, c2.width, c2.height); cv = c2; }
        return outBlob(cv, fmt, q).then(function (b) {
          var real = b.type === "image/png" ? "png" : b.type === "image/webp" ? "webp" : "jpg";   /* Safari no escribe WebP: sale PNG */
          var aEl = document.createElement("a"), u = URL.createObjectURL(b); aEl.href = u; aEl.download = name + "." + real; document.body.appendChild(aEl); aEl.click(); aEl.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
          close(); phToast("Exportado " + real.toUpperCase() + " · " + cv.width + "×" + cv.height + " px" + (real !== fmt ? " (este navegador no escribe " + fmt.toUpperCase() + ")" : ""));
        });
      }).catch(function (er) { btn.disabled = false; btn.textContent = "Descargar"; info.textContent = "No se pudo exportar: " + errOf(er); });
    });
    setTimeout(function () { try { f.fmt.focus(); } catch (e) { /* sin foco */ } }, 30);
  }
  X.exportDialog = exportDialog;
  phDownload = function (type) { X.lastAlpha = PH.src ? hasAlpha(PH.src) : false; exportDialog(type === "image/png" ? "png" : type === "image/webp" ? "webp" : type === "image/jpeg" ? "jpg" : null); };

  /* ═════════════ persona + IA a la vez: lo que llega de afuera se mezcla con lo abierto ═════════════ */
  function mergeIn(theirs, rev) {
    var s = st(); if (!theirs) return;
    var mine = docNow(), base = s.base || mine, mg = PC.merge3(base, mine, theirs);
    s.rev = rev || null;
    if (!mg.theirs) { s.base = PC.normalize(theirs); return; }
    return setDoc(mg.doc, { snap: true }).then(function () {
      s.base = PC.normalize(theirs);
      if (!mg.mine) { PH.r0 = JSON.stringify(PH.r); }
      phToast(mg.conflicts.length ? "Llegaron cambios de otra sesión o de una IA. En " + mg.conflicts.length + " valor" + (mg.conflicts.length === 1 ? "" : "es") + " que también cambiaste, quedó lo tuyo." : "Actualizado: esta foto cambió desde otra sesión o una IA");
      if (X.onChange) X.onChange("remote");
    });
  }
  X.mergeIn = mergeIn;
  function remoteState() {
    if (!PH.open || !PH.doc || !PH.t) return Promise.resolve(null);
    var lp = PH.doc._photo;
    if (lp) { var a = lp.asset; if (!(a.edited || a.code)) return Promise.resolve(null); return api("/api/photo-sources/asset/" + encodeURIComponent(a.id) + "/doc").then(function (x) { return { doc: x.doc, rev: x.rev || null }; }); }
    if (!PH.doc._real || PH.t.kind !== "image") return Promise.resolve(null);
    var e = phEl(), lid = e && e._n && e._n.getAttribute("data-layer-id"), fid = PH.doc.frames[PH.t.f] && PH.doc.frames[PH.t.f]._src && PH.doc.frames[PH.t.f]._src.id;
    if (!lid || !PH.doc._id) return Promise.resolve(null);
    return api("/api/templates/" + encodeURIComponent(PH.doc._id)).then(function (x) {
      var tpl = x.data || x, fr = (tpl.frames || []).filter(function (f) { return !fid || f.id === fid; }), found = null;
      fr.forEach(function (f) { if (found) return; var dp = new DOMParser().parseFromString("<body>" + (f.html || "") + "</body>", "text/html"), nd = dp.querySelector('[data-layer-id="' + String(lid).replace(/"/g, "") + '"]'); if (nd && nd.dataset.photo) { try { found = JSON.parse(nd.dataset.photo); found._fill = nd.getAttribute("src") || null; } catch (er) { found = null; } } });
      if (!found) return null;
      return { doc: docOfMeta(found, phUrlOf(e.fill)), rev: found.rev || null };
    });
  }
  var syncBusy = false;
  setInterval(function () {
    if (!PH.open || syncBusy || PH.busy || !PH.src || document.hidden) return;
    var key = PH.key, s = st(); if (!s.base) return;
    if (X.pointerDown && X.pointerDown()) return;
    syncBusy = true;
    remoteState().then(function (r) { syncBusy = false; if (!r || PH.key !== key || !PH.open) return; if ((r.rev || null) === (s.rev || null)) return; return mergeIn(r.doc, r.rev); }, function () { syncBusy = false; });
  }, 6000);

  /* ═════════════ estilos de los diálogos propios ═════════════ */
  var css = document.createElement("style"); css.id = "phx-css";
  css.textContent = ".phx-dlg{position:fixed;inset:0;z-index:400;background:rgba(0,0,0,.55);display:grid;place-items:center;padding:16px}"
    + ".phx-card{width:min(440px,100%);max-height:calc(100vh - 32px);overflow:auto;background:#161616;color:#eee;border:1px solid #333;border-radius:14px;padding:18px;display:grid;gap:12px;font:13px/1.45 Inter,system-ui,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.6)}"
    + ".phx-card.wide{width:min(760px,100%)}.phx-card h3{margin:0;font:700 16px/1.2 Inter,system-ui,sans-serif}.phx-card p{margin:0;color:#b5b5b5}"
    + ".phx-card label{display:grid;gap:5px;font-weight:600;font-size:12px;color:#cfcfcf}.phx-card select,.phx-card input[type=number],.phx-card input[type=text],.phx-card textarea{height:36px;border-radius:8px;border:1px solid #3a3a3a;background:#0e0e0e;color:#fff;padding:0 10px;font:inherit}"
    + ".phx-card textarea{height:auto;min-height:220px;padding:10px;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre;resize:vertical;tab-size:2}"
    + ".phx-card input[type=range]{accent-color:#ff5e00}.phx-q output{float:right;font-weight:500;color:#aaa}"
    + ".phx-row{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}.phx-row button{height:36px;padding:0 14px;border-radius:9px;border:1px solid #3a3a3a;background:#222;color:#fff;font:600 13px Inter,system-ui,sans-serif;cursor:pointer}.phx-row button.pri{background:#ff5e00;border-color:#ff5e00;color:#fff}.phx-row button:disabled{opacity:.55;cursor:default}"
    + ".phx-row button:focus-visible,.phx-card select:focus-visible,.phx-card input:focus-visible,.phx-card textarea:focus-visible{outline:2px solid #ff5e00;outline-offset:2px}"
    + ".phx-info{min-height:18px;font-size:12px}.phx-info.er{color:#ff8a70}.phx-list{display:grid;gap:6px;max-height:46vh;overflow:auto}.phx-list button{text-align:left;display:grid;gap:2px;padding:10px 12px;border-radius:10px;border:1px solid #333;background:#1d1d1d;color:#fff;cursor:pointer;font:600 13px Inter,system-ui,sans-serif}.phx-list button small{font-weight:400;color:#aaa}.phx-list button:hover{border-color:#ff5e00}";
  document.head.appendChild(css);
  X.ready = true;
})();
