/* bridge-create.js — todo botón de «Nuevo / Agregar / +» abre un popup con lo necesario para crear
 * el ítem de verdad en su módulo (tabla real del workspace), guarda, recarga y lo deja a la vista.
 * Usa el mismo popup de la maqueta (mx) y sus mismas clases (fx-row, fx-lbl, fx-in, ag-ctl, ag-tag).
 */
(function () {
  function RR() { return window.__musaReal; }
  function host() { try { return window.parent !== window ? window.parent : null; } catch (e) { return null; } }
  function bridge() { var h = host(); try { return h && h.__musaBridge; } catch (e) { return null; } }
  function api(path, init) { var b = bridge(); if (!b) return Promise.reject(new Error("sin puente")); return b.api(path.charAt(0) === "/" ? path : "/rest/v1/" + path, init); }
  function jpost(path, body) { return api(path, { method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(body) }); }
  function ins(table, body) { return jpost("/rest/v1/" + table, body).then(function (r) { return Array.isArray(r) ? r[0] : r; }); }
  function get(path) { return api(path).catch(function () { return null; }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  /* musaI18n.t traduce al inglés cuando toca; en español es identidad. Para cadenas compuestas
     se traduce el FRAGMENTO estático, no la frase ya armada (el diccionario no la tiene). */
  function T(s) { try { return musaI18n.t(String(s)); } catch (e) { return s; } }
  function hex(n) { var s = ""; while (s.length < n) s += Math.random().toString(16).slice(2); return s.slice(0, n); }
  function ws() { return RR().ws; }
  function uid() { var b = bridge(); return b && b.userId; }
  function day(off) { var d = new Date(); d.setDate(d.getDate() + (off || 0)); return d.toISOString().slice(0, 10); }
  function brands() {
    var R = RR(), m = R.brandName || {}, n = {}, seen = {};
    /* marcas duplicadas en la base (mismo nombre en el mismo espacio, p. ej. 7 «futuraria»): una sola opción */
    var out = Object.keys(m).sort().filter(function (id) { var k = ((R.wsOf && R.wsOf["brand:" + id]) || "") + "|" + String(m[id]).toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true; })
      .map(function (id) { n[m[id]] = (n[m[id]] || 0) + 1; return [id, m[id]]; });
    /* dos marcas con el mismo nombre en espacios distintos: se distingue por el espacio (antes «futuraria» salía 7 veces igual) */
    return out.map(function (o) { var w = n[o[1]] > 1 && R.wsOf && R.wsOf["brand:" + o[0]]; return w ? [o[0], o[1] + " · " + wsName(w)] : o; }).sort(function (a, b) { return a[1].localeCompare(b[1]); });
  }
  function brandOpts(none) { var o = brands(); return (none ? [["", none]] : []).concat(o); }
  /* marca del contexto (ficha de la marca abierta o filtro de marca activo); nunca «la primera marca»:
     antes los diálogos caían en una marca real y un clic descuidado le asignaba contenido ajeno */
  function ctxBrandId() {
    var m = RR().brandName || {}, byName = function (n) { return Object.keys(m).find(function (id) { return m[id] === n; }) || ""; };
    try { var hr = typeof hubRoute === "function" ? hubRoute() : null; if (hr) return byName(hr[0]); } catch (e) {}
    try { var f = typeof FX !== "undefined" && FX && FX.brand; if (f) return m[f] ? f : byName(f); } catch (e) {}
    return "";
  }
  function brandName(id) { return (id && (RR().brandName || {})[id]) || null; }
  function people() { var p = RR().people || {}; return Object.keys(p).map(function (k) { return [k, p[k]]; }); }
  function list(s) { return String(s || "").split(/[,\n]/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function q(t, sel, extra) { return t + "?workspace_id=eq." + encodeURIComponent(ws()) + "&select=" + sel + (extra || ""); }
  function fileData(f) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result)); }; r.onerror = rej; r.readAsDataURL(f); }); }
  function idOf(r) { return r && (r.templateId || r.flowId || r.id || (r.template && r.template.id) || (r.flow && r.flow.id) || (r.data && (r.data.id || (r.data.template && r.data.template.id)))); }
  function errMsg(e) {
    var m = String(e && (e.message || e.error) || e || "error");
    if (/brands_workspace|row-level security|permission denied/i.test(m)) return "No tienes permiso para crear aquí (necesitas rol Editor o más).";
    if (/key|BYOK|llave/i.test(m) && !/duplicate/i.test(m)) return m + " · configura tu llave en Configuración › Integraciones";
    return m;
  }

  var NETS = [["instagram", "Instagram"], ["facebook", "Facebook"], ["tiktok", "TikTok"], ["linkedin", "LinkedIn"], ["youtube", "YouTube"], ["x", "X"]];
  var FMT = [["post", "Post"], ["carrusel", "Carrusel"], ["story", "Story"], ["reel", "Reel"]];
  var SIZES = [["1080x1080", "Post · 1080×1080"], ["1080x1350", "Vertical · 1080×1350"], ["1080x1920", "Story / Reel · 1080×1920"], ["1920x1080", "Horizontal · 1920×1080"], ["1200x628", "Banner · 1200×628"], ["custom", "Otro tamaño…"]];
  var VFMTS = [["9:16", "9:16 · vertical"], ["16:9", "16:9 · horizontal"], ["1:1", "1:1 · cuadrado"], ["4:5", "4:5 · feed"]];

  /* CSS de los campos compuestos (color y tipografía). La maqueta no tiene clase
     para esto: `.fx-in` sobre un input type=color aplasta el swatch contra el
     padding y por eso no se veía el color elegido. */
  var css = document.createElement("style");
  css.textContent = [
    ".mbc-col{display:flex;gap:8px;align-items:center}",
    ".mbc-pick{flex:0 0 auto;width:36px;height:36px;padding:0;border:1.5px solid #d6d4c6;border-radius:10px;background:#fff;cursor:pointer;-webkit-appearance:none;appearance:none}",
    ".mbc-pick::-webkit-color-swatch-wrapper{padding:4px}",
    ".mbc-pick::-webkit-color-swatch{border:0;border-radius:6px}",
    ".mbc-pick::-moz-color-swatch{border:0;border-radius:6px}",
    ".mbc-hex{flex:1 1 auto;font-family:ui-monospace,Consolas,monospace;letter-spacing:.04em}",
    ".mbc-hex.mbc-bad{border-color:#d33;background:#fff5f3}",
    ".mbc-font{position:relative}",
    ".mbc-frow{display:flex;gap:8px}",
    ".mbc-frow .fx-in{flex:1 1 auto}",
    ".mbc-fbtn{flex:0 0 auto;border:1.5px solid #d6d4c6;background:#fff;border-radius:10px;height:36px;padding:0 12px;font:700 11.5px var(--sans);color:#333;cursor:pointer;white-space:nowrap}",
    ".mbc-fbtn:hover{border-color:var(--accent);color:var(--accent)}",
    ".mbc-fbtn:disabled{opacity:.55;cursor:default}",
    ".mbc-flist{position:absolute;z-index:6;left:0;right:0;top:calc(100% + 4px);max-height:250px;overflow-y:auto;overscroll-behavior:contain;background:#fff;border:1.5px solid #c9c7b8;border-radius:12px;padding:4px;box-shadow:0 14px 30px rgba(0,0,0,.2)}",
    ".mbc-fgrp{font:700 9.5px var(--sans);letter-spacing:.08em;text-transform:uppercase;color:#8a8878;margin:8px 8px 3px}",
    ".mbc-fopt{display:flex;align-items:baseline;gap:8px;width:100%;text-align:left;background:none;border:0;border-radius:8px;padding:6px 8px;cursor:pointer;color:#111}",
    ".mbc-fopt i{font-style:normal;font-size:15px;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".mbc-fopt small{flex:0 0 auto;color:#8a8878;font-size:10.5px;text-transform:capitalize}",
    ".mbc-fopt:hover,.mbc-fopt.on{background:#f2efe4}",
    ".mbc-fempty{font-size:11.5px;color:#8a8878;padding:8px;margin:0}",
    ".mbc-fnote{font-size:11px;color:#777;margin:6px 0 0;min-height:1em}",
    ".mbc-fnote a{color:var(--accent);font-weight:700}",
    /* QA R4-5: el campo que falta se marca en rojo un momento */
    ".mbc-f.mbc-miss .fx-lbl{color:#d33}.mbc-f.mbc-miss .fx-in,.mbc-f.mbc-miss .ag-tags{outline:2px solid #d33;outline-offset:3px;border-radius:10px}",
  ].join("\n");
  document.head.appendChild(css);

  /* ───────── popup genérico ───────── */
  function fieldHTML(f) {
    var id = "mbf_" + f.k, v = f.v == null ? "" : f.v, ph = f.ph ? ' placeholder="' + esc(f.ph) + '"' : "", lbl = '<label class="fx-lbl" for="' + id + '">' + esc(f.l) + (f.req ? " *" : "") + "</label>";
    var inner;
    if (f.t === "textarea") inner = '<textarea class="fx-in" id="' + id + '" rows="' + (f.rows || 3) + '"' + ph + ">" + esc(v) + "</textarea>";
    else if (f.t === "select") inner = '<select class="fx-in" id="' + id + '">' + (f.opts || []).map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(v) ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select>";
    else if (f.t === "checks") inner = '<div class="ag-tags" id="' + id + '">' + (f.opts || []).map(function (o) { var on = (v || []).indexOf(o[0]) >= 0; return '<button type="button" class="ag-tag' + (on ? " k" : "") + '" data-v="' + esc(o[0]) + '" aria-pressed="' + on + '">' + esc(o[1]) + "</button>"; }).join("") + "</div>";
    else if (f.t === "file") inner = '<input class="fx-in" type="file" id="' + id + '"' + (f.accept ? ' accept="' + f.accept + '"' : "") + ">";
    else if (f.t === "color") inner = '<div class="mbc-col"><input type="color" class="mbc-pick" value="' + esc(hex6(v) || "#000000") + '" aria-label="' + esc(T("Selector de") + " " + f.l) + '"><input class="fx-in mbc-hex" id="' + id + '" type="text" spellcheck="false" autocomplete="off" maxlength="7" placeholder="#rrggbb" value="' + esc(v) + '"></div>';
    else if (f.t === "font") inner = '<div class="mbc-font"><div class="mbc-frow"><input class="fx-in" id="' + id + '" type="text" autocomplete="off" spellcheck="false" placeholder="' + esc(f.ph ? T(f.ph) : T("Busca en Google Fonts…")) + '" value="' + esc(v) + '"><button type="button" class="mbc-fbtn">' + esc(T("Subir fuente…")) + '</button><input type="file" class="mbc-ffile" accept=".ttf,.otf,.woff,.woff2" hidden></div><div class="mbc-flist" hidden></div><p class="mbc-fnote"></p></div>';
    else if (f.t === "info") return '<div class="mbc-f" data-k="' + f.k + '"' + (f.full ? ' style="grid-column:1/-1"' : "") + '><p class="mx-sub" style="margin:10px 0 0">' + f.html + "</p></div>";
    else inner = '<input class="fx-in" type="' + (f.t || "text") + '" id="' + id + '" value="' + esc(v) + '"' + ph + (f.t === "number" ? ' step="any"' : "") + ">";
    return '<div class="mbc-f" data-k="' + f.k + '"' + (f.when ? ' data-when="' + esc(JSON.stringify(f.when)) + '"' : "") + (f.full ? ' style="grid-column:1/-1"' : "") + ">" + lbl + inner + "</div>";
  }
  function formHTML(fields) {
    var out = "", row = [];
    var flush = function () { if (row.length) out += '<div class="fx-row">' + row.join("") + "</div>"; row = []; };
    fields.forEach(function (f) {
      if (f.full || f.t === "textarea" || f.t === "checks" || f.t === "info") { flush(); out += '<div class="fx-row" style="grid-template-columns:1fr">' + fieldHTML(Object.assign({}, f, { full: false })) + "</div>"; return; }
      row.push(fieldHTML(f)); if (row.length === 2) flush();
    });
    flush();
    return out;
  }
  function read(fields) {
    var v = {};
    fields.forEach(function (f) {
      var el = document.getElementById("mbf_" + f.k); if (!el) return;
      if (f.t === "checks") v[f.k] = [].map.call(el.querySelectorAll(".ag-tag.k"), function (b) { return b.dataset.v; });
      else if (f.t === "file") v[f.k] = el.files && el.files[0] || null;
      else if (f.t === "number") v[f.k] = el.value === "" ? null : Number(el.value);
      else v[f.k] = el.value.trim();
    });
    return v;
  }
  /* when: {k, v, and?} — «and» encadena otra condición (p. ej. la foto solo si el tipo es Clon Musa y la fuente es foto) */
  function visible(f, v) { return !f.when || ([].concat(f.when.v).indexOf(v[f.when.k]) >= 0 && (!f.when.and || visible({ when: f.when.and }, v))); }
  function syncWhen(fields) {
    var v = read(fields);
    fields.forEach(function (f) { if (!f.when) return; var box = mxEl.querySelector('.mbc-f[data-k="' + f.k + '"]'); if (box) box.parentElement.style.display = visible(f, v) ? "" : "none"; });
  }

  /* ───────── campos compuestos ─────────
   * Color: el selector nativo y el hexadecimal son dos vistas del MISMO valor, así
   * se ve lo elegido y sigue siendo editable a mano.
   * Tipografía: el mismo catálogo vivo que usa el editor de diseño —
   * GET /api/fonts/catalog (biblioteca completa de Google Fonts, buscable mientras
   * se escribe) más las fuentes subidas por la cuenta en /api/fonts/custom. Escribir
   * un nombre suelto también vale: una familia del sistema es igual de válida. */
  var FNT = { seq: 0, timer: null, custom: null, loading: null, box: null, seen: {}, i: -1 };

  function previewFams(fams) {
    var need = (fams || []).filter(function (x) { return x && !FNT.seen[x]; });
    if (!need.length) return;
    need.forEach(function (x) { FNT.seen[x] = 1; });
    var l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?" + need.slice(0, 12).map(function (x) { return "family=" + encodeURIComponent(x).replace(/%20/g, "+"); }).join("&") + "&display=swap";
    /* Sin red accesible a Google el listado sigue siendo útil: solo falla la letra del preview. */
    l.onerror = function () {};
    document.head.appendChild(l);
  }

  function showFace(cf) {
    if (!cf || !cf.publicUrl || !window.FontFace) return;
    try {
      var face = new FontFace(cf.familyName, "url(" + cf.publicUrl + ")", { display: "swap" });
      face.load().then(function () { document.fonts.add(face); }, function () {});
    } catch (e) {}
  }

  /* Firmas de las filas: una subida va con su URL de bucket para registrarla al elegir. */
  function cusOpt(c) {
    return '<button type="button" class="mbc-fopt" data-f="' + esc(c.familyName) + '" data-url="' + esc(c.publicUrl) + '"><i style="font-family:\'' + esc(c.familyName) + '\',sans-serif">' + esc(c.familyName) + "</i><small>subida · " + esc(c.format || "font") + "</small></button>";
  }
  function gooOpt(x) {
    return '<button type="button" class="mbc-fopt" data-f="' + esc(x.family) + '"><i style="font-family:\'' + esc(x.family) + '\',sans-serif">' + esc(x.family) + "</i><small>" + esc(x.category || "") + "</small></button>";
  }

  function loadCustom() {
    if (FNT.custom) return Promise.resolve(FNT.custom);
    if (FNT.loading) return FNT.loading;
    FNT.loading = api("/api/fonts/custom").then(function (r) {
      FNT.loading = null; FNT.custom = (r && r.data && r.data.fonts) || []; return FNT.custom;
    }, function () { FNT.loading = null; FNT.custom = []; return FNT.custom; });
    return FNT.loading;
  }

  function fontQuery(box, term) {
    var list = box.querySelector(".mbc-flist"), note = box.querySelector(".mbc-fnote"), seq = ++FNT.seq;
    clearTimeout(FNT.timer);
    FNT.timer = setTimeout(function () {
      if (!mxEl.contains(box)) return;
      list.innerHTML = '<p class="mbc-fempty">' + esc(T("Buscando en Google Fonts…")) + "</p>";
      list.hidden = false; FNT.box = box; FNT.i = -1;
      Promise.all([
        api("/api/fonts/catalog?limit=24&search=" + encodeURIComponent(term || "")).catch(function () { return null; }),
        loadCustom(),
      ]).then(function (r) {
        if (seq !== FNT.seq || !mxEl.contains(box)) return;
        var d = r[0] && r[0].data, cus = r[1] || [], fonts = ((d && d.fonts) || []).filter(function (x) { return x.family; });
        if (!d) {
          list.hidden = true; FNT.box = null;
          note.innerHTML = esc(T("No respondió el catálogo de Google Fonts. Escribe el nombre igualmente, se guarda igual.")) + ' <a href="#" data-retry="1">' + esc(T("Reintentar")) + "</a>";
          return;
        }
        var html = "";
        if (cus.length) html += '<p class="mbc-fgrp">' + esc(T("Tus fuentes")) + "</p>" + cus.map(cusOpt).join("");
        html += '<p class="mbc-fgrp">Google Fonts' + (term ? " · «" + esc(term) + "»" : " · " + esc(T("populares"))) + "</p>" + fonts.map(gooOpt).join("");
        if (!fonts.length) html += '<p class="mbc-fempty">' + (d.note && d.note.note
          ? esc(d.note.note) + " · " + esc(T("Prueba con")) + " " + esc((d.note.instead || []).join(", "))
          : esc(T("Ninguna coincidencia con ese nombre"))) + "</p>";
        list.innerHTML = html;
        list.hidden = false; FNT.box = box; FNT.i = -1;
        note.innerHTML = d.live
          ? esc(T((d.total || 0) + " coincidencias · catálogo vivo de Google Fonts"))
          : esc(T("Catálogo reducido — sin respuesta de Google")) + " · " + '<a href="#" data-retry="1">' + esc(T("Reintentar")) + "</a>";
        previewFams(fonts.slice(0, 12).map(function (x) { return x.family; }));
      });
    }, 220);
  }

  function wireFont(box, f) {
    var input = document.getElementById("mbf_" + f.k), list = box.querySelector(".mbc-flist");
    var btn = box.querySelector(".mbc-fbtn"), file = box.querySelector(".mbc-ffile"), note = box.querySelector(".mbc-fnote");
    if (!input || !list) return;
    if (input.value) input.style.fontFamily = "'" + input.value + "',sans-serif";
    function opts() { return list.querySelectorAll(".mbc-fopt"); }
    function close() { list.hidden = true; FNT.i = -1; if (FNT.box === box) FNT.box = null; }
    function move(d) {
      var o = opts(); if (!o.length) return;
      FNT.i = (FNT.i + d + o.length) % o.length;
      for (var i = 0; i < o.length; i++) o[i].classList.toggle("on", i === FNT.i);
      if (o[FNT.i].scrollIntoView) o[FNT.i].scrollIntoView({ block: "nearest" });
    }
    function choose(el) {
      var name = el.dataset.f;
      input.value = name;
      input.style.fontFamily = "'" + name + "',sans-serif";
      if (el.dataset.url) showFace({ familyName: name, publicUrl: el.dataset.url });
      else previewFams([name]);
      close(); note.innerHTML = "";
    }
    input.addEventListener("focus", function () { fontQuery(box, input.value.trim()); });
    /* Clic como respaldo: hay entornos donde el foco no llega (ventana sin foco del SO). */
    input.addEventListener("click", function () { if (list.hidden) fontQuery(box, input.value.trim()); });
    input.addEventListener("input", function () {
      input.style.fontFamily = "'" + input.value + "',sans-serif";
      fontQuery(box, input.value.trim());
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); if (list.hidden) fontQuery(box, input.value.trim()); else move(1); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); move(-1); return; }
      if (e.key === "Tab") { close(); return; }
      if (e.key === "Escape") { if (!list.hidden) { e.stopPropagation(); close(); } return; }
      if (e.key !== "Enter") return;
      var o = opts();
      if (!list.hidden && FNT.i >= 0 && o[FNT.i]) { e.preventDefault(); e.stopPropagation(); choose(o[FNT.i]); }
      else close();
    });
    list.addEventListener("mousedown", function (e) { e.preventDefault(); });
    list.addEventListener("click", function (e) { var b = e.target.closest(".mbc-fopt"); if (b) choose(b); });
    note.addEventListener("click", function (e) { if (e.target.closest("[data-retry]")) { e.preventDefault(); fontQuery(box, input.value.trim()); } });
    if (btn) btn.addEventListener("click", function () { if (file) file.click(); });
    if (file) file.addEventListener("change", function () {
      var fl = file.files && file.files[0];
      if (!fl) return;
      if (btn) { btn.disabled = true; btn.textContent = "Subiendo…"; }
      note.innerHTML = "";
      fileData(fl).then(function (du) {
        return api("/api/fonts/custom/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: fl.name, dataBase64: String(du).split(",")[1] || "" }) });
      }).then(function (r) {
        var cf = r && r.data && r.data.font;
        if (!cf || !cf.familyName) throw new Error("La API no devolvió la fuente");
        FNT.custom = (FNT.custom || []).filter(function (x) { return x.familyName !== cf.familyName; }).concat([cf]);
        showFace(cf);
        input.value = cf.familyName;
        input.style.fontFamily = "'" + cf.familyName + "',sans-serif";
        note.innerHTML = "«" + esc(cf.familyName) + "» " + esc(T("subida y seleccionada · queda solo en tu cuenta"));
        if (btn) { btn.disabled = false; btn.textContent = T("Subir fuente…"); }
      }, function (x) {
        if (btn) { btn.disabled = false; btn.textContent = T("Subir fuente…"); }
        note.innerHTML = esc(T("No se pudo subir")) + ": " + esc(errMsg(x));
      });
      file.value = "";
    });
  }

  function wireColor(box, f) {
    var hex = document.getElementById("mbf_" + f.k), pick = box.querySelector(".mbc-pick");
    if (!hex || !pick) return;
    function sync(fromPick) {
      var n = hex6(fromPick ? pick.value : hex.value);
      if (!n) { hex.classList.toggle("mbc-bad", !fromPick && !!String(hex.value).trim()); return; }
      hex.classList.remove("mbc-bad");
      pick.value = n;
      if (fromPick) hex.value = n;
    }
    pick.addEventListener("input", function () { sync(true); });
    hex.addEventListener("input", function () { sync(false); });
    hex.addEventListener("blur", function () {
      var n = hex6(hex.value); if (!n) return;
      hex.value = n; pick.value = n; hex.classList.remove("mbc-bad");
    });
    sync(false);
  }

  function wireFields(fields) {
    fields.forEach(function (f) {
      if (f.t !== "color" && f.t !== "font") return;
      var box = mxEl.querySelector('.mbc-f[data-k="' + f.k + '"]');
      if (!box) return;
      if (f.t === "color") wireColor(box, f); else wireFont(box, f);
    });
  }

  /* Clic fuera del desplegado lo cierra sin cerrar el popup (captura: llega antes
     que el manejador del propio popup). */
  document.addEventListener("mousedown", function (e) {
    var b = FNT.box;
    if (!b || b.contains(e.target)) return;
    var l = b.querySelector(".mbc-flist");
    if (l) l.hidden = true;
    FNT.i = -1; FNT.box = null;
  }, true);

  /* «Espacio»: en qué espacio queda lo que creas (solo si tienes más de uno). En «Todo» viene marcado
     el de «Guardar en» (tu personal salvo que elijas otro); dentro de un espacio, ese espacio. */
  function wsName(id) { var R = RR(), w = (typeof WSS !== "undefined" && WSS[id]) || {}; return /^ws_user_/.test(id) && w.name === R.me ? "Mi espacio personal" : (w.name || id); }
  function withWs(fields) {
    var R = RR(), ids = (R.realWs || []).filter(function (id) { return typeof WSS !== "undefined" && WSS[id]; });
    if (ids.length < 2 || (fields || []).some(function (f) { return f.k === "__ws"; })) return fields;
    var cur = R.all ? (R.writeWs && WSS[R.writeWs] ? R.writeWs : R.personalWs) : R.ws;
    var brandF = (fields || []).filter(function (f) { return f.k === "brand"; })[0];
    if (brandF && brandF.v && R.wsOf && R.wsOf["brand:" + brandF.v] && R.wsOf["brand:" + brandF.v] !== cur) {
      /* preferir una marca del espacio donde se guarda; si ahí no hay marcas, el espacio sigue a la marca */
      var mine = Object.keys(R.brandName || {}).filter(function (id) { return R.wsOf["brand:" + id] === cur; }).sort(function (a, b) { return String(R.brandName[a]).localeCompare(String(R.brandName[b])); });
      if (mine.length) brandF.v = mine[0]; else cur = R.wsOf["brand:" + brandF.v];
    }
    return [{ k: "__ws", l: "Espacio", t: "select", opts: ids.map(function (id) { return [id, wsName(id) + (R.wsKind && R.wsKind[id] === "agency" ? " · agencia" : "")]; }), v: cur }].concat(fields || []);
  }
  function open(spec, ctx) {
    var R = RR();
    if (!R || !R.on) return uiToast("Cargando tus datos…");
    ctx = ctx || {};
    if (spec.needBrand && !brands().length) {
      return mx(spec.title, "Primero necesitas una marca: todo en Musa cuelga de una marca.", '<div class="ag-ctl" style="margin-top:6px"><button class="pri" data-a="brand">Crear una marca</button></div>', function (e) { if (e.target.closest('[data-a="brand"]')) open(C.marca); });
    }
    mx(spec.title, spec.sub || "", '<p class="mx-sub">Cargando…</p>');
    Promise.resolve(spec.prep ? spec.prep(ctx) : null).then(function (pre) {
      var fields = withWs(typeof spec.fields === "function" ? spec.fields(ctx, pre) : spec.fields);
      var html = formHTML(fields) + '<p class="mbc-err" style="color:#d33;font-size:12px;font-weight:700;margin:10px 0 0;min-height:1em"></p><div class="ag-ctl" style="margin-top:8px"><button class="pri" data-mbc="save">' + esc(spec.cta || "Crear") + '</button><button data-mx="close">Cancelar</button></div>';
      mx(spec.title, spec.sub || "", html, function (e) {
        var tag = e.target.closest(".ag-tag"); if (tag && tag.closest(".mbc-f")) { tag.setAttribute("aria-pressed", String(tag.classList.toggle("k"))); saveDraft(spec, fields); return; }
        if (!e.target.closest('[data-mbc="save"]')) return;
        var v = read(fields), err = mxEl.querySelector(".mbc-err"), btn = e.target.closest("button");
        var miss = fields.filter(function (f) { return f.req && visible(f, v) && (v[f.k] == null || v[f.k] === "" || (Array.isArray(v[f.k]) && !v[f.k].length)); })[0];
        if (miss) {
          var msg = miss.t === "checks" ? T("Elige al menos una opción en") + " «" + T(miss.l) + "»" : T("Falta") + ": " + T(miss.l);
          err.textContent = msg; uiToast(msg);
          var el = document.getElementById("mbf_" + miss.k), box = el && el.closest(".mbc-f");
          if (box) { box.classList.add("mbc-miss"); box.scrollIntoView({ block: "center", behavior: "smooth" }); setTimeout(function () { box.classList.remove("mbc-miss"); }, 2600); }
          if (el && el.focus && miss.t !== "checks") el.focus();
          return;
        }
        var badC = fields.filter(function (f) { return f.t === "color" && v[f.k] && !hex6(v[f.k]); })[0];
        if (badC) { err.textContent = T("Revisa") + " «" + T(badC.l) + "»: " + T("un color va en hexadecimal (#rgb o #rrggbb)"); var elc = document.getElementById("mbf_" + badC.k); if (elc) elc.focus(); return; }
        fields.forEach(function (f) { if (f.t === "color" && v[f.k]) v[f.k] = hex6(v[f.k]); });
        var bad = spec.check && spec.check(v, ctx, pre); if (bad) { err.textContent = bad; return; }
        var bws = v.brand && R.wsOf && R.wsOf["brand:" + v.brand];
        if (v.__ws && bws && bws !== v.__ws) { err.textContent = "Esa marca es de «" + wsName(bws) + "». Elige ese espacio o mueve la marca primero."; return; }
        /* lo mismo creado hace menos de un minuto: se pregunta antes de duplicar (QA lanzamiento #2/#3) */
        var dupKey = spec.title + "|" + String(v.name || v.title || v.topic || v.subject || "").trim().toLowerCase();
        if (!btn.dataset.dupOk && RECENT[dupKey] && Date.now() - RECENT[dupKey] < 60000) {
          err.textContent = "Ya creaste esto hace un momento. Si de verdad quieres otro igual, toca «" + (spec.cta || "Crear") + "» otra vez.";
          btn.dataset.dupOk = "1"; return;
        }
        var prevWs = R.ws; if (v.__ws) R.ws = v.__ws;
        /* FIX Vibe (REQ-083): la recarga y el after() deben correr con el ws DESTINO:
           antes se restituía prevWs antes de recargar y la lista leía el espacio viejo —
           el ítem recién creado quedaba «invisible». La restitución ahora ocurre al final. */
        btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.textContent = "Guardando…"; err.textContent = "";
        var slow = setTimeout(function () { if (btn.disabled && !mxEl.hidden) err.textContent = "Sigue guardando… no lo vuelvas a crear, ya casi."; }, 6000);
        var saved = false;
        Promise.resolve().then(function () { return spec.save(v, ctx, pre); }).then(function (res) {
          saved = true; clearTimeout(slow);
          mxEl.hidden = true;
          RECENT[dupKey] = Date.now(); clearDraft(spec);
          uiToast(typeof spec.ok === "function" ? spec.ok(v, res) : (spec.ok || "Creado"));
          createdBanner(String(v.name || v.title || v.topic || v.subject || "").trim(), typeof spec.ok === "function" ? spec.ok(v, res) : (spec.ok || "Creado"));
          extraWs = null;
          /* lo que sigue a crear (abrir el editor, abrir el evento, mostrar la fuente) pasa aunque la recarga falle:
             antes el error caía en este diálogo ya cerrado y no pasaba nada más (QA R4-6/R4-7) */
          /* QA R5 N-R5-6: abrir el editor no necesita la recarga (lee el diseño por su id). Antes esperaba hasta 6 s
             a que terminara y, con la red lenta, la persona veía «Diseño creado» y la lista: parecía que no abría. */
          if (spec.afterNow && spec.after) {
            Promise.resolve().then(function () { return spec.after(res, v, ctx); }).then(function () { R.ws = prevWs; R.reloadData && R.reloadData(); }).catch(function (x) { console.error("[crear] abrir:", x); R.ws = prevWs; });
          }
          var rl = spec.noReload ? Promise.resolve() : Promise.race([
            Promise.resolve().then(function () { return RR().reload(); }).catch(function (x) { console.warn("[crear] recarga:", x && x.message || x); }),
            new Promise(function (ok) { setTimeout(ok, 6000); })   /* con la red lenta no se espera más de 6 s; la recarga termina sola */
          ]);
          return rl.then(function () { return spec.after && !spec.afterNow ? spec.after(res, v, ctx) : null; }).then(function () { R.ws = prevWs; R.reloadData && R.reloadData(); });
        }).catch(function (x) {
          if (saved) { console.error("[crear] después de crear:", x); return; }
          clearTimeout(slow); R.ws = prevWs; btn.disabled = false; btn.removeAttribute("aria-busy"); btn.textContent = spec.cta || "Crear"; err.textContent = "No se pudo crear: " + errMsg(x) + " · Lo que escribiste sigue aquí.";
        });
      });
      mxClick.input = function () { syncWhen(fields); saveDraft(spec, fields); };
      restoreDraft(spec, fields);
      mxEl.onchange = function (e) {
        syncWhen(fields);
        /* al elegir una marca, el espacio pasa a ser el de esa marca */
        if (e && e.target && e.target.id === "mbf_brand") { var w = R.wsOf && R.wsOf["brand:" + e.target.value], sel = document.getElementById("mbf___ws"); if (w && sel && [].some.call(sel.options, function (o) { return o.value === w; })) sel.value = w; }
      };
      syncWhen(fields);
      wireFields(fields);
      var first = mxEl.querySelector("input:not([type=file]),textarea"); if (first) first.focus();
    }, function (x) { mxBody('<p class="mx-sub">No se pudo preparar el formulario: ' + esc(errMsg(x)) + "</p>"); });
  }

  /* ───────── borradores del diálogo, creados recientes y aviso «creado» ─────────
     Si el diálogo se cierra o se vuelve a abrir sin crear, lo escrito vuelve (antes se perdía y parecía guardado). */
  var RECENT = {};
  /* cancelar a propósito descarta el borrador */
  document.addEventListener("click", function (e) { var c = e.target.closest && e.target.closest(".mx [data-mx=close]"); if (!c || !c.closest(".mx").querySelector(".mbc-f")) return; var h = c.closest(".mx").querySelector("h3"); if (h) try { sessionStorage.removeItem("musa_draft:" + h.textContent.trim()); } catch (x) {} }, true);
  function draftKey(spec) { return "musa_draft:" + spec.title; }
  function saveDraft(spec, fields) {
    try {
      var v = read(fields), any = Object.keys(v).some(function (k) { return k !== "__ws" && v[k] && (!Array.isArray(v[k]) || v[k].length) && typeof v[k] !== "object"; });
      if (any) sessionStorage.setItem(draftKey(spec), JSON.stringify({ at: Date.now(), v: v }));
    } catch (e) {}
  }
  function clearDraft(spec) { try { sessionStorage.removeItem(draftKey(spec)); } catch (e) {} }
  function restoreDraft(spec, fields) {
    var d = null; try { d = JSON.parse(sessionStorage.getItem(draftKey(spec)) || "null"); } catch (e) {}
    if (!d || Date.now() - d.at > 30 * 60000) return;
    var n = 0;
    fields.forEach(function (f) {
      var val = d.v[f.k], el = document.getElementById("mbf_" + f.k); if (!el || val == null || val === "" || f.k === "__ws" || f.t === "file") return;
      if (f.t === "checks") { if (!Array.isArray(val) || !val.length) return; [].forEach.call(el.querySelectorAll(".ag-tag"), function (b) { var on = val.indexOf(b.dataset.v) >= 0; b.classList.toggle("k", on); b.setAttribute("aria-pressed", String(on)); }); n++; return; }
      if (typeof val === "object") return;
      el.value = val; n++;
    });
    if (n) { syncWhen(fields); var e = mxEl.querySelector(".mbc-err"); if (e) { e.style.color = "#8a6d00"; e.textContent = "Recuperé lo que habías escrito y no se llegó a crear."; setTimeout(function () { if (e.textContent.indexOf("Recuperé") === 0) { e.textContent = ""; e.style.color = "#d33"; } }, 6000); } }
  }
  /* aviso que queda hasta que lo nuevo aparece en la lista (la recarga tarda unos segundos) */
  function createdBanner(name, msg) {
    var old = document.querySelector(".mbc-done"); if (old) old.remove();
    var b = document.createElement("div"); b.className = "mbc-done"; b.setAttribute("role", "status"); b.setAttribute("aria-live", "polite");
    b.style.cssText = "position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147482000;background:#111;color:#fff;border-radius:12px;padding:10px 16px;font:600 13px/1.3 var(--sans,Inter,system-ui,sans-serif);box-shadow:0 12px 30px rgba(0,0,0,.35);display:flex;gap:10px;align-items:center";
    b.innerHTML = '<span style="color:#7CFC9A;font-size:16px">✓</span><span>' + esc(msg) + (name ? ": «" + esc(name.slice(0, 60)) + "»" : "") + ' <small style="opacity:.75">· actualizando la lista…</small></span>';
    document.body.appendChild(b);
    var t0 = Date.now(), iv = setInterval(function () {
      var view = document.getElementById("view"), inList = name && view && view.textContent.indexOf(name) >= 0;
      if (inList || Date.now() - t0 > 15000) {
        clearInterval(iv);
        var sm = b.querySelector("small"); if (sm) sm.textContent = inList ? "· ya está en la lista" : "· si no lo ves, recarga la lista";
        if (inList) { var hit = [].slice.call(view.querySelectorAll("*")).filter(function (n) { return !n.children.length && n.textContent.trim() === name; })[0]; var row = hit && hit.closest("tr,.tile,.kc,.li,.row,article,li"); if (row) { row.scrollIntoView({ block: "center", behavior: "smooth" }); row.style.transition = "box-shadow .3s"; row.style.boxShadow = "0 0 0 3px #ff5e00"; setTimeout(function () { row.style.boxShadow = ""; }, 2500); } }
        setTimeout(function () { b.remove(); }, 4000);
      }
    }, 400);
  }

  /* ───────── creadores ───────── */
  var C = {};

  C.pieza = {
    title: "Nueva pieza", sub: "Queda en el Calendario de la marca. Desde ahí la apruebas, le asignas diseño y la publicas.", needBrand: true,
    fields: function () {
      return [
        { k: "topic", l: "Tema", req: true, ph: "Ej.: 3 errores al cotizar una web" },
        { k: "brand", l: "Marca", t: "select", opts: brandOpts("Sin marca"), v: ctxBrandId() },
        { k: "fmt", l: "Formato", t: "select", opts: FMT, v: "post" },
        { k: "status", l: "Estado", t: "select", opts: [["idea", "Idea"], ["borrador", "Borrador"], ["aprobado", "Aprobada"]], v: "idea" },
        { k: "date", l: "Fecha", t: "date", req: true, v: day(1) },
        { k: "time", l: "Hora", t: "time", v: "18:00" },
        { k: "ch", l: "Canales", t: "checks", req: true, opts: NETS, v: ["instagram"] },
        { k: "tpl", l: "Diseño (opcional)", t: "select", opts: [["", "— sin diseño todavía —"]].concat((RR().tpl || []).map(function (t) { return [t.id, t.name || "Sin nombre"]; })) },
        { k: "copy", l: "Copy", t: "textarea", ph: "Texto de la publicación" },
      ];
    },
    save: function (v) {
      return ins("content_calendar", { id: "cc_" + hex(16), workspace_id: ws(), scheduled_date: v.date, scheduled_time: v.time || null, topic: v.topic, copy: v.copy || null, kind: v.fmt === "reel" ? "video" : "organic", visual_type: v.fmt, channels: v.ch, status: v.status, brand_id: v.brand || null, template_id: v.tpl || null });
    },
    ok: "Pieza creada en el Calendario",
  };

  /* importar varias piezas de una vez (QA lanzamiento #19: un plan de 30 días se cargaba pieza por pieza).
     Acepta CSV, TSV o una tabla Markdown con encabezados; entiende «13 nov», «13/11/2026» o «2026-11-13». */
  var MESES = { ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5, jul: 6, ago: 7, sep: 8, set: 8, oct: 9, nov: 10, dic: 11, jan: 0, apr: 3, aug: 7, dec: 11 };
  function normTxt(x) { return String(x || "").replace(/\*\*/g, "").trim(); }
  function plain(x) { return normTxt(x).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
  function splitRow(line, d) {
    if (d === "|") return line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(normTxt);
    var out = [], cur = "", q = false;
    for (var i = 0; i < line.length; i++) { var c = line[i]; if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (c === d && !q) { out.push(normTxt(cur)); cur = ""; } else cur += c; }
    out.push(normTxt(cur)); return out;
  }
  function parseDate(x) {
    var t = plain(x), m, now = new Date(), y;
    if ((m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t))) return m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
    if ((m = /(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?/.exec(t))) { y = m[3] ? (m[3].length === 2 ? "20" + m[3] : m[3]) : null; return fix(+m[1], +m[2] - 1, y); }
    if ((m = /(\d{1,2})\s*(?:de\s+)?([a-z]{3})[a-z]*\.?(?:\s+(?:de\s+)?(\d{4}))?/.exec(t)) && m[2] in MESES) return fix(+m[1], MESES[m[2]], m[3] || null);
    return null;
    function fix(dd, mm, yy) {
      var yr = yy ? +yy : now.getFullYear(); if (!yy && mm < now.getMonth() - 2) yr++;
      if (dd < 1 || dd > 31 || mm < 0 || mm > 11) return null;
      return yr + "-" + ("0" + (mm + 1)).slice(-2) + "-" + ("0" + dd).slice(-2);
    }
  }
  function parsePieces(txt, defCh) {
    var lines = String(txt || "").split(/\r?\n/).filter(function (l) { return l.trim() && !/^\s*\|?\s*:?-{3,}/.test(l); });
    if (lines.length < 2) return { rows: [], skipped: 0, err: "Pega una tabla con encabezados y al menos una fila" };
    var d = lines[0].indexOf("|") >= 0 ? "|" : lines[0].indexOf("\t") >= 0 ? "\t" : (lines[0].split(";").length > lines[0].split(",").length ? ";" : ",");
    var head = splitRow(lines[0], d).map(plain), col = function (re) { return head.findIndex(function (h) { return re.test(h); }); };
    var c = { date: col(/^fecha|^date/), time: col(/^hora|^time/), topic: col(/^tema|^topic|^titulo|^title|^idea/), fmt: col(/^formato|^format|^tipo/), ch: col(/^canal|^channel|^red/), copy: col(/^copy|^texto|^caption/), pain: col(/^dolor|^pain/), cta: col(/^cta|llamado/), status: col(/^estado|^status/) };
    if (c.date < 0) c.date = col(/^dia|^day/);
    if (c.topic < 0) return { rows: [], skipped: 0, err: "No encontré la columna «Tema» (o «Título»)" };
    if (c.date < 0) return { rows: [], skipped: 0, err: "No encontré la columna «Fecha»" };
    var rows = [], skipped = 0;
    lines.slice(1).forEach(function (l) {
      var r = splitRow(l, d), get = function (i) { return i >= 0 ? normTxt(r[i] || "") : ""; };
      var date = parseDate(get(c.date)), topic = get(c.topic).replace(/^["«“]|["»”]$/g, "");
      if (!date || !topic) { skipped++; return; }
      var f0 = plain(get(c.fmt)), fmt = /carrus|carous/.test(f0) ? "carrusel" : /reel|video/.test(f0) ? "reel" : /stor/.test(f0) && !/post/.test(f0) ? "story" : "post";
      var ch = get(c.ch) ? plain(get(c.ch)).split(/[\s,;\/+|]+/).map(function (x) { return x === "ig" ? "instagram" : x === "fb" ? "facebook" : x === "twitter" ? "x" : x; }).filter(function (x) { return NETS.some(function (n) { return n[0] === x; }); }) : [];
      var tm = /(\d{1,2}):(\d{2})/.exec(get(c.time));
      var copy = [get(c.copy), get(c.pain) && !/^[—-]/.test(get(c.pain)) ? "Dolor: " + get(c.pain) : "", get(c.cta) ? "CTA: " + get(c.cta) : ""].filter(Boolean).join("\n");
      var st = plain(get(c.status)), status = /aprob/.test(st) ? "aprobado" : /idea/.test(st) ? "idea" : null;
      rows.push({ date: date, time: tm ? ("0" + tm[1]).slice(-2) + ":" + tm[2] : null, topic: topic.slice(0, 300), fmt: fmt, ch: ch.length ? ch : defCh, copy: copy || null, status: status });
    });
    return { rows: rows, skipped: skipped };
  }
  C.piezasImport = {
    title: "Importar piezas al Calendario", sub: "Pega una tabla (CSV, TSV o Markdown) con encabezados: Fecha, Tema y, si quieres, Hora, Formato, Canales, Copy, Dolor, CTA, Estado. Quedan en borrador: nada se publica.", needBrand: true,
    fields: function () {
      return [
        { k: "brand", l: "Marca", t: "select", opts: brandOpts("Sin marca"), v: ctxBrandId() },
        { k: "status", l: "Estado", t: "select", opts: [["borrador", "Borrador"], ["idea", "Idea"], ["aprobado", "Aprobada"]], v: "borrador" },
        { k: "time", l: "Hora por defecto", t: "time", v: "18:00" },
        { k: "ch", l: "Canales por defecto", t: "checks", req: true, opts: NETS, v: ["instagram"] },
        { k: "table", l: "Tabla", t: "textarea", req: true, rows: 10, ph: "Fecha | Formato | Tema | Dolor | CTA\n13 nov | Carrusel | Las 6 horas que tu equipo pierde… | Trabajo manual | Cuéntanos" },
      ];
    },
    check: function (v, ctx) { var p = parsePieces(v.table, v.ch); if (p.err) return p.err; if (!p.rows.length) return "Ninguna fila tiene fecha y tema"; ctx.__parsed = p; return null; },
    save: function (v, ctx) {
      var p = ctx.__parsed || parsePieces(v.table, v.ch);
      var body = p.rows.map(function (r) { return { id: "cc_" + hex(16), workspace_id: ws(), scheduled_date: r.date, scheduled_time: r.time || v.time || null, topic: r.topic, copy: r.copy, kind: r.fmt === "reel" ? "video" : "organic", visual_type: r.fmt, channels: r.ch, status: r.status || v.status, brand_id: v.brand || null }; });
      var chunks = []; for (var i = 0; i < body.length; i += 50) chunks.push(body.slice(i, i + 50));
      return chunks.reduce(function (pr, ch) { return pr.then(function () { return jpost("/rest/v1/content_calendar", ch); }); }, Promise.resolve()).then(function () { return { n: body.length, skipped: p.skipped }; });
    },
    ok: function (v, r) { return (r && r.n) + " piezas creadas en el Calendario" + (r && r.skipped ? " · " + r.skipped + " filas sin fecha o tema se saltaron" : ""); },
  };

  C.brief = {
    title: "Nuevo brief", sub: "El punto de partida del trabajo. Al aprobarlo se convierte en proyecto.", needBrand: true,
    fields: function () {
      return [
        { k: "brand", l: "Marca", t: "select", opts: brandOpts("Sin marca"), v: ctxBrandId() },
        { k: "title", l: "Nombre", req: true, ph: "Ej.: Campaña de verano" },
        { k: "tpl", l: "Plantilla", t: "select", opts: [["Campaña", "Campaña"], ["Evento", "Evento"], ["Video", "Video"], ["Always-on", "Always-on"]] },
        { k: "tone", l: "Tono", ph: "Ej.: cercano, experto" },
        { k: "objective", l: "Objetivo", t: "textarea", req: true, rows: 2 },
        { k: "audience", l: "Público", t: "textarea", rows: 2 },
        { k: "message", l: "Mensaje clave", t: "textarea", rows: 2 },
        { k: "deliverables", l: "Entregables (separados por coma)", t: "textarea", rows: 2, ph: "12 posts, 4 reels, 1 landing" },
        { k: "channels", l: "Canales", ph: "Instagram, TikTok" },
        { k: "due", l: "Fecha de entrega", t: "date" },
        { k: "budget", l: "Presupuesto (S/)", t: "number" },
        { k: "approver", l: "Aprueba", ph: "Nombre de quien aprueba" },
      ];
    },
    save: function (v) {
      return ins("briefs", { workspace_id: ws(), brand_id: v.brand || null, brand_name: brandName(v.brand), title: v.title, status: "por_completar", objective: v.objective, audience: v.audience || null, tone: v.tone || null, deliverables: list(v.deliverables), due_date: v.due || null, budget: v.budget, created_by: uid(),
        content: { template: v.tpl, message: v.message || null, channels: v.channels || null, dates: v.due || null, budget: v.budget != null ? "S/ " + v.budget : null, approver: v.approver || null } });
    },
    ok: "Brief creado",
    after: function (r) { if (typeof CL !== "undefined" && r && r.id) CL.brief = "b_" + r.id; go(); },
  };

  C.nota = {
    title: "Nueva nota", sub: "Va a tu Segundo cerebro: la leen tú, tu equipo y tus agentes.",
    fields: [
      { k: "title", l: "Título", req: true },
      { k: "folder", l: "Carpeta", t: "select", opts: [["", "Notas"], ["idea", "Ideas"], ["brand", "Marcas"], ["campaign", "Campañas"], ["process", "Procesos"], ["decision", "Decisiones"]] },
      { k: "body", l: "Contenido (markdown)", t: "textarea", rows: 8 },
    ],
    save: function (v) {
      var slug = "nota-" + v.title.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) + "-" + hex(6);
      return ins("brain_notes", { workspace_id: ws(), slug: slug, title: v.title, body_md: v.body || "", entity_type: v.folder || null, source: "human" });
    },
    ok: "Nota guardada",
    after: function (r) { if (typeof BR !== "undefined" && r && r.id) { BR.sel = "bn_" + r.id; go(); } },
  };

  C.playbook = {
    title: "Nuevo playbook", sub: "Una receta de pasos con fechas relativas al día D. Escribe un paso por línea: día | paso | módulo | responsable.",
    fields: [
      { k: "name", l: "Nombre", req: true, ph: "Ej.: Lanzamiento de producto" },
      { k: "cat", l: "Categoría", t: "select", opts: [["Lanzamiento", "Lanzamiento"], ["Evento", "Evento"], ["Ventas", "Ventas"], ["Contenido recurrente", "Contenido recurrente"], ["General", "General"]] },
      { k: "d", l: "Descripción", ph: "Para qué sirve" },
      { k: "steps", l: "Pasos", t: "textarea", rows: 6, req: true, v: "-14 | Brief y objetivo | planear/briefs | Ejecutivo de cuentas\n-7 | Piezas en todos los formatos | crear/disenos | Diseño\n0 | Día D: publicar | planear/calendario | Community manager" },
    ],
    check: function (v) { return parseSteps(v.steps).length ? null : "Escribe al menos un paso con el formato día | paso"; },
    save: function (v) { return ins("workspace_playbooks", { workspace_id: ws(), name: v.name, category: v.cat, description: v.d || null, steps: parseSteps(v.steps), created_by: uid() }); },
    ok: "Playbook creado",
    after: function (r) { if (typeof PBS !== "undefined" && r && r.id) { PBS.sel = "pb_" + r.id; go(); } },
  };
  function parseSteps(s) {
    return String(s || "").split(/\n/).map(function (l) { var p = l.split("|").map(function (x) { return x.trim(); }); return p.length >= 2 && !isNaN(+p[0]) ? { d: +p[0], t: p[1], link: p[2] || "planear/calendario", who: p[3] || "" } : null; }).filter(Boolean);
  }

  C.fuente = {
    title: "Nueva fuente de investigación", sub: "Musa trae los titulares de la fuente cuando tocas «Traer titulares». Es gratis: no usa IA ni créditos.",
    fields: function () {
      return [
        { k: "name", l: "Nombre", req: true, ph: "Ej.: Blog de Meta for Business" },
        { k: "type", l: "Tipo", t: "select", opts: [["rss", "RSS / blog"], ["nitter", "Cuenta de X vía Nitter (inestable: muchas instancias públicas cerraron; si la cuenta tiene RSS, úsalo)"]] },
        { k: "url", l: "URL", req: true, ph: "https://…", full: true },
        { k: "brand", l: "Marca", t: "select", opts: brandOpts("Todas mis marcas") },
        { k: "refresh", l: "Cada cuánto", t: "select", opts: [["60", "Cada hora"], ["180", "Cada 3 horas"], ["720", "Cada 12 horas"], ["1440", "Una vez al día"]], v: "720" },
        { k: "inc", l: "Solo si menciona (coma)", ph: "IA, marketing" },
        { k: "exc", l: "Ignorar si menciona (coma)", ph: "crypto" },
      ];
    },
    check: function (v) { return /^https:\/\//.test(v.url) ? null : "La URL debe empezar con https://"; },
    save: function (v) { return ins("research_sources", { workspace_id: ws(), name: v.name, url: v.url, type: v.type, include_keywords: list(v.inc), exclude_keywords: list(v.exc), brand_id: v.brand || null, refresh_minutes: +v.refresh || 720 }); },
    ok: "Fuente agregada a Investigación", noReload: true,
    after: function () { if (RR().researchView) RR().researchView(); },   /* QA R4-6: antes había que salir y volver */
  };

  /* Crear una marca es definir su identidad: nombre, relación, colores y tipografía. La prioridad
   * y el próximo seguimiento son datos del CRM: viven en Vender › Empresas, donde se editan, y aquí
   * solo estorbaban. No se manda ninguno: la BD aplica su defecto (medium / sin fecha). */
  C.marca = {
    title: "Nueva marca", sub: "Aparece en Vender › Empresas y en Crear › Marcas. Sus colores y tipografía se usan en diseños y videos; la prioridad y el seguimiento se gestionan en Vender › Empresas.",
    fields: [
      { k: "name", l: "Nombre", req: true, ph: "Ej.: Ruta Sur" },
      { k: "rel", l: "Relación", t: "select", opts: [["client", "Cliente"], ["lead", "Prospecto"]], v: "lead" },
      { k: "c1", l: "Color principal", t: "color", v: "#ff5e00" },
      { k: "c2", l: "Color secundario", t: "color", v: "#111111" },
      { k: "font", l: "Tipografía", t: "font", ph: "Busca en Google Fonts o sube la tuya", full: true },
      { k: "notes", l: "Notas (industria, contexto)", t: "textarea", rows: 2 },
    ],
    save: function (v) {
      return ins("brands", { id: "brand_" + hex(20), workspace_id: ws(), name: v.name, relationship_status: v.rel, crm_notes: v.notes || null,
        colors: [{ hex: v.c1, name: "Principal" }, { hex: v.c2, name: "Secundario" }], fonts: v.font ? [{ family: v.font }] : [] });
    },
    ok: function (v) { return "Marca «" + v.name + "» creada"; },
  };

  C.diseno = {
    title: "Nuevo diseño", sub: "Se abre en el editor apenas lo creas.",
    /* ctx { name, w, h }: viene de una plantilla (Diseños › Plantillas › Abrir en el editor) */
    fields: function (ctx) {
      ctx = ctx || {};
      var key = ctx.w && ctx.h ? ctx.w + "x" + ctx.h : "1080x1080", known = SIZES.some(function (z) { return z[0] === key; });
      return [
        { k: "name", l: "Nombre", req: true, ph: "Ej.: Post lanzamiento", v: ctx.name || "" },
        { k: "brand", l: "Marca", t: "select", opts: brandOpts("Sin marca"), v: ctxBrandId() },
        { k: "size", l: "Formato", t: "select", opts: SIZES, v: known ? key : "custom" },
        { k: "bg", l: "Fondo", t: "color", v: "#ffffff" },
        { k: "w", l: "Ancho (px)", t: "number", v: ctx.w || 1080, when: { k: "size", v: "custom" } },
        { k: "h", l: "Alto (px)", t: "number", v: ctx.h || 1080, when: { k: "size", v: "custom" } },
      ];
    },
    check: function (v) { if (v.size !== "custom") return null; return v.w >= 50 && v.h >= 50 && v.w <= 8000 && v.h <= 8000 ? null : "El tamaño va de 50 a 8000 px"; },
    save: function (v) {
      var wh = v.size === "custom" ? [v.w, v.h] : v.size.split("x").map(Number), html = '<div data-layer-id="fondo" style="position:absolute;inset:0;background:' + v.bg + '"></div>';
      return api("/api/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: v.name, width: wh[0], height: wh[1], workspaceId: ws(), engine: "html", html: html, css: "" }) }).then(function (x) {
        var id = idOf(x); if (!id) throw new Error("el servidor no devolvió el diseño");
        var body = { name: v.name, frames: [{ id: "frame_" + Date.now().toString(36), name: "Frame 1", x: 0, y: 0, width: wh[0], height: wh[1], background: v.bg, html: html, css: "" }] };
        if (v.brand) body.brandId = v.brand;
        return api("/api/templates/" + encodeURIComponent(id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(function () { return id; });
      });
    },
    ok: "Diseño creado · abriendo el editor…",
    afterNow: true, after: function (id) { if (RR().openDesign) RR().openDesign(id); },
  };

  C.deck = {
    title: "Nueva presentación", sub: "Musa arma el deck 16:9 con tu marca: portada + una lámina por título. Después lo editas como cualquier diseño.",
    fields: function () {
      return [
        { k: "name", l: "Tema", req: true, ph: "Ej.: Resultados de octubre" },
        { k: "brand", l: "Marca", t: "select", opts: brandOpts("Sin marca"), v: ctxBrandId() },
        { k: "color", l: "Color de la marca", t: "color", v: "#ff5e00" },
        { k: "slides", l: "Títulos de las láminas (uno por línea)", t: "textarea", rows: 5, req: true, v: "Agenda\nLo que hicimos\nResultados\nPróximos pasos" },
      ];
    },
    save: function (v) {
      var slides = list(v.slides.replace(/,/g, "‚")).map(function (t) { return { title: t.replace(/‚/g, ","), html: '<div class="b"><p>Escribe aquí el contenido de esta lámina.</p></div>', css: ".b{font:400 36px/1.4 Inter,sans-serif;color:#333}" }; });
      var a = { workspaceId: ws(), name: v.name, brand: { name: brandName(v.brand) || v.name, color: v.color }, slides: slides };
      if (v.brand) a.brandId = v.brand;
      return RR().mcp("create_deck", a).then(function (r) { var id = idOf(r); if (!id) throw new Error("no se recibió la presentación"); return id; });
    },
    ok: "Presentación creada · abriendo el editor…",
    afterNow: true, after: function (id) { if (RR().openDesign) RR().openDesign(id); },
  };

  C.video = {
    title: "Nuevo video", sub: "Se abre en el editor de video: agrega tomas, diseños, textos y música.",
    fields: [
      { k: "name", l: "Nombre", req: true, ph: "Ej.: Reel lanzamiento" },
      { k: "fmt", l: "Formato", t: "select", opts: VFMTS, v: "9:16" },
    ],
    save: function (v) {
      var D = { "9:16": [1080, 1920], "16:9": [1920, 1080], "1:1": [1080, 1080], "4:5": [1080, 1350] }[v.fmt];
      return api("/api/video-projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: ws(), name: v.name, ratio: v.fmt, canvasW: D[0], canvasH: D[1], fps: 30 }) })
        .then(function (x) { var id = x && x.data && x.data.project && x.data.project.id; if (!id) throw new Error("no se recibió el video"); return id; });
    },
    ok: "Video creado",
    after: function (id) { var R = RR(), i = (R.vids || []).findIndex(function (x) { return x.id === id; }); if (R.openVideo) R.openVideo(id, i < 0 ? 0 : i); },
  };

  C.clon = {
    title: "Nuevo clon", sub: "Con tus llaves (Integraciones): avatar con HeyGen o voz con ElevenLabs. En el plan Empresa, además, clones propios de Musa desde una toma o una foto. La persona debe haber dado su consentimiento.",
    prep: function () {
      var est = window.__musaClonEstado ? window.__musaClonEstado(true) : Promise.resolve(null);
      return Promise.all([get("/api/video-takes?workspace_id=" + encodeURIComponent(ws())).then(function (x) { return (x && x.takes) || []; }, function () { return []; }), est])
        .then(function (r) { var takes = r[0]; takes.musa = !!(r[1] && r[1].habilitado); return takes; });
    },
    fields: function (ctx, takes) {
      return [
        { k: "kind", l: "Tipo de clon", t: "select", opts: (takes.musa ? [["musa", "Clon Musa: avatar + voz (plan Empresa)"]] : []).concat([["avatar", "Clon con avatar (HeyGen, con tu llave)"], ["voz", "Clonar voz (ElevenLabs, con tu llave)"]]), v: ctx.kind === "voz" ? "voz" : (takes.musa && ctx.kind !== "heygen" ? "musa" : "avatar") },
        takes.musa ? null : { k: "planinfo", t: "info", full: true, when: { k: "kind", v: "avatar" }, html: "Los <b>clones propios de Musa</b> están habilitados para el plan Empresa. Con tu llave de HeyGen el clon lo entrena HeyGen y Musa lo trae a tu cuenta." },
        { k: "name", l: "Nombre", req: true, ph: "Ej.: Renzo · voz" },
        { k: "audio", l: "Muestra de audio (1 a 3 min, WAV o MP3)", t: "file", accept: "audio/*", req: true, when: { k: "kind", v: "voz" }, full: true },
        { k: "desc", l: "Descripción de la voz", ph: "Ej.: cálida, ritmo pausado", when: { k: "kind", v: "voz" } },
        { k: "msrc", l: "Fuente del clon", t: "select", req: true, when: { k: "kind", v: "musa" }, full: true, opts: takes.map(function (t, i) { return [t.id, "Toma " + (i + 1) + " · " + new Date(t.created_at || t.createdAt || Date.now()).toLocaleString("es-PE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " (también clona tu voz)"]; }).concat([["__foto", "Subir una foto de frente"]]) },
        { k: "mfoto", l: "Foto de frente (JPG, PNG o WebP, hasta 8 MB)", t: "file", accept: "image/jpeg,image/png,image/webp", when: { k: "msrc", v: "__foto", and: { k: "kind", v: "musa" } }, full: true },
        { k: "take", l: "Toma grabada (últimas 24 h)", t: "select", req: true, when: { k: "kind", v: "avatar" }, opts: takes.length ? takes.map(function (t, i) { return [t.id, "Toma " + (i + 1) + " · " + new Date(t.created_at || t.createdAt || Date.now()).toLocaleString("es-PE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })]; }) : [["", "No hay tomas: graba 2 minutos en Crear › Tomas"]] },
        { k: "ok", l: "Consentimiento", t: "select", req: true, opts: [["", "— confirma —"], ["si", "La persona autorizó el uso de su voz/imagen"]] },
      ].filter(Boolean);
    },
    save: function (v) {
      if (v.kind === "musa") {
        var body = { workspaceId: ws(), name: v.name, consent: v.ok === "si" };
        var go1 = v.msrc === "__foto"
          ? (function () {
            if (!v.mfoto) throw new Error("elige la foto");
            if (v.mfoto.size > 8 * 1024 * 1024) throw new Error("la foto pesa más de 8 MB");
            return fileData(v.mfoto).then(function (d) { var m = d.match(/^data:([^;]+);base64,(.*)$/); body.source = "photo"; body.photoMime = m[1]; body.photoBase64 = m[2]; });
          })()
          : Promise.resolve((body.source = "take", body.takeId = v.msrc));
        return go1.then(function () { return api("/api/musa-clon/clones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), timeoutMs: 120000 }); })
          .then(function (x) { if (window.__musaReloadClones) window.__musaReloadClones(); return x; });
      }
      if (v.kind === "voz") {
        if (v.audio.size > 9.5 * 1024 * 1024) throw new Error("la muestra pesa más de 9,5 MB: recórtala");
        return fileData(v.audio).then(function (d) {
          var m = d.match(/^data:([^;]+);base64,(.*)$/);
          return api("/api/elevenlabs/clone", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: v.name, description: v.desc || "", audioBase64: m[2], mimeType: m[1] }) });
        }).then(function (x) { return registerClone({ kind: "voz", provider: "elevenlabs", name: v.name, external_id: x && x.voiceId, status: "listo" }); });
      }
      return api("/api/heygen/avatars/digital-twin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ take_id: v.take, name: v.name }) })
        .then(function (x) { var d = (x && (x.data || x)) || {}; return registerClone({ kind: "avatar", provider: "heygen", name: v.name, external_id: d.avatar_id || d.avatarId || d.id || null, status: "entrenando" }); });
    },
    ok: function (v) { return v.kind === "musa" ? "Clon creado: Musa lo está preparando (ábrelo para ver el avance)" : v.kind === "voz" ? "Voz clonada: ya la puedes usar en voz en off" : "Entrenamiento enviado a HeyGen: tarda unos minutos"; },
    noReload: true, after: function () { go(); },
  };

  C.evento = {
    title: "Nuevo evento", sub: "Trae su página pública, inscritos y mails automáticos (confirmación y recordatorios).",
    fields: function () {
      return [
        { k: "name", l: "Nombre", req: true, ph: "Ej.: Webinar · IA para tu marca" },
        { k: "brand", l: "Marca", t: "select", opts: brandOpts("Sin marca"), v: ctxBrandId() },
        { k: "date", l: "Fecha", t: "date", req: true, v: (typeof EVN !== "undefined" && EVN.day) ? new Date(EVN.day).toISOString().slice(0, 10) : day(14) },
        { k: "time", l: "Hora", t: "time", req: true, v: "19:00" },
        { k: "dur", l: "Duración (min)", t: "number", v: 60 },
        { k: "cap", l: "Cupos", t: "number", v: 100 },
        { k: "plat", l: "Plataforma", t: "select", opts: [["meet", "Google Meet"], ["zoom", "Zoom"], ["presencial", "Presencial (en vivo)"], ["hibrido", "Híbrido (sala + presencial)"]] },
        { k: "venue", l: "Lugar / dirección (presencial o híbrido)", ph: "Ej.: Coworking San Isidro, Lima", full: true },
        { k: "link", l: "Enlace de la sala (virtual o del híbrido)", ph: "https://meet.google.com/…" },
        { k: "link", l: "Enlace de la sala", ph: "https://meet.google.com/…" },
        /* por defecto no se publica: una página pública de inscripciones no debe salir por accidente (QA R4-12) */
        { k: "pub", l: "Página pública", t: "select", opts: [["0", "Guardar sin publicar"], ["1", "Publicar ya: abre inscripciones con su enlace"]], v: "0", full: true },
        { k: "desc", l: "Descripción", t: "textarea", rows: 3 },
      ];
    },
    /* publicar sin enlace de la sala: se avisa una vez (el correo «¡Empezamos! + enlace» saldría sin enlace; QA lanzamiento #13) */
    check: function (v, ctx) {
      if (v.pub !== "1" || v.plat === "presencial" || String(v.link || "").trim() || ctx.__noLinkOk) return null;
      ctx.__noLinkOk = true;
      return "Vas a publicar sin «Enlace de la sala»: el correo «¡Empezamos! + enlace» saldría sin enlace. Agrégalo ahora o toca «Crear» otra vez para publicar igual (puedes agregarlo después en el evento).";
    },
    save: function (v) {
      if (typeof EVN !== "undefined") EVN.day = null;
      var slug = v.pub === "1" ? v.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) + "-" + Math.random().toString(36).slice(2, 6) : null;
      var at = new Date(v.date + "T" + (v.time || "19:00") + ":00");
      return ins("workspace_events", { workspace_id: ws(), name: v.name, date: v.date, starts_at: at.toISOString(), duration_min: v.dur || 60, capacity: v.cap || 100, platform: v.plat, link: v.link || null, brand_id: v.brand || null, description: v.desc || null, location: (v.plat === "presencial" || v.plat === "hibrido") ? (v.venue || ("Presencial" + (v.plat === "hibrido" ? " + sala virtual" : ""))) : (v.plat === "zoom" ? "Zoom" : "Google Meet"), created_by: uid(), published: !!slug, slug: slug, published_at: slug ? new Date().toISOString() : null });
    },
    ok: function (v) { var R = RR(); var n = (R && R.ws && R.all && typeof WSS !== "undefined" && WSS[R.ws] && WSS[R.ws].name) ? WSS[R.ws].name : null; return "Evento creado" + (n ? " en espacio «" + n + "»" : "") + " · actualizando la lista…"; },
    /* se abre cuando el evento ya está en la lista (antes se saltaba a él a los 600 ms y, si los datos no habían llegado, quedaba la lista vieja; QA R4-6) */
    after: function (r) {
      if (!r || !r.id) return;
      var abrir = function () { location.hash = "crear/eventos/e_" + r.id + (r.published ? "/pagina" : ""); };
      var listo = RR().reloadData ? RR().reloadData() : null;
      Promise.race([Promise.resolve(listo), new Promise(function (ok) { setTimeout(ok, 8000); })]).then(function () {
        if (typeof EV !== "undefined" && !EV.some(function (e) { return e.id === "e_" + r.id || e.db === r.id; })) { var again = RR().reloadData && RR().reloadData(); return Promise.resolve(again).then(abrir); }
        abrir();
      });
    },
  };

  var MTPL = [["news", "Newsletter"], ["promo", "Promoción"], ["welcome", "Bienvenida"], ["reactiv", "Reactivación"], ["invite", "Invitación"]];
  C.mailing = {
    title: "Nueva campaña de mailing", sub: "Queda en borrador y se abre para que escribas el correo: lo revisas, lo pruebas y lo envías tú.",
    /* ¿hay proveedor de correo conectado? (QA lanzamiento #14: se podía crear y «programar» sin saber que no saldría nada) */
    prep: function () {
      var b = window.parent && window.parent.__musaBridge; if (!b) return null;
      return b.api("/api/email/settings?workspaceId=" + encodeURIComponent(ws())).then(function (r) { return { mail: !!(r && r.settings) }; }, function () { return { mail: null }; });
    },
    fields: function (ctx, pre) {
      var warn = pre && pre.mail === false ? [{ k: "nomail", t: "info", full: true, html: "<b style=\"color:#b25d00\">Este espacio no tiene proveedor de correo conectado.</b> Puedes crear y preparar la campaña, pero no se enviará ni programará hasta conectar Resend o Postmark en <a href=\"#configuracion/integraciones\">Configuración › Integraciones</a>." }] : [];
      return warn.concat([
        { k: "name", l: "Nombre interno", req: true, ph: "Ej.: Newsletter noviembre" },
        { k: "subject", l: "Asunto", req: true, ph: "Lo que verá en su bandeja" },
        { k: "brand", l: "Marca", t: "select", opts: brandOpts("Sin marca"), v: ctxBrandId() },
        { k: "tpl", l: "Plantilla", t: "select", opts: MTPL },
        { k: "seg", l: "Audiencia", v: "Todos los contactos", ph: "Ej.: Clientes · Ruta Sur" },
        { k: "when", l: "Fecha de envío prevista", t: "date" },
      ]);
    },
    save: function (v) { return ins("workspace_mailings", { workspace_id: ws(), subject: v.subject, status: "borrador", send_at: v.when ? v.when + "T09:00:00" : null, kind: "campana", content: { name: v.name, brand_id: v.brand || null, seg: v.seg || "Todos", tpl: v.tpl }, created_by: uid() }); },
    ok: "Campaña de mailing creada", after: function (r) { if (typeof ML !== "undefined") { ML.tab = "campanas"; ML.draft = null; if (r && r.id) ML.sel = "m_" + r.id; go(); } },
  };
  C.secuencia = {
    title: "Nueva secuencia", sub: "Correos que salen solos según el día desde que la persona entra. Un correo por línea: día | asunto.",
    fields: function () {
      return [
        { k: "name", l: "Nombre", req: true, ph: "Ej.: Bienvenida a leads" },
        { k: "brand", l: "Marca", t: "select", opts: brandOpts("Sin marca"), v: ctxBrandId() },
        { k: "seg", l: "Entran a la secuencia", v: "Leads nuevos", full: true },
        { k: "steps", l: "Correos", t: "textarea", rows: 4, req: true, v: "0 | Bienvenida\n3 | Te cuento cómo trabajamos\n7 | Una propuesta para ti" },
      ];
    },
    check: function (v) { return seqSteps(v.steps).length ? null : "Escribe al menos un correo: día | asunto"; },
    save: function (v) { var st = seqSteps(v.steps); return ins("workspace_mailings", { workspace_id: ws(), subject: v.name, status: "borrador", kind: "secuencia", content: { name: v.name, brand_id: v.brand || null, groups: [v.seg || "Todos"], steps: st }, created_by: uid() }); },
    ok: "Secuencia creada", after: function () { if (typeof ML !== "undefined") { ML.tab = "secuencias"; go(); } },
  };
  function seqSteps(s) { return String(s || "").split(/\n/).map(function (l) { var p = l.split("|").map(function (x) { return x.trim(); }); return p.length >= 2 && !isNaN(+p[0]) && p[1] ? { d: +p[0], subject: p[1], tpl: "news" } : null; }).filter(Boolean); }

  C.form = {
    title: "Nuevo formulario", sub: "Lo que llega entra al CRM de la marca. Después agregas o cambias campos.",
    fields: function () {
      return [
        { k: "name", l: "Nombre", req: true, ph: "Ej.: Contacto web" },
        { k: "brand", l: "Marca", t: "select", opts: brandOpts("Sin marca"), v: ctxBrandId() },
        { k: "type", l: "Tipo", t: "select", opts: [["Contacto", "Contacto"], ["Inscripción", "Inscripción"], ["Cotización", "Pedido de cotización"], ["Encuesta", "Encuesta"]] },
        { k: "pub", l: "Estado", t: "select", opts: [["0", "Pausado (borrador)"], ["1", "Activo"]] },
        { k: "fields", l: "Campos", t: "checks", req: true, opts: [["nombre", "Nombre"], ["email", "Email"], ["telefono", "Teléfono"], ["empresa", "Empresa"], ["mensaje", "Mensaje"]], v: ["nombre", "email"] },
      ];
    },
    save: function (v) {
      var L = { nombre: ["Nombre", "Texto"], email: ["Email", "Email"], telefono: ["Teléfono", "Teléfono"], empresa: ["Empresa", "Texto"], mensaje: ["Mensaje", "Párrafo"] };
      return ins("workspace_forms", { workspace_id: ws(), name: v.name, published: v.pub === "1", schema: { brand_id: v.brand || null, type: v.type, fields: v.fields.map(function (k) { return { name: k, label: L[k][0], type: L[k][1], required: k === "email" || k === "nombre" }; }) }, created_by: uid() });
    },
    ok: "Formulario creado",
  };

  C.flow = {
    title: "Nueva automatización", sub: "Se crea en borrador con disparo manual y se abre en el editor para armar los pasos.",
    fields: [
      { k: "name", l: "Nombre", req: true, ph: "Ej.: Ideas de la semana con IA" },
      { k: "desc", l: "Qué hace (opcional)", t: "textarea", rows: 2 },
    ],
    check: function (v) { return v.name.length > 80 ? "Máximo 80 caracteres" : null; },
    save: function (v) {
      return RR().mcp("flow_save", { workspaceId: ws(), name: v.name, enabled: false, trigger: { type: "manual" }, nodes: v.desc ? [{ id: "nota", type: "note", text: v.desc, x: 80, y: 260 }] : [], edges: [] })
        .then(function (r) { var id = idOf(r); if (!id) throw new Error("no se recibió el flow"); return id; });
    },
    ok: "Automatización creada",
    after: function (id) { location.hash = "crear/automatizaciones/" + id; },
  };

  C.mensaje = {
    title: "Nuevo mensaje", sub: "Escríbele a alguien que ya te habló en tus redes conectadas. Se envía desde la cuenta de la marca.",
    prep: function () { return get(q("social_inbox", "id,author_name,author_handle,platform,kind,content", "&order=occurred_at.desc&limit=100")).then(function (r) { return r || []; }); },
    fields: function (ctx, rows) {
      if (!rows.length) return [{ k: "info", t: "info", html: "Todavía no hay conversaciones: conecta Instagram, Facebook, TikTok o WhatsApp en <a href='#configuracion/integraciones' style='color:var(--accent);font-weight:700'>Configuración › Integraciones</a> y los mensajes llegarán a Bandeja." }];
      return [
        { k: "item", l: "Para", t: "select", req: true, full: true, opts: rows.map(function (m) { return [m.id, (m.author_name || m.author_handle || "—") + " · " + (m.platform || "") + " · " + String(m.content || "").slice(0, 40)]; }) },
        { k: "text", l: "Mensaje", t: "textarea", req: true, rows: 4 },
      ];
    },
    check: function (v, c, rows) { return rows.length ? null : "Primero conecta una red"; },
    save: function (v) {
      return RR().mcp("reply_social", { workspaceId: ws(), itemId: v.item, content: v.text })
        .then(function () { return api("/rest/v1/social_inbox?id=eq." + encodeURIComponent(v.item), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "replied", reply_text: v.text, replied_at: new Date().toISOString() }) }); });
    },
    ok: "Mensaje enviado",
  };

  var CTYPE = [["general", "General"], ["launch", "Lanzamiento"], ["relaunch", "Relanzamiento"], ["seasonal", "Temporada"], ["cobranding", "Co-branding"], ["nurturing", "Nutrición de leads"], ["event", "Evento"], ["retention", "Retención"]];
  C.ads = {
    title: "Nueva campaña de ads", sub: "La planificas aquí con su presupuesto; la pauta se activa en la red cuando conectes tu cuenta de ads.", needBrand: true,
    fields: function () {
      var nets = typeof AD_NETS !== "undefined" ? Object.keys(AD_NETS).map(function (k) { return [k, AD_NETS[k][0]]; }) : [["meta", "Meta Ads"]];
      return [
        { k: "name", l: "Nombre", req: true, ph: "Ej.: Black Friday · conversiones" },
        { k: "brand", l: "Marca", t: "select", req: true, opts: brandOpts("Elige una marca…"), v: ctxBrandId() },
        { k: "net", l: "Red", t: "select", opts: nets },
        { k: "obj", l: "Objetivo", t: "select", opts: [["Ventas", "Ventas"], ["Leads", "Leads"], ["Tráfico", "Tráfico"], ["Reconocimiento", "Reconocimiento"]] },
        { k: "type", l: "Tipo de campaña", t: "select", opts: CTYPE },
        { k: "budget", l: "Presupuesto (US$)", t: "number", req: true, v: 100 },
        { k: "notes", l: "Notas para la pauta", t: "textarea", rows: 2 },
      ];
    },
    check: function (v) { return v.budget > 0 ? null : "El presupuesto debe ser mayor a 0"; },
    save: function (v) { return ins("campaigns", { id: "campaign_" + hex(16), workspace_id: ws(), brand_id: v.brand, name: v.name, status: "active", campaign_type: v.type, brief: JSON.stringify({ net: v.net, obj: v.obj, notes: v.notes || "" }), budget_plan_usd: v.budget }); },
    ok: "Campaña de ads creada",
    after: function () { if (typeof AD !== "undefined") { AD.nu = false; go(); } },
  };

  function contacts() { return get(q("crm_contacts", "id,first_name,last_name,email", "&order=updated_at.desc&limit=300")).then(function (r) { return r || []; }); }
  var STAGE_OF = { "Prospecto": "discovery", "Propuesta": "proposal", "Negociación": "negotiation", "Ganado": "approved" };
  C.oportunidad = {
    title: "Nueva oportunidad", sub: "Entra al embudo de Vender. Si la mueves a Propuesta puedes crearle una cotización.", needBrand: true,
    prep: contacts,
    fields: function (ctx, cs) {
      return [
        { k: "title", l: "Título", req: true, ph: "Ej.: Landing + chatbot" },
        { k: "brand", l: "Marca (cliente)", t: "select", req: true, opts: brandOpts("Elige una marca…"), v: ctxBrandId() },
        { k: "contact", l: "Contacto", t: "select", opts: [["", "— sin contacto —"]].concat(cs.map(function (c) { return [c.id, ((c.first_name || "") + " " + (c.last_name || "")).trim() + (c.email ? " · " + c.email : "")]; })) },
        { k: "stage", l: "Etapa", t: "select", opts: [["discovery", "Prospecto"], ["proposal", "Propuesta"], ["negotiation", "Negociación"], ["approved", "Ganado"]], v: STAGE_OF[ctx.col] || "discovery" },
        { k: "value", l: "Valor", t: "number" },
        { k: "cur", l: "Moneda", t: "select", opts: [["PEN", "Soles (S/)"], ["USD", "Dólares (US$)"]] },
        { k: "prob", l: "Probabilidad (%)", t: "number", v: 20 },
        { k: "close", l: "Cierre esperado", t: "date" },
        { k: "next", l: "Próximo paso", ph: "Ej.: Enviar propuesta el lunes", full: true },
      ];
    },
    check: function (v) { return v.prob == null || (v.prob >= 0 && v.prob <= 100) ? null : "La probabilidad va de 0 a 100"; },
    save: function (v) { return ins("crm_deals", { workspace_id: ws(), brand_id: v.brand, title: v.title, primary_contact_id: v.contact || null, stage: v.stage, value: v.value, currency: v.cur, probability: v.prob == null ? 10 : Math.round(v.prob), expected_close_date: v.close || null, next_step_note: v.next || null, created_by: uid() }); },
    ok: "Oportunidad creada",
  };

  C.persona = {
    title: "Nueva persona", sub: "Un contacto del CRM. Puedes asociarlo luego a oportunidades.",
    fields: function () {
      return [
        { k: "fn", l: "Nombre", req: true }, { k: "ln", l: "Apellido" },
        { k: "email", l: "Email", t: "email" }, { k: "phone", l: "Teléfono", t: "tel" },
        { k: "job", l: "Cargo" }, { k: "company", l: "Empresa" },
        { k: "brand", l: "Marca", t: "select", opts: brandOpts("Sin marca"), v: ctxBrandId() },
        { k: "status", l: "Estado", t: "select", opts: [["lead", "Lead"], ["active", "Activo"], ["inactive", "Inactivo"]] },
        { k: "tags", l: "Etiquetas (coma)", full: true },
        { k: "notes", l: "Notas", t: "textarea", rows: 2 },
      ];
    },
    check: function (v) { return !v.email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email) ? null : "El email no es válido"; },
    save: function (v) { return ins("crm_contacts", { workspace_id: ws(), first_name: v.fn, last_name: v.ln || null, email: v.email || null, phone: v.phone || null, job_title: v.job || null, company: v.company || null, brand_id: v.brand || null, brand_name: brandName(v.brand), status: v.status, tags: list(v.tags), notes: v.notes || null, created_by: uid(), origin_source: "manual" }); },
    ok: "Persona agregada al CRM",
  };

  C.cotizacion = {
    title: "Nueva cotización", sub: "Con tu tarifario. Pon la cantidad de cada servicio; el total se calcula solo.",
    prep: function () {
      return Promise.all([get(q("crm_deals", "id,title,brand_id", "&order=updated_at.desc&limit=200")), get(q("workspace_rates", "label,price,unit,sort", "&order=sort.asc"))])
        .then(function (r) {
          r = [r[0], null, r[1]];
          return { deals: r[0] || [], n: 0, rates: (r[2] && r[2].length ? r[2] : (typeof RATES !== "undefined" ? RATES.map(function (x) { return { label: x[0], price: x[1], unit: x[2] }; }) : [])) }; });
    },
    fields: function (ctx, p) {
      var deal = ctx.deal ? p.deals.find(function (d) { return d.id === ctx.deal; }) || p.deals.find(function (d) { return d.title === ctx.deal; }) : null;
      return [
        { k: "title", l: "Título", req: true, v: ctx.title || (deal ? deal.title : ""), ph: "Ej.: Campaña de verano" },
        { k: "brand", l: "Marca", t: "select", opts: brandOpts("Sin marca"), v: (deal && deal.brand_id) || ctx.brand || ctxBrandId() },
        { k: "deal", l: "Oportunidad", t: "select", opts: [["", "— sin oportunidad —"]].concat(p.deals.map(function (d) { return [d.id, d.title]; })), v: deal ? deal.id : "" },
        { k: "cur", l: "Moneda", t: "select", opts: [["PEN", "Soles (S/)"], ["USD", "Dólares (US$)"]] },
      ].concat(p.rates.map(function (r, i) { return { k: "r" + i, l: r.label + " · " + r.price + " / " + (r.unit || "pieza"), t: "number", v: 0 }; }));
    },
    check: function (v, c, p) { return p.rates.some(function (r, i) { return v["r" + i] > 0; }) ? null : "Pon cantidad en al menos un servicio"; },
    save: function (v, c, p) {
      var items = p.rates.map(function (r, i) { return { label: r.label, price: Number(r.price), unit: r.unit || "pieza", qty: v["r" + i] || 0 }; }).filter(function (x) { return x.qty > 0; });
      var total = items.reduce(function (s, x) { return s + x.price * x.qty; }, 0), W = ws(), yr = "COT-" + new Date().getFullYear() + "-";
      /* el número sigue al mayor COT-año-NNN del espacio donde se guarda: contar filas chocaba con un número ya usado
         apenas se borraba una cotización (la base no admite dos iguales en el mismo espacio) */
      return get("crm_quotes?workspace_id=eq." + encodeURIComponent(W) + "&select=number&number=like." + encodeURIComponent(yr + "*") + "&limit=5000").then(function (rows) {
        var top = (rows || []).reduce(function (m, x) { return Math.max(m, parseInt(String(x.number || "").slice(yr.length), 10) || 0); }, 0);
        return ins("crm_quotes", { workspace_id: W, number: yr + String(top + 1).padStart(3, "0"), brand_id: v.brand || null, brand_name: brandName(v.brand), deal_id: v.deal || null, title: v.title, status: "Borrador", items: items, currency: v.cur, total: total, created_by: uid() });
      });
    },
    ok: "Cotización creada en borrador",
    after: function (r) { if (typeof CL !== "undefined" && r && r.id) { CL.quote = "q_" + r.id; CL._wantQuote = CL.quote; if (RR().reloadData) RR().reloadData(); } var h = /^#?clientes/.test(location.hash) ? "clientes/cotizaciones" : "vender/cotizaciones"; if (location.hash.replace("#", "") !== h) location.hash = h; else go(); },
  };

  C.fee = {
    title: "Nuevo fee mensual", sub: "Lo que la marca paga al mes y lo que incluye. Las horas y piezas se descuentan solas.", needBrand: true,
    fields: function () {
      return [
        { k: "brand", l: "Marca", t: "select", req: true, opts: brandOpts("Elige una marca…"), v: ctxBrandId() },
        { k: "fee", l: "Fee mensual", t: "number", req: true },
        { k: "cur", l: "Moneda", t: "select", opts: [["PEN", "Soles (S/)"], ["USD", "Dólares (US$)"]] },
        { k: "hours", l: "Horas incluidas", t: "number", v: 20 },
        { k: "pieces", l: "Piezas incluidas", t: "number", v: 12 },
      ];
    },
    save: function (v) { return ins("workspace_fees", { workspace_id: ws(), brand_id: v.brand, brand_name: brandName(v.brand), monthly_fee: v.fee, currency: v.cur, hours_included: v.hours || 0, pieces_included: Math.round(v.pieces || 0) }); },
    ok: "Fee creado",
  };

  C.proyecto = {
    title: "Nuevo proyecto", sub: "Agrupa tareas, piezas, horas y presupuesto de un trabajo para una marca.",
    prep: function () { return get(q("briefs", "id,title", "&order=updated_at.desc&limit=100")).then(function (r) { return r || []; }); },
    fields: function (ctx, bs) {
      return [
        { k: "name", l: "Nombre", req: true },
        { k: "brand", l: "Marca", t: "select", opts: brandOpts("Sin marca"), v: ctxBrandId() },
        { k: "brief", l: "Brief de origen", t: "select", opts: [["", "— sin brief —"]].concat(bs.map(function (b) { return [b.id, b.title]; })) },
        { k: "budget", l: "Presupuesto", t: "number" },
        { k: "start", l: "Inicio", t: "date", v: day(0) }, { k: "end", l: "Entrega", t: "date" },
        { k: "hours", l: "Horas planificadas", t: "number" },
      ];
    },
    check: function (v) { return v.end && v.start && v.end < v.start ? "La entrega no puede ser antes del inicio" : null; },
    save: function (v) { return ins("workspace_projects", { workspace_id: ws(), name: v.name, brand_id: v.brand || null, brand_name: brandName(v.brand), brief_id: v.brief || null, budget: v.budget || 0, starts_on: v.start || null, ends_on: v.end || null, hours_planned: v.hours || 0, status: "Planificando", created_by: uid() }); },
    ok: "Proyecto creado",
  };

  var COL_ST = { "Por hacer": "backlog", "En curso": "design", "En revisión": "review", "Hecho": "done" };
  C.tarea = {
    title: "Nueva tarea", sub: "Aparece en Mi trabajo de quien la tenga asignada.",
    fields: function (ctx) {
      return [
        { k: "title", l: "Título", req: true, full: true },
        { k: "brand", l: "Marca", t: "select", opts: brandOpts("Sin marca"), v: ctxBrandId() },
        { k: "type", l: "Tipo", t: "select", opts: [["post", "Post"], ["banner", "Banner"], ["deck", "Presentación"], ["landing", "Landing"], ["template", "Plantilla"], ["cotizacion", "Cotización"], ["other", "Otro"]] },
        { k: "who", l: "Responsable", t: "select", opts: people().length ? people() : [[uid(), "Yo"]], v: uid() },
        { k: "due", l: "Fecha límite", t: "date" },
        { k: "status", l: "Columna", t: "select", opts: [["backlog", "Por hacer"], ["design", "En curso"], ["review", "En revisión"], ["done", "Hecho"]], v: COL_ST[ctx.col] || "backlog" },
        { k: "prio", l: "Prioridad", t: "select", opts: [["1", "Alta"], ["2", "Media"], ["3", "Baja"]], v: "2" },
        { k: "fmt", l: "Formato", ph: "Ej.: 1080×1350" },
        { k: "brief", l: "Detalle", t: "textarea", rows: 3 },
      ];
    },
    save: function (v) { return ins("design_kanban_tasks", { id: "task_" + hex(16), workspace_id: ws(), account_id: uid(), created_by: uid(), title: v.title, brand_id: v.brand || null, type: v.type, format: v.fmt || null, status: v.status, priority: +v.prio, deadline: v.due || null, brief: v.brief || null, assigned_to: v.who || uid(), source: "manual" }); },
    ok: "Tarea creada",
  };

  C.agente = {
    title: "Nuevo agente", sub: "Un agente de IA de tu equipo con sus permisos por área. Usa el modelo de tus propias llaves (Integraciones).",
    fields: function () {
      var models = (typeof INTS !== "undefined" ? INTS.filter(function (i) { return i.cat === "Chat IA" && i.st === "ok"; }).map(function (i) { return [i.name, i.name]; }) : []);
      var lv = typeof PERM_LV !== "undefined" ? PERM_LV : [["no", "No"], ["ver", "Ver"], ["crear", "Crear"]];
      return [
        { k: "name", l: "Nombre", req: true, ph: "Ej.: Luna" },
        { k: "role", l: "Rol", ph: "Ej.: Community de Bloom" },
        { k: "tpl", l: "Plantilla", t: "select", opts: (typeof AG_TPL !== "undefined" ? Object.keys(AG_TPL).filter(function (k) { return k !== "musa"; }).map(function (k) { return [k, AG_TPL[k][0] + " · " + AG_TPL[k][1]]; }) : [["claude", "Claude Code"]]), full: true },
        { k: "model", l: "Modelo", t: "select", req: true, opts: models.length ? models : [["", "— conecta una IA en Integraciones —"]] },
        { k: "color", l: "Color", t: "color", v: "#2f6fed" },
        { k: "brands", l: "Marcas que puede tocar (ninguna = todas)", t: "checks", opts: brands() },
      ].concat((typeof AG_PERMS !== "undefined" ? AG_PERMS : []).map(function (p) { return { k: "p_" + p[0], l: p[1], t: "select", opts: lv, v: "ver" }; }));
    },
    save: function (v) {
      var perms = {}; Object.keys(v).forEach(function (k) { if (k.indexOf("p_") === 0) perms[k.slice(2)] = v[k]; });
      return ins("workspace_agents", { workspace_id: ws(), name: v.name, role: v.role || "Agente del equipo", template: v.tpl, model: v.model, color: v.color, os: "Linux", state: "idle", brands: v.brands.map(brandName).filter(Boolean), permissions: perms, wake: "Solo a pedido (chat)", task: "Listo · esperando su primera tarea" });
    },
    ok: function (v) { return "Agente «" + v.name + "» creado"; },
    after: function (r) { loadAgents().then(function () { if (r && r.id) location.hash = "agentes/chats/wa_" + r.id; }); },
  };

  C.apikey = {
    title: "Nueva llave del workspace", sub: "Para conectar una IA por MCP o tus sistemas por API. La verás una sola vez: guárdala.",
    fields: [
      { k: "label", l: "Nombre", req: true, ph: "Ej.: Claude de Renzo" },
      { k: "kind", l: "Uso", t: "select", opts: [["mcp", "IA por MCP (todo el workspace)"], ["rest", "API / webhooks"]] },
      { k: "role", l: "Permiso", t: "select", opts: [["editor", "Editor"], ["viewer", "Solo lectura"], ["admin", "Admin"]] },
    ],
    save: function (v) { return api("/api/workspaces/" + encodeURIComponent(ws()) + "/api-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: v.label, kind: v.kind, role: v.role }) }); },
    ok: "Llave creada", noReload: true,
    after: function (r) {
      var k = r && (r.key || r.rawKey || (r.data && (r.data.key || r.data.rawKey)));
      if (RR().loadKeys) RR().loadKeys();
      if (k) mx("Tu llave nueva", "Cópiala ahora: por seguridad no se vuelve a mostrar.", '<input class="fx-in" readonly value="' + esc(k) + '" id="mbKey"><div class="ag-ctl" style="margin-top:10px"><button class="pri" data-a="copy">Copiar</button></div>', function (e) { if (e.target.closest('[data-a="copy"]')) { var i = document.getElementById("mbKey"); i.select(); try { navigator.clipboard.writeText(i.value); } catch (x) { document.execCommand("copy"); } uiToast("Copiada"); } });
      go();
    },
  };

  /* ───────── datos que la maqueta no cargaba: playbooks, agentes y clones ───────── */
  function loadPlaybooks() {
    if (typeof PB === "undefined") return Promise.resolve();
    return get(q("workspace_playbooks", "id,category,name,description,steps,uses", "&order=updated_at.desc&limit=100")).then(function (rows) {
      PB.length = 0;
      (rows || []).forEach(function (p) { PB.push({ id: "pb_" + p.id, db: p.id, cat: p.category || "General", name: p.name, d: p.description || "", uses: p.uses || 0, steps: (p.steps || []).map(function (s) { return [s.d || 0, s.t || "", s.link || "planear/calendario", s.who || ""]; }) }); });
      if (typeof PBS !== "undefined" && PB.length && !PB.some(function (x) { return x.id === PBS.sel; })) PBS.sel = PB[0].id;
    });
  }
  function loadAgents() {
    if (typeof AGENTS === "undefined" || typeof AGX === "undefined") return Promise.resolve();
    return get(q("workspace_agents", "id,name,color,role,template,model,os,state,brands,permissions,wake,task", "&order=created_at.asc&limit=50")).then(function (rows) {
      for (var i = AGENTS.length - 1; i >= 0; i--) if (AGENTS[i]._db) AGENTS.splice(i, 1);
      (rows || []).forEach(function (a) { var x = AGX({ id: "wa_" + a.id, ws: ws(), name: a.name, color: a.color || "#111", role: a.role || "", tpl: a.template || "claude", model: a.model || "", os: a.os || "Linux", state: a.state || "idle", brands: a.brands && a.brands.length ? a.brands : ["Todas"], perms: a.permissions || {}, wake: a.wake || "Solo a pedido (chat)", task: a.task || "", url: "" }); x._db = a.id; AGENTS.push(x); });
    });
  }
  /* Clones: registro propio en workspace_clones (lista instantánea y visible para agentes); se sincroniza con HeyGen/ElevenLabs */
  function cloneTile(c) { var musa = c.provider === "musa"; return [esc(c.name), c.kind === "avatar" ? (c.status === "listo" ? (musa ? "Avatar + voz listo" : "Avatar listo") : c.status === "error" ? "Avatar · error" : (musa ? "Avatar · preparando" : "Avatar · entrenando")) : "Solo voz", musa ? "Musa" : c.provider === "heygen" ? "HeyGen" : "ElevenLabs"]; }
  /* filas reales alineadas con TILES["crear/clones"] (el detalle real las usa: bridge-clones.js) */
  window.__musaCloneRows = window.__musaCloneRows || [];
  function registerClone(c) {
    return ins("workspace_clones", Object.assign({ workspace_id: ws(), consent: true, created_by: uid() }, c)).then(function (row) { TILES["crear/clones"].unshift(cloneTile(row || c)); window.__musaCloneRows.unshift(row || c); return row; });
  }
  window.__musaRegisterClone = registerClone;
  window.__musaReloadClones = function () { clonesWs = null; loadClones(); };
  var clonesWs = null, clonesSynced = {};
  function loadClones() {
    if (clonesWs === ws() || typeof TILES === "undefined") return;
    clonesWs = ws(); var W = ws();
    get(q("workspace_clones", "id,name,kind,provider,external_id,status", "&order=created_at.desc&limit=200")).then(function (rows) {
      rows = rows || []; TILES["crear/clones"] = rows.map(cloneTile); window.__musaCloneRows = rows;
      if (route.mod === "crear" && route.sub === "clones") go();
      if (clonesSynced[W]) return; clonesSynced[W] = 1;
      /* sincronización con los proveedores, cada uno por su lado (si uno falla, el otro sigue):
         · ElevenLabs: voces clonadas fuera de Musa.
         · HeyGen: el servidor trae SOLO los clones propios (ownership=private), no los avatares de catálogo. */
      var recargar = function () { clonesWs = null; loadClones(); };
      get("/api/elevenlabs/voices").then(function (r) {
        var have = {}; rows.forEach(function (x) { if (x.external_id) have[x.provider + ":" + x.external_id] = x; });
        var jobs = [];
        ((r && r.voices) || []).filter(function (v) { return /clon|generated|professional/i.test(v.category || ""); }).forEach(function (v) {
          var id = v.voice_id || v.voiceId || v.id; if (id && !have["elevenlabs:" + id]) jobs.push(ins("workspace_clones", { workspace_id: W, kind: "voz", provider: "elevenlabs", external_id: id, name: v.name || "Voz", status: "listo", preview_url: v.preview_url || v.previewUrl || null }));
        });
        if (jobs.length) Promise.all(jobs.map(function (j) { return j.catch(function () {}); })).then(recargar);
      }, function () { /* sin llave de ElevenLabs */ });
      api("/api/musa-clon/heygen/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: W }) })
        .then(function (r) { if (r && (r.nuevos || r.actualizados)) recargar(); }, function () { /* sin llave de HeyGen */ });
    });
  }
  var extraWs = null;
  function loadExtras() { if (extraWs === ws()) return; extraWs = ws(); loadPlaybooks().then(loadAgents).then(function () { if (!(ED && ED.open) && !(VE && VE.open) && !(FL && FL.open)) go(); }); }

  /* ───────── qué abre cada botón ───────── */
  var HEADER = {
    /* en el cerebro la acción primaria es crear una nota, no una pieza */
    "inicio/cerebro": ["nota", "Nueva nota"], "inicio": ["pieza", "Nueva pieza"], "planear/calendario": ["pieza", "Nueva pieza"], "planear/investigacion": ["fuente", "Nueva fuente"], "planear/briefs": ["brief", "Nuevo brief"], "planear/playbooks": ["playbook", "Nuevo playbook"],
    "crear/marcas": ["marca", "Nueva marca"], "crear/videos": ["video", "Nuevo video"], "crear/clones": ["clon", "Nuevo clon"], "crear/eventos": ["evento", "Nuevo evento"], "crear/mailing": [null, "Nuevo mailing"], "crear/formularios": ["form", "Nuevo formulario"], "crear/automatizaciones": ["flow", "Nueva automatización"],
    "conversar": ["mensaje", "Nuevo mensaje"], "anunciar": ["ads", "Nueva campaña de ads"],
    "vender": ["oportunidad", "Nueva oportunidad"], "vender/personas": ["persona", "Nueva persona"], "vender/empresas": ["marca", "Nueva marca"], "vender/cotizaciones": ["cotizacion", "Nueva cotización"],
    "clientes/briefs": ["brief", "Nuevo brief"], "clientes/cotizaciones": ["cotizacion", "Nueva cotización"], "clientes/fees": ["fee", "Nuevo fee"], "clientes/proyectos": ["proyecto", "Nuevo proyecto"],
    "agentes": ["agente", "Nuevo agente"],
  };
  /* botón «Importar piezas» junto a «Nueva pieza» en Planear › Calendario */
  setInterval(function () {
    try {
      if (typeof route === "undefined" || route.mod + "/" + route.sub !== "planear/calendario") return;
      var a = document.querySelector("#view .head .actions, .head .actions"); if (!a || a.querySelector('[data-imp="piezas"]')) return;
      var b = document.createElement("button"); b.type = "button"; b.className = "btn"; b.setAttribute("data-imp", "piezas"); b.textContent = "Importar piezas";
      b.title = "Crea varias piezas de una vez pegando una tabla (CSV o Markdown)";
      var p = a.querySelector(".btn-p"); if (p) a.insertBefore(b, p); else a.appendChild(b);
    } catch (e) {}
  }, 700);
  function headerFor() { var k = route.mod + "/" + route.sub; return HEADER[k] || HEADER[route.mod] || null; }
  function colName(el) { var h = el.closest(".col-h"); return h ? h.firstChild.textContent.trim() : ""; }
  function mailNew() { return typeof ML !== "undefined" && ML.tab === "secuencias" ? "secuencia" : "mailing"; }

  function match(t) {
    var key = route.mod + "/" + route.sub, b;
    if (t.closest(".head .actions .btn-p")) { var h = headerFor(); if (!h) return null; return { c: h[0] || mailNew() }; }
    if ((b = t.closest(".fx-menu [data-cm]"))) return { design: { c: "diseno" }, deck: { c: "deck" }, video: { c: "video" } }[b.dataset.cm] || null;
    if ((b = t.closest(".col-add"))) {
      if (key === "inicio/mi-trabajo") return { c: "tarea", ctx: { col: colName(b) } };
      if (key === "vender/oportunidades") return { c: "oportunidad", ctx: { col: colName(b) } };
      if (key === "crear/automatizaciones") return { c: "flow" };
      return null;
    }
    if (t.closest('[data-imp="piezas"]')) return { c: "piezasImport" };
    if (t.closest('[data-bra="new"]')) return { c: "nota" };
    if (t.closest('[data-mla="new"]')) return { c: "mailing" };
    if (t.closest('[data-sqa="new"]')) return { c: "secuencia" };
    if (t.closest('[data-ada="new"]')) return { c: "ads" };
    if (t.closest('[data-ba="new"]')) return { c: "brief" };
    if (t.closest('[data-pa="new"]')) return { c: "playbook" };
    if (t.closest("#crmAddB")) return { c: "marca" };
    if ((b = t.closest('.fx-bar [data-fx="voice"], .fx-bar [data-fx="avatar"]')) && key === "crear/clones") return { c: "clon", ctx: { kind: b.dataset.fx === "voice" ? "voz" : "avatar" } };
    if (t.closest('[data-cx="new"]')) return { c: "apikey" };
    if (t.closest('a[href="#agentes/chats/nuevo"]')) return { c: "agente" };
    if (t.closest('a[href="#crear/eventos/nuevo"]')) return { c: "evento" };
    if ((b = t.closest('[data-ba="quote"]')) && typeof BRIEFS !== "undefined") { var br = BRIEFS.find(function (x) { return typeof CL !== "undefined" && x.id === CL.brief; }); return { c: "cotizacion", ctx: { title: br && br.name, brand: br && RR().brandId[br.brand] } }; }
    /* los botones «Seleccionar» / «Mover» de la tarjeta no abren la cotización */
    if (key === "vender/oportunidades" && (b = t.closest(".kc")) && !t.closest(".mv-tools, .wtag") && !b.querySelector(".pill")) { var tt = (b.querySelector("b") || {}).textContent || ""; return { c: "cotizacion", ctx: { deal: b.dataset.db || tt.trim() } }; }
    return null;
  }

  document.addEventListener("click", function (e) {
    var R = RR(); if (!R || !R.on || !e.target.closest) return;
    var m = match(e.target); if (!m || !C[m.c]) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    document.querySelectorAll(".fx-menu").forEach(function (x) { x.remove(); });
    open(C[m.c], m.ctx);
  }, true);

  /* rutas «/nuevo» de la maqueta (formularios de página completa) → el popup */
  window.addEventListener("hashchange", function () {
    var R = RR(); if (!R || !R.on) return;
    var h = location.hash.replace("#", "");
    var to = { "agentes/chats/nuevo": ["agente", "agentes/chats"], "crear/eventos/nuevo": ["evento", "crear/eventos"] }[h];
    if (to) { history.replaceState(null, "", "#" + to[1]); go(); open(C[to[0]]); }
  });

  /* el botón de la cabecera dice lo que crea en cada sección; datos extra al entrar */
  var _dv = drawView;
  drawView = function () {
    var r = _dv.apply(this, arguments), R = RR();
    try {
      if (R && R.on) {
        loadExtras();
        if (route.mod === "crear" && route.sub === "clones") loadClones();
        var h = headerFor(), act = document.querySelector(".head .actions .btn-p");
        if (h && act && h[1] && !(route.mod === "crear" && route.sub === "mailing")) act.textContent = h[1];
      }
    } catch (x) {}
    return r;
  };
  var _ws = typeof wsSwitch === "function" ? wsSwitch : null;
  if (_ws) wsSwitch = function () { extraWs = null; clonesWs = null; return _ws.apply(this, arguments); };

  window.__musaCreate = { open: function (k, ctx) { return open(C[k], ctx); }, C: C };
})();
