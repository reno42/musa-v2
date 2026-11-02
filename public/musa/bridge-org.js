/* bridge-org.js — Organización (planes corporativos) con datos reales: áreas, aprobaciones y agencias
 * (tablas workspace_areas / workspace_approvals / workspace_agencies). Misma UI de la maqueta.
 */
(function () {
  function RR() { return window.__musaReal; }
  function bridge() { try { return window.parent !== window && window.parent.__musaBridge; } catch (e) { return null; } }
  function api(path, init) { var b = bridge(); if (!b) return Promise.reject(new Error("sin puente")); return b.api(path.charAt(0) === "/" ? path : "/rest/v1/" + path, init); }
  function get(p) { return api(p).catch(function () { return []; }).then(function (r) { return r || []; }); }
  function send(method, table, body, id) { return api(table + (id ? "?id=eq." + encodeURIComponent(id) : ""), { method: method, headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(body) }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function uid() { var b = bridge(); return b && b.userId; }
  function ws() { return RR().ws; }
  function real() { return RR() && RR().on; }
  var D = { ws: null, areas: [], apv: [], ags: [], sel: null };
  var CHECKS = ["Logo y márgenes", "Colores de la guía", "Tipografía", "Tono de voz", "Claims legales"];
  function canDecide() { var r = (typeof PERSONAS !== "undefined" && PERSONAS.me && PERSONAS.me.mem && PERSONAS.me.mem[ws()]) || ""; return /Dueño|Admin/.test(r); }
  function load(force) {
    if (!force && D.ws === ws()) return Promise.resolve();
    D.ws = ws(); var q = function (t, s, x) { return t + "?workspace_id=eq." + encodeURIComponent(D.ws) + "&select=" + s + (x || ""); };
    return Promise.all([get(q("workspace_areas", "id,name,description,lead_name,lead_user_id,member_count,validates,brand_ids", "&order=created_at.asc")), get(q("workspace_approvals", "id,piece_id,piece_name,piece_type,brand_name,requested_by,status,requested_at,decided_at,area_id,checks,comment", "&order=requested_at.desc&limit=200")), get(q("workspace_agencies", "id,name,contact_email,area_ids,sla_hours,access_note,member_count", "&order=created_at.asc"))])
      .then(function (r) { D.areas = r[0]; D.apv = r[1]; D.ags = r[2]; });
  }
  function areaName(id) { var a = D.areas.find(function (x) { return x.id === id; }); return a ? a.name : "Sin área"; }
  function thumb(p, size) { var t = (RR().thumb || {})[p.piece_id]; return t ? '<img src="' + esc(t) + '" alt="" style="max-width:' + size + 'px;max-height:' + size + 'px;border-radius:8px;display:block">' : '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:8px;background:#333;display:grid;place-items:center;color:#999;font-size:11px">Sin vista</div>'; }

  function areas() {
    var pend = function (id) { return D.apv.filter(function (p) { return p.area_id === id && p.status === "pendiente"; }).length; };
    var agsOf = function (id) { return D.ags.filter(function (g) { return (g.area_ids || []).indexOf(id) >= 0; }).map(function (g) { return g.name; }).join(", "); };
    $("#body").innerHTML = '<div class="org-grid">' + D.areas.map(function (a) {
      return '<div class="org-a ' + (a.validates ? "mk" : "") + '"><span class="ag-tag ' + (a.validates ? "k" : "") + '" style="align-self:flex-start">' + (a.validates ? "Valida" : "Área") + "</span><b>" + esc(a.name) + "</b><small>" + esc(a.description || "") + "</small>"
        + [["Líder", a.lead_name || (a.lead_user_id && RR().people[a.lead_user_id]) || "—"], ["Marcas", (a.brand_ids || []).map(function (b) { return RR().brandName[b]; }).filter(Boolean).join(", ") || "Todas"], ["Personas", a.member_count || 0], ["Por aprobar", pend(a.id)], ["Agencias", agsOf(a.id) || "Ninguna · produce con plantillas"]].map(function (r) { return '<div class="row"><span>' + r[0] + "</span><b>" + esc(r[1]) + "</b></div>"; }).join("")
        + '<div class="ag-ctl" style="margin-top:8px"><button data-org="editArea" data-id="' + a.id + '">Editar</button></div></div>';
    }).join("") + '<div class="ag-new" style="min-height:200px" data-org="newArea"><span><b>+ Nueva área</b>Marketing, RR. HH., Producto… Cada área produce lo suyo y Marketing valida.</span></div></div>';
  }
  function apr() {
    var sel = D.apv.find(function (p) { return p.id === D.sel; }) || D.apv[0], stP = { pendiente: "warn", aprobado: "ok", cambios: "danger" }, stL = { pendiente: "Pendiente", aprobado: "Aprobado", cambios: "Cambios pedidos" }, dec = canDecide();
    $("#body").innerHTML = '<div class="apv"><div>' + D.apv.map(function (p) { return '<button class="apv-it ' + (sel && sel.id === p.id ? "on" : "") + '" data-org="sel" data-id="' + p.id + '"><span class="th">' + thumb(p, 70) + "</span><span><b>" + esc(p.piece_name || "Pieza") + "</b><small>" + esc(areaName(p.area_id)) + " · " + esc(p.requested_by || "—") + '</small></span><span class="pill ' + stP[p.status] + '">' + stL[p.status] + "</span></button>"; }).join("")
      + '<div class="ag-new" style="min-height:90px;margin-top:8px" data-org="newApv"><span><b>+ Enviar pieza a aprobación</b>Elige un diseño y el área que la pide</span></div></div>'
      + (sel ? '<div class="ag-box"><h3>' + esc(sel.piece_name || "Pieza") + '</h3><div style="display:grid;place-items:center;background:#222;border-radius:12px;padding:12px;margin-bottom:12px">' + thumb(sel, 300) + "</div>"
        + '<p style="font-size:11px;color:#777;margin-bottom:6px">Revisión contra la guía de marca' + (dec ? " (marca cada punto)" : "") + ":</p>"
        + (sel.checks && sel.checks.length ? sel.checks : CHECKS.map(function (l) { return [l, null]; })).map(function (c, i) { return '<div class="apv-chk" ' + (dec ? 'data-org="chk" data-i="' + i + '" style="cursor:pointer"' : "") + '><i style="background:' + (c[1] === 1 ? "#22a35a" : c[1] === 0 ? "#d7261e" : "#999") + '">' + (c[1] === 1 ? "✓" : c[1] === 0 ? "!" : "·") + "</i>" + esc(c[0]) + "</div>"; }).join("")
        + '<textarea id="orgCm" placeholder="Comentario para ' + esc(sel.requested_by || "quien la envió") + '…" ' + (dec ? "" : "disabled") + ">" + esc(sel.comment || "") + "</textarea>"
        + '<div class="ag-ctl" style="margin-top:10px">' + (dec ? '<button class="pri" data-org="dec" data-v="aprobado">Aprobar</button><button data-org="dec" data-v="cambios">Pedir cambios</button>' : '<button disabled style="opacity:.5">Solo Dueño o Admin aprueba</button><button data-org="dec" data-v="pendiente">Reenviar con correcciones</button>') + "</div></div>"
        : '<div class="ag-box"><p class="empty-note">Todavía no hay piezas en aprobación.</p></div>') + "</div>";
  }
  function agencies() {
    $("#body").innerHTML = '<div class="org-grid">' + D.ags.map(function (g) {
      return '<div class="org-a"><div style="display:flex;align-items:center;gap:10px"><span class="ag-av" style="background:#ff5e00;--st:#22a35a">' + esc((g.name || "?")[0]) + "</span><b>" + esc(g.name) + "</b></div><small>" + esc(g.access_note || "Ve briefs y assets de sus áreas · entrega por Aprobaciones") + "</small>"
        + [["Áreas", (g.area_ids || []).map(areaName).join(", ") || "—"], ["Contacto", g.contact_email || "—"], ["Tiempo de respuesta", (g.sla_hours || 48) + " h"], ["En revisión", D.apv.filter(function (p) { return p.status === "pendiente" && new RegExp(g.name, "i").test(p.requested_by || ""); }).length]].map(function (r) { return '<div class="row"><span>' + r[0] + "</span><b>" + esc(r[1]) + "</b></div>"; }).join("")
        + '<div class="ag-ctl" style="margin-top:8px"><button data-org="editAg" data-id="' + g.id + '">Editar</button></div></div>';
    }).join("") + '<div class="ag-new" style="min-height:200px" data-org="newAg"><span><b>+ Invitar agencia</b>Le das acceso solo a las áreas que elijas; entrega por Aprobaciones.</span></div></div>';
  }

  function areaForm(a) {
    a = a || {};
    var bs = Object.keys(RR().brandName || {}).map(function (id) { return '<button type="button" class="ag-tag' + ((a.brand_ids || []).indexOf(id) >= 0 ? " k" : "") + '" data-v="' + id + '">' + esc(RR().brandName[id]) + "</button>"; }).join("");
    var ppl = Object.keys(RR().people || {}).map(function (id) { return '<option value="' + id + '"' + (id === a.lead_user_id ? " selected" : "") + ">" + esc(RR().people[id]) + "</option>"; }).join("");
    mx(a.id ? "Editar área" : "Nueva área", "Un área produce sus piezas con las plantillas de marca; las que validan (como Marketing) aprueban lo que sale.",
      '<div class="fx-row"><div><label class="fx-lbl">Nombre *</label><input class="fx-in" id="oaN" value="' + esc(a.name || "") + '" placeholder="Ej.: Recursos humanos"></div><div><label class="fx-lbl">Líder</label><select class="fx-in" id="oaL"><option value="">— elige —</option>' + ppl + "</select></div></div>"
      + '<div class="fx-row"><div><label class="fx-lbl">Personas en el área</label><input class="fx-in" type="number" id="oaP" value="' + (a.member_count || 0) + '"></div><div><label class="fx-lbl">Rol</label><select class="fx-in" id="oaV"><option value="0">Produce</option><option value="1"' + (a.validates ? " selected" : "") + ">Valida (aprueba lo que sale)</option></select></div></div>"
      + '<label class="fx-lbl">Qué hace</label><textarea class="fx-in" id="oaD" rows="2">' + esc(a.description || "") + "</textarea>"
      + '<label class="fx-lbl">Marcas que usa (ninguna = todas)</label><div class="ag-tags" id="oaB">' + bs + "</div>"
      + '<p class="mbc-err" style="color:#d33;font-size:12px;font-weight:700;margin:10px 0 0;min-height:1em"></p><div class="ag-ctl" style="margin-top:8px"><button class="pri" data-a="save">' + (a.id ? "Guardar" : "Crear área") + "</button>" + (a.id ? '<button data-a="del">Eliminar</button>' : "") + "</div>",
      function (e) {
        var t = e.target.closest(".ag-tag"); if (t) return t.classList.toggle("k");
        var b = e.target.closest("[data-a]"); if (!b) return;
        if (b.dataset.a === "del") { if (!confirm("¿Eliminar el área «" + a.name + "»?")) return; return send("DELETE", "workspace_areas", undefined, a.id).then(done); }
        var n = document.getElementById("oaN").value.trim(); if (!n) return (mxEl.querySelector(".mbc-err").textContent = "Falta el nombre");
        var lead = document.getElementById("oaL").value;
        var body = { name: n, description: document.getElementById("oaD").value.trim() || null, lead_user_id: lead || null, lead_name: lead ? RR().people[lead] : null, member_count: +document.getElementById("oaP").value || 0, validates: document.getElementById("oaV").value === "1", brand_ids: [].map.call(document.querySelectorAll("#oaB .ag-tag.k"), function (x) { return x.dataset.v; }) };
        b.disabled = true;
        (a.id ? send("PATCH", "workspace_areas", body, a.id) : send("POST", "workspace_areas", Object.assign({ workspace_id: ws(), created_by: uid() }, body))).then(done, function (x) { b.disabled = false; mxEl.querySelector(".mbc-err").textContent = "No se pudo guardar: " + (x && x.message); });
      });
  }
  function agForm(g) {
    g = g || {};
    var as = D.areas.map(function (a) { return '<button type="button" class="ag-tag' + ((g.area_ids || []).indexOf(a.id) >= 0 ? " k" : "") + '" data-v="' + a.id + '">' + esc(a.name) + "</button>"; }).join("") || '<small style="color:#888">Primero crea áreas en Organización › Áreas</small>';
    mx(g.id ? "Editar agencia" : "Invitar agencia", "La agencia trabaja solo con las áreas que elijas y entrega sus piezas por Aprobaciones.",
      '<div class="fx-row"><div><label class="fx-lbl">Agencia *</label><input class="fx-in" id="ogN" value="' + esc(g.name || "") + '"></div><div><label class="fx-lbl">Correo de contacto</label><input class="fx-in" type="email" id="ogE" value="' + esc(g.contact_email || "") + '"></div></div>'
      + '<div class="fx-row"><div><label class="fx-lbl">Tiempo de respuesta (horas)</label><input class="fx-in" type="number" id="ogS" value="' + (g.sla_hours || 48) + '"></div><div><label class="fx-lbl">Qué puede ver</label><input class="fx-in" id="ogA" value="' + esc(g.access_note || "Briefs y assets de sus áreas · no ve presupuesto") + '"></div></div>'
      + '<label class="fx-lbl">Áreas *</label><div class="ag-tags" id="ogR">' + as + "</div>"
      + '<p class="mbc-err" style="color:#d33;font-size:12px;font-weight:700;margin:10px 0 0;min-height:1em"></p><div class="ag-ctl" style="margin-top:8px"><button class="pri" data-a="save">' + (g.id ? "Guardar" : "Invitar") + "</button>" + (g.id ? '<button data-a="del">Quitar agencia</button>' : "") + "</div>",
      function (e) {
        var t = e.target.closest(".ag-tag"); if (t) return t.classList.toggle("k");
        var b = e.target.closest("[data-a]"); if (!b) return;
        if (b.dataset.a === "del") { if (!confirm("¿Quitar a «" + g.name + "»?")) return; return send("DELETE", "workspace_agencies", undefined, g.id).then(done); }
        var n = document.getElementById("ogN").value.trim(), em = document.getElementById("ogE").value.trim(), ar = [].map.call(document.querySelectorAll("#ogR .ag-tag.k"), function (x) { return x.dataset.v; }), err = mxEl.querySelector(".mbc-err");
        if (!n) return (err.textContent = "Falta el nombre"); if (!ar.length) return (err.textContent = "Elige al menos un área"); if (em && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return (err.textContent = "Revisa el correo");
        var body = { name: n, contact_email: em || null, area_ids: ar, sla_hours: +document.getElementById("ogS").value || 48, access_note: document.getElementById("ogA").value.trim() || null };
        b.disabled = true;
        (g.id ? send("PATCH", "workspace_agencies", body, g.id) : send("POST", "workspace_agencies", Object.assign({ workspace_id: ws(), created_by: uid() }, body))).then(done, function (x) { b.disabled = false; err.textContent = "No se pudo guardar: " + (x && x.message); });
      });
  }
  function apvForm() {
    var tpls = (RR().tpl || []).map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.name || "Diseño") + "</option>"; }).join("");
    var ar = D.areas.map(function (a) { return '<option value="' + a.id + '">' + esc(a.name) + "</option>"; }).join("");
    mx("Enviar pieza a aprobación", "Quien valida (Dueño o Admin) la revisa contra la guía de marca, la aprueba o pide cambios.",
      '<div class="fx-row"><div><label class="fx-lbl">Diseño *</label><select class="fx-in" id="opT">' + (tpls || '<option value="">No hay diseños</option>') + '</select></div><div><label class="fx-lbl">Área</label><select class="fx-in" id="opA"><option value="">Sin área</option>' + ar + "</select></div></div>"
      + '<label class="fx-lbl">Quién la envía</label><input class="fx-in" id="opB" value="' + esc(RR().me || "") + '"><p class="mbc-err" style="color:#d33;font-size:12px;font-weight:700;margin:10px 0 0;min-height:1em"></p><div class="ag-ctl" style="margin-top:8px"><button class="pri" data-a="save">Enviar a aprobación</button></div>',
      function (e) {
        var b = e.target.closest('[data-a="save"]'); if (!b) return;
        var tid = document.getElementById("opT").value; if (!tid) return (mxEl.querySelector(".mbc-err").textContent = "Elige un diseño");
        var t = (RR().tpl || []).find(function (x) { return x.id === tid; }) || {};
        b.disabled = true;
        send("POST", "workspace_approvals", { workspace_id: ws(), piece_id: tid, piece_type: "template", piece_name: t.name || "Diseño", brand_name: (RR().brandName || {})[t.brandId] || null, area_id: document.getElementById("opA").value || null, requested_by: document.getElementById("opB").value.trim() || null, status: "pendiente", checks: CHECKS.map(function (l) { return [l, null]; }), created_by: uid() }).then(function (r) { D.sel = r && r[0] && r[0].id; done(); }, function (x) { b.disabled = false; mxEl.querySelector(".mbc-err").textContent = "No se pudo enviar: " + (x && x.message); });
      });
  }
  function done() { mxEl.hidden = true; uiToast("Guardado"); load(true).then(redraw); }
  function redraw() { if (route.mod !== "organizacion") return; if (route.sub === "areas") areas(); else if (route.sub === "aprobaciones") apr(); else if (route.sub === "agencias") agencies(); }

  function wrap(orig, fn) { return function () { if (!real()) return orig.apply(this, arguments); $("#body").innerHTML = '<p class="empty-note">Cargando…</p>'; load().then(fn); }; }
  if (typeof viewOrgAreas === "function") viewOrgAreas = wrap(viewOrgAreas, areas);
  if (typeof viewOrgApr === "function") viewOrgApr = wrap(viewOrgApr, apr);
  if (typeof viewOrgAg === "function") viewOrgAg = wrap(viewOrgAg, agencies);

  document.addEventListener("click", function (e) {
    if (!real() || route.mod !== "organizacion" || !e.target.closest) return;
    var h = e.target.closest(".head .actions .btn-p");
    var b = h ? { dataset: { org: route.sub === "agencias" ? "newAg" : route.sub === "aprobaciones" ? "newApv" : "newArea" } } : e.target.closest("[data-org]");
    if (!b) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    var k = b.dataset.org, id = b.dataset.id;
    if (k === "newArea") return areaForm();
    if (k === "editArea") return areaForm(D.areas.find(function (a) { return a.id === id; }));
    if (k === "newAg") return agForm();
    if (k === "editAg") return agForm(D.ags.find(function (g) { return g.id === id; }));
    if (k === "newApv") return apvForm();
    if (k === "sel") { D.sel = id; return apr(); }
    var sel = D.apv.find(function (p) { return p.id === D.sel; }) || D.apv[0]; if (!sel) return;
    if (k === "chk") { var cs = (sel.checks && sel.checks.length ? sel.checks : CHECKS.map(function (l) { return [l, null]; })).map(function (c) { return c.slice(); }), i = +b.dataset.i; cs[i][1] = cs[i][1] === 1 ? 0 : cs[i][1] === 0 ? null : 1; sel.checks = cs; apr(); return send("PATCH", "workspace_approvals", { checks: cs }, sel.id); }
    if (k === "dec") {
      var v = b.dataset.v, cm = (document.getElementById("orgCm") || {}).value || null;
      send("PATCH", "workspace_approvals", { status: v, comment: cm, decided_at: v === "pendiente" ? null : new Date().toISOString(), decided_by: v === "pendiente" ? null : uid() }, sel.id).then(function () { uiToast(v === "aprobado" ? "Aprobado" : v === "cambios" ? "Cambios pedidos" : "Reenviado"); load(true).then(apr); });
    }
  }, true);
  var _dv = drawView;
  drawView = function () { var r = _dv.apply(this, arguments); try { if (real() && route.mod === "organizacion") { var a = document.querySelector(".head .actions .btn-p"); if (a) a.textContent = route.sub === "agencias" ? "Invitar agencia" : route.sub === "aprobaciones" ? "Enviar a aprobación" : "Nueva área"; } } catch (x) {} return r; };
})();
