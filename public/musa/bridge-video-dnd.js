/* bridge-video-dnd.js — el editor de video como un editor profesional: todo con arrastrar y soltar.
 *
 * Lienzo: arrastrar un texto o una media lo mueve (con guías al centro, a los bordes y a los otros clips; Shift =
 * un solo eje, Alt = sin imán), las esquinas escalan, el tirador de arriba gira (keyframe en el playhead) y doble clic
 * en un texto lo edita ahí mismo.
 * Biblioteca y escritorio: cualquier elemento de la biblioteca se arrastra al lienzo (queda donde lo sueltas) o al
 * timeline (entra en ese instante); archivos del escritorio (imagen, video, audio, SVG) se suben y entran igual, y un
 * archivo de código (.html, .tsx, .jsx, .json) se vuelve clips.
 * Timeline: Shift/Ctrl+clic suma clips a la selección, Shift+arrastrar en vacío selecciona con recuadro, se mueven
 * juntos, Ctrl+C / Ctrl+X / Ctrl+V (también entre proyectos), Supr borra todos, Shift+Supr borra y cierra el hueco,
 * Alt+← → empuja un cuadro (Shift: 10), J/K/L, Ctrl+A, ◆ keyframes arrastrables, fundidos de audio con tiradores,
 * pistas con ocultar / bloquear / silenciar, menú con clic derecho y «?» con todos los atajos.
 */
