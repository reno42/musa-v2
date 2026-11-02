/* bridge-data.js — carril datos (Hermes) para los módulos que bridge.js no cubre.
 * Regla: la maqueta NO se toca. Este puente LEE de PostgREST y llena los arrays que
 * wipeDemo() vacía (briefs, cotizaciones, fees, proyectos, formularios, mailing,
 * secuencias, eventos, ads) con filas reales del workspace, y PERSISTE las acciones
 * que las vistas ya hacen en memoria (PATCH/POST por el api() del padre).
 * Lo que en la base está vacío queda vacío. Sin datos inventados.
 * Cargador: bridge.js (array "extras"). Se ejecuta DESPUÉS de que bridge.js definió
 * window.__musaReal y los arrays globales de la maqueta son accesibles por scope global.
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
  function get(path) { return api(path).catch(function (e) { console.warn("[bridge-data] " + path.split("?")[0] + ": " + (e && e.message)); return null; }); }
  function post(table, body) {
    return api("/rest/v1/" + table, { method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(body) });
  }
  function patch(table, id, body) {
    return api("/rest/v1/" + table + "?id=eq." + encodeURIComponent(id), { method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(body) })
      .catch(function (e) { uiToast("No se pudo guardar: " + (e && e.message || "error")); throw e; });
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function ago2(iso) { if (!iso) return "—"; var d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); return d <= 0 ? "hoy" : d === 1 ? "ayer" : "hace " + d + " días"; }
  function bn(id) { return (id && R.brandName[id]) || null; }
  function bid(name) { return (name && R.brandId[name]) || null; }
  function ws() { return R.ws; }
  function rerender() {
    try { if (!(FL && FL.open) && !(ED && ED.open) && !(VE && VE.open)) go(); } catch (e) {}
  }

  /* ── mapeos estado BD → etiquetas de la maqueta ── */
  var ST_BRIEF = { borrador: "Por completar", por_completar: "Por completar", aprobado: "Aprobado", en_proyecto: "En proyecto" };
  var ST_QUOTE = { borrador: "Borrador", enviada: "Enviada", firmada: "Firmada", rechazada: "Rechazada" };
  var ST_PROJ = { planning: "Planificando", planificando: "Planificando", production: "En producción", en_produccion: "En producción", in_progress: "En producción", awaiting_signature: "Esperando firma", esperando_firma: "Esperando firma", paused: "Pausado", pausado: "Pausado", delivered: "Entregado", entregado: "Entregado", done: "Entregado" };
  var ST_MAIL = { borrador: "Borrador", programado: "Programada", enviada: "Enviada", enviando: "Enviando", automatica: "Automática" };
  var ST_CAMP = { activa: "Activa", activo: "Activa", programada: "Programada", pausada: "Pausada", finalizada: "Finalizada", borrador: "Borrador" };
  var ST_FORM = { activo: "Activo", activa: "Activo", pausado: "Pausado", pausa: "Pausado" };

  /* ── 1. briefs ── */
  function fillBriefs(rows) {
    if (typeof BRIEFS === "undefined") return;
    BRIEFS.length = 0;
    (rows || []).forEach(function (b) {
      var f = (b.content && typeof b.content === "object" && b.content.fields) ? b.content.fields : {
        "Objetivo": b.objective || "— por completar",
        "Público": b.audience || "—",
        "Mensaje clave": (b.content && b.content.message) || "—",
        "Entregables": Array.isArray(b.deliverables) && b.deliverables.length ? b.deliverables.join(", ") : "—",
        "Canales": (b.content && b.content.channels) || "—",
        "Fechas": (b.content && b.content.dates) || (b.due_date ? String(b.due_date) : "—"),
        "Presupuesto": (b.content && b.content.budget) || (b.budget ? "S/ " + b.budget : "— por definir")
      };
      if (f["Presupuesto"] == null) f["Presupuesto"] = "— por definir";
      if (f["Fechas"] == null) f["Fechas"] = "—";
      Object.keys(f).forEach(function (k) { if (typeof f[k] !== "string") f[k] = String(f[k]); });
      BRIEFS.push({ id: "b_" + b.id, db: b.id, brand: bn(b.brand_id) || b.brand_name || "—", name: b.title || "Sin título", st: ST_BRIEF[b.status] || "Por completar", by: (b.created_by ? "el equipo" : "el cliente"), f: f });
    });
    if (typeof CL !== "undefined" && !BRIEFS.some(function (x) { return x.id === CL.brief; }) && BRIEFS.length) CL.brief = BRIEFS[0].id;
  }

  /* ── 2. tarifario + cotizaciones (qTotal usa índices de RATES: se reconstruye igual) ── */
  var RATES_DEFAULT = [["Post o carrusel", 180, "pieza"], ["Story", 90, "pieza"], ["Reel editado", 450, "pieza"], ["Video largo (3 min)", 1200, "pieza"], ["Lookbook / catálogo", 1500, "pieza"], ["Gestión de ads", 900, "mes"], ["Community management", 1600, "mes"], ["Sesión de fotos", 1100, "día"]];
  function rebuildRates(rows) {
    if (typeof RATES === "undefined") return false;
    RATES.length = 0;
    (rows || []).forEach(function (r) { RATES.push([r.label, Number(r.price), r.unit || "pieza"]); });
    return RATES.length > 0;
  }
  function fillQuotes(rows) {
    if (typeof QUOTES === "undefined") return;
    QUOTES.length = 0;
    (rows || []).forEach(function (q) {
      var idxOf = {};
      (RATES || []).forEach(function (r, i) { idxOf[r[0]] = i; });
      var items = (q.items || []).map(function (it) {
        if (Array.isArray(it) && typeof it[0] === "number") return [it[0], it[1]];
        if (it && it.label != null && idxOf[it.label] != null) return [idxOf[it.label], it.qty || 1];
        return null;
      }).filter(Boolean);
      QUOTES.push({ id: "q_" + q.id, db: q.id, n: q.number || "COT", brand: q.brand_name || bn(q.brand_id) || "—", t: q.title || "Sin título", st: ST_QUOTE[q.status] || "Borrador", items: items, when: q.sent_at || null });
    });
    if (typeof CL !== "undefined" && !QUOTES.some(function (x) { return x.id === CL.quote; }) && QUOTES.length) CL.quote = QUOTES[0].id;
  }

  /* ── 3. fees y horas ── */
  function fillFees(rows) {
    if (typeof FEES === "undefined") return;
    FEES.length = 0;
    (rows || []).forEach(function (f) {
      FEES.push([f.brand_name || bn(f.brand_id) || "—", Number(f.monthly_fee) || 0, Number(f.hours_included) || 0, Number(f.hours_used) || 0, f.pieces_included || 0, f.pieces_delivered || 0, (f.out_of_scope || [])]);
      FEES[FEES.length - 1].db = f.id;
    });
  }

  /* ── 4. proyectos ── */
  function fillProjects(rows, tasks) {
    if (typeof PROJ === "undefined") return;
    PROJ.length = 0;
    var byP = {};
    (tasks || []).forEach(function (t) { (byP[t.project_id] = byP[t.project_id] || []).push(t); });
    (rows || []).forEach(function (p) {
      var w = p.starts_on && p.ends_on ? p.starts_on.slice(5) + " – " + p.ends_on.slice(5) : p.starts_on ? "desde " + p.starts_on.slice(5) : "—";
      var tks = byP[p.id] || [];
      var apr = {}; tks.forEach(function (t, i) { if (t.status && t.status !== "todo") apr[i] = t.kind === "cliente" ? "cliente" : "interna"; });
      PROJ.push({ id: "p_" + p.id, db: p.id, brand: p.brand_name || bn(p.brand_id) || "—", name: p.name || "Proyecto", st: ST_PROJ[p.status] || "Planificando", when: w, budget: Number(p.budget) || 0, spent: Number(p.spent) || 0, h: [Math.round(Number(p.hours_planned) || 0), Math.round(Number(p.hours_used) || 0)], team: Array.isArray(p.team) ? p.team : [], files: [], done: tks.filter(function (t) { return t.status === "done"; }).length, apr: apr });
    });
    if (typeof PJ !== "undefined" && !PROJ.some(function (x) { return x.id === PJ.sel; })) PJ.sel = null;
  }

  /* ── 5. formularios ── */
  function fillForms(rows) {
    if (typeof FORMS === "undefined") return;
    FORMS.length = 0;
    (rows || []).forEach(function (f) {
      var sch = f.schema || {};
      var fields = (sch.fields || []).map(function (x) { return [x.label || x.name || "Campo", [x.type || "Texto", x.required ? "obligatorio" : ""].filter(Boolean).join(" · ")]; });
      FORMS.push({ db: f.id, name: f.name || "Formulario", brand: bn(sch.brand_id) || "—", type: sch.type || "Contacto", st: f.published ? "Activo" : "Pausado", leads: f.response_count || 0, conv: "—", fields: fields, url: f.public_url || "" });
    });
  }

  /* ── 6/7. mailing y secuencias (una tabla, kind = campana | secuencia) ── */
  function epoch(d, h) { if (!d) return null; var x = new Date(d); if (h != null) x.setHours(h, 0, 0, 0); return x.getTime(); }
  function fillMailing(rows) {
    if (typeof MAILS === "undefined") return;
    MAILS.length = 0;
    (rows || []).filter(function (m) { return (m.kind || "campana") === "campana"; }).forEach(function (m) {
      var c = m.content || {};
      MAILS.push({ id: "m_" + m.id, db: m.id, html: c.html || null, name: c.name || m.subject, brand: bn(c.brand_id) || "—", subject: m.subject || "", seg: c.seg || "Todos", tpl: c.tpl || "news", when: m.send_at ? "date" : "trigger", at: epoch(m.send_at, 9), status: ST_MAIL[m.status] || "Borrador", sent: c.sent || 0, open: c.open || 0, click: c.click || 0 });
    });
  }
  function fillSequences(rows) {
    if (typeof SQS === "undefined") return;
    SQS.length = 0;
    (rows || []).filter(function (m) { return m.kind === "secuencia"; }).forEach(function (m) {
      var c = m.content || {};
      SQS.push({ id: "q_" + m.id, db: m.id, name: c.name || m.subject || "Secuencia", brand: bn(c.brand_id) || "—", groups: c.groups || [], trig: "entra", status: m.status === "activa" ? "Activa" : m.status === "pausada" ? "Pausada" : "Borrador", inside: c.inside || 0, done: c.done || 0, steps: (c.steps || []).map(function (s) { return { d: s.d || 0, subject: s.subject || "", tpl: s.tpl || "news" }; }) });
    });
  }

  /* ── 8. eventos + inscritos ── */
  function fillEvents(evRows, regRows) {
    if (typeof EV === "undefined") return;
    EV.length = 0;
    var byE = {};
    (regRows || []).forEach(function (r) { (byE[r.event_id] = byE[r.event_id] || []).push(r); });
    (evRows || []).forEach(function (e) {
      var regs = byE[e.id] || [];
      var base = (typeof evDefaults === "function") ? evDefaults() : { cd: {}, comms: {} };
      var item = { id: "e_" + e.id, db: e.id, name: e.name || "Evento", brand: bn(e.brand_id) || "—", start: e.starts_at ? new Date(e.starts_at).getTime() : epoch(e.date, 19), link: e.link || "", plat: e.platform === "zoom" ? "zoom" : "meet", cap: e.capacity || 100, regs: regs.length, dur: e.duration_min || 60, desc: e.description || e.location || "", attendees: e.attendees || null, slug: e.slug || null, pub: !!e.published };
      if (e.cover_url) item.cover = e.cover_url;
      Object.keys(base).forEach(function (k) { if (item[k] === undefined) item[k] = base[k]; });
      if (base.cd) item.cd = base.cd; if (base.comms) item.comms = base.comms;
      EV.push(item);
    });
    if (typeof EV_REGS !== "undefined") {
      EV_REGS.length = 0;
      (regRows || []).forEach(function (r) {
        EV_REGS.push({ db: r.id, name: r.name || "—", email: r.email || "", ev: "e_" + r.event_id, origin: r.status === "asistio" ? "Asistió" : "", status: r.status === "asistio" ? "Asistió" : r.status === "no_asistio" ? "No asistió" : "Confirmado", when: ago2(r.created_at) });
      });
    }
  }

  /* ── 9. ads (campañas propias; métricas de plataformas quedan en 0 hasta conectar) ── */
  function fillAds(rows) {
    if (typeof ADS === "undefined") return;
    ADS.length = 0;
    var t0 = Date.now();
    (rows || []).forEach(function (c) {
      var bj = {}; try { bj = c.brief && c.brief.charAt(0) === "{" ? JSON.parse(c.brief) : { obj: c.brief }; } catch (e) { bj = { obj: c.brief }; }
      ADS.push({ id: "a_" + c.id, db: c.id, name: c.name || "Campaña", brand: bn(c.brand_id) || "—", net: (typeof AD_NETS !== "undefined" && AD_NETS[bj.net]) ? bj.net : "meta", obj: bj.obj || "Ventas", status: ST_CAMP[c.status] || "Borrador", budget: Number(c.budget_plan_usd) || 0, spend: 0, start: t0, end: t0 + 14 * 864e5, impr: 0, clicks: 0, res: 0, resLbl: "resultados", rev: 0, aud: "", crea: 0 });
    });
  }

  /* ── escrituras: inbox / comentarios ── */
  function realMembers() { return Object.keys(R.people || {}); }
  function hookInbox() {
    if (typeof ibBind !== "function") return;
    var _ib = ibBind;
    ibBind = function () {
      _ib();
      var _orig = $("#body").onclick;
      $("#body").onclick = function (e) {
        var b = e.target.closest("[data-iba]");
        if (b) {
          var x = IB_ITEMS.find(function (it) { return it.id === IB.sel; }), k = b.dataset.iba;
          if (x && x.db) {
            if (k === "send") { var t = ($("#ibR") || {}).value; t = (t || "").trim(); if (t) patch("social_inbox", x.db, { status: "replied", reply_text: t, replied_at: new Date().toISOString() }); }
            if (k === "done") patch("social_inbox", x.db, { status: x.status === "done" ? "nuevo" : "done" });
            if (k === "assign") { var ids = realMembers(); if (ids.length) { x._ai = ((x._ai || 0) + 1) % ids.length; patch("social_inbox", x.db, { assigned_to: ids[x._ai] }); x.assigned = R.people[ids[x._ai]]; return viewInbox(); } else uiToast("No hay más personas en el equipo todavía"); }
            if (k === "deal") { var d = { workspace_id: ws(), brand_id: bid(x.brand), title: (x.brand || "Marca") + " · " + x.who, stage: "discovery", currency: "PEN" }; post("crm_deals", d).then(function () { uiToast("Oportunidad creada en Vender"); }, function (er) { uiToast("No se pudo crear: " + (er && er.message || "error")); }); }
          }
        }
        return _orig ? _orig(e) : undefined;
      };
    };
  }
  function hookComments() {
    if (typeof VIEWS2 === "undefined" || !VIEWS2.comments) return;
    var _vc = VIEWS2.comments;
    VIEWS2.comments = function () {
      _vc();
      var _orig = $("#body").onclick;
      $("#body").onclick = function (e) {
        var b = e.target.closest("[data-cma]");
        if (b) {
          var x = IB_ITEMS[CM.sel], k = b.dataset.cma;
          if (x && x.db) {
            if (k === "send") { var t = ($("#cmR") || {}).value; t = (t || "").trim(); if (t) patch("social_inbox", x.db, { status: "replied", reply_text: t, replied_at: new Date().toISOString() }); }
            if (k === "done") patch("social_inbox", x.db, { status: x.status === "done" ? "nuevo" : "done" });
            if (k === "hide") patch("social_inbox", x.db, { status: "hidden" });
            if (k === "deal") { var d = { workspace_id: ws(), brand_id: bid(x.brand), title: (x.brand || "Marca") + " · " + x.who, stage: "discovery", currency: "PEN" }; post("crm_deals", d).then(function () { uiToast("Oportunidad creada en Vender"); }, function (er) { uiToast("No se pudo crear: " + (er && er.message || "error")); }); }
          }
        }
        return _orig ? _orig(e) : undefined;
      };
    };
  }

  /* ── escrituras: briefs (convertir en proyecto), cotizaciones (enviar/firmar), fees (log/absorber) ── */
  function hookClBriefs() {
    if (typeof VIEWS2 === "undefined" || !VIEWS2.clBriefs) return;
    var _v = VIEWS2.clBriefs;
    VIEWS2.clBriefs = function () {
      if (typeof CL !== "undefined" && typeof BRIEFS !== "undefined" && BRIEFS.length && !BRIEFS.some(function (x) { return x.id === CL.brief; })) CL.brief = BRIEFS[0].id;
      _v();
      var _orig = $("#body").onclick;
      $("#body").onclick = function (e) {
        var a = e.target.closest("[data-ba]");
        if (a && a.dataset.ba === "proj") {
          var b = BRIEFS.find(function (x) { return x.id === CL.brief; });
          if (b && b.db) patch("briefs", b.db, { status: "en_proyecto" });
        }
        return _orig ? _orig(e) : undefined;
      };
    };
  }
  function hookClQuotes() {
    if (typeof VIEWS2 === "undefined" || !VIEWS2.clQuotes) return;
    var _v = VIEWS2.clQuotes;
    VIEWS2.clQuotes = function () {
      if (typeof CL !== "undefined" && typeof QUOTES !== "undefined" && QUOTES.length && !QUOTES.some(function (x) { return x.id === CL.quote; })) CL.quote = QUOTES[0].id;
      _v();
      var _orig = $("#body").onclick;
      $("#body").onclick = function (e) {
        var a = e.target.closest("[data-qa]");
        if (a && a.dataset.qa === "send") {
          var q = QUOTES.find(function (x) { return x.id === CL.quote; });
          if (q && q.db) {
            var nxt = q.st === "Borrador" ? "enviada" : "firmada";
            patch("crm_quotes", q.db, { status: nxt, sent_at: nxt === "enviada" ? new Date().toISOString() : q.when, signed_at: nxt === "firmada" ? new Date().toISOString() : null });
          }
        }
        return _orig ? _orig(e) : undefined;
      };
    };
  }
  function hookClFees() {
    if (typeof VIEWS2 === "undefined" || !VIEWS2.clFees) return;
    var _v = VIEWS2.clFees;
    VIEWS2.clFees = function () {
      _v();
      var _orig = $("#body").onclick;
      $("#body").onclick = function (e) {
        var a = e.target.closest("[data-fa]");
        if (a) {
          var f = FEES[+a.dataset.i], k = a.dataset.fa;
          if (f && f.db) {
            if (k === "log") patch("workspace_fees", f.db, { hours_used: Number(f[3]) + 2 });
            if (k === "ok") patch("workspace_fees", f.db, { out_of_scope: [] });
          }
        }
        return _orig ? _orig(e) : undefined;
      };
    };
  }

  /* ── escrituras: alta de campaña (Anunciar › Crear) y brief desde el portal ── */
  function hookAdsCreate() {
    if (typeof adsCampBind !== "function") return;
    var _b = adsCampBind;
    adsCampBind = function () {
      _b();
      var _orig = $("#body").onclick;
      $("#body").onclick = function (e) {
        var a = e.target.closest('[data-ada="create"]');
        if (a) {
          var g = function (id) { var el = $(id); return el ? el.value : null; };
          var nameEl = $("#anN") || document.querySelector("aside input");
          var camp = {
            id: "c" + Date.now().toString(36),
            workspace_id: ws(),
            brand_id: (function () { var s = $("#anB"); return s && bid(s.value); })(),
            name: (nameEl && nameEl.value.trim()) || "Campaña sin nombre",
            status: "programada",
            campaign_type: (g("#anR") || "meta"),
            brief: (g("#anO") || "Ventas"),
            budget_plan_usd: Number(g("#anP")) || 0
          };
          if (!camp.brand_id) { uiToast("Elige la marca de la campaña"); return; }
          post("campaigns", camp).then(function () { uiToast("Campaña creada · «" + esc(camp.name) + "» guardada"); ADS.push({ id: "a_" + camp.id, db: camp.id, name: camp.name, brand: (camp.brand_id && R.brandName[camp.brand_id]) || "—", net: camp.campaign_type, obj: camp.brief, status: "Programada", budget: camp.budget_plan_usd, spend: 0, start: Date.now(), end: Date.now() + 14 * 864e5, impr: 0, clicks: 0, res: 0, resLbl: "resultados", rev: 0, aud: "", crea: 0 }); rerender(); }, function (er) { uiToast("No se pudo crear: " + (er && er.message || "error")); });
          return;
        }
        return _orig ? _orig(e) : undefined;
      };
    };
  }
  function hookPortalBrief() {
    if (typeof VIEWS2 === "undefined" || !VIEWS2.ptBriefs) return;
    document.addEventListener("click", function (e) {
      if (!e.target.closest("[data-ptbrief]")) return;
      var inp = $("#ptBn"), t = inp && inp.value.trim();
      if (!t) return;
      var portalBrand = (typeof CL !== "undefined" && CL.portal) || null;
      post("briefs", { workspace_id: ws(), brand_id: bid(portalBrand), title: t, status: "por_completar", content: { from: "portal", brand_name: portalBrand } }).then(function () { uiToast("Brief guardado"); }, function (er) { uiToast("No se pudo guardar el brief: " + (er && er.message || "error")); });
    }, true);
  }

  /* ── arranque de datos por workspace ── */
  var _loading = false;
  function fillAll() {
    if (_loading) return; _loading = true;
    var W = ws();
    var q = function (t, sel, extra) { return "/rest/v1/" + t + "?workspace_id=eq." + encodeURIComponent(W) + "&select=" + sel + (extra || ""); };
    Promise.all([
      get(q("briefs", "id,title,status,objective,audience,tone,deliverables,content,brand_id,brand_name,due_date,budget,created_by", "&order=updated_at.desc&limit=100")),
      get(q("workspace_rates", "id,label,price,unit,sort", "&order=sort.asc&limit=50")),
      get(q("crm_quotes", "id,number,brand_id,brand_name,title,status,items,currency,sent_at,signed_at", "&order=updated_at.desc&limit=100")),
      get(q("workspace_fees", "id,brand_id,brand_name,monthly_fee,currency,hours_included,hours_used,pieces_included,pieces_delivered,out_of_scope", "&order=updated_at.desc&limit=50")),
      get(q("workspace_projects", "id,brand_id,brand_name,name,status,starts_on,ends_on,budget,spent,hours_planned,hours_used,team,progress", "&order=updated_at.desc&limit=100")),
      get(q("workspace_project_tasks", "id,project_id,title,kind,status,due", "&order=updated_at.desc&limit=300")),
      get(q("workspace_forms", "id,name,published,response_count,public_url,schema", "&order=updated_at.desc&limit=50")),
      get(q("workspace_mailings", "id,subject,status,send_at,kind,content", "&order=updated_at.desc&limit=100")),
      get(q("workspace_events", "id,name,date,location,attendees,starts_at,duration_min,platform,link,capacity,brand_id,description,slug,published,cover_url", "&order=date.asc&limit=60")),
      get(q("workspace_event_regs", "id,event_id,name,email,status,created_at", "&limit=300")),
      get(q("campaigns", "id,brand_id,name,status,campaign_type,brief,budget_plan_usd", "&order=updated_at.desc&limit=60"))
    ]).then(function (r) {
      if (R.ws !== W) { _loading = false; return; }
      /* tarifario: si el workspace no tiene, se siembra con el estándar de la maqueta */
      var rates = r[1] || [];
      var seed = rates.length ? Promise.resolve() : post("workspace_rates", RATES_DEFAULT.map(function (x, i) { return { workspace_id: W, label: x[0], price: x[1], unit: x[2], sort: i }; })).then(function () { return get(q("workspace_rates", "id,label,price,unit,sort", "&order=sort.asc&limit=50")); }, function () { return null; });
      seed.then(function (fresh) {
        rebuildRates(fresh && fresh.length ? fresh : rates);
        fillBriefs(r[0]);
        fillQuotes(r[2]);
        fillFees(r[3]);
        fillProjects(r[4], r[5]);
        fillForms(r[6]);
        fillMailing(r[7]);
        fillSequences(r[7]);
        fillEvents(r[8], r[9]);
        fillAds(r[10]);
        rerender();
        _loading = false;
      });
    });
  }
  function boot() {
    R = window.__musaReal;
    if (!R || !R.on) return setTimeout(boot, 250);
    hookInbox(); hookComments(); hookClBriefs(); hookClQuotes(); hookClFees(); hookPortalBrief();
    R.reloadData = function () { _loading = false; fillAll(); };
    fillAll();
    setInterval(function () { if (window.__musaReal && window.__musaReal.on && R.ws !== (R._bdWs || null)) { R._bdWs = R.ws; fillAll(); } }, 2000);
    R._bdWs = R.ws;
  }
  boot();
})();
