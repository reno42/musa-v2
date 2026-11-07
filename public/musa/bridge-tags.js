/* bridge-tags.js — Etiquetas y filtros por etiqueta en modo real (migración 23).
 * · Crear › Diseños y Crear › Videos: fila de chips de etiquetas (filtro unión) bajo la
 *   barra de visibilidad del portal, y chips por pieza (videos además obtienen su propio
 *   alternador Privado/Compartido y editor de etiquetas, que la librería del portal
 *   solo pone en diseños).
 * · Planear › Calendario: chips que filtran las piezas del mes y editor de etiquetas
 *   en el detalle de la pieza (content_calendar.tags).
 * El filtro de visibilidad del portal (Todas/Compartidas/Privadas/Mi negocio) se lee del
 * DOM y se respeta aquí: ambas reglas se componen. Un MutationObserver re-aplica nuestro
 * ocultado cuando el portal re-decora de forma asíncrona, sin pelearse con él.
 * Regla: la maqueta NO se toca; enganches sobre viewGrid/viewCalendar y delegación de clics.
 * Cargador: "bridge-tags.js" al final del array "extras" de bridge.js.
 */
(function () {
  "use strict";

  /* ── helpers locales (misma convención que el resto de los puentes) ── */
  function RB() { return (typeof __musaReal !== "undefined") ? __musaReal : null; }
  function bridge() { try { return window.parent !== window && window.parent.__musaBridge; } catch (e) { return window.__musaBridge || null; } }
  function api(path, init) { var b = bridge(); if (!b) return Promise.reject(new Error("sin puente")); return b.api(path.charAt(0) === "/" ? path : "/rest/v1/" + path, init); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function real() { return RB() && RB().on; }
  function ws() { return RB() && RB().ws; }
  function rest(q) { return api(q).catch(function () { return []; }).then(function (r) { return r || []; }); }
  function patch(table, id, body) {
    return api(table + "?id=eq." + encodeURIComponent(id), { method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(body) });
  }
  function toast(m) { if (typeof uiToast === "function") uiToast(m); }
  function parseTags(v) {
    return (v || "").split(",").map(function (s) { return s.trim().slice(0, 40).replace(/^#/, ""); }).filter(Boolean).slice(0, 20);
  }

  /* ── estado: etiquetas por tipo, selección activa por vista, marca propia ── */
  var TAGS = { tpl: {}, vid: {}, cal: {} };   // id -> {tags, visibility, brand} | [tags]
  var SEL = { disenos: [], videos: [], calendario: [] };   // etiquetas activas (unión)
  var HOUSE = {};                              // brand_id -> true si es «Mi negocio»
  var lastWs = null, lastView = null, calBusy = false;

  function resetIfNeeded() {
    var w = ws();
    if (w && w !== lastWs) { lastWs = w; TAGS = { tpl: {}, vid: {}, cal: {} }; HOUSE = {}; }
  }

  /* ── carga de datos ── */
  function idsOf(arr) { return (arr || []).map(function (x) { return x && x.id; }).filter(Boolean); }
  function loadHouse() {
    if (Object.keys(HOUSE).length) return Promise.resolve();
    var q = function (withCol) {
      return api("brands?workspace_id=eq." + encodeURIComponent(ws()) + "&select=id,name" + (withCol ? ",is_house" : "") + "&order=name.asc&limit=200");
    };
    return q(true).catch(function () { return q(false); }).then(function (r) {
      var rows = (r && r.length) ? r : [];
      (rows || []).forEach(function (b) { HOUSE[b.id] = b.is_house === true; });
    }).catch(function () {});
  }
  function loadKind(kind, table, sel, ids) {
    if (!ids.length) return Promise.resolve();
    return rest(table + "?id=in.(" + ids.join(",") + ")&select=" + sel).then(function (rows) {
      (rows || []).forEach(function (r) { TAGS[kind][r.id] = { tags: r.tags || [], visibility: r.visibility || "shared", brand: r.brandId || r.brand_id || null }; });
    });
  }
  function loadGridData(view) {
    resetIfNeeded();
    var jobs = [loadHouse()];
    if (view === "disenos") jobs.push(loadKind("tpl", "templates", "id,tags,visibility,brandId:data->>brandId", idsOf(RB().tpl)));
    else jobs.push(loadKind("vid", "musa_video_projects", "id,tags,visibility,brand_id", idsOf(RB().vids)));
    return Promise.all(jobs);
  }
  function loadCalData() {
    resetIfNeeded();
    return rest("content_calendar?workspace_id=eq." + encodeURIComponent(ws()) + "&select=id,tags&order=scheduled_date.desc&limit=500").then(function (rows) {
      (rows || []).forEach(function (r) { TAGS.cal[r.id] = r.tags || []; });
    });
  }

  /* ── chips de etiquetas ── */
  function tagPool(map) {
    var out = {};
    Object.keys(map).forEach(function (id) {
      var ts = map[id];
      (Array.isArray(ts) ? ts : (ts && ts.tags) || []).forEach(function (t) { out[t] = (out[t] || 0) + 1; });
    });
    return Object.keys(out).sort().map(function (t) { return [t, out[t]]; });
  }
  function chipsHtml(view) {
    var pool = tagPool(view === "calendario" ? TAGS.cal : (view === "videos" ? TAGS.vid : TAGS.tpl));
    var sel = SEL[view];
    var inner = pool.map(function (p) {
      return '<button data-mbtag="' + esc(p[0]) + '" class="' + (sel.indexOf(p[0]) >= 0 ? "on" : "") + '">🏷 ' + esc(p[0]) + " · " + p[1] + "</button>";
    }).join("");
    if (!inner && !sel.length) {
      inner = '<span style="font-size:12px;color:var(--muted)">Sin etiquetas todavía — usa 🏷 en una pieza y filtra aquí.</span>';
    }
    if (sel.length) inner += '<button data-mbtagclear="1" class="on">Limpiar ×</button>';
    return '<div class="flt-bar" data-mbtags="' + view + '">' + inner + "</div>";
  }
  function mountBar(view, anchorSel) {
    var anchor = document.querySelector(anchorSel);
    if (!anchor) return;
    var old = document.querySelector('[data-mbtags="' + view + '"]');
    if (old) old.remove();
    var tmp = document.createElement("div");
    tmp.innerHTML = chipsHtml(view);
    if (tmp.firstChild) anchor.parentNode.insertBefore(tmp.firstChild, anchor);
  }

  /* ── regla de visibilidad (lee la barra del portal del DOM) ── */
  function visFilter() {
    var fb = document.querySelector(".flt-bar [data-agf].on");
    return fb ? fb.getAttribute("data-agf") : "all";
  }
  function visHides(x) {
    var f = visFilter();
    if (f === "shared") return !x || x.visibility !== "shared";
    if (f === "private") return !x || x.visibility !== "private";
    if (f === "house") return !x || !(x.brand && HOUSE[x.brand]);
    return false;
  }
  function applyHide(el, hide) {
    var now = hide ? "none" : "";
    if ((el.style.display || "") !== now) el.style.display = now;
  }

  /* ── decorar las grillas (diseños y videos) ── */
  function decorateGrid(view) {
    if (!real()) return;
    var tilesEl = document.querySelector("#body .tiles");
    if (!tilesEl) return;
    mountBar(view, "#body .tiles");
    var src = view === "videos" ? (RB().vids || []) : (RB().tpl || []);
    var map = view === "videos" ? TAGS.vid : TAGS.tpl;
    var sel = SEL[view];
    document.querySelectorAll("#body .tile[data-open]").forEach(function (t) {
      if (!/^\d+$/.test(t.dataset.open)) return;     /* las pestañas del hub usan «k/i» */
      var x = src[+t.dataset.open], m = x && map[x.id];
      if (!x || !m) return;
      var bb = t.querySelector(".tile-b");
      if (bb && !bb.querySelector(".mb-tgs")) {
        var chips = (m.tags || []).map(function (g) { return '<span style="font-size:10px;color:var(--muted)">#' + esc(g) + "</span>"; }).join(" ");
        var ctl = "";
        if (view === "videos") {
          ctl = '<span data-mbvistoggle="' + esc(x.id) + '" style="cursor:pointer;font-size:10px;color:var(--muted)">' + (m.visibility === "private" ? "Privado" : "Compartido") + "</span>" +
            '<span data-mbvtags="' + esc(x.id) + '" style="cursor:pointer;font-size:10px;color:var(--muted)">🏷 ' + (m.tags || []).length + "</span>";
        }
        bb.insertAdjacentHTML("beforeend", '<div class="mb-tgs" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:2px">' + ctl + chips + "</div>");
      }
      var hide = visHides(m) || (sel.length && (!(m.tags || []).some(function (g) { return sel.indexOf(g) >= 0; })));
      t.setAttribute("data-mbhide", "1");
      applyHide(t, hide);
    });
  }
  function refreshGrid(view) {
    loadGridData(view).then(function () { if (lastView === view) decorateGrid(view); });
  }

  /* ── calendario: barra + ocultado por etiqueta + editor en el detalle ── */
  function calRefTags(ref) {
    if (typeof PZ === "undefined" || !ref) return undefined;
    var p = null;
    for (var i = 0; i < PZ.length; i++) if (PZ[i] && PZ[i].id === ref) { p = PZ[i]; break; }
    return p && p.db ? TAGS.cal[p.db] : undefined;
  }
  function decorateCal() {
    if (!real()) return;
    if (!document.querySelector(".mc-top")) return;
    mountBar("calendario", ".mc-top");
    var sel = SEL.calendario;
    document.querySelectorAll(".mc-it[data-ci]").forEach(function (b) {
      var ref = (b.dataset.ci || "").split("|")[1];
      var tags = calRefTags(ref);
      if (tags === undefined) return;                 /* demo o sin fila en content_calendar */
      var hide = sel.length && !tags.some(function (g) { return sel.indexOf(g) >= 0; });
      applyHide(b, hide);
    });
    injectCalEditor();
  }
  function refreshCal() {
    if (calBusy) return;
    calBusy = true;
    loadCalData().then(function () { calBusy = false; decorateCal(); }, function () { calBusy = false; });
  }
  function injectCalEditor() {
    var t = document.querySelector(".pz-title");
    if (!t || typeof pzCur !== "function") return;
    var p = pzCur();
    if (!p || !p.db || document.getElementById("mbCalTagsRow")) return;
    t.insertAdjacentHTML("afterend",
      '<div id="mbCalTagsRow" style="display:flex;gap:6px;align-items:center;margin:6px 0">' +
      '<input class="fx-in" id="mbCalTags" value="' + esc((TAGS.cal[p.db] || []).join(", ")) + '" placeholder="etiquetas separadas por comas" style="flex:1;padding:4px 8px;font-size:12px">' +
      '<button class="btn btn-g" data-mbcalsave="' + esc(p.db) + '" style="padding:4px 10px;font-size:12px">Guardar 🏷</button></div>');
  }

  /* ── re-aplicación: gana la carrera contra el decorado asíncrono del portal ── */
  var raf = null;
  function scheduleApply() {
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = null; applyAll(); });
  }
  function applyAll() {
    if (!real()) return;
    var h = location.hash.slice(1);
    if (lastView) {
      if (h.indexOf("crear/" + lastView) === 0) decorateGrid(lastView); else lastView = null;
    }
    if (h.indexOf("planear/calendario") === 0 && document.querySelector(".mc-top")) decorateCal();
  }

  /* ── popups de videos (los de diseños ya los pone el portal) ── */
  function tagsPopupVid(id) {
    var m = TAGS.vid[id];
    if (!m || typeof mx !== "function") return;
    mx("Etiquetas del video", "Palabras cortas para encontrarlo rápido: campaña, formato, temporada… Sepáralas con comas. Tu equipo las ve aquí y en el filtro.",
      '<input class="fx-in" id="mbVTags" value="' + esc((m.tags || []).join(", ")) + '" placeholder="verano, reel, cliente-x"><div class="roles" style="margin-top:10px"><button class="btn btn-p" data-mbvsave>Guardar</button></div>',
      function (e) {
        if (!e.target.closest("[data-mbvsave]")) return;
        var v = parseTags(document.getElementById("mbVTags").value);
        patch("musa_video_projects", id, { tags: v }).then(function () {
          m.tags = v; mxEl.hidden = true; toast("Etiquetas guardadas"); refreshGrid("videos");
        }, function (er) { toast("No se pudo guardar: " + (er && er.message || "error")); });
      });
  }
  function toggleVidVis(id) {
    var m = TAGS.vid[id];
    if (!m) return;
    var next = m.visibility === "private" ? "shared" : "private";
    patch("musa_video_projects", id, { visibility: next }).then(function () {
      m.visibility = next;
      toast(next === "private" ? "Ahora es privado: solo tú y los admins lo ven" : "Compartido con tu equipo");
      decorateGrid("videos");
    }, function (er) { toast("No se pudo cambiar: " + (er && er.message || "error")); });
  }

  /* ── clics (addEventListener: convive con los onclick de la maqueta y del portal) ── */
  function onClick(e) {
    if (!real()) return;
    var bar = e.target.closest("[data-mbtags]");
    var view = bar ? bar.getAttribute("data-mbtags") : null;
    var t;
    if ((t = e.target.closest("[data-mbtag]"))) {
      if (!view) return;
      var g = t.getAttribute("data-mbtag"), sel = SEL[view], i = sel.indexOf(g);
      if (i >= 0) sel.splice(i, 1); else sel.push(g);
      if (view === "calendario") { decorateCal(); return; }
      decorateGrid(view);
      return;
    }
    if ((t = e.target.closest("[data-mbtagclear]"))) {
      if (!view) return;
      SEL[view] = [];
      if (view === "calendario") decorateCal(); else decorateGrid(view);
      return;
    }
    if ((t = e.target.closest("[data-mbvistoggle]"))) return toggleVidVis(t.getAttribute("data-mbvistoggle"));
    if ((t = e.target.closest("[data-mbvtags]"))) return tagsPopupVid(t.getAttribute("data-mbvtags"));
    if ((t = e.target.closest("[data-mbcalsave]"))) {
      var db = t.getAttribute("data-mbcalsave"), v = parseTags(document.getElementById("mbCalTags").value);
      t.disabled = true;
      patch("content_calendar", db, { tags: v }).then(function () {
        TAGS.cal[db] = v; toast("Etiquetas guardadas"); refreshCal();
      }, function (er) { t.disabled = false; toast("No se pudo guardar: " + (er && er.message || "error")); });
    }
  }

  /* ── enganches ── */
  function whenReady(fn, tries) {
    if (typeof viewGrid === "function" && typeof viewCalendar === "function" && typeof mx === "function" && typeof uiToast === "function") return fn();
    if ((tries || 0) > 80) return;
    setTimeout(function () { whenReady(fn, (tries || 0) + 1); }, 100);
  }
  whenReady(function () {
    if (!real()) return;                            /* la maqueta demo mantiene su comportamiento */
    var _vg = viewGrid;
    viewGrid = function (key) {
      var r = _vg.apply(this, arguments);
      if (key === "crear/disenos" || key === "crear/videos") { lastView = key.split("/")[1]; refreshGrid(lastView); }
      return r;
    };
    var _vc = viewCalendar;
    viewCalendar = function () {
      var r = _vc.apply(this, arguments);
      lastView = null;
      refreshCal();
      return r;
    };
    document.body.addEventListener("click", onClick);
    var bodyEl = document.getElementById("body");
    if (bodyEl && typeof MutationObserver === "function") {
      new MutationObserver(scheduleApply).observe(bodyEl, { subtree: true, childList: true, attributes: true, attributeFilter: ["style"] });
    }
  });
})();
