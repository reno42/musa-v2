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
  function state(c, t, kind) {
    var lt = t - c.start;
    var en = kind === "t" ? entry(c.anim, cl(lt / 0.5, 0, 1), "ease-out") : (lt <= 0 ? {} : entry(c.anim || "fade", cl(lt / 0.5, 0, 1)));
    var out = kind === "t" ? cl((c.start + c.dur - t) / 0.25, 0, 1) : 1;
    var k = sampleKf(c.kf, lt), f = fxVals(c.fx, lt, c.dur);
    return {
      dx: (en.dx || 0) + (k.x || 0) + f.dx, dy: (en.dy || 0) + (k.y || 0) + f.dy,
      s: (en.s != null ? en.s : 1) * (k.s != null ? k.s : 1) * f.s, r: (en.r || 0) + (k.r || 0) + f.r,
      o: (en.o != null ? en.o : 1) * (k.o != null ? k.o : 1) * f.o * out * (kind === "m" ? (c.opacity != null ? c.opacity : 1) : 1),
      blur: en.blur || 0, chars: en.chars, clip: en.clip || "", glow: f.glow,
    };
  }
  /* el texto se ajusta solo al ancho del lienzo (no salta de línea: «IS YOUR» en 260 px en 9:16) */
  var mc = document.createElement("canvas").getContext("2d");
  function fitSize(c, W) {
    var size = +c.size || 64;
    if (c.autofit === false) return size;
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
    return "linear-gradient(" + (g.angle != null ? g.angle : 135) + "deg," + a + "," + b + ")";
  }
  function glowCss(c, on) { return c.glow || (on ? (c.color || "#ffffff") : ""); }
  window.__vePro = { state: state, fitSize: fitSize, gradCss: gradCss, fxVals: fxVals, ensureFont: ensureFont, FONTS: FONTS };

  /* ═════ vista previa: textos y media ═════ */
  capHTML = function (c, t) {
    var st = state(c, t, "t"), size = fitSize(c, W0());
    ensureFont(c.font);
    var txt = st.chars != null ? c.text.slice(0, Math.round(c.text.length * st.chars)) : c.text;
    var g = glowCss(c, st.glow), gr = c.glowR != null ? +c.glowR : 24;
    var sel = VE.sel && VE.sel.tr === "t" && VE.p && VE.p.t[VE.sel.i] === c;
    return '<div class="ve-cap" style="left:' + c.x + "%;top:" + c.y + "%;font-family:" + (FONTS[c.font] || FONTS.Inter) + ";font-size:" + size + "px;font-weight:" + c.weight + ";color:" + c.color + ";"
      + (c.bg ? "background:" + c.bg + ";padding:.2em .55em;border-radius:.35em;" : "")
      + (c.autofit === false ? "" : "white-space:pre;max-width:none;")
      + "transform:translate(-50%,-50%) translate(" + r1(st.dx) + "px," + r1(st.dy) + "px) rotate(" + r1(st.r) + "deg) scale(" + r1(st.s) + ");opacity:" + r1(st.o)
      + (g ? ";text-shadow:0 0 " + r1(gr * 0.4) + "px " + g + ",0 0 " + gr + "px " + g + ",0 0 " + r1(gr * 2) + "px " + g : "")
      + (st.blur ? ";filter:blur(" + r1(st.blur) + "px)" : "") + (st.clip ? ";clip-path:" + st.clip : "")
      + (sel ? ";outline:5px solid #ff5e00;outline-offset:8px" : "") + '">' + eesc(txt) + "</div>";
  };
  mediaHTML = function (c, t) {
    var st = state(c, t, "m"), bg = c.grad ? gradCss(c.grad) : c.bg, g = glowCss(c, st.glow), gr = c.glowR != null ? +c.glowR : 24;
    var sel = VE.sel && VE.sel.tr === "m" && VE.p && VE.p.m[VE.sel.i] === c;
    return '<div class="ve-media" style="left:' + c.x + "%;top:" + c.y + "%;width:" + c.w + "%;aspect-ratio:" + (c.ar || 1) + ";background:" + bg + ";border-radius:" + (c.shape === "circle" ? "50%" : (c.radius || 0) + "px")
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
    var lt = lt0(o), k = sampleKf(o.kf, lt), at = (o.kf || []).find(function (x) { return Math.abs(x.t - lt) < 0.02; });
    return sec("Keyframes · " + (o.kf || []).length, '<div class="ed-note" style="grid-column:1/-1">Playhead en ' + lt.toFixed(2) + " s del clip. " + (at ? "Editas el keyframe de este instante." : "Al cambiar un valor se crea un keyframe aquí (auto-key). Con dos o más, el clip se mueve entre ellos.") + "</div>"
      + numF("kk.x", "Mover X (px)", k.x) + numF("kk.y", "Mover Y (px)", k.y) + numF("kk.s", "Escala", k.s, 0.05) + numF("kk.r", "Rotación°", k.r) + numF("kk.o", "Opacidad", k.o, 0.05)
      + '<div class="ed-row">' + (at ? '<button data-pkf="del">Borrar keyframe</button>' : '<button data-pkf="add">Agregar keyframe</button>') + '<button data-pkf="prev">◀ Anterior</button><button data-pkf="next">Siguiente ▶</button></div>'
      + (o.kf || []).map(function (x, i) { return '<button class="ed-li" data-pkt="' + i + '" style="grid-column:1/-1;padding:4px 0;border:0"><span><b>◆ ' + x.t.toFixed(2) + " s</b><small>x " + r1(x.x) + " · y " + r1(x.y) + " · esc " + r1(x.s) + " · " + r1(x.r) + "° · op " + r1(x.o) + "</small></span></button>"; }).join(""));
  }
  function proSections(o, tr) {
    var h = sec("Efecto continuo", selF("fx", "Movimiento", o.fx || "none", FX_FREE, true) + '<div class="ed-note" style="grid-column:1/-1">Se repite durante todo el clip. Para trayectorias (órbitas, colapsos) usa Keyframes.</div>');
    h += sec("Brillo / halo", selF("glowOn", "Brillo", o.glow ? "1" : "0", [["0", "Sin brillo"], ["1", "Con brillo"]]) + (o.glow ? colF("glow", "Color", o.glow) + numF("glowR", "Radio", o.glowR != null ? o.glowR : 24) : ""));
    if (tr === "t") h += sec("Ajuste", selF("autofit", "Al ancho del video", o.autofit === false ? "0" : "1", [["1", "Achicar para que quepa en una línea"], ["0", "Saltar de línea"]], true));
    if (tr === "m" && !/url\(/.test(o.bg || "")) {
      var g = o.grad || { type: "solid", a: hexOr(o.bg, BRAND), b: "#111111", angle: 135 };
      h += sec("Relleno y forma", selF("fill.type", "Relleno", o.grad ? o.grad.type : "solid", [["solid", "Color plano"], ["linear", "Degradado lineal"], ["radial", "Degradado radial"], ["halo", "Halo (se desvanece)"]], true)
        + colF("fill.a", "Color", g.a) + (o.grad && o.grad.type !== "halo" ? colF("fill.b", "Color 2", g.b) : "") + (o.grad && o.grad.type === "linear" ? numF("fill.angle", "Ángulo°", g.angle) : "")
        + selF("shape", "Forma", o.shape || "rect", [["rect", "Rectángulo"], ["circle", "Círculo"]]));
    }
    return h + kfSec(o);
  }
  var lastSel = "";
  var _insp = veInsp;
  veInsp = function () {
    _insp.apply(this, arguments);
    var box = vq("#veInsp"); if (!box) return;
    var s = VE.sel, o = objSel();
    if (o) {
      var acts = box.lastElementChild;
      var h = proSections(o, s.tr);
      if (s.tr === "t") h = '<div class="ed-note" style="margin:8px 12px 0">Con el texto elegido, escribe y va directo al texto. Esc para salir.</div>' + h;
      if (acts && acts.classList.contains("ed-sb")) acts.insertAdjacentHTML("beforebegin", h); else box.insertAdjacentHTML("beforeend", h);
    } else if (!s && VE.p) {
      var g = VE.p.grad || { type: "solid", a: hexOr(VE.p.pad, "#000000"), b: "#111111", angle: 160 };
      var last = box.lastElementChild;
      var ph = sec("Fondo del video", selF("pg.type", "Fondo", VE.p.grad ? VE.p.grad.type : "solid", [["solid", "Color plano"], ["linear", "Degradado lineal"], ["radial", "Degradado radial"]], true)
        + (VE.p.grad ? colF("pg.a", "Color", g.a) + colF("pg.b", "Color 2", g.b) + (g.type === "linear" ? numF("pg.angle", "Ángulo°", g.angle) : "") : ""));
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
    var p = VE.p, v = e.target.value, num = e.target.type === "number";
    if (num) v = parseFloat(v) || 0;
    if (e.target.tagName === "SELECT" || pending) { if (typeof vsnap === "function") vsnap(); pending = false; }
    if (k.indexOf("pg.") === 0) {
      var f = k.slice(3);
      if (f === "type") { if (v === "solid") { delete p.grad; p.pad = hexOr(p.pad, "#000000"); } else { p.grad = Object.assign({ a: hexOr(p.pad, "#1a1a1a"), b: "#ff5e00", angle: 160 }, p.grad || {}, { type: v }); } }
      else if (p.grad) p.grad[f] = v;
      if (p.grad) p.pad = gradCss(p.grad);
      veStage(); if (f === "type") veInsp();
      return;
    }
    var o = objSel(); if (!o) return;
    if (k.indexOf("kk.") === 0) {
      var lt = lt0(o); o.kf = o.kf || [];
      var kf = o.kf.find(function (x) { return Math.abs(x.t - lt) < 0.02; });
      if (!kf) { kf = Object.assign({ t: lt }, sampleKf(o.kf, lt)); o.kf.push(kf); o.kf.sort(function (a, b) { return a.t - b.t; }); }
      kf[k.slice(3)] = v;
      veStage(); veTimeline();
      return;
    }
    if (k === "fx") o.fx = v;
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
  vq("#veInsp").addEventListener("input", onPro);
  vq("#veInsp").addEventListener("change", onPro);
  vq("#veInsp").addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-pkf],[data-pkt]"); if (!b) return;
    var o = objSel(); if (!o) return;
    var lt = lt0(o), kf = o.kf || [];
    if (b.dataset.pkt != null) { VE.t = o.start + kf[+b.dataset.pkt].t; veStage(); veTimeline(); return veInsp(); }
    var a = b.dataset.pkf;
    if (a === "add") { vsnap(); o.kf = kf.concat([Object.assign({ t: lt }, sampleKf(kf, lt))]).sort(function (x, y) { return x.t - y.t; }); }
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
    return api("/rest/v1/brands?" + flt + "&select=id,name,colors,logo&order=name.asc&limit=100").then(function (r) { brandCache = r || []; return brandCache; }, function () { brandCache = []; return brandCache; });
  }
  function brandColor() {
    var b = (brandCache || []).find(function (x) { return (x.colors || []).length; });
    var c = b && b.colors[0]; c = typeof c === "string" ? c : c && (c.hex || c.value);
    return hex6(c) || BRAND;
  }
  function logoOf(b) { var l = b.logo; var u = typeof l === "string" ? l : l && (l.url || l.src); return /^https?:\/\//.test(u || "") ? u : null; }
  var _bin = veBin;
  veBin = function () {
    _bin.apply(this, arguments);
    var box = vq("#veBin"); if (!box || !VE.p) return;
    var real = !!VE.p._real;
    var item = function (l, sub, attrs, th) { return '<button class="ve-item" ' + attrs + ">" + (th || "") + "<span><b>" + esc(l) + "</b>" + (sub ? "<small>" + esc(sub) + "</small>" : "") + "</span><i>+</i></button>"; };
    var secH = function (t, b) { return '<div class="ve-bsec"><div class="ed-mh">' + t + "</div>" + b + "</div>"; };
    if (VE.tab === "media") {
      box.insertAdjacentHTML("afterbegin", secH("Subir", '<button class="ed-btn pri" data-pro="upimg" style="width:100%">Subir imagen (PNG, JPG, SVG)</button>' + (real ? "" : '<div class="ed-note">Abre un video tuyo para subir archivos.</div>')));
      brands().then(function (bs) {
        var ls = bs.filter(logoOf); if (!ls.length || VE.tab !== "media" || !vq("#veBin")) return;
        vq("#veBin").insertAdjacentHTML("beforeend", secH("Logos de tus marcas — el isotipo real, en M", ls.map(function (b) { return item(b.name, "logo", 'data-pro="logo" data-url="' + esc(logoOf(b)) + '" data-name="' + esc(b.name) + '"', '<span class="ve-bth" style="background:#fff url(&#39;' + esc(logoOf(b)) + '&#39;) center/contain no-repeat"></span>'); }).join("")));
      });
    } else if (VE.tab === "audio") {
      var auds = (RB().assets || []).filter(function (a) { return /^audio/.test(a.mime_type || "") && a.url; });
      box.insertAdjacentHTML("afterbegin", secH("Tus sonidos", '<button class="ed-btn pri" data-pro="upaud" style="width:100%">Subir audio (MP3, WAV, M4A, OGG)</button>'
        + auds.slice(0, 40).map(function (a) { return item(a.name || "Audio", "tu audio", 'data-pro="addaud" data-url="' + esc(a.url) + '" data-name="' + esc(a.name || "Audio") + '"'); }).join("")
        + (real ? "" : '<div class="ed-note">Abre un video tuyo para subir audio.</div>')));
    } else if (VE.tab === "texto") {
      var c = brandColor();
      box.insertAdjacentHTML("beforeend", secH("Formas, halos y degradados — en M", [["circle", "Círculo", c], ["rect", "Rectángulo", c], ["pill", "Píldora", c], ["halo", "Halo de luz", c], ["bggrad", "Degradado a pantalla completa", c]].map(function (x) {
        var th = x[0] === "halo" ? "radial-gradient(circle," + x[2] + "," + x[2] + "00 70%)" : x[0] === "bggrad" ? "linear-gradient(160deg,#1a1a1a," + x[2] + ")" : x[2];
        return item(x[1], "en el playhead", 'data-pro="shape" data-v="' + x[0] + '"', '<span class="ve-bth" style="background:' + th + ";border-radius:" + (x[0] === "circle" || x[0] === "halo" ? "50%" : x[0] === "pill" ? "999px" : "4px") + '"></span>');
      }).join("")));
      brands();
    } else if (VE.tab === "fx") {
      var o = objSel(), note = box.querySelector(".ed-note");
      if (note) note.innerHTML = o ? "Movimiento para <b style=\"color:#fff\">" + esc(o.text || o.name || "el clip") + "</b>. Overlays y Looks solo aplican a tomas y escenas (V1)."
        : "Elige un clip: el movimiento sirve para tomas y escenas (V1), textos y media; overlays y looks, solo para V1.";
      if (o) [].forEach.call(box.querySelectorAll("[data-fx]"), function (b) { b.classList.toggle("on", (o.fx || "none") === b.dataset.fx); });
    }
    box.setAttribute("role", "region"); box.setAttribute("aria-label", "Biblioteca");
  };
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
    VE.t = c.start + Math.min(0.6, c.dur / 2);
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
      if (tr === "m") { var u = (String(c.bg || "").match(/url\(["']?([^"')]+)["']?\)/) || [])[1]; if (u) { var im = new Image(); im.onload = function () { if (im.naturalWidth && im.naturalHeight) { c.ar = r1(im.naturalWidth / im.naturalHeight); veStage(); } }; im.src = u; } }
      reveal(c);
      toast("Agregado en " + (tr === "t" ? "Texto" : tr === "m" ? "Media" : "Audio") + " a las " + fmtT(c.start));
    }, 0);
  }, true);
  function pickFile(accept) {
    return new Promise(function (ok) {
      var i = document.createElement("input"); i.type = "file"; i.accept = accept; i.style.display = "none";
      i.onchange = function () { ok(i.files && i.files[0] || null); i.remove(); };
      document.body.appendChild(i); i.click();
    });
  }
  function readData(f) { return new Promise(function (ok, ko) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = function () { ko(new Error("no se pudo leer el archivo")); }; r.readAsDataURL(f); }); }
  function upload(dataUrl, name) {
    var R = RB(); if (!R.on || !R.ws) return Promise.reject(new Error("abre un video tuyo"));
    return api("/api/assets/upload", jpost({ name: name, data: dataUrl, workspaceId: R.ws })).then(function (x) { var a = x.data || x.asset || x; var url = a.url || (a.data && a.data.url); if (!url) throw new Error("el servidor no devolvió el archivo"); return { url: url, a: a }; });
  }
  function addMedia(name, url, contain) {
    var p = VE.p; vsnap();
    var c = { id: nid(), name: name, bg: "url('" + url + "') center/" + (contain ? "contain" : "cover") + " no-repeat", start: r1(Math.min(VE.t, Math.max(0, veDur(p) - 0.5))), dur: 3, x: 50, y: 50, w: 40, ar: 1, opacity: 1, radius: 0, anim: "pop" };
    p.m.push(c); VE.sel = { tr: "m", i: p.m.length - 1 };
    var im = new Image(); im.onload = function () { if (im.naturalWidth && im.naturalHeight) { c.ar = r1(im.naturalWidth / im.naturalHeight); veStage(); } }; im.src = url;
    veAll(); veInsp(); reveal(c);
    return c;
  }
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
          addMedia(f.name.replace(/\.[^.]+$/, ""), r.url, /svg/.test(f.type)); toast("Imagen agregada en M");
        });
      }).catch(function (x) { toast("No se pudo subir: " + (x && x.message || x)); });
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
      el.volume = cl(c.vol != null ? c.vol : 1, 0, 1);
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
  _ensureMono();
})();
