/* bridge-video-code.js — el video es código y el código es video (Musa Video Code) dentro del editor.
 *
 * · Panel «Código» (botón </> en la barra del editor): el video abierto escrito como HTML + GSAP compatible con
 *   HyperFrames, en vivo. Cambias el video y el código cambia; cambias el código y el video cambia (Ctrl+Enter o
 *   solo, al dejar de escribir). También como Remotion (TSX) y como JSON del editor.
 * · El código sale del MISMO render que la vista previa (capHTML / mediaHTML / clipInner muestreados cuadro a cuadro):
 *   lo que ves es lo que está escrito. Lo simple se escribe «bonito» (entradas y keyframes con su curva de GSAP) y se
 *   comprueba que dé idéntico; lo compuesto (órbitas, ráfagas, máscaras, cámara…) va cuadro a cuadro.
 * · Código ajeno (HyperFrames, GSAP, CSS, anime.js, Remotion): corre en un sandbox aislado (iframe sin origen) con
 *   un reloj virtual y se convierte en clips editables (textos en T, formas, imágenes y vectores en M, video en V1,
 *   audio en A) con sus keyframes.
 * · Crear › Videos › «Desde código» y pegar código dentro del editor.
 * · Al guardar, los bloques de código de cada clip quedan en video_editor_state (el MCP los usa: video_code_get).
 */
