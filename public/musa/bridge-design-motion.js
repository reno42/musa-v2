/* bridge-design-motion.js — la línea de tiempo del editor de diseño y la sección «Animación» de verdad.
 *
 * Todo lo que se mueve en una lámina vive en frame.animation (shared/animationSchema.ts, el mismo modelo que escribe el
 * MCP con set_animation y el importador de código). Aquí se ve y se edita:
 *  · Línea de tiempo (abajo del lienzo): una fila por capa animada; cada animación es una barra (moverla cambia cuándo
 *    empieza, sus bordes cambian cuánto dura) y cada keyframe un rombo (clic = editarlo en el inspector, arrastrarlo =
 *    cambiar su instante). La regla mueve el cabezal (el lienzo muestra ese instante) y la bandera naranja es la PORTADA
 *    (lo que se ve quieto: arrástrala para cambiarla).
 *  · Inspector › Animación: las animaciones de la capa elegida (inicio, duración, repeticiones, dirección, curva),
 *    agregar un efecto de la biblioteca, keyframe en el instante actual y el editor del keyframe elegido.
 */
(function boot(n) {
  "use strict";
  var RB = window.__musaReal, MD = window.__mdLive, MA = window.MusaAnim;
  if (!RB || !MD || !MA || typeof ED === "undefined") { if ((n || 0) < 800) setTimeout(function () { boot((n || 0) + 1); }, 150); return; }
  if (window.__mdMotion) return;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function cssq(s) { return window.CSS && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, "\\$&"); }
  function r3(v) { var x = Math.round(v * 1000) / 1000; return Object.is(x, -0) ? 0 : x; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function say(m) { if (typeof toast === "function") toast(m); }
  function curDoc() { return ED.open && ED.doc && ED.doc._real ? ED.doc : null; }
  function selFrame() { var d = curDoc(); return d && ED.sel ? d.frames[ED.sel.f] || null : null; }
  function selLayerId() { var d = curDoc(); if (!d || !ED.sel || ED.sel.e == null) return null; var f = d.frames[ED.sel.f], e = f && f.els[ED.sel.e]; return e && e._n ? e._n.getAttribute("data-layer-id") : null; }
  function layerName(f, id) { var n = f && f._root && f._root.querySelector('[data-layer-id="' + cssq(id) + '"]'); return n ? n.getAttribute("data-layer-name") || id : id + " (no está)"; }
  function selectLayer(f, id) { var d = curDoc(); if (!d) return; var fi = d.frames.indexOf(f), ei = f.els.findIndex(function (e) { return e && e._n && e._n.getAttribute("data-layer-id") === id; }); if (fi >= 0 && ei >= 0 && typeof select === "function") select({ f: fi, e: ei }); }
  var PROP_LBL = { transform: "Movimiento", opacity: "Opacidad", filter: "Filtro", color: "Color", backgroundColor: "Fondo", backgroundPosition: "Posición del fondo", clipPath: "Recorte", width: "Ancho", height: "Alto", top: "Arriba", left: "Izquierda", visibility: "Visibilidad", boxShadow: "Sombra", borderRadius: "Radio", letterSpacing: "Interletraje", strokeDashoffset: "Trazo (dibujar)", fill: "Relleno", stroke: "Borde", scale: "Escala", rotate: "Giro", translate: "Desplazamiento", backdropFilter: "Desenfoque de fondo" };
  function propLbl(p) { return PROP_LBL[p] || p; }
  var EASES = [["linear", "Lineal"], ["ease", "Suave"], ["ease-out", "Frena al llegar"], ["ease-in", "Acelera"], ["ease-in-out", "Acelera y frena"], ["cubic-bezier(0.34, 1.56, 0.64, 1)", "Rebote al llegar"], ["cubic-bezier(0.19, 1, 0.22, 1)", "Muy suave al llegar"], ["steps(1, jump-end)", "Salto (sin transición)"]];
  function easeSel(attr, v) {
    var norm = MA.normalizeEasing(v || "ease"), known = EASES.some(function (e) { return MA.normalizeEasing(e[0]) === norm; });
    return "<select " + attr + ">" + (known ? "" : '<option value="' + esc(norm) + '" selected>Personalizada · ' + esc(norm.slice(0, 40)) + "</option>") + EASES.map(function (e) { return '<option value="' + esc(e[0]) + '"' + (MA.normalizeEasing(e[0]) === norm ? " selected" : "") + ">" + e[1] + "</option>"; }).join("") + "</select>";
  }

  /* ═════════════ cambios en la animación (siempre el mismo modelo) ═════════════ */
  function animOf(f) { return MD.animOf(f) || null; }
  function edit(f, fn, noSnap) {
    var A = animOf(f), c = JSON.parse(JSON.stringify(A || MA.defaultAnimation(f.w, f.h)));
    fn(c);
    var end = c.clips.reduce(function (m, k) { var e = MA.clipEndSec(k); return isFinite(e) ? Math.max(m, e) : Math.max(m, k.endSec); }, 0);
    if (end > c.timeline.durationSec) c.timeline.durationSec = Math.min(600, r3(end));
    MD.setAnim(f, { clips: c.clips, timeline: c.timeline }, !!noSnap);
    TL.sig = "";
    if (TL.open) draw();
  }
  function sample(f, clip, prop, local) { var tw = clip.tweens.find(function (t) { return t.prop === prop; }); return tw ? MA.sampleTween(tw, local) : null; }

  /* ═════════════ línea de tiempo ═════════════ */
  var TL = { el: null, open: false, f: null, zoom: 120, sel: null, drag: null, sig: "", raf: 0 };
  var css = document.createElement("style");
  css.textContent = ""
    + "#mdTL{position:absolute;left:0;right:0;bottom:0;height:230px;z-index:35;background:#141414;border-top:1px solid #333;color:#ddd;font:12px/1.3 Inter,system-ui,sans-serif;display:flex;flex-direction:column;box-shadow:0 -8px 24px rgba(0,0,0,.35)}"
    + "#mdTL[hidden]{display:none}#mdTL .tl-h{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid #262626;flex-wrap:wrap}"
    + "#mdTL button{background:#262626;border:1px solid #3a3a3a;color:#eee;border-radius:6px;height:26px;padding:0 9px;cursor:pointer;font:inherit}#mdTL button:hover{background:#333}#mdTL button.pri{background:#ff5e00;border-color:#ff5e00;color:#fff}"
    + "#mdTL .tl-t{font-variant-numeric:tabular-nums;min-width:96px}#mdTL .tl-sp{flex:1}#mdTL input[type=number]{width:64px;background:#1d1d1d;border:1px solid #333;color:#eee;border-radius:6px;height:24px;padding:0 6px}"
    + "#mdTL .tl-b{flex:1;display:grid;grid-template-columns:170px 1fr;min-height:0}#mdTL .tl-names{overflow:hidden;border-right:1px solid #262626}#mdTL .tl-lanes{overflow:auto;position:relative}"
    + "#mdTL .tl-nm{height:28px;display:flex;align-items:center;padding:0 8px;border-bottom:1px solid #1f1f1f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}#mdTL .tl-nm.on{color:#ff9b5e}#mdTL .tl-nm.hd{height:24px;color:#888;cursor:default}"
    + "#mdTL .tl-ruler{height:24px;position:sticky;top:0;background:#181818;border-bottom:1px solid #262626;z-index:3;cursor:col-resize}#mdTL .tl-tick{position:absolute;top:0;bottom:0;border-left:1px solid #2c2c2c;font-size:10px;color:#777;padding:2px 3px}"
    + "#mdTL .tl-row{height:28px;position:relative;border-bottom:1px solid #1f1f1f}#mdTL .tl-row.on{background:rgba(255,94,0,.06)}"
    + "#mdTL .tl-clip{position:absolute;top:5px;height:18px;border-radius:5px;background:#3b3b6e;border:1px solid #5a5aa0;box-sizing:border-box;cursor:grab;overflow:visible}#mdTL .tl-clip.sel{border-color:#ff5e00;background:#4a3a6e}"
    + "#mdTL .tl-clip .tl-e{position:absolute;top:-1px;bottom:-1px;width:7px;cursor:ew-resize}#mdTL .tl-clip .tl-e.l{left:-3px}#mdTL .tl-clip .tl-e.r{right:-3px}"
    + "#mdTL .tl-rep{position:absolute;top:5px;height:18px;border-radius:5px;border:1px dashed #5a5aa0;box-sizing:border-box;pointer-events:none;opacity:.55}"
    + "#mdTL .tl-k{position:absolute;top:3px;width:11px;height:11px;margin-left:-6px;background:#d9d9ff;transform:rotate(45deg);border:1px solid #222;cursor:pointer;z-index:2}#mdTL .tl-k.on{background:#ff5e00}"
    + "#mdTL .tl-ph{position:absolute;top:0;bottom:0;width:0;border-left:2px solid #fff;z-index:4;pointer-events:none}"
    + "#mdTL .tl-pf{position:absolute;top:0;width:0;height:100%;border-left:2px dashed #ff5e00;z-index:4}#mdTL .tl-pf b{position:absolute;top:0;left:-1px;background:#ff5e00;color:#fff;font-size:10px;padding:2px 5px;border-radius:0 4px 4px 0;cursor:ew-resize;white-space:nowrap;pointer-events:auto}"
    + "#mdTLBtn{position:absolute;left:10px;bottom:10px;z-index:34;background:rgba(20,20,20,.92);border:1px solid #3a3a3a;color:#eee;border-radius:8px;height:30px;padding:0 11px;cursor:pointer;font:600 12px Inter,system-ui,sans-serif}#mdTLBtn[hidden]{display:none}"
    + ".md-anim .md-row{display:flex;gap:6px;flex-wrap:wrap;grid-column:1/-1}.md-anim .md-clip{grid-column:1/-1;border:1px solid #2e2e2e;border-radius:8px;padding:8px;display:grid;grid-template-columns:1fr 1fr;gap:6px}.md-anim .md-clip.sel{border-color:#ff5e00}.md-anim .md-clip b{grid-column:1/-1}";
  document.head.appendChild(css);

  function host() { return document.querySelector("#edCanvas"); }
  function build() {
    if (TL.el) return;
    var h = host(); if (!h) return;
    TL.el = document.createElement("section"); TL.el.id = "mdTL"; TL.el.hidden = true; TL.el.setAttribute("aria-label", "Línea de tiempo de la lámina");
    TL.el.innerHTML = '<div class="tl-h"><button type="button" data-tl="play" aria-label="Reproducir">▶</button><span class="tl-t"></span>'
      + '<button type="button" data-tl="key" title="Keyframe de la capa elegida en este instante">◆ Keyframe aquí</button>'
      + '<button type="button" data-tl="poster" class="pri" title="La portada es lo que se ve quieto">Portada = este instante</button>'
      + '<span class="tl-sp"></span><label>Duración <input type="number" min="0.2" max="600" step="0.1" data-tl="dur"> s</label>'
      + '<button type="button" data-tl="zout" aria-label="Alejar">−</button><button type="button" data-tl="zin" aria-label="Acercar">+</button><button type="button" data-tl="close" aria-label="Cerrar la línea de tiempo">×</button></div>'
      + '<div class="tl-b"><div class="tl-names"></div><div class="tl-lanes"></div></div>';
    h.appendChild(TL.el);
    TL.el.tabIndex = -1;
    TL.el.addEventListener("pointerdown", function (e) { if (!e.target.closest("input,select,button")) { try { TL.el.focus({ preventScroll: true }); } catch (er) { /* idem */ } } onDown(e); });
    TL.el.addEventListener("click", onClick);
    TL.el.addEventListener("change", function (e) { if (e.target.matches('[data-tl="dur"]') && TL.f) { var v = Math.max(0.2, Math.min(600, parseFloat(e.target.value) || 5)); edit(TL.f, function (c) { c.timeline.durationSec = v; }); } });
    TL.el.addEventListener("keydown", function (e) { e.stopPropagation(); if ((e.key === "Delete" || e.key === "Backspace") && TL.sel && TL.sel.kt != null && !/INPUT|SELECT/.test(e.target.tagName)) { e.preventDefault(); delKey(); } });
    var lanes = TL.el.querySelector(".tl-lanes"), names = TL.el.querySelector(".tl-names");
    lanes.addEventListener("scroll", function () { names.scrollTop = lanes.scrollTop; });
    var btn = document.createElement("button"); btn.id = "mdTLBtn"; btn.type = "button"; btn.hidden = true; btn.textContent = "⏱ Línea de tiempo";
    btn.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    btn.addEventListener("click", function (e) { e.stopPropagation(); var f = selFrame() || firstMotion(); if (f) toggle(f, true); });
    h.appendChild(btn); TL.btn = btn;
  }
  function firstMotion() { var d = curDoc(); return d ? d.frames.find(function (f) { return MD.hasMotion(f); }) || null : null; }
  function dur(f) { return MD.durOf(f); }
  function rows(f) {
    var A = animOf(f), ids = [], seen = {};
    (A ? A.clips : []).forEach(function (c) { if (!seen[c.layerId]) { seen[c.layerId] = 1; ids.push(c.layerId); } });
    var sl = selLayerId(); if (sl && !seen[sl] && f === selFrame()) ids.unshift(sl);
    return ids;
  }
  function draw() {
    if (!TL.el || !TL.open || !TL.f) return;
    var f = TL.f, A = animOf(f), D = dur(f), Z = TL.zoom, W = Math.max(D * Z + 60, 400), ids = rows(f), sl = selLayerId();
    var sig = JSON.stringify([A && A.clips, D, Z, ids, sl, TL.sel, MD.posterOf(f)]);
    if (sig !== TL.sig) {
      TL.sig = sig;
      var names = '<div class="tl-nm hd">Capas animadas</div>' + ids.map(function (id) { return '<div class="tl-nm' + (id === sl ? " on" : "") + '" data-tlname="' + esc(id) + '" title="' + esc(layerName(f, id)) + '">' + esc(layerName(f, id)) + "</div>"; }).join("")
        + (ids.length ? "" : '<div class="tl-nm hd" style="white-space:normal;height:auto;padding:8px">Elige una capa y agrégale un efecto en el inspector › Animación, o usa «◆ Keyframe aquí».</div>');
      var step = Z >= 200 ? 0.25 : Z >= 90 ? 0.5 : Z >= 40 ? 1 : 2, ticks = "";
      for (var t = 0; t <= D + 1e-6; t += step) ticks += '<span class="tl-tick" style="left:' + t * Z + 'px">' + (Math.round(t * 100) / 100) + "</span>";
      var lanes = '<div style="position:relative;width:' + W + 'px"><div class="tl-ruler" data-tlruler>' + ticks + "</div>"
        + ids.map(function (id) {
          var cs = A ? A.clips.map(function (c, i) { return { c: c, i: i }; }).filter(function (x) { return x.c.layerId === id; }) : [];
          return '<div class="tl-row' + (id === sl ? " on" : "") + '" data-tlrow="' + esc(id) + '">' + cs.map(function (x) {
            var c = x.c, L = c.startSec * Z, Wc = Math.max(4, (c.endSec - c.startSec) * Z), it = c.iterations == null ? 1 : c.iterations, reps = "";
            var nrep = it < 0 ? Math.ceil((D - c.endSec) / Math.max(0.05, c.endSec - c.startSec)) : Math.ceil(it) - 1;
            for (var r = 1; r <= Math.min(nrep, 40); r++) reps += '<span class="tl-rep" style="left:' + (L + r * Wc) + "px;width:" + Wc + 'px"></span>';
            var kt = {}; c.tweens.forEach(function (tw) { tw.keyframes.forEach(function (k) { kt[r3(k.t)] = 1; }); });
            var sel = TL.sel && TL.sel.ci === x.i;
            return reps + '<div class="tl-clip' + (sel ? " sel" : "") + '" data-tlclip="' + x.i + '" style="left:' + L + "px;width:" + Wc + 'px" title="' + esc(c.tweens.map(function (tw) { return propLbl(tw.prop); }).join(", ") + " · " + r2(c.startSec) + "–" + r2(c.endSec) + " s" + (it < 0 ? " · se repite" : it > 1 ? " · ×" + it : "")) + '"><i class="tl-e l" data-tledge="l"></i><i class="tl-e r" data-tledge="r"></i>'
              + Object.keys(kt).map(function (k) { return '<i class="tl-k' + (sel && TL.sel.kt != null && Math.abs(TL.sel.kt - +k) < 1e-4 ? " on" : "") + '" data-tlkey="' + k + '" style="left:' + (+k * Wc) + 'px" title="Keyframe · ' + r2(c.startSec + +k * (c.endSec - c.startSec)) + ' s"></i>'; }).join("") + "</div>";
          }).join("") + "</div>";
        }).join("")
        + '<div class="tl-pf" data-tlpf style="left:' + MD.posterOf(f) * Z + 'px"><b title="Portada: lo que se ve quieto. Arrástrala.">Portada ' + r2(MD.posterOf(f)) + " s</b></div><div class=\"tl-ph\" style=\"left:" + MD.timeOf(f) * Z + 'px"></div></div>';
      TL.el.querySelector(".tl-names").innerHTML = names;
      TL.el.querySelector(".tl-lanes").innerHTML = lanes;
      var di = TL.el.querySelector('[data-tl="dur"]'); if (di && document.activeElement !== di) di.value = r2(A ? A.timeline.durationSec : D);
    }
    tick();
  }
  function tick() {
    if (!TL.el || !TL.open || !TL.f) return;
    var t = MD.timeOf(TL.f), ph = TL.el.querySelector(".tl-ph"); if (ph) ph.style.left = t * TL.zoom + "px";
    TL.el.querySelector(".tl-t").textContent = r2(t).toFixed(2) + " / " + r2(dur(TL.f)).toFixed(2) + " s";
    var pb = TL.el.querySelector('[data-tl="play"]'); if (pb) pb.textContent = playing() ? "■" : "▶";
  }
  function playing() { return !!(MD.__playing && MD.__playing()); }
  function loop() { cancelAnimationFrame(TL.raf); if (!TL.open) return; tick(); TL.raf = requestAnimationFrame(loop); }
  function toggle(f, on) {
    build(); if (!TL.el) return;
    TL.open = on != null ? !!on : !TL.open;
    TL.el.hidden = !TL.open; TL.f = TL.open ? f : null; TL.sig = ""; TL.sel = null;
    if (!TL.open) { var d = curDoc(); if (d) d.frames.forEach(function (x) { MD.view(x, null); }); }
    else { draw(); loop(); }
    refreshBtn();
  }
  function refreshBtn() {
    if (!TL.btn) build(); if (!TL.btn) return;
    var f = selFrame() || firstMotion();
    TL.btn.hidden = !ED.open || !curDoc() || TL.open || !f || !(MD.hasMotion(f) || selLayerId());
  }
  function timeAt(ev) { var lanes = TL.el.querySelector(".tl-lanes"), r = lanes.getBoundingClientRect(); return Math.max(0, Math.min(dur(TL.f), (ev.clientX - r.left + lanes.scrollLeft) / TL.zoom)); }
  function onDown(e) {
    if (!TL.f) return;
    var f = TL.f, t = e.target;
    if (t.closest(".tl-h") || t.closest(".tl-names")) return;
    e.preventDefault(); e.stopPropagation();
    var A = animOf(f);
    var pf = t.closest("[data-tlpf] b");
    if (pf) return startDrag(e, { kind: "poster" });
    var key = t.closest("[data-tlkey]"), clipEl = t.closest("[data-tlclip]");
    if (key && clipEl) {
      var ci = +clipEl.dataset.tlclip, kt = +key.dataset.tlkey; TL.sel = { ci: ci, kt: kt }; TL.sig = "";
      selectLayer(f, A.clips[ci].layerId); draw(); refreshInsp();
      return startDrag(e, { kind: "key", ci: ci, kt: kt, c0: JSON.parse(JSON.stringify(A.clips[ci])) });
    }
    if (clipEl) {
      var ci2 = +clipEl.dataset.tlclip, edge = t.closest("[data-tledge]"); TL.sel = { ci: ci2, kt: null }; TL.sig = "";
      selectLayer(f, A.clips[ci2].layerId); draw(); refreshInsp();
      return startDrag(e, { kind: edge ? "edge-" + edge.dataset.tledge : "move", ci: ci2, c0: JSON.parse(JSON.stringify(A.clips[ci2])) });
    }
    /* regla o fondo: el cabezal (el lienzo muestra ese instante) */
    MD.view(f, timeAt(e)); tick();
    startDrag(e, { kind: "head" });
  }
  function startDrag(e, d) {
    d.x0 = e.clientX; d.moved = false; TL.drag = d;
    var mv = function (ev) { dragMove(ev); }, up = function (ev) { window.removeEventListener("pointermove", mv, true); window.removeEventListener("pointerup", up, true); dragEnd(ev); };
    window.addEventListener("pointermove", mv, true); window.addEventListener("pointerup", up, true);
  }
  function snapT(t) { return Math.round(t * 20) / 20; }
  function dragMove(ev) {
    var d = TL.drag, f = TL.f; if (!d || !f) return;
    var dt = (ev.clientX - d.x0) / TL.zoom; if (!d.moved && Math.abs(ev.clientX - d.x0) < 3) return;
    if (!d.moved) { d.moved = true; if (d.kind !== "head" && typeof snap === "function") snap(); }
    if (d.kind === "head") { MD.view(f, timeAt(ev)); tick(); return; }
    if (d.kind === "poster") { var pf = TL.el.querySelector("[data-tlpf]"), tp = snapT(timeAt(ev)); if (pf) { pf.style.left = tp * TL.zoom + "px"; pf.querySelector("b").textContent = "Portada " + r2(tp) + " s"; } MD.view(f, tp); tick(); d.t = tp; return; }
    var c0 = d.c0;
    edit(f, function (c) {
      var k = c.clips[d.ci]; if (!k) return;
      var len = c0.endSec - c0.startSec;
      if (d.kind === "move") { var s = Math.max(0, snapT(c0.startSec + dt)); k.startSec = s; k.endSec = r3(s + len); }
      else if (d.kind === "edge-l") { k.startSec = Math.max(0, Math.min(c0.endSec - 0.05, snapT(c0.startSec + dt))); }
      else if (d.kind === "edge-r") { k.endSec = Math.max(c0.startSec + 0.05, snapT(c0.endSec + dt)); }
      else if (d.kind === "key") {
        /* el rombo cambia su instante dentro de la animación (entre sus vecinos) */
        var nt = Math.max(0, Math.min(1, d.kt + dt / Math.max(0.05, len)));
        var all = []; c0.tweens.forEach(function (tw) { tw.keyframes.forEach(function (x) { all.push(r3(x.t)); }); });
        all = all.filter(function (x, i, a) { return a.indexOf(x) === i; }).sort(function (a, b) { return a - b; });
        var at = all.indexOf(r3(d.kt)), lo = at > 0 ? all[at - 1] + 0.001 : 0, hi = at < all.length - 1 ? all[at + 1] - 0.001 : 1;
        if (r3(d.kt) === 0 || r3(d.kt) === 1) nt = d.kt; else nt = Math.max(lo, Math.min(hi, nt));
        k.tweens = c0.tweens.map(function (tw) { return Object.assign({}, tw, { keyframes: tw.keyframes.map(function (x) { return Math.abs(x.t - d.kt) < 1e-4 ? Object.assign({}, x, { t: r3(nt) }) : x; }) }); });
        d.nt = nt;
      }
    }, true);
  }
  function dragEnd() {
    var d = TL.drag; TL.drag = null; if (!d || !TL.f) return;
    if (d.kind === "poster" && d.moved && d.t != null) { MD.setPoster(TL.f, d.t); say("Portada: " + r2(d.t) + " s"); TL.sig = ""; draw(); return; }
    if (d.kind === "key" && d.nt != null) { TL.sel = { ci: d.ci, kt: r3(d.nt) }; TL.sig = ""; draw(); refreshInsp(); }
    if (d.kind !== "head" && d.moved) { RB._edx.save(); refreshInsp(); }
  }
  function onClick(e) {
    var b = e.target.closest && e.target.closest("[data-tl]"), nm = e.target.closest && e.target.closest("[data-tlname]");
    if (nm && TL.f) { selectLayer(TL.f, nm.dataset.tlname); TL.sig = ""; draw(); return; }
    if (!b || !TL.f) return;
    var k = b.dataset.tl, f = TL.f;
    if (k === "close") return toggle(f, false);
    if (k === "zin") { TL.zoom = Math.min(600, TL.zoom * 1.4); TL.sig = ""; draw(); return; }
    if (k === "zout") { TL.zoom = Math.max(20, TL.zoom / 1.4); TL.sig = ""; draw(); return; }
    if (k === "play") { if (playing()) MD.stop(); else MD.play(f); setTimeout(tick, 30); return; }
    if (k === "poster") { MD.setPoster(f, MD.timeOf(f)); say("Portada: " + r2(MD.posterOf(f)) + " s"); TL.sig = ""; draw(); return; }
    if (k === "key") return addKeyHere(f);
  }

  /* ◆ keyframe en el instante del cabezal: el estado que se ve ahora (movimiento y opacidad) queda como keyframe */
  function addKeyHere(f) {
    var id = selLayerId(); if (!id || selFrame() !== f) { say("Elige una capa de esta lámina para agregarle un keyframe"); return; }
    var T = MD.timeOf(f), A = animOf(f), el = f._root.querySelector('[data-layer-id="' + cssq(id) + '"]'); if (!el) return;
    var cs = getComputedStyle(el), dec = window.MusaDesignCode && window.MusaDesignCode.decompose ? window.MusaDesignCode.decompose(cs.transform) : "translateX(0px) translateY(0px) scale(1) rotate(0deg)";
    var cur = { transform: dec, opacity: String(+cs.opacity) };
    var hit = A ? A.clips.map(function (c, i) { return { c: c, i: i }; }).filter(function (x) { return x.c.layerId === id && (x.c.iterations == null || x.c.iterations === 1) && T >= x.c.startSec - 1e-6 && T <= x.c.endSec + 1e-6; })[0] : null;
    edit(f, function (c) {
      if (hit) {
        var k = c.clips[hit.i], len = Math.max(0.05, k.endSec - k.startSec), lt = r3((T - k.startSec) / len);
        Object.keys(cur).forEach(function (p) {
          var tw = k.tweens.find(function (x) { return x.prop === p; });
          if (!tw) { tw = { prop: p, easing: "ease", keyframes: [{ t: 0, value: cur[p] }, { t: 1, value: cur[p] }] }; k.tweens.push(tw); }
          var ex = tw.keyframes.find(function (x) { return Math.abs(x.t - lt) < 1e-3; });
          if (ex) ex.value = cur[p]; else { tw.keyframes.push({ t: lt, value: cur[p] }); tw.keyframes.sort(function (a, b) { return a.t - b.t; }); }
        });
        TL.sel = { ci: hit.i, kt: lt };
      } else {
        /* sin animación en este instante: una nueva que termina aquí, partiendo del mismo estado (edítalo en el inspector) */
        var s = Math.max(0, r3(T - 0.6));
        c.clips.push({ layerId: id, startSec: s, endSec: r3(Math.max(s + 0.05, T)), tweens: Object.keys(cur).map(function (p) { return { prop: p, easing: "ease-out", keyframes: [{ t: 0, value: cur[p] }, { t: 1, value: cur[p] }] }; }) });
        TL.sel = { ci: c.clips.length - 1, kt: 1 };
      }
    });
    if (!TL.open) toggle(f, true);
    refreshInsp();
    say("Keyframe en " + r2(T) + " s: cambia sus valores en el inspector › Keyframe");
  }
  function delKey() {
    var f = TL.f, s = TL.sel; if (!f || !s || s.kt == null) return;
    var A = animOf(f), k = A && A.clips[s.ci]; if (!k) return;
    if (r3(s.kt) === 0 || r3(s.kt) === 1) { say("El primer y el último keyframe marcan dónde empieza y termina la animación: cambia su duración o quítala"); return; }
    edit(f, function (c) { c.clips[s.ci].tweens.forEach(function (tw) { tw.keyframes = tw.keyframes.filter(function (x) { return Math.abs(x.t - s.kt) > 1e-4; }); }); });
    TL.sel = { ci: s.ci, kt: null }; refreshInsp();
  }

  /* ═════════════ inspector › Animación ═════════════ */
  function refreshInsp() { if (typeof edProps === "function" && ED.open) edProps(); }
  function tfParts(v) { var m = /^translateX\((-?[\d.e-]+)px\) translateY\((-?[\d.e-]+)px\) scale\((-?[\d.e-]+)\) rotate\((-?[\d.e-]+)deg\)$/.exec(String(v || "").trim()); return m ? { x: +m[1], y: +m[2], s: +m[3], r: +m[4] } : null; }
  function keyEditor(f, A, s) {
    var c = A.clips[s.ci]; if (!c) return "";
    var T = r2(c.startSec + s.kt * (c.endSec - c.startSec)), rows = "";
    c.tweens.forEach(function (tw, ti) {
      var k = tw.keyframes.find(function (x) { return Math.abs(x.t - s.kt) < 1e-4; }); if (!k) return;
      var tp = tfParts(k.value), at = 'data-mk="' + ti + '"';
      if (tw.prop === "transform" && tp) rows += '<div class="ed-mh" style="grid-column:1/-1">' + propLbl(tw.prop) + "</div>"
        + [["x", "X (px)"], ["y", "Y (px)"], ["s", "Escala"], ["r", "Giro (°)"]].map(function (q) { return '<label class="ef"><span>' + q[1] + '</span><input type="number" step="' + (q[0] === "s" ? 0.01 : 1) + '" ' + at + ' data-mkp="' + q[0] + '" value="' + r3(tp[q[0]]) + '"></label>'; }).join("");
      else if (tw.prop === "opacity") rows += '<label class="ef full"><span>Opacidad</span><input type="number" min="0" max="1" step="0.05" ' + at + ' value="' + esc(k.value) + '"></label>';
      else if (/color|fill|stroke/i.test(tw.prop) && /^(#|rgb)/.test(String(k.value))) rows += '<label class="ef full"><span>' + esc(propLbl(tw.prop)) + '</span><input type="text" ' + at + ' value="' + esc(k.value) + '" spellcheck="false"></label>';
      else rows += '<label class="ef full"><span>' + esc(propLbl(tw.prop)) + '</span><input type="text" ' + at + ' value="' + esc(k.value) + '" spellcheck="false"></label>';
      if (s.kt < 1 - 1e-4) rows += '<label class="ef full"><span>Curva hasta el siguiente · ' + esc(propLbl(tw.prop)) + "</span>" + easeSel(at + ' data-mke="1"', k.easing || tw.easing) + "</label>";
    });
    return sec("Keyframe · " + T + " s", '<div class="ed-note" style="grid-column:1/-1">' + esc(layerName(f, c.layerId)) + " · " + Math.round(s.kt * 100) + "% de su animación. Arrastra el rombo en la línea de tiempo para cambiar su instante.</div>" + rows
      + '<div class="md-row"><button class="ed-btn" data-ma="delkey"' + (s.kt <= 1e-4 || s.kt >= 1 - 1e-4 ? " disabled" : "") + ">Quitar este keyframe</button></div>", true);
  }
  function animSec(f, id) {
    var A = animOf(f), list = A ? A.clips.map(function (c, i) { return { c: c, i: i }; }).filter(function (x) { return x.c.layerId === id; }) : [];
    var presets = MA.ANIMATION_PRESETS || [], cats = { entrada: "Entrada", salida: "Salida", bucle: "Bucle", reveal: "Revelar" };
    var opts = Object.keys(cats).map(function (k) { var ps = presets.filter(function (p) { return p.category === k; }); return ps.length ? '<optgroup label="' + cats[k] + '">' + ps.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.label) + "</option>"; }).join("") + "</optgroup>" : ""; }).join("");
    var h = list.map(function (x, n) {
      var c = x.c, it = c.iterations == null ? 1 : c.iterations, sel = TL.sel && TL.sel.ci === x.i;
      return '<div class="md-clip' + (sel ? " sel" : "") + '"><b>Animación ' + (n + 1) + " · " + esc(c.tweens.map(function (t) { return propLbl(t.prop); }).join(", ")) + "</b>"
        + '<label class="ef"><span>Empieza (s)</span><input type="number" min="0" step="0.05" data-mac="' + x.i + '" data-maf="start" value="' + r2(c.startSec) + '"></label>'
        + '<label class="ef"><span>Dura (s)</span><input type="number" min="0.05" step="0.05" data-mac="' + x.i + '" data-maf="dur" value="' + r2(c.endSec - c.startSec) + '"></label>'
        + '<label class="ef"><span>Se repite</span><select data-mac="' + x.i + '" data-maf="it">' + [[1, "1 vez"], [2, "2 veces"], [3, "3 veces"], [-1, "Siempre"]].map(function (o) { return '<option value="' + o[0] + '"' + ((it < 0 ? -1 : it) === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + (it > 0 && [1, 2, 3].indexOf(it) < 0 ? '<option value="' + it + '" selected>' + it + " veces</option>" : "") + "</select></label>"
        + '<label class="ef"><span>Dirección</span><select data-mac="' + x.i + '" data-maf="dir">' + [["normal", "Normal"], ["alternate", "Ida y vuelta"], ["reverse", "Al revés"], ["alternate-reverse", "Vuelta e ida"]].map(function (o) { return '<option value="' + o[0] + '"' + ((c.direction || "normal") === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>"
        + '<label class="ef full"><span>Curva</span>' + easeSel('data-mac="' + x.i + '" data-maf="ease"', c.tweens[0] && (c.tweens[0].keyframes[0].easing || c.tweens[0].easing)) + "</label>"
        + '<div class="md-row"><button class="ed-btn" data-ma="see" data-mac="' + x.i + '">Ver en la línea de tiempo</button><button class="ed-btn" data-ma="del" data-mac="' + x.i + '">Quitar</button></div></div>';
    }).join("");
    return sec("Animación" + (list.length ? " · " + list.length : ""),
      (list.length ? h : '<div class="ed-note" style="grid-column:1/-1">Esta capa no se mueve. Agrégale un efecto o un keyframe en el instante actual.</div>')
      + '<label class="ef full"><span>Agregar un efecto</span><select data-ma="preset"><option value="">Elegir…</option>' + opts + "</select></label>"
      + '<div class="md-row"><button class="ed-btn" data-ma="key">◆ Keyframe en el instante actual (' + r2(MD.timeOf(f)) + ' s)</button><button class="ed-btn" data-ma="tl">⏱ Línea de tiempo</button></div>', true);
  }
  var _props = edProps;
  edProps = function () {
    var r = _props.apply(this, arguments);
    try {
      var box = document.querySelector("#edProps"); if (!box || ED.panel !== "props") { refreshBtn(); return r; }
      var old = box.querySelector(".md-anim"); if (old) old.remove();
      var d = curDoc(), f = selFrame(); refreshBtn();
      if (!d || !f || !ED.sel) return r;
      /* la sección «Animación» de la maqueta (no guardaba nada) se reemplaza por la de verdad */
      [].forEach.call(box.querySelectorAll("details.ed-sec"), function (dt) { if (dt.closest(".md-insp,.md-anim")) return; var sm = dt.querySelector("summary"); if (sm && /^Animación/.test(sm.textContent.trim())) dt.remove(); });
      var id = selLayerId(), A = animOf(f), html = "";
      if (TL.sel && A && A.clips[TL.sel.ci] && TL.sel.kt != null && TL.f === f) html += keyEditor(f, A, TL.sel);
      if (id) html += animSec(f, id);
      if (!html) return r;
      var wrap = document.createElement("div"); wrap.className = "md-anim"; wrap.innerHTML = html;
      var ins = box.querySelector(".md-insp");
      if (id) { var first = box.querySelector(".ed-sec:not(.md-insp .ed-sec)"); box.insertBefore(wrap, ins && ins.nextSibling ? ins.nextSibling : first || null); }
      else box.appendChild(wrap);
      if (TL.open) { if (TL.f !== f) { TL.f = f; TL.sel = null; } TL.sig = ""; draw(); }
    } catch (e) { console.warn("[diseño] animación", e); }
    return r;
  };
  function onEdit(e) {
    var el = e.target; if (!el.closest || !el.closest(".md-anim")) return;
    var f = selFrame(); if (!f) return;
    var d = el.dataset;
    if (d.mk != null) {
      if (e.type === "input" && el.type === "number" && el.value === "") return;
      if (e.type === "input" && el.type === "text") return;
      var s = TL.sel; if (!s) return;
      var ti = +d.mk;
      if (typeof snap === "function" && e.type === "change") snap();
      edit(f, function (c) {
        var tw = c.clips[s.ci] && c.clips[s.ci].tweens[ti]; if (!tw) return;
        var k = tw.keyframes.find(function (x) { return Math.abs(x.t - s.kt) < 1e-4; }); if (!k) return;
        if (d.mke) { k.easing = el.value; return; }
        if (d.mkp) { var tp = tfParts(k.value) || { x: 0, y: 0, s: 1, r: 0 }; tp[d.mkp] = parseFloat(el.value) || (d.mkp === "s" ? 1 : 0); k.value = "translateX(" + r3(tp.x) + "px) translateY(" + r3(tp.y) + "px) scale(" + r3(tp.s) + ") rotate(" + r3(tp.r) + "deg)"; return; }
        k.value = String(el.value);
      }, true);
      return;
    }
    if (d.mac != null && d.maf) {
      if (e.type === "input" && el.type === "number" && el.value === "") return;
      if (e.type !== "change" && el.tagName === "SELECT") return;
      var ci = +d.mac, v = el.value;
      if (e.type === "change" && typeof snap === "function") snap();
      edit(f, function (c) {
        var k = c.clips[ci]; if (!k) return;
        var len = k.endSec - k.startSec;
        if (d.maf === "start") { var st = Math.max(0, parseFloat(v) || 0); k.startSec = r3(st); k.endSec = r3(st + len); }
        else if (d.maf === "dur") k.endSec = r3(k.startSec + Math.max(0.05, parseFloat(v) || 0.5));
        else if (d.maf === "it") { var it = parseFloat(v); if (it === 1) delete k.iterations; else k.iterations = it; }
        else if (d.maf === "dir") { if (v === "normal") delete k.direction; else k.direction = v; }
        else if (d.maf === "ease") k.tweens.forEach(function (tw) { tw.easing = v; tw.keyframes.forEach(function (x) { delete x.easing; }); });
      }, true);
      if (e.type === "change") { RB._edx.save(); setTimeout(refreshInsp, 30); }
      return;
    }
    if (d.ma === "preset" && e.type === "change" && el.value) {
      var p = (MA.findPreset && MA.findPreset(el.value)) || null, id = selLayerId(); if (!p || !id) return;
      var T = MD.timeOf(f);
      edit(f, function (c) {
        /* se SUMA a lo que ya tiene la capa (lo que trajo el código no se pierde) */
        c.clips.push({ layerId: id, startSec: r3(T), endSec: r3(T + (p.category === "bucle" ? 2 : 0.8)), tweens: JSON.parse(JSON.stringify(p.tweens)), iterations: p.category === "bucle" ? -1 : undefined });
        TL.sel = { ci: c.clips.length - 1, kt: null };
      });
      say("«" + p.label + "» desde " + r2(T) + " s · ajústala aquí o en la línea de tiempo");
      setTimeout(refreshInsp, 30);
    }
  }
  var PROPS = document.querySelector("#edProps");
  if (PROPS) {
    PROPS.addEventListener("input", onEdit, true);
    PROPS.addEventListener("change", onEdit, true);
    PROPS.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest(".md-anim [data-ma]"); if (!b || b.tagName === "SELECT") return;
      e.preventDefault(); e.stopPropagation();
      var f = selFrame(); if (!f) return;
      var a = b.dataset.ma, ci = b.dataset.mac != null ? +b.dataset.mac : null;
      if (a === "tl") { toggle(f, true); return; }
      if (a === "key") { addKeyHere(f); return; }
      if (a === "delkey") { TL.f = TL.f || f; delKey(); return; }
      if (a === "see" && ci != null) { toggle(f, true); TL.sel = { ci: ci, kt: null }; TL.sig = ""; var A = animOf(f); if (A && A.clips[ci]) MD.view(f, A.clips[ci].startSec); draw(); return; }
      if (a === "del" && ci != null) { edit(f, function (c) { c.clips.splice(ci, 1); }); TL.sel = null; refreshInsp(); say("Animación quitada"); return; }
    }, true);
  }
  /* el cabezal y la lista se ponen al día con cada cambio del editor */
  RB._edHooks.render.push(function () { if (TL.open) { if (!curDoc()) return toggle(null, false); var d = curDoc(); if (TL.f && d.frames.indexOf(TL.f) < 0) TL.f = selFrame() || d.frames[0]; TL.sig = ""; draw(); } refreshBtn(); });
  setInterval(function () { if (TL.open && !ED.open) toggle(null, false); refreshBtn(); }, 1000);

  window.__mdMotion = { toggle: toggle, open: function () { return TL.open; }, sel: function (s) { if (s !== undefined) { TL.sel = s; TL.sig = ""; draw(); refreshInsp(); } return TL.sel; }, addKeyHere: addKeyHere, edit: edit, draw: draw };
})();
