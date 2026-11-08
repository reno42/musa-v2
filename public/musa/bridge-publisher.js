/* bridge-publisher.js — Musa Publisher (motor social propio, convive con Zernio).
 * · Configuración › Publicar: redes con su estado, asistente paso a paso por red
 *   (app de developer + Conectar por OAuth, o token pegado), cuentas y últimas publicaciones.
 * · «Publicar en redes» en el editor de diseño y en las piezas del calendario: elige cuentas,
 *   escribe el texto (contador según la red más chica), Prueba / En vivo (por defecto Prueba)
 *   y ve el resultado por destino con su enlace.
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

  var P = { providers: null, live: false, max: 6, apps: {}, accounts: [], jobs: [], open: null, loading: null, ws: null };
  var ST = { active: ["ok", "Conectada"], expired: ["warn", "Venció: reconecta"], error: ["bad", "Con error"] };
  var JS = { published: "Publicado", partial: "Parcial", failed: "Falló", "dry-run": "Prueba", running: "Enviando", queued: "En cola" };

  function load(force) {
    if (P.loading && !force && P.ws === ws()) return P.loading;
    P.ws = ws();
    P.loading = Promise.all([
      api("/api/publisher/providers"),
      api(q("/api/publisher/apps")).catch(function () { return { data: [] }; }),
      api(q("/api/publisher/accounts")).catch(function () { return { data: [] }; }),
      api(q("/api/publisher/jobs?limit=10")).catch(function () { return { data: [] }; }),
    ]).then(function (r) {
      P.providers = r[0].data || []; P.live = !!r[0].live; P.max = r[0].maxTargets || 6;
      P.apps = {}; (r[1].data || []).forEach(function (a) { P.apps[a.provider] = a; });
      P.accounts = r[2].data || []; P.jobs = r[3].data || [];
      return P;
    });
    P.loading.catch(function () { P.loading = null; });
    return P.loading;
  }
  function prov(id) { return (P.providers || []).find(function (p) { return p.id === id; }) || { id: id, name: id, color: "#888", limits: { maxChars: 280 } }; }
  function pill(cls, t) { return '<span class="pill ' + cls + '">' + esc(t) + "</span>"; }
  function badge(p) { return '<span style="display:inline-grid;place-items:center;width:30px;height:30px;border-radius:9px;background:' + esc(p.color) + ';color:#fff;font:800 13px/1 var(--sans)">' + esc(p.name.slice(0, 1)) + "</span>"; }

  /* ───────── Configuración › Publicar ───────── */
  function view() {
    var body = document.getElementById("body"); if (!body) return;
    if (!P.providers) body.innerHTML = '<div class="grid"><article class="card c12"><p class="empty-note">Cargando redes…</p></article></div>';
    load().then(draw, function (e) { body.innerHTML = '<div class="grid"><article class="card c12"><p class="empty-note">No se pudo cargar el Publisher: ' + esc(msg(e)) + "</p></article></div>"; });
  }
  function draw() {
    var body = document.getElementById("body"); if (!body || !/configuracion\/publicar/.test(location.hash)) return;
    var h = '<div class="ws-note">Publica tus diseños de Musa en tus redes, a varias cuentas a la vez. Conectas tus propias cuentas (con tu app de developer o el token de tu bot) y nada se publica solo: sale cuando aprietas Publicar. Por ahora solo imágenes.'
      + (P.live ? "" : " <b>El envío real está apagado en el servidor: todo se hace en modo Prueba.</b>") + "</div>";
    h += '<div class="grid">';
    h += '<article class="card c12"><div class="ch"><h3>Redes</h3><small>Toca una red para conectarla paso a paso</small></div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px">'
      + P.providers.map(function (p) {
        var accs = P.accounts.filter(function (a) { return a.provider === p.id; }), bad = accs.filter(function (a) { return a.status !== "active"; }).length;
        var st = accs.length ? (bad ? pill("warn", bad + " por revisar") : pill("ok", accs.length + (accs.length === 1 ? " cuenta" : " cuentas"))) : pill("", "Sin conectar");
        return '<button data-pub="wiz" data-p="' + esc(p.id) + '" style="text-align:left;border:1.5px solid ' + (P.open === p.id ? "var(--accent)" : "#d6d4c6") + ';border-radius:14px;padding:12px;background:none;display:flex;gap:10px;align-items:center;cursor:pointer">' + badge(p)
          + '<span style="flex:1"><b style="display:block">' + esc(p.name) + "</b><small>" + (p.kind === "oauth" ? "Tu app + Conectar" : "Token de tu bot") + "</small></span>" + st + "</button>";
      }).join("") + "</div>";
    if (P.open) h += wizard(prov(P.open));
    h += "</article>";
    // cuentas
    h += '<article class="card c12"><div class="ch"><h3>Cuentas conectadas</h3><small>' + P.accounts.length + " en este espacio · máx. " + P.max + " por publicación</small></div>";
    h += P.accounts.length ? '<div class="list">' + P.accounts.map(function (a) {
      var p = prov(a.provider), s = ST[a.status] || ["", a.status];
      return '<div class="li" style="align-items:flex-start">' + badge(p) + '<div style="flex:1;min-width:0"><b>' + esc(a.display_name || a.username || a.external_id) + "</b> " + pill(s[0], s[1])
        + "<p>" + esc(p.name) + (a.username ? " · @" + esc(a.username) : "") + (a.checked_at ? " · revisada " + new Date(a.checked_at).toLocaleString() : "") + "</p>"
        + (a.last_error ? '<p style="color:var(--danger,#c33)">' + esc(a.last_error) + "</p>" : "")
        + (a.provider === "reddit" ? '<div style="display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap"><small>Publica en</small><input class="fx-in" style="max-width:200px" data-pub-sr="' + esc(a.id) + '" value="' + esc((a.options || {}).subreddit || "") + '" placeholder="u_tuusuario o subreddit"><button data-pub="sr" data-id="' + esc(a.id) + '">Guardar</button></div>' : "")
        + '</div><div class="ag-ctl"><button data-pub="check" data-id="' + esc(a.id) + '">Revisar</button><button data-pub="del" data-id="' + esc(a.id) + '">Quitar</button></div></div>';
    }).join("") + "</div>" : '<p class="empty-note">Todavía no conectas ninguna cuenta. Elige una red arriba.</p>';
    h += "</article>";
    // publicaciones
    h += '<article class="card c12"><div class="ch"><h3>Últimas publicaciones</h3><small>Desde el editor o el calendario, con «Publicar en redes»</small></div>' + jobsHtml(P.jobs) + "</article>";
    h += "</div>";
    body.innerHTML = h;
  }
  function wizard(p) {
    var app = P.apps[p.id];
    var h = '<div style="border-top:1px solid #e4e2d6;margin-top:14px;padding-top:14px"><h4 style="margin:0 0 8px">Conectar ' + esc(p.name) + "</h4><ol style=\"margin:0 0 10px 20px;font-size:13px;line-height:1.6\">"
      + p.setup.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>";
    (p.notes || []).forEach(function (n) { h += '<p style="font-size:13px;margin:0 0 8px;color:#6b5a00">⚠ ' + esc(n) + "</p>"; });
    if (p.developerUrl) h += '<p style="font-size:13px;margin:0 0 8px"><a href="' + esc(p.developerUrl) + '" target="_blank" rel="noopener">Abrir el portal de ' + esc(p.name) + " ↗</a></p>";
    if (p.redirectUri) h += '<label class="fx-lbl">Dirección de regreso (redirect / callback URI)</label><div style="display:flex;gap:6px"><input class="fx-in" readonly value="' + esc(p.redirectUri) + '"><button data-pub="copy" data-v="' + esc(p.redirectUri) + '">Copiar</button></div>';
    h += '<div class="fx-row" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-top:8px">' + p.fields.map(function (f) {
      var val = p.kind === "oauth" && f.key === "client_id" && app ? app.client_id : "";
      var ph = p.kind === "oauth" && f.secret && app && app.has_secret ? "•••••• guardado (déjalo vacío para mantenerlo)" : (f.placeholder || "");
      return '<div><label class="fx-lbl">' + esc(f.label) + '</label><input class="fx-in" data-pub-f="' + esc(f.key) + '" type="' + (f.secret ? "password" : "text") + '" autocomplete="off" value="' + esc(val) + '" placeholder="' + esc(ph) + '"></div>';
    }).join("") + "</div>";
    h += '<div class="ag-ctl" style="margin-top:10px"><button class="pri" data-pub="' + (p.kind === "oauth" ? "connect" : "token") + '" data-p="' + esc(p.id) + '">' + (p.kind === "oauth" ? "Guardar y conectar" : "Validar y conectar") + "</button>"
      + (app ? '<button data-pub="unapp" data-p="' + esc(p.id) + '">Borrar app guardada</button>' : "") + "</div></div>";
    return h;
  }
  function jobsHtml(jobs) {
    if (!jobs.length) return '<p class="empty-note">Todavía no publicas nada con Musa Publisher.</p>';
    return '<div class="list">' + jobs.map(function (j) {
      var ts = j.publish_targets || [];
      return '<div class="li" style="align-items:flex-start"><img src="' + esc(j.media_url) + '" alt="" style="width:46px;height:46px;object-fit:cover;border-radius:8px;flex:none"><div style="flex:1;min-width:0"><b>' + esc((j.caption || "Sin texto").slice(0, 90)) + "</b> " + pill(j.status === "published" ? "ok" : j.status === "failed" ? "bad" : "warn", JS[j.status] || j.status)
        + (j.mode === "dry-run" ? " " + pill("", "Prueba") : "") + "<p>" + new Date(j.created_at).toLocaleString() + "</p>" + targetsHtml(ts) + "</div>"
        + (ts.some(function (t) { return t.status === "failed" && t.attempts < 5; }) ? '<div class="ag-ctl"><button data-pub="retry" data-id="' + esc(j.id) + '">Reintentar</button></div>' : "") + "</div>";
    }).join("") + "</div>";
  }
  function targetsHtml(ts) {
    return '<ul style="margin:4px 0 0;padding:0;list-style:none;font-size:13px">' + ts.map(function (t) {
      var ic = t.status === "published" ? "✓" : t.status === "failed" ? "✕" : t.status === "skipped_dry_run" ? "○" : "…";
      var col = t.status === "published" ? "var(--ok,#2a8a4a)" : t.status === "failed" ? "var(--danger,#c33)" : "#777";
      return '<li style="margin:2px 0"><b style="color:' + col + '">' + ic + "</b> " + esc(prov(t.provider).name) + " · " + esc(t.account_name || "")
        + (t.external_url ? ' · <a href="' + esc(t.external_url) + '" target="_blank" rel="noopener">ver publicación ↗</a>' : "")
        + (t.status === "skipped_dry_run" ? " · prueba, no se envió" : "")
        + (t.error ? '<br><small style="color:var(--danger,#c33)">' + esc(t.error) + (t.attempts ? " (intento " + t.attempts + ")" : "") + "</small>" : "") + "</li>";
    }).join("") + "</ul>";
  }
  function fields() { var o = {}; document.querySelectorAll("[data-pub-f]").forEach(function (i) { o[i.dataset.pubF] = i.value.trim(); }); return o; }
  function refresh() { return load(true).then(draw); }

  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-pub]"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var k = b.dataset.pub, done = function () { b.disabled = false; };
    var fail = function (x) { done(); toast(msg(x)); };
    if (k === "wiz") { P.open = P.open === b.dataset.p ? null : b.dataset.p; return draw(); }
    if (k === "copy") { try { navigator.clipboard.writeText(b.dataset.v); } catch (x) {} return toast("Copiado"); }
    b.disabled = true;
    if (k === "token") {
      return api("/api/publisher/accounts/token", J("POST", { workspaceId: ws(), provider: b.dataset.p, input: fields() }, 30000))
        .then(function () { toast("Cuenta conectada"); P.open = null; return refresh(); }, fail);
    }
    if (k === "connect") {
      var f = fields(), pid = b.dataset.p;
      // la ventana se abre ya (dentro del clic) para que el navegador no la bloquee
      var win = window.open("about:blank", "musa-pub-oauth", "width=560,height=720");
      var save = f.client_id ? api("/api/publisher/apps", J("POST", { workspaceId: ws(), provider: pid, client_id: f.client_id, client_secret: f.client_secret || "" })) : Promise.resolve();
      return save.then(function () { return api("/api/publisher/oauth/" + pid + "/start", J("POST", { workspaceId: ws() })); })
        .then(function (r) { done(); if (win) win.location.href = r.url; else location.href = r.url; toast("Autoriza a Musa en la ventana de " + prov(pid).name); },
          function (x) { if (win) win.close(); fail(x); });
    }
    if (k === "unapp") { if (!confirm("¿Borrar la app guardada? Las cuentas ya conectadas no podrán renovar su conexión.")) return done(); return api(q("/api/publisher/apps/" + b.dataset.p), { method: "DELETE" }).then(refresh, fail); }
    if (k === "check") return api("/api/publisher/accounts/" + b.dataset.id + "/check", J("POST", {}, 30000)).then(function (r) { toast(r.data && r.data.status === "active" ? "La conexión funciona" : "Revisa el error de la cuenta"); return refresh(); }, fail);
    if (k === "del") { if (!confirm("¿Quitar esta cuenta de Musa?")) return done(); return api("/api/publisher/accounts/" + b.dataset.id, { method: "DELETE" }).then(function () { toast("Cuenta quitada"); return refresh(); }, fail); }
    if (k === "sr") { var inp = document.querySelector('[data-pub-sr="' + b.dataset.id + '"]'); return api("/api/publisher/accounts/" + b.dataset.id, J("PATCH", { options: { subreddit: inp ? inp.value : "" } })).then(function () { toast("Guardado"); return refresh(); }, fail); }
    if (k === "retry") return api("/api/publisher/jobs/" + b.dataset.id + "/retry", J("POST", {}, 90000)).then(function (r) { toast(r.status === "published" ? "Listo: publicado" : "Reintento hecho"); return refresh(); }, fail);
    done();
  }, true);

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.type !== "musa-publisher") return;
    toast(d.ok ? "Cuenta de " + prov(d.provider).name + " conectada" : "No se pudo conectar: " + d.message);
    if (d.ok) P.open = null;
    load(true).then(function () { if (/configuracion\/publicar/.test(location.hash)) draw(); });
  });

  /* ───────── modal «Publicar en redes» ───────── */
  var M = null;
  function openPublish(getMedia, opts) {
    opts = opts || {};
    if (typeof mx !== "function") return toast("No se pudo abrir la ventana de publicar");
    M = { getMedia: getMedia, caption: opts.caption || "", sel: {}, mode: "dry-run", busy: false, result: null, template_id: opts.template_id || null, content_id: opts.content_id || null };
    mx("Publicar en redes", "Con Musa Publisher. Por defecto en modo Prueba: no sale nada hasta que elijas «En vivo».", '<p class="empty-note">Cargando cuentas…</p>', modalClick);
    load(true).then(drawModal, function (e) { setBody('<p class="empty-note">' + esc(msg(e)) + "</p>"); });
  }
  function setBody(h) { var el = document.getElementById("mxBody"); if (el) el.innerHTML = h; }
  function minChars() {
    var ids = Object.keys(M.sel).filter(function (k) { return M.sel[k]; });
    var lim = ids.map(function (id) { var a = P.accounts.find(function (x) { return x.id === id; }); return a ? prov(a.provider).limits.maxChars : 99999; });
    return lim.length ? Math.min.apply(null, lim) : null;
  }
  function counter() {
    var lim = minChars(), n = M.caption.length, el = document.getElementById("pubCount");
    if (el) { el.textContent = n + (lim ? " / " + lim : "") + " caracteres"; el.style.color = lim && n > lim ? "var(--danger,#c33)" : "#777"; }
  }
  function drawModal() {
    if (!M) return;
    if (M.result) {
      var r = M.result;
      return setBody('<p style="margin:0 0 8px"><b>' + (r.mode === "dry-run" || !r.live ? "Prueba hecha: no se envió nada a las redes." : (JS[r.status] || r.status)) + "</b></p>" + targetsHtml(r.targets || [])
        + '<div class="ag-ctl" style="margin-top:12px">' + ((r.targets || []).some(function (t) { return t.status === "failed"; }) ? '<button data-pm="retry">Reintentar los que fallaron</button>' : "")
        + (r.mode === "dry-run" && P.live ? '<button class="pri" data-pm="golive">Publicar en vivo ahora</button>' : "") + '<button data-pm="cfg">Ver en Configuración › Publicar</button></div>');
    }
    var act = P.accounts.filter(function (a) { return a.status === "active"; });
    if (!P.accounts.length) return setBody('<p class="empty-note">Todavía no conectas cuentas.</p><div class="ag-ctl"><button class="pri" data-pm="cfg">Conectar redes</button></div>');
    var groups = {}; act.forEach(function (a) { (groups[a.provider] = groups[a.provider] || []).push(a); });
    var h = '<label class="fx-lbl">Cuentas (máx. ' + P.max + ")</label>";
    h += Object.keys(groups).map(function (pid) {
      var p = prov(pid);
      return '<div style="margin:4px 0 8px"><small style="font-weight:800;color:' + esc(p.color) + '">' + esc(p.name) + " · hasta " + p.limits.maxChars + " caracteres</small>" + groups[pid].map(function (a) {
        return '<label class="fx-chk" style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-pm-a="' + esc(a.id) + '"' + (M.sel[a.id] ? " checked" : "") + "> <span>" + esc(a.display_name || a.username) + (a.provider === "reddit" ? " → " + esc((a.options || {}).subreddit || "") : "") + "</span></label>";
      }).join("") + "</div>";
    }).join("") || '<p class="empty-note">Ninguna cuenta activa: revisa las conexiones.</p>';
    var off = P.accounts.length - act.length;
    if (off) h += '<p style="font-size:12px;color:#6b5a00;margin:0 0 8px">' + off + " cuenta(s) necesitan reconectarse y no aparecen.</p>";
    h += '<label class="fx-lbl">Texto</label><textarea class="fx-in" id="pubCap" rows="4" style="resize:vertical">' + esc(M.caption) + '</textarea><small id="pubCount"></small>';
    h += '<div class="seg" style="margin:10px 0"><button data-pm="mode" data-v="dry-run" class="' + (M.mode === "dry-run" ? "on" : "") + '">Prueba</button><button data-pm="mode" data-v="live" class="' + (M.mode === "live" ? "on" : "") + '"' + (P.live ? "" : " disabled title=\"El envío real está apagado en el servidor\"") + ">En vivo</button></div>";
    h += '<div class="ag-ctl"><button class="pri" data-pm="go"' + (M.busy ? " disabled" : "") + ">" + (M.busy ? "Publicando…" : M.mode === "live" ? "Publicar ahora" : "Hacer la prueba") + "</button></div>";
    setBody(h); counter();
  }
  function modalClick(e) {
    if (!M) return;
    var a = e.target.closest("[data-pm-a]");
    if (a) { var n = Object.keys(M.sel).filter(function (k) { return M.sel[k]; }).length; if (a.checked && n >= P.max) { a.checked = false; return toast("Máximo " + P.max + " cuentas"); } M.sel[a.dataset.pmA] = a.checked; return counter(); }
    var b = e.target.closest("[data-pm]"); if (!b) return;
    var k = b.dataset.pm;
    if (k === "cfg") { var el = document.getElementById("mx"); if (el) el.hidden = true; document.querySelectorAll(".mx").forEach(function (x) { x.hidden = true; }); location.hash = "configuracion/publicar"; return; }
    if (k === "mode") { M.mode = b.dataset.v; return drawModal(); }
    if (k === "golive") { M.result = null; M.mode = "live"; return drawModal(); }
    if (k === "retry") { b.disabled = true; return api("/api/publisher/jobs/" + M.result.job_id + "/retry", J("POST", {}, 90000)).then(function (r) { M.result.targets = (r.data && r.data.publish_targets) || M.result.targets; M.result.status = r.status; drawModal(); }, function (x) { b.disabled = false; toast(msg(x)); }); }
    if (k === "go") {
      var ids = Object.keys(M.sel).filter(function (x) { return M.sel[x]; });
      if (!ids.length) return toast("Elige al menos una cuenta");
      var lim = minChars(); if (lim && M.caption.length > lim) return toast("El texto es más largo de lo que acepta una de las redes (" + lim + ")");
      if (M.mode === "live" && !confirm("¿Publicar ahora en " + ids.length + " cuenta(s)? Esto sale de verdad a las redes.")) return;
      M.busy = true; drawModal();
      var media = M.mediaUrl ? Promise.resolve(M.mediaUrl) : Promise.resolve().then(M.getMedia).then(function (u) { M.mediaUrl = u; return u; });
      media.then(function (url) {
        return api("/api/publisher/publish", J("POST", { workspaceId: ws(), media_url: url, media_mime: /\.png(\?|$)/i.test(url) ? "image/png" : "image/jpeg", caption: M.caption, account_ids: ids, mode: M.mode, template_id: M.template_id, content_id: M.content_id }, 120000));
      }).then(function (r) { M.busy = false; M.result = r; drawModal(); }, function (x) { M.busy = false; drawModal(); toast(msg(x)); });
    }
  }
  modalClick.input = function (e) { if (M && e.target.id === "pubCap") { M.caption = e.target.value; counter(); } };

  /* imagen de un diseño → archivo público de Musa */
  function uploadShot(dataUrlPromise) {
    return dataUrlPromise.then(function (d) { if (!RB.uploadData) throw new Error("No cargó la subida de archivos"); toast("Preparando la imagen…"); return RB.uploadData(d, "publicar-" + Date.now() + ".jpg"); });
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
      var f = ED.doc.frames[ED.sel ? ED.sel.f : (ED.fi || 0)] || ED.doc.frames[0];
      openPublish(function () { return uploadShot(RB.shotFrame(f)); }, { template_id: ED.doc._id });
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
      }, { caption: p.copy || "", template_id: p.tpl, content_id: p.db || null });
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
    new MutationObserver(function () { editorButton(); }).observe(document.body, { childList: true, subtree: true });
    if (/configuracion\/publicar/.test(location.hash)) drawView();
    if (typeof drawNav === "function") try { drawNav(); } catch (e) {}
  }
  if (RB) install();
})();
