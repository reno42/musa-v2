/* bridge-create.js — todo botón de «Nuevo / Agregar / +» abre un popup con lo necesario para crear
 * el ítem de verdad en su módulo (tabla real del workspace), guarda, recarga y lo deja a la vista.
 * Usa el mismo popup de la maqueta (mx) y sus mismas clases (fx-row, fx-lbl, fx-in, ag-ctl, ag-tag).
 */
(function () {
  function RR() { return window.__musaReal; }
  function host() { try { return window.parent !== window ? window.parent : null; } catch (e) { return null; } }
  function bridge() { var h = host(); try { return h && h.__musaBridge; } catch (e) { return null; } }
  function api(path, init) { var b = bridge(); if (!b) return Promise.reject(new Error("sin puente")); return b.api(path.charAt(0) === "/" ? path : "/rest/v1/" + path, init); }
  function jpost(path, body) { return api(path, { method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(body) }); }
  function ins(table, body) { return jpost("/rest/v1/" + table, body).then(function (r) { return Array.isArray(r) ? r[0] : r; }); }
  function get(path) { return api(path).catch(function () { return null; }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function hex(n) { var s = ""; while (s.length < n) s += Math.random().toString(16).slice(2); return s.slice(0, n); }
  function ws() { return RR().ws; }
  function uid() { var b = bridge(); return b && b.userId; }
  function day(off) { var d = new Date(); d.setDate(d.getDate() + (off || 0)); return d.toISOString().slice(0, 10); }
  function brands() { var m = RR().brandName || {}; return Object.keys(m).map(function (id) { return [id, m[id]]; }).sort(function (a, b) { return a[1].localeCompare(b[1]); }); }
  function brandOpts(none) { var o = brands(); return (none ? [["", none]] : []).concat(o); }
  function brandName(id) { return (id && (RR().brandName || {})[id]) || null; }
  function people() { var p = RR().people || {}; return Object.keys(p).map(function (k) { return [k, p[k]]; }); }
  function list(s) { return String(s || "").split(/[,\n]/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function q(t, sel, extra) { return t + "?workspace_id=eq." + encodeURIComponent(ws()) + "&select=" + sel + (extra || ""); }
  function fileData(f) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result)); }; r.onerror = rej; r.readAsDataURL(f); }); }
  function idOf(r) { return r && (r.templateId || r.flowId || r.id || (r.template && r.template.id) || (r.flow && r.flow.id) || (r.data && (r.data.id || (r.data.template && r.data.template.id)))); }
  function errMsg(e) {
    var m = String(e && (e.message || e.error) || e || "error");
    if (/brands_workspace|row-level security|permission denied/i.test(m)) return "No tienes permiso para crear aquí (necesitas rol Editor o más).";
    if (/key|BYOK|llave/i.test(m) && !/duplicate/i.test(m)) return m + " · configura tu llave en Configuración › Integraciones";
    return m;
  }

  var NETS = [["instagram", "Instagram"], ["facebook", "Facebook"], ["tiktok", "TikTok"], ["linkedin", "LinkedIn"], ["youtube", "YouTube"], ["x", "X"]];
  var FMT = [["post", "Post"], ["carrusel", "Carrusel"], ["story", "Story"], ["reel", "Reel"]];
  var SIZES = [["1080x1080", "Post · 1080×1080"], ["1080x1350", "Vertical · 1080×1350"], ["1080x1920", "Story / Reel · 1080×1920"], ["1920x1080", "Horizontal · 1920×1080"], ["1200x628", "Banner · 1200×628"], ["custom", "Otro tamaño…"]];
  var VFMTS = [["9:16", "9:16 · vertical"], ["16:9", "16:9 · horizontal"], ["1:1", "1:1 · cuadrado"], ["4:5", "4:5 · feed"]];

  /* ───────── popup genérico ───────── */
  function fieldHTML(f) {
    var id = "mbf_" + f.k, v = f.v == null ? "" : f.v, ph = f.ph ? ' placeholder="' + esc(f.ph) + '"' : "", lbl = '<label class="fx-lbl" for="' + id + '">' + esc(f.l) + (f.req ? " *" : "") + "</label>";
    var inner;
    if (f.t === "textarea") inner = '<textarea class="fx-in" id="' + id + '" rows="' + (f.rows || 3) + '"' + ph + ">" + esc(v) + "</textarea>";
    else if (f.t === "select") inner = '<select class="fx-in" id="' + id + '">' + (f.opts || []).map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(v) ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select>";
    else if (f.t === "checks") inner = '<div class="ag-tags" id="' + id + '">' + (f.opts || []).map(function (o) { return '<button type="button" class="ag-tag' + ((v || []).indexOf(o[0]) >= 0 ? " k" : "") + '" data-v="' + esc(o[0]) + '">' + esc(o[1]) + "</button>"; }).join("") + "</div>";
    else if (f.t === "file") inner = '<input class="fx-in" type="file" id="' + id + '"' + (f.accept ? ' accept="' + f.accept + '"' : "") + ">";
    else if (f.t === "info") return '<div class="mbc-f" data-k="' + f.k + '"' + (f.full ? ' style="grid-column:1/-1"' : "") + '><p class="mx-sub" style="margin:10px 0 0">' + f.html + "</p></div>";
    else inner = '<input class="fx-in" type="' + (f.t || "text") + '" id="' + id + '" value="' + esc(v) + '"' + ph + (f.t === "number" ? ' step="any"' : "") + ">";
    return '<div class="mbc-f" data-k="' + f.k + '"' + (f.when ? ' data-when="' + esc(JSON.stringify(f.when)) + '"' : "") + (f.full ? ' style="grid-column:1/-1"' : "") + ">" + lbl + inner + "</div>";
  }
  function formHTML(fields) {
    var out = "", row = [];
    var flush = function () { if (row.length) out += '<div class="fx-row">' + row.join("") + "</div>"; row = []; };
    fields.forEach(function (f) {
      if (f.full || f.t === "textarea" || f.t === "checks" || f.t === "info") { flush(); out += '<div class="fx-row" style="grid-template-columns:1fr">' + fieldHTML(Object.assign({}, f, { full: false })) + "</div>"; return; }
      row.push(fieldHTML(f)); if (row.length === 2) flush();
    });
    flush();
    return out;
  }
  function read(fields) {
    var v = {};
    fields.forEach(function (f) {
      var el = document.getElementById("mbf_" + f.k); if (!el) return;
      if (f.t === "checks") v[f.k] = [].map.call(el.querySelectorAll(".ag-tag.k"), function (b) { return b.dataset.v; });
      else if (f.t === "file") v[f.k] = el.files && el.files[0] || null;
      else if (f.t === "number") v[f.k] = el.value === "" ? null : Number(el.value);
      else v[f.k] = el.value.trim();
    });
    return v;
  }
  function visible(f, v) { return !f.when || [].concat(f.when.v).indexOf(v[f.when.k]) >= 0; }
  function syncWhen(fields) {
    var v = read(fields);
    fields.forEach(function (f) { if (!f.when) return; var box = mxEl.querySelector('.mbc-f[data-k="' + f.k + '"]'); if (box) box.parentElement.style.display = visible(f, v) ? "" : "none"; });
  }
  function open(spec, ctx) {
    var R = RR();
    if (!R || !R.on) return uiToast("Cargando tus datos…");
    ctx = ctx || {};
    if (spec.needBrand && !brands().length) {
      return mx(spec.title, "Primero necesitas una marca: todo en Musa cuelga de una marca.", '<div class="ag-ctl" style="margin-top:6px"><button class="pri" data-a="brand">Crear una marca</button></div>', function (e) { if (e.target.closest('[data-a="brand"]')) open(C.marca); });
    }
    mx(spec.title, spec.sub || "", '<p class="mx-sub">Cargando…</p>');
    Promise.resolve(spec.prep ? spec.prep(ctx) : null).then(function (pre) {
      var fields = typeof spec.fields === "function" ? spec.fields(ctx, pre) : spec.fields;
      var html = formHTML(fields) + '<p class="mbc-err" style="color:#d33;font-size:12px;font-weight:700;margin:10px 0 0;min-height:1em"></p><div class="ag-ctl" style="margin-top:8px"><button class="pri" data-mbc="save">' + esc(spec.cta || "Crear") + '</button><button data-mx="close">Cancelar</button></div>';
      mx(spec.title, spec.sub || "", html, function (e) {
        var tag = e.target.closest(".ag-tag"); if (tag && tag.closest(".mbc-f")) { tag.classList.toggle("k"); return; }
        if (!e.target.closest('[data-mbc="save"]')) return;
        var v = read(fields), err = mxEl.querySelector(".mbc-err"), btn = e.target.closest("button");
        var miss = fields.filter(function (f) { return f.req && visible(f, v) && (v[f.k] == null || v[f.k] === "" || (Array.isArray(v[f.k]) && !v[f.k].length)); })[0];
        if (miss) { err.textContent = "Falta: " + miss.l; var el = document.getElementById("mbf_" + miss.k); if (el && el.focus) el.focus(); return; }
        var bad = spec.check && spec.check(v, ctx, pre); if (bad) { err.textContent = bad; return; }
        btn.disabled = true; btn.textContent = "Guardando…"; err.textContent = "";
        Promise.resolve().then(function () { return spec.save(v, ctx, pre); }).then(function (res) {
          mxEl.hidden = true;
          uiToast(typeof spec.ok === "function" ? spec.ok(v, res) : (spec.ok || "Creado"));
          extraWs = null;
          return (spec.noReload ? Promise.resolve() : RR().reload()).then(function () { if (spec.after) spec.after(res, v, ctx); });
        }).catch(function (x) { btn.disabled = false; btn.textContent = spec.cta || "Crear"; err.textContent = "No se pudo crear: " + errMsg(x); });
      });
      mxClick.input = function () { syncWhen(fields); };
      mxEl.onchange = function () { syncWhen(fields); };
      syncWhen(fields);
      var first = mxEl.querySelector("input:not([type=file]),textarea"); if (first) first.focus();
    }, function (x) { mxBody('<p class="mx-sub">No se pudo preparar el formulario: ' + esc(errMsg(x)) + "</p>"); });
  }

  /* ───────── creadores ───────── */
  var C = {};

  C.pieza = {
    title: "Nueva pieza", sub: "Queda en el Calendario de la marca. Desde ahí la apruebas, le asignas diseño y la publicas.", needBrand: true,
    fields: function () {
      return [
        { k: "topic", l: "Tema", req: true, ph: "Ej.: 3 errores al cotizar una web" },
        { k: "brand", l: "Marca", t: "select", opts: brandOpts(), v: (brands()[0] || [])[0] },
        { k: "fmt", l: "Formato", t: "select", opts: FMT, v: "post" },
        { k: "status", l: "Estado", t: "select", opts: [["idea", "Idea"], ["borrador", "Borrador"], ["aprobado", "Aprobada"]], v: "idea" },
        { k: "date", l: "Fecha", t: "date", req: true, v: day(1) },
        { k: "time", l: "Hora", t: "time", v: "18:00" },
        { k: "ch", l: "Canales", t: "checks", req: true, opts: NETS, v: ["instagram"] },
        { k: "tpl", l: "Diseño (opcional)", t: "select", opts: [["", "— sin diseño todavía —"]].concat((RR().tpl || []).map(function (t) { return [t.id, t.name || "Sin nombre"]; })) },
        { k: "copy", l: "Copy", t: "textarea", ph: "Texto de la publicación" },
      ];
    },
    save: function (v) {
      return ins("content_calendar", { id: "cc_" + hex(16), workspace_id: ws(), scheduled_date: v.date, scheduled_time: v.time || null, topic: v.topic, copy: v.copy || null, kind: v.fmt === "reel" ? "video" : "organic", visual_type: v.fmt, channels: v.ch, status: v.status, brand_id: v.brand || null, template_id: v.tpl || null });
    },
    ok: "Pieza creada en el Calendario",
  };

  C.brief = {
    title: "Nuevo brief", sub: "El punto de partida del trabajo. Al aprobarlo se convierte en proyecto.", needBrand: true,
    fields: function () {
      return [
        { k: "brand", l: "Marca", t: "select", opts: brandOpts(), v: (brands()[0] || [])[0] },
        { k: "title", l: "Nombre", req: true, ph: "Ej.: Campaña de verano" },
        { k: "tpl", l: "Plantilla", t: "select", opts: [["Campaña", "Campaña"], ["Evento", "Evento"], ["Video", "Video"], ["Always-on", "Always-on"]] },
        { k: "tone", l: "Tono", ph: "Ej.: cercano, experto" },
        { k: "objective", l: "Objetivo", t: "textarea", req: true, rows: 2 },
        { k: "audience", l: "Público", t: "textarea", rows: 2 },
        { k: "message", l: "Mensaje clave", t: "textarea", rows: 2 },
        { k: "deliverables", l: "Entregables (separados por coma)", t: "textarea", rows: 2, ph: "12 posts, 4 reels, 1 landing" },
        { k: "channels", l: "Canales", ph: "Instagram, TikTok" },
        { k: "due", l: "Fecha de entrega", t: "date" },
        { k: "budget", l: "Presupuesto (S/)", t: "number" },
        { k: "approver", l: "Aprueba", ph: "Nombre de quien aprueba" },
      ];
    },
    save: function (v) {
      return ins("briefs", { workspace_id: ws(), brand_id: v.brand || null, brand_name: brandName(v.brand), title: v.title, status: "por_completar", objective: v.objective, audience: v.audience || null, tone: v.tone || null, deliverables: list(v.deliverables), due_date: v.due || null, budget: v.budget, created_by: uid(),
        content: { template: v.tpl, message: v.message || null, channels: v.channels || null, dates: v.due || null, budget: v.budget != null ? "S/ " + v.budget : null, approver: v.approver || null } });
    },
    ok: "Brief creado",
    after: function (r) { if (typeof CL !== "undefined" && r && r.id) CL.brief = "b_" + r.id; go(); },
  };

  C.nota = {
    title: "Nueva nota", sub: "Va a tu Segundo cerebro: la leen tú, tu equipo y tus agentes.",
    fields: [
      { k: "title", l: "Título", req: true },
      { k: "folder", l: "Carpeta", t: "select", opts: [["", "Notas"], ["idea", "Ideas"], ["brand", "Marcas"], ["campaign", "Campañas"], ["process", "Procesos"], ["decision", "Decisiones"]] },
      { k: "body", l: "Contenido (markdown)", t: "textarea", rows: 8 },
    ],
    save: function (v) {
      var slug = "nota-" + v.title.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) + "-" + hex(6);
      return ins("brain_notes", { workspace_id: ws(), slug: slug, title: v.title, body_md: v.body || "", entity_type: v.folder || null, source: "human" });
    },
    ok: "Nota guardada",
    after: function (r) { if (typeof BR !== "undefined" && r && r.id) { BR.sel = "bn_" + r.id; go(); } },
  };

  C.playbook = {
    title: "Nuevo playbook", sub: "Una receta de pasos con fechas relativas al día D. Escribe un paso por línea: día | paso | módulo | responsable.",
    fields: [
      { k: "name", l: "Nombre", req: true, ph: "Ej.: Lanzamiento de producto" },
      { k: "cat", l: "Categoría", t: "select", opts: [["Lanzamiento", "Lanzamiento"], ["Evento", "Evento"], ["Ventas", "Ventas"], ["Contenido recurrente", "Contenido recurrente"], ["General", "General"]] },
      { k: "d", l: "Descripción", ph: "Para qué sirve" },
      { k: "steps", l: "Pasos", t: "textarea", rows: 6, req: true, v: "-14 | Brief y objetivo | planear/briefs | Ejecutivo de cuentas\n-7 | Piezas en todos los formatos | crear/disenos | Diseño\n0 | Día D: publicar | planear/calendario | Community manager" },
    ],
    check: function (v) { return parseSteps(v.steps).length ? null : "Escribe al menos un paso con el formato día | paso"; },
    save: function (v) { return ins("workspace_playbooks", { workspace_id: ws(), name: v.name, category: v.cat, description: v.d || null, steps: parseSteps(v.steps), created_by: uid() }); },
    ok: "Playbook creado",
    after: function (r) { if (typeof PBS !== "undefined" && r && r.id) { PBS.sel = "pb_" + r.id; go(); } },
  };
  function parseSteps(s) {
    return String(s || "").split(/\n/).map(function (l) { var p = l.split("|").map(function (x) { return x.trim(); }); return p.length >= 2 && !isNaN(+p[0]) ? { d: +p[0], t: p[1], link: p[2] || "planear/calendario", who: p[3] || "" } : null; }).filter(Boolean);
  }

  C.fuente = {
    title: "Nueva fuente de investigación", sub: "Musa lee la fuente cuando le das «Actualizar» y la IA arma los temas con lo que encuentra.",
    fields: function () {
      return [
        { k: "name", l: "Nombre", req: true, ph: "Ej.: Blog de Meta for Business" },
        { k: "type", l: "Tipo", t: "select", opts: [["rss", "RSS / blog"], ["nitter", "Cuenta de X (Nitter)"]] },
        { k: "url", l: "URL", req: true, ph: "https://…", full: true },
        { k: "brand", l: "Marca", t: "select", opts: brandOpts("Todas mis marcas") },
        { k: "refresh", l: "Cada cuánto", t: "select", opts: [["60", "Cada hora"], ["180", "Cada 3 horas"], ["720", "Cada 12 horas"], ["1440", "Una vez al día"]], v: "720" },
        { k: "inc", l: "Solo si menciona (coma)", ph: "IA, marketing" },
        { k: "exc", l: "Ignorar si menciona (coma)", ph: "crypto" },
      ];
    },
    check: function (v) { return /^https:\/\//.test(v.url) ? null : "La URL debe empezar con https://"; },
    save: function (v) { return ins("research_sources", { workspace_id: ws(), name: v.name, url: v.url, type: v.type, include_keywords: list(v.inc), exclude_keywords: list(v.exc), brand_id: v.brand || null, refresh_minutes: +v.refresh || 720 }); },
    ok: "Fuente agregada a Investigación", noReload: true,
  };

  C.marca = {
    title: "Nueva marca", sub: "Aparece en Vender › Empresas y en Crear › Marcas. Sus colores y tipografía se usan en diseños y videos.",
    fields: [
      { k: "name", l: "Nombre", req: true, ph: "Ej.: Ruta Sur" },
      { k: "rel", l: "Relación", t: "select", opts: [["client", "Cliente"], ["lead", "Prospecto"]], v: "lead" },
      { k: "prio", l: "Prioridad", t: "select", opts: [["low", "Baja"], ["medium", "Media"], ["high", "Alta"], ["urgent", "Urgente"]], v: "medium" },
      { k: "follow", l: "Próximo seguimiento", t: "date" },
      { k: "c1", l: "Color principal", t: "color", v: "#ff5e00" },
      { k: "c2", l: "Color secundario", t: "color", v: "#111111" },
      { k: "font", l: "Tipografía", ph: "Ej.: Inter" },
      { k: "notes", l: "Notas (industria, contexto)", t: "textarea", rows: 2 },
    ],
    save: function (v) {
      return ins("brands", { id: "brand_" + hex(20), workspace_id: ws(), name: v.name, relationship_status: v.rel, crm_priority: v.prio, next_follow_up_at: v.follow ? v.follow + "T09:00:00" : null, crm_notes: v.notes || null,
        colors: [{ hex: v.c1, name: "Principal" }, { hex: v.c2, name: "Secundario" }], fonts: v.font ? [{ family: v.font }] : [] });
    },
    ok: function (v) { return "Marca «" + v.name + "» creada"; },
  };

  C.diseno = {
    title: "Nuevo diseño", sub: "Se abre en el editor apenas lo creas.",
    fields: function () {
      return [
        { k: "name", l: "Nombre", req: true, ph: "Ej.: Post lanzamiento" },
        { k: "brand", l: "Marca", t: "select", opts: brandOpts("Sin marca") },
        { k: "size", l: "Formato", t: "select", opts: SIZES, v: "1080x1080" },
        { k: "bg", l: "Fondo", t: "color", v: "#ffffff" },
        { k: "w", l: "Ancho (px)", t: "number", v: 1080, when: { k: "size", v: "custom" } },
        { k: "h", l: "Alto (px)", t: "number", v: 1080, when: { k: "size", v: "custom" } },
      ];
    },
    check: function (v) { if (v.size !== "custom") return null; return v.w >= 50 && v.h >= 50 && v.w <= 8000 && v.h <= 8000 ? null : "El tamaño va de 50 a 8000 px"; },
    save: function (v) {
      var wh = v.size === "custom" ? [v.w, v.h] : v.size.split("x").map(Number), html = '<div data-layer-id="fondo" style="position:absolute;inset:0;background:' + v.bg + '"></div>';
      return api("/api/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: v.name, width: wh[0], height: wh[1], workspaceId: ws(), engine: "html", html: html, css: "" }) }).then(function (x) {
        var id = idOf(x); if (!id) throw new Error("el servidor no devolvió el diseño");
        var body = { name: v.name, frames: [{ id: "frame_" + Date.now().toString(36), name: "Frame 1", x: 0, y: 0, width: wh[0], height: wh[1], background: v.bg, html: html, css: "" }] };
        if (v.brand) body.brandId = v.brand;
        return api("/api/templates/" + encodeURIComponent(id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(function () { return id; });
      });
    },
    ok: "Diseño creado",
    after: function (id) { if (RR().openDesign) RR().openDesign(id); },
  };

  C.deck = {
    title: "Nueva presentación", sub: "Musa arma el deck 16:9 con tu marca: portada + una lámina por título. Después lo editas como cualquier diseño.",
    fields: function () {
      return [
        { k: "name", l: "Tema", req: true, ph: "Ej.: Resultados de octubre" },
        { k: "brand", l: "Marca", t: "select", opts: brandOpts("Sin marca") },
        { k: "color", l: "Color de la marca", t: "color", v: "#ff5e00" },
        { k: "slides", l: "Títulos de las láminas (uno por línea)", t: "textarea", rows: 5, req: true, v: "Agenda\nLo que hicimos\nResultados\nPróximos pasos" },
      ];
    },
    save: function (v) {
      var slides = list(v.slides.replace(/,/g, "‚")).map(function (t) { return { title: t.replace(/‚/g, ","), html: '<div class="b"><p>Escribe aquí el contenido de esta lámina.</p></div>', css: ".b{font:400 36px/1.4 Inter,sans-serif;color:#333}" }; });
      var a = { workspaceId: ws(), name: v.name, brand: { name: brandName(v.brand) || v.name, color: v.color }, slides: slides };
      if (v.brand) a.brandId = v.brand;
      return RR().mcp("create_deck", a).then(function (r) { var id = idOf(r); if (!id) throw new Error("no se recibió la presentación"); return id; });
    },
    ok: "Presentación creada",
    after: function (id) { if (RR().openDesign) RR().openDesign(id); },
  };

  C.video = {
    title: "Nuevo video", sub: "Se abre en el editor de video: agrega tomas, diseños, textos y música.",
    fields: [
      { k: "name", l: "Nombre", req: true, ph: "Ej.: Reel lanzamiento" },
      { k: "fmt", l: "Formato", t: "select", opts: VFMTS, v: "9:16" },
    ],
    save: function (v) {
      var D = { "9:16": [1080, 1920], "16:9": [1920, 1080], "1:1": [1080, 1080], "4:5": [1080, 1350] }[v.fmt];
      return api("/api/video-projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: ws(), name: v.name, ratio: v.fmt, canvasW: D[0], canvasH: D[1], fps: 30 }) })
        .then(function (x) { var id = x && x.data && x.data.project && x.data.project.id; if (!id) throw new Error("no se recibió el video"); return id; });
    },
    ok: "Video creado",
    after: function (id) { var R = RR(), i = (R.vids || []).findIndex(function (x) { return x.id === id; }); if (R.openVideo) R.openVideo(id, i < 0 ? 0 : i); },
  };

  C.clon = {
    title: "Nuevo clon", sub: "Clon de voz con ElevenLabs o clon con avatar con HeyGen, con tus propias llaves (Integraciones). La persona debe haber dado su consentimiento.",
    prep: function () { return get("/api/video-takes?workspace_id=" + encodeURIComponent(ws())).then(function (x) { return (x && x.takes) || []; }); },
    fields: function (ctx, takes) {
      return [
        { k: "kind", l: "Tipo de clon", t: "select", opts: [["voz", "Clonar voz (ElevenLabs)"], ["avatar", "Clon con avatar (HeyGen)"]], v: ctx.kind || "voz" },
        { k: "name", l: "Nombre", req: true, ph: "Ej.: Renzo · voz" },
        { k: "audio", l: "Muestra de audio (1 a 3 min, WAV o MP3)", t: "file", accept: "audio/*", req: true, when: { k: "kind", v: "voz" }, full: true },
        { k: "desc", l: "Descripción de la voz", ph: "Ej.: cálida, ritmo pausado", when: { k: "kind", v: "voz" } },
        { k: "take", l: "Toma grabada (últimas 24 h)", t: "select", req: true, when: { k: "kind", v: "avatar" }, opts: takes.length ? takes.map(function (t, i) { return [t.id, "Toma " + (i + 1) + " · " + new Date(t.created_at || t.createdAt || Date.now()).toLocaleString("es-PE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })]; }) : [["", "No hay tomas: graba 2 minutos en Crear › Tomas"]] },
        { k: "ok", l: "Consentimiento", t: "select", req: true, opts: [["", "— confirma —"], ["si", "La persona autorizó el uso de su voz/imagen"]] },
      ];
    },
    save: function (v) {
      if (v.kind === "voz") {
        if (v.audio.size > 9.5 * 1024 * 1024) throw new Error("la muestra pesa más de 9,5 MB: recórtala");
        return fileData(v.audio).then(function (d) {
          var m = d.match(/^data:([^;]+);base64,(.*)$/);
          return api("/api/elevenlabs/clone", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: v.name, description: v.desc || "", audioBase64: m[2], mimeType: m[1] }) });
        }).then(function (x) { return registerClone({ kind: "voz", provider: "elevenlabs", name: v.name, external_id: x && x.voiceId, status: "listo" }); });
      }
      return api("/api/heygen/avatars/digital-twin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ take_id: v.take, name: v.name }) })
        .then(function (x) { var d = (x && (x.data || x)) || {}; return registerClone({ kind: "avatar", provider: "heygen", name: v.name, external_id: d.avatar_id || d.avatarId || d.id || null, status: "entrenando" }); });
    },
    ok: function (v) { return v.kind === "voz" ? "Voz clonada: ya la puedes usar en voz en off" : "Entrenamiento enviado a HeyGen: tarda unos minutos"; },
    noReload: true, after: function () { go(); },
  };

  C.evento = {
    title: "Nuevo evento", sub: "Trae su página pública, inscritos y mails automáticos (confirmación y recordatorios).",
    fields: function () {
      return [
        { k: "name", l: "Nombre", req: true, ph: "Ej.: Webinar · IA para tu marca" },
        { k: "brand", l: "Marca", t: "select", opts: brandOpts("Sin marca") },
        { k: "date", l: "Fecha", t: "date", req: true, v: (typeof EVN !== "undefined" && EVN.day) ? new Date(EVN.day).toISOString().slice(0, 10) : day(14) },
        { k: "time", l: "Hora", t: "time", req: true, v: "19:00" },
        { k: "dur", l: "Duración (min)", t: "number", v: 60 },
        { k: "cap", l: "Cupos", t: "number", v: 100 },
        { k: "plat", l: "Plataforma", t: "select", opts: [["meet", "Google Meet"], ["zoom", "Zoom"]] },
        { k: "link", l: "Enlace de la sala", ph: "https://meet.google.com/…" },
        { k: "pub", l: "Página pública", t: "select", opts: [["1", "Publicar ya: abre inscripciones con su enlace"], ["0", "Guardar sin publicar"]], full: true },
        { k: "desc", l: "Descripción", t: "textarea", rows: 3 },
      ];
    },
    save: function (v) {
      if (typeof EVN !== "undefined") EVN.day = null;
      var slug = v.pub === "1" ? v.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) + "-" + Math.random().toString(36).slice(2, 6) : null;
      var at = new Date(v.date + "T" + (v.time || "19:00") + ":00");
      return ins("workspace_events", { workspace_id: ws(), name: v.name, date: v.date, starts_at: at.toISOString(), duration_min: v.dur || 60, capacity: v.cap || 100, platform: v.plat, link: v.link || null, brand_id: v.brand || null, description: v.desc || null, location: v.plat === "zoom" ? "Zoom" : "Google Meet", created_by: uid(), published: !!slug, slug: slug, published_at: slug ? new Date().toISOString() : null });
    },
    ok: "Evento creado",
    after: function (r) { if (r && r.id) setTimeout(function () { location.hash = "crear/eventos/e_" + r.id + (r.published ? "/pagina" : ""); }, 600); },
  };

  var MTPL = [["news", "Newsletter"], ["promo", "Promoción"], ["welcome", "Bienvenida"], ["reactiv", "Reactivación"], ["invite", "Invitación"]];
  C.mailing = {
    title: "Nueva campaña de mailing", sub: "Queda en borrador: la revisas, la pruebas y la envías tú.",
    fields: function () {
      return [
        { k: "name", l: "Nombre interno", req: true, ph: "Ej.: Newsletter noviembre" },
        { k: "subject", l: "Asunto", req: true, ph: "Lo que verá en su bandeja" },
        { k: "brand", l: "Marca", t: "select", opts: brandOpts("Sin marca") },
        { k: "tpl", l: "Plantilla", t: "select", opts: MTPL },
        { k: "seg", l: "Audiencia", v: "Todos los contactos", ph: "Ej.: Clientes · Ruta Sur" },
        { k: "when", l: "Fecha de envío prevista", t: "date" },
      ];
    },
    save: function (v) { return ins("workspace_mailings", { workspace_id: ws(), subject: v.subject, status: "borrador", send_at: v.when ? v.when + "T09:00:00" : null, kind: "campana", content: { name: v.name, brand_id: v.brand || null, seg: v.seg || "Todos", tpl: v.tpl }, created_by: uid() }); },
    ok: "Campaña de mailing creada", after: function () { if (typeof ML !== "undefined") { ML.tab = "campanas"; go(); } },
  };
  C.secuencia = {
    title: "Nueva secuencia", sub: "Correos que salen solos según el día desde que la persona entra. Un correo por línea: día | asunto.",
    fields: function () {
      return [
        { k: "name", l: "Nombre", req: true, ph: "Ej.: Bienvenida a leads" },
        { k: "brand", l: "Marca", t: "select", opts: brandOpts("Sin marca") },
        { k: "seg", l: "Entran a la secuencia", v: "Leads nuevos", full: true },
        { k: "steps", l: "Correos", t: "textarea", rows: 4, req: true, v: "0 | Bienvenida\n3 | Te cuento cómo trabajamos\n7 | Una propuesta para ti" },
      ];
    },
    check: function (v) { return seqSteps(v.steps).length ? null : "Escribe al menos un correo: día | asunto"; },
    save: function (v) { var st = seqSteps(v.steps); return ins("workspace_mailings", { workspace_id: ws(), subject: v.name, status: "borrador", kind: "secuencia", content: { name: v.name, brand_id: v.brand || null, groups: [v.seg || "Todos"], steps: st }, created_by: uid() }); },
    ok: "Secuencia creada", after: function () { if (typeof ML !== "undefined") { ML.tab = "secuencias"; go(); } },
  };
  function seqSteps(s) { return String(s || "").split(/\n/).map(function (l) { var p = l.split("|").map(function (x) { return x.trim(); }); return p.length >= 2 && !isNaN(+p[0]) && p[1] ? { d: +p[0], subject: p[1], tpl: "news" } : null; }).filter(Boolean); }

  C.form = {
    title: "Nuevo formulario", sub: "Lo que llega entra al CRM de la marca. Después agregas o cambias campos.",
    fields: function () {
      return [
        { k: "name", l: "Nombre", req: true, ph: "Ej.: Contacto web" },
        { k: "brand", l: "Marca", t: "select", opts: brandOpts("Sin marca") },
        { k: "type", l: "Tipo", t: "select", opts: [["Contacto", "Contacto"], ["Inscripción", "Inscripción"], ["Cotización", "Pedido de cotización"], ["Encuesta", "Encuesta"]] },
        { k: "pub", l: "Estado", t: "select", opts: [["0", "Pausado (borrador)"], ["1", "Activo"]] },
        { k: "fields", l: "Campos", t: "checks", req: true, opts: [["nombre", "Nombre"], ["email", "Email"], ["telefono", "Teléfono"], ["empresa", "Empresa"], ["mensaje", "Mensaje"]], v: ["nombre", "email"] },
      ];
    },
    save: function (v) {
      var L = { nombre: ["Nombre", "Texto"], email: ["Email", "Email"], telefono: ["Teléfono", "Teléfono"], empresa: ["Empresa", "Texto"], mensaje: ["Mensaje", "Párrafo"] };
      return ins("workspace_forms", { workspace_id: ws(), name: v.name, published: v.pub === "1", schema: { brand_id: v.brand || null, type: v.type, fields: v.fields.map(function (k) { return { name: k, label: L[k][0], type: L[k][1], required: k === "email" || k === "nombre" }; }) }, created_by: uid() });
    },
    ok: "Formulario creado",
  };

  C.flow = {
    title: "Nueva automatización", sub: "Se crea en borrador con disparo manual y se abre en el editor para armar los pasos.",
    fields: [
      { k: "name", l: "Nombre", req: true, ph: "Ej.: Ideas de la semana con IA" },
      { k: "desc", l: "Qué hace (opcional)", t: "textarea", rows: 2 },
    ],
    check: function (v) { return v.name.length > 80 ? "Máximo 80 caracteres" : null; },
    save: function (v) {
      return RR().mcp("flow_save", { workspaceId: ws(), name: v.name, enabled: false, trigger: { type: "manual" }, nodes: v.desc ? [{ id: "nota", type: "note", text: v.desc, x: 80, y: 260 }] : [], edges: [] })
        .then(function (r) { var id = idOf(r); if (!id) throw new Error("no se recibió el flow"); return id; });
    },
    ok: "Automatización creada",
    after: function (id) { location.hash = "crear/automatizaciones/" + id; },
  };

  C.mensaje = {
    title: "Nuevo mensaje", sub: "Escríbele a alguien que ya te habló en tus redes conectadas. Se envía desde la cuenta de la marca.",
    prep: function () { return get(q("social_inbox", "id,author_name,author_handle,platform,kind,content", "&order=occurred_at.desc&limit=100")).then(function (r) { return r || []; }); },
    fields: function (ctx, rows) {
      if (!rows.length) return [{ k: "info", t: "info", html: "Todavía no hay conversaciones: conecta Instagram, Facebook, TikTok o WhatsApp en <a href='#configuracion/integraciones' style='color:var(--accent);font-weight:700'>Configuración › Integraciones</a> y los mensajes llegarán a Bandeja." }];
      return [
        { k: "item", l: "Para", t: "select", req: true, full: true, opts: rows.map(function (m) { return [m.id, (m.author_name || m.author_handle || "—") + " · " + (m.platform || "") + " · " + String(m.content || "").slice(0, 40)]; }) },
        { k: "text", l: "Mensaje", t: "textarea", req: true, rows: 4 },
      ];
    },
    check: function (v, c, rows) { return rows.length ? null : "Primero conecta una red"; },
    save: function (v) {
      return RR().mcp("reply_social", { workspaceId: ws(), itemId: v.item, content: v.text })
        .then(function () { return api("/rest/v1/social_inbox?id=eq." + encodeURIComponent(v.item), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "replied", reply_text: v.text, replied_at: new Date().toISOString() }) }); });
    },
    ok: "Mensaje enviado",
  };

  var CTYPE = [["general", "General"], ["launch", "Lanzamiento"], ["relaunch", "Relanzamiento"], ["seasonal", "Temporada"], ["cobranding", "Co-branding"], ["nurturing", "Nutrición de leads"], ["event", "Evento"], ["retention", "Retención"]];
  C.ads = {
    title: "Nueva campaña de ads", sub: "La planificas aquí con su presupuesto; la pauta se activa en la red cuando conectes tu cuenta de ads.", needBrand: true,
    fields: function () {
      var nets = typeof AD_NETS !== "undefined" ? Object.keys(AD_NETS).map(function (k) { return [k, AD_NETS[k][0]]; }) : [["meta", "Meta Ads"]];
      return [
        { k: "name", l: "Nombre", req: true, ph: "Ej.: Black Friday · conversiones" },
        { k: "brand", l: "Marca", t: "select", req: true, opts: brandOpts(), v: (brands()[0] || [])[0] },
        { k: "net", l: "Red", t: "select", opts: nets },
        { k: "obj", l: "Objetivo", t: "select", opts: [["Ventas", "Ventas"], ["Leads", "Leads"], ["Tráfico", "Tráfico"], ["Reconocimiento", "Reconocimiento"]] },
        { k: "type", l: "Tipo de campaña", t: "select", opts: CTYPE },
        { k: "budget", l: "Presupuesto (US$)", t: "number", req: true, v: 100 },
        { k: "notes", l: "Notas para la pauta", t: "textarea", rows: 2 },
      ];
    },
    check: function (v) { return v.budget > 0 ? null : "El presupuesto debe ser mayor a 0"; },
    save: function (v) { return ins("campaigns", { id: "campaign_" + hex(16), workspace_id: ws(), brand_id: v.brand, name: v.name, status: "active", campaign_type: v.type, brief: JSON.stringify({ net: v.net, obj: v.obj, notes: v.notes || "" }), budget_plan_usd: v.budget }); },
    ok: "Campaña de ads creada",
    after: function () { if (typeof AD !== "undefined") { AD.nu = false; go(); } },
  };

  function contacts() { return get(q("crm_contacts", "id,first_name,last_name,email", "&order=updated_at.desc&limit=300")).then(function (r) { return r || []; }); }
  var STAGE_OF = { "Prospecto": "discovery", "Propuesta": "proposal", "Negociación": "negotiation", "Ganado": "approved" };
  C.oportunidad = {
    title: "Nueva oportunidad", sub: "Entra al embudo de Vender. Si la mueves a Propuesta puedes crearle una cotización.", needBrand: true,
    prep: contacts,
    fields: function (ctx, cs) {
      return [
        { k: "title", l: "Título", req: true, ph: "Ej.: Landing + chatbot" },
        { k: "brand", l: "Marca (cliente)", t: "select", req: true, opts: brandOpts(), v: (brands()[0] || [])[0] },
        { k: "contact", l: "Contacto", t: "select", opts: [["", "— sin contacto —"]].concat(cs.map(function (c) { return [c.id, ((c.first_name || "") + " " + (c.last_name || "")).trim() + (c.email ? " · " + c.email : "")]; })) },
        { k: "stage", l: "Etapa", t: "select", opts: [["discovery", "Prospecto"], ["proposal", "Propuesta"], ["negotiation", "Negociación"], ["approved", "Ganado"]], v: STAGE_OF[ctx.col] || "discovery" },
        { k: "value", l: "Valor", t: "number" },
        { k: "cur", l: "Moneda", t: "select", opts: [["PEN", "Soles (S/)"], ["USD", "Dólares (US$)"]] },
        { k: "prob", l: "Probabilidad (%)", t: "number", v: 20 },
        { k: "close", l: "Cierre esperado", t: "date" },
        { k: "next", l: "Próximo paso", ph: "Ej.: Enviar propuesta el lunes", full: true },
      ];
    },
    check: function (v) { return v.prob == null || (v.prob >= 0 && v.prob <= 100) ? null : "La probabilidad va de 0 a 100"; },
    save: function (v) { return ins("crm_deals", { workspace_id: ws(), brand_id: v.brand, title: v.title, primary_contact_id: v.contact || null, stage: v.stage, value: v.value, currency: v.cur, probability: v.prob == null ? 10 : Math.round(v.prob), expected_close_date: v.close || null, next_step_note: v.next || null, created_by: uid() }); },
    ok: "Oportunidad creada",
  };

  C.persona = {
    title: "Nueva persona", sub: "Un contacto del CRM. Puedes asociarlo luego a oportunidades.",
    fields: function () {
      return [
        { k: "fn", l: "Nombre", req: true }, { k: "ln", l: "Apellido" },
        { k: "email", l: "Email", t: "email" }, { k: "phone", l: "Teléfono", t: "tel" },
        { k: "job", l: "Cargo" }, { k: "company", l: "Empresa" },
        { k: "brand", l: "Marca", t: "select", opts: brandOpts("Sin marca") },
        { k: "status", l: "Estado", t: "select", opts: [["lead", "Lead"], ["active", "Activo"], ["inactive", "Inactivo"]] },
        { k: "tags", l: "Etiquetas (coma)", full: true },
        { k: "notes", l: "Notas", t: "textarea", rows: 2 },
      ];
    },
    check: function (v) { return !v.email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email) ? null : "El email no es válido"; },
    save: function (v) { return ins("crm_contacts", { workspace_id: ws(), first_name: v.fn, last_name: v.ln || null, email: v.email || null, phone: v.phone || null, job_title: v.job || null, company: v.company || null, brand_id: v.brand || null, brand_name: brandName(v.brand), status: v.status, tags: list(v.tags), notes: v.notes || null, created_by: uid(), origin_source: "manual" }); },
    ok: "Persona agregada al CRM",
  };

  C.cotizacion = {
    title: "Nueva cotización", sub: "Con tu tarifario. Pon la cantidad de cada servicio; el total se calcula solo.",
    prep: function () {
      return Promise.all([get(q("crm_deals", "id,title,brand_id", "&order=updated_at.desc&limit=200")), get(q("crm_quotes", "id", "&limit=1000")), get(q("workspace_rates", "label,price,unit,sort", "&order=sort.asc"))])
        .then(function (r) { return { deals: r[0] || [], n: (r[1] || []).length, rates: (r[2] && r[2].length ? r[2] : (typeof RATES !== "undefined" ? RATES.map(function (x) { return { label: x[0], price: x[1], unit: x[2] }; }) : [])) }; });
    },
    fields: function (ctx, p) {
      var deal = ctx.deal ? p.deals.find(function (d) { return d.title === ctx.deal || d.id === ctx.deal; }) : null;
      return [
        { k: "title", l: "Título", req: true, v: ctx.title || (deal ? deal.title : ""), ph: "Ej.: Campaña de verano" },
        { k: "brand", l: "Marca", t: "select", opts: brandOpts("Sin marca"), v: (deal && deal.brand_id) || ctx.brand || "" },
        { k: "deal", l: "Oportunidad", t: "select", opts: [["", "— sin oportunidad —"]].concat(p.deals.map(function (d) { return [d.id, d.title]; })), v: deal ? deal.id : "" },
        { k: "cur", l: "Moneda", t: "select", opts: [["PEN", "Soles (S/)"], ["USD", "Dólares (US$)"]] },
      ].concat(p.rates.map(function (r, i) { return { k: "r" + i, l: r.label + " · " + r.price + " / " + (r.unit || "pieza"), t: "number", v: 0 }; }));
    },
    check: function (v, c, p) { return p.rates.some(function (r, i) { return v["r" + i] > 0; }) ? null : "Pon cantidad en al menos un servicio"; },
    save: function (v, c, p) {
      var items = p.rates.map(function (r, i) { return { label: r.label, price: Number(r.price), unit: r.unit || "pieza", qty: v["r" + i] || 0 }; }).filter(function (x) { return x.qty > 0; });
      var total = items.reduce(function (s, x) { return s + x.price * x.qty; }, 0);
      return ins("crm_quotes", { workspace_id: ws(), number: "COT-" + new Date().getFullYear() + "-" + String(p.n + 1).padStart(3, "0"), brand_id: v.brand || null, brand_name: brandName(v.brand), deal_id: v.deal || null, title: v.title, status: "Borrador", items: items, currency: v.cur, total: total, created_by: uid() });
    },
    ok: "Cotización creada en borrador",
    after: function (r) { if (typeof CL !== "undefined" && r && r.id) CL.quote = "q_" + r.id; var h = /^#?clientes/.test(location.hash) ? "clientes/cotizaciones" : "vender/cotizaciones"; if (location.hash.replace("#", "") !== h) location.hash = h; else go(); },
  };

  C.fee = {
    title: "Nuevo fee mensual", sub: "Lo que la marca paga al mes y lo que incluye. Las horas y piezas se descuentan solas.", needBrand: true,
    fields: function () {
      return [
        { k: "brand", l: "Marca", t: "select", req: true, opts: brandOpts(), v: (brands()[0] || [])[0] },
        { k: "fee", l: "Fee mensual", t: "number", req: true },
        { k: "cur", l: "Moneda", t: "select", opts: [["PEN", "Soles (S/)"], ["USD", "Dólares (US$)"]] },
        { k: "hours", l: "Horas incluidas", t: "number", v: 20 },
        { k: "pieces", l: "Piezas incluidas", t: "number", v: 12 },
      ];
    },
    save: function (v) { return ins("workspace_fees", { workspace_id: ws(), brand_id: v.brand, brand_name: brandName(v.brand), monthly_fee: v.fee, currency: v.cur, hours_included: v.hours || 0, pieces_included: Math.round(v.pieces || 0) }); },
    ok: "Fee creado",
  };

  C.proyecto = {
    title: "Nuevo proyecto", sub: "Agrupa tareas, piezas, horas y presupuesto de un trabajo para una marca.",
    prep: function () { return get(q("briefs", "id,title", "&order=updated_at.desc&limit=100")).then(function (r) { return r || []; }); },
    fields: function (ctx, bs) {
      return [
        { k: "name", l: "Nombre", req: true },
        { k: "brand", l: "Marca", t: "select", opts: brandOpts("Sin marca") },
        { k: "brief", l: "Brief de origen", t: "select", opts: [["", "— sin brief —"]].concat(bs.map(function (b) { return [b.id, b.title]; })) },
        { k: "budget", l: "Presupuesto", t: "number" },
        { k: "start", l: "Inicio", t: "date", v: day(0) }, { k: "end", l: "Entrega", t: "date" },
        { k: "hours", l: "Horas planificadas", t: "number" },
      ];
    },
    check: function (v) { return v.end && v.start && v.end < v.start ? "La entrega no puede ser antes del inicio" : null; },
    save: function (v) { return ins("workspace_projects", { workspace_id: ws(), name: v.name, brand_id: v.brand || null, brand_name: brandName(v.brand), brief_id: v.brief || null, budget: v.budget || 0, starts_on: v.start || null, ends_on: v.end || null, hours_planned: v.hours || 0, status: "Planificando", created_by: uid() }); },
    ok: "Proyecto creado",
  };

  var COL_ST = { "Por hacer": "backlog", "En curso": "design", "En revisión": "review", "Hecho": "done" };
  C.tarea = {
    title: "Nueva tarea", sub: "Aparece en Mi trabajo de quien la tenga asignada.",
    fields: function (ctx) {
      return [
        { k: "title", l: "Título", req: true, full: true },
        { k: "brand", l: "Marca", t: "select", opts: brandOpts("Sin marca") },
        { k: "type", l: "Tipo", t: "select", opts: [["post", "Post"], ["banner", "Banner"], ["deck", "Presentación"], ["landing", "Landing"], ["template", "Plantilla"], ["cotizacion", "Cotización"], ["other", "Otro"]] },
        { k: "who", l: "Responsable", t: "select", opts: people().length ? people() : [[uid(), "Yo"]], v: uid() },
        { k: "due", l: "Fecha límite", t: "date" },
        { k: "status", l: "Columna", t: "select", opts: [["backlog", "Por hacer"], ["design", "En curso"], ["review", "En revisión"], ["done", "Hecho"]], v: COL_ST[ctx.col] || "backlog" },
        { k: "prio", l: "Prioridad", t: "select", opts: [["1", "Alta"], ["2", "Media"], ["3", "Baja"]], v: "2" },
        { k: "fmt", l: "Formato", ph: "Ej.: 1080×1350" },
        { k: "brief", l: "Detalle", t: "textarea", rows: 3 },
      ];
    },
    save: function (v) { return ins("design_kanban_tasks", { id: "task_" + hex(16), workspace_id: ws(), account_id: uid(), created_by: uid(), title: v.title, brand_id: v.brand || null, type: v.type, format: v.fmt || null, status: v.status, priority: +v.prio, deadline: v.due || null, brief: v.brief || null, assigned_to: v.who || uid(), source: "manual" }); },
    ok: "Tarea creada",
  };

  C.agente = {
    title: "Nuevo agente", sub: "Un agente de IA de tu equipo con sus permisos por área. Usa el modelo de tus propias llaves (Integraciones).",
    fields: function () {
      var models = (typeof INTS !== "undefined" ? INTS.filter(function (i) { return i.cat === "Chat IA" && i.st === "ok"; }).map(function (i) { return [i.name, i.name]; }) : []);
      var lv = typeof PERM_LV !== "undefined" ? PERM_LV : [["no", "No"], ["ver", "Ver"], ["crear", "Crear"]];
      return [
        { k: "name", l: "Nombre", req: true, ph: "Ej.: Luna" },
        { k: "role", l: "Rol", ph: "Ej.: Community de Bloom" },
        { k: "tpl", l: "Plantilla", t: "select", opts: (typeof AG_TPL !== "undefined" ? Object.keys(AG_TPL).filter(function (k) { return k !== "musa"; }).map(function (k) { return [k, AG_TPL[k][0] + " · " + AG_TPL[k][1]]; }) : [["claude", "Claude Code"]]), full: true },
        { k: "model", l: "Modelo", t: "select", req: true, opts: models.length ? models : [["", "— conecta una IA en Integraciones —"]] },
        { k: "color", l: "Color", t: "color", v: "#2f6fed" },
        { k: "brands", l: "Marcas que puede tocar (ninguna = todas)", t: "checks", opts: brands() },
      ].concat((typeof AG_PERMS !== "undefined" ? AG_PERMS : []).map(function (p) { return { k: "p_" + p[0], l: p[1], t: "select", opts: lv, v: "ver" }; }));
    },
    save: function (v) {
      var perms = {}; Object.keys(v).forEach(function (k) { if (k.indexOf("p_") === 0) perms[k.slice(2)] = v[k]; });
      return ins("workspace_agents", { workspace_id: ws(), name: v.name, role: v.role || "Agente del equipo", template: v.tpl, model: v.model, color: v.color, os: "Linux", state: "idle", brands: v.brands.map(brandName).filter(Boolean), permissions: perms, wake: "Solo a pedido (chat)", task: "Listo · esperando su primera tarea" });
    },
    ok: function (v) { return "Agente «" + v.name + "» creado"; },
    after: function (r) { loadAgents().then(function () { if (r && r.id) location.hash = "agentes/chats/wa_" + r.id; }); },
  };

  C.apikey = {
    title: "Nueva llave del workspace", sub: "Para conectar una IA por MCP o tus sistemas por API. La verás una sola vez: guárdala.",
    fields: [
      { k: "label", l: "Nombre", req: true, ph: "Ej.: Claude de Renzo" },
      { k: "kind", l: "Uso", t: "select", opts: [["mcp", "IA por MCP (todo el workspace)"], ["rest", "API / webhooks"]] },
      { k: "role", l: "Permiso", t: "select", opts: [["editor", "Editor"], ["viewer", "Solo lectura"], ["admin", "Admin"]] },
    ],
    save: function (v) { return api("/api/workspaces/" + encodeURIComponent(ws()) + "/api-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: v.label, kind: v.kind, role: v.role }) }); },
    ok: "Llave creada", noReload: true,
    after: function (r) {
      var k = r && (r.key || r.rawKey || (r.data && (r.data.key || r.data.rawKey)));
      if (RR().loadKeys) RR().loadKeys();
      if (k) mx("Tu llave nueva", "Cópiala ahora: por seguridad no se vuelve a mostrar.", '<input class="fx-in" readonly value="' + esc(k) + '" id="mbKey"><div class="ag-ctl" style="margin-top:10px"><button class="pri" data-a="copy">Copiar</button></div>', function (e) { if (e.target.closest('[data-a="copy"]')) { var i = document.getElementById("mbKey"); i.select(); try { navigator.clipboard.writeText(i.value); } catch (x) { document.execCommand("copy"); } uiToast("Copiada"); } });
      go();
    },
  };

  /* ───────── datos que la maqueta no cargaba: playbooks, agentes y clones ───────── */
  function loadPlaybooks() {
    if (typeof PB === "undefined") return Promise.resolve();
    return get(q("workspace_playbooks", "id,category,name,description,steps,uses", "&order=updated_at.desc&limit=100")).then(function (rows) {
      PB.length = 0;
      (rows || []).forEach(function (p) { PB.push({ id: "pb_" + p.id, db: p.id, cat: p.category || "General", name: p.name, d: p.description || "", uses: p.uses || 0, steps: (p.steps || []).map(function (s) { return [s.d || 0, s.t || "", s.link || "planear/calendario", s.who || ""]; }) }); });
      if (typeof PBS !== "undefined" && PB.length && !PB.some(function (x) { return x.id === PBS.sel; })) PBS.sel = PB[0].id;
    });
  }
  function loadAgents() {
    if (typeof AGENTS === "undefined" || typeof AGX === "undefined") return Promise.resolve();
    return get(q("workspace_agents", "id,name,color,role,template,model,os,state,brands,permissions,wake,task", "&order=created_at.asc&limit=50")).then(function (rows) {
      for (var i = AGENTS.length - 1; i >= 0; i--) if (AGENTS[i]._db) AGENTS.splice(i, 1);
      (rows || []).forEach(function (a) { var x = AGX({ id: "wa_" + a.id, ws: ws(), name: a.name, color: a.color || "#111", role: a.role || "", tpl: a.template || "claude", model: a.model || "", os: a.os || "Linux", state: a.state || "idle", brands: a.brands && a.brands.length ? a.brands : ["Todas"], perms: a.permissions || {}, wake: a.wake || "Solo a pedido (chat)", task: a.task || "", url: "" }); x._db = a.id; AGENTS.push(x); });
    });
  }
  /* Clones: registro propio en workspace_clones (lista instantánea y visible para agentes); se sincroniza con HeyGen/ElevenLabs */
  function cloneTile(c) { return [esc(c.name), c.kind === "avatar" ? (c.status === "listo" ? "Avatar listo" : c.status === "error" ? "Avatar · error" : "Avatar · entrenando") : "Solo voz", c.provider === "heygen" ? "HeyGen" : "ElevenLabs"]; }
  function registerClone(c) {
    return ins("workspace_clones", Object.assign({ workspace_id: ws(), consent: true, created_by: uid() }, c)).then(function (row) { TILES["crear/clones"].unshift(cloneTile(row || c)); return row; });
  }
  window.__musaRegisterClone = registerClone;
  window.__musaReloadClones = function () { clonesWs = null; loadClones(); };
  var clonesWs = null, clonesSynced = {};
  function loadClones() {
    if (clonesWs === ws() || typeof TILES === "undefined") return;
    clonesWs = ws(); var W = ws();
    get(q("workspace_clones", "id,name,kind,provider,external_id,status", "&order=created_at.desc&limit=200")).then(function (rows) {
      rows = rows || []; TILES["crear/clones"] = rows.map(cloneTile);
      if (route.mod === "crear" && route.sub === "clones") go();
      if (clonesSynced[W]) return; clonesSynced[W] = 1;
      /* sincronización con los proveedores: agrega los que creaste fuera de Musa y actualiza el estado de los avatares */
      Promise.all([get("/api/elevenlabs/voices"), get("/api/heygen/avatars")]).then(function (r) {
        var have = {}; rows.forEach(function (x) { if (x.external_id) have[x.provider + ":" + x.external_id] = x; });
        var jobs = [];
        ((r[0] && r[0].voices) || []).filter(function (v) { return /clon|generated|professional/i.test(v.category || ""); }).forEach(function (v) {
          var id = v.voice_id || v.voiceId || v.id; if (id && !have["elevenlabs:" + id]) jobs.push(ins("workspace_clones", { workspace_id: W, kind: "voz", provider: "elevenlabs", external_id: id, name: v.name || "Voz", status: "listo", preview_url: v.preview_url || v.previewUrl || null }));
        });
        ((r[1] && r[1].avatars) || []).forEach(function (a) {
          var id = a.id || a.avatar_id || a.avatarId, st = a.ready ? "listo" : "entrenando", ex = id && have["heygen:" + id];
          if (!id) return;
          if (!ex) jobs.push(ins("workspace_clones", { workspace_id: W, kind: "avatar", provider: "heygen", external_id: id, name: a.name || "Avatar", status: st, preview_url: a.previewImageUrl || null }));
          else if (ex.status !== st) jobs.push(api("/rest/v1/workspace_clones?id=eq." + ex.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: st }) }));
        });
        if (jobs.length) Promise.all(jobs.map(function (j) { return j.catch(function () {}); })).then(function () { clonesWs = null; loadClones(); });
      });
    });
  }
  var extraWs = null;
  function loadExtras() { if (extraWs === ws()) return; extraWs = ws(); loadPlaybooks().then(loadAgents).then(function () { if (!(ED && ED.open) && !(VE && VE.open) && !(FL && FL.open)) go(); }); }

  /* ───────── qué abre cada botón ───────── */
  var HEADER = {
    "inicio": ["pieza", "Nueva pieza"], "planear/calendario": ["pieza", "Nueva pieza"], "planear/investigacion": ["fuente", "Nueva fuente"], "planear/briefs": ["brief", "Nuevo brief"], "planear/playbooks": ["playbook", "Nuevo playbook"],
    "crear/marcas": ["marca", "Nueva marca"], "crear/videos": ["video", "Nuevo video"], "crear/clones": ["clon", "Nuevo clon"], "crear/eventos": ["evento", "Nuevo evento"], "crear/mailing": [null, "Nuevo mailing"], "crear/formularios": ["form", "Nuevo formulario"], "crear/automatizaciones": ["flow", "Nueva automatización"],
    "conversar": ["mensaje", "Nuevo mensaje"], "anunciar": ["ads", "Nueva campaña de ads"],
    "vender": ["oportunidad", "Nueva oportunidad"], "vender/personas": ["persona", "Nueva persona"], "vender/empresas": ["marca", "Nueva marca"], "vender/cotizaciones": ["cotizacion", "Nueva cotización"],
    "clientes/briefs": ["brief", "Nuevo brief"], "clientes/cotizaciones": ["cotizacion", "Nueva cotización"], "clientes/fees": ["fee", "Nuevo fee"], "clientes/proyectos": ["proyecto", "Nuevo proyecto"],
    "agentes": ["agente", "Nuevo agente"],
  };
  function headerFor() { var k = route.mod + "/" + route.sub; return HEADER[k] || HEADER[route.mod] || null; }
  function colName(el) { var h = el.closest(".col-h"); return h ? h.firstChild.textContent.trim() : ""; }
  function mailNew() { return typeof ML !== "undefined" && ML.tab === "secuencias" ? "secuencia" : "mailing"; }

  function match(t) {
    var key = route.mod + "/" + route.sub, b;
    if (t.closest(".head .actions .btn-p")) { var h = headerFor(); if (!h) return null; return { c: h[0] || mailNew() }; }
    if ((b = t.closest(".fx-menu [data-cm]"))) return { design: { c: "diseno" }, deck: { c: "deck" }, video: { c: "video" } }[b.dataset.cm] || null;
    if ((b = t.closest(".col-add"))) {
      if (key === "inicio/mi-trabajo") return { c: "tarea", ctx: { col: colName(b) } };
      if (key === "vender/oportunidades") return { c: "oportunidad", ctx: { col: colName(b) } };
      if (key === "crear/automatizaciones") return { c: "flow" };
      return null;
    }
    if (t.closest('[data-bra="new"]')) return { c: "nota" };
    if (t.closest('[data-mla="new"]')) return { c: "mailing" };
    if (t.closest('[data-sqa="new"]')) return { c: "secuencia" };
    if (t.closest('[data-ada="new"]')) return { c: "ads" };
    if (t.closest('[data-ba="new"]')) return { c: "brief" };
    if (t.closest('[data-pa="new"]')) return { c: "playbook" };
    if (t.closest("#crmAddB")) return { c: "marca" };
    if ((b = t.closest('.fx-bar [data-fx="voice"], .fx-bar [data-fx="avatar"]')) && key === "crear/clones") return { c: "clon", ctx: { kind: b.dataset.fx === "voice" ? "voz" : "avatar" } };
    if (t.closest('[data-cx="new"]')) return { c: "apikey" };
    if (t.closest('a[href="#agentes/chats/nuevo"]')) return { c: "agente" };
    if (t.closest('a[href="#crear/eventos/nuevo"]')) return { c: "evento" };
    if ((b = t.closest('[data-ba="quote"]')) && typeof BRIEFS !== "undefined") { var br = BRIEFS.find(function (x) { return typeof CL !== "undefined" && x.id === CL.brief; }); return { c: "cotizacion", ctx: { title: br && br.name, brand: br && RR().brandId[br.brand] } }; }
    if (key === "vender/oportunidades" && (b = t.closest(".kc")) && !b.querySelector(".pill")) { var tt = (b.querySelector("b") || {}).textContent || ""; return { c: "cotizacion", ctx: { deal: tt.trim() } }; }
    return null;
  }

  document.addEventListener("click", function (e) {
    var R = RR(); if (!R || !R.on || !e.target.closest) return;
    var m = match(e.target); if (!m || !C[m.c]) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    document.querySelectorAll(".fx-menu").forEach(function (x) { x.remove(); });
    open(C[m.c], m.ctx);
  }, true);

  /* rutas «/nuevo» de la maqueta (formularios de página completa) → el popup */
  window.addEventListener("hashchange", function () {
    var R = RR(); if (!R || !R.on) return;
    var h = location.hash.replace("#", "");
    var to = { "agentes/chats/nuevo": ["agente", "agentes/chats"], "crear/eventos/nuevo": ["evento", "crear/eventos"] }[h];
    if (to) { history.replaceState(null, "", "#" + to[1]); go(); open(C[to[0]]); }
  });

  /* el botón de la cabecera dice lo que crea en cada sección; datos extra al entrar */
  var _dv = drawView;
  drawView = function () {
    var r = _dv.apply(this, arguments), R = RR();
    try {
      if (R && R.on) {
        loadExtras();
        if (route.mod === "crear" && route.sub === "clones") loadClones();
        var h = headerFor(), act = document.querySelector(".head .actions .btn-p");
        if (h && act && h[1] && !(route.mod === "crear" && route.sub === "mailing")) act.textContent = h[1];
      }
    } catch (x) {}
    return r;
  };
  var _ws = typeof wsSwitch === "function" ? wsSwitch : null;
  if (_ws) wsSwitch = function () { extraWs = null; clonesWs = null; return _ws.apply(this, arguments); };

  window.__musaCreate = { open: function (k, ctx) { return open(C[k], ctx); }, C: C };
})();
