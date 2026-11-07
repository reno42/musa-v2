/* bridge-ints.js — «Redes y bandeja» y ManyChat: llaves API reales por marca.
 * Reemplaza el demo del catálogo de integraciones (que con «+ Agregar cuenta»
 * metía una marca al azar): cada tarjeta de canal — Instagram, Facebook,
 * TikTok, WhatsApp, LinkedIn, X, YouTube, Email — guarda llaves cifradas
 * atadas a la marca que el usuario escoge (GET/PUT/DELETE
 * /api/content/integrations/channel), y ManyChat conecta con su token y su
 * receta del External Request (/api/content/integrations/manychat).
 * Nada se inventa: marca la escoge el usuario, la key la pega él. */
(function () {
  function RB() { return window.__musaReal; }
  function bridge() { try { return window.parent !== window && window.parent.__musaBridge; } catch (e) { return null; } }
  function api(path, init) { var b = bridge(); if (!b) return Promise.reject(new Error("sin puente")); return b.api(path.charAt(0) === "/" ? path : "/rest/v1/" + path, init); }
  function J(m, b) { return { method: m, headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function real() { return RB() && RB().on; }
  function ws() { return RB().ws; }
  function errText(e) { return String(e && (e.message || e.error) || e || "error"); }

  var CHANNELS = {
    instagram: { help: "Meta for Developers › tu app › Instagram: token con instagram_basic, instagram_manage_comments e instagram_manage_insights." },
    facebook: { help: "Meta for Developers: token de página o usuario con pages_manage_posts, pages_read_engagement y pages_messaging." },
    tiktok: { help: "TikTok for Business › Developers: access token de Content Posting API para publicar y leer comentarios." },
    whatsapp: { help: "Meta for Developers › WhatsApp › Cloud API: token permanente de tu app con whatsapp_business_messaging." },
    linkedin: { help: "LinkedIn Developers: token con w_member_social (perfil) o w_organization_social (página de empresa)." },
    x: { help: "X Developers Portal: crea una app y genera el access token con permisos Read and Write." },
    youtube: { help: "Google Cloud Console: OAuth del proyecto con YouTube Data API v3 habilitada (subir videos y leer comentarios)." },
    email: { help: "Resend › API Keys: key para el correo que sale de Musa y entra a la bandeja por marca." },
  };
  var MC_CHANNELS = [["instagram", "Instagram"], ["facebook", "Facebook / Messenger"], ["whatsapp", "WhatsApp"], ["tiktok", "TikTok"], ["website", "Sitio web (chat embebido)"], ["telegram", "Telegram"], ["sms", "SMS"], ["email", "Email"]];
  var S = { ws: null, conns: [], mc: [], mcRecipe: null };

  function load(force) {
    if (!force && S.ws === ws()) return Promise.resolve();
    var W = ws();
    return Promise.all([
      api("/api/content/integrations/channel?workspaceId=" + encodeURIComponent(W)).catch(function () { return { data: [] }; }),
      api("/api/content/integrations/manychat?workspaceId=" + encodeURIComponent(W)).catch(function () { return { data: [] }; }),
    ]).then(function (r) {
      S.ws = W;
      S.conns = (r[0] && (r[0].data || r[0].connections)) || [];
      S.mc = (r[1] && (r[1].data || r[1])) || [];
      if (!Array.isArray(S.mc)) S.mc = [];
      applyState();
    });
  }
  /* El estado real manda: nada de demo accounts ni «Reconectar» ficticio. */
  function applyState() {
    if (typeof INTS === "undefined") return;
    INTS.forEach(function (i) {
      if (CHANNELS[i.id]) {
        var mine = S.conns.filter(function (c) { return c.provider === i.id && c.hasCredentials; });
        i.st = mine.length ? "ok" : "off"; i.key = null; i.account = null;
        delete i.accounts;
      }
      if (i.id === "manychat") {
        i.st = S.mc.some(function (c) { return c.hasCredentials; }) ? "ok" : "off";
        i.key = null; i.account = null; delete i.accounts;
      }
    });
  }

  function brandOpts(withAgency) {
    var bn = (RB() && RB().brandName) || {};
    var o = withAgency ? '<option value="">Mi agencia (CRM propio)</option>' : '<option value="">Sin marca (agencia)</option>';
    return o + Object.keys(bn).map(function (b) { return '<option value="' + esc(b) + '">' + esc(bn[b]) + "</option>"; }).join("");
  }
  function note(t, err) { var n = document.getElementById("ixNote"); if (n) { n.textContent = t; n.style.color = err ? "#d33" : ""; } }

  function chanBox(id) {
    var mine = S.conns.filter(function (c) { return c.provider === id; });
    var h = "<h5>Llaves por marca</h5>";
    h += mine.map(function (c) {
      return '<div class="int-acc"><span><b>' + esc(c.brandName || "Mi agencia") + "</b><small>API key cifrada en el servidor · solo Musa la usa</small></span>"
        + '<button class="btn btn-g" data-ixc="del" data-id="' + esc(c.id) + '">Quitar</button></div>';
    }).join("") || '<div class="int-note">Sin llaves todavía: escoge la marca y pega su API key.</div>';
    h += '<div class="pz-grid" style="margin-top:8px"><label>Marca<select data-ixb>' + brandOpts(false) + "</select></label>"
      + '<label>API key<input data-ixk type="password" autocomplete="off" placeholder="Pega tu API key"></label></div>'
      + '<div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn-p" data-ixc="key">Vincular a la marca</button></div>'
      + '<p class="int-note">' + esc(CHANNELS[id].help) + "</p>";
    return '<div class="mb-ads" style="margin-top:14px">' + h + '<p class="int-note" id="ixNote" style="margin-top:8px"></p></div>';
  }

  function mcBox() {
    var h = "<h5>Cuentas ManyChat</h5>";
    h += S.mc.map(function (c) {
      var ch = (MC_CHANNELS.find(function (x) { return x[0] === c.channel; }) || [null, c.channel || "todos"])[1];
      return '<div class="int-acc"><span><b>' + esc(c.brandName ? "ManyChat · " + c.brandName : "ManyChat · Mi agencia") + "</b><small>" + esc(ch) + "</small></span>"
        + '<button class="btn btn-g" data-ixc="mcdel" data-id="' + esc(c.id) + '">Desvincular</button></div>';
    }).join("") || '<div class="int-note">Sin cuentas: conecta una y pega la receta en tus flows.</div>';
    h += '<div class="pz-grid" style="margin-top:8px"><label>Marca<select data-mcb>' + brandOpts(true) + "</select></label>"
      + '<label>Token permanente (Settings › API)<input data-mck type="password" autocomplete="off" placeholder="Token de ManyChat"></label>'
      + '<label style="grid-column:1/-1">Canal principal del bot<select data-mcc>' + MC_CHANNELS.map(function (c) { return '<option value="' + c[0] + '">' + c[1] + "</option>"; }).join("") + "</select></label></div>"
      + '<div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn-p" data-ixc="mckey">Vincular a mi cuenta</button></div>'
      + '<p class="int-note">Token validado contra la API de ManyChat (plan PRO requisito de ManyChat). Cada cuenta se ata a una marca: la data de tu cliente no se mezcla con la agencia.</p>';
    var rec = S.mcRecipe;
    if (rec) {
      h += '<h5 style="margin-top:14px">Último paso — en tus flows de ManyChat</h5>'
        + '<div class="pz-grid"><label>URL del webhook (bloque External Request · POST)<input readonly value="' + esc(rec.url) + '"></label>'
        + '<label>Header<input readonly value="x-musa-secret: ' + esc(rec.secret) + '"></label></div>'
        + '<p class="int-note">Body JSON: {"channel":"instagram","eventType":"message","text":"{{last_message}}","occurredAt":"{{now}}","contact":{"id":"{{subscriber_id}}","firstName":"{{first_name}}","lastName":"{{last_name}}","email":"{{email}}","phone":"{{phone}}","tags":[],"customFields":{}}}. eventType acepta message, comment, story_reply o form. Esta receta se muestra una sola vez: guarda la URL y el secreto en tu ManyChat. <button class="btn btn-g" data-ixc="mxclose" style="margin-left:6px">Ya la guardé</button></p>';
    }
    return '<div class="mb-ads" style="margin-top:14px">' + h + '<p class="int-note" id="ixNote" style="margin-top:8px"></p></div>';
  }

  /* Detalle propio para las tarjetas wired — el demo (agregar marca al azar,
   * link fantasma) no se dibuja nunca para estos ids. */
  if (typeof intDetail === "function") {
    var _id = intDetail;
    intDetail = function (i) {
      if (!real() || !i || (!CHANNELS[i.id] && i.id !== "manychat")) return _id.apply(this, arguments);
      if (S.ws !== ws()) load().then(function () { if (typeof INT !== "undefined" && INT.open === i.id) viewIntegrations(); });
      var body = i.id === "manychat" ? mcBox() : chanBox(i.id);
      return '<aside class="int-det"><div class="int-hd">' + intLogo(i) + '<div><h3>' + esc(i.name) + '</h3><small style="color:#777;font-size:11px">' + esc(i.cat) + '</small></div><button class="x" data-ia="close" title="Cerrar">✕</button></div>'
        + '<p>' + esc(i.tagline) + '</p><ul>' + (i.bullets || []).map(function (b) { return "<li>" + esc(b) + "</li>"; }).join("") + "</ul>" + body + "</aside>";
    };
  }
  if (typeof viewIntegrations === "function") {
    var _vi = viewIntegrations;
    viewIntegrations = function () {
      if (real()) {
        applyState();
        if (S.ws !== ws()) load().then(function () { if (route.sub === "integraciones") { applyState(); _vi(); } });
      }
      return _vi.apply(this, arguments);
    };
  }

  document.addEventListener("click", function (e) {
    if (!real() || typeof INT === "undefined" || !e.target.closest) return;
    var b = e.target.closest("[data-ixc]");
    if (b) {
      e.stopPropagation(); e.preventDefault();
      var id = INT.open, a = b.dataset.ixc, wrap = b.closest(".mb-ads");
      var busy = function (p) { b.disabled = true; return p.then(function (x) { b.disabled = false; return x; }, function (x) { b.disabled = false; note(errText(x), true); return new Promise(function () {}); }); };
      if (a === "key" && CHANNELS[id]) {
        var k = wrap.querySelector("[data-ixk]"), v = k ? k.value.trim() : "";
        if (v.length < 8) { if (k) k.focus(); return note("Pega la API key completa", true); }
        return busy(api("/api/content/integrations/channel", J("PUT", { workspaceId: ws(), provider: id, apiKey: v, brandId: (wrap.querySelector("[data-ixb]") || {}).value || null })))
          .then(function () { if (k) k.value = ""; uiToast("Llave guardada · cifrada en el servidor"); return load(true); })
          .then(function () { viewIntegrations(); });
      }
      if (a === "del") {
        if (!confirm("¿Quitar esta llave? Lo que la use dejará de funcionar hasta que pongas otra.")) return;
        return busy(api("/api/content/integrations/channel", J("DELETE", { workspaceId: ws(), id: b.dataset.id })))
          .then(function () { uiToast("Llave eliminada"); return load(true); })
          .then(function () { viewIntegrations(); });
      }
      if (a === "mckey") {
        var tk = wrap.querySelector("[data-mck]"), tv = tk ? tk.value.trim() : "";
        if (tv.length < 8) { if (tk) tk.focus(); return note("Pega el token completo de ManyChat", true); }
        return busy(api("/api/content/integrations/manychat", J("PUT", { workspaceId: ws(), apiKey: tv, brandId: (wrap.querySelector("[data-mcb]") || {}).value || null, channel: (wrap.querySelector("[data-mcc]") || {}).value || "instagram" })))
          .then(function (r) {
            var d = (r && r.data) || {};
            if (d.webhookSecret && d.webhookUrl) S.mcRecipe = { url: location.origin + d.webhookUrl, secret: d.webhookSecret };
            if (tk) tk.value = "";
            uiToast("ManyChat conectado");
            return load(true);
          })
          .then(function () { viewIntegrations(); });
      }
      if (a === "mcdel") {
        if (!confirm("¿Desvincular esta cuenta ManyChat? Los eventos de su bot dejarán de entrar al CRM.")) return;
        return busy(api("/api/content/integrations/manychat", J("DELETE", { workspaceId: ws(), id: b.dataset.id })))
          .then(function () { uiToast("Cuenta ManyChat desvinculada"); return load(true); })
          .then(function () { viewIntegrations(); });
      }
      if (a === "mxclose") { S.mcRecipe = null; return viewIntegrations(); }
      return;
    }
    /* Ni «+ Agregar cuenta» que mete una marca al azar ni «Vincular» fantasma
       en las tarjetas wired: el click no llega al handler demo del catálogo. */
    var ia = e.target.closest('[data-ia="addacc"], [data-ia="link"], [data-ia="unlink"], [data-ia="reconnect"], [data-ia="default"]');
    if (ia) {
      var i = typeof INTS !== "undefined" ? INTS.find(function (x) { return x.id === INT.open; }) : null;
      if (i && (CHANNELS[i.id] || i.id === "manychat")) { e.stopPropagation(); e.preventDefault(); }
    }
  }, true);

  if (RB() && RB().reloadData) {
    var _rd = RB().reloadData;
    RB().reloadData = function () { var x = _rd.apply(this, arguments); if (S.ws) load(true); return x; };
  }
})();
