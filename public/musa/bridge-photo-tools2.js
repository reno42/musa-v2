/* bridge-photo-tools2.js — las 12 herramientas que antes decían «pronto», hechas de verdad:
 *   Mover › Mesa de trabajo (tamaño del lienzo, con su fondo) · Lazo magnético (camino de menor costo sobre los bordes)
 *   Recorte en perspectiva (homografía) · Segmentar (cortes que se exportan en un ZIP) · Muestras de color (hasta 10,
 *   con panel Info en vivo) · Regla (mide y endereza) · Pincel mezclador · Pincel histórico de arte · Pluma de curvatura
 *   · Rotar vista · Tampón de motivo · Máscara de texto.
 * Lo que es parte de la foto (perspectiva, lienzo y fondo, cortes, muestras, curvas) vive en el documento: se guarda,
 * se ve en «</> Código» y lo edita una IA por MCP. Lo demás pinta píxeles en capas o crea selecciones.
 */
(function boot(n) {
  "use strict";
  var X = window.__phx, PC = window.MusaPhotoCode;
  if (!X || !X.T || !X.code || !PC || !PC.warp) { if ((n || 0) < 900) setTimeout(function () { boot((n || 0) + 1); }, 150); return; }
  if (X.tools2) return;
  X.tools2 = true;
  var T = X.T, clamp = PC.clamp, clone = PC.clone, esc = X.esc, FULL = { x: 0, y: 0, w: 1, h: 1 };
  var say = function (m) { phToast(m); };
  var full = function () { return PH.base && PH.base.full ? PH.base.full : [1, 1]; };
  var spx = function () { return (PH.s || 1); };                          /* px de pantalla por px de vista */
  var VW = function () { return 1000; }, VH = function () { return PH.base ? 1000 * PH.base.h / PH.base.w : 1000; };
  var hsz = function () { return Math.max(4, 7 / spx() * (1000 / (PH.base ? PH.base.w : 1000))); };
  var near = function (a, b, px) { return Math.hypot((a[0] - b[0]) * PH.base.w * spx(), (a[1] - b[1]) * PH.base.h * spx()) <= (px || 12); };
  function rgb2hex(c) { return "#" + [c[0], c[1], c[2]].map(function (v) { return Math.round(v).toString(16).padStart(2, "0"); }).join(""); }
  function rgb2hsl(c) { var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn, h = 0, s = 0; if (d) { s = d / (1 - Math.abs(2 * l - 1)); h = (mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60; } return [Math.round(h), Math.round(s * 100), Math.round(l * 100)]; }
  function mixC(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function dlg(html, label) { var d = document.createElement("div"); d.className = "mdlg phx-dlg"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true"); d.setAttribute("aria-label", label); d.innerHTML = html; document.body.appendChild(d); var close = function () { d.remove(); document.removeEventListener("keydown", k, true); }; var k = function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } else e.stopPropagation(); }; document.addEventListener("keydown", k, true); d.addEventListener("pointerdown", function (e) { if (e.target === d) close(); }); var c = d.querySelector("[data-x=cancel]"); if (c) c.onclick = close; return { el: d, close: close }; }

  /* ═════════════ superposición propia (dentro de la foto: gira con la vista) y panel Info ═════════════ */
  var ov = document.createElement("div"); ov.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:4";
  ov.innerHTML = '<svg id="phX2" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible"></svg>';
  phImg.appendChild(ov);
  var svg = ov.firstChild;
  var info = document.createElement("div"); info.id = "phInfo"; info.hidden = true; info.setAttribute("aria-live", "polite"); phStage.appendChild(info);
  var css = document.createElement("style");
  css.textContent = "#phX2 .q{fill:none;stroke:#ff5e00;stroke-width:1.6;vector-effect:non-scaling-stroke}#phX2 .gq{fill:none;stroke:rgba(255,255,255,.55);stroke-width:1;vector-effect:non-scaling-stroke}#phX2 .dim{fill:rgba(0,0,0,.5);fill-rule:evenodd}"
    + "#phX2 .hd{fill:#fff;stroke:#ff5e00;stroke-width:1.5;vector-effect:non-scaling-stroke;pointer-events:all;cursor:move}#phX2 .sl{fill:rgba(255,94,0,.08);stroke:#ff5e00;stroke-width:1.4;vector-effect:non-scaling-stroke}#phX2 .sl.on{fill:rgba(255,94,0,.2);stroke-width:2.4}#phX2 text{fill:#fff;paint-order:stroke;stroke:#000;stroke-width:3px;font:600 12px Inter,system-ui,sans-serif}"
    + "#phX2 .ru{stroke:#fff;stroke-width:1.5;vector-effect:non-scaling-stroke;fill:none}#phX2 .ru2{stroke:#000;stroke-width:3.5;vector-effect:non-scaling-stroke;fill:none;opacity:.55}#phX2 .mg{fill:none;stroke:#00e0ff;stroke-width:1.6;vector-effect:non-scaling-stroke}#phX2 .mgf{fill:none;stroke:#fff;stroke-width:1.6;stroke-dasharray:4 3;vector-effect:non-scaling-stroke}"
    + "#phX2 .bd{fill:none;stroke:#ff5e00;stroke-width:1.5;stroke-dasharray:6 4;vector-effect:non-scaling-stroke}#phX2 .cv{fill:none;stroke:#ff5e00;stroke-width:1.6;vector-effect:non-scaling-stroke}"
    + "#phInfo{pointer-events:none;position:absolute;right:10px;top:10px;z-index:6;max-width:min(330px,calc(100% - 20px));background:rgba(18,18,18,.94);border:1px solid #333;border-radius:10px;padding:8px 10px;color:#e8e8e8;font:12px/1.5 'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;box-shadow:0 8px 28px rgba(0,0,0,.45)}"
    + "#phInfo .r{display:flex;gap:7px;align-items:center;white-space:nowrap}#phInfo i{width:12px;height:12px;border-radius:3px;border:1px solid #555;flex:none}#phInfo b{color:#ff8a4a;font-weight:600}#phInfo button{pointer-events:auto;margin-top:6px;height:24px;border-radius:6px;border:1px solid #3a3a3a;background:#222;color:#eee;font:600 11px Inter,system-ui,sans-serif;padding:0 8px;cursor:pointer}"
    + "#phView{background-color:#d9d9d9;background-image:linear-gradient(45deg,#b5b5b5 25%,transparent 25%,transparent 75%,#b5b5b5 75%),linear-gradient(45deg,#b5b5b5 25%,transparent 25%,transparent 75%,#b5b5b5 75%);background-size:16px 16px;background-position:0 0,8px 8px}"
    + ".phx-pat{display:flex;gap:4px;align-items:center}.phx-pat canvas{width:22px;height:22px;border-radius:4px;border:1px solid #444}";
  document.head.appendChild(css);

  /* ═════════════ estado de las herramientas ═════════════ */
  var PS = null;              /* perspectiva: { q } */
  var BD = null;              /* mesa de trabajo arrastrando: { r } */
  var MG = null;              /* lazo magnético */
  var CV = null;              /* pluma de curvatura: { pts, cur } */
  var SLC = { sel: null };    /* cortes: el elegido */
  X.ruler = null;
  X.boardBg = "#ffffff";
  X.mix = { wet: 50, load: 60, mix: 50, clean: true };
  X.art = { style: "corto", area: 60, fid: 85 };
  X.pat = { id: "cuadros", scale: 100, aligned: true };
  PH.viewRot = 0;
  var S = function () { return X.st(); };

  /* ═════════════ dibujo de la superposición ═════════════ */
  function P(u, v) { return (u * VW()).toFixed(2) + "," + (v * VH()).toFixed(2); }
  function smoothD(pts, closed) { var sp = PC.smoothPts(pts, closed); return sp.map(function (p, i) { return i ? (p.length >= 6 ? "C" + P(p[2], p[3]) + " " + P(p[4], p[5]) + " " + P(p[0], p[1]) : "L" + P(p[0], p[1])) : "M" + P(p[0], p[1]); }).join(" ") + (closed ? "Z" : ""); }
  function draw() {
    if (!PH.open || !PH.base) { svg.innerHTML = ""; return; }
    var W = VW(), H = VH(), hs = hsz(), h = "", g = PH.tool, v = phVar(g), fs = Math.max(8, 12 / spx() * (1000 / PH.base.w));
    svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("preserveAspectRatio", "none");
    if (PH.mode === "persp" && PS) {
      var q = PS.q, Hm = PC.homography(q), poly = q.map(function (p) { return P(p[0], p[1]); }).join(" ");
      h += '<path class="dim" d="M-5000,-5000H6000V6000H-5000Z M' + q.map(function (p) { return P(p[0], p[1]); }).join(" L") + 'Z"/>';
      for (var i = 1; i < 3; i++) { var a = PC.hApply(Hm, i / 3, 0), b = PC.hApply(Hm, i / 3, 1), c = PC.hApply(Hm, 0, i / 3), d = PC.hApply(Hm, 1, i / 3); h += '<line class="gq" x1="' + a[0] * W + '" y1="' + a[1] * H + '" x2="' + b[0] * W + '" y2="' + b[1] * H + '"/><line class="gq" x1="' + c[0] * W + '" y1="' + c[1] * H + '" x2="' + d[0] * W + '" y2="' + d[1] * H + '"/>'; }
      h += '<polygon class="q" points="' + poly + '"/>' + q.map(function (p, k) { return '<circle class="hd" data-pq="' + k + '" cx="' + p[0] * W + '" cy="' + p[1] * H + '" r="' + hs + '"/>'; }).join("");
    }
    if (PH.mode !== "crop" && PH.mode !== "persp") {
      if (g === "move" && v === "artboard") {
        var r = BD ? BD.r : { x0: 0, y0: 0, x1: 1, y1: 1 };
        h += '<rect class="bd" x="' + r.x0 * W + '" y="' + r.y0 * H + '" width="' + (r.x1 - r.x0) * W + '" height="' + (r.y1 - r.y0) * H + '"/>';
        [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]].forEach(function (c) { var x = r.x0 + (r.x1 - r.x0) * c[0], y = r.y0 + (r.y1 - r.y0) * c[1]; h += '<rect class="hd" x="' + (x * W - hs) + '" y="' + (y * H - hs) + '" width="' + hs * 2 + '" height="' + hs * 2 + '"/>'; });
        if (BD) { var fw = Math.round((r.x1 - r.x0) * full()[0]), fh = Math.round((r.y1 - r.y0) * full()[1]); h += '<text x="' + ((r.x0 + r.x1) / 2 * W) + '" y="' + (r.y1 * H + fs * 1.6) + '" text-anchor="middle" style="font-size:' + fs + 'px">' + fw + " × " + fh + " px</text>"; }
      }
      if (g === "crop" && v === "slice") (S().slices || []).forEach(function (s, k) {
        var on = s.id === SLC.sel;
        h += '<rect class="sl' + (on ? " on" : "") + '" x="' + s.x * W + '" y="' + s.y * H + '" width="' + s.w * W + '" height="' + s.h * H + '"/><text x="' + (s.x * W + fs * 0.5) + '" y="' + (s.y * H + fs * 1.3) + '" style="font-size:' + fs + 'px">' + (k + 1) + (s.name ? " · " + esc(s.name) : "") + "</text>";
        if (on) h += '<rect class="hd" x="' + ((s.x + s.w) * W - hs) + '" y="' + ((s.y + s.h) * H - hs) + '" width="' + hs * 2 + '" height="' + hs * 2 + '"/>';
      });
      (S().samplers || []).forEach(function (p, k) {
        var x = p[0] * W, y = p[1] * H, a2 = hs * 1.7;
        h += '<circle class="ru2" cx="' + x + '" cy="' + y + '" r="' + a2 + '"/><circle class="ru" cx="' + x + '" cy="' + y + '" r="' + a2 + '"/><line class="ru" x1="' + (x - a2 * 1.6) + '" y1="' + y + '" x2="' + (x + a2 * 1.6) + '" y2="' + y + '"/><line class="ru" x1="' + x + '" y1="' + (y - a2 * 1.6) + '" x2="' + x + '" y2="' + (y + a2 * 1.6) + '"/><text x="' + (x + a2 * 1.3) + '" y="' + (y + a2 * 2.6) + '" style="font-size:' + fs + 'px">' + (k + 1) + "</text>";
      });
      if (X.ruler && g === "eyedropper" && v === "ruler") {
        var R = X.ruler, m = rulerInfo();
        h += '<line class="ru2" x1="' + R.a[0] * W + '" y1="' + R.a[1] * H + '" x2="' + R.b[0] * W + '" y2="' + R.b[1] * H + '"/><line class="ru" x1="' + R.a[0] * W + '" y1="' + R.a[1] * H + '" x2="' + R.b[0] * W + '" y2="' + R.b[1] * H + '"/>'
          + [R.a, R.b].map(function (p) { return '<circle class="hd" cx="' + p[0] * W + '" cy="' + p[1] * H + '" r="' + hs * 0.6 + '"/>'; }).join("")
          + '<text x="' + ((R.a[0] + R.b[0]) / 2 * W + fs) + '" y="' + ((R.a[1] + R.b[1]) / 2 * H - fs) + '" style="font-size:' + fs + 'px">' + m.len + " px · " + m.ang + "°</text>";
      }
      if (MG) {
        var pts = MG.path.concat(MG.live || []);
        if (pts.length > 1) h += '<polyline class="mg" points="' + pts.map(function (p) { return P(p[0] / MG.w, p[1] / MG.h); }).join(" ") + '"/>';
        MG.anchors.forEach(function (a, k) { h += '<rect class="hd" x="' + (a[0] / MG.w * W - hs * 0.5) + '" y="' + (a[1] / MG.h * H - hs * 0.5) + '" width="' + hs + '" height="' + hs + '"/>'; });
      }
      if (CV && CV.pts.length) {
        var cp = CV.pts.concat(CV.cur ? [CV.cur] : []);
        if (cp.length > 1) h += '<path class="cv" d="' + smoothD(cp, false) + '"/>';
        CV.pts.forEach(function (p, k) { h += '<circle class="hd" cx="' + p[0] * W + '" cy="' + p[1] * H + '" r="' + hs * (k ? 0.5 : 0.8) + '"/>'; });
      }
    }
    if (svg.innerHTML !== h) svg.innerHTML = h;
  }
  X.draw2 = draw;
  var _ov = phOverlay;
  phOverlay = function () { var r = _ov.apply(this, arguments); try { draw(); infoSoon(); } catch (e) { /* superposición */ } return r; };

  /* ═════════════ panel Info: muestras de color y regla ═════════════ */
  var one = phCanvas(1, 1), og = one.getContext("2d", { willReadFrequently: true }), infoT = 0;
  function sampleAt(u, v) {
    og.clearRect(0, 0, 1, 1); og.globalCompositeOperation = "source-over"; og.globalAlpha = 1; og.imageSmoothingEnabled = true;
    var bw = phView.width, bh = phView.height, sx = clamp(u * bw - 1.5, 0, bw - 3), sy = clamp(v * bh - 1.5, 0, bh - 3);
    og.drawImage(phView, sx, sy, 3, 3, 0, 0, 1, 1);
    phLayers().forEach(function (L) { if (!L.vis || L.pre) return; var c = X.viewOf(L), lw = c.width, lh = c.height; og.globalAlpha = L.op / 100; og.globalCompositeOperation = L.blend === "normal" ? "source-over" : L.blend; og.drawImage(c, clamp(u * lw - 1.5, 0, lw - 3), clamp(v * lh - 1.5, 0, lh - 3), 3, 3, 0, 0, 1, 1); });
    var d = og.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3]];
  }
  function rulerInfo() {
    var R = X.ruler, f = full(), dx = (R.b[0] - R.a[0]) * f[0], dy = (R.b[1] - R.a[1]) * f[1];
    return { len: Math.round(Math.hypot(dx, dy)), ang: (Math.round(-Math.atan2(dy, dx) * 1800 / Math.PI) / 10).toString().replace(".", ","), dx: Math.round(dx), dy: Math.round(dy), raw: Math.atan2(dy, dx) * 180 / Math.PI };
  }
  function updateInfo() {
    infoT = 0;
    var sm = S().samplers || [], ru = X.ruler && PH.tool === "eyedropper" && phVar("eyedropper") === "ruler";
    var show = PH.open && PH.base && (sm.length || ru) && PH.mode !== "crop" && PH.mode !== "persp";
    info.hidden = !show; if (!show) return;
    var h = "";
    sm.forEach(function (p, k) { var c = sampleAt(p[0], p[1]), hs = rgb2hsl(c); h += '<div class="r"><b>#' + (k + 1) + '</b><i style="background:' + rgb2hex(c) + '"></i>R ' + c[0] + " G " + c[1] + " B " + c[2] + " · " + rgb2hex(c) + " · H " + hs[0] + "° S " + hs[1] + "% L " + hs[2] + "%" + (c[3] < 250 ? " · α " + Math.round(c[3] / 2.55) + "%" : "") + "</div>"; });
    if (ru) { var m = rulerInfo(); h += '<div class="r"><b>Regla</b>' + m.len + " px · " + m.ang + "° · Δx " + m.dx + " Δy " + m.dy + "</div>"; }
    if (sm.length) h += '<button type="button" data-p2="clearSamplers">Quitar muestras</button>';
    info.innerHTML = h;
  }
  function infoSoon() { if (!infoT) infoT = requestAnimationFrame(updateInfo); }
  info.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
  info.addEventListener("click", function (e) { var b = e.target.closest("[data-p2]"); if (b && b.dataset.p2 === "clearSamplers") { phSnap(); S().samplers = []; draw(); infoSoon(); phOutBar(); } });
  var _render = phRender;
  phRender = function () { var r = _render.apply(this, arguments); infoSoon(); return r; };

  /* ═════════════ rotar la vista: la foto gira en pantalla; los clics se llevan a la foto sin girar ═════════════ */
  var nativeRect = Element.prototype.getBoundingClientRect;
  function flatRect() { var st = nativeRect.call(phStage), L = st.left + (parseFloat(phImg.style.left) || 0), Tp = st.top + (parseFloat(phImg.style.top) || 0), W = parseFloat(phImg.style.width) || 0, H = parseFloat(phImg.style.height) || 0; return { left: L, top: Tp, width: W, height: H, right: L + W, bottom: Tp + H, x: L, y: Tp }; }
  Object.defineProperty(phImg, "getBoundingClientRect", { configurable: true, value: function () { return PH.viewRot ? flatRect() : nativeRect.call(phImg); } });
  function unrotate(x, y) { var r = flatRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, a = -PH.viewRot * Math.PI / 180, dx = x - cx, dy = y - cy; return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)]; }
  ["pointerdown", "pointermove", "pointerup", "pointercancel", "click", "dblclick"].forEach(function (ev) {
    window.addEventListener(ev, function (e) {
      if (!PH.open || !PH.viewRot || e.__rot || !e.target || !e.target.closest || !e.target.closest("#phStage") || e.target.closest("#phInfo")) return;
      if (PH.tool === "hand" || phSpace || e.button === 1 || (e.buttons & 4)) return;   /* mover la vista sigue en pantalla */
      var q = unrotate(e.clientX, e.clientY);
      try { Object.defineProperty(e, "__ox", { value: e.clientX }); Object.defineProperty(e, "__oy", { value: e.clientY }); Object.defineProperty(e, "clientX", { value: q[0], configurable: true }); Object.defineProperty(e, "clientY", { value: q[1], configurable: true }); Object.defineProperty(e, "__rot", { value: 1 }); } catch (er) { /* evento sellado */ }
    }, true);
  });
  var _mc = phMoveCursor;
  phMoveCursor = function (e) { if (e && e.__ox != null) return _mc.call(this, { clientX: e.__ox, clientY: e.__oy }); return _mc.apply(this, arguments); };
  function setViewRot(deg) {
    deg = ((Math.round(deg * 10) / 10 % 360) + 540) % 360 - 180; if (Math.abs(deg) < 0.05 || Math.abs(Math.abs(deg) - 180) < 0.05 && false) deg = 0;
    PH.viewRot = deg; phImg.style.transformOrigin = "50% 50%"; phImg.style.transform = deg ? "rotate(" + deg + "deg)" : "";
    var tag = pq("#phTag"); if (deg) { tag.hidden = false; tag.textContent = "Vista girada " + String(deg).replace(".", ",") + "° · Esc la endereza"; } else if (/Vista girada/.test(tag.textContent)) tag.hidden = true;
    draw();
  }
  X.setViewRot = setViewRot;
  function rotDown(e) {
    var r = nativeRect.call(phImg), cx = r.left + r.width / 2, cy = r.top + r.height / 2, a0 = Math.atan2(e.clientY - cy, e.clientX - cx), base = PH.viewRot || 0;
    phDrag(e, function (ev) { var a = Math.atan2(ev.clientY - cy, ev.clientX - cx), d = base + (a - a0) * 180 / Math.PI; if (ev.shiftKey) d = Math.round(d / 15) * 15; setViewRot(d); }, function () { phBar(); });
    return true;
  }

  /* ═════════════ geometría general (perspectiva): capas, máscaras, selección, cortes y muestras se quedan sobre lo mismo ═════════════ */
  function remapGeneral(g0, g1, old, nw) {
    var H1 = g1.persp ? PC.homography(g1.persp) : null, Hi1 = g1.persp ? PC.hInvert(H1) : null, H0 = g0.persp ? PC.homography(g0.persp) : null, Hi0 = g0.persp ? PC.hInvert(H0) : null;
    var n2o = function (u, v) { var c1 = g1.crop, wx = c1.x + u * c1.w, wy = c1.y + v * c1.h, o = H1 ? PC.hApply(H1, wx, wy) : [wx, wy], w0 = Hi0 ? PC.hApply(Hi0, o[0], o[1]) : o, c0 = g0.crop; return [(w0[0] - c0.x) / c0.w, (w0[1] - c0.y) / c0.h]; };
    var o2n = function (u, v) { var c0 = g0.crop, wx = c0.x + u * c0.w, wy = c0.y + v * c0.h, o = H0 ? PC.hApply(H0, wx, wy) : [wx, wy], w1 = Hi1 ? PC.hApply(Hi1, o[0], o[1]) : o, c1 = g1.crop; return [(w1[0] - c1.x) / c1.w, (w1[1] - c1.y) / c1.h]; };
    var remapCv = function (cv, W, H) {
      var sw = cv.width, sh = cv.height, sd = cv.getContext("2d").getImageData(0, 0, sw, sh).data, o = phCanvas(W, H), og2 = o.getContext("2d"), id = og2.createImageData(W, H), od = id.data;
      for (var y = 0, i = 0; y < H; y++) for (var x = 0; x < W; x++, i += 4) {
        var q = n2o((x + 0.5) / W, (y + 0.5) / H), px = q[0] * sw - 0.5, py = q[1] * sh - 0.5;
        if (px < -0.5 || py < -0.5 || px > sw - 0.5 || py > sh - 0.5) continue;
        var x0 = Math.max(0, Math.floor(px)), y0 = Math.max(0, Math.floor(py)), x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1), fx = Math.max(0, px - x0), fy = Math.max(0, py - y0), a = (y0 * sw + x0) * 4, b = (y0 * sw + x1) * 4, c = (y1 * sw + x0) * 4, d = (y1 * sw + x1) * 4;
        for (var k = 0; k < 4; k++) { var t = sd[a + k] + (sd[b + k] - sd[a + k]) * fx, bt = sd[c + k] + (sd[d + k] - sd[c + k]) * fx; od[i + k] = t + (bt - t) * fy; }
      }
      og2.putImageData(id, 0, 0); return o;
    };
    var box = function (b) { var c = o2n(b.x + b.w / 2, b.y + b.h / 2), l = o2n(b.x, b.y + b.h / 2), r = o2n(b.x + b.w, b.y + b.h / 2), t = o2n(b.x + b.w / 2, b.y), bt = o2n(b.x + b.w / 2, b.y + b.h), w = Math.max(0.002, Math.hypot(r[0] - l[0], r[1] - l[1])), h = Math.max(0.002, Math.hypot(bt[0] - t[0], bt[1] - t[1])); return { x: c[0] - w / 2, y: c[1] - h / 2, w: w, h: h, rot: b.rot || 0 }; };
    phLayers().forEach(function (L) {
      if (L.kind === "paint") L.cv = remapCv(L.cv, nw[0], nw[1]); else L.cv = phCanvas(nw[0], nw[1]);
      if (L.mcv) L.mcv = remapCv(L.mcv, nw[0], nw[1]);
      L.dv = null; L._touched = true;
      if (L.text) { var q = o2n(L.text.x, L.text.y), q2 = o2n(L.text.x, L.text.y + L.text.size); L.text.x = q[0]; L.text.y = q[1]; L.text.size = clamp(Math.hypot(q2[0] - q[0], q2[1] - q[1]), 0.004, 2); }
      if (L.box && L.kind !== "paint") L.box = box(L.box);
      if (L.shape && L.shape.pts) L.shape.pts = L.shape.pts.map(function (pt) { var o = []; for (var i = 0; i < pt.length; i += 2) { var q3 = o2n(pt[i], pt[i + 1]); o.push(q3[0], q3[1]); } return o; });
      phLayerRender(L);
    });
    var kk = Math.min(1, PH_WORK / Math.max(nw[0], nw[1])), sz = PC.outSize(PH.src.width, PH.src.height, g1), bk = Math.min(1, PH_WORK / Math.max(sz[0], sz[1])), BW = Math.max(1, Math.round(sz[0] * bk)), BH = Math.max(1, Math.round(sz[1] * bk));
    PH.r.masks.forEach(function (m) {
      if (m.kind === "radial") { var c = o2n(m.cx, m.cy), a = o2n(m.cx + m.rx, m.cy), b = o2n(m.cx, m.cy + m.ry); m.cx = c[0]; m.cy = c[1]; m.rx = Math.max(0.01, Math.hypot(a[0] - c[0], a[1] - c[1])); m.ry = Math.max(0.01, Math.hypot(b[0] - c[0], b[1] - c[1])); }
      if (m.kind === "linear") { var p1 = o2n(m.x1, m.y1), p2 = o2n(m.x2, m.y2); m.x1 = p1[0]; m.y1 = p1[1]; m.x2 = p2[0]; m.y2 = p2[1]; }
      if (m.kind === "brush" && PH.brushCv[m.id]) { PH.brushCv[m.id] = remapCv(PH.brushCv[m.id], BW, BH); PH.brushCv[m.id]._touched = true; }
    });
    var St = S(); Object.keys(St.fmask).forEach(function (id) { St.fmask[id] = remapCv(St.fmask[id], BW, BH); });
    var sel = X.selGet(); if (sel) X.selSet(remapCv(sel, nw[0], nw[1]));
    St.slices = (St.slices || []).map(function (s) { var a = o2n(s.x, s.y), b = o2n(s.x + s.w, s.y + s.h), x = clamp(Math.min(a[0], b[0]), 0, 0.999), y = clamp(Math.min(a[1], b[1]), 0, 0.999); return Object.assign({}, s, { x: x, y: y, w: clamp(Math.abs(b[0] - a[0]), 0.002, 1 - x), h: clamp(Math.abs(b[1] - a[1]), 0.002, 1 - y) }); });
    St.samplers = (St.samplers || []).map(function (p) { return o2n(p[0], p[1]); }).filter(function (p) { return p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1; });
    T.RT.base = null;
    void kk;
  }
  function geoGeneral(fn) {
    X.snapFull();
    var g0 = clone(PH.r.geo), old = X.lres();
    fn(PH.r.geo); PH.r = PC.normRecipe(PH.r);
    var g1 = clone(PH.r.geo), nw = X.lres();
    remapGeneral(g0, g1, old, nw);
    PH.base = null; PH.bkey = ""; X.touchPre(true);
    phEnsureBase(); T.selChanged(); phAll(); if (X.onChange) X.onChange("geo");
  }
  X.geoGeneral = geoGeneral;

  /* ═════════════ recorte en perspectiva ═════════════ */
  var _geo = phGeo;
  phGeo = function () { if (PH.mode === "persp") return Object.assign({}, PH.r.geo, { persp: null, bg: undefined, crop: clone(FULL) }); return _geo.apply(this, arguments); };
  function enterPersp() {
    if (PH.mode === "crop") phMode("edit");
    PS = { q: PH.r.geo.persp ? clone(PH.r.geo.persp) : [[0.06, 0.06], [0.94, 0.06], [0.94, 0.94], [0.06, 0.94]] };
    PH.mode = "persp"; PH.tool = "crop"; PH.vars.crop = "perspective"; PH.base = null; PH.bkey = "";
    phAll();
    say("Lleva cada esquina sobre algo que deba quedar recto (un cartel, una pared, una hoja) · Enter aplica, Esc cancela");
  }
  function leavePersp() { PS = null; PH.mode = "edit"; PH.base = null; PH.bkey = ""; }
  function perspApply() {
    if (!PS) return; var q = PS.q; leavePersp();
    if (Math.abs(PC.quadArea(q)) < 0.004) { phAll(); return say("Las esquinas están demasiado juntas"); }
    geoGeneral(function (g) { g.persp = q; g.crop = clone(FULL); });
    say("Perspectiva corregida · queda en la foto y se puede volver a ajustar");
  }
  function perspClear() { leavePersp(); if (!PH.r.geo.persp) return phAll(); geoGeneral(function (g) { g.persp = null; g.crop = clone(FULL); }); say("Perspectiva quitada"); }
  function perspDown(e, p) {
    if (e.target.closest && e.target.closest("[data-pq]")) {
      var k = +e.target.closest("[data-pq]").dataset.pq;
      phDrag(e, function (ev) { var q = phPt(ev); PS.q[k] = [clamp(q.u, -0.25, 1.25), clamp(q.v, -0.25, 1.25)]; draw(); });
      return true;
    }
    var best = -1, bd = 1e9; PS.q.forEach(function (c, i) { var d = Math.hypot((c[0] - p.u) * PH.base.w, (c[1] - p.v) * PH.base.h) * spx(); if (d < bd) { bd = d; best = i; } });
    if (bd < 22) { phDrag(e, function (ev) { var q = phPt(ev); PS.q[best] = [clamp(q.u, -0.25, 1.25), clamp(q.v, -0.25, 1.25)]; draw(); }); return true; }
    var q0 = clone(PS.q); phDrag(e, function (ev) { var q = phPt(ev), du = q.u - p.u, dv = q.v - p.v; PS.q = q0.map(function (c) { return [c[0] + du, c[1] + dv]; }); draw(); });
    return true;
  }
  var _mode = phMode;
  phMode = function (m) {
    if (PH.mode === "persp" && m !== "persp") { leavePersp(); if (m === "edit") { phAll(); return; } }
    if (MG || CV) { MG = null; CV = null; }
    return _mode.apply(this, arguments);
  };

  /* ═════════════ mesa de trabajo: el lienzo crece o se achica alrededor de la foto ═════════════ */
  function oriSize() { return PC.outSize(PH.src.width, PH.src.height, Object.assign({}, PH.r.geo, { crop: FULL })); }
  function setBoard(r, bg) {
    var c0 = clone(PH.r.geo.crop), c1 = { x: c0.x + r.x0 * c0.w, y: c0.y + r.y0 * c0.h, w: (r.x1 - r.x0) * c0.w, h: (r.y1 - r.y0) * c0.h };
    if (Math.abs(c1.w - c0.w) < 1e-6 && Math.abs(c1.h - c0.h) < 1e-6 && Math.abs(c1.x - c0.x) < 1e-6 && Math.abs(c1.y - c0.y) < 1e-6) return;
    var out = c1.x < -1e-6 || c1.y < -1e-6 || c1.x + c1.w > 1 + 1e-6 || c1.y + c1.h > 1 + 1e-6;
    T.geoChange(function (g) { g.crop = c1; if (out && bg !== undefined) g.bg = bg; else if (out && !g.bg && X.boardBg !== "transparent") g.bg = X.boardBg; }, "crop", c0, c1);
  }
  function boardDown(e, p) {
    var hp = 14 / (PH.base.w * spx()), vp = 14 / (PH.base.h * spx()), u = p.u, v = p.v;
    var L = Math.abs(u) < hp, R = Math.abs(u - 1) < hp, Tt = Math.abs(v) < vp, B = Math.abs(v - 1) < vp, inY = v > -vp && v < 1 + vp, inX = u > -hp && u < 1 + hp;
    var ed = { l: L && inY, r: R && inY, t: Tt && inX, b: B && inX };
    if (!ed.l && !ed.r && !ed.t && !ed.b) return true;
    BD = { r: { x0: 0, y0: 0, x1: 1, y1: 1 } };
    var snap = function (x) { return Math.abs(x) < hp * 0.6 ? 0 : Math.abs(x - 1) < hp * 0.6 ? 1 : x; };
    phDrag(e, function (ev) {
      var q = phPt(ev), r = BD.r;
      if (ed.l) r.x0 = Math.min(snap(q.u), r.x1 - 0.02); if (ed.r) r.x1 = Math.max(snap(q.u), r.x0 + 0.02);
      if (ed.t) r.y0 = Math.min(snap(q.v), r.y1 - 0.02); if (ed.b) r.y1 = Math.max(snap(q.v), r.y0 + 0.02);
      if (ev.shiftKey && (ed.l || ed.r) !== (ed.t || ed.b) === false) { /* esquina con Shift: conserva la proporción */ var ar = PH.base.w / PH.base.h, w = (r.x1 - r.x0) * PH.base.w, h = (r.y1 - r.y0) * PH.base.h; if (w / h > ar) { var nh = w / ar / PH.base.h; if (ed.t) r.y0 = r.y1 - nh; else r.y1 = r.y0 + nh; } else { var nw = h * ar / PH.base.w; if (ed.l) r.x0 = r.x1 - nw; else r.x1 = r.x0 + nw; } }
      draw();
    }, function () { var r = BD.r; BD = null; draw(); setBoard(r); });
    return true;
  }
  var PRESETS = [["libre", "Libre"], ["1", "1:1 cuadrado"], ["0.8", "4:5 Instagram"], ["0.5625", "9:16 historia"], ["1.7778", "16:9"], ["1.5", "3:2"], ["0.6667", "2:3"], ["0.7071", "A4 vertical"], ["1.4142", "A4 horizontal"]];
  function boardPreset(ar) {
    var f = full(), w = f[0], h = f[1], W2 = w, H2 = h;
    if (w / h < ar) W2 = h * ar; else H2 = w / ar;
    var dx = (W2 - w) / 2 / w, dy = (H2 - h) / 2 / h;
    setBoard({ x0: -dx, y0: -dy, x1: 1 + dx, y1: 1 + dy });
  }
  function boardSize(Wpx, Hpx) { var f = full(), dx = (Wpx - f[0]) / 2 / f[0], dy = (Hpx - f[1]) / 2 / f[1]; setBoard({ x0: -dx, y0: -dy, x1: 1 + dx, y1: 1 + dy }); }
  function boardFit() { var c = PH.r.geo.crop, x0 = Math.max(0, c.x), y0 = Math.max(0, c.y), x1 = Math.min(1, c.x + c.w), y1 = Math.min(1, c.y + c.h); setBoard({ x0: (x0 - c.x) / c.w, y0: (y0 - c.y) / c.h, x1: (x1 - c.x) / c.w, y1: (y1 - c.y) / c.h }); }

  /* ═════════════ lazo magnético: camino de menor costo (Dijkstra) sobre el borde más fuerte ═════════════ */
  function magMap() {
    var C = T.compData(), k = Math.min(1, 640 / Math.max(C.w, C.h)), w = Math.max(8, Math.round(C.w * k)), h = Math.max(8, Math.round(C.h * k)), t = phCanvas(w, h), g = t.getContext("2d", { willReadFrequently: true });
    g.drawImage(C.cv, 0, 0, w, h);
    var d = g.getImageData(0, 0, w, h).data, L = new Float32Array(w * h), i;
    for (i = 0; i < w * h; i++) L[i] = d[i * 4] * 0.2126 + d[i * 4 + 1] * 0.7152 + d[i * 4 + 2] * 0.0722;
    var G = new Float32Array(w * h), mx = 1;
    for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) { i = y * w + x; var gx = L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1], gy = L[i + w - 1] + 2 * L[i + w] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - w] - L[i - w + 1]; G[i] = Math.sqrt(gx * gx + gy * gy); if (G[i] > mx) mx = G[i]; }
    var cost = new Float32Array(w * h); for (i = 0; i < w * h; i++) cost[i] = 1 - Math.sqrt(G[i] / mx) * 0.97;
    return { w: w, h: h, cost: cost, G: G };
  }
  function snapEdge(M, x, y, r) { var bx = x, by = y, bg = -1; for (var yy = Math.max(0, y - r); yy <= Math.min(M.h - 1, y + r); yy++) for (var xx = Math.max(0, x - r); xx <= Math.min(M.w - 1, x + r); xx++) { var g = M.G[yy * M.w + xx]; if (g > bg) { bg = g; bx = xx; by = yy; } } return [bx, by]; }
  function livewire(M, a, b) {
    var pad = 24, x0 = Math.max(0, Math.min(a[0], b[0]) - pad), y0 = Math.max(0, Math.min(a[1], b[1]) - pad), x1 = Math.min(M.w - 1, Math.max(a[0], b[0]) + pad), y1 = Math.min(M.h - 1, Math.max(a[1], b[1]) + pad);
    var W = x1 - x0 + 1, H = y1 - y0 + 1, N = W * H, dist = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    var heap = [], hd = [], push = function (i, d) { heap.push(i); hd.push(d); var c = heap.length - 1; while (c) { var pp = (c - 1) >> 1; if (hd[pp] <= hd[c]) break; var t = heap[pp]; heap[pp] = heap[c]; heap[c] = t; var td = hd[pp]; hd[pp] = hd[c]; hd[c] = td; c = pp; } };
    var pop = function () { var top = heap[0], ld = hd.pop(), li = heap.pop(); if (heap.length) { heap[0] = li; hd[0] = ld; var c = 0; for (;;) { var l = c * 2 + 1, r = l + 1, m = c; if (l < heap.length && hd[l] < hd[m]) m = l; if (r < heap.length && hd[r] < hd[m]) m = r; if (m === c) break; var t = heap[m]; heap[m] = heap[c]; heap[c] = t; var td = hd[m]; hd[m] = hd[c]; hd[c] = td; c = m; } } return top; };
    var s = (a[1] - y0) * W + (a[0] - x0), tg = (b[1] - y0) * W + (b[0] - x0); dist[s] = 0; push(s, 0);
    var NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [-1, 1, 1.4142], [1, -1, 1.4142], [-1, -1, 1.4142]];
    while (heap.length) {
      var i = pop(); if (done[i]) continue; done[i] = 1; if (i === tg) break;
      var x = i % W, y = (i - x) / W, di = dist[i];
      for (var k = 0; k < 8; k++) { var nx = x + NB[k][0], ny = y + NB[k][1]; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; var j = ny * W + nx; if (done[j]) continue; var nd = di + (M.cost[(ny + y0) * M.w + nx + x0] + 0.015) * NB[k][2]; if (nd < dist[j]) { dist[j] = nd; prev[j] = i; push(j, nd); } }
    }
    var path = [], c = tg; while (c >= 0) { path.push([c % W + x0, ((c - c % W) / W) + y0]); if (c === s) break; c = prev[c]; }
    return path.reverse();
  }
  function magPt(p) { return snapEdge(MG, clamp(Math.round(p.u * MG.w), 0, MG.w - 1), clamp(Math.round(p.v * MG.h), 0, MG.h - 1), 4); }
  function magDown(e, p) {
    if (!MG) {
      if (p.u < 0 || p.u > 1 || p.v < 0 || p.v > 1) return true;
      MG = magMap(); MG.mode = T.selMode(e); var a = magPt(p); MG.anchors = [a]; MG.path = [a]; MG.live = null; MG.len = 0;
      draw(); say("Mueve el mouse por el borde: el lazo se pega solo · clic agrega un punto · doble clic o Enter cierra · Retroceso borra el último punto");
      return true;
    }
    var first = MG.anchors[0], pt = magPt(p);
    if ((MG.anchors.length > 2 && Math.hypot((pt[0] - first[0]) / MG.w * PH.base.w, (pt[1] - first[1]) / MG.h * PH.base.h) * spx() < 12) || e.detail >= 2) { magClose(); return true; }
    magCommit(pt); return true;
  }
  function magCommit(pt) { var seg = livewire(MG, MG.anchors[MG.anchors.length - 1], pt); MG.path = MG.path.concat(seg.slice(1)); MG.anchors.push(pt); MG.live = null; MG.len = 0; draw(); }
  var magRaf = 0, magQ = null;
  phStage.addEventListener("pointermove", function (e) {
    if (!PH.open) return;
    var p = phPt(e);
    if (MG) { magQ = p; if (!magRaf) magRaf = requestAnimationFrame(function () { magRaf = 0; if (!MG || !magQ) return; var pt = magPt(magQ), last = MG.anchors[MG.anchors.length - 1], seg = livewire(MG, last, pt); MG.live = seg.slice(1); if (seg.length > 60) { var mid = seg[Math.floor(seg.length * 0.7)]; MG.path = MG.path.concat(seg.slice(1, Math.floor(seg.length * 0.7) + 1)); MG.anchors.push(mid); MG.live = livewire(MG, mid, pt).slice(1); } draw(); }); }
    if (CV && CV.pts.length) { CV.cur = [p.u, p.v]; draw(); }
  });
  function magClose() {
    if (!MG) return;
    var M = MG; MG = null;
    var seg = livewire(M, M.anchors[M.anchors.length - 1], M.anchors[0]), pts = M.path.concat(seg.slice(1));
    if (pts.length < 3) { draw(); return; }
    phSnap();
    T.selDraw(M.mode, function (c, w, h) { c.beginPath(); pts.forEach(function (q, i) { c[i ? "lineTo" : "moveTo"]((q[0] + 0.5) / M.w * w, (q[1] + 0.5) / M.h * h); }); c.closePath(); c.fill(); });
    if (PH.brush.feather) T.featherQuiet(); else T.selChanged();
    draw(); phBar();
  }
  X.magClose = magClose;

  /* ═════════════ segmentar: cortes para exportar ═════════════ */
  function sliceHit(u, v) { var sl = S().slices || []; for (var i = sl.length - 1; i >= 0; i--) { var s = sl[i]; if (u >= s.x && u <= s.x + s.w && v >= s.y && v <= s.y + s.h) return s; } return null; }
  function sliceDown(e, p) {
    var St = S(); St.slices = St.slices || [];
    var cur = St.slices.find(function (s) { return s.id === SLC.sel; });
    if (cur && near([cur.x + cur.w, cur.y + cur.h], [p.u, p.v], 12)) {
      phSnap(); var s0 = clone(cur);
      phDrag(e, function (ev) { var q = phPt(ev); cur.w = clamp(q.u - s0.x, 0.004, 1 - s0.x); cur.h = clamp(q.v - s0.y, 0.004, 1 - s0.y); draw(); }, function () { phOutBar(); });
      return true;
    }
    var hit = sliceHit(p.u, p.v);
    if (hit && e.detail >= 2) { SLC.sel = hit.id; draw(); renameSlice(hit); return true; }
    /* arrastrar el corte elegido lo mueve; sobre otro corte se dibuja uno nuevo (un clic sin arrastrar lo elige) */
    if (hit && hit.id === SLC.sel && !e.altKey) {
      phSnap(); var h0 = clone(hit);
      phDrag(e, function (ev) { var q = phPt(ev); hit.x = clamp(h0.x + q.u - p.u, 0, 1 - h0.w); hit.y = clamp(h0.y + q.v - p.v, 0, 1 - h0.h); draw(); }, function () { phOutBar(); });
      return true;
    }
    if (St.slices.length >= PC.MAX_SLICES) { say("Máximo " + PC.MAX_SLICES + " cortes"); return true; }
    phSnap(); var ns = { id: PC.uid("s"), x: clamp(p.u, 0, 1), y: clamp(p.v, 0, 1), w: 0.004, h: 0.004 }; St.slices.push(ns); SLC.sel = ns.id;
    phDrag(e, function (ev) { var q = phPt(ev), x0 = clamp(Math.min(p.u, q.u), 0, 1), y0 = clamp(Math.min(p.v, q.v), 0, 1), x1 = clamp(Math.max(p.u, q.u), 0, 1), y1 = clamp(Math.max(p.v, q.v), 0, 1); ns.x = x0; ns.y = y0; ns.w = Math.max(0.004, x1 - x0); ns.h = Math.max(0.004, y1 - y0); draw(); },
      function () { if (ns.w * PH.base.w * spx() < 6 || ns.h * PH.base.h * spx() < 6) { St.slices.pop(); PH.hist.pop(); SLC.sel = hit ? hit.id : null; phTopBtns(); } draw(); phBar(); phOutBar(); });
    return true;
  }
  function renameSlice(s) { window.__musaReal.promptBox("Nombre del corte (para el archivo)", s.name || "", { title: "Corte", label: "Nombre", ok: "Guardar" }).then(function (v) { if (v == null) return; phSnap(); s.name = String(v).trim().slice(0, 60) || undefined; if (!s.name) delete s.name; draw(); }); }
  function gridDialog() {
    var d = dlg('<form class="phx-card"><h3>Cuadrícula de cortes</h3><p>Divide la foto en partes iguales (carrusel, mosaico de 3×3 para tu perfil…). Reemplaza los cortes actuales.</p><div class="phx-row" style="justify-content:flex-start"><label>Filas<input type="number" name="r" min="1" max="8" value="1"></label><label>Columnas<input type="number" name="c" min="1" max="8" value="3"></label></div><div class="phx-row"><button type="button" data-x="cancel">Cancelar</button><button type="submit" class="pri">Crear cortes</button></div></form>', "Cuadrícula de cortes");
    d.el.querySelector("form").addEventListener("submit", function (e) {
      e.preventDefault(); var f = e.target, r = clamp(Math.round(+f.r.value || 1), 1, 8), c = clamp(Math.round(+f.c.value || 1), 1, 8);
      phSnap(); var sl = []; for (var y = 0; y < r; y++) for (var x = 0; x < c; x++) sl.push({ id: PC.uid("s"), x: x / c, y: y / r, w: 1 / c, h: 1 / r }); S().slices = sl; SLC.sel = null;
      d.close(); draw(); phBar(); phOutBar(); say(sl.length + " cortes listos · «Exportar cortes» los descarga en un ZIP");
    });
    setTimeout(function () { d.el.querySelector("input").focus(); }, 30);
  }
  /* ZIP sin compresión (las imágenes ya vienen comprimidas) */
  var CRC = (function () { var t = new Uint32Array(256); for (var n2 = 0; n2 < 256; n2++) { var c = n2; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n2] = c >>> 0; } return t; })();
  function crc32(u8) { var c = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    var enc = new TextEncoder(), parts = [], cen = [], off = 0, now = new Date(), tm = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), dt = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    files.forEach(function (f) {
      var nm = enc.encode(f.name), crc = crc32(f.data), n3 = f.data.length, lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, tm, true); lh.setUint16(12, dt, true); lh.setUint32(14, crc, true); lh.setUint32(18, n3, true); lh.setUint32(22, n3, true); lh.setUint16(26, nm.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), nm, f.data);
      var ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, tm, true); ch.setUint16(14, dt, true); ch.setUint32(16, crc, true); ch.setUint32(20, n3, true); ch.setUint32(24, n3, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
      cen.push(new Uint8Array(ch.buffer), nm); off += 30 + nm.length + n3;
    });
    var cs = cen.reduce(function (a, b) { return a + b.length; }, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
    return new Blob(parts.concat(cen, [new Uint8Array(e.buffer)]), { type: "application/zip" });
  }
  X.zip = zip;
  function exportSlices() {
    var sl = S().slices || []; if (!sl.length) return say("Primero dibuja cortes o crea una cuadrícula");
    var base = ((PH.t && PH.t.name) || "foto").replace(/\.(png|jpe?g|webp|gif|heic|heif|avif|tiff?)$/i, "").replace(/[\\/:*?"<>|]+/g, "").trim() || "foto";
    var d = dlg('<form class="phx-card"><h3>Exportar '+ sl.length + ' cortes</h3><label>Formato<select name="fmt"><option value="jpg">JPG</option><option value="png">PNG</option><option value="webp">WebP</option></select></label><p class="phx-info" aria-live="polite">Cada corte a tamaño real, en un ZIP.</p><div class="phx-row"><button type="button" data-x="cancel">Cancelar</button><button type="submit" class="pri">Descargar ZIP</button></div></form>', "Exportar cortes");
    if (PH.src && X.hasAlpha(phView)) d.el.querySelector("[name=fmt]").value = "png";
    d.el.querySelector("form").addEventListener("submit", function (ev) {
      ev.preventDefault(); var btn = ev.target.querySelector("button[type=submit]"), fmt = ev.target.fmt.value, inf = d.el.querySelector(".phx-info"); btn.disabled = true; btn.textContent = "Preparando…";
      X.flattenAsync(X.maxOut()).then(function (cv) {
        var files = [], i = 0, type = fmt === "png" ? "image/png" : fmt === "webp" ? "image/webp" : "image/jpeg";
        var next = function () {
          if (i >= sl.length) return zip(files);
          var s = sl[i], x = Math.round(s.x * cv.width), y = Math.round(s.y * cv.height), w = Math.max(1, Math.round((s.x + s.w) * cv.width) - x), h = Math.max(1, Math.round((s.y + s.h) * cv.height) - y), c = phCanvas(w, h);
          c.getContext("2d").drawImage(cv, x, y, w, h, 0, 0, w, h); inf.textContent = "Corte " + (i + 1) + " de " + sl.length + "…";
          return new Promise(function (r) { c.toBlob(r, type, 0.92); }).then(function (b) { return b.arrayBuffer().then(function (ab) { var ext = b.type === "image/png" ? "png" : b.type === "image/webp" ? "webp" : "jpg"; files.push({ name: base + "_" + String(i + 1).padStart(2, "0") + (s.name ? "_" + s.name.replace(/[\\/:*?"<>|]+/g, "") : "") + "." + ext, data: new Uint8Array(ab) }); i++; return next(); }); });
        };
        return next();
      }).then(function (blob) {
        var a = document.createElement("a"), u = URL.createObjectURL(blob); a.href = u; a.download = base + "_cortes.zip"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
        d.close(); say(sl.length + " cortes exportados en un ZIP");
      }).catch(function (er) { btn.disabled = false; btn.textContent = "Descargar ZIP"; inf.textContent = "No se pudo exportar: " + X.errOf(er); });
    });
  }
  X.exportSlices = exportSlices;

  /* ═════════════ muestras de color y regla ═════════════ */
  function samplerDown(e, p) {
    var sm = S().samplers = S().samplers || [], i = sm.findIndex(function (q) { return near(q, [p.u, p.v], 10); });
    if (i >= 0 && e.altKey) { phSnap(); sm.splice(i, 1); draw(); infoSoon(); return true; }
    if (i < 0) { if (p.u < 0 || p.u > 1 || p.v < 0 || p.v > 1) return true; if (sm.length >= PC.MAX_SAMPLERS) { say("Máximo " + PC.MAX_SAMPLERS + " muestras: Alt+clic quita una"); return true; } phSnap(); sm.push([p.u, p.v]); i = sm.length - 1; }
    else phSnap();
    phDrag(e, function (ev) { var q = phPt(ev); sm[i] = [clamp(q.u, 0, 1), clamp(q.v, 0, 1)]; draw(); infoSoon(); }, function () { phOutBar(); });
    draw(); infoSoon(); return true;
  }
  function rulerDown(e, p) {
    var R = X.ruler, end = R && near(R.b, [p.u, p.v], 10) ? "b" : R && near(R.a, [p.u, p.v], 10) ? "a" : null;
    if (!end) { X.ruler = R = { a: [p.u, p.v], b: [p.u, p.v] }; end = "b"; }
    phDrag(e, function (ev) { var q = phPt(ev), o = end === "a" ? R.b : R.a, pt = [q.u, q.v]; if (ev.shiftKey) { var f = full(), ang = Math.round(Math.atan2((pt[1] - o[1]) * f[1], (pt[0] - o[0]) * f[0]) / (Math.PI / 4)) * Math.PI / 4, L = Math.hypot((pt[0] - o[0]) * f[0], (pt[1] - o[1]) * f[1]); pt = [o[0] + Math.cos(ang) * L / f[0], o[1] + Math.sin(ang) * L / f[1]]; } R[end] = pt; draw(); infoSoon(); }, function () { phBar(); });
    draw(); infoSoon(); return true;
  }
  function rulerStraighten() {
    if (!X.ruler) return say("Primero traza la regla sobre algo que deba quedar recto");
    var a = rulerInfo().raw; while (a > 90) a -= 180; while (a <= -90) a += 180;
    var d = Math.abs(a) <= 45 ? -a : a > 0 ? 90 - a : -90 - a, nv = clamp(PH.r.geo.straighten + d, -45, 45);
    if (Math.abs(PH.r.geo.straighten + d) > 45) say("Se enderezó hasta 45°, el máximo");
    phSnap(); PH.r.geo.straighten = Math.round(nv * 10) / 10; X.ruler = null; PH.base = null; PH.bkey = ""; phAll();
    say("Enderezada " + String(Math.round(d * 10) / 10).replace(".", ",") + "°");
  }
  X.rulerStraighten = rulerStraighten;

  /* ═════════════ pinceles que pintan en una capa: mezclador e histórico de arte ═════════════ */
  function needCompose() { if (PH.mode !== "compose") phMode("compose"); }
  function dabCanvas(rad) { var d = Math.max(4, Math.ceil(rad * 2) + 2), c = phCanvas(d, d); return { c: c, g: c.getContext("2d"), d: d }; }
  function clipDab(D, x0, y0) { var SEL = X.sel; if (SEL && SEL.has) { D.g.globalCompositeOperation = "destination-in"; D.g.drawImage(SEL.cv, x0, y0, D.d, D.d, 0, 0, D.d, D.d); D.g.globalCompositeOperation = "source-over"; } }
  function pixAt(data, w, h, x, y) { x = clamp(Math.round(x), 0, w - 1); y = clamp(Math.round(y), 0, h - 1); var i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; }
  function mixerDown(e, p) {
    needCompose();
    if (p.u < 0 || p.u > 1 || p.v < 0 || p.v > 1) return true;
    var L = T.activePaint(); phSnapLayer(L);
    var W = L.cv.width, H = L.cv.height, C = T.compData(), lg = L.cv.getContext("2d", { willReadFrequently: true });
    if (X.mix.clean || !X.mix.res) X.mix.res = PC.hex(PH.front);
    var res = X.mix.res.slice(), left = 1, wet = X.mix.wet / 100, pick = X.mix.mix / 100, decay = (1 - X.mix.load / 100) * 0.035;
    var stamp = function (u, v) {
      var rad = Math.max(1, PH.brush.size / 2 * T.kScale()), D = dabCanvas(rad), x0 = Math.round(u * W - D.d / 2), y0 = Math.round(v * H - D.d / 2);
      var wetPx = lg.getImageData(clamp(Math.round(u * W), 0, W - 1), clamp(Math.round(v * H), 0, H - 1), 1, 1).data, under = wetPx[3] > 30 ? [wetPx[0], wetPx[1], wetPx[2]] : pixAt(C.d, C.w, C.h, u * C.w, v * C.h);
      var col = mixC(res, under, wet); res = mixC(res, under, pick * 0.35);
      var hard = PH.brush.hard / 100, gr = D.g.createRadialGradient(D.d / 2, D.d / 2, rad * hard, D.d / 2, D.d / 2, rad), cs = col.map(Math.round).join(",");
      gr.addColorStop(0, "rgba(" + cs + ",1)"); gr.addColorStop(1, "rgba(" + cs + ",0)");
      D.g.fillStyle = hard >= 1 ? "rgb(" + cs + ")" : gr; D.g.beginPath(); D.g.arc(D.d / 2, D.d / 2, rad, 0, 7); D.g.fill();
      clipDab(D, x0, y0);
      lg.save(); lg.globalAlpha = clamp(PH.brush.op / 100 * left, 0, 1); lg.drawImage(D.c, x0, y0); lg.restore();
      left = Math.max(0.06, left * (1 - decay));
      if (L.mcv) L.dv = null;
    };
    phDrag(e, phStroke(e, stamp), function () { X.mix.res = res; L._touched = true; phMountLayers(); phInsp(); if (X.onChange) X.onChange("paint"); });
    return true;
  }
  var ART = { corto: [12, 0.45, 0.10, 0.35, 0], medio: [9, 0.8, 0.09, 0.5, 0], largo: [6, 1.5, 0.07, 0.8, 0], suelto: [7, 1.1, 0.08, 1.25, 0.9], remolino: [10, 0.9, 0.08, 0.6, 0], contorno: [8, 1.2, 0.06, 0.5, 0] };
  function artDown(e, p) {
    needCompose();
    if (p.u < 0 || p.u > 1 || p.v < 0 || p.v > 1) return true;
    var L = T.activePaint(); phSnapLayer(L);
    var W = L.cv.width, H = L.cv.height, sw = phView.width, sh = phView.height, sd = phView.getContext("2d").getImageData(0, 0, sw, sh).data;
    var snap = X.copyCv(L.cv), stroke = phCanvas(W, H), sg = stroke.getContext("2d"), lg = L.cv.getContext("2d"), st = ART[X.art.style] || ART.corto, rnd = PC.rand(Math.round(p.u * 1e6) ^ Math.round(p.v * 1e6) ^ 77), raf = 0, last = null;
    var lum = function (x, y) { var c = pixAt(sd, sw, sh, x, y); return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722; };
    var compose = function () { raf = 0; var s2 = X.sel && X.sel.has ? T.clipSel(X.copyCv(stroke)) : stroke; lg.save(); lg.setTransform(1, 0, 0, 1, 0, 0); lg.clearRect(0, 0, W, H); lg.drawImage(snap, 0, 0); lg.globalAlpha = PH.brush.op / 100; lg.drawImage(s2, 0, 0); lg.restore(); if (L.mcv) phMountLayers(); };
    var dab = function (u, v) {
      var size = PH.brush.size * T.kScale(), area = Math.max(size, X.art.area / 100 * size * 3), jit = (1 - X.art.fid / 100) * 70;
      for (var i = 0; i < st[0]; i++) {
        var a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * area * 0.5, x = u * W + Math.cos(a) * r, y = v * H + Math.sin(a) * r;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        var vx = x / W * sw, vy = y / H * sh, c = pixAt(sd, sw, sh, vx, vy), gx = lum(vx + 1, vy) - lum(vx - 1, vy), gy = lum(vx, vy + 1) - lum(vx, vy - 1), th;
        if (X.art.style === "remolino") th = Math.atan2(y - v * H, x - u * W) + Math.PI / 2;
        else th = (Math.abs(gx) + Math.abs(gy) > 6 ? Math.atan2(gy, gx) + Math.PI / 2 : a) + (rnd() - 0.5) * (st[4] || 0.35);
        if (X.art.style === "contorno") th = Math.atan2(gy, gx) + Math.PI / 2;
        var len = size * st[1] * (0.6 + rnd() * 0.8), bend = (rnd() - 0.5) * len * 0.5, col = [c[0] + (rnd() - 0.5) * jit, c[1] + (rnd() - 0.5) * jit, c[2] + (rnd() - 0.5) * jit].map(function (q) { return clamp(Math.round(q), 0, 255); });
        var ex = x + Math.cos(th) * len, ey = y + Math.sin(th) * len, mx = (x + ex) / 2 - Math.sin(th) * bend, my = (y + ey) / 2 + Math.cos(th) * bend;
        sg.strokeStyle = "rgba(" + col.join(",") + ",0.9)"; sg.lineWidth = Math.max(1, size * st[2]); sg.lineCap = "round";
        sg.beginPath(); sg.moveTo(x, y); sg.quadraticCurveTo(mx, my, ex, ey); sg.stroke();
      }
      if (!raf) raf = requestAnimationFrame(compose);
    };
    dab(p.u, p.v); last = p;
    phDrag(e, function (ev) { var q = phPt(ev), d = Math.hypot((q.u - last.u) * W, (q.v - last.v) * H); if (d < Math.max(3, PH.brush.size * T.kScale() * st[3])) return; last = q; dab(q.u, q.v); phMoveCursor(ev); }, function () { compose(); L._touched = true; phInsp(); if (X.onChange) X.onChange("paint"); });
    return true;
  }

  /* ═════════════ pluma de curvatura ═════════════ */
  function curvDown(e, p) {
    needCompose();
    if (!CV) CV = { pts: [], cur: null };
    var pt = [p.u, p.v], n2 = CV.pts.length;
    if (n2 > 2 && near(pt, CV.pts[0], 12)) { curvFinish(true); return true; }
    if (e.detail >= 2 && n2 >= 2) { if (near(pt, CV.pts[n2 - 1], 4)) CV.pts.pop(); curvFinish(false); return true; }
    CV.pts.push(pt); draw(); return true;
  }
  function curvFinish(closed) {
    var c = CV; CV = null; draw();
    if (!c || c.pts.length < 2) return;
    phSnap();
    phNewLayer("shape", { name: closed ? "Curva" : "Trazo curvo", shape: closed ? { type: "path", pts: c.pts, closed: true, smooth: true, fill: PH.front, stroke: "none", sw: 0, radius: 0 } : { type: "path", pts: c.pts, closed: false, smooth: true, fill: "none", stroke: PH.front, sw: Math.max(0.002, PH.brush.size / 8 / PH.base.w), radius: 0 } });
    phAll(); if (X.onChange) X.onChange("layer");
  }
  X.curvFinish = curvFinish;

  /* ═════════════ tampón de motivo ═════════════ */
  function tile(fn, s) { var c = phCanvas(s || 48, s || 48), g = c.getContext("2d"); fn(g, c.width, c.height); return c; }
  var PATS = {
    cuadros: ["Cuadros", function (g, w, h) { g.fillStyle = PH.back; g.fillRect(0, 0, w, h); g.fillStyle = PH.front; g.fillRect(0, 0, w / 2, h / 2); g.fillRect(w / 2, h / 2, w / 2, h / 2); }],
    rayas: ["Rayas", function (g, w, h) { g.fillStyle = PH.back; g.fillRect(0, 0, w, h); g.strokeStyle = PH.front; g.lineWidth = w / 5; for (var i = -1; i < 3; i++) { g.beginPath(); g.moveTo(i * w / 2, h); g.lineTo(i * w / 2 + w, 0); g.stroke(); } }],
    puntos: ["Puntos", function (g, w, h) { g.fillStyle = PH.back; g.fillRect(0, 0, w, h); g.fillStyle = PH.front; [[0.25, 0.25], [0.75, 0.75]].forEach(function (q) { g.beginPath(); g.arc(q[0] * w, q[1] * h, w * 0.14, 0, 7); g.fill(); }); }],
    trama: ["Trama", function (g, w, h) { g.fillStyle = PH.back; g.fillRect(0, 0, w, h); g.strokeStyle = PH.front; g.lineWidth = 2; for (var i = 0; i < 4; i++) { g.beginPath(); g.moveTo(i * w / 4, 0); g.lineTo(i * w / 4, h); g.moveTo(0, i * h / 4); g.lineTo(w, i * h / 4); g.stroke(); } }],
    ruido: ["Ruido", function (g, w, h) { var id = g.createImageData(w, h), r = PC.rand(5), a = PC.hex(PH.front), b = PC.hex(PH.back); for (var i = 0; i < id.data.length; i += 4) { var t = r(); id.data[i] = a[0] + (b[0] - a[0]) * t; id.data[i + 1] = a[1] + (b[1] - a[1]) * t; id.data[i + 2] = a[2] + (b[2] - a[2]) * t; id.data[i + 3] = 255; } g.putImageData(id, 0, 0); }],
  };
  X.userPats = [];
  try { (JSON.parse(localStorage.getItem("musa_ph_patterns") || "[]") || []).forEach(function (p) { var im = new Image(); im.onload = function () { X.userPats.push({ id: p.id, name: p.name, cv: X.toCanvas(im) }); }; im.src = p.data; }); } catch (e) { /* sin almacenamiento */ }
  function patTile() { var u = X.userPats.find(function (p) { return p.id === X.pat.id; }); if (u) return u.cv; var b = PATS[X.pat.id] || PATS.cuadros; return tile(b[1]); }
  function definePattern() {
    var sel = X.selGet(); if (!sel) return say("Selecciona la zona que será el motivo (marco, lazo…) y vuelve a pulsar");
    var sb = (function () { var c = sel, k = Math.min(1, 400 / Math.max(c.width, c.height)), w = Math.round(c.width * k), h = Math.round(c.height * k), t = phCanvas(w, h), g = t.getContext("2d"); g.drawImage(c, 0, 0, w, h); var d = g.getImageData(0, 0, w, h).data, x0 = w, y0 = h, x1 = -1, y1 = -1; for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return x1 < 0 ? null : { x: x0 / w, y: y0 / h, w: (x1 - x0 + 1) / w, h: (y1 - y0 + 1) / h }; })();
    if (!sb) return say("La selección está vacía");
    var C = T.compData(), x = Math.round(sb.x * C.w), y = Math.round(sb.y * C.h), w = Math.max(2, Math.round(sb.w * C.w)), h = Math.max(2, Math.round(sb.h * C.h)), k = Math.min(1, 256 / Math.max(w, h)), cv = phCanvas(w * k, h * k);
    cv.getContext("2d").drawImage(C.cv, x, y, w, h, 0, 0, cv.width, cv.height);
    var id = PC.uid("p"), name = "Motivo " + (X.userPats.length + 1); X.userPats.unshift({ id: id, name: name, cv: cv }); X.userPats = X.userPats.slice(0, 8); X.pat.id = id;
    try { localStorage.setItem("musa_ph_patterns", JSON.stringify(X.userPats.map(function (p) { return { id: p.id, name: p.name, data: p.cv.toDataURL("image/png") }; }))); } catch (e) { /* almacenamiento lleno o bloqueado: queda para esta sesión */ }
    phBar(); say("«" + name + "» guardado: elige el Tampón de motivo (S) y pinta");
  }
  X.definePattern = definePattern;
  function patternDown(e, p) {
    if (p.u < 0 || p.u > 1 || p.v < 0 || p.v > 1) return true;
    var L = T.retouchLayer(true); phSnapLayer(L);
    var W = L.cv.width, H = L.cv.height, lg = L.cv.getContext("2d"), tl = patTile(), sc = X.pat.scale / 100 * T.kScale(), ts = phCanvas(Math.max(1, tl.width * sc), Math.max(1, tl.height * sc)); ts.getContext("2d").drawImage(tl, 0, 0, ts.width, ts.height);
    var org = X.pat.aligned ? [0, 0] : [p.u * W, p.v * H], raf = 0;
    var stamp = function (u, v) {
      var rad = Math.max(1, PH.brush.size / 2 * T.kScale()), D = dabCanvas(rad), x0 = Math.round(u * W - D.d / 2), y0 = Math.round(v * H - D.d / 2);
      var pt = D.g.createPattern(ts, "repeat"); D.g.save(); D.g.translate(-(x0 - org[0]), -(y0 - org[1])); D.g.fillStyle = pt; D.g.fillRect(x0 - org[0], y0 - org[1], D.d, D.d); D.g.restore();
      var hard = clamp(PH.brush.hard / 100, 0, 0.98), gr = D.g.createRadialGradient(D.d / 2, D.d / 2, rad * hard, D.d / 2, D.d / 2, rad); gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      D.g.globalCompositeOperation = "destination-in"; D.g.fillStyle = gr; D.g.fillRect(0, 0, D.d, D.d); D.g.globalCompositeOperation = "source-over";
      clipDab(D, x0, y0);
      lg.save(); lg.globalAlpha = clamp(PH.brush.str / 100, 0.05, 1); lg.drawImage(D.c, x0, y0); lg.restore();
      if (!raf) raf = requestAnimationFrame(function () { raf = 0; X.touchPre(); });
    };
    phDrag(e, phStroke(e, stamp), function () { L._touched = true; X.touchPre(); phInsp(); if (X.onChange) X.onChange("paint"); });
    return true;
  }

  /* ═════════════ máscara de texto: una selección con forma de letras ═════════════ */
  function typeMaskDown(e, p) {
    if (p.u < -0.2 || p.u > 1.2 || p.v < -0.2 || p.v > 1.2) return true;
    var mode = T.selMode(e), fonts = typeof FONTS !== "undefined" ? Object.keys(FONTS) : ["Anton"], last = X.tmask || { s: "MUSA", font: fonts[0], size: 18, weight: 800 };
    var d = dlg('<form class="phx-card"><h3>Máscara de texto</h3><p>Las letras se vuelven una selección: después úsala con «Capa por copia» (la foto dentro de las letras), «Rellenar», «Máscara»…</p>'
      + '<label>Texto<textarea name="s" rows="2" style="min-height:64px;font:600 15px Inter,sans-serif;white-space:pre-wrap">' + esc(last.s) + '</textarea></label>'
      + '<div class="phx-row" style="justify-content:flex-start"><label>Fuente<select name="font">' + fonts.map(function (f) { return "<option" + (f === last.font ? " selected" : "") + ">" + esc(f) + "</option>"; }).join("") + '</select></label><label>Peso<select name="w">' + [400, 600, 700, 800, 900].map(function (w) { return "<option" + (w === last.weight ? " selected" : "") + ">" + w + "</option>"; }).join("") + '</select></label><label>Tamaño (% del alto)<input type="number" name="size" min="2" max="90" value="' + last.size + '"></label></div>'
      + '<div class="phx-row"><button type="button" data-x="cancel">Cancelar</button><button type="submit" class="pri">Crear la selección</button></div></form>', "Máscara de texto");
    d.el.querySelector("form").addEventListener("submit", function (ev) {
      ev.preventDefault(); var f = ev.target, t = { s: f.s.value || "MUSA", font: f.font.value, weight: +f.w.value, size: clamp(+f.size.value || 18, 2, 90) };
      X.tmask = t; d.close();
      var W = T.lw(), H = T.lh(), c = phCanvas(W, H); X.paintText(c.getContext("2d"), { s: t.s, x: p.u, y: p.v, size: t.size / 100, color: "#ffffff", font: t.font, weight: t.weight, align: "left", lh: 1.1 }, W, H);
      phSnap(); T.selDraw(mode, function (g, w, h) { g.drawImage(c, 0, 0, w, h); }); T.selChanged(); phBar();
      say("Selección con forma de «" + t.s.slice(0, 20) + "» · Ctrl+J la copia a una capa");
    });
    setTimeout(function () { var ta = d.el.querySelector("textarea"); ta.focus(); ta.select(); }, 30);
    return true;
  }

  /* ═════════════ despacho: las herramientas nuevas atienden antes que las demás ═════════════ */
  X.toolDown = function (e) {
    if (!PH.base) return false;
    var g = PH.tool, v = phVar(g), p = phPt(e);
    if (PH.mode === "persp") return PS ? perspDown(e, p) : false;
    if (g === "hand" && v === "rotate") return rotDown(e);
    if (phSpace || e.button === 1 || PH.mode === "crop" || PH.mode === "brush" || PH.wbPick) return false;
    if (e.target.closest && e.target.closest("[data-ch],[data-mh],[data-split]")) return false;
    if (g === "move" && v === "artboard") return boardDown(e, p);
    if (g === "lasso" && v === "magnetic") return magDown(e, p);
    if (g === "crop" && v === "slice") return sliceDown(e, p);
    if (g === "eyedropper" && v === "sampler") return samplerDown(e, p);
    if (g === "eyedropper" && v === "ruler") return rulerDown(e, p);
    if (g === "brush" && v === "mixer") return mixerDown(e, p);
    if (g === "history" && v === "arthistory") return artDown(e, p);
    if (g === "pen" && v === "curvature") return curvDown(e, p);
    if (g === "clone" && v === "pattern") return patternDown(e, p);
    if (g === "type" && v === "typemask") return typeMaskDown(e, p);
    return false;
  };
  var _pick = phPickTool;
  phPickTool = function (g, v) {
    if (MG) MG = null; if (CV && !(g === "pen" && (v || phVar("pen")) === "curvature")) CV = null;
    var cv = g === "crop" ? (v || phVar("crop")) : null;
    if (PH.mode === "persp" && cv !== "perspective") leavePersp();
    if (g === "crop" && cv === "perspective") { PH.vars.crop = "perspective"; return enterPersp(); }
    if (g === "crop" && cv === "slice") { PH.vars.crop = "slice"; PH.tool = "crop"; if (PH.mode === "crop" || PH.mode === "compose") _mode.call(null, "edit"); phAll(); say("Arrastra para dibujar cortes · «Cuadrícula» los reparte · «Exportar cortes» los descarga en un ZIP"); return; }
    var r = _pick.apply(this, arguments), nv = phVar(g);
    if ((g === "brush" && nv === "mixer") || (g === "history" && nv === "arthistory") || (g === "pen" && nv === "curvature")) needCompose();
    if (g === "eyedropper" && nv === "ruler" && !X.ruler) say("Arrastra sobre algo que deba quedar recto · «Enderezar con la regla» lo nivela");
    if (g === "hand" && nv === "rotate") say("Arrastra para girar la vista (Shift: de 15 en 15) · Esc la endereza · la foto no cambia");
    if (g === "move" && nv === "artboard") say("Arrastra los bordes del lienzo hacia afuera para agrandarlo o elige un tamaño arriba");
    if (g === "lasso" && nv === "magnetic") say("Clic en el borde para empezar y recórrelo con el mouse: el lazo se pega solo");
    draw(); infoSoon();
    return r;
  };
  var _rail = phRail;
  phRail = function () { var r = _rail.apply(this, arguments); var b = pq('#phRail [data-pt="crop"]'); if (b && (PH.mode === "persp" || (PH.tool === "crop" && phVar("crop") === "slice"))) b.classList.add("on"); if (b && PH.tool === "crop" && phVar("crop") === "slice") { pq("#phRail").querySelectorAll('.ed-tool.on:not([data-pt="crop"])').forEach(function (x) { x.classList.remove("on"); }); } return r; };
  var _cursor = phCursor;
  phCursor = function () { _cursor.apply(this, arguments); var g = PH.tool, v = phVar(g); if (PH.mode === "persp" || (g === "crop" && v === "slice") || (g === "eyedropper" && v !== "picker") || (g === "lasso" && v === "magnetic") || (g === "pen" && v === "curvature") || (g === "move" && v === "artboard") || (g === "type" && v === "typemask")) phStage.className = "ph-stage c-cross"; if (g === "hand" && v === "rotate") phStage.className = "ph-stage c-grab"; };

  /* ═════════════ barra de opciones ═════════════ */
  var _bar = phBar;
  phBar = function () {
    _bar.apply(this, arguments);
    var bar = pq("#phBar"), g = PH.tool, v = phVar(g), h = "";
    var sl = function (lbl, key, obj, min, max, unit) { return '<label class="ph-opt">' + lbl + ' <input type="range" class="ph-r" min="' + min + '" max="' + max + '" data-p2v="' + obj + "." + key + '" value="' + X[obj][key] + '"><output>' + X[obj][key] + (unit || "") + "</output></label>"; };
    if (PH.mode === "persp") {
      bar.innerHTML = '<div class="ph-seg">' + [["edit", "Editar"], ["crop", "Recortar"], ["compose", "Componer"]].map(function (m) { return '<button data-pmode="' + m[0] + '">' + m[1] + "</button>"; }).join("") + '</div><span class="ed-sep"></span><span class="ph-opt">Recorte en perspectiva: lleva las esquinas sobre algo que deba quedar recto</span><span class="ph-sp"></span>'
        + (PH.r.geo.persp ? '<button class="ph-b" data-p2="perspClear">Quitar la perspectiva</button>' : "") + '<button class="ph-b" data-p2="perspCancel">Cancelar</button><button class="ph-b pri" data-p2="perspApply" title="Enter">Aplicar perspectiva</button>';
      return;
    }
    if (PH.mode === "crop") return;
    if (g === "move" && v === "artboard") {
      var f = full(), bg = PH.r.geo.bg || (X.boardBg === "transparent" ? "" : X.boardBg);
      h += '<label class="ph-opt">Tamaño <select data-p2="preset">' + PRESETS.map(function (q) { return '<option value="' + q[0] + '">' + q[1] + "</option>"; }).join("") + "</select></label>"
        + '<label class="ph-opt">Ancho <input type="number" min="16" max="16000" data-p2n="bw" value="' + Math.round(f[0]) + '" style="width:74px"></label><label class="ph-opt">Alto <input type="number" min="16" max="16000" data-p2n="bh" value="' + Math.round(f[1]) + '" style="width:74px"></label><button class="ph-b" data-p2="boardSize">Aplicar</button>'
        + '<label class="ph-opt">Fondo <input type="color" data-p2="bg" value="' + (bg || "#ffffff") + '"></label><label class="ph-opt"><input type="checkbox" data-p2="bgT"' + (!PH.r.geo.bg && X.boardBg === "transparent" ? " checked" : "") + "> Transparente</label>"
        + '<button class="ph-b" data-p2="boardFit" title="El lienzo vuelve al borde de la foto">Ajustar a la foto</button>';
    }
    if (g === "crop" && v === "slice") h += '<span class="ph-opt">' + (S().slices || []).length + ' cortes</span><button class="ph-b" data-p2="grid">Cuadrícula…</button><button class="ph-b" data-p2="sliceDel"' + (SLC.sel ? "" : " disabled") + '>Quitar el corte</button><button class="ph-b" data-p2="sliceClear">Quitar todos</button><button class="ph-b pri" data-p2="sliceExport">Exportar cortes…</button>';
    if (g === "eyedropper" && v === "sampler") h += '<span class="ph-opt">Clic agrega una muestra (hasta 10) · arrastra para moverla · Alt+clic la quita</span>' + ((S().samplers || []).length ? '<button class="ph-b" data-p2="clearSamplers">Quitar muestras</button>' : "");
    if (g === "eyedropper" && v === "ruler") h += '<button class="ph-b pri" data-p2="rulerStraighten"' + (X.ruler && !PH.r.geo.persp ? "" : " disabled") + '>Enderezar con la regla</button><button class="ph-b" data-p2="rulerClear"' + (X.ruler ? "" : " disabled") + ">Borrar regla</button>";
    if (g === "brush" && v === "mixer" && PH.mode === "compose") h += sl("Humedad", "wet", "mix", 0, 100, "%") + sl("Carga", "load", "mix", 1, 100, "%") + sl("Mezcla", "mix", "mix", 0, 100, "%") + '<label class="ph-opt"><input type="checkbox" data-p2="clean"' + (X.mix.clean ? " checked" : "") + "> Limpiar tras cada trazo</label>";
    if (g === "history" && v === "arthistory") h += (PH.mode === "compose" ? '<label class="ph-opt">Tamaño <input type="range" class="ph-r" min="2" max="300" data-pb="size" value="' + PH.brush.size + '"><output>' + PH.brush.size + '</output></label><label class="ph-opt">Opacidad <input type="range" class="ph-r" min="1" max="100" data-pb="op" value="' + PH.brush.op + '"><output>' + PH.brush.op + "%</output></label>" : "")
      + '<label class="ph-opt">Estilo <select data-p2="artStyle">' + [["corto", "Apretado corto"], ["medio", "Apretado medio"], ["largo", "Apretado largo"], ["suelto", "Suelto"], ["remolino", "Remolino"], ["contorno", "Contorno"]].map(function (q) { return '<option value="' + q[0] + '"' + (X.art.style === q[0] ? " selected" : "") + ">" + q[1] + "</option>"; }).join("") + "</select></label>" + sl("Área", "area", "art", 10, 100, "%") + sl("Fidelidad", "fid", "art", 0, 100, "%");
    if (g === "pen" && v === "curvature") h += '<label class="ph-opt">Color <input type="color" data-pfront value="' + PH.front + '"></label><span class="ph-opt">Cada clic suma un punto y la curva pasa suave por todos · clic en el primero cierra la forma · doble clic o Enter deja una línea abierta</span>';
    if (g === "clone" && v === "pattern") {
      var opts = X.userPats.map(function (q) { return [q.id, q.name]; }).concat(Object.keys(PATS).map(function (k) { return [k, PATS[k][0]]; }));
      h += '<label class="ph-opt">Motivo <select data-p2="pat">' + opts.map(function (q) { return '<option value="' + q[0] + '"' + (X.pat.id === q[0] ? " selected" : "") + ">" + esc(q[1]) + "</option>"; }).join("") + "</select></label>" + sl("Escala", "scale", "pat", 10, 400, "%")
        + '<label class="ph-opt"><input type="checkbox" data-p2="aligned"' + (X.pat.aligned ? " checked" : "") + '> Alineado</label><button class="ph-b" data-p2="definePattern" title="La zona seleccionada se vuelve un motivo">Definir motivo…</button>';
    }
    if (g === "hand" && v === "rotate") h += '<label class="ph-opt">Ángulo <input type="number" min="-180" max="180" step="1" data-p2n="rot" value="' + Math.round(PH.viewRot || 0) + '" style="width:64px">°</label><button class="ph-b" data-p2="rotReset"' + (PH.viewRot ? "" : " disabled") + ">Enderezar la vista</button>";
    if (g === "lasso" && v === "magnetic" && MG) h += '<button class="ph-b" data-p2="magClose">Cerrar el lazo</button>';
    if (g === "type" && v === "typemask") h += '<span class="ph-opt">Clic donde empieza el texto · Shift suma, Alt resta a la selección</span>';
    if (!h) return;
    var box = document.createElement("span"); box.style.display = "contents"; box.innerHTML = h;
    var sp = bar.querySelector(".ph-sp"); if (sp) bar.insertBefore(box, sp); else bar.appendChild(box);
  };
  function act2(a, el) {
    if (a === "perspApply") return perspApply();
    if (a === "perspCancel") { leavePersp(); return phAll(); }
    if (a === "perspClear") return perspClear();
    if (a === "boardSize") { var bw = +pq('[data-p2n="bw"]').value, bh = +pq('[data-p2n="bh"]').value; if (bw >= 16 && bh >= 16) boardSize(bw, bh); return; }
    if (a === "boardFit") return boardFit();
    if (a === "grid") return gridDialog();
    if (a === "sliceDel") { phSnap(); S().slices = (S().slices || []).filter(function (s) { return s.id !== SLC.sel; }); SLC.sel = null; draw(); return phBar(); }
    if (a === "sliceClear") { if (!(S().slices || []).length) return; phSnap(); S().slices = []; SLC.sel = null; draw(); return phBar(); }
    if (a === "sliceExport") return exportSlices();
    if (a === "clearSamplers") { phSnap(); S().samplers = []; draw(); infoSoon(); return phBar(); }
    if (a === "rulerStraighten") return rulerStraighten();
    if (a === "rulerClear") { X.ruler = null; draw(); infoSoon(); return phBar(); }
    if (a === "definePattern") return definePattern();
    if (a === "rotReset") { setViewRot(0); return phBar(); }
    if (a === "magClose") return magClose();
    void el;
  }
  X.act2 = act2;
  var bar = pq("#phBar");
  bar.addEventListener("click", function (e) { var b = e.target.closest("[data-p2]"); if (b && b.tagName === "BUTTON") act2(b.dataset.p2, b); });
  bar.addEventListener("input", function (e) {
    var t = e.target;
    if (t.dataset.p2v) { var k = t.dataset.p2v.split("."); X[k[0]][k[1]] = +t.value; t.nextElementSibling.textContent = t.value + (/%/.test(t.nextElementSibling.textContent) ? "%" : ""); return; }
    if (t.dataset.p2n === "rot") { setViewRot(+t.value || 0); }
  });
  bar.addEventListener("change", function (e) {
    var t = e.target, k = t.dataset.p2;
    if (k === "preset" && t.value !== "libre") return boardPreset(+t.value);
    if (k === "bg") { X.boardBg = t.value; var c = PH.r.geo.crop; if (c.x < 0 || c.y < 0 || c.x + c.w > 1 || c.y + c.h > 1) { phSnap(); PH.r.geo.bg = t.value; PH.base = null; PH.bkey = ""; phAll(); } return; }
    if (k === "bgT") { X.boardBg = t.checked ? "transparent" : (pq('[data-p2="bg"]').value || "#ffffff"); phSnap(); if (t.checked) delete PH.r.geo.bg; else { var c2 = PH.r.geo.crop; if (c2.x < 0 || c2.y < 0 || c2.x + c2.w > 1 || c2.y + c2.h > 1) PH.r.geo.bg = X.boardBg; } PH.base = null; PH.bkey = ""; return phAll(); }
    if (k === "clean") { X.mix.clean = t.checked; return; }
    if (k === "artStyle") { X.art.style = t.value; return; }
    if (k === "pat") { X.pat.id = t.value; return; }
    if (k === "aligned") { X.pat.aligned = t.checked; return; }
  });

  /* ═════════════ teclado (antes que el resto: fase de captura en window) ═════════════ */
  window.addEventListener("keydown", function (e) {
    if (!PH.open || document.querySelector(".phx-dlg,.mdlg")) return;
    if (e.target.closest && e.target.closest("input:not([type=range]),textarea,select,[contenteditable=true]")) return;
    var k = e.key, hit = true, g = PH.tool, v = phVar(g);
    if (PH.mode === "persp" && k === "Enter") perspApply();
    else if (PH.mode === "persp" && k === "Escape") { leavePersp(); phAll(); }
    else if (MG && k === "Enter") magClose();
    else if (MG && k === "Escape") { MG = null; draw(); phBar(); }
    else if (MG && k === "Backspace") { if (MG.anchors.length > 1) { MG.anchors.pop(); var a = MG.anchors[MG.anchors.length - 1], idx = -1; for (var i = MG.path.length - 1; i >= 0; i--) if (MG.path[i][0] === a[0] && MG.path[i][1] === a[1]) { idx = i; break; } if (idx >= 0) MG.path = MG.path.slice(0, idx + 1); MG.live = null; draw(); } else { MG = null; draw(); } }
    else if (CV && k === "Enter") curvFinish(CV.pts.length > 2 && e.shiftKey);
    else if (CV && k === "Escape") { CV = null; draw(); }
    else if (CV && k === "Backspace") { CV.pts.pop(); if (!CV.pts.length) CV = null; draw(); }
    else if (g === "crop" && v === "slice" && SLC.sel && (k === "Delete" || k === "Backspace")) act2("sliceDel");
    else if (g === "hand" && v === "rotate" && k === "Escape" && PH.viewRot) { setViewRot(0); phBar(); }
    else if (g === "eyedropper" && v === "ruler" && k === "Escape" && X.ruler) act2("rulerClear");
    else if (PH.viewRot && k === "Escape" && !document.querySelector("#phMenu:not([hidden])") && !(X.sel && X.sel.has) && PH.mode === "edit") { setViewRot(0); phBar(); }
    else hit = false;
    if (hit) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  /* ═════════════ menús ═════════════ */
  var _vista = PH_MENUS.vista;
  PH_MENUS.vista = function () {
    return _vista().concat(["-", { h: "Rotar la vista (la foto no cambia)" }, { l: "Girar la vista 90° a la derecha", fn: function () { setViewRot((PH.viewRot || 0) + 90); } }, { l: "Girar la vista 90° a la izquierda", fn: function () { setViewRot((PH.viewRot || 0) - 90); } }, { l: "Enderezar la vista", on: !PH.viewRot, fn: function () { setViewRot(0); } }]);
  };
  var _sel = PH_MENUS.seleccion;
  if (_sel) PH_MENUS.seleccion = function () { return _sel().concat(["-", { l: "Definir motivo desde la selección", d: "Para el Tampón de motivo", fn: definePattern }]); };
  var _exp = PH_MENUS.exportar;
  PH_MENUS.exportar = function () { var it = _exp().slice(), i = it.findIndex(function (x) { return x && x.h === "Código"; }); it.splice(i < 0 ? it.length : i - 1, 0, { l: "Exportar cortes…", d: (S().slices || []).length ? (S().slices || []).length + " cortes en un ZIP" : "Primero dibuja cortes con Segmentar", fn: exportSlices }); return it; };
  var _at = PH_MENUS.atajos;
  PH_MENUS.atajos = function () { return _at().concat([["Aplicar la perspectiva / cancelar", "Enter / Esc"], ["Lazo magnético: borrar el último punto", "Retroceso"], ["Pluma de curvatura: cerrar / dejar abierta", "clic en el primer punto / Enter"], ["Regla y rotar vista: Shift", "ángulos de 45° y 15°"], ["Enderezar la vista", "Esc"]].map(function (x) { return { l: x[0], k: x[1], fn: function () {} }; })); };

  /* ═════════════ al abrir otra foto o cerrar ═════════════ */
  var _onLoad = X.onLoad; X.onLoad = function () { PS = null; MG = null; CV = null; BD = null; SLC.sel = null; X.ruler = null; setViewRot(0); if (PH.mode === "persp") PH.mode = "edit"; if (_onLoad) _onLoad(); draw(); infoSoon(); };
  var _onClose = X.onClose; X.onClose = function () { setViewRot(0); PS = null; MG = null; CV = null; info.hidden = true; if (_onClose) _onClose(); };
  if (PH.open) phAll();
})();
