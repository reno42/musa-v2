/* video-code-core.js — «Musa Video Code»: el video del editor como código y el código como video.
 *
 * Un video de Musa se escribe como una página HTML + GSAP compatible con HyperFrames (cada clip es un elemento con
 * data-start / data-duration y su movimiento son llamadas tl.set / tl.to / tl.fromTo sobre un timeline en pausa).
 * Ese mismo código vuelve al editor como clips editables: lo que el código no cambió se restaura exacto (data-musa
 * guarda los parámetros de Musa) y lo que cambió manda (texto, estilos, tiempos y movimiento).
 *
 * Puro: sin DOM, sin red. Lo usan el editor (bridge-video-code.js, que además muestrea el render real del editor y
 * ejecuta código ajeno en un sandbox) y el servidor MCP (mcp-v2-video-code.mjs). Nunca evalúa JavaScript: las
 * llamadas de GSAP se leen con un analizador de literales propio.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  root.MusaVideoCode = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  var VERSION = 1;
  var GSAP_URL = "https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js";
  var CE_URL = "https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/CustomEase.min.js";

  /* ───────────── utilidades ───────────── */
  function r2(v) { return Math.round(v * 100) / 100; }
  function r3(v) { return Math.round(v * 1000) / 1000; }
  function cl(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function num(v, d) { var n = typeof v === "number" ? v : parseFloat(v); return isFinite(n) ? n : d; }
  function hash(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  function escH(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function escA(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function escQ(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/</g, "&lt;"); }
  function jsStr(s) { return JSON.stringify(String(s)); }
  function fmtN(v) { if (typeof v !== "number") return JSON.stringify(v); var x = Math.round(v * 1000) / 1000; if (Object.is(x, -0)) x = 0; return String(x); }
  function safeId(id) { return String(id == null ? "x" : id).replace(/[^A-Za-z0-9_-]/g, "_"); }
  /* clips de código vivo (Three.js, p5, canvas, Remotion 3D): video-live-core.js, si está cargado */
  function MLv() { return (typeof globalThis !== "undefined" && globalThis.MusaVideoLive) || null; }
  function deepClone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  var ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
  function decodeEnt(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
      if (e[0] === "#") { var n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isFinite(n) ? String.fromCodePoint(n) : m; }
      return ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m;
    });
  }

  /* ───────────── HTML: tokenizador + árbol (tolerante, sin DOM) ───────────── */
  var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, source: 1, track: 1, wbr: 1, param: 1 };
  var RAW = { script: 1, style: 1, textarea: 1, title: 1, template: 0 };
  function parseHtml(src) {
    src = String(src || "");
    var rootN = { tag: "#root", attrs: {}, kids: [], parent: null, s: 0, e: src.length }, cur = rootN, i = 0, n = src.length;
    function text(t, at) { if (t) cur.kids.push({ tag: "#text", text: decodeEnt(t), raw: t, parent: cur, s: at, e: at + t.length }); }
    while (i < n) {
      var lt = src.indexOf("<", i);
      if (lt < 0) { text(src.slice(i), i); break; }
      if (lt > i) text(src.slice(i, lt), i);
      if (src.startsWith("<!--", lt)) { var ce = src.indexOf("-->", lt + 4); cur.kids.push({ tag: "#comment", text: src.slice(lt + 4, ce < 0 ? n : ce), parent: cur, s: lt, e: ce < 0 ? n : ce + 3 }); i = ce < 0 ? n : ce + 3; continue; }
      if (src[lt + 1] === "!" || src[lt + 1] === "?") { var de = src.indexOf(">", lt); i = de < 0 ? n : de + 1; continue; }
      if (src[lt + 1] === "/") {
        var ge = src.indexOf(">", lt), tg = src.slice(lt + 2, ge < 0 ? n : ge).trim().toLowerCase();
        var k = cur; while (k && k.tag !== tg && k.parent) k = k.parent;
        if (k && k.tag === tg) { k.e = ge < 0 ? n : ge + 1; cur = k.parent || rootN; }
        i = ge < 0 ? n : ge + 1; continue;
      }
      var m = /^<([a-zA-Z][\w:-]*)/.exec(src.slice(lt, lt + 64));
      if (!m) { text("<", lt); i = lt + 1; continue; }
      var tag = m[1].toLowerCase(), j = lt + m[0].length, attrs = {}, order = [];
      for (;;) {
        while (j < n && /\s/.test(src[j])) j++;
        if (j >= n) break;
        if (src[j] === ">") { j++; break; }
        if (src[j] === "/" && src[j + 1] === ">") { j += 2; attrs.__self = 1; break; }
        var am = /^[^\s=>\/]+/.exec(src.slice(j, j + 200)); if (!am) { j++; continue; }
        var an = am[0].toLowerCase(); j += am[0].length;
        while (j < n && /\s/.test(src[j])) j++;
        var av = "";
        if (src[j] === "=") {
          j++; while (j < n && /\s/.test(src[j])) j++;
          var q = src[j];
          if (q === '"' || q === "'") { var qe = src.indexOf(q, j + 1); av = src.slice(j + 1, qe < 0 ? n : qe); j = qe < 0 ? n : qe + 1; }
          else { var um = /^[^\s>]+/.exec(src.slice(j, j + 4000)); av = um ? um[0] : ""; j += av.length; }
        }
        attrs[an] = decodeEnt(av); order.push(an);
      }
      var el = { tag: tag, attrs: attrs, kids: [], parent: cur, s: lt, os: j, e: j };
      cur.kids.push(el);
      if (VOID[tag] || attrs.__self) { delete attrs.__self; i = j; continue; }
      if (RAW[tag]) {
        var close = src.toLowerCase().indexOf("</" + tag, j); var body = src.slice(j, close < 0 ? n : close);
        el.kids.push({ tag: "#text", text: tag === "title" || tag === "textarea" ? decodeEnt(body) : body, raw: body, parent: el, s: j, e: j + body.length });
        var cg = close < 0 ? n : src.indexOf(">", close); el.e = cg < 0 ? n : cg + 1; i = el.e; continue;
      }
      cur = el; i = j;
    }
    return rootN;
  }
  function walk(nd, fn) { (nd.kids || []).forEach(function (k) { if (k.tag[0] !== "#") { if (fn(k) === false) return; walk(k, fn); } }); }
  function all(nd) { var out = []; walk(nd, function (k) { out.push(k); }); return out; }
  function classes(el) { return String(el.attrs && el.attrs["class"] || "").split(/\s+/).filter(Boolean); }
  function hasClass(el, c) { return classes(el).indexOf(c) >= 0; }
  function textOf(el) { var s = ""; (el.kids || []).forEach(function (k) { if (k.tag === "#text") s += k.text; else if (k.tag !== "script" && k.tag !== "style" && k.tag[0] !== "#") s += k.tag === "br" ? "\n" : textOf(k); }); return s; }
  function outer(src, el) { return src.slice(el.s, el.e); }
  function elKids(el) { return (el.kids || []).filter(function (k) { return k.tag[0] !== "#"; }); }
  /* selectores: compuestos con descendiente y >, #id .clase etiqueta [attr] :nth-child(K | -n+K) y listas con coma */
  function parseSel(sel) {
    return String(sel).split(",").map(function (part) {
      var toks = part.trim().replace(/\s*>\s*/g, " > ").split(/\s+/).filter(Boolean), out = [], rel = " ";
      toks.forEach(function (t) { if (t === ">") { rel = ">"; return; } out.push({ rel: rel, simple: parseSimple(t) }); rel = " "; });
      return out;
    }).filter(function (x) { return x.length; });
  }
  function parseSimple(t) {
    var o = { tag: null, id: null, cls: [], attr: [], nth: null }, re = /([#.]?[\w-]+)|\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]|:nth-child\(\s*(-n\+)?(\d+)\s*\)|:first-child|(\*)/g, m;
    while ((m = re.exec(t))) {
      if (m[1]) { if (m[1][0] === "#") o.id = m[1].slice(1); else if (m[1][0] === ".") o.cls.push(m[1].slice(1)); else o.tag = m[1].toLowerCase(); }
      else if (m[2]) o.attr.push([m[2].toLowerCase(), m[3]]);
      else if (m[5]) o.nth = { upto: !!m[4], k: +m[5] };
      else if (m[0] === ":first-child") o.nth = { upto: false, k: 1 };
    }
    return o;
  }
  function matchSimple(el, s) {
    if (!el || el.tag[0] === "#") return false;
    if (s.tag && el.tag !== s.tag) return false;
    if (s.id && el.attrs.id !== s.id) return false;
    for (var i = 0; i < s.cls.length; i++) if (!hasClass(el, s.cls[i])) return false;
    for (var j = 0; j < s.attr.length; j++) { var a = s.attr[j]; if (el.attrs[a[0]] == null) return false; if (a[1] != null && el.attrs[a[0]] !== a[1]) return false; }
    if (s.nth) { var sib = el.parent ? elKids(el.parent) : [el], ix = sib.indexOf(el) + 1; if (s.nth.upto ? ix > s.nth.k : ix !== s.nth.k) return false; }
    return true;
  }
  function matchChain(el, chain, i) {
    if (!matchSimple(el, chain[i].simple)) return false;
    if (i === 0) return true;
    if (chain[i].rel === ">") return !!el.parent && matchChain(el.parent, chain, i - 1);
    for (var p = el.parent; p; p = p.parent) if (matchChain(p, chain, i - 1)) return true;
    return false;
  }
  function select(rootEl, sel) {
    var chains = parseSel(sel), out = [];
    walk(rootEl, function (el) { if (chains.some(function (ch) { return matchChain(el, ch, ch.length - 1); }) && out.indexOf(el) < 0) out.push(el); });
    return out;
  }

  /* ───────────── CSS: declaraciones en línea ───────────── */
  function splitTop(s, sep) {
    var out = [], d = 0, q = null, cur = "";
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (q) { if (ch === q) q = null; cur += ch; continue; }
      if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
      if (ch === "(") d++; else if (ch === ")") d--;
      if (ch === sep && d <= 0) { out.push(cur); cur = ""; } else cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out;
  }
  function cssParse(s) {
    var o = {};
    splitTop(String(s || ""), ";").forEach(function (d) { var k = d.indexOf(":"); if (k < 0) return; var p = d.slice(0, k).trim().toLowerCase(), v = d.slice(k + 1).trim(); if (p) o[p] = v; });
    return o;
  }
  function cssStr(list) { return list.filter(function (x) { return x && x[1] != null && x[1] !== ""; }).map(function (x) { return x[0] + ":" + x[1]; }).join(";"); }

  /* ───────────── JS: analizador de literales y llamadas de GSAP (no ejecuta nada) ───────────── */
  function tokenize(src) {
    var T = [], i = 0, n = src.length;
    while (i < n) {
      var c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === "/" && src[i + 1] === "/") { var le = src.indexOf("\n", i); T.push({ t: "cm", v: src.slice(i + 2, le < 0 ? n : le), s: i }); i = le < 0 ? n : le; continue; }
      if (c === "/" && src[i + 1] === "*") { var be = src.indexOf("*/", i + 2); i = be < 0 ? n : be + 2; continue; }
      if (c === "/") {
        /* literal de expresión regular (después de un operador o al empezar): se salta entero */
        var pv = T[T.length - 1];
        if (!pv || (pv.t === "p" && "(,=:[!&|?{};+-*%<>~^".indexOf(pv.v.slice(-1)) >= 0) || (pv.t === "id" && /^(return|typeof|case|in|of)$/.test(pv.v))) {
          var r = i + 1, cls = false;
          while (r < n && src[r] !== "\n") { if (src[r] === "\\") { r += 2; continue; } if (src[r] === "[") cls = true; else if (src[r] === "]") cls = false; else if (src[r] === "/" && !cls) break; r++; }
          r++; while (r < n && /[a-z]/i.test(src[r])) r++;
          T.push({ t: "re", v: src.slice(i, r), s: i }); i = r; continue;
        }
      }
      if (c === '"' || c === "'" || c === "`") {
        var j = i + 1, v = "", tpl = false;
        while (j < n && src[j] !== c) { if (src[j] === "\\") { var nx = src[j + 1]; v += nx === "n" ? "\n" : nx === "t" ? "\t" : nx; j += 2; continue; } if (c === "`" && src[j] === "$" && src[j + 1] === "{") tpl = true; v += src[j]; j++; }
        T.push({ t: tpl ? "tpl" : "s", v: v, s: i }); i = j + 1; continue;
      }
      var m = /^(?:0x[0-9a-f]+|\d*\.?\d+(?:e[-+]?\d+)?)/i.exec(src.slice(i, i + 40));
      if (m && (/\d/.test(c) || (c === "." && /\d/.test(src[i + 1])))) { T.push({ t: "n", v: Number(m[0]), s: i }); i += m[0].length; continue; }
      var id = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 200));
      if (id) { T.push({ t: "id", v: id[0], s: i }); i += id[0].length; continue; }
      var p3 = src.substr(i, 3), p2 = src.substr(i, 2);
      if (p3 === "===" || p3 === "!==" || p3 === "...") { T.push({ t: "p", v: p3, s: i }); i += 3; continue; }
      if (["=>", "==", "!=", "<=", ">=", "&&", "||", "+=", "-=", "?.", "**"].indexOf(p2) >= 0) { T.push({ t: "p", v: p2, s: i }); i += 2; continue; }
      T.push({ t: "p", v: c, s: i }); i++;
    }
    return T;
  }
  var UNRES = { __unresolved: true };
  /* valor literal en T[k]: devuelve [valor, siguiente índice]; lo que no es literal (funciones, variables) → UNRES */
  function parseValue(T, k, vars) {
    var r = parseAdd(T, k, vars);
    if (T[r[1]] && T[r[1]].v === "?") { return skipValue(T, k); }
    return r;
  }
  function parseAdd(T, k, vars) {
    var a = parseMul(T, k, vars), v = a[0], i = a[1];
    while (T[i] && (T[i].v === "+" || T[i].v === "-") && T[i].t === "p") {
      var b = parseMul(T, i + 1, vars);
      if (v === UNRES || b[0] === UNRES) v = UNRES;
      else if (T[i].v === "+") v = (typeof v === "string" || typeof b[0] === "string") ? String(v) + String(b[0]) : v + b[0];
      else v = v - b[0];
      i = b[1];
    }
    return [v, i];
  }
  function parseMul(T, k, vars) {
    var a = parseUnary(T, k, vars), v = a[0], i = a[1];
    while (T[i] && (T[i].v === "*" || T[i].v === "/" || T[i].v === "%") && T[i].t === "p") {
      var b = parseUnary(T, i + 1, vars);
      if (v === UNRES || b[0] === UNRES || typeof v !== "number" || typeof b[0] !== "number") v = UNRES;
      else v = T[i].v === "*" ? v * b[0] : T[i].v === "/" ? v / b[0] : v % b[0];
      i = b[1];
    }
    return [v, i];
  }
  function parseUnary(T, k, vars) {
    var t = T[k]; if (!t) return [UNRES, k];
    if (t.t === "p" && t.v === "-") { var x = parseUnary(T, k + 1, vars); return [typeof x[0] === "number" ? -x[0] : UNRES, x[1]]; }
    if (t.t === "p" && t.v === "+") return parseUnary(T, k + 1, vars);
    return parsePrimary(T, k, vars);
  }
  function parsePrimary(T, k, vars) {
    var t = T[k]; if (!t) return [UNRES, k];
    if (t.t === "n") return [t.v, k + 1];
    if (t.t === "s") return [t.v, k + 1];
    if (t.t === "tpl") return [UNRES, k + 1];
    if (t.t === "p" && t.v === "(") {
      var inner = parseValue(T, k + 1, vars);
      if (T[inner[1]] && T[inner[1]].v === ")" && !(T[inner[1] + 1] && T[inner[1] + 1].v === "=>")) return [inner[0], inner[1] + 1];
      return skipValue(T, k);
    }
    if (t.t === "p" && t.v === "{") {
      var o = {}, i = k + 1;
      while (T[i] && T[i].v !== "}") {
        if (T[i].v === ",") { i++; continue; }
        if (T[i].v === "...") { var sp = parseValue(T, i + 1, vars); if (sp[0] && typeof sp[0] === "object" && sp[0] !== UNRES) Object.assign(o, sp[0]); i = sp[1]; continue; }
        var key = T[i].t === "id" || T[i].t === "s" ? T[i].v : T[i].t === "n" ? String(T[i].v) : null;
        if (T[i].v === "[") { var sk = skipValue(T, i); i = sk[1]; continue; }
        if (key == null) { i++; continue; }
        if (T[i + 1] && T[i + 1].v === ":") { var vv = parseValue(T, i + 2, vars); o[key] = vv[0]; i = vv[1]; }
        else if (T[i + 1] && T[i + 1].v === "(") { var fn = skipBalanced(T, i + 1); var bd = T[fn] && T[fn].v === "{" ? skipBalanced(T, fn) : fn; o[key] = UNRES; i = bd; }
        else { o[key] = vars && key in vars ? vars[key] : UNRES; i++; }
      }
      return [o, i + 1];
    }
    if (t.t === "p" && t.v === "[") {
      var arr = [], j = k + 1;
      while (T[j] && T[j].v !== "]") { if (T[j].v === ",") { j++; continue; } var av = parseValue(T, j, vars); arr.push(av[0]); j = av[1]; }
      return [arr, j + 1];
    }
    if (t.t === "id") {
      if (t.v === "true") return [true, k + 1];
      if (t.v === "false") return [false, k + 1];
      if (t.v === "null" || t.v === "undefined") return [null, k + 1];
      if (t.v === "Infinity") return [Infinity, k + 1];
      if (t.v === "function") return skipValue(T, k);
      if (T[k + 1] && T[k + 1].v === "=>") return skipValue(T, k);
      if (t.v === "Math" && T[k + 1] && T[k + 1].v === ".") {
        var fnm = T[k + 2] && T[k + 2].v;
        if (fnm === "PI") return [Math.PI, k + 3];
        if (T[k + 3] && T[k + 3].v === "(" && typeof Math[fnm] === "function") {
          var args = [], q2 = k + 4;
          while (T[q2] && T[q2].v !== ")") { if (T[q2].v === ",") { q2++; continue; } var a2 = parseValue(T, q2, vars); args.push(a2[0]); q2 = a2[1]; }
          return [args.every(function (x) { return typeof x === "number"; }) ? Math[fnm].apply(null, args) : UNRES, q2 + 1];
        }
      }
      if (vars && Object.prototype.hasOwnProperty.call(vars, t.v) && !(T[k + 1] && (T[k + 1].v === "." || T[k + 1].v === "(" || T[k + 1].v === "["))) return [vars[t.v], k + 1];
      return skipValue(T, k);
    }
    return [UNRES, k + 1];
  }
  function skipBalanced(T, k) { var open = T[k].v, close = open === "(" ? ")" : open === "[" ? "]" : "}", d = 0, i = k; for (; i < T.length; i++) { if (T[i].v === open) d++; else if (T[i].v === close) { d--; if (d === 0) return i + 1; } } return i; }
  /* salta un valor no literal hasta la próxima coma o cierre del nivel actual */
  function skipValue(T, k) {
    var d = 0, i = k;
    for (; i < T.length; i++) {
      var v = T[i].v;
      if (T[i].t === "p" && (v === "(" || v === "[" || v === "{")) d++;
      else if (T[i].t === "p" && (v === ")" || v === "]" || v === "}")) { if (d === 0) break; d--; }
      else if (T[i].t === "p" && v === "," && d === 0) break;
    }
    return [UNRES, i];
  }
  /* lee el script: variables con literales, CustomEase.create, timelines y llamadas set/to/from/fromTo/addLabel */
  function parseGsap(js) {
    var T = tokenize(String(js || "")), vars = {}, calls = [], eases = {}, tlVars = {}, blocks = [], k = 0, curBlock = null, order = 0;
    for (k = 0; k < T.length; k++) {
      var t = T[k];
      if (t.t === "cm") {
        var bm = /^\s*▸\s*(\S+)(?:.*#([0-9a-z]+))?\s*$/.exec(t.v), em = /^\s*◂\s*(\S+)/.exec(t.v);
        if (bm) curBlock = { id: bm[1], h: bm[2] || null, s: t.s, calls: [] };
        else if (em && curBlock && em[1] === curBlock.id) { curBlock.e = t.s; blocks.push(curBlock); curBlock = null; }
        continue;
      }
      if (t.t === "id" && (t.v === "const" || t.v === "let" || t.v === "var") && T[k + 1] && T[k + 1].t === "id" && T[k + 2] && T[k + 2].v === "=") {
        var name = T[k + 1].v;
        if (T[k + 3] && T[k + 3].v === "gsap" && T[k + 4] && T[k + 4].v === "." && T[k + 5] && T[k + 5].v === "timeline") { tlVars[name] = 1; continue; }
        var lv = parseValue(T, k + 3, vars); if (lv[0] !== UNRES) vars[name] = lv[0];
        continue;
      }
      if (t.t === "id" && t.v === "CustomEase" && T[k + 1] && T[k + 1].v === "." && T[k + 2] && T[k + 2].v === "create" && T[k + 3] && T[k + 3].v === "(") {
        var a1 = parseValue(T, k + 4, vars), a2 = T[a1[1]] && T[a1[1]].v === "," ? parseValue(T, a1[1] + 1, vars) : [UNRES, a1[1]];
        if (typeof a1[0] === "string" && typeof a2[0] === "string") eases[a1[0]] = a2[0];
        continue;
      }
      /* receptor: tl.método( … ) o cadena ).método( … ) o gsap.método( … ) */
      if (t.t === "p" && t.v === "." && T[k + 1] && T[k + 1].t === "id" && /^(set|to|from|fromTo|addLabel)$/.test(T[k + 1].v) && T[k + 2] && T[k + 2].v === "(") {
        var recv = T[k - 1], kind = null;
        if (recv && recv.t === "id" && recv.v === "gsap") kind = "gsap";
        else if (recv && recv.t === "id" && (tlVars[recv.v] || /^(tl|timeline|master|main)\w*$/i.test(recv.v))) kind = "tl";
        else if (recv && recv.v === ")") kind = "chain";
        else if (recv && recv.v === "]" ) kind = "tl";
        if (!kind) continue;
        var meth = T[k + 1].v, args = [], q = k + 3;
        while (T[q] && T[q].v !== ")") { if (T[q].v === ",") { q++; continue; } var av = parseValue(T, q, vars); args.push(av[0]); q = av[1]; }
        var call = { m: meth, args: args, kind: kind, at: T[k + 1].s, n: order++ };
        calls.push(call); if (curBlock) curBlock.calls.push(call);
        k = q;
      }
    }
    return { calls: calls, eases: eases, vars: vars, blocks: blocks };
  }

  /* ───────────── curvas de GSAP ───────────── */
  function bezierFn(x1, y1, x2, y2) {
    x1 = cl(x1, 0, 1); x2 = cl(x2, 0, 1);
    return function (x) {
      if (x <= 0) return 0; if (x >= 1) return 1;
      var t = x;
      for (var i = 0; i < 12; i++) {
        var bx = 3 * x1 * t * (1 - t) * (1 - t) + 3 * x2 * t * t * (1 - t) + t * t * t - x;
        var d = 3 * x1 * (1 - t) * (1 - t) + 6 * (x2 - x1) * t * (1 - t) + 3 * (1 - x2) * t * t;
        if (Math.abs(bx) < 1e-6 || Math.abs(d) < 1e-6) break;
        t = cl(t - bx / d, 0, 1);
      }
      return 3 * y1 * t * (1 - t) * (1 - t) + 3 * y2 * t * t * (1 - t) + t * t * t;
    };
  }
  function bounceOut(p) { var n1 = 7.5625, d1 = 2.75; if (p < 1 / d1) return n1 * p * p; if (p < 2 / d1) return n1 * (p -= 1.5 / d1) * p + 0.75; if (p < 2.5 / d1) return n1 * (p -= 2.25 / d1) * p + 0.9375; return n1 * (p -= 2.625 / d1) * p + 0.984375; }
  function mkInOut(fin) { return { "in": fin, out: function (p) { return 1 - fin(1 - p); }, inOut: function (p) { return p < 0.5 ? fin(p * 2) / 2 : 1 - fin((1 - p) * 2) / 2; } }; }
  function powIn(n) { return function (p) { return Math.pow(p, n); }; }
  var BASE_EASES = {
    power1: mkInOut(powIn(2)), power2: mkInOut(powIn(3)), power3: mkInOut(powIn(4)), power4: mkInOut(powIn(5)),
    quad: mkInOut(powIn(2)), cubic: mkInOut(powIn(3)), quart: mkInOut(powIn(4)), quint: mkInOut(powIn(5)), strong: mkInOut(powIn(5)),
    sine: mkInOut(function (p) { return 1 - Math.cos(p * Math.PI / 2); }),
    expo: mkInOut(function (p) { return p === 0 ? 0 : Math.pow(2, 10 * (p - 1)); }),
    circ: mkInOut(function (p) { return 1 - Math.sqrt(Math.max(0, 1 - p * p)); }),
    bounce: mkInOut(function (p) { return 1 - bounceOut(1 - p); }),
  };
  function easeFn(spec, custom) {
    if (typeof spec === "function") return spec;
    var s = String(spec == null ? "power1.out" : spec).trim();
    if (custom && custom[s]) return customEase(custom[s]);
    if (!s || s === "none" || s === "linear" || /^linear\./i.test(s) || /^power0/i.test(s)) return function (p) { return p; };
    var m = /^([a-z]+\d?)(?:\.(in|out|inout|easein|easeout|easeinout))?(?:\(([^)]*)\))?$/i.exec(s.replace(/^(Power\d|Back|Elastic|Bounce|Sine|Expo|Circ|Quad|Cubic|Quart|Quint|Strong|Linear)\.ease(In|Out|InOut)$/, function (a, b, c) { return b.toLowerCase() + "." + c.toLowerCase(); }));
    if (/^steps\(/i.test(s)) { var st = Math.max(1, parseInt(s.slice(6), 10) || 1); return function (p) { return p >= 1 ? 1 : Math.floor(p * st) / st; }; }
    if (/^cubic-bezier\(/i.test(s)) { var b = s.slice(13, -1).split(",").map(Number); if (b.length === 4 && b.every(isFinite)) return bezierFn(b[0], b[1], b[2], b[3]); }
    if (!m) return BASE_EASES.power1.out;
    var base = m[1].toLowerCase(), dir = (m[2] || "out").toLowerCase().replace(/^ease/, ""), par = (m[3] || "").split(",").map(parseFloat);
    if (dir === "inout") dir = "inOut";
    if (base === "back") { var o = isFinite(par[0]) ? par[0] : 1.70158; var bin = function (p) { return p * p * ((o + 1) * p - o); }; return mkInOut(bin)[dir]; }
    if (base === "elastic") {
      var a = isFinite(par[0]) ? Math.max(1, par[0]) : 1, per = isFinite(par[1]) ? par[1] : 0.3, s2 = per / (2 * Math.PI) * Math.asin(1 / a);
      var eo = function (p) { return p === 0 || p === 1 ? p : a * Math.pow(2, -10 * p) * Math.sin((p - s2) * (2 * Math.PI) / per) + 1; };
      var ein = function (p) { return 1 - eo(1 - p); };
      return dir === "out" ? eo : dir === "in" ? ein : function (p) { return p < 0.5 ? ein(p * 2) / 2 : 1 - ein((1 - p) * 2) / 2; };
    }
    var B = BASE_EASES[base]; if (!B) return BASE_EASES.power1.out;
    return B[dir] || B.out;
  }
  /* CustomEase: una cúbica «M0,0 C x1,y1 x2,y2 1,1» (la forma que escribe Musa) */
  function customEase(path) {
    var n = String(path).match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
    if (n.length >= 8) { var v = n.map(Number); return bezierFn(v[2], v[3], v[4], v[5]); }
    return function (p) { return p; };
  }

  /* ───────────── timeline de GSAP → valores por elemento en el tiempo ───────────── */
  var TPROPS = { x: 1, y: 1, xPercent: 1, yPercent: 1, rotation: 1, rotate: 1, scale: 1, scaleX: 1, scaleY: 1, opacity: 1, autoAlpha: 1, filter: 1, clipPath: 1, webkitClipPath: 1, display: 1, zIndex: 1, left: 1, top: 1, maskImage: 1, webkitMaskImage: 1, backdropFilter: 1, webkitBackdropFilter: 1, transformOrigin: 0 };
  var SKIPV = { duration: 1, delay: 1, ease: 1, stagger: 1, repeat: 1, yoyo: 1, repeatDelay: 1, keyframes: 1, immediateRender: 1, overwrite: 1, onComplete: 1, onUpdate: 1, onStart: 1, paused: 1, easeEach: 1, id: 1, data: 1, runBackwards: 1, startAt: 1, inherit: 1, callbackScope: 1, lazy: 1 };
  function propsOf(v) { var o = {}; Object.keys(v || {}).forEach(function (k) { if (SKIPV[k] || v[k] === UNRES) return; var kk = k === "rotate" ? "rotation" : k === "rotationZ" ? "rotation" : k; if (k === "autoAlpha") kk = "opacity"; o[kk] = v[k]; }); return o; }
  function staggerDelay(st, i, n) {
    if (st == null || st === UNRES) return 0;
    if (typeof st === "number") return st * i;
    if (typeof st === "object") {
      var each = num(st.each, NaN), amount = num(st.amount, NaN), from = st.from || 0, idx;
      if (!isFinite(each)) each = isFinite(amount) && n > 1 ? amount / (n - 1) : 0;
      if (from === "end") idx = n - 1 - i; else if (from === "center") idx = Math.abs(i - (n - 1) / 2); else if (typeof from === "number") idx = Math.abs(i - from); else idx = i;
      return each * idx;
    }
    return 0;
  }
  /* convierte las llamadas en segmentos {el, prop, t0, t1, from?, to, ease} en tiempo absoluto del timeline */
  function buildSegments(parsed, resolve) {
    var segs = [], labels = {}, end = 0, prevS = 0, prevE = 0, unresolved = [];
    var custom = parsed.eases || {};
    function pos(p) {
      if (p == null || p === UNRES) return { t: end };
      if (typeof p === "number") return { t: p };
      var s = String(p).trim(), m;
      if (s === "<") return { t: prevS }; if (s === ">") return { t: prevE };
      if ((m = /^<\s*([-+]?\d*\.?\d+)$/.exec(s))) return { t: prevS + +m[1] };
      if ((m = /^>\s*([-+]?\d*\.?\d+)$/.exec(s))) return { t: prevE + +m[1] };
      if ((m = /^([+-])=\s*(\d*\.?\d+)$/.exec(s))) return { t: end + (m[1] === "+" ? 1 : -1) * +m[2] };
      if ((m = /^([\w-]+)\s*(?:([+-])=\s*(\d*\.?\d+))?$/.exec(s))) { var lb = labels[m[1]]; if (lb == null) lb = end; return { t: lb + (m[2] ? (m[2] === "+" ? 1 : -1) * +m[3] : 0) }; }
      return { t: end };
    }
    parsed.calls.forEach(function (c) {
      if (c.m === "addLabel") { var lp = pos(c.args[1]); if (typeof c.args[0] === "string") labels[c.args[0]] = lp.t; return; }
      var target = c.args[0], v1 = c.args[1], v2 = c.m === "fromTo" ? c.args[2] : null, p = c.kind === "gsap" ? 0 : c.args[c.m === "fromTo" ? 3 : 2];
      if (target && typeof target === "object" && !Array.isArray(target) && target !== UNRES) return;
      var els = resolve(target);
      if (!els || !els.length) { unresolved.push(c); return; }
      var toV = c.m === "fromTo" ? v2 : v1, fromV = c.m === "fromTo" ? v1 : c.m === "from" ? v1 : null;
      if (!toV || typeof toV !== "object" || toV === UNRES) { unresolved.push(c); return; }
      var dur = c.m === "set" ? 0 : num(toV.duration, 0.5), delay = num(toV.delay, 0), st0 = pos(p).t + delay;
      if (c.kind === "chain" && p == null) st0 = end + delay;
      var ease = toV.ease != null && toV.ease !== UNRES ? toV.ease : (c.m === "set" ? "none" : "power1.out");
      var rep = Math.max(0, Math.min(200, num(toV.repeat, 0) === -1 ? 50 : num(toV.repeat, 0))), yoyo = !!toV.yoyo, rd = num(toV.repeatDelay, 0);
      var tEnd = st0;
      els.forEach(function (el, i) {
        var t0 = st0 + staggerDelay(toV.stagger, i, els.length);
        var add = function (prop, fromVal, toVal, a, b, e, imm) { segs.push({ el: el, prop: prop, t0: a, t1: b, from: fromVal, to: toVal, ease: e, imm: !!imm, n: segs.length }); };
        var kfs = toV.keyframes;
        if (kfs && kfs !== UNRES) {
          var tt = t0;
          if (Array.isArray(kfs)) {
            kfs.forEach(function (kf) { if (!kf || typeof kf !== "object") return; var d = num(kf.duration, dur / Math.max(1, kfs.length)), dl = num(kf.delay, 0); tt += dl; var pr = propsOf(kf), e = kf.ease != null ? kf.ease : (toV.easeEach != null ? toV.easeEach : "power1.out"); Object.keys(pr).forEach(function (q) { if (TPROPS[q]) add(q, null, pr[q], tt, tt + d, e); }); tt += d; });
          } else if (typeof kfs === "object") {
            var pk = Object.keys(kfs).filter(function (q) { return /%$/.test(q); });
            if (pk.length) {
              var ee = kfs.easeEach != null ? kfs.easeEach : "power1.inOut", last = {};
              pk.sort(function (a, b) { return parseFloat(a) - parseFloat(b); }).forEach(function (q) {
                var at = t0 + dur * parseFloat(q) / 100, pr2 = propsOf(kfs[q]), e2 = kfs[q].ease != null ? kfs[q].ease : ee;
                Object.keys(pr2).forEach(function (pp) { if (!TPROPS[pp]) return; var a0 = last[pp] != null ? last[pp] : t0; add(pp, null, pr2[pp], a0, at, e2); last[pp] = at; });
              });
            } else {
              var ee2 = kfs.easeEach != null ? kfs.easeEach : "none";
              Object.keys(kfs).forEach(function (pp) { var arr = kfs[pp]; if (!Array.isArray(arr) || !TPROPS[pp]) return; var stp = dur / Math.max(1, arr.length - 1); arr.forEach(function (val, ix) { if (ix === 0) add(pp, null, val, t0, t0, "none"); else add(pp, null, val, t0 + stp * (ix - 1), t0 + stp * ix, ee2); }); });
            }
            tt = t0 + dur;
          }
          tEnd = Math.max(tEnd, tt);
          return;
        }
        var props = propsOf(toV), fprops = fromV ? propsOf(fromV) : {};
        var keys = Object.keys(props).concat(Object.keys(fprops).filter(function (q) { return !(q in props); }));
        for (var r = 0; r <= rep; r++) {
          var rs = t0 + r * (dur + rd), back = yoyo && r % 2 === 1;
          keys.forEach(function (q) {
            if (!TPROPS[q]) return;
            var fv = q in fprops ? fprops[q] : null, tv = q in props ? props[q] : null;
            if (c.m === "from") { tv = null; }
            /* from(): va del valor dado al valor actual (null = «el que tenga») */
            if (back) add(q, tv, fv, rs, rs + dur, ease, false);
            else add(q, fv, tv, rs, rs + dur, ease, (c.m === "from" || c.m === "fromTo") && r === 0 && toV.immediateRender !== false);
          });
        }
        tEnd = Math.max(tEnd, t0 + (rep + 1) * dur + rep * rd);
      });
      prevS = st0; prevE = tEnd; end = Math.max(end, tEnd);
    });
    return { segs: segs, end: end, unresolved: unresolved, labels: labels };
  }
  /* valor de una propiedad en t: el último segmento que ya empezó manda (como el render de GSAP) */
  function makeEval(built, custom) {
    var by = new Map();
    built.segs.forEach(function (s) { var m = by.get(s.el); if (!m) { m = {}; by.set(s.el, m); } (m[s.prop] = m[s.prop] || []).push(s); });
    by.forEach(function (m) { Object.keys(m).forEach(function (p) { m[p].sort(function (a, b) { return a.t0 - b.t0 || a.n - b.n; }); }); });
    var cache = new Map();
    function ef(e) { var k = typeof e === "string" ? e : JSON.stringify(e); if (!cache.has(k)) cache.set(k, easeFn(e, custom)); return cache.get(k); }
    function valueAt(el, prop, t, base) {
      var m = by.get(el), L = m && m[prop]; if (!L || !L.length) return base;
      /* antes del primer segmento: un from()/fromTo() se pinta de inmediato con su valor inicial */
      if (t < L[0].t0) { var f = L[0]; return f.imm && f.from != null ? f.from : base; }
      var cur = base, i;
      for (i = 0; i < L.length && L[i].t0 <= t; i++) {
        var s = L[i], a = s.from != null ? s.from : cur, b = s.to != null ? s.to : (s.from != null ? base : cur);
        if (s.to == null && s.from != null) { a = s.from; b = base; }
        a = relVal(a, cur); b = relVal(b, a);
        if (t >= s.t1 || s.t1 <= s.t0) cur = b;
        else cur = lerpVal(a, b, ef(s.ease)((t - s.t0) / (s.t1 - s.t0)));
      }
      return cur;
    }
    return { valueAt: valueAt, has: function (el) { return by.has(el); }, props: function (el) { var m = by.get(el); return m ? Object.keys(m) : []; }, segs: function (el) { return by.get(el) || {}; } };
  }
  /* «+=50» / «-=10»: relativo al valor anterior */
  function relVal(v, prev) {
    if (typeof v !== "string") return v;
    var m = /^([+-])=\s*(-?[\d.]+)/.exec(v.trim()); if (!m) return v;
    var p = num(prev, 0); return m[1] === "+" ? p + +m[2] : p - +m[2];
  }
  function numParts(s) { return String(s).match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []; }
  function lerpVal(a, b, q) {
    if (typeof a === "number" && typeof b === "number") return a + (b - a) * q;
    var na = num(a, NaN), nb = num(b, NaN);
    if (typeof a !== "string" && typeof b !== "string" && isFinite(na) && isFinite(nb)) return na + (nb - na) * q;
    if (typeof a === "string" && typeof b === "string") {
      var pa = numParts(a), pb = numParts(b), sa = a.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, "#"), sb = b.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, "#");
      if (sa === sb && pa.length === pb.length) { var k = 0; return sa.replace(/#/g, function () { var v = +pa[k] + (+pb[k] - +pa[k]) * q; k++; return String(r3(v)); }); }
      if (/^-?\d/.test(a) && /^-?\d/.test(b) && isFinite(na) && isFinite(nb)) return na + (nb - na) * q;
      return q < 1 ? a : b;
    }
    if (isFinite(na) && isFinite(nb)) return na + (nb - na) * q;
    return q < 1 ? (a != null ? a : b) : b;
  }
  function blurOf(f) { var m = /blur\(\s*(-?[\d.]+)px\s*\)/.exec(String(f || "")); return m ? +m[1] : 0; }

  /* ───────────── muestras → keyframes (Ramer-Douglas-Peucker en varias dimensiones) ───────────── */
  var TOL = { x: 0.5, y: 0.5, xPercent: 0.05, yPercent: 0.05, rotation: 0.15, scale: 0.002, scaleX: 0.002, scaleY: 0.002, opacity: 0.004, blur: 0.25, z: 0.5, s: 0.002, r: 0.15, o: 0.004, b: 0.25 };
  function rdp(times, dims, tol) {
    var n = times.length; if (n <= 2) return times.map(function (_, i) { return i; });
    var keep = new Array(n); keep[0] = keep[n - 1] = true;
    var stack = [[0, n - 1]];
    while (stack.length) {
      var seg = stack.pop(), a = seg[0], b = seg[1], worst = -1, wi = -1;
      for (var i = a + 1; i < b; i++) {
        var u = (times[i] - times[a]) / ((times[b] - times[a]) || 1), err = 0;
        for (var d = 0; d < dims.length; d++) { var A = dims[d].v; var e = Math.abs(A[i] - (A[a] + (A[b] - A[a]) * u)) / (dims[d].tol || tol); if (e > err) err = e; }
        if (err > worst) { worst = err; wi = i; }
      }
      if (worst > 1) { keep[wi] = true; stack.push([a, wi], [wi, b]); }
    }
    var out = []; for (var j = 0; j < n; j++) if (keep[j]) out.push(j);
    return out;
  }
  /* un valor de texto con números (clip-path, filtros…): si su forma no cambia, sus números son dimensiones */
  function strDims(arr) {
    var shape = null, ok = true, cols = [];
    arr.forEach(function (s, i) { var sh = String(s).replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, "#"); if (shape == null) shape = sh; else if (sh !== shape) ok = false; var p = numParts(s); p.forEach(function (x, k) { (cols[k] = cols[k] || [])[i] = +x; }); });
    return ok ? { shape: shape, cols: cols } : null;
  }
  function fromShape(shape, vals) { var k = 0; return shape.replace(/#/g, function () { return fmtN(vals[k++]); }); }

  /* tracks: { prop: [valores por muestra] } → { set: {…}, kfs: [{…, duration}] } con tiempos absolutos */
  function compressTracks(times, tracks) {
    var dims = [], strs = {}, statics = {}, changing = [];
    Object.keys(tracks).forEach(function (p) {
      var A = tracks[p], same = A.every(function (v) { return v === A[0] || (typeof v === "number" && typeof A[0] === "number" && Math.abs(v - A[0]) < 1e-6); });
      if (same) { statics[p] = A[0]; return; }
      changing.push(p);
      if (A.every(function (v) { return typeof v === "number"; })) dims.push({ p: p, v: A, tol: TOL[p] || 0.01 });
      else {
        var sd = strDims(A);
        if (sd) { strs[p] = sd; sd.cols.forEach(function (col, k) { dims.push({ p: p + "#" + k, v: col, tol: 0.05 }); }); }
        else { strs[p] = { step: true }; dims.push({ p: p + "#step", v: A.map(function (v, i) { return i > 0 && A[i] !== A[i - 1] ? 1e9 : 0; }), tol: 1 }); }
      }
    });
    var idx = changing.length ? rdp(times, dims, 1) : [0];
    /* los cambios de golpe (display, valores de texto sin forma común) se conservan con su instante y el anterior */
    Object.keys(strs).forEach(function (p) { if (!strs[p].step) return; var A = tracks[p]; for (var i = 1; i < A.length; i++) if (A[i] !== A[i - 1]) { if (idx.indexOf(i) < 0) idx.push(i); if (idx.indexOf(i - 1) < 0) idx.push(i - 1); } });
    idx.sort(function (a, b) { return a - b; });
    var valAt = function (p, i) { return tracks[p][i]; };
    var first = {}; changing.forEach(function (p) { first[p] = valAt(p, idx[0]); });
    var kfs = [];
    for (var k = 1; k < idx.length; k++) {
      var i0 = idx[k - 1], i1 = idx[k], o = {};
      changing.forEach(function (p) { var v = valAt(p, i1); if (v !== valAt(p, i0)) o[p] = v; });
      var d = times[i1] - times[i0];
      if (!Object.keys(o).length) {
        /* pausa: se repiten los valores (estirar el keyframe anterior cambiaría su velocidad) */
        if (!kfs.length) { kfs.push({ duration: d }); continue; }
        changing.forEach(function (p) { o[p] = valAt(p, i1); });
      }
      o.duration = d; kfs.push(o);
    }
    return { statics: statics, first: first, kfs: kfs, t0: times[idx[0]] };
  }

  /* ───────────── emisión de código ───────────── */
  function objLit(o) {
    var ks = Object.keys(o); if (!ks.length) return "{}";
    return "{ " + ks.map(function (k) { var v = o[k]; return (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)) + ": " + (typeof v === "number" ? fmtN(v) : typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v)); }).join(", ") + " }";
  }
  /* bloque muestreado: tl.set con el primer cuadro + tl.to con keyframes en línea recta (exacto al render del editor) */
  function emitTracks(sel, times, tracks, startT) {
    var c = compressTracks(times, tracks), lines = [];
    var set0 = Object.assign({}, c.statics, c.first);
    if (Object.keys(set0).length) lines.push("tl.set(" + jsStr(sel) + ", " + objLit(set0) + ", " + fmtN(r3(startT)) + ");");
    var real = c.kfs.filter(function (k) { return Object.keys(k).length > 1; });
    if (real.length) {
      var pre = c.t0 - startT, list = c.kfs.slice();
      if (list.length && Object.keys(list[0]).length === 1) { pre += list[0].duration; list.shift(); }
      lines.push("tl.to(" + jsStr(sel) + ", { keyframes: [");
      list.forEach(function (k, i) { var o = Object.assign({}, k); var d = o.duration; delete o.duration; o.duration = r3(d); o.ease = "none"; lines.push("  " + objLit(o) + (i < list.length - 1 ? "," : "")); });
      lines.push("] }, " + fmtN(r3(startT + pre)) + ");");
    }
    return lines;
  }

  /* curvas del editor ↔ GSAP (lo que tiene equivalente exacto) */
  var KF_EASE = { lin: "none", smooth: "power2.inOut", "in": "power2.in", out: "power2.out" };
  function kfEase(k, c, i, kf) {
    var e = k.e && k.e !== "auto" ? k.e : (c.curve ? "lin" : "smooth");
    if (KF_EASE[e]) return { g: KF_EASE[e] };
    if (e === "bezier") { var n = String(k.bz || "0.34, 1.56, 0.64, 1").split(/[\s,]+/).filter(Boolean).map(Number); if (n.length === 4 && n.every(isFinite)) return { g: "musaBz" + n.map(function (x) { return String(r3(x)).replace("-", "m").replace(".", "_"); }).join("x"), bz: n }; }
    return null;
  }

  /* ───────────── modelo del proyecto ───────────── */
  function durOf(p) {
    if (+p.total > 0) return +p.total;
    var m = 5;
    ["v1", "m", "t", "a"].forEach(function (k) { (p[k] || []).forEach(function (c) { m = Math.max(m, (+c.start || 0) + (+c.dur || 0)); }); });
    return r3(m);
  }
  function relayoutV1(p) { var s = 0; (p.v1 || []).forEach(function (c) { c.start = r3(s); s += +c.dur || 0; }); }
  var VOLATILE = { _row: 1, _s: 1, _seg: 1, _mat: 1, _pm: 1, _ps: 1 };
  function clipData(c, omit) {
    var o = {};
    Object.keys(c).forEach(function (k) { if (VOLATILE[k] || (omit && omit[k])) return; o[k] = c[k]; });
    return o;
  }
  /* las mismas pilas de fuentes que el editor (FONTS de la maqueta y las de Google Fonts que suma el editor pro) */
  var FONTS0 = { Inter: "Inter,sans-serif", Anton: "Anton,Impact,sans-serif", Georgia: "Georgia,serif", Mono: "'JetBrains Mono','Courier New',monospace", "JetBrains Mono": "'JetBrains Mono',monospace" };
  function fontCss(name, env) { var F = env && env.fonts; name = name || "Inter"; if (F && F[name]) return F[name]; if (FONTS0[name]) return FONTS0[name]; return "'" + String(name).replace(/'/g, "") + "'," + (/mono/i.test(name) ? "monospace" : /playfair|lora/i.test(name) ? "serif" : "sans-serif"); }
  function urlOf(bg) { var m = String(bg || "").match(/url\(["']?([^"')]+)["']?\)/); return m ? m[1] : null; }

  /* estilo fijo de cada clip (lo mismo que dibuja el editor) */
  function tCss(c, env, fs) {
    var outer = cssStr([["left", r2(num(c.x, 50)) + "%"], ["top", r2(num(c.y, 82)) + "%"], ["font-family", fontCss(c.font, env)], ["font-size", r2(fs) + "px"], ["font-weight", c.weight || 800], ["color", c.color || "#ffffff"],
      ["letter-spacing", c.ls ? r2(+c.ls) + "px" : ""], ["font-style", c.italic ? "italic" : ""], ["white-space", c.autofit === false && !c.exact ? "pre-wrap" : "pre"], ["max-width", c.autofit === false && !c.exact ? "90%" : ""]]);
    var gr = c.glowR != null ? +c.glowR : 24, g = c.glow || (c.fx === "glow" ? (c.color || "#ffffff") : "");
    var inner = cssStr([["background", c.bg || ""], ["padding", c.bg ? ".2em .55em" : ""], ["border-radius", c.bg ? ".35em" : ""],
      ["text-shadow", g ? "0 0 " + r2(gr * 0.4) + "px " + g + ",0 0 " + gr + "px " + g + ",0 0 " + r2(gr * 2) + "px " + g : ""]]);
    return { outer: outer, inner: inner };
  }
  function mCss(c, env) {
    var bg = c.grad && env.gradCss ? env.gradCss(c.grad) : (c.svg || c.vshape ? "none" : c.bg || "transparent");
    var gr = c.glowR != null ? +c.glowR : 24, g = c.glow || (c.fx === "glow" ? (c.color || "#ffffff") : "");
    var af = c.adj && env.adjFilter ? env.adjFilter(c, 0) : "";
    var outer = c.adj ? cssStr([["left", "50%"], ["top", "50%"], ["width", "100%"], ["height", "100%"], ["backdrop-filter", af || ""], ["-webkit-backdrop-filter", af || ""]])
      : cssStr([["left", r2(num(c.x, 50)) + "%"], ["top", r2(num(c.y, 50)) + "%"], ["width", r2(num(c.w, 40)) + "%"], ["aspect-ratio", String(r3(num(c.ar, 1)))]]);
    var inner = c.adj ? ""
      : cssStr([["background", bg], ["border-radius", c.shape === "circle" ? "50%" : (+c.radius || 0) + "px"], ["filter", g ? "drop-shadow(0 0 " + gr + "px " + g + ")" : ""]]);
    return { outer: outer, inner: inner };
  }
  function svgFor(c, env) {
    var raw = c.vshape ? (env.shapeSvg ? env.shapeSvg(c.vshape) : "") : c.svg ? (env.recolor ? env.recolor(c.svg, c.svgMap) : c.svg) : "";
    if (!raw) return "";
    return String(raw).replace(/<\?xml[^>]*>/i, "").replace(/<svg\b([^>]*)>/i, function (m, at) {
      var a = at.replace(/\s(width|height|preserveAspectRatio)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
      return "<svg" + a + ' width="100%" height="100%" preserveAspectRatio="xMidYMid meet">';
    });
  }

  /* ── bloque de un clip: { html, js, fp } ── */
  /* JSON con las claves ordenadas: la misma huella en el editor y en el servidor, venga el clip de donde venga */
  function stable(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
    return "{" + Object.keys(v).filter(function (k) { return v[k] !== undefined; }).sort().map(function (k) { return JSON.stringify(k) + ":" + stable(v[k]); }).join(",") + "}";
  }
  function clipFp(kind, c, p, extra) {
    return hash(kind + "|" + stable(clipData(c)) + "|" + p.W + "x" + p.H + "|" + (p.persp || "") + "|" + stable(p.gtr || null) + "|" + (extra || ""));
  }
  function blockWrap(id, label, lines) {
    var body = lines.join("\n");
    return "  // ▸ " + id + " · " + label.replace(/[\r\n]+/g, " ").slice(0, 48) + " #" + hash(normJs(body)) + "\n" + body.split("\n").map(function (l) { return l ? "  " + l : l; }).join("\n") + "\n  // ◂ " + id;
  }
  function normJs(s) { return String(s).replace(/\s+/g, ""); }

  /* movimiento «semántico» de un texto o media: entrada en .in, keyframes en el elemento, salida del texto en .in */
  var ENTRY = {
    fade: function (d) { return [[{ opacity: 0 }, { opacity: 1, duration: d, ease: "power2.out" }]]; },
    "slide-up": function (d) { return [[{ opacity: 0, y: 120 }, { opacity: 1, y: 0, duration: d, ease: "power2.out" }]]; },
    "slide-down": function (d) { return [[{ opacity: 0, y: -120 }, { opacity: 1, y: 0, duration: d, ease: "power2.out" }]]; },
    "slide-left": function (d) { return [[{ opacity: 0, x: -220 }, { opacity: 1, x: 0, duration: d, ease: "power2.out" }]]; },
    "zoom-in": function (d) { return [[{ opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: d, ease: "power2.out" }]]; },
    pop: function (d) { return [[{ opacity: 0 }, { opacity: 1, duration: d / 3, ease: "none" }], [{ scale: 0.3 }, { scale: 1, duration: d, ease: "back.out(1.7)" }]]; },
    "bounce-in": function (d) { return [[{ opacity: 0 }, { opacity: 1, duration: d / 3, ease: "none" }], [{ y: -260 }, { y: 0, duration: d, ease: "back.out(1.7)" }]]; },
    "blur-in": function (d) { return [[{ opacity: 0, filter: "blur(24px)" }, { opacity: 1, filter: "blur(0px)", duration: d, ease: "power2.out" }]]; },
    "rotate-in": function (d) { return [[{ opacity: 0, rotation: -90, scale: 0.8 }, { opacity: 1, rotation: 0, scale: 1, duration: d, ease: "power2.out" }]]; },
  };
  function semanticMotion(kind, c, id, env) {
    var lines = [], start = +c.start || 0, dur = +c.dur || 0, eD = +c.enD > 0 ? +c.enD : 0.5, sel = "#" + id;
    var cam = env.model && env.model.gtr && env.model.gtr.__cam;
    var hard = cam || c.orb || c.path || c.anim === "stack" || (c.fx && c.fx !== "none" && c.fx !== "glow") || c.expr || +c.mbA > 0 || c.grp || c.morphClip || c.curve || c.mask || c.matte || c.adj || c.hideM;
    if (hard) return null;
    if (c.kf && c.kf.some(function (k) { return k.z || k.p != null || k.b; })) return null;
    var an = kind === "t" ? (c.anim || "pop") : (c.anim || "fade");
    if (["words", "typewriter", "none"].indexOf(an) < 0 && !ENTRY[an] && an !== "fly-in") return null;
    if (an === "fly-in") return null;
    /* opacidad propia de la media: se aplica en el elemento (multiplica a la entrada) */
    var base = {};
    if (kind === "m" && c.opacity != null && +c.opacity !== 1) base.opacity = +c.opacity;
    var kf = (c.kf || []).filter(function (k) { return isFinite(+k.t); }).slice().sort(function (a, b) { return a.t - b.t; });
    var eases = [];
    if (kf.length) {
      var k0 = kf[0], v0 = { x: num(k0.x, 0), y: num(k0.y, 0), rotation: num(k0.r, 0), scale: num(k0.s, 1), opacity: num(k0.o, 1) * (base.opacity != null ? base.opacity : 1) };
      lines.push("tl.set(" + jsStr(sel) + ", " + objLit(v0) + ", " + fmtN(r3(start)) + ");");
      for (var i = 1; i < kf.length; i++) {
        var a = kf[i - 1], b = kf[i], e = kfEase(a, c, i, kf); if (!e) return null;
        if (e.bz) eases.push(e);
        var to = {}, A = { x: num(a.x, 0), y: num(a.y, 0), rotation: num(a.r, 0), scale: num(a.s, 1), opacity: num(a.o, 1) }, B = { x: num(b.x, 0), y: num(b.y, 0), rotation: num(b.r, 0), scale: num(b.s, 1), opacity: num(b.o, 1) };
        Object.keys(B).forEach(function (q) { if (Math.abs(B[q] - A[q]) > 1e-6) to[q] = q === "opacity" && base.opacity != null ? B[q] * base.opacity : B[q]; });
        var d = r3(b.t - a.t); if (!(d > 0)) continue;
        if (!Object.keys(to).length) continue;
        to.duration = d; to.ease = e.g;
        lines.push("tl.to(" + jsStr(sel) + ", " + objLit(to) + ", " + fmtN(r3(start + a.t)) + ");");
      }
    } else if (base.opacity != null) lines.push("tl.set(" + jsStr(sel) + ", " + objLit(base) + ", " + fmtN(r3(start)) + ");");
    var inSel = sel + " .in";
    if (ENTRY[an]) ENTRY[an](r3(eD)).forEach(function (pair) { lines.push("tl.fromTo(" + jsStr(inSel) + ", " + objLit(pair[0]) + ", " + objLit(pair[1]) + ", " + fmtN(r3(start)) + ");"); });
    /* salida automática del texto: se desvanece en los últimos 0,25 s */
    if (kind === "t" && !c.morphClip) lines.push("tl.fromTo(" + jsStr(inSel) + ", { opacity: 1 }, { opacity: 0, duration: " + fmtN(r3(Math.min(0.25, dur))) + ", ease: \"none\" }, " + fmtN(r3(start + dur - Math.min(0.25, dur))) + ");");
    return { lines: lines, eases: eases };
  }
  /* revelado por letras o por palabras (Máquina / Palabra por palabra): tl.set de display en los spans */
  function revealLines(id, c, counts) {
    var lines = [], mode = c.anim === "words" ? "w" : "ch", prev = -1;
    counts.forEach(function (q) { if (q.n !== prev) { lines.push("tl.set(" + jsStr("#" + id + " .in > i:nth-child(-n+" + Math.max(0, q.n) + ")") + ", { display: \"inline\" }, " + fmtN(r3(q.t)) + ");"); prev = q.n; } });
    return { lines: lines.filter(function (l) { return !/-n\+0\)/.test(l); }), mode: mode };
  }

  /* ── documento ── */
  function fontsLink(model, env) {
    var fam = {};
    (model.t || []).forEach(function (c) { var f = String(c.font || "Inter"); if (/^(Mono)$/.test(f)) f = "JetBrains Mono"; if (/^(Georgia)$/.test(f)) return; fam[f] = 1; });
    (model.v1 || []).forEach(function (c) { var sc = c.scene; if (sc && sc.els) sc.els.forEach(function (e) { if (e.type === "text" && e.font && e.font !== "Georgia") fam[e.font === "Mono" ? "JetBrains Mono" : e.font] = 1; }); });
    var names = Object.keys(fam).filter(function (f) { return /^[A-Za-z0-9 ]{2,40}$/.test(f); });
    if (!names.length) return "";
    return '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?' + names.map(function (f) { return "family=" + f.replace(/ /g, "+") + (/^(Anton|Bebas Neue|Archivo Black)$/.test(f) ? "" : ":wght@400;500;600;700;800;900"); }).join("&") + '&display=swap">';
  }
  var PLAYER = [
    "  /* reproductor: abierto en el navegador (fuera de HyperFrames) el video se reproduce solo; clic = pausa */",
    "  (function () {",
    "    if (window.__hyperframes || navigator.webdriver) return;",
    "    var root = document.getElementById(\"root\"), W = +root.dataset.width, H = +root.dataset.height, D = +root.dataset.duration;",
    "    var timed = [].slice.call(root.querySelectorAll(\"[data-start]\")), t0 = performance.now(), paused = false, at = 0;",
    "    function fit() { var s = Math.min(innerWidth / W, innerHeight / H); root.style.transform = \"scale(\" + s + \")\"; root.style.margin = ((innerHeight - H * s) / 2) + \"px 0 0 \" + ((innerWidth - W * s) / 2) + \"px\"; }",
    "    function show(t) {",
    "      tl.time(t);",
    "      if (window.__musaLiveSeek) window.__musaLiveSeek(t);",
    "      timed.forEach(function (el) {",
    "        var s = +el.dataset.start || 0, d = +el.dataset.duration || D, on = t >= s && t < s + d && !el.hasAttribute(\"data-hidden\");",
    "        el.style.visibility = on ? \"\" : \"hidden\";",
    "        if (el.tagName === \"VIDEO\" || el.tagName === \"AUDIO\") {",
    "          var mt = (+el.dataset.mediaStart || 0) + (t - s) * (+el.dataset.playbackRate || 1);",
    "          if (!on || paused) { if (!el.paused) el.pause(); if (on) el.currentTime = mt; return; }",
    "          el.playbackRate = +el.dataset.playbackRate || 1; el.volume = Math.min(1, +el.dataset.volume || 1);",
    "          if (Math.abs(el.currentTime - mt) > 0.25) el.currentTime = mt;",
    "          if (el.paused) el.play().catch(function () {});",
    "        }",
    "      });",
    "    }",
    "    function loop() { if (!paused) at = ((performance.now() - t0) / 1000) % D; show(at); requestAnimationFrame(loop); }",
    "    addEventListener(\"resize\", fit); fit();",
    "    document.addEventListener(\"click\", function () { paused = !paused; if (!paused) t0 = performance.now() - at * 1000; });",
    "    loop();",
    "  })();",
  ];
  var HELPERS = [
    "  /* ayudantes de Musa: parten un texto en letras o palabras para revelarlas, y arman el morph de un texto en otro */",
    "  function musaSplit(sel, mode) { document.querySelectorAll(sel).forEach(function (el) { var tx = el.textContent, parts = mode === \"w\" ? tx.match(/\\s*\\S+|\\s+$/g) || [] : Array.from(tx); el.textContent = \"\"; parts.forEach(function (p) { var i = document.createElement(\"i\"); i.textContent = p; i.style.cssText = \"font-style:inherit;display:none\"; el.appendChild(i); }); }); }",
    "  function musaMorph(sel) { document.querySelectorAll(sel).forEach(function (el) { var a = el.textContent, b = el.dataset.morphTo || \"\"; el.innerHTML = \"\"; el.style.display = \"inline-grid\"; el.style.placeItems = \"center\"; [[\"ma\", a], [\"mb\", b]].forEach(function (x) { var s = document.createElement(\"span\"); s.className = x[0]; s.textContent = x[1]; s.style.gridArea = \"1/1\"; el.appendChild(s); }); }); }",
  ];

  /* modelo + bloques → documento HTML completo */
  function assemble(model, blocks, env) {
    env = env || {};
    var W = model.W, H = model.H, D = durOf(model), bgCss = model.grad && env.gradCss ? env.gradCss(model.grad) : (model.pad || "#000000");
    var proj = { fmt: model.fmt, fps: model.fps || 30, pad: model.pad || "#000000", grad: model.grad || null, total: model.total || null, persp: model.persp || null, gtr: model.gtr || null, markers: model.markers || null, name: model.name || "Video" };
    var anyCE = false, eases = {};
    blocks.forEach(function (b) { (b.eases || []).forEach(function (e) { eases[e.g] = e.bz; anyCE = true; }); });
    var html = [], js = [];
    html.push("<!doctype html>", '<html lang="es">', "<head>", '<meta charset="utf-8">', '<meta name="viewport" content="width=device-width, initial-scale=1">', '<meta name="generator" content="Musa Video Code ' + VERSION + '">',
      "<title>" + escH(model.name || "Video") + "</title>",
      "<!-- Musa Video Code: este video es código y el código es el video.",
      "     · Pégalo en Musa (Crear › Videos › Desde código, o el panel «Código» del editor) y vuelve como clips editables.",
      "     · Se reproduce en cualquier navegador y se renderiza con HyperFrames (npx hyperframes render).",
      "     · Cada clip es un elemento con data-start / data-duration; su movimiento está en el bloque «▸ id» del script.",
      "     · Si cambias un bloque, en Musa manda tu código; si no lo tocas, vuelven los parámetros de Musa (data-musa). -->");
    var fl = fontsLink(model, env); if (fl) html.push(fl);
    html.push('<script src="' + GSAP_URL + '"></script>');
    if (anyCE) html.push('<script src="' + CE_URL + '"></script>');
    html.push("<style>",
      "  html, body { margin: 0; height: 100%; background: #0b0b0b; overflow: hidden; }",
      "  #root { position: relative; overflow: hidden; transform-origin: 0 0; }",
      "  #root .clip { position: absolute; inset: 0; }",
      "  #root .v1 { position: absolute; inset: 0; overflow: hidden; }",
      "  #root .v1 > .fill { position: absolute; inset: 0; overflow: hidden; }",
      "  #root .v1 video { position: absolute; inset: 0; width: 100%; height: 100%; }",
      "  #root .scene { position: absolute; transform-origin: 0 0; overflow: hidden; }",
      "  #root .scene .l { position: absolute; box-sizing: border-box; white-space: pre-wrap; overflow-wrap: break-word; }",
      "  #root .ovl { position: absolute; inset: 0; pointer-events: none; }",
      "  #root .t { position: absolute; text-align: center; line-height: 1.1; width: max-content; box-sizing: border-box; }",
      "  #root .t .in { display: block; }",
      "  #root .m { position: absolute; }",
      "  #root .m .in { position: absolute; inset: 0; overflow: visible; }",
      "  #root .m svg { display: block; overflow: visible; }",
      "</style>", "</head>", "<body>");
    html.push('<div id="root" data-composition-id="main" data-start="0" data-duration="' + fmtN(D) + '" data-width="' + W + '" data-height="' + H + '" data-fps="' + (model.fps || 30) + '" data-musa-video="' + VERSION + '"'
      + " data-musa='" + escQ(JSON.stringify(proj)) + "'"
      + ' style="width:' + W + "px;height:" + H + "px;background:" + escA(bgCss) + '">');
    var sec = { v1: "Tomas y escenas (V1)", m: "Media (M)", t: "Textos (T)", a: "Audio (A)" }, lastK = null;
    blocks.forEach(function (b) { if (b.k !== lastK) { html.push("  <!-- " + sec[b.k] + " -->"); lastK = b.k; } html.push(b.live ? b.html : b.html.split("\n").map(function (l) { return "  " + l; }).join("\n")); });
    html.push("</div>");
    js.push("<script>", "  window.__timelines = window.__timelines || {};");
    js = js.concat(HELPERS);
    Object.keys(eases).forEach(function (g) { var n = eases[g]; js.push("  CustomEase.create(" + jsStr(g) + ", \"M0,0 C" + fmtN(n[0]) + "," + fmtN(n[1]) + " " + fmtN(n[2]) + "," + fmtN(n[3]) + " 1,1\");"); });
    if (anyCE) js.splice(2, 0, "  gsap.registerPlugin(CustomEase);");
    blocks.forEach(function (b) { (b.pre || []).forEach(function (l) { js.push("  " + l); }); });
    js.push("  gsap.set(\"#root .t, #root .m\", { xPercent: -50, yPercent: -50 });");
    js.push("  const tl = gsap.timeline({ paused: true });");
    blocks.forEach(function (b) { if (b.js) js.push(b.js); });
    js.push("  tl.set({}, {}, " + fmtN(D) + ");");
    js.push("  window.__timelines[\"main\"] = tl;");
    js = js.concat(PLAYER);
    js.push("</script>");
    var liveJs = [], MY = MLv();
    if (MY && blocks.some(function (b) { return b.live; })) liveJs = ["<!-- Código vivo (Three.js, p5, WebGL, canvas, Remotion 3D): cada clip corre su código en un iframe aislado; en HyperFrames responde a hf-seek -->", '<script data-musa-runtime="live">', MY.driverScript(), "</script>"];
    return html.concat(js, liveJs, ["</body>", "</html>", ""]).join("\n");
  }

  /* una toma con transición se ve d/2 antes de su corte de entrada y d/2 después del de salida */
  function v1Win(model, i) {
    var L = model.v1 || [], c = L[i], prev = L[i - 1], next = L[i + 1];
    return { pre: prev && prev.trans && +prev.trans.d > 0 ? r3(+prev.trans.d / 2) : 0, post: next && c && c.trans && +c.trans.d > 0 ? r3(+c.trans.d / 2) : 0 };
  }
  function zBase(c) { return 1000 + (+c.zi || 0) * 100000; }
  /* bloques que no necesitan muestrear el editor (servidor, o clips simples en el navegador) */
  function staticBlock(kind, c, model, env, i) {
    /* el SVG va dentro del HTML (se ve y se edita ahí); en data-musa solo si tiene recoloreo (para no perder los colores originales) */
    var keepSvg = c.svgMap && Object.keys(c.svgMap).length;
    var id = kind + "-" + safeId(c.id), data = clipData(c, kind === "m" && (c.svg || c.vshape) && !keepSvg ? { svg: 1 } : null);
    var start = r3(+c.start || 0), dur = r3(+c.dur || 0), b = { k: kind, id: id, cid: c.id, fp: clipFp(kind, c, model), pre: [], eases: [] };
    if (kind === "t") {
      var fs = env.fitSize ? env.fitSize(c) : num(c.size, 64);
      data._fs = r2(fs);
      var css = tCss(c, env, fs), txt = String(c.text == null ? "" : c.text);
      b.html = '<div class="clip" id="' + id + '-c" data-start="' + fmtN(start) + '" data-duration="' + fmtN(dur) + '" data-track-index="3" style="z-index:' + zBase(c) + '">'
        + '<div id="' + id + '" class="t" style="' + escA(css.outer) + '"' + (c.morphTo ? ' data-morph-to="' + escA(c.morphTo) + '"' : "") + " data-musa='" + escQ(JSON.stringify(data)) + "'>"
        + '<div class="in"' + (css.inner ? ' style="' + escA(css.inner) + '"' : "") + ">" + escH(txt) + "</div></div></div>";
      if (c.anim === "typewriter" || c.anim === "words") b.pre.push("musaSplit(" + jsStr("#" + id + " .in") + ", " + jsStr(c.anim === "words" ? "w" : "ch") + ");");
      if (c.morphTo) b.pre.push("musaMorph(" + jsStr("#" + id + " .in") + ");");
    } else if (kind === "m") {
      var mc = mCss(c, env), sv = svgFor(c, env), liveH = "";
      if (sv) data._sv = hash(sv.replace(/\s+/g, " ").trim());
      if (c.hideM) mc.outer += ";display:none";
      /* código vivo: <canvas class="musa-live"> y el código al lado, legible (los valores cambiados en Musa ya escritos) */
      if (c.live) {
        var MX = MLv(), lv = c.live, meta = MX ? MX.liveMeta(lv) : clipData(lv, { src: 1 });
        if (MX && !(+meta.W > 0 && +meta.H > 0)) { var wh = MX.liveSize(c, model.W, model.H); meta.W = wh[0]; meta.H = wh[1]; }
        var code = MX ? MX.bakedSrc(lv) : String(lv.src || "");
        data.live = meta;
        liveH = '<canvas class="musa-live" data-kind="' + escA(lv.kind || "html") + '" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block"></canvas>'
          + '<script type="text/musa-live">\n' + (MX ? MX.escScript(code) : code.replace(/<\/script/gi, "<\\/script")) + "\n<\/script>";
        b.live = true;
      }
      b.html = '<div class="clip" id="' + id + '-c" data-start="' + fmtN(start) + '" data-duration="' + fmtN(dur) + '" data-track-index="2" style="z-index:' + zBase(c) + '">'
        + '<div id="' + id + '" class="m' + (c.adj ? " adj" : "") + '" style="' + escA(mc.outer) + "\" data-musa='" + escQ(JSON.stringify(data)) + "'>"
        + '<div class="in" style="' + escA(mc.inner) + '">' + sv + liveH + "</div></div></div>";
    } else if (kind === "a") {
      b.html = '<audio id="' + id + '" class="clip" src="' + escA(c.url || "") + '" data-start="' + fmtN(start) + '" data-duration="' + fmtN(dur) + '" data-media-start="' + fmtN(r3(+c.in || 0)) + '" data-volume="' + fmtN(c.vol != null ? +c.vol : 1) + '"'
        + (+c.fin ? ' data-fade-in="' + fmtN(+c.fin) + '"' : "") + (+c.fout ? ' data-fade-out="' + fmtN(+c.fout) + '"' : "") + ' data-track-index="4"' + " data-musa='" + escQ(JSON.stringify(data)) + "'></audio>";
    } else if (kind === "v1") {
      var W = model.W, H = model.H, lookF = env.lookCss ? env.lookCss(c.look, c.lookK) : "", wn = v1Win(model, i);
      var inner = "", xs = r3(start - wn.pre), xd = r3(dur + wn.pre + wn.post);
      if (wn.pre || wn.post) { data._pre = wn.pre; data._post = wn.post; }
      if (c.kind === "take") {
        var u = c.takeUrl || "";
        inner = '<video class="clip" src="' + escA(u) + '" data-start="' + fmtN(xs) + '" data-duration="' + fmtN(xd) + '" data-media-start="' + fmtN(r3(Math.max(0, (+c.in || 0) - wn.pre * (+c.speed || 1)))) + '" data-playback-rate="' + fmtN(+c.speed || 1) + '" data-track-index="0"'
          + (c.vol === 0 ? " muted" : ' data-has-audio="true" data-volume="' + fmtN(c.vol != null ? +c.vol : 1) + '"') + ' playsinline style="object-fit:' + (c.fit === "contain" ? "contain" : "cover") + '"></video>';
      } else {
        var sc = c.scene || { w: W, h: H, bg: "transparent", els: [] }, s = c.fit === "cover" ? Math.max(W / sc.w, H / sc.h) : Math.min(W / sc.w, H / sc.h);
        inner = '<div class="clip" data-start="' + fmtN(xs) + '" data-duration="' + fmtN(xd) + '" data-track-index="0"><div class="scene" style="left:' + r2((W - sc.w * s) / 2) + "px;top:" + r2((H - sc.h * s) / 2) + "px;width:" + sc.w + "px;height:" + sc.h + "px;background:" + escA(sc.bg || "transparent") + ";transform:scale(" + r3(s) + ')">'
          + (sc.els || []).map(function (e, li) { return env.elHtml ? env.elHtml(e, id + "-l" + li) : '<div class="l" id="' + id + "-l" + li + '" style="left:' + e.x + "px;top:" + e.y + "px;width:" + e.w + "px;height:" + e.h + "px;background:" + escA(e.fill || "transparent") + '">' + (e.type === "text" ? escH(e.text) : "") + "</div>"; }).join("")
          + "</div></div>";
      }
      b.html = '<div id="' + id + '" class="v1"' + " data-musa='" + escQ(JSON.stringify(data)) + "'><div class=\"fill\"" + (lookF ? ' style="filter:' + escA(lookF) + '"' : "") + ">" + inner + "</div>" + (c.ovl && c.ovl !== "none" && env.ovlCss ? '<i class="ovl" style="' + escA(env.ovlCss(c.ovl)) + '"></i>' : "") + "</div>";
    }
    b.hh = hash(b.html.replace(/\s+/g, " "));
    return b;
  }
  function finishBlock(b, lines, label) { b.js = lines && lines.length ? blockWrap(b.id, label, lines) : ""; return b; }
  function labelOf(kind, c) { return kind === "t" ? "«" + String(c.text || "").slice(0, 40) + "»" : kind === "m" ? String(c.name || "media") : kind === "a" ? String(c.name || "audio") : String(c.name || "toma"); }

  /* generación sin muestreo (servidor): bloques guardados por el editor si el clip no cambió; si no, lo semántico */
  function generate(model, env) {
    env = env || {};
    var saved = env.blocks || {}, out = [], missing = [];
    relayoutV1(model);
    env.model = model;
    var put = function (kind, c, i) {
      var b = staticBlock(kind, c, model, env, i), sv = saved[c.id];
      if (sv && sv.fp === b.fp && sv.html != null) { b.html = sv.html; b.js = sv.js || ""; b.pre = sv.pre || b.pre; b.eases = sv.eases || []; out.push(b); return; }
      var lines = [];
      if (kind === "t" || kind === "m") {
        var sm = semanticMotion(kind, c, b.id, env);
        if (sm) { lines = sm.lines; b.eases = sm.eases; }
        else { missing.push(c.id); lines = ["// movimiento compuesto de Musa (" + motionLabel(c) + "): ábrelo en el editor para escribirlo cuadro a cuadro; mientras tanto vuelve igual desde data-musa"]; }
        if (c.anim === "words" || c.anim === "typewriter") {
          var txt = String(c.text || ""), counts = [];
          if (c.anim === "words") { var ts = wordTimes(c); ts.forEach(function (t0, k) { counts.push({ t: (+c.start || 0) + t0, n: k + 1 }); }); }
          else { var eD = +c.enD > 0 ? +c.enD : 0.5, L = txt.length; for (var q = 1; q <= L; q++) counts.push({ t: (+c.start || 0) + eD * (q - 0.5) / L, n: q }); }
          lines = lines.concat(revealLines(b.id, c, counts).lines);
        }
      }
      finishBlock(b, lines, labelOf(kind, c)); out.push(b);
    };
    (model.v1 || []).forEach(function (c, i) { put("v1", c, i); });
    (model.m || []).forEach(function (c, i) { put("m", c, i); });
    (model.t || []).forEach(function (c, i) { put("t", c, i); });
    (model.a || []).forEach(function (c, i) { put("a", c, i); });
    return { code: assemble(model, out, env), blocks: out, missing: missing };
  }
  function motionLabel(c) { return [c.orb ? "órbita" : "", c.path ? "recorrido" : "", c.anim === "stack" ? "apilarse" : "", c.fx && c.fx !== "none" ? "efecto " + c.fx : "", c.expr ? "expresiones" : "", +c.mbA > 0 ? "desenfoque de movimiento" : "", c.grp ? "grupo" : "", c.morphClip ? "morph" : "", c.mask ? "máscara" : "", c.anim === "fly-in" ? "llega volando" : ""].filter(Boolean).join(", ") || "varias capas"; }
  function wordTimes(c) {
    var n = (String(c.text || "").match(/\S+/g) || []).length, gap = +c.wordGap > 0 ? +c.wordGap : 0.25;
    var own = String(c.wordTimes || "").split(/[,;\s]+/).filter(Boolean).map(Number).filter(function (x) { return isFinite(x); }), out = [];
    for (var i = 0; i < n; i++) out.push(own[i] != null ? own[i] : (own.length ? own[own.length - 1] + (i - own.length + 1) * gap : i * gap));
    return out;
  }

  /* ───────────── importar: código HTML → modelo del editor ───────────── */
  function detect(src) {
    var s = String(src || "").trim();
    if (!s) return "empty";
    if (/^[\[{]/.test(s)) {
      try { var j = JSON.parse(s); if (j && j.musaVideo) return "musa-json"; if (j && Array.isArray(j.v1) && Array.isArray(j.t)) return "musa-json"; if (j && j.version && j.canvas && Array.isArray(j.nodes)) return "motion-spec"; if (j && j.layers && j.fr && j.op != null) return "lottie"; return "json"; } catch (e) { /* no es JSON */ }
    }
    if (/data-musa-video\s*=/.test(s)) return "musa-html";
    if (/from\s+["']remotion["']|useCurrentFrame\s*\(|<AbsoluteFill|<Sequence\b|registerRoot\s*\(|<Composition\b/.test(s)) return "remotion";
    if (/<(html|body|div|section|svg|main|span|h1|h2|p|img|video)\b/i.test(s)) return "html";
    if (/\b(export\s+(default\s+)?(function|const)|React\.FC|=>\s*\(?\s*<)/.test(s)) return "remotion";
    return "unknown";
  }
  function attrJson(el, name) { var v = el.attrs && el.attrs[name]; if (!v) return null; try { return JSON.parse(v); } catch (e) { return null; } }
  function pctOf(v, ref) { var s = String(v || "").trim(); if (/%$/.test(s)) return parseFloat(s); if (/px$/.test(s) || /^-?[\d.]+$/.test(s)) return parseFloat(s) / ref * 100; return NaN; }
  function pxOf(v, ref) { var s = String(v || "").trim(); if (/%$/.test(s)) return parseFloat(s) / 100 * ref; return parseFloat(s); }
  function firstFamily(v) { return String(v || "").split(",")[0].replace(/["']/g, "").trim(); }
  function sameNum(a, b, tol) { return Math.abs(num(a, NaN) - num(b, NaN)) <= (tol || 0.011); }
  /* compara el estilo del código con el que Musa escribió y aplica solo lo que cambió */
  function applyStyleT(c, outerCss, innerCss, genCss, W, H) {
    var o = cssParse(outerCss), i = cssParse(innerCss), go = cssParse(genCss.outer), gi = cssParse(genCss.inner), ch = [];
    var diff = function (A, B, k) { return (A[k] || "") !== (B[k] || ""); };
    if (diff(o, go, "left")) { var x = pctOf(o.left, W); if (isFinite(x)) { c.x = r2(x); ch.push("x"); } }
    if (diff(o, go, "top")) { var y = pctOf(o.top, H); if (isFinite(y)) { c.y = r2(y); ch.push("y"); } }
    if (diff(o, go, "font-size")) { var fs = parseFloat(o["font-size"]); if (fs > 0) { c.size = r2(fs); c.exact = true; ch.push("size"); } }
    if (diff(o, go, "font-family")) { c.font = firstFamily(o["font-family"]) || c.font; ch.push("font"); }
    if (diff(o, go, "font-weight")) { c.weight = num(o["font-weight"], c.weight); ch.push("weight"); }
    if (diff(o, go, "color")) { c.color = o.color; ch.push("color"); }
    if (diff(o, go, "letter-spacing")) { c.ls = parseFloat(o["letter-spacing"]) || 0; ch.push("ls"); }
    if (diff(o, go, "font-style")) { c.italic = /italic|oblique/.test(o["font-style"] || ""); ch.push("italic"); }
    if (diff(i, gi, "background")) { c.bg = i.background || ""; ch.push("bg"); }
    return ch;
  }
  function applyStyleM(c, outerCss, innerCss, genCss, W, H) {
    var o = cssParse(outerCss), i = cssParse(innerCss), go = cssParse(genCss.outer), gi = cssParse(genCss.inner), ch = [];
    var diff = function (A, B, k) { return (A[k] || "") !== (B[k] || ""); };
    if (diff(o, go, "left")) { var x = pctOf(o.left, W); if (isFinite(x)) { c.x = r2(x); ch.push("x"); } }
    if (diff(o, go, "top")) { var y = pctOf(o.top, H); if (isFinite(y)) { c.y = r2(y); ch.push("y"); } }
    if (diff(o, go, "width")) { var w = pctOf(o.width, W); if (isFinite(w) && w > 0) { c.w = r2(w); ch.push("w"); } }
    if (diff(o, go, "aspect-ratio")) { var ar = String(o["aspect-ratio"] || "").split("/").map(Number); var v = ar.length === 2 ? ar[0] / ar[1] : ar[0]; if (v > 0) { c.ar = r3(v); ch.push("ar"); } }
    if (diff(i, gi, "background") && !c.svg && !c.vshape) { c.bg = i.background || "transparent"; delete c.grad; ch.push("bg"); }
    if (diff(i, gi, "border-radius")) { var br = String(i["border-radius"] || ""); if (br === "50%") { c.shape = "circle"; } else { delete c.shape; c.radius = parseFloat(br) || 0; } ch.push("radius"); }
    return ch;
  }
  function fixTimes(c, clipEl) {
    if (!clipEl) return;
    var s = num(clipEl.attrs["data-start"], NaN), d = num(clipEl.attrs["data-duration"], NaN);
    if (isFinite(s)) c.start = r3(Math.max(0, s));
    if (isFinite(d) && d > 0) c.dur = r3(d);
  }
  function timedAncestor(el, rootEl) { for (var p = el; p && p !== rootEl; p = p.parent) if (p.attrs && p.attrs["data-start"] != null) return p; return null; }

  /* movimiento leído del código → keyframes del editor (en el elemento y sus envoltorios .in) */
  function motionFromCode(ev, el, c, kind, W, H, fps) {
    var inn = elKids(el).find(function (k) { return hasClass(k, "in"); }) || null;
    var start = +c.start || 0, dur = +c.dur || 0, n = Math.max(2, Math.ceil(dur * fps) + 1), times = [], S = { x: [], y: [], s: [], r: [], o: [], b: [] }, any = false;
    for (var i = 0; i < n; i++) {
      var t = start + Math.min(dur - 1e-4, i / fps), st = composeAt(ev, [el, inn], t);
      /* el editor ya desvanece el texto en sus últimos 0,25 s: esa parte no va a los keyframes (si no, se aplicaría dos veces) */
      if (kind === "t" && !c.morphClip) { var outF = cl((start + dur - t) / 0.25, 0, 1); if (outF < 1) st.o = outF > 0.05 ? Math.min(1, st.o / outF) : (S.o.length ? S.o[S.o.length - 1] : 1); }
      times.push(r3(t - start)); S.x.push(st.x); S.y.push(st.y); S.s.push(st.s); S.r.push(st.r); S.o.push(st.o); S.b.push(st.b);
    }
    ["x", "y", "s", "r", "o", "b"].forEach(function (k) { var A = S[k]; if (A.some(function (v) { return Math.abs(v - A[0]) > 1e-6; })) any = true; });
    var base = { x: S.x[0], y: S.y[0], s: S.s[0], r: S.r[0], o: S.o[0], b: S.b[0] };
    /* primero se intenta con pocos keyframes y su curva (los cortes de los tweens del código) */
    if (any) { var fit = fitEased(times, S, cuts(ev, [el, inn], start, dur)); if (fit) return fit; }
    if (!any) return base.o < 0.999 || Math.abs(base.x) > 0.01 || Math.abs(base.y) > 0.01 || Math.abs(base.s - 1) > 1e-3 || Math.abs(base.r) > 0.01 || base.b > 0.01 ? [kfOf(0, base)] : [];
    var idx = rdp(times, [{ v: S.x, tol: TOL.x }, { v: S.y, tol: TOL.y }, { v: S.s, tol: TOL.s }, { v: S.r, tol: TOL.r }, { v: S.o, tol: TOL.o }, { v: S.b, tol: TOL.b }], 1);
    return idx.map(function (i) { return kfOf(times[i], { x: S.x[i], y: S.y[i], s: S.s[i], r: S.r[i], o: S.o[i], b: S.b[i] }); });
  }
  /* instantes donde empieza o termina un tween del elemento (relativos al clip) */
  function cuts(ev, els, start, dur) {
    var T = { 0: 1 }; T[r3(dur)] = 1;
    els.forEach(function (e) { if (!e) return; var sg = ev.segs(e); Object.keys(sg).forEach(function (p) { sg[p].forEach(function (s) { [s.t0, s.t1].forEach(function (t) { var u = r3(t - start); if (u > 0 && u < dur) T[u] = 1; }); }); }); });
    return Object.keys(T).map(Number).sort(function (a, b) { return a - b; });
  }
  /* curvas que el editor sabe hacer: las exactas y aproximaciones cubic-bezier de las de GSAP más usadas */
  var FIT_EASES = [["lin", null], ["out", null], ["in", null], ["smooth", null],
    ["bezier", "0.5, 1, 0.89, 1"], ["bezier", "0.25, 1, 0.5, 1"], ["bezier", "0.22, 1, 0.36, 1"], ["bezier", "0.16, 1, 0.3, 1"], ["bezier", "0.34, 1.56, 0.64, 1"], ["bezier", "0.61, 1, 0.88, 1"], ["bezier", "0, 0.55, 0.45, 1"],
    ["bezier", "0.37, 0, 0.63, 1"], ["bezier", "0.45, 0, 0.55, 1"], ["bezier", "0.76, 0, 0.24, 1"], ["bezier", "0.83, 0, 0.17, 1"], ["bezier", "0.87, 0, 0.13, 1"], ["bezier", "0.11, 0, 0.5, 0"], ["bezier", "0.5, 0, 0.75, 0"], ["bezier", "0.12, 0, 0.39, 0"], ["bezier", "0.7, 0, 0.84, 0"]];
  var EF = { lin: function (u) { return u; }, out: function (u) { return 1 - Math.pow(1 - u, 3); }, "in": function (u) { return u * u * u; }, smooth: function (u) { return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; } };
  function fitEased(times, S, cutT) {
    if (cutT.length > 24) return null;
    var DIMS = ["x", "y", "s", "r", "o", "b"], TOLF = { x: 1, y: 1, s: 0.008, r: 0.5, o: 0.012, b: 0.5 };
    var at = function (t) { var best = 0; for (var i = 0; i < times.length; i++) if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i; return best; };
    var idx = cutT.map(at), out = [];
    for (var k = 0; k < idx.length; k++) {
      var i0 = idx[k], v = {}; DIMS.forEach(function (d) { v[d] = S[d][i0]; });
      var kf = kfOf(times[i0], v);
      if (k < idx.length - 1) {
        var i1 = idx[k + 1]; if (i1 <= i0) continue;
        var ok = null;
        for (var e = 0; e < FIT_EASES.length && !ok; e++) {
          var fe = FIT_EASES[e], fn = fe[0] === "bezier" ? (function (n) { return bezierFn(n[0], n[1], n[2], n[3]); })(fe[1].split(",").map(Number)) : EF[fe[0]], good = true;
          for (var i = i0 + 1; i < i1 && good; i++) {
            var u = (times[i] - times[i0]) / ((times[i1] - times[i0]) || 1), q = fn(u);
            for (var dd = 0; dd < DIMS.length; dd++) { var D = DIMS[dd], A = S[D][i0], B = S[D][i1]; if (Math.abs(A + (B - A) * q - S[D][i]) > TOLF[D]) { good = false; break; } }
          }
          if (good) ok = fe;
        }
        if (!ok) return null;
        kf.e = ok[0]; if (ok[1]) kf.bz = ok[1];
      } else delete kf.e;
      out.push(kf);
    }
    return out.length >= 2 ? out : null;
  }
  function kfOf(t, v) { var k = { t: r2(t), x: r2(v.x), y: r2(v.y), s: r3(v.s), r: r2(v.r), o: r3(cl(v.o, 0, 1)), e: "lin" }; if (v.b > 0.01) k.b = r2(v.b); return k; }
  /* composición de los transform de varios elementos anidados (cada uno centrado en el mismo punto) */
  function composeAt(ev, els, t) {
    var x = 0, y = 0, s = 1, r = 0, o = 1, b = 0;
    els.forEach(function (e) {
      if (!e) return;
      var ex = num(ev.valueAt(e, "x", t, 0), 0), ey = num(ev.valueAt(e, "y", t, 0), 0), es = num(ev.valueAt(e, "scale", t, 1), 1) * Math.sqrt(Math.abs(num(ev.valueAt(e, "scaleX", t, 1), 1) * num(ev.valueAt(e, "scaleY", t, 1), 1))), er = num(ev.valueAt(e, "rotation", t, 0), 0), eo = num(ev.valueAt(e, "opacity", t, 1), 1), ef = ev.valueAt(e, "filter", t, "");
      var a = r * Math.PI / 180, ca = Math.cos(a) * s, sa = Math.sin(a) * s;
      x += ex * ca - ey * sa; y += ex * sa + ey * ca; s *= es; r += er; o *= eo; b += blurOf(ef);
    });
    return { x: x, y: y, s: s, r: r, o: o, b: b };
  }
  /* ¿el elemento tiene revelado por letras/palabras? (tl.set display en los spans) → tiempos */
  function revealFromCode(parsed, id) {
    var out = [];
    parsed.calls.forEach(function (c) {
      if (c.m !== "set" || typeof c.args[0] !== "string") return;
      var m = new RegExp("^#" + id.replace(/[-]/g, "\\-") + "\\s+\\.in\\s*>\\s*i:nth-child\\(-n\\+(\\d+)\\)$").exec(c.args[0].trim());
      if (m && c.args[1] && c.args[1].display === "inline") out.push({ n: +m[1], t: num(c.args[2], 0) });
    });
    return out.sort(function (a, b) { return a.t - b.t; });
  }

  function impliesMotion(kind, d) { return kind === "t" || (d.anim && d.anim !== "none") || (d.kf && d.kf.length) || d.orb || d.path || (d.fx && d.fx !== "none") || d.expr || +d.mbA > 0; }
  function normSvg(s) { return String(s || "").replace(/\s+/g, " ").trim(); }
  function fromMusaHtml(src, opts) {
    opts = opts || {};
    var tree = parseHtml(src), warnings = [], changed = [];
    var rootEl = select(tree, "[data-musa-video]")[0] || select(tree, "[data-composition-id]")[0];
    if (!rootEl) throw new Error("no encontré la composición (un elemento con data-composition-id)");
    var proj = attrJson(rootEl, "data-musa") || {}, W = num(rootEl.attrs["data-width"], 1080), H = num(rootEl.attrs["data-height"], 1920), fps = num(rootEl.attrs["data-fps"], proj.fps || 30);
    var model = { name: proj.name || (select(tree, "title")[0] ? textOf(select(tree, "title")[0]).trim() : "Video"), W: W, H: H, fmt: proj.fmt || null, fps: fps, pad: proj.pad || "#000000", grad: proj.grad || null, total: proj.total || null, persp: proj.persp || null, gtr: proj.gtr || null, markers: proj.markers || null, v1: [], m: [], t: [], a: [] };
    var rs = cssParse(rootEl.attrs.style || ""), rbg = rs.background || rs["background-color"];
    if (rbg && !model.grad && rbg !== model.pad) { model.pad = /gradient/.test(rbg) ? model.pad : rbg; if (/gradient/.test(rbg)) warnings.push("El fondo con degradado del código se dejó como estaba en Musa"); }
    var dd = num(rootEl.attrs["data-duration"], NaN);
    var js = select(tree, "script").filter(function (s) { return !s.attrs.src && !/json|musa-live/.test(s.attrs.type || "") && s.attrs["data-musa-runtime"] == null; }).map(textOf).join("\n");
    var parsed = parseGsap(js), byId = {};
    var resolve = function (target) {
      /* los spans del revelado se crean al cargar (musaSplit): se leen aparte con revealFromCode */
      if (typeof target === "string" && /\.in\s*(>\s*i:nth-child|\.m[ab])/.test(target)) return [{ tag: "i", attrs: {}, kids: [], virtual: true }];
      if (typeof target === "string") return select(rootEl, target);
      if (Array.isArray(target)) { var o = []; target.forEach(function (x) { if (typeof x === "string") select(rootEl, x).forEach(function (e) { if (o.indexOf(e) < 0) o.push(e); }); }); return o; }
      return null;
    };
    var built = buildSegments(parsed, resolve), ev = makeEval(built, parsed.eases);
    parsed.blocks.forEach(function (b) { byId[b.id] = b; });
    var blockOk = function (id) { var b = byId[id]; if (!b || !b.h) return false; var body = js.slice(js.indexOf("\n", b.s) + 1, b.e); return hash(normJs(body.replace(/\n\s*$/, ""))) === b.h || hash(normJs(body)) === b.h; };
    var env = Object.assign({}, opts.env || {});
    var nodes = all(rootEl).filter(function (e) { return e.attrs && (e.attrs["data-musa"] != null || hasClass(e, "t") || hasClass(e, "m") || hasClass(e, "v1") || (e.tag === "audio" && e.attrs["data-start"] != null)); }).filter(function (e) { return e !== rootEl; });
    nodes.forEach(function (el) {
      var data = attrJson(el, "data-musa"), id = el.attrs.id || "", kind = hasClass(el, "t") ? "t" : hasClass(el, "m") ? "m" : hasClass(el, "v1") ? "v1" : el.tag === "audio" ? "a" : /^t-/.test(id) ? "t" : /^m-/.test(id) ? "m" : /^v1-/.test(id) ? "v1" : /^a-/.test(id) ? "a" : null;
      if (!kind) return;
      var c = data ? deepClone(data) : { id: "c" + hash(id + Math.random()).slice(0, 6) };
      var inner = elKids(el).find(function (k) { return hasClass(k, "in"); });
      if (kind === "t") {
        c.text = c.text != null ? c.text : ""; if (!data) Object.assign(c, { x: 50, y: 50, size: 64, font: "Inter", weight: 800, color: "#ffffff", bg: "", anim: "none", exact: true });
        fixTimes(c, timedAncestor(el, rootEl));
        var txt = inner ? textOf(inner) : textOf(el);
        if (el.attrs["data-morph-to"] != null && data && data.morphTo !== el.attrs["data-morph-to"]) { c.morphTo = el.attrs["data-morph-to"]; changed.push(c.id + ":morphTo"); }
        if (txt !== String(data ? data.text : "")) { c.text = txt; if (data) changed.push(c.id + ":text"); }
        var gen = tCss(data || c, env, data && data._fs != null ? data._fs : num(c.size, 64));
        var chT = applyStyleT(c, el.attrs.style || "", inner ? inner.attrs.style || "" : "", data ? gen : { outer: "", inner: "" }, W, H);
        if (data && chT.length) changed.push(c.id + ":" + chT.join(","));
        delete c._fs;
      } else if (kind === "m") {
        if (!data) Object.assign(c, { name: "Media", x: 50, y: 50, w: 40, ar: 1, radius: 0, bg: "#ffffff", anim: "none" });
        fixTimes(c, timedAncestor(el, rootEl));
        var svgEl = inner && elKids(inner).find(function (k) { return k.tag === "svg"; });
        if (svgEl) {
          var svgSrc = outer(src, svgEl);
          if (!data) c.svg = svgSrc;
          else if (hash(normSvg(svgSrc)) === data._sv) { if (!data.vshape && !data.svg) c.svg = svgSrc; }
          else { c.svg = svgSrc; delete c.svgMap; delete c.vshape; changed.push(c.id + ":svg"); }
        }
        delete c._sv;
        var lcv = all(el).find(function (k) { return k.tag === "canvas" && hasClass(k, "musa-live"); });
        if (lcv) {
          var lsc = all(el).find(function (k) { return k.tag === "script" && /musa-live/.test(k.attrs.type || ""); }), MZ = MLv();
          var raw = lsc ? textOf(lsc).replace(/^\r?\n/, "").replace(/\r?\n$/, "") : "";
          var own = attrJson(lcv, "data-live");
          var src0 = c.live && c.live.src;
          c.live = Object.assign({}, c.live || {}, own || {}, { src: MZ ? MZ.unescScript(raw) : raw.replace(/<\\\/script/gi, "</script"), kind: lcv.attrs["data-kind"] || (c.live && c.live.kind) || "html" });
          /* el código manda: los ajustes salen de su bloque ▸ musa (un HTML exportado antes los traía en data-live) */
          if (MZ) { var lbk = MZ.blockOf(c.live.src); c.live.ov = lbk.has || !(own && own.ov) ? lbk.ov : own.ov; MZ.normalize(c.live); }
          if (data && src0 != null && src0 !== c.live.src) changed.push(c.id + ":código");
          c.bg = "transparent";
        }
        var chM = applyStyleM(c, el.attrs.style || "", inner ? inner.attrs.style || "" : "", data ? mCss(data, env) : { outer: "", inner: "" }, W, H);
        if (!data) { var ob = cssParse(inner ? inner.attrs.style : el.attrs.style); if (ob.background) c.bg = ob.background; }
        if (data && chM.length) changed.push(c.id + ":" + chM.join(","));
      } else if (kind === "a") {
        if (!data) Object.assign(c, { name: "Audio", vol: 1, fin: 0, fout: 0 });
        fixTimes(c, el);
        if (el.attrs.src && el.attrs.src !== (data && data.url)) { c.url = el.attrs.src; if (data) changed.push(c.id + ":src"); }
        if (el.attrs["data-volume"] != null) c.vol = num(el.attrs["data-volume"], c.vol);
        if (el.attrs["data-fade-in"] != null) c.fin = num(el.attrs["data-fade-in"], 0);
        if (el.attrs["data-fade-out"] != null) c.fout = num(el.attrs["data-fade-out"], 0);
        if (el.attrs["data-media-start"] != null) { var mi = num(el.attrs["data-media-start"], 0); if (mi || c.in != null) c.in = mi; }
      } else if (kind === "v1") {
        var timed = select(el, "[data-start]")[0];
        var pre0 = data && +data._pre || 0, post0 = data && +data._post || 0; delete c._pre; delete c._post;
        if (timed) { var d1 = num(timed.attrs["data-duration"], NaN) - pre0 - post0; if (isFinite(d1) && d1 > 0 && Math.abs(d1 - (+c.dur || 0)) > 1e-3) { c.dur = r3(d1); changed.push(c.id + ":dur"); } c._st = num(timed.attrs["data-start"], 0) + pre0; }
        if (timed && timed.tag === "video") {
          if (data && timed.attrs.src && timed.attrs.src !== data.takeUrl) { c.takeUrl = timed.attrs.src; changed.push(c.id + ":src"); }
          if (!data) { c.kind = "take"; c.takeUrl = timed.attrs.src; c.name = "Video"; c.speed = 1; c.vol = 1; c.look = "none"; c.lookK = 1; c.fx = "none"; c.ovl = "none"; c.trans = null; }
          var ms = num(timed.attrs["data-media-start"], NaN), sp0 = +c.speed || 1;
          /* data-media-start empieza d/2 antes por la transición: si es el que escribió Musa, vuelve el «in» original */
          if (isFinite(ms)) { var msGen = data ? r3(Math.max(0, (+data.in || 0) - pre0 * (+data.speed || 1))) : NaN; if (!data || Math.abs(ms - msGen) > 1e-3) { c.in = r3(ms + pre0 * sp0); if (data) changed.push(c.id + ":in"); } }
          var pr = num(timed.attrs["data-playback-rate"], NaN); if (isFinite(pr) && pr > 0) c.speed = pr;
        }
        if (!data && !c.kind) return;
      }
      /* movimiento: si el bloque del clip no cambió, vuelve lo de Musa; si cambió (o el clip es nuevo), manda el código */
      if (kind === "t" || kind === "m") {
        if (data && blockOk(id)) { /* intacto */ }
        else if (ev.has(el) || (inner && ev.has(inner)) || !data || (!byId[id] && impliesMotion(kind, data))) {
          if (kind === "m") delete c.opacity;
          var kf = motionFromCode(ev, el, c, kind, W, H, fps);
          var reveal = kind === "t" ? revealFromCode(parsed, id) : [];
          ["orb", "path", "expr", "mbA", "stD", "stDir", "stB", "stR", "stDist", "curve", "fx"].forEach(function (k) { delete c[k]; });
          c.anim = "none"; delete c.enD;
          if (reveal.length) {
            var words = (String(c.text).match(/\S+/g) || []).length, isW = new RegExp("musaSplit\\(\\s*[\"']#" + id + "\\s+\\.in[\"']\\s*,\\s*[\"']w[\"']").test(js);
            if (isW) { c.anim = "words"; c.wordTimes = reveal.slice(0, words).map(function (q) { return r2(q.t - c.start); }).join(", "); }
            else { c.anim = "typewriter"; var L = String(c.text).length, f = reveal[0], l = reveal[reveal.length - 1]; c.enD = L > 1 ? r2((l.t - f.t) * L / (L - 1)) : 0.5; }
          }
          if (kf.length) c.kf = kf; else delete c.kf;
          if (data) changed.push(c.id + ":movimiento");
        }
      }
      if (kind === "v1" && data && byId[id] && !blockOk(id)) warnings.push("La toma «" + (c.name || id) + "»: sus transiciones y efectos se editan en Musa (el cambio de su bloque no se aplicó)");
      (kind === "v1" ? model.v1 : model[kind]).push(c);
    });
    model.v1.sort(function (a, b) { return (a._st || 0) - (b._st || 0); });
    model.v1.forEach(function (c) { delete c._st; });
    relayoutV1(model);
    var ends = durOf(Object.assign({}, model, { total: null }));
    if (isFinite(dd) && dd > 0 && Math.abs(dd - ends) > 0.01) model.total = r3(dd); else if (proj.total) model.total = proj.total;
    if (built.unresolved.length) warnings.push(built.unresolved.length + " llamada(s) de GSAP no se pudieron leer sin ejecutar el código");
    return { model: model, warnings: warnings, changed: changed, unresolved: built.unresolved.length };
  }

  /* ───────────── lo que devuelve el sandbox (código ajeno) → modelo ───────────── */
  /* trace: { W, H, fps, dur, bg, els: [{ key, kind:"t"|"m"|"svg"|"img"|"video"|"audio", text, style, src, svg, samples: [[t, cx, cy, w, h, s, r, o, blur, vis]] }] } */
  function fromTrace(tr) {
    var W = tr.W || 1920, H = tr.H || 1080, fps = tr.fps || 30, model = { name: tr.name || "Video desde código", W: W, H: H, fmt: null, fps: fps, pad: tr.bg || "#000000", v1: [], m: [], t: [], a: [], total: tr.dur || null }, warnings = (tr.warnings || []).slice();
    var nid = 0, mkId = function () { return "k" + (++nid).toString(36) + hash(String(Math.random())).slice(0, 4); };
    (tr.els || []).forEach(function (e) {
      if (e.kind === "audio" || e.kind === "video" && e.full) {
        var c0 = { id: mkId(), name: e.name || (e.kind === "audio" ? "Audio" : "Video"), start: r3(e.start || 0), dur: r3(e.dur || tr.dur || 5), in: r3(e.mediaStart || 0) };
        if (e.kind === "audio") { c0.url = e.src; c0.vol = e.volume != null ? e.volume : 1; c0.fin = 0; c0.fout = 0; model.a.push(c0); }
        else { Object.assign(c0, { kind: "take", takeUrl: e.src, speed: e.rate || 1, vol: e.muted ? 0 : 1, look: "none", lookK: 1, fx: "none", ovl: "none", trans: null, fit: "cover" }); model.v1.push(c0); }
        return;
      }
      var S = e.samples || []; if (!S.length) return;
      /* tramos visibles: cada vez que aparece es un clip */
      var runs = [], cur = null, gap = 1.6 / fps;
      S.forEach(function (s, i) { if (s[9] && cur && s[0] - S[cur.b][0] <= gap) cur.b = i; else if (s[9]) { cur = { a: i, b: i }; runs.push(cur); } else cur = null; });
      runs.forEach(function (rn) {
        var seg = S.slice(rn.a, rn.b + 1); if (!seg.length) return;
        var t0 = seg[0][0], t1 = Math.min(tr.dur || 1e9, seg[seg.length - 1][0] + 1 / fps);
        if (t1 - t0 < 0.5 / fps) return;
        /* cuadro de referencia: el más opaco y quieto (el del medio si empatan) */
        var bi = 0, bo = -1; seg.forEach(function (s, i) { var sc = s[7] - Math.abs(s[5] - 1) * 0.2 - Math.abs(i - seg.length / 2) / seg.length * 0.05; if (sc > bo) { bo = sc; bi = i; } });
        var ref = seg[bi], bs = ref[5] || 1, br = ref[6] || 0;
        var c = { id: mkId(), start: r3(t0), dur: r3(t1 - t0), x: r2(ref[1] / W * 100), y: r2(ref[2] / H * 100) };
        var st = e.style || {};
        if (e.kind === "t") {
          Object.assign(c, { text: e.text || "", size: r2((st.fontSize || 48) * bs), font: firstFamily(st.fontFamily) || "Inter", weight: num(st.fontWeight, 400), color: st.color || "#ffffff", bg: st.bg || "", anim: "none", exact: true });
          if (st.ls) c.ls = r2(st.ls); if (st.italic) c.italic = true;
          model.t.push(c);
        } else {
          /* tamaño de diseño × escala del cuadro de referencia = lo que se ve */
          var w = (ref[3] || 1) * bs, h = (ref[4] || 1) * bs;
          Object.assign(c, { name: e.name || (e.kind === "img" ? "Imagen" : e.kind === "svg" ? "Vector" : "Forma"), w: r2(w / W * 100), ar: r3(w / Math.max(1, h)), radius: st.radius || 0, anim: "none", bg: "transparent" });
          if (st.circle) c.shape = "circle";
          if (e.kind === "img") c.bg = "url('" + e.src + "') center/" + (st.fit === "contain" ? "contain" : "cover") + " no-repeat";
          else if (e.kind === "live") { c.bg = "transparent"; c.live = { sel: e.sel != null ? e.sel : -1, W: W, H: H, fps: fps, off: r3(t0), cw: e.cw || 0, ch: e.ch || 0 }; if (e.own) c.live.own = e.own; }
          else if (e.kind === "svg") c.svg = e.svg;
          else c.bg = st.bg || "#ffffff";
          if (st.opacity != null && st.opacity < 1) c.opacity = r3(st.opacity);
          model.m.push(c);
        }
        var times = [], X = [], Y = [], Sc = [], R = [], O = [], B = [];
        seg.forEach(function (s) { times.push(r3(s[0] - t0)); X.push(s[1] - ref[1]); Y.push(s[2] - ref[2]); Sc.push((s[5] || 1) / bs); R.push((s[6] || 0) - br); O.push(cl(s[7] / (c.opacity || 1), 0, 1)); B.push(s[8] || 0); });
        var moving = [X, Y, Sc, R, O, B].some(function (A, k) { var tol = [0.5, 0.5, 0.002, 0.15, 0.004, 0.25][k]; return A.some(function (v) { return Math.abs(v - A[0]) > tol; }); });
        if (moving || Math.abs(X[0]) > 0.5 || Math.abs(Y[0]) > 0.5 || O[0] < 0.995) {
          var idx = rdp(times, [{ v: X, tol: TOL.x }, { v: Y, tol: TOL.y }, { v: Sc, tol: TOL.s }, { v: R, tol: TOL.r }, { v: O, tol: TOL.o }, { v: B, tol: TOL.b }], 1);
          c.kf = idx.map(function (i) { return kfOf(times[i], { x: X[i], y: Y[i], s: Sc[i], r: R[i], o: O[i], b: B[i] }); });
        }
        if (br) c.kf = (c.kf || [kfOf(0, { x: 0, y: 0, s: 1, r: 0, o: 1, b: 0 })]).map(function (k) { k.r = r2(k.r + br); return k; });
      });
    });
    /* una caja de color fija que cubre todo el cuadro todo el video es el fondo del proyecto */
    var tot = tr.dur || 0, bgc = model.m.find(function (c) { return !c.kf && !c.svg && /^(#|rgb)/.test(String(c.bg || "")) && c.w >= 99 && c.w / Math.max(0.01, c.ar || 1) * W / H >= 99 && Math.abs(c.x - 50) < 1 && Math.abs(c.y - 50) < 1 && c.start < 0.05 && (!tot || c.start + c.dur >= tot - 0.05) && (c.opacity == null || c.opacity >= 0.999); });
    if (bgc && model.m.indexOf(bgc) === 0) { model.pad = bgc.bg; model.m.splice(0, 1); }
    relayoutV1(model);
    return { model: model, warnings: warnings };
  }

  /* ───────────── Remotion (TSX) desde el código HTML ───────────── */
  function toRemotion(htmlSrc, opts) {
    opts = opts || {};
    var res = fromMusaHtml(htmlSrc, opts), m = res.model, fps = m.fps || 30, D = durOf(m), F = function (s) { return Math.round(s * fps); };
    var tree = parseHtml(htmlSrc), rootEl = select(tree, "[data-musa-video]")[0];
    var js = select(tree, "script").filter(function (s) { return !s.attrs.src && !/json|musa-live/.test(s.attrs.type || "") && s.attrs["data-musa-runtime"] == null; }).map(textOf).join("\n"), parsed = parseGsap(js);
    var built = buildSegments(parsed, function (t) { return typeof t === "string" ? select(rootEl, t) : null; }), ev = makeEval(built, parsed.eases);
    var comps = [], uses = {}, L = [];
    var arr = function (A) { return "[" + A.map(fmtN).join(", ") + "]"; };
    var track = function (els, start, dur, key) {
      var n = Math.max(2, F(dur) + 1), times = [], tr = { x: [], y: [], s: [], r: [], o: [], b: [] };
      for (var i = 0; i < n; i++) { var t = start + Math.min(dur - 1e-4, i / fps), st = composeAt(ev, els, t); times.push(i); tr.x.push(r2(st.x)); tr.y.push(r2(st.y)); tr.s.push(r3(st.s)); tr.r.push(r2(st.r)); tr.o.push(r3(st.o)); tr.b.push(r2(st.b)); }
      var out = {};
      ["x", "y", "s", "r", "o", "b"].forEach(function (k) {
        var A = tr[k]; if (!A.some(function (v) { return v !== A[0]; })) { out[k] = fmtN(A[0]); return; }
        var idx = rdp(times, [{ v: A, tol: TOL[k] }], 1); uses.interpolate = 1;
        out[k] = "k(f, " + arr(idx.map(function (i) { return times[i]; })) + ", " + arr(idx.map(function (i) { return A[i]; })) + ")";
      });
      return out;
    };
    var Ts = function (o) { return "`translate(-50%, -50%) translate(${" + o.x + "}px, ${" + o.y + "}px) rotate(${" + o.r + "}deg) scale(${" + o.s + "})`"; };
    var ci = 0;
    var seq = [];
    m.v1.forEach(function (c) {
      var nm = "V" + (++ci);
      if (c.kind === "take" && c.takeUrl) { uses.OffthreadVideo = 1; seq.push('      <Sequence from={' + F(c.start) + '} durationInFrames={' + Math.max(1, F(c.dur)) + '} name=' + JSON.stringify("V1 · " + (c.name || "video")) + '>\n        <OffthreadVideo src=' + JSON.stringify(c.takeUrl) + ' startFrom={' + F(+c.in || 0) + '} playbackRate={' + (+c.speed || 1) + '}' + (c.vol === 0 ? " muted" : "") + ' style={{ width: "100%", height: "100%", objectFit: "' + (c.fit === "contain" ? "contain" : "cover") + '" }} />\n      </Sequence>'); }
      else { var u = c.scene && c.scene.els && c.scene.els.length === 1 ? urlOf(c.scene.els[0].fill) : null; if (u) { uses.Img = 1; seq.push('      <Sequence from={' + F(c.start) + '} durationInFrames={' + Math.max(1, F(c.dur)) + '} name=' + JSON.stringify("V1 · " + (c.name || "escena")) + '>\n        <Img src=' + JSON.stringify(u) + ' style={{ width: "100%", height: "100%", objectFit: "' + (c.fit === "cover" ? "cover" : "contain") + '" }} />\n      </Sequence>'); } }
    });
    m.m.forEach(function (c) {
      var id = "m-" + safeId(c.id), el = select(rootEl, "#" + id)[0]; if (!el) return;
      var inn = elKids(el).find(function (k) { return hasClass(k, "in"); }), o = track([el, inn], c.start, c.dur), nm = "M" + (++ci);
      var st = cssParse(inn ? inn.attrs.style : ""), u = urlOf(c.bg);
      var sv = c.svg || c.vshape ? svgFor(c, opts.env || {}) : "";
      var liveR = "";
      if (c.live) { var MR = MLv(); if (MR) { var lm = MR.liveMeta(c.live); if (!(+lm.W > 0 && +lm.H > 0)) { var wr = MR.liveSize(c, m.W, m.H); lm.W = wr[0]; lm.H = wr[1]; } liveR = "<MusaLive live={" + JSON.stringify(lm) + "} code={" + JSON.stringify(MR.bakedSrc(c.live)) + "} />"; uses.live = 1; } }
      comps.push("const " + nm + ": React.FC = () => {\n  const f = useCurrentFrame();\n  return (\n    <div style={{ position: \"absolute\", left: \"" + r2(c.x) + "%\", top: \"" + r2(c.y) + "%\", width: \"" + r2(c.w || 40) + "%\", aspectRatio: \"" + r3(c.ar || 1) + "\", transform: " + Ts(o) + ", opacity: " + o.o + ", filter: `blur(${" + o.b + "}px)` }}>\n      "
        + (liveR ? liveR : sv ? "<div style={{ position: \"absolute\", inset: 0 }} dangerouslySetInnerHTML={{ __html: " + JSON.stringify(sv) + " }} />" : "<div style={{ position: \"absolute\", inset: 0, background: " + JSON.stringify(st.background || c.bg || "transparent") + ", borderRadius: " + JSON.stringify(st["border-radius"] || "0px") + " }} />")
        + "\n    </div>\n  );\n};");
      seq.push("      <Sequence from={" + F(c.start) + "} durationInFrames={" + Math.max(1, F(c.dur)) + "} name=" + JSON.stringify("M · " + (c.name || "media")) + " layout=\"none\"><" + nm + " /></Sequence>");
      void u;
    });
    m.t.forEach(function (c) {
      var id = "t-" + safeId(c.id), el = select(rootEl, "#" + id)[0]; if (!el) return;
      var inn = elKids(el).find(function (k) { return hasClass(k, "in"); }), o = track([el, inn], c.start, c.dur), nm = "T" + (++ci);
      var so = cssParse(el.attrs.style), si = cssParse(inn ? inn.attrs.style : "");
      var rv = revealFromCode(parsed, id), txtExpr = JSON.stringify(String(c.text || ""));
      if (rv.length) {
        var isW = c.anim === "words", parts = isW ? (String(c.text).match(/\s*\S+|\s+$/g) || []) : Array.from(String(c.text));
        var fr = rv.map(function (q) { return F(q.t - c.start); }), nn = rv.map(function (q) { return q.n; });
        txtExpr = "TXT.slice(0, shown(f, " + arr(fr) + ", " + arr(nn) + ")).join(\"\")";
        uses.shown = 1;
        comps.push("const TXT_" + nm + " = " + JSON.stringify(parts) + ";");
        txtExpr = txtExpr.replace("TXT", "TXT_" + nm);
      }
      var sty = ["position: \"absolute\"", "left: \"" + r2(c.x) + "%\"", "top: \"" + r2(c.y) + "%\"", "fontFamily: " + JSON.stringify(so["font-family"] || "Inter"), "fontSize: " + (parseFloat(so["font-size"]) || c.size || 64), "fontWeight: " + (so["font-weight"] || c.weight || 800), "color: " + JSON.stringify(so.color || c.color || "#fff"), "whiteSpace: \"pre\"", "textAlign: \"center\"", "lineHeight: 1.1"]
        .concat(so["letter-spacing"] ? ["letterSpacing: " + JSON.stringify(so["letter-spacing"])] : []).concat(so["font-style"] ? ["fontStyle: \"italic\""] : [])
        .concat(["transform: " + Ts(o), "opacity: " + o.o, "filter: `blur(${" + o.b + "}px)`"]);
      var box = si.background ? ", background: " + JSON.stringify(si.background) + ", padding: \".2em .55em\", borderRadius: \".35em\"" : "";
      comps.push("const " + nm + ": React.FC = () => {\n  const f = useCurrentFrame();\n  return <div style={{ " + sty.join(", ") + " }}><span style={{ display: \"block\"" + box + (si["text-shadow"] ? ", textShadow: " + JSON.stringify(si["text-shadow"]) : "") + " }}>{" + txtExpr + "}</span></div>;\n};");
      seq.push("      <Sequence from={" + F(c.start) + "} durationInFrames={" + Math.max(1, F(c.dur)) + "} name=" + JSON.stringify("T · " + String(c.text || "").slice(0, 30)) + " layout=\"none\"><" + nm + " /></Sequence>");
    });
    m.a.forEach(function (c) { if (!c.url) return; uses.Audio = 1; seq.push("      <Sequence from={" + F(c.start) + "} durationInFrames={" + Math.max(1, F(c.dur)) + "} name=" + JSON.stringify("A · " + (c.name || "audio")) + "><Audio src=" + JSON.stringify(c.url) + " startFrom={" + F(+c.in || 0) + "} volume={" + (c.vol != null ? +c.vol : 1) + "} /></Sequence>"); });
    var imp = ["AbsoluteFill", "Sequence", "useCurrentFrame"].concat(uses.live ? ["useVideoConfig", "delayRender", "continueRender"] : []).concat(uses.interpolate ? ["interpolate"] : []).concat(uses.Img ? ["Img"] : []).concat(uses.OffthreadVideo ? ["OffthreadVideo"] : []).concat(uses.Audio ? ["Audio"] : []);
    if (uses.live) L.push("// @ts-nocheck — el reproductor del código vivo es JavaScript sin tipos");
    L.push("/* Musa Video Code · Remotion — «" + (m.name || "Video") + "» · " + m.W + "×" + m.H + " · " + fps + " fps · " + fmtN(D) + " s",
      "   Regístralo con: <Composition id=\"Main\" component={Main} durationInFrames={" + F(D) + "} fps={" + fps + "} width={" + m.W + "} height={" + m.H + "} />",
      "   Pégalo en Musa (Crear › Videos › Desde código) y vuelve como clips editables. */",
      "import React from \"react\";",
      "import { " + imp.join(", ") + " } from \"remotion\";", "",
      "export const musaVideo = { width: " + m.W + ", height: " + m.H + ", fps: " + fps + ", durationInFrames: " + F(D) + " };", "");
    if (uses.live) { var MQ = MLv(); if (MQ) L.push(MQ.remotionComponent(), ""); }
    if (uses.interpolate) L.push("const k = (f: number, fr: number[], v: number[]) => (fr.length < 2 ? v[0] : interpolate(f, fr, v, { extrapolateLeft: \"clamp\", extrapolateRight: \"clamp\" }));");
    if (uses.shown) L.push("const shown = (f: number, fr: number[], n: number[]) => { let k = 0; fr.forEach((x, i) => { if (f >= x) k = n[i]; }); return k; };");
    L.push("");
    L = L.concat(comps, ["", "export const Main: React.FC = () => (", "  <AbsoluteFill style={{ background: " + JSON.stringify(m.pad || "#000") + " }}>"], seq, ["  </AbsoluteFill>", ");", "", "export default Main;", ""]);
    return L.join("\n");
  }

  /* ───────────── JSON (estado del editor) ───────────── */
  function toJson(model) {
    var o = { musaVideo: VERSION, name: model.name, W: model.W, H: model.H, fmt: model.fmt, fps: model.fps, pad: model.pad, grad: model.grad || null, total: model.total || null, persp: model.persp || null, gtr: model.gtr || null, markers: model.markers || null };
    ["v1", "m", "t", "a"].forEach(function (k) { o[k] = (model[k] || []).map(function (c) { return clipData(c); }); });
    return JSON.stringify(o, null, 2);
  }
  function fromJson(src) {
    var j = typeof src === "string" ? JSON.parse(src) : src;
    var m = { name: j.name || "Video", W: j.W || 1080, H: j.H || 1920, fmt: j.fmt || null, fps: j.fps || 30, pad: j.pad || "#000000", grad: j.grad || null, total: j.total || null, persp: j.persp || null, gtr: j.gtr || null, markers: j.markers || null, v1: [], m: [], t: [], a: [] };
    ["v1", "m", "t", "a"].forEach(function (k) { m[k] = (j[k] || []).map(function (c) { var o = clipData(c); delete o._s; return o; }); });
    relayoutV1(m);
    return { model: m, warnings: [] };
  }

  return {
    VERSION: VERSION, GSAP_URL: GSAP_URL, CE_URL: CE_URL, v1Win: v1Win, zBase: zBase, parseSel: parseSel, elKids: elKids, hasClass: hasClass,
    hash: hash, detect: detect, parseHtml: parseHtml, select: select, textOf: textOf, cssParse: cssParse, cssStr: cssStr,
    parseGsap: parseGsap, buildSegments: buildSegments, makeEval: makeEval, easeFn: easeFn, composeAt: composeAt, lerpVal: lerpVal,
    rdp: rdp, compressTracks: compressTracks, emitTracks: emitTracks, objLit: objLit, fmtN: fmtN,
    staticBlock: staticBlock, semanticMotion: semanticMotion, revealLines: revealLines, finishBlock: finishBlock, blockWrap: blockWrap, labelOf: labelOf, motionLabel: motionLabel,
    assemble: assemble, generate: generate, durOf: durOf, clipFp: clipFp, clipData: clipData, safeId: safeId, wordTimes: wordTimes, tCss: tCss, mCss: mCss, svgFor: svgFor,
    fromMusaHtml: fromMusaHtml, fromTrace: fromTrace, toRemotion: toRemotion, toJson: toJson, fromJson: fromJson, relayoutV1: relayoutV1,
  };
});
