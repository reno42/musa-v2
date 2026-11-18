/* bridge-clones.js — REQ-072: Crear › Clones IA real.
 * · Clones propios de Musa (avatar + voz con el motor de Musa): solo plan Empresa.
 * · Clones de HeyGen con la llave de cada persona: se traen a Musa (solo los privados),
 *   el video lo genera HeyGen y Musa lo importa y lo coloca en su editor de video.
 * Usa solo componentes de la maqueta (ws-note, detail, kv, fx-row, fx-in, fx-lbl, meter,
 * ag-ctl, pill). API: /api/musa-clon/*.
 */
(function boot(n) {
  "use strict";
  var RB = window.__musaReal;
  if (!RB || typeof detail !== "function" || typeof TILES === "undefined" || typeof kv !== "function" || typeof viewHooks4 !== "function") {
    if ((n || 0) < 800) setTimeout(function () { boot((n || 0) + 1); }, 150);
    return;
  }
  if (window.__musaClonMod) return;
  window.__musaClonMod = true;

  function host() { try { return window.parent !== window ? window.parent : null; } catch (e) { return null; } }
  function bridge() { var h = host(); try { return h && h.__musaBridge; } catch (e) { return null; } }
  function api(path, init) { var b = bridge(); if (!b) return Promise.reject(new Error("sin puente")); return b.api(path, Object.assign({ timeoutMs: 120000 }, init || {})); }
  function post(path, body) { return api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function ws() { return RB.ws || ""; }
  function toast(m) { if (typeof uiToast === "function") uiToast(m); }
  function msg(e) { return (e && (e.message || e.error)) || String(e || "error"); }
  function fecha(iso) { try { return new Date(iso).toLocaleString("es-PE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } }
  function irA(hash) { try { (window.parent && window.parent !== window ? window.parent : window).location.hash = hash; } catch (e) { location.hash = hash; } }

  /* ── estado del espacio: plan, HeyGen conectado, motor y almacenamiento ── */
  var EST = { ws: null, data: null, p: null };
  function estado(fresco) {
    if (!fresco && EST.ws === ws() && EST.p) return EST.p;
    EST.ws = ws();
    EST.p = api("/api/musa-clon/estado?ws=" + encodeURIComponent(ws())).then(function (d) { EST.data = d; return d; }, function () { EST.data = null; return null; });
    return EST.p;
  }
  window.__musaClonEstado = estado;

  /* ── aviso en Crear › Clones IA ── */
  function aviso() {
    var body = document.getElementById("body");
    if (!body || body.dataset.detail || document.getElementById("clNote")) return;
    var box = document.createElement("div");
    box.className = "ws-note"; box.id = "clNote";
    box.innerHTML = "Cargando…";
    var barra = body.querySelector(".fx-bar");
    if (barra && barra.nextSibling) body.insertBefore(box, barra.nextSibling); else body.insertBefore(box, body.firstChild);
    estado(true).then(function (e) {
      if (!document.body.contains(box)) return;
      var hab = e && e.habilitado, hg = e && e.heygen;
      var btn = function (k, t, pri) { return '<button class="btn ' + (pri ? "btn-p" : "btn-g") + '" style="margin:8px 8px 0 0" data-cln="' + k + '">' + t + "</button>"; };
      box.innerHTML = (hab
        ? "<b>Clones propios de Musa</b> incluidos en tu plan Empresa: tu avatar y tu voz, generados por Musa, desde una toma o una foto. También puedes usar tus clones de HeyGen."
        : "<b>Clones propios de Musa</b>: habilitados para el plan Empresa. Mientras tanto, conecta tu API de HeyGen y trae todos tus clones a Musa: cada video lo genera HeyGen y Musa lo coloca en tu editor de video.")
        + "<div>" + (hab ? "" : btn("planes", "Ver plan Empresa", true))
        + (hg ? btn("sync", "Traer mis clones de HeyGen", hab) : btn("heygen", "Conectar HeyGen", hab)) + "</div>";
      box.onclick = function (ev) {
        var b = ev.target.closest("[data-cln]"); if (!b) return;
        var k = b.dataset.cln;
        if (k === "planes") return irA("#configuracion/espacios");
        if (k === "heygen") return irA("#configuracion/integraciones");
        if (k === "sync") {
          b.disabled = true; b.textContent = "Trayendo tus clones…";
          return post("/api/musa-clon/heygen/sync", { workspaceId: ws() }).then(function (r) {
            toast(r.total ? "HeyGen: " + r.total + " clon" + (r.total === 1 ? "" : "es") + (r.nuevos ? " · " + r.nuevos + " nuevo" + (r.nuevos === 1 ? "" : "s") : " · ya estaban todos") : "No hay clones propios en tu cuenta de HeyGen");
            if (window.__musaReloadClones) window.__musaReloadClones();
          }, function (x) { toast("HeyGen: " + msg(x)); b.disabled = false; b.textContent = "Traer mis clones de HeyGen"; });
        }
      };
    });
  }
  var _vh = viewHooks4;
  viewHooks4 = function (key) {
    _vh.apply(this, arguments);
    if (key === "crear/clones") aviso();
  };

  /* ── detalle real ── */
  var D = { id: null, clone: null, jobs: [], timer: null, busy: false, voces: null, stock: null, form: { script: "", voz: "self", aspect: "9:16", title: "" } };
  function rows() { return window.__musaCloneRows || []; }
  function stopTimer() { if (D.timer) { clearTimeout(D.timer); D.timer = null; } }
  function abierto(id) { var b = document.getElementById("body"); return D.id === id && b && b.dataset.detail && b.querySelector('[data-clon="' + id + '"]'); }

  var _cloneDetail = typeof cloneDetail === "function" ? cloneDetail : null;
  cloneDetail = function (i) {
    var row = rows()[i];
    if (!row) return _cloneDetail ? _cloneDetail(i) : null;
    stopTimer();
    if (row.provider !== "musa" && row.provider !== "heygen") return soloVoz(row);
    D.id = row.id; D.clone = null; D.jobs = []; D.form = { script: "", voz: "self", aspect: "9:16", title: "" };
    pintar();
    cargar(row.id);
  };

  function soloVoz(row) {
    detail("Clones IA", esc(row.name), "Voz · ElevenLabs",
      kv([["Proveedor", "ElevenLabs (con tu llave en Integraciones)"], ["Tipo", "Solo voz"], ["Estado", esc(row.status || "")]])
      + '<p style="color:var(--muted);font-size:13px;margin-top:12px">Usa esta voz en Crear › Voces o en el editor de video.</p>');
  }

  function cargar(id) {
    return Promise.all([
      api("/api/musa-clon/clones?ws=" + encodeURIComponent(ws())).catch(function () { return { clones: [] }; }),
      api("/api/musa-clon/jobs?cloneId=" + encodeURIComponent(id)).catch(function () { return { jobs: [] }; }),
      estado(),
    ]).then(function (r) {
      if (D.id !== id) return;
      D.clone = ((r[0] && r[0].clones) || []).find(function (c) { return c.id === id; }) || null;
      D.jobs = (r[1] && r[1].jobs) || [];
      if (D.clone && D.clone.provider === "musa" && D.clone.status === "listo" && !D.voces) cargarVoces();
      pintar();
      programar(id);
    });
  }
  function cargarVoces() {
    Promise.all([api("/api/musa-voz/stock").catch(function () { return null; }), api("/api/musa-voz/voces").catch(function () { return null; })]).then(function (r) {
      D.stock = (r[0] && r[0].stock) || [];
      D.voces = (r[1] && r[1].mias) || [];
      if (D.clone) pintar();
    });
  }
  function programar(id) {
    stopTimer();
    var vivo = (D.clone && D.clone.status === "entrenando") || D.jobs.some(function (j) { return j.status === "queued" || j.status === "running"; });
    if (vivo) D.timer = setTimeout(function () { if (abierto(id)) cargar(id); }, 10000);
  }

  function jobEstado(j) {
    if (j.status === "done") return '<span class="pill ok">Listo</span>';
    if (j.status === "error") return '<span class="pill">Error</span>';
    if (j.status === "cancelled") return '<span class="pill">Cancelado</span>';
    if (j.status === "running") return '<span class="pill hot">' + (j.provider === "heygen" ? "HeyGen generando" : "Generando") + " · " + (j.progress || 0) + " %</span>";
    return '<span class="pill">En cola' + (j.position ? " · puesto " + j.position : "") + "</span>";
  }

  function vocesOpts() {
    var c = D.clone, o = [];
    if (c && c.voice_id) o.push(["self", "Su voz clonada (de la toma)"]);
    (D.voces || []).forEach(function (v) { if (!c || v.id !== c.voice_id) o.push(["voz:" + v.id, v.nombre + (v.proveedor === "elevenlabs" ? " · ElevenLabs" : v.tipo === "clon" ? " · clon" : "")]); });
    (D.stock || []).forEach(function (cat) { (cat.speakers || []).forEach(function (s) { o.push(["stock:" + cat.idioma + ":" + s.id, s.nombre + " · " + (cat.idioma === "en" ? "inglés" : "español") + " · " + s.rasgo]); }); });
    if (!o.length) o.push(["stock:es:carina", "Carina · español"]);
    if (!o.some(function (x) { return x[0] === D.form.voz; })) D.form.voz = o[0][0];
    return o.map(function (x) { return '<option value="' + esc(x[0]) + '"' + (x[0] === D.form.voz ? " selected" : "") + ">" + esc(x[1]) + "</option>"; }).join("");
  }

  function pintar() {
    var row = rows().find(function (r) { return r.id === D.id; }) || {};
    var c = D.clone || row, name = c.name || "Clon", heygen = c.provider === "heygen";
    var e = EST.data || {}, hab = !!e.habilitado;
    var prep = D.jobs.find(function (j) { return j.kind === "prepare"; });
    var listo = c.status === "listo", error = c.status === "error";
    var foto = c.portrait_url
      ? '<img src="' + esc(c.portrait_url) + '" alt="' + esc(name) + '" style="width:170px;height:170px;border-radius:50%;object-fit:cover;object-position:50% 30%">'
      : '<div style="width:150px;height:150px;border-radius:50%;background:linear-gradient(#ff5e00,#c24800);display:grid;place-items:center;color:#fff;font:400 60px var(--serif)">' + esc((name[0] || "C").toUpperCase()) + "</div>";
    var estadoBox = listo ? '<small style="color:#aaa;font-size:11px">' + (heygen ? "Listo en HeyGen" : "Listo para hablar tus guiones") + "</small>"
      : error ? '<small style="color:#ff8a65;font-size:12px">' + esc((c.meta && c.meta.error) || (prep && prep.error) || "No se pudo preparar el clon.") + "</small>"
      : heygen ? '<small style="color:#aaa;font-size:11px">HeyGen todavía lo está entrenando</small>'
      : '<div style="width:100%"><div class="meter hot"><i style="width:' + Math.max(4, (prep && prep.progress) || 0) + '%"></i></div><small style="color:#aaa;font-size:11px">Preparando · ' + ((prep && prep.status === "running") ? (prep.progress || 0) + " %" : "en cola") + "</small></div>";
    var MB = function (b) { return Math.round((b || 0) / 1048576) + " MB"; };
    var alm = e.almacenamiento;
    var guardado = alm ? MB(alm.espacio) + " de " + (alm.topeEspacio >= 1073741824 ? (alm.topeEspacio / 1073741824).toFixed(1).replace(".", ",") + " GB" : MB(alm.topeEspacio)) : "—";
    var info = heygen
      ? kv([["Proveedor", "HeyGen · con tu llave (el video lo genera HeyGen y Musa lo trae a tu editor)"], ["Voz", "La de tu clon en HeyGen"], ["Guardado en Musa", esc(guardado)]])
      : kv([
        ["Tipo", "Avatar + voz · Motor Musa (plan Empresa)"],
        ["Fuente", c.source_kind === "photo" ? "Foto" : "Toma del estudio"],
        ["Voz", esc(c.voice_id ? "Voz clonada desde la toma" : "Sin voz propia: usa una voz de Musa o ElevenLabs")],
        ["Video de hoy", esc(e.cuota ? Math.round(e.cuota.usado) + " de " + e.cuota.limite + " s" : "—")],
        ["Guardado", esc(guardado)],
      ]) + '<label class="fx-lbl">Consentimiento</label>' + (typeof chk === "function"
        ? chk(1, "Autorizado el " + esc(fecha(c.consent_at || c.created_at)), "Borrar el clon revoca el permiso y elimina sus archivos")
        : "<p>Autorizado</p>");

    var puedeGenerar = listo && (heygen ? !!e.heygen : hab);
    var bloqueo = !listo ? "" : heygen && !e.heygen
      ? '<p class="ws-note" style="margin-top:14px">Conecta tu API de HeyGen para generar videos con este clon. <button class="btn btn-g" data-cl="heygen">Conectar HeyGen</button></p>'
      : !heygen && !hab
        ? '<p class="ws-note" style="margin-top:14px"><b>Clones propios de Musa</b>: habilitados para el plan Empresa. <button class="btn btn-p" data-cl="planes">Ver plan Empresa</button></p>'
        : "";
    var gen = !puedeGenerar ? bloqueo : '<label class="fx-lbl" style="margin-top:16px">Generar video desde un guion</label>'
      + '<textarea class="fx-in" id="clScript" rows="4" maxlength="' + (heygen ? 5000 : 1500) + '" placeholder="Escribe lo que va a decir tu clon…">' + esc(D.form.script) + "</textarea>"
      + '<div style="display:grid;grid-template-columns:' + (heygen ? "1fr" : "2fr 1fr") + ';gap:8px;margin-top:8px">' + (heygen ? "" : '<select class="fx-in" id="clVoz">' + vocesOpts() + "</select>") + '<select class="fx-in" id="clAspect">'
      + ["9:16", "1:1", "16:9"].map(function (a) { return "<option" + (a === D.form.aspect ? " selected" : "") + ">" + a + "</option>"; }).join("") + "</select></div>"
      + '<input class="fx-in" id="clTitle" style="margin-top:8px" placeholder="Título (opcional)" value="' + esc(D.form.title) + '">'
      + '<div class="ag-ctl" style="margin-top:8px"><button class="pri" data-cl="gen"' + (D.busy ? " disabled" : "") + ">" + (D.busy ? (heygen ? "Enviando a HeyGen…" : "Preparando la voz…") : (heygen ? "Generar con HeyGen" : "Generar video")) + "</button></div>"
      + (heygen ? '<small style="color:#888;font-size:11px">Usa créditos de tu cuenta de HeyGen. Al terminar, Musa guarda el video y lo puedes llevar a tu editor.</small>' : "");

    var vids = D.jobs.filter(function (j) { return j.kind === "render"; });
    var lista = !vids.length ? "" : '<label class="fx-lbl" style="margin-top:16px">Videos</label>' + vids.map(function (j) {
      var player = j.status === "done" && j.video_url
        ? '<video src="' + esc(j.video_url) + '"' + (j.poster_url ? ' poster="' + esc(j.poster_url) + '"' : "") + ' controls playsinline preload="metadata" style="width:100%;max-width:280px;border-radius:12px;background:#000;margin-top:8px"></video>'
          + '<div class="ag-ctl" style="margin-top:6px"><button class="pri" data-cl="editor" data-j="' + esc(j.id) + '">Llevar al editor</button><a class="btn btn-g" href="' + esc(j.video_url) + '" download target="_blank" rel="noopener">Descargar</a><button data-cl="copy" data-u="' + esc(j.video_url) + '">Copiar enlace</button></div>'
        : j.status === "running" ? '<div class="meter hot" style="margin-top:8px"><i style="width:' + Math.max(3, j.progress || 0) + '%"></i></div>' : "";
      var err = j.status === "error" ? '<small style="color:#ff8a65;display:block">' + esc(j.error || "") + "</small>" : "";
      var accion = j.status === "queued" ? ' <button class="btn btn-g" style="padding:2px 10px;font-size:11px" data-cl="cancel" data-j="' + esc(j.id) + '">Cancelar</button>'
        : (j.status === "done" || j.status === "error" || j.status === "cancelled") ? ' <button class="btn btn-g" style="padding:2px 10px;font-size:11px" data-cl="delvid" data-j="' + esc(j.id) + '">Borrar</button>' : "";
      return '<div style="border-top:1px solid #222;padding:10px 0"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b style="font-size:13px">' + esc(j.title || "Video") + "</b><span>" + jobEstado(j) + accion + "</span></div>"
        + '<small style="color:#888;font-size:11px">' + esc(fecha(j.created_at)) + (j.seconds ? " · " + Math.round(j.seconds) + " s" : "") + (j.provider === "heygen" ? " · HeyGen" : "") + "</small>" + err + player + "</div>";
    }).join("");

    var tag = heygen ? "HeyGen · " + (listo ? "listo" : error ? "error" : "entrenando") : "Clon Musa · " + (listo ? "listo" : error ? "error" : "preparando");
    detail("Clones IA", esc(name), tag,
      '<div class="fx-row" data-clon="' + esc(D.id) + '"><div style="display:flex;flex-direction:column;align-items:center;gap:12px;background:#111;border-radius:14px;padding:20px">' + foto + estadoBox + "</div>"
      + "<div>" + info + gen + lista + "</div></div>"
      + (heygen ? "" : '<div class="ag-ctl" style="margin-top:12px"><button data-cl="del">Borrar clon y revocar permiso</button></div>'),
      onClick);
    var body = document.getElementById("body");
    if (body) {
      body.oninput = function (ev) { if (ev.target.id === "clScript") D.form.script = ev.target.value; if (ev.target.id === "clTitle") D.form.title = ev.target.value; };
      body.onchange = function (ev) { if (ev.target.id === "clVoz") D.form.voz = ev.target.value; if (ev.target.id === "clAspect") D.form.aspect = ev.target.value; };
    }
  }

  /* El video ya está en Musa (URL estable): se crea un proyecto en el editor con ese clip y se abre */
  function alEditor(j) {
    var R = window.__musaReal || {}, dims = { "9:16": [1080, 1920], "16:9": [1920, 1080], "1:1": [1080, 1080] }[j.aspect] || [1080, 1920];
    var name = (j.title || "Video con clon").slice(0, 80), dur = Number(j.seconds) || 10;
    toast("Creando el video en tu editor…");
    return api("/api/video-projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: ws(), name: name, ratio: j.aspect || "9:16", canvasW: dims[0], canvasH: dims[1], fps: 30 }) })
      .then(function (x) {
        var id = x && x.data && x.data.project && x.data.project.id;
        if (!id) throw new Error("no se creó el proyecto");
        if (!R.openVideo) throw new Error("el editor no está disponible");
        /* igual que «Video nuevo» del editor: se registra en la lista y se abre en la posición 0 */
        (R.vids = R.vids || []).unshift({ id: id, name: name, ratio: j.aspect || "9:16", duration_us: Math.round(dur * 1e6) });
        if (TILES["crear/videos"]) TILES["crear/videos"].unshift([esc(name), "Sin marca", "0:00"]);
        if (typeof VE_DOCS !== "undefined") Object.keys(VE_DOCS).forEach(function (k) { if (/^videos\//.test(k)) delete VE_DOCS[k]; });
        R.openVideo(id, 0);
        var tries = 0;
        (function esperar() {
          var listoVE = typeof VE !== "undefined" && VE.open && VE.p && VE.p._real && VE.p._real.id === id;
          if (!listoVE) { if (++tries < 80) return setTimeout(esperar, 250); return toast("Abre el video y agrega el clip desde Medios"); }
          if (typeof vsnap === "function") vsnap();
          VE.p.v1.push(take(RB.takeFor(j.video_url, "Clon · " + name, dur), dur));
          if (typeof veAll === "function") veAll();
          toast("Listo: el video del clon está en tu editor");
        })();
      }).catch(function (x) { toast("Llevar al editor: " + msg(x)); });
  }

  function onClick(ev) {
    var b = ev.target.closest("[data-cl]");
    if (!b) return;
    var a = b.dataset.cl;
    if (a === "planes") return irA("#configuracion/espacios");
    if (a === "heygen") return irA("#configuracion/integraciones");
    if (a === "copy") { try { navigator.clipboard.writeText(b.dataset.u); toast("Enlace copiado"); } catch (x) { toast("No se pudo copiar"); } return; }
    if (a === "editor") { var j = D.jobs.find(function (x) { return x.id === b.dataset.j; }); if (j) alEditor(j); return; }
    if (a === "cancel") return post("/api/musa-clon/jobs/" + encodeURIComponent(b.dataset.j) + "/cancel").then(function () { toast("Cancelado"); cargar(D.id); }, function (x) { toast(msg(x)); });
    if (a === "delvid") {
      if (!confirm("¿Borrar este video de Musa? Si lo agregaste a un proyecto, ahí dejará de verse.")) return;
      return api("/api/musa-clon/jobs/" + encodeURIComponent(b.dataset.j), { method: "DELETE" }).then(function () { toast("Video borrado"); cargar(D.id); }, function (x) { toast(msg(x)); });
    }
    if (a === "del") {
      if (!confirm("¿Borrar este clon? Se eliminan su retrato, sus videos y sus archivos. La voz clonada queda en Crear › Voces.")) return;
      return api("/api/musa-clon/clones/" + encodeURIComponent(D.id), { method: "DELETE" }).then(function () {
        toast("Clon borrado"); stopTimer(); D.id = null;
        if (window.__musaReloadClones) window.__musaReloadClones();
        if (typeof drawView === "function") drawView();
      }, function (x) { toast(msg(x)); });
    }
    if (a === "gen") {
      var script = (D.form.script || "").trim();
      if (!script) return toast("Escribe el guion");
      var heygen = D.clone && D.clone.provider === "heygen";
      var body = { cloneId: D.id, script: script, aspect: D.form.aspect, title: (D.form.title || "").trim() || script.slice(0, 60) };
      if (!heygen) {
        var v = D.form.voz || "self";
        if (v === "self") body.vozId = D.clone && D.clone.voice_id;
        else if (v.indexOf("voz:") === 0) body.vozId = v.slice(4);
        else if (v.indexOf("stock:") === 0) { var p = v.split(":"); body.idioma = p[1]; body.speaker = p[2]; }
      }
      D.busy = true; pintar();
      return post("/api/musa-clon/videos", body).then(function (r) {
        D.busy = false; D.form.script = ""; D.form.title = "";
        toast(heygen ? "HeyGen está generando tu video; Musa lo trae al terminar" : (r && r.motor && r.motor.online ? "Tu video entró a la cola del motor de Musa" : "Tu video quedó en cola del motor de Musa"));
        cargar(D.id);
      }, function (x) { D.busy = false; pintar(); toast(msg(x)); });
    }
  }
})();
