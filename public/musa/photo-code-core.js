/* photo-code-core.js — «Musa Photo Code»: el modelo único de una foto en Musa.
 *
 * Una foto es un documento (lo mismo para la interfaz, para el código y para una IA por MCP):
 *
 *   fuente ──► retoque ──► geometría ──► revelado ──► filtros ──► capas ──► salida
 *   (url o     (capa de    (recorte,     (receta tipo  (pila tipo   (texto, imagen,
 *    código)    píxeles     giro,         Lightroom +   Photoshop)   forma, pintura)
 *               «pre»)      volteo)       máscaras)
 *
 *   · fuente: una imagen por URL, o CÓDIGO que la genera (canvas, Three.js, p5, shader, SVG, HTML/CSS, Python):
 *     el código queda guardado y se vuelve a dibujar cuando cambia.
 *   · todo lo demás es no destructivo y editable: cada valor de aquí tiene su control en el editor de fotos
 *     y su línea en el código (photo-code-lang.js). El original nunca se toca.
 *
 * Este archivo es puro (sin DOM): el motor trabaja sobre arreglos de píxeles, así el navegador y el servidor MCP
 * comparten el mismo modelo, las mismas reglas de validación y la misma mezcla a tres bandas.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  root.MusaPhotoCode = Object.assign(root.MusaPhotoCode || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  var VERSION = 2;

  /* ═════════════ utilidades ═════════════ */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function num(v, d) { v = +v; return isFinite(v) ? v : d; }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function isObj(o) { return !!o && typeof o === "object" && !Array.isArray(o); }
  function uid(p) { return p + Math.random().toString(36).slice(2, 6) + (Date.now() % 46656).toString(36); }
  function hex(h) {
    var s = String(h || "").trim(), m;
    if ((m = /^#?([0-9a-f]{3})$/i.exec(s))) s = m[1].replace(/./g, "$&$&");
    else if ((m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s))) s = m[1];
    else if ((m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s))) return [clamp(+m[1], 0, 255), clamp(+m[2], 0, 255), clamp(+m[3], 0, 255)];
    else { var N = NAMED[s.toLowerCase()]; if (!N) return [0, 0, 0]; s = N; }
    var n = parseInt(s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function toHex(c) { return "#" + [c[0], c[1], c[2]].map(function (v) { return clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0"); }).join(""); }
  var NAMED = { black: "000000", white: "ffffff", red: "ff0000", green: "008000", blue: "0000ff", yellow: "ffff00", orange: "ffa500", purple: "800080", pink: "ffc0cb", gray: "808080", grey: "808080", cyan: "00ffff", magenta: "ff00ff", brown: "a52a2a", navy: "000080", teal: "008080", gold: "ffd700", sepia: "704214" };
  function rand(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  /* JSON estable (llaves ordenadas): firma para «¿cambió?» y para comparar al mezclar */
  function stable(o) {
    if (Array.isArray(o)) return "[" + o.map(stable).join(",") + "]";
    if (isObj(o)) return "{" + Object.keys(o).sort().filter(function (k) { return o[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ":" + stable(o[k]); }).join(",") + "}";
    return JSON.stringify(o === undefined ? null : o);
  }
  function same(a, b) { return stable(a) === stable(b); }

  /* ═════════════ receta del revelado (lo que mueve el panel Luz / Color / Detalle / Efectos / Máscaras) ═════════════ */
  var BANDS = [["red", "Rojo", 0], ["orange", "Naranja", 30], ["yellow", "Amarillo", 60], ["green", "Verde", 120], ["aqua", "Aqua", 180], ["blue", "Azul", 230], ["purple", "Púrpura", 275], ["magenta", "Magenta", 320]];
  var MAX_MASKS = 12, MAX_FILTERS = 40, MAX_LAYERS = 40;
  var MASK_KINDS = ["radial", "linear", "brush", "lum", "color"];
  var ADJ0 = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 0, temp: 0, tint: 0, clarity: 0 };
  function recipe0() {
    var hsl = {}; BANDS.forEach(function (b) { hsl[b[0]] = { h: 0, s: 0, l: 0 }; });
    return {
      basic: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 }, wb: { temp: 0, tint: 0 }, color: { vibrance: 0, saturation: 0 },
      hsl: hsl, curve: { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] },
      grade: { shadows: { hue: 215, sat: 0 }, midtones: { hue: 35, sat: 0 }, highlights: { hue: 45, sat: 0 }, balance: 0 },
      detail: { texture: 0, clarity: 0, sharpen: 0, denoise: 0, dehaze: 0 }, fx: { grain: 0, vignette: 0, mid: 50, feather: 50 }, bw: { on: false, r: 100, g: 100, b: 100 },
      geo: { crop: { x: 0, y: 0, w: 1, h: 1 }, rot: 0, flipH: false, flipV: false, straighten: 0 }, masks: [],
    };
  }
  /* rangos: [mín, máx] de cada valor numérico de la receta (lo usan el normalizador, el inspector y el código) */
  var RANGE = {
    "basic.*": [-100, 100], "wb.*": [-100, 100], "color.*": [-100, 100], "hsl.*.h": [-30, 30], "hsl.*.s": [-100, 100], "hsl.*.l": [-100, 100],
    "grade.*.hue": [0, 360], "grade.*.sat": [0, 100], "grade.balance": [-100, 100],
    "detail.texture": [-100, 100], "detail.clarity": [-100, 100], "detail.sharpen": [0, 100], "detail.denoise": [0, 100], "detail.dehaze": [-100, 100],
    "fx.grain": [0, 100], "fx.vignette": [-100, 100], "fx.mid": [0, 100], "fx.feather": [0, 100], "bw.r": [0, 200], "bw.g": [0, 200], "bw.b": [0, 200],
    "geo.straighten": [-45, 45],
  };
  function rangeOf(path) {
    if (RANGE[path]) return RANGE[path];
    var p = path.split(".");
    var w = [p[0] + ".*", p[0] + ".*." + p[2]];
    for (var i = 0; i < w.length; i++) if (RANGE[w[i]]) return RANGE[w[i]];
    return null;
  }
  function curvePts(v) {
    if (!Array.isArray(v)) return [[0, 0], [255, 255]];
    var pts = v.map(function (p) { return Array.isArray(p) ? [num(p[0], NaN), num(p[1], NaN)] : isObj(p) ? [num(p.x, NaN), num(p.y, NaN)] : [NaN, NaN]; })
      .filter(function (p) { return isFinite(p[0]) && isFinite(p[1]); }).map(function (p) { return [Math.round(clamp(p[0], 0, 255)), Math.round(clamp(p[1], 0, 255))]; });
    pts.sort(function (a, b) { return a[0] - b[0]; });
    var out = []; pts.forEach(function (p) { if (!out.length || out[out.length - 1][0] !== p[0]) out.push(p); });
    if (out.length < 2) return [[0, 0], [255, 255]];
    return out.slice(0, 16);
  }
  function normMask(m, i) {
    if (!isObj(m)) return null;
    var kind = MASK_KINDS.indexOf(m.kind) >= 0 ? m.kind : null; if (!kind) return null;
    var adj = {}; Object.keys(ADJ0).forEach(function (k) { adj[k] = clamp(Math.round(num((m.adj || m.adjustments || {})[k], 0)), -100, 100); });
    var o = { id: String(m.id || uid("m")), kind: kind, on: m.on !== false && m.enabled !== false, invert: !!m.invert, feather: clamp(num(m.feather, 0.5), 0, 1), adj: adj };
    if (m.name) o.name = String(m.name).slice(0, 40);
    if (kind === "radial") { o.cx = clamp(num(m.cx, 0.5), -1, 2); o.cy = clamp(num(m.cy, 0.45), -1, 2); o.rx = clamp(num(m.rx != null ? m.rx : m.r, 0.28), 0.01, 3); o.ry = clamp(num(m.ry != null ? m.ry : m.r, 0.32), 0.01, 3); }
    if (kind === "linear") { o.x1 = clamp(num(m.x1, 0.5), -1, 2); o.y1 = clamp(num(m.y1, 0), -1, 2); o.x2 = clamp(num(m.x2, 0.5), -1, 2); o.y2 = clamp(num(m.y2, 0.45), -1, 2); }
    if (kind === "brush" && m.src) o.src = String(m.src);
    if (kind === "lum") { o.lo = clamp(num(m.lo, 0.6), 0, 1); o.hi = clamp(num(m.hi, 1), 0, 1); if (o.hi < o.lo) { var t = o.lo; o.lo = o.hi; o.hi = t; } }
    if (kind === "color") { o.hue = ((num(m.hue, 210) % 360) + 360) % 360; o.range = clamp(num(m.range, 40), 5, 180); }
    return o;
  }
  function normRecipe(r) {
    var d = recipe0(); r = isObj(r) ? r : {};
    ["basic", "wb", "color", "detail", "fx"].forEach(function (g) {
      if (!isObj(r[g])) return;
      Object.keys(d[g]).forEach(function (k) { if (r[g][k] == null) return; var rg = rangeOf(g + "." + k) || [-100, 100]; d[g][k] = clamp(Math.round(num(r[g][k], 0) * 100) / 100, rg[0], rg[1]); });
    });
    if (isObj(r.hsl)) BANDS.forEach(function (b) { var s = r.hsl[b[0]]; if (!isObj(s)) return; d.hsl[b[0]] = { h: clamp(Math.round(num(s.h, 0)), -30, 30), s: clamp(Math.round(num(s.s, 0)), -100, 100), l: clamp(Math.round(num(s.l, 0)), -100, 100) }; });
    if (isObj(r.curve)) ["rgb", "r", "g", "b"].forEach(function (c) { if (r.curve[c] != null) d.curve[c] = curvePts(r.curve[c]); });
    if (isObj(r.grade)) {
      ["shadows", "midtones", "highlights"].forEach(function (k) { var s = r.grade[k]; if (!isObj(s)) return; d.grade[k] = { hue: clamp(Math.round(num(s.hue, d.grade[k].hue)), 0, 360), sat: clamp(Math.round(num(s.sat, 0)), 0, 100) }; });
      if (r.grade.balance != null) d.grade.balance = clamp(Math.round(num(r.grade.balance, 0)), -100, 100);
    }
    if (isObj(r.bw)) { d.bw.on = !!(r.bw.on || r.bw.enabled); ["r", "g", "b"].forEach(function (k) { var v = r.bw[k] != null ? r.bw[k] : isObj(r.bw.mix) ? r.bw.mix[k] : null; if (v != null) d.bw[k] = clamp(Math.round(num(v, 100)), 0, 200); }); }
    if (isObj(r.geo)) {
      var c = r.geo.crop;
      if (isObj(c)) { var x = clamp(num(c.x, 0), 0, 0.99), y = clamp(num(c.y, 0), 0, 0.99); d.geo.crop = { x: x, y: y, w: clamp(num(c.w, 1), 0.01, 1 - x), h: clamp(num(c.h, 1), 0.01, 1 - y) }; }
      d.geo.rot = ((Math.round(num(r.geo.rot != null ? r.geo.rot : r.geo.rotate90, 0)) % 4) + 4) % 4;
      d.geo.flipH = !!r.geo.flipH; d.geo.flipV = !!r.geo.flipV;
      d.geo.straighten = clamp(Math.round(num(r.geo.straighten, 0) * 10) / 10, -45, 45);
    }
    if (Array.isArray(r.masks)) { var seen = {}; d.masks = r.masks.map(normMask).filter(function (m) { if (!m || seen[m.id]) return false; seen[m.id] = 1; return true; }).slice(0, MAX_MASKS); }
    return d;
  }
  function recipeEdited(r) { var a = normRecipe(r), b = recipe0(); return !same(a, b); }

  /* ═════════════ filtros (la pila tipo Photoshop; los primeros nueve son exactamente los de CSS `filter`) ═════════════
     Cada parámetro: [llave, etiqueta, mín, máx, por defecto, paso, unidad]. `px` = se mide en píxeles de la foto final. */
  var FILTERS = {
    brightness: { label: "Brillo", css: 1, params: [["amount", "Cantidad", 0, 300, 100, 1, "%"]] },
    contrast: { label: "Contraste", css: 1, params: [["amount", "Cantidad", 0, 300, 100, 1, "%"]] },
    saturate: { label: "Saturación", css: 1, params: [["amount", "Cantidad", 0, 300, 100, 1, "%"]] },
    grayscale: { label: "Escala de grises", css: 1, params: [["amount", "Cantidad", 0, 100, 100, 1, "%"]] },
    sepia: { label: "Sepia", css: 1, params: [["amount", "Cantidad", 0, 100, 100, 1, "%"]] },
    hueRotate: { label: "Girar matiz", css: 1, params: [["angle", "Ángulo", -180, 180, 90, 1, "°"]] },
    invert: { label: "Invertir", css: 1, params: [["amount", "Cantidad", 0, 100, 100, 1, "%"]] },
    opacity: { label: "Opacidad", css: 1, params: [["amount", "Cantidad", 0, 100, 50, 1, "%"]] },
    blur: { label: "Desenfoque gaussiano", css: 1, params: [["radius", "Radio", 0, 200, 4, 0.1, "px"]] },
    motionBlur: { label: "Desenfoque de movimiento", params: [["distance", "Distancia", 0, 300, 24, 1, "px"], ["angle", "Ángulo", -180, 180, 0, 1, "°"]] },
    unsharp: { label: "Máscara de enfoque", params: [["amount", "Cantidad", 0, 500, 100, 1, "%"], ["radius", "Radio", 0.1, 50, 1.5, 0.1, "px"], ["threshold", "Umbral", 0, 255, 0, 1, ""]] },
    highPass: { label: "Paso alto", params: [["radius", "Radio", 0.1, 100, 6, 0.1, "px"]] },
    noise: { label: "Ruido", params: [["amount", "Cantidad", 0, 100, 12, 1, "%"], ["mono", "Monocromático", 0, 1, 1, 1, "bool"]] },
    pixelate: { label: "Mosaico", params: [["size", "Tamaño", 1, 300, 12, 1, "px"]] },
    posterize: { label: "Posterizar", params: [["levels", "Niveles", 2, 64, 4, 1, ""]] },
    threshold: { label: "Umbral", params: [["level", "Nivel", 0, 255, 128, 1, ""]] },
    solarize: { label: "Solarizar", params: [["level", "Nivel", 0, 255, 128, 1, ""]] },
    gamma: { label: "Gamma", params: [["gamma", "Gamma", 0.1, 5, 1.2, 0.01, ""]] },
    levels: { label: "Niveles", params: [["inBlack", "Negro de entrada", 0, 254, 0, 1, ""], ["inWhite", "Blanco de entrada", 1, 255, 255, 1, ""], ["gamma", "Medios", 0.1, 5, 1, 0.01, ""], ["outBlack", "Negro de salida", 0, 255, 0, 1, ""], ["outWhite", "Blanco de salida", 0, 255, 255, 1, ""]] },
    normalize: { label: "Niveles automáticos", params: [["clip", "Recorte", 0, 10, 0.5, 0.1, "%"]] },
    equalize: { label: "Ecualizar", params: [] },
    duotone: { label: "Duotono", params: [["dark", "Sombras", 0, 0, "#1b1464", 0, "color"], ["light", "Luces", 0, 0, "#ffd166", 0, "color"], ["amount", "Cantidad", 0, 100, 100, 1, "%"]] },
    tint: { label: "Teñir", params: [["color", "Color", 0, 0, "#ff5e00", 0, "color"], ["amount", "Cantidad", 0, 100, 40, 1, "%"]] },
    glow: { label: "Resplandor", params: [["radius", "Radio", 0, 200, 18, 0.5, "px"], ["amount", "Cantidad", 0, 100, 50, 1, "%"]] },
    chromatic: { label: "Aberración cromática", params: [["amount", "Desplazamiento", 0, 60, 4, 0.5, "px"], ["angle", "Ángulo", -180, 180, 0, 1, "°"]] },
    halftone: { label: "Semitono", params: [["size", "Tamaño del punto", 2, 80, 8, 1, "px"], ["angle", "Ángulo", -90, 90, 45, 1, "°"]] },
    emboss: { label: "Relieve", params: [["strength", "Fuerza", 0, 500, 100, 1, "%"], ["angle", "Ángulo", -180, 180, 135, 1, "°"]] },
    edges: { label: "Bordes", params: [["strength", "Fuerza", 0, 500, 100, 1, "%"], ["invert", "Fondo claro", 0, 1, 0, 1, "bool"]] },
    convolve: { label: "Matriz de convolución", params: [["kernel", "Matriz 3×3", 0, 0, [0, -1, 0, -1, 5, -1, 0, -1, 0], 0, "kernel"], ["divisor", "Divisor", 0.01, 1000, 1, 0.01, ""], ["bias", "Desplazamiento", -255, 255, 0, 1, ""]] },
    colorMatrix: { label: "Matriz de color", params: [["matrix", "Matriz 4×5", 0, 0, [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0], 0, "matrix"]] },
    code: { label: "Filtro de código", params: [["code", "Código", 0, 0, "", 0, "code"]] },
  };
  /* opciones que no son controles deslizantes pero forman parte del filtro (compatibilidad exacta con otras librerías) */
  var FILTER_EXTRA = { contrast: { pivot: ["mid", "mean"] }, saturate: { weights: ["709", "601"] }, grayscale: { weights: ["709", "601"] } };
  function filterDefaults(kind) { var F = FILTERS[kind], o = {}; if (!F) return null; F.params.forEach(function (p) { o[p[0]] = clone(p[4]); }); return o; }
  function normFilter(f) {
    if (!isObj(f) || !FILTERS[f.kind]) return null;
    var F = FILTERS[f.kind], o = { id: String(f.id || uid("f")), kind: f.kind, on: f.on !== false };
    F.params.forEach(function (p) {
      var k = p[0], v = f[k], u = p[6];
      if (v == null) { o[k] = clone(p[4]); return; }
      if (u === "color") o[k] = toHex(hex(v));
      else if (u === "bool") o[k] = v === true || v === 1 || v === "1" || v === "true" ? 1 : 0;
      else if (u === "kernel") { var a = Array.isArray(v) ? [].concat.apply([], v).map(function (x) { return num(x, 0); }) : []; o[k] = a.length === 9 || a.length === 25 ? a : clone(p[4]); }
      else if (u === "matrix") { var mm = Array.isArray(v) ? [].concat.apply([], v).map(function (x) { return num(x, 0); }) : []; if (mm.length === 9) mm = [mm[0], mm[1], mm[2], 0, 0, mm[3], mm[4], mm[5], 0, 0, mm[6], mm[7], mm[8], 0, 0, 0, 0, 0, 1, 0]; if (mm.length === 12) mm = [mm[0], mm[1], mm[2], 0, mm[3], mm[4], mm[5], mm[6], 0, mm[7], mm[8], mm[9], mm[10], 0, mm[11], 0, 0, 0, 1, 0]; o[k] = mm.length === 20 ? mm : clone(p[4]); }
      else if (u === "code") o[k] = String(v).slice(0, 60000);
      else o[k] = clamp(num(v, p[4]), p[2], p[3]);
    });
    var ex = FILTER_EXTRA[f.kind]; if (ex) Object.keys(ex).forEach(function (k) { if (f[k] != null && ex[k].indexOf(String(f[k])) > 0) o[k] = String(f[k]); });
    if (f.kind === "code" && isObj(f.values)) { o.values = {}; Object.keys(f.values).slice(0, 40).forEach(function (k) { o.values[k] = num(f.values[k], 0); }); }
    if (f.mask) o.mask = String(f.mask);
    if (f.name) o.name = String(f.name).slice(0, 40);
    return o;
  }
  function filterIsIdentity(f) {
    switch (f.kind) {
      case "brightness": case "contrast": case "saturate": return f.amount === 100;
      case "grayscale": case "sepia": case "invert": case "noise": case "tint": case "glow": return f.amount === 0;
      case "opacity": return f.amount === 100;
      case "hueRotate": return f.angle % 360 === 0;
      case "blur": return f.radius === 0;
      case "motionBlur": return f.distance === 0;
      case "unsharp": return f.amount === 0;
      case "pixelate": return f.size <= 1;
      case "gamma": return f.gamma === 1;
      case "chromatic": return f.amount === 0;
      case "duotone": return f.amount === 0;
      default: return false;
    }
  }

  /* ═════════════ capas (Componer) ═════════════ */
  var BLENDS = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"];
  var LAYER_KINDS = ["paint", "image", "text", "shape"];
  var TEXT0 = { s: "Texto", x: 0.1, y: 0.1, size: 0.08, color: "#ffffff", font: "Anton", weight: 400, italic: false, align: "left", ls: 0, lh: 1.15, vert: false, rot: 0 };
  function normBox(b, d) { b = isObj(b) ? b : {}; d = d || { x: 0, y: 0, w: 1, h: 1 }; return { x: clamp(num(b.x, d.x), -4, 4), y: clamp(num(b.y, d.y), -4, 4), w: clamp(num(b.w, d.w), 0.002, 8), h: clamp(num(b.h, d.h), 0.002, 8), rot: clamp(num(b.rot, 0), -360, 360) }; }
  function normLayer(L) {
    if (!isObj(L) || LAYER_KINDS.indexOf(L.kind) < 0) return null;
    var o = { id: String(L.id != null ? L.id : uid("l")), kind: L.kind, name: String(L.name || { paint: "Capa", image: "Imagen", text: "Texto", shape: "Forma" }[L.kind]).slice(0, 60),
      op: clamp(Math.round(num(L.op != null ? L.op : L.opacity, 100)), 0, 100), blend: BLENDS.indexOf(L.blend) >= 0 ? L.blend : "normal", vis: L.vis !== false && L.visible !== false };
    if (L.lock) o.lock = true;
    if (L.mask) o.mask = String(L.mask);
    if (L.kind === "paint") { if (L.src) o.src = String(L.src); if (L.pre) o.pre = true; o.box = normBox(L.box); }
    if (L.kind === "image") { if (!L.src) return null; o.src = String(L.src); o.box = normBox(L.box, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }); if (L.fit === "contain" || L.fit === "fill") o.fit = L.fit; }
    if (L.kind === "text") {
      var t = isObj(L.text) ? L.text : {}, d = TEXT0;
      o.text = { s: String(t.s != null ? t.s : t.text != null ? t.text : d.s).slice(0, 4000), x: clamp(num(t.x, d.x), -2, 3), y: clamp(num(t.y, d.y), -2, 3), size: clamp(num(t.size, d.size), 0.004, 2), color: toHex(hex(t.color || d.color)),
        font: String(t.font || d.font).slice(0, 80), weight: clamp(Math.round(num(t.weight, d.weight) / 100) * 100, 100, 900), italic: !!t.italic, align: ["left", "center", "right"].indexOf(t.align) >= 0 ? t.align : "left",
        ls: clamp(num(t.ls, 0), -0.2, 1), lh: clamp(num(t.lh, d.lh), 0.6, 3), vert: !!t.vert, rot: clamp(num(t.rot, 0), -360, 360) };
      if (isObj(t.stroke) && num(t.stroke.w, 0) > 0) o.text.stroke = { color: toHex(hex(t.stroke.color || "#000000")), w: clamp(num(t.stroke.w, 0), 0, 0.5) };
      if (isObj(t.shadow)) o.text.shadow = { color: toHex(hex(t.shadow.color || "#000000")), blur: clamp(num(t.shadow.blur, 0.01), 0, 0.5), x: clamp(num(t.shadow.x, 0), -1, 1), y: clamp(num(t.shadow.y, 0.005), -1, 1), op: clamp(num(t.shadow.op, 60), 0, 100) };
      if (t.bg) o.text.bg = toHex(hex(t.bg));
    }
    if (L.kind === "shape") {
      var s = isObj(L.shape) ? L.shape : {}, ty = ["rect", "ellipse", "line", "poly", "path"].indexOf(s.type) >= 0 ? s.type : "rect";
      o.shape = { type: ty, fill: s.fill === "none" || s.fill === null ? "none" : toHex(hex(s.fill || "#ff5e00")), stroke: s.stroke && s.stroke !== "none" ? toHex(hex(s.stroke)) : "none", sw: clamp(num(s.sw, 0), 0, 0.5), radius: clamp(num(s.radius, 0), 0, 0.5) };
      if (ty === "poly" || ty === "path" || ty === "line") {
        o.shape.pts = (Array.isArray(s.pts) ? s.pts : []).map(function (p) { return Array.isArray(p) && p.length >= 2 ? p.slice(0, 6).map(function (v) { return Math.round(clamp(num(v, 0), -4, 5) * 1e5) / 1e5; }) : null; }).filter(Boolean).slice(0, 400);
        if (o.shape.pts.length < 2) return null;
        o.shape.closed = ty === "line" ? false : s.closed !== false;
      } else o.box = normBox(L.box, { x: 0.3, y: 0.3, w: 0.4, h: 0.4 });
      if (ty === "line" && o.shape.stroke === "none") { o.shape.stroke = o.shape.fill === "none" ? "#ff5e00" : o.shape.fill; o.shape.fill = "none"; if (!o.shape.sw) o.shape.sw = 0.006; }
    }
    return o;
  }

  /* ═════════════ fuente y documento ═════════════ */
  var LANGS = ["js", "html", "svg", "py", "glsl"];
  function normSource(s) {
    if (typeof s === "string") s = { kind: "url", url: s };
    if (!isObj(s)) return null;
    if (s.kind === "code" || (s.code && !s.url)) {
      var o = { kind: "code", lang: LANGS.indexOf(s.lang) >= 0 ? s.lang : "js", code: String(s.code || "").slice(0, 400000), w: clamp(Math.round(num(s.w != null ? s.w : s.width, 1080)), 16, 4096), h: clamp(Math.round(num(s.h != null ? s.h : s.height, 1080)), 16, 4096), t: clamp(num(s.t != null ? s.t : s.time, 0), 0, 3600) };
      if (s.input) o.input = String(s.input);
      if (s.capture === "page" || s.capture === "canvas") o.capture = s.capture;
      if (s.transparent) o.transparent = true;
      if (s.poster) o.poster = String(s.poster);
      return o;
    }
    if (!s.url) return null;
    var u = { kind: "url", url: String(s.url) };
    if (s.w > 0 && s.h > 0) { u.w = Math.round(+s.w); u.h = Math.round(+s.h); }
    return u;
  }
  function doc0() { return { v: VERSION, source: null, recipe: recipe0(), filters: [], layers: [] }; }
  /* acepta: documento v2, receta suelta (lo que guardaba Musa antes), o { recipe, capas } */
  function normalize(d) {
    d = isObj(d) ? d : {};
    var looksRecipe = !d.recipe && (d.basic || d.wb || d.geo || d.curve || d.masks || d.fx || d.detail || d.hsl || d.grade || d.bw || d.color);
    var o = doc0();
    o.source = normSource(d.source);
    o.recipe = normRecipe(looksRecipe ? d : d.recipe);
    var seen = {};
    o.filters = (Array.isArray(d.filters) ? d.filters : []).map(normFilter).filter(function (f) { if (!f || seen["f" + f.id]) return false; seen["f" + f.id] = 1; return true; }).slice(0, MAX_FILTERS);
    o.layers = (Array.isArray(d.layers) ? d.layers : []).map(normLayer).filter(function (L) { if (!L || seen["l" + L.id]) return false; seen["l" + L.id] = 1; return true; }).slice(0, MAX_LAYERS);
    if (d.name) o.name = String(d.name).slice(0, 160);
    if (isObj(d.out)) { o.out = {}; if (d.out.maxW > 0) o.out.maxW = clamp(Math.round(+d.out.maxW), 16, 8192); if (d.out.format) o.out.format = ["png", "jpg", "webp"].indexOf(d.out.format) >= 0 ? d.out.format : undefined; if (!Object.keys(o.out).length) delete o.out; }
    return o;
  }
  function edited(d) { d = normalize(d); return recipeEdited(d.recipe) || d.filters.length > 0 || d.layers.length > 0 || !!(d.source && d.source.kind === "code"); }
  function signature(d) { return stable(normalize(d)); }
  /* las imágenes de las que depende el documento (pintura, máscaras, imágenes colocadas) */
  function bitmaps(d) {
    var out = [];
    (d.recipe.masks || []).forEach(function (m) { if (m.src) out.push({ at: "mask:" + m.id, url: m.src }); });
    (d.filters || []).forEach(function (f) { if (f.mask) out.push({ at: "fmask:" + f.id, url: f.mask }); });
    (d.layers || []).forEach(function (L) { if (L.src) out.push({ at: "layer:" + L.id, url: L.src }); if (L.mask) out.push({ at: "lmask:" + L.id, url: L.mask }); });
    return out;
  }

  /* ═════════════ curvas: interpolación monótona (Fritsch–Carlson) → tabla de 256 ═════════════ */
  function lut(pts) {
    var p = pts.slice().sort(function (a, b) { return a[0] - b[0]; });
    if (p.length === 2 && p[0][0] === 0 && p[0][1] === 0 && p[1][0] === 255 && p[1][1] === 255) return null;
    var n = p.length, xs = p.map(function (q) { return q[0]; }), ys = p.map(function (q) { return q[1]; }), dk = [], m = [], i;
    for (i = 0; i < n - 1; i++) dk.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
    m[0] = dk[0]; m[n - 1] = dk[n - 2];
    for (i = 1; i < n - 1; i++) m[i] = dk[i - 1] * dk[i] <= 0 ? 0 : (dk[i - 1] + dk[i]) / 2;
    for (i = 0; i < n - 1; i++) { if (!dk[i]) { m[i] = m[i + 1] = 0; continue; } var a = m[i] / dk[i], b = m[i + 1] / dk[i], s = a * a + b * b; if (s > 9) { var t = 3 / Math.sqrt(s); m[i] = t * a * dk[i]; m[i + 1] = t * b * dk[i]; } }
    var out = new Uint8ClampedArray(256);
    for (var v = 0, j = 0; v < 256; v++) {
      if (v <= xs[0]) { out[v] = ys[0]; continue; }
      if (v >= xs[n - 1]) { out[v] = ys[n - 1]; continue; }
      while (v > xs[j + 1]) j++;
      var h = xs[j + 1] - xs[j], tt = (v - xs[j]) / h, t2 = tt * tt, t3 = t2 * tt;
      out[v] = (2 * t3 - 3 * t2 + 1) * ys[j] + (t3 - 2 * t2 + tt) * h * m[j] + (-2 * t3 + 3 * t2) * ys[j + 1] + (t3 - t2) * h * m[j + 1];
    }
    return out;
  }

  /* ═════════════ desenfoque gaussiano en JS (tres pasadas de caja): igual en Chrome, Safari y al exportar ═════════════
     (el filtro de canvas `ctx.filter` no existe en Safari: antes Enfoque, Claridad y Reducir ruido no hacían nada ahí) */
  function boxes(sigma, n) {
    var wi = Math.sqrt(12 * sigma * sigma / n + 1), wl = Math.floor(wi); if (wl % 2 === 0) wl--;
    var wu = wl + 2, mi = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4)), out = [];
    for (var i = 0; i < n; i++) out.push(((i < mi ? wl : wu) - 1) / 2);
    return out;
  }
  function boxH(s, t, w, h, r) {
    var ia = 1 / (r + r + 1);
    for (var c = 0; c < 4; c++) for (var y = 0; y < h; y++) {
      var ti = (y * w) * 4 + c, li = ti, ri = ti + r * 4, fv = s[ti], lv = s[ti + (w - 1) * 4], val = (r + 1) * fv, j;
      for (j = 0; j < r; j++) val += s[ti + Math.min(j, w - 1) * 4];
      for (j = 0; j <= r; j++) { val += (j + r < w ? s[ri] : lv) - fv; if (j + r < w) ri += 4; t[ti] = val * ia; ti += 4; }
      for (j = r + 1; j < w - r; j++) { val += s[ri] - s[li]; ri += 4; li += 4; t[ti] = val * ia; ti += 4; }
      for (j = Math.max(w - r, r + 1); j < w; j++) { val += lv - s[li]; li += 4; t[ti] = val * ia; ti += 4; }
    }
  }
  function boxV(s, t, w, h, r) {
    var ia = 1 / (r + r + 1), st = w * 4;
    for (var c = 0; c < 4; c++) for (var x = 0; x < w; x++) {
      var ti = x * 4 + c, li = ti, ri = ti + r * st, fv = s[ti], lv = s[ti + (h - 1) * st], val = (r + 1) * fv, j;
      for (j = 0; j < r; j++) val += s[ti + Math.min(j, h - 1) * st];
      for (j = 0; j <= r; j++) { val += (j + r < h ? s[ri] : lv) - fv; if (j + r < h) ri += st; t[ti] = val * ia; ti += st; }
      for (j = r + 1; j < h - r; j++) { val += s[ri] - s[li]; ri += st; li += st; t[ti] = val * ia; ti += st; }
      for (j = Math.max(h - r, r + 1); j < h; j++) { val += lv - s[li]; li += st; t[ti] = val * ia; ti += st; }
    }
  }
  function gauss(src, w, h, sigma) {
    var out = new Uint8ClampedArray(src.length);
    if (!(sigma > 0.05) || w < 2 || h < 2) { out.set(src); return out; }
    var a = new Float32Array(src.length), b = new Float32Array(src.length), bx = boxes(sigma, 3), i;
    for (i = 0; i < src.length; i++) a[i] = src[i];
    for (i = 0; i < 3; i++) { var r = Math.max(0, Math.min(bx[i], Math.floor((Math.min(w, h) - 1) / 2))); if (!r) continue; boxH(a, b, w, h, r); boxV(b, a, w, h, r); }
    for (i = 0; i < src.length; i++) out[i] = a[i];
    return out;
  }

  /* ═════════════ motor del revelado ═════════════
     B = { w, h, d }: píxeles de la fuente ya con la geometría aplicada. Devuelve { data, width, height }.
     o: { bS, bL (desenfoques chico y grande de B.d, opcionales), brush: { idMáscara: alfa RGBA }, split (0–1), overlay (id de máscara) } */
  var NOISE = (function () { var r = rand(7), a = new Float32Array(65536); for (var i = 0; i < a.length; i++) a[i] = r() - 0.5; return a; })();
  function hueRGB(h) { var f = function (n) { var k = (n + h / 30) % 12; return 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0), f(8), f(4)]; }
  function needs(r) {
    var dt = r.detail, mc = (r.masks || []).some(function (m) { return m.on && m.adj && m.adj.clarity; });
    return { S: !!(dt.sharpen || dt.texture || dt.denoise), L: !!(dt.clarity || dt.dehaze || mc) };
  }
  function sigmas(w) { return { S: Math.max(1, w / 700), L: Math.max(4, w / 45) }; }
  function maskW(m, u, v, bm, i, R, G, Bl) {
    var w;
    if (m.kind === "radial") { var dx = (u - m.cx) / Math.max(0.001, m.rx), dy = (v - m.cy) / Math.max(0.001, m.ry); w = 1 - smooth(1 - m.feather, 1, Math.sqrt(dx * dx + dy * dy)); }
    else if (m.kind === "linear") { var ex = m.x2 - m.x1, ey = m.y2 - m.y1, t = ((u - m.x1) * ex + (v - m.y1) * ey) / Math.max(1e-6, ex * ex + ey * ey); w = 1 - smooth(0, 1, t); }
    else if (m.kind === "lum") { var l = 0.2126 * R + 0.7152 * G + 0.0722 * Bl, f = 0.02 + m.feather * 0.3; w = smooth(m.lo - f, m.lo, l) * (1 - smooth(m.hi, m.hi + f, l)); }
    else if (m.kind === "color") {
      var mx = Math.max(R, G, Bl), mn = Math.min(R, G, Bl), dd = mx - mn;
      if (dd < 0.04) w = 0;
      else { var hh = (mx === R ? ((G - Bl) / dd + 6) % 6 : mx === G ? (Bl - R) / dd + 2 : (R - G) / dd + 4) * 60, df = Math.abs(hh - m.hue); if (df > 180) df = 360 - df; var fe = 4 + m.feather * 40; w = (1 - smooth(m.range / 2, m.range / 2 + fe, df)) * smooth(0.04, 0.16, dd); }
    }
    else w = bm ? bm[i + 3] / 255 : 0;
    return m.invert ? 1 - w : w;
  }
  function process(B, r, o) {
    o = o || {};
    var w = B.w, h = B.h, d = B.d, q = new Uint8ClampedArray(w * h * 4);
    var bs = r.basic, ex = Math.pow(2, bs.exposure / 100 * 1.4), ct = 1 + bs.contrast / 100 * 0.9, hi = bs.highlights / 100, sh = bs.shadows / 100, wh = bs.whites / 100, bk = bs.blacks / 100;
    var tp = r.wb.temp / 100, tn = r.wb.tint / 100, sat = 1 + r.color.saturation / 100, vib = r.color.vibrance / 100;
    var lr = lut(r.curve.rgb), l1 = lut(r.curve.r), l2 = lut(r.curve.g), l3 = lut(r.curve.b);
    var bands = BANDS.map(function (b) { var s = r.hsl[b[0]]; return [b[2], s.h, s.s / 100, s.l / 100]; }), hslOn = bands.some(function (b) { return b[1] || b[2] || b[3]; });
    var gr = ["shadows", "midtones", "highlights"].map(function (k) { var c = hueRGB(r.grade[k].hue), s = r.grade[k].sat / 100 * 0.35; return [(c[0] - 0.5) * s, (c[1] - 0.5) * s, (c[2] - 0.5) * s]; });
    var grOn = gr.some(function (g) { return g[0] || g[1] || g[2]; }), gb = r.grade.balance / 100 * 0.25;
    var dt = r.detail, hf = (dt.sharpen * 1.6 + dt.texture * 0.8) / 100, cl = dt.clarity / 100 * 1.2, dn = dt.denoise / 100, dz = (dt.dehaze || 0) / 100;
    var nd = needs(r), sg = sigmas(w);
    var bS = nd.S ? (o.bS || gauss(d, w, h, sg.S)) : null, bL = nd.L ? (o.bL || gauss(d, w, h, sg.L)) : null;
    var bw = r.bw.on, bwr = r.bw.r / 100, bwg = r.bw.g / 100, bwb = r.bw.b / 100, bwn = Math.max(0.01, 0.2126 * bwr + 0.7152 * bwg + 0.0722 * bwb);
    var vg = r.fx.vignette / 100, vmid = 0.25 + r.fx.mid / 100 * 0.6, vf = 0.05 + r.fx.feather / 100 * 0.7, gn = r.fx.grain / 100 * 0.22;
    var masks = (r.masks || []).filter(function (m) { return m.on; }).map(function (m) {
      var a = m.adj || ADJ0;
      return { m: m, bm: m.kind === "brush" && o.brush ? o.brush[m.id] : null, e: Math.pow(2, (a.exposure || 0) / 100 * 1.4), c: 1 + (a.contrast || 0) / 100 * 0.9, hi: (a.highlights || 0) / 100, sh: (a.shadows || 0) / 100, s: 1 + (a.saturation || 0) / 100, tp: (a.temp || 0) / 100, tn: (a.tint || 0) / 100, cl: (a.clarity || 0) / 100 * 1.2 };
    });
    var ovm = null; if (o.overlay) for (var mi = 0; mi < (r.masks || []).length; mi++) if (r.masks[mi].id === o.overlay) ovm = { m: r.masks[mi], bm: r.masks[mi].kind === "brush" && o.brush ? o.brush[r.masks[mi].id] : null };
    var split = o.split == null ? -1 : o.split * w, alpha = !!o.alpha;
    for (var y = 0, i = 0; y < h; y++) {
      var v = y / h;
      for (var x = 0; x < w; x++, i += 4) {
        q[i + 3] = alpha ? d[i + 3] : 255;
        if (x < split) { q[i] = d[i]; q[i + 1] = d[i + 1]; q[i + 2] = d[i + 2]; continue; }
        var R = d[i] / 255, G = d[i + 1] / 255, Bl = d[i + 2] / 255;
        if (tp || tn) { R += tp * 0.1 - tn * 0.03; Bl -= tp * 0.1 + tn * 0.03; G += tn * 0.08; }
        if (dz) {
          var dk = Math.min(bL[i], bL[i + 1], bL[i + 2]) / 255;
          if (dz > 0) { var tr = Math.max(0.18, 1 - dz * 0.85 * dk), A = 0.94; R = (R - A) / tr + A; G = (G - A) / tr + A; Bl = (Bl - A) / tr + A; }
          else { var kz = -dz * 0.6 * (0.35 + 0.65 * dk); R += (0.94 - R) * kz; G += (0.94 - G) * kz; Bl += (0.94 - Bl) * kz; }
        }
        var l = 0.2126 * R + 0.7152 * G + 0.0722 * Bl;
        if (ex !== 1) { R *= ex; G *= ex; Bl *= ex; }
        if (hi || sh || wh || bk) {
          var mH = smooth(0.35, 1, l) * hi * 0.3, mS = (1 - smooth(0, 0.55, l)) * sh * 0.3, mW = smooth(0.6, 1, l) * wh * 0.22, mB = (1 - smooth(0, 0.35, l)) * bk * 0.22;
          R += (mH + mW) * (1 - R) + (mS + mB) * R; G += (mH + mW) * (1 - G) + (mS + mB) * G; Bl += (mH + mW) * (1 - Bl) + (mS + mB) * Bl;
        }
        if (ct !== 1) { R = (R - 0.5) * ct + 0.5; G = (G - 0.5) * ct + 0.5; Bl = (Bl - 0.5) * ct + 0.5; }
        R = R < 0 ? 0 : R > 1 ? 1 : R; G = G < 0 ? 0 : G > 1 ? 1 : G; Bl = Bl < 0 ? 0 : Bl > 1 ? 1 : Bl;
        if (lr) { R = lr[R * 255 | 0] / 255; G = lr[G * 255 | 0] / 255; Bl = lr[Bl * 255 | 0] / 255; }
        if (l1) R = l1[R * 255 | 0] / 255;
        if (l2) G = l2[G * 255 | 0] / 255;
        if (l3) Bl = l3[Bl * 255 | 0] / 255;
        if (hslOn) {
          var mx = Math.max(R, G, Bl), mn = Math.min(R, G, Bl), dd = mx - mn;
          if (dd > 0.02) {
            var hh = (mx === R ? ((G - Bl) / dd + 6) % 6 : mx === G ? (Bl - R) / dd + 2 : (R - G) / dd + 4) * 60, dh = 0, ds = 0, dl = 0;
            for (var bi = 0; bi < bands.length; bi++) { var bb = bands[bi], df = Math.abs(hh - bb[0]); if (df > 180) df = 360 - df; var wgt = df < 45 ? 1 - df / 45 : 0; if (wgt) { dh += bb[1] * wgt; ds += bb[2] * wgt; dl += bb[3] * wgt; } }
            var ll = (mx + mn) / 2, ss = dd / (1 - Math.abs(2 * ll - 1) + 1e-6);
            var nh = (hh + dh + 360) % 360, ns = clamp(ss * (1 + ds), 0, 1), nl = clamp(ll + dl * 0.25 * ss, 0, 1);
            var cc = (1 - Math.abs(2 * nl - 1)) * ns, xx = cc * (1 - Math.abs((nh / 60) % 2 - 1)), m0 = nl - cc / 2, sx = nh / 60 | 0;
            if (sx === 0) { R = cc; G = xx; Bl = 0; } else if (sx === 1) { R = xx; G = cc; Bl = 0; } else if (sx === 2) { R = 0; G = cc; Bl = xx; } else if (sx === 3) { R = 0; G = xx; Bl = cc; } else if (sx === 4) { R = xx; G = 0; Bl = cc; } else { R = cc; G = 0; Bl = xx; }
            R += m0; G += m0; Bl += m0;
          }
        }
        l = 0.2126 * R + 0.7152 * G + 0.0722 * Bl;
        if (sat !== 1 || vib) { var s0 = Math.max(R, G, Bl) - Math.min(R, G, Bl), fs = sat * (1 + vib * (1 - s0) * 1.2); R = l + (R - l) * fs; G = l + (G - l) * fs; Bl = l + (Bl - l) * fs; }
        if (grOn) {
          var ws = 1 - smooth(0, 0.5 + gb, l), whh = smooth(0.5 + gb, 1, l), wm = 1 - ws - whh;
          R += gr[0][0] * ws + gr[1][0] * wm + gr[2][0] * whh; G += gr[0][1] * ws + gr[1][1] * wm + gr[2][1] * whh; Bl += gr[0][2] * ws + gr[1][2] * wm + gr[2][2] * whh;
        }
        if (bS) { var k2 = hf - dn; R += (d[i] - bS[i]) / 255 * k2; G += (d[i + 1] - bS[i + 1]) / 255 * k2; Bl += (d[i + 2] - bS[i + 2]) / 255 * k2; }
        if (cl) { var wc = 1 - Math.abs(l * 2 - 1); R += (d[i] - bL[i]) / 255 * cl * wc; G += (d[i + 1] - bL[i + 1]) / 255 * cl * wc; Bl += (d[i + 2] - bL[i + 2]) / 255 * cl * wc; }
        if (bw) { var gg = (R * 0.2126 * bwr + G * 0.7152 * bwg + Bl * 0.0722 * bwb) / bwn; R = G = Bl = gg; }
        if (masks.length) {
          var u = x / w;
          for (var k = 0; k < masks.length; k++) {
            var M = masks[k], mw = maskW(M.m, u, v, M.bm, i, R, G, Bl);
            if (mw <= 0.001) continue;
            var r2 = R * M.e, g2 = G * M.e, b2 = Bl * M.e;
            if (M.hi || M.sh) { var lm = 0.2126 * r2 + 0.7152 * g2 + 0.0722 * b2, aH = smooth(0.35, 1, lm) * M.hi * 0.3, aS = (1 - smooth(0, 0.55, lm)) * M.sh * 0.3; r2 += aH * (1 - r2) + aS * r2; g2 += aH * (1 - g2) + aS * g2; b2 += aH * (1 - b2) + aS * b2; }
            r2 = (r2 - 0.5) * M.c + 0.5; g2 = (g2 - 0.5) * M.c + 0.5; b2 = (b2 - 0.5) * M.c + 0.5;
            r2 += M.tp * 0.1 - M.tn * 0.03; b2 -= M.tp * 0.1 + M.tn * 0.03; g2 += M.tn * 0.08;
            var lq = 0.2126 * r2 + 0.7152 * g2 + 0.0722 * b2; r2 = lq + (r2 - lq) * M.s; g2 = lq + (g2 - lq) * M.s; b2 = lq + (b2 - lq) * M.s;
            if (M.cl) { var wq = 1 - Math.abs(lq * 2 - 1); r2 += (d[i] - bL[i]) / 255 * M.cl * wq; g2 += (d[i + 1] - bL[i + 1]) / 255 * M.cl * wq; b2 += (d[i + 2] - bL[i + 2]) / 255 * M.cl * wq; }
            R += (r2 - R) * mw; G += (g2 - G) * mw; Bl += (b2 - Bl) * mw;
          }
        }
        if (vg) {
          var vx = x / w - 0.5, vy = v - 0.5, dist = Math.sqrt(vx * vx + vy * vy) * 1.41, fv = smooth(vmid - vf / 2, vmid + vf / 2, dist) * vg;
          if (fv < 0) { R *= 1 + fv; G *= 1 + fv; Bl *= 1 + fv; } else { R += (1 - R) * fv; G += (1 - G) * fv; Bl += (1 - Bl) * fv; }
        }
        if (gn) { var nz = NOISE[(x * 131 + y * 977) & 65535] * gn; R += nz; G += nz; Bl += nz; }
        if (ovm) { var ow = maskW(ovm.m, x / w, v, ovm.bm, i, R, G, Bl) * 0.55; R += (1 - R) * ow; G *= 1 - ow * 0.8; Bl *= 1 - ow * 0.8; }
        q[i] = R * 255; q[i + 1] = G * 255; q[i + 2] = Bl * 255;
      }
    }
    return { data: q, width: w, height: h };
  }

  /* ═════════════ filtros: cada uno recibe y devuelve RGBA (0–255). env: { k (px de vista / px reales), masks: { id: alfa RGBA }, seed } ═════════════ */
  var W709 = [0.2126, 0.7152, 0.0722], W601 = [0.299, 0.587, 0.114];
  function matrix3(px, m) { for (var i = 0; i < px.length; i += 4) { var r = px[i], g = px[i + 1], b = px[i + 2]; px[i] = m[0] * r + m[1] * g + m[2] * b; px[i + 1] = m[3] * r + m[4] * g + m[5] * b; px[i + 2] = m[6] * r + m[7] * g + m[8] * b; } return px; }
  function satMatrix(s, W) { return [W[0] + (1 - W[0]) * s, W[1] - W[1] * s, W[2] - W[2] * s, W[0] - W[0] * s, W[1] + (1 - W[1]) * s, W[2] - W[2] * s, W[0] - W[0] * s, W[1] - W[1] * s, W[2] + (1 - W[2]) * s]; }
  function convolve(px, w, h, kr, div, bias) {
    var n = kr.length === 25 ? 5 : 3, hf = (n - 1) / 2, out = new Uint8ClampedArray(px.length);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var r = 0, g = 0, b = 0, o = (y * w + x) * 4;
      for (var ky = 0; ky < n; ky++) { var yy = clamp(y + ky - hf, 0, h - 1) * w; for (var kx = 0; kx < n; kx++) { var kk = kr[ky * n + kx]; if (!kk) continue; var p = (yy + clamp(x + kx - hf, 0, w - 1)) * 4; r += px[p] * kk; g += px[p + 1] * kk; b += px[p + 2] * kk; } }
      out[o] = r / div + bias; out[o + 1] = g / div + bias; out[o + 2] = b / div + bias; out[o + 3] = px[o + 3];
    }
    return out;
  }
  var FX = {
    brightness: function (px, w, h, p) { var a = p.amount / 100; for (var i = 0; i < px.length; i += 4) { px[i] *= a; px[i + 1] *= a; px[i + 2] *= a; } return px; },
    contrast: function (px, w, h, p) {
      var a = p.amount / 100, pv = 127.5, i;
      if (p.pivot === "mean") { var s = 0, n = 0; for (i = 0; i < px.length; i += 16) { s += px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114; n++; } pv = Math.round(s / Math.max(1, n)); }
      for (i = 0; i < px.length; i += 4) { px[i] = (px[i] - pv) * a + pv; px[i + 1] = (px[i + 1] - pv) * a + pv; px[i + 2] = (px[i + 2] - pv) * a + pv; }
      return px;
    },
    saturate: function (px, w, h, p) { return matrix3(px, satMatrix(p.amount / 100, p.weights === "601" ? W601 : [0.213, 0.715, 0.072])); },
    grayscale: function (px, w, h, p) { return matrix3(px, satMatrix(1 - p.amount / 100, p.weights === "601" ? W601 : W709)); },
    sepia: function (px, w, h, p) { var t = 1 - p.amount / 100; return matrix3(px, [0.393 + 0.607 * t, 0.769 - 0.769 * t, 0.189 - 0.189 * t, 0.349 - 0.349 * t, 0.686 + 0.314 * t, 0.168 - 0.168 * t, 0.272 - 0.272 * t, 0.534 - 0.534 * t, 0.131 + 0.869 * t]); },
    hueRotate: function (px, w, h, p) {
      var a = p.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      return matrix3(px, [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283, 0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072]);
    },
    invert: function (px, w, h, p) { var a = p.amount / 100; for (var i = 0; i < px.length; i += 4) { px[i] = px[i] * (1 - 2 * a) + 255 * a; px[i + 1] = px[i + 1] * (1 - 2 * a) + 255 * a; px[i + 2] = px[i + 2] * (1 - 2 * a) + 255 * a; } return px; },
    opacity: function (px, w, h, p) { var a = p.amount / 100; for (var i = 3; i < px.length; i += 4) px[i] *= a; return px; },
    blur: function (px, w, h, p, env) { return gauss(px, w, h, p.radius * env.k); },
    motionBlur: function (px, w, h, p, env) {
      var dist = p.distance * env.k, n = Math.max(1, Math.min(96, Math.round(dist))); if (n < 2) return px;
      var a = p.angle * Math.PI / 180, dx = Math.cos(a) * dist / n, dy = Math.sin(a) * dist / n, out = new Uint8ClampedArray(px.length);
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var r = 0, g = 0, b = 0, al = 0, o = (y * w + x) * 4;
        for (var s = 0; s < n; s++) { var t = s - (n - 1) / 2, xx = clamp(Math.round(x + dx * t), 0, w - 1), yy = clamp(Math.round(y + dy * t), 0, h - 1), q = (yy * w + xx) * 4; r += px[q]; g += px[q + 1]; b += px[q + 2]; al += px[q + 3]; }
        out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = al / n;
      }
      return out;
    },
    unsharp: function (px, w, h, p, env) {
      var bl = gauss(px, w, h, Math.max(0.3, p.radius * env.k)), a = p.amount / 100, th = p.threshold || 0;
      for (var i = 0; i < px.length; i += 4) for (var c = 0; c < 3; c++) { var df = px[i + c] - bl[i + c]; if (Math.abs(df) >= th) px[i + c] = px[i + c] + df * a; }
      return px;
    },
    highPass: function (px, w, h, p, env) { var bl = gauss(px, w, h, Math.max(0.3, p.radius * env.k)); for (var i = 0; i < px.length; i += 4) { px[i] = 127.5 + px[i] - bl[i]; px[i + 1] = 127.5 + px[i + 1] - bl[i + 1]; px[i + 2] = 127.5 + px[i + 2] - bl[i + 2]; } return px; },
    noise: function (px, w, h, p, env) {
      var a = p.amount / 100 * 255 * 0.5, rn = rand(env.seed || 11);
      for (var i = 0; i < px.length; i += 4) { if (p.mono) { var n = (rn() - 0.5) * 2 * a; px[i] += n; px[i + 1] += n; px[i + 2] += n; } else { px[i] += (rn() - 0.5) * 2 * a; px[i + 1] += (rn() - 0.5) * 2 * a; px[i + 2] += (rn() - 0.5) * 2 * a; } }
      return px;
    },
    pixelate: function (px, w, h, p, env) {
      var s = Math.max(1, Math.round(p.size * env.k)); if (s < 2) return px;
      for (var by = 0; by < h; by += s) for (var bx = 0; bx < w; bx += s) {
        var r = 0, g = 0, b = 0, a = 0, n = 0, x, y, q, ye = Math.min(h, by + s), xe = Math.min(w, bx + s);
        for (y = by; y < ye; y++) for (x = bx; x < xe; x++) { q = (y * w + x) * 4; r += px[q]; g += px[q + 1]; b += px[q + 2]; a += px[q + 3]; n++; }
        r /= n; g /= n; b /= n; a /= n;
        for (y = by; y < ye; y++) for (x = bx; x < xe; x++) { q = (y * w + x) * 4; px[q] = r; px[q + 1] = g; px[q + 2] = b; px[q + 3] = a; }
      }
      return px;
    },
    posterize: function (px, w, h, p) { var n = Math.max(2, Math.round(p.levels)), st = 255 / (n - 1), t = new Uint8ClampedArray(256); for (var v = 0; v < 256; v++) t[v] = Math.round(Math.floor(v * n / 256) * st); for (var i = 0; i < px.length; i += 4) { px[i] = t[px[i]]; px[i + 1] = t[px[i + 1]]; px[i + 2] = t[px[i + 2]]; } return px; },
    threshold: function (px, w, h, p) { for (var i = 0; i < px.length; i += 4) { var v = px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722 >= p.level ? 255 : 0; px[i] = px[i + 1] = px[i + 2] = v; } return px; },
    solarize: function (px, w, h, p) { for (var i = 0; i < px.length; i += 4) for (var c = 0; c < 3; c++) if (px[i + c] >= p.level) px[i + c] = 255 - px[i + c]; return px; },
    gamma: function (px, w, h, p) { var g = 1 / Math.max(0.01, p.gamma), t = new Uint8ClampedArray(256); for (var v = 0; v < 256; v++) t[v] = Math.pow(v / 255, g) * 255; for (var i = 0; i < px.length; i += 4) { px[i] = t[px[i]]; px[i + 1] = t[px[i + 1]]; px[i + 2] = t[px[i + 2]]; } return px; },
    levels: function (px, w, h, p) {
      var ib = p.inBlack, iw = Math.max(ib + 1, p.inWhite), g = 1 / Math.max(0.01, p.gamma), t = new Uint8ClampedArray(256);
      for (var v = 0; v < 256; v++) t[v] = p.outBlack + Math.pow(clamp((v - ib) / (iw - ib), 0, 1), g) * (p.outWhite - p.outBlack);
      for (var i = 0; i < px.length; i += 4) { px[i] = t[px[i]]; px[i + 1] = t[px[i + 1]]; px[i + 2] = t[px[i + 2]]; }
      return px;
    },
    normalize: function (px, w, h, p) {
      var hs = new Uint32Array(256), n = 0, i;
      for (i = 0; i < px.length; i += 4) { hs[Math.round(px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722)]++; n++; }
      var cut = n * (p.clip || 0) / 100, lo = 0, hi2 = 255, acc = 0;
      for (i = 0; i < 256; i++) { acc += hs[i]; if (acc > cut) { lo = i; break; } }
      for (acc = 0, i = 255; i >= 0; i--) { acc += hs[i]; if (acc > cut) { hi2 = i; break; } }
      if (hi2 <= lo) return px;
      var k = 255 / (hi2 - lo);
      for (i = 0; i < px.length; i += 4) { px[i] = (px[i] - lo) * k; px[i + 1] = (px[i + 1] - lo) * k; px[i + 2] = (px[i + 2] - lo) * k; }
      return px;
    },
    equalize: function (px) {
      for (var c = 0; c < 3; c++) {
        var hs = new Uint32Array(256), n = px.length / 4, i; for (i = c; i < px.length; i += 4) hs[px[i]]++;
        var t = new Uint8ClampedArray(256), acc = 0, min = 0; for (i = 0; i < 256; i++) if (hs[i]) { min = hs[i]; break; }
        for (i = 0; i < 256; i++) { acc += hs[i]; t[i] = n - min > 0 ? Math.round((acc - min) / (n - min) * 255) : i; }
        for (i = c; i < px.length; i += 4) px[i] = t[px[i]];
      }
      return px;
    },
    duotone: function (px, w, h, p) {
      var a = hex(p.dark), b = hex(p.light), k = p.amount / 100;
      for (var i = 0; i < px.length; i += 4) { var l = (px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722) / 255; px[i] += (a[0] + (b[0] - a[0]) * l - px[i]) * k; px[i + 1] += (a[1] + (b[1] - a[1]) * l - px[i + 1]) * k; px[i + 2] += (a[2] + (b[2] - a[2]) * l - px[i + 2]) * k; }
      return px;
    },
    tint: function (px, w, h, p) { var c = hex(p.color), k = p.amount / 100; for (var i = 0; i < px.length; i += 4) { var l = (px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722) / 255; px[i] += (c[0] * l * 1.6 - px[i]) * k; px[i + 1] += (c[1] * l * 1.6 - px[i + 1]) * k; px[i + 2] += (c[2] * l * 1.6 - px[i + 2]) * k; } return px; },
    glow: function (px, w, h, p, env) { var bl = gauss(px, w, h, Math.max(0.5, p.radius * env.k)), k = p.amount / 100; for (var i = 0; i < px.length; i += 4) for (var c = 0; c < 3; c++) { var v = px[i + c], g = bl[i + c] * k; px[i + c] = 255 - (255 - v) * (255 - g) / 255; } return px; },
    chromatic: function (px, w, h, p, env) {
      var d = p.amount * env.k, a = p.angle * Math.PI / 180, dx = Math.round(Math.cos(a) * d), dy = Math.round(Math.sin(a) * d); if (!dx && !dy) return px;
      var src = new Uint8ClampedArray(px);
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var o = (y * w + x) * 4; px[o] = src[(clamp(y + dy, 0, h - 1) * w + clamp(x + dx, 0, w - 1)) * 4]; px[o + 2] = src[(clamp(y - dy, 0, h - 1) * w + clamp(x - dx, 0, w - 1)) * 4 + 2]; }
      return px;
    },
    halftone: function (px, w, h, p, env) {
      var s = Math.max(2, p.size * env.k), a = p.angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var o = (y * w + x) * 4, l = (px[o] * 0.2126 + px[o + 1] * 0.7152 + px[o + 2] * 0.0722) / 255;
        var rx = x * ca + y * sa, ry = -x * sa + y * ca, fx = (rx / s) % 1, fy = (ry / s) % 1; if (fx < 0) fx += 1; if (fy < 0) fy += 1;
        var dd = Math.sqrt((fx - 0.5) * (fx - 0.5) + (fy - 0.5) * (fy - 0.5)), rad = Math.sqrt(1 - l) * 0.7071, v = clamp((dd - rad) * s + 0.5, 0, 1) * 255;
        px[o] = px[o + 1] = px[o + 2] = v;
      }
      return px;
    },
    emboss: function (px, w, h, p) { var a = p.angle * Math.PI / 180, dx = Math.round(Math.cos(a)), dy = Math.round(Math.sin(a)), k = [0, 0, 0, 0, 0, 0, 0, 0, 0], s = p.strength / 100; k[(1 + dy) * 3 + (1 + dx)] = s; k[(1 - dy) * 3 + (1 - dx)] = -s; return convolve(px, w, h, k, 1, 127.5); },
    edges: function (px, w, h, p) {
      var out = new Uint8ClampedArray(px.length), s = p.strength / 100;
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var o = (y * w + x) * 4, xm = clamp(x - 1, 0, w - 1), xp = clamp(x + 1, 0, w - 1), ym = clamp(y - 1, 0, h - 1) * w, yp = clamp(y + 1, 0, h - 1) * w, yc = y * w;
        for (var c = 0; c < 3; c++) {
          var gx = -px[(ym + xm) * 4 + c] - 2 * px[(yc + xm) * 4 + c] - px[(yp + xm) * 4 + c] + px[(ym + xp) * 4 + c] + 2 * px[(yc + xp) * 4 + c] + px[(yp + xp) * 4 + c];
          var gy = -px[(ym + xm) * 4 + c] - 2 * px[(ym + x) * 4 + c] - px[(ym + xp) * 4 + c] + px[(yp + xm) * 4 + c] + 2 * px[(yp + x) * 4 + c] + px[(yp + xp) * 4 + c];
          var m = Math.sqrt(gx * gx + gy * gy) * s; out[o + c] = p.invert ? 255 - m : m;
        }
        out[o + 3] = px[o + 3];
      }
      return out;
    },
    convolve: function (px, w, h, p) { return convolve(px, w, h, p.kernel, p.divisor || 1, p.bias || 0); },
    colorMatrix: function (px, w, h, p) {
      var m = p.matrix;
      for (var i = 0; i < px.length; i += 4) {
        var r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3];
        px[i] = m[0] * r + m[1] * g + m[2] * b + m[3] * a + m[4] * 255; px[i + 1] = m[5] * r + m[6] * g + m[7] * b + m[8] * a + m[9] * 255;
        px[i + 2] = m[10] * r + m[11] * g + m[12] * b + m[13] * a + m[14] * 255; px[i + 3] = m[15] * r + m[16] * g + m[17] * b + m[18] * a + m[19] * 255;
      }
      return px;
    },
  };
  /* aplica la pila en orden. Los filtros «code» los resuelve quien llama (corren aislados): env.code(f, px, w, h) → px o null si aún no está */
  function applyFilters(img, filters, env) {
    env = Object.assign({ k: 1, masks: {}, seed: 11 }, env || {});
    var w = img.width, h = img.height, px = img.data, pending = false;
    (filters || []).forEach(function (f, idx) {
      if (!f.on) return;
      var out, keep = f.mask && env.masks[f.id] ? new Uint8ClampedArray(px) : null;
      if (f.kind === "code") { out = env.code ? env.code(f, px, w, h) : null; if (!out) { pending = true; return; } }
      else { if (!FX[f.kind] || filterIsIdentity(f)) return; out = FX[f.kind](px, w, h, f, Object.assign({}, env, { seed: (env.seed || 11) + idx * 101 })); }
      if (keep) { var mk = env.masks[f.id]; for (var i = 0; i < out.length; i += 4) { var a = mk[i + 3] / 255; if (a >= 0.999) continue; out[i] = keep[i] + (out[i] - keep[i]) * a; out[i + 1] = keep[i + 1] + (out[i + 1] - keep[i + 1]) * a; out[i + 2] = keep[i + 2] + (out[i + 2] - keep[i + 2]) * a; out[i + 3] = keep[i + 3] + (out[i + 3] - keep[i + 3]) * a; } }
      px = out;
    });
    return { data: px, width: w, height: h, pending: pending };
  }

  /* ═════════════ geometría: de coordenadas de la foto final (0–1) a la fuente orientada, y cómo se mueven las capas al recortar ═════════════ */
  function outSize(sw, sh, geo) { var odd = geo.rot % 2, ow = odd ? sh : sw, oh = odd ? sw : sh; return [Math.max(1, Math.round(ow * geo.crop.w)), Math.max(1, Math.round(oh * geo.crop.h))]; }
  /* al cambiar el recorte de c0 a c1, una caja (en 0–1 del encuadre viejo) sigue pegada a lo que tapaba */
  function reboxForCrop(box, c0, c1) { return { x: (c0.x + box.x * c0.w - c1.x) / c1.w, y: (c0.y + box.y * c0.h - c1.y) / c1.h, w: box.w * c0.w / c1.w, h: box.h * c0.h / c1.h, rot: box.rot || 0 }; }
  function repointForCrop(x, y, c0, c1) { return [(c0.x + x * c0.w - c1.x) / c1.w, (c0.y + y * c0.h - c1.y) / c1.h]; }

  /* ═════════════ cambios por partes (lo usa el MCP y el panel de código): devuelve un documento nuevo y válido ═════════════
     edits: { set: { "recipe.basic.exposure": 12, … }, recipe: {…parche}, source, name,
              addFilters: [...], updateFilters: [{ id, … }], removeFilters: [id], orderFilters: [id…],
              addMasks, updateMasks, removeMasks, addLayers, updateLayers, removeLayers, orderLayers, reset: ["basic", "filters", …] } */
  function deepMerge(t, s) { Object.keys(s).forEach(function (k) { if (isObj(s[k]) && isObj(t[k])) deepMerge(t[k], s[k]); else t[k] = clone(s[k]); }); return t; }
  function setPath(o, path, v) {
    var ks = String(path).split("."), cur = o;
    for (var i = 0; i < ks.length - 1; i++) { var k = ks[i]; if (Array.isArray(cur)) { var hit = cur.filter(function (q) { return q && String(q.id) === k; })[0]; cur = hit || cur[+k]; } else cur = cur[k]; if (cur == null || typeof cur !== "object") throw new Error("No existe «" + ks.slice(0, i + 1).join(".") + "» en la foto"); }
    cur[ks[ks.length - 1]] = v;
  }
  function listEdit(list, add, upd, rem, order, norm, what, max) {
    var out = list.slice(), notes = [];
    (rem || []).forEach(function (id) { var n = out.length; out = out.filter(function (q) { return String(q.id) !== String(id); }); if (out.length === n) throw new Error("No hay " + what + " con id «" + id + "»"); });
    (upd || []).forEach(function (u) {
      var i = -1; out.forEach(function (q, j) { if (String(q.id) === String(u && u.id)) i = j; });
      if (i < 0) throw new Error("No hay " + what + " con id «" + (u && u.id) + "»");
      var merged = deepMerge(clone(out[i]), u), n = norm(merged); if (!n) throw new Error("El cambio deja inválido " + what + " «" + u.id + "»"); out[i] = n;
    });
    (add || []).forEach(function (a) { var n = norm(a); if (!n) throw new Error("No se pudo agregar " + what + ": revisa «kind» y sus datos"); if (out.some(function (q) { return q.id === n.id; })) n.id = uid(what.charAt(0)); out.push(n); notes.push(n.id); });
    if (Array.isArray(order) && order.length) { var by = {}; out.forEach(function (q) { by[q.id] = q; }); var head = order.map(function (id) { return by[String(id)]; }).filter(Boolean), used = {}; head.forEach(function (q) { used[q.id] = 1; }); out = head.concat(out.filter(function (q) { return !used[q.id]; })); }
    if (out.length > max) throw new Error("Máximo " + max + " por foto");
    return { list: out, added: notes };
  }
  function applyEdits(doc, e) {
    var d = normalize(doc), added = {}; e = e || {};
    (e.reset || []).forEach(function (k) {
      if (k === "all") { var s = d.source, n = d.name; d = doc0(); d.source = s; if (n) d.name = n; }
      else if (k === "filters") d.filters = []; else if (k === "layers") d.layers = []; else if (k === "masks") d.recipe.masks = [];
      else if (k === "recipe") { var g = d.recipe.geo; d.recipe = recipe0(); d.recipe.geo = g; }
      else if (recipe0()[k] !== undefined) d.recipe[k] = recipe0()[k];
      else throw new Error("No sé restablecer «" + k + "»");
    });
    if (e.source !== undefined) { var ns = normSource(e.source); if (e.source && !ns) throw new Error("La fuente necesita «url» o «code»"); d.source = ns; }
    if (e.name != null) d.name = String(e.name).slice(0, 160);
    if (isObj(e.recipe)) deepMerge(d.recipe, e.recipe);
    if (isObj(e.set)) Object.keys(e.set).forEach(function (p) { setPath(d, /^(recipe|filters|layers|source|out)\b/.test(p) ? p : "recipe." + p, clone(e.set[p])); });
    if (isObj(e.out)) d.out = Object.assign({}, d.out || {}, e.out);
    var m = listEdit(d.recipe.masks, e.addMasks, e.updateMasks, e.removeMasks, null, normMask, "máscara", MAX_MASKS); d.recipe.masks = m.list; added.masks = m.added;
    var f = listEdit(d.filters, e.addFilters, e.updateFilters, e.removeFilters, e.orderFilters, normFilter, "filtro", MAX_FILTERS); d.filters = f.list; added.filters = f.added;
    var l = listEdit(d.layers, e.addLayers, e.updateLayers, e.removeLayers, e.orderLayers, normLayer, "capa", MAX_LAYERS); d.layers = l.list; added.layers = l.added;
    var out = normalize(d);
    return { doc: out, added: added, changed: !same(out, normalize(doc)) };
  }

  /* ═════════════ mezcla a tres bandas (persona con el editor abierto + IA por MCP a la vez) ═════════════
     Por partes: cada valor de la receta, cada filtro/capa/máscara por id. Si los dos cambiaron lo mismo, gana «mío» y se avisa. */
  function flat(o, pre, out) { out = out || {}; Object.keys(o || {}).forEach(function (k) { var v = o[k], p = pre ? pre + "." + k : k; if (isObj(v) && k !== "curve") flat(v, p, out); else out[p] = v; }); return out; }
  function unflat(f) { var o = {}; Object.keys(f).forEach(function (p) { var ks = p.split("."), c = o; for (var i = 0; i < ks.length - 1; i++) c = c[ks[i]] || (c[ks[i]] = {}); c[ks[ks.length - 1]] = f[p]; }); return o; }
  function mergeFlat(b, m, t, conflicts, label) {
    var out = {}, keys = {}; [b, m, t].forEach(function (o) { Object.keys(o).forEach(function (k) { keys[k] = 1; }); });
    Object.keys(keys).forEach(function (k) {
      var mb = same(m[k], b[k]), tb = same(t[k], b[k]);
      if (mb) out[k] = t[k]; else if (tb || same(m[k], t[k])) out[k] = m[k]; else { out[k] = m[k]; conflicts.push(label + k); }
      if (out[k] === undefined) delete out[k];
    });
    return out;
  }
  function mergeList(b, m, t, conflicts, label) {
    var B = {}, M = {}, T = {}; b.forEach(function (q) { B[q.id] = q; }); m.forEach(function (q) { M[q.id] = q; }); t.forEach(function (q) { T[q.id] = q; });
    var made = {}, ids = {}; [B, M, T].forEach(function (o) { Object.keys(o).forEach(function (k) { ids[k] = 1; }); });
    Object.keys(ids).forEach(function (id) {
      var bb = B[id], mm = M[id], tt = T[id], r;
      if (same(mm, bb)) r = tt; else if (same(tt, bb) || same(mm, tt)) r = mm;
      else if (!mm) { r = tt; conflicts.push(label + id + " (borrado)"); } else if (!tt) { r = mm; conflicts.push(label + id + " (borrado)"); }
      else if (!bb) r = mm;
      else r = unflat(mergeFlat(flat(bb), flat(mm), flat(tt), conflicts, label + id + "."));
      if (r) made[id] = r;
    });
    /* orden: el de «mío» si lo cambié; si no, el de ellos; lo nuevo de la otra parte va al final */
    var mo = m.map(function (q) { return q.id; }), to = t.map(function (q) { return q.id; }), bo = b.map(function (q) { return q.id; });
    var lead = same(mo.filter(function (id) { return B[id]; }), bo.filter(function (id) { return M[id]; })) ? to : mo, other = lead === to ? mo : to, seen = {}, out = [];
    lead.concat(other).forEach(function (id) { if (made[id] && !seen[id]) { seen[id] = 1; out.push(made[id]); } });
    return out;
  }
  function merge3(base, mine, theirs) {
    var b = normalize(base), m = normalize(mine), t = normalize(theirs), conflicts = [], out = doc0();
    var strip = function (r) { var c = clone(r); delete c.masks; return c; };
    out.recipe = unflat(mergeFlat(flat(strip(b.recipe)), flat(strip(m.recipe)), flat(strip(t.recipe)), conflicts, ""));
    out.recipe.masks = mergeList(b.recipe.masks, m.recipe.masks, t.recipe.masks, conflicts, "máscara ");
    out.filters = mergeList(b.filters, m.filters, t.filters, conflicts, "filtro ");
    out.layers = mergeList(b.layers, m.layers, t.layers, conflicts, "capa ");
    out.source = same(m.source, b.source) ? t.source : m.source; if (!same(m.source, b.source) && !same(t.source, b.source) && !same(m.source, t.source)) conflicts.push("fuente");
    var nm = same(m.name, b.name) ? t.name : m.name; if (nm) out.name = nm;
    var ot = same(m.out, b.out) ? t.out : m.out; if (ot) out.out = ot;
    out = normalize(out);
    return { doc: out, conflicts: conflicts, theirs: !same(t, b), mine: !same(m, b) };
  }

  /* ═════════════ puente con la receta antigua de las tools photo_* (shared/photoRecipe.ts) ═════════════ */
  var OPS = ["basic", "white_balance", "color", "hsl", "tone_curve", "color_grading", "detail", "effects", "bw"];
  function toShared(r) {
    r = normRecipe(r);
    var pts = function (a) { var p = a.map(function (q) { return { x: q[0], y: q[1] }; }); return p.length === 2 && p[0].x === 0 && p[0].y === 0 && p[1].x === 255 && p[1].y === 255 ? [] : p; };
    var ops = [
      ["basic", r.basic], ["white_balance", r.wb], ["color", r.color], ["hsl", r.hsl],
      ["tone_curve", { rgb: pts(r.curve.rgb), r: pts(r.curve.r), g: pts(r.curve.g), b: pts(r.curve.b) }],
      ["color_grading", { shadows: r.grade.shadows, midtones: r.grade.midtones, highlights: r.grade.highlights, blend: 50, balance: r.grade.balance }],
      ["detail", r.detail], ["effects", { grain: r.fx.grain, vignetteAmount: r.fx.vignette, vignetteMidpoint: r.fx.mid, vignetteFeather: r.fx.feather }],
      ["bw", { enabled: r.bw.on, mix: { r: r.bw.r, g: r.bw.g, b: r.bw.b } }],
    ].map(function (o) { return { type: o[0], enabled: true, params: clone(o[1]) }; });
    return { schemaVersion: 1, ops: ops, geometry: { crop: clone(r.geo.crop), rotate90: r.geo.rot, flipH: r.geo.flipH, flipV: r.geo.flipV, straighten: r.geo.straighten },
      masks: r.masks.map(function (m) { var o = { id: m.id, kind: m.kind, enabled: m.on, feather: m.feather, invert: m.invert, adjustments: clone(m.adj) }; ["cx", "cy", "rx", "ry", "x1", "y1", "x2", "y2", "lo", "hi", "hue", "range", "src", "name"].forEach(function (k) { if (m[k] != null) o[k] = m[k]; }); if (m.kind === "radial") o.r = m.rx; return o; }) };
  }
  /* una operación «type» de las tools antiguas → parche de la receta nueva */
  function opToPatch(type, p) {
    p = p || {};
    var pts = function (a) { return Array.isArray(a) && a.length ? a.map(function (q) { return Array.isArray(q) ? q : [q.x, q.y]; }) : [[0, 0], [255, 255]]; };
    switch (type) {
      case "basic": return { basic: p };
      case "white_balance": return { wb: p };
      case "color": return { color: p };
      case "hsl": return { hsl: p };
      case "tone_curve": { var c = {}; ["rgb", "r", "g", "b"].forEach(function (k) { if (p[k] != null) c[k] = pts(p[k]); }); return { curve: c }; }
      case "color_grading": { var g = {}; ["shadows", "midtones", "highlights"].forEach(function (k) { if (p[k]) g[k] = p[k]; }); if (p.balance != null) g.balance = p.balance; return { grade: g }; }
      case "detail": return { detail: p };
      case "effects": { var f = {}; if (p.grain != null) f.grain = p.grain; if (p.vignetteAmount != null) f.vignette = p.vignetteAmount; if (p.vignette != null) f.vignette = p.vignette; if (p.vignetteMidpoint != null) f.mid = p.vignetteMidpoint; if (p.vignetteFeather != null) f.feather = p.vignetteFeather; return { fx: f }; }
      case "bw": { var b = {}; if (p.enabled != null) b.on = !!p.enabled; if (p.on != null) b.on = !!p.on; var mx = p.mix || p; ["r", "g", "b"].forEach(function (k) { if (mx[k] != null) b[k] = mx[k]; }); return { bw: b }; }
      case "geometry": { var o = {}; if (p.crop) o.crop = p.crop; if (p.rotate90 != null) o.rot = p.rotate90; if (p.rot != null) o.rot = p.rot; ["flipH", "flipV", "straighten"].forEach(function (k) { if (p[k] != null) o[k] = p[k]; }); return { geo: o }; }
    }
    throw new Error("Operación desconocida: " + type + " (usa " + OPS.join(", ") + " o geometry)");
  }
  var OP_KEY = { basic: "basic", white_balance: "wb", color: "color", hsl: "hsl", tone_curve: "curve", color_grading: "grade", detail: "detail", effects: "fx", bw: "bw", geometry: "geo" };

  return {
    VERSION: VERSION, BANDS: BANDS, RANGE: RANGE, rangeOf: rangeOf, MAX_MASKS: MAX_MASKS, MAX_FILTERS: MAX_FILTERS, MAX_LAYERS: MAX_LAYERS, MASK_KINDS: MASK_KINDS, ADJ0: ADJ0, BLENDS: BLENDS, LAYER_KINDS: LAYER_KINDS, TEXT0: TEXT0, LANGS: LANGS,
    FILTERS: FILTERS, FILTER_EXTRA: FILTER_EXTRA, filterDefaults: filterDefaults, filterIsIdentity: filterIsIdentity, FX: FX,
    recipe0: recipe0, doc0: doc0, normRecipe: normRecipe, normMask: normMask, normFilter: normFilter, normLayer: normLayer, normSource: normSource, normBox: normBox, normalize: normalize,
    recipeEdited: recipeEdited, edited: edited, signature: signature, bitmaps: bitmaps, stable: stable, same: same, clone: clone, uid: uid, hex: hex, toHex: toHex, clamp: clamp, smooth: smooth, rand: rand,
    lut: lut, gauss: gauss, needs: needs, sigmas: sigmas, maskW: maskW, process: process, applyFilters: applyFilters, convolve: convolve,
    outSize: outSize, reboxForCrop: reboxForCrop, repointForCrop: repointForCrop,
    applyEdits: applyEdits, deepMerge: deepMerge, merge3: merge3, toShared: toShared, opToPatch: opToPatch, OP_KEY: OP_KEY, OPS: OPS,
  };
});
