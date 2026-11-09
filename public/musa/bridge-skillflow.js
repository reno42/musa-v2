/* bridge-skillflow.js — Agentes › Skills › «Mis skills»: skills propias desde flujogramas.
 * - Constructor visual (estética de los editores de Musa) ⇄ Mermaid ⇄ skill, convertido al instante y SIN IA
 *   por public/musa/skillflow.js (el mismo conversor que usa el MCP en el servidor).
 * - Cada paso dice QUÉ se hace, CÓMO, y qué HERRAMIENTA de Musa usar (con su detalle/parámetros).
 * - Las skills son del espacio (tabla workspace_skills, migración 34): privadas o compartidas con el equipo,
 *   nunca con clientes; aparecen en «Todo» con la etiqueta de su espacio y se mueven con «Mover a…».
 * - Celular y tableta: barra inferior, paneles como hojas, pellizco para acercar y arrastre con el dedo.
 */
(function () {
  var R = window.__musaReal; if (!R) return;
  function SF() { return window.SkillFlow; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function bridge() { try { return window.parent.__musaBridge; } catch (e) { return null; } }
  function api(path, init) { var b = bridge(); if (!b) return Promise.reject(new Error("Sin sesión")); return b.api(path, init); }
  function J(method, body) { return { method: method, headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(body) }; }
  function msg(e) { return String((e && e.message) || e || "Error").replace(/^API error:\s*\d+\s*[·:—-]?\s*/, ""); }
  function toast(t) { if (typeof uiToast === "function") uiToast(t); }
  function uid() { var b = bridge(); return b && b.userId; }
  var MOBILE = window.matchMedia("(max-width: 760px)");
  var TYPE_ES = { start: "Inicio", end: "Fin", step: "Paso", decision: "Decisión", sub: "Subproceso", io: "Dato" };
  var SIZE = { start: [170, 52], end: [170, 52], step: [200, 72], decision: [200, 100], sub: [200, 72], io: [200, 64] };

  /* ───────── herramientas de Musa (para enlazar pasos) ───────── */
  var TOOLS = null, TOOLMAP = {}, SKILLS_MUSA = [];
  function loadTools() {
    if (TOOLS) return Promise.resolve(TOOLS);
    return fetch("/musa-tools.json", { cache: "no-cache" }).then(function (r) { return r.json(); }).then(function (j) {
      TOOLS = (j && j.tools) || []; SKILLS_MUSA = (j && j.skills) || [];
      TOOLS.forEach(function (t) { TOOLMAP[t.n] = t; });
      return TOOLS;
    }).catch(function () { TOOLS = []; return TOOLS; });
  }
  function toolSet() { var o = {}; (TOOLS || []).forEach(function (t) { o[t.n] = 1; }); return o; }
  function skillTitle(id) { var s = SKILLS_MUSA.find(function (x) { return x.id === id; }); return s ? s.title : ""; }

  /* ───────── datos: skills del espacio (RLS decide qué ves) ───────── */
  var L = { rows: null, loading: false, tab: "mine" };
  var SEL_COLS = "id,workspace_id,name,slug,description,meta,graph,mermaid,markdown,steps,tools,issues,visibility,version,created_by,updated_at";
  function wsFilter() { return R.wsFilter ? R.wsFilter() : "workspace_id=eq." + encodeURIComponent(R.ws); }
  function loadRows() {
    L.loading = true;
    return api("/rest/v1/workspace_skills?" + wsFilter() + "&deleted_at=is.null&select=" + SEL_COLS + "&order=updated_at.desc&limit=300").then(function (rows) {
      L.rows = rows || []; L.loading = false;
      R.wsOf = R.wsOf || {}; L.rows.forEach(function (r) { R.wsOf["skill:" + r.id] = r.workspace_id; });
      return L.rows;
    }, function (e) { L.loading = false; L.rows = []; L.err = msg(e); return []; });
  }
  function wsName(id) { var w = typeof WSS !== "undefined" && WSS[id]; return /^ws_user_/.test(id) && w && w.name === R.me ? "Mi espacio personal" : (w ? w.name : "otro espacio"); }
  function wsKind(id) { return (R.wsKind && R.wsKind[id]) || (/^ws_user_/.test(id) ? "personal" : "agency"); }
  function realWs() { return (R.realWs || [R.ws]).filter(function (id) { return typeof WSS !== "undefined" && WSS[id]; }); }
  function writeWs() { return R.all ? (R.writeWs && WSS[R.writeWs] ? R.writeWs : R.personalWs) : R.ws; }

  /* ───────── estilos (tokens de los editores: --e-panel #111, --e-line #222, --e-text #bdbdbd) ───────── */
  var css = ""
    + ".sk-tabs{display:flex;gap:6px;margin:0 0 14px;flex-wrap:wrap;align-items:center}"
    + ".sk-tabs button{border:1.5px solid var(--line,#333);background:transparent;color:inherit;border-radius:999px;height:34px;padding:0 14px;font:700 13px/1 var(--sans,Inter,system-ui,sans-serif);cursor:pointer}"
    + ".sk-tabs button.on{background:#f4f3ea;color:#111;border-color:#f4f3ea}"
    + ".sk-tabs .sp{flex:1}.sk-tabs .new{background:var(--accent,#ff5e00);color:#fff;border-color:transparent}"
    + ".sk-card .skcs{display:flex!important;gap:6px;flex-wrap:wrap;margin:2px 0 4px;height:auto!important}.sk-card .skc{display:inline-flex!important;align-items:center;position:static!important;height:auto!important;font:700 10.5px/1 var(--sans,Inter,system-ui,sans-serif);padding:5px 9px;border-radius:999px;background:rgba(0,0,0,.08);color:#333;white-space:nowrap}"
    + ".sk-card .skc.ok{background:#e3f6ea;color:#0f6b36}.sk-card .skc.bad{background:#fdeceb;color:#a3261d}.sk-card .skc.ws{color:#fff}"
    + ".sk-empty{border:2px dashed var(--line,#333);border-radius:16px;padding:28px;text-align:center}.sk-empty b{display:block;font-size:17px;margin-bottom:6px}.sk-empty p{opacity:.75;margin:0 0 14px}"
    /* editor */
    + "#skEd{position:fixed;inset:0;z-index:140;display:grid;grid-template-columns:210px minmax(0,1fr) 320px;grid-template-rows:48px minmax(0,1fr);background:#0a0a0a;color:var(--e-text,#bdbdbd);font:13px/1.4 var(--sans,Inter,system-ui,sans-serif);--e-panel:#111;--e-line:#222;--e-text:#bdbdbd;--e-muted:#6f6f6f;--e-hover:#1c1c1c}"
    + "#skEd[hidden]{display:none}"
    + "#skEd .sk-top{grid-column:1/-1;display:flex;align-items:center;gap:8px;padding:0 10px;border-bottom:1px solid var(--e-line);background:var(--e-panel);min-width:0}"
    + "#skEd .sk-top .nm{flex:0 1 320px;min-width:80px;background:transparent;border:1px solid transparent;border-radius:8px;color:#fff;font:700 14px/1 var(--sans,Inter,system-ui,sans-serif);height:32px;padding:0 8px}"
    + "#skEd .sk-top .nm:hover,#skEd .sk-top .nm:focus{border-color:var(--e-line);outline:0}"
    + "#skEd .tb{height:32px;padding:0 10px;border-radius:8px;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;color:var(--e-text);background:transparent;border:0;cursor:pointer;font:600 12.5px/1 var(--sans,Inter,system-ui,sans-serif)}"
    + "#skEd .tb:hover{background:var(--e-hover);color:#fff}#skEd .tb.on{background:#222;color:#fff}#skEd .tb:focus-visible{outline:2px solid var(--accent,#ff5e00)}"
    + "#skEd .tb.pri{background:var(--accent,#ff5e00);color:#fff}#skEd .tb[disabled]{opacity:.35;cursor:default}"
    + "#skEd .seg{display:inline-flex;background:#0d0d0d;border:1px solid var(--e-line);border-radius:10px;padding:2px;gap:2px}"
    + "#skEd .sp{flex:1}#skEd .st{font-size:11.5px;color:var(--e-muted);white-space:nowrap}"
    + "#skEd .iss{font:700 11px/1 var(--sans,Inter,system-ui,sans-serif);padding:5px 8px;border-radius:999px;background:#2a1414;color:#ff8a80;cursor:pointer;border:0}#skEd .iss.ok{background:#12261a;color:#7ee2a1}"
    + "#skEd .sk-pal,#skEd .sk-ins{background:var(--e-panel);min-height:0;overflow-y:auto;scrollbar-width:none}#skEd .sk-pal::-webkit-scrollbar,#skEd .sk-ins::-webkit-scrollbar{display:none}"
    + "#skEd .sk-pal{border-right:1px solid var(--e-line);padding:12px 10px}#skEd .sk-ins{border-left:1px solid var(--e-line);padding:12px}"
    + "#skEd h5{margin:4px 2px 8px;font:800 10.5px/1 var(--sans,Inter,system-ui,sans-serif);letter-spacing:.08em;text-transform:uppercase;color:var(--e-muted)}"
    + "#skEd .pb{display:flex;align-items:center;gap:10px;width:100%;border:1px solid var(--e-line);background:#141414;color:#ddd;border-radius:10px;padding:8px 10px;margin:0 0 6px;cursor:pointer;font:600 12.5px/1.2 var(--sans,Inter,system-ui,sans-serif);text-align:left}"
    + "#skEd .pb:hover{border-color:#3a3a3a;background:#1a1a1a;color:#fff}#skEd .pb small{display:block;color:var(--e-muted);font-weight:500;font-size:11px;margin-top:2px}"
    + "#skEd .pb i{flex:0 0 26px;height:18px;display:block;border:1.5px solid #888}"
    + "#skEd .pb i.t-step{border-radius:3px}#skEd .pb i.t-start{border-radius:9px}#skEd .pb i.t-decision{width:16px;flex-basis:16px;height:16px;transform:rotate(45deg);margin:0 5px}"
    + "#skEd .pb i.t-sub{border-left-width:4px;border-right-width:4px;border-radius:3px}#skEd .pb i.t-io{transform:skewX(-18deg);border-radius:2px}"
    + "#skEd .sk-mid{position:relative;min-width:0;min-height:0;overflow:hidden}"
    + "#skEd .sk-cv{position:absolute;inset:0;overflow:hidden;background:#0a0a0a radial-gradient(#1d1d1d 1px,transparent 1px) 0 0/20px 20px;touch-action:none;outline:0;cursor:grab}"
    + "#skEd .sk-cv.pan{cursor:grabbing}"
    + "#skEd .sk-w{position:absolute;left:0;top:0;transform-origin:0 0}"
    + "#skEd svg.sk-e{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}"
    + "#skEd svg.sk-e path.hit{stroke:transparent;stroke-width:16;fill:none;pointer-events:stroke;cursor:pointer}"
    + "#skEd svg.sk-e path.ln{stroke:#6b6b6b;stroke-width:2;fill:none}#skEd svg.sk-e path.ln.on{stroke:var(--accent,#ff5e00);stroke-width:2.5}"
    + "#skEd svg.sk-e path.tmp{stroke:var(--accent,#ff5e00);stroke-width:2;stroke-dasharray:6 5;fill:none}"
    + "#skEd .el{position:absolute;transform:translate(-50%,-50%);background:#0a0a0a;color:#ddd;border:1px solid #333;border-radius:999px;padding:3px 9px;font:700 11px/1.2 var(--sans,Inter,system-ui,sans-serif);white-space:nowrap;cursor:pointer;max-width:180px;overflow:hidden;text-overflow:ellipsis}"
    + "#skEd .el.on{border-color:var(--accent,#ff5e00);color:#fff}"
    + "#skEd .nd{position:absolute;transform:translate(-50%,-50%);display:grid;place-items:center;text-align:center;padding:8px 14px;box-sizing:border-box;color:#f2f2f2;font:600 13px/1.25 var(--sans,Inter,system-ui,sans-serif);cursor:pointer;user-select:none;-webkit-user-select:none;touch-action:none}"
    + "#skEd .nd .bg{position:absolute;inset:0;background:#1a1a1a;border:1.5px solid #3a3a3a;z-index:-1}"
    + "#skEd .nd.t-step .bg{border-radius:10px}#skEd .nd.t-start .bg,#skEd .nd.t-end .bg{border-radius:999px;background:#13261b;border-color:#2f6b45}"
    + "#skEd .nd.t-end .bg{background:#2a1a12;border-color:#7a4a2a}"
    + "#skEd .nd.t-decision .bg{clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);background:#3a3a3a;border:0}#skEd .nd.t-decision .bg::after{content:'';position:absolute;inset:2px;clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);background:#1d1a26}"
    + "#skEd .nd.t-decision{padding:16px 34px;font-size:12.5px}"
    + "#skEd .nd.t-sub .bg{border-radius:10px;border-left-width:6px;border-right-width:6px;border-color:#2f4f8f;background:#141b2b}"
    + "#skEd .nd.t-io .bg{transform:skewX(-14deg);border-radius:6px;background:#1f1a10;border-color:#6d5a2a}"
    + "#skEd .nd span{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}"
    + "#skEd .nd .tl{position:absolute;right:-6px;top:-9px;background:var(--accent,#ff5e00);color:#fff;border-radius:999px;font:700 9.5px/1 ui-monospace,Menlo,monospace;padding:3px 6px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none}"
    + "#skEd .nd .hw{position:absolute;left:-7px;top:-9px;width:18px;height:18px;border-radius:50%;background:#2a2a2a;color:#bbb;display:grid;place-items:center;font:800 10px/1 var(--sans,Inter,system-ui,sans-serif);pointer-events:none}"
    + "#skEd .nd.warn .bg{border-color:#b8860b}#skEd .nd.err .bg{border-color:#d33}#skEd .nd.on .bg{border-color:var(--accent,#ff5e00)!important;box-shadow:0 0 0 3px rgba(255,94,0,.25)}"
    + "#skEd .nd.t-decision.on .bg{background:var(--accent,#ff5e00)}"
    + "#skEd .nd .hd{position:absolute;width:18px;height:18px;border-radius:50%;background:var(--accent,#ff5e00);border:3px solid #0a0a0a;opacity:0;transition:opacity .12s;cursor:crosshair;touch-action:none}"
    + "#skEd .nd:hover .hd,#skEd .nd.on .hd{opacity:1}@media (hover:none){#skEd .nd.on .hd{opacity:1}}"
    + "#skEd .nd .hd.b{left:50%;bottom:-11px;transform:translateX(-50%)}#skEd .nd .hd.r{top:50%;right:-11px;transform:translateY(-50%)}"
    + "#skEd .zm{position:absolute;right:12px;bottom:12px;display:flex;gap:4px;background:var(--e-panel);border:1px solid var(--e-line);border-radius:10px;padding:3px}"
    + "#skEd .zm button{width:32px;height:32px;border:0;background:transparent;color:#ccc;border-radius:7px;cursor:pointer;font:700 14px/1 var(--sans,Inter,system-ui,sans-serif)}#skEd .zm button:hover{background:#222;color:#fff}"
    + "#skEd .zm span{min-width:46px;display:grid;place-items:center;font:600 11.5px/1 var(--sans,Inter,system-ui,sans-serif);color:#888}"
    /* panel derecho y formularios */
    + "#skEd label.f{display:block;margin:0 0 12px}#skEd label.f>span{display:block;font:700 11px/1.2 var(--sans,Inter,system-ui,sans-serif);color:#9a9a9a;margin:0 0 5px}"
    + "#skEd label.f small{display:block;color:var(--e-muted);font-size:11px;margin-top:4px}"
    + "#skEd input.i,#skEd textarea.i,#skEd select.i{width:100%;box-sizing:border-box;background:#0d0d0d;border:1px solid var(--e-line);border-radius:8px;color:#eee;padding:8px 10px;font:13px/1.4 var(--sans,Inter,system-ui,sans-serif);outline:0}"
    + "#skEd textarea.i{resize:vertical;min-height:84px}#skEd input.i:focus,#skEd textarea.i:focus,#skEd select.i:focus{border-color:var(--accent,#ff5e00)}"
    + "#skEd .tool{border:1px solid #3a2a1c;background:#1a120b;border-radius:10px;padding:9px 10px;margin:0 0 8px}#skEd .tool b{color:#ffb27f;font:700 12px/1.2 ui-monospace,Menlo,monospace}"
    + "#skEd .tool p{margin:4px 0 0;color:#aaa;font-size:11.5px}#skEd .tool button{float:right;border:0;background:transparent;color:#888;cursor:pointer;font-size:14px}"
    + "#skEd .tl-res{max-height:240px;overflow-y:auto;scrollbar-width:none;border:1px solid var(--e-line);border-radius:8px;margin:-6px 0 12px;background:#0d0d0d}#skEd .tl-res::-webkit-scrollbar{display:none}"
    + "#skEd .tl-res button{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid #1a1a1a;background:transparent;color:#ddd;padding:8px 10px;cursor:pointer}"
    + "#skEd .tl-res button:hover,#skEd .tl-res button:focus{background:#1a1a1a;outline:0}#skEd .tl-res b{font:700 12px/1.2 ui-monospace,Menlo,monospace;color:#ffb27f}#skEd .tl-res small{display:block;color:#888;font-size:11px;margin-top:2px}"
    + "#skEd .cx{display:flex;gap:6px;align-items:center;margin:0 0 6px}#skEd .cx span{flex:0 0 auto;color:#888;font-size:11.5px}#skEd .cx input{flex:1}#skEd .cx button{border:0;background:#1d1d1d;color:#bbb;border-radius:7px;width:30px;height:30px;cursor:pointer}"
    + "#skEd .row2{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}#skEd .row2 .tb{border:1px solid var(--e-line)}"
    + "#skEd .sw{display:flex;gap:10px;align-items:flex-start;margin:0 0 12px;color:#ddd;font-size:12.5px}#skEd .sw input{margin-top:2px;accent-color:var(--accent,#ff5e00)}#skEd .sw small{display:block;color:var(--e-muted);font-size:11px}"
    /* vistas Mermaid y Skill */
    + "#skEd .sk-code,#skEd .sk-prev{position:absolute;inset:0;overflow:auto;scrollbar-width:none;background:#0d0d0d}#skEd .sk-code::-webkit-scrollbar,#skEd .sk-prev::-webkit-scrollbar{display:none}"
    + "#skEd .sk-code textarea{width:100%;height:100%;box-sizing:border-box;border:0;outline:0;resize:none;background:#0d0d0d;color:#e6e6e6;padding:18px 20px 60px;font:13px/1.6 ui-monospace,Menlo,Consolas,monospace;tab-size:2}"
    + "#skEd .sk-code .cmsg{position:absolute;left:12px;right:12px;bottom:12px;background:#151515;border:1px solid var(--e-line);border-radius:10px;padding:8px 12px;font-size:12px;color:#aaa}"
    + "#skEd .sk-prev{padding:22px 26px 60px;color:#ddd}#skEd .sk-prev .doc{max-width:760px;margin:0 auto}"
    + "#skEd .sk-prev h1{font:800 26px/1.15 var(--sans,Inter,system-ui,sans-serif);color:#fff;margin:6px 0 12px;text-transform:none;letter-spacing:0}#skEd .sk-prev h2{font:800 15px/1.2 var(--sans,Inter,system-ui,sans-serif);color:#fff;margin:22px 0 8px;text-transform:none;letter-spacing:0}"
    + "#skEd .sk-prev p{margin:0 0 8px}#skEd .sk-prev ul,#skEd .sk-prev ol{margin:0 0 8px;padding-left:20px}#skEd .sk-prev li{margin:3px 0}"
    + "#skEd .sk-prev code{font:12px/1.4 ui-monospace,Menlo,monospace;background:#1d1d1d;color:#ffb27f;padding:1px 6px;border-radius:5px}"
    + "#skEd .sk-prev pre{background:#141414;border:1px solid var(--e-line);border-radius:10px;padding:12px;overflow:auto;font:12px/1.5 ui-monospace,Menlo,monospace;color:#bbb}"
    + "#skEd .sk-prev .stp{border:1px solid var(--e-line);border-radius:12px;padding:10px 12px;margin:0 0 8px;background:#121212}"
    + "#skEd .sk-prev .stp .n{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;background:#222;color:#fff;font:800 11px/1 var(--sans,Inter,system-ui,sans-serif);margin-right:8px}"
    + "#skEd .sk-prev .stp .how{white-space:pre-line;color:#cfcfcf;margin:6px 0 0 32px}#skEd .sk-prev .stp .meta{margin:6px 0 0 32px;display:flex;gap:6px;flex-wrap:wrap}"
    + "#skEd .sk-prev .stp .meta span{font-size:11.5px;border-radius:999px;padding:3px 9px;background:#1d1d1d;color:#bbb}#skEd .sk-prev .stp .meta span.t{background:#2b1a0e;color:#ffb27f;font-family:ui-monospace,Menlo,monospace}"
    + "#skEd .sk-prev .isl{border-radius:12px;padding:10px 12px;margin:0 0 14px;background:#1a1212;border:1px solid #3a1d1d}#skEd .sk-prev .isl.ok{background:#101a13;border-color:#1f3a28;color:#7ee2a1}"
    + "#skEd .sk-prev .isl li{cursor:pointer}#skEd .sk-prev .isl li.w{color:#e8c46a}#skEd .sk-prev .isl li.e{color:#ff8a80}"
    + "#skEd .sk-prev .walk{border:1px solid #3a2a1c;background:#140e09;border-radius:14px;padding:14px;margin:0 0 16px}#skEd .sk-prev .walk b{color:#fff}#skEd .sk-prev .walk .opts{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}"
    + "#skEd .sk-prev .walk .opts button,#skEd .sk-prev .btns button{border:0;border-radius:999px;height:34px;padding:0 14px;background:#fff;color:#111;font:700 12.5px/1 var(--sans,Inter,system-ui,sans-serif);cursor:pointer}"
    + "#skEd .sk-prev .btns{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}#skEd .sk-prev .btns button.g{background:#222;color:#ddd}"
    /* celular */
    + "#skEd .m-bar{display:none}"
    + "@media (max-width:760px){"
    + "#skEd{grid-template-columns:minmax(0,1fr);grid-template-rows:48px minmax(0,1fr) 58px}"
    + "#skEd .sk-pal,#skEd .sk-ins{position:fixed;left:0;right:0;bottom:58px;max-height:68vh;z-index:3;border:0;border-top:1px solid var(--e-line);border-radius:16px 16px 0 0;box-shadow:0 -12px 40px rgba(0,0,0,.6);display:none;padding-bottom:16px}"
    + "#skEd .sk-pal.open,#skEd .sk-ins.open{display:block}"
    + "#skEd .sk-mid{grid-column:1;grid-row:2}"
    + "#skEd .m-bar{display:flex;grid-column:1;grid-row:3;border-top:1px solid var(--e-line);background:var(--e-panel);padding:0 4px max(0px,env(safe-area-inset-bottom))}"
    + "#skEd .m-bar button{flex:1;border:0;background:transparent;color:#aaa;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font:700 10.5px/1 var(--sans,Inter,system-ui,sans-serif);cursor:pointer;border-radius:10px;margin:5px 2px}"
    + "#skEd .m-bar button.on{color:#fff;background:#1d1d1d}"
    + "#skEd .sk-top .seg,#skEd .sk-top .hide-m{display:none}#skEd .sk-top .nm{flex:1}"
    + "#skEd .zm{bottom:10px;right:10px}"
    + "#skEd .sk-prev{padding:16px 14px 60px}"
    + "}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  /* ───────── markdown mínimo y seguro para la vista de la skill ───────── */
  function inline(t) { return esc(t).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>"); }
  function md(src) {
    var lines = String(src || "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").split(/\r?\n/), out = [], list = null, code = null;
    function close() { if (list) { out.push("</" + list + ">"); list = null; } }
    lines.forEach(function (l) {
      if (code !== null) { if (/^```/.test(l)) { out.push("<pre>" + esc(code.join("\n")) + "</pre>"); code = null; } else code.push(l); return; }
      if (/^```/.test(l)) { close(); code = []; return; }
      if (/^\s*$/.test(l)) { close(); return; }
      var m;
      if ((m = l.match(/^(#{1,3})\s+(.*)$/))) { close(); out.push("<h" + (m[1].length === 1 ? 1 : 2) + ">" + inline(m[2]) + "</h" + (m[1].length === 1 ? 1 : 2) + ">"); return; }
      if ((m = l.match(/^\s*\d+\.\s+(.*)$/))) { if (list !== "ol") { close(); out.push("<ol>"); list = "ol"; } out.push("<li>" + inline(m[1]) + "</li>"); return; }
      if ((m = l.match(/^\s*[-•]\s+(.*)$/))) { if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; } out.push("<li>" + inline(m[1]) + "</li>"); return; }
      close(); out.push("<p>" + inline(l.trim()) + "</p>");
    });
    close(); return out.join("");
  }

  /* ════════════════ Agentes › Skills: pestañas «Mis skills» / «Skills de Musa» ════════════════ */
  var _musaView = null;
  function view() {
    var body = document.getElementById("body"); if (!body) return;
    if (L.tab === "musa" && _musaView) { _musaView(); prependTabs(body); return; }
    drawMine();
  }
  function prependTabs(body) {
    var t = document.createElement("div"); t.className = "sk-tabs"; t.innerHTML = tabsHtml();
    body.insertBefore(t, body.firstChild);
  }
  function tabsHtml() {
    return '<button type="button" data-skt="mine" class="' + (L.tab === "mine" ? "on" : "") + '" aria-pressed="' + (L.tab === "mine") + '">Mis skills</button>'
      + '<button type="button" data-skt="musa" class="' + (L.tab === "musa" ? "on" : "") + '" aria-pressed="' + (L.tab === "musa") + '">Skills de Musa</button>'
      + '<span class="sp"></span>'
      + (L.tab === "mine" ? '<button type="button" data-skn="import">Importar Mermaid</button><button type="button" class="new" data-skn="new" data-action="nueva-skill">+ Nueva skill</button>' : "");
  }
  function wsChip(id) { var c = wsKind(id) === "agency" ? "#ff5e00" : "#0e9f9e"; return '<span class="skc ws" style="background:' + c + '">' + esc(wsName(id)) + "</span>"; }
  function drawMine() {
    var body = document.getElementById("body"); if (!body || !/agentes\/skills/.test(location.hash)) return;
    if (!L.rows) { body.innerHTML = '<div class="sk-tabs">' + tabsHtml() + '</div><div class="ws-note">Cargando tus skills…</div>'; loadRows().then(function () { if (/agentes\/skills/.test(location.hash) && L.tab === "mine") drawMine(); }); return; }
    var h = '<div class="sk-tabs">' + tabsHtml() + "</div>";
    h += '<div class="ws-note">Tus procesos como skills: arma el flujograma (o pega Mermaid) y Musa lo convierte al instante, sin gastar IA, en una skill con el qué, el cómo y la herramienta de Musa de cada paso. Tu IA las ve en <code>list_skills</code> y las sigue al pie de la letra. Puedes dejarlas privadas o compartirlas con tu equipo; tus clientes nunca las ven.</div>';
    if (!L.rows.length) {
      h += '<div class="sk-empty"><b>Todavía no tienes skills propias</b><p>Empieza por un proceso que repites: aprobar piezas, dar de alta un cliente, preparar un lanzamiento…</p><div class="ag-ctl" style="justify-content:center"><button class="pri" data-skn="new">Crear mi primera skill</button><button data-skn="import">Importar Mermaid</button></div></div>';
    } else {
      h += '<div class="org-grid">' + L.rows.map(function (r) {
        var bad = (r.issues || []).filter(function (i) { return i.level === "error"; }).length, nSteps = (r.steps || []).length;
        return '<div class="org-a sk-card" data-skrow="' + esc(r.id) + '"><div class="skcs">' + (R.all ? wsChip(r.workspace_id) : "") + '<span class="skc">' + (r.visibility === "workspace" ? "Compartida con el equipo" : "Privada") + '</span><span class="skc ' + (bad ? "bad" : "ok") + '">' + (bad ? bad + (bad === 1 ? " error" : " errores") : "Lista") + "</span></div>"
          + "<b>" + esc(r.name) + "</b><small>" + esc(r.description || "Sin descripción todavía") + "</small>"
          + '<div class="row"><span>Pasos</span><b>' + nSteps + '</b></div><div class="row"><span>Herramientas de Musa</span><b>' + (r.tools || []).length + '</b></div><div class="row"><span>Versión</span><b>' + (r.version || 1) + "</b></div>"
          + '<div class="ag-ctl" style="margin-top:6px;flex-wrap:wrap"><button class="pri" data-ska="edit" data-id="' + esc(r.id) + '">Editar</button><button data-ska="view" data-id="' + esc(r.id) + '">Ver skill</button>'
          + (r.created_by === uid() || r.visibility === "workspace" ? '<button data-ska="share" data-id="' + esc(r.id) + '">' + (r.visibility === "workspace" ? "Hacer privada" : "Compartir") + "</button>" : "")
          + '<button data-ska="move" data-id="' + esc(r.id) + '">Mover</button><button data-ska="del" data-id="' + esc(r.id) + '">Borrar</button></div></div>';
      }).join("") + "</div>";
    }
    body.innerHTML = h;
  }
  function rowById(id) { return (L.rows || []).find(function (r) { return r.id === id; }); }

  document.addEventListener("click", function (e) {
    if (!/agentes\/skills/.test(location.hash)) return;
    var t = e.target;
    var tb = t.closest && t.closest("[data-skt]");
    if (tb) { e.preventDefault(); L.tab = tb.getAttribute("data-skt"); if (typeof drawView === "function") drawView(); return; }
    var nb = t.closest && t.closest("[data-skn]");
    if (nb) { e.preventDefault(); return nb.getAttribute("data-skn") === "import" ? importMermaid() : newSkill(); }
    var ab = t.closest && t.closest("[data-ska]");
    if (!ab) return;
    e.preventDefault(); e.stopPropagation();
    var r = rowById(ab.getAttribute("data-id")); if (!r) return;
    var k = ab.getAttribute("data-ska");
    if (k === "edit") return openEditor(r);
    if (k === "view") return R.dialog({ title: r.name, body: '<div style="max-height:60vh;overflow:auto">' + md(r.markdown) + "</div>", ok: "Listo", cancel: false, wide: true, action: "ver-skill-propia" });
    if (k === "share") {
      var to = r.visibility === "workspace" ? "private" : "workspace";
      return api("/rest/v1/workspace_skills?id=eq." + encodeURIComponent(r.id), J("PATCH", { visibility: to, updated_by: uid() })).then(function () {
        toast(to === "workspace" ? "Compartida con tu equipo" : "Ahora es privada"); return loadRows().then(drawMine);
      }, function (x) { R.notice("No se pudo cambiar", msg(x)); });
    }
    if (k === "move") { if (R.openMove) R.openMove([{ type: "skill", id: r.id, name: r.name }]); return; }
    if (k === "del") {
      return R.confirmBox("Tu IA dejará de verla. No afecta a las skills de Musa.", { title: "¿Borrar «" + r.name + "»?", danger: true, ok: "Borrar" }).then(function (ok) {
        if (!ok) return;
        return api("/rest/v1/workspace_skills?id=eq." + encodeURIComponent(r.id), J("PATCH", { deleted_at: new Date().toISOString() })).then(function () { toast("Skill borrada"); return loadRows().then(drawMine); }, function (x) { R.notice("No se pudo borrar", msg(x)); });
      });
    }
  }, true);

  /* crear: nombre, espacio (si tienes varios) y si se comparte con el equipo */
  function askNew(title, extra) {
    var ids = realWs(), cur = writeWs();
    var fields = [{ name: "name", label: "Nombre de la skill", placeholder: "Ej. Aprobación de piezas con el cliente", required: true }];
    if (ids.length > 1) fields.push({ name: "ws", label: "Espacio", type: "select", value: cur, options: ids.map(function (id) { return { value: id, label: wsName(id) + (wsKind(id) === "agency" ? " · agencia" : "") }; }) });
    fields.push({ name: "share", label: "Compartirla con el equipo del espacio", type: "checkbox", value: false, hint: "Si no, solo tú la ves. Los clientes nunca la ven." });
    return R.dialog({ title: title, fields: (extra || []).concat(fields), ok: "Crear", action: "nueva-skill", wide: !!(extra && extra.length) });
  }
  function newSkill() {
    askNew("Nueva skill").then(function (v) {
      if (!v) return;
      var g = SF().starter(v.name.trim());
      openEditor(null, { graph: g, ws: v.ws || writeWs(), visibility: v.share ? "workspace" : "private" });
    });
  }
  function importMermaid() {
    askNew("Importar Mermaid", [{ name: "src", label: "Pega tu flujograma Mermaid", type: "textarea", rows: 10, placeholder: "flowchart TD\n  A([Inicio]) --> B[Revisar brief]\n  B --> C{¿Aprobado?}\n  C -->|sí| D([Fin])\n  C -->|no| B", required: true }]).then(function (v) {
      if (!v) return;
      var g = SF().parse(v.src);
      if (!g.nodes.length) return R.notice("No encontré pasos", "Revisa que empiece con «flowchart TD» (o «graph LR») y tenga nodos y flechas.");
      g.meta.name = g.meta.name || v.name.trim();
      openEditor(null, { graph: g, ws: v.ws || writeWs(), visibility: v.share ? "workspace" : "private" });
    });
  }

  /* ════════════════ editor ════════════════ */
  var E = null; // estado del editor abierto
  var ICON = {
    back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    undo: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
    redo: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/></svg>',
    add: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    flow: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="5" rx="1"/><rect x="14" y="16" width="7" height="5" rx="1"/><path d="M6.5 8v4h11v4"/></svg>',
    code: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/></svg>',
    doc: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h7"/></svg>',
    edit: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  };
  function root() {
    var el = document.getElementById("skEd");
    if (!el) { el = document.createElement("div"); el.id = "skEd"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Editor de skills"); document.body.appendChild(el); }
    return el;
  }
  function openEditor(row, fresh) {
    loadTools().then(function () {
      var g;
      if (row) { g = Object.assign(SF().blank(), JSON.parse(JSON.stringify(row.graph || {}))); g.nodes = g.nodes || []; g.edges = g.edges || []; g.meta = Object.assign(SF().blank().meta, row.meta || {}, g.meta || {}); if (!g.nodes.length && row.mermaid) g = SF().parse(row.mermaid); SF().layout(g, true); }
      else g = fresh.graph;
      E = { id: row ? row.id : null, ws: row ? row.workspace_id : fresh.ws, visibility: row ? row.visibility : fresh.visibility, slug: row ? row.slug : null, version: row ? row.version : 0,
        g: g, sel: null, selEdge: null, view: "flow", z: 1, px: 0, py: 0, hist: [], fut: [], dirty: !row, saving: false, savedAt: row ? Date.now() : 0, panel: null, walk: null, owner: row ? row.created_by === uid() : true };
      var el = root();
      el.innerHTML = '<div class="sk-top"><button type="button" class="tb" data-k="close" aria-label="Volver a Mis skills" title="Volver">' + ICON.back + '</button>'
        + '<input class="nm" data-k="name" aria-label="Nombre de la skill" placeholder="Nombre de la skill">'
        + '<div class="seg hide-m" role="tablist" aria-label="Vista"><button type="button" class="tb" data-v="flow" role="tab">Diagrama</button><button type="button" class="tb" data-v="code" role="tab">Mermaid</button><button type="button" class="tb" data-v="prev" role="tab">Skill</button></div>'
        + '<button type="button" class="tb hide-m" data-k="undo" aria-label="Deshacer" title="Deshacer (Ctrl+Z)">' + ICON.undo + '</button><button type="button" class="tb hide-m" data-k="redo" aria-label="Rehacer" title="Rehacer (Ctrl+Y)">' + ICON.redo + "</button>"
        + '<span class="sp"></span><button type="button" class="iss" data-k="issues"></button><span class="st hide-m" aria-live="polite"></span><button type="button" class="tb pri" data-k="save">Guardar</button></div>'
        + '<aside class="sk-pal" aria-label="Agregar al flujograma"></aside><div class="sk-mid"></div><aside class="sk-ins" aria-label="Propiedades"></aside>'
        + '<nav class="m-bar" aria-label="Editor"><button type="button" data-m="pal">' + ICON.add + 'Agregar</button><button type="button" data-m="ins">' + ICON.edit + 'Editar</button><button type="button" data-m="flow">' + ICON.flow + 'Diagrama</button><button type="button" data-m="code">' + ICON.code + 'Mermaid</button><button type="button" data-m="prev">' + ICON.doc + "Skill</button></nav>";
      el.hidden = false;
      el.querySelector(".nm").value = g.meta.name || "";
      drawPal(); setView("flow"); fit(); drawIns(); status();
      if (!row) save(true);
    });
  }
  function closeEditor() {
    var go = function () { root().hidden = true; E = null; loadRows().then(function () { if (/agentes\/skills/.test(location.hash) && L.tab === "mine") drawMine(); }); };
    if (E && E.dirty) { save(true).then(go, go); } else go();
  }

  /* historia (deshacer/rehacer) */
  function snap() { return JSON.stringify(E.g); }
  function push() { E.hist.push(snap()); if (E.hist.length > 80) E.hist.shift(); E.fut = []; }
  function changed(noHist) { E.dirty = true; status(); schedSave(); if (E.view === "code") drawCode(true); if (E.view === "prev") drawPrev(); }
  function undo() { if (!E.hist.length) return; E.fut.push(snap()); E.g = JSON.parse(E.hist.pop()); E.sel = null; E.selEdge = null; redraw(); changed(); }
  function redo() { if (!E.fut.length) return; E.hist.push(snap()); E.g = JSON.parse(E.fut.pop()); redraw(); changed(); }
  function redraw() { if (E.view === "flow") drawFlow(); drawIns(); }

  /* validación y guardado (la conversión es local y al instante; el servidor guarda lo mismo que vería el MCP) */
  function issues() {
    var slugs = {}; (L.rows || []).forEach(function (r) { if (r.workspace_id === E.ws && r.id !== E.id) slugs[r.slug] = 1; });
    return SF().validate(E.g, { tools: toolSet(), skills: slugs });
  }
  function status() {
    if (!E) return;
    var el = root(), is = issues(), errs = is.filter(function (i) { return i.level === "error"; }).length, warns = is.length - errs;
    var b = el.querySelector(".iss");
    b.className = "iss" + (is.length ? "" : " ok");
    b.textContent = errs ? errs + (errs === 1 ? " error" : " errores") : warns ? warns + (warns === 1 ? " aviso" : " avisos") : "Lista";
    b.title = is.length ? "Ver qué falta" : "La skill está lista para tu IA";
    var s = el.querySelector(".st"); if (s) s.textContent = E.saving ? "Guardando…" : E.dirty ? "Cambios sin guardar" : E.savedAt ? "Guardado · v" + E.version : "";
    var u = el.querySelector('[data-k="undo"]'), r = el.querySelector('[data-k="redo"]'); if (u) u.disabled = !E.hist.length; if (r) r.disabled = !E.fut.length;
    var nodeIss = {}; is.forEach(function (i) { if (i.id) nodeIss[i.id] = i.level === "error" ? "err" : nodeIss[i.id] || "warn"; });
    el.querySelectorAll(".nd").forEach(function (n) { var k = nodeIss[n.getAttribute("data-id")]; n.classList.toggle("err", k === "err"); n.classList.toggle("warn", k === "warn"); });
  }
  var saveT = null;
  function schedSave() { clearTimeout(saveT); saveT = setTimeout(function () { save(false); }, 1500); }
  function save(now) {
    clearTimeout(saveT);
    if (!E) return Promise.resolve();
    var g = E.g, sf = SF();
    if (!String(g.meta.name || "").trim()) { status(); return Promise.resolve(); }
    var is = issues();
    var slug = E.slug;
    if (!slug) {
      var base = sf.slugify(g.meta.name), s = base, i = 2, taken = {};
      (L.rows || []).forEach(function (r) { if (r.workspace_id === E.ws) taken[r.slug] = 1; });
      while (taken[s]) s = base + "-" + i++;
      slug = s;
    }
    var descMap = {}; g.nodes.forEach(function (n) { if (n.tool && TOOLMAP[n.tool]) descMap[n.tool] = TOOLMAP[n.tool].d; });
    var sk = sf.toSkill(g, { slug: slug, tools: descMap }), mermaid = sf.toMermaid(g);
    var body = { workspace_id: E.ws, name: sk.name, slug: slug, description: sk.description, meta: g.meta, graph: g, mermaid: mermaid, markdown: sk.markdown, steps: sk.steps, tools: sk.tools, issues: is, visibility: E.visibility, fingerprint: sf.fingerprint(mermaid), updated_by: uid() };
    E.saving = true; status();
    var req = E.id ? api("/rest/v1/workspace_skills?id=eq." + encodeURIComponent(E.id), J("PATCH", body))
      : api("/rest/v1/workspace_skills", J("POST", Object.assign({ created_by: uid() }, body)));
    var cur = E;
    return req.then(function (rows) {
      var r = Array.isArray(rows) ? rows[0] : rows;
      if (!cur || cur !== E) return;
      E.saving = false; E.dirty = false; E.savedAt = Date.now();
      if (r) { E.id = r.id; E.slug = r.slug; E.version = r.version; R.wsOf = R.wsOf || {}; R.wsOf["skill:" + r.id] = r.workspace_id; }
      status();
    }, function (x) {
      if (cur !== E) return;
      E.saving = false; status();
      var m = msg(x);
      if (/duplicate|unique/i.test(m) && !E.id) { E.slug = slug + "-" + Math.random().toString(36).slice(2, 5); return save(true); }
      toast("No se pudo guardar: " + m);
    });
  }

  /* paleta */
  var PAL = [["step", "Paso", "Algo que se hace"], ["decision", "Decisión", "Una pregunta con caminos"], ["sub", "Subproceso", "Otra skill tuya"], ["io", "Dato", "Algo que entra o sale"], ["start", "Inicio", "Dónde arranca"], ["end", "Fin", "Dónde termina"]];
  function drawPal() {
    var el = root().querySelector(".sk-pal");
    el.innerHTML = "<h5>Agregar</h5>" + PAL.map(function (p) { return '<button type="button" class="pb" data-add="' + p[0] + '"><i class="t-' + (p[0] === "end" ? "start" : p[0]) + '"></i><span>' + p[1] + "<small>" + p[2] + "</small></span></button>"; }).join("")
      + '<h5 style="margin-top:16px">Diagrama</h5><button type="button" class="pb" data-k="layout"><span>Ordenar automáticamente<small>Acomoda todo de arriba a abajo</small></span></button>'
      + '<button type="button" class="pb" data-k="dir"><span>' + (E.g.dir === "LR" ? "Pasar a vertical" : "Pasar a horizontal") + "<small>Dirección del flujograma</small></span></button>"
      + '<button type="button" class="pb" data-k="fit"><span>Ver todo<small>Encuadra el flujograma</small></span></button>'
      + '<h5 style="margin-top:16px">Atajos</h5><p style="font-size:11.5px;color:var(--e-muted);margin:0 2px;line-height:1.5">Arrastra un paso para moverlo. Arrastra el punto naranja hasta otro paso para conectarlos. Supr borra. Ctrl+Z deshace. Rueda o pellizco para acercar.</p>';
  }
  function addNode(type) {
    push();
    var g = E.g, sf = SF(), id = sf.newId(g, type === "decision" ? "D" : type === "start" ? "I" : type === "end" ? "F" : "P");
    var from = E.sel && g.nodes.find(function (n) { return n.id === E.sel; });
    var n = { id: id, type: type, text: type === "decision" ? "¿Pregunta?" : TYPE_ES[type], how: "", tool: "", toolNote: "", link: "", x: 0, y: 0 };
    if (from) { var horiz = g.dir === "LR"; n.x = from.x + (horiz ? 260 : 0) + (g.edges.filter(function (e) { return e.from === from.id; }).length * (horiz ? 0 : 240)); n.y = from.y + (horiz ? g.edges.filter(function (e) { return e.from === from.id; }).length * 130 : 150); }
    else { var c = toWorld(midScreen()); n.x = c.x; n.y = c.y; }
    g.nodes.push(n);
    if (from && from.type !== "end" && type !== "start") g.edges.push({ from: from.id, to: id, label: from.type === "decision" ? (g.edges.some(function (e) { return e.from === from.id; }) ? "no" : "sí") : "" });
    E.sel = id; E.selEdge = null;
    drawFlow(); drawIns(); changed(); closeSheets();
    if (MOBILE.matches) openSheet("ins");
  }
  function midScreen() { var cv = root().querySelector(".sk-cv"), r = cv ? cv.getBoundingClientRect() : { width: 600, height: 400 }; return { x: r.width / 2, y: r.height / 2 }; }
  function toWorld(p) { return { x: (p.x - E.px) / E.z, y: (p.y - E.py) / E.z }; }

  /* ───────── vista Diagrama ───────── */
  function setView(v) {
    E.view = v;
    var el = root(), mid = el.querySelector(".sk-mid");
    el.querySelectorAll("[data-v]").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-v") === v); b.setAttribute("aria-selected", b.getAttribute("data-v") === v); });
    el.querySelectorAll(".m-bar [data-m]").forEach(function (b) { var k = b.getAttribute("data-m"); b.classList.toggle("on", k === v || (k === E.panel)); });
    if (v === "flow") { mid.innerHTML = '<div class="sk-cv" tabindex="0" aria-label="Lienzo del flujograma"><div class="sk-w"><svg class="sk-e" width="1" height="1"><defs><marker id="skArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#6b6b6b"/></marker><marker id="skArrOn" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#ff5e00"/></marker></defs><g class="eg"></g><path class="tmp" d="" /></svg><div class="ns"></div></div></div><div class="zm"><button type="button" data-k="zout" aria-label="Alejar">−</button><span></span><button type="button" data-k="zin" aria-label="Acercar">+</button><button type="button" data-k="fit" aria-label="Ver todo" title="Ver todo">⤢</button></div>'; bindCanvas(); drawFlow(); }
    if (v === "code") drawCode(false);
    if (v === "prev") drawPrev();
  }
  function dims(n) { return SIZE[n.type] || SIZE.step; }
  function drawFlow() {
    var el = root(), w = el.querySelector(".sk-w"); if (!w) return;
    var ns = w.querySelector(".ns"), g = E.g;
    ns.innerHTML = g.nodes.map(function (n) {
      var d = dims(n);
      return '<div class="nd t-' + n.type + (E.sel === n.id ? " on" : "") + '" data-id="' + esc(n.id) + '" style="left:' + n.x + "px;top:" + n.y + "px;width:" + d[0] + "px;height:" + d[1] + 'px" role="button" tabindex="-1" aria-label="' + esc(TYPE_ES[n.type] + ": " + n.text) + '">'
        + '<div class="bg"></div><span>' + esc(n.text) + "</span>"
        + (n.tool ? '<em class="tl" title="Herramienta de Musa">' + esc(n.tool) + "</em>" : "")
        + (n.how ? '<em class="hw" title="Tiene el cómo">i</em>' : "")
        + (n.type !== "end" ? '<i class="hd ' + (g.dir === "LR" ? "r" : "b") + '" data-hd="' + esc(n.id) + '" title="Arrastra hasta otro paso para conectar"></i>' : "") + "</div>";
    }).join("");
    drawEdges(); applyT(); status();
  }
  function anchor(n, toward) {
    var d = dims(n), dx = toward.x - n.x, dy = toward.y - n.y;
    if (!dx && !dy) return { x: n.x, y: n.y };
    var hw = d[0] / 2, hh = d[1] / 2, s;
    if (n.type === "decision") s = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
    else s = Math.min(Math.abs(dx) > 0 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 0 ? hh / Math.abs(dy) : Infinity);
    return { x: n.x + dx * s, y: n.y + dy * s };
  }
  function edgePath(a, b, g) {
    var p1 = anchor(a, b), p2 = anchor(b, a), horiz = g.dir === "LR";
    var back = horiz ? b.x < a.x - 20 : b.y < a.y - 20, mx, my, d;
    if (back) {
      var off = 140;
      var c1 = horiz ? { x: p1.x, y: p1.y + off } : { x: p1.x + off, y: p1.y };
      var c2 = horiz ? { x: p2.x, y: p2.y + off } : { x: p2.x + off, y: p2.y };
      d = "M" + p1.x + " " + p1.y + " C" + c1.x + " " + c1.y + " " + c2.x + " " + c2.y + " " + p2.x + " " + p2.y;
      mx = (p1.x + p2.x) / 2 + (horiz ? 0 : off * 0.75); my = (p1.y + p2.y) / 2 + (horiz ? off * 0.75 : 0);
    } else {
      var k = horiz ? Math.max(40, Math.abs(p2.x - p1.x) / 2) : Math.max(40, Math.abs(p2.y - p1.y) / 2);
      var c1b = horiz ? { x: p1.x + k, y: p1.y } : { x: p1.x, y: p1.y + k }, c2b = horiz ? { x: p2.x - k, y: p2.y } : { x: p2.x, y: p2.y - k };
      if (Math.abs(horiz ? p2.y - p1.y : p2.x - p1.x) < 2) { c1b = p1; c2b = p2; }
      d = "M" + p1.x + " " + p1.y + " C" + c1b.x + " " + c1b.y + " " + c2b.x + " " + c2b.y + " " + p2.x + " " + p2.y;
      mx = (p1.x + 3 * c1b.x + 3 * c2b.x + p2.x) / 8; my = (p1.y + 3 * c1b.y + 3 * c2b.y + p2.y) / 8;
    }
    return { d: d, mx: mx, my: my };
  }
  function drawEdges() {
    var el = root(), w = el.querySelector(".sk-w"); if (!w) return;
    var g = E.g, by = {}; g.nodes.forEach(function (n) { by[n.id] = n; });
    var paths = "", labels = "";
    g.edges.forEach(function (e, i) {
      var a = by[e.from], b = by[e.to]; if (!a || !b) return;
      var p = edgePath(a, b, g), on = E.selEdge === i;
      paths += '<path class="hit" data-e="' + i + '" d="' + p.d + '"/><path class="ln' + (on ? " on" : "") + '" d="' + p.d + '" marker-end="url(#' + (on ? "skArrOn" : "skArr") + ')"/>';
      if (e.label) labels += '<div class="el' + (on ? " on" : "") + '" data-e="' + i + '" style="left:' + p.mx + "px;top:" + p.my + 'px">' + esc(e.label) + "</div>";
    });
    w.querySelector(".eg").innerHTML = paths;
    w.querySelectorAll(".el").forEach(function (x) { x.remove(); });
    w.insertAdjacentHTML("beforeend", labels);
  }
  function applyT() {
    var el = root(), w = el.querySelector(".sk-w"); if (!w) return;
    w.style.transform = "translate(" + E.px + "px," + E.py + "px) scale(" + E.z + ")";
    var s = el.querySelector(".zm span"); if (s) s.textContent = Math.round(E.z * 100) + "%";
  }
  function fit() {
    if (!E || E.view !== "flow") return;
    var cv = root().querySelector(".sk-cv"); if (!cv) return;
    var r = cv.getBoundingClientRect(), g = E.g; if (!g.nodes.length || !r.width) { E.z = 1; E.px = r.width / 2; E.py = 80; applyT(); return; }
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    g.nodes.forEach(function (n) { var d = dims(n); x0 = Math.min(x0, n.x - d[0] / 2); y0 = Math.min(y0, n.y - d[1] / 2); x1 = Math.max(x1, n.x + d[0] / 2); y1 = Math.max(y1, n.y + d[1] / 2); });
    x1 += 160; // espacio para las flechas que vuelven
    var pad = MOBILE.matches ? 24 : 60, z = Math.min((r.width - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0), 1.2);
    E.z = Math.max(0.2, z); E.px = (r.width - (x1 - x0) * E.z) / 2 - x0 * E.z; E.py = (r.height - (y1 - y0) * E.z) / 2 - y0 * E.z;
    applyT();
  }
  function zoomAt(f, sx, sy) {
    var nz = Math.max(0.2, Math.min(2.5, E.z * f)); f = nz / E.z;
    E.px = sx - (sx - E.px) * f; E.py = sy - (sy - E.py) * f; E.z = nz; applyT();
  }

  /* gestos del lienzo: mover pasos, conectar, desplazar, pellizcar */
  function bindCanvas() {
    var cv = root().querySelector(".sk-cv"), ptrs = new Map(), act = null;
    function rel(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    cv.addEventListener("pointerdown", function (e) {
      if (e.button > 0) return;
      try { cv.setPointerCapture(e.pointerId); } catch (x) {}
      ptrs.set(e.pointerId, rel(e));
      if (ptrs.size === 2) { var pts = Array.from(ptrs.values()); act = { kind: "pinch", d0: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), z0: E.z, px0: E.px, py0: E.py, c0: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } }; return; }
      var p = rel(e), hd = e.target.closest(".hd"), nd = e.target.closest(".nd"), hit = e.target.closest("[data-e]");
      if (hd) { act = { kind: "link", from: hd.getAttribute("data-hd"), p: p }; e.preventDefault(); return; }
      if (nd) { var n = E.g.nodes.find(function (x) { return x.id === nd.getAttribute("data-id"); }); act = { kind: "node", n: n, p0: p, x0: n.x, y0: n.y, moved: false }; return; }
      if (hit) { act = { kind: "edge", i: +hit.getAttribute("data-e"), p0: p }; return; }
      act = { kind: "pan", p0: p, px0: E.px, py0: E.py, moved: false }; cv.classList.add("pan");
    });
    cv.addEventListener("pointermove", function (e) {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, rel(e));
      if (!act) return;
      var p = rel(e);
      if (act.kind === "pinch" && ptrs.size >= 2) {
        var pts = Array.from(ptrs.values()), d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), c = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        var nz = Math.max(0.2, Math.min(2.5, act.z0 * d / (act.d0 || 1))), f = nz / act.z0;
        E.z = nz; E.px = c.x - (act.c0.x - act.px0) * f; E.py = c.y - (act.c0.y - act.py0) * f; applyT(); return;
      }
      if (act.kind === "pan") { if (Math.hypot(p.x - act.p0.x, p.y - act.p0.y) > 3) act.moved = true; E.px = act.px0 + p.x - act.p0.x; E.py = act.py0 + p.y - act.p0.y; applyT(); return; }
      if (act.kind === "node") {
        if (!act.moved && Math.hypot(p.x - act.p0.x, p.y - act.p0.y) < 4) return;
        if (!act.moved) { push(); act.moved = true; }
        act.n.x = Math.round((act.x0 + (p.x - act.p0.x) / E.z) / 10) * 10; act.n.y = Math.round((act.y0 + (p.y - act.p0.y) / E.z) / 10) * 10;
        var nd = root().querySelector('.nd[data-id="' + cssEsc(act.n.id) + '"]'); if (nd) { nd.style.left = act.n.x + "px"; nd.style.top = act.n.y + "px"; }
        drawEdges(); return;
      }
      if (act.kind === "link") {
        var a = E.g.nodes.find(function (x) { return x.id === act.from; }), wpt = toWorld(p), s = anchor(a, wpt);
        root().querySelector("path.tmp").setAttribute("d", "M" + s.x + " " + s.y + " L" + wpt.x + " " + wpt.y);
      }
    });
    function end(e) {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      cv.classList.remove("pan");
      if (!act) return;
      var a = act; if (ptrs.size === 0) act = null; else if (a.kind === "pinch") { act = null; return; }
      if (a.kind === "pinch") return;
      if (a.kind === "node") { if (a.moved) changed(); else select(a.n.id); return; }
      if (a.kind === "edge") { selectEdge(a.i); return; }
      if (a.kind === "pan") { if (!a.moved) { E.sel = null; E.selEdge = null; drawFlow(); drawIns(); } return; }
      if (a.kind === "link") {
        root().querySelector("path.tmp").setAttribute("d", "");
        var tgt = document.elementFromPoint(e.clientX, e.clientY), nd = tgt && tgt.closest && tgt.closest(".nd");
        if (nd) connect(a.from, nd.getAttribute("data-id"));
        else { // soltar en vacío: crea un paso conectado ahí
          var w = toWorld(rel(e)); push(); var id = SF().newId(E.g, "P"); E.g.nodes.push({ id: id, type: "step", text: "Paso", how: "", tool: "", toolNote: "", link: "", x: Math.round(w.x / 10) * 10, y: Math.round(w.y / 10) * 10 });
          var from = E.g.nodes.find(function (x) { return x.id === a.from; });
          E.g.edges.push({ from: a.from, to: id, label: from && from.type === "decision" ? (E.g.edges.some(function (x) { return x.from === a.from; }) ? "no" : "sí") : "" });
          E.sel = id; drawFlow(); drawIns(); changed();
        }
      }
    }
    cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
    cv.addEventListener("wheel", function (e) {
      e.preventDefault();
      var p = rel(e);
      /* como en los editores: Ctrl/⌘ + rueda (o pellizco del trackpad) acerca; la rueda sola desplaza */
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), p.x, p.y);
      else if (e.shiftKey) { E.px -= e.deltaY; applyT(); }
      else { E.px -= e.deltaX; E.py -= e.deltaY; applyT(); }
    }, { passive: false });
    cv.addEventListener("dblclick", function (e) {
      var nd = e.target.closest(".nd");
      if (nd) { select(nd.getAttribute("data-id")); setTimeout(function () { var i = root().querySelector('.sk-ins [data-f="text"]'); if (i) { i.focus(); i.select(); } }, 30); return; }
      var w = toWorld(rel(e)); push(); var id = SF().newId(E.g, "P");
      E.g.nodes.push({ id: id, type: "step", text: "Paso", how: "", tool: "", toolNote: "", link: "", x: Math.round(w.x / 10) * 10, y: Math.round(w.y / 10) * 10 });
      E.sel = id; drawFlow(); drawIns(); changed();
    });
  }
  function cssEsc(s) { return String(s).replace(/["\\]/g, "\\$&"); }
  function connect(a, b, keepNode) {
    if (a === b) return;
    var g = E.g;
    if (g.edges.some(function (e) { return e.from === a && e.to === b; })) return toast("Ya están conectados");
    push();
    var from = g.nodes.find(function (n) { return n.id === a; });
    g.edges.push({ from: a, to: b, label: from && from.type === "decision" ? (g.edges.some(function (e) { return e.from === a; }) ? "no" : "sí") : "" });
    /* desde el panel («Conectar con…») el paso sigue elegido para nombrar el camino ahí mismo */
    if (keepNode) { E.sel = a; E.selEdge = null; } else { E.selEdge = g.edges.length - 1; E.sel = null; }
    drawFlow(); drawIns(); changed();
  }
  function select(id) { E.sel = id; E.selEdge = null; drawFlow(); drawIns(); if (MOBILE.matches) openSheet("ins"); }
  function selectEdge(i) { E.selEdge = i; E.sel = null; drawFlow(); drawIns(); if (MOBILE.matches) openSheet("ins"); }
  function delSel() {
    var g = E.g;
    if (E.sel) { push(); g.nodes = g.nodes.filter(function (n) { return n.id !== E.sel; }); g.edges = g.edges.filter(function (e) { return e.from !== E.sel && e.to !== E.sel; }); E.sel = null; }
    else if (E.selEdge != null) { push(); g.edges.splice(E.selEdge, 1); E.selEdge = null; }
    else return;
    drawFlow(); drawIns(); changed();
  }

  /* ───────── panel derecho: el paso (qué, cómo, herramienta), la flecha o la skill ───────── */
  function drawIns() {
    if (!E) return;
    var el = root().querySelector(".sk-ins"), g = E.g, h = "";
    var n = E.sel && g.nodes.find(function (x) { return x.id === E.sel; });
    if (n) {
      var outs = g.edges.map(function (e, i) { return [e, i]; }).filter(function (x) { return x[0].from === n.id; });
      h += "<h5>" + esc(TYPE_ES[n.type]) + "</h5>";
      h += '<label class="f"><span>Tipo</span><select class="i" data-f="type">' + ["step", "decision", "sub", "io", "start", "end"].map(function (t) { return '<option value="' + t + '"' + (n.type === t ? " selected" : "") + ">" + TYPE_ES[t] + "</option>"; }).join("") + "</select></label>";
      h += '<label class="f"><span>' + (n.type === "decision" ? "La pregunta (qué se decide)" : "Qué se hace") + '</span><input class="i" data-f="text" value="' + esc(n.text) + '" maxlength="140"></label>';
      if (n.type !== "start" && n.type !== "end") h += '<label class="f"><span>' + (n.type === "decision" ? "Cómo decidir (criterio)" : "Cómo se hace") + '</span><textarea class="i" data-f="how" rows="5" placeholder="' + (n.type === "decision" ? "Ej. Es «sí» si el cliente respondió en menos de 48 h y aprobó por escrito." : "Explícalo como a alguien nuevo en el equipo: qué mirar, qué evitar, cuándo está bien hecho.") + '">' + esc(n.how) + "</textarea><small>Esto es lo que la IA lee para hacerlo bien.</small></label>";
      else h += '<label class="f"><span>Nota</span><textarea class="i" data-f="how" rows="3" placeholder="' + (n.type === "start" ? "Qué dispara este proceso" : "Qué queda listo al terminar") + '">' + esc(n.how) + "</textarea></label>";
      if (n.type === "sub") {
        var opts = (L.rows || []).filter(function (r) { return r.workspace_id === E.ws && r.id !== E.id; });
        h += '<label class="f"><span>Skill que ejecuta</span><select class="i" data-f="link"><option value="">Elige una de tus skills…</option>' + opts.map(function (r) { return '<option value="' + esc(r.slug) + '"' + (n.link === r.slug ? " selected" : "") + ">" + esc(r.name) + "</option>"; }).join("") + "</select>" + (opts.length ? "" : "<small>Aún no tienes otras skills en este espacio.</small>") + "</label>";
      }
      if (n.type !== "start" && n.type !== "end") {
        h += '<h5 style="margin-top:6px">Herramienta de Musa</h5>';
        if (n.tool) {
          var t = TOOLMAP[n.tool];
          h += '<div class="tool"><button type="button" data-k="untool" aria-label="Quitar herramienta">✕</button><b>' + esc(n.tool) + "</b>" + (t ? "<p>" + esc(t.d) + (t.s ? " · " + esc(skillTitle(t.s)) : "") + "</p>" : '<p style="color:#ff8a80">No existe en Musa</p>') + "</div>";
          h += '<label class="f"><span>Detalle para la herramienta</span><textarea class="i" data-f="toolNote" rows="3" placeholder="Parámetros o indicaciones: ej. brand = la marca del pedido; formato 1080×1350">' + esc(n.toolNote) + "</textarea></label>";
        }
        h += '<label class="f"><span>' + (n.tool ? "Cambiar herramienta" : "Buscar herramienta") + '</span><input class="i" data-f="toolq" placeholder="Ej. publicar, marca, render, correo…" autocomplete="off"></label><div class="tl-res" hidden></div>';
      }
      h += '<h5 style="margin-top:6px">' + (n.type === "decision" ? "Caminos" : "Sigue con") + "</h5>";
      h += outs.map(function (x) { var to = g.nodes.find(function (m) { return m.id === x[0].to; }); return '<div class="cx"><span>→ ' + esc(to ? to.text : x[0].to) + '</span><input class="i" data-el="' + x[1] + '" value="' + esc(x[0].label) + '" placeholder="' + (n.type === "decision" ? "sí / no / …" : "etiqueta (opcional)") + '" aria-label="Etiqueta del camino"><button type="button" data-delE="' + x[1] + '" aria-label="Quitar conexión">✕</button></div>'; }).join("");
      var targets = g.nodes.filter(function (m) { return m.id !== n.id && !outs.some(function (x) { return x[0].to === m.id; }); });
      if (n.type !== "end" && targets.length) h += '<label class="f"><span>Conectar con…</span><select class="i" data-f="connect"><option value="">Elige un paso</option>' + targets.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(TYPE_ES[m.type] + ": " + m.text) + "</option>"; }).join("") + "</select></label>";
      h += '<div class="row2"><button type="button" class="tb" data-k="dup">Duplicar</button><button type="button" class="tb" data-k="del">Borrar</button></div>';
    } else if (E.selEdge != null && g.edges[E.selEdge]) {
      var ed = g.edges[E.selEdge], fa = g.nodes.find(function (m) { return m.id === ed.from; }), tb = g.nodes.find(function (m) { return m.id === ed.to; });
      h += "<h5>Conexión</h5><p style=\"margin:0 0 12px;color:#ddd\">" + esc(fa ? fa.text : ed.from) + " → " + esc(tb ? tb.text : ed.to) + "</p>";
      h += '<label class="f"><span>Etiqueta</span><input class="i" data-el="' + E.selEdge + '" value="' + esc(ed.label) + '" placeholder="' + (fa && fa.type === "decision" ? "sí / no / …" : "opcional") + '"></label>';
      h += '<div class="row2"><button type="button" class="tb" data-k="del">Borrar conexión</button></div>';
    } else {
      var m = g.meta;
      h += "<h5>La skill</h5>";
      h += '<label class="f"><span>Cuándo usarla</span><textarea class="i" data-m="when" rows="3" placeholder="Ej. Cuando un cliente pide piezas nuevas para redes">' + esc(m.when) + "</textarea><small>Con esto tu IA reconoce los pedidos en que aplica.</small></label>";
      h += '<label class="f"><span>Objetivo</span><input class="i" data-m="goal" value="' + esc(m.goal) + '" placeholder="Qué se logra al terminar"></label>';
      h += '<label class="f"><span>Qué se necesita antes de empezar</span><textarea class="i" data-m="inputs" rows="3" placeholder="Uno por línea: brief, marca, fechas…">' + esc(m.inputs) + "</textarea></label>";
      h += '<label class="f"><span>Qué entrega</span><textarea class="i" data-m="outputs" rows="3" placeholder="Uno por línea">' + esc(m.outputs) + "</textarea></label>";
      h += '<label class="f"><span>Reglas</span><textarea class="i" data-m="rules" rows="3" placeholder="Uno por línea: nunca publicar sin aprobación…">' + esc(m.rules) + "</textarea></label>";
      var agency = wsKind(E.ws) === "agency";
      h += '<label class="sw"><input type="checkbox" data-k="share"' + (E.visibility === "workspace" ? " checked" : "") + (E.owner || E.visibility === "workspace" ? "" : " disabled") + "><span>Compartir con " + (agency ? "el equipo de la agencia" : "el equipo de este espacio") + "<small>Si no, solo tú la ves. Los clientes nunca la ven.</small></span></label>";
      h += '<p style="font-size:11.5px;color:var(--e-muted);margin:4px 0 0">Espacio: ' + esc(wsName(E.ws)) + ". Toca un paso para editar su qué, su cómo y su herramienta.</p>";
    }
    el.innerHTML = h;
  }
  /* buscador de herramientas en castellano: las descripciones del MCP están mayormente en inglés,
     así que cada palabra se amplía con sus equivalentes y se compara por raíz («resolver» encuentra «resolve»). */
  var SYN = { marca: "brand", marcas: "brand", diseno: "template design frame", disenos: "template design", plantilla: "template", publicar: "publish post social",
    publicacion: "publish post", pieza: "content calendar piece", piezas: "content calendar", calendario: "calendar content schedule", programar: "schedule",
    correo: "email mail", correos: "email mail", mailing: "mail email campaign", contacto: "contact crm", contactos: "contact crm", cliente: "brand client contact",
    oportunidad: "deal crm", oportunidades: "deal crm", venta: "deal crm sales", imagen: "image photo", imagenes: "image", foto: "photo image", fotos: "photo",
    video: "video", flujo: "flow automation", flujos: "flow", automatizar: "flow automation", nota: "note brain", notas: "note brain", cerebro: "brain note",
    campana: "campaign ads", anuncio: "ad ads", anuncios: "ads", texto: "text copy", copy: "copy text", tarea: "task kanban", tareas: "task kanban",
    evento: "event", eventos: "event", formulario: "form", buscar: "search find list", listar: "list", crear: "create add new", generar: "generate ai",
    traducir: "translate", subir: "upload", exportar: "export render", render: "render png", comentario: "comment", comentarios: "comment",
    aprobar: "approve approval", red: "social", redes: "social publish", bandeja: "inbox social", responder: "reply", investigar: "research",
    paleta: "palette color", color: "color palette", fuente: "font", tipografia: "font", logo: "logo brand", reporte: "report metrics", metricas: "metrics report",
    resolver: "resolve", revisar: "validate check lint", validar: "validate check", espacio: "workspace", mover: "move", skill: "skill", conectar: "connect" };
  function norm(x) { return String(x || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function searchTools(q) {
    q = norm(q).trim(); if (!q) return [];
    var words = q.split(/[\s,]+/).filter(function (w) { return w.length > 1; });
    return (TOOLS || []).map(function (t) {
      var name = t.n.replace(/_/g, " "), hay = norm(name + " " + t.d + " " + skillTitle(t.s)), sc = 0;
      words.forEach(function (w) {
        var alts = [w].concat((SYN[w] || "").split(" ").filter(Boolean)), best = 0;
        alts.forEach(function (a) {
          var root = a.length > 5 ? a.slice(0, 5) : a;
          if (name.indexOf(a) >= 0) best = Math.max(best, 4); else if (name.indexOf(root) >= 0) best = Math.max(best, 3);
          else if (hay.indexOf(a) >= 0) best = Math.max(best, 2); else if (hay.indexOf(root) >= 0) best = Math.max(best, 1);
        });
        sc += best || -1;
      });
      return [sc, t];
    }).filter(function (x) { return x[0] > 0; }).sort(function (a, b) { return b[0] - a[0] || a[1].n.length - b[1].n.length; }).slice(0, 30).map(function (x) { return x[1]; });
  }

  /* ───────── vista Mermaid (en vivo, en los dos sentidos) ───────── */
  function drawCode(keep) {
    var mid = root().querySelector(".sk-mid"), txt = SF().toMermaid(E.g);
    var ta = mid.querySelector(".sk-code textarea");
    if (ta && keep) { if (document.activeElement !== ta) ta.value = txt; return; }
    mid.innerHTML = '<div class="sk-code"><textarea spellcheck="false" aria-label="Código Mermaid" data-code></textarea><div class="cmsg">Mermaid en vivo: lo que escribas aquí cambia el diagrama, y al revés. El «cómo» y la herramienta de cada paso van en comentarios <code>%% @how</code>, <code>%% @tool</code>, <code>%% @toolnote</code>: cualquier visor de Mermaid los ignora.</div></div>';
    mid.querySelector("textarea").value = txt;
  }
  var codeT = null;
  function onCode(ta) {
    clearTimeout(codeT);
    codeT = setTimeout(function () {
      var g = SF().parse(ta.value), m = root().querySelector(".cmsg");
      if (!g.nodes.length) { if (m) m.textContent = "No encuentro pasos todavía: empieza con «flowchart TD» y agrega nodos y flechas."; return; }
      var meta = Object.assign({}, E.g.meta); push();
      g.meta = Object.assign(meta, Object.keys(g.meta).reduce(function (o, k) { if (g.meta[k]) o[k] = g.meta[k]; return o; }, {}));
      E.g = g; E.sel = null; E.selEdge = null;
      root().querySelector(".nm").value = g.meta.name || "";
      drawIns(); E.dirty = true; status(); schedSave();
      if (m) m.textContent = "Entendido: " + g.nodes.length + " pasos y " + g.edges.length + " flechas.";
    }, 350);
  }

  /* ───────── vista Skill: lo que leerá la IA, con notas, validación y recorrido ───────── */
  function drawPrev() {
    var mid = root().querySelector(".sk-mid"), sf = SF(), is = issues();
    var descMap = {}; E.g.nodes.forEach(function (n) { if (n.tool && TOOLMAP[n.tool]) descMap[n.tool] = TOOLMAP[n.tool].d; });
    var sk = sf.toSkill(E.g, { slug: E.slug || sf.slugify(E.g.meta.name), tools: descMap });
    var h = '<div class="sk-prev"><div class="doc">';
    h += is.length ? '<div class="isl"><b>' + is.filter(function (i) { return i.level === "error"; }).length + " errores y " + is.filter(function (i) { return i.level !== "error"; }).length + ' avisos</b><ul style="margin:6px 0 0">' + is.map(function (i) { return '<li class="' + (i.level === "error" ? "e" : "w") + '"' + (i.id ? ' data-go="' + esc(i.id) + '"' : "") + ">" + esc(i.msg) + "</li>"; }).join("") + "</ul></div>"
      : '<div class="isl ok"><b>Lista para tu IA.</b> La verá en <code>list_skills</code> como «' + esc(sk.slug) + "».</div>";
    h += '<div class="btns"><button type="button" data-k="walk">Recorrer paso a paso</button><button type="button" class="g" data-k="copy">Copiar skill</button><button type="button" class="g" data-k="copymm">Copiar Mermaid</button></div>';
    if (E.walk) h += walkHtml(sk.steps);
    h += "<h1>" + esc(sk.name) + "</h1>";
    var m = E.g.meta;
    if (m.goal) h += "<p><b>Objetivo:</b> " + esc(m.goal) + "</p>";
    if (m.when) h += "<h2>Cuándo usarla</h2><p style=\"white-space:pre-line\">" + esc(m.when) + "</p>";
    if (m.inputs) h += "<h2>Qué necesitas antes de empezar</h2><ul>" + m.inputs.split(/\n/).filter(Boolean).map(function (l) { return "<li>" + esc(l.replace(/^[-•]\s*/, "")) + "</li>"; }).join("") + "</ul>";
    if (m.outputs) h += "<h2>Qué entrega</h2><ul>" + m.outputs.split(/\n/).filter(Boolean).map(function (l) { return "<li>" + esc(l.replace(/^[-•]\s*/, "")) + "</li>"; }).join("") + "</ul>";
    h += "<h2>Pasos</h2>";
    h += sk.steps.map(function (s) {
      var head = s.type === "decision" ? "¿" + s.what.replace(/^¿|\?$/g, "") + "?" : s.what;
      var meta = '<span>' + TYPE_ES[s.type] + "</span>" + (s.tool ? '<span class="t">' + esc(s.tool) + "</span>" : "") + (s.link ? '<span class="t">' + esc(s.link) + "</span>" : "");
      var nx = s.type === "decision" ? s.next.map(function (x) { return "<span>Si «" + esc(x.label || "otro caso") + "» → " + x.to + "</span>"; }).join("") : s.next.map(function (x) { return "<span>→ " + x.to + (x.back ? " (repite)" : "") + "</span>"; }).join("");
      return '<div class="stp" data-go="' + esc(s.id) + '"><span class="n">' + s.n + "</span><b>" + esc(head) + "</b>" + (s.how ? '<div class="how">' + esc(s.how) + "</div>" : "") + (s.toolNote ? '<div class="how" style="color:#ffb27f">' + esc(s.toolNote) + "</div>" : "") + '<div class="meta">' + meta + nx + "</div></div>";
    }).join("");
    if (m.rules) h += "<h2>Reglas</h2><ul>" + m.rules.split(/\n/).filter(Boolean).map(function (l) { return "<li>" + esc(l.replace(/^[-•]\s*/, "")) + "</li>"; }).join("") + "</ul>";
    h += '<h2>Así la recibe tu IA</h2><details><summary style="cursor:pointer;color:#aaa">Ver el texto completo de la skill</summary><pre>' + esc(sk.markdown) + "</pre></details>";
    h += "</div></div>";
    mid.innerHTML = h;
  }
  function walkHtml(steps) {
    var s = steps.find(function (x) { return x.n === E.walk; }) || steps[0]; if (!s) return "";
    var opts = s.type === "end" || !s.next.length ? '<button type="button" data-walk="0">Terminar</button>'
      : s.next.map(function (x) { return '<button type="button" data-walk="' + x.to + '">' + (s.type === "decision" ? esc(x.label || "Otro caso") : "Listo, siguiente") + "</button>"; }).join("");
    return '<div class="walk" aria-live="polite"><small style="color:#999">Paso ' + s.n + " de " + steps.length + '</small><div style="margin:4px 0 2px"><b>' + esc(s.what) + "</b></div>" + (s.how ? '<div style="white-space:pre-line;color:#ccc">' + esc(s.how) + "</div>" : "") + (s.tool ? '<div style="margin-top:6px;color:#ffb27f;font-family:ui-monospace,Menlo,monospace;font-size:12px">' + esc(s.tool) + (s.toolNote ? " — " + esc(s.toolNote) : "") + "</div>" : "") + '<div class="opts">' + opts + "</div></div>";
  }

  /* hojas en el celular */
  function openSheet(k) {
    var el = root(); E.panel = k;
    el.querySelector(".sk-pal").classList.toggle("open", k === "pal");
    el.querySelector(".sk-ins").classList.toggle("open", k === "ins");
    el.querySelectorAll(".m-bar [data-m]").forEach(function (b) { var m = b.getAttribute("data-m"); b.classList.toggle("on", m === k || (!k && m === E.view)); });
  }
  function closeSheets() { if (E && E.panel) openSheet(null); }

  /* ───────── eventos del editor ───────── */
  document.addEventListener("click", function (e) {
    var el = document.getElementById("skEd"); if (!el || el.hidden || !E || !el.contains(e.target)) return;
    var t = e.target, b;
    if ((b = t.closest("[data-add]"))) return addNode(b.getAttribute("data-add"));
    if ((b = t.closest("[data-v]"))) return setView(b.getAttribute("data-v"));
    if ((b = t.closest(".m-bar [data-m]"))) {
      var m = b.getAttribute("data-m");
      if (m === "pal" || m === "ins") return openSheet(E.panel === m ? null : m);
      closeSheets(); return setView(m);
    }
    if ((b = t.closest("[data-go]"))) { var id = b.getAttribute("data-go"); setView("flow"); fit(); return select(id); }
    if ((b = t.closest("[data-walk]"))) { E.walk = +b.getAttribute("data-walk") || null; return drawPrev(); }
    if ((b = t.closest("[data-delE]"))) { push(); E.g.edges.splice(+b.getAttribute("data-delE"), 1); drawFlow(); drawIns(); return changed(); }
    if ((b = t.closest(".tl-res [data-tool]"))) { push(); var n = E.g.nodes.find(function (x) { return x.id === E.sel; }); if (n) { n.tool = b.getAttribute("data-tool"); drawFlow(); drawIns(); changed(); } return; }
    if (!(b = t.closest("[data-k]"))) return;
    var k = b.getAttribute("data-k");
    if (k === "close") return closeEditor();
    if (k === "save") return save(true).then(function () { if (E && !E.dirty) toast("Skill guardada · v" + E.version); });
    if (k === "undo") return undo();
    if (k === "redo") return redo();
    if (k === "issues") { closeSheets(); return setView("prev"); }
    if (k === "zin" || k === "zout") { var r = el.querySelector(".sk-cv").getBoundingClientRect(); return zoomAt(k === "zin" ? 1.2 : 1 / 1.2, r.width / 2, r.height / 2); }
    if (k === "fit") { if (E.view !== "flow") setView("flow"); closeSheets(); return fit(); }
    if (k === "layout") { push(); SF().layout(E.g, false); if (E.view !== "flow") setView("flow"); drawFlow(); fit(); closeSheets(); return changed(); }
    if (k === "dir") { push(); E.g.dir = E.g.dir === "LR" ? "TD" : "LR"; SF().layout(E.g, false); drawPal(); if (E.view !== "flow") setView("flow"); drawFlow(); fit(); closeSheets(); return changed(); }
    if (k === "del") return delSel();
    if (k === "dup") { var src = E.g.nodes.find(function (x) { return x.id === E.sel; }); if (!src) return; push(); var nid = SF().newId(E.g, "P"); E.g.nodes.push(Object.assign({}, src, { id: nid, x: src.x + 40, y: src.y + 40 })); E.sel = nid; drawFlow(); drawIns(); return changed(); }
    if (k === "untool") { push(); var nn = E.g.nodes.find(function (x) { return x.id === E.sel; }); if (nn) { nn.tool = ""; nn.toolNote = ""; } drawFlow(); drawIns(); return changed(); }
    if (k === "walk") { E.walk = 1; return drawPrev(); }
    if (k === "copy" || k === "copymm") {
      var sk = SF().toSkill(E.g, { slug: E.slug || SF().slugify(E.g.meta.name) }), text = k === "copy" ? sk.markdown : SF().toMermaid(E.g);
      try { navigator.clipboard.writeText(text).then(function () { toast(k === "copy" ? "Skill copiada" : "Mermaid copiado"); }); } catch (x) { toast("No se pudo copiar"); }
    }
  });
  document.addEventListener("input", function (e) {
    var el = document.getElementById("skEd"); if (!el || el.hidden || !E || !el.contains(e.target)) return;
    var t = e.target, n = E.sel && E.g.nodes.find(function (x) { return x.id === E.sel; });
    if (t.matches("[data-code]")) return onCode(t);
    if (t.matches(".nm")) { E.g.meta.name = t.value; return changed(); }
    if (t.matches("[data-m]") && t.closest(".sk-ins")) { E.g.meta[t.getAttribute("data-m")] = t.value; return changed(); }
    if (t.matches("[data-el]")) { var ed = E.g.edges[+t.getAttribute("data-el")]; if (ed) { ed.label = t.value; drawEdges(); changed(); } return; }
    if (t.matches('[data-f="toolq"]')) {
      var res = el.querySelector(".tl-res"), list = searchTools(t.value);
      res.hidden = !list.length;
      res.innerHTML = list.map(function (x) { return '<button type="button" data-tool="' + esc(x.n) + '"><b>' + esc(x.n) + "</b><small>" + esc(x.d) + (x.s ? " · " + esc(skillTitle(x.s)) : "") + "</small></button>"; }).join("");
      return;
    }
    if (!n) return;
    var f = t.getAttribute("data-f");
    if (f === "text" || f === "how" || f === "toolNote") {
      if (!E._typing || E._typing !== n.id + f) { push(); E._typing = n.id + f; }
      n[f] = t.value;
      if (f === "text") { var nd = el.querySelector('.nd[data-id="' + cssEsc(n.id) + '"] span'); if (nd) nd.textContent = t.value; }
      if (f === "how") { var nd2 = el.querySelector('.nd[data-id="' + cssEsc(n.id) + '"]'); if (nd2 && !!t.value !== !!nd2.querySelector(".hw")) drawFlow(); }
      return changed();
    }
  });
  document.addEventListener("change", function (e) {
    var el = document.getElementById("skEd"); if (!el || el.hidden || !E || !el.contains(e.target)) return;
    var t = e.target, n = E.sel && E.g.nodes.find(function (x) { return x.id === E.sel; });
    if (t.matches('[data-k="share"]')) { E.visibility = t.checked ? "workspace" : "private"; toast(t.checked ? "Se compartirá con tu equipo" : "Solo tú la verás"); return changed(); }
    if (!n) return;
    var f = t.getAttribute("data-f");
    if (f === "type") { push(); n.type = t.value; drawFlow(); drawIns(); return changed(); }
    if (f === "link") { push(); n.link = t.value; if (t.value) { var r = (L.rows || []).find(function (x) { return x.slug === t.value; }); if (r && (!n.text || n.text === "Subproceso")) n.text = r.name; } drawFlow(); return changed(); }
    if (f === "connect" && t.value) return connect(n.id, t.value, true);
  });
  document.addEventListener("focusout", function (e) { if (E && e.target && e.target.getAttribute && e.target.getAttribute("data-f")) E._typing = null; });
  window.addEventListener("keydown", function (e) {
    var el = document.getElementById("skEd"); if (!el || el.hidden || !E) return;
    var typing = e.target.closest && e.target.closest("input,textarea,select,[contenteditable=true]");
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); e.stopImmediatePropagation(); save(true).then(function () { if (E && !E.dirty) toast("Skill guardada"); }); return; }
    if (typing) { e.stopImmediatePropagation(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.stopImmediatePropagation(); return e.shiftKey ? redo() : undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); e.stopImmediatePropagation(); return redo(); }
    if ((e.key === "Delete" || e.key === "Backspace") && E.view === "flow") { e.preventDefault(); e.stopImmediatePropagation(); return delSel(); }
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); if (E.panel) return closeSheets(); if (E.sel || E.selEdge != null) { E.sel = null; E.selEdge = null; drawFlow(); return drawIns(); } return closeEditor(); }
    e.stopImmediatePropagation();
  }, true);
  addEventListener("resize", function () { if (E && E.view === "flow") { clearTimeout(E._rt); E._rt = setTimeout(fit, 150); } });
  window.addEventListener("beforeunload", function () { if (E && E.dirty) save(true); });

  /* ───────── instalar ───────── */
  function install() {
    if (typeof VIEWS2 === "undefined" || !VIEWS2.skills || typeof drawView !== "function" || !window.SkillFlow) return setTimeout(install, 150);
    if (VIEWS2.skills.__sk) return;
    _musaView = VIEWS2.skills;
    var v = function () { return view.apply(this, arguments); }; v.__sk = true;
    VIEWS2.skills = v;
    var _sw = R.onWsChange;
    R.onWsChange = function () { if (_sw) _sw(); L.rows = null; if (/agentes\/skills/.test(location.hash) && L.tab === "mine") drawMine(); };
    R.skillsReload = function () { L.rows = null; return loadRows(); };
    if (/agentes\/skills/.test(location.hash)) drawView();
  }
  install();
})();
