/* bridge-qr.js — Códigos QR en Musa (basado en QeepeR de Douglas Lovera).
 *
 * Dónde viven (decisión 2026-11-10): un mix.
 *  · Crear › Códigos QR: la biblioteca del espacio. Todos los QR (los sueltos y los de cada cosa), con su destino,
 *    escaneos, estado y descargas. Aquí se crean los sueltos: enlace, WhatsApp, Wi‑Fi, contacto, correo, llamada,
 *    SMS, texto, o «algo de Musa».
 *  · Botón «Código QR» en cada cosa compatible, donde ya se comparte su enlace: diseños y presentaciones (editor ›
 *    Compartir), websites (tarjeta), eventos (pestaña Página), formularios, briefs y cotizaciones. Un QR por cosa:
 *    pedirlo otra vez abre el mismo (lo impreso nunca cambia). Queda en la biblioteca.
 *  · Editor › Importar › «Código QR…»: lo pega en el frame como imagen vectorial.
 * Dinámico = <app>/r/<código> (el destino se cambia sin reimprimir, se pausa, cuenta escaneos). Fijo = el contenido
 * va dentro del código (Wi‑Fi, contacto, correo, llamada, SMS, texto). Las reglas viven en la base (trigger
 * v2_qr_guard) y el dibujo en qr-core.js: lo mismo que usa el MCP (qr-mcp.mjs).
 */