(function () {
  "use strict";
  if (typeof VE === "undefined" || !window.__vePro) return;
  var P = window.__vePro;
  function RB() { return window.__musaReal || {}; }
  var r1 = function (v) { return Math.round(v * 100) / 100; }, cl = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function toast(m) { if (typeof vtoast === "function") vtoast(m); }
  function WH() { var f = VFMT[(VE.p && VE.p.fmt) || "9:16"] || VFMT["9:16"]; return [f[0], f[1]]; }
  function typing(e) { var t = e && e.target; return !!(t && t.closest && t.closest("input,textarea,select,[contenteditable=true]")); }
  function lanes() { var p = VE.p; if (!p) return {}; p.lanes = p.lanes || {}; return p.lanes; }
  function laneFlag(k, f) { var l = VE.p && VE.p.lanes; return !!(l && l[k] && l[k][f]); }
  function arrOf(tr) { return tr === "v1" || tr === "x" ? VE.p.v1 : VE.p[tr]; }

  var css = document.createElement("style");
  css.textContent = [
    "#veStageW .vd-box{position:absolute;pointer-events:none;border:1.5px solid #ff5e00;box-sizing:border-box;z-index:30}",
    "#veStageW .vd-h{position:absolute;width:12px;height:12px;background:#fff;border:2px solid #ff5e00;border-radius:3px;pointer-events:auto;box-sizing:border-box;touch-action:none}",
    "#veStageW .vd-h[data-vdh=nw]{left:-7px;top:-7px;cursor:nwse-resize}#veStageW .vd-h[data-vdh=ne]{right:-7px;top:-7px;cursor:nesw-resize}#veStageW .vd-h[data-vdh=sw]{left:-7px;bottom:-7px;cursor:nesw-resize}#veStageW .vd-h[data-vdh=se]{right:-7px;bottom:-7px;cursor:nwse-resize}",
    "#veStageW .vd-h[data-vdh=rot]{left:50%;top:-30px;margin-left:-7px;border-radius:50%;cursor:grab}",
    "#veStageW .vd-box:after{content:'';position:absolute;left:50%;top:-18px;height:11px;border-left:1.5px solid #ff5e00}",
    "#veStageW .vd-guide{position:absolute;background:#ff2bd6;z-index:31;pointer-events:none}",
    "#veStageW .vd-ed{position:absolute;z-index:40;background:rgba(0,0,0,.25);border:1.5px dashed #ff5e00;color:#fff;text-align:center;resize:none;outline:none;padding:0;margin:0;overflow:hidden;line-height:1.1;white-space:pre}",
    ".vd-drop{outline:2px dashed #ff5e00!important;outline-offset:-4px}",
    "#veLanes .ve-clip.vd-msel{box-shadow:0 0 0 2px #ff5e00 inset,0 0 0 1px #ff5e00}",
    "#veLanes .vd-kd{position:absolute;top:50%;width:9px;height:9px;margin:-5px 0 0 -5px;background:#ffd400;border:1.5px solid #141412;transform:rotate(45deg);z-index:3;cursor:ew-resize;touch-action:none}",
    "#veLanes .vd-kd:hover{background:#fff}",
    "#veLanes .vd-fade{position:absolute;top:0;width:10px;height:10px;background:#fff;border:1.5px solid #141412;border-radius:50%;z-index:3;cursor:ew-resize;margin-left:-5px;touch-action:none}",
    "#veLanes .vd-ramp{position:absolute;top:0;bottom:0;pointer-events:none;z-index:2}",
    "#veLanes .vd-marq{position:absolute;border:1px solid #ff5e00;background:rgba(255,94,0,.12);z-index:20;pointer-events:none}",
    "#veLanes .vd-dropline{position:absolute;top:0;bottom:0;width:2px;background:#ff5e00;z-index:25;pointer-events:none}",
    "#veHeads .vd-lc{display:inline-flex;gap:2px;margin-left:4px;vertical-align:middle}",
    "#veHeads .vd-lc button{width:20px;height:18px;padding:0;border:0;border-radius:4px;background:transparent;color:#8d8a80;cursor:pointer;font:600 11px Inter,sans-serif;line-height:18px}",
    "#veHeads .vd-lc button[aria-pressed=true]{background:#ff5e00;color:#141412}",
    "#veHeads .vd-lc button:hover{color:#fff}",
    ".vd-menu{position:fixed;z-index:9999;background:#1d1d1a;border:1px solid #34342f;border-radius:10px;padding:5px;min-width:230px;box-shadow:0 14px 40px rgba(0,0,0,.5);font:13px Inter,system-ui,sans-serif}",
    ".vd-menu button{display:flex;justify-content:space-between;gap:18px;width:100%;background:transparent;border:0;color:#e8e6df;padding:7px 10px;border-radius:7px;cursor:pointer;text-align:left;font:inherit}",
    ".vd-menu button:hover,.vd-menu button:focus{background:#ff5e00;color:#141412;outline:none}.vd-menu button small{color:#8d8a80}.vd-menu button:hover small{color:#141412}",
    ".vd-menu hr{border:0;border-top:1px solid #34342f;margin:4px 6px}",
    ".vd-keys{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:grid;place-items:center;padding:16px}",
    ".vd-keys .bx{background:#fff;color:#1d1d1b;border-radius:14px;max-width:720px;width:100%;max-height:88vh;overflow:auto;padding:18px 20px;font:14px Inter,system-ui,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.4)}",
    ".vd-keys h3{margin:0 0 10px}.vd-keys table{width:100%;border-collapse:collapse}.vd-keys td{padding:5px 6px;border-top:1px solid #eee;vertical-align:top}.vd-keys kbd{background:#f2f0ea;border:1px solid #d9d6cc;border-radius:5px;padding:1px 6px;font:600 12px 'JetBrains Mono',monospace;white-space:nowrap}",
    ".vd-keys .row{text-align:right;margin-top:12px}.vd-keys button{border:0;background:#ff5e00;color:#fff;border-radius:9px;padding:8px 16px;font:600 13px Inter,sans-serif;cursor:pointer}",
  ].join("\n");
  document.head.appendChild(css);

  /* ═════════════ lienzo: mover, escalar, girar y escribir en el lugar ═════════════ */
  function stageW() { return vq("#veStageW"); }
  function scaleNow() { var w = stageW(); return w ? w.getBoundingClientRect().width / WH()[0] : 1; }
  function selClip() { var s = VE.sel; if (!s || (s.tr !== "t" && s.tr !== "m") || !VE.p) return null; var c = VE.p[s.tr][s.i]; return c ? { tr: s.tr, i: s.i, c: c } : null; }
  function clipNode(tr, i) { var w = stageW(); return w ? w.querySelector("[data-" + (tr === "t" ? "ti" : "mi") + '="' + i + '"]') : null; }
  function drawHandles() {
    var w = stageW(); if (!w) return;
    var old = w.querySelector(".vd-box"); if (old) old.remove();
    var s = selClip(); if (!s || laneFlag(s.tr, "lock") || laneFlag(s.tr, "hide")) return;
    if (VE.t < s.c.start || VE.t >= s.c.start + s.c.dur || s.c.adj) return;
    var el = clipNode(s.tr, s.i); if (!el) return;
    var R = w.getBoundingClientRect(), r = el.getBoundingClientRect();
    var bx = document.createElement("div"); bx.className = "vd-box";
    bx.style.cssText = "left:" + (r.left - R.left) + "px;top:" + (r.top - R.top) + "px;width:" + r.width + "px;height:" + r.height + "px";
    bx.innerHTML = '<i class="vd-h" data-vdh="nw" title="Escalar"></i><i class="vd-h" data-vdh="ne" title="Escalar"></i><i class="vd-h" data-vdh="sw" title="Escalar"></i><i class="vd-h" data-vdh="se" title="Escalar"></i><i class="vd-h" data-vdh="rot" title="Girar (crea un keyframe en el playhead)"></i>';
    w.appendChild(bx);
  }
  var _stage = veStage;
  veStage = function () { var r = _stage.apply(this, arguments); try { drawHandles(); } catch (e) { /* sin lienzo */ } return r; };
  function guides(list) {
    var w = stageW(); if (!w) return;
    w.querySelectorAll(".vd-guide").forEach(function (g) { g.remove(); });
    var s = scaleNow();
    (list || []).forEach(function (g) { var d = document.createElement("i"); d.className = "vd-guide"; d.style.cssText = g.v ? "left:" + (g.at * s) + "px;top:0;bottom:0;width:1px" : "top:" + (g.at * s) + "px;left:0;right:0;height:1px"; w.appendChild(d); });
  }
  function vdrag(e, move, up) {
    var x0 = e.clientX, y0 = e.clientY, lx = x0, ly = y0;
    var mm = function (ev) { lx = ev.clientX; ly = ev.clientY; move(ev, ev.clientX - x0, ev.clientY - y0); };
    /* vale el lugar donde se soltó: si el último movimiento no llegó (o llegó agrupado), el clip quedaba a mitad de camino o sin moverse */
    var uu = function (ev) { removeEventListener("pointermove", mm); removeEventListener("pointerup", uu); removeEventListener("pointercancel", uu); if (ev.type === "pointerup" && typeof ev.clientX === "number" && (ev.clientX !== lx || ev.clientY !== ly)) move(ev, ev.clientX - x0, ev.clientY - y0); if (up) up(ev, ev.clientX - x0, ev.clientY - y0); };
    addEventListener("pointermove", mm); addEventListener("pointerup", uu); addEventListener("pointercancel", uu);
  }
  /* imanes: centro del lienzo, bordes (media) y centros de los demás clips visibles */
  function snapPos(c, tr, cx, cy, alt) {
    var wh = WH(), W = wh[0], H = wh[1], s = scaleNow(), th = 7 / s, gx = [], gy = [], out = { x: cx, y: cy, g: [] };
    if (alt) return out;
    gx.push(W / 2); gy.push(H / 2);
    var hw = tr === "m" ? W * (c.w || 40) / 200 : 0, hh = tr === "m" ? hw / (c.ar || 1) : 0;
    ["m", "t"].forEach(function (k) { (VE.p[k] || []).forEach(function (o) { if (o === c || VE.t < o.start || VE.t >= o.start + o.dur || o.adj) return; gx.push(W * o.x / 100); gy.push(H * o.y / 100); }); });
    var best = function (v, list, off) { var b = null; list.forEach(function (g) { [0, -off, off].forEach(function (d) { var dd = Math.abs(v + d - g); if (dd < th && (!b || dd < b.d)) b = { d: dd, at: g, v: g - d }; }); }); return b; };
    var bxs = best(cx, gx.concat(tr === "m" ? [0, W] : []), hw), bys = best(cy, gy.concat(tr === "m" ? [0, H] : []), hh);
    if (bxs) { out.x = bxs.v; out.g.push({ v: true, at: bxs.at }); }
    if (bys) { out.y = bys.v; out.g.push({ v: false, at: bys.at }); }
    return out;
  }
  var LASTDOWN = null;
  document.addEventListener("pointerdown", function (e) {
    if (!VE.open || !VE.p || e.button !== 0) return;
    var w = stageW(); if (!w || !w.contains(e.target)) return;
    var h = e.target.closest && e.target.closest("[data-vdh]");
    var s = selClip();
    if (h && s) { e.preventDefault(); e.stopPropagation(); return handleDrag(e, s, h.dataset.vdh); }
    var node = e.target.closest && e.target.closest("[data-ti],[data-mi]");
    if (!node) return;
    var tr = node.hasAttribute("data-ti") ? "t" : "m", i = +(node.dataset.ti != null ? node.dataset.ti : node.dataset.mi);
    var c = VE.p[tr] && VE.p[tr][i]; if (!c || c.adj) return;
    /* doble clic en un texto (el primer clic redibuja el video, así que se mide aquí y no con «dblclick») */
    var now = Date.now(), L0 = LASTDOWN; LASTDOWN = { tr: tr, i: i, t: now, x: e.clientX, y: e.clientY };
    /* segundo clic seguido sobre el mismo texto: si se suelta sin mover es doble clic (editar el texto); si se mueve es
       un arrastre. Antes un clic y enseguida arrastrar abría la edición en vez de mover el texto. */
    var dbl = tr === "t" && L0 && L0.tr === "t" && L0.i === i && now - L0.t < 450 && Math.hypot(e.clientX - L0.x, e.clientY - L0.y) < 8;
    if (dbl) LASTDOWN = null;
    if (laneFlag(tr, "lock")) { e.preventDefault(); e.stopPropagation(); toast("La pista " + (tr === "t" ? "de textos" : "de media") + " está bloqueada"); return; }
    if (tr === "m" && (c.w || 40) >= 95 && !(VE.sel && VE.sel.tr === "m" && VE.sel.i === i)) return;
    var wh = WH(), W = wh[0], H = wh[1], x0 = c.x, y0 = c.y, moved = false, sc = scaleNow();
    vdrag(e, function (ev, dx, dy) {
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved) { vsnap(); moved = true; if (!(VE.sel && VE.sel.tr === tr && VE.sel.i === i)) veSelect({ tr: tr, i: i }); }
      if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      var cx = W * x0 / 100 + dx / sc, cy = H * y0 / 100 + dy / sc, sn = snapPos(c, tr, cx, cy, ev.altKey);
      c.x = r1(sn.x / W * 100); c.y = r1(sn.y / H * 100);
      veStage(); guides(sn.g);
    }, function () { guides([]); if (moved) { veInsp(); if (typeof veTimeline === "function") veTimeline(); } else if (dbl && !laneFlag(tr, "lock")) setTimeout(function () { editInPlace(i); }, 0); });
  }, true);
  function handleDrag(e, s, kind) {
    var c = s.c, el = clipNode(s.tr, s.i); if (!el) return;
    var r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, d0 = Math.hypot(e.clientX - cx, e.clientY - cy) || 1, a0 = Math.atan2(e.clientY - cy, e.clientX - cx);
    var w0 = +c.w || 40, z0 = +c.size || 64, moved = false, lt = cl(VE.t - c.start, 0, c.dur), rot0 = (P.sampleK(c, lt).r || 0);
    vdrag(e, function (ev) {
      if (!moved) { vsnap(); moved = true; }
      if (kind === "rot") {
        var a = Math.atan2(ev.clientY - cy, ev.clientX - cx), deg = (a - a0) * 180 / Math.PI, rr = rot0 + deg;
        if (ev.shiftKey) rr = Math.round(rr / 15) * 15;
        c.kf = c.kf || [];
        var k = c.kf.find(function (x) { return Math.abs(x.t - lt) < 0.02; });
        if (!k) { k = Object.assign({}, P.sampleK(c, lt), { t: r1(lt) }); c.kf.push(k); c.kf.sort(function (a1, b1) { return a1.t - b1.t; }); }
        k.r = r1(rr);
      } else {
        var f = Math.hypot(ev.clientX - cx, ev.clientY - cy) / d0;
        if (s.tr === "m") c.w = r1(cl(w0 * f, 0.5, 400)); else { c.size = Math.round(cl(z0 * f, 6, 900)); c.exact = true; }
      }
      veStage();
    }, function () { if (moved) { veInsp(); if (typeof veTimeline === "function") veTimeline(); } });
  }
  /* doble clic en un texto: se escribe ahí mismo (el campo vive fuera del video, que se redibuja a cada rato) */
  document.addEventListener("dblclick", function (e) {
    if (!VE.open || !VE.p || document.querySelector(".vd-ed")) return;
    var w = stageW(); if (!w || !w.contains(e.target)) return;
    var node = e.target.closest && e.target.closest("[data-ti]"); if (!node) return;
    e.preventDefault(); e.stopPropagation(); editInPlace(+node.dataset.ti);
  }, true);
  function editInPlace(i) {
    var c = VE.p && VE.p.t[i]; if (!c || laneFlag("t", "lock") || document.querySelector(".vd-ed")) return;
    if (!(VE.sel && VE.sel.tr === "t" && VE.sel.i === i)) veSelect({ tr: "t", i: i });
    var node = clipNode("t", i); if (!node) return;
    var r = node.getBoundingClientRect(), cs = getComputedStyle(node), sc = scaleNow();
    var ed = document.createElement("textarea"); ed.className = "vd-ed"; ed.value = c.text || ""; ed.setAttribute("aria-label", "Texto del clip");
    ed.style.cssText = "position:fixed;z-index:9000;left:" + r.left + "px;top:" + r.top + "px;width:" + Math.max(80, r.width + 20) + "px;height:" + Math.max(30, r.height + 8) + "px;font-family:" + cs.fontFamily + ";font-weight:" + cs.fontWeight + ";font-size:" + parseFloat(cs.fontSize) * sc + "px;color:" + cs.color + ";background:rgba(0,0,0,.35);border:1.5px dashed #ff5e00;text-align:center;resize:none;outline:none;padding:0;margin:0;overflow:hidden;line-height:1.1;white-space:pre";
    document.body.appendChild(ed); ed.focus(); ed.select();
    var done = false, fin = function (ok) { if (done) return; done = true; var v = ed.value; ed.remove(); if (ok && v !== c.text) { vsnap(); c.text = v; veStage(); veInsp(); if (typeof veTimeline === "function") veTimeline(); toast("Texto actualizado"); } };
    ed.addEventListener("keydown", function (ev) { ev.stopPropagation(); if (ev.key === "Escape") { ev.preventDefault(); fin(false); } else if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); fin(true); } });
    ed.addEventListener("blur", function () { fin(true); });
  }

  /* ═════════════ arrastrar desde la biblioteca y desde el escritorio ═════════════ */
  var DRAG = null;
  var _bin = veBin;
  veBin = function () {
    var r = _bin.apply(this, arguments), box = vq("#veBin");
    if (box) box.querySelectorAll(".ve-item").forEach(function (b) { if (!b.draggable) { b.draggable = true; b.title = b.title || "Arrástralo al video o al timeline (o haz clic: entra en el playhead)"; } });
    return r;
  };
  function keyOf(b) { return [].slice.call(b.attributes).filter(function (a) { return /^data-/.test(a.name); }).map(function (a) { return "[" + a.name + '="' + (window.CSS && CSS.escape ? CSS.escape(a.value) : a.value.replace(/"/g, '\\"')) + '"]'; }).join(""); }
  document.addEventListener("dragstart", function (e) {
    var b = e.target.closest && e.target.closest("#veBin .ve-item"); if (!b) return;
    DRAG = { key: keyOf(b), el: b };
    try { e.dataTransfer.setData("text/x-musa-bin", "1"); e.dataTransfer.effectAllowed = "copy"; } catch (er) { /* Safari viejo */ }
  });
  document.addEventListener("dragend", function () { DRAG = null; clearDrop(); });
  function overZone(e) {
    var w = stageW(), l = vq("#veLanes");
    if (w && w.contains(e.target)) return "stage";
    if (l && l.contains(e.target)) return "lanes";
    var ve = vq("#veBox") || document.querySelector("#ve");
    return ve && ve.contains(e.target) ? "stage" : null;
  }
  function clearDrop() { document.querySelectorAll(".vd-drop").forEach(function (x) { x.classList.remove("vd-drop"); }); var dl = document.querySelector("#veLanes .vd-dropline"); if (dl) dl.remove(); }
  function laneTime(e) { var inner = vq("#veLanes .ve-inner"); if (!inner) return VE.t; var r = inner.getBoundingClientRect(); return Math.max(0, (e.clientX - r.left) / VE.pps); }
  function stagePct(e) { var w = stageW(); if (!w) return null; var r = w.getBoundingClientRect(); return { x: r1(cl((e.clientX - r.left) / r.width * 100, 0, 100)), y: r1(cl((e.clientY - r.top) / r.height * 100, 0, 100)) }; }
  function isFiles(e) { var t = e.dataTransfer && e.dataTransfer.types; return !!(t && [].indexOf.call(t, "Files") >= 0); }
  document.addEventListener("dragover", function (e) {
    if (!VE.open || !VE.p) return;
    if (!DRAG && !isFiles(e)) return;
    var z = overZone(e); if (!z) return;
    e.preventDefault(); try { e.dataTransfer.dropEffect = "copy"; } catch (er) { /* */ }
    clearDrop();
    if (z === "stage") { var w = stageW(); if (w) w.classList.add("vd-drop"); }
    else { var inner = vq("#veLanes .ve-inner"); if (inner) { var dl = document.createElement("i"); dl.className = "vd-dropline"; dl.style.left = laneTime(e) * VE.pps + "px"; inner.appendChild(dl); } }
  });
  document.addEventListener("dragleave", function (e) { if (!e.relatedTarget) clearDrop(); });
  function snapshotIds() { var o = {}; ["v1", "m", "t", "a"].forEach(function (k) { (VE.p[k] || []).forEach(function (c) { o[c.id] = 1; }); }); return o; }
  function whenNew(before, ms, fn) {
    var t0 = Date.now();
    (function look() {
      if (!VE.p) return;
      var found = null; ["m", "t"].some(function (k) { var c = (VE.p[k] || []).find(function (x) { return !before[x.id]; }); if (c) { found = { k: k, c: c }; return true; } return false; });
      if (found) return fn(found);
      if (Date.now() - t0 < ms) setTimeout(look, 150);
    })();
  }
  document.addEventListener("drop", function (e) {
    if (!VE.open || !VE.p) return;
    var z = overZone(e); if (!z || (!DRAG && !isFiles(e))) return;
    e.preventDefault(); e.stopPropagation(); clearDrop();
    var at = z === "lanes" ? laneTime(e) : null, pos = z === "stage" ? stagePct(e) : null, before = snapshotIds();
    if (at != null) { veStop(); veSeek(at); }
    var place = function (ms) { if (pos) whenNew(before, ms, function (f) { f.c.x = pos.x; f.c.y = pos.y; veStage(); veInsp(); }); };
    if (DRAG) {
      var b = vq("#veBin " + DRAG.key) || (DRAG.el.isConnected ? DRAG.el : null); DRAG = null;
      if (!b) return toast("No encontré ese elemento en la biblioteca: vuelve a intentarlo");
      b.click(); place(4000); return;
    }
    var files = [].slice.call(e.dataTransfer.files || []);
    files.forEach(function (f, k) {
      var nm = (f.name || "").toLowerCase(), ty = f.type || "";
      if (/\.(html?|tsx|jsx|json)$/.test(nm)) { f.text().then(function (txt) { if (window.__veCode) return window.__veCode.apply(txt, "append").then(function () { toast("Código de «" + f.name + "» agregado como clips"); }); }).catch(function (er) { toast("No se pudo leer el código: " + (er && er.message || er)); }); return; }
      var kind = /^image\//.test(ty) || /\.svg$/.test(nm) ? "upimg" : /^video\//.test(ty) || /\.(mp4|mov|webm|m4v)$/.test(nm) ? "upvid" : /^audio\//.test(ty) || /\.(mp3|wav|m4a|ogg|aac)$/.test(nm) ? "upaud" : null;
      if (!kind) return toast("«" + f.name + "»: ese tipo de archivo no entra al video");
      var bin = vq("#veBin"); if (!bin) return;
      var inp = document.createElement("input"); inp.type = "file"; inp.dataset.proin = kind; inp.style.display = "none";
      try { var dt = new DataTransfer(); dt.items.add(f); inp.files = dt.files; } catch (er) { return toast("Tu navegador no deja soltar archivos aquí: usa «Subir»"); }
      bin.appendChild(inp);
      setTimeout(function () { inp.dispatchEvent(new Event("change", { bubbles: true })); setTimeout(function () { inp.remove(); }, 1000); }, k * 120);
    });
    place(30000);
  }, true);

  /* ═════════════ timeline: selección múltiple, recuadro, mover juntos ═════════════ */
  VE._msel = VE._msel || {};
  function mkey(tr, c) { return tr + ":" + c.id; }
  function mlist() {
    var out = [], M = VE._msel; if (!VE.p) return out;
    ["v1", "m", "t", "a"].forEach(function (k) { (VE.p[k] || []).forEach(function (c, i) { if (M[mkey(k, c)]) out.push({ tr: k, i: i, c: c }); }); });
    return out;
  }
  function selection() {
    var L = mlist(); if (L.length) return L;
    var s = VE.sel; if (!s || s.tr === "layer" || s.tr === "x") return [];
    var a = arrOf(s.tr), c = a && a[s.i]; return c ? [{ tr: s.tr, i: s.i, c: c }] : [];
  }
  function clearM() { VE._msel = {}; }
  function paintM() {
    var lanesEl = vq("#veLanes"); if (!lanesEl || !VE.p) return;
    lanesEl.querySelectorAll(".ve-clip").forEach(function (el) { var a = arrOf(el.dataset.tr), c = a && a[+el.dataset.i]; el.classList.toggle("vd-msel", !!(c && VE._msel[mkey(el.dataset.tr, c)])); });
  }
  function clipAt(el) { var tr = el.dataset.tr, i = +el.dataset.i, a = arrOf(tr); return a && a[i] ? { tr: tr, i: i, c: a[i] } : null; }
  document.addEventListener("pointerdown", function (e) {
    if (!VE.open || !VE.p || e.button !== 0) return;
    var lanesEl = vq("#veLanes"); if (!lanesEl || !lanesEl.contains(e.target)) return;
    if (e.target.closest(".vd-kd,.vd-fade")) return;
    var clipEl = e.target.closest(".ve-clip");
    if (clipEl) {
      var x = clipAt(clipEl); if (!x) return;
      if (laneFlag(x.tr === "x" ? "v1" : x.tr, "lock")) { e.preventDefault(); e.stopPropagation(); toast("Esa pista está bloqueada (candado en su nombre)"); return; }
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        e.preventDefault(); e.stopPropagation();
        var s = VE.sel; if (s && s.tr !== "layer" && s.tr !== "x" && !mlist().length) { var a0 = arrOf(s.tr); if (a0 && a0[s.i]) VE._msel[mkey(s.tr, a0[s.i])] = 1; }
        var k = mkey(x.tr, x.c); if (VE._msel[k]) delete VE._msel[k]; else VE._msel[k] = 1;
        paintM(); toast(mlist().length + " clips seleccionados · arrástralos juntos, Supr borra, Ctrl+C copia");
        return;
      }
      var L = mlist();
      if (L.length > 1 && VE._msel[mkey(x.tr, x.c)] && !e.target.closest("[data-trim]")) {
        e.preventDefault(); e.stopPropagation();
        var moved = false, st0 = L.map(function (q) { return q.c.start; });
        vdrag(e, function (ev, dx) {
          if (!moved && Math.abs(dx) < 3) return;
          if (!moved) { vsnap(); moved = true; }
          var dt = dx / VE.pps, minS = Math.min.apply(null, L.filter(function (q) { return q.tr !== "v1"; }).map(function (q, j) { return st0[L.indexOf(q)]; }).concat([1e9]));
          if (minS + dt < 0) dt = -minS;
          L.forEach(function (q, j) { if (q.tr !== "v1") q.c.start = r1(Math.max(0, st0[j] + dt)); });
          veAll(); paintM();
        }, function () { if (moved) veInsp(); });
        return;
      }
      if (!VE._msel[mkey(x.tr, x.c)]) { clearM(); setTimeout(paintM, 0); }
      return;
    }
    /* recuadro de selección: Shift + arrastrar en una zona vacía */
    if (e.shiftKey && !e.target.closest(".ve-ruler,.ve-ph")) {
      var inner = vq("#veLanes .ve-inner"); if (!inner) return;
      e.preventDefault(); e.stopPropagation();
      var R = inner.getBoundingClientRect(), x0 = e.clientX - R.left, y0 = e.clientY - R.top, box = document.createElement("div"); box.className = "vd-marq"; inner.appendChild(box);
      vdrag(e, function (ev) {
        var x1 = ev.clientX - R.left, y1 = ev.clientY - R.top, l = Math.min(x0, x1), t = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
        box.style.cssText = "left:" + l + "px;top:" + t + "px;width:" + w + "px;height:" + h + "px";
        clearM();
        inner.querySelectorAll(".ve-clip").forEach(function (el) { var r = el.getBoundingClientRect(), L2 = r.left - R.left, T2 = r.top - R.top; if (L2 < l + w && L2 + r.width > l && T2 < t + h && T2 + r.height > t) { var q = clipAt(el); if (q) VE._msel[mkey(q.tr, q.c)] = 1; } });
        paintM();
      }, function () { box.remove(); var n = mlist().length; if (n) toast(n + " clips seleccionados"); });
    }
  }, true);

  /* ◆ keyframes del clip elegido y tiradores de fundido del audio */
  var _tl = veTimeline;
  veTimeline = function () {
    var r = _tl.apply(this, arguments);
    try { decorate(); } catch (e) { /* timeline a medio armar */ }
    return r;
  };
  function decorate() {
    var lanesEl = vq("#veLanes"); if (!lanesEl || !VE.p) return;
    paintM();
    var s = VE.sel;
    if (s && (s.tr === "t" || s.tr === "m")) {
      var c = VE.p[s.tr][s.i], el = lanesEl.querySelector('.ve-clip[data-tr="' + s.tr + '"][data-i="' + s.i + '"]');
      if (c && el && c.kf && c.kf.length) c.kf.forEach(function (k, ki) { if (k.t < 0 || k.t > c.dur) return; var d = document.createElement("i"); d.className = "vd-kd"; d.dataset.kdi = ki; d.title = "Keyframe " + k.t.toFixed(2) + " s · arrástralo para cambiar su tiempo"; d.style.left = (k.t * VE.pps) + "px"; el.appendChild(d); });
    }
    (VE.p.a || []).forEach(function (c, i) {
      var el = lanesEl.querySelector('.ve-clip[data-tr="a"][data-i="' + i + '"]'); if (!el) return;
      var fi = +c.fin || 0, fo = +c.fout || 0, w = c.dur * VE.pps;
      el.insertAdjacentHTML("beforeend", (fi ? '<i class="vd-ramp" style="left:0;width:' + fi * VE.pps + 'px;background:linear-gradient(to top right,rgba(0,0,0,.35) 50%,transparent 50%)"></i>' : "")
        + (fo ? '<i class="vd-ramp" style="right:0;width:' + fo * VE.pps + 'px;background:linear-gradient(to top left,rgba(0,0,0,.35) 50%,transparent 50%)"></i>' : "")
        + '<i class="vd-fade" data-vdf="in" data-ai="' + i + '" title="Fundido de entrada: ' + fi.toFixed(1) + ' s" style="left:' + Math.min(w, fi * VE.pps) + 'px"></i>'
        + '<i class="vd-fade" data-vdf="out" data-ai="' + i + '" title="Fundido de salida: ' + fo.toFixed(1) + ' s" style="left:' + Math.max(0, w - fo * VE.pps) + 'px"></i>');
    });
    laneControls();
  }
  document.addEventListener("pointerdown", function (e) {
    if (!VE.open || !VE.p || e.button !== 0) return;
    var kd = e.target.closest && e.target.closest("#veLanes .vd-kd"), fd = !kd && e.target.closest && e.target.closest("#veLanes .vd-fade");
    if (!kd && !fd) return;
    e.preventDefault(); e.stopPropagation();
    if (kd) {
      var s = VE.sel; if (!s) return; var c = VE.p[s.tr][s.i], k = c && c.kf && c.kf[+kd.dataset.kdi]; if (!k) return;
      var t0 = k.t, moved = false;
      return vdrag(e, function (ev, dx) {
        if (!moved && Math.abs(dx) < 3) return;
        if (!moved) { vsnap(); moved = true; }
        k.t = r1(cl(t0 + dx / VE.pps, 0, c.dur)); c.kf.sort(function (a, b) { return a.t - b.t; });
        veSeek(c.start + k.t); veTimeline();
      }, function () { if (!moved) veSeek(c.start + k.t); veInsp(); veTimeline(); });
    }
    var a = VE.p.a[+fd.dataset.ai]; if (!a) return;
    var inn = fd.dataset.vdf === "in", v0 = inn ? +a.fin || 0 : +a.fout || 0, mv = false;
    vdrag(e, function (ev, dx) {
      if (!mv) { vsnap(); mv = true; }
      var v = cl(v0 + (inn ? dx : -dx) / VE.pps, 0, a.dur / 2);
      if (inn) a.fin = r1(v); else a.fout = r1(v);
      veTimeline();
    }, function () { if (mv) { veInsp(); toast("Fundido de " + (inn ? "entrada" : "salida") + ": " + (inn ? a.fin : a.fout).toFixed(1) + " s"); } });
  }, true);

  /* pistas: ocultar (no se ve ni se exporta), bloquear (no se mueve) y silenciar */
  function laneControls() {
    var heads = vq("#veHeads"); if (!heads || !VE.p) return;
    [["m", "Media"], ["t", "Textos"], ["a", "Audio"], ["v1", "Tomas"]].forEach(function (x) {
      var h = heads.querySelector(".ve-h-" + x[0]); if (!h) return;
      var b = h.querySelector("b") || h.firstElementChild; if (!b || h.querySelector(".vd-lc")) return;
      var L = lanes()[x[0]] || {}, btn = function (f, ic, lbl) { return '<button data-vdl="' + x[0] + '" data-vdf2="' + f + '" aria-pressed="' + !!L[f] + '" title="' + lbl + " " + x[1].toLowerCase() + '" aria-label="' + lbl + " " + x[1].toLowerCase() + '">' + ic + "</button>"; };
      var html = '<span class="vd-lc">' + (x[0] === "a" ? btn("mute", "♪", "Silenciar") : x[0] === "v1" ? "" : btn("hide", "◐", "Ocultar")) + btn("lock", "⚿", "Bloquear") + "</span>";
      b.insertAdjacentHTML("afterend", html);
    });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("#veHeads [data-vdl]"); if (!b || !VE.p) return;
    e.preventDefault(); e.stopPropagation();
    var k = b.dataset.vdl, f = b.dataset.vdf2, L = lanes(); L[k] = L[k] || {}; vsnap(); L[k][f] = !L[k][f];
    var on = L[k][f], nm = { m: "media", t: "textos", a: "audio", v1: "tomas" }[k];
    toast((f === "hide" ? (on ? "Pista de " + nm + " oculta (no se ve ni se exporta)" : "Pista de " + nm + " visible") : f === "lock" ? (on ? "Pista de " + nm + " bloqueada" : "Pista de " + nm + " desbloqueada") : (on ? "Audio silenciado (no suena ni se exporta)" : "Audio con sonido")));
    veAll(); if (typeof veInsp === "function") veInsp();
  }, true);
  /* lo oculto no se ve en la vista previa (la exportación lo omite en bridge-video.js) */
  var _sh = stageHTML;
  stageHTML = function (p, t, selLi) {
    var L = p && p.lanes;
    if (L && ((L.m && L.m.hide) || (L.t && L.t.hide))) { var q = Object.assign({}, p, { m: L.m && L.m.hide ? [] : p.m, t: L.t && L.t.hide ? [] : p.t }); return _sh.call(this, q, t, selLi); }
    return _sh.apply(this, arguments);
  };

  /* ═════════════ teclado: copiar, pegar, borrar, empujar, J/K/L, seleccionar todo, atajos ═════════════ */
  var CLIP = null;
  function copySel(cut) {
    var L = selection(); if (!L.length) { toast("Elige uno o más clips"); return false; }
    var t0 = Math.min.apply(null, L.map(function (q) { return q.tr === "v1" ? 1e9 : q.c.start; }).concat([1e9])); if (t0 === 1e9) t0 = 0;
    var items = L.map(function (q) { var o = JSON.parse(JSON.stringify(q.c)); if (q.tr === "v1" && q.c.kind === "take") { var tk = VTAKES[q.c.take]; o.takeUrl = tk && tk.blob; } return { tr: q.tr, c: o }; });
    CLIP = { items: items, t0: t0, at: Date.now() };
    try { localStorage.setItem("musa_vclips", JSON.stringify(CLIP)); } catch (e) { /* sin almacenamiento */ }
    var txt = JSON.stringify({ musaClips: 1, t0: t0, items: items });
    CLIP.sys = false;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { CLIP.sys = true; }, function () { CLIP.sys = false; });
    if (cut) { vsnap(); removeItems(L, false); }
    toast((cut ? "Cortaste " : "Copiaste ") + L.length + (L.length === 1 ? " clip" : " clips") + " · Ctrl+V pega en el playhead");
    return true;
  }
  function pasteItems(data) {
    if (!data || !data.items || !data.items.length || !VE.p) return;
    vsnap(); clearM();
    var p = VE.p, at = VE.t, cur = typeof veCurClip === "function" ? veCurClip() : null, ins = cur ? cur.i + 1 : p.v1.length;
    data.items.forEach(function (it) {
      var o = JSON.parse(JSON.stringify(it.c)); o.id = nid(); delete o._row;
      if (it.tr === "v1") { if (o.kind === "take") { o.take = RB().takeFor ? RB().takeFor(o.takeUrl || "", o.name, o.dur) : o.take; delete o.takeUrl; } p.v1.splice(ins++, 0, o); VE._msel[mkey("v1", o)] = 1; return; }
      o.start = r1(Math.max(0, at + ((+it.c.start || 0) - (data.t0 || 0))));
      ["morphClip", "matte"].forEach(function (k) { delete o[k]; });
      p[it.tr].push(o); VE._msel[mkey(it.tr, o)] = 1;
    });
    relayout(p); veAll(); veInsp();
    toast("Pegaste " + data.items.length + (data.items.length === 1 ? " clip" : " clips"));
  }
  var PASTE_T = null;
  document.addEventListener("paste", function (e) {
    clearTimeout(PASTE_T); PASTE_T = null;
    if (!VE.open || !VE.p || typing(e) || e.defaultPrevented) return;
    var txt = e.clipboardData && e.clipboardData.getData("text/plain");
    /* el portapapeles no trae nuestros clips (navegadores que no dejan escribir en él): se pegan los copiados aquí */
    if (!txt || txt.indexOf('"musaClips"') < 0) {
      var mem = CLIP; if (!mem) { try { mem = JSON.parse(localStorage.getItem("musa_vclips") || "null"); } catch (er) { mem = null; } }
      if (mem && mem.items && Date.now() - (mem.at || 0) < 30 * 60 * 1000) { e.preventDefault(); e.stopPropagation(); pasteItems(mem); }
      return;
    }
    try { var d = JSON.parse(txt); if (d && d.musaClips) { e.preventDefault(); e.stopPropagation(); pasteItems(d); } } catch (er) { /* no era nuestro */ }
  }, true);
  function removeItems(L, ripple) {
    var p = VE.p;
    L.slice().sort(function (a, b) { return b.i - a.i; }).forEach(function (q) {
      var arr = arrOf(q.tr), ix = arr.indexOf(q.c); if (ix < 0) return;
      arr.splice(ix, 1);
      if (ripple && q.tr !== "v1") arr.forEach(function (o) { if (o.start >= q.c.start + q.c.dur - 1e-3) o.start = r1(Math.max(0, o.start - q.c.dur)); });
    });
    VE.sel = null; clearM(); relayout(p); veAll(); veInsp();
  }
  var REV = null;
  function revStop() { if (REV) { cancelAnimationFrame(REV); REV = null; } }
  document.addEventListener("keydown", function (e) {
    if (!VE.open || !VE.p || typing(e)) return;
    var code = document.getElementById("veCode"); if (code && !code.hidden && code.contains(document.activeElement)) return;
    var mod = e.ctrlKey || e.metaKey, k = (e.key || "").toLowerCase(), fr = 1 / (VE.p.fps || 30);
    if (k !== "j") revStop();
    if (mod && k === "c") { if (copySel(false)) e.preventDefault(); return; }
    if (mod && k === "x") { if (copySel(true)) { e.preventDefault(); e.stopImmediatePropagation(); } return; }
    if (mod && k === "v") {
      /* si el portapapeles del sistema no tiene nuestros clips (permiso negado), se pega lo copiado aquí o en otra pestaña */
      var mem = CLIP; if (!mem) { try { mem = JSON.parse(localStorage.getItem("musa_vclips") || "null"); } catch (er) { mem = null; } }
      if (mem && mem.items && (!navigator.clipboard || !mem.sys)) { e.preventDefault(); e.stopImmediatePropagation(); pasteItems(mem); return; }
      /* si el navegador no manda el evento «pegar» (pasa con algunos atajos), se pega lo copiado aquí */
      if (mem && mem.items) { clearTimeout(PASTE_T); PASTE_T = setTimeout(function () { PASTE_T = null; pasteItems(mem); }, 160); }
      return;
    }
    if (mod && k === "a") { e.preventDefault(); e.stopImmediatePropagation(); clearM(); ["v1", "m", "t", "a"].forEach(function (kk) { if (laneFlag(kk, "lock")) return; (VE.p[kk] || []).forEach(function (c) { VE._msel[mkey(kk, c)] = 1; }); }); paintM(); toast(mlist().length + " clips seleccionados"); return; }
    if (e.key === "Delete" || e.key === "Backspace") {
      var L = mlist();
      if (e.shiftKey) { var S2 = L.length ? L : selection(); if (!S2.length) return; e.preventDefault(); e.stopImmediatePropagation(); vsnap(); removeItems(S2, true); toast("Borrado y hueco cerrado"); return; }
      if (L.length > 1) { e.preventDefault(); e.stopImmediatePropagation(); vsnap(); removeItems(L, false); toast(L.length + " clips borrados"); return; }
      return;
    }
    if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      var N = selection().filter(function (q) { return q.tr !== "v1"; }); if (!N.length) return;
      e.preventDefault(); e.stopImmediatePropagation(); vsnap();
      var d = (e.key === "ArrowLeft" ? -1 : 1) * fr * (e.shiftKey ? 10 : 1);
      N.forEach(function (q) { q.c.start = Math.round(Math.max(0, q.c.start + d) * 1000) / 1000; });
      veAll(); veInsp(); return;
    }
    if (mod || e.altKey) return;
    if (k === "l") { e.preventDefault(); if (!VE.playing) vePlay(); return; }
    if (k === "k") { e.preventDefault(); veStop(); return; }
    if (k === "j") {
      e.preventDefault(); veStop(); revStop();
      var last = performance.now();
      var step = function (now) { var dt = (now - last) / 1000; last = now; var t = VE.t - dt; if (t <= 0) { veSeek(0); REV = null; return; } veSeek(t); if (typeof veFollow === "function") veFollow(); REV = requestAnimationFrame(step); };
      REV = requestAnimationFrame(step); toast("Reproducción hacia atrás · K para parar"); return;
    }
    if (e.key === "?") { e.preventDefault(); showKeys(); return; }
  }, true);

  /* ═════════════ menú con clic derecho en un clip ═════════════ */
  var MENU = null;
  function closeMenu() { if (MENU) { MENU.remove(); MENU = null; } }
  document.addEventListener("contextmenu", function (e) {
    if (!VE.open || !VE.p) return;
    var el = e.target.closest && (e.target.closest("#veLanes .ve-clip") || e.target.closest("#veStageW [data-ti],#veStageW [data-mi]"));
    if (!el) return;
    e.preventDefault(); closeMenu();
    var x = el.dataset.tr ? clipAt(el) : el.hasAttribute("data-ti") ? { tr: "t", i: +el.dataset.ti, c: VE.p.t[+el.dataset.ti] } : { tr: "m", i: +el.dataset.mi, c: VE.p.m[+el.dataset.mi] };
    if (!x || !x.c) return;
    if (!(VE.sel && VE.sel.tr === x.tr && VE.sel.i === x.i) && !VE._msel[mkey(x.tr, x.c)]) { clearM(); veSelect({ tr: x.tr, i: x.i }); }
    var n = mlist().length, items = [
      ["split", "Dividir en el playhead", "S"], ["dup", "Duplicar", "Ctrl+D"], null,
      ["copy", n > 1 ? "Copiar " + n + " clips" : "Copiar", "Ctrl+C"], ["cut", "Cortar", "Ctrl+X"], ["paste", "Pegar en el playhead", "Ctrl+V"], null,
      ["front", "Traer al frente", ""], ["back", "Enviar al fondo", ""], null,
      ["code", "Ver en el código", "</>"], null,
      ["del", n > 1 ? "Eliminar " + n + " clips" : "Eliminar", "Supr"], ["ripple", "Eliminar y cerrar el hueco", "Shift+Supr"],
    ];
    MENU = document.createElement("div"); MENU.className = "vd-menu"; MENU.setAttribute("role", "menu");
    MENU.innerHTML = items.map(function (it) { return it ? '<button role="menuitem" data-vm="' + it[0] + '">' + esc(it[1]) + "<small>" + esc(it[2]) + "</small></button>" : "<hr>"; }).join("");
    document.body.appendChild(MENU);
    var mw = MENU.offsetWidth, mh = MENU.offsetHeight;
    MENU.style.left = Math.min(e.clientX, innerWidth - mw - 8) + "px"; MENU.style.top = Math.min(e.clientY, innerHeight - mh - 8) + "px";
    var first = MENU.querySelector("button"); if (first) first.focus();
    MENU.addEventListener("keydown", function (ev) {
      var bs = [].slice.call(MENU.querySelectorAll("button")), ix = bs.indexOf(document.activeElement);
      if (ev.key === "ArrowDown") { ev.preventDefault(); bs[(ix + 1) % bs.length].focus(); } else if (ev.key === "ArrowUp") { ev.preventDefault(); bs[(ix - 1 + bs.length) % bs.length].focus(); } else if (ev.key === "Escape") { ev.preventDefault(); closeMenu(); }
    });
    MENU.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-vm]"); if (!b) return;
      var a = b.dataset.vm; closeMenu();
      if (a === "split" || a === "dup" || a === "front" || a === "back") return vact(a);
      if (a === "copy") return copySel(false);
      if (a === "cut") return copySel(true);
      if (a === "paste") { var mem = CLIP; if (!mem) { try { mem = JSON.parse(localStorage.getItem("musa_vclips") || "null"); } catch (er) { mem = null; } } return mem ? pasteItems(mem) : toast("No hay clips copiados"); }
      if (a === "code") { if (window.__veCode) window.__veCode.open("html"); return; }
      if (a === "del") { var L = mlist(); if (L.length > 1) { vsnap(); return removeItems(L, false); } return vact("del"); }
      if (a === "ripple") { var S2 = mlist().length ? mlist() : selection(); vsnap(); return removeItems(S2, true); }
    });
  });
  document.addEventListener("pointerdown", function (e) { if (MENU && !MENU.contains(e.target)) closeMenu(); }, true);

  /* ═════════════ «?» todos los atajos ═════════════ */
  var KEYS = [
    ["Espacio / L", "Reproducir"], ["K", "Pausar"], ["J", "Reproducir hacia atrás"], ["← →", "Un cuadro (Shift: 1 s)"], ["Inicio / Fin", "Al principio / al final"],
    ["S", "Dividir en el playhead"], ["Ctrl+D", "Duplicar"], ["Ctrl+C / Ctrl+X / Ctrl+V", "Copiar / cortar / pegar clips (también entre videos)"], ["Supr", "Borrar (todos los seleccionados)"], ["Shift+Supr", "Borrar y cerrar el hueco"],
    ["Shift/Ctrl + clic", "Sumar o quitar un clip de la selección"], ["Shift + arrastrar en vacío", "Seleccionar con un recuadro"], ["Ctrl+A", "Seleccionar todo"], ["Alt+← →", "Empujar 1 cuadro (Shift: 10)"],
    ["Ctrl+Z / Ctrl+Shift+Z", "Deshacer / rehacer"], ["M", "Marcador en el playhead"], ["Ctrl+rueda", "Zoom del timeline"],
    ["Arrastrar en el video", "Mover (Shift: un eje · Alt: sin imán)"], ["Esquinas / tirador", "Escalar / girar (keyframe en el playhead)"], ["Doble clic en un texto", "Escribir ahí mismo"],
    ["Arrastrar de la biblioteca", "Al video (donde sueltas) o al timeline (en ese instante)"], ["Soltar archivos", "Imagen, video, audio, SVG o código (.html, .tsx, .json)"], ["Ctrl+V con código", "Pegar código de un video y volverlo clips"],
    ["</> Código", "El video como código (HTML + GSAP / Remotion / JSON), en vivo"], ["Clic derecho", "Menú del clip"], ["?", "Esta ayuda"],
  ];
  function showKeys() {
    var w = document.createElement("div"); w.className = "vd-keys"; w.setAttribute("role", "dialog"); w.setAttribute("aria-modal", "true"); w.setAttribute("aria-label", "Atajos del editor de video");
    w.innerHTML = '<div class="bx"><h3>Atajos y gestos del editor</h3><table>' + KEYS.map(function (k) { return "<tr><td><kbd>" + esc(k[0]) + "</kbd></td><td>" + esc(k[1]) + "</td></tr>"; }).join("") + '</table><div class="row"><button>Listo</button></div></div>';
    document.body.appendChild(w);
    var b = w.querySelector("button"); b.focus();
    var close = function () { w.remove(); };
    b.addEventListener("click", close); w.addEventListener("click", function (e) { if (e.target === w) close(); }); w.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Escape" || e.key === "Enter") close(); });
  }
  /* botón «?» en la barra del timeline */
  setInterval(function () {
    if (!VE.open) return;
    var bar = vq(".ve-tlbar"); if (!bar || bar.querySelector("[data-vdkeys]")) return;
    var b = document.createElement("button"); b.className = "ed-tbtn"; b.dataset.vdkeys = "1"; b.textContent = "?"; b.title = "Atajos y gestos (?)"; b.setAttribute("aria-label", "Atajos y gestos del editor");
    b.style.cssText = "min-width:26px;font-weight:700";
    b.addEventListener("click", showKeys); bar.appendChild(b);
  }, 800);
  window.__veDnd = { selection: selection, copy: copySel, paste: pasteItems, msel: function () { return mlist(); } };
})();
