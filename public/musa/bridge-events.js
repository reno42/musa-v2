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
      var f = t.files[0]; if (!RR().uploadData) return;
      var r = new FileReader();
      r.onload = function () { uiToast("Subiendo portada…"); RR().uploadData(String(r.result), "portada-" + slugify(e.name) + ".jpg").then(function (url) { e.cover = url; queue(e, { cover_url: url }); }, function (x) { uiToast("No se pudo subir la portada: " + (x && x.message)); }); };
      r.readAsDataURL(f); return;
    }
    if (!k) return;
    var v = t.value, b = {};
    if (k === "name") b.name = v.trim() || "Evento";
    if (k === "brand") b.brand_id = (RR().brandId || {})[v] || null;
    if (k === "start") { var d = new Date(v); if (!isNaN(d)) { b.starts_at = d.toISOString(); b.date = v.slice(0, 10); } }
    if (k === "plat") { b.platform = v === "zoom" ? "zoom" : "meet"; b.location = v === "zoom" ? "Zoom" : "Google Meet"; }
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
      + '<div class="ad-f"><small style="color:var(--muted)">' + (pub ? "Publicado: cualquiera con el enlace ve la página, se inscribe y lo agrega a su calendario." : "Todavía no está publicado. Al publicarlo se crea su enlace y se abren las inscripciones.") + "</small>"
      + '<span style="margin-left:auto;display:flex;gap:6px">' + (pub ? '<button class="btn btn-g" data-evp="copy">⧉ Copiar enlace</button><a class="btn btn-g" href="' + esc(url) + '" target="_blank" rel="noopener" style="display:inline-flex;align-items:center">Abrir ↗</a><button class="btn btn-g" data-evp="story">⬇ Pieza para stories</button><button class="btn btn-g" data-evp="off">Despublicar</button>' : '<button class="btn btn-p" data-evp="on">Publicar evento</button>') + "</span></div>"
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
        var slug = e.slug || slugify(e.name) + "-" + Math.random().toString(36).slice(2, 6);
        patch(e.db, { published: true, slug: slug, published_at: new Date().toISOString() }).then(function () { e.slug = slug; e.pub = true; uiToast("Evento publicado"); pageTab(e); }, function (x) { a.disabled = false; a.textContent = "Publicar evento"; uiToast("No se pudo publicar: " + (x && x.message)); });
      }
      if (k === "off") patch(e.db, { published: false }).then(function () { e.pub = false; uiToast("Evento despublicado: el enlace ya no responde"); pageTab(e); });
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
