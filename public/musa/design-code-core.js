/* design-code-core.js — «Musa Design Code»: cualquier código → diseño de Musa 100 % editable.
 *
 * Lo que pega una persona o una IA (HTML, Tailwind por CDN, React/JSX que arma HTML, íconos por JS, GSAP, anime,
 * Motion, animaciones CSS/WAAPI, Three.js, p5, canvas, Chart.js, HyperFrames…) corre UNA vez en un iframe aislado
 * (sin origen, sin acceso a Musa) con el reloj virtual del código vivo (video-live-core.js: tiempo congelado y
 * avanzado a mano, azar con semilla). De esa corrida sale:
 *   · el HTML/CSS final como capas (lo que el JS armó queda escrito: Tailwind pasa a CSS real, los íconos a SVG),
 *   · cada animación en el modelo de animación de diseño (shared/animationSchema.ts, `frame.animation`):
 *       CSS @keyframes y WAAPI → exactas (keyframes, curvas por tramo, repeticiones, dirección, relleno);
 *       GSAP / anime / Motion / requestAnimationFrame → rastreadas cuadro a cuadro y ajustadas a pocos keyframes
 *       con curva (lo que una persona escribiría a mano),
 *   · los ::before / ::after visibles como capas reales,
 *   · cada <canvas> (3D, p5, gráficos) como capa de «código vivo»: su código queda guardado en la capa (atributo
 *     data-live, codificado) y se sigue editando como en el video,
 *   · la portada sugerida: el primer instante en que se ve todo lo que entra (decisión 2026-11-16).
 *
 * El código NUNCA corre en la página de Musa: solo en el iframe aislado. Puro fuera del sandbox (sin DOM), así
 * también lo importa el servidor MCP para leer y escribir capas vivas.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  root.MusaDesignCode = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  var VERSION = 1;

  /* ═════════════ herramientas puras (también corren dentro del sandbox: se inyectan con toString) ═════════════ */
  function helpersMain() {
    var NUM = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
    function r4(v) { var x = Math.round(v * 10000) / 10000; return Object.is(x, -0) ? 0 : x; }
    function tokens(v) { return (String(v == null ? "" : v).match(NUM) || []).map(Number); }
    function shape(v) { return String(v == null ? "" : v).replace(NUM, "#"); }
    /* matriz del navegador (getComputedStyle) → transformación legible y editable.
       Uniforme y sin sesgo: la forma canónica del modelo («translateX translateY scale rotate»). */
    function decompose(m) {
      var s = String(m || "").trim();
      if (!s || s === "none") return "translateX(0px) translateY(0px) scale(1) rotate(0deg)";
      var mm = /^matrix\(([^)]+)\)$/.exec(s);
      if (!mm) return s; /* matrix3d (giros 3D, perspectiva): se interpola tal cual */
      var p = mm[1].split(",").map(Number), a = p[0], b = p[1], c = p[2], d = p[3], e = p[4], f = p[5];
      var sx = Math.hypot(a, b) || 1e-9, ca = a / sx, sa = b / sx, sh = ca * c + sa * d;
      var c2 = c - ca * sh, d2 = d - sa * sh, sy = Math.hypot(c2, d2) || 1e-9;
      if (a * d - b * c < 0) sy = -sy;
      var rot = Math.atan2(b, a) * 180 / Math.PI, skew = Math.atan(sh / sy) * 180 / Math.PI;
      if (Math.abs(sx - sy) < 1e-4 && Math.abs(skew) < 1e-3) return "translateX(" + r4(e) + "px) translateY(" + r4(f) + "px) scale(" + r4(sx) + ") rotate(" + r4(rot) + "deg)";
      return "translateX(" + r4(e) + "px) translateY(" + r4(f) + "px) rotate(" + r4(rot) + "deg) skewX(" + r4(skew) + "deg) scale(" + r4(sx) + ", " + r4(sy) + ")";
    }
    /* curvas con las que se ajustan las animaciones rastreadas (las de GSAP y CSS más usadas) */
    var EASES = [
      ["linear", null], ["ease", [0.25, 0.1, 0.25, 1]], ["ease-out", [0, 0, 0.58, 1]], ["ease-in", [0.42, 0, 1, 1]], ["ease-in-out", [0.42, 0, 0.58, 1]],
      ["cubic-bezier(0.25, 0.46, 0.45, 0.94)", [0.25, 0.46, 0.45, 0.94]], ["cubic-bezier(0.215, 0.61, 0.355, 1)", [0.215, 0.61, 0.355, 1]],
      ["cubic-bezier(0.165, 0.84, 0.44, 1)", [0.165, 0.84, 0.44, 1]], ["cubic-bezier(0.19, 1, 0.22, 1)", [0.19, 1, 0.22, 1]],
      ["cubic-bezier(0.34, 1.56, 0.64, 1)", [0.34, 1.56, 0.64, 1]], ["cubic-bezier(0.55, 0.085, 0.68, 0.53)", [0.55, 0.085, 0.68, 0.53]],
      ["cubic-bezier(0.55, 0.055, 0.675, 0.19)", [0.55, 0.055, 0.675, 0.19]], ["cubic-bezier(0.455, 0.03, 0.515, 0.955)", [0.455, 0.03, 0.515, 0.955]],
      ["cubic-bezier(0.645, 0.045, 0.355, 1)", [0.645, 0.045, 0.355, 1]], ["cubic-bezier(0.445, 0.05, 0.55, 0.95)", [0.445, 0.05, 0.55, 0.95]],
      ["cubic-bezier(0.68, -0.55, 0.265, 1.55)", [0.68, -0.55, 0.265, 1.55]],
    ];
    function bez(p, x) {
      if (!p) return x; if (x <= 0) return 0; if (x >= 1) return 1;
      var cx = 3 * p[0], bx = 3 * (p[2] - p[0]) - cx, ax = 1 - cx - bx, cy = 3 * p[1], by = 3 * (p[3] - p[1]) - cy, ay = 1 - cy - by, t = x, i;
      for (i = 0; i < 8; i++) { var er = ((ax * t + bx) * t + cx) * t - x; if (Math.abs(er) < 1e-6) return ((ay * t + by) * t + cy) * t; var dd = (3 * ax * t + 2 * bx) * t + cx; if (Math.abs(dd) < 1e-6) break; t -= er / dd; }
      var lo = 0, hi = 1; t = x;
      for (i = 0; i < 24; i++) { var e2 = ((ax * t + bx) * t + cx) * t - x; if (Math.abs(e2) < 1e-6) break; if (e2 > 0) hi = t; else lo = t; t = (lo + hi) / 2; }
      return ((ay * t + by) * t + cy) * t;
    }
    /* un tramo [i, j] se puede dibujar con una sola curva si todos los cuadros intermedios caen cerca */
    function fitSeg(T, K, i, j, tol) {
      var a = K[i], b = K[j], t0 = T[i], t1 = T[j];
      for (var q = 0; q < EASES.length; q++) {
        var ok = true, ez = EASES[q][1];
        for (var k = i + 1; k < j && ok; k++) {
          var y = bez(ez, (T[k] - t0) / Math.max(1e-9, t1 - t0));
          for (var d = 0; d < a.length; d++) { if (Math.abs(a[d] + (b[d] - a[d]) * y - K[k][d]) > tol[d]) { ok = false; break; } }
        }
        if (ok) return EASES[q][0];
      }
      return null;
    }
    /* curva a medida para un tramo: cubic-bezier(x1, y1, x2, y2) por mínimos cuadrados (x1, x2 en una grilla; y1, y2
       salen exactos para cada par). Es lo que haría una persona con el editor de curvas. */
    function solveT(x1, x2, x) {
      var cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, t = x;
      for (var i = 0; i < 8; i++) { var er = ((ax * t + bx) * t + cx) * t - x; if (Math.abs(er) < 1e-6) return t; var dd = (3 * ax * t + 2 * bx) * t + cx; if (Math.abs(dd) < 1e-6) break; t -= er / dd; }
      var lo = 0, hi = 1; t = x; for (i = 0; i < 26; i++) { var e2 = ((ax * t + bx) * t + cx) * t - x; if (Math.abs(e2) < 1e-7) break; if (e2 > 0) hi = t; else lo = t; t = (lo + hi) / 2; }
      return t;
    }
    function fitBez(T, K, i, j, tol) {
      var a = K[i], b = K[j], t0 = T[i], t1 = T[j], w = 0, xs = [], ys = [], k, d;
      for (d = 0; d < a.length; d++) w += Math.abs(b[d] - a[d]);
      if (w < 1e-9) return null;
      for (k = i + 1; k < j; k++) {
        var y = 0; for (d = 0; d < a.length; d++) if (Math.abs(b[d] - a[d]) > 1e-9) y += (K[k][d] - a[d]) / (b[d] - a[d]) * Math.abs(b[d] - a[d]) / w;
        xs.push((T[k] - t0) / Math.max(1e-9, t1 - t0)); ys.push(y);
      }
      if (!xs.length) return "linear";
      var best = null, bestE = Infinity;
      for (var gx1 = 0; gx1 <= 10; gx1++) for (var gx2 = 0; gx2 <= 10; gx2++) {
        var x1 = gx1 / 10, x2 = gx2 / 10, s11 = 0, s12 = 0, s22 = 0, r1 = 0, r2 = 0, ts = [];
        for (k = 0; k < xs.length; k++) {
          var t = solveT(x1, x2, xs[k]), u = 1 - t, p1 = 3 * u * u * t, p2 = 3 * u * t * t, z = ys[k] - t * t * t;
          ts.push(t); s11 += p1 * p1; s12 += p1 * p2; s22 += p2 * p2; r1 += p1 * z; r2 += p2 * z;
        }
        var det = s11 * s22 - s12 * s12; if (Math.abs(det) < 1e-12) continue;
        var y1 = (r1 * s22 - r2 * s12) / det, y2 = (r2 * s11 - r1 * s12) / det;
        if (y1 < -2 || y1 > 3 || y2 < -2 || y2 > 3) continue;
        var e = 0;
        for (k = 0; k < xs.length; k++) { var tt = ts[k], uu = 1 - tt, yy = 3 * uu * uu * tt * y1 + 3 * uu * tt * tt * y2 + tt * tt * tt; e = Math.max(e, Math.abs(yy - ys[k])); }
        if (e < bestE) { bestE = e; best = [x1, Math.round(y1 * 1000) / 1000, x2, Math.round(y2 * 1000) / 1000]; }
      }
      if (!best) return null;
      /* error real por dimensión con la curva elegida */
      for (k = i + 1; k < j; k++) {
        var yv = bez(best, (T[k] - t0) / Math.max(1e-9, t1 - t0));
        for (d = 0; d < a.length; d++) if (Math.abs(a[d] + (b[d] - a[d]) * yv - K[k][d]) > tol[d]) return null;
      }
      return "cubic-bezier(" + best.join(", ") + ")";
    }
    /* serie (tiempos, valores CSS) → pocos keyframes con curva: [{ t, v, e }] (e = curva del tramo que empieza ahí) */
    function fitSeries(T, V) {
      var n = T.length; if (!n) return [];
      var S = V.map(shape), K = V.map(tokens), i = 0, q;
      var tol = [];
      if (K[0].length) for (var d = 0; d < K[0].length; d++) {
        var lo = Infinity, hi = -Infinity;
        for (var k = 0; k < n; k++) if (S[k] === S[0]) { lo = Math.min(lo, K[k][d]); hi = Math.max(hi, K[k][d]); }
        tol.push(Math.max(0.004, (hi - lo) * 0.012));
      }
      var seg = [{ i: 0, e: "linear" }];  /* keyframes: índice del cuadro y curva del tramo que empieza ahí */
      while (i < n - 1) {
        if (V[i + 1] === V[i]) {
          /* quieto: un tramo propio (así se ve y se edita la pausa, no queda escondida dentro de una curva rara) */
          var h = i + 1; while (h + 1 < n && V[h + 1] === V[i]) h++;
          seg[seg.length - 1].e = "linear"; seg.push({ i: h, e: "linear", hold: true }); i = h; continue;
        }
        if (S[i + 1] !== S[i] || !K[i].length || K[i].length !== tol.length) {
          if (V[i + 1] !== V[i]) { seg[seg.length - 1].e = "steps(1, jump-end)"; seg.push({ i: i + 1, e: "linear", hard: true }); }
          i++; continue;
        }
        var best = i + 1, bestE = "linear", fails = 0;
        for (var j = i + 2; j < n; j++) {
          if (S[j] !== S[i]) break;
          var e = fitSeg(T, K, i, j, tol);
          if (e) { best = j; bestE = e; fails = 0; } else if (++fails >= 4) break;
        }
        seg[seg.length - 1].e = bestE;
        seg.push({ i: best, e: "linear" });
        i = best;
      }
      /* juntar tramos vecinos con una curva a medida mientras se pueda (un ease-out de GSAP queda en un solo tramo) */
      for (var guard = 0, merged = true; merged && guard < 200; guard++) {
        merged = false;
        for (q = 0; q + 2 < seg.length; q++) {
          var A = seg[q], B = seg[q + 1], C = seg[q + 2];
          if (A.e === "steps(1, jump-end)" || B.e === "steps(1, jump-end)" || B.hard || C.hard || S[A.i] !== S[C.i] || !K[A.i].length) continue;
          if (V[A.i] === V[B.i] || V[B.i] === V[C.i]) continue; /* las pausas quedan como pausas */
          var same = true; for (var x = A.i; x <= C.i && same; x++) if (V[x] !== V[A.i]) same = false;
          var fit = same ? "linear" : fitSeg(T, K, A.i, C.i, tol) || fitBez(T, K, A.i, C.i, tol);
          if (fit) { A.e = fit; seg.splice(q + 1, 1); merged = true; break; }
        }
      }
      var out = seg.map(function (s0) { return { t: T[s0.i], v: V[s0.i], e: s0.e }; });
      /* tramos quietos: un keyframe al empezar y otro al terminar */
      var res = [];
      out.forEach(function (x, q) {
        var prev = res[res.length - 1], next = out[q + 1];
        if (prev && next && prev.v === x.v && next.v === x.v) return;
        res.push(x);
      });
      return res;
    }
    return { NUM: NUM, r4: r4, tokens: tokens, shape: shape, decompose: decompose, EASES: EASES, bez: bez, fitSeries: fitSeries };
  }
  var H = helpersMain();

  /* ═════════════ capa de «código vivo» en un diseño ═════════════
     <div data-layer-kind="live" data-live="…">  (el código y sus tiempos, codificados para que ningún limpiador lo
       toque y viaje con la capa al copiar, duplicar, pasarla a otro frame o editar a la vez)
       <img data-live-poster src="…">            (la portada ya dibujada: lo que ven las miniaturas, PDF, correo…)
     </div>
     live = { v, src, kind, sel, W, H, fit, start, off, speed, loop, hold, fps, name, poster: { url, at, sig } }
       W × H   tamaño de la ventana donde corre el código (el lienzo que dibuja puede ser una parte)
       fit     "viewport": el código ocupa la capa entera (al agrandar la capa, el código ve una ventana más grande)
               "canvas": el lienzo es una parte de la página (un gráfico dentro de una tarjeta): se estira
       start   segundo del reloj de la lámina en que arranca · off: segundo del código en ese momento
       speed · loop (segundos; 0 = sin bucle) · hold: «cuadro propio» (segundo del código fijo, sin importar el reloj) */
  var LIVE_KEYS = ["v", "src", "kind", "sel", "W", "H", "fit", "start", "off", "speed", "loop", "hold", "fps", "name", "poster", "lib"];
  function cleanLive(L) {
    var o = {};
    LIVE_KEYS.forEach(function (k) { if (L && L[k] !== undefined && L[k] !== null && L[k] !== "") o[k] = L[k]; });
    o.v = VERSION; o.src = String(o.src || ""); o.kind = o.kind === "remotion" ? "remotion" : "html";
    ["sel", "W", "H", "start", "off", "speed", "loop", "hold", "fps"].forEach(function (k) { if (o[k] != null) { var n = +o[k]; if (isFinite(n)) o[k] = Math.round(n * 1000) / 1000; else delete o[k]; } });
    if (o.sel == null) o.sel = -1;
    if (o.fit !== "canvas") o.fit = "viewport";
    if (o.poster && typeof o.poster === "object") { var p = {}; if (typeof o.poster.url === "string" && /^https:\/\//.test(o.poster.url)) p.url = o.poster.url; if (isFinite(+o.poster.at)) p.at = +o.poster.at; if (o.poster.sig) p.sig = String(o.poster.sig).slice(0, 40); o.poster = p; }
    return o;
  }
  function encLive(L) { return encodeURIComponent(JSON.stringify(cleanLive(L))); }
  function decLive(s) {
    if (!s) return null;
    try { var L = JSON.parse(decodeURIComponent(String(s))); return L && typeof L === "object" && typeof L.src === "string" ? cleanLive(L) : null; } catch (e) { return null; }
  }
  /* segundo del código que se ve cuando el reloj de la lámina marca T */
  function liveTime(L, T) {
    if (!L) return 0;
    if (L.hold != null && isFinite(+L.hold)) return Math.max(0, +L.hold);
    var sp = L.speed != null ? +L.speed : 1, x = Math.max(0, (+T || 0) - (+L.start || 0)) * sp;
    if (+L.loop > 0) x = x % +L.loop;
    return Math.max(0, (+L.off || 0) + x);
  }
  /* HTML de una capa viva nueva (tamaño y lugar en px del frame) */
  function liveHtml(L, box, id, name) {
    var b = box || {}, st = "position:absolute;left:" + (+b.x || 0) + "px;top:" + (+b.y || 0) + "px;width:" + (+b.w || 400) + "px;height:" + (+b.h || 400) + "px;overflow:hidden";
    var pu = L && L.poster && L.poster.url;
    return '<div data-layer-id="' + esc(id || "musa_live_" + Date.now().toString(36)) + '" data-layer-name="' + esc(name || L.name || "Código vivo") + '" data-layer-kind="live" data-live="' + encLive(L) + '" style="' + st + '">'
      + (pu ? '<img data-live-poster src="' + esc(pu) + '" alt="" draggable="false" style="position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none">' : "") + "</div>";
  }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  /* ═════════════ qué es el código que llegó ═════════════ */
  function isHtml(s) { return /<(?:!doctype|html|head|body|script|canvas|div|svg|main|section|style|article|header|footer|span|p|h[1-6]|img|ul|button|nav)\b/i.test(s); }
  function detect(src) {
    var s = String(src || ""), html = isHtml(s);
    /* un documento HTML es HTML aunque traiga adentro (en sus scripts o como texto) código de Remotion o JSX:
       p. ej. el código de un video de Musa lleva el motor de Remotion como texto para sus clips 3D */
    var docHtml = /^\s*(?:<!--[\s\S]*?-->\s*)*<(?:!doctype|html|head|body)\b/i.test(s);
    var remotion = !docHtml && /from\s*["']remotion["']|from\s*["']@remotion\/|useCurrentFrame\s*\(|registerRoot\s*\(/.test(s);
    var jsx = !html && /(?:^|\n)\s*(?:import\s.+from\s+["']react["']|export\s+default\s+function|function\s+\w+\s*\([^)]*\)\s*\{[\s\S]*return\s*\(?\s*<)/.test(s);
    var hyper = /data-composition-id|data-start\s*=|__timelines/.test(s) && /data-duration|__timelines/.test(s);
    var canvasJs = !html && !remotion && !jsx && /\bTHREE\.|from\s*["']three|createCanvas\s*\(|getContext\s*\(\s*["'](?:2d|webgl)|new\s+p5\s*\(|PIXI\./.test(s);
    var scripts = /<script\b/i.test(s) || canvasJs || remotion || jsx;
    var anim = /@keyframes|\banimation(?:-name)?\s*:|\.animate\s*\(|gsap\.|anime\s*\(|new\s+Motion|framer-motion|requestAnimationFrame/.test(s);
    var pseudo = /::?(?:before|after)\s*[,{][^}]*content\s*:/i.test(s);
    var canvas = /<canvas\b/i.test(s) || canvasJs || /\bTHREE\.|createCanvas\s*\(|new\s+Chart\s*\(|getContext\s*\(/.test(s);
    var kind = remotion ? "remotion" : jsx ? "jsx" : canvasJs ? "canvas" : html ? "html" : "text";
    return { kind: kind, html: html, scripts: scripts, anim: anim, pseudo: pseudo, canvas: canvas, video: remotion || hyper, needsBake: scripts || anim || pseudo || canvas };
  }
  /* JSX/React suelto (sin HTML): se monta con React 18 + Babel en el sandbox y se hornea lo que dibuja */
  function wrapJsx(src) {
    var s = String(src || "");
    var name = (/export\s+default\s+function\s+(\w+)/.exec(s) || /export\s+default\s+(\w+)/.exec(s) || /function\s+([A-Z]\w*)\s*\(/.exec(s) || [0, "App"])[1];
    var body = s.replace(/^\s*import\s[^\n]*\n/gm, "").replace(/export\s+default\s+function/, "function").replace(/export\s+default\s+\w+\s*;?/, "").replace(/^\s*export\s+/gm, "");
    return "<!doctype html><html><head><meta charset=\"utf-8\"><script src=\"https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js\"><\/script><script src=\"https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js\"><\/script><script src=\"https://cdn.jsdelivr.net/npm/@babel/standalone@7.26.4/babel.min.js\"><\/script>"
      + (/className=/.test(s) && /\b(?:flex|grid|text-|bg-|p-\d|px-|py-|rounded)/.test(s) ? "<script src=\"https://cdn.tailwindcss.com/3.4.16\"><\/script>" : "")
      + "</head><body style=\"margin:0\"><div id=\"root\"></div><script type=\"text/babel\" data-presets=\"react\">\nconst { useState, useEffect, useRef, useMemo, useCallback, Fragment } = React;\n" + body.replace(/<\/script/gi, "<\\/script") + "\nReactDOM.createRoot(document.getElementById('root')).render(React.createElement(" + name + "));\n<\/script></body></html>";
  }

  /* ═════════════ dentro del sandbox, antes del código: lo que hace que una página «se vea entera» ═════════════
     · IntersectionObserver dice que todo está a la vista (las entradas «al hacer scroll» de las landings pasan
       a ser entradas de la lámina), prefers-reduced-motion = no, sin diálogos ni scroll. */
  function ioPrelude() {
    function IO(cb) { this.cb = cb; }
    IO.prototype.observe = function (el) {
      var self = this;
      Promise.resolve().then(function () { try { var r = el.getBoundingClientRect(); self.cb([{ target: el, isIntersecting: true, intersectionRatio: 1, boundingClientRect: r, intersectionRect: r, rootBounds: null, time: 0 }], self); } catch (e) { /* el código del observador falló */ } });
    };
    IO.prototype.unobserve = function () {}; IO.prototype.disconnect = function () {}; IO.prototype.takeRecords = function () { return []; };
    try { window.IntersectionObserver = IO; } catch (e) { /* sin IO */ }
    var mm = window.matchMedia;
    window.matchMedia = function (q) {
      if (/prefers-reduced-motion/.test(String(q))) return { matches: /no-preference/.test(String(q)), media: String(q), onchange: null, addListener: function () {}, removeListener: function () {}, addEventListener: function () {}, removeEventListener: function () {}, dispatchEvent: function () { return false; } };
      return mm.call(window, q);
    };
    window.alert = window.confirm = window.prompt = function () { return null; };
    window.scrollTo = window.scroll = function () {};
    try { Element.prototype.scrollIntoView = function () {}; } catch (e) { /* idem */ }
  }

  /* ═════════════ el horneado (corre dentro del sandbox) ═════════════ */
  function bakerMain(cfg) {
    var H = window.__mdcH, clock = window.__mvcClock, tok = cfg.token, warnings = [];
    function post(type, data) { parent.postMessage({ __mdb: tok, type: type, data: data }, "*"); }
    function realWait(ms) { return new Promise(function (r) { clock.realTimeout(r, ms); }); }
    function warn(m) { if (warnings.indexOf(m) < 0) warnings.push(m); }
    var SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|META|LINK|TITLE|BASE|HEAD|SOURCE|TRACK|PARAM)$/;
    var uid = 0, PFX = "musa_" + tok.slice(-5) + "_";
    function idOf(el) { var v = el.getAttribute("data-layer-id"); if (!v) { v = PFX + (++uid).toString(36); el.setAttribute("data-layer-id", v); } return v; }
    function inSvg(el) { return el.ownerSVGElement && el.tagName.toLowerCase() !== "svg"; }
    function cam(p) { return p.replace(/^-webkit-/, "webkit-").replace(/-([a-z])/g, function (m, x) { return x.toUpperCase(); }); }
    function kebab(p) { return /^--/.test(p) ? p : p.replace(/[A-Z]/g, function (m) { return "-" + m.toLowerCase(); }).replace(/^webkit-/, "-webkit-"); }
    function canvases() { return [].slice.call(document.querySelectorAll("canvas")).filter(function (c) { return !(c.closest && c.closest(".lil-gui,.dg,#stats,.stats")); }); }
    var NOPSE = '[data-musa-nopse~="before"]::before{content:none!important;display:none!important}[data-musa-nopse~="after"]::after{content:none!important;display:none!important}';

    async function settle() {
      if (document.readyState !== "complete") await Promise.race([new Promise(function (r) { window.addEventListener("load", function () { r(); }, { once: true }); }), realWait(20000)]);
      await realWait(60);
      var br = window.__hf && window.__hf.buildReady;
      if (br && Object.keys(br).length) await Promise.race([Promise.all(Object.keys(br).map(function (k) { return br[k]; })), realWait(20000)]);
      if (window.__ready && typeof window.__ready.then === "function") await Promise.race([window.__ready, realWait(20000)]);
      if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, realWait(5000)]);
      await Promise.race([Promise.all([].map.call(document.images, function (im) { return im.complete ? 0 : new Promise(function (r) { im.onload = im.onerror = r; }); })), realWait(8000)]);
      /* librerías que se arman con un poco de tiempo real (Tailwind por CDN, íconos, Babel): unas vueltas sin mover el reloj */
      for (var i = 0; i < 6; i++) await realWait(40);
      if (window.ScrollTrigger && window.ScrollTrigger.getAll) {
        /* lo que se anima al hacer scroll pasa a ser una entrada de la lámina */
        try { window.ScrollTrigger.getAll().forEach(function (st) { var a = st.animation; st.kill(false); if (a && a.play) { a.paused(false); a.play(0); } }); warn("Las animaciones al hacer scroll quedaron como entradas de la lámina."); } catch (e) { /* ScrollTrigger distinto */ }
      }
    }

    /* ── duración de lo que se mueve ── */
    function timeline() {
      var d = 0, loops = false, i;
      try {
        if (window.gsap && gsap.globalTimeline && gsap.globalTimeline.getChildren) gsap.globalTimeline.getChildren(true, true, true).forEach(function (c) {
          var st = c.startTime ? c.startTime() : 0, one = c.duration ? c.duration() : 0, rep = c.repeat ? c.repeat() : 0, tot = c.totalDuration ? c.totalDuration() : one;
          if (rep < 0 || tot > 3600) { loops = true; d = Math.max(d, st + Math.min(one, 30)); } else d = Math.max(d, st + tot);
        });
      } catch (e) { /* GSAP raro */ }
      var tls = window.__timelines || {};
      Object.keys(tls).forEach(function (k) { try { var x = tls[k].duration(); if (isFinite(x) && x < 3600) d = Math.max(d, x); } catch (e) { /* idem */ } });
      if (document.getAnimations) document.getAnimations().forEach(function (an) {
        try { var tm = an.effect.getComputedTiming(); if (isFinite(tm.endTime)) d = Math.max(d, tm.endTime / 1000); else { loops = true; d = Math.max(d, ((+tm.delay || 0) + (+tm.duration || 0)) / 1000); } } catch (e) { /* sin efecto */ }
      });
      var root = document.querySelector("[data-composition-id][data-duration]");
      if (root) d = Math.max(d, +root.getAttribute("data-duration") || 0);
      if (window.anime && anime.running) for (i = 0; i < anime.running.length; i++) { var a = anime.running[i]; if (a && isFinite(a.duration)) d = Math.max(d, a.duration / 1000); if (a && a.loop) loops = true; }
      return { d: d, loops: loops };
    }

    /* ── ::before / ::after visibles → capas reales (antes de correr el tiempo: sus animaciones pasan a la capa) ── */
    var PSE_PROPS = ["display", "position", "top", "right", "bottom", "left", "z-index", "width", "height", "min-width", "min-height", "max-width", "max-height", "margin-top", "margin-right", "margin-bottom", "margin-left",
      "padding-top", "padding-right", "padding-bottom", "padding-left", "box-sizing", "background-color", "background-image", "background-size", "background-position", "background-repeat", "background-clip", "background-origin", "background-blend-mode",
      "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "border-top-style", "border-right-style", "border-bottom-style", "border-left-style", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
      "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius", "box-shadow", "opacity", "transform", "transform-origin", "filter", "backdrop-filter", "mix-blend-mode", "clip-path", "mask-image", "-webkit-mask-image",
      "color", "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-align", "text-transform", "text-decoration-line", "text-shadow", "white-space", "vertical-align", "-webkit-text-stroke-width", "-webkit-text-stroke-color", "-webkit-background-clip", "-webkit-text-fill-color",
      "flex-shrink", "flex-grow", "align-self", "pointer-events", "overflow", "isolation", "animation-name", "animation-duration", "animation-timing-function", "animation-delay", "animation-iteration-count", "animation-direction", "animation-fill-mode", "animation-play-state"];
    var pseCount = 0;
    function contentText(c) {
      if (!c || c === "none" || c === "normal") return null;
      var m = /^"((?:[^"\\]|\\.)*)"$/.exec(c.trim()) || /^'((?:[^'\\]|\\.)*)'$/.exec(c.trim());
      if (!m) return null;
      return m[1].replace(/\\([0-9a-fA-F]{1,6})\s?/g, function (x, h) { return String.fromCodePoint(parseInt(h, 16)); }).replace(/\\(.)/g, "$1");
    }
    function materializePseudo() {
      var st = document.createElement("style"); st.setAttribute("data-mdb", "1"); st.textContent = NOPSE; document.head.appendChild(st);
      var ref = document.createElement("span"); ref.style.cssText = "all:initial"; document.body.appendChild(ref); var refCs = getComputedStyle(ref), refVals = {};
      PSE_PROPS.forEach(function (p) { refVals[p] = refCs.getPropertyValue(p); }); ref.remove();
      [].slice.call(document.body.querySelectorAll("*")).forEach(function (el) {
        if (SKIP.test(el.tagName) || inSvg(el) || /^(IMG|INPUT|TEXTAREA|SELECT|BR|HR|CANVAS|VIDEO|IFRAME|svg)$/i.test(el.tagName)) return;
        ["before", "after"].forEach(function (pe) {
          var cs = getComputedStyle(el, "::" + pe), txt = contentText(cs.content);
          if (txt == null || cs.display === "none") return;
          var w = parseFloat(cs.width), h = parseFloat(cs.height), deco = (cs.backgroundImage && cs.backgroundImage !== "none") || !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) || parseFloat(cs.borderTopWidth) > 0 || (cs.boxShadow && cs.boxShadow !== "none");
          if (!txt.trim() && !(deco && ((w > 0 && h > 0) || cs.position === "absolute" || cs.position === "fixed"))) return;
          var r0 = el.getBoundingClientRect(), sp = document.createElement("span"), css = [];
          PSE_PROPS.forEach(function (p) { var v = cs.getPropertyValue(p); if (v && v !== refVals[p]) css.push(p + ":" + v); });
          sp.setAttribute("style", css.join(";")); if (txt) sp.textContent = txt;
          sp.setAttribute("data-layer-kind", txt.trim() ? "text" : "shape"); sp.setAttribute("data-layer-name", (pe === "before" ? "antes de " : "después de ") + (el.getAttribute("data-layer-name") || el.id || (el.className && String(el.className).split(" ")[0]) || el.tagName.toLowerCase()));
          sp.setAttribute("data-musa-pseudo", pe);
          if (pe === "before") el.insertBefore(sp, el.firstChild); else el.appendChild(sp);
          var cur = (el.getAttribute("data-musa-nopse") || "").split(/\s+/).filter(Boolean); cur.push(pe); el.setAttribute("data-musa-nopse", cur.join(" "));
          var r1 = el.getBoundingClientRect();
          if (Math.abs(r1.width - r0.width) > 1 || Math.abs(r1.height - r0.height) > 1) {
            /* cambió el tamaño de su elemento: no era equivalente; queda como estaba (sigue siendo CSS) */
            sp.remove(); cur.pop(); if (cur.length) el.setAttribute("data-musa-nopse", cur.join(" ")); else el.removeAttribute("data-musa-nopse");
            return;
          }
          pseCount++;
        });
      });
    }

    /* ── canvas: puntaje de contenido (para elegir el mejor cuadro del 3D) ── */
    var probe = document.createElement("canvas"); probe.width = 24; probe.height = 24; var pg = probe.getContext("2d");
    function canvasScore(cv) {
      try {
        pg.clearRect(0, 0, 24, 24); pg.drawImage(cv, 0, 0, 24, 24);
        var d = pg.getImageData(0, 0, 24, 24).data, n = 576, sum = 0, sq = 0, vis = 0, edge = 0, prev = null;
        for (var i = 0; i < d.length; i += 4) {
          var l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * (d[i + 3] / 255);
          sum += l; sq += l * l; if (d[i + 3] > 20) vis++;
          if (prev != null && (i / 4) % 24) edge += Math.abs(l - prev); prev = l;
        }
        var mean = sum / n;
        return Math.sqrt(Math.max(0, sq / n - mean * mean)) + edge / n + vis / n * 10;
      } catch (e) { return null; }
    }

    async function run() {
      try {
        await settle();
        if (cfg.pseudo !== false) { try { materializePseudo(); } catch (e) { warn("No se pudieron pasar a capas algunos adornos ::before/::after (siguen como CSS)."); } }
        clock.advance(0);
        var body = document.body;
        var W = cfg.W, VH = cfg.H;
        /* ids para todo lo que se dibuja (el orden es el del documento: misma corrida, mismos ids) */
        [].forEach.call(body.querySelectorAll("*"), function (el) { if (!SKIP.test(el.tagName) && !inSvg(el)) idOf(el); });
        var tl = timeline(), probeOnly = !tl.d;
        var t0 = cfg.range ? Math.max(0, +cfg.range.t0 || 0) : 0, t1 = cfg.range ? Math.max(t0 + 0.05, +cfg.range.t1 || 0) : Math.min(cfg.maxDur || 30, Math.max(tl.d, 1));
        var fps = cfg.fps || (t1 - t0 <= 6 ? 30 : t1 - t0 <= 15 ? 20 : 10);
        /* lo que el JS cambia en el estilo (GSAP, anime, Motion, requestAnimationFrame…) */
        var touched = new Map(), born = [];
        var mo = new MutationObserver(function (list) {
          list.forEach(function (m) {
            if (m.type === "childList") { [].forEach.call(m.addedNodes, function (n) { if (n.nodeType === 1 && !SKIP.test(n.tagName)) born.push(n); }); return; }
            if (m.type !== "attributes" || m.target.nodeType !== 1 || m.attributeName !== "style") return;
            if (!touched.has(m.target)) touched.set(m.target, {});
          });
        });
        mo.observe(body, { subtree: true, attributes: true, attributeFilter: ["style"], childList: true });
        var BASEP = ["opacity", "transform", "visibility", "filter", "clip-path", "translate", "rotate", "scale"];
        var base0 = new Map();
        [].forEach.call(body.querySelectorAll("[data-layer-id]"), function (el) { var cs = getComputedStyle(el), o = {}; BASEP.forEach(function (p) { o[p] = cs.getPropertyValue(p); }); o.__inline = {}; for (var i = 0; i < el.style.length; i++) o.__inline[el.style[i]] = el.style.getPropertyValue(el.style[i]); base0.set(el, o); });
        var animFirst = new Map(), times = [], score = [], visRec = new Map(), cvs0 = canvases(), cvScore = cvs0.map(function () { return []; });
        var N = Math.max(1, Math.round((t1 - t0) * fps)), timed = [].slice.call(body.querySelectorAll("[data-start]"));
        var tls = window.__timelines || {}, tlKeys = Object.keys(tls).filter(function (k) { return tls[k] && typeof tls[k].seek === "function"; });
        for (var i = 0; i <= N; i++) {
          var t = t0 + (t1 - t0) * i / N;
          if (window.__mvcStep) { var stp = window.__mvcStep(t, i, fps); if (stp && typeof stp.then === "function") await stp; }
          else {
            clock.advance(t);
            tlKeys.forEach(function (k) { try { tls[k].seek(t, true); } catch (e) { /* timeline roto */ } });
            var ws = [];
            if (typeof window.__seek === "function") { try { var sr = window.__seek(t); if (sr && typeof sr.then === "function") ws.push(sr); } catch (e) { /* seek falló */ } }
            if (window.__mvlHF && window.__mvlHF.n) { try { window.dispatchEvent(new CustomEvent("hf-seek", { detail: { time: t, waitUntil: function (p) { ws.push(p); } } })); } catch (e) { /* idem */ } }
            (window.__hfLottie || []).forEach(function (a) { try { if (a.goToAndStop) a.goToAndStop(t * 1000, false); } catch (e) { /* idem */ } });
            (window.__hfAnime || []).forEach(function (a) { try { a.seek(t * 1000); } catch (e) { /* idem */ } });
            if (ws.length) await Promise.race([Promise.all(ws), realWait(8000)]);
          }
          /* animaciones CSS / WAAPI / transiciones: en pausa y en su instante (corren con el reloj de la lámina) */
          if (document.getAnimations) document.getAnimations().forEach(function (an) { try { if (!animFirst.has(an)) animFirst.set(an, i ? t : t0); an.pause(); an.currentTime = Math.max(0, t - animFirst.get(an)) * 1000; } catch (e) { /* sin tiempo */ } });
          /* HyperFrames: cada escena se ve en su tramo */
          timed.forEach(function (el) { if (el === body) return; var s = +el.getAttribute("data-start") || 0, dd = +el.getAttribute("data-duration"); if (!isFinite(dd) || dd <= 0) dd = 1e9; el.style.visibility = t >= s && t < s + dd ? "" : "hidden"; });
          mo.takeRecords().forEach(function (m) { if (m.type === "attributes" && m.attributeName === "style" && !touched.has(m.target)) touched.set(m.target, {}); else if (m.type === "childList") [].forEach.call(m.addedNodes, function (n) { if (n.nodeType === 1 && !SKIP.test(n.tagName)) born.push(n); }); });
          times.push(Math.round((t - t0) * 1000) / 1000);
          touched.forEach(function (rec, el) {
            var cs = getComputedStyle(el), inl = {}, k;
            for (k = 0; k < el.style.length; k++) inl[el.style[k]] = el.style.getPropertyValue(el.style[k]);
            rec.vals = rec.vals || {};
            Object.keys(inl).forEach(function (p) { (rec.vals[p] = rec.vals[p] || [])[times.length - 1] = p === "transform" ? H.decompose(cs.transform) : /^(translate|rotate|scale)$/.test(p) ? cs.getPropertyValue(p) : /color/.test(p) ? cs.getPropertyValue(p) : inl[p]; });
          });
          /* lo que se ve de cada cosa animada (para la portada): opacidad y área en la lámina */
          var seenNow = new Set();
          var noteVis = function (el) {
            if (!el || seenNow.has(el) || !el.getBoundingClientRect) return; seenNow.add(el);
            var r = el.getBoundingClientRect(), cs = getComputedStyle(el), v = visRec.get(el);
            if (!v) { v = []; visRec.set(el, v); }
            var on = cs.visibility !== "hidden" && cs.display !== "none";
            v[times.length - 1] = [on ? Math.min(1, +cs.opacity) : 0, Math.max(0, Math.min(r.right, W) - Math.max(r.left, 0)) * Math.max(0, r.height)];
          };
          touched.forEach(function (rec, el) { noteVis(el); });
          animFirst.forEach(function (st0, an) { try { noteVis(an.effect && an.effect.target); } catch (e) { /* idem */ } });
          score.push(0);
          if (i % Math.max(1, Math.round(fps / 5)) === 0) cvs0.forEach(function (cv, ci) { var s = canvasScore(cv); if (s != null) cvScore[ci].push([times[times.length - 1], s]); });
          if (i % 10 === 0) { post("progress", { i: i, n: N }); await realWait(0); }
        }
        mo.disconnect();
        var dur = Math.max(0.2, t1 - t0);

        /* ── 1) CSS / WAAPI: exactas ── */
        var clips = [], convertedNames = new Set(), failedCss = 0;
        function baseValueOf(el, prop, an) {
          var cur = an.currentTime, v;
          try { an.cancel(); v = getComputedStyle(el).getPropertyValue(kebab(prop)); } catch (e) { v = ""; }
          try { an.play(); an.pause(); an.currentTime = cur; } catch (e) { /* idem */ }
          return v;
        }
        function canon(el, prop, value) {
          /* el mismo valor como lo escribe el navegador (rgb, px, matriz): así se interpola igual en todas partes */
          var kp = kebab(prop); if (/^--/.test(kp) || value == null || value === "") return value;
          var old = el.style.getPropertyValue(kp), oldP = el.style.getPropertyPriority(kp), out = value;
          var anims = el.getAnimations ? el.getAnimations() : [], saved = anims.map(function (a) { return a.currentTime; });
          try {
            anims.forEach(function (a) { a.cancel(); });
            el.style.setProperty(kp, String(value), "important");
            var c = getComputedStyle(el).getPropertyValue(kp);
            if (c) out = kp === "transform" ? H.decompose(c) : c;
          } catch (e) { out = value; }
          if (old) el.style.setProperty(kp, old, oldP); else el.style.removeProperty(kp);
          anims.forEach(function (a, q) { try { a.play(); a.pause(); a.currentTime = saved[q]; } catch (e) { /* idem */ } });
          return out;
        }
        animFirst.forEach(function (first, an) {
          try {
            var ef = an.effect, el = ef && ef.target;
            if (!el || !el.getAttribute) { failedCss++; return; }
            if (ef.pseudoElement) { warn("Una animación de un ::" + String(ef.pseudoElement).replace(/^:+/, "") + " quedó como CSS."); failedCss++; return; }
            var id = idOf(el), tm = ef.getTiming(), kfs = ef.getKeyframes(), isTr = an.constructor && an.constructor.name === "CSSTransition";
            var delay = (+tm.delay || 0) / 1000, D = Math.max(0.001, (+tm.duration || 0) / 1000), it = tm.iterations === Infinity ? -1 : (+tm.iterations || 1);
            var props = {}; kfs.forEach(function (k) { Object.keys(k).forEach(function (p) { if (!/^(offset|computedOffset|easing|composite)$/.test(p)) props[p] = 1; }); });
            var tweens = Object.keys(props).map(function (p) {
              var list = kfs.filter(function (k) { return k[p] != null; }).map(function (k) { return { t: k.computedOffset, value: canon(el, p, k[p]), easing: k.easing && k.easing !== "linear" ? k.easing : undefined }; });
              if (!list.length || list[0].t > 0) list.unshift({ t: 0, value: canon(el, p, baseValueOf(el, p, an)) });
              if (list[list.length - 1].t < 1) list.push({ t: 1, value: canon(el, p, baseValueOf(el, p, an)) });
              /* curva de toda la iteración (WAAPI con dos keyframes): pasa al tramo */
              if (tm.easing && tm.easing !== "linear" && list.length === 2 && !list[0].easing) list[0].easing = tm.easing;
              else if (tm.easing && tm.easing !== "linear") warn("Una animación con curva general y varios keyframes se aproximó.");
              return { prop: p, keyframes: list, easing: "linear" };
            }).filter(function (tw) { return tw.keyframes.some(function (k, q) { return q && k.value !== tw.keyframes[0].value; }); });
            if (!tweens.length) return;
            var start = (first - t0) + delay, fill = tm.fill || "auto", hold = it === 1 && delay > 0 && (fill === "none" || fill === "forwards" || fill === "auto") && !isTr;
            var clip = { layerId: id, startSec: Math.max(0, start), endSec: Math.max(0, start) + D, tweens: tweens };
            if (it !== 1) clip.iterations = it;
            if (tm.direction && tm.direction !== "normal") clip.direction = tm.direction;
            if (hold) {
              /* antes de su retraso la capa se ve como es (relleno «none»): se arma el tramo con su valor base */
              var a = Math.max(0, first - t0), span = start + D - a, k0 = (start - a) / span;
              clip.startSec = a; clip.endSec = a + span;
              clip.tweens = tweens.map(function (tw) {
                var b = canon(el, tw.prop, baseValueOf(el, tw.prop, an));
                return { prop: tw.prop, easing: "linear", keyframes: [{ t: 0, value: b }, { t: Math.max(0, k0 - 1e-4), value: b }].concat(tw.keyframes.map(function (k) { return { t: k0 + k.t * (1 - k0), value: k.value, easing: k.easing }; })) };
              });
            }
            clips.push(clip);
            if (an.animationName) convertedNames.add(an.animationName);
          } catch (e) { failedCss++; }
        });

        /* ── 2) lo que movió el JS: rastreado y ajustado a pocos keyframes ── */
        var traced = 0;
        touched.forEach(function (rec, el) {
          if (!el.isConnected || !rec.vals) return;
          var id = idOf(el), b0 = base0.get(el), tweens = [], lo = Infinity, hi = -Infinity;
          Object.keys(rec.vals).forEach(function (p) {
            if (/^(animation|transition|will-change|cursor|pointer-events)/.test(p)) return;
            var V = rec.vals[p], T = [], VV = [];
            var first = null; for (var q = 0; q < times.length; q++) if (V[q] != null) { first = q; break; }
            if (first == null) return;
            /* antes de que el código lo tocara: su valor de partida */
            var pre = b0 && (b0.__inline[p] != null ? (p === "transform" ? H.decompose(b0.transform) : b0.__inline[p]) : b0[p] != null ? (p === "transform" ? H.decompose(b0[p]) : b0[p]) : null);
            for (q = 0; q < times.length; q++) { var v = V[q] != null ? V[q] : q < first ? (pre != null ? pre : V[first]) : VV[VV.length - 1]; T.push(times[q]); VV.push(String(v)); }
            if (VV.every(function (x) { return x === VV[0]; })) return;
            var a = 0, z = VV.length - 1; while (a < z && VV[a + 1] === VV[a]) a++; while (z > a && VV[z - 1] === VV[z]) z--;
            lo = Math.min(lo, T[a]); hi = Math.max(hi, T[z]);
            tweens.push({ p: p, T: T, V: VV });
          });
          if (!tweens.length) return;
          if (hi - lo < 0.02) hi = lo + 0.02;
          var out = tweens.map(function (tw) {
            var T = [], V = [];
            tw.T.forEach(function (t, q) { if (t >= lo - 1e-9 && t <= hi + 1e-9) { T.push(t); V.push(tw.V[q]); } });
            var kf = H.fitSeries(T, V).map(function (k) { return { t: Math.round((k.t - lo) / (hi - lo) * 10000) / 10000, value: k.v, easing: k.e && k.e !== "linear" ? k.e : undefined }; });
            return { prop: cam(tw.p), keyframes: kf, easing: "linear" };
          }).filter(function (tw) { return tw.keyframes.length >= 2; });
          if (!out.length) return;
          clips.push({ layerId: id, startSec: Math.round(lo * 1000) / 1000, endSec: Math.round(hi * 1000) / 1000, tweens: out });
          traced++;
        });
        if (probeOnly && traced) warn("El código mueve cosas sin fin con JavaScript: se tomaron " + Math.round(dur) + " s como animación de la lámina.");

        /* ── 3) portada sugerida (decisión 2026-11-16): cuando terminó de entrar todo. Si al final algo sale (una salida),
           el primer instante en que se veía todo. El tamaño de cada cosa se cuenta hasta su tamaño final (un rebote que
           agranda de más no adelanta la portada). ── */
        var poster = 0, nT = times.length;
        visRec.forEach(function (v) {
          var rest = v[nT - 1] ? v[nT - 1][1] : 0; for (var q0 = nT - 1; q0 >= 0 && !rest; q0--) if (v[q0]) rest = v[q0][1];
          for (var q1 = 0; q1 < nT; q1++) { var e = v[q1] || [0, 0]; score[q1] += e[0] * Math.min(e[1], rest || e[1]); }
        });
        var mx = Math.max.apply(null, score.concat([0]));
        var finEnd = clips.reduce(function (m, c) { return c.iterations && c.iterations < 0 ? m : Math.max(m, c.startSec + (c.endSec - c.startSec) * (c.iterations || 1)); }, 0);
        if (mx > 0) {
          var qe = 0; for (var q2 = 0; q2 < nT; q2++) if (times[q2] <= finEnd + 1e-6) qe = q2;
          if (finEnd > 0 && score[qe] >= mx * 0.9) poster = Math.min(times[nT - 1], finEnd);
          else for (var q = 0; q < nT; q++) if (score[q] >= mx * 0.98) { poster = times[q]; break; }
        } else if (finEnd > 0) poster = finEnd;
        else {
          var best = null; cvScore.forEach(function (sr) { if (!sr.length) return; var m2 = Math.max.apply(null, sr.map(function (x) { return x[1]; })); for (var u = 0; u < sr.length; u++) if (sr[u][1] >= m2 * 0.95) { best = best == null ? sr[u][0] : Math.min(best, sr[u][0]); break; } });
          if (best != null) poster = best;
        }
        if (cfg.snapAt != null) poster = Math.max(0, Math.min(dur, +cfg.snapAt - t0));

        /* ── 4) foto del documento ── */
        /* lo que se ve en la portada es lo que queda escrito (los textos que se escriben de a poco, a su largo final) */
        if (cfg.snapAt != null) {
          var ts = +cfg.snapAt;
          if (!window.__mvcStep && ts < t1 - 1e-6) { /* el reloj no vuelve atrás: con timelines se busca; si no, se queda el final */
            tlKeys.forEach(function (k) { try { tls[k].seek(ts, true); } catch (e) { /* idem */ } });
            try { if (window.gsap && gsap.globalTimeline) gsap.globalTimeline.seek(ts, true); } catch (e) { /* idem */ }
          } else if (window.__mvcStep) { var sp2 = window.__mvcStep(ts, 0, fps); if (sp2 && sp2.then) await sp2; }
          timed.forEach(function (el) { var s = +el.getAttribute("data-start") || 0, dd = +el.getAttribute("data-duration"); if (!isFinite(dd) || dd <= 0) dd = 1e9; el.style.visibility = ts >= s && ts < s + dd ? "" : "hidden"; });
        }
        born.forEach(function (n) { if (n.isConnected && !inSvg(n)) { idOf(n); [].forEach.call(n.querySelectorAll ? n.querySelectorAll("*") : [], function (x) { if (!SKIP.test(x.tagName) && !inSvg(x)) idOf(x); }); } });
        /* un tramo de un video: lo que no aparece en ese tramo (clips de otras escenas) no es parte de la lámina */
        if (cfg.range) timed.forEach(function (el) {
          if (el === body || !el.isConnected || el.id === "root" || el.hasAttribute("data-composition-id")) return;
          var s = +el.getAttribute("data-start") || 0, dd = +el.getAttribute("data-duration"); if (!isFinite(dd) || dd <= 0) return;
          var sa = cfg.snapAt != null && isFinite(+cfg.snapAt) ? +cfg.snapAt : t0, lo = Math.min(sa, t0), hi = Math.max(t1, sa + 1e-3);
          if (s + dd <= lo + 1e-6 || s >= hi - 1e-6) {
            var gone = el.querySelectorAll("[data-layer-id]"), ids = new Set([el.getAttribute("data-layer-id")]);
            [].forEach.call(gone, function (x) { ids.add(x.getAttribute("data-layer-id")); });
            for (var ci = clips.length - 1; ci >= 0; ci--) if (ids.has(clips[ci].layerId)) clips.splice(ci, 1);
            el.remove();
          }
        });
        /* las animaciones convertidas dejan de correr en el CSS (ahora viven en la lámina, con su reloj) */
        if (document.getAnimations) document.getAnimations().forEach(function (an) { try { an.cancel(); } catch (e) { /* idem */ } });

        /* tomas de video (<video> de un video de Musa o de una página) → capas de video: muestran el cuadro de la portada y se
           reproducen al presentar. El audio de un video no va a la lámina. */
        function unesc(s) { return String(s).replace(/<(\\+)\/(script)/gi, function (m, bs, w) { return "<" + bs.slice(1) + "/" + w; }).replace(/<(\\+)!--/g, function (m, bs) { return "<" + bs.slice(1) + "!--"; }); }
        var vids = 0;
        [].forEach.call(body.querySelectorAll("video"), function (v) {
          var srcv = v.currentSrc || v.getAttribute("src") || ((v.querySelector("source") || {}).src) || ""; if (!/^https?:/i.test(srcv)) { v.remove(); return; }
          var vs = +v.getAttribute("data-start") || 0, ms = +v.getAttribute("data-media-start") || 0, rate = +v.getAttribute("data-playback-rate") || 1;
          var V = { src: srcv.split("#")[0], start: Math.round(Math.max(0, vs - t0) * 1000) / 1000, "in": Math.round((ms + Math.max(0, t0 - vs) * rate) * 1000) / 1000, rate: rate };
          if (v.getAttribute("data-duration")) V.dur = +v.getAttribute("data-duration");
          v.setAttribute("data-layer-kind", "video"); v.setAttribute("data-layer-name", v.getAttribute("data-name") || "Toma de video");
          v.setAttribute("data-video", encodeURIComponent(JSON.stringify(V)));
          v.setAttribute("src", V.src); v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("preload", "metadata"); v.removeAttribute("autoplay"); v.removeAttribute("controls");
          idOf(v); vids++;
        });
        [].forEach.call(body.querySelectorAll("audio"), function (a) { a.remove(); });

        /* canvas → capas de código vivo */
        var lives = 0, docW = Math.max(W, document.documentElement.scrollWidth), cvAll = canvases();
        cvAll.forEach(function (cv, ci) {
          if (!cv.isConnected) return;
          var r = cv.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return;
          /* un clip de código vivo de un video de Musa trae su propio código al lado: ese es el de la capa, con sus tiempos */
          var own = null;
          if (cv.classList && cv.classList.contains("musa-live")) {
            var sc0 = cv.parentNode && cv.parentNode.querySelector('script[type="text/musa-live"]'), hostM = cv.closest("[data-musa]"), meta = {};
            var dm = {}; try { dm = JSON.parse(hostM.getAttribute("data-musa")) || {}; meta = dm.live || {}; } catch (e) { meta = {}; }
            var clipEl = cv.closest("[data-start]"), cs0 = clipEl ? +clipEl.getAttribute("data-start") || 0 : 0, sp0 = meta.speed != null ? +meta.speed : 1;
            own = { v: 1, src: sc0 ? unesc(sc0.textContent).replace(/^\r?\n/, "").replace(/\r?\n$/, "") : "", kind: meta.kind || cv.getAttribute("data-kind") || "html", sel: meta.sel != null ? meta.sel : -1,
              W: Math.round(r.width), H: Math.round(r.height), fit: "viewport", start: Math.round(Math.max(0, cs0 - t0) * 1000) / 1000,
              off: Math.round(((+meta.off || 0) + Math.max(0, t0 - cs0) * sp0) * 1000) / 1000, speed: sp0, loop: +meta.loop || 0, fps: 30, name: dm.name || "" };
            if (!own.src) own = null;
          }
          var cs = getComputedStyle(cv), full = r.width * r.height >= W * VH * 0.92;
          var div = document.createElement("div"), keep = ["position", "top", "right", "bottom", "left", "z-index", "display", "margin-top", "margin-right", "margin-bottom", "margin-left", "transform", "transform-origin", "opacity", "filter", "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius", "mix-blend-mode", "box-shadow", "pointer-events", "flex-shrink", "align-self", "justify-self", "grid-area", "inset"];
          var style = keep.map(function (p) { var v = cs.getPropertyValue(p); return v ? p + ":" + v : ""; }).filter(Boolean);
          style.push("width:" + Math.round(r.width) + "px", "height:" + Math.round(r.height) + "px", "overflow:hidden", "box-sizing:border-box");
          if (cs.display === "inline") style.push("display:inline-block");
          div.setAttribute("style", style.join(";"));
          if (cv.id) div.id = cv.id; if (cv.className && typeof cv.className === "string") div.className = cv.className;
          var lib = own ? "code" : cfg.lib || "code";
          var L = own || { v: 1, src: cfg.srcLive || cfg.src, kind: cfg.kind === "remotion" ? "remotion" : "html", sel: cvAll.indexOf(cv), W: full ? Math.round(r.width) : W, H: full ? Math.round(r.height) : VH, fit: full ? "viewport" : "canvas", start: 0, off: Math.round(t0 * 1000) / 1000, speed: 1, loop: 0, fps: 30, lib: lib };
          if (own && cv.parentNode) [].forEach.call(cv.parentNode.querySelectorAll('script[type="text/musa-live"]'), function (x) { x.remove(); });
          var nm = (own && own.name) || cv.getAttribute("aria-label") || cv.id || ({ three: "Three.js", "three-r3f": "React Three Fiber", p5: "p5.js", pixi: "PixiJS", lottie: "Lottie", webgl: "WebGL", canvas: "Canvas" }[lib] || "Código") + (cvAll.length > 1 ? " · lienzo " + (ci + 1) : " · escena");
          div.setAttribute("data-layer-kind", "live"); div.setAttribute("data-layer-name", nm);
          div.setAttribute("data-layer-id", cv.getAttribute("data-layer-id") || idOf(cv));
          div.setAttribute("data-live", encodeURIComponent(JSON.stringify(L)));
          cv.parentNode.replaceChild(div, cv);
          lives++;
        });

        /* lo que no se puede guardar */
        var ifr = body.querySelectorAll("iframe").length; if (ifr) warn(ifr + " contenido(s) incrustado(s) (iframe: YouTube, mapas…) no se pueden guardar en un diseño.");
        [].forEach.call(body.querySelectorAll("input,textarea"), function (x) { try { if (x.tagName === "TEXTAREA") x.textContent = x.value; else if (x.type === "checkbox" || x.type === "radio") { if (x.checked) x.setAttribute("checked", ""); else x.removeAttribute("checked"); } else x.setAttribute("value", x.value); } catch (e) { /* idem */ } });
        [].forEach.call(body.querySelectorAll("select"), function (x) { [].forEach.call(x.options, function (o, q) { if (q === x.selectedIndex) o.setAttribute("selected", ""); else o.removeAttribute("selected"); }); });
        [].forEach.call(body.querySelectorAll("script,noscript,template,iframe,object,embed"), function (x) { x.remove(); });
        if (body.querySelectorAll("*").length && [].some.call(body.querySelectorAll("*"), function (x) { return x.shadowRoot; })) warn("Hay componentes con Shadow DOM: su interior quedó como está en el código.");

        /* página traída de una URL: las rutas relativas (imágenes, fuentes, hojas) pasan a absolutas */
        function absUrl(v, base) { if (!v || /^(data:|blob:|#|javascript:|mailto:|tel:|about:)/i.test(v)) return v; try { return new URL(v, base || document.baseURI).href; } catch (e) { return v; } }
        function absCss(text, base) { return String(text).replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, function (m, q, u) { return "url(" + q + absUrl(u.trim(), base) + q + ")"; }); }
        if (cfg.baseUrl) {
          [].forEach.call(body.querySelectorAll("[src],[href],[poster],[srcset],[style*=url]"), function (x) {
            ["src", "href", "poster", "xlink:href"].forEach(function (a) { var v = x.getAttribute(a); if (v && !(a === "href" && x.tagName === "A")) x.setAttribute(a, absUrl(v)); });
            var ss = x.getAttribute("srcset"); if (ss) x.setAttribute("srcset", ss.split(",").map(function (p) { var t = p.trim().split(/\s+/); t[0] = absUrl(t[0]); return t.join(" "); }).join(", "));
            var sv = x.getAttribute("style"); if (sv && /url\(/.test(sv)) x.setAttribute("style", absCss(sv));
          });
        }
        /* ids que el limpiador de Musa quita por seguridad (chocan con propiedades del documento: title, forms, location…):
           se renombran en el HTML y en el CSS, así sus estilos (#title { … }) siguen aplicando */
        var renamed = {}, frm = document.createElement("form");
        [].forEach.call(body.querySelectorAll("[id]"), function (x) {
          var id = x.getAttribute("id"); if (!id) return;
          var risky = false; try { risky = id in document || id in frm; } catch (e) { risky = false; }
          if (!risky) return;
          var nid = id + "-musa", k = 2; while (document.getElementById(nid)) nid = id + "-musa" + k++;
          renamed[id] = nid; x.setAttribute("id", nid);
        });
        var renIds = Object.keys(renamed);
        function reRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
        function renameRefs(text) { renIds.forEach(function (id) { text = text.replace(new RegExp("#" + reRe(id) + "(?![\\w-])", "g"), "#" + renamed[id]); }); return text; }
        if (renIds.length) [].forEach.call(body.querySelectorAll("[href],[for],[aria-labelledby],[aria-describedby],[aria-controls],[style],[fill],[stroke],[clip-path],[mask],[filter],[xlink\\:href]"), function (x) {
          ["href", "xlink:href", "style", "fill", "stroke", "clip-path", "mask", "filter"].forEach(function (a) { var v = x.getAttribute(a); if (v && v.indexOf("#") >= 0) x.setAttribute(a, renameRefs(v)); });
          ["for", "aria-labelledby", "aria-describedby", "aria-controls"].forEach(function (a) { var v = x.getAttribute(a); if (v) x.setAttribute(a, v.split(/\s+/).map(function (t) { return renamed[t] || t; }).join(" ")); });
        });
        /* CSS: todas las hojas (también las que armó el JS: Tailwind, CSS-in-JS), sin las animaciones convertidas */
        var sheets = [], links = [];
        var REM = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        function vwvh(s) {
          /* medidas de la ventana y del documento raíz → px de la lámina (en Musa la «ventana» es el frame entero y el rem, el de Musa) */
          return String(s).replace(/(-?\d*\.?\d+)rem\b/g, function (m, n) { return (Math.round(+n * REM * 100) / 100) + "px"; }).replace(/(-?\d*\.?\d+)(dvh|svh|lvh|vh|dvw|svw|lvw|vw|vmin|vmax)\b/g, function (m, n, u) {
            var v = +n, px = /h$/.test(u) ? v * VH / 100 : /w$/.test(u) ? v * W / 100 : u === "vmin" ? v * Math.min(W, VH) / 100 : v * Math.max(W, VH) / 100;
            return (Math.round(px * 100) / 100) + "px";
          });
        }
        var allConv = !failedCss, BODYSEL = /(^|[\s,>+~(])body(?=$|[\s,>+~.#:[)])/, BODYSELG = /(^|[\s,>+~(])body(?=$|[\s,>+~.#:[)])/g;
        function ruleText(r) {
          if (r.type === 7 /* @keyframes */ && allConv && convertedNames.has(r.name)) return "";
          if (r.type === 1 && r.selectorText && BODYSEL.test(r.selectorText)) {
            /* lo que el código le daba al <body> va a su caja de página (en Musa la lámina ya hace de body) */
            try { r.selectorText = r.selectorText.replace(BODYSELG, "$1[data-musa-body]"); } catch (e) { /* selector raro */ }
          }
          if (r.type === 1 && allConv && r.style) {
            ["animation", "animation-name", "animation-duration", "animation-timing-function", "animation-delay", "animation-iteration-count", "animation-direction", "animation-fill-mode", "animation-play-state", "animation-composition", "animation-timeline", "animation-range"].forEach(function (p) { try { r.style.removeProperty(p); } catch (e) { /* idem */ } });
            if (!r.style.length) return "";
          }
          if (r.type === 3 /* @import */) { try { if (r.styleSheet && r.styleSheet.cssRules) return [].map.call(r.styleSheet.cssRules, ruleText).join("\n"); } catch (e) { /* de otro sitio */ } return r.cssText; }
          if (r.cssRules && (r.type === 4 || r.type === 12 || r.type === 0 || /^@(media|supports|layer|container)/.test(r.cssText))) {
            var head = r.cssText.slice(0, r.cssText.indexOf("{")).trim();
            var inner = [].map.call(r.cssRules, ruleText).filter(Boolean).join("\n");
            return inner ? head + "{" + inner + "}" : "";
          }
          return r.cssText;
        }
        [].forEach.call(document.styleSheets, function (sh) {
          var own = sh.ownerNode; if (own && own.getAttribute && own.getAttribute("data-mdb")) return;
          var rs; try { rs = sh.cssRules; } catch (e) { if (sh.href) links.push(sh.href); return; }
          var txt = [].map.call(rs, ruleText).filter(Boolean).join("\n");
          sheets.push(cfg.baseUrl || sh.href ? absCss(txt, sh.href || document.baseURI) : txt);
        });
        try { (document.adoptedStyleSheets || []).forEach(function (sh) { sheets.push([].map.call(sh.cssRules, ruleText).filter(Boolean).join("\n")); }); } catch (e) { /* idem */ }
        if (pseCount) sheets.push(NOPSE);
        if (allConv) [].forEach.call(body.querySelectorAll("[style*=animation]"), function (x) { x.style.removeProperty("animation"); x.style.removeProperty("animation-name"); });
        [].forEach.call(body.querySelectorAll("[style]"), function (x) { var s = x.getAttribute("style"); if (/(v(h|w|min|max)|rem)\b/.test(s)) x.setAttribute("style", vwvh(s)); });

        /* el body propio (clases de Tailwind, fondo) va a una caja que ocupa la lámina */
        var bcs = getComputedStyle(body), hcs = getComputedStyle(document.documentElement);
        var bg = !/rgba\(0, 0, 0, 0\)|transparent/.test(bcs.backgroundColor) ? bcs.backgroundColor : !/rgba\(0, 0, 0, 0\)|transparent/.test(hcs.backgroundColor) ? hcs.backgroundColor : "#ffffff";
        /* una página que no se desplaza (overflow hidden: escenas 3D, posts) mide la ventana; si se desplaza, todo su alto */
        var noScroll = /hidden|clip/.test(getComputedStyle(document.documentElement).overflowY + " " + getComputedStyle(body).overflowY);
        var docH = noScroll ? VH : Math.max(VH, Math.ceil(Math.max(document.documentElement.scrollHeight, body.scrollHeight)));
        var fixed = cfg.fixedSize ? { w: cfg.W, h: cfg.H } : null;
        var outW = fixed ? fixed.w : docW, outH = fixed ? fixed.h : docH;
        /* la caja de página reproduce el <body> tal cual se veía (márgenes, relleno, fondo, tipografía, flex/grid) */
        var bbr = body.getBoundingClientRect(), wrapCss = ["position:relative", "width:" + Math.round(bbr.width) + "px", "min-height:" + Math.max(0, Math.round(outH - (parseFloat(bcs.marginTop) || 0) - (parseFloat(bcs.marginBottom) || 0))) + "px", "box-sizing:border-box"];
        ["margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right", "padding-bottom", "padding-left", "background-color", "background-image", "background-size", "background-position", "background-repeat",
          "color", "font-family", "font-size", "line-height", "font-weight", "letter-spacing", "text-align", "text-rendering", "-webkit-font-smoothing", "display", "flex-direction", "flex-wrap", "align-items", "justify-content", "align-content", "row-gap", "column-gap",
          "grid-template-columns", "grid-template-rows", "justify-items"].forEach(function (p) {
          var v = bcs.getPropertyValue(p);
          if (!v || v === "none" || /rgba\(0, 0, 0, 0\)/.test(v) || (p === "display" && v === "block") || (/^(align|justify)/.test(p) && (v === "normal" || v === "legacy")) || (/gap$/.test(p) && v === "normal")) return;
          wrapCss.push(p + ":" + vwvh(v));
        });
        /* lo heredado del body viaja también en cada sección (si el diseño se separa en varios frames, cada uno lo lleva) */
        [].forEach.call(body.children, function (k) {
          if (SKIP.test(k.tagName) || !k.style) return;
          ["font-family", "color", "font-size", "line-height", "font-weight", "letter-spacing", "-webkit-font-smoothing"].forEach(function (p) { if (!k.style.getPropertyValue(p)) { var v = bcs.getPropertyValue(p); if (v) k.style.setProperty(p, vwvh(v)); } });
        });
        var bodyCls = body.getAttribute("class") || "";
        var head = '<meta charset="utf-8"><meta name="musa-size" content="' + outW + "x" + outH + '">'
          + (cfg.title ? "<title>" + String(cfg.title).replace(/</g, "&lt;") + "</title>" : "")
          + links.map(function (h) { return '<link rel="stylesheet" href="' + String(h).replace(/"/g, "%22") + '">'; }).join("")
          + "<style>" + renameRefs(vwvh(sheets.join("\n"))).replace(/<\/style/gi, "<\\/style") + "\nhtml,body{margin:0;padding:0}</style>";
        var html = "<!doctype html><html><head>" + head + '</head><body style="margin:0;background:' + bg + '"><div data-musa-body="1" data-layer-kind="container" data-layer-name="Página"' + (bodyCls ? ' class="' + bodyCls.replace(/"/g, "&quot;") + '"' : "") + ' style="' + wrapCss.join(";").replace(/"/g, "'") + '">' + body.innerHTML + "</div></body></html>";

        var lastEnd = clips.reduce(function (m, c) { var it = c.iterations == null ? 1 : c.iterations; return it < 0 ? Math.max(m, c.endSec) : Math.max(m, c.startSec + (c.endSec - c.startSec) * it); }, 0);
        post("done", {
          html: html, W: outW, H: outH, viewW: W, viewH: VH, bg: bg,
          animation: clips.length || lives ? { clips: clips, durationSec: Math.max(0.5, Math.min(600, Math.round(Math.max(lastEnd, poster, cfg.range ? dur : 0) * 1000) / 1000 || 5)), loop: "once", poster: Math.round(poster * 1000) / 1000 } : null,
          stats: { clips: clips.length, traced: traced, pseudo: pseCount, live: lives, videos: vids, failedCss: failedCss, elements: body.querySelectorAll("[data-layer-id]").length },
          warnings: warnings.concat((window.__mvcErrors || []).slice(0, 3).map(function (e) { return "Error del código: " + e; })),
        });
      } catch (e) { post("error", String(e && e.stack || e)); }
    }
    run();
  }

  /* ═════════════ armar el documento del sandbox ═════════════ */
  function bakeDoc(src, cfg, ML) {
    var pre = "<script>window.__name=window.__name||function(f){return f;};(" + ML.preludeLive.toString() + ")({ ov: {} });(" + ioPrelude.toString() + ")();<\/script>";
    var helpers = "<script>window.__mdcH=(" + helpersMain.toString() + ")();<\/script>";
    var bk = "<script>(" + bakerMain.toString() + ")(" + JSON.stringify(cfg).replace(/<\/script/gi, "<\\/script") + ");<\/script>";
    var base = cfg.baseUrl ? '<base href="' + String(cfg.baseUrl).replace(/"/g, "%22") + '">' : "";
    if (cfg.kind === "remotion") {
      var im = cfg.r3 ? '<script type="importmap">' + JSON.stringify({ imports: ML.R3_IMPORTS }) + "<\/script>" : "";
      return "<!doctype html><html><head><meta charset=\"utf-8\">" + base + pre + im + ML.LIBS_REMOTION.map(function (u) { return '<script src="' + u + '"><\/script>'; }).join("")
        + "<style>html,body{margin:0;overflow:hidden}#mvc-root{position:relative;overflow:hidden}</style></head><body><div id=\"mvc-root\"></div>"
        + "<script>window.__mvcSource = " + JSON.stringify(String(src)).replace(/<\/script/gi, "<\\/script") + ";(" + ML.remotionMain.toString() + ")(" + JSON.stringify({ W: cfg.W, H: cfg.H, fps: 30, dur: cfg.dur || 10, r3: !!cfg.r3 }) + ");<\/script>" + helpers + bk + "</body></html>";
    }
    var s = String(src);
    if (cfg.kind === "jsx") s = wrapJsx(s);
    s = ML.prep(s);
    if (!/<html|<body|<head/i.test(s)) s = "<!doctype html><html><head><meta charset=\"utf-8\"></head><body>" + s + "</body></html>";
    var m = /<head[^>]*>/i.exec(s);
    if (m) s = s.slice(0, m.index + m[0].length) + base + pre + s.slice(m.index + m[0].length);
    else { var hm = /<html[^>]*>/i.exec(s); s = hm ? s.slice(0, hm.index + hm[0].length) + "<head>" + base + pre + "</head>" + s.slice(hm.index + hm[0].length) : base + pre + s; }
    var be = s.search(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i);
    return be >= 0 ? s.slice(0, be) + helpers + bk + s.slice(be) : s + helpers + bk;
  }

  /* tamaño de la ventana: el que diga el código (meta, data-width, body con ancho fijo) o el pedido */
  function guessView(src, want) {
    var s = String(src || "");
    var meta = /<meta[^>]+name=["']musa[-:]size["'][^>]*content=["'](\d{2,5})\s*[x×]\s*(\d{2,5})/i.exec(s) || /<meta[^>]*content=["'](\d{2,5})\s*[x×]\s*(\d{2,5})["'][^>]*name=["']musa[-:]size/i.exec(s);
    var dw = /data-width\s*=\s*["']?(\d{2,5})/.exec(s), dh = /data-height\s*=\s*["']?(\d{2,5})/.exec(s);
    var bw = /body\s*\{[^}]*\bwidth\s*:\s*(\d{2,5})px/i.exec(s), bh = /body\s*\{[^}]*\bheight\s*:\s*(\d{2,5})px/i.exec(s);
    if (want && want.w && want.h) return { W: want.w, H: want.h, fixed: true };
    if (meta) return { W: +meta[1], H: +meta[2], fixed: true };
    if (dw && dh) return { W: +dw[1], H: +dh[1], fixed: true };
    if (bw && bh) return { W: +bw[1], H: +bh[1], fixed: true };
    return { W: (want && want.w) || 1080, H: (want && want.h) || 1080, fixed: false };
  }

  /* ═════════════ hornear (en el navegador): el código corre en un iframe aislado y vuelve el diseño ═════════════ */
  function bake(src, opts) {
    opts = opts || {};
    var ML = opts.ML || (typeof globalThis !== "undefined" && globalThis.MusaVideoLive);
    if (!ML) return Promise.reject(new Error("falta video-live-core.js"));
    if (typeof document === "undefined") return Promise.reject(new Error("hornear necesita un navegador"));
    var d = detect(src), view = guessView(src, opts.size);
    var token = "mdb" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    var cfg = { token: token, src: String(src), srcLive: d.kind === "jsx" ? wrapJsx(src) : String(src), kind: d.kind === "remotion" ? "remotion" : d.kind === "jsx" ? "jsx" : "html", lib: ML.libOf(String(src)), W: view.W, H: view.H, fixedSize: view.fixed && !!opts.keepSize,
      range: opts.range || null, snapAt: opts.snapAt != null ? +opts.snapAt : null, fps: opts.fps || 0, maxDur: opts.maxDur || 30, baseUrl: opts.baseUrl || "", title: opts.title || "", pseudo: opts.pseudo !== false,
      r3: d.kind === "remotion" && ML.usesR3({ kind: "remotion", src: String(src) }), dur: opts.dur || 0 };
    return new Promise(function (resolve, reject) {
      var fr = document.createElement("iframe");
      fr.setAttribute("sandbox", "allow-scripts"); fr.setAttribute("aria-hidden", "true"); fr.setAttribute("title", "horneado de código"); fr.tabIndex = -1;
      fr.style.cssText = "position:fixed;left:-40000px;top:0;border:0;opacity:0;pointer-events:none;width:" + view.W + "px;height:" + view.H + "px";
      var done = false, to = setTimeout(function () { finish(new Error("el código tardó demasiado en armarse (más de " + Math.round((opts.timeoutMs || 150000) / 1000) + " s)")); }, opts.timeoutMs || 150000);
      function finish(err, data) { if (done) return; done = true; clearTimeout(to); window.removeEventListener("message", on); try { fr.remove(); } catch (e) { /* ya no está */ } if (err) reject(err); else resolve(data); }
      function on(e) {
        var m = e.data; if (!m || m.__mdb !== token || e.source !== fr.contentWindow) return;
        if (m.type === "progress" && opts.onProgress) opts.onProgress(m.data.i / Math.max(1, m.data.n));
        else if (m.type === "done") { var r = m.data; r.detect = d; r.view = view; finish(null, r); }
        else if (m.type === "error") finish(new Error(String(m.data).split("\n")[0]));
      }
      window.addEventListener("message", on);
      fr.srcdoc = bakeDoc(src, cfg, ML);
      (opts.host || document.body).appendChild(fr);
    });
  }

  return {
    VERSION: VERSION, H: H, helpersMain: helpersMain, decompose: H.decompose, fitSeries: H.fitSeries,
    LIVE_KEYS: LIVE_KEYS, cleanLive: cleanLive, encLive: encLive, decLive: decLive, liveTime: liveTime, liveHtml: liveHtml,
    detect: detect, isHtml: isHtml, wrapJsx: wrapJsx, guessView: guessView, ioPrelude: ioPrelude, bakerMain: bakerMain, bakeDoc: bakeDoc, bake: bake,
  };
});
