/* collab.js — edición en vivo entre varias personas (estilo Figma) en el editor de diseño. Base de Hermes (F1),
 * revisada y completada el 2026-11-12.
 *
 *  - Sala por documento abierto (doc:tpl_<id>; en video, doc:video_<id> solo con presencia).
 *  - Presencia: quién está (avatares arriba), con cupo de editores por plan; el resto entra como espectador.
 *  - Cursores con nombre y color sobre el lienzo (#edCanvas), en coordenadas del mundo (siguen el zoom de cada uno).
 *  - Bloqueo suave: quien arrastra o redimensiona una capa la «tiene» hasta soltar; los demás no pueden agarrarla.
 *  - Cambios en vivo por capa («ops»): lo que cambia una persona (mover, editar texto, color, borrar, agregar) llega
 *    a los demás en < 1 s. Así nadie pisa lo del otro al guardar: el editor guarda el diseño entero y, sin esto,
 *    el último en guardar borraba los cambios del otro.
 *  - «saved»: quien guarda avisa con la huella del contenido; si coincide con la tuya no se recarga el diseño.
 *  - Solo planes agencia/empresa (rpc v2_my_plan). Interruptor en platform_config key=collab (vía /api/collab/config).
 *  - Si algo falla, el editor sigue igual que siempre (el guardado nunca pasa por aquí).
 */
