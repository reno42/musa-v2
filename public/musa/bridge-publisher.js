/* bridge-publisher.js — Musa Publisher (motor social propio, convive con Zernio).
 * · Configuración › Publicar: redes agrupadas, asistente paso a paso por red (app de developer +
 *   Conectar por OAuth, o llave pegada), cuentas por cliente (marca), enlace de conexión para que
 *   el cliente autorice su propia cuenta, y últimas publicaciones.
 * · «Publicar en redes» en el editor y en las piezas del calendario: cuentas agrupadas por cliente
 *   y red, texto general o distinto por red, Prueba / En vivo (por defecto Prueba), envío en tandas
 *   con progreso y resultado por destino con su enlace.
 * Todo sale de /api/publisher/* (nada de datos de ejemplo). Solo imágenes por ahora.
 */
(function () {
  var RB = window.__musaReal;
  function bridge() { try { return window.parent !== window && window.parent.__musaBridge; } catch (e) { return null; } }
  function api(path, init) { var b = bridge(); if (!b) return Promise.reject(new Error("sin puente")); return b.api(path, init); }
  function J(m, b, t) { var o = { method: m, headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) }; if (t) o.timeoutMs = t; return o; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function msg(e) { return String(e && e.message || e || "error").replace(/^API error: \d+ — /, ""); }
  function toast(t) { if (typeof uiToast === "function") uiToast(t); }
  function ws() { return RB && RB.ws; }
  function q(p) { return p + (p.indexOf("?") < 0 ? "?" : "&") + "workspaceId=" + encodeURIComponent(ws() || ""); }
  function brands() { var m = (RB && RB.brandName) || {}; return Object.keys(m).map(function (id) { return { id: id, name: m[id] }; }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); }); }
  function brandName(id) { return id ? ((RB && RB.brandName && RB.brandName[id]) || "Marca") : "Todo el espacio"; }
  function brandIdByName(n) { return (RB && RB.brandId && RB.brandId[n]) || null; }

  var P = { providers: null, notYet: [], redirect: "", live: false, max: 60, apps: {}, accounts: [], jobs: [], open: null, loading: null, ws: null, client: "", link: null };
  var ST = { active: ["ok", "Conectada"], expired: ["warn", "Venció: reconecta"], error: ["bad", "Con error"] };
  var JS = { published: "Publicado", partial: "Parcial", failed: "Falló", "dry-run": "Prueba", running: "Enviando", queued: "En cola" };
  var GROUPS = [["social", "Redes sociales"], ["chat", "Canales y comunidades"], ["blog", "Blogs y newsletters"]];
  try { var pc = localStorage.getItem("musa-pub-client") || ""; P.client = /^\[/.test(pc) ? JSON.parse(pc) : pc ? [pc] : []; } catch (e) { P.client = []; }

  function load(force) {
    if (P.loading && !force && P.ws === ws()) return P.loading;
    P.ws = ws();
    P.loading = Promise.all([
      api("/api/publisher/providers"),
      api(q("/api/publisher/apps")).catch(function () { return { data: [] }; }),
      api(q("/api/publisher/accounts")).catch(function () { return { data: [] }; }),
      api(q("/api/publisher/jobs?limit=15")).catch(function () { return { data: [] }; }),
    ]).then(function (r) {
      P.providers = r[0].data || []; P.notYet = r[0].notYet || []; P.redirect = r[0].redirectUri || ""; P.live = !!r[0].live; P.max = r[0].maxTargets || 60;
      P.apps = {}; (r[1].data || []).forEach(function (a) { P.apps[a.app] = a; });
      P.accounts = r[2].data || []; P.jobs = r[3].data || [];
      return P;
    });
    P.loading.catch(function () { P.loading = null; });
    return P.loading;
  }
  function prov(id) { return (P.providers || []).find(function (p) { return p.id === id; }) || { id: id, name: id, color: "#888", limits: { maxChars: 280, maxBytes: 5e6, formats: [] }, fields: [], setup: [] }; }
  function pill(cls, t) { return '<span class="pill ' + cls + '">' + esc(t) + "</span>"; }
  /* logo real de la red (Simple Icons) sobre su color; si no hay trazo, la inicial */
  var GRAD = { instagram: "linear-gradient(135deg,#feda75,#fa7e1e 30%,#d62976 60%,#962fbf 80%,#4f5bd5)" };
  function logo(p, size) {
    size = size || 38;
    var d = window.__musaLogos && window.__musaLogos[p.id], ic = Math.round(size * 0.52);
    var inner = d ? '<svg width="' + ic + '" height="' + ic + '" viewBox="0 0 24 24" aria-hidden="true" fill="#fff"><path d="' + d + '"/></svg>' : esc((p.name || "?").slice(0, 1));
    return '<span class="int-lg" style="flex:0 0 ' + size + "px;width:" + size + "px;height:" + size + "px;border-radius:" + Math.round(size * 0.27) + "px;background:" + (GRAD[p.id] || esc(p.color || "#555")) + '">' + inner + "</span>";
  }
  function badge(p) { return logo(p, 30); }
  /* qué hace cada red, en una línea, para la tarjeta */
  var DESC = {
    notion: "Crea una página con tu diseño en la página o base de datos que elijas.",
    gumroad: "Envía un correo a tus seguidores o clientes con tu diseño.",
    luma: "Avisa a los invitados de tu evento o crea un evento con tu diseño de portada.",
    instagram: "Publica tus diseños en el feed de las cuentas de empresa o creador.",
    facebook: "Publica en las páginas que administras, con su texto.",
    linkedin: "Publica en tu perfil personal de LinkedIn.",
    linkedin_page: "Publica en las páginas de empresa que administras.",
    x: "Publica un post con la imagen y su texto.",
    threads: "Publica en tu perfil de Threads.",
    bluesky: "Publica en tu cuenta de Bluesky con una contraseña de app.",
    pinterest: "Crea un pin en el tablero que elijas.",
    reddit: "Publica una imagen en el subreddit que elijas.",
    google_business: "Publica novedades en tus fichas de Google.",
    mastodon: "Publica en tu cuenta de cualquier instancia.",
    telegram: "Envía el diseño a tu canal o grupo con un bot.",
    discord: "Envía el diseño a un canal con un webhook.",
    slack: "Envía el diseño a un canal con un webhook.",
    wordpress: "Crea una entrada con la imagen destacada.",
    ghost: "Crea un post con la imagen de portada.",
    blogger: "Crea una entrada en tu blog de Blogger.",
    devto: "Crea un artículo con la imagen de portada.",
    hashnode: "Crea un artículo en tu publicación.",
    listmonk: "Envía el diseño como campaña a tus listas.",
  };
  var NY_ID = { TikTok: "tiktok", YouTube: "youtube", WhatsApp: "whatsapp", Medium: "medium" };
  var NY_COLOR = { tiktok: "#000000", youtube: "#FF0000", whatsapp: "#25D366", medium: "#000000" };
  var GROUP_D = { social: "Tu marca y las de tus clientes en sus redes", chat: "Canales, grupos y comunidades donde publicas avisos", blog: "Entradas y campañas con tu diseño como portada" };
  function inClient(a) { return typeof fIn === "function" ? fIn(P.client, a.brand_id || "_none") : true; }
  function clientOne() { var a = Array.isArray(P.client) ? P.client : P.client ? [P.client] : []; return a.length === 1 && a[0] !== "_none" ? a[0] : ""; }
  function brandSelect(attr, val, allLabel) {
    return '<select class="pub-sel" ' + attr + '><option value="">' + esc(allLabel || "Sin cliente (del espacio)") + "</option>" + brands().map(function (b) { return '<option value="' + esc(b.id) + '"' + (b.id === val ? " selected" : "") + ">" + esc(b.name) + "</option>"; }).join("") + "</select>";
  }
  function connWord(p) { var n = String(p.name || "").replace(/\s*\(.*\)\s*$/, ""); return p.kind === "oauth" ? "Inicias sesión en " + n : "Con una llave de " + n; }

  /* estilos propios mínimos: lo demás es el sistema de la maqueta (int-*, pill, btn, fdd) */
  (function () {
    var s = document.createElement("style");
    s.textContent = ".pub-v .int-t{min-height:148px}.pub-v .int-t .pill{white-space:nowrap}"
      + ".pub-v .int-ft{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto;width:100%}"
      + ".pub-v .int-ft .go{font-weight:700;font-size:12px;color:var(--accent);white-space:nowrap}"
      + ".pub-v .int-t.soon{cursor:default;background:#e4e2d6}.pub-v .int-t.soon:hover{transform:none;box-shadow:none}.pub-v .int-t.soon .int-lg{filter:grayscale(1);opacity:.75}"
      + ".pub-v .int-det .btn-g,.pub-v .pub-card .btn-g{background:#e2e0d3;color:#111;font-family:var(--sans);text-transform:none;letter-spacing:0;font-size:12.5px;font-weight:700}"
      + ".pub-v .int-det .btn-g:hover,.pub-v .pub-card .btn-g:hover{background:#d6d4c6}"
      + ".pub-v .int-det label{display:block;font-size:11px;font-weight:700;color:#444;margin:10px 0 5px}"
      + ".pub-v .int-det input,.pub-v .pub-sel{width:100%;box-sizing:border-box;height:38px;border:1.5px solid #d6d4c6;border-radius:9px;background:#fff;color:#111;padding:0 10px;font:inherit;font-size:13px;outline:0}"
      + ".pub-v .int-det input:focus,.pub-v .pub-sel:focus{border-color:var(--accent)}"
      + ".pub-v .int-key input{flex:1;min-width:0}.pub-v .int-key .btn{flex:none}"
      + ".pub-v .pub-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}.pub-v .pub-acts .btn{flex:1 1 auto}"
      + ".pub-v .int-det .warnote{background:#fff4e6;border-radius:10px;padding:9px 11px;font-size:12px;color:#7a4a00;line-height:1.5;margin:8px 0}"
      + ".pub-v .int-acc{flex-wrap:wrap}.pub-v .int-acc>span:nth-child(2){flex:1;min-width:120px}"
      + ".pub-v .acc-tools{display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end}"
      + ".pub-v .acc-tools .pub-sel,.pub-v .acc-tools input{height:32px;max-width:240px;font-size:12px}"
      + ".pub-v .mini{height:30px;padding:0 12px;font-size:12px}"
      + ".pub-v .pub-card{background:var(--card-bg);color:var(--ink);border-radius:16px;padding:16px 18px;border:1.5px solid var(--card-line)}"
      + ".pub-v .pub-card .int-acc:last-child{border-bottom:0}"
      + ".pub-v .pub-job{display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-bottom:1px solid #e1dfd2}.pub-v .pub-job:last-child{border-bottom:0}"
      + ".pub-v .pub-job img{width:52px;height:52px;object-fit:cover;border-radius:10px;flex:none;background:#e9e7da}"
      + ".pub-v .pub-tg{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.pub-v .pub-tg span{display:inline-flex;align-items:center;gap:5px;font-size:11px;background:#e9e7da;border-radius:99px;padding:2px 8px 2px 2px;color:#222}"
      + ".pub-v .pub-tg a{color:var(--accent);font-weight:700}"
      + ".pub-v .pub-live{display:inline-flex;gap:6px;align-items:center;font-size:11px;color:var(--muted)}"
      + "@media (max-width:760px){.pub-v .int-sec h4{flex-direction:column;align-items:flex-start;gap:2px}.pub-v .acc-tools{width:100%;justify-content:flex-start;padding-left:38px;margin-top:6px}.pub-v .int-grid{grid-template-columns:minmax(0,1fr)}.pub-v .int-t{min-height:0}.pub-v .int-det{position:static;order:-1}.pub-v .int-wrap.det{display:flex;flex-direction:column}.pub-v .int-det .acc-tools{padding-left:0}.pub-v .pub-acts .btn{width:100%}}";
    document.head.appendChild(s);
  })();

  /* cabecera de la sección: texto propio y sin los botones genéricos de Configuración */
  function head() {
    var hd = document.querySelector(".head"); if (!hd) return;
    var sub = hd.querySelector("p, .sub"); if (sub) sub.textContent = "Conecta las redes de tu marca y de tus clientes, y publica tus diseños en varias a la vez.";
    var act = hd.querySelector(".actions"); if (act) act.style.display = "none";
  }

  /* ───────── Configuración › Publicar ───────── */
  function view() {
    var body = document.getElementById("body"); if (!body) return;
    head();
    if (!P.providers) body.innerHTML = '<div class="pub-v"><p class="empty-note">Cargando redes…</p></div>';
    load().then(draw, function (e) { body.innerHTML = '<div class="pub-v"><p class="empty-note">No se pudo cargar el Publisher: ' + esc(msg(e)) + "</p></div>"; });
  }
  function draw() {
    var body = document.getElementById("body"); if (!body || !/configuracion\/publicar/.test(location.hash)) return;
    head();
    var accs = P.accounts.filter(inClient), bl = brands(), open = P.open ? prov(P.open) : null;
    var nOk = accs.filter(function (a) { return a.status === "active"; }).length, nBad = accs.length - nOk;
    var nets = {}; accs.forEach(function (a) { nets[a.provider] = 1; });
    var h = '<div class="pub-v"><div class="int-f">';
    if (bl.length && typeof fdd === "function") h += fdd("pubC", "Cliente", [["_none", "Sin cliente (del espacio)"]].concat(bl.map(function (b) { return [b.id, b.name]; })), P.client, function (v) { P.client = v; try { localStorage.setItem("musa-pub-client", JSON.stringify(v)); } catch (x) {} draw(); }, "Todos");
    h += "<small>" + nOk + " cuenta" + (nOk === 1 ? "" : "s") + " conectada" + (nOk === 1 ? "" : "s") + " en " + Object.keys(nets).length + " red" + (Object.keys(nets).length === 1 ? "" : "es")
      + (nBad ? ' · <b style="color:var(--danger)">' + nBad + " por reconectar</b>" : "") + " · " + P.providers.length + " redes disponibles · solo imágenes"
      + (P.live ? "" : " · <b>envío real apagado: todo en modo Prueba</b>") + "</small></div>";
    h += '<div class="int-wrap' + (open ? " det" : "") + '"><div>';
    GROUPS.forEach(function (g) {
      var ps = P.providers.filter(function (p) { return (p.group || "social") === g[0]; }); if (!ps.length) return;
      h += '<section class="int-sec"><h4>' + g[1] + "<small>" + GROUP_D[g[0]] + '</small></h4><div class="int-grid">' + ps.map(function (p) {
        var mine = accs.filter(function (a) { return a.provider === p.id; }), bad = mine.filter(function (a) { return a.status !== "active"; }).length;
        var st = mine.length ? (bad ? pill("danger", bad === mine.length ? "Reconectar" : bad + " por reconectar") : pill("ok", mine.length === 1 ? "1 cuenta" : mine.length + " cuentas")) : pill("mute", "Sin conectar");
        return '<button type="button" class="int-t' + (P.open === p.id ? " on" : "") + '" data-pub="wiz" data-p="' + esc(p.id) + '" aria-expanded="' + (P.open === p.id) + '" aria-label="' + esc(p.name + (mine.length ? ", administrar" : ", conectar")) + '">'
          + '<span class="int-hd">' + logo(p) + "<span><b>" + esc(p.name) + '</b><span class="cat">' + esc(connWord(p)) + "</span></span></span>"
          + "<p>" + esc(DESC[p.id] || "") + "</p>"
          + '<span class="int-ft">' + st + '<span class="go">' + (mine.length ? "Administrar" : "Conectar") + " →</span></span></button>";
      }).join("") + "</div></section>";
    });
    if (P.notYet.length) h += '<section class="int-sec"><h4>Próximamente<small>Todavía no se pueden conectar, y por qué</small></h4><div class="int-grid">' + P.notYet.map(function (n) {
      var id = NY_ID[n.name] || "", p = { id: id, name: n.name, color: NY_COLOR[id] || "#555" };
      return '<div class="int-t soon"><span class="int-hd">' + logo(p) + "<span><b>" + esc(n.name) + '</b><span class="cat">No disponible aún</span></span></span><p>' + esc(n.why) + '</p><span class="int-ft">' + pill("mute", "Próximamente") + "</span></div>";
    }).join("") + "</div></section>";
    // cuentas de todas las redes (para agencias: todo en un lugar, con su cliente)
    h += '<section class="int-sec"><h4>Cuentas conectadas<small>' + (accs.length ? accs.length + (Array.isArray(P.client) && P.client.length ? " de los clientes elegidos" : " en este espacio") + " · hasta " + P.max + " por publicación" : "Aparecen aquí cuando conectes la primera") + "</small></h4>";
    h += accs.length ? '<div class="pub-card">' + accs.map(accountHtml).join("") + "</div>" : '<div class="pub-card"><p class="empty-note" style="margin:0">Elige una red de arriba para conectar tu primera cuenta' + (bl.length ? " o mandarle un enlace a tu cliente" : "") + ".</p></div>";
    h += "</section>";
    var jobs = P.jobs.filter(function (j) { return typeof fIn !== "function" || fIn(P.client, j.brand_id || "_none"); });
    h += '<section class="int-sec"><h4>Últimas publicaciones<small>Desde el editor o el calendario, con «Publicar en redes»</small></h4><div class="pub-card">' + jobsHtml(jobs) + "</div></section>";
    h += "</div>" + (open ? wizard(open) : "") + "</div></div>";
    body.innerHTML = h;
    if (open && innerWidth <= 760) { var det = body.querySelector(".int-det"); if (det) det.scrollIntoView({ block: "start" }); }
  }
  function accountHtml(a) {
    var p = prov(a.provider), s = ST[a.status] || ["mute", a.status], o = a.options || {}, bl = brands();
    var tools = "";
    if (a.provider === "reddit") tools += '<input data-pub-sr="' + esc(a.id) + '" value="' + esc(o.subreddit || "") + '" placeholder="r/subreddit" aria-label="Subreddit"><button type="button" class="btn btn-g mini" data-pub="sr" data-id="' + esc(a.id) + '">Guardar</button>';
    if (a.provider === "pinterest") tools += '<select class="pub-sel" data-pub-board="' + esc(a.id) + '" aria-label="Tablero">' + (o.boards || []).map(function (bd) { return '<option value="' + esc(bd.id) + '"' + (bd.id === o.board_id ? " selected" : "") + ">" + esc(bd.name) + "</option>"; }).join("") + "</select>";
    if (bl.length) tools += brandSelect('data-pub-brand="' + esc(a.id) + '" aria-label="Cliente"', a.brand_id);
    tools += '<button type="button" class="btn btn-g mini" data-pub="check" data-id="' + esc(a.id) + '">Revisar</button><button type="button" class="btn btn-g mini" data-pub="del" data-id="' + esc(a.id) + '">Quitar</button>';
    return '<div class="int-acc">' + logo(p, 28) + "<span><b>" + esc(a.display_name || a.username || a.external_id) + "</b><small>" + esc(p.name)
      + (a.brand_id ? " · " + esc(brandName(a.brand_id)) : "") + (o.page_name ? " · página " + esc(o.page_name) : "") + (a.expires_at ? " · vence " + new Date(a.expires_at).toLocaleDateString() : "") + "</small>"
      + (a.last_error ? '<small style="color:var(--danger)">' + esc(a.last_error) + "</small>" : "") + "</span>"
      + pill(s[0] === "bad" ? "danger" : s[0] === "warn" ? "danger" : s[0], s[1]) + '<div class="acc-tools">' + tools + "</div></div>";
  }
  function wizard(p) {
    var key = p.appKey || p.id, app = p.kind === "oauth" ? P.apps[key] : null, shares = p.kind === "oauth" ? P.providers.filter(function (x) { return x.appKey === key && x.id !== p.id; }) : [];
    var mine = P.accounts.filter(function (a) { return a.provider === p.id && inClient(a); });
    var h = '<aside class="int-det" aria-label="Conectar ' + esc(p.name) + '"><div class="int-hd">' + logo(p, 44) + "<div><h3>" + esc(p.name) + '</h3><small style="color:#777;font-size:11px">' + esc(connWord(p)) + '</small></div><button type="button" class="x" data-pub="wiz" data-p="' + esc(p.id) + '" title="Cerrar" aria-label="Cerrar">✕</button></div>';
    h += "<p>" + esc(DESC[p.id] || "") + (shares.length ? " La misma app sirve para " + shares.map(function (x) { return esc(x.name); }).join(" y ") + "." : "") + "</p>";
    if (mine.length) h += "<h5>Cuentas conectadas</h5>" + mine.map(function (a) { var s = ST[a.status] || ["mute", a.status]; return '<div class="int-acc">' + logo(p, 28) + "<span><b>" + esc(a.display_name || a.username || a.external_id) + "</b><small>" + esc(a.brand_id ? brandName(a.brand_id) : "Sin cliente") + "</small></span>" + pill(s[0] === "ok" ? "ok" : "danger", s[1]) + "</div>"; }).join("");
    if (app) h += '<div class="int-acc"><span><b>Tu app de ' + esc(p.appName) + ' está guardada</b><small>Solo aprieta «Conectar» por cada cuenta o grupo de páginas</small></span>' + pill("ok", "Lista") + "</div>";
    h += "<h5>" + (mine.length ? "Sumar otra cuenta" : "Cómo conectar") + "</h5><ul>" + p.setup.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ul>";
    (p.notes || []).forEach(function (n) { h += '<div class="warnote">' + esc(n) + "</div>"; });
    if (p.developerUrl) h += '<a class="int-link" href="' + esc(p.developerUrl) + '" target="_blank" rel="noopener">Abrir el portal de ' + esc(p.name) + " ↗</a>";
    if (p.kind === "oauth") h += '<label for="pubRedir">Dirección de regreso (la misma para todas las redes)</label><div class="int-key"><input id="pubRedir" readonly value="' + esc(P.redirect) + '"><button type="button" class="btn btn-g" data-pub="copy" data-v="' + esc(P.redirect) + '">Copiar</button></div>';
    h += p.fields.map(function (f, i) {
      var val = p.kind === "oauth" && f.key === "client_id" && app ? app.client_id : "";
      var ph = p.kind === "oauth" && f.secret && app && app.has_secret ? "•••••• guardado (déjalo vacío para mantenerlo)" : (f.placeholder || "");
      return '<label for="pubF' + i + '">' + esc(f.label) + '</label><input id="pubF' + i + '" data-pub-f="' + esc(f.key) + '" type="' + (f.secret ? "password" : "text") + '" autocomplete="off" value="' + esc(val) + '" placeholder="' + esc(ph) + '">' + (f.help ? '<small class="pub-help" style="display:block;opacity:.7;margin:6px 0 12px;font-size:12px">' + esc(f.help) + '</small>' : '');
    }).join("");
    if (brands().length) h += '<label for="pubWb">Para el cliente</label>' + brandSelect('id="pubWb" data-pub-wbrand', clientOne());
    h += '<div class="pub-acts"><button type="button" class="btn btn-p" data-pub="' + (p.kind === "oauth" ? "connect" : "token") + '" data-p="' + esc(p.id) + '">' + (p.kind === "oauth" ? (app ? "Conectar una cuenta" : "Guardar y conectar") : "Validar y conectar") + "</button>"
      + (p.kind === "oauth" ? '<button type="button" class="btn btn-g" data-pub="link" data-p="' + esc(p.id) + '" title="El cliente abre el enlace, inicia sesión en su cuenta y autoriza. Sirve 7 días y una sola vez.">Enviar enlace al cliente</button>' : "") + "</div>";
    if (P.link && P.link.p === p.id) h += '<label for="pubLink">Enlace para el cliente (7 días, un solo uso)</label><div class="int-key"><input id="pubLink" readonly value="' + esc(P.link.url) + '"><button type="button" class="btn btn-g" data-pub="copy" data-v="' + esc(P.link.url) + '">Copiar</button></div><p class="int-note">Cuando el cliente autorice, su cuenta aparece aquí sola' + (P.link.brand ? ", ya asignada a " + esc(brandName(P.link.brand)) : "") + ".</p>";
    if (app) h += '<p class="int-note"><button type="button" class="int-link" style="background:none;padding:0" data-pub="unapp" data-app="' + esc(key) + '">Borrar la app guardada</button></p>';
    h += '<p class="int-note">' + (p.kind === "oauth" ? "Tus llaves viajan cifradas y nunca vuelven a mostrarse. " : "La llave se guarda cifrada y nunca vuelve a mostrarse. ") + "Nada se publica solo: sale cuando aprietas Publicar.</p>";
    return h + "</aside>";
  }
  function jobsHtml(jobs) {
    if (!jobs.length) return '<p class="empty-note" style="margin:0">Todavía no publicas nada con Musa. Abre un diseño y aprieta «Publicar en redes».</p>';
    return jobs.map(function (j) {
      var ts = j.publish_targets || [], js = JS[j.status] || j.status;
      var jc = j.status === "published" ? "ok" : j.status === "failed" ? "danger" : j.status === "partial" ? "warn" : "mute";
      return '<div class="pub-job"><img src="' + esc(j.media_url) + '" alt=""><div style="flex:1;min-width:0"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="font-size:13px;color:#111">' + esc((j.caption || "Sin texto").slice(0, 80)) + "</b>" + pill(jc, js) + (j.mode === "dry-run" ? pill("mute", "Prueba") : "") + "</div>"
        + '<small style="display:block;color:#777;font-size:11px;margin-top:2px">' + new Date(j.created_at).toLocaleString() + (j.brand_id ? " · " + esc(brandName(j.brand_id)) : "") + " · " + ts.length + " destino" + (ts.length === 1 ? "" : "s") + "</small>" + targetsHtml(ts)
        + '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">' + (ts.some(function (t) { return t.status === "failed" && t.attempts < 5; }) ? '<button type="button" class="btn btn-g mini" data-pub="retry" data-id="' + esc(j.id) + '">Reintentar los que fallaron</button>' : "")
        + (ts.some(function (t) { return t.status === "queued"; }) && j.mode === "live" ? '<button type="button" class="btn btn-p mini" data-pub="resume" data-id="' + esc(j.id) + '">Continuar envío</button>' : "") + "</div></div></div>";
    }).join("");
  }
  function targetsHtml(ts) {
    return '<div class="pub-tg">' + ts.map(function (t) {
      var p = prov(t.provider), ic = t.status === "published" ? "✓" : t.status === "failed" ? "✕" : t.status === "skipped_dry_run" ? "○" : "…";
      var col = t.status === "published" ? "var(--ok)" : t.status === "failed" ? "var(--danger)" : "#777";
      return '<span title="' + esc(t.error || (t.status === "skipped_dry_run" ? "Prueba: no se envió" : t.status)) + '">' + logo(p, 18) + esc(t.account_name || p.name) + ' <b style="color:' + col + '">' + ic + "</b>" + (t.external_url ? ' <a href="' + esc(t.external_url) + '" target="_blank" rel="noopener">ver ↗</a>' : "") + "</span>";
    }).join("") + "</div>"
      + ts.filter(function (t) { return t.error; }).slice(0, 3).map(function (t) { return '<small style="display:block;color:var(--danger);font-size:11px;margin-top:4px">' + esc(prov(t.provider).name) + ": " + esc(t.error) + "</small>"; }).join("");
  }
  function fields() { var o = {}; document.querySelectorAll("[data-pub-f]").forEach(function (i) { o[i.dataset.pubF] = i.value.trim(); }); return o; }
  function wizBrand() { var s = document.querySelector("[data-pub-wbrand]"); return s && s.value || null; }
  function refresh() { return load(true).then(draw); }
  /* sigue enviando tandas hasta terminar (muchas cuentas) */
  function drain(jobId, r, onStep) {
    var last = r.remaining;
    function step(x) {
      if (onStep) onStep(x);
      if (!x.remaining || x.status === "dry-run") return x;
      if (x.remaining >= last && x !== r) return x; // sin avance: se deja para «Continuar envío»
      last = x.remaining;
      return api("/api/publisher/jobs/" + jobId + "/run", J("POST", {}, 120000)).then(function (n) { return step({ status: n.status, remaining: n.remaining, targets: (n.data && n.data.publish_targets) || [] }); });
    }
    return Promise.resolve(step(r));
  }

  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.matches && t.matches("[data-pub-brand]")) return api("/api/publisher/accounts/" + t.dataset.pubBrand, J("PATCH", { brand_id: t.value || null })).then(function () { toast("Cliente asignado"); return refresh(); }, function (x) { toast(msg(x)); });
    if (t.matches && t.matches("[data-pub-board]")) return api("/api/publisher/accounts/" + t.dataset.pubBoard, J("PATCH", { options: { board_id: t.value } })).then(function () { toast("Tablero guardado"); return refresh(); }, function (x) { toast(msg(x)); });
  }, true);

  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-pub]"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var k = b.dataset.pub, done = function () { b.disabled = false; };
    var fail = function (x) { done(); toast(msg(x)); };
    if (k === "wiz") { P.open = P.open === b.dataset.p ? null : b.dataset.p; P.link = null; return draw(); }
    if (k === "copy") { try { navigator.clipboard.writeText(b.dataset.v); } catch (x) {} return toast("Copiado"); }
    b.disabled = true;
    var pid = b.dataset.p, f = fields(), brand = wizBrand();
    var saveApp = function () { return f.client_id && (f.client_id !== ((P.apps[prov(pid).appKey] || {}).client_id) || f.client_secret) ? api("/api/publisher/apps", J("POST", { workspaceId: ws(), app: prov(pid).appKey, client_id: f.client_id, client_secret: f.client_secret || "" })) : Promise.resolve(); };
    if (k === "token") {
      return api("/api/publisher/accounts/token", J("POST", { workspaceId: ws(), provider: pid, input: f, brandId: brand }, 30000))
        .then(function () { toast("Cuenta conectada"); P.open = null; return refresh(); }, fail);
    }
    if (k === "connect") {
      // la ventana se abre ya (dentro del clic) para que el navegador no la bloquee
      var win = window.open("about:blank", "musa-pub-oauth", "width=600,height=760");
      return saveApp().then(function () { return api("/api/publisher/oauth/" + pid + "/start", J("POST", { workspaceId: ws(), brandId: brand })); })
        .then(function (r) { done(); if (win) win.location.href = r.url; else location.href = r.url; toast("Autoriza a Musa en la ventana de " + prov(pid).name); },
          function (x) { if (win) win.close(); fail(x); });
    }
    if (k === "link") {
      return saveApp().then(function () { return api("/api/publisher/oauth/" + pid + "/link", J("POST", { workspaceId: ws(), brandId: brand })); })
        .then(function (r) { done(); P.link = { p: pid, url: r.url, brand: brand }; return load(true).then(draw); }, fail);
    }
    if (k === "unapp") { return window.__musaReal.confirmBox("Las cuentas ya conectadas con ella no podrán renovar su conexión.", { title: "¿Borrar la app guardada?", danger: true, ok: "Borrar" }).then(function (ok) { if (!ok) return done(); return api(q("/api/publisher/apps/" + b.dataset.app), { method: "DELETE" }).then(refresh, fail); }); }
    if (k === "check") return api("/api/publisher/accounts/" + b.dataset.id + "/check", J("POST", {}, 30000)).then(function (r) { toast(r.data && r.data.status === "active" ? "La conexión funciona" : "Revisa el error de la cuenta"); return refresh(); }, fail);
    if (k === "del") { return window.__musaReal.confirmBox("Deja de publicarse en ella hasta que la vuelvas a conectar.", { title: "¿Quitar esta cuenta de Musa?", danger: true, ok: "Quitar" }).then(function (ok) { if (!ok) return done(); return api("/api/publisher/accounts/" + b.dataset.id, { method: "DELETE" }).then(function () { toast("Cuenta quitada"); return refresh(); }, fail); }); }
    if (k === "sr") { var inp = document.querySelector('[data-pub-sr="' + b.dataset.id + '"]'); return api("/api/publisher/accounts/" + b.dataset.id, J("PATCH", { options: { subreddit: inp ? inp.value : "" } })).then(function () { toast("Guardado"); return refresh(); }, fail); }
    if (k === "retry" || k === "resume") {
      var path = "/api/publisher/jobs/" + b.dataset.id + (k === "retry" ? "/retry" : "/run");
      toast("Enviando…");
      return api(path, J("POST", {}, 120000)).then(function (r) { return drain(b.dataset.id, { status: r.status, remaining: r.remaining }); })
        .then(function (r) { toast(r.status === "published" ? "Listo: publicado" : "Envío terminado"); return refresh(); }, fail);
    }
    done();
  }, true);

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.type !== "musa-publisher") return;
    toast(d.ok ? d.message : "No se pudo conectar: " + d.message);
    if (d.ok) P.open = null;
    load(true).then(function () { if (/configuracion\/publicar/.test(location.hash)) draw(); if (M && !M.result) drawModal(); });
  });

  /* ───────── modal «Publicar en redes» ───────── */
  var M = null;
  function openPublish(getMedia, opts) {
    opts = opts || {};
    if (typeof mx !== "function") return toast("No se pudo abrir la ventana de publicar");
    M = { getMedia: getMedia, caption: opts.caption || "", captions: {}, perNet: false, sel: {}, mode: "dry-run", busy: false, result: null, progress: "", brand: opts.brand_id || "", template_id: opts.template_id || null, content_id: opts.content_id || null, showAll: !opts.brand_id };
    mx("Publicar en redes", "Con Musa Publisher. Por defecto en modo Prueba: no sale nada hasta que elijas «En vivo».", '<p class="empty-note">Cargando cuentas…</p>', modalClick);
    load(true).then(function () {
      // diseño de un cliente: sus cuentas quedan marcadas
      if (M.brand) P.accounts.forEach(function (a) { if (a.status === "active" && a.brand_id === M.brand) M.sel[a.id] = true; });
      drawModal();
    }, function (e) { setBody('<p class="empty-note">' + esc(msg(e)) + "</p>"); });
  }
  function setBody(h) { var el = document.getElementById("mxBody"); if (el) el.innerHTML = h; }
  function selected() { return P.accounts.filter(function (a) { return M.sel[a.id]; }); }
  function selProviders() { var o = {}; selected().forEach(function (a) { o[a.provider] = 1; }); return Object.keys(o); }
  function textFor(pid) { return M.perNet && typeof M.captions[pid] === "string" ? M.captions[pid] : M.caption; }
  function counters() {
    var ps = selProviders(), lim = ps.map(function (p) { return prov(p).limits.maxChars; }), n = M.caption.length, el = document.getElementById("pubCount");
    var min = lim.length ? Math.min.apply(null, lim) : null;
    if (el) { el.textContent = n + (min && !M.perNet ? " / " + min : "") + " caracteres" + (M.perNet ? " (texto general)" : ""); el.style.color = min && !M.perNet && n > min ? "var(--danger,#c33)" : "#777"; }
    document.querySelectorAll("[data-pm-cc]").forEach(function (c) { var p = prov(c.dataset.pmCc), t = textFor(p.id); c.textContent = t.length + " / " + p.limits.maxChars; c.style.color = t.length > p.limits.maxChars ? "var(--danger,#c33)" : "#777"; });
  }
  function drawModal() {
    if (!M) return;
    if (M.result) {
      var r = M.result, n = (r.targets || []).length, ok = (r.targets || []).filter(function (t) { return t.status === "published"; }).length;
      return setBody('<p style="margin:0 0 8px"><b>' + (r.mode === "dry-run" || !r.live ? "Prueba hecha: no se envió nada a las redes." : (JS[r.status] || r.status) + " · " + ok + " de " + n) + "</b>" + (r.remaining ? " · faltan " + r.remaining + ' (aprieta «Continuar envío» en Configuración › Publicar)' : "") + "</p>" + targetsHtml(r.targets || [])
        + '<div class="ag-ctl" style="margin-top:12px">' + ((r.targets || []).some(function (t) { return t.status === "failed"; }) ? '<button data-pm="retry">Reintentar los que fallaron</button>' : "")
        + (r.mode === "dry-run" && P.live ? '<button class="pri" data-pm="golive">Publicar en vivo ahora</button>' : "") + '<button data-pm="cfg">Ver en Configuración › Publicar</button></div>');
    }
    if (M.busy) return setBody('<p class="empty-note">' + esc(M.progress || "Publicando…") + "</p>");
    if (!P.accounts.length) return setBody('<p class="empty-note">Todavía no conectas cuentas.</p><div class="ag-ctl"><button class="pri" data-pm="cfg">Conectar redes</button></div>');
    var act = P.accounts.filter(function (a) { return a.status === "active" && (M.showAll || !M.brand || a.brand_id === M.brand || !a.brand_id); });
    var byBrand = {}; act.forEach(function (a) { var k = a.brand_id || ""; (byBrand[k] = byBrand[k] || []).push(a); });
    var order = Object.keys(byBrand).sort(function (a, b) { return (a === M.brand ? -1 : b === M.brand ? 1 : 0) || (a === "" ? 1 : b === "" ? -1 : 0) || String(brandName(a)).localeCompare(String(brandName(b))); });
    var n = selected().length;
    var h = '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><label class="fx-lbl" style="margin:0">Cuentas · ' + n + " elegidas (máx. " + P.max + ")</label>"
      + (M.brand ? '<label style="font-size:12px;display:flex;gap:6px;align-items:center"><input type="checkbox" data-pm-all' + (M.showAll ? " checked" : "") + "> Ver cuentas de otros clientes</label>" : "") + "</div>";
    h += '<div style="max-height:46vh;overflow:auto;margin:6px 0 10px">' + order.map(function (bk) {
      var list = byBrand[bk];
      return '<div style="border:1px solid #e4e2d6;border-radius:12px;padding:8px 10px;margin:6px 0"><div style="display:flex;justify-content:space-between;align-items:center;gap:6px"><b style="font-size:13px">' + esc(brandName(bk)) + '</b><button data-pm="selb" data-b="' + esc(bk) + '" style="font-size:12px">Elegir todas</button></div>'
        + list.map(function (a) {
          var p = prov(a.provider);
          return '<label class="fx-chk" style="display:flex;gap:8px;align-items:center;margin:3px 0"><input type="checkbox" data-pm-a="' + esc(a.id) + '"' + (M.sel[a.id] ? " checked" : "") + '> ' + logo(p, 24) + '<span>' + esc(a.display_name || a.username) + ' <small style="color:#777">' + esc(p.name) + (a.provider === "reddit" ? " → " + esc((a.options || {}).subreddit || "") : "") + "</small></span></label>";
        }).join("") + "</div>";
    }).join("") + "</div>";
    var off = P.accounts.filter(function (a) { return a.status !== "active"; }).length;
    if (off) h += '<p style="font-size:12px;color:#6b5a00;margin:0 0 8px">' + off + " cuenta(s) necesitan reconectarse y no aparecen.</p>";
    h += '<label class="fx-lbl">Texto</label><textarea class="fx-in" id="pubCap" rows="4" style="resize:vertical">' + esc(M.caption) + '</textarea><small id="pubCount"></small>';
    var ps = selProviders();
    if (ps.length > 1 || M.perNet) h += '<label style="display:flex;gap:6px;align-items:center;font-size:13px;margin:8px 0"><input type="checkbox" data-pm-per' + (M.perNet ? " checked" : "") + "> Texto distinto por red</label>";
    if (M.perNet) h += ps.map(function (pid) { var p = prov(pid); return '<div style="margin:6px 0"><label class="fx-lbl">' + esc(p.name) + ' <small data-pm-cc="' + esc(pid) + '"></small></label><textarea class="fx-in" rows="3" data-pm-c="' + esc(pid) + '">' + esc(textFor(pid)) + "</textarea></div>"; }).join("");
    var notes = ps.filter(function (pid) { return /reddit|pinterest|wordpress|ghost|blogger|devto|hashnode|listmonk/.test(pid); });
    if (notes.length) h += '<p style="font-size:12px;color:#777;margin:4px 0">En ' + notes.map(function (pid) { return prov(pid).name; }).join(", ") + " la primera línea del texto es el título.</p>";
    if (ps.indexOf("instagram") >= 0) h += '<p style="font-size:12px;color:#777;margin:4px 0">Instagram recibe la imagen en JPG; proporción entre 4:5 y 1.91:1.</p>';
    h += '<div class="seg" style="margin:10px 0"><button data-pm="mode" data-v="dry-run" class="' + (M.mode === "dry-run" ? "on" : "") + '">Prueba</button><button data-pm="mode" data-v="live" class="' + (M.mode === "live" ? "on" : "") + '"' + (P.live ? "" : ' disabled title="El envío real está apagado en el servidor"') + ">En vivo</button></div>";
    h += '<div class="ag-ctl"><button class="pri" data-pm="go">' + (M.mode === "live" ? "Publicar ahora" : "Hacer la prueba") + "</button></div>";
    setBody(h); counters();
  }
  function modalClick(e) {
    if (!M) return;
    var a = e.target.closest("[data-pm-a]");
    if (a) { if (a.checked && selected().length >= P.max) { a.checked = false; return toast("Máximo " + P.max + " cuentas"); } M.sel[a.dataset.pmA] = a.checked; return drawModal(); }
    if (e.target.closest("[data-pm-all]")) { M.showAll = e.target.checked; return drawModal(); }
    if (e.target.closest("[data-pm-per]")) { M.perNet = e.target.checked; return drawModal(); }
    var b = e.target.closest("[data-pm]"); if (!b) return;
    var k = b.dataset.pm;
    if (k === "cfg") { document.querySelectorAll(".mx").forEach(function (x) { x.hidden = true; }); location.hash = "configuracion/publicar"; return; }
    if (k === "mode") { M.mode = b.dataset.v; return drawModal(); }
    if (k === "selb") { var all = P.accounts.filter(function (x) { return x.status === "active" && (x.brand_id || "") === b.dataset.b; }); var on = !all.every(function (x) { return M.sel[x.id]; }); all.forEach(function (x) { M.sel[x.id] = on; }); if (selected().length > P.max) { all.forEach(function (x) { M.sel[x.id] = false; }); toast("Máximo " + P.max + " cuentas"); } return drawModal(); }
    if (k === "golive") { M.result = null; M.mode = "live"; return drawModal(); }
    if (k === "retry") {
      b.disabled = true;
      return api("/api/publisher/jobs/" + M.result.job_id + "/retry", J("POST", {}, 120000)).then(function (r) { return drain(M.result.job_id, { status: r.status, remaining: r.remaining, targets: (r.data && r.data.publish_targets) || [] }); })
        .then(function () { return api("/api/publisher/jobs/" + M.result.job_id); }).then(function (r) { M.result.targets = r.data.publish_targets; M.result.status = r.data.status; drawModal(); }, function (x) { b.disabled = false; toast(msg(x)); });
    }
    if (k === "go") {
      var sel = selected(), ps = selProviders();
      if (!sel.length) return toast("Elige al menos una cuenta");
      for (var i = 0; i < ps.length; i++) { var p = prov(ps[i]); if (textFor(p.id).length > p.limits.maxChars) return toast("El texto para " + p.name + " pasa de " + p.limits.maxChars + " caracteres" + (M.perNet ? "" : ": usa «Texto distinto por red»")); }
      return (M.mode === "live" ? window.__musaReal.confirmBox("Esto sale de verdad a las redes.", { title: "¿Publicar ahora en " + sel.length + " cuenta(s)?", ok: "Publicar ahora", action: "publish-live" }) : Promise.resolve(true)).then(function (ok) { if (!ok) return;
      var needSmall = ps.some(function (pid) { return prov(pid).limits.maxBytes < 2 * 1048576; });
      var captions = {}; if (M.perNet) ps.forEach(function (pid) { if (typeof M.captions[pid] === "string") captions[pid] = M.captions[pid]; });
      M.busy = true; M.progress = "Preparando la imagen…"; drawModal();
      var media = M.media ? Promise.resolve(M.media) : Promise.resolve().then(M.getMedia).then(function (m) { M.media = m; return m; });
      media.then(function (m) {
        return (needSmall && !m.small ? smallVersion(m.dataUrl).then(function (d) { return RB.uploadData(d, "publicar-liviana-" + Date.now() + ".jpg"); }).then(function (u) { m.small = u; return m; }) : Promise.resolve(m));
      }).then(function (m) {
        M.progress = "Publicando en " + sel.length + " cuenta(s)…"; drawModal();
        return api("/api/publisher/publish", J("POST", { workspaceId: ws(), media_url: m.url, media_small_url: m.small || null, media_mime: "image/jpeg", caption: M.caption, captions: captions, account_ids: sel.map(function (x) { return x.id; }), mode: M.mode, template_id: M.template_id, content_id: M.content_id, brand_id: M.brand || null }, 120000));
      }).then(function (r) {
        M.result = r;
        return drain(r.job_id, r, function (x) { if (x.targets && x.targets.length) M.result.targets = x.targets; M.result.status = x.status; M.result.remaining = x.remaining; if (x.remaining) { M.progress = "Publicando… faltan " + x.remaining; } });
      }).then(function () { M.busy = false; drawModal(); }, function (x) { M.busy = false; drawModal(); toast(msg(x)); });
    });
    }
  }
  modalClick.input = function (e) {
    if (!M) return;
    if (e.target.id === "pubCap") { M.caption = e.target.value; counters(); }
    if (e.target.dataset && e.target.dataset.pmC) { M.captions[e.target.dataset.pmC] = e.target.value; counters(); }
  };

  /* imagen liviana (≤ ~950 KB) para redes con tope de 1 MB, como Bluesky */
  function smallVersion(dataUrl) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.onload = function () {
        var s = Math.min(1, 1600 / Math.max(im.width, im.height)), c = document.createElement("canvas");
        c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
        var ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(im, 0, 0, c.width, c.height);
        var qy = 0.85, d = c.toDataURL("image/jpeg", qy);
        while (d.length * 0.75 > 950 * 1024 && qy > 0.35) { qy -= 0.1; d = c.toDataURL("image/jpeg", qy); }
        res(d);
      };
      im.onerror = function () { rej(new Error("No se pudo preparar la imagen liviana")); };
      im.src = dataUrl;
    });
  }
  /* diseño → JPG público de Musa (JPG sirve para todas las redes, Instagram incluido) */
  function uploadShot(dataUrlPromise) {
    return dataUrlPromise.then(function (d) {
      if (!RB.uploadData) throw new Error("No cargó la subida de archivos");
      return RB.uploadData(d, "publicar-" + Date.now() + ".jpg").then(function (u) { return { url: u, dataUrl: d }; });
    });
  }
  RB.openPublish = openPublish;

  /* botón en el editor, junto a Compartir */
  function editorButton() {
    var share = document.querySelector('.ed-tb[data-menu="compartir"]');
    if (!share || document.getElementById("edPublish")) return;
    var btn = document.createElement("button"); btn.className = "ed-tb"; btn.id = "edPublish"; btn.title = "Publicar este diseño en tus redes con Musa Publisher"; btn.textContent = "Publicar en redes";
    btn.onclick = function (e) {
      e.preventDefault(); e.stopPropagation();
      if (typeof ED === "undefined" || !ED.doc || !ED.doc._real) return toast("Abre un diseño guardado para publicarlo");
      var f = ED.doc.frames[ED.sel ? ED.sel.f : 0] || ED.doc.frames[0];
      openPublish(function () { return uploadShot(RB.shotFrame(f)); }, { template_id: ED.doc._id, brand_id: brandIdByName(ED.doc.brand) });
    };
    share.parentNode.insertBefore(btn, share.nextSibling);
  }

  /* botón en las piezas del calendario con diseño */
  function calendarHooks() {
    if (typeof pzPreview !== "function" || typeof pzClick !== "function" || calendarHooks.done) return;
    calendarHooks.done = true;
    var _prev = pzPreview;
    pzPreview = function (p) {
      var html = _prev.apply(this, arguments);
      if (!p || !p.tpl) return html;
      return html.replace(/(<button data-pza="open"[^>]*>[^<]*<\/button>)/, '$1<button data-pza="pub">Publicar en redes</button>');
    };
    var _click = pzClick;
    pzClick = function (e) {
      var bt = e.target.closest && e.target.closest('[data-pza="pub"]');
      var p = bt && typeof pzCur === "function" ? pzCur() : null;
      if (!bt || !p || !p.tpl) return _click.apply(this, arguments);
      openPublish(function () {
        return uploadShot(api("/rest/v1/templates?id=eq." + encodeURIComponent(p.tpl) + "&select=id,name,data").then(function (rows) {
          var t = rows && rows[0]; if (!t) throw new Error("No encontré el diseño");
          var d = t.data || {}, src = Array.isArray(d.frames) && d.frames.length ? d.frames[0] : { html: d.html || "", css: d.css || "", width: d.width, height: d.height, background: "#ffffff" };
          if (!RB.shotSrc) throw new Error("No cargó el editor de diseño");
          return RB.shotSrc(src);
        }));
      }, { caption: p.copy || "", template_id: p.tpl, content_id: p.db || null, brand_id: brandIdByName(p.brand) });
      return true;
    };
  }

  function install() {
    if (typeof VIEWS2 === "undefined" || typeof modById !== "function" || typeof drawView !== "function") return setTimeout(install, 120);
    var m = modById("configuracion");
    if (m && !m.subs.some(function (s) { return s[0] === "publicar"; })) {
      var at = m.subs.findIndex(function (s) { return s[0] === "integraciones"; });
      m.subs.splice(at < 0 ? m.subs.length : at + 1, 0, ["publicar", "Publicar", "publisher"]);
    }
    VIEWS2.publisher = view;
    calendarHooks();
    var _draw = drawView;
    drawView = function () { var r = _draw.apply(this, arguments); editorButton(); return r; };
    var pending = false;
    new MutationObserver(function () { if (pending) return; pending = true; requestAnimationFrame(function () { pending = false; editorButton(); }); }).observe(document.body, { childList: true, subtree: true });
    if (/configuracion\/publicar/.test(location.hash)) drawView();
    if (typeof drawNav === "function") try { drawNav(); } catch (e) {}
  }
  if (RB) install();
})();
