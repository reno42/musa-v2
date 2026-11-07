/* bridge-clients.js — ficha «Acceso de cliente» en el detalle del contacto (CRM, modo real).
 * La ficha del CRM es la cara de la AGENCIA; desde aquí crea, resetea, edita la información
 * visible y revoca el acceso del cliente a su intranet (brand_guests) sin salir del contacto.
 * El cliente SOLO ve la proyección allowlist (brand_guests.profile): nombre, cargo, empresa
 * y teléfono. El perfilado comercial del CRM (etiquetas, notas, deals) jamás viaja a él.
 * Cargador: "bridge-clients.js" en el array "extras" de bridge.js.
 */
(function () {
  function RB() { return window.__musaReal; }
  function bridge() { try { return window.parent !== window && window.parent.__musaBridge; } catch (e) { return null; } }
  function api(path, init) { var b = bridge(); if (!b) return Promise.reject(new Error("sin puente")); return b.api(path.charAt(0) === "/" ? path : "/rest/v1/" + path, init); }
  function J(m, b) { return { method: m, headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&quot;" }[c]; }); }
  function real() { return RB() && RB().on; }
  function ws() { return RB().ws; }
  function aget(p) { return api(p).then(function (r) { if (r && r.success === false) throw new Error(r.error || "sin acceso"); return r && r.data !== undefined ? r.data : r; }); }
  function apost(p, m, b) { return api(p, J(m, b)).then(function (r) { if (r && r.success === false) throw new Error(r.error || "no se pudo guardar"); return r && r.data !== undefined ? r.data : r; }); }
  function who(c) { return c ? ((c.first_name || "") + " " + (c.last_name || "")).trim() || c.email || "—" : "—"; }

  function contactByName(name) {
    var n = String(name || "").trim().toLowerCase();
    return (((RB() || {}).contacts) || []).find(function (c) { return who(c).toLowerCase() === n; }) || null;
  }

  /* credenciales show-once: se muestran UNA vez y se entregan al cliente */
  function credsModal(d) {
    if (typeof mx !== "function") return;
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

  function cardHtml(guest, brands, contact) {
    var st = !guest ? "sin" : guest.status === "activo" ? "on" : "off";
    var prof = (guest && guest.profile) || {};
    var head = st === "on" ? '<span class="pill" style="background:var(--ok-bg);color:var(--ok)">acceso activo</span>'
      : st === "off" ? '<span class="pill">revocado</span>' : '<span class="pill">sin acceso</span>';
    var actions = st === "on"
      ? '<button class="pri" data-cl="reset">Resetear contraseña</button><button data-cl="edit">Su información visible</button><button data-cl="revoke">Revocar</button>'
      : '<button class="pri" data-cl="give">' + (st === "off" ? "Reactivar acceso" : "Crear acceso") + "</button>";
    var brandOpts = (brands || []).map(function (b) {
      var bid = (guest && guest.brand_id) || contact.brand_id;
      return '<option value="' + esc(b.id) + '"' + (b.id === bid ? " selected" : "") + ">" + esc(b.name) + "</option>";
    }).join("");
    return '<label class="fx-lbl" style="margin-top:16px;display:block">Acceso de cliente · intranet de su marca</label> ' + head +
      '<div id="clAcc" data-clcard="1" data-clstate="' + st + '" data-clguest="' + esc((guest && guest.id) || "") + '" data-clbrand="' + esc((guest && guest.brand_id) || contact.brand_id || "") + '" style="border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--panel-2)">' +
      '<p style="margin:0 0 8px;color:var(--muted);font-size:12px">' + esc(contact.email) +
      (guest ? " · invitado " + esc(guest.status) + " · desde " + esc(String(guest.created_at || "").slice(0, 10)) : " · todavía no puede entrar a su portal") + "</p>" +
      '<div class="ag-ctl">' + actions + "</div>" +
      '<div data-clform hidden style="margin-top:10px">' +
      (st === "sin" ? '<label class="fx-lbl">Marca del cliente</label><select class="fx-in" data-clb>' + brandOpts + "</select>" : "") +
      '<label class="fx-lbl">Lo que él ve de sí en su portal (opcional)</label>' +
      '<input class="fx-in" data-cln placeholder="Nombre" maxlength="80" value="' + esc(prof.display_name || who(contact)) + '">' +
      '<input class="fx-in" data-clt placeholder="Cargo" maxlength="80" value="' + esc(prof.title || (contact.job_title || "")) + '">' +
      '<input class="fx-in" data-clc placeholder="Empresa" maxlength="80" value="' + esc(prof.company || (contact.company || "")) + '">' +
      '<input class="fx-in" data-clp placeholder="Teléfono" maxlength="30" value="' + esc(prof.phone || (contact.phone || "")) + '">' +
      '<p class="int-note" style="margin:6px 0 0">Esto es lo ÚNICO que el cliente ve de sí. Su perfil comercial del CRM (etiquetas, notas, deals) nunca viaja al cliente.</p>' +
      '<div class="ag-ctl" style="margin-top:8px"><button class="pri" data-cl="go">' + (st === "sin" || st === "off" ? "Crear y mostrar credenciales" : "Guardar") + '</button> <button data-cl="cancel">Cancelar</button></div></div></div>';
  }

  function fetchCardParts() {
    var W = encodeURIComponent(ws());
    return Promise.all([
      aget("/api/team/guests?workspaceId=" + W).catch(function () { return []; }),
      api("brands?workspace_id=eq." + W + "&select=id,name&order=name.asc").then(function (r) { return (r && r.data !== undefined ? r.data : r) || []; }).catch(function () { return []; })
    ]);
  }

  function mount(contact) {
    var dt = document.querySelector("#body .dt");
    if (!dt || dt.querySelector("#clAcc")) return;
    fetchCardParts().then(function (r) {
      var mail = String(contact.email || "").toLowerCase();
      var mine = (r[0] || []).filter(function (g) { return String(g.email || "").toLowerCase() === mail; });
      var guest = mine.find(function (g) { return g.status === "activo"; }) || mine[0] || null;
      var cur = document.querySelector("#body .dt");
      if (!cur) return;
      /* si dos mounts corrieron en carrera, el insert doble duplicaba la tarjeta */
      cur.querySelectorAll("[data-clcard]").forEach(function (x) { x.remove(); });
      cur.insertAdjacentHTML("beforeend", cardHtml(guest, r[1], contact));
      bind(contact);
    }, function () {});
  }

  function bind(contact) {
    var box = document.querySelector("#body .dt #clAcc");
    if (!box) return;
    box.addEventListener("click", function (e) {
      var b = e.target.closest("[data-cl]");
      if (!b) return;
      var k = b.dataset.cl, gid = box.dataset.clguest || "";
      var form = box.querySelector("[data-clform]");
      var read = function (suf) { var el = box.querySelector("[data-cl" + suf + "]"); return el ? el.value.trim() : ""; };
      if (k === "cancel") return form.hidden = true;
      if (k === "give" || k === "edit") return form.hidden = false;
      b.disabled = true;
      var un = function () { b.disabled = false; };
      if (k === "go") {
        var st = box.dataset.clstate;
        if (st === "sin" || st === "off") {
          var sel = box.querySelector("[data-clb]");
          var brandId = (sel && sel.value) || box.dataset.clbrand || "";
          return apost("/api/team/guests/provision", "POST", { workspaceId: ws(), brandId: brandId, email: contact.email, name: read("n"), title: read("t"), company: read("c"), phone: read("p") })
            .then(function (d) { un(); credsModal(d); remount(contact); }, function (er) { un(); uiToast(er.message || "No se pudo crear el acceso"); });
        }
        return apost("/api/team/guests/" + encodeURIComponent(gid) + "/profile", "PUT", { displayName: read("n"), title: read("t"), company: read("c"), phone: read("p") })
          .then(function () { un(); uiToast("Su información visible se actualizó"); remount(contact); }, function (er) { un(); uiToast(er.message || "No se pudo guardar"); });
      }
      if (k === "reset") {
        return apost("/api/team/guests/" + encodeURIComponent(gid) + "/reset-password", "POST", { workspaceId: ws() })
          .then(function (d) { un(); credsModal(d); }, function (er) { un(); uiToast(er.message || "No se pudo resetear"); });
      }
      if (k === "revoke") {
        return apost("/api/team/guests/" + encodeURIComponent(gid), "DELETE", { workspaceId: ws() })
          .then(function () { un(); uiToast("Acceso revocado: el cliente ya no entra a su portal"); remount(contact); }, function (er) { un(); uiToast(er.message || "No se pudo revocar"); });
      }
    });
  }

  function remount(contact) {
    var old = document.querySelector("#body .dt #clAcc");
    if (old) old.remove();
    if (document.querySelector("#body .dt")) mount(contact);
  }

  function inject(name) {
    if (!real()) return;
    var contact = contactByName(name);
    if (!contact || !contact.email) return;
    mount(contact);
  }

  function whenReady(fn) {
    if (typeof personDetail === "function" && typeof uiToast === "function") return fn();
    setTimeout(function () { whenReady(fn); }, 120);
  }
  whenReady(function () {
    var _pd = personDetail;
    personDetail = function (name) {
      var r = _pd.apply(this, arguments);
      try { inject(name); } catch (e) { /* la ficha CRM nunca se rompe por la tarjeta */ }
      return r;
    };
  });
})();