(function () {
  "use strict";
  var RB = window.__musaReal;
  if (!RB || window.__musaCollab) return;

  function bridge() { try { return window.parent.__musaBridge; } catch (e) { return null; } }
  function api(url, init) { var b = bridge(); return b ? b.api(url, init) : Promise.reject(new Error("sin puente")); }
  function say(m) { try { if (typeof uiToast === "function") uiToast(m); else if (typeof window.toast === "function") window.toast(m); } catch (e) {} }
  function esc(s) { return String(s == null ? "?" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  var C = window.__musaCollabState = {
    on: false, room: null, roomKey: null, clientId: null, me: null, peers: {}, locks: {}, tier: null, maxEditors: 3, fps: 5,
    role: "editor", colors: ["#ff5e00", "#2f6fed", "#22a35a", "#e879f9", "#facc15", "#14b8a6"], sendT: 0, snap: {}, doc: null, applying: false,
  };
  window.__musaCollab = C;
  function E_() { try { return ED; } catch (e) { return null; } }
  function V_() { try { return VE; } catch (e) { return null; } }

  /* ── cursores y avatares ── */
  function canvas() { return document.getElementById("edCanvas"); }
  var layer = null;
  function ensureLayer() {
    var cv = canvas(); if (!cv) return null;
    if (layer && layer.parentNode === cv) return layer;
    layer = document.createElement("div"); layer.id = "collab-cursors"; layer.setAttribute("aria-hidden", "true");
    layer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:60;overflow:hidden";
    if (getComputedStyle(cv).position === "static") cv.style.position = "relative";
    cv.appendChild(layer); return layer;
  }
  function drawCursors() {
    var l = ensureLayer(), cv = canvas(); if (!l || !cv) return;
    var E = E_() || {}, z = E.z || 1, px = E.px || 0, py = E.py || 0, html = "";
    Object.keys(C.peers).forEach(function (id) {
      var p = C.peers[id]; if (!p || !p.cursor || p.cursor.x == null) return;
      var sx = p.cursor.x * z + px, sy = p.cursor.y * z + py;
      if (sx < -40 || sy < -40 || sx > cv.clientWidth + 40 || sy > cv.clientHeight + 40) return;
      html += '<div style="position:absolute;left:' + sx + "px;top:" + sy + 'px"><svg width="18" height="18" viewBox="0 0 24 24" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))"><path d="M3 2l7 18 2.5-7.5L20 10z" fill="' + p.color + '" stroke="#fff" stroke-width="1.2"/></svg>'
        + '<span style="position:absolute;left:15px;top:14px;background:' + p.color + ';color:#0b0b0b;font:700 10.5px Inter,sans-serif;padding:2px 7px;border-radius:50px;white-space:nowrap">' + esc(p.name) + (p.grab ? " · moviendo" : "") + "</span></div>";
    });
    l.innerHTML = html;
  }
  function drawAvatars() {
    var host = document.querySelector("#ed .ed-top") || document.querySelector("#ve .ed-tl");
    if (!host || !C.room) { var old = document.getElementById("collab-avatars"); if (old) old.remove(); return; }
    var bar = document.getElementById("collab-avatars");
    if (!bar || bar.parentNode !== host) { if (bar) bar.remove(); bar = document.createElement("div"); bar.id = "collab-avatars"; bar.setAttribute("role", "status"); bar.style.cssText = "display:flex;align-items:center;gap:4px;margin-left:8px"; host.appendChild(bar); }
    var ids = Object.keys(C.peers), n = ids.length + 1, html = "";
    ids.slice(0, 4).forEach(function (id) { var p = C.peers[id]; html += '<span title="' + esc(p.name) + (p.role === "viewer" ? " (espectador)" : "") + '" style="width:22px;height:22px;border-radius:50%;background:' + p.color + ';color:#0b0b0b;font:800 10px Inter,sans-serif;display:inline-flex;align-items:center;justify-content:center;border:1.5px solid #0b0b0b' + (p.role === "viewer" ? ";opacity:.55" : "") + '">' + esc(p.name).slice(0, 1).toUpperCase() + "</span>"; });
    if (ids.length > 4) html += '<span style="font:800 10px Inter,sans-serif;color:#bbb">+' + (ids.length - 4) + "</span>";
    html += '<span style="font:600 11px Inter,sans-serif;color:#9a978c;margin-left:4px;white-space:nowrap">' + (n === 1 ? "Solo tú aquí" : n + " en este diseño") + (C.role === "viewer" ? " · eres espectador" : "") + "</span>";
    bar.innerHTML = html; bar.setAttribute("aria-label", n === 1 ? "Solo tú en este documento" : n + " personas en este documento");
  }

  /* ── interruptor y plan ── */
  function gate() {
    if (C.gateOk && Date.now() - C.gateAt < 60000) return Promise.resolve({ on: true });
    return api("/api/collab/config").then(function (out) {
      var v = out && (out.data || out); if (!v || !v.enabled) return { on: false, why: "apagado" };
      C.fps = +v.fps || 5; var mx = v.maxEditors || {};
      return api("/rest/v1/rpc/v2_my_plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then(function (plan) {
        C.tier = plan && plan.tier;
        if (C.tier !== "agencia" && C.tier !== "empresa") return { on: false, why: "plan " + C.tier };
        if (mx[C.tier] != null) C.maxEditors = +mx[C.tier];
        C.gateOk = true; C.gateAt = Date.now(); return { on: true };
      }, function () { return { on: false, why: "plan-error" }; });
    }, function () { return { on: false, why: "config-error" }; });
  }
  function identity() {
    var b = bridge(), id = (b && b.userId) || "yo", name = (b && b.accountName) || "Alguien", seed = 0;
    for (var i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) >>> 0;
    C.me = { id: id, name: name, color: C.colors[seed % C.colors.length] }; return C.me;
  }

  /* ── sala ── */
  function connectRoom(key) {
    var b = bridge(); if (!b || !b.collab || !b.collab.join) return;
    disconnectRoom(); C.roomKey = key;
    b.collab.join(key, C.me, {
      onPresence: function (list) {
        var prev = C.peers; C.peers = {};
        var others = list.filter(function (p) { return !p.self; });
        others.forEach(function (p) { C.peers[p.clientId] = Object.assign({}, prev[p.clientId] || {}, p); });
        /* cupo: los primeros en llegar son editores; si ya hay maxEditors editores, entras como espectador */
        var mine = list.find(function (p) { return p.self; }), myAt = mine && mine.at || "";
        var before = others.filter(function (p) { return p.role !== "viewer" && (p.at || "") < myAt; }).length;
        var want = before < C.maxEditors ? "editor" : "viewer";
        if (want !== C.role) { C.role = want; if (b.collab.setRole) b.collab.setRole(want); say(want === "viewer" ? "El diseño ya tiene " + C.maxEditors + " personas editando: entras como espectador (ves los cambios en vivo)." : "Ya puedes editar"); }
        Object.keys(C.locks).forEach(function (el) { if (!C.peers[C.locks[el].from]) delete C.locks[el]; });
        drawAvatars(); drawCursors();
      },
      onCursor: function (m) { var p = C.peers[m.from] || (C.peers[m.from] = { name: m.name, color: m.color }); p.cursor = m.c; p.grab = !!m.g; drawCursors(); },
      onGrab: function (m) {
        if (!m.el) return;
        if (m.take) { C.locks[m.el] = { from: m.from, name: m.name }; } else if (C.locks[m.el] && C.locks[m.el].from === m.from) delete C.locks[m.el];
      },
      onOps: function (m) { applyOps(m); },
      onSaved: function (m) { onSaved(m); },
      onLeave: function (id) { delete C.peers[id]; Object.keys(C.locks).forEach(function (el) { if (C.locks[el].from === id) delete C.locks[el]; }); drawAvatars(); drawCursors(); },
    }).then(function (room) {
      if (C.roomKey !== key) { try { room.leave(); } catch (e) {} return; }
      C.room = room; C.clientId = room.clientId; resetSnap(); drawAvatars();
    }, function (e) { console.warn("[collab] no se pudo entrar a la sala:", e && e.message); C.roomKey = null; });
  }
  function disconnectRoom() {
    if (C.room && C.room.leave) { try { C.room.leave(); } catch (e) {} }
    C.room = null; C.roomKey = null; C.peers = {}; C.locks = {}; C.snap = {}; C.doc = null;
    if (layer) layer.innerHTML = "";
    var bar = document.getElementById("collab-avatars"); if (bar) bar.remove();
  }
  function send(m) { if (C.room && C.room.send) C.room.send(m); }
  window.__musaCollabSend = send;

  /* ── cursores (máx. fps configurados, solo mientras el mouse se mueve) ── */
  function worldXY(ev) {
    var cv = canvas(); if (!cv) return null; var r = cv.getBoundingClientRect(), E = E_() || {}, z = E.z || 1;
    return { x: Math.round((ev.clientX - r.left - (E.px || 0)) / z), y: Math.round((ev.clientY - r.top - (E.py || 0)) / z) };
  }
  function hookCanvas() {
    var cv = canvas(); if (!cv || cv.__collab) return; cv.__collab = true;
    cv.addEventListener("pointermove", function (ev) {
      if (!C.room || C.role !== "editor") return;
      var now = Date.now(); if (now - C.sendT < 1000 / C.fps) return; C.sendT = now;
      send({ t: "cursor", c: worldXY(ev), g: !!C.grabbing });
    }, { passive: true });
    cv.addEventListener("pointerleave", function () { if (C.room && C.role === "editor") send({ t: "cursor", c: { x: null, y: null } }); }, { passive: true });
  }

  /* ── bloqueo suave al arrastrar o redimensionar ── */
  function lidOf() { var o = typeof selObj === "function" ? selObj() : null; return o && o._n && o._n.getAttribute && o._n.getAttribute("data-layer-id"); }
  function guard(fn) {
    return function () {
      if (!C.room) return fn.apply(this, arguments);
      if (C.role === "viewer") { say("Estás como espectador: el diseño ya tiene " + C.maxEditors + " personas editando"); return; }
      var lid = lidOf(), lock = lid && C.locks[lid];
      if (lock && lock.from !== C.clientId && C.peers[lock.from]) { say((lock.name || "Alguien") + " está moviendo esa capa"); return; }
      if (lid) { send({ t: "grab", el: lid, take: true }); C.grabbing = lid; }
      var release = function () { removeEventListener("pointerup", release, true); if (lid) send({ t: "grab", el: lid, take: false }); C.grabbing = null; flush(); };
      addEventListener("pointerup", release, true);
      return fn.apply(this, arguments);
    };
  }
  function hookGestures() {
    if (typeof startMove === "function" && !startMove.__collab) { startMove = guard(startMove); startMove.__collab = true; }
    if (typeof startResize === "function" && !startResize.__collab) { startResize = guard(startResize); startResize.__collab = true; }
  }

  /* ── cambios en vivo por capa ──
     Huella por capa = su outerHTML. Al cambiar algo en el lienzo se compara con la última huella y se envían solo las
     capas que cambiaron (y las que se borraron). Al recibir, se reemplaza esa capa por id y se actualiza la huella,
     así no rebota. */
  function frames() { return (E_() && ED.doc && ED.doc.frames) || []; }
  /* el id de frame se genera al abrir (distinto en cada pestaña): el frame se identifica por su posición */
  function fid(f) { var i = frames().indexOf(f); return i < 0 ? null : "f" + i; }
  var VIEW_ATTRS = ["data-real", "data-f", "data-e", "contenteditable", "data-live-has"];
  function norm(n) {
    var c = n.cloneNode(true);
    /* lo que el editor dibuja encima de una capa de código vivo (su lienzo, la selección del objeto 3D) no es del diseño */
    [].forEach.call(c.querySelectorAll("[data-live-ui]"), function (x) { x.remove(); });
    [c].concat([].slice.call(c.querySelectorAll("*"))).forEach(function (x) {
      if (x.classList) { x.classList.remove("ed-el"); if (x.getAttribute("class") === "") x.removeAttribute("class"); }
      VIEW_ATTRS.forEach(function (a) { x.removeAttribute && x.removeAttribute(a); });
    });
    return c.outerHTML;
  }
  function frameSnap(f) {
    var m = {}, order = [];
    if (!f || !f._root) return { m: m, order: order };
    [].forEach.call(f._root.querySelectorAll("[data-layer-id]"), function (n) {
      if (n.closest("[data-collab-skip]")) return;
      var id = n.getAttribute("data-layer-id"); if (m[id] != null) return;
      m[id] = norm(n); order.push(id);
    });
    return { m: m, order: order };
  }
  function resetSnap() { C.doc = E_() && ED.doc; C.snap = {}; frames().forEach(function (f) { if (fid(f)) C.snap[fid(f)] = frameSnap(f); }); }
  function diffFrame(f) {
    var id = fid(f); if (!id) return null;
    var old = C.snap[id] || { m: {}, order: [] }, cur = frameSnap(f), set = [], del = [];
    cur.order.forEach(function (lid) { if (old.m[lid] !== cur.m[lid]) set.push(lid); });
    old.order.forEach(function (lid) { if (cur.m[lid] == null) del.push(lid); });
    C.snap[id] = cur;
    if (!set.length && !del.length) return null;
    /* si una capa padre cambió, sus hijas viajan dentro de ella */
    var inSet = {}; set.forEach(function (l) { inSet[l] = 1; });
    var top = set.filter(function (l) { var n = f._root.querySelector('[data-layer-id="' + CSS.escape(l) + '"]'), p = n && n.parentElement && n.parentElement.closest("[data-layer-id]"); while (p && f._root.contains(p)) { if (inSet[p.getAttribute("data-layer-id")]) return false; p = p.parentElement && p.parentElement.closest("[data-layer-id]"); } return true; });
    return { f: id, set: top.map(function (l) {
      var n = f._root.querySelector('[data-layer-id="' + CSS.escape(l) + '"]'), par = n.parentElement && n.parentElement.closest("[data-layer-id]"), nx = n.nextElementSibling;
      while (nx && !nx.hasAttribute("data-layer-id")) nx = nx.nextElementSibling;
      return { id: l, html: cur.m[l], parent: par && f._root.contains(par) ? par.getAttribute("data-layer-id") : null, before: nx ? nx.getAttribute("data-layer-id") : null };
    }), del: del };
  }
  var flushT = null, dirtyFrames = {};
  function schedule(f) { if (!C.room || C.applying || C.role !== "editor" || !f) return; dirtyFrames[fid(f)] = f; if (!flushT) flushT = setTimeout(flush, 120); }
  function flush() {
    clearTimeout(flushT); flushT = null;
    if (!C.room || C.role !== "editor") { dirtyFrames = {}; return; }
    Object.keys(dirtyFrames).forEach(function (k) {
      var ops = diffFrame(dirtyFrames[k]); if (!ops) return;
      var size = JSON.stringify(ops).length;
      if (size > 180000) { send({ t: "saved", big: true }); return; }   /* muy grande para un mensaje: los demás lo verán al guardarse */
      send({ t: "ops", f: ops.f, set: ops.set, del: ops.del, doc: ED.doc && ED.doc._id });
    });
    dirtyFrames = {};
  }
  var mo = new MutationObserver(function (recs) {
    if (!C.room || C.applying) return;
    recs.forEach(function (r) { var t = r.target.nodeType === 1 ? r.target : r.target.parentNode; var f = t && frames().find(function (x) { return x._root && x._root.contains(t); }); if (f) schedule(f); });
  });
  function clean(html) {
    if (window.DOMPurify) return DOMPurify.sanitize(html, { FORCE_BODY: true, ADD_TAGS: ["style"], ALLOW_DATA_ATTR: true, FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "base", "meta", "link"], FORBID_ATTR: ["srcdoc", "formaction", "action", "ping"] });
    return /<script|\son\w+\s*=|javascript:/i.test(html) ? "" : html;
  }
  function applyOps(m) {
    if (!E_() || !ED.doc || m.doc !== ED.doc._id) return;
    var f = frames().find(function (x) { return fid(x) === m.f; }); if (!f || !f._root) return;
    /* primero sale lo mío pendiente de este frame: si no, la nueva huella lo absorbería y nunca se enviaría */
    if (C.role === "editor") { dirtyFrames[m.f] = f; flush(); }
    var root = f._root, sel = typeof selObj === "function" && ED.sel && ED.sel.e != null ? selObj() : null, selId = sel && sel._n && sel._n.getAttribute("data-layer-id");
    C.applying = true;
    try {
      (m.del || []).forEach(function (id) { var n = root.querySelector('[data-layer-id="' + CSS.escape(id) + '"]'); if (n) n.remove(); });
      (m.set || []).forEach(function (op) {
        var tpl = document.createElement("template"); tpl.innerHTML = clean(op.html); var nn = tpl.content.firstElementChild; if (!nn || nn.getAttribute("data-layer-id") !== op.id) return;
        var cur = root.querySelector('[data-layer-id="' + CSS.escape(op.id) + '"]');
        if (cur) { cur.replaceWith(nn); return; }
        var par = op.parent ? root.querySelector('[data-layer-id="' + CSS.escape(op.parent) + '"]') : null, bef = op.before ? root.querySelector('[data-layer-id="' + CSS.escape(op.before) + '"]') : null;
        if (bef && bef.parentNode) bef.parentNode.insertBefore(nn, bef); else (par || f._content || root).appendChild(nn);
      });
      /* capas del frame con el modelo del editor; la selección se conserva por id */
      var byNode = new Map(); (f.els || []).forEach(function (e) { if (e && e._n) byNode.set(e._n, e); });
      f.els = [].filter.call(root.querySelectorAll("[data-layer-id]"), function (n) { return n !== f._content; }).map(function (n) { return byNode.get(n) || (RB._mk ? RB._mk(n, f) : null); }).filter(Boolean);
      try { Object.defineProperty(f, "_known", { value: f.els.map(function (e) { return e._n; }), writable: true, configurable: true, enumerable: false }); } catch (e) {}
      if (selId) { var i = f.els.findIndex(function (e) { return e._n.getAttribute("data-layer-id") === selId; }); if (i >= 0 && ED.sel) ED.sel.e = i; else if (ED.sel && ED.sel.e != null) ED.sel = { f: ED.sel.f, e: null }; }
      C.snap[m.f] = frameSnap(f);
      if (typeof edRender === "function") edRender(); if (typeof edLayers === "function") edLayers();
    } catch (e) { console.warn("[collab] no se pudo aplicar un cambio:", e); }
    setTimeout(function () { C.applying = false; }, 0);
    var p = C.peers[m.from]; if (p) { p.lastEdit = Date.now(); }
  }

  /* ── guardado: quien guarda avisa con la huella; si coincide con la tuya, no hace falta recargar ── */
  function sig() { try { var p = RB._ed && RB._ed.payload(); return p ? hash(JSON.stringify(p.frames.map(function (f) { return f.html; }))) : null; } catch (e) { return null; } }
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h; }
  var lastRemoteAt = null;
  setInterval(function () {
    if (!C.room || !E_() || !ED.doc || ED.doc !== C.doc) return;
    var at = ED.doc._remoteAt; if (!at || at === lastRemoteAt) return;
    var mine = lastRemoteAt !== null && !C.peerSaved; lastRemoteAt = at; C.peerSaved = false;
    if (mine) send({ t: "saved", doc: ED.doc._id, at: at, sig: sig() });
  }, 700);
  function onSaved(m) {
    if (!E_() || !ED.doc || m.doc !== ED.doc._id || !m.at) return;
    /* mismo contenido que el mío: tomo su versión como la guardada (el sondeo no recarga ni avisa «cambió desde otra sesión») */
    if (m.sig != null && m.sig === sig()) { C.peerSaved = true; ED.doc._remoteAt = m.at; lastRemoteAt = m.at; try { ED.doc._saved = JSON.stringify(RB._ed.payload()); } catch (e) {} RB._ownAt = Date.now(); }
  }

  /* ── router de salas: el editor abierto manda ── */
  function route() {
    try {
      if (E_() && ED.open && ED.doc && ED.doc._real) {
        var key = "doc:tpl_" + ED.doc._id;
        if (key !== C.roomKey) connectRoom(key);
        else if (C.room && ED.doc !== C.doc) { resetSnap(); lastRemoteAt = ED.doc._remoteAt || null; }   /* se recargó el diseño: nueva base */
        hookCanvas(); hookGestures();
        var w = document.getElementById("edWorld"); if (w && !w.__collabMo) { w.__collabMo = true; mo.observe(w, { subtree: true, childList: true, attributes: true, characterData: true }); }
      } else if (V_() && VE.open && VE.p && VE.p._real) {
        var vk = "doc:video_" + VE.p._real.id; if (vk !== C.roomKey) connectRoom(vk);
      } else if (C.roomKey) disconnectRoom();
      if (C.room) drawAvatars();
    } catch (e) {}
  }
  gate().then(function (g) {
    C.on = !!g.on;
    if (!C.on) { console.info("[collab] apagado:", g.why); return; }
    identity();
    setInterval(route, 700);
    setInterval(function () { if (C.room && Object.keys(C.peers).length) drawCursors(); }, 150);
    addEventListener("pagehide", disconnectRoom);
    console.info("[collab] encendido · plan", C.tier, "· cupo", C.maxEditors);
  });
})();
