/* bridge-brain.js — Segundo cerebro real.
 * El vault se arma solo con la estructura de Musa: Espacio › Marcas › (Design system, Diseños, Calendario,
 * Briefs, Campañas, Eventos, Mailing, Formularios, Cotizaciones, Oportunidades, Personas, Proyectos) más
 * lo que no cuelga de una marca (Videos, Automatizaciones, Playbooks). Encima van tus notas en markdown,
 * enlazables con [[Nombre]] a otra nota o a cualquier marca o ítem. Las IAs lo leen entero con la tool
 * MCP brain_vault. Se importa desde una carpeta de Obsidian y se exporta como vault (.zip).
 */
(function () {
  /* Los botones secundarios de la cabecera (Importar, Exportar) van en tinta negra con borde
   * y texto blancos: no compiten por atención con la acción primaria naranja («Nueva nota»). */
  var css = document.createElement("style");
  css.textContent = ".head .actions .btn-g.mbb-ink{background:#000;border:1.5px solid #fff;color:#fff}"
    /* celular y tablet: Documentos en una columna (árbol, documento, enlaces) y pestañas deslizables */
    + "@media (max-width:900px){.br-docs{grid-template-columns:minmax(0,1fr)}.br-side{position:static;max-height:none}.br-doc{min-width:0}"
    + ".br-top .seg{max-width:100%;overflow-x:auto;flex-wrap:nowrap;scrollbar-width:none}.br-top .seg button{white-space:nowrap;flex:0 0 auto}.br-docs .br-side:first-child{max-height:45vh;overflow:auto}}";
  document.head.appendChild(css);
  function RB() { return window.__musaReal; }
  function bridge() { try { return window.parent !== window && window.parent.__musaBridge; } catch (e) { return null; } }
  function api(path, init) { var b = bridge(); if (!b) return Promise.reject(new Error("sin puente")); return b.api(path.charAt(0) === "/" ? path : "/rest/v1/" + path, init); }
  function get(p) { return api(p).catch(function () { return []; }).then(function (r) { return r || []; }); }
  function J(m, b) { return { method: m, headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(b) }; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function real() { return RB() && RB().on; }
  function ws() { return RB().ws; }
  function ago(iso) { if (!iso) return "—"; var d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5); return d <= 0 ? "hoy" : d === 1 ? "ayer" : "hace " + d + " días"; }
  function slug(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "nota"; }

  /* tipos de ítem: clave en el cerebro, nombre, tipo que devuelve brain_items (una consulta para todos los módulos),
   * estado que se muestra y dónde se abre */
  function J2(a) { return a.filter(function (x) { return x != null && x !== ""; }).join(" · "); }
  function money(c, v) { return v == null ? "" : (c === "USD" ? "US$ " : "S/ ") + v; }
  var T = [
    ["diseno", "Diseños", "disenos", function () { return ""; }, function (id) { return "crear/disenos/tpl:" + id; }],
    ["pieza", "Calendario", "calendario", function (e) { return J2([e.fecha, e.formato, e.estado]); }, "planear/calendario"],
    ["brief", "Briefs", "briefs", function (e) { return e.estado; }, "planear/briefs", function (e) { return e.objetivo; }],
    ["campana", "Campañas", "campanas", function (e) { return J2([e.estado, e.presupuesto_usd != null ? "US$ " + e.presupuesto_usd : ""]); }, "anunciar/campanas"],
    ["anuncio", "Campañas de ads", "anuncios", function (e) { return J2([e.red, e.estado, e.objetivo]); }, "anunciar/campanas"],
    ["audiencia", "Audiencias", "audiencias", function (e) { return J2([e.tipo, e.tamano]); }, "anunciar/audiencias"],
    ["evento", "Eventos", "eventos", function (e) { return J2([e.fecha, e.publicado ? "publicado" : ""]); }, function (id) { return "crear/eventos/e_" + id; }],
    ["mailing", "Mailing", "mailing", function (e) { return J2([e.tipo === "secuencia" ? "secuencia" : "campaña", e.estado]); }, "crear/mailing"],
    ["form", "Formularios", "formularios", function (e) { return (e.respuestas || 0) + " respuestas"; }, "crear/formularios"],
    ["website", "Websites", "websites", function (e) { return J2([e.publicado ? "publicado" : "borrador", e.slug ? "/w/" + e.slug : ""]); }, "websites"],
    ["publicacion", "Publicaciones", "publicaciones", function (e) { return J2([e.estado, e.modo]); }, "configuracion/publicar"],
    ["cuenta_social", "Cuentas sociales", "cuentas_sociales", function (e) { return J2([e.red, e.estado]); }, "configuracion/publicar"],
    ["bandeja", "Bandeja", "bandeja", function (e) { return J2([e.red, e.estado]); }, "conversar/bandeja"],
    ["cotizacion", "Cotizaciones", "cotizaciones", function (e) { return J2([e.estado, money(e.moneda, e.total)]); }, "vender/cotizaciones"],
    ["oportunidad", "Oportunidades", "oportunidades", function (e) { return J2([e.etapa, money(e.moneda, e.valor)]); }, "vender/oportunidades", function (e) { return e.siguiente_paso; }],
    ["persona", "Personas", "personas", function (e) { return J2([e.email, e.estado]); }, "vender/personas"],
    ["interaccion", "Interacciones", "interacciones", function (e) { return e.tipo; }, "vender/personas"],
    ["proyecto", "Proyectos", "proyectos", function (e) { return e.estado; }, "clientes/proyectos"],
    ["tarea_proyecto", "Tareas de proyecto", "tareas_proyecto", function (e) { return J2([e.estado, e.fecha]); }, "clientes/proyectos"],
    ["tarea", "Mi trabajo", "tareas", function (e) { return J2([e.estado, e.prioridad, e.fecha]); }, "inicio/mi-trabajo"],
    ["fee", "Fees", "fees", function (e) { return J2([money(e.moneda, e.fee), e.piezas ? e.piezas + " piezas" : ""]); }, "clientes/fees"],
    ["investigacion", "Investigación", "investigacion", function (e) { return J2([e.fuente, e.estado]); }, "planear/investigacion"],
    ["fuente", "Fuentes de investigación", "fuentes", function (e) { return J2([e.tipo, e.activa ? "activa" : "pausada"]); }, "planear/investigacion"],
    ["copy", "Copys", "copys", function (e) { return J2([e.tipo, e.usos ? e.usos + " usos" : ""]); }, "crear/copys"],
    ["video", "Videos", "videos", function (e) { return e.formato; }, function (id) { return "crear/videos/vid:" + id; }],
    ["guion", "Guiones", "guiones", function (e) { return e.formato; }, "crear/tomas"],
    ["clon", "Clones IA", "clones", function (e) { return J2([e.tipo, e.estado]); }, "crear/clones"],
    ["flow", "Automatizaciones", "automatizaciones", function (e) { return e.activo ? "activo" : "borrador"; }, function (id) { return "crear/automatizaciones/" + id; }],
    ["playbook", "Playbooks", "playbooks", function (e) { return e.categoria; }, "planear/playbooks"],
    ["skill", "Skills", "skills", function (e) { return e.version ? "v" + e.version : ""; }, "agentes/skills", function (e) { return e.descripcion; }],
    ["agente", "Agentes", "agentes", function (e) { return J2([e.rol, e.estado]); }, "agentes/mis-agentes"],
    ["receta", "Recetas", "recetas", function () { return ""; }, "crear/plantillas", function (e) { return e.descripcion; }],
    ["archivo", "Biblioteca", "biblioteca", function (e) { return e.tipo; }, "crear/disenos"],
    ["aprobacion", "Aprobaciones", "aprobaciones", function (e) { return J2([e.marca, e.estado]); }, "organizacion/aprobaciones"],
    ["area", "Áreas", "areas", function (e) { return e.lider; }, "organizacion/areas"],
    ["agencia", "Agencias externas", "agencias", function (e) { return e.plan; }, "organizacion/agencias"],
    ["loop", "Loops", "loops", function () { return ""; }, "vender/loops"],
  ];
  var BYSQL = {}; T.forEach(function (t) { BYSQL[t[2]] = t; });
  var TN = {}; T.forEach(function (t) { TN[t[0]] = t[1]; });
  var FOLDER = { "": "Notas", learning: "Aprendizajes", idea: "Ideas", brand: "Marcas", campaign: "Campañas", process: "Procesos", decision: "Decisiones", design_system: "Design systems", strategy: "Estrategia", template: "Archivos", archivos: "Archivos", copywriting: "Copywriting" };
  var V = { ws: null, brands: [], items: [], notes: [], loading: null, focus: null, sel: null, view: "grafo", q: "", edit: false, zoom: null };

  function load(force) {
    if (!force && V.ws === ws() && !V.loading) return Promise.resolve();
    if (V.loading && !force) return V.loading;
    var W = ws(), q = function (t, s, x) { return t + "?workspace_id=eq." + encodeURIComponent(W) + "&select=" + s + (x || ""); };
    V.loading = Promise.all([get(q("brands", "id,name,colors,fonts,rules,relationship_status,crm_notes,updated_at", "&order=name.asc&limit=200")), get(q("brain_notes", "id,slug,title,body_md,entity_type,entity_id,source,updated_at", "&order=updated_at.desc&limit=1000")),
      api("rpc/brain_items", J("POST", { p_ws: W, p_limit: 300 })).catch(function () { return []; })]).then(function (r) {
      V.ws = W; V.brands = r[0]; V.notes = r[1]; V.items = [];
      (Array.isArray(r[2]) ? r[2] : []).forEach(function (row) {
        var t = BYSQL[row.t]; if (!t) return; var e = row.e || {};
        var x = { type: t[0], id: row.id, k: t[0] + ":" + row.id, name: row.n || "(sin nombre)", brand: row.b, when: row.u, meta: t[3](e) || "", text: t[5] ? t[5](e) : null, href: typeof t[4] === "function" ? t[4](row.id) : t[4] };
        if (x.brand && !V.brands.some(function (b) { return b.id === x.brand; })) x.brand = null;
        V.items.push(x);
      });
      V.loading = null;
    }, function (e) { V.loading = null; throw e; });
    return V.loading;
  }
  function brand(id) { return V.brands.find(function (b) { return b.id === id; }); }
  function itemsOf(bid, type) { return V.items.filter(function (x) { return (bid === undefined || x.brand === bid) && (!type || x.type === type); }); }
  function links(body) { var o = [], m, re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g; while ((m = re.exec(body || ""))) o.push(m[1].trim()); return o; }
  /* [[X]] → nota, marca o ítem (en ese orden) */
  function resolve(name) {
    var n = String(name).toLowerCase();
    var note = V.notes.find(function (x) { return (x.title || "").toLowerCase() === n; }); if (note) return { kind: "note", id: note.id, name: note.title };
    var b = V.brands.find(function (x) { return x.name.toLowerCase() === n; }); if (b) return { kind: "brand", id: b.id, name: b.name };
    var it = V.items.find(function (x) { return (x.name || "").toLowerCase() === n; }); if (it) return { kind: "item", id: it.k, name: it.name };
    return null;
  }
  /* a qué marca / ítem pertenece una nota: por su entidad (las del sistema), por el nombre en el título o por sus [[enlaces]] */
  function noteBrands(nt) {
    var out = {};
    if (nt.entity_id && /^brand_/.test(nt.entity_id) && brand(nt.entity_id)) out[nt.entity_id] = 1;
    else if (nt.source !== "human" && nt.entity_type !== "template") { var suf = String(nt.title || "").split(": ").slice(1).join(": ").toLowerCase(); var b = V.brands.find(function (x) { return x.name.toLowerCase() === suf; }); if (b) out[b.id] = 1; }
    if (nt.entity_type === "template" && nt.entity_id) { var it0 = V.items.find(function (x) { return x.k === "diseno:" + nt.entity_id; }); if (it0 && it0.brand) out[it0.brand] = 1; }
    links(nt.body_md).forEach(function (l) { var r = resolve(l); if (!r) return; if (r.kind === "brand") out[r.id] = 1; if (r.kind === "item") { var it = V.items.find(function (x) { return x.k === r.id; }); if (it && it.brand) out[it.brand] = 1; } });
    return Object.keys(out);
  }
  function noteItem(nt) { return nt.entity_type === "template" && nt.entity_id ? "diseno:" + nt.entity_id : null; }
  function backlinks(name) { var n = String(name).toLowerCase(); return V.notes.filter(function (x) { return links(x.body_md).some(function (l) { return l.toLowerCase() === n; }); }); }

  /* ───────── markdown ───────── */
  function md(t) {
    return esc(t).split("\n").map(function (l) { return /^### /.test(l) ? "<h4>" + l.slice(4) + "</h4>" : /^## /.test(l) ? "<h3>" + l.slice(3) + "</h3>" : /^# /.test(l) ? "<h2>" + l.slice(2) + "</h2>" : /^[-*] /.test(l) ? "<li>" + l.slice(2) + "</li>" : /^\d+\. /.test(l) ? "<li>" + l.replace(/^\d+\. /, "") + "</li>" : /^&gt; /.test(l) ? "<blockquote>" + l.slice(5) + "</blockquote>" : l ? "<p>" + l + "</p>" : ""; }).join("")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*]+)\*/g, "$1<i>$2</i>").replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, function (m, x, alias) { var r = resolve(x.trim()); return '<a class="br-link ' + (r ? "" : "new") + '" data-bl="' + esc(x.trim()) + '">' + (alias || x) + "</a>"; });
  }

  /* ───────── grafo ───────── */
  var COL = { ws: "#111", brand: "var(--accent)", type: "var(--l3)", item: "#2f6fed", note: "#22a35a", attr: "#999" };
  function graphData() {
    var N = [], L = [], add = function (o) { N.push(o); return N.length - 1; };
    if (!V.focus) {
      var root = add({ t: "ws", n: (WSS[ws()] || {}).name || "Mi espacio", r: 14 });
      V.brands.forEach(function (b) { var i = add({ t: "brand", n: b.name, id: b.id, r: 10, c: itemsOf(b.id).length }); L.push([root, i]); });
      var loose = T.filter(function (t) { return itemsOf(null, t[0]).length; });
      loose.forEach(function (t) { var i = add({ t: "type", n: t[1], ty: t[0], r: 6, c: itemsOf(null, t[0]).length }); L.push([root, i]); });
      V.notes.forEach(function (nt) { var i = add({ t: "note", n: nt.title, id: nt.id, r: 5 }); var bs = noteBrands(nt); if (bs.length) bs.forEach(function (bid) { var j = N.findIndex(function (x) { return x.t === "brand" && x.id === bid; }); if (j >= 0) L.push([i, j]); }); else if (noteItem(nt)) { var tj = N.findIndex(function (x) { return x.t === "type" && x.ty === "diseno"; }); L.push([i, tj >= 0 ? tj : root]); } else L.push([i, root]); });
      V.notes.forEach(function (nt) { var i = N.findIndex(function (x) { return x.t === "note" && x.id === nt.id; }); links(nt.body_md).forEach(function (l) { var r = resolve(l); if (r && r.kind === "note") { var j = N.findIndex(function (x) { return x.t === "note" && x.id === r.id; }); if (j >= 0 && j !== i) L.push([i, j]); } }); });
    } else {
      var b = brand(V.focus); if (!b) { V.focus = null; return graphData(); }
      var c = add({ t: "brand", n: b.name, id: b.id, r: 14 });
      var cols = (b.colors || []).map(function (x) { return typeof x === "string" ? x : x && x.hex; }).filter(Boolean), fonts = (b.fonts || []).map(function (x) { return typeof x === "string" ? x : x && (x.family || x.name); }).filter(Boolean);
      var ds = add({ t: "type", n: "Design system", ty: "ds", r: 7 }); L.push([c, ds]);
      cols.slice(0, 6).forEach(function (h) { var i = add({ t: "attr", n: h, r: 4, fill: h }); L.push([ds, i]); });
      fonts.slice(0, 3).forEach(function (f) { var i = add({ t: "attr", n: f, r: 4 }); L.push([ds, i]); });
      T.forEach(function (t) {
        var its = itemsOf(b.id, t[0]); if (!its.length) return;
        var ti = add({ t: "type", n: t[1] + " · " + its.length, ty: t[0], r: 7 }); L.push([c, ti]);
        its.slice(0, 12).forEach(function (x) { var i = add({ t: "item", n: x.name, id: x.k, r: 4.5 }); L.push([ti, i]); });
      });
      V.notes.filter(function (nt) { return noteBrands(nt).indexOf(b.id) >= 0; }).forEach(function (nt) {
        var i = add({ t: "note", n: nt.title, id: nt.id, r: 5 }); var any = false;
        links(nt.body_md).forEach(function (l) { var r = resolve(l); if (!r) return; var j = N.findIndex(function (x) { return (r.kind === "item" && x.t === "item" && x.id === r.id) || (r.kind === "brand" && x.t === "brand" && x.id === r.id) || (r.kind === "note" && x.t === "note" && x.id === r.id); }); if (j >= 0 && j !== i) { L.push([i, j]); any = true; } });
        var ni = noteItem(nt), ij = ni ? N.findIndex(function (x) { return x.t === "item" && x.id === ni; }) : -1;
        if (ij >= 0) { L.push([i, ij]); any = true; }
        if (!any) L.push([i, c]);
      });
    }
    return { N: N, L: L };
  }
  /* layout por fuerzas (pocas iteraciones, determinista) */
  function layout(G, W, H) {
    var n = G.N.length, P = G.N.map(function (x, i) { var a = i * 2.39996, r = 30 + 9 * Math.sqrt(i); return [W / 2 + Math.cos(a) * r * 2.2, H / 2 + Math.sin(a) * r * 1.3]; });
    if (n) P[0] = [W / 2, H / 2];
    var k = Math.sqrt(W * H / Math.max(1, n)) * 0.55;
    for (var it = 0; it < 180; it++) {
      var D = P.map(function () { return [0, 0]; });
      for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++) { var dx = P[i][0] - P[j][0], dy = P[i][1] - P[j][1], d = Math.max(4, Math.sqrt(dx * dx + dy * dy)), f = k * k / d; D[i][0] += dx / d * f; D[i][1] += dy / d * f; D[j][0] -= dx / d * f; D[j][1] -= dy / d * f; }
      G.L.forEach(function (l) { var a = l[0], b = l[1], dx = P[a][0] - P[b][0], dy = P[a][1] - P[b][1], d = Math.max(4, Math.sqrt(dx * dx + dy * dy)), f = d * d / k; D[a][0] -= dx / d * f; D[a][1] -= dy / d * f; D[b][0] += dx / d * f; D[b][1] += dy / d * f; });
      var temp = 40 * (1 - it / 180) + 1;
      for (var q = 1; q < n; q++) { var dl = Math.sqrt(D[q][0] * D[q][0] + D[q][1] * D[q][1]) || 1; P[q][0] += D[q][0] / dl * Math.min(dl, temp); P[q][1] += D[q][1] / dl * Math.min(dl, temp); P[q][0] = Math.max(20, Math.min(W - 20, P[q][0])); P[q][1] = Math.max(20, Math.min(H - 20, P[q][1])); }
    }
    return P;
  }
  /* ───────── documentos ───────── */
  function itemDoc(x) {
    var b = brand(x.brand), bl = backlinks(x.name).concat(V.notes.filter(function (n) { return noteItem(n) === x.k; }));
    return { title: x.name, kind: TN[x.type] || x.type, ro: true, html: '<div class="br-props">' + [["Tipo", TN[x.type]], ["Marca", b ? '<a class="br-link" data-bl="' + esc(b.name) + '">' + esc(b.name) + "</a>" : "Sin marca"], ["Estado", x.meta || "—"], ["Actualizado", ago(x.when)]].map(function (r) { return "<div><span>" + r[0] + "</span><b>" + r[1] + "</b></div>"; }).join("") + "</div>"
      + (x.text ? "<p>" + esc(x.text) + "</p>" : "") + '<div class="ag-ctl" style="margin-top:12px"><button class="pri" data-bb="open" data-h="' + esc(x.href) + '">Abrir en su módulo</button><button data-bb="noteabout" data-n="' + esc(x.name) + '">+ Nota sobre esto</button></div>', back: bl };
  }
  function brandDoc(b) {
    var cols = (b.colors || []).map(function (x) { return typeof x === "string" ? { hex: x } : x; }).filter(function (x) { return x && x.hex; }), fonts = (b.fonts || []).map(function (x) { return typeof x === "string" ? x : x && (x.family || x.name); }).filter(Boolean);
    var sec = T.map(function (t) { var its = itemsOf(b.id, t[0]); if (!its.length) return ""; return "<h3>" + t[1] + " · " + its.length + "</h3><ul>" + its.slice(0, 25).map(function (x) { return '<li><a class="br-link" data-bi="' + x.k + '">' + esc(x.name) + "</a>" + (x.meta ? ' <small style="color:#888">' + esc(x.meta) + "</small>" : "") + "</li>"; }).join("") + (its.length > 25 ? "<li><small>y " + (its.length - 25) + " más…</small></li>" : "") + "</ul>"; }).join("");
    var notes = V.notes.filter(function (nt) { return noteBrands(nt).indexOf(b.id) >= 0; });
    return { title: b.name, kind: "Marca", ro: true, back: backlinks(b.name), html: (b.crm_notes ? "<p>" + esc(b.crm_notes) + "</p>" : "")
      + "<h3>Design system</h3>" + (cols.length || fonts.length ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0">' + cols.map(function (c) { return '<span style="display:inline-flex;align-items:center;gap:6px;font-size:12px"><i style="width:22px;height:22px;border-radius:6px;background:' + esc(c.hex) + ';border:1px solid #0002;display:inline-block"></i>' + esc(c.name ? c.name + " " : "") + esc(c.hex) + "</span>"; }).join("") + "</div>" + (fonts.length ? "<p>Tipografías: <b>" + fonts.map(esc).join(", ") + "</b></p>" : "") : '<p style="color:#888">Sin colores ni tipografías todavía: agrégalos en Crear › Marcas.</p>')
      + ((b.rules || []).length ? "<ul>" + b.rules.slice(0, 12).map(function (r) { return "<li>" + esc(typeof r === "string" ? r : r.text || r.rule || JSON.stringify(r)) + "</li>"; }).join("") + "</ul>" : "")
      + (sec || '<p style="color:#888">Esta marca todavía no tiene diseños, piezas ni campañas.</p>')
      + (notes.length ? "<h3>Notas · " + notes.length + "</h3><ul>" + notes.map(function (n) { return '<li><a class="br-link" data-bn="' + n.id + '">' + esc(n.title) + "</a></li>"; }).join("") + "</ul>" : "")
      + '<div class="ag-ctl" style="margin-top:12px"><button data-bb="focus" data-b="' + b.id + '">Ver en el grafo</button><button data-bb="noteabout" data-n="' + esc(b.name) + '" data-brand="' + b.id + '">+ Nota de la marca</button></div>' };
  }
  function cur() {
    var s = V.sel || ""; var m = s.match(/^(note|brand|item):(.+)$/); if (!m) return null;
    if (m[1] === "note") { var n = V.notes.find(function (x) { return x.id === m[2]; }); return n ? { note: n } : null; }
    if (m[1] === "brand") { var b = brand(m[2]); return b ? { doc: brandDoc(b) } : null; }
    var it = V.items.find(function (x) { return x.k === m[2]; }); return it ? { doc: itemDoc(it) } : null;
  }
  function tree() {
    var q = V.q.toLowerCase(), hit = function (s) { return !q || String(s || "").toLowerCase().indexOf(q) >= 0; };
    var h = '<input class="mini-search" id="brQ" placeholder="Buscar en marcas, ítems y notas…" value="' + esc(V.q) + '" style="width:100%"><h5>Marcas</h5>';
    V.brands.forEach(function (b) {
      var its = itemsOf(b.id).filter(function (x) { return hit(x.name); }); if (q && !hit(b.name) && !its.length) return;
      var open = V.open && V.open[b.id];
      h += '<button class="br-it ' + (V.sel === "brand:" + b.id ? "on" : "") + '" data-bs="brand:' + b.id + '"><b>' + (open || q ? "▾ " : "▸ ") + esc(b.name) + "</b><small>" + itemsOf(b.id).length + " ítems</small></button>";
      if (open || q) T.forEach(function (t) { var li = its.filter(function (x) { return x.type === t[0]; }); if (!li.length) return; h += '<div style="padding-left:12px"><small style="color:var(--muted);font-weight:700">' + t[1] + "</small>" + li.slice(0, 30).map(function (x) { return '<button class="br-it ' + (V.sel === "item:" + x.k ? "on" : "") + '" data-bs="item:' + x.k + '" style="padding-left:6px"><b style="font-weight:500">' + esc(x.name) + "</b></button>"; }).join("") + "</div>"; });
    });
    var loose = T.filter(function (t) { return itemsOf(null, t[0]).filter(function (x) { return hit(x.name); }).length; });
    if (loose.length) { h += "<h5>Sin marca</h5>"; loose.forEach(function (t) { var li = itemsOf(null, t[0]).filter(function (x) { return hit(x.name); }); h += '<small style="color:var(--muted);font-weight:700">' + t[1] + "</small>" + li.slice(0, 20).map(function (x) { return '<button class="br-it ' + (V.sel === "item:" + x.k ? "on" : "") + '" data-bs="item:' + x.k + '"><b style="font-weight:500">' + esc(x.name) + "</b></button>"; }).join(""); }); }
    var folders = {}; V.notes.filter(function (n) { return hit(n.title + " " + n.body_md); }).forEach(function (n) { var f = FOLDER[n.entity_type || ""] || "Notas"; (folders[f] = folders[f] || []).push(n); });
    Object.keys(folders).forEach(function (f) { h += "<h5>" + f + "</h5>" + folders[f].map(function (n) { return '<button class="br-it ' + (V.sel === "note:" + n.id ? "on" : "") + '" data-bs="note:' + n.id + '"><b>' + esc(n.title) + "</b><small>" + (n.source === "human" ? ago(n.updated_at) : "sistema") + "</small></button>"; }).join(""); });
    return h;
  }
  function docsHTML() {
    var c = cur(); if (!c) { var nt = V.notes[0]; V.sel = nt ? "note:" + nt.id : V.brands[0] ? "brand:" + V.brands[0].id : null; c = cur(); }
    var center, back = [], meta = "";
    if (!c) center = '<p class="empty-note">Tu cerebro está vacío: crea una marca o una nota.</p>';
    else if (c.note) {
      var n = c.note, mine = n.source === "human"; back = backlinks(n.title);
      meta = (FOLDER[n.entity_type || ""] || "Notas") + " · " + (mine ? "editado " + ago(n.updated_at) : "generada por Musa") + " · " + links(n.body_md).length + " enlaces";
      center = '<div class="br-dh"><input class="br-title" data-bt value="' + esc(n.title) + '" ' + (mine ? "" : "readonly") + '>' + (mine ? '<div class="seg"><button data-be="0" class="' + (V.edit ? "" : "on") + '">Leer</button><button data-be="1" class="' + (V.edit ? "on" : "") + '">Editar</button></div>' : "") + "</div><small class=\"br-meta\">" + esc(meta) + "</small>"
        + (V.edit && mine ? '<textarea class="br-ed" data-bbody rows="18">' + esc(n.body_md) + '</textarea><small class="br-meta">Markdown · [[Nombre]] enlaza otra nota, una marca o cualquier diseño, brief, campaña… de tu espacio.</small>' : '<div class="br-md">' + md(n.body_md) + "</div>");
    } else { back = c.doc.back || []; center = '<div class="br-dh"><input class="br-title" readonly value="' + esc(c.doc.title) + '"><span class="ag-tag">' + esc(c.doc.kind) + '</span></div><div class="br-md">' + c.doc.html + "</div>"; }
    var right = "<h5>Enlaces entrantes · " + back.length + "</h5>" + (back.map(function (x) { return '<button class="br-it" data-bs="note:' + x.id + '"><b>' + esc(x.title) + "</b><small>" + esc(FOLDER[x.entity_type || ""] || "Notas") + "</small></button>"; }).join("") || '<small style="color:#888">Ninguna nota apunta aquí todavía.</small>')
      + '<h5>La usan</h5><div class="mc-auto"><i style="background:var(--accent)"></i><span>Tus agentes<small>leen el vault entero con brain_vault y cómo operas con brain_operator</small></span></div>'
      + (c && c.note && c.note.source === "human" ? '<div class="ag-ctl" style="margin-top:10px"><button data-bb="del">Eliminar nota</button></div>' : "");
    return '<div class="br-docs"><aside class="br-side">' + tree() + '</aside><article class="br-doc">' + center + '</article><aside class="br-side">' + right + "</aside></div>";
  }

  /* ───────── vista ───────── */
  /* «Importar» en la cabecera, a la izquierda de «Exportar»: es el mismo flujo que estaba en la
   * barra del cerebro, renombrado porque en este contexto solo se importa desde Obsidian. */
  function headButtons() {
    var act = document.querySelector(".head .actions");
    if (!act || act.dataset.mbb) return;
    act.dataset.mbb = "1";
    var im = document.createElement("button");
    im.className = "btn btn-g mbb-ink";
    im.textContent = "Importar";
    im.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); importVault(); });
    var ex = act.querySelector(".btn-g");
    if (ex && ex.parentNode === act) { act.insertBefore(im, ex); ex.classList.add("mbb-ink"); }
    /* «Exportar» del cerebro descarga el vault entero (.zip con .md para Obsidian); antes no hacía nada */
    if (ex) { ex.title = "Descargar el vault como .zip (ábrelo en Obsidian)"; ex.onclick = function (e) { e.preventDefault(); e.stopPropagation(); uiToast("Armando el vault…"); exportVault(); }; }
    else act.insertBefore(im, act.firstChild);
  }
  function view() {
    if (!real()) return;
    headButtons();
    $("#body").innerHTML = '<p class="empty-note">Cargando tu cerebro…</p>';
    load().then(draw, function (e) { $("#body").innerHTML = '<p class="empty-note">No se pudo cargar: ' + esc(e && e.message) + "</p>"; });
  }
  function draw() {
    var nItems = V.items.length;
    var top = '<div class="br-top"><div class="seg">' + [["grafo", "Grafo"], ["docs", "Documentos · " + (V.notes.length + nItems + V.brands.length)], ["opera", "Cómo operas"]].map(function (x) { return '<button data-bv="' + x[0] + '" class="' + (V.view === x[0] ? "on" : "") + '">' + x[1] + "</button>"; }).join("") + "</div>"
      /* Importar subió a la cabecera (izquierda de Exportar) y «Exportar vault» quedó oculto;
       * exportVault() sigue disponible por si vuelve. */
      + '<span class="br-sync"><i></i>' + V.brands.length + " marcas · " + nItems + " ítems · " + V.notes.length + ' notas</span><button class="btn btn-p" data-bra="new">+ Nueva nota</button></div>';
    var html;
    if (V.view === "grafo") { html = '<article class="card"><div class="ch"><h3>' + (V.focus ? esc((brand(V.focus) || {}).name) : "Segundo cerebro") + '</h3><div class="legend" style="margin:0"><span><i style="background:var(--accent)"></i>Marca</span><span><i style="background:var(--l3)"></i>Tipo</span><span><i style="background:#2f6fed"></i>Ítem</span><span><i style="background:#22a35a"></i>Nota</span></div></div>' + graphMarkup() + "</article>"; }
    else if (V.view === "opera") html = operaHTML();
    else html = docsHTML();
    $("#body").innerHTML = top + html;
    bind();
    if (V.view === "opera") loadOpera();
  }
  function graphMarkup() { var G = graphData(), W = 960, H = 560, P = layout(G, W, H), vb = V.zoom || [0, 0, W, H]; V._G = G;
    return '<div class="br-gwrap" style="position:relative"><svg class="chart br-svg" id="brSvg" viewBox="' + vb.join(" ") + '" style="width:100%;height:560px;cursor:grab">'
      + G.L.map(function (l) { return '<line x1="' + P[l[0]][0].toFixed(1) + '" y1="' + P[l[0]][1].toFixed(1) + '" x2="' + P[l[1]][0].toFixed(1) + '" y2="' + P[l[1]][1].toFixed(1) + '" style="stroke:var(--border-2)" stroke-width="1"/>'; }).join("")
      + G.N.map(function (x, i) { var lab = x.n.length > 26 ? x.n.slice(0, 25) + "…" : x.n; return '<g data-g="' + i + '" style="cursor:pointer"><circle cx="' + P[i][0].toFixed(1) + '" cy="' + P[i][1].toFixed(1) + '" r="' + x.r + '" style="fill:' + (x.fill || COL[x.t]) + '"/><text x="' + P[i][0].toFixed(1) + '" y="' + (P[i][1] + x.r + 11).toFixed(1) + '" text-anchor="middle" style="font-size:' + (x.t === "ws" || x.t === "brand" ? 11.5 : 9.5) + "px;font-weight:" + (x.t === "item" || x.t === "attr" ? 400 : 700) + ';fill:var(--text);pointer-events:none">' + esc(lab) + (x.c != null ? " (" + x.c + ")" : "") + "</text></g>"; }).join("")
      + "</svg>" + (V.focus ? '<button class="btn btn-g" data-bb="up" style="position:absolute;top:10px;left:10px">← Todas las marcas</button>' : "") + '<small style="position:absolute;bottom:8px;right:12px;color:var(--muted)">Rueda: zoom · arrastra: mover · clic: abrir</small></div>'; }

  function openKey(k) { V.sel = k; V.view = "docs"; V.edit = false; if (/^brand:/.test(k)) { V.open = V.open || {}; V.open[k.slice(6)] = true; } draw(); }
  function saveNote(n, patch) {
    clearTimeout(saveNote.t);
    saveNote.t = setTimeout(function () { patch.updated_at = new Date().toISOString(); api("brain_notes?id=eq." + n.id, J("PATCH", patch)).then(function () {}, function (e) { uiToast("No se pudo guardar la nota: " + (e && e.message)); }); }, 600);
  }
  function newNote(title, body, entity) {
    var s = "nota-" + slug(title) + "-" + Math.random().toString(36).slice(2, 8);
    return api("brain_notes", J("POST", Object.assign({ workspace_id: ws(), slug: s, title: title, body_md: body, source: "human" }, entity || {}))).then(function (r) { var n = r && r[0]; if (n) V.notes.unshift(n); return n; });
  }
  function bind() {
    var body = $("#body");
    body.onclick = function (e) {
      var g = function (k) { return e.target.closest("[data-" + k + "]"); }, b;
      if ((b = g("bv"))) { V.view = b.dataset.bv; return draw(); }
      if ((b = g("g")) && V._G) { if (body._dragged) return; var x = V._G.N[+b.dataset.g]; if (!x) return;
        if (x.t === "brand") { if (V.focus === x.id) return openKey("brand:" + x.id); V.focus = x.id; V.zoom = null; return draw(); }
        if (x.t === "note") return openKey("note:" + x.id); if (x.t === "item") return openKey("item:" + x.id);
        if (x.t === "type" && x.ty !== "ds" && V.focus) { var f = itemsOf(V.focus, x.ty)[0]; if (f) return openKey("item:" + f.k); }
        if (x.t === "type" && x.ty === "ds" && V.focus) return openKey("brand:" + V.focus);
        return; }
      if ((b = g("bs"))) { var k = b.dataset.bs; if (/^brand:/.test(k) && V.sel === k) { V.open = V.open || {}; V.open[k.slice(6)] = !V.open[k.slice(6)]; return draw(); } return openKey(k); }
      if ((b = g("bi"))) return openKey("item:" + b.dataset.bi);
      if ((b = g("bn"))) return openKey("note:" + b.dataset.bn);
      if ((b = g("bl"))) { var r = resolve(b.dataset.bl); if (r) return openKey(r.kind + ":" + r.id); var t = b.dataset.bl; return newNote(t, "# " + t + "\n").then(function (n) { if (n) { uiToast("Nota «" + t + "» creada desde el enlace"); V.edit = true; openKey("note:" + n.id); V.edit = true; draw(); } }); }
      if ((b = g("be"))) { V.edit = b.dataset.be === "1"; return draw(); }
      if ((b = g("bod"))) { V.days = +b.dataset.bod; OP.data = null; return draw(); }
      if ((b = g("bol"))) return saveLesson();
      if ((b = g("bb"))) {
        var a = b.dataset.bb;
        if (a === "up") { V.focus = null; V.zoom = null; return draw(); }
        if (a === "focus") { V.focus = b.dataset.b; V.view = "grafo"; V.zoom = null; return draw(); }
        if (a === "open") { location.hash = b.dataset.h; return; }
        if (a === "noteabout") { var nm = b.dataset.n; return newNote("Nota · " + nm, "# Nota · " + nm + "\nSobre [[" + nm + "]]\n\n", b.dataset.brand ? { entity_type: "brand", entity_id: b.dataset.brand } : null).then(function (n) { if (n) { V.edit = true; V.sel = "note:" + n.id; V.view = "docs"; draw(); } }); }
        if (a === "del") { var c = cur(); if (!c || !c.note) return; return window.__musaReal.confirmBox("¿Eliminar la nota «" + c.note.title + "»?", { danger: true, ok: "Eliminar" }).then(function (ok) { if (!ok) return; return api("brain_notes?id=eq." + c.note.id, { method: "DELETE" }).then(function () { V.notes = V.notes.filter(function (x) { return x.id !== c.note.id; }); V.sel = null; uiToast("Nota eliminada"); draw(); }); }); }
        if (a === "import") return importVault();
        if (a === "export") return exportVault();
      }
    };
    body.oninput = function (e) {
      if (e.target.id === "brQ") { V.q = e.target.value; draw(); var q = $("#brQ"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); return; }
      var c = cur(); if (!c || !c.note || c.note.source !== "human") return;
      if (e.target.dataset.bbody != null) { c.note.body_md = e.target.value; saveNote(c.note, { body_md: c.note.body_md }); }
      if (e.target.dataset.bt != null) { c.note.title = e.target.value; saveNote(c.note, { title: c.note.title }); }
    };
    var svg = document.getElementById("brSvg");
    if (svg) {
      var W = 960, H = 560;
      svg.addEventListener("wheel", function (e) { e.preventDefault(); var vb = V.zoom || [0, 0, W, H], f = e.deltaY > 0 ? 1.15 : 0.87, r = svg.getBoundingClientRect(), mx0 = vb[0] + (e.clientX - r.left) / r.width * vb[2], my0 = vb[1] + (e.clientY - r.top) / r.height * vb[3]; var nw = Math.max(160, Math.min(W * 3, vb[2] * f)), nh = nw * H / W; V.zoom = [mx0 - (mx0 - vb[0]) * nw / vb[2], my0 - (my0 - vb[1]) * nh / vb[3], nw, nh]; svg.setAttribute("viewBox", V.zoom.join(" ")); }, { passive: false });
      var drag = null;
      svg.addEventListener("pointerdown", function (e) { drag = { x: e.clientX, y: e.clientY, vb: (V.zoom || [0, 0, W, H]).slice() }; body._dragged = false; });
      window.addEventListener("pointermove", function (e) { if (!drag) return; var r = svg.getBoundingClientRect(), dx = (e.clientX - drag.x) / r.width * drag.vb[2], dy = (e.clientY - drag.y) / r.height * drag.vb[3]; if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) body._dragged = true; V.zoom = [drag.vb[0] - dx, drag.vb[1] - dy, drag.vb[2], drag.vb[3]]; svg.setAttribute("viewBox", V.zoom.join(" ")); });
      window.addEventListener("pointerup", function () { drag = null; setTimeout(function () { body._dragged = false; }, 0); });
    }
  }

  /* ───────── Obsidian: importar una carpeta y exportar el vault ───────── */
  function importVault() {
    mx("Importar de Obsidian", "Elige la carpeta de tu vault: cada archivo .md entra como nota (la carpeta de Obsidian queda como su carpeta). Los [[enlaces]] se conservan y se conectan con tus marcas e ítems si coinciden por nombre. Si una nota ya existe con el mismo título, se actualiza.",
      '<input type="file" id="brVault" webkitdirectory directory multiple class="fx-in"><p class="int-note" id="brVN" style="margin-top:8px">Solo se leen archivos .md; las imágenes y adjuntos se ignoran.</p><div class="ag-ctl" style="margin-top:10px"><button class="pri" data-a="go">Importar</button></div>',
      function (e) {
        if (!e.target.closest('[data-a="go"]')) return;
        var files = [].filter.call((document.getElementById("brVault") || {}).files || [], function (f) { return /\.md$/i.test(f.name) && !/(^|\/)\.(obsidian|trash)\//.test(f.webkitRelativePath || ""); });
        var note = document.getElementById("brVN");
        if (!files.length) { note.textContent = "No encontré archivos .md en esa carpeta."; return; }
        if (files.length > 500) { note.textContent = "Son " + files.length + " notas: se importan las primeras 500."; files = files.slice(0, 500); }
        e.target.closest("button").disabled = true;
        var MAPF = { marcas: "brand", ideas: "idea", "campañas": "campaign", campanas: "campaign", procesos: "process", decisiones: "decision" };
        var done = 0, upd = 0, add = 0;
        var step = function (i) {
          if (i >= files.length) { mxEl.hidden = true; uiToast("Importadas " + add + " notas nuevas y " + upd + " actualizadas"); V.ws = null; return view(); }
          var f = files[i], path = (f.webkitRelativePath || f.name).split("/"), folder = path.length > 2 ? path[path.length - 2].toLowerCase() : "", title = f.name.replace(/\.md$/i, "");
          f.text().then(function (txt) {
            txt = txt.replace(/^---\n[\s\S]*?\n---\n/, "").slice(0, 100000);
            var ex = V.notes.find(function (n) { return n.title.toLowerCase() === title.toLowerCase() && n.source === "human"; });
            var et = MAPF[folder] || null;
            return (ex ? api("brain_notes?id=eq." + ex.id, J("PATCH", { body_md: txt, updated_at: new Date().toISOString() })).then(function () { ex.body_md = txt; upd++; }) : newNote(title, txt, et ? { entity_type: et } : null).then(function () { add++; }));
          }).then(function () { note.textContent = "Importando… " + (++done) + " de " + files.length; step(i + 1); }, function () { done++; step(i + 1); });
        };
        step(0);
      });
  }
  /* zip mínimo (sin compresión) para no depender de librerías */
  var CRC = (function () { var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u) { var c = 0xffffffff; for (var i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function zip(files) {
    var enc = new TextEncoder(), parts = [], central = [], off = 0;
    var u16 = function (v) { return [v & 255, (v >>> 8) & 255]; }, u32 = function (v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; };
    files.forEach(function (f) {
      var name = enc.encode(f.path), data = enc.encode(f.text), crc = crc32(data);
      var head = [].concat([0x50, 0x4b, 3, 4], u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      parts.push(new Uint8Array(head), name, data);
      central.push(new Uint8Array([].concat([0x50, 0x4b, 1, 2], u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off))), name);
      off += head.length + name.length + data.length;
    });
    var csize = central.reduce(function (s, x) { return s + x.length; }, 0);
    return new Blob(parts.concat(central, [new Uint8Array([].concat([0x50, 0x4b, 5, 6], u16(0), u16(0), u16(files.length), u16(files.length), u32(csize), u32(off), u16(0)))]), { type: "application/zip" });
  }
  function safe(s) { return String(s || "sin-nombre").replace(/[\\/:*?"<>|#^[\]]+/g, "-").slice(0, 90); }
  function exportVault() {
    load().then(function () {
      var files = [], root = safe((WSS[ws()] || {}).name || "Musa");
      V.brands.forEach(function (b) {
        var d = brandDoc(b), cols = (b.colors || []).map(function (x) { return typeof x === "string" ? x : x && x.hex; }).filter(Boolean);
        var lines = ["# " + b.name, "", "## Design system", cols.length ? "Colores: " + cols.join(", ") : "Sin colores", ""].concat(T.map(function (t) { var its = itemsOf(b.id, t[0]); return its.length ? "## " + t[1] + "\n" + its.map(function (x) { return "- [[" + safe(x.name) + "]]" + (x.meta ? " · " + x.meta : ""); }).join("\n") + "\n" : ""; }));
        files.push({ path: root + "/Marcas/" + safe(b.name) + "/" + safe(b.name) + ".md", text: lines.join("\n") });
        void d;
        itemsOf(b.id).forEach(function (x) { files.push({ path: root + "/Marcas/" + safe(b.name) + "/" + TN[x.type] + "/" + safe(x.name) + ".md", text: "# " + x.name + "\n\nMarca: [[" + safe(b.name) + "]]\nTipo: " + TN[x.type] + (x.meta ? "\nEstado: " + x.meta : "") + (x.text ? "\n\n" + x.text : "") + "\n" }); });
      });
      T.forEach(function (t) { itemsOf(null, t[0]).forEach(function (x) { files.push({ path: root + "/" + t[1] + "/" + safe(x.name) + ".md", text: "# " + x.name + "\n\nTipo: " + t[1] + (x.meta ? "\nEstado: " + x.meta : "") + "\n" }); }); });
      V.notes.forEach(function (n) { files.push({ path: root + "/Notas/" + (FOLDER[n.entity_type || ""] || "Notas") + "/" + safe(n.title) + ".md", text: n.body_md || "" }); });
      var a = document.createElement("a"); a.href = URL.createObjectURL(zip(files)); a.download = root + "-vault.zip"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      uiToast("Vault exportado: " + files.length + " archivos .md (ábrelo como carpeta en Obsidian)");
    });
  }

  /* ───────── cómo operas: el perfil que leen tus IAs (brain_operator) ───────── */
  var OP = { data: null, ws: null, days: 0, loading: false, err: null };
  function loadOpera() {
    var d = V.days || 30;
    if (OP.loading || (OP.data && OP.ws === ws() && OP.days === d)) return;
    if (!RB().mcp) { OP.err = "La IA de Musa todavía está cargando; vuelve a abrir esta pestaña."; return; }
    OP.loading = true; OP.err = null;
    flushTrack();
    RB().mcp("brain_operator", { workspaceId: ws(), days: d, timeline: 40 }).then(function (r) { OP.data = r; OP.ws = ws(); OP.days = d; }, function (e) { OP.err = (e && e.message) || "error"; OP.ws = ws(); OP.days = d; })
      .then(function () { OP.loading = false; if (V.view === "opera" && route.mod === "inicio" && route.sub === "cerebro") draw(); });
  }
  function bars(rows, key, lab, valText) {
    var max = Math.max.apply(null, rows.map(function (r) { return r[key] || 0; }).concat([1]));
    return rows.map(function (r) { var v = r[key] || 0; return '<div style="display:grid;grid-template-columns:minmax(90px,38%) 1fr auto;gap:8px;align-items:center;margin:5px 0;font-size:12.5px"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(lab(r)) + '">' + esc(lab(r)) + '</span><i style="display:block;height:8px;border-radius:4px;background:var(--accent);width:' + Math.max(2, Math.round(v / max * 100)) + '%"></i><b style="font-variant-numeric:tabular-nums;white-space:nowrap">' + esc(valText ? valText(r) : v) + "</b></div>"; }).join("");
  }
  function lst(rows, fn, empty) { return rows && rows.length ? '<ul style="margin:4px 0 0;padding-left:18px">' + rows.map(function (r) { return '<li style="margin:3px 0">' + fn(r) + "</li>"; }).join("") + "</ul>" : '<p style="color:var(--muted);font-size:12.5px;margin:4px 0">' + empty + "</p>"; }
  function card(title, body, sub) { return '<article class="card" style="padding:16px;min-width:0"><div class="ch" style="margin-bottom:6px"><h3>' + title + "</h3>" + (sub ? '<small style="color:var(--muted)">' + sub + "</small>" : "") + "</div>" + body + "</article>"; }
  function small(t) { return ' <small style="color:var(--muted)">' + t + "</small>"; }
  function operaHTML() {
    var d = V.days || 30;
    var head = '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin:4px 0 12px"><p style="margin:0;color:var(--muted);font-size:13px;max-width:640px">Así trabajas en este espacio: qué abres, cuánto tiempo, qué haces y qué le pides a tu IA. Solo tú lo ves; tus IAs lo leen para coordinar contigo como tú trabajas.</p><div class="seg">' + [7, 30, 90].map(function (n) { return '<button data-bod="' + n + '" class="' + (d === n ? "on" : "") + '">' + n + " días</button>"; }).join("") + "</div></div>";
    var fresh = OP.ws === ws() && OP.days === d;
    var p = fresh ? OP.data : null;
    if (!p) return head + '<p class="empty-note">' + (fresh && OP.err ? "No se pudo leer tu perfil: " + esc(OP.err) : "Leyendo cómo operas…") + "</p>";
    var r = p.resumen || {};
    if (!r.acciones_humanas && !r.minutos_activos && !r.acciones_ia) return head + '<p class="empty-note">Todavía no hay actividad registrada en este periodo. Sigue trabajando en Musa: cada pantalla que abras, lo que crees o edites y lo que hagas con tu IA aparecerá aquí.</p><div style="max-width:640px">' + lessonsCard(p) + "</div>";
    var kpi = [["Días activos", r.dias_activos], ["Sesiones", r.sesiones], ["Minutos trabajando", r.minutos_activos], ["Acciones tuyas", r.acciones_humanas], ["Acciones de tu IA", r.acciones_ia]];
    var h = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:12px">' + kpi.map(function (k) { return '<article class="card" style="padding:14px"><small style="color:var(--muted)">' + k[0] + '</small><div style="font-size:24px;font-weight:800;font-variant-numeric:tabular-nums">' + (k[1] || 0) + "</div></article>"; }).join("") + "</div>";
    var hr = p.horario || { por_hora: [], horas_pico: [], dias_pico: [] }, hrs = hr.por_hora || [], hmax = Math.max.apply(null, hrs.concat([1]));
    var hourBars = '<div style="display:flex;align-items:flex-end;gap:2px;height:70px;margin-top:8px">' + hrs.map(function (v, i) { return '<i title="' + i + ":00 · " + v + '" style="flex:1;display:block;border-radius:2px 2px 0 0;background:' + (v ? "var(--accent)" : "var(--border-2)") + ";height:" + Math.max(3, Math.round(v / hmax * 100)) + '%"></i>'; }).join("") + '</div><div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--muted)"><span>0 h</span><span>6</span><span>12</span><span>18</span><span>23</span></div>';
    var ia = p.ia || { agentes: [], herramientas: [], errores: [] };
    (p.modulos || []).forEach(function (m) { m.peso = m.minutos + m.acciones * 2; }); /* el mismo orden que usa el servidor */
    var g = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px">';
    g += card("Dónde trabajas", p.modulos && p.modulos.length ? bars(p.modulos.slice(0, 10), "peso", function (m) { return m.nombre; }, function (m) { return m.minutos + " min · " + m.acciones + " acc."; }) : '<p style="color:var(--muted)">Sin datos</p>', "minutos en pantalla y acciones");
    g += card("Cuándo trabajas", hourBars + '<p style="font-size:12.5px;margin:8px 0 0">' + (hr.horas_pico.length ? "Horas pico: <b>" + hr.horas_pico.join(", ") + "</b>" : "") + (hr.dias_pico.length ? " · Días: <b>" + hr.dias_pico.join(", ") + "</b>" : "") + "</p>");
    g += card("Tu flujo típico", lst(p.flujo_tipico, function (f) { return esc(f.paso) + small(f.veces + "×"); }, "Aún no hay suficientes pasos entre módulos."));
    g += card("Lo que haces", (p.acciones || []).length ? bars(p.acciones, "veces", function (a) { return a.accion; }) : '<p style="color:var(--muted);font-size:12.5px">Sin acciones todavía.</p>');
    g += card("Marcas y lo que más tocas", ((p.marcas || []).length ? bars(p.marcas, "acciones", function (m) { return m.nombre; }) : "") + lst((p.items_frecuentes || []).slice(0, 8), function (i) { return esc(i.item) + small(esc(i.modulo) + " · " + i.veces + "×"); }, "Sin ítems todavía."));
    g += card("Botones que más usas", lst((p.botones || []).slice(0, 10), function (b) { return esc(b.boton) + small(b.veces + "×"); }, "Sin clics registrados todavía."));
    g += card("Lo que haces con tu IA", (ia.agentes.length ? '<p style="font-size:12.5px;margin:0 0 6px">' + ia.agentes.map(function (a) { return "<b>" + esc(a.agente) + "</b> " + a.llamadas; }).join(" · ") + "</p>" : "")
      + lst(ia.herramientas.slice(0, 8), function (t) { return "<code>" + esc(t.herramienta) + "</code>" + small(t.llamadas + "×"); }, "Tu IA todavía no trabajó en este espacio. Conéctala en Configuración › Conecta tu IA.")
      + (ia.errores.length ? '<h4 style="margin:10px 0 2px;font-size:12.5px">Dónde falló</h4>' + lst(ia.errores, function (e) { return esc(e.error) + small(e.veces + "×"); }, "") : ""));
    g += card("Lo que corregiste después de tu IA", lst((p.correcciones_humanas || []).slice(0, 8), function (c) { return "<b>" + esc(c.item) + "</b> · " + esc(c.modulo) + '<br><small style="color:var(--muted)">' + esc(c.agente || "IA") + " usó " + esc(c.herramienta_ia) + "; " + c.minutos_despues + " min después hiciste «" + esc(c.accion_humana) + "»" + (c.campos && c.campos.length ? " en " + esc(c.campos.join(", ")) : "") + "</small>"; }, "Nada todavía: cuando edites algo que hizo tu IA, aparece aquí para que aprenda."));
    g += lessonsCard(p);
    g += card("Actividad reciente", lst((p.recientes || []).slice(0, 25), function (e) { return '<small style="color:var(--muted)">' + ago(e.cuando) + "</small> · " + (e.quien === "persona" ? "Tú" : esc(e.quien)) + " · " + esc(e.modulo) + " · " + esc(e.accion) + (e.item ? " <b>" + esc(e.item) + "</b>" : "") + (e.veces > 1 ? " ×" + e.veces : "") + (e.error ? ' <small style="color:#c33">' + esc(e.error) + "</small>" : ""); }, "Sin actividad."));
    return head + h + g + "</div>";
  }
  function lessonsCard(p) {
    var opts = [["preferencia", "Preferencia"], ["correccion", "Corrección"], ["proceso", "Proceso"], ["evitar", "Evitar"], ["contexto", "Contexto"]];
    return card("Aprendizajes para tus IAs", lst((p.aprendizajes || []).slice(-12).reverse(), function (a) { return esc(a); }, "Tus IAs guardan aquí lo que aprenden de ti. También puedes escribirles tú.")
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px"><select id="boK" class="fx-in" style="max-width:140px" aria-label="Tipo de aprendizaje">' + opts.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + "</option>"; }).join("") + '</select><input id="boL" class="fx-in" style="flex:1;min-width:180px" maxlength="600" aria-label="Aprendizaje" placeholder="Ej.: en Café Altura, titulares de máximo 6 palabras"><button class="btn btn-p" data-bol="1">Guardar</button></div>', "en la nota «Aprendizajes» del cerebro");
  }
  function saveLesson() {
    var inp = document.getElementById("boL"), k = document.getElementById("boK"), t = inp && inp.value.trim();
    if (!t) { if (inp) inp.focus(); return; }
    if (!RB().mcp) return uiToast("La IA de Musa todavía está cargando; intenta en un momento.");
    RB().mcp("brain_learn", { workspaceId: ws(), lesson: t, kind: k ? k.value : "preferencia" }).then(function () { uiToast("Aprendizaje guardado: tus IAs lo van a leer"); OP.data = null; OP.ws = null; V.ws = null; load().then(draw); }, function (e) { uiToast("No se pudo guardar: " + (e && e.message)); });
  }

  /* ───────── registro: pantallas, tiempo activo y botones (el servidor ya anota cada escritura) ───────── */
  var TK = { q: [], route: null, ws: null, ms: 0, lastInput: Date.now() };
  function curRoute() { return String(location.hash || "").replace(/^#/, "").slice(0, 200) || "inicio/resumen"; }
  function closeView() {
    if (TK.route && TK.ws) TK.q.push({ ws: TK.ws, t: "ver", route: TK.route, ms: TK.ms, at: Date.now() });
    TK.route = null; TK.ms = 0;
  }
  function openView() { if (!real()) return; closeView(); TK.route = curRoute(); TK.ws = ws(); }
  function flushTrack() {
    if (TK.route && TK.ms > 0) openView();
    if (!TK.q.length) return;
    var byWs = {};
    TK.q.splice(0).forEach(function (e) { (byWs[e.ws] = byWs[e.ws] || []).push(e); });
    Object.keys(byWs).forEach(function (w) {
      var evs = byWs[w].map(function (e) { var o = Object.assign({}, e); delete o.ws; return o; });
      api("/api/brain/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: w, tz: -new Date().getTimezoneOffset(), events: evs }) }).catch(function () {});
    });
  }
  ["pointerdown", "keydown", "wheel", "touchstart"].forEach(function (ev) { document.addEventListener(ev, function () { TK.lastInput = Date.now(); }, { passive: true, capture: true }); });
  document.addEventListener("click", function (e) {
    if (!real()) return;
    var el = e.target && e.target.closest && e.target.closest("button, a, [role=button], .btn, [data-a]");
    if (!el || el.closest("input, textarea, [contenteditable=true]")) return;
    var lab = (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").replace(/\s+/g, " ").trim();
    if (!lab || lab.length > 40 || /^[\d\s.,:%/$-]+$/.test(lab)) return;
    TK.q.push({ ws: ws(), t: "clic", route: curRoute(), label: lab, at: Date.now() });
  }, true);
  window.addEventListener("hashchange", function () { if (curRoute() !== TK.route) openView(); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flushTrack(); });
  window.addEventListener("pagehide", flushTrack);
  setInterval(function () {
    if (!real()) return;
    if (!TK.route || TK.ws !== ws()) openView();
    /* solo cuenta tiempo con la pestaña visible y alguien usándola (2 min sin tocar nada = pausa) */
    if (document.visibilityState === "visible" && Date.now() - TK.lastInput < 120000) TK.ms += 5000;
  }, 5000);
  setInterval(flushTrack, 30000);
  /* otros bridges pueden anotar acciones que no pasan por el servidor (exportar en el navegador, copiar…) */
  window.__musaTrack = function (module, action, info) { if (!real()) return; TK.q.push(Object.assign({ ws: ws(), t: "accion", route: curRoute(), module: module, action: action, at: Date.now() }, info || {})); };

  /* ───────── buscador global del encabezado («Buscar en Musa…») ─────────
   * Busca en lo mismo que el cerebro: marcas, ítems de todos los módulos (diseños, piezas, campañas, personas,
   * websites…), notas y las pantallas de Musa. Flechas para moverse, Enter abre, Escape cierra. */
  var GS = { el: null, inp: null, res: [], i: 0, t: null };
  function gsNorm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function gsResults(q) {
    var n = gsNorm(q).trim(); if (!n) return [];
    var out = [], hit = function (s) { return gsNorm(s).indexOf(n) >= 0; }, starts = function (s) { return gsNorm(s).indexOf(n) === 0 ? 0 : 1; };
    (typeof MODULES !== "undefined" ? MODULES : []).forEach(function (m) { (m.subs || []).forEach(function (sb) { if (hit(sb[1]) || hit(m.label + " " + sb[1])) out.push({ k: "Pantalla", n: m.label + " › " + sb[1], go: m.id + "/" + sb[0], r: starts(sb[1]) }); }); });
    V.brands.forEach(function (b) { if (hit(b.name)) out.push({ k: "Marca", n: b.name, go: "crear/marcas/" + encodeURIComponent(b.name), r: starts(b.name) }); });
    V.items.forEach(function (x) { if (hit(x.name)) { var b = brand(x.brand); out.push({ k: TN[x.type] || x.type, n: x.name, sub: [b && b.name, x.meta].filter(Boolean).join(" · "), go: x.href, r: starts(x.name) }); } });
    V.notes.forEach(function (nt) { if (hit(nt.title) || hit(nt.body_md)) out.push({ k: "Nota", n: nt.title, note: nt.id, r: hit(nt.title) ? starts(nt.title) : 2 }); });
    out.sort(function (a, b) { return a.r - b.r; });
    return out.slice(0, 14);
  }
  function gsPlace() {
    if (!GS.el || !GS.inp) return;
    var r = GS.inp.closest(".search").getBoundingClientRect(), w = Math.max(r.width, Math.min(440, window.innerWidth - 24));
    GS.el.style.top = (r.bottom + 6) + "px"; GS.el.style.left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12)) + "px"; GS.el.style.width = w + "px";
  }
  function gsClose() { if (GS.el) GS.el.hidden = true; }
  function gsDraw() {
    if (!GS.el) { GS.el = document.createElement("div"); GS.el.className = "gs-pop"; GS.el.setAttribute("role", "listbox"); document.body.appendChild(GS.el);
      GS.el.addEventListener("mousedown", function (e) { var it = e.target.closest("[data-gsi]"); if (!it) return; e.preventDefault(); gsOpen(+it.dataset.gsi); }); }
    var q = GS.inp.value.trim();
    if (!q) return gsClose();
    GS.el.hidden = false; gsPlace();
    if (V.ws !== ws() || V.loading) { GS.el.innerHTML = '<p class="gs-empty">Buscando en tu espacio…</p>'; return; }
    GS.res = gsResults(q); GS.i = Math.min(GS.i, Math.max(0, GS.res.length - 1));
    GS.el.innerHTML = GS.res.length ? GS.res.map(function (x, i) { return '<button type="button" role="option" data-gsi="' + i + '" class="' + (i === GS.i ? "on" : "") + '"><span>' + esc(x.k) + "</span><b>" + esc(x.n) + "</b>" + (x.sub ? "<small>" + esc(x.sub) + "</small>" : "") + "</button>"; }).join("")
      : '<p class="gs-empty">Nada con «' + esc(q) + '» en este espacio.</p>';
  }
  function gsOpen(i) {
    var x = GS.res[i]; if (!x) return;
    gsClose(); GS.inp.value = ""; GS.inp.blur();
    if (x.note) { V.sel = "note:" + x.note; V.view = "docs"; V.edit = false; if (location.hash === "#inicio/cerebro") return view(); location.hash = "inicio/cerebro"; return; }
    if (x.go) location.hash = x.go;
  }
  function gsBind() {
    var inp = document.querySelector(".search input");
    if (!inp || inp.dataset.gs) return;
    inp.dataset.gs = "1"; GS.inp = inp;
    inp.setAttribute("aria-label", "Buscar en Musa"); inp.setAttribute("autocomplete", "off");
    inp.addEventListener("input", function () {
      if (!real()) return;
      GS.i = 0; clearTimeout(GS.t);
      GS.t = setTimeout(function () { if (V.ws !== ws() && !V.loading) load().then(gsDraw, gsDraw); gsDraw(); }, 120);
    });
    inp.addEventListener("focus", function () { if (real() && V.ws !== ws() && !V.loading) load().then(function () { if (inp.value.trim()) gsDraw(); }); if (inp.value.trim()) gsDraw(); });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { gsClose(); inp.blur(); return; }
      if (!GS.el || GS.el.hidden) { if (e.key === "Enter") gsDraw(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); GS.i = (GS.i + (e.key === "ArrowDown" ? 1 : -1) + GS.res.length) % Math.max(1, GS.res.length); gsDraw(); }
      if (e.key === "Enter") { e.preventDefault(); gsOpen(GS.i); }
    });
    inp.addEventListener("blur", function () { setTimeout(gsClose, 150); });
    window.addEventListener("resize", gsPlace);
    var st = document.createElement("style");
    st.textContent = ".gs-pop{position:fixed;z-index:400;max-height:min(60vh,460px);overflow:auto;background:var(--panel,#fff);border:1.5px solid var(--border-2,#ddd);border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.18);padding:6px}"
      + ".gs-pop button{display:grid;grid-template-columns:auto 1fr;column-gap:10px;align-items:baseline;width:100%;text-align:left;background:none;border:0;border-radius:8px;padding:8px 10px;cursor:pointer;color:inherit;font:inherit}"
      + ".gs-pop button.on,.gs-pop button:hover{background:var(--accent-dim,#ffe9dc)}.gs-pop button span{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted,#888);grid-row:span 2}"
      + ".gs-pop button b{font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gs-pop button small{grid-column:2;font-size:11.5px;color:var(--muted,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gs-empty{margin:8px 10px;color:var(--muted,#888);font-size:12.5px}";
    document.head.appendChild(st);
  }
  gsBind(); setTimeout(gsBind, 1500);
  window.addEventListener("hashchange", gsClose);

  /* ───────── enganches ───────── */
  var _vb = typeof viewBrain === "function" ? viewBrain : null;
  var wrapped = function () { if (real()) return view(); return _vb && _vb.apply(this, arguments); };
  if (_vb) viewBrain = wrapped;
  if (typeof VIEWS2 !== "undefined") VIEWS2.brain = wrapped;
  /* la nota creada con el popup «+ Nueva nota» aparece de inmediato */
  window.__musaBrainReload = function () { V.ws = null; if (route.mod === "inicio" && route.sub === "cerebro") view(); };
  var _rl = RB() && RB().reload;
  if (_rl) RB().reload = function () { return _rl.apply(this, arguments).then(function (x) { V.ws = null; return x; }); };
  /* el botón «Sincronizar» y «Conectar vault» de la maqueta ya no aplican: importar vive en la cabecera y exportar quedó oculto */
})();
