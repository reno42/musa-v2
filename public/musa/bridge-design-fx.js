/* bridge-design-fx.js — el inspector sin pérdidas: cada efecto que trae un diseño (de una IA, de código importado o
 * hecho en Musa) se ve con su valor REAL y se edita sin borrar lo demás.
 *  · Sombras: todas las que tenga la capa (color con transparencia, x, y, desenfoque, extensión, interior).
 *  · Filtros: la cadena completa (desenfoque, brillo, contraste, saturación, grises, sepia, tono, invertir, opacidad y
 *    sombra con forma) y el desenfoque/saturación del fondo (backdrop-filter). Mezcla con los 16 modos.
 *  · Transformación: mover, girar, escalar y sesgar (lo que trae el CSS se descompone; nada se suma dos veces) y el CSS
 *    tal cual para transformaciones 3D (perspectiva, rotateX/Y).
 *  · Texto: sombra de texto, contorno (-webkit-text-stroke), texto con degradado, cursiva, subrayado/tachado.
 *  · Relleno con degradado: tipo, ángulo y paradas (color + posición), o el CSS tal cual si son varios fondos.
 *  · Radios por esquina. Variables CSS de la lámina (--marca, --fondo…) para cambiar todo de una.
 * Reemplaza las secciones «Efectos» y «Transform» de la maqueta (mostraban 12 en cualquier sombra, sesgo siempre 0,
 * y al tocarlas reemplazaban el efecto entero por uno genérico).
 */
