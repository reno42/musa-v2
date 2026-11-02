/* bridge.js — conecta la maqueta (index.html, intacta) con los datos reales de Musa.
 * Regla: el diseño no se toca. Solo se reemplazan los arreglos de datos de ejemplo
 * (marcas, diseños, calendario, tareas…) por los del workspace real y se vuelve a pintar.
 * Lo que en la base está vacío queda vacío: no se muestran clientes ni piezas inventadas.
 */
(function () {
  var host = null;
  try { host = window.parent !== window ? window.parent : null; } catch (e) { host = null; }

  function syncHash() {
    if (!host) return;
    try { var h = window.__musaReal && window.__musaReal.stableHash ? window.__musaReal.stableHash(location.hash) : location.hash; host.history.replaceState(null, "", "/" + h); } catch (e) {}
  }
  window.addEventListener("hashchange", syncHash);
  syncHash();

  function bridge() { try { return host && host.__musaBridge; } catch (e) { return null; } }

  /* ── utilidades ── */
  var R = { on: false, ws: null, me: null, thumb: {}, brandName: {}, brandId: {}, people: {}, tpl: [], vids: [], cache: {} };
  window.__musaReal = R;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function money(v, cur) {
    if (v == null || !isFinite(v)) return "—";
    var sym = cur === "PEN" || !cur ? "S/" : cur === "USD" ? "US$" : cur;
    return sym + " " + Math.round(v).toLocaleString("es-PE").replace(/,/g, " ");
  }
  function days(iso) { return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null; }
  function ago(iso) { var d = days(iso); return d == null ? "—" : d <= 0 ? "hoy" : d === 1 ? "ayer" : "hace " + d + " días"; }
  function initials(n) { return String(n || "?").trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0] || ""; }).join("").toUpperCase() || "?"; }
  function clear(a) { if (Array.isArray(a)) a.length = 0; }
  function clearObj(o) { Object.keys(o).forEach(function (k) { delete o[k]; }); }
  function shortName(n) { var p = String(n || "").split(/\s+/); return p.length > 1 ? p[0] + " " + p[1][0] + "." : p[0] || "—"; }

  function api(path, init) {
    var b = bridge();
    if (!b) return Promise.reject(new Error("sin puente"));
    return b.api("/rest/v1/" + path, init);
  }
  function get(path) { return api(path).catch(function (e) { console.warn("[bridge] " + path.split("?")[0] + ": " + (e && e.message)); return null; }); }
  function patch(table, id, body) {
    return api(table + "?id=eq." + encodeURIComponent(id), { method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(body) })
      .catch(function (e) { uiToast("No se pudo guardar: " + (e && e.message || "error")); throw e; });
  }

  var STAGES = [["discovery", "Prospecto"], ["proposal", "Propuesta"], ["negotiation", "Negociación"], ["approved", "Ganado"]];
  var WON = { approved: 1, in_production: 1, review: 1, ready: 1, delivered: 1 };
  var stageCol = function (st) { st = st || "discovery"; return WON[st] ? "approved" : st; };
  var STAGE_LBL = { discovery: "Prospecto", proposal: "Propuesta", negotiation: "Negociación", approved: "Cliente", in_production: "Cliente", review: "Cliente", ready: "Cliente", delivered: "Cliente", lost: "Perdido" };
  var NET = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", linkedin: "LinkedIn", youtube: "YouTube", x: "X", twitter: "X", threads: "Threads", email: "Email", web: "Sitio web", whatsapp: "WhatsApp" };
  var NET_IB = { instagram: "ig", facebook: "fb", tiktok: "tt", linkedin: "li", youtube: "yt", whatsapp: "wa", email: "em", x: "x", twitter: "x" };
  var TASK_COL = { backlog: "todo", draft: "todo", todo: "todo", design: "doing", doing: "doing", in_progress: "doing", review: "review", feedback: "review", done: "done", published: "done" };
  var COL_TASK = { todo: "backlog", doing: "design", review: "review", done: "done" };

  /* ── 1. espacios y persona reales ── */
  function setupWorkspaces(b, list) {
    var me = b.accountName || b.userEmail || "Tú";
    R.me = me;
    clearObj(PERSONAS);
    PERSONAS.me = { name: me, ini: initials(me), sub: b.userEmail || "", mem: {} };
    if (!R.demoWSS) { R.demoWSS = {}; Object.keys(WSS).forEach(function (k) { R.demoWSS[k] = WSS[k]; }); }
    clearObj(WSS);
    var ROLE = { owner: "Dueño", admin: "Admin", editor: "Editor", viewer: "Lectura" };
    list.forEach(function (m) {
      var w = m.workspaces || {}, id = m.workspace_id, personal = /^ws_user_/.test(id) || id === "default";
      var name = (personal && id !== "default") ? me : (w.name || id);
      var corp = R.accessPlan === "corporate";
      WSS[id] = { name: name, ini: initials(name), plan: corp ? "corp" : personal ? "personal" : "agencia", tier: corp ? "Corporativo" : personal ? "Personal" : "Agencia", desc: personal ? "Tu espacio personal" : "Espacio de trabajo", own: name, brands: [], team: [] };
      PERSONAS.me.mem[id] = ROLE[m.role] || m.role || "Miembro";
    });
    if (!WSS[b.workspaceId]) {
      WSS[b.workspaceId] = { name: me, ini: initials(me), plan: "personal", tier: "Personal", desc: "Tu espacio personal", own: me, brands: [], team: [] };
      PERSONAS.me.mem[b.workspaceId] = "Dueño";
    }
    WSX.persona = "me";
    WSX.cur = b.workspaceId;
  }

  /* ── 2. datos de ejemplo que no tienen equivalente con datos: se vacían ── */
  function wipeDemo() {
    if (!R.ev0 && typeof EV !== "undefined" && EV[0]) R.ev0 = EV[0];
    [typeof EV !== "undefined" && EV, typeof MAILS !== "undefined" && MAILS, typeof ADS !== "undefined" && ADS, typeof AD_AUDS !== "undefined" && AD_AUDS,
     typeof FORMS !== "undefined" && FORMS, typeof BRIEFS !== "undefined" && BRIEFS, typeof QUOTES !== "undefined" && QUOTES, typeof FEES !== "undefined" && FEES,
     typeof PROJ !== "undefined" && PROJ, typeof TQ !== "undefined" && TQ, typeof SQS !== "undefined" && SQS, typeof TRASH !== "undefined" && TRASH,
     typeof IB_ITEMS !== "undefined" && IB_ITEMS, typeof NOTES !== "undefined" && NOTES, typeof PZ !== "undefined" && PZ, typeof EV_REGS !== "undefined" && EV_REGS,
     typeof AREAS !== "undefined" && AREAS, typeof APV !== "undefined" && APV, typeof PB !== "undefined" && PB, typeof SKILLS !== "undefined" && SKILLS,
     typeof GOV !== "undefined" && GOV].forEach(clear);
    if (typeof AD_BUD !== "undefined") clearObj(AD_BUD);
    if (typeof BRAND_SKIN !== "undefined") clearObj(BRAND_SKIN);
    if (typeof ROLE_WORK !== "undefined") Object.keys(ROLE_WORK).forEach(function (k) { ROLE_WORK[k] = []; });
    if (typeof CH_SEED !== "undefined") clearObj(CH_SEED);
    TILES["crear/marcas"] = [];
    TILES["crear/videos"] = []; TILES["crear/motion"] = []; TILES["crear/tomas"] = []; TILES["crear/clones"] = [];
    TILES["crear/disenos"] = [];
    TABLES["crear/copys"].rows = [];
    TABLES["automatizar/historial"].rows = [];
    KANBANS["crear/automatizaciones"] = [["Borrador", []], ["Activos", []], ["Pausados", []]];
    LISTS["planear/investigacion"] = []; LISTS["conversar/bandeja"] = []; LISTS["vender/formularios"] = []; LISTS["configuracion/papelera"] = [];
  }

  /* ── 3. cargar todo el workspace ── */
  function q(t, sel, extra) { return t + "?workspace_id=eq." + encodeURIComponent(R.ws) + "&select=" + sel + (extra || ""); }
  R.reload = function () {
    return loadWorkspace(R.ws).then(function () {
      KHX.items = null;
      if (R.reloadData) R.reloadData();
      if (!(FL && FL.open) && !(ED && ED.open) && !(VE && VE.open)) go();
    });
  };
  function loadWorkspace(ws) {
    R.ws = ws;
    var month0 = new Date(); month0.setDate(1); month0.setMonth(month0.getMonth() - 3);
    return Promise.all([
      get(q("brands", "id,name,colors,fonts,relationship_status,account_health,last_contacted_at,updated_at", "&order=name.asc&limit=200")),
      get(q("workspace_members", "user_id,role,joined_at")),
      get(q("crm_deals", "id,title,stage,value,final_value,currency,primary_contact_id,brand_id,updated_at", "&order=updated_at.desc&limit=300")),
      get(q("crm_contacts", "id,first_name,last_name,email,company,brand_name,brand_id,status,updated_at", "&order=updated_at.desc&limit=300")),
      get(q("templates", "id,name,thumbnail,updated_at,w:data->width,h:data->height,brandId:data->brandId", "&deleted_at=is.null&is_brand_manual=is.false&order=updated_at.desc&limit=120")),
      get(q("content_calendar", "id,scheduled_date,scheduled_time,topic,copy,kind,visual_type,channels,status,brand_id,template_id,published_at", "&scheduled_date=gte." + month0.toISOString().slice(0, 10) + "&order=scheduled_date.asc&limit=500")),
      get(q("design_kanban_tasks", "id,title,brand_id,type,format,status,deadline,assigned_to,updated_at", "&order=updated_at.desc&limit=200")),
      get(q("brain_notes", "id,title,body_md,entity_type,updated_at", "&order=updated_at.desc&limit=100")),
      get(q("flows", "id,name,enabled,trigger,nodes,updated_at", "&order=updated_at.desc&limit=100")),
      get(q("flow_runs", "id,flow_id,status,started_at,finished_at", "&order=started_at.desc&limit=60")),
      get(q("social_inbox", "id,platform,provider,kind,author_name,author_handle,content,occurred_at,status,reply_text,replied_at", "&order=occurred_at.desc&limit=100")),
      get(q("musa_video_projects", "id,name,duration_us,ratio,canvas_w,canvas_h,updated_at", "&is_template=is.false&order=updated_at.desc&limit=60")),
      get(q("templates", "id,name,deleted_at", "&deleted_at=not.is.null&order=deleted_at.desc&limit=60")),
      get(q("assets", "id,name,url,mime_type,size_bytes,deleted_at,created_at", "&order=created_at.desc&limit=2000")),
      get(q("copy_recipes", "id,name,type,content,usage_count,brand_id,updated_at", "&order=updated_at.desc&limit=100")),
      get(q("musa_video_takes", "id,state,duration_ms,size_bytes,created_at", "&order=created_at.desc&limit=60")),
    ]).then(function (r) {
      apply({ brands: r[0], members: r[1], deals: r[2], contacts: r[3], tpl: r[4], cal: r[5], tasks: r[6], notes: r[7], flows: r[8], runs: r[9], inbox: r[10], vids: r[11], trash: r[12], assets: r[13], copys: r[14], takes: r[15] });
      R.thumb = {}; (r[4] || []).forEach(function (t) { R.thumb[t.id] = t.thumbnail; });
      var need = {}; (r[5] || []).forEach(function (c) { if (c.template_id && !(c.template_id in R.thumb)) need[c.template_id] = 1; });
      var needIds = Object.keys(need).slice(0, 80);
      var thumbs = needIds.length ? get("templates?id=in.(" + needIds.map(encodeURIComponent).join(",") + ")&select=id,thumbnail").then(function (T) { (T || []).forEach(function (t) { R.thumb[t.id] = t.thumbnail; }); }) : null;
      var b = bridge(), wsApi = "/api/workspaces/" + encodeURIComponent(ws);
      var conns = b.api(wsApi + "/connections").then(function (x) { applyIntegrations((x && x.data) || []); }, function () { applyIntegrations([]); });
      var keys = b.api(wsApi + "/api-keys").then(function (x) { applyKeys((x && x.data) || []); }, function () { applyKeys(null); });
      var ids = (r[1] || []).map(function (m) { return m.user_id; });
      if (!ids.length) return Promise.all([thumbs, conns, keys]);
      return Promise.all([thumbs, conns, keys, get("user_profiles?id=in.(" + ids.join(",") + ")&select=id,email,display_name,first_name,last_name,updated_at").then(function (P) { applyTeam(r[1], P || []); })]);
    });
  }

  /* Integraciones: conectado solo lo que tu espacio tiene conectado */
  function applyIntegrations(list) {
    if (typeof INTS === "undefined") return;
    var by = {};
    list.forEach(function (c) { [c.provider, c.kind, c.name].forEach(function (k) { if (k) by[String(k).toLowerCase()] = c; }); });
    INTS.forEach(function (i) {
      var c = by[i.id] || by[String(i.name).toLowerCase()];
      i.st = c ? (c.enabled === false ? "warn" : "ok") : "off";
      if (i.accounts) i.accounts = [];
    });
  }
  /* API y webhooks: tus claves (sin mostrar la clave, solo su prefijo) */
  function applyKeys(list) {
    if (!list) { LISTS["configuracion/apis"] = []; return; }
    R.keys = list;
    LISTS["configuracion/apis"] = list.map(function (k) {
      return [esc(k.label || (k.kind === "agent" ? "Token de agente" : "Clave de API")), esc((k.key_prefix || "musa_") + "••••••••"), "creada " + new Date(k.created_at).toLocaleDateString("es-PE", { day: "2-digit", month: "short" }) + (k.last_used_at ? " · usada " + ago(k.last_used_at) : ""), "Revocar"];
    });
  }

  function personName(p) {
    if (!p) return "—";
    return (p.display_name || ((p.first_name || "") + " " + (p.last_name || "")).trim() || (p.email || "").split("@")[0] || "—");
  }
  function applyTeam(members, profiles) {
    var byId = {}; profiles.forEach(function (p) { byId[p.id] = p; });
    var ROL = { owner: "Dueño", admin: "Admin", editor: "Editor", viewer: "Lectura" };
    R.people = {};
    var rows = members.map(function (m) {
      var p = byId[m.user_id]; R.people[m.user_id] = personName(p);
      return [esc(personName(p)), esc(p ? p.email : "—"), ROL[m.role] || m.role, ago(p && p.updated_at), "Activo"];
    });
    WSS[R.ws].team = rows;
    TABLES["configuracion/equipo"].rows = rows;
  }

  function apply(D) {
    var w = WSS[R.ws];
    /* marcas */
    R.brandName = {}; R.brandId = {};
    (D.brands || []).forEach(function (b) { R.brandName[b.id] = b.name; R.brandId[b.name] = b.id; });
    var bn = function (id) { return (id && R.brandName[id]) || null; };
    var monthKey = new Date().toISOString().slice(0, 7), perBrand = {}, chans = {};
    (D.cal || []).forEach(function (c) {
      var b = bn(c.brand_id) || w.own;
      if ((c.scheduled_date || "").slice(0, 7) === monthKey) perBrand[b] = (perBrand[b] || 0) + 1;
      (chans[b] = chans[b] || {}); (c.channels || []).forEach(function (x) { chans[b][NET[x] || x] = 1; });
    });
    w.brands = (D.brands || []).map(function (b) {
      var st = b.relationship_status === "prospect" || b.relationship_status === "lead" ? "Prospecto" : b.account_health === "paused" || b.account_health === "churned" ? "Pausada" : "Activa";
      var rel = { client: "Cliente", prospect: "Prospecto", lead: "Prospecto", partner: "Socio", internal: "Marca propia" }[b.relationship_status] || "Marca";
      return [b.name, rel, perBrand[b.name] || 0, Object.keys(chans[b.name] || {}).slice(0, 3).join(" · ") || "—", shortName(R.me), st];
      });
    (D.brands || []).forEach(function (b) {
      var cols = (b.colors || []).map(function (c) { return typeof c === "string" ? c : c && (c.hex || c.value); }).filter(Boolean);
      if (cols.length) BRAND_SKIN[b.name] = [cols[0], cols[1] || "#ffffff", "#111"];
      if (cols.length || (b.fonts || []).length) {
        var f = (b.fonts || []).map(function (x) { return typeof x === "string" ? x : x && (x.family || x.name); }).filter(Boolean);
        TILES["crear/marcas"].push([b.name, [cols[0], f[0]].filter(Boolean).join(" · "), (cols.length + f.length) + " tokens"]);
      }
    });
    TABLES["vender/empresas"].rows = w.brands;

    /* oportunidades y personas */
    var C = D.contacts || [], DL = (D.deals || []).filter(function (d) { return d.stage !== "lost"; }), byC = {};
    C.forEach(function (c) { byC[c.id] = c; });
    var who = function (c) { return c ? ((c.first_name || "") + " " + (c.last_name || "")).trim() || c.email || "—" : "—"; };
    R.oppIds = STAGES.map(function (s) { return DL.filter(function (d) { return stageCol(d.stage) === s[0]; }).map(function (d) { return d.id; }); });
    KANBANS["vender/oportunidades"] = STAGES.map(function (s) {
      return [s[1], DL.filter(function (d) { return stageCol(d.stage) === s[0]; }).map(function (d) {
        return [esc(d.title || "Sin título"), money(d.final_value != null ? d.final_value : d.value, d.currency), esc(shortName(who(byC[d.primary_contact_id])))];
      })];
    });
    var dealOf = {};
    DL.forEach(function (d) { if (d.primary_contact_id && !dealOf[d.primary_contact_id]) dealOf[d.primary_contact_id] = d; });
    TABLES["vender/personas"].rows = C.map(function (c) {
      var d = dealOf[c.id], dd = days(c.updated_at); dd = dd == null ? 99 : dd;
      return [esc(who(c)), esc(c.company || c.brand_name || bn(c.brand_id) || "—"), d ? STAGE_LBL[d.stage] || "Prospecto" : "Prospecto", d ? money(d.value, d.currency) : "—", ago(c.updated_at), dd > 10 ? "En fuga" : dd > 4 ? "En riesgo" : "Sana"];
    });
    R.funnel = [["Personas", C.length], ["Oportunidades", (D.deals || []).length], ["Propuesta", DL.filter(function (d) { return d.stage === "proposal" || d.stage === "negotiation" || !!WON[d.stage]; }).length], ["Clientes", DL.filter(function (d) { return !!WON[d.stage]; }).length]];

    /* diseños */
    R.tpl = D.tpl || [];
    TILES["crear/disenos"] = R.tpl.map(function (t) { return [esc(t.name || "Sin nombre"), esc(bn(t.brandId) || "Sin marca"), t.w && t.h ? t.w + "×" + t.h : "—"]; });

    /* videos */
    R.vids = D.vids || [];
    TILES["crear/videos"] = R.vids.map(function (v) { var s = Math.round((v.duration_us || 0) / 1e6); return [esc(v.name || "Video"), esc(w.own), Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0")]; });
    TILES["crear/tomas"] = (D.takes || []).map(function (t, i) { var s = Math.round((t.duration_ms || 0) / 1000); return ["Toma " + String(i + 1).padStart(2, "0"), t.state || "—", Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0")]; });

    /* copys */
    TABLES["crear/copys"].rows = (D.copys || []).map(function (c) {
      return [esc(c.name || "Copy"), esc(bn(c.brand_id) || w.own), esc(c.type || "—"), String(c.content || "").split(/\s+/).filter(Boolean).length, "—", c.usage_count ? "Aprobado" : "Borrador"];
    });

    /* calendario → piezas */
    clear(PZ);
    (D.cal || []).forEach(function (c) {
      var ch = (c.channels || [])[0], net = NET[ch] || ch || "Instagram";
      var kind = /^(post|carrusel|story|reel)$/.test(c.visual_type || "") ? c.visual_type : c.kind === "video" || /reel/i.test(c.topic || "") ? "reel" : /story|historia/i.test(c.topic || "") ? "story" : /carrusel/i.test(c.topic || "") ? "carrusel" : "post";
      var t = (c.scheduled_time || "18:00").slice(0, 5).split(":"), d = (c.scheduled_date || "").split("-");
      var at = new Date(+d[0], +d[1] - 1, +d[2], +t[0] || 0, +t[1] || 0).getTime();
      var st = String(c.status || "").toLowerCase();
      PZ.push({ id: "cc_" + c.id, db: c.id, brand: bn(c.brand_id) || w.own, at: at, kind: kind, ch: net, title: c.topic || "Sin tema", copy: c.copy || "", asset: c.template_id ? "tpl:" + c.template_id : null, tpl: c.template_id || null,
        apr: /aprob|program|publica|listo/.test(st) || !!c.published_at });
    });

    /* mi trabajo */
    R.tasks = (D.tasks || []).filter(function (t) { return t.status !== "done" || (days(t.updated_at) || 0) < 15; });

    /* segundo cerebro */
    clear(NOTES);
    var FOLDER = { brand: "Marcas", campaign: "Campañas", process: "Procesos", idea: "Ideas", decision: "Decisiones" };
    (D.notes || []).forEach(function (n) {
      NOTES.push({ id: "bn_" + n.id, folder: FOLDER[n.entity_type] || "Notas", title: n.title || "Sin título", up: ago(n.updated_at), body: n.body_md || "" });
    });
    if (NOTES.length) BR.sel = NOTES[0].id;

    /* automatizaciones */
    var runsOf = {}; (D.runs || []).forEach(function (x) { (runsOf[x.flow_id] = runsOf[x.flow_id] || []).push(x); });
    var TRIG = { manual: "Manual", schedule: "Programado", cron: "Programado", webhook: "Webhook", form: "Formulario", event: "Evento" };
    var card = function (f) { var n = (f.nodes || []).filter(function (x) { return x.type !== "trigger" && x.type !== "note"; }).length; return [esc(f.name || "Flow"), n + " pasos", TRIG[(f.trigger || {}).type] || "Manual"]; };
    var FL = D.flows || [];
    KANBANS["crear/automatizaciones"] = [
      ["Borrador", FL.filter(function (f) { return !f.enabled && !runsOf[f.id]; }).map(card)],
      ["Activos", FL.filter(function (f) { return f.enabled; }).map(card)],
      ["Pausados", FL.filter(function (f) { return !f.enabled && runsOf[f.id]; }).map(card)]];
    R.flowCols = [FL.filter(function (f) { return !f.enabled && !runsOf[f.id]; }), FL.filter(function (f) { return f.enabled; }), FL.filter(function (f) { return !f.enabled && runsOf[f.id]; })].map(function (l) { return l.map(function (f) { return f.id; }); });
    var fname = {}; FL.forEach(function (f) { fname[f.id] = f; });
    var RES = { success: "Éxito", failed: "Falló", error: "Falló", running: "Reintentando", waiting: "Reintentando" };
    TABLES["automatizar/historial"].rows = (D.runs || []).map(function (x) {
      var f = fname[x.flow_id] || {}, ms = x.finished_at && x.started_at ? new Date(x.finished_at) - new Date(x.started_at) : null;
      return [esc(f.name || "Flow"), TRIG[(f.trigger || {}).type] || "Manual", (f.nodes || []).length || "—", ms == null ? "—" : ms < 60000 ? Math.round(ms / 1000) + " s" : Math.round(ms / 60000) + " min", x.started_at ? new Date(x.started_at).toLocaleString("es-PE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—", RES[x.status] || x.status];
    });

    /* bandeja */
    clear(IB_ITEMS);
    var TYPE = { dm: "dm", message: "dm", comment: "comment", mention: "mention", review: "review" };
    (D.inbox || []).forEach(function (m, i) {
      var tm = m.occurred_at ? new Date(m.occurred_at).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" }) : "";
      var th = [[m.content || "", tm]];
      if (m.reply_text) th.push([m.reply_text, m.replied_at ? new Date(m.replied_at).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" }) : "", true]);
      IB_ITEMS.push({ id: i, db: m.id, who: m.author_name || m.author_handle || "—", net: NET_IB[m.platform || m.provider] || "ig", type: TYPE[m.kind] || "dm", brand: w.own, time: tm, unread: m.status === "new" || m.status === "open", labels: [], th: th, ai: "", status: m.status === "replied" || m.status === "done" || m.reply_text ? "done" : "open", assigned: null });
    });

    /* almacenamiento y papelera */
    clear(TRASH);
    (D.trash || []).forEach(function (t) { TRASH.push([esc(t.name || "Diseño"), "Diseño", "—", Math.max(0, days(t.deleted_at) || 0), { table: "templates", id: t.id }]); });
    (D.assets || []).filter(function (a) { return a.deleted_at; }).forEach(function (a) { TRASH.push([esc(a.name || "Archivo"), "Archivo · " + mb(a.size_bytes), "—", Math.max(0, days(a.deleted_at) || 0), { table: "assets", id: a.id }]); });
    R.assets = (D.assets || []).filter(function (a) { return !a.deleted_at; });
  }
  /* los diseños se abren en el editor de la maqueta (bridge-editor.js); si no cargó, en el editor anterior */
  function openDesign(id) {
    if (R.openDesign) return R.openDesign(id);
    var b = bridge(); if (b && b.openTemplate) b.openTemplate(id);
  }
  var extras = Promise.all(["bridge-data.js", "bridge-editor.js", "bridge-video.js", "bridge-ai.js", "bridge-flows.js", "bridge-state.js", "bridge-create.js", "bridge-report.js", "bridge-events.js", "bridge-code.js", "bridge-code-pv.js", "bridge-org.js", "bridge-mail.js", "bridge-brain.js", "bridge-ads.js", "bridge-growth.js"].map(function (f) {
    return new Promise(function (res) {
      var sc = document.createElement("script"), done = false, fin = function (ok, why) { if (done) return; done = true; if (!ok) { R.failedExtras = (R.failedExtras || []).concat(f); console.error("[bridge] no cargó " + f + " (" + why + ")"); } res(); };
      sc.src = f + "?v=" + Date.now().toString(36).slice(0, 6);
      sc.onload = function () { fin(true); }; sc.onerror = function () { fin(false, "error de red o de sintaxis"); };
      document.body.appendChild(sc); setTimeout(function () { fin(false, "tardó más de 6 s"); }, 6000);
    });
  })).then(function () {
    /* un puente que no cargó se avisa: antes la sección quedaba con datos vacíos sin explicación */
    if (R.failedExtras && R.failedExtras.length) setTimeout(function () { if (typeof uiToast === "function") uiToast("Parte de Musa no cargó (" + R.failedExtras.join(", ") + "). Recarga la página."); }, 1500);
  });
  function mb(b) { b = +b || 0; return b > 1e9 ? (b / 1e9).toFixed(1).replace(".", ",") + " GB" : (b / 1e6).toFixed(1).replace(".", ",") + " MB"; }

  /* ── 4. vistas que necesitan saber que el dato es real ── */
  function hookViews() {
    /* el calendario y Mi trabajo ya no generan piezas de ejemplo */
    pzEnsure = function () {};

    /* Diseños: miniatura real y se abre en el editor de verdad */
    var _edThumbs = edThumbs;
    R.f0 = R.f0 || {};
    var fetching = 0;
    function fillDesignThumbs() {
      var need = [];
      document.querySelectorAll("#body .ed-thumb").forEach(function (t) {
        var x = R.tpl[+t.dataset.open]; if (!x) return;
        var f0 = R.f0[x.id];
        if (f0 && R.preview && t.clientWidth) {
          if (t.dataset.pv === x.id) return;
          t.innerHTML = ""; t.dataset.pv = x.id;
          t.style.display = "grid"; t.style.placeItems = "center";
          t.appendChild(R.preview(f0, t.clientWidth - 28, t.clientHeight - 28));
          return;
        }
        if (!t.firstChild && x.thumbnail) t.innerHTML = '<img src="' + esc(x.thumbnail) + '" alt="" style="max-width:calc(100% - 28px);max-height:calc(100% - 28px);object-fit:contain;border-radius:4px;opacity:.6">';
        if (!(x.id in R.f0)) need.push(x.id);
      });
      if (!need.length || fetching >= 3) return;
      fetching++;
      var batch = need.slice(0, 10);
      batch.forEach(function (id) { R.f0[id] = null; });
      get("templates?id=in.(" + batch.map(encodeURIComponent).join(",") + ")&select=id,f0:data->frames->0,html:data->html,css:data->css,w:data->width,h:data->height").then(function (rows) {
        (rows || []).forEach(function (r) { R.f0[r.id] = r.f0 || { html: r.html || "", css: r.css || "", width: r.w, height: r.h, background: "#ffffff" }; });
        fetching--;
        if (route.mod === "crear" && route.sub === "disenos") fillDesignThumbs();
      }, function () { fetching--; });
      if (fetching < 3 && need.length > 10) setTimeout(fillDesignThumbs, 0);
    }
    edThumbs = function () {
      if (!(route.mod === "crear" && route.sub === "disenos")) return _edThumbs();
      fillDesignThumbs();
    };
    var _viewGrid = viewGrid;
    viewGrid = function (key) {
      var r = _viewGrid(key);
      if (key === "crear/disenos") {
        document.querySelectorAll("#body .tile[data-open]").forEach(function (t) {
          t.onclick = function (e) { e.stopPropagation(); var x = R.tpl[+t.dataset.open]; if (x) openDesign(x.id); };
        });
        if (!R.tpl.length) $("#body").innerHTML = '<div class="empty-note">Todavía no hay diseños en este espacio. Crea el primero con «Crear».</div>';
      }
      return r;
    };
    var _veThumbs = veThumbs;
    veThumbs = function (kind) {
      if (!(route.mod === "crear" && route.sub === "videos")) return _veThumbs(kind);
      document.querySelectorAll("#body .ve-thumb").forEach(function (t) {
        var v = R.vids[+t.dataset.open]; if (!v || t.dataset.pv === v.id) return;
        t.dataset.pv = v.id; t.style.display = "grid"; t.style.placeItems = "center"; t.style.background = "linear-gradient(160deg,#222,#0b0b0b)";
        if (R.videoThumb) R.videoThumb(v.id, t);
      });
    };
    var _viewMedia = viewMedia;
    viewMedia = function () {
      var r = _viewMedia.apply(this, arguments);
      document.querySelectorAll("#body .tile[data-open]").forEach(function (t) {
        t.onclick = function (e) { e.stopPropagation(); var i = +String(t.dataset.open).split("/")[1], v = R.vids[i]; if (v && R.openVideo) R.openVideo(v.id, i); };
      });
      return r;
    };
    /* en un espacio real nunca se abren los proyectos de ejemplo */
    var _veProject = veProject;
    veProject = function (key) { if (/^(videos|motion)\//.test(key) && !VE_DOCS[key]) return null; return _veProject.apply(this, arguments); };

    /* Mi trabajo: tareas reales; mover de columna se guarda */
    var _khItems = khItems;
    khItems = function () {
      if (KHX.items && KHX.items.ws === WSX.cur && KHX.items.role === role && KHX.items.real === R.tasks) return KHX.items.list;
      var list = [];
      (R.tasks || []).forEach(function (t) {
        var col = TASK_COL[t.status] || "todo", n = (t.assigned_to && R.people[t.assigned_to]) || R.me;
        var it = { t: t.title || "Tarea", d: [R.brandName[t.brand_id] || WSS[R.ws].own, t.format || t.type].filter(Boolean).join(" · "), brand: R.brandName[t.brand_id] || WSS[R.ws].own,
          who: { n: n, ini: initials(n), c: "#111", ai: false }, time: t.deadline ? dShort(new Date(t.deadline).getTime()) : "—" };
        Object.defineProperty(it, "col", { get: function () { return col; }, set: function (v) { if (v === col) return; col = v; t.status = COL_TASK[v]; patch("design_kanban_tasks", t.id, { status: COL_TASK[v] }).then(function () { uiToast("Guardado"); }); }, enumerable: true });
        list.push(it);
      });
      var now = Date.now();
      PZ.filter(function (p) { return p.at > now && p.at < now + 14 * DAY; }).sort(function (a, b) { return a.at - b.at; }).forEach(function (p) { list.push(khPz(p)); });
      KHX.items = { ws: WSX.cur, role: role, real: R.tasks, list: list };
      return list;
    };

    /* Segundo cerebro: el grafo usa tus marcas, no las de ejemplo */
    brGraph = function () {
      var bs = (WSS[R.ws].brands || []).map(function (r) { return r[0]; }).slice(0, 8);
      var base = bs.map(function (n) { return [n, 0]; });
      var nodes = base.map(function (x) { return { n: x[0], t: 0 }; }).concat(NOTES.slice(0, 40).map(function (x) { return { n: x.title, t: 3, id: x.id }; }));
      var idx = function (n) { return nodes.findIndex(function (x) { return x.n === n; }); };
      var links = [];
      NOTES.slice(0, 40).forEach(function (x) { var i = idx(x.title); brLinks(x).forEach(function (l) { var j = idx(l); if (j >= 0) links.push([i, j]); }); base.forEach(function (b, j) { if ((x.title + " " + x.body).indexOf(b[0]) >= 0) links.push([i, j]); }); });
      var W = 820, H = 470, cx = W / 2, cy = H / 2, groups = { 0: nodes.filter(function (x) { return x.t === 0; }), 3: nodes.filter(function (x) { return x.t === 3; }) }, Rr = { 0: 95, 3: 215 };
      var pos = nodes.map(function (x) { var g = groups[x.t], k = g.indexOf(x), a = (k / g.length) * Math.PI * 2 + (x.t === 3 ? .35 : 0); return [cx + Math.cos(a) * Rr[x.t] * 1.55, cy + Math.sin(a) * Rr[x.t] * .92]; });
      var col = function (t) { return t === 0 ? "var(--accent)" : "#2f6fed"; };
      return '<svg class="chart br-svg" viewBox="0 0 ' + W + " " + H + '">' + links.map(function (l) { return '<line x1="' + pos[l[0]][0] + '" y1="' + pos[l[0]][1] + '" x2="' + pos[l[1]][0] + '" y2="' + pos[l[1]][1] + '" style="stroke:var(--border-2)" stroke-width="1.1"/>'; }).join("")
        + nodes.map(function (x, i) { return "<g " + (x.id ? 'class="br-n" data-brn="' + x.id + '"' : "") + '><circle cx="' + pos[i][0] + '" cy="' + pos[i][1] + '" r="' + (x.t === 0 ? 10 : 7) + '" style="fill:' + col(x.t) + '"/><text x="' + pos[i][0] + '" y="' + (pos[i][1] + (x.t === 0 ? 25 : 19)) + '" text-anchor="middle" style="fill:' + (x.t === 0 ? "var(--bright)" : "var(--muted)") + ";font-size:" + (x.t === 0 ? 12 : 10.5) + 'px;font-family:var(--sans)">' + eesc(String(x.n).slice(0, 34)) + "</text></g>"; }).join("") + "</svg>";
    };

    /* Embudo con tus números del CRM */
    viewFunnel = function () {
      var st = R.funnel || [["Personas", 0]], top = Math.max(1, st[0][1]);
      $("#body").innerHTML = '<article class="card"><div class="ch"><h3>Embudo comercial</h3><small>' + new Date().toLocaleDateString("es-PE", { month: "long", year: "numeric" }) + '</small></div><div class="funnel tnum">'
        + st.map(function (s, i) { return '<div class="fs"><span>' + s[0] + '</span><div class="fbar"><i style="width:0" data-w="' + Math.max(6, (s[1] / top) * 100) + '"></i></div><b>' + fmt(s[1]) + (i ? '<small style="display:block;color:var(--muted);font-weight:400;font-size:10.5px">' + (st[i - 1][1] ? ((s[1] / st[i - 1][1]) * 100).toFixed(1) : "0") + " %</small>" : "") + "</b></div>"; }).join("") + "</div></article>";
      requestAnimationFrame(function () { document.querySelectorAll(".fbar i[data-w]").forEach(function (i) { i.style.width = i.dataset.w + "%"; }); });
    };

    /* Almacenamiento: tu espacio real; restaurar se guarda */
    VIEWS2.storage = function () {
      var A = R.assets || [], tot = A.reduce(function (s, a) { return s + (+a.size_bytes || 0); }, 0), cap = 200e9;
      var type = function (m) { m = m || ""; return /^video/.test(m) ? "Videos y tomas" : /^image/.test(m) ? "Fotos" : /^audio/.test(m) ? "Audio y voces" : /pdf|svg|font/.test(m) ? "Diseños" : "Otros"; };
      var by = {}; A.forEach(function (a) { var k = type(a.mime_type); by[k] = (by[k] || 0) + (+a.size_bytes || 0); });
      var kinds = ["Videos y tomas", "Fotos", "Diseños", "Audio y voces", "Otros"].map(function (k) { return [k, tot ? Math.round((by[k] || 0) / tot * 100) : 0]; });
      $("#body").innerHTML = '<div class="grid"><article class="card c6"><div class="ch"><h3>Espacio usado</h3><small>' + A.length + ' archivos</small></div><div class="big tnum"><b>' + mb(tot) + '</b></div><div class="meter" style="margin:10px 0 16px"><i style="width:' + Math.min(100, tot / cap * 100) + '%"></i></div></article>'
        + '<article class="card c6"><div class="ch"><h3>Por tipo</h3><small>Lo que ocupa tu espacio</small></div>' + kinds.map(function (k) { return '<div class="fx-chk"><span><b>' + k[0] + '</b><div class="meter hot" style="margin-top:6px"><i style="width:' + k[1] + '%"></i></div></span><span class="tnum" style="flex:0 0 50px;text-align:right">' + k[1] + " %</span></div>"; }).join("") + "</article>"
        + '<article class="card c12"><div class="ch"><h3>Papelera</h3><small>Se borra sola a los 30 días · no cuenta en tu espacio</small></div><div class="list">'
        + (TRASH.map(function (x, i) { var d = x[3]; return '<div class="li"><span class="dot" style="background:' + (d > 20 ? "var(--danger)" : "var(--l3)") + '"></span><div><b>' + x[0] + "</b><p>" + x[1] + " · eliminado hace " + d + " días" + (d > 20 && d < 30 ? " · se borra en " + (30 - d) + " días" : "") + '</p></div><div class="meta"><button class="btn btn-g" style="height:28px;padding:0 10px;font-size:11.5px" data-rs="' + i + '">Restaurar</button></div></div>'; }).join("") || '<p class="empty-note">La papelera está vacía.</p>')
        + "</div></article></div>";
      $("#body").onclick = function (e) {
        var r = e.target.closest("[data-rs]"); if (!r) return;
        var x = TRASH[+r.dataset.rs]; if (!x || !x[4]) return;
        patch(x[4].table, x[4].id, { deleted_at: null }).then(function () { TRASH.splice(+r.dataset.rs, 1); uiToast("“" + x[0] + "” restaurado a su lugar"); VIEWS2.storage(); });
      };
    };

    /* Calendario: editar título o copy de una pieza real se guarda */
    var _pzInput = typeof pzInput === "function" ? pzInput : null;
    if (_pzInput) pzInput = function (e, commit) {
      var r = _pzInput.apply(this, arguments);
      try {
        var p = pzCur(); if (commit && p && p.db) patch("content_calendar", p.db, { topic: p.title, copy: p.copy, scheduled_date: new Date(p.at - new Date(p.at).getTimezoneOffset() * 6e4).toISOString().slice(0, 10), scheduled_time: hhmm(p.at) });
      } catch (err) {}
      return r;
    };

    /* Inicio › Resumen: los números salen de tus piezas, flows y CRM */
    var _viewDash = viewDash;
    viewDash = function () {
      var w = WSS[R.ws], now = Date.now();
      CONTENIDOS.rows = PZ.slice().sort(function (a, b) { return Math.abs(a.at - now) - Math.abs(b.at - now); }).slice(0, 12).map(function (p) {
        var st = pzState(p); st = st === "Por aprobar" ? "En revisión" : st === "Falta copy" || st === "Falta pieza" ? "Borrador" : st;
        return [esc(p.title), esc(p.brand), esc(p.ch), PZ_K[p.kind][0], esc(shortName(R.me)), st];
      });
      _viewDash();
      var month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
      var inMonth = PZ.filter(function (p) { return p.at >= month.getTime() && p.at < new Date(month.getFullYear(), month.getMonth() + 1, 1).getTime(); });
      var card = document.querySelector(".brand-card");
      if (card) {
        card.querySelector(".sticker").textContent = w.tier;
        card.querySelector(".pt p").textContent = (w.brands.length ? w.brands.length + " marcas" : "Sin marcas todavía") + " · " + w.desc;
        var st = card.querySelectorAll(".stat b"), flows = KANBANS["crear/automatizaciones"].reduce(function (s, c) { return s + c[1].length; }, 0);
        if (st[0]) st[0].textContent = inMonth.length;
        if (st[1]) { st[1].textContent = R.tpl.length; st[1].previousElementSibling.textContent = "Diseños"; }
        if (st[2]) st[2].textContent = TABLES["vender/personas"].rows.length;
        if (st[3]) st[3].textContent = flows;
        var ch = {}; PZ.forEach(function (p) { ch[p.ch] = 1; });
        card.querySelector(".tags").innerHTML = Object.keys(ch).slice(0, 5).map(function (c) { return '<span class="tag">' + esc(c) + "</span>"; }).join("") || '<span class="tag">Sin canales</span>';
        var top = {}; inMonth.forEach(function (p) { top[p.brand] = (top[p.brand] || 0) + 1; });
        var best = Object.keys(top).sort(function (a, b) { return top[b] - top[a]; })[0];
        var next = PZ.filter(function (p) { return p.at > now; }).sort(function (a, b) { return a.at - b.at; })[0];
        var kv = card.querySelectorAll(".kv");
        if (kv[0]) { kv[0].querySelector("span").textContent = "Marca con más piezas"; kv[0].querySelector("b").textContent = best || "—"; }
        if (kv[1]) kv[1].querySelector("b").textContent = next ? dShort(next.at) + " · " + hhmm(next.at) + " · " + next.ch : "Nada programado";
        if (kv[2]) kv[2].querySelector("b").textContent = PZ.filter(function (p) { return p.at > now && pzState(p) === "Por aprobar"; }).length + " piezas";
      }
      /* publicaciones por día */
      var drawPub = function (r) {
        var n = r === "w" ? 7 : new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(), start = r === "w" ? (function () { var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.getTime(); })() : month.getTime();
        var data = Array.from({ length: n }, function (_, i) { return PZ.filter(function (p) { return p.at >= start + i * DAY && p.at < start + (i + 1) * DAY; }).length; });
        $("#pubChart").innerHTML = "";
        drawBars($("#pubChart"), data, function (i) { return r === "w" ? ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"][i] : String(i + 1); }, function (v) { return v + " piezas"; }, Math.max(1, Math.max.apply(null, data)), 146);
        $("#pubTotal").textContent = data.reduce(function (a, b) { return a + b; }, 0);
        $("#pubLbl").textContent = r === "w" ? "esta semana" : "este mes";
        $("#pubDelta").textContent = "";
      };
      $("#pubSeg").onclick = function (e) { var b = e.target.closest("button"); if (!b) return; [].forEach.call(e.currentTarget.children, function (x) { x.classList.toggle("on", x === b); }); drawPub(b.dataset.r); };
      drawPub("w");
      /* engagement: sin métricas conectadas no se inventa */
      $("#engScore").textContent = "—";
      var dl = $("#engScore").parentElement.querySelector(".delta"); if (dl) dl.textContent = "Conecta tus redes en Integraciones";
      $("#engChart").innerHTML = "";
      /* días con más publicaciones y anillos de producción, con tus piezas */
      var GOALS = { dis: 8, copy: 12, vid: 3 }, view = new Date(month), sel = new Date();
      var dayData = function (d) { var a = d.getTime(), z = a + DAY, ps = PZ.filter(function (p) { return p.at >= a && p.at < z; }); return { dis: ps.filter(function (p) { return p.tpl; }).length, copy: ps.filter(function (p) { return p.copy; }).length, vid: ps.filter(function (p) { return PZ_K[p.kind][2] === "video"; }).length, n: ps.length }; };
      var RINGS = [{ k: "dis", label: "Diseños", r: 72 }, { k: "copy", label: "Copys", r: 55 }, { k: "vid", label: "Videos", r: 38 }];
      var drawRings = function () {
        var a = dayData(new Date(sel.getFullYear(), sel.getMonth(), sel.getDate()));
        $("#ringDay").textContent = sel.toLocaleDateString("es-PE", { weekday: "short", day: "numeric", month: "short" });
        var rows = $("#rlist").querySelectorAll(".rrow b");
        RINGS.forEach(function (Rg, i) { var C = 2 * Math.PI * Rg.r, p = Math.min(a[Rg.k] / GOALS[Rg.k], 1), el = $("#ring-" + Rg.k); if (el) el.style.strokeDashoffset = C * (1 - p); if (rows[i]) rows[i].textContent = a[Rg.k] + " / " + GOALS[Rg.k]; });
      };
      var drawCal = function () {
        var cal = $("#cal"); cal.innerHTML = "";
        $("#monthLbl").textContent = view.toLocaleDateString("es-PE", { month: "long", year: "numeric" });
        var off = (view.getDay() + 6) % 7, nd = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
        for (var i = 0; i < off; i++) cal.insertAdjacentHTML("beforeend", '<span class="day empty"></span>');
        for (var d = 1; d <= nd; d++) (function (d) {
          var date = new Date(view.getFullYear(), view.getMonth(), d), b = document.createElement("button"), n = dayData(date).n;
          b.className = "day l" + (n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 3 : 4);
          if (date.toDateString() === sel.toDateString()) b.classList.add("sel");
          b.textContent = d;
          b.onclick = function () { sel = date; drawCal(); drawRings(); };
          cal.appendChild(b);
        })(d);
        $("#nextM").style.opacity = 1;
      };
      $("#prevM").onclick = function () { view.setMonth(view.getMonth() - 1); drawCal(); };
      $("#nextM").onclick = function () { view.setMonth(view.getMonth() + 1); drawCal(); };
      drawCal(); drawRings();
      /* pendientes reales */
      var pend = [];
      TABLES["automatizar/historial"].rows.filter(function (r) { return r[5] === "Falló"; }).slice(0, 1).forEach(function (r) { pend.push(["var(--danger)", "Flow falló: " + r[0], "Revisa el historial en Automatizaciones.", r[4]]); });
      var apr = PZ.filter(function (p) { return p.at > now && pzState(p) === "Por aprobar"; });
      if (apr.length) pend.push(["var(--warn)", apr.length + " piezas esperan aprobación", esc(apr[0].brand) + " · " + esc(apr[0].title), dShort(apr[0].at)]);
      var falta = PZ.filter(function (p) { return p.at > now && /Falta/.test(pzState(p)); });
      if (falta.length) pend.push(["var(--warn)", falta.length + " piezas sin terminar", "Les falta copy o diseño antes de salir.", dShort(falta[0].at)]);
      TABLES["vender/personas"].rows.filter(function (r) { return r[5] === "En fuga"; }).slice(0, 1).forEach(function (r) { pend.push(["var(--warn)", "Contacto sin seguimiento", r[0] + " · " + r[4], ""]); });
      var lists = document.querySelectorAll(".grid > article.card .list"), box = lists[lists.length - 1];
      if (box) {
        box.innerHTML = pend.map(function (p) { return '<div class="li"><span class="dot" style="background:' + p[0] + '"></span><div><b>' + p[1] + "</b><p>" + p[2] + '</p></div><span class="meta">' + esc(p[3]) + "</span></div>"; }).join("") || '<p class="empty-note">Nada pendiente. Todo al día.</p>';
        var stk = box.parentElement.querySelector(".sticker"); if (stk) { stk.textContent = pend.length + (pend.length === 1 ? " nuevo" : " nuevos"); stk.style.display = pend.length ? "" : "none"; }
      }
    };

    /* plantillas de mailing: la vista previa usa un evento de muestra aunque no tengas eventos */
    if (typeof TPL_DEF !== "undefined" && TPL_DEF["crear/mailing"] && R.ev0) {
      var _mlItems = TPL_DEF["crear/mailing"].items;
      TPL_DEF["crear/mailing"].items = function () { if (EV.length) return _mlItems(); EV.push(R.ev0); try { return _mlItems(); } finally { EV.length = 0; } };
    }

    /* piezas con diseño real: vista previa con su miniatura y «Abrir en el editor» abre el editor de verdad */
    var _pzPreview = pzPreview;
    pzPreview = function (p) {
      var a = p.asset;
      if (!(typeof a === "string" && a.indexOf("tpl:") === 0)) return _pzPreview(p);
      var th = R.thumb[a.slice(4)], keep = p.asset; p.asset = null;
      var html = _pzPreview(p); p.asset = keep;
      return html.replace(/<div class="pz-ph">[^<]*<\/div>/, '<div class="pz-media">' + (th ? '<img src="' + esc(th) + '" alt="" style="max-width:100%;max-height:230px;display:block;margin:auto">' : "Diseño asignado") + "</div>");
    };
    var _pzClick = pzClick;
    pzClick = function (e) {
      var bt = e.target.closest && e.target.closest("[data-pza]"), p = typeof pzCur === "function" ? pzCur() : null, b = bridge();
      if (bt && p && bt.dataset.pza === "open" && typeof p.asset === "string" && p.asset.indexOf("tpl:") === 0) { openDesign(p.asset.slice(4)); return true; }
      var r = _pzClick.apply(this, arguments);
      if (bt && p && p.db && bt.dataset.pza === "apr") patch("content_calendar", p.db, { status: "aprobado" });
      return r;
    };

    /* sin el aviso de «contenidos de demo»: aquí todo es de tu espacio */
    var _drawView = drawView;
    drawView = function () {
      _drawView();
      if (route.mod === "crear" && route.sub === "videos") {
        var act = document.querySelector(".head .actions .btn-p");
        if (act && R.newVideo) act.onclick = function (e) { e.stopPropagation(); var f = prompt("Formato del video nuevo: 9:16 (vertical), 16:9 (horizontal), 1:1 o 4:5", "9:16"); if (f) R.newVideo(f.trim()); };
      }
      document.querySelectorAll("#body .ws-note").forEach(function (n) { if (/usa los datos de demo/.test(n.textContent)) return n.remove(); if (/contenidos de demo/.test(n.textContent)) { if (/^Estás en/.test(n.textContent.trim()) && n.querySelector("b") && !/tu rol/.test(n.textContent)) n.remove(); else n.innerHTML = n.innerHTML.replace(/\s*En la maqueta[^<]*contenidos de demo[^<]*\./, ""); } });
    };

    /* Briefs y Cotizaciones: sin datos todavía, estado vacío con el mismo diseño */
    var _clBriefs = VIEWS2.clBriefs;
    VIEWS2.clBriefs = function () {
      if (BRIEFS.length) return _clBriefs.apply(this, arguments);
      $("#body").innerHTML = '<div class="ws-note">El brief es el punto de partida: lo llena el cliente (por enlace, sin cuenta), tú, o la IA desde una reunión o un correo. Al aprobarlo se convierte en proyecto: tareas, calendario y una cotización en borrador.</div><div class="cl-split"><div class="pb-list"><div class="ag-new" style="min-height:110px"><span><b>+ Nuevo brief</b>Formulario para el cliente o desde una reunión</span></div></div><div class="ag-box"><p class="empty-note">Todavía no hay briefs en este espacio.</p></div></div>';
    };
    var _clQuotes = VIEWS2.clQuotes;
    VIEWS2.clQuotes = function () {
      if (QUOTES.length) return _clQuotes.apply(this, arguments);
      $("#body").innerHTML = '<div class="grid"><article class="card c12"><div class="ch"><h3>Cotizaciones</h3><small>Ganadas este mes: ' + money(0) + '</small></div><p class="empty-note">Todavía no hay cotizaciones. Se crean desde una oportunidad en Vender › Oportunidades.</p></article></div>';
    };

    /* Espacios y planes: el ejemplo explicativo de Mayckol sigue funcionando */
    var _viewSpaces = viewSpaces;
    viewSpaces = function () {
      var added = [];
      Object.keys(R.demoWSS || {}).forEach(function (k) { if (!WSS[k]) { WSS[k] = R.demoWSS[k]; added.push(k); } });
      try { _viewSpaces.apply(this, arguments); } finally { added.forEach(function (k) { delete WSS[k]; }); }
    };

    /* Resumen: la franja de proyectos solo aparece si tienes proyectos */
    if (typeof dashProjects === "function") {
      var _dashProjects = dashProjects;
      dashProjects = function () { if (typeof wsProj === "function" && !wsProj().length) return; return _dashProjects.apply(this, arguments); };
    }

    /* API y webhooks: revocar una clave de verdad (pide confirmación) */
    var _viewList = viewList;
    viewList = function (key) {
      var r = _viewList.apply(this, arguments);
      if (key === "planear/investigacion" && !LISTS[key].length) $("#body").innerHTML = '<article class="card"><p class="empty-note">Todavía no hay investigaciones. Agrega fuentes y la IA te arma los temas.</p></article>';
      if (key === "configuracion/apis") {
        if (!LISTS[key].length) $("#body").innerHTML = '<article class="card"><p class="empty-note">Todavía no hay claves de API en este espacio.</p></article>';
        document.querySelectorAll("#body .li .btn").forEach(function (btn, i) {
          btn.onclick = function () {
            var k = (R.keys || [])[i], b = bridge(); if (!k || !b) return;
            if (!confirm("¿Revocar «" + (k.label || "esta clave") + "»? Lo que la use dejará de funcionar.")) return;
            b.api("/api/workspaces/" + encodeURIComponent(R.ws) + "/api-keys/" + encodeURIComponent(k.id), { method: "DELETE" })
              .then(function () { R.keys.splice(i, 1); applyKeys(R.keys); uiToast("Clave revocada"); go(); }, function (e) { uiToast("No se pudo revocar: " + (e && e.message)); });
          };
        });
      }
      return r;
    };

    /* Oportunidades: arrastrar una tarjeta a otra columna guarda su etapa */
    var _dvOpp = drawView;
    drawView = function () {
      var r = _dvOpp.apply(this, arguments);
      if (route.mod === "vender" && route.sub === "oportunidades" && R.oppIds) document.querySelectorAll(".kanban>.col[data-c]").forEach(function (col) {
        var ids = R.oppIds[+col.dataset.c] || [];
        col.querySelectorAll(".kc").forEach(function (c, i) { if (ids[i]) c.dataset.db = ids[i]; });
      });
      return r;
    };
    document.addEventListener("drop", function (e) {
      if (!R.on || route.mod !== "vender" || route.sub !== "oportunidades") return;
      var c = document.querySelector(".kanban .kc.drag"), col = e.target.closest && e.target.closest(".col[data-c]");
      if (!c || !col || !c.dataset.db) return;
      var st = STAGES[+col.dataset.c]; if (!st) return;
      patch("crm_deals", c.dataset.db, { stage: st[0] }).then(function () { uiToast("Movida a " + st[1]); if (R.reload) R.reload(); }, function (x) { uiToast("No se pudo mover: " + (x && x.message)); if (R.reload) R.reload(); });
    });

    /* cambiar de espacio carga sus datos */
    var _wsSwitch = wsSwitch;
    wsSwitch = function (id) {
      WSX.cur = id; KHX.items = null;
      wipeDemo();
      loadWorkspace(id).then(function () { _wsSwitch(id); }, function () { _wsSwitch(id); });
    };
  }

  /* la maqueta tiene la fecha fija en el 27 de octubre: se usa la de hoy */
  try { NOW.setTime(Date.now()); } catch (e) {}

  /* ── arranque ── */
  function start(b) {
    var list0;
    Promise.all([get("workspace_members?user_id=eq." + encodeURIComponent(b.userId || "") + "&select=workspace_id,role,workspaces(name)"), extras, get("user_profiles?id=eq." + encodeURIComponent(b.userId || "") + "&select=access_plan")]).then(function (r) {
      list0 = r[0] || []; R.accessPlan = (r[2] && r[2][0] && r[2][0].access_plan) || null;
      setupWorkspaces(b, list0);
      wipeDemo();
      hookViews();
      R.on = true;
      var ws = R.savedWs && WSS[R.savedWs] ? R.savedWs : b.workspaceId;
      WSX.cur = ws;
      return loadWorkspace(ws);
    }).then(function () {
      KHX.items = null;
      if (R.restoreState) R.restoreState();
      wsCard();
      if (!(FL && FL.open) && !(ED && ED.open) && !(VE && VE.open)) go();
      return R.afterRestore ? R.afterRestore() : null;
    }).then(function () { unveil(); syncHash(); }, function (e) { unveil(); console.warn("[bridge] arranque:", e && e.message); });
  }

  /* mientras llegan tus datos no se muestran los de ejemplo */
  var veil = null;
  if (host) {
    veil = document.createElement("style");
    veil.textContent = "#view,#nav,.ws,.side-foot.me{visibility:hidden}#mb-load{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;pointer-events:none}#mb-load span{display:inline-block;width:9px;height:9px;margin:0 4px;border-radius:50%;background:#ff5e00;animation:mbp 1s ease-in-out infinite}#mb-load span:nth-child(2){animation-delay:.15s}#mb-load span:nth-child(3){animation-delay:.3s}@keyframes mbp{0%,80%,100%{opacity:.25;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}";
    document.head.appendChild(veil);
    var ld = document.createElement("div"); ld.id = "mb-load"; ld.innerHTML = "<div><span></span><span></span><span></span></div>"; document.body.appendChild(ld);
    setTimeout(unveil, 15000);
  }
  function unveil() { if (veil) { veil.remove(); veil = null; } var l = document.getElementById("mb-load"); if (l) l.remove(); }

  var tries = 0;
  (function wait() {
    var b = bridge();
    if (b && b.workspaceId && b.userId) return start(b);
    if (++tries < 120) setTimeout(wait, 250);
  })();
})();
