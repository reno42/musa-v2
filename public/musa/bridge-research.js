/* bridge-research.js — Planear › Investigación con tus datos reales.
 * Antes, en tu espacio la vista decía «Todavía no hay investigaciones» aunque tuvieras fuentes, y el detalle mostraba
 * fuentes de ejemplo («12 fuentes» vs «Fuentes · 5»): una fuente nueva se creaba y no aparecía en ninguna parte.
 * Ahora lista tus fuentes (activar/pausar, editar, eliminar) y lo que encontraron. «Buscar ahora» lee las fuentes al
 * pedirlo: no hay búsquedas automáticas. */
(function () {
  function RR() { return window.__musaReal; }
  function bridge() { try { return window.parent !== window && window.parent.__musaBridge; } catch (e) { return null; } }
  function api(path, init) { var b = bridge(); if (!b) return Promise.reject(new Error("sin puente")); return b.api(path.charAt(0) === "/" ? path : "/rest/v1/" + path, init); }
  function get(p) { return api(p).catch(function () { return []; }).then(function (r) { return r || []; }); }
  function J(m, b) { return { method: m, headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(b) }; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function real() { return RR() && RR().on; }
  function ago(iso) { if (!iso) return "nunca"; var d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5); return d <= 0 ? "hoy" : d === 1 ? "ayer" : "hace " + d + " días"; }
  function wsIds() { var R = RR(), ids = (R.realWs || []).filter(function (id) { return id && id !== "__todo"; }); return R.all && ids.length ? "in.(" + ids.map(encodeURIComponent).join(",") + ")" : "eq." + encodeURIComponent(R.ws); }
  var TYPE = { rss: "RSS / blog", nitter: "X (Twitter)", youtube: "YouTube", web: "Web", reddit: "Reddit" };
  var S = { src: [], items: [], ws: null };

  function load() {
    var W = wsIds();
    return Promise.all([
      get("research_sources?workspace_id=" + W + "&select=id,workspace_id,name,url,type,include_keywords,exclude_keywords,brand_id,active,last_fetched_at,last_status,last_error,created_at&order=created_at.desc&limit=200"),
      get("research_items?workspace_id=" + W + "&select=id,title,summary,link,source_name,published_at,status,created_at&order=created_at.desc&limit=100"),
    ]).then(function (r) { S.src = r[0]; S.items = r[1]; S.ws = RR().ws; });
  }
  function brandName(id) { return (id && (RR().brandName || {})[id]) || ""; }
  function draw() {
    var body = document.getElementById("body"); if (!body) return;
    var srcRows = S.src.map(function (s) {
      var st = s.last_error ? '<span class="pill warn" title="' + esc(s.last_error) + '">con error</span>' : s.active ? '<span class="pill ok">activa</span>' : '<span class="pill mute">pausada</span>';
      return '<div class="li"><div style="min-width:0"><b>' + esc(s.name) + '</b><p style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc([TYPE[s.type] || s.type, brandName(s.brand_id), s.url].filter(Boolean).join(" · ")) + '</p><small style="color:var(--muted)">Leída ' + ago(s.last_fetched_at)
        + ((s.include_keywords || []).length ? " · busca: " + esc(s.include_keywords.join(", ")) : "") + "</small></div><div class=\"meta\" style=\"display:flex;gap:6px;align-items:center\">" + st
        + '<button class="btn btn-g" data-rs="toggle" data-id="' + esc(s.id) + '" style="height:28px;font-size:12px">' + (s.active ? "Pausar" : "Activar") + '</button><button class="btn btn-g" data-rs="edit" data-id="' + esc(s.id) + '" style="height:28px;font-size:12px">Editar</button><button class="btn btn-g" data-rs="del" data-id="' + esc(s.id) + '" style="height:28px;font-size:12px">Eliminar</button></div></div>';
    }).join("");
    var itRows = S.items.map(function (x) {
      return '<div class="li"><div style="min-width:0"><b>' + esc(x.title || "Sin título") + "</b><p>" + esc(String(x.summary || "").slice(0, 180)) + '</p><small style="color:var(--muted)">' + esc([x.source_name, ago(x.published_at || x.created_at)].filter(Boolean).join(" · ")) + "</small></div>"
        + (x.link && /^https?:\/\//.test(x.link) ? '<div class="meta"><a class="btn btn-g" href="' + esc(x.link) + '" target="_blank" rel="noopener" style="height:28px;font-size:12px;display:inline-flex;align-items:center">Abrir ↗</a></div>' : "") + "</div>";
    }).join("");
    body.innerHTML = '<div class="grid"><article class="card c12"><div class="ch"><h3>Fuentes · ' + S.src.length + '</h3><span class="ag-ctl" style="margin:0"><button class="pri" data-rs="new">+ Nueva fuente</button>' + (S.src.some(function (s) { return s.active; }) ? '<button data-rs="run">Buscar ahora</button>' : "") + "</span></div>"
      + '<div class="list">' + (srcRows || '<p class="empty-note">Todavía no tienes fuentes. Agrega blogs, canales o cuentas que sigues y aquí aparece lo nuevo que publiquen.</p>') + "</div></article>"
      + '<article class="card c12"><div class="ch"><h3>Lo que encontraron · ' + S.items.length + '</h3><small>Se actualiza cuando tocas «Buscar ahora»</small></div><div class="list">' + (itRows || '<p class="empty-note">Todavía no hay hallazgos. Activa una fuente y toca «Buscar ahora».</p>') + "</div></article></div>";
    body.onclick = onClick;
  }
  function find(id) { return S.src.find(function (s) { return s.id === id; }); }
  function onClick(e) {
    var b = e.target.closest("[data-rs]"); if (!b) return;
    var k = b.dataset.rs, s = find(b.dataset.id), R = RR();
    if (k === "new") { var h = document.querySelector(".head .actions .btn-p"); if (h) h.click(); return; }
    if (k === "run") {
      if (!R.mcp) return uiToast("Cargando…");
      b.disabled = true; b.textContent = "Buscando…";
      return R.mcp("research_refresh_sources", { workspaceId: R.ws }).then(function (r) { uiToast("Listo: " + ((r && (r.newItems || r.inserted || r.added)) || 0) + " hallazgos nuevos"); }, function (x) { uiToast("No se pudo buscar: " + (x && x.message)); }).then(function () { return load(); }).then(draw);
    }
    if (!s) return;
    if (k === "toggle") return api("research_sources?id=eq." + encodeURIComponent(s.id), J("PATCH", { active: !s.active })).then(function () { s.active = !s.active; uiToast(s.active ? "Fuente activa" : "Fuente pausada"); draw(); }, function (x) { uiToast("No se pudo cambiar: " + (x && x.message)); });
    if (k === "del") return R.confirmBox("¿Eliminar la fuente «" + s.name + "»? Lo que ya encontró se queda.", { danger: true, ok: "Eliminar" }).then(function (ok) {
      if (!ok) return; return api("research_sources?id=eq." + encodeURIComponent(s.id), { method: "DELETE" }).then(function () { S.src = S.src.filter(function (x) { return x !== s; }); uiToast("Fuente eliminada"); draw(); }, function (x) { uiToast("No se pudo eliminar: " + (x && x.message)); });
    });
    if (k === "edit") return R.dialog({ title: "Editar fuente", ok: "Guardar", fields: [
      { name: "name", label: "Nombre", type: "text", value: s.name }, { name: "url", label: "Dirección (URL, feed o canal)", type: "text", value: s.url },
      { name: "inc", label: "Solo lo que mencione (separado por comas)", type: "text", value: (s.include_keywords || []).join(", ") },
      { name: "exc", label: "Ignorar lo que mencione (separado por comas)", type: "text", value: (s.exclude_keywords || []).join(", ") }] }).then(function (v) {
      if (!v) return;
      var list = function (x) { return String(x || "").split(",").map(function (y) { return y.trim(); }).filter(Boolean); };
      var patch = { name: String(v.name || s.name).trim() || s.name, url: String(v.url || s.url).trim() || s.url, include_keywords: list(v.inc), exclude_keywords: list(v.exc) };
      return api("research_sources?id=eq." + encodeURIComponent(s.id), J("PATCH", patch)).then(function () { Object.assign(s, patch); uiToast("Fuente guardada"); draw(); }, function (x) { uiToast("No se pudo guardar: " + (x && x.message)); });
    });
  }
  function view() {
    var body = document.getElementById("body"); if (body) body.innerHTML = '<p class="empty-note">Cargando tus fuentes…</p>';
    load().then(draw, function (x) { if (body) body.innerHTML = '<p class="empty-note">No se pudo cargar: ' + esc(x && x.message) + "</p>"; });
  }
  function install() {
    if (typeof viewList !== "function" || !real()) return setTimeout(install, 300);
    var _vl = viewList;
    viewList = function (key) {
      if (key === "planear/investigacion" && real()) return view();
      return _vl.apply(this, arguments);
    };
    /* la fuente nueva aparece apenas se crea (el diálogo recarga los datos del espacio) */
    var _rl = RR().reload;
    if (_rl && !RR()._rsHook) { RR()._rsHook = true; RR().reload = function () { return _rl.apply(this, arguments).then(function (x) { if (location.hash === "#planear/investigacion") view(); return x; }); }; }
    if (location.hash === "#planear/investigacion") view();
  }
  install();
})();
