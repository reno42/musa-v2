/* design-player.js — reproduce una lámina de Musa exportada como HTML (Musa Design Code) en cualquier navegador, igual
 * que «Presentar» en Musa: su animación (frame.animation, en <script id="musa-animation">) según su modo de presentación
 * (al entrar / con un clic / quieta en su portada), sus tomas de video y sus capas de código vivo (3D, canvas).
 * Sin este archivo la lámina se ve en su portada; con él, se mueve. Carga el resto desde el mismo sitio de Musa.
 */
(function () {
  "use strict";
  var me = document.currentScript, base = me && me.src ? me.src.replace(/[^/]*$/, "") : "/musa/";
  function load(src, g) { if (window[g]) return Promise.resolve(window[g]); return new Promise(function (ok, ko) { var s = document.createElement("script"); s.src = base + src; s.onload = function () { ok(window[g]); }; s.onerror = function () { ko(new Error("no cargó " + src)); }; document.head.appendChild(s); }); }
  function qid(id) { return '[data-layer-id="' + String(id).replace(/"/g, "") + '"]'; }
  function vidOf(v) { try { return JSON.parse(decodeURIComponent(v.getAttribute("data-video"))); } catch (e) { return null; } }
  function mtime(V, t) { return Math.max(0, (+V["in"] || 0) + Math.max(0, t - (+V.start || 0)) * (+V.rate || 1)); }
  var raw = document.getElementById("musa-animation"), A0 = null;
  try { A0 = raw ? JSON.parse(raw.textContent) : null; } catch (e) { A0 = null; }
  load("vendor/musa-anim.js", "MusaAnim").then(function (MA) {
    var A = A0 ? MA.normalizeAnimation(A0) : null, poster = A ? MA.posterOf(A) : 0, mode = (A && A.present && A.present.mode) || "enter";
    var anims = [], played = false, t0 = 0, lives = [], raf = 0;
    if (A) MA.compileAnimation(A).forEach(function (c) {
      var el = document.querySelector(qid(c.layerId)); if (!el || !el.animate) return;
      try { var a = el.animate(c.keyframes, { delay: c.delayMs, duration: c.durationMs, iterations: c.iterations || 1, direction: c.direction || "normal", fill: "both" }); a.pause(); anims.push(a); } catch (e) { /* valor no válido */ }
    });
    /* lo que el HTML trae escrito para verse quieto (portada) deja de mandar: ahora manda la animación */
    var pst = document.getElementById("musa-poster"); if (pst && A && A.clips.length) pst.remove();
    var still = document.createElement("style"); still.textContent = "[data-layer-id]{transition:none}"; document.head.appendChild(still);
    var vids = [].slice.call(document.querySelectorAll('video[data-layer-kind="video"][data-video]')).map(function (v) { var V = vidOf(v); if (!V) return null; v.muted = true; v.playsInline = true; v.preload = "auto"; if (V.src) v.src = V.src; return { v: v, V: V }; }).filter(Boolean);
    function seek(t) { anims.forEach(function (a) { try { a.pause(); a.currentTime = t * 1000; } catch (e) { /* idem */ } }); vids.forEach(function (x) { try { x.v.pause(); x.v.currentTime = mtime(x.V, t); } catch (e) { /* idem */ } }); }
    function play() {
      played = true; t0 = performance.now();
      anims.forEach(function (a) { try { a.currentTime = 0; a.play(); } catch (e) { /* idem */ } });
      vids.forEach(function (x) { try { x.v.pause(); x.v.currentTime = +x.V["in"] || 0; } catch (e) { /* idem */ } setTimeout(function () { x.v.playbackRate = +x.V.rate || 1; var p = x.v.play(); if (p && p.catch) p.catch(function () {}); }, Math.max(0, (+x.V.start || 0) * 1000)); });
    }
    var nodes = document.querySelectorAll('[data-layer-kind="live"][data-live]');
    if (nodes.length) Promise.all([load("video-live-core.js", "MusaVideoLive"), load("design-code-core.js", "MusaDesignCode")]).then(function () {
      var ML = window.MusaVideoLive, DC = window.MusaDesignCode;
      [].forEach.call(nodes, function (n) {
        var L = DC.decLive(n.getAttribute("data-live")); if (!L) return;
        var w = n.offsetWidth || L.W || 400, h = n.offsetHeight || L.H || 400, W = L.fit === "canvas" ? L.W : Math.round(w), Hh = L.fit === "canvas" ? L.H : Math.round(h);
        var cv = document.createElement("canvas"); cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
        if (getComputedStyle(n).position === "static") n.style.position = "relative"; n.appendChild(cv);
        try { lives.push({ n: n, cv: cv, L: L, busy: false, cli: ML.client({ src: ML.runSrc(L), kind: L.kind || "html", sel: L.sel != null ? +L.sel : -1, ov: ML.ovOf(L.src) || {}, W: W, H: Hh, fps: 30, dur: 30, r3: ML.usesR3(L) }) }); } catch (e) { /* esta capa queda en su portada */ }
      });
      (function tick() {
        var t = played ? (performance.now() - t0) / 1000 : poster;
        lives.forEach(function (x) {
          if (x.busy) return; x.busy = true;
          x.cli.frame(DC.liveTime(x.L, t), { lt: Math.max(0, t - (+x.L.start || 0)) }).then(function (fr) {
            x.busy = false; if (!fr || !fr.bmp) return;
            if (x.cv.width !== fr.w || x.cv.height !== fr.h) { x.cv.width = fr.w; x.cv.height = fr.h; }
            x.cv.getContext("2d").drawImage(fr.bmp, 0, 0); try { fr.bmp.close(); } catch (e) { /* idem */ }
            var im = x.n.querySelector("img[data-live-poster]"); if (im) im.style.visibility = "hidden";
          }, function () { x.busy = false; });
        });
        raf = requestAnimationFrame(tick);
      })();
    }, function () { /* sin red: queda la portada */ });
    if (mode === "enter") play(); else seek(poster);
    if (mode === "click") document.addEventListener("click", function once() { document.removeEventListener("click", once); play(); });
    /* el visor que la contiene (el HTML de todo el diseño) la reproduce desde 0 al llegar a ella */
    window.addEventListener("message", function (e) { if (e.data && e.data.musaPlay) { if (mode === "poster") seek(poster); else if (e.data.musaPlay === "enter" || mode === "enter") play(); else seek(poster); } });
    window.__musaPlayer = { play: play, seek: seek, poster: poster, mode: mode };
  }, function () { /* sin red: la lámina queda en su portada */ });
})();
