/* bridge-design-live.js — el editor de diseño con tiempo: reloj de la lámina, portada y capas de «código vivo».
 *
 * · Reloj de la lámina: cada frame tiene su animación (frame.animation, el mismo modelo que escribe el MCP con
 *   set_animation: shared/animationSchema.ts → vendor/musa-anim.js) y una PORTADA = el instante que muestran el lienzo,
 *   las miniaturas, PNG/PDF/SVG, el enlace público y el correo. La persona o una IA la cambian cuando quieran.
 *   El lienzo se dibuja en la portada con la Web Animations API en pausa (exacto, sin tocar el HTML guardado).
 * · Capas de código vivo (Three.js, R3F, p5, canvas, gráficos…): el código vive en la capa (data-live) y corre en un
 *   iframe aislado (video-live-core.js, el mismo del editor de video). Se dibuja en su cuadro, se edita directo en el
 *   lienzo (clic en un objeto 3D, arrastrar, agrandar, color, duplicar, quitar), en el inspector (objetos, valores del
 *   código, tiempos) y en su panel de código; TODO se escribe en el código. Su portada queda guardada como imagen
 *   (asset de sistema, se reemplaza en el mismo lugar) para lo que no corre código: miniaturas, PDF, correo.
 */
(function boot(n) {
  "use strict";
  var RB = window.__musaReal, ML = window.MusaVideoLive, DC = window.MusaDesignCode, MA = window.MusaAnim;
  if (!RB || !RB._edx || !RB._edHooks || !ML || !DC || !MA || typeof ED === "undefined") { if ((n || 0) < 800) setTimeout(function () { boot((n || 0) + 1); }, 150); return; }
  if (window.__mdLive) return;
  var X = RB._edx, HK = RB._edHooks;

  /* ═════════════ utilidades ═════════════ */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function cssq(s) { return window.CSS && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, "\\$&"); }
  function r3(v) { var x = Math.round(v * 1000) / 1000; return Object.is(x, -0) ? 0 : x; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function say(m) { if (typeof toast === "function") toast(m); }
  function shortErr(e) { return String(e || "error").split("\n")[0].replace(/^Error:\s*/, "").slice(0, 160); }
  function bridge() { try { return window.parent.__musaBridge; } catch (e) { return null; } }
  function api(url, init) { var b = bridge(); return b ? b.api(url, init) : Promise.reject(new Error("sin conexión")); }
  function kebab(p) { return /^--/.test(p) ? p : String(p).replace(/[A-Z]/g, function (m) { return "-" + m.toLowerCase(); }).replace(/^webkit-/, "-webkit-"); }
  function curDoc() { return ED.open && ED.doc && ED.doc._real ? ED.doc : null; }
  function isLive(n) { return !!(n && n.getAttribute && n.getAttribute("data-layer-kind") === "live" && n.hasAttribute("data-live")); }
  function liveOf(n) { return n ? DC.decLive(n.getAttribute("data-live")) : null; }
  function liveNodes(root) { return root ? [].slice.call(root.querySelectorAll('[data-layer-kind="live"][data-live]')) : []; }
  function frameOf(n) { var d = curDoc(); if (!d || !n) return null; for (var i = 0; i < d.frames.length; i++) { var f = d.frames[i]; if (f._root && f._root.contains(n)) return f; } return null; }
  function selEl() { var d = curDoc(); if (!d || !ED.sel || ED.sel.e == null) return null; var f = d.frames[ED.sel.f], e = f && f.els[ED.sel.e]; return e && e._n ? e._n : null; }
  function selLive() { var x = selEl(); return isLive(x) ? x : null; }
  function selFrame() { var d = curDoc(); return d && ED.sel ? d.frames[ED.sel.f] || null : null; }
  function typing() { var a = document.activeElement; return !!(a && a.closest && a.closest(".md-insp,#mdLiveCode,#mdL3Bar") && /INPUT|TEXTAREA|SELECT/.test(a.tagName)); }
  var lastSnap = { k: null, at: 0 };
  function snapOnce(k) { var now = Date.now(); if (lastSnap.k !== k || now - lastSnap.at > 1500) { if (typeof snap === "function") snap(); } lastSnap = { k: k, at: now }; }

  /* estilos solo del editor (no se guardan) */
  var st = document.createElement("style");
  st.textContent = ""
    + ":where(#edWorld) [data-layer-kind=live]{position:relative}"
    + ":where(#edWorld) [data-live-has]>img[data-live-poster]{visibility:hidden}"
    + "#edWorld .mreal *{transition:none!important}"
    + "[data-live-ui=cv]{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:block}"
    + ".md-sel3{position:absolute;border:calc(1.5px / var(--z,1)) solid #ff5e00;box-shadow:0 0 0 calc(1px / var(--z,1)) rgba(0,0,0,.5);pointer-events:none;z-index:3;box-sizing:border-box}"
    + ".md-sel3 b{position:absolute;left:0;top:calc(-18px / var(--z,1));font:600 calc(11px / var(--z,1))/1.4 Inter,system-ui,sans-serif;background:#ff5e00;color:#fff;padding:0 calc(5px / var(--z,1));border-radius:calc(3px / var(--z,1));white-space:nowrap}"
    + ".md-sel3 i{position:absolute;width:calc(9px / var(--z,1));height:calc(9px / var(--z,1));background:#fff;border:calc(1.5px / var(--z,1)) solid #ff5e00;pointer-events:auto;margin:calc(-5px / var(--z,1)) 0 0 calc(-5px / var(--z,1));box-sizing:border-box}"
    + ".md-sel3 i[data-md3h=nw]{left:0;top:0;cursor:nwse-resize}.md-sel3 i[data-md3h=ne]{left:100%;top:0;cursor:nesw-resize}.md-sel3 i[data-md3h=sw]{left:0;top:100%;cursor:nesw-resize}.md-sel3 i[data-md3h=se]{left:100%;top:100%;cursor:nwse-resize}"
    + ".md-gz{position:absolute;width:calc(14px / var(--z,1));height:calc(14px / var(--z,1));margin:calc(-7px / var(--z,1)) 0 0 calc(-7px / var(--z,1));border-radius:50%;background:radial-gradient(#fff3a8,#ffb800);box-shadow:0 0 0 calc(1.5px / var(--z,1)) rgba(0,0,0,.55);pointer-events:none;z-index:3}"
    + "#mdL3Bar{position:absolute;left:50%;top:12px;transform:translateX(-50%);z-index:30;display:flex;align-items:center;gap:4px;background:rgba(18,18,18,.94);border:1px solid #333;border-radius:10px;padding:5px;color:#eee;font:500 12px/1 Inter,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4);max-width:calc(100% - 24px);flex-wrap:wrap}"
    + "#mdL3Bar[hidden]{display:none}#mdL3Bar button{background:#262626;border:1px solid #3a3a3a;color:#eee;border-radius:7px;height:28px;padding:0 9px;cursor:pointer;font:inherit}#mdL3Bar button:hover{background:#333}"
    + "#mdL3Bar select{background:#262626;color:#eee;border:1px solid #3a3a3a;border-radius:7px;height:28px;max-width:200px;font:inherit}#mdL3Bar .lb-h{padding:0 6px;color:#bbb}#mdL3Bar label{display:flex;align-items:center}#mdL3Bar input[type=color]{width:30px;height:28px;border:0;background:none;padding:0}"
    + ".md-insp .md-film{display:grid;grid-template-columns:repeat(8,1fr);gap:3px;grid-column:1/-1}.md-insp .md-film button{aspect-ratio:1;border:1px solid #333;border-radius:4px;background:#111 center/cover no-repeat;padding:0;cursor:pointer;position:relative}"
    + ".md-insp .md-film button.on{outline:2px solid #ff5e00;outline-offset:1px}.md-insp .md-film button span{position:absolute;left:2px;bottom:1px;font:600 9px/1 Inter,sans-serif;color:#fff;text-shadow:0 0 3px #000}"
    + ".md-insp .md-time{display:flex;gap:6px;align-items:center;grid-column:1/-1}.md-insp .md-time input[type=range]{flex:1;accent-color:#ff5e00}.md-insp .md-time input[type=number]{width:70px}"
    + ".md-insp .md-row{display:flex;gap:6px;flex-wrap:wrap;grid-column:1/-1}.md-insp .md-tag{font-style:normal;color:#ff9b5e;font-size:11px;margin-left:4px}"
    + "#mdLiveCode{position:absolute;left:8px;top:8px;bottom:8px;width:min(520px,46%);z-index:40;display:flex;flex-direction:column;background:#141414;border:1px solid #333;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.5);color:#ddd;font:12px/1.45 'JetBrains Mono',ui-monospace,monospace}"
    + "#mdLiveCode[hidden]{display:none}#mdLiveCode header{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #2a2a2a;font:600 12px/1.2 Inter,system-ui,sans-serif}#mdLiveCode header span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"
    + "#mdLiveCode header button{background:#262626;border:1px solid #3a3a3a;color:#eee;border-radius:6px;height:26px;padding:0 8px;cursor:pointer}#mdLiveCode textarea{flex:1;resize:none;background:#0d0d0d;color:#e6e6e6;border:0;padding:10px;font:inherit;outline:none;white-space:pre;tab-size:2}"
    + "#mdLiveCode footer{padding:6px 10px;border-top:1px solid #2a2a2a;font:11px/1.3 Inter,system-ui,sans-serif;color:#aaa}"
    + "@media (max-width:760px){#mdLiveCode{left:0;right:0;top:auto;bottom:0;width:auto;height:55%;border-radius:12px 12px 0 0}}";
  document.head.appendChild(st);

  /* ═════════════ reloj de la lámina y portada ═════════════ */
  var ACACHE = typeof WeakMap === "function" ? new WeakMap() : null, VIEWT = new WeakMap();
  function animOf(f) {
    var raw = f && f._src ? f._src.animation : null; if (!raw) return null;
    var c = ACACHE && ACACHE.get(f); if (c && c.raw === raw) return c.norm;
    var nm = MA.normalizeAnimation(raw); if (ACACHE) ACACHE.set(f, { raw: raw, norm: nm }); return nm;
  }
  function posterOf(f) { var a = animOf(f); return a ? MA.posterOf(a) : 0; }
  function timeOf(f) { var v = VIEWT.get(f); return v != null ? v : posterOf(f); }
  function presentOf(f) { var a = animOf(f); return (a && a.present && a.present.mode) || "enter"; }
  function hasLive(f) { return !!(f && f._root && f._root.querySelector('[data-layer-kind="live"][data-live]')); }
  function legacyAnims(f) { if (!f || !f._root || !f._root.getAnimations) return []; try { return f._root.getAnimations({ subtree: true }).filter(function (a) { return !a.__md; }); } catch (e) { return []; } }
  function hasMotion(f) { var a = animOf(f); return !!(a && a.clips.length) || hasLive(f) || !!(f && f._root && f._root.querySelector('video[data-layer-kind="video"]')) || legacyAnims(f).length > 0; }
  function durOf(f) {
    var a = animOf(f), d = a && a.clips.length ? a.timeline.durationSec : 0;
    if (a) a.clips.forEach(function (c) { var e = MA.clipEndSec(c); if (isFinite(e)) d = Math.max(d, e); });
    liveNodes(f && f._root).forEach(function (n) { var L = liveOf(n); if (L) d = Math.max(d, (+L.start || 0) + (+L.loop > 0 ? +L.loop : 6)); });
    if (f && f._root) [].forEach.call(f._root.querySelectorAll('video[data-layer-kind="video"][data-video]'), function (v) { var V = vidOf(v); if (V) d = Math.max(d, (+V.start || 0) + (+V.dur || 4)); });
    return Math.max(1, Math.min(600, d || 5));
  }
  /* cambia la animación de la lámina (siempre por el mismo modelo que usa el MCP) */
  function setAnim(f, patch, noSnap) {
    if (!f || !f._src) return;
    if (!noSnap && typeof snap === "function") snap();
    var a = animOf(f) || MA.defaultAnimation(f.w, f.h);
    f._src.animation = MA.normalizeAnimation(Object.assign({}, a, patch));
    applyFrame(f); X.save();
  }
  function setPoster(f, t, noSnap) { VIEWT.delete(f); setAnim(f, { poster: r3(Math.max(0, Math.min(600, +t || 0))) }, noSnap); }

  /* dibuja la lámina en su instante: animaciones del modelo (WAAPI en pausa), CSS heredado y capas vivas */
  function applyFrame(f) {
    if (!f || !f._root) return;
    var t = timeOf(f), A = animOf(f), R = f._root, sx = R.__md || (R.__md = { sig: null, list: [] });
    var sig = A && A.clips.length ? JSON.stringify(A.clips) : "";
    var stale = sx.list.some(function (a) { var tg = a.effect && a.effect.target; return !tg || !R.contains(tg); });
    if (sx.sig !== sig || stale) {
      sx.list.forEach(function (a) { try { a.cancel(); } catch (e) { /* ya no está */ } });
      sx.list = [];
      if (A) MA.compileAnimation(A).forEach(function (ct) {
        var el = R.querySelector('[data-layer-id="' + cssq(ct.layerId) + '"]'); if (!el) return;
        try {
          var an = el.animate(ct.keyframes, { delay: ct.delayMs, duration: ct.durationMs, iterations: ct.iterations || 1, direction: ct.direction || "normal", fill: "both", easing: "linear" });
          an.pause(); an.__md = 1; sx.list.push(an);
        } catch (e) { console.warn("[diseño] animación no válida en", ct.layerId, e && e.message); }
      });
      sx.sig = sig;
    }
    sx.list.forEach(function (a) { try { a.currentTime = t * 1000; } catch (e) { /* idem */ } });
    legacyAnims(f).forEach(function (a) { try { if (a.constructor && a.constructor.name === "CSSTransition") a.finish(); else { a.pause(); a.currentTime = t * 1000; } } catch (e) { /* idem */ } });
    liveNodes(R).forEach(function (nd) { liveWant(nd, f, t); });
    videoNodes(R).forEach(function (v) { seekVideo(v, t); });
  }
  /* ═════════════ capas de video (tomas que llegaron de un video de Musa o de una página) ═════════════
     <video data-layer-kind="video" data-video="…">: { src, start (s de la lámina), in (s del video en ese momento), rate } */
  function videoNodes(root) { return root ? [].slice.call(root.querySelectorAll('video[data-layer-kind="video"][data-video]')) : []; }
  function vidOf(v) { try { var V = JSON.parse(decodeURIComponent(v.getAttribute("data-video"))); return V && typeof V === "object" ? V : null; } catch (e) { return null; } }
  function mediaTime(V, T) { var x = Math.max(0, (+V["in"] || 0) + Math.max(0, (+T || 0) - (+V.start || 0)) * (+V.rate || 1)); return V.dur ? Math.min(x, (+V["in"] || 0) + +V.dur * (+V.rate || 1)) : x; }
  function seekVideo(v, T) {
    var V = vidOf(v); if (!V) return;
    v.muted = true; v.playsInline = true;
    if (!v.paused) try { v.pause(); } catch (e) { /* idem */ }
    var mt = mediaTime(V, T);
    var go = function () { try { if (Math.abs(v.currentTime - mt) > 0.02) v.currentTime = mt; } catch (e) { /* idem */ } };
    if (v.readyState >= 1) go(); else if (!v.__mdw) { v.__mdw = 1; v.preload = "auto"; v.addEventListener("loadedmetadata", function () { v.__mdw = 0; var f = frameOf(v); seekVideo(v, f ? timeOf(f) : T); }, { once: true }); }
  }
  function setVid(v, V) { v.setAttribute("data-video", encodeURIComponent(JSON.stringify(V))); var f = frameOf(v); if (f) applyFrame(f); X.save(); }
  function applyAll() { var d = curDoc(); if (!d) { gcLive(true); return; } d.frames.forEach(applyFrame); gcLive(false); drawSel(); }
  HK.render.push(function () { applyAll(); });

  /* ═════════════ capas vivas: un iframe aislado por capa ═════════════ */
  var LV = new Map(), SEL3 = {}, CAMON = {};
  function keyOf(nd) { var d = curDoc(); return (d ? d._id : "x") + "|" + (nd.getAttribute("data-layer-id") || ""); }
  function sigOf(L) { return ML.hash(JSON.stringify([ML.canon(L.src), L.kind, L.sel, L.fit === "canvas" ? [L.W, L.H] : 0])); }
  function ovOf(L) { return ML.ovOf(L.src) || {}; }
  function viewOf(nd, L) {
    if (L.fit === "canvas") return [Math.max(16, Math.round(+L.W || 1080)), Math.max(16, Math.round(+L.H || 1080))];
    var w = nd.offsetWidth || +L.W || 400, h = nd.offsetHeight || +L.H || 400, k = Math.min(1, 2048 / Math.max(w, h));
    return [Math.max(16, Math.round(w * k)), Math.max(16, Math.round(h * k))];
  }
  function create(key, nd, L, reg) {
    var wh = viewOf(nd, L);
    var I = { key: key, n: nd, L: L, sig: sigOf(L), src0: L.src, tmp: {}, ovs: "", W: wh[0], H: wh[1], st: "load", err: null, last: null, want: null, busy: false, chain: Promise.resolve(), scene: null, boxes: null, used: Date.now() };
    I.ovs = ML.hash(JSON.stringify([ovOf(L), I.tmp]));
    try {
      I.cli = ML.client({ src: ML.runSrc(L), kind: L.kind || "html", sel: L.sel != null ? +L.sel : -1, ov: ovOf(L), W: wh[0], H: wh[1], fps: +L.fps || 30, dur: 30, r3: ML.usesR3(L),
        onScene: function (sc) { I.scene = sc; if (LV.get(I.key) === I && selLive() === I.n) { if (!typing()) refreshInsp(); drawSel(); } },
        onBoxes: function (bx) { I.boxes = bx || {}; if (LV.get(I.key) === I) drawSel(); } });
      I.cli.ready.then(function (s) {
        I.st = "ok"; I.info = s || {}; if (s && s.errors && s.errors.length) I.warn = s.errors[0];
        if (LV.get(I.key) === I) { paint(I); var f = frameOf(I.n); if (f) liveWant(I.n, f, timeOf(f)); if (selLive() === I.n && !typing()) refreshInsp(); }
      }, function (e) { I.st = "err"; I.err = e && e.message; if (LV.get(I.key) === I) { paint(I); if (selLive() === I.n && !typing()) refreshInsp(); } });
    } catch (e) { I.st = "err"; I.err = e.message; I.cli = null; }
    if (reg !== false) LV.set(key, I);
    return I;
  }
  function kill(I) {
    if (!I) return;
    clearTimeout(I.rt);
    if (I.next) { var nx = I.next; I.next = null; kill(nx); }
    try { if (I.cli) I.cli.destroy(); } catch (e) { /* ya no está */ }
    if (I.last && I.last.bmp) try { I.last.bmp.close(); } catch (e) { /* idem */ }
    if (LV.get(I.key) === I) LV.delete(I.key);
  }
  /* el código nuevo se carga en otro iframe y reemplaza al actual cuando está listo (sin parpadeo); mientras tanto el
     actual muestra la vista previa del cambio (I.tmp) */
  function swap(I, N) {
    if (LV.get(I.key) !== I || I.next !== N) { if (LV.get(N.key) !== N) kill(N); return; }
    I.next = null;
    var L = liveOf(I.n); if (!L || sigOf(L) !== N.sig) { kill(N); return; }
    LV.set(I.key, N); N.n = I.n; N.L = L; N.boxes = I.boxes; N.last = I.last; if (N.last) N.last.stale = true; I.last = null;
    if (!N.scene) { N.scene = I.scene; N.sceneOld = true; }
    kill(I);
    var f = frameOf(N.n); if (f) liveWant(N.n, f, timeOf(f));
  }
  var LASTIN = 0;
  function inst(nd) {
    var L = liveOf(nd); if (!L) return null;
    var key = keyOf(nd), I = LV.get(key);
    if (!I) I = create(key, nd, L);
    I.n = nd; I.L = L; I.used = Date.now();
    var sg = sigOf(L);
    if (sg !== I.sig && !I.rt && !(I.next && I.next.sig === sg)) {
      if (I.next) { kill(I.next); I.next = null; }
      I.rt = setTimeout(function () {
        I.rt = null;
        if (LV.get(I.key) !== I) return;
        var cur = liveOf(I.n); if (!cur || sigOf(cur) === I.sig) return;
        if (I.st !== "ok") { var keep = I.last; I.last = null; kill(I); var R = create(I.key, I.n, cur); R.last = keep; if (keep) keep.stale = true; var f0 = frameOf(R.n); if (f0) liveWant(R.n, f0, timeOf(f0)); return; }
        var N = I.next = create(I.key, I.n, cur, false);
        N.cli.ready.then(function () { swap(I, N); }, function () { swap(I, N); });
      }, I.st !== "ok" ? 0 : Date.now() - LASTIN < 1500 ? 700 : 200);
    }
    var wh = viewOf(nd, L);
    if (I.cli && (wh[0] !== I.W || wh[1] !== I.H)) { I.W = wh[0]; I.H = wh[1]; I.cli.resize(wh[0], wh[1]); if (I.last) I.last.stale = true; }
    var os = ML.hash(JSON.stringify([ovOf(L), I.tmp]));
    if (I.cli && os !== I.ovs) { I.ovs = os; I.cli.setOv(Object.assign({}, ovOf(L), I.tmp)); if (I.last) I.last.stale = true; }
    return I;
  }
  function liveWant(nd, f, T) {
    var I = inst(nd); if (!I) return;
    ensureUi(nd);
    var L = I.L, tc = DC.liveTime(L, T), lt = Math.max(0, T - (+L.start || 0));
    /* elegida y sin cajas de sus objetos: se pide el cuadro otra vez con las cajas (para poder agarrarlos en el lienzo) */
    var needBoxes = selLive() === nd && !I.boxes && !PLAY.on;
    if (I.last && !I.last.stale && Math.abs(I.last.tc - tc) < 1e-4 && I.last.ovs === I.ovs && !needBoxes) { paint(I); return; }
    I.want = { tc: tc, lt: lt, T: T, f: f }; pump(I);
  }
  function pump(I) {
    if (I.busy || !I.want || !I.cli || I.st === "err") { paint(I); return; }
    var w = I.want, ovs = I.ovs, bx = selLive() === I.n && !PLAY.on; I.want = null; I.busy = true;
    var pr = I.chain.then(function () { return I.cli.frame(w.tc, { lt: w.lt, scene: !I.scene || I.sceneOld, boxes: bx }); });
    I.chain = pr.catch(function () { /* sigue */ });
    pr.then(function (r) {
      I.busy = false;
      if (r && r.bmp) {
        if (I.last && I.last.bmp && I.last.bmp !== r.bmp) try { I.last.bmp.close(); } catch (e) { /* idem */ }
        I.last = { tc: w.tc, T: w.T, ovs: ovs, bmp: r.bmp, w: r.w, h: r.h }; I.err = null; I.sceneOld = false;
        maybePoster(I, w);
      } else if (r && r.err) I.err = r.err;
      paint(I); pump(I);
    }, function (e) { I.busy = false; I.err = e && e.message || String(e); paint(I); });
  }
  function ensureUi(nd) {
    var cv = nd.querySelector(':scope > canvas[data-live-ui="cv"]');
    if (!cv) { cv = document.createElement("canvas"); cv.setAttribute("data-live-ui", "cv"); cv.setAttribute("aria-hidden", "true"); nd.appendChild(cv); }
    return cv;
  }
  function paint(I) {
    var nd = I.n; if (!nd || !nd.isConnected) return;
    var cv = ensureUi(nd), g = cv.getContext("2d");
    if (I.last && I.last.bmp) {
      if (cv.width !== I.last.w || cv.height !== I.last.h) { cv.width = I.last.w; cv.height = I.last.h; }
      g.clearRect(0, 0, cv.width, cv.height);
      try { g.drawImage(I.last.bmp, 0, 0); } catch (e) { /* cuadro cerrado */ }
      nd.setAttribute("data-live-has", "1");
      return;
    }
    var hasPoster = !!nd.querySelector(':scope > img[data-live-poster][src]');
    if (hasPoster && !(I.st === "err" || I.err)) { nd.removeAttribute("data-live-has"); g.clearRect(0, 0, cv.width, cv.height); return; }
    var w = Math.max(160, nd.offsetWidth || 400), h = Math.max(90, nd.offsetHeight || 300), k = Math.min(1, 640 / w);
    cv.width = Math.round(w * k); cv.height = Math.round(h * k);
    g.fillStyle = "#1b1b1b"; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = I.st === "err" || I.err ? "#ffb07a" : "#9a9a9a"; g.font = "600 " + Math.max(12, Math.round(cv.width / 32)) + "px Inter, system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    var msg = I.st === "err" || I.err ? "⚠ " + shortErr(I.err) : "Cargando el código…";
    wrapText(g, msg, cv.width / 2, cv.height / 2, cv.width * 0.86, Math.max(14, Math.round(cv.width / 26)));
    nd.setAttribute("data-live-has", "1");
  }
  function wrapText(g, text, x, y, maxW, lh) {
    var words = String(text).split(/\s+/), lines = [], cur = "";
    words.forEach(function (w) { var tst = cur ? cur + " " + w : w; if (g.measureText(tst).width > maxW && cur) { lines.push(cur); cur = w; } else cur = tst; });
    if (cur) lines.push(cur);
    lines = lines.slice(0, 4);
    lines.forEach(function (l, i) { g.fillText(l, x, y + (i - (lines.length - 1) / 2) * lh); });
  }
  /* capas que ya no están (otro diseño, se borraron) dejan de correr; hasta 8 a la vez */
  function gcLive(all) {
    var now = Date.now(), alive = [];
    LV.forEach(function (I) {
      if (all || !I.n || (!I.n.isConnected && now - I.used > 20000) || now - I.used > 240000) kill(I);
      else alive.push(I);
    });
    if (alive.length > 8) alive.sort(function (a, b) { return a.used - b.used; }).slice(0, alive.length - 8).forEach(kill);
  }
  setInterval(function () { if (!ED.open && LV.size) gcLive(true); }, 4000);

  /* ═════════════ portada guardada como imagen (lo que ven las miniaturas, el PDF, el correo y el enlace público) ═════════════ */
  var PUP = {};
  function maybePoster(I, w) {
    var f = w.f; if (!f || VIEWT.get(f) != null || PLAY.on) return;
    if (Math.abs(w.T - posterOf(f)) > 1e-3) return;
    var L = I.L, sig = ML.hash(JSON.stringify([ML.canon(L.src), ovOf(L), r3(w.tc), I.W, I.H, L.sel]));
    if (L.poster && L.poster.sig === sig && L.poster.url) return;
    clearTimeout(PUP[I.key]);
    PUP[I.key] = setTimeout(function () { uploadPoster(I, sig, w.tc); }, 1800);
  }
  function uploadPoster(I, sig, tc) {
    var nd = I.n, d = curDoc(); if (!nd || !nd.isConnected || !d || !I.last || !I.last.bmp || LV.get(I.key) !== I) return;
    var k = Math.min(1, 1600 / Math.max(I.last.w, I.last.h)), cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(I.last.w * k)); cv.height = Math.max(1, Math.round(I.last.h * k));
    try { cv.getContext("2d").drawImage(I.last.bmp, 0, 0, cv.width, cv.height); } catch (e) { return; }
    var data; try { data = cv.toDataURL("image/png"); } catch (e) { return; }
    if (data.length > 6.5e6) data = cv.toDataURL("image/jpeg", 0.9);
    var lid = nd.getAttribute("data-layer-id") || "x", aid = "asset_live_" + ML.hash(d._id + "|" + lid) + "_" + ML.hash(lid + "|" + d._id);
    api("/api/assets/upload", { method: "POST", headers: { "Content-Type": "application/json" }, timeoutMs: 60000, body: JSON.stringify({ name: "Portada · " + (nd.getAttribute("data-layer-name") || "código vivo"), data: data, workspaceId: RB.ws, tags: ["musa:sistema", "portada"], replaceAssetId: aid }) })
      .then(function (x) {
        var a = x && (x.data || x), url = a && (a.url || (a.asset && a.asset.url)); if (!url) throw new Error("sin url");
        if (!nd.isConnected || ED.doc !== d) return;
        var L = liveOf(nd); if (!L) return;
        var clean = X.isClean();
        var u = url + (url.indexOf("?") >= 0 ? "&" : "?") + "v=" + sig;
        L.poster = { url: u, at: r3(tc), sig: sig };
        nd.setAttribute("data-live", DC.encLive(L));
        var im = nd.querySelector(":scope > img[data-live-poster]");
        if (!im) { im = document.createElement("img"); im.setAttribute("data-live-poster", ""); im.alt = ""; im.draggable = false; im.style.cssText = "display:block;width:100%;height:100%;object-fit:fill;pointer-events:none"; nd.insertBefore(im, nd.firstChild); }
        im.setAttribute("src", u);
        I.L = L;
        X.saveFresh(clean);
      }).catch(function (e) { console.warn("[código vivo] no se guardó la portada", e && e.message); });
  }

  /* ═════════════ lo que se guarda, se exporta, se presenta y se ve en miniatura ═════════════ */
  HK.serialize.push(function (c, f) {
    c.querySelectorAll("[data-live-has]").forEach(function (x) { x.removeAttribute("data-live-has"); });
    /* el video guardado apunta al cuadro de la portada (#t=): lo que no corre código (miniaturas, enlace público) lo muestra */
    var P = f ? posterOf(f) : 0;
    videoNodes(c).forEach(function (v) { var V = vidOf(v); if (V && V.src) v.setAttribute("src", V.src + "#t=" + r3(mediaTime(V, P))); });
  });
  /* la lámina quieta en su portada, escrita en la copia (html2canvas y las miniaturas no corren animaciones) */
  function freezeAt(root, A, t, live) {
    /* solo dentro de esta copia (un <style> vale para toda la página: sin el selector pausaría todo Musa) */
    var tf = root.getAttribute && root.getAttribute("data-tf"), css = root.querySelector("style[data-md-freeze]");
    if (tf) {
      if (!css) { css = document.createElement("style"); css.setAttribute("data-md-freeze", "1"); root.insertBefore(css, root.firstChild); }
      css.textContent = '.mreal[data-tf="' + cssq(tf) + '"] *{animation-play-state:paused!important;transition:none!important}';
    }
    if (A && A.clips.length) {
      MA.sampleAnimationAt(A, t).forEach(function (sample, lid) {
        var el = root.querySelector('[data-layer-id="' + cssq(lid) + '"]'); if (!el) return;
        Object.keys(sample).forEach(function (p) { if (sample[p] !== "") try { el.style.setProperty(kebab(p), sample[p], "important"); } catch (e) { /* idem */ } });
      });
    }
    /* animaciones CSS que no pasaron por el modelo (diseños viejos): su estado actual en el editor */
    if (live && live.getAnimations) {
      try {
        live.getAnimations({ subtree: true }).forEach(function (a) {
          if (a.__md || !a.effect || !a.effect.target || !a.effect.getKeyframes) return;
          var src = a.effect.target, id = src.getAttribute && src.getAttribute("data-layer-id"); if (!id) return;
          var dst = root.querySelector('[data-layer-id="' + cssq(id) + '"]'); if (!dst) return;
          var cs = getComputedStyle(src), props = {};
          a.effect.getKeyframes().forEach(function (k) { Object.keys(k).forEach(function (p) { if (!/^(offset|computedOffset|easing|composite)$/.test(p)) props[p] = 1; }); });
          Object.keys(props).forEach(function (p) { var v = cs.getPropertyValue(kebab(p)); if (v) dst.style.setProperty(kebab(p), v, "important"); });
          dst.style.setProperty("animation", "none", "important");
        });
      } catch (e) { /* idem */ }
    }
  }
  HK.clone.push(function (c, f, purpose) {
    if (purpose === "present" && window.__mdPresent && window.__mdPresent.owns(f)) return; /* Presentar maneja su propio reloj */
    freezeAt(c, animOf(f), posterOf(f), f._root);
    /* capas vivas: lo que está dibujado en el editor si es la portada; si no, su imagen de portada */
    liveNodes(c).forEach(function (cn) {
      var id = cn.getAttribute("data-layer-id"), I = LV.get((curDoc() ? curDoc()._id : "x") + "|" + id), ov = cn.querySelector('[data-live-ui="cv"]');
      if (ov) ov.remove();
      cn.querySelectorAll("[data-live-ui]").forEach(function (x) { x.remove(); });
      if (I && I.last && I.last.bmp && Math.abs((I.last.T || 0) - posterOf(f)) < 1e-3) {
        try {
          var k = document.createElement("canvas"); k.width = I.last.w; k.height = I.last.h; k.getContext("2d").drawImage(I.last.bmp, 0, 0);
          var im = cn.querySelector("img[data-live-poster]") || document.createElement("img");
          im.setAttribute("data-live-poster", ""); im.src = k.toDataURL("image/png"); im.style.cssText = "display:block;width:100%;height:100%;object-fit:fill;visibility:visible";
          if (!im.parentNode) cn.insertBefore(im, cn.firstChild);
        } catch (e) { /* queda la portada guardada */ }
      }
      cn.removeAttribute("data-live-has");
    });
    /* tomas de video: el cuadro de la portada como imagen (html2canvas no dibuja video) */
    var P = posterOf(f);
    videoNodes(c).forEach(function (cv) {
      var V = vidOf(cv), id = cv.getAttribute("data-layer-id"), live = id && f._root.querySelector('video[data-layer-id="' + cssq(id) + '"]');
      if (V && V.src) cv.setAttribute("src", V.src + "#t=" + r3(mediaTime(V, P)));
      if (!live || live.readyState < 2 || Math.abs(live.currentTime - mediaTime(V || {}, P)) > 0.05) return;
      try {
        var k = document.createElement("canvas"); k.width = live.videoWidth; k.height = live.videoHeight; k.getContext("2d").drawImage(live, 0, 0);
        var im = document.createElement("img"); im.src = k.toDataURL("image/jpeg", 0.92);
        im.setAttribute("style", cv.getAttribute("style") || ""); if (cv.className) im.className = cv.className;
        im.style.objectFit = getComputedStyle(live).objectFit || "cover"; ["data-layer-id", "data-layer-name"].forEach(function (a) { if (cv.getAttribute(a)) im.setAttribute(a, cv.getAttribute(a)); });
        cv.parentNode.replaceChild(im, cv);
      } catch (e) { /* sin permiso para leer el cuadro: queda el video en ese instante */ }
    });
  });
  HK.preview.push(function (root, src) {
    var A0 = src && src.animation ? MA.normalizeAnimation(src.animation) : null, P0 = A0 ? MA.posterOf(A0) : 0;
    freezeAt(root, A0, P0, null);
    videoNodes(root).forEach(function (v) { var V = vidOf(v); if (V && V.src) { v.setAttribute("src", V.src + "#t=" + r3(mediaTime(V, P0))); v.setAttribute("preload", "metadata"); v.muted = true; } });
  });
  /* exportar: la capa viva en la portada exacta aunque estés recorriendo otro instante */
  HK.preShot.push(function (inner) {
    var d = curDoc(), jobs = [];
    liveNodes(inner).forEach(function (cn) {
      var id = cn.getAttribute("data-layer-id"), I = d && LV.get(d._id + "|" + id), f = I && frameOf(I.n);
      if (!I || !I.cli || !f || I.st !== "ok") return;
      var T = posterOf(f), L = I.L, tc = DC.liveTime(L, T);
      if (I.last && !I.last.stale && Math.abs(I.last.tc - tc) < 1e-4) return;
      var pr = I.chain.then(function () { return I.cli.frame(tc, { lt: Math.max(0, T - (+L.start || 0)) }); }).then(function (r) {
        if (!r || !r.bmp) return;
        var k = document.createElement("canvas"); k.width = r.w; k.height = r.h; k.getContext("2d").drawImage(r.bmp, 0, 0); try { r.bmp.close(); } catch (e) { /* idem */ }
        var im = cn.querySelector("img[data-live-poster]") || document.createElement("img"); im.setAttribute("data-live-poster", ""); im.src = k.toDataURL("image/png"); im.style.cssText = "display:block;width:100%;height:100%;object-fit:fill;visibility:visible";
        if (!im.parentNode) cn.insertBefore(im, cn.firstChild);
        var f2 = frameOf(I.n); if (f2) liveWant(I.n, f2, timeOf(f2));
      }, function () { /* queda la portada guardada */ });
      I.chain = pr.catch(function () {});
      jobs.push(pr);
    });
    return Promise.all(jobs);
  });

  /* ═════════════ 3D en el lienzo: elegir, mover, agrandar ═════════════ */
  var LBL = { px: ["Posición X", "Mover X (+)"], py: ["Posición Y", "Mover Y (+)"], pz: ["Posición Z", "Mover Z (+)"], rx: ["Giro X°", "Girar X (+°)"], ry: ["Giro Y°", "Girar Y (+°)"], rz: ["Giro Z°", "Girar Z (+°)"],
    s: ["Escala", "Escala ×"], color: ["Color", "Color"], emi: ["Brillo propio", "Brillo propio"], op: ["Opacidad", "Opacidad ×"], "int": ["Intensidad", "Intensidad ×"], vis: ["Visible", "Visible"], fov: ["Apertura (FOV°)", "Apertura (FOV°)"] };
  var P3 = { cam: ["px", "py", "pz", "rx", "ry", "rz", "fov"], light: ["px", "py", "pz", "color", "int", "vis"], mesh: ["px", "py", "pz", "rx", "ry", "rz", "s", "color", "emi", "op", "vis"], other: ["px", "py", "pz", "rx", "ry", "rz", "s", "vis"] };
  function type3(p) { return p === "color" || p === "emi" ? "color" : p === "vis" ? "bool" : "num"; }
  function colorHex(v) { var t = ML.hex6(v); if (/^#[0-9a-f]{6}$/i.test(t)) return t; if (typeof v === "number") return "#" + ("000000" + v.toString(16)).slice(-6); return "#ffffff"; }
  function def3(pr, rt, sc) { if (pr === "color") return colorHex((rt && rt.color) || "#ffffff"); if (pr === "emi") return "#000000"; if (pr === "vis") return !(rt && rt.vis === false); if (pr === "fov") return sc && sc.cam && sc.cam.fov != null ? sc.cam.fov : 50; return ML.off0(pr); }
  function rtOf(key, sc) {
    var sel = SEL3[key] || "cam";
    if (sel !== "cam" && sc && sc.objs) { var o = sc.objs.find(function (x) { return x.k === sel; }); if (o) return o; }
    return { k: "cam", n: "Cámara", cam: 1, type: sc && sc.cam ? sc.cam.type : "Camera", v: sc && sc.cam ? sc.cam.v : null };
  }
  function coOf(src, rt) {
    if (!rt) return null;
    if (rt.k === "cam") return (rt.v && ML.findObj(src, "v:" + rt.v)) || ML.findObj(src, "cam");
    if (rt.v) { var a = ML.findObj(src, "v:" + rt.v); if (a) return a; }
    return rt.k.indexOf("n:") === 0 ? ML.findObj(src, rt.k) : null;
  }
  function ltOf(nd) { var f = frameOf(nd), L = liveOf(nd); return f && L ? Math.max(0, timeOf(f) - (+L.start || 0)) : 0; }
  function ctx3(nd) { var key = keyOf(nd), I = LV.get(key), sc = I && I.scene, rt = rtOf(key, sc), L = liveOf(nd); return { key: key, I: I, sc: sc, rt: rt, L: L, co: L ? coOf(L.src, rt) : null }; }
  function baseOf(src, co, pr, rt, sc) { var sl = co && co.slots[pr], v = sl ? ML.slotVal(ML.sceneMap(src), pr, sl) : null; return v == null ? def3(pr, rt, sc) : pr === "color" || pr === "emi" ? colorHex(v) : v; }
  function kfAt(ent, lt, val) { var kf = ((ent && ent.kf) || []).map(function (k) { return Object.assign({}, k); }), k = kf.find(function (x) { return Math.abs(x.t - lt) < 0.02; }); if (k) k.v = val; else { kf.push({ t: lt, v: val }); kf.sort(function (a, b) { return a.t - b.t; }); } return { kf: kf }; }
  function get3(nd, pr) {
    var c = ctx3(nd), L = c.L, e = ovOf(L)["o:" + c.rt.k + "|" + pr], sl = c.co && c.co.slots[pr], lt = ltOf(nd);
    if (sl && sl.mode !== "over") return ML.comb3(pr, baseOf(L.src, c.co, pr, c.rt, c.sc), ML.valAt(e, lt, undefined));
    return ML.valAt(e, lt, pr === "color" || pr === "emi" || pr === "vis" || pr === "fov" ? def3(pr, c.rt, c.sc) : ML.off0(pr));
  }
  /* vista previa inmediata sobre el código que ya corre (el código nuevo se carga atrás y lo reemplaza) */
  function preview3(nd, c, pr, val) {
    var I = c.I; if (!I || !c.co) return;
    var o0 = ML.findObj(I.src0, "v:" + c.co.v), sl0 = o0 && o0.slots[pr];
    if (sl0 && sl0.mode === "param") {
      var p0 = ML.analyze(I.src0).params.find(function (x) { return x.key === sl0.key; }); if (!p0 || p0.key.charAt(0) === "v") return;
      var pv = /^r[xyz]$/.test(pr) ? (+val || 0) * Math.PI / 180 : val;
      if (p0.type === "hex" && typeof pv === "string") pv = parseInt(pv.replace("#", ""), 16) || 0;
      I.tmp[sl0.key] = { v: pv }; return;
    }
    var base0 = sl0 && sl0.mode === "code" ? ML.slotVal(ML.sceneMap(I.src0), pr, sl0) : null;
    if (base0 == null) base0 = def3(pr, c.rt, c.sc);
    I.tmp["o:" + c.rt.k + "|" + pr] = { v: ML.toOff3(pr, val, base0) };
  }
  function put3(nd, pr, v) {
    var c = ctx3(nd), L = c.L; if (!L) return;
    var key = "o:" + c.rt.k + "|" + pr, sl = c.co && c.co.slots[pr], ent = ovOf(L)[key], hasKf = !!(ent && ent.kf && ent.kf.length), lt = ltOf(nd);
    LASTIN = Date.now();
    if (sl && sl.mode !== "over") {
      if (hasKf) setSrc(nd, ML.setOv(L.src, key, kfAt(ent, lt, ML.toOff3(pr, v, baseOf(L.src, c.co, pr, c.rt, c.sc)))));
      else { preview3(nd, c, pr, v); setSrc(nd, ML.setOv(ML.set3(L.src, c.co.v, pr, v), key, null)); }
    } else setSrc(nd, ML.setOv(L.src, key, hasKf ? kfAt(ent, lt, v) : { v: v }));
  }
  /* escribir en la capa (el código manda) */
  function setLive(nd, L, why) {
    nd.setAttribute("data-live", DC.encLive(L));
    var f = frameOf(nd); if (f) applyFrame(f);
    cpExternal(nd, why);
    X.save();
  }
  function setSrc(nd, src) { var L = liveOf(nd); if (!L || L.src === src) return; L.src = String(src); setLive(nd, L, "inspector"); }

  function pickBox(I, nx, ny, cur) {
    var best = null, ba = 1e9, bx = I.boxes || {};
    if (cur && bx[cur] && bx[cur].b) { var cb = bx[cur].b; if (nx >= cb[0] - 0.012 && nx <= cb[2] + 0.012 && ny >= cb[1] - 0.012 && ny <= cb[3] + 0.012) return cur; }
    Object.keys(bx).forEach(function (k) {
      var q = bx[k], b = q.b; if (!b) return;
      var a = Math.max(1e-6, (Math.min(1, b[2]) - Math.max(0, b[0])) * (Math.min(1, b[3]) - Math.max(0, b[1])));
      if (q.pts || a > 0.85) return;
      var m = 0.012; if (nx < b[0] - m || nx > b[2] + m || ny < b[1] - m || ny > b[3] + m) return;
      if (a < ba) { ba = a; best = k; }
    });
    return best;
  }
  var DRAG = null;
  function selObj3() {
    var nd = selLive(); if (!nd || PLAY.on) return null;
    var key = keyOf(nd), I = LV.get(key), k = SEL3[key]; if (!I || !k || k === "cam" || !I.boxes || !I.boxes[k] || !I.boxes[k].b) return null;
    return { n: nd, I: I, k: k, key: key, bx: I.boxes[k] };
  }
  function nameOf(I, k) { var o = I.scene && I.scene.objs && I.scene.objs.find(function (x) { return x.k === k; }); return o ? o.n : String(k).replace(/^[nvi]:/, ""); }
  function drawSel() {
    document.querySelectorAll(".md-sel3,.md-gz").forEach(function (x) { x.remove(); });
    drawBar();
    var nd = selLive(); if (!nd || PLAY.on) return;
    var key = keyOf(nd), I = LV.get(key);
    if (I && I.boxes) Object.keys(I.boxes).forEach(function (k) {
      var q = I.boxes[k]; if (!q.gz || !q.b || SEL3[key] === k) return;
      var g = document.createElement("div"); g.className = "md-gz"; g.setAttribute("data-live-ui", "gz"); g.title = nameOf(I, k);
      g.style.left = (q.b[0] + q.b[2]) * 50 + "%"; g.style.top = (q.b[1] + q.b[3]) * 50 + "%"; nd.appendChild(g);
    });
    var s = selObj3(); if (!s) return;
    var b = DRAG && DRAG.k === s.k && DRAG.box ? DRAG.box : s.bx.b;
    var x0 = Math.max(-0.02, b[0]), y0 = Math.max(-0.02, b[1]), x1 = Math.min(1.02, b[2]), y1 = Math.min(1.02, b[3]);
    var el = document.createElement("div"); el.className = "md-sel3"; el.setAttribute("data-live-ui", "sel");
    el.style.cssText = "left:" + x0 * 100 + "%;top:" + y0 * 100 + "%;width:" + Math.max(0.5, (x1 - x0) * 100) + "%;height:" + Math.max(0.5, (y1 - y0) * 100) + "%";
    el.innerHTML = "<b>" + esc(nameOf(s.I, s.k)) + (s.bx.off ? " (fuera de cuadro)" : "") + "</b>" + (s.bx.gz ? "" : '<i data-md3h="nw"></i><i data-md3h="ne"></i><i data-md3h="sw"></i><i data-md3h="se"></i>');
    nd.appendChild(el);
  }
  var BAR = { el: null, sig: "" };
  function barObj() {
    var nd = selLive(); if (!nd || PLAY.on) return null;
    var key = keyOf(nd), I = LV.get(key), k = SEL3[key]; if (!I || !I.scene || !I.scene.objs || !k) return null;
    if (k === "cam") return CAMON[key] ? { n: nd, I: I, key: key, k: "cam", rt: { k: "cam", n: "Cámara", cam: 1 }, bx: (I.boxes && I.boxes.cam) || null } : null;
    var rt = I.scene.objs.find(function (x) { return x.k === k; }); if (!rt) return null;
    return { n: nd, I: I, key: key, k: k, rt: rt, bx: (I.boxes && I.boxes[k]) || null };
  }
  function drawBar() {
    var host = document.querySelector("#edCanvas"); if (!host) return;
    if (!BAR.el) {
      BAR.el = document.createElement("div"); BAR.el.id = "mdL3Bar"; BAR.el.hidden = true; BAR.el.setAttribute("role", "toolbar"); BAR.el.setAttribute("aria-label", "Objeto 3D elegido");
      BAR.el.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      BAR.el.addEventListener("input", function (e) { var nd = selLive(); if (!nd || !e.target.matches || !e.target.matches(".lb-c input") || !barObj() || !/^#[0-9a-f]{6}$/i.test(e.target.value)) return; snapOnce("bar:color"); put3(nd, "color", e.target.value); });
      BAR.el.addEventListener("change", function (e) { var nd = selLive(); if (!nd || !e.target.matches || !e.target.matches("[data-bsel]")) return; var key = keyOf(nd); SEL3[key] = e.target.value || "cam"; CAMON[key] = e.target.value === "cam"; refreshInsp(); drawSel(); });
      BAR.el.addEventListener("click", barClick);
    }
    if (BAR.el.parentNode !== host) host.appendChild(BAR.el);
    var nd = selLive(), I = nd && LV.get(keyOf(nd)), objs = I && I.scene && I.scene.objs;
    if (!nd || !ED.open || PLAY.on || !objs || !objs.length) { BAR.el.hidden = true; BAR.sig = ""; return; }
    BAR.el.hidden = false;
    var s = barObj(), L = liveOf(nd), c = s ? ctx3(nd) : null, rt = s && s.rt;
    var isCam = !!(rt && rt.cam), canCol = !!(rt && (rt.mesh || rt.light)), canSize = !!(rt && !rt.light && !isCam);
    var rem = !!(s && c && ((c.co && ML.addedByMusa(L.src, c.co)) || (!c.co && ML.addedVar(L.src, rt.n))));
    var sig = keyOf(nd) + "|" + (s ? s.k : "") + "|" + canCol + canSize + rem + "|" + objs.map(function (x) { return x.k; }).join(",");
    if (BAR.sig !== sig) {
      BAR.sig = sig;
      var list = '<select data-bsel aria-label="Objeto 3D" title="Elige cualquier objeto de la escena (también luces y fondos)"><option value="">' + (s ? "Soltar" : "Elegir objeto…") + '</option><option value="cam"' + (isCam ? " selected" : "") + ">Cámara</option>"
        + objs.map(function (x) { return '<option value="' + esc(x.k) + '"' + (s && x.k === s.k ? " selected" : "") + ">" + esc(x.n) + (x.light ? " · luz" : "") + "</option>"; }).join("") + "</select>";
      BAR.el.innerHTML = !s ? '<span class="lb-h">Haz clic en un objeto 3D de la capa para moverlo, agrandarlo, cambiarle el color o duplicarlo</span>' + list
        : isCam ? list + '<button type="button" data-b="zin">Acercar</button><button type="button" data-b="zout">Alejar</button><span class="lb-h">Arrastra la capa para mover la cámara</span><button type="button" data-b="x" aria-label="Soltar">×</button>'
        : list + (canCol ? '<label class="lb-c" title="Color"><input type="color" aria-label="Color del objeto"></label>' : "")
          + (canSize ? '<button type="button" data-b="sm" title="Más chico">−</button><button type="button" data-b="lg" title="Más grande">+</button>' : "")
          + '<button type="button" data-b="dup">Duplicar</button><button type="button" data-b="del">' + (rem ? "Quitar" : "Ocultar") + '</button><button type="button" data-b="x" aria-label="Soltar el objeto">×</button>';
    }
    var ci = BAR.el.querySelector(".lb-c input");
    if (ci && document.activeElement !== ci) { try { ci.value = colorHex(get3(nd, "color")); } catch (e) { /* sin color */ } }
  }
  function barClick(e) {
    var bt = e.target.closest && e.target.closest("[data-b]"); if (!bt) return;
    var nd = selLive(), s = barObj(); if (!nd || !s) return;
    var act = bt.dataset.b, L = liveOf(nd), c = ctx3(nd), I = c.I, nm = s.rt.n || nameOf(s.I, s.k);
    if (act === "x") { SEL3[c.key] = "cam"; CAMON[c.key] = false; refreshInsp(); drawSel(); return; }
    if (act === "zin" || act === "zout") { snapOnce("bar:fov"); put3(nd, "fov", Math.max(5, Math.min(140, r2((+get3(nd, "fov") || 50) + (act === "zin" ? -3 : 3))))); refreshInsp(); return; }
    if (act === "sm" || act === "lg") { snapOnce("bar:s"); put3(nd, "s", Math.max(0.02, r2(get3(nd, "s") * (act === "lg" ? 1.1 : 1 / 1.1)))); refreshInsp(); return; }
    if (act === "dup") {
      if (!c.co) { say("«" + nm + "» no está escrito como objeto en el código (viene de un modelo o lo crea un bucle): no lo puedo duplicar desde aquí"); return; }
      var bx = s.bx, del = bx && bx.ux ? [0, 1, 2].map(function (i) { return bx.ux[i] * 0.07 + bx.uy[i] * 0.05; }) : [0.6, 0, 0];
      var r = ML.dupObject(L.src, c.co.v, { pos: bx && bx.p ? bx.p.map(function (v, i) { return v + del[i]; }) : null, delta: del }); if (!r) { say("No pude duplicar «" + nm + "» en el código"); return; }
      if (typeof snap === "function") snap();
      SEL3[c.key] = "n:" + r.name; setSrc(nd, r.src); if (I) I.sceneOld = true;
      say("Dupliqué «" + nm + "» → «" + r.name + "». Arrástralo donde quieras"); setTimeout(refreshInsp, 60); return;
    }
    if (act === "del") {
      var vn = c.co && ML.addedByMusa(L.src, c.co) ? c.co.v : !c.co ? ML.addedVar(L.src, s.rt.n) : null, nsrc = vn ? ML.removeObject(L.src, vn) : null;
      if (typeof snap === "function") snap();
      if (nsrc) { Object.keys(ovOf(L)).forEach(function (k) { if (k.indexOf("o:" + s.k + "|") === 0) nsrc = ML.setOv(nsrc, k, null); }); SEL3[c.key] = "cam"; setSrc(nd, nsrc); if (I) I.sceneOld = true; say("Quité «" + nm + "» del código"); }
      else { put3(nd, "vis", false); say("Oculté «" + nm + "». Para verlo otra vez: elígelo en la lista › Visible"); }
      setTimeout(refreshInsp, 60); drawSel(); return;
    }
  }
  function dragApply() {
    var d = DRAG; if (!d) return; d.raf = 0;
    var e = d.ev; if (!e) return;
    if (selLive() !== d.n || SEL3[d.key] !== d.k) { d.ev = null; return dragEnd(); }
    var dx = e.clientX - d.x0, dy = e.clientY - d.y0, b0 = d.b0;
    if (!d.moved) {
      if (Math.abs(dx) + Math.abs(dy) < 4) return;
      d.moved = true; if (typeof snap === "function") snap();
      d.start = d.mode === "move" || d.mode === "cam" ? { px: +get3(d.n, "px") || 0, py: +get3(d.n, "py") || 0, pz: +get3(d.n, "pz") || 0 } : { s: +get3(d.n, "s") || 1 };
    }
    var r = d.n.getBoundingClientRect();
    if (d.mode === "cam" || d.mode === "move") {
      var nx = dx / r.width, ny = dy / r.height, sg = d.mode === "cam" ? -1 : 1;
      ["px", "py", "pz"].forEach(function (pr, i) { if (!d.bx.ux || Math.abs(d.bx.ux[i]) + Math.abs(d.bx.uy[i]) < 1e-6) return; put3(d.n, pr, r3(d.start[pr] + sg * (nx * d.bx.ux[i] + ny * d.bx.uy[i]))); });
      if (d.mode === "move") d.box = [b0[0] + nx, b0[1] + ny, b0[2] + nx, b0[3] + ny];
    } else {
      var cx = (b0[0] + b0[2]) / 2, cy = (b0[1] + b0[3]) / 2, px = r.left + cx * r.width, py = r.top + cy * r.height;
      var k = Math.max(0.05, Math.min(20, Math.hypot(e.clientX - px, e.clientY - py) / Math.max(8, Math.hypot(d.x0 - px, d.y0 - py))));
      put3(d.n, "s", Math.max(0.02, r3(d.start.s * k)));
      d.box = [cx + (b0[0] - cx) * k, cy + (b0[1] - cy) * k, cx + (b0[2] - cx) * k, cy + (b0[3] - cy) * k];
    }
    drawSel();
  }
  function dragMove(e) { var d = DRAG; if (!d) return; e.preventDefault(); d.ev = e; if (!d.raf) d.raf = requestAnimationFrame(dragApply); }
  function dragEnd(e) {
    var d = DRAG; if (!d) return;
    if (e && e.type === "pointerup" && typeof e.clientX === "number") d.ev = e;
    if (d.raf) cancelAnimationFrame(d.raf);
    if (d.ev) dragApply();
    DRAG = null;
    window.removeEventListener("pointermove", dragMove, true); window.removeEventListener("pointerup", dragEnd, true); window.removeEventListener("pointercancel", dragEnd, true);
    if (d.moved) { var I = LV.get(d.key); if (I && I.boxes && I.boxes[d.k] && d.box) I.boxes[d.k].b = d.box; refreshInsp(); }
    drawSel();
  }
  function dragStart(e, s, mode) {
    DRAG = { mode: mode, n: s.n, key: s.key, k: s.k, bx: s.bx || {}, b0: s.bx && s.bx.b ? s.bx.b.slice() : [0, 0, 1, 1], x0: e.clientX, y0: e.clientY, moved: false, ev: null, raf: 0, box: null };
    window.addEventListener("pointermove", dragMove, true); window.addEventListener("pointerup", dragEnd, true); window.addEventListener("pointercancel", dragEnd, true);
  }
  /* en window y en captura: va antes que mover la capa entera (si agarras un objeto 3D, se mueve ese objeto) */
  window.addEventListener("pointerdown", function (e) {
    if (!ED.open || e.button || !curDoc() || PLAY.on || !e.target || !e.target.closest || !e.target.closest("#edCanvas")) return;
    if (e.target.closest("#mdL3Bar")) return;
    var h = e.target.closest("[data-md3h]"), s0 = selObj3();
    if (h && s0) { e.preventDefault(); e.stopImmediatePropagation(); dragStart(e, s0, "scale"); return; }
    var nd = selLive(); if (!nd || (typeof ED.tool === "string" && ED.tool !== "select" && ED.tool !== "move")) return;
    var r = nd.getBoundingClientRect(); if (!r.width || !r.height || e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    var key = keyOf(nd), I = LV.get(key); if (!I || !I.boxes) return;
    var k = pickBox(I, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, SEL3[key]);
    if (!k && CAMON[key] && SEL3[key] === "cam" && I.boxes.cam) { e.preventDefault(); e.stopImmediatePropagation(); dragStart(e, { n: nd, I: I, key: key, k: "cam", bx: I.boxes.cam }, "cam"); return; }
    if (!k) { if (SEL3[key] && SEL3[key] !== "cam") { SEL3[key] = "cam"; refreshInsp(); drawSel(); } return; }
    e.preventDefault(); e.stopImmediatePropagation();
    CAMON[key] = false;
    if (SEL3[key] !== k) { SEL3[key] = k; refreshInsp(); }
    drawSel();
    dragStart(e, { n: nd, I: I, key: key, k: k, bx: I.boxes[k] }, "move");
  }, true);

  /* ═════════════ inspector ═════════════ */
  function refreshInsp() { if (typeof edProps === "function" && ED.open) edProps(); }
  function fld(attr, label, type, v, opt, tag) {
    opt = opt || {}; var id = "md" + Math.random().toString(36).slice(2, 8), lab = '<span title="' + esc(label) + '">' + esc(label) + (tag || "") + "</span>";
    if (type === "color") return '<label class="ef full">' + lab + '<input type="color" ' + attr + ' value="' + esc(colorHex(v)) + '"></label>';
    if (type === "bool") return '<label class="ef full">' + lab + "<select " + attr + '><option value="1"' + (v ? " selected" : "") + '>Sí</option><option value="0"' + (v ? "" : " selected") + ">No</option></select></label>";
    if (type === "text") return '<label class="ef full">' + lab + '<input type="text" ' + attr + ' value="' + esc(v) + '" spellcheck="false"></label>';
    return '<label class="ef full">' + lab + '<input type="number" id="' + id + '" ' + attr + ' step="' + (opt.step || 0.01) + '"' + (opt.min != null ? ' min="' + opt.min + '"' : "") + (opt.max != null ? ' max="' + opt.max + '"' : "") + ' value="' + esc(typeof v === "number" ? r3(v) : v) + '"></label>';
  }
  function filmHTML(nd, f) {
    var I = LV.get(keyOf(nd)), FM = FILM[keyOf(nd)];
    if (!I || I.st !== "ok") return "";
    var cells = [];
    for (var i = 0; i < 8; i++) {
      var c = FM && FM.cells && FM.cells[i];
      cells.push('<button type="button" data-mdfilm="' + i + '" title="' + (c ? c.T.toFixed(2) + " s" : "") + '"' + (c && c.url ? ' style="background-image:url(' + c.url + ')"' : "") + (c && Math.abs(c.T - timeOf(f)) < 0.02 ? ' class="on"' : "") + "><span>" + (c ? c.T.toFixed(1) : "") + "</span></button>");
    }
    return '<div class="md-film" aria-label="Cuadros del código">' + cells.join("") + "</div>";
  }
  function transSel(A) { var tr = (A && A.present && A.present.transition) || "fade"; return '<label class="ef full"><span>Al pasar a la siguiente lámina</span><select data-md="ptrans">' + [["fade", "Fundido"], ["smart", "Smart Animate (las capas con el mismo nombre viajan)"], ["slide", "Deslizar"], ["push", "Empujar"], ["zoom", "Zoom"], ["none", "Sin transición"]].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === tr ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>"; }
  function posterSec(f, nd) {
    var D = durOf(f), P = posterOf(f), T = timeOf(f), A = animOf(f), mode = presentOf(f), scrub = VIEWT.get(f) != null;
    if (!nd && !hasMotion(f)) return sec("Presentación", transSel(A) + '<div class="ed-note" style="grid-column:1/-1">Smart Animate: si una capa tiene el mismo nombre en esta lámina y en la siguiente, viaja de un lugar al otro al presentar.</div>', false);
    return sec("Portada y presentación",
      '<div class="ed-note" style="grid-column:1/-1">La <b>portada</b> es el instante de la lámina que se ve en el diseño, las miniaturas, el PDF, al compartir y en el correo. Cámbiala cuando quieras (tu IA también puede, por MCP).</div>'
      + '<div class="md-time"><input type="range" min="0" max="' + D + '" step="0.01" value="' + T + '" data-md="scrub" aria-label="Instante de la lámina"><input type="number" min="0" max="' + D + '" step="0.05" value="' + r2(T) + '" data-md="scrubn" aria-label="Segundo"></div>'
      + (nd ? filmHTML(nd, f) : "")
      + '<div class="md-row">' + (scrub ? '<button class="ed-btn pri" data-mdact="usePoster">Usar ' + r2(T) + " s como portada</button>" : '<span class="ed-note" style="margin:0">Portada: <b>' + r2(P) + " s</b></span>")
      + '<button class="ed-btn" data-mdact="autoPoster" title="El primer instante en que se ve todo lo que entra">Elegir automáticamente</button><button class="ed-btn" data-mdact="play">' + (PLAY.on && PLAY.f === f ? "■ Detener" : "▶ Ver la animación") + '</button><button class="ed-btn" data-mdact="timeline">⏱ Línea de tiempo</button></div>'
      + '<label class="ef full"><span>En presentación</span><select data-md="present"><option value="enter"' + (mode === "enter" ? " selected" : "") + '>Se reproduce al entrar y queda en su último cuadro</option><option value="click"' + (mode === "click" ? " selected" : "") + '>Muestra la portada y se reproduce con un clic</option><option value="poster"' + (mode === "poster" ? " selected" : "") + ">Quieta en la portada</option></select></label>"
      + transSel(A)
      + (A && A.clips.length ? '<label class="ef full"><span>Duración de la lámina (s)</span><input type="number" min="0.2" max="600" step="0.1" value="' + r2(A.timeline.durationSec) + '" data-md="dur"></label><div class="ed-note" style="grid-column:1/-1">' + A.clips.length + " animación(es) en " + new Set(A.clips.map(function (c) { return c.layerId; })).size + " capa(s).</div>" : ""), true);
  }
  function liveSecs(nd) {
    var L = liveOf(nd), f = frameOf(nd); if (!L || !f) return "";
    var key = keyOf(nd), I = LV.get(key), an = ML.analyze(String(L.src || "")), lib = ML.LIB_NAMES[an.lib] || "Código";
    var stt = !I ? "Cargando…" : I.st === "err" || I.err ? "⚠ " + esc(shortErr(I.err)) : I.st === "ok" ? "Listo" : "Cargando el código…";
    if (I && I.warn && I.st === "ok") stt += " · aviso del código: " + esc(shortErr(I.warn));
    var cpOn = CP.el && !CP.el.hidden && CP.n === nd, tc = DC.liveTime(L, timeOf(f)), hold = L.hold != null;
    var h = sec("Código vivo · " + esc(lib),
      '<div class="ed-note" style="grid-column:1/-1">' + stt + "</div>"
      + '<div class="md-row"><button class="ed-btn pri" data-mdact="code" aria-pressed="' + (cpOn ? "true" : "false") + '">&lt;/&gt; Código de la capa</button><button class="ed-btn" data-mdact="reload">Recargar</button></div>'
      + '<div class="ed-note" style="grid-column:1/-1">El código manda: lo que cambias aquí, en el lienzo o por MCP se escribe en el código, y lo que escribes en el código aparece aquí. Clic en un objeto 3D de la capa para moverlo o agrandarlo.</div>', true);
    h += sec("Cuadro de esta capa",
      '<div class="ed-note" style="grid-column:1/-1">' + (hold ? "Esta capa se queda en su propio cuadro: el <b>" + r2(+L.hold) + " s</b> de su código, sin importar la portada de la lámina." : "Sigue el reloj de la lámina: en la portada (" + r2(posterOf(f)) + " s) muestra el <b>" + r2(tc) + " s</b> de su código.") + "</div>"
      + filmHTML(nd, f)
      + '<label class="ef full"><span>Cuadro propio (no sigue a la lámina)</span><select data-md="holdOn"><option value="0"' + (hold ? "" : " selected") + '>No</option><option value="1"' + (hold ? " selected" : "") + ">Sí</option></select></label>"
      + (hold ? fld('data-md="hold"', "Segundo del código", "num", +L.hold, { step: 0.05, min: 0 }) : "")
      + fld('data-md="start"', "Empieza en (s de la lámina)", "num", +L.start || 0, { step: 0.1, min: 0 })
      + fld('data-md="off"', "Desde el segundo del código", "num", +L.off || 0, { step: 0.1, min: 0 })
      + fld('data-md="speed"', "Velocidad ×", "num", L.speed != null ? +L.speed : 1, { step: 0.05 })
      + fld('data-md="loop"', "Repetir cada (s · 0 = no)", "num", +L.loop || 0, { step: 0.1, min: 0 }), false);
    var sc = I && I.scene;
    if (an.lib === "three" || an.lib === "three-r3f" || sc) {
      var addOk = (an.lib === "three" || an.lib === "three-r3f") && ML.canAdd(L.src);
      var addRow = addOk ? '<div class="md-row"><select data-md3add aria-label="Objeto para agregar">' + [["box", "Caja"], ["sphere", "Esfera"], ["torus", "Toro"], ["knot", "Nudo"], ["cone", "Cono"], ["cylinder", "Cilindro"], ["icosa", "Icosaedro"], ["plane", "Plano"], ["pointLight", "Luz puntual"], ["dirLight", "Luz direccional"]].map(function (x) { return '<option value="' + x[0] + '">' + x[1] + "</option>"; }).join("") + '</select><button class="ed-btn" data-mdact="add3">＋ Agregar al código</button></div>' : "";
      if (sc && sc.objs) {
        var c = ctx3(nd), rt = c.rt, co = c.co, sel = rt.k, kind = sel === "cam" ? "cam" : rt.light ? "light" : rt.mesh ? "mesh" : "other", ov = ovOf(L), lt = ltOf(nd);
        var opts = '<option value="cam"' + (sel === "cam" ? " selected" : "") + ">Cámara</option>" + sc.objs.map(function (x) { return '<option value="' + esc(x.k) + '"' + (x.k === sel ? " selected" : "") + ">" + new Array(Math.min(6, x.d || 1)).join("· ") + esc(x.n) + (x.n !== x.type ? " · " + esc(x.type) : "") + "</option>"; }).join("");
        var rows = P3[kind].filter(function (pr) { return !((rt.nopos && /^p[xyz]$/.test(pr)) || (pr === "emi" && rt.emi === 0)); }).map(function (pr) {
          var key3 = "o:" + rt.k + "|" + pr, e = ov[key3], sl = co && co.slots[pr], inCode = !!(sl && sl.mode !== "over"), tp = type3(pr);
          var val = inCode ? ML.comb3(pr, baseOf(L.src, co, pr, rt, c.sc), ML.valAt(e, lt, undefined)) : ML.valAt(e, lt, pr === "color" || pr === "emi" || pr === "vis" || pr === "fov" ? def3(pr, rt, c.sc) : ML.off0(pr));
          return fld('data-md3="' + esc(key3) + '"', LBL[pr][inCode ? 0 : 1], tp, val, { step: /^r/.test(pr) || pr === "fov" ? 1 : 0.05 }, inCode ? '<i class="md-tag" title="Se escribe en tu código">&lt;/&gt;</i>' : sl ? '<i class="md-tag" title="Tu código lo calcula en cada cuadro: el ajuste se suma">+</i>' : "");
        }).join("");
        var musaAdded = co && ML.addedByMusa(L.src, co);
        h += sec("Escena 3D · " + sc.objs.length + " objetos", '<label class="ef full"><span>Objeto</span><select data-md3sel>' + opts + "</select></label>" + rows
          + '<div class="md-row">' + (musaAdded ? '<button class="ed-btn" data-mdact="del3">Quitar este objeto del código</button>' : "") + '<button class="ed-btn" data-mdact="scene">Volver a leer la escena</button></div>' + addRow, true);
      } else h += sec("Escena 3D", '<div class="ed-note" style="grid-column:1/-1">' + (I && I.st === "ok" ? "La escena aparece cuando el código dibuja su primer cuadro con Three.js." : "Se lee cuando el código termina de cargar.") + "</div>" + addRow, false);
    }
    var vals = ML.codeValues(L.src).filter(function (x) { return x.via === "value"; });
    if (vals.length) {
      h += sec("Valores del código · " + vals.length, '<div class="ed-note" style="grid-column:1/-1">Cada número, color, sí/no y nombre del código, con su control. Cambiar uno reescribe ese valor en el código.</div>'
        + vals.slice(0, 400).map(function (x) { var opt = x.type === "num" ? { step: x.int ? 1 : Math.abs(x.v) >= 10 ? 1 : Math.abs(x.v) >= 1 ? 0.1 : 0.01 } : {}; return fld('data-mdc="' + x.i + '"', (x.objLabel ? x.objLabel + " · " : "") + x.label, x.type === "text" ? "text" : x.type, x.v, opt, '<i class="md-tag" title="' + esc("En tu código: " + x.code) + '">&lt;/&gt;</i>'); }).join(""), false);
    }
    return h;
  }
  function videoSec(v, f) {
    var V = vidOf(v) || {};
    return sec("Video · toma", '<div class="ed-note" style="grid-column:1/-1">En el diseño se ve quieta en el cuadro de la portada (el <b>' + r2(mediaTime(V, posterOf(f))) + ' s</b> del video) y se reproduce al presentar.</div>'
      + fld('data-mv="start"', "Empieza en (s de la lámina)", "num", +V.start || 0, { step: 0.1, min: 0 })
      + fld('data-mv="in"', "Desde el segundo del video", "num", +V["in"] || 0, { step: 0.1, min: 0 })
      + fld('data-mv="rate"', "Velocidad ×", "num", +V.rate || 1, { step: 0.05, min: 0.1 }), true);
  }
  var OPENS = {};
  var _props = edProps;
  edProps = function () {
    var r = _props.apply(this, arguments);
    try {
      var box = document.querySelector("#edProps"); if (!box || ED.panel !== "props") return r;
      var old = box.querySelector(".md-insp"); if (old) old.remove();
      var d = curDoc(); if (!d || !ED.sel) return r;
      var f = d.frames[ED.sel.f]; if (!f) return r;
      var nd = selLive(), html = "";
      var sv = selEl(), isVid = sv && sv.tagName === "VIDEO" && sv.getAttribute("data-layer-kind") === "video" && vidOf(sv);
      if (nd) html = liveSecs(nd) + posterSec(f, nd);
      else if (isVid) html = videoSec(sv, f) + posterSec(f, null);
      else if (ED.sel.e == null || hasMotion(f)) html = posterSec(f, null);
      if (!html) return r;
      var wrap = document.createElement("div"); wrap.className = "md-insp"; wrap.innerHTML = html;
      [].forEach.call(wrap.querySelectorAll("details.ed-sec"), function (dt) {
        var sm = dt.querySelector("summary"), k = sm ? sm.textContent.split("·")[0].trim() : "";
        if (k in OPENS) dt.open = OPENS[k];
        dt.addEventListener("toggle", function () { OPENS[k] = dt.open; });
      });
      var head = box.querySelector(".ed-ph"), first = head ? head.nextSibling : box.firstChild;
      if (nd) box.insertBefore(wrap, first); else if (ED.sel.e == null) { var secs = box.querySelectorAll(".ed-sec"); box.insertBefore(wrap, secs[1] || null); } else box.appendChild(wrap);
      if (nd) ensureFilm(nd);
    } catch (e) { console.warn("[diseño] inspector", e); }
    return r;
  };

  /* cuadros sueltos del código en OTRO iframe (la tira y la portada automática): el que dibuja la capa no se reinicia
     (el código que se dibuja cuadro a cuadro tendría que volver a empezar cada vez que se pide un instante anterior) */
  function sideFrames(L, W, H, times, each) {
    var cli;
    try { cli = ML.client({ src: ML.runSrc(L), kind: L.kind || "html", sel: L.sel != null ? +L.sel : -1, ov: ovOf(L), W: W, H: H, fps: +L.fps || 30, dur: 30, r3: ML.usesR3(L) }); }
    catch (e) { return Promise.reject(e); }
    var p = cli.ready;
    times.slice().sort(function (a, b) { return a.tc - b.tc; }).forEach(function (x) {
      p = p.then(function () { return cli.frame(x.tc, { lt: x.lt }); }).then(function (r) { if (r && r.bmp) { try { each(x, r); } finally { try { r.bmp.close(); } catch (e) { /* idem */ } } } });
    });
    return p.then(function () { cli.destroy(); }, function (e) { cli.destroy(); throw e; });
  }
  /* tira de cuadros del código (8 instantes de la lámina) */
  var FILM = {};
  function ensureFilm(nd) {
    var key = keyOf(nd), I = LV.get(key), f = frameOf(nd), L = liveOf(nd); if (!I || I.st !== "ok" || !f || !L) return;
    var D = durOf(f), sig = sigOf(L) + "|" + I.ovs + "|" + D + "|" + JSON.stringify([L.start, L.off, L.speed, L.loop, L.hold]);
    var FM = FILM[key]; if (FM && FM.sig === sig) return;
    FM = FILM[key] = { sig: sig, cells: [] };
    var Lh = Object.assign({}, L); delete Lh.hold;
    var times = []; for (var i = 0; i < 8; i++) { var T = r2(D * i / 7); times.push({ i: i, T: T, tc: DC.liveTime(Lh, T), lt: Math.max(0, T - (+L.start || 0)) }); }
    sideFrames(L, I.W, I.H, times, function (x, r) {
      if (FILM[key] !== FM) return;
      var k = document.createElement("canvas"), s = 96 / Math.max(r.w, r.h); k.width = Math.max(1, Math.round(r.w * s)); k.height = Math.max(1, Math.round(r.h * s));
      k.getContext("2d").drawImage(r.bmp, 0, 0, k.width, k.height);
      FM.cells[x.i] = { T: x.T, tc: x.tc, url: k.toDataURL("image/jpeg", 0.7) };
      var b = document.querySelector('.md-insp [data-mdfilm="' + x.i + '"]'); if (b) { b.style.backgroundImage = "url(" + FM.cells[x.i].url + ")"; var sp = b.querySelector("span"); if (sp) sp.textContent = x.T.toFixed(1); b.title = x.T.toFixed(2) + " s de la lámina"; }
    }).catch(function () { if (FILM[key] === FM) delete FILM[key]; });
  }

  /* cambios del inspector */
  function onEdit(e) {
    var el = e.target; if (!el.closest || !el.closest(".md-insp")) return;
    var d = el.dataset, f = selFrame(); if (!f) return;
    var nd = selLive();
    if (d.md === "scrub" || d.md === "scrubn") {
      var t = Math.max(0, parseFloat(el.value) || 0);
      if (e.type === "input" && d.md === "scrub") { VIEWT.set(f, t); applyFrame(f); var tw = el.parentNode.querySelector('[data-md="scrubn"]'); if (tw) tw.value = r2(t); return; }
      if (e.type === "change") { VIEWT.set(f, t); applyFrame(f); refreshInsp(); }
      return;
    }
    if (d.md === "ptrans" && e.type === "change") { var a0 = animOf(f), pr0 = (a0 && a0.present) || { mode: "enter" }; setAnim(f, { present: Object.assign({}, pr0, { transition: el.value }) }); say(el.value === "smart" ? "Smart Animate: ponle el mismo nombre a la capa en las dos láminas y viaja de un lugar a otro" : "Transición guardada"); return; }
    if (d.md === "present" && e.type === "change") { var a1 = animOf(f), pr1 = (a1 && a1.present) || {}; setAnim(f, { present: Object.assign({}, pr1, { mode: el.value }) }); say(el.value === "enter" ? "En presentación: se reproduce al entrar" : el.value === "click" ? "En presentación: portada y se reproduce con un clic" : "En presentación: quieta en la portada"); return; }
    if (d.md === "dur" && e.type === "change") { var a = animOf(f); if (a) setAnim(f, { timeline: Object.assign({}, a.timeline, { durationSec: Math.max(0.2, Math.min(600, parseFloat(el.value) || 5)) }) }); refreshInsp(); return; }
    if (d.mv) {
      var vv = selEl(), V0 = vv && vidOf(vv); if (!V0) return;
      if (e.type === "input" && el.value === "") return;
      snapOnce("mv:" + d.mv);
      var nv = parseFloat(el.value); if (!isFinite(nv)) return;
      if (d.mv === "start") V0.start = Math.max(0, nv); else if (d.mv === "in") V0["in"] = Math.max(0, nv); else V0.rate = Math.max(0.1, nv);
      setVid(vv, V0); return;
    }
    if (!nd) return;
    var L = liveOf(nd); if (!L) return;
    if (/^(holdOn|hold|start|off|speed|loop)$/.test(d.md || "")) {
      if (e.type === "input" && el.type === "number" && el.value === "") return;
      snapOnce("md:" + d.md);
      var v = parseFloat(el.value);
      if (d.md === "holdOn") { if (el.value === "1") L.hold = r3(DC.liveTime(L, timeOf(f))); else delete L.hold; }
      else if (d.md === "hold") L.hold = Math.max(0, isFinite(v) ? v : 0);
      else if (d.md === "start") L.start = Math.max(0, isFinite(v) ? v : 0);
      else if (d.md === "off") L.off = Math.max(0, isFinite(v) ? v : 0);
      else if (d.md === "speed") L.speed = isFinite(v) ? v : 1;
      else if (d.md === "loop") { if (v > 0) L.loop = v; else delete L.loop; }
      setLive(nd, L, "inspector");
      if (e.type === "change") refreshInsp();
      return;
    }
    if (d.mdc != null) {
      var it = ML.codeValues(L.src)[+d.mdc]; if (!it) return;
      if (it.type === "text" && e.type !== "change") return;
      if (e.type === "input" && el.type === "number" && el.value === "") return;
      var cv = it.type === "num" ? parseFloat(el.value) : it.type === "bool" ? el.value === "1" : el.value;
      if (it.type === "num" && !isFinite(cv)) return;
      snapOnce("mdc" + d.mdc); LASTIN = Date.now();
      var ns = ML.setCodeValue(L.src, +d.mdc, cv); if (ns === L.src) return;
      setSrc(nd, ns);
      if (it.type === "text") { var I0 = LV.get(keyOf(nd)); if (I0) I0.sceneOld = true; setTimeout(refreshInsp, 80); }
      return;
    }
    if (d.md3) {
      var pr = d.md3.slice(d.md3.lastIndexOf("|") + 1), tp = type3(pr);
      if (e.type === "input" && el.type === "number" && el.value === "") return;
      snapOnce(d.md3);
      var v3 = tp === "num" ? (parseFloat(el.value) || 0) : tp === "bool" ? el.value === "1" : el.value;
      put3(nd, pr, v3); return;
    }
    if (d.md3sel != null && e.type === "change") { SEL3[keyOf(nd)] = el.value; CAMON[keyOf(nd)] = el.value === "cam"; refreshInsp(); drawSel(); }
  }
  var PROPS = document.querySelector("#edProps");
  if (PROPS) {
    PROPS.addEventListener("input", onEdit, true);
    PROPS.addEventListener("change", onEdit, true);
    PROPS.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest(".md-insp [data-mdact], .md-insp [data-mdfilm]"); if (!b) return;
      e.preventDefault(); e.stopPropagation();
      var f = selFrame(); if (!f) return;
      var nd = selLive();
      if (b.dataset.mdfilm != null && nd) {
        var FM = FILM[keyOf(nd)], cell = FM && FM.cells[+b.dataset.mdfilm]; if (!cell) return;
        var L = liveOf(nd);
        if (L && L.hold != null) { snapOnce("md:hold"); var Lh = Object.assign({}, L); delete Lh.hold; L.hold = r3(DC.liveTime(Lh, cell.T)); setLive(nd, L, "inspector"); refreshInsp(); }
        else { VIEWT.set(f, cell.T); applyFrame(f); refreshInsp(); }
        return;
      }
      var act = b.dataset.mdact, I = nd && LV.get(keyOf(nd));
      if (act === "usePoster") { setPoster(f, timeOf(f)); say("Portada: " + r2(posterOf(f)) + " s"); refreshInsp(); return; }
      if (act === "autoPoster") { autoPoster(f).then(function (t) { setPoster(f, t); say("Portada elegida: " + r2(t) + " s"); refreshInsp(); }); return; }
      if (act === "play") { if (PLAY.on) stopPlay(); else playFrame(f); refreshInsp(); return; }
      if (act === "timeline") { if (window.__mdMotion) window.__mdMotion.toggle(f, true); return; }
      if (!nd) return;
      if (act === "code") { if (CP.el && !CP.el.hidden && CP.n === nd) cpClose(); else cpOpen(nd); refreshInsp(); return; }
      if (act === "reload") { if (I) kill(I); applyFrame(f); setTimeout(refreshInsp, 60); return; }
      if (act === "scene") { if (I) { I.scene = null; if (I.cli) I.cli.scene(); } applyFrame(f); return; }
      var L2 = liveOf(nd); if (!L2) return;
      if (act === "add3") {
        var ty = (b.parentNode.querySelector("[data-md3add]") || {}).value || "box", r = ML.addObject(L2.src, { type: ty });
        if (!r) { say("No encontré la escena (new THREE.Scene() o el lienzo de R3F) en el código para agregar el objeto"); return; }
        if (typeof snap === "function") snap();
        SEL3[keyOf(nd)] = "n:" + r.name; setSrc(nd, r.src); if (I) I.scene = null;
        say("«" + r.name + "» quedó en tu código: se edita aquí, en el lienzo y en el código"); setTimeout(refreshInsp, 60); return;
      }
      if (act === "del3") {
        var c = ctx3(nd), nsrc = c.co ? ML.removeObject(L2.src, c.co.v) : null; if (!nsrc) return;
        if (typeof snap === "function") snap();
        Object.keys(ovOf(L2)).forEach(function (k) { if (k.indexOf("o:" + c.rt.k + "|") === 0) nsrc = ML.setOv(nsrc, k, null); });
        SEL3[keyOf(nd)] = "cam"; setSrc(nd, nsrc); if (I) I.scene = null; say("Quité «" + (c.rt.n || c.co.v) + "» del código"); setTimeout(refreshInsp, 60); return;
      }
    }, true);
  }

  /* ═════════════ portada automática y vista previa de la animación ═════════════ */
  function canvasScore(src) {
    try {
      var k = document.createElement("canvas"); k.width = 24; k.height = 24; var g = k.getContext("2d"); g.drawImage(src, 0, 0, 24, 24);
      var d = g.getImageData(0, 0, 24, 24).data, sum = 0, sq = 0, vis = 0, edge = 0, prev = null;
      for (var i = 0; i < d.length; i += 4) { var l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * (d[i + 3] / 255); sum += l; sq += l * l; if (d[i + 3] > 20) vis++; if (prev != null && (i / 4) % 24) edge += Math.abs(l - prev); prev = l; }
      var mean = sum / 576; return Math.sqrt(Math.max(0, sq / 576 - mean * mean)) + edge / 576 + vis / 576 * 10;
    } catch (e) { return null; }
  }
  /* el primer instante en que se ve todo lo que entra (y, si solo hay 3D, el cuadro con más contenido) */
  function autoPoster(f) {
    var A = animOf(f);
    if (A && A.clips.length) {
      var R = f._root, D = durOf(f), N = Math.min(240, Math.max(20, Math.round(D * 30))), ids = {}, best = 0, mx = 0, sc = [];
      A.clips.forEach(function (c) { ids[c.layerId] = 1; });
      var els = Object.keys(ids).map(function (id) { return R.querySelector('[data-layer-id="' + cssq(id) + '"]'); }).filter(Boolean);
      /* misma regla que al importar: cuando terminó de entrar todo; si al final algo sale, el primer instante en que se veía
         todo. El tamaño de cada capa cuenta hasta su tamaño final (un rebote que agranda de más no adelanta la portada). */
      var keep = VIEWT.get(f), rec = els.map(function () { return []; });
      for (var i = 0; i <= N; i++) {
        var t = D * i / N; VIEWT.set(f, t); applyFrame(f);
        els.forEach(function (el, k) { var cs = getComputedStyle(el), r = el.getBoundingClientRect(), on = cs.visibility !== "hidden" && cs.display !== "none"; rec[k].push([on ? Math.min(1, +cs.opacity) : 0, r.width * r.height]); });
        sc.push([t, 0]);
      }
      if (keep != null) VIEWT.set(f, keep); else VIEWT.delete(f);
      applyFrame(f);
      rec.forEach(function (v) { var rest = v[v.length - 1][1]; v.forEach(function (e, q) { sc[q][1] += e[0] * Math.min(e[1], rest || e[1]); }); });
      sc.forEach(function (x) { mx = Math.max(mx, x[1]); });
      var fin = A.clips.reduce(function (m, c) { var e = MA.clipEndSec(c); return isFinite(e) ? Math.max(m, e) : m; }, 0), qe = 0;
      for (var q3 = 0; q3 < sc.length; q3++) if (sc[q3][0] <= fin + 1e-6) qe = q3;
      if (fin > 0 && mx > 0 && sc[qe][1] >= mx * 0.9) return Promise.resolve(r3(Math.min(fin, D)));
      for (var j = 0; j < sc.length; j++) if (sc[j][1] >= mx * 0.98) { best = sc[j][0]; break; }
      return Promise.resolve(r3(best));
    }
    var nd = liveNodes(f._root)[0], I = nd && inst(nd);
    if (!I) return Promise.resolve(0);
    var L = I.L, D2 = Math.min(durOf(f), 8), out = [], times = [];
    for (var q = 0; q <= 12; q++) { var T = D2 * q / 12; times.push({ T: T, tc: DC.liveTime(L, T), lt: Math.max(0, T - (+L.start || 0)) }); }
    say("Buscando el mejor cuadro del código…");
    return sideFrames(L, I.W, I.H, times, function (x, r) { var s2 = canvasScore(r.bmp); out.push([x.T, s2 == null ? 0 : s2]); }).then(function () {
      out.sort(function (a, b) { return a[0] - b[0]; });
      var m = Math.max.apply(null, out.map(function (x) { return x[1]; }).concat([0]));
      for (var k = 0; k < out.length; k++) if (out[k][1] >= m * 0.95) return r3(out[k][0]);
      return 0;
    }, function () { return 0; });
  }
  var PLAY = { on: false, f: null, raf: 0, t0: 0 };
  function playFrame(f) {
    stopPlay(); PLAY.on = true; PLAY.f = f; PLAY.t0 = performance.now();
    var D = durOf(f);
    (function tick() {
      if (!PLAY.on || PLAY.f !== f) return;
      var t = (performance.now() - PLAY.t0) / 1000;
      if (t > D) { stopPlay(); refreshInsp(); return; }
      VIEWT.set(f, t); applyFrame(f);
      PLAY.raf = requestAnimationFrame(tick);
    })();
    drawSel();
  }
  function stopPlay() { if (!PLAY.on) return; cancelAnimationFrame(PLAY.raf); var f = PLAY.f; PLAY.on = false; PLAY.f = null; if (f) { VIEWT.delete(f); applyFrame(f); } drawSel(); }

  /* ═════════════ código de la capa: panel al lado, en vivo en los dos sentidos ═════════════ */
  var CP = { el: null, n: null, ta: null, st: null, dirty: false, t: null };
  function cpBuild() {
    if (CP.el) return;
    var host = document.querySelector("#edCanvas"); if (!host) return;
    CP.el = document.createElement("section"); CP.el.id = "mdLiveCode"; CP.el.hidden = true; CP.el.setAttribute("aria-label", "Código de la capa");
    CP.el.innerHTML = '<header><span>&lt;/&gt; Código de la capa</span><button type="button" data-cp="apply">Aplicar</button><button type="button" data-cp="close" aria-label="Cerrar">×</button></header><textarea spellcheck="false" aria-label="Código"></textarea><footer>Se aplica solo al dejar de escribir (Ctrl+Enter aplica ya). Lo que cambias en el lienzo o el inspector aparece aquí.</footer>';
    host.appendChild(CP.el);
    CP.ta = CP.el.querySelector("textarea"); CP.st = CP.el.querySelector("footer");
    CP.el.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    CP.el.addEventListener("keydown", function (e) { e.stopPropagation(); if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); cpApply(true); } });
    CP.ta.addEventListener("input", function () { CP.dirty = true; clearTimeout(CP.t); CP.st.textContent = "Escribiendo…"; CP.t = setTimeout(function () { cpApply(false); }, 900); });
    CP.el.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest("[data-cp]"); if (!b) return; if (b.dataset.cp === "close") cpClose(); else cpApply(true); });
  }
  function cpOpen(nd) { cpBuild(); if (!CP.el) return; CP.n = nd; CP.dirty = false; var L = liveOf(nd); CP.ta.value = L ? L.src : ""; CP.el.hidden = false; CP.st.textContent = "Listo · " + (nd.getAttribute("data-layer-name") || "capa viva"); }
  function cpClose() { if (!CP.el) return; if (CP.dirty) cpApply(true); CP.el.hidden = true; CP.n = null; refreshInsp(); }
  function cpApply(force) {
    clearTimeout(CP.t); if (!CP.n || !CP.dirty) return;
    var nd = CP.n, L = liveOf(nd); if (!L || !nd.isConnected) { CP.dirty = false; return; }
    var src = CP.ta.value; CP.dirty = false;
    if (src === L.src) { CP.st.textContent = "Sin cambios"; return; }
    if (typeof snap === "function") snap();
    L.src = src; LASTIN = Date.now();
    nd.setAttribute("data-live", DC.encLive(L));
    var f = frameOf(nd); if (f) applyFrame(f);
    X.save(); CP.st.textContent = "Aplicado " + new Date().toLocaleTimeString().slice(0, 5);
    setTimeout(refreshInsp, 120);
  }
  function cpExternal(nd, why) { if (!CP.el || CP.el.hidden || CP.n !== nd || CP.dirty) return; var L = liveOf(nd); if (L && CP.ta.value !== L.src) { var p = CP.ta.selectionStart; CP.ta.value = L.src; try { CP.ta.selectionStart = CP.ta.selectionEnd = Math.min(p, L.src.length); } catch (e) { /* idem */ } CP.st.textContent = "Actualizado desde " + (why || "el editor"); } }
  /* al elegir otra capa o cerrar el editor, el panel se cierra */
  setInterval(function () { if (CP.el && !CP.el.hidden && (!ED.open || !CP.n || !CP.n.isConnected || selLive() !== CP.n)) { if (CP.dirty) cpApply(true); CP.el.hidden = true; CP.n = null; } if (BAR.el && !BAR.el.hidden && !selLive()) drawBar(); }, 700);

  /* ═════════════ Presentar: la lámina se reproduce (decisión 2026-11-16) ═════════════
     enter = se reproduce al entrar y queda en su último cuadro (el 3D y lo que se repite siguen vivos) · click = muestra la
     portada y se reproduce con el primer «siguiente» · poster = quieta en la portada. Al pasar a la siguiente: fundido,
     Smart Animate (las capas con el mismo nombre viajan a su lugar en la lámina nueva), deslizar, empujar, zoom o nada. */
  var stPz = document.createElement("style");
  stPz.textContent = ".ed-pres .pz-st>div{grid-area:1/1}";
  document.head.appendChild(stPz);
  var PZ = { f: null, el: null, mode: null, played: false, raf: 0, t0: 0, anims: [], lives: [], pcli: {} };
  function pzClient(orig, L) {
    var key = keyOf(orig) + "|pz", sg = sigOf(L), wh = viewOf(orig, L), c = PZ.pcli[key];
    if (c && c.sig === sg && c.W === wh[0] && c.H === wh[1]) return c;
    if (c) try { c.cli.destroy(); } catch (e) { /* idem */ }
    c = PZ.pcli[key] = { sig: sg, W: wh[0], H: wh[1], busy: false, want: null, cli: null };
    try { c.cli = ML.client({ src: ML.runSrc(L), kind: L.kind || "html", sel: L.sel != null ? +L.sel : -1, ov: ovOf(L), W: wh[0], H: wh[1], fps: +L.fps || 30, dur: 30, r3: ML.usesR3(L) }); } catch (e) { c.cli = null; }
    return c;
  }
  function pzLive(x, T) {
    var pc = x.pc; if (!pc || !pc.cli) return;
    pc.want = { tc: DC.liveTime(x.L, T), lt: Math.max(0, T - (+x.L.start || 0)), x: x };
    if (pc.busy) return;
    var w = pc.want; pc.want = null; pc.busy = true;
    pc.cli.frame(w.tc, { lt: w.lt }).then(function (r) {
      pc.busy = false;
      if (r && r.bmp) {
        if (PZ.lives.indexOf(w.x) >= 0) {
          var cv = w.x.cv; if (cv.width !== r.w || cv.height !== r.h) { cv.width = r.w; cv.height = r.h; }
          var g = cv.getContext("2d"); g.clearRect(0, 0, cv.width, cv.height); g.drawImage(r.bmp, 0, 0);
          if (w.x.img) w.x.img.style.visibility = "hidden";
        }
        try { r.bmp.close(); } catch (e) { /* idem */ }
      }
      if (pc.want && PZ.lives.indexOf(pc.want.x) >= 0) { var nx = pc.want; pc.want = null; pzLive(nx.x, PZ.T); }
    }, function () { pc.busy = false; });
  }
  function pzSet(t) {
    PZ.T = t;
    PZ.anims.forEach(function (a) { try { a.currentTime = t * 1000; } catch (e) { /* idem */ } });
    PZ.lives.forEach(function (x) { pzLive(x, x.L.hold != null ? 0 : t); });
    (PZ.vids || []).forEach(function (x) {
      var V = x.V, v = x.v, on = PZ.played && t >= (+V.start || 0) && (!V.dur || t < (+V.start || 0) + +V.dur);
      if (on) { if (v.paused && !x.starting) { x.starting = true; try { v.currentTime = mediaTime(V, t); } catch (e) { /* idem */ } v.playbackRate = +V.rate || 1; var pr = v.play(); if (pr && pr.then) pr.then(function () { x.starting = false; }, function () { x.starting = false; }); else x.starting = false; } }
      else { if (!v.paused) v.pause(); var mt = mediaTime(V, PZ.played ? t : posterOf(PZ.f)); if (Math.abs(v.currentTime - mt) > 0.05) try { v.currentTime = mt; } catch (e) { /* idem */ } }
    });
  }
  function pzTick() { if (!PZ.f) return; pzSet((performance.now() - PZ.t0) / 1000); PZ.raf = requestAnimationFrame(pzTick); }
  function pzStop(keep) {
    cancelAnimationFrame(PZ.raf); PZ.raf = 0;
    PZ.anims.forEach(function (a) { try { a.cancel(); } catch (e) { /* idem */ } });
    (PZ.vids || []).forEach(function (x) { try { x.v.pause(); } catch (e) { /* idem */ } });
    PZ.anims = []; PZ.lives = []; PZ.vids = []; PZ.f = null; PZ.el = null;
    if (!keep) { Object.keys(PZ.pcli).forEach(function (k) { try { PZ.pcli[k].cli.destroy(); } catch (e) { /* idem */ } }); PZ.pcli = {}; }
  }
  function pzPlay() { PZ.played = true; PZ.t0 = performance.now(); cancelAnimationFrame(PZ.raf); pzTick(); }
  function pzEnter(f, el) {
    pzStop(true);
    PZ.f = f; PZ.el = el; PZ.mode = presentOf(f); PZ.played = false;
    var root = el.querySelector(".mreal") || el, A = animOf(f);
    if (A && A.clips.length) MA.compileAnimation(A).forEach(function (ct) {
      var t = root.querySelector('[data-layer-id="' + cssq(ct.layerId) + '"]'); if (!t) return;
      try { var a = t.animate(ct.keyframes, { delay: ct.delayMs, duration: ct.durationMs, iterations: ct.iterations || 1, direction: ct.direction || "normal", fill: "both", easing: "linear" }); a.pause(); PZ.anims.push(a); } catch (e) { /* valor no válido */ }
    });
    liveNodes(root).forEach(function (cn) {
      var id = cn.getAttribute("data-layer-id"), orig = f._root && f._root.querySelector('[data-layer-id="' + cssq(id) + '"]'), L = liveOf(cn);
      if (!L || !orig) return;
      [].forEach.call(cn.querySelectorAll("[data-live-ui]"), function (u) { if (u.tagName !== "CANVAS") u.remove(); });
      var cv = cn.querySelector('canvas[data-live-ui="cv"]');
      if (!cv) { cv = document.createElement("canvas"); cv.setAttribute("data-live-ui", "cv"); cn.appendChild(cv); }
      cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:block";
      if (getComputedStyle(cn).position === "static") cn.style.position = "relative";
      PZ.lives.push({ cn: cn, cv: cv, img: cn.querySelector("img[data-live-poster]"), L: L, pc: pzClient(orig, L) });
    });
    PZ.vids = videoNodes(root).map(function (v) { var V = vidOf(v); if (!V) return null; v.muted = true; v.playsInline = true; v.preload = "auto"; if (V.src && v.getAttribute("src") !== V.src) v.setAttribute("src", V.src); return { v: v, V: V }; }).filter(Boolean);
    var moving = (A && A.clips.length) || PZ.lives.length || PZ.vids.length || legacyAnims(f).length;
    if (PZ.mode === "enter" && moving) pzPlay();
    else pzSet(posterOf(f));
    /* calienta la siguiente lámina (su código 3D ya cargado al llegar) */
    var d = curDoc(), nx = d && d.frames[d.frames.indexOf(f) + 1];
    if (nx && nx._root) liveNodes(nx._root).forEach(function (n2) { var L2 = liveOf(n2); if (L2) pzClient(n2, L2); });
  }
  /* transición entre láminas: la define la lámina que se deja (present.transition) */
  function pzTransition(prevF, f, prev, el, dir, s) {
    var pr = (prevF && animOf(prevF) && animOf(prevF).present) || {}, type = pr.transition || "fade", sec = pr.transitionSec || (type === "smart" ? 0.6 : 0.35);
    var ms = Math.round(sec * 1000), ease = "cubic-bezier(0.22, 1, 0.36, 1)";
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) type = "fade";
    prev.style.zIndex = "0"; el.style.zIndex = "1";
    var done = function () { if (prev.parentNode) prev.remove(); };
    var go = function (a) { if (a && a.finished) a.finished.then(done, done); else setTimeout(done, ms + 50); };
    if (type === "none") return done();
    if (type === "slide") { prev.animate([{ opacity: 1 }, { opacity: 0.4 }], { duration: ms, easing: ease, fill: "forwards" }); return go(el.animate([{ transform: "translateX(" + dir * 100 + "%)" }, { transform: "none" }], { duration: ms, easing: ease })); }
    if (type === "push") { prev.animate([{ transform: "none" }, { transform: "translateX(" + -dir * 100 + "%)" }], { duration: ms, easing: ease, fill: "forwards" }); return go(el.animate([{ transform: "translateX(" + dir * 100 + "%)" }, { transform: "none" }], { duration: ms, easing: ease })); }
    if (type === "zoom") { prev.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(1.08)" }], { duration: ms, easing: ease, fill: "forwards" }); return go(el.animate([{ opacity: 0, transform: "scale(0.92)" }, { opacity: 1, transform: "none" }], { duration: ms, easing: ease })); }
    if (type === "smart") {
      /* Smart Animate: cada capa con el mismo nombre en las dos láminas viaja de su lugar anterior al nuevo (FLIP);
         lo que no estaba aparece con un fundido y lo que se va se desvanece */
      var named = function (box) { var m = {}, dup = {}; [].forEach.call(box.querySelectorAll("[data-layer-name]"), function (n) { var k = n.getAttribute("data-layer-name"); if (!k || n.closest('[data-layer-kind="live"]') !== n && n.closest('[data-layer-kind="live"]')) return; if (m[k]) dup[k] = 1; else m[k] = n; }); Object.keys(dup).forEach(function (k) { delete m[k]; }); return m; };
      var A0 = named(prev), B0 = named(el), hit = 0;
      Object.keys(B0).forEach(function (k) {
        var a = A0[k], b = B0[k]; if (!a) return;
        if (b.parentElement && b.parentElement.closest("[data-layer-name]") && B0[b.parentElement.closest("[data-layer-name]").getAttribute("data-layer-name")] && A0[b.parentElement.closest("[data-layer-name]").getAttribute("data-layer-name")]) return; /* el padre ya viaja */
        var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); if (!rb.width || !rb.height) return;
        var dx = (ra.left - rb.left) / s, dy = (ra.top - rb.top) / s, sx = ra.width / rb.width, sy = ra.height / rb.height;
        try { b.animate([{ transform: "translate(" + dx + "px," + dy + "px) scale(" + sx + "," + sy + ")", transformOrigin: "0 0", opacity: +getComputedStyle(a).opacity }, { transform: "translate(0,0) scale(1,1)", transformOrigin: "0 0" }], { duration: ms, easing: ease, composite: "add" }); hit++; a.style.visibility = "hidden"; } catch (e) { /* idem */ }
      });
      prev.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: ease, fill: "forwards" });
      return go(el.animate([{ opacity: hit ? 0.35 : 0 }, { opacity: 1 }], { duration: ms, easing: ease }));
    }
    prev.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: ease, fill: "forwards" });
    return go(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: ease }));
  }
  window.__mdPresent = {
    owns: function () { return true; },
    enter: function (f, el) { try { pzEnter(f, el); } catch (e) { console.warn("[presentar]", e); } },
    advance: function () { if (PZ.f && PZ.mode === "click" && !PZ.played && hasMotion(PZ.f)) { pzPlay(); return true; } return false; },
    transition: function (prevF, f, prev, el, dir, s) { try { pzTransition(prevF, f, prev, el, dir, s); } catch (e) { if (prev.parentNode) prev.remove(); } },
    stop: function () { pzStop(false); var d = curDoc(); if (d) d.frames.forEach(function (f) { liveNodes(f._root).forEach(function (n) { var I = LV.get(keyOf(n)); if (I && I.last) I.last.stale = true; }); applyFrame(f); }); },
    state: function () { return PZ.f ? { mode: PZ.mode, played: PZ.played, T: PZ.T || 0, anims: PZ.anims.length, lives: PZ.lives.length } : null; },
  };

  /* ═════════════ API para el importador, Presentar, pruebas y el MCP del navegador ═════════════ */
  window.__mdLive = {
    animOf: animOf, posterOf: posterOf, timeOf: timeOf, durOf: durOf, presentOf: presentOf, hasMotion: hasMotion, setPoster: setPoster, setAnim: setAnim, applyFrame: applyFrame, applyAll: applyAll,
    autoPoster: autoPoster, play: playFrame, stop: stopPlay, freezeAt: freezeAt, __playing: function () { return PLAY.on; },
    view: function (f, t) { if (t == null) VIEWT.delete(f); else VIEWT.set(f, +t); applyFrame(f); },
    status: function (layerId) { var d = curDoc(), I = d && LV.get(d._id + "|" + layerId); return I ? { st: I.st, err: I.err || null, warn: I.warn || null, has: !!(I.last && I.last.bmp), tc: I.last ? I.last.tc : null, w: I.last ? I.last.w : 0, h: I.last ? I.last.h : 0, scene: I.scene, boxes: I.boxes, W: I.W, H: I.H, pending: !!(I.rt || I.next) } : null; },
    sel3: function (layerId, k) { var d = curDoc(), key = (d ? d._id : "x") + "|" + layerId; if (k !== undefined) { SEL3[key] = k; refreshInsp(); drawSel(); } return SEL3[key] || null; },
    pick: function (layerId, nx, ny) { var d = curDoc(), I = d && LV.get(d._id + "|" + layerId); return I ? pickBox(I, nx, ny) : null; },
    get3: function (nd, pr) { return get3(nd, pr); }, put3: function (nd, pr, v) { return put3(nd, pr, v); },
    liveOf: liveOf, setSrc: setSrc, setLive: setLive, codeOpen: cpOpen, frameOf: frameOf,
    count: function () { return LV.size; },
  };
  /* el diseño abierto antes de que cargara este módulo: se dibuja ya con su reloj */
  if (curDoc()) applyAll();
})();
