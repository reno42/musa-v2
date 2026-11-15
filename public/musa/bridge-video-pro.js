/* bridge-video-pro.js — editor de video: lo que pidió Instinct para que un video quede editable (QA 2026-11-11).
 *
 * Textos (T) y media (M) dejan de ser clips «de una sola animación»:
 *   · keyframes (posición, escala, rotación, opacidad) con auto-key en el playhead, como las capas de escena;
 *   · efectos de movimiento (pulse, shake, wiggle, glow…) que antes solo servían en V1;
 *   · brillo/halo de color en textos y media; formas (círculo, rectángulo, píldora), halos y degradados;
 *   · fondo del proyecto en degradado.
 * Subir imágenes (pista M) y audio propio (pista A, también suena al reproducir); logos de tus marcas como isotipo real;
 * más fuentes (JetBrains Mono, Space Grotesk… o cualquiera de Google Fonts).
 * UX: el texto se ajusta solo al ancho (no salta de línea), lo agregado aparece a la vista, con un texto elegido lo que
 * escribes va al texto (no dispara atajos), el inspector vuelve arriba al cambiar de clip, el timeline se compacta con
 * muchas filas, clic en vacío mueve el playhead sin perder la selección, nombre del proyecto completo y accesibilidad.
 * El MP4 usa el mismo cálculo (window.__vePro.state / fitSize) que la vista previa: lo que ves es lo que exporta.
 */
