/* bridge-events.js — Eventos reales: lo que editas se guarda, la portada se sube a tus archivos y la
 * pestaña «Página pública» publica el evento con su enlace propio (/e/<slug>) con inscripción real,
 * botón de Google Calendar y archivo .ics. Al despublicar, el enlace deja de responder.
 */
(function () {
  function RR() { return window.__musaReal; }
  function bridge() { try { return window.parent !== window && window.parent.__musaBridge; } catch (e) { return null; } }
  function api(path, init) { var b = bridge(); if (!b) return Promise.reject(new Error("sin puente")); return b.api(path.charAt(0) === "/" ? path : "/rest/v1/" + path, init); }
  function patch(id, body) { return api("workspace_events?id=eq." + encodeURIComponent(id), { method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(body) }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function origin() { try { return window.parent.location.origin; } catch (e) { return location.origin; } }
  function cur() { var m = location.hash.match(/^#crear\/eventos\/(e_[0-9a-f-]+)/); return m && typeof EV !== "undefined" ? EV.find(function (x) { return x.id === m[1]; }) : null; }
  function slugify(s) { return String(s || "evento").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "evento"; }

  /* guardar lo que se edita en el detalle */
  var tmr = null, pend = {};
  function queue(e, body) {
    Object.assign(pend, body); clearTimeout(tmr);
    tmr = setTimeout(function () { var b = pend; pend = {}; patch(e.db, b).then(function () { uiToast("Guardado"); }, function (x) { uiToast("No se pudo guardar: " + (x && x.message)); }); }, 700);
  }
  document.addEventListener("change", function (ev) {
    var e = cur(); if (!e || !e.db || !RR() || !RR().on) return;
    var t = ev.target, k = t.dataset && t.dataset.evf;
    if (t.id === "evUp" && t.files && t.files[0]) {
      var f = t.files[0];
      var r = new FileReader();
      /* FIX ronda 6: subida directa por la API (headers de sesión del host), sin
         depender de RR().uploadData (bridge-ai): si ese extra no ejecutó, antes
         moría en silencio y la portada nunca se guardaba. */
      r.onload = function () {
        uiToast("Subiendo portada…");
        api("workspace_events?id=eq." + encodeURIComponent(e.db) + "&select=workspace_id").then(function (rows) {
          var wsId = rows && rows[0] && rows[0].workspace_id;
          if (!wsId) throw new Error("no se pudo resolver el espacio del evento");
          return api("/api/assets/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "portada-" + slugify(e.name) + ".jpg", data: String(r.result), workspaceId: wsId }) });
        }).then(function (x) {
          var url = x && (x.url || (x.data && x.data.url));
          if (!url) throw new Error("subida sin URL");
          e.cover = url; queue(e, { cover_url: url });
        }, function (x) { uiToast("No se pudo subir la portada: " + (x && x.message)); });
      };
      r.readAsDataURL(f); return;
    }
    if (!k) return;
    var v = t.value, b = {};
    if (k === "name") b.name = v.trim() || "Evento";
    if (k === "brand") b.brand_id = (RR().brandId || {})[v] || null;
    if (k === "start") { var d = new Date(v); if (!isNaN(d)) { b.starts_at = d.toISOString(); b.date = v.slice(0, 10); } }
    if (k === "plat") {
      b.platform = ["zoom", "meet", "presencial", "hibrido"].indexOf(v) >= 0 ? v : "meet";
      if (v === "zoom" || v === "meet") { b.location = v === "zoom" ? "Zoom" : "Google Meet"; }
      else { /* presencial/hibrido: SOLO tocar location si hay venue escrito; si no, conservar el guardado */ var el = document.querySelector("[data-evf=venue]"); var vv = el && el.value && el.value.trim(); if (vv) b.location = vv; else if (!e.location || /^(zoom|google meet)$/i.test(e.location)) b.location = v === "hibrido" ? "Presencial + sala virtual" : "Presencial"; }
    }
    if (k === "venue") { var pv = document.querySelector("[data-evf=plat]"); var pp = pv ? pv.value : e.plat; if (pp === "presencial" || pp === "hibrido") b.location = v.trim(); }
    if (k === "link") b.link = v.trim() || null;
    if (k === "dur") b.duration_min = Math.max(5, +v || 60);
    if (k === "cap") b.capacity = Math.max(1, +v || 100);
    if (k === "desc") b.description = v;
    if (Object.keys(b).length) queue(e, b);
  }, true);

  /* Página pública real */
  function pageTab(e) {
    var url = e.slug ? origin() + "/e/" + e.slug : null, pub = !!(e.pub && url);
    $("#body").innerHTML = evTabs(e, "pagina")
      + '<div class="ad-f" style="flex-wrap:wrap;gap:8px"><small style="color:var(--muted)">' + (pub ? "Publicado: cualquiera con el enlace ve la página, se inscribe y lo agrega a su calendario." : "Todavía no está publicado. Al publicarlo se crea su enlace y se abren las inscripciones.") + "</small>"
      + '<span style="margin-left:auto;display:flex;gap:6px">' + (pub ? '<button class="btn btn-g" data-evp="copy">⧉ Copiar enlace</button><a class="btn btn-g" href="' + esc(url) + '" target="_blank" rel="noopener" style="display:inline-flex;align-items:center">Abrir ↗</a><button class="btn btn-g" data-evp="story">⬇ Pieza para stories</button><button class="btn btn-g" data-evp="off">Despublicar</button>' : '<button class="btn btn-p" data-evp="on">Publicar evento</button>') + "</span>"
      /* REQ-085: slug editable (humano o IA) con verificación de disponibilidad */
      + '<div style="display:flex;gap:6px;align-items:center;width:100%;flex-wrap:wrap">'
      + '<span style="color:var(--muted);font-size:12px">' + esc(origin().replace(/^https?:\/\//, "")) + "/e/</span>"
      + '<input data-evs="slug" value="' + esc(e.slug || slugify(e.name)) + '" aria-label="Enlace del evento (terminación de la URL)" style="flex:1;min-width:180px;border:1.5px solid var(--e-line2,#35342e);border-radius:9px;padding:6px 10px;font:inherit;background:transparent;color:inherit">'
      + '<button class="btn btn-g" data-evp="slugcheck">Verificar</button>'
      + '<button class="btn btn-g" data-evp="slugsave">Guardar enlace</button>'
      + '<span data-evs="msg" style="font-size:12px;min-width:140px;color:var(--muted)"></span></div></div>' 
      + (pub ? '<div class="lu-page"><div class="lu-bar">🔒 <b>' + esc(url.replace(/^https?:\/\//, "")) + '</b></div><iframe src="' + esc(url) + '" style="width:100%;height:70vh;border:0;display:block;background:#f3f1e7"></iframe></div>'
        : '<div class="lu-page" style="opacity:.55;pointer-events:none"><div class="lu-bar">🔒 <b>' + esc(origin().replace(/^https?:\/\//, "")) + "/e/" + esc(slugify(e.name)) + "…</b></div>" + evCover(e) + '<div class="lu-in"><div><h1>' + esc(e.name) + "</h1></div></div></div>");
    $("#body").onclick = function (ev) {
      var a = ev.target.closest("[data-evp]"); if (!a) return;
      var k = a.dataset.evp;
      if (k === "copy") { try { navigator.clipboard.writeText(url); } catch (x) {} return uiToast("Enlace copiado"); }
      if (k === "story") return evStory(e);
      if (k === "on") {
        if (!e.start || isNaN(e.start)) return uiToast("Ponle fecha y hora al evento antes de publicarlo");
        a.disabled = true; a.textContent = "Publicando…";
        var baseSlug = e.slug || slugify(e.name);
        var tryPub = function (cand) { return patch(e.db, { published: true, slug: cand, published_at: new Date().toISOString() }); };
        var pub = tryPub(baseSlug).catch(function (x) {
          return /duplicate key|already exists|23505/i.test(String(x && (x.message || x))) ? (function seq(n) { return tryPub(baseSlug + "-" + n).catch(function (x2) { return /duplicate key|already exists|23505/i.test(String(x2 && (x2.message || x2))) && n < 20 ? seq(n + 1) : Promise.reject(x2); }); })(2) : Promise.reject(x);
        });
        pub.then(function (r) { var row = Array.isArray(r) ? r[0] : r; e.slug = (row && row.slug) || e.slug || baseSlug; e.pub = true; uiToast("Evento publicado"); pageTab(e); }, function (x) { a.disabled = false; a.textContent = "Publicar evento"; uiToast("No se pudo publicar: " + (x && x.message)); });
      }
      if (k === "off") patch(e.db, { published: false }).then(function () { e.pub = false; uiToast("Evento despublicado: el enlace ya no responde"); pageTab(e); });
      /* REQ-085: slug editable + verificación */
      if (k === "slugcheck" || k === "slugsave") {
        var inp = document.querySelector('[data-evs="slug"]'), msg = document.querySelector('[data-evs="msg"]');
        if (!inp) return;
        var cand = slugify(inp.value);
        if (!cand || cand === "evento") { msg.textContent = "Escribe una terminación válida (letras, números, guiones)."; msg.style.color = "#d33"; return; }
        if (k === "slugcheck") {
          msg.textContent = "Verificando…"; msg.style.color = "var(--muted)";
          api("/api/events/slug-check?slug=" + encodeURIComponent(cand) + "&eventId=" + encodeURIComponent(e.db)).then(function (r) {
            var ok = r && r.available;
            msg.textContent = ok ? "✓ musaworks.com/e/" + cand + " está disponible" : "✗ musaworks.com/e/" + cand + " ya existe — elige otra terminación (o usa " + cand + "-2)";
            msg.style.color = ok ? "#00b84f" : "#d33";
          }, function () { msg.textContent = "No se pudo verificar ahora."; msg.style.color = "#d33"; });
          return;
        }
        if (cand === e.slug) { msg.textContent = "Ese ya es el enlace actual."; msg.style.color = "var(--muted)"; return; }
        msg.textContent = "Verificando…"; msg.style.color = "var(--muted)";
        function doSave() {
          msg.textContent = "Guardando…"; msg.style.color = "var(--muted)";
          patch(e.db, { slug: cand }).then(function (rows) {
            var row = Array.isArray(rows) ? rows[0] : rows;
            e.slug = (row && row.slug) || cand;
            msg.textContent = "✓ Enlace actualizado: musaworks.com/e/" + e.slug; msg.style.color = "#00b84f";
            uiToast("Enlace guardado"); pageTab(e);
          }, function (x) {
            var dup = /duplicate|already exists|23505/i.test(String(x && (x.message || x)));
            msg.textContent = dup ? "✗ musaworks.com/e/" + cand + " ya existe — elige otra terminación (prueba " + cand + "-2)." : "No se pudo guardar: " + (x && x.message);
            msg.style.color = "#d33";
          });
        }
        api("/api/events/slug-check?slug=" + encodeURIComponent(cand) + "&eventId=" + encodeURIComponent(e.db)).then(function (r) {
          if (r && r.available === false) {
            msg.textContent = "✗ musaworks.com/e/" + cand + " ya existe — elige otra terminación (prueba " + (r.suggestion || (cand + "-2")) + ").";
            msg.style.color = "#d33";
            return;
          }
          doSave();
        }, doSave);
        return;
      }
    };
  }
  var _pg = evPageTab;
  evPageTab = function (e) { if (e && e.db && RR() && RR().on) return pageTab(e); return _pg.apply(this, arguments); };

  /* inscritos reales: se recargan al entrar a la pestaña */
  var _rg = typeof evRegsTab === "function" ? evRegsTab : null;
  if (_rg) evRegsTab = function (e) {
    var args = arguments, self = this;
    if (!(e && e.db && RR() && RR().on)) return _rg.apply(self, args);
    _rg.apply(self, args);
    api("workspace_event_regs?event_id=eq." + encodeURIComponent(e.db) + "&select=id,name,email,status,created_at,source&order=created_at.desc&limit=1000").then(function (rows) {
      var n0 = EV_REGS.filter(function (r) { return r.ev === e.id; }).length;
      for (var i = EV_REGS.length - 1; i >= 0; i--) if (EV_REGS[i].ev === e.id) EV_REGS.splice(i, 1);
      (rows || []).forEach(function (r) { EV_REGS.push({ db: r.id, name: r.name || "—", email: r.email || "", ev: e.id, origin: r.source === "pagina_publica" ? "Página pública" : "Musa", status: r.status === "asistio" ? "Asistió" : r.status === "no_asistio" ? "No asistió" : "Confirmado", when: new Date(r.created_at).toLocaleDateString("es-PE", { day: "numeric", month: "short" }) }); });
      e.regs = (rows || []).length;
      if (e.regs !== n0 && /\/inscritos$/.test(location.hash)) _rg.apply(self, args);
    }, function () {});
  };
})();
