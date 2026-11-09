/* bridge-websites.js — módulo «Websites»: landings y sitios con CMS propio.
 * - Mis websites (también en Crear › Websites): crear desde plantilla, editar, publicar, mover entre espacios.
 * - Editor visual (#wbEd): páginas hechas de secciones, vista previa real (public/musa/siterender.js, el MISMO
 *   motor que sirve la web publicada) en computadora / tableta / celular, tema, menú y pie, SEO por página.
 * - CMS: colecciones con campos propios y entradas que salen en vivo al publicarlas.
 * - SEO e IA: auditoría SEO / GEO / AEO sin IA y ajustes (resumen para IA, organización, llms.txt, bots).
 * - Dominios y conexiones: dirección de Musa, dominio propio (plan pagado), GitHub y Supabase propios.
 * - Visitas: serie diaria, páginas, orígenes y leads.
 * Lo que se publica, el dominio, GitHub y Supabase pasan por las herramientas MCP (RB.mcp): lo mismo que usa la IA.
 */
(function () {
  var R = window.__musaReal; if (!R) return;
  function SR() { return window.SiteRender; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function bridge() { try { return window.parent.__musaBridge; } catch (e) { return null; } }
  function api(path, init) { var b = bridge(); if (!b) return Promise.reject(new Error("Sin sesión")); return b.api(path, init); }
  function J(method, body) { return { method: method, headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(body) }; }
  function msg(e) { var m = String((e && e.message) || e || "Error").replace(/^API error:\s*\d+\s*[·:—-]?\s*/, ""); var l = m.match(/LIMIT_[A-Z]+:\s*([^"}]*)/); if (l) return l[1]; if (/websites_slug_u/.test(m)) return "Esa dirección ya la usa otro website."; if (/website_pages_path_u/.test(m)) return "Ya hay una página con esa ruta."; return m; }
  function toast(t) { if (typeof uiToast === "function") uiToast(t); }
  function uid() { var b = bridge(); return b && b.userId; }
  function mcp(name, args) { if (!R.mcp) return Promise.reject(new Error("Cargando…")); return R.mcp(name, args); }
  function enc(s) { return encodeURIComponent(s); }
  var MOBILE = window.matchMedia("(max-width: 760px)"), NARROW = window.matchMedia("(max-width: 1100px)");
  var APP = location.origin;
  function onWeb() { return typeof route !== "undefined" && route && (route.mod === "websites" || (route.mod === "crear" && route.sub === "websites")); }

  /* ───────── espacios ───────── */
  function wsName(id) { var w = typeof WSS !== "undefined" && WSS[id]; return /^ws_user_/.test(id) && w && w.name === R.me ? "Mi espacio personal" : (w ? w.name : "otro espacio"); }
  function wsKind(id) { return (R.wsKind && R.wsKind[id]) || (/^ws_user_/.test(id) ? "personal" : "agency"); }
  function realWs() { return (R.realWs || [R.ws]).filter(function (id) { return typeof WSS !== "undefined" && WSS[id]; }); }
  function writeWs() { return R.all ? (R.writeWs && typeof WSS !== "undefined" && WSS[R.writeWs] ? R.writeWs : R.personalWs) : R.ws; }
  function wsFilter() { return R.wsFilter ? R.wsFilter() : "workspace_id=eq." + enc(R.ws); }
  function wsChip(id) { var c = wsKind(id) === "agency" ? "#ff5e00" : "#0e9f9e"; return '<span class="wbc ws" style="background:' + c + '">' + esc(wsName(id)) + "</span>"; }

  /* ───────── datos ───────── */
  var W = { sites: null, cur: null, brands: null, forms: {}, tpls: {}, tplData: {}, cms: {}, stats: {} };
  try { W.cur = localStorage.getItem("musa-wb-cur") || null; } catch (e) {}
  function setCur(id) { W.cur = id; try { localStorage.setItem("musa-wb-cur", id || ""); } catch (e) {} }
  var SITE_COLS = "id,workspace_id,brand_id,name,slug,status,theme,settings,published_at,version,updated_at,created_by";
  function loadSites() {
    return api("/rest/v1/websites?" + wsFilter() + "&deleted_at=is.null&select=" + SITE_COLS + "&order=updated_at.desc&limit=200").then(function (rows) {
      W.sites = rows || [];
      R.wsOf = R.wsOf || {}; W.sites.forEach(function (r) { R.wsOf["website:" + r.id] = r.workspace_id; });
      if (W.sites.length && !W.sites.some(function (s) { return s.id === W.cur; })) setCur(W.sites[0].id);
      return W.sites;
    }, function (e) { W.sites = []; W.err = msg(e); return []; });
  }
  function siteById(id) { return (W.sites || []).find(function (s) { return s.id === id; }); }
  function liveUrl(s) { return APP + "/w/" + s.slug + "/"; }
  function loadBrands() {
    if (W.brands) return Promise.resolve(W.brands);
    var ids = realWs(); if (!ids.length) return Promise.resolve([]);
    return api("/rest/v1/brands?workspace_id=in.(" + ids.map(enc).join(",") + ")&select=id,name,colors,fonts,logo,workspace_id&order=name").then(function (r) { W.brands = r || []; return W.brands; }, function () { W.brands = []; return []; });
  }
  function loadForms(ws) {
    if (W.forms[ws]) return Promise.resolve(W.forms[ws]);
    return api("/rest/v1/workspace_forms?workspace_id=eq." + enc(ws) + "&select=id,name,published,schema,public_token&order=updated_at.desc&limit=100").then(function (r) { W.forms[ws] = r || []; return W.forms[ws]; }, function () { return []; });
  }
  function loadTpls(ws) {
    if (W.tpls[ws]) return Promise.resolve(W.tpls[ws]);
    return api("/rest/v1/templates?workspace_id=eq." + enc(ws) + "&deleted_at=is.null&select=id,name,thumbnail&order=updated_at.desc&limit=80").then(function (r) { W.tpls[ws] = r || []; return W.tpls[ws]; }, function () { return []; });
  }
  function loadTplData(id) {
    if (W.tplData[id]) return Promise.resolve(W.tplData[id]);
    return api("/rest/v1/templates?id=eq." + enc(id) + "&select=id,name,thumbnail,html:data->>html,css:data->>css,width:data->>width,height:data->>height").then(function (r) { var t = (r || [])[0] || null; if (t) W.tplData[id] = t; return t; }, function () { return null; });
  }
  function loadCms(siteId, force) {
    if (W.cms[siteId] && !force) return Promise.resolve(W.cms[siteId]);
    return Promise.all([
      api("/rest/v1/website_collections?website_id=eq." + enc(siteId) + "&select=*&order=sort"),
      api("/rest/v1/website_entries?website_id=eq." + enc(siteId) + "&select=id,collection_id,slug,title,data,seo,status,publish_at,created_at,updated_at&order=created_at.desc&limit=1000"),
    ]).then(function (r) {
      var cols = r[0] || [], ents = r[1] || [], by = {}, entries = {}, all = {};
      cols.forEach(function (c) { by[c.id] = c.slug; entries[c.slug] = []; all[c.slug] = []; });
      var now = Date.now();
      ents.forEach(function (e) { var s = by[e.collection_id]; if (!s) return; all[s].push(e); if (e.status === "published" && (!e.publish_at || Date.parse(e.publish_at) <= now)) entries[s].push(e); });
      W.cms[siteId] = { collections: cols, entries: entries, all: all };
      return W.cms[siteId];
    });
  }

  /* ───────── estilos ───────── */
  var css = ""
    + ".wb-note{font-size:13px;line-height:1.55;opacity:.85;margin:0 0 16px;max-width:900px}.wb-note code{font-size:12px}"
    + ".wb-top{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 16px}.wb-top .sp{flex:1}"
    + ".wb-top select,.wb-in{height:38px;border-radius:10px;border:1.5px solid var(--border-2,#333);background:transparent;color:inherit;padding:0 12px;font:600 13px var(--sans,Inter,sans-serif);max-width:100%}"
    + ".wb-top select option{color:#111}"
    + ".wbb{height:36px;padding:0 14px;border-radius:999px;border:1.5px solid var(--border-2,#333);background:transparent;color:inherit;font:700 13px/1 var(--sans,Inter,sans-serif);cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}"
    + ".wbb:hover{border-color:var(--bright,#fff)}.wbb.pri{background:var(--accent,#ff5e00);border-color:transparent;color:#fff}.wbb[disabled]{opacity:.45;cursor:default}"
    + ".org-a .wbb{border-color:#111;color:#111;height:32px;font-size:12px}.org-a .wbb.pri{color:#fff;border-color:transparent}"
    + ".wb-card .wbcs{display:flex;gap:6px;flex-wrap:wrap;height:auto}.wbc{display:inline-flex;align-items:center;font:700 10.5px/1 var(--sans,Inter,sans-serif);padding:5px 9px;border-radius:999px;background:rgba(0,0,0,.08);color:#333;white-space:nowrap}"
    + ".wbc.ok{background:#e3f6ea;color:#0f6b36}.wbc.dr{background:#fff1d6;color:#8a5200}.wbc.ws{color:#fff}.wbc.bad{background:#fdeceb;color:#a3261d}"
    + ".wb-card .th{height:150px;border-radius:12px;overflow:hidden;background:#e9e8dd;position:relative;margin-bottom:4px}.wb-card .th iframe{position:absolute;left:0;top:0;width:1280px;height:900px;border:0;transform-origin:0 0;pointer-events:none}"
    + ".wb-card .url{font:600 12px var(--sans);color:#333;word-break:break-all;text-decoration:none}.wb-card .url:hover{text-decoration:underline}"
    + ".wb-card .acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}"
    + ".wb-empty{border:2px dashed var(--border-2,#333);border-radius:16px;padding:28px;text-align:center}.wb-empty b{display:block;font-size:18px;margin-bottom:6px}.wb-empty p{opacity:.75;margin:0 0 16px}"
    + ".wb-tpl{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;text-align:left;margin-top:12px}.wb-tpl button{border:1.5px solid var(--border-2,#333);background:transparent;color:inherit;border-radius:14px;padding:14px;cursor:pointer;text-align:left}.wb-tpl button:hover{border-color:var(--accent,#ff5e00)}.wb-tpl b{display:block;font-size:14px;margin-bottom:4px}.wb-tpl small{opacity:.7;font-size:12px;line-height:1.4}"
    + ".wb-panel{background:var(--card-bg,#f4f3ea);color:#111;border-radius:16px;padding:18px;margin:0 0 14px}.wb-panel h4{margin:0 0 10px;font:800 15px var(--sans)}.wb-panel p{font-size:13px;color:#444;margin:0 0 10px;line-height:1.5}"
    + ".wb-panel .wbb{border-color:#111;color:#111}.wb-panel .wbb.pri{color:#fff;border-color:transparent}"
    + ".wb-panel label.f{display:flex;flex-direction:column;gap:5px;font:700 12px var(--sans);color:#333;margin:0 0 10px}.wb-panel label.f small{font-weight:500;color:#666}"
    + ".wb-panel input[type=text],.wb-panel input[type=url],.wb-panel input[type=email],.wb-panel input[type=date],.wb-panel input[type=datetime-local],.wb-panel input[type=number],.wb-panel textarea,.wb-panel select{border:1.5px solid #d6d4c6;border-radius:10px;padding:9px 11px;font:400 14px var(--sans);background:#fff;color:#111;width:100%}"
    + ".wb-panel textarea{min-height:80px;resize:vertical}.wb-panel .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}"
    + ".wb-panel label.ck{display:flex;gap:8px;align-items:flex-start;font:600 13px var(--sans);color:#222;margin:0 0 10px}.wb-panel label.ck small{display:block;font-weight:500;color:#666}"
    + ".wb-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:0 14px}.wb-grid2>*{min-width:0}.wb-panel{min-width:0;overflow-wrap:anywhere}.wb-tbl td{word-break:break-word}.wb-panel{max-width:100%;overflow-x:auto}.wb-grid2 .wb-tbl{table-layout:fixed}.wb-grid2 .wb-tbl td.r{width:70px}"
    + ".wb-score{display:flex;gap:14px;flex-wrap:wrap;margin:0 0 6px}.wb-ring{width:110px;text-align:center}.wb-ring svg{display:block;margin:0 auto 4px}.wb-ring b{font:800 13px var(--sans)}.wb-ring small{display:block;font-size:11px;color:#666}"
    + ".wb-fix{list-style:none;margin:0;padding:0}.wb-fix li{display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-top:1px solid #e1dfd2;font-size:13px;color:#222}.wb-fix li i{flex:0 0 auto;font-style:normal;font:800 10px/1 var(--sans);padding:4px 7px;border-radius:999px;background:#111;color:#fff;margin-top:1px}.wb-fix li i.geo{background:#5b5bd6}.wb-fix li i.aeo{background:#0e9f9e}.wb-fix li small{display:block;color:#666;margin-top:2px}.wb-fix li .wbb{margin-left:auto;flex:0 0 auto}"
    + ".wb-tbl{width:100%;border-collapse:collapse;font-size:13px;color:#222}.wb-tbl th{text-align:left;font-size:11px;color:#666;font-weight:700;padding:8px 6px;border-bottom:1px solid #d6d4c6}.wb-tbl td{padding:9px 6px;border-bottom:1px solid #ebe9de;vertical-align:middle}.wb-tbl tr:hover td{background:#fbfaf4}.wb-tbl .r{text-align:right}"
    + ".wb-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px}.wb-tabs button{border:1.5px solid #111;background:transparent;color:#111;border-radius:999px;height:32px;padding:0 13px;font:700 12px var(--sans);cursor:pointer}.wb-tabs button.on{background:#111;color:#fff}"
    + ".wb-dns{background:#fff;border:1px solid #e1dfd2;border-radius:12px;padding:10px 12px;font-size:12.5px;margin:8px 0}.wb-dns code{font-size:12px;background:#f1f0e8;padding:2px 6px;border-radius:6px;word-break:break-all}"
    + ".wb-bars{display:flex;align-items:flex-end;gap:3px;height:140px;margin:10px 0 4px}.wb-bars i{flex:1;background:var(--accent,#ff5e00);border-radius:4px 4px 0 0;min-height:2px;position:relative}.wb-bars i:hover::after{content:attr(data-t);position:absolute;bottom:100%;left:50%;transform:translateX(-50%);background:#111;color:#fff;font:600 11px var(--sans);padding:4px 7px;border-radius:6px;white-space:nowrap;font-style:normal}"
    + ".wb-kpi{display:flex;gap:12px;flex-wrap:wrap}.wb-kpi div{flex:1;min-width:120px;background:#fff;border-radius:12px;padding:12px}.wb-kpi b{display:block;font:800 26px var(--sans);color:#111}.wb-kpi small{color:#666;font-size:12px}"
    /* editor */
    + "#wbEd{position:fixed;inset:0;z-index:140;display:grid;grid-template-columns:288px minmax(0,1fr) 340px;grid-template-rows:52px minmax(0,1fr);background:#0a0a0a;color:#bdbdbd;font:13px/1.4 var(--sans,Inter,system-ui,sans-serif);--p:#111;--l:#222;--m:#6f6f6f;--h:#1c1c1c}"
    + "#wbEd[hidden]{display:none}#wbEd *{box-sizing:border-box}"
    + "#wbEd .wtop{grid-column:1/-1;display:flex;align-items:center;gap:6px;padding:0 10px;border-bottom:1px solid var(--l);background:var(--p);min-width:0}"
    + "#wbEd .wtop .nm{font:700 14px var(--sans);color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}"
    + "#wbEd .tb{height:34px;padding:0 11px;border-radius:9px;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;color:#bdbdbd;background:transparent;border:0;cursor:pointer;font:600 12.5px/1 var(--sans)}"
    + "#wbEd .tb:hover{background:var(--h);color:#fff}#wbEd .tb.on{background:#262626;color:#fff}#wbEd .tb.pri{background:#ff5e00;color:#fff}#wbEd .tb[disabled]{opacity:.35;cursor:default}#wbEd .tb:focus-visible,#wbEd button:focus-visible{outline:2px solid #ff5e00;outline-offset:1px}"
    + "#wbEd .seg{display:inline-flex;background:#0d0d0d;border:1px solid var(--l);border-radius:10px;padding:2px;gap:2px}#wbEd .seg .tb{height:30px;padding:0 9px}"
    + "#wbEd .sp{flex:1}#wbEd .st{font-size:11.5px;color:var(--m);white-space:nowrap}"
    + "#wbEd select.pg{height:34px;background:#141414;color:#fff;border:1px solid var(--l);border-radius:9px;padding:0 8px;font:600 12.5px var(--sans);max-width:200px}"
    + "#wbEd .lp,#wbEd .rp{background:var(--p);min-height:0;overflow-y:auto;scrollbar-width:none}#wbEd .lp::-webkit-scrollbar,#wbEd .rp::-webkit-scrollbar{display:none}"
    + "#wbEd .lp{border-right:1px solid var(--l);display:flex;flex-direction:column}#wbEd .rp{border-left:1px solid var(--l);padding:14px}"
    + "#wbEd .lt{display:flex;gap:2px;padding:8px;border-bottom:1px solid var(--l);position:sticky;top:0;background:var(--p);z-index:2}#wbEd .lt .tb{flex:1;justify-content:center;padding:0 6px}"
    + "#wbEd .lb{padding:10px}"
    + "#wbEd h5{margin:6px 2px 8px;font:800 10.5px/1 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--m)}"
    + "#wbEd .it{display:flex;align-items:center;gap:8px;width:100%;border:1px solid var(--l);background:#141414;color:#ddd;border-radius:10px;padding:8px 10px;margin:0 0 6px;cursor:pointer;font:600 12.5px/1.25 var(--sans);text-align:left}"
    + "#wbEd .it:hover{border-color:#3a3a3a;color:#fff}#wbEd .it.on{border-color:#ff5e00;background:#1d1209;color:#fff}#wbEd .it small{display:block;color:var(--m);font-weight:500;font-size:11px;margin-top:2px}"
    + "#wbEd .it .ic{flex:0 0 28px;height:28px;border-radius:8px;background:#222;display:grid;place-items:center;font-size:13px;color:#ff8a3d}#wbEd .it .tx{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}"
    + "#wbEd .it{position:relative}#wbEd .it .mini{display:flex;gap:2px;opacity:0;transition:opacity .12s;position:absolute;right:6px;top:50%;transform:translateY(-50%);background:#1a1a1a;border-radius:8px;padding:2px;box-shadow:-8px 0 10px #141414}#wbEd .it.on .mini{background:#1d1209;box-shadow:-8px 0 10px #1d1209}#wbEd .it:hover .mini,#wbEd .it.on .mini,#wbEd .it:focus-within .mini{opacity:1}"
    + "#wbEd .mini button{width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:#aaa;cursor:pointer;font-size:13px;display:grid;place-items:center}#wbEd .mini button:hover{background:#2a2a2a;color:#fff}"
    + "#wbEd .it.drag{opacity:.4}#wbEd .it.over{box-shadow:0 -2px 0 #ff5e00}"
    + "#wbEd .add{width:100%;border:1.5px dashed #333;background:transparent;color:#ddd;border-radius:10px;padding:10px;cursor:pointer;font:700 12.5px var(--sans);margin:4px 0 10px}#wbEd .add:hover{border-color:#ff5e00;color:#fff}"
    + "#wbEd .pal{display:grid;grid-template-columns:1fr 1fr;gap:6px}#wbEd .pal button{border:1px solid var(--l);background:#141414;color:#ddd;border-radius:10px;padding:10px 8px;cursor:pointer;text-align:left;font:700 12px/1.25 var(--sans)}#wbEd .pal button:hover{border-color:#ff5e00;color:#fff}#wbEd .pal button i{display:block;font-style:normal;color:#ff8a3d;font-size:15px;margin-bottom:4px}#wbEd .pal button small{display:block;font-weight:500;color:var(--m);font-size:10.5px;margin-top:3px}"
    + "#wbEd .cv{position:relative;min-width:0;min-height:0;display:flex;align-items:flex-start;justify-content:center;overflow:auto;background:#1a1a1a;padding:18px;scrollbar-width:none}#wbEd .cv::-webkit-scrollbar{display:none}"
    + "#wbEd .fr{background:#fff;border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.5);overflow:hidden;transform-origin:top center;flex:0 0 auto}#wbEd .fr iframe{display:block;border:0;width:100%;height:100%;background:#fff}"
    + "#wbEd label.f{display:flex;flex-direction:column;gap:5px;margin:0 0 11px;font:700 11.5px var(--sans);color:#9a9a9a}#wbEd label.f small{font-weight:500;color:var(--m);line-height:1.35}"
    + "#wbEd input[type=text],#wbEd input[type=url],#wbEd input[type=number],#wbEd textarea,#wbEd select.in{width:100%;background:#0d0d0d;border:1px solid #2a2a2a;border-radius:9px;color:#eee;padding:8px 10px;font:400 13px var(--sans)}"
    + "#wbEd input:focus,#wbEd textarea:focus,#wbEd select.in:focus{outline:0;border-color:#ff5e00}#wbEd textarea{min-height:74px;resize:vertical;line-height:1.45}#wbEd textarea.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;min-height:120px}"
    + "#wbEd label.ck{display:flex;gap:8px;align-items:center;margin:0 0 11px;font:600 12.5px var(--sans);color:#ddd;cursor:pointer}"
    + "#wbEd .wcol{display:flex;gap:6px;align-items:center}#wbEd .wcol input[type=color]{width:36px;height:34px;border:1px solid #2a2a2a;border-radius:8px;background:#0d0d0d;padding:2px;flex:0 0 36px}"
    + "#wbEd .img{display:flex;gap:6px;align-items:center}#wbEd .img .pv{width:38px;height:38px;border-radius:8px;background:#222 center/cover no-repeat;flex:0 0 38px;border:1px solid #2a2a2a}#wbEd .img input{flex:1;min-width:0}"
    + "#wbEd .sm{height:30px;padding:0 10px;border-radius:8px;border:1px solid #2f2f2f;background:#161616;color:#ddd;cursor:pointer;font:700 11.5px var(--sans);white-space:nowrap}#wbEd .sm:hover{border-color:#ff5e00;color:#fff}#wbEd .sm.dg:hover{border-color:#d7261e;color:#ff8a80}"
    + "#wbEd .wli{border:1px solid #262626;border-radius:10px;margin:0 0 8px;background:#0f0f0f}#wbEd .wli>summary{list-style:none;cursor:pointer;padding:9px 10px;display:flex;gap:6px;align-items:center;font:700 12px var(--sans);color:#ddd}#wbEd .wli>summary::-webkit-details-marker{display:none}#wbEd .wli>summary .tx{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#wbEd .wli .bd{padding:4px 10px 6px}"
    + "#wbEd .hint{font-size:12px;color:#8a8a8a;line-height:1.5;margin:0 0 12px}#wbEd .hint b{color:#ddd}"
    + "#wbEd .row{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px}"
    + "#wbEd .mnav{display:none}"
    + "#wbEd .rpx{display:none;margin:0 0 10px auto}"
    + "@media (min-width:761px) and (max-width:1100px){#wbEd{grid-template-columns:250px minmax(0,1fr)}#wbEd .rp{position:fixed;right:0;top:52px;bottom:0;width:min(340px,48vw);z-index:3;box-shadow:-20px 0 50px rgba(0,0,0,.55);transform:translateX(105%);transition:transform .22s ease-out}#wbEd .rp.open{transform:none}#wbEd .rpx{display:block}}"
    + "@media (max-width:760px){#wbEd .rpx{display:block}}"
    + "@media (hover:none){#wbEd .it .mini{opacity:1;position:static;transform:none;box-shadow:none;background:transparent}}@media (max-width:760px){#wbEd{grid-template-columns:minmax(0,1fr);grid-template-rows:50px minmax(0,1fr) 58px}"
    + "#wbEd .wtop{gap:2px;padding:0 6px}#wbEd .wtop .nm{max-width:110px;font-size:13px}#wbEd .wtop .hm{display:none}#wbEd select.pg{max-width:120px}"
    + "#wbEd .lp,#wbEd .rp{position:fixed;left:0;right:0;bottom:58px;max-height:72vh;z-index:3;border:0;border-top:1px solid #2a2a2a;border-radius:18px 18px 0 0;box-shadow:0 -20px 50px rgba(0,0,0,.6);transform:translateY(105%);transition:transform .22s ease-out;display:block}"
    + "#wbEd .lp.open,#wbEd .rp.open{transform:none}#wbEd .cv{padding:10px}"
    + "#wbEd .mnav{display:flex;grid-column:1/-1;background:var(--p);border-top:1px solid var(--l);z-index:4}#wbEd .mnav button{flex:1;border:0;background:transparent;color:#aaa;font:700 10.5px var(--sans);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer}#wbEd .mnav button.on{color:#ff8a3d}#wbEd .mnav button.pub{color:#fff}#wbEd .mnav svg{width:20px;height:20px}}"
    + "@media (prefers-reduced-motion:reduce){#wbEd .lp,#wbEd .rp{transition:none}}";
  (function inject() { var s = document.createElement("style"); s.id = "wbCss"; s.textContent = css; document.head.appendChild(s); })();

  /* ═════════════════ vista: Mis websites ═════════════════ */
  function drawSites() {
    var body = document.getElementById("body"); if (!body || !onWeb()) return;
    if (!W.sites) { body.innerHTML = '<div class="wb-note">Cargando tus websites…</div>'; loadSites().then(function () { if (onWeb()) drawSites(); }); return; }
    var h = '<div class="wb-note">Landings y sitios con tu marca, un CMS propio para el contenido que cambia (blog, productos, casos) y SEO, GEO y AEO automáticos: sitemap, datos estructurados y <code>llms.txt</code> para que te encuentren Google y las IAs. Los formularios crean leads en Vender › Personas. Tu IA también puede armarlos por MCP.</div>';
    if (W.err) h += '<div class="wb-panel"><p>No pude cargar los websites: ' + esc(W.err) + "</p></div>";
    if (!W.sites.length) {
      h += '<div class="wb-empty"><b>Todavía no tienes websites</b><p>Elige una plantilla para empezar. Nada es público hasta que publiques.</p><div class="wb-tpl">' + tplButtons() + "</div></div>";
    } else {
      h += '<div class="wb-top"><span class="sp"></span><button class="wbb pri" data-wbn="new">+ Nuevo website</button></div><div class="org-grid">' + W.sites.map(function (s) {
        var pub = s.status === "published";
        return '<div class="org-a wb-card" data-wbrow="' + esc(s.id) + '"><div class="th" data-th="' + esc(s.id) + '"></div><div class="wbcs">' + (R.all ? wsChip(s.workspace_id) : "") + '<span class="wbc ' + (pub ? "ok" : "dr") + '">' + (pub ? "Publicado · v" + (s.version || 1) : "Borrador") + "</span></div>"
          + "<b>" + esc(s.name) + "</b>" + (pub ? '<a class="url" href="' + esc(liveUrl(s)) + '" target="_blank" rel="noopener">' + esc(liveUrl(s).replace(/^https?:\/\//, "")) + "</a>" : "<small>Sin publicar · " + esc("/w/" + s.slug) + "</small>")
          + '<div class="acts"><button class="wbb pri" data-wba="edit" data-id="' + esc(s.id) + '">Editar</button>' + (pub ? '<button class="wbb" data-wba="open" data-id="' + esc(s.id) + '">Ver</button>' : "") + '<button class="wbb" data-wba="cms" data-id="' + esc(s.id) + '">CMS</button><button class="wbb" data-wba="seo" data-id="' + esc(s.id) + '">SEO</button><button class="wbb" data-wba="move" data-id="' + esc(s.id) + '">Mover</button><button class="wbb" data-wba="del" data-id="' + esc(s.id) + '">Borrar</button></div></div>';
      }).join("") + "</div>";
    }
    body.innerHTML = h;
    thumbs();
  }
  function tplButtons() { var S = SR().STARTERS; return Object.keys(S).map(function (k) { return '<button type="button" data-wbn="new" data-tpl="' + k + '"><b>' + esc(S[k].label) + "</b><small>" + esc(S[k].desc) + "</small></button>"; }).join(""); }
  /* miniatura: la portada en borrador, dibujada con el mismo motor */
  function thumbs() {
    [].forEach.call(document.querySelectorAll("[data-th]"), function (el) {
      var s = siteById(el.getAttribute("data-th")); if (!s || el.firstChild) return;
      api("/rest/v1/website_pages?website_id=eq." + enc(s.id) + "&path=eq./&select=path,title,sections,seo").then(function (r) {
        var pg = (r || [])[0]; if (!pg) return;
        var brand = (W.brands || []).find(function (b) { return b.id === s.brand_id; });
        var html = SR().renderPage(s, pg, { preview: true, brand: brand, collections: [], entries: {} });
        var f = document.createElement("iframe"); f.setAttribute("sandbox", ""); f.setAttribute("aria-hidden", "true"); f.tabIndex = -1; f.srcdoc = html.replace(/<script[\s\S]*?<\/script>/gi, "");
        el.appendChild(f); var sc = el.clientWidth / 1280; f.style.transform = "scale(" + sc + ")";
      }, function () {});
    });
  }
  function newSite(tpl) {
    var ids = realWs(), cur = writeWs();
    return loadBrands().then(function (brands) {
      var fields = [{ name: "name", label: "Nombre del website", placeholder: "Ej. Café Altura · Landing de lanzamiento", required: true }];
      if (ids.length > 1) fields.push({ name: "ws", label: "Espacio", type: "select", value: cur, options: ids.map(function (id) { return { value: id, label: wsName(id) + (wsKind(id) === "agency" ? " · agencia" : "") }; }) });
      var S = SR().STARTERS;
      if (!tpl) fields.push({ name: "tpl", label: "Plantilla", type: "select", value: "landing", options: Object.keys(S).map(function (k) { return { value: k, label: S[k].label + " — " + S[k].desc }; }) });
      var bl = brands.filter(function (b) { return ids.indexOf(b.workspace_id) >= 0; });
      if (bl.length) fields.push({ name: "brand", label: "Marca (toma colores, tipografías y logo)", type: "select", value: "", options: [{ value: "", label: "Sin marca" }].concat(bl.map(function (b) { return { value: b.id, label: b.name + (R.all ? " · " + wsName(b.workspace_id) : "") }; })) });
      fields.push({ name: "preset", label: "Estilo", type: "select", value: "claro", options: [{ value: "claro", label: "Claro" }, { value: "oscuro", label: "Oscuro" }, { value: "editorial", label: "Editorial" }, { value: "suave", label: "Suave" }] });
      return R.dialog({ title: tpl ? "Nuevo website · " + S[tpl].label : "Nuevo website", fields: fields, ok: "Crear", action: "nuevo-website" });
    }).then(function (v) {
      if (!v) return;
      var t = R.progress ? R.progress("Creando tu website", "Armando páginas y CMS…") : null;
      return mcp("create_website", { workspaceId: v.ws || cur, name: v.name.trim(), template: tpl || v.tpl || "landing", brandId: v.brand || undefined, preset: v.preset }).then(function (r) {
        if (t) t.close();
        setCur(r.id); W.sites = null;
        return loadSites().then(function () { var s = siteById(r.id); if (s) openEditor(s); });
      }, function (e) { if (t) t.close(); R.notice("No se pudo crear", msg(e)); });
    });
  }

  /* ═════════════════ selector de website (CMS, SEO, Dominios, Visitas) ═════════════════ */
  function picker(after) {
    var s = siteById(W.cur);
    return '<div class="wb-top"><select data-wbpick aria-label="Website">' + (W.sites || []).map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === W.cur ? " selected" : "") + ">" + esc(x.name) + (R.all ? " · " + esc(wsName(x.workspace_id)) : "") + "</option>"; }).join("") + "</select>"
      + (s ? '<button class="wbb" data-wba="edit" data-id="' + esc(s.id) + '">Editar páginas</button>' + (s.status === "published" ? '<button class="wbb" data-wba="open" data-id="' + esc(s.id) + '">Ver en vivo</button>' : "") : "") + '<span class="sp"></span>' + (after || "") + "</div>";
  }
  function needSites(fn) {
    var body = document.getElementById("body"); if (!body) return false;
    if (!W.sites) { body.innerHTML = '<div class="wb-note">Cargando…</div>'; loadSites().then(function () { if (onWeb()) fn(); }); return false; }
    if (!W.sites.length) { body.innerHTML = '<div class="wb-empty"><b>Primero crea un website</b><p>Luego aquí manejas su contenido, SEO, dominio y visitas.</p><button class="wbb pri" data-wbn="new">+ Nuevo website</button></div>'; return false; }
    return true;
  }

  /* ═════════════════ vista: CMS ═════════════════ */
  var C = { col: null };
  function drawCms() {
    if (!needSites(drawCms)) return;
    var body = document.getElementById("body"), s = siteById(W.cur);
    var cms = W.cms[s.id];
    if (!cms) { body.innerHTML = picker() + '<div class="wb-note">Cargando el CMS…</div>'; loadCms(s.id).then(function () { if (onWeb()) drawCms(); }); return; }
    var cols = cms.collections;
    if (!cols.some(function (c) { return c.id === C.col; })) C.col = cols[0] ? cols[0].id : null;
    var h = picker('<button class="wbb" data-wbc="newcol">+ Colección</button>' + (C.col ? '<button class="wbb pri" data-wbc="newent">+ Nueva entrada</button>' : ""));
    h += '<div class="wb-note">El contenido que cambia seguido. Crea colecciones (blog, productos, casos, equipo…) con los campos que necesites. Una entrada <b>publicada</b> aparece al instante en la web, en el sitemap, en <code>llms.txt</code> y en el RSS, sin volver a publicar el sitio.</div>';
    if (!cols.length) { body.innerHTML = h + '<div class="wb-empty"><b>Este website no tiene colecciones</b><p>Crea una para tu blog, tus productos o tus casos de éxito.</p><button class="wbb pri" data-wbc="newcol">+ Crear colección</button></div>'; return; }
    var c = cols.find(function (x) { return x.id === C.col; }), all = (cms.all[c.slug] || []);
    h += '<div class="wb-panel"><div class="wb-tabs">' + cols.map(function (x) { return '<button data-wbc="col" data-id="' + esc(x.id) + '" class="' + (x.id === C.col ? "on" : "") + '">' + esc(x.name) + " · " + (cms.all[x.slug] || []).length + "</button>"; }).join("") + '</div>'
      + '<div class="wb-top" style="margin-bottom:8px"><small style="color:#555">Ruta <code>' + esc(SR().colPath(c)) + "</code> · " + (c.fields || []).length + ' campos · schema ' + esc((c.settings || {}).schema || "—") + '</small><span class="sp"></span><button class="wbb" data-wbc="editcol">Campos y ajustes</button>' + (s.status === "published" ? '<button class="wbb" data-wbc="opencol">Ver lista</button>' : "") + "</div>";
    if (!all.length) h += '<p>Sin entradas todavía. <button class="wbb pri" data-wbc="newent">Escribir la primera</button></p>';
    else h += '<div style="overflow-x:auto"><table class="wb-tbl"><thead><tr><th>Título</th><th>Estado</th><th>Fecha</th><th class="r"></th></tr></thead><tbody>' + all.map(function (e) {
      var sched = e.status === "published" && e.publish_at && Date.parse(e.publish_at) > Date.now();
      return '<tr><td><b>' + esc(e.title) + '</b><br><small style="color:#777">' + esc(SR().entryUrl(c, e)) + '</small></td><td><span class="wbc ' + (e.status === "published" ? (sched ? "dr" : "ok") : "") + '">' + (e.status === "published" ? (sched ? "Programada " + new Date(e.publish_at).toLocaleDateString() : "Publicada") : "Borrador") + "</span></td><td>" + esc(SR().fmtDate(SR().entryDate(c, e))) + '</td><td class="r" style="white-space:nowrap"><button class="wbb" data-wbc="edit" data-id="' + esc(e.id) + '">Editar</button> ' + (e.status === "published" && s.status === "published" ? '<button class="wbb" data-wbc="view" data-id="' + esc(e.id) + '">Ver</button> ' : "") + '<button class="wbb" data-wbc="del" data-id="' + esc(e.id) + '">Borrar</button></td></tr>';
    }).join("") + "</tbody></table></div>";
    h += "</div>";
    body.innerHTML = h;
  }
  function colFields(c) { return (c && c.fields) || []; }
  function entryForm(s, c, e) {
    e = e || { title: "", slug: "", status: "draft", data: {}, seo: {} };
    var d = e.data || {}, fields = [];
    var html = '<div class="wb-panel" style="padding:0;background:transparent"><label class="f">Título<input type="text" name="__title" value="' + esc(e.title) + '" required></label>'
      + '<div class="wb-grid2"><label class="f">URL<input type="text" name="__slug" value="' + esc(e.slug) + '" placeholder="se crea sola del título"><small>' + esc(SR().colPath(c)) + '/…</small></label><label class="f">Estado<select name="__status"><option value="draft"' + (e.status !== "published" ? " selected" : "") + '>Borrador</option><option value="published"' + (e.status === "published" ? " selected" : "") + '>Publicada (se ve al instante)</option></select></label></div>'
      + '<label class="f">Publicar desde (opcional)<input type="datetime-local" name="__at" value="' + esc(e.publish_at ? new Date(new Date(e.publish_at).getTime() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : "") + '"><small>Si pones una fecha futura, la entrada queda oculta hasta ese momento.</small></label>';
    colFields(c).forEach(function (f) {
      var v = d[f.k], nm = "f_" + f.k;
      if (f.type === "richtext") html += '<label class="f">' + esc(f.label) + '<textarea class="mono" name="' + nm + '" rows="12">' + esc(v || "") + '</textarea><small>Markdown: ## subtítulo, **negrita**, [enlace](https://…), - listas, ![imagen](url)</small></label>';
      else if (f.type === "textarea") html += '<label class="f">' + esc(f.label) + '<textarea name="' + nm + '" rows="3">' + esc(v || "") + "</textarea></label>";
      else if (f.type === "image") html += '<label class="f">' + esc(f.label) + '<span style="display:flex;gap:6px"><input type="url" name="' + nm + '" value="' + esc(v || "") + '" placeholder="https://…" style="flex:1"><button type="button" class="wbb" data-wbup="' + nm + '">Subir</button></span></label>';
      else if (f.type === "bool") html += '<label class="ck"><input type="checkbox" name="' + nm + '"' + (v ? " checked" : "") + "> " + esc(f.label) + "</label>";
      else if (f.type === "select") html += '<label class="f">' + esc(f.label) + '<select name="' + nm + '"><option value=""></option>' + (f.opts || []).map(function (o) { return "<option" + (o === v ? " selected" : "") + ">" + esc(o) + "</option>"; }).join("") + "</select></label>";
      else if (f.type === "tags") html += '<label class="f">' + esc(f.label) + '<input type="text" name="' + nm + '" value="' + esc(Array.isArray(v) ? v.join(", ") : v || "") + '" placeholder="separadas por coma"></label>';
      else html += '<label class="f">' + esc(f.label) + '<input type="' + (f.type === "date" ? "date" : f.type === "number" ? "number" : f.type === "url" ? "url" : "text") + '" name="' + nm + '" value="' + esc(v == null ? "" : v) + '"></label>';
    });
    var seo = e.seo || {};
    html += '<details style="margin-top:6px"><summary style="cursor:pointer;font:700 13px var(--sans);color:#333;margin-bottom:8px">SEO de la entrada</summary><label class="f">Título para Google<input type="text" name="__seot" value="' + esc(seo.title || "") + '"></label><label class="f">Descripción<textarea name="__seod" rows="2">' + esc(seo.description || "") + '</textarea></label><label class="ck"><input type="checkbox" name="__noi"' + (seo.noindex ? " checked" : "") + "> No mostrar en buscadores</label></details></div>";
    return html;
  }
  function editEntry(s, c, e) {
    var title = e ? "Editar entrada" : "Nueva entrada · " + c.name;
    var p = R.dialog({ title: title, body: entryForm(s, c, e), ok: "Guardar", wide: 2, action: "cms-entrada" });
    setTimeout(bindUploads, 30);
    var form = null;
    setTimeout(function () { form = document.querySelector('[data-musa-dialog="cms-entrada"] form'); }, 20);
    return p.then(function (v) {
      if (v === null || !form) return;
      var el = form.elements, data = {};
      colFields(c).forEach(function (f) {
        var x = el["f_" + f.k]; if (!x) return;
        var val = f.type === "bool" ? x.checked : x.value;
        if (f.type === "number") val = val === "" ? null : +val;
        if (f.type === "tags") val = String(val).split(",").map(function (t) { return t.trim(); }).filter(Boolean);
        data[f.k] = val;
      });
      var at = el.__at.value;
      var args = { siteId: s.id, collection: c.id, title: el.__title.value.trim(), slug: el.__slug.value.trim() || undefined, status: el.__status.value, publishAt: at ? new Date(at).toISOString() : null, data: data, seo: { title: el.__seot.value.trim(), description: el.__seod.value.trim(), noindex: el.__noi.checked } };
      if (e) args.id = e.id;
      if (!args.title) return R.notice("Falta el título", "Escribe un título para la entrada.");
      return mcp("save_website_entry", args).then(function (r) {
        toast(r.live ? "Publicada: ya se ve en la web" : "Entrada guardada");
        return loadCms(s.id, true).then(function () { if (onWeb()) drawCms(); });
      }, function (x) { R.notice("No se pudo guardar", msg(x)); });
    });
  }
  /* el diálogo se cierra al enviar: copiamos los valores antes en un formulario fantasma */
  function bindUploads() {
    [].forEach.call(document.querySelectorAll("[data-wbup]"), function (b) {
      if (b._wb) return; b._wb = 1;
      b.addEventListener("click", function () {
        var input = b.closest("form").elements[b.getAttribute("data-wbup")];
        pickImage().then(function (u) { if (u) { input.value = u; input.dispatchEvent(new Event("input", { bubbles: true })); } });
      });
    });
  }
  function pickImage() {
    return new Promise(function (res) {
      var f = document.createElement("input"); f.type = "file"; f.accept = "image/*";
      f.onchange = function () {
        var file = f.files && f.files[0]; if (!file) return res(null);
        if (file.size > 8 * 1024 * 1024) { R.notice("Imagen muy pesada", "Sube una imagen de hasta 8 MB."); return res(null); }
        var rd = new FileReader();
        rd.onload = function () {
          toast("Subiendo imagen…");
          (R.uploadData ? R.uploadData(rd.result, file.name) : Promise.reject(new Error("Subida no disponible"))).then(function (u) { toast("Imagen subida"); res(u); }, function (e) { R.notice("No se pudo subir", msg(e)); res(null); });
        };
        rd.readAsDataURL(file);
      };
      f.click();
    });
  }
  function editCollection(s, c) {
    var F = SR().FIELD_TYPES, SC = SR().SCHEMAS, st = (c && c.settings) || {};
    var rows = (c ? c.fields : [{ k: "cover", label: "Portada", type: "image" }, { k: "excerpt", label: "Resumen", type: "textarea" }, { k: "body", label: "Contenido", type: "richtext" }]).map(function (f) { return f.label + " : " + f.type + (f.opts ? " : " + f.opts.join("|") : ""); }).join("\n");
    return R.dialog({
      title: c ? "Colección «" + c.name + "»" : "Nueva colección", wide: true, action: "cms-coleccion", ok: "Guardar",
      fields: [
        { name: "name", label: "Nombre", value: c ? c.name : "", placeholder: "Blog, Productos, Casos…", required: true },
        { name: "path", label: "Ruta en la web", value: st.path || "", placeholder: "/blog" },
        { name: "schema", label: "Qué es (para Google y las IAs)", type: "select", value: st.schema == null ? "BlogPosting" : st.schema, options: SC.map(function (x) { return { value: x[0], label: x[1] }; }) },
        { name: "fields", label: "Campos (uno por línea: Nombre : tipo)", type: "textarea", rows: 8, value: rows, hint: "Tipos: " + F.map(function (x) { return x[0] + " (" + x[1].toLowerCase() + ")"; }).join(", ") + ". Para opciones: Talla : select : S|M|L" },
        { name: "detail", label: "Cada entrada tiene su propia página", type: "checkbox", value: st.detail !== false },
        { name: "rss", label: "Publicar RSS", type: "checkbox", value: st.rss !== false },
        { name: "desc", label: "Descripción de la lista (SEO)", value: st.description || "" },
      ],
      validate: function (v) { var bad = String(v.fields).split(/\n/).map(function (l) { return l.trim(); }).filter(Boolean).filter(function (l) { var t = (l.split(":")[1] || "").trim(); return !F.some(function (x) { return x[0] === t; }); }); return bad.length ? "Tipo desconocido en: " + bad[0] : ""; },
    }).then(function (v) {
      if (!v) return;
      var prev = {}; ((c && c.fields) || []).forEach(function (f) { prev[f.label.toLowerCase()] = f.k; });
      var fields = String(v.fields).split(/\n/).map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) { var p = l.split(":").map(function (x) { return x.trim(); }); var f = { label: p[0], type: p[1] }; f.k = prev[p[0].toLowerCase()] || SR().slugify(p[0]).replace(/-/g, "_"); if (p[1] === "select") f.opts = (p[2] || "").split("|").map(function (o) { return o.trim(); }).filter(Boolean); return f; });
      var args = { siteId: s.id, name: v.name.trim(), fields: fields, settings: { path: v.path || undefined, schema: v.schema, detail: v.detail, rss: v.rss, description: v.desc, title: v.name.trim() } };
      if (c) args.id = c.id;
      return mcp("save_website_collection", args).then(function (r) { C.col = r.collection.id; toast("Colección guardada"); return loadCms(s.id, true).then(function () { if (onWeb()) drawCms(); }); }, function (x) { R.notice("No se pudo guardar", msg(x)); });
    });
  }

  /* ═════════════════ vista: SEO e IA ═════════════════ */
  function ring(v, label, sub) {
    var r = 40, c = 2 * Math.PI * r, col = v >= 80 ? "#0f9d58" : v >= 55 ? "#e08a00" : "#d7261e";
    return '<div class="wb-ring"><svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label="' + esc(label + ": " + v + " de 100") + '"><circle cx="48" cy="48" r="' + r + '" fill="none" stroke="#e1dfd2" stroke-width="9"/><circle cx="48" cy="48" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="9" stroke-linecap="round" stroke-dasharray="' + (c * v / 100).toFixed(1) + " " + c.toFixed(1) + '" transform="rotate(-90 48 48)"/><text x="48" y="55" text-anchor="middle" font-family="Inter,sans-serif" font-size="22" font-weight="800" fill="#111">' + v + "</text></svg><b>" + esc(label) + "</b><small>" + esc(sub) + "</small></div>";
  }
  function drawSeo() {
    if (!needSites(drawSeo)) return;
    var body = document.getElementById("body"), s = siteById(W.cur);
    body.innerHTML = picker() + '<div class="wb-note">Revisando tus páginas…</div>';
    Promise.all([api("/rest/v1/website_pages?website_id=eq." + enc(s.id) + "&select=id,path,title,sections,seo,hidden&order=sort"), loadCms(s.id), loadBrands()]).then(function (r) {
      if (!onWeb() || route.sub !== "seo") return;
      var pages = (r[0] || []).filter(function (p) { return !p.hidden; }), cms = r[1];
      var ctx = { origin: APP, base: "/w/" + s.slug, collections: cms.collections, entries: cms.entries };
      var res = pages.map(function (p) { return { p: p, a: SR().audit(s, p, ctx) }; });
      var avg = function (k) { return res.length ? Math.round(res.reduce(function (a, x) { return a + x.a[k]; }, 0) / res.length) : 0; };
      var st = s.settings || {}, ai = st.ai || {}, org = st.org || {}, an = st.analytics || {};
      var h = picker();
      h += '<div class="wb-panel"><h4>Cómo te ven Google y las IAs</h4><div class="wb-score">' + ring(avg("score"), "Total", "promedio") + ring(avg("seo"), "SEO", "Google") + ring(avg("geo"), "GEO", "ChatGPT, Claude, Perplexity") + ring(avg("aeo"), "AEO", "respuestas directas") + "</div><p>Revisión sin IA, al instante, sobre el borrador. Corrige y vuelve a publicar.</p></div>";
      h += '<div class="wb-panel"><h4>Qué mejorar</h4>' + res.map(function (x) {
        var bad = x.a.checks.filter(function (c) { return !c.ok; });
        return '<div style="margin:0 0 10px"><div style="display:flex;gap:8px;align-items:center;margin:8px 0 2px"><b style="font-size:14px">' + esc(x.p.title || x.p.path) + '</b><code style="font-size:11px">' + esc(x.p.path) + '</code><span class="wbc ' + (x.a.score >= 80 ? "ok" : x.a.score >= 55 ? "dr" : "bad") + '">' + x.a.score + "/100</span></div>"
          + (bad.length ? '<ul class="wb-fix">' + bad.map(function (c) { return '<li><i class="' + c.group + '">' + c.group.toUpperCase() + "</i><span>" + esc(c.text) + "<small>" + esc(c.fix) + '</small></span><button class="wbb" data-wbfix="' + esc(x.p.id) + '" data-sec="' + esc(c.section || "") + '" data-g="' + esc(c.group) + '">Arreglar</button></li>'; }).join("") + "</ul>" : '<p style="color:#0f6b36;margin:4px 0">Todo en orden en esta página.</p>') + "</div>";
      }).join("") + "</div>";
      var pubBase = liveUrl(s).replace(/\/$/, "");
      h += '<form class="wb-panel" data-wbseo><h4>Ajustes de SEO e IA del sitio</h4>'
        + '<div class="wb-grid2"><label class="f">Plantilla del título<input type="text" name="titleTemplate" value="' + esc(st.titleTemplate || "%s · " + s.name) + '"><small>%s = título de cada página</small></label><label class="f">Frase de la portada (tagline)<input type="text" name="tagline" value="' + esc(st.tagline || "") + '" placeholder="Café de especialidad en Lima"></label></div>'
        + '<label class="f">Descripción del sitio<textarea name="description" rows="2" placeholder="Lo que saldrá en Google si una página no tiene la suya">' + esc(st.description || "") + "</textarea></label>"
        + '<div class="wb-grid2"><label class="f">Imagen para compartir (1200×630)<span style="display:flex;gap:6px"><input type="url" name="ogImage" value="' + esc(st.ogImage || "") + '" style="flex:1"><button type="button" class="wbb" data-wbup2="ogImage">Subir</button></span></label><label class="f">Idioma<select name="lang">' + [["es", "Español"], ["en", "English"], ["pt", "Português"]].map(function (l) { return '<option value="' + l[0] + '"' + ((st.lang || "es") === l[0] ? " selected" : "") + ">" + l[1] + "</option>"; }).join("") + "</select></label></div>"
        + "<h4 style=\"margin-top:10px\">Para buscadores de IA (GEO)</h4><label class=\"f\">Resumen para IA<textarea name=\"ai_summary\" rows=\"3\" placeholder=\"Quién eres, qué haces, para quién y dónde. Ej.: Café Altura es una tostaduría de especialidad en Lima que vende café de origen peruano a cafeterías y hogares, con envíos a todo el Perú.\">" + esc(ai.summary || "") + "</textarea><small>Es lo primero que leen ChatGPT, Claude o Perplexity en tu llms.txt. Escribe hechos, no adjetivos.</small></label>"
        + '<label class="f">Datos clave (uno por línea)<textarea name="ai_facts" rows="3" placeholder="- Fundada en 2016&#10;- +120 cafeterías clientes&#10;- Envío en 24 h en Lima">' + esc(ai.facts || "") + "</textarea></label>"
        + '<label class="ck"><input type="checkbox" name="ai_llms"' + (ai.llms !== false ? " checked" : "") + '><span>Publicar llms.txt<small>Un resumen del sitio en markdown para IAs: <a href="' + esc(pubBase + "/llms.txt") + '" target="_blank" rel="noopener">llms.txt</a> · <a href="' + esc(pubBase + "/llms-full.txt") + '" target="_blank" rel="noopener">llms-full.txt</a></small></span></label>'
        + '<label class="ck"><input type="checkbox" name="ai_bots"' + (ai.allowBots !== false ? " checked" : "") + "><span>Permitir buscadores de IA<small>GPTBot, ClaudeBot, PerplexityBot, Google-Extended… Si lo apagas, no podrán citarte.</small></span></label>"
        + '<label class="ck"><input type="checkbox" name="index"' + (st.index !== false ? " checked" : "") + '><span>Visible en Google<small><a href="' + esc(pubBase + "/sitemap.xml") + '" target="_blank" rel="noopener">sitemap.xml</a> · <a href="' + esc(pubBase + "/robots.txt") + '" target="_blank" rel="noopener">robots.txt</a></small></span></label>'
        + '<h4 style="margin-top:10px">Organización (datos estructurados)</h4><div class="wb-grid2"><label class="f">Tipo<select name="org_type">' + [["Organization", "Empresa u organización"], ["LocalBusiness", "Negocio local"], ["ProfessionalService", "Servicio profesional"], ["Store", "Tienda"], ["Restaurant", "Restaurante / café"], ["Person", "Persona"]].map(function (o) { return '<option value="' + o[0] + '"' + ((org.type || "Organization") === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + '</select></label><label class="f">Nombre legal o comercial<input type="text" name="org_name" value="' + esc(org.name || s.name) + '"></label>'
        + '<label class="f">Correo<input type="email" name="org_email" value="' + esc(org.email || "") + '"></label><label class="f">Teléfono<input type="text" name="org_phone" value="' + esc(org.phone || "") + '"></label></div>'
        + '<label class="f">Dirección<input type="text" name="org_address" value="' + esc(typeof org.address === "string" ? org.address : "") + '" placeholder="Av. Larco 123, Miraflores, Lima, Perú"></label>'
        + '<label class="f">Perfiles (uno por línea)<textarea name="org_same" rows="3" placeholder="https://instagram.com/tumarca&#10;https://www.linkedin.com/company/tumarca&#10;https://g.page/tumarca">' + esc((org.sameAs || []).join("\n")) + "</textarea><small>Redes, Google Business, LinkedIn, Wikipedia: ayudan a que las IAs te reconozcan como entidad.</small></label>"
        + '<h4 style="margin-top:10px">Analítica (opcional)</h4><div class="wb-grid2"><label class="f">Google Analytics 4<input type="text" name="ga" value="' + esc(an.ga || "") + '" placeholder="G-XXXXXXX"></label><label class="f">Meta Pixel<input type="text" name="pixel" value="' + esc(an.pixel || "") + '" placeholder="1234567890"></label></div>'
        + '<div class="wb-top" style="margin:6px 0 0"><span class="sp"></span><button type="submit" class="wbb pri">Guardar ajustes</button></div><p style="margin-top:8px">Se aplican a la web al publicar.</p></form>';
      body.innerHTML = h;
      [].forEach.call(body.querySelectorAll("[data-wbup2]"), function (b) { b.onclick = function () { var i = b.closest("form").elements[b.getAttribute("data-wbup2")]; pickImage().then(function (u) { if (u) i.value = u; }); }; });
    }, function (e) { body.innerHTML = picker() + '<div class="wb-panel"><p>' + esc(msg(e)) + "</p></div>"; });
  }
  function saveSeo(form) {
    var s = siteById(W.cur), el = form.elements, st = JSON.parse(JSON.stringify(s.settings || {}));
    st.titleTemplate = el.titleTemplate.value.trim(); st.tagline = el.tagline.value.trim(); st.description = el.description.value.trim(); st.ogImage = el.ogImage.value.trim(); st.lang = el.lang.value; st.index = el.index.checked;
    st.ai = Object.assign({}, st.ai, { summary: el.ai_summary.value.trim(), facts: el.ai_facts.value.trim(), llms: el.ai_llms.checked, allowBots: el.ai_bots.checked });
    st.org = Object.assign({}, st.org, { type: el.org_type.value, name: el.org_name.value.trim(), email: el.org_email.value.trim(), phone: el.org_phone.value.trim(), address: el.org_address.value.trim(), sameAs: el.org_same.value.split(/\n/).map(function (x) { return x.trim(); }).filter(function (x) { return /^https?:\/\//.test(x); }) });
    st.analytics = { ga: el.ga.value.trim(), pixel: el.pixel.value.trim() };
    return api("/rest/v1/websites?id=eq." + enc(s.id), J("PATCH", { settings: st, updated_by: uid() })).then(function (r) {
      s.settings = st; toast("Ajustes guardados · publica para aplicarlos");
      return R.confirmBox("Los ajustes quedaron guardados. ¿Publicar ahora para que se apliquen en la web?", { title: "Guardado", ok: "Publicar", cancel: "Después" }).then(function (ok) { if (ok) return publish(s).then(drawSeo); drawSeo(); });
    }, function (e) { R.notice("No se pudo guardar", msg(e)); });
  }

  /* ═════════════════ vista: Dominios y conexiones ═════════════════ */
  function drawDom() {
    if (!needSites(drawDom)) return;
    var body = document.getElementById("body"), s = siteById(W.cur);
    body.innerHTML = picker() + '<div class="wb-note">Cargando…</div>';
    Promise.all([mcp("get_website", { id: s.id }), mcp("website_integrations", { siteId: s.id })]).then(function (r) {
      if (!onWeb() || route.sub !== "dominios") return;
      var g = r[0], it = r[1], lim = g.limits || {};
      var h = picker();
      h += '<div class="wb-panel"><h4>Dirección de Musa</h4><p>Siempre disponible, gratis y con HTTPS.</p><div class="wb-dns"><code>' + esc(g.urls.musa) + '</code></div><div class="wb-top" style="margin:0"><button class="wbb" data-wbcopy="' + esc(g.urls.musa) + '">Copiar</button>' + (g.status === "published" ? '<a class="wbb" href="' + esc(g.urls.musa) + '" target="_blank" rel="noopener" style="text-decoration:none">Abrir</a>' : '<span style="font-size:12px;color:#8a5200">Publica el website para que responda.</span>') + "</div></div>";
      h += '<div class="wb-panel"><h4>Dominio propio</h4>';
      if (lim.custom_domains === 0) h += '<p>Tu plan gratis publica en la dirección de Musa, con el sello «Hecho con Musa». Con el plan <b>Creador</b> o superior conectas tu propio dominio (www.tumarca.com) y quitas el sello.</p><button class="wbb pri" data-wbplan>Ver planes</button>';
      else {
        h += '<p>Conecta un dominio que ya tengas. Te damos los registros DNS para pegar en tu proveedor (GoDaddy, Namecheap, Cloudflare, Punto.pe…).</p>';
        h += (g.domains || []).map(function (d) {
          var det = d.details || {};
          return '<div class="wb-dns"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="font-size:14px">' + esc(d.hostname) + '</b><span class="wbc ' + (d.status === "active" ? "ok" : d.status === "error" ? "bad" : "dr") + '">' + ({ active: "Activo", verifying: "Verificado · falta apuntar", pending: "Esperando DNS", error: "Error" }[d.status] || d.status) + '</span><span style="flex:1"></span><button class="wbb" data-wbdom="check" data-id="' + esc(d.id) + '">Comprobar</button><button class="wbb" data-wbdom="del" data-id="' + esc(d.id) + '">Quitar</button></div>'
            + (d.status !== "active" ? '<div style="margin-top:8px;font-size:12px;color:#444">Registro <b>TXT</b> · nombre <code>_musa.' + esc(d.hostname) + "</code> · valor <code>musa-verify=" + esc(d.verify_token || "…") + "</code></div>" : "") + (det.error ? '<div style="color:#a3261d;font-size:12px;margin-top:6px">' + esc(det.error) + "</div>" : "") + "</div>";
        }).join("");
        h += '<form data-wbdomadd class="wb-top" style="margin:8px 0 0"><input class="wb-in" name="host" placeholder="www.tumarca.com" style="flex:1;min-width:200px;border-color:#111;color:#111" aria-label="Dominio"><button class="wbb pri" type="submit">Conectar dominio</button></form>';
        if (lim.custom_domains != null) h += '<p style="margin-top:8px;font-size:12px">Tu plan incluye ' + lim.custom_domains + " dominio(s) propio(s).</p>";
      }
      h += "</div>";
      var ghc = it.github || {}, sbc = it.supabase || {};
      h += '<div class="wb-panel"><h4>GitHub</h4><p>Sube el sitio publicado como HTML estático a tu repositorio en un solo commit: páginas, CMS, sitemap, robots, llms.txt, RSS y página 404. Sirve para GitHub Pages, Netlify o Vercel, o para que tu equipo técnico lo siga trabajando. Los formularios siguen llegando a Musa.</p>'
        + (ghc.connected ? '<div class="wb-dns">Conectado a <b>' + esc(ghc.repo) + "</b> · rama <code>" + esc(ghc.branch) + "</code>" + (ghc.dir ? " · carpeta <code>" + esc(ghc.dir) + "</code>" : "") + (ghc.lastSync ? '<br><span style="color:#666">Última subida: ' + esc(new Date(ghc.lastSync).toLocaleString()) + " · " + (ghc.files || 0) + " archivos</span>" : "") + '</div><div class="wb-top" style="margin:0"><button class="wbb pri" data-wbgh="sync">Subir a GitHub</button><button class="wbb" data-wbgh="conn">Cambiar</button><button class="wbb" data-wbgh="off">Desconectar</button></div>' : '<button class="wbb pri" data-wbgh="conn">Conectar GitHub</button>')
        + "</div>";
      h += '<div class="wb-panel"><h4>Supabase propio</h4><p>Copia cada lead de los formularios a la tabla <code>musa_leads</code> de tu proyecto, y el CMS a <code>musa_cms_entries</code> para usarlo desde tu propio frontend. La llave se guarda cifrada.</p>'
        + (sbc.connected ? '<div class="wb-dns">Conectado a <b>' + esc(sbc.url) + "</b>" + (sbc.tables === false ? '<br><span style="color:#a3261d">Faltan las tablas: corre el SQL de abajo en tu proyecto.</span>' : "") + (sbc.lastSync ? '<br><span style="color:#666">CMS copiado: ' + esc(new Date(sbc.lastSync).toLocaleString()) + " · " + (sbc.entries || 0) + " entradas</span>" : "") + '</div><div class="wb-top" style="margin:0"><button class="wbb pri" data-wbsb="sync">Copiar CMS ahora</button><button class="wbb" data-wbsb="conn">Cambiar</button><button class="wbb" data-wbsb="off">Desconectar</button></div>' : '<button class="wbb pri" data-wbsb="conn">Conectar Supabase</button>')
        + '<details style="margin-top:10px"><summary style="cursor:pointer;font:700 13px var(--sans)">SQL para tu proyecto</summary><textarea class="mono" readonly rows="12" style="margin-top:8px">' + esc(it.supabaseSql || "") + '</textarea><button class="wbb" style="margin-top:6px" data-wbcopy-sql>Copiar SQL</button></details></div>';
      body.innerHTML = h;
      W._sql = it.supabaseSql || "";
    }, function (e) { body.innerHTML = picker() + '<div class="wb-panel"><p>' + esc(msg(e)) + "</p></div>"; });
  }

  /* ═════════════════ vista: Visitas ═════════════════ */
  function drawStats() {
    if (!needSites(drawStats)) return;
    var body = document.getElementById("body"), s = siteById(W.cur), days = W.days || 30;
    body.innerHTML = picker('<select data-wbdays aria-label="Periodo">' + [[7, "7 días"], [30, "30 días"], [90, "90 días"]].map(function (d) { return '<option value="' + d[0] + '"' + (d[0] === days ? " selected" : "") + ">" + d[1] + "</option>"; }).join("") + "</select>") + '<div class="wb-note">Cargando visitas…</div>';
    mcp("website_stats", { id: s.id, days: days }).then(function (st) {
      if (!onWeb() || route.sub !== "visitas") return;
      var max = Math.max.apply(null, st.series.map(function (x) { return x.views; }).concat([1]));
      var h = picker('<select data-wbdays aria-label="Periodo">' + [[7, "7 días"], [30, "30 días"], [90, "90 días"]].map(function (d) { return '<option value="' + d[0] + '"' + (d[0] === days ? " selected" : "") + ">" + d[1] + "</option>"; }).join("") + "</select>");
      h += '<div class="wb-panel"><div class="wb-kpi"><div><b>' + st.total.toLocaleString() + "</b><small>visitas</small></div><div><b>" + st.leads.toLocaleString() + "</b><small>leads de sus formularios</small></div><div><b>" + (st.total ? (st.leads * 100 / st.total).toFixed(1) + "%" : "—") + "</b><small>conversión</small></div><div><b>" + (st.pages[0] ? esc(st.pages[0].key) : "—") + "</b><small>página más vista</small></div></div>"
        + '<div class="wb-bars" role="img" aria-label="Visitas por día">' + st.series.map(function (x) { return '<i style="height:' + Math.max(1.5, x.views * 100 / max) + '%" data-t="' + esc(x.day.slice(5) + " · " + x.views) + '"></i>'; }).join("") + '</div><div style="display:flex;justify-content:space-between;font-size:11px;color:#666"><span>' + esc(st.series[0].day) + "</span><span>" + esc(st.series[st.series.length - 1].day) + "</span></div>"
        + '<p style="margin-top:10px">' + esc(st.note) + "</p></div>";
      h += '<div class="wb-grid2"><div class="wb-panel"><h4>Páginas</h4>' + (st.pages.length ? '<table class="wb-tbl"><tbody>' + st.pages.map(function (p) { return "<tr><td>" + esc(p.key) + '</td><td class="r">' + p.views + "</td></tr>"; }).join("") + "</tbody></table>" : "<p>Aún sin visitas.</p>") + '</div><div class="wb-panel"><h4>De dónde llegan</h4>' + (st.referrers.length ? '<table class="wb-tbl"><tbody>' + st.referrers.map(function (p) { return "<tr><td>" + esc(p.key) + '</td><td class="r">' + p.views + "</td></tr>"; }).join("") + "</tbody></table>" : "<p>Directo o sin datos de origen todavía.</p>") + "</div></div>";
      body.innerHTML = h;
    }, function (e) { body.innerHTML = picker() + '<div class="wb-panel"><p>' + esc(msg(e)) + "</p></div>"; });
  }

  /* ═════════════════ publicar ═════════════════ */
  function publish(s) {
    var t = R.progress ? R.progress("Publicando", "Preparando páginas, SEO y archivos para buscadores…") : null;
    return mcp("publish_website", { id: s.id }).then(function (r) {
      if (t) t.close();
      s.status = "published"; s.version = r.version; s.published_at = new Date().toISOString();
      if (E && E.site.id === s.id) { E.dirtyPub = false; topState(); }
      var url = r.urls.live;
      var body = '<div class="wb-panel" style="margin:0"><p>Tu website está en línea (versión ' + r.version + ").</p><div class=\"wb-dns\"><code>" + esc(url) + "</code></div>" + (r.warnings && r.warnings.length ? '<p style="color:#8a5200;margin-top:8px"><b>Revisa:</b></p><ul class="w">' + r.warnings.map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("") + "</ul>" : "") + '<p style="margin-top:8px"><a href="' + esc(url) + '" target="_blank" rel="noopener" style="color:#ff5e00;font-weight:700">Abrir el website ↗</a></p></div>';
      R.notice("¡Publicado!", "", { body: body, action: "website-publicado" });
      W.sites && W.sites.forEach(function (x) { if (x.id === s.id) { x.status = "published"; x.version = r.version; } });
    }, function (e) { if (t) t.close(); R.notice("No se pudo publicar", msg(e)); });
  }

  /* ═════════════════ editor visual ═════════════════ */
  var E = null;
  var IC = {
    back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    undo: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
    redo: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/></svg>',
    desk: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
    tab: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M11 18h2"/></svg>',
    mob: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>',
    ext: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
    pages: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
    secs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="6" rx="1.5"/><rect x="3" y="12" width="18" height="9" rx="1.5"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  };
  var DEV = { desk: [1280, 0], tab: [820, 1180], mob: [390, 844] };

  function openEditor(s, pageId) {
    setCur(s.id);
    var ed = document.getElementById("wbEd");
    if (!ed) { ed = document.createElement("div"); ed.id = "wbEd"; ed.setAttribute("role", "dialog"); ed.setAttribute("aria-label", "Editor de website"); document.body.appendChild(ed); bindEditor(ed); }
    ed.hidden = false; ed.innerHTML = '<div class="wtop"><button class="tb" data-e="close">' + IC.back + ' Websites</button><span class="st">Abriendo…</span></div>';
    document.documentElement.style.overflow = "hidden";
    Promise.all([
      api("/rest/v1/websites?id=eq." + enc(s.id) + "&select=" + SITE_COLS),
      api("/rest/v1/website_pages?website_id=eq." + enc(s.id) + "&select=*&order=sort"),
      loadCms(s.id, true), loadBrands(), loadForms(s.workspace_id), loadTpls(s.workspace_id),
    ]).then(function (r) {
      var site = (r[0] || [])[0]; if (!site) throw new Error("No encontré el website");
      E = { site: site, pages: r[1] || [], cur: null, sel: null, tab: "secs", dev: NARROW.matches ? "mob" : "desk", hist: [], fut: [], saving: 0, dirty: {}, scrollY: 0, dirtyPub: false, sheet: null };
      var pub = site.published_at ? Date.parse(site.published_at) : 0;
      E.dirtyPub = site.status !== "published" || Date.parse(site.updated_at) > pub + 2000 || E.pages.some(function (p) { return Date.parse(p.updated_at) > pub + 2000; });
      E.cur = (E.pages.find(function (p) { return p.id === pageId; }) || E.pages.find(function (p) { return p.path === "/"; }) || E.pages[0] || {}).id;
      try { history.replaceState(null, "", "#websites/sitios/web:" + site.id); } catch (e) {}
      // resolver diseños usados en las secciones (para la vista previa)
      var need = []; E.pages.forEach(function (p) { (p.sections || []).forEach(function (x) { if (x.type === "design" && x.props && x.props.templateId) need.push(x.props.templateId); }); });
      return Promise.all(need.map(loadTplData)).then(function () { drawEditor(); });
    }).catch(function (e) { closeEditor(); R.notice("No se pudo abrir", msg(e)); });
  }
  function closeEditor() {
    var ed = document.getElementById("wbEd"); if (ed) { ed.hidden = true; ed.innerHTML = ""; }
    document.documentElement.style.overflow = "";
    var wasOpen = !!E; flushSave(); E = null;
    if (/web:/.test(location.hash)) { try { history.replaceState(null, "", "#websites/sitios"); } catch (e) {} }
    if (wasOpen) { W.sites = null; if (onWeb() && typeof drawView === "function") drawView(); }
  }
  function page() { return E && E.pages.find(function (p) { return p.id === E.cur; }); }
  function sec() { var p = page(); return p && (p.sections || []).find(function (x) { return x.id === E.sel; }); }
  function brandOf(site) { return (W.brands || []).find(function (b) { return b.id === site.brand_id; }) || null; }
  function forms() { return W.forms[E.site.workspace_id] || []; }

  function drawEditor() {
    var ed = document.getElementById("wbEd"); if (!ed || !E) return;
    var p = page();
    ed.innerHTML = '<div class="wtop"><button class="tb" data-e="close" aria-label="Volver a Websites">' + IC.back + '<span class="hm">Websites</span></button><span class="nm" title="' + esc(E.site.name) + '">' + esc(E.site.name) + "</span>"
      + '<select class="pg" data-e="page" aria-label="Página">' + E.pages.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === E.cur ? " selected" : "") + ">" + esc((x.hidden ? "◌ " : "") + (x.title || x.path) + "  " + x.path) + "</option>"; }).join("") + "</select>"
      + '<span class="seg hm" role="group" aria-label="Dispositivo"><button class="tb' + (E.dev === "desk" ? " on" : "") + '" data-e="dev" data-v="desk" title="Computadora" aria-label="Computadora">' + IC.desk + '</button><button class="tb' + (E.dev === "tab" ? " on" : "") + '" data-e="dev" data-v="tab" title="Tableta" aria-label="Tableta">' + IC.tab + '</button><button class="tb' + (E.dev === "mob" ? " on" : "") + '" data-e="dev" data-v="mob" title="Celular" aria-label="Celular">' + IC.mob + "</button></span>"
      + '<button class="tb hm" data-e="undo" title="Deshacer (Ctrl+Z)" aria-label="Deshacer"' + (E.hist.length ? "" : " disabled") + ">" + IC.undo + '</button><button class="tb hm" data-e="redo" title="Rehacer" aria-label="Rehacer"' + (E.fut.length ? "" : " disabled") + ">" + IC.redo + "</button>"
      + '<span class="sp"></span><span class="st" data-st></span>'
      + '<button class="tb hm" data-e="live" title="Ver la web publicada"' + (E.site.status === "published" ? "" : " disabled") + ">" + IC.ext + ' Ver</button><button class="tb pri" data-e="publish">Publicar</button></div>'
      + '<aside class="lp' + (E.sheet === "l" ? " open" : "") + '" aria-label="Páginas y secciones">' + leftPanel() + "</aside>"
      + '<div class="cv" data-cv><div class="fr" data-fr><iframe title="Vista previa" sandbox="allow-scripts" data-pv></iframe></div></div>'
      + '<aside class="rp' + (E.sheet === "r" ? " open" : "") + '" aria-label="Propiedades">' + rightPanel() + "</aside>"
      + '<nav class="mnav" aria-label="Editor"><button data-e="sheet" data-v="l" class="' + (E.sheet === "l" && E.tab !== "theme" ? "on" : "") + '">' + IC.secs + 'Secciones</button><button data-e="sheet" data-v="r" class="' + (E.sheet === "r" ? "on" : "") + '">' + IC.edit + 'Editar</button><button data-e="mdev">' + IC.eye + (E.dev === "mob" ? "Celular" : E.dev === "tab" ? "Tableta" : "Compu") + '</button><button data-e="undo"' + (E.hist.length ? "" : " disabled") + ">" + IC.undo.replace('width="15" height="15"', "") + 'Deshacer</button><button data-e="publish" class="pub">' + IC.up + "Publicar</button></nav>";
    topState(); preview(); fit();
  }
  function leftPanel() {
    var p = page(), tabs = '<div class="lt" role="tablist"><button class="tb' + (E.tab === "pages" ? " on" : "") + '" data-e="tab" data-v="pages" role="tab">Páginas</button><button class="tb' + (E.tab === "secs" ? " on" : "") + '" data-e="tab" data-v="secs" role="tab">Secciones</button><button class="tb' + (E.tab === "theme" ? " on" : "") + '" data-e="tab" data-v="theme" role="tab">Diseño</button><button class="tb' + (E.tab === "site" ? " on" : "") + '" data-e="tab" data-v="site" role="tab">Sitio</button></div>';
    var h = "";
    if (E.tab === "pages") {
      h += "<h5>Páginas</h5>" + E.pages.map(function (x) { return '<div class="it' + (x.id === E.cur ? " on" : "") + '" data-e="gopage" data-id="' + esc(x.id) + '" tabindex="0" role="button"><span class="ic">' + (x.path === "/" ? "⌂" : "▭") + '</span><span class="tx">' + esc(x.title || x.path) + "<small>" + esc(x.path) + (x.hidden ? " · oculta" : "") + "</small></span></div>"; }).join("")
        + '<button class="add" data-e="addpage">+ Nueva página</button>';
      var cms = W.cms[E.site.id];
      if (cms && cms.collections.length) h += "<h5>Del CMS (automáticas)</h5>" + cms.collections.map(function (c) { return '<div class="it" data-e="cmsgo"><span class="ic">☰</span><span class="tx">' + esc(c.name) + "<small>" + esc(SR().colPath(c)) + " y " + esc(SR().colPath(c)) + "/…</small></span></div>"; }).join("") + '<p class="hint">Las listas y las páginas de cada entrada se arman solas. Edita el contenido en <b>Websites › CMS</b>.</p>';
    } else if (E.tab === "secs") {
      var list = (p && p.sections) || [];
      h += "<h5>Secciones de «" + esc(p ? p.title || p.path : "") + "»</h5>" + list.map(function (x, i) {
        var b = SR().BLOCKS[x.type] || {}, t = (x.props && (x.props.title || x.props.eyebrow || (x.props.md || "").replace(/[#*_>\-\n]+/g, " ").trim())) || b.label;
        return '<div class="it' + (x.id === E.sel ? " on" : "") + '" draggable="true" data-e="sel" data-id="' + esc(x.id) + '" tabindex="0" role="button" aria-label="' + esc(b.label + ": " + t) + '"><span class="ic">' + esc(b.icon || "•") + '</span><span class="tx">' + esc(String(t).slice(0, 60)) + "<small>" + esc(b.label) + '</small></span><span class="mini"><button data-e="mv" data-d="-1" data-id="' + esc(x.id) + '" title="Subir" aria-label="Subir"' + (i ? "" : " disabled") + '>↑</button><button data-e="mv" data-d="1" data-id="' + esc(x.id) + '" title="Bajar" aria-label="Bajar"' + (i < list.length - 1 ? "" : " disabled") + '>↓</button><button data-e="dup" data-id="' + esc(x.id) + '" title="Duplicar" aria-label="Duplicar">⧉</button><button data-e="rm" data-id="' + esc(x.id) + '" title="Quitar" aria-label="Quitar">✕</button></span></div>';
      }).join("") + '<button class="add" data-e="pal">+ Agregar sección</button>' + (E.pal ? palette() : "");
    } else if (E.tab === "theme") h += themePanel();
    else h += sitePanel();
    return tabs + '<div class="lb">' + h + "</div>";
  }
  function palette() {
    var B = SR().BLOCKS;
    return '<div class="pal">' + Object.keys(B).map(function (k) { return '<button data-e="addsec" data-v="' + k + '"><i>' + esc(B[k].icon) + "</i>" + esc(B[k].label) + "<small>" + esc(B[k].desc) + "</small></button>"; }).join("") + "</div>";
  }

  /* ── campos genéricos ── */
  function getP(o, path) { return path.split(".").reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function setP(o, path, v) { var ks = path.split("."), last = ks.pop(), t = ks.reduce(function (a, k, i) { if (a[k] == null) a[k] = /^\d+$/.test(ks[i + 1] || last) ? [] : {}; return a[k]; }, o); t[last] = v; }
  function field(def, val, path, scope) {
    var id = "wbf_" + path.replace(/[^a-z0-9]/gi, "_"), lab = esc(def.label), hint = def.hint ? "<small>" + esc(def.hint) + "</small>" : "", at = ' data-f="' + esc(path) + '" data-s="' + scope + '" id="' + id + '"';
    var v = val == null ? "" : val;
    switch (def.type) {
      case "textarea": return '<label class="f" for="' + id + '">' + lab + "<textarea" + at + ' rows="3">' + esc(v) + "</textarea>" + hint + "</label>";
      case "md": return '<label class="f" for="' + id + '">' + lab + "<textarea" + at + ' rows="6">' + esc(v) + "</textarea>" + (hint || "<small>Formato: **negrita**, [enlace](/pagina), - listas, ## subtítulo</small>") + "</label>";
      case "code": return '<label class="f" for="' + id + '">' + lab + '<textarea class="mono"' + at + ' rows="8" spellcheck="false">' + esc(v) + "</textarea>" + hint + "</label>";
      case "bool": return '<label class="ck"><input type="checkbox"' + at + (v ? " checked" : "") + ">" + lab + "</label>";
      case "number": return '<label class="f" for="' + id + '">' + lab + '<input type="number"' + at + ' value="' + esc(v) + '">' + hint + "</label>";
      case "select": return '<label class="f" for="' + id + '">' + lab + '<select class="in"' + at + ">" + (def.opts || []).map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(v) ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select>" + hint + "</label>";
      case "image": return '<label class="f" for="' + id + '">' + lab + '<span class="img"><span class="pv" style="background-image:url(&quot;' + esc(SR().safeSrc(v)) + '&quot;)"></span><input type="url"' + at + ' value="' + esc(v) + '" placeholder="https://…"><button type="button" class="sm" data-e="upload" data-p="' + esc(path) + '" data-s="' + scope + '">Subir</button></span>' + hint + "</label>";
      case "form": {
        var fs = forms();
        return '<label class="f" for="' + id + '">' + lab + '<select class="in"' + at + '><option value="">— Elige un formulario —</option>' + fs.map(function (f) { return '<option value="' + esc(f.id) + '"' + (f.id === v ? " selected" : "") + ">" + esc(f.name) + (f.published ? "" : " (se publicará)") + "</option>"; }).join("") + '</select><small>Las respuestas crean el lead en Vender › Personas. <a href="#" data-e="newform" style="color:#ff8a3d">Crear formulario rápido</a></small></label>';
      }
      case "collection": {
        var cs = (W.cms[E.site.id] || {}).collections || [];
        return '<label class="f" for="' + id + '">' + lab + '<select class="in"' + at + '><option value="">— Elige —</option>' + cs.map(function (c) { return '<option value="' + esc(c.slug) + '"' + (c.slug === v ? " selected" : "") + ">" + esc(c.name) + "</option>"; }).join("") + "</select>" + (cs.length ? "" : '<small>Crea una colección en Websites › CMS.</small>') + "</label>";
      }
      case "design": {
        var ts = W.tpls[E.site.workspace_id] || [];
        return '<label class="f" for="' + id + '">' + lab + '<select class="in"' + at + '><option value="">— Elige un diseño —</option>' + ts.map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === v ? " selected" : "") + ">" + esc(t.name || "Sin nombre") + "</option>"; }).join("") + "</select><small>De Crear › Diseños. Se inserta con su HTML (nítido en cualquier pantalla).</small></label>";
      }
      case "list": {
        var items = Array.isArray(v) ? v : [];
        return "<h5>" + lab + "</h5>" + items.map(function (it, i) {
          var t = it && (it.title || it.label || it.name || it.q || it.value || it.quote || it.caption) || "Elemento " + (i + 1);
          return '<details class="wli"' + (E.openItem === path + "." + i ? " open" : "") + ' data-li="' + esc(path + "." + i) + '"><summary><span class="tx">' + esc(String(t).slice(0, 50)) + '</span><button class="sm" data-e="limv" data-p="' + esc(path) + '" data-i="' + i + '" data-d="-1" aria-label="Subir"' + (i ? "" : " disabled") + '>↑</button><button class="sm" data-e="limv" data-p="' + esc(path) + '" data-i="' + i + '" data-d="1" aria-label="Bajar"' + (i < items.length - 1 ? "" : " disabled") + '>↓</button><button class="sm dg" data-e="lirm" data-p="' + esc(path) + '" data-i="' + i + '" aria-label="Quitar">✕</button></summary><div class="bd">'
            + def.fields.map(function (f) { return field(f, it ? it[f.k] : "", path + "." + i + "." + f.k, scope); }).join("") + "</div></details>";
        }).join("") + '<button class="add" data-e="liadd" data-p="' + esc(path) + '" data-s="' + scope + '">+ Agregar</button>';
      }
      default: return '<label class="f" for="' + id + '">' + lab + '<input type="' + (def.type === "url" ? "text" : "text") + '"' + at + ' value="' + esc(v) + '"' + (def.type === "url" ? ' placeholder="/pagina, #ancla o https://…" inputmode="url"' : "") + ">" + hint + "</label>";
    }
  }
  function rightPanel() { return '<button class="sm rpx" data-e="sheet" data-v="r" aria-label="Cerrar panel">Cerrar ✕</button>' + rightPanelBody(); }
  function rightPanelBody() {
    var s = sec(), p = page();
    if (s) {
      var b = SR().BLOCKS[s.type];
      return "<h5>" + esc(b.label) + '</h5><p class="hint">' + esc(b.desc) + "</p>" + b.props.map(function (d) { return field(d, getP(s, "props." + d.k), "props." + d.k, "sec"); }).join("")
        + "<h5 style=\"margin-top:14px\">Estilo</h5>" + SR().STYLE.map(function (d) { return field(d, getP(s, "style." + d.k), "style." + d.k, "sec"); }).join("")
        + '<div class="row"><button class="sm" data-e="dup" data-id="' + esc(s.id) + '">Duplicar</button><button class="sm dg" data-e="rm" data-id="' + esc(s.id) + '">Quitar sección</button><button class="sm" data-e="desel">Ajustes de la página</button></div>';
    }
    if (!p) return '<p class="hint">Crea una página para empezar.</p>';
    var seo = p.seo || {}, a = SR().audit(E.site, p, { origin: APP, base: "/w/" + E.site.slug, collections: (W.cms[E.site.id] || {}).collections, entries: (W.cms[E.site.id] || {}).entries });
    return '<h5>Página</h5><p class="hint">Toca una sección en la vista previa para editarla.</p>'
      + field({ label: "Título", type: "text" }, p.title, "title", "page")
      + (p.path === "/" ? '<p class="hint">Ruta: <b>/</b> (portada)</p>' : field({ label: "Ruta", type: "text", hint: "Ej. /servicios — corta y con palabras clave" }, p.path, "path", "page"))
      + "<h5 style=\"margin-top:14px\">SEO · " + a.score + "/100</h5>"
      + field({ label: "Título para Google", type: "text", hint: (seo.title || p.title || "").length + " caracteres · ideal 15–65" }, seo.title, "seo.title", "page")
      + field({ label: "Descripción para Google", type: "textarea", hint: (seo.description || "").length + " caracteres · ideal 70–170" }, seo.description, "seo.description", "page")
      + field({ label: "Imagen para compartir", type: "image" }, seo.ogImage, "seo.ogImage", "page")
      + field({ label: "No mostrar en buscadores", type: "bool" }, seo.noindex, "seo.noindex", "page")
      + field({ label: "Oculta (no se publica)", type: "bool" }, p.hidden, "hidden", "page")
      + '<ul class="wb-fix" style="margin:8px 0 12px">' + a.checks.filter(function (c) { return !c.ok; }).slice(0, 6).map(function (c) { return '<li style="color:#ccc;border-color:#222"><i class="' + c.group + '">' + c.group.toUpperCase() + "</i><span>" + esc(c.text) + '<small style="color:#888">' + esc(c.fix) + "</small></span></li>"; }).join("") + "</ul>"
      + (p.path !== "/" ? '<div class="row"><button class="sm dg" data-e="delpage">Borrar página</button></div>' : "");
  }
  function themePanel() {
    var t = E.site.theme || {}, th = SR().theme(E.site, brandOf(E.site)), brands = (W.brands || []).filter(function (b) { return b.workspace_id === E.site.workspace_id; });
    function col(k, label) { return '<label class="f">' + esc(label) + '<span class="wcol"><input type="color" data-f="theme.' + k + '" data-s="site" value="' + esc(th[k]) + '" aria-label="' + esc(label) + '"><input type="text" data-f="theme.' + k + '" data-s="site" value="' + esc(t[k] || "") + '" placeholder="' + esc(th[k]) + '"></span></label>'; }
    return "<h5>Estilo base</h5>" + field({ label: "Preset", type: "select", opts: [["claro", "Claro"], ["oscuro", "Oscuro"], ["editorial", "Editorial"], ["suave", "Suave"]] }, t.preset || "claro", "theme.preset", "site")
      + (brands.length ? field({ label: "Marca", type: "select", opts: [["", "Sin marca"]].concat(brands.map(function (b) { return [b.id, b.name]; })), hint: "Toma sus colores y tipografías. Lo que cambies abajo manda." }, E.site.brand_id || "", "brand_id", "site") : "")
      + "<h5 style=\"margin-top:12px\">Colores</h5>" + col("accent", "Color principal (botones)") + col("bg", "Fondo") + col("fg", "Texto") + col("muted", "Texto suave") + col("surface", "Fondo alterno") + col("line", "Bordes")
      + (SR().contrast(th.fg, th.bg) < 4.5 ? '<p class="hint" style="color:#ffb199">El texto y el fondo tienen poco contraste (' + SR().contrast(th.fg, th.bg).toFixed(1) + ":1). Para leerse bien: 4.5:1 o más.</p>" : "")
      + "<h5 style=\"margin-top:12px\">Tipografía</h5>" + field({ label: "Títulos", type: "select", opts: SR().FONTS.map(function (f) { return [f, f]; }) }, th.headingFont, "theme.headingFont", "site") + field({ label: "Texto", type: "select", opts: SR().FONTS.map(function (f) { return [f, f]; }) }, th.bodyFont, "theme.bodyFont", "site")
      + "<h5 style=\"margin-top:12px\">Formas</h5>" + field({ label: "Bordes redondeados (px)", type: "number" }, th.radius, "theme.radius", "site") + field({ label: "Ancho máximo", type: "select", opts: [["1040", "Angosto · 1040"], ["1160", "Normal · 1160"], ["1320", "Amplio · 1320"]] }, String(th.width), "theme.width", "site")
      + '<div class="row"><button class="sm" data-e="resettheme">Volver a la marca / preset</button></div>';
  }
  function sitePanel() {
    var st = E.site.settings || {};
    var navDef = { label: "Menú", type: "list", fields: [{ k: "label", label: "Texto", type: "text" }, { k: "href", label: "Enlace", type: "url" }] };
    return "<h5>Sitio</h5>" + field({ label: "Nombre", type: "text" }, E.site.name, "name", "site") + field({ label: "Dirección en Musa", type: "text", hint: APP.replace(/^https?:\/\//, "") + "/w/… · minúsculas, números y guiones" }, E.site.slug, "slug", "site")
      + field({ label: "Logo", type: "image" }, st.logo, "settings.logo", "site") + field({ label: "Mostrar el nombre junto al logo", type: "bool" }, st.logoText !== false, "settings.logoText", "site") + field({ label: "Ícono de pestaña (favicon)", type: "image" }, st.favicon, "settings.favicon", "site")
      + "<h5 style=\"margin-top:12px\">Cabecera</h5>" + field({ label: "Mostrar cabecera", type: "bool" }, st.header !== false, "settings.header", "site") + field(navDef, st.nav, "settings.nav", "site")
      + field({ label: "Botón del menú · texto", type: "text" }, (st.cta || {}).label, "settings.cta.label", "site") + field({ label: "Botón del menú · enlace", type: "url" }, (st.cta || {}).href, "settings.cta.href", "site")
      + "<h5 style=\"margin-top:12px\">Pie de página</h5>" + field({ label: "Texto", type: "textarea" }, (st.footer || {}).text, "settings.footer.text", "site") + field({ label: "Enlaces", type: "list", fields: navDef.fields }, (st.footer || {}).links, "settings.footer.links", "site") + field({ label: "Legal (opcional)", type: "text" }, (st.footer || {}).legal, "settings.footer.legal", "site")
      + '<p class="hint">Los perfiles de redes del pie salen de <b>SEO e IA › Organización</b>.</p>';
  }

  /* ── vista previa ── */
  var pvT = 0;
  function preview(now) {
    clearTimeout(pvT);
    pvT = setTimeout(function () {
      var fr = document.querySelector("#wbEd [data-pv]"), p = page(); if (!fr || !p || !E) return;
      var cms = W.cms[E.site.id] || { collections: [], entries: {} };
      var pg = { path: p.path, title: p.title, seo: p.seo, sections: (p.sections || []).map(function (x) {
        var y = { id: x.id, type: x.type, style: x.style, props: Object.assign({}, x.props) };
        if (x.type === "form") { var f = forms().find(function (q) { return q.id === (x.props || {}).formId; }); y.props._form = f ? { token: "", fields: ((f.schema || {}).fields || []).map(function (z) { return { name: z.name, label: z.label, type: z.type, required: z.required, options: z.options }; }) } : null; }
        if (x.type === "design" && x.props && x.props.templateId) { var t = W.tplData[x.props.templateId]; if (t) y.props._design = { name: t.name, html: t.html, css: t.css, width: t.width, height: t.height, image: t.thumbnail }; }
        return y;
      }) };
      fr.srcdoc = SR().renderPage(E.site, pg, { preview: true, brand: brandOf(E.site), collections: cms.collections, entries: cms.entries, badge: false, scrollY: E.scrollY, hl: E.sel, lang: (E.site.settings || {}).lang });
    }, now ? 0 : 140);
  }
  function fit() {
    var cv = document.querySelector("#wbEd [data-cv]"), fr = document.querySelector("#wbEd [data-fr]"); if (!cv || !fr || !E) return;
    var d = DEV[E.dev], aw = cv.clientWidth - (MOBILE.matches ? 20 : 36), ah = cv.clientHeight - (MOBILE.matches ? 20 : 36);
    var w = d[0], h = d[1] || Math.max(600, Math.round(ah * w / Math.max(aw, 1)));
    var sc = Math.min(1, aw / w); if (d[1]) sc = Math.min(sc, ah / h);
    if (MOBILE.matches && E.dev === "mob") { w = Math.max(320, aw); h = ah; sc = 1; }
    fr.style.width = w + "px"; fr.style.height = h + "px"; fr.style.transform = "scale(" + sc + ")"; fr.style.marginBottom = (h * sc - h) + "px";
    fr.style.borderRadius = E.dev === "desk" ? "10px" : "28px";
  }
  window.addEventListener("resize", function () { if (E) fit(); });
  window.addEventListener("message", function (ev) {
    if (!E) return; var d = ev.data || {};
    var fr = document.querySelector("#wbEd [data-pv]"); if (!fr || ev.source !== fr.contentWindow) return;
    if (d.wb === "scroll") E.scrollY = d.y || 0;
    if (d.wb === "sel") {
      E.openItem = null;
      if (!d.id && d.area) { E.sel = null; E.tab = "site"; if (MOBILE.matches) E.sheet = "l"; return refreshPanels(); }
      E.sel = d.id || null; E.tab = "secs"; if (NARROW.matches && d.id) E.sheet = "r"; refreshPanels();
    }
  });
  function refreshPanels() {
    var ed = document.getElementById("wbEd"); if (!ed) return;
    var lp = ed.querySelector(".lp"), rp = ed.querySelector(".rp");
    if (lp) { lp.innerHTML = leftPanel(); lp.classList.toggle("open", E.sheet === "l"); }
    if (rp) { var y = rp.scrollTop; rp.innerHTML = rightPanel(); rp.scrollTop = y; rp.classList.toggle("open", E.sheet === "r"); }
    [].forEach.call(ed.querySelectorAll(".mnav [data-e=sheet]"), function (b) { b.classList.toggle("on", E.sheet === b.getAttribute("data-v")); });
    var fr = document.querySelector("#wbEd [data-pv]"); try { fr.contentWindow.postMessage({ wb: "hl", id: E.sel, scroll: true }, "*"); } catch (e) {}
    topState();
  }
  function topState() {
    var st = document.querySelector("#wbEd [data-st]"); if (!st || !E) return;
    st.textContent = E.saving ? "Guardando…" : E.err ? "Sin guardar · " + E.err : E.dirtyPub ? "Guardado · cambios sin publicar" : E.site.status === "published" ? "Publicado · v" + (E.site.version || 1) : "Guardado · borrador";
    var u = document.querySelectorAll('#wbEd [data-e="undo"]'), r = document.querySelector('#wbEd [data-e="redo"]');
    [].forEach.call(u, function (b) { b.disabled = !E.hist.length; }); if (r) r.disabled = !E.fut.length;
  }

  /* ── historial y guardado ── */
  function snap() { return JSON.stringify({ site: { name: E.site.name, slug: E.site.slug, brand_id: E.site.brand_id, theme: E.site.theme, settings: E.site.settings }, pages: E.pages.map(function (p) { return { id: p.id, title: p.title, path: p.path, seo: p.seo, hidden: p.hidden, sections: p.sections }; }) }); }
  var lastSnap = null, histT = 0;
  function remember() { if (!E) return; var s = snap(); if (lastSnap && s !== lastSnap) { E.hist.push(lastSnap); if (E.hist.length > 80) E.hist.shift(); E.fut = []; } lastSnap = s; }
  function beginEdit() { if (!lastSnap) lastSnap = snap(); clearTimeout(histT); }
  function endEdit(slow) { clearTimeout(histT); histT = setTimeout(remember, slow ? 700 : 0); }
  function restore(s) {
    var o = JSON.parse(s);
    ["name", "slug", "brand_id", "theme", "settings"].forEach(function (k) { E.site[k] = o.site[k]; }); E.dirty.site = 1;
    o.pages.forEach(function (q) { var p = E.pages.find(function (x) { return x.id === q.id; }); if (p) { ["title", "path", "seo", "hidden", "sections"].forEach(function (k) { p[k] = q[k]; }); E.dirty["p:" + p.id] = 1; } });
    lastSnap = s; scheduleSave(); refreshPanels(); preview(true);
  }
  function undo() { if (!E || !E.hist.length) return; remember(); var s = E.hist.pop(); E.fut.push(lastSnap); restore(s); }
  function redo() { if (!E || !E.fut.length) return; var s = E.fut.pop(); E.hist.push(lastSnap); restore(s); }
  var saveT = 0;
  function scheduleSave() { if (!E) return; E.dirtyPub = true; clearTimeout(saveT); saveT = setTimeout(flushSave, 700); topState(); }
  function flushSave() {
    clearTimeout(saveT); if (!E) return Promise.resolve();
    var jobs = [], me = uid(), ed = E;
    Object.keys(ed.dirty).forEach(function (k) {
      if (k === "site") {
        if (ed.site.slug && !SR().validSlug(ed.site.slug)) { ed.err = "dirección no válida"; return; }
        jobs.push(api("/rest/v1/websites?id=eq." + enc(ed.site.id), J("PATCH", { name: ed.site.name, slug: ed.site.slug, brand_id: ed.site.brand_id || null, theme: ed.site.theme || {}, settings: ed.site.settings || {}, updated_by: me })));
      } else {
        var p = ed.pages.find(function (x) { return "p:" + x.id === k; }); if (!p) return;
        jobs.push(api("/rest/v1/website_pages?id=eq." + enc(p.id), J("PATCH", { title: p.title, path: p.path, seo: p.seo || {}, hidden: !!p.hidden, sections: p.sections || [], updated_by: me })));
      }
      delete ed.dirty[k];
    });
    if (!jobs.length) { topState(); return Promise.resolve(); }
    ed.saving++; topState();
    return Promise.all(jobs).then(function () { ed.saving--; ed.err = null; topState(); }, function (e) { ed.saving--; ed.err = msg(e); topState(); toast("No se guardó: " + msg(e)); });
  }
  function touch(scope) { if (scope === "site") E.dirty.site = 1; else { var p = page(); if (p) E.dirty["p:" + p.id] = 1; } scheduleSave(); }

  /* ── eventos del editor ── */
  function bindEditor(ed) {
    ed.addEventListener("input", function (e) {
      var t = e.target, path = t.getAttribute && t.getAttribute("data-f"); if (!path || !E) return;
      var scope = t.getAttribute("data-s"), v = t.type === "checkbox" ? t.checked : t.type === "number" ? (t.value === "" ? null : +t.value) : t.value;
      beginEdit();
      if (scope === "sec") { var s = sec(); if (!s) return; setP(s, path, v); }
      else if (scope === "page") { var p = page(); if (!p) return; if (path === "path") v = SR().normPath(v); setP(p, path, v); }
      else {
        if (path === "slug") v = String(v).toLowerCase().replace(/[^a-z0-9-]/g, "");
        if (/^theme\./.test(path) && t.type === "color") { var tx = t.parentNode.querySelector('input[type=text]'); if (tx) tx.value = v; }
        if (/^theme\./.test(path) && t.type === "text" && v && !/^#[0-9a-f]{3,6}$/i.test(v)) return;
        E.site.theme = E.site.theme || {}; E.site.settings = E.site.settings || {};
        setP(E.site, path, v);
      }
      if (t.closest(".img")) { var pv = t.closest(".img").querySelector(".pv"); if (pv) pv.style.backgroundImage = 'url("' + SR().safeSrc(v) + '")'; }
      touch(scope); endEdit(true); preview();
      if (t.tagName === "SELECT" || t.type === "checkbox") {
        if (scope === "site" && (path === "brand_id" || path === "theme.preset")) { var lp = ed.querySelector(".lp"); if (lp) lp.innerHTML = leftPanel(); }
        if (path === "props.templateId" && v) loadTplData(v).then(function () { preview(true); });
        if (scope === "sec" && path === "props.formId") preview(true);
      }
      if (scope === "page" && (path === "title" || path === "path" || path === "hidden")) { var sel = ed.querySelector("select.pg"); if (sel) { var o = sel.querySelector('option[value="' + E.cur + '"]'); var pp = page(); if (o && pp) o.textContent = (pp.hidden ? "◌ " : "") + (pp.title || pp.path) + "  " + pp.path; } }
    });
    ed.addEventListener("change", function (e) { if (e.target.matches && e.target.matches("[data-f]")) { endEdit(); if (e.target.closest(".wli") || e.target.closest(".rp")) { /* títulos de elementos de lista */ var li = e.target.closest(".wli"); if (li) { var s = li.querySelector("summary .tx"); var it = getP(sec() || page() || E.site, li.getAttribute("data-li")); if (s && it) s.textContent = String(it.title || it.label || it.name || it.q || it.value || it.quote || it.caption || s.textContent).slice(0, 50); } } } });
    ed.addEventListener("toggle", function (e) { var li = e.target; if (li.classList && li.classList.contains("wli") && li.open) E.openItem = li.getAttribute("data-li"); }, true);
    ed.addEventListener("click", function (e) {
      var b = e.target.closest("[data-e]"); if (!b) return;
      var k = b.getAttribute("data-e"), id = b.getAttribute("data-id"), v = b.getAttribute("data-v");
      if (!E && k !== "close") return;
      if (b.tagName === "SELECT") return;
      if (k !== "sel" && k !== "gopage") e.preventDefault();
      var p = E && page(), list = p && p.sections;
      switch (k) {
        case "close": return closeEditor();
        case "dev": E.dev = v; return drawEditor();
        case "mdev": E.dev = E.dev === "mob" ? "tab" : E.dev === "tab" ? "desk" : "mob"; return drawEditor();
        case "undo": return undo();
        case "redo": return redo();
        case "live": return window.open(liveUrl(E.site), "_blank", "noopener");
        case "publish": return flushSave().then(function () { if (E && E.err) return R.notice("Primero corrige", E.err); return publish(E.site); });
        case "tab": E.tab = v; E.pal = false; return refreshPanels();
        case "sheet": E.sheet = E.sheet === v ? null : v; return refreshPanels();
        case "gopage": flushSave(); E.cur = id; E.sel = null; E.scrollY = 0; E.tab = "secs"; return drawEditor();
        case "cmsgo": closeEditor(); location.hash = "websites/cms"; return;
        case "sel": E.sel = id; E.openItem = null; if (NARROW.matches) E.sheet = "r"; refreshPanels(); return;
        case "desel": E.sel = null; if (NARROW.matches) E.sheet = "r"; return refreshPanels();
        case "pal": E.pal = !E.pal; return refreshPanels();
        case "addsec": {
          beginEdit(); var ns = SR().newSection(v); var at = list.findIndex(function (x) { return x.id === E.sel; });
          list.splice(at >= 0 ? at + 1 : list.length, 0, ns); E.sel = ns.id; E.pal = false; if (NARROW.matches) E.sheet = "r";
          touch("page"); endEdit(); refreshPanels(); preview(true);
          if (v === "form") loadForms(E.site.workspace_id).then(function () { refreshPanels(); });
          return;
        }
        case "mv": { beginEdit(); var i = list.findIndex(function (x) { return x.id === id; }), j = i + (+b.getAttribute("data-d")); if (i < 0 || j < 0 || j >= list.length) return; var t = list[i]; list[i] = list[j]; list[j] = t; touch("page"); endEdit(); refreshPanels(); return preview(true); }
        case "dup": { beginEdit(); var i2 = list.findIndex(function (x) { return x.id === id; }); if (i2 < 0) return; var c = JSON.parse(JSON.stringify(list[i2])); c.id = SR().newId("sec"); if (c.style) c.style.anchor = ""; list.splice(i2 + 1, 0, c); E.sel = c.id; touch("page"); endEdit(); refreshPanels(); return preview(true); }
        case "rm": { beginEdit(); var i3 = list.findIndex(function (x) { return x.id === id; }); if (i3 < 0) return; list.splice(i3, 1); if (E.sel === id) E.sel = null; touch("page"); endEdit(); refreshPanels(); toast("Sección quitada · Ctrl+Z para deshacer"); return preview(true); }
        case "liadd": { beginEdit(); var scope = b.getAttribute("data-s"), path = b.getAttribute("data-p"), host = scope === "sec" ? sec() : E.site; var arr = getP(host, path); if (!Array.isArray(arr)) { arr = []; setP(host, path, arr); } arr.push({}); E.openItem = path + "." + (arr.length - 1); touch(scope); endEdit(); refreshPanels(); return preview(); }
        case "limv": case "lirm": {
          beginEdit(); var path2 = b.getAttribute("data-p"), host2 = /^settings\./.test(path2) ? E.site : sec(), arr2 = getP(host2, path2), i4 = +b.getAttribute("data-i");
          if (!Array.isArray(arr2)) return;
          if (k === "lirm") arr2.splice(i4, 1); else { var j4 = i4 + (+b.getAttribute("data-d")); if (j4 < 0 || j4 >= arr2.length) return; var t4 = arr2[i4]; arr2[i4] = arr2[j4]; arr2[j4] = t4; E.openItem = path2 + "." + j4; }
          touch(/^settings\./.test(path2) ? "site" : "page"); endEdit(); refreshPanels(); return preview();
        }
        case "upload": {
          var path3 = b.getAttribute("data-p"), scope3 = b.getAttribute("data-s");
          return pickImage().then(function (u) { if (!u || !E) return; beginEdit(); var host3 = scope3 === "sec" ? sec() : scope3 === "page" ? page() : E.site; if (!host3) return; setP(host3, path3, u); touch(scope3); endEdit(); refreshPanels(); preview(true); });
        }
        case "addpage":
          return R.dialog({ title: "Nueva página", fields: [{ name: "title", label: "Título", placeholder: "Servicios", required: true }, { name: "path", label: "Ruta", placeholder: "/servicios", hint: "Se crea sola desde el título si la dejas vacía" }], ok: "Crear", action: "nueva-pagina" }).then(function (r) {
            if (!r) return;
            var path = SR().normPath(r.path || "/" + SR().slugify(r.title));
            return flushSave().then(function () { return mcp("save_website_page", { siteId: E.site.id, path: path, title: r.title.trim(), create: true }); }).then(function (x) {
              return api("/rest/v1/website_pages?id=eq." + enc(x.page.id) + "&select=*").then(function (rows) { var np = (rows || [])[0]; if (np) { E.pages.push(np); E.cur = np.id; E.sel = null; E.tab = "secs"; E.dirtyPub = true; drawEditor(); toast("Página creada"); } });
            }, function (x) { R.notice("No se pudo crear", msg(x)); });
          });
        case "delpage":
          return R.confirmBox("Se quita de la web al volver a publicar.", { title: "¿Borrar «" + (p.title || p.path) + "»?", danger: true, ok: "Borrar" }).then(function (ok) {
            if (!ok) return;
            return mcp("delete_website_page", { siteId: E.site.id, id: p.id }).then(function () { E.pages = E.pages.filter(function (x) { return x.id !== p.id; }); E.cur = (E.pages[0] || {}).id; E.sel = null; E.dirtyPub = true; drawEditor(); }, function (x) { R.notice("No se pudo borrar", msg(x)); });
          });
        case "resettheme": beginEdit(); E.site.theme = { preset: (E.site.theme || {}).preset || "claro" }; touch("site"); endEdit(); refreshPanels(); return preview(true);
        case "newform":
          return R.dialog({ title: "Formulario rápido", fields: [{ name: "name", label: "Nombre", value: "Contacto · " + E.site.name, required: true }, { name: "tel", label: "Pedir teléfono", type: "checkbox", value: false }, { name: "emp", label: "Pedir empresa", type: "checkbox", value: false }], ok: "Crear", action: "form-rapido" }).then(function (r) {
            if (!r) return;
            var fields = [{ name: "nombre", label: "Nombre", type: "Texto", required: true }, { name: "email", label: "Email", type: "Email", required: true }];
            if (r.tel) fields.push({ name: "telefono", label: "Teléfono", type: "Teléfono" }); if (r.emp) fields.push({ name: "empresa", label: "Empresa", type: "Texto" });
            fields.push({ name: "mensaje", label: "Mensaje", type: "Párrafo" });
            return api("/rest/v1/workspace_forms", J("POST", { workspace_id: E.site.workspace_id, name: r.name.trim(), published: true, schema: { type: "Contacto", fields: fields, brand_id: E.site.brand_id || null }, created_by: uid() })).then(function (rows) {
              var f = (rows || [])[0]; delete W.forms[E.site.workspace_id];
              return loadForms(E.site.workspace_id).then(function () { var s = sec(); if (s && f) { beginEdit(); s.props.formId = f.id; touch("page"); endEdit(); } refreshPanels(); preview(true); toast("Formulario creado"); });
            }, function (x) { R.notice("No se pudo crear", msg(x)); });
          });
      }
    });
    ed.addEventListener("change", function (e) { var t = e.target; if (t.matches && t.matches('select[data-e="page"]')) { flushSave(); E.cur = t.value; E.sel = null; E.scrollY = 0; drawEditor(); } });
    ed.addEventListener("keydown", function (e) {
      if (!E) return;
      var inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !inField) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y" && !inField) { e.preventDefault(); redo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); flushSave().then(function () { toast("Guardado"); }); }
      if (e.key === "Escape" && !inField) { if (E.sheet) { E.sheet = null; refreshPanels(); } else if (E.sel) { E.sel = null; refreshPanels(); } }
      if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches('.it[role="button"]')) { e.preventDefault(); e.target.click(); }
      e.stopPropagation();
    });
    // arrastrar secciones para reordenar
    var dragId = null;
    ed.addEventListener("dragstart", function (e) { var it = e.target.closest && e.target.closest('.it[data-e="sel"]'); if (!it) return; dragId = it.getAttribute("data-id"); it.classList.add("drag"); try { e.dataTransfer.setData("text/plain", dragId); e.dataTransfer.effectAllowed = "move"; } catch (x) {} });
    ed.addEventListener("dragover", function (e) { var it = e.target.closest && e.target.closest('.it[data-e="sel"]'); if (!it || !dragId) return; e.preventDefault(); [].forEach.call(ed.querySelectorAll(".it.over"), function (x) { x.classList.remove("over"); }); it.classList.add("over"); });
    ed.addEventListener("drop", function (e) {
      var it = e.target.closest && e.target.closest('.it[data-e="sel"]'); if (!it || !dragId) return; e.preventDefault();
      var list = page().sections, from = list.findIndex(function (x) { return x.id === dragId; }), to = list.findIndex(function (x) { return x.id === it.getAttribute("data-id"); });
      if (from >= 0 && to >= 0 && from !== to) { beginEdit(); var m = list.splice(from, 1)[0]; list.splice(to, 0, m); touch("page"); endEdit(); refreshPanels(); preview(true); }
      dragId = null;
    });
    ed.addEventListener("dragend", function () { dragId = null; [].forEach.call(ed.querySelectorAll(".it.over,.it.drag"), function (x) { x.classList.remove("over", "drag"); }); });
  }
  window.addEventListener("beforeunload", function () { if (E) flushSave(); });

  /* ═════════════════ clics de las vistas ═════════════════ */
  document.addEventListener("click", function (e) {
    if (!onWeb()) return;
    var t = e.target;
    if (t.closest(".head .actions .btn-p")) { e.preventDefault(); e.stopPropagation(); return newSite(); }
    var nb = t.closest("[data-wbn]"); if (nb) { e.preventDefault(); return newSite(nb.getAttribute("data-tpl") || null); }
    var cp = t.closest("[data-wbcopy]"); if (cp) { e.preventDefault(); try { navigator.clipboard.writeText(cp.getAttribute("data-wbcopy")); toast("Copiado"); } catch (x) {} return; }
    if (t.closest("[data-wbcopy-sql]")) { e.preventDefault(); try { navigator.clipboard.writeText(W._sql || ""); toast("SQL copiado"); } catch (x) {} return; }
    if (t.closest("[data-wbplan]")) { e.preventDefault(); location.hash = "configuracion/espacios"; return; }
    var a = t.closest("[data-wba]");
    if (a) {
      e.preventDefault(); e.stopPropagation();
      var s = siteById(a.getAttribute("data-id")); if (!s) return;
      var k = a.getAttribute("data-wba");
      if (k === "edit") return openEditor(s);
      if (k === "open") return window.open(liveUrl(s), "_blank", "noopener");
      if (k === "cms") { setCur(s.id); location.hash = "websites/cms"; return; }
      if (k === "seo") { setCur(s.id); location.hash = "websites/seo"; return; }
      if (k === "move") { if (R.openMove) R.openMove([{ type: "website", id: s.id, name: s.name }]); return; }
      if (k === "del") return R.confirmBox("Se despublica y se borran sus páginas, su CMS y sus dominios.", { title: "¿Borrar «" + s.name + "»?", danger: true, ok: "Borrar" }).then(function (ok) {
        if (!ok) return; return mcp("delete_website", { id: s.id, confirm: true }).then(function () { toast("Website borrado"); W.sites = null; drawView(); }, function (x) { R.notice("No se pudo borrar", msg(x)); });
      });
    }
    var c = t.closest("[data-wbc]");
    if (c) {
      e.preventDefault();
      var s2 = siteById(W.cur), cms = W.cms[s2.id], k2 = c.getAttribute("data-wbc"), col = cms && cms.collections.find(function (x) { return x.id === C.col; });
      if (k2 === "col") { C.col = c.getAttribute("data-id"); return drawCms(); }
      if (k2 === "newcol") return editCollection(s2, null);
      if (k2 === "editcol") return editCollection(s2, col);
      if (k2 === "opencol") return window.open(liveUrl(s2).replace(/\/$/, "") + SR().colPath(col), "_blank", "noopener");
      if (k2 === "newent") return editEntry(s2, col, null);
      var ent = col && (cms.all[col.slug] || []).find(function (x) { return x.id === c.getAttribute("data-id"); });
      if (k2 === "edit" && ent) return editEntry(s2, col, ent);
      if (k2 === "view" && ent) return window.open(liveUrl(s2).replace(/\/$/, "") + SR().entryUrl(col, ent), "_blank", "noopener");
      if (k2 === "del" && ent) return R.confirmBox("Si estaba publicada, desaparece de la web al instante.", { title: "¿Borrar «" + ent.title + "»?", danger: true, ok: "Borrar" }).then(function (ok) { if (!ok) return; return mcp("delete_website_entry", { siteId: s2.id, id: ent.id }).then(function () { toast("Entrada borrada"); return loadCms(s2.id, true).then(drawCms); }, function (x) { R.notice("No se pudo borrar", msg(x)); }); });
    }
    var fx = t.closest("[data-wbfix]");
    if (fx) {
      e.preventDefault(); var g = fx.getAttribute("data-g"), s3 = siteById(W.cur);
      if (g === "geo" && !fx.getAttribute("data-sec")) { var f = document.querySelector("[data-wbseo] [name=ai_summary]"); if (f) { f.focus(); f.scrollIntoView({ block: "center" }); } return; }
      openEditor(s3, fx.getAttribute("data-wbfix")); var sid = fx.getAttribute("data-sec"); if (sid) setTimeout(function () { if (E) { E.sel = sid; refreshPanels(); } }, 900);
      return;
    }
    var dm = t.closest("[data-wbdom]");
    if (dm) {
      e.preventDefault(); var did = dm.getAttribute("data-id");
      if (dm.getAttribute("data-wbdom") === "check") { dm.disabled = true; return mcp("check_website_domain", { id: did }).then(function (r) { R.notice(r.status === "active" ? "Dominio activo" : "Estado del dominio", r.message + (r.note ? " " + r.note : "")); drawDom(); }, function (x) { dm.disabled = false; R.notice("No se pudo comprobar", msg(x)); }); }
      return R.confirmBox("La web dejará de responder en ese dominio.", { title: "¿Quitar el dominio?", danger: true, ok: "Quitar" }).then(function (ok) { if (ok) return mcp("remove_website_domain", { id: did }).then(drawDom, function (x) { R.notice("No se pudo quitar", msg(x)); }); });
    }
    var gh = t.closest("[data-wbgh]");
    if (gh) {
      e.preventDefault(); var s4 = siteById(W.cur), k4 = gh.getAttribute("data-wbgh");
      if (k4 === "off") return R.confirmBox("Se borra el token guardado. El repositorio no cambia.", { title: "¿Desconectar GitHub?", ok: "Desconectar" }).then(function (ok) { if (ok) return mcp("disconnect_website_integration", { siteId: s4.id, provider: "github" }).then(drawDom); });
      if (k4 === "sync") { if (s4.status !== "published") return R.notice("Primero publica", "GitHub recibe la versión publicada del website."); var pr = R.progress ? R.progress("Subiendo a GitHub", "Generando páginas y archivos…") : null; return mcp("sync_website_github", { siteId: s4.id }).then(function (r) { if (pr) pr.close(); R.notice("Subido a GitHub", r.files + " archivos en " + r.repo + " (" + r.branch + "). " + r.note, { body: '<p><a href="' + esc(r.url) + '" target="_blank" rel="noopener" style="color:#ff5e00;font-weight:700">Ver el commit ↗</a></p>' }); drawDom(); }, function (x) { if (pr) pr.close(); R.notice("No se pudo subir", msg(x)); }); }
      return R.dialog({ title: "Conectar GitHub", message: "Crea un token «fine-grained» en GitHub › Settings › Developer settings, con acceso solo a ese repositorio y permiso Contents: Read and write.", fields: [{ name: "repo", label: "Repositorio", placeholder: "usuario/mi-web", required: true }, { name: "token", label: "Token", placeholder: "github_pat_… (déjalo vacío para mantener el actual)" }, { name: "branch", label: "Rama", placeholder: "main" }, { name: "dir", label: "Carpeta (opcional)", placeholder: "docs" }, { name: "siteUrl", label: "URL donde lo publicas (opcional)", placeholder: "https://usuario.github.io/mi-web", hint: "Para el canonical y el sitemap del HTML exportado" }], ok: "Conectar", action: "conectar-github" }).then(function (v) {
        if (!v) return; return mcp("connect_website_github", { siteId: s4.id, repo: v.repo.trim(), token: v.token.trim() || undefined, branch: v.branch.trim() || undefined, dir: v.dir.trim() || undefined, siteUrl: v.siteUrl.trim() || undefined }).then(function () { toast("GitHub conectado"); drawDom(); }, function (x) { R.notice("No se pudo conectar", msg(x)); });
      });
    }
    var sb = t.closest("[data-wbsb]");
    if (sb) {
      e.preventDefault(); var s5 = siteById(W.cur), k5 = sb.getAttribute("data-wbsb");
      if (k5 === "off") return R.confirmBox("Se borra la llave guardada. Tu proyecto no cambia.", { title: "¿Desconectar Supabase?", ok: "Desconectar" }).then(function (ok) { if (ok) return mcp("disconnect_website_integration", { siteId: s5.id, provider: "supabase" }).then(drawDom); });
      if (k5 === "sync") return mcp("sync_website_supabase", { siteId: s5.id }).then(function (r) { toast(r.entries + " entradas copiadas a tu Supabase"); drawDom(); }, function (x) { R.notice("No se pudo copiar", msg(x)); });
      return R.dialog({ title: "Conectar Supabase", message: "Usa la URL y la llave secreta (service_role) de tu proyecto: Project Settings › API. Antes corre el SQL que está abajo.", fields: [{ name: "url", label: "URL del proyecto", placeholder: "https://abcd.supabase.co", required: true }, { name: "key", label: "Llave secreta", placeholder: "déjala vacía para mantener la actual" }, { name: "leads", label: "Copiar los leads de los formularios", type: "checkbox", value: true }], ok: "Conectar", action: "conectar-supabase" }).then(function (v) {
        if (!v) return; return mcp("connect_website_supabase", { siteId: s5.id, url: v.url.trim(), key: v.key.trim() || undefined, leads: v.leads }).then(function (r) { if (r.needsSql) R.notice("Conectado · faltan las tablas", r.note); else toast("Supabase conectado"); drawDom(); }, function (x) { R.notice("No se pudo conectar", msg(x)); });
      });
    }
  }, true);
  document.addEventListener("change", function (e) {
    if (!onWeb()) return;
    var t = e.target;
    if (t.matches && t.matches("[data-wbpick]")) { setCur(t.value); return drawView(); }
    if (t.matches && t.matches("[data-wbdays]")) { W.days = +t.value; return drawStats(); }
  });
  document.addEventListener("submit", function (e) {
    if (!onWeb()) return;
    var f = e.target;
    if (f.matches("[data-wbseo]")) { e.preventDefault(); return saveSeo(f); }
    if (f.matches("[data-wbdomadd]")) {
      e.preventDefault(); var host = f.elements.host.value.trim(); if (!host) return;
      return mcp("connect_website_domain", { siteId: W.cur, hostname: host }).then(function (r) {
        R.notice("Dominio agregado", r.note, { body: '<div class="wb-panel" style="margin:0">' + r.steps.map(function (s) { return '<div class="wb-dns"><b>' + esc(s.record) + "</b> · " + esc(s.why) + "<br>Nombre: <code>" + esc(s.name) + "</code><br>Valor: <code>" + esc(s.value) + "</code></div>"; }).join("") + "</div>" });
        drawDom();
      }, function (x) { R.notice("No se pudo agregar", msg(x)); });
    }
  }, true);

  /* ═════════════════ instalación ═════════════════ */
  var VIEWS = { wbSites: drawSites, wbCms: drawCms, wbSeo: drawSeo, wbDom: drawDom, wbStats: drawStats };
  function install() {
    var ok = typeof VIEWS2 !== "undefined" && typeof MODULES !== "undefined" && typeof ic === "function" && typeof drawView === "function" && typeof modById === "function" && window.SiteRender;
    if (!ok) return setTimeout(install, 150);
    Object.keys(VIEWS).forEach(function (k) { VIEWS2[k] = function () { VIEWS[k](); }; });
    if (!modById("websites")) {
      var at = MODULES.indexOf(modById("crear"));
      MODULES.splice(at + 1, 0, {
        id: "websites", label: "Websites", action: "Nuevo website",
        desc: "Landings y sitios con tu marca, CMS propio para el contenido que cambia, SEO, GEO y AEO automáticos, dominio propio y visitas.",
        icon: ic('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
        subs: [["sitios", "Mis websites", "wbSites"], ["cms", "Contenido (CMS)", "wbCms"], ["seo", "SEO e IA", "wbSeo"], ["dominios", "Dominios y conexiones", "wbDom"], ["visitas", "Visitas", "wbStats"]],
      });
    }
    var cr = modById("crear");
    if (cr && !cr.subs.some(function (x) { return x[0] === "websites"; })) {
      var fi = cr.subs.findIndex(function (x) { return x[0] === "formularios"; });
      cr.subs.splice(fi >= 0 ? fi + 1 : cr.subs.length, 0, ["websites", "Websites y landings", "wbSites"]);
    }
    if (typeof ROLES !== "undefined") Object.keys(ROLES).forEach(function (k) { var r = ROLES[k]; if (r && r.pin && (k === "disenador" || k === "copy" || k === "automatizador") && r.pin.indexOf("websites") < 0) r.pin.push("websites"); });
    var _dv = drawView;
    drawView = function () {
      var r = _dv.apply(this, arguments);
      try {
        if (onWeb()) {
          var g = document.querySelector(".head .actions .btn-g"); if (g) g.style.display = "none";
          var m = location.hash.match(/web:(web_[a-z0-9]+)/i);
          if (m && !E) { var s0 = siteById(m[1]); if (s0) openEditor(s0); else loadSites().then(function () { var s1 = siteById(m[1]); if (s1) openEditor(s1); }); }
        }
      } catch (e) {}
      return r;
    };
    try { if (typeof drawNav === "function") drawNav(); } catch (e) {}
    if (/^#(websites|crear\/websites)/.test(location.hash) && typeof go === "function") go();
    // al cambiar de espacio, recargar
    if (typeof wsSwitch === "function") { var _ws = wsSwitch; wsSwitch = function () { var r = _ws.apply(this, arguments); W.sites = null; W.brands = null; W.forms = {}; W.tpls = {}; W.cms = {}; return r; }; }
    R.websites = { open: function (id) { var s = siteById(id); if (s) openEditor(s); }, reload: function () { W.sites = null; } };
  }
  install();
})();