(function () {
  "use strict";
  if (typeof VE === "undefined" || typeof capHTML !== "function") return;
  function RB() { return window.__musaReal || {}; }
  function bridge() { try { return window.parent.__musaBridge; } catch (e) { return null; } }
  function api(url, init) { var b = bridge(); return b ? b.api(url, init) : Promise.reject(new Error("sin conexión")); }
  function jpost(body) { return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }; }
  var r1 = function (v) { return Math.round(v * 100) / 100; };
  var cl = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function toast(m) { if (typeof vtoast === "function") vtoast(m); }
  function W0() { var f = VFMT[(VE.p && VE.p.fmt) || "9:16"] || VFMT["9:16"]; return f[0]; }
  var BRAND = "#ff5e00";

  /* ═════ fuentes ═════ */
  var GF = ["JetBrains Mono", "Space Grotesk", "Space Mono", "Syne", "Poppins", "Montserrat", "DM Sans", "Manrope", "Sora", "Outfit", "Rubik", "Bebas Neue", "Oswald", "Archivo Black", "Playfair Display", "Lora", "IBM Plex Mono", "Caveat"];
  var loaded = { Inter: 1, Anton: 1, Georgia: 1, Mono: 1 };
  function familyCss(n) { return "'" + n + "'," + (/mono/i.test(n) ? "monospace" : /playfair|lora/i.test(n) ? "serif" : "sans-serif"); }
  function addFont(n) {
    if (!n || !/^[A-Za-z0-9 ]{2,40}$/.test(n)) return false;
    if (!FONTS[n]) FONTS[n] = familyCss(n);
    if (!VFONTS.some(function (f) { return f[0] === n; })) VFONTS.splice(VFONTS.length, 0, [n, n]);
    return true;
  }
  function ensureFont(n) {
    if (!n || loaded[n] || !FONTS[n]) return;
    loaded[n] = 1;
    var l = document.createElement("link"); l.rel = "stylesheet";
    /* API v1: tolera pesos que la fuente no tiene (la v2 responde 400) */
    l.href = "https://fonts.googleapis.com/css?family=" + encodeURIComponent(n).replace(/%20/g, "+") + ":400,500,700,800,900&display=swap";
    l.onload = function () { if (document.fonts) document.fonts.load("700 40px " + FONTS[n]).then(function () { if (VE.open) { veStage(); } }, function () {}); };
    document.head.appendChild(l);
  }
  /* «Mono» ahora es JetBrains Mono de verdad (antes caía a Courier) */
  FONTS.Mono = "'JetBrains Mono','Courier New',monospace";
  loaded.Mono = 0; FONTS["JetBrains Mono"] = FONTS["JetBrains Mono"] || familyCss("JetBrains Mono");
  GF.forEach(addFont);
  var _ensureMono = function () { ensureFont("JetBrains Mono"); };

  /* ═════ estado de un clip libre en un instante (vista previa y exportación) ═════ */
  var FX_FREE = [["none", "Ninguno"], ["pulse", "Pulse (latido)"], ["glow", "Glow (brillo)"], ["shake", "Shake (temblor)"], ["wiggle", "Wiggle (balanceo)"], ["flicker", "Flicker (parpadeo)"], ["drift", "Deriva"], ["float", "Flotar"], ["spin", "Girar"], ["pop-in", "Pop"], ["rotate-in", "Rotar entrada"], ["slide-bounce", "Rebote"], ["zoom-out-soft", "Zoom suave"], ["ken-burns", "Acercamiento lento"]];
  function fxVals(fx, lt, dur) {
    var v = { dx: 0, dy: 0, s: 1, r: 0, o: 1, glow: false }, p = cl(lt / (dur || 1), 0, 1), s = Math.min(1, lt / 0.6);
    switch (fx) {
      case "shake": v.dx = Math.sin(lt * 41) * 10; v.dy = Math.cos(lt * 33) * 10; break;
      case "pulse": v.s = 1 + 0.06 * Math.sin(lt * 6); break;
      case "glow": v.glow = true; v.s = 1 + 0.02 * Math.sin(lt * 4); break;
      case "fade-in": v.o = s; break;
      case "pop-in": v.s = 0.7 + 0.3 * EASE["back-out"](Math.min(1, lt / 0.4)); break;
      case "ken-burns": v.s = 1 + 0.18 * p; break;
      case "rotate-in": v.r = (1 - EASE["ease-out"](s)) * -15; v.s = 0.9 + 0.1 * s; break;
      case "slide-bounce": v.dy = (1 - EASE["back-out"](s)) * 120; break;
      case "wiggle": v.r = Math.sin(lt * 10) * 4; break;
      case "flicker": v.o = 0.75 + 0.25 * Math.abs(Math.sin(lt * 23) * Math.sin(lt * 7)); break;
      case "drift": v.dx = p * 40; v.dy = -p * 25; break;
      case "float": v.dy = Math.sin(lt * 2.4) * 18; break;
      case "spin": v.r = lt * 90; break;
      case "zoom-out-soft": v.s = 1.18 - 0.18 * p; break;
    }
    return v;
  }
  /* curva suave entre keyframes (Catmull-Rom en X/Y): con 3+ puntos el recorrido es una curva, no una línea
     quebrada — así salen órbitas y espirales. Escala, rotación y opacidad siguen la interpolación normal. */
  function sampleSmooth(kf, t) {
    var base = sampleKf(kf, t);
    if (!kf || kf.length < 3 || t <= kf[0].t || t >= kf[kf.length - 1].t) return base;
    var i = kf.findIndex(function (k) { return k.t > t; }) - 1;
    var p0 = kf[Math.max(0, i - 1)], p1 = kf[i], p2 = kf[i + 1], p3 = kf[Math.min(kf.length - 1, i + 2)];
    var u = (t - p1.t) / (p2.t - p1.t), u2 = u * u, u3 = u2 * u;
    var cr = function (a, b, c, d) { return 0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3); };
    base.x = cr(p0.x, p1.x, p2.x, p3.x); base.y = cr(p0.y, p1.y, p2.y, p3.y);
    /* entre dos puntos la escala/rotación van lineales (sin el «frenado» del ease en cada punto de la órbita) */
    ["s", "r", "o"].forEach(function (q) { base[q] = p1[q] + (p2[q] - p1[q]) * u; });
    return base;
  }
  /* trayectorias listas: generan los keyframes del clip (se editan después como cualquier keyframe) */
  function pathKfs(kind, o) {
    var from = cl(+o.from || 0, 0, o.dur), d = cl(+o.len || 2, 0.2, Math.max(0.2, o.dur - from)), R = +o.r || 300, turns = +o.turns || 1, out = [];
    var add = function (u, x, y, s, r, op) { out.push({ t: r1(from + u * d), x: r1(x), y: r1(y), s: r1(s), r: r1(r), o: r1(op) }); };
    var N = Math.max(8, Math.round(12 * turns));
    if (kind === "orbit") for (var i = 0; i <= N; i++) { var a = i / N * Math.PI * 2 * turns; add(i / N, R * Math.cos(a), R * 0.55 * Math.sin(a), 1, 0, 1); }
    if (kind === "spiral") for (var j = 0; j <= N; j++) { var u = j / N, a2 = u * Math.PI * 2 * turns, rr = R * (1 - u); add(u, rr * Math.cos(a2), rr * 0.55 * Math.sin(a2), 1 - 0.8 * u, u * 360 * turns, j === N ? 0.9 : 1); }
    if (kind === "arc") { for (var m = 0; m <= 8; m++) { var v = m / 8; add(v, -R + 2 * R * v, -Math.sin(v * Math.PI) * R * 0.6, 1, 0, 1); } }
    if (kind === "in-left") { add(0, -R * 3, 0, 1, 0, 0); add(0.7, 20, 0, 1, 0, 1); add(1, 0, 0, 1, 0, 1); }
    if (kind === "collapse") { add(0, 0, 0, 1, 0, 1); add(0.6, 0, 0, 1.08, 0, 1); add(1, 0, 0, 0.05, 0, 0); }
    return out;
  }
  /* morph: el texto se transforma en otro (desenfoque cruzado) desde morphAt durante morphD segundos */
  function morphP(c, lt) {
    if (!c.morphTo) return null;
    return cl((lt - (c.morphAt != null ? +c.morphAt : c.dur / 2)) / (c.morphD != null ? +c.morphD : 0.6), 0, 1);
  }
  /* «Palabra por palabra»: cada palabra aparece entera, cada wordGap s o en los tiempos que escribas (QA Instinct) */
  function wordTimesOf(c) {
    var n = (String(c.text || "").match(/\S+/g) || []).length, gap = +c.wordGap > 0 ? +c.wordGap : 0.25;
    var own = String(c.wordTimes || "").split(/[,;\s]+/).filter(Boolean).map(Number).filter(function (x) { return isFinite(x); });
    var out = []; for (var i = 0; i < n; i++) out.push(own[i] != null ? own[i] : (own.length ? own[own.length - 1] + (i - own.length + 1) * gap : i * gap));
    return out;
  }
  function wordsChars(c, lt) {
    var txt = String(c.text || ""); if (!txt) return 1;
    var re = /\S+/g, ends = [], m; while ((m = re.exec(txt))) ends.push(m.index + m[0].length);
    var ts = wordTimesOf(c), k = 0; ts.forEach(function (t0) { if (lt >= t0) k++; });
    return k ? ends[Math.min(k, ends.length) - 1] / txt.length : 0;
  }
  /* «Llega volando»: entra grande desde fuera y se asienta (los íconos que convergen) */
  var _entryQA = entry;
  entry = function (kind, raw, ease) {
    if (kind === "fly-in") { var q = EASE["ease-out"](raw); return { o: Math.min(1, raw * 2.5), s: 2.6 - 1.6 * q, dy: -(1 - q) * 420 }; }
    if (kind === "words") return {};
    return _entryQA.apply(this, arguments);
  };
  function state(c, t, kind) {
    var lt = t - c.start;
    /* QA Instinct v12: la entrada dura lo que digas (antes siempre 0,5 s: un fundido corto no existía) */
    var eD = +c.enD > 0 ? +c.enD : 0.5;
    /* la media entra desde el primer cuadro (antes ese cuadro salía opaco y luego bajaba: un parpadeo) */
    var en = kind === "t" ? entry(c.anim, cl(lt / eD, 0, 1), "ease-out") : (lt < 0 ? {} : entry(c.anim || "fade", cl(lt / eD, 0, 1)));
    if (kind === "t" && c.anim === "words") en = { chars: wordsChars(c, lt) };
    if (c.anim === "stack") en = stackEn(c, lt);
    /* con ráfaga de cámara la entrada solo funde: si además encogiera, se perdería el arranque gigante (QA Instinct T9) */
    if (c.orb && +c.orb.bs > 1) en = { o: lt < 0 ? 0 : Math.min(1, lt / 0.12) };
    /* el destino de un morph entra con el morph, no con su propia entrada */
    if (morphSrc(c)) en = {};
    /* con «Morph hacia otro clip» la salida la hace el morph (no el desvanecido automático del final del texto) */
    var out = kind === "t" && !c.morphClip ? cl((c.start + c.dur - t) / 0.25, 0, 1) : 1;
    /* keyframes con Z, curva por keyframe (spring, bezier…), órbita propia y recorrido dibujado (QA reel Comfy v3) */
    var k = sampleK(c, lt), f = fxVals(c.fx, lt, c.dur), ob = orbV(c, lt), pv = pathV(c, lt, k);
    var st = {
      dx: (en.dx || 0) + (k.x || 0) + f.dx + ob.x + pv.x, dy: (en.dy || 0) + (k.y || 0) + f.dy + ob.y + pv.y,
      s: (en.s != null ? en.s : 1) * (k.s != null ? k.s : 1) * f.s * (ob.s != null ? ob.s : 1), r: (en.r || 0) + (k.r || 0) + f.r + (ob.r || 0),
      o: (en.o != null ? en.o : 1) * (k.o != null ? k.o : 1) * f.o * out * (kind === "m" ? (c.opacity != null ? c.opacity : 1) : 1) * (ob.o != null ? ob.o : 1),
      blur: (en.blur || 0) + (ob.blur || 0) + Math.max(0, +k.b || 0), chars: en.chars, clip: en.clip || "", glow: f.glow, z: (k.z || 0) + ob.z,
    };
    morphClipFx(c, t, kind, st);
    project3d(c, st);
    /* QA Instinct v16: grupo como objeto (precomp) y cámara animada; expresiones; desenfoque de movimiento real */
    if (typeof groupFx === "function") groupFx(c, t, st);
    if (typeof exprFx === "function") exprFx(c, t, kind, st);
    if (typeof mbFx === "function") mbFx(c, t, kind, st);
    return st;
  }
  /* el texto se ajusta solo al ancho del lienzo (no salta de línea: «IS YOUR» en 260 px en 9:16) */
  var mc = document.createElement("canvas").getContext("2d");
  function fitSize(c, W) {
    var size = +c.size || 64;
    if (c.autofit === false || c.exact) return size;
    ensureFont(c.font);
    mc.font = (c.weight || 800) + " " + size + "px " + (FONTS[c.font] || FONTS.Inter);
    var w = Math.max.apply(null, String(c.text || " ").split("\n").map(function (l) { return mc.measureText(l).width; }));
    var pad = c.bg ? size * 1.1 : 0, maxW = (W || W0()) * 0.92;
    return w + pad > maxW ? Math.max(8, Math.floor(size * maxW / (w + pad))) : size;
  }
  function gradCss(g) {
    if (!g) return null;
    var a = g.a || BRAND, b = g.type === "halo" ? (hex6(a) || BRAND) + "00" : (g.b || "#111111");
    if (g.type === "radial" || g.type === "halo") return "radial-gradient(circle at 50% 50%," + a + " 0%," + b + (g.type === "halo" ? " 70%)" : " 100%)");
    if (g.type === "rings") { var gp = Math.max(20, +g.gap || 150), rw = Math.max(1, +g.rw || 10), b0 = g.b || "#f9f9f2", a0 = g.a || "#e4dcf7";
      return "repeating-radial-gradient(circle at 50% 50%," + b0 + " 0px," + b0 + " " + (gp - rw * 1.5) + "px," + a0 + " " + (gp - rw / 2) + "px," + a0 + " " + (gp + rw / 2 - rw) + "px," + b0 + " " + (gp) + "px)"; }
    return "linear-gradient(" + (g.angle != null ? g.angle : 135) + "deg," + a + "," + b + ")";
  }
  function glowCss(c, on) { return c.glow || (on ? (c.color || "#ffffff") : ""); }
  window.__vePro = { maskPath: function () { return maskPath.apply(null, arguments); }, adjFilter: function () { return adjFilter.apply(null, arguments); }, gainAt: function () { return gainAt.apply(null, arguments); }, stabAt: function () { return stabAt.apply(null, arguments); }, state: state, fitSize: fitSize, gradCss: gradCss, fxVals: fxVals, ensureFont: ensureFont, FONTS: FONTS, morphP: morphP, pathKfs: pathKfs, order: order, bgOf: bgOf, sampleK: sampleK };

  /* ═════ vista previa: textos y media ═════ */
  capHTML = function (c, t) {
    var st = state(c, t, "t"), size = fitSize(c, W0());
    ensureFont(c.font);
    var txt = st.chars != null ? c.text.slice(0, Math.round(c.text.length * st.chars)) : c.text;
    var g = glowCss(c, st.glow), gr = c.glowR != null ? +c.glowR : 24;
    var sel = VE.sel && VE.sel.tr === "t" && VE.p && VE.p.t[VE.sel.i] === c;
    return '<div class="ve-cap" data-ti="' + (VE.p ? VE.p.t.indexOf(c) : -1) + '" style="left:' + c.x + "%;top:" + c.y + "%;font-family:" + (FONTS[c.font] || FONTS.Inter) + ";font-size:" + size + "px;font-weight:" + c.weight + ";color:" + c.color + ";"
      + (c.bg ? "background:" + c.bg + ";padding:.2em .55em;border-radius:.35em;" : "")
      + (c.autofit === false && !c.exact ? "" : "white-space:pre;max-width:none;")
      /* traído de un diseño o de código: líneas tal cual, espaciado entre letras y cursiva */
      + (c.ls ? "letter-spacing:" + c.ls + "px;" : "") + (c.italic ? "font-style:italic;" : "")
      + "transform:translate(-50%,-50%) translate(" + r1(st.dx) + "px," + r1(st.dy) + "px) rotate(" + r1(st.r) + "deg) scale(" + r1(st.s) + ");opacity:" + r1(st.o)
      + (g ? ";text-shadow:0 0 " + r1(gr * 0.4) + "px " + g + ",0 0 " + gr + "px " + g + ",0 0 " + r1(gr * 2) + "px " + g : "")
      + (st.blur ? ";filter:blur(" + r1(st.blur) + "px)" : "") + (st.clip ? ";clip-path:" + st.clip : "")
      + (sel ? ";outline:5px solid #ff5e00;outline-offset:8px" : "") + '">' + morphInner(c, t, txt) + "</div>";
  };
  /* el morph: los dos textos en la misma celda, uno se desenfoca y se va mientras el otro llega */
  function morphInner(c, t, txt) {
    var mp = morphP(c, t - c.start);
    if (mp == null || mp <= 0) return eesc(txt);
    if (mp >= 1) return eesc(c.morphTo);
    var span = function (s, op, bl) { return '<span style="grid-area:1/1;opacity:' + r1(op) + ";filter:blur(" + r1(bl) + 'px)">' + eesc(s) + "</span>"; };
    return '<span style="display:inline-grid;place-items:center">' + span(txt, 1 - mp, mp * 14) + span(c.morphTo, mp, (1 - mp) * 14) + "</span>";
  }
  mediaHTML = function (c, t) {
    var st = state(c, t, "m"), bg = c.grad ? gradCss(c.grad) : bgOf(c), g = glowCss(c, st.glow), gr = c.glowR != null ? +c.glowR : 24;
    var sel = VE.sel && VE.sel.tr === "m" && VE.p && VE.p.m[VE.sel.i] === c;
    return '<div class="ve-media" data-mi="' + (VE.p ? VE.p.m.indexOf(c) : -1) + '" style="left:' + c.x + "%;top:" + c.y + "%;width:" + c.w + "%;aspect-ratio:" + (c.ar || 1) + ";background:" + bg + ";border-radius:" + (c.shape === "circle" ? "50%" : (c.radius || 0) + "px")
      + ";transform:translate(-50%,-50%) translate(" + r1(st.dx) + "px," + r1(st.dy) + "px) rotate(" + r1(st.r) + "deg) scale(" + r1(st.s) + ");opacity:" + r1(st.o)
      + (g || st.blur ? ";filter:" + (g ? "drop-shadow(0 0 " + gr + "px " + g + ")" : "") + (st.blur ? " blur(" + r1(st.blur) + "px)" : "") : "")
      + (sel ? ";outline:5px solid #ff5e00;outline-offset:6px" : "") + '"></div>';
  };

  /* ═════ inspector: keyframes, efecto, brillo, ajuste, relleno ═════ */
  function objSel() { var s = VE.sel; return s && (s.tr === "t" || s.tr === "m") ? VE.p[s.tr][s.i] : null; }
  function lt0(o) { return r1(cl(VE.t - o.start, 0, o.dur)); }
  var hexOr = function (v, d) { return hex6(v) || d; };
  var numF = function (k, l, v, step) { return '<label class="ef"><span>' + l + '</span><input type="number" step="' + (step || 1) + '" data-pk="' + k + '" value="' + r1(+v || 0) + '"></label>'; };
  var selF = function (k, l, v, opts, full) { return '<label class="ef' + (full ? " full" : "") + '"><span>' + l + '</span><select data-pk="' + k + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (String(o[0]) === String(v) ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>"; };
  var colF = function (k, l, v) { return '<label class="ef"><span>' + l + '</span><input type="color" data-pk="' + k + '" value="' + hexOr(v, "#ff5e00") + '" aria-label="' + l + '"></label>'; };
  function kfSec(o) {
    var lt = lt0(o), k = sampleK(o, lt), at = (o.kf || []).find(function (x) { return Math.abs(x.t - lt) < 0.02; });
    var isLast = at && o.kf.indexOf(at) === o.kf.length - 1;
    var curveF = !at ? '<div class="ed-note" style="grid-column:1/-1">Pon el playhead sobre un keyframe para elegir su curva (spring, ease…).</div>'
      : isLast ? '<div class="ed-note" style="grid-column:1/-1">Es el último keyframe: la curva se elige en el keyframe anterior.</div>'
      : selF("ke.e", "Curva hasta el siguiente keyframe", at.e || "auto", EASES, true)
        + (at.e === "spring" ? numF("ke.sb", "Rebote (%)", at.sb != null ? at.sb : 50) + numF("ke.sv", "Velocidad (%)", at.sv != null ? at.sv : 50) : "")
        + (at.e === "bezier" ? '<label class="ef full"><span>cubic-bezier (x1, y1, x2, y2)</span><input data-pk="ke.bz" value="' + esc(at.bz || "0.34, 1.56, 0.64, 1") + '" placeholder="0.34, 1.56, 0.64, 1"></label>' : "");
    return sec("Keyframes · " + (o.kf || []).length, '<div class="ed-note" style="grid-column:1/-1">Playhead en ' + lt.toFixed(2) + " s del clip. " + (at ? "Editas el keyframe de este instante." : "Al cambiar un valor se crea un keyframe aquí (auto-key). Con dos o más, el clip se mueve entre ellos.") + "</div>"
      + numF("kk.x", "Mover X (px)", k.x) + numF("kk.y", "Mover Y (px)", k.y)
      + '<label class="ef"><span>Z (px)</span><input type="number" step="10" data-pk="kk.z" value="' + r1(+k.z || 0) + '" title="Profundidad: positivo = hacia ti (más grande y adelante), negativo = al fondo"></label>'
      + numF("kk.s", "Escala", k.s, 0.05) + numF("kk.r", "Rotación°", k.r) + numF("kk.o", "Opacidad", k.o, 0.05) + numF("kk.b", "Desenfoque px", k.b || 0, 0.5)
      /* QA Instinct v11: «Ancho %» en el keyframe (la C que crece de 9 % a 20 %): es la escala vista como ancho */
      + (VE.sel && VE.sel.tr === "m" ? numM("kk.w", "Ancho % en este keyframe", r1((k.s != null ? k.s : 1) * (o.w || 40)), 0.5) : "")
      + (o.path ? numM("kk.p", "Avance en el recorrido %", k.p != null ? k.p : 0, 1) : "")
      + curveF
      + '<div class="ed-row">' + (at ? '<button data-pkf="del">Borrar keyframe</button>' : '<button data-pkf="add">Agregar keyframe</button>') + '<button data-pkf="prev">◀ Anterior</button><button data-pkf="next">Siguiente ▶</button></div>'
      + (o.kf || []).map(function (x, i) { return '<button class="ed-li" data-pkt="' + i + '" style="grid-column:1/-1;padding:4px 0;border:0"><span><b>◆ ' + x.t.toFixed(2) + " s" + (x.e && x.e !== "auto" && i < o.kf.length - 1 ? " · " + EASEN[x.e] : "") + "</b><small>x " + r1(x.x) + " · y " + r1(x.y) + (x.z ? " · z " + r1(x.z) : "") + " · esc " + r1(x.s) + " · " + r1(x.r) + "° · op " + r1(x.o) + (x.p != null ? " · avance " + r1(x.p) + "%" : "") + "</small></span></button>"; }).join(""));
  }
  function proSections(o, tr) {
    var h = sec("Efecto continuo", selF("fx", "Movimiento", o.fx || "none", FX_FREE, true) + '<div class="ed-note" style="grid-column:1/-1">Se repite durante todo el clip. Para trayectorias (órbitas, colapsos) usa Keyframes.</div>');
    h += sec("Brillo / halo", selF("glowOn", "Brillo", o.glow ? "1" : "0", [["0", "Sin brillo"], ["1", "Con brillo"]]) + (o.glow ? colF("glow", "Color", o.glow) + numF("glowR", "Radio", o.glowR != null ? o.glowR : 24) : ""));
    if (tr === "t" && o.anim === "words") h += sec("Palabra por palabra", numF("wordGap", "Segundos por palabra", +o.wordGap > 0 ? o.wordGap : 0.25, 0.05)
      + '<label class="ef full"><span>Tiempos propios (s desde el inicio del clip, separados por coma)</span><input data-pk="wordTimes" value="' + esc(o.wordTimes || "") + '" placeholder="Ej.: 0, 0.1, 0.57, 0.82"></label>');
    if (tr === "m") h += sec("Proporción", numF("mar", "Ancho ÷ alto", r1(o.ar || 1), 0.01) + '<div class="ed-row"><button data-pkf="ar0">Proporción original de la imagen</button></div>');
    if (tr === "t") { var eff = fitSize(o, W0()); h += sec("Ajuste" + (eff < (+o.size || 64) ? " · se ve a " + eff : ""), selF("autofit", "Al ancho del video", o.autofit === false ? "0" : "1", [["1", "Achicar para que quepa en una línea"], ["0", "Saltar de línea"]], true)
      /* QA Instinct B16: el auto-ajuste achicaba el texto sin decirlo y parecía un error de escala */
      + (eff < (+o.size || 64) ? '<div class="ed-note" role="status" style="grid-column:1/-1;color:#ffb27a">Tamaño ' + (+o.size || 64) + ', pero se ve a ' + eff + ' para caber en una línea. Elige «Saltar de línea» para usar el tamaño exacto.</div>' : ""), eff < (+o.size || 64)); }
    if (tr === "m" && !/url\(/.test(o.bg || "")) {
      var g = o.grad || { type: "solid", a: hexOr(o.bg, BRAND), b: "#111111", angle: 135 };
      h += sec("Relleno y forma", selF("fill.type", "Relleno", o.grad ? o.grad.type : "solid", [["solid", "Color plano"], ["linear", "Degradado lineal"], ["radial", "Degradado radial"], ["halo", "Halo (se desvanece)"]], true)
        + colF("fill.a", "Color", g.a) + (o.grad && o.grad.type !== "halo" ? colF("fill.b", "Color 2", g.b) : "") + (o.grad && o.grad.type === "linear" ? numF("fill.angle", "Ángulo°", g.angle) : "")
        + selF("shape", "Forma", o.shape || "rect", [["rect", "Rectángulo"], ["circle", "Círculo"]]));
    }
    if (tr === "t") h += sec("Morph: transformar en otro texto", '<label class="ef full"><span>Se transforma en</span><input data-pk="morphTo" value="' + esc(o.morphTo || "") + '" placeholder="Ej.: AI → OS"></label>'
      + (o.morphTo ? numF("morphAt", "Empieza en (s)", o.morphAt != null ? o.morphAt : r1(o.dur / 2), 0.1) + numF("morphD", "Duración (s)", o.morphD != null ? o.morphD : 0.6, 0.1) : ""));
    if (tr === "m" && o.icon) h += sec("Ícono", '<div class="ed-note" style="grid-column:1/-1">' + esc(o.icon) + "</div>" + colF("iconColor", "Color", o.iconColor || BRAND));
    h += sec("Trayectoria", '<div class="ed-note" style="grid-column:1/-1">Crea los keyframes de un recorrido; después los ajustas uno por uno.</div>'
      + selF("path.kind", "Recorrido", "orbit", [["orbit", "Órbita"], ["spiral", "Espiral que colapsa al centro"], ["collapse", "Colapso (se encoge y desaparece)"], ["arc", "Arco"], ["in-left", "Entra desde la izquierda"]], true)
      + numF("path.r", "Radio (px)", 300) + numF("path.turns", "Vueltas", 1, 0.5) + numF("path.from", "Desde (s)", 0, 0.1) + numF("path.len", "Duración (s)", r1(Math.min(2, o.dur)), 0.1)
      + '<div class="ed-row"><button data-pkf="path">Crear trayectoria</button></div>'
      + selF("curve", "Entre keyframes", o.curve ? "1" : "0", [["0", "Línea recta"], ["1", "Curva suave"]], true));
    return h + motionSecs(o, tr) + kfSec(o);
  }
  /* SVG de Iconify con el color pedido, como data URL (se exporta sin depender de otra web) */
  /* caché de los íconos usados (memoria + este navegador): no depende de Iconify cada vez (QA Instinct T4) */
  var ICMEM = {};
  function iconData(name, color) {
    var pr = String(name).split(":"), multi = pr[0] === "logos", key = "musa_ic:" + name + "|" + (multi ? "" : color || BRAND);
    if (ICMEM[key]) return Promise.resolve(ICMEM[key]);
    try { var hit = localStorage.getItem(key); if (hit) return Promise.resolve(ICMEM[key] = hit); } catch (e) {}
    return icFetch("/" + encodeURIComponent(pr[0]) + "/" + encodeURIComponent(pr[1]) + ".svg?height=512" + (multi ? "" : "&color=" + encodeURIComponent(color || BRAND)), true)
      .then(function (svg) { var d = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg))); ICMEM[key] = d; try { if (d.length < 60000) localStorage.setItem(key, d); } catch (e) {} return d; });
  }
  var ICT = {};   /* temporizadores del recoloreo de íconos (fuera del clip: no se guardan) */
  var lastSel = "";
  var _insp = veInsp;
  veInsp = function () {
    _insp.apply(this, arguments);
    var box = vq("#veInsp"); if (!box) return;
    var s = VE.sel, o = objSel();
    if (o) {
      var acts = box.lastElementChild;
      var h = proSections(o, s.tr);
      /* QA Instinct B35: los ajustes del video (fondo, cámara) solo aparecían sin nada elegido */
      h = '<div class="ed-row" style="margin:8px 12px 0"><button data-pmo2="proj">Ajustes del video: fondo y cámara</button></div>' + h;
      if (s.tr === "t") h = '<div class="ed-note" style="margin:8px 12px 0">Con el texto elegido, escribe y va directo al texto. Esc para salir.</div>' + h;
      if (acts && acts.classList.contains("ed-sb")) acts.insertAdjacentHTML("beforebegin", h); else box.insertAdjacentHTML("beforeend", h);
    } else if (s && (s.tr === "a" || s.tr === "v1") && VE.p && typeof otherSecs === "function") {
      /* QA Instinct v16: audio (onda real, volumen con keyframes, ducking, subtítulos) y V1 (estabilizar, subtítulos) */
      var oc = s.tr === "a" ? VE.p.a[s.i] : VE.p.v1[s.i], lst = box.lastElementChild, hh = oc ? otherSecs(oc, s.tr) : "";
      if (hh) { if (lst) lst.insertAdjacentHTML("beforebegin", hh); else box.insertAdjacentHTML("beforeend", hh); }
    } else if (!s && VE.p) {
      var g = VE.p.grad || { type: "solid", a: hexOr(VE.p.pad, "#000000"), b: "#111111", angle: 160 };
      var last = box.lastElementChild;
      var ph = sec("Fondo del video", selF("pg.type", "Fondo", VE.p.grad ? VE.p.grad.type : "solid", [["solid", "Color plano"], ["linear", "Degradado lineal"], ["radial", "Degradado radial"], ["rings", "Anillos concéntricos"]], true)
        + (VE.p.grad ? colF("pg.a", g.type === "rings" ? "Anillos" : "Color", g.a) + colF("pg.b", g.type === "rings" ? "Fondo" : "Color 2", g.b) + (g.type === "linear" ? numF("pg.angle", "Ángulo°", g.angle) : "")
          + (g.type === "rings" ? numM("pg.gap", "Separación entre anillos (px)", g.gap || 150, 5) + numM("pg.rw", "Grosor del anillo (px)", g.rw || 10, 1) : "") : ""))
        + sec("Cámara 3D (eje Z)", numM("pp.persp", "Distancia de la cámara (px)", persp(), 50)
          + '<div class="ed-note" style="grid-column:1/-1">Cuánta perspectiva tiene el eje Z de los clips. Menos distancia = más dramático. Con Z = +' + Math.round(persp() / 2) + " un clip se ve al doble; con Z = −" + persp() + " se ve a la mitad.</div>");
      if (typeof projSecs === "function") ph += projSecs();
      if (last) last.insertAdjacentHTML("beforebegin", ph);
    }
    /* el clip nuevo se ve desde arriba (antes quedaba el scroll del anterior) */
    var key = s ? s.tr + ":" + (s.i != null ? s.i : s.li) + ":" + (s.ci != null ? s.ci : "") : "";
    if (key !== lastSel) { box.scrollTop = 0; lastSel = key; VE._typing = null; }
    a11yInsp(box);
  };
  /* accesibilidad: cada control con nombre; los textos sin etiqueta toman el de su sección */
  function a11yInsp(box) {
    box.setAttribute("role", "region"); box.setAttribute("aria-label", "Inspector");
    [].forEach.call(box.querySelectorAll("input,select,textarea"), function (el) {
      if (el.getAttribute("aria-label") || el.id && box.querySelector('label[for="' + el.id + '"]')) return;
      var lab = el.closest("label"), sp = lab && lab.querySelector("span");
      var name = sp && sp.textContent.trim();
      if (!name) { var d = el.closest("details"), sm = d && d.querySelector("summary"); name = sm ? sm.textContent.trim() : (el.tagName === "TEXTAREA" ? "Texto" : "Valor"); }
      if (el.tagName === "TEXTAREA" && el.dataset.vk === "text") name = "Texto del clip";
      el.setAttribute("aria-label", name);
    });
  }
  var pending = false;
  vq("#veInsp").addEventListener("focusin", function (e) { if (e.target.dataset && e.target.dataset.pk) pending = true; });
  function onPro(e) {
    var k = e.target.dataset && e.target.dataset.pk; if (!k) return;
    /* «change» solo refresca la lista de keyframes: el cambio ya se aplicó en «input» (sin doble historial) */
    if (e.type === "change") { if (k.indexOf("kk.") === 0) veInsp(); return; }
    if (k.indexOf("path.") === 0) return;   /* parámetros de la trayectoria: se leen al tocar «Crear trayectoria» */
    var p = VE.p, v = e.target.value, num = e.target.type === "number";
    if (num) v = parseFloat(v) || 0;
    if (e.target.tagName === "SELECT" || pending) { if (typeof vsnap === "function") vsnap(); pending = false; }
    if (k.indexOf("pg.") === 0) {
      var f = k.slice(3);
      if (f === "type") { if (v === "solid") { delete p.grad; p.pad = hexOr(p.pad, "#000000"); } else { p.grad = Object.assign(v === "rings" ? { a: "#e4dcf7", b: "#f9f9f2", gap: 150, rw: 10 } : { a: hexOr(p.pad, "#1a1a1a"), b: "#ff5e00", angle: 160 }, v === "rings" ? {} : p.grad || {}, { type: v }); } }
      else if (p.grad) p.grad[f] = v;
      if (p.grad) p.pad = gradCss(p.grad);
      veStage(); if (f === "type") veInsp();
      return;
    }
    if (k === "pp.persp") { if (v >= 100) p.persp = Math.round(v); else delete p.persp; veStage(); return; }
    if (k === "pt.total") { var tt = parseFloat(e.target.value); if (isFinite(tt) && tt >= 0.5) p.total = Math.round(tt * 100) / 100; else delete p.total; veAll(); return; }
    var o = objSel(); if (!o) return;
    if (k === "wordGap") { o.wordGap = cl(v, 0.02, 10); veStage(); return; }
    if (k === "wordTimes") { o.wordTimes = String(e.target.value || ""); if (!o.wordTimes) delete o.wordTimes; veStage(); return; }
    if (k === "mar") { o.ar = cl(v, 0.05, 20); veStage(); return; }
    if (k.indexOf("kk.") === 0) {
      var lt = lt0(o); o.kf = o.kf || [];
      var kf = o.kf.find(function (x) { return Math.abs(x.t - lt) < 0.02; });
      if (!kf) { kf = Object.assign({}, sampleK(o, lt), { t: lt }); o.kf.push(kf); o.kf.sort(function (a, b) { return a.t - b.t; }); }
      if (k === "kk.w") { kf.s = r1(Math.max(0.5, v) / (o.w || 40)); var se = vq('#veInsp [data-pk="kk.s"]'); if (se) se.value = kf.s; }
      else kf[k.slice(3)] = v;
      veStage(); veTimeline();
      return;
    }
    if (k === "morphTo") { var had = !!o.morphTo; o.morphTo = v; if (!v) delete o.morphTo; if (had !== !!o.morphTo) setTimeout(veInsp, 0); }
    else if (k === "morphAt") o.morphAt = cl(v, 0, o.dur);
    else if (k === "morphD") o.morphD = cl(v, 0.1, 10);
    else if (k === "curve") o.curve = v === "1";
    else if (k === "iconColor") {
      o.iconColor = v; clearTimeout(ICT[o.id]);
      ICT[o.id] = setTimeout(function () { iconData(o.icon, v).then(function (d) { o.bg = "url('" + d + "') center/contain no-repeat"; veStage(); if (typeof veAll === "function") veAll(); }, function () {}); }, 250);
    }
    else if (k === "fx") o.fx = v;
    else if (k === "enD") { if (v > 0) o.enD = cl(v, 0.02, 5); else delete o.enD; }
    else if (k === "glowOn") { if (v === "1") o.glow = o.glow || (VE.sel.tr === "t" ? hexOr(o.color, "#ffffff") : BRAND); else delete o.glow; veInsp(); }
    else if (k === "glow") o.glow = v;
    else if (k === "glowR") o.glowR = cl(v, 0, 200);
    else if (k === "autofit") o.autofit = v === "1";
    else if (k === "shape") o.shape = v;
    else if (k.indexOf("fill.") === 0) {
      var ff = k.slice(5);
      if (ff === "type") { if (v === "solid") { o.bg = o.grad ? o.grad.a : hexOr(o.bg, BRAND); delete o.grad; } else { o.grad = Object.assign({ a: hexOr(o.bg, BRAND), b: "#111111", angle: 135 }, o.grad || {}, { type: v }); } veInsp(); }
      else if (o.grad) o.grad[ff] = v; else if (ff === "a") o.bg = v;
      if (o.grad) o.bg = gradCss(o.grad);
    }
    veStage(); veTimeline();
  }
  vq("#veInsp").addEventListener("change", function (e) { if (e.target.dataset && e.target.dataset.k === "anim") setTimeout(veInsp, 0); });
  vq("#veInsp").addEventListener("input", onPro);
  vq("#veInsp").addEventListener("change", onPro);
  vq("#veInsp").addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-pkf],[data-pkt]"); if (!b) return;
    var o = objSel(); if (!o) return;
    var lt = lt0(o), kf = o.kf || [];
    if (b.dataset.pkt != null) { VE.t = o.start + kf[+b.dataset.pkt].t; veStage(); veTimeline(); return veInsp(); }
    var a = b.dataset.pkf;
    if (a === "ar0") {
      var u = (String(o.bg || "").match(/url\(["']?([^"')]+)["']?\)/) || [])[1]; if (!u) return toast("Este clip no es una imagen");
      var im = new Image(); im.onload = function () { if (im.naturalWidth && im.naturalHeight) { vsnap(); o.ar = r1(im.naturalWidth / im.naturalHeight); veAll(); veInsp(); toast("Proporción original: " + o.ar); } }; im.src = u;
      return;
    }
    if (a === "path") {
      var val = function (n) { var el = vq('#veInsp [data-pk="path.' + n + '"]'); return el ? el.value : null; };
      var made = pathKfs(val("kind"), { from: val("from"), len: val("len"), r: val("r"), turns: val("turns"), dur: o.dur });
      if (!made.length) return;
      vsnap();
      var a0 = made[0].t, a1 = made[made.length - 1].t;
      o.kf = kf.filter(function (x) { return x.t < a0 - 0.02 || x.t > a1 + 0.02; }).concat(made).sort(function (x, y) { return x.t - y.t; });
      if (val("kind") !== "collapse" && val("kind") !== "in-left") o.curve = true;
      VE.t = o.start + a0; veAll(); veInsp(); return toast("Trayectoria creada: " + made.length + " keyframes");
    }
    if (a === "add") { vsnap(); o.kf = kf.concat([Object.assign({}, sampleK(o, lt), { t: lt })]).sort(function (x, y) { return x.t - y.t; }); }
    if (a === "del") { vsnap(); o.kf = kf.filter(function (x) { return Math.abs(x.t - lt) >= 0.02; }); }
    if (a === "prev" || a === "next") {
      var k = a === "prev" ? kf.slice().reverse().find(function (x) { return x.t < lt - 0.02; }) : kf.find(function (x) { return x.t > lt + 0.02; });
      if (!k) return toast("No hay más keyframes");
      VE.t = o.start + k.t;
    }
    veStage(); veTimeline(); veInsp();
    if (typeof veAll === "function" && (a === "add" || a === "del")) veAll();
  });

  /* ═════ timeline: rombos de keyframes en T/M, filas compactas, accesibilidad, clic en vacío ═════ */
  var BASE_TH = { m: TH.m, t: TH.t, a: TH.a };
  var _tl = veTimeline;
  veTimeline = function () {
    if (VE.p) ["m", "t", "a"].forEach(function (k) {
      var rows = 0; (VE.p[k] || []).forEach(function (c) { rows = Math.max(rows, (c._row || 0) + 1); });
      TH[k] = rows > 4 ? Math.max(18, BASE_TH[k] - 12) : BASE_TH[k];
    });
    _tl.apply(this, arguments);
    var lanes = vq("#veLanes"); if (!lanes || !VE.p) return;
    lanes.setAttribute("role", "region"); lanes.setAttribute("aria-label", "Timeline");
    [].forEach.call(lanes.querySelectorAll(".ve-clip"), function (el) {
      var tr = el.dataset.tr, i = +el.dataset.i, c = tr === "v1" ? VE.p.v1[i] : VE.p[tr] && VE.p[tr][i];
      if (!c) return;
      var TRN = { v1: "Toma o escena", m: "Media", t: "Texto", a: "Audio" };
      el.setAttribute("role", "button"); el.tabIndex = 0;
      el.setAttribute("aria-label", TRN[tr] + ": " + (c.text || c.name || "") + ", de " + fmtT(c.start) + " a " + fmtT(c.start + c.dur));
      el.setAttribute("aria-pressed", el.classList.contains("on") ? "true" : "false");
      if ((tr === "t" || tr === "m") && c.kf && c.kf.length) el.insertAdjacentHTML("beforeend", c.kf.map(function (k) { return '<b class="ve-kd" style="left:' + r1(k.t * VE.pps - 4) + 'px;top:auto;bottom:1px" title="Keyframe ' + k.t.toFixed(2) + ' s"></b>'; }).join(""));
    });
  };
  var lanesEl0 = vq("#veLanes");
  /* clic en el vacío del timeline: mueve el playhead y conserva la selección (Esc deselecciona) */
  lanesEl0.addEventListener("pointerdown", function (e) {
    var inner = e.target.closest && e.target.closest(".ve-inner");
    if (!inner || e.target.closest(".ve-clip,.ve-ruler,.ve-ph,[data-tx],[data-lbar],[data-kd]")) return;
    e.stopImmediatePropagation();
    var rect = inner.getBoundingClientRect(), tAt = function (cx) { return (cx - rect.left) / VE.pps; };
    veStop(); veSeek(tAt(e.clientX)); veTimeline(); if (VE.sel && (VE.sel.tr === "t" || VE.sel.tr === "m")) veInsp();
    vdrag(e, function (ev) { veSeek(tAt(ev.clientX)); veTimeline(); });
  }, true);
  lanesEl0.addEventListener("keydown", function (e) {
    var el = e.target.closest && e.target.closest(".ve-clip");
    if (!el || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault(); e.stopPropagation();
    veSelect({ tr: el.dataset.tr, i: +el.dataset.i });
  });

  /* ═════ escribir con un texto elegido va al texto (no dispara atajos ni botones) ═════ */
  document.addEventListener("keydown", function (e) {
    if (!VE.open || e.ctrlKey || e.metaKey || e.altKey) return;
    var typing = e.target.closest && e.target.closest("input,textarea,select,[contenteditable=true]");
    if (typing) return;
    var s = VE.sel;
    if (!s || s.tr !== "t" || (e.key.length !== 1 && e.key !== "Enter" && e.key !== "Backspace")) return;
    /* Espacio, Enter y Retroceso escriben solo si ya empezaste a escribir en ese texto; si no, siguen siendo
       reproducir y borrar clip, como siempre */
    var selKey = "t:" + s.i;
    if ((e.key === " " || e.key === "Enter" || e.key === "Backspace") && VE._typing !== selKey) return;
    VE._typing = selKey;
    var ta = vq('#veInsp textarea[data-vk="text"]'); if (!ta) return;
    e.preventDefault(); e.stopImmediatePropagation();
    ta.focus();
    ta.value = e.key === "Enter" ? ta.value + "\n" : e.key === "Backspace" ? ta.value.slice(0, -1) : ta.value + e.key;
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, true);
  /* los botones que abren diálogos no se quedan con el foco (Enter al escribir los volvía a abrir) */
  vq("#veInsp").addEventListener("click", function (e) { var b = e.target.closest && e.target.closest('[data-vact="export"],[data-vact="publish"]'); if (b) setTimeout(function () { b.blur(); }, 0); });

  /* ═════ nombre del proyecto completo ═════ */
  function sizeName() { var n = vq("#veName"); if (n) { n.style.width = Math.max(12, Math.min(48, (n.value || "").length + 2)) + "ch"; n.title = n.value; } }
  vq("#veName").addEventListener("input", sizeName);
  var _top = veTop;
  veTop = function () { var r = _top.apply(this, arguments); sizeName(); return r; };

  /* ═════ biblioteca: subir imagen y audio, logos, formas, halos ═════ */
  var brandCache = null;
  function brands() {
    if (brandCache) return Promise.resolve(brandCache);
    var R = RB(); if (!R.on) return Promise.resolve([]);
    var flt = R.wsFilter ? R.wsFilter() : "workspace_id=eq." + encodeURIComponent(R.ws);
    return api("/rest/v1/brands?" + flt + "&select=id,name,colors,fonts,logo&order=name.asc&limit=100").then(function (r) { brandCache = r || []; return brandCache; }, function () { brandCache = []; return brandCache; });
  }
  function brandColor() {
    var b = (brandCache || []).find(function (x) { return (x.colors || []).length; });
    var c = b && b.colors[0]; c = typeof c === "string" ? c : c && (c.hex || c.value);
    return hex6(c) || BRAND;
  }
  function logoOf(b) { var l = b.logo; var u = typeof l === "string" ? l : l && (l.url || l.src); return /^https?:\/\//.test(u || "") ? u : null; }
  /* subir = un <input type="file"> de verdad dentro del botón (no uno creado y clicado por código): funciona con
     cualquier navegador o herramienta que elija el archivo en el input, y se vacía al terminar para poder elegir el
     mismo archivo otra vez (QA Instinct bugs 2 y 4) */
  function upBtn(k, label, accept, gap) {
    return '<label class="ed-btn pri" style="width:100%;position:relative;display:flex;align-items:center;justify-content:center;cursor:pointer' + (gap ? ";margin-top:6px" : "") + '">' + label
      + '<input type="file" data-proin="' + k + '" accept="' + accept + '" aria-label="' + label + '" style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%"></label>';
  }
  var _bin = veBin;
  veBin = function () {
    _bin.apply(this, arguments);
    var box = vq("#veBin"); if (!box || !VE.p) return;
    var real = !!VE.p._real;
    var item = function (l, sub, attrs, th) { return '<button class="ve-item" ' + attrs + ">" + (th || "") + "<span><b>" + esc(l) + "</b>" + (sub ? "<small>" + esc(sub) + "</small>" : "") + "</span><i>+</i></button>"; };
    var secH = function (t, b) { return '<div class="ve-bsec"><div class="ed-mh">' + t + "</div>" + b + "</div>"; };
    if (VE.tab === "media") {
      box.insertAdjacentHTML("afterbegin", secH("Desde un enlace", '<label class="ef full"><span>Enlace de imagen o SVG (https://…)</span><input id="veUrlIn" type="url" placeholder="https://api.iconify.design/logos/asana.svg"></label><div class="ed-row"><button class="ed-btn" data-urlimp="1">Traer como clip</button></div>'));
      box.insertAdjacentHTML("afterbegin", secH("Subir", upBtn("upimg", "Subir imagen (PNG, JPG, SVG)", "image/*") + upBtn("upvid", "Subir video (MP4, MOV, WEBM · hasta 200 MB)", "video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v", 1) + (real ? "" : '<div class="ed-note">Abre un video tuyo para subir archivos.</div>')));
      brands().then(function (bs) {
        var ls = bs.filter(logoOf); if (!ls.length || VE.tab !== "media" || !vq("#veBin")) return;
        vq("#veBin").insertAdjacentHTML("beforeend", secH("Logos de tus marcas — el isotipo real, en M", ls.map(function (b) { return item(b.name, "logo", 'data-pro="logo" data-url="' + esc(logoOf(b)) + '" data-name="' + esc(b.name) + '"', '<span class="ve-bth" style="background:#fff url(&#39;' + esc(logoOf(b)) + '&#39;) center/contain no-repeat"></span>'); }).join("")));
      });
    } else if (VE.tab === "audio") {
      var auds = (RB().assets || []).filter(function (a) { return /^audio/.test(a.mime_type || "") && a.url; });
      box.insertAdjacentHTML("afterbegin", secH("Tus sonidos", upBtn("upaud", "Subir audio (MP3, WAV, M4A, OGG)", "audio/*")
        + auds.slice(0, 40).map(function (a) { return item(a.name || "Audio", "tu audio", 'data-pro="addaud" data-url="' + esc(a.url) + '" data-name="' + esc(a.name || "Audio") + '"'); }).join("")
        + (real ? "" : '<div class="ed-note">Abre un video tuyo para subir audio.</div>')));
    } else if (VE.tab === "texto") {
      var c = brandColor();
      box.insertAdjacentHTML("beforeend", secH("Formas, halos y degradados — en M", [["circle", "Círculo", c], ["rect", "Rectángulo", c], ["pill", "Píldora", c], ["halo", "Halo · brillo radial difuso (resplandor)", c], ["bggrad", "Degradado a pantalla completa", c]].map(function (x) {
        var th = x[0] === "halo" ? "radial-gradient(circle," + x[2] + "," + x[2] + "00 70%)" : x[0] === "bggrad" ? "linear-gradient(160deg,#1a1a1a," + x[2] + ")" : x[2];
        return item(x[1], "en el playhead", 'data-pro="shape" data-v="' + x[0] + '"', '<span class="ve-bth" style="background:' + th + ";border-radius:" + (x[0] === "circle" || x[0] === "halo" ? "50%" : x[0] === "pill" ? "999px" : "4px") + '"></span>');
      }).join("")));
      box.insertAdjacentHTML("beforeend", secH("Íconos y logos — en M", '<label class="ef full"><span>Colección</span><select id="veIconSet"><option value="">Todos los íconos (un color, el que quieras)</option><option value="logos"' + (ICSET === "logos" ? " selected" : "") + '>Logos de marcas a color (Asana, Slack, Teams…)</option></select></label><label class="ef full"><span>Buscar (en inglés)</span><input id="veIconQ" placeholder="' + (ICSET === "logos" ? "asana, gitlab, microsoft-teams, zoom…" : "laptop, heart, sparkles, apple…") + '" value="' + esc(ICONQ) + '"></label><div class="ve-grid" id="veIconR" style="margin-top:6px"></div>'));
      iconSearch(ICONQ);
      brands();
    } else if (VE.tab === "fx") {
      var o = objSel(), note = box.querySelector(".ed-note");
      if (note) note.innerHTML = o ? "Movimiento para <b style=\"color:#fff\">" + esc(o.text || o.name || "el clip") + "</b>. Overlays y Looks solo aplican a tomas y escenas (V1)."
        : "Elige un clip: el movimiento sirve para tomas y escenas (V1), textos y media; overlays y looks, solo para V1.";
      if (o) [].forEach.call(box.querySelectorAll("[data-fx]"), function (b) { b.classList.toggle("on", (o.fx || "none") === b.dataset.fx); });
    }
    box.setAttribute("role", "region"); box.setAttribute("aria-label", "Biblioteca");
  };
  /* ═════ biblioteca de íconos (Iconify: los mismos sets que usa el MCP) ═════ */
  var ICONQ = "sparkles", icSeq = 0, ICSET = "";
  /* QA Instinct B7/T4: si api.iconify.design no responde se prueba con sus espejos oficiales, y si todo falla se avisa con «Reintentar» */
  var IC_HOSTS = ["https://api.iconify.design", "https://api.simplesvg.com", "https://api.unisvg.com"];
  function icFetch(path, asText) {
    var i = 0;
    var go = function () {
      return fetch(IC_HOSTS[i] + path).then(function (r) { if (r.status === 404) { var e = new Error("no encontré el ícono"); e.nf = 1; throw e; } if (!r.ok) throw new Error("HTTP " + r.status); return asText ? r.text() : r.json(); })
        .catch(function (e) { if (e.nf || ++i >= IC_HOSTS.length) throw e.nf ? e : new Error("el servicio de íconos no responde"); return go(); });
    };
    return go();
  }
  RB().icFetch = icFetch;
  function iconSearch(q) {
    var my = ++icSeq, box = vq("#veIconR"); if (!box) return;
    box.innerHTML = '<div class="ed-note">Buscando…</div>';
    icFetch("/search?query=" + encodeURIComponent(q || "star") + "&limit=48" + (ICSET ? "&prefix=" + ICSET : "")).then(function (j) {
      if (my !== icSeq || !vq("#veIconR")) return;
      var names = (j && j.icons) || [];
      vq("#veIconR").innerHTML = names.length ? names.map(function (n) { var pr = n.split(":"); return '<button class="ve-tile" data-icon="' + esc(n) + '" title="' + esc(n) + '"><span class="ve-tprev" style="background:#fff url(&#39;https://api.iconify.design/' + esc(pr[0]) + "/" + esc(pr[1]) + '.svg?height=64&#39;) center/60% no-repeat"></span>' + esc(pr[1]) + "</button>"; }).join("") : '<div class="ed-note">Nada con «' + esc(q) + '». Prueba en inglés.</div>';
    }, function (x) { if (my === icSeq && vq("#veIconR")) vq("#veIconR").innerHTML = '<div class="ed-note" role="alert" style="grid-column:1/-1">No pude buscar íconos (' + esc(x && x.message || "sin conexión") + ').</div><button class="ed-btn" data-icretry="1" style="grid-column:1/-1">Reintentar</button>'; });
  }
  var icT = null;
  vq("#veBin").addEventListener("change", function (e) { if (e.target.id !== "veIconSet") return; ICSET = e.target.value; if (ICSET === "logos" && ICONQ === "sparkles") { ICONQ = "slack"; var qi = vq("#veIconQ"); if (qi) qi.value = ICONQ; } iconSearch(ICONQ); });
  vq("#veBin").addEventListener("click", function (e) { if (e.target.closest && e.target.closest("[data-icretry]")) { e.preventDefault(); iconSearch(ICONQ); } });
  vq("#veBin").addEventListener("input", function (e) { if (e.target.id !== "veIconQ") return; ICONQ = e.target.value; clearTimeout(icT); icT = setTimeout(function () { iconSearch(ICONQ); }, 300); });
  vq("#veBin").addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-icon]"); if (!b) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var name = b.dataset.icon, multi = /^logos:/.test(name), col = multi ? "" : brandColor();
    b.disabled = true; b.style.opacity = ".5";
    iconData(name, col).then(function (d) {
      b.disabled = false; b.style.opacity = "";
      var p = VE.p; vsnap();
      var c = { id: nid(), name: (multi ? "Logo · " : "Ícono · ") + name.split(":")[1], icon: name, iconColor: col || undefined, bg: "url('" + d + "') center/contain no-repeat", start: r1(Math.min(VE.t, Math.max(0, veDur(p) - 0.5))), dur: 3, x: 50, y: 50, w: 20, ar: 1, opacity: 1, radius: 0, anim: "pop" };
      p.m.push(c); VE.sel = { tr: "m", i: p.m.length - 1 };
      if (multi) delete c.iconColor;
      veAll(); veInsp(); reveal(c); toast(multi ? "Logo a color agregado en M" : "Ícono agregado en M: cámbiale el color en el inspector");
    }, function (x) { b.disabled = false; b.style.opacity = ""; toast("No se pudo agregar «" + name.split(":")[1] + "»: " + (x && x.message || x) + ". Toca el ícono para reintentar."); });
  }, true);

  /* Efectos: también para textos y media */
  vq("#veBin").addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-fx],[data-ovl],[data-look]"); if (!b) return;
    var o = objSel(); if (!o) return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (!b.dataset.fx) return toast("Overlays y looks solo aplican a tomas y escenas (V1)");
    vsnap(); o.fx = b.dataset.fx === "none" ? "none" : b.dataset.fx;
    if (!(VE.t >= o.start && VE.t < o.start + o.dur)) VE.t = o.start + Math.min(0.6, o.dur / 2);
    veAll(); veBin(); veInsp();
  }, true);
  /* lo agregado aparece a la vista (antes, con el playhead al final, «Agregar» no mostraba nada) */
  function reveal(c) {
    /* QA Instinct B8/T3: antes el playhead saltaba 0,6 s tras cada agregado y el siguiente caía en otro instante.
       Ahora solo se mueve si lo agregado no se ve en el instante actual. */
    /* QA Instinct B8/B33: agregar NUNCA mueve el playhead (antes, por redondeo o con la línea de tiempo desplazada,
       a veces saltaba 0,6 s); solo se desplaza la línea de tiempo para mostrar el clip */
    veStage(); veTimeline();
    var lanes = vq("#veLanes"); if (lanes) lanes.scrollLeft = Math.max(0, c.start * VE.pps - 120);
  }
  /* se cuenta en captura (antes de que la maqueta agregue) y se revisa después */
  vq("#veBin").addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-add]"); if (!b || !VE.p) return;
    var kind = b.dataset.add, before = { t: VE.p.t.length, m: VE.p.m.length, a: VE.p.a.length };
    setTimeout(function () {
      var tr = kind === "text" ? "t" : kind === "media" ? "m" : kind === "music" ? "a" : null; if (!tr || VE.p[tr].length <= before[tr]) return;
      var c = VE.p[tr][VE.p[tr].length - 1];
      /* sticker: con el color de tu marca (antes lima #d2ff02) */
      if (tr === "t" && /^#d2ff02$/i.test(c.bg || "")) { brands().then(function () { c.bg = brandColor(); c.color = "#ffffff"; veStage(); veInsp(); }); }
      /* imagen: con su proporción real (antes quedaba cuadrada y recortada) */
      if (tr === "m") { var u = (String(c.bg || "").match(/url\(["']?([^"')]+)["']?\)/) || [])[1];
        /* un SVG de «Tus imágenes» entra como vector (colores editables), no como imagen */
        if (u && (/\.svg$/i.test(u.split("?")[0]) || /^data:image\/svg/.test(u)) && !c.svg) fetch(u).then(function (r) { return r.ok ? r.text() : ""; }).then(function (txt) { var sv = sanitizeSvg(txt); if (!sv) return; c.svg = sv; c.ar = r1(sizeSvg(sv).ar); c.bg = bgOf(c); veStage(); if (objSel() === c) veInsp(); if (typeof veAll === "function") veAll(); }, function () {});
        if (u) { var im = new Image(); im.onload = function () { if (im.naturalWidth && im.naturalHeight) { c.ar = r1(im.naturalWidth / im.naturalHeight); veStage(); } }; im.src = u; } }
      reveal(c);
      toast("Agregado en " + (tr === "t" ? "Texto" : tr === "m" ? "Media" : "Audio") + " a las " + fmtT(c.start));
    }, 0);
  }, true);
  function pickFile(accept) {
    return new Promise(function (ok) {
      var i = document.createElement("input"); i.type = "file"; i.accept = accept; i.style.display = "none";
      /* el input se quita después de leer: algunos navegadores pierden la referencia al archivo si se quita antes */
      i.onchange = function () { ok(i.files && i.files[0] || null); setTimeout(function () { i.remove(); }, 60000); };
      document.body.appendChild(i); i.click();
    });
  }
  function readData(f) {
    var viaReader = new Promise(function (ok, ko) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = function () { ko(r.error || new Error("no se pudo leer el archivo")); }; r.readAsDataURL(f); });
    /* si FileReader falla (NotFoundError en algunos navegadores en la nube), se lee con arrayBuffer */
    return viaReader.catch(function (err) {
      if (!f.arrayBuffer) throw new Error("no se pudo leer el archivo (" + (err && err.name || "error") + ")");
      return f.arrayBuffer().then(function (buf) {
        var b = new Uint8Array(buf), out = "", CH = 0x8000;
        for (var i = 0; i < b.length; i += CH) out += String.fromCharCode.apply(null, b.subarray(i, i + CH));
        return "data:" + (f.type || "application/octet-stream") + ";base64," + btoa(out);
      }, function (e2) { throw new Error("no se pudo leer el archivo: vuelve a elegirlo (" + (e2 && e2.name || "error") + ")"); });
    });
  }
  function upload(dataUrl, name) {
    var R = RB(); if (!R.on || !R.ws) return Promise.reject(new Error("abre un video tuyo"));
    return api("/api/assets/upload", jpost({ name: name, data: dataUrl, workspaceId: R.ws })).then(function (x) { var a = x.data || x.asset || x; var url = a.url || (a.data && a.data.url); if (!url) throw new Error("el servidor no devolvió el archivo"); return { url: url, a: a }; });
  }
  /* QA Instinct B14: subir una imagen la sumaba sola al video y además el «+» de «Tus imágenes» sumaba otra copia.
     Ahora subir la deja en «Tus imágenes» (primera de la lista) y se suma con «+» cuando quieras. Un SVG sí se suma
     al subirlo, porque así queda vectorial (con sus colores editables). */
  function upDone(f, url) {
    if (/svg/.test(f.type) || /\.svg$/i.test(f.name)) { var nv = addMedia(f.name.replace(/\.[^.]+$/, ""), url, true); asVector(nv, f); return toast("SVG agregado en M como vector (colores editables)"); }
    toast("Subida a «Tus imágenes» (primera de la lista): tócala para sumarla al video");
  }
  function addMedia(name, url, contain) {
    var p = VE.p; vsnap();
    var c = { id: nid(), name: name, bg: "url('" + url + "') center/" + (contain ? "contain" : "cover") + " no-repeat", start: r1(Math.min(VE.t, Math.max(0, veDur(p) - 0.5))), dur: 3, x: 50, y: 50, w: 40, ar: 1, opacity: 1, radius: 0, anim: "pop" };
    p.m.push(c); VE.sel = { tr: "m", i: p.m.length - 1 };
    var im = new Image(); im.onload = function () { if (im.naturalWidth && im.naturalHeight) { c.ar = r1(im.naturalWidth / im.naturalHeight); veStage(); } }; im.src = url;
    veAll(); veInsp(); reveal(c);
    return c;
  }
  vq("#veBin").addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-urlimp]"); if (!b) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var inp = vq("#veUrlIn"), u = inp && inp.value.trim();
    if (!/^https:\/\/\S+$/i.test(u || "")) return toast("Pega un enlace que empiece con https://");
    if (!VE.p || !VE.p._real) return toast("Abre un video tuyo para traer imágenes");
    var nm = decodeURIComponent(u.split("?")[0].split("/").pop() || "imagen").replace(/\.[^.]+$/, "").slice(0, 60) || "imagen";
    /* si el enlace ya es una imagen de «Tus imágenes», se usa esa (antes se volvía a subir y se duplicaba) */
    var have = (RB().assets || []).find(function (a) { return a.url && a.url.split("?")[0] === u.split("?")[0]; });
    if (have) {
      if (inp) inp.value = "";
      if (/svg/.test(have.mime_type || "") || /\.svg$/i.test(u.split("?")[0])) upDone({ name: have.name || nm + ".svg", type: "image/svg+xml", text: function () { return fetch(have.url).then(function (r) { return r.text(); }); } }, have.url);
      else { addMedia(have.name ? String(have.name).replace(/\.[^.]+$/, "") : nm, have.url, true); toast("Traída como clip en M, en el playhead (ya estaba en «Tus imágenes»)"); }
      return;
    }
    toast("Trayendo " + nm + "…"); b.disabled = true;
    fetch(u).then(function (r) { if (!r.ok) throw new Error("el enlace respondió " + r.status); return r.blob(); }).then(function (bl) {
      if (!/^image\//.test(bl.type) && !/\.svg$/i.test(u.split("?")[0])) throw new Error("el enlace no es una imagen");
      if (bl.size > 5e6) throw new Error("la imagen supera 5 MB");
      var file = new File([bl], nm + (/svg/.test(bl.type) || /\.svg$/i.test(u.split("?")[0]) ? ".svg" : /png/.test(bl.type) ? ".png" : /jpe?g/.test(bl.type) ? ".jpg" : ".img"), { type: (bl.type || "image/svg+xml").split(";")[0].trim() });
      return readData(file).then(function (d) { return upload(d, file.name); }).then(function (r) {
        var R = RB(); R.assets = R.assets || []; R.assets.unshift({ name: file.name, url: r.url, mime_type: file.type });
        /* QA Instinct T17: lo traído por enlace entra directo como clip (y queda en «Tus imágenes») */
        if (inp) inp.value = "";
        if (/svg/.test(file.type) || /\.svg$/i.test(file.name)) upDone(file, r.url);
        else { addMedia(nm, r.url, true); toast("Traída como clip en M, en el playhead (también quedó en «Tus imágenes»)"); }
        veBin();
      });
    }).catch(function (x) { toast("No pude traer la imagen: " + (/Failed to fetch|NetworkError|Load failed/i.test(x && x.message || "") ? "ese sitio no deja descargarla desde aquí; descárgala y súbela" : (x && x.message || x))); }).then(function () { b.disabled = false; });
  }, true);
  function addAudio(name, url) {
    var p = VE.p;
    return new Promise(function (ok) { var a = new Audio(); a.preload = "metadata"; a.onloadedmetadata = function () { ok(a.duration); }; a.onerror = function () { ok(0); }; a.src = url; setTimeout(function () { ok(0); }, 6000); }).then(function (d) {
      vsnap();
      var c = { id: nid(), name: name, url: url, start: r1(Math.min(VE.t, Math.max(0, veDur(p) - 0.5))), dur: r1(isFinite(d) && d > 0 ? Math.min(d, 600) : 5), vol: 1, fin: 0, fout: 0.2 };
      p.a.push(c); VE.sel = { tr: "a", i: p.a.length - 1 };
      veAll(); veInsp(); reveal(c);
      toast("Audio agregado en A: suena al reproducir y en el video exportado");
    });
  }
  /* video propio → V1 (QA Instinct V1). Se sube directo al almacenamiento con una URL firmada: no pasa por el
     servidor, así un MP4 de 100 MB no se corta. Queda en tus archivos y en V1 al final, con su duración real. */
  var VMIME = { mp4: "video/mp4", m4v: "video/x-m4v", mov: "video/quicktime", webm: "video/webm" };
  /* duración desde la cabecera del MP4/MOV (caja mvhd) cuando el navegador no puede leer el video (sin códec) */
  function mp4Dur(f) {
    var scan = function (blob) { return blob.arrayBuffer().then(function (buf) {
      var b = new Uint8Array(buf), dv = new DataView(buf);
      for (var i = 4; i + 32 < b.length; i++) if (b[i] === 0x6d && b[i + 1] === 0x76 && b[i + 2] === 0x68 && b[i + 3] === 0x64) {
        var v = b[i + 4], ts, du;
        if (v === 1) { ts = dv.getUint32(i + 24); du = dv.getUint32(i + 28) * 4294967296 + dv.getUint32(i + 32); } else { ts = dv.getUint32(i + 16); du = dv.getUint32(i + 20); }
        return ts ? du / ts : 0;
      }
      return 0;
    }); };
    if (!f.arrayBuffer || !f.slice) return Promise.resolve(0);
    var M = 4 * 1024 * 1024;
    return scan(f.slice(0, M)).then(function (d) { return d || (f.size > M ? scan(f.slice(Math.max(0, f.size - M))) : 0); }).catch(function () { return 0; });
  }
  function uploadVideo(f) {
    var R = RB(), mime = VMIME[(f.name.split(".").pop() || "").toLowerCase()] || f.type;
    if (!/^video\/(mp4|quicktime|webm|x-m4v)$/.test(mime || "")) return toast("Formato de video no admitido: usa MP4, MOV o WEBM");
    if (f.size > 200 * 1024 * 1024) return toast("El video supera 200 MB");
    var name = f.name.replace(/\.[^.]+$/, "");
    toast("Subiendo " + f.name + " (" + (f.size / 1e6).toFixed(1).replace(".", ",") + " MB)…");
    var dur = new Promise(function (ok) { var v = document.createElement("video"); v.preload = "metadata"; v.onloadedmetadata = function () { ok(v.duration); URL.revokeObjectURL(v.src); }; v.onerror = function () { ok(0); }; v.src = URL.createObjectURL(f); setTimeout(function () { ok(0); }, 8000); })
      .then(function (d) { return isFinite(d) && d > 0 ? d : mp4Dur(f); });
    return api("/api/assets/video-upload", jpost({ name: f.name, mimeType: mime, size: f.size, workspaceId: R.ws })).then(function (x) {
      var u = x.data || x;
      return fetch(u.signedUrl, { method: "PUT", headers: { "Content-Type": mime, "x-upsert": "false" }, body: f }).then(function (r) {
        if (!r.ok) throw new Error("la subida falló (" + r.status + ")");
        return api("/api/assets/video-upload/done", jpost({ assetId: u.assetId, name: f.name, mimeType: mime, size: f.size, workspaceId: R.ws }));
      });
    }).then(function (done) {
      var url = done.url || (done.data && done.data.url); if (!url) throw new Error("el servidor no devolvió el video");
      R.assets = R.assets || []; R.assets.unshift({ name: f.name, url: url, mime_type: mime });
      return dur.then(function (d) {
        var p = VE.p; vsnap();
        var len = isFinite(d) && d > 0 ? Math.round(d * 10) / 10 : 5;
        var ti = R.takeFor(url, name, len), c = take(ti, Math.min(len, 600));
        p.v1.push(c); VE.sel = { tr: "v1", i: p.v1.length - 1 };
        veAll(); veInsp();
        var st = 0; p.v1.forEach(function (x) { if (x !== c) st += x.dur || 0; }); VE.t = st + Math.min(0.5, c.dur / 2); veStage(); veTimeline();
        toast("Video agregado al final de V1 (" + len.toFixed(1).replace(".", ",") + " s)");
      });
    }).catch(function (x) { toast("No se pudo subir el video: " + (x && x.message || x)); });
  }
  vq("#veBin").addEventListener("change", function (e) {
    var inp = e.target; if (!inp || !inp.dataset || !inp.dataset.proin) return;
    var f = inp.files && inp.files[0], k = inp.dataset.proin; if (!f) return;
    var done = function () { try { inp.value = ""; } catch (x) {} };
    if (!VE.p || !VE.p._real) { done(); return toast("Abre un video tuyo para subir archivos"); }
    if (k === "upvid") { Promise.resolve(uploadVideo(f)).then(done, done); return; }
    var aud = k === "upaud";
    if (aud ? f.size > 15e6 : f.size > 5e6) { done(); return toast(aud ? "El audio supera 15 MB" : "La imagen supera 5 MB"); }
    toast("Subiendo " + f.name + "…");
    readData(f).then(function (d) {
      if (aud && !/^data:audio\//.test(d)) d = d.replace(/^data:[^;]*;/, "data:audio/mpeg;");
      return upload(d, f.name);
    }).then(function (r) {
      var R = RB(); R.assets = R.assets || []; R.assets.unshift({ name: f.name, url: r.url, mime_type: f.type || (aud ? "audio/mpeg" : "image/png") });
      if (aud) return addAudio(f.name.replace(/\.[^.]+$/, ""), r.url).then(function () { veBin(); });
      upDone(f, r.url); veBin();
    }).catch(function (x) { toast("No se pudo subir: " + (x && x.message || x)); }).then(done);
  });
  vq("#veBin").addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-pro]"); if (!b) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var k = b.dataset.pro, p = VE.p, W = VFMT[p.fmt][0], H = VFMT[p.fmt][1];
    if (k === "upimg" || k === "upaud") {
      if (!p._real) return toast("Abre un video tuyo para subir archivos");
      var aud = k === "upaud";
      pickFile(aud ? "audio/*" : "image/*").then(function (f) {
        if (!f) return;
        if (aud ? f.size > 15e6 : f.size > 5e6) return toast(aud ? "El audio supera 15 MB" : "La imagen supera 5 MB");
        toast("Subiendo " + f.name + "…");
        return readData(f).then(function (d) {
          if (aud && !/^data:audio\//.test(d)) d = d.replace(/^data:[^;]*;/, "data:audio/mpeg;");
          return upload(d, f.name);
        }).then(function (r) {
          var R = RB(); R.assets = R.assets || []; R.assets.unshift({ name: f.name, url: r.url, mime_type: f.type || (aud ? "audio/mpeg" : "image/png") });
          if (aud) return addAudio(f.name.replace(/\.[^.]+$/, ""), r.url);
          upDone(f, r.url); veBin();
        });
      }).catch(function (x) { toast("No se pudo subir: " + (x && x.message || x)); });
      return;
    }
    if (k === "upvid") {
      if (!p._real) return toast("Abre un video tuyo para subir archivos");
      pickFile("video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v").then(function (f) { if (f) return uploadVideo(f); }).catch(function (x) { toast("No se pudo subir el video: " + (x && x.message || x)); });
      return;
    }
    if (k === "addaud") return addAudio(b.dataset.name, b.dataset.url);
    if (k === "logo") { addMedia(b.dataset.name + " · logo", b.dataset.url, true); return toast("Logo agregado en M"); }
    if (k === "shape") {
      var v = b.dataset.v, col = brandColor(); vsnap();
      var c = { id: nid(), name: { circle: "Círculo", rect: "Rectángulo", pill: "Píldora", halo: "Halo", bggrad: "Degradado" }[v], start: r1(Math.min(VE.t, Math.max(0, veDur(p) - 0.5))), dur: 3, x: 50, y: 50, w: 30, ar: 1, opacity: 1, radius: 0, anim: "fade", bg: col };
      if (v === "circle") c.shape = "circle";
      if (v === "rect") { c.ar = 1.6; c.radius = 24; }
      if (v === "pill") { c.ar = 3; c.radius = 999; }
      if (v === "halo") { c.w = 70; c.grad = { type: "halo", a: col }; c.bg = gradCss(c.grad); }
      if (v === "bggrad") { c.w = 100; c.ar = r1(W / H); c.grad = { type: "linear", a: "#111111", b: col, angle: 160 }; c.bg = gradCss(c.grad); c.dur = Math.max(3, r1(veDur(p) - c.start)); }
      if (v === "bggrad") p.m.unshift(c); else p.m.push(c);
      VE.sel = { tr: "m", i: v === "bggrad" ? 0 : p.m.length - 1 };
      veAll(); veInsp(); reveal(c);
      return toast(c.name + " agregado en M");
    }
  }, true);

  /* ═════ audio propio: suena al reproducir en el editor ═════ */
  var AUD = {};
  function audioTick() {
    if (!VE.p) return;
    (VE.p.a || []).forEach(function (c) {
      if (!c.url) return;
      var el = AUD[c.id] || (AUD[c.id] = Object.assign(new Audio(), { preload: "auto", src: c.url }));
      var inside = VE.playing && VE.t >= c.start && VE.t < c.start + c.dur;
      if (!inside) { if (!el.paused) el.pause(); return; }
      var want = VE.t - c.start;
      el.volume = VE.p.lanes && VE.p.lanes.a && VE.p.lanes.a.mute ? 0 : cl(gainAt(VE.p, c, VE.t), 0, 1);
      if (el.paused) { try { el.currentTime = want; } catch (x) {} el.play().catch(function () {}); }
      else if (Math.abs(el.currentTime - want) > 0.35) { try { el.currentTime = want; } catch (x) {} }
    });
  }
  var _stage = veStage;
  veStage = function () { var r = _stage.apply(this, arguments); audioTick(); return r; };
  var _stop = veStop;
  veStop = function () { Object.keys(AUD).forEach(function (k) { AUD[k].pause(); }); return _stop.apply(this, arguments); };

  /* ═════ paneles con nombre ═════ */
  try {
    var bin = vq(".ve-bin"); if (bin) bin.setAttribute("aria-label", "Biblioteca");
    var insp = vq(".ve-insp"); if (insp) insp.setAttribute("aria-label", "Inspector");
    var tl = vq(".ve-tl"); if (tl) tl.setAttribute("aria-label", "Timeline");
    var box = vq("#veBox"); if (box) { box.setAttribute("role", "img"); box.setAttribute("aria-label", "Vista previa del video"); }
  } catch (e) {}
  /* ═════ QA Instinct · retest 11-nov ═════
     UX7: el nombre del proyecto ya no se corta en el Inspector (campo de dos líneas).
     UX1: cada control del Inspector tiene nombre para lectores de pantalla y automatizaciones.
     UX5: las píldoras de texto se recolorean todas juntas (antes una por una). */
  var _inspQA = veInsp;
  veInsp = function () {
    var r = _inspQA.apply(this, arguments), box = vq("#veInsp"); if (!box) return r;
    /* Total: se puede fijar a mano (QA Instinct bug 5); vacío = según el último clip */
    [].forEach.call(box.querySelectorAll(".ed-kv"), function (kv) {
      var sp = kv.querySelector("span"); if (!sp || sp.textContent.trim() !== "Total" || kv.querySelector("input")) return;
      kv.innerHTML = '<span>Total (s)</span><input type="number" step="0.01" min="0.5" data-pk="pt.total" value="' + (VE.p.total ? VE.p.total : "") + '" placeholder="' + r1(veDur(Object.assign({}, VE.p, { total: 0 }))) + ' (auto)" aria-label="Duración total en segundos" style="width:90px">';
    });
    var nm = box.querySelector('input[data-vk="P.name"]');
    if (nm) {
      var ta = document.createElement("textarea");
      ta.setAttribute("data-vk", "P.name"); ta.value = nm.value; ta.rows = 2; ta.className = nm.className;
      ta.setAttribute("aria-label", "Nombre del proyecto"); ta.title = nm.value;
      ta.style.cssText = "width:100%;resize:none;font:inherit;line-height:1.3;background:transparent;color:inherit;border:1px solid var(--e-line2,#333);border-radius:6px;padding:4px 6px;min-width:0";
      ta.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); ta.blur(); } });
      var ph = nm.parentNode; nm.replaceWith(ta); if (ph) { ph.style.flexWrap = "wrap"; ph.style.gap = "6px"; }
    }
    [].forEach.call(box.querySelectorAll("input,select,textarea"), function (c) {
      if (c.getAttribute("aria-label")) return;
      var lab = c.closest("label"), sp = lab && lab.querySelector("span"), t = (sp && sp.textContent || c.getAttribute("placeholder") || c.dataset.k || c.dataset.vk || "").trim();
      if (t) c.setAttribute("aria-label", t);
    });
    var s = VE.sel, o = objSel();
    if (o && s && s.tr === "t" && o.bg && !/^(transparent|none)$/i.test(o.bg)) {
      var same = (VE.p.t || []).filter(function (x) { return x !== o && x.bg && x.bg.toLowerCase() !== String(o.bg).toLowerCase() && !/^(transparent|none)$/i.test(x.bg); }).length;
      if (same) {
        var acts = box.lastElementChild, h = '<div class="ve-bsec" style="margin:8px 12px"><button class="ed-btn" data-pillall style="width:100%">Usar este fondo y color en las ' + (same + 1) + " píldoras</button></div>";
        if (acts && acts.classList.contains("ed-sb")) acts.insertAdjacentHTML("beforebegin", h); else box.insertAdjacentHTML("beforeend", h);
      }
    }
    return r;
  };
  vq("#veInsp").addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-pillall]"); if (!b) return;
    var o = objSel(); if (!o || !o.bg) return;
    vsnap();
    var n = 0;
    (VE.p.t || []).forEach(function (x) { if (x !== o && x.bg && !/^(transparent|none)$/i.test(x.bg)) { x.bg = o.bg; x.color = o.color; n++; } });
    veAll(); veInsp();
    toast(n + (n === 1 ? " píldora recoloreada" : " píldoras recoloreadas") + " con " + o.bg);
  });
  /* ═════ QA Instinct · reel Comfy v2 ═════ */
  /* bug 1 · subir: el <input type=file> es el MISMO entre redibujos del panel (antes se recreaba y una
     herramienta que guardaba el input lo veía muerto tras la primera subida) */
  var UPIN = {};
  var _binUp = veBin;
  veBin = function () {
    var r = _binUp.apply(this, arguments), box = vq("#veBin"); if (!box) return r;
    [].forEach.call(box.querySelectorAll("input[data-proin]"), function (fresh) {
      var k = fresh.dataset.proin, keep = UPIN[k];
      if (!keep) { UPIN[k] = fresh; return; }
      if (keep !== fresh) { try { keep.value = ""; } catch (e) {} fresh.replaceWith(keep); }
    });
    /* bug 4 · miniaturas de las tomas en Media: un cuadro real del video (antes, cuadros negros) */
    [].forEach.call(box.querySelectorAll('[data-add="take"]'), function (it) {
      var tk = VTAKES[+it.dataset.v], th = it.querySelector(".ve-bth"); if (!tk || !tk.blob || !th) return;
      takeThumb(tk.blob).then(function (d) { if (d) th.style.background = "#000 url('" + d + "') center/cover no-repeat"; });
    });
    return r;
  };
  var THC = {}, THV = {};
  var THQ = [], THN = 0;
  function thNext() { while (THN < 2 && THQ.length) { THN++; THQ.shift()(); } }
  function takeThumb(url) {
    if (THC[url]) return THC[url];
    return THC[url] = new Promise(function (go) { THQ.push(go); thNext(); }).then(function () { return takeThumb1(url); }).then(function (d) { THN--; thNext(); return d; });
  }
  function takeThumb1(url) {
    return new Promise(function (ok) {
      var v = document.createElement("video"); v.muted = true; v.preload = "auto"; v.crossOrigin = "anonymous"; v.playsInline = true;
      /* QA Instinct B4: WebKit/Safari no carga un <video> fuera de la página: se monta oculto mientras se saca el cuadro */
      v.setAttribute("aria-hidden", "true"); v.style.cssText = "position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none";
      document.body.appendChild(v);
      var done = false, fin = function (d) { if (done) return; done = true; ok(d || null); v.removeAttribute("src"); try { v.load(); } catch (e) {} v.remove(); };
      v.onloadeddata = function () { try { v.currentTime = Math.min(0.5, (v.duration || 1) / 3); } catch (e) { fin(); } };
      v.onseeked = function () { try { var c = document.createElement("canvas"), s = 96 / Math.max(v.videoWidth, v.videoHeight); c.width = Math.max(1, Math.round(v.videoWidth * s)); c.height = Math.max(1, Math.round(v.videoHeight * s)); c.getContext("2d").drawImage(v, 0, 0, c.width, c.height); fin(c.toDataURL("image/jpeg", 0.7)); } catch (e) { fin(); } };
      v.onerror = function () { fin(); }; setTimeout(function () { fin(); }, 8000);
      v.src = url; try { v.load(); } catch (e) {}
    });
  }
  /* bug 3 · clic en la regla: el tiempo cambiaba pero la línea del cursor no se movía hasta arrastrar */
  var _seekQA = veSeek;
  veSeek = function (t) {
    var r = _seekQA.apply(this, arguments), ph = document.querySelector("#veLanes .ve-ph");
    if (ph) ph.style.left = VE.t * VE.pps + "px";
    return r;
  };
  /* bug 5 · «Tamaño» es el tamaño de la fuente en px del video (como en CSS); una mayúscula mide ~70 % de eso */
  var _inspSize = veInsp;
  veInsp = function () {
    var r = _inspSize.apply(this, arguments), box = vq("#veInsp");
    if (box && VE.sel && VE.sel.tr === "t") [].forEach.call(box.querySelectorAll('input[data-k="size"]'), function (i) {
      var lab = i.closest("label"), sp = lab && lab.querySelector("span"); if (sp && !/px/.test(sp.textContent)) sp.textContent = "Tamaño (px)";
      var tip = "Tamaño de la fuente en px del video, como en CSS. Una letra mayúscula mide cerca del 70 % de este valor: si mides 76 px de alto en el original, usa ~107.";
      i.title = tip; if (lab) lab.title = tip;
    });
    return r;
  };
  /* bug 6 · clips pegados en la misma fila: una separación visible para que el borde no sea ambiguo */
  var stQA = document.createElement("style");
  stQA.textContent = "#veLanes .ve-clip{box-shadow:inset -2px 0 0 #0b0b0b,inset 2px 0 0 #0b0b0b}"
    /* una lista con nombres largos (Morph hacia otro clip) no ensancha el inspector ni deja campos en 0 px */
    + "#veInsp .ed-sb>*{min-width:0}#veInsp .ef select,#veInsp .ef input{min-width:0;max-width:100%}"
    /* etiquetas largas: bajan de línea y el número conserva su ancho (antes el campo quedaba en 0 px) */
    + "#veInsp .ef.full>span{white-space:normal;flex:1 1 0;min-width:0;line-height:1.25}#veInsp .ef.full>input[type=number]{flex:0 0 84px;width:84px;min-width:84px}";
  document.head.appendChild(stQA);

  /* ═════ QA Instinct · reel Comfy v3: herramientas de motion graphics ═════
     P0-1 eje Z con perspectiva y orden de pintado por profundidad · P0-2 «Repetir en anillo» (órbita con fase por
     copia) · P1-3 entrada «Apilarse» con stagger y rebote · P1-4 curva por keyframe (ease, spring, cubic-bezier) ·
     P2-5 SVG como capa vectorial recoloreable y separable · P2-6 formas vectoriales (arco, anillo, línea, blob…) ·
     P2-7 recorrido dibujado en el video · P2-8 morph entre cualquier par de clips (texto ↔ media). Todo usa el
     mismo cálculo en la vista previa y en el MP4 (state / order / bgOf). */
  function H0() { var f = VFMT[(VE.p && VE.p.fmt) || "9:16"] || VFMT["9:16"]; return f[1]; }
  function persp() { var v = VE.p && +VE.p.persp; return v >= 100 ? v : 1000; }

  /* ── curvas ── */
  var EASES = [["auto", "Automática"], ["lin", "Lineal"], ["smooth", "Suave (ease in-out)"], ["in", "Ease in"], ["out", "Ease out"], ["spring", "Spring (rebote)"], ["bezier", "Personalizada (cubic-bezier)"]];
  var EASEN = {}; EASES.forEach(function (e) { EASEN[e[0]] = e[1]; });
  /* resorte amortiguado: con rebote > 0 se pasa del valor final y vuelve (overshoot) */
  function springE(u, b, v) {
    if (u <= 0) return 0; if (u >= 1) return 1;
    b = cl(b == null ? 50 : +b, 0, 100) / 100; v = cl(v == null ? 50 : +v, 1, 100) / 100;
    var k = 4 + v * 8, f;
    if (b < 0.02) f = 1 - Math.exp(-k * u) * (1 + k * u);
    else { var w = Math.PI * (1 + b * 4); f = 1 - Math.exp(-k * u) * (Math.cos(w * u) + (k / w) * Math.sin(w * u)); }
    if (u > 0.9) { var q = (u - 0.9) / 0.1; f = f + (1 - f) * q * q; }
    return f;
  }
  var BZC = {};
  function bezierE(spec) {
    if (BZC[spec]) return BZC[spec];
    var n = String(spec || "").split(/[\s,]+/).filter(Boolean).map(Number);
    if (n.length !== 4 || n.some(function (x) { return !isFinite(x); })) n = [0.34, 1.56, 0.64, 1];
    var x1 = cl(n[0], 0, 1), y1 = n[1], x2 = cl(n[2], 0, 1), y2 = n[3];
    return BZC[spec] = function (x) {
      if (x <= 0) return 0; if (x >= 1) return 1;
      var t = x;
      for (var i = 0; i < 10; i++) {
        var bx = 3 * x1 * t * (1 - t) * (1 - t) + 3 * x2 * t * t * (1 - t) + t * t * t - x;
        var d = 3 * x1 * (1 - t) * (1 - t) + 6 * (x2 - x1) * t * (1 - t) + 3 * (1 - x2) * t * t;
        if (Math.abs(bx) < 1e-5 || Math.abs(d) < 1e-6) break;
        t = cl(t - bx / d, 0, 1);
      }
      return 3 * y1 * t * (1 - t) * (1 - t) + 3 * y2 * t * t * (1 - t) + t * t * t;
    };
  }
  function easeBy(e, u, kf) {
    switch (e) {
      case "lin": return u;
      case "in": return EASE["ease-in"](u);
      case "out": return EASE["ease-out"](u);
      case "spring": return springE(u, kf && kf.sb, kf && kf.sv);
      case "bezier": return bezierE(kf && kf.bz)(u);
      default: return EASE["ease-in-out"](u);
    }
  }
  /* keyframes: x, y, z, escala, rotación, opacidad y avance en el recorrido; cada keyframe elige la curva hasta el
     siguiente («Automática» = como antes: recta con «Curva suave», ease in-out sin ella) */
  /* «b» = desenfoque en px (lo usa el código: un filter blur() animado vuelve como keyframes) */
  var KP = ["x", "y", "z", "s", "r", "o", "b"];
  function kfFill(k) { var o = {}; KP.forEach(function (q) { o[q] = k[q] != null && isFinite(+k[q]) ? +k[q] : (q === "s" || q === "o" ? 1 : 0); }); if (k.p != null) o.p = +k.p; return o; }
  function sampleK(c, t) {
    var kf = c.kf;
    if (!kf || !kf.length) return { x: 0, y: 0, z: 0, s: 1, r: 0, o: 1 };
    if (t <= kf[0].t) return kfFill(kf[0]);
    if (t >= kf[kf.length - 1].t) return kfFill(kf[kf.length - 1]);
    var i = kf.findIndex(function (k) { return k.t > t; });
    /* tiempo inválido o keyframes sin tiempo: el valor del primero (antes rompía el cuadro) */
    if (i < 1) return kfFill(kf[i < 0 ? kf.length - 1 : 0]);
    var a = kf[i - 1], b = kf[i], u = (t - a.t) / ((b.t - a.t) || 1);
    var e = a.e && a.e !== "auto" ? a.e : (c.curve ? "lin" : "smooth"), q = easeBy(e, u, a);
    var A = kfFill(a), B = kfFill(b), out = {};
    KP.forEach(function (p) { out[p] = A[p] + (B[p] - A[p]) * q; });
    if (A.p != null || B.p != null) { var pa = A.p != null ? A.p : B.p, pb = B.p != null ? B.p : pa; out.p = pa + (pb - pa) * q; }
    if (c.curve && kf.length >= 3) {
      var P0 = kfFill(kf[Math.max(0, i - 2)]), P3 = kfFill(kf[Math.min(kf.length - 1, i + 1)]), u2 = q * q, u3 = u2 * q;
      ["x", "y", "z"].forEach(function (p) { var a0 = P0[p], b0 = A[p], c0 = B[p], d0 = P3[p]; out[p] = 0.5 * ((2 * b0) + (-a0 + c0) * q + (2 * a0 - 5 * b0 + 4 * c0 - d0) * u2 + (-a0 + 3 * b0 - 3 * c0 + d0) * u3); });
    }
    return out;
  }

  /* ── P0-1 · perspectiva: Z positivo = hacia ti. Escala aparente y posición salen de la cámara del proyecto ── */
  function project3d(c, st) {
    if (!st.z) return;
    var P = persp(), z = Math.min(st.z, P * 0.92), f = P / (P - z), W = W0(), H = H0();
    var bx = W * (+c.x || 0) / 100, by = H * (+c.y || 0) / 100;
    st.dx = W / 2 + (bx + st.dx - W / 2) * f - bx;
    st.dy = H / 2 + (by + st.dy - H / 2) * f - by;
    st.s *= f;
  }
  function zOf(c, t) { var lt = t - c.start; return (sampleK(c, lt).z || 0) + orbV(c, lt).z; }
  /* orden de pintado: por Z en cada instante (un clip pasa por delante y por detrás de otro sin cambiar de pista).
     Con todo en Z = 0 queda como siempre: media primero, textos encima, en el orden de la lista. */
  function order(p, t) {
    var L = [], anyZ = false;
    (p.m || []).forEach(function (c, i) { if (t >= c.start && t < c.start + c.dur) L.push({ k: "m", c: c, i: i }); });
    (p.t || []).forEach(function (c, i) { if (t >= c.start && t < c.start + c.dur) L.push({ k: "t", c: c, i: 1e5 + i }); });
    L.forEach(function (q) { q.z = zOf(q.c, t); if (q.z) anyZ = true; });
    /* QA Instinct T7: «capa» por clip (Al frente / Al fondo) manda sobre la pista: un texto puede ir detrás de una imagen */
    var anyZi = L.some(function (q) { return +q.c.zi; });
    if (anyZ || anyZi) L.sort(function (a, b) { return (+a.c.zi || 0) - (+b.c.zi || 0) || a.z - b.z || a.i - b.i; });
    return L;
  }

  /* ── P0-2 · órbita propia del clip (la usa «Repetir en anillo»): fase, inclinación y profundidad ── */
  function hash01(v) { var h = 2166136261; v = String(v); for (var i = 0; i < v.length; i++) { h ^= v.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10007) / 10007; }
  function orbV(c, lt) {
    var o = c.orb; if (!o) return { x: 0, y: 0, z: 0, s: 1, r: 0 };
    var R = +o.r || 0, from = +o.from || 0, len = +o.len > 0 ? +o.len : Math.max(0.1, c.dur - from), u = cl((lt - from) / len, 0, 1);
    var rr = R * (1 + ((o.end != null ? +o.end : 100) / 100 - 1) * u);
    /* QA Instinct T9: «Girar todo el anillo» suma a la fase de todos */
    var a = ((+o.ph || 0) + (+o.rot || 0) + u * 360 * (+o.turns || 0)) * Math.PI / 180;
    var tilt = o.tilt != null ? +o.tilt : 0.35, depth = o.depth != null ? cl(+o.depth, 0, 1) : 1, sc = 1, rot = 0, rb = rr, bop = 1, bbl = 0;
    /* variedad de tamaños: cada clip un poco más grande o más chico, siempre igual (sale de su id) */
    if (+o.sv > 0) sc *= 1 + cl(+o.sv, 0, 90) / 100 * (hash01(c.id) * 2 - 1);
    /* ráfaga de cámara (QA Instinct T9): el anillo empieza «bs» veces más grande, con cada ícono inclinado, y se
       cierra en «bd» s hasta su tamaño (los íconos gigantes del reel en 0,3 s que terminan en el anillo chico) */
    var bs = +o.bs || 0;
    if (bs > 1) {
      var bd = +o.bd > 0 ? +o.bd : 0.7, bu = cl((lt - from) / bd, 0, 1), k = Math.pow(1 - bu, 3), m = 1 + (bs - 1) * k;
      /* QA Instinct v15: «Distancia inicial ×» separada de «Tamaño inicial ×» (antes tarjeta grande = tarjeta lejos y la
         ráfaga empezaba fuera del cuadro). Distancia 0,4 = las tarjetas gigantes ya llenan el cuadro desde el primer cuadro. */
      var bdst = o.bdist != null && o.bdist !== "" ? Math.max(0, +o.bdist) : bs;
      rb = rr * (1 + (bdst - 1) * k); sc *= m; rot = (o.bt != null ? +o.bt : 28) * k * (hash01(c.id + "r") * 2 - 1);
      tilt = tilt + (cl(o.btl != null ? +o.btl : 0.15, 0, 1) - tilt) * k;
      /* QA Instinct v13/v14: en la ráfaga se ven solo «bvis» clips (los demás aparecen al cerrarse) y con desenfoque de movimiento */
      if (+o.bvis > 0 && +o.bn > 0 && bu < 1) {
        var idx = Math.round(((((+o.ph || 0) % 360) + 360) % 360) / (360 / +o.bn)) % +o.bn, stp = Math.max(1, Math.round(+o.bn / +o.bvis));
        if (idx % stp !== 0) bop = cl((bu - 0.8) / 0.2, 0, 1);
      }
      if (+o.bmb > 0) bbl = +o.bmb * k;
    }
    /* QA Instinct v15/v16: «Salida del anillo»: a partir de un instante los clips se van hacia afuera y se desvanecen;
       quedan «xk» sueltos (el reel a 1,5 s: la C grande con pocos íconos) */
    var xs = +o.xs || 0;
    if (xs > 0 && lt > xs) {
      var xu = cl((lt - xs) / (+o.xd > 0 ? +o.xd : 0.4), 0, 1), xe = xu * xu * (3 - 2 * xu), keep = false;
      if (+o.xk > 0 && +o.bn > 0) { var xi = Math.round(((((+o.ph || 0) % 360) + 360) % 360) / (360 / +o.bn)) % +o.bn; keep = xi % Math.max(1, Math.round(+o.bn / +o.xk)) === 0; }
      if (!keep) { rb *= 1 + ((+o.xm > 0 ? +o.xm : 3) - 1) * xe; bop *= 1 - xe; sc *= 1 + 0.4 * xe; }
    }
    return { x: rb * Math.cos(a), y: rb * tilt * Math.sin(a), z: rr * depth * Math.sin(a), s: sc, r: rot, o: bop, blur: bbl };
  }

  /* ── P1-3 · «Apilarse»: cae desde una dirección, rebota y se asienta con su giro final ── */
  function stackEn(c, lt) {
    if (lt < 0) return { o: 0 };
    var D = +c.stD > 0 ? +c.stD : 0.9, u = cl(lt / D, 0, 1), q = springE(u, c.stB != null ? +c.stB : 40, 55);
    var a = (+c.stDir || 0) * Math.PI / 180, dist = +c.stDist > 0 ? +c.stDist : 1300, R = +c.stR || 0;
    return { dx: Math.sin(a) * dist * (1 - q), dy: -Math.cos(a) * dist * (1 - q), r: R + (1 - q) * (R >= 0 ? 35 : -35), o: Math.min(1, u * 6) };
  }

  /* ── P2-7 · recorrido dibujado: spline por los puntos, recorrido a velocidad pareja (por longitud) ── */
  var PTB = {};
  function pathTable(pts) {
    var key = JSON.stringify(pts); if (PTB[key]) return PTB[key];
    var P = pts.map(function (q) { return [+q[0] || 0, +q[1] || 0]; }), S = [], L = [0];
    for (var i = 0; i < P.length - 1; i++) {
      var p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
      for (var j = 0; j < 24; j++) {
        var u = j / 24, u2 = u * u, u3 = u2 * u, cr = function (a, b, c2, d) { return 0.5 * ((2 * b) + (-a + c2) * u + (2 * a - 5 * b + 4 * c2 - d) * u2 + (-a + 3 * b - 3 * c2 + d) * u3); };
        S.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    S.push(P[P.length - 1]);
    for (var k = 1; k < S.length; k++) L.push(L[k - 1] + Math.hypot(S[k][0] - S[k - 1][0], S[k][1] - S[k - 1][1]));
    var tot = L[L.length - 1] || 1;
    var tb = { pts: S, at: function (u) {
      var d = cl(u, 0, 1) * tot, i2 = 1; while (i2 < L.length - 1 && L[i2] < d) i2++;
      var seg = (L[i2] - L[i2 - 1]) || 1, f = cl((d - L[i2 - 1]) / seg, 0, 1);
      return { x: S[i2 - 1][0] + (S[i2][0] - S[i2 - 1][0]) * f, y: S[i2 - 1][1] + (S[i2][1] - S[i2 - 1][1]) * f };
    } };
    if (Object.keys(PTB).length > 200) PTB = {};
    return PTB[key] = tb;
  }
  function pathV(c, lt, k) {
    var P = c.path; if (!P || !P.pts || P.pts.length < 2) return { x: 0, y: 0 };
    var from = +P.from || 0, len = +P.len > 0 ? +P.len : Math.max(0.1, c.dur - from);
    var u = k && k.p != null ? k.p / 100 : easeBy(P.e || "smooth", cl((lt - from) / len, 0, 1), P);
    return pathTable(P.pts).at(u);
  }

  /* ── P2-8 · morph entre dos clips cualesquiera: A viaja y se escala hacia B mientras se desenfoca y se va; B
     nace en el lugar y tamaño de A y se asienta en el suyo ── */
  function clipById(id) { var p = VE.p, r = null; if (!p || !id) return null; ["m", "t"].some(function (k) { var c = (p[k] || []).find(function (x) { return x.id === id; }); if (c) { r = { k: k, c: c }; return true; } }); return r; }
  function textW(c) { var size = fitSize(c, W0()); mc.font = (c.weight || 800) + " " + size + "px " + (FONTS[c.font] || FONTS.Inter); return Math.max.apply(null, String(c.text || " ").split("\n").map(function (l) { return mc.measureText(l).width; })) + (c.bg ? size * 1.1 : 0); }
  function boxOf(c, k) { return { x: W0() * (+c.x || 0) / 100, y: H0() * (+c.y || 0) / 100, w: Math.max(1, k === "m" ? W0() * (c.w || 40) / 100 : textW(c)) }; }
  function mWin(A, B) { var at = A.morphAt != null ? +A.morphAt : Math.max(0, B.start - A.start); return { t0: A.start + at, d: Math.max(0.05, A.morphD != null ? +A.morphD : 0.5) }; }
  function morphSrc(c) {
    var p = VE.p, src = null; if (!p || !c.id) return null;
    ["m", "t"].some(function (k) { var x = (p[k] || []).find(function (y) { return y.morphClip === c.id && y !== c; }); if (x) { src = { k: k, c: x }; return true; } });
    return src;
  }
  function morphClipFx(c, t, kind, st) {
    var p = VE.p; if (!p) return;
    if (c.morphClip) {
      var B = clipById(c.morphClip);
      if (B && B.c !== c) {
        var w = mWin(c, B.c), mp = cl((t - w.t0) / w.d, 0, 1);
        if (mp > 0) { var e = EASE["ease-in-out"](mp), a = boxOf(c, kind), b = boxOf(B.c, B.k); st.dx += (b.x - a.x) * e; st.dy += (b.y - a.y) * e; st.s *= 1 + (b.w / a.w - 1) * e; st.o *= 1 - mp; st.blur = (st.blur || 0) + mp * 14; }
      }
    }
    var src = morphSrc(c);
    if (src) {
      var w2 = mWin(src.c, c), mp2 = cl((t - w2.t0) / w2.d, 0, 1);
      if (mp2 < 1) { var e2 = EASE["ease-in-out"](mp2), A2 = boxOf(src.c, src.k), B2 = boxOf(c, kind), rt = A2.w / B2.w; st.dx += (A2.x - B2.x) * (1 - e2); st.dy += (A2.y - B2.y) * (1 - e2); st.s *= rt + (1 - rt) * e2; st.o *= mp2; st.blur = (st.blur || 0) + (1 - mp2) * 14; }
    }
  }

  /* ── P2-5 / P2-6 · vectores: SVG propio (recoloreable y separable) y formas vectoriales; se dibujan a 2048 px,
     nítidos a cualquier escala en la vista previa y en el MP4 ── */
  function sanitizeSvg(s) {
    s = String(s || ""); var i = s.search(/<svg[\s>]/i); if (i < 0) return null;
    s = s.slice(i).replace(/<script[\s\S]*?<\/script\s*>/gi, "").replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "")
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/(href\s*=\s*["'])\s*javascript:[^"']*/gi, "$1#");
    var end = s.lastIndexOf("</svg>"); if (end > 0) s = s.slice(0, end + 6);
    return s.length > 400000 ? null : s;
  }
  var COLRE = /((?:fill|stroke|stop-color|flood-color)\s*(?:=\s*["']|:\s*))(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|[a-zA-Z]+)/g;
  var SKIPC = { none: 1, transparent: 1, currentcolor: 1, inherit: 1, url: 1, initial: 1 };
  function normCol(v) { v = String(v).trim().toLowerCase(); if (/^#[0-9a-f]{3}$/.test(v)) v = "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]; return v; }
  function toHex(v) { try { mc.fillStyle = "#000000"; mc.fillStyle = v; var h = mc.fillStyle; return /^#[0-9a-f]{6}$/i.test(h) ? h : "#000000"; } catch (e) { return "#000000"; } }
  function svgColors(svg) {
    var seen = {}, out = [];
    String(svg).replace(COLRE, function (m, pre, col) { var n = normCol(col); if (!SKIPC[n] && !seen[n]) { seen[n] = 1; out.push(n); } return m; });
    if (!out.length) out.push("#000000");
    return out.slice(0, 12);
  }
  function recolor(svg, map) {
    if (!map) return svg;
    var s = String(svg).replace(COLRE, function (m, pre, col) { var to = map[normCol(col)]; return to ? pre + to : m; });
    /* lo que no declara color se pinta negro: «#000000» también lo cambia */
    if (map["#000000"]) s = s.replace(/<svg\b([^>]*)>/i, function (m, at) { return /\sfill\s*=/.test(at) ? m : "<svg" + at + ' fill="' + map["#000000"] + '">'; });
    return s;
  }
  function sizeSvg(s) {
    var m = s.match(/<svg\b[^>]*>/i); if (!m) return { svg: s, ar: 1 };
    var tag = m[0], vb = tag.match(/viewBox\s*=\s*["']\s*([-\d.e]+)[\s,]+([-\d.e]+)[\s,]+([-\d.e]+)[\s,]+([-\d.e]+)/i), w, h;
    if (vb) { w = +vb[3]; h = +vb[4]; }
    else { var wm = tag.match(/\swidth\s*=\s*["']?([\d.]+)/i), hm = tag.match(/\sheight\s*=\s*["']?([\d.]+)/i); w = wm ? +wm[1] : 100; h = hm ? +hm[1] : 100; }
    if (!(w > 0 && h > 0)) { w = 100; h = 100; }
    var nt = tag.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    if (!vb) nt = nt.replace(/<svg\b/i, '<svg viewBox="0 0 ' + w + " " + h + '"');
    var sc = 2048 / Math.max(w, h);
    nt = nt.replace(/<svg\b/i, '<svg width="' + Math.round(w * sc) + '" height="' + Math.round(h * sc) + '" preserveAspectRatio="xMidYMid meet"');
    if (!/xmlns\s*=/.test(nt)) nt = nt.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    return { svg: s.replace(tag, nt), ar: w / h };
  }
  var VSH = [["arc", "Arco"], ["ring", "Anillo"], ["line", "Línea"], ["blob", "Blob"], ["tri", "Triángulo"], ["star", "Estrella"]];
  function shapeSvg(v) {
    var c = v.col || "#ffffff", sw = cl(+v.sw || 6, 0.5, 60), k = v.kind, o = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">', E = "</svg>";
    if (k === "arc") {
      var sweep = cl(+v.sweep || 180, 1, 359.9), r = 100 - sw / 2 - 1, a0 = (-90 - sweep / 2) * Math.PI / 180, a1 = (-90 + sweep / 2) * Math.PI / 180;
      return o + '<path d="M' + r1(100 + r * Math.cos(a0)) + " " + r1(100 + r * Math.sin(a0)) + " A" + r1(r) + " " + r1(r) + " 0 " + (sweep > 180 ? 1 : 0) + " 1 " + r1(100 + r * Math.cos(a1)) + " " + r1(100 + r * Math.sin(a1)) + '" fill="none" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round"/>' + E;
    }
    if (k === "ring") return o + '<circle cx="100" cy="100" r="' + r1(100 - sw / 2 - 1) + '" fill="none" stroke="' + c + '" stroke-width="' + sw + '"/>' + E;
    if (k === "line") return o + '<line x1="' + r1(sw / 2 + 1) + '" y1="100" x2="' + r1(199 - sw / 2) + '" y2="100" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round"/>' + E;
    if (k === "blob") return o + '<path d="M104 14C146 12 186 44 188 92C190 140 160 182 110 186C62 190 16 164 12 112C8 66 52 16 104 14Z" fill="' + c + '"/>' + E;
    if (k === "tri") return o + '<polygon points="100,14 188,178 12,178" fill="' + c + '"/>' + E;
    var pts = []; for (var i = 0; i < 10; i++) { var rr = i % 2 ? 40 : 96, a = (i * 36 - 90) * Math.PI / 180; pts.push(r1(100 + rr * Math.cos(a)) + "," + r1(104 + rr * Math.sin(a))); }
    return o + '<polygon points="' + pts.join(" ") + '" fill="' + c + '"/>' + E;
  }
  var VCACHE = {}, VCN = 0;
  function vecUrl(c) {
    var key = c.vshape ? "S" + JSON.stringify(c.vshape) : "V" + (c.svg || "") + "|" + JSON.stringify(c.svgMap || {});
    if (VCACHE[key]) return VCACHE[key];
    var raw = c.vshape ? shapeSvg(c.vshape) : recolor(c.svg, c.svgMap), sv = sizeSvg(raw).svg;
    if (++VCN > 300) { VCACHE = {}; VCN = 0; }
    return VCACHE[key] = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(sv)));
  }
  function bgOf(c) { return c && (c.svg || c.vshape) ? "url('" + vecUrl(c) + "') center/contain no-repeat" : c && c.bg; }
  function asVector(c, f) {
    if (!c || !f || !f.text) return;
    f.text().then(function (txt) {
      var s = sanitizeSvg(txt); if (!s) return toast("El SVG es muy grande o no es válido: quedó como imagen");
      c.svg = s; delete c.svgMap; c.ar = r1(sizeSvg(s).ar); c.bg = bgOf(c);
      veStage(); if (objSel() === c) veInsp();
      toast("SVG en M como capa vectorial: recolorea en el inspector");
    }, function () {});
  }
  /* separar un SVG en capas: una por cada parte de primer nivel, alineadas (mismo tamaño y lugar) */
  var DRAWABLE = /^(path|g|circle|rect|polygon|polyline|ellipse|line|text|use|image)$/i;
  function svgParts(svg) {
    try {
      var doc = new DOMParser().parseFromString(svg, "image/svg+xml"), root = doc.documentElement;
      if (!root || root.nodeName.toLowerCase() !== "svg") return [];
      var kids = [].filter.call(root.children, function (n) { return DRAWABLE.test(n.nodeName); });
      if (kids.length === 1 && /^g$/i.test(kids[0].nodeName) && kids[0].children.length > 1 && !kids[0].getAttribute("transform")) {
        /* un solo grupo envolvente: se separan sus hijos, conservando los atributos del grupo */
        var g = kids[0]; [].slice.call(g.attributes).forEach(function (at) { if (!root.hasAttribute(at.name) && at.name !== "id") root.setAttribute(at.name, at.value); });
        [].slice.call(g.children).forEach(function (ch) { root.insertBefore(ch, g); }); root.removeChild(g);
        kids = [].filter.call(root.children, function (n) { return DRAWABLE.test(n.nodeName); });
      }
      if (kids.length < 2) return [];
      var ser = new XMLSerializer();
      return kids.slice(0, 40).map(function (keep) {
        var cl2 = root.cloneNode(true), all = [].filter.call(cl2.children, function (n) { return DRAWABLE.test(n.nodeName); });
        all.forEach(function (n, i) { if (i !== kids.indexOf(keep)) cl2.removeChild(n); });
        return ser.serializeToString(cl2);
      });
    } catch (e) { return []; }
  }

  /* ── vista previa: orden por Z, data-ti/data-mi para elegir el clip correcto y el recorrido a la vista ── */
  var DRAW = null;
  /* otros módulos (edición 3D en el lienzo) no deben tomar los clics mientras se dibuja un recorrido */
  window.__veDrawing = function () { return !!DRAW; };
  function pathOverlay(p) {
    var o = DRAW ? DRAW.o : objSel(); if (!o) return "";
    var pts = DRAW ? DRAW.pts : (o.path && o.path.pts); if (!pts || !pts.length) return "";
    var W = W0(), H = H0(), bx = W * o.x / 100, by = H * o.y / 100;
    var line = pts.length > 1 ? pathTable(pts).pts.map(function (q) { return r1(bx + q[0]) + "," + r1(by + q[1]); }).join(" ") : "";
    return '<svg class="ve-pathov" viewBox="0 0 ' + W + " " + H + '" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:5">'
      + (line ? '<polyline points="' + line + '" fill="none" stroke="#ff5e00" stroke-width="5" stroke-dasharray="18 12"/>' : "")
      + pts.map(function (q, i) { return '<circle cx="' + r1(bx + q[0]) + '" cy="' + r1(by + q[1]) + '" r="' + (i ? 12 : 16) + '" fill="' + (i ? "#fff" : "#ff5e00") + '" stroke="#ff5e00" stroke-width="5"/>'; }).join("") + "</svg>";
  }
  var _stageHTML = stageHTML;
  stageHTML = function (p, t, selLi) {
    var base = _stageHTML(Object.assign({}, p, { m: [], t: [] }), t, selLi);
    var body = order(p, t).map(function (q) { return q.k === "m" ? mediaHTML(q.c, t) : capHTML(q.c, t); }).join("") + (VE.open && VE.p === p ? pathOverlay(p) + orbOverlay(t) : "");
    return base.replace(/<\/div>\s*$/, body + "</div>");
  };
  function stagePt(e) {
    var st = vq("#veStageW .ve-stage"); if (!st) return null;
    var r = st.getBoundingClientRect(); if (!r.width) return null;
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return null;
    return { x: (e.clientX - r.left) / r.width * W0(), y: (e.clientY - r.top) / r.height * H0() };
  }
  ["pointerdown", "mousedown", "click"].forEach(function (ev) {
    vq("#veStageW").addEventListener(ev, function (e) {
      if (DRAW) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (ev !== "pointerdown") return;
        var q = stagePt(e); if (!q) return;
        var o = DRAW.o; DRAW.pts.push([r1(q.x - W0() * o.x / 100), r1(q.y - H0() * o.y / 100)]);
        veStage(); veInsp(); return;
      }
      if (ev !== "pointerdown") return;
      /* con el orden por Z el DOM ya no sigue la lista: se elige por índice real (y la media también se elige) */
      var cap = e.target.closest && e.target.closest("[data-ti]"), med = !cap && e.target.closest && e.target.closest("[data-mi]");
      if (cap && +cap.dataset.ti >= 0) { e.stopImmediatePropagation(); veSelect({ tr: "t", i: +cap.dataset.ti }); }
      else if (med && +med.dataset.mi >= 0 && (VE.p.m[+med.dataset.mi] || {}).w < 95) { e.stopImmediatePropagation(); veSelect({ tr: "m", i: +med.dataset.mi }); }
    }, true);
  });
  window.addEventListener("keydown", function (e) {
    if (!DRAW || !VE.open) return;
    if (e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); endDraw(true); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); endDraw(false); }
    else if (e.key === "Backspace" && !(e.target.closest && e.target.closest("input,textarea"))) { e.preventDefault(); e.stopImmediatePropagation(); DRAW.pts.pop(); veStage(); veInsp(); }
  }, true);
  function endDraw(keep) {
    var d = DRAW; DRAW = null; if (!d) return;
    if (keep && d.pts.length >= 2) {
      vsnap();
      d.o.path = { pts: d.pts, from: d.o.path ? d.o.path.from || 0 : 0, len: d.o.path && d.o.path.len ? d.o.path.len : r1(d.o.dur), e: d.o.path ? d.o.path.e || "smooth" : "smooth" };
      toast("Recorrido listo: " + d.pts.length + " puntos");
    } else if (keep) toast("Pon al menos 2 puntos");
    veAll(); veInsp();
  }

  /* ── inspector: secciones nuevas ── */
  vq("#veInsp").addEventListener("change", function (e) {
    var sl = e.target.closest && e.target.closest("[data-repimg]"); if (!sl || !sl.value) return;
    var o = objSel(); if (!o) return;
    vsnap();
    var fit = (String(o.bg || "").match(/center\/(\w+)/) || [])[1] || "contain";
    o.bg = "url('" + sl.value + "') center/" + fit + " no-repeat"; delete o.svg; delete o.svgMap; delete o.icon; delete o.iconColor;
    o.name = sl.options[sl.selectedIndex].text.replace(/\.[^.]+$/, "");
    var im = new Image(); im.onload = function () { if (im.naturalWidth && im.naturalHeight) { o.ar = r1(im.naturalWidth / im.naturalHeight); veStage(); } }; im.src = sl.value;
    veAll(); veInsp(); toast("Imagen cambiada: conserva posición, órbita y tiempos");
  });
  function grpOf(o) { if (!o || !o.grp) return []; var r = []; ["m", "t"].forEach(function (k) { (VE.p[k] || []).forEach(function (c) { if (c.grp === o.grp) r.push(c); }); }); return r; }
  /* QA Instinct B13: el anillo tomaba los clips visibles en el playhead (variaba según dónde estuviera). Ahora toma
     los de Media que están en pantalla cuando empieza este clip, sin importar el playhead. */
  function visibleM(o) { var t0 = o.start + 0.02; return (VE.p.m || []).filter(function (c) { return c !== o && t0 >= c.start && t0 < c.start + c.dur && (c.w || 40) < 90 && !c.vshape; }); }
  /* sin grupo, «Apilarse» y «Agrupar» toman los clips de Media que empiezan junto con este (no el logo ni el fondo) */
  function peers(o) { return (VE.p.m || []).filter(function (c) { return c !== o && !c.orb && Math.abs(c.start - o.start) < 0.1 && (c.w || 40) < 90; }); }
  function clipLabel(k, c) { return (k === "t" ? "Texto · " : "Media · ") + String(c.text || c.name || "clip").replace(/\s+/g, " ").slice(0, 28) + " (" + fmtT(c.start) + ")"; }
  /* etiquetas largas: el campo ocupa toda la fila (si no, la etiqueta no se encoge y deja el número en 0 px) */
  function numM(k, l, v, st) { var h = numF(k, l, v, st); return l.length > 12 ? h.replace('class="ef"', 'class="ef full"') : h; }
  function motionSecs(o, tr) {
    var h = "";
    if (o.anim === "stack") h += sec("Apilarse", selF("st.stDir", "Cae desde", String(+o.stDir || 0), [["0", "Arriba"], ["315", "Arriba a la izquierda"], ["45", "Arriba a la derecha"], ["270", "Izquierda"], ["90", "Derecha"], ["180", "Abajo"]])
      + numM("st.stB", "Rebote (%)", o.stB != null ? o.stB : 40) + numM("st.stD", "Duración (s)", +o.stD > 0 ? o.stD : 0.9, 0.05) + numM("st.stR", "Giro final°", +o.stR || 0));
    var ringN = o.orb && o.grp ? grpOf(o).filter(function (c) { return c.orb; }).length : 0;
    var zi = +o.zi || 0;
    h += sec("Orden: delante / detrás · capa " + zi, '<div class="ed-note" style="grid-column:1/-1">Qué se ve encima, entre todas las pistas. Capa más alta = más adelante. Con la misma capa, los textos van delante de la media. Ej.: el arco detrás de los textos pero sobre el fondo.</div>'
      + '<div class="ed-row" style="grid-column:1/-1;flex-wrap:wrap"><button data-pmo="zfront">Al frente</button><button data-pmo="zfwd">Adelante</button><button data-pmo="zback">Atrás</button><button data-pmo="zbottom">Al fondo</button>' + (zi ? '<button data-pmo="zreset">Normal</button>' : "") + "</div>", !!zi);
    if (o.orb) h += sec("Órbita · fase " + r1(+o.orb.ph || 0) + "°" + (ringN > 1 ? " · anillo de " + ringN : ""), (ringN > 1 ? '<div class="ed-note" style="grid-column:1/-1">Radio, vueltas, inclinación, profundidad y tiempos se cambian en <b>todo el anillo</b> (' + ringN + ' clips). La fase es de cada uno.</div>'
        + numM("orb.cw", "Ancho de cada clip del anillo", r1(o.w || 40), 0.5) + numM("orb.spread", "Repartir fases parejas (desde °)", 0, 5) : "")
      + '<div id="veOrbPv" style="grid-column:1/-1">' + ringPv(o) + "</div>"
      + numM("orb.r", "Radio (px)", o.orb.r) + numM("orb.ph", "Fase°", +o.orb.ph || 0, 5)
      + (ringN > 1 ? numM("orb.n", "Cantidad de clips en el anillo", ringN, 1) : "")
      + numM("orb.turns", "Vueltas", +o.orb.turns || 0, 0.25) + numM("orb.rot", "Girar todo el anillo°", +o.orb.rot || 0, 5)
      /* QA Instinct B17: «Inclinación 0–1» no se entendía; es la forma del óvalo, con vista previa arriba */
      + numM("orb.tilt", "Óvalo: alto ÷ ancho (0 = línea, 1 = círculo)", o.orb.tilt != null ? o.orb.tilt : 0.35, 0.05)
      + numM("orb.depth", "Fuerza de profundidad (0 = plano, 1 = fuerte)", o.orb.depth != null ? o.orb.depth : 1, 0.05)
      + numM("orb.sv", "Variedad de tamaños %", +o.orb.sv || 0, 5)
      + numM("orb.end", "Radio final %", o.orb.end != null ? o.orb.end : 100) + numM("orb.from", "Desde (s)", +o.orb.from || 0, 0.1) + numM("orb.len", "Duración (s, 0 = todo el clip)", +o.orb.len || 0, 0.1)
      + '<div class="ed-mh" style="grid-column:1/-1;margin-top:6px">Ráfaga de cámara</div><div class="ed-note" style="grid-column:1/-1">El anillo arranca gigante, con cada ícono inclinado, y se cierra hasta su tamaño. Tamaño inicial 0 = sin ráfaga.</div>'
      + numM("orb.bs", "Tamaño inicial × (0 = sin ráfaga)", +o.orb.bs || 0, 0.25) + numM("orb.bd", "Se cierra en (s)", +o.orb.bd > 0 ? o.orb.bd : 0.7, 0.05)
      + numM("orb.bt", "Rotación máx. de cada ícono°", o.orb.bt != null ? o.orb.bt : 28, 1) + numM("orb.btl", "Óvalo inicial (0–1)", o.orb.btl != null ? o.orb.btl : 0.15, 0.05)
      + numM("orb.bdist", "Distancia inicial × (vacío = igual al tamaño)", o.orb.bdist != null && o.orb.bdist !== "" ? o.orb.bdist : (+o.orb.bs || 1), 0.05)
      + numM("orb.bvis", "Clips visibles en la ráfaga (0 = todos)", +o.orb.bvis || 0, 1) + numM("orb.bmb", "Desenfoque de movimiento (px)", +o.orb.bmb || 0, 1)
      + '<label class="ef full" style="gap:8px"><input type="checkbox" data-orbov="1"' + (orbOvOn() ? " checked" : "") + ' style="flex:none;width:16px;height:16px"><span>Ver la guía del óvalo en el video (no sale en el video exportado)</span></label>'
      + '<div class="ed-mh" style="grid-column:1/-1;margin-top:6px">Salida del anillo</div><div class="ed-note" style="grid-column:1/-1">En ese instante los clips se van hacia afuera y se desvanecen; puedes dejar algunos sueltos. 0 = sin salida.</div>'
      + numM("orb.xs", "Salida: empieza en (s del clip)", +o.orb.xs || 0, 0.05) + numM("orb.xd", "Dura (s)", +o.orb.xd > 0 ? o.orb.xd : 0.4, 0.05)
      + numM("orb.xk", "Quedan sueltos (cantidad)", +o.orb.xk || 0, 1) + numM("orb.xm", "Se alejan ×", +o.orb.xm > 0 ? o.orb.xm : 3, 0.25)
      + '<div class="ed-row"><button data-pmo="burst">' + (+o.orb.bs > 1 ? "Quitar la ráfaga" : "Ráfaga de íconos gigantes → anillo") + '</button><button data-pmo="orbdel">Quitar órbita</button></div>');
    var g = grpOf(o);
    var rvN = tr === "m" || tr === "t" ? visibleM(o).length : 0;
    h += sec("Anillo", '<div class="ed-note" style="grid-column:1/-1">' + (rvN ? "<b>Con tus clips:</b> pone en anillo, alrededor de este, los " + rvN + " clips de Media que están en pantalla cuando empieza este (" + fmtT(o.start) + "). <b>Con copias:</b> repite este mismo clip." : "Copias de este clip en anillo alrededor de su posición, cada una con su fase.") + " Después el anillo se edita entero desde la sección Órbita.</div>"
      + numM("rep.n", "Cantidad", 12) + numM("rep.r", "Radio (px)", 300, 10) + '<label class="ef full"><span>Desfase por copia°</span><input type="number" step="1" data-pk="rep.ph" placeholder="auto (360 ÷ cantidad)"></label>'
      + numM("rep.tilt", "Inclinación (0–1)", 0.35, 0.05) + selF("rep.orbit", "Orbitar", "1", [["1", "Sí"], ["0", "No, anillo quieto"]]) + numM("rep.turns", "Vueltas", 1, 0.25)
      + selF("rep.depth", "Delante/detrás (Z)", "1", [["1", "Sí, con profundidad"], ["0", "No, plano"]], true)
      + (rvN ? '<div class="ed-row"><button data-pmo="ringvis">Poner en anillo mis ' + rvN + " clips de Media</button></div>" : "")
      + '<div class="ed-row"><button data-pmo="ring">Hacer copias de este clip en anillo</button></div>'
      + ringImgsH(), false);
    var mk = markedM(o, tr);
    h += sec("Grupo y pila" + (g.length ? " · " + g.length + " clips" : ""), '<div class="ed-note" style="grid-column:1/-1">' + (g.length ? "Este clip está en un grupo de " + g.length + "." : "Sin grupo: «Apilarse» usa este clip y los de Media que empiezan junto con él (" + (peers(o).length + (tr === "m" ? 1 : 0)) + ").") + " Con física, caen, chocan entre ellos y quedan uno sobre otro. Para incluir cualquier clip (por ejemplo la C), márcalo en «Editar varios a la vez».</div>"
      + selF("pile.who", "Qué se apila", mk.length > 1 ? "marked" : "grp", [["grp", g.length ? "Su grupo (" + g.length + ")" : "Este y los que empiezan junto con él"], ["marked", "Los marcados en «Editar varios» (" + mk.length + ")"]], true)
      + selF("pile.phys", "Movimiento", "phys", [["phys", "Con física: chocan y se apoyan unos en otros"], ["simple", "Simple: cada uno cae a su lugar"]], true)
      + numM("pile.tilt", "Inclinación por clip (± grados)", 12, 1)
      + selF("pile.corner", "Dónde se apilan", "bl", [["bl", "Abajo a la izquierda"], ["bc", "Abajo al centro"], ["br", "Abajo a la derecha"], ["c", "Al centro"]], true)
      + numM("pile.from", "Inicio de la caída (s)", r1(VE.t), 0.05)
      + '<label class="ef full"><span>Duración de la caída (s) · vacío = natural (~0,8 s)</span><input type="number" step="0.05" data-pk="pile.fall" placeholder="ej. 0.3"></label>'
      + numM("pile.spread", "Esparcimiento horizontal % (0 = en la esquina)", 30, 5) + numM("pile.stagger", "Stagger (s entre clips)", 0.12, 0.01) + numM("pile.b", "Rebote (%)", 45)
      /* QA Instinct B31: la pila termina cuando digas (antes los clips se estiraban hasta su fin original) */
      + (o._pk ? '<div class="ed-note" style="grid-column:1/-1">Sin física, el clip queda quieto en su lugar de la pila y lo mueves con tus keyframes.</div><div class="ed-row" style="flex-wrap:wrap"><button data-pmo="unphys1">Quitar la física de este clip</button><button data-pmo="unphys">De toda la pila</button></div>' : "")
      + '<label class="ef full"><span>Salida (s) · vacío = cuando se asienta</span><input type="number" step="0.05" data-pk="pile.end" placeholder="ej. 3.93"></label>'
      + '<label class="ef full"><span>Ancho de la pila (% del video) · vacío = automático</span><input type="number" step="1" data-pk="pile.bw" placeholder="automático"></label>'
      + selF("pile.order", "Orden de caída", "big", [["big", "El más grande cae al final (queda encima)"], ["list", "Como en la lista"]], true)
      + selF("pile.dir", "Caída", "mix", [["mix", "Variada (cada uno distinto)"], ["0", "Desde arriba"], ["270", "Desde la izquierda"], ["90", "Desde la derecha"], ["180", "Desde abajo"]])
      + '<div class="ed-row"><button data-pmo="pile">Apilarse</button></div>'
      + (g.length ? '<div class="ed-row"><button data-pmo="grpnext">Siguiente del grupo ▶</button><button data-pmo="ungroup">Desagrupar</button></div>' : '<div class="ed-row"><button data-pmo="group">Agrupar con los ' + peers(o).length + ' de Media que empiezan junto con este</button></div>'), !!g.length || o.anim === "stack");
    h += sec("Duración de la entrada", numM("enD", "Segundos de la entrada (0,1 = casi un corte)", +o.enD > 0 ? o.enD : 0.5, 0.05) + '<div class="ed-note" style="grid-column:1/-1">Cuánto tarda la Entrada (Fundido, Pop…). «Ninguna» es un corte directo.</div>', !!o.enD);
    if (o.svg || o.vshape) {
      var vb = "";
      if (o.vshape) vb = colF("vs.col", "Color", o.vshape.col || "#ffffff") + numM("vs.sw", "Grosor", o.vshape.sw || 6, 0.5) + (o.vshape.kind === "arc" ? numM("vs.sweep", "Apertura°", o.vshape.sweep || 180, 5) : "");
      else {
        var cols = svgColors(o.svg), map = o.svgMap || {};
        vb = cols.map(function (c, i) { return colF("svgc." + i, "Color " + (i + 1), toHex(map[c] || c)); }).join("") + colF("svgall", "Todo de un color", toHex(map[cols[0]] || cols[0]))
          + '<div class="ed-row">' + (o.svgMap ? '<button data-pmo="svgreset">Colores originales</button>' : "") + (svgParts(o.svg).length ? '<button data-pmo="svgsplit">Separar en capas (' + svgParts(o.svg).length + ")</button>" : "") + "</div>";
      }
      h += sec(o.vshape ? "Forma vectorial" : "Vector (SVG)", '<div class="ed-note" style="grid-column:1/-1">Vectorial: nítido a cualquier escala en el video exportado.</div>' + vb
        + (o.svg ? '<div class="ed-row"><button data-pmo="svgsave">Guardar este vector en «Tus imágenes» (para reusarlo)</button></div>' : ""));
    }
    var imgs = uniqImgs(RB().assets || []).slice(0, 80);
    if (tr === "m" && /url\(/.test(o.bg || "") && !o.vshape && !o.svg && !/^url\(['"]?data:image\/svg/.test(o.bg || "")) h += sec("Pasar a vector", '<div class="ed-note" style="grid-column:1/-1">Convierte esta imagen (PNG o JPG) en un vector nativo: nítido a cualquier escala y con sus colores editables. Ideal para logos e íconos.</div>'
      + selF("vz.mode", "Modo", "trace", [["trace", "Normal: a color con curvas"], ["color_layers", "Por color: una forma por región"]], true)
      + numM("vz.n", "Colores", 6, 1) + selF("vz.bg", "Fondo blanco", "1", [["1", "Quitarlo"], ["0", "Dejarlo"]])
      + '<div class="ed-row"><button data-pmo="vec">Vectorizar esta imagen</button></div>', false);
    if (tr === "m" && o.svg && o._raster) h += sec("Vector", '<div class="ed-row"><button data-pmo="vecundo">Volver a la imagen original</button></div>', false);
    if (tr === "m" && /url\(/.test(o.bg || "") && !o.vshape) h += sec("Imagen", (imgs.length ? '<label class="ef full"><span>Cambiar por una de tus imágenes</span><select data-repimg="1"><option value="">Elegir…</option>' + imgs.map(function (a) { return '<option value="' + esc(a.url) + '">' + esc(a.name || "Imagen") + "</option>"; }).join("") + "</select></label>" : "") + '<label class="ed-btn" style="width:100%;position:relative;display:flex;align-items:center;justify-content:center;cursor:pointer;grid-column:1/-1">Cambiar imagen (conserva la animación)<input type="file" data-prorep="1" accept="image/*" aria-label="Cambiar imagen" style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%"></label>', false);
    var drawing = DRAW && DRAW.o === o;
    h += sec("Recorrido dibujado" + (o.path ? " · " + o.path.pts.length + " puntos" : ""), drawing
      ? '<div class="ed-note" style="grid-column:1/-1"><b style="color:#ff5e00">Dibujando:</b> haz clic en el video para poner puntos (' + DRAW.pts.length + '). Enter termina, Retroceso quita el último, Esc cancela.</div><div class="ed-row"><button data-pmo="drawok">Terminar</button><button data-pmo="drawundo">Quitar último</button><button data-pmo="drawno">Cancelar</button></div>'
      : (o.path ? numM("pa.from", "Desde (s)", +o.path.from || 0, 0.1) + numM("pa.len", "Duración (s)", +o.path.len || r1(o.dur), 0.1) + selF("pa.e", "Velocidad", o.path.e || "smooth", EASES.slice(1).concat([["kf", "Con keyframes («Avance %»)"]]), true)
        + '<div class="ed-note" style="grid-column:1/-1">Los puntos son relativos a la posición del clip. Con «Con keyframes», el campo «Avance en el recorrido %» de cada keyframe dice dónde va en cada instante.</div>'
        + '<div class="ed-row"><button data-pmo="draw">Redibujar</button><button data-pmo="pathdel">Quitar recorrido</button></div>'
        : '<div class="ed-note" style="grid-column:1/-1">Dibuja cualquier camino con clics sobre el video y el clip lo sigue (curva suave entre puntos).</div><div class="ed-row"><button data-pmo="draw">Dibujar recorrido en el video</button></div>'), !!o.path || drawing);
    var others = [];
    ["t", "m"].forEach(function (k) { (VE.p[k] || []).forEach(function (c) { if (c !== o) others.push([c.id, clipLabel(k, c)]); }); });
    h += sec("Morph hacia otro clip", selF("morphClip", "Se transforma en", o.morphClip || "", [["", "Ninguno"]].concat(others), true)
      + (o.morphClip ? numM("mc.at", "Empieza en (s del clip)", o.morphAt != null ? o.morphAt : (function () { var B = clipById(o.morphClip); return B ? r1(Math.max(0, B.c.start - o.start)) : 0; })(), 0.05) + numM("mc.d", "Duración (s)", o.morphD != null ? o.morphD : 0.5, 0.05)
        + '<div class="ed-note" style="grid-column:1/-1">Este clip viaja y se escala hacia el otro mientras se desenfoca; el otro nace en su lugar y tamaño. Sirve texto → imagen, imagen → texto o entre grupos.</div>' : ""), !!o.morphClip);
    /* QA Instinct T11: dos transformaciones a la vez en un texto («Comfy» → la C y «now in ChatGPT» se corre) */
    var nW = tr === "t" ? (String(o.text || "").match(/\S+/g) || []).length : 0;
    if (tr === "t" && nW > 1 && !/\n/.test(o.text || "")) h += sec("Morph doble (dos transformaciones a la vez)", '<div class="ed-note" style="grid-column:1/-1">Parte este texto en dos clips que se ven exactamente igual, y cada parte se transforma en otro clip al mismo tiempo. Ej.: «Comfy» → la C y «now in ChatGPT» → el texto que se corre.</div>'
      + numM("m2.n", "Palabras de la primera parte", 1, 1)
      + selF("m2.a", "La primera parte se transforma en", "", [["", "Elegir…"]].concat(others), true)
      + selF("m2.b", "El resto se transforma en", "", [["", "Elegir…"]].concat(others), true)
      + numM("m2.at", "Empieza en (s del clip)", o.morphAt != null ? o.morphAt : r1(Math.max(0, o.dur - 0.5)), 0.05) + numM("m2.d", "Duración (s)", o.morphD != null ? o.morphD : 0.5, 0.05)
      + '<div class="ed-row"><button data-pmo="morph2">Partir y hacer el morph doble</button></div>', false);
    return h + batchSec(o, tr);
  }
  /* ── QA Instinct T1/T13/B18: editar varios clips a la vez (Inicio, duración, ancho, posición, opacidad, entrada…) ── */
  function multiOf(o, tr) {
    var M = VE._multi;
    /* QA Instinct B38/B40: antes, elegir un clip no marcado reiniciaba las marcas a «solo este» y el clip elegido no se
       podía desmarcar; «Apilarse · Los marcados» lo incluía siempre. Ahora las marcas se conservan y son solo las tuyas. */
    if (!M || M.tr !== tr) { M = VE._multi = { tr: tr, ids: {} }; M.ids[o.id] = 1; }
    return M;
  }
  function batchSec(o, tr) {
    var M = multiOf(o, tr), arr = VE.p[tr] || [], n = arr.filter(function (c) { return M.ids[c.id]; }).length;
    var inp = function (k, l, ph) { return '<label class="ef' + (l.length > 12 ? " full" : "") + '"><span>' + l + '</span><input data-bk="' + k + '" inputmode="decimal" placeholder="' + (ph || "igual") + '" aria-label="' + l + ' (vacío = no cambia)"></label>'; };
    var ents = (tr === "t" ? CAPANIM : ENTRY).map(function (x) { return '<option value="' + x[0] + '">' + x[1] + "</option>"; }).join("");
    return sec("Editar varios a la vez · " + n + " marcado" + (n === 1 ? "" : "s"), '<div class="ed-note" style="grid-column:1/-1">Marca los clips de ' + (tr === "t" ? "Texto" : "Media") + ' y escribe solo lo que quieras cambiar: lo vacío no se toca.</div>'
      + '<div class="ed-row" style="grid-column:1/-1;flex-wrap:wrap"><button data-bm="same">Los que empiezan junto con este</button><button data-bm="grp">Su grupo/anillo</button><button data-bm="all">Todos</button><button data-bm="none">Solo este</button></div>'
      + '<div role="group" aria-label="Clips marcados" style="grid-column:1/-1;max-height:170px;overflow:auto;border:1px solid #2a2a2a;border-radius:6px;padding:4px 6px">'
      + arr.map(function (c) { return '<label style="display:flex;gap:6px;align-items:center;font-size:11.5px;padding:2px 0;cursor:pointer"><input type="checkbox" data-bsel="' + esc(c.id) + '"' + (M.ids[c.id] ? " checked" : "") + ">" + esc(clipLabel(tr, c)) + clipTag(c, arr) + (c === o ? " · <b>elegido</b>" : "") + "</label>"; }).join("") + "</div>"
      + inp("start", "Inicio (s)") + inp("shift", "Mover (± s)", "0") + inp("dur", "Duración (s)")
      + (tr === "m" ? inp("w", "Ancho %") + inp("op", "Opacidad (0–1)") + inp("or", "Radio del anillo (px)") + inp("otl", "Inclinación / óvalo (0–1)") + inp("oph", "Fase inicial° (reparte parejo)") : inp("size", "Tamaño") + '<label class="ef"><span>Color</span><input data-bk="color" placeholder="#242227" aria-label="Color (vacío = no cambia)"></label>')
      + inp("x", "X %") + inp("y", "Y %") + inp("mb", "Desenfoque de movimiento %")
      + '<label class="ef full"><span>Entrada</span><select data-bk="anim"><option value="">Igual</option>' + ents + "</select></label>"
      + '<div class="ed-row"><button data-bm="apply">Aplicar a los ' + n + " marcados</button></div>", n > 1);
  }
  vq("#veInsp").addEventListener("change", function (e) {
    var cb = e.target.closest && e.target.closest("[data-bsel]"); if (!cb) return;
    var o = objSel(); if (!o) return; var M = multiOf(o, VE.sel.tr);
    if (cb.checked) M.ids[cb.dataset.bsel] = 1; else delete M.ids[cb.dataset.bsel];
    var n = Object.keys(M.ids).length, ap = vq('#veInsp [data-bm="apply"]'); if (ap) ap.textContent = "Aplicar a los " + n + " marcados";
  });
  vq("#veInsp").addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-bm]"); if (!b) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var o = objSel(); if (!o) return; var tr = VE.sel.tr, arr = VE.p[tr], M = multiOf(o, tr), a = b.dataset.bm;
    if (a !== "apply") {
      M.ids = {}; M.ids[o.id] = 1;
      var ring = a === "grp" ? ringSet(o) : null;
      arr.forEach(function (c) { if (a === "all" || (a === "same" && Math.abs(c.start - o.start) < 0.05) || (ring && ring.indexOf(c) >= 0)) M.ids[c.id] = 1; });
      if (a === "grp" && Object.keys(M.ids).length < 2) toast("Este clip no está en un grupo ni en un anillo");
      return veInsp();
    }
    var val = function (k) { var el = vq('#veInsp [data-bk="' + k + '"]'); var v = el ? String(el.value).trim().replace(",", ".") : ""; return v; };
    var num = function (k) { var v = val(k); if (v === "") return null; var x = parseFloat(v); return isFinite(x) ? x : null; };
    var ch = { start: num("start"), shift: num("shift"), dur: num("dur"), w: num("w"), op: num("op"), size: num("size"), x: num("x"), y: num("y"), color: val("color"), anim: val("anim"), or: num("or"), otl: num("otl"), oph: num("oph"), mb: num("mb") };
    if (Object.keys(ch).every(function (k) { return ch[k] == null || ch[k] === ""; })) return toast("Escribe al menos un valor para cambiar");
    if (ch.color && !/^#[0-9a-f]{3,8}$/i.test(ch.color)) return toast("Color: usa un código como #242227");
    var list = arr.filter(function (c) { return M.ids[c.id]; });
    if (!list.length) return toast("No hay clips marcados");
    vsnap();
    list.forEach(function (c) {
      if (ch.start != null) c.start = r1(Math.max(0, ch.start));
      if (ch.shift) c.start = r1(Math.max(0, c.start + ch.shift));
      if (ch.dur != null) c.dur = Math.max(0.1, ch.dur);
      if (ch.w != null) c.w = Math.max(0.5, ch.w);
      if (ch.op != null) c.opacity = cl(ch.op, 0, 1);
      if (ch.size != null) c.size = Math.max(4, ch.size);
      if (ch.x != null) c.x = ch.x; if (ch.y != null) c.y = ch.y;
      if (ch.color) c.color = ch.color;
      if (ch.anim) c.anim = ch.anim;
      if (ch.mb != null) { if (ch.mb > 0) c.mbA = cl(ch.mb, 0, 200); else delete c.mbA; }
      /* QA Instinct T13: radio, óvalo y fase del anillo también en lote (a los marcados que tienen órbita) */
      if (c.orb && ch.or != null) c.orb.r = Math.max(0, ch.or);
      if (c.orb && ch.otl != null) c.orb.tilt = cl(ch.otl, 0, 1);
    });
    if (ch.oph != null) { var orbs = list.filter(function (c) { return c.orb; }); orbs.forEach(function (c, i) { c.orb.ph = r1(ch.oph + i * 360 / orbs.length); }); }
    veAll(); veInsp(); toast("Cambios aplicados a " + list.length + " clip" + (list.length === 1 ? "" : "s"));
  }, true);
  /* «Apilarse» en el menú de entradas de textos y media */
  [CAPANIM, ENTRY].forEach(function (L) { if (!L.some(function (x) { return x[0] === "stack"; })) L.splice(Math.max(0, L.length - 1), 0, ["stack", "Apilarse (cae y rebota)"]); });

  /* valores de los campos del inspector */
  vq("#veInsp").addEventListener("input", function (e) {
    var k = e.target.dataset && e.target.dataset.pk; if (!k) return;
    var o = objSel(); if (!o) return;
    var v = e.target.value, num = parseFloat(v), f;
    if (/^(rep|pile|m2|vz|pre)\./.test(k)) return;
    if (k.indexOf("ke.") === 0) {
      var lt = lt0(o), at = (o.kf || []).find(function (x) { return Math.abs(x.t - lt) < 0.02; }); if (!at) return;
      f = k.slice(3);
      if (f === "e") { if (v === "auto") delete at.e; else at.e = v; setTimeout(veInsp, 0); }
      else if (f === "bz") at.bz = v; else if (isFinite(num)) at[f] = cl(num, 0, 100);
      veStage(); veTimeline(); return;
    }
    if (k.indexOf("orb.") === 0 && o.orb) {
      f = k.slice(4); if (!isFinite(num)) return;
      /* el anillo se edita entero (QA Instinct B18/T6): todo menos la fase va a todos los del grupo */
      var ring = o.grp ? grpOf(o).filter(function (c) { return c.orb; }) : [o];
      if (f === "n") return;   /* la cantidad se aplica al soltar (change), crea o quita clips */
      if (f === "tilt" || f === "depth" || f === "btl") num = cl(num, 0, 1);
      ring.forEach(function (c) { c.orb.bn = ring.length; });
      if (f === "bdist") { ring.forEach(function (c) { c.orb.bdist = Math.max(0, num); }); veStage(); return; }
      if (f === "cw") { ring.forEach(function (c) { c.w = Math.max(0.5, num); }); veStage(); return; }
      if (f === "spread") { ring.forEach(function (c, i) { c.orb.ph = r1(num + i * 360 / ring.length); }); veStage(); return; }
      if (f === "ph") o.orb.ph = num; else ring.forEach(function (c) { c.orb[f] = num; });
      var pv = vq("#veOrbPv"); if (pv) pv.innerHTML = ringPv(o);
      veStage(); return;
    }
    if (k.indexOf("st.") === 0) { f = k.slice(3); if (isFinite(num)) o[f] = f === "stD" ? cl(num, 0.1, 10) : f === "stB" ? cl(num, 0, 100) : num; veStage(); return; }
    if (k.indexOf("vs.") === 0 && o.vshape) { f = k.slice(3); o.vshape[f] = f === "col" ? v : (isFinite(num) ? num : o.vshape[f]); o.bg = bgOf(o); veStage(); return; }
    if (k.indexOf("svgc.") === 0 && o.svg) { var col = svgColors(o.svg)[+k.slice(5)]; if (col) { o.svgMap = Object.assign({}, o.svgMap || {}); o.svgMap[col] = v; o.bg = bgOf(o); veStage(); } return; }
    if (k === "svgall" && o.svg) { o.svgMap = {}; svgColors(o.svg).forEach(function (c) { o.svgMap[c] = v; }); o.bg = bgOf(o); veStage(); [].forEach.call(vq("#veInsp").querySelectorAll('[data-pk^="svgc."]'), function (i) { i.value = v; }); return; }
    if (k.indexOf("pa.") === 0 && o.path) { f = k.slice(3); if (f === "e") { o.path.e = v; setTimeout(veInsp, 0); } else if (isFinite(num)) o.path[f] = Math.max(0, num); veStage(); return; }
    if (k === "morphClip") { if (v) { o.morphClip = v; var B = clipById(v); if (o.morphAt == null && B) o.morphAt = r1(cl(B.c.start - o.start, 0, o.dur)); if (o.morphD == null) o.morphD = 0.5; } else delete o.morphClip; setTimeout(veInsp, 0); veStage(); return; }
    if (k === "mc.at" && isFinite(num)) { o.morphAt = cl(num, 0, o.dur); veStage(); return; }
    if (k === "mc.d" && isFinite(num)) { o.morphD = cl(num, 0.05, 10); veStage(); return; }
  });
  /* el avance en el recorrido por keyframes: elegir «Con keyframes» siembra 0 % y 100 % */
  vq("#veInsp").addEventListener("change", function (e) {
    if (!e.target.dataset || e.target.dataset.pk !== "pa.e" || e.target.value !== "kf") return;
    var o = objSel(); if (!o || !o.path) return;
    o.kf = o.kf || [];
    if (!o.kf.some(function (x) { return x.p != null; })) {
      var a = +o.path.from || 0, b = Math.min(o.dur, a + (+o.path.len || o.dur));
      [[a, 0], [b, 100]].forEach(function (q) { var x = o.kf.find(function (y) { return Math.abs(y.t - q[0]) < 0.02; }); if (!x) { x = Object.assign({}, sampleK(o, q[0]), { t: r1(q[0]) }); delete x.p; o.kf.push(x); } x.p = q[1]; });
      o.kf.sort(function (x, y) { return x.t - y.t; });
      veAll(); veInsp(); toast("Keyframes de avance en " + fmtT(o.start + a) + " (0 %) y " + fmtT(o.start + b) + " (100 %)");
    }
  });
  /* cambiar la imagen de un clip sin perder su animación */
  vq("#veInsp").addEventListener("change", function (e) {
    var inp = e.target; if (!inp.dataset || !inp.dataset.prorep) return;
    var o = objSel(), f = inp.files && inp.files[0]; if (!o || !f) return;
    if (!VE.p._real) return toast("Abre un video tuyo para subir archivos");
    if (f.size > 5e6) return toast("La imagen supera 5 MB");
    toast("Subiendo " + f.name + "…");
    readData(f).then(function (d) { return upload(d, f.name); }).then(function (r) {
      vsnap();
      var fit = /contain/.test(o.bg || "") || /svg/.test(f.type) ? "contain" : "cover";
      delete o.svg; delete o.svgMap; delete o.icon;
      o.bg = "url('" + r.url + "') center/" + fit + " no-repeat"; o.name = f.name.replace(/\.[^.]+$/, "");
      if (/svg/.test(f.type) || /\.svg$/i.test(f.name)) asVector(o, f);
      else { var im = new Image(); im.onload = function () { if (im.naturalWidth && im.naturalHeight) { o.ar = r1(im.naturalWidth / im.naturalHeight); veStage(); } }; im.src = r.url; }
      veAll(); veInsp(); toast("Imagen cambiada");
    }).catch(function (x) { toast("No se pudo subir: " + (x && x.message || x)); });
  });

  /* botones de las secciones nuevas */
  function rv(n, d) { var el = vq('#veInsp [data-pk="' + n + '"]'); var x = el ? parseFloat(el.value) : NaN; return isFinite(x) ? x : d; }
  function rs(n, d) { var el = vq('#veInsp [data-pk="' + n + '"]'); return el ? el.value : d; }
  function gid() { return "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  function cloneClip(o) { var c = JSON.parse(JSON.stringify(o)); c.id = nid(); delete c._seg; delete c._mat; delete c._row; return c; }
  function ringOrb(i, n) {
    var step = rv("rep.ph", NaN); if (!isFinite(step)) step = 360 / n;
    return { r: rv("rep.r", 300), ph: r1(i * step), turns: rs("rep.orbit", "1") === "1" ? rv("rep.turns", 1) : 0, tilt: cl(rv("rep.tilt", 0.35), 0, 1), depth: rs("rep.depth", "1") === "1" ? 1 : 0, from: 0, len: 0, end: 100 };
  }
  vq("#veInsp").addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-pmo]"); if (!b) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var o = objSel(); if (!o) return;
    var a = b.dataset.pmo, s = VE.sel, p = VE.p, arr = p[s.tr];
    if (a === "ring") {
      var n = cl(Math.round(rv("rep.n", 12)), 2, 64), g = gid(), made = [];
      vsnap();
      var base = String(o.name || o.text || "Clip").replace(/ · \d+$/, "");
      for (var i = 0; i < n; i++) { var c = i ? cloneClip(o) : o; c.orb = ringOrb(i, n); c.grp = g; if (s.tr === "m") c.name = base + " · " + (i + 1); made.push(c); }
      arr.splice.apply(arr, [arr.indexOf(o) + 1, 0].concat(made.slice(1)));
      veAll(); veInsp(); return toast(n + " copias en anillo (fase " + r1(made[1] ? made[1].orb.ph : 0) + "° por copia)");
    }
    if (a === "ringvis") {
      var vis = visibleM(o); if (!vis.length) return toast("No hay otros clips de Media visibles en este instante");
      vsnap(); var g2 = gid();
      o.grp = g2;   /* el centro también es del grupo: «Su grupo/anillo» y «Apilarse» lo incluyen (QA Instinct B30) */
      vis.forEach(function (c, i) { c.x = o.x; c.y = o.y; c.orb = ringOrb(i, vis.length); c.grp = g2; c.start = o.start; if (Math.abs(c.dur - o.dur) > 0.01 && c.start + c.dur < o.start + 0.05) c.dur = o.dur; });
      veAll(); veInsp(); return toast(vis.length + " clips en anillo alrededor de «" + (o.name || o.text || "este clip") + "»");
    }
    if (a === "orbdel") { vsnap(); delete o.orb; veAll(); return veInsp(); }
    if (a === "burst" && o.orb) {
      vsnap(); var rg = o.grp ? grpOf(o).filter(function (c) { return c.orb; }) : [o], on = !(+o.orb.bs > 1);
      rg.forEach(function (c) { if (on) { c.orb.bs = 4; c.orb.bd = 0.7; c.orb.bt = 28; c.orb.btl = 0.15; } else delete c.orb.bs; });
      VE.t = o.start + (+o.orb.from || 0) + 0.1; veAll(); veInsp();
      return toast(on ? "Ráfaga: el anillo empieza 4× más grande y se cierra en 0,7 s (ajústalo en Ráfaga de cámara)" : "Ráfaga quitada");
    }
    if (a === "morph2") return morph2(o);
    if (a === "svgsave" && o.svg) {
      var nmS = String(o.name || "vector").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[^\w\- ]+/g, "").trim() || "vector";
      var dataS = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(recolor(o.svg, o.svgMap))));
      b.disabled = true;
      return upload(dataS, nmS + ".svg").then(function (r) {
        var R = RB(); R.assets = R.assets || []; R.assets.unshift({ name: nmS + ".svg", url: r.url, mime_type: "image/svg+xml" });
        b.disabled = false; veBin(); toast("Guardado en «Tus imágenes» como vector: «+» lo agrega con sus colores editables");
      }, function (x) { b.disabled = false; toast("No se pudo guardar: " + (x && x.message || x)); });
    }
    if (a === "unphys" || a === "unphys1") {
      /* QA Instinct B37: «Quitar la física» actuaba sobre todo el grupo; ahora hay «este clip» y «toda la pila» */
      vsnap(); var pm = (a === "unphys1" ? [o] : grpOf(o).length ? grpOf(o) : [o]).filter(function (c) { return c._pk; });
      pm.forEach(function (c) { var lk = c.kf && c.kf[c.kf.length - 1]; delete c.kf; delete c._pk; if (lk && lk.r) c.kf = [{ t: 0, x: 0, y: 0, z: 0, s: 1, r: lk.r, o: 1 }]; });
      veAll(); veInsp(); return toast(pm.length + " clips sin física: quedan en su lugar de la pila; muévelos con tus keyframes");
    }
    if (/^z(front|fwd|back|bottom|reset)$/.test(a)) {
      vsnap(); var all = (p.m || []).concat(p.t || []), zs = all.map(function (c) { return +c.zi || 0; }), mx = Math.max.apply(null, zs), mn = Math.min.apply(null, zs);
      o.zi = a === "zfront" ? mx + 1 : a === "zbottom" ? mn - 1 : a === "zfwd" ? (+o.zi || 0) + 1 : a === "zback" ? (+o.zi || 0) - 1 : 0;
      if (!o.zi) delete o.zi;
      veAll(); veInsp(); return toast("Capa " + (+o.zi || 0) + (a === "zfront" ? ": delante de todo" : a === "zbottom" ? ": detrás de todo" : ""));
    }
    if (a === "ringimgs") {
      var urls = Object.keys(RIMG); if (urls.length < 2) return toast("Marca 2 o más imágenes para el anillo");
      vsnap(); var g6 = gid(), ww = (o.w || 40) < 30 ? o.w : 8, made2 = []; o.grp = g6;
      urls.forEach(function (u, i) {
        var nmI = RIMG[u], c = { id: nid(), name: nmI, bg: "url('" + u + "') center/contain no-repeat", start: o.start, dur: o.dur, x: o.x, y: o.y, w: ww, ar: 1, opacity: 1, radius: 0, anim: "fade", grp: g6, orb: ringOrb(i, urls.length) };
        var im = new Image(); im.onload = function () { if (im.naturalWidth && im.naturalHeight) { c.ar = r1(im.naturalWidth / im.naturalHeight); veStage(); } }; im.src = u;
        made2.push(c);
      });
      if (s.tr === "m") p.m.splice.apply(p.m, [p.m.indexOf(o) + 1, 0].concat(made2)); else p.m.push.apply(p.m, made2); RIMG = {};
      veAll(); veInsp(); return toast(made2.length + " imágenes distintas en anillo alrededor de «" + (o.name || o.text || "este clip") + "»");
    }
    if (a === "vec") return vectorizeClip(o, b);
    if (a === "vecundo" && o._raster) { vsnap(); o.bg = o._raster; delete o.svg; delete o.svgMap; delete o._raster; veAll(); veInsp(); return toast("Volvió a la imagen original"); }
    if (a === "group") { var vm = peers(o).concat(s.tr === "m" ? [o] : []); if (vm.length < 2) return toast("Necesito 2 o más clips de Media que empiecen al mismo tiempo"); vsnap(); var g3 = gid(); vm.concat([o]).forEach(function (c) { c.grp = g3; }); veAll(); veInsp(); return toast("Grupo de " + grpOf(o).length + " clips"); }
    if (a === "ungroup") { vsnap(); grpOf(o).forEach(function (c) { delete c.grp; }); veAll(); veInsp(); return toast("Grupo deshecho"); }
    if (a === "grpnext") {
      var gm = grpOf(o), nx = gm[(gm.indexOf(o) + 1) % gm.length], tr2 = p.m.indexOf(nx) >= 0 ? "m" : "t";
      VE.sel = { tr: tr2, i: p[tr2].indexOf(nx) }; if (!(VE.t >= nx.start && VE.t < nx.start + nx.dur)) VE.t = nx.start + Math.min(0.5, nx.dur / 2);
      veAll(); return veInsp();
    }
    if (a === "pile") {
      /* un texto suelto también se apila (antes respondía «Elige un clip de Media o un grupo»): cae él con los de Media que empiezan con él */
      var mem = grpOf(o); if (!mem.length) { var pe = peers(o); mem = (p.m || []).filter(function (c) { return c === o || pe.indexOf(c) >= 0; }); if (s.tr === "t") mem.push(o); }
      /* QA Instinct T12: cualquier clip marcado (también la C, aunque empiece en otro momento) */
      if (rs("pile.who", "grp") === "marked") mem = markedM(o, s.tr);
      if (mem.length < 1) return toast("Elige un clip de Media o un grupo");
      if (rs("pile.phys", "phys") === "phys") return physPile(o, mem);
      vsnap();
      var corner = rs("pile.corner", "bl"), from = Math.max(0, rv("pile.from", VE.t)), stg = Math.max(0, rv("pile.stagger", 0.12)), bo = cl(rv("pile.b", 45), 0, 100), dir = rs("pile.dir", "mix"), pEnd = rv("pile.end", NaN);
      var W = W0(), H = H0(), nn = mem.length, sz = Math.max.apply(null, mem.map(function (c) { return W * dimOf(c).w / 100; }));
      var cap = Math.max(1, Math.ceil((Math.sqrt(8 * nn + 1) - 1) / 2)); sz = Math.min(sz, W * 0.86 / (cap * 1.02)); var row = 0, j = 0, MIX = [0, 315, 45, 270, 90, 330, 30, 300, 60];
      mem.forEach(function (c, i) {
        var inRow = Math.max(1, cap - row);
        if (j >= inRow) { row++; j = 0; inRow = Math.max(1, cap - row); }
        var rowW = (inRow - 1) * sz * 1.02, x0 = corner === "bl" ? W * 0.06 + sz / 2 + row * sz * 0.51 : corner === "br" ? W * 0.94 - sz / 2 - row * sz * 0.51 - rowW : W / 2 - rowW / 2;
        var yb = corner === "c" ? H * 0.62 : H * 0.92;
        var x = x0 + j * sz * 1.02 + ((i * 53) % 9 - 4) * sz * 0.02, y = yb - sz / 2 - row * sz * 0.9;
        c.x = r1(x / W * 100); c.y = r1(y / H * 100);
        var end = c.start + c.dur, st0 = r1(from + i * stg);
        c.start = st0; c.dur = r1(Math.max(0.5, end > st0 + 0.5 ? end - st0 : c.dur));
        if (isFinite(pEnd) && pEnd > st0) c.dur = r1(Math.max(0.1, pEnd - st0));
        c.anim = "stack"; c.stB = bo; c.stD = 0.9; c.stR = ((i * 37) % 17) - 8;
        c.stDir = dir === "mix" ? MIX[i % MIX.length] : +dir;
        j++;
      });
      if (!o.grp) { var g4 = gid(); mem.forEach(function (c) { c.grp = g4; }); }
      VE.t = from + Math.min(1.2, nn * stg + 0.9);
      veAll(); veInsp(); return toast(nn + " clips se apilan desde " + fmtT(from) + " (cada " + stg + " s)");
    }
    if (a === "svgreset") { vsnap(); delete o.svgMap; o.bg = bgOf(o); veStage(); return veInsp(); }
    if (a === "svgsplit") {
      var parts = svgParts(o.svg); if (parts.length < 2) return toast("Este SVG tiene una sola parte");
      vsnap(); var g5 = o.grp || gid(), at0 = arr.indexOf(o), nm = String(o.name || "SVG");
      var cs = parts.map(function (sv, i) { var c = i ? cloneClip(o) : o; c.svg = sv; c.grp = g5; c.name = nm + " · parte " + (i + 1); c.bg = bgOf(c); return c; });
      arr.splice.apply(arr, [at0 + 1, 0].concat(cs.slice(1)));
      veAll(); veInsp(); return toast("Separado en " + cs.length + " capas alineadas: anima cada una por su lado");
    }
    if (a === "draw") { veStop(); DRAW = { o: o, pts: [] }; veStage(); veInsp(); return toast("Haz clic en el video para poner los puntos del recorrido"); }
    if (a === "drawok") return endDraw(true);
    if (a === "drawno") return endDraw(false);
    if (a === "drawundo") { if (DRAW) DRAW.pts.pop(); veStage(); return veInsp(); }
    if (a === "pathdel") { vsnap(); delete o.path; (o.kf || []).forEach(function (x) { delete x.p; }); veAll(); return veInsp(); }
  }, true);
  /* cambiar de clip cancela el dibujo a medias */
  var _selMo = veSelect;
  veSelect = function (s) { if (DRAW && !(s && VE.p && VE.p[s.tr] && VE.p[s.tr][s.i] === DRAW.o)) DRAW = null; return _selMo.apply(this, arguments); };

  /* biblioteca: formas vectoriales */
  var _binMo = veBin;
  veBin = function () {
    var r = _binMo.apply(this, arguments), box = vq("#veBin");
    if (!box || !VE.p || VE.tab !== "texto") return r;
    box.insertAdjacentHTML("beforeend", '<div class="ve-bsec"><div class="ed-mh">Formas vectoriales — arcos, anillos, líneas (nítidas, con color y grosor)</div>'
      + VSH.map(function (x) { var u = "data:image/svg+xml;base64," + btoa(shapeSvg({ kind: x[0], col: "#ffffff", sw: 10, sweep: 200 })); return '<button class="ve-item" data-pmv="' + x[0] + '"><span class="ve-bth" style="background:#2a2a2a url(&#39;' + u + '&#39;) center/70% no-repeat"></span><span><b>' + x[1] + "</b><small>en el playhead</small></span><i>+</i></button>"; }).join("") + "</div>");
    return r;
  };
  vq("#veBin").addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-pmv]"); if (!b || !VE.p) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var k = b.dataset.pmv, p = VE.p, light = k === "arc" || k === "ring" || k === "line"; vsnap();
    var c = { id: nid(), name: (VSH.find(function (x) { return x[0] === k; }) || [0, "Forma"])[1], vshape: { kind: k, col: light ? "#ffffff" : brandColor(), sw: k === "line" ? 4 : 3, sweep: 140 },
      start: r1(Math.min(VE.t, Math.max(0, veDur(p) - 0.5))), dur: 3, x: 50, y: 50, w: k === "arc" ? 110 : 40, ar: 1, opacity: light ? 0.5 : 1, radius: 0, anim: "fade" };
    c.bg = bgOf(c);
    if (k === "arc") { p.m.unshift(c); VE.sel = { tr: "m", i: 0 }; } else { p.m.push(c); VE.sel = { tr: "m", i: p.m.length - 1 }; }
    veAll(); veInsp(); reveal(c);
    toast(c.name + " agregado en M" + (k === "arc" ? " (detrás de todo)" : ""));
  }, true);

  /* ═════ QA Instinct · réplica Comfy v4–v10: lo que faltaba ═════
     B17 óvalo con vista previa (inspector y video) y fuerza de profundidad gradual · T9 anillo como objeto (cantidad,
     giro, variedad de tamaños) y ráfaga de cámara · T12 pila con física que puede incluir cualquier clip (la C) ·
     T11 morph doble · T5/T14 pasar una imagen a vector · B4 miniaturas de video · B20 biblioteca sin repetidas ·
     B22 clic programático en clips · B26 selects que cambian sin «input» · B5 tamaño por alto de mayúscula en px */

  /* ── B17 · vista previa del óvalo: así queda el anillo, y cuánto crece delante / se achica detrás ── */
  function ringPv(o) {
    var ob = o && o.orb; if (!ob) return "";
    var t = cl(ob.tilt != null ? +ob.tilt : 0.35, 0, 1), d = ob.depth != null ? cl(+ob.depth, 0, 1) : 1, R = +ob.r || 0, P = persp();
    var zf = function (z) { z = Math.min(z, P * 0.92); return P / (P - z); };
    var fF = zf(R * d), fB = zf(-R * d), rx = 100, ry = Math.max(1, rx * t), Wv = 240, Hv = Math.round(2 * ry + 44), cx = 120, cy = Hv / 2;
    var mem = o.grp ? grpOf(o).filter(function (c) { return c.orb; }) : [o]; if (!mem.length) mem = [o];
    var dots = mem.map(function (c) {
      var a = ((+c.orb.ph || 0) + (+c.orb.rot || 0)) * Math.PI / 180, sn = Math.sin(a), f = zf(R * d * sn);
      return { sn: sn, h: '<circle cx="' + r1(cx + rx * Math.cos(a)) + '" cy="' + r1(cy + ry * sn) + '" r="' + r1(5 * f) + '" fill="' + (c === o ? "#ff5e00" : "#e8e6df") + '" stroke="#111" stroke-width="1"/>' };
    }).sort(function (x, y) { return x.sn - y.sn; }).map(function (x) { return x.h; }).join("");
    return '<svg viewBox="0 0 ' + Wv + " " + Hv + '" role="img" aria-label="Vista previa del óvalo del anillo" style="width:100%;height:auto;background:#151515;border-radius:6px;display:block">'
      + '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + r1(ry) + '" fill="none" stroke="#ff5e00" stroke-width="1.5" stroke-dasharray="5 4" opacity=".8"/>' + dots + "</svg>"
      + '<div class="ed-note" style="margin-top:4px">Óvalo ' + r1(t) + " · delante se ve ×" + r1(fF) + ", detrás ×" + r1(fB) + (d < 1 ? "" : " (baja «Fuerza de profundidad» para que no cambie tanto)") + ". En el video se marca con una línea punteada.</div>";
  }
  /* el recorrido del anillo dibujado sobre el video, con la perspectiva real */
  function orbOvOn() { try { return localStorage.getItem("musa_orbov") !== "0"; } catch (e) { return true; } }
  vq("#veInsp").addEventListener("change", function (e) { if (!e.target.dataset || !e.target.dataset.orbov) return; try { localStorage.setItem("musa_orbov", e.target.checked ? "1" : "0"); } catch (x) {} veStage(); });
  vq("#veInsp").addEventListener("click", function (e) { var b = e.target.closest && e.target.closest('[data-pmo2="proj"]'); if (!b) return; e.preventDefault(); e.stopImmediatePropagation(); veSelect(null); var w = vq("#veInsp"); if (w) w.scrollTop = 0; }, true);
  function orbOverlay(t) {
    var o = objSel(); if (!o || !o.orb || VE.playing || DRAW || !orbOvOn()) return "";
    var ob = o.orb, W = W0(), H = H0(), P = persp(), lt = t - o.start, from = +ob.from || 0, len = +ob.len > 0 ? +ob.len : Math.max(0.1, o.dur - from), u = cl((lt - from) / len, 0, 1);
    var R = (+ob.r || 0) * (1 + ((ob.end != null ? +ob.end : 100) / 100 - 1) * u), tl = ob.tilt != null ? +ob.tilt : 0.35, d = ob.depth != null ? cl(+ob.depth, 0, 1) : 1, bx = W * (+o.x || 0) / 100, by = H * (+o.y || 0) / 100, pts = [];
    for (var i = 0; i <= 72; i++) {
      var a = i * 5 * Math.PI / 180, z = Math.min(R * d * Math.sin(a), P * 0.92), f = P / (P - z);
      pts.push(r1(W / 2 + (bx + R * Math.cos(a) - W / 2) * f) + "," + r1(H / 2 + (by + R * tl * Math.sin(a) - H / 2) * f));
    }
    return '<svg class="ve-orbov" viewBox="0 0 ' + W + " " + H + '" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:5"><polyline points="' + pts.join(" ") + '" fill="none" stroke="#ff5e00" stroke-width="4" stroke-dasharray="14 10" opacity=".7"/></svg>';
  }
  /* ── T9 · «Cantidad» del anillo: suma copias o quita clips y reparte las fases parejas ── */
  vq("#veInsp").addEventListener("change", function (e) {
    if (!e.target.dataset || e.target.dataset.pk !== "orb.n") return;
    var o = objSel(); if (!o || !o.orb || !o.grp) return;
    var p = VE.p, ring = grpOf(o).filter(function (c) { return c.orb; }), want = cl(Math.round(parseFloat(e.target.value) || ring.length), 2, 64);
    if (want === ring.length) return;
    var trOf = function (c) { return p.m.indexOf(c) >= 0 ? "m" : "t"; };
    vsnap();
    if (want > ring.length) {
      var last = ring[ring.length - 1], base = String(last.name || "Clip").replace(/ · \d+$/, ""), arr = p[trOf(last)], at = arr.indexOf(last);
      for (var i = ring.length; i < want; i++) { var c = cloneClip(last); if (trOf(last) === "m") c.name = base + " · " + (i + 1); arr.splice(++at, 0, c); ring.push(c); }
    } else {
      var keep = [o].concat(ring.filter(function (c) { return c !== o; })).slice(0, want);
      ring.filter(function (c) { return keep.indexOf(c) < 0; }).forEach(function (c) { var a2 = p[trOf(c)]; a2.splice(a2.indexOf(c), 1); });
      ring = ring.filter(function (c) { return keep.indexOf(c) >= 0; });
    }
    var ph0 = +ring[0].orb.ph || 0; ring.forEach(function (c, j) { c.orb.ph = r1(ph0 + j * 360 / ring.length); });
    VE.sel = { tr: trOf(o), i: p[trOf(o)].indexOf(o) };
    veAll(); veInsp(); toast("Anillo de " + ring.length + " clips, con las fases repartidas parejas");
  });

  /* ── T12 · pila con física: caen, chocan, se apoyan unos en otros y se asientan; cualquier clip marcado ── */
  function markedM(o, tr) { var M = VE._multi; if (tr !== "m" || !M || M.tr !== "m") return []; return (VE.p.m || []).filter(function (c) { return M.ids[c.id]; }); }
  function simplifyKf(S, tol) {
    if (S.length <= 2) return S.slice();
    var out = [S[0]], a = 0;
    for (var b = 2; b < S.length; b++) {
      var A = S[a], B = S[b], bad = false;
      for (var j = a + 1; j < b && !bad; j++) { var q = (S[j].t - A.t) / ((B.t - A.t) || 1); bad = Math.abs(A.x + (B.x - A.x) * q - S[j].x) > tol || Math.abs(A.y + (B.y - A.y) * q - S[j].y) > tol || Math.abs(A.a + (B.a - A.a) * q - S[j].a) > tol; }
      if (bad) { out.push(S[b - 1]); a = b - 1; }
    }
    out.push(S[S.length - 1]);
    return out;
  }
  /* tamaño de un clip en el lienzo (% del ancho y proporción): la media lo trae; un texto se mide como se ve */
  function dimOf(c) {
    if (+c.w > 0) return { w: +c.w, ar: +c.ar || 1 };
    var i = (VE.p.t || []).indexOf(c), n = i >= 0 ? vq('#veStageW [data-ti="' + i + '"]') : null, st = vq("#veStageW .ve-stage");
    if (n && st) { var a = n.getBoundingClientRect(), b = st.getBoundingClientRect(); if (a.width > 2 && b.width > 2) return { w: a.width / b.width * 100, ar: a.width / Math.max(1, a.height) }; }
    var lines = String(c.text || "").split(String.fromCharCode(10)), len = Math.max.apply(null, lines.map(function (l) { return l.length; })) || 1, fs = +c.size || 64;
    return { w: Math.min(96, len * fs * 0.56 / W0() * 100), ar: Math.max(0.3, len * 0.56 / (lines.length * 1.2)) };
  }
  function physPile(o, mem) {
    var p = VE.p, W = W0(), H = H0();
    var corner = rs("pile.corner", "bl"), from = Math.max(0, rv("pile.from", VE.t)), stg = Math.max(0, rv("pile.stagger", 0.12)), bo = cl(rv("pile.b", 45), 0, 100) / 100;
    var dir = rs("pile.dir", "mix"), tiltR = cl(rv("pile.tilt", 12), 0, 60), MIX = [0, 315, 45, 270, 90, 330, 30, 300, 60];
    vsnap();
    var hadKf = 0, n = mem.length, pEnd = rv("pile.end", NaN), bwPct = rv("pile.bw", NaN);
    /* el más grande (la C) cae al final y queda encima de la pila, como en el reel */
    if (rs("pile.order", "big") === "big") mem = mem.map(function (c, i) { return [c, i]; }).sort(function (a, b) { return dimOf(a[0]).w - dimOf(b[0]).w || a[1] - b[1]; }).map(function (x) { return x[0]; });
    var B = mem.map(function (c, i) {
      var dm = dimOf(c), w = W * dm.w / 100, h = w / dm.ar;
      if (c.kf && c.kf.length && !c._pk) hadKf++;
      return { c: c, r: Math.max(6, Math.sqrt(w * h) / 2), t0: r1(from + i * stg), on: false, inBin: false, x: 0, y: 0, vx: 0, vy: 0, a: 0, va: 0, S: [], still: 0, done: false, tilt: (hash01(c.id + "t") * 2 - 1) * tiltR, dA: (dir === "mix" ? MIX[i % MIX.length] : +dir) * Math.PI / 180 };
    });
    var avgD = B.reduce(function (s, b) { return s + 2 * b.r; }, 0) / n, maxD = Math.max.apply(null, B.map(function (b) { return 2 * b.r; }));
    var cap = Math.max(1, Math.ceil((Math.sqrt(8 * n + 1) - 1) / 2)), binW = isFinite(bwPct) && bwPct > 0 ? Math.max(maxD * 1.05, W * cl(bwPct, 5, 95) / 100) : Math.min(W * 0.92, Math.max(maxD * 1.3, cap * avgD * 0.95));
    var L = corner === "bl" ? W * 0.05 : corner === "br" ? W * 0.95 - binW : W / 2 - binW / 2, Rw = L + binW, floor = corner === "c" ? H * 0.62 : H * 0.93, mid = (L + Rw) / 2;
    /* QA Instinct v14: «Duración de la caída» fija la gravedad (el reel cae en ~0,3 s) y «Esparcimiento» concentra la caída */
    var fallT = rv("pile.fall", NaN), spread = cl(rv("pile.spread", 30), 0, 100) / 100;
    var topLast = rs("pile.order", "big") === "big";
    var g = isFinite(fallT) && fallT > 0.05 ? 2 * (floor + 60) / (fallT * fallT) : H * 2.3, e = 0.15 + bo * 0.55, dt = 1 / 240, fps = 30, T = from + n * stg + 3.2, step = 0;
    var spawn = function (b) {
      var sa = Math.sin(b.dA), side = Math.abs(sa) > 0.9;
      b.x = side ? mid + sa * W * 0.62 : L + binW * (0.5 + (0.6 * hash01(b.c.id + "x") - 0.3) * Math.max(spread, 0.15) * 2) + sa * W * 0.25 * spread;
      b.y = side ? floor - H * 0.62 : -b.r - 30;
      b.vx = side ? -sa * W * 1.5 : -sa * W * 0.45; b.vy = side ? -H * 0.25 : 0; b.va = (hash01(b.c.id + "v") * 2 - 1) * 120; b.on = true;
      /* el último (el más grande, la C) cae sobre la cima de la pila, no a un costado */
      if (topLast && b === B[B.length - 1] && !side) { var lnd = B.filter(function (q) { return q.on && q !== b; }); if (lnd.length) { var top = lnd.reduce(function (m, q) { return q.y - q.r < m.y - m.r ? q : m; }); b.x = top.x; b.vx = 0; } }
    };
    for (var t = from; t <= T; t += dt, step++) {
      B.forEach(function (b) { if (!b.on && t >= b.t0) spawn(b); });
      /* los que ya se asentaron siguen ahí como apoyo fijo para los que caen después */
      var act = B.filter(function (b) { return b.on; }), mov = act.filter(function (b) { return !b.done; });
      mov.forEach(function (b) { b.vy += g * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.a += b.va * dt; });
      for (var it = 0; it < 3; it++) {
        for (var i = 0; i < act.length; i++) for (var j = i + 1; j < act.length; j++) {
          var A = act[i], C = act[j], dx = C.x - A.x, dy = C.y - A.y, dd = Math.sqrt(dx * dx + dy * dy) || 0.01, ov = A.r + C.r - dd;
          if (ov <= 0) continue;
          var iA = A.done ? 0 : 1 / (A.r * A.r), iC = C.done ? 0 : 1 / (C.r * C.r), sI = iA + iC; if (!sI) continue;
          var nx = dx / dd, ny = dy / dd;
          A.x -= nx * ov * iA / sI; A.y -= ny * ov * iA / sI; C.x += nx * ov * iC / sI; C.y += ny * ov * iC / sI;
          var vn = (C.vx - A.vx) * nx + (C.vy - A.vy) * ny;
          /* choques lentos no rebotan (si no, una pila quieta tiembla para siempre) */
          if (vn < 0) { var jj = -(1 + (vn > -60 ? 0 : e)) * vn / sI; A.vx -= jj * nx * iA; A.vy -= jj * ny * iA; C.vx += jj * nx * iC; C.vy += jj * ny * iC; }
          var tx = -ny, ty = nx, vt = (C.vx - A.vx) * tx + (C.vy - A.vy) * ty, fA = iA / sI, fC = iC / sI;
          A.vx += vt * tx * 0.1 * fA; A.vy += vt * ty * 0.1 * fA; C.vx -= vt * tx * 0.1 * fC; C.vy -= vt * ty * 0.1 * fC;
          if (iA) A.va -= vt / A.r * 20; if (iC) C.va += vt / C.r * 20;
        }
        mov.forEach(function (b) {
          if (b.y + b.r > floor) { b.y = floor - b.r; if (b.vy > 0) b.vy = b.vy < 90 ? 0 : -b.vy * e; b.vx *= 0.9; b.va = b.va * 0.6 + b.vx / b.r * 57.3 * 0.4; }
          if (!b.inBin && b.x - b.r >= L - 1 && b.x + b.r <= Rw + 1) b.inBin = true;
          if (b.inBin) {
            if (b.x - b.r < L) { b.x = L + b.r; if (b.vx < 0) b.vx = -b.vx * 0.3; }
            if (b.x + b.r > Rw) { b.x = Rw - b.r; if (b.vx > 0) b.vx = -b.vx * 0.3; }
          }
        });
      }
      mov.forEach(function (b) {
        b.vx *= 0.999; b.va *= 0.985;
        if (step % (240 / fps) === 0) {
          b.S.push({ t: r1(t - b.t0), x: b.x, y: b.y, a: b.a });
          var slow = Math.abs(b.vx) + Math.abs(b.vy) < 25 && Math.abs(b.va) < 12 && t - b.t0 > 0.4;
          b.still = slow ? b.still + 1 : 0;
          if (b.still > 10) { b.done = true; b.vx = b.vy = b.va = 0; }
        }
      });
      if (B.every(function (b) { return b.on && b.done; })) break;
    }
    B.forEach(function (b) {
      var c = b.c, S = b.S.length ? b.S : [{ t: 0, x: b.x, y: b.y, a: b.a }], last = S[S.length - 1];
      var fin = simplifyKf(S, 2.5);
      c.x = Math.round(last.x / W * 10000) / 100; c.y = Math.round(last.y / H * 10000) / 100;
      var end = c.start + c.dur; c.start = b.t0;
      /* B31: «Termina en» manda; si no, el clip dura hasta asentarse (+0,8 s) y no se estira hasta su fin anterior */
      c.dur = isFinite(pEnd) && pEnd > b.t0 ? r1(pEnd - b.t0) : r1(Math.max(Math.min(end - b.t0, last.t + 1.5), last.t + 0.8, 0.8));
      c.kf = fin.map(function (q) { return { t: r1(q.t), x: r1(q.x - last.x), y: r1(q.y - last.y), z: 0, s: 1, r: r1(q.a - last.a + b.tilt), o: 1, e: "lin" }; });
      c._pk = 1; c.anim = "none"; c.curve = false;
      ["stDir", "stB", "stD", "stR"].forEach(function (k) { delete c[k]; }); delete c.orb;
    });
    if (!o.grp || mem.some(function (c) { return c.grp !== o.grp; })) { var g4 = gid(); mem.forEach(function (c) { c.grp = g4; }); }
    VE.t = Math.min(T, from + Math.min(1.6, n * stg + 1.1));
    veAll(); veInsp();
    toast(n + " clips caen con física y se apilan desde " + fmtT(from) + (hadKf ? " (se reemplazaron los keyframes de " + hadKf + ")" : ""));
  }

  /* ── T11 · morph doble: el texto se parte en dos clips idénticos y cada uno se transforma en otro clip ── */
  function morph2(o) {
    var p = VE.p, txt = String(o.text || ""), words = txt.match(/\S+/g) || [], n = Math.round(rv("m2.n", 1));
    if (/\n/.test(txt)) return toast("El morph doble funciona con textos de una línea");
    if (!(n >= 1 && n < words.length)) return toast("La primera parte debe tener entre 1 y " + (words.length - 1) + " palabras");
    var A = rs("m2.a", ""), Bv = rs("m2.b", "");
    if (!A || !Bv) return toast("Elige en qué se transforma cada parte");
    if (A === Bv) return toast("Elige dos clips distintos para las dos partes");
    var at = cl(rv("m2.at", o.dur - 0.5), 0, o.dur), d = cl(rv("m2.d", 0.5), 0.05, 10);
    var re = /\S+/g, m, k = 0, cut = 0; while ((m = re.exec(txt))) { if (++k === n) { cut = m.index + m[0].length; break; } }
    var t1 = txt.slice(0, cut), rest = txt.slice(cut), lead = (rest.match(/^\s*/) || [""])[0], t2 = rest.slice(lead.length);
    var size = fitSize(o, W0()), ls = +o.ls || 0;
    ensureFont(o.font); mc.font = (o.italic ? "italic " : "") + (o.weight || 800) + " " + size + "px " + (FONTS[o.font] || FONTS.Inter);
    var meas = function (s) { return mc.measureText(s).width + ls * s.length; };
    var W = W0(), wAll = meas(txt), w1 = meas(t1), wGap = meas(t1 + lead) - w1, w2 = meas(t2), left = W * (+o.x || 0) / 100 - wAll / 2;
    var times = o.anim === "words" ? wordTimesOf(o) : null;
    vsnap();
    var o2 = cloneClip(o);
    o.text = t1; o2.text = t2;
    if (size < (+o.size || 64)) { o.size = size; o2.size = size; }
    o.x = Math.round((left + w1 / 2) / W * 10000) / 100; o2.x = Math.round((left + w1 + wGap + w2 / 2) / W * 10000) / 100;
    if (times) { o.wordTimes = times.slice(0, n).join(", "); o2.wordTimes = times.slice(n).join(", "); }
    delete o.morphTo; delete o2.morphTo;
    o.morphClip = A; o2.morphClip = Bv; o.morphAt = o2.morphAt = at; o.morphD = o2.morphD = d;
    p.t.splice(p.t.indexOf(o) + 1, 0, o2);
    VE.t = o.start + at + d / 2; veAll(); veInsp();
    toast("Partido en «" + t1 + "» y «" + t2 + "»: las dos partes se transforman a la vez a las " + fmtT(o.start + at));
  }

  /* ── T5/T14 · pasar una imagen (PNG/JPG) a vector nativo, con sus colores editables ── */
  function vectorizeClip(o, btn) {
    var u = (String(o.bg || "").match(/url\(["']?([^"')]+)["']?\)/) || [])[1]; if (!u) return toast("Este clip no tiene imagen");
    var R = RB(); if (!R.mcp || !VE.p._real) return toast("Abre un video tuyo para vectorizar");
    var mode = rs("vz.mode", "trace"), nC = cl(Math.round(rv("vz.n", 6)), 2, 32), noBg = rs("vz.bg", "1") === "1";
    var args = { engine: mode, options: mode === "trace" ? { colorPrecision: nC, removeBackground: noBg, filterSpeckle: 4 } : { maxColors: nC, keepBackground: !noBg } };
    var path = /^data:/.test(u) ? "" : u.split("?")[0].toLowerCase();
    btn.disabled = true; btn.textContent = "Vectorizando…";
    var put = function (sv, msg) {
      sv = sanitizeSvg(sv); if (!sv) throw new Error("el vector salió muy pesado: baja los colores");
      vsnap(); o._raster = o.bg; o.svg = sv; delete o.svgMap; delete o.icon; o.ar = r1(sizeSvg(sv).ar); o.bg = bgOf(o);
      veAll(); veInsp(); toast(msg);
    };
    /* un archivo que ya es SVG (aunque se llame .png) se usa tal cual: ya es vector */
    var isSvg = /^data:image\/svg/.test(u) || /\.svg$/.test(path);
    /* PNG y JPG van directo; WEBP, GIF y otros se pasan a PNG en el navegador */
    var asPng = function () {
      return new Promise(function (ok, ko) {
        var im = new Image(); im.crossOrigin = "anonymous";
        im.onload = function () { try { var k = Math.min(1, 900 / Math.max(im.naturalWidth, im.naturalHeight)), cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(im.naturalWidth * k)); cv.height = Math.max(1, Math.round(im.naturalHeight * k)); cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height); ok(cv.toDataURL("image/png")); } catch (e) { ko(new Error("el navegador no deja leer esa imagen")); } };
        im.onerror = function () { ko(new Error("no se pudo abrir la imagen")); }; im.src = u;
      });
    };
    (isSvg ? fetch(u).then(function (r) { if (!r.ok) throw new Error("no se pudo leer el SVG"); return r.text(); }).then(function (txt) { put(txt, "Esta imagen ya era SVG: ahora es una capa vectorial con sus colores editables"); })
      : (/^data:image\/(png|jpe?g)/.test(u) || /\.(png|jpe?g)$/.test(path) ? Promise.resolve(null) : asPng()).then(function (png) {
        if (png) args.imageBase64 = png; else if (/^data:/.test(u)) args.imageBase64 = u; else args.imageUrl = u;
        return R.mcp("image_vectorize_svg", args);
      }).then(function (r) { put(r && r.svg, "Vector listo: " + r.paths + " formas. Recolorea en «Vector (SVG)»"); })
    ).catch(function (x) {
      btn.disabled = false; btn.textContent = "Vectorizar esta imagen";
      toast("No se pudo vectorizar: " + String(x && x.message || x).replace(/^Error:\s*/, ""));
    });
  }

  /* ── B20 · «Tus imágenes» sin repetidas (mismo nombre y mismo peso) y subir lo mismo no crea otra copia ── */
  var SZ = {};
  function assetKey(a) {
    var nm = String(a.name || "").toLowerCase().replace(/\.[a-z0-9]{2,5}$/, "").replace(/\s*\(\d+\)$/, "").replace(/[-_ ](copy|copia)(\s*\d+)?$/, "").trim();
    var sz = +a.size_bytes || SZ[a.url] || 0;
    return nm + "|" + (sz ? Math.round(sz / 16) : a.url);
  }
  function uniqImgs(A) { var seen = {}; return (A || []).filter(function (a) { if (!/^image/.test(a.mime_type || "") || !a.url) return false; var k = assetKey(a); if (seen[k]) return false; seen[k] = 1; return true; }); }
  RB().uniqImgs = uniqImgs;
  var _uploadRaw = upload;
  upload = function (dataUrl, name) {
    var i = String(dataUrl).indexOf(","), b64 = String(dataUrl).slice(i + 1), bytes = Math.round(b64.length * 3 / 4) - (/==$/.test(b64) ? 2 : /=$/.test(b64) ? 1 : 0);
    var dup = /^data:image\//.test(dataUrl) && uniqImgs(RB().assets).find(function (a) { return assetKey(a) === assetKey({ name: name, size_bytes: bytes }); });
    if (dup) { toast("Esa imagen ya estaba en «Tus imágenes»: uso la misma (sin copia nueva)"); return Promise.resolve({ url: dup.url, a: dup, dup: true }); }
    return _uploadRaw(dataUrl, name).then(function (r) { SZ[r.url] = bytes; return r; });
  };

  /* ── B4 · miniaturas de los videos en Media: un cuadro real; si el navegador no deja leerlo, el video mismo ── */
  var _binB4 = veBin;
  veBin = function () {
    var R = RB();
    if (VE.p && VE.p._real) (R.assets || []).forEach(function (a) {
      if (/^video/.test(a.mime_type || "") && a.url && !VTAKES.some(function (t) { return t.blob === a.url; })) VTAKES.push({ name: a.name || "Video", src: "Tus archivos", dur: 10, bg: "#000", blob: a.url, _asset: a.id });
    });
    var r = _binB4.apply(this, arguments), box = vq("#veBin"); if (!box || !VE.p) return r;
    [].forEach.call(box.querySelectorAll('[data-add="take"]'), function (it) {
      var tk = VTAKES[+it.dataset.v], th = it.querySelector(".ve-bth");
      /* las tomas de ejemplo (franjas de color) no se muestran en un proyecto real */
      if (VE.p._real && (!tk || !tk.blob)) { it.remove(); return; }
      if (!tk || !tk.blob || !th) return;
      takeThumb(tk.blob).then(function (d) {
        if (d || !th.isConnected) return;
        th.style.background = "#000"; th.style.overflow = "hidden";
        /* Safari no deja leer el cuadro de un video de otro dominio: se muestra el video mismo, en 0,5 s. UN solo <video>
           por archivo en toda la sesión, que se mueve a la miniatura nueva: antes cada vez que se dibujaba Media (al abrir o
           al juntar cambios) se creaban otros tantos videos cargando enteros y, a la sexta vez, Safari cerraba la pestaña */
        var vv = THV[tk.blob];
        if (!vv) {
          vv = THV[tk.blob] = document.createElement("video");
          vv.muted = true; vv.playsInline = true; vv.preload = "metadata"; vv.setAttribute("muted", ""); vv.setAttribute("playsinline", ""); vv.setAttribute("aria-hidden", "true");
          vv.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;pointer-events:none";
          vv.addEventListener("loadedmetadata", function () { try { vv.currentTime = Math.min(0.5, (vv.duration || 1) / 3); } catch (e) {} }, { once: true });
          vv.src = tk.blob; try { vv.load(); } catch (e) {}
        }
        if (vv.parentNode !== th) { th.innerHTML = ""; th.appendChild(vv); }
      });
    });
    var imgH = [].find.call(box.querySelectorAll(".ed-mh"), function (h) { return /^Tus imágenes/.test(h.textContent); });
    if (imgH && R.assets) { var all = R.assets.filter(function (a) { return /^image/.test(a.mime_type || "") && a.url; }).length, un = uniqImgs(R.assets).length; if (all > un) imgH.textContent += " · " + (all - un) + " repetidas ocultas"; }
    return r;
  };

  /* ── B22 · un clic programático (element.click()) también elige el clip; y con teclado (Tab + Enter) ── */
  vq("#veLanes").addEventListener("click", function (e) {
    var el = e.target.closest && e.target.closest(".ve-clip"); if (!el || !VE.p) return;
    var k = el.dataset.tr, i = +el.dataset.i;
    if (k && !(VE.sel && VE.sel.tr === k && VE.sel.i === i)) veSelect({ tr: k, i: i });
  });
  vq("#veLanes").addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var el = e.target.closest && e.target.closest(".ve-clip"); if (!el) return;
    e.preventDefault(); veSelect({ tr: el.dataset.tr, i: +el.dataset.i });
    setTimeout(function () { var n = vq('#veLanes .ve-clip[data-tr="' + el.dataset.tr + '"][data-i="' + el.dataset.i + '"]'); if (n) n.focus(); }, 0);
  });
  var _tlA11y = veTimeline;
  veTimeline = function () {
    var r = _tlA11y.apply(this, arguments);
    [].forEach.call(document.querySelectorAll("#veLanes .ve-clip"), function (el) {
      el.tabIndex = 0; el.setAttribute("role", "button");
      if (!el.getAttribute("aria-label")) el.setAttribute("aria-label", (el.querySelector("b") || el).textContent.trim() || "Clip");
    });
    return r;
  };

  /* ── B26 · un select (o campo) que cambia solo con «change» (sin «input») también aplica el valor ── */
  var LASTIN = new WeakMap();
  vq("#veInsp").addEventListener("input", function (e) { LASTIN.set(e.target, e.target.value); }, true);
  vq("#veInsp").addEventListener("change", function (e) {
    var el = e.target; if (!el || !el.dataset || !(el.dataset.k || el.dataset.vk || el.dataset.pk) || el.type === "checkbox" || el.type === "file") return;
    if (LASTIN.get(el) === el.value) return;
    LASTIN.set(el, el.value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, true);

  /* ── B5 · «Alto de mayúscula (px)»: escribe lo que mides en el original y Musa calcula el tamaño de fuente ── */
  var CAPR = {};
  function capRatio(o) {
    var key = (o.font || "Inter") + "|" + (o.weight || 800);
    if (CAPR[key]) return CAPR[key];
    ensureFont(o.font); mc.font = (o.weight || 800) + " 200px " + (FONTS[o.font] || FONTS.Inter);
    var m = mc.measureText("H"), r = m.actualBoundingBoxAscent > 0 ? m.actualBoundingBoxAscent / 200 : 0.72;
    if (document.fonts && document.fonts.check && document.fonts.check(mc.font)) CAPR[key] = r;
    return r;
  }
  var _inspB5 = veInsp;
  veInsp = function () {
    var r = _inspB5.apply(this, arguments), o = objSel(); if (!o || VE.sel.tr !== "t") return r;
    var si = vq('#veInsp input[data-k="size"]'), lab = si && si.closest("label"); if (!lab || vq('#veInsp [data-pk="capPx"]')) return r;
    lab.insertAdjacentHTML("afterend", '<label class="ef full" title="El alto de una letra mayúscula, en px del video. Mídelo en el original (por ejemplo 76) y Musa pone el tamaño de fuente que corresponde a esta fuente."><span>Alto de mayúscula (px)</span><input type="number" step="1" data-pk="capPx" aria-label="Alto de mayúscula en px" value="' + Math.round((+o.size || 64) * capRatio(o)) + '"></label>');
    return r;
  };
  vq("#veInsp").addEventListener("input", function (e) {
    var o = objSel(); if (!o || !VE.sel || VE.sel.tr !== "t" || !e.target.dataset) return;
    if (e.target.dataset.pk === "capPx") {
      var v = parseFloat(e.target.value); if (!(v > 0)) return;
      o.size = Math.max(4, Math.round(v / capRatio(o))); var si = vq('#veInsp input[data-k="size"]'); if (si) si.value = o.size;
      veStage(); veTimeline(); return;
    }
    if (e.target.dataset.k === "size") { var cp = vq('#veInsp [data-pk="capPx"]'); if (cp) cp.value = Math.round((parseFloat(e.target.value) || 0) * capRatio(o)); }
  });


  /* ── QA Instinct T19: anillo con una lista de imágenes distintas de «Tus imágenes» ── */
  var RIMG = {};
  function ringImgsH() {
    var L = uniqImgs(RB().assets || []).slice(0, 48); if (!L.length) return "";
    var n = Object.keys(RIMG).length;
    return '<div class="ed-mh" style="grid-column:1/-1;margin-top:6px">Con imágenes distintas de tu biblioteca</div>'
      + '<div role="group" aria-label="Imágenes para el anillo" style="grid-column:1/-1;max-height:150px;overflow:auto;border:1px solid #2a2a2a;border-radius:6px;padding:4px 6px">'
      + L.map(function (a) { return '<label style="display:flex;gap:6px;align-items:center;font-size:11.5px;padding:2px 0;cursor:pointer"><input type="checkbox" data-rimg="' + esc(a.url) + '" data-rname="' + esc(a.name || "Imagen") + '"' + (RIMG[a.url] ? " checked" : "") + '><span style="width:18px;height:18px;flex:none;background:#fff url(&#39;' + esc(a.url) + '&#39;) center/contain no-repeat;border-radius:3px"></span>' + esc(a.name || "Imagen") + "</label>"; }).join("") + "</div>"
      + '<div class="ed-row"><button data-pmo="ringimgs">Anillo con las ' + n + " imágenes marcadas</button></div>";
  }
  vq("#veInsp").addEventListener("change", function (e) {
    var cb = e.target.closest && e.target.closest("[data-rimg]"); if (!cb) return;
    if (cb.checked) RIMG[cb.dataset.rimg] = cb.dataset.rname.replace(/\.[a-z0-9]{2,5}$/i, ""); else delete RIMG[cb.dataset.rimg];
    var bt = vq('#veInsp [data-pmo="ringimgs"]'); if (bt) bt.textContent = "Anillo con las " + Object.keys(RIMG).length + " imágenes marcadas";
  });

  /* ── QA Instinct T2/B9: las pistas con muchas filas se desplazan; barra visible y el clip elegido siempre a la vista ── */
  var stT2 = document.createElement("style");
  stT2.textContent = "#veTlw{scrollbar-width:auto;scrollbar-color:#6b6b6b #151515}#veTlw::-webkit-scrollbar{width:12px}#veTlw::-webkit-scrollbar-thumb{background:#6b6b6b;border-radius:6px}#veTlw::-webkit-scrollbar-track{background:#151515}";
  document.head.appendChild(stT2);
  var _selT2 = veSelect;
  veSelect = function (s) {
    var r = _selT2.apply(this, arguments);
    if (s && s.tr && s.i != null) {
      var w = vq("#veTlw"), el = vq('#veLanes .ve-clip[data-tr="' + s.tr + '"][data-i="' + s.i + '"]');
      if (w && el) { var top = el.offsetTop, h = el.offsetHeight; if (top - 28 < w.scrollTop) w.scrollTop = Math.max(0, top - 28); else if (top + h > w.scrollTop + w.clientHeight) w.scrollTop = top + h - w.clientHeight + 8; }
    }
    return r;
  };

  /* ═════ QA Instinct · réplica Comfy v11 ═════ */
  /* ── B30 · el anillo de un clip: su grupo + los clips en órbita alrededor del mismo centro (y ese centro) ── */
  function ringSet(o) {
    var p = VE.p, out = grpOf(o).slice(); if (out.indexOf(o) < 0) out.push(o);
    var near = function (a, b) { return Math.abs((+a.x || 0) - (+b.x || 0)) < 0.6 && Math.abs((+a.y || 0) - (+b.y || 0)) < 0.6 && a.start < b.start + b.dur && b.start < a.start + a.dur; };
    var all = (p.m || []).concat(p.t || []);
    /* un centro sin grupo: los que orbitan a su alrededor; un miembro sin grupo: sus compañeros de órbita y el centro */
    all.forEach(function (c) { if (out.indexOf(c) < 0 && near(c, o) && (c.orb || o.orb)) out.push(c); });
    return out;
  }

  /* ── B32 · clips de la línea de tiempo: también los eventos de mouse sintéticos (mousedown/mouseup sin pointerdown) ── */
  var lastPD = 0;
  vq("#veLanes").addEventListener("pointerdown", function () { lastPD = Date.now(); }, true);
  ["mousedown", "mouseup"].forEach(function (tp) {
    vq("#veLanes").addEventListener(tp, function (e) {
      if (Date.now() - lastPD < 400) return;   /* un clic real ya pasó por pointerdown */
      var el = e.target.closest && e.target.closest(".ve-clip"); if (!el || !VE.p) return;
      var k = el.dataset.tr, i = +el.dataset.i;
      if (k && !(VE.sel && VE.sel.tr === k && VE.sel.i === i)) veSelect({ tr: k, i: i });
    });
  });

  /* ── B12 · el inspector conserva sus elementos entre cambios: se redibuja «en el lugar» (mismo campo, mismo nodo),
     así una referencia a un campo sigue sirviendo después de cambiar otro ── */
  function morphNode(a, b) {
    if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) return b;
    if (a.nodeType === 3 || a.nodeType === 8) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return a; }
    if (a.nodeType !== 1) return b;
    /* un campo con otra clave es otro campo: se reemplaza */
    var key = function (n) { return n.getAttribute("data-k") || n.getAttribute("data-vk") || n.getAttribute("data-pk") || n.getAttribute("data-bk") || n.getAttribute("data-pmo") || n.getAttribute("id") || ""; };
    if (key(a) !== key(b)) return b;
    [].slice.call(a.attributes).forEach(function (at) { if (!b.hasAttribute(at.name)) a.removeAttribute(at.name); });
    [].slice.call(b.attributes).forEach(function (at) { if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value); });
    if (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT") {
      if (a.tagName === "SELECT") { morphKids(a, b); }
      if (a !== document.activeElement && a.value !== b.value && a.type !== "file") a.value = b.value;
      if (a.type === "checkbox" || a.type === "radio") a.checked = b.checked;
      if (a.tagName === "TEXTAREA" && a !== document.activeElement && a.value !== b.value) a.value = b.value;
      return a;
    }
    if (a.tagName === "DETAILS") a.open = b.open;
    morphKids(a, b);
    return a;
  }
  function morphKids(a, b) {
    var ak = [].slice.call(a.childNodes), bk = [].slice.call(b.childNodes);
    for (var i = 0; i < bk.length; i++) {
      var cur = ak[i];
      if (!cur) { a.appendChild(bk[i]); continue; }
      var r = morphNode(cur, bk[i]);
      if (r !== cur) a.replaceChild(r, cur);
    }
    for (var j = bk.length; j < ak.length; j++) if (ak[j].parentNode === a) a.removeChild(ak[j]);
  }
  var _inspKeep = veInsp;
  veInsp = function () {
    var box = vq("#veInsp"); if (!box) return _inspKeep.apply(this, arguments);
    var old = [].slice.call(box.childNodes), act = document.activeElement, keepAct = act && box.contains(act) ? act : null;
    var r = _inspKeep.apply(this, arguments);
    var fresh = [].slice.call(box.childNodes);
    try {
      var st = box.scrollTop;
      if (!old.length) return r;
      var shell = document.createElement("div"); old.forEach(function (n) { shell.appendChild(n); });
      var nb = document.createElement("div"); fresh.forEach(function (n) { nb.appendChild(n); });
      morphKids(shell, nb);
      while (shell.firstChild) box.appendChild(shell.firstChild);
      box.scrollTop = st;
      if (keepAct && keepAct.isConnected && document.activeElement !== keepAct) try { keepAct.focus({ preventScroll: true }); } catch (e) {}
    } catch (e) { /* si algo falla, queda el inspector recién dibujado */ if (!box.childNodes.length) fresh.forEach(function (n) { box.appendChild(n); }); }
    return r;
  };


  /* ═════ QA Instinct · reportes v15–v16 ═════ */
  /* ── B40 · en «Editar varios» los clips con el mismo nombre se distinguen: n.º en la pista y su papel ── */
  function clipTag(c, arr) {
    var same = arr.filter(function (x) { return (x.name || x.text) === (c.name || c.text); }).length > 1;
    var tags = [];
    if (c.orb) tags.push("anillo"); if (c._pk || c.anim === "stack") tags.push("pila"); if (c.morphClip) tags.push("morph");
    return (same ? " · #" + (arr.indexOf(c) + 1) : "") + (tags.length ? " · " + tags.join(", ") : "");
  }
  /* ── B39 · los campos de las herramientas (Apilarse, Anillo, Morph doble, Vectorizar, Editar varios) conservan lo que
     escribiste aunque el inspector se redibuje (antes volvían a su valor por defecto y «Apilarse» leía los de fábrica) ── */
  var TOOLP = {}, TOOLRE = /^(rep|pile|m2|vz|pre)\./;
  function toolKey(el) { var d = el && el.dataset; if (!d) return null; return d.pk && TOOLRE.test(d.pk) ? "pk:" + d.pk : d.bk ? "bk:" + d.bk : null; }
  ["input", "change"].forEach(function (tp) {
    vq("#veInsp").addEventListener(tp, function (e) { var k = toolKey(e.target); if (k) TOOLP[k] = e.target.value; }, true);
  });
  var _inspTool = veInsp;
  veInsp = function () {
    var r = _inspTool.apply(this, arguments), box = vq("#veInsp"); if (!box) return r;
    [].forEach.call(box.querySelectorAll("[data-pk],[data-bk]"), function (el) {
      var k = toolKey(el); if (!k || TOOLP[k] == null || el === document.activeElement) return;
      if (el.tagName === "SELECT" && ![].some.call(el.options, function (op) { return op.value === TOOLP[k]; })) return;
      el.value = TOOLP[k];
    });
    return r;
  };
  RB().veToolParams = function () { return Object.assign({}, TOOLP); };


  /* ═════ QA Instinct v16 · wishlist ALTA: editor de curvas, grupo como objeto + cámara, desenfoque de movimiento
     real, presets de animación, kit de marca e historial de versiones ═════ */
  var gPend = false;

  /* ── grupo como objeto (precomp) y cámara: keyframes del grupo (tiempo absoluto) con su centro de giro ── */
  function gEnsure(key) {
    var p = VE.p; p.gtr = p.gtr || {};
    if (!p.gtr[key]) {
      var px = 50, py = 50;
      if (key !== "__cam") { var mem = (p.m || []).concat(p.t || []).filter(function (c) { return c.grp === key; }); if (mem.length) { px = r1(mem.reduce(function (s, c) { return s + (+c.x || 0); }, 0) / mem.length); py = r1(mem.reduce(function (s, c) { return s + (+c.y || 0); }, 0) / mem.length); } }
      p.gtr[key] = { px: px, py: py, kf: [] };
    }
    return p.gtr[key];
  }
  function groupFx(c, t, st) {
    var p = VE.p, T = p && p.gtr; if (!T) return;
    var L = []; if (c.grp && T[c.grp] && T[c.grp].kf && T[c.grp].kf.length) L.push(T[c.grp]); if (T.__cam && T.__cam.kf && T.__cam.kf.length) L.push(T.__cam);
    if (!L.length) return;
    var W = W0(), H = H0();
    L.forEach(function (G) {
      var k = sampleK({ kf: G.kf }, t), gs = k.s != null ? k.s : 1, a = (k.r || 0) * Math.PI / 180;
      var px = W * (G.px != null ? +G.px : 50) / 100, py = H * (G.py != null ? +G.py : 50) / 100;
      var cx = W * (+c.x || 0) / 100 + st.dx, cy = H * (+c.y || 0) / 100 + st.dy, vx = (cx - px) * gs, vy = (cy - py) * gs;
      st.dx += px + vx * Math.cos(a) - vy * Math.sin(a) + (k.x || 0) - cx; st.dy += py + vx * Math.sin(a) + vy * Math.cos(a) + (k.y || 0) - cy;
      st.s *= gs; st.r += k.r || 0; st.o *= k.o != null ? k.o : 1;
    });
  }
  function gNum(key, f, l, v, step) { return '<label class="ef' + (l.length > 12 ? " full" : "") + '"><span>' + l + '</span><input type="number" step="' + step + '" data-gkey="' + esc(key) + '" data-gf="' + f + '" value="' + r1(+v || 0) + '"></label>'; }
  function gkBody(key, note) {
    var p = VE.p, G = p.gtr && p.gtr[key], has = G && G.kf && G.kf.length;
    var k = has ? sampleK({ kf: G.kf }, VE.t) : { x: 0, y: 0, s: 1, r: 0, o: 1 };
    var at = has && G.kf.find(function (x) { return Math.abs(x.t - VE.t) < 0.02; });
    var piv = G || (key === "__cam" ? { px: 50, py: 50 } : null);
    return '<div class="ed-note" style="grid-column:1/-1">' + note + " " + (has ? G.kf.length + " keyframes. " : "") + (at ? "Editas el keyframe de " + fmtT(VE.t) + "." : "Al cambiar un valor se crea un keyframe en " + fmtT(VE.t) + ".") + "</div>"
      + gNum(key, "x", "Mover X (px)", k.x, 1) + gNum(key, "y", "Mover Y (px)", k.y, 1) + gNum(key, "s", "Escala", k.s != null ? k.s : 1, 0.05) + gNum(key, "r", "Rotación°", k.r, 1) + gNum(key, "o", "Opacidad", k.o != null ? k.o : 1, 0.05)
      + gNum(key, "px", "Centro de giro X %", piv ? piv.px : 50, 0.5) + gNum(key, "py", "Centro de giro Y %", piv ? piv.py : 50, 0.5)
      + '<div class="ed-row" style="flex-wrap:wrap"><button data-gka="prev" data-gkey="' + esc(key) + '">◀ Anterior</button><button data-gka="next" data-gkey="' + esc(key) + '">Siguiente ▶</button>'
      + (at ? '<button data-gka="del" data-gkey="' + esc(key) + '">Borrar keyframe</button>' : "") + (has ? '<button data-gka="clear" data-gkey="' + esc(key) + '">Quitar animación</button>' : "") + "</div>";
  }
  vq("#veInsp").addEventListener("focusin", function (e) { if (e.target.dataset && (e.target.dataset.gkey || e.target.dataset.pk === "mbA")) gPend = true; });
  vq("#veInsp").addEventListener("input", function (e) {
    var el = e.target; if (!el.dataset || !el.dataset.gkey || !el.dataset.gf) return;
    var v = parseFloat(el.value); if (!isFinite(v) || !VE.p) return;
    if (gPend) { vsnap(); gPend = false; }
    var G = gEnsure(el.dataset.gkey), f = el.dataset.gf;
    if (f === "px" || f === "py") { G[f] = v; veStage(); return; }
    var t = r1(VE.t), kf = G.kf.find(function (x) { return Math.abs(x.t - t) < 0.02; });
    if (!kf) { kf = Object.assign({}, sampleK({ kf: G.kf }, t), { t: t }); delete kf.p; G.kf.push(kf); G.kf.sort(function (a, b) { return a.t - b.t; }); }
    kf[f] = f === "o" ? cl(v, 0, 1) : f === "s" ? Math.max(0.01, v) : v;
    veStage();
  });
  vq("#veInsp").addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-gka]"); if (!b || !VE.p) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var key = b.dataset.gkey, G = VE.p.gtr && VE.p.gtr[key], a = b.dataset.gka;
    if (a === "clear") { vsnap(); delete VE.p.gtr[key]; veAll(); return veInsp(); }
    if (!G || !G.kf.length) return;
    if (a === "del") { vsnap(); G.kf = G.kf.filter(function (x) { return Math.abs(x.t - VE.t) >= 0.02; }); veAll(); return veInsp(); }
    var k2 = a === "prev" ? G.kf.slice().reverse().find(function (x) { return x.t < VE.t - 0.02; }) : G.kf.find(function (x) { return x.t > VE.t + 0.02; });
    if (!k2) return toast("No hay más keyframes del grupo");
    VE.t = k2.t; veAll(); veInsp();
  }, true);

  /* ── desenfoque de movimiento real: sale de la velocidad del clip entre un cuadro y el anterior ── */
  var MBG = false;
  function mbFx(c, t, kind, st) {
    if (!(+c.mbA > 0) || MBG) return;
    var p2; MBG = true; try { p2 = state(c, t - 1 / 30, kind); } finally { MBG = false; }
    var w = kind === "m" ? W0() * (c.w || 40) / 100 : 220;
    var d = Math.sqrt(Math.pow(st.dx - p2.dx, 2) + Math.pow(st.dy - p2.dy, 2)) + Math.abs(st.s - p2.s) * w * 0.5 + Math.abs(st.r - p2.r) * w / 115;
    st.blur = (st.blur || 0) + Math.min(60, d * (+c.mbA / 100) * 0.35);
  }

  /* ── editor de curvas: el valor de una propiedad en el tiempo, keyframes y manijas bezier arrastrables ── */
  var GR = { prop: "s", seg: 0 }, GPROPS = [["x", "Mover X"], ["y", "Mover Y"], ["z", "Z"], ["s", "Escala"], ["r", "Rotación"], ["o", "Opacidad"]], GW = 300, GH = 170;
  function gMap(o) {
    var kf = o.kf, t0 = kf[0].t, t1 = kf[kf.length - 1].t; if (t1 - t0 < 0.01) t1 = t0 + 1;
    var vals = []; for (var i = 0; i <= 80; i++) vals.push(sampleK(o, t0 + (t1 - t0) * i / 80)[GR.prop]);
    kf.forEach(function (k) { vals.push(kfFill(k)[GR.prop]); });
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals); if (mx - mn < 1e-6) { mn -= 1; mx += 1; }
    var pad = (mx - mn) * 0.18; return { t0: t0, t1: t1, mn: mn - pad, mx: mx + pad };
  }
  function gX(m, t) { return 18 + (t - m.t0) / (m.t1 - m.t0) * (GW - 36); }
  function gY(m, v) { return GH - 18 - (v - m.mn) / (m.mx - m.mn) * (GH - 36); }
  function bzN(k) { var n = String(k.bz || "0.34, 1.56, 0.64, 1").split(/[\s,]+/).filter(Boolean).map(Number); return n.length === 4 && n.every(isFinite) ? n : [0.34, 1.56, 0.64, 1]; }
  function graphSvg(o, m) {
    m = m || gMap(o); var kf = o.kf, P = GR.prop, h = "";
    var pts = []; for (var i = 0; i <= 120; i++) { var t = m.t0 + (m.t1 - m.t0) * i / 120; pts.push(r1(gX(m, t)) + "," + r1(gY(m, sampleK(o, t)[P]))); }
    h += '<line x1="18" y1="' + (GH - 18) + '" x2="' + (GW - 18) + '" y2="' + (GH - 18) + '" stroke="#333"/><polyline points="' + pts.join(" ") + '" fill="none" stroke="#e8e6df" stroke-width="2"/>';
    for (var s = 0; s < kf.length - 1; s++) {
      var a = kf[s], b = kf[s + 1], sp = [];
      for (var j = 0; j <= 24; j++) { var tt = a.t + (b.t - a.t) * j / 24; sp.push(r1(gX(m, tt)) + "," + r1(gY(m, sampleK(o, tt)[P]))); }
      h += '<polyline data-gseg="' + s + '" points="' + sp.join(" ") + '" fill="none" stroke="' + (s === GR.seg ? "#ff5e00" : "transparent") + '" stroke-width="' + (s === GR.seg ? 3 : 14) + '" style="cursor:pointer"' + (s === GR.seg ? "" : ' stroke-opacity="0.01"') + '/>';
    }
    var sg = kf[GR.seg], sb = kf[GR.seg + 1];
    if (sg && sb && sg.e === "bezier") {
      var n = bzN(sg), va = kfFill(sg)[P], vb = kfFill(sb)[P];
      var h1 = [gX(m, sg.t + n[0] * (sb.t - sg.t)), gY(m, va + n[1] * (vb - va))], h2 = [gX(m, sg.t + n[2] * (sb.t - sg.t)), gY(m, va + n[3] * (vb - va))];
      h += '<line x1="' + r1(gX(m, sg.t)) + '" y1="' + r1(gY(m, va)) + '" x2="' + r1(h1[0]) + '" y2="' + r1(h1[1]) + '" stroke="#ff5e00" stroke-dasharray="3 3"/><line x1="' + r1(gX(m, sb.t)) + '" y1="' + r1(gY(m, vb)) + '" x2="' + r1(h2[0]) + '" y2="' + r1(h2[1]) + '" stroke="#ff5e00" stroke-dasharray="3 3"/>'
        + '<rect data-gh="1" x="' + r1(h1[0] - 6) + '" y="' + r1(h1[1] - 6) + '" width="12" height="12" fill="#151515" stroke="#ff5e00" stroke-width="2" style="cursor:grab"/><rect data-gh="2" x="' + r1(h2[0] - 6) + '" y="' + r1(h2[1] - 6) + '" width="12" height="12" fill="#151515" stroke="#ff5e00" stroke-width="2" style="cursor:grab"/>';
    }
    kf.forEach(function (k, i) { h += '<circle data-gk="' + i + '" cx="' + r1(gX(m, k.t)) + '" cy="' + r1(gY(m, kfFill(k)[P])) + '" r="7" fill="#ff5e00" stroke="#111" stroke-width="2" style="cursor:grab"><title>' + k.t.toFixed(2) + " s · " + r1(kfFill(k)[P]) + "</title></circle>"; });
    return '<svg id="veGraph" viewBox="0 0 ' + GW + " " + GH + '" role="img" aria-label="Curva de ' + (GPROPS.find(function (x) { return x[0] === P; }) || [0, P])[1] + '" style="width:100%;height:auto;background:#151515;border-radius:6px;display:block;touch-action:none">' + h + "</svg>";
  }
  function graphSec(o) {
    if (!o.kf || o.kf.length < 2) return sec("Editor de curvas", '<div class="ed-note" style="grid-column:1/-1">Con 2 o más keyframes ves aquí la curva de cada propiedad y la ajustas arrastrando: los puntos mueven el keyframe (tiempo y valor) y las manijas cambian la aceleración (con rebote y overshoot).</div>', false);
    if (GR.seg > o.kf.length - 2) GR.seg = 0;
    var sg = o.kf[GR.seg], e = sg && sg.e || "auto";
    var pre = [["lin", "Lineal"], ["smooth", "Suave"], ["in", "Acelera"], ["out", "Frena"], ["over", "Overshoot"], ["spring", "Rebote"]];
    return sec("Editor de curvas", '<label class="ef full"><span>Propiedad</span><select data-gprop="1">' + GPROPS.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === GR.prop ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") + "</select></label>"
      + '<div id="veGraphHost" style="grid-column:1/-1">' + graphSvg(o) + "</div>"
      + '<div class="ed-note" style="grid-column:1/-1">Tramo ' + (GR.seg + 1) + " de " + (o.kf.length - 1) + " (" + sg.t.toFixed(2) + "–" + o.kf[GR.seg + 1].t.toFixed(2) + " s) · curva: " + (EASEN[e] || e) + ". Toca un tramo de la línea para elegirlo; con «Overshoot» aparecen dos manijas para arrastrar.</div>"
      + '<div class="ed-row" style="flex-wrap:wrap">' + pre.map(function (x) { return '<button data-gpre="' + x[0] + '">' + x[1] + "</button>"; }).join("") + "</div>", true);
  }
  function gRedraw(o, m) { var host = vq("#veGraphHost"); if (host) host.innerHTML = graphSvg(o, m); }
  vq("#veInsp").addEventListener("change", function (e) { if (!e.target.dataset || !e.target.dataset.gprop) return; GR.prop = e.target.value; var o = objSel(); if (o && o.kf && o.kf.length > 1) gRedraw(o); });
  vq("#veInsp").addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-gpre]"); if (!b) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var o = objSel(); if (!o || !o.kf || o.kf.length < 2) return; var k = o.kf[GR.seg]; if (!k) return;
    vsnap(); var a = b.dataset.gpre;
    delete k.bz; delete k.sb; delete k.sv;
    if (a === "over") { k.e = "bezier"; k.bz = "0.34, 1.56, 0.64, 1"; } else if (a === "spring") { k.e = "spring"; k.sb = 55; k.sv = 50; } else k.e = a;
    veAll(); veInsp();
  }, true);
  var GDRAG = null;
  function gPt(e, svg) { var r = svg.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * GW, (e.clientY - r.top) / r.height * GH]; }
  document.addEventListener("pointerdown", function (e) {
    var el = e.target; if (!el || !el.closest) return; var svg = el.closest("#veGraph"); if (!svg) return;
    var o = objSel(); if (!o || !o.kf || o.kf.length < 2) return;
    var gk = el.getAttribute("data-gk"), gh = el.getAttribute("data-gh"), gs = el.getAttribute("data-gseg");
    if (gk == null && gh == null) { if (gs != null) { GR.seg = +gs; veInsp(); } return; }
    e.preventDefault(); vsnap();
    GDRAG = { o: o, i: gk != null ? +gk : null, h: gh != null ? +gh : null, svg: svg, m: gMap(o) };
  }, true);
  document.addEventListener("pointermove", function (e) {
    if (!GDRAG) return; var D = GDRAG, o = D.o, m = D.m, svg = vq("#veGraph"); if (!svg) return;
    /* el gráfico se redibuja en cada movimiento: se mide siempre contra el que está en pantalla */
    var pt = gPt(e, svg), P = GR.prop; if (!isFinite(pt[0]) || !isFinite(pt[1])) return;
    var t = m.t0 + (pt[0] - 18) / (GW - 36) * (m.t1 - m.t0), v = m.mn + (GH - 18 - pt[1]) / (GH - 36) * (m.mx - m.mn);
    if (D.i != null) {
      var kf = o.kf, k = kf[D.i], lo = D.i ? kf[D.i - 1].t + 0.02 : 0, hi = D.i < kf.length - 1 ? kf[D.i + 1].t - 0.02 : o.dur;
      k.t = r1(cl(t, lo, hi)); k[P] = P === "o" ? r1(cl(v, 0, 1)) : r1(v);
    } else {
      var a = o.kf[GR.seg], b = o.kf[GR.seg + 1]; if (!a || !b) return;
      var n = bzN(a), va = kfFill(a)[P], vb = kfFill(b)[P], x = cl((t - a.t) / ((b.t - a.t) || 1), 0, 1), y = Math.abs(vb - va) > 1e-6 ? cl((v - va) / (vb - va), -1.5, 2.5) : n[D.h === 1 ? 1 : 3];
      if (D.h === 1) { n[0] = r1(x); n[1] = r1(y); } else { n[2] = r1(x); n[3] = r1(y); }
      a.e = "bezier"; a.bz = n.join(", ");
    }
    gRedraw(o, m); veStage();
  });
  document.addEventListener("pointerup", function () { if (!GDRAG) return; GDRAG = null; veAll(); veInsp(); });

  /* ── presets de animación (de fábrica y los del espacio) ── */
  var PRE0 = [
    { id: "f:pop", name: "Pop suave", p: { anim: "pop", enD: 0.35 } },
    { id: "f:fade", name: "Fundido rápido (0,15 s)", p: { anim: "fade", enD: 0.15 } },
    { id: "f:over", name: "Entrada con overshoot", p: { anim: "none", kf: [{ t: 0, x: 0, y: 0, z: 0, s: 0.55, r: 0, o: 0, e: "bezier", bz: "0.34, 1.56, 0.64, 1" }, { t: 0.45, x: 0, y: 0, z: 0, s: 1, r: 0, o: 1 }] } },
    { id: "f:up", name: "Sube con rebote", p: { anim: "none", kf: [{ t: 0, x: 0, y: 160, z: 0, s: 1, r: 0, o: 0, e: "spring", sb: 55, sv: 55 }, { t: 0.6, x: 0, y: 0, z: 0, s: 1, r: 0, o: 1 }] } },
    { id: "f:stack", name: "Cae y rebota", p: { anim: "stack", stD: 0.7, stB: 45, stDir: 0 } },
    { id: "f:blur", name: "Aparece desenfocado", p: { anim: "blur-in", enD: 0.45 } },
    { id: "f:spin", name: "Gira al entrar", p: { anim: "rotate-in", enD: 0.5 } },
    { id: "f:zoom", name: "Zoom in", p: { anim: "zoom-in", enD: 0.4 } },
    { id: "f:wipe", name: "Barrido", p: { anim: "wipe", enD: 0.5 } },
    { id: "f:float", name: "Flotar (loop)", p: { fx: "float" } },
    { id: "f:pulse", name: "Pulso (loop)", p: { fx: "pulse" } },
    { id: "f:ken", name: "Acercamiento lento", p: { fx: "ken-burns" } }
  ];
  var PKEYS = ["anim", "enD", "fx", "kf", "glow", "glowR", "stD", "stB", "stDir", "stR", "mbA", "mask", "expr", "curve"];
  var PRES = { list: null, table: true, ws: null };
  function presLocalKey() { return "musa_vpresets:" + (RB().ws || ""); }
  function presLoad() {
    var R = RB(); if (PRES.list && PRES.ws === R.ws) return Promise.resolve(PRES.list);
    PRES.ws = R.ws;
    var local = function () { try { return JSON.parse(localStorage.getItem(presLocalKey()) || "[]"); } catch (e) { return []; } };
    if (!PRES.table || !R.on) return Promise.resolve(PRES.list = local());
    return api("/rest/v1/video_motion_presets?workspace_id=eq." + encodeURIComponent(R.ws) + "&select=id,name,kind,preset&order=created_at.desc&limit=100")
      .then(function (r) { PRES.list = (r || []).map(function (x) { return { id: "w:" + x.id, name: x.name, p: x.preset }; }).concat(local()); return PRES.list; },
        function () { PRES.table = false; return PRES.list = local(); });
  }
  function presOf(id) { return PRE0.concat(PRES.list || []).find(function (x) { return x.id === id; }); }
  function presApply(c, pr) {
    PKEYS.forEach(function (k) { if (pr.p[k] !== undefined) c[k] = JSON.parse(JSON.stringify(pr.p[k])); });
    if (pr.p.kf && !pr.p.anim) c.anim = "none";
    if (pr.p.kf && c._pk) delete c._pk;
  }
  /* datos que llegan después (presets, marca): el inspector se vuelve a dibujar, pero no mientras la persona está en un
     campo. Antes, al abrir un video y hacer clic enseguida en un campo, se redibujaba, el campo perdía el foco y lo que
     se escribía no llegaba a ningún lado. Ahora espera a que salga del campo. */
  function inspSoon() {
    var a = document.activeElement;
    if (a && a.closest && a.closest("#veInsp") && /^(?:INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { a.addEventListener("blur", function () { setTimeout(function () { if (VE.open) inspSoon(); }, 0); }, { once: true }); return; }
    veInsp();
  }
  function presSec(o, tr) {
    var list = PRE0.concat(PRES.list || []), M = VE._multi, nm = M && M.tr === tr ? (VE.p[tr] || []).filter(function (c) { return M.ids[c.id]; }).length : 0;
    if (!PRES.list) presLoad().then(function () { if (objSel() === o) inspSoon(); });
    return sec("Presets de animación", '<label class="ef full"><span>Preset</span><select data-pk="pre.id">' + list.map(function (x) { return '<option value="' + esc(x.id) + '">' + (x.id.indexOf("f:") === 0 ? "" : "★ ") + esc(x.name) + "</option>"; }).join("") + "</select></label>"
      + '<div class="ed-row" style="flex-wrap:wrap"><button data-prea="one">Aplicar a este clip</button>' + (nm > 1 ? '<button data-prea="marked">Aplicar a los ' + nm + " marcados</button>" : "") + "</div>"
      + '<label class="ef full"><span>Guardar la animación de este clip como preset</span><input data-pk="pre.name" placeholder="Nombre del preset"></label>'
      + '<div class="ed-row" style="flex-wrap:wrap"><button data-prea="save">Guardar preset</button><button data-prea="del">Borrar el preset elegido</button></div>'
      + '<div class="ed-note" style="grid-column:1/-1">Los presets con ★ son de tu espacio' + (PRES.table ? "" : " (guardados en este navegador)") + ". Guardan la entrada, su duración, los keyframes, el efecto y el desenfoque.</div>", false);
  }
  vq("#veInsp").addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-prea]"); if (!b) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var o = objSel(); if (!o) return; var tr = VE.sel.tr, a = b.dataset.prea, sel = vq('#veInsp [data-pk="pre.id"]'), pr = sel && presOf(sel.value);
    if (a === "one" || a === "marked") {
      if (!pr) return toast("Elige un preset");
      vsnap(); var M = VE._multi, list = a === "one" ? [o] : (VE.p[tr] || []).filter(function (c) { return M && M.tr === tr && M.ids[c.id]; });
      list.forEach(function (c) { presApply(c, pr); }); VE.t = o.start + 0.01; veAll(); veInsp();
      return toast("«" + pr.name + "» aplicado a " + list.length + " clip" + (list.length === 1 ? "" : "s"));
    }
    if (a === "save") {
      var ni = vq('#veInsp [data-pk="pre.name"]'), name = (ni && ni.value || "").trim(); if (!name) return toast("Escribe un nombre para el preset");
      var preset = {}; PKEYS.forEach(function (k) { if (o[k] !== undefined && k !== "mask") preset[k] = JSON.parse(JSON.stringify(o[k])); });
      if (!Object.keys(preset).length) return toast("Este clip no tiene animación para guardar");
      var R = RB(), local = function () { var L = []; try { L = JSON.parse(localStorage.getItem(presLocalKey()) || "[]"); } catch (x) {} L.unshift({ id: "l:" + Date.now(), name: name, p: preset }); try { localStorage.setItem(presLocalKey(), JSON.stringify(L.slice(0, 60))); } catch (x) {} };
      (PRES.table && R.on ? api("/rest/v1/video_motion_presets", { method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ workspace_id: R.ws, name: name, kind: tr, preset: preset }) }).catch(function () { PRES.table = false; local(); }) : Promise.resolve(local()))
        .then(function () { PRES.list = null; TOOLP["pk:pre.name"] = ""; return presLoad(); }).then(function () { veInsp(); toast("Preset «" + name + "» guardado"); });
      return;
    }
    if (a === "del") {
      if (!pr || pr.id.indexOf("f:") === 0) return toast("Los presets de fábrica no se borran");
      var done = function () { PRES.list = null; presLoad().then(function () { veInsp(); toast("Preset borrado"); }); };
      if (pr.id.indexOf("w:") === 0) return api("/rest/v1/video_motion_presets?id=eq." + encodeURIComponent(pr.id.slice(2)), { method: "DELETE" }).then(done, function () { toast("No se pudo borrar"); });
      try { var L = JSON.parse(localStorage.getItem(presLocalKey()) || "[]").filter(function (x) { return x.id !== pr.id; }); localStorage.setItem(presLocalKey(), JSON.stringify(L)); } catch (x) {}
      return done();
    }
  }, true);

  /* ── kit de marca: colores y fuentes de tus marcas, en un clic ── */
  function brandKit() {
    var bs = brandCache || [], cols = [], fonts = [];
    var hex = function (v) { v = typeof v === "string" ? v : v && (v.hex || v.value || v.color); return hex6(v); };
    var fam = function (f) { return typeof f === "string" ? f : f && (f.family || f.name || f.font); };
    bs.forEach(function (b) {
      (Array.isArray(b.colors) ? b.colors : b.colors && typeof b.colors === "object" ? Object.values(b.colors) : []).forEach(function (c) { var h = hex(c); if (h && cols.indexOf(h) < 0) cols.push(h); });
      var F = b.fonts; (Array.isArray(F) ? F : F && typeof F === "object" ? Object.values(F) : []).forEach(function (f) { var n = fam(f); if (n && /^[A-Za-z0-9 ]{2,40}$/.test(n) && fonts.indexOf(n) < 0) fonts.push(n); });
    });
    return { cols: cols.slice(0, 16), fonts: fonts.slice(0, 8) };
  }
  function brandSec(o, tr) {
    if (brandCache == null) { brands().then(function () { if (objSel() === o) inspSoon(); }); return ""; }
    var K = brandKit(); if (!K.cols.length && !K.fonts.length) return "";
    var sw = K.cols.map(function (c) { return '<button type="button" data-brc="' + c + '" title="' + c + '" aria-label="Color de marca ' + c + '" style="width:26px;height:26px;min-width:0;flex:none;padding:0;border-radius:6px;border:2px solid rgba(255,255,255,.25);background:' + c + '"></button>'; }).join("");
    return sec("Tu marca", (sw ? '<div style="grid-column:1/-1;display:flex;gap:6px;flex-wrap:wrap">' + sw + "</div>" : "")
      + (tr === "t" && K.fonts.length ? '<div class="ed-row" style="flex-wrap:wrap">' + K.fonts.map(function (f) { return '<button data-brf="' + esc(f) + '" style="font-family:' + esc(familyCss(f)) + '">' + esc(f) + "</button>"; }).join("") + "</div>" : "")
      + (tr === "t" ? '<div class="ed-row"><button data-bra="1">Aplicar color y fuente de marca a todos los textos</button></div>' : '<div class="ed-note" style="grid-column:1/-1">El color se aplica al relleno de la forma o al brillo de la imagen.</div>'), false);
  }
  vq("#veInsp").addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-brc],[data-brf],[data-bra]"); if (!b) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var o = objSel(); if (!o) return; var tr = VE.sel.tr, K = brandKit(); vsnap();
    if (b.dataset.brc) { if (tr === "t") o.color = b.dataset.brc; else if (/url\(/.test(o.bg || "")) o.glow = b.dataset.brc; else { delete o.grad; o.bg = b.dataset.brc; } }
    if (b.dataset.brf) { addFont(b.dataset.brf); ensureFont(b.dataset.brf); o.font = b.dataset.brf; }
    if (b.dataset.bra) VE.p.t.forEach(function (c) { if (K.cols[0]) c.color = K.cols[0]; if (K.fonts[0]) { addFont(K.fonts[0]); ensureFont(K.fonts[0]); c.font = K.fonts[0]; } });
    veAll(); veInsp(); toast(b.dataset.bra ? "Marca aplicada a " + VE.p.t.length + " textos" : "Listo");
  }, true);

  /* ── historial de versiones: una foto al guardar (cada 90 s como máximo, y siempre con «Guardar») y «Restaurar» ── */
  var VER = { pid: null, list: null, last: 0, table: true, n: 0 };
  function idb() {
    return new Promise(function (ok, ko) {
      if (!window.indexedDB) return ko(new Error("sin IndexedDB"));
      var rq = indexedDB.open("musa_video_versions", 1);
      rq.onupgradeneeded = function () { var s = rq.result.createObjectStore("v", { keyPath: "id", autoIncrement: true }); s.createIndex("p", "project_id"); };
      rq.onsuccess = function () { ok(rq.result); }; rq.onerror = function () { ko(rq.error); };
    });
  }
  function idbAll(pid) { return idb().then(function (db) { return new Promise(function (ok) { var out = [], tx = db.transaction("v"), c = tx.objectStore("v").index("p").openCursor(IDBKeyRange.only(pid)); c.onsuccess = function () { var cu = c.result; if (cu) { out.push(cu.value); cu.continue(); } else ok(out.sort(function (a, b) { return b.id - a.id; })); }; c.onerror = function () { ok(out); }; }); }); }
  function idbPut(row) { return idb().then(function (db) { return new Promise(function (ok) { var tx = db.transaction("v", "readwrite"); tx.objectStore("v").add(row); tx.oncomplete = function () { ok(); }; tx.onerror = function () { ok(); }; }); }).then(function () { return idbAll(row.project_id); }).then(function (L) { if (L.length <= 40) return; return idb().then(function (db) { var tx = db.transaction("v", "readwrite"); L.slice(40).forEach(function (x) { tx.objectStore("v").delete(x.id); }); }); }); }
  function verSnap(p, label) {
    var R = RB(); if (!p || !p._real || !R.veStateOf) return Promise.resolve();
    VER.last = Date.now();
    var row = { project_id: p._real.id, workspace_id: R.ws, state: R.veStateOf(p), label: label || null, clips: p.v1.length + p.m.length + p.t.length + p.a.length, created_at: new Date().toISOString() };
    var local = function () { VER.table = false; return idbPut(row); };
    return (VER.table ? api("/rest/v1/video_editor_versions", { method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ project_id: row.project_id, workspace_id: row.workspace_id, state: row.state, label: row.label, clips: row.clips }) })
      .then(function () { if (++VER.n % 8 === 0) return api("/rest/v1/video_editor_versions?project_id=eq." + encodeURIComponent(row.project_id) + "&select=id&order=created_at.desc&offset=40&limit=200").then(function (old) { if (old && old.length) return api("/rest/v1/video_editor_versions?id=in.(" + old.map(function (x) { return x.id; }).join(",") + ")", { method: "DELETE" }); }).catch(function () {}); }, local) : local())
      .then(function () { VER.list = null; if (!VE.sel) verRefresh(); });
  }
  RB().veAfterSave = function (p, label, force) { if (force || Date.now() - VER.last > 90000) return verSnap(p, label || ""); };
  function verLoad(pid) {
    if (VER.table) return api("/rest/v1/video_editor_versions?project_id=eq." + encodeURIComponent(pid) + "&select=id,label,clips,created_at&order=created_at.desc&limit=40").then(function (r) { return (r || []).map(function (x) { return { id: "t:" + x.id, label: x.label, clips: x.clips, at: x.created_at }; }); }, function () { VER.table = false; return verLoad(pid); });
    return idbAll(pid).then(function (L) { return L.map(function (x) { return { id: "l:" + x.id, label: x.label, clips: x.clips, at: x.created_at }; }); }, function () { return []; });
  }
  function ago(iso) { var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000); return s < 60 ? "hace un momento" : s < 3600 ? "hace " + Math.round(s / 60) + " min" : s < 86400 ? "hace " + Math.round(s / 3600) + " h" : new Date(iso).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
  function verHtml() {
    var p = VE.p, now = p.v1.length + p.m.length + p.t.length + p.a.length;
    if (!VER.list) return '<div class="ed-note">Cargando versiones…</div>';
    if (!VER.list.length) return '<div class="ed-note">Todavía no hay versiones: se guarda una al guardar (cada 90 s como máximo) y cada vez que tocas «Guardar».</div>';
    return VER.list.map(function (v) { var d = (v.clips || 0) - now; return '<div style="display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid #222"><span style="flex:1;min-width:0;font-size:11.5px"><b>' + esc(ago(v.at)) + "</b>" + (v.label ? " · " + esc(v.label) : "") + '<br><small style="opacity:.7">' + (v.clips || 0) + " clips" + (d ? " (" + (d > 0 ? "+" : "") + d + " respecto de ahora)" : "") + '</small></span><button data-vrest="' + esc(v.id) + '" style="flex:none">Restaurar</button></div>'; }).join("");
  }
  function verRefresh() { var p = VE.p; if (!p || !p._real) return; VER.pid = p._real.id; verLoad(VER.pid).then(function (L) { VER.list = L; var el = vq("#veVerList"); if (el) el.innerHTML = verHtml(); }); }
  function verSec() {
    var p = VE.p; if (!p || !p._real) return "";
    if (VER.pid !== p._real.id || !VER.list) { VER.list = null; setTimeout(verRefresh, 0); }
    return sec("Historial de versiones", '<div class="ed-note" style="grid-column:1/-1">Fotos completas del proyecto. «Restaurar» vuelve a esa versión (antes guarda la actual, así puedes volver).' + (VER.table ? "" : " Se guardan en este navegador.") + "</div>"
      + '<label class="ef full"><span>Nombre (opcional)</span><input data-vlabel="1" placeholder="Ej.: antes de cambiar el anillo"></label><div class="ed-row"><button data-vsnap="1">Guardar versión ahora</button></div>'
      + '<div id="veVerList" style="grid-column:1/-1;max-height:240px;overflow:auto">' + verHtml() + "</div>", false);
  }
  vq("#veInsp").addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-vsnap],[data-vrest]"); if (!b || !VE.p || !VE.p._real) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (b.dataset.vsnap) { var li = vq("#veInsp [data-vlabel]"), lab = li && li.value.trim() || "Versión guardada a mano"; b.disabled = true; return verSnap(VE.p, lab).then(function () { b.disabled = false; if (li) li.value = ""; toast("Versión guardada"); }); }
    var id = b.dataset.vrest, p = VE.p;
    var get = id.indexOf("t:") === 0 ? api("/rest/v1/video_editor_versions?id=eq." + encodeURIComponent(id.slice(2)) + "&select=state").then(function (r) { return r && r[0] && r[0].state; })
      : idbAll(p._real.id).then(function (L) { var x = L.find(function (y) { return "l:" + y.id === id; }); return x && x.state; });
    var go = function () {
      toast("Restaurando la versión…");
      return verSnap(p, "Antes de restaurar").then(function () { return get; }).then(function (st) { if (!st) throw new Error("no encontré esa versión"); return RB().veRestoreState(st); })
        .then(function () { setTimeout(function () { toast("Versión restaurada"); }, 600); }, function (x) { toast("No se pudo restaurar: " + (x && x.message || x)); });
    };
    var R = RB(); if (R.confirmBox) R.confirmBox("¿Volver a esta versión? La actual queda guardada en el historial.", { title: "Restaurar versión", ok: "Restaurar", action: "ve-restore" }).then(function (ok) { if (ok) go(); }); else go();
  }, true);

  /* ── las secciones nuevas en el inspector ── */
  var _proSecs = proSections;
  proSections = function (o, tr) {
    var h = _proSecs.apply(this, arguments);
    var extra = graphSec(o)
      + sec("Desenfoque de movimiento", '<label class="ef full"><span>Intensidad % (0 = apagado)</span><input type="number" step="5" data-pk="mbA" value="' + (+o.mbA || 0) + '"></label><div class="ed-note" style="grid-column:1/-1">Sale de la velocidad real del clip en cada cuadro: más rápido, más desenfoque. También en el video exportado.</div>', +o.mbA > 0)
      + (o.grp ? sec("Grupo como objeto · " + grpOf(o).length + " clips", gkBody(o.grp, "Mueve, escala, gira o funde todo el grupo (como una precomposición) sin tocar la animación de cada clip."), !!(VE.p.gtr && VE.p.gtr[o.grp])) : "")
      + presSec(o, tr) + brandSec(o, tr);
    return h + extra;
  };
  function projSecs() {
    return sec("Cámara animada (zoom y paneo de todo el video)", gkBody("__cam", "Un keyframe de cámara mueve, acerca o gira TODO el video a la vez."), !!(VE.p.gtr && VE.p.gtr.__cam)) + verSec();
  }
  vq("#veInsp").addEventListener("input", function (e) {
    if (!e.target.dataset || e.target.dataset.pk !== "mbA") return; var o = objSel(); if (!o) return;
    if (gPend) { vsnap(); gPend = false; }
    var v = parseFloat(e.target.value); if (v > 0) o.mbA = cl(v, 0, 200); else delete o.mbA; veStage();
  });


  /* ═════ QA Instinct v16 · wishlist MEDIA y BAJA: máscaras y recorte con otro clip, capas de ajuste con color animado,
     expresiones, audio (onda real, volumen con keyframes, ducking), exportar en varios formatos y GIF, ver qué edita cada
     persona, subtítulos en el navegador, marcadores con comentarios, seguimiento de un punto y estabilización ═════ */

  /* ── máscaras: forma + revelado animado (vista previa con clip-path; exportación con la misma geometría) ── */
  var MSH = [["circle", "Círculo"], ["rect", "Rectángulo"], ["rounded", "Redondeado"], ["diamond", "Rombo"], ["triangle", "Triángulo"], ["hexagon", "Hexágono"], ["star", "Estrella"]];
  var POLY = { rect: [[0, 0], [100, 0], [100, 100], [0, 100]], diamond: [[50, 0], [100, 50], [50, 100], [0, 50]], triangle: [[50, 0], [100, 100], [0, 100]], hexagon: [[25, 0], [75, 0], [100, 50], [75, 100], [25, 100], [0, 50]] };
  (function () { var pts = []; for (var i = 0; i < 10; i++) { var rr = i % 2 ? 20 : 50, a = (i * 36 - 90) * Math.PI / 180; pts.push([50 + rr * Math.cos(a), 52 + rr * Math.sin(a)]); } POLY.star = pts; })();
  function maskQ(m, lt) { var rv = +m.rv || 0; if (!(rv > 0)) return 1; var u = cl((lt - (+m.rf || 0)) / rv, 0, 1); return u * u * (3 - 2 * u); }
  function maskSpec(c, lt) { var m = c.mask; if (!m || !m.shape) return null; var s = cl((m.size != null ? +m.size : 100) / 100 * maskQ(m, lt), 0, 3); return { m: m, s: s, x: m.x != null ? +m.x : 50, y: m.y != null ? +m.y : 50 }; }
  function maskCssOf(c, lt) {
    var q = maskSpec(c, lt); if (!q) return "";
    var r2 = function (v) { return Math.round(v * 100) / 100; };
    if (q.m.shape === "circle") return "circle(" + r2(50 * q.s) + "% at " + q.x + "% " + q.y + "%)";
    if (q.m.shape === "rounded") return "inset(" + r2(q.y - 50 * q.s) + "% " + r2(100 - (q.x + 50 * q.s)) + "% " + r2(100 - (q.y + 50 * q.s)) + "% " + r2(q.x - 50 * q.s) + "% round 12%)";
    var P = POLY[q.m.shape] || POLY.rect;
    return "polygon(" + P.map(function (p) { return r2(q.x + (p[0] - 50) * q.s) + "% " + r2(q.y + (p[1] - 50) * q.s) + "%"; }).join(",") + ")";
  }
  function maskPath(g, c, t, w, h) {
    var q = maskSpec(c, t - c.start); if (!q) return;
    var cx = (q.x - 50) / 100 * w, cy = (q.y - 50) / 100 * h;
    g.beginPath();
    if (q.m.shape === "circle") { g.arc(cx, cy, Math.max(0.1, 0.5 * q.s * Math.sqrt((w * w + h * h) / 2)), 0, Math.PI * 2); return; }
    if (q.m.shape === "rounded") { var rw = w * q.s, rh = h * q.s, rr = Math.min(rw, rh) * 0.12, x0 = cx - rw / 2, y0 = cy - rh / 2; g.moveTo(x0 + rr, y0); g.arcTo(x0 + rw, y0, x0 + rw, y0 + rh, rr); g.arcTo(x0 + rw, y0 + rh, x0, y0 + rh, rr); g.arcTo(x0, y0 + rh, x0, y0, rr); g.arcTo(x0, y0, x0 + rw, y0, rr); g.closePath(); return; }
    (POLY[q.m.shape] || POLY.rect).forEach(function (p, i) { var px = cx + (p[0] - 50) / 100 * w * q.s, py = cy + (p[1] - 50) / 100 * h * q.s; if (i) g.lineTo(px, py); else g.moveTo(px, py); }); g.closePath();
  }
  /* recorte con otro clip (track matte): la imagen de ese clip, en su lugar del video, recorta a este */
  function matteCss(c, t, kind) {
    if (!c.matte || !VE.p) return "";
    var M = (VE.p.m || []).find(function (x) { return x.id === c.matte; }); if (!M || !(t >= M.start && t < M.start + M.dur)) return "visibility:hidden;";
    var u = (String(bgOf(M) || "").match(/url\(["']?([^"')]+)["']?\)/) || [])[1]; if (!u) return "";
    var W = W0(), H = H0(), sm = state(M, t, "m"), sc = state(c, t, kind), mw = W * (M.w || 40) / 100 * sm.s, mh = W * (M.w || 40) / 100 / (M.ar || 1) * sm.s;
    var mx = W * M.x / 100 + sm.dx - mw / 2, my = H * M.y / 100 + sm.dy - mh / 2;
    var tw = kind === "m" ? W * (c.w || 40) / 100 : textW(c), th = kind === "m" ? tw / (c.ar || 1) : fitSize(c, W) * 1.1 * String(c.text || "").split("\n").length;
    var tx = W * c.x / 100 + sc.dx - tw * sc.s / 2, ty = H * c.y / 100 + sc.dy - th * sc.s / 2, s = sc.s || 1;
    var pos = r1((mx - tx) / s) + "px " + r1((my - ty) / s) + "px", size = r1(mw / s) + "px " + r1(mh / s) + "px";
    return "-webkit-mask-image:url('" + u + "');mask-image:url('" + u + "');-webkit-mask-size:" + size + ";mask-size:" + size + ";-webkit-mask-position:" + pos + ";mask-position:" + pos + ";-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;";
  }
  /* ── capa de ajuste: un filtro sobre todo lo que está debajo; con «hasta» el color se anima a lo largo del clip ── */
  var ADJ0 = { bl: 0, br: 100, ct: 100, sa: 100, hu: 0, se: 0, gr: 0 };
  function adjVals(c, lt) {
    var A = Object.assign({}, ADJ0, c.adj && c.adj.a || {}), B = c.adj && c.adj.b; if (!B) return A;
    var u = cl(lt / (c.dur || 1), 0, 1), o = {}; Object.keys(ADJ0).forEach(function (k) { var b = B[k] != null ? +B[k] : A[k]; o[k] = A[k] + (b - A[k]) * u; }); return o;
  }
  function adjFilter(c, lt, k) {
    var v = adjVals(c, lt), f = [];
    if (v.bl > 0.01) f.push("blur(" + r1(v.bl * (k || 1)) + "px)"); if (Math.abs(v.br - 100) > 0.1) f.push("brightness(" + r1(v.br) + "%)"); if (Math.abs(v.ct - 100) > 0.1) f.push("contrast(" + r1(v.ct) + "%)");
    if (Math.abs(v.sa - 100) > 0.1) f.push("saturate(" + r1(v.sa) + "%)"); if (Math.abs(v.hu) > 0.1) f.push("hue-rotate(" + r1(v.hu) + "deg)"); if (v.se > 0.1) f.push("sepia(" + r1(v.se) + "%)"); if (v.gr > 0.1) f.push("grayscale(" + r1(v.gr) + "%)");
    return f.join(" ");
  }
  function adjHTML(c, t) {
    var st = state(c, t, "m"), f = adjFilter(c, t - c.start, 1), sel = VE.sel && VE.sel.tr === "m" && VE.p && VE.p.m[VE.sel.i] === c;
    return '<div class="ve-media ve-adj" data-mi="' + (VE.p ? VE.p.m.indexOf(c) : -1) + '" style="left:50%;top:50%;width:100%;height:100%;aspect-ratio:auto;background:transparent;transform:translate(-50%,-50%);'
      + "-webkit-backdrop-filter:" + (f || "none") + ";backdrop-filter:" + (f || "none") + ";opacity:" + r1(cl(st.o, 0, 1)) + ";pointer-events:" + (sel ? "auto" : "none") + (sel ? ";outline:4px dashed #ff5e00;outline-offset:-6px" : "") + '"></div>';
  }
  var _mHtml = mediaHTML;
  mediaHTML = function (c, t) {
    var sel = VE.sel && VE.sel.tr === "m" && VE.p && VE.p.m[VE.sel.i] === c;
    if (c.adj) return adjHTML(c, t);
    if (c.hideM && !sel) return "";
    var h = _mHtml.apply(this, arguments), lt = t - c.start, mk = maskCssOf(c, lt), mt = matteCss(c, t, "m");
    var add = (mk ? "clip-path:" + mk + ";-webkit-clip-path:" + mk + ";" : "") + mt + (c.hideM ? "opacity:.35;outline:3px dashed #ff5e00;" : "");
    return add ? h.replace('style="', 'style="' + add) : h;
  };
  var _cHtml = capHTML;
  capHTML = function (c, t) {
    var h = _cHtml.apply(this, arguments), mk = maskCssOf(c, t - c.start), mt = matteCss(c, t, "t");
    var add = (mk ? "clip-path:" + mk + ";-webkit-clip-path:" + mk + ";" : "") + mt;
    return add ? h.replace('style="', 'style="' + add) : h;
  };

  /* ── expresiones: fórmulas seguras por propiedad (sin JavaScript: un analizador propio) ── */
  var EXC = {};
  function exCompile(src) {
    if (EXC[src]) return EXC[src];
    var s = String(src), i = 0, tk = [];
    while (i < s.length) {
      var ch = s[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (/[0-9.]/.test(ch)) { var j = i; while (j < s.length && /[0-9.eE]/.test(s[j])) j++; tk.push({ n: parseFloat(s.slice(i, j)) }); i = j; continue; }
      if (/[A-Za-z_]/.test(ch)) { var j2 = i; while (j2 < s.length && /[A-Za-z0-9_]/.test(s[j2])) j2++; tk.push({ id: s.slice(i, j2) }); i = j2; continue; }
      if ("+-*/%^(),".indexOf(ch) >= 0) { tk.push({ op: ch }); i++; continue; }
      throw new Error("carácter no válido «" + ch + "»");
    }
    var p = 0, peek = function () { return tk[p]; }, eat = function (op) { if (tk[p] && tk[p].op === op) { p++; return true; } return false; };
    var FN = { sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs, min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil, round: Math.round, sqrt: Math.sqrt, pow: Math.pow, exp: Math.exp, log: Math.log,
      clamp: function (v, a, b) { return Math.min(Math.max(v, a), b); }, linear: function (x, a, b, v0, v1) { return v0 + (v1 - v0) * Math.min(1, Math.max(0, (x - a) / ((b - a) || 1))); },
      ease: function (x, a, b, v0, v1) { var u = Math.min(1, Math.max(0, (x - a) / ((b - a) || 1))); u = u * u * (3 - 2 * u); return v0 + (v1 - v0) * u; } };
    var expr, prim = function () {
      var t = tk[p++]; if (!t) throw new Error("fórmula incompleta");
      if (t.n != null) return function () { return t.n; };
      if (t.op === "(") { var e = expr(); if (!eat(")")) throw new Error("falta «)»"); return e; }
      if (t.op === "-") { var u = unary(); return function (E) { return -u(E); }; }
      if (t.op === "+") return unary();
      if (t.id) {
        var id = t.id;
        if (eat("(")) {
          var args = []; if (!eat(")")) { do { args.push(expr()); } while (eat(",")); if (!eat(")")) throw new Error("falta «)»"); }
          if (id === "wiggle") return function (E) { return E.value + E.wiggle(args[0] ? args[0](E) : 1, args[1] ? args[1](E) : 10); };
          if (id === "noise") return function (E) { return E.noise(args[0] ? args[0](E) : E.time); };
          if (id === "random") return function (E) { return E.rnd(args[0] ? args[0](E) : 0); };
          if (id === "loopOut" || id === "loop") return function (E) { return E.loop(); };
          if (!FN[id]) throw new Error("función desconocida «" + id + "»");
          var f = FN[id]; return function (E) { return f.apply(null, args.map(function (a) { return a(E); })); };
        }
        if (id === "PI") return function () { return Math.PI; };
        if (["value", "time", "t", "index", "dur"].indexOf(id) < 0) throw new Error("variable desconocida «" + id + "»");
        return function (E) { return E[id]; };
      }
      throw new Error("fórmula no válida");
    };
    var unary = function () { if (eat("-")) { var u = unary(); return function (E) { return -u(E); }; } if (eat("+")) return unary(); return power(); };
    var power = function () { var b = prim(); if (eat("^")) { var e = unary(); return function (E) { return Math.pow(b(E), e(E)); }; } return b; };
    var term = function () { var a = unary(); for (;;) { var o = peek(); if (!o || "*/%".indexOf(o.op) < 0 || !o.op) return a; p++; var b = unary(), A = a, op = o.op; a = op === "*" ? function (E) { return A(E) * b(E); } : op === "/" ? function (E) { var d = b(E); return d ? A(E) / d : 0; } : function (E) { var d = b(E); return d ? A(E) % d : 0; }; } };
    expr = function () { var a = term(); for (;;) { var o = peek(); if (!o || (o.op !== "+" && o.op !== "-")) return a; p++; var b = term(), A = a, op = o.op; a = op === "+" ? function (E) { return A(E) + b(E); } : function (E) { return A(E) - b(E); }; } };
    var root = expr(); if (p < tk.length) throw new Error("sobra algo al final");
    return EXC[src] = root;
  }
  function nz(x, seed) { var a = Math.sin(x * 1.3 + seed) * 0.5 + Math.sin(x * 2.1 + seed * 1.7) * 0.3 + Math.sin(x * 4.7 + seed * 2.3) * 0.2; return a; }
  var EXMAP = { x: "dx", y: "dy", s: "s", r: "r", o: "o" };
  function exprFx(c, t, kind, st) {
    if (!c.expr) return;
    var lt = t - c.start, idx = VE.p ? (VE.p[kind] || []).indexOf(c) : 0;
    Object.keys(EXMAP).forEach(function (pk) {
      var src = c.expr[pk]; if (!src) return; var f; try { f = exCompile(src); } catch (e) { return; }
      var key = EXMAP[pk], seed = hash01(c.id + pk) * 100;
      var E = { value: st[key], time: lt, t: t, index: idx, dur: c.dur,
        wiggle: function (fr, amp) { return amp * nz(lt * fr * 2 * Math.PI / 3, seed); }, noise: function (x) { return nz(x, seed); }, rnd: function (sd) { return hash01(c.id + pk + sd); },
        loop: function () { var kf = c.kf; if (!kf || kf.length < 2) return st[key]; var T = kf[kf.length - 1].t, k1 = sampleK(c, lt)[pk === "x" ? "x" : pk === "y" ? "y" : pk], k2 = sampleK(c, kf[0].t + ((lt - kf[0].t) % (T - kf[0].t) + (T - kf[0].t)) % (T - kf[0].t))[pk === "x" ? "x" : pk === "y" ? "y" : pk]; return pk === "s" || pk === "o" ? st[key] / (k1 || 1) * k2 : st[key] - k1 + k2; } };
      var v = f(E); if (isFinite(v)) st[key] = pk === "o" ? cl(v, 0, 1) : v;
    });
  }

  /* ── audio: volumen con keyframes y ducking (se usan al reproducir y al exportar) ── */
  function volAt(c, lt) {
    var K = c.volk; if (!K || !K.length) return 1;
    if (lt <= K[0].t) return +K[0].v; if (lt >= K[K.length - 1].t) return +K[K.length - 1].v;
    for (var i = 1; i < K.length; i++) if (lt < K[i].t) { var a = K[i - 1], b = K[i], u = (lt - a.t) / ((b.t - a.t) || 1); return +a.v + (+b.v - +a.v) * u; }
    return 1;
  }
  function duckAt(p, c, t) {
    var D = c.duck; if (!D || !p) return 1;
    var lvl = cl(D.lvl != null ? +D.lvl : 0.25, 0, 1), fd = Math.max(0.01, D.fade != null ? +D.fade : 0.25), dist = Infinity;
    var voice = (p.a || []).filter(function (x) { return x !== c && !x.duck && x.url && (x.vol == null || x.vol > 0); }).concat((p.v1 || []).filter(function (x) { return x.kind === "take" && (x.vol == null || x.vol > 0) && VTAKES[x.take] && VTAKES[x.take].blob; }));
    voice.forEach(function (x) { var a = x.start, b = x.start + x.dur, d = t < a ? a - t : t > b ? t - b : 0; if (d < dist) dist = d; });
    return dist === Infinity ? 1 : lvl + (1 - lvl) * Math.min(1, dist / fd);
  }
  /* decodificar audio con lo que tenga el navegador (sin OfflineAudioContext se usa AudioContext) */
  var DECAC = null;
  function decodeAny(b, rate) {
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (OAC) return new OAC(1, 2, rate || 44100).decodeAudioData(b);
    var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return Promise.reject(new Error("este navegador no decodifica audio"));
    DECAC = DECAC || new AC(); return new Promise(function (ok, ko) { var r = DECAC.decodeAudioData(b, ok, ko); if (r && r.then) r.then(ok, ko); });
  }
  function gainAt(p, c, t) { return (c.vol != null ? +c.vol : 1) * volAt(c, t - c.start) * duckAt(p, c, t); }
  /* onda real del audio en la línea de tiempo (antes era un dibujo de relleno) */
  var WAVE = {};
  function peaksOf(url) {
    if (WAVE[url]) return WAVE[url];
    return WAVE[url] = fetch(url, { mode: "cors" }).then(function (r) { return r.arrayBuffer(); }).then(function (b) {
      return decodeAny(b);
    }).then(function (buf) {
      var d = buf.getChannelData(0), n = 2000, step = Math.max(1, Math.floor(d.length / n)), out = new Float32Array(n), mx = 0;
      for (var i = 0; i < n; i++) { var m = 0; for (var j = i * step, e = Math.min(d.length, j + step); j < e; j += 4) { var v = Math.abs(d[j]); if (v > m) m = v; } out[i] = m; if (m > mx) mx = m; }
      for (var k = 0; k < n; k++) out[k] = mx ? out[k] / mx : 0;
      return { pk: out, dur: buf.duration };
    }).catch(function () { return null; });
  }
  function paintWaves() {
    if (!VE.p) return;
    [].forEach.call(document.querySelectorAll('#veLanes .ve-clip[data-tr="a"]'), function (el) {
      var c = VE.p.a[+el.dataset.i]; if (!c || !c.url) return; var sv = el.querySelector(".ve-wave"); if (!sv) return;
      var w = Math.max(4, el.offsetWidth), n = Math.max(8, Math.min(600, Math.round(w / 3)));
      peaksOf(c.url).then(function (P) {
        if (!P || !sv.isConnected) return; var a = (c.in || 0) / P.dur, b = ((c.in || 0) + c.dur) / P.dur, h = "";
        for (var i = 0; i < n; i++) { var f = a + (b - a) * (i + 0.5) / n, v = f >= 1 ? 0 : P.pk[Math.min(P.pk.length - 1, Math.floor(f * P.pk.length))] * 100 * cl(volAt(c, c.dur * (i + 0.5) / n), 0, 1.5) * (c.vol != null ? +c.vol : 1); h += '<rect x="' + (i + 0.15) + '" y="' + r1((100 - v) / 2) + '" width=".7" height="' + r1(Math.max(1, v)) + '"/>'; }
        sv.setAttribute("viewBox", "0 0 " + n + " 100"); sv.innerHTML = h; sv.dataset.real = "1";
      });
    });
  }

  /* ── subtítulos automáticos en el navegador (Whisper; gratis, sin llave; el modelo se descarga una vez) ── */
  var ASR = null;
  function whisperSubs(url, clipStart, inOff, dur, speed, btn) {
    btn.disabled = true; var txt0 = btn.textContent; btn.textContent = "Cargando el modelo de voz…";
    toast("Cargando el modelo de voz (la primera vez descarga ~40 MB; después queda en el navegador)…");
    var pipeP = ASR || (ASR = import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2").then(function (T) { T.env.allowLocalModels = false; T.env.remoteHost = location.origin + "/hfm/"; T.env.remotePathTemplate = "{model}/resolve/{revision}/"; return T.pipeline("automatic-speech-recognition", "Xenova/whisper-tiny"); }));
    return Promise.all([pipeP, fetch(url, { mode: "cors" }).then(function (r) { return r.arrayBuffer(); }).then(function (b) { return decodeAny(b, 16000); })])
      .then(function (r) {
        var asr = r[0], buf = r[1]; btn.textContent = "Transcribiendo…";
        var AC = window.OfflineAudioContext || window.webkitOfflineAudioContext, mono16;
        if (AC) { var oc = new AC(1, Math.max(1, Math.ceil(buf.duration * 16000)), 16000), src = oc.createBufferSource(); src.buffer = buf; src.connect(oc.destination); src.start(); mono16 = oc.startRendering().then(function (rb) { return rb.getChannelData(0); }); }
        else { var raw = buf.getChannelData(0), ratio = buf.sampleRate / 16000, n16 = Math.floor(raw.length / ratio), o16 = new Float32Array(n16); for (var q = 0; q < n16; q++) o16[q] = raw[Math.floor(q * ratio)]; mono16 = Promise.resolve(o16); }
        return mono16.then(function (d0) { var d = d0, a = Math.floor(inOff * 16000), z = Math.min(d.length, a + Math.ceil(dur * speed * 16000)); return asr(d.slice(a, z), { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 }); });
      }).then(function (out) {
        var ch = (out && out.chunks) || (out && out.text ? [{ timestamp: [0, dur * speed], text: out.text }] : []), p = VE.p, n = 0;
        ch.forEach(function (x) {
          var s0 = x.timestamp && x.timestamp[0] != null ? x.timestamp[0] : 0, s1 = x.timestamp && x.timestamp[1] != null ? x.timestamp[1] : s0 + 2, tx = String(x.text || "").trim(); if (!tx) return;
          if (!n) vsnap(); n++;
          p.t.push(cap(tx, r1(clipStart + s0 / speed), r1(Math.max(0.6, (s1 - s0) / speed)), { y: 80, size: 54, bg: "#000000aa", anim: "fade", weight: 700 }));
        });
        veAll(); veInsp(); toast(n ? n + " subtítulos creados desde la voz" : "No se reconoció voz en ese audio");
      }).catch(function (e) { toast("Subtítulos: " + String(e && e.message || e).slice(0, 160)); })
      .then(function () { btn.disabled = false; btn.textContent = txt0; });
  }

  /* ── seguimiento de un punto (tracking) y estabilización: comparación de parches entre cuadros del video de V1 ── */
  var TRK = null;
  function takeAt(t) { return (VE.p.v1 || []).find(function (x) { return x.kind === "take" && t >= x.start && t < x.start + x.dur && VTAKES[x.take] && VTAKES[x.take].blob; }); }
  function trackRun(take, t0, t1, sx, sy, prog) {
    var tk = VTAKES[take.take], v = document.createElement("video"); v.crossOrigin = "anonymous"; v.muted = true; v.playsInline = true; v.preload = "auto";
    v.style.cssText = "position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0"; document.body.appendChild(v);
    var W = W0(), H = H0(), AW = 320, out = [];
    var seek = function (tt) { return new Promise(function (ok) { var done = false, f = function () { if (!done) { done = true; v.removeEventListener("seeked", f); ok(); } }; v.addEventListener("seeked", f); try { v.currentTime = tt; } catch (e) { f(); } setTimeout(f, 2500); }); };
    return new Promise(function (ok, ko) { v.onloadeddata = ok; v.onerror = function () { ko(new Error("no se pudo abrir el video")); }; v.src = tk.blob; v.load(); setTimeout(function () { ko(new Error("el video tardó demasiado en cargar")); }, 20000); }).then(function () {
      var vw = v.videoWidth, vh = v.videoHeight, AH = Math.round(vh * AW / vw), cv = document.createElement("canvas"); cv.width = AW; cv.height = AH; var g = cv.getContext("2d", { willReadFrequently: true });
      var s = (take.fit === "contain" ? Math.min : Math.max)(W / vw, H / vh), ox = (W - vw * s) / 2, oy = (H - vh * s) / 2, k = AW / vw;
      var toA = function (x, y) { return [((x - ox) / s) * k, ((y - oy) / s) * k]; }, toS = function (x, y) { return [ox + x / k * s, oy + y / k * s]; };
      var gray = function () { g.drawImage(v, 0, 0, AW, AH); var d = g.getImageData(0, 0, AW, AH).data, o = new Float32Array(AW * AH); for (var i = 0, j = 0; i < d.length; i += 4, j++) o[j] = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; return o; };
      var R = 10, SR = 22, tpl = null, pos = toA(sx, sy), times = []; for (var tt = t0; tt <= t1 + 1e-6; tt += 1 / 15) times.push(tt);
      var step = function (i) {
        if (i >= times.length) return out;
        var tt = times[i], srcT = (take.in || 0) + (tt - take.start) * (take.speed || 1);
        return seek(srcT).then(function () {
          var G = gray(), cx = Math.round(pos[0]), cy = Math.round(pos[1]);
          if (!tpl) {
            tpl = new Float32Array((2 * R + 1) * (2 * R + 1)); for (var y = -R, n = 0; y <= R; y++) for (var x = -R; x <= R; x++, n++) tpl[n] = G[cl(cy + y, 0, AH - 1) * AW + cl(cx + x, 0, AW - 1)];
            /* un punto sin detalle (cielo, pared lisa) no se puede seguir: se pide otro */
            var mu = 0, va = 0; for (var q = 0; q < tpl.length; q++) mu += tpl[q]; mu /= tpl.length; for (var q2 = 0; q2 < tpl.length; q2++) va += (tpl[q2] - mu) * (tpl[q2] - mu);
            if (Math.sqrt(va / tpl.length) < 6) throw new Error("ese punto no tiene detalle: elige una esquina, un borde o un objeto con contraste");
          } else {
            var best = Infinity, bx = cx, by = cy, scores = [];
            for (var dy = -SR; dy <= SR; dy++) for (var dx = -SR; dx <= SR; dx++) {
              var px = cx + dx, py = cy + dy; if (px - R < 0 || py - R < 0 || px + R >= AW || py + R >= AH) continue;
              var sad = 0; for (var yy = -R, m = 0; yy <= R; yy++) for (var xx = -R; xx <= R; xx++, m++) { var df = G[(py + yy) * AW + px + xx] - tpl[m]; sad += df < 0 ? -df : df; }
              scores.push([sad, px, py]); if (sad < best) { best = sad; bx = px; by = py; }
            }
            /* ambiguo (otra posición lejana encaja casi igual, p. ej. a lo largo de una franja): el punto se queda donde estaba */
            var second = Infinity; scores.forEach(function (sc) { if ((Math.abs(sc[1] - bx) > 3 || Math.abs(sc[2] - by) > 3) && sc[0] < second) second = sc[0]; });
            if (!(second < best * 1.15 + 1)) pos = [bx, by];
            var ux = Math.round(pos[0]), uy = Math.round(pos[1]);
            for (var y2 = -R, n2 = 0; y2 <= R; y2++) for (var x2 = -R; x2 <= R; x2++, n2++) tpl[n2] = tpl[n2] * 0.8 + G[cl(uy + y2, 0, AH - 1) * AW + cl(ux + x2, 0, AW - 1)] * 0.2;
          }
          var sp = toS(pos[0], pos[1]); out.push([tt, sp[0], sp[1]]); if (prog) prog(i / times.length);
          return step(i + 1);
        });
      };
      return step(0);
    }).then(function (r) { v.remove(); return r; }, function (e) { v.remove(); throw /insecure|tainted|SecurityError/i.test(String(e && (e.message || e.name))) ? new Error("este navegador no deja leer los cuadros del video (Safari); usa Chrome o Edge") : e; });
  }
  function stabAt(c, lt) {
    var S = c && c.stab; if (!S || !S.pts || S.pts.length < 2) return null;
    var P = S.pts, x = 0, y = 0;
    if (lt <= P[0][0]) { x = P[0][1]; y = P[0][2]; } else if (lt >= P[P.length - 1][0]) { x = P[P.length - 1][1]; y = P[P.length - 1][2]; }
    else for (var i = 1; i < P.length; i++) if (lt < P[i][0]) { var a = P[i - 1], b = P[i], u = (lt - a[0]) / ((b[0] - a[0]) || 1); x = a[1] + (b[1] - a[1]) * u; y = a[2] + (b[2] - a[2]) * u; break; }
    return { x: x, y: y, z: 1 + (S.zoom != null ? +S.zoom : 8) / 100 };
  }
  /* estabilizar en la vista previa: el cuadro dibujado se corre al revés */
  var _drawVid = veDrawVid;
  veDrawVid = function (canvas) {
    var r = _drawVid.apply(this, arguments), c = VE.p && VE.p.v1.find(function (x) { return x.id === canvas.dataset.vid; }), o = c && stabAt(c, VE.t - c.start);
    if (!o) return r;
    var tmp = document.createElement("canvas"); tmp.width = canvas.width; tmp.height = canvas.height; tmp.getContext("2d").drawImage(canvas, 0, 0);
    var g = canvas.getContext("2d"), W = canvas.width, H = canvas.height, k = W / W0();
    g.save(); g.clearRect(0, 0, W, H); g.translate(W / 2, H / 2); g.scale(o.z, o.z); g.translate(-W / 2 - o.x * k, -H / 2 - o.y * k); g.drawImage(tmp, 0, 0); g.restore();
    return r;
  };
  /* elegir el punto: el siguiente clic en el video */
  document.addEventListener("pointerdown", function (e) {
    if (!TRK) return; var pt = stagePt(e); if (!pt) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var job = TRK; TRK = null; var take = job.take, t0 = job.t0, t1 = job.t1;
    toast("Siguiendo el punto… (no muevas el playhead)");
    trackRun(take, t0, t1, pt.x, pt.y, function (u) { var b = vq('#veInsp [data-trk]'); if (b) b.textContent = "Siguiendo… " + Math.round(u * 100) + "%"; }).then(function (P) {
      if (!P || P.length < 2) throw new Error("no salió ningún recorrido");
      vsnap(); var x0 = P[0][1], y0 = P[0][2];
      if (job.kind === "stab") { take.stab = { pts: P.map(function (q) { return [r1(q[0] - take.start), r1(q[1] - x0), r1(q[2] - y0)]; }), zoom: 8 }; toast("Video estabilizado (se acerca un 8 % para que no se vean bordes)"); }
      else {
        var o = job.o, S = simplifyKf(P.map(function (q) { return { t: r1(q[0] - o.start), x: q[1] - x0, y: q[2] - y0, a: 0 }; }), 1.5);
        o.x = r1(x0 / W0() * 100); o.y = r1(y0 / H0() * 100);
        o.kf = S.map(function (q) { var base = sampleK(o, q.t); return { t: q.t, x: r1(q.x), y: r1(q.y), z: base.z || 0, s: base.s != null ? base.s : 1, r: base.r || 0, o: base.o != null ? base.o : 1, e: "lin" }; });
        toast("El clip sigue el punto del video (" + o.kf.length + " keyframes)");
      }
      veAll(); veInsp();
    }).catch(function (x) { toast("Seguimiento: " + (x && x.message || x)); veInsp(); });
  }, true);

  /* ── marcadores y comentarios en la línea de tiempo ── */
  function meName() { var C = window.__musaCollabState; return C && C.me && C.me.name || "Tú"; }
  function addMarker(text) { var p = VE.p; if (!p) return; vsnap(); p.markers = (p.markers || []).concat([{ id: "mk" + Date.now().toString(36), t: r1(VE.t), text: text || "", by: meName() }]).sort(function (a, b) { return a.t - b.t; }); veAll(); if (!VE.sel) veInsp(); toast("Marcador en " + fmtT(VE.t) + " (tecla M)"); }
  function paintMarkers() {
    var ru = vq("#veLanes .ve-ruler"), p = VE.p; if (!ru || !p) return;
    [].forEach.call(ru.querySelectorAll(".ve-mk"), function (n) { n.remove(); });
    (p.markers || []).forEach(function (m, i) { ru.insertAdjacentHTML("beforeend", '<i class="ve-mk" data-mk="' + i + '" role="button" tabindex="0" title="' + esc(fmtT(m.t) + (m.text ? " · " + m.text : "") + (m.by ? " (" + m.by + ")" : "")) + '" aria-label="Marcador ' + esc(fmtT(m.t)) + '" style="position:absolute;top:2px;left:' + r1(m.t * VE.pps - 6) + 'px;width:12px;height:12px;background:' + (m.text ? "#ffb27a" : "#ff5e00") + ';transform:rotate(45deg);border-radius:2px;cursor:pointer;z-index:3"></i>'); });
  }
  vq("#veLanes").addEventListener("pointerdown", function (e) {
    var mk = e.target.closest && e.target.closest(".ve-mk"); if (!mk || !VE.p) return;
    e.preventDefault(); e.stopImmediatePropagation(); var m = VE.p.markers[+mk.dataset.mk]; if (!m) return;
    VE.t = m.t; VE.sel = null; veAll(); veInsp();
    setTimeout(function () { var d = [].find.call(document.querySelectorAll("#veInsp summary"), function (s) { return /^Marcadores/.test(s.textContent); }); if (d) { d.parentElement.open = true; d.scrollIntoView({ block: "start" }); } }, 30);
  }, true);
  document.addEventListener("keydown", function (e) {
    if (!VE.open || e.ctrlKey || e.metaKey || e.altKey || (e.key !== "m" && e.key !== "M")) return;
    var a = document.activeElement; if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;
    e.preventDefault(); addMarker("");
  });
  function markSec() {
    var p = VE.p, L = p.markers || [];
    return sec("Marcadores y comentarios" + (L.length ? " · " + L.length : ""), '<div class="ed-note" style="grid-column:1/-1">Marca momentos (tecla M o el botón) y deja un comentario para tu equipo. Los clips se imantan a los marcadores.</div>'
      + '<div class="ed-row"><button data-mka="add">Marcador en ' + fmtT(VE.t) + "</button></div>"
      + L.map(function (m, i) { return '<div style="grid-column:1/-1;display:flex;gap:6px;align-items:center"><button data-mka="go" data-i="' + i + '" style="flex:none">' + fmtT(m.t) + '</button><input data-mkt="' + i + '" value="' + esc(m.text || "") + '" placeholder="Comentario" aria-label="Comentario del marcador ' + esc(fmtT(m.t)) + '" style="flex:1;min-width:0"><small style="opacity:.6;flex:none">' + esc(m.by || "") + '</small><button data-mka="del" data-i="' + i + '" aria-label="Borrar marcador" style="flex:none">×</button></div>'; }).join(""), !!L.length);
  }
  vq("#veInsp").addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-mka]"); if (!b || !VE.p) return;
    e.preventDefault(); e.stopImmediatePropagation(); var a = b.dataset.mka, L = VE.p.markers || [], i = +b.dataset.i;
    if (a === "add") return addMarker("");
    if (a === "go" && L[i]) { VE.t = L[i].t; veAll(); return veInsp(); }
    if (a === "del" && L[i]) { vsnap(); L.splice(i, 1); veAll(); return veInsp(); }
  }, true);
  vq("#veInsp").addEventListener("input", function (e) { var i = e.target.dataset && e.target.dataset.mkt; if (i == null || !VE.p || !VE.p.markers) return; var m = VE.p.markers[+i]; if (m) { m.text = e.target.value; m.by = meName(); } });

  /* ── colaborativo: qué clip está editando cada persona (borde de su color en la línea de tiempo) ── */
  var mySel = null;
  function collabVideo() { var C = window.__musaCollabState; return C && C.room && C.roomKey && /^doc:video_/.test(C.roomKey) ? C : null; }
  function paintPeers() {
    var C = collabVideo(); if (!VE.p) return;
    [].forEach.call(document.querySelectorAll("#veLanes .ve-clip"), function (el) {
      var arr = VE.p[el.dataset.tr], c = arr && arr[+el.dataset.i], lk = C && c && C.locks["vclip:" + c.id], peer = lk && lk.from !== C.clientId && C.peers[lk.from];
      if (peer) { el.style.outline = "2px solid " + (peer.color || "#7c5cff"); el.style.outlineOffset = "1px"; el.title = (peer.name || "Alguien") + " está editando este clip"; el.dataset.peer = "1"; }
      else if (el.dataset.peer) { el.style.outline = ""; el.style.outlineOffset = ""; el.removeAttribute("title"); delete el.dataset.peer; }
    });
  }
  var _selCol = veSelect;
  veSelect = function (s) {
    var r = _selCol.apply(this, arguments), C = collabVideo(), send = window.__musaCollabSend;
    if (C && send) {
      var c = s && s.tr && VE.p[s.tr] && VE.p[s.tr][s.i], key = c ? "vclip:" + c.id : null;
      if (mySel && mySel !== key) send({ t: "grab", el: mySel, take: false });
      if (key && key !== mySel) send({ t: "grab", el: key, take: true });
      mySel = key;
    }
    return r;
  };
  setInterval(function () { if (VE.open && collabVideo()) paintPeers(); }, 1200);
  var _tlV16 = veTimeline;
  veTimeline = function () { var r = _tlV16.apply(this, arguments); try { paintMarkers(); paintWaves(); paintPeers(); } catch (e) {} return r; };

  /* ── exportar en varios formatos a la vez y como GIF ── */
  var _veExport = veExport;
  veExport = function () {
    var r = _veExport.apply(this, arguments), box = document.querySelector("#veModal .ve-dlg .ed-sb");
    if (box && !box.querySelector("[data-mbatch]") && RB().veExportBlob) {
      var cur = VE.p && VE.p.fmt;
      box.insertAdjacentHTML("beforeend", '<div class="ed-mh" style="margin-top:12px">Varios formatos a la vez</div><div style="display:flex;gap:10px;flex-wrap:wrap;font-size:12px">'
        + Object.keys(VFMT).map(function (f) { return '<label style="display:flex;gap:4px;align-items:center"><input type="checkbox" data-bfmt="' + f + '"' + (f === cur ? " checked" : "") + ">" + f + "</label>"; }).join("")
        + '<label style="display:flex;gap:4px;align-items:center"><input type="checkbox" data-bgif="1">GIF animado (liviano, 480 px)</label></div>'
        + '<div class="ed-note">Cada formato reacomoda el video (las posiciones son proporcionales). El GIF sale del formato actual.</div><button class="ed-btn" data-mbatch="1">Exportar en lote</button>');
    }
    return r;
  };
  function dl(blob, name) { var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000); }
  function toGif(mp4, fps, maxW, prog) {
    return import("https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.esm.js").then(function (G) {
      var v = document.createElement("video"); v.muted = true; v.playsInline = true; v.style.cssText = "position:fixed;left:-9999px;width:2px;height:2px;opacity:0"; document.body.appendChild(v);
      v.src = URL.createObjectURL(mp4);
      return new Promise(function (ok, ko) { v.onloadeddata = ok; v.onerror = function () { ko(new Error("no se pudo leer el video para el GIF")); }; v.load(); }).then(function () {
        var w = Math.min(maxW, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth), cv = document.createElement("canvas"); cv.width = w; cv.height = h; var g = cv.getContext("2d", { willReadFrequently: true });
        var enc = G.GIFEncoder(), n = Math.max(1, Math.floor(v.duration * fps)), i = 0;
        var seek = function (tt) { return new Promise(function (ok) { var f = function () { v.removeEventListener("seeked", f); ok(); }; v.addEventListener("seeked", f); v.currentTime = tt; setTimeout(f, 2000); }); };
        var next = function () {
          if (i >= n) { enc.finish(); v.remove(); return new Blob([enc.bytes()], { type: "image/gif" }); }
          return seek(Math.min(v.duration - 0.01, i / fps)).then(function () {
            g.drawImage(v, 0, 0, w, h); var d = g.getImageData(0, 0, w, h).data, pal = G.quantize(d, 256), idx = G.applyPalette(d, pal);
            enc.writeFrame(idx, w, h, { palette: pal, delay: Math.round(1000 / fps) }); i++; if (prog) prog(i / n); return next();
          });
        };
        return next();
      });
    });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-mbatch]"); if (!b || !VE.p) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var fm = [].map.call(document.querySelectorAll("#veModal [data-bfmt]:checked"), function (x) { return x.dataset.bfmt; }), gif = !!document.querySelector("#veModal [data-bgif]:checked");
    if (!fm.length && !gif) return toast("Elige al menos un formato");
    var txt = document.querySelector("#veProgT"), bar = document.querySelector("#veProg i"), orig = VE.p, name = (orig.name || "reel").replace(/[\/:*?"<>|]+/g, "-");
    var r = (document.querySelector('#veModal [data-k="r"]') || {}).value || "1080", fps = (document.querySelector('#veModal [data-k="fps"]') || {}).value || orig.fps || 30;
    var prog = function (lab) { return function (k, msg) { if (bar) bar.style.width = (typeof k === "number" ? k : 0) + "%"; if (txt) txt.textContent = lab + " · " + (msg || (k < 100 ? k + "%" : "listo")); }; };
    b.disabled = true; var done = [];
    var one = function (f) {
      /* se exporta una copia con otro formato: el proyecto abierto no cambia ni se guarda con ese formato */
      VE.p = Object.assign({}, orig, { fmt: f });
      return RB().veExportBlob({ f: "mp4", r: r, fps: fps }, prog(f)).then(function (bl) { VE.p = orig; if (bl && bl.size > 1024) { dl(bl, name + " " + f.replace(":", "x") + (/mp4/.test(bl.type) ? ".mp4" : ".webm")); done.push(f); } }, function (x) { VE.p = orig; throw x; });
    };
    fm.reduce(function (pr, f) { return pr.then(function () { return one(f); }); }, Promise.resolve())
      .then(function () {
        if (!gif) return;
        VE.p = Object.assign({}, orig);
        return RB().veExportBlob({ f: "mp4", r: "720", fps: 30 }, prog("GIF (video)")).then(function (bl) { VE.p = orig; return toGif(bl, 12, 480, function (u) { prog("GIF")(Math.round(u * 100)); }); }, function (x) { VE.p = orig; throw x; })
          .then(function (g) { dl(g, name + ".gif"); done.push("GIF"); });
      })
      .then(function () { if (txt) txt.textContent = "Listo: " + done.join(", ") + " descargados."; }, function (x) { VE.p = orig; if (txt) txt.textContent = "No se pudo exportar: " + (x && x.message || x); })
      .then(function () { b.disabled = false; });
  }, true);

  /* ── secciones del inspector ── */
  function maskSec(o, tr) {
    var m = o.mask || {}, on = !!m.shape, others = (VE.p.m || []).filter(function (c) { return c !== o && /url\(/.test(bgOf(c) || "") && !c.adj; });
    return sec("Máscara y recorte", selF("mk.shape", "Forma de la máscara", m.shape || "", [["", "Sin máscara"]].concat(MSH), true)
      + (on ? numM("mk.size", "Tamaño %", m.size != null ? m.size : 100, 1) + numM("mk.x", "Centro X %", m.x != null ? m.x : 50, 1) + numM("mk.y", "Centro Y %", m.y != null ? m.y : 50, 1)
        + numM("mk.rv", "Revelar en (s, 0 = sin animación)", +m.rv || 0, 0.05) + numM("mk.rf", "Revelar desde (s del clip)", +m.rf || 0, 0.05) : "")
      + selF("matte", "Recortar con la forma de otro clip (track matte)", o.matte || "", [["", "No"]].concat(others.map(function (c) { return [c.id, clipLabel("m", c)]; })), true)
      + (o.matte ? '<div class="ed-note" style="grid-column:1/-1">Este clip solo se ve donde está la imagen del otro (su transparencia recorta). El otro deja de verse solo.</div>' : ""), on || !!o.matte);
  }
  function exprSec(o) {
    var ex = o.expr || {}, err = "";
    var f = function (k, l) { var v = ex[k] || "", e = ""; if (v) { try { exCompile(v); } catch (x) { e = x.message; } } if (e) err += "<b>" + l + "</b>: " + esc(e) + ". "; return '<label class="ef full"><span>' + l + '</span><input data-pk="ex.' + k + '" value="' + esc(v) + '" placeholder="ej. wiggle(2, 10)"></label>'; };
    var body = f("x", "Mover X (px)") + f("y", "Mover Y (px)") + f("s", "Escala") + f("r", "Rotación°") + f("o", "Opacidad");
    return sec("Expresiones", '<div class="ed-note" style="grid-column:1/-1">Fórmulas por propiedad: <code>wiggle(2, 10)</code> tiembla 2 veces por segundo 10 px · <code>value + time * 30</code> gira 30°/s · <code>loopOut()</code> repite los keyframes · <code>sin(time*4)*20</code>. Variables: value, time, t, index, dur.</div>' + body
      + (err ? '<div class="ed-note" role="alert" style="grid-column:1/-1;color:#ff8a5c">' + err + "</div>" : ""), !!o.expr);
  }
  function adjSec(o) {
    var A = Object.assign({}, ADJ0, o.adj.a || {}), B = o.adj.b;
    var L = [["bl", "Desenfoque (px)", 0.5], ["br", "Brillo %", 1], ["ct", "Contraste %", 1], ["sa", "Saturación %", 1], ["hu", "Tono°", 1], ["se", "Sepia %", 1], ["gr", "Blanco y negro %", 1]];
    return sec("Capa de ajuste", '<div class="ed-note" style="grid-column:1/-1">Afecta a todo lo que está debajo de ella mientras dura. Con «Animar hasta» el color cambia a lo largo del clip (un grade animado).</div>'
      + L.map(function (x) { return numM("aj.a." + x[0], x[1], A[x[0]], x[2]); }).join("")
      + selF("aj.anim", "Animar hasta otros valores", B ? "1" : "0", [["0", "No"], ["1", "Sí: valores al final del clip"]], true)
      + (B ? L.map(function (x) { return numM("aj.b." + x[0], "Al final · " + x[1], B[x[0]] != null ? B[x[0]] : A[x[0]], x[2]); }).join("") : ""), true);
  }
  function trackSec(o) {
    var tk = takeAt(o.start + 0.01);
    return sec("Seguir un punto del video (tracking)", tk ? '<div class="ed-note" style="grid-column:1/-1">Toca «Elegir el punto» y haz clic en el video sobre lo que quieres seguir: este clip se pega a ese punto mientras dura (keyframes automáticos).</div><div class="ed-row"><button data-trk="follow">' + (TRK && TRK.o === o ? "Haz clic en el video…" : "Elegir el punto y seguirlo") + "</button></div>"
      : '<div class="ed-note" style="grid-column:1/-1">Necesita un video tuyo en V1 debajo de este clip.</div>', false);
  }
  function otherSecs(c, tr) {
    if (tr === "a") {
      var K = c.volk || [], lt = r1(cl(VE.t - c.start, 0, c.dur)), at = K.find(function (x) { return Math.abs(x.t - lt) < 0.02; }), D = c.duck;
      return sec("Volumen en el tiempo" + (K.length ? " · " + K.length + " keyframes" : ""), '<div class="ed-note" style="grid-column:1/-1">Escribe el volumen en el playhead (' + lt.toFixed(2) + ' s del audio): se crea un keyframe. La onda de la línea de tiempo lo muestra.</div>'
        + '<label class="ef full"><span>Volumen % aquí</span><input type="number" step="5" data-ak="vk" value="' + Math.round(volAt(c, lt) * 100) + '"></label>'
        + '<div class="ed-row" style="flex-wrap:wrap">' + (at ? '<button data-aka="vkdel">Borrar este keyframe</button>' : "") + (K.length ? '<button data-aka="vkclear">Quitar los keyframes</button>' : "") + "</div>"
        + K.map(function (x) { return '<button class="ed-li" data-aka="vkgo" data-t="' + x.t + '" style="grid-column:1/-1;padding:3px 0;border:0"><span><b>◆ ' + x.t.toFixed(2) + " s</b><small>" + Math.round(x.v * 100) + " %</small></span></button>"; }).join(""), !!K.length)
        + sec("Bajar la música cuando hay voz (ducking)", selF("ak.duck", "Ducking", D ? "1" : "0", [["0", "No"], ["1", "Sí, bajar cuando suena otro audio o un video"]], true)
          + (D ? '<label class="ef full"><span>Baja a (%)</span><input type="number" step="5" data-ak="dlvl" value="' + Math.round((D.lvl != null ? D.lvl : 0.25) * 100) + '"></label><label class="ef full"><span>Transición (s)</span><input type="number" step="0.05" data-ak="dfade" value="' + (D.fade != null ? D.fade : 0.25) + '"></label>' : ""), !!D)
        + sec("Subtítulos automáticos", '<div class="ed-note" style="grid-column:1/-1">Reconoce la voz de este audio en tu navegador (gratis, sin llave) y crea los textos con sus tiempos.</div><div class="ed-row"><button data-asub="a">Crear subtítulos de este audio</button></div>', false);
    }
    if (tr === "v1" && c.kind === "take") {
      var S = c.stab;
      return sec("Estabilizar", '<div class="ed-note" style="grid-column:1/-1">Elige un punto que debería quedarse quieto (un edificio, un objeto fijo): el video se corre al revés de cómo se movió y se acerca un poco para que no se vean bordes.</div>'
        + '<div class="ed-row" style="flex-wrap:wrap"><button data-trk="stab">' + (TRK && TRK.take === c && TRK.kind === "stab" ? "Haz clic en el video…" : S ? "Volver a estabilizar" : "Elegir el punto fijo") + "</button>" + (S ? '<button data-stb="off">Quitar estabilización</button>' : "") + "</div>"
        + (S ? '<label class="ef full"><span>Acercar para ocultar bordes %</span><input type="number" step="1" data-ak="szoom" value="' + (S.zoom != null ? S.zoom : 8) + '"></label>' : ""), !!S)
        + sec("Subtítulos automáticos (sin llave)", '<div class="ed-note" style="grid-column:1/-1">Reconoce la voz del video en tu navegador, gratis.</div><div class="ed-row"><button data-asub="v1">Crear subtítulos de este video</button></div>', false);
    }
    return "";
  }
  var _proSecs2 = proSections;
  proSections = function (o, tr) {
    if (tr === "m" && o.adj) return adjSec(o) + sec("Duración de la entrada", numM("enD", "Segundos de la entrada", +o.enD > 0 ? o.enD : 0.5, 0.05), false);
    return _proSecs2.apply(this, arguments) + maskSec(o, tr) + exprSec(o) + trackSec(o);
  };
  var _projSecs = projSecs;
  projSecs = function () { return markSec() + _projSecs.apply(this, arguments); };

  /* ── valores de las secciones nuevas ── */
  vq("#veInsp").addEventListener("focusin", function (e) { var d = e.target.dataset || {}; if (d.ak || (d.pk && /^(mk|ex|aj)\./.test(d.pk)) || d.mkt != null) gPend = true; });
  vq("#veInsp").addEventListener("input", function (e) {
    var d = e.target.dataset || {}, v = e.target.value, num = parseFloat(v); if (!VE.p) return;
    var snap = function () { if (gPend) { vsnap(); gPend = false; } };
    if (d.ak) {
      var s = VE.sel, c = s && (s.tr === "a" ? VE.p.a[s.i] : VE.p.v1[s.i]); if (!c) return; snap();
      if (d.ak === "vk" && isFinite(num)) { var lt = r1(cl(VE.t - c.start, 0, c.dur)), K = c.volk = c.volk || [], kk = K.find(function (x) { return Math.abs(x.t - lt) < 0.02; }); if (!kk) { kk = { t: lt, v: 1 }; K.push(kk); K.sort(function (a, b) { return a.t - b.t; }); } kk.v = cl(num / 100, 0, 2); paintWaves(); }
      if (d.ak === "dlvl" && isFinite(num) && c.duck) c.duck.lvl = cl(num / 100, 0, 1);
      if (d.ak === "dfade" && isFinite(num) && c.duck) c.duck.fade = cl(num, 0.01, 5);
      if (d.ak === "szoom" && isFinite(num) && c.stab) c.stab.zoom = cl(num, 0, 60);
      veStage(); return;
    }
    var k = d.pk; if (!k) return; var o = objSel(); if (!o) return;
    if (k === "ak.duck") return;
    if (k.indexOf("mk.") === 0) { snap(); var f = k.slice(3); if (f === "shape") { if (v) o.mask = Object.assign({ size: 100, x: 50, y: 50 }, o.mask || {}, { shape: v }); else delete o.mask; setTimeout(veInsp, 0); } else if (o.mask && isFinite(num)) o.mask[f] = f === "size" ? cl(num, 0, 300) : num; veStage(); return; }
    if (k === "matte") { snap(); var prev = o.matte && (VE.p.m || []).find(function (c) { return c.id === o.matte; }); if (prev && !(VE.p.m || []).concat(VE.p.t || []).some(function (c) { return c !== o && c.matte === prev.id; })) delete prev.hideM; if (v) { o.matte = v; var M = (VE.p.m || []).find(function (c) { return c.id === v; }); if (M) M.hideM = true; } else delete o.matte; veStage(); setTimeout(veInsp, 0); return; }
    if (k.indexOf("ex.") === 0) { snap(); var pk = k.slice(3); o.expr = Object.assign({}, o.expr || {}); if (v.trim()) o.expr[pk] = v; else delete o.expr[pk]; if (!Object.keys(o.expr).length) delete o.expr; veStage(); return; }
    if (k.indexOf("aj.") === 0 && o.adj) { snap(); var parts = k.split("."); if (parts[1] === "anim") { if (v === "1") o.adj.b = Object.assign({}, ADJ0, o.adj.a); else delete o.adj.b; setTimeout(veInsp, 0); } else if (isFinite(num)) { o.adj[parts[1]] = o.adj[parts[1]] || {}; o.adj[parts[1]][parts[2]] = num; } veStage(); return; }
  });
  vq("#veInsp").addEventListener("change", function (e) {
    var d = e.target.dataset || {}; if (d.pk !== "ak.duck" || !VE.p || !VE.sel || VE.sel.tr !== "a") return;
    var c = VE.p.a[VE.sel.i]; if (!c) return; vsnap(); if (e.target.value === "1") c.duck = { lvl: 0.25, fade: 0.25 }; else delete c.duck; veAll(); veInsp();
  });
  vq("#veInsp").addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-aka],[data-asub],[data-trk],[data-stb]"); if (!b || !VE.p) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var s = VE.sel, c = s && (s.tr === "a" ? VE.p.a[s.i] : s.tr === "v1" ? VE.p.v1[s.i] : objSel());
    if (b.dataset.aka) {
      if (!c) return; var a = b.dataset.aka;
      if (a === "vkgo") { VE.t = r1(c.start + +b.dataset.t); veAll(); return veInsp(); }
      vsnap(); if (a === "vkclear") delete c.volk; if (a === "vkdel") { var lt = VE.t - c.start; c.volk = (c.volk || []).filter(function (x) { return Math.abs(x.t - lt) >= 0.02; }); if (!c.volk.length) delete c.volk; }
      veAll(); return veInsp();
    }
    if (b.dataset.asub) {
      if (!c) return;
      if (b.dataset.asub === "a") return whisperSubs(c.url, c.start, c.in || 0, c.dur, 1, b);
      var tk = VTAKES[c.take]; if (!tk || !tk.blob) return toast("Este clip no tiene un video tuyo");
      return whisperSubs(tk.blob, c.start, c.in || 0, c.dur, c.speed || 1, b);
    }
    if (b.dataset.stb === "off" && c) { vsnap(); delete c.stab; veAll(); return veInsp(); }
    if (b.dataset.trk) {
      if (b.dataset.trk === "stab") { if (!c || c.kind !== "take") return; TRK = { kind: "stab", take: c, t0: c.start, t1: c.start + c.dur - 0.01 }; VE.t = c.start; veStop(); veAll(); veInsp(); return toast("Haz clic en el video sobre un punto que debería quedarse quieto"); }
      var o = objSel(); if (!o) return; var take = takeAt(o.start + 0.01); if (!take) return toast("Necesita un video tuyo en V1 debajo de este clip");
      TRK = { kind: "follow", o: o, take: take, t0: Math.max(o.start, take.start), t1: Math.min(o.start + o.dur, take.start + take.dur) - 0.01 }; VE.t = TRK.t0; veStop(); veAll(); veInsp();
      return toast("Haz clic en el video sobre el punto que este clip debe seguir");
    }
  }, true);
  /* biblioteca: «Capa de ajuste» junto a las formas */
  var _binV16 = veBin;
  veBin = function () {
    var r = _binV16.apply(this, arguments), box = vq("#veBin"); if (!box || !VE.p || VE.tab !== "texto" || box.querySelector("[data-padj]")) return r;
    box.insertAdjacentHTML("beforeend", '<div class="ve-bsec"><div class="ed-mh">Capa de ajuste — color, brillo o desenfoque de todo lo que está debajo</div><button class="ve-item" data-padj="1"><span class="ve-bth" style="background:linear-gradient(135deg,#6b5cff,#ff5e00);opacity:.7"></span><span><b>Capa de ajuste</b><small>en el playhead</small></span><i>+</i></button></div>');
    return r;
  };
  vq("#veBin").addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-padj]"); if (!b || !VE.p) return;
    e.preventDefault(); e.stopImmediatePropagation(); vsnap();
    var p = VE.p, c = { id: nid(), name: "Capa de ajuste", adj: { a: Object.assign({}, ADJ0, { sa: 140, ct: 110 }) }, bg: "transparent", start: r1(Math.min(VE.t, Math.max(0, veDur(p) - 0.5))), dur: 3, x: 50, y: 50, w: 100, ar: r1(W0() / H0()), opacity: 1, radius: 0, anim: "none", zi: 50 };
    p.m.push(c); VE.sel = { tr: "m", i: p.m.length - 1 }; veAll(); veInsp(); reveal(c);
    toast("Capa de ajuste agregada: afecta todo lo de abajo (capa 50, delante de todo)");
  }, true);
  /* botón de marcador en la barra de la línea de tiempo */
  (function () { var bar = vq(".ve-tlbar"); if (!bar || bar.querySelector("[data-vmark]")) return; var sp = bar.querySelector(".ve-sp"); var bt = document.createElement("button"); bt.className = "ed-tb"; bt.dataset.vmark = "1"; bt.title = "Agregar un marcador en el playhead (tecla M)"; bt.textContent = "◆ Marcador"; bt.addEventListener("click", function () { addMarker(""); }); if (sp) bar.insertBefore(bt, sp); else bar.appendChild(bt); })();

  /* lo que necesita el código del video (bridge-video-code.js) para escribir exactamente lo que se ve */
  Object.assign(window.__vePro, { recolor: recolor, shapeSvg: shapeSvg, sizeSvg: sizeSvg, maskCssOf: maskCssOf, textW: textW, sanitizeSvg: sanitizeSvg, vecUrl: vecUrl, zOf: zOf, adjFilterOf: adjFilter });
  _ensureMono();
})();

/* el video como código (Musa Video Code) y la edición profesional con arrastrar y soltar: se cargan después del editor pro */
(function () {
  if (document.querySelector("script[data-ve-code]")) return;
  var v = Date.now().toString(36).slice(0, 6);
  var load = function (f, next) { var s = document.createElement("script"); s.src = f; s.setAttribute("data-ve-code", f); s.onload = function () { if (next) next(); }; s.onerror = function () { console.error("[video] no cargó " + f); if (next) next(); }; document.body.appendChild(s); };
  load("video-live-core.js", function () { load("video-code-core.js", function () { load("bridge-video-code.js", function () { load("bridge-video-dnd.js", function () { load("bridge-video-live.js"); }); }); }); });
})();
