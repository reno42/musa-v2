/* bridge-fotos.js — Crear › Fotos: todas las fotos del espacio estén donde estén (Musa, Google Drive, Dropbox,
 * OneDrive o un enlace), sin copiarlas a Musa, y el editor de fotos para una foto suelta.
 *
 * · La foto queda en su lugar: de Drive Musa guarda la referencia y la muestra con un enlace firmado
 *   (/api/photo-sources/f/…); de Dropbox y de los enlaces, la URL directa. Cada foto lleva su origen (source) y sus
 *   etiquetas; son las mismas imágenes de «Tus imágenes» del editor de diseño, así que se usan en cualquier diseño.
 * · Editar: abre el editor de fotos (el de los diseños) con la foto sola. «Guardar foto editada» la guarda donde
 *   está el original (Drive → carpeta «Musa» de esa cuenta; el resto → Musa), unida al original con su receta.
 * Servidor: worker/runtime/functions/photo-sources.mjs. Migración: db/migrations-v2/44_v2_fotos_fuentes.sql.
 */
(function () {
  "use strict";
  if (window.__musaFotos) return;
  window.__musaFotos = true;
  function RR() { return window.__musaReal; }
  function bridge() { try { return window.parent.__musaBridge; } catch (e) { return null; } }
  function api(url, init) { var b = bridge(); return b ? b.api(url, init) : Promise.reject(new Error("sin conexión")); }
  function jreq(method, body) { return { method: method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function toast(m) { if (typeof uiToast === "function") uiToast(m); }
  function errOf(e) { var m = e && (e.message || e.error) || String(e || "error"); return String(m).replace(/^Error:\s*/, ""); }
  var SRC = { musa: "Musa", drive: "Google Drive", dropbox: "Dropbox", onedrive: "OneDrive", link: "Enlace" };
  var F = { rows: null, total: 0, filter: "todas", q: "", tag: "", st: null, err: null, warn: null, busy: false, more: false };

  /* ═════════ datos ═════════ */
  function ws() { var R = RR(); return R && R.ws; }
  function status() {
    return api("/api/photo-sources?workspaceId=" + encodeURIComponent(ws())).then(function (s) { F.st = s; return s; }, function (e) { F.st = { migrated: false, google: { configured: false }, dropbox: {}, accounts: [], err: errOf(e) }; return F.st; });
  }
  function load(append) {
    var off = append && F.rows ? F.rows.length : 0;
    return api("/api/photo-sources/photos?workspaceId=" + encodeURIComponent(ws()) + "&limit=200&offset=" + off).then(function (x) {
      F.warn = x.warning ? "Falta aplicar la migración 44 de Musa (db/migrations-v2/44_v2_fotos_fuentes.sql): por ahora se ven las fotos subidas a Musa; Google Drive, Dropbox y los enlaces se activan al aplicarla." : null;
      F.rows = (append && F.rows ? F.rows : []).concat(x.photos || []); F.total = x.total || F.rows.length; F.more = F.rows.length < F.total;
    }, function (e) {
      /* sin la migración 44: solo las fotos subidas a Musa (las de Drive/Dropbox/enlaces necesitan las columnas nuevas) */
      return api("/api/assets?workspaceId=" + encodeURIComponent(ws()) + "&limit=200").then(function (x) {
        F.rows = (x.assets || []).filter(function (a) { return /^image\//.test(a.mimeType || "image/"); }).map(function (a) { return { id: a.id, name: a.name, url: a.url, thumb: a.url, editUrl: a.url, mimeType: a.mimeType, sizeBytes: a.sizeBytes, width: a.width, height: a.height, tags: a.tags || [], source: "musa", createdAt: a.createdAt }; });
        F.total = F.rows.length; F.more = false;
        F.warn = /migraci/i.test(errOf(e)) ? "Falta aplicar la migración 44 de Musa (db/migrations-v2/44_v2_fotos_fuentes.sql): por ahora solo se ven las fotos subidas a Musa." : "No pude leer las fotos de Drive, Dropbox y enlaces: " + errOf(e);
      });
    }).catch(function (e) { F.err = errOf(e); F.rows = F.rows || []; });
  }
  function reload() { return Promise.all([load(false), status()]).then(function () { if (onLib()) drawLib(); }); }

  /* ═════════ Crear › Fotos ═════════ */
  function onLib() { return typeof route !== "undefined" && route.mod === "crear" && route.sub === "fotos"; }
  function fmtSize(b) { return !b ? "" : b > 1048576 ? (b / 1048576).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(b / 1024)) + " KB"; }
  function rowsShown() {
    var q = F.q.trim().toLowerCase();
    return (F.rows || []).filter(function (r) {
      if (F.filter !== "todas" && (F.filter === "editadas" ? !r.from : r.source !== F.filter)) return false;
      if (F.tag && (r.tags || []).indexOf(F.tag) < 0) return false;
      if (q && (r.name || "").toLowerCase().indexOf(q) < 0 && !(r.tags || []).some(function (t) { return t.toLowerCase().indexOf(q) >= 0; })) return false;
      return true;
    });
  }
  function drawLib() {
    var body = document.getElementById("body"); if (!body || !onLib()) return;
    var R = RR();
    if (!R || !R.on) { body.innerHTML = '<p class="fo-note">Cargando…</p>'; return; }
    if (!F.rows) { body.innerHTML = '<p class="fo-note">Cargando tus fotos…</p>'; if (!F.busy) { F.busy = true; reload().then(function () { F.busy = false; }); } return; }
    var st = F.st || { google: {}, dropbox: {}, accounts: [] }, rows = F.rows, n = function (k) { return rows.filter(function (r) { return k === "editadas" ? r.from : r.source === k; }).length; };
    var h = '<p class="fo-note">Tus fotos estén donde estén: las que subes a Musa, las de tu <b>Google Drive</b>, <b>Dropbox</b> o cualquier enlace. Musa no las copia: las muestra desde su lugar y las puedes usar en diseños, videos y webs. Al editar una, la versión editada se guarda junto al original (el original nunca se toca).</p>';
    if (F.warn) h += '<div class="fo-warn">' + esc(F.warn) + "</div>";
    if (F.err) h += '<div class="fo-warn">No pude cargar las fotos: ' + esc(F.err) + "</div>";
    var drv = st.accounts.filter(function (a) { return a.provider === "google_drive"; });
    h += '<div class="fo-top"><button type="button" class="qrb pri" data-fo="up">Subir fotos</button>'
      + '<button type="button" class="qrb" data-fo="drive"><span class="fo-ic fo-gd" aria-hidden="true"></span>' + (drv.length ? "Traer de Google Drive" : "Conectar Google Drive") + "</button>"
      + '<button type="button" class="qrb" data-fo="dropbox"><span class="fo-ic fo-db" aria-hidden="true"></span>Traer de Dropbox</button>'
      + '<button type="button" class="qrb" data-fo="link">Pegar enlace</button><span class="sp"></span>'
      + '<input type="search" id="foSearch" placeholder="Buscar por nombre o etiqueta" value="' + esc(F.q) + '" aria-label="Buscar fotos"></div>';
    if (drv.length) h += '<div class="fo-acc">' + drv.map(function (a) { return '<span class="fo-chip"><span class="fo-ic fo-gd" aria-hidden="true"></span>' + esc(a.email || "Google Drive") + '<button type="button" data-fo-off="' + esc(a.id) + '" title="Desconectar esta cuenta de Google Drive" aria-label="Desconectar ' + esc(a.email || "Google Drive") + '">×</button></span>'; }).join("") + (drv.length ? '<button type="button" class="fo-mini" data-fo="drive-add">+ otra cuenta</button>' : "") + "</div>";
    var FL = [["todas", "Todas", rows.length], ["musa", "Musa", n("musa")], ["drive", "Google Drive", n("drive")], ["dropbox", "Dropbox", n("dropbox")], ["link", "Enlaces", n("link") + n("onedrive")], ["editadas", "Editadas", n("editadas")]];
    var tags = {}; rows.forEach(function (r) { (r.tags || []).forEach(function (t) { tags[t] = (tags[t] || 0) + 1; }); });
    var tl = Object.keys(tags).sort(function (a, b) { return tags[b] - tags[a]; }).slice(0, 30);
    h += '<div class="fo-f" role="group" aria-label="Filtrar por origen">' + FL.filter(function (f) { return f[0] === "todas" || f[2] > 0; }).map(function (f) { return '<button type="button" class="qrb' + (F.filter === f[0] ? " on" : "") + '" data-fof="' + f[0] + '">' + f[1] + ' <span class="fo-n">' + f[2] + "</span></button>"; }).join("")
      + (tl.length ? '<select id="foTag" aria-label="Filtrar por etiqueta"><option value="">Todas las etiquetas</option>' + tl.map(function (t) { return '<option value="' + esc(t) + '"' + (F.tag === t ? " selected" : "") + ">" + esc(t) + " (" + tags[t] + ")</option>"; }).join("") + "</select>" : "") + "</div>";
    var list = rowsShown();
    if (!rows.length) h += '<div class="fo-empty"><b>Todavía no hay fotos</b><p>Sube fotos, conecta tu Google Drive o pega enlaces de Dropbox: aparecen aquí sin ocupar espacio en Musa.</p><div class="fo-top" style="justify-content:center"><button type="button" class="qrb pri" data-fo="up">Subir fotos</button><button type="button" class="qrb" data-fo="drive">Conectar Google Drive</button><button type="button" class="qrb" data-fo="dropbox">Traer de Dropbox</button></div></div>';
    else if (!list.length) h += '<p class="fo-note">Ninguna foto coincide con el filtro.</p>';
    else h += '<div class="fo-grid">' + list.map(card).join("") + "</div>" + (F.more ? '<div style="text-align:center;margin:18px 0"><button type="button" class="qrb" data-fo="more">Cargar más (' + (F.total - rows.length) + ")</button></div>" : "");
    body.innerHTML = h;
  }
  function card(r) {
    var s = r.source || "musa", meta = [SRC[s] || s, r.width && r.height ? r.width + "×" + r.height : "", fmtSize(r.sizeBytes)].filter(Boolean).join(" · ");
    return '<article class="fo-card" data-foid="' + esc(r.id) + '"><button type="button" class="fo-th" data-foed="' + esc(r.id) + '" title="Editar la foto" aria-label="Editar ' + esc(r.name) + '"><img loading="lazy" decoding="async" alt="" src="' + esc(r.thumb || r.url) + '" onerror="this.parentNode.classList.add(\'bad\')"><span class="fo-src fo-s-' + esc(s) + '">' + esc(SRC[s] || s) + "</span>" + (r.from ? '<span class="fo-ed">Editada</span>' : "") + "</button>"
      + '<b title="' + esc(r.name) + '">' + esc(r.name || "Foto") + "</b><small>" + esc(meta) + "</small>"
      + ((r.tags || []).length ? '<div class="fo-tags">' + r.tags.slice(0, 4).map(function (t) { return "<span>" + esc(t) + "</span>"; }).join("") + "</div>" : "")
      + '<div class="fo-acts"><button type="button" class="fo-mini" data-foed="' + esc(r.id) + '">Editar</button><button type="button" class="fo-mini" data-fotag="' + esc(r.id) + '">Etiquetas</button>'
      + (r.openUrl ? '<a class="fo-mini" href="' + esc(r.openUrl) + '" target="_blank" rel="noopener">Abrir en ' + esc(SRC[s] || "su lugar") + "</a>" : "")
      + '<button type="button" class="fo-mini" data-focp="' + esc(r.id) + '">Copiar enlace</button><button type="button" class="fo-mini" data-form="' + esc(r.id) + '">Quitar</button></div></article>';
  }
  function rowOf(id) { return (F.rows || []).find(function (r) { return r.id === id; }) || null; }

  /* ═════════ subir a Musa ═════════ */
  function shrink(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onerror = function () { rej(new Error("no pude leer " + file.name)); };
      fr.onload = function () {
        var data = fr.result;
        if (file.size <= 4.5 * 1048576 && /^image\/(jpeg|png|webp|gif)$/.test(file.type)) return res(data);
        var im = new Image();
        im.onload = function () { var k = Math.min(1, 3200 / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement("canvas"); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k); c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL("image/jpeg", 0.86)); };
        im.onerror = function () { rej(new Error(file.name + ": este formato no se puede abrir en el navegador")); };
        im.src = data;
      };
      fr.readAsDataURL(file);
    });
  }
  function upload(files) {
    files = [].slice.call(files || []).filter(function (f) { return /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name); });
    if (!files.length) return;
    toast("Subiendo " + files.length + " foto(s)…");
    var ok = 0, bad = [];
    return files.reduce(function (pr, f) {
      return pr.then(function () { return shrink(f).then(function (data) { return api("/api/assets/upload", jreq("POST", { name: f.name.replace(/\.[a-z0-9]+$/i, ""), data: data, workspaceId: ws(), tags: F.tag ? [F.tag] : [] })); }).then(function () { ok++; }, function (e) { bad.push(errOf(e)); }); });
    }, Promise.resolve()).then(function () { toast(ok + " foto(s) subidas a Musa" + (bad.length ? " · " + bad.length + " con error: " + bad[0] : "")); return reload(); });
  }

  /* ═════════ Google Drive ═════════ */
  function driveSetup() {
    mx("Google Drive en Musa", "", '<div class="fo-mx"><p>La conexión con Google Drive todavía no está activada en esta instalación de Musa. La activa una persona administradora de la plataforma (una sola vez para todos):</p><ol><li>En Google Cloud, una app OAuth de tipo «Aplicación web» con el permiso <code>drive.file</code> y la dirección de regreso <code>' + esc(location.origin) + '/api/photo-sources/google/callback</code>.</li><li>La API de Google Drive y la de Google Picker activadas, y una clave de API.</li><li>Los secretos <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, <code>GOOGLE_API_KEY</code> y <code>GOOGLE_APP_ID</code> en el servidor de Musa.</li></ol><p>Mientras tanto puedes traer fotos de Drive pegando su enlace (compartido como «Cualquier persona con el enlace»).</p><div class="fo-top"><button type="button" class="qrb pri" data-fox="link">Pegar un enlace de Drive</button></div></div>', function (e) { if (e.target.closest("[data-fox=link]")) linkDialog(); });
  }
  function connectDrive() {
    var st = F.st || {};
    if (st.migrated === false) return mx("Falta un paso", "", '<p class="fo-mx">Para conectar Google Drive hay que aplicar primero la migración 44 de Musa (<code>db/migrations-v2/44_v2_fotos_fuentes.sql</code>).</p>');
    if (!st.google || !st.google.configured) return driveSetup();
    var win = window.open("about:blank", "musa-drive", "width=520,height=680");
    api("/api/photo-sources/google/start", jreq("POST", { workspaceId: ws() })).then(function (x) {
      if (win && !win.closed) win.location.href = x.url; else window.open(x.url, "musa-drive", "width=520,height=680");
      toast("Elige tu cuenta de Google y acepta el permiso: Musa solo verá las fotos que elijas");
    }, function (e) { if (win) win.close(); toast("No pude empezar la conexión: " + errOf(e)); });
  }
  window.addEventListener("message", function (e) {
    var d = e.data && e.data.musaPhotoSource; if (!d) return;
    if (e.origin !== location.origin) return;
    if (d.ok) { toast("Google Drive conectado" + (d.email ? ": " + d.email : "")); status().then(function () { if (onLib()) drawLib(); if (d.id) pickFromDrive(d.id); }); }
    else toast("No se conectó Google Drive: " + (d.error || "cancelado"));
  });
  function driveAccount(cb) {
    var drv = ((F.st && F.st.accounts) || []).filter(function (a) { return a.provider === "google_drive"; });
    if (!drv.length) return connectDrive();
    if (drv.length === 1) return cb(drv[0].id);
    mx("¿De qué cuenta?", "Elige la cuenta de Google Drive", '<div class="fo-top" style="flex-direction:column;align-items:stretch">' + drv.map(function (a) { return '<button type="button" class="qrb" data-foacc="' + esc(a.id) + '">' + esc(a.email || a.id) + "</button>"; }).join("") + "</div>", function (e) { var b = e.target.closest("[data-foacc]"); if (b) { mxEl.hidden = true; cb(b.dataset.foacc); } });
  }
  var GAPI = null;
  function loadGapi() {
    if (GAPI) return GAPI;
    GAPI = new Promise(function (res, rej) {
      var s = document.createElement("script"); s.src = "https://apis.google.com/js/api.js"; s.async = true;
      s.onload = function () { window.gapi.load("picker", { callback: function () { res(window.google); }, onerror: function () { rej(new Error("no cargó el selector de Google")); } }); };
      s.onerror = function () { GAPI = null; rej(new Error("no cargó el selector de Google")); };
      document.head.appendChild(s);
    });
    return GAPI;
  }
  function pickFromDrive(sid) {
    api("/api/photo-sources/" + encodeURIComponent(sid) + "/token", jreq("POST", {})).then(function (tk) {
      if (!tk.apiKey) return browseDrive(sid);
      return loadGapi().then(function (google) {
        var P = google.picker;
        var view = new P.DocsView(P.ViewId.DOCS_IMAGES).setIncludeFolders(true).setSelectFolderEnabled(false).setMode(P.DocsViewMode.GRID);
        var pk = new P.PickerBuilder().addView(view).addView(new P.DocsUploadView()).enableFeature(P.Feature.MULTISELECT_ENABLED).enableFeature(P.Feature.SUPPORT_DRIVES)
          .setOAuthToken(tk.accessToken).setDeveloperKey(tk.apiKey).setLocale("es").setTitle("Elige fotos para Musa · " + (tk.email || ""))
          .setOrigin(location.origin).setCallback(function (d) {
            if (d.action !== P.Action.PICKED) return;
            var ids = (d.docs || []).map(function (x) { return x.id; });
            importDrive(sid, ids);
          });
        if (tk.appId) pk = pk.setAppId(tk.appId);
        pk.build().setVisible(true);
      });
    }).catch(function (e) { toast("Google Drive: " + errOf(e)); });
  }
  function importDrive(sid, ids) {
    if (!ids.length) return;
    toast("Trayendo " + ids.length + " foto(s) de Google Drive…");
    return api("/api/photo-sources/" + encodeURIComponent(sid) + "/import", jreq("POST", { fileIds: ids, tags: F.tag ? [F.tag] : [] })).then(function (x) {
      var n = (x.imported || []).filter(function (a) { return !a.existed; }).length, rep = (x.imported || []).length - n;
      toast(n + " foto(s) de Drive en Musa" + (rep ? " · " + rep + " ya estaban" : "") + ((x.errors || []).length ? " · " + x.errors.length + " sin traer: " + x.errors[0].error : ""));
      F.filter = "drive"; return reload();
    }, function (e) { toast("No se trajeron: " + errOf(e)); });
  }
  /* explorar sin el selector de Google (sin clave de API, o con el permiso completo de Drive) */
  function browseDrive(sid, folder, crumbs) {
    crumbs = crumbs || [{ id: "", name: "Drive" }];
    mx("Google Drive", "Elige fotos (clic para marcar) y tráelas a Musa", '<p class="fo-note">Cargando…</p>');
    api("/api/photo-sources/" + encodeURIComponent(sid) + "/browse?folderId=" + encodeURIComponent(folder || "")).then(function (x) {
      var sel = {};
      var h = '<div class="fo-crumbs">' + crumbs.map(function (c, i) { return '<button type="button" data-focr="' + i + '">' + esc(c.name) + "</button>"; }).join(" › ") + "</div>"
        + (x.note ? '<p class="fo-note">' + esc(x.note) + "</p>" : "")
        + '<div class="fo-pick">' + (x.files || []).map(function (f) { return f.folder ? '<button type="button" class="fo-pf" data-fodir="' + esc(f.id) + '" data-name="' + esc(f.name) + '">📁 ' + esc(f.name) + "</button>" : '<button type="button" class="fo-pi" data-fopi="' + esc(f.id) + '" title="' + esc(f.name) + '"><img loading="lazy" alt="" src="' + esc(f.thumb) + '"><small>' + esc(f.name) + "</small></button>"; }).join("") + "</div>"
        + (!(x.files || []).length ? '<p class="fo-note">No hay fotos aquí.</p>' : "")
        + '<div class="fo-top" style="margin-top:12px"><span class="sp"></span><button type="button" class="qrb pri" data-fogo="1">Traer las marcadas</button></div>';
      mxBody(h);
      mxClick = function (e) {
        var p = e.target.closest("[data-fopi]"); if (p) { var id = p.dataset.fopi; sel[id] = !sel[id]; p.classList.toggle("on", !!sel[id]); return; }
        var d = e.target.closest("[data-fodir]"); if (d) return browseDrive(sid, d.dataset.fodir, crumbs.concat([{ id: d.dataset.fodir, name: d.dataset.name }]));
        var c = e.target.closest("[data-focr]"); if (c) { var cr = crumbs.slice(0, +c.dataset.focr + 1); return browseDrive(sid, cr[cr.length - 1].id, cr); }
        if (e.target.closest("[data-fogo]")) { var ids = Object.keys(sel).filter(function (k) { return sel[k]; }); if (!ids.length) return toast("Marca al menos una foto"); mxEl.hidden = true; importDrive(sid, ids); }
      };
    }, function (e) { mxBody('<div class="fo-warn">' + esc(errOf(e)) + "</div>"); });
  }

  /* ═════════ Dropbox y enlaces ═════════ */
  var DBX = null;
  function loadDropbox(key) {
    if (DBX) return DBX;
    DBX = new Promise(function (res, rej) {
      var s = document.createElement("script"); s.src = "https://www.dropbox.com/static/api/2/dropins.js"; s.id = "dropboxjs"; s.setAttribute("data-app-key", key);
      s.onload = function () { res(window.Dropbox); }; s.onerror = function () { DBX = null; rej(new Error("no cargó el selector de Dropbox")); };
      document.head.appendChild(s);
    });
    return DBX;
  }
  function dropbox() {
    var key = F.st && F.st.dropbox && F.st.dropbox.appKey;
    if (key) return loadDropbox(key).then(function (D) {
      D.choose({ linkType: "preview", multiselect: true, extensions: ["images"], folderselect: false,
        success: function (files) { sendLinks(files.map(function (f) { return { link: f.link, name: f.name }; }), "/api/photo-sources/dropbox"); } });
    }).catch(function () { linkDialog("dropbox"); });
    linkDialog("dropbox");
  }
  function sendLinks(list, path) {
    toast("Agregando " + list.length + " foto(s)…");
    var call = path ? api(path, jreq("POST", { workspaceId: ws(), files: list, tags: F.tag ? [F.tag] : [] }))
      : Promise.all(list.map(function (l) { return api("/api/photo-sources/link", jreq("POST", { workspaceId: ws(), url: l.link, name: l.name, tags: F.tag ? [F.tag] : [] })).then(function (x) { return { ok: x.photo }; }, function (e) { return { error: errOf(e) }; }); })).then(function (rs) { return { imported: rs.filter(function (r) { return r.ok; }).map(function (r) { return r.ok; }), errors: rs.filter(function (r) { return r.error; }) }; });
    return call.then(function (x) {
      toast(((x.imported || []).length) + " foto(s) agregadas" + ((x.errors || []).length ? " · " + x.errors.length + " con error: " + x.errors[0].error : ""));
      return reload();
    }, function (e) { toast("No se agregaron: " + errOf(e)); });
  }
  function linkDialog(kind) {
    var db = kind === "dropbox";
    mx(db ? "Fotos de Dropbox" : "Pegar enlaces de fotos", db ? "En Dropbox: Compartir › Copiar enlace. Pega uno por línea." : "Dropbox, Google Drive (compartido como «Cualquier persona con el enlace»), OneDrive o cualquier imagen https. Uno por línea.",
      '<div class="fo-mx"><textarea id="foLinks" rows="6" placeholder="https://www.dropbox.com/scl/fi/…?dl=0\nhttps://drive.google.com/file/d/…/view" aria-label="Enlaces"></textarea><p class="fo-note" style="margin:8px 0 0">La foto no se copia a Musa: se muestra desde su enlace. Si el enlace deja de estar compartido, deja de verse.</p><div class="fo-top" style="margin-top:12px"><span class="sp"></span><button type="button" class="qrb pri" data-folk="1">Agregar</button></div></div>',
      function (e) {
        if (!e.target.closest("[data-folk]")) return;
        var list = (document.getElementById("foLinks").value || "").split(/\s+/).map(function (u) { return u.trim(); }).filter(function (u) { return /^https:\/\//i.test(u); });
        if (!list.length) return toast("Pega al menos un enlace https://");
        mxEl.hidden = true; sendLinks(list.map(function (u) { return { link: u }; }), null);
      });
    setTimeout(function () { var t = document.getElementById("foLinks"); if (t) t.focus(); }, 30);
  }

  /* ═════════ etiquetas, copiar, quitar, desconectar ═════════ */
  function tagDialog(r) {
    mx("Etiquetas", esc(r.name), '<div class="fo-mx"><input id="foTags" value="' + esc((r.tags || []).join(", ")) + '" placeholder="campaña, cliente, verano…" aria-label="Etiquetas separadas por coma"><p class="fo-note" style="margin:8px 0 0">Ordenan las fotos sin moverlas de su lugar. Separa con comas.</p><div class="fo-top" style="margin-top:12px"><span class="sp"></span><button type="button" class="qrb pri" data-fotg="1">Guardar</button></div></div>', function (e) {
      if (!e.target.closest("[data-fotg]")) return;
      var tags = (document.getElementById("foTags").value || "").split(",").map(function (t) { return t.trim(); }).filter(Boolean);
      mxEl.hidden = true;
      api("/api/photo-sources/asset/" + encodeURIComponent(r.id), jreq("PATCH", { tags: tags })).then(function () { r.tags = tags; drawLib(); toast("Etiquetas guardadas"); }, function (e2) {
        /* sin la migración: las etiquetas también se guardan por la ruta de siempre */
        api("/api/assets/" + encodeURIComponent(r.id), jreq("PATCH", { tags: tags })).then(function () { r.tags = tags; drawLib(); toast("Etiquetas guardadas"); }, function () { toast("No se guardaron: " + errOf(e2)); });
      });
    });
    setTimeout(function () { var t = document.getElementById("foTags"); if (t) t.focus(); }, 30);
  }
  function removePhoto(r) {
    var ext = r.source && r.source !== "musa";
    mx("¿Quitar esta foto de Musa?", esc(r.name), '<div class="fo-mx"><p>' + (ext ? "El original sigue en " + esc(SRC[r.source] || "su enlace") + ": Musa nunca borra archivos de tu cuenta. Los diseños que la usan dejan de mostrarla." : "Pasa a la papelera de Musa (Configuración › Papelera). Los diseños que la usan dejan de mostrarla.") + '</p><div class="fo-top"><span class="sp"></span><button type="button" class="qrb" data-mx="close">Cancelar</button><button type="button" class="qrb pri" data-forx="1">Quitar</button></div></div>', function (e) {
      if (!e.target.closest("[data-forx]")) return;
      mxEl.hidden = true;
      var done = function () { F.rows = F.rows.filter(function (x) { return x.id !== r.id; }); drawLib(); toast(ext ? "Quitada de Musa (el original sigue en " + (SRC[r.source] || "su lugar") + ")" : "Foto en la papelera"); };
      api("/api/photo-sources/asset/" + encodeURIComponent(r.id), { method: "DELETE" }).then(done, function () { api("/api/assets/" + encodeURIComponent(r.id), { method: "DELETE" }).then(done, function (e2) { toast("No se quitó: " + errOf(e2)); }); });
    });
  }
  function disconnect(sid) {
    var a = ((F.st && F.st.accounts) || []).find(function (x) { return x.id === sid; }) || {};
    mx("¿Desconectar Google Drive?", esc(a.email || ""), '<div class="fo-mx"><p>Musa deja de tener permiso sobre esa cuenta. Las fotos que trajiste de ahí dejan de verse en Musa hasta que la vuelvas a conectar. Tus archivos de Drive no se tocan.</p><div class="fo-top"><span class="sp"></span><button type="button" class="qrb" data-mx="close">Cancelar</button><button type="button" class="qrb pri" data-fooff="1">Desconectar</button></div></div>', function (e) {
      if (!e.target.closest("[data-fooff]")) return;
      mxEl.hidden = true;
      api("/api/photo-sources/" + encodeURIComponent(sid), { method: "DELETE" }).then(function (x) { toast("Google Drive desconectado" + (x.note ? ". " + x.note : "")); reload(); }, function (e2) { toast("No se desconectó: " + errOf(e2)); });
    });
  }
  function copyLink(r) {
    var u = r.url, done = function () { toast("Enlace copiado: úsalo en cualquier diseño, video o web"); };
    try { navigator.clipboard.writeText(u).then(done, function () { window.prompt("Copia el enlace", u); }); } catch (e) { window.prompt("Copia el enlace", u); }
  }

  /* ═════════ clics en la vista ═════════ */
  document.addEventListener("click", function (e) {
    if (!onLib() || !e.target.closest) return;
    var b = e.target.closest("[data-fo],[data-fof],[data-foed],[data-fotag],[data-focp],[data-form],[data-fo-off]"); if (!b || !document.getElementById("body").contains(b)) return;
    e.preventDefault();
    var d = b.dataset;
    if (d.fof) { F.filter = d.fof; return drawLib(); }
    if (d.foed) { location.hash = "crear/fotos/" + encodeURIComponent(d.foed) + "/editar"; return; }
    if (d.fotag) { var r1 = rowOf(d.fotag); if (r1) tagDialog(r1); return; }
    if (d.focp) { var r2 = rowOf(d.focp); if (r2) copyLink(r2); return; }
    if (d.form) { var r3 = rowOf(d.form); if (r3) removePhoto(r3); return; }
    if (d.foOff) return disconnect(d.foOff);
    if (d.fo === "up") return pickFiles();
    if (d.fo === "drive") return driveAccount(pickFromDrive);
    if (d.fo === "drive-add") return connectDrive();
    if (d.fo === "dropbox") return dropbox();
    if (d.fo === "link") return linkDialog();
    if (d.fo === "more") return load(true).then(drawLib);
  }, true);
  document.addEventListener("input", function (e) { if (e.target && e.target.id === "foSearch" && onLib()) { F.q = e.target.value; var p = e.target.selectionStart; drawLib(); var n = document.getElementById("foSearch"); if (n) { n.focus(); try { n.setSelectionRange(p, p); } catch (x) { /* sin cursor */ } } } });
  document.addEventListener("change", function (e) { if (e.target && e.target.id === "foTag" && onLib()) { F.tag = e.target.value; drawLib(); } });
  function pickFiles() {
    var inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*,.heic,.heif"; inp.multiple = true; inp.style.display = "none";
    inp.onchange = function () { upload(inp.files); inp.remove(); };
    document.body.appendChild(inp); inp.click();
  }
  /* soltar fotos sobre la vista */
  document.addEventListener("dragover", function (e) { if (onLib() && e.dataTransfer && [].indexOf.call(e.dataTransfer.types || [], "Files") >= 0) { e.preventDefault(); } });
  document.addEventListener("drop", function (e) { if (!onLib() || !e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return; e.preventDefault(); upload(e.dataTransfer.files); });

  /* ═════════ el editor de fotos con una foto suelta ═════════
     Ruta: crear/fotos/<id>/editar. El documento de la foto vive en ED_DOCS["f_<id>"] (no es un diseño). Las
     navegaciones internas del editor que apuntan a crear/disenos/f_<id>… se traducen a la ruta de Fotos. */
  var PHOTO_DOCS = {};
  function photoKey(id) { return "f_" + id; }
  function photoRoute() {
    var p = location.hash.slice(1).split("/");
    if (p[0] === "crear" && p[1] === "fotos" && p[2] && p[3] === "editar") return { id: decodeURIComponent(p[2]), tk: p[4] || null };
    return null;
  }
  function assetById(id) {
    var r = rowOf(id); if (r) return Promise.resolve(r);
    return api("/api/photo-sources/photos?workspaceId=" + encodeURIComponent(ws()) + "&limit=200").then(function (x) { F.rows = x.photos || F.rows; return rowOf(id); }, function () {
      return api("/rest/v1/assets?id=eq." + encodeURIComponent(id) + "&select=id,name,url,mime_type,width,height").then(function (rs) { var a = rs && rs[0]; return a ? { id: a.id, name: a.name, url: a.url, editUrl: a.url, source: "musa", width: a.width, height: a.height } : null; });
    });
  }
  function sizeOf(url) { return new Promise(function (res) { var im = new Image(); im.crossOrigin = "anonymous"; im.onload = function () { res([im.naturalWidth, im.naturalHeight]); }; im.onerror = function () { res([1600, 1200]); }; im.src = url; }); }
  function openPhoto(r, tk) {
    var key = photoKey(r.id);
    var orig = r.from ? rowOf(r.from) : null;
    var src = orig ? (orig.editUrl || orig.url) : (r.editUrl || r.url);
    return (r.width && r.height ? Promise.resolve([r.width, r.height]) : sizeOf(src)).then(function (wh) {
      var W = wh[0] || 1600, H = wh[1] || 1200, k = Math.min(1, 2400 / Math.max(W, H));
      var el = Object.assign({}, DEF, { type: "image", tag: "img", name: r.name || "Foto", x: 0, y: 0, w: Math.round(W * k), h: Math.round(H * k), fill: "url('" + src + "') center/cover no-repeat" });
      /* una foto editada se abre desde su original con la receta (se sigue editando, no se re-procesa encima) */
      if (orig && r.recipe) el.photo = { orig: src, recipe: JSON.parse(JSON.stringify(r.recipe)), edited: true };
      var doc = layoutFrames({ name: r.name || "Foto", frames: [{ name: r.name || "Foto", w: el.w, h: el.h, els: [el] }] });
      doc._photo = { asset: r, orig: orig, src: src };
      PHOTO_DOCS[key] = doc; ED_DOCS[key] = doc;
      return phOpen(key, tk || "0-0");
    });
  }
  function onPhotoRoute() {
    var pr = photoRoute(); if (!pr) return false;
    var key = photoKey(pr.id);
    if (PH.open && PH.fi === key) { if (pr.tk && PH.t && pr.tk !== PH.t.key) { var t = phTargets().find(function (x) { return x.key === pr.tk; }); if (t) phLoad(t); } return true; }
    if (!RR() || !RR().on) { setTimeout(onPhotoRoute, 300); return true; }
    assetById(pr.id).then(function (r) {
      if (!r) { toast("No encontré esa foto"); location.hash = "crear/fotos"; return; }
      if (!photoRoute() || photoRoute().id !== pr.id) return;
      openPhoto(r, pr.tk).catch(function (e) { toast("No se pudo abrir la foto: " + errOf(e)); });
    });
    return true;
  }
  function installPhotoEditor() {
    if (typeof phSync !== "function" || typeof PH === "undefined" || typeof phOpen !== "function" || typeof ED_DOCS === "undefined" || typeof DEF === "undefined") return setTimeout(installPhotoEditor, 200);
    var _sync = phSync;
    window.removeEventListener("hashchange", _sync);
    phSync = function () {
      var p = location.hash.slice(1).split("/");
      /* navegaciones internas del editor con una foto suelta (cerrar, volver, cambiar de foto) */
      if (p[0] === "crear" && p[1] === "disenos" && /^f_/.test(p[2] || "")) {
        var id = p[2].slice(2);
        location.replace(p[3] === "foto" ? "#crear/fotos/" + id + "/editar" + (p[4] ? "/" + p[4] : "") : "#crear/fotos");
        return;
      }
      if (onPhotoRoute()) return;
      return _sync.apply(this, arguments);
    };
    window.addEventListener("hashchange", phSync);
    /* la foto se lee con permiso de origen (Drive y enlaces pasan por el proxy de Musa) */
    var _src = phSrcFor;
    phSrcFor = function (t) {
      var d = PH.doc && PH.doc._photo;
      if (!d || !t || t.kind !== "image") return _src.apply(this, arguments);
      var e = PH.doc.frames[t.f].els[t.e], url = e.photo && e.photo.orig ? e.photo.orig : d.src;
      if (PH_SRC.has(url)) return Promise.resolve(PH_SRC.get(url));
      return new Promise(function (res) {
        var im = new Image(); im.crossOrigin = "anonymous";
        im.onload = function () { var c = phCanvas(im.naturalWidth, im.naturalHeight); c.getContext("2d").drawImage(im, 0, 0); PH_SRC.set(url, c); res(c); };
        im.onerror = function () { phToast("No se pudo leer la foto desde " + (SRC[d.asset.source] || "su lugar") + ". Revisa que siga compartida."); res(phSynth(e)); };
        im.src = url;
      });
    };
    /* la barra de salida: «Guardar foto editada» (junto al original) en vez de «Aplicar a la capa» */
    var _bar = phOutBar;
    phOutBar = function () {
      var r = _bar.apply(this, arguments), d = PH.doc && PH.doc._photo;
      if (d) {
        var ap = pq('#phOut [data-pa="apply"]'), all = pq('#phOut [data-pa="applyAll"]'), cl = pq('#phOut [data-pa="close"]');
        var where = d.asset.source === "drive" ? "tu Google Drive (carpeta «Musa»)" : "Musa";
        if (ap) { ap.textContent = PH.busy ? "Guardando…" : "Guardar foto editada"; ap.title = "Guarda una foto nueva en " + where + ", unida al original con su receta. El original no se toca."; }
        if (all) all.remove();
        if (cl) cl.textContent = "Volver a Fotos";
        if (!pq("#phSaveTo") && ap) {
          var drv = ((F.st && F.st.accounts) || []).filter(function (a) { return a.provider === "google_drive"; });
          var opts = '<option value="same">Junto al original (' + (d.asset.source === "drive" ? "Drive" : "Musa") + ")</option>" + (d.asset.source === "drive" ? '<option value="musa">En Musa</option>' : drv.map(function (a) { return '<option value="drive:' + esc(a.id) + '">En Drive · ' + esc(a.email || "") + "</option>"; }).join(""));
          ap.insertAdjacentHTML("afterend", '<select id="phSaveTo" class="ph-b" aria-label="Dónde guardar la foto editada" title="Dónde guardar la foto editada">' + opts + "</select>");
        }
      }
      return r;
    };
    var _apply = phApply;
    phApply = function (all) {
      var d = PH.doc && PH.doc._photo;
      if (!d) return _apply.apply(this, arguments);
      return savePhoto(d);
    };
  }
  function blobToData(blob) { return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(blob); }); }
  function savePhoto(d) {
    if (PH.busy) return;
    PH.busy = true; phOutBar();
    var sel = pq("#phSaveTo"), to = sel ? sel.value : "same", sid = null;
    if (/^drive:/.test(to)) { sid = to.slice(6); to = "drive"; }
    var base = d.orig || d.asset, toMusa = to === "musa" || (to === "same" && base.source !== "drive");
    var max = Math.min(4096, Math.max(PH.src ? PH.src.width : 2400, PH.src ? PH.src.height : 2400));
    return new Promise(function (r) { setTimeout(r, 30); }).then(function () {
      var cv = phFlatten(max);
      /* a Musa: menos de 5 MB (se baja la calidad o el tamaño si hace falta) */
      var tryQ = function (q, scale) {
        var c = cv; if (scale < 1) { c = phCanvas(cv.width * scale, cv.height * scale); c.getContext("2d").drawImage(cv, 0, 0, c.width, c.height); }
        return new Promise(function (res) { c.toBlob(res, "image/jpeg", q); }).then(function (b) { if (toMusa && b.size > 4.6 * 1048576 && q > 0.6) return tryQ(q - 0.1, scale); if (toMusa && b.size > 4.6 * 1048576) return tryQ(0.8, scale * 0.8); return b; });
      };
      return tryQ(0.9, 1);
    }).then(blobToData).then(function (data) {
      var name = (d.asset.name || "Foto").replace(/ · editada( \d+)?$/, "") + " · editada";
      return api("/api/photo-sources/save", jreq("POST", { workspaceId: ws(), fromAssetId: base.id, data: data, name: name, recipe: PH.r, saveTo: toMusa ? "musa" : to === "drive" ? "drive" : "same", sourceId: sid, tags: base.tags || [] }));
    }).then(function (x) {
      PH.busy = false;
      PH.r0 = JSON.stringify(PH.r);
      toast("Foto editada guardada en " + (x.savedTo === "drive" ? "Google Drive" + (x.account ? " (" + x.account + ")" : "") + ", carpeta «Musa»" : "Musa") + ". El original no se tocó.");
      F.rows = null; F.filter = x.asset && x.asset.from ? "editadas" : "todas";
      location.hash = "crear/fotos";
    }, function (e) { PH.busy = false; phOutBar(); phToast("No se guardó: " + errOf(e)); });
  }

  /* ═════════ instalación ═════════ */
  function install() {
    var ok = typeof VIEWS2 !== "undefined" && typeof modById === "function" && typeof drawView === "function" && typeof mx === "function";
    if (!ok) return setTimeout(install, 150);
    VIEWS2.fotosLib = function () { drawLib(); };
    if (typeof SUB_DESC !== "undefined") SUB_DESC["crear/fotos"] = "Tus fotos estén donde estén (Musa, Google Drive, Dropbox o un enlace) y el editor de fotos.";
    var cr = modById("crear");
    if (cr && !cr.subs.some(function (x) { return x[0] === "fotos"; })) {
      var fi = cr.subs.findIndex(function (x) { return x[0] === "disenos"; });
      cr.subs.splice(fi >= 0 ? fi + 1 : 1, 0, ["fotos", "Fotos", "fotosLib"]);
    }
    var _dv = drawView;
    drawView = function () {
      var r = _dv.apply(this, arguments);
      try {
        if (onLib()) {
          var pb = document.querySelector(".head .actions .btn-p"); if (pb) { pb.textContent = "Subir fotos"; pb.onclick = function (e) { e.preventDefault(); e.stopPropagation(); pickFiles(); }; }
          var g = document.querySelector(".head .actions .btn-g"); if (g) g.style.display = "none";
        }
      } catch (e) { /* cabecera distinta */ }
      return r;
    };
    if (typeof refreshNav === "function") try { refreshNav(); } catch (e) { /* menú */ }
    if (onLib() && typeof drawView === "function") drawView();
    installPhotoEditor();
    if (photoRoute()) setTimeout(onPhotoRoute, 400);
  }
  (function css() {
    if (document.getElementById("fo-css")) return;
    var st = document.createElement("style"); st.id = "fo-css";
    st.textContent = ""
      + ".fo-note{font-size:13px;line-height:1.55;opacity:.85;margin:0 0 16px;max-width:900px}"
      + ".fo-warn{background:#ffe2cf;color:#7a2e00;border-radius:10px;padding:9px 12px;font-size:12.5px;margin:0 0 14px;max-width:900px}"
      + ".fo-top{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 12px}.fo-top .sp{flex:1}"
      + ".fo-top input[type=search]{height:36px;border-radius:999px;border:1.5px solid var(--border-2,#333);background:transparent;color:inherit;padding:0 14px;font:500 13px var(--sans,Inter,sans-serif);min-width:200px;flex:0 1 280px}"
      + ".fo-f{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 0 16px}.fo-f select{height:36px;border-radius:999px;border:1.5px solid var(--border-2,#333);background:transparent;color:inherit;padding:0 12px;font:600 12.5px var(--sans,Inter,sans-serif)}"
      + ".fo-n{opacity:.6;font-weight:600;margin-left:2px}"
      + ".fo-acc{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 12px}"
      + ".fo-chip{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 6px 0 10px;border-radius:999px;background:rgba(127,127,127,.14);font:600 12px var(--sans,Inter,sans-serif)}.fo-chip button{width:22px;height:22px;border-radius:50%;border:0;background:transparent;color:inherit;cursor:pointer;font-size:15px;line-height:1}.fo-chip button:hover{background:rgba(127,127,127,.25)}"
      + ".fo-ic{width:14px;height:14px;display:inline-block;border-radius:3px;flex:none}.fo-gd{background:conic-gradient(#1fa463 0 33%,#ffd04b 0 66%,#4688f4 0)}.fo-db{background:#0061ff;border-radius:3px}"
      + ".fo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:16px}"
      + ".fo-card{display:flex;flex-direction:column;gap:5px;min-width:0}"
      + ".fo-th{position:relative;display:block;width:100%;aspect-ratio:1;padding:0;border:0;border-radius:12px;overflow:hidden;background:rgba(127,127,127,.12);cursor:pointer}"
      + ".fo-th img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .2s ease}.fo-th:hover img{transform:scale(1.03)}.fo-th:focus-visible{outline:3px solid var(--accent,#ff5e00);outline-offset:2px}"
      + ".fo-th.bad::after{content:'No se puede mostrar';position:absolute;inset:0;display:grid;place-items:center;font:600 12px var(--sans,Inter,sans-serif);opacity:.7}"
      + ".fo-src{position:absolute;left:8px;top:8px;padding:4px 8px;border-radius:999px;font:700 10.5px/1 var(--sans,Inter,sans-serif);background:rgba(0,0,0,.66);color:#fff}"
      + ".fo-s-drive{background:#1a73e8}.fo-s-dropbox{background:#0061ff}.fo-s-link,.fo-s-onedrive{background:#444}"
      + ".fo-ed{position:absolute;right:8px;top:8px;padding:4px 8px;border-radius:999px;font:700 10.5px/1 var(--sans,Inter,sans-serif);background:var(--accent,#ff5e00);color:#fff}"
      + ".fo-card b{font:600 13.5px/1.3 var(--sans,Inter,sans-serif);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fo-card small{font-size:11.5px;opacity:.65}"
      + ".fo-tags{display:flex;gap:4px;flex-wrap:wrap}.fo-tags span{font:600 10.5px/1 var(--sans,Inter,sans-serif);padding:4px 7px;border-radius:999px;background:rgba(127,127,127,.16)}"
      + ".fo-acts{display:flex;gap:4px;flex-wrap:wrap;margin-top:2px}"
      + ".fo-mini{height:26px;padding:0 9px;border-radius:999px;border:1px solid var(--border-2,#3a3a3a);background:transparent;color:inherit;font:600 11.5px/1 var(--sans,Inter,sans-serif);cursor:pointer;display:inline-flex;align-items:center;text-decoration:none}.fo-mini:hover{background:rgba(127,127,127,.14)}"
      + ".fo-empty{border:2px dashed var(--border-2,#333);border-radius:16px;padding:28px;text-align:center}.fo-empty b{display:block;font-size:18px;margin-bottom:6px}.fo-empty p{opacity:.75;margin:0 auto 16px;max-width:560px}"
      + ".fo-mx{color:inherit;font-size:13.5px;line-height:1.55}.fo-mx ol{padding-left:18px}.fo-mx code{font:12px 'JetBrains Mono',monospace;word-break:break-all}"
      + ".fo-mx textarea,.fo-mx input{width:100%;box-sizing:border-box;border:1.5px solid #ccc;border-radius:10px;padding:10px;font:13px var(--sans,Inter,sans-serif)}"
      + ".fo-crumbs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px}.fo-crumbs button{border:0;background:none;color:#1616ff;font:600 12.5px var(--sans,Inter,sans-serif);cursor:pointer;padding:2px}"
      + ".fo-pick{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;max-height:52vh;overflow:auto}"
      + ".fo-pi{border:2px solid transparent;border-radius:10px;padding:0;background:#f2f2f2;cursor:pointer;display:flex;flex-direction:column;overflow:hidden}.fo-pi img{width:100%;aspect-ratio:1;object-fit:cover;display:block}.fo-pi small{font-size:10.5px;padding:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fo-pi.on{border-color:var(--accent,#ff5e00)}"
      + ".fo-pf{grid-column:1/-1;text-align:left;border:0;border-radius:8px;background:#f2f2f2;padding:8px 10px;font:600 12.5px var(--sans,Inter,sans-serif);cursor:pointer}"
      + "#phSaveTo{max-width:220px}"
      + "@media (max-width:760px){.fo-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.fo-top input[type=search]{flex:1 1 100%}}";
    document.head.appendChild(st);
  })();
  install();
})();
