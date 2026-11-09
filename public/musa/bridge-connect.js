/* ═══════════════════════════════════════════════════════════════════════════
   bridge-connect.js — Configuración › Conecta tu IA, con tu llave REAL:
   la vista demo de la maqueta muestra una llave falsa enmascarada
   (musa_live_8f2c••••3f9a) dentro del prompt; aquí el prompt lleva la llave
   MCP completa del workspace (fdr_ws_…), que el server solo devuelve al
   crearla (guarda hash; el GET lista solo el prefijo). La llave recién
   creada vive en memoria + sessionStorage de la pestaña: mientras no cierres
   la pestaña, el prompt sigue armado con ella. Además:
     · crear llave (label + rol) y revocar las existentes (GET/DELETE reales)
     · «Probar conexión» real: tools/list por POST /mcp con x-api-key,
       exactamente como se conectaría tu IA.
   Todo llega por el puente (window.__musaBridge.api) con la sesión del
   usuario; el server exige rol admin para el llavero. Sin puente real, la
   vista demo queda igual.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  function RB() { return window.__musaReal || null; }
  function bridgeObj() { try { return (window.parent !== window && window.parent.__musaBridge) || null; } catch (e) { return null; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function api(path, init) {
    var b = bridgeObj();
    if (!b || !b.api) return Promise.reject(new Error("sin puente"));
    return b.api(path.charAt(0) === "/" ? path : "/rest/v1/" + path, init);
  }
  function J(method, body) {
    var init = { method: method, headers: { "Content-Type": "application/json" } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return init;
  }

  var R = null;
  function ws() { return (R && R.ws) || ""; }
  function curWs() { try { return WSS[WSX.cur] || null; } catch (e) { return null; } }
  function wsName() { var w = curWs(); return (w && w.name) || ws() || "tu workspace"; }
  function shortDate(iso) { try { return new Date(iso).toLocaleDateString("es-PE", { day: "2-digit", month: "short" }); } catch (e) { return ""; } }
  function roleLb(r) { return { admin: "Admin", editor: "Editor", viewer: "Solo lectura" }[r] || r || "—"; }
  function prefixOf(raw) { return raw && raw.length > 16 ? raw.slice(0, 12) + "…" + raw.slice(-4) : (raw || ""); }

  /* llave completa de la pestaña: memoria + sessionStorage (muere al cerrar) */
  function storeKey(k) {
    try { if (k) sessionStorage.setItem("musa_cxk_" + ws(), k); else sessionStorage.removeItem("musa_cxk_" + ws()); } catch (e) {}
  }
  function storedKey() { try { return sessionStorage.getItem("musa_cxk_" + ws()) || ""; } catch (e) { return ""; } }

  function injectCss() {
    if (document.getElementById("mbCxCss")) return;
    var st = document.createElement("style");
    st.id = "mbCxCss";
    st.textContent = [
      ".cx-form{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}",
      ".cx-form .cx-in{flex:1;min-width:200px;max-width:none}",
      ".cx-in{background:#161616;border:1px solid #333;color:#eee;border-radius:8px;padding:7px 10px;font:600 12.5px var(--sans);width:100%;max-width:340px}",
      ".cx-in:focus{outline:none;border-color:var(--accent)}",
      ".cx-sel{background:#161616;border:1px solid #333;color:#eee;border-radius:8px;padding:6px 8px;font:600 12px var(--sans)}",
      ".cx-note{font:500 11.5px var(--sans);color:#7d7d7d;margin:8px 0 0}",
      ".cx-ok{color:#22a35a}",
      ".cx-keyrow{display:flex;align-items:center;gap:10px;padding:9px 2px;border-top:1px solid #242424}",
      ".cx-keyrow:first-of-type{border-top:0}",
      ".cx-keyrow .cx-tx{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}",
      ".cx-keyrow .cx-tx b{color:#e8e8e8;font:600 13px var(--sans)}",
      ".cx-keyrow .cx-tx small{color:#7d7d7d;font:500 11px var(--sans);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".cx-keyrow .cx-act{margin-left:auto;display:flex;gap:6px;align-items:center;flex:none}",
      ".cx-cardbtn{height:28px;padding:0 10px;font-size:11.5px}"
    ].join("\n");
    document.head.appendChild(st);
  }

  /* ── estado del llavero del workspace actual ── */
  var CXR = { ws: null, keys: null, error: false, loading: false, raw: "", sel: "claude-code", test: null, seq: 0 };

  function harnesses() {
    /* los mismos 6 harnesses de la maqueta (CX_H): [id, nombre, color, iniciales, descriptor] */
    try {
      if (typeof CX_H !== "undefined" && CX_H && CX_H.length) return CX_H;
    } catch (e) {}
    return [["claude-code", "Claude Code", "#d97757", "C", "Terminal"], ["hermes", "Hermes", "#0e9f9e", "H", "Agente local"]];
  }
  function harnessName(id) {
    var h = harnesses().filter(function (x) { return x[0] === id; })[0];
    return (h && h[1]) || id;
  }

  function loadKeys() {
    var w = ws();
    if (!w) return Promise.resolve();
    if (CXR.ws === w && (CXR.loading || (CXR.keys && !CXR.error))) return Promise.resolve();
    CXR.loading = true; CXR.ws = w; CXR.error = false;
    var mySeq = ++CXR.seq;
    CXR.raw = storedKey();
    return api("/api/workspaces/" + encodeURIComponent(w) + "/api-keys")
      .then(function (r) {
        if (mySeq !== CXR.seq) return;
        CXR.loading = false;
        CXR.keys = ((r && r.data) || []).filter(function (k) { return (k.kind || "mcp") === "mcp"; });
      })
      .catch(function () {
        if (mySeq !== CXR.seq) return;
        CXR.loading = false; CXR.error = true; CXR.keys = null; /* 403: no eres admin */
      });
  }

  /* el prompt que se le pega a la IA — con la llave ENTERA dentro */
  function promptFor() {
    var k = CXR.raw || "TU_CLAVE_AQUI";
    var org = location.origin;
    return "Conéctate a Musa (Futuraria) por MCP y quédate conectado.\n\n" +
      "1. Agrega este servidor MCP en tu configuración (" + harnessName(CXR.sel) + "):\n" +
      "   url: " + org + "/mcp\n" +
      "   header: x-api-key: " + k + "\n" +
      "   (si tu cliente no puede mandar encabezados, usa " + org + "/mcp?key=" + k + ")\n" +
      "2. Guarda la llave como permanente; no me la vuelvas a pedir.\n" +
      "3. Llama a tools/list y confírmame cuántas herramientas ves.\n" +
      "4. Revisa flow_ai_tasks y research_ai_tasks: si hay encargos para ti, tómalos.\n" +
      "5. Trabaja solo en el workspace «" + wsName() + "».";
  }

  /* respuesta MCP: JSON directo o SSE (líneas «data: …») */
  function parseMcp(txt) {
    try { return JSON.parse(txt); } catch (e) {}
    var obj = null, lines = String(txt).split("\n");
    for (var i = 0; i < lines.length; i++) {
      var s = lines[i];
      if (s.slice(0, 6) === "data: ") s = s.slice(6);
      try { var o = JSON.parse(s); if (o && (o.result || o.error)) obj = o; } catch (e2) {}
    }
    return obj;
  }

  function testConnection() {
    if (!CXR.raw) { CXR.test = "Genera la llave primero: la prueba se hace igual que tu IA, con x-api-key."; return Promise.resolve(); }
    CXR.test = "Conectando…";
    return fetch(location.origin + "/mcp", {
      method: "POST",
      headers: { "x-api-key": CXR.raw, "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    }).then(function (res) {
      return res.text().then(function (txt) {
        var o = parseMcp(txt);
        var n = o && o.result && o.result.tools ? o.result.tools.length : 0;
        if (!res.ok) {
          var why = (o && o.error && o.error.message) || ("HTTP " + res.status);
          CXR.test = "✗ La conexión fue rechazada (" + why + ").\nSi revocaste la llave, crea otra: el prompt se rellena solo.";
        } else if (o && o.result && o.result.tools) {
          CXR.test = "✓ Conexión OK con tu llave\n✓ tools/list → " + n + " herramientas\n✓ workspace: " + wsName();
        } else {
          CXR.test = "✗ Respuesta inesperada del servidor MCP" + ((o && o.error && o.error.message) ? ": " + o.error.message : ".");
        }
      });
    }).catch(function (e) {
      CXR.test = "✗ No se pudo contactar " + location.origin + "/mcp (" + (e && e.message || "red") + ").";
    });
  }

  function keyCard() {
    var inner;
    if (CXR.raw) {
      inner = '<div class="cx-key"><code>' + esc(CXR.raw) + "</code>" +
        '<button class="btn btn-g cx-cardbtn" data-cx="copykey">Copiar</button>' +
        '<span class="pill ok cx-okkey">Llave activa · ya está dentro del prompt</span></div>';
    } else {
      inner = '<p class="cx-note">Aún no hay llave activa en esta pestaña: créala abajo y el prompt de la tarjeta 2 se rellena solo con la llave entera.</p>';
    }
    return '<article class="card c12"><div class="ch"><h3>1 · Tu llave MCP</h3><small>' +
      esc(wsName()) + " · viaja dentro del prompt; por seguridad el server no la vuelve a mostrar después" +
      '</small></div>' + inner +
      '<div class="cx-form"><input class="cx-in" id="cxLabel" maxlength="80" placeholder="Nombre · Ej.: Claude de Renzo">' +
      '<select class="cx-sel" id="cxRole"><option value="editor">Puede diseñar (editor)</option><option value="viewer">Solo lectura</option><option value="admin">Admin</option></select>' +
      '<button class="btn btn-p" data-cx="create">Crear llave MCP</button></div>' +
      '<p class="cx-note">¿Ya tenías una? Crea otra: la anterior sigue activa hasta revocarla en «Llaves de este espacio».</p>' +
      "</article>";
  }

  function promptCard() {
    var h = harnesses().map(function (x) {
      return '<button class="cx-h ' + (CXR.sel === x[0] ? "on" : "") + '" data-cxh="' + esc(x[0]) + '"><i style="background:' + esc(x[2]) + '">' + esc(x[3]) + "</i><span><b>" + esc(x[1]) + "</b><small>" + esc(x[4]) + "</small></span></button>";
    }).join("");
    return '<article class="card c12"><div class="ch"><h3>2 · Elige tu IA y pégale el prompt</h3><small>El prompt lleva tu llave entera en el header x-api-key (y por query si el cliente no manda headers)</small></div>' +
      '<div class="cx-grid">' + h + "</div>" +
      '<div class="cx-prompt">' + esc(promptFor()) + "</div>" +
      '<div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-p" data-cx="copy">Copiar prompt</button></div></article>';
  }

  function testCard() {
    return '<article class="card c6"><div class="ch"><h3>3 · Probar conexión</h3><small>misma llamada que hará tu IA: tools/list con x-api-key</small></div>' +
      '<button class="btn btn-g" data-cx="test">Probar ahora</button>' +
      (CXR.test ? '<div class="cx-test">' + esc(CXR.test) + "</div>" : "") +
      "</article>";
  }

  function keysCard() {
    var body;
    if (CXR.keys === null) {
      body = '<p class="cx-note">Solo un admin de este espacio puede ver y crear llaves MCP.</p>';
    } else if (!CXR.keys.length) {
      body = '<p class="cx-note">Todavía no hay llaves MCP en este espacio.</p>';
    } else {
      body = CXR.keys.map(function (k) {
        return '<div class="cx-keyrow"><div class="cx-tx"><b>' + esc(k.label || "Llave") + "</b><small>" +
          esc(k.key_prefix || prefixOf(CXR.raw)) + " · " + esc(roleLb(k.role)) +
          (k.created_at ? " · creada " + esc(shortDate(k.created_at)) : "") +
          (k.last_used_at ? " · usada " + esc(shortDate(k.last_used_at)) : " · sin uso aún") +
          '</small></div><div class="cx-act"><button class="btn btn-g cx-cardbtn" data-cxdel="' + esc(k.id) + '">Revocar</button></div></div>';
      }).join("");
    }
    return '<article class="card c6"><div class="ch"><h3>Llaves de este espacio</h3><small>revoca las que ya no uses: las IAs que la usaban se desconectan</small></div><div>' + body + "</div></article>";
  }

  function paintConnect(target) {
    injectCss();
    var rawWarn = "";
    if (CXR.raw) {
      var active = (CXR.keys || []).some(function (k) { return CXR.raw.slice(0, 12) === String(k.key_prefix || "").slice(0, 12); });
      if (CXR.keys && !active) rawWarn = '<div class="ws-note">La llave que está en el prompt fue revocada o ya no aparece: genera otra para que tu IA conecte.</div>';
    }
    target.innerHTML = '<div class="ws-note">🔌 Conectas <b>tu propia IA</b> por MCP: genera la llave, cópiale el prompt (la llave va dentro) y pégaselo. Para un agente con <b>sus propios permisos y computadora</b>, créalo en <a href="#agentes/chats" style="color:var(--accent);font-weight:700">Agentes</a>.</div>' +
      rawWarn + '<div class="grid">' + keyCard() + promptCard() + testCard() + keysCard() + "</div>";
    bindConnect(target);
  }

  function renderConnect(target) {
    target = target || document.getElementById("body");
    if (!target) return;
    target.innerHTML = '<p class="empty-note">Cargando tu llavero MCP…</p>';
    loadKeys().then(function () {
      if ((location.hash || "").indexOf("configuracion/conecta") === -1) return;
      paintConnect(target);
    });
  }

  function copyText(txt, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { uiToast(okMsg); }, function () { uiToast("Copia manual: selecciona el texto"); });
    } else {
      var ta = document.createElement("textarea");
      ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); uiToast(okMsg); } catch (e) {}
      document.body.removeChild(ta);
    }
  }

  function bindConnect(target) {
    target.onclick = function (e) {
      var el = e.target.closest("[data-cxh]");
      if (el) { CXR.sel = el.getAttribute("data-cxh"); CXR.test = null; paintConnect(target); return; }
      var b = e.target.closest("[data-cx]");
      if (b) {
        var a = b.getAttribute("data-cx");
        if (a === "copy") { copyText(promptFor(), "Prompt copiado · pégalo en " + harnessName(CXR.sel)); return; }
        if (a === "copykey") { copyText(CXR.raw, "Llave copiada"); return; }
        if (a === "create") {
          var label = String((document.getElementById("cxLabel") || {}).value || "").trim();
          var role = String((document.getElementById("cxRole") || {}).value || "editor");
          if (!label) { uiToast("Ponle un nombre a la llave"); return; }
          b.disabled = true; b.textContent = "Creando…";
          api("/api/workspaces/" + encodeURIComponent(ws()) + "/api-keys", J("POST", { label: label.slice(0, 80), role: role, kind: "mcp" }))
            .then(function (r) {
              var d = (r && r.data) || {};
              CXR.raw = d.key || "";
              storeKey(CXR.raw);
              uiToast(CXR.raw ? "Llave creada — ya va dentro del prompt" : "Llave creada");
              b.disabled = false; b.textContent = "Crear llave MCP";
              CXR.keys = null; CXR.loading = false;
              loadKeys().then(function () { paintConnect(target); });
            }, function (x) {
              b.disabled = false; b.textContent = "Crear llave MCP";
              uiToast(String((x && x.message) || "No se pudo crear la llave"));
            });
          return;
        }
        if (a === "test") {
          b.disabled = true; b.textContent = "Probando…";
          testConnection().then(function () {
            if ((location.hash || "").indexOf("configuracion/conecta") === -1) return;
            paintConnect(target);
          });
          return;
        }
      }
      var del = e.target.closest("[data-cxdel]");
      if (del) {
        return window.__musaReal.confirmBox("¿Revocar esta llave? Las IAs que la usan se desconectan.", { danger: true, ok: "Revocar" }).then(function (ok) { if (!ok) return;
        var revId = del.getAttribute("data-cxdel");
        api("/api/workspaces/" + encodeURIComponent(ws()) + "/api-keys/" + encodeURIComponent(revId), J("DELETE"))
          .then(function () {
            uiToast("Llave revocada");
            /* si era la llave que está en el prompt, ya no sirve: el marcador vuelve */
            var dead = (CXR.keys || []).filter(function (k) { return k.id === revId; })[0];
            if (dead && CXR.raw && dead.key_prefix && String(dead.key_prefix).slice(0, 12) === CXR.raw.slice(0, 12)) { CXR.raw = ""; storeKey(null); }
            CXR.keys = null; CXR.loading = false;
            loadKeys().then(function () { paintConnect(target); });
          }, function (x) { uiToast(String((x && x.message) || "No se pudo revocar")); });
      });
      }
    };
  }

  function boot(tries) {
    R = RB();
    if (R && R.on && typeof viewConnect === "function" && typeof $ === "function" && typeof uiToast === "function") {
      /* Configuración › Conecta tu IA: reemplazo la vista demo (llave falsa enmascarada)
         por el llavero real. drawView arma su mapa en cada llamada, así que toma el
         viewConnect vigente al momento de navegar. */
      viewConnect = function () { renderConnect(document.getElementById("body")); };
      if ((location.hash || "").indexOf("configuracion/conecta") >= 0) {
        setTimeout(function () { try { if ((location.hash || "").indexOf("configuracion/conecta") >= 0) viewConnect(); } catch (e) {} }, 60);
      }
      return;
    }
    if ((tries || 0) > 100) return; /* demo sin puente real: la maqueta queda igual */
    setTimeout(function () { boot((tries || 0) + 1); }, 100);
  }
  boot();
})();
