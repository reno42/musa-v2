/* bridge-photo-tools.js — las herramientas del editor de fotos, de verdad (antes varias solo «se elegían»).
 *  · Selecciones: marco (rectángulo, elipse, fila, columna), lazo (libre y poligonal), varita y selección rápida.
 *    Shift suma, Alt resta. Limitan la pintura, el retoque, el relleno y los filtros; se copian a una capa, recortan,
 *    se vuelven máscara de revelado o máscara de capa.
 *  · Retoque (no destructivo, en la capa «Retoque» que va DEBAJO del revelado): corrector puntual, pincel corrector,
 *    parche, ojos rojos, tampón de clonar, pincel de historial, desenfocar / enfocar / dedo, exponer / quemar / esponja,
 *    sustitución de color.
 *  · Capas: pintura, texto (tipografía completa), imagen y forma vectorial; mover, escalar y girar en el lienzo;
 *    pluma y selección de trazado; máscara de capa.
 *  · Filtros (pila tipo Photoshop, pestaña Filtros) y máscaras de luminancia y de color.
 */
(function boot(n) {
  "use strict";
  var X = window.__phx, PC = window.MusaPhotoCode;
  if (!X || !X.ready || !X.code) { if ((n || 0) < 900) setTimeout(function () { boot((n || 0) + 1); }, 150); return; }
  if (X.tools) return;
  X.tools = true;
  var esc = X.esc, say = X.say, clamp = PC.clamp, clone = PC.clone;
  function lw() { return X.lres()[0]; } function lh() { return X.lres()[1]; }
  function kScale() { return lw() / (PH.base ? PH.base.w : lw()); }   /* px de capa por px de vista */

  /* ═════════════ riel: nada simulado ni «pronto» ═════════════ */
  PH_SIM.clear();
  var DROP = {};
  PH_TOOLS.forEach(function (t) {
    if (DROP[t[0]]) t[3] = t[3].filter(function (v) { return DROP[t[0]].indexOf(v[0]) < 0; });
    t[3].forEach(function (v) { if (v.length > 2) v.length = 2; });
    if (t[0] === "pathsel") { t[1] = "Selección de trazado"; t[3] = [["path", "Mover los puntos de una forma"]]; }
    if (t[0] === "quicksel") t[3] = [["quick", "Selección rápida (arrastra sobre la zona)"], ["wand", "Varita mágica (clic)"]];
    if (t[0] === "heal") t[3] = [["spot", "Corrector puntual (clic sobre la mancha)"], ["heal", "Pincel corrector (Alt+clic define el origen)"], ["patch", "Parche (Alt+clic: de dónde copiar)"], ["redeye", "Ojos rojos"]];
    if (t[0] === "history") { t[1] = "Pincel de historial"; t[3] = [["history", "Pincel de historial (devuelve el original)"], ["arthistory", "Pincel histórico de arte"]]; }
    if (t[0] === "shapes") t[3] = [["rect", "Rectángulo"], ["ellipse", "Elipse"], ["line", "Línea"]];
    if (t[0] === "pen") t[3] = [["pen", "Pluma (clic a clic; Enter o doble clic cierra)"], ["freeform", "Pluma libre (arrastra)"], ["curvature", "Pluma de curvatura (curvas suaves con cada clic)"]];
    if (t[0] === "move") t[3] = [["move", "Mover"], ["artboard", "Mesa de trabajo (tamaño del lienzo)"]];
    if (t[0] === "lasso") t[3] = [["free", "Lazo"], ["poly", "Lazo poligonal"], ["magnetic", "Lazo magnético (se pega a los bordes)"]];
    if (t[0] === "crop") t[3] = [["crop", "Recorte"], ["perspective", "Recorte en perspectiva"], ["slice", "Segmentar (cortes para exportar)"]];
    if (t[0] === "eyedropper") t[3] = [["picker", "Cuentagotas"], ["sampler", "Muestras de color (hasta 10)"], ["ruler", "Regla (mide y endereza)"]];
    if (t[0] === "hand") t[3] = [["hand", "Mano (pan)"], ["rotate", "Rotar vista (Esc la endereza)"]];
    if (t[0] === "clone") t[3] = [["clone", "Tampón de clonar (Alt+clic define el origen)"], ["pattern", "Tampón de motivo"]];
    if (t[0] === "type") t[3] = [["type", "Texto (clic coloca)"], ["typevert", "Texto vertical"], ["typemask", "Máscara de texto (selección con forma de letras)"]];
    if (t[0] === "eraser") t[3] = [["eraser", "Borrador"], ["magic", "Borrador mágico (clic borra por color)"], ["bgeraser", "Borrador de fondo (borra el color bajo el cursor)"]];
    if (t[0] === "brush") t[3] = [["brush", "Pincel"], ["pencil", "Lápiz"], ["colorreplace", "Sustitución de color"], ["mixer", "Pincel mezclador"]];
  });
  ["pen"].forEach(function (g) { PH_PAINT.add(g); });
  var RETOUCH = { heal: 1, clone: 1, history: 1, blur: 1, dodge: 1 };
  var SELT = { marquee: 1, lasso: 1, quicksel: 1 };
  var BRUSHY = { heal: 1, clone: 1, history: 1, blur: 1, dodge: 1, brush: 1, eraser: 1 };
  Object.assign(PH.brush, { str: 50, tol: 32, feather: 0 });
  function isRetouch() { return (RETOUCH[PH.tool] && !(PH.tool === "history" && phVar("history") === "arthistory")) || (PH.tool === "brush" && phVar("brush") === "colorreplace"); }
  function brushy() { var g = PH.tool; if (g === "quicksel") return phVar("quicksel") === "quick"; if (g === "eraser") return phVar("eraser") !== "magic"; if (g === "heal") return true; return !!BRUSHY[g]; }

  /* ═════════════ superposición propia (hormigas de la selección, caja de transformación, pluma) ═════════════ */
  var ov = document.createElement("div"); ov.id = "phXOv"; ov.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:3";
  ov.innerHTML = '<canvas id="phSelOv" style="position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated"></canvas><svg id="phXSvg" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible"></svg>';
  phImg.appendChild(ov);
  var selOv = ov.querySelector("#phSelOv"), svg = ov.querySelector("#phXSvg");
  var st2 = document.createElement("style");
  st2.textContent = "#phXSvg .hd{fill:#fff;stroke:#ff5e00;stroke-width:1.5;pointer-events:all;cursor:pointer}#phXSvg .bx{fill:none;stroke:#ff5e00;stroke-width:1.5;vector-effect:non-scaling-stroke}#phXSvg .pn{fill:none;stroke:#ff5e00;stroke-width:1.5;vector-effect:non-scaling-stroke}#phXSvg .src{fill:none;stroke:#fff;stroke-width:1.5;vector-effect:non-scaling-stroke}"
    + ".phx-f{border:1px solid #2c2c2c;border-radius:8px;margin:8px 12px;background:#161616}.phx-f.off{opacity:.55}.phx-fh{display:flex;align-items:center;gap:6px;padding:6px 8px}.phx-fh b{flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.phx-fh button{width:22px;height:22px;border:0;border-radius:5px;background:transparent;color:#bbb;cursor:pointer}.phx-fh button:hover{background:#2a2a2a;color:#fff}"
    + ".phx-f .ph-sl{padding:2px 8px}.phx-f textarea{width:calc(100% - 16px);margin:4px 8px;min-height:92px;background:#0d0d0d;color:#e6e6e6;border:1px solid #333;border-radius:6px;padding:6px;font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;white-space:pre;resize:vertical}"
    + ".phx-k{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:4px 8px}.phx-k.k5{grid-template-columns:repeat(5,1fr)}.phx-k input,.phx-f input[type=text]{width:100%;height:24px;background:#0d0d0d;border:1px solid #333;border-radius:5px;color:#fff;font:11px ui-monospace,monospace;text-align:center;box-sizing:border-box}"
    + ".phx-row2{display:flex;gap:6px;align-items:center;padding:4px 8px 8px;flex-wrap:wrap;font-size:11px;color:#aaa}.phx-row2 button,.phx-add select{height:26px;border-radius:6px;border:1px solid #3a3a3a;background:#222;color:#eee;padding:0 8px;font:600 11px Inter,system-ui,sans-serif;cursor:pointer}.phx-add{padding:12px 12px 4px;display:flex;gap:6px}.phx-add select{flex:1}"
    + ".phx-err{color:#ff8a70;font-size:11px;padding:0 8px 6px}";
  document.head.appendChild(st2);

  /* ═════════════ selección ═════════════ */
  var SEL = { cv: null, has: false, edge: null, ew: 0, eh: 0, phase: 0 };
  function selCanvas() { var w = lw(), h = lh(); if (!SEL.cv || SEL.cv.width !== w || SEL.cv.height !== h) { var o = SEL.cv; SEL.cv = phCanvas(w, h); if (o && SEL.has) SEL.cv.getContext("2d").drawImage(o, 0, 0, w, h); } return SEL.cv; }
  function selChanged() {
    var c = selCanvas(), k = Math.min(1, 700 / Math.max(c.width, c.height)), w = Math.max(1, Math.round(c.width * k)), h = Math.max(1, Math.round(c.height * k)), t = phCanvas(w, h), g = t.getContext("2d");
    g.drawImage(c, 0, 0, w, h);
    var d = g.getImageData(0, 0, w, h).data, e = [], any = false;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var i = (y * w + x) * 4 + 3; if (d[i] < 128) continue; any = true;
      if (!x || !y || x === w - 1 || y === h - 1 || d[i - 4] < 128 || d[i + 4] < 128 || d[i - w * 4] < 128 || d[i + w * 4] < 128) e.push(x, y);
    }
    SEL.has = any; SEL.edge = any ? e : null; SEL.ew = w; SEL.eh = h;
    drawAnts(); if (PH.open) { phBar(); }
  }
  function drawAnts() {
    if (selOv.width !== SEL.ew || selOv.height !== SEL.eh) { selOv.width = SEL.ew || 1; selOv.height = SEL.eh || 1; }
    var g = selOv.getContext("2d"); g.clearRect(0, 0, selOv.width, selOv.height);
    if (!SEL.edge || PH.mode === "crop") return;
    var e = SEL.edge, p = SEL.phase;
    g.fillStyle = "#fff"; for (var i = 0; i < e.length; i += 2) if (((e[i] + e[i + 1] + p) >> 2) & 1) g.fillRect(e[i], e[i + 1], 1, 1);
    g.fillStyle = "#000"; for (i = 0; i < e.length; i += 2) if (!(((e[i] + e[i + 1] + p) >> 2) & 1)) g.fillRect(e[i], e[i + 1], 1, 1);
  }
  setInterval(function () { if (PH.open && SEL.edge && !document.hidden) { SEL.phase = (SEL.phase + 1) % 8; drawAnts(); } }, 160);
  function selClear(snap) { if (!SEL.has) return; if (snap !== false) phSnap(); selCanvas().getContext("2d").clearRect(0, 0, SEL.cv.width, SEL.cv.height); selChanged(); }
  function selAll() { phSnap(); var c = selCanvas(), g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); selChanged(); }
  function selInvert() { if (!SEL.has) return selAll(); phSnap(); var c = selCanvas(), g = c.getContext("2d"); g.globalCompositeOperation = "xor"; g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.globalCompositeOperation = "source-over"; selChanged(); }
  function selFeather(px) {
    if (!SEL.has || !(px > 0)) return; phSnap();
    var c = selCanvas(), g = c.getContext("2d"), d = g.getImageData(0, 0, c.width, c.height), b = PC.gauss(d.data, c.width, c.height, px * kScale());
    for (var i = 0; i < b.length; i += 4) { b[i] = b[i + 1] = b[i + 2] = 255; }
    g.putImageData(new ImageData(b, c.width, c.height), 0, 0); selChanged();
  }
  /* dibuja una figura en la selección: mode replace | add | sub */
  function selDraw(mode, fn) {
    var c = selCanvas(), g = c.getContext("2d");
    if (mode === "replace") g.clearRect(0, 0, c.width, c.height);
    g.save(); g.globalCompositeOperation = mode === "sub" ? "destination-out" : "source-over"; g.fillStyle = "#fff"; fn(g, c.width, c.height); g.restore();
  }
  function selMode(e) { return e.altKey ? "sub" : e.shiftKey ? "add" : "replace"; }
  X.selGet = function () { return SEL.has ? X.copyCv(SEL.cv) : null; };
  X.selSet = function (cv) { var c = selCanvas(), g = c.getContext("2d"); g.clearRect(0, 0, c.width, c.height); if (cv) g.drawImage(cv, 0, 0, c.width, c.height); selChanged(); };
  X.sel = SEL;
  /* recorta un lienzo a la selección (si hay) */
  function clipSel(cv) { if (!SEL.has) return cv; var g = cv.getContext("2d"); g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = "destination-in"; g.drawImage(SEL.cv, 0, 0, cv.width, cv.height); g.restore(); return cv; }
  /* lo que se ve (revelado + capas) a tamaño de vista, para varita, bote y cuentagotas */
  function compData() { var cv = phFlatten(PH_WORK); return { cv: cv, d: cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data, w: cv.width, h: cv.height }; }
  function flood(C, x0, y0, tol, limit) {
    var w = C.w, h = C.h, d = C.d, m = new Uint8Array(w * h), i0 = (y0 * w + x0) * 4, r0 = d[i0], g0 = d[i0 + 1], b0 = d[i0 + 2], t2 = tol * tol * 3, q = [y0 * w + x0];
    m[q[0]] = 1;
    while (q.length) {
      var p = q.pop(), x = p % w, y = (p - x) / w;
      for (var k = 0; k < 4; k++) {
        var nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (limit && ((nx - x0) * (nx - x0) + (ny - y0) * (ny - y0)) > limit * limit) continue;
        var j = ny * w + nx; if (m[j]) continue;
        var i = j * 4, dr = d[i] - r0, dg = d[i + 1] - g0, db = d[i + 2] - b0;
        if (dr * dr + dg * dg + db * db <= t2) { m[j] = 1; q.push(j); }
      }
    }
    return m;
  }
  function maskToCanvas(m, w, h) { var c = phCanvas(w, h), g = c.getContext("2d"), id = g.createImageData(w, h); for (var i = 0; i < m.length; i++) if (m[i]) { id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255; id.data[i * 4 + 3] = 255; } g.putImageData(id, 0, 0); return c; }

  /* ═════════════ capa de retoque (debajo del revelado) ═════════════ */
  var RT = { comp: null, key: "" };
  function retouchLayer(create) {
    var L = phLayers().find(function (q) { return q.pre && q.kind === "paint"; });
    if (!L && create) { var keep = PH.layer; L = phNewLayer("paint", { pre: true, name: "Retoque" }); var ls = phLayers(); ls.splice(ls.indexOf(L), 1); ls.unshift(L); PH.layer = keep; phMountLayers(); }
    return L;
  }
  /* la foto antes del revelado (fuente + geometría) a tamaño de capa, con el retoque encima */
  function preComp(L) {
    var w = lw(), h = lh(), key = PH.key + "|" + JSON.stringify(PH.r.geo) + "|" + w;
    if (!RT.base || RT.key !== key) {
      var keepVis = phLayers().filter(function (q) { return q.pre; }).map(function (q) { var v = q.vis; q.vis = false; return [q, v]; });
      var B = phBuild(PH.src, PH.r.geo, Math.max(w, h)); keepVis.forEach(function (p) { p[0].vis = p[1]; });
      RT.base = phCanvas(w, h); RT.base.getContext("2d").drawImage(B.cv, 0, 0, w, h); RT.key = key;
    }
    var c = phCanvas(w, h), g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(RT.base, 0, 0); if (L) g.drawImage(L.cv, 0, 0);
    return c;
  }
  function falloff(d, cx, cy, rad, hard, str) {
    /* peso 0–1 por píxel del parche (d×d) */
    var n = d * d, w = new Float32Array(n), inner = rad * hard;
    for (var y = 0; y < d; y++) for (var x = 0; x < d; x++) { var dist = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)); w[y * d + x] = dist >= rad ? 0 : dist <= inner ? str : str * (1 - (dist - inner) / Math.max(0.001, rad - inner)); }
    return w;
  }
  function ringMean(px, d, rad) {
    var s = [0, 0, 0], n = 0, c = d / 2;
    for (var y = 0; y < d; y += 2) for (var x = 0; x < d; x += 2) { var q = Math.sqrt((x - c) * (x - c) + (y - c) * (y - c)); if (q > rad * 0.75 && q <= rad) { var i = (y * d + x) * 4; s[0] += px[i]; s[1] += px[i + 1]; s[2] += px[i + 2]; n++; } }
    return n ? [s[0] / n, s[1] / n, s[2] / n] : [0, 0, 0];
  }
  /* un toque de retoque en (px,py) del lienzo de capa. S = estado del trazo */
  function dab(S, px, py) {
    var g = S.g, rad = S.rad, d = Math.max(4, Math.ceil(rad * 2) + 2), x0 = Math.round(px - d / 2), y0 = Math.round(py - d / 2), W = S.comp.width, H = S.comp.height;
    var id = g.getImageData(x0, y0, d, d), p = id.data, wgt = falloff(d, d / 2, d / 2, rad, S.hard, S.str), out = new Uint8ClampedArray(p), i, k, t = S.tool, v = S.v;
    if (t === "blur" && v === "blur") { var b = PC.gauss(p, d, d, Math.max(1, rad * 0.18)); out.set(b); }
    else if (t === "blur" && v === "sharpen") { var bl = PC.gauss(p, d, d, Math.max(0.8, rad * 0.06)); for (i = 0; i < p.length; i += 4) for (k = 0; k < 3; k++) out[i + k] = p[i + k] + (p[i + k] - bl[i + k]) * 1.4; }
    else if (t === "blur" && v === "smudge") { if (S.carry && S.carry.length === p.length) for (i = 0; i < p.length; i += 4) for (k = 0; k < 3; k++) out[i + k] = p[i + k] * 0.25 + S.carry[i + k] * 0.75; S.carry = new Uint8ClampedArray(out); }
    else if (t === "dodge" && v === "dodge") { for (i = 0; i < p.length; i += 4) for (k = 0; k < 3; k++) out[i + k] = p[i + k] + (255 - p[i + k]) * 0.35 * (p[i + k] / 255 + 0.25); }
    else if (t === "dodge" && v === "burn") { for (i = 0; i < p.length; i += 4) for (k = 0; k < 3; k++) out[i + k] = p[i + k] * (1 - 0.35 * (1.25 - p[i + k] / 255)); }
    else if (t === "dodge" && v === "sponge") { var sat = S.alt ? 0.45 : 1.6; for (i = 0; i < p.length; i += 4) { var l = p[i] * 0.2126 + p[i + 1] * 0.7152 + p[i + 2] * 0.0722; for (k = 0; k < 3; k++) out[i + k] = l + (p[i + k] - l) * sat; } }
    else if (t === "brush") { var c = phHex(PH.front), cl = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722 || 1; for (i = 0; i < p.length; i += 4) { var l2 = p[i] * 0.2126 + p[i + 1] * 0.7152 + p[i + 2] * 0.0722, f = l2 / cl; out[i] = c[0] * f; out[i + 1] = c[1] * f; out[i + 2] = c[2] * f; } }
    else if (t === "heal" && v === "redeye") { for (i = 0; i < p.length; i += 4) { var mx = Math.max(p[i + 1], p[i + 2]); if (p[i] > 60 && p[i] > mx * 1.45) out[i] = (p[i + 1] + p[i + 2]) / 2; } }
    else if (t === "clone" || t === "heal") {
      var ox = S.off[0], oy = S.off[1];
      if (t === "heal" && v === "spot") {
        /* origen automático: la zona vecina cuyo borde se parece más al de la mancha */
        var dm = ringMean(p, d, rad), best = null;
        for (var a = 0; a < 8; a++) { var dx = Math.round(Math.cos(a * Math.PI / 4) * rad * 2.3), dy = Math.round(Math.sin(a * Math.PI / 4) * rad * 2.3), sx = x0 + dx, sy = y0 + dy; if (sx < 0 || sy < 0 || sx + d > W || sy + d > H) continue; var sp = g.getImageData(sx, sy, d, d).data, sm = ringMean(sp, d, rad), df = Math.abs(sm[0] - dm[0]) + Math.abs(sm[1] - dm[1]) + Math.abs(sm[2] - dm[2]); if (!best || df < best[0]) best = [df, dx, dy]; }
        if (!best) return; ox = best[1]; oy = best[2];
      }
      var src = g.getImageData(x0 + ox, y0 + oy, d, d).data;
      if (t === "heal") { var m1 = ringMean(p, d, rad), m2 = ringMean(src, d, rad); for (i = 0; i < p.length; i += 4) for (k = 0; k < 3; k++) out[i + k] = src[i + k] + (m1[k] - m2[k]); }
      else out.set(src);
    }
    else if (t === "history") {
      /* devuelve el original: borra el retoque en esa zona */
      var Lc = S.L.cv.getContext("2d"), er = phCanvas(d, d), eg = er.getContext("2d"), eid = eg.createImageData(d, d);
      for (i = 0; i < wgt.length; i++) { eid.data[i * 4 + 3] = wgt[i] * 255; }
      eg.putImageData(eid, 0, 0); if (SEL.has) { eg.globalCompositeOperation = "destination-in"; eg.drawImage(SEL.cv, x0, y0, d, d, 0, 0, d, d); }
      Lc.save(); Lc.globalCompositeOperation = "destination-out"; Lc.drawImage(er, x0, y0); Lc.restore();
      g.drawImage(S.base, x0, y0, d, d, x0, y0, d, d); g.drawImage(S.L.cv, x0, y0, d, d, x0, y0, d, d);
      return;
    }
    /* parche con caída suave, limitado a la selección → a la capa de retoque y a la mezcla de trabajo */
    var pc = phCanvas(d, d), pg = pc.getContext("2d"), pid = pg.createImageData(d, d);
    for (i = 0; i < wgt.length; i++) { var j = i * 4; pid.data[j] = out[j]; pid.data[j + 1] = out[j + 1]; pid.data[j + 2] = out[j + 2]; pid.data[j + 3] = wgt[i] * 255; }
    pg.putImageData(pid, 0, 0);
    if (SEL.has) { pg.globalCompositeOperation = "destination-in"; pg.drawImage(SEL.cv, x0, y0, d, d, 0, 0, d, d); }
    S.L.cv.getContext("2d").drawImage(pc, x0, y0); g.drawImage(pc, x0, y0);
  }

  /* ═════════════ caja de transformación de capas (mover, escalar, girar) ═════════════ */
  var mctx = phCanvas(4, 4).getContext("2d");
  function textBox(L) {
    var t = L.text, H = lh(), W = lw(), px = t.size * H, lines = String(t.s).split("\n"), mw = 0;
    mctx.font = (t.italic ? "italic " : "") + (t.weight || 400) + " " + px + "px " + ((typeof FONTS !== "undefined" && FONTS[t.font]) || t.font);
    lines.forEach(function (l) { mw = Math.max(mw, mctx.measureText(l).width + (t.ls || 0) * px * l.length); });
    var w = t.vert ? lines.length * px * 1.1 : mw, h = t.vert ? Math.max.apply(null, lines.map(function (l) { return l.length; })) * px * 1.05 : lines.length * px * (t.lh || 1.15);
    var ax = t.vert ? 0 : t.align === "center" ? -w / 2 : t.align === "right" ? -w : 0;
    return { x: t.x + ax / W, y: t.y, w: Math.max(w, px * 0.5) / W, h: h / H, rot: t.rot || 0, ox: t.x, oy: t.y };
  }
  function ptsBox(pts) { var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; pts.forEach(function (p) { for (var i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); } }); return { x: x0, y: y0, w: Math.max(1e-4, x1 - x0), h: Math.max(1e-4, y1 - y0), rot: 0 }; }
  function boxOf(L) { if (!L) return null; if (L.kind === "text") return textBox(L); if (L.kind === "shape" && L.shape.pts) return ptsBox(L.shape.pts); if ((L.kind === "image" || L.kind === "shape") && L.box) return L.box; return null; }
  function inBox(b, u, v) {
    var W = lw(), H = lh(), cx = (b.ox != null ? b.ox : b.x + b.w / 2) * W, cy = (b.oy != null ? b.oy : b.y + b.h / 2) * H, a = -(b.rot || 0) * Math.PI / 180, dx = u * W - cx, dy = v * H - cy, rx = dx * Math.cos(a) - dy * Math.sin(a) + cx, ry = dx * Math.sin(a) + dy * Math.cos(a) + cy;
    return rx >= b.x * W - 6 && rx <= (b.x + b.w) * W + 6 && ry >= b.y * H - 6 && ry <= (b.y + b.h) * H + 6;
  }
  function hitLayer(u, v) { var ls = phLayers(); for (var i = ls.length - 1; i >= 0; i--) { var L = ls[i]; if (!L.vis || L.lock || L.pre) continue; var b = boxOf(L); if (b && inBox(b, u, v)) return L; } return null; }
  var PEN = { pts: null };
  function drawSvg() {
    var h = "", L = phActive(), W = 1000, H = 1000 * (lh() / lw());
    svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("preserveAspectRatio", "none");
    var hs = Math.max(5, 7 / (PH.s || 1) * (1000 / (PH.base ? PH.base.w : 1000)));
    if (PH.mode === "compose" && L && !L.pre && (PH.tool === "move" || PH.tool === "pathsel" || PH.tool === "type" || PH.tool === "shapes")) {
      var b = boxOf(L);
      if (b) {
        var cx = (b.ox != null ? b.ox : b.x + b.w / 2) * W, cy = (b.oy != null ? b.oy : b.y + b.h / 2) * H;
        h += '<g transform="rotate(' + (b.rot || 0) + " " + cx + " " + cy + ')"><rect class="bx" x="' + b.x * W + '" y="' + b.y * H + '" width="' + b.w * W + '" height="' + b.h * H + '"/>';
        if (PH.tool === "move") {
          [[0, 0, "nw"], [1, 0, "ne"], [1, 1, "se"], [0, 1, "sw"]].forEach(function (c) { h += '<rect class="hd" data-th="' + c[2] + '" x="' + ((b.x + b.w * c[0]) * W - hs / 2) + '" y="' + ((b.y + b.h * c[1]) * H - hs / 2) + '" width="' + hs + '" height="' + hs + '" style="cursor:' + c[2] + '-resize"/>'; });
          if (!(L.kind === "shape" && L.shape.pts)) h += '<line class="bx" x1="' + (b.x + b.w / 2) * W + '" y1="' + b.y * H + '" x2="' + (b.x + b.w / 2) * W + '" y2="' + (b.y * H - hs * 3) + '"/><circle class="hd" data-th="rot" cx="' + (b.x + b.w / 2) * W + '" cy="' + (b.y * H - hs * 3) + '" r="' + hs * 0.6 + '" style="cursor:grab"/>';
        }
        h += "</g>";
      }
      if (PH.tool === "pathsel" && L.kind === "shape" && L.shape.pts) L.shape.pts.forEach(function (p, i) { h += '<circle class="hd" data-pp="' + i + '" cx="' + p[0] * W + '" cy="' + p[1] * H + '" r="' + hs * 0.6 + '" style="cursor:move"/>'; });
    }
    if (PEN.pts && PEN.pts.length) { h += '<polyline class="pn" points="' + PEN.pts.concat(PEN.cur ? [PEN.cur] : []).map(function (p) { return p[0] * W + "," + p[1] * H; }).join(" ") + '"/>'; PEN.pts.forEach(function (p, i) { h += '<circle class="hd" cx="' + p[0] * W + '" cy="' + p[1] * H + '" r="' + hs * (i ? 0.45 : 0.75) + '"/>'; }); }
    if (X.cloneSrc && (PH.tool === "clone" || (PH.tool === "heal" && phVar("heal") !== "spot" && phVar("heal") !== "redeye"))) h += '<circle class="src" cx="' + X.cloneSrc[0] * W + '" cy="' + X.cloneSrc[1] * H + '" r="' + hs + '"/><line class="src" x1="' + (X.cloneSrc[0] * W - hs * 1.6) + '" y1="' + X.cloneSrc[1] * H + '" x2="' + (X.cloneSrc[0] * W + hs * 1.6) + '" y2="' + X.cloneSrc[1] * H + '"/><line class="src" y1="' + (X.cloneSrc[1] * H - hs * 1.6) + '" x1="' + X.cloneSrc[0] * W + '" y2="' + (X.cloneSrc[1] * H + hs * 1.6) + '" x2="' + X.cloneSrc[0] * W + '"/>';
    if (LASSO && LASSO.length > 1) h += '<polyline class="pn" stroke-dasharray="4 3" points="' + LASSO.concat(PEN.lcur ? [PEN.lcur] : []).map(function (p) { return p[0] * W + "," + p[1] * H; }).join(" ") + '"/>';
    if (svg.innerHTML !== h) svg.innerHTML = h;
    svg.style.pointerEvents = "none";
  }
  var LASSO = null;
  var _overlay = phOverlay;
  phOverlay = function () { var r = _overlay.apply(this, arguments); try { drawSvg(); drawAnts(); } catch (e) { /* superposición */ } return r; };

  /* ═════════════ puntero ═════════════ */
  var down = false; X.pointerDown = function () { return down; };
  addEventListener("pointerup", function () { down = false; }, true); addEventListener("pointercancel", function () { down = false; }, true);
  function activePaint() { var L = phActive(); if (!L || L.kind !== "paint" || L.pre || L.lock) { L = phNewLayer("paint"); } return L; }
  function redrawSoon(L) { if (L && L.pre) X.touchPre(); else if (L && L.mcv) phMountLayers(); }
  function onDown(e) {
    if (!PH.open || !PH.base || e.button === 2) return;
    if (e.target.closest && e.target.closest("#phInfo button")) return;
    down = true;
    try { window.focus(); if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur && !document.activeElement.closest("#phCode")) document.activeElement.blur(); } catch (er) { /* sin foco */ }
    if (X.toolDown && X.toolDown(e)) return stop(e);
    var g = PH.tool, v = phVar(g), p = phPt(e), u = p.u, vv = p.v, inImg = u >= 0 && u <= 1 && vv >= 0 && vv <= 1;
    if (phSpace || e.button === 1 || g === "hand" || g === "zoom" || PH.wbPick || PH.mode === "crop" || PH.mode === "brush") return;
    if (e.target.closest && e.target.closest("[data-ch],[data-mh],[data-split]")) return;
    var W = lw(), H = lh(), handled = true;
    var th = e.target.closest && e.target.closest("[data-th],[data-pp]");

    /* ── selecciones ── */
    if (g === "marquee") {
      var mode = selMode(e), prev = SEL.has && mode !== "replace" ? X.copyCv(SEL.cv) : null; phSnap();
      var draw = function (q) {
        selDraw("replace", function (c) { if (prev) c.drawImage(prev, 0, 0); });
        selDraw(mode === "replace" ? "add" : mode, function (c, w, h) {
          var x0 = Math.min(u, q.u) * w, y0 = Math.min(vv, q.v) * h, ww = Math.abs(q.u - u) * w, hh = Math.abs(q.v - vv) * h;
          if (e.shiftKey && mode === "replace") { var s = Math.max(ww, hh); ww = hh = s; }
          c.beginPath();
          if (v === "ellipse") c.ellipse(x0 + ww / 2, y0 + hh / 2, ww / 2, hh / 2, 0, 0, 7);
          else if (v === "row") c.rect(0, Math.round(q.v * h), w, Math.max(1, Math.round(kScale())));
          else if (v === "col") c.rect(Math.round(q.u * w), 0, Math.max(1, Math.round(kScale())), h);
          else c.rect(x0, y0, ww, hh);
          c.fill();
        });
        selChanged();
      };
      if (v === "row" || v === "col") draw(p);
      phDrag(e, function (ev) { draw(phPt(ev)); }, function (ev) { var q = phPt(ev); if (v !== "row" && v !== "col" && Math.abs(q.u - u) < 0.004 && Math.abs(q.v - vv) < 0.004 && mode === "replace") { selDraw("replace", function () {}); selChanged(); } if (PH.brush.feather) featherQuiet(); });
    }
    else if (g === "lasso") {
      var md = selMode(e);
      if (v === "poly") {
        if (!LASSO) { phSnap(); LASSO = [[u, vv]]; LASSO.mode = md; }
        else { var f0 = LASSO[0]; if (LASSO.length > 2 && Math.hypot((u - f0[0]) * W, (vv - f0[1]) * H) < 12 * kScale() || e.detail >= 2) { closeLasso(); } else LASSO.push([u, vv]); }
        drawSvg();
      } else {
        phSnap(); LASSO = [[u, vv]]; LASSO.mode = md;
        phDrag(e, function (ev) { var q = phPt(ev); LASSO.push([q.u, q.v]); drawSvg(); }, function () { closeLasso(); });
      }
    }
    else if (g === "quicksel") {
      if (!inImg) return stop(e);
      var C = compData(), m2 = selMode(e); phSnap();
      var add = function (q, first) {
        var x = clamp(Math.floor(q.u * C.w), 0, C.w - 1), y = clamp(Math.floor(q.v * C.h), 0, C.h - 1);
        var mk = maskToCanvas(flood(C, x, y, PH.brush.tol, v === "quick" ? Math.max(12, PH.brush.size * 3) : 0), C.w, C.h);
        selDraw(first && m2 === "replace" ? "replace" : m2 === "sub" ? "sub" : "add", function (c, w, h) { c.imageSmoothingEnabled = true; c.drawImage(mk, 0, 0, w, h); });
        selChanged();
      };
      add(p, true);
      if (v === "quick") { var lastQ = p; phDrag(e, function (ev) { var q = phPt(ev); if (Math.hypot((q.u - lastQ.u) * C.w, (q.v - lastQ.v) * C.h) < PH.brush.size * 0.5) return; lastQ = q; if (q.u >= 0 && q.u <= 1 && q.v >= 0 && q.v <= 1) add(q, false); }, function () { if (PH.brush.feather) featherQuiet(); }); }
      else if (PH.brush.feather) featherQuiet();
    }
    /* ── retoque (capa «Retoque», bajo el revelado) ── */
    else if (isRetouch()) {
      if (!inImg) return stop(e);
      var needSrc = g === "clone" || (g === "heal" && (v === "heal" || v === "patch"));
      if (needSrc && e.altKey) { X.cloneSrc = [u, vv]; drawSvg(); phToast("Origen definido: ahora pinta donde quieres copiarlo"); return stop(e); }
      if (needSrc && !X.cloneSrc) { phToast("Primero Alt+clic sobre la zona de donde quieres copiar"); return stop(e); }
      var L = retouchLayer(true); phSnapLayer(L);
      var comp = preComp(L), S = { L: L, comp: comp, base: RT.base, g: comp.getContext("2d", { willReadFrequently: true }), tool: g, v: g === "brush" ? "colorreplace" : v, rad: Math.max(2, PH.brush.size / 2 * kScale()), hard: g === "clone" ? Math.max(0.5, PH.brush.hard / 100) : 0.35, str: clamp(PH.brush.str / 100, 0.05, 1), alt: e.altKey, off: needSrc ? [Math.round((X.cloneSrc[0] - u) * W), Math.round((X.cloneSrc[1] - vv) * H)] : [0, 0] };
      if (g === "clone" || g === "heal" || g === "history") S.str = g === "history" ? S.str : 1;
      var lp = p, raf = 0, pend = function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; X.touchPre(); }); };
      dab(S, u * W, vv * H); pend();
      var single = g === "heal" && (v === "spot" || v === "redeye");
      phDrag(e, function (ev) {
        var q = phPt(ev), dist = Math.hypot((q.u - lp.u) * W, (q.v - lp.v) * H), step = Math.max(2, S.rad * (single ? 0.9 : 0.35)), nn = Math.floor(dist / step);
        for (var k = 1; k <= nn; k++) dab(S, (lp.u + (q.u - lp.u) * k / nn) * W, (lp.v + (q.v - lp.v) * k / nn) * H);
        if (nn) { lp = q; pend(); }
        phMoveCursor(ev);
      }, function () { L._touched = true; X.touchPre(); phInsp(); if (X.onChange) X.onChange("paint"); });
    }
    /* ── mover / transformar capas ── */
    else if (g === "move" || g === "pathsel") {
      if (PH.mode !== "compose") return;
      var Lm = phActive(), pp = th && th.dataset.pp != null ? +th.dataset.pp : -1, hd = th && th.dataset.th;
      if (g === "pathsel") { if (pp < 0 || !Lm || !Lm.shape || !Lm.shape.pts) { var hit0 = hitLayer(u, vv); if (hit0 && hit0.kind === "shape" && hit0.shape.pts) { PH.layer = hit0.id; phAll(); } return stop(e); } phSnapLayer(Lm); var pt0 = Lm.shape.pts[pp].slice(); phDrag(e, function (ev) { var q = phPt(ev), dx = q.u - u, dy = q.v - vv, np = pt0.slice(); for (var i = 0; i < np.length; i += 2) { np[i] = pt0[i] + dx; np[i + 1] = pt0[i + 1] + dy; } if (np.length >= 6) { np[2] = pt0[2]; np[3] = pt0[3]; } Lm.shape.pts[pp] = np; phLayerRender(Lm); drawSvg(); }, function () { phInsp(); }); return stop(e); }
      if (!hd) { var hit = hitLayer(u, vv); if (!hit) { if (SEL.has || !Lm) return; PH.layer = null; phAll(); return; } if (!Lm || hit.id !== Lm.id) { PH.layer = hit.id; Lm = hit; phAll(); } }
      if (!Lm || Lm.lock || Lm.kind === "paint") return;
      phSnapLayer(Lm);
      var b0 = clone(boxOf(Lm)), t0 = Lm.text ? clone(Lm.text) : null, s0 = Lm.shape ? clone(Lm.shape) : null, bx0 = Lm.box ? clone(Lm.box) : null;
      phDrag(e, function (ev) {
        var q = phPt(ev), du = q.u - u, dv = q.v - vv;
        if (!hd) {
          if (t0) { Lm.text.x = t0.x + du; Lm.text.y = t0.y + dv; }
          else if (s0 && s0.pts) Lm.shape.pts = s0.pts.map(function (pt) { var o = pt.slice(); for (var i = 0; i < o.length; i += 2) { o[i] += du; o[i + 1] += dv; } return o; });
          else { Lm.box.x = bx0.x + du; Lm.box.y = bx0.y + dv; }
        } else if (hd === "rot") {
          var cx = (b0.ox != null ? b0.ox : b0.x + b0.w / 2), cy = (b0.oy != null ? b0.oy : b0.y + b0.h / 2), ang = Math.atan2((q.v - cy) * H, (q.u - cx) * W) * 180 / Math.PI + 90;
          if (ev.shiftKey) ang = Math.round(ang / 15) * 15;
          if (t0) Lm.text.rot = Math.round(ang * 10) / 10; else Lm.box.rot = Math.round(ang * 10) / 10;
        } else {
          /* escalar desde la esquina opuesta (en el sistema girado de la caja) */
          var ax = hd.indexOf("w") >= 0 ? b0.x + b0.w : b0.x, ay = hd.indexOf("n") >= 0 ? b0.y + b0.h : b0.y;
          var rr = -(b0.rot || 0) * Math.PI / 180, pcx = (b0.ox != null ? b0.ox : b0.x + b0.w / 2), pcy = (b0.oy != null ? b0.oy : b0.y + b0.h / 2);
          var dx2 = (q.u - pcx) * W, dy2 = (q.v - pcy) * H, lu = (dx2 * Math.cos(rr) - dy2 * Math.sin(rr)) / W + pcx, lv = (dx2 * Math.sin(rr) + dy2 * Math.cos(rr)) / H + pcy;
          var nw = Math.max(0.01, Math.abs(lu - ax)), nh = Math.max(0.01, Math.abs(lv - ay));
          if (t0 || (Lm.kind === "image" && !ev.shiftKey)) { var k = Math.max(nw / b0.w, nh / b0.h); nw = b0.w * k; nh = b0.h * k; }
          if (t0) { Lm.text.size = clamp(t0.size * (nh / b0.h), 0.004, 2); }
          else if (s0 && s0.pts) { var kx = nw / b0.w, ky = nh / b0.h; Lm.shape.pts = s0.pts.map(function (pt) { var o = pt.slice(); for (var i = 0; i < o.length; i += 2) { o[i] = ax + (o[i] - ax) * kx; o[i + 1] = ay + (o[i + 1] - ay) * ky; } return o; }); }
          else { Lm.box.w = nw; Lm.box.h = nh; Lm.box.x = hd.indexOf("w") >= 0 ? ax - nw : ax; Lm.box.y = hd.indexOf("n") >= 0 ? ay - nh : ay; }
        }
        phLayerRender(Lm); drawSvg();
      }, function () { phInsp(); if (X.onChange) X.onChange("layer"); });
    }
    /* ── pintura y formas (Componer) ── */
    else if (g === "brush" || g === "eraser") {
      if (PH.mode !== "compose" || !inImg) return stop(e);
      var Lp = activePaint(), cx2 = Lp.cv.getContext("2d");
      if (g === "eraser" && v === "magic") { var Cm = compData(), mk2 = maskToCanvas(flood(Cm, clamp(Math.floor(u * Cm.w), 0, Cm.w - 1), clamp(Math.floor(vv * Cm.h), 0, Cm.h - 1), PH.brush.tol, 0), Cm.w, Cm.h), tm = phCanvas(W, H); tm.getContext("2d").drawImage(mk2, 0, 0, W, H); clipSel(tm); phSnapLayer(Lp); cx2.save(); cx2.globalCompositeOperation = "destination-out"; cx2.drawImage(tm, 0, 0); cx2.restore(); Lp._touched = true; phInsp(); return stop(e); }
      phSnapLayer(Lp);
      var snap = X.copyCv(Lp.cv), stroke = phCanvas(W, H), fake = { cv: stroke }, er = g === "eraser", bgc = er && v === "bgeraser" ? samplePx(snap, u, vv) : null, r2 = 0;
      var keepHard = PH.brush.hard; if (g === "brush" && v === "pencil") PH.brush.hard = 100;
      var compose = function () {
        r2 = 0;
        var s2 = SEL.has || bgc ? X.copyCv(stroke) : stroke; if (SEL.has) clipSel(s2);
        if (bgc) keepColor(s2, snap, bgc, PH.brush.tol);
        cx2.save(); cx2.setTransform(1, 0, 0, 1, 0, 0); cx2.globalCompositeOperation = "source-over"; cx2.clearRect(0, 0, W, H); cx2.drawImage(snap, 0, 0);
        if (er) cx2.globalCompositeOperation = "destination-out"; cx2.drawImage(s2, 0, 0); cx2.restore();
        if (Lp.mcv) phMountLayers();
      };
      var mv = phStroke(e, function (uu, v2) { phStamp(fake, uu, v2, false); if (!r2) r2 = requestAnimationFrame(compose); });
      phDrag(e, mv, function () { PH.brush.hard = keepHard; compose(); Lp._touched = true; phInsp(); if (X.onChange) X.onChange("paint"); });
    }
    else if (g === "gradient") {
      if (PH.mode !== "compose" || !inImg) return stop(e);
      var Lg = activePaint(), xg = Lg.cv.getContext("2d"); phSnapLayer(Lg);
      var col = phHex(PH.front).join(","), sn = X.copyCv(Lg.cv);
      var put = function (fill) { var t = phCanvas(W, H), tg = t.getContext("2d"); tg.globalAlpha = PH.brush.op / 100; tg.fillStyle = fill(tg); tg.fillRect(0, 0, W, H); clipSel(t); xg.save(); xg.setTransform(1, 0, 0, 1, 0, 0); xg.clearRect(0, 0, W, H); xg.drawImage(sn, 0, 0); xg.drawImage(t, 0, 0); xg.restore(); };
      if (v === "bucket") {
        var Cb = compData(), fm = maskToCanvas(flood(Cb, clamp(Math.floor(u * Cb.w), 0, Cb.w - 1), clamp(Math.floor(vv * Cb.h), 0, Cb.h - 1), PH.brush.tol, 0), Cb.w, Cb.h), t3 = phCanvas(W, H), g3 = t3.getContext("2d");
        g3.drawImage(fm, 0, 0, W, H); g3.globalCompositeOperation = "source-in"; g3.fillStyle = PH.front; g3.fillRect(0, 0, W, H); clipSel(t3);
        xg.save(); xg.globalAlpha = PH.brush.op / 100; xg.drawImage(t3, 0, 0); xg.restore(); Lg._touched = true; phInsp(); return stop(e);
      }
      phDrag(e, function (ev) { var q = phPt(ev); put(function (tg) { var gr = v === "radial" ? tg.createRadialGradient(u * W, vv * H, 0, u * W, vv * H, Math.max(1, Math.hypot((q.u - u) * W, (q.v - vv) * H))) : tg.createLinearGradient(u * W, vv * H, q.u * W, q.v * H); gr.addColorStop(0, "rgba(" + col + ",1)"); gr.addColorStop(1, "rgba(" + col + ",0)"); return gr; }); if (Lg.mcv) phMountLayers(); }, function () { Lg._touched = true; phInsp(); });
    }
    else if (g === "shapes") {
      if (PH.mode !== "compose" || !inImg) return stop(e);
      phSnap();
      var Ls = phNewLayer("shape", { name: v === "ellipse" ? "Elipse" : v === "line" ? "Línea" : "Rectángulo", shape: v === "line" ? { type: "line", pts: [[u, vv], [u, vv]], closed: false, fill: "none", stroke: PH.front, sw: Math.max(0.002, PH.brush.size / 8 / (PH.base.w)), radius: 0 } : { type: v, fill: PH.front, stroke: "none", sw: 0, radius: 0 }, box: v === "line" ? null : { x: u, y: vv, w: 0.002, h: 0.002, rot: 0 }, op: PH.brush.op });
      phDrag(e, function (ev) { var q = phPt(ev); if (v === "line") Ls.shape.pts[1] = [q.u, q.v]; else { var ww = Math.abs(q.u - u), hh = Math.abs(q.v - vv); if (ev.shiftKey) { var s = Math.max(ww * W, hh * H); ww = s / W; hh = s / H; } Ls.box = { x: Math.min(u, q.u), y: Math.min(vv, q.v), w: Math.max(0.002, ww), h: Math.max(0.002, hh), rot: 0 }; } phLayerRender(Ls); },
        function () { var bb = boxOf(Ls); if (bb.w < 0.006 && bb.h < 0.006) { var ls = phLayers(); ls.splice(ls.indexOf(Ls), 1); PH.layer = null; PH.hist.pop(); } phAll(); if (X.onChange) X.onChange("layer"); });
    }
    else if (g === "pen") {
      if (PH.mode !== "compose") return stop(e);
      if (v === "freeform") { PEN.pts = [[u, vv]]; phDrag(e, function (ev) { var q = phPt(ev), l = PEN.pts[PEN.pts.length - 1]; if (Math.hypot((q.u - l[0]) * W, (q.v - l[1]) * H) > 6 * kScale()) { PEN.pts.push([q.u, q.v]); drawSvg(); } }, function () { penClose(true); }); }
      else { if (!PEN.pts) PEN.pts = []; var f = PEN.pts[0]; if (PEN.pts.length > 2 && (Math.hypot((u - f[0]) * W, (vv - f[1]) * H) < 12 * kScale() || e.detail >= 2)) penClose(true); else { PEN.pts.push([u, vv]); drawSvg(); } }
    }
    else if (g === "type") {
      if (PH.mode !== "compose") return stop(e);
      var hitT = hitLayer(u, vv);
      if (hitT && hitT.kind === "text") { PH.layer = hitT.id; phAll(); }
      else { phSnap(); phNewLayer("text", { text: { s: "Texto", x: u, y: vv, size: 0.08, color: PH.front, font: "Anton", weight: 400, vert: v === "typevert" } }); phAll(); }
      setTimeout(function () { var ta = pq("#phInsp").querySelector("[data-ptk=s]"); if (ta) { ta.focus(); ta.select(); } }, 40);
    }
    else handled = false;
    if (handled) stop(e);
  }
  function stop(e) { e.stopImmediatePropagation(); e.preventDefault(); }
  function featherQuiet() { var c = selCanvas(), g = c.getContext("2d"), d = g.getImageData(0, 0, c.width, c.height), b = PC.gauss(d.data, c.width, c.height, PH.brush.feather * kScale()); for (var i = 0; i < b.length; i += 4) b[i] = b[i + 1] = b[i + 2] = 255; g.putImageData(new ImageData(b, c.width, c.height), 0, 0); selChanged(); }
  function samplePx(cv, u, v) { var d = phFlatten(PH_WORK).getContext("2d").getImageData(clamp(Math.floor(u * PH.base.w), 0, PH.base.w - 1), clamp(Math.floor(v * PH.base.h), 0, PH.base.h - 1), 1, 1).data; return [d[0], d[1], d[2]]; }
  /* el borrador de fondo solo borra lo que se parece al color de muestra */
  function keepColor(strokeCv, snap, c, tol) {
    var w = strokeCv.width, h = strokeCv.height, sg = strokeCv.getContext("2d"), sd = sg.getImageData(0, 0, w, h), pd = snap.getContext("2d").getImageData(0, 0, w, h).data, t2 = tol * tol * 3 * 2.2;
    for (var i = 0; i < sd.data.length; i += 4) { if (!sd.data[i + 3]) continue; var dr = pd[i] - c[0], dg = pd[i + 1] - c[1], db = pd[i + 2] - c[2]; if (dr * dr + dg * dg + db * db > t2) sd.data[i + 3] = 0; }
    sg.putImageData(sd, 0, 0);
  }
  function closeLasso() {
    var pts = LASSO; LASSO = null; PEN.lcur = null;
    if (pts && pts.length > 2) { selDraw(pts.mode, function (c, w, h) { c.beginPath(); pts.forEach(function (p, i) { c[i ? "lineTo" : "moveTo"](p[0] * w, p[1] * h); }); c.closePath(); c.fill(); }); if (PH.brush.feather) featherQuiet(); else selChanged(); }
    else if (pts && pts.mode === "replace") { selDraw("replace", function () {}); selChanged(); }
    drawSvg();
  }
  function penClose(make) {
    var pts = PEN.pts; PEN.pts = null; PEN.cur = null;
    if (make && pts && pts.length > 1) { phSnap(); phNewLayer("shape", { name: "Trazado", shape: pts.length === 2 ? { type: "line", pts: pts, closed: false, fill: "none", stroke: PH.front, sw: 0.004, radius: 0 } : { type: "path", pts: pts, closed: true, fill: PH.front, stroke: "none", sw: 0, radius: 0 } }); phAll(); if (X.onChange) X.onChange("layer"); }
    drawSvg();
  }
  phStage.addEventListener("pointerdown", onDown, true);
  phStage.addEventListener("pointermove", function (e) {
    if (!PH.open) return; var p = phPt(e);
    if (PEN.pts && PH.tool === "pen" && phVar("pen") === "pen") { PEN.cur = [p.u, p.v]; drawSvg(); }
    if (LASSO && phVar("lasso") === "poly") { PEN.lcur = [p.u, p.v]; drawSvg(); }
  });
  /* las asas viven en la superposición: se tocan con la herramienta Mover / Selección de trazado */
  svg.addEventListener("pointerdown", function () { /* el evento sube al lienzo (captura) */ });
  var _cursor = phCursor;
  phCursor = function () {
    _cursor.apply(this, arguments);
    var g = PH.tool; if (PH.mode === "crop" || PH.wbPick) return;
    if (brushy() && (isRetouch() || g === "quicksel" || PH.mode === "compose")) phStage.className = "ph-stage c-none";
    else if (SELT[g] || g === "pen" || g === "shapes" || g === "gradient" || g === "pathsel") phStage.className = "ph-stage c-cross";
    svg.querySelectorAll(".hd").forEach(function (h) { h.style.pointerEvents = "all"; });
  };
  var _mvCur = phMoveCursor;
  phMoveCursor = function (e) {
    var cur = pq("#phCur"), show = PH.mode === "brush" || (brushy() && (isRetouch() || PH.tool === "quicksel" || PH.mode === "compose"));
    if (!show || !PH.s || PH.mode === "crop") { if (PH.mode !== "brush") cur.style.display = "none"; if (PH.mode === "brush") return _mvCur.apply(this, arguments); return; }
    var rc = phStage.getBoundingClientRect(), d = PH.brush.size * PH.s;
    Object.assign(cur.style, { display: "block", width: d + "px", height: d + "px", left: e.clientX - rc.left - d / 2 + "px", top: e.clientY - rc.top - d / 2 + "px" });
  };
  var _pick = phPickTool;
  phPickTool = function (g, v) {
    if (PEN.pts) penClose(false); if (LASSO) { LASSO = null; }
    var r = _pick.apply(this, arguments);
    if ((g === "move" || g === "pathsel") && PH.mode !== "compose" && phLayers().some(function (L) { return !L.pre; })) phMode("compose");
    return r;
  };

  /* ═════════════ barra de opciones de la herramienta ═════════════ */
  var _bar = phBar;
  phBar = function () {
    _bar.apply(this, arguments);
    var bar = pq("#phBar"), g = PH.tool, v = phVar(g), h = "";
    if (PH.mode === "crop" || PH.mode === "brush") return;
    var sl = function (lbl, key, min, max, unit) { return '<label class="ph-opt">' + lbl + ' <input type="range" class="ph-r" min="' + min + '" max="' + max + '" data-pb="' + key + '" value="' + PH.brush[key] + '"><output>' + PH.brush[key] + (unit || "") + "</output></label>"; };
    if (SELT[g]) { if (g === "quicksel") h += (v === "quick" ? sl("Tamaño", "size", 1, 400) : "") + sl("Tolerancia", "tol", 1, 120); h += sl("Calado", "feather", 0, 80, " px"); }
    else if (isRetouch()) { h += sl("Tamaño", "size", 1, 400); if (g === "clone") h += sl("Dureza", "hard", 0, 100); if (g !== "clone" && !(g === "heal")) h += sl("Fuerza", "str", 5, 100, "%"); if (g === "dodge" && v === "sponge") h += '<span class="ph-opt">Alt: quita color</span>'; if (g === "brush") h += '<label class="ph-opt">Color <input type="color" data-pfront value="' + PH.front + '"></label>'; }
    else if (PH.mode === "compose" && ((g === "eraser" && v !== "eraser") || (g === "gradient" && v === "bucket"))) h += sl("Tolerancia", "tol", 1, 120);
    if (PH.mode === "compose" && g === "pen") h += '<label class="ph-opt">Color <input type="color" data-pfront value="' + PH.front + '"></label><span class="ph-opt">' + (v === "pen" ? "Clic a clic; Enter o doble clic cierra la forma, Esc cancela" : "Arrastra para dibujar la forma") + "</span>";
    if (SEL.has) h += '<span class="ed-sep"></span><button class="ph-b" data-px="deselect" title="Ctrl+D">Deseleccionar</button><button class="ph-b" data-px="invert" title="Ctrl+Shift+I">Invertir</button><button class="ph-b" data-px="selLayer" title="Ctrl+J">Capa por copia</button><button class="ph-b" data-px="selMask" title="La selección como máscara de revelado">Máscara</button>';
    if (!h) return;
    var sp = bar.querySelector(".ph-sp"), hint = PH.mode === "compose" && !PH_PAINT.has(g) ? bar.querySelector("span.ph-opt") : null;
    if (hint && /Elige Pincel/.test(hint.textContent) && (SELT[g] || isRetouch() || g === "move" || g === "pathsel")) hint.remove();
    var box = document.createElement("span"); box.style.display = "contents"; box.innerHTML = h;
    if (sp) bar.insertBefore(box, sp); else bar.appendChild(box);
  };
  function act(a) {
    if (a === "deselect") return selClear();
    if (a === "invert") return selInvert();
    if (a === "selAll") return selAll();
    if (a === "selLayer") {
      if (!SEL.has) return phToast("Primero selecciona una zona");
      phSnap(); var W = lw(), H = lh(), t = phCanvas(W, H); t.getContext("2d").drawImage(phFlatten(Math.max(W, H)), 0, 0, W, H); clipSel(t);
      var L = phNewLayer("paint", { name: "Capa por copia" }); L.cv.getContext("2d").drawImage(t, 0, 0); L._touched = true;
      if (PH.mode !== "compose") phMode("compose"); phAll(); return phToast("La selección quedó en una capa nueva");
    }
    if (a === "selMask") {
      if (!SEL.has) return phToast("Primero selecciona una zona");
      if (PH.r.masks.length >= PC.MAX_MASKS) return phToast("Máximo " + PC.MAX_MASKS + " máscaras");
      phSnap(); var m = PC.normMask({ kind: "brush", name: "Selección", adj: { exposure: 20 } }), c = phCanvas(PH.base.w, PH.base.h); c.getContext("2d").drawImage(SEL.cv, 0, 0, c.width, c.height); c._touched = true;
      PH.brushCv[m.id] = c; PH.r.masks.push(m); PH.mask = m.id; PH.tab = "mascaras"; if (PH.mode !== "edit") phMode("edit"); phAll(); return phToast("Máscara creada desde la selección: ajusta sus valores a la derecha");
    }
    if (a === "selCrop") {
      if (!SEL.has) return phToast("Primero selecciona una zona");
      var bb = selBounds(); if (!bb) return;
      var c0 = PH.r.geo.crop, c1 = { x: c0.x + bb.x * c0.w, y: c0.y + bb.y * c0.h, w: bb.w * c0.w, h: bb.h * c0.h };
      geoChange(function (g) { g.crop = c1; }, "crop", c0, c1); return phToast("Recortada a la selección");
    }
    if (a === "selFill" || a === "selDelete") {
      var Lf = phActive();
      if (!Lf || Lf.kind !== "paint" || Lf.pre) { if (a === "selDelete") return phToast("Elige una capa de pintura para borrar dentro de la selección"); Lf = phNewLayer("paint"); if (PH.mode !== "compose") phMode("compose"); }
      phSnapLayer(Lf); var g2 = Lf.cv.getContext("2d"), t2 = phCanvas(lw(), lh()), tg = t2.getContext("2d");
      tg.fillStyle = a === "selFill" ? PH.front : "#000"; tg.fillRect(0, 0, t2.width, t2.height); if (SEL.has) clipSel(t2);
      g2.save(); if (a === "selDelete") g2.globalCompositeOperation = "destination-out"; g2.drawImage(t2, 0, 0); g2.restore(); Lf._touched = true; phAll(); return;
    }
    if (a === "selFeather") return window.__musaReal.promptBox("¿Cuántos píxeles de calado (borde suave)?", "12", { title: "Calar la selección", label: "Píxeles", ok: "Calar" }).then(function (v) { var px = parseFloat(v); if (px > 0) selFeather(px); });
    if (a === "layerMask") {
      var Lk = phActive(); if (!Lk || Lk.pre) return phToast("Elige una capa");
      phSnapLayer(Lk);
      if (Lk.mcv && !SEL.has) { Lk.mcv = null; Lk.maskSrc = null; Lk.dv = null; phMountLayers(); phAll(); return phToast("Máscara de capa quitada"); }
      if (!SEL.has) return phToast("Selecciona la zona que debe quedar visible y vuelve a pulsar");
      Lk.mcv = X.copyCv(selCanvas()); Lk.msig = null; Lk.dv = null; phMountLayers(); phAll(); return phToast("Máscara de capa: solo se ve dentro de la selección");
    }
    if (a === "addImage") { var inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.onchange = function () { if (inp.files[0]) addImageFile(inp.files[0]); }; inp.click(); return; }
    if (a === "addShape") { phSnap(); phNewLayer("shape", { shape: { type: "rect", fill: PH.front, stroke: "none", sw: 0, radius: 0 }, box: { x: 0.3, y: 0.35, w: 0.4, h: 0.3, rot: 0 } }); PH.tool = "move"; return phAll(); }
    if (a === "addRetouch") { retouchLayer(true); return phAll(); }
  }
  X.act = act;
  X.T = { selDraw: selDraw, selChanged: selChanged, selCanvas: selCanvas, clipSel: clipSel, compData: compData, flood: flood, maskToCanvas: maskToCanvas, retouchLayer: retouchLayer, activePaint: activePaint, drawSvg: drawSvg, kScale: kScale, lw: lw, lh: lh, stop: stop, selMode: selMode, RT: RT,
    geoChange: function (fn, kind, c0, c1) { return geoChange(fn, kind, c0, c1); }, featherQuiet: function () { return featherQuiet(); } };
  function selBounds() { var c = selCanvas(), k = Math.min(1, 500 / Math.max(c.width, c.height)), w = Math.round(c.width * k), h = Math.round(c.height * k), t = phCanvas(w, h), g = t.getContext("2d"); g.drawImage(c, 0, 0, w, h); var d = g.getImageData(0, 0, w, h).data, x0 = w, y0 = h, x1 = -1, y1 = -1; for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return x1 < 0 ? null : { x: x0 / w, y: y0 / h, w: (x1 - x0 + 1) / w, h: (y1 - y0 + 1) / h }; }
  function addImageFile(file) {
    var u = URL.createObjectURL(file);
    X.loadImg(u).then(function (im) {
      phSnap(); var W = lw(), H = lh(), ar = im.naturalWidth / im.naturalHeight, bw = Math.min(0.6, 0.6 * ar * H / W), bh = bw * W / ar / H;
      var L = phNewLayer("image", { name: file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "Imagen", src: u, img: im, box: { x: (1 - bw) / 2, y: (1 - bh) / 2, w: bw, h: bh, rot: 0 } });
      phLayerRender(L); PH.tool = "move"; if (PH.mode !== "compose") phMode("compose"); phAll(); if (X.onChange) X.onChange("layer");
    }, function () { phToast("No se pudo leer esa imagen"); });
  }
  pq("#phBar").addEventListener("click", function (e) { var b = e.target.closest("[data-px]"); if (b) act(b.dataset.px); });
  /* pegar o soltar una imagen: entra como capa */
  document.addEventListener("paste", function (e) { if (!PH.open || !PH.src || (e.target.closest && e.target.closest("input,textarea,[contenteditable=true]"))) return; var it = e.clipboardData && [].find.call(e.clipboardData.items || [], function (i) { return /^image\//.test(i.type); }); if (it) { e.preventDefault(); addImageFile(it.getAsFile()); } });
  phStage.addEventListener("dragover", function (e) { if (e.dataTransfer && [].indexOf.call(e.dataTransfer.types || [], "Files") >= 0) e.preventDefault(); });
  phStage.addEventListener("drop", function (e) { var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f && /^image\//.test(f.type)) { e.preventDefault(); addImageFile(f); } });

  /* ═════════════ menú Selección ═════════════ */
  PH_MENUS.seleccion = function () {
    return [{ l: "Todo", k: "Ctrl+A", fn: selAll }, { l: "Deseleccionar", k: "Ctrl+D", fn: function () { selClear(); } }, { l: "Invertir", k: "Ctrl+Shift+I", fn: selInvert }, { l: "Calar (borde suave)…", fn: function () { act("selFeather"); } }, "-",
      { l: "Capa por copia", k: "Ctrl+J", d: "Lo seleccionado, en una capa nueva", fn: function () { act("selLayer"); } }, { l: "Rellenar con el color", d: "En la capa de pintura activa", fn: function () { act("selFill"); } }, { l: "Borrar dentro", k: "Supr", fn: function () { act("selDelete"); } }, "-",
      { l: "Recortar la foto a la selección", fn: function () { act("selCrop"); } }, { l: "Máscara de revelado desde la selección", d: "Ajusta luz y color solo ahí", fn: function () { act("selMask"); } }, { l: "Máscara de capa", d: "La capa activa solo se ve dentro de la selección", fn: function () { act("layerMask"); } }];
  };
  (function menuBtn() {
    var nav = phRoot.querySelector(".ed-top .ed-tc"), ia = nav && nav.querySelector('[data-pmenu="ia"]'); if (!ia || nav.querySelector('[data-pmenu="seleccion"]')) return;
    var b = document.createElement("button"); b.className = "ed-tb"; b.dataset.pmenu = "seleccion"; b.innerHTML = 'Selección<span class="cv">' + (typeof ei === "function" ? ei("cv", 12) : "▾") + "</span>";
    nav.insertBefore(b, ia);
  })();
  var _at = PH_MENUS.atajos;
  PH_MENUS.atajos = function () { return _at().concat([["Seleccionar todo / quitar / invertir", "Ctrl+A · Ctrl+D · Ctrl+Shift+I"], ["Sumar / restar a la selección", "Shift / Alt"], ["Origen del tampón y del corrector", "Alt+clic"], ["Cerrar la pluma o el lazo poligonal", "Enter"], ["Código de la foto", "Ctrl+Shift+C"]].map(function (x) { return { l: x[0], k: x[1], fn: function () {} }; })); };

  /* ═════════════ teclado ═════════════ */
  document.addEventListener("keydown", function (e) {
    if (!PH.open) return;
    if (e.target.closest && e.target.closest("input:not([type=range]),textarea,select,[contenteditable=true]")) return;
    var mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), hit = true;
    if (document.querySelector(".phx-dlg")) return;
    if (mod && e.shiftKey && k === "c") { if (X.code.isOpen()) X.code.close(); else X.code.open(); }
    else if (mod && k === "a") selAll();
    else if (mod && k === "d") selClear();
    else if (mod && e.shiftKey && k === "i") selInvert();
    else if (mod && k === "j" && SEL.has) act("selLayer");
    else if ((k === "delete" || k === "backspace") && SEL.has && phActive() && phActive().kind === "paint") act("selDelete");
    else if ((k === "delete" || k === "backspace") && PH.mode === "compose" && phActive() && !SEL.has) { phSnap(); var ls = phLayers(), i = ls.indexOf(phActive()); ls.splice(i, 1); PH.layer = null; phMountLayers(); phAll(); }
    else if (k === "enter" && PEN.pts) penClose(true);
    else if (k === "enter" && LASSO) closeLasso();
    else if (k === "escape" && (PEN.pts || LASSO)) { PEN.pts = null; LASSO = null; drawSvg(); }
    else if (k === "escape" && SEL.has && PH.mode !== "crop" && PH.mode !== "brush" && !PH.wbPick) selClear();
    else hit = false;
    if (hit) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  /* ═════════════ geometría: recortar, girar y voltear llevan consigo capas, máscaras y selección ═════════════ */
  function mapCv(old, nw, nh, kind, c0, c1) {
    var o = phCanvas(nw, nh), g = o.getContext("2d"); g.imageSmoothingQuality = "high";
    if (kind === "crop") { var p = PC.repointForCrop(0, 0, c0, c1); g.drawImage(old, p[0] * nw, p[1] * nh, c0.w / c1.w * nw, c0.h / c1.h * nh); }
    else if (kind === "rotR") { g.translate(nw, 0); g.rotate(Math.PI / 2); g.drawImage(old, 0, 0, nh, nw); }
    else if (kind === "rotL") { g.translate(0, nh); g.rotate(-Math.PI / 2); g.drawImage(old, 0, 0, nh, nw); }
    else if (kind === "flipH") { g.translate(nw, 0); g.scale(-1, 1); g.drawImage(old, 0, 0, nw, nh); }
    else if (kind === "flipV") { g.translate(0, nh); g.scale(1, -1); g.drawImage(old, 0, 0, nw, nh); }
    return o;
  }
  function mapPt(kind, c0, c1) {
    return kind === "crop" ? function (u, v) { return PC.repointForCrop(u, v, c0, c1); } : kind === "rotR" ? function (u, v) { return [1 - v, u]; } : kind === "rotL" ? function (u, v) { return [v, 1 - u]; } : kind === "flipH" ? function (u, v) { return [1 - u, v]; } : function (u, v) { return [u, 1 - v]; };
  }
  function remap(kind, c0, c1, old, nw2) {
    var ow = old[0], oh = old[1], nw = nw2[0], nh = nw2[1], P = mapPt(kind, c0, c1), rot = kind === "rotR" ? 90 : kind === "rotL" ? -90 : 0;
    var sx = kind === "crop" ? c0.w / c1.w : 1, sy = kind === "crop" ? c0.h / c1.h : 1;
    var boxMap = function (b) { var c = P(b.x + b.w / 2, b.y + b.h / 2), w = rot ? b.h * oh / nw : b.w * sx, h = rot ? b.w * ow / nh : b.h * sy; return { x: c[0] - w / 2, y: c[1] - h / 2, w: w, h: h, rot: kind === "flipH" || kind === "flipV" ? -(b.rot || 0) : (b.rot || 0) }; };
    phLayers().forEach(function (L) {
      if (L.kind === "paint") L.cv = mapCv(L.cv, nw, nh, kind, c0, c1); else L.cv = phCanvas(nw, nh);
      if (L.mcv) L.mcv = mapCv(L.mcv, nw, nh, kind, c0, c1);
      L.dv = null; L._touched = true;
      if (L.kind === "text") { var q = P(L.text.x, L.text.y); L.text.x = q[0]; L.text.y = q[1]; L.text.size = L.text.size * (kind === "crop" ? sy : oh / nh); L.text.rot = (L.text.rot || 0) + rot; }
      if (L.box && L.kind !== "paint") { L.box = boxMap(L.box); if (rot && L.kind === "image") { var cx = L.box.x + L.box.w / 2, cy = L.box.y + L.box.h / 2, w0 = L.box.h * nh / nw, h0 = L.box.w * nw / nh; L.box = { x: cx - w0 / 2, y: cy - h0 / 2, w: w0, h: h0, rot: (L.box.rot || 0) + rot }; } }
      if (L.shape && L.shape.pts) L.shape.pts = L.shape.pts.map(function (pt) { var o = []; for (var i = 0; i < pt.length; i += 2) { var q2 = P(pt[i], pt[i + 1]); o.push(q2[0], q2[1]); } return o; });
      phLayerRender(L);
    });
    PH.r.masks.forEach(function (m) {
      if (m.kind === "radial") { var c = P(m.cx, m.cy); m.cx = c[0]; m.cy = c[1]; if (rot) { var t = m.rx; m.rx = m.ry; m.ry = t; } else { m.rx *= sx; m.ry *= sy; } }
      if (m.kind === "linear") { var a = P(m.x1, m.y1), b = P(m.x2, m.y2); m.x1 = a[0]; m.y1 = a[1]; m.x2 = b[0]; m.y2 = b[1]; }
      if (m.kind === "brush" && PH.brushCv[m.id]) { var bc = PH.brushCv[m.id], r = rot ? [bc.height, bc.width] : [bc.width, bc.height]; PH.brushCv[m.id] = mapCv(bc, r[0], r[1], kind, c0, c1); PH.brushCv[m.id]._touched = true; }
    });
    var S = X.st(); Object.keys(S.fmask).forEach(function (id) { var fc = S.fmask[id], r = rot ? [fc.height, fc.width] : [fc.width, fc.height]; S.fmask[id] = mapCv(fc, r[0], r[1], kind, c0, c1); });
    if (SEL.cv) { var had = SEL.has; SEL.cv = had ? mapCv(SEL.cv, nw, nh, kind, c0, c1) : null; }
    S.slices = (S.slices || []).map(function (s) { var b = boxMap({ x: s.x, y: s.y, w: s.w, h: s.h }), x = clamp(b.x, 0, 0.999), y = clamp(b.y, 0, 0.999); return Object.assign({}, s, { x: x, y: y, w: clamp(b.w + Math.min(0, b.x), 0.002, 1 - x), h: clamp(b.h + Math.min(0, b.y), 0.002, 1 - y) }); }).filter(function (s) { return s.w > 0.003 && s.h > 0.003; });
    S.samplers = (S.samplers || []).map(function (q) { return P(q[0], q[1]); }).filter(function (q) { return q[0] >= 0 && q[0] <= 1 && q[1] >= 0 && q[1] <= 1; });
    RT.base = null;
  }
  var FULL = { x: 0, y: 0, w: 1, h: 1 };
  function geoChange(fn, kind, c0, c1) {
    X.snapFull();
    var old = X.lres(), g = PH.r.geo;
    if (kind !== "crop" && !PC.same(g.crop, FULL)) { var cc = clone(g.crop); g.crop = clone(FULL); remap("crop", cc, FULL, old, X.lres()); old = X.lres(); }
    fn(g);
    /* con perspectiva, girar o voltear también gira las esquinas del cuadrilátero (la salida gira entera) */
    if (g.persp && kind !== "crop") {
      var q = g.persp, M = kind === "rotR" ? function (p) { return [1 - p[1], p[0]]; } : kind === "rotL" ? function (p) { return [p[1], 1 - p[0]]; } : kind === "flipH" ? function (p) { return [1 - p[0], p[1]]; } : function (p) { return [p[0], 1 - p[1]]; };
      var ord = kind === "rotR" ? [3, 0, 1, 2] : kind === "rotL" ? [1, 2, 3, 0] : kind === "flipH" ? [1, 0, 3, 2] : [3, 2, 1, 0];
      g.persp = ord.map(function (i) { return M(q[i]); });
    }
    PH.r = PC.normRecipe(PH.r);
    remap(kind, c0, c1, old, X.lres());
    PH.base = null; PH.bkey = ""; X.touchPre(true);
    if (PH.mode === "crop") { if (kind === "crop") { PH.mode = "edit"; PH.crop = null; } else PH.crop = clone(PH.r.geo.crop); }
    phEnsureBase(); selChanged(); phAll(); if (X.onChange) X.onChange("geo");
  }
  var _act = phAct;
  phAct = function (a) {
    var g = PH.r.geo;
    if (a === "cropApply") { if (!PH.crop || PC.same(PH.crop, g.crop)) return phMode("edit"); var c0 = clone(g.crop), c1 = clone(PH.crop); return geoChange(function (q) { q.crop = c1; }, "crop", c0, c1); }
    if (a === "rotR") return geoChange(function (q) { q.rot = (q.rot + 1) % 4; }, "rotR");
    if (a === "rotL") return geoChange(function (q) { q.rot = (q.rot + 3) % 4; }, "rotL");
    if (a === "flipH") return geoChange(function (q) { q.flipH = !q.flipH; }, "flipH");
    if (a === "flipV") return geoChange(function (q) { q.flipV = !q.flipV; }, "flipV");
    if (a === "resetAll") { phSnap(); PH.r = Object.assign(PC.recipe0(), { geo: PH.r.geo }); PH.mask = null; return phAll(); }
    if (a === "dupLayer") { var L = phActive(); if (!L) return; phSnap(); var c = phNewLayer(L.kind, { name: L.name + " copia", op: L.op, blend: L.blend, text: L.text ? clone(L.text) : undefined, shape: L.shape ? clone(L.shape) : undefined, box: L.box ? clone(L.box) : undefined, img: L.img, src: L.kind === "image" ? L.src : undefined, fit: L.fit }); if (L.kind === "paint") { c.cv.getContext("2d").drawImage(L.cv, 0, 0); c._touched = true; } if (c.text) { c.text.x += 0.02; c.text.y += 0.02; } else if (c.box && L.kind !== "paint") { c.box.x += 0.02; c.box.y += 0.02; } phLayerRender(c); return phAll(); }
    if (a === "mergeDown") {
      var ls = phLayers(), Lm = phActive(), i = ls.indexOf(Lm);
      var j = i - 1; while (j >= 0 && ls[j].pre) j--;
      if (!Lm || Lm.pre || j < 0) return phToast("No hay una capa debajo para fusionar");
      var dn = ls[j]; X.snapFull();
      if (dn.kind !== "paint") { var keep = X.copyCv(X.viewOf(dn)); dn.kind = "paint"; dn.text = dn.shape = dn.img = null; dn.src = null; dn.box = { x: 0, y: 0, w: 1, h: 1, rot: 0 }; dn.cv = keep; dn.mcv = null; }
      var x = dn.cv.getContext("2d"); x.save(); x.globalAlpha = Lm.op / 100; x.globalCompositeOperation = Lm.blend === "normal" ? "source-over" : Lm.blend; x.drawImage(X.viewOf(Lm), 0, 0); x.restore();
      dn._touched = true; dn.dv = null; ls.splice(i, 1); PH.layer = dn.id; phMountLayers(); return phAll();
    }
    if (a === "flatten") {
      var all = phLayers().filter(function (q) { return !q.pre; });
      if (all.length < 2) return phToast("Aplanar junta todas las capas en una");
      X.snapFull(); var cv = phCanvas(lw(), lh()), xx = cv.getContext("2d");
      all.forEach(function (q) { if (!q.vis) return; xx.globalAlpha = q.op / 100; xx.globalCompositeOperation = q.blend === "normal" ? "source-over" : q.blend; xx.drawImage(X.viewOf(q), 0, 0); });
      PH.layersBy[PH.key] = phLayers().filter(function (q) { return q.pre; }); var nl = phNewLayer("paint", { name: "Capa aplanada" }); nl.cv.getContext("2d").drawImage(cv, 0, 0); nl._touched = true; phMountLayers(); return phAll();
    }
    if (a === "addLayer" || a === "addText") { phSnap(); return _act.apply(this, arguments); }
    if (a === "maskClear") { phSnap(); var r = _act.apply(this, arguments); if (PH.brushCv[PH.mask]) PH.brushCv[PH.mask]._touched = true; return r; }
    return _act.apply(this, arguments);
  };

  /* ═════════════ inspector: Filtros, Detalle (quitar neblina), Máscaras (más tipos y ajustes) y Capas ═════════════ */
  if (!PH_TABS.some(function (t) { return t[0] === "filtros"; })) PH_TABS.splice(4, 0, ["filtros", "Filtros"]);
  var GROUPS = [["Color y tono", ["brightness", "contrast", "saturate", "hueRotate", "grayscale", "sepia", "invert", "gamma", "levels", "normalize", "equalize", "duotone", "tint", "posterize", "threshold", "solarize"]], ["Desenfoque y enfoque", ["blur", "motionBlur", "unsharp", "highPass"]], ["Estilo", ["noise", "pixelate", "halftone", "glow", "chromatic", "emboss", "edges", "opacity"]], ["Avanzado", ["convolve", "colorMatrix", "code"]]];
  var CODE0 = "(px, w, h, p) => {\n  // px: los píxeles RGBA (0–255). Cámbialos aquí.\n  const k = 0.6;\n  for (let i = 0; i < px.length; i += 4) {\n    const l = (px[i] + px[i + 1] + px[i + 2]) / 3;\n    px[i] = px[i] * (1 - k) + l * k;\n    px[i + 1] = px[i + 1] * (1 - k) + l * k;\n    px[i + 2] = px[i + 2] * (1 - k) + l * k;\n  }\n}";
  function fsl(f, p) {
    var k = p[0], v = f[k], u = p[6];
    if (u === "color") return '<div class="ph-sl"><label>' + p[1] + '</label><input type="color" data-ff="' + f.id + ":" + k + '" value="' + v + '"><output>' + v + "</output></div>";
    if (u === "bool") return '<label class="ph-chk" style="padding:2px 8px"><input type="checkbox" data-fb="' + f.id + ":" + k + '"' + (v ? " checked" : "") + ">" + p[1] + "</label>";
    if (u === "kernel") return '<div class="phx-k' + (v.length === 25 ? " k5" : "") + '">' + v.map(function (x, i) { return '<input type="text" inputmode="decimal" aria-label="Celda ' + (i + 1) + '" data-fk="' + f.id + ":" + i + '" value="' + x + '">'; }).join("") + "</div>";
    if (u === "matrix") return '<div class="phx-k" style="grid-template-columns:repeat(5,1fr)">' + v.map(function (x, i) { return '<input type="text" inputmode="decimal" aria-label="Celda ' + (i + 1) + '" data-fm="' + f.id + ":" + i + '" value="' + x + '">'; }).join("") + "</div>";
    if (u === "code") return '<textarea spellcheck="false" aria-label="Código del filtro" data-fc="' + f.id + '">' + esc(v) + "</textarea>" + (f._err ? '<div class="phx-err">' + esc(f._err) + "</div>" : "") + '<div class="phx-row2"><button data-fx="run:' + f.id + '">Aplicar el código</button><span>Corre aislado: no puede salir de la foto.</span></div>';
    return '<div class="ph-sl"><label data-fr="' + f.id + ":" + k + '" title="Doble clic restablece">' + p[1] + '</label><input type="range" class="ph-r" min="' + p[2] + '" max="' + p[3] + '" step="' + p[5] + '" value="' + v + '" data-ff="' + f.id + ":" + k + '"><output>' + v + (u === "%" || u === "°" ? u : u === "px" ? " px" : "") + "</output></div>";
  }
  function inspFilters() {
    var S = X.st(), fl = S.filters;
    var h = '<div class="phx-add"><select id="phxAddF" aria-label="Agregar filtro"><option value="">+ Agregar filtro…</option>' + GROUPS.map(function (g) { return '<optgroup label="' + g[0] + '">' + g[1].map(function (k) { return '<option value="' + k + '">' + PC.FILTERS[k].label + "</option>"; }).join("") + "</optgroup>"; }).join("") + "</select></div>";
    if (!fl.length) h += '<div class="ed-note" style="padding:8px 12px">Los filtros se aplican encima del revelado, en orden, y siempre se pueden cambiar o quitar. Con una selección activa, el filtro nuevo afecta solo esa zona. También llegan aquí los ajustes de un código pegado (CSS filter, Pillow, sharp, ImageMagick…).</div>';
    fl.forEach(function (f, i) {
      var F = PC.FILTERS[f.kind];
      h += '<div class="phx-f' + (f.on ? "" : " off") + '"><div class="phx-fh"><input type="checkbox" data-fx="on:' + f.id + '"' + (f.on ? " checked" : "") + ' title="Activar" aria-label="Activar ' + F.label + '"><b>' + esc(f.name || F.label) + "</b>"
        + '<button data-fx="up:' + f.id + '" title="Antes"' + (i ? "" : " disabled") + '>↑</button><button data-fx="dn:' + f.id + '" title="Después"' + (i < fl.length - 1 ? "" : " disabled") + '>↓</button><button data-fx="del:' + f.id + '" title="Quitar filtro">✕</button></div>'
        + F.params.map(function (p) { return fsl(f, p); }).join("")
        + '<div class="phx-row2">' + (S.fmask[f.id] ? '<span>Solo en una zona</span><button data-fx="unzone:' + f.id + '">Toda la foto</button>' : SEL.has ? '<button data-fx="zone:' + f.id + '">Solo en la selección</button>' : "") + "</div></div>";
    });
    return h;
  }
  var ADJ = [["exposure", "Exposición"], ["contrast", "Contraste"], ["highlights", "Altas luces"], ["shadows", "Sombras"], ["saturation", "Saturación"], ["temp", "Temperatura"], ["tint", "Tinte"], ["clarity", "Claridad"]];
  var MK = { radial: "◎ Radial", linear: "◐ Lineal", brush: "● Pincel", lum: "☀ Luminancia", color: "◈ Color" };
  function inspMasks() {
    var r = PH.r, full = r.masks.length >= PC.MAX_MASKS;
    var h = phGs("Máscaras (" + r.masks.length + "/" + PC.MAX_MASKS + ")", '<div class="ph-chips">' + [["radial", "+ Radial"], ["linear", "+ Lineal"], ["brush", "+ Pincel"], ["lum", "+ Luminancia"], ["color", "+ Color"]].map(function (k) { return '<button data-pxm="' + k[0] + '"' + (full ? " disabled" : "") + ">" + k[1] + "</button>"; }).join("") + (SEL.has ? '<button data-px="selMask"' + (full ? " disabled" : "") + ">+ Desde la selección</button>" : "") + "</div>"
      + (r.masks.length ? "" : '<div class="ed-note" style="padding:0 12px">Una máscara ajusta luz y color SOLO en su zona: un óvalo, un degradado, lo que pintes, un rango de luz o un color. En IA › Seleccionar sujeto o cielo se crean solas.</div>')
      + r.masks.map(function (m, i) {
        var on = PH.mask === m.id;
        return '<div class="ph-mask ' + (on ? "on" : "") + '"><div class="ph-mrow"><input type="checkbox" data-pmon="' + m.id + '"' + (m.on ? " checked" : "") + ' title="Activar"><button class="nm" data-pmsel="' + m.id + '">' + (m.name ? "● " + esc(m.name) : MK[m.kind] + " " + (i + 1)) + (m.invert ? " · invertida" : "") + '</button><button class="ed-ib" style="width:24px;height:24px" data-pmdel="' + m.id + '" title="Eliminar máscara">✕</button></div>'
          + (on ? '<div style="padding-bottom:8px">' + (m.kind === "lum" ? phSl("Desde (sombras → luces)", "masks." + i + ".lo", 0, 1, { step: 0.01, def: 0.6 }) + phSl("Hasta", "masks." + i + ".hi", 0, 1, { step: 0.01, def: 1 }) : "") + (m.kind === "color" ? phSl("Color (matiz)", "masks." + i + ".hue", 0, 360, { trk: TRK.hue, def: 210 }) + phSl("Amplitud", "masks." + i + ".range", 5, 180, { def: 40 }) + '<div class="ph-chips" style="padding:2px 12px 6px"><button data-px="maskPick">Tomar el color de la foto</button></div>' : "")
            + (m.kind !== "brush" ? phSl("Suavidad", "masks." + i + ".feather", 0.02, 1, { step: 0.01, def: 0.5 }) : "")
            + ADJ.map(function (a) { return phSl(a[1], "masks." + i + ".adj." + a[0], -100, 100, a[0] === "temp" ? { trk: TRK.temp } : a[0] === "tint" ? { trk: TRK.tint } : {}); }).join("")
            + '<label class="ph-chk"><input type="checkbox" data-pck="masks.' + i + '.invert"' + (m.invert ? " checked" : "") + '>Invertir máscara</label><label class="ph-chk"><input type="checkbox" data-povl' + (PH.overlay ? " checked" : "") + ">Mostrar superposición</label>"
            + (m.kind === "brush" ? '<div class="ph-chips" style="padding-top:4px"><button data-pa="maskBrush" class="' + (PH.mode === "brush" ? "on" : "") + '">Pintar máscara</button><button data-pa="maskClear">Limpiar</button></div>' : "") + "</div>" : "") + "</div>";
      }).join(""));
    return h;
  }
  var KIND_IC = { paint: "▦", text: "T", image: "▣", shape: "◆" };
  function inspCompose(box) {
    var all = phLayers(), ls = all.filter(function (q) { return !q.pre; }).reverse(), pre = all.filter(function (q) { return q.pre; }), L = phActive();
    var row = function (q) { return '<div class="ph-ly ' + (q.id === PH.layer ? "on" : "") + " " + (q.vis ? "" : "off") + '" data-ply="' + q.id + '"><span class="lt" data-plt-c="' + q.id + '"></span><span class="nm">' + KIND_IC[q.kind] + " " + esc(q.name) + "<br><small>" + (q.pre ? "bajo el revelado" : q.blend) + " · " + q.op + "%" + (q.mcv ? " · máscara" : "") + '</small></span><button class="ib" data-plvis="' + q.id + '" title="' + (q.vis ? "Ocultar" : "Mostrar") + '">' + (q.vis ? "◉" : "○") + "</button>" + (q.pre ? "" : '<button class="ib" data-plup="' + q.id + '" title="Subir">↑</button><button class="ib" data-pldn="' + q.id + '" title="Bajar">↓</button>') + '<button class="ib" data-pldel="' + q.id + '" title="Eliminar">✕</button></div>'; };
    var h = '<div class="ph-chips" style="padding-top:12px"><button data-pa="addLayer">+ Capa</button><button data-pa="addText">+ Texto</button><button data-px="addImage">+ Imagen</button><button data-px="addShape">+ Forma</button></div>'
      + ls.map(row).join("")
      + '<div class="ph-ly ' + (PH.layer == null ? "on" : "") + '" data-ply="base"><span class="lt" data-plt-c="base"></span><span class="nm">Revelado + filtros<br><small>no destructivo</small></span><span class="ib" title="Bloqueada">🔒︎</span></div>'
      + pre.map(row).join("");
    if (L) {
      h += '<div class="ph-gs" style="padding-top:12px"><div class="ph-gh">Capa activa</div><div class="ed-sb"><label class="ef full"><span>Nombre</span><input data-plk="name" value="' + esc(L.name) + '"></label>'
        + (L.pre ? "" : '<label class="ef full"><span>Fusión</span><select data-plk="blend">' + PH_BLENDS.map(function (b) { return "<option " + (b === L.blend ? "selected" : "") + ">" + b + "</option>"; }).join("") + "</select></label>") + "</div>"
        + '<div class="ph-sl"><label>Opacidad</label><input type="range" class="ph-r" min="0" max="100" value="' + L.op + '" data-plk="op"><output>' + L.op + "</output></div>";
      if (L.kind === "text") {
        var t = L.text, fonts = typeof FONTS !== "undefined" ? Object.keys(FONTS) : [t.font]; if (fonts.indexOf(t.font) < 0) fonts.unshift(t.font);
        h += '<div class="ed-sb" style="padding-top:8px"><label class="ef full ta"><textarea rows="2" data-ptk="s">' + esc(t.s) + '</textarea></label><label class="ef"><span>Fuente</span><select data-ptk="font">' + fonts.map(function (f) { return "<option " + (f === t.font ? "selected" : "") + ">" + esc(f) + "</option>"; }).join("") + '</select></label><label class="ef"><span>Color</span><input type="color" data-ptk="color" value="' + t.color + '"></label>'
          + '<label class="ef"><span>Peso</span><select data-ptx="weight">' + [300, 400, 500, 600, 700, 800, 900].map(function (w) { return "<option " + (w === t.weight ? "selected" : "") + ">" + w + "</option>"; }).join("") + '</select></label><label class="ef"><span>Alinear</span><select data-ptx="align">' + [["left", "Izquierda"], ["center", "Centro"], ["right", "Derecha"]].map(function (a) { return '<option value="' + a[0] + '"' + (a[0] === t.align ? " selected" : "") + ">" + a[1] + "</option>"; }).join("") + "</select></label></div>"
          + '<div class="ph-sl"><label>Tamaño</label><input type="range" class="ph-r" min="1" max="60" step=".5" value="' + t.size * 100 + '" data-ptk="size"><output>' + Math.round(t.size * 100) + "</output></div>"
          + '<div class="ph-sl"><label>Espaciado</label><input type="range" class="ph-r" min="-10" max="60" step="1" value="' + Math.round((t.ls || 0) * 100) + '" data-ptx="ls"><output>' + Math.round((t.ls || 0) * 100) + "</output></div>"
          + '<div class="ph-sl"><label>Interlineado</label><input type="range" class="ph-r" min="70" max="250" step="5" value="' + Math.round((t.lh || 1.15) * 100) + '" data-ptx="lh"><output>' + Math.round((t.lh || 1.15) * 100) + "</output></div>"
          + '<div class="ph-sl"><label>Giro</label><input type="range" class="ph-r" min="-180" max="180" step="1" value="' + (t.rot || 0) + '" data-ptx="rot"><output>' + (t.rot || 0) + "°</output></div>"
          + '<div class="ph-sl"><label>Borde</label><input type="range" class="ph-r" min="0" max="20" step="1" value="' + Math.round((t.stroke ? t.stroke.w : 0) * 100) + '" data-ptx="strokeW"><output>' + Math.round((t.stroke ? t.stroke.w : 0) * 100) + "</output></div>"
          + '<div class="ed-sb"><label class="ef"><span>Color del borde</span><input type="color" data-ptx="strokeC" value="' + (t.stroke ? t.stroke.color : "#000000") + '"></label><label class="ef"><span>Sombra</span><select data-ptx="shadow"><option value="">Sin sombra</option><option value="s"' + (t.shadow ? " selected" : "") + ">Con sombra</option></select></label></div>"
          + '<label class="ph-chk"><input type="checkbox" data-ptx="italic"' + (t.italic ? " checked" : "") + '>Cursiva</label><label class="ph-chk"><input type="checkbox" data-ptx="bg"' + (t.bg ? " checked" : "") + ">Fondo detrás del texto</label>";
      }
      if (L.kind === "shape") {
        var s = L.shape;
        h += '<div class="ed-sb" style="padding-top:8px"><label class="ef"><span>Relleno</span><input type="color" data-psh="fill" value="' + (s.fill === "none" ? "#000000" : s.fill) + '"></label><label class="ef"><span>Borde</span><input type="color" data-psh="stroke" value="' + (s.stroke === "none" ? "#000000" : s.stroke) + '"></label></div>'
          + '<label class="ph-chk"><input type="checkbox" data-psh="nofill"' + (s.fill === "none" ? " checked" : "") + ">Sin relleno</label>"
          + '<div class="ph-sl"><label>Grosor del borde</label><input type="range" class="ph-r" min="0" max="80" step="1" value="' + Math.round(s.sw * 1000) + '" data-psh="sw"><output>' + Math.round(s.sw * 1000) + "</output></div>"
          + (s.type === "rect" ? '<div class="ph-sl"><label>Esquinas</label><input type="range" class="ph-r" min="0" max="250" step="1" value="' + Math.round(s.radius * 1000) + '" data-psh="radius"><output>' + Math.round(s.radius * 1000) + "</output></div>" : "")
          + (s.pts ? '<div class="ed-note" style="padding:4px 12px">Con «Selección de trazado» (A) mueves cada punto.</div>' : "");
      }
      if (L.kind === "image") h += '<div class="ed-sb" style="padding-top:8px"><label class="ef full"><span>Encaje</span><select data-pim="fit"><option value="">Cubrir</option><option value="contain"' + (L.fit === "contain" ? " selected" : "") + '>Contener</option><option value="fill"' + (L.fit === "fill" ? " selected" : "") + ">Estirar</option></select></label></div>";
      if (!L.pre) h += '<div class="ph-chips" style="padding-top:6px"><button data-px="layerMask">' + (L.mcv && !SEL.has ? "Quitar máscara de capa" : "Máscara desde la selección") + "</button></div>";
      if (L.kind !== "paint") h += '<div class="ed-note" style="padding:4px 12px">Con Mover (V) la arrastras, la escalas desde las esquinas y la giras con el asa de arriba.</div>';
      h += "</div>";
    } else h += '<div class="ed-note" style="padding:12px">Las capas van encima de la foto revelada: pintura, texto, imágenes y formas, cada una con su fusión y opacidad. El retoque (corrector, tampón, exponer…) va en una capa «bajo el revelado», así los ajustes de luz y color lo siguen.</div>';
    box.innerHTML = h;
    box.querySelectorAll("[data-plt-c]").forEach(function (sp) { var id = sp.dataset.pltC, c = phCanvas(60, 60), x = c.getContext("2d"); if (id === "base") x.drawImage(phView, 0, 0, 60, 60); else { var q = phLayers().find(function (l) { return l.id === +id; }); if (q) x.drawImage(X.viewOf(q), 0, 0, 60, 60); } sp.appendChild(c); });
  }
  phInspCompose = inspCompose;
  var _insp = phInsp;
  phInsp = function () {
    var box = pq("#phInsp");
    if (PH.mode === "compose") return inspCompose(box);
    if (PH.tab === "filtros") { box.innerHTML = inspFilters(); return; }
    if (PH.tab === "mascaras") { box.innerHTML = inspMasks(); return; }
    _insp.apply(this, arguments);
    if (PH.tab === "detalle") { var gs = box.querySelector(".ph-gs"); if (gs) gs.insertAdjacentHTML("beforeend", phSl("Quitar neblina", "detail.dehaze", -100, 100)); var nt = box.querySelector(".ed-note"); if (nt) nt.textContent = "Usa Zoom (Z) o la rueda para revisar el detalle al 100 %."; }
    if (PH.tab === "luz") { var ch = box.querySelector(".ph-chips"); if (ch && !ch.querySelector("[data-px]")) ch.insertAdjacentHTML("beforeend", '<button data-px="code" title="La foto como código, en vivo">&lt;/&gt; Código</button>'); }
  };
  var _out = phOutBar;
  phOutBar = function () {
    var r = _out.apply(this, arguments), out = pq("#phOut");
    var sm = out.querySelector("small"), dirty = X.dirty();
    if (dirty && !sm) { var cl = out.querySelector('[data-pa="close"]'); if (cl) cl.insertAdjacentHTML("beforebegin", "<small>Hay cambios sin guardar</small>"); } else if (sm) { if (!dirty) sm.remove(); else sm.textContent = PH.doc && PH.doc._photo ? "Hay cambios sin guardar" : "Hay cambios — nada se aplica hasta que decidas"; }
    var png = out.querySelector('[data-pa="png"]'); if (png) { png.textContent = "Exportar…"; png.title = "Descarga la foto: formato, tamaño real y calidad"; }
    var lp = PH.doc && PH.doc._photo, ap = out.querySelector('[data-pa="apply"]');
    if (lp && ap) {
      var a = lp.asset, isEd = !!(a.edited || a.code || a.from);
      if (!PH.busy) ap.textContent = isEd && a.source === "musa" ? "Guardar" : "Guardar foto editada";
      ap.title = isEd && a.source === "musa" ? "Guarda los cambios en esta misma foto (con sus capas, filtros y código)" : ap.title;
      if (isEd && !out.querySelector('[data-px="saveCopy"]')) ap.insertAdjacentHTML("afterend", '<button class="ph-b" data-px="saveCopy" title="Guarda una foto nueva y deja esta como estaba">Guardar como copia</button>');
      var sel = out.querySelector("#phSaveTo"); if (sel && isEd && a.source === "musa") sel.hidden = true;
    }
    return r;
  };
  pq("#phOut").addEventListener("click", function (e) { var b = e.target.closest("[data-px]"); if (b && b.dataset.px === "saveCopy" && !PH.busy) X.saveLoose("copy"); });
  /* acciones del inspector */
  var phIn2 = pq("#phInsp");
  function fById(id) { return X.st().filters.find(function (f) { return f.id === id; }); }
  phIn2.addEventListener("change", function (e) {
    var t = e.target, S = X.st();
    if (t.id === "phxAddF" && t.value) {
      if (S.filters.length >= PC.MAX_FILTERS) return phToast("Máximo " + PC.MAX_FILTERS + " filtros");
      phSnap(); var f = PC.normFilter(Object.assign({ kind: t.value }, t.value === "code" ? { code: CODE0 } : {}));
      S.filters.push(f); if (SEL.has) { S.fmask[f.id] = phCanvas(PH.base.w, PH.base.h); S.fmask[f.id].getContext("2d").drawImage(SEL.cv, 0, 0, PH.base.w, PH.base.h); f.mask = "pending"; }
      phAll(); return;
    }
    if (t.dataset.fb) { var p = t.dataset.fb.split(":"), f2 = fById(p[0]); if (f2) { phSnap(); f2[p[1]] = t.checked ? 1 : 0; phAll(); } return; }
    if (t.dataset.fk || t.dataset.fm) { var q = (t.dataset.fk || t.dataset.fm).split(":"), f3 = fById(q[0]), key = t.dataset.fk ? "kernel" : "matrix", val = parseFloat(String(t.value).replace(",", ".")); if (f3 && isFinite(val)) { phSnap(); f3[key] = f3[key].slice(); f3[key][+q[1]] = val; phDraw(); phOutBar(); } return; }
    if (t.dataset.ptx || t.dataset.psh || t.dataset.pim) { layerProp(t, true); return; }
    if (t.dataset.ff) phOutBar();
  });
  phIn2.addEventListener("pointerdown", function (e) { var t = e.target; if (t.matches && t.matches("[data-ff],[data-ptx],[data-psh]")) { if (t.dataset.ff) phSnap(); else { var L = phActive(); if (L) phSnapLayer(L); } } });
  phIn2.addEventListener("input", function (e) {
    var t = e.target;
    if (t.dataset.ff) { var p = t.dataset.ff.split(":"), f = fById(p[0]); if (!f) return; var P = PC.FILTERS[f.kind].params.find(function (q) { return q[0] === p[1]; }); f[p[1]] = P[6] === "color" ? t.value : +t.value; t.nextElementSibling.textContent = t.value + (P[6] === "%" || P[6] === "°" ? P[6] : P[6] === "px" ? " px" : ""); return phDraw(); }
    if (t.dataset.ptx || t.dataset.psh) layerProp(t, false);
    if (t.dataset.plk) { var L = phActive(); if (L && (L.mcv || L.pre)) { if (L.pre) X.touchPre(); else phMountLayers(); } }
  });
  function layerProp(t, final) {
    var L = phActive(); if (!L) return;
    if (t.dataset.ptx && L.text) {
      var k = t.dataset.ptx, tx = L.text, v = t.type === "checkbox" ? t.checked : t.value;
      if (k === "weight") tx.weight = +v; else if (k === "align") tx.align = v; else if (k === "ls") tx.ls = +v / 100; else if (k === "lh") tx.lh = +v / 100; else if (k === "rot") tx.rot = +v; else if (k === "italic") tx.italic = !!v;
      else if (k === "strokeW") { if (+v > 0) tx.stroke = { color: (tx.stroke && tx.stroke.color) || "#000000", w: +v / 100 }; else delete tx.stroke; }
      else if (k === "strokeC") { if (tx.stroke) tx.stroke.color = v; else tx.stroke = { color: v, w: 0.04 }; }
      else if (k === "shadow") { if (v) tx.shadow = { color: "#000000", blur: 0.012, x: 0, y: 0.006, op: 60 }; else delete tx.shadow; }
      else if (k === "bg") { if (v) tx.bg = PH.back; else delete tx.bg; }
      if (t.type === "range") t.nextElementSibling.textContent = t.value + (k === "rot" ? "°" : "");
    }
    if (t.dataset.psh && L.shape) {
      var kk = t.dataset.psh, s = L.shape;
      if (kk === "fill") s.fill = t.value; else if (kk === "stroke") { s.stroke = t.value; if (!s.sw) s.sw = 0.006; } else if (kk === "nofill") s.fill = t.checked ? "none" : PH.front; else if (kk === "sw") { s.sw = +t.value / 1000; if (s.sw && s.stroke === "none") s.stroke = "#000000"; } else if (kk === "radius") s.radius = +t.value / 1000;
      if (t.type === "range") t.nextElementSibling.textContent = t.value;
    }
    if (t.dataset.pim) { phSnapLayer(L); L.fit = t.value || undefined; }
    phLayerRender(L); drawSvg();
    if (final) { phInsp(); phOutBar(); if (X.onChange) X.onChange("layer"); }
  }
  phIn2.addEventListener("dblclick", function (e) { var l = e.target.closest("[data-fr]"); if (!l) return; var p = l.dataset.fr.split(":"), f = fById(p[0]); if (!f) return; phSnap(); f[p[1]] = PC.filterDefaults(f.kind)[p[1]]; phAll(); });
  phIn2.addEventListener("click", function (e) {
    var b = e.target.closest("[data-fx],[data-pxm],[data-px]"); if (!b) return;
    var S = X.st();
    if (b.dataset.px) { e.stopPropagation(); if (b.dataset.px === "code") return X.code.isOpen() ? X.code.close() : X.code.open(); if (b.dataset.px === "maskPick") { X.maskPick = true; phStage.className = "ph-stage c-cross"; return phToast("Clic en la foto sobre el color que quieres ajustar"); } return act(b.dataset.px); }
    if (b.dataset.pxm) {
      if (PH.r.masks.length >= PC.MAX_MASKS) return;
      phSnap(); var k = b.dataset.pxm, m = PC.normMask({ kind: k, adj: { exposure: k === "linear" ? -30 : 25 } });
      PH.r.masks.push(m); PH.mask = m.id;
      if (k === "brush") { PH.brushCv[m.id] = phCanvas(PH.base.w, PH.base.h); PH.mode = "brush"; }
      phAll(); return phToast(k === "brush" ? "Pinta sobre la foto la zona que quieres ajustar · Alt borra" : k === "lum" ? "Ajusta solo las zonas con esa cantidad de luz" : k === "color" ? "Ajusta solo ese color: elige el matiz o tómalo de la foto" : "Arrastra los puntos sobre la foto");
    }
    var p = b.dataset.fx.split(":"), a = p[0], id = p[1], i = S.filters.findIndex(function (f) { return f.id === id; }), f = S.filters[i]; if (!f) return;
    if (a === "on") { phSnap(); f.on = b.checked; return phAll(); }
    if (a === "del") { phSnap(); S.filters.splice(i, 1); delete S.fmask[id]; return phAll(); }
    if (a === "up" || a === "dn") { var j = i + (a === "up" ? -1 : 1); if (j < 0 || j >= S.filters.length) return; phSnap(); S.filters.splice(j, 0, S.filters.splice(i, 1)[0]); return phAll(); }
    if (a === "zone") { if (!SEL.has) return; phSnap(); S.fmask[id] = phCanvas(PH.base.w, PH.base.h); S.fmask[id].getContext("2d").drawImage(SEL.cv, 0, 0, PH.base.w, PH.base.h); f.mask = "pending"; return phAll(); }
    if (a === "unzone") { phSnap(); delete S.fmask[id]; delete f.mask; return phAll(); }
    if (a === "run") { var ta = phIn2.querySelector('[data-fc="' + id + '"]'); if (!ta) return; phSnap(); f.code = ta.value; delete f._err; phDraw(); phOutBar(); return phToast("Corriendo el filtro…"); }
  });
  phIn2.addEventListener("click", function (e) { if (e.target.closest("[data-pldel],[data-plup],[data-pldn],[data-plvis]")) phSnap(); }, true);
  X.onCodeFilter = function () { if (PH.tab === "filtros" && PH.mode !== "compose" && !(document.activeElement && document.activeElement.matches && document.activeElement.matches("#phInsp textarea"))) phInsp(); };
  /* tomar el color de la foto para una máscara de color */
  phStage.addEventListener("pointerdown", function (e) {
    if (!X.maskPick || !PH.base) return;
    var p = phPt(e), m = PH.r.masks.find(function (q) { return q.id === PH.mask; }); X.maskPick = false; phCursor();
    if (!m || m.kind !== "color" || p.u < 0 || p.u > 1 || p.v < 0 || p.v > 1) return;
    var i = (Math.floor(p.v * PH.base.h) * PH.base.w + Math.floor(p.u * PH.base.w)) * 4, d = PH.base.d, R = d[i] / 255, G = d[i + 1] / 255, B = d[i + 2] / 255, mx = Math.max(R, G, B), dd = mx - Math.min(R, G, B);
    e.stopImmediatePropagation(); e.preventDefault();
    if (dd < 0.04) return phToast("Ese punto casi no tiene color: prueba en una zona más saturada");
    phSnap(); m.hue = Math.round((mx === R ? ((G - B) / dd + 6) % 6 : mx === G ? (B - R) / dd + 2 : (R - G) / dd + 4) * 60); phAll();
  }, true);
  /* un pincel de máscara cambia sus píxeles: se marcan para guardarlos */
  phStage.addEventListener("pointerup", function () { if (PH.mode === "brush" && PH.mask && PH.brushCv[PH.mask]) PH.brushCv[PH.mask]._touched = true; var L = phActive(); if (PH.mode === "compose" && L && L.kind === "paint") L._touched = true; });
  X.onResize = function () { if (SEL.cv && SEL.has) { selCanvas(); selChanged(); } RT.base = null; };
  var _onLoad = X.onLoad; X.onLoad = function () { SEL.cv = null; SEL.has = false; SEL.edge = null; PEN.pts = null; LASSO = null; X.cloneSrc = null; RT.base = null; drawAnts(); if (_onLoad) _onLoad(); };
  /* textos que hablaban de «la maqueta» o «el editor real» */
  var _fly = pq("#phFly"); if (_fly) new MutationObserver(function () { _fly.querySelectorAll("button").forEach(function (b) { b.style.opacity = ""; }); }).observe(_fly, { childList: true });
  if (PH.open) phAll();
})();
