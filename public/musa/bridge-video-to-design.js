/* bridge-video-to-design.js — «Llevar a diseño» desde el editor de video (decisiones del usuario, 2026-11-16):
 *  · la PORTADA de la lámina es el cuadro donde está el cabezal; se ajusta en el mismo panel (el escenario del video
 *    muestra el cuadro exacto mientras eliges) y la persona o una IA la vuelven a cambiar cuando quieran en el diseño;
 *  · viaja la ESCENA donde está el cabezal (entre cortes), así la lámina reproduce esa escena al presentar; también
 *    «todo el video» o «solo este cuadro» (quieto).
 * Cómo: el video ES código (Musa Video Code: HTML + GSAP con tomas y clips vivos). Ese código corre una vez en el
 * espacio aislado (design-code-core.js) en el tramo elegido y vuelve como lámina: textos y formas como capas, su
 * movimiento como animación de la lámina, los clips 3D como capas de código vivo (con su propio código y sus tiempos) y
 * las tomas como capas de video (quietas en la portada, se reproducen al presentar).
 */
(function boot(n) {
  "use strict";
  var RB = window.__musaReal, DC = window.MusaDesignCode, ML = window.MusaVideoLive, MA = window.MusaAnim;
  if (!RB || !DC || !ML || !MA || !RB._edx || typeof VE === "undefined" || typeof veSeek !== "function") { if ((n || 0) < 1200) setTimeout(function () { boot((n || 0) + 1); }, 200); return; }
  if (window.__vtd) return;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function r2(v) { return Math.round(v * 100) / 100; }
  function r3(v) { return Math.round(v * 1000) / 1000; }
  function bridge() { try { return window.parent.__musaBridge; } catch (e) { return null; } }
  function api(url, init) { var b = bridge(); return b ? b.api(url, init) : Promise.reject(new Error("sin conexión")); }
  function say(m) { if (typeof vtoast === "function" && VE.open) vtoast(m); else if (typeof toast === "function") toast(m); }
  function fmtWH() { try { var f = VFMT[(VE.p && VE.p.fmt) || "9:16"]; return [f[0], f[1]]; } catch (e) { return [1080, 1920]; } }
  function dur() { try { return veDur(VE.p); } catch (e) { return 10; } }
  /* la escena donde está el cabezal: el clip de la pista principal (V1) que lo contiene, entre sus cortes */
  function sceneAt(t) {
    /* cortes = clips de la pista principal (V1); si no hay, los clips a pantalla completa (un 3D o una escena que ocupa todo) */
    var p = VE.p, cs = ((p && p.v1) || []).slice();
    if (!cs.length) cs = ((p && p.m) || []).filter(function (c) { return (+c.w || 0) >= 99.9 && !c.hideM; });
    cs = cs.slice().sort(function (a, b) { return a.start - b.start; });
    var c = cs.find(function (x) { return t >= x.start - 1e-6 && t < x.start + x.dur - 1e-6; });
    if (c) return [r3(c.start), r3(c.start + c.dur)];
    var prev = cs.filter(function (x) { return x.start + x.dur <= t + 1e-6; }).pop(), next = cs.find(function (x) { return x.start > t; });
    return [r3(prev ? prev.start + prev.dur : 0), r3(next ? next.start : dur())];
  }

  /* ═════════════ el código del video → una lámina (lo usa el panel y el MCP al abrir el diseño) ═════════════ */
  function parseBaked(html) {
    var d = new DOMParser().parseFromString(html, "text/html"), css = [];
    [].forEach.call(d.querySelectorAll("link[rel~=stylesheet][href]"), function (l) { css.push("@import url('" + l.getAttribute("href").replace(/'/g, "%27") + "');"); });
    [].forEach.call(d.querySelectorAll("style"), function (s) { css.push(s.textContent); s.remove(); });
    return { css: css.join("\n"), html: d.body.innerHTML };
  }
  RB.videoCodeToFrame = function (code, o) {
    o = o || {};
    var W = Math.round(+o.w || 1080), H = Math.round(+o.h || 1920), t0 = Math.max(0, +o.t0 || 0), t1 = Math.max(t0 + 0.05, +o.t1 || t0 + 5), at = Math.max(t0, Math.min(t1, o.at != null ? +o.at : t0)), still = !!o.still;
    var range = still ? { t0: at, t1: at + 1 / 30 } : { t0: t0, t1: t1 };
    return DC.bake(code, { size: { w: W, h: H }, keepSize: true, range: range, snapAt: at, fps: still ? 30 : (t1 - t0 > 20 ? 15 : 30), maxDur: 600, pseudo: false, title: o.name || "", timeoutMs: 240000, onProgress: o.onProgress })
      .then(function (r) {
        var pb = parseBaked(r.html), A0 = r.animation || { clips: [] };
        var html = pb.html;
        if (still) {
          /* solo el cuadro: las capas vivas y los videos quedan en ese instante */
          var box = document.createElement("div"); box.innerHTML = html;
          [].forEach.call(box.querySelectorAll('[data-layer-kind="live"][data-live]'), function (nd) { var L = DC.decLive(nd.getAttribute("data-live")); if (L) { L.hold = r3(DC.liveTime(L, 0)); nd.setAttribute("data-live", DC.encLive(L)); } });
          html = box.innerHTML;
        }
        var anim = MA.normalizeAnimation({
          timeline: { durationSec: still ? 1 : Math.max(0.5, r3(t1 - t0)), fps: 30, width: W, height: H, loop: "once" },
          clips: still ? [] : A0.clips || [], transitions: [],
          poster: still ? 0 : r3(at - t0), present: { mode: still ? "poster" : "enter" },
        });
        return { src: { name: o.name || "Desde el video", width: W, height: H, background: r.bg || "#000000", html: html, css: pb.css, animation: anim }, stats: r.stats || {}, warnings: r.warnings || [] };
      });
  };

  /* ═════════════ panel en el editor de video ═════════════ */
  var css = document.createElement("style");
  css.textContent = "#vtdPanel{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:9000;width:min(560px,calc(100vw - 24px));background:#151515;border:1px solid #333;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.55);color:#e8e8e8;font:13px/1.4 Inter,system-ui,sans-serif;padding:14px 16px;display:grid;gap:10px}"
    + "#vtdPanel[hidden]{display:none}#vtdPanel h3{margin:0;font:700 15px/1.2 Inter,system-ui,sans-serif;display:flex;align-items:center;gap:8px}#vtdPanel h3 span{flex:1}#vtdPanel p{margin:0;color:#aaa;font-size:12px}"
    + "#vtdPanel .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}#vtdPanel label{display:grid;gap:4px;font-size:12px;color:#bbb;flex:1;min-width:150px}#vtdPanel select{background:#222;color:#eee;border:1px solid #3a3a3a;border-radius:8px;height:32px;padding:0 8px}"
    + "#vtdPanel input[type=range]{flex:1;accent-color:#ff5e00}#vtdPanel .t{font-variant-numeric:tabular-nums;min-width:110px;text-align:right;color:#fff;font-weight:600}"
    + "#vtdPanel button{background:#262626;border:1px solid #3a3a3a;color:#eee;border-radius:8px;height:32px;padding:0 12px;cursor:pointer;font:inherit}#vtdPanel button.pri{background:#ff5e00;border-color:#ff5e00;color:#fff;font-weight:700}#vtdPanel button:hover{filter:brightness(1.1)}"
    + "#vtdPanel .strip{position:relative;height:30px;border-radius:6px;background:#202020;border:1px solid #2f2f2f;overflow:hidden}#vtdPanel .strip i{position:absolute;top:0;bottom:0;background:rgba(255,94,0,.22);border-left:2px solid #ff5e00;border-right:2px solid #ff5e00}#vtdPanel .strip b{position:absolute;top:0;bottom:0;width:2px;background:#fff}#vtdPanel .strip em{position:absolute;top:0;bottom:0;width:1px;background:#555}";
  document.head.appendChild(css);
  var P = { el: null, t: 0, part: "scene" };
  function panel() {
    if (P.el) return P.el;
    P.el = document.createElement("section"); P.el.id = "vtdPanel"; P.el.hidden = true; P.el.setAttribute("role", "dialog"); P.el.setAttribute("aria-label", "Llevar a diseño");
    document.body.appendChild(P.el);
    P.el.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    P.el.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Escape") close(); if (e.key === "ArrowLeft" || e.key === "ArrowRight") { if (e.target.tagName === "SELECT") return; e.preventDefault(); step(e.key === "ArrowLeft" ? -1 : 1); } });
    P.el.addEventListener("input", function (e) { if (e.target.matches("[data-vtd=t]")) { P.t = +e.target.value; veSeek(P.t); paint(); } });
    P.el.addEventListener("change", function (e) { if (e.target.matches("[data-vtd=part]")) { P.part = e.target.value; paint(true); } });
    P.el.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-vtda]"); if (!b) return;
      var a = b.dataset.vtda;
      if (a === "close") return close();
      if (a === "prev") return step(-1);
      if (a === "next") return step(1);
      if (a === "go") return run();
    });
    return P.el;
  }
  function range() { var D = dur(); if (P.part === "all") return [0, r3(D)]; if (P.part === "still") return [P.t, P.t]; return sceneAt(P.t); }
  function step(k) { var fps = (VE.p && VE.p.fps) || 30, D = dur(); P.t = r3(Math.max(0, Math.min(D, P.t + k / fps))); veSeek(P.t); paint(); }
  function paint(full) {
    var el = panel(), D = Math.max(0.05, dur()), rg = range();
    if (full || !el.firstChild) {
      var designs = (RB.tpl || []).slice(0, 80);
      el.innerHTML = '<h3><span>Llevar a diseño</span><button type="button" data-vtda="close" aria-label="Cerrar">×</button></h3>'
        + "<p>El cuadro que elijas es la <b>portada</b> de la lámina: lo que se ve quieto en el diseño, las miniaturas y el PDF. Mientras mueves, el video muestra ese cuadro. Después la cambias cuando quieras en el diseño.</p>"
        + '<div class="row"><label>Qué viaja a la lámina<select data-vtd="part"><option value="scene"' + (P.part === "scene" ? " selected" : "") + '>La escena donde está el cabezal (se reproduce al presentar)</option><option value="all"' + (P.part === "all" ? " selected" : "") + '>Todo el video</option><option value="still"' + (P.part === "still" ? " selected" : "") + ">Solo este cuadro (quieto)</option></select></label>"
        + '<label>Dónde<select data-vtd="dest"><option value="new">Diseño nuevo</option>' + designs.map(function (d) { return '<option value="' + esc(d.id) + '">' + esc(d.name || "Diseño") + "</option>"; }).join("") + "</select></label></div>"
        + '<div class="strip" aria-hidden="true"></div>'
        + '<div class="row"><button type="button" data-vtda="prev" aria-label="Cuadro anterior">◀</button><input type="range" data-vtd="t" min="0" step="' + (1 / ((VE.p && VE.p.fps) || 30)) + '" aria-label="Cuadro de la portada"><button type="button" data-vtda="next" aria-label="Cuadro siguiente">▶</button><span class="t"></span></div>'
        + '<div class="row" style="justify-content:flex-end"><button type="button" data-vtda="close">Cancelar</button><button type="button" class="pri" data-vtda="go">Llevar a diseño</button></div>';
    }
    var tIn = el.querySelector("[data-vtd=t]"); tIn.max = String(r3(D)); if (document.activeElement !== tIn) tIn.value = String(P.t);
    var strip = el.querySelector(".strip"), cuts = ((VE.p && VE.p.v1) || []).map(function (c) { return c.start; });
    strip.innerHTML = cuts.map(function (c) { return '<em style="left:' + (c / D * 100) + '%"></em>'; }).join("") + (P.part === "still" ? "" : '<i style="left:' + (rg[0] / D * 100) + "%;width:" + Math.max(0.5, (rg[1] - rg[0]) / D * 100) + '%"></i>') + '<b style="left:' + (P.t / D * 100) + '%"></b>';
    el.querySelector(".t").textContent = "Portada " + r2(P.t).toFixed(2) + " s" + (P.part === "still" ? "" : " · " + r2(rg[0]) + "–" + r2(rg[1]) + " s");
  }
  function open() {
    if (!VE.open || !VE.p) return;
    if (VE.playing && typeof veStop === "function") veStop();
    P.t = r3(VE.t || 0); P.part = "scene";
    paint(true); P.el.hidden = false;
    var b = P.el.querySelector("[data-vtd=t]"); if (b) try { b.focus({ preventScroll: true }); } catch (e) { /* idem */ }
  }
  function close() { if (P.el) P.el.hidden = true; }
  function run() {
    var p = VE.p; if (!p || !window.__veCode) return;
    var dest = (P.el.querySelector("[data-vtd=dest]") || {}).value || "new", rg = range(), wh = fmtWH(), still = P.part === "still", at = P.t;
    var name = (p.name || (p._real && p._real.name) || "Video") + (still ? " · cuadro " + r2(at) + " s" : " · " + r2(rg[0]) + "–" + r2(rg[1]) + " s");
    close();
    var pg = RB.progress("Llevando el video a diseño", "Armando el código del video…"), code;
    try { code = window.__veCode.code("html"); } catch (e) { pg.close(); return RB.notice("No se pudo leer el video", String(e && e.message || e)); }
    pg.set(8, "Corriendo la escena en un espacio aislado (sin acceso a Musa)…");
    var res = null;
    RB.videoCodeToFrame(code, { w: wh[0], h: wh[1], t0: rg[0], t1: rg[1], at: at, still: still, name: name, onProgress: function (f) { pg.set(8 + Math.round(f * 60), "Leyendo cada capa y su movimiento… " + Math.round(f * 100) + " %"); } })
      .then(function (r) {
        res = r; pg.set(72, "Preparando el diseño…");
        if (dest !== "new") return dest;
        return api("/api/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name, workspaceId: RB.ws, engine: "html", initialFrame: false }) }).then(function (x) { var id = (x && x.data && x.data.id) || (x && x.id); if (!id) throw new Error("no se pudo crear el diseño"); return id; });
      })
      .then(function (id) {
        pg.set(82, "Abriendo el diseño…");
        RB.openDesign(id);
        return new Promise(function (ok, ko) {
          var k = 0, iv = setInterval(function () {
            if (ED.open && ED.doc && ED.doc._real && ED.doc._id === id) { clearInterval(iv); ok(id); }
            else if (++k > 150) { clearInterval(iv); ko(new Error("el diseño no abrió")); }
          }, 200);
        });
      })
      .then(function () {
        RB._edx.addFrames([res.src]);
        pg.close();
        var s = res.stats || {}, bits = [s.clips ? s.clips + " animación(es)" : "", s.live ? s.live + " capa(s) 3D/código vivo" : "", s.videos ? s.videos + " toma(s) de video" : ""].filter(Boolean).join(" · ");
        if (typeof toast === "function") toast("Listo: «" + res.src.name + "»" + (bits ? " · " + bits : "") + " · portada " + r2(still ? at : at - rg[0]) + " s (cámbiala en el inspector del frame)");
      })
      .catch(function (e) { pg.close(); RB.notice("No se pudo llevar a diseño", String(e && e.message || e)); });
  }
  /* botón en la barra del editor de video (junto a «</> Código») */
  function ensureBtn() {
    if (!VE.open) return;
    var top = document.querySelector("#ve .ed-tr"); if (!top || top.querySelector("[data-vtdbtn]")) return;
    var b = document.createElement("button"); b.className = "ed-btn"; b.dataset.vtdbtn = "1"; b.type = "button"; b.textContent = "→ Diseño"; b.title = "Llevar a diseño: la escena del cabezal como lámina (portada = este cuadro)";
    b.style.cssText = "height:28px;padding:0 10px;margin-right:6px";
    var ref = top.querySelector("[data-vecode]"); if (ref && ref.nextSibling) top.insertBefore(b, ref.nextSibling); else top.insertBefore(b, top.firstChild);
    b.addEventListener("click", function (e) { e.stopPropagation(); open(); });
  }
  setInterval(function () { ensureBtn(); if (P.el && !P.el.hidden && !VE.open) close(); }, 1000);
  window.__vtd = { open: open, close: close, run: run, sceneAt: sceneAt, set: function (t, part) { P.t = +t; if (part) P.part = part; veSeek(P.t); paint(true); } };
})();
