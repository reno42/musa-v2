/* bridge-state.js — al recargar, Musa vuelve exactamente a donde estabas:
 * la sección (ya va en la URL), los filtros y lo seleccionado en cada módulo, la ventana o el detalle
 * que tenías abierto, el editor abierto (con su zoom, posición y selección) y el scroll.
 * Se guarda por pestaña (sessionStorage), así dos pestañas no se pisan.
 */
(function () {
  var R = window.__musaReal;
  if (!R) return;
  var KEY = "musa-ui-state-v1";
  var OBJS = ["CAL", "KHX", "IB", "AD", "ML", "LP", "PJ", "CL", "BR", "INT", "CRV", "EVN", "EVT", "EVR", "FMX", "TPLV", "TPLF", "MF", "MLP", "REP", "AG", "CHT", "TQX", "ORG", "PBS", "CM", "SQ", "LU", "CX", "NAV"];
  var SKIP = { items: 1, cb: 1, msgs: 1, sync: 1, open: 1 };
  function ref(n) { try { return Function("return typeof " + n + " !== 'undefined' ? " + n + " : null")(); } catch (e) { return null; } }

  function enc(v, d) {
    if (v == null || typeof v !== "object") return typeof v === "function" ? undefined : v;
    if (d > 4 || v.nodeType) return undefined;
    if (v instanceof Set) return { __set: [].slice.call(v) };
    if (Array.isArray(v)) return v.map(function (x) { return enc(x, d + 1); });
    var o = {}; Object.keys(v).forEach(function (k) { var x = enc(v[k], d + 1); if (x !== undefined) o[k] = x; }); return o;
  }
  function dec(v) {
    if (v && typeof v === "object" && !Array.isArray(v)) { if (v.__set) return new Set(v.__set); var o = {}; Object.keys(v).forEach(function (k) { o[k] = dec(v[k]); }); return o; }
    return Array.isArray(v) ? v.map(dec) : v;
  }

  /* ── qué abrió la ventana o el detalle que está a la vista (para reabrirlo) ── */
  var stack = [], lastClick = null, restoring = false;
  function describe(el) {
    for (var n = el; n && n !== document.body; n = n.parentElement) {
      var a = {}, has = false;
      [].forEach.call(n.attributes || [], function (at) { if (/^data-/.test(at.name) && !/^data-(f|e|real|pv|tf)$/.test(at.name)) { a[at.name] = at.value; has = true; } });
      if (n.id && !/^(body|view|mx)/.test(n.id)) { a.id = n.id; has = true; }
      if (has) {
        var sel = n.tagName.toLowerCase() + Object.keys(a).map(function (k) { return k === "id" ? "#" + CSS.escape(a[k]) : "[" + k + '="' + CSS.escape(a[k]) + '"]'; }).join("");
        var all = document.querySelectorAll(sel);
        return { sel: sel, i: Math.max(0, [].indexOf.call(all, n)), txt: (n.textContent || "").trim().slice(0, 60) };
      }
    }
    return null;
  }
  var insideOpen = function (el) { var b = document.getElementById("body"); return (b && b.dataset.detail && b.contains(el)) || (typeof mxEl !== "undefined" && !mxEl.hidden && mxEl.contains(el)); };
  document.addEventListener("click", function (e) {
    if (restoring) return;
    lastClick = insideOpen(e.target) ? null : { d: describe(e.target), hash: location.hash };
    setTimeout(save, 0);
  }, true);
  function record(kind) {
    if (restoring || !lastClick || !lastClick.d) return;
    if (kind === "detail") stack = stack.filter(function (s) { return s.kind !== "detail"; });
    stack.push({ kind: kind, d: lastClick.d });
    if (stack.length > 4) stack.shift();
    lastClick = null;
    save();
  }
  var _mx = mx;
  mx = function () { record("mx"); return _mx.apply(this, arguments); };
  var _detail = detail;
  detail = function () { record("detail"); return _detail.apply(this, arguments); };
  var _drawView = drawView;
  drawView = function () { if (!restoring) stack = []; return _drawView.apply(this, arguments); };
  if (typeof mxEl !== "undefined") new MutationObserver(function () { if (mxEl.hidden && !restoring) { stack = stack.filter(function (s) { return s.kind !== "mx"; }); save(); } }).observe(mxEl, { attributes: true, attributeFilter: ["hidden"] });

  /* ── guardar ── */
  var t = null;
  function save() {
    clearTimeout(t);
    t = setTimeout(function () {
      if (restoring || !R.on) return;
      var s = { hash: location.hash, ws: typeof WSX !== "undefined" ? WSX.cur : null, role: typeof role !== "undefined" ? role : null, scroll: window.scrollY, stack: stack, o: {} };
      OBJS.forEach(function (n) { var o = ref(n); if (!o) return; var c = {}; Object.keys(o).forEach(function (k) { if (SKIP[k]) return; var v = enc(o[k], 0); if (v !== undefined) c[k] = v; }); s.o[n] = c; });
      if (ED.open && ED.doc && ED.doc._real) s.ed = { id: ED.doc._id, z: ED.z, px: ED.px, py: ED.py, sel: ED.sel, panel: ED.panel, lt: ED.lt, pres: !eq("#edPres").hidden ? ED.pi : null };
      if (R.saveEditors) R.saveEditors(s);
      try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
    }, 200);
  }
  window.addEventListener("hashchange", save);
  window.addEventListener("input", function () { save(); }, true);
  window.addEventListener("pagehide", function () { clearTimeout(t); restoring = false; t = null; save(); });
  window.addEventListener("scroll", function () { save(); }, { passive: true });
  setInterval(function () { if (ED.open) save(); }, 3000);
  R.saveState = save;

  /* hash estable: un diseño abierto se recuerda por su id, no por su posición en la lista */
  R.stableHash = function (h) {
    var m = h.match(/^#crear\/disenos\/(\d+)$/);
    if (m && typeof ED_DOCS !== "undefined" && ED_DOCS[m[1]] && ED_DOCS[m[1]]._real) return "#crear/disenos/tpl:" + ED_DOCS[m[1]]._id;
    return R.stableHashExtra ? R.stableHashExtra(h) : h;
  };

  /* ── restaurar (lo llama bridge.js con los datos ya cargados) ── */
  var saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch (e) {}
  R.restoreState = function () {
    if (!saved) return;
    restoring = true;
    Object.keys(saved.o || {}).forEach(function (n) { var o = ref(n); if (!o) return; var v = dec(saved.o[n]); Object.keys(v).forEach(function (k) { try { o[k] = v[k]; } catch (e) {} }); });
    if (typeof KHX !== "undefined") KHX.items = null;
  };
  R.afterRestore = function () {
    if (!saved) { restoring = false; return Promise.resolve(); }
    var s = saved; saved = null;
    var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var p = Promise.resolve();
    var m = location.hash.match(/^#crear\/disenos\/tpl:(.+)$/);
    if (m && R.openDesign) {
      p = new Promise(function (res) {
        R.openDesign(m[1]);
        var n = 0, iv = setInterval(function () {
          if ((ED.open && ED.doc && ED.doc._real) || ++n > 60) {
            clearInterval(iv);
            if (s.ed && ED.open && ED.doc && ED.doc._id === s.ed.id) {
              ED.z = s.ed.z; ED.px = s.ed.px; ED.py = s.ed.py; ED.panel = s.ed.panel || ED.panel; ED.lt = s.ed.lt || ED.lt;
              if (s.ed.sel && ED.doc.frames[s.ed.sel.f] && (s.ed.sel.e == null || ED.doc.frames[s.ed.sel.f].els[s.ed.sel.e])) ED.sel = s.ed.sel;
              requestAnimationFrame(function () { edRender(); edLayers(); edProps(); edView(); if (s.ed.pres != null) edPresent(s.ed.pres); });
            }
            res();
          }
        }, 100);
      });
    } else if (R.restoreEditors) p = R.restoreEditors(s);
    return p.then(function () {
      window.scrollTo(0, s.scroll || 0);
      return (s.stack || []).reduce(function (q, it) {
        return q.then(function () {
          var all = document.querySelectorAll(it.d.sel), el = all[it.d.i] || all[0];
          if (el && it.d.txt && (el.textContent || "").trim().slice(0, 60) !== it.d.txt) el = [].find.call(all, function (x) { return (x.textContent || "").trim().slice(0, 60) === it.d.txt; }) || el;
          if (el) el.click();
          return wait(250);
        });
      }, Promise.resolve());
    }).then(function () { stack = s.stack || []; restoring = false; window.scrollTo(0, s.scroll || 0); save(); }, function () { restoring = false; });
  };
  R.savedWs = saved && saved.ws;
})();
