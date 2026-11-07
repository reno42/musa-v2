/* bridge-portal.js — Portal del cliente real (modo agencia, migración 23).
 * · INVITADO (cliente con cuenta ligada a UNA marca): ve solo lo compartido de su marca —
 *   piezas, calendario, briefs, proyectos, eventos y notas — con hilo de comentarios por pieza
 *   (content_comments vía /api/comments). RLS ya le filtra el resto; aquí se muestra bonito.
 * · AGENCIA (Clientes › Portal): personaliza el portal de cada marca (nombre, bienvenida, color,
 *   secciones), invita clientes por correo (brand_guests) y los revoca, y mira el portal como lo
 *   ve el cliente. 
 * Regla: la maqueta NO se toca. Enganches: VIEWS2.pt* (portal del cliente) y VIEWS2.clPortal.
 * Cargador: "bridge-portal.js" en el array "extras" de bridge.js.
 */
(function () {
  function RB() { return window.__musaReal; }
  function bridge() { try { return window.parent !== window && window.parent.__musaBridge; } catch (e) { return null; } }
  function api(path, init) { var b = bridge(); if (!b) return Promise.reject(new Error("sin puente")); return b.api(path.charAt(0) === "/" ? path : "/rest/v1/" + path, init); }
  function J(m, b) { return { method: m, headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(b) }; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&quot;" }[c]; }); }
  function real() { return RB() && RB().on; }
  function ws() { return RB().ws; }
  function ago(iso) { if (!iso) return "—"; var d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5); return d <= 0 ? "hoy" : d === 1 ? "ayer" : "hace " + d + " días"; }
  /* /api/* responde {success, data}; /rest/* responde la fila directo */
  function aget(p) { return api(p).then(function (r) { if (r && r.success === false) throw new Error(r.error || "sin acceso"); return r && r.data !== undefined ? r.data : r; }); }
  function apost(p, m, b) { return api(p, J(m, b)).then(function (r) { if (r && r.success === false) throw new Error(r.error || "no se pudo guardar"); return r && r.data !== undefined ? r.data : r; }); }

  var P = { on: false, mode: null, ws: null, brandId: null, brandName: null, portal: null, brand: null, me: null,
            pieces: [], cal: [], briefs: [], projects: [], events: [], notes: [], brands: [], guests: null, loading: null,
            /* crm viaja keyed a la marca (crmBrand): viewPt re-corre resolve/loadBrand en
               cada render y un reset directo entraría en bucle con el re-dibujo de loadCrm */
            crm: null, crmBrand: null, crmLoading: null };

  var SECTIONS = [
    ["aprobar", "Por aprobar"], ["archivos", "Diseños compartidos"], ["calendario", "Calendario"],
    ["briefs", "Briefs"], ["proyectos", "Proyectos"], ["resultados", "Resultados"], ["crm", "CRM"]
  ];

  /* ═══ datos ═══ */
  function rest(q) { return api(q).catch(function () { return []; }).then(function (r) { return r || []; }); }
  function loadBrand(bid, w) {
    P.brandId = bid; P.ws = w || ws();
    var W = encodeURIComponent(P.ws), B = encodeURIComponent(bid);
    return Promise.all([
      aget("/api/brand-portal/" + B + "?workspaceId=" + W),
      rest("templates?workspace_id=eq." + W + "&data->>brandId=eq." + B + "&deleted_at=is.null&select=id,name,updated_at,thumb:data->>thumbnail&order=updated_at.desc&limit=120"),
      rest("content_calendar?workspace_id=eq." + W + "&brand_id=eq." + B + "&select=id,topic,scheduled_date,status,visual_type&order=scheduled_date.desc&limit=120"),
      rest("briefs?workspace_id=eq." + W + "&brand_id=eq." + B + "&select=id,title,status,objective,updated_at&order=updated_at.desc&limit=120"),
      rest("workspace_projects?workspace_id=eq." + W + "&brand_id=eq." + B + "&select=id,name,status&order=updated_at.desc&limit=120"),
      rest("workspace_events?workspace_id=eq." + W + "&brand_id=eq." + B + "&select=id,name,date,published&order=date.desc&limit=120"),
      rest("brain_notes?workspace_id=eq." + W + "&entity_type=eq.brand&entity_id=eq." + B + "&select=id,title,body_md,updated_at&order=updated_at.desc&limit=50")
    ]).then(function (r) {
      var d = r[0] || {};
      P.portal = d.portal || null; P.brand = d.brand || { id: bid, name: P.brandName || "—" }; P.me = d.me || null;
      P.pieces = r[1]; P.cal = r[2]; P.briefs = r[3]; P.projects = r[4]; P.events = r[5]; P.notes = r[6];
      P.on = true;
    });
  }
  function resolve() {
    if (P.loading && !P.force) return P.loading;
    P.loading = aget("/api/team/access").then(function (a) {
      a = a || {};
      var guest = (a.guestBrands || [])[0] || null;
      var withRole = (a.workspaces || []).filter(function (w) { return w.role; });
      /* el manager opera sobre el espacio ACTUAL de la sesión, no el primero con
         rol: en cuentas con espacio personal + agencia el primero puede quedarse
         sin marcas y el portal colgaba con P.brand null (crash esc(P.brand.name)) */
      var member = withRole.find(function (w) { return w.id === ws(); }) || withRole[0] || null;
      if (guest) { P.mode = "guest"; P.ws = guest.workspaceId; return loadBrand(guest.brandId, guest.workspaceId); }
      if (member) {
        P.mode = "member";
        if (P.ws !== member.id) { P.brandId = null; P.brand = null; P.portal = null; } /* espacio distinto: estado obsoleto */
        P.ws = member.id;
        return api("brands?workspace_id=eq." + encodeURIComponent(member.id) + "&select=id,name&order=name.asc").then(function (r) {
          P.brands = (r && r.data !== undefined ? r.data : r) || [];
          if (!P.brandId && P.brands[0]) return loadBrand(P.brands[0].id, member.id);
        });
      }
      P.mode = "none"; P.on = true;
    }).then(function () { P.loading = null; }, function (e) { P.loading = null; throw e; });
    return P.loading;
  }

  /* ═══ comentarios ═══ */
  function commentsOf(type, id, opener) {
    var W = encodeURIComponent(P.ws);
    aget("/api/comments?workspaceId=" + W + "&entityType=" + type + "&entityId=" + encodeURIComponent(id)).then(function (list) {
      var rows = (list || []).map(function (c) {
        return '<div class="li" style="align-items:flex-start"><div style="flex:1"><b>' + esc(c.author_name || "—") + '</b> <span style="color:var(--muted)">' + (c.author_role === "client" ? "· cliente" : "") + " · " + ago(c.created_at) + '</span><p>' + esc(c.body) + "</p></div>" +
          (c.resolved ? '<span class="pill" style="background:var(--ok-bg);color:var(--ok)">resuelto</span>' : "") + "</div>";
      }).join("");
      mx("Comentarios", (P.brand && P.brand.name ? esc(P.brand.name) + " · " : "") + "conversa con tu agencia pieza por pieza.",
        '<div class="list">' + (rows || '<p class="empty-note">Sin comentarios todavía.</p>') + '</div><div class="pt-new" style="margin-top:10px"><input id="ptCm" maxlength="500" placeholder="Escribe un comentario…"><button class="btn btn-p" data-ptcm>Enviar</button></div>',
        function (e) {
          if (!e.target.closest("[data-ptcm]")) return;
          var inp = document.getElementById("ptCm"), v = (inp.value || "").trim();
          if (!v) return inp.focus();
          e.target.closest("button").disabled = true;
          apost("/api/comments", "POST", { workspaceId: P.ws, entityType: type, entityId: id, brandId: P.brandId, body: v, authorName: userEmailName() })
            .then(function () { mxEl.hidden = true; uiToast("Comentario enviado"); if (opener) opener(); }, function (er) { uiToast(er.message || "No se pudo comentar"); e.target.closest("button").disabled = false; });
        });
    }, function (e) { uiToast(e.message || "No se pudieron cargar los comentarios"); });
  }
  function userEmailName() {
    var b = bridge(), mail = (b && b.userEmail) || "";
    return mail ? mail.split("@")[0].replace(/[._-]+/g, " ").slice(0, 40) : "";
  }

  /* ═══ CRM del portal (REQ ManyChat) ═══
   * Contactos de la marca + ficha con timeline. La proyección la impone el
   * server (allowlist en /api/brand-portal/:brandId/crm/*): data fija y
   * conversaciones — JAMÁS deal values ni notas de la agencia. */
  function loadCrm() {
    if (P.crmLoading || (P.crm !== null && P.crmBrand === P.brandId)) return;
    P.crmLoading = aget("/api/brand-portal/" + encodeURIComponent(P.brandId) + "/crm/contacts?workspaceId=" + encodeURIComponent(P.ws)).then(function (d) {
      P.crm = (d && d.contacts) || []; P.crmBrand = P.brandId; P.crmLoading = null;
      if ((route.sub || "") === "crm") viewPt(P.mode === "member"); /* re-dibuja con datos */
    }, function () { P.crm = []; P.crmBrand = P.brandId; P.crmLoading = null; });
  }
  function crmContactModal(id) {
    aget("/api/brand-portal/" + encodeURIComponent(P.brandId) + "/crm/contacts/" + encodeURIComponent(id) + "?workspaceId=" + encodeURIComponent(P.ws)).then(function (d) {
      var c = (d && d.contact) || {}, tl = (d && d.timeline) || [];
      var name = [c.first_name, c.last_name].filter(Boolean).join(" ") || "—";
      var rows = [["Email", c.email], ["Teléfono", c.phone], ["Empresa", c.company], ["Cargo", c.job_title], ["Estado", c.status], ["Etiquetas", (c.tags || []).join(", ")]]
        .filter(function (r) { return r[1]; }).map(function (r) {
          return '<div class="li"><div><b>' + esc(r[0]) + "</b><p>" + esc(r[1]) + "</p></div></div>";
        }).join("");
      var cf = c.custom_fields && typeof c.custom_fields === "object" ? Object.keys(c.custom_fields).map(function (k) {
        return '<div class="li"><div><b>' + esc(k) + "</b><p>" + esc(c.custom_fields[k]) + "</p></div></div>";
      }).join("") : "";
      var timeline = (tl || []).map(function (t) {
        var typeLabel = { mensaje: "Mensaje", comentario: "Comentario", story_reply: "Respuesta a story", form_web: "Formulario web" }[t.interaction_type] || esc(t.interaction_type || "Interacción");
        var when = t.interaction_date ? String(t.interaction_date).slice(0, 10) : "";
        return '<div class="li"><div><b>' + typeLabel + "</b><p>" + esc(String(t.notes || "").slice(0, 300)) + '</p><small style="color:var(--muted)">' + esc(when) + "</small></div></div>";
      }).join("");
      mx(name, "Lo que el bot de tu agencia registra de esta persona.",
        '<div class="list">' + (rows || '<p class="empty-note">Sin datos todavía.</p>') + (cf || "") + "</div>" +
        '<h3 style="margin:14px 0 8px;font-size:13px">Timeline</h3><div class="list">' + (timeline || '<p class="empty-note">Sin interacciones todavía.</p>') + "</div>" +
        '<div class="ag-ctl" style="margin-top:10px"><button class="pri" data-mxc="1">Cerrar</button></div>',
        function (e) { if (e.target.closest("[data-mxc]")) mxEl.hidden = true; });
    }, function (er) { uiToast(er.message || "No se pudo abrir el contacto"); });
  }

  /* «Mi información»: la proyección visible del cliente (allowlist impuesta por el server).
     Nada comercial viaja aquí — eso vive en el CRM y jamás se comparte con él. */
  function meCard() {
    var m = P.me || {};
    if (!m.email) return "";
    var rows = [["Nombre", m.displayName], ["Correo", m.email], ["Cargo", m.title], ["Empresa", m.company], ["Teléfono", m.phone]];
    var items = rows.filter(function (r) { return r[1]; }).map(function (r) {
      return '<div class="li"><div><b>' + esc(r[0]) + "</b><p>" + esc(r[1]) + "</p></div></div>";
    }).join("");
    return '<article class="card"><div class="ch"><h3>Mi información</h3><small>Los datos que tu agencia puso de ti</small></div><div class="list">' +
      (items || '<p class="empty-note">Tu agencia todavía no cargó tu información.</p>') +
      (m.since ? '<p class="int-note" style="margin-top:8px">Cliente desde ' + esc(String(m.since).slice(0, 10)) + "</p>" : "") + "</div></article>";
  }
  /* Credenciales show-once: la contraseña se muestra UNA vez y se entrega al cliente. */
  function credsModal(d) {
    var c = (d && d.credentials) || {};
    mx("Acceso de cliente", "Entrega estas credenciales AHORA: la contraseña se muestra solo esta vez. El cliente también puede usar «Olvidé mi contraseña» en el login.",
      '<div class="list">' +
      '<div class="li"><div><b>Portal</b><p style="user-select:all">' + esc(d && d.portalUrl || "") + "</p></div></div>" +
      '<div class="li"><div><b>Usuario</b><p style="user-select:all">' + esc(c.email || "") + "</p></div></div>" +
      '<div class="li"><div><b>Contraseña</b><p style="font-family:ui-monospace,monospace;user-select:all">' + esc(c.password || "") + "</p></div></div></div>" +
      '<p class="int-note" style="margin-top:8px">' + (d && d.authCreated ? "Cuenta nueva creada." : "El correo ya tenía cuenta: su contraseña fue restablecida.") + (d && d.reactivated ? " Acceso reactivado." : "") + "</p>" +
      '<div class="ag-ctl" style="margin-top:10px"><button class="pri" data-mxc="1">Entendido</button></div>',
      function (e) { if (e.target.closest("[data-mxc]")) mxEl.hidden = true; });
  }

  /* ═══ vistas del cliente (portal/*) ═══ */
  function secTitle() { var s = route.sub || "aprobar"; for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i][0] === s) return SECTIONS[i][1]; return "Portal"; }
  function topBar(preview) {
    var others = "";
    if (preview && P.brands.length > 1) {
      others = '<select id="ptBP">' + P.brands.map(function (b) { return '<option value="' + esc(b.id) + '" ' + (b.id === P.brandId ? "selected" : "") + ">" + esc(b.name) + "</option>"; }).join("") + "</select>";
    }
    return '<div class="pt-top"><span>' + (preview ? "Vista previa · " : "") + "<b>" + esc(P.portal && P.portal.display_name || P.brand.name) + "</b> · portal de tu agencia</span>" + others +
      (preview ? '<button class="btn btn-g" data-ptmgr>Volver a la configuración</button>' : "") + "</div>";
  }
  function pieceGrid(items, empty) {
    if (!items.length) return '<article class="card"><div class="ch"><h3>' + secTitle() + "</h3></div>" + (empty || '<p class="empty-note">Todavía no hay nada compartido aquí.</p>') + "</article>";
    return '<article class="card"><div class="ch"><h3>' + secTitle() + ' <small style="color:var(--muted)">· ' + items.length + "</small></h3></div><div class=\"fx-fmt\">" + items.map(function (p) {
      return '<figure>' + (p.thumb ? '<img src="' + esc(p.thumb) + '" alt="" loading="lazy">' : '<div style="aspect-ratio:1;background:var(--panel-2);display:grid;place-items:center;color:var(--muted)">Diseño</div>') +
        '<figcaption><b>' + esc(p.name || "—") + "</b>" + (p.when ? "<span>" + ago(p.when) + "</span>" : "") +
        '<span class="ag-ctl" style="justify-content:center;margin-top:4px"><button data-ptcm="' + esc(p.id) + '">💬 Comentar</button></span></figcaption></figure>';
    }).join("") + "</div></article>";
  }
  function listView(title, rows, empty) {
    return '<article class="card"><div class="ch"><h3>' + title + '</h3></div><div class="list">' + (rows || '<p class="empty-note">' + empty + "</p>") + "</div></article>";
  }
  function section() {
    var s = route.sub || "aprobar", w = P.brand && P.brand.name ? esc(P.brand.name) : "";
    if (s === "aprobar" || s === "archivos") return pieceGrid(P.pieces.map(function (p) { return { id: p.id, name: p.name, thumb: p.thumb, when: p.updated_at }; }));
    if (s === "calendario") return listView("Lo publicado en " + w, P.cal.slice().sort(function (a, b) { return (b.scheduled_date || "").localeCompare(a.scheduled_date || ""); }).map(function (c) {
      return '<div class="li"><div><b>' + esc(c.topic || "Pieza") + "</b><p>" + esc([c.scheduled_date, c.visual_type, c.status].filter(Boolean).join(" · ")) + '</p></div><span class="ag-ctl"><button data-ptcm="cal:' + esc(c.id) + '">💬</button></span></div>';
    }).join(""), "Nada programado todavía.");
    if (s === "briefs") return listView("Briefs de " + w, P.briefs.map(function (b) {
      return '<div class="li"><div><b>' + esc(b.title || "Brief") + "</b><p>" + esc([b.status, b.objective].filter(Boolean).join(" · ")) + "</p><small style=\"color:var(--muted)\">" + ago(b.updated_at) + '</small></div><span class="ag-ctl"><button data-ptcm="brief:' + esc(b.id) + '">💬</button></span></div>';
    }).join(""), "Tu agencia todavía no compartió briefs.");
    if (s === "proyectos") return listView("Proyectos de " + w, P.projects.map(function (p) {
      return '<div class="li"><div><b>' + esc(p.name) + "</b><p>" + esc(p.status || "") + '</p></div><span class="ag-ctl"><button data-ptcm="proj:' + esc(p.id) + '">💬</button></span></div>';
    }).join(""), "Sin proyectos abiertos con tu agencia.");
    if (s === "resultados") {
      var ev = P.events.map(function (e) { return '<div class="li"><div><b>' + esc(e.name) + "</b><p>" + esc([e.date, e.published ? "público" : "borrador"].filter(Boolean).join(" · ")) + "</p></div></div>"; }).join("");
      return listView("Eventos y lanzamientos de " + w, ev, "Cuando tu agencia comparta resultados, aparecen aquí.") +
        (P.notes.length ? listView("Notas de tu marca", P.notes.map(function (n) { return '<div class="li"><div><b>' + esc(n.title) + "</b><p>" + esc(String(n.body_md || "").slice(0, 120)) + "</p></div></div>"; }).join(""), "") : "");
    }
    if (s === "crm") {
      var crmReady = P.crm !== null && P.crmBrand === P.brandId;
      if (!crmReady) loadCrm(); /* primera pasada (o marca cambiada): pide y re-dibuja */
      var crmRows = (crmReady ? P.crm : []).map(function (c) {
        return '<div class="li" data-ptcrm="' + esc(c.id) + '" style="cursor:pointer"><div><b>' + esc([c.first_name, c.last_name].filter(Boolean).join(" ") || "—") + "</b><p>" +
          esc([c.email, c.phone, c.company].filter(Boolean).join(" · ")) + '</p><small style="color:var(--muted)">' + esc((c.tags || []).join(" · ")) + " · " + ago(c.updated_at) + "</small></div><span>›</span></div>";
      }).join("");
      return listView("Contactos de " + w, crmRows, "Cuando el bot de ManyChat capture personas, aparecen aquí.");
    }
    return pieceGrid([]);
  }
  function viewPt(preview) {
    if (!real()) return;
    var body = document.getElementById("body");
    if (!body) return;
    body.innerHTML = '<div class="ws-note">Cargando tu portal…</div>';
    resolve().then(function () {
      if (P.mode === "none") { body.innerHTML = '<div class="ws-note">Tu agencia todavía no te invitó al portal. Pídele la invitación con tu correo.</div>'; return; }
      if (!P.brand) { body.innerHTML = '<div class="ws-note">Este espacio no tiene marcas todavía: crea una en Crear › Marcas.</div>'; return; }
      if (P.force) { P.force = false; }
      var html = topBar(preview && P.mode !== "guest") + (P.mode === "guest" ? meCard() : "") + section();
      body.innerHTML = html;
      body.onclick = function (e) {
        var t = e.target.closest("[data-ptcm]");
        if (t) {
          var k = t.dataset.ptcm.split(":"), type = { cal: "content_calendar", brief: "briefs", proj: "workspace_projects" }[k[0]] || "templates";
          return commentsOf(type, k[0] === "cal" || k[0] === "brief" || k[0] === "proj" ? k[1] : t.dataset.ptcm, function () { viewPt(preview); });
        }
        if (e.target.closest("[data-ptmgr]")) {
          /* vuelta del preview: el rol «cliente» bloquea clientes/portal en wsAllows,
             así que restauramos global antes de navegar al manager */
          var rs0 = document.getElementById("role");
          if (P.mode === "member" && rs0 && rs0.value !== "global") { rs0.value = "global"; if (typeof rs0.onchange === "function") rs0.onchange(); }
          return void (location.hash = "clientes/portal");
        }
        var cc = e.target.closest("[data-ptcrm]");
        if (cc) return crmContactModal(cc.dataset.ptcrm);
      };
      body.onchange = function (e) {
        if (e.target.id === "ptBP") { P.force = true; loadBrand(e.target.value).then(function () { viewPt(preview); }); }
      };
    }, function (e) { body.innerHTML = '<div class="ws-note">' + esc(e.message || "No se pudo cargar el portal") + "</div>"; });
  }

  /* ═══ configuración del portal (agencia: Clientes › Portal) ═══ */
  function managerView() {
    if (!real()) return;
    var body = document.getElementById("body");
    if (!body) return;
    body.innerHTML = '<div class="ws-note">Cargando configuración…</div>';
    resolve().then(function () {
      if (P.mode === "guest") return void (location.hash = "portal/aprobar");
      if (P.mode === "none") { body.innerHTML = '<div class="ws-note">Este espacio no tiene marcas todavía: crea una en Crear › Marcas.</div>'; return; }
      if (!P.brand) { body.innerHTML = '<div class="ws-note">Este espacio no tiene marcas todavía: crea una en Crear › Marcas.</div>'; return; }
      var p = P.portal || {}, sec = p.sections || {};
      body.innerHTML =
        '<div class="pt-top"><span>Portal de cliente · <b>' + esc(P.brand.name) + '</b> · personaliza lo que ve tu cliente y compártelo por correo</span>' +
        (P.brands.length > 1 ? '<select id="ptBM">' + P.brands.map(function (b) { return '<option value="' + esc(b.id) + '" ' + (b.id === P.brandId ? "selected" : "") + ">" + esc(b.name) + "</option>"; }).join("") + "</select>" : "") +
        '<button class="btn btn-g" data-ptsee>Ver como cliente</button></div>' +
        '<div class="grid">' +
        '<article class="card c6"><div class="ch"><h3>Personalizar</h3></div>' +
        '<label class="fx-lbl">Nombre que ve el cliente</label><input class="fx-in" id="ptDn" value="' + esc(p.display_name || P.brand.name) + '" maxlength="80">' +
        '<label class="fx-lbl">Bienvenida (markdown)</label><textarea class="fx-in" id="ptWc" rows="4" maxlength="5000">' + esc(p.welcome_md || "Bienvenido: aquí sigue tu marca al día. Comenta cada pieza y tu agencia la ve al instante.") + "</textarea>" +
        '<label class="fx-lbl">Color del portal</label><input type="color" id="ptAc" value="' + esc(p.accent_color || "#ff5e00") + '" style="height:32px;background:none">' +
        '<label class="fx-lbl">Secciones visibles</label>' +
        SECTIONS.map(function (s) { return '<label style="display:flex;gap:8px;align-items:center;margin:4px 0"><input type="checkbox" data-ptsec="' + s[0] + '" ' + (sec[s[0]] !== false ? "checked" : "") + "> " + s[1] + "</label>"; }).join("") +
        '<div class="ag-ctl" style="margin-top:10px"><button class="pri" data-ptsave>Guardar portal</button></div></article>' +
        '<article class="card c6"><div class="ch"><h3>Clientes con acceso</h3><small>Solo ven lo compartido de esta marca</small></div>' +
        '<div class="pt-new"><input id="ptGe" placeholder="correo del cliente" type="email"><button class="btn btn-p" data-ptginv>Invitar</button></div>' +
        '<div class="list" id="ptGl"><p class="empty-note">Cargando…</p></div></article>' +
        "</div>";
      body.onchange = function (e) {
        if (e.target.id === "ptBM") { P.force = true; loadBrand(e.target.value).then(function () { managerView(); }); }
      };
      body.onclick = function (e) {
        if (e.target.closest("[data-ptsee]")) { P.force = true; location.hash = "portal/aprobar"; return void asClient(P.brand && P.brand.name); }
        if (e.target.closest("[data-ptsave]")) {
          var sections = {}; SECTIONS.forEach(function (s) { var c = document.querySelector('[data-ptsec="' + s[0] + '"]'); sections[s[0]] = !c || c.checked; });
          e.target.closest("button").disabled = true;
          return apost("/api/brand-portal/" + encodeURIComponent(P.brandId), "PUT", {
            workspaceId: P.ws, displayName: (document.getElementById("ptDn").value || "").trim(),
            welcomeMd: (document.getElementById("ptWc").value || "").trim(),
            accentColor: document.getElementById("ptAc").value, sections: sections, enabled: true
          }).then(function (d) { P.portal = d; uiToast("Portal guardado"); e.target.closest("button").disabled = false; }, function (er) { uiToast(er.message || "No se pudo guardar"); e.target.closest("button").disabled = false; });
        }
        if (e.target.closest("[data-ptginv]")) {
          var mail = (document.getElementById("ptGe").value || "").trim();
          if (!mail) return document.getElementById("ptGe").focus();
          var inv = e.target.closest("button"); inv.disabled = true;
          return apost("/api/team/guests/provision", "POST", { workspaceId: P.ws, brandId: P.brandId, email: mail })
            .then(function (d) { inv.disabled = false; document.getElementById("ptGe").value = ""; credsModal(d); loadGuests(); },
              function (er) { inv.disabled = false; uiToast(er.message || "No se pudo crear el acceso"); });
        }
        var rev = e.target.closest("[data-ptgrevoke]");
        if (rev) return apost("/api/team/guests/" + encodeURIComponent(rev.dataset.ptgrevoke), "DELETE", { workspaceId: P.ws })
          .then(function () { uiToast("Acceso revocado"); loadGuests(); }, function (er) { uiToast(er.message || "No se pudo revocar"); });
        var rst = e.target.closest("[data-ptgreset]");
        if (rst) return apost("/api/team/guests/" + encodeURIComponent(rst.dataset.ptgreset) + "/reset-password", "POST", { workspaceId: P.ws })
          .then(function (d) { credsModal(d); }, function (er) { uiToast(er.message || "No se pudo resetear"); });
      };
      loadGuests();
    }, function (e) { body.innerHTML = '<div class="ws-note">' + esc(e.message || "No se pudo cargar") + "</div>"; });
  }
  function loadGuests() {
    var el = document.getElementById("ptGl");
    if (!el) return;
    aget("/api/team/guests?workspaceId=" + encodeURIComponent(P.ws)).then(function (g) {
      P.guests = g || [];
      var mine = P.guests.filter(function (x) { return x.brand_id === P.brandId; });
      el.innerHTML = mine.length ? mine.map(function (x) {
        return '<div class="li"><div><b>' + esc(x.email) + "</b><p>" + esc(x.brandName || "—") + " · " + (x.status === "activo" ? "con acceso" : "revocado") + ' · ' + ago(x.created_at) + '</p></div>' +
          '<span class="ag-ctl">' + (x.status === "activo" ? '<button data-ptgreset="' + esc(x.id) + '">Resetear</button><button data-ptgrevoke="' + esc(x.id) + '">Revocar</button>' : "") + "</span></div>";
      }).join("") : '<p class="empty-note">Nadie más ve este portal. Invita al cliente con su correo: al entrar con esa cuenta verá su marca al día.</p>';
    }, function (e) { el.innerHTML = '<p class="empty-note">' + esc(e.message || "No se pudieron cargar los invitados") + "</p>"; });
  }

  /* ═══ privado/compartido + etiquetas en la librería de diseños (agencia) ═══
   * Cada diseño se comporta como archivo: chip de visibilidad (clic = alternar),
   * etiquetas editables y filtro «Mi negocio» según brands.is_house. */
  var AG = { vis: {}, house: {}, anyHouse: false, filter: "all" };
  function visLoad() {
    var ids = ((RB().tpl || [])).map(function (t) { return t.id; }).filter(Boolean);
    if (!ids.length) return Promise.resolve();
    return rest("templates?id=in.(" + ids.join(",") + ")&select=id,visibility,tags,brandId:data->>brandId").then(function (rows) {
      (rows || []).forEach(function (r) { AG.vis[r.id] = { visibility: r.visibility || "shared", tags: r.tags || [], brand: r.brandId }; });
    });
  }
  function housesLoad() {
    var q = function (withCol) {
      /* sin catch: un error (columna is_house sin migrar) cae al reintento sin is_house */
      return api("brands?workspace_id=eq." + encodeURIComponent(ws()) + "&select=id,name" + (withCol ? ",is_house" : "") + "&order=name.asc&limit=200");
    };
    return q(true).catch(function () { return q(false); }).then(function (r) {
      var rows = (r && r.data !== undefined ? r.data : r) || [];
      (rows || []).forEach(function (b) { AG.house[b.id] = b.is_house === true; });
      AG.brandsH = rows || [];
      AG.anyHouse = (rows || []).some(function (b) { return b.is_house === true; });
    });
  }
  function chipHtml(id) {
    var m = AG.vis[id];
    if (!m) return "";
    return '<span class="pt-vis" data-vistoggle="' + esc(id) + '" style="cursor:pointer;font-size:10px;color:var(--muted)">' + (m.visibility === "private" ? "Privado" : "Compartido") + "</span>" +
      '<span class="pt-vis" data-vistags="' + esc(id) + '" style="cursor:pointer;font-size:10px;color:var(--muted)">🏷 ' + (m.tags || []).length + "</span>";
  }
  function decorateLibrary() {
    if (P.mode === "guest") return; /* el invitado usa su portal, no edita visibilidad aquí */
    var R = RB(), tiles = document.querySelectorAll("#body .tile[data-open]");
    if (!tiles.length) return;
    var bar = document.createElement("div");
    bar.className = "flt-bar";
    bar.innerHTML = [["all", "Todas"], ["shared", "Compartidas"], ["private", "Privadas"], ["house", "Mi negocio"]].map(function (f) {
      return '<button data-agf="' + f[0] + '" class="' + (AG.filter === f[0] ? "on" : "") + '">' + f[1] + "</button>";
    }).join("") + '<button data-aghouse="1" title="Marcar cuál es tu propio negocio">⚙ Marca propia</button>';
    var tilesEl = document.querySelector("#body .tiles");
    if (tilesEl && !document.querySelector("#body .flt-bar[data-aglib]")) { bar.setAttribute("data-aglib", "1"); tilesEl.parentNode.insertBefore(bar, tilesEl); }
    var shown = 0;
    tiles.forEach(function (t) {
      var x = (R.tpl || [])[+t.dataset.open], m = x && AG.vis[x.id];
      var hide = m && ((AG.filter === "shared" && m.visibility !== "shared") || (AG.filter === "private" && m.visibility !== "private") || (AG.filter === "house" && !(m.brand && AG.house[m.brand])));
      t.style.display = hide ? "none" : "";
      if (hide) return;
      shown++;
      var bb = t.querySelector(".tile-b");
      if (bb && !bb.querySelector(".pt-vis")) bb.insertAdjacentHTML("beforeend", '<div style="display:flex;gap:10px;align-items:center">' + chipHtml(x.id) + '</div>');
    });
    if (!shown) document.querySelectorAll("#body .empty-note").forEach(function (e) { e.remove(); });
  }
  function toggleVis(id) {
    var m = AG.vis[id];
    if (!m) return;
    var next = m.visibility === "private" ? "shared" : "private";
    api("templates?id=eq." + encodeURIComponent(id), { method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ visibility: next }) })
      .then(function () { m.visibility = next; uiToast(next === "private" ? "Ahora es privado: solo tú y los admins lo ven" : "Compartido con tu equipo y los clientes de la marca"); decorateLibrary(); },
        function (e) { uiToast("No se pudo cambiar: " + (e && e.message || "error")); });
  }
  function tagsPopup(id) {
    var m = AG.vis[id];
    if (!m) return;
    mx("Etiquetas del diseño", "Palabras cortas para encontrarlo rápido: campaña, formato, temporada… Sepáralas con comas. Tu equipo las ve en la librería y el portal respeta la visibilidad.",
      '<input class="fx-in" id="ptTags" value="' + esc((m.tags || []).join(", ")) + '" placeholder="verano, reel, cliente-x"><div class="ag-ctl" style="margin-top:10px"><button class="pri" data-a="go">Guardar</button></div>',
      function (e) {
        if (!e.target.closest('[data-a="go"]')) return;
        var v = (document.getElementById("ptTags").value || "").split(",").map(function (s) { return s.trim().slice(0, 40); }).filter(Boolean).slice(0, 20);
        api("templates?id=eq." + encodeURIComponent(id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tags: v }) })
          .then(function () { m.tags = v; mxEl.hidden = true; uiToast("Etiquetas guardadas"); decorateLibrary(); }, function (er) { uiToast("No se pudo guardar: " + (er && er.message || "error")); });
      });
  }
  function housePopup() {
    mx("Mi negocio", "Marca con cuál marca es tu PROPIO negocio (la agencia misma): su CRM, sus embudos y sus reportes son «Mi negocio». Las demás son clientes.",
      '<div class="list">' + (AG.brandsH || []).map(function (b) {
        return '<label class="li" style="cursor:pointer"><input type="checkbox" data-agh="' + esc(b.id) + '" ' + (AG.house[b.id] ? "checked" : "") + '> <div><b>' + esc(b.name) + "</b></div></label>";
      }).join("") + '</div><p class="int-note" style="margin-top:8px">Se guarda al instante. El filtro «Mi negocio» usa esta marca.</p>',
      function (e) {
        var c = e.target.closest("[data-agh]");
        if (!c) return;
        var on = c.checked;
        if (on) Object.keys(AG.house).forEach(function (k) { AG.house[k] = false; }), document.querySelectorAll("[data-agh]").forEach(function (x) { if (x !== c) x.checked = false; });
        api("brands?id=eq." + encodeURIComponent(c.dataset.agh), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_house: on }) })
          .then(function () { AG.house[c.dataset.agh] = on; AG.anyHouse = Object.keys(AG.house).some(function (k) { return AG.house[k]; }); decorateLibrary(); },
            function (er) { c.checked = !on; AG.house[c.dataset.agh] = !on; uiToast("No se pudo guardar: " + (er && er.message || "error")); });
      });
  }

  /* ═══ enganches ═══ */
  function whenReady(fn) { if (typeof VIEWS2 !== "undefined" && VIEWS2.ptApr && typeof mx === "function" && typeof route !== "undefined") return fn(); setTimeout(function () { whenReady(fn); }, 120); }
  whenReady(function () {
    var pt = function () { viewPt(P.mode === "member"); };
    ["ptApr", "ptProj", "ptCal", "ptRep", "ptBriefs", "ptFiles"].forEach(function (k) { if (VIEWS2[k]) VIEWS2[k] = pt; });
    if (VIEWS2.clPortal) VIEWS2.clPortal = managerView;
    /* librería de diseños: chips de visibilidad + filtro privado/compartido/Mi negocio */
    if (typeof viewGrid === "function") {
      var _vgp = viewGrid;
      viewGrid = function (key) {
        var r = _vgp.apply(this, arguments);
        if (key === "crear/disenos" && real()) {
          Promise.all([visLoad(), housesLoad()]).then(function () { decorateLibrary(); });
          var bodyEl = document.getElementById("body");
          if (bodyEl) bodyEl.onclick = function (e) {
            var f = e.target.closest("[data-agf]");
            if (f) { AG.filter = f.dataset.agf; decorateLibrary(); return; }
            if (e.target.closest("[data-aghouse]")) return housePopup();
            var tg = e.target.closest("[data-vistags]");
            if (tg) return tagsPopup(tg.dataset.vistags);
            var v = e.target.closest("[data-vistoggle]");
            if (v) return toggleVis(v.dataset.vistoggle);
          };
        }
        return r;
      };
    }
  });

  /* ═══ ruta del manager (#clientes/portal) + arranque del invitado ═══
     Los extras cargan en paralelo con la sesión: cuando whenReady dispara puede que
     real() aún sea false y el intento único se perdía. Esto reintenta hasta que TODO
     existe; cada paso lleva bandera para no duplicarse si vuelve a correr. */
  var RT = { mod: false, wrap: false, boot: false };
  function installRouting() {
    var ok = typeof VIEWS2 !== "undefined" && VIEWS2.ptApr && typeof mx === "function" && typeof route !== "undefined"
      && typeof MODULES !== "undefined" && typeof modById === "function" && typeof ic === "function"
      && typeof go === "function" && typeof drawView === "function" && typeof wsAllows === "function";
    if (!ok) return setTimeout(installRouting, 150);
    try {
      if (VIEWS2.clPortal) VIEWS2.clPortal = managerView;
      if (real()) {
        /* el módulo Clientes se retiró del nav en la migración 23 y su portal quedó
           huérfano: en modo real lo devolvemos SOLO con su portal, para la agencia */
        if (!modById("clientes")) {
          MODULES.splice(MODULES.indexOf(modById("vender")) + 1, 0,
            { id: "clientes", label: "Clientes", action: "Ver portal", desc: "El portal de cada cliente: su información, lo compartido de su marca y sus accesos.",
              icon: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 14h4"/>'),
              subs: [["portal", "Portal del cliente", "clPortal"]] });
        }
        /* CRM en el nav del portal (REQ ManyChat): la maqueta NO se toca — el
           sub se agrega por puente y la vista ptCrm dibuja la sección crm. */
        var pm = modById("portal");
        if (pm && pm.subs && !pm.subs.some(function (x) { return x[0] === "crm"; })) {
          pm.subs.push(["crm", "CRM", "ptCrm"]);
          try { drawNav(); } catch (e) {}
        }
        if (!VIEWS2.ptCrm) VIEWS2.ptCrm = function () { viewPt(P.mode === "member"); };
        RT.mod = true;
        /* go() de la maqueta secuestra #clientes/portal (demo del cliente): lo
           interceptamos antes y dibujamos el manager con la ruta reañadida */
        if (!RT.wrap) {
          RT.wrap = true;
          var canMgr = function () { return location.hash === "#clientes/portal" && VIEWS2.clPortal && wsAllows("clientes"); };
          var drawManager = function () {
            try { if (typeof mxEl !== "undefined" && mxEl && !mxEl.hidden) mxEl.hidden = true; } catch (e) {}
            route = { mod: "clientes", sub: "portal" };
            openMods.add("clientes");
            document.body.classList.remove("open");
            drawNav();
            drawView();
            window.scrollTo(0, 0);
          };
          var _gp = go, _ac = typeof asClient === "function" ? asClient : null;
          go = function () {
            if (canMgr()) return drawManager();
            return _gp.apply(this, arguments);
          };
          /* el listener «hashchange» de la maqueta capturó el go ORIGINAL: la navegación
             por hash sigue entrando por ahí y cae en asClient(CL.portal). Envolver
             asClient cubre el hash, los enlaces del nav y el botón del preview. */
          if (_ac) asClient = function (b) {
            if (canMgr()) return drawManager();
            return _ac.apply(this, arguments);
          };
        }
        /* cliente de portal: aterriza directo en su portal con el rol
           «Cliente · portal» — la única ruta donde la maqueta permite el
           portal. Cubre al invitado sin membresías Y al cliente real (solo es
           dueño de su espacio personal de bootstrap, id ws_user_*); el dueño
           de una agencia invitado a OTRO portal conserva su vista normal. */
        if (!RT.boot) {
          RT.boot = true;
          aget("/api/team/access").then(function (a) {
            a = a || {};
            var g = (a.guestBrands || [])[0], m = (a.workspaces || []).filter(function (w) { return w.role; })[0];
            var rs = document.getElementById("role");
            var soloPersonal = !m || String(m.id || "").indexOf("ws_user_") === 0;
            if (g && soloPersonal && rs && rs.value !== "cliente") { rs.value = "cliente"; if (typeof rs.onchange === "function") rs.onchange(); }
          }, function () {});
        }
      }
    } catch (e) { console.warn("[bridge-portal] routing:", (e && e.message) || e); }
    if (!(RT.mod && RT.wrap && RT.boot)) setTimeout(installRouting, 400);
  }
  installRouting();
})();
