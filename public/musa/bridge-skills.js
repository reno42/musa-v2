/* bridge-skills.js — Agentes › Skills con las skills REALES de Musa.
 * Las skills son fijas (iguales para todas las personas y en todos los planes):
 * viven en .agents/skills/<id>/SKILL.md y el prebuild las publica en
 * /skills-catalog.json y /skills/<id>.md. Las IAs las leen por MCP con
 * list_skills / get_skill. Aquí solo se muestran: misma UI de la maqueta
 * (org-grid / org-a / detail), sin tocar el diseño.
 */
(function () {
  var S = { list: null, loading: null };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function load() {
    if (S.list) return Promise.resolve(S.list);
    if (!S.loading) S.loading = fetch("/skills-catalog.json", { cache: "no-cache" }).then(function (r) { return r.json(); })
      .then(function (j) { S.list = (j && j.skills) || []; return S.list; })
      .catch(function () { S.loading = null; return []; });
    return S.loading;
  }
  var MOD = { "todos": "Todos los módulos", "transversal": "Transversal" };
  function modLabel(m) {
    if (MOD[m]) return MOD[m];
    var parts = String(m || "").split("/");
    var mm = typeof modById === "function" ? modById(parts[0]) : null;
    if (!mm) return m || "";
    var ss = parts[1] && mm.subs.find(function (x) { return x[0] === parts[1]; });
    return mm.label + (ss ? " › " + ss[1] : "");
  }
  function stripFront(md) { return String(md || "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ""); }

  /* Markdown mínimo y seguro (se escapa todo antes): títulos, listas,
   * listas numeradas, tablas, **negrita**, `código` y párrafos. */
  function inline(t) {
    return esc(t).replace(/`([^`]+)`/g, '<code style="font-family:ui-monospace,monospace;font-size:12px;background:rgba(0,0,0,.06);padding:1px 5px;border-radius:5px">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  }
  function md(src) {
    var lines = stripFront(src).split(/\r?\n/), out = [], list = null, i = 0;
    function close() { if (list) { out.push("</" + list + ">"); list = null; } }
    for (; i < lines.length; i++) {
      var l = lines[i];
      if (/^\s*$/.test(l)) { close(); continue; }
      var h = l.match(/^(#{1,4})\s+(.*)$/);
      if (h) { close(); var lv = h[1].length; out.push('<div style="font-weight:800;margin:' + (lv <= 2 ? "18px 0 6px;font-size:15px" : "12px 0 4px;font-size:13px") + '">' + inline(h[2]) + "</div>"); continue; }
      if (/^\|/.test(l)) {
        close(); var rows = [];
        while (i < lines.length && /^\|/.test(lines[i])) { if (!/^\|\s*-/.test(lines[i])) rows.push(lines[i].replace(/^\||\|\s*$/g, "").split("|")); i++; }
        i--;
        out.push('<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;margin:6px 0">' + rows.map(function (r, k) {
          return "<tr>" + r.map(function (c) { var tag = k ? "td" : "th"; return "<" + tag + ' style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--card-line,#ddd);vertical-align:top">' + inline(c.trim()) + "</" + tag + ">"; }).join("") + "</tr>";
        }).join("") + "</table></div>");
        continue;
      }
      var li = l.match(/^\s*[-*]\s+(.*)$/), ol = l.match(/^\s*\d+\.\s+(.*)$/);
      if (li || ol) {
        var want = li ? "ul" : "ol";
        if (list !== want) { close(); list = want; out.push("<" + want + ' style="margin:4px 0 4px 20px;font-size:13px;line-height:1.55">'); }
        out.push("<li>" + inline((li || ol)[1]) + "</li>");
        continue;
      }
      close(); out.push('<p style="font-size:13px;line-height:1.55;margin:4px 0">' + inline(l) + "</p>");
    }
    close();
    return out.join("");
  }

  function view() {
    var body = document.querySelector("#body");
    if (!S.list) { body.innerHTML = '<div class="ws-note">Cargando skills…</div>'; load().then(function () { if (/agentes\/skills/.test(location.hash)) view(); }); return; }
    var seen = {}; S.list.forEach(function (s) { (s.tools || []).forEach(function (t) { seen[t] = 1; }); }); var tools = Object.keys(seen).length;
    body.innerHTML = '<div class="ws-note">Las skills son las guías con las que cualquier IA trabaja en Musa: una por módulo, con los pasos, las reglas y solo las herramientas de ese módulo. Así tu IA no carga las ' + tools + ' herramientas de golpe: lee la skill del trabajo que le pides. Son las mismas para todos y vienen incluidas en todos los planes. Tus agentes y cualquier IA conectada por MCP las consultan con list_skills y get_skill.</div>'
      + '<div class="org-grid">' + S.list.map(function (s) {
        return '<div class="org-a" data-skid="' + esc(s.id) + '"><span class="ag-tag' + (s.id === "musa" ? " k" : "") + '" style="align-self:flex-start">' + esc(modLabel(s.module)) + "</span><b>" + esc(s.title) + "</b><small>" + esc(s.description) + "</small>"
          + '<div class="row"><span>Herramientas</span><b>' + (s.tools || []).length + "</b></div>"
          + '<div class="row"><span>Disponible</span><b>Todos los planes</b></div>'
          + '<div class="ag-ctl" style="margin-top:6px"><button type="button" data-skopen="' + esc(s.id) + '" data-action="ver-skill" class="' + (s.id === "musa" ? "pri" : "") + '">Ver skill</button></div></div>';
      }).join("") + "</div>";
  }

  function skillDetail(i) {
    var s = S.list && S.list[i];
    if (!s) return;
    var chips = (s.tools || []).map(function (t) { return '<span style="padding:5px 12px;font-family:ui-monospace,monospace">' + esc(t) + "</span>"; }).join("");
    var ex = (s.examples || []).map(function (e) { return '<label class="fx-chk"><span>“' + esc(e) + "”</span></label>"; }).join("");
    detail("Skills", esc(s.title), esc(modLabel(s.module)),
      '<div class="fx-row"><div><label class="fx-lbl">Guía que lee la IA</label><div class="fx-in" style="min-height:200px;max-height:none;white-space:normal;padding:14px 16px">' + md(s.content) + "</div></div>"
      + '<div><label class="fx-lbl">Herramientas de Musa que usa (' + (s.tools || []).length + ')</label><div class="fx-sw" style="flex-wrap:wrap">' + chips + "</div>"
      + '<label class="fx-lbl">Pídeselo así a tu IA</label>' + ex
      + '<label class="fx-lbl">Cómo la carga una IA</label><pre class="fx-in" style="white-space:pre-wrap;font-size:12px">get_skill({ name: "' + esc(s.id) + '" })\n\n/mcp?skills=' + esc(s.id.replace(/^musa-?/, "") || "musa") + "</pre></div></div>"
      + '<div class="ag-ctl" style="margin-top:12px"><button class="pri" data-skx="copy">Copiar skill</button><button data-skx="open">Abrir .md</button></div>',
      function (e) {
        var a = e.target.closest("[data-skx]");
        if (!a) return;
        if (a.dataset.skx === "open") { window.open("/skills/" + encodeURIComponent(s.id) + ".md", "_blank", "noopener"); return; }
        var done = function () { if (typeof uiToast === "function") uiToast("Skill copiada: pégala en tu IA"); };
        try { navigator.clipboard.writeText(s.content).then(done, function () { fallbackCopy(s.content); done(); }); } catch (err) { fallbackCopy(s.content); done(); }
      });
  }
  function fallbackCopy(text) {
    var t = document.createElement("textarea"); t.value = text; t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select(); try { document.execCommand("copy"); } catch (e) {} t.remove();
  }

  /* El clic en la tarjeta lo maneja la maqueta, que ignora los botones a propósito: el botón «Ver skill»
     necesita su propio manejador (antes no hacía nada). */
  document.addEventListener("click", function (e) {
    var bt = e.target.closest && e.target.closest("[data-skopen]");
    if (!bt || !S.list) return;
    e.preventDefault();
    var i = S.list.findIndex(function (x) { return x.id === bt.getAttribute("data-skopen"); });
    if (i >= 0) skillDetail(i);
  });

  function install() {
    if (typeof VIEWS2 === "undefined" || typeof detail !== "function") return setTimeout(install, 120);
    VIEWS2.skills = view;
    window.skillDetail = skillDetail;
    load().then(function () {
      if (/agentes\/skills/.test(location.hash) && !document.querySelector("#body").dataset.detail && typeof drawView === "function") drawView();
    });
  }
  install();
})();
