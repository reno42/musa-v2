/* bridge-research-tabs.js — REQ-098: pestañas de Investigación (Noticias · Competidores · Ads · Pinterest).
 *
 * Noticias     = el pane que ya existe (bridge-research.js), intacto: fuentes RSS/web/reddit/youtube + hallazgos.
 * Competidores = benchmark de perfiles IG y Meta Ad Library (REQ-075 ya en el worker: research_benchmark_scan/import).
 * Ads          = bibliotecas públicas de anuncios (Google Transparency, Meta Ad Library, TikTok Creative Center,
 *                LinkedIn Ad Library): búsqueda por marca/país que abre la biblioteca oficial + runbook de import.
 * Pinterest    = búsqueda visual: tableros y búsquedas traídas con los scrapers OSS (pinterest-dl, pinscrape)
 *                e importadas como JSON — grid de mosaicos que se guarda en research_items (source_name pinterest).
 *
 * Enganche SIN depender del orden de carga ni de cómo se llame al view() del base: un MutationObserver vigila
 * #body; cada vez que bridge-research.js dibuja el pane (.rs-real), la barra de tabs se inserta encima.
 * Funciona con viewList(), el hook de reload y cualquier redraw.
 *
 * Sin humo: cada pestaña dice honestamente qué hace el worker y qué necesita el usuario (BYOK/import).
 * Design system del pane: vars --bg/--panel-2/--border/--text/--muted/--accent, cards radius 14, pills.
 */
