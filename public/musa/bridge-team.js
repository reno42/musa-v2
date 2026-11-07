/* ═══════════════════════════════════════════════════════════════════════════
   bridge-team.js — Tu equipo y tus espacios, con datos reales:
     · Configuración › Equipo: miembros del workspace con rol y fecha, cambio
       de rol y baja (admin), e invitaciones por correo con enlace de 7 días
       (POST /api/workspaces/:id/invitations — el worker envía el mail de
       Supabase o devuelve el enlace para copiar). El plan manda: con base
       (Freelance) la tarjeta muestra el upsell hacia Espacios y planes; en tu
       espacio personal no se invita a nadie: es privado por diseño.
     · Configuración › Espacios y planes: tarjeta «Tus espacios» para renombrar
       el espacio de agencia y el personal (PUT /api/workspaces/:id) y para
       CREAR espacios de agencia nuevos (POST /api/workspaces): una cuenta
       puede tener varios — el personal privado más los de agencia que el plan
       permita; al crear se registra en el selector (WSS + PERSONAS.me.mem +
       wsCard).
   Todo llega por el puente (window.__musaBridge.api) con la sesión del
   usuario; el server vuelve a exigir el rol, así que la UI solo es la mitad
   amable de la cerradura. La maqueta de ejemplo no se toca: sin puente real,
   las vistas demo quedan igual.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  function RB() { return window.__musaReal || null; }
  function bridgeObj() { try { return (window.parent !== window && window.parent.__musaBridge) || null; } catch (e) { return null; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function api(path, init) {
    var b = bridgeObj();
    if (!b || !b.api) return Promise.reject(new Error("sin puente"));
    return b.api(path.charAt(0) === "/" ? path : "/rest/v1/" + path, init);
  }
  function J(method, body) {
    var init = { method: method, headers: { "Content-Type": "application/json" } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return init;
  }

  var R = null;
  function ws() { return (R && R.ws) || ""; }
  function myId() { var b = bridgeObj(); return (b && b.userId) || ""; }
  function myEmail() { var b = bridgeObj(); return String((b && b.userEmail) || "").toLowerCase(); }
  function curWs() { try { return WSS[WSX.cur] || null; } catch (e) { return null; } }
  function planColor(w) { try { return (PLAN[w && w.plan] && PLAN[w.plan][1]) || "#333"; } catch (e) { return "#333"; } }
  function isPersonal() { var w = curWs(); return (w && w.plan === "personal") || /^ws_user_/.test(ws()); }
  function ago(iso) { if (!iso) return "—"; var d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); return d <= 0 ? "hoy" : d === 1 ? "ayer" : "hace " + d + " días"; }
  function roleLb(r) { return { owner: "Dueño", admin: "Admin", editor: "Editor", viewer: "Lectura" }[r] || r || "—"; }
  function invPill(st) { return { pending: ["Pendiente", "warn"], accepted: ["Aceptada", "ok"], declined: ["Rechazada", ""], revoked: ["Anulada", ""], expired: ["Vencida", "danger"] }[st] || [st || "—", ""]; }
  function iniOf(name, email) { var s = String(name || email || "?").trim(); return (s.match(/\b\w/g) || [s.charAt(0) || "?"]).slice(0, 2).join("").toUpperCase(); }

  /* plan de la cuenta — mismo criterio que bridge-account: Agencia, Empresa e
     Ilimitado pueden invitar y crear espacios de agencia; el plan base
     (Freelance) ve el upsell */
  var planTier = null;
  function loadPlan() {
    if (planTier) return;
    var b = bridgeObj();
    if (!b || !b.api) { planTier = "gratis"; return; }
    planTier = "gratis";
    try {
      b.api("/rest/v1/rpc/v2_my_plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
        .then(function (r) {
          planTier = (r && r.tier) || "gratis";
          /* si «Tus espacios» ya estaba pintada sin el formulario (carrera del
             plan), la repone con crear-espacio incluido */
          try {
            if (!canInvite()) return;
            var old = document.querySelector("[data-tmsp]");
            if (old && (location.hash || "").indexOf("configuracion/espacios") >= 0 && !old.querySelector("[data-tmwsnew]")) { old.remove(); paintSpacesCard(); }
          } catch (e) {}
        }, function () {});
    } catch (e) { planTier = "gratis"; }
  }
  function canInvite() { return planTier === "agencia" || planTier === "empresa" || planTier === "ilimitado"; }

  function injectCss() {
    if (document.getElementById("mbTeamCss")) return;
    var st = document.createElement("style");
    st.id = "mbTeamCss";
    st.textContent = [
      ".tm-row{display:flex;align-items:center;gap:10px;padding:9px 2px;border-top:1px solid #242424}",
      ".tm-row:first-of-type{border-top:0}",
      ".tm-dot{width:30px;height:30px;border-radius:50%;flex:none}",
      ".tm-tx{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}",
      ".tm-tx b{color:#e8e8e8;font:600 13px var(--sans);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".tm-tx small{color:#7d7d7d;font:500 11px var(--sans);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".tm-tx .tm-renin{margin:2px 0}",
      ".tm-act{margin-left:auto;display:flex;gap:6px;align-items:center;flex:none}",
      ".tm-form{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:4px}",
      ".tm-form .tm-in{flex:1;min-width:200px;max-width:none}",
      ".tm-in{background:#161616;border:1px solid #333;color:#eee;border-radius:8px;padding:7px 10px;font:600 12.5px var(--sans);width:100%;max-width:340px}",
      ".tm-in:focus{outline:none;border-color:var(--accent)}",
      ".tm-sel{background:#161616;border:1px solid #333;color:#eee;border-radius:8px;padding:6px 8px;font:600 12px var(--sans)}",
      ".tm-role{min-width:106px}",
      ".tm-linkrow{display:flex;gap:6px;margin-top:8px;align-items:center}",
      ".tm-linkrow .tm-in{max-width:none}",
      ".tm-cardbtn{height:28px;padding:0 10px;font-size:11.5px}"
    ].join("\n");
    document.head.appendChild(st);
  }

  /* ── estado del equipo del workspace actual ── */
  var TEAM = { ws: null, loading: false, loaded: false, error: false, members: [], invites: null, myRole: "", seq: 0, pendingLink: null };
  function isAdmin() { return TEAM.myRole === "owner" || TEAM.myRole === "admin"; }

  function loadTeam() {
    var w = ws();
    if (!w) return Promise.resolve();
    if (TEAM.ws === w && (TEAM.loaded || TEAM.loading)) return Promise.resolve();
    TEAM.loading = true; TEAM.ws = w; TEAM.error = false;
    var mySeq = ++TEAM.seq;
    var wid = encodeURIComponent(w);
    return Promise.all([
      api("/api/workspaces/" + wid + "/members"),
      api("/api/workspaces/" + wid + "/invitations").catch(function () { return null; }) /* 403: no eres admin */
    ]).then(function (rs) {
      if (mySeq !== TEAM.seq) return;
      TEAM.loading = false; TEAM.loaded = true;
      TEAM.members = (rs[0] && rs[0].data) || [];
      TEAM.invites = rs[1] ? (rs[1].data || []) : null;
      var me = myId(), em = myEmail();
      TEAM.myRole = "";
      TEAM.members.forEach(function (m) {
        if ((m.id && m.id === me) || (m.email && em && String(m.email).toLowerCase() === em)) TEAM.myRole = m.role || "";
      });
      if (!TEAM.myRole) TEAM.myRole = "viewer";
    }).catch(function () {
      if (mySeq !== TEAM.seq) return;
      TEAM.loading = false; TEAM.loaded = true; TEAM.error = true;
      TEAM.members = []; TEAM.invites = null; TEAM.myRole = "";
    });
  }

  /* ── Configuración › Equipo, con datos reales ── */
  function renderEquipo(target) {
    injectCss();
    target.innerHTML = '<p class="empty-note">Cargando tu equipo…</p>';
    loadTeam().then(function () {
      if ((location.hash || "").indexOf("configuracion/equipo") === -1) return;
      paintEquipo(target);
    });
  }

  function pill(txt, cls) { return '<span class="pill ' + (cls || "") + '">' + esc(txt) + "</span>"; }

  function membersCard() {
    var priv = isPersonal();
    var showAct = isAdmin() && !priv;
    var rows = TEAM.members.map(function (m) {
      var name = m.display_name || (m.email || "").split("@")[0] || "—";
      var self = (m.id && m.id === myId());
      var owner = m.role === "owner";
      var act = "";
      if (showAct && !self && !owner) {
        act = '<div class="tm-act">' +
          '<select class="tm-sel tm-role" data-tmrole="' + esc(m.id) + '">' +
          ["admin", "editor", "viewer"].map(function (r) {
            return '<option value="' + r + '"' + (m.role === r ? " selected" : "") + ">" + roleLb(r) + "</option>";
          }).join("") +
          "</select>" +
          '<button class="btn btn-g tm-cardbtn" data-tmdel="' + esc(m.id) + '">Quitar</button></div>';
      }
      return '<div class="tm-row">' +
        '<i class="tm-dot" style="background:' + (self ? planColor(curWs()) : "#2e2e2e") + '"></i>' +
        '<div class="tm-tx"><b>' + esc(name) + (self ? " (tú)" : "") + "</b><small>" + esc(m.email || "—") + "</small></div>" +
        '<div class="tm-act">' + pill(roleLb(owner ? "owner" : m.role), owner ? "ok" : "") + "<small style=\u0022color:#666;font:500 11px var(--sans)\u0022>" + ago(m.joinedAt) + "</small></div>" +
        act + "</div>";
    }).join("");
    var note = (!isAdmin() && !priv) ? '<p class="empty-note">Solo un admin puede invitar personas o cambiar roles.</p>' : "";
    return '<article class="card"><div class="ch"><h3>Personas en este espacio</h3><small>' +
      (priv ? "Tu espacio personal: solo tú entras aquí." : "Comparten los archivos de este workspace según su rol.") +
      '</small></div><div>' + (rows || '<p class="empty-note">Sin miembros cargados.</p>') + "</div>" + note + "</article>";
  }

  function inviteCard() {
    if (!canInvite()) {
      return '<article class="card"><div class="ch"><h3>Invitar personas</h3></div><div class="mb-upsell"><div><b>Invitar a tu equipo es del plan Agencia</b><small>5 personas, roles de equipo y portal de clientes. Tu espacio personal queda privado, solo tuyo.</small></div><button type="button" class="btn btn-p tm-cardbtn" data-tmplans>Ver planes</button></div></article>';
    }
    return '<article class="card"><div class="ch"><h3>Invitar a tu equipo</h3><small>Llega por correo con un enlace válido por 7 días. Admin gestiona el espacio, Editor crea, Lectura solo ve.</small></div>' +
      '<div class="tm-form"><input class="tm-in" id="tmEm" type="email" placeholder="correo@de-tu-companero.com">' +
      '<select class="tm-sel tm-role" id="tmRl"><option value="editor">Editor</option><option value="viewer">Lectura</option><option value="admin">Admin</option></select>' +
      '<button class="btn btn-p" data-tminv>Enviar invitación</button></div><div id="tmLink"></div></article>';
  }

  function invitesCard() {
    var rows = (TEAM.invites || []).map(function (iv) {
      var st = invPill(iv.status);
      var act = "";
      if (iv.status === "pending") {
        act = '<button class="btn btn-g tm-cardbtn" data-tmresend="' + esc(iv.id) + '">Reenviar</button>' +
              '<button class="btn btn-g tm-cardbtn" data-tmrevoke="' + esc(iv.id) + '">Anular</button>';
      }
      return '<div class="tm-row"><div class="tm-tx"><b>' + esc(iv.email) + '</b><small>' +
        esc(roleLb(iv.role)) + (iv.invitedBy ? " · invitó " + esc(iv.invitedBy) : "") + (iv.createdAt ? " · " + ago(iv.createdAt) : "") +
        '</small></div><div class="tm-act">' + pill(st[0], st[1]) + act + "</div></div>";
    }).join("");
    return '<article class="card"><div class="ch"><h3>Invitaciones</h3><small>Vencen a los 7 días; puedes reenviarlas o anularlas.</small></div><div>' + rows + '</div><div class="tm-invlink"></div></article>';
  }

  function paintEquipo(target) {
    var priv = isPersonal();
    var parts = [];
    if (TEAM.error) parts.push('<div class="ws-note">No pudimos cargar tu equipo. Revisa tu conexión y vuelve a entrar a esta vista.</div>');
    if (priv) parts.push('<div class="ws-note">Este es tu espacio <b>personal</b>: nadie más puede entrar ni ver tus archivos. Para invitar gente, cambia a tu espacio de agencia desde el menú lateral.</div>');
    if (!priv && isAdmin()) parts.push(inviteCard());
    parts.push(membersCard());
    if (!priv && isAdmin() && TEAM.invites && TEAM.invites.length) parts.push(invitesCard());
    target.innerHTML = '<div class="grid">' + parts.join("") + "</div>";
    bindEquipo(target);
    /* el enlace para copiar sobrevive al repintado (llega con la invitación) */
    if (TEAM.pendingLink) {
      var box = target.querySelector("#tmLink") || target.querySelector(".tm-invlink");
      if (box) copyLink(box, TEAM.pendingLink);
    }
  }

  function refetchEquipo(target) {
    TEAM.loaded = false;
    renderEquipo(target);
  }

  function copyLink(box, link) {
    box.innerHTML = '<div class="tm-linkrow"><input class="tm-in" readonly value="' + esc(link) + '"><button class="btn btn-g tm-cardbtn" data-tmcopy>Copiar enlace</button></div>';
  }

  function bindEquipo(target) {
    target.onclick = function (e) {
      var t = e.target;
      var el;
      if ((el = t.closest("[data-tminv]"))) {
        var em = String((document.getElementById("tmEm") || {}).value || "").trim().toLowerCase();
        var rl = String((document.getElementById("tmRl") || {}).value || "editor");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { uiToast("Escribe un correo válido"); return; }
        el.disabled = true; el.textContent = "Enviando…";
        api("/api/workspaces/" + encodeURIComponent(ws()) + "/invitations", J("POST", { email: em, role: rl }))
          .then(function (r) {
            var d = (r && r.data) || {};
            if (d.emailSent) { TEAM.pendingLink = null; uiToast("Invitación enviada a " + em); }
            else {
              TEAM.pendingLink = d.inviteLink || null;
              uiToast((d.warning || "Invitación creada. Comparte el enlace con " + em));
            }
            refetchEquipo(target);
          }, function (x) {
            el.disabled = false; el.textContent = "Enviar invitación";
            uiToast(String((x && x.message) || "No se pudo invitar"));
          });
        return;
      }
      if ((el = t.closest("[data-tmplans]"))) { location.hash = "configuracion/espacios"; return; }
      if ((el = t.closest("[data-tmresend]"))) {
        el.disabled = true;
        api("/api/workspaces/" + encodeURIComponent(ws()) + "/invitations/" + encodeURIComponent(el.getAttribute("data-tmresend")) + "/resend", J("POST", {}))
          .then(function (r) {
            var d = (r && r.data) || {};
            if (d.emailSent) { TEAM.pendingLink = null; uiToast("Invitación reenviada"); }
            else { TEAM.pendingLink = d.inviteLink || TEAM.pendingLink; uiToast(d.warning || "No pudimos enviar el correo; comparte el enlace"); }
            refetchEquipo(target);
          }, function (x) { el.disabled = false; uiToast(String((x && x.message) || "No se pudo reenviar")); });
        return;
      }
      if ((el = t.closest("[data-tmrevoke]"))) {
        if (!confirm("¿Anular esta invitación? El enlace deja de funcionar.")) return;
        api("/api/workspaces/" + encodeURIComponent(ws()) + "/invitations/" + encodeURIComponent(el.getAttribute("data-tmrevoke")), J("DELETE"))
          .then(function () { uiToast("Invitación anulada"); refetchEquipo(target); },
                function (x) { uiToast(String((x && x.message) || "No se pudo anular")); });
        return;
      }
      if ((el = t.closest("[data-tmrole]"))) {
        api("/api/workspaces/" + encodeURIComponent(ws()) + "/members/" + encodeURIComponent(el.getAttribute("data-tmrole")), J("PATCH", { role: el.value }))
          .then(function () { uiToast("Rol actualizado"); refetchEquipo(target); },
                function (x) { uiToast(String((x && x.message) || "No se pudo cambiar el rol")); });
        return;
      }
      if ((el = t.closest("[data-tmdel]"))) {
        if (!confirm("¿Quitar a esta persona del espacio? Conserva sus archivos creados.")) return;
        api("/api/workspaces/" + encodeURIComponent(ws()) + "/members/" + encodeURIComponent(el.getAttribute("data-tmdel")), J("DELETE"))
          .then(function () { uiToast("Persona quitada del espacio"); refetchEquipo(target); },
                function (x) { uiToast(String((x && x.message) || "No se pudo quitar")); });
        return;
      }
      if ((el = t.closest("[data-tmcopy]"))) {
        var inp = el.parentElement && el.parentElement.querySelector(".tm-in");
        var link = inp ? inp.value : "";
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(link).then(function () { uiToast("Enlace copiado"); }, function () { uiToast("Copia manual: el enlace está en la caja"); });
        } else if (inp) { inp.select(); try { document.execCommand("copy"); uiToast("Enlace copiado"); } catch (e2) {} }
      }
    };
  }

  /* ── «Tus espacios»: renombrar agencia y personal desde Espacios y planes ── */
  function spacesMeta(w) {
    if (w.plan === "personal") return "Espacio personal · privado, solo tú";
    try { if (PLAN[w.plan] && PLAN[w.plan][0]) return PLAN[w.plan][0]; } catch (e) {}
    return w.tier ? String(w.tier).charAt(0).toUpperCase() + String(w.tier).slice(1) : "Espacio de trabajo";
  }

  function paintSpacesCard() {
    if (!(RB() && RB().on)) return;
    if ((location.hash || "").indexOf("configuracion/espacios") === -1) return;
    var body = document.getElementById("body");
    if (!body || body.querySelector("[data-tmsp]")) return;
    var ids;
    try { ids = Object.keys(WSS); } catch (e) { return; }
    if (!ids || !ids.length) return;
    injectCss();
    var card = document.createElement("article");
    card.className = "card";
    card.setAttribute("data-tmsp", "");
    card.innerHTML = '<div class="ch"><h3>Tus espacios</h3><small>' +
      (canInvite()
        ? "Renombra tus espacios y crea otros de agencia para equipos nuevos. Tu espacio personal sigue privado, solo tuyo."
        : "Cambia el nombre cuando quieras. Tu espacio personal sigue privado, solo tuyo.") +
      "</small></div>" +
      ids.map(function (id) {
        var w = WSS[id];
        if (!w) return "";
        return '<div class="tm-row" data-wsrow="' + esc(id) + '">' +
          '<i class="tm-dot" style="background:' + planColor(w) + '"></i>' +
          '<div class="tm-tx"><b>' + esc(w.name || id) + "</b><small>" + esc(spacesMeta(w)) + "</small></div>" +
          '<div class="tm-act"><button class="btn btn-g tm-cardbtn" data-wsren="' + esc(id) + '">Renombrar</button></div></div>';
      }).join("") +
      (canInvite()
        ? '<div class="tm-form" style="margin-top:10px"><input class="tm-in" id="tmWsName" maxlength="100" placeholder="Nombre del nuevo espacio de agencia"><button class="btn btn-p" data-tmwsnew>Crear espacio</button></div>'
        : "");
    card.onclick = function (e) {
      var el = e.target.closest("[data-wsren]");
      if (!el) return;
      var id = el.getAttribute("data-wsren");
      var row = card.querySelector('[data-wsrow="' + id + '"]');
      if (!row) return;
      var w = WSS[id] || {};
      var tx = row.querySelector(".tm-tx");
      if (!tx || tx.querySelector(".tm-renin")) return;
      tx.innerHTML = '<input class="tm-in tm-renin" id="tmRenIn" maxlength="100" value="' + esc(w.name || "") + '">';
      el.parentElement.innerHTML = '<button class="btn btn-p tm-cardbtn" data-tmsave="' + esc(id) + '">Guardar</button>' +
        '<button class="btn btn-g tm-cardbtn" data-tmcancel="' + esc(id) + '">Cancelar</button>';
    };
    card.addEventListener("click", function (e) {
      var nw = e.target.closest("[data-tmwsnew]");
      if (nw) {
        var inp = document.getElementById("tmWsName");
        var v = String((inp || {}).value || "").trim();
        if (!v) { uiToast("Ponle un nombre al espacio"); return; }
        nw.disabled = true; nw.textContent = "Creando…";
        api("/api/workspaces", J("POST", { name: v.slice(0, 100) }))
          .then(function (r) {
            var d = (r && r.data) || {};
            if (!d.id) throw new Error((r && r.error) || "el server no devolvió el espacio");
            var corp = R && R.accessPlan === "corporate";
            var name = d.name || v.slice(0, 100);
            try {
              /* misma forma que setupWorkspaces: el selector y el chip la leen
                 de ahí, y al recargar el backfill la reconstruye igual */
              WSS[d.id] = { name: name, ini: iniOf(name), plan: corp ? "corp" : "agencia", tier: corp ? "Corporativo" : "Freelance", desc: "Espacio de trabajo", own: name, brands: [], team: [] };
              PERSONAS.me.mem[d.id] = "Dueño";
            } catch (e2) {}
            try { if (typeof wsCard === "function") wsCard(); } catch (e3) {}
            uiToast("Espacio \"" + name + "\" creado. Invita a tu equipo desde su vista Equipo.");
            card.remove();
            paintSpacesCard();
          }, function (x) {
            nw.disabled = false; nw.textContent = "Crear espacio";
            uiToast(String((x && x.message) || "No se pudo crear el espacio"));
          });
        return;
      }
      var save = e.target.closest("[data-tmsave]");
      var cancel = e.target.closest("[data-tmcancel]");
      if (!save && !cancel) return;
      var id = (save || cancel).getAttribute(save ? "data-tmsave" : "data-tmcancel");
      var v = save ? String((document.getElementById("tmRenIn") || {}).value || "").trim() : "";
      if (save && !v) { uiToast("El nombre no puede quedar vacío"); return; }
      if (save) {
        api("/api/workspaces/" + encodeURIComponent(id), J("PUT", { name: v.slice(0, 100) }))
          .then(function (r) {
            if (r && r.data && r.data.name) { try { WSS[id].name = r.data.name; } catch (e2) {} }
            try { if (typeof wsCard === "function") wsCard(); } catch (e3) {}
            uiToast("Espacio renombrado");
            card.remove();
            paintSpacesCard();
          }, function (x) { uiToast(String((x && x.message) || "No se pudo renombrar")); });
        return;
      }
      card.remove();
      paintSpacesCard();
    });
    body.appendChild(card);
  }

  /* la vista de espacios la pinta bridge-billing (async): un observer vuelve a
     colgar la tarjeta después de cada repintado, sin importar el orden de carga */
  function watchSpaces() {
    var deb = null;
    new MutationObserver(function () {
      if ((location.hash || "").indexOf("configuracion/espacios") === -1) return;
      if (deb) return;
      deb = setTimeout(function () { deb = null; try { paintSpacesCard(); } catch (e) {} }, 150);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  function boot(tries) {
    R = RB();
    if (R && R.on && typeof viewTable === "function" && typeof viewSpaces === "function" && typeof uiToast === "function") {
      injectCss();
      loadPlan();
      /* Configuración › Equipo: la maqueta cae en viewTable(key) — la envolvemos
         y esa ruta pinta el equipo real; el resto de tablas quedan igual. */
      var _vt = viewTable;
      viewTable = function (key, title, target) {
        if (key === "configuracion/equipo" && RB() && RB().on) {
          renderEquipo(target || document.getElementById("body"));
          return;
        }
        return _vt.apply(this, arguments);
      };
      /* Espacios y planes: billing envuelve viewSpaces; sea cual sea la cadena
         instalada al momento, colgamos «Tus espacios» después de cada repintado. */
      var _vs = viewSpaces;
      viewSpaces = function () {
        var r = _vs.apply(this, arguments);
        try { paintSpacesCard(); } catch (e) {}
        return r;
      };
      watchSpaces();
      return;
    }
    if ((tries || 0) > 100) return; /* demo sin puente real: la maqueta queda igual */
    setTimeout(function () { boot((tries || 0) + 1); }, 100);
  }
  boot();
})();
