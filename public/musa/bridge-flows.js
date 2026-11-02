/* bridge-flows.js — el editor de automatizaciones de la maqueta sobre tus flows reales (MCP primero).
 * Abrir: tabla flows · Guardar: flow_save (+ tags/vars/locked por REST) · Ejecutar: flow_run · Aprobar/rechazar:
 * flow_resume · Historial: flow_history · Rotar webhook: flow_webhook_rotate · Biblioteca: flow_library_* .
 * El lienzo, la paleta y el inspector son los de la maqueta; los nodos son los mismos 29 tipos del motor.
 */
(function () {
  var RB = window.__musaReal;
  if (!RB || typeof FL === "undefined") return;
  function bridge() { try { return window.parent.__musaBridge; } catch (e) { return null; } }
  function api(url, init) { var b = bridge(); return b ? b.api(url, init) : Promise.reject(new Error("sin puente")); }
  function mcp(name, args) { return RB.mcp(name, Object.assign({ workspaceId: RB.ws }, args || {})); }
  var isReal = function (f) { return f && f._real; };

  /* ── paleta: los tipos del motor que faltaban + cualquier tool MCP ── */
  var EXTRA = [
    ["source_nitter", "fuentes", "X (Nitter)", "Posts recientes de cuentas de X", { handles: "", limit: 10 }, [["handles", "Cuentas (separadas por coma)", "text"], ["limit", "Máximo de items", "number"]]],
    ["map", "datos", "Mapear", "Arma un objeto o una lista con {{…}}", { value: {} }, [["value", "Valor (JSON o {{…}})", "textarea"]]],
    ["sort", "datos", "Ordenar", "Ordena la lista por un campo", { path: "", dir: "asc" }, [["path", "Campo", "text"], ["dir", "Orden", "select", ["asc", "desc"]]]],
    ["aggregate", "datos", "Agrupar items", "Junta los items de todas las entradas", {}, []],
    ["compare", "datos", "Comparar listas", "Diferencia entre dos fuentes (A = primera entrada)", { keys: ["id"], mode: "added" }, [["mode", "Salida", "select", ["added", "removed", "both"]]]],
    ["wait_webhook", "utilidades", "Esperar webhook", "Pausa hasta que llegue un POST", { title: "", timeoutMinutes: 60 }, [["title", "Título", "text"], ["timeoutMinutes", "Minutos máximos", "number"]]],
    ["group", "utilidades", "Grupo", "Agrupa nodos en el lienzo (no se ejecuta)", { title: "" }, [["title", "Título", "text"]]],
    ["tool:*", "utilidades", "Herramienta MCP", "Cualquiera de las herramientas de Musa", {}, []]
  ];
  EXTRA.forEach(function (p) { if (!FL_P[p[0]]) { FL_PAL.push(p); FL_P[p[0]] = p; } });
  function ensureToolKey(name) {
    var k = "tool:" + name;
    if (!FL_P[k]) { var p = [k, "utilidades", name.replace(/_/g, " "), "Herramienta MCP de Musa", {}, []]; FL_PAL.push(p); FL_P[k] = p; }
  }
  var toolNames = null;
  function loadToolNames() {
    if (toolNames) return Promise.resolve(toolNames);
    return api("/mcp", { method: "POST", timeoutMs: 60000, headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) })
      .then(function (r) { toolNames = ((r && r.result && r.result.tools) || []).map(function (t) { return t.name; }).filter(function (n) { return !/^flow_|harness_|^platform_/.test(n); }).sort(); return toolNames; }, function () { toolNames = []; return toolNames; });
  }

  /* ── flow real ↔ formato del editor ── */
  function toFL(row) {
    var tr = row.trigger || { type: "manual" };
    var trig = TRG(tr.type || "manual", { cron: tr.cron || "0 8 * * *", tz: tr.timezone || "America/Lima", respond: tr.respond || "ack" });
    if (tr.position) { trig.x = tr.position.x; trig.y = tr.position.y; }
    var nodes = [trig], edges = [];
    (row.nodes || []).forEach(function (n) {
      var c = n.config || {}, isTool = n.type === "tool";
      if (isTool) ensureToolKey(c.tool || "tool");
      var fn = { id: n.id, type: n.type, tool: isTool ? c.tool : undefined, label: n.label || n.type, config: isTool ? Object.assign({}, c.args || {}) : JSON.parse(JSON.stringify(c)), enabled: n.enabled !== false, retry: n.retry || 0, onError: n.onError || "stop" };
      if (n.position) { fn.x = n.position.x; fn.y = n.position.y; }
      if (n.type === "switch" && !Array.isArray(fn.config.rules)) fn.config.rules = [];
      Object.defineProperty(fn, "_raw", { value: n, enumerable: false, writable: true });
      nodes.push(fn);
    });
    (row.edges || []).forEach(function (e) { edges.push(E(e.from, e.to, e.when || "")); });
    var incoming = {}; edges.forEach(function (e) { incoming[e.to] = 1; });
    var roots = nodes.filter(function (n) { return n.type !== "trigger" && n.type !== "note" && n.type !== "group" && !incoming[n.id]; }).map(function (n) { return n.id; });
    var entry = tr.entry && nodes.some(function (n) { return n.id === tr.entry; }) ? tr.entry : roots[0];
    if (entry) edges.unshift(E("trigger", entry));
    roots.forEach(function (id) { if (id !== entry) edges.push(E("trigger", id)); });
    var f = { id: row.id, name: row.name || "Flow", enabled: !!row.enabled, tags: row.tags || [], vars: row.vars || {}, inputs: row.inputs || [], locked: !!row.locked, nodes: nodes, edges: edges, runs: [] };
    Object.defineProperty(f, "_real", { value: true, enumerable: false });
    Object.defineProperty(f, "_row", { value: row, enumerable: false, writable: true });
    return f;
  }
  function fromFL(f) {
    var trigNode = f.nodes.find(function (n) { return n.type === "trigger"; }), t = trigNode.trig || {};
    var trigger = { type: t.type || "manual" };
    if (t.type === "schedule") { trigger.cron = t.cron; trigger.timezone = t.tz || "America/Lima"; }
    if (t.type === "webhook" && t.respond) trigger.respond = t.respond;
    var entryEdge = f.edges.find(function (e) { return e.from === "trigger"; });
    if (entryEdge) trigger.entry = entryEdge.to;
    if (trigNode.x != null) trigger.position = { x: Math.round(trigNode.x), y: Math.round(trigNode.y) };
    var nodes = f.nodes.filter(function (n) { return n.type !== "trigger"; }).map(function (n) {
      var base = Object.assign({}, n._raw || {}, { id: n.id, type: n.type, label: n.label, enabled: n.enabled !== false, onError: n.onError || "stop" });
      if (n.retry) base.retry = n.retry; else delete base.retry;
      if (n.x != null) base.position = { x: Math.round(n.x), y: Math.round(n.y) };
      if (n.type === "tool") base.config = Object.assign({}, (n._raw && n._raw.config) || {}, { tool: n.tool, args: n.config });
      else base.config = n.config;
      return base;
    });
    var edges = f.edges.filter(function (e) { return e.from !== "trigger"; }).map(function (e) { var o = { from: e.from, to: e.to }; if (e.when) o.when = e.when; return o; });
    return { name: f.name, enabled: !!f.enabled, trigger: trigger, nodes: nodes, edges: edges, inputs: f.inputs || [] };
  }

  /* ── abrir un flow real (también al recargar con su URL) ── */
  var loading = {};
  function loadFlow(id) {
    if (loading[id]) return loading[id];
    loading[id] = api("/rest/v1/flows?id=eq." + encodeURIComponent(id) + "&select=*").then(function (rows) {
      var row = rows && rows[0]; if (!row) throw new Error("flow no encontrado");
      var f = toFL(row), i = FL_FLOWS.findIndex(function (x) { return x.id === id; });
      if (i >= 0) FL_FLOWS[i] = f; else FL_FLOWS.push(f);
      loadHistory(f);
      return f;
    });
    loading[id].then(null, function () { delete loading[id]; });
    return loading[id];
  }
  function fmtAt(iso) { return iso ? new Date(iso).toLocaleString("es-PE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"; }
  function mapSteps(steps) { return (steps || []).map(function (s) { return { id: s.nodeId, label: s.label || s.nodeId, st: s.ok === false ? "fail" : s.output && s.output.waiting ? "wait" : "ok", ms: (s.ms != null ? s.ms + " ms" : ""), in: s.input, out: s.ok === false ? { error: s.error || s.output } : s.output }; }); }
  function loadHistory(f) {
    return mcp("flow_history", { flowId: f.id }).then(function (h) {
      f.runs = ((h && h.runs) || []).slice().reverse().map(function (r) {
        var ms = r.finishedAt && r.startedAt ? new Date(r.finishedAt) - new Date(r.startedAt) : null;
        return { id: r.runId, status: r.status === "success" ? "success" : r.status === "waiting" ? "waiting" : r.status === "running" ? "running" : "failed", at: fmtAt(r.startedAt), ms: ms == null ? "—" : (ms / 1000).toFixed(1).replace(".", ",") + " s", steps: mapSteps(r.steps), error: r.error };
      });
      if (FL.open && FL.f === f) flAll();
    }, function () {});
  }
  var _flOpen = flOpen;
  flOpen = function (ref) {
    if (typeof ref === "string" && /^flow_/.test(ref) && !FL_FLOWS.some(function (x) { return x.id === ref && x._real; })) {
      loadFlow(ref).then(function () { if (FL.ref !== ref || !FL.open) _flOpen(ref); }, function (e) { if (typeof uiToast === "function") uiToast("No se pudo abrir el flow: " + (e && e.message)); });
      return;
    }
    var r = _flOpen.apply(this, arguments);
    if (FL.f && FL.f.isNew && !FL.f._real) { Object.defineProperty(FL.f, "_real", { value: true, enumerable: false }); }
    return r;
  };

  /* tarjetas del tablero → editor real */
  var _viewKanban = viewKanban;
  viewKanban = function (key) {
    var r = _viewKanban.apply(this, arguments);
    if (key === "crear/automatizaciones" && RB.flowCols) {
      document.querySelectorAll("#body .col").forEach(function (col, ci) {
        col.querySelectorAll(".kc").forEach(function (c, i) {
          var id = (RB.flowCols[ci] || [])[i]; if (!id) return;
          c.title = "Abrir en el editor de flows"; c.style.cursor = "pointer";
          c.onclick = function () { location.hash = "crear/automatizaciones/" + id; };
        });
      });
    }
    return r;
  };

  /* ── guardar con flow_save (valida igual que el motor) ── */
  function save(f, quiet) {
    var body = fromFL(f), args = Object.assign({ name: body.name, enabled: body.enabled, trigger: body.trigger, nodes: body.nodes, edges: body.edges, inputs: body.inputs }, /^flow_/.test(f.id) ? { id: f.id } : {});
    return mcp("flow_save", args).then(function (r) {
      var newId = r && (r.flowId || r.id);
      if (newId && newId !== f.id) {
        var old = f.id; f.id = newId; FL.ref = newId; delete f.isNew;
        if (!FL_FLOWS.includes(f)) FL_FLOWS.push(f);
        if (location.hash !== "#crear/automatizaciones/" + newId) history.replaceState(null, "", "#crear/automatizaciones/" + newId);
        RB.flowCols = RB.flowCols || [[], [], []]; RB.flowCols[0].unshift(newId);
        KANBANS["crear/automatizaciones"][0][1].unshift([eesc(f.name), (f.nodes.length - 1) + " pasos", (FL_TRIG[f.nodes[0].trig.type] || ["Manual"])[0].replace("Disparo ", "")]);
        void old;
      }
      return api("/rest/v1/flows?id=eq." + encodeURIComponent(f.id), { method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ tags: f.tags || [], vars: f.vars || {}, locked: !!f.locked }) }).then(function () { return r; }, function () { return r; });
    }).then(function (r) {
      FL.dirty = false; flBar();
      if (!quiet) flToast(f.enabled ? "Guardado y activo · flow_save validó todos los nodos" : "Guardado como borrador" + (r && r._note ? " · " + String(r._note).split(".")[0] : ""));
      return r;
    }, function (e) { flToast("No se guardó: " + (e && e.message || "error")); throw e; });
  }

  /* ── ejecutar con flow_run; aprobación con flow_resume ── */
  function applySteps(run, steps) {
    mapSteps(steps).forEach(function (s) { run.steps.push(s); run.state[s.id] = { st: s.st, ms: s.ms, out: s.out, in: s.in }; });
  }
  function finish(run, r) {
    var f = FL.f;
    if (r.status === "waiting" && r.wait) {
      run.status = "waiting";
      run.state[r.wait.nodeId] = Object.assign(run.state[r.wait.nodeId] || {}, { st: "wait" });
      run.resume = function (ok) {
        run.status = "running"; flAll();
        mcp("flow_resume", { resumeToken: r.wait.resumeToken, approved: ok }).then(function (r2) {
          run.steps = run.steps.filter(function (s) { return s.id !== r.wait.nodeId; });
          applySteps(run, r2.steps || []);
          finish(run, r2);
        }, function (e) { run.status = "failed"; flAll(); flToast("No se pudo reanudar: " + (e && e.message)); });
      };
      flAll(); return flToast(r.wait.kind === "approval" ? "En pausa: espera tu aprobación" : "En pausa: esperando el webhook");
    }
    run.status = r.status === "success" ? "success" : "failed";
    run.ms = ((Date.now() - run.t0) / 1000).toFixed(1).replace(".", ",") + " s";
    run.at = new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });
    f.nodes.forEach(function (n) { if (n.type !== "note" && n.type !== "trigger" && !run.state[n.id]) run.state[n.id] = { st: "skip" }; });
    f.runs.push(run); flAll();
    flToast(run.status === "success" ? "Run terminado en " + run.ms : "El run falló" + (r.error ? ": " + (r.error.message || r.error) : ""));
  }
  var _flRun = flRun;
  flRun = function (inputs, fromId) {
    var f = FL.f; if (!isReal(f)) return _flRun.apply(this, arguments);
    var run = { id: "r" + Date.now(), status: "running", at: "ahora", input: inputs, state: { trigger: { st: "ok", ms: "0 ms", out: { input: inputs } } }, steps: [], t0: Date.now() };
    FL.run = run; FL.drawer = true; FL.openStep = null;
    f.nodes.forEach(function (n) { if (n.type !== "trigger" && n.type !== "note" && n.enabled !== false) run.state[n.id] = { st: "run" }; });
    flAll();
    var pre = FL.dirty || !/^flow_/.test(f.id) ? save(f, true) : Promise.resolve();
    pre.then(function () {
      return mcp("flow_run", { flowId: f.id, input: inputs || {}, mode: fromId ? "dev" : undefined });
    }).then(function (r) {
      Object.keys(run.state).forEach(function (k) { if (k !== "trigger") delete run.state[k]; });
      applySteps(run, r.steps || []);
      finish(run, r);
    }, function (e) {
      Object.keys(run.state).forEach(function (k) { if (run.state[k].st === "run") run.state[k] = { st: "skip" }; });
      run.status = "failed"; run.ms = "—"; f.runs.push(run); flAll();
      flToast("No se pudo ejecutar: " + (e && e.message || "error"));
    });
  };

  /* ── acciones de la barra ── */
  var _flAct = flAct;
  flAct = function (a, el) {
    var f = FL.f;
    if (!isReal(f)) return _flAct.apply(this, arguments);
    if (a === "save") return save(f);
    if (a === "rotate") {
      if (!/^flow_/.test(f.id)) return flToast("Guarda el flow primero");
      if (!confirm("¿Rotar el webhook? La URL actual deja de funcionar.")) return;
      return mcp("flow_webhook_rotate", { flowId: f.id }).then(function (r) {
        var url = r && (r.webhookUrl || r.url);
        if (url) { (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { flToast("Webhook rotado · URL nueva copiada"); }, function () { prompt("URL nueva del webhook:", url); }); }
        else flToast("Webhook rotado");
      }, function (e) { flToast("No se pudo rotar: " + (e && e.message)); });
    }
    if (a === "lock") { var r0 = _flAct.apply(this, arguments); FL.dirty = true; flBar(); return r0; }
    var r = _flAct.apply(this, arguments);
    if (["toggle", "dup", "del", "layout"].indexOf(a) >= 0) { FL.dirty = true; flBar(); }
    return r;
  };
  /* activar/desactivar y nombre marcan cambios por guardar */
  fq("#flState").addEventListener("click", function () { if (isReal(FL.f)) { FL.dirty = true; flBar(); } }, true);
  fq("#flName").addEventListener("input", function () { if (isReal(FL.f)) FL.dirty = true; });
  flRoot.addEventListener("pointerup", function () { if (isReal(FL.f) && FL.hist.length) FL.dirty = true; });

  /* exportar: la definición portable real (flow_export, sin credenciales) */
  var _flDownload = flDownload;
  flDownload = function () {
    var f = FL.f; if (!isReal(f) || !/^flow_/.test(f.id)) return _flDownload.apply(this, arguments);
    mcp("flow_export", { flowId: f.id }).then(function (r) {
      var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: "application/json" }));
      a.download = (f.name || "flow").replace(/[\\/:*?"<>|]+/g, "-") + ".json"; document.body.appendChild(a); a.click(); a.remove(); flToast("Exportado (sin credenciales)");
    }, function (e) { flToast("No se pudo exportar: " + (e && e.message)); });
  };

  /* ── inspector: todo lo que la IA puso es editable (JSON completo), tool MCP y credencial ── */
  var creds = null;
  function loadCreds() { if (creds) return Promise.resolve(creds); return mcp("flow_credentials_list", {}).then(function (r) { creds = (r && (r.credentials || r.items || r)) || []; if (!Array.isArray(creds)) creds = []; return creds; }, function () { creds = []; return creds; }); }
  var _flInsp = flInsp;
  flInsp = function () {
    var r = _flInsp.apply(this, arguments);
    var f = FL.f, n = f && f.nodes.find(function (x) { return x.id === FL.sel; });
    if (!isReal(f) || !n || n.type === "trigger") return r;
    var box = fq("#flInsp") || flRoot.querySelector(".fl-insp"); if (!box) return r;
    var html = '<div class="fl-adv" style="padding:12px 14px;border-top:1px solid rgba(255,255,255,.08)">';
    if (n.type === "tool") html += '<label class="ef full"><span>Herramienta MCP</span><select data-fladv="tool"><option>' + eesc(n.tool || "") + "</option></select></label>";
    if (/^(ai|agent|http|source_http)$/.test(n.type)) html += '<label class="ef full"><span>Credencial</span><select data-fladv="cred"><option value="">— la del espacio / ninguna —</option></select></label>';
    html += '<label class="ef full ta"><span>' + (n.type === "tool" ? "Argumentos (JSON)" : "Configuración completa (JSON)") + '</span><textarea data-fladv="json" rows="8" style="font-family:ui-monospace,Consolas,monospace;font-size:11px">' + eesc(JSON.stringify(n.config, null, 2)) + "</textarea></label>";
    html += '<div class="ed-note">Todo lo que una IA configuró por MCP se ve y se edita aquí.</div></div>';
    box.insertAdjacentHTML("beforeend", html);
    if (n.type === "tool") loadToolNames().then(function (names) { var s = box.querySelector('[data-fladv="tool"]'); if (s) s.innerHTML = names.map(function (t) { return "<option" + (t === n.tool ? " selected" : "") + ">" + eesc(t) + "</option>"; }).join("") || "<option>" + eesc(n.tool) + "</option>"; });
    if (box.querySelector('[data-fladv="cred"]')) loadCreds().then(function (cs) { var s = box.querySelector('[data-fladv="cred"]'); if (s) s.insertAdjacentHTML("beforeend", cs.map(function (c) { return '<option value="' + eesc(c.id) + '"' + (c.id === n.config.credentialId ? " selected" : "") + ">" + eesc((c.name || c.provider || c.id) + (c.last4 ? " · ••" + c.last4 : "")) + "</option>"; }).join("")); });
    return r;
  };
  flRoot.addEventListener("change", function (e) {
    var k = e.target && e.target.dataset && e.target.dataset.fladv; if (!k) return;
    var f = FL.f, n = f && f.nodes.find(function (x) { return x.id === FL.sel; }); if (!n) return;
    flSnap();
    if (k === "tool") { n.tool = e.target.value; ensureToolKey(n.tool); if (!n.label || /^Herramienta MCP|^tool/.test(n.label)) n.label = n.tool.replace(/_/g, " "); }
    if (k === "cred") { if (e.target.value) n.config.credentialId = e.target.value; else delete n.config.credentialId; }
    if (k === "json") { try { n.config = JSON.parse(e.target.value || "{}"); } catch (err) { return flToast("JSON inválido: " + err.message); } }
    FL.dirty = true; flDraw(); flInsp(); flBar();
  }, true);
  /* nodo genérico «Herramienta MCP»: al soltarlo se elige la herramienta */
  var _flAddNode = flAddNode;
  flAddNode = function (key) {
    var r = _flAddNode.apply(this, arguments);
    if (key === "tool:*" && FL.f) { var n = FL.f.nodes.find(function (x) { return x.id === FL.sel; }) || FL.f.nodes[FL.f.nodes.length - 1]; if (n) { n.tool = "list_templates"; ensureToolKey(n.tool); n.label = "Herramienta MCP"; flDraw(); flInsp(); } }
    if (isReal(FL.f)) { FL.dirty = true; flBar(); }
    return r;
  };

  /* ── biblioteca: presets reales (flow_library_list / instantiate) ── */
  var lib = null;
  RB.loadFlowLibrary = function () {
    if (lib) return Promise.resolve(lib);
    return mcp("flow_library_list", {}).then(function (r) {
      lib = (r && (r.presets || r.items || r)) || []; if (!Array.isArray(lib)) lib = [];
      TILES["automatizar/biblioteca"] = lib.map(function (p) { return [eesc(p.name || p.id), eesc(p.description || p.category || "Preset"), "Plantilla"]; });
      return lib;
    }, function () { lib = []; return lib; });
  };
  var _flOpen2 = flOpen;
  flOpen = function (ref) {
    if (typeof ref === "string" && /^b\d+$/.test(ref) && RB.on) {
      var i = +ref.slice(1);
      RB.loadFlowLibrary().then(function (L) {
        var p = L[i]; if (!p) return _flOpen2(ref);
        uiToast("Creando tu flow desde «" + (p.name || p.id) + "»…");
        return mcp("flow_library_instantiate", { presetId: p.id || p.presetId }).then(function (r) {
          var id = r && (r.flowId || (r.flow && r.flow.id) || r.id); if (!id) throw new Error("sin id");
          location.hash = "crear/automatizaciones/" + id;
        });
      }).catch(function (e) { uiToast("No se pudo crear desde la plantilla: " + (e && e.message)); });
      return;
    }
    if (ref === "nuevo" && RB.on) { var r = _flOpen2.apply(this, arguments); if (FL.f) { Object.defineProperty(FL.f, "_real", { value: true, enumerable: false, configurable: true }); } return r; }
    return _flOpen2.apply(this, arguments);
  };
  if (RB.on) RB.loadFlowLibrary(); else setTimeout(function () { if (RB.on) RB.loadFlowLibrary(); }, 8000);

  /* ── MCP primero: si una IA cambia el flow mientras está abierto (sin cambios tuyos), se recarga ── */
  setInterval(function () {
    var f = FL.open && FL.f; if (!isReal(f) || !/^flow_/.test(f.id) || FL.dirty || (FL.run && /running|waiting/.test(FL.run.status))) return;
    api("/rest/v1/flows?id=eq." + encodeURIComponent(f.id) + "&select=updated_at").then(function (r) {
      var at = r && r[0] && r[0].updated_at, known = f._row && f._row.updated_at;
      if (!at || !known || at === known || FL.f !== f) return;
      delete loading[f.id];
      loadFlow(f.id).then(function (nf) { var keep = { z: FL.z, px: FL.px, py: FL.py, sel: FL.sel }; FL.f = nf; FL.ref = nf.id; Object.assign(FL, keep); flAll(); flToast("Actualizado: hubo cambios desde MCP"); });
    }, function () {});
  }, 5000);
  /* tras guardar, la fecha conocida es la nuestra */
  var _save = save;
  save = function (f, quiet) { return _save(f, quiet).then(function (r) { return api("/rest/v1/flows?id=eq." + encodeURIComponent(f.id) + "&select=updated_at").then(function (x) { if (x && x[0]) { if (!f._row) Object.defineProperty(f, "_row", { value: {}, writable: true, enumerable: false }); f._row.updated_at = x[0].updated_at; } return r; }, function () { return r; }); }); };
})();
/* al recargar con la URL de un flow abierto, se abre en cuanto hay datos */
(function () {
  var n = 0, iv = setInterval(function () {
    var RB = window.__musaReal;
    if ((RB && RB.on) || ++n > 80) { clearInterval(iv); if (/^#crear\/automatizaciones\/flow_/.test(location.hash) && typeof flSync === "function" && !FL.open) flSync(); }
  }, 250);
})();
