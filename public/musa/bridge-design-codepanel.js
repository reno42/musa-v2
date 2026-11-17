/* bridge-design-codepanel.js — la lámina ES código y el código ES la lámina (Musa Design Code, design-code-core.js).
 *  · Panel «</> Código» al lado del lienzo: el HTML completo de la lámina (CSS, capas, animación con su portada y
 *    presentación, capas vivas, tomas). Lo que haces en el lienzo aparece aquí al instante; lo que escribes aquí cambia el
 *    lienzo al dejar de escribir (sin recargar, la capa elegida sigue elegida). Si pegas código con JavaScript o canvas,
 *    corre una vez en el espacio aislado y queda editable como al importar.
 *  · Exportar › «HTML (se reproduce)»: la lámina (o el diseño entero como presentación) en un archivo que se ve en su
 *    portada y, con el reproductor de Musa, se reproduce igual que en Presentar.
 */
(function boot(n) {
  "use strict";
  var RB = window.__musaReal, DC = window.MusaDesignCode, MA = window.MusaAnim;
  if (!RB || !RB._edx || !DC || !MA || typeof ED === "undefined" || !window.__mdLive) { if ((n || 0) < 800) setTimeout(function () { boot((n || 0) + 1); }, 150); return; }
  if (window.__mdCode) return;
  var X = RB._edx, MD = window.__mdLive;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function curDoc() { return ED.open && ED.doc && ED.doc._real ? ED.doc : null; }
  function say(m) { if (typeof toast === "function") toast(m); }
  function origin() { try { return window.parent.location.origin; } catch (e) { return location.origin; } }
  function player() { return origin() + "/musa/design-player.js"; }
  function kebab(p) { return /^--/.test(p) ? p : String(p).replace(/[A-Z]/g, function (m) { return "-" + m.toLowerCase(); }); }
  function posterStyles(anim) {
    var A = anim ? MA.normalizeAnimation(anim) : null, out = {}; if (!A || !A.clips.length) return out;
    MA.sampleAnimationAt(A, MA.posterOf(A)).forEach(function (s, id) { var o = {}; Object.keys(s).forEach(function (p) { if (s[p] !== "") o[kebab(p)] = s[p]; }); out[id] = o; });
    return out;
  }
  /* la lámina guardada (lo mismo que se guarda) → código */
  function frameSrc(d, fi) { var p = X.payload(d); return p && p.frames[fi]; }
  function codeOf(d, fi, withPlayer) { var s = frameSrc(d, fi); return s ? DC.frameToCode(s, { posterStyles: posterStyles(s.animation), player: withPlayer ? player() : "" }) : ""; }
  function curFi() { var d = curDoc(); if (!d) return -1; if (ED.sel && d.frames[ED.sel.f]) return ED.sel.f; return d.frames.length ? 0 : -1; }

  /* ═════════════ panel ═════════════ */
  var CP = { el: null, ta: null, st: null, fi: -1, dirty: false, t: null, sig: "", busy: false };
  var css = document.createElement("style");
  css.textContent = "#mdFrameCode{position:absolute;left:8px;top:8px;bottom:8px;width:min(560px,48%);z-index:41;display:flex;flex-direction:column;background:#141414;border:1px solid #333;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.5);color:#ddd;font:12px/1.45 'JetBrains Mono',ui-monospace,monospace}"
    + "#mdFrameCode[hidden]{display:none}#mdFrameCode header{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid #2a2a2a;font:600 12px/1.2 Inter,system-ui,sans-serif;flex-wrap:wrap}#mdFrameCode header span{flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"
    + "#mdFrameCode header button{background:#262626;border:1px solid #3a3a3a;color:#eee;border-radius:6px;height:26px;padding:0 8px;cursor:pointer;font:inherit}#mdFrameCode textarea{flex:1;resize:none;background:#0d0d0d;color:#e6e6e6;border:0;padding:10px;font:inherit;outline:none;white-space:pre;tab-size:2}"
    + "#mdFrameCode footer{padding:6px 10px;border-top:1px solid #2a2a2a;font:11px/1.3 Inter,system-ui,sans-serif;color:#aaa}"
    + "#mdCodeBtn{position:absolute;left:160px;bottom:10px;z-index:34;background:rgba(20,20,20,.92);border:1px solid #3a3a3a;color:#eee;border-radius:8px;height:30px;padding:0 11px;cursor:pointer;font:600 12px 'JetBrains Mono',ui-monospace,monospace}#mdCodeBtn[hidden]{display:none}"
    + "@media (max-width:760px){#mdFrameCode{left:0;right:0;top:auto;bottom:0;width:auto;height:55%;border-radius:12px 12px 0 0}#mdCodeBtn{left:auto;right:10px}}";
  document.head.appendChild(css);
  function build() {
    if (CP.el) return;
    var h = document.querySelector("#edCanvas"); if (!h) return;
    CP.el = document.createElement("section"); CP.el.id = "mdFrameCode"; CP.el.hidden = true; CP.el.setAttribute("aria-label", "Código de la lámina");
    CP.el.innerHTML = '<header><span>&lt;/&gt; Código de la lámina</span><button type="button" data-fc="apply">Aplicar</button><button type="button" data-fc="copy">Copiar</button><button type="button" data-fc="dl">Descargar HTML</button><button type="button" data-fc="close" aria-label="Cerrar">×</button></header>'
      + '<textarea spellcheck="false" aria-label="Código de la lámina"></textarea><footer>HTML + CSS + animación (con su portada). Se aplica solo al dejar de escribir (Ctrl+Enter aplica ya). Pega cualquier código: si trae JavaScript, corre una vez en un espacio aislado.</footer>';
    h.appendChild(CP.el);
    CP.ta = CP.el.querySelector("textarea"); CP.st = CP.el.querySelector("footer");
    CP.el.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    CP.el.addEventListener("keydown", function (e) { e.stopPropagation(); if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); apply(true); } });
    CP.ta.addEventListener("input", function () { CP.dirty = true; clearTimeout(CP.t); CP.st.textContent = "Escribiendo…"; CP.t = setTimeout(function () { apply(false); }, 900); });
    CP.el.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-fc]"); if (!b) return;
      var k = b.dataset.fc;
      if (k === "close") return close();
      if (k === "apply") return apply(true);
      if (k === "copy") { try { navigator.clipboard.writeText(CP.ta.value).then(function () { say("Código copiado"); }, function () { CP.ta.select(); document.execCommand("copy"); say("Código copiado"); }); } catch (er) { CP.ta.select(); document.execCommand("copy"); } return; }
      if (k === "dl") return exportHtml(CP.fi);
    });
    var btn = document.createElement("button"); btn.id = "mdCodeBtn"; btn.type = "button"; btn.textContent = "</> Código"; btn.title = "La lámina como código (HTML + CSS + animación), editable en vivo";
    btn.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    btn.addEventListener("click", function (e) { e.stopPropagation(); if (CP.el && !CP.el.hidden) close(); else open(curFi()); });
    h.appendChild(btn); CP.btn = btn;
  }
  function open(fi) {
    build(); var d = curDoc(); if (!CP.el || !d || fi < 0) return;
    var lc = document.querySelector("#mdLiveCode"); if (lc) lc.hidden = true;
    CP.fi = fi; CP.dirty = false; CP.sig = ""; CP.el.hidden = false; refresh(true);
    CP.st.textContent = "Lámina «" + (d.frames[fi].name || fi + 1) + "» · en vivo";
  }
  function close() { if (!CP.el) return; if (CP.dirty) apply(true); CP.el.hidden = true; }
  function refresh(force) {
    var d = curDoc(); if (!CP.el || CP.el.hidden || !d || CP.dirty || CP.busy) return;
    if (CP.fi >= d.frames.length) CP.fi = d.frames.length - 1;
    var code = codeOf(d, CP.fi, false);
    if (!force && code === CP.ta.value) return;
    var top = CP.ta.scrollTop, pos = CP.ta.selectionStart;
    CP.ta.value = code; CP.ta.scrollTop = top;
    if (document.activeElement === CP.ta) try { CP.ta.selectionStart = CP.ta.selectionEnd = Math.min(pos, code.length); } catch (e) { /* idem */ }
  }
  var rT = null;
  RB._edHooks.render.push(function () { if (!CP.el || CP.el.hidden) return; clearTimeout(rT); rT = setTimeout(function () { refresh(false); }, 350); });
  /* el código → la lámina, en su lugar y con su id */
  function replaceFrame(d, fi, parsed) {
    var f = d.frames[fi]; if (!f) return;
    var selId = null; if (ED.sel && ED.sel.f === fi && ED.sel.e != null && f.els[ED.sel.e] && f.els[ED.sel.e]._n) selId = f.els[ED.sel.e]._n.getAttribute("data-layer-id");
    if (typeof snap === "function") snap();
    var old = f._src || {}, src = {};
    Object.keys(old).forEach(function (k) { if (!/^(html|css|animation|width|height|background|name|codeSource|codeGroup)$/.test(k)) src[k] = old[k]; });
    src.id = old.id; src.name = parsed.name || f.name; src.width = parsed.width || f.w; src.height = parsed.height || f.h; src.background = parsed.background || f.bg;
    src.html = parsed.html || ""; src.css = parsed.css || ""; if (parsed.animation) src.animation = MA.normalizeAnimation(parsed.animation);
    var nf = X.buildFrame(src, fi, f.x); nf.y = f.y;
    d.frames[fi] = nf;
    if (selId) { var ei = nf.els.findIndex(function (e) { return e && e._n && e._n.getAttribute("data-layer-id") === selId; }); ED.sel = ei >= 0 ? { f: fi, e: ei } : { f: fi, e: null }; }
    edRender(); edLayers(); edProps(); X.save();
  }
  function apply(force) {
    clearTimeout(CP.t); var d = curDoc(); if (!CP.el || !d || !CP.dirty || CP.fi < 0) return;
    var code = CP.ta.value, parsed = DC.codeToFrame(code); CP.dirty = false;
    if (parsed.animationError) { CP.st.textContent = "⚠ La animación (musa-animation) no es JSON válido: " + parsed.animationError; return; }
    if (!parsed.needsBake) { replaceFrame(d, CP.fi, parsed); CP.st.textContent = "Aplicado " + new Date().toLocaleTimeString().slice(0, 5); return; }
    /* código con JavaScript o canvas: corre una vez en el espacio aislado (como al importar) */
    CP.busy = true; CP.st.textContent = "Corriendo el código en un espacio aislado…";
    var f = d.frames[CP.fi], fi = CP.fi;
    DC.bake(code, { size: { w: parsed.width || f.w, h: parsed.height || f.h }, keepSize: true, title: parsed.name || f.name })
      .then(function (r) {
        var dd = new DOMParser().parseFromString(r.html, "text/html"), cssA = [];
        [].forEach.call(dd.querySelectorAll("link[rel~=stylesheet][href]"), function (l) { cssA.push("@import url('" + l.getAttribute("href").replace(/'/g, "%27") + "');"); });
        [].forEach.call(dd.querySelectorAll("style"), function (s) { cssA.push(s.textContent); });
        replaceFrame(d, fi, { name: parsed.name, width: r.W, height: r.H, background: r.bg, html: dd.body.innerHTML, css: cssA.join("\n"), animation: r.animation ? Object.assign({}, r.animation, { timeline: { durationSec: r.animation.durationSec || 5, fps: 30, width: r.W, height: r.H, loop: "once" } }) : null });
        var s = r.stats || {}; CP.st.textContent = "Listo: " + [s.clips ? s.clips + " animación(es)" : "", s.live ? s.live + " capa(s) vivas" : "", s.pseudo ? s.pseudo + " adorno(s) a capas" : ""].filter(Boolean).join(" · ") || "Listo";
      }, function (e) { CP.st.textContent = "⚠ No se pudo correr el código: " + (e && e.message || e); })
      .then(function () { CP.busy = false; refresh(true); });
  }

  /* ═════════════ Exportar › HTML (se reproduce) ═════════════ */
  function dl(name, text) {
    var blob = new Blob([text], { type: "text/html;charset=utf-8" });
    if (RB.fileReady) return RB.fileReady(blob, name);
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }
  function safe(s) { return String(s || "diseno").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80); }
  function exportHtml(fi) {
    var d = curDoc(); if (!d) return;
    if (fi != null && fi >= 0) { dl(safe(d.name) + (d.frames.length > 1 ? "-" + (fi + 1) : "") + ".html", codeOf(d, fi, true)); say("HTML listo: se ve en su portada y se reproduce al abrirlo"); return; }
    /* todo el diseño: una presentación (cada lámina en su propio marco, para que su CSS no choque con las demás) */
    var slides = d.frames.map(function (f, i) { var s = frameSrc(d, i); return { w: s.width, h: s.height, name: s.name, code: codeOf(d, i, true) }; });
    var deck = "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + esc(d.name) + "</title>"
      + "<style>html,body{margin:0;height:100%;background:#000;overflow:hidden;font:13px system-ui,sans-serif}#st{position:absolute;inset:0;display:grid;place-items:center}iframe{border:0;transform-origin:0 0;position:absolute;left:0;top:0;background:#fff}#n{position:fixed;bottom:12px;left:0;right:0;text-align:center;color:#aaa}</style></head>"
      + "<body><div id=\"st\"></div><div id=\"n\"></div><script>var S=" + JSON.stringify(slides).replace(/</g, "\\u003c") + ",i=0;"
      + "function show(k){i=Math.max(0,Math.min(S.length-1,k));var s=S[i],st=document.getElementById('st');st.innerHTML='';var box=document.createElement('div');var sc=Math.min(innerWidth/s.w,innerHeight/s.h);box.style.cssText='position:relative;width:'+s.w*sc+'px;height:'+s.h*sc+'px;overflow:hidden';var f=document.createElement('iframe');f.setAttribute('sandbox','allow-scripts');f.style.width=s.w+'px';f.style.height=s.h+'px';f.style.transform='scale('+sc+')';f.srcdoc=s.code;box.appendChild(f);st.appendChild(box);document.getElementById('n').textContent=(i+1)+' / '+S.length+' · '+s.name}"
      + "addEventListener('keydown',function(e){if(e.key==='ArrowRight'||e.key===' ')show(i+1);if(e.key==='ArrowLeft')show(i-1)});addEventListener('click',function(e){show(i+(e.clientX<innerWidth/3?-1:1))});addEventListener('resize',function(){show(i)});show(0);<\/script></body></html>";
    dl(safe(d.name) + ".html", deck); say("Presentación HTML lista: flechas o clic para pasar de lámina");
  }
  if (typeof MENUS !== "undefined" && MENUS.exportar) {
    var _mx = MENUS.exportar;
    MENUS.exportar = function () {
      var items = _mx.apply(this, arguments); if (!curDoc()) return items;
      var it = { l: "HTML (se reproduce)", d: "La lámina elegida (o todo el diseño como presentación) con su animación y su 3D", fn: function () { exportHtml(ED.sel ? ED.sel.f : null); } };
      var at = items.findIndex(function (x) { return x && x.l && /^JSON/.test(x.l); });
      if (at >= 0) items.splice(at, 0, it); else items.push(it);
      return items;
    };
  }
  setInterval(function () { build(); if (CP.btn) CP.btn.hidden = !curDoc() || !!(CP.el && !CP.el.hidden); if (CP.el && !CP.el.hidden && !ED.open) CP.el.hidden = true; }, 1000);
  window.__mdCode = { open: open, close: close, apply: function () { CP.dirty = true; apply(true); }, set: function (code) { if (!CP.el) return; CP.ta.value = code; CP.dirty = true; }, code: function (fi) { var d = curDoc(); return d ? codeOf(d, fi == null ? curFi() : fi, false) : ""; }, exportHtml: exportHtml, state: function () { return CP.el ? { open: !CP.el.hidden, fi: CP.fi, dirty: CP.dirty, busy: CP.busy, status: CP.st.textContent } : null; } };
})();