(function () {
  function RR() { return window.__musaReal; }
  function real() { return RR() && RR().on; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function bridge() { try { return window.parent !== window && window.parent.__musaBridge; } catch (e) { return null; } }
  function api(path, init) { var b = bridge(); if (!b) return Promise.reject(new Error("sin puente")); return b.api(path.charAt(0) === "/" ? path : "/rest/v1/" + path, init); }
  function mcp(name, args) { var R = RR(); return R && R.mcp ? R.mcp(name, args || {}) : Promise.reject(new Error("sin sesión")); }
  function J(m, b) { return { method: m, headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(b) }; }
  function wsFilter() { var R = RR(), ids = (R.realWs || []).filter(function (id) { return id && id !== "__todo"; }); return R.all && ids.length ? "in.(%22" + ids.map(encodeURIComponent).join("%2C") + "%22)" : "eq." + encodeURIComponent(R.ws); }

  var TABS = [["noticias", "Noticias"], ["competidores", "Competidores"], ["ads", "Ads"], ["pinterest", "Pinterest"]];
  var S = { tab: "noticias", wired: false };

  var css = document.createElement("style");
  css.textContent =
    ".rtabs{display:flex;gap:4px;margin:0 0 14px;border-bottom:1px solid var(--border);padding-bottom:0}" +
    ".rtabs button{appearance:none;border:0;background:transparent;color:var(--muted);font:600 13px var(--sans,Inter,sans-serif);padding:8px 14px;cursor:pointer;border-radius:8px 8px 0 0;border-bottom:2px solid transparent;transition:color .15s,background-color .15s}" +
    ".rtabs button:hover{color:var(--bright);background:var(--panel-2)}" +
    ".rtabs button.on{color:var(--bright);border-bottom-color:var(--accent,#ff5e00)}" +
    ".rgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}" +
    ".rgrid a{display:block;border-radius:10px;overflow:hidden;border:1px solid var(--border);aspect-ratio:3/4;background:var(--panel-2)}" +
    ".rgrid img{width:100%;height:100%;object-fit:cover;display:block}" +
    ".rgrid a:hover{border-color:var(--border-2)}" +
    ".rhint{font-size:12.5px;line-height:1.55;color:var(--muted);background:var(--panel-2);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:14px}" +
    ".rhint b{color:var(--text)}" +
    ".radlib{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}" +
    ".radlib a{display:flex;flex-direction:column;gap:6px;padding:14px;border:1px solid var(--border);border-radius:14px;background:var(--panel-2);text-decoration:none;transition:border-color .15s}" +
    ".radlib a:hover{border-color:var(--border-2)}" +
    ".radlib b{color:var(--bright);font-size:13.5px}" +
    ".radlib small{color:var(--muted);font-size:12px;line-height:1.45}";
  document.head.appendChild(css);

  function tabsBar() {
    return '<div class="rtabs">' + TABS.map(function (t) {
      return '<button data-rt="' + t[0] + '" class="' + (S.tab === t[0] ? "on" : "") + '">' + t[1] + "</button>";
    }).join("") + "</div>";
  }

  /* ── COMPETIDORES ── */
  function benchView() {
    var b = document.getElementById("rtabBody"); if (!b) return;
    b.innerHTML = '<p class="empty-note">Cargando benchmarks…</p>';
    api("research_items?workspace_id=" + wsFilter() + "&select=id,title,summary,link,source_name,created_at&order=created_at.desc&limit=60")
      .then(function (items) {
        items = (items || []).filter(function (x) { return String(x.source_name || "").indexOf("benchmark") === 0; });
        var rows = items.map(function (x) {
          return '<div class="li"><div style="min-width:0"><b>' + esc(x.title || "Sin título") + "</b><p>" + esc(String(x.summary || "").slice(0, 160)) + '</p><small style="color:var(--muted)">' + esc(x.source_name || "") + "</small></div>"
            + (x.link && /^https?:\/\//.test(x.link) ? '<div class="meta"><a class="btn btn-g" href="' + esc(x.link) + '" target="_blank" rel="noopener" style="height:28px;font-size:12px;display:inline-flex;align-items:center">Abrir ↗</a></div>' : "") + "</div>";
        }).join("");
        b.innerHTML =
          '<div class="rhint"><b>Competidores, dos caminos honestos.</b><br>1) <b>Escanear ahora</b>: el worker intenta leer el perfil público de IG (a veces IG bloquea la IP del worker; en ese caso te doy el runbook). 2) <b>Importar</b>: corres un scraper OSS donde tú quieras (el runbook te dice cuál) y pegas el JSON aquí — el ranking queda en esta lista. Los ads de Meta van por la Ad Library, pública por ley.</div>'
          + '<div class="card c12" style="padding:14px;margin-bottom:14px"><div class="ag-ctl" style="margin:0;flex-wrap:wrap;gap:8px">'
          + '<input id="bmkUser" placeholder="usuario de IG sin @ (ej. novia.peru)" style="flex:1;min-width:200px;height:34px;border:1px solid var(--border);border-radius:9px;background:var(--bg);color:var(--text);padding:0 10px">'
          + '<button class="pri" id="bmkScan">Escanear perfil</button>'
          + '<button id="bmkMeta">Meta Ad Library (runbook)</button>'
          + '<button id="bmkImport">Importar JSON</button></div></div>'
          + '<div class="card c12"><div class="ch"><h3>Ranking guardado · ' + items.length + "</h3></div><div class=\\\"list\\\">" + (rows || '<p class="empty-note">Sin benchmarks todavía. Escanea un perfil o importa el JSON de un scraper.</p>') + "</div></div>";
        document.getElementById("bmkScan").onclick = function () {
          var u = String(document.getElementById("bmkUser").value || "").trim().replace(/^@/, "");
          if (!u) return;
          this.disabled = true; this.textContent = "Escaneando…";
          mcp("research_benchmark_scan", { workspaceId: RR().ws, kind: "ig_profile", username: u })
            .then(function (r) {
              uiToast(r && r.blocked ? "IG bloqueó el scan desde el worker — usa el runbook de importación" : "Benchmark guardado: " + ((r && r.saved) || 0) + " hallazgos");
            }, function (x) { uiToast("No se pudo escanear: " + (x && x.message)); })
            .then(benchView);
        };
        document.getElementById("bmkMeta").onclick = function () {
          mcp("research_benchmark_help", { kind: "meta_ads" }).then(function (r) {
            var t = r && (r.runbook || r.text || "");
            RR().dialog({ title: "Runbook · Meta Ad Library", ok: "Entendido", html: "<pre style='white-space:pre-wrap;font-size:12px'>" + esc(String(t).slice(0, 2000)) + "</pre>" });
          }, function () { window.open("https://www.facebook.com/ads/library/", "_blank", "noopener"); });
        };
        document.getElementById("bmkImport").onclick = function () {
          RR().dialog({ title: "Importar JSON del scraper", ok: "Importar", fields: [{ name: "kind", label: "Tipo (ig_profile o meta_ads)", type: "text", value: "ig_profile" }, { name: "json", label: "Pega el JSON que sacó el scraper", type: "text" }] }).then(function (v) {
            if (!v || !v.json) return;
            var parsed; try { parsed = JSON.parse(v.json); } catch (e) { return uiToast("JSON inválido: " + e.message); }
            mcp("research_benchmark_import", { workspaceId: RR().ws, kind: String(v.kind || "ig_profile").trim(), payload: parsed })
              .then(function (r) { uiToast("Importado: " + ((r && r.saved) || 0) + " hallazgos"); benchView(); },
                function (x) { uiToast("No se pudo importar: " + (x && x.message)); });
          });
        };
      }, function (x) { b.innerHTML = '<p class="empty-note">No se pudo cargar: ' + esc(x && x.message) + "</p>"; });
  }

  /* ── ADS (bibliotecas públicas) ── */
  function adCard(name, desc, base, ph) {
    return '<a data-lib="' + esc(base) + '" href="javascript:void 0" onclick="return false"><b>' + esc(name) + "</b><small>" + esc(desc) + '</small>'
      + '<span style="display:flex;gap:6px;margin-top:4px"><input placeholder="' + esc(ph) + '" style="flex:1;height:30px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);padding:0 8px;font-size:12px"><button class="btn btn-g" style="height:30px;font-size:12px">Abrir ↗</button></span></a>';
  }
  function adsView() {
    var b = document.getElementById("rtabBody"); if (!b) return;
    b.innerHTML =
      '<div class="rhint"><b>Bibliotecas de anuncios</b> — todas públicas (transparencia legal). Busca la marca y el país; el resultado se abre en la biblioteca oficial. Para traer los ads a Musa como tarjetas, corre el scraper del runbook y usa «Importar JSON» de la pestaña Competidores.</div>'
      + '<div class="radlib">'
      + adCard("Meta Ad Library", "Todos los ads activos de cualquier página en Meta (IG + Facebook). Público por ley.", "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=PE&q=", "Marca")
      + adCard("Google Ads Transparency", "Search, YouTube, Shopping y Display de cualquier anunciante, con fechas y regiones.", "https://adstransparency.google.com/?region=PE&domain=", "Dominio o marca")
      + adCard("TikTok Creative Center · Top Ads", "Los ads con mejor rendimiento por país e industria, con hooks y duraciones.", "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&page=1&industry=&country=PE&keyword=", "Palabra clave")
      + adCard("LinkedIn Ad Library", "Los ads de cualquier página de empresa en LinkedIn.", "https://www.linkedin.com/ad-library/detail?companyName=", "Empresa")
      + "</div>";
    b.querySelectorAll("[data-lib]").forEach(function (card) {
      var input = card.querySelector("input"), go = card.querySelector("button");
      function open() { var q = String(input.value || "").trim(); if (q) window.open(card.dataset.lib + encodeURIComponent(q), "_blank", "noopener"); }
      go.onclick = open; input.onkeydown = function (e) { if (e.key === "Enter") open(); };
    });
  }

  /* ── PINTEREST (búsqueda visual) ── */
  function pinView() {
    var b = document.getElementById("rtabBody"); if (!b) return;
    b.innerHTML = '<p class="empty-note">Cargando mosaicos…</p>';
    api("research_items?workspace_id=" + wsFilter() + "&select=id,title,summary,link,created_at&order=created_at.desc&limit=100")
      .then(function (items) {
        items = (items || []).filter(function (x) { return String(x.source_name || "") === "pinterest"; });
        var urls = [];
        items.forEach(function (x) { String(x.summary || "").split(/\s+/).forEach(function (u) { if (/^https:\/\/i\.pinimg\.com\//.test(u) && urls.indexOf(u) < 0) urls.push(u); }); });
        var grid = urls.slice(0, 60).map(function (u) {
          return '<a href="javascript:void 0" data-pin="' + esc(u) + '" onclick="return false"><img loading="lazy" src="' + esc(u) + '" alt=""></a>';
        }).join("");
        b.innerHTML =
          '<div class="rhint"><b>Búsqueda visual de Pinterest</b> — Pinterest no tiene API pública de búsqueda. El camino honesto: corres un scraper OSS (pinterest-dl o pinscrape, gratis) con tu búsqueda o tablero, y pegas el JSON aquí. Los mosaicos quedan guardados en este espacio y cada uno abre el pin original.</div>'
          + '<div class="card c12" style="padding:14px;margin-bottom:14px"><div class="ag-ctl" style="margin:0;gap:8px">'
          + '<button class="pri" id="pinImport">Importar mosaicos (JSON)</button>'
          + (urls.length ? '<button id="pinClear">Vaciar mosaicos</button>' : "")
          + '<a class="btn btn-g" href="https://github.com/sean1832/pinterest-dl" target="_blank" rel="noopener" style="height:32px;font-size:12px;display:inline-flex;align-items:center">Runbook · pinterest-dl ↗</a></div></div>'
          + '<div class="card c12"><div class="ch"><h3>Mosaicos · ' + urls.length + "</h3></div>"
          + '<div style="padding:0 14px 14px">' + (grid || '<p class="empty-note">Sin mosaicos todavía. Importa el JSON del scraper con tu búsqueda visual.</p>') + "</div></div>";
        var imp = document.getElementById("pinImport");
        if (imp) imp.onclick = function () {
          RR().dialog({ title: "Importar mosaicos de Pinterest", ok: "Importar", fields: [{ name: "q", label: "¿Qué búsqueda o tablero fue?", type: "text", value: "referencias visuales" }, { name: "json", label: "Pega el JSON del scraper (array de URLs o objetos)", type: "text" }] }).then(function (v) {
            if (!v || !v.json) return;
            var arr; try { arr = JSON.parse(v.json); } catch (e) { return uiToast("JSON inválido: " + e.message); }
            if (!Array.isArray(arr)) arr = [arr];
            var imgs = arr.map(function (x) { return typeof x === "string" ? x : (x && (x.url || x.image || x.src)); }).filter(function (u) { return /^https?:\/\//.test(String(u)); }).slice(0, 200);
            if (!imgs.length) return uiToast("El JSON no trae URLs de imagen");
            return api("research_items", J("POST", {
              workspace_id: RR().ws, title: "[pinterest] " + String(v.q || "búsqueda"), summary: imgs.join(" "),
              link: imgs[0], source_name: "pinterest", status: "new"
            })).then(function () { uiToast("Mosaicos importados: " + imgs.length); pinView(); }, function (x) { uiToast("No se pudo importar: " + (x && x.message)); });
          });
        };
        var clr = document.getElementById("pinClear");
        if (clr) clr.onclick = function () {
          RR().confirmBox("¿Vaciar todos los mosaicos guardados?", { danger: true, ok: "Vaciar" }).then(function (ok) {
            if (!ok) return;
            api("research_items?workspace_id=eq." + encodeURIComponent(RR().ws) + "&source_name=eq.pinterest", { method: "DELETE" })
              .then(function () { uiToast("Mosaicos vaciados"); pinView(); });
          });
        };
        b.querySelectorAll("[data-pin]").forEach(function (a) {
          a.onclick = function () { window.open(String(a.dataset.pin).replace(/\/\d+x\//, "/originals/"), "_blank", "noopener"); };
        });
      }, function (x) { b.innerHTML = '<p class="empty-note">No se pudo cargar: ' + esc(x && x.message) + "</p>"; });
  }

  function switchTab(t) {
    S.tab = t;
    var bar = document.querySelector(".rs-real .rtabs");
    if (bar) bar.outerHTML = tabsBar();
    if (t === "noticias") {
      /* Noticias = el pane base. Re-dibujar limpiamente: quitar rtabBody para que el base quede solo. */
      var rb = document.getElementById("rtabBody");
      if (rb) rb.remove();
      var R = RR();
      if (R && typeof R.researchView === "function") R.researchView();
      return;
    }
    if (t === "competidores") return benchView();
    if (t === "ads") return adsView();
    if (t === "pinterest") return pinView();
  }

  function ensureTabs() {
    var pane = document.querySelector(".rs-real");
    if (!pane) return;
    if (!pane.querySelector(".rtabs")) pane.insertAdjacentHTML("afterbegin", tabsBar() + '<div id="rtabBody"></div>');
    if (!S.wired) {
      S.wired = true;
      var body0 = document.getElementById("body");
      if (body0) body0.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-rt]");
        if (!btn || !document.querySelector(".rs-real .rtabs")) return;
        e.stopPropagation();
        switchTab(btn.dataset.rt);
      }, true);
    }
    if (S.tab !== "noticias") switchTab(S.tab);
  }

  function install() {
    if (!real()) return setTimeout(install, 300);
    var bodyEl = document.getElementById("body");
    if (!bodyEl) return setTimeout(install, 300);
    /* Observer: cuando bridge-research.js dibuje .rs-real (por viewList, reload o lo que sea), la barra aparece. */
    var mo = new MutationObserver(function () { ensureTabs(); });
    mo.observe(bodyEl, { childList: true });
    ensureTabs();
    var R = RR();
    if (R && !R._rsTabsHook) {
      R._rsTabsHook = true;
      var _rl = R.reload;
      if (_rl) R.reload = function () { return _rl.apply(this, arguments).then(function (x) { if (location.hash === "#planear/investigacion") setTimeout(ensureTabs, 80); return x; }); };
    }
  }
  install();
})();
