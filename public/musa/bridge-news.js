/* bridge-news.js — la campana de la barra superior: novedades de Musa.
 * Las publica un admin de la plataforma (product_news) y les llegan a todas las cuentas a la vez.
 * Cada persona tiene su propio "sin leer" (product_news_reads): el número naranja de la campana
 * es lo que se publicó y esa persona todavía no abrió. Leer = abrir la novedad o "Marcar todo".
 * Lo leído no desaparece: queda en gris, para volver a verlo.
 * Se actualiza al entrar, al volver a la pestaña y cada 5 minutos (una sola llamada liviana).
 */
(function () {
  var R = window.__musaReal;
  if (!R) return;
  var N = { items: [], unread: 0, admin: false, open: false, expanded: {}, loaded: false };
  var TAGS = { novedad: "Novedad", mejora: "Mejora", arreglo: "Arreglo", aviso: "Aviso" };
  function bridge() { try { return window.parent.__musaBridge; } catch (e) { return null; } }
  function rpc(fn, body) { var b = bridge(); return b ? b.api("/rest/v1/rpc/" + fn, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }) : Promise.reject(new Error("sin sesión")); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function when(iso) {
    var d = new Date(iso), days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days <= 0) return "hoy"; if (days === 1) return "ayer"; if (days < 7) return "hace " + days + " días";
    return d.toLocaleDateString("es-PE", { day: "numeric", month: "short" });
  }
  /* texto simple: párrafos y **negrita**, todo escapado */
  function body(t) { return esc(t).split(/\n{2,}/).map(function (p) { return "<p>" + p.replace(/\n/g, "<br>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>") + "</p>"; }).join(""); }

  var css = ".nw-badge{position:absolute;top:-6px;right:-6px;min-width:18px;height:18px;padding:0 5px;box-sizing:border-box;border-radius:9px;background:var(--accent,#ff5e00);color:#fff;font:800 10px/18px var(--sans,Inter,sans-serif);text-align:center;font-variant-numeric:tabular-nums;box-shadow:0 0 0 2px var(--bg,#070707);pointer-events:none}" +
    ".nw-pop{position:fixed;z-index:400;width:min(400px,calc(100vw - 24px));max-height:min(70vh,640px);display:flex;flex-direction:column;background:#f4f3ea;color:#111;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.45);overflow:hidden;font:14px/1.45 var(--sans,Inter,sans-serif)}" +
    ".nw-hd{display:flex;align-items:center;gap:8px;padding:14px 16px 10px;border-bottom:1px solid #e2e0d3}.nw-hd h3{margin:0;font-size:15px;font-weight:800;flex:1}" +
    ".nw-hd button,.nw-ft button{border:0;background:none;color:#c24800;font:700 12px var(--sans,Inter,sans-serif);cursor:pointer;padding:6px 8px;border-radius:8px;min-height:32px}.nw-hd button:hover,.nw-ft button:hover{background:#e9e7da}" +
    ".nw-list{overflow:auto;overscroll-behavior:contain;padding:6px}" +
    ".nw-it{display:block;width:100%;text-align:left;border:0;background:transparent;border-radius:12px;padding:10px 12px 10px 26px;position:relative;cursor:pointer;color:#555;font:inherit}" +
    ".nw-it:hover{background:#ebe9dd}.nw-it:focus-visible{outline:2px solid var(--accent,#ff5e00);outline-offset:-2px}" +
    ".nw-it.un{color:#111;background:#fff}.nw-it.un:hover{background:#fbfaf5}.nw-it.un::before{content:'';position:absolute;left:11px;top:16px;width:7px;height:7px;border-radius:50%;background:var(--accent,#ff5e00)}" +
    ".nw-it+.nw-it{margin-top:4px}.nw-meta{display:flex;gap:8px;align-items:center;font-size:11px;color:#777;margin-bottom:3px}" +
    ".nw-tag{font-weight:800;text-transform:uppercase;letter-spacing:.04em;font-size:10px;padding:2px 7px;border-radius:99px;background:#e2e0d3;color:#333}.nw-tag.novedad{background:#ffe2cf;color:#9a3a00}.nw-tag.arreglo{background:#e1e1ff;color:#1616a8}.nw-tag.aviso{background:#fde0de;color:#a01d17}" +
    ".nw-it b.t{display:block;font-size:14px;font-weight:700;color:inherit}.nw-it.un b.t{font-weight:800}" +
    ".nw-bd{font-size:13px;margin-top:4px;color:#333}.nw-bd p{margin:0 0 6px}.nw-it:not(.ex) .nw-bd{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.nw-it:not(.ex) .nw-bd p{display:inline;margin:0}" +
    ".nw-row{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}.nw-row a,.nw-row span[role=button]{font:700 12px var(--sans,Inter,sans-serif);color:#fff;background:#111;border-radius:99px;padding:6px 12px;text-decoration:none;cursor:pointer}.nw-row span.sec{background:#e2e0d3;color:#111}" +
    ".nw-empty{padding:28px 18px;text-align:center;color:#666;font-size:13px}.nw-ft{border-top:1px solid #e2e0d3;padding:6px 10px;display:flex;justify-content:flex-end}" +
    "@media (max-width:520px){.nw-pop{left:12px!important;right:12px;width:auto;top:58px!important}}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  function bell() { return document.querySelector('header.top .icon-btn[aria-label^="Notificaciones"], header.top .icon-btn[data-news]'); }
  function paintBadge() {
    var b = bell(); if (!b) return;
    b.setAttribute("data-news", "1"); b.setAttribute("data-action", "novedades");
    b.setAttribute("aria-haspopup", "dialog"); b.setAttribute("aria-expanded", N.open ? "true" : "false");
    b.title = N.unread ? N.unread + " novedad" + (N.unread === 1 ? "" : "es") + " sin leer" : "Novedades";
    b.setAttribute("aria-label", "Notificaciones" + (N.unread ? ": " + N.unread + " sin leer" : ""));
    var old = b.querySelector("i"); if (old) old.remove(); // el punto fijo de la maqueta
    var bd = b.querySelector(".nw-badge");
    if (!N.unread) { if (bd) bd.remove(); return; }
    if (!bd) { bd = document.createElement("span"); bd.className = "nw-badge"; bd.setAttribute("aria-hidden", "true"); b.appendChild(bd); }
    bd.textContent = N.unread > 9 ? "9+" : String(N.unread);
  }
  function apply(r) { N.items = (r && r.items) || []; N.unread = (r && r.unread) || 0; N.admin = !!(r && r.is_admin); N.loaded = true; paintBadge(); if (N.open) draw(); }
  function load() { return rpc("v2_news_feed").then(apply, function () {}); }
  function markRead(ids) {
    // se ve al instante y se guarda atrás
    N.items.forEach(function (it) { if (!ids || ids.indexOf(it.id) >= 0) it.read = true; });
    N.unread = N.items.filter(function (it) { return !it.read; }).length; paintBadge(); if (N.open) draw();
    return rpc("v2_news_read", { p_ids: ids || null }).then(apply, function () {});
  }

  var pop = null;
  function draw() {
    if (!pop) return;
    var list = N.items.map(function (it) {
      var ex = !!N.expanded[it.id], link = it.link ? (/^#/.test(it.link) ? '<a href="' + esc(it.link) + '" data-nw-go>Ver</a>' : '<a href="' + esc(it.link) + '" target="_blank" rel="noopener">Ver más</a>') : "";
      return '<div class="nw-it' + (it.read ? "" : " un") + (ex ? " ex" : "") + '" role="button" tabindex="0" aria-expanded="' + ex + '" data-nw="' + esc(it.id) + '">'
        + '<div class="nw-meta"><span class="nw-tag ' + esc(it.tag) + '">' + esc(TAGS[it.tag] || it.tag) + "</span><span>" + esc(when(it.published_at)) + "</span>" + (it.read ? "" : '<span class="sr" style="position:absolute;left:-9999px">sin leer</span>') + "</div>"
        + '<b class="t">' + esc(it.title) + "</b>" + (it.body ? '<div class="nw-bd">' + body(it.body) + "</div>" : "")
        + (ex && (link || N.admin) ? '<div class="nw-row">' + link + (N.admin ? '<span role="button" class="sec" data-nw-edit="' + esc(it.id) + '">Editar</span><span role="button" class="sec" data-nw-del="' + esc(it.id) + '">Quitar</span>' : "") + "</div>" : "")
        + "</div>";
    }).join("");
    pop.innerHTML = '<div class="nw-hd"><h3 id="nwT">Novedades</h3>' + (N.unread ? '<button type="button" data-nw-all data-action="marcar-todo-leido">Marcar todo como leído</button>' : "") + "</div>"
      + '<div class="nw-list">' + (list || '<div class="nw-empty">' + (N.loaded ? "Todavía no hay novedades. Cuando Musa estrene algo, aparece aquí." : "Cargando…") + "</div>") + "</div>"
      + (N.admin ? '<div class="nw-ft"><button type="button" data-nw-new data-action="publicar-novedad">+ Publicar novedad</button></div>' : "");
  }
  function place() {
    var b = bell(); if (!b || !pop) return;
    var r = b.getBoundingClientRect(), w = Math.min(400, innerWidth - 24);
    pop.style.top = r.bottom + 8 + "px"; pop.style.left = Math.max(12, Math.min(r.right - w, innerWidth - w - 12)) + "px";
  }
  function open() {
    if (pop) return close();
    N.open = true;
    pop = document.createElement("div"); pop.className = "nw-pop"; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-labelledby", "nwT"); pop.setAttribute("data-musa-dialog", "novedades");
    document.body.appendChild(pop); draw(); place(); paintBadge();
    var first = pop.querySelector(".nw-it.un, .nw-it, button"); if (first) first.focus();
    load();
  }
  function close() { if (!pop) return; pop.remove(); pop = null; N.open = false; N.expanded = {}; paintBadge(); var b = bell(); if (b) b.focus(); }

  function editor(it) {
    return R.dialog({ title: it ? "Editar novedad" : "Publicar novedad", action: "news-edit", ok: it ? "Guardar" : "Publicar para todos", wide: true,
      message: it ? "" : "Les llega a todas las cuentas de Musa al mismo tiempo, con su número en la campana.",
      fields: [
        { name: "title", label: "Título", value: it ? it.title : "", required: true, placeholder: "Ej. Ya puedes importar un ZIP con tu HTML" },
        { name: "body", label: "Detalle", type: "textarea", rows: 6, value: it ? it.body : "", placeholder: "Qué cambia y para qué le sirve a la persona. **negrita** permitido." },
        { name: "tag", label: "Tipo", type: "select", value: it ? it.tag : "novedad", options: [{ value: "novedad", label: "Novedad" }, { value: "mejora", label: "Mejora" }, { value: "arreglo", label: "Arreglo" }, { value: "aviso", label: "Aviso" }] },
        { name: "link", label: "Enlace (opcional)", value: it ? it.link || "" : "", placeholder: "#crear/disenos o https://…", hint: "Una sección de Musa (empieza con #) o una página https." },
      ],
      validate: function (v) { return v.link && !/^(https:\/\/|#)/.test(v.link.trim()) ? "El enlace debe empezar con # o https://" : ""; } })
      .then(function (v) {
        if (!v) return;
        return rpc("v2_news_admin", { p_action: "upsert", p: { id: it ? it.id : null, title: v.title, body: v.body, tag: v.tag, link: v.link } })
          .then(function () { if (typeof uiToast === "function") uiToast(it ? "Novedad guardada" : "Novedad publicada para todos"); return load(); }, function (e) { R.notice("No se pudo guardar", String(e && e.message || e).replace(/^API error:\s*\d+\s*[·:—-]?\s*/, "")); });
      });
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("header.top .icon-btn[data-news]");
    if (b) { e.preventDefault(); e.stopPropagation(); open(); return; }
    if (!pop) return;
    if (!pop.contains(e.target)) { if (!e.target.closest("[data-musa-dialog]")) close(); return; }
    var t;
    if (e.target.closest("[data-nw-all]")) return markRead(null);
    if (e.target.closest("[data-nw-new]")) { close(); return editor(null); }
    if ((t = e.target.closest("[data-nw-edit]"))) { var it = N.items.find(function (x) { return x.id === t.getAttribute("data-nw-edit"); }); close(); return editor(it); }
    if ((t = e.target.closest("[data-nw-del]"))) {
      var id = t.getAttribute("data-nw-del"); close();
      return R.confirmBox("Deja de verse en la campana de todas las cuentas.", { title: "¿Quitar esta novedad?", danger: true, ok: "Quitar" }).then(function (ok) { if (ok) return rpc("v2_news_admin", { p_action: "remove", p: { id: id } }).then(load); });
    }
    if (e.target.closest("[data-nw-go]")) { close(); return; } // el enlace interno navega solo
    if ((t = e.target.closest("[data-nw]"))) {
      var nid = t.getAttribute("data-nw"), item = N.items.find(function (x) { return x.id === nid; });
      N.expanded[nid] = !N.expanded[nid];
      if (item && !item.read) markRead([nid]); else draw();
    }
  }, true);
  document.addEventListener("keydown", function (e) {
    if (!pop) return;
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches(".nw-it")) { e.preventDefault(); e.target.click(); }
  });
  addEventListener("resize", place);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
  setInterval(function () { if (!document.hidden) load(); }, 5 * 60 * 1000);
  /* la barra se vuelve a pintar al cambiar de vista: el número se repone */
  var top = document.querySelector("header.top");
  if (top) new MutationObserver(function () { var b = bell(); if (b && (!b.hasAttribute("data-news") || (N.unread && !b.querySelector(".nw-badge")) || b.querySelector("i"))) paintBadge(); })
    .observe(top, { childList: true, subtree: true });
  R.news = { load: load, open: open, close: close, state: N };
  load();
})();
