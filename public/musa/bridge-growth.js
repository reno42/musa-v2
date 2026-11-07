/* bridge-growth.js — lanzamientos por módulo y referidos.
 * · Lanzamientos: platform_config.launch dice qué módulos ve la gente. Los admins de la plataforma ven todo
 *   (para preparar el próximo lanzamiento) y los encienden desde Configuración › Cuenta.
 * · Referidos: cada cuenta tiene su código y enlace (?ref=CODIGO); se ve cuántos se registraron y cuántos cuentan.
 */
(function () {
  function RB() { return window.__musaReal; }
  function bridge() { try { return window.parent !== window && window.parent.__musaBridge; } catch (e) { return null; } }
  function api(path, init) { var b = bridge(); if (!b) return Promise.reject(new Error("sin puente")); return b.api(path, init); }
  function J(m, b) { return { method: m, headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function origin() { try { return window.parent.location.origin; } catch (e) { return location.origin; } }
  var L = { cfg: null, subs0: null };

  /* ───────── lanzamientos ───────── */
  function loadLaunch() {
    return api("/rest/v1/rpc/v2_launch_config", J("POST", {})).then(function (c) { L.cfg = c || {}; applySubs(); return L.cfg; }, function () { L.cfg = {}; return L.cfg; });
  }
  function launched(id) {
    var c = L.cfg; if (!c || c.is_admin || !Array.isArray(c.modules)) return true;
    return c.modules.indexOf(id) >= 0;
  }
  function applySubs() {
    if (typeof MODULES === "undefined") return;
    if (!L.subs0) { L.subs0 = {}; MODULES.forEach(function (m) { L.subs0[m.id] = m.subs.slice(); }); }
    var hide = (L.cfg && !L.cfg.is_admin && Array.isArray(L.cfg.hidden_subs)) ? L.cfg.hidden_subs : [];
    MODULES.forEach(function (m) { if (L.subs0[m.id]) m.subs = L.subs0[m.id].filter(function (s) { return hide.indexOf(m.id + "/" + s[0]) < 0; }); });
  }
  if (typeof wsAllows === "function") {
    var _wa = wsAllows;
    wsAllows = function (id) { return _wa.apply(this, arguments) && (!RB() || !RB().on || launched(id)); };
  }
  var _dv = drawView;
  drawView = function () {
    if (RB() && RB().on && L.cfg && route && !launched(route.mod) && route.mod !== "inicio") { location.hash = "inicio/resumen"; return; }
    var r = _dv.apply(this, arguments);
    try { if (RB() && RB().on && route.mod === "configuracion" && route.sub === "cuenta") cards(); if (RB() && RB().on && route.mod === "configuracion" && route.sub === "espacios") planCards(); } catch (e) {}
    return r;
  };
  (function boot(n) { if (RB() && RB().on) { loadLaunch().then(function () { try { if (typeof drawNav === "function") drawNav(); } catch (e) {} go(); }); return; } if (n < 120) setTimeout(function () { boot(n + 1); }, 250); })(0);

  /* ───────── tarjetas en Configuración › Cuenta ───────── */
  var ref = null;
  function cards() {
    var body = document.getElementById("body"); if (!body || document.getElementById("mbGrowth")) return;
    var box = document.createElement("div"); box.id = "mbGrowth"; box.className = "grid"; box.style.marginTop = "14px";
    body.appendChild(box);
    renderCards(box);
    if (!ref) Promise.all([api("/api/account/referral/summary"), api("/api/billing/me").catch(function () { return {}; })]).then(function (r) { ref = (r[0] && r[0].data) || {}; ref.billing = (r[1] && r[1].referral) || {}; renderCards(box); }, function () { ref = {}; renderCards(box); });
  }
  function renderCards(box) {
    var link = ref && ref.referral_code ? origin() + "/?ref=" + encodeURIComponent(ref.referral_code) : null;
    var h = '<article class="card c12"><div class="ch"><h3>Invita y gana</h3><small>Quien llega con tu código tiene 4 meses de oferta. Cuando paga su 2.º mes ganas medio mes; con 2 medios, tu siguiente mes es gratis.</small></div>'
      + (ref == null ? '<p class="empty-note">Cargando…</p>' : link
        ? '<div class="fx-row" style="grid-template-columns:1fr auto;align-items:end"><div><label class="fx-lbl">Tu enlace</label><input class="fx-in" readonly value="' + esc(link) + '"></div><div class="ag-ctl"><button class="pri" data-gr="copy">Copiar enlace</button><button data-gr="code">Copiar código ' + esc(ref.referral_code) + "</button></div></div>"
          + '<div class="fx-row r3" style="margin-top:12px">' + [["Se registraron", ref.invitedCount || 0], ["Medios meses guardados", (ref.billing || {}).half_months || 0], ["Meses gratis usados", (ref.billing || {}).months_used || 0]].map(function (x) { return '<div><label class="fx-lbl">' + x[0] + '</label><b style="font:800 24px/1 var(--sans)">' + x[1] + "</b></div>"; }).join("") + "</div>"
          + (ref.referred_by ? "" : '<div class="fx-row" style="grid-template-columns:1fr auto;align-items:end;margin-top:12px"><div><label class="fx-lbl">¿Te invitó alguien? Escribe su código</label><input class="fx-in" id="grRedeem" placeholder="Ej. RENZO420"></div><div class="ag-ctl"><button data-gr="redeem">Canjear</button></div></div>')
        : '<p class="empty-note">Tu código se crea al completar tu perfil.</p>')
      + "</article>";
    var c = L.cfg;
    if (c && c.is_admin && typeof MODULES !== "undefined") {
      var on = Array.isArray(c.modules) ? c.modules : [], hid = Array.isArray(c.hidden_subs) ? c.hidden_subs : [];
      h += '<article class="card c12"><div class="ch"><h3>Lanzamientos de módulos</h3><small>Solo lo ves tú (admin). Lo apagado no aparece para los usuarios; tú sigues viendo todo para preparar el próximo lanzamiento.</small></div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px">' + MODULES.map(function (m) {
          return '<div style="border:1.5px solid #d6d4c6;border-radius:12px;padding:10px"><label style="display:flex;gap:8px;align-items:center;font-weight:800"><input type="checkbox" data-lm="' + m.id + '"' + (on.indexOf(m.id) >= 0 ? " checked" : "") + ' style="accent-color:var(--accent)">' + esc(m.label) + "</label>"
            + (L.subs0 && L.subs0[m.id] || m.subs).map(function (s) { var k = m.id + "/" + s[0]; return '<label style="display:flex;gap:6px;align-items:center;font-size:12px;margin:4px 0 0 22px;color:#555"><input type="checkbox" data-ls="' + k + '"' + (hid.indexOf(k) < 0 ? " checked" : "") + ">" + esc(s[1]) + "</label>"; }).join("") + "</div>";
        }).join("") + '</div><div class="ag-ctl" style="margin-top:12px"><button class="pri" data-gr="launch">Guardar lanzamientos</button><button data-gr="design">Solo Diseño (lanzamiento 1)</button><button data-gr="all">Todo encendido</button></div></article>';
    }
    box.innerHTML = h;
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-gr]"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var k = b.dataset.gr, link = ref && ref.referral_code ? origin() + "/?ref=" + encodeURIComponent(ref.referral_code) : "";
    var copy = function (t, m) { try { navigator.clipboard.writeText(t); } catch (x) {} uiToast(m); };
    if (k === "copy") return copy(link, "Enlace copiado");
    if (k === "code") return copy(ref.referral_code, "Código copiado");
    if (k === "redeem") {
      var code = (document.getElementById("grRedeem") || {}).value || "";
      return api("/api/account/referral/redeem", J("POST", { code: code.trim() })).then(function () { uiToast("Código canjeado"); ref = null; var box = document.getElementById("mbGrowth"); if (box) box.remove(); cards(); }, function (x) { var m = String(x && x.message); uiToast(/NOT_FOUND/.test(m) ? "Ese código no existe" : /ALREADY/.test(m) ? "Ya tienes un código canjeado" : /SELF/.test(m) ? "No puedes usar tu propio código" : /FORMAT/.test(m) ? "Revisa el formato del código" : "No se pudo canjear: " + m); });
    }
    if (k === "design" || k === "all") {
      document.querySelectorAll("[data-lm]").forEach(function (x) { x.checked = k === "all" || ["inicio", "crear", "configuracion"].indexOf(x.dataset.lm) >= 0; });
      document.querySelectorAll("[data-ls]").forEach(function (x) { var s = x.dataset.ls; x.checked = k === "all" || ["inicio/resumen", "inicio/mi-trabajo", "crear/marcas", "crear/disenos"].indexOf(s) >= 0 || s.indexOf("configuracion/") === 0; });
      return uiToast("Marcado: revisa y pulsa «Guardar lanzamientos»");
    }
    if (k === "launch") {
      var mods = [].filter.call(document.querySelectorAll("[data-lm]"), function (x) { return x.checked; }).map(function (x) { return x.dataset.lm; });
      var hid = [].filter.call(document.querySelectorAll("[data-ls]"), function (x) { return !x.checked; }).map(function (x) { return x.dataset.ls; });
      if (mods.indexOf("configuracion") < 0) mods.push("configuracion");
      if (!confirm("¿Publicar estos módulos para todos los usuarios? (" + mods.length + " módulos)")) return;
      b.disabled = true;
      api("/rest/v1/rpc/v2_set_launch", J("POST", { p_modules: mods, p_hidden_subs: hid })).then(function () { uiToast("Lanzamientos guardados: los usuarios ven el cambio al recargar"); return loadLaunch(); }).then(function () { b.disabled = false; }, function (x) { b.disabled = false; uiToast("No se pudo guardar: " + (x && x.message)); });
    }
  }, true);

  /* ───────── Tu plan (Creem): plan, uso, créditos, anual, personas extra, paquetes ───────── */
  var B = null;
  var fmt = function (x) { return Number(x || 0).toLocaleString("en-US", { maximumFractionDigits: 1 }); };
  // Freelance es el nombre del plan base (pedido del dueño, 2026-11-05): gratis,
  // acceso anticipado y Creador se muestran como Freelance; Agencia y Empresa igual.
  var TIER = { creador: "Freelance", agencia: "Agencia", empresa: "Empresa", gratis: "Freelance (plan base)", ilimitado: "Freelance (acceso completo)" };
  function adminRpc(action, p) { return api("/rest/v1/rpc/v2_billing_admin", J("POST", { p_action: action, p: p || {} })); }
  function planCards() {
    var body = document.getElementById("body"); if (!body || document.getElementById("mbPlans")) return;
    var box = document.createElement("div"); box.id = "mbPlans"; box.className = "grid"; box.style.marginBottom = "14px";
    body.insertBefore(box, body.firstChild);
    box.innerHTML = '<article class="card c12"><p class="empty-note">Cargando planes…</p></article>';
    Promise.all([
      api("/api/billing/plans").catch(function () { return { plans: [] }; }),
      api("/api/billing/me").catch(function () { return { subscriptions: [] }; }),
      api("/rest/v1/rpc/v2_my_plan", J("POST", {})).catch(function () { return null; }),
      L.cfg && L.cfg.is_admin ? adminRpc("get").catch(function () { return null; }) : null,
    ]).then(function (r) { B = { plans: (r[0].plans || []).filter(function (p) { return p.purchasable; }), configured: r[0].configured, me: r[1] || {}, use: r[2] || {}, admin: r[3] }; renderPlans(box); });
  }
  function bar(label, used, lim, remaining) {
    var pct = lim == null ? 0 : Math.min(100, Math.round((used / Math.max(lim, 1)) * 100));
    var warn = remaining ? pct <= 10 : pct >= 90;
    return '<div><label class="fx-lbl">' + label + '</label><b style="font:800 20px/1 var(--sans)">' + fmt(used) + (lim == null ? "" : " / " + fmt(lim)) + "</b>"
      + (lim == null ? '<small style="display:block;color:#777;margin-top:4px">Sin límite</small>' : '<div style="height:6px;border-radius:9px;background:#e4e2d6;margin-top:6px"><div style="height:6px;border-radius:9px;width:' + pct + "%;background:" + (warn ? "#d33" : "var(--accent)") + '"></div></div>') + "</div>";
  }
  function renderPlans(box) {
    var subs = B.me.subscriptions || [], u = B.use || {}, cr = u.credits || {};
    var act = subs.find(function (s) { return /active|trialing|past_due/.test(s.status) && (s.billing_plans || {}).kind === "plan"; });
    var seats = subs.filter(function (s) { return /active|trialing|past_due/.test(s.status) && (s.billing_plans || {}).kind === "seat"; });
    var ap = act && act.billing_plans || {};
    var per = function (i) { return i === "year" ? "año" : i === "once" ? "pago único" : "mes"; };
    // ── tu plan
    var h = '<article class="card c12"><div class="ch"><h3>Tu plan</h3><small>' + (act
      ? esc(ap.name || act.plan_code) + " · " + (ap.interval === "year" ? "anual" : "mensual") + " · " + esc(act.status) + (act.current_period_end ? " · se renueva el " + new Date(act.current_period_end).toLocaleDateString() : "")
      : esc(TIER[u.tier] || "Sin plan")) + "</small></div>";
    if (act && act.intro && ap.intro_price_usd != null && (act.paid_count || 0) <= (ap.intro_months || 3)) h += '<p style="margin:0 0 8px">Estás en la oferta: <b>US$ ' + fmt(ap.intro_price_usd) + " / mes</b> hasta el mes " + (ap.intro_months || 3) + ". Luego US$ " + fmt(ap.price_usd) + " / mes.</p>";
    if (act && act.founder) h += '<p style="margin:0 0 8px"><b>Precio fundador:</b> tu precio queda congelado para siempre.</p>';
    if (B.me.annual_offer) h += '<div style="border:1.5px solid var(--accent);border-radius:12px;padding:12px;margin:8px 0;display:flex;gap:12px;align-items:center;flex-wrap:wrap"><div style="flex:1;min-width:220px"><b>Pásate a anual y llévate 2 meses gratis</b><br><small>US$ ' + fmt(B.me.annual_offer.price_usd) + " al año (US$ " + fmt(Math.round(B.me.annual_offer.price_usd / 12)) + ' / mes). Se cobra la diferencia prorrateada.</small></div><div class="ag-ctl"><button class="pri" data-bi="up" data-p="' + esc(B.me.annual_offer.code) + '">Pasar a anual</button></div></div>';
    h += '<div class="ag-ctl">' + (act ? '<button data-bi="portal">Facturas, tarjeta o cancelar</button>' : "") + "</div>";
    // ── uso
    var credTotal = (cr.plan || 0) + (cr.pack || 0);
    var cp = act && B.plans.find(function (p) { return p.code === act.plan_code; });
    var inIntro = act && act.intro && cp && cp.intro_credits != null && (act.paid_count || 0) <= (cp.intro_months || 3);
    var monthCap = cp ? (inIntro ? cp.intro_credits : cp.credits_month) * (act.founder && (act.paid_count || 0) <= 3 ? 2 : 1) : (cr.monthly || 0);
    h += '<div class="fx-row r3" style="margin-top:14px;grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">'
      + bar("Créditos de IA" + (monthCap ? " (este mes)" : ""), credTotal, monthCap ? Math.max(monthCap + (cr.pack || 0), credTotal) : null, true).replace("Sin límite", cr.team != null ? "Usas los créditos de tu equipo: " + fmt(cr.team) : "Compra un paquete o usa tus llaves")
      + bar("Marcas", u.brands_used || 0, u.brands) + bar("Personas", u.seats_used || 1, u.seats) + bar("Correos con Musa este mes", u.emails_used || 0, u.emails) + "</div>";
    if (cr.next_refill) h += '<small style="color:#777">Tus créditos del plan se recargan el ' + new Date(cr.next_refill).toLocaleDateString() + ". Los de paquetes no vencen.</small>";
    h += "</article>";
    // ── personas extra (Agencia / Empresa)
    if (act && (ap.segment === "agencia" || ap.segment === "empresa")) {
      var sp = B.plans.find(function (p) { return p.kind === "seat" && (p.mode === "musa_ia") === (ap.mode === "musa_ia") && p.interval === ap.interval; });
      if (sp) h += '<article class="card c6"><div class="ch"><h3>Personas extra</h3><small>US$ ' + fmt(sp.price_usd) + " por persona / " + per(sp.interval) + (sp.credits_month ? " · +" + fmt(sp.credits_month) + " créditos al mes cada una" : "") + (seats.length ? " · tienes " + seats.reduce(function (a, s) { return a + (s.units || 1); }, 0) + " extra" : "") + '</small></div><div class="fx-row" style="grid-template-columns:120px auto;align-items:end"><div><label class="fx-lbl">Cuántas</label><input class="fx-in" id="biSeats" type="number" min="1" max="50" value="1"></div><div class="ag-ctl"><button class="pri" data-bi="seat" data-p="' + esc(sp.code) + '">Agregar personas</button></div></div></article>';
    }
    // ── paquetes de créditos
    var packs = B.plans.filter(function (p) { return p.kind === "pack"; });
    if (packs.length && B.configured) h += '<article class="card c6"><div class="ch"><h3>Más créditos de IA</h3><small>No vencen. 1 crédito = 1 imagen o unas 100 respuestas de texto.</small></div><div class="ag-ctl">' + packs.map(function (p) { return '<button data-bi="buy" data-p="' + esc(p.code) + '">' + fmt(p.pack_credits) + " créditos · US$ " + fmt(p.price_usd) + "</button>"; }).join("") + "</div></article>";
    // ── planes
    var plans = B.plans.filter(function (p) { return p.kind === "plan"; });
    if (plans.length && B.configured) {
      h += '<article class="card c12"><div class="ch"><h3>' + (act ? "Cambiar de plan" : "Elige tu plan") + "</h3><small>" + (act ? "El cambio se cobra prorrateado." : "Cuentas nuevas: 3 meses de oferta en los planes mensuales.") + '</small></div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px">'
        + plans.map(function (p) {
          var cur = act && act.plan_code === p.code, intro = !act && p.interval === "month" && p.intro_price_usd != null;
          return '<div style="border:1.5px solid ' + (cur ? "var(--accent)" : "#d6d4c6") + ';border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:4px"><small style="font-weight:800;color:var(--accent);text-transform:uppercase;letter-spacing:.06em">' + (p.mode === "musa_ia" ? "Con IA de Musa" : "Tus llaves (BYOK)") + " · " + (p.interval === "year" ? "Anual" : "Mensual") + "</small><b>" + esc(p.name) + "</b>"
            + '<span style="font:800 20px/1.1 var(--sans)">US$ ' + fmt(intro ? p.intro_price_usd : p.price_usd) + '<small style="font-size:12px;color:#777"> / ' + per(p.interval) + "</small></span>"
            + (intro ? '<small style="color:#777">' + "los primeros " + (p.intro_months || 3) + " meses · luego US$ " + fmt(p.price_usd) + " / mes</small>" : "")
            + '<small style="color:#555">' + (p.seats === 1 ? "1 persona" : p.seats + " personas") + " · " + (p.brands == null ? "Marcas ilimitadas" : p.brands + " marcas") + " · " + fmt(p.credits_month) + " créditos</small>"
            + '<div class="ag-ctl" style="margin-top:auto">' + (cur ? "<button disabled>Tu plan actual</button>" : '<button class="pri" data-bi="' + (act ? "up" : "buy") + '" data-p="' + esc(p.code) + '">' + (act ? "Cambiar a este plan" : "Elegir") + "</button>") + "</div></div>";
        }).join("") + "</div>"
        + (act ? "" : '<div class="fx-row" style="grid-template-columns:1fr;margin-top:12px"><div><label class="fx-lbl">Código de referido o de descuento (opcional)</label><input class="fx-in" id="biDisc" placeholder="Ej. RENZO420"></div></div>') + "</article>";
    }
    // ── admin
    var A = B.admin;
    if (A) {
      var cf = A.config || {};
      h += '<article class="card c12"><div class="ch"><h3>Cobro y códigos de acceso</h3><small>Solo lo ves tú (admin). Con el cobro encendido, las cuentas nuevas sin plan ni código ven la pantalla de planes. Las cuentas que ya existían conservan su acceso.</small></div>'
        + '<label style="display:flex;gap:8px;align-items:center;font-weight:800"><input type="checkbox" id="biPaywall"' + (cf.paywall ? " checked" : "") + ' style="accent-color:var(--accent)"> Cobro encendido (pedir plan para entrar)</label>'
        + '<div class="fx-row" style="grid-template-columns:220px auto;align-items:end;margin-top:10px"><div><label class="fx-lbl">Precio fundador hasta</label><input class="fx-in" id="biFounder" type="date" value="' + esc(cf.founder_until || "") + '"></div><div class="ag-ctl"><button class="pri" data-bi="cfg">Guardar</button></div></div>'
        + '<h5 style="margin:14px 0 6px">Códigos de acceso gratis</h5><table style="width:100%;font-size:13px;border-collapse:collapse"><tr style="text-align:left;color:#777"><th>Código</th><th>Nota</th><th>Usos</th><th>Vence</th><th>Activo</th></tr>'
        + (A.codes || []).map(function (c) { return '<tr style="border-top:1px solid #e4e2d6"><td><b>' + esc(c.code) + "</b></td><td>" + esc(c.note || "") + "</td><td>" + c.uses + (c.max_uses ? " / " + c.max_uses : "") + "</td><td>" + (c.expires_at ? new Date(c.expires_at).toLocaleDateString() : "—") + '</td><td><input type="checkbox" data-bc="' + esc(c.code) + '"' + (c.active ? " checked" : "") + "></td></tr>"; }).join("")
        + '</table><div class="fx-row r3" style="margin-top:10px;align-items:end"><div><label class="fx-lbl">Nuevo código</label><input class="fx-in" id="bcCode" placeholder="Ej. LANZAMIENTO"></div><div><label class="fx-lbl">Usos máximos (vacío = sin límite)</label><input class="fx-in" id="bcMax" type="number" min="1"></div><div><label class="fx-lbl">Nota</label><input class="fx-in" id="bcNote"></div></div><div class="ag-ctl" style="margin-top:8px"><button class="pri" data-bi="code">Crear código</button></div></article>';
    }
    box.innerHTML = h;
  }
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-bc]");
    if (t) { adminRpc("code_upsert", (B.admin.codes || []).filter(function (c) { return c.code === t.dataset.bc; }).map(function (c) { return { code: c.code, note: c.note, max_uses: c.max_uses, expires_at: c.expires_at, active: t.checked }; })[0]).then(function (a) { B.admin = a; uiToast(t.checked ? "Código activado" : "Código desactivado"); }, function (x) { uiToast(String(x && x.message)); }); return; }
    var b = e.target.closest && e.target.closest("[data-bi]"); if (!b) return;
    e.preventDefault(); e.stopPropagation(); b.disabled = true;
    var box = document.getElementById("mbPlans");
    var reload = function () { if (box) box.remove(); planCards(); };
    var go2 = function (r) { if (r && r.url) { try { window.top.location.href = r.url; } catch (x) { location.href = r.url; } } else { b.disabled = false; uiToast("Creem no devolvió el enlace de pago"); } };
    var fail = function (x) { b.disabled = false; uiToast(String(x && x.message || x)); };
    var k = b.dataset.bi;
    if (k === "cfg") {
      var pw = document.getElementById("biPaywall").checked;
      if (pw && !(B.admin.config || {}).paywall && !confirm("¿Encender el cobro? Las cuentas nuevas sin plan ni código de acceso no podrán entrar.")) { b.disabled = false; return; }
      return adminRpc("config", { paywall: pw, founder_until: document.getElementById("biFounder").value || null }).then(function () { uiToast("Guardado"); reload(); }, fail);
    }
    if (k === "code") {
      var code = (document.getElementById("bcCode").value || "").trim().toUpperCase().replace(/\s/g, "");
      if (!/^[A-Z0-9_-]{3,40}$/.test(code)) { b.disabled = false; return uiToast("Usa de 3 a 40 letras, números, - o _"); }
      return adminRpc("code_upsert", { code: code, max_uses: document.getElementById("bcMax").value || "", note: document.getElementById("bcNote").value || null, active: true }).then(function () { uiToast("Código creado"); reload(); }, fail);
    }
    if (k === "buy") return api("/api/billing/checkout", J("POST", { planCode: b.dataset.p, workspaceId: RB().ws, discountCode: ((document.getElementById("biDisc") || {}).value || "").trim() || undefined })).then(go2, fail);
    if (k === "seat") return api("/api/billing/checkout", J("POST", { planCode: b.dataset.p, units: Number((document.getElementById("biSeats") || {}).value || 1), workspaceId: RB().ws })).then(go2, fail);
    if (k === "up") { if (!confirm("¿Cambiar tu plan? Se cobra la diferencia prorrateada.")) { b.disabled = false; return; } return api("/api/billing/upgrade", J("POST", { planCode: b.dataset.p })).then(function () { uiToast("Plan cambiado"); reload(); }, fail); }
    if (k === "portal") return api("/api/billing/portal", J("POST", {})).then(go2, fail);
    b.disabled = false;
  }, true);
})();
