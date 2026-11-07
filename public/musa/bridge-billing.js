/* ═══════════════════════════════════════════════════════════════════════════
   bridge-billing.js — Upselling Freelance → Agencia en Configuración › Espacios
   y planes. En modo real, bridge-growth ya inyecta el panel «Tu plan» (plan,
   uso, créditos, catálogo con checkout Creem) ARRIBA del contenido; este puente
   reemplaza la vista demo (Mayckol/Grupo Andino, modelo viejo de varios
   espacios) por la capa que falta: por qué subir a Agencia y qué cambia, con
   Freelance como plan por defecto de todas las cuentas. Si el modo real está
   apagado, dibuja la vista completa por sí solo (con valores de respaldo).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var B = { plan: null, catalog: null, loading: null };

  /* ── helpers locales (misma convención que el resto de los puentes) ── */
  function RB() { return (typeof __musaReal !== "undefined") ? __musaReal : null; }
  function bridge() { try { return window.parent !== window && window.parent.__musaBridge; } catch (e) { return window.__musaBridge || null; } }
  function api(path, init) { var b = bridge(); if (!b) return Promise.reject(new Error("sin puente")); return b.api(path.charAt(0) === "/" ? path : "/rest/v1/" + path, init); }
  function J(m, b) { return { method: m, headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) }; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function money(n) { return "US$ " + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
  function priceLine(p) {
    if (!p) return "";
    var base = money(p.price_usd || 0) + (p.interval === "year" ? "/año" : "/mes");
    if (p.intro_price_usd && p.intro_months) base = money(p.intro_price_usd) + "/mes los primeros " + p.intro_months + " meses · luego " + base;
    return base;
  }
  function lim(v) { return v === null || v === undefined ? "Ilimitado" : v; }

  /* Respaldo (valores de la migración 20): la vista nunca se rompe aunque
     billing_plans aún no sea legible o el modo real esté apagado. */
  var FALLBACK = [
    { code: "agencia_byok_m", name: "Musa Agencia", segment: "agencia", mode: "byok", interval: "month", price_usd: 349, intro_price_usd: 149, intro_months: 3, credits_month: 200, seats: 5, brands: 25, emails_month: 15000, entitlements: { features: ["5 personas", "25 marcas", "Portal de clientes", "Roles de equipo", "Tus llaves de IA (BYOK)", "200 créditos de prueba al mes", "15.000 correos al mes"] } },
    { code: "agencia_ia_m", name: "Musa Agencia IA", segment: "agencia", mode: "musa_ia", interval: "month", price_usd: 499, intro_price_usd: 199, intro_months: 3, credits_month: 3000, seats: 5, brands: 25, emails_month: 15000, entitlements: { features: ["5 personas", "25 marcas", "Portal de clientes", "Roles de equipo", "3.000 créditos de IA al mes", "15.000 correos al mes"] } },
    { code: "agencia_byok_y", name: "Musa Agencia", segment: "agencia", mode: "byok", interval: "year", price_usd: 3490, seats: 5, brands: 25, emails_month: 15000, entitlements: { features: ["5 personas", "25 marcas", "Portal de clientes", "Roles de equipo"] } },
    { code: "agencia_ia_y", name: "Musa Agencia IA", segment: "agencia", mode: "musa_ia", interval: "year", price_usd: 4990, seats: 5, brands: 25, emails_month: 15000, entitlements: { features: ["5 personas", "25 marcas", "Portal de clientes", "Roles de equipo"] } },
    { code: "empresa_ia_m", name: "Musa Empresa", segment: "empresa", mode: "musa_ia", interval: "month", price_usd: 1490, credits_month: 10000, seats: 15, brands: null, emails_month: 50000, entitlements: { features: ["15 personas", "Marcas ilimitadas", "Áreas y aprobaciones", "Soporte prioritario"] } }
  ];
  var SEAT_PRICE = "US$ 49/mes cada persona extra (IA: US$ 69)";

  function loadBilling() {
    if (B.loading) return B.loading;
    B.loading = Promise.all([
      api("rpc/v2_my_plan", J("POST", {})).catch(function () { return null; }),
      api("billing_plans?select=code,name,segment,mode,interval,price_usd,intro_price_usd,intro_months,credits_month,seats,brands,emails_month,entitlements&kind=eq.plan&active=eq.true&order=sort.asc")
        .then(function (r) { return (r && r.length) ? r : null; }).catch(function () { return null; })
    ]).then(function (res) {
      B.plan = res[0] || { tier: "gratis" };            // default de todos: Freelance
      B.catalog = res[1] || FALLBACK;
      B.loading = null;
    }, function () { B.plan = { tier: "gratis" }; B.catalog = FALLBACK; B.loading = null; });
    return B.loading;
  }

  /* Freelance es el paraguas del plan base: gratis, acceso anticipado o Creador. */
  function currentPlan() {
    var t = (B.plan && B.plan.tier) || "gratis";
    if (t === "agencia") return { key: "agencia", name: "Agencia", paid: true };
    if (t === "empresa") return { key: "empresa", name: "Empresa", paid: true };
    if (t === "ilimitado") return { key: "freelance", name: "Freelance", note: "acceso anticipado · sin límites", paid: false };
    if (t === "creador") return { key: "freelance", name: "Freelance", note: "Musa Creador", paid: true };
    return { key: "freelance", name: "Freelance", note: "plan base", paid: false };
  }

  /* ── piezas compartidas ── */
  function headerNote() {
    var w = (typeof curWS === "function") ? curWS() : { name: "" };
    var roleTxt = (typeof myRole === "function") ? myRole() : "";
    return '<div class="ws-note">Estás en <b>' + esc(w.name || "") + "</b>" + (roleTxt ? " · tu rol: <b>" + esc(roleTxt) + "</b>" : "") +
      ". Tu plan aplica a toda la cuenta: un espacio, todas tus marcas adentro, y lo paga quien es dueño del espacio.</div>";
  }
  function limitBanner() {
    var p = B.plan || {};
    if (!(p.brands && p.brands_used != null && p.brands_used >= p.brands)) return "";
    return '<div class="ws-note" style="border-color:var(--accent)">⚠ Ya usaste las ' + p.brands + " marcas de tu plan. Sube a Agencia para llegar a 25 y desbloquear el portal de clientes.</div>";
  }
  function hero(cur) {
    var next = cur.key === "freelance" ? "agencia" : "empresa";
    var title = cur.key === "freelance" ? "Sube a Agencia cuando tu negocio pida más" : "¿Más escala?";
    var sub = cur.key === "freelance" ? "clientes que aprueban en su propio portal, equipo con roles y hasta 25 marcas" : "personas y marcas ilimitadas, áreas internas y aprobaciones obligatorias";
    var items = cur.key === "freelance"
      ? [["Portal de clientes", "cada cliente entra a su intranet: brief → diseños → calendario → reportes, y aprueba ahí"],
         ["Privado y compartido", "todo se comporta como un archivo: lo privado es tuyo, lo compartido lo ve tu equipo y el cliente de esa marca"],
         ["Equipo con roles", "hasta 5 personas (las extra se agregan al plan), con permisos por espacio"],
         ["25 marcas", "tu negocio con su CRM y sus reportes «Mi negocio», y las de tus clientes separadas"]]
      : [["15 personas", "por área o por equipo, con aprobaciones de Marketing antes de publicar"],
         ["Marcas ilimitadas", "marca madre, submarcas y clientes, sin techo"],
         ["Soporte prioritario", "y 10.000 créditos de IA al mes"]];
    var cta = cur.key === "empresa" ? "" :
      '<div class="roles" style="margin-top:12px"><button class="btn btn-p" data-bsee="' + next + '">Ver planes de ' + (next === "agencia" ? "Agencia" : "Empresa") + "</button></div>";
    return '<article class="card c12"><div class="ch"><h3>' + title + "</h3><small>" + sub + "</small></div>" +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;margin-top:10px">' +
      items.map(function (x) { return '<div style="border:1.5px solid rgba(0,0,0,.08);border-radius:12px;padding:12px"><b>' + esc(x[0]) + "</b><small style=\"display:block;color:var(--muted);margin-top:4px\">" + esc(x[1]) + "</small></div>"; }).join("") +
      "</div>" + cta + "</article>";
  }
  function compareTable() {
    return '<div class="grid" style="margin-top:14px"><article class="card c12"><div class="ch"><h3>Freelance vs Agencia</h3><small>lo que cambia de verdad al subir de plan</small></div>' +
      '<div class="tbl-wrap"><table class="tnum sp-tbl"><thead><tr><th></th><th>Freelance (plan base)</th><th>Agencia</th><th>Empresa</th></tr></thead><tbody>' +
      [["Personas", "1 (tú)", "Hasta 5 · personas extra", "Hasta 15"],
       ["Marcas", "Las de tu negocio", "Hasta 25 · privado y compartido por marca", "Ilimitadas"],
       ["Clientes", "Compartes archivos por marca", "Intranet por cliente: brief → reportes, aprueban en su portal", "Áreas internas + agencias externas"],
       ["Visibilidad", "Privado o compartido contigo", "Privado o compartido con roles de equipo", "Aprobaciones obligatorias"],
       ["Créditos de IA al mes", "50 (BYOK) · 600 (IA)", "200 (BYOK) · 3.000 (IA)", "10.000"],
       ["Correos al mes", "2.000 (BYOK) · 1.000 (IA)", "15.000", "50.000"]].map(function (r) {
        return "<tr><td class=\"first\">" + r[0] + "</td><td>" + esc(r[1]) + "</td><td>" + esc(r[2]) + "</td><td>" + esc(r[3]) + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      '<p class="lp-obj" style="margin-top:10px">Precios en USD. Al subir de plan no pierdes nada: tus marcas, diseños e historial quedan igual — solo crecen los límites y se abren los permisos de equipo y portal.</p></article></div>';
  }

  /* ── popup de respaldo cuando el catálogo de Creem no está a la vista ── */
  function pickPopup(code) {
    var m = B.catalog.filter(function (x) { return x.code === code; })[0];
    if (!m) return uiToast("Plan no disponible por ahora");
    var y = B.catalog.filter(function (x) { return x.code === code.replace("_m", "_y"); })[0];
    var feats = (m.entitlements && m.entitlements.features) || [];
    var summary = m.name + " (" + (m.mode === "musa_ia" ? "IA de Musa" : "BYOK") + ") · " + priceLine(m) +
      (y ? " · anual: " + priceLine(y) : "") + " · " + feats.join(", ") + (m.segment === "agencia" ? " · " + SEAT_PRICE : "");
    mx("Elegir " + m.name, "El cobro se activa con Creem. Copia el resumen y pégaselo a Musa para activarlo hoy.",
      '<div class="list">' +
      '<div class="li"><span style="flex:1"><b>Mensual</b><small>' + priceLine(m) + "</small></span></div>" +
      (y ? '<div class="li"><span style="flex:1"><b>Anual</b><small>' + priceLine(y) + " · dos meses de regalo</small></span></div>" : "") +
      "</div><p class=\"lp-obj\" style=\"margin-top:10px\">Al activar el pago, tus límites y créditos suben solos: no pierdes marcas, diseños ni historial.</p>" +
      '<div style="margin-top:10px"><button class="btn btn-p" data-bcopy>Activar ' + esc(m.name) + " · copiar resumen</button></div>",
      function (e) {
        if (!e.target.closest("[data-bcopy]")) return;
        try { navigator.clipboard.writeText(summary); } catch (err) {}
        mxEl.hidden = true;
        uiToast("Resumen copiado · pégalo en tu chat con Musa para activar el plan");
      });
  }

  /* ── tarjetas de catálogo (solo para el modo sin datos reales) ── */
  function upCard(p) {
    var feats = (p.entitlements && p.entitlements.features) || [];
    var y = B.catalog.filter(function (x) { return x.code === p.code.replace("_m", "_y"); })[0];
    return '<div class="sp-p" style="border-color:var(--accent)"><span class="k">' + (p.segment === "agencia" ? "PARA AGENCIAS" : "PARA EMPRESAS") + "</span>" +
      "<h3>" + esc(p.name) + "</h3>" +
      '<p class="tnum" style="color:var(--accent);font-weight:700">' + priceLine(p) + "</p>" +
      (y ? '<small style="color:var(--muted)">anual: ' + priceLine(y) + "</small>" : "") +
      "<ul>" + feats.map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("") + "</ul>" +
      '<div class="roles"><button class="btn btn-p" data-bpick="' + p.code + '">Elegir ' + esc(p.name) + "</button></div></div>";
  }

  function renderLean() {
    var cur = currentPlan();
    $("#body").innerHTML = headerNote() + limitBanner() + hero(cur) + compareTable();
    $("#body").onclick = function (e) {
      var b = e.target.closest("[data-bsee]");
      if (!b) return;
      var panel = document.getElementById("mbPlans");
      if (panel) { panel.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
      var code = b.getAttribute("data-bsee") === "agencia" ? "agencia_byok_m" : "empresa_ia_m";
      pickPopup(code);
    };
  }
  function renderFull() {
    var cur = currentPlan();
    var ag = B.catalog.filter(function (x) { return x.segment === "agencia" && x.interval === "month"; });
    var em = B.catalog.filter(function (x) { return x.segment === "empresa" && x.interval === "month"; });
    $("#body").innerHTML = headerNote() + limitBanner() +
      '<div class="grid"><article class="card c6"><div class="ch"><h3>Tu plan</h3><small>lo que incluye tu cuenta hoy</small></div>' +
      '<div class="sp-p on" style="margin-top:6px"><span class="k">PLAN ACTUAL</span><h3>' + esc(cur.name) + "</h3>" +
      (cur.key === "freelance" ? "<p>Para tu propio negocio: todas tus marcas, CRM, embudos y reportes de tu marca, con la operación completa en un solo espacio.</p>" : "") +
      (cur.note ? '<div class="roles"><span class="ag-tag">' + esc(cur.note) + "</span></div>" : "") + "</div></article>" +
      '<article class="card c6"><div class="ch"><h3>' + (cur.key === "freelance" ? "Sube a Agencia cuando tu negocio pida más" : "¿Más escala?") + "</h3><small>" +
      (cur.key === "freelance" ? "portal de clientes, roles de equipo y hasta 25 marcas" : "personas y marcas ilimitadas, áreas y aprobaciones") + "</small></div>" +
      '<div class="sp-plans" style="margin-top:6px">' + ag.map(upCard).join("") +
      (em.length ? '<div class="sp-plans" style="margin-top:10px">' + em.map(upCard).join("") + "</div>" : "") + "</article></div>" +
      hero(cur) + compareTable();
    $("#body").onclick = function (e) {
      var b = e.target.closest("[data-bpick]");
      if (!b) return;
      pickPopup(b.getAttribute("data-bpick"));
    };
  }

  function viewBilling() {
    $("#body").innerHTML = '<div class="ws-note">Cargando tu plan…</div>';
    loadBilling().then(function () {
      if (location.hash.indexOf("configuracion/espacios") > -1) {
        if (RB() && RB().on) renderLean(); else renderFull();
      }
    });
  }

  /* ── enganches ── */
  function whenReady(fn, tries) {
    if (typeof viewSpaces === "function" && typeof mx === "function" && typeof uiToast === "function") return fn();
    if ((tries || 0) > 60) return;
    setTimeout(function () { whenReady(fn, (tries || 0) + 1); }, 100);
  }
  whenReady(function () {
    var _vs = viewSpaces;                       // la vista demo queda como respaldo último
    viewSpaces = function () {
      try { return viewBilling(); } catch (e) { return _vs.apply(this, arguments); }
    };
    /* el rótulo del espacio refleja el plan real de la cuenta (por defecto: Freelance) */
    if (RB() && RB().on) {
      loadBilling().then(function () {
        var tries = 0;
        (function wait() {
          if (typeof WSS === "undefined" || typeof WSX === "undefined" || !WSS[WSX.cur]) {
            if (++tries < 50) return setTimeout(wait, 100);
            return;
          }
          try {
            WSS[WSX.cur].tier = currentPlan().name;
            if (typeof wsCard === "function") wsCard();
          } catch (e) {}
        })();
      });
    }
  });
})();
