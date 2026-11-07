/* i18n.js — Musa en inglés y español (web y plataforma).
 * El código fuente está en español; en inglés este script traduce la interfaz en vivo con /i18n/en.json.
 * Idioma, en este orden: ?lang= en la URL → elección manual (localStorage/cookie musa_lang) → país por IP
 * (cookie musa_geo_lang que pone el worker con Cloudflare) → idioma del navegador → inglés.
 * Lo que es contenido del usuario (diseños, textos editables) no se toca. */
(function () {
  if (window.musaI18n) return;
  var LANGS = ["en", "es"], SRC = "es";
  var top = window; try { if (window.parent && window.parent !== window && window.parent.location.host === location.host) top = window.parent; } catch (e) {}

  function cookie(n) { var m = document.cookie.match(new RegExp("(?:^|; )" + n + "=([^;]*)")); return m ? decodeURIComponent(m[1]) : null; }
  function setCookie(n, v) { document.cookie = n + "=" + encodeURIComponent(v) + "; path=/; max-age=31536000; samesite=lax"; }
  function ok(l) { return LANGS.indexOf(l) >= 0 ? l : null; }

  function resolve() {
    var q = null; try { q = ok(new URLSearchParams(top.location.search).get("lang")); } catch (e) {}
    if (q) { try { localStorage.setItem("musa-lang", q); } catch (e) {} setCookie("musa_lang", q); return q; }
    var m = null; try { m = ok(localStorage.getItem("musa-lang")); } catch (e) {}
    if (m) return m;
    m = ok(cookie("musa_lang")); if (m) return m;
    m = ok(cookie("musa_geo_lang")); if (m) return m;
    var nav = (navigator.languages && navigator.languages[0]) || navigator.language || "";
    return /^es\b/i.test(nav) ? "es" : "en";
  }
  var lang = resolve();
  document.documentElement.lang = lang;

  var api = {
    lang: lang, langs: LANGS,
    t: function (s) { return s; },
    set: function (l) {
      if (!ok(l)) return;
      try { localStorage.setItem("musa-lang", l); } catch (e) {}
      setCookie("musa_lang", l);
      try { var u = new URL(top.location.href); if (u.searchParams.has("lang")) { u.searchParams.set("lang", l); top.location.href = u.href; return; } } catch (e) {}
      top.location.reload();
    },
    /* Botón EN | ES. el = contenedor; opts.className para estilos propios. */
    switcher: function (opts) {
      opts = opts || {};
      var w = document.createElement("div");
      w.className = opts.className || "musa-lang";
      w.setAttribute("data-no-i18n", "");
      w.setAttribute("role", "group");
      w.setAttribute("aria-label", lang === "es" ? "Idioma" : "Language");
      LANGS.forEach(function (l) {
        var b = document.createElement("button");
        b.type = "button"; b.textContent = l.toUpperCase(); b.lang = l;
        b.title = l === "en" ? "English" : "Español";
        if (l === lang) { b.className = "on"; b.setAttribute("aria-pressed", "true"); }
        b.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); if (l !== lang) api.set(l); });
        w.appendChild(b);
      });
      return w;
    },
  };
  window.musaI18n = api;
  var st = document.createElement("style");
  st.textContent = ".musa-lang{display:inline-flex;gap:2px;padding:3px;border-radius:999px;background:#151515;border:1px solid #2a2a2a;vertical-align:middle}"
    + ".musa-lang button{border:0;background:transparent;color:#9a9a9a;font:700 11px/1 Inter,system-ui,sans-serif;letter-spacing:.06em;padding:6px 9px;border-radius:999px;cursor:pointer}"
    + ".musa-lang button:hover{color:#fff}.musa-lang button.on{background:#ff5e00;color:#111}";
  (document.head || document.documentElement).appendChild(st);
  if (lang === SRC) return;

  /* ── diccionario (síncrono: así no se ve un parpadeo en español) ── */
  var D = {};
  try {
    var x = new XMLHttpRequest();
    x.open("GET", "/i18n/" + lang + ".json?v=" + (window.MUSA_I18N_V || "1"), false);
    x.send(null);
    if (x.status === 200) D = JSON.parse(x.responseText);
  } catch (e) { D = {}; }

  var RE = (D.__re || []).map(function (x) { try { return [new RegExp(x[0], x[1] || ""), x[2]]; } catch (e) { return null; } }).filter(Boolean);
  delete D.__re;
  var NUM = /\d+(?:[.,:  ]\d+)*/g;
  function norm(s) { return s.replace(/\s+/g, " ").trim(); }
  function look(k) {
    if (Object.prototype.hasOwnProperty.call(D, k)) return D[k];
    var nums = k.match(NUM);
    if (nums) {
      var i = 0, tpl = k.replace(NUM, function () { return "{" + (i++) + "}"; });
      if (Object.prototype.hasOwnProperty.call(D, tpl)) return D[tpl].replace(/\{(\d+)\}/g, function (_, n) { return nums[+n] != null ? nums[+n] : ""; });
    }
    return null;
  }
  var LEAD = /^[\s+\-–—←→↑↓•·✓✕×★☆⚠️🖥#:¿¡"“(.,;]+/, TRAIL = /[\s.,;:!?…"”)→←]+$/;
  function tr(s) {
    var k = norm(s);
    if (!k || !/[a-záéíóúñ]/i.test(k)) return null;
    var r = look(k);
    if (r != null) return r;
    // reglas con expresiones regulares: «pedido por X» → «requested by X»
    for (var q = 0; q < RE.length; q++) { if (RE[q][0].test(k)) return k.replace(RE[q][0], RE[q][1]); }
    // prefijos/sufijos de símbolos y puntuación
    var a = (k.match(LEAD) || [""])[0], z = (k.slice(a.length).match(TRAIL) || [""])[0], core = k.slice(a.length, k.length - z.length);
    if (a && k.length > a.length) { r = look(k.slice(a.length)); if (r != null) return a + r; }
    if ((a || z) && core) { r = look(core); if (r != null) return a + r + z; }
    // partes separadas por « · », « — », « / », « | »
    var parts = k.split(/( · | — | – | \/ | \| )/);
    if (parts.length > 1) {
      var any = false;
      for (var i = 0; i < parts.length; i += 2) {
        var p = parts[i], t = p ? tr(p) : null;
        if (t != null) { parts[i] = t; any = true; }
      }
      if (any) return parts.join("");
    }
    // «Etiqueta: valor»
    var c = k.indexOf(": ");
    if (c > 0 && c < 40) { var h = look(k.slice(0, c)); if (h != null) { var rest = tr(k.slice(c + 2)); return h + ": " + (rest != null ? rest : k.slice(c + 2)); } }
    return null;
  }
  api.t = function (s) { var r = tr(String(s)); return r == null ? s : r; };

  /* ── traducir el DOM ── */
  var SKIP_TAG = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1, NOSCRIPT: 1, IFRAME: 1 };
  var SKIP_SEL = "[data-no-i18n],[contenteditable=''],[contenteditable=true],.ed-canvas,.ed-stage,.mreal,.ve-stage,.ph-stage,.fl-code,.cm-editor";
  var done = new WeakMap(); // nodo de texto → { src, out }
  function skip(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentElement) { if (SKIP_TAG[e.tagName]) return true; }
    return el && el.closest ? !!el.closest(SKIP_SEL) : false;
  }
  function doText(n) {
    var v = n.nodeValue; if (!v || !/[a-záéíóúñ]/i.test(v)) return;
    var d = done.get(n);
    if (d && v === d.out) return;
    if (skip(n.parentElement)) return;
    var r = tr(v);
    if (r == null) { done.set(n, { src: v, out: v }); return; }
    var lead = v.match(/^\s*/)[0], trail = v.match(/\s*$/)[0], out = lead + r + trail;
    done.set(n, { src: v, out: out });
    if (out !== v) n.nodeValue = out;
  }
  var ATTRS = ["placeholder", "title", "aria-label", "alt", "data-tip", "data-title"];
  function doAttrs(el) {
    if (skip(el)) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i], v = el.getAttribute(a); if (!v) continue;
      var mk = "data-i18n-" + a;
      if (el.getAttribute(mk) === v) continue;
      var r = tr(v);
      if (r != null && r !== v) { el.setAttribute(a, r); el.setAttribute(mk, r); }
    }
    if (el.tagName === "INPUT" && /^(button|submit|reset)$/i.test(el.type) && el.value) { var r2 = tr(el.value); if (r2 != null) el.value = r2; }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (SKIP_TAG[root.tagName]) return; if (root.matches && root.matches(SKIP_SEL)) return; doAttrs(root); }
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (n) {
        if (n.nodeType === 1) { if (SKIP_TAG[n.tagName]) return NodeFilter.FILTER_REJECT; if (n.matches(SKIP_SEL)) return NodeFilter.FILTER_REJECT; }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var n; while ((n = tw.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
  }
  function titleFix() { var r = tr(document.title); if (r != null && r !== document.title) document.title = r; }

  var pending = [], sched = false;
  function flush() { sched = false; var list = pending; pending = []; for (var i = 0; i < list.length; i++) walk(list[i]); titleFix(); }
  function queue(n) { pending.push(n); if (!sched) { sched = true; (window.queueMicrotask || setTimeout)(flush); } }
  var mo = new MutationObserver(function (ms) {
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      if (m.type === "characterData") queue(m.target);
      else if (m.type === "attributes") queue(m.target);
      else for (var j = 0; j < m.addedNodes.length; j++) queue(m.addedNodes[j]);
    }
  });
  function startObs() {
    walk(document.documentElement);
    titleFix();
    mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  if (document.body) startObs(); else document.addEventListener("DOMContentLoaded", startObs);

  /* ── diálogos nativos ── */
  ["alert", "confirm", "prompt"].forEach(function (f) {
    var o = window[f]; if (!o) return;
    window[f] = function (msg) { var a = [].slice.call(arguments); if (a.length) a[0] = api.t(String(msg)); return o.apply(window, a); };
  });

  /* ── fechas: los «es-PE» del código se muestran en inglés ── */
  function loc(l) { return (typeof l === "string" && /^es/i.test(l)) || (Array.isArray(l) && /^es/i.test(l[0])) || l == null ? "en-US" : l; }
  ["toLocaleDateString", "toLocaleTimeString", "toLocaleString"].forEach(function (f) {
    var o = Date.prototype[f]; Date.prototype[f] = function (l, opt) { return o.call(this, loc(l), opt); };
  });
  try {
    var DTF = Intl.DateTimeFormat;
    var W = function (l, o) { return new DTF(loc(l), o); };
    W.prototype = DTF.prototype; W.supportedLocalesOf = DTF.supportedLocalesOf;
    Intl.DateTimeFormat = W;
    var RTF = Intl.RelativeTimeFormat;
    if (RTF) { var W2 = function (l, o) { return new RTF(loc(l), o); }; W2.prototype = RTF.prototype; W2.supportedLocalesOf = RTF.supportedLocalesOf; Intl.RelativeTimeFormat = W2; }
  } catch (e) {}
})();
