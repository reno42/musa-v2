/* bridge-mobile.js — Musa en el celular (≤ 760 px).
 *
 * La maqueta en celular escondía los paneles de los editores (capas, propiedades, ajustes, nodos) y todos
 * sus menús (Import, Exportar, Compartir, Publicar…) sin dar otra forma de llegar a ellos: se veía el lienzo
 * y nada se podía editar. Aquí, sin tocar index.html:
 *  · Editores (diseño, video, fotos, flujos): barra inferior con sus paneles como hojas que suben desde
 *    abajo (el lienzo sigue visible arriba) y un «Menú» con todo lo que estaba en la barra superior.
 *    Los menús de la maqueta se abren como hoja inferior y sus submenús se despliegan al tocarlos.
 *  · Lienzo de diseño: pellizco para acercar/alejar, dos dedos para moverse, un dedo fuera de los frames
 *    para desplazarse; al abrir un diseño se encuadra el primer frame (antes quedaba al 2 %).
 *  · Plataforma: el calendario del mes pasa a agenda (un día por fila) y Comentarios a una columna.
 */
(function () {
  var MQ = window.matchMedia("(max-width: 760px)");
  function mobile() { return MQ.matches; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  var IC = {
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
    props: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    tools: '<path d="m14 7 3 3M5 19l4-1 10-10-3-3L6 15l-1 4Z"/>',
    media: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 15 5-5 4 4 3-3 6 6"/>',
    nodes: '<rect x="3" y="4" width="7" height="6" rx="1.5"/><rect x="14" y="14" width="7" height="6" rx="1.5"/><path d="M10 7h3a2 2 0 0 1 2 2v5"/>',
    menu: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  };
  function icon(k) { return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[k] + "</svg>"; }

  /* qué paneles tiene cada editor en el celular */
  var EDITORS = {
    ed: [["layers", "Capas", ".ed-layers"], ["props", "Propiedades", ".ed-props"]],
    ve: [["media", "Medios", ".ve-bin"], ["tools", "Herramientas", ".ve-strip"], ["props", "Propiedades", ".ve-insp"]],
    ph: [["layers", "Capas", ".ph-left"], ["props", "Ajustes", ".ed-props"]],
    fl: [["nodes", "Nodos", ".fl-pal"], ["props", "Propiedades", ".ed-props"]],
  };

  var css = ".m-nav,.m-more{display:none}@media (max-width:760px){.m-nav{display:flex}.m-more{display:block}"
    /* editores: barra inferior y hojas */
    + ".ed{padding-bottom:calc(58px + env(safe-area-inset-bottom))}"
    + "#ed{grid-template-rows:48px minmax(0,1fr) 0}#ed .ed-status{display:none}"
    + "#ve{grid-template-rows:48px minmax(0,1fr) 38vh}"
    + ".ed .ed-tc{display:none!important}.ed .ed-tr>:not(.m-keep){display:none!important}.ed .ed-tr{gap:2px}"
    + ".ed .ed-tl{min-width:0;flex:1}.ed .ed-name{min-width:0;flex:1;max-width:none!important}.ed .ed-logo,.ed .ed-chip{display:none}"
    + ".m-nav{position:fixed;left:0;right:0;bottom:0;z-index:140;display:flex;height:calc(58px + env(safe-area-inset-bottom));padding-bottom:env(safe-area-inset-bottom);background:var(--e-panel,#111);border-top:1px solid var(--e-line,#222)}"
    + ".m-nav button{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font:600 10.5px var(--sans,Inter,sans-serif);color:var(--e-muted,#7a7a7a);background:none;border:0;position:relative}"
    + ".m-nav button.on{color:var(--e-accent,#ff5e00)}.m-nav button.dot::after{content:'';position:absolute;top:9px;right:calc(50% - 16px);width:7px;height:7px;border-radius:50%;background:var(--e-accent,#ff5e00)}"
    + ".m-nav button:focus-visible{outline:2px solid var(--e-accent,#ff5e00);outline-offset:-4px}"
    + ".ed .m-sheet{display:flex!important;flex-direction:column;position:fixed!important;left:0!important;right:0!important;top:auto!important;bottom:calc(58px + env(safe-area-inset-bottom))!important;width:auto!important;height:min(58vh,560px)!important;max-height:none!important;z-index:135;border:0!important;border-top:1px solid var(--e-line,#222)!important;border-radius:16px 16px 0 0;box-shadow:0 -14px 40px rgba(0,0,0,.55);overflow:auto;overscroll-behavior:contain;grid-row:auto!important;grid-column:auto!important;animation:m-up .18s ease-out}"
    + ".ed .m-sheet::before{content:'';display:block;flex:none;width:40px;height:4px;border-radius:4px;background:#3a3a3a;margin:8px auto 4px}"
    + ".ed .ve-strip.m-sheet{flex-direction:row;flex-wrap:wrap;align-content:flex-start;height:auto!important;max-height:50vh!important;padding:10px!important}"
    + ".ed .ve-strip.m-sheet::before{flex-basis:100%}"
    + "@keyframes m-up{from{transform:translateY(24px);opacity:0}}"
    + "@media (prefers-reduced-motion:reduce){.ed .m-sheet{animation:none}}"
    /* menús de la maqueta como hoja inferior; submenús que se despliegan al tocarlos */
    + ".ed .ed-menu{position:fixed!important;left:8px!important;right:8px!important;top:auto!important;bottom:calc(66px + env(safe-area-inset-bottom))!important;width:auto!important;min-width:0!important;max-height:64vh;overflow:auto;z-index:160!important}"
    + ".ed .ed-menu .ed-mi{min-height:44px}.ed .ed-menu .sub{position:static!important;display:none!important;box-shadow:none!important;border:0!important;margin:2px 0 4px 18px!important;min-width:0!important}"
    + ".ed .ed-menu .ed-mi.m-open>.sub{display:block!important}.ed .ed-menu .ed-mi{flex-wrap:wrap}"
    /* hoja «Menú» propia */
    + ".m-more{position:fixed;left:0;right:0;bottom:calc(58px + env(safe-area-inset-bottom));z-index:150;background:var(--e-panel,#111);border-top:1px solid var(--e-line,#222);border-radius:16px 16px 0 0;box-shadow:0 -14px 40px rgba(0,0,0,.55);padding:6px 10px 12px;max-height:70vh;overflow:auto;animation:m-up .18s ease-out}"
    + ".m-more::before{content:'';display:block;width:40px;height:4px;border-radius:4px;background:#3a3a3a;margin:4px auto 8px}"
    + ".m-more h6{margin:8px 6px 4px;font:700 10px var(--sans,Inter,sans-serif);letter-spacing:.08em;text-transform:uppercase;color:#777}"
    + ".m-more button{display:flex;align-items:center;gap:10px;width:100%;min-height:46px;padding:0 10px;border:0;border-radius:10px;background:none;color:#e8e8e8;font:500 14px var(--sans,Inter,sans-serif);text-align:left}"
    + ".m-more button:active,.m-more button:focus-visible{background:#1d1d1d;outline:0}.m-more button small{margin-left:auto;color:#777;font-size:12px}"
    /* lienzo: nada de seleccionar texto al pellizcar */
    + "#edCanvas{-webkit-user-select:none;user-select:none}"
    /* plataforma */
    + ".cm{grid-template-columns:minmax(0,1fr)!important}.cm-posts{position:static!important}"
    + ".ag-ctl button,.ag-ctl .btn{white-space:nowrap}"
    + ".mc-grid{grid-template-columns:minmax(0,1fr)!important}"
    + ".mc-grid .h,.mc-grid .d.out,.mc-grid .d:not(.today):not(.sel):not(:has(.mc-it)){display:none!important}"
    + ".mc,.mc-grid{width:100%!important;min-width:0!important;box-sizing:border-box}"
    + ".mc-grid .d{display:grid!important;grid-template-columns:52px minmax(0,1fr);gap:4px 8px;min-height:0!important;min-width:0;padding:10px 12px!important;border-right:0!important;align-items:start;box-sizing:border-box}"
    + ".mc-grid .d>span:first-child{grid-column:1;grid-row:1/span 20;font-size:17px!important;font-weight:800!important;color:#111!important;line-height:1.1}"
    + ".mc-grid .d>span:first-child[data-wd]::after{content:attr(data-wd);display:block;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#888}"
    + ".mc-grid .d.today>span:first-child{width:auto!important;height:auto!important;background:none!important;color:var(--accent)!important;display:block!important}"
    + ".mc-grid .d>:not(:first-child){grid-column:2;min-width:0;max-width:100%;box-sizing:border-box}"
    + ".mc-grid .mc-it{white-space:normal!important;overflow:visible!important;font-size:12.5px!important;padding:6px 8px!important;text-align:left}"
    + ".mc-grid .d>:not(:first-child):not(.mc-it){font-size:12px;color:#777;font-weight:600}"
    + "}";
  /* formularios de dos o tres columnas: en pantallas angostas, una sola (antes los botones quedaban apretados) */
  css += "@media (max-width:520px){.fx-row{grid-template-columns:minmax(0,1fr)!important}}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  /* ── editores ── */
  var active = null; // { root, key }
  function rootOpen(root) { return root && !root.hidden && root.offsetParent !== null || (root && !root.hidden && getComputedStyle(root).display !== "none"); }
  function closeSheets(root) {
    (root ? [root] : document.querySelectorAll(".ed")).forEach(function (r) {
      r.querySelectorAll(".m-sheet").forEach(function (x) { x.classList.remove("m-sheet"); });
      r.querySelectorAll(".m-nav button.on").forEach(function (b) { b.classList.remove("on"); b.setAttribute("aria-expanded", "false"); });
    });
    var mo = document.querySelector(".m-more"); if (mo) mo.remove();
    active = null;
  }
  function toggle(root, key, sel, btn) {
    var was = active && active.root === root && active.key === key;
    closeSheets(root);
    if (was) return;
    if (key === "menu") return openMore(root, btn);
    var el = root.querySelector(sel); if (!el) return;
    el.classList.add("m-sheet");
    btn.classList.add("on"); btn.classList.remove("dot"); btn.setAttribute("aria-expanded", "true");
    active = { root: root, key: key };
  }
  /* «Menú»: lo que estaba en la barra superior (menús, Presentar, Compartir, Publicar, Exportar…) */
  function openMore(root, btn) {
    var items = [].slice.call(root.querySelectorAll(".ed-top .ed-tc button, .ed-top .ed-tr button")).filter(function (b) {
      return !b.classList.contains("m-keep") && !/Undo|Redo|ZIn|ZOut|zoom|Hands|^edZ$|^phZ$|^flZ$/i.test(b.id || "") && !/^\d+\s*%$/.test((b.textContent || "").trim()) && !b.classList.contains("ed-av") && (b.textContent.trim() || b.title);
    });
    var box = document.createElement("div");
    box.className = "m-more"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Menú del editor");
    var extra = root.id === "ed" ? '<button type="button" data-m-x="fit">Encajar todo<small>ver todos los frames</small></button><button type="button" data-m-x="fit1">Encajar el frame elegido</button>' : "";
    box.innerHTML = "<h6>Menú</h6>" + items.map(function (b, i) {
      var t = (b.textContent || "").replace(/\s+/g, " ").trim() || b.title || b.getAttribute("aria-label") || "Opción";
      return '<button type="button" data-m-i="' + i + '">' + esc(t) + (b.dataset.menu ? "<small>›</small>" : "") + "</button>";
    }).join("") + (extra ? "<h6>Vista</h6>" + extra : "");
    document.body.appendChild(box);
    btn.classList.add("on"); btn.setAttribute("aria-expanded", "true");
    active = { root: root, key: "menu" };
    box.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      closeSheets(root);
      if (b.dataset.mX === "fit" && typeof edFit === "function") return edFit();
      if (b.dataset.mX === "fit1" && typeof edFit === "function" && ED.doc) return edFit(ED.doc.frames[(ED.sel && ED.sel.f) || 0]);
      var src = items[+b.dataset.mI]; if (src) setTimeout(function () { src.click(); }, 30);
    });
    var first = box.querySelector("button"); if (first) first.focus();
  }
  function install(root) {
    if (!root || root.querySelector(".m-nav")) return;
    var conf = EDITORS[root.id]; if (!conf) return;
    root.querySelectorAll(".ed-top .ed-tr button").forEach(function (b) { if (/(Undo|Redo)$/.test(b.id || "")) b.classList.add("m-keep"); });
    var nav = document.createElement("nav");
    nav.className = "m-nav"; nav.setAttribute("aria-label", "Paneles del editor");
    nav.innerHTML = conf.concat([["menu", "Menú", ""]]).map(function (c) {
      return '<button type="button" data-m-k="' + c[0] + '" data-m-s="' + c[2] + '" data-action="m-' + c[0] + '" aria-expanded="false">' + icon(c[0]) + "<span>" + c[1] + "</span></button>";
    }).join("");
    nav.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      toggle(root, b.dataset.mK, b.dataset.mS, b);
    });
    root.appendChild(nav);
  }
  function installAll() { ["ed", "ve", "ph", "fl"].forEach(function (id) { install(document.getElementById(id)); }); }
  installAll(); setTimeout(installAll, 1500); setTimeout(installAll, 5000);

  /* elegir una herramienta o un elemento del panel de capas cierra la hoja para ver el lienzo */
  document.addEventListener("click", function (e) {
    if (!mobile() || !active) return;
    var t = e.target;
    if (active.key === "layers" && t.closest && t.closest(".ed-ly[data-e], .ed-ly.fr")) setTimeout(function () { closeSheets(); }, 120);
    if (active.key === "tools" && t.closest && t.closest(".ve-strip button")) setTimeout(function () { closeSheets(); }, 120);
  }, true);
  /* submenús: se abren al tocar el ítem */
  document.addEventListener("click", function (e) {
    if (!mobile()) return;
    var mi = e.target.closest && e.target.closest(".ed-menu .ed-mi");
    if (mi && mi.querySelector(":scope > .sub") && !e.target.closest(".sub")) { mi.classList.toggle("m-open"); }
  }, true);
  /* al salir de un editor (cambia la ruta) se cierran sus hojas */
  window.addEventListener("hashchange", function () { if (active) closeSheets(); });
  /* hay algo elegido: punto en «Propiedades» para que se note dónde editarlo */
  if (typeof edProps === "function") {
    var _edProps = edProps;
    edProps = function () {
      var r = _edProps.apply(this, arguments);
      try {
        if (mobile() && typeof ED !== "undefined" && ED.sel && ED.sel.e != null) {
          var b = document.querySelector('#ed .m-nav [data-m-k="props"]');
          if (b && !b.classList.contains("on")) b.classList.add("dot");
        }
      } catch (e) {}
      return r;
    };
  }

  /* ── lienzo de diseño: pellizco, dos dedos y desplazamiento con un dedo fuera de los frames ── */
  var cv = document.getElementById("edCanvas");
  if (cv && typeof edView === "function") {
    var pts = new Map(), mode = null, last = null, synth = false;
    var metrics = function () { var a = Array.from(pts.values()); return { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1, cx: (a[0].x + a[1].x) / 2, cy: (a[0].y + a[1].y) / 2 }; };
    cv.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "touch" || !mobile()) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        mode = "pinch"; last = metrics();
        e.stopImmediatePropagation(); e.preventDefault();
        // el primer dedo pudo empezar un arrastre de la maqueta: se termina ahí
        synth = true;
        try { pts.forEach(function (p, id) { if (id !== e.pointerId) window.dispatchEvent(new PointerEvent("pointerup", { pointerId: id, clientX: p.x, clientY: p.y, bubbles: true, pointerType: "touch", isPrimary: true })); }); } catch (x) {}
        synth = false;
        return;
      }
      var onSomething = e.target.closest(".ed-el, [data-real], [data-h], .ed-bub, [data-pin], [contenteditable=true], .mreal, .ed-frame, .ed-sel");
      if (pts.size === 1 && ED.tool === "select" && !onSomething) { mode = "pan"; last = { x: e.clientX, y: e.clientY }; e.stopImmediatePropagation(); }
    }, true);
    window.addEventListener("pointermove", function (e) {
      if (!pts.has(e.pointerId)) return;
      if (mode === "pinch" || mode === "pan") e.stopImmediatePropagation();
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (mode === "pinch" && pts.size >= 2) {
        var m = metrics();
        if (typeof edZoomAt === "function") edZoomAt(m.d / last.d, m.cx, m.cy);
        ED.px += m.cx - last.cx; ED.py += m.cy - last.cy; edView(); last = m;
      } else if (mode === "pan") {
        ED.px += e.clientX - last.x; ED.py += e.clientY - last.y; last = { x: e.clientX, y: e.clientY }; edView();
      }
    }, { passive: true, capture: true });
    var up = function (e) { if (synth) return; pts.delete(e.pointerId); if (!pts.size) mode = null; else if (mode === "pinch") mode = "wait"; };
    window.addEventListener("pointerup", up, true); window.addEventListener("pointercancel", up, true);
  }

  /* al abrir un diseño en el celular: el primer frame a pantalla, no todo el archivo al 2 % */
  if (typeof edOpen === "function") {
    var _edOpenM = edOpen;
    edOpen = function () {
      var r = _edOpenM.apply(this, arguments);
      if (mobile()) setTimeout(function () { try { if (ED.open && ED.doc && ED.doc.frames.length) edFit(ED.doc.frames[0]); } catch (e) {} }, 120);
      setTimeout(installAll, 0);
      return r;
    };
  }

  /* ── calendario: el día de la semana en la agenda del celular ── */
  if (typeof viewCalendar === "function") {
    var _vc = viewCalendar, WD = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    viewCalendar = function () {
      var r = _vc.apply(this, arguments);
      try {
        document.querySelectorAll(".mc-grid .d[data-cd-day]>span:first-child").forEach(function (s) {
          var d = +s.parentElement.dataset.cdDay; s.setAttribute("data-wd", WD[new Date(CAL.y, CAL.m, d).getDay()]);
        });
      } catch (e) {}
      return r;
    };
  }
})();
