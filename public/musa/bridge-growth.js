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
    try { if (RB() && RB().on && route.mod === "configuracion" && route.sub === "cuenta") cards(); } catch (e) {}
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
    if (!ref) api("/api/account/referral/summary").then(function (r) { ref = (r && r.data) || {}; renderCards(box); }, function () { ref = {}; renderCards(box); });
  }
  function renderCards(box) {
    var link = ref && ref.referral_code ? origin() + "/?ref=" + encodeURIComponent(ref.referral_code) : null;
    var h = '<article class="card c12"><div class="ch"><h3>Invita y gana</h3><small>Por cada persona que se registre con tu enlace y acepte los términos sumas 30 días de Musa (hasta 1 año)</small></div>'
      + (ref == null ? '<p class="empty-note">Cargando…</p>' : link
        ? '<div class="fx-row" style="grid-template-columns:1fr auto;align-items:end"><div><label class="fx-lbl">Tu enlace</label><input class="fx-in" readonly value="' + esc(link) + '"></div><div class="ag-ctl"><button class="pri" data-gr="copy">Copiar enlace</button><button data-gr="code">Copiar código ' + esc(ref.referral_code) + "</button></div></div>"
          + '<div class="fx-row r3" style="margin-top:12px">' + [["Se registraron", ref.invitedCount || 0], ["Cuentan", ref.creditedCount || 0], ["Días ganados", ref.daysEarned || 0]].map(function (x) { return '<div><label class="fx-lbl">' + x[0] + '</label><b style="font:800 24px/1 var(--sans)">' + x[1] + "</b></div>"; }).join("") + "</div>"
          + (ref.referred_by ? "" : '<div class="fx-row" style="grid-template-columns:1fr auto;align-items:end;margin-top:12px"><div><label class="fx-lbl">¿Te invitó alguien? Escribe su código</label><input class="fx-in" id="grRedeem" placeholder="Ej. RENZO420"></div><div class="ag-ctl"><button data-gr="redeem">Canjear</button></div></div>')
        : '<p class="empty-note">Tu código se crea al completar tu perfil.</p>') + "</article>";
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
})();
