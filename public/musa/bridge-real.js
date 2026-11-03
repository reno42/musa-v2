/* bridge-real.js — carril datos (Hermes): pisa las vistas de la maqueta que muestran data
 * inventada (QA 2 nov 2026, hallazgos #35/#56/#64):
 *   1. Medir › Reportes — el dashboard calculaba Alcance/Interacciones/Leads con rand(seed=nombre).
 *      Ahora: piezas publicadas, oportunidades activas, ingresos ganados y contactos nuevos —
 *      conteos REALES del workspace (4 semanas vs 4 previas). Sin proxies ni estimados.
 *   2. Agentes › Gobernanza — el audit log era un array literal fijo. Ahora: actividad real
 *      (últimas actualizaciones de las tablas del workspace) o vacío honesto.
 *   3. Configuración › Papelera — TRASH era demo fijo. Ahora: assets con deleted_at (la misma
 *      fuente que GET /api/assets/trash) con restaurar real (PATCH deleted_at=null).
 * Regla: la maqueta NO se toca. Cargador: "bridge-real.js" en el array "extras" de bridge.js.
 */
(function () {
  var R = null;
  function host() { try { return window.parent !== window ? window.parent : null; } catch (e) { return null; } }
  function bridge() { var h = host(); try { return h && h.__musaBridge ? h.__musaBridge : null; } catch (e) { return null; } }
  function api(path, init) {
    var b = bridge();
    if (!b) return Promise.reject(new Error("sin puente"));
    return b.api(path.charAt(0) === "/" ? path : "/rest/v1/" + path, init);
  }
  function get(path) { return api(path).catch(function (e) { console.warn("[bridge-real] " + path.split("?")[0] + ": " + (e && e.message)); return null; }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function fmt(n) { return Number(n || 0).toLocaleString("es-PE", { maximumFractionDigits: 0 }); }
  function money(n, c) { return (c === "USD" ? "US$ " : "S/ ") + fmt(n); }
  function ready(fn) {
    var t = setInterval(function () {
      try { if (window.__musaReal && window.__musaReal.ws && typeof VIEWS2 !== "undefined") { clearInterval(t); fn(); } } catch (e) {}
    }, 300);
    setTimeout(function () { clearInterval(t); }, 30000);
  }
  function ago(iso) { if (!iso) return "—"; var d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); return d <= 0 ? "hoy" : d === 1 ? "ayer" : "hace " + d + " días"; }
  function inWin(iso, fromDays, toDays) { if (!iso) return false; var t = new Date(iso).getTime(); return t >= Date.now() - fromDays * 86400000 && t < Date.now() - toDays * 86400000; }
  function pill(estado) {
    var c = estado === "Activa" || estado === "Aprobado" || estado === "Entregado" ? "ok" : estado === "Pausada" || estado === "Pausado" ? "warn" : "";
    return '<span class="pill ' + c + '">' + esc(estado || "—") + "</span>";
  }
  function pctDelta(cur, prev) { if (!prev) return ""; return (cur >= prev ? "+" : "−") + Math.abs(Math.round((cur - prev) / prev * 100)) + " %"; }

  /* ═══ 1. Medir › Reportes con datos reales ═══ */
  var REP = { loaded: false, loading: false, byBrand: {}, seq: 0 };
  function loadRep() {
    if (REP.loaded || REP.loading || !R || !R.ws) return Promise.resolve();
    REP.loading = true;
    var mySeq = ++REP.seq;
    var W = encodeURIComponent(R.ws);
    function g(path) { return get(path).then(function (r) { return r || []; }); }
    return Promise.all([
      g("content_calendar?workspace_id=eq." + W + "&select=id,brand_id,status,scheduled_date,published_at&limit=5000"),
      g("crm_deals?workspace_id=eq." + W + "&select=id,brand_id,stage,value,final_value,currency,created_at&limit=5000"),
      g("brands?workspace_id=eq." + W + "&select=id,name,relationship_status&limit=500"),
      g("crm_contacts?workspace_id=eq." + W + "&select=id,brand_id,created_at&limit=5000")
    ]).then(function (res) {
      if (mySeq !== REP.seq) return; /* otra carga más reciente tomó el relevo */
      var cal = res[0], deals = res[1], brands = res[2], contacts = res[3];
      var WON = { approved: 1, in_production: 1, review: 1, ready: 1, delivered: 1 };
      function labelSt(s) { var M = { lead: "Lead", activa: "Activa", active: "Activa", pausada: "Pausada", paused: "Pausada", cliente: "Cliente", approved: "Activa" }; return M[s] || s || "Lead"; }
      var by = {};
      (brands || []).forEach(function (b) { by[b.id] = { name: b.name, estado: labelSt(b.relationship_status), pub: 0, pubPrev: 0, deals: 0, dealsPrev: 0, won: 0, wonPrev: 0, cur: "PEN", contacts: 0 }; });
      (cal || []).forEach(function (c) {
        var b = by[c.brand_id]; if (!b) return;
        var dt = c.published_at || (c.status === "publicada" ? c.scheduled_date : null);
        if (!dt) return;
        if (inWin(dt, 28, 0)) b.pub++; else if (inWin(dt, 56, 28)) b.pubPrev++;
        /* distribución semanal real para repStats (12 semanas hacia atrás desde hoy) */
        var days = Math.floor((Date.now() - new Date(dt).getTime()) / 86400000);
        var wk = 11 - Math.floor(days / 7);
        if (wk >= 0 && wk <= 11) { if (!b.weeksArr) b.weeksArr = Array(12).fill(0); b.weeksArr[wk]++; }
      });
      (deals || []).forEach(function (d) {
        var b = by[d.brand_id]; if (!b) return;
        var v = Number(d.final_value || d.value || 0);
        if (d.currency) b.cur = d.currency;
        if (WON[d.stage]) { if (inWin(d.created_at, 28, 0)) { b.won += v; b.deals++; } else if (inWin(d.created_at, 56, 28)) { b.wonPrev += v; b.dealsPrev++; } }
        else if (d.stage !== "lost") { if (inWin(d.created_at, 28, 0)) b.deals++; else if (inWin(d.created_at, 56, 28)) b.dealsPrev++; }
      });
      (contacts || []).forEach(function (c) {
        var b = by[c.brand_id]; if (!b) return;
        if (inWin(c.created_at, 28, 0)) b.contacts++;
      });
      REP.byBrand = by; REP.loaded = true; REP.loading = false;
    }).catch(function () { REP.loading = false; });
  }

  function overrideReport() {
    if (typeof viewReport !== "function") return;
    viewReport = function () {
      /* NO ejecuta la vista original: su dashboard usa rand(seed=nombre) = data inventada. */
      loadRep().then(function () {
        if (!REP.loaded) { $("#body").innerHTML = '<p class="empty-note">Cargando datos reales…</p>'; return; }
        var brands = Object.keys(REP.byBrand).map(function (k) { return REP.byBrand[k]; });
        var tot = { pub: 0, pubPrev: 0, deals: 0, dealsPrev: 0, won: 0, wonPrev: 0, contacts: 0 };
        brands.forEach(function (b) { ["pub", "pubPrev", "deals", "dealsPrev", "won", "wonPrev", "contacts"].forEach(function (k) { tot[k] += b[k] || 0; }); });
        var cur = "PEN";
        Object.keys(REP.byBrand).forEach(function (k) { if (REP.byBrand[k].won > 0) cur = REP.byBrand[k].cur; });
        var cards = [
          ["Piezas publicadas · 4 sem", fmt(tot.pub), tot.pub, tot.pubPrev, false],
          ["Oportunidades · 4 sem", fmt(tot.deals), tot.deals, tot.dealsPrev, false],
          ["Ingresos ganados · 4 sem", money(tot.won, cur), tot.won, tot.wonPrev, true],
          ["Contactos nuevos · 4 sem", fmt(tot.contacts), tot.contacts, 0, false]
        ];
        var rows = brands.map(function (b) {
          return "<tr><td class=\"first\">" + esc(b.name) + "</td><td>" + pill(b.estado) + "</td><td>" + fmt(b.pub) + "</td><td>" + fmt(b.deals) + "</td><td>" + money(b.won, b.cur) + "</td><td>" + fmt(b.contacts) + "</td></tr>";
        }).join("");
        $("#body").innerHTML = '<div class="grid">' +
          cards.map(function (c) {
            var dl = pctDelta(c[2], c[3]);
            return '<article class="card c3"><div class="ch"><small>' + esc(c[0]) + '</small></div><div class="big tnum"><b>' + c[1] + "</b>" + (dl ? '<em class="delta ' + (c[2] < c[3] ? "down" : "") + '">' + dl + "</em>" : "") + "</div></article>";
          }).join("") +
          '<article class="card c12"><div class="ch"><h3>Por marca</h3><small>Últimas 4 semanas · datos del workspace</small></div><div class="tbl-wrap"><table class="tnum"><thead><tr><th>Marca</th><th>Estado CRM</th><th>Piezas</th><th>Oportunidades</th><th>Ganado</th><th>Contactos</th></tr></thead><tbody>' + (rows || '<tr><td colspan="6" class="empty">Sin datos en este periodo</td></tr>') + "</tbody></table></div></article></div>";
      });
    };
  }

  /* ═══ 2. Gobernanza: audit log real ═══ */
  function overrideGov() {
    if (typeof VIEWS2 === "undefined" || !VIEWS2.gov) return;
    var _v = VIEWS2.gov;
    VIEWS2.gov = function () {
      var W = encodeURIComponent(R.ws);
      Promise.all([
        get("content_calendar?workspace_id=eq." + W + "&select=id,topic,updated_at&order=updated_at.desc&limit=8"),
        get("crm_deals?workspace_id=eq." + W + "&select=id,title,updated_at&order=updated_at.desc&limit=8"),
        get("crm_quotes?workspace_id=eq." + W + "&select=id,number,updated_at&order=updated_at.desc&limit=8"),
        get("workspace_events?workspace_id=eq." + W + "&select=id,name,updated_at&order=updated_at.desc&limit=8")
      ]).then(function (res) {
        var log = [];
        [
          [res[0], "Contenido", function (x) { return "Actualizó la pieza \"" + (x.topic || "sin título") + "\""; }],
          [res[1], "CRM", function (x) { return "Actualizó la oportunidad \"" + (x.title || "sin título") + "\""; }],
          [res[2], "Cotizaciones", function (x) { return "Actualizó la cotización " + (x.number || ""); }],
          [res[3], "Eventos", function (x) { return "Actualizó el evento \"" + (x.name || "sin nombre") + "\""; }]
        ].forEach(function (src) {
          (src[0] || []).forEach(function (x) {
            if (x.updated_at) log.push({ at: new Date(x.updated_at).getTime(), when: ago(x.updated_at), mod: src[1], act: src[2](x) });
          });
        });
        log.sort(function (a, b) { return b.at - a.at; });
        log = log.slice(0, 10);
        _v(); /* pinta políticas + ISO como la maqueta */
        /* reemplaza SOLO la tabla de auditoría */
        var cards = document.querySelectorAll("#body article.card.c12");
        var audit = cards[cards.length - 1];
        if (!audit) return;
        var wrap = audit.querySelector(".tbl-wrap");
        if (!wrap) return;
        var tbody = log.length ? log.map(function (r) {
          return "<tr><td>" + esc(r.when) + "</td><td class=\"first\">" + esc(r.mod) + "</td><td>" + esc(r.act) + "</td><td><span class=\"pill ok\">Registrado</span></td></tr>";
        }).join("") : '<tr><td colspan="4" class="empty">Sin actividad registrada aún en este espacio</td></tr>';
        wrap.innerHTML = '<table class="tnum"><thead><tr><th>Cuándo</th><th>Módulo</th><th>Acción</th><th>Resultado</th></tr></thead><tbody>' + tbody + "</tbody></table>";
        var small = audit.querySelector(".ch small");
        if (small) small.textContent = "Actividad real del espacio (últimas actualizaciones)";
      });
    };
  }

  /* ═══ 3. Papelera real (assets soft-deleted) ═══ */
  function overrideStorage() {
    if (typeof VIEWS2 === "undefined" || !VIEWS2.storage) return;
    var _v = VIEWS2.storage;
    VIEWS2.storage = function () {
      var W = encodeURIComponent(R.ws);
      get("assets?workspace_id=eq." + W + "&deleted_at=not.is.null&select=id,name,mime_type,size_bytes,created_at,deleted_at&order=deleted_at.desc&limit=50").then(function (rows) {
        var items = rows || [];
        _v(); /* pinta la vista original (espacio usado sigue siendo agregado informativo) */
        var cards = document.querySelectorAll("#body article.card.c12");
        var trash = cards[cards.length - 1];
        if (!trash) return;
        var list = trash.querySelector(".list");
        if (!list) return;
        if (!items.length) {
          list.innerHTML = '<p class="empty-note">La papelera está vacía.</p>';
          var ctl = trash.querySelector(".ag-ctl");
          if (ctl) ctl.remove();
          var small0 = trash.querySelector(".ch small");
          if (small0) small0.textContent = "Se borra sola a los 30 días · archivos eliminados de este espacio";
          return;
        }
        list.innerHTML = items.map(function (t) {
          var d = Math.floor((Date.now() - new Date(t.deleted_at).getTime()) / 86400000);
          var left = 30 - d;
          return '<div class="li"><span class="dot" style="background:' + (left <= 5 ? "var(--danger)" : "var(--l3)") + '"></span><div><b>' + esc(t.name || t.id) + "</b><p>Archivo · eliminado hace " + d + " día" + (d === 1 ? "" : "s") + (left > 0 ? " · se borra en " + left + " días" : " · se borrará hoy") + "</p></div>" +
            '<div class="meta"><button class="btn btn-g" style="height:28px;padding:0 10px;font-size:11.5px" data-rs-id="' + esc(t.id) + '">Restaurar</button></div></div>';
        }).join("");
        list.onclick = function (e) {
          var b = e.target.closest("[data-rs-id]");
          if (!b) return;
          api("/rest/v1/assets?id=eq." + encodeURIComponent(b.dataset.rsId), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deleted_at: null }) })
            .then(function () { uiToast("Restaurado"); overrideStorage(); })
            .catch(function (err) { uiToast("No se pudo restaurar: " + (err && err.message || "error")); });
        };
        var emptyBtn = trash.querySelector('[data-st="empty"]');
        if (emptyBtn) {
          emptyBtn.onclick = function () {
            Promise.all(items.map(function (t) {
              return api("/rest/v1/assets?id=eq." + encodeURIComponent(t.id), { method: "DELETE" });
            })).then(function () { uiToast("Papelera vaciada"); overrideStorage(); }).catch(function () { uiToast("No se pudo vaciar"); });
          };
        }
        var small = trash.querySelector(".ch small");
        if (small) small.textContent = "Se borra sola a los 30 días · archivos eliminados de este espacio";
      });
    };
  }

  /* ═══ 4. Los modales (.mx) deben cerrarse al navegar (QA #66: NEW QUOTE sobrevivía
   * cambios de ruta). go() es la función del router (global, reasignable): la envolvemos
   * para ocultar mxEl —y su toast de acción— en cada render de vista. */
  function overrideRouterCloseModals() {
    if (typeof go !== "function") return;
    var _go = go;
    go = function () {
      try {
        if (typeof mxEl !== "undefined" && mxEl && !mxEl.hidden) mxEl.hidden = true;
      } catch (e) {}
      return _go.apply(this, arguments);
    };
    /* por si la navegación llega por hashchange registrado antes que este bridge */
    window.addEventListener("hashchange", function () {
      try { if (typeof mxEl !== "undefined" && mxEl && !mxEl.hidden) mxEl.hidden = true; } catch (e) {}
    });
  }

  /* ═══ 5. repStats real (QA: el funnel, el portal del cliente, los loops y el contador de
   * leads de la tabla Vender leían de rand(seed=nombre de marca)). Pisa la función global
   * con conteos reales por marca desde REP (calendario + deals + contacts). Los campos que
   * la maqueta espera (weeks, chans, leads…) rellenos con datos del workspace; lo que la
   * base no tiene queda en 0 — sin inventar. */
  function overrideRepStats() {
    if (typeof repStats !== "function") return;
    repStats = function (row) {
      var name = row[0], estado = row[5];
      var chansRaw = String(row[3] || "").split("·").map(function (c) { return c.trim(); }).filter(function (c) { return c && c !== "—"; });
      var chans = {};
      chansRaw.forEach(function (c) { chans[c] = 0; });
      var base = { name: name, estado: estado, row: row, weeks: Array(12).fill(0), chans: chans, reach: 0, reachPrev: 0, inter: 0, interPrev: 0, pieces: 0, piecesPrev: 0, leads: 0, leadsPrev: 0 };
      if (!REP.loaded) return base;
      var hit = null;
      Object.keys(REP.byBrand).forEach(function (k) { if (REP.byBrand[k].name === name) hit = REP.byBrand[k]; });
      if (!hit) return base;
      /* repartir las publicaciones reales en las 12 semanas del dashboard (semana = 7 días,
       * ventana completa de 12 semanas terminando hoy) */
      var sum = function (a) { return a.reduce(function (x, y) { return x + y; }, 0); };
      base.weeks = hit.weeksArr || base.weeks;
      base.reach = sum(base.weeks.slice(8));
      base.reachPrev = sum(base.weeks.slice(4, 8));
      base.inter = hit.contacts || 0;
      base.interPrev = 0;
      base.pieces = hit.pub || 0;
      base.piecesPrev = hit.pubPrev || 0;
      base.leads = hit.deals || 0;
      base.leadsPrev = hit.dealsPrev || 0;
      return base;
    };
  }

  /* ═══ 6. Responsive (QA: calendar overflow en móvil, kanban tablet ilegible). La maqueta
   * no se toca: este bridge inyecta CSS. El calendario de contenido baja de 7 columnas
   * rígidas a scroll horizontal con día mínimo usable, y el kanban pasa a 1 columna en
   * pantallas angostas. También tapa el .mc-side que se apila. */
  function injectResponsiveCSS() {
    if (document.getElementById("br-real-css")) return;
    var st = document.createElement("style");
    st.id = "br-real-css";
    st.textContent = [
      /* calendario de contenido (mc-grid 7 cols): en móvil, scroll horizontal con celda mínima */
      "@media (max-width:720px){",
      "  .mc{grid-template-columns:minmax(0,1fr)}",
      "  .mc-side{width:100%}",
      "  .mc-grid-wrap, .mc > .mc-grid{overflow-x:auto;-webkit-overflow-scrolling:touch}",
      "  .mc-grid{min-width:640px}",
      "  .mc-grid .d{min-height:72px}",
      "  .mc-grid .mc-it{white-space:normal;font-size:9.5px;line-height:1.25}",
      "  .kh{grid-template-columns:minmax(0,1fr)}",
      "  .kh .col{min-height:120px}",
      "  .filters, .flt-bar{flex-wrap:wrap}",
      "  .flt-bar .fdd-pop{max-width:86vw}",
      "}",
      /* tablet angosta: kanban de 2 col todavía aprieta -> 2 col solo entre 721-1000px */
      "@media (min-width:721px) and (max-width:1000px){",
      "  .kh{grid-template-columns:1fr 1fr}",
      "  .mc-grid .d{min-height:88px}",
      "  .mc-grid .mc-it{font-size:10px}",
      "}"
    ].join("\n");
    document.head.appendChild(st);
  }

  ready(function () {
    R = window.__musaReal;
    injectResponsiveCSS();
    overrideRouterCloseModals();
    overrideRepStats();
    overrideReport();
    overrideGov();
    overrideStorage();
  });
})();
