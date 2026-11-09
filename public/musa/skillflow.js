/* skillflow.js — flujograma ⇄ Mermaid ⇄ skill, sin IA (determinista: el mismo diagrama da siempre la misma skill).
 * Lo usan el editor visual (navegador, window.SkillFlow) y el servidor/MCP (require/import), con el MISMO código.
 *
 * Modelo: { dir, meta:{name,when,goal,inputs,outputs,rules}, nodes:[{id,type,text,how,tool,toolNote,link,x,y}], edges:[{from,to,label}] }
 *   type: start | end | step | decision | sub (otra skill) | io (dato que entra o sale)
 * Mermaid: formas estándar (([inicio/fin]), [paso], {decisión}, [[subproceso]], [/dato/]) y lo que Mermaid no
 * tiene (el «cómo» de cada paso, la herramienta de Musa, posiciones, datos de la skill) va en comentarios
 * «%% @…», que Mermaid ignora: cualquier diagrama sigue siendo Mermaid válido y vuelve al editor sin perder nada.
 */
(function (root) {
  "use strict";
  var TYPES = ["start", "end", "step", "decision", "sub", "io"];
  var TYPE_ES = { start: "Inicio", end: "Fin", step: "Paso", decision: "Decisión", sub: "Subproceso", io: "Dato" };
  var META_KEYS = ["name", "when", "goal", "inputs", "outputs", "rules"];

  function esc1(s) { return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n"); }
  function unesc1(s) { return String(s == null ? "" : s).replace(/\\n/g, "\n").replace(/\\\\/g, "\\"); }
  function labelOut(s) { return String(s == null ? "" : s).replace(/\r?\n/g, " ").replace(/"/g, "#quot;").trim(); }
  function labelIn(s) { return String(s == null ? "" : s).replace(/#quot;/g, '"').replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ").trim(); }
  function slugify(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "skill";
  }
  function blank() { return { dir: "TD", meta: { name: "", when: "", goal: "", inputs: "", outputs: "", rules: "" }, nodes: [], edges: [] }; }

  /* ───────── Mermaid → modelo ───────── */
  var SHAPES = [
    ["([", "])", "term"], ["[[", "]]", "sub"], ["((", "))", "term"], ["[/", "/]", "io"], ["[\\", "\\]", "io"], ["[/", "\\]", "io"], ["[\\", "/]", "io"],
    ["{{", "}}", "step"], ["{", "}", "decision"], ["[(", ")]", "step"], ["[", "]", "step"], ["(", ")", "step"], [">", "]", "step"],
  ];
  var EDGE_RX = /^\s*(?:(<?-->|<?---|<?-\.->|-\.-|<?==>|===|--o|--x|o--o|x--x)\s*(?:\|([^|]*)\|)?|--\s+((?:(?!-->)[^\n])+?)\s+-->|==\s+((?:(?!==>)[^\n])+?)\s+==>|-\.\s+((?:(?!\.->)[^\n])+?)\s+\.->)\s*/;
  function readShape(s, i) {
    for (var k = 0; k < SHAPES.length; k++) {
      var o = SHAPES[k][0], c = SHAPES[k][1];
      if (s.substr(i, o.length) !== o) continue;
      var j = i + o.length, text;
      if (s[j] === '"') {
        var q = s.indexOf('"', j + 1); if (q < 0) continue;
        if (s.substr(q + 1, c.length) !== c) continue;
        text = s.slice(j + 1, q); return { text: text, kind: SHAPES[k][2], end: q + 1 + c.length };
      }
      var e = s.indexOf(c, j); if (e < 0) continue;
      text = s.slice(j, e); return { text: text, kind: SHAPES[k][2], end: e + c.length };
    }
    return null;
  }
  function parse(src) {
    var g = blank(), byId = {}, ann = { how: {}, tool: {}, toolNote: {}, link: {}, pos: {}, type: {} }, order = 0;
    var text = String(src || "").replace(/\r\n?/g, "\n");
    function node(id) {
      if (!byId[id]) { byId[id] = { id: id, type: "step", text: id, how: "", tool: "", toolNote: "", link: "", x: null, y: null, _ord: order++, _shape: null }; g.nodes.push(byId[id]); }
      return byId[id];
    }
    text.split("\n").forEach(function (rawLine) {
      var line = rawLine.trim();
      if (!line) return;
      var m;
      if ((m = line.match(/^%%\s*@(\w+)\s+(.*)$/))) {
        var key = m[1], rest = m[2];
        if (key === "meta") { var mm = rest.match(/^(\w+)\s*:\s?(.*)$/); if (mm && META_KEYS.indexOf(mm[1]) >= 0) g.meta[mm[1]] = unesc1(mm[2]); return; }
        var am = rest.match(/^([A-Za-z0-9_\-]+)\s*:\s?(.*)$/); if (!am) return;
        if (key === "pos") { var p = am[2].split(/[,\s]+/).map(Number); if (p.length >= 2 && isFinite(p[0]) && isFinite(p[1])) ann.pos[am[1]] = p; return; }
        if (key === "toolnote") ann.toolNote[am[1]] = unesc1(am[2]);
        else if (ann[key]) ann[key][am[1]] = unesc1(am[2]);
        return;
      }
      if (/^%%/.test(line)) return;
      if ((m = line.match(/^(flowchart|graph)\s*(TD|TB|BT|LR|RL)?\s*;?\s*$/i))) { g.dir = (m[2] || "TD").toUpperCase().replace("TB", "TD"); return; }
      if (/^(classDef|class|style|linkStyle|click|direction|accTitle|accDescr|subgraph)\b/.test(line) || line === "end") return;
      line.split(/;\s*(?=[A-Za-z0-9_])/).forEach(function (stmt) { statement(stmt.trim()); });
    });
    function statement(s) {
      if (!s) return;
      var i = 0, prev = null, pendingLabel = null, guard = 0;
      while (i < s.length && guard++ < 500) {
        var refs = [];
        // uno o varios nodos unidos con &
        for (;;) {
          var idm = s.slice(i).match(/^\s*([A-Za-z0-9_\-]+)/); if (!idm) return;
          var id = idm[1]; i += idm[0].length;
          var n = node(id), sh = readShape(s, i);
          if (sh) { n.text = labelIn(sh.text) || id; n._shape = sh.kind; i = sh.end; }
          refs.push(n);
          var amp = s.slice(i).match(/^\s*&\s*/); if (!amp) break; i += amp[0].length;
        }
        if (prev) prev.forEach(function (a) { refs.forEach(function (b) { g.edges.push({ from: a.id, to: b.id, label: pendingLabel ? labelIn(pendingLabel) : "" }); }); });
        var em = s.slice(i).match(EDGE_RX);
        if (!em) return;
        pendingLabel = em[2] || em[3] || em[4] || em[5] || null;
        i += em[0].length; prev = refs;
      }
    }
    // tipos: forma + grado (un terminal sin entradas es inicio; sin salidas, fin) o lo anotado
    var ins = {}, outs = {};
    g.edges.forEach(function (e) { outs[e.from] = (outs[e.from] || 0) + 1; ins[e.to] = (ins[e.to] || 0) + 1; });
    g.nodes.forEach(function (n) {
      var t = n._shape === "term" ? (!ins[n.id] && outs[n.id] ? "start" : !outs[n.id] && ins[n.id] ? "end" : !ins[n.id] ? "start" : "end")
        : n._shape === "decision" ? "decision" : n._shape === "sub" ? "sub" : n._shape === "io" ? "io" : "step";
      if (ann.type[n.id] && TYPES.indexOf(ann.type[n.id]) >= 0) t = ann.type[n.id];
      n.type = t;
      n.how = ann.how[n.id] || ""; n.tool = (ann.tool[n.id] || "").trim(); n.toolNote = ann.toolNote[n.id] || ""; n.link = (ann.link[n.id] || "").trim();
      if (ann.pos[n.id]) { n.x = ann.pos[n.id][0]; n.y = ann.pos[n.id][1]; }
      delete n._shape; delete n._ord;
    });
    if (g.nodes.some(function (n) { return n.x == null; })) layout(g, true);
    return g;
  }

  /* ───────── modelo → Mermaid ───────── */
  function shapeOf(n) {
    var t = '"' + labelOut(n.text || n.id) + '"';
    return n.type === "start" || n.type === "end" ? "([" + t + "])" : n.type === "decision" ? "{" + t + "}" : n.type === "sub" ? "[[" + t + "]]" : n.type === "io" ? "[/" + t + "/]" : "[" + t + "]";
  }
  function toMermaid(g) {
    var out = ["flowchart " + (g.dir || "TD")];
    META_KEYS.forEach(function (k) { if (g.meta && g.meta[k]) out.push("%% @meta " + k + ": " + esc1(g.meta[k])); });
    g.nodes.forEach(function (n) { out.push("  " + n.id + shapeOf(n)); });
    g.edges.forEach(function (e) { out.push("  " + e.from + " -->" + (e.label ? "|" + labelOut(e.label).replace(/\|/g, "/") + "|" : "") + " " + e.to); });
    g.nodes.forEach(function (n) {
      if (n.how) out.push("%% @how " + n.id + ": " + esc1(n.how));
      if (n.tool) out.push("%% @tool " + n.id + ": " + n.tool);
      if (n.toolNote) out.push("%% @toolnote " + n.id + ": " + esc1(n.toolNote));
      if (n.link) out.push("%% @link " + n.id + ": " + n.link);
      var isTerm = n.type === "start" || n.type === "end";
      if (isTerm) out.push("%% @type " + n.id + ": " + n.type);
      if (n.x != null && n.y != null) out.push("%% @pos " + n.id + ": " + Math.round(n.x) + "," + Math.round(n.y));
    });
    return out.join("\n") + "\n";
  }

  /* ───────── orden de lectura y diseño automático ───────── */
  function maps(g) {
    var byId = {}, out = {}, inn = {};
    g.nodes.forEach(function (n) { byId[n.id] = n; out[n.id] = []; inn[n.id] = []; });
    g.edges.forEach(function (e) { if (byId[e.from] && byId[e.to]) { out[e.from].push(e); inn[e.to].push(e); } });
    return { byId: byId, out: out, inn: inn };
  }
  function starts(g, M) {
    var s = g.nodes.filter(function (n) { return n.type === "start"; });
    if (!s.length) s = g.nodes.filter(function (n) { return !M.inn[n.id].length; });
    if (!s.length && g.nodes.length) s = [g.nodes[0]];
    return s;
  }
  /* orden de los pasos: se recorre desde el inicio siguiendo las flechas (una rama completa antes que la otra) */
  function order(g) {
    var M = maps(g), seen = {}, list = [];
    function visit(id) {
      if (seen[id]) return; seen[id] = 1; list.push(M.byId[id]);
      M.out[id].forEach(function (e) { visit(e.to); });
    }
    starts(g, M).forEach(function (n) { visit(n.id); });
    g.nodes.forEach(function (n) { if (!seen[n.id]) visit(n.id); });
    // los fines al final
    return list.filter(function (n) { return n.type !== "end"; }).concat(list.filter(function (n) { return n.type === "end"; }));
  }
  function layout(g, onlyMissing) {
    var M = maps(g), rank = {}, back = {}, state = {}, ordIx = {};
    order(g).forEach(function (n, i) { ordIx[n.id] = i; });
    function dfs(id) { state[id] = 1; M.out[id].forEach(function (e) { if (state[e.to] === 1) back[e.from + ">" + e.to] = 1; else if (!state[e.to]) dfs(e.to); }); state[id] = 2; }
    starts(g, M).forEach(function (n) { if (!state[n.id]) dfs(n.id); });
    g.nodes.forEach(function (n) { if (!state[n.id]) dfs(n.id); });
    g.nodes.forEach(function (n) { rank[n.id] = 0; });
    for (var it = 0; it < g.nodes.length + 1; it++) {
      var changed = false;
      g.edges.forEach(function (e) { if (back[e.from + ">" + e.to] || rank[e.from] == null || rank[e.to] == null) return; if (rank[e.to] < rank[e.from] + 1) { rank[e.to] = rank[e.from] + 1; changed = true; } });
      if (!changed) break;
    }
    var rows = {};
    g.nodes.forEach(function (n) { (rows[rank[n.id]] = rows[rank[n.id]] || []).push(n); });
    var horiz = g.dir === "LR" || g.dir === "RL";
    Object.keys(rows).forEach(function (r) {
      var row = rows[r].sort(function (a, b) { return ordIx[a.id] - ordIx[b.id]; });
      row.forEach(function (n, i) {
        if (onlyMissing && n.x != null && n.y != null) return;
        var a = +r * (horiz ? 260 : 150), b = (i - (row.length - 1) / 2) * (horiz ? 130 : 240);
        n.x = horiz ? a : b; n.y = horiz ? b : a;
      });
    });
    return g;
  }

  /* ───────── validación (mientras escribes) ───────── */
  function validate(g, opts) {
    opts = opts || {};
    var issues = [], M = maps(g), tools = opts.tools || null, skills = opts.skills || null;
    function add(level, msg, id) { issues.push({ level: level, msg: msg, id: id || null }); }
    if (!String(g.meta && g.meta.name || "").trim()) add("error", "Ponle nombre a la skill.");
    if (!String(g.meta && g.meta.when || "").trim()) add("warn", "Explica cuándo usarla: así la IA sabe en qué pedidos aplicarla.");
    if (!g.nodes.length) { add("error", "Agrega al menos un paso."); return issues; }
    var st = g.nodes.filter(function (n) { return n.type === "start"; });
    if (!st.length) add("warn", "Falta el inicio del proceso.");
    if (st.length > 1) add("warn", "Hay " + st.length + " inicios; normalmente un proceso empieza en uno solo.");
    if (!g.nodes.some(function (n) { return n.type === "end"; })) add("warn", "Falta el fin del proceso.");
    var ids = {}; g.nodes.forEach(function (n) { if (ids[n.id]) add("error", "Hay dos pasos con el mismo id «" + n.id + "».", n.id); ids[n.id] = 1; });
    g.edges.forEach(function (e) { if (!M.byId[e.from] || !M.byId[e.to]) add("error", "Una flecha apunta a un paso que no existe (" + e.from + " → " + e.to + ").", e.from); });
    var reach = {}, stack = starts(g, M).map(function (n) { return n.id; });
    while (stack.length) { var id = stack.pop(); if (reach[id]) continue; reach[id] = 1; M.out[id].forEach(function (e) { stack.push(e.to); }); }
    g.nodes.forEach(function (n) {
      var name = "«" + (n.text || n.id) + "»";
      if (!reach[n.id]) add("error", name + " no se alcanza desde el inicio: conéctalo.", n.id);
      if (n.type === "decision") {
        if (M.out[n.id].length < 2) add("error", "La decisión " + name + " necesita al menos dos salidas (por ejemplo «sí» y «no»).", n.id);
        else if (M.out[n.id].some(function (e) { return !String(e.label || "").trim(); })) add("warn", "Ponle nombre a cada salida de la decisión " + name + " (por ejemplo «sí» / «no»).", n.id);
      }
      if (n.type !== "end" && !M.out[n.id].length && g.nodes.length > 1) add("warn", name + " no lleva a ningún lado: conéctalo al siguiente paso o a un fin.", n.id);
      if (n.type === "end" && M.out[n.id].length) add("warn", "El fin " + name + " tiene salidas.", n.id);
      if ((n.type === "step" || n.type === "decision") && !String(n.how || "").trim()) add("warn", "Explica cómo se hace " + name + ".", n.id);
      if (n.tool && tools && !tools[n.tool]) add("error", "La herramienta «" + n.tool + "» de " + name + " no existe en Musa.", n.id);
      if (n.type === "sub" && n.link && skills && !skills[n.link]) add("warn", "El subproceso " + name + " enlaza «" + n.link + "», que no está en tus skills.", n.id);
      if (n.type === "sub" && !n.link) add("warn", "Elige qué skill ejecuta el subproceso " + name + ".", n.id);
    });
    return issues;
  }

  /* ───────── modelo → skill (markdown con el qué y el cómo) ───────── */
  function steps(g) {
    var M = maps(g), list = order(g), num = {};
    list.forEach(function (n, i) { num[n.id] = i + 1; });
    return list.map(function (n) {
      return { n: num[n.id], id: n.id, type: n.type, what: n.text || n.id, how: n.how || "", tool: n.tool || "", toolNote: n.toolNote || "", link: n.link || "",
        next: M.out[n.id].map(function (e) { return { to: num[e.to], id: e.to, label: e.label || "", back: num[e.to] <= num[n.id] }; }) };
    });
  }
  function para(s) { return String(s || "").trim().split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean); }
  function toSkill(g, opts) {
    opts = opts || {};
    var meta = g.meta || {}, name = String(meta.name || "Skill sin nombre").trim(), slug = opts.slug || slugify(name);
    var S = steps(g), toolInfo = opts.tools || {}, used = [];
    var desc = (String(meta.when || meta.goal || name).replace(/\s+/g, " ").trim()).slice(0, 300);
    var L = ["---", "name: " + slug, "description: " + desc.replace(/\n/g, " "), "source: workspace" + (opts.version ? "\nversion: " + opts.version : ""), "---", "", "# " + name, ""];
    if (meta.goal) L.push("**Objetivo:** " + meta.goal.trim(), "");
    if (meta.when) { L.push("## Cuándo usarla", ""); para(meta.when).forEach(function (l) { L.push(l); }); L.push(""); }
    if (meta.inputs) { L.push("## Qué necesitas antes de empezar", ""); para(meta.inputs).forEach(function (l) { L.push("- " + l.replace(/^[-•]\s*/, "")); }); L.push(""); }
    if (meta.outputs) { L.push("## Qué entrega", ""); para(meta.outputs).forEach(function (l) { L.push("- " + l.replace(/^[-•]\s*/, "")); }); L.push(""); }
    L.push("## Pasos", "", "Sigue los pasos en orden. En cada decisión, toma el camino que corresponda.", "");
    S.forEach(function (s) {
      var head = s.type === "start" ? "Inicio: " + s.what : s.type === "end" ? "Fin: " + s.what : s.type === "decision" ? "Decide: " + s.what : s.type === "sub" ? "Subproceso: " + s.what : s.type === "io" ? "Dato: " + s.what : s.what;
      L.push(s.n + ". **" + head + "**");
      para(s.how).forEach(function (l) { L.push("   " + l); });
      if (s.tool) {
        if (used.indexOf(s.tool) < 0) used.push(s.tool);
        L.push("   - Herramienta de Musa: `" + s.tool + "`" + (s.toolNote ? " — " + s.toolNote.replace(/\s*\n\s*/g, " ") : ""));
      }
      if (s.type === "sub" && s.link) L.push("   - Ejecuta la skill `" + s.link + "` (get_skill) y vuelve aquí al terminar.");
      if (s.type === "decision") s.next.forEach(function (x) { L.push("   - Si «" + (x.label || "otro caso") + "» → paso " + x.to + (x.back ? " (vuelve atrás)" : "")); });
      else if (s.next.length === 1) { var x = s.next[0]; if (x.to !== s.n + 1 || x.back) L.push("   - Luego → paso " + x.to + (x.back ? " (repite desde ahí)" : "")); }
      else if (s.next.length > 1) s.next.forEach(function (y) { L.push("   - " + (y.label ? "«" + y.label + "» → " : "Luego → ") + "paso " + y.to); });
      else if (s.type !== "end") L.push("   - (Termina aquí)");
      L.push("");
    });
    if (meta.rules) { L.push("## Reglas", ""); para(meta.rules).forEach(function (l) { L.push("- " + l.replace(/^[-•]\s*/, "")); }); L.push(""); }
    if (used.length) {
      L.push("## Herramientas de Musa que usa", "");
      used.forEach(function (t) { var d = toolInfo[t]; L.push("- `" + t + "`" + (d ? ": " + String(d).replace(/\s+/g, " ").slice(0, 200) : "")); });
      L.push("");
    }
    L.push("## Diagrama", "", "```mermaid", toMermaid(g).trim(), "```", "");
    return { slug: slug, name: name, description: desc, markdown: L.join("\n"), steps: S, tools: used };
  }
  /* huella estable (para la versión) */
  function fingerprint(str) { var h = 2166136261; str = String(str); for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return ("0000000" + (h >>> 0).toString(16)).slice(-8); }
  function newId(g, prefix) { var i = g.nodes.length + 1, id; do { id = (prefix || "P") + i++; } while (g.nodes.some(function (n) { return n.id === id; })); return id; }
  function starter(name) {
    var g = blank(); g.meta.name = name || "";
    g.nodes = [
      { id: "I", type: "start", text: "Inicio", how: "", tool: "", toolNote: "", link: "", x: 0, y: 0 },
      { id: "P1", type: "step", text: "Primer paso", how: "", tool: "", toolNote: "", link: "", x: 0, y: 150 },
      { id: "F", type: "end", text: "Fin", how: "", tool: "", toolNote: "", link: "", x: 0, y: 300 },
    ];
    g.edges = [{ from: "I", to: "P1", label: "" }, { from: "P1", to: "F", label: "" }];
    return g;
  }

  var SF = { TYPES: TYPES, TYPE_ES: TYPE_ES, META_KEYS: META_KEYS, blank: blank, starter: starter, parse: parse, toMermaid: toMermaid, layout: layout, order: order, steps: steps, validate: validate, toSkill: toSkill, slugify: slugify, fingerprint: fingerprint, newId: newId };
  /* navegador (window), worker y Node: siempre queda en globalThis.SkillFlow; además module.exports si existe */
  (root || globalThis).SkillFlow = SF;
  if (typeof module === "object" && module && module.exports) module.exports = SF;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
