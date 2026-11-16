/* video-live-core.js — «código vivo»: Three.js, React Three Fiber, p5.js, PixiJS, WebGL, canvas y Lottie como clips
 * EDITABLES del editor de video de Musa (y del HTML que Musa exporta).
 *
 * Un clip de código vivo es un clip de media (pista M) con `live = { src, kind, sel, off, speed, loop, ov, W, H }`:
 *  · src  el código tal cual (HTML, JS suelto o Remotion TSX). Lo que escribe una IA con las skills de HyperFrames,
 *         Remotion u onetake entra sin cambios.
 *  · El código corre en un iframe aislado (sin origen) con un reloj virtual: cada cuadro se pide por tiempo y vuelve
 *    como imagen. Funciona con los cuatro contratos de tiempo que usan las skills de video:
 *      - `hf-seek` (HyperFrames: e.detail.time / waitUntil), `window.__seek(t)` + `__ready` + `__meta` (onetake),
 *      - timelines de GSAP en window.__timelines, Lottie/anime en __hfLottie/__hfAnime,
 *      - requestAnimationFrame / setAnimationLoop / p5 draw() (se avanza cuadro a cuadro, determinista),
 *      - Remotion: useCurrentFrame() + <ThreeCanvas> (@remotion/three con React Three Fiber).
 *  · Editable sin tocar el código: parámetros (objetos `params`/`config`/`settings`…, constantes en MAYÚSCULAS,
 *    defaultProps de Remotion, rangos de lil-gui), objetos de la escena 3D de Three.js (mover, girar, escalar, color,
 *    visible, opacidad, intensidad de luces, FOV de la cámara) y todo eso con keyframes. `ov` guarda esos cambios:
 *      p:<objeto>.<ruta>  parámetro de un objeto     v:<CONSTANTE>  constante     r:<prop>  prop de Remotion
 *      o:<objeto3D>|<prop>  ajuste de la escena 3D (px py pz rx ry rz s color vis op int fov)
 *    Cada entrada es { v } (valor fijo) o { kf: [{ t, v, e }] } (keyframes con tiempo del clip).
 *
 * Puro en lo que corre en el editor y en el servidor (sin DOM fuera de las funciones del sandbox). El servidor MCP lo
 * importa para escribir el HTML de un video con clips 3D (driverScript).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  root.MusaVideoLive = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ═════════════ herramientas puras (también van dentro del HTML exportado) ═════════════ */
  function toolsMain() {
    var TV = "0.170.0", JD = "https://cdn.jsdelivr.net/npm/";
    var IMPORTS = {
      three: JD + "three@" + TV + "/build/three.module.js",
      "three/webgpu": JD + "three@" + TV + "/build/three.webgpu.js",
      "three/tsl": JD + "three@" + TV + "/build/three.tsl.js",
      "three/addons/": JD + "three@" + TV + "/examples/jsm/",
      "three/examples/jsm/": JD + "three@" + TV + "/examples/jsm/",
    };
    var P5_URL = JD + "p5@1.11.1/lib/p5.min.js";
    var LIBS_REMOTION = [JD + "react@18.3.1/umd/react.production.min.js", JD + "react-dom@18.3.1/umd/react-dom.production.min.js", JD + "@babel/standalone@7.26.4/babel.min.js"];
    var RK = ["Children", "Component", "Fragment", "Profiler", "PureComponent", "StrictMode", "Suspense", "cloneElement", "createContext", "createElement", "createFactory", "createRef", "forwardRef", "isValidElement", "lazy", "memo", "startTransition", "useCallback", "useContext", "useDebugValue", "useDeferredValue", "useEffect", "useId", "useImperativeHandle", "useInsertionEffect", "useLayoutEffect", "useMemo", "useReducer", "useRef", "useState", "useSyncExternalStore", "useTransition", "version", "__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED"];
    var DK = ["createPortal", "flushSync", "render", "unmountComponentAtNode", "createRoot", "hydrateRoot", "findDOMNode", "unstable_batchedUpdates", "version", "__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED"];
    var shim = function (g, keys) { return "data:text/javascript," + encodeURIComponent("const M = window." + g + "; export default M; export const { " + keys.join(", ") + " } = M;"); };
    /* React Three Fiber con el MISMO React del mini-Remotion (UMD): react / react-dom se resuelven a window.React */
    var R3_IMPORTS = Object.assign({}, IMPORTS, {
      react: shim("React", RK), "react-dom": shim("ReactDOM", DK), "react-dom/client": shim("ReactDOM", DK),
      "react/jsx-runtime": "data:text/javascript," + encodeURIComponent("const R = window.React; export const Fragment = R.Fragment; export function jsx(t, p, k) { return R.createElement(t, k === undefined ? p : Object.assign({ key: k }, p)); } export const jsxs = jsx; export const jsxDEV = jsx;"),
      "@react-three/fiber": "https://esm.sh/@react-three/fiber@8.17.10?external=react,react-dom,three&target=es2022",
      "@react-three/drei": "https://esm.sh/@react-three/drei@9.121.5?external=react,react-dom,three,@react-three/fiber&target=es2022",
    });
    var LIB_NAMES = { "three-r3f": "React Three Fiber", three: "Three.js", p5: "p5.js", pixi: "PixiJS", lottie: "Lottie", webgl: "WebGL", canvas: "Canvas 2D", code: "Código" };

    function libOf(src) {
      var s = String(src || "");
      if (/@react-three\/|ThreeCanvas|@remotion\/three/.test(s)) return "three-r3f";
      if (/\bTHREE\.|from\s*["']three(?:\/[^"']*)?["']|three(?:\.module|\.core)?(?:\.min)?\.js/.test(s)) return "three";
      if (/p5(?:\.min)?\.js|new\s+p5\s*\(|\bcreateCanvas\s*\(/.test(s)) return "p5";
      if (/\bPIXI\.|pixi(?:\.min)?\.js|from\s*["']pixi\.js["']/.test(s)) return "pixi";
      if (/lottie|bodymovin|dotlottie/i.test(s)) return "lottie";
      if (/getContext\(\s*["'](?:webgl2?|webgpu)["']|navigator\.gpu/.test(s)) return "webgl";
      if (/getContext\(\s*["']2d["']/.test(s)) return "canvas";
      return "code";
    }
    function isHtml(s) { return /<(?:!doctype|html|head|body|script|canvas|div|svg|main|section|style)\b/i.test(s); }
    /* código que dibuja en un canvas aunque venga sin HTML (lo que suele escribir una IA) */
    function isCanvasCode(src) { var s = String(src || ""); return !isHtml(s) && libOf(s) !== "code" && libOf(s) !== "three-r3f"; }
    function injectHead(s, tag) {
      var m = /<head[^>]*>/i.exec(s); if (m) return s.slice(0, m.index + m[0].length) + tag + s.slice(m.index + m[0].length);
      var b = /<html[^>]*>/i.exec(s); if (b) return s.slice(0, b.index + b[0].length) + "<head>" + tag + "</head>" + s.slice(b.index + b[0].length);
      return tag + s;
    }
    function wrapJs(js) {
      var lib = libOf(js), mod = /^\s*(?:import|export)\s/m.test(js);
      var body;
      if (lib === "p5" && !mod) body = "<script>\n" + js + "\n<\/script>";
      else if (lib === "three" && !/from\s*["']three/.test(js)) body = '<script type="module">\nimport * as THREE from "three";\nwindow.THREE = THREE;\n' + js + "\n<\/script>";
      else body = "<script" + (mod ? ' type="module"' : "") + ">\n" + js + "\n<\/script>";
      return "<!doctype html>\n<html>\n<head>\n<meta charset=\"utf-8\">\n<style>html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; } canvas { display: block; }</style>\n</head>\n<body>\n" + body + "\n</body>\n</html>";
    }
    /* deja el código listo para correr: HTML completo, import map de three y la librería de p5 si faltan */
    function prep(src) {
      var s = String(src || "");
      if (!isHtml(s)) s = wrapJs(s);
      if (/(?:from|import)\s*\(?\s*["']three(?:\/[^"']*)?["']/.test(s) && !/type\s*=\s*["']importmap["']/i.test(s)) s = injectHead(s, '<script type="importmap">' + JSON.stringify({ imports: IMPORTS }) + "<\/script>");
      if (libOf(s) === "p5" && !/p5(?:\.min)?\.js/.test(s) && /function\s+(?:setup|draw)\s*\(/.test(s)) s = injectHead(s, '<script src="' + P5_URL + '"><\/script>');
      return s;
    }

    /* ── analizador de literales (sin ejecutar nada): encuentra los valores que se pueden editar ── */
    var TOKRE = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\[\s\S])*`|0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[A-Za-z_$][\w$]*|\.\.\.|[\s\S]/g;
    function lex(s, a, b) {
      var out = [], m; TOKRE.lastIndex = a;
      while (TOKRE.lastIndex < b && (m = TOKRE.exec(s))) {
        if (m.index >= b) break;
        var v = m[0]; if (/^\s/.test(v) || /^\/[\/*]/.test(v)) continue;
        out.push({ v: v, s: m.index, e: m.index + v.length });
      }
      return out;
    }
    function closeOf(s, a) {
      TOKRE.lastIndex = a; var d = 0, m;
      while ((m = TOKRE.exec(s))) { var v = m[0]; if (v === "{") d++; else if (v === "}") { d--; if (!d) return m.index; } if (TOKRE.lastIndex >= s.length) break; }
      return -1;
    }
    function unq(v) {
      try { if (v[0] === "'") return JSON.parse('"' + v.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"') + '"'); if (v[0] === "`") return v.slice(1, -1); return JSON.parse(v); }
      catch (e) { return v.slice(1, -1); }
    }
    function litOf(v, neg) {
      if (/^0[xX]/.test(v)) return { type: "hex", v: parseInt(v, 16) };
      if (/^(?:\d|\.\d)/.test(v)) return { type: "num", v: (neg ? -1 : 1) * parseFloat(v) };
      if (/^["'`]/.test(v)) {
        if (v[0] === "`" && v.indexOf("${") >= 0) return null;
        var t = unq(v);
        if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(t)) return { type: "color", v: t, q: v[0] };
        if (t.length > 240 || /\n/.test(t)) return null;
        return { type: "text", v: t, q: v[0] };
      }
      if (v === "true" || v === "false") return { type: "bool", v: v === "true" };
      return null;
    }
    function skipVal(T, k) { var d = 0; for (; k < T.length; k++) { var v = T[k].v; if (v === "{" || v === "[" || v === "(") d++; else if (v === "}" || v === "]" || v === ")") d--; else if (v === "," && d <= 0) return k + 1; } return k; }
    function idxAfter(T, pos) { for (var i = 0; i < T.length; i++) if (T[i].s > pos) return i; return T.length; }
    function objProps(s, a, b, obj, prefix, depth, out) {
      var T = lex(s, a + 1, b), k = 0, n = T.length;
      while (k < n) {
        var key = T[k];
        if (key.v === ",") { k++; continue; }
        var kn = /^["']/.test(key.v) ? unq(key.v) : key.v;
        if (!/^[\w$-]+$/.test(kn) || !T[k + 1] || T[k + 1].v !== ":") { k = skipVal(T, k); continue; }
        var vk = k + 2, neg = false;
        if (T[vk] && (T[vk].v === "-" || T[vk].v === "+") && T[vk + 1] && /^(?:\d|\.\d)/.test(T[vk + 1].v)) { neg = T[vk].v === "-"; vk++; }
        var vt = T[vk], after = T[vk + 1];
        if (vt && vt.v === "{" && depth < 2) {
          var cb = closeOf(s, vt.s);
          if (cb > 0) { objProps(s, vt.s, cb, obj, prefix + kn + ".", depth + 1, out); k = idxAfter(T, cb); continue; }
        }
        var lit = vt && (!after || after.v === "," || after.v === "}") ? litOf(vt.v, neg) : null;
        if (lit && out.length < 120) out.push(Object.assign(lit, { key: "p:" + obj + "." + prefix + kn, obj: obj, path: prefix + kn, name: prefix + kn, s: neg ? T[vk - 1].s : vt.s, e: vt.e, kfable: lit.type === "num" }));
        k = skipVal(T, k + 2);
      }
    }
    var PN = /^(?:params|PARAMS|parameters|PARAMETERS|config|CONFIG|conf|CONF|cfg|CFG|settings|SETTINGS|options|OPTIONS|opts|OPTS|controls|CONTROLS|guiParams|effectController|api|API|look|LOOK|theme|THEME|tweaks|TWEAKS|style|STYLE|uniformsConfig)$/;
    function analyze(src) {
      var s = String(src || ""), out = [], objs = [], seen = {}, gui = {}, m;
      var GA = /\.add(Color)?\(\s*([A-Za-z_$][\w$.]*)\s*,\s*["']([\w$]+)["']\s*(?:,\s*(-?[\d.]+(?:e-?\d+)?)\s*,\s*(-?[\d.]+(?:e-?\d+)?)\s*(?:,\s*(-?[\d.]+(?:e-?\d+)?))?)?/g;
      while ((m = GA.exec(s))) { var on = m[2].split(".").pop(); gui[on] = gui[on] || {}; gui[on][m[3]] = { color: !!m[1], min: m[4] != null ? +m[4] : null, max: m[5] != null ? +m[5] : null, step: m[6] != null ? +m[6] : null }; }
      var OR = /(?:^|[^\w$.])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[\w$<>\[\],.\s]+?)?=\s*\{/g;
      while ((m = OR.exec(s))) {
        var name = m[1], br = m.index + m[0].length - 1;
        var tagged = /@musa\b/.test(s.slice(Math.max(0, m.index - 90), m.index + 1));
        if (seen[name] || !(PN.test(name) || gui[name] || tagged)) continue;
        var cb = closeOf(s, br); if (cb < 0) continue;
        seen[name] = 1;
        var before = out.length;
        objProps(s, br, cb, name, "", 0, out);
        if (out.length > before) objs.push({ name: name, a: br, b: cb });
        if (out.length >= 120) break;
      }
      /* Remotion: las props por defecto de la composición son sus parámetros */
      var DR = /defaultProps\s*(?:=\s*\{\s*|:\s*)\{/g;
      while ((m = DR.exec(s))) {
        var b2 = m.index + m[0].length - 1, c2 = closeOf(s, b2); if (c2 < 0) continue;
        var tmp = []; objProps(s, b2, c2, "__props", "", 0, tmp);
        tmp.forEach(function (p) { p.key = "r:" + p.path; p.obj = null; out.push(p); });
        break;
      }
      /* constantes de configuración: en MAYÚSCULAS al inicio de una línea, o marcadas con // @musa */
      var CR = /(^|\n)([ \t]*(?:\/\/[^\n]*@musa[^\n]*\n[ \t]*)?)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[\w$]+\s*)?=\s*(-\s*)?(0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|"[^"\n]*"|'[^'\n]*'|true|false)(?=\s*[;\n,])/g;
      while ((m = CR.exec(s))) {
        var nm = m[3]; if (!(/^[A-Z][A-Z0-9_]+$/.test(nm) || /@musa/.test(m[2]))) continue;
        if (out.some(function (p) { return p.key === "v:" + nm; })) continue;
        var e = m.index + m[0].length, st = e - m[5].length, lit = litOf(m[5], !!m[4]);
        if (!lit) continue;
        out.push(Object.assign(lit, { key: "v:" + nm, name: nm, s: m[4] ? st - m[4].length : st, e: e, kfable: false }));
        if (out.length >= 140) break;
      }
      out.forEach(function (p) {
        if (!p.obj) return;
        var g = gui[p.obj] && gui[p.obj][p.path]; if (!g) return;
        if (g.min != null) { p.min = g.min; p.max = g.max; if (g.step != null) p.step = g.step; }
        if (g.color && p.type === "num") p.type = "hex";
      });
      return { params: out, objs: objs, lib: libOf(s) };
    }
    /* el código con los parámetros conectados a Musa (los valores fijos y los keyframes llegan sin reescribir nada) */
    function instrument(src, an, sm) {
      var s = String(src), ed = [];
      /* cada objeto 3D del código sabe de qué variable salió (const cube = new THREE.Mesh… → userData.__mv = "cube") */
      if (sm) sm.objs.forEach(function (o) {
        if (o.jsx) { if (!o.camHost && !o.hasUD) ed.push([o.tagIns, " userData={{ __mv: " + JSON.stringify(o.v) + " }}", true]); return; }
        ed.push([o.nw, "__musaTag(" + JSON.stringify(o.v) + ", "]); ed.push([o.close + 1, ")"]);
      });
      an.objs.forEach(function (o) { ed.push([o.a, "__musaP(" + JSON.stringify(o.name) + ", "]); ed.push([o.b + 1, ")"]); });
      an.params.forEach(function (p) { if (p.key.charAt(0) === "v") { ed.push([p.s, "__musaV(" + JSON.stringify(p.name) + ", "]); ed.push([p.e, ")"]); } });
      ed.sort(function (x, y) { return y[0] - x[0]; });
      ed.forEach(function (x) { s = x[2] ? insAttr(s, x[0], x[1]) : s.slice(0, x[0]) + x[1] + s.slice(x[0]); });
      return s;
    }
    function fmtLit(p, v) {
      if (p.type === "num") { var n = +v; return isFinite(n) ? String(Math.round(n * 1e6) / 1e6) : String(p.v); }
      if (p.type === "hex") { var h = typeof v === "number" ? v : parseInt(String(v).replace("#", ""), 16); return "0x" + ("000000" + ((h >>> 0) & 0xffffff).toString(16)).slice(-6); }
      if (p.type === "bool") return v ? "true" : "false";
      var str = String(v);
      return p.q === "'" ? "'" + str.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n") + "'" : JSON.stringify(str);
    }
    function isStatic(e) { return e && e.v !== undefined && !(e.kf && e.kf.length); }
    /* los valores fijos que se cambiaron en Musa, escritos en el código (lo que se exporta y lo que lee una IA) */
    function bake(src, an, ov) {
      var s = String(src);
      an.params.filter(function (p) { var e = ov && ov[p.key]; return isStatic(e) && e.v !== p.v; }).sort(function (a, b) { return b.s - a.s; })
        .forEach(function (p) { s = s.slice(0, p.s) + fmtLit(p, ov[p.key].v) + s.slice(p.e); });
      return s;
    }
    function valAt(e, t, d) {
      if (!e) return d;
      var K = e.kf; if (!K || !K.length) return e.v !== undefined ? e.v : d;
      if (K.length === 1 || t <= K[0].t) return K[0].v;
      var L = K[K.length - 1]; if (t >= L.t) return L.v;
      for (var i = 1; i < K.length; i++) if (t <= K[i].t) {
        var a = K[i - 1], b = K[i], u = (t - a.t) / Math.max(1e-6, b.t - a.t);
        if (a.e === "smooth") u = u * u * (3 - 2 * u); else if (a.e === "in") u = u * u; else if (a.e === "out") u = 1 - (1 - u) * (1 - u); else if (a.e === "hold") u = 0;
        return typeof a.v === "number" && typeof b.v === "number" ? a.v + (b.v - a.v) * u : (u < 1 ? a.v : b.v);
      }
      return L.v;
    }
    /* el código que corre de verdad (preparado + parámetros conectados) */
    function runSrc(live) {
      var rem = live.kind === "remotion", src = canon(String(live.src || ""));
      if (!rem) src = prep(src);
      var sm = sceneMap(src);
      return instrument(src, analyze(src), rem ? { objs: sm.objs.filter(function (o) { return o.jsx; }) } : sm);
    }
    function usesR3(live) { return live.kind === "remotion" && /@react-three\/|@remotion\/three|ThreeCanvas|from\s*["']three["']/.test(String(live.src || "")); }
    /* lo que va en data-musa: sin el código (va aparte, legible) ni los ajustes (están escritos en el código y en su bloque ▸ musa) */
    function liveMeta(live) {
      var o = {}; Object.keys(live || {}).forEach(function (k) { if (k !== "src" && k !== "ov") o[k] = live[k]; });
      return o;
    }
    function bakedSrc(live) { return normalize(Object.assign({}, live)).src; }

    /* ═════════════ código ↔ editor: el código manda (sin IA) ═════════════
       Lo que se cambia en el inspector o por MCP se escribe en el código al instante:
        · valor fijo de un parámetro → su literal en su lugar (speed: 1 → speed: 2)
        · objetos de Three.js con variable (const cube = new THREE.Mesh(…)) → sus literales (cube.position.set(0, 1, 0),
          color: 0xff5e00, new THREE.DirectionalLight(0xffffff, 2)…) o una línea nueva después de crearlos; si el valor
          sale de un parámetro (color: params.color) se cambia el parámetro
        · keyframes y ajustes sobre lo que el código anima en cada cuadro → el bloque «▸ musa» (JSON en un comentario)
       Al revés: al cambiar el código se vuelve a leer todo (parámetros, objetos, bloque) y todo vuelve a ser editable. */
    var PROPS3 = ["px", "py", "pz", "rx", "ry", "rz", "s", "color", "emi", "op", "int", "vis", "fov"];
    var ADD3 = { px: 1, py: 1, pz: 1, rx: 1, ry: 1, rz: 1 }, MUL3 = { s: 1, op: 1, "int": 1 };
    var LAB3 = { px: "mover X (+)", py: "mover Y (+)", pz: "mover Z (+)", rx: "girar X (+°)", ry: "girar Y (+°)", rz: "girar Z (+°)", s: "escala (×)", color: "color", emi: "brillo propio", op: "opacidad (×)", "int": "intensidad (×)", vis: "visible", fov: "apertura (FOV°)" };
    function off0(pr) { return ADD3[pr] ? 0 : MUL3[pr] ? 1 : undefined; }
    /* un ajuste del bloque sobre el valor base: posición y giro se suman; escala, opacidad e intensidad multiplican; el resto reemplaza */
    function comb3(pr, base, off) { if (off === undefined || off === null) return base; if (ADD3[pr]) return (+base || 0) + (+off || 0); if (MUL3[pr]) return (base == null ? 1 : +base) * (+off); return off; }
    function toOff3(pr, v, base) { if (ADD3[pr]) return (+v || 0) - (+base || 0); if (MUL3[pr]) { var b = base == null ? 1 : +base; return b ? +v / b : 1; } return v; }
    function rnd(n, k) { var f = Math.pow(10, k == null ? 4 : k); return Math.round(n * f) / f; }
    function fmtN(n) { return String(rnd(+n || 0)); }
    function hex6(v) { if (typeof v === "number") return "#" + ("000000" + ((v >>> 0) & 0xffffff).toString(16)).slice(-6); var t = String(v || ""); return /^#[0-9a-f]{3}$/i.test(t) ? "#" + t[1] + t[1] + t[2] + t[2] + t[3] + t[3] : t; }

    function closeAny(s, a) {
      var op = s.charAt(a), cl = op === "(" ? ")" : op === "[" ? "]" : "}", d = 0, m;
      TOKRE.lastIndex = a;
      while (TOKRE.lastIndex < s.length && (m = TOKRE.exec(s))) { var v = m[0]; if (v === op) d++; else if (v === cl) { d--; if (!d) return m.index; } }
      return -1;
    }
    /* los argumentos de una llamada: rangos [s, e) de cada uno, sin espacios */
    function argsOf(s, open) {
      var close = closeAny(s, open); if (close < 0) return null;
      var T = lex(s, open + 1, close), args = [], d = 0, st = -1, le = -1;
      for (var i = 0; i < T.length; i++) {
        var t = T[i];
        if (t.v === "," && d === 0) { if (st >= 0) args.push({ s: st, e: le }); st = -1; continue; }
        if (st < 0) st = t.s;
        if (t.v === "(" || t.v === "[" || t.v === "{") d++; else if (t.v === ")" || t.v === "]" || t.v === "}") d--;
        le = t.e;
      }
      if (st >= 0) args.push({ s: st, e: le });
      return { open: open, close: close, args: args };
    }
    /* el valor de una expresión constante (números, Math.PI, + − × ÷, paréntesis) sin ejecutar nada */
    function constNum(txt) {
      var T = lex(txt, 0, txt.length), i = 0;
      function pk() { return T[i] ? T[i].v : null; }
      function prim() {
        var v = pk();
        if (v === "-") { i++; var x = prim(); return x == null ? null : -x; }
        if (v === "+") { i++; return prim(); }
        if (v === "(") { i++; var y = sum(); if (pk() !== ")") return null; i++; return y; }
        if (v === "Math" && T[i + 1] && T[i + 1].v === "." && T[i + 2] && T[i + 2].v === "PI") { i += 3; return Math.PI; }
        if (v != null && /^0[xX]/.test(v)) { i++; return parseInt(v, 16); }
        if (v != null && /^(?:\d|\.\d)/.test(v)) { i++; return parseFloat(v); }
        return null;
      }
      function mul() { var x = prim(); while (x != null && (pk() === "*" || pk() === "/")) { var o = T[i++].v, y = prim(); if (y == null) return null; x = o === "*" ? x * y : x / y; } return x; }
      function sum() { var x = mul(); while (x != null && (pk() === "+" || pk() === "-")) { var o = T[i++].v, y = mul(); if (y == null) return null; x = o === "+" ? x + y : x - y; } return x; }
      var r = T.length ? sum() : null;
      return r != null && i === T.length && isFinite(r) ? r : null;
    }
    /* qué parámetro es una expresión que solo lo lee (params.color, SPEED, color de las props de Remotion) */
    function refOf(t, an) {
      var m = /^([A-Za-z_$][\w$]*)((?:\s*\.\s*[A-Za-z_$][\w$]*)+)$/.exec(t);
      var has = function (k) { return an.params.some(function (p) { return p.key === k; }); };
      if (m) { var k = "p:" + m[1] + m[2].replace(/\s+/g, ""); if (has(k)) return k; return null; }
      if (/^[A-Za-z_$][\w$]*$/.test(t)) { if (has("v:" + t)) return "v:" + t; if (has("r:" + t)) return "r:" + t; }
      return null;
    }
    /* una expresión del código → literal (se reescribe en su lugar), parámetro (se cambia el parámetro) o «la calcula el código» */
    function exprInfo(s, a, b, an) {
      var T = lex(s, a, b); if (!T.length) return null;
      var info = { s: T[0].s, e: T[T.length - 1].e }, t = s.slice(info.s, info.e);
      if (T.length === 1) { var l = litOf(T[0].v, false); if (l) { info.lit = l; return info; } }
      if (T.length === 2 && (T[0].v === "-" || T[0].v === "+") && /^(?:\d|\.\d)/.test(T[1].v)) { info.lit = litOf(T[1].v, T[0].v === "-"); return info; }
      var n = constNum(t); if (n != null) { info.lit = { type: "num", v: n, expr: true }; return info; }
      var r = refOf(t, an); if (r) { info.ref = r; return info; }
      info.drv = true; return info;
    }
    /* dónde hay código: el archivo entero (JS/TSX) o los <script> en línea del HTML; sin comentarios ni textos */
    function scriptRanges(s) {
      if (!isHtml(s)) return [[0, s.length]];
      var out = [], re = /<script\b([^>]*)>/gi, m;
      while ((m = re.exec(s))) {
        var a = m.index + m[0].length, rel = s.slice(a).search(/<\/script\s*>/i), e = rel < 0 ? s.length : a + rel;
        if (!/\bsrc\s*=/i.test(m[1]) && !/type\s*=\s*["']?(?:importmap|application\/(?:ld\+)?json|text\/(?:musa|template|x-))/i.test(m[1])) out.push([a, e]);
        re.lastIndex = e;
      }
      return out;
    }
    function codeMask(s) {
      var R = scriptRanges(s), dead = [];
      R.forEach(function (r) { var m; TOKRE.lastIndex = r[0]; while (TOKRE.lastIndex < r[1] && (m = TOKRE.exec(s))) { if (m.index >= r[1]) break; if (/^\/[\/*]|^["'`]/.test(m[0])) dead.push([m.index, m.index + m[0].length]); } });
      return {
        R: R,
        code: function (p) {
          if (!R.some(function (r) { return p >= r[0] && p < r[1]; })) return false;
          var lo = 0, hi = dead.length - 1;
          while (lo <= hi) { var mid = (lo + hi) >> 1; if (p < dead[mid][0]) hi = mid - 1; else if (p >= dead[mid][1]) lo = mid + 1; else return false; }
          return true;
        },
      };
    }
    /* fin de la sentencia (o de la expresión, con coma) que empieza en a */
    function stmtEnd(s, a, expr) {
      var d = 0, m, last = a, any = false;
      TOKRE.lastIndex = a;
      while (TOKRE.lastIndex < s.length && (m = TOKRE.exec(s))) {
        var v = m[0];
        if (/^\s/.test(v)) {
          if (d === 0 && any && v.indexOf("\n") >= 0) {
            var nx = /\S/.exec(s.slice(TOKRE.lastIndex, TOKRE.lastIndex + 200)), pc = s.charAt(last - 1);
            if (!((nx && /[.?:+\-*\/%&|^=,]/.test(nx[0])) || /[=+\-*\/%&|^,(\[{?:.]/.test(pc))) return last;
          }
          continue;
        }
        if (/^\/[\/*]/.test(v)) continue;
        if (v === "<" && /^<\/script/i.test(s.slice(m.index, m.index + 8))) return last;
        if (v === "(" || v === "[" || v === "{") d++;
        else if (v === ")" || v === "]" || v === "}") { if (d === 0) return last; d--; }
        else if (d === 0 && (v === ";" || (expr && v === ","))) return v === ";" && !expr ? m.index + 1 : last;
        last = m.index + v.length; any = true;
      }
      return last;
    }
    function indentAt(s, p) { var ls = s.lastIndexOf("\n", p - 1) + 1; return /^[ \t]*/.exec(s.slice(ls))[0]; }
    /* una línea nueva después de la sentencia que termina en `end` (al final de su línea si se puede) */
    function balanced(s, a, b) { var d = 0; lex(s, a, b).forEach(function (t) { if (/^[([{]$/.test(t.v)) d++; else if (/^[)\]}]$/.test(t.v)) d--; }); return d === 0; }
    function insertLine(s, end, text, indent, vn) {
      var le = s.indexOf("\n", end); if (le < 0) le = s.length;
      var ok = !/<\/script/i.test(s.slice(end, le)) && balanced(s, end, le), at = ok ? le : end;
      /* después de las líneas que siguen configurando ese objeto (cube.name = …; scene.add(cube);) */
      if (ok && vn) {
        var ev = vn.replace(/\$/g, "\\$"), re = new RegExp("^[ \\t]*(?:" + ev + "\\s*\\.|[\\w$]+\\s*\\.\\s*add\\s*\\([^)]*\\b" + ev + "\\b)");
        while (at < s.length) {
          var nl = s.indexOf("\n", at + 1), e2 = nl < 0 ? s.length : nl, line = s.slice(at + 1, e2);
          if (!re.test(line) || /<\/script/i.test(line) || !balanced(s, at + 1, e2)) break;
          at = e2;
        }
      }
      return s.slice(0, at) + "\n" + indent + text + s.slice(at);
    }

    /* ── el mapa de la escena en el código (Three.js sin React): objetos con variable y de dónde sale cada valor ── */
    var CLS3 = /^(?:Mesh|InstancedMesh|SkinnedMesh|BatchedMesh|Points|Line|LineSegments|LineLoop|Sprite|Group|Object3D|LOD|PerspectiveCamera|OrthographicCamera|DirectionalLight|PointLight|SpotLight|AmbientLight|HemisphereLight|RectAreaLight)$/;
    var DECL = /(^|[^\w$.])(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=\s*(new\s+(?:THREE\s*\.\s*)?([A-Z]\w*)\s*)\(/g;
    var ACC = /(^|[^\w$.])([A-Za-z_$][\w$]*)\s*\.\s*(position|rotation|scale|quaternion|lookAt|rotateX|rotateY|rotateZ|rotateOnAxis|rotateOnWorldAxis|translateX|translateY|translateZ|translateOnAxis|intensity|fov|visible|name|material|color|emissive|opacity)\b/g;
    var GSR = /\.(?:to|from|fromTo|set)\s*\(\s*([A-Za-z_$][\w$]*)\s*\.\s*(position|rotation|scale|material)\b(?:\s*\.\s*(color|emissive))?\s*,/g;
    function kind3(c) { return /Camera$/.test(c) ? "cam" : /Light$/.test(c) ? "light" : /^(?:Group|Object3D|LOD)$/.test(c) ? "group" : "mesh"; }
    function objLit(s, a, b, an) {
      var T = lex(s, a + 1, b), out = {}, k = 0;
      while (k < T.length) {
        var key = T[k], kn = /^["']/.test(key.v) ? unq(key.v) : key.v;
        if (T[k + 1] && T[k + 1].v === ":" && /^[\w$]+$/.test(kn)) {
          var vs = k + 2, d = 0, j = vs;
          for (; j < T.length; j++) { var v = T[j].v; if (v === "(" || v === "[" || v === "{") d++; else if (v === ")" || v === "]" || v === "}") d--; else if (v === "," && d === 0) break; }
          if (T[vs] && j > vs) { var inf = exprInfo(s, T[vs].s, T[j - 1].e, an); if (inf) { inf.key = { s: key.s, e: T[j - 1].e }; out[kn] = inf; } }
          k = j + 1;
        } else k = skipVal(T, k);
      }
      return out;
    }
    function matOf(s, cls, ar, an) {
      var a0 = ar.args[0], o = { cls: cls, open: ar.open, close: ar.close, a: -1, b: -1, p: {}, w: {} };
      if (a0 && s.charAt(a0.s) === "{") { var cb = closeAny(s, a0.s); if (cb > 0) { o.a = a0.s; o.b = cb; o.p = objLit(s, a0.s, cb, an); } }
      else if (a0) o.opaque = true;
      return o;
    }
    /* ── React Three Fiber (Remotion con <ThreeCanvas>, @react-three/fiber): cada elemento 3D del JSX es un objeto y sus
       atributos (position={[…]}, rotation, scale, color, intensity, fov, el material hijo) son los literales que se
       reescriben; lo que falta se agrega como atributo. La cámara es la de <ThreeCanvas camera={{ position, fov }}>. ── */
    var JTAG = /<(mesh|instancedMesh|points|line|lineSegments|lineLoop|sprite|group|object3D|perspectiveCamera|orthographicCamera|directionalLight|pointLight|spotLight|ambientLight|hemisphereLight|rectAreaLight)(?=[\s\/>])/g;
    function jsxCls(tag) { return tag.charAt(0).toUpperCase() + tag.slice(1); }
    function isR3(s) { return /<(?:ThreeCanvas|Canvas)(?=[\s\/>])|@react-three\/|@remotion\/three/.test(String(s || "")); }
    /* los atributos de una etiqueta JSX desde i (después del nombre): rango de cada uno y dónde cierra la etiqueta */
    function jsxAttrs(s, i) {
      var by = {}, list = [], n = s.length;
      for (var guard = 0; guard < 200; guard++) {
        while (i < n && /\s/.test(s.charAt(i))) i++;
        var c = s.charAt(i);
        if (c === ">") return { by: by, list: list, end: i, tagEnd: i + 1, self: false };
        if (c === "/" && s.charAt(i + 1) === ">") return { by: by, list: list, end: i, tagEnd: i + 2, self: true };
        if (c === "{") { var cs = closeAny(s, i); if (cs < 0) return null; by.__spread = true; i = cs + 1; continue; }
        var m = /^[A-Za-z_$][\w$:.\-]*/.exec(s.slice(i, i + 80)); if (!m) return null;
        var a = { name: m[0], ns: i, ne: i + m[0].length }; i = a.ne;
        while (i < n && /\s/.test(s.charAt(i))) i++;
        if (s.charAt(i) === "=") {
          i++; while (i < n && /\s/.test(s.charAt(i))) i++;
          var q = s.charAt(i);
          if (q === '"' || q === "'") { var e = s.indexOf(q, i + 1); if (e < 0) return null; a.kind = "str"; a.s = i; a.e = e + 1; i = e + 1; }
          else if (q === "{") { var ce = closeAny(s, i); if (ce < 0) return null; a.kind = "expr"; a.s = i + 1; a.e = ce; i = ce + 1; }
          else return null;
          a.ae = i;
        } else { a.kind = "bool"; a.s = a.ns; a.e = a.ae = a.ne; }
        by[a.name] = a; list.push(a);
      }
      return null;
    }
    function jsxScene(s, M, an, objs, by) {
      var m, cnt = {}, X = ["x", "y", "z"];
      function W(t, pr, inf) { if (inf) (t.w[pr] = t.w[pr] || []).push(inf); }
      function drv(t, pr) { W(t, pr, { drv: true, s: -1, e: -1 }); }
      function info(a) { return a.kind === "bool" ? { s: a.ns, e: a.ae, lit: { type: "bool", v: true }, jsxBool: a.name } : exprInfo(s, a.s, a.e, an) || { drv: true, s: -1, e: -1 }; }
      /* position / rotation / scale: arreglo de literales (cada eje en su lugar) o una expresión (la calcula el código) */
      function vec(o, P, a) {
        var lead = s.slice(a.s, a.e).search(/\S/), at = a.s + (lead < 0 ? 0 : lead);
        if (a.kind !== "bool" && s.charAt(at) === "[") {
          var ar = argsOf(s, at);
          if (ar) {
            var gi = ar.args.slice(0, 3).map(function (g) { return exprInfo(s, g.s, g.e, an); });
            if (P === "s") {
              if (gi.length === 3 && gi.every(function (g) { return g && g.lit && g.lit.type === "num"; }) && gi[0].lit.v === gi[1].lit.v && gi[1].lit.v === gi[2].lit.v) W(o, "s", { s: gi[0].s, e: gi[0].e, lit: gi[0].lit, multi: gi });
              else if (gi.length === 3 && gi.every(function (g) { return g && g.ref && g.ref === gi[0].ref; })) W(o, "s", gi[0]);
              else drv(o, "s");
            } else X.forEach(function (x, i) { W(o, P + x, gi[i] || { drv: true, s: -1, e: -1 }); });
            return;
          }
        }
        var inf = info(a);
        if (P === "s" && (inf.lit || inf.ref)) { W(o, "s", inf); return; }
        X.forEach(function (x) { drv(o, P === "s" ? "s" : P + x); });
      }
      JTAG.lastIndex = 0;
      while ((m = JTAG.exec(s))) {
        if (!M.code(m.index) || objs.length >= 80) continue;
        var tag = m[1], A = jsxAttrs(s, m.index + m[0].length); if (!A) continue;
        cnt[tag] = (cnt[tag] || 0) + 1;
        var cls = jsxCls(tag), o = { v: "<" + tag + ">" + (cnt[tag] > 1 ? cnt[tag] : ""), cls: cls, kind: kind3(cls), jsx: true, tag: tag, at: m.index, tagIns: A.end, end: A.tagEnd, self: A.self, w: {}, ctor: {}, name: null, mat: null, dash: {}, spread: !!A.by.__spread };
        A.list.forEach(function (a) {
          var nm = a.name;
          if (nm === "name") { var ni = info(a); if (ni.lit && ni.lit.type !== "num" && ni.lit.type !== "bool") o.name = String(ni.lit.v); }
          else if (nm === "position" || nm === "rotation") vec(o, nm.charAt(0), a);
          else if (nm === "scale") vec(o, "s", a);
          else if (/^(?:position|rotation)-[xyz]$/.test(nm)) { o.dash[nm.charAt(0)] = 1; W(o, nm.charAt(0) + nm.slice(-1), info(a)); }
          else if (/^scale-[xyz]$/.test(nm)) drv(o, "s");
          else if (nm === "visible") W(o, "vis", info(a));
          else if (nm === "intensity") W(o, "int", info(a));
          else if (nm === "fov") W(o, "fov", info(a));
          else if (nm === "color" && o.kind === "light") W(o, "color", info(a));
          else if (nm === "material-color") W(o, "color", info(a));
          else if (nm === "material-emissive") W(o, "emi", info(a));
          else if (nm === "material-opacity") W(o, "op", info(a));
          else if (nm === "userData") o.hasUD = true;
          else if (nm === "lookAt" || nm === "quaternion" || nm === "up") X.forEach(function (x) { drv(o, "r" + x); });
        });
        /* el material como hijo: <meshStandardMaterial color=… /> (después de la geometría) */
        if (!A.self && o.kind === "mesh") {
          var j = A.tagEnd;
          for (var g = 0; g < 12; g++) {
            var lt = s.indexOf("<", j); if (lt < 0) break;
            if (!M.code(lt)) { j = lt + 1; continue; }
            if (s.charAt(lt + 1) === "/") break;
            var tm = /^<([A-Za-z][\w.]*)/.exec(s.slice(lt, lt + 80)); if (!tm) break;
            var B = jsxAttrs(s, lt + tm[0].length); if (!B) break;
            if (/^[a-z]\w*Material$/.test(tm[1])) {
              o.mat = { cls: jsxCls(tm[1]), jsx: true, tagIns: B.end, transparent: !!B.by.transparent, p: {}, w: {}, a: -1 };
              B.list.forEach(function (a) { var k = a.name === "color" ? "color" : a.name === "emissive" ? "emi" : a.name === "opacity" ? "op" : null; if (k && a.kind !== "bool") W(o, k, info(a)); });
              break;
            }
            if (B.self && /Geometry$|^primitive$/.test(tm[1])) { j = B.tagEnd; continue; }
            break;
          }
        }
        by[o.v] = o; objs.push(o);
      }
      if (objs.some(function (x) { return x.kind === "cam"; })) return;
      /* la cámara de <ThreeCanvas camera={{ position: […], fov }}> / <Canvas camera={…}> */
      var cre = /<(ThreeCanvas|Canvas)(?=[\s\/>])/g, cm;
      while ((cm = cre.exec(s))) {
        if (!M.code(cm.index)) continue;
        var CA = jsxAttrs(s, cm.index + cm[0].length); if (!CA) return;
        var co = { v: "<camera>", cls: "PerspectiveCamera", kind: "cam", jsx: true, camHost: true, tag: cm[1], at: cm.index, tagIns: CA.end, end: CA.tagEnd, w: {}, ctor: {}, name: null, mat: null, dash: {} };
        var ca = CA.by.camera;
        if (ca && ca.kind === "expr") {
          var ob = ca.s + Math.max(0, s.slice(ca.s, ca.e).search(/\S/)), obE = s.charAt(ob) === "{" ? closeAny(s, ob) : -1;
          if (obE > 0) {
            co.camObj = { a: ob, b: obE };
            var ent = objLit(s, ob, obE, an);
            if (ent.position) { if (s.charAt(ent.position.s) === "[") vec(co, "p", { s: ent.position.s, e: ent.position.e, kind: "expr" }); else X.forEach(function (x) { drv(co, "p" + x); }); }
            if (ent.fov) W(co, "fov", ent.fov);
          } else ["px", "py", "pz", "fov"].forEach(function (pr) { drv(co, pr); });
        } else if (ca) ["px", "py", "pz", "fov"].forEach(function (pr) { drv(co, pr); });
        /* el giro de la cámara lo pone R3F (mira al centro): ajuste en el bloque */
        X.forEach(function (x) { drv(co, "r" + x); });
        by[co.v] = co; objs.push(co);
        return;
      }
    }
    var SMC = { h: null, v: null };
    function sceneMap(src) {
      var s = String(src || ""), h = hash(s); if (SMC.h === h) return SMC.v;
      var an = analyze(s), M = codeMask(s), objs = [], by = {}, mats = {}, scenes = [], m;
      DECL.lastIndex = 0;
      while ((m = DECL.exec(s))) {
        var at = m.index + m[1].length; if (!M.code(at)) continue;
        var vn = m[2], cls = m[4], open = m.index + m[0].length - 1;
        if (cls === "Scene") { scenes.push({ v: vn, end: stmtEnd(s, at, false), at: at }); continue; }
        var mt = /Material$/.test(cls); if (!mt && !CLS3.test(cls)) continue;
        var ar = argsOf(s, open); if (!ar) continue;
        if (mt) { if (!mats[vn]) mats[vn] = matOf(s, cls, ar, an); continue; }
        if (by[vn]) { by[vn].multi = true; continue; }
        if (objs.length >= 80) continue;
        var o = { v: vn, cls: cls, kind: kind3(cls), at: at, nw: open - m[3].length, close: ar.close, end: stmtEnd(s, at, false), w: {}, ctor: {}, name: null, mat: null };
        if (o.kind === "light") {
          var ii = /Hemisphere/.test(cls) ? 2 : 1;
          if (ar.args[0]) o.ctor.color = exprInfo(s, ar.args[0].s, ar.args[0].e, an);
          if (ar.args[ii]) o.ctor["int"] = exprInfo(s, ar.args[ii].s, ar.args[ii].e, an);
        }
        if (cls === "PerspectiveCamera" && ar.args[0]) o.ctor.fov = exprInfo(s, ar.args[0].s, ar.args[0].e, an);
        if (o.kind === "mesh" && ar.args[1]) {
          var ma = ar.args[1], mtx = s.slice(ma.s, ma.e), mm = /^new\s+(?:THREE\s*\.\s*)?([A-Z]\w*Material)\s*\(/.exec(mtx);
          if (mm) { var ar2 = argsOf(s, ma.s + mm[0].length - 1); if (ar2) o.mat = matOf(s, mm[1], ar2, an); }
          else if (/^[A-Za-z_$][\w$]*$/.test(mtx)) o.matVar = mtx;
        }
        by[vn] = o; objs.push(o);
      }
      objs.forEach(function (o) { if (o.matVar) { o.mat = mats[o.matVar] || null; if (o.mat) o.mat.shared = (o.mat.shared || 0) + 1; } });
      function W(t, pr, inf) { if (inf) (t.w[pr] = t.w[pr] || []).push(inf); }
      function drv(t, pr) { W(t, pr, { drv: true, s: -1, e: -1 }); }
      function drvVec(t, P, axes) { (axes || ["x", "y", "z"]).forEach(function (ax) { drv(t, P === "s" ? "s" : P + ax); }); }
      function colorW(t, pr, rest, call, ar, asg, rhs) {
        if (asg && !rest.length) return drv(t, pr);
        if (call && rest.length === 1 && /^(?:set|setHex|setStyle)$/.test(rest[0]) && ar && ar.args.length === 1) return W(t, pr, exprInfo(s, ar.args[0].s, ar.args[0].e, an));
        if (call || asg) drv(t, pr);
      }
      ACC.lastIndex = 0;
      while ((m = ACC.exec(s))) {
        var p0 = m.index + m[1].length, vn2 = m[2], ob = by[vn2], mt2 = mats[vn2];
        if ((!ob && !mt2) || !M.code(p0)) continue;
        var T = lex(s, p0, Math.min(s.length, p0 + 600)), ch = [], k = 1;
        while (T[k] && T[k].v === "." && T[k + 1] && /^[A-Za-z_$]/.test(T[k + 1].v)) { ch.push(T[k + 1].v); k += 2; }
        var nx = T[k], nx2 = T[k + 1], adj = nx && nx2 && nx2.s === nx.e;
        var call = !!(nx && nx.v === "("), asg = !!(nx && nx.v === "=" && !(nx2 && nx2.v === "=" && adj));
        var cmp = !!(nx && /^[-+*\/%]$/.test(nx.v) && nx2 && nx2.v === "=" && adj), inc = !!(nx && (nx.v === "+" || nx.v === "-") && nx2 && nx2.v === nx.v && adj);
        if (!call && !asg && !cmp && !inc) continue;
        var rhs = asg ? exprInfo(s, nx.e, stmtEnd(s, nx.e, true), an) : null, ar3 = call ? argsOf(s, nx.s) : null;
        var c0 = ch[0], c1 = ch[1];
        if (ob) {
          if (c0 === "position" || c0 === "rotation" || c0 === "scale") {
            var P = c0 === "position" ? "p" : c0 === "rotation" ? "r" : "s";
            if (ch.length === 2 && /^[xyz]$/.test(c1)) { if (P === "s") drv(ob, "s"); else W(ob, P + c1, asg ? rhs : { drv: true, s: -1, e: -1 }); }
            else if (ch.length === 2 && call && c1 === "set" && ar3) {
              if (P === "s") {
                var gi = ar3.args.slice(0, 3).map(function (g) { return exprInfo(s, g.s, g.e, an); });
                if (gi.length === 3 && gi.every(function (g) { return g && g.lit && g.lit.type === "num"; }) && gi[0].lit.v === gi[1].lit.v && gi[1].lit.v === gi[2].lit.v) W(ob, "s", { s: gi[0].s, e: gi[0].e, lit: gi[0].lit, multi: gi });
                else if (gi.length === 3 && gi.every(function (g) { return g && g.ref && g.ref === gi[0].ref; })) W(ob, "s", gi[0]);
                else drv(ob, "s");
              } else ["x", "y", "z"].forEach(function (ax, i) { var g = ar3.args[i]; W(ob, P + ax, g ? exprInfo(s, g.s, g.e, an) : null); });
            }
            else if (ch.length === 2 && call && c1 === "setScalar" && P === "s" && ar3 && ar3.args[0]) W(ob, "s", exprInfo(s, ar3.args[0].s, ar3.args[0].e, an));
            else if (ch.length >= 2 || asg) drvVec(ob, P);
          }
          else if (c0 === "quaternion" || c0 === "lookAt" || /^rotate/.test(c0)) drvVec(ob, "r");
          else if (/^translate/.test(c0)) drvVec(ob, "p");
          else if ((c0 === "intensity" || c0 === "fov" || c0 === "visible") && ch.length === 1) W(ob, c0 === "intensity" ? "int" : c0 === "fov" ? "fov" : "vis", asg ? rhs : { drv: true, s: -1, e: -1 });
          else if (c0 === "name" && ch.length === 1 && asg && rhs && rhs.lit && rhs.lit.type !== "num" && ob.name == null) ob.name = String(rhs.lit.v);
          else if (c0 === "color" && ob.kind === "light") colorW(ob, "color", ch.slice(1), call, ar3, asg, rhs);
          else if (c0 === "material" && (c1 === "color" || c1 === "emissive")) colorW(ob, c1 === "color" ? "color" : "emi", ch.slice(2), call, ar3, asg, rhs);
          else if (c0 === "material" && c1 === "opacity" && ch.length === 2) W(ob, "op", asg ? rhs : { drv: true, s: -1, e: -1 });
        } else if (mt2) {
          if (c0 === "color" || c0 === "emissive") colorW(mt2, c0 === "color" ? "color" : "emi", ch.slice(1), call, ar3, asg, rhs);
          else if (c0 === "opacity" && ch.length === 1) W(mt2, "op", asg ? rhs : { drv: true, s: -1, e: -1 });
        }
      }
      /* GSAP también anima: gsap.to(cube.position, { x: 2 }) → esos ejes los calcula el código */
      GSR.lastIndex = 0;
      while ((m = GSR.exec(s))) {
        if (!M.code(m.index)) continue;
        var go = by[m[1]], br = s.indexOf("{", m.index + m[0].length); if (!go) continue;
        var keys = br > 0 && /^\s*$/.test(s.slice(m.index + m[0].length, br)) ? Object.keys(objLit(s, br, closeAny(s, br), an)) : [];
        if (m[2] === "material") { if (m[3]) drv(go, m[3] === "color" ? "color" : "emi"); else if (!keys.length || keys.indexOf("opacity") >= 0) drv(go, "op"); }
        else { var PP = m[2] === "position" ? "p" : m[2] === "rotation" ? "r" : "s"; var ax2 = keys.filter(function (x) { return /^[xyz]$/.test(x); }); drvVec(go, PP, ax2.length ? ax2 : null); }
      }
      if (isR3(s)) jsxScene(s, M, an, objs, by);
      objs.forEach(function (o) {
        o.slots = {};
        PROPS3.forEach(function (pr) {
          var list = (o.w[pr] || []).concat(o.mat && o.mat.w[pr] && o.matVar ? o.mat.w[pr] : []).sort(function (a, b) { return a.s - b.s; });
          var sl;
          if (list.some(function (x) { return x.drv; })) sl = { mode: "over" };
          else if (list.length) sl = slotOf(list[list.length - 1]);
          else {
            var ci = o.ctor[pr] || (o.mat && (pr === "color" ? o.mat.p.color : pr === "emi" ? o.mat.p.emissive : pr === "op" ? o.mat.p.opacity : null));
            sl = ci && !ci.drv ? slotOf(ci) : { mode: "add" };
            if (ci) sl.ctor = true;
          }
          if (!applies(o, pr)) sl = null;
          if (sl) o.slots[pr] = sl;
        });
      });
      function slotOf(x) { return x.ref ? { mode: "param", key: x.ref, at: x } : x.lit ? { mode: "code", at: x, lit: x.lit } : { mode: "over" }; }
      function applies(o, pr) {
        if (o.kind === "cam") return /^[pr][xyz]$/.test(pr) || (pr === "fov" && o.cls === "PerspectiveCamera");
        if (o.kind === "light") return /^p[xyz]$/.test(pr) || pr === "color" || pr === "int" || pr === "vis" || (/^r[xyz]$/.test(pr) && /Spot|RectArea/.test(o.cls));
        if (o.kind === "group") return /^[pr][xyz]$|^s$|^vis$/.test(pr);
        return pr !== "int" && pr !== "fov";
      }
      SMC.h = h; SMC.v = { objs: objs, by: by, scenes: scenes, three: /\bTHREE\s*\./.test(s), an: an };
      return SMC.v;
    }
    /* lo que el editor y el MCP muestran de un objeto del código: de dónde sale cada propiedad y su valor */
    function slotVal(sm, pr, sl) {
      if (!sl) return null;
      var v;
      if (sl.mode === "code") v = sl.lit.v;
      else if (sl.mode === "param") { var p = sm.an.params.find(function (x) { return x.key === sl.key; }); v = p ? p.v : null; }
      else return null;
      if (/^r[xyz]$/.test(pr)) return typeof v === "number" ? rnd(v * 180 / Math.PI, 2) : null;
      if (pr === "color" || pr === "emi") return v == null ? null : hex6(v);
      return v;
    }
    function codeOf3(o, pr) {
      if (o.jsx) {
        var jm = { px: "position[0]", py: "position[1]", pz: "position[2]", rx: "rotation[0]", ry: "rotation[1]", rz: "rotation[2]", s: "scale", color: o.kind === "light" ? "color" : "material color", emi: "material emissive", op: "material opacity", "int": "intensity", vis: "visible", fov: "fov" };
        return o.camHost ? "<" + o.tag + " camera={{ " + (pr === "fov" ? "fov" : "position") + " }}>" : "<" + o.tag + (o.name ? ' name="' + o.name + '"' : "") + " " + jm[pr] + ">";
      }
      var map = { px: "position.x", py: "position.y", pz: "position.z", rx: "rotation.x", ry: "rotation.y", rz: "rotation.z", s: "scale", color: o.kind === "light" ? "color" : "material.color", emi: "material.emissive", op: "material.opacity", "int": "intensity", vis: "visible", fov: "fov" };
      return o.v + "." + map[pr];
    }
    function view3(src, o) {
      var sm = sceneMap(src), out = {};
      Object.keys(o.slots).forEach(function (pr) {
        var sl = o.slots[pr], x = { mode: sl.mode === "over" ? "offset" : sl.mode, code: codeOf3(o, pr) };
        if (sl.mode === "param") x.param = sl.key;
        var v = slotVal(sm, pr, sl); if (v != null) x.value = v;
        if (sl.mode === "over") x.note = "lo calcula el código en cada cuadro: el ajuste se suma (bloque ▸ musa)";
        out[pr] = x;
      });
      return out;
    }
    function codeObjects(src) {
      var sm = sceneMap(src);
      return sm.objs.map(function (o) { return { var: o.v, name: o.name, type: o.cls, kind: o.kind, key: o.kind === "cam" ? "cam" : o.name ? "n:" + o.name : "v:" + o.v, material: o.mat ? o.mat.cls + (o.mat.shared > 1 ? " (compartido)" : "") : null, props: view3(src, o) }; });
    }

    /* ── escribir un cambio en el código ── */
    function litFor(pr, val, lit) {
      if (/^r[xyz]$/.test(pr)) { var d = rnd(+val || 0, 2); return d ? fmtN(d) + " * Math.PI / 180" : "0"; }
      if (pr === "color" || pr === "emi") { var h6 = hex6(val); if (!/^#[0-9a-f]{6}$/i.test(h6)) return JSON.stringify(String(val)); if (lit && lit.type === "hex") return "0x" + h6.slice(1); var q = lit && lit.q === "'" ? "'" : '"'; return q + h6 + q; }
      if (pr === "vis") return val ? "true" : "false";
      return fmtN(val);
    }
    function setParam(src, key, v) {
      var s = String(src), p = analyze(s).params.find(function (x) { return x.key === key; }); if (!p) return s;
      if (p.type === "hex" && typeof v === "string") v = parseInt(v.replace("#", ""), 16) || 0;
      if (p.type === "color" && typeof v === "number") v = hex6(v);
      return s.slice(0, p.s) + fmtLit(p, v) + s.slice(p.e);
    }
    /* objeto 3D del código (por variable) + propiedad + valor final (unidades del editor: grados, #color) → código nuevo */
    function set3(src, ref, pr, val) {
      var s = String(src), sm = sceneMap(s), o = sm.by[ref], sl = o && o.slots[pr]; if (!sl) return s;
      if (sl.mode === "param") {
        var p = sm.an.params.find(function (x) { return x.key === sl.key; }); if (!p) return s;
        var pv = /^r[xyz]$/.test(pr) ? rnd((+val || 0) * Math.PI / 180) : val;
        return setParam(s, sl.key, pv);
      }
      if (sl.mode === "code") {
        var parts = sl.at.multi || [sl.at], txt = litFor(pr, val, sl.lit);
        if (sl.at.jsxBool) txt = sl.at.jsxBool + "={" + txt + "}";
        parts.slice().sort(function (a, b) { return b.s - a.s; }).forEach(function (g) { s = s.slice(0, g.s) + txt + s.slice(g.e); });
        return s;
      }
      if (sl.mode === "add") return o.jsx ? addJsx(s, o, pr, val) : add3(s, sm, o, pr, val);
      return s;
    }
    function attrV(txt) { return /^["']/.test(txt) ? txt : "{" + txt + "}"; }
    /* JSX: la propiedad no está escrita → atributo nuevo al final de la etiqueta (gana sobre un {...props}) */
    function addJsx(s, o, pr, val) {
      var txt = litFor(pr, val, null), at = o.tagIns, ins = null;
      if (o.camHost) {
        var def = { px: 0, py: 0, pz: 5 }, entry = null;
        if (/^p[xyz]$/.test(pr)) entry = "position: [" + ["px", "py", "pz"].map(function (q) { return q === pr ? txt : fmtN(def[q]); }).join(", ") + "]";
        else if (pr === "fov") entry = "fov: " + txt;
        if (!entry) return s;
        if (o.camObj) { var inner = s.slice(o.camObj.a + 1, o.camObj.b).trim(); return s.slice(0, o.camObj.a + 1) + " " + entry + (inner ? "," : " ") + s.slice(o.camObj.a + 1); }
        ins = " camera={{ " + entry + " }}";
      }
      else if (/^[pr][xyz]$/.test(pr)) {
        var P = pr.charAt(0), nm = P === "p" ? "position" : "rotation", ax = pr.charAt(1);
        ins = o.dash[P] ? " " + nm + "-" + ax + "={" + txt + "}" : " " + nm + "={[" + ["x", "y", "z"].map(function (a) { return a === ax ? txt : "0"; }).join(", ") + "]}";
      }
      else if (pr === "s") ins = " scale={" + txt + "}";
      else if (pr === "vis") ins = " visible={" + txt + "}";
      else if (pr === "int") ins = " intensity={" + txt + "}";
      else if (pr === "fov") ins = " fov={" + txt + "}";
      else if (pr === "color" && o.kind === "light") ins = " color=" + attrV(txt);
      else if (pr === "color" || pr === "emi" || pr === "op") {
        var key = pr === "color" ? "color" : pr === "emi" ? "emissive" : "opacity", v2 = pr === "op" ? "{" + txt + "}" : attrV(txt);
        if (o.mat && o.mat.tagIns != null) { at = o.mat.tagIns; ins = " " + key + "=" + v2 + (pr === "op" && !o.mat.transparent ? " transparent" : ""); }
        else ins = " material-" + key + "=" + v2 + (pr === "op" ? " material-transparent" : "");
      }
      return ins ? insAttr(s, at, ins) : s;
    }
    /* un atributo nuevo (" nombre={…}") justo antes de cerrar la etiqueta, con un espacio de cada lado */
    function insAttr(s, at, ins) { return /\s/.test(s.charAt(at - 1)) ? s.slice(0, at) + ins.slice(1) + " " + s.slice(at) : s.slice(0, at) + ins + (s.charAt(at) === "/" ? " " : "") + s.slice(at); }
    function add3(s, sm, o, pr, val) {
      var ind = indentAt(s, o.at), v = o.v, txt = litFor(pr, val, null), line = null;
      if (/^[pr][xyz]$/.test(pr)) {
        var P = pr.charAt(0), vec = P === "p" ? "position" : "rotation", ax = pr.charAt(1);
        var touched = ["x", "y", "z"].some(function (a) { return o.w[P + a] && o.w[P + a].length; });
        if (touched) line = v + "." + vec + "." + ax + " = " + txt + ";";
        else line = v + "." + vec + ".set(" + ["x", "y", "z"].map(function (a) { return a === ax ? txt : "0"; }).join(", ") + ");";
      }
      else if (pr === "s") line = v + ".scale.setScalar(" + txt + ");";
      else if (pr === "vis") line = v + ".visible = " + txt + ";";
      else if (pr === "int") line = v + ".intensity = " + txt + ";";
      else if (pr === "fov") line = v + ".fov = " + txt + "; " + v + ".updateProjectionMatrix();";
      else if (pr === "color" && o.kind === "light") line = v + ".color.set(" + txt + ");";
      else if (pr === "color" || pr === "emi" || pr === "op") {
        var mt = o.mat, key = pr === "color" ? "color" : pr === "emi" ? "emissive" : "opacity";
        var extra = pr === "op" && !(mt && mt.p.transparent) ? ", transparent: true" : "";
        var cur = mt && mt.p[key];
        if (mt && mt.a >= 0 && !cur) { var inner = s.slice(mt.a + 1, mt.b).trim(); return s.slice(0, mt.a + 1) + " " + key + ": " + txt + extra + (inner ? "," : " ") + s.slice(mt.a + 1); }
        if (mt && !mt.opaque && mt.a < 0 && !cur) return s.slice(0, mt.open + 1) + "{ " + key + ": " + txt + extra + " }" + s.slice(mt.close);
        line = pr === "op" ? v + ".material.opacity = " + txt + "; " + v + ".material.transparent = true;" : v + ".material." + key + ".set(" + txt + ");";
      }
      return line ? insertLine(s, o.end, line, ind, v) : s;
    }

    /* ── el bloque «▸ musa»: keyframes y ajustes sobre lo que el código anima (JSON legible dentro de un comentario) ── */
    var BLK = /(\/\*|<!--)[ \t]*▸ musa\b[^\n]*\n([\s\S]*?)\n[ \t]*◂ musa[ \t]*(?:\*\/|-->)[ \t]*\r?\n?/;
    function looseJson(t) {
      var out = [], m; TOKRE.lastIndex = 0;
      while (TOKRE.lastIndex < t.length && (m = TOKRE.exec(t))) {
        var v = m[0]; if (/^\/[\/*]/.test(v)) continue;
        if (/^\s/.test(v)) { out.push(v); continue; }
        if (v === "}" || v === "]") { for (var i = out.length - 1; i >= 0; i--) { if (/^\s/.test(out[i])) continue; if (out[i] === ",") out[i] = ""; break; } }
        out.push(v);
      }
      return out.join("");
    }
    function kfIn(list) {
      var kf = list.map(function (k) { return Array.isArray(k) ? { t: k[0], v: k[1], e: k[2] } : k && typeof k === "object" ? k : null; })
        .filter(function (k) { return k && k.v !== undefined && k.v !== null && isFinite(+k.t); })
        .map(function (k) { var o = { t: Math.max(0, rnd(+k.t, 3)), v: k.v }; if (k.e && k.e !== "lin") o.e = String(k.e); return o; })
        .sort(function (a, b) { return a.t - b.t; });
      return kf.length ? { kf: kf } : null;
    }
    function entryIn(x) {
      if (x === undefined || x === null) return null;
      if (Array.isArray(x)) return kfIn(x);
      if (typeof x === "object") { if (Array.isArray(x.kf)) return kfIn(x.kf); return x.v !== undefined ? { v: x.v } : null; }
      return { v: x };
    }
    function blockOf(src) {
      var s = String(src || ""), m = BLK.exec(s);
      if (!m) return { ov: {}, has: false };
      var ov = {}, err = null;
      try {
        var j = JSON.parse(looseJson(m[2]));
        if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error("el bloque ▸ musa tiene que ser un objeto { … }");
        Object.keys(j).forEach(function (k) { var e = entryIn(j[k]); if (e) ov[k] = e; });
      } catch (e) { err = String(e && e.message || e); }
      return { ov: ov, has: true, err: err, s: m.index, e: m.index + m[0].length, js: m[1] === "/*" };
    }
    function ovOf(src) { return blockOf(src).ov; }
    function canon(src) { var s = String(src || ""), b = blockOf(s); return b.has ? s.slice(0, b.s) + s.slice(b.e) : s; }
    function jsonSafe(t) { return t.replace(/\*\//g, "*\\/").replace(/-->/g, "--\\u003e").replace(/<\//g, "<\\/"); }
    function jv(v) { return typeof v === "number" ? fmtN(v) : jsonSafe(JSON.stringify(v)); }
    function keyLabel(k) {
      if (k.indexOf("o:") !== 0) return k.charAt(0) === "r" ? "prop de Remotion " + k.slice(2) : k.slice(2);
      var bar = k.lastIndexOf("|"), ob = k.slice(2, bar), pr = k.slice(bar + 1);
      return (ob === "cam" ? "cámara" : ob.replace(/^[nvi]:/, "")) + " · " + (LAB3[pr] || pr);
    }
    function blockText(ov, js) {
      var keys = Object.keys(ov || {}).filter(function (k) { var e = ov[k]; return e && (e.v !== undefined || (e.kf && e.kf.length)); });
      keys.sort(function (a, b) { var ra = a.indexOf("o:") === 0 ? 1 : 0, rb = b.indexOf("o:") === 0 ? 1 : 0; return ra - rb || (a < b ? -1 : a > b ? 1 : 0); });
      if (!keys.length) return "";
      var lines = keys.map(function (k, i) {
        var e = ov[k], val = e.kf && e.kf.length ? "[" + e.kf.map(function (q) { return "[" + [fmtN(q.t), jv(q.v)].concat(q.e && q.e !== "lin" ? [JSON.stringify(String(q.e))] : []).join(", ") + "]"; }).join(", ") + "]" : jv(e.v);
        return "  " + jsonSafe(JSON.stringify(k)) + ": " + val + (i < keys.length - 1 ? "," : "") + "  // " + keyLabel(k).replace(/\*\/|-->|\n/g, " ") + (e.kf && e.kf.length ? " · keyframes [segundo del clip, valor, curva]" : "");
      });
      var head = "▸ musa · keyframes y ajustes hechos en Musa (inspector o MCP) sobre lo que este código anima. Se pueden editar aquí.";
      return (js ? "/* " : "<!-- ") + head + "\n{\n" + lines.join("\n") + "\n}\n◂ musa" + (js ? " */" : " -->") + "\n";
    }
    function writeBlock(src, ov) {
      var s = String(src || ""), b = blockOf(s), at, js, pre = "";
      if (b.has) { s = s.slice(0, b.s) + s.slice(b.e); at = b.s; js = b.js; }
      else if (!isHtml(s)) { at = 0; js = true; var sb = /^(?:#![^\n]*\n|(["'])use (?:client|strict)\1;?[ \t]*\n)/.exec(s); if (sb) at = sb[0].length; }
      else {
        var R = scriptRanges(s), best = null;
        R.forEach(function (r) { var body = s.slice(r[0], r[1]), sc = /THREE|setAnimationLoop|requestAnimationFrame|function\s+draw|getContext/.test(body) ? 2 : 1; if (!best || sc > best.sc) best = { at: r[0], sc: sc }; });
        if (best) { at = best.at; js = true; if (s.charAt(at) === "\r") at++; if (s.charAt(at) === "\n") at++; else pre = "\n"; }
        else { var bm = /<body[^>]*>/i.exec(s); at = bm ? bm.index + bm[0].length : 0; js = false; pre = "\n"; }
      }
      var txt = blockText(ov, js);
      return txt ? s.slice(0, at) + pre + txt + s.slice(at) : s;
    }
    /* una entrada del bloque: { v } valor fijo, { kf: [{ t, v, e }] } keyframes, null = quitarla */
    function setOv(src, key, e) {
      var b = blockOf(src), ov = Object.assign({}, b.ov);
      if (e && (e.v !== undefined || (e.kf && e.kf.length))) ov[key] = e; else delete ov[key];
      return writeBlock(src, ov);
    }
    /* clips de antes (ov guardado aparte): los valores fijos de parámetros van a su literal y el resto al bloque */
    function normalize(live) {
      if (!live) return live;
      var src = String(live.src || ""), b = blockOf(src), ov = live.ov || {};
      if (!b.has && Object.keys(ov).length) {
        var an = analyze(src), rest = {};
        Object.keys(ov).forEach(function (k) { var e = ov[k]; if (!(/^[pvr]:/.test(k) && isStatic(e))) rest[k] = e; });
        src = writeBlock(bake(src, an, ov), rest);
        live.src = src;
      }
      live.ov = blockOf(live.src).ov;
      return live;
    }
    /* objeto 3D del editor/MCP ("Cubo", "n:Cubo", "v:cube", "cam") → objeto del código */
    function findObj(src, ref) {
      var sm = sceneMap(src), r = String(ref || "");
      if (r === "cam") return sm.objs.find(function (o) { return o.kind === "cam"; }) || null;
      if (r.indexOf("v:") === 0) return sm.by[r.slice(2)] || null;
      var nm = r.replace(/^n:/, "").replace(/#\d+$/, "");
      return sm.objs.find(function (o) { return o.name === nm; }) || (r.indexOf("n:") !== 0 ? sm.by[nm] : null) || null;
    }
    /* cambios del MCP (params, keyframes, scene, addObjects) → el código nuevo; devuelve lo que no se encontró */
    function applyEdits(live, p) {
      normalize(live);
      var unknown = [], src = live.src;
      var keyOf = function (k) {
        if (/^[pvr]:/.test(k)) return k;
        var an = analyze(src), hit = an.params.find(function (x) { return x.name === k; }) || an.params.find(function (x) { return x.key === "v:" + k || x.key === "r:" + k; }) || an.params.find(function (x) { return x.key.slice(-k.length - 1) === "." + k; });
        return hit ? hit.key : null;
      };
      var sceneK = function (k) {
        var kk = k.indexOf("o:") === 0 ? k.slice(2) : k, bar = kk.lastIndexOf("|"); if (bar < 0) return null;
        var ob = kk.slice(0, bar), pr = kk.slice(bar + 1); if (PROPS3.indexOf(pr) < 0) return null;
        var co = findObj(src, ob), okey = ob === "cam" || /^[nvi]:/.test(ob) ? ob : co ? (co.kind === "cam" ? "cam" : co.name ? "n:" + co.name : "v:" + co.v) : "n:" + ob;
        return { ob: ob, pr: pr, co: co, key: "o:" + okey + "|" + pr };
      };
      var norm = function (key, v) { var pa = analyze(src).params.find(function (x) { return x.key === key; }); return pa && pa.type === "hex" && typeof v === "string" ? parseInt(v.replace("#", ""), 16) || 0 : v; };
      (p.addObjects || []).forEach(function (spec) { var r = addObject(src, spec || {}); if (r) src = r.src; else unknown.push("addObjects:" + ((spec && spec.type) || "?")); });
      /* cualquier valor del código (codeValues): por su id, o por «Objeto|Etiqueta» / «Etiqueta» */
      Object.keys(p.values || {}).forEach(function (k) {
        var V = codeValues(src), it = /^\d+$/.test(k) ? V[+k] : null;
        if (!it) { var bar = k.lastIndexOf("|"), ob = bar >= 0 ? k.slice(0, bar).trim().toLowerCase() : null, lb = (bar >= 0 ? k.slice(bar + 1) : k).trim().toLowerCase();
          it = V.find(function (x) { return x.label.toLowerCase() === lb && (ob == null || String(x.objLabel || "").toLowerCase() === ob); }) || null; }
        if (!it) return unknown.push("values:" + k);
        if (it.via === "param") { src = setOv(setParam(src, it.ref, p.values[k]), it.ref, null); return; }
        var out = setCodeValue(src, it.i, p.values[k]); if (out === src && String(p.values[k]) !== String(it.v)) return unknown.push("values:" + k + " (valor no válido)"); src = out;
      });
      /* duplicar / quitar: lo mismo que la barra del lienzo. object = name, variable o clave (n:…, v:…) */
      (p.duplicateObjects || []).forEach(function (spec) {
        spec = typeof spec === "string" ? { object: spec } : spec || {};
        var co = findObj(src, String(spec.object || "")); if (!co || co.kind === "cam") return unknown.push("duplicateObjects:" + (spec.object || "?"));
        var vw = view3(src, co), pos = [], del = [];
        ["x", "y", "z"].forEach(function (ax, i) { var sl = vw["p" + ax], base = sl && typeof sl.value === "number" ? sl.value : 0, giv = spec[ax] != null && isFinite(+spec[ax]); pos[i] = giv ? +spec[ax] : base + (i ? 0 : 0.6); del[i] = pos[i] - base; });
        var r = dupObject(src, co.v, { pos: pos, delta: del }); if (r) src = r.src; else unknown.push("duplicateObjects:" + spec.object);
      });
      (p.removeObjects || []).forEach(function (ob) {
        var co = findObj(src, String(ob || "")), r = co && addedByMusa(src, co) ? removeObject(src, co.v) : null;
        if (r) src = r; else unknown.push("removeObjects:" + ob + (co ? " (solo se quitan los objetos agregados o duplicados en Musa; a los demás ponles scene { \"" + ob + "|vis\": false })" : ""));
      });
      Object.keys(p.params || {}).forEach(function (k) { var key = keyOf(k); if (!key) return unknown.push(k); src = setOv(setParam(src, key, norm(key, p.params[k])), key, null); });
      Object.keys(p.keyframes || {}).forEach(function (k) {
        var list = p.keyframes[k], sk = sceneK(k), key = sk ? sk.key : keyOf(k);
        if (!key || !Array.isArray(list) || !list.length) return unknown.push(k);
        var e = kfIn(list.map(function (x) { return x && typeof x === "object" && !Array.isArray(x) ? { t: x.t, v: norm(key, x.v), e: x.e } : x; }));
        if (e) src = setOv(src, key, e);
      });
      Object.keys(p.scene || {}).forEach(function (k) {
        var sk = sceneK(k), v = p.scene[k]; if (!sk) return unknown.push(k);
        if (v && typeof v === "object" && (Array.isArray(v.kf) || Array.isArray(v))) { var e = entryIn(v); if (e) src = setOv(src, sk.key, e); return; }
        var sl = sk.co && sk.co.slots[sk.pr];
        if (sl && sl.mode !== "over") { src = setOv(set3(src, sk.co.v, sk.pr, v), sk.key, null); return; }
        src = setOv(src, sk.key, v === null ? null : { v: v });
      });
      live.src = src; live.ov = ovOf(src);
      return unknown;
    }
    /* agregar un objeto 3D al código (Three.js con una escena `new THREE.Scene()`): queda con nombre y editable */
    var GEO = { box: ["Caja", "caja", "BoxGeometry(1, 1, 1)"], sphere: ["Esfera", "esfera", "SphereGeometry(0.6, 48, 32)"], torus: ["Toro", "toro", "TorusGeometry(0.55, 0.2, 32, 96)"], cone: ["Cono", "cono", "ConeGeometry(0.6, 1.2, 48)"],
      cylinder: ["Cilindro", "cilindro", "CylinderGeometry(0.5, 0.5, 1.2, 48)"], plane: ["Plano", "plano", "PlaneGeometry(2, 2)"], icosa: ["Icosaedro", "icosaedro", "IcosahedronGeometry(0.7, 0)"], knot: ["Nudo", "nudo", "TorusKnotGeometry(0.5, 0.17, 160, 24)"] };
    function canAdd(src) { var sm = sceneMap(src); return !!sm.scenes.length || !!jsxHost(String(src || "")); }
    var JGEO = { box: "boxGeometry args={[1, 1, 1]}", sphere: "sphereGeometry args={[0.6, 48, 32]}", torus: "torusGeometry args={[0.55, 0.2, 32, 96]}", cone: "coneGeometry args={[0.6, 1.2, 48]}",
      cylinder: "cylinderGeometry args={[0.5, 0.5, 1.2, 48]}", plane: "planeGeometry args={[2, 2]}", icosa: "icosahedronGeometry args={[0.7, 0]}", knot: "torusKnotGeometry args={[0.5, 0.17, 160, 24]}" };
    /* dónde cierra el lienzo 3D del JSX (</ThreeCanvas> o </Canvas>): ahí entran los objetos nuevos */
    function jsxHost(s) { if (!isR3(s)) return null; var re = /<\/(ThreeCanvas|Canvas)\s*>/g, m, M = codeMask(s); while ((m = re.exec(s))) if (M.code(m.index)) return m; return null; }
    function addJsxObject(s, sm, spec) {
      var host = jsxHost(s); if (!host) return null;
      var ty = String(spec.type || "box"), light = /light|luz/i.test(ty), dir = /dir/i.test(ty), g = GEO[ty] ? ty : "box";
      var nm = String(spec.name || (light ? (dir ? "Luz direccional" : "Luz puntual") : GEO[g][0])).replace(/["\\\n{}<>]/g, "").slice(0, 60), base = nm, k = 2;
      while (sm.objs.some(function (o) { return o.name === nm; })) nm = base + " " + k++;
      var col = hex6(spec.color || (light ? "#ffffff" : "#d2ff02")), num = function (v, d) { return fmtN(v == null || !isFinite(+v) ? d : +v); };
      var pos = "position={[" + num(spec.x, light ? 2 : 0) + ", " + num(spec.y, light ? 3 : 0) + ", " + num(spec.z, light ? 4 : 0) + "]}";
      var ls = s.lastIndexOf("\n", host.index - 1) + 1, atLine = /^[ \t]*$/.test(s.slice(ls, host.index)), ind = indentAt(s, host.index) + "  ", els = [];
      if (light) els.push("<" + (dir ? "directionalLight" : "pointLight") + " name=" + JSON.stringify(nm) + " " + pos + " color=" + JSON.stringify(col) + " intensity={" + num(spec.intensity, dir ? 2 : 30) + "}" + (dir ? "" : " decay={2}") + " />");
      else {
        if (!sm.objs.some(function (o) { return o.kind === "light"; })) els.push("<ambientLight intensity={0.6} />", "<directionalLight position={[3, 4, 5]} intensity={2} />");
        els.push("<mesh name=" + JSON.stringify(nm) + " " + pos + (spec.size != null && +spec.size !== 1 ? " scale={" + num(spec.size, 1) + "}" : "") + ">\n" + ind + "  <" + JGEO[g] + " />\n" + ind + "  <meshStandardMaterial color=" + JSON.stringify(col) + " roughness={0.4} metalness={0.1}" + (g === "plane" ? " side={2}" : "") + " />\n" + ind + "</mesh>");
      }
      var txt = els.map(function (e) { return ind + "{/* agregado en Musa */}" + e; }).join("\n") + "\n";
      var out = atLine ? s.slice(0, ls) + txt + s.slice(ls) : s.slice(0, host.index) + "\n" + txt + indentAt(s, host.index) + s.slice(host.index);
      return { src: out, v: null, name: nm };
    }
    function addObject(src, spec) {
      var s = String(src || ""), sm = sceneMap(s), sc = sm.scenes[0]; if (!sc) return addJsxObject(s, sm, spec || {});
      var ty = String(spec.type || "box"), light = /light|luz/i.test(ty), g = GEO[ty] || (light ? null : GEO.box);
      var nm = String(spec.name || (light ? (/dir/i.test(ty) ? "Luz direccional" : "Luz puntual") : g[0])).replace(/["\\\n]/g, "").slice(0, 60);
      var base = light ? "luz" : g[1], vn = base, i = 2, used = function (x) { return new RegExp("(^|[^\\w$.])" + x + "\\b").test(s); };
      while (used(vn)) vn = base + i++;
      var T = sm.three ? "THREE." : "", col = hex6(spec.color || (light ? "#ffffff" : "#d2ff02")), num = function (v, d) { return fmtN(v == null || !isFinite(+v) ? d : +v); };
      var pos = vn + ".position.set(" + num(spec.x, light ? 2 : 0) + ", " + num(spec.y, light ? 3 : 0) + ", " + num(spec.z, light ? 4 : 0) + ");";
      var lines = [];
      if (light) lines.push("const " + vn + " = new " + T + (/dir/i.test(ty) ? "DirectionalLight(" + JSON.stringify(col) + ", " + num(spec.intensity, 2) + ")" : "PointLight(" + JSON.stringify(col) + ", " + num(spec.intensity, 30) + ", 0, 2)") + ";");
      else lines.push("const " + vn + " = new " + T + "Mesh(new " + T + g[2] + ", new " + T + "MeshStandardMaterial({ color: " + JSON.stringify(col) + ", roughness: 0.4, metalness: 0.1" + (ty === "plane" ? ", side: " + T + "DoubleSide" : "") + " }));");
      lines.push(vn + ".name = " + JSON.stringify(nm) + "; " + pos + (spec.size != null && !light && +spec.size !== 1 ? " " + vn + ".scale.setScalar(" + num(spec.size, 1) + ");" : "") + " " + sc.v + ".add(" + vn + ");");
      if (!light && !sm.objs.some(function (o) { return o.kind === "light"; }) && !/Light\s*\(/.test(s)) lines.push("const " + vn + "Luz = new " + T + "DirectionalLight(\"#ffffff\", 2); " + vn + "Luz.name = \"Luz de " + nm + "\"; " + vn + "Luz.position.set(3, 4, 5); " + sc.v + ".add(" + vn + "Luz, new " + T + "AmbientLight(\"#ffffff\", 0.6));");
      var ind = indentAt(s, sc.at);
      if (!sm.three) { var im = /import\s*\{[^}]*\}\s*from\s*["']three["'];?/.exec(s); if (!im) return null; s = s.slice(0, im.index + im[0].length) + "\nimport * as THREE from \"three\";" + s.slice(im.index + im[0].length); return addObject(s, spec); }
      return { src: insertLine(s, sm.scenes[0].end, "/* agregado en Musa */ " + lines.join("\n" + ind), ind), v: vn, name: nm };
    }
    /* duplicar un objeto del código. Three.js: una copia (clone) con su material propio, justo después de que el
       original entra a la escena; JSX: la misma etiqueta otra vez (con sus animaciones). opt.pos = [x, y, z] de la copia. */
    function dupObject(src, vn, opt) {
      var s = String(src || ""), sm = sceneMap(s), o = sm.by[vn]; if (!o || o.kind === "cam") return null;
      opt = opt || {};
      var base = String(o.name || (o.jsx ? o.tag : vn)).replace(/ copia( \d+)?$/, ""), nm = base + " copia", k = 2;
      var taken = function (x) { return sm.objs.some(function (q) { return q.name === x; }) || s.indexOf(JSON.stringify(x)) >= 0; };
      while (taken(nm)) nm = base + " copia " + k++;
      var pos = Array.isArray(opt.pos) && opt.pos.length === 3 ? opt.pos.map(function (v) { return fmtN(rnd(+v || 0, 3)); }) : null;
      if (o.jsx) {
        var endAt = o.end;
        if (!o.self) { var cl = s.indexOf("</" + o.tag + ">", o.end); if (cl < 0) return null; endAt = cl + o.tag.length + 3; }
        var el = s.slice(o.at, endAt), open = s.slice(o.at, o.end), nmAttr = /\sname=(?:"[^"]*"|'[^']*'|\{[^}]*\})/;
        var open2 = nmAttr.test(open) ? open.replace(nmAttr, " name=" + JSON.stringify(nm)) : open.replace(/^<[\w.]+/, function (t) { return t + " name=" + JSON.stringify(nm); });
        el = open2 + el.slice(open.length);
        var ind = indentAt(s, o.at), nl = s.indexOf("\n", endAt), at = nl < 0 ? s.length : nl;
        var out = s.slice(0, at) + "\n" + ind + "{/* agregado en Musa */}" + el + s.slice(at);
        return placeCopy(out, o, nm, opt, null);
      }
      var vb = vn.replace(/Copia\d*$/, "") + "Copia", v2 = vb, i = 2, used = function (x) { return new RegExp("(^|[^\\w$.])" + x.replace(/\$/g, "\\$") + "\\b").test(s); };
      while (used(v2)) v2 = vb + i++;
      /* las sentencias del objeto (crearlo, nombrarlo, ubicarlo, animarlo en cada cuadro, sumarlo a la escena) se
         repiten con la variable nueva: la copia es un objeto del código como cualquier otro y se anima igual */
      var its = subjStmts(s, vn); if (!its.some(function (q) { return q.decl; })) return null;
      var ren = new RegExp("(^|[^\\w$.])" + vn.replace(/\$/g, "\\$") + "(?![\\w$])", "g"), named = false;
      var groups = {}, order = [];
      its.forEach(function (q) {
        var txt;
        if (q.add) txt = q.add + ".add(" + v2 + ");";
        else {
          /* de una declaración solo va el declarador de este objeto (let a = …, k = 0 → const aCopia = …;) */
          txt = (q.decl ? "const " + s.slice(q.na, stmtEnd(s, q.na, true)) : s.slice(q.a, q.b)).replace(ren, "$1" + v2); if (!/;\s*$/.test(txt)) txt += ";";
          var nmRe = new RegExp("^(" + v2.replace(/\$/g, "\\$") + "\\s*\\.\\s*name\\s*=\\s*)(\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*')");
          if (nmRe.test(txt)) { txt = txt.replace(nmRe, "$1" + JSON.stringify(nm)); named = true; }
          if (q.decl) { txt = txt.replace(/^\/\* agregado en Musa \*\/ /, ""); txt = "/* agregado en Musa */ " + txt.replace(/^(?:let|var)\s/, "const "); }
        }
        var le = s.indexOf("\n", q.b); if (le < 0) le = s.length;
        var whole = !/<\/script/i.test(s.slice(q.b, le)) && balanced(s, q.b, le), at = whole ? le : q.b, key = (whole ? "L" : "I") + at;
        if (!groups[key]) { groups[key] = { at: at, whole: whole, ind: indentAt(s, q.a), parts: [], decl: false }; order.push(key); }
        groups[key].parts.push(txt); if (q.decl) groups[key].decl = true;
      });
      if (!named) { var gd = groups[order.filter(function (k) { return groups[k].decl; })[0]]; gd.parts.splice(gd.parts.findIndex(function (t) { return /^\/\* agregado en Musa \*\//.test(t); }) + 1, 0, v2 + ".name = " + JSON.stringify(nm) + ";"); }
      var out2 = s;
      order.map(function (k) { return groups[k]; }).sort(function (x, y) { return y.at - x.at; }).forEach(function (g) {
        out2 = out2.slice(0, g.at) + (g.whole ? "\n" + g.ind : " ") + g.parts.join(" ") + out2.slice(g.at);
      });
      return placeCopy(out2, o, nm, opt, v2);
    }
    /* la copia en su lugar: si el código fija la posición se escribe ahí; si la calcula en cada cuadro (o sale de un
       parámetro), el corrimiento queda como ajuste en el bloque ▸ musa. Los keyframes del original también se copian. */
    function placeCopy(out, o, nm, opt, v2) {
      var key0 = "o:" + (o.name ? "n:" + o.name : "v:" + o.v) + "|", key2 = "o:n:" + nm + "|", ov = ovOf(out);
      Object.keys(ov).forEach(function (k) { if (k.indexOf(key0) === 0) out = setOv(out, key2 + k.slice(key0.length), JSON.parse(JSON.stringify(ov[k]))); });
      var pos = Array.isArray(opt.pos) && opt.pos.length === 3 ? opt.pos : null, del = Array.isArray(opt.delta) && opt.delta.length === 3 ? opt.delta : null;
      if (pos || del) ["px", "py", "pz"].forEach(function (pr, i) {
        var o2 = findObj(out, "n:" + nm); if (!o2) return;
        var sl = view3(out, o2)[pr], cur = ovOf(out)[key2 + pr], kf = cur && cur.kf && cur.kf.length;
        if (sl && (sl.mode === "code" || sl.mode === "add") && pos && !kf) { if (sl.mode === "code" || Math.abs(+pos[i] || 0) > 1e-6) out = set3(out, o2.v, pr, rnd(+pos[i] || 0, 3)); }
        else if (del && !kf && Math.abs(+del[i] || 0) > 1e-6) out = setOv(out, key2 + pr, { v: rnd((cur && +cur.v || 0) + (+del[i] || 0), 3) });
      });
      return { src: out, name: nm, v: v2 };
    }
    /* las sentencias de un objeto en el código: las que empiezan por su variable (const x = …, x.algo = …, x.algo(…))
       y las llamadas .add(…) que lo suman a la escena */
    function subjStmts(src, vn) {
      var s = String(src || ""), M = codeMask(s), ev = vn.replace(/\$/g, "\\$"), out = [], m;
      var re = new RegExp("(^|[;{}\\n])([ \\t]*)((?:/\\* agregado en Musa \\*/ )?)((?:const|let|var)\\s+)?" + ev + "\\s*(?:\\.|=(?!=))", "g");
      while ((m = re.exec(s))) {
        var a0 = m.index + m[1].length + m[2].length, at = a0 + m[3].length; if (!M.code(at)) continue;
        var e = stmtEnd(s, at, false); if (e <= at) continue;
        out.push({ a: a0, b: e, decl: !!m[4], na: at + (m[4] || "").length }); re.lastIndex = Math.max(re.lastIndex, e - 1);
      }
      var re2 = /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\.\s*add\s*\(([^()]*)\)\s*;?/g;
      while ((m = re2.exec(s))) {
        if (!M.code(m.index)) continue;
        var args = m[2].split(",").map(function (x) { return x.trim(); }); if (args.indexOf(vn) < 0) continue;
        if (out.some(function (q) { return m.index >= q.a && m.index < q.b; })) continue;
        out.push({ a: m.index, b: m.index + m[0].length, add: m[1].replace(/\s+/g, ""), args: args, open: m.index + m[0].indexOf("(") });
      }
      return out.sort(function (x, y) { return x.a - y.a; });
    }
    /* quita lo que quede de un objeto (sus sentencias en el bucle, su .add): sin esto el código seguiría nombrándolo */
    function dropStmts(src, vn) {
      var s = String(src || "");
      subjStmts(s, vn).sort(function (x, y) { return y.a - x.a; }).forEach(function (q) {
        if (q.add && q.args.length > 1) { var cl = s.indexOf(")", q.open); s = s.slice(0, q.open + 1) + q.args.filter(function (x) { return x !== vn; }).join(", ") + s.slice(cl); return; }
        var a = q.a, b = q.b;
        if (s.charAt(a - 1) === " " && /\S/.test(s.charAt(a - 2))) a--;
        s = s.slice(0, a) + s.slice(b);
        var ls = s.lastIndexOf("\n", a - 1) + 1, le = s.indexOf("\n", a); if (le < 0) le = s.length;
        if (ls > 0 && /^[ \t]*$/.test(s.slice(ls, le))) s = s.slice(0, ls - 1) + s.slice(le);
      });
      return s;
    }
    /* ═════════════ TODOS los valores del código, cada uno con su control ═════════════
       Parámetros (params) y propiedades de la escena ya tienen control. Esto cubre el resto: cada número, color,
       sí/no y nombre que aparece en el código (tamaño de una geometría, rugosidad del material, cuántas estrellas,
       el radio de una órbita dentro del bucle…). Así no queda nada del video que solo se pueda cambiar escribiendo
       código. Se leen sin ejecutar; cambiar uno reescribe su literal en su lugar.
       Fuera quedan solo los valores de estructura (índices de arreglos, contadores de bucles, π/180, ms→s): no son
       partes del video, y cambiarlos rompe el código. */
    var GEOL = {
      box: ["Ancho", "Alto", "Fondo", "Segmentos a lo ancho", "Segmentos a lo alto", "Segmentos al fondo"], sphere: ["Radio", "Segmentos horizontales", "Segmentos verticales"],
      icosahedron: ["Radio", "Detalle (caras)"], octahedron: ["Radio", "Detalle (caras)"], dodecahedron: ["Radio", "Detalle (caras)"], tetrahedron: ["Radio", "Detalle (caras)"],
      torus: ["Radio", "Grosor del tubo", "Segmentos del tubo", "Segmentos del anillo", "Arco"], torusknot: ["Radio", "Grosor del tubo", "Segmentos a lo largo", "Segmentos del tubo", "Vueltas (p)", "Cruces (q)"],
      cone: ["Radio", "Alto", "Segmentos"], cylinder: ["Radio de arriba", "Radio de abajo", "Alto", "Segmentos"], plane: ["Ancho", "Alto", "Segmentos a lo ancho", "Segmentos a lo alto"],
      circle: ["Radio", "Segmentos"], ring: ["Radio interior", "Radio exterior", "Segmentos"], capsule: ["Radio", "Largo", "Segmentos de la tapa", "Segmentos"],
    };
    var CTORL = { PointLight: ["Color", "Intensidad", "Alcance", "Caída con la distancia"], DirectionalLight: ["Color", "Intensidad"], AmbientLight: ["Color", "Intensidad"], SpotLight: ["Color", "Intensidad", "Alcance", "Ángulo", "Borde suave", "Caída con la distancia"],
      HemisphereLight: ["Color del cielo", "Color del suelo", "Intensidad"], RectAreaLight: ["Color", "Intensidad", "Ancho", "Alto"], PerspectiveCamera: ["Apertura (FOV°)", "Proporción", "Desde qué distancia se ve (cerca)", "Hasta qué distancia se ve (lejos)"],
      OrthographicCamera: ["Izquierda", "Derecha", "Arriba", "Abajo", "Cerca", "Lejos"], Color: ["Color"], Fog: ["Color de la niebla", "Niebla desde", "Niebla hasta"], FogExp2: ["Color de la niebla", "Densidad de la niebla"] };
    var KEYL = { roughness: "Rugosidad", metalness: "Metalizado", color: "Color", emissive: "Brillo propio (color)", emissiveIntensity: "Brillo propio (fuerza)", opacity: "Opacidad", size: "Tamaño de cada punto", flatShading: "Caras planas", wireframe: "Solo alambre",
      transparent: "Transparente", antialias: "Bordes suaves", intensity: "Intensidad", damping: "Amortiguación", stiffness: "Rigidez", mass: "Masa", fov: "Apertura (FOV°)", distance: "Alcance", decay: "Caída con la distancia", angle: "Ángulo", penumbra: "Borde suave",
      linewidth: "Grosor de línea", clearcoat: "Barniz", transmission: "Transparencia (vidrio)", thickness: "Grosor", ior: "Refracción", sizeAttenuation: "Más chico con la distancia", depthWrite: "Tapa lo de atrás", depthTest: "Respeta la profundidad", side: "Caras visibles",
      near: "Cerca", far: "Lejos", zoom: "Zoom", castShadow: "Proyecta sombra", receiveShadow: "Recibe sombra", visible: "Visible", scale: "Escala", position: "Posición", rotation: "Giro", args: "Valor", name: "Nombre", durationInFrames: "Duración (cuadros)", fps: "Cuadros por segundo", width: "Ancho", height: "Alto" };
    var VALC = { h: null, v: null };
    function codeValues(src) {
      var s = String(src || ""), h = hash(s); if (VALC.h === h) return VALC.v;
      var an = analyze(s), sm = sceneMap(s), jsx = isR3(s) || !isHtml(s), cov = [], owners = [], out = [], skipped = 0;
      an.params.forEach(function (p) { if (p.s >= 0) cov.push([p.s, p.e, "param", p.key]); });
      sm.objs.forEach(function (o) {
        var ok = o.kind === "cam" ? "cam" : o.name ? "n:" + o.name : "v:" + o.v;
        Object.keys(o.slots || {}).forEach(function (pr) { var sl = o.slots[pr]; if (sl && sl.mode === "code" && sl.at && sl.at.s >= 0) cov.push([sl.at.s, sl.at.e, "slot", ok + "|" + pr]); });
        var label = o.name || (o.jsx ? o.tag : o.v);
        if (o.jsx) { var e = o.end; if (!o.self) { var cl = s.indexOf("</" + o.tag + ">", o.end); if (cl >= 0) e = cl; } owners.push({ a: o.at, b: e, key: ok, label: label }); }
        else subjStmts(s, o.v).forEach(function (q) { if (!q.add) owners.push({ a: q.a, b: q.b, key: ok, label: label }); });
      });
      function ownerOf(pos) { var best = null; owners.forEach(function (w) { if (pos >= w.a && pos < w.b && (!best || w.b - w.a < best.b - best.a)) best = w; }); return best; }
      function covOf(a, e) { for (var i = 0; i < cov.length; i++) if (a >= cov[i][0] && e <= cov[i][1]) return cov[i]; return null; }
      function lineOf(pos) { var ls = s.lastIndexOf("\n", pos - 1) + 1, le = s.indexOf("\n", pos); return [ls, le < 0 ? s.length : le]; }
      function snippet(a, e) {
        var L = lineOf(a), from = Math.max(L[0], a - 34), to = Math.min(L[1], e + 30);
        return ((from > L[0] ? "…" : "") + s.slice(from, a) + "«" + s.slice(a, e) + "»" + s.slice(e, to) + (to < L[1] ? "…" : "")).replace(/\s+/g, " ").trim();
      }
      function declVar(pos) { var L = lineOf(pos), before = s.slice(L[0], pos), m = /(?:^|[;{}\s])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;]*$/.exec(before); return m ? m[1] : null; }
      scriptRanges(s).forEach(function (r) {
        var T = lex(s, r[0], r[1]), st = [], tag = null, forP = -1, forSeg = 0;
        for (var k = 0; k < T.length; k++) {
          var t = T[k], v = t.v, p1 = T[k - 1], p2 = T[k - 2], n1 = T[k + 1], top = st[st.length - 1];
          if (jsx && v === "<" && n1 && /^[A-Za-z]/.test(n1.v) && (!p1 || /^[(,=:?{}>;&|]$|^return$/.test(p1.v) || p1.v === ")" && false)) tag = n1.v;
          if (v === "(") {
            var callee = "", isNew = false, q = k - 1;
            while (q >= 0 && (/^[A-Za-z_$][\w$]*$/.test(T[q].v) || T[q].v === ".")) { if (T[q].v === "new") { isNew = true; break; } callee = T[q].v + callee; q--; }
            if (q >= 0 && T[q].v === "new") isNew = true;
            st.push({ t: "call", callee: callee.replace(/^THREE\./, ""), isNew: isNew, arg: 0, isFor: p1 && p1.v === "for" });
            if (p1 && p1.v === "for") { forP = st.length - 1; forSeg = 0; }
            continue;
          }
          if (v === "[") { st.push({ t: p1 && (/^[A-Za-z_$][\w$]*$/.test(p1.v) && !/^(?:return|in|of|typeof|case)$/.test(p1.v) || p1.v === ")" || p1.v === "]") ? "idx" : "arr", arg: 0 }); continue; }
          if (v === "{") {
            var attr = jsx && p1 && p1.v === "=" && p2 && /^[A-Za-z_$][\w$-]*$/.test(p2.v) ? p2.v : null;
            st.push({ t: attr ? "attr" : "obj", attr: attr, tag: attr ? tag : null, key: null, arg: 0 }); continue;
          }
          if (v === ")" || v === "]" || v === "}") { if (st.length - 1 === forP && v === ")") forP = -1; st.pop(); continue; }
          if (v === "," && top) { top.arg++; if (top.t === "obj") top.key = null; continue; }
          if (v === ";" && forP >= 0 && st.length - 1 === forP) { forSeg++; continue; }
          if (v === ":" && top && top.t === "obj" && p1 && top.key == null) { top.key = /^["']/.test(p1.v) ? unq(p1.v) : p1.v; continue; }
          var lit = litOf(v, false); if (!lit) continue;
          /* qué literales son valores */
          var a0 = t.s, attrStr = jsx && p1 && p1.v === "=" && p2 && /^[A-Za-z_$][\w$-]*$/.test(p2.v) ? p2.v : null;
          if (lit.type === "text") {
            var isName = (p1 && p1.v === "=" && p2 && p2.v === "name") || (top && top.t === "obj" && top.key === "name");
            if (!isName || !lit.v) continue;
          } else if (lit.type === "bool") {
            if (!((top && top.t === "obj" && top.key != null) || (top && top.t === "attr" && p1 && p1.v === "{"))) continue;
          } else if (lit.type === "num") {
            if (p1 && p1.v === "-" && (!p2 || /^[=(,\[{:*\/+\-?<>!&|%]$|^return$/.test(p2.v))) { lit = litOf(v, true); a0 = p1.s; }
            /* de estructura: índices, contadores del for, π y cambios de unidad */
            var structural = st.some(function (x) { return x.t === "idx" || (x.t === "call" && /^(?:Float32Array|Float64Array|Uint8Array|Uint16Array|Uint32Array|Int32Array|BufferAttribute|Float32BufferAttribute|Array)$/.test(x.callee)); }) || (forP >= 0 && st.length - 1 === forP && forSeg !== 1)
              || (p1 && p1.v === "/" && (lit.v === 180 || lit.v === 1000 || lit.v === 360))
              || (lit.v === 2 && ((p1 && p1.v === "*" && p2 && p2.v === "PI") || (n1 && n1.v === "*" && T[k + 2] && T[k + 2].v === "Math" && T[k + 4] && T[k + 4].v === "PI")))
              || (p1 && p1.v === "." ) || (n1 && n1.v === "." && /^\d+$/.test(v) && T[k + 2] && /^[A-Za-z_$]/.test(T[k + 2].v));
            if (structural) { skipped++; continue; }
          }
          var c = covOf(a0, t.e);
          /* etiqueta y grupo según dónde está */
          var label = null, part = null, ix = top ? top.arg : 0, up = st[st.length - 2], call = null;
          /* ¿el literal es el valor entero (y no un número dentro de una cuenta como t * 0.8)? */
          var pv = a0 < t.s ? p2 : p1, whole = (!pv || /^[(\[,:={]$/.test(pv.v)) && (!n1 || /^[)\],;}]$/.test(n1.v));
          for (var d = st.length - 1; d >= 0 && !call; d--) if (st[d].t === "call") call = st[d];
          if (lit.type === "text") label = "Nombre";
          else if (!whole) label = null;
          else if (attrStr) { label = KEYL[attrStr] || attrStr; }
          else if (pv && pv.v === "=" && T[k - (a0 < t.s ? 3 : 2)] && /^[A-Za-z_$][\w$]*$/.test(T[k - (a0 < t.s ? 3 : 2)].v) && T[k - (a0 < t.s ? 4 : 3)] && /^(?:const|let|var|,)$/.test(T[k - (a0 < t.s ? 4 : 3)].v)) label = T[k - (a0 < t.s ? 3 : 2)].v;
          else if (top && top.t === "obj" && top.key != null) { label = KEYL[top.key] || top.key; if (call && /Material$/.test(call.callee)) part = "Material"; }
          else if (top && top.t === "arr" && up && up.t === "attr") {
            var g = up.attr === "args" && up.tag ? GEOL[up.tag.replace(/Geometry$/i, "").toLowerCase()] : null;
            if (g) { label = g[ix] || "Forma · valor " + (ix + 1); part = "Forma"; }
            else if (up.attr === "args" && up.tag && /^color$/i.test(up.tag)) label = "Color de fondo";
            else label = (KEYL[up.attr] || up.attr) + " " + (["X", "Y", "Z", "W"][ix] || ix + 1);
          }
          else if (top && top.t === "attr" && p1 && p1.v === "{" && n1 && n1.v === "}") { label = KEYL[top.attr] || top.attr; if (top.tag && /Material$/i.test(top.tag)) part = "Material"; }
          else if (top && top.t === "call" && top.isNew) {
            var gl = /Geometry$/.test(top.callee) ? GEOL[top.callee.replace(/(?:Buffer)?Geometry$/, "").toLowerCase()] : null;
            if (gl) { label = gl[ix] || "Forma · valor " + (ix + 1); part = "Forma"; }
            else if (CTORL[top.callee]) label = CTORL[top.callee][ix] || null;
          }
          var ow = ownerOf(t.s), dv = !ow ? declVar(t.s) : null;
          if (!label) { label = snippet(a0, t.e); part = part || (ow ? "Animación y otros" : null); }
          else if (!ow && dv && label !== dv) label = dv + " · " + label;
          out.push({ i: out.length, s: a0, e: t.e, type: lit.type, v: lit.v, q: lit.q || null, int: lit.type === "num" && /^-?\d+$/.test(s.slice(a0, t.e).replace(/\s/g, "")), label: label, part: part || (ow ? "Otros valores" : null),
            obj: ow ? ow.key : null, objLabel: ow ? ow.label : null, via: c ? c[2] : "value", ref: c ? c[3] : null, jsxBool: lit.type === "bool" && !!(top && top.t === "attr"), code: snippet(a0, t.e) });
          if (out.length >= 600) break;
        }
      });
      out.skipped = skipped;
      VALC = { h: h, v: out };
      return out;
    }
    /* escribe el valor i (de codeValues) en su lugar. Un nombre nuevo se lleva los ajustes del objeto (bloque ▸ musa). */
    function setCodeValue(src, i, val) {
      var s = String(src || ""), it = codeValues(s)[+i]; if (!it) return s;
      var lit;
      if (it.type === "num") { var nv = +val; if (!isFinite(nv)) return s; lit = fmtN(it.int && Math.abs(nv - Math.round(nv)) < 1e-9 ? Math.round(nv) : nv); }
      else if (it.type === "hex") { var hx = typeof val === "number" ? ("000000" + ((val >>> 0) & 0xffffff).toString(16)).slice(-6) : hex6(val).slice(1); if (!/^[0-9a-f]{6}$/i.test(hx)) return s; lit = "0x" + hx; }
      else if (it.type === "color") { var h6 = hex6(val); if (!/^#[0-9a-f]{6}$/i.test(h6)) return s; var qq = it.q === "'" ? "'" : '"'; lit = qq + h6 + qq; }
      else if (it.type === "bool") lit = val === true || val === "1" || val === "true" ? "true" : "false";
      else { var tx = String(val).replace(/[\n\r]/g, " ").trim().slice(0, 80); if (!tx || tx === it.v) return s; lit = JSON.stringify(tx); if (it.q === "'") lit = "'" + tx.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'"; }
      var out = s.slice(0, it.s) + lit + s.slice(it.e);
      if (it.type === "text") {
        var a = "o:n:" + it.v + "|", b = "o:n:" + String(val).replace(/[\n\r]/g, " ").trim().slice(0, 80) + "|", ov = ovOf(out);
        Object.keys(ov).forEach(function (k) { if (k.indexOf(a) === 0) { out = setOv(out, b + k.slice(a.length), JSON.parse(JSON.stringify(ov[k]))); out = setOv(out, k, null); } });
      }
      return out;
    }
    /* la variable de un objeto que Musa agregó como copia (no está en el mapa de la escena): por su nombre */
    function addedVar(src, name) {
      var m = new RegExp("/\\* agregado en Musa \\*/ const ([A-Za-z_$][\\w$]*) = [^\\n]*\\n[ \\t]*\\1\\.name = " + JSON.stringify(String(name)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ";").exec(String(src || ""));
      return m ? m[1] : null;
    }
    /* el código de un objeto que agregó Musa (para quitarlo): sus líneas, si son las que Musa escribió */
    /* ¿lo agregó Musa? (para ofrecer quitarlo) */
    function addedByMusa(src, o) {
      var s = String(src || "");
      if (!o) return false;
      if (o.jsx) return /\{\/\* agregado en Musa \*\/\}\s*$/.test(s.slice(Math.max(0, o.at - 40), o.at));
      return new RegExp("/\\* agregado en Musa \\*/ const " + o.v.replace(/\$/g, "\\$") + " = ").test(s);
    }
    /* quitar un objeto se lleva también sus keyframes y ajustes del bloque ▸ musa (si no, quedarían huérfanos) */
    function removeObject(src, vn) {
      var s0 = String(src || ""), o = sceneMap(s0).by[vn], out = removeCode(s0, vn, o); if (out == null) return null;
      var pre = ["o:v:" + vn + "|"]; if (o && o.name) pre.push("o:n:" + o.name + "|");
      var ov = ovOf(out); Object.keys(ov).forEach(function (k) { if (pre.some(function (x) { return k.indexOf(x) === 0; })) out = setOv(out, k, null); });
      return out;
    }
    function removeCode(s0, vn, o) {
      if (o && o.jsx) {
        if (!addedByMusa(s0, o)) return null;
        var mk = s0.lastIndexOf("{/* agregado en Musa */}", o.at), ls = s0.lastIndexOf("\n", mk - 1) + 1, endAt = o.end;
        if (!o.self) { var cl = s0.indexOf("</" + o.tag + ">", o.end); if (cl < 0) return null; endAt = cl + o.tag.length + 3; }
        var nl = s0.indexOf("\n", endAt), tail = nl >= 0 && /^[ \t]*$/.test(s0.slice(endAt, nl)) ? nl + 1 : endAt;
        return s0.slice(0, /^[ \t]*$/.test(s0.slice(ls, mk)) ? ls : mk) + s0.slice(tail);
      }
      var s = s0, re = new RegExp("\\n[ \\t]*/\\* agregado en Musa \\*/ const " + vn.replace(/\$/g, "\\$") + " = [^\\n]*(?:\\n[ \\t]*(?:const )?" + vn.replace(/\$/g, "\\$") + "(?:Luz)?[ .=][^\\n]*)*"), m = re.exec(s);
      if (!m) return null;
      return dropStmts(s.slice(0, m.index) + s.slice(m.index + m[0].length), vn);
    }
    /* el código dentro de <script type="text/musa-live">: reversible y legible */
    function escScript(s) { return String(s).replace(/<(\\*)\/(script)/gi, function (m, bs, w) { return "<" + bs + "\\/" + w; }).replace(/<(\\*)!--/g, function (m, bs) { return "<" + bs + "\\!--"; }); }
    function unescScript(s) { return String(s).replace(/<(\\+)\/(script)/gi, function (m, bs, w) { return "<" + bs.slice(1) + "/" + w; }).replace(/<(\\+)!--/g, function (m, bs) { return "<" + bs.slice(1) + "!--"; }); }
    /* tamaño del lienzo del código: el de la composición de origen, o el de la caja del clip (máx. 2048 px) */
    function liveSize(c, W0, H0) {
      var L = (c && c.live) || {}; if (+L.W > 0 && +L.H > 0) return [Math.round(+L.W), Math.round(+L.H)];
      var w = Math.max(16, Math.round((+W0 || 1080) * (+c.w || 40) / 100)), h = Math.max(16, Math.round(w / Math.max(0.05, +c.ar || 1)));
      /* un clip a lienzo completo mide justo el lienzo (antes la proporción redondeada a 2 decimales daba 1920×1079) */
      if (+H0 > 0 && (+c.w || 0) >= 99.9 && Math.abs(h - H0) <= Math.max(2, H0 * 0.004)) h = Math.round(+H0);
      var k = Math.min(1, 2048 / Math.max(w, h));
      return [Math.round(w * k), Math.round(h * k)];
    }
    function hash(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
    return { IMPORTS: IMPORTS, R3_IMPORTS: R3_IMPORTS, P5_URL: P5_URL, LIBS_REMOTION: LIBS_REMOTION, LIB_NAMES: LIB_NAMES, libOf: libOf, isHtml: isHtml, isCanvasCode: isCanvasCode, prep: prep, wrapJs: wrapJs,
      analyze: analyze, instrument: instrument, bake: bake, bakedSrc: bakedSrc, fmtLit: fmtLit, valAt: valAt, runSrc: runSrc, usesR3: usesR3, liveMeta: liveMeta, liveSize: liveSize, isStatic: isStatic, escScript: escScript, unescScript: unescScript, hash: hash,
      PROPS3: PROPS3, LAB3: LAB3, off0: off0, comb3: comb3, toOff3: toOff3, hex6: hex6, sceneMap: sceneMap, codeObjects: codeObjects, view3: view3, slotVal: slotVal, findObj: findObj, set3: set3, setParam: setParam,
      blockOf: blockOf, ovOf: ovOf, canon: canon, setOv: setOv, writeBlock: writeBlock, normalize: normalize, applyEdits: applyEdits, addObject: addObject, removeObject: removeObject, dupObject: dupObject, addedVar: addedVar, codeValues: codeValues, setCodeValue: setCodeValue, canAdd: canAdd, GEO: GEO,
      isR3: isR3, addedByMusa: addedByMusa };
  }

  /* ═════════════ dentro del sandbox: reloj virtual, parámetros de Musa y ganchos de Three.js ═════════════ */
  function preludeLive(cfg) {
    var RT = window.setTimeout.bind(window), T = 0, seq = 1, timers = [], rafs = [], EPOCH = 1767225600000;
    window.__name = window.__name || function (f) { return f; };
    window.__mvcClock = {
      realTimeout: RT, get t() { return T; },
      advance: function (to) {
        var guard = 0;
        for (;;) {
          timers.sort(function (a, b) { return a.at - b.at || a.id - b.id; });
          var x = timers[0]; if (!x || x.at > to + 1e-9 || ++guard > 5000) break;
          T = Math.max(T, x.at);
          if (x.every) x.at += x.every; else timers.shift();
          try { x.cb.apply(window, x.args); } catch (e) { /* el código falló en ese instante */ }
        }
        T = to;
        var q = rafs; rafs = [];
        q.forEach(function (r) { try { r.cb(T * 1000); } catch (e) { (window.__mvcErrors = window.__mvcErrors || []).push(String(e && e.message || e)); } });
      },
      /* saltar a un instante sin pasar por los anteriores (código que se dibuja solo a partir del tiempo) */
      set: function (to) { T = to; var q = rafs; rafs = []; q.forEach(function (r) { try { r.cb(T * 1000); } catch (e) { /* idem */ } }); },
    };
    try { performance.now = function () { return T * 1000; }; } catch (e) { /* sin performance */ }
    Date.now = function () { return EPOCH + T * 1000; };
    window.requestAnimationFrame = function (cb) { var id = seq++; rafs.push({ id: id, cb: cb }); return id; };
    window.cancelAnimationFrame = function (id) { rafs = rafs.filter(function (x) { return x.id !== id; }); };
    window.setTimeout = function (cb, ms) { var id = seq++; if (typeof cb === "function") timers.push({ id: id, at: T + Math.max(0, +ms || 0) / 1000, cb: cb, args: [].slice.call(arguments, 2) }); return id; };
    window.setInterval = function (cb, ms) { var id = seq++; ms = Math.max(4, +ms || 0); if (typeof cb === "function") timers.push({ id: id, at: T + ms / 1000, cb: cb, every: ms / 1000, args: [] }); return id; };
    window.clearTimeout = window.clearInterval = function (id) { timers = timers.filter(function (x) { return x.id !== id; }); };
    /* azar con semilla: el mismo cuadro sale igual cada vez (si no, al volver atrás las partículas saltan) */
    var sd = 0x9e3779b9;
    Math.random = function () { sd = (sd + 0x6D2B79F5) | 0; var t = Math.imul(sd ^ (sd >>> 15), 1 | sd); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    /* WebGL conserva el cuadro dibujado para poder copiarlo */
    try {
      var gc = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, attrs) { if (/webgl/i.test(String(type))) attrs = Object.assign({}, attrs || {}, { preserveDrawingBuffer: true }); return gc.call(this, type, attrs); };
    } catch (e) { /* sin canvas */ }
    /* contratos de las skills de video: HyperFrames, onetake, GSAP, Lottie, anime */
    var HF = { n: 0 }; window.__mvlHF = HF;
    var ael = window.addEventListener;
    window.addEventListener = function (type) { if (type === "hf-seek") HF.n++; return ael.apply(this, arguments); };
    window.__hf = window.__hf || { buildReady: {} };
    window.__hyperframes = window.__hyperframes || { tracer: false, getVariables: function () { return {}; } };
    window.__timelines = window.__timelines || {};
    window.__hfLottie = window.__hfLottie || []; window.__hfAnime = window.__hfAnime || [];
    window.addEventListener("error", function (e) { (window.__mvcErrors = window.__mvcErrors || []).push(String(e && e.message || e)); });
    window.addEventListener("unhandledrejection", function (e) { (window.__mvcErrors = window.__mvcErrors || []).push(String(e && e.reason && (e.reason.message || e.reason) || "promesa rechazada")); });

    /* ── parámetros de Musa (p: v: r:) ── */
    var OV = cfg.ov || {}, REG = {};
    function at(e, t, d) {
      if (!e) return d;
      var K = e.kf; if (!K || !K.length) return e.v !== undefined ? e.v : d;
      if (K.length === 1 || t <= K[0].t) return K[0].v;
      var L = K[K.length - 1]; if (t >= L.t) return L.v;
      for (var i = 1; i < K.length; i++) if (t <= K[i].t) {
        var a = K[i - 1], b = K[i], u = (t - a.t) / Math.max(1e-6, b.t - a.t);
        if (a.e === "smooth") u = u * u * (3 - 2 * u); else if (a.e === "in") u = u * u; else if (a.e === "out") u = 1 - (1 - u) * (1 - u); else if (a.e === "hold") u = 0;
        return typeof a.v === "number" && typeof b.v === "number" ? a.v + (b.v - a.v) * u : (u < 1 ? a.v : b.v);
      }
      return L.v;
    }
    function setPath(o, path, v) { var ks = path.split("."), x = o; for (var i = 0; i < ks.length - 1; i++) { if (x[ks[i]] == null || typeof x[ks[i]] !== "object") return; x = x[ks[i]]; } x[ks[ks.length - 1]] = v; }
    window.__musaLt = 0;
    window.__musaP = function (name, obj) {
      if (!obj || typeof obj !== "object") return obj;
      REG[name] = obj;
      Object.keys(OV).forEach(function (k) { if (k.indexOf("p:" + name + ".") !== 0) return; var e = OV[k]; var v = at(e, window.__musaLt, undefined); if (v !== undefined) setPath(obj, k.slice(name.length + 3), v); });
      return obj;
    };
    window.__musaV = function (name, v) { var e = OV["v:" + name]; return e && e.v !== undefined ? e.v : v; };
    window.__musaKf = function (lt) {
      window.__musaLt = lt;
      Object.keys(OV).forEach(function (k) {
        var e = OV[k]; if (!e || k.indexOf("p:") !== 0 || (!(e.kf && e.kf.length) && e.v === undefined)) return;
        var rest = k.slice(2), dot = rest.indexOf("."), name = rest.slice(0, dot);
        if (REG[name]) setPath(REG[name], rest.slice(dot + 1), at(e, lt));
      });
    };
    window.__musaOvAll = function (prefix) { var o = null; Object.keys(OV).forEach(function (k) { if (k.indexOf(prefix) !== 0) return; var v = at(OV[k], window.__musaLt, undefined); if (v === undefined) return; (o = o || {})[k.slice(prefix.length)] = v; }); return o; };
    window.__musaSetOv = function (ov) { OV = ov || {}; };

    /* ── Three.js: el renderizador y la escena avisan al crearse (__THREE_DEVTOOLS__); los ajustes de Musa se aplican
       justo antes de cada render y se deshacen después (el código del usuario sigue mandando en su animación) ── */
    var T3 = window.__musa3 = { renderers: [], last: null };
    function mats(o) { var m = o.material; return !m ? [] : Array.isArray(m) ? m : [m]; }
    window.__musaTag = function (name, o) { try { if (o && o.userData) o.userData.__mv = name; } catch (e) { /* objeto sin userData */ } return o; };
    function objAt(scene, path, camera) {
      if (path.indexOf("v:") === 0) {
        var vn = path.slice(2), vm = /^(.*)#(\d+)$/.exec(vn), vw = vm ? +vm[2] : 0, vk = 0, vf = null;
        if (vm) vn = vm[1];
        scene.traverse(function (o) { if (!vf && o.userData && o.userData.__mv === vn) { if (vk === vw) vf = o; vk++; } });
        if (!vf && camera && camera.userData && camera.userData.__mv === vn) vf = camera;
        return vf;
      }
      if (path.indexOf("n:") === 0) {
        var nm = path.slice(2), mm = /^(.*)#(\d+)$/.exec(nm), want = mm ? +mm[2] : 0, k = 0, found = null;
        if (mm) nm = mm[1];
        scene.traverse(function (o) { if (!found && o !== scene && o.name === nm) { if (k === want) found = o; k++; } });
        return found;
      }
      var ix = path.slice(2).split(".").map(Number), o = scene;
      for (var i = 0; i < ix.length && o; i++) o = o.children && o.children[ix[i]];
      return o || null;
    }
    function apply3(o, prop, v, undo) {
      var D = Math.PI / 180;
      if (prop === "px" || prop === "py" || prop === "pz") { var ax = prop.charAt(1), p0 = o.position[ax]; o.position[ax] = p0 + v; undo.push(function () { o.position[ax] = p0; }); }
      else if (prop === "rx" || prop === "ry" || prop === "rz") { var ar = prop.charAt(1), r0 = o.rotation[ar]; o.rotation[ar] = r0 + v * D; undo.push(function () { o.rotation[ar] = r0; }); }
      else if (prop === "s") { var sx = o.scale.x, sy = o.scale.y, sz = o.scale.z; o.scale.set(sx * v, sy * v, sz * v); undo.push(function () { o.scale.set(sx, sy, sz); }); }
      else if (prop === "vis") { var vv = o.visible; o.visible = !!v; undo.push(function () { o.visible = vv; }); }
      else if (prop === "color") {
        if (o.isLight && o.color) { var lc = o.color.getHex(); o.color.set(v); undo.push(function () { o.color.setHex(lc); }); }
        else mats(o).forEach(function (m) { if (!m.color) return; var c0 = m.color.getHex(); m.color.set(v); undo.push(function () { m.color.setHex(c0); }); });
      }
      else if (prop === "emi") mats(o).forEach(function (m) { if (!m.emissive) return; var e0 = m.emissive.getHex(); m.emissive.set(v); undo.push(function () { m.emissive.setHex(e0); }); });
      else if (prop === "op") mats(o).forEach(function (m) { var a0 = m.opacity, t0 = m.transparent; m.opacity = a0 * v; if (v < 1) m.transparent = true; undo.push(function () { m.opacity = a0; m.transparent = t0; }); });
      else if (prop === "int") { if (o.intensity != null) { var i0 = o.intensity; o.intensity = i0 * v; undo.push(function () { o.intensity = i0; }); } }
      else if (prop === "fov") { if (o.isPerspectiveCamera) { var f0 = o.fov; o.fov = v; o.updateProjectionMatrix(); undo.push(function () { o.fov = f0; o.updateProjectionMatrix(); }); } }
    }
    window.__musaOv3 = function (scene, camera) {
      var keys = Object.keys(OV).filter(function (k) { return k.indexOf("o:") === 0; }); if (!keys.length || !scene) return null;
      var undo = [];
      keys.forEach(function (k) {
        var bar = k.lastIndexOf("|"), path = k.slice(2, bar), prop = k.slice(bar + 1);
        var o = path === "cam" ? camera : objAt(scene, path, camera); if (!o) return;
        var v = at(OV[k], window.__musaLt, undefined); if (v === undefined || v === null) return;
        try { apply3(o, prop, v, undo); } catch (e) { /* propiedad que ese objeto no tiene */ }
      });
      return function () { for (var i = undo.length - 1; i >= 0; i--) try { undo[i](); } catch (e) { /* idem */ } };
    };
    function hookR(r) {
      if (!r || r.__musa || typeof r.render !== "function") return;
      r.__musa = 1; T3.renderers.push(r);
      var orig = r.render;
      r.render = function (scene, camera) {
        if (scene && scene.isScene) T3.last = { scene: scene, camera: camera };
        var undo = scene && scene.isScene ? window.__musaOv3(scene, camera) : null;
        try { return orig.apply(this, arguments); } finally { if (undo) undo(); }
      };
    }
    try {
      var dt = new EventTarget();
      dt.addEventListener("observe", function (e) { var o = e.detail; if (o && !o.isScene && o.domElement && typeof o.render === "function") hookR(o); });
      window.__THREE_DEVTOOLS__ = dt;
    } catch (e) { /* sin EventTarget */ }
    window.__musaScene = function () {
      var L = T3.last; if (!L || !L.scene) return null;
      var out = [], names = {};
      (function walk(o, path, depth) {
        if (out.length >= 160) return;
        if (o !== L.scene) {
          var nm = o.name || "", key;
          var mv = o.userData && o.userData.__mv;
          if (nm) { var k = names[nm] = (names[nm] || 0) + 1; key = "n:" + nm + (k > 1 ? "#" + (k - 1) : ""); }
          else if (mv) { var kv = names["@v:" + mv] = (names["@v:" + mv] || 0) + 1; key = "v:" + mv + (kv > 1 ? "#" + (kv - 1) : ""); }
          else key = "i:" + path;
          var m = mats(o)[0], col = o.isLight && o.color ? o.color : m && m.color ? m.color : null;
          out.push({ k: key, v: mv || null, n: nm || (mv ? mv : o.type), type: o.type, d: depth, color: col && col.getHexString ? "#" + col.getHexString() : null, light: o.isLight ? 1 : 0, mesh: o.isMesh || o.isPoints || o.isLine ? 1 : 0, vis: o.visible !== false, inst: o.isInstancedMesh ? o.count : 0,
            /* para no ofrecer controles que no hacen nada: ¿el material tiene brillo propio?, ¿la luz usa su posición? */
            emi: m && m.emissive ? 1 : 0, nopos: o.isAmbientLight ? 1 : 0 });
        }
        (o.children || []).forEach(function (c, i) { walk(c, path ? path + "." + i : String(i), depth + 1); });
      })(L.scene, "", 0);
      var c = L.camera;
      return { objs: out, cam: c ? { type: c.type, v: c.userData && c.userData.__mv || null, fov: c.isPerspectiveCamera ? Math.round(c.fov * 100) / 100 : null } : null };
    };
    /* dónde cae cada objeto en la pantalla (0–1), sin Raycaster ni la librería a mano: su caja pasada por la cámara.
       ux / uy = cuánto se mueve el objeto (en el espacio de su padre) al arrastrarlo todo el ancho / alto del lienzo. */
    window.__musaBoxes = function () {
      var L = T3.last; if (!L || !L.scene || !L.camera) return null;
      var cam = L.camera, P = cam.projectionMatrix && cam.projectionMatrix.elements, V = cam.matrixWorldInverse && cam.matrixWorldInverse.elements, CW = cam.matrixWorld && cam.matrixWorld.elements;
      if (!P || !V || !CW) return null;
      function mul(m, x, y, z) { return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14], m[3] * x + m[7] * y + m[11] * z + m[15]]; }
      function inv3dir(m, v) {
        var a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
        var A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C; if (!det) return v;
        var D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g), G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d;
        return [(A * v[0] + D * v[1] + G * v[2]) / det, (B * v[0] + E * v[1] + H * v[2]) / det, (C * v[0] + F * v[1] + I * v[2]) / det];
      }
      var ortho = Math.abs(P[15] - 1) < 1e-6, out = {}, names = {}, n = 0;
      (function walk(o, path) {
        if (n >= 160) return;
        if (o !== L.scene) {
          n++;
          var nm = o.name || "", key, mv = o.userData && o.userData.__mv;
          if (nm) { var k = names[nm] = (names[nm] || 0) + 1; key = "n:" + nm + (k > 1 ? "#" + (k - 1) : ""); }
          else if (mv) { var kv = names["@v:" + mv] = (names["@v:" + mv] || 0) + 1; key = "v:" + mv + (kv > 1 ? "#" + (kv - 1) : ""); }
          else key = "i:" + path;
          var g = o.geometry, M = o.matrixWorld && o.matrixWorld.elements, vis = o.visible !== false;
          /* una luz con posición (no la ambiente) se ve como un punto que se puede agarrar */
          if (o.isLight && M && vis && !o.isAmbientLight && !o.isHemisphereLight) {
            var lv = mul(V, M[12], M[13], M[14]), lc = mul(P, lv[0], lv[1], lv[2]);
            if (lc[3] > 1e-6) {
              var lx = (lc[0] / lc[3] + 1) / 2, ly = (1 - lc[1] / lc[3]) / 2, ld = Math.max(1e-4, -lv[2]);
              var lfw = ortho ? 2 / P[0] : 2 * ld / P[0], lfh = ortho ? 2 / P[5] : 2 * ld / P[5];
              var lux = [CW[0] * lfw, CW[1] * lfw, CW[2] * lfw], luy = [-CW[4] * lfh, -CW[5] * lfh, -CW[6] * lfh];
              var lpm = o.parent && o.parent.matrixWorld && o.parent.matrixWorld.elements; if (lpm) { lux = inv3dir(lpm, lux); luy = inv3dir(lpm, luy); }
              /* fuera de cuadro: se deja pegada al borde para poder traerla */
              var cx2 = Math.min(0.975, Math.max(0.025, lx)), cy2 = Math.min(0.96, Math.max(0.04, ly));
              out[key] = { b: [cx2 - 0.016, cy2 - 0.028, cx2 + 0.016, cy2 + 0.028], z: ld, ux: lux, uy: luy, p: [o.position.x, o.position.y, o.position.z], gz: 1, off: lx !== cx2 || ly !== cy2 ? 1 : 0 };
            }
          }
          for (var q = o.parent; q && vis; q = q.parent) if (q.visible === false) vis = false;
          if (g && M && vis && (o.isMesh || o.isLine || o.isPoints || o.isSprite)) {
            try {
              if (!g.boundingBox && g.computeBoundingBox) g.computeBoundingBox();
              var bb = g.boundingBox;
              if (bb && isFinite(bb.min.x) && isFinite(bb.max.x)) {
                var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, ok = 0;
                for (var ci = 0; ci < 8; ci++) {
                  var w = mul(M, ci & 1 ? bb.max.x : bb.min.x, ci & 2 ? bb.max.y : bb.min.y, ci & 4 ? bb.max.z : bb.min.z), v = mul(V, w[0], w[1], w[2]), c = mul(P, v[0], v[1], v[2]);
                  if (c[3] <= 1e-6) continue;
                  var sx = (c[0] / c[3] + 1) / 2, sy = (1 - c[1] / c[3]) / 2; ok++;
                  if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
                }
                if (ok >= 4 && x1 > 0 && x0 < 1 && y1 > 0 && y0 < 1) {
                  var ctr = mul(V, M[12], M[13], M[14]), dist = Math.max(1e-4, -ctr[2]);
                  var fw = ortho ? 2 / P[0] : 2 * dist / P[0], fh = ortho ? 2 / P[5] : 2 * dist / P[5];
                  var ux = [CW[0] * fw, CW[1] * fw, CW[2] * fw], uy = [-CW[4] * fh, -CW[5] * fh, -CW[6] * fh];
                  var pm = o.parent && o.parent.matrixWorld && o.parent.matrixWorld.elements;
                  if (pm) { ux = inv3dir(pm, ux); uy = inv3dir(pm, uy); }
                  out[key] = { b: [x0, y0, x1, y1], z: dist, ux: ux, uy: uy, p: [o.position.x, o.position.y, o.position.z], pts: o.isPoints ? 1 : 0 };
                }
              }
            } catch (e) { /* geometría sin caja */ }
          }
        }
        (o.children || []).forEach(function (ch, i) { walk(ch, path ? path + "." + i : String(i)); });
      })(L.scene, "");
      /* la cámara: cuánto se mueve al arrastrar el lienzo entero (a la distancia del centro de la escena) */
      var cd = Math.max(1, Math.hypot(CW[12], CW[13], CW[14])), cfw = ortho ? 2 / P[0] : 2 * cd / P[0], cfh = ortho ? 2 / P[5] : 2 * cd / P[5];
      var cux = [CW[0] * cfw, CW[1] * cfw, CW[2] * cfw], cuy = [-CW[4] * cfh, -CW[5] * cfh, -CW[6] * cfh], cpm = cam.parent && cam.parent.matrixWorld && cam.parent.matrixWorld.elements;
      if (cpm) { cux = inv3dir(cpm, cux); cuy = inv3dir(cpm, cuy); }
      out.cam = { cam: 1, ux: cux, uy: cuy, p: [cam.position.x, cam.position.y, cam.position.z] };
      return out;
    };
  }

  /* el conductor dentro del sandbox: espera a que el código cargue y devuelve el cuadro de cada instante */
  function liveMain(cfg) {
    var clock = window.__mvcClock, tok = cfg.token, fps = cfg.fps || 30, chain = Promise.resolve();
    function post(type, data, tr) { try { parent.postMessage({ __mvl: tok, type: type, data: data }, "*", tr || []); } catch (e) { parent.postMessage({ __mvl: tok, type: type, data: { id: data && data.id, none: 1, err: String(e && e.message || e) } }, "*"); } }
    function realWait(ms) { return new Promise(function (r) { clock.realTimeout(r, ms); }); }
    function loaded() { return document.readyState === "complete" ? Promise.resolve() : new Promise(function (r) { window.addEventListener("load", function () { r(); }, { once: true }); }); }
    function canvases() { return [].slice.call(document.querySelectorAll("canvas")).filter(function (c) { return !(c.closest && c.closest(".lil-gui,.dg,#stats,.stats")); }); }
    function pick() {
      var cs = canvases(); if (cfg.sel >= 0 && cs[cfg.sel]) return cs[cfg.sel];
      var best = null, ba = 0; cs.forEach(function (c) { var a = c.width * c.height; if (a > ba) { ba = a; best = c; } }); return best;
    }
    function seekable() {
      var tl = window.__timelines || {};
      return !!(typeof window.__seek === "function" || window.__mvlHF.n || Object.keys(tl).length || (window.__hfLottie || []).length || (window.__hfAnime || []).length);
    }
    async function boot() {
      try {
        if (window.__mvcBoot) await window.__mvcBoot();
        await Promise.race([loaded(), realWait(20000)]);
        await realWait(40);
        var br = window.__hf && window.__hf.buildReady;
        if (br && Object.keys(br).length) await Promise.race([Promise.all(Object.keys(br).map(function (k) { return br[k]; })), realWait(25000)]);
        if (window.__ready && typeof window.__ready.then === "function") await Promise.race([window.__ready, realWait(25000)]);
        if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, realWait(4000)]);
        for (var w = 0; w < 100 && !pick(); w++) await realWait(100);
        if (!window.__mvcStep) clock.advance(0);
        var meta = window.__meta || {};
        post("ready", { seekable: !!window.__mvcStep || seekable(), n: canvases().length, dur: +meta.dur || 0, errors: (window.__mvcErrors || []).slice(0, 3), loading: document.readyState !== "complete" });
      } catch (e) { post("error", String(e && e.message || e)); }
    }
    async function seekTo(t) {
      if (window.__mvcStep) { var rp = window.__mvcStep(t, 0, fps); if (rp && typeof rp.then === "function") await rp; return true; }
      if (seekable()) {
        var waits = [];
        clock.set(t);
        try { if (typeof window.__seek === "function") { var r = window.__seek(t); if (r && typeof r.then === "function") waits.push(r); } } catch (e) { /* el seek del código falló */ }
        try { window.dispatchEvent(new CustomEvent("hf-seek", { detail: { time: t, waitUntil: function (p) { waits.push(p); } } })); } catch (e) { /* idem */ }
        var tls = window.__timelines || {};
        Object.keys(tls).forEach(function (k) { try { tls[k].seek(t, false); } catch (e) { /* timeline roto */ } });
        (window.__hfLottie || []).forEach(function (a) { try { if (a.goToAndStop) a.goToAndStop(t * 1000, false); else if (a.setFrame) a.setFrame(Math.max(0, Math.min((a.totalFrames || 1) - 1, t * (a.frameRate || fps)))); } catch (e) { /* idem */ } });
        (window.__hfAnime || []).forEach(function (a) { try { a.seek(t * 1000); } catch (e) { /* idem */ } });
        if (waits.length) await Promise.race([Promise.all(waits), realWait(10000)]);
        return true;
      }
      var dt = 1 / fps;
      if (t < clock.t - 1e-6) return "reset";
      var guard = 0, moved = false;
      while (clock.t + dt <= t + 1e-9 && guard++ < 200000) { clock.advance(clock.t + dt); moved = true; if (guard % 45 === 0) await realWait(0); }
      if (clock.t < t - 1e-9) { clock.advance(t); moved = true; }
      /* el mismo instante otra vez (cambió un parámetro o un ajuste de la escena): se vuelve a dibujar ese cuadro */
      if (!moved) clock.set(t);
      return true;
    }
    async function frame(q) {
      if (window.__musaKf) window.__musaKf(+q.lt || 0);
      var r = await seekTo(+q.t || 0);
      if (r === "reset") return post("reset", { id: q.id });
      var cv = pick();
      if (!cv || !cv.width || !cv.height) return post("frame", { id: q.id, none: 1, err: (window.__mvcErrors || [])[0] || "el código no dibujó ningún canvas" });
      var bmp;
      try { bmp = await createImageBitmap(cv); } catch (e) { return post("frame", { id: q.id, none: 1, err: String(e && e.message || e) }); }
      post("frame", { id: q.id, bmp: bmp, w: cv.width, h: cv.height }, [bmp]);
      if (q.scene && window.__musaScene) post("scene", window.__musaScene());
      if (q.boxes && window.__musaBoxes) { try { post("boxes", window.__musaBoxes()); } catch (e) { /* sin cajas */ } }
    }
    window.addEventListener("message", function (e) {
      var d = e.data; if (!d || d.__mvl !== tok) return;
      if (d.type === "seek") chain = chain.then(function () { return frame(d); }).catch(function (er) { post("frame", { id: d.id, none: 1, err: String(er && er.message || er) }); });
      else if (d.type === "ov") { if (window.__musaSetOv) window.__musaSetOv(d.ov); }
      else if (d.type === "scene") post("scene", window.__musaScene ? window.__musaScene() : null);
    });
    boot();
  }

  /* ═════════════ Remotion dentro del sandbox: React + Babel + una versión mínima de «remotion»
     (frames, Sequence, interpolate, spring…) y @remotion/three con React Three Fiber ═════════════ */
  function remotionMain(cfg) {
    var R = window.React, RD = window.ReactDOM, h = R.createElement, warnings = window.__mvcWarn = [], MODS = {};
    var FrameCtx = R.createContext(0), ConfCtx = R.createContext(null), conf = { width: cfg.W, height: cfg.H, fps: cfg.fps || 30, durationInFrames: Math.round((cfg.dur || 5) * (cfg.fps || 30)), id: "Main", defaultProps: {}, props: {} };
    function useCurrentFrame() { return R.useContext(FrameCtx); }
    function useVideoConfig() { return R.useContext(ConfCtx) || conf; }
    var FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%", display: "flex", flexDirection: "column" };
    function AbsoluteFill(p) { return h("div", Object.assign({}, p, { style: Object.assign({}, FILL, p.style || {}) })); }
    function Sequence(p) {
      var f = useCurrentFrame(), from = +p.from || 0, d = p.durationInFrames == null ? Infinity : +p.durationInFrames;
      if (f < from || f >= from + d) return null;
      var inner = h(FrameCtx.Provider, { value: f - from }, p.children);
      return p.layout === "none" ? inner : h("div", { style: Object.assign({}, FILL, p.style || {}), "data-seq": p.name || "" }, inner);
    }
    function Series(p) {
      var at = 0, kids = [];
      R.Children.forEach(p.children, function (c) { if (!c || !c.props) return; var d = +c.props.durationInFrames || 0, off = +c.props.offset || 0; at += off; kids.push(h(Sequence, Object.assign({}, c.props, { from: at, key: kids.length }), c.props.children)); at += d; });
      return h(R.Fragment, null, kids);
    }
    Series.Sequence = function (p) { return h(Sequence, p, p.children); };
    function TransitionSeries(p) {
      var at = 0, kids = [], pend = 0;
      R.Children.forEach(p.children, function (c) {
        if (!c || !c.props) return;
        if (c.props.timing || c.props.presentation) { pend = c.props.timing && c.props.timing.durationInFrames || 0; at -= pend; return; }
        var d = +c.props.durationInFrames || 0, start = at, fadeIn = pend; pend = 0;
        kids.push(h(Sequence, { from: start, durationInFrames: d, key: kids.length, name: c.props.name }, h(FadeIn, { n: fadeIn }, c.props.children)));
        at += d;
      });
      return h(R.Fragment, null, kids);
    }
    function FadeIn(p) { var f = useCurrentFrame(); return h("div", { style: Object.assign({}, FILL, { opacity: p.n > 0 ? Math.min(1, f / p.n) : 1 }) }, p.children); }
    TransitionSeries.Sequence = function (p) { return p.children; };
    TransitionSeries.Transition = function () { return null; };
    function Img(p) { return h("img", Object.assign({}, p, { onError: undefined })); }
    function Vid(p) { var f = useCurrentFrame(); return h("video", { src: p.src, muted: true, "data-mvc-remotion": "1", "data-start-from": ((+p.startFrom || 0) / conf.fps).toFixed(3), "data-playback-rate": p.playbackRate || 1, "data-volume": p.muted ? 0 : (typeof p.volume === "number" ? p.volume : 1), "data-f": f, style: Object.assign({ width: "100%", height: "100%", objectFit: "cover" }, p.style || {}) }); }
    function Aud(p) { return h("audio", { src: p.src, "data-mvc-remotion": "1", "data-start-from": ((+p.startFrom || 0) / conf.fps).toFixed(3), "data-volume": typeof p.volume === "number" ? p.volume : 1, style: { display: "none" } }); }
    var Easing = {
      linear: function (t) { return t; }, ease: bez(0.25, 0.1, 0.25, 1), quad: function (t) { return t * t; }, cubic: function (t) { return t * t * t; }, poly: function (n) { return function (t) { return Math.pow(t, n); }; },
      sin: function (t) { return 1 - Math.cos(t * Math.PI / 2); }, circle: function (t) { return 1 - Math.sqrt(1 - t * t); }, exp: function (t) { return Math.pow(2, 10 * (t - 1)); },
      elastic: function (b) { b = b == null ? 1 : b; var p = b * Math.PI; return function (t) { return 1 - Math.pow(Math.cos(t * Math.PI / 2), 3) * Math.cos(t * p); }; },
      back: function (s) { s = s == null ? 1.70158 : s; return function (t) { return t * t * ((s + 1) * t - s); }; },
      bounce: function (t) { if (t < 1 / 2.75) return 7.5625 * t * t; if (t < 2 / 2.75) { t -= 1.5 / 2.75; return 7.5625 * t * t + 0.75; } if (t < 2.5 / 2.75) { t -= 2.25 / 2.75; return 7.5625 * t * t + 0.9375; } t -= 2.625 / 2.75; return 7.5625 * t * t + 0.984375; },
      bezier: function (a, b, c, d) { return bez(a, b, c, d); },
      "in": function (f) { return f; }, out: function (f) { return function (t) { return 1 - f(1 - t); }; }, inOut: function (f) { return function (t) { return t < 0.5 ? f(t * 2) / 2 : 1 - f((1 - t) * 2) / 2; }; },
    };
    function bez(x1, y1, x2, y2) { return function (x) { if (x <= 0) return 0; if (x >= 1) return 1; var t = x; for (var i = 0; i < 12; i++) { var bx = 3 * x1 * t * (1 - t) * (1 - t) + 3 * x2 * t * t * (1 - t) + t * t * t - x, d = 3 * x1 * (1 - t) * (1 - t) + 6 * (x2 - x1) * t * (1 - t) + 3 * (1 - x2) * t * t; if (Math.abs(bx) < 1e-6 || Math.abs(d) < 1e-6) break; t = Math.max(0, Math.min(1, t - bx / d)); } return 3 * y1 * t * (1 - t) * (1 - t) + 3 * y2 * t * t * (1 - t) + t * t * t; }; }
    function interpolate(input, ir, or, o) {
      o = o || {}; var el = o.extrapolateLeft || "extend", er = o.extrapolateRight || "extend", e = o.easing || function (t) { return t; };
      var i = 1; while (i < ir.length - 1 && input > ir[i]) i++;
      var a = ir[i - 1], b = ir[i], va = or[i - 1], vb = or[i];
      if (input < ir[0]) { if (el === "clamp") return or[0]; if (el === "identity") return input; }
      if (input > ir[ir.length - 1]) { if (er === "clamp") return or[or.length - 1]; if (er === "identity") return input; }
      var u = b === a ? 0 : (input - a) / (b - a);
      return va + (vb - va) * e(u);
    }
    function spring(o) {
      var fps = o.fps || conf.fps, c = o.config || {}, m = c.mass || 1, k = c.stiffness || 100, dmp = c.damping == null ? 10 : c.damping, from = o.from == null ? 0 : o.from, to = o.to == null ? 1 : o.to;
      var fr = (o.frame || 0) - (o.delay || 0); if (o.durationInFrames) fr = fr * (spDur(m, k, dmp, fps) / o.durationInFrames);
      if (o.reverse) { var tmp = from; from = to; to = tmp; }
      if (fr <= 0) return from;
      var t = fr / fps, w0 = Math.sqrt(k / m), z = dmp / (2 * Math.sqrt(k * m)), x;
      if (z < 1) { var wd = w0 * Math.sqrt(1 - z * z); x = 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t)); }
      else if (z === 1) x = 1 - Math.exp(-w0 * t) * (1 + w0 * t);
      else { var r1 = -w0 * (z - Math.sqrt(z * z - 1)), r2 = -w0 * (z + Math.sqrt(z * z - 1)); x = 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1); }
      if (c.overshootClamping && x > 1) x = 1;
      return from + (to - from) * x;
    }
    function spDur(m, k, d, fps) { for (var f = 1; f < 600; f++) { var v = spring({ frame: f, fps: fps, config: { mass: m, stiffness: k, damping: d } }); if (Math.abs(v - 1) < 0.005) { var ok = true; for (var g = f; g < f + 10; g++) if (Math.abs(spring({ frame: g, fps: fps, config: { mass: m, stiffness: k, damping: d } }) - 1) > 0.005) ok = false; if (ok) return f; } } return 600; }
    function interpolateColors(input, ir, colors) {
      var parse = function (c) { var d = document.createElement("canvas").getContext("2d"); d.fillStyle = c; var s = d.fillStyle; if (s[0] === "#") return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 1]; var m = s.match(/[\d.]+/g) || [0, 0, 0, 1]; return [+m[0], +m[1], +m[2], m[3] != null ? +m[3] : 1]; };
      var cs = colors.map(parse), i = 1; while (i < ir.length - 1 && input > ir[i]) i++;
      var u = Math.max(0, Math.min(1, (input - ir[i - 1]) / ((ir[i] - ir[i - 1]) || 1))), a = cs[i - 1], b = cs[i];
      return "rgba(" + Math.round(a[0] + (b[0] - a[0]) * u) + "," + Math.round(a[1] + (b[1] - a[1]) * u) + "," + Math.round(a[2] + (b[2] - a[2]) * u) + "," + (a[3] + (b[3] - a[3]) * u) + ")";
    }
    function random(seed) { var s = String(seed), h1 = 2166136261; for (var i = 0; i < s.length; i++) { h1 ^= s.charCodeAt(i); h1 = Math.imul(h1, 16777619); } var t = (h1 >>> 0) + 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }
    function Loop(p) { var f = useCurrentFrame(), d = +p.durationInFrames || 1, times = p.times == null ? Infinity : +p.times; if (f >= d * times) return null; return h(FrameCtx.Provider, { value: f % d }, p.layout === "none" ? p.children : h("div", { style: FILL }, p.children)); }
    function Freeze(p) { return h(FrameCtx.Provider, { value: +p.frame || 0 }, p.children); }
    var comps = [], rootComp = null;
    function Composition(p) { comps.push(p); return null; }
    var remotion = { useCurrentFrame: useCurrentFrame, useVideoConfig: useVideoConfig, AbsoluteFill: AbsoluteFill, Sequence: Sequence, Series: Series, Img: Img, Video: Vid, OffthreadVideo: Vid, Html5Video: Vid, Audio: Aud, Html5Audio: Aud,
      interpolate: interpolate, spring: spring, Easing: Easing, interpolateColors: interpolateColors, random: random, Loop: Loop, Freeze: Freeze, Composition: Composition, Still: function (p) { comps.push(Object.assign({ durationInFrames: 1 }, p)); return null; }, Folder: function (p) { return h(R.Fragment, null, p.children); },
      registerRoot: function (C) { rootComp = C; }, staticFile: function (f) { warnings.push("staticFile(\"" + f + "\"): ese archivo no está en Musa (súbelo y usa su URL)"); return f; }, delayRender: function () { return 0; }, continueRender: function () {}, cancelRender: function () {}, getInputProps: function () { return {}; },
      useCurrentScale: function () { return 1; }, measureSpring: function (o) { var c = o.config || {}; return spDur(c.mass || 1, c.stiffness || 100, c.damping == null ? 10 : c.damping, o.fps || conf.fps); }, IFrame: function (p) { return h("iframe", p); }, prefetch: function () { return { free: function () {}, waitUntilDone: function () { return Promise.resolve(); } }; } };
    var shapes = {
      Circle: function (p) { var r = p.radius || 50; return h("svg", { width: r * 2, height: r * 2, viewBox: "0 0 " + r * 2 + " " + r * 2, style: p.style }, h("circle", { cx: r, cy: r, r: r, fill: p.fill || "#000" })); },
      Rect: function (p) { return h("svg", { width: p.width, height: p.height, viewBox: "0 0 " + p.width + " " + p.height, style: p.style }, h("rect", { width: p.width, height: p.height, rx: p.cornerRadius || 0, fill: p.fill || "#000" })); },
      Triangle: function (p) { var l = p.length || 100, hh = l * Math.sqrt(3) / 2; return h("svg", { width: l, height: hh, viewBox: "0 0 " + l + " " + hh, style: p.style }, h("polygon", { points: (l / 2) + ",0 " + l + "," + hh + " 0," + hh, fill: p.fill || "#000" })); },
      Star: function (p) { var R0 = p.outerRadius || 50, r0 = p.innerRadius || 25, n = p.points || 5, pts = []; for (var i = 0; i < n * 2; i++) { var rr = i % 2 ? r0 : R0, a = Math.PI * i / n - Math.PI / 2; pts.push((R0 + rr * Math.cos(a)) + "," + (R0 + rr * Math.sin(a))); } return h("svg", { width: R0 * 2, height: R0 * 2, viewBox: "0 0 " + R0 * 2 + " " + R0 * 2, style: p.style }, h("polygon", { points: pts.join(" "), fill: p.fill || "#000" })); },
      Ellipse: function (p) { return h("svg", { width: p.rx * 2, height: p.ry * 2, style: p.style }, h("ellipse", { cx: p.rx, cy: p.ry, rx: p.rx, ry: p.ry, fill: p.fill || "#000" })); },
    };
    function gfont(name) { return { loadFont: function () { var l = document.createElement("link"); l.rel = "stylesheet"; l.href = "https://fonts.googleapis.com/css2?family=" + name.replace(/ /g, "+") + ":wght@300;400;500;600;700;800;900&display=swap"; document.head.appendChild(l); return { fontFamily: name, fonts: {}, unicodeRanges: {}, waitUntilDone: function () { return Promise.resolve(); } }; }, fontFamily: name }; }
    var noop = function () { return null; };
    function anyMod(name) { void name; return new Proxy(function () { return null; }, { get: function (t, k) { if (k === "__esModule") return true; return noop; } }); }
    /* el navegador frena los iframes ocultos (no llegan los avisos de ResizeObserver): el tamaño se mide al momento */
    function MeasureNow(cb) { this.cb = cb; this.els = []; }
    MeasureNow.prototype.observe = function (el) { var self = this; this.els.push(el); window.__mvcClock.realTimeout(function () { try { self.cb([{ target: el, contentRect: el.getBoundingClientRect() }], self); } catch (e) { /* sin medida */ } }, 0); };
    MeasureNow.prototype.unobserve = function (el) { this.els = this.els.filter(function (x) { return x !== el; }); };
    MeasureNow.prototype.disconnect = function () { this.els = []; };
    /* dentro de la escena 3D: avisa qué cuadro ya confirmó React Three Fiber (sus cambios llegan en otra vuelta) */
    function FrameMark() { var f = useCurrentFrame(); R.useLayoutEffect(function () { window.__mvcR3F = f; }); return null; }
    /* @remotion/three: el lienzo 3D se dibuja solo cuando Musa pide el cuadro (frameloop «never» + advance) */
    function ThreeCanvas(p) {
      var F = MODS["@react-three/fiber"]; if (!F) { warnings.push("ThreeCanvas: no cargó React Three Fiber"); return null; }
      var w = p.width || conf.width, hh = p.height || conf.height, rest = Object.assign({}, p);
      delete rest.width; delete rest.height; delete rest.style;
      window.__mvcR3Used = true;
      return h("div", { style: Object.assign({ width: w, height: hh, position: "relative" }, p.style || {}) },
        h(F.Canvas, Object.assign({ dpr: 1 }, rest, { frameloop: "never", gl: Object.assign({ preserveDrawingBuffer: true, antialias: true }, p.gl || {}), style: { width: w, height: hh }, resize: { scroll: false, debounce: { scroll: 0, resize: 0 }, polyfill: MeasureNow } }), h(FrameMark), p.children));
    }
    function req(name) {
      if (name === "react") return R; if (name === "react-dom" || name === "react-dom/client") return RD; if (name === "react/jsx-runtime") return { jsx: function (t, p, k) { return h(t, Object.assign({ key: k }, p)); }, jsxs: function (t, p, k) { return h(t, Object.assign({ key: k }, p)); }, Fragment: R.Fragment };
      if (name === "remotion") return remotion;
      if (name === "@remotion/shapes") return shapes;
      if (name === "@remotion/three") return { ThreeCanvas: ThreeCanvas, useVideoTexture: function () { return null; }, useOffthreadVideoTexture: function () { return null; } };
      if (MODS[name]) return MODS[name];
      if (name === "@remotion/transitions") return { TransitionSeries: TransitionSeries, linearTiming: function (o) { return o || {}; }, springTiming: function (o) { return o || {}; } };
      if (/^@remotion\/transitions\//.test(name)) return new Proxy({}, { get: function () { return function () { return {}; }; } });
      var gf = /^@remotion\/google-fonts\/(.+)$/.exec(name); if (gf) return gfont(gf[1].replace(/([a-z])([A-Z])/g, "$1 $2"));
      if (name === "@remotion/noise") return { noise2D: function (s, x, y) { return Math.sin(x * 1.7 + y * 2.3 + random(s) * 10) * 0.5 + Math.sin(x * 3.1 - y * 1.3) * 0.5; }, noise3D: function (s, x, y, z) { return Math.sin(x * 1.7 + y * 2.3 + z * 1.1 + random(s) * 10); } };
      warnings.push("El paquete «" + name + "» no está en Musa: sus componentes se omitieron");
      return anyMod(name);
    }
    /* módulos ES (three, React Three Fiber, drei) por el import map: un <script type="module"> que los deja en window */
    function loadMods(list) {
      return new Promise(function (res, rej) {
        var id = "__mvm" + Math.random().toString(36).slice(2), s = document.createElement("script"), to = window.__mvcClock.realTimeout(function () { rej(new Error("no cargaron las librerías 3D (" + list.join(", ") + ")")); }, 30000);
        window[id] = function (mods) { clearTimeout(to); res(mods); };
        s.type = "module";
        s.textContent = list.map(function (n, i) { return "import * as m" + i + " from " + JSON.stringify(n) + ";"; }).join("\n") + "\nwindow." + id + "([" + list.map(function (n, i) { return "m" + i; }).join(",") + "]);";
        s.onerror = function () { rej(new Error("no cargaron las librerías 3D")); };
        document.head.appendChild(s);
      });
    }
    function setPathClone(o, path, v) { var ks = path.split("."), x = o; for (var i = 0; i < ks.length - 1; i++) { var nx = x[ks[i]]; if (nx == null || typeof nx !== "object") return; x[ks[i]] = Array.isArray(nx) ? nx.slice() : Object.assign({}, nx); x = x[ks[i]]; } x[ks[ks.length - 1]] = v; }
    window.__mvcBoot = function () {
      var code = window.__mvcSource;
      var need = cfg.r3 ? ["three", "@react-three/fiber"].concat(/@react-three\/drei/.test(code) ? ["@react-three/drei"] : []) : [];
      return (need.length ? loadMods(need).then(function (mods) { need.forEach(function (n, i) { MODS[n] = mods[i]; }); window.THREE = window.THREE || MODS.three; }) : Promise.resolve()).then(function () {
        var out;
        try { out = window.Babel.transform(code, { filename: "video.tsx", presets: [["env", { modules: "commonjs" }], ["react", { runtime: "classic" }], ["typescript", { isTSX: true, allExtensions: true }]] }).code; }
        catch (e) { throw new Error("El código no compila: " + (e.message || e)); }
        var mod = { exports: {} };
        (new Function("require", "module", "exports", "React", out))(req, mod, mod.exports, R);
        var ex = mod.exports, Comp = null, props = {};
        var box = document.getElementById("mvc-root");
        if (rootComp) { var tmp = document.createElement("div"); var rr = RD.createRoot(tmp); RD.flushSync(function () { rr.render(h(rootComp)); }); rr.unmount(); }
        var pick = comps.find(function (c) { return c.id === cfg.compId; }) || comps[0];
        if (pick) { Comp = pick.component || null; props = pick.defaultProps || {}; conf.width = pick.width || conf.width; conf.height = pick.height || conf.height; conf.fps = pick.fps || conf.fps; conf.durationInFrames = pick.durationInFrames || conf.durationInFrames; conf.id = pick.id || conf.id; }
        var cfgObj = ex.musaVideo || ex.config || ex.videoConfig;
        if (cfgObj && typeof cfgObj === "object") { ["width", "height", "fps", "durationInFrames"].forEach(function (k) { if (+cfgObj[k] > 0) conf[k] = +cfgObj[k]; }); }
        if (!Comp) {
          Comp = typeof ex.default === "function" ? ex.default : null;
          if (!Comp) Object.keys(ex).some(function (k) { if (typeof ex[k] === "function" && /^[A-Z]/.test(k)) { Comp = ex[k]; return true; } return false; });
        }
        if (!Comp) throw new Error("No encontré el componente del video (exporta uno, p. ej. export const Main = () => …)");
        conf.defaultProps = props;
        box.style.width = conf.width + "px"; box.style.height = conf.height + "px";
        box.setAttribute("data-width", conf.width); box.setAttribute("data-height", conf.height); box.setAttribute("data-fps", conf.fps); box.setAttribute("data-duration", (conf.durationInFrames / conf.fps).toFixed(3));
        window.__mvcRoot = box;
        var root = RD.createRoot(box);
        /* las props de la composición se pueden cambiar (y animar) desde Musa: r:<prop> */
        var propsAt = function () { var ov = window.__musaOvAll ? window.__musaOvAll("r:") : null; if (!ov) return props; var o = Object.assign({}, props); Object.keys(ov).forEach(function (k) { setPathClone(o, k, ov[k]); }); return o; };
        var render = function (f) { RD.flushSync(function () { root.render(h(ConfCtx.Provider, { value: conf }, h(FrameCtx.Provider, { value: f }, h(Comp, propsAt())))); }); };
        render(0);
        /* espera a que la escena 3D tenga el cuadro pedido (máx. ~1,5 s) y la dibuja */
        var settle = function (fr) { return new Promise(function (r) { var n = 0; (function tick() { if (++n > 3 && (!window.__mvcR3Used || window.__mvcR3F === fr || n > 300)) return r(); window.__mvcClock.realTimeout(tick, n < 20 ? 0 : 5); })(); }); };
        window.__mvcStep = function (t) {
          var fr = Math.round(t * conf.fps);
          var F = MODS["@react-three/fiber"];
          window.__mvcClock.advance(t);
          /* con la escena 3D: sus cambios se confirman en el acto (si no, React Three Fiber los deja para después) */
          if (F && F.flushSync) F.flushSync(function () { render(fr); }); else render(fr);
          if (!F) return;
          return settle(fr).then(function () { try { F.advance(t * 1000, true); } catch (e) { /* sin raíz 3D */ } });
        };
        return new Promise(function (r) { window.__mvcClock.realTimeout(r, cfg.r3 ? 900 : 400); }).then(function () { return window.__mvcStep(0); });
      });
    };
  }

  /* ═════════════ el documento del sandbox ═════════════ */
  function runtimeDoc(src, kind, cfg, RT) {
    var sh = "window.__name=window.__name||function(f){return f;};";
    var pre = "<script>" + sh + "(" + RT.pre + ")(" + JSON.stringify({ ov: cfg.ov || {} }) + ");<\/script>";
    var drv = "<script>" + sh + "(" + RT.live + ")(" + JSON.stringify({ token: cfg.token, fps: cfg.fps || 30, sel: cfg.sel != null ? cfg.sel : -1 }) + ");<\/script>";
    var css = "<style>.lil-gui,.dg.ac,#stats,.stats{display:none!important}</style>";
    if (kind === "remotion") {
      var im = cfg.r3 ? '<script type="importmap">' + JSON.stringify({ imports: RT.r3imports }) + "<\/script>" : "";
      return "<!doctype html><html><head><meta charset=\"utf-8\">" + pre + im + RT.libs.map(function (u) { return '<script src="' + u + '"><\/script>'; }).join("") + css
        + "<style>html,body{margin:0;background:transparent;overflow:hidden}#mvc-root{position:relative;overflow:hidden}</style></head><body><div id=\"mvc-root\"></div>"
        + "<script>" + sh + "window.__mvcSource = " + JSON.stringify(String(src)).replace(/<\/script/gi, "<\\/script") + ";(" + RT.rem + ")(" + JSON.stringify({ W: cfg.W, H: cfg.H, fps: cfg.fps || 30, dur: cfg.dur || 10, r3: !!cfg.r3 }) + ");<\/script>" + drv + "</body></html>";
    }
    var s = String(src);
    if (!/<html|<body|<head/i.test(s)) s = "<!doctype html><html><head><meta charset=\"utf-8\"></head><body style=\"margin:0\">" + s + "</body></html>";
    var m = /<head[^>]*>/i.exec(s);
    s = m ? s.slice(0, m.index + m[0].length) + pre + css + s.slice(m.index + m[0].length) : pre + css + s;
    var be = s.search(/<\/body\s*>/i);
    return be >= 0 ? s.slice(0, be) + drv + s.slice(be) : s + drv;
  }

  /* ═════════════ el cliente (en el editor y en el HTML exportado): un iframe por clip y cuadros por tiempo ═════════════ */
  function clientMain(RT, runtimeDoc) {
    return function createClient(o) {
      var tok, f, ready, rs, st = {}, pend = {}, seq = 0, last = -1, gone = false, tries = 0, bto = null;
      function boot(again) {
        tok = "mvl" + Math.random().toString(36).slice(2);
        Object.keys(pend).forEach(function (k) { var p = pend[k]; delete pend[k]; p({ none: 1, err: "se recargó" }); });
        if (f) try { f.remove(); } catch (e) { /* ya no está */ }
        f = document.createElement("iframe");
        f.setAttribute("sandbox", "allow-scripts"); f.setAttribute("aria-hidden", "true"); f.setAttribute("title", "código vivo"); f.tabIndex = -1;
        f.style.cssText = "position:fixed;left:-30000px;top:0;border:0;opacity:0;pointer-events:none;width:" + o.W + "px;height:" + o.H + "px";
        if (!again) {
          tries = 0;
          ready = new Promise(function (r, j) { rs = { r: r, j: j }; });
          ready.catch(function () { /* se avisa en frame() */ });
          ready.then(function () { clearTimeout(bto); }, function () { clearTimeout(bto); });
        }
        /* si no respondió en 45 s (las librerías de un CDN se quedaron colgadas, típico la primera vez o en Safari con
           React Three Fiber) se carga de nuevo una vez, con la misma promesa, y se le dan 90 s más; recién ahí es error.
           Antes quedaba en error hasta tocar «Recargar». Un error del código (mensaje «error») sigue siendo inmediato. */
        clearTimeout(bto);
        bto = setTimeout(function () {
          if (gone) return;
          if (tries < 1) { tries++; boot(true); } else rs.j(new Error("el código no respondió en 135 s"));
        }, again ? 90000 : 45000);
        var docTxt = runtimeDoc(o.src, o.kind, { token: tok, fps: o.fps, sel: o.sel, ov: o.ov, W: o.W, H: o.H, dur: o.dur, r3: o.r3 }, RT);
        if (o.frameUrl) {
          /* páginas con una política de seguridad estricta (srcdoc la heredaría): la página del motor escribe el documento */
          var ft = tok, fw = f;
          f.src = o.frameUrl;
          var onBoot = function (e) { if (!e.data || !e.data.__mvlFrame || e.source !== fw.contentWindow || ft !== tok) return; window.removeEventListener("message", onBoot); try { fw.contentWindow.postMessage({ __mvlBoot: ft, doc: docTxt }, "*"); } catch (er) { /* ya no está */ } };
          window.addEventListener("message", onBoot);
        } else f.srcdoc = docTxt;
        (o.host || document.body).appendChild(f);
        last = -1;
      }
      function on(e) {
        var d = e.data; if (!d || d.__mvl !== tok || !f || e.source !== f.contentWindow) return;
        if (d.type === "ready") {
          var dd = d.data || {};
          /* sin lienzo porque una librería del CDN no llegó (la página no terminó de cargar, o THREE/p5… no existe): otra vez */
          if (tries < 1 && !dd.n && (dd.loading || (dd.errors || []).some(function (x) { return /\b(THREE|p5|PIXI|lottie|gsap|anime)\b.*not defined|Can't find variable: (THREE|p5|PIXI|lottie|gsap|anime)\b/.test(String(x)); }))) { tries++; boot(true); return; }
          st = dd; rs.r(st);
        }
        else if (d.type === "error") {
          var em = String(d.data);
          /* falla de red (las librerías 3D no llegaron del CDN): se reintenta una vez, como cuando no responde */
          if (tries < 1 && /no cargaron las librer|Failed to fetch|dynamically imported module|Importing a module script failed|Load failed|NetworkError/i.test(em)) { tries++; boot(true); return; }
          st.error = em; rs.j(new Error(em));
        }
        else if (d.type === "frame" || d.type === "reset") { var p = pend[d.data && d.data.id]; if (p) { delete pend[d.data.id]; p(d.type === "reset" ? { reset: 1 } : d.data); } }
        else if (d.type === "scene" && o.onScene) o.onScene(d.data);
        else if (d.type === "boxes" && o.onBoxes) o.onBoxes(d.data);
      }
      window.addEventListener("message", on);
      boot();
      function ask(tc, x) {
        var id = ++seq;
        return new Promise(function (r) {
          /* un cuadro nunca queda colgado: si el código no responde en 30 s, sale vacío y se sigue */
          var to = setTimeout(function () { if (pend[id]) { delete pend[id]; r({ none: 1, err: "el código tardó más de 30 s en dibujar este cuadro" }); } }, 30000);
          pend[id] = function (v) { clearTimeout(to); r(v); };
          try { f.contentWindow.postMessage({ __mvl: tok, type: "seek", id: id, t: tc, lt: x && x.lt != null ? x.lt : tc, scene: !!(x && x.scene), boxes: !!(x && x.boxes) }, "*"); } catch (e) { delete pend[id]; clearTimeout(to); r({ none: 1, err: String(e && e.message || e) }); }
        });
      }
      function frame(tc, x) {
        if (gone) return Promise.resolve({ none: 1 });
        var go = function () {
          return ask(tc, x).then(function (r) {
            if (r && r.reset) { boot(); return ready.then(function () { return ask(tc, x); }); }
            if (r && !r.none) last = tc;
            return r;
          });
        };
        return ready.then(function () {
          if (!st.seekable && last >= 0 && tc < last - 1e-6) { boot(); return ready.then(go); }
          return go();
        });
      }
      return {
        frame: frame,
        setOv: function (ov) { o.ov = ov; ready.then(function () { if (f && f.contentWindow) f.contentWindow.postMessage({ __mvl: tok, type: "ov", ov: ov }, "*"); }, function () {}); },
        scene: function () { ready.then(function () { if (f && f.contentWindow) f.contentWindow.postMessage({ __mvl: tok, type: "scene" }, "*"); }, function () {}); },
        resize: function (W, H) { o.W = W; o.H = H; if (f) { f.style.width = W + "px"; f.style.height = H + "px"; } last = -1; },
        reload: function (no) { if (no) Object.keys(no).forEach(function (k) { o[k] = no[k]; }); boot(); },
        destroy: function () { gone = true; window.removeEventListener("message", on); Object.keys(pend).forEach(function (k) { var p = pend[k]; delete pend[k]; p({ none: 1, err: "se cerró" }); }); if (f) try { f.remove(); } catch (e) { /* idem */ } },
        get state() { return st; }, get ready() { return ready; },
      };
    };
  }

  /* ═════════════ el reproductor de los clips de código vivo dentro del HTML que exporta Musa ═════════════
     Cada <canvas class="musa-live"> lleva su código al lado (<script type="text/musa-live">). Funciona en el navegador
     (el reproductor de Musa llama a __musaLiveSeek) y en HyperFrames (hf-seek con waitUntil). */
  function driverMain(RT, runtimeDoc, createClient, T) {
    var root = document.getElementById("root") || document.body, W = +root.getAttribute("data-width") || 1080, H = +root.getAttribute("data-height") || 1920;
    var L = [].slice.call(document.querySelectorAll("canvas.musa-live")).map(function (cv) {
      var clip = cv.closest("[data-start]"), sc = cv.parentNode.querySelector('script[type="text/musa-live"]');
      var d = cv.dataset, live = {}, host = cv.closest("[data-musa]");
      try { live = JSON.parse(d.live || "null") || (host ? JSON.parse(host.getAttribute("data-musa") || "{}").live : null) || {}; } catch (e) { live = {}; }
      live.src = sc ? T.unescScript(sc.textContent) : ""; live.kind = d.kind || live.kind || "html";
      var box = cv.getBoundingClientRect(), wW = +live.W || Math.round(box.width) || W, wH = +live.H || Math.round(box.height) || H;
      var x = { cv: cv, clip: clip, live: live, busy: false, want: null };
      x.cli = createClient({ src: T.runSrc(live), kind: live.kind, sel: live.sel != null ? live.sel : -1, ov: Object.assign({}, live.ov || {}, T.ovOf(live.src)), W: wW, H: wH, fps: +root.getAttribute("data-fps") || 30, dur: +(clip && clip.getAttribute("data-duration")) || 10, r3: T.usesR3(live) });
      return x;
    });
    function tcOf(x, lt) { var lv = x.live, sp = lv.speed != null ? +lv.speed : 1, y = Math.max(0, lt) * sp; if (+lv.loop > 0) y = y % +lv.loop; return Math.max(0, (+lv.off || 0) + y); }
    function paint(x, r) { if (!r || !r.bmp) return; var cv = x.cv; if (cv.width !== r.w || cv.height !== r.h) { cv.width = r.w; cv.height = r.h; } var g = cv.getContext("2d"); g.clearRect(0, 0, r.w, r.h); g.drawImage(r.bmp, 0, 0); try { r.bmp.close(); } catch (e) { /* ya cerrado */ } }
    function one(x, t, strict) {
      var s = x.clip ? +x.clip.getAttribute("data-start") || 0 : 0, du = x.clip ? +x.clip.getAttribute("data-duration") || 1e9 : 1e9;
      if (t < s || t >= s + du) return null;
      var lt = t - s;
      if (!strict) { if (x.busy) { x.want = lt; return null; } }
      x.busy = true;
      return x.cli.frame(tcOf(x, lt), { lt: lt }).then(function (r) { paint(x, r); }, function () {}).then(function () { x.busy = false; if (x.want != null) { var w = x.want; x.want = null; one(x, s + w, false); } });
    }
    window.__musaLiveSeek = function (t, strict) { return Promise.all(L.map(function (x) { return one(x, t, strict); })); };
    window.addEventListener("hf-seek", function (e) { var p = window.__musaLiveSeek(e.detail.time, true); if (e.detail && e.detail.waitUntil) e.detail.waitUntil(p); });
  }
  function driverScript() {
    return "/* Musa · código vivo (Three.js, p5, WebGL, canvas, Remotion 3D): cada clip corre su código en un iframe aislado */\n"
      + "(function () {\n  var __name = function (f) { return f; };\n"
      + "  var T = (" + toolsMain.toString() + ")();\n"
      + "  var RT = " + JSON.stringify(rtParts()) + ";\n"
      + "  var runtimeDoc = " + runtimeDoc.toString() + ";\n"
      + "  var createClient = (" + clientMain.toString() + ")(RT, runtimeDoc);\n"
      + "  (" + driverMain.toString() + ")(RT, runtimeDoc, createClient, T);\n"
      + "})();";
  }

  /* el componente <MusaLive> del Remotion que exporta Musa (delayRender hasta que el cuadro está dibujado) */
  function remotionComponent() {
    return [
      "/* Musa · código vivo: el clip 3D / canvas corre su código en un iframe aislado, cuadro a cuadro */",
      "const MUSA_LIVE: any = (function () {",
      "  var __name = function (f) { return f; };",
      "  var T = (" + toolsMain.toString() + ")();",
      "  var RT = " + JSON.stringify(rtParts()) + ";",
      "  var runtimeDoc = " + runtimeDoc.toString() + ";",
      "  return { T: T, create: (" + clientMain.toString() + ")(RT, runtimeDoc) };",
      "})();",
      "const MusaLive: React.FC<{ live: any; code: string }> = ({ live, code }) => {",
      "  const f = useCurrentFrame();",
      "  const { fps } = useVideoConfig();",
      "  const ref = React.useRef<HTMLCanvasElement>(null);",
      "  const L = { ...live, src: code };",
      "  const cli = React.useMemo(() => (typeof window === \"undefined\" || (window as any).__musaNoLive ? null : MUSA_LIVE.create({ src: MUSA_LIVE.T.runSrc(L), kind: L.kind || \"html\", sel: L.sel ?? -1, ov: { ...(L.ov || {}), ...MUSA_LIVE.T.ovOf(L.src) }, W: L.W || 1080, H: L.H || 1080, fps, dur: 10, r3: MUSA_LIVE.T.usesR3(L) })), [code]);",
      "  React.useEffect(() => () => { if (cli) cli.destroy(); }, [cli]);",
      "  React.useLayoutEffect(() => {",
      "    if (!cli) return;",
      "    const handle = delayRender(\"Musa · código vivo\");",
      "    const lt = f / fps; let y = lt * (L.speed ?? 1); if (L.loop > 0) y = y % L.loop;",
      "    cli.frame((L.off || 0) + y, { lt }).then((r: any) => { const cv = ref.current; if (cv && r && r.bmp) { cv.width = r.w; cv.height = r.h; cv.getContext(\"2d\")!.drawImage(r.bmp, 0, 0); r.bmp.close(); } continueRender(handle); }, () => continueRender(handle));",
      "  }, [f, cli]);",
      "  return <canvas ref={ref} className=\"musa-live\" data-musa-live={JSON.stringify(L)} style={{ position: \"absolute\", inset: 0, width: \"100%\", height: \"100%\", objectFit: \"cover\", display: \"block\" }} />;",
      "};",
    ].join("\n");
  }

  /* ═════════════ juntar cambios hechos a la vez (editor abierto + tu IA por MCP u otra pestaña) ═════════════
     Tres versiones del estado del editor: la base (lo último que este editor guardó o leyó), la mía (el editor ahora)
     y la de ellos (lo que hay en el servidor). Cada lado conserva lo que cambió; si los dos cambiaron lo mismo, gana
     el editor (la persona) y se avisa. El código de un clip vivo se junta línea por línea y su bloque ▸ musa, clave
     por clave: tú cambias el color en el inspector y la IA mueve el cubo → el código queda con los dos cambios. */
  function mergeMain(T) {
    function stable(v) {
      if (v === undefined) return "~";
      if (v === null || typeof v !== "object") return JSON.stringify(v);
      if (Array.isArray(v)) return "[" + v.map(function (x) { return x === undefined ? "null" : stable(x); }).join(",") + "]";
      return "{" + Object.keys(v).filter(function (k) { return v[k] !== undefined; }).sort().map(function (k) { return JSON.stringify(k) + ":" + stable(v[k]); }).join(",") + "}";
    }
    function same(a, b) { return a === b || stable(a) === stable(b); }
    /* pares [i, j] de líneas iguales (subsecuencia común más larga), recortando antes el principio y el final comunes */
    function lcsPairs(a, b) {
      var n = a.length, m = b.length, pre = 0, suf = 0, i, out = [];
      while (pre < n && pre < m && a[pre] === b[pre]) pre++;
      while (suf < n - pre && suf < m - pre && a[n - 1 - suf] === b[m - 1 - suf]) suf++;
      for (i = 0; i < pre; i++) out.push([i, i]);
      midPairs(a, b, pre, n - suf, pre, m - suf, out, 0);
      for (i = 0; i < suf; i++) out.push([n - suf + i, m - suf + i]);
      return out;
    }
    /* tramo [a0,a1) × [b0,b1): tabla completa si es chico; si es grande, primero se anclan las líneas que aparecen una
       sola vez en cada lado (en orden creciente) y se sigue tramo por tramo entre anclas */
    function midPairs(a, b, a0, a1, b0, b1, out, depth) {
      var N = a1 - a0, M = b1 - b0, x, y;
      if (N <= 0 || M <= 0) return;
      if (N * M <= 4e6) {
        var W = M + 1, L = new Uint16Array((N + 1) * W);
        for (x = N - 1; x >= 0; x--) for (y = M - 1; y >= 0; y--) L[x * W + y] = a[a0 + x] === b[b0 + y] ? L[(x + 1) * W + y + 1] + 1 : Math.max(L[(x + 1) * W + y], L[x * W + y + 1]);
        x = 0; y = 0;
        while (x < N && y < M) {
          if (a[a0 + x] === b[b0 + y]) { out.push([a0 + x, b0 + y]); x++; y++; }
          else if (L[(x + 1) * W + y] >= L[x * W + y + 1]) x++; else y++;
        }
        return;
      }
      if (depth > 6) return;
      var ca = {}, cb = {}, k;
      for (x = a0; x < a1; x++) { k = "$" + a[x]; ca[k] = ca[k] ? -1 : x + 1; }
      for (y = b0; y < b1; y++) { k = "$" + b[y]; cb[k] = cb[k] ? -1 : y + 1; }
      var cand = [];
      for (x = a0; x < a1; x++) { k = "$" + a[x]; if (ca[k] > 0 && cb[k] > 0) cand.push([x, cb[k] - 1]); }
      if (!cand.length) return;
      /* la secuencia creciente más larga en b (paciencia) */
      var tails = [], prev = new Array(cand.length);
      cand.forEach(function (c, i) {
        var lo = 0, hi = tails.length;
        while (lo < hi) { var md = (lo + hi) >> 1; if (cand[tails[md]][1] < c[1]) lo = md + 1; else hi = md; }
        prev[i] = lo > 0 ? tails[lo - 1] : -1; tails[lo] = i;
      });
      var chain = [], t = tails.length ? tails[tails.length - 1] : -1;
      while (t >= 0) { chain.push(cand[t]); t = prev[t]; }
      chain.reverse();
      var pa = a0, pb = b0;
      chain.forEach(function (c) { midPairs(a, b, pa, c[0], pb, c[1], out, depth + 1); out.push(c); pa = c[0] + 1; pb = c[1] + 1; });
      midPairs(a, b, pa, a1, pb, b1, out, depth + 1);
    }
    /* texto a tres bandas (diff3 por líneas). Un tramo que cambiaron los dos se resuelve línea a línea si tiene el mismo
       largo (cambios de literales en líneas vecinas); si no, gana el mío y cuenta como conflicto */
    function merge3(base, mine, theirs) {
      base = String(base == null ? "" : base); mine = String(mine == null ? "" : mine); theirs = String(theirs == null ? "" : theirs);
      if (mine === theirs || theirs === base) return { text: mine, conflicts: 0 };
      if (mine === base) return { text: theirs, conflicts: 0 };
      var O = base.split("\n"), A = mine.split("\n"), B = theirs.split("\n"), pa = lcsPairs(O, A), pb = lcsPairs(O, B);
      if (!pa || !pb) return { text: mine, conflicts: 1 };
      var ma = {}, mb = {}, out = [], conflicts = 0, o = 0, a = 0, b = 0, k;
      pa.forEach(function (q) { ma[q[0]] = q[1]; }); pb.forEach(function (q) { mb[q[0]] = q[1]; });
      var eqL = function (x, y) { if (x.length !== y.length) return false; for (var z = 0; z < x.length; z++) if (x[z] !== y[z]) return false; return true; };
      var chunk = function (oc, ac, bc) {
        if (eqL(ac, oc)) { out.push.apply(out, bc); return; }
        if (eqL(bc, oc) || eqL(ac, bc)) { out.push.apply(out, ac); return; }
        if (ac.length === oc.length && bc.length === oc.length) {
          for (var z = 0; z < oc.length; z++) { if (ac[z] === oc[z]) out.push(bc[z]); else { if (bc[z] !== oc[z] && bc[z] !== ac[z]) conflicts++; out.push(ac[z]); } }
          return;
        }
        conflicts++; out.push.apply(out, ac);
      };
      for (k = 0; k < O.length; k++) {
        if (ma[k] == null || mb[k] == null || ma[k] < a || mb[k] < b) continue;
        chunk(O.slice(o, k), A.slice(a, ma[k]), B.slice(b, mb[k]));
        out.push(O[k]); o = k + 1; a = ma[k] + 1; b = mb[k] + 1;
      }
      chunk(O.slice(o), A.slice(a), B.slice(b));
      return { text: out.join("\n"), conflicts: conflicts };
    }
    function pick(b, m, t) {
      if (same(m, b)) return { v: t, c: 0 };
      if (same(t, b) || same(m, t)) return { v: m, c: 0 };
      return { v: m, c: 1 };
    }
    /* código de un clip vivo: el código sin el bloque por líneas, y el bloque ▸ musa clave por clave */
    function mergeSrc(b, m, t) {
      b = String(b == null ? "" : b); m = String(m == null ? "" : m); t = String(t == null ? "" : t);
      if (m === t || t === b) return { src: m, conflicts: 0 };
      if (m === b) return { src: t, conflicts: 0 };
      var kb = T.blockOf(b), km = T.blockOf(m), kt = T.blockOf(t);
      if (kb.err || km.err || kt.err) { var w = merge3(b, m, t); return { src: w.text, conflicts: w.conflicts }; }
      var r = merge3(T.canon(b), T.canon(m), T.canon(t)), ov = {}, conf = r.conflicts, keys = {};
      [kb.ov, km.ov, kt.ov].forEach(function (o) { Object.keys(o || {}).forEach(function (q) { keys[q] = 1; }); });
      Object.keys(keys).forEach(function (q) { var x = pick(kb.ov[q], km.ov[q], kt.ov[q]); conf += x.c; if (x.v !== undefined) ov[q] = x.v; });
      return { src: T.writeBlock(r.text, ov), conflicts: conf };
    }
    function mergeLive(b, m, t) {
      b = b || {}; m = m || {}; t = t || {};
      var out = {}, conf = [], keys = {};
      [b, m, t].forEach(function (o) { Object.keys(o).forEach(function (q) { keys[q] = 1; }); });
      Object.keys(keys).forEach(function (q) {
        if (q === "ov") return;
        if (q === "src") { var s = mergeSrc(b.src, m.src, t.src); out.src = s.src; if (s.conflicts) conf.push("código"); return; }
        var x = pick(b[q], m[q], t[q]); if (x.c) conf.push(q); if (x.v !== undefined) out[q] = x.v;
      });
      out.ov = T.ovOf(out.src || "");
      return { live: out, conflicts: conf };
    }
    /* un clip que cambiaron los dos: campo por campo (el código vivo, por dentro) */
    function mergeClip(b, m, t) {
      var out = {}, conf = [], keys = {};
      [b, m, t].forEach(function (o) { Object.keys(o || {}).forEach(function (q) { keys[q] = 1; }); });
      Object.keys(keys).forEach(function (q) {
        if (q === "live" && m.live && t.live && !same(m.live, t.live)) {
          if (same(m.live, b.live)) { out.live = t.live; return; }
          if (same(t.live, b.live)) { out.live = m.live; return; }
          var L = mergeLive(b.live, m.live, t.live); out.live = L.live; conf = conf.concat(L.conflicts); return;
        }
        var x = pick(b[q], m[q], t[q]); if (x.c) conf.push(q); if (x.v !== undefined) out[q] = x.v;
      });
      return { clip: out, conflicts: conf };
    }
    function ids(list) { return (list || []).map(function (c) { return c && c.id; }).filter(Boolean); }
    /* el orden manda el que lo cambió (capas delante/detrás); los clips nuevos de cada lado quedan junto a su vecino */
    function order(bo, mo, to, keep) {
      var rel = function (x, y) { var s = {}; y.forEach(function (q) { s[q] = 1; }); return x.filter(function (q) { return s[q]; }); };
      var mineMoved = rel(mo, bo).join("\n") !== rel(bo, mo).join("\n");
      var first = mineMoved ? mo : to, second = mineMoved ? to : mo, res = first.filter(function (q) { return keep[q]; });
      /* un clip nuevo va justo antes del siguiente que ya está; si no hay ninguno después, al final */
      second.forEach(function (q, i) {
        if (!keep[q] || res.indexOf(q) >= 0) return;
        var at = res.length; for (var j = i + 1; j < second.length; j++) { var w = res.indexOf(second[j]); if (w >= 0) { at = w; break; } }
        res.splice(at, 0, q);
      });
      return res;
    }
    var TRACKS = ["v1", "m", "t", "a"], SKIP = { v1: 1, m: 1, t: 1, a: 1, rev: 1, pending: 1, code: 1, codePending: 1 };
    var strip = function (c) { if (!c) return c; var o = {}; Object.keys(c).forEach(function (q) { if (q !== "_s") o[q] = c[q]; }); return o; };
    /* estados completos del editor { fmt, pad, …, v1, m, t, a } → { state, conflicts:[{ id, name, fields }], theirs, mine } */
    function mergeStates(base, mine, theirs) {
      base = base || {}; mine = mine || {}; theirs = theirs || {};
      var res = {}, conflicts = [], tCh = false, mCh = false, keys = {};
      [base, mine, theirs].forEach(function (o) { Object.keys(o).forEach(function (q) { if (!SKIP[q]) keys[q] = 1; }); });
      Object.keys(keys).forEach(function (q) {
        if (!same(theirs[q], base[q])) tCh = true; if (!same(mine[q], base[q])) mCh = true;
        var x = pick(base[q], mine[q], theirs[q]); if (x.c) conflicts.push({ id: null, name: "proyecto", fields: [q] }); if (x.v !== undefined) res[q] = x.v;
      });
      TRACKS.forEach(function (k) {
        var B = {}, M = {}, H = {}, keep = {}, made = {};
        (base[k] || []).forEach(function (c) { if (c && c.id) B[c.id] = strip(c); });
        (mine[k] || []).forEach(function (c) { if (c && c.id) M[c.id] = strip(c); });
        (theirs[k] || []).forEach(function (c) { if (c && c.id) H[c.id] = strip(c); });
        var all = {}; [B, M, H].forEach(function (o) { Object.keys(o).forEach(function (q) { all[q] = 1; }); });
        Object.keys(all).forEach(function (id) {
          var b = B[id], m = M[id], t = H[id], r;
          if (!same(t, b)) tCh = true; if (!same(m, b)) mCh = true;
          if (same(m, b)) r = t;
          else if (same(t, b) || same(m, t)) r = m;
          else if (!m) { r = t; conflicts.push({ id: id, name: (t && (t.name || t.text)) || id, fields: ["borrado"] }); }
          else if (!t) { r = m; conflicts.push({ id: id, name: m.name || m.text || id, fields: ["borrado"] }); }
          else if (!b) r = m;
          else { var x = mergeClip(b, m, t); r = x.clip; if (x.conflicts.length) conflicts.push({ id: id, name: m.name || m.text || id, fields: x.conflicts }); }
          if (r) { keep[id] = 1; made[id] = r; }
        });
        res[k] = order(ids(base[k]), ids(mine[k]), ids(theirs[k]), keep).map(function (id) { return made[id]; });
      });
      return { state: res, conflicts: conflicts, theirs: tCh, mine: mCh };
    }
    return { stable: stable, merge3: merge3, mergeSrc: mergeSrc, mergeLive: mergeLive, mergeStates: mergeStates };
  }

  var TOOLS = toolsMain();
  function rtParts() { return { pre: preludeLive.toString(), live: liveMain.toString(), rem: remotionMain.toString(), libs: TOOLS.LIBS_REMOTION, r3imports: TOOLS.R3_IMPORTS }; }
  var RT0 = null;
  function RT() { return RT0 || (RT0 = rtParts()); }
  var createClient = null;
  function client(o) { if (!createClient) createClient = clientMain(RT(), runtimeDoc); return createClient(o); }

  return Object.assign({}, TOOLS, mergeMain(TOOLS), {
    VERSION: 1, toolsMain: toolsMain, preludeLive: preludeLive, liveMain: liveMain, remotionMain: remotionMain, runtimeDoc: runtimeDoc,
    rtParts: RT, client: client, driverScript: driverScript, remotionComponent: remotionComponent,
  });
});
