/* bridge-ads.js — Meta, TikTok, LinkedIn y Google Ads conectados de verdad (BYOK por usuario).
 * Integraciones: credencial cifrada + cuentas publicitarias por espacio (y marca).
 * Anunciar / Medir: campañas sincronizadas con gasto, impresiones, clics y conversiones; pausar y reactivar.
 * Nueva campaña: además de planificarla en Musa, se puede crear en Meta o TikTok (queda pausada).
 */
(function () {
  function RB() { return window.__musaReal; }
  function bridge() { try { return window.parent !== window && window.parent.__musaBridge; } catch (e) { return null; } }
  function api(path, init) { var b = bridge(); if (!b) return Promise.reject(new Error("sin puente")); return b.api(path, init); }
  function J(m, b) { return { method: m, headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function real() { return RB() && RB().on; }
  function ws() { return RB().ws; }
  function errText(e) { return String(e && (e.message || e.error) || e || "error"); }

  var NETS = {
    "meta-ads": { n: "meta", net: "meta", name: "Meta Ads", fields: [["accessToken", "Access token (usuario del sistema o de larga duración, con ads_management y ads_read)", "password"]], help: "En Meta Business › Usuarios del sistema genera un token con permisos ads_management y ads_read." },
    "tiktok-ads": { n: "tiktok", net: "tt", name: "TikTok Ads", fields: [["accessToken", "Access token de TikTok for Business (Marketing API)", "password"]], help: "En TikTok for Business › Developers crea una app de Marketing API y autorízala para tu cuenta: te da el access token. El Advertiser ID está en tu administrador de anuncios.", manual: true },
    "linkedin-ads": { n: "linkedin", net: "li", name: "LinkedIn Ads", fields: [["accessToken", "Access token con r_ads, rw_ads y r_ads_reporting", "password"]], help: "En LinkedIn Developers crea una app con acceso a Advertising API y genera un token con r_ads, rw_ads y r_ads_reporting." },
    "google-ads": { n: "google", net: "gg", name: "Google Ads", fields: [["developerToken", "Developer token (Centro de API de Google Ads)", "password"], ["clientId", "OAuth client ID", "text"], ["clientSecret", "OAuth client secret", "password"], ["refreshToken", "Refresh token (scope adwords)", "password"], ["loginCustomerId", "ID de la cuenta administradora (MCC), si usas una", "text"]], help: "Necesitas un developer token aprobado, un cliente OAuth de Google Cloud y un refresh token con el permiso adwords (por ejemplo con el OAuth Playground)." },
  };
  var BY_N = {}; Object.keys(NETS).forEach(function (k) { BY_N[NETS[k].n] = k; });
  var S = { ws: null, accounts: [], ext: [], keys: {}, found: {} };

  function load(force) {
    if (!force && S.ws === ws()) return Promise.resolve();
    var W = ws();
    return Promise.all([
      api("/api/ads/accounts?workspaceId=" + encodeURIComponent(W)).catch(function () { return { accounts: [] }; }),
      api("/rest/v1/ad_campaigns_ext?workspace_id=eq." + encodeURIComponent(W) + "&select=id,network,external_id,name,status,objective,daily_budget,currency,spend,impressions,clicks,conversions,reach,date_from,date_to,campaign_id,brand_id,synced_at&order=spend.desc&limit=500").catch(function () { return []; }),
      api("/api/keys").catch(function () { return {}; }),
    ]).then(function (r) { S.ws = W; S.accounts = r[0].accounts || []; S.ext = r[1] || []; S.keys = r[2] || {}; merge(); });
  }
  /* campañas de las plataformas dentro de Anunciar y Medir */
  function merge() {
    if (typeof ADS === "undefined") return;
    for (var i = ADS.length - 1; i >= 0; i--) if (ADS[i]._ext) ADS.splice(i, 1);
    var NET = { meta: "meta", tiktok: "tt", linkedin: "li", google: "gg" };
    S.ext.forEach(function (x) {
      var musa = x.campaign_id && ADS.find(function (a) { return a.db === x.campaign_id; });
      var start = x.date_from ? new Date(x.date_from).getTime() : Date.now(), end = x.date_to ? new Date(x.date_to).getTime() : Date.now();
      var m = { spend: Number(x.spend) || 0, impr: Number(x.impressions) || 0, clicks: Number(x.clicks) || 0, res: Number(x.conversions) || 0, resLbl: "conversiones" };
      if (musa) { Object.assign(musa, m); musa.extId = x.id; musa.status = x.status === "active" ? "Activa" : "Pausada"; return; }
      ADS.push(Object.assign({ id: "x_" + x.id, _ext: true, extId: x.id, name: x.name || "Campaña", brand: (x.brand_id && RB().brandName[x.brand_id]) || "—", net: NET[x.network] || "meta", obj: x.objective || "—", status: x.status === "active" ? "Activa" : "Pausada", budget: Number(x.daily_budget) || 0, start: start, end: end, rev: 0, aud: "", crea: 0 }, m));
    });
  }

  /* ───────── Integraciones ───────── */
  function cardState() {
    if (typeof INTS === "undefined") return;
    Object.keys(NETS).forEach(function (id) {
      var i = INTS.find(function (x) { return x.id === id; }); if (!i) return;
      var accs = S.accounts.filter(function (a) { return a.network === NETS[id].n; }), key = S.keys[id] && S.keys[id].configured;
      i.st = accs.length ? (accs.some(function (a) { return a.last_error; }) ? "warn" : "ok") : "off";
      i.account = accs.length ? accs.map(function (a) { return a.account_name || a.account_id; }).join(", ") : null; i.key = key ? "••••" : null;
      delete i.accounts;
    });
  }
  function adsBox(id) {
    var N = NETS[id], key = S.keys[id] && S.keys[id].configured, accs = S.accounts.filter(function (a) { return a.network === N.n; }), found = S.found[id];
    var brands = Object.keys(RB().brandName || {}).map(function (b) { return '<option value="' + b + '">' + esc(RB().brandName[b]) + "</option>"; }).join("");
    var h = "<h5>Tu credencial</h5>";
    h += key ? '<div class="int-acc"><span><b>Credencial vinculada</b><small>Cifrada en el servidor · solo tu cuenta la usa</small></span><span class="pill ok">Lista</span></div><div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn-g" data-adx="unkey">Desvincular credencial</button></div>'
      : '<div class="pz-grid">' + N.fields.map(function (f) { return '<label style="grid-column:1/-1">' + esc(f[1]) + '<input data-adf="' + f[0] + '" type="' + f[2] + '" autocomplete="off"></label>'; }).join("") + '</div><div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn-p" data-adx="key">Vincular a mi cuenta</button></div><p class="int-note">' + esc(N.help) + "</p>";
    h += "<h5>Cuentas publicitarias de este espacio</h5>" + (accs.map(function (a) { return '<div class="int-acc"><span><b>' + esc(a.account_name || a.account_id) + "</b><small>" + esc(a.account_id) + (a.brand_id ? " · " + esc(RB().brandName[a.brand_id] || "") : "") + " · " + (a.last_error ? "⚠ " + esc(a.last_error) : a.last_synced_at ? "sincronizada " + new Date(a.last_synced_at).toLocaleString("es-PE") : "sin sincronizar") + '</small></span><button class="btn btn-g" data-adx="del" data-id="' + a.id + '">Quitar</button></div>'; }).join("") || '<p class="int-note">Todavía no conectas ninguna cuenta.</p>');
    if (key) {
      if (N.manual) h += '<div class="pz-grid" style="margin-top:8px"><label>Advertiser ID<input id="adMan" placeholder="Ej.: 7123456789012345678"></label><label>Nombre<input id="adManN" placeholder="Cuenta de la marca"></label><label style="grid-column:1/-1">Marca<select id="adManB"><option value="">Todas / sin marca</option>' + brands + '</select></label></div><div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn-p" data-adx="addman">Conectar cuenta</button></div>';
      else h += '<div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-g" data-adx="find">Buscar mis cuentas</button>' + (accs.length ? '<button class="btn btn-p" data-adx="sync">Sincronizar campañas</button>' : "") + "</div>"
        + (found ? (found.length ? found.map(function (a, k) { var on = accs.some(function (x) { return x.account_id === String(a.id); }); return '<div class="int-acc"><span><b>' + esc(a.name) + "</b><small>" + esc(a.id) + (a.currency ? " · " + esc(a.currency) : "") + (a.active === false ? " · inactiva" : "") + "</small></span>" + (on ? '<span class="pill ok">Conectada</span>' : '<select data-adb="' + k + '" style="height:30px;border-radius:8px;margin-right:6px"><option value="">Sin marca</option>' + brands + '</select><button class="btn btn-g" data-adx="add" data-k="' + k + '">Conectar</button>') + "</div>"; }).join("") : '<p class="int-note">Tu credencial no ve cuentas publicitarias.</p>') : "");
      if (N.manual && accs.length) h += '<div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn-p" data-adx="sync">Sincronizar campañas</button></div>';
    }
    return '<div class="mb-ads" style="margin-top:14px">' + h + '<p class="int-note" id="adNote" style="margin-top:8px"></p></div>';
  }
  if (typeof intDetail === "function") {
    var _id = intDetail;
    intDetail = function (i) {
      if (!real() || !i || !NETS[i.id]) return _id.apply(this, arguments);
      var h = _id.call(this, Object.assign({}, i, { st: "off", accounts: null, social: null }));
      h = h.replace(/<h5>Vincular<\/h5>[\s\S]*<\/aside>\s*$/, adsBox(i.id) + "</aside>");
      if (!/mb-ads/.test(h)) h = h.replace(/<\/aside>\s*$/, adsBox(i.id) + "</aside>");
      if (S.ws !== ws()) load().then(function () { if (INT.open === i.id) viewIntegrations(); });
      return h;
    };
  }
  if (typeof viewIntegrations === "function") {
    var _vi = viewIntegrations;
    viewIntegrations = function () { if (real()) { if (S.ws !== ws()) load().then(function () { if (route.sub === "integraciones") { cardState(); _vi(); } }); cardState(); } return _vi.apply(this, arguments); };
  }
  function note(t, err) { var n = document.getElementById("adNote"); if (n) { n.textContent = t; n.style.color = err ? "#d33" : ""; } }
  document.addEventListener("click", function (e) {
    if (!real() || typeof INT === "undefined" || !e.target.closest) return;
    var b = e.target.closest("[data-adx]"); if (!b || !NETS[INT.open]) return;
    e.stopPropagation(); e.preventDefault();
    var id = INT.open, N = NETS[id], a = b.dataset.adx;
    var busy = function (p) { b.disabled = true; return p.then(function (x) { b.disabled = false; return x; }, function (x) { b.disabled = false; note(errText(x), true); return new Promise(function () {}); }); };
    if (a === "key") {
      var c = {}, miss = null;
      document.querySelectorAll("[data-adf]").forEach(function (f) { var v = f.value.trim(); if (v) c[f.dataset.adf] = v; else if (f.dataset.adf !== "loginCustomerId" && !miss) miss = f; });
      if (miss) { miss.focus(); return note("Completa todos los campos", true); }
      return busy(api("/api/keys/" + id, J("PUT", { key: JSON.stringify(c) }))).then(function () { return load(true); }).then(function () { uiToast(N.name + ": credencial vinculada"); viewIntegrations(); });
    }
    if (a === "unkey") { if (!confirm("¿Desvincular tu credencial de " + N.name + "? Las cuentas que conectaste dejarán de sincronizar.")) return; return busy(api("/api/keys/" + id, { method: "DELETE" })).then(function () { return load(true); }).then(viewIntegrations); }
    if (a === "find") { note("Buscando…"); return busy(api("/api/ads/discover", J("POST", { network: N.n }))).then(function (r) { S.found[id] = r.accounts || []; viewIntegrations(); }); }
    if (a === "add" || a === "addman") {
      var acc = a === "add" ? S.found[id][+b.dataset.k] : { id: (document.getElementById("adMan") || {}).value, name: (document.getElementById("adManN") || {}).value };
      if (!acc || !String(acc.id || "").trim()) return note("Escribe el ID de la cuenta", true);
      var br = a === "add" ? (document.querySelector('[data-adb="' + b.dataset.k + '"]') || {}).value : (document.getElementById("adManB") || {}).value;
      note("Verificando que tu credencial ve esa cuenta…");
      return busy(api("/api/ads/accounts", J("POST", { workspaceId: ws(), network: N.n, accountId: String(acc.id).trim(), accountName: acc.name || null, currency: acc.currency || null, brandId: br || null }))).then(function () { return load(true); }).then(function () { uiToast("Cuenta conectada"); viewIntegrations(); });
    }
    if (a === "del") { if (!confirm("¿Quitar esta cuenta del espacio? Sus campañas sincronizadas se borran de Musa (no de la plataforma).")) return; return busy(api("/api/ads/accounts/" + b.dataset.id + "?workspaceId=" + encodeURIComponent(ws()), { method: "DELETE" })).then(function () { return load(true); }).then(viewIntegrations); }
    if (a === "sync") { note("Sincronizando…"); return busy(sync()).then(function () { viewIntegrations(); }); }
  }, true);
  function sync() {
    return api("/api/ads/sync", J("POST", { workspaceId: ws(), days: 30 })).then(function (r) {
      var ok = (r.results || []).filter(function (x) { return !x.error; }), bad = (r.results || []).filter(function (x) { return x.error; });
      uiToast(ok.length ? "Sincronizado: " + ok.map(function (x) { return x.campaigns + " campañas de " + x.account; }).join(", ") : "Nada que sincronizar" + (bad.length ? " · " + bad[0].error : ""));
      if (bad.length) note(bad.map(function (x) { return x.account + ": " + x.error; }).join(" · "), true);
      return load(true);
    });
  }

  /* ───────── Anunciar / Medir ───────── */
  var _dv = drawView;
  drawView = function () {
    var r = _dv.apply(this, arguments);
    try {
      if (real() && (route.mod === "anunciar" || (route.mod === "medir" && route.sub === "ads"))) {
        if (S.ws !== ws()) load().then(function () { if (route.mod === "anunciar" || route.sub === "ads") go(); });
        var f = document.querySelector("#body .ad-f");
        if (f && !f.querySelector("[data-adsync]") && S.accounts.length) f.insertAdjacentHTML("beforeend", '<button class="btn btn-g" data-adsync style="margin-left:6px">↻ Sincronizar ads</button>');
      }
    } catch (x) {}
    return r;
  };
  if (RB() && RB().reloadData) { var _rd = RB().reloadData; RB().reloadData = function () { var x = _rd.apply(this, arguments); setTimeout(merge, 1500); return x; }; }
  document.addEventListener("click", function (e) {
    if (!real() || !e.target.closest) return;
    var s = e.target.closest("[data-adsync]");
    if (s) { e.stopPropagation(); s.disabled = true; s.textContent = "Sincronizando…"; return sync().then(function () { go(); }, function (x) { uiToast(errText(x)); s.disabled = false; s.textContent = "↻ Sincronizar ads"; }); }
    var p = e.target.closest('[data-ada="pause"], [data-ada="play"]');
    if (p && typeof AD !== "undefined") {
      var a = ADS.find(function (x) { return x.id === AD.sel; }); if (!a || !a.extId) return;
      e.stopPropagation(); e.preventDefault();
      var on = p.dataset.ada === "play";
      if (!confirm((on ? "¿Reactivar" : "¿Pausar") + " «" + a.name + "» en la plataforma de ads?" + (on ? " Empezará a gastar presupuesto." : ""))) return;
      p.disabled = true;
      api("/api/ads/campaigns/" + a.extId + "/status", J("POST", { workspaceId: ws(), action: on ? "resume" : "pause" })).then(function () { a.status = on ? "Activa" : "Pausada"; uiToast(on ? "Reactivada en la plataforma" : "Pausada en la plataforma"); go(); }, function (x) { p.disabled = false; uiToast(errText(x)); });
    }
  }, true);

  /* ───────── Nueva campaña: también en la red ───────── */
  function hookCreate() {
    var C = window.__musaCreate && window.__musaCreate.C; if (!C || !C.ads || C.ads._adsHooked) return !!(C && C.ads && C.ads._adsHooked);
    var base = C.ads, _f = base.fields, _s = base.save;
    base.prep = function () { return load(); };
    base.fields = function () {
      var f = _f.apply(this, arguments);
      var accs = S.accounts.filter(function (a) { return a.network === "meta" || a.network === "tiktok"; });
      f.splice(f.length - 1, 0, { k: "acc", l: "Crearla también en la plataforma", t: "select", full: true, opts: [["", "No · solo planificarla en Musa"]].concat(accs.map(function (a) { return [a.id, (a.network === "meta" ? "Meta Ads" : "TikTok Ads") + " · " + (a.account_name || a.account_id) + " (queda pausada)"]; })) }, { k: "daily", l: "Presupuesto diario en la plataforma (opcional)", t: "number" });
      return f;
    };
    base.save = function (v) {
      return Promise.resolve(_s.apply(this, arguments)).then(function (row) {
        if (!v.acc) return row;
        return api("/api/ads/campaigns/create", J("POST", { workspaceId: ws(), accountRef: v.acc, name: v.name, objective: v.obj, dailyBudget: v.daily || undefined, campaignId: row && row.id, brandId: v.brand })).then(function () { uiToast("También creada en la plataforma (pausada): actívala cuando tenga sus anuncios"); S.ws = null; return row; }, function (x) { uiToast("Se guardó en Musa, pero la plataforma respondió: " + errText(x)); return row; });
      });
    };
    base._adsHooked = true; return true;
  }
  (function wait(n) { if (!hookCreate() && n < 60) setTimeout(function () { wait(n + 1); }, 250); })(0);
})();