(function () {
  "use strict";
  var VC = window.MusaVideoCode, P = window.__vePro;
  if (!VC || typeof VE === "undefined" || !P) return;
  function RB() { return window.__musaReal || {}; }
  function bridge() { try { return window.parent.__musaBridge; } catch (e) { return null; } }
  function api(url, init) { var b = bridge(); return b ? b.api(url, init) : Promise.reject(new Error("sin conexión")); }
  function jreq(method, body) { return { method: method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}), timeoutMs: 30000 }; }
  var r2 = function (v) { return Math.round(v * 100) / 100; }, r3 = function (v) { return Math.round(v * 1000) / 1000; };
  var cl = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function toast(m) { if (typeof vtoast === "function" && VE.open) vtoast(m); else if (typeof uiToast === "function") uiToast(m); }
  function WH(p) { var f = VFMT[(p && p.fmt) || "9:16"] || VFMT["9:16"]; return [f[0], f[1]]; }

  /* ═════════════ editor ↔ modelo del código ═════════════ */
  function modelOf(p) {
    var wh = WH(p), m = { name: p.name || "Video", W: wh[0], H: wh[1], fmt: p.fmt, fps: p.fps || 30, pad: p.pad || "#000000", grad: p.grad || null, total: p.total || null, persp: p.persp || null, gtr: p.gtr || null, markers: p.markers || null, v1: [], m: [], t: [], a: [] };
    p.v1.forEach(function (c) {
      var o = JSON.parse(JSON.stringify(c));
      if (c.kind === "take") { var tk = VTAKES[c.take]; delete o.take; o.takeUrl = tk && tk.blob ? tk.blob : ""; }
      if (c.kind === "scene" && !c.scene) { try { o.scene = JSON.parse(JSON.stringify(sceneOf(c))); delete o.ref; } catch (e) { /* diseño que ya no existe */ } }
      m.v1.push(o);
    });
    ["m", "t", "a"].forEach(function (k) { (p[k] || []).forEach(function (c) { m[k].push(JSON.parse(JSON.stringify(c))); }); });
    VC.relayoutV1(m);
    return m;
  }
  function envOf(p) {
    var W = WH(p)[0];
    return {
      fonts: FONTS, fitSize: function (c) { return P.fitSize(c, W); }, gradCss: P.gradCss, recolor: P.recolor, shapeSvg: P.shapeSvg,
      lookCss: function (id, k) { try { return typeof lookCss === "function" ? lookCss(id || "none", k == null ? 1 : k) : ""; } catch (e) { return ""; } },
      ovlCss: function (o) { try { var h = typeof ovlHTML === "function" ? ovlHTML(o, 0) : ""; var m = /style="([^"]*)"/.exec(h); return m ? m[1] : ""; } catch (e) { return ""; } },
      elHtml: function (e, id) { try { return '<div class="l" id="' + id + '" style="' + esc(elCss(e)) + '">' + elInner(e) + "</div>"; } catch (er) { return '<div class="l" id="' + id + '"></div>'; } },
      adjFilter: function (c, lt) { return (P.adjFilterOf || P.adjFilter)(c, lt || 0, 1); },
    };
  }
  /* registra un tamaño de lienzo (W×H) como formato del editor */
  function fmtKey(W, H) {
    var k = Object.keys(VFMT).find(function (x) { return VFMT[x][0] === W && VFMT[x][1] === H; });
    if (k) return k;
    k = W + ":" + H; VFMT[k] = [W, H, "Código " + W + "×" + H]; return k;
  }
  function ensureFontName(n) {
    if (!n || !/^[A-Za-z0-9 ]{2,40}$/.test(n)) return "Inter";
    if (!FONTS[n]) FONTS[n] = "'" + n + "'," + (/mono/i.test(n) ? "monospace" : /serif|playfair|lora|garamond/i.test(n) ? "serif" : "sans-serif");
    if (typeof VFONTS !== "undefined" && !VFONTS.some(function (f) { return f[0] === n; })) VFONTS.push([n, n]);
    try { P.ensureFont(n); } catch (e) { /* sin red */ }
    return n;
  }
  function adopt(c, prev, kind) {
    var o = JSON.parse(JSON.stringify(c));
    if (!o.id) o.id = nid();
    if (prev) ["_seg", "_mat", "_pm", "_ps"].forEach(function (k) { if (prev[k] != null) Object.defineProperty(o, k, { value: prev[k], writable: true, enumerable: false }); });
    if (kind === "t") { o.font = ensureFontName(o.font || "Inter"); if (o.text == null) o.text = ""; if (o.weight == null) o.weight = 800; if (!o.color) o.color = "#ffffff"; if (o.bg == null) o.bg = ""; if (o.size == null) o.size = 64; }
    if (kind === "m") { if (o.svg) { var s = P.sanitizeSvg ? P.sanitizeSvg(o.svg) : o.svg; if (s) { o.svg = s; o.bg = P.bgOf(o); } else delete o.svg; } if (o.vshape) o.bg = P.bgOf(o); if (o.w == null) o.w = 40; if (o.ar == null) o.ar = 1; }
    if (kind === "v1" && o.kind === "take") { var u = o.takeUrl || ""; o.take = RB().takeFor ? RB().takeFor(u, o.name || "Video", o.dur) : 0; delete o.takeUrl; ["in", "speed", "vol", "lookK"].forEach(function (k) { if (o[k] == null) o[k] = k === "in" ? 0 : 1; }); if (!o.look) o.look = "none"; if (!o.fx) o.fx = "none"; if (!o.ovl) o.ovl = "none"; if (o.trans === undefined) o.trans = null; }
    if (kind === "v1" && o.kind === "scene") { ["in"].forEach(function (k) { if (o[k] == null) o[k] = 0; }); if (o.speed == null) o.speed = 1; if (!o.look) o.look = "none"; if (o.lookK == null) o.lookK = 1; if (!o.fx) o.fx = "none"; if (!o.ovl) o.ovl = "none"; if (o.trans === undefined) o.trans = null; if (!o.fit) o.fit = "contain"; }
    return o;
  }
  /* aplica un modelo al video abierto: los clips que siguen (mismo id) conservan su fila en la base */
  function applyModel(model, opts) {
    opts = opts || {};
    var p = VE.p; if (!p) return;
    vsnap();
    var old = {}; ["v1", "m", "t", "a"].forEach(function (k) { (p[k] || []).forEach(function (c) { old[c.id] = c; }); });
    if (model.W && model.H) p.fmt = fmtKey(model.W, model.H);
    if (model.fps) p.fps = model.fps;
    p.pad = model.pad || p.pad; p.grad = model.grad || null; p.total = model.total || null; p.persp = model.persp || null;
    if (model.gtr !== undefined) p.gtr = model.gtr; if (model.markers !== undefined) p.markers = model.markers;
    if (opts.rename && model.name) p.name = model.name;
    ["m", "t", "a"].forEach(function (k) { p[k] = (model[k] || []).map(function (c) { return adopt(c, old[c.id], k); }); });
    p.v1 = (model.v1 || []).map(function (c) { return adopt(c, old[c.id], "v1"); });
    if (RB().veFixIds) RB().veFixIds(p);
    relayout(p);
    VE.sel = null;
    if (typeof veBin === "function") veBin();
    veAll(); veInsp();
  }
  /* «agregar al video»: los clips del código entran en el playhead, con ids nuevos */
  function appendModel(model) {
    var p = VE.p; if (!p) return 0;
    vsnap();
    var at = VE.t || 0, n = 0;
    ["m", "t", "a"].forEach(function (k) { (model[k] || []).forEach(function (c) { var o = adopt(c, null, k); o.id = nid(); o.start = r3((+o.start || 0) + at); p[k].push(o); n++; }); });
    (model.v1 || []).forEach(function (c) { var o = adopt(c, null, "v1"); o.id = nid(); p.v1.push(o); n++; });
    relayout(p); veAll(); veInsp();
    return n;
  }

  /* ═════════════ muestreo del render del editor → bloques exactos ═════════════ */
  function styleOf(html) {
    var m = /^\s*<[a-z]+\b[^>]*?\sstyle="([^"]*)"/i.exec(html || "");
    return m ? VC.cssParse(m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")) : null;
  }
  /* transform CSS → componentes de GSAP (los % se llevan aparte: xPercent / yPercent) */
  function tfParse(str) {
    var a = 1, b = 0, c = 0, d = 1, e = 0, f = 0, ep = 0, fp = 0, re = /([a-zA-Z]+)\(([^)]*)\)/g, m;
    function mul(A, B, C, D, E, F, EP, FP) {
      e += a * E + c * F; f += b * E + d * F; ep += a * EP + c * FP; fp += b * EP + d * FP;
      var na = a * A + c * B, nb = b * A + d * B, nc = a * C + c * D, nd = b * C + d * D; a = na; b = nb; c = nc; d = nd;
    }
    function len(v) { v = String(v || "0").trim(); return /%$/.test(v) ? { px: 0, pc: parseFloat(v) } : { px: parseFloat(v) || 0, pc: 0 }; }
    while ((m = re.exec(String(str || "")))) {
      var fn = m[1].toLowerCase(), args = m[2].split(",").map(function (x) { return x.trim(); });
      if (fn === "translate" || fn === "translate3d") { var X = len(args[0]), Y = len(args[1] || "0"); mul(1, 0, 0, 1, X.px, Y.px, X.pc, Y.pc); }
      else if (fn === "translatex") { var X2 = len(args[0]); mul(1, 0, 0, 1, X2.px, 0, X2.pc, 0); }
      else if (fn === "translatey") { var Y2 = len(args[0]); mul(1, 0, 0, 1, 0, Y2.px, 0, Y2.pc); }
      else if (fn === "rotate" || fn === "rotatez") { var ang = parseFloat(args[0]) * (/rad/.test(args[0]) ? 1 : /turn/.test(args[0]) ? 2 * Math.PI : Math.PI / 180); var co = Math.cos(ang), si = Math.sin(ang); mul(co, si, -si, co, 0, 0, 0, 0); }
      else if (fn === "scale" || fn === "scale3d") { var sx = parseFloat(args[0]), sy = args[1] != null ? parseFloat(args[1]) : sx; mul(isFinite(sx) ? sx : 1, 0, 0, isFinite(sy) ? sy : 1, 0, 0, 0, 0); }
      else if (fn === "scalex") mul(parseFloat(args[0]) || 1, 0, 0, 1, 0, 0, 0, 0);
      else if (fn === "scaley") mul(1, 0, 0, parseFloat(args[0]) || 1, 0, 0, 0, 0);
      else if (fn === "matrix") { var q = args.map(Number); if (q.length === 6) mul(q[0], q[1], q[2], q[3], q[4], q[5], 0, 0); }
    }
    var sxx = Math.hypot(a, b), det = a * d - b * c, syy = sxx ? det / sxx : 0;
    return { x: e, y: f, xp: ep, yp: fp, r: Math.atan2(b, a) * 180 / Math.PI, sx: sxx, sy: syy };
  }
  var KNOWN_T = { left: 1, top: 1, "font-family": 1, "font-size": 1, "font-weight": 1, color: 1, background: 1, padding: 1, "border-radius": 1, "white-space": 1, "max-width": 1, "letter-spacing": 1, "font-style": 1, "text-shadow": 1, outline: 1, "outline-offset": 1, transform: 1, opacity: 1, filter: 1, "clip-path": 1, "-webkit-clip-path": 1, "pointer-events": 1 };
  var KNOWN_M = { left: 1, top: 1, width: 1, height: 1, "aspect-ratio": 1, background: 1, "border-radius": 1, outline: 1, "outline-offset": 1, transform: 1, opacity: 1, filter: 1, "clip-path": 1, "-webkit-clip-path": 1, "pointer-events": 1 };
  function camel(p) { return p.replace(/^-webkit-/, "webkit-").replace(/-([a-z])/g, function (m, x) { return x.toUpperCase(); }); }
  function putTf(tr, i, n, tf, centered) {
    var put = function (k, v) { (tr[k] = tr[k] || new Array(n))[i] = v; };
    put("x", r2(tf.x)); put("y", r2(tf.y));
    if (!centered) { put("xPercent", r2(tf.xp)); put("yPercent", r2(tf.yp)); }
    put("rotation", r2(tf.r));
    if (Math.abs(tf.sx - tf.sy) < 1e-3) put("scale", r3(tf.sx)); else { put("scaleX", r3(tf.sx)); put("scaleY", r3(tf.sy)); }
  }
  /* valores que faltan en algunas muestras: el neutro de su forma (inset 0, blur 0) o un cambio de golpe */
  function fillMissing(tr, n) {
    Object.keys(tr).forEach(function (k) {
      var A = tr[k], def = A.find(function (v) { return v != null; }), miss = false;
      for (var i = 0; i < n; i++) if (A[i] == null) { miss = true; break; }
      if (!miss) return;
      var neutral = { x: 0, y: 0, xPercent: 0, yPercent: 0, rotation: 0, scale: 1, scaleX: 1, scaleY: 1, opacity: 1, visibility: "visible" }[k];
      if (neutral == null && typeof def === "string") {
        if (/^inset\(/.test(def)) neutral = "inset(0% 0% 0% 0%)";
        else if (/^(blur|brightness|contrast|saturate|hue-rotate|drop-shadow|sepia|grayscale)\(/.test(def)) neutral = def.replace(/(blur|hue-rotate|sepia|grayscale)\(\s*-?[\d.]+/g, "$1(0").replace(/(brightness|contrast|saturate)\(\s*-?[\d.]+/g, "$1(1").replace(/drop-shadow\([^)]*\)/g, "drop-shadow(0px 0px 0px transparent)");
        else neutral = k === "clipPath" ? "none" : k === "maskImage" || k === "webkitMaskImage" ? "none" : "";
      }
      for (var j = 0; j < n; j++) if (A[j] == null) A[j] = neutral;
    });
  }
  /* quita las pistas constantes en su valor neutro (no hace falta escribirlas) */
  function dropNeutral(tr) {
    var N = { x: 0, y: 0, xPercent: 0, yPercent: 0, rotation: 0, scale: 1, scaleX: 1, scaleY: 1, opacity: 1, filter: "blur(0px)", visibility: "visible" };
    Object.keys(tr).forEach(function (k) { var A = tr[k]; if (A.every(function (v) { return v === A[0]; }) && (A[0] === N[k] || A[0] === "" || A[0] == null || A[0] === "none")) delete tr[k]; });
    return tr;
  }
  function timesFor(t0, t1, fps) { var n = Math.max(2, Math.ceil((t1 - t0) * fps)), out = []; for (var i = 0; i < n; i++) out.push(r3(t0 + Math.min(t1 - t0 - 1e-3, i / fps))); return out; }

  function sampleTM(kind, live, p) {
    var fps = p.fps || 30, st = +live.start || 0, dur = +live.dur || 0, times = timesFor(st, st + dur, fps), n = times.length;
    var tr = {}, extra = {}, reveal = [], zs = [], known = kind === "t" ? KNOWN_T : KNOWN_M;
    times.forEach(function (t, i) {
      var html = kind === "t" ? capHTML(live, t) : mediaHTML(live, t), s = styleOf(html);
      if (!s) { (tr.visibility = tr.visibility || new Array(n))[i] = "hidden"; return; }
      if (live.adj) { s.transform = (s.transform || "").replace(/translate\(-50%\s*,\s*-50%\)/, ""); }
      putTf(tr, i, n, tfParse((s.transform || "").replace(/translate\(-50%\s*,\s*-50%\)/, "")), true);
      (tr.opacity = tr.opacity || new Array(n))[i] = r3(s.opacity != null ? +s.opacity : 1);
      var bl = /blur\(\s*([\d.]+)px\)/.exec(s.filter || ""); (tr.filter = tr.filter || new Array(n))[i] = "blur(" + (bl ? r2(+bl[1]) : 0) + "px)";
      if (s["clip-path"] != null) (tr.clipPath = tr.clipPath || new Array(n))[i] = s["clip-path"];
      Object.keys(s).forEach(function (k) { if (known[k] || k === "visibility" && s[k] !== "hidden") return; var ck = camel(k); (tr[ck] = tr[ck] || new Array(n))[i] = s[k]; extra[ck] = 1; });
      if (kind === "t") { var stt = P.state(live, t, "t"); if (stt.chars != null) { var txt = String(live.text || ""), L = Math.round(txt.length * stt.chars); reveal.push({ t: t, n: live.anim === "words" ? wordsUpTo(txt, L) : L }); } }
      if (P.zOf) zs.push(P.zOf(live, t)); else zs.push(0);
    });
    fillMissing(tr, n); dropNeutral(tr);
    return { times: times, tr: tr, extra: Object.keys(extra).filter(function (k) { return tr[k]; }), reveal: reveal.length ? reveal : null, zs: zs };
  }
  function wordsUpTo(txt, L) { var re = /\S+/g, m, k = 0; while ((m = re.exec(txt))) { if (m.index + m[0].length <= L) k++; else break; } return k; }
  /* ¿la versión «bonita» (curvas de GSAP) da lo mismo que el render? */
  function verify(lines, id, S, eases) {
    if (S.extra.length || S.tr.clipPath || S.tr.visibility || S.tr.xPercent || S.tr.yPercent || S.tr.scaleX) return false;
    var tree = VC.parseHtml('<div id="' + id + '"><div class="in"></div></div>'), el = VC.select(tree, "#" + id)[0], inn = VC.select(tree, "#" + id + " .in")[0];
    var parsed = VC.parseGsap(lines.join("\n")), custom = {};
    (eases || []).forEach(function (e) { custom[e.g] = "M0,0 C" + e.bz[0] + "," + e.bz[1] + " " + e.bz[2] + "," + e.bz[3] + " 1,1"; });
    parsed.eases = custom;
    var built = VC.buildSegments(parsed, function (t) { return typeof t === "string" ? VC.select(tree, t) : null; });
    if (built.unresolved.length) return false;
    var ev = VC.makeEval(built, custom), T = S.tr;
    for (var i = 0; i < S.times.length; i++) {
      var st = VC.composeAt(ev, [el, inn], S.times[i]);
      var ex = T.x ? T.x[i] : 0, ey = T.y ? T.y[i] : 0, es = T.scale ? T.scale[i] : 1, er = T.rotation ? T.rotation[i] : 0, eo = T.opacity ? T.opacity[i] : 1, eb = T.filter ? parseFloat(/blur\(([\d.]+)/.exec(T.filter[i])[1]) : 0;
      if (Math.abs(st.x - ex) > 0.75 || Math.abs(st.y - ey) > 0.75 || Math.abs(st.s - es) > 0.006 || Math.abs(st.r - er) > 0.25 || Math.abs(st.o - eo) > 0.01 || Math.abs(st.b - eb) > 0.35) return false;
    }
    return true;
  }
  function liveOf(kind, c, p) { return (kind === "v1" ? p.v1 : p[kind]).find(function (x) { return x.id === c.id; }) || c; }
  function morphLines(id, c) {
    var st = +c.start || 0, at = c.morphAt != null ? +c.morphAt : (+c.dur || 0) / 2, d = c.morphD != null ? +c.morphD : 0.6, sel = "#" + id + " .in ";
    return [
      "tl.set(" + JSON.stringify(sel + ".mb") + ", { opacity: 0, filter: \"blur(14px)\" }, " + VC.fmtN(r3(st)) + ");",
      "tl.fromTo(" + JSON.stringify(sel + ".ma") + ", { opacity: 1, filter: \"blur(0px)\" }, { opacity: 0, filter: \"blur(14px)\", duration: " + VC.fmtN(r3(d)) + ", ease: \"none\" }, " + VC.fmtN(r3(st + at)) + ");",
      "tl.fromTo(" + JSON.stringify(sel + ".mb") + ", { opacity: 0, filter: \"blur(14px)\" }, { opacity: 1, filter: \"blur(0px)\", duration: " + VC.fmtN(r3(d)) + ", ease: \"none\" }, " + VC.fmtN(r3(st + at)) + ");",
    ];
  }
  function blockTM(kind, c, model, env, p) {
    var b = VC.staticBlock(kind, c, model, env), live = liveOf(kind, c, p), S = sampleTM(kind, live, p), lines, sm = VC.semanticMotion(kind, c, b.id, env);
    if (sm && verify(sm.lines, b.id, S, sm.eases)) { lines = sm.lines; b.eases = sm.eases; b.mode = "curvas"; }
    else { lines = VC.emitTracks("#" + b.id, S.times, S.tr, +c.start || 0); b.mode = "cuadro a cuadro"; }
    if (S.reveal) lines = lines.concat(VC.revealLines(b.id, c, S.reveal).lines);
    if (c.morphTo) lines = lines.concat(morphLines(b.id, c));
    /* orden en Z que cambia con el tiempo (anillos 3D, profundidad): z-index del clip */
    if (S.zs.some(function (z) { return Math.abs(z - S.zs[0]) > 0.5; })) {
      var zt = { zIndex: S.zs.map(function (z) { return VC.zBase(c) + Math.round(z); }) };
      lines = lines.concat(VC.emitTracks("#" + b.id + "-c", S.times, zt, +c.start || 0));
    }
    return VC.finishBlock(b, lines, VC.labelOf(kind, c));
  }
  function blockV1(c, i, model, env, p) {
    var b = VC.staticBlock("v1", c, model, env, i), live = p.v1[i] || c, prev = p.v1[i - 1], next = p.v1[i + 1], wn = VC.v1Win(model, i), fps = p.fps || 30;
    var st = +live.start || 0, dur = +live.dur || 0, times = timesFor(st - wn.pre, st + dur + wn.post, fps), n = times.length;
    var wrap = {}, fill = {}, over = {}, overCss = null, layers = [];
    var sc = live.kind === "scene" ? (function () { try { return sceneOf(live); } catch (e) { return null; } })() : null;
    var anim = sc ? sc.els.map(function (e) { return !!((e.mo && e.mo.in && e.mo.in !== "none") || (e.kf && e.kf.length)); }) : [];
    times.forEach(function (t, k) {
      var lay = "", ov = null;
      if (prev && prev.trans && t < st + wn.pre) { var x = transCss(prev.trans.type, cl((t - (st - wn.pre)) / prev.trans.d, 0, 1)); lay = x.b; }
      else if (next && live.trans && t >= st + dur - wn.post) { var y = transCss(live.trans.type, cl((t - (st + dur - wn.post)) / live.trans.d, 0, 1)); lay = y.a; ov = y.over || null; }
      var lt = cl(t - st, 0, dur) * (live.speed || 1) + (live.in || 0);
      var ws = VC.cssParse(lay), fs = VC.cssParse(typeof fxCss === "function" ? fxCss(live, lt) : "");
      [[wrap, ws], [fill, fs]].forEach(function (pr) {
        var T = pr[0], s = pr[1];
        putTf(T, k, n, tfParse(s.transform || ""), false);
        if (s.opacity != null) (T.opacity = T.opacity || new Array(n))[k] = r3(+s.opacity);
        Object.keys(s).forEach(function (q) { if (q === "transform" || q === "opacity") return; var ck = camel(q); (T[ck] = T[ck] || new Array(n))[k] = s[q]; });
      });
      if (ov) { var os = VC.cssParse(ov); overCss = overCss || os; (over.opacity = over.opacity || new Array(n))[k] = r3(os.opacity != null ? +os.opacity : 1); }
      if (sc) sc.els.forEach(function (e, li) {
        if (!anim[li]) return;
        var h = typeof motionEl === "function" ? motionEl(e, lt, li, -1) : "", ss = styleOf(h); if (!ss) return;
        var L = layers[li] = layers[li] || {};
        putTf(L, k, n, tfParse(ss.transform || ""), false);
        (L.opacity = L.opacity || new Array(n))[k] = r3(ss.opacity != null ? +ss.opacity : 1);
        var bl = /blur\(\s*([\d.]+)px\)/.exec(ss.filter || ""); if (bl || L.filter) (L.filter = L.filter || new Array(n))[k] = "blur(" + (bl ? r2(+bl[1]) : 0) + "px)";
        if (ss["clip-path"] != null) (L.clipPath = L.clipPath || new Array(n))[k] = ss["clip-path"];
        if (ss.display === "none") (L.visibility = L.visibility || new Array(n))[k] = "hidden";
      });
    });
    var lines = [], id = b.id, t0 = st - wn.pre;
    /* el filtro del look queda en el HTML; si el efecto lo reemplaza (glow) va como pista */
    var look = env.lookCss(live.look, live.lookK);
    if (fill.filter) fill.filter = fill.filter.map(function (v) { return v == null ? (look || "none") : v; });
    fillMissing(wrap, n); fillMissing(fill, n); dropNeutral(wrap); dropNeutral(fill);
    if (fill.filter && fill.filter.every(function (v) { return v === (look || "none"); })) delete fill.filter;
    if (Object.keys(wrap).length) lines = lines.concat(VC.emitTracks("#" + id, times, wrap, t0));
    if (Object.keys(fill).length) lines = lines.concat(VC.emitTracks("#" + id + " > .fill", times, fill, t0));
    layers.forEach(function (L, li) { if (!L) return; fillMissing(L, n); dropNeutral(L); if (Object.keys(L).length) lines = lines.concat(VC.emitTracks("#" + id + "-l" + li, times, L, t0)); });
    if (overCss && over.opacity) {
      fillMissing(over, n);
      var os2 = Object.assign({}, overCss); delete os2.opacity; os2["z-index"] = "500";
      var ts = r3(st + dur - wn.post), td = r3(wn.post * 2);
      b.html += '\n<div id="' + id + '-tx" class="clip ovl" data-start="' + VC.fmtN(ts) + '" data-duration="' + VC.fmtN(td) + '" data-track-index="1" style="' + esc(VC.cssStr(Object.keys(os2).map(function (k) { return [k, os2[k]]; }))) + ';opacity:0"></div>';
      lines = lines.concat(VC.emitTracks("#" + id + "-tx", times, over, t0));
    }
    return VC.finishBlock(b, lines, VC.labelOf("v1", c));
  }

  /* bloques con caché por clip (solo se vuelve a muestrear lo que cambió) */
  var CACHE = {};
  function partnerKey(c, p) {
    var ids = [c.morphClip, c.matte].filter(Boolean), out = "";
    ids.forEach(function (id) { ["m", "t"].forEach(function (k) { (p[k] || []).forEach(function (x) { if (x.id === id) out += JSON.stringify(x); }); }); });
    ["m", "t"].forEach(function (k) { (p[k] || []).forEach(function (x) { if (x.morphClip === c.id || x.matte === c.id) out += JSON.stringify(x); }); });
    if (c.orb) out += "|ring:" + (p.m || []).filter(function (x) { return x.orb && x.orb.rid && c.orb && x.orb.rid === c.orb.rid; }).length;
    return out ? VC.hash(out) : "";
  }
  function blocksOf(p) {
    var model = modelOf(p), env = envOf(p), out = [], keepSel = VE.sel;
    env.model = model;
    VE.sel = null;
    try {
      var put = function (kind, c, i) {
        var extra = kind === "v1" ? JSON.stringify([VC.v1Win(model, i), model.v1[i - 1] && model.v1[i - 1].trans, c.trans && model.v1[i + 1] ? model.v1[i + 1].id : 0]) : partnerKey(c, p);
        var fpx = VC.clipFp(kind, c, model, extra), hit = CACHE[c.id];
        if (hit && hit.fpx === fpx) { out.push(hit.b); return; }
        var b;
        try { b = kind === "v1" ? blockV1(c, i, model, env, p) : kind === "a" ? VC.finishBlock(VC.staticBlock("a", c, model, env, i), [], VC.labelOf("a", c)) : blockTM(kind, c, model, env, p); }
        catch (e) { console.warn("[código] clip", c.id, e); b = VC.finishBlock(VC.staticBlock(kind, c, model, env, i), ["// no se pudo escribir el movimiento de este clip: vuelve igual desde data-musa"], VC.labelOf(kind, c)); }
        b.fp = VC.clipFp(kind, c, model);
        CACHE[c.id] = { fpx: fpx, b: b };
        out.push(b);
      };
      model.v1.forEach(function (c, i) { put("v1", c, i); });
      model.m.forEach(function (c, i) { put("m", c, i); });
      model.t.forEach(function (c, i) { put("t", c, i); });
      model.a.forEach(function (c, i) { put("a", c, i); });
    } finally { VE.sel = keepSel; }
    return { model: model, env: env, blocks: out };
  }
  function codeOf(p, fmt) {
    var R = blocksOf(p), html = VC.assemble(R.model, R.blocks, R.env), LN = p.lanes || {};
    /* pista oculta: sus clips siguen en el código, con data-hidden (HyperFrames tampoco los dibuja) */
    if (LN.m && LN.m.hide) html = html.replace(/<div class="clip" id="m-/g, '<div class="clip" data-hidden id="m-');
    if (LN.t && LN.t.hide) html = html.replace(/<div class="clip" id="t-/g, '<div class="clip" data-hidden id="t-');
    if (fmt === "remotion") return VC.toRemotion(html, { env: R.env });
    if (fmt === "json") return VC.toJson(R.model);
    return html;
  }
  RB().veCode = function (fmt) { return VE.p ? codeOf(VE.p, fmt || "html") : ""; };
  /* después de cada guardado: el código de los clips que cambiaron va a video_code_blocks (una fila por clip). El MCP
     (video_code_get) lo usa para devolver exactamente lo que se ve. Se escribe en segundo plano, sin frenar el editor. */
  var PUSHED = {}, NO_TABLE = false, warmT = null;
  RB().veAfterSaveCode = function (p) {
    if (NO_TABLE || !p || !p._real) return;
    clearTimeout(warmT);
    warmT = setTimeout(function () { var run = function () { if (VE.p === p) pushBlocks(p).catch(function () { /* se reintenta en el próximo guardado */ }); }; if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 4000 }); else run(); }, 1200);
  };
  function quoteIn(x) { return '"' + String(x).replace(/["\\]/g, "") + '"'; }
  function pushBlocks(p) {
    var R = p._real, pid = R.id, ws = RB().ws;
    /* la primera vez en esta sesión se lee qué hay guardado: solo se sube lo que cambió y se borra lo que ya no está */
    var known = PUSHED[pid] ? Promise.resolve(PUSHED[pid]) : api("/rest/v1/video_code_blocks?project_id=eq." + encodeURIComponent(pid) + "&select=clip_id,fp").then(function (r) { var m = {}; (r || []).forEach(function (x) { m[x.clip_id] = x.fp; }); return m; });
    var all = null;
    return known.then(function (mine) {
      if (VE.p !== p) return;
      all = blocksOf(p).blocks;
      var rows = [], live = {};
      all.forEach(function (b) { live[b.cid] = 1; if (mine[b.cid] !== b.fp) rows.push({ project_id: pid, clip_id: String(b.cid), workspace_id: ws, fp: b.fp, block: { html: b.html, js: b.js, pre: b.pre || [], eases: b.eases || [] }, updated_at: new Date().toISOString() }); });
      var gone = Object.keys(mine).filter(function (id) { return !live[id]; }), chain = Promise.resolve();
      for (var i = 0; i < rows.length; i += 40) (function (part) { chain = chain.then(function () { return api("/rest/v1/video_code_blocks", { method: "POST", headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(part), timeoutMs: 30000 }); }); })(rows.slice(i, i + 40));
      if (gone.length) chain = chain.then(function () { return api("/rest/v1/video_code_blocks?project_id=eq." + encodeURIComponent(pid) + "&clip_id=in.(" + gone.map(quoteIn).join(",") + ")", { method: "DELETE", headers: { Prefer: "return=representation" } }); });
      return chain.then(function () { var m = {}; all.forEach(function (b) { m[b.cid] = b.fp; }); PUSHED[pid] = m; return { up: rows.length, gone: gone.length }; });
    }).catch(function (e) {
      /* sin la tabla todavía (migración 43): el MCP escribe lo compuesto al abrir el editor; no se insiste */
      if (/video_code_blocks|42P01|PGRST205|does not exist|not found|404/i.test(String(e && e.message || e))) NO_TABLE = true;
      throw e;
    });
  }
  RB().veCodePush = function () { return VE.p && VE.p._real ? pushBlocks(VE.p) : Promise.resolve(); };

  /* ═════════════ código ajeno: sandbox con reloj virtual ═════════════ */
  /* corre dentro del iframe (sin acceso a Musa): congela el tiempo y lo avanza a mano, cuadro a cuadro */
  function preludeMain() {
    var RT = window.setTimeout.bind(window), T = 0, seq = 1, timers = [], rafs = [], start = Date.now(), firing = 0;
    window.__mvcClock = {
      realTimeout: RT, get t() { return T; },
      advance: function (to) {
        var guard = 0;
        for (;;) {
          timers.sort(function (a, b) { return a.at - b.at || a.id - b.id; });
          var x = timers[0]; if (!x || x.at > to + 1e-9 || ++guard > 5000) break;
          T = Math.max(T, x.at);
          if (x.every) x.at += x.every; else timers.shift();
          try { firing++; x.cb.apply(window, x.args); } catch (e) { /* el código del video falló en ese instante */ } finally { firing--; }
        }
        T = to;
        var q = rafs; rafs = [];
        q.forEach(function (r) { try { r.cb(T * 1000); } catch (e) { /* idem */ } });
      },
    };
    try { performance.now = function () { return T * 1000; }; } catch (e) { /* sin performance */ }
    Date.now = function () { return start + T * 1000; };
    window.requestAnimationFrame = function (cb) { var id = seq++; rafs.push({ id: id, cb: cb }); return id; };
    window.cancelAnimationFrame = function (id) { rafs = rafs.filter(function (x) { return x.id !== id; }); };
    window.setTimeout = function (cb, ms) { var id = seq++; if (typeof cb === "function") timers.push({ id: id, at: T + Math.max(0, +ms || 0) / 1000, cb: cb, args: [].slice.call(arguments, 2) }); return id; };
    window.setInterval = function (cb, ms) { var id = seq++; ms = Math.max(4, +ms || 0); if (typeof cb === "function") timers.push({ id: id, at: T + ms / 1000, cb: cb, every: ms / 1000, args: [] }); return id; };
    window.clearTimeout = window.clearInterval = function (id) { timers = timers.filter(function (x) { return x.id !== id; }); };
    window.__hyperframes = window.__hyperframes || { tracer: true, getVariables: function () { return {}; } };
    window.__timelines = window.__timelines || {};
    /* contratos de las skills de video: hf-seek (HyperFrames), __seek/__ready/__meta (onetake), __hf.buildReady */
    var HF = window.__mvcHF = { n: 0 }, ael = window.addEventListener;
    window.addEventListener = function (type) { if (type === "hf-seek") HF.n++; return ael.apply(this, arguments); };
    window.__hf = window.__hf || { buildReady: {} };
    window.__hfLottie = window.__hfLottie || []; window.__hfAnime = window.__hfAnime || [];
    window.__name = window.__name || function (f) { return f; };
    window.__musaNoLive = true;
    try { var gc0 = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type, attrs) { if (/webgl/i.test(String(type))) attrs = Object.assign({}, attrs || {}, { preserveDrawingBuffer: true }); return gc0.call(this, type, attrs); }; } catch (e) { /* sin canvas */ }
    window.addEventListener("error", function (e) { (window.__mvcErrors = window.__mvcErrors || []).push(String(e && e.message || e)); });
  }
  /* el muestreador: recorre el tiempo y anota, por elemento visible, centro, tamaño, escala, giro, opacidad y desenfoque */
  function samplerMain(cfg) {
    var clock = window.__mvcClock;
    function post(type, data) { parent.postMessage({ __mvc: cfg.token, type: type, data: data }, "*"); }
    function realWait(ms) { return new Promise(function (r) { clock.realTimeout(r, ms); }); }
    var INLINE = /^(SPAN|B|I|EM|STRONG|SMALL|A|BR|SUP|SUB|MARK|CODE|U|S|LABEL|ABBR|TIME|Q|WBR|FONT)$/;
    var SKIP = /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT|META|LINK|HEAD|TITLE|SOURCE|TRACK|DEFS|BR|WBR|IFRAME)$/;
    function lines(el) {
      var out = [], tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), node, rg = document.createRange();
      while ((node = tw.nextNode())) {
        var s = node.textContent, re = /\S+/g, m;
        while ((m = re.exec(s))) {
          rg.setStart(node, m.index); rg.setEnd(node, m.index + m[0].length);
          var rs = rg.getClientRects(); if (!rs.length) continue;
          var r = rs[0], L = out[out.length - 1];
          if (!L || r.top > L.bottom - r.height * 0.4) out.push(L = { words: [], bottom: r.bottom });
          L.words.push(m[0]); L.bottom = Math.max(L.bottom, r.bottom);
        }
      }
      return out.map(function (l) { return l.words.join(" "); }).join("\n");
    }
    function textish(el) {
      var has = false; for (var k = el.firstChild; k; k = k.nextSibling) if (k.nodeType === 3 && k.textContent.trim()) { has = true; break; }
      if (!has) return false;
      return [].every.call(el.children, function (c) { return INLINE.test(c.tagName); });
    }
    function hasBox(cs) { var bg = cs.backgroundColor, a = /rgba\(.*,\s*([\d.]+)\)/.exec(bg); return (bg && bg !== "transparent" && !(a && +a[1] === 0)) || (cs.backgroundImage && cs.backgroundImage !== "none"); }
    function bgOf(cs) { var img = cs.backgroundImage && cs.backgroundImage !== "none" ? cs.backgroundImage : ""; var col = cs.backgroundColor; var a = /rgba\(.*,\s*([\d.]+)\)/.exec(col); if (a && +a[1] === 0) col = ""; if (img && /url\(/.test(img)) return img.replace(/^url\(["']?/, "url('").replace(/["']?\)$/, "')") + " center/" + (cs.backgroundSize === "contain" ? "contain" : "cover") + " no-repeat"; return img ? (col ? img + "," + col : img) : col; }
    function svgStr(svg) {
      var c = svg.cloneNode(true), src = [svg].concat([].slice.call(svg.querySelectorAll("*"))), dst = [c].concat([].slice.call(c.querySelectorAll("*")));
      src.forEach(function (n, i) { var d = dst[i]; if (!d || !d.setAttribute) return; var cs = getComputedStyle(n); ["fill", "stroke", "stroke-width", "opacity", "fill-opacity", "stroke-opacity"].forEach(function (p) { var v = cs.getPropertyValue(p); if (v && !d.getAttribute(p)) d.setAttribute(p, v); }); });
      var r = svg.getBoundingClientRect();
      if (!c.getAttribute("viewBox")) c.setAttribute("viewBox", "0 0 " + Math.round(svg.clientWidth || r.width) + " " + Math.round(svg.clientHeight || r.height));
      c.setAttribute("xmlns", "http://www.w3.org/2000/svg"); c.removeAttribute("style"); c.removeAttribute("class");
      return new XMLSerializer().serializeToString(c);
    }
    function chain(el, root) {
      var a = 1, b = 0, c = 0, d = 1, o = 1, bl = 0, list = [];
      for (var n = el; n && n.nodeType === 1 && n !== root; n = n.parentElement) list.push(n);
      for (var i = list.length - 1; i >= 0; i--) {
        var cs = getComputedStyle(list[i]);
        o *= +cs.opacity; if (cs.visibility === "hidden" || cs.display === "none") o = 0;
        var m = /blur\(([\d.]+)px\)/.exec(cs.filter || ""); if (m) bl += +m[1];
        if (cs.transform && cs.transform !== "none") { try { var M = new DOMMatrix(cs.transform); var na = a * M.a + c * M.b, nb = b * M.a + d * M.b, nc = a * M.c + c * M.d, nd = b * M.c + d * M.d; a = na; b = nb; c = nc; d = nd; } catch (e) { /* transform raro */ } }
      }
      return { s: Math.sqrt(Math.abs(a * d - b * c)) || 0, r: Math.atan2(b, a) * 180 / Math.PI, o: o, b: bl };
    }
    var recs = [], byEl = new Map(), media = new Map(), animFirst = new Map(), warnings = [];
    async function run() {
      try {
        if (window.__mvcBoot) await window.__mvcBoot();
        if (document.readyState !== "complete") await Promise.race([new Promise(function (r) { window.addEventListener("load", function () { r(); }, { once: true }); }), realWait(20000)]);
        await realWait(60);
        var br0 = window.__hf && window.__hf.buildReady;
        if (br0 && Object.keys(br0).length) await Promise.race([Promise.all(Object.keys(br0).map(function (k) { return br0[k]; })), realWait(25000)]);
        if (window.__ready && typeof window.__ready.then === "function") await Promise.race([window.__ready, realWait(25000)]);
        if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, realWait(4000)]);
        await Promise.race([Promise.all([].map.call(document.images, function (im) { return im.complete ? 0 : new Promise(function (r) { im.onload = im.onerror = r; }); })), realWait(5000)]);
        clock.advance(0);
        var root = window.__mvcRoot || document.querySelector("[data-composition-id]") || document.body;
        var W = +root.getAttribute("data-width") || cfg.W, H = +root.getAttribute("data-height") || cfg.H;
        var meta = window.__meta && typeof window.__meta === "object" ? window.__meta : {};
        if (!root.getAttribute("data-width") && +meta.w > 0) { W = +meta.w; H = +meta.h || H; }
        var fps = +root.getAttribute("data-fps") || +meta.fps || cfg.fps || 30, dur = +root.getAttribute("data-duration") || +meta.dur || cfg.dur || 0;
        var tls = window.__timelines || {}, tlKeys = Object.keys(tls).filter(function (k) { return tls[k] && typeof tls[k].duration === "function"; });
        if (!dur) tlKeys.forEach(function (k) { dur = Math.max(dur, tls[k].duration()); });
        if (!dur && window.gsap && gsap.globalTimeline) { try { dur = Math.max(dur, gsap.globalTimeline.duration()); } catch (e) { /* sin GSAP */ } }
        if (!dur && document.getAnimations) document.getAnimations().forEach(function (an) { try { var tm = an.effect.getComputedTiming(); if (isFinite(tm.endTime)) dur = Math.max(dur, tm.endTime / 1000); } catch (e) { /* animación sin efecto */ } });
        if (!dur) dur = 10;
        dur = Math.min(dur, cfg.maxDur || 180);
        if (dur > 30 && fps > 15) fps = 15;
        if (window.gsap && gsap.ticker && gsap.ticker.lagSmoothing) gsap.ticker.lagSmoothing(0);
        var hosts = {}; tlKeys.forEach(function (k) { var h = document.querySelector('[data-composition-id="' + k + '"]'); hosts[k] = h && h !== root ? +h.getAttribute("data-start") || 0 : 0; });
        var rootCs = getComputedStyle(root), bg = bgOf(rootCs) || bgOf(getComputedStyle(document.body)) || "#000000";
        var N = Math.ceil(dur * fps), timed = [].slice.call(root.querySelectorAll("[data-start]"));
        for (var i = 0; i < N; i++) {
          var t = i / fps;
          if (window.__mvcStep) { var stp = window.__mvcStep(t, i, fps); if (stp && typeof stp.then === "function") await stp; }
          else {
            clock.advance(t);
            tlKeys.forEach(function (k) { try { tls[k].seek(Math.max(0, t - hosts[k]), true); } catch (e) { /* timeline roto */ } });
            /* onetake: window.__seek(t) dibuja el cuadro; HyperFrames: el evento hf-seek (con waitUntil) */
            var ws = [];
            if (typeof window.__seek === "function") { try { var sr = window.__seek(t); if (sr && typeof sr.then === "function") ws.push(sr); } catch (e) { /* el seek falló */ } }
            if (window.__mvcHF && window.__mvcHF.n) { try { window.dispatchEvent(new CustomEvent("hf-seek", { detail: { time: t, waitUntil: function (p) { ws.push(p); } } })); } catch (e) { /* idem */ } }
            (window.__hfLottie || []).forEach(function (a) { try { if (a.goToAndStop) a.goToAndStop(t * 1000, false); else if (a.setFrame) a.setFrame(t * (a.frameRate || fps)); } catch (e) { /* idem */ } });
            (window.__hfAnime || []).forEach(function (a) { try { a.seek(t * 1000); } catch (e) { /* idem */ } });
            if (ws.length) await Promise.race([Promise.all(ws), realWait(8000)]);
          }
          if (document.getAnimations) document.getAnimations().forEach(function (an) { try { if (!animFirst.has(an)) animFirst.set(an, t); an.pause(); an.currentTime = (t - animFirst.get(an)) * 1000; } catch (e) { /* animación sin tiempo */ } });
          timed.forEach(function (el) { if (el === root) return; var s = +el.getAttribute("data-start") || 0, d = +el.getAttribute("data-duration"); if (!isFinite(d) || d <= 0) d = 1e9; el.style.visibility = t >= s && t < s + d ? "" : "hidden"; });
          sample(root, t, W, H);
          if (i % 15 === 0) { post("progress", { i: i, n: N }); await realWait(0); }
        }
        var els = recs.map(function (r) { return r.out; }).filter(function (o) { return o.samples.length || o.kind === "audio" || o.kind === "video"; });
        media.forEach(function (m) { els.push(m); });
        post("done", { W: W, H: H, fps: fps, dur: Math.round(dur * 1000) / 1000, bg: bg, els: els, warnings: warnings.concat((window.__mvcErrors || []).slice(0, 3).map(function (e) { return "Error del código: " + e; })) });
      } catch (e) { post("error", String(e && e.stack || e)); }
    }
    function sample(root, t, W, H) {
      var R = root.getBoundingClientRect(), kx = R.width ? W / R.width : 1, ky = R.height ? H / R.height : 1;
      var all = root.querySelectorAll("*"), skipUnder = [];
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (SKIP.test(el.tagName)) continue;
        if (skipUnder.some(function (p) { return p !== el && p.contains(el); })) continue;
        var tag = el.tagName;
        if (el.ownerSVGElement) continue;
        if (tag === "VIDEO" || tag === "AUDIO") { noteMedia(el, t); if (tag === "AUDIO") continue; skipUnder.push(el); continue; }
        var cs = getComputedStyle(el);
        var rec = byEl.get(el);
        if (!rec) {
          var kind = null;
          if (tag === "IMG") kind = "img"; else if (tag === "svg" || tag === "SVG") kind = "svg"; else if (tag === "CANVAS") kind = "canvas";
          else if (textish(el)) kind = "t"; else if (hasBox(cs)) kind = "m";
          if (!kind) continue;
          rec = { kind: kind, out: { key: recs.length, kind: kind === "canvas" ? "live" : kind, samples: [] } };
          if (kind === "t" && hasBox(cs)) { var bx = { kind: "m", out: { key: recs.length + 0.5, kind: "m", samples: [], name: "Fondo de texto" }, el: el, box: true }; recs.push(bx); rec.twin = bx; }
          byEl.set(el, rec); recs.push(rec);
        }
        if (rec.kind === "t" || rec.kind === "svg" || rec.kind === "img" || rec.kind === "canvas") skipUnder.push(el);
        var vis = cs.display !== "none";
        var put = function (r, extra) {
          if (!vis) return;
          var rc = el.getBoundingClientRect(), ch = chain(el, root);
          var cx = (rc.left + rc.width / 2 - R.left) * kx, cy = (rc.top + rc.height / 2 - R.top) * ky;
          var ow = el.offsetWidth || el.clientWidth || rc.width * kx / (ch.s || 1), oh = el.offsetHeight || el.clientHeight || rc.height * ky / (ch.s || 1);
          var on = ch.o > 0.002 && rc.right > R.left && rc.left < R.right && rc.bottom > R.top && rc.top < R.bottom;
          if (!on) return;
          r.out.samples.push([Math.round(t * 1000) / 1000, Math.round(cx * 100) / 100, Math.round(cy * 100) / 100, Math.round(ow * 100) / 100, Math.round(oh * 100) / 100, Math.round(ch.s * 10000) / 10000, Math.round(ch.r * 100) / 100, Math.round(ch.o * 1000) / 1000, Math.round(ch.b * 100) / 100, 1]);
          /* un texto que se escribe de a poco: se queda con su versión más larga */
          if (!r.out.style || (r.kind === "t" && !extra && (el.textContent || "").length > (r.tlen || 0))) { r.tlen = (el.textContent || "").length; describe(r, el, cs, extra); }
        };
        put(rec, false);
        if (rec.twin) put(rec.twin, true);
      }
    }
    function describe(r, el, cs, isBox) {
      var st = {}, o = r.out;
      if (r.kind === "t" && !isBox) {
        var tt = cs.textTransform, tx = lines(el) || el.innerText || el.textContent || "";
        if (tt === "uppercase") tx = tx.toUpperCase(); else if (tt === "lowercase") tx = tx.toLowerCase();
        o.text = tx; st.fontFamily = cs.fontFamily; st.fontSize = parseFloat(cs.fontSize); st.fontWeight = cs.fontWeight; st.color = cs.color;
        st.ls = cs.letterSpacing === "normal" ? 0 : parseFloat(cs.letterSpacing) || 0; st.italic = /italic|oblique/.test(cs.fontStyle);
      } else {
        var br = cs.borderTopLeftRadius || "0px", w = el.offsetWidth || 1, h = el.offsetHeight || 1;
        st.radius = /%$/.test(br) ? Math.min(w, h) * parseFloat(br) / 100 : parseFloat(br) || 0;
        st.circle = Math.abs(w - h) < 2 && st.radius >= Math.min(w, h) / 2 - 0.5;
        if (r.kind === "img") { o.src = el.currentSrc || el.src; st.fit = cs.objectFit; o.name = (el.alt || o.src.split("/").pop() || "Imagen").slice(0, 40); }
        else if (r.kind === "canvas") {
          /* el índice del canvas en la página (sin los paneles de lil-gui / stats): el clip vivo dibuja ese mismo */
          var cvs = [].slice.call(document.querySelectorAll("canvas")).filter(function (c) { return !(c.closest && c.closest(".lil-gui,.dg,#stats,.stats")); });
          o.sel = cvs.indexOf(el); o.cw = el.width; o.ch = el.height;
          var own = el.getAttribute("data-musa-live"), sc = el.classList && el.classList.contains("musa-live") && el.parentNode ? el.parentNode.querySelector('script[type="text/musa-live"]') : null;
          if (own) { try { o.own = JSON.parse(own); } catch (e) { /* sin datos propios */ } }
          else if (sc) o.own = { src: sc.textContent, esc: 1, kind: el.getAttribute("data-kind") || "html" };
          o.name = el.getAttribute("aria-label") || el.id || "Código 3D";
        }
        else if (r.kind === "svg") { o.svg = svgStr(el); o.name = el.getAttribute("aria-label") || "Vector"; }
        else { st.bg = bgOf(cs); o.name = o.name || (el.id || el.className && String(el.className).split(" ")[0] || "Forma"); }
      }
      o.style = st;
    }
    function noteMedia(el, t) {
      var m = media.get(el), visible = el.tagName === "AUDIO" || (getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none");
      if (!m) {
        m = { kind: el.tagName === "AUDIO" ? "audio" : "video", src: el.currentSrc || el.src || (el.querySelector("source") || {}).src || "", name: (el.getAttribute("data-name") || el.id || (el.tagName === "AUDIO" ? "Audio" : "Video")), full: true, start: null, last: null,
          mediaStart: +el.getAttribute("data-media-start") || (+el.getAttribute("data-start-from") || 0), rate: +el.getAttribute("data-playback-rate") || +el.playbackRate || 1, volume: el.hasAttribute("data-volume") ? +el.getAttribute("data-volume") : 1, muted: el.muted || el.hasAttribute("muted") };
        var ds = el.getAttribute("data-start"), dd = el.getAttribute("data-duration");
        if (ds != null && dd != null && !el.hasAttribute("data-mvc-remotion")) { m.start = +ds; m.dur = +dd; m.fixed = true; }
        media.set(el, m);
      }
      if (!m.fixed && visible) { if (m.start == null) m.start = t; m.last = t; m.dur = Math.round((m.last - m.start + 1 / (cfg.fps || 30)) * 1000) / 1000; }
    }
    run();
  }
  /* Remotion dentro del sandbox: React + Babel + una versión mínima de «remotion» (frames, Sequence, interpolate, spring…) */
  /* Remotion dentro del sandbox (con @remotion/three y React Three Fiber): vive en video-live-core.js para que el HTML
     exportado también pueda reproducir los clips 3D fuera de Musa */
  var ML = window.MusaVideoLive;
  var remotionMain = ML.remotionMain, LIBS_REMOTION = ML.LIBS_REMOTION;
  function sandboxDoc(src, kind, cfg) {
    var pre = "<script>(" + preludeMain.toString() + ")();<\/script>";
    var samp = "<script>(" + samplerMain.toString() + ")(" + JSON.stringify(cfg) + ");<\/script>";
    if (kind === "remotion") {
      var im = cfg.r3 ? '<script type="importmap">' + JSON.stringify({ imports: ML.R3_IMPORTS }) + "<\/script>" : "";
      return "<!doctype html><html><head><meta charset=\"utf-8\">" + pre + im + LIBS_REMOTION.map(function (u) { return '<script src="' + u + '"><\/script>'; }).join("")
        + "<style>html,body{margin:0;background:#000;overflow:hidden}#mvc-root{position:relative;overflow:hidden}</style></head><body><div id=\"mvc-root\"></div>"
        + "<script>window.__mvcSource = " + JSON.stringify(src).replace(/<\/script/gi, "<\\/script") + ";(" + remotionMain.toString() + ")(" + JSON.stringify(cfg) + ");<\/script>" + samp + "</body></html>";
    }
    var s = ML.prep(String(src)), m = /<head[^>]*>/i.exec(s);
    if (!/<html|<body|<head/i.test(s)) s = "<!doctype html><html><head><meta charset=\"utf-8\"></head><body style=\"margin:0\">" + s + "</body></html>";
    m = /<head[^>]*>/i.exec(s);
    s = m ? s.slice(0, m.index + m[0].length) + pre + s.slice(m.index + m[0].length) : pre + s;
    var be = s.search(/<\/body\s*>/i);
    return be >= 0 ? s.slice(0, be) + samp + s.slice(be) : s + samp;
  }
  function guessSize(src, kind) {
    var w = /data-width\s*=\s*["']?(\d{2,5})/.exec(src), hh = /data-height\s*=\s*["']?(\d{2,5})/.exec(src);
    var mt = /__meta\s*=\s*\{([^}]*)\}/.exec(src);
    if (mt && !w) { w = /\bw\s*:\s*(\d{2,5})/.exec(mt[1]); hh = /\bh\s*:\s*(\d{2,5})/.exec(mt[1]); }
    if (kind === "remotion") { w = /width\s*[=:]\s*\{?\s*(\d{2,5})/.exec(src); hh = /height\s*[=:]\s*\{?\s*(\d{2,5})/.exec(src); }
    var fps = /(?:data-fps\s*=\s*["']?|fps\s*[=:]\s*\{?\s*)(\d{1,3})/.exec(src), dF = /durationInFrames\s*[=:]\s*\{?\s*(\d{1,6})/.exec(src), dS = /data-duration\s*=\s*["']?([\d.]+)/.exec(src);
    var f = fps ? +fps[1] : 30;
    var cur = VE.p ? WH(VE.p) : [1920, 1080];
    return { W: w ? +w[1] : (kind === "remotion" ? 1920 : cur[0]), H: hh ? +hh[1] : (kind === "remotion" ? 1080 : cur[1]), fps: f, dur: dS ? +dS[1] : dF ? +dF[1] / f : 0 };
  }
  /* corre el código en el sandbox y devuelve lo que se vio, cuadro a cuadro */
  function trace(src, kind, onProg) {
    return new Promise(function (resolve, reject) {
      var g = guessSize(src, kind), token = "mvc" + Math.random().toString(36).slice(2);
      var cfg = { token: token, W: g.W, H: g.H, fps: g.fps, dur: g.dur, maxDur: 180, r3: kind === "remotion" && ML.usesR3({ kind: kind, src: src }) };
      var fr = document.createElement("iframe");
      fr.setAttribute("sandbox", "allow-scripts");
      fr.setAttribute("aria-hidden", "true"); fr.tabIndex = -1;
      fr.style.cssText = "position:fixed;left:-30000px;top:0;width:" + g.W + "px;height:" + g.H + "px;border:0;opacity:0;pointer-events:none";
      var done = false, timer = setTimeout(function () { finish(new Error("el código tardó demasiado (más de 3 min)")); }, 180000);
      function finish(err, data) { if (done) return; done = true; clearTimeout(timer); window.removeEventListener("message", on); try { fr.remove(); } catch (e) { /* ya no está */ } if (err) reject(err); else resolve(data); }
      function on(e) {
        var d = e.data; if (!d || d.__mvc !== token || e.source !== fr.contentWindow) return;
        if (d.type === "progress" && onProg) onProg(d.data.i / Math.max(1, d.data.n));
        else if (d.type === "done") finish(null, d.data);
        else if (d.type === "error") finish(new Error(String(d.data).split("\n")[0]));
      }
      window.addEventListener("message", on);
      fr.srcdoc = sandboxDoc(src, kind, cfg);
      document.body.appendChild(fr);
    });
  }
  /* lo que salió del sandbox → clips: los vectores se limpian y las imágenes sin URL pública se avisan */
  function traceToModel(tr, name, src, kind) {
    var r = VC.fromTrace(Object.assign({ name: name }, tr));
    r.model.m.forEach(function (c) {
      if (!c.live) return;
      var L = c.live, own = L.own; delete L.own;
      if (own && own.src) {
        /* un clip vivo que ya venía de Musa (o de un <MusaLive>): trae su propio código y sus ajustes */
        var o2 = Object.assign({}, own); var code = o2.esc ? ML.unescScript(String(o2.src)).replace(/^\r?\n/, "").replace(/\r?\n$/, "") : String(o2.src); delete o2.esc; delete o2.src;
        c.live = Object.assign({ sel: -1, off: 0, speed: 1 }, o2, { src: code, kind: o2.kind || "html" });
        if (!(+c.live.W > 0)) { c.live.W = L.cw || L.W; c.live.H = L.ch || L.H; }
      } else {
        /* el canvas de la composición: corre la composición entera y se queda con ese canvas */
        c.live = { src: String(src || ""), kind: kind === "remotion" ? "remotion" : "html", sel: L.sel, off: L.off || 0, speed: 1, W: L.W, H: L.H, fps: L.fps };
      }
      c.name = c.name && c.name !== "Código 3D" ? c.name : (ML.LIB_NAMES[ML.libOf(c.live.src)] || "Código") + " · " + (c.name || "lienzo");
    });
    r.model.m.forEach(function (c) { if (c.svg && P.sanitizeSvg) { var s = P.sanitizeSvg(c.svg); if (s) c.svg = s; else { delete c.svg; c.bg = "#ffffff33"; } } });
    var miss = 0; r.model.m.forEach(function (c) { var u = (String(c.bg || "").match(/url\('([^']+)'\)/) || [])[1]; if (u && !/^(https?:|data:)/.test(u)) miss++; });
    if (miss) r.warnings.push(miss + " imagen(es) con ruta relativa: súbelas a Musa y usa su URL");
    return r;
  }

  /* ═════════════ código → modelo (cualquier formato) ═════════════ */
  function motionSpecToModel(spec) {
    var cv = spec.canvas || {}, W = +cv.width || 1080, H = +cv.height || 1920, m = { name: spec.name || "Video", W: W, H: H, fps: +cv.fps || 30, pad: cv.backgroundColor || "#000000", total: +cv.durationMs > 0 ? cv.durationMs / 1000 : null, v1: [], m: [], t: [], a: [] };
    var kfs = spec.keyframes || [], ap = RB().veMotionApply;
    (spec.nodes || []).forEach(function (n, i) {
      var st = (+n.startMs || 0) / 1000, du = Math.max(0.05, ((+n.endMs || 0) - (+n.startMs || 0)) / 1000), pl = { nodeKind: n.kind, props: n.props || {}, keyframes: kfs.filter(function (k) { return k.nodeId === n.id; }) };
      var asset = (spec.assets || []).find(function (a) { return a.id === n.assetId; });
      if (n.kind === "text") { var c = cap(String(n.text || ""), st, du, { anim: "none" }); c.id = "s" + i + VC.hash(n.id).slice(0, 4); if (ap) ap(c, pl, "t", W, H, W, H); m.t.push(c); }
      else if (n.kind === "audio" && asset) m.a.push({ id: "s" + i, name: n.name || "Audio", start: st, dur: du, vol: 1, fin: 0, fout: 0, url: asset.url });
      else if (n.kind === "video" && asset) m.v1.push({ id: "s" + i, kind: "take", takeUrl: asset.url, name: n.name || "Video", dur: du, in: 0, speed: 1, vol: 1, look: "none", lookK: 1, fx: "none", ovl: "none", trans: null });
      else { var u = asset && asset.url, c2 = { id: "s" + i + VC.hash(n.id).slice(0, 4), name: n.name || "Media", start: st, dur: du, x: 50, y: 50, w: 40, ar: 1, radius: 0, bg: u ? "url('" + u + "') center/cover no-repeat" : "#ffffff", anim: "none" }; if (ap) ap(c2, pl, "m", W, H, W, H); m.m.push(c2); }
    });
    return { model: m, warnings: [] };
  }
  function toModel(src, onProg) {
    var kind = VC.detect(src);
    if (kind === "musa-html") return Promise.resolve().then(function () {
      var env = VE.p ? envOf(VE.p) : envOf({ fmt: "9:16" });
      var r = VC.fromMusaHtml(src, { env: env });
      /* llamadas que solo se pueden leer ejecutando el código: se completa con el sandbox */
      if (r.unresolved) return trace(src, "html", onProg).then(function (tr) { var t2 = traceToModel(tr, r.model.name, src, "html"); r.warnings.push("Parte del movimiento venía de código que hay que ejecutar: esos clips se leyeron del render"); return mergeTraced(r, t2); });
      return r;
    }).then(function (r) { r.kind = kind; return r; });
    if (kind === "musa-json") return Promise.resolve(Object.assign(VC.fromJson(src), { kind: kind }));
    if (kind === "motion-spec") return Promise.resolve(Object.assign(motionSpecToModel(JSON.parse(src)), { kind: kind }));
    /* JS suelto que dibuja en un canvas (Three.js, p5, WebGL…): se envuelve en una página y entra como clip vivo */
    if (kind === "unknown" && ML.isCanvasCode(src)) { src = ML.prep(src); kind = "html"; }
    if (kind === "html" || kind === "remotion") return trace(src, kind, onProg).then(function (tr) { var nm = (/<title>([^<]{1,80})<\/title>/i.exec(src) || [])[1] || (kind === "remotion" ? "Video Remotion" : "Video desde código"); return Object.assign(traceToModel(tr, nm, src, kind), { kind: kind }); });
    if (kind === "lottie") return Promise.reject(new Error("Lottie: impórtalo con la herramienta MCP motion_source_convert o como animación de un diseño"));
    return Promise.reject(new Error("No reconozco este código. Pega HTML (HyperFrames, GSAP, CSS), Remotion (TSX/JSX) o el JSON de Musa."));
  }
  /* código de Musa con partes que hubo que ejecutar: los clips intactos vienen exactos, el resto del render */
  function mergeTraced(r, t2) {
    var keep = r.model, tr = t2.model;
    ["t", "m"].forEach(function (k) {
      keep[k].forEach(function (c) {
        if (!c.kf || c.kf.length < 2 || c.anim !== "none") return;
        var cand = tr[k].find(function (x) { return Math.abs(x.start - c.start) < 0.05 && Math.abs(x.x - c.x) < 3 && Math.abs(x.y - c.y) < 3; });
        if (cand && cand.kf) c.kf = cand.kf;
      });
    });
    return r;
  }

  /* ═════════════ panel «Código» ═════════════ */
  var CS = { open: false, fmt: "html", dirty: false, sig: "", applying: false, focused: false, auto: null, lastSel: null };
  var css = document.createElement("style");
  css.textContent = [
    "#veCode{position:fixed;right:0;z-index:60;display:flex;flex-direction:column;background:#141412;border-left:1px solid #2a2a26;box-shadow:-12px 0 40px rgba(0,0,0,.45);font:13px Inter,system-ui,sans-serif;color:#e8e6df}",
    "#veCode[hidden]{display:none}",
    "#veCode .vc-h{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid #2a2a26;flex-wrap:wrap}",
    "#veCode .vc-h b{font-weight:700;margin-right:4px;white-space:nowrap}",
    "#veCode .vc-seg{display:inline-flex;border:1px solid #34342f;border-radius:7px;overflow:hidden}",
    "#veCode .vc-seg button{background:transparent;border:0;color:#bdbab0;padding:5px 9px;font:600 12px Inter,sans-serif;cursor:pointer}",
    "#veCode .vc-seg button[aria-pressed=true]{background:#ff5e00;color:#141412}",
    "#veCode .vc-b{background:#22221f;border:1px solid #34342f;color:#e8e6df;border-radius:7px;padding:5px 9px;font:600 12px Inter,sans-serif;cursor:pointer;white-space:nowrap}",
    "#veCode .vc-b:hover{border-color:#ff5e00}",
    "#veCode .vc-b.p{background:#ff5e00;border-color:#ff5e00;color:#141412}",
    "#veCode .vc-x{margin-left:auto;background:transparent;border:0;color:#9a978c;font-size:18px;cursor:pointer;padding:2px 6px}",
    "#veCode .vc-ed{position:relative;flex:1;min-height:0;display:flex}",
    "#veCode .vc-gut{width:44px;flex:none;overflow:hidden;background:#11110f;color:#55534c;text-align:right;padding:10px 6px 10px 0;box-sizing:border-box;font:12px/1.55 'JetBrains Mono',ui-monospace,Menlo,monospace;user-select:none;white-space:pre}",
    "#veCode .vc-wrap{position:relative;flex:1;min-width:0}",
    "#veCode pre.vc-hl,#veCode textarea{position:absolute;inset:0;margin:0;padding:10px 12px;box-sizing:border-box;font:12px/1.55 'JetBrains Mono',ui-monospace,Menlo,monospace;white-space:pre;overflow:auto;tab-size:2;border:0}",
    "#veCode pre.vc-hl{pointer-events:none;color:#d8d5cb;background:#141412}",
    "#veCode textarea{background:transparent;color:transparent;caret-color:#ff5e00;resize:none;outline:none}",
    "#veCode textarea::selection{background:rgba(255,94,0,.35);color:transparent}",
    "#veCode .k{color:#ff9d5c}#veCode .s{color:#c3e88d}#veCode .n{color:#82aaff}#veCode .c{color:#6b6960;font-style:italic}#veCode .a{color:#ffcb6b}#veCode .g{color:#c792ea}",
    "#veCode .vc-st{padding:6px 10px;border-top:1px solid #2a2a26;color:#9a978c;font-size:12px;display:flex;gap:10px;align-items:center;min-height:18px}",
    "#veCode .vc-st i{width:8px;height:8px;border-radius:50%;background:#5bd16b;flex:none}",
    "#veCode .vc-st i.d{background:#ffb347}#veCode .vc-st i.e{background:#ff5c5c}",
    "#veCode .vc-pg{height:3px;background:#2a2a26}#veCode .vc-pg>i{display:block;height:100%;width:0;background:#ff5e00;transition:width .2s}",
    ".vc-dlg{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:grid;place-items:center;padding:16px}",
    ".vc-dlg .bx{background:#fff;color:#1d1d1b;border-radius:14px;max-width:760px;width:100%;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.4);font:14px Inter,system-ui,sans-serif}",
    ".vc-dlg h3{margin:0;padding:16px 18px 6px;font-size:17px}.vc-dlg p{margin:0 18px 10px;color:#5b5a55;line-height:1.45}",
    ".vc-dlg textarea{margin:0 18px;min-height:260px;flex:1;border:1px solid #d9d6cc;border-radius:10px;padding:10px;font:12px/1.5 'JetBrains Mono',ui-monospace,monospace;resize:vertical}",
    ".vc-dlg .row{display:flex;gap:8px;align-items:center;padding:12px 18px 16px;flex-wrap:wrap}.vc-dlg .row .sp{flex:1}",
    ".vc-dlg input[type=text]{border:1px solid #d9d6cc;border-radius:8px;padding:7px 9px;font:inherit;min-width:200px}",
    ".vc-dlg button{border:1px solid #d9d6cc;background:#fff;border-radius:9px;padding:8px 14px;font:600 13px Inter,sans-serif;cursor:pointer}.vc-dlg button.p{background:#ff5e00;border-color:#ff5e00;color:#fff}",
    ".vc-dlg .err{color:#c0392b;margin:0 18px;font-size:13px;min-height:18px}",
  ].join("\n");
  document.head.appendChild(css);
  var panel = document.createElement("div");
  panel.id = "veCode"; panel.hidden = true; panel.setAttribute("role", "region"); panel.setAttribute("aria-label", "Código del video");
  panel.innerHTML = '<div class="vc-h"><b>Código</b><span class="vc-seg" role="group" aria-label="Formato"><button data-vcf="html" aria-pressed="true" title="HTML + GSAP: se reproduce en el navegador y se renderiza con HyperFrames">HTML · GSAP</button><button data-vcf="remotion" aria-pressed="false" title="Remotion (React/TSX)">Remotion</button><button data-vcf="json" aria-pressed="false" title="El estado del editor tal cual">JSON</button></span>'
    + '<button class="vc-b p" data-vca="apply" title="Aplica el código al video (Ctrl+Enter)">Aplicar</button><button class="vc-b" data-vca="copy">Copiar</button><button class="vc-b" data-vca="dl">Descargar</button><button class="vc-b" data-vca="open" title="Abrir un archivo .html, .tsx, .jsx o .json">Abrir archivo</button><button class="vc-b" data-vca="sync" title="Volver a escribir el código desde el video (descarta lo no aplicado)">Desde el video</button>'
    + '<button class="vc-x" data-vca="close" aria-label="Cerrar el código">×</button></div><div class="vc-pg" hidden><i></i></div>'
    + '<div class="vc-ed"><div class="vc-gut" aria-hidden="true"></div><div class="vc-wrap"><pre class="vc-hl" aria-hidden="true"></pre><textarea spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Código del video (editable)"></textarea></div></div>'
    + '<div class="vc-st" role="status"><i></i><span>Listo</span></div>';
  document.body.appendChild(panel);
  var ta = panel.querySelector("textarea"), hl = panel.querySelector(".vc-hl"), gut = panel.querySelector(".vc-gut"), stEl = panel.querySelector(".vc-st span"), dot = panel.querySelector(".vc-st i"), pg = panel.querySelector(".vc-pg");
  function status(msg, kind) { stEl.textContent = msg; dot.className = kind || ""; }
  function prog(f) { if (f == null) { pg.hidden = true; return; } pg.hidden = false; pg.firstChild.style.width = Math.round(cl(f, 0, 1) * 100) + "%"; }
  function place() {
    var top = vq(".ed-tr") || document.querySelector("#ve .ed-tr"), tl = vq(".ve-tlbar") || vq("#veLanes");
    var t0 = top ? top.getBoundingClientRect().bottom : 48, b0 = tl ? tl.getBoundingClientRect().top : innerHeight * 0.6;
    if (b0 - t0 < 260) b0 = innerHeight - 8;
    panel.style.top = t0 + "px"; panel.style.height = Math.max(240, b0 - t0) + "px"; panel.style.width = Math.min(860, Math.max(380, innerWidth * 0.46)) + "px";
  }
  /* coloreado simple (HTML, JS/TSX, JSON) */
  function highlight(src) {
    var out = "", re = /(<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(<\/?[a-zA-Z][\w-]*|\/?>)|(\b(?:const|let|var|function|return|import|from|export|default|new|if|else|true|false|null)\b)|(\b-?\d*\.?\d+\b)|([a-zA-Z-]+(?==))/g, last = 0, m;
    while ((m = re.exec(src))) {
      out += esc(src.slice(last, m.index));
      var cls = m[1] ? "c" : m[2] ? "s" : m[3] ? "k" : m[4] ? "g" : m[5] ? "n" : "a";
      out += '<span class="' + cls + '">' + esc(m[0]) + "</span>";
      last = m.index + m[0].length;
    }
    return out + esc(src.slice(last)) + "\n";
  }
  var hlT = null;
  function paint() {
    clearTimeout(hlT);
    hlT = setTimeout(function () {
      var v = ta.value;
      hl.innerHTML = v.length < 600000 ? highlight(v) : esc(v);
      var n = v.split("\n").length, g = ""; for (var i = 1; i <= n; i++) g += i + "\n"; gut.textContent = g;
      syncScroll();
    }, 60);
  }
  function syncScroll() { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; gut.scrollTop = ta.scrollTop; }
  ta.addEventListener("scroll", syncScroll);
  function stateSig() { try { return VC.hash(JSON.stringify(RB().veStateOf ? RB().veStateOf(VE.p, true) : VE.p)); } catch (e) { return String(Math.random()); } }
  function regen(keepCaret) {
    if (!VE.p) return;
    var t0 = performance.now(), code;
    try { code = codeOf(VE.p, CS.fmt); } catch (e) { console.error(e); status("No se pudo escribir el código: " + (e && e.message), "e"); return; }
    var pos = ta.selectionStart, top = ta.scrollTop;
    ta.value = code; CS.dirty = false; CS.sig = stateSig();
    if (keepCaret) { ta.selectionStart = ta.selectionEnd = Math.min(pos, code.length); ta.scrollTop = top; }
    paint();
    var n = ["v1", "m", "t", "a"].reduce(function (s, k) { return s + (VE.p[k] || []).length; }, 0);
    var smp = Object.keys(CACHE).filter(function (k) { return CACHE[k].b && CACHE[k].b.mode === "cuadro a cuadro"; }).length;
    status(n + " clips · sincronizado con el video" + (CS.fmt === "html" && smp ? " · " + smp + " movimiento(s) compuesto(s) escrito(s) cuadro a cuadro" : "") + " · " + Math.round(performance.now() - t0) + " ms", "");
  }
  function openPanel(fmt) {
    if (!VE.open || !VE.p) return;
    CS.open = true; panel.hidden = false; place();
    if (fmt) setFmt(fmt, true);
    regen(false);
    var b = vq('[data-vecode]'); if (b) b.setAttribute("aria-pressed", "true");
  }
  function closePanel() { CS.open = false; panel.hidden = true; var b = vq('[data-vecode]'); if (b) b.setAttribute("aria-pressed", "false"); }
  function setFmt(f, silent) {
    CS.fmt = f; panel.querySelectorAll("[data-vcf]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.vcf === f)); });
    if (!silent) regen(false);
  }
  function apply(src, how) {
    if (CS.applying) return Promise.resolve();
    CS.applying = true; status("Leyendo el código…", "d"); prog(0);
    return toModel(src, function (f) { prog(f); status("Ejecutando el código en un sandbox… " + Math.round(f * 100) + " %", "d"); }).then(function (r) {
      prog(null);
      if (how === "append") { var k = appendModel(r.model); status(k + " clips agregados desde el código" + (r.warnings.length ? " · " + r.warnings[0] : ""), r.warnings.length ? "d" : ""); return r; }
      applyModel(r.model, { rename: false });
      CS.sig = stateSig();
      var msg = r.kind === "musa-html" ? (r.changed && r.changed.length ? "Aplicado: " + summarize(r.changed) : "Aplicado (sin cambios)") : "Video armado desde el código: " + ["v1", "m", "t", "a"].reduce(function (s, k) { return s + r.model[k].length; }, 0) + " clips editables";
      status(msg + (r.warnings.length ? " · " + r.warnings.join(" · ") : ""), r.warnings.length ? "d" : "");
      CS.dirty = false;
      return r;
    }).catch(function (e) { prog(null); status("No se aplicó: " + (e && e.message || e), "e"); throw e; }).then(function (r) { CS.applying = false; return r; }, function (e) { CS.applying = false; throw e; });
  }
  function summarize(ch) {
    var by = {}; ch.forEach(function (x) { var k = x.split(":")[1]; by[k] = (by[k] || 0) + 1; });
    var names = { text: "texto", movimiento: "movimiento", svg: "vector", src: "archivo", dur: "duración", "in": "inicio del medio", morphTo: "morph" };
    return Object.keys(by).map(function (k) { return (by[k] > 1 ? by[k] + "× " : "") + (names[k] || k.replace(/,/g, ", ")); }).join(" · ");
  }
  ta.addEventListener("input", function () {
    CS.dirty = true; paint(); status("Cambios sin aplicar · Ctrl+Enter para aplicar", "d");
    clearTimeout(CS.auto);
    var kind = VC.detect(ta.value);
    /* el código de Musa y el JSON se aplican solos al dejar de escribir (no hace falta ejecutar nada) */
    if (CS.fmt !== "remotion" && (kind === "musa-html" || kind === "musa-json")) CS.auto = setTimeout(function () {
      if (!CS.dirty) return;
      var src = ta.value;
      try { var r = kind === "musa-json" ? VC.fromJson(src) : VC.fromMusaHtml(src, { env: envOf(VE.p) }); if (r.unresolved) return; } catch (e) { status("Aún no se puede leer: " + (e && e.message || e), "d"); return; }
      apply(src).catch(function () { /* el estado ya lo dice */ });
    }, 1300);
  });
  ta.addEventListener("focus", function () { CS.focused = true; });
  ta.addEventListener("blur", function () { CS.focused = false; });
  ta.addEventListener("keydown", function (e) {
    e.stopPropagation();
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); clearTimeout(CS.auto); apply(ta.value).catch(function () {}); return; }
    if (e.key === "Tab") { e.preventDefault(); var s = ta.selectionStart, en = ta.selectionEnd; ta.setRangeText("  ", s, en, "end"); ta.dispatchEvent(new Event("input")); }
    if (e.key === "Escape") { ta.blur(); }
  });
  ta.addEventListener("keyup", function (e) { e.stopPropagation(); selectFromCaret(); });
  ta.addEventListener("click", selectFromCaret);
  /* el cursor en el código elige el clip en el video */
  function selectFromCaret() {
    if (!VE.p || CS.fmt !== "html") return;
    var v = ta.value, pos = ta.selectionStart, before = v.slice(0, pos), lineStart = before.lastIndexOf("\n") + 1, lineEnd = v.indexOf("\n", pos), line = v.slice(lineStart, lineEnd < 0 ? v.length : lineEnd);
    var m = /id="(v1|m|t|a)-([^"]+?)(?:-c|-tx|-l\d+)?"/.exec(line) || /#(v1|m|t|a)-([\w-]+?)(?:-c|-tx|-l\d+)?\b/.exec(line);
    if (!m) { var bm = before.match(/\/\/ ▸ (v1|m|t|a)-([\w-]+)/g); if (bm) { var last = bm[bm.length - 1], endM = before.lastIndexOf("// ◂"), startM = before.lastIndexOf(last); if (startM > endM) m = /▸ (v1|m|t|a)-([\w-]+)/.exec(last); } }
    if (!m) return;
    var k = m[1], arr = k === "v1" ? VE.p.v1 : VE.p[k], i = arr.findIndex(function (c) { return VC.safeId(c.id) === m[2]; });
    if (i < 0 || (VE.sel && VE.sel.tr === k && VE.sel.i === i)) return;
    CS.lastSel = k + ":" + i;
    veSelect({ tr: k, i: i });
    if (k !== "v1" && k !== "a") { var c = arr[i]; if (VE.t < c.start || VE.t >= c.start + c.dur) veSeek(c.start + Math.min(0.3, c.dur / 2)); }
  }
  /* elegir un clip en el video lleva el código a su elemento */
  function revealSel() {
    if (!CS.open || CS.focused || CS.fmt !== "html" || !VE.sel || !VE.p) return;
    var s = VE.sel, key = s.tr + ":" + s.i; if (key === CS.lastSel) return; CS.lastSel = key;
    var arr = s.tr === "v1" || s.tr === "x" ? VE.p.v1 : VE.p[s.tr]; if (!arr || !arr[s.i]) return;
    var id = (s.tr === "x" ? "v1" : s.tr) + "-" + VC.safeId(arr[s.i].id), at = ta.value.indexOf('id="' + id + '"');
    if (at < 0) return;
    var line = ta.value.slice(0, at).split("\n").length - 1, lh = 12 * 1.55;
    ta.scrollTop = Math.max(0, line * lh - ta.clientHeight / 3); syncScroll();
    ta.setSelectionRange(at, at + id.length + 5);
  }
  setInterval(function () {
    if (!CS.open) return;
    if (!VE.open || !VE.p) return closePanel();
    revealSel();
    if (CS.dirty || CS.applying || CS.focused) return;
    var sg = stateSig(); if (sg !== CS.sig) regen(true);
  }, 900);
  addEventListener("resize", function () { if (CS.open) place(); });
  panel.addEventListener("click", function (e) {
    var f = e.target.closest("[data-vcf]"); if (f) { if (CS.dirty && !confirm("Hay cambios sin aplicar en el código. ¿Cambiar de formato y descartarlos?")) return; setFmt(f.dataset.vcf); return; }
    var a = e.target.closest("[data-vca]"); if (!a) return;
    var act = a.dataset.vca;
    if (act === "close") return closePanel();
    if (act === "apply") return apply(ta.value).catch(function () {});
    if (act === "sync") return regen(false);
    if (act === "copy") { (navigator.clipboard ? navigator.clipboard.writeText(ta.value) : Promise.reject()).then(function () { status("Código copiado", ""); }, function () { ta.select(); document.execCommand("copy"); status("Código copiado", ""); }); return; }
    if (act === "dl") { var ext = CS.fmt === "remotion" ? "tsx" : CS.fmt === "json" ? "json" : "html", nm = String((VE.p && VE.p.name) || "video").replace(/[^\w\- áéíóúñ]+/gi, "").trim().replace(/\s+/g, "-") || "video"; download(new Blob([ta.value], { type: ext === "html" ? "text/html" : "text/plain" }), nm + "." + ext); return; }
    if (act === "open") { pickText().then(function (txt) { if (txt == null) return; ta.value = txt; CS.dirty = true; paint(); return apply(txt); }).catch(function () {}); }
  });
  function download(blob, name) {
    if (RB().fileReady) { try { return RB().fileReady(blob, name); } catch (e) { /* sigue */ } }
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
  }
  function pickText() {
    return new Promise(function (ok) {
      var inp = document.createElement("input"); inp.type = "file"; inp.accept = ".html,.htm,.tsx,.jsx,.ts,.js,.json,text/html,application/json";
      inp.style.cssText = "position:fixed;left:-9999px"; document.body.appendChild(inp);
      inp.onchange = function () { var f = inp.files && inp.files[0]; inp.remove(); if (!f) return ok(null); f.text().then(ok, function () { ok(null); }); };
      inp.click();
    });
  }
  /* botón </> en la barra del editor */
  function ensureBtn() {
    var top = vq(".ed-tr") || document.querySelector("#ve .ed-tr"); if (!top || top.querySelector("[data-vecode]")) return;
    var b = document.createElement("button"); b.className = "ed-btn"; b.dataset.vecode = "1"; b.textContent = "</> Código"; b.title = "Ver y editar el video como código (HTML + GSAP, Remotion o JSON)"; b.setAttribute("aria-pressed", "false");
    b.style.cssText = "height:28px;padding:0 10px;margin-right:6px;font-family:'JetBrains Mono',ui-monospace,monospace";
    var ref = top.querySelector("[data-vesave]") || top.querySelector(".ve-saved"); if (ref && ref.nextSibling) top.insertBefore(b, ref.nextSibling); else top.insertBefore(b, top.firstChild);
    b.addEventListener("click", function () { if (CS.open) closePanel(); else openPanel(); });
  }
  setInterval(function () { if (VE.open) ensureBtn(); else if (CS.open) closePanel(); }, 700);

  /* ═════════════ pegar código en el editor ═════════════ */
  document.addEventListener("paste", function (e) {
    if (!VE.open || !VE.p) return;
    var typing = e.target.closest && e.target.closest("input,textarea,select,[contenteditable=true]"); if (typing) return;
    var txt = e.clipboardData && e.clipboardData.getData("text/plain"); if (!txt || txt.length < 40) return;
    var kind = VC.detect(txt); if (["musa-html", "html", "remotion", "musa-json", "motion-spec"].indexOf(kind) < 0) return;
    e.preventDefault(); e.stopPropagation();
    var label = { "musa-html": "código de Musa", html: "código HTML", remotion: "código Remotion", "musa-json": "JSON de Musa", "motion-spec": "MotionSpec" }[kind];
    (RB().choose ? RB().choose("Pegaste " + label + ". ¿Qué hago con él?", [{ value: "replace", label: "Reemplazar el video con este código" }, { value: "append", label: "Agregar sus clips al video (en el playhead)" }, { value: "panel", label: "Abrirlo en el panel Código para revisarlo" }], { title: "Código pegado", action: "video-paste-code" }) : Promise.resolve("replace"))
      .then(function (how) {
        if (!how) return;
        if (how === "panel") { openPanel(); ta.value = txt; CS.dirty = true; paint(); status("Código pegado sin aplicar · Ctrl+Enter para aplicar", "d"); return; }
        toast("Leyendo el código…");
        return apply(txt, how).then(function (r) { if (r) toast(how === "append" ? "Clips agregados desde el código" : "Video armado desde el código"); }, function (er) { toast("No se pudo: " + (er && er.message || er)); });
      });
  }, true);

  /* ═════════════ Crear › Videos › «Desde código» ═════════════ */
  function codeDialog() {
    return new Promise(function (resolve) {
      var w = document.createElement("div"); w.className = "vc-dlg"; w.setAttribute("role", "dialog"); w.setAttribute("aria-modal", "true"); w.setAttribute("aria-label", "Video desde código");
      w.innerHTML = '<div class="bx"><h3>Video desde código</h3><p>Pega el código de un video (HTML con GSAP o CSS, una composición de HyperFrames, un componente de Remotion o el código/JSON que exporta Musa). Se convierte en clips editables: textos, formas, imágenes, vectores, video y audio con sus keyframes.</p>'
        + '<textarea spellcheck="false" placeholder="<!doctype html> …  ó  import { useCurrentFrame } from \'remotion\' …"></textarea><div class="err" role="alert"></div>'
        + '<div class="row"><input type="text" value="Video desde código" aria-label="Nombre del video"><button data-d="file">Abrir archivo…</button><span class="sp"></span><button data-d="cancel">Cancelar</button><button class="p" data-d="ok">Crear video</button></div></div>';
      document.body.appendChild(w);
      var t = w.querySelector("textarea"), nm = w.querySelector("input"), er = w.querySelector(".err");
      setTimeout(function () { t.focus(); }, 30);
      var close = function (v) { w.remove(); resolve(v); };
      w.addEventListener("keydown", function (e) { if (e.key === "Escape") close(null); });
      w.addEventListener("click", function (e) {
        var b = e.target.closest("[data-d]"); if (!b) { if (e.target === w) close(null); return; }
        if (b.dataset.d === "cancel") return close(null);
        if (b.dataset.d === "file") return pickText().then(function (x) { if (x != null) { t.value = x; var tt = /<title>([^<]{1,80})<\/title>/i.exec(x); if (tt) nm.value = tt[1].trim(); } });
        var src = t.value.trim(); if (!src) { er.textContent = "Pega el código del video"; return; }
        var k = VC.detect(src); if (["musa-html", "html", "remotion", "musa-json", "motion-spec"].indexOf(k) < 0) { er.textContent = "No reconozco este código: pega HTML, Remotion (TSX/JSX) o el JSON de Musa"; return; }
        close({ src: src, name: nm.value.trim() || "Video desde código" });
      });
    });
  }
  function createFromCode(src, name) {
    var R = RB(), pg2 = R.progress ? R.progress("Video desde código", "Leyendo el código…") : null;
    var set = function (p, m) { if (pg2) pg2.set(p, m); };
    return toModel(src, function (f) { set(5 + f * 70, "Ejecutando el código cuadro a cuadro… " + Math.round(f * 100) + " %"); }).then(function (r) {
      var m = r.model, key = fmtKey(m.W, m.H);
      set(80, "Creando el proyecto…");
      return api("/api/video-projects", jreq("POST", { workspaceId: R.ws, name: name || m.name, ratio: key, canvasW: m.W, canvasH: m.H, fps: m.fps || 30 })).then(function (x) {
        var pid = x.data.project.id;
        /* la foto completa queda «pendiente»: al abrir, el editor crea cada clip en la base (todo o nada) */
        var st = { fmt: key, pad: m.pad, grad: m.grad || null, total: m.total || null, persp: m.persp || null, fps: m.fps || 30, gtr: m.gtr || null, markers: m.markers || null, pending: Date.now(), rev: R.veNewRev ? R.veNewRev() : String(Date.now()), v1: [], m: [], t: [], a: [] };
        ["m", "t", "a"].forEach(function (k) { st[k] = m[k].map(function (c) { var o = JSON.parse(JSON.stringify(c)); o._s = null; if (k === "m" && o.svg && P.sanitizeSvg) { var s2 = P.sanitizeSvg(o.svg); if (s2) { o.svg = s2; o.bg = P.bgOf(o); } } if (k === "t") ensureFontName(o.font); return o; }); });
        st.v1 = m.v1.map(function (c) { var o = JSON.parse(JSON.stringify(c)); o._s = null; return o; });
        return api("/rest/v1/video_editor_state", { method: "POST", headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ project_id: pid, workspace_id: R.ws, state: st }) }).then(function () {
          set(95, "Abriendo el editor…");
          R.vids = R.vids || []; R.vids.unshift({ id: pid, name: name || m.name, ratio: key, duration_us: Math.round(VC.durOf(m) * 1e6) });
          if (typeof TILES !== "undefined" && TILES["crear/videos"]) TILES["crear/videos"].unshift([esc(name || m.name), "Sin marca", Math.floor(VC.durOf(m) / 60) + ":" + String(Math.round(VC.durOf(m) % 60)).padStart(2, "0")]);
          Object.keys(VE_DOCS).forEach(function (k) { if (/^videos\//.test(k)) delete VE_DOCS[k]; });
          if (pg2) pg2.close();
          if (r.warnings.length) setTimeout(function () { toast(r.warnings.join(" · ")); }, 2500);
          return R.openVideo(pid, 0);
        });
      });
    }).catch(function (e) { if (pg2) pg2.close(); toast("No se pudo crear el video: " + (e && e.message || e)); });
  }
  RB().videoFromCode = function (src, name) { return src ? createFromCode(src, name) : codeDialog().then(function (v) { if (v) return createFromCode(v.src, v.name); }); };
  if (typeof drawView === "function") {
    var _dv = drawView;
    drawView = function () {
      var r = _dv.apply(this, arguments);
      try {
        if (typeof route !== "undefined" && route.mod === "crear" && route.sub === "videos" && RB().ws) {
          var acts = document.querySelector(".head .actions");
          if (acts && !acts.querySelector("[data-vfc]")) {
            var b = document.createElement("button"); b.className = "btn"; b.dataset.vfc = "1"; b.textContent = "Desde código";
            b.title = "Pega el código de un video (HTML/GSAP, HyperFrames, Remotion) y queda editable";
            b.addEventListener("click", function (e) { e.stopPropagation(); RB().videoFromCode(); });
            var pbtn = acts.querySelector(".btn-p"); if (pbtn) acts.insertBefore(b, pbtn); else acts.appendChild(b);
          }
        }
      } catch (e) { /* la vista cambió */ }
      return r;
    };
    if (typeof route !== "undefined" && route.mod === "crear" && route.sub === "videos") try { drawView(); } catch (e) { /* se pinta al navegar */ }
  }
  /* proyecto creado por el MCP con código que hay que ejecutar (HTML genérico o Remotion): se termina al abrirlo */
  var _ov = RB().openVideo;
  if (_ov) RB().openVideo = function (id, idx) {
    var pr = _ov.apply(this, arguments);
    /* al abrir, el código de los clips queda al día para el MCP (en segundo plano) */
    Promise.resolve(pr).then(function () { setTimeout(function () { if (VE.p && VE.p._real && VE.p._real.id === id && RB().veAfterSaveCode) RB().veAfterSaveCode(VE.p); }, 2500); });
    Promise.resolve(pr).then(function () {
      return api("/rest/v1/video_editor_state?project_id=eq." + encodeURIComponent(id) + "&select=state->codePending").then(function (rows) {
        var cp = rows && rows[0] && rows[0].codePending; if (!cp || !cp.src) return;
        var wait = function (n) { if (VE.open && VE.p && VE.p._real && VE.p._real.id === id) return run(); if (n > 40) return; setTimeout(function () { wait(n + 1); }, 250); };
        var run = function () {
          toast("Este video vino como código: lo ejecuto para dejarlo editable…");
          return toModel(cp.src).then(function (r) {
            applyModel(r.model, { rename: false });
            /* se quita el pendiente: el próximo guardado escribe la foto sin codePending */
            /* revisión nueva: el editor la toma como propia (si no, su próximo guardado creería que otro cambió el video) */
            var rv = RB().veNewRev ? RB().veNewRev() : String(Date.now()), stx = Object.assign({}, RB().veStateOf ? RB().veStateOf(VE.p, true) : {}, { rev: rv });
            return api("/rest/v1/video_editor_state?project_id=eq." + encodeURIComponent(id), { method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ state: stx }) }).then(function () {
              if (RB().veSetRev && VE.p && VE.p._real && VE.p._real.id === id) RB().veSetRev(VE.p, rv, stx); toast("Listo: " + ["v1", "m", "t", "a"].reduce(function (s, k) { return s + r.model[k].length; }, 0) + " clips editables desde el código"); });
          }).catch(function (e) { toast("No se pudo convertir el código: " + (e && e.message || e)); });
        };
        wait(0);
      });
    }).catch(function () { /* sin estado */ });
    return pr;
  };
  window.__veCode = { open: openPanel, close: closePanel, code: function (f) { return VE.p ? codeOf(VE.p, f || "html") : ""; }, apply: function (src, how) { return apply(src, how); }, toModel: toModel, trace: trace, state: CS, blocksOf: function () { return VE.p ? blocksOf(VE.p) : null; } };
})();