(function () {
  "use strict";
  function RR() { return window.__musaReal; }
  function bridge() { try { return window.parent !== window && window.parent.__musaBridge; } catch (e) { return null; } }
  function api(path, o) { var b = bridge(); if (!b) return Promise.reject(new Error("sin conexión")); return b.api(path, o); }
  function J(method, body) { return { method: method, headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(body) }; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var enc = encodeURIComponent;
  function T(s) { try { return musaI18n.t(String(s)); } catch (e) { return s; } }
  function toast(m) { if (typeof uiToast === "function") uiToast(m); }
  function APP() { try { return window.parent.location.origin; } catch (e) { return location.origin; } }
  function MQ() { return window.MusaQR; }
  function shortUrl(code) { return APP() + "/r/" + code; }
  function errMsg(x) {
    var m = String(x && (x.message || x.error) || x || "error");
    try { var j = JSON.parse(m); m = j.message || j.error || m; } catch (e) {}
    if (/row-level security|permission denied|violates row/i.test(m)) return "No tienes permiso para esto en este espacio (necesitas rol Editor o más).";
    return m;
  }
  function wsName(id) { var w = typeof WSS !== "undefined" && WSS[id]; var R = RR() || {}; return /^ws_user_/.test(id) && w && w.name === R.me ? "Mi espacio personal" : (w ? w.name : "otro espacio"); }
  function writeWs() { var R = RR(); return R.all ? (R.writeWs && typeof WSS !== "undefined" && WSS[R.writeWs] ? R.writeWs : R.personalWs) : R.ws; }
  function wsFilter() { var R = RR(); return R.wsFilter ? R.wsFilter() : "workspace_id=eq." + enc(R.ws); }
  function ago(iso) {
    if (!iso) return "nunca";
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 90) return "hace un momento"; if (s < 3600) return "hace " + Math.round(s / 60) + " min"; if (s < 86400) return "hace " + Math.round(s / 3600) + " h";
    var d = Math.round(s / 86400); return d === 1 ? "ayer" : "hace " + d + " días";
  }
  function safeName(n) { return String(n || "codigo-qr").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").slice(0, 80) || "codigo-qr"; }
  function save(name, blob) { var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.style.display = "none"; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000); }
  function copy(t) { return (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast("Enlace copiado"); }, function () { RR().promptBox ? RR().promptBox("Copia el enlace", t, { title: "Enlace del QR" }) : toast(t); }); }
  function loadLib(src, glob) { if (window[glob]) return Promise.resolve(window[glob]); return new Promise(function (ok, ko) { var s = document.createElement("script"); s.src = src; s.onload = function () { ok(window[glob]); }; s.onerror = function () { ko(new Error("no cargó " + src)); }; document.head.appendChild(s); }); }

  var TYPE_ORDER = ["url", "whatsapp", "wifi", "vcard", "email", "phone", "sms", "text"];
  var TYPE_HINT = {
    url: "Lleva a una web. Dinámico: cambias el destino cuando quieras sin reimprimir.",
    whatsapp: "Abre un chat de WhatsApp con tu número y un mensaje listo. Dinámico.",
    wifi: "Se conecta a tu red sin escribir la clave. Fijo: si cambias la clave, crea otro.",
    vcard: "Guarda tus datos en los contactos del celular. Fijo.",
    email: "Abre un correo listo para enviarte. Fijo.",
    phone: "Llama a un número. Fijo.",
    sms: "Abre un SMS listo para enviarte. Fijo.",
    text: "Muestra un texto. Fijo.",
    item: "El QR de un diseño, presentación, website, evento, formulario, brief o cotización. Uno por cosa.",
  };
  var TARGET_ES = { design: "Diseño", presentation: "Presentación", website: "Website", event: "Evento", form: "Formulario", brief: "Brief", quote: "Cotización" };
  var Q = { rows: null, err: null, brands: null, logos: {}, filter: "todos", q: "", busy: false };

  /* ═════════ datos ═════════ */
  function load(force) {
    if (Q.rows && !force) return Promise.resolve(Q.rows);
    return api("/rest/v1/qr_codes?" + wsFilter() + "&select=*&order=created_at.desc&limit=1000").then(function (r) {
      Q.rows = r || []; Q.err = null;
      var R = RR(); R.wsOf = R.wsOf || {}; Q.rows.forEach(function (x) { R.wsOf["qr:" + x.id] = x.workspace_id; });
      return Q.rows;
    }, function (x) { Q.rows = []; Q.err = errMsg(x); return Q.rows; });
  }
  function loadBrands() {
    if (Q.brands) return Promise.resolve(Q.brands);
    return api("/rest/v1/brands?" + wsFilter() + "&select=id,name,colors,logo,workspace_id&order=name.asc&limit=400").then(function (r) { Q.brands = r || []; return Q.brands; }, function () { Q.brands = []; return Q.brands; });
  }
  function brandById(id) { return (Q.brands || []).find(function (b) { return b.id === id; }) || null; }
  function brandCols(b) { return ((b && b.colors) || []).map(function (c) { return typeof c === "string" ? c : c && (c.hex || c.value); }).filter(Boolean); }
  function brandLogoUrl(b) { var l = b && b.logo; var u = typeof l === "string" ? l : l && (l.url || l.src); return /^https?:\/\//.test(u || "") ? u : null; }
  /* el logo como data URL: así el PNG y el SVG salen completos (con un enlace externo el canvas queda bloqueado) */
  function logoData(brandId) {
    var b = brandById(brandId), u = brandLogoUrl(b);
    if (!u) return Promise.resolve(null);
    if (Q.logos[u] !== undefined) return Promise.resolve(Q.logos[u]);
    return fetch(u, { mode: "cors" }).then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.blob(); }).then(function (bl) {
      if (!/^image\//.test(bl.type) || bl.size > 600000) return null;
      return new Promise(function (ok) { var fr = new FileReader(); fr.onload = function () { ok(fr.result); }; fr.onerror = function () { ok(null); }; fr.readAsDataURL(bl); });
    }).then(function (d) { Q.logos[u] = d; return d; }, function () { Q.logos[u] = null; return null; });
  }
  function qrText(row) { return row.kind === "dynamic" ? shortUrl(row.code) : row.content; }
  function styleOf(row, extra) { return Object.assign({ dots: "square", eyes: "square", margin: 3 }, row.style || {}, extra || {}); }
  /* SVG listo (con logo si lo pide el estilo) */
  function svgFor(row, size, style) {
    var st = styleOf(row, style);
    return (st.logo && row.brand_id ? logoData(row.brand_id) : Promise.resolve(null)).then(function (logo) {
      return MQ().svg(qrText(row), Object.assign({}, st, { logo: logo, size: size || 512, title: row.name }));
    });
  }

  /* ═════════ «¿se lee?»: se dibuja como PNG y se lee con jsQR, igual que un celular ═════════ */
  var readSeq = 0;
  function readable(text, style, logo) {
    var my = ++readSeq;
    return loadLib("vendor/jsqr.min.js", "jsQR").then(function () {
      return MQ().png(text, Object.assign({}, style, { logo: logo }), 1000);
    }).then(function (blob) {
      return new Promise(function (ok, ko) { var im = new Image(); im.onload = function () { ok(im); }; im.onerror = ko; im.src = URL.createObjectURL(blob); });
    }).then(function (im) {
      if (my !== readSeq) return null;
      var W = 1200, cv = document.createElement("canvas"); cv.width = W; cv.height = W;
      var cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, W, W); cx.drawImage(im, 100, 100, 1000, 1000);
      URL.revokeObjectURL(im.src);
      var q = window.jsQR(cx.getImageData(0, 0, W, W).data, W, W);
      return !!q && q.data === text;
    }, function () { return null; });
  }

  /* ═════════ estilos ═════════ */
  (function () {
    var st = document.createElement("style");
    st.textContent = ""
      + ".qr-note{font-size:13px;line-height:1.55;opacity:.85;margin:0 0 16px;max-width:900px}"
      + ".qr-top{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 14px}.qr-top .sp{flex:1}"
      + ".qr-top input{height:36px;border-radius:999px;border:1.5px solid var(--border-2,#333);background:transparent;color:inherit;padding:0 14px;font:500 13px var(--sans,Inter,sans-serif);min-width:200px;flex:0 1 260px}"
      + ".qrb{height:36px;padding:0 14px;border-radius:999px;border:1.5px solid var(--border-2,#333);background:transparent;color:inherit;font:700 13px/1 var(--sans,Inter,sans-serif);cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;text-decoration:none}"
      + ".qrb.pri{background:var(--accent,#ff5e00);border-color:transparent;color:#fff}.qrb.on{background:var(--bright,#111);color:var(--bg,#fff);border-color:transparent}.qrb:disabled{opacity:.5;cursor:default}"
      + ".org-a .qrb,.qr-mx .qrb{border-color:#111;color:#111;height:32px;font-size:12px}.org-a .qrb.pri,.qr-mx .qrb.pri{color:#fff;border-color:transparent}.qr-mx .qrb.on{background:#111;color:#fff}"
      + ".qr-card{cursor:pointer}.qr-card .qr-th{background:#fff;border-radius:12px;aspect-ratio:1;display:grid;place-items:center;padding:10px;border:1px solid rgba(0,0,0,.08)}.qr-card .qr-th svg{width:100%;height:100%;display:block}"
      + ".qr-card.off .qr-th{opacity:.45}.qr-card b{font:400 19px/1.05 var(--serif);text-transform:uppercase;color:#111;word-break:break-word}.qr-card small{color:#555;font-size:12px;line-height:1.4;word-break:break-all}"
      + ".qr-chips{display:flex;gap:6px;flex-wrap:wrap}.qr-c{display:inline-flex;align-items:center;font:700 10.5px/1 var(--sans,Inter,sans-serif);padding:5px 9px;border-radius:999px;background:rgba(0,0,0,.08);color:#333;white-space:nowrap}"
      + ".qr-c.dyn{background:#e1e1ff;color:#1616ff}.qr-c.off{background:#fde0de;color:#d7261e}.qr-c.ws{background:#111;color:#fff}"
      + ".qr-card .acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}"
      + ".qr-empty{border:2px dashed var(--border-2,#333);border-radius:16px;padding:26px;text-align:center}.qr-empty b{display:block;font-size:18px;margin-bottom:6px}.qr-empty p{opacity:.75;margin:0 auto 16px;max-width:560px}"
      + ".qr-types{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}"
      + ".mx-box.qr-wide{max-width:min(940px,96vw);width:940px}"
      + ".qr-mx{display:grid;grid-template-columns:300px 1fr;gap:22px;align-items:start;color:#111}"
      + ".qr-mx .qr-pv{background:#fff;border-radius:14px;padding:14px;border:1px solid #e3e1d6;aspect-ratio:1;display:grid;place-items:center}.qr-mx .qr-pv svg{width:100%;height:100%;display:block}"
      + ".qr-read{display:flex;align-items:center;gap:6px;font:700 12px var(--sans,Inter,sans-serif);margin:10px 0 0;min-height:18px}.qr-read.ok{color:#1616ff}.qr-read.bad{color:#d7261e}.qr-read.wait{color:#888}"
      + ".qr-warn{background:#ffe2cf;color:#7a2e00;border-radius:10px;padding:8px 10px;font-size:12px;margin-top:8px}"
      + ".qr-dl{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}"
      + ".qr-f{display:flex;flex-direction:column;gap:12px}.qr-f .fx-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.qr-f .fx-row.r3{grid-template-columns:1fr 1fr 1fr}"
      + ".qr-seg{display:flex;gap:6px;flex-wrap:wrap}.qr-seg button{height:30px;padding:0 12px;border-radius:999px;border:1.5px solid #111;background:transparent;color:#111;font:700 12px var(--sans,Inter,sans-serif);cursor:pointer}.qr-seg button.on{background:#111;color:#fff}"
      + ".qr-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px}.qr-tabs button{height:32px;padding:0 12px;border-radius:999px;border:1.5px solid #111;background:transparent;color:#111;font:700 12px var(--sans,Inter,sans-serif);cursor:pointer}.qr-tabs button.on{background:var(--accent,#ff5e00);border-color:transparent;color:#fff}"
      + ".qr-hint{font-size:12px;color:#555;margin:0}.qr-link{font:600 12px var(--sans,Inter,sans-serif);word-break:break-all;color:#111}.qr-link a{color:#1616ff}"
      + ".qr-cols{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.qr-cols label{display:flex;align-items:center;gap:6px;font-size:12px;color:#444}.qr-cols input[type=color]{width:34px;height:28px;border:1px solid #ccc;border-radius:8px;padding:0;background:none}"
      + ".qr-stats{background:#f4f3ea;border-radius:12px;padding:12px}.qr-stats .big{font:400 30px/1 var(--serif);color:#111}.qr-bars{display:flex;align-items:flex-end;gap:2px;height:44px;margin:10px 0 6px}.qr-bars i{flex:1;background:#111;border-radius:2px 2px 0 0;min-height:2px;opacity:.85}"
      + ".qr-stats small{color:#666;font-size:11.5px}"
      + ".qr-x{display:inline-flex;align-items:center;gap:6px}"
      + "@media (max-width:760px){.qr-mx{grid-template-columns:1fr}.qr-mx .qr-pv{max-width:260px;margin:0 auto}.qr-f .fx-row,.qr-f .fx-row.r3{grid-template-columns:1fr}}";
    document.head.appendChild(st);
  })();

  /* ═════════ Crear › Códigos QR ═════════ */
  function onLib() { return typeof route !== "undefined" && route.mod === "crear" && route.sub === "qr"; }
  function drawLib() {
    var body = document.getElementById("body"); if (!body || !onLib()) return;
    var R = RR();
    if (!R || !R.on) { body.innerHTML = '<p class="qr-note">Cargando…</p>'; return; }
    if (!Q.rows) { body.innerHTML = '<p class="qr-note">Cargando tus códigos QR…</p>'; load().then(function () { if (onLib()) drawLib(); }); return; }
    var h = '<p class="qr-note">Cada QR guarda su destino, sus escaneos y su estado. Los dinámicos pasan por Musa: cambias a dónde llevan o los pausas sin reimprimir. Los fijos (Wi‑Fi, contacto, correo, llamada, SMS, texto) llevan el contenido adentro. Los diseños, presentaciones, websites, eventos, formularios, briefs y cotizaciones tienen su botón «Código QR» donde se comparten.</p>';
    if (Q.err) h += '<div class="qr-warn">No pude cargar los códigos QR: ' + esc(Q.err) + "</div>";
    if (!Q.rows.length) {
      h += '<div class="qr-empty"><b>Todavía no tienes códigos QR</b><p>Elige qué quieres que abra. Para algo impreso conviene uno dinámico: si cambias el destino, el impreso sigue sirviendo.</p><div class="qr-types">'
        + TYPE_ORDER.map(function (t) { return '<button type="button" class="qrb" data-qrn="' + t + '">' + esc(MQ().TYPES[t].label) + "</button>"; }).join("")
        + '<button type="button" class="qrb pri" data-qrn="item">Algo de Musa</button></div></div>';
      body.innerHTML = h; return;
    }
    var F = [["todos", "Todos"], ["dyn", "Dinámicos"], ["fijo", "Fijos"], ["musa", "De algo de Musa"], ["off", "Pausados"]];
    h += '<div class="qr-top"><input type="search" id="qrSearch" placeholder="Buscar por nombre o destino" value="' + esc(Q.q) + '">'
      + F.map(function (f) { return '<button type="button" class="qrb' + (Q.filter === f[0] ? " on" : "") + '" data-qrf="' + f[0] + '">' + f[1] + "</button>"; }).join("")
      + '<span class="sp"></span><button type="button" class="qrb pri" data-qrn="url">+ Nuevo QR</button></div>';
    var s = Q.q.trim().toLowerCase();
    var rows = Q.rows.filter(function (r) {
      if (Q.filter === "dyn" && r.kind !== "dynamic") return false;
      if (Q.filter === "fijo" && r.kind !== "static") return false;
      if (Q.filter === "musa" && !r.target_type) return false;
      if (Q.filter === "off" && r.active) return false;
      return !s || [r.name, r.destination_url, r.content, r.code].some(function (v) { return String(v || "").toLowerCase().indexOf(s) >= 0; });
    });
    h += rows.length ? '<div class="org-grid">' + rows.map(card).join("") + "</div>" : '<p class="qr-note">Nada coincide con la búsqueda.</p>';
    body.innerHTML = h;
    /* miniaturas: sin logo (rápido); el logo aparece al abrir el QR */
    [].forEach.call(body.querySelectorAll("[data-qrth]"), function (el) {
      var r = Q.rows.find(function (x) { return x.id === el.getAttribute("data-qrth"); }); if (!r) return;
      try { el.innerHTML = MQ().svg(qrText(r), Object.assign({}, styleOf(r), { logo: null, size: 240 })); } catch (e) { el.textContent = "—"; }
    });
  }
  function card(r) {
    var R = RR(), t = MQ().TYPES[r.content_type] || { label: r.content_type };
    var dest = r.kind === "dynamic" ? r.destination_url : summary(r);
    var chips = '<span class="qr-c' + (r.kind === "dynamic" ? " dyn" : "") + '">' + (r.kind === "dynamic" ? "Dinámico" : "Fijo") + "</span>"
      + '<span class="qr-c">' + esc(r.target_type ? TARGET_ES[r.target_type] : t.label) + "</span>"
      + (r.active ? "" : '<span class="qr-c off">Pausado</span>')
      + (R.all ? '<span class="qr-c ws">' + esc(wsName(r.workspace_id)) + "</span>" : "");
    return '<div class="org-a qr-card' + (r.active ? "" : " off") + '" data-qro="' + esc(r.id) + '"><div class="qr-th" data-qrth="' + esc(r.id) + '"></div>'
      + '<div class="qr-chips">' + chips + "</div><b>" + esc(r.name) + "</b><small>" + esc(String(dest || "").replace(/^https?:\/\//, "").slice(0, 90)) + "</small>"
      + (r.kind === "dynamic" ? "<small>" + (r.scans === 1 ? "1 escaneo" : (r.scans || 0) + " escaneos") + " · último: " + esc(ago(r.last_scan_at)) + "</small>" : "")
      + '<div class="acts"><button type="button" class="qrb pri" data-qra="open" data-id="' + esc(r.id) + '">Abrir</button><button type="button" class="qrb" data-qra="png" data-id="' + esc(r.id) + '">PNG</button>'
      + (r.kind === "dynamic" ? '<button type="button" class="qrb" data-qra="copy" data-id="' + esc(r.id) + '">Copiar enlace</button>' : "") + "</div></div>";
  }
  function summary(r) {
    var f = r.fields || {};
    switch (r.content_type) {
      case "wifi": return "Red: " + (f.ssid || "—");
      case "vcard": return [((f.firstName || "") + " " + (f.lastName || "")).trim(), f.org].filter(Boolean).join(" · ") || "Contacto";
      case "email": return f.to || "Correo";
      case "phone": case "sms": return f.phone || r.content;
      case "text": return String(r.content || "").slice(0, 80);
    }
    return r.content || "";
  }

  /* ═════════ diálogo: un QR ═════════ */
  function openQR(id) {
    var r = (Q.rows || []).find(function (x) { return x.id === id; });
    var go = r ? Promise.resolve(r) : api("/rest/v1/qr_codes?id=eq." + enc(id) + "&select=*").then(function (x) { return (x || [])[0]; });
    return Promise.all([go, loadBrands()]).then(function (a) {
      var row = a[0]; if (!row) return toast("No encontré ese código QR");
      drawDetail(JSON.parse(JSON.stringify(row)));
    }, function (x) { toast("No se pudo abrir: " + errMsg(x)); });
  }
  function brandOpts(ws, sel) {
    var seen = {};
    return '<option value="">Sin marca</option>' + (Q.brands || []).filter(function (b) { if (b.workspace_id !== ws) return false; var k = b.name.toLowerCase(); if (seen[k] && b.id !== sel) return false; seen[k] = 1; return true; })
      .map(function (b) { return '<option value="' + esc(b.id) + '"' + (b.id === sel ? " selected" : "") + ">" + esc(b.name) + "</option>"; }).join("");
  }
  function seg(name, opts, val) { return '<div class="qr-seg" data-seg="' + name + '">' + opts.map(function (o) { return '<button type="button" data-v="' + o[0] + '"' + (String(val) === String(o[0]) ? ' class="on"' : "") + ">" + o[1] + "</button>"; }).join("") + "</div>"; }
  function drawDetail(row) {
    var D = { row: row, st: styleOf(row), dirty: false };
    var dyn = row.kind === "dynamic", t = MQ().TYPES[row.content_type] || { label: row.content_type };
    var target = row.target_type ? '<p class="qr-link">' + esc(TARGET_ES[row.target_type]) + " de Musa · lleva a " + '<a href="' + esc(row.destination_url) + '" target="_blank" rel="noopener">' + esc(String(row.destination_url).replace(/^https?:\/\//, "")) + "</a></p>" : "";
    var left = '<div><div class="qr-pv" id="qrPv"></div><div class="qr-read wait" id="qrRead"></div><div id="qrWarn"></div>'
      + '<div class="qr-dl"><button type="button" class="qrb pri" data-qd="png">PNG</button><button type="button" class="qrb" data-qd="png2">PNG grande</button><button type="button" class="qrb" data-qd="svg">SVG</button></div>'
      + '<div class="qr-dl"><button type="button" class="qrb" data-qd="insert">Insertar en un diseño</button>' + (dyn ? '<button type="button" class="qrb" data-qd="copy">Copiar enlace</button>' : "") + "</div></div>";
    var right = '<div class="qr-f">'
      + '<div><label class="fx-lbl">Nombre</label><input class="fx-in" id="qrName" value="' + esc(row.name) + '" maxlength="160"></div>'
      + (dyn ? '<div><label class="fx-lbl">Lleva a</label><input class="fx-in" id="qrDest" value="' + esc(row.destination_url) + '" inputmode="url"><p class="qr-hint">Enlace corto del código: <b data-no-i18n>' + esc(shortUrl(row.code).replace(/^https?:\/\//, "")) + '</b></p><p class="qr-hint">Si cambias el destino, el QR impreso sigue sirviendo.</p>' + target + "</div>"
        : '<div><label class="fx-lbl">' + esc(t.label) + '</label><p class="qr-link">' + esc(summary(row)) + '</p><p class="qr-hint">Fijo: el contenido va dentro del código. Para cambiarlo, crea otro QR.</p></div>')
      + (dyn ? '<div><label class="fx-lbl">Estado</label>' + seg("active", [["1", "Activo"], ["0", "Pausado"]], row.active ? "1" : "0") + '<p class="qr-hint">Pausado: quien lo escanee ve que está en pausa, sin perder el código ni sus escaneos.</p></div>' : "")
      + '<div><label class="fx-lbl">Marca</label><select class="fx-in" id="qrBrand">' + brandOpts(row.workspace_id, row.brand_id) + "</select></div>"
      + '<div><label class="fx-lbl">Colores</label><div class="qr-cols"><button type="button" class="qrb" data-qd="brandcols">Colores de la marca</button><button type="button" class="qrb" data-qd="black">Negro</button>'
      + '<label>Código <input type="color" id="qrFg" value="' + esc(MQ().hex6(D.st.fg) || "#111111") + '"></label><label>Esquinas <input type="color" id="qrEye" value="' + esc(MQ().hex6(D.st.eye) || MQ().hex6(D.st.fg) || "#111111") + '"></label><label>Fondo <input type="color" id="qrBg" value="' + esc(MQ().hex6(D.st.bg) || "#ffffff") + '"></label></div></div>'
      + '<div class="fx-row"><div><label class="fx-lbl">Módulos</label>' + seg("dots", [["square", "Cuadrados"], ["rounded", "Redondeados"]], D.st.dots) + "</div>"
      + '<div><label class="fx-lbl">Esquinas</label>' + seg("eyes", [["square", "Cuadradas"], ["rounded", "Redondeadas"]], D.st.eyes) + "</div></div>"
      + '<div class="fx-row"><div><label class="fx-lbl">Logo de la marca al centro</label>' + seg("logo", [["0", "Sin logo"], ["1", "Con logo"]], D.st.logo ? "1" : "0") + "</div>"
      + '<div><label class="fx-lbl">Margen</label>' + seg("margin", [["1", "Mínimo"], ["3", "Normal"], ["5", "Amplio"]], D.st.margin) + "</div></div>"
      + (dyn ? '<div class="qr-stats" id="qrStats"><small>Cargando escaneos…</small></div>' : "")
      + '<div class="ag-ctl" style="margin-top:4px"><button class="pri" data-qd="save">Guardar</button><button data-mx="close">Cerrar</button><button data-qd="del" style="margin-left:auto">Eliminar</button></div>'
      + "</div>";
    var body = '<div class="qr-mx">' + left + right + "</div>";
    var handler = function (e) {
      var b = e.target.closest("[data-qd],[data-seg] button"); if (!b) return;
      if (b.parentNode && b.parentNode.getAttribute && b.parentNode.getAttribute("data-seg")) {
        var k = b.parentNode.getAttribute("data-seg"), v = b.getAttribute("data-v");
        [].forEach.call(b.parentNode.children, function (x) { x.classList.toggle("on", x === b); });
        if (k === "active") { D.row.active = v === "1"; D.activeDirty = true; }
        else if (k === "logo") { D.st.logo = v === "1"; if (D.st.logo && !D.row.brand_id) toast("Elige la marca para usar su logo"); }
        else if (k === "margin") D.st.margin = +v;
        else D.st[k] = v;
        D.dirty = true; return paint();
      }
      var a = b.getAttribute("data-qd");
      if (a === "brandcols") { var br = brandById(D.row.brand_id); if (!br) return toast("Elige primero la marca"); var c = MQ().brandColors(brandCols(br), "#ffffff"); D.st.fg = c.fg; D.st.eye = c.eye; D.st.bg = "#ffffff"; syncColors(); D.dirty = true; return paint(); }
      if (a === "black") { D.st.fg = "#111111"; D.st.eye = "#111111"; D.st.bg = "#ffffff"; syncColors(); D.dirty = true; return paint(); }
      if (a === "png" || a === "png2") return dlPng(D.row, D.st, a === "png2" ? 2048 : 1024);
      if (a === "svg") return dlSvg(D.row, D.st);
      if (a === "copy") return copy(shortUrl(D.row.code));
      if (a === "insert") return persist(D, true).then(function () { insertFlow(D.row, D.st); });
      if (a === "save") return persist(D).then(function (ok) { if (ok) { mxEl.hidden = true; toast("Código QR guardado"); } });
      if (a === "del") return del(D.row);
    };
    handler.input = function (e) {
      var id = e.target && e.target.id;
      if (id === "qrFg" || id === "qrEye" || id === "qrBg") { D.st.fg = val("qrFg"); D.st.eye = val("qrEye"); D.st.bg = val("qrBg"); D.dirty = true; paint(); }
      if (id === "qrName" || id === "qrDest") D.dirty = true;
    };
    mx(esc(row.name), dyn ? "Código QR dinámico" : "Código QR fijo · " + t.label, body, handler);
    var box = mxEl.querySelector(".mx-box"); if (box) box.classList.add("qr-wide");
    mxEl.onchange = function (e) {
      if (e.target && e.target.id === "qrBrand") { D.row.brand_id = e.target.value || null; D.dirty = true; if (D.st.logo) paint(); }
    };
    function val(i) { var el = document.getElementById(i); return el ? el.value : null; }
    function syncColors() { var f = document.getElementById("qrFg"), y = document.getElementById("qrEye"), g = document.getElementById("qrBg"); if (f) f.value = D.st.fg; if (y) y.value = D.st.eye; if (g) g.value = D.st.bg; }
    var pt = null;
    function paint() {
      var pv = document.getElementById("qrPv"); if (!pv) return;
      var logoP = D.st.logo && D.row.brand_id ? logoData(D.row.brand_id) : Promise.resolve(null);
      logoP.then(function (logo) {
        if (D.st.logo && D.row.brand_id && !logo) document.getElementById("qrWarn").innerHTML = '<div class="qr-warn">La marca no tiene un logo que se pueda usar. Súbelo en Crear › Marcas.</div>';
        var text = qrText(D.row), st = Object.assign({}, D.st, { logo: logo });
        try { pv.innerHTML = MQ().svg(text, Object.assign({}, st, { size: 520 })); }
        catch (x) { pv.textContent = x.message; return; }
        var w = MQ().warnings(st); var wb = document.getElementById("qrWarn");
        if (wb && !(D.st.logo && D.row.brand_id && !logo)) wb.innerHTML = w.map(function (m) { return '<div class="qr-warn">' + esc(m) + "</div>"; }).join("");
        var rd = document.getElementById("qrRead"); if (rd) { rd.className = "qr-read wait"; rd.textContent = "Probando si se lee…"; }
        clearTimeout(pt);
        pt = setTimeout(function () {
          readable(text, st, logo).then(function (ok) {
            var el = document.getElementById("qrRead"); if (!el || ok === null) { if (el) el.textContent = ""; return; }
            el.className = "qr-read " + (ok ? "ok" : "bad");
            el.textContent = ok ? "✓ Probado: se lee bien" : "⚠ No se pudo leer con estos colores o este logo: prueba otros";
          });
        }, 350);
      });
    }
    paint();
    if (dyn) stats(row.id);
  }
  function stats(id) {
    var since = new Date(Date.now() - 29 * 864e5); var iso = since.getFullYear() + "-" + String(since.getMonth() + 1).padStart(2, "0") + "-" + String(since.getDate()).padStart(2, "0");
    api("/rest/v1/qr_scan_days?qr_id=eq." + enc(id) + "&day=gte." + iso + "&select=day,country,device,scans").then(function (rows) {
      var el = document.getElementById("qrStats"); if (!el) return;
      var row = (Q.rows || []).find(function (x) { return x.id === id; }) || {};
      var byDay = {}, byC = {}, byD = {}, total = 0;
      (rows || []).forEach(function (r) { byDay[r.day] = (byDay[r.day] || 0) + r.scans; if (r.country) byC[r.country] = (byC[r.country] || 0) + r.scans; if (r.device) byD[r.device] = (byD[r.device] || 0) + r.scans; total += r.scans; });
      var days = []; for (var i = 29; i >= 0; i--) { var d = new Date(Date.now() - i * 864e5); days.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0")); }
      var mx0 = Math.max.apply(null, days.map(function (d) { return byDay[d] || 0; }).concat([1]));
      var DEV = { mobile: "celular", tablet: "tablet", desktop: "computadora" };
      var top = function (o, map) { return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; }).slice(0, 4).map(function (k) { return (map ? map[k] || k : k) + " " + o[k]; }).join(" · "); };
      el.innerHTML = '<div style="display:flex;align-items:baseline;gap:10px"><span class="big">' + (row.scans || 0) + '</span><small>' + ((row.scans || 0) === 1 ? "escaneo en total" : "escaneos en total") + " · último: " + esc(ago(row.last_scan_at)) + "</small></div>"
        + '<div class="qr-bars" title="Últimos 30 días">' + days.map(function (d) { var v = byDay[d] || 0; return '<i style="height:' + Math.max(4, Math.round(v * 100 / mx0)) + '%;opacity:' + (v ? ".9" : ".15") + '" title="' + d + ": " + v + '"></i>'; }).join("") + "</div>"
        + "<small>Últimos 30 días: " + total + (total ? " · " + esc(top(byC)) + (Object.keys(byD).length ? " · " + esc(top(byD, DEV)) : "") : "") + ". Sin datos de la persona: solo el día, el país y el tipo de equipo.</small>";
    }, function () { var el = document.getElementById("qrStats"); if (el) el.innerHTML = "<small>No pude cargar los escaneos.</small>"; });
  }
  /* guarda nombre, destino, estado, marca y estilo; true si quedó bien */
  function persist(D, quiet) {
    var row = D.row, name = (document.getElementById("qrName") || {}).value, dest = document.getElementById("qrDest") ? document.getElementById("qrDest").value : null;
    var patch = {};
    if (name != null && name.trim() && name.trim() !== row.name) patch.name = name.trim();
    if (row.kind === "dynamic" && dest != null && dest.trim() !== row.destination_url) {
      var u = MQ().normalizeUrl(dest);
      if (!u) { toast("Escribe un enlace válido (https://…)"); return Promise.resolve(false); }
      if (MQ().isShortLink(u)) { toast("Ese enlace ya es de un código QR de Musa: apunta a su destino real"); return Promise.resolve(false); }
      patch.destination_url = u; patch.fields = Object.assign({}, row.fields || {}, { url: u });
      if (row.target_type) { patch.target_type = null; patch.target_id = null; }
    }
    if (D.activeDirty) patch.active = row.active;
    var orig = (Q.rows || []).find(function (x) { return x.id === row.id; }) || {};
    if ((row.brand_id || null) !== (orig.brand_id || null)) patch.brand_id = row.brand_id || null;
    var st = { fg: D.st.fg, bg: D.st.bg, eye: D.st.eye, dots: D.st.dots, eyes: D.st.eyes, margin: D.st.margin, logo: !!D.st.logo };
    if (JSON.stringify(st) !== JSON.stringify(row.style || {})) patch.style = st;
    if (!Object.keys(patch).length) return Promise.resolve(true);
    return api("/rest/v1/qr_codes?id=eq." + enc(row.id), J("PATCH", patch)).then(function (r) {
      var nr = (r || [])[0]; if (!nr) throw new Error("No tienes permiso para cambiar este QR");
      D.row = Object.assign(row, nr); D.dirty = false; D.activeDirty = false;
      if (Q.rows) { var i = Q.rows.findIndex(function (x) { return x.id === nr.id; }); if (i >= 0) Q.rows[i] = nr; else Q.rows.unshift(nr); }
      if (!quiet && patch.destination_url) toast("Destino cambiado: el próximo escaneo ya va ahí");
      if (onLib()) setTimeout(drawLib, 0);
      return true;
    }, function (x) { toast("No se pudo guardar: " + errMsg(x)); return false; });
  }
  function del(row) {
    var R = RR();
    var msg = row.kind === "dynamic" ? "Si ya está impreso, dejará de funcionar: quien lo escanee verá que no existe. Si solo quieres dejarlo de usar un tiempo, mejor pausarlo." : "Se borra de tu biblioteca. Los que ya imprimiste siguen funcionando (el contenido va dentro del código).";
    R.confirmBox(msg, { title: "¿Eliminar «" + row.name + "»?", ok: "Eliminar", danger: true }).then(function (ok) {
      if (!ok) return;
      api("/rest/v1/qr_codes?id=eq." + enc(row.id), { method: "DELETE", headers: { Prefer: "return=representation" } }).then(function (r) {
        if (!r || !r.length) return toast("Solo quien lo creó o un admin del espacio lo puede eliminar. Puedes pausarlo.");
        Q.rows = (Q.rows || []).filter(function (x) { return x.id !== row.id; });
        mxEl.hidden = true; toast("Código QR eliminado"); if (onLib()) drawLib();
      }, function (x) { toast("No se pudo eliminar: " + errMsg(x)); });
    });
  }
  function dlPng(row, st, px) {
    toast("Armando el PNG…");
    var s = styleOf(row, st);
    (s.logo && row.brand_id ? logoData(row.brand_id) : Promise.resolve(null)).then(function (logo) {
      return MQ().png(qrText(row), Object.assign({}, s, { logo: logo }), px);
    }).then(function (b) { save(safeName(row.name) + "-qr.png", b); toast("PNG descargado"); }, function (x) { toast("No se pudo armar el PNG: " + errMsg(x)); });
  }
  function dlSvg(row, st) {
    svgFor(row, 1024, st).then(function (s) { save(safeName(row.name) + "-qr.svg", new Blob([s], { type: "image/svg+xml" })); toast("SVG descargado"); }, function (x) { toast("No se pudo armar el SVG: " + errMsg(x)); });
  }

  /* ═════════ diálogo: nuevo QR ═════════ */
  var FIELDS = {
    url: [["url", "Enlace", "url", "https://tu-web.com/promo"]],
    whatsapp: [["phone", "Número con código de país", "tel", "51987654321"], ["message", "Mensaje listo (opcional)", "text", "Hola, quiero más información"]],
    wifi: [["ssid", "Nombre de la red (SSID)", "text", ""], ["password", "Clave", "text", ""], ["encryption", "Seguridad", "select", [["WPA", "WPA/WPA2/WPA3"], ["WEP", "WEP"], ["none", "Sin clave"]]], ["hidden", "Red oculta", "select", [["", "No"], ["1", "Sí"]]]],
    vcard: [["firstName", "Nombre", "text", ""], ["lastName", "Apellido", "text", ""], ["org", "Empresa", "text", ""], ["title", "Cargo", "text", ""], ["phone", "Teléfono", "tel", ""], ["email", "Correo", "email", ""], ["web", "Web", "url", ""], ["address", "Dirección", "text", ""]],
    email: [["to", "Correo", "email", "hola@tuempresa.com"], ["subject", "Asunto (opcional)", "text", ""], ["body", "Mensaje (opcional)", "textarea", ""]],
    phone: [["phone", "Teléfono", "tel", "+51 987 654 321"]],
    sms: [["phone", "Teléfono", "tel", "+51 987 654 321"], ["message", "Mensaje (opcional)", "text", ""]],
    text: [["text", "Texto", "textarea", ""]],
  };
  var ITEM_KINDS = [["design", "Diseño (ver y descargar)"], ["presentation", "Presentación (ver, presentar y descargar)"], ["website", "Website"], ["event", "Evento"], ["form", "Formulario"], ["brief", "Brief"], ["quote", "Cotización"]];
  function openNew(type) {
    var R = RR(); if (!R || !R.on) return toast("Cargando tus datos…");
    loadBrands().then(function () { drawNew(type || "url", writeWs()); });
  }
  function fieldHtml(f, v) {
    var id = "qf_" + f[0], val = v == null ? "" : v;
    if (f[2] === "select") return '<div><label class="fx-lbl" for="' + id + '">' + esc(f[1]) + '</label><select class="fx-in" id="' + id + '">' + f[3].map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(val) === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select></div>";
    if (f[2] === "textarea") return '<div style="grid-column:1/-1"><label class="fx-lbl" for="' + id + '">' + esc(f[1]) + '</label><textarea class="fx-in" id="' + id + '" rows="3">' + esc(val) + "</textarea></div>";
    return '<div><label class="fx-lbl" for="' + id + '">' + esc(f[1]) + '</label><input class="fx-in" id="' + id + '" type="' + (f[2] === "url" ? "text" : f[2]) + '"' + (f[2] === "url" ? ' inputmode="url"' : "") + ' placeholder="' + esc(f[3] || "") + '" value="' + esc(val) + '"></div>';
  }
  function drawNew(type, ws, keep) {
    var R = RR(), N = keep || { type: type, ws: ws, brand: "", vals: {}, item: { kind: "design", id: "" } };
    N.type = type;
    var wsList = (R.realWs || [R.ws]).filter(function (id) { return typeof WSS === "undefined" || WSS[id]; });
    var tabs = '<div class="qr-tabs">' + TYPE_ORDER.map(function (t) { return '<button type="button" data-qt="' + t + '"' + (t === type ? ' class="on"' : "") + ">" + esc(MQ().TYPES[t].label) + "</button>"; }).join("")
      + '<button type="button" data-qt="item"' + (type === "item" ? ' class="on"' : "") + ">Algo de Musa</button></div>";
    var fields = type === "item"
      ? '<div class="fx-row"><div><label class="fx-lbl" for="qf_kind">Qué es</label><select class="fx-in" id="qf_kind">' + ITEM_KINDS.map(function (k) { return '<option value="' + k[0] + '"' + (N.item.kind === k[0] ? " selected" : "") + ">" + k[1] + "</option>"; }).join("") + '</select></div><div><label class="fx-lbl" for="qf_item">Cuál</label><select class="fx-in" id="qf_item"><option value="">Cargando…</option></select></div></div>'
      : '<div class="fx-row">' + FIELDS[type].map(function (f) { return fieldHtml(f, N.vals[f[0]]); }).join("") + "</div>";
    var body = '<div class="qr-mx"><div><div class="qr-pv" id="qrPv"></div><div class="qr-read" id="qrRead"></div></div><div class="qr-f">' + tabs
      + '<p class="qr-hint">' + esc(TYPE_HINT[type]) + "</p>" + fields
      + (type === "item" ? "" : '<div><label class="fx-lbl" for="qf__name">Nombre (para encontrarlo después)</label><input class="fx-in" id="qf__name" maxlength="160" placeholder="Ej.: Flyer feria de noviembre" value="' + esc(N.vals.__name || "") + '"></div>')
      + '<div class="fx-row">' + (wsList.length > 1 ? '<div><label class="fx-lbl" for="qf__ws">Espacio</label><select class="fx-in" id="qf__ws"' + (type === "item" ? " disabled" : "") + ">" + wsList.map(function (id) { return '<option value="' + esc(id) + '"' + (id === N.ws ? " selected" : "") + ">" + esc(wsName(id)) + "</option>"; }).join("") + "</select></div>" : "")
      + (type === "item" ? "" : '<div><label class="fx-lbl" for="qf__brand">Marca (colores y logo)</label><select class="fx-in" id="qf__brand">' + brandOpts(N.ws, N.brand) + "</select></div>") + "</div>"
      + '<p class="mbc-err" style="color:#d33;font-size:12px;font-weight:700;margin:0;min-height:1em"></p>'
      + '<div class="ag-ctl"><button class="pri" data-qn="go">' + (type === "item" ? "Crear o abrir su QR" : "Crear QR") + '</button><button data-mx="close">Cancelar</button></div></div></div>';
    var handler = function (e) {
      var b = e.target.closest("[data-qt],[data-qn]"); if (!b) return;
      if (b.hasAttribute("data-qt")) { grab(N); return drawNew(b.getAttribute("data-qt"), N.ws, N); }
      if (b.getAttribute("data-qn") === "go") return create(N, b);
    };
    handler.input = function () { grab(N); preview(N); };
    mx("Nuevo código QR", "", body, handler);
    var box = mxEl.querySelector(".mx-box"); if (box) box.classList.add("qr-wide");
    mxEl.onchange = function (e) {
      var id = e.target && e.target.id;
      grab(N);
      if (id === "qf__ws") { N.ws = e.target.value; N.brand = ""; var bs = document.getElementById("qf__brand"); if (bs) bs.innerHTML = brandOpts(N.ws, ""); }
      if (id === "qf_kind") { N.item.kind = e.target.value; N.item.id = ""; itemOptions(N); }
      if (id === "qf_item") N.item.id = e.target.value;
      preview(N);
    };
    if (type === "item") itemOptions(N);
    preview(N);
    setTimeout(function () { var f = mxEl.querySelector(".qr-f input, .qr-f select"); if (f && window.innerWidth > 760) try { f.focus(); } catch (x) {} }, 30);
  }
  function grab(N) {
    if (N.type !== "item") (FIELDS[N.type] || []).forEach(function (f) { var el = document.getElementById("qf_" + f[0]); if (el) N.vals[f[0]] = el.value; });
    var nm = document.getElementById("qf__name"); if (nm) N.vals.__name = nm.value;
    var w = document.getElementById("qf__ws"); if (w && !w.disabled) N.ws = w.value;
    var br = document.getElementById("qf__brand"); if (br) N.brand = br.value;
    var it = document.getElementById("qf_item"); if (it) N.item.id = it.value;
  }
  function payloadOf(N) {
    var v = Object.assign({}, N.vals);
    if (N.type === "wifi") v.hidden = v.hidden === "1";
    return MQ().payload(N.type, v);
  }
  function previewStyle(N) {
    var b = brandById(N.brand);
    if (!b) return { dots: "square", eyes: "square", margin: 3 };
    var c = MQ().brandColors(brandCols(b), "#ffffff");
    return { fg: c.fg, eye: c.eye, bg: "#ffffff", dots: "square", eyes: "square", margin: 3 };
  }
  var pvT = null;
  function preview(N) {
    var pv = document.getElementById("qrPv"), rd = document.getElementById("qrRead"); if (!pv) return;
    if (N.type === "item") { pv.innerHTML = '<p class="qr-hint" style="text-align:center;padding:10px">Elige qué cosa de Musa: su QR lleva a su página pública.</p>'; if (rd) rd.textContent = ""; return; }
    var p = payloadOf(N);
    /* el QR dinámico lleva el enlace corto: la vista previa usa uno de muestra del mismo largo */
    var text = p.ok ? (MQ().TYPES[N.type].dynamic ? APP() + "/r/xxxxxxxx" : p.content) : null;
    if (!text) { pv.innerHTML = '<p class="qr-hint" style="text-align:center;padding:10px">' + esc(p.error) + "</p>"; if (rd) rd.textContent = ""; return; }
    try { pv.innerHTML = MQ().svg(text, Object.assign(previewStyle(N), { size: 520 })); }
    catch (x) { pv.innerHTML = '<p class="qr-hint" style="text-align:center;padding:10px">' + esc(x.message) + "</p>"; return; }
    if (rd) { rd.className = "qr-read"; rd.textContent = MQ().TYPES[N.type].dynamic ? "Dinámico: lleva un enlace corto de Musa" : "Fijo: el contenido va dentro del código"; }
    clearTimeout(pvT);
  }
  function create(N, btn) {
    grab(N);
    var err = mxEl.querySelector(".mbc-err");
    if (N.type === "item") {
      if (!N.item.id) { err.textContent = "Elige cuál"; return; }
      btn.disabled = true; btn.textContent = "Preparando…";
      return qrForItem(N.item.kind, N.item.id).then(null, function () {}).then(function () { btn.disabled = false; btn.textContent = "Crear o abrir su QR"; });
    }
    var p = payloadOf(N);
    if (!p.ok) { err.textContent = p.error; return; }
    var dyn = MQ().TYPES[N.type].dynamic;
    var fields = Object.assign({}, N.vals); delete fields.__name;
    if (N.type === "wifi") { delete fields.password; fields.hidden = fields.hidden === "1"; }   /* la clave ya va en el código: no se guarda aparte */
    var name = (N.vals.__name || "").trim() || autoName(N);
    var st = previewStyle(N);
    var row = { workspace_id: N.ws, kind: dyn ? "dynamic" : "static", name: name, content_type: N.type, destination_url: dyn ? p.url : null, content: dyn ? null : p.content, fields: fields, brand_id: N.brand || null, style: st };
    btn.disabled = true; btn.textContent = "Creando…"; err.textContent = "";
    api("/rest/v1/qr_codes", J("POST", row)).then(function (r) {
      var nr = (r || [])[0]; if (!nr) throw new Error("No se creó");
      if (Q.rows) Q.rows.unshift(nr);
      toast("Código QR creado"); track("crear", { tipo: N.type });
      if (onLib()) drawLib();
      drawDetail(JSON.parse(JSON.stringify(nr)));
    }, function (x) { btn.disabled = false; btn.textContent = "Crear QR"; err.textContent = "No se pudo crear: " + errMsg(x); });
  }
  function autoName(N) {
    var v = N.vals;
    switch (N.type) {
      case "url": try { return new URL(MQ().normalizeUrl(v.url)).hostname.replace(/^www\./, ""); } catch (e) { return "Enlace"; }
      case "whatsapp": return "WhatsApp " + (v.phone || "");
      case "wifi": return "Wi‑Fi " + (v.ssid || "");
      case "vcard": return ((v.firstName || "") + " " + (v.lastName || "")).trim() || v.org || "Contacto";
      case "email": return "Correo " + (v.to || "");
      case "phone": return "Llamar " + (v.phone || "");
      case "sms": return "SMS " + (v.phone || "");
    }
    return "Texto";
  }
  function itemOptions(N) {
    var sel = document.getElementById("qf_item"); if (!sel) return;
    var k = N.item.kind, W = wsFilter();
    var q = { design: "templates?" + W + "&deleted_at=is.null&is_brand_manual=is.false&select=id,name,workspace_id&order=updated_at.desc&limit=300",
      presentation: "templates?" + W + "&deleted_at=is.null&is_brand_manual=is.false&select=id,name,workspace_id&order=updated_at.desc&limit=300",
      website: "websites?" + W + "&deleted_at=is.null&select=id,name,status,workspace_id&order=updated_at.desc&limit=200",
      event: "workspace_events?" + W + "&select=id,name,published,workspace_id&order=date.desc&limit=200",
      form: "workspace_forms?" + W + "&select=id,name,published,workspace_id&order=created_at.desc&limit=200",
      brief: "briefs?" + W + "&select=id,title,workspace_id&order=updated_at.desc&limit=200",
      quote: "crm_quotes?" + W + "&select=id,number,title,workspace_id&order=created_at.desc&limit=200" }[k];
    sel.innerHTML = '<option value="">Cargando…</option>';
    api("/rest/v1/" + q).then(function (rows) {
      if (N.item.kind !== k) return;
      rows = rows || [];
      var lbl = function (r) {
        var n = r.name || r.title || r.number || r.id;
        if (k === "quote") n = [r.number, r.title].filter(Boolean).join(" · ");
        if (k === "website" && r.status !== "published") n += " (sin publicar)";
        if (k === "event" && !r.published) n += " (sin publicar)";
        if (k === "form" && r.published === false) n += " (pausado)";
        return n + (RR().all ? " — " + wsName(r.workspace_id) : "");
      };
      sel.innerHTML = rows.length ? '<option value="">Elige…</option>' + rows.map(function (r) { return '<option value="' + esc(r.id) + '">' + esc(lbl(r)) + "</option>"; }).join("") : '<option value="">No hay en este espacio</option>';
    }, function () { sel.innerHTML = '<option value="">No pude cargar la lista</option>'; });
  }

  /* ═════════ el QR de una cosa de Musa (botón en cada pantalla) ═════════ */
  /* Las mismas reglas que qr_for_item (qr-mcp.mjs): a dónde lleva y qué tiene que estar listo antes. */
  function resolveItem(kind, id) {
    var R = RR(), o = APP();
    var one = function (t, cols) { return api("/rest/v1/" + t + "?id=eq." + enc(id) + "&select=" + cols).then(function (r) { var x = (r || [])[0]; if (!x) throw new Error("No encontré eso en tus espacios"); return x; }); };
    switch (kind) {
      case "design": case "presentation":
        return one("templates", "id,name,workspace_id,is_public,deleted_at,meta:design_file_meta(brand_id)").then(function (t) {
          if (t.deleted_at) throw new Error("Ese diseño está en la papelera");
          var bid = t.meta && (Array.isArray(t.meta) ? (t.meta[0] || {}).brand_id : t.meta.brand_id);
          var res = { ws: t.workspace_id, name: t.name, url: o + "/v/" + t.id + (kind === "presentation" ? "?present=1" : ""), brandId: bid || null };
          if (t.is_public) return res;
          return R.confirmBox("El QR lleva a una página donde cualquiera con el código ve el diseño y lo descarga en PNG o PDF, sin cuenta. Para eso el diseño queda compartido con enlace (lo vuelves privado cuando quieras y el QR deja de mostrarlo).", { title: "¿Compartir «" + t.name + "» con el QR?", ok: "Compartir y crear el QR" }).then(function (ok) {
            if (!ok) return null;
            return api("/rest/v1/templates?id=eq." + enc(t.id), J("PATCH", { is_public: true, visibility: "shared" })).then(function () {
              try { if (typeof ED !== "undefined" && ED.doc && ED.doc._id === t.id) { ED.doc._public = true; ED.share = "publico"; } } catch (e) {}
              return res;
            });
          });
        });
      case "website":
        return one("websites", "id,name,slug,status,workspace_id,brand_id,deleted_at").then(function (s) {
          if (s.deleted_at || s.status !== "published" || !s.slug) throw new Error("Publica el website primero: el QR lleva a su dirección pública");
          return { ws: s.workspace_id, name: s.name, url: o + "/w/" + s.slug + "/", brandId: s.brand_id };
        });
      case "event":
        return one("workspace_events", "id,name,slug,published,workspace_id,brand_id").then(function (e) {
          if (!e.published || !e.slug) throw new Error("Publica el evento primero (pestaña Página): el QR lleva a su página de inscripción");
          return { ws: e.workspace_id, name: e.name, url: o + "/e/" + e.slug, brandId: e.brand_id };
        });
      case "form":
        return one("workspace_forms", "id,name,public_token,published,workspace_id").then(function (f) {
          if (!f.public_token) throw new Error("El formulario todavía no tiene enlace público");
          if (f.published === false) toast("Ojo: el formulario está pausado. Actívalo para que quien escanee pueda responder");
          return { ws: f.workspace_id, name: f.name, url: o + "/f/" + f.public_token, brandId: null };
        });
      case "brief":
        return one("briefs", "id,title,public_token,workspace_id,brand_id").then(function (b) {
          if (!b.public_token) throw new Error("El brief todavía no tiene enlace para el cliente");
          return { ws: b.workspace_id, name: b.title, url: o + "/b/" + b.public_token, brandId: b.brand_id };
        });
      case "quote":
        return one("crm_quotes", "id,number,title,public_token,workspace_id,brand_id").then(function (q) {
          if (!q.public_token) throw new Error("La cotización todavía no tiene enlace para el cliente");
          return { ws: q.workspace_id, name: [q.number, q.title].filter(Boolean).join(" · "), url: o + "/q/" + q.public_token, brandId: q.brand_id };
        });
    }
    return Promise.reject(new Error("No se puede hacer un QR de eso"));
  }
  function qrForItem(kind, id) {
    return Promise.all([resolveItem(kind, id), loadBrands()]).then(function (a) {
      var it = a[0]; if (!it) return null;
      return api("/rest/v1/qr_codes?workspace_id=eq." + enc(it.ws) + "&target_type=eq." + enc(kind) + "&target_id=eq." + enc(id) + "&select=*").then(function (rows) {
        var prev = (rows || [])[0];
        if (prev) {
          if (prev.destination_url === it.url) return prev;
          return api("/rest/v1/qr_codes?id=eq." + enc(prev.id), J("PATCH", { destination_url: it.url })).then(function (r) { return (r || [])[0] || prev; });
        }
        var b = brandById(it.brandId), st = { dots: "square", eyes: "square", margin: 3 };
        if (b) { var c = MQ().brandColors(brandCols(b), "#ffffff"); st.fg = c.fg; st.eye = c.eye; st.bg = "#ffffff"; }
        return api("/rest/v1/qr_codes", J("POST", { workspace_id: it.ws, kind: "dynamic", name: (TARGET_ES[kind] + " · " + (it.name || "")).slice(0, 160), content_type: "url", destination_url: it.url, fields: { url: it.url }, target_type: kind, target_id: id, brand_id: it.brandId || null, style: st }))
          .then(function (r) { var nr = (r || [])[0]; if (!nr) throw new Error("No se creó"); track("crear", { tipo: kind }); toast("Código QR creado: también queda en Crear › Códigos QR"); return nr; });
      }).then(function (row) {
        if (Q.rows) { var i = Q.rows.findIndex(function (x) { return x.id === row.id; }); if (i >= 0) Q.rows[i] = row; else Q.rows.unshift(row); }
        drawDetail(JSON.parse(JSON.stringify(row)));
        return row;
      });
    }).catch(function (x) { if (RR().notice) RR().notice("No se puede crear el QR todavía", errMsg(x)); else toast(errMsg(x)); throw x; });
  }
  function track(action, info) { try { if (window.__musaTrack) window.__musaTrack("qr", action, info); } catch (e) {} }

  /* ═════════ insertar en un diseño ═════════ */
  function editorOpen() { return typeof ED !== "undefined" && ED.open && ED.doc && ED.doc._real; }
  function insertNow(svg, name) {
    var f = ED.doc.frames[ED.sel ? ED.sel.f : 0]; if (!f) return toast("Abre un frame primero");
    var size = Math.max(60, Math.round(Math.min(f.w, f.h) * 0.24)), pad = Math.round(Math.min(f.w, f.h) * 0.05);
    if (typeof snap === "function") snap();
    f.els.push(Object.assign({}, typeof DEF !== "undefined" ? DEF : {}, { type: "image", name: name || "Código QR", x: f.w - size - pad, y: f.h - size - pad, w: size, h: size, fill: "url('" + MQ().dataUrl(svg) + "') center/contain no-repeat" }));
    if (typeof edRender === "function") edRender();
    if (typeof edLayers === "function") edLayers();
    try { var RB = RR(); if (RB && RB._ed && RB._ed.save) RB._ed.save(); } catch (e) {}
    toast("Código QR agregado al frame: muévelo y cámbiale el tamaño como cualquier imagen");
    track("insertar", {});
  }
  function insertRow(row, st) { return svgFor(row, 1024, st).then(function (svg) { insertNow(svg, "QR · " + row.name); }); }
  /* desde el diálogo de un QR: en el diseño abierto o en el que elijas */
  function insertFlow(row, st) {
    if (editorOpen()) { mxEl.hidden = true; return insertRow(row, st); }
    var R = RR();
    api("/rest/v1/templates?" + wsFilter() + "&deleted_at=is.null&is_brand_manual=is.false&select=id,name&order=updated_at.desc&limit=60").then(function (rows) {
      if (!rows || !rows.length) return toast("No tienes diseños todavía");
      return R.choose("", rows.map(function (t) { return { value: t.id, label: t.name }; }), { title: "¿En qué diseño lo pongo?", action: "qr-insert" }).then(function (id) {
        if (!id) return;
        mxEl.hidden = true;
        R.openDesign(id);
        var n = 0, iv = setInterval(function () {
          if (editorOpen() && ED.doc._id === id) { clearInterval(iv); setTimeout(function () { insertRow(row, st); }, 400); }
          else if (++n > 60) { clearInterval(iv); toast("El diseño tardó en abrir: inserta el QR desde el editor (Importar › Código QR)"); }
        }, 250);
      });
    }, function (x) { toast("No pude cargar tus diseños: " + errMsg(x)); });
  }
  /* desde el editor: Importar › Código QR… */
  function insertFromEditor() {
    var R = RR(), doc = ED.doc, multi = doc.frames.length > 1;
    var opts = [{ value: "this", label: multi ? "QR de esta presentación (verla, presentarla y descargarla)" : "QR de este diseño (verlo y descargarlo)" }, { value: "saved", label: "Uno de mis códigos QR" }, { value: "new", label: "Un QR nuevo (enlace, WhatsApp, Wi‑Fi…)" }];
    R.choose("", opts, { title: "¿Qué código QR pongo en el frame?", action: "qr-insert-kind" }).then(function (k) {
      if (k === "this") return qrForItem(multi ? "presentation" : "design", doc._id).then(function (row) { if (row) { mxEl.hidden = true; return insertRow(row); } });
      if (k === "new") return openNew("url");
      if (k === "saved") return load(true).then(function (rows) {
        if (!rows.length) return openNew("url");
        return R.choose("", rows.slice(0, 80).map(function (r) { return { value: r.id, label: r.name }; }), { title: "¿Cuál?", action: "qr-insert-pick" }).then(function (id) { var row = rows.find(function (x) { return x.id === id; }); if (row) return insertRow(row); });
      });
    });
  }

  /* ═════════ botones «Código QR» en cada pantalla ═════════ */
  var CUR = { form: null };
  /* el evento abierto sale de la dirección (#crear/eventos/<id>/pagina), igual que lo busca la maqueta */
  function curEvent() { var m = /^#?crear\/eventos\/([^/?]+)/.exec(location.hash); if (!m || typeof EV === "undefined") return null; var id = decodeURIComponent(m[1]); return EV.find(function (x) { return String(x.id) === id; }) || null; }
  function addBtn(anchor, kind, cls) {
    if (!anchor || !anchor.parentNode || anchor.parentNode.querySelector('[data-qrx="' + kind + '"]')) return;
    var b = document.createElement(anchor.tagName === "A" ? "button" : anchor.tagName);
    b.type = "button"; b.className = cls != null ? cls : anchor.className; b.setAttribute("data-qrx", kind);
    b.innerHTML = '<span class="qr-x"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 20h.01M17 20h.01M20 14v3"/></svg>Código QR</span>';
    b.classList.remove("pri");
    anchor.parentNode.insertBefore(b, anchor.nextSibling);
  }
  function inject() {
    var R = RR(); if (!R || !R.on) return;
    var body = document.getElementById("body"); if (!body) return;
    /* evento: junto a «Copiar enlace» (publicado) o a «Publicar evento» */
    var ev = body.querySelector('[data-evp="copy"]') || body.querySelector('[data-evp="on"]');
    if (ev && curEvent()) addBtn(ev, "event");
    /* formulario: junto a «Copiar URL» */
    body.querySelectorAll('[data-fa2="link"]').forEach(function (a) { addBtn(a, "form"); });
    /* brief y cotización: junto a «Enviar enlace» */
    var bl = body.querySelector('[data-ba="link"]'); if (bl) addBtn(bl, "brief");
    var qs = body.querySelector('[data-qa="pdf"]') || body.querySelector('[data-qa="send"]'); if (qs) addBtn(qs, "quote");
    /* websites: en cada tarjeta publicada */
    body.querySelectorAll('.wb-card [data-wba="open"]').forEach(function (a) { var b = a; addBtn(b, "website"); var n = b.parentNode.querySelector('[data-qrx="website"]'); if (n) n.setAttribute("data-id", b.getAttribute("data-id")); });
  }
  var injT = null;
  /* a lo más cada 60 ms (no «cuando se calme»: hay vistas que cambian el DOM seguido y la espera nunca terminaba) */
  function scheduleInject() { if (injT) return; injT = setTimeout(function () { injT = null; inject(); }, 60); }
  document.addEventListener("click", function (e) {
    var R = RR(); if (!R || !R.on || !e.target.closest) return;
    var x = e.target.closest("[data-qrx]");
    if (x) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      var k = x.getAttribute("data-qrx");
      if (k === "event") { var ev = curEvent(); if (!ev || !ev.db) return toast("Abre el evento primero"); return qrForItem("event", ev.db).catch(function () {}); }
      if (k === "form") { var f = typeof FORMS !== "undefined" && CUR.form != null ? FORMS[CUR.form] : null; if (!f || !f.db) return toast("Abre el formulario primero"); return qrForItem("form", f.db).catch(function () {}); }
      if (k === "brief") { var br = typeof BRIEFS !== "undefined" && typeof CL !== "undefined" ? BRIEFS.find(function (b) { return b.id === CL.brief; }) : null; if (!br || !br.db) return toast("Elige un brief"); return qrForItem("brief", br.db).catch(function () {}); }
      if (k === "quote") { var q = typeof QUOTES !== "undefined" && typeof CL !== "undefined" ? QUOTES.find(function (z) { return z.id === CL.quote; }) : null; if (!q || !q.db) return toast("Elige una cotización"); return qrForItem("quote", q.db).catch(function () {}); }
      if (k === "website") return qrForItem("website", x.getAttribute("data-id")).catch(function () {});
      return;
    }
    /* biblioteca */
    if (!onLib() && !e.target.closest(".fx-menu")) {
      if (!e.target.closest(".head .actions .btn-p") || !onLib()) return;
    }
    var nb = e.target.closest('.fx-menu [data-cm="qr"]');
    if (nb) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); document.querySelectorAll(".fx-menu").forEach(function (m) { m.remove(); }); return openNew("url"); }
    if (!onLib()) return;
    if (e.target.closest(".head .actions .btn-p")) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); return openNew("url"); }
    var n = e.target.closest("[data-qrn]"); if (n) { e.preventDefault(); return openNew(n.getAttribute("data-qrn")); }
    var fl = e.target.closest("[data-qrf]"); if (fl) { Q.filter = fl.getAttribute("data-qrf"); return drawLib(); }
    var a = e.target.closest("[data-qra]");
    if (a) {
      e.stopPropagation();
      var row = (Q.rows || []).find(function (r) { return r.id === a.getAttribute("data-id"); }); if (!row) return;
      var k2 = a.getAttribute("data-qra");
      if (k2 === "open") return openQR(row.id);
      if (k2 === "png") return loadBrands().then(function () { dlPng(row, null, 1024); });
      if (k2 === "copy") return copy(shortUrl(row.code));
    }
    var c = e.target.closest("[data-qro]"); if (c && !e.target.closest("button,a,input")) return openQR(c.getAttribute("data-qro"));
  }, true);
  document.addEventListener("input", function (e) {
    if (e.target && e.target.id === "qrSearch") { Q.q = e.target.value; var pos = e.target.selectionStart; drawLib(); var s = document.getElementById("qrSearch"); if (s) { s.focus(); try { s.setSelectionRange(pos, pos); } catch (x) {} } }
  });

  /* ═════════ instalación ═════════ */
  function install() {
    var ok = typeof VIEWS2 !== "undefined" && typeof MODULES !== "undefined" && typeof modById === "function" && typeof drawView === "function" && window.MusaQR && window.QRCodeLib && typeof mx === "function";
    if (!ok) return setTimeout(install, 150);
    VIEWS2.qrLib = function () { drawLib(); };
    if (typeof SUB_DESC !== "undefined") SUB_DESC["crear/qr"] = SUB_DESC["crear/qr"] || "Códigos QR con tu marca: los dinámicos cambian de destino sin reimprimir, se pausan y cuentan escaneos.";
    var cr = modById("crear");
    if (cr && !cr.subs.some(function (x) { return x[0] === "qr"; })) {
      var fi = cr.subs.findIndex(function (x) { return x[0] === "websites"; });
      if (fi < 0) fi = cr.subs.findIndex(function (x) { return x[0] === "formularios"; });
      cr.subs.splice(fi >= 0 ? fi + 1 : cr.subs.length, 0, ["qr", "Códigos QR", "qrLib"]);
    }
    /* cabecera: en Códigos QR el botón principal crea un QR */
    var _dv = drawView;
    drawView = function () {
      var r = _dv.apply(this, arguments);
      try {
        if (onLib()) {
          var pb = document.querySelector(".head .actions .btn-p"); if (pb) pb.textContent = "Nuevo QR";
          var g = document.querySelector(".head .actions .btn-g"); if (g) g.style.display = "none";
        }
      } catch (e) {}
      scheduleInject();
      return r;
    };
    /* menú «Crear»: un ítem más */
    if (typeof fxCreateMenu === "function") {
      var _cm = fxCreateMenu;
      fxCreateMenu = function () {
        var r = _cm.apply(this, arguments);
        var m = document.querySelector(".fx-menu");
        if (m && !m.querySelector('[data-cm="qr"]') && RR() && RR().on) { var b = document.createElement("button"); b.setAttribute("data-cm", "qr"); b.innerHTML = "Código QR<small>Enlace, WhatsApp, Wi‑Fi o el de algo de Musa</small>"; m.appendChild(b); }
        return r;
      };
    }
    /* el evento y el formulario abiertos (para su botón) */
    if (typeof formDetail === "function") { var _fd = formDetail; formDetail = function (i) { CUR.form = i; var r = _fd.apply(this, arguments); scheduleInject(); return r; }; }
    /* editor: Compartir › Código QR e Importar › Código QR… */
    if (typeof MENUS !== "undefined") {
      var _share = MENUS.compartir, _imp = MENUS.import;
      MENUS.compartir = function () {
        var it = _share.apply(this, arguments);
        if (!editorOpen()) return it;
        var multi = ED.doc.frames.length > 1;
        return it.concat(["-", { h: "Código QR" }, { l: "Código QR para ver y descargar", d: "Sin cuenta: verlo y bajarlo en PNG o PDF", fn: function () { qrForItem("design", ED.doc._id).catch(function () {}); } }]
          .concat(multi ? [{ l: "Código QR para presentar", d: "Abre en modo presentación", fn: function () { qrForItem("presentation", ED.doc._id).catch(function () {}); } }] : []));
      };
      MENUS.import = function () {
        var it = _imp.apply(this, arguments);
        if (!editorOpen()) return it;
        return it.concat(["-", { h: "Insertar" }, { l: "Código QR…", d: "Lo pega en el frame como imagen vectorial", fn: insertFromEditor }]);
      };
    }
    if (typeof wsSwitch === "function") { var _ws = wsSwitch; wsSwitch = function () { var r = _ws.apply(this, arguments); Q.rows = null; Q.brands = null; return r; }; }
    /* se observa la página entera: drawView recrea #body en cada dibujo y un observador puesto en él quedaba mirando uno viejo */
    try { new MutationObserver(function () { scheduleInject(); }).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
    try { if (typeof drawNav === "function") drawNav(); } catch (e) {}
    if (/^#crear\/qr/.test(location.hash) && typeof go === "function") go();
    var R = RR(); if (R) R.qr = { open: openQR, forItem: qrForItem, newQR: openNew, reload: function () { Q.rows = null; } };
  }
  install();
})();