(function boot(n) {
  "use strict";
  var RB = window.__musaReal;
  if (!RB || !RB._edx || typeof ED === "undefined" || typeof edProps !== "function") { if ((n || 0) < 800) setTimeout(function () { boot((n || 0) + 1); }, 150); return; }
  if (window.__mdFx) return;
  var X = RB._edx;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function r2(v) { return Math.round(v * 100) / 100; }
  function curDoc() { return ED.open && ED.doc && ED.doc._real ? ED.doc : null; }
  function selN() { var d = curDoc(); if (!d || !ED.sel || ED.sel.e == null) return null; var f = d.frames[ED.sel.f], e = f && f.els[ED.sel.e]; return e && e._n ? e._n : null; }
  function selFrame() { var d = curDoc(); return d && ED.sel ? d.frames[ED.sel.f] || null : null; }
  function typing() { var a = document.activeElement; return !!(a && a.closest && a.closest(".md-fx") && /INPUT|TEXTAREA|SELECT/.test(a.tagName)); }
  var lastSnap = { k: null, at: 0 };
  function snapOnce(k) { var now = Date.now(); if (lastSnap.k !== k || now - lastSnap.at > 1500) { if (typeof snap === "function") snap(); } lastSnap = { k: k, at: now }; }
  function done() { var f = selFrame(); if (window.__mdLive && f) window.__mdLive.applyFrame(f); if (typeof edSelBox === "function") edSelBox(); X.save(); }

  /* ── colores ── */
  function rgba(c) {
    var m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/.exec(String(c || ""));
    if (m) { var a = m[4] == null ? 1 : /%$/.test(m[4]) ? parseFloat(m[4]) / 100 : +m[4]; return { r: +m[1], g: +m[2], b: +m[3], a: a }; }
    var h = /^#([0-9a-f]{3,8})$/i.exec(String(c || "").trim());
    if (h) { var s = h[1]; if (s.length <= 4) s = s.split("").map(function (x) { return x + x; }).join(""); return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16), a: s.length > 6 ? parseInt(s.slice(6, 8), 16) / 255 : 1 }; }
    return { r: 0, g: 0, b: 0, a: 1 };
  }
  function hex(o) { return "#" + [o.r, o.g, o.b].map(function (v) { return ("0" + Math.round(v).toString(16)).slice(-2); }).join(""); }
  function css(o) { return o.a >= 1 ? hex(o) : "rgba(" + Math.round(o.r) + ", " + Math.round(o.g) + ", " + Math.round(o.b) + ", " + r2(o.a) + ")"; }
  /* lista separada por comas, respetando paréntesis */
  function splitTop(s) { var out = [], d = 0, cur = ""; String(s || "").split("").forEach(function (ch) { if (ch === "(") d++; if (ch === ")") d--; if (ch === "," && !d) { out.push(cur.trim()); cur = ""; } else cur += ch; }); if (cur.trim()) out.push(cur.trim()); return out; }
  function colorIn(s) { var m = /(rgba?\([^)]*\)|#[0-9a-f]{3,8}\b|\b(?:transparent|black|white|red|blue|green|gray|grey|currentcolor)\b)/i.exec(s); return m ? m[1] : "rgba(0, 0, 0, 1)"; }
  function lens(s) { return (String(s).replace(/(rgba?\([^)]*\)|#[0-9a-f]{3,8})/gi, "").match(/-?[\d.]+(?:px)?/g) || []).map(parseFloat); }

  /* ── sombras ── */
  function shadowsOf(v) { if (!v || v === "none") return []; return splitTop(v).map(function (s) { var l = lens(s); return { c: rgba(colorIn(s)), x: l[0] || 0, y: l[1] || 0, b: l[2] || 0, s: l[3] || 0, inset: /\binset\b/.test(s) }; }); }
  function shadowsCss(list, text) { return list.length ? list.map(function (q) { return (q.inset && !text ? "inset " : "") + r2(q.x) + "px " + r2(q.y) + "px " + r2(q.b) + "px" + (text ? "" : " " + r2(q.s) + "px") + " " + css(q.c); }).join(", ") : "none"; }

  /* ── filtros ── */
  var FN = [["blur", "Desenfoque", "px", 0, 0, 60, 0.5], ["brightness", "Brillo", "", 1, 0, 3, 0.05], ["contrast", "Contraste", "", 1, 0, 3, 0.05], ["saturate", "Saturación", "", 1, 0, 3, 0.05], ["grayscale", "Grises", "", 0, 0, 1, 0.05], ["sepia", "Sepia", "", 0, 0, 1, 0.05], ["hue-rotate", "Tono", "deg", 0, -180, 180, 1], ["invert", "Invertir", "", 0, 0, 1, 0.05], ["opacity", "Opacidad (filtro)", "", 1, 0, 1, 0.05]];
  function filtersOf(v) {
    var o = { drop: [] }; if (!v || v === "none") return o;
    var re = /([a-z-]+)\(((?:[^()]|\([^()]*\))*)\)/gi, m;
    while ((m = re.exec(v))) {
      var k = m[1].toLowerCase(), a = m[2].trim();
      if (k === "drop-shadow") { var l = lens(a); o.drop.push({ c: rgba(colorIn(a)), x: l[0] || 0, y: l[1] || 0, b: l[2] || 0 }); }
      else if (k === "url") o.url = (o.url || []).concat(m[0]);
      else o[k] = /%$/.test(a) ? parseFloat(a) / 100 : parseFloat(a);
    }
    return o;
  }
  function filtersCss(o) {
    var out = [];
    FN.forEach(function (q) { var v = o[q[0]]; if (v == null || v === q[3]) return; out.push(q[0] + "(" + r2(v) + q[2] + ")"); });
    (o.drop || []).forEach(function (d) { out.push("drop-shadow(" + r2(d.x) + "px " + r2(d.y) + "px " + r2(d.b) + "px " + css(d.c) + ")"); });
    (o.url || []).forEach(function (u) { out.push(u); });
    return out.length ? out.join(" ") : "none";
  }

  /* ── transformación 2D (la matriz que calcula el navegador) ── */
  function tf2(v) {
    var m = /^matrix\(([^)]+)\)$/.exec(String(v || "").trim());
    if (!v || v === "none") return { tx: 0, ty: 0, rot: 0, sx: 1, sy: 1, sk: 0 };
    if (!m) return null;
    var p = m[1].split(",").map(Number), a = p[0], b = p[1], c = p[2], d = p[3];
    var sx = Math.hypot(a, b) || 1e-9, ca = a / sx, sa = b / sx, sh = ca * c + sa * d, sy = Math.hypot(c - ca * sh, d - sa * sh) || 1e-9;
    if (a * d - b * c < 0) sy = -sy;
    return { tx: p[4], ty: p[5], rot: Math.atan2(b, a) * 180 / Math.PI, sx: sx, sy: sy, sk: Math.atan(sh / sy) * 180 / Math.PI };
  }
  /* la transformación que se VE: translate · rotate · scale · transform (orden de CSS). Voltear usa `scale`, y una IA puede
     usar `rotate`/`translate` sueltos; leer solo `transform` perdía eso al editar. null si hay 3D (se edita como texto). */
  function mul(A, B) { return [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]]; }
  function shownMatrix(c) {
    var M = [1, 0, 0, 1, 0, 0], tr = String(c.translate || "none"), ro = String(c.rotate || "none"), sc = String(c.scale || "none"), tf = String(c.transform || "none");
    if (tr !== "none") { var q = tr.split(/\s+/).map(parseFloat); if (q.length > 2 && q[2]) return null; M = mul(M, [1, 0, 0, 1, q[0] || 0, q[1] || 0]); }
    if (ro !== "none") {
      var pr = ro.trim().split(/\s+/); if (pr.length > 1 && !/^z$/i.test(pr[0]) && !(pr.length === 4 && +pr[0] === 0 && +pr[1] === 0)) return null;
      var an = pr[pr.length - 1], deg = /turn$/.test(an) ? parseFloat(an) * 360 : /rad$/.test(an) ? parseFloat(an) * 180 / Math.PI : parseFloat(an), r = deg * Math.PI / 180;
      M = mul(M, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);
    }
    if (sc !== "none") { var s = sc.split(/\s+/).map(parseFloat); if (s.length > 2 && s[2] !== 1) return null; M = mul(M, [s[0], 0, 0, s.length > 1 ? s[1] : s[0], 0, 0]); }
    if (tf !== "none") { var m = /^matrix\(([^)]+)\)$/.exec(tf.trim()); if (!m) return null; M = mul(M, m[1].split(",").map(Number)); }
    return "matrix(" + M.join(", ") + ")";
  }
  function tfShown(c) { var m = shownMatrix(c); return m ? tf2(m) : null; }
  function tfCss(t) { return "translate(" + r2(t.tx) + "px, " + r2(t.ty) + "px) rotate(" + r2(t.rot) + "deg) skewX(" + r2(t.sk) + "deg) scale(" + r2(t.sx) + ", " + r2(t.sy) + ")"; }

  /* ── degradados ── */
  function gradOf(bg) {
    var g = /^(repeating-)?(linear|radial|conic)-gradient\((.*)\)$/i.exec(String(bg || "").trim()); if (!g) return null;
    var parts = splitTop(g[3]), head = null, stops = [];
    if (parts.length && !/^(rgba?\(|#|[a-z]+\s+[\d.]+%|[a-z]+$)/i.test(parts[0]) || /^(to |from |at |circle|ellipse|[\d.-]+(deg|turn|rad))/i.test(parts[0] || "")) head = parts.shift();
    parts.forEach(function (s) { var c = colorIn(s), pos = (/([\d.-]+)%/.exec(s.replace(c, "")) || [])[1]; stops.push({ c: rgba(c), p: pos != null ? +pos : null }); });
    stops.forEach(function (s, i) { if (s.p == null) s.p = stops.length > 1 ? Math.round(i / (stops.length - 1) * 100) : 0; });
    var ang = head && /([\d.-]+)deg/.exec(head) ? +/([\d.-]+)deg/.exec(head)[1] : head && /^to /.test(head) ? ({ "to top": 0, "to right": 90, "to bottom": 180, "to left": 270 }[head.trim()] != null ? { "to top": 0, "to right": 90, "to bottom": 180, "to left": 270 }[head.trim()] : 180) : 180;
    return { rep: !!g[1], type: g[2].toLowerCase(), head: head, ang: ang, stops: stops };
  }
  function gradCss(g) {
    var head = g.type === "linear" ? r2(g.ang) + "deg" : g.type === "conic" ? "from " + r2(g.ang) + "deg" : g.head && !/^(rgba?|#)/i.test(g.head) ? g.head : "circle";
    return (g.rep ? "repeating-" : "") + g.type + "-gradient(" + head + ", " + g.stops.map(function (s) { return css(s.c) + " " + r2(s.p) + "%"; }).join(", ") + ")";
  }

  /* ═════════════ secciones ═════════════ */
  function colorField(attr, label, c) { return '<label class="ef full"><span>' + esc(label) + '</span><input type="color" ' + attr + ' data-fxc="hex" value="' + hex(c) + '"><input type="number" min="0" max="1" step="0.05" ' + attr + ' data-fxc="a" value="' + r2(c.a) + '" title="Transparencia (0–1)" style="max-width:64px"></label>'; }
  function numF(attr, label, v, step, min, max) { return '<label class="ef"><span>' + esc(label) + '</span><input type="number" ' + attr + ' step="' + (step || 1) + '"' + (min != null ? ' min="' + min + '"' : "") + (max != null ? ' max="' + max + '"' : "") + ' value="' + r2(+v || 0) + '"></label>'; }
  function txtF(attr, label, v) { return '<label class="ef full"><span>' + esc(label) + '</span><input type="text" ' + attr + ' value="' + esc(v) + '" spellcheck="false"></label>'; }
  function shadowRows(list, kind) {
    return list.map(function (q, i) {
      var a = 'data-fxs="' + kind + '" data-fxi="' + i + '"';
      return '<div class="md-fxbox"><b>' + (kind === "text" ? "Sombra de texto " : "Sombra ") + (i + 1) + "</b>" + colorField(a + ' data-fxk="c"', "Color", q.c)
        + numF(a + ' data-fxk="x"', "X", q.x) + numF(a + ' data-fxk="y"', "Y", q.y) + numF(a + ' data-fxk="b"', "Desenfoque", q.b, 1, 0) + (kind === "text" ? "" : numF(a + ' data-fxk="s"', "Extensión", q.s))
        + (kind === "text" ? "" : '<label class="ef"><span>Interior</span><select ' + a + ' data-fxk="inset"><option value="0"' + (q.inset ? "" : " selected") + '>No</option><option value="1"' + (q.inset ? " selected" : "") + ">Sí</option></select></label>")
        + '<button class="ed-btn" data-fxa="delsh" ' + a + ">Quitar</button></div>";
    }).join("") + '<div class="md-row"><button class="ed-btn" data-fxa="addsh" data-fxs="' + kind + '">＋ ' + (kind === "text" ? "Sombra de texto" : "Sombra") + "</button></div>";
  }
  var BLENDS = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"];
  function fxSecs(nd, f) {
    var c = getComputedStyle(nd), fl = filtersOf(c.filter), bf = filtersOf(c.backdropFilter || c.webkitBackdropFilter), t = tfShown(c), isText = !!(nd.textContent || "").trim() && !nd.querySelector("img,svg,video,canvas");
    var A = window.__mdLive && window.__mdLive.animOf ? window.__mdLive.animOf(f) : null, id = nd.getAttribute("data-layer-id");
    var animProps = A ? A.clips.filter(function (k) { return k.layerId === id; }).reduce(function (s, k) { k.tweens.forEach(function (tw) { s[tw.prop] = 1; }); return s; }, {}) : {};
    var animNote = function (p) { return animProps[p] ? '<div class="ed-note" style="grid-column:1/-1">Esta capa anima su ' + ({ transform: "movimiento", filter: "filtro", boxShadow: "sombra", opacity: "opacidad" }[p] || p) + ': lo que ves es el instante actual. Para cambiarlo en el tiempo, edita sus keyframes (Animación).</div>' : ""; };
    var h = "";
    /* efectos */
    h += sec("Efectos", animNote("boxShadow") + shadowRows(shadowsOf(c.boxShadow), "box")
      + '<div class="ed-mh" style="grid-column:1/-1">Filtros de la capa</div>' + animNote("filter")
      + FN.map(function (q) { var v = fl[q[0]] != null ? fl[q[0]] : q[3]; return '<label class="ef"><span>' + q[1] + '</span><input type="number" data-fxf="' + q[0] + '" step="' + q[6] + '" min="' + q[4] + '" max="' + q[5] + '" value="' + r2(v) + '"></label>'; }).join("")
      + (fl.drop || []).map(function (d, i) { var a = 'data-fxd="' + i + '"'; return '<div class="md-fxbox"><b>Sombra con forma ' + (i + 1) + "</b>" + colorField(a + ' data-fxk="c"', "Color", d.c) + numF(a + ' data-fxk="x"', "X", d.x) + numF(a + ' data-fxk="y"', "Y", d.y) + numF(a + ' data-fxk="b"', "Desenfoque", d.b, 1, 0) + '<button class="ed-btn" data-fxa="deldrop" ' + a + ">Quitar</button></div>"; }).join("")
      + '<div class="md-row"><button class="ed-btn" data-fxa="adddrop" title="Sombra que sigue la forma (PNG con transparencia, íconos, texto)">＋ Sombra con forma</button><button class="ed-btn" data-act="glass" title="Vidrio esmerilado">Glass</button></div>'
      + '<div class="ed-mh" style="grid-column:1/-1">Fondo detrás de la capa</div>'
      + '<label class="ef"><span>Desenfoque</span><input type="number" data-fxb="blur" step="0.5" min="0" max="80" value="' + r2(bf.blur || 0) + '"></label><label class="ef"><span>Saturación</span><input type="number" data-fxb="saturate" step="0.05" min="0" max="3" value="' + r2(bf.saturate != null ? bf.saturate : 1) + '"></label>'
      + '<label class="ef full"><span>Mezcla</span><select data-fxm="blend">' + BLENDS.map(function (b) { return '<option value="' + b + '"' + (c.mixBlendMode === b ? " selected" : "") + ">" + b + "</option>"; }).join("") + "</select></label>", true);
    /* transformación */
    h += sec("Transformación", animNote("transform") + (t ? numF('data-fxt="tx"', "Mover X", t.tx) + numF('data-fxt="ty"', "Mover Y", t.ty) + numF('data-fxt="rot"', "Giro °", t.rot, 1) + numF('data-fxt="sk"', "Sesgo °", t.sk, 1)
      + numF('data-fxt="sx"', "Escala X", t.sx, 0.05) + numF('data-fxt="sy"', "Escala Y", t.sy, 0.05) : '<div class="ed-note" style="grid-column:1/-1">Transformación 3D (perspectiva, giros en X/Y): edítala abajo tal cual.</div>')
      + txtF('data-fxraw="transform"', "CSS (transform)", nd.style.transform || (c.transform === "none" ? "" : c.transform))
      + txtF('data-fxraw="transform-origin"', "Punto de giro (origin)", c.transformOrigin)
      + '<div class="ed-row" style="grid-column:1/-1"><button data-act="flipH">Voltear horizontal</button><button data-act="flipV">Voltear vertical</button></div>', false);
    /* relleno con degradado */
    var bgi = c.backgroundImage, layers = bgi && bgi !== "none" ? splitTop(bgi) : [], g = layers.length === 1 ? gradOf(layers[0]) : null;
    if (g) h += sec("Degradado", '<label class="ef"><span>Tipo</span><select data-fxg="type">' + [["linear", "Lineal"], ["radial", "Radial"], ["conic", "Cónico"]].map(function (o) { return '<option value="' + o[0] + '"' + (g.type === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>"
      + (g.type === "radial" ? "" : numF('data-fxg="ang"', "Ángulo °", g.ang, 1))
      + g.stops.map(function (s, i) { var a = 'data-fxgs="' + i + '"'; return '<div class="md-fxbox"><b>Parada ' + (i + 1) + "</b>" + colorField(a + ' data-fxk="c"', "Color", s.c) + numF(a + ' data-fxk="p"', "Posición %", s.p, 1, 0, 100) + (g.stops.length > 2 ? '<button class="ed-btn" data-fxa="delstop" ' + a + ">Quitar</button>" : "") + "</div>"; }).join("")
      + '<div class="md-row"><button class="ed-btn" data-fxa="addstop">＋ Parada</button></div>', true);
    else if (layers.length > 1 || (bgi && bgi !== "none" && !/^url\(/.test(bgi))) h += sec("Fondo", txtF('data-fxraw="background-image"', "Fondos (CSS, varios a la vez)", bgi), false);
    /* texto */
    if (isText) {
      var stW = parseFloat(c.webkitTextStrokeWidth) || 0, gradText = /text/.test(c.webkitBackgroundClip || c.backgroundClip || "") && bgi && bgi !== "none";
      h += sec("Texto · efectos", shadowRows(shadowsOf(c.textShadow), "text")
        + numF('data-fxtx="strokeW"', "Contorno (px)", stW, 0.5, 0) + colorField('data-fxtx="strokeC"', "Color del contorno", rgba(c.webkitTextStrokeColor || "#000"))
        + '<label class="ef"><span>Cursiva</span><select data-fxtx="italic"><option value="0"' + (/italic|oblique/.test(c.fontStyle) ? "" : " selected") + '>No</option><option value="1"' + (/italic|oblique/.test(c.fontStyle) ? " selected" : "") + ">Sí</option></select></label>"
        + '<label class="ef"><span>Línea</span><select data-fxtx="deco">' + [["none", "Ninguna"], ["underline", "Subrayado"], ["line-through", "Tachado"], ["overline", "Arriba"]].map(function (o) { return '<option value="' + o[0] + '"' + ((c.textDecorationLine || "none") === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>"
        + '<label class="ef full"><span>Texto con degradado</span><select data-fxtx="gradText"><option value="0"' + (gradText ? "" : " selected") + '>No</option><option value="1"' + (gradText ? " selected" : "") + ">Sí (el relleno de la capa pinta las letras)</option></select></label>", false);
    }
    /* radios por esquina */
    h += sec("Esquinas", [["border-top-left-radius", "↖"], ["border-top-right-radius", "↗"], ["border-bottom-right-radius", "↘"], ["border-bottom-left-radius", "↙"]].map(function (q) { return '<label class="ef"><span>' + q[1] + '</span><input type="text" data-fxraw="' + q[0] + '" value="' + esc(c.getPropertyValue(q[0])) + '" spellcheck="false"></label>'; }).join(""), false);
    return h;
  }
  /* variables CSS de la lámina (las que define su CSS para :root, body o la página) */
  function varsOf(f) {
    var out = [], seen = {}, src = String((f._src && f._src.css) || "");
    var re = /(--[\w-]+)\s*:\s*([^;{}]+);?/g, m;
    while ((m = re.exec(src))) { if (seen[m[1]]) continue; seen[m[1]] = 1; out.push({ k: m[1], v: m[2].trim() }); }
    return out.slice(0, 60);
  }
  function varsSec(f) {
    var vs = varsOf(f); if (!vs.length) return "";
    return sec("Variables de la lámina · " + vs.length, '<div class="ed-note" style="grid-column:1/-1">Las define el código del diseño (colores de marca, tamaños…). Cambiar una cambia todo lo que la usa.</div>'
      + vs.map(function (x) { var col = /^(#|rgb)/i.test(x.v); return '<label class="ef full"><span>' + esc(x.k) + "</span>" + (col ? '<input type="color" data-fxv="' + esc(x.k) + '" value="' + hex(rgba(x.v)) + '">' : "") + '<input type="text" data-fxv="' + esc(x.k) + '" data-fxvt="1" value="' + esc(x.v) + '" spellcheck="false"></label>'; }).join(""), false);
  }

  var st = document.createElement("style");
  st.textContent = ".md-fx .md-fxbox{grid-column:1/-1;border:1px solid #2e2e2e;border-radius:8px;padding:8px;display:grid;grid-template-columns:1fr 1fr;gap:6px}.md-fx .md-fxbox b{grid-column:1/-1;font-size:12px}.md-fx .md-row{display:flex;gap:6px;flex-wrap:wrap;grid-column:1/-1}.md-fx .ef input[type=color]{max-width:44px;flex:none}";
  document.head.appendChild(st);

  var _props = edProps;
  edProps = function () {
    var r = _props.apply(this, arguments);
    try {
      var box = document.querySelector("#edProps"); if (!box || ED.panel !== "props") return r;
      var old = box.querySelector(".md-fx"); if (old) old.remove();
      var d = curDoc(), f = selFrame(); if (!d || !f || !ED.sel) return r;
      var nd = selN(), html = "";
      if (nd && nd.getAttribute("data-layer-kind") !== "live") {
        /* las secciones con pérdida de la maqueta se reemplazan por estas */
        [].forEach.call(box.querySelectorAll("details.ed-sec"), function (dt) { if (dt.closest(".md-insp,.md-anim,.md-fx")) return; var sm = dt.querySelector("summary"), tt = sm ? sm.textContent.trim() : ""; if (tt === "Efectos" || tt === "Transform") dt.remove(); });
        html = fxSecs(nd, f);
      } else if (ED.sel.e == null) html = varsSec(f);
      if (!html) return r;
      var wrap = document.createElement("div"); wrap.className = "md-fx"; wrap.innerHTML = html;
      var ref = [].find.call(box.querySelectorAll("details.ed-sec"), function (dt) { var sm = dt.querySelector("summary"); return sm && /^Apariencia/.test(sm.textContent.trim()) && !dt.closest(".md-insp,.md-anim,.md-fx"); });
      if (ref && ref.parentNode === box) box.insertBefore(wrap, ref.nextSibling); else box.appendChild(wrap);
    } catch (e) { console.warn("[diseño] efectos", e); }
    return r;
  };

  /* ═════════════ cambios: se escribe solo lo que cambió, sobre el valor real ═════════════ */
  function readColor(el) {
    var row = el.closest("label"), h = row && row.querySelector('[data-fxc="hex"]'), a = row && row.querySelector('[data-fxc="a"]'), o = rgba(h ? h.value : "#000"); o.a = a ? Math.max(0, Math.min(1, parseFloat(a.value))) : 1; if (!isFinite(o.a)) o.a = 1; return o;
  }
  function onEdit(e) {
    var el = e.target; if (!el.closest || !el.closest(".md-fx")) return;
    if (e.type === "input" && el.type === "number" && el.value === "") return;
    if (e.type === "input" && el.type === "text") return;
    var nd = selN(), f = selFrame(), d = el.dataset; if (!f) return;
    if (d.fxv) {
      /* variable de la lámina: se reescribe su valor en el CSS del frame */
      var k = d.fxv, v = d.fxvt ? el.value : el.value;
      if (e.type === "input" && d.fxvt) return;
      snapOnce("fxv" + k);
      var re = new RegExp("(" + k.replace(/[-]/g, "\\-") + "\\s*:\\s*)([^;{}]+)"), srcCss = String(f._src.css || "");
      f._src.css = srcCss.replace(re, function (m0, a) { return a + v; });
      var stl = f._root.querySelector("style[data-scope]"); if (stl) stl.textContent = X.scopeCss(X.cleanCss(f._src.css), X.SCOPE(f._root.getAttribute("data-tf")));
      done(); if (e.type === "change") setTimeout(function () { if (!typing()) edProps(); }, 30); return;
    }
    if (!nd) return;
    var c = getComputedStyle(nd);
    if (d.fxs) {
      var text = d.fxs === "text", list = shadowsOf(text ? c.textShadow : c.boxShadow), q = list[+d.fxi]; if (!q) return;
      snapOnce("fxs" + d.fxs + d.fxi + d.fxk);
      if (d.fxk === "c") q.c = readColor(el); else if (d.fxk === "inset") q.inset = el.value === "1"; else q[d.fxk] = parseFloat(el.value) || 0;
      nd.style.setProperty(text ? "text-shadow" : "box-shadow", shadowsCss(list, text)); return done();
    }
    if (d.fxf || d.fxd != null) {
      var fo = filtersOf(c.filter); snapOnce("fxf" + (d.fxf || "d" + d.fxd + d.fxk));
      if (d.fxf) fo[d.fxf] = parseFloat(el.value);
      else { var dd = fo.drop[+d.fxd]; if (!dd) return; if (d.fxk === "c") dd.c = readColor(el); else dd[d.fxk] = parseFloat(el.value) || 0; }
      nd.style.setProperty("filter", filtersCss(fo)); return done();
    }
    if (d.fxb) { var bo = filtersOf(c.backdropFilter || c.webkitBackdropFilter); bo[d.fxb] = parseFloat(el.value); snapOnce("fxb" + d.fxb); var bv = filtersCss(bo); nd.style.setProperty("backdrop-filter", bv); nd.style.setProperty("-webkit-backdrop-filter", bv); return done(); }
    if (d.fxm === "blend") { snapOnce("fxm"); nd.style.mixBlendMode = el.value; return done(); }
    if (d.fxt) {
      var t = tfShown(c); if (!t) return; snapOnce("fxt" + d.fxt);
      var v = parseFloat(el.value); t[d.fxt] = isFinite(v) ? v : (/^s[xy]$/.test(d.fxt) ? 1 : 0);
      /* todo queda en `transform`; los sueltos se anulan (con «none» si venían de una clase, para no aplicarse dos veces) */
      ["translate", "rotate", "scale"].forEach(function (pp) { nd.style.setProperty(pp, ""); if (String(getComputedStyle(nd)[pp] || "none") !== "none") nd.style.setProperty(pp, "none"); });
      nd.style.transform = tfCss(t); done(); if (e.type === "change") setTimeout(function () { if (!typing()) edProps(); }, 30); return; }
    if (d.fxraw) { if (e.type !== "change") return; snapOnce("fxraw" + d.fxraw); nd.style.setProperty(d.fxraw, el.value); done(); setTimeout(function () { if (!typing()) edProps(); }, 30); return; }
    if (d.fxg) {
      var g = gradOf(c.backgroundImage); if (!g) return; snapOnce("fxg" + d.fxg);
      if (d.fxg === "type") g.type = el.value; else g.ang = parseFloat(el.value) || 0;
      nd.style.backgroundImage = gradCss(g); done(); if (e.type === "change") setTimeout(function () { if (!typing()) edProps(); }, 30); return;
    }
    if (d.fxgs != null) {
      var g2 = gradOf(c.backgroundImage); if (!g2) return; var s0 = g2.stops[+d.fxgs]; if (!s0) return; snapOnce("fxgs" + d.fxgs + d.fxk);
      if (d.fxk === "c") s0.c = readColor(el); else s0.p = Math.max(0, Math.min(100, parseFloat(el.value) || 0));
      nd.style.backgroundImage = gradCss(g2); return done();
    }
    if (d.fxtx) {
      snapOnce("fxtx" + d.fxtx);
      if (d.fxtx === "strokeW") { var w = parseFloat(el.value) || 0; nd.style.setProperty("-webkit-text-stroke-width", w + "px"); if (w && !c.webkitTextStrokeColor) nd.style.setProperty("-webkit-text-stroke-color", "#000"); }
      else if (d.fxtx === "strokeC") nd.style.setProperty("-webkit-text-stroke-color", css(readColor(el)));
      else if (d.fxtx === "italic") nd.style.fontStyle = el.value === "1" ? "italic" : "normal";
      else if (d.fxtx === "deco") nd.style.textDecorationLine = el.value;
      else if (d.fxtx === "gradText") {
        if (el.value === "1") { if (!c.backgroundImage || c.backgroundImage === "none") nd.style.backgroundImage = "linear-gradient(90deg, #ff5e00, #ffb800)"; nd.style.setProperty("-webkit-background-clip", "text"); nd.style.setProperty("background-clip", "text"); nd.style.setProperty("-webkit-text-fill-color", "transparent"); nd.style.color = "transparent"; }
        else { nd.style.removeProperty("-webkit-background-clip"); nd.style.removeProperty("background-clip"); nd.style.removeProperty("-webkit-text-fill-color"); if (nd.style.color === "transparent") nd.style.removeProperty("color"); }
        setTimeout(function () { if (!typing()) edProps(); }, 30);
      }
      return done();
    }
  }
  function onClick(e) {
    var b = e.target.closest && e.target.closest(".md-fx [data-fxa]"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var nd = selN(); if (!nd) return;
    var c = getComputedStyle(nd), a = b.dataset.fxa;
    if (typeof snap === "function") snap();
    if (a === "addsh" || a === "delsh") {
      var text = b.dataset.fxs === "text", list = shadowsOf(text ? c.textShadow : c.boxShadow);
      if (a === "addsh") list.push(text ? { c: { r: 0, g: 0, b: 0, a: 0.35 }, x: 0, y: 2, b: 6, s: 0 } : { c: { r: 0, g: 0, b: 0, a: 0.25 }, x: 0, y: 10, b: 30, s: 0, inset: false }); else list.splice(+b.dataset.fxi, 1);
      nd.style.setProperty(text ? "text-shadow" : "box-shadow", shadowsCss(list, text));
    } else if (a === "adddrop" || a === "deldrop") {
      var fo = filtersOf(c.filter); if (a === "adddrop") fo.drop.push({ c: { r: 0, g: 0, b: 0, a: 0.35 }, x: 0, y: 8, b: 16 }); else fo.drop.splice(+b.dataset.fxd, 1);
      nd.style.setProperty("filter", filtersCss(fo));
    } else if (a === "addstop" || a === "delstop") {
      var g = gradOf(c.backgroundImage); if (!g) return;
      if (a === "addstop") { var last = g.stops[g.stops.length - 1]; g.stops.push({ c: { r: last.c.r, g: last.c.g, b: last.c.b, a: last.c.a }, p: 100 }); if (g.stops.length > 1) g.stops[g.stops.length - 2].p = Math.min(g.stops[g.stops.length - 2].p, 75); }
      else g.stops.splice(+b.dataset.fxgs, 1);
      nd.style.backgroundImage = gradCss(g);
    }
    done(); setTimeout(function () { edProps(); }, 20);
  }
  var PROPS = document.querySelector("#edProps");
  if (PROPS) { PROPS.addEventListener("input", onEdit, true); PROPS.addEventListener("change", onEdit, true); PROPS.addEventListener("click", onClick, true); }
  window.__mdFx = { shownMatrix: shownMatrix, tfShown: tfShown, shadowsOf: shadowsOf, shadowsCss: shadowsCss, filtersOf: filtersOf, filtersCss: filtersCss, tf2: tf2, tfCss: tfCss, gradOf: gradOf, gradCss: gradCss, varsOf: varsOf };
})();
