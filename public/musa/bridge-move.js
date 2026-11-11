/* bridge-move.js — espacios como etiquetas: vista «Todo», «Guardar en», y mover cosas entre espacios.
 * - Selector de espacios con «Todo» arriba (por defecto al entrar): lo de todos tus espacios, cada cosa con su etiqueta.
 * - En «Todo», lo que creas va a «Guardar en» (tu espacio personal salvo que elijas otro).
 * - «Mover a…» en cada tarjeta (botón, clic derecho, toque largo en el celular), selección múltiple con barra,
 *   y arrastrar a la barra de espacios que aparece al arrastrar. Siempre con resumen y «Deshacer».
 * - Configuración › Organizar espacios: una columna por espacio para mover CUALQUIER tipo de cosa.
 * La lógica vive en el servidor (/api/workspace-move/*, migración 32), la misma que usa el MCP.
 */
(function () {
  var R = window.__musaReal; if (!R) return;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function bridge() { try { return window.parent.__musaBridge; } catch (e) { return null; } }
  function api(path, body) {
    var b = bridge(); if (!b) return Promise.reject(new Error("Sin sesión"));
    return b.api(path, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  function msg(e) { return String((e && e.message) || e || "Error").replace(/^API error:\s*\d+\s*[·:—-]?\s*/, ""); }
  var MOBILE = window.matchMedia("(max-width: 760px)");
  var TYPE_ES = { qr: "Código QR", design: "Diseño", brand: "Marca", piece: "Pieza", video: "Video", photo: "Foto", asset: "Archivo", note: "Nota", flow: "Flujo", contact: "Contacto", deal: "Oportunidad", quote: "Cotización", task: "Tarea", copy: "Copy", recipe: "Receta", brief: "Brief", campaign: "Campaña", form: "Formulario", mailing: "Mailing", event: "Evento", project: "Proyecto", research: "Fuente", playbook: "Playbook", script: "Guion", guideline: "Manual de marca", audience: "Audiencia", ad: "Anuncio", skill: "Skill", website: "Website" };

  /* ───────── estilos ───────── */
  var css = ""
    + ".mv-tools{position:absolute;top:8px;right:8px;display:flex;gap:6px;z-index:5;opacity:0;transition:opacity .15s}"
    + ".tile:hover .mv-tools,.kc:hover .mv-tools,.mv-sel .mv-tools,.mv-tools:focus-within{opacity:1}"
    + "@media (hover:none){.mv-tools{opacity:1}}"
    + ".mv-tools button{width:28px;height:28px;border-radius:50%;border:0;background:rgba(17,17,17,.82);color:#fff;display:grid;place-items:center;cursor:pointer;padding:0;box-shadow:0 2px 8px rgba(0,0,0,.25)}"
    + ".mv-tools button:hover{background:#111}.mv-tools button:focus-visible{outline:2px solid var(--accent,#ff5e00);outline-offset:1px}"
    + ".mv-tools .mv-ck[aria-pressed=true]{background:var(--accent,#ff5e00)}"
    + ".mv-sel{outline:2.5px solid var(--accent,#ff5e00)!important;outline-offset:2px;border-radius:14px}"
    + ".kc .mv-tools{top:6px;right:6px}.kc .mv-tools button{width:24px;height:24px}"
    + ".wtag{position:absolute;top:8px;left:8px;z-index:4;display:inline-flex;align-items:center;gap:5px;max-width:70%;height:22px;padding:0 8px 0 3px;border-radius:999px;background:rgba(17,17,17,.82);color:#fff;font:700 11px/1 var(--sans,Inter,system-ui,sans-serif);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}"
    + ".wtag i{flex:0 0 16px;height:16px;border-radius:50%;display:grid;place-items:center;font:800 8.5px/1 var(--sans,Inter,system-ui,sans-serif);font-style:normal;color:#fff}"
    + ".kc .wtag{position:static;display:inline-flex;margin:0 0 6px;max-width:100%}"
    + ".mv-bar{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:2147482000;display:flex;align-items:center;gap:10px;background:#111;color:#fff;border-radius:999px;padding:8px 8px 8px 18px;box-shadow:0 12px 40px rgba(0,0,0,.4);font:600 13px/1 var(--sans,Inter,system-ui,sans-serif);max-width:calc(100vw - 24px)}"
    + ".mv-bar button{border:0;border-radius:999px;height:34px;padding:0 14px;font:700 13px/1 var(--sans,Inter,system-ui,sans-serif);cursor:pointer}"
    + ".mv-bar .go{background:var(--accent,#ff5e00);color:#fff}.mv-bar .x{background:#2a2a2a;color:#fff}"
    + ".mv-dock{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147482100;display:flex;gap:8px;align-items:center;background:#111;border-radius:18px;padding:10px;box-shadow:0 16px 50px rgba(0,0,0,.45);max-width:calc(100vw - 24px);overflow-x:auto;scrollbar-width:none}"
    + ".mv-dock::-webkit-scrollbar{display:none}"
    + ".mv-dock small{color:#bbb;font:600 12px/1.2 var(--sans,Inter,system-ui,sans-serif);padding:0 6px;white-space:nowrap}"
    + ".mv-dz{display:flex;align-items:center;gap:8px;min-height:44px;padding:0 14px 0 6px;border-radius:12px;border:2px dashed #444;color:#fff;font:700 13px/1.1 var(--sans,Inter,system-ui,sans-serif);white-space:nowrap;background:#1c1c1c;transition:border-color .12s,background .12s}"
    + ".mv-dz.over{border-color:var(--accent,#ff5e00);background:#2b1a10}"
    + ".mv-dz i,.mv-ws i{flex:0 0 28px;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font:800 11px/1 var(--sans,Inter,system-ui,sans-serif);font-style:normal;color:#fff}"
    + ".mv-toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:2147482200;display:flex;align-items:center;gap:12px;background:#111;color:#fff;border-radius:14px;padding:12px 12px 12px 16px;box-shadow:0 12px 40px rgba(0,0,0,.4);font:600 13px/1.35 var(--sans,Inter,system-ui,sans-serif);max-width:calc(100vw - 24px)}"
    + ".mv-toast button{border:0;border-radius:999px;height:32px;padding:0 14px;background:#fff;color:#111;font:700 13px/1 var(--sans,Inter,system-ui,sans-serif);cursor:pointer;flex:0 0 auto}"
    + ".mv-save{display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 12px 0 6px;border-radius:999px;border:1.5px solid var(--line,#333);background:transparent;color:inherit;font:600 12.5px/1 var(--sans,Inter,system-ui,sans-serif);cursor:pointer;white-space:nowrap;margin-right:8px}"
    + ".mv-save i{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font:800 10px/1 var(--sans,Inter,system-ui,sans-serif);font-style:normal;color:#fff}"
    + ".mv-save small{opacity:.65;font-weight:600}"
    + "@media (max-width:760px){.mv-save small{display:none}.mv-save{padding:0 8px 0 4px}.mv-save b{max-width:90px;overflow:hidden;text-overflow:ellipsis}}"
    + ".mv-sum{margin:0 0 12px;font-size:13px;color:#222}.mv-sum .ft{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 10px}"
    + ".mv-sum .ft span{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1.5px solid #dcdacd;border-radius:999px;padding:4px 10px 4px 4px;font-weight:700}"
    + ".mv-sum .ft span i{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;color:#fff;font:800 9px/1 var(--sans,Inter,system-ui,sans-serif);font-style:normal}"
    + ".mv-sum h4{margin:10px 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#666}"
    + ".mv-sum ul{margin:0;padding-left:18px}.mv-sum li{margin:2px 0}"
    + ".mv-pick{display:grid;gap:6px;margin:0 0 12px}.mv-pick button{display:flex;align-items:center;gap:10px;text-align:left;border:1.5px solid #dcdacd;background:#fff;border-radius:12px;padding:8px 10px;cursor:pointer;color:#111;font:600 13px/1.2 var(--sans,Inter,system-ui,sans-serif)}"
    + ".mv-pick button:hover,.mv-pick button:focus-visible{border-color:var(--accent,#ff5e00);outline:0}.mv-pick button[disabled]{opacity:.45;cursor:not-allowed}"
    + ".mv-pick i{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;color:#fff;font:800 11px/1 var(--sans,Inter,system-ui,sans-serif);font-style:normal;flex:0 0 30px}"
    + ".mv-pick small{display:block;color:#666;font-weight:500;margin-top:2px}"
    /* tablero */
    + ".org-v .flt{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 14px}"
    + ".org-v .flt button{border:1.5px solid var(--line,#333);background:transparent;color:inherit;border-radius:999px;height:32px;padding:0 12px;font:600 12.5px/1 var(--sans,Inter,system-ui,sans-serif);cursor:pointer}"
    + ".org-v .flt button.on{background:var(--ink,#f4f3ea);color:var(--bg,#0b0b0b);border-color:transparent}"
    + ".org-v .flt input{height:34px;border-radius:999px;border:1.5px solid var(--line,#333);background:transparent;color:inherit;padding:0 14px;min-width:200px;font:inherit;outline:0}"
    + ".org-v .flt input:focus{border-color:var(--accent,#ff5e00)}"
    + ".org-v .cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;align-items:start}"
    + ".org-v .col{background:var(--card-bg,#f4f3ea);color:#111;border-radius:16px;padding:12px;border:2px solid transparent;min-height:160px;transition:border-color .12s}"
    + ".org-v .col.over{border-color:var(--accent,#ff5e00);border-style:dashed}"
    + ".org-v .col h4{display:flex;align-items:center;gap:8px;margin:2px 2px 10px;font:800 15px/1.1 var(--sans,Inter,system-ui,sans-serif)}"
    + ".org-v .col h4 i{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;color:#fff;font:800 10.5px/1 var(--sans,Inter,system-ui,sans-serif);font-style:normal}"
    + ".org-v .col h4 small{margin-left:auto;font:600 11.5px/1 var(--sans,Inter,system-ui,sans-serif);color:#666}"
    + ".org-v .col .lst{display:grid;gap:6px;max-height:min(62vh,640px);overflow-y:auto;scrollbar-width:none;overscroll-behavior:contain}.org-v .col .lst::-webkit-scrollbar{display:none}"
    + ".org-v .it{display:flex;align-items:center;gap:8px;background:#fff;border:1.5px solid #e2e0d3;border-radius:10px;padding:7px 8px;cursor:grab;user-select:none;font:600 12.5px/1.25 var(--sans,Inter,system-ui,sans-serif)}"
    + ".org-v .it:active{cursor:grabbing}.org-v .it.on{border-color:var(--accent,#ff5e00);background:#fff6ef}"
    + ".org-v .it input{flex:0 0 auto;width:16px;height:16px;accent-color:var(--accent,#ff5e00)}"
    + ".org-v .it span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"
    + ".org-v .it small{flex:0 0 auto;color:#777;font-weight:600;font-size:11px}"
    + ".org-v .it .mv1{flex:0 0 auto;border:0;background:#eeece2;border-radius:999px;height:24px;padding:0 9px;font:700 11px/1 var(--sans,Inter,system-ui,sans-serif);cursor:pointer;color:#111}"
    + ".org-v .empty{color:#777;font-size:12.5px;padding:10px 4px}"
    + ".org-v .hist{margin-top:22px}.org-v .hist h3{font:800 16px/1.2 var(--sans,Inter,system-ui,sans-serif);margin:0 0 8px}"
    + ".org-v .hist .row{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--line,#2a2a2a);font-size:13px}"
    + ".org-v .hist .row span{flex:1;min-width:0}.org-v .hist .row small{opacity:.65}"
    + ".org-v .hist button{border:1.5px solid var(--line,#333);background:transparent;color:inherit;border-radius:999px;height:30px;padding:0 12px;font:700 12px/1 var(--sans,Inter,system-ui,sans-serif);cursor:pointer}"
    + ".org-v .tip{font-size:12.5px;opacity:.75;margin:0 0 12px}"
    + "@media (max-width:760px){.org-v .cols{grid-template-columns:minmax(0,1fr)}.org-v .flt input{min-width:0;flex:1 1 100%}.org-v .it{cursor:default}}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  /* ───────── espacios ───────── */
  function realWs() { return (R.realWs || []).filter(function (id) { return typeof WSS !== "undefined" && WSS[id]; }); }
  function kindOf(id) { return (R.wsKind && R.wsKind[id]) || (/^ws_user_/.test(id) ? "personal" : "agency"); }
  function colorOf(id) { return kindOf(id) === "agency" ? "#ff5e00" : "#0e9f9e"; }
  function nameOf(id) { var w = typeof WSS !== "undefined" && WSS[id]; if (!w) return "otro espacio"; return kindOf(id) === "personal" && w.name === R.me ? "Mi espacio personal" : w.name; }
  function iniOf(id) { var w = typeof WSS !== "undefined" && WSS[id]; return w ? w.ini : "?"; }
  function dot(id, size) { return '<i style="background:' + colorOf(id) + (size ? ";width:" + size + "px;height:" + size + "px;flex-basis:" + size + "px" : "") + '">' + esc(iniOf(id)) + "</i>"; }
  function writeWs() { return R.all ? (R.writeWs && WSS[R.writeWs] ? R.writeWs : R.personalWs) : R.ws; }

  /* selector de espacios: «Todo» arriba, luego personal y agencias */
  function installSwitcher() {
    if (typeof wsPopDraw !== "function" || typeof wsPop === "undefined") return setTimeout(installSwitcher, 150);
    wsPopDraw = function () {
      var ids = realWs(), cur = WSX.cur;
      var group = function (k, title) {
        var list = ids.filter(function (id) { return kindOf(id) === k; }); if (!list.length) return "";
        return "<h6>" + title + "</h6>" + list.map(function (id) {
          return '<button class="ws-it ' + (cur === id ? "on" : "") + '" data-wsi="' + esc(id) + '"><i style="background:' + colorOf(id) + '">' + esc(iniOf(id)) + "</i><div><b>" + esc(nameOf(id)) + "</b><small>" + esc((PERSONAS.me.mem[id] || "Miembro")) + "</small></div></button>";
        }).join("");
      };
      wsPop.innerHTML = '<button class="ws-it ' + (cur === "__todo" ? "on" : "") + '" data-wsi="__todo"><i style="background:#111">✱</i><div><b>Todo</b><small>Lo de tus ' + ids.length + " espacios, cada cosa con su etiqueta</small></div></button>"
        + group("personal", "Personal") + group("agency", "Agencias")
        + '<div class="foot"><a href="#configuracion/organizar" data-wsclose>Organizar espacios</a><a href="#configuracion/espacios" data-wsclose>+ Crear espacio</a></div>';
    };
  }

  /* «Guardar en»: en «Todo», a qué espacio va lo que creas */
  function drawSaveChip() {
    var top = document.querySelector("header.top"); if (!top) return;
    var chip = top.querySelector(".mv-save");
    if (!R.on || !R.all || realWs().length < 2) { if (chip) chip.remove(); return; }
    var w = writeWs();
    if (!chip) {
      chip = document.createElement("button"); chip.type = "button"; chip.className = "mv-save";
      chip.setAttribute("data-action", "guardar-en");
      var anchor = top.querySelector(".icon-btn, .search, input[type=search]");
      var host = anchor && anchor.parentElement === top ? anchor : null;
      if (host) top.insertBefore(chip, host); else top.appendChild(chip);
      chip.addEventListener("click", pickWriteWs);
    }
    chip.title = "Lo que crees ahora se guarda en " + nameOf(w) + ". Toca para cambiarlo.";
    chip.setAttribute("aria-label", chip.title);
    chip.innerHTML = dot(w) + "<small>Guardar en</small><b>" + esc(nameOf(w)) + "</b>";
  }
  function pickWriteWs() {
    var ids = realWs();
    R.dialog({ title: "¿Dónde se guarda lo que creas?", message: "Estás viendo Todo. Lo nuevo (diseños, marcas, piezas, contactos…) se guarda en el espacio que elijas aquí. También puedes moverlo después.", ok: false, action: "guardar-en",
      body: '<div class="mv-pick">' + ids.map(function (id) { return '<button type="button" data-pick="' + esc(id) + '"' + (id === writeWs() ? ' aria-current="true" style="border-color:var(--accent,#ff5e00)"' : "") + ">" + dot(id) + "<span><b>" + esc(nameOf(id)) + "</b><small>" + (kindOf(id) === "agency" ? "Agencia" : "Personal") + "</small></span></button>"; }).join("") + "</div>" });
    setTimeout(function () {
      document.querySelectorAll('[data-musa-dialog="guardar-en"] [data-pick]').forEach(function (b) {
        b.addEventListener("click", function () {
          var id = b.getAttribute("data-pick"); if (R.dialog.close) R.dialog.close();
          if (id === writeWs()) return;
          R.writeWs = id; R.ws = id; drawSaveChip();
          if (typeof uiToast === "function") uiToast("Lo nuevo se guarda en " + nameOf(id));
          if (R.reload) R.reload();
        });
      });
    }, 0);
  }

  /* ───────── qué cosa es cada tarjeta ───────── */
  function itemOf(el) {
    if (!el || !el.closest) return null;
    var tile = el.closest(".tile");
    if (tile) {
      var pv = tile.querySelector("[data-pv]"), name = ((tile.querySelector(".tile-b b") || {}).textContent || tile.getAttribute("title") || "").trim();
      if (pv) {
        var id = pv.getAttribute("data-pv"), isVid = /^vidproj_/.test(id) || /^videos\//.test(tile.getAttribute("data-open") || "");
        return { type: isVid ? "video" : "design", id: id, name: name || (isVid ? "Video" : "Diseño"), el: tile };
      }
      var href = tile.getAttribute("href") || "";
      var m = href.match(/^#crear\/marcas\/(.+)$/);
      if (m) { var bn = decodeURIComponent(m[1]), bid = R.brandId && R.brandId[bn]; if (bid) return { type: "brand", id: bid, name: bn, el: tile }; }
    }
    var kc = el.closest(".kc[data-db]");
    if (kc && typeof route !== "undefined" && route.mod === "vender" && route.sub === "oportunidades") return { type: "deal", id: kc.dataset.db, name: ((kc.querySelector("b") || {}).textContent || "Oportunidad").trim(), el: kc };
    return null;
  }
  function wsOfItem(it) { return (R.wsOf && R.wsOf[it.type + ":" + it.id]) || (R.all ? null : R.ws); }
  var KEY = function (it) { return it.type + ":" + it.id; };

  /* ───────── selección ───────── */
  var SEL = {}; var selectMode = false;
  function selCount() { return Object.keys(SEL).length; }
  function toggleSel(it, on) {
    var k = KEY(it); on = on === undefined ? !SEL[k] : on;
    if (on) SEL[k] = { type: it.type, id: it.id, name: it.name }; else delete SEL[k];
    selectMode = selCount() > 0;
    paintSel(); drawBar();
  }
  function clearSel() { SEL = {}; selectMode = false; paintSel(); drawBar(); }
  function paintSel() {
    document.querySelectorAll("#view .mv-on").forEach(function (el) {
      var it = itemOf(el); var on = !!(it && SEL[KEY(it)]);
      el.classList.toggle("mv-sel", on);
      var ck = el.querySelector(".mv-ck"); if (ck) { ck.setAttribute("aria-pressed", on ? "true" : "false"); ck.setAttribute("aria-label", on ? "Quitar de la selección" : "Seleccionar"); }
    });
  }
  var bar = null;
  function drawBar() {
    var n = selCount();
    if (!n) { if (bar) { bar.remove(); bar = null; } return; }
    if (!bar) {
      bar = document.createElement("div"); bar.className = "mv-bar"; bar.setAttribute("role", "toolbar"); bar.setAttribute("aria-label", "Selección");
      bar.addEventListener("click", function (e) {
        if (e.target.closest(".go")) openMove(Object.keys(SEL).map(function (k) { return SEL[k]; }));
        if (e.target.closest(".x")) clearSel();
      });
      document.body.appendChild(bar);
    }
    bar.innerHTML = "<span>" + n + (n === 1 ? " seleccionado" : " seleccionados") + '</span><button type="button" class="go" data-action="mover-seleccion">Mover a…</button><button type="button" class="x" aria-label="Quitar la selección">✕</button>';
  }

  /* ───────── adornos en las tarjetas ───────── */
  var IC_MOVE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h13l-3-3M20 17H7l3 3"/></svg>';
  var IC_CK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';
  function decorate() {
    var view = document.getElementById("view"); if (!view || !R.on) return;
    view.querySelectorAll(".tile, .kc[data-db]").forEach(function (el) {
      var it = itemOf(el); if (!it || it.el !== el) return;
      if (!el.classList.contains("mv-on")) {
        el.classList.add("mv-on");
        if (getComputedStyle(el).position === "static") el.style.position = "relative";
        if (el.tagName !== "A" || !el.draggable) el.setAttribute("draggable", "true");
        var tools = document.createElement("div"); tools.className = "mv-tools";
        tools.innerHTML = '<button type="button" class="mv-ck" aria-pressed="false" aria-label="Seleccionar" title="Seleccionar">' + IC_CK + '</button><button type="button" class="mv-mv" aria-label="Mover a otro espacio" title="Mover a otro espacio" data-action="mover">' + IC_MOVE + "</button>";
        el.appendChild(tools);
      }
      var tag = el.querySelector(".wtag"), ws = wsOfItem(it);
      if (R.all && ws && WSS[ws]) {
        var html = dot(ws) + esc(nameOf(ws));
        if (!tag) { tag = document.createElement("span"); tag.className = "wtag"; if (el.classList.contains("kc")) el.insertBefore(tag, el.firstChild); else el.appendChild(tag); }
        if (tag.innerHTML !== html) { tag.innerHTML = html; tag.title = "Espacio: " + nameOf(ws); }
      } else if (tag) tag.remove();
    });
    paintSel();
  }
  var pend = false;
  function schedule() { if (pend) return; pend = true; requestAnimationFrame(function () { pend = false; decorate(); drawSaveChip(); }); }

  /* clics: botones de las tarjetas y modo selección */
  document.addEventListener("click", function (e) {
    var t = e.target;
    /* el toque que el navegador manda al soltar después de un toque largo no cuenta (si no, deselecciona) */
    if (Date.now() - lpAt < 900 && itemOf(t)) { e.preventDefault(); e.stopPropagation(); lpAt = 0; return; }
    var ck = t.closest && t.closest(".mv-ck"), mv = t.closest && t.closest(".mv-mv");
    if (ck || mv) {
      var it = itemOf(t); if (!it) return;
      e.preventDefault(); e.stopPropagation();
      if (ck) return toggleSel(it);
      var list = SEL[KEY(it)] ? Object.keys(SEL).map(function (k) { return SEL[k]; }) : [{ type: it.type, id: it.id, name: it.name }];
      return openMove(list);
    }
    if (selectMode) {
      var it2 = itemOf(t);
      if (it2 && !(t.closest && t.closest("a[href]:not(.tile), button:not(.mv-ck)"))) { e.preventDefault(); e.stopPropagation(); toggleSel(it2); }
    }
  }, true);
  /* clic derecho */
  document.addEventListener("contextmenu", function (e) {
    var it = itemOf(e.target); if (!it) return;
    if (lp || Date.now() - lpAt < 900 || (e.pointerType && e.pointerType !== "mouse") || (window.matchMedia && matchMedia("(hover: none)").matches)) { e.preventDefault(); return; }
    e.preventDefault();
    R.choose("«" + it.name + "»", [
      { value: "move", label: "Mover a otro espacio…", hint: "Con todo lo que depende de ello" },
      { value: "sel", label: SEL[KEY(it)] ? "Quitar de la selección" : "Seleccionar", hint: "Para mover varias cosas a la vez" },
    ], { title: TYPE_ES[it.type] || "Elemento", action: "menu-mover" }).then(function (v) {
      if (v === "move") openMove(SEL[KEY(it)] ? Object.keys(SEL).map(function (k) { return SEL[k]; }) : [{ type: it.type, id: it.id, name: it.name }]);
      if (v === "sel") toggleSel(it);
    });
  });
  /* toque largo en el celular: selecciona */
  var lp = null, lpXY = null, lpAt = 0;
  document.addEventListener("touchstart", function (e) {
    var it = itemOf(e.target); if (!it || e.touches.length !== 1) return;
    lpXY = [e.touches[0].clientX, e.touches[0].clientY];
    lp = setTimeout(function () { lp = null; lpAt = Date.now(); toggleSel(it, true); if (navigator.vibrate) try { navigator.vibrate(15); } catch (x) {} }, 520);
  }, { passive: true });
  document.addEventListener("touchmove", function (e) { if (lp && lpXY && Math.hypot(e.touches[0].clientX - lpXY[0], e.touches[0].clientY - lpXY[1]) > 10) { clearTimeout(lp); lp = null; } }, { passive: true });
  document.addEventListener("touchend", function () { if (lp) { clearTimeout(lp); lp = null; } }, { passive: true });

  /* ───────── arrastrar y soltar en la barra de espacios ───────── */
  var DRAG = null, dock = null;
  function showDock(items) {
    hideDock();
    var from = {}; items.forEach(function (it) { var w = wsOfItem(it); if (w) from[w] = 1; });
    var ids = realWs().filter(function (id) { return !(Object.keys(from).length === 1 && from[id]); });
    if (!ids.length) return;
    dock = document.createElement("div"); dock.className = "mv-dock"; dock.setAttribute("aria-hidden", "true");
    dock.innerHTML = "<small>Suelta en un espacio para moverlo:</small>" + ids.map(function (id) { return '<div class="mv-dz" data-dz="' + esc(id) + '">' + dot(id) + esc(nameOf(id)) + "</div>"; }).join("");
    document.body.appendChild(dock);
  }
  function hideDock() { if (dock) { dock.remove(); dock = null; } }
  document.addEventListener("dragstart", function (e) {
    var it = itemOf(e.target); if (!it) return;
    DRAG = SEL[KEY(it)] ? Object.keys(SEL).map(function (k) { return SEL[k]; }) : [{ type: it.type, id: it.id, name: it.name }];
    try { e.dataTransfer.setData("text/x-musa-items", JSON.stringify(DRAG)); e.dataTransfer.effectAllowed = "move"; } catch (x) {}
    setTimeout(function () { if (DRAG) showDock(DRAG); }, 0);
  }, true);
  document.addEventListener("dragover", function (e) {
    var dz = e.target.closest && e.target.closest(".mv-dz"); if (!dz || !DRAG) return;
    e.preventDefault(); try { e.dataTransfer.dropEffect = "move"; } catch (x) {}
    document.querySelectorAll(".mv-dz.over").forEach(function (x) { if (x !== dz) x.classList.remove("over"); }); dz.classList.add("over");
  });
  document.addEventListener("dragleave", function (e) { var dz = e.target.closest && e.target.closest(".mv-dz"); if (dz) dz.classList.remove("over"); });
  document.addEventListener("drop", function (e) {
    var dz = e.target.closest && e.target.closest(".mv-dz"); if (!dz || !DRAG) return;
    e.preventDefault(); e.stopPropagation();
    var items = DRAG, to = dz.getAttribute("data-dz"); DRAG = null; hideDock();
    openMove(items, to);
  }, true);
  document.addEventListener("dragend", function () { setTimeout(function () { DRAG = null; hideDock(); }, 0); }, true);

  /* ───────── mover: elegir destino → resumen → mover → deshacer ───────── */
  var TARGETS = null;
  function targets() {
    if (TARGETS) return Promise.resolve(TARGETS);
    return api("/api/workspace-move/targets").then(function (r) { TARGETS = (r && r.data) || []; return TARGETS; });
  }
  function pickTarget(items) {
    var from = {}; items.forEach(function (it) { var w = wsOfItem(it); if (w) from[w] = 1; });
    return targets().then(function (list) {
      return new Promise(function (resolve) {
        var only = Object.keys(from).length === 1 ? Object.keys(from)[0] : null;
        var rows = list.map(function (w) {
          var dis = !w.canMoveHere || w.id === only;
          return '<button type="button" data-pick="' + esc(w.id) + '"' + (dis ? " disabled" : "") + ">" + dot(w.id) + "<span><b>" + esc(w.id === R.personalWs ? "Mi espacio personal" : w.name) + "</b><small>" + (w.id === only ? "Ya está aquí" : !w.canMoveHere ? "Solo lectura: no puedes mover cosas aquí" : w.kind === "agency" ? "Agencia" : "Personal") + "</small></span></button>";
        }).join("");
        var label = items.length === 1 ? "«" + (items[0].name || TYPE_ES[items[0].type]) + "»" : items.length + " cosas";
        R.dialog({ title: "Mover " + label + " a…", ok: false, action: "mover-destino", body: '<div class="mv-pick">' + rows + "</div>" }).then(function () { resolve(null); });
        setTimeout(function () {
          document.querySelectorAll('[data-musa-dialog="mover-destino"] [data-pick]').forEach(function (b) {
            b.addEventListener("click", function () { var id = b.getAttribute("data-pick"); resolve(id); if (R.dialog.close) R.dialog.close(); });
          });
        }, 0);
      });
    });
  }
  function summaryHtml(pv) {
    var from = (pv.from || []).map(function (f) { return '<span>' + esc(f) + "</span>"; }).join("");
    var h = '<div class="mv-sum"><div class="ft">' + from + ' → <span>' + esc(pv.to) + "</span></div>";
    h += "<h4>Se mueve</h4><ul>" + (pv.includes || []).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
    if ((pv.brands || []).length) h += "<h4>Marcas</h4><ul>" + pv.brands.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
    if ((pv.skipped || []).length) h += "<h4>Se queda (ya existe en el destino)</h4><ul>" + pv.skipped.slice(0, 8).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + (pv.skipped.length > 8 ? "<li>y " + (pv.skipped.length - 8) + " más</li>" : "") + "</ul>";
    if (pv.alreadyThere) h += "<p style=\"margin:10px 0 0;color:#666\">" + pv.alreadyThere + (pv.alreadyThere === 1 ? " ya estaba" : " ya estaban") + " en ese espacio.</p>";
    return h + "</div>";
  }
  function openMove(items, target) {
    items = (items || []).map(function (it) { return { type: it.type, id: it.id, name: it.name }; });
    if (!items.length) return;
    (target ? Promise.resolve(target) : pickTarget(items)).then(function (to) {
      if (!to) return;
      var body = { items: items.map(function (it) { return { type: it.type, id: it.id }; }), target: to };
      var prog = R.progress ? R.progress("Revisando qué se mueve…", "") : null;
      return api("/api/workspace-move/preview", body).then(function (r) {
        if (prog) prog.close();
        var pv = r.data;
        return R.dialog({ title: "¿Mover a " + pv.to + "?", body: summaryHtml(pv), ok: "Mover " + (pv.total === 1 ? "1 elemento" : pv.total + " elementos"), action: "mover-confirmar", wide: true }).then(function (ok) {
          if (ok === null) return;
          var prog2 = R.progress ? R.progress("Moviendo…", "") : null;
          return api("/api/workspace-move/apply", body).then(function (res) {
            if (prog2) prog2.close();
            var d = res.data; clearSel(); TARGETS = null;
            /* la etiqueta cambia al instante; la recarga completa llega después */
            R.wsOf = R.wsOf || {}; items.forEach(function (it) { R.wsOf[KEY(it)] = to; }); schedule();
            undoToast("Movido a " + d.to + (d.total > 1 ? " · " + d.total + " elementos" : ""), d.moveId);
            if (R.reload) R.reload().then(function () { schedule(); if (/configuracion\/organizar/.test(location.hash)) orgLoad(); });
          }, function (e) { if (prog2) prog2.close(); R.notice("No se pudo mover", msg(e)); });
        });
      }, function (e) { if (prog) prog.close(); R.notice("No se pudo mover", msg(e)); });
    });
  }
  R.openMove = openMove;
  var toastEl = null, toastT = null;
  function undoToast(text, moveId) {
    if (toastEl) toastEl.remove(); clearTimeout(toastT);
    toastEl = document.createElement("div"); toastEl.className = "mv-toast"; toastEl.setAttribute("role", "status");
    toastEl.innerHTML = "<span>" + esc(text) + '</span><button type="button" data-action="deshacer-mover">Deshacer</button>';
    toastEl.querySelector("button").addEventListener("click", function () {
      var el = toastEl; el.querySelector("button").disabled = true;
      undo(moveId).then(function () { if (el) el.remove(); });
    });
    document.body.appendChild(toastEl);
    toastT = setTimeout(function () { if (toastEl) { toastEl.remove(); toastEl = null; } }, 12000);
  }
  function undo(moveId) {
    return api("/api/workspace-move/" + encodeURIComponent(moveId) + "/undo", {}).then(function (r) {
      var d = r.data;
      if (typeof uiToast === "function") uiToast(d.notRestored ? "Deshecho. " + d.notRestored + " cosas ya se habían movido de nuevo y se quedaron donde están" : "Deshecho: todo volvió a su espacio");
      TARGETS = null;
      return R.reload ? R.reload().then(function () { schedule(); if (/configuracion\/organizar/.test(location.hash)) orgLoad(); }) : null;
    }, function (e) { R.notice("No se pudo deshacer", msg(e)); });
  }

  /* ───────── Configuración › Organizar espacios ───────── */
  var ORG = { type: "design", q: "", items: null, sel: {}, hist: null, loading: false };
  var ORG_TYPES = [["design", "Diseños"], ["brand", "Marcas"], ["piece", "Piezas"], ["video", "Videos"], ["photo", "Fotos"], ["asset", "Archivos"], ["note", "Notas"], ["skill", "Skills"], ["website", "Websites"], ["qr", "Códigos QR"], ["flow", "Flujos"], ["contact", "Contactos"], ["deal", "Oportunidades"], ["copy", "Copys"], ["task", "Tareas"], ["campaign", "Campañas"], ["event", "Eventos"], ["form", "Formularios"], ["mailing", "Mailing"], ["project", "Proyectos"], ["brief", "Briefs"], ["quote", "Cotizaciones"], ["research", "Fuentes"], ["guideline", "Manuales"], ["recipe", "Recetas"], ["script", "Guiones"], ["playbook", "Playbooks"], ["audience", "Audiencias"], ["ad", "Anuncios"]];
  function orgView() {
    var body = document.getElementById("body"); if (!body) return;
    var hd = document.querySelector(".head");
    if (hd) { var p = hd.querySelector("p"); if (p) p.textContent = "Arrastra cualquier cosa de un espacio a otro. Viaja con todo lo que depende de ella y siempre puedes deshacer."; var a = hd.querySelector(".actions"); if (a) a.style.display = "none"; }
    orgDraw(); orgLoad();
  }
  function orgLoad() {
    var ids = realWs(); if (!ids.length) return;
    ORG.loading = true; orgDraw();
    var qs = "/api/workspace-move/items?ws=" + ids.map(encodeURIComponent).join(",") + "&type=" + ORG.type + "&limit=300" + (ORG.q ? "&q=" + encodeURIComponent(ORG.q) : "");
    Promise.all([
      api(qs).then(function (r) { return (r && r.data) || []; }),
      Promise.all(ids.map(function (id) { return api("/api/workspace-move/history?workspaceId=" + encodeURIComponent(id) + "&limit=10").then(function (r) { return (r && r.data) || []; }, function () { return []; }); })),
    ]).then(function (res) {
      ORG.items = res[0]; ORG.loading = false;
      var seen = {}, hist = [];
      res[1].forEach(function (l) { l.forEach(function (m) { if (!seen[m.id]) { seen[m.id] = 1; hist.push(m); } }); });
      ORG.hist = hist.sort(function (a, b) { return a.at < b.at ? 1 : -1; }).slice(0, 12);
      orgDraw();
    }, function (e) { ORG.loading = false; ORG.items = []; orgDraw(msg(e)); });
  }
  function orgDraw(err) {
    var body = document.getElementById("body"); if (!body || !/configuracion\/organizar/.test(location.hash)) return;
    var ids = realWs(), q = ORG.q;
    var h = '<div class="org-v"><div class="flt" role="toolbar" aria-label="Qué mostrar">';
    h += '<input type="search" placeholder="Buscar por nombre…" aria-label="Buscar" value="' + esc(q) + '" data-org-q>';
    h += ORG_TYPES.map(function (t) { return '<button type="button" data-org-t="' + t[0] + '" class="' + (ORG.type === t[0] ? "on" : "") + '" aria-pressed="' + (ORG.type === t[0]) + '">' + t[1] + "</button>"; }).join("");
    h += "</div>";
    h += '<p class="tip">' + (MOBILE.matches ? "Marca las casillas y toca «Mover a…», o usa el botón «Mover» de cada fila." : "Arrastra una fila (o varias marcadas) a otra columna. También puedes usar el botón «Mover».") + "</p>";
    if (err) h += '<p class="empty">No se pudo cargar: ' + esc(err) + "</p>";
    h += '<div class="cols">';
    ids.forEach(function (id) {
      var list = (ORG.items || []).filter(function (x) { return x.workspaceId === id; });
      h += '<section class="col" data-org-col="' + esc(id) + '" aria-label="' + esc(nameOf(id)) + '"><h4>' + dot(id) + esc(nameOf(id)) + "<small>" + (ORG.items ? list.length : "…") + "</small></h4><div class=\"lst\">";
      if (!ORG.items) h += '<p class="empty">' + (ORG.loading ? "Cargando…" : "") + "</p>";
      else if (!list.length) h += '<p class="empty">Nada de este tipo aquí. Suelta algo para moverlo.</p>';
      else h += list.map(function (x) {
        var k = x.type + ":" + x.id, on = !!ORG.sel[k];
        return '<div class="it' + (on ? " on" : "") + '" draggable="' + (!MOBILE.matches) + '" data-org-it="' + esc(k) + '"><input type="checkbox" aria-label="Seleccionar ' + esc(x.name) + '"' + (on ? " checked" : "") + "><span title=\"" + esc(x.name) + "\">" + esc(x.name) + '</span><button type="button" class="mv1" data-org-mv="' + esc(k) + '">Mover</button></div>';
      }).join("");
      h += "</div></section>";
    });
    h += "</div>";
    if (ORG.hist && ORG.hist.length) {
      h += '<div class="hist"><h3>Movimientos recientes</h3>' + ORG.hist.map(function (m) {
        var when = new Date(m.at).toLocaleString("es-PE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
        var what = (m.items || []).slice(0, 3).join(", ") + ((m.items || []).length > 3 ? " y " + (m.items.length - 3) + " más" : "");
        return '<div class="row"><span><b>' + esc(what || "Elementos") + "</b> · " + esc((m.from || []).join(", ")) + " → " + esc(m.to) + "<br><small>" + esc(when) + (m.total ? " · " + m.total + " elementos" : "") + "</small></span>" + (m.undone ? "<small>Deshecho</small>" : '<button type="button" data-org-undo="' + esc(m.id) + '">Deshacer</button>') + "</div>";
      }).join("") + "</div>";
    }
    h += "</div>";
    var keepFocus = document.activeElement && document.activeElement.hasAttribute && document.activeElement.hasAttribute("data-org-q");
    body.innerHTML = h;
    if (keepFocus) { var inp = body.querySelector("[data-org-q]"); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }
    var n = Object.keys(ORG.sel).length;
    if (n) { SEL = {}; Object.keys(ORG.sel).forEach(function (k) { SEL[k] = ORG.sel[k]; }); selectMode = false; drawBar(); } else if (bar && !selCount()) drawBar();
  }
  function orgItem(k) { return (ORG.items || []).find(function (x) { return x.type + ":" + x.id === k; }); }
  var orgQT = null;
  document.addEventListener("input", function (e) {
    if (!e.target.matches || !e.target.matches("[data-org-q]")) return;
    ORG.q = e.target.value; clearTimeout(orgQT); orgQT = setTimeout(orgLoad, 300);
  });
  document.addEventListener("click", function (e) {
    if (!/configuracion\/organizar/.test(location.hash)) return;
    var t = e.target;
    var tb = t.closest && t.closest("[data-org-t]");
    if (tb) { ORG.type = tb.getAttribute("data-org-t"); ORG.sel = {}; SEL = {}; drawBar(); ORG.items = null; orgLoad(); return; }
    var mb = t.closest && t.closest("[data-org-mv]");
    if (mb) { var x = orgItem(mb.getAttribute("data-org-mv")); if (x) { var list = ORG.sel[x.type + ":" + x.id] ? Object.keys(ORG.sel).map(function (k) { return ORG.sel[k]; }) : [x]; openMoveOrg(list); } return; }
    var ub = t.closest && t.closest("[data-org-undo]");
    if (ub) { ub.disabled = true; undo(ub.getAttribute("data-org-undo")); return; }
    var row = t.closest && t.closest("[data-org-it]");
    if (row) {
      var k = row.getAttribute("data-org-it"), it = orgItem(k); if (!it) return;
      if (ORG.sel[k]) delete ORG.sel[k]; else ORG.sel[k] = { type: it.type, id: it.id, name: it.name, workspaceId: it.workspaceId };
      R.wsOf = R.wsOf || {}; R.wsOf[k] = it.workspaceId;
      SEL = {}; Object.keys(ORG.sel).forEach(function (kk) { SEL[kk] = ORG.sel[kk]; });
      row.classList.toggle("on", !!ORG.sel[k]); var cb = row.querySelector("input"); if (cb) cb.checked = !!ORG.sel[k];
      drawBar();
    }
  });
  function openMoveOrg(list, to) {
    /* en el tablero el espacio de cada cosa ya viene en la lista */
    list.forEach(function (x) { if (x.workspaceId) { R.wsOf = R.wsOf || {}; R.wsOf[x.type + ":" + x.id] = x.workspaceId; } });
    openMove(list, to);
    ORG.sel = {};
  }
  document.addEventListener("dragstart", function (e) {
    var row = e.target.closest && e.target.closest("[data-org-it]"); if (!row) return;
    var k = row.getAttribute("data-org-it"), it = orgItem(k); if (!it) return;
    var list = ORG.sel[k] ? Object.keys(ORG.sel).map(function (kk) { return ORG.sel[kk]; }) : [it];
    ORG.drag = list;
    try { e.dataTransfer.setData("text/plain", it.name); e.dataTransfer.effectAllowed = "move"; } catch (x) {}
  });
  document.addEventListener("dragover", function (e) {
    var col = e.target.closest && e.target.closest("[data-org-col]"); if (!col || !ORG.drag) return;
    e.preventDefault(); document.querySelectorAll(".org-v .col.over").forEach(function (c) { if (c !== col) c.classList.remove("over"); }); col.classList.add("over");
  });
  document.addEventListener("drop", function (e) {
    var col = e.target.closest && e.target.closest("[data-org-col]"); if (!col || !ORG.drag) return;
    e.preventDefault(); col.classList.remove("over");
    var to = col.getAttribute("data-org-col"), list = ORG.drag.filter(function (x) { return x.workspaceId !== to; }); ORG.drag = null;
    if (!list.length) return;
    openMoveOrg(list, to);
  });
  document.addEventListener("dragend", function () { ORG.drag = null; document.querySelectorAll(".org-v .col.over").forEach(function (c) { c.classList.remove("over"); }); });

  /* ───────── instalar ───────── */
  function install() {
    if (typeof VIEWS2 === "undefined" || typeof modById !== "function" || typeof drawView !== "function" || !R.on) return setTimeout(install, 150);
    var m = modById("configuracion");
    if (m && !m.subs.some(function (s) { return s[0] === "organizar"; })) {
      var at = m.subs.findIndex(function (s) { return s[0] === "espacios"; });
      m.subs.splice(at < 0 ? m.subs.length : at + 1, 0, ["organizar", "Organizar espacios", "organizeSpaces"]);
    }
    VIEWS2.organizeSpaces = orgView;
    installSwitcher();
    R.onWsChange = function () { TARGETS = null; clearSel(); schedule(); };
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("hashchange", function () { if (!/configuracion\/organizar/.test(location.hash)) { ORG.sel = {}; } });
    if (typeof drawNav === "function") try { drawNav(); } catch (e) {}
    if (/configuracion\/organizar/.test(location.hash)) drawView();
    schedule();
  }
  install();
})();
