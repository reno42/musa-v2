/* photo-code-lang.js — la foto como código, en los dos sentidos.
 *
 *   toCode(doc)      documento → código «Musa Photo» (JavaScript legible: una línea por ajuste, solo lo que cambió)
 *   parse(text)      código «Musa Photo» o JSON → documento (sin ejecutar nada: se leen literales)
 *   detect(text)     ¿qué es este texto? (Musa, JSON, CSS filter, canvas, sharp, Jimp, PIL/Pillow, OpenCV, ImageMagick,
 *                    filtro SVG, o código que GENERA una imagen: canvas/Three.js/p5/shader/SVG/HTML/Python)
 *   importAny(text)  cualquiera de esos → { doc | patch, notes, missed }
 *        · lo que se entiende queda como ajustes y filtros editables (con su control en el editor);
 *        · lo que es un programa (dibuja o procesa píxeles a mano) queda como FUENTE DE CÓDIGO: corre aislado,
 *          su resultado es la foto y su código sigue editable (cada número con su control).
 *   values / setValue   los números de un código, para darles control deslizante
 *
 * Puro (sin DOM): lo usan el editor de fotos y el servidor MCP.
 */
(function (root, factory) {
  /* en el navegador los módulos cargan en paralelo: si el núcleo aún no llegó, se espera */
  function go(n) {
    var PC = root.MusaPhotoCode && root.MusaPhotoCode.normalize ? root.MusaPhotoCode : null;
    if (!PC && typeof require === "function") { try { PC = require("./photo-code-core.js"); } catch (e) { PC = null; } if (PC && !PC.normalize) PC = root.MusaPhotoCode; }
    if (!PC || !PC.normalize) { if (typeof setTimeout === "function" && (n || 0) < 600) setTimeout(function () { go((n || 0) + 1); }, 50); return; }
    var api = factory(PC);
    if (typeof module === "object" && module && module.exports) module.exports = Object.assign({}, PC, api);
    root.MusaPhotoCode = Object.assign(root.MusaPhotoCode || {}, api);
  }
  go(0);
})(typeof globalThis !== "undefined" ? globalThis : this, function (PC) {
  "use strict";
  var isObj = function (o) { return !!o && typeof o === "object" && !Array.isArray(o); };
  var clamp = PC.clamp, clone = PC.clone;

  /* ═════════════ lector de literales (JSON relajado: llaves sin comillas, comillas simples, plantillas, comas finales) ═════════════ */
  function Reader(s, i) { this.s = String(s); this.i = i || 0; }
  Reader.prototype.err = function (msg, at) {
    var p = at == null ? this.i : at, pre = this.s.slice(0, p), line = pre.split("\n").length, col = p - pre.lastIndexOf("\n");
    var e = new Error("Línea " + line + ": " + msg); e.line = line; e.col = col; e.pos = p; return e;
  };
  Reader.prototype.ws = function () {
    var s = this.s;
    for (;;) {
      var c = s.charCodeAt(this.i);
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 160 || c === 65279) { this.i++; continue; }
      if (c === 47 && s.charCodeAt(this.i + 1) === 47) { var n = s.indexOf("\n", this.i); this.i = n < 0 ? s.length : n; continue; }
      if (c === 47 && s.charCodeAt(this.i + 1) === 42) { var e = s.indexOf("*/", this.i + 2); if (e < 0) throw this.err("comentario sin cerrar"); this.i = e + 2; continue; }
      return;
    }
  };
  Reader.prototype.peek = function () { this.ws(); return this.s.charAt(this.i); };
  Reader.prototype.eof = function () { this.ws(); return this.i >= this.s.length; };
  Reader.prototype.ident = function () { var m = /^[A-Za-z_$][\w$]*/.exec(this.s.slice(this.i, this.i + 80)); if (!m) return null; this.i += m[0].length; return m[0]; };
  Reader.prototype.str = function () {
    var s = this.s, q = s.charAt(this.i), out = "", at = this.i; this.i++;
    for (;;) {
      if (this.i >= s.length) throw this.err("texto sin cerrar", at);
      var c = s.charAt(this.i++);
      if (c === q) return out;
      if (c === "\\") {
        var n = s.charAt(this.i++);
        if (n === "n") out += "\n"; else if (n === "t") out += "\t"; else if (n === "r") out += "\r"; else if (n === "b") out += "\b"; else if (n === "0") out += "\0";
        else if (n === "u") { var h = /^\{([0-9a-fA-F]+)\}|^[0-9a-fA-F]{4}/.exec(s.slice(this.i, this.i + 10)); if (!h) throw this.err("escape \\u inválido"); out += String.fromCodePoint(parseInt(h[1] || h[0], 16)); this.i += h[0].length; }
        else if (n === "x") { out += String.fromCharCode(parseInt(s.slice(this.i, this.i + 2), 16)); this.i += 2; }
        else if (n === "\r") { if (s.charAt(this.i) === "\n") this.i++; } else if (n === "\n") { /* continuación de línea */ }
        else out += n;
        continue;
      }
      if (q === "`" && c === "$" && s.charAt(this.i) === "{") throw this.err("dentro de una plantilla no se permiten expresiones ${…}: escribe \\${ si es texto");
      if (q !== "`" && c === "\n") throw this.err("texto sin cerrar", at);
      out += c;
    }
  };
  Reader.prototype.value = function () {
    this.ws();
    var s = this.s, c = s.charAt(this.i), at = this.i;
    if (c === "{") {
      this.i++; var o = {};
      for (;;) {
        if (this.peek() === "}") { this.i++; return o; }
        var k, ch = s.charAt(this.i);
        if (ch === '"' || ch === "'" || ch === "`") k = this.str(); else { k = this.ident(); if (k == null) { var nm = /^-?\d+(\.\d+)?/.exec(s.slice(this.i, this.i + 30)); if (!nm) throw this.err("esperaba el nombre de un valor"); k = nm[0]; this.i += k.length; } }
        if (this.peek() !== ":") throw this.err("falta «:» después de «" + k + "»");
        this.i++; o[k] = this.value();
        var d = this.peek(); if (d === ",") { this.i++; continue; } if (d === "}") { this.i++; return o; }
        throw this.err("falta «,» o «}»");
      }
    }
    if (c === "[") {
      this.i++; var a = [];
      for (;;) {
        if (this.peek() === "]") { this.i++; return a; }
        a.push(this.value());
        var d2 = this.peek(); if (d2 === ",") { this.i++; continue; } if (d2 === "]") { this.i++; return a; }
        throw this.err("falta «,» o «]»");
      }
    }
    if (c === '"' || c === "'" || c === "`") return this.str();
    var m = /^[-+]?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/.exec(s.slice(this.i, this.i + 40));
    if (m) { this.i += m[0].length; return /^[-+]?0[xX]/.test(m[0]) ? parseInt(m[0], 16) : parseFloat(m[0]); }
    var id = this.ident();
    if (id === "true") return true; if (id === "false") return false; if (id === "null" || id === "undefined") return null;
    if (id === "Infinity" || id === "NaN") return 0;
    /* función (para filtros de código): se guarda su texto tal cual */
    this.i = at;
    var raw = this.rawExpr();
    if (/^(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/.test(raw)) return raw;
    throw this.err("aquí va un valor (número, texto entre comillas, lista o { … }); encontré «" + raw.slice(0, 24) + "»", at);
  };
  /* expresión cruda hasta la coma o el paréntesis de cierre del nivel actual */
  Reader.prototype.rawExpr = function () {
    var s = this.s, st = this.i, depth = 0;
    while (this.i < s.length) {
      var c = s.charAt(this.i);
      if (c === '"' || c === "'" || c === "`") { var q = c; this.i++; while (this.i < s.length && s.charAt(this.i) !== q) { if (s.charAt(this.i) === "\\") this.i++; this.i++; } this.i++; continue; }
      if (c === "/" && s.charAt(this.i + 1) === "/") { var n = s.indexOf("\n", this.i); this.i = n < 0 ? s.length : n; continue; }
      if (c === "/" && s.charAt(this.i + 1) === "*") { var e = s.indexOf("*/", this.i + 2); this.i = e < 0 ? s.length : e + 2; continue; }
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") { if (!depth) break; depth--; }
      else if (c === "," && !depth) break;
      this.i++;
    }
    return s.slice(st, this.i).trim();
  };
  /* todas las llamadas de un texto, en orden: [{ name, path, args (valores o { raw }) , pos }]. strict: los argumentos deben ser literales */
  function calls(text, strict) {
    var r = new Reader(text), out = [], path = [];
    while (!r.eof()) {
      var c = r.s.charAt(r.i);
      if (c === "." && !/\d/.test(r.s.charAt(r.i + 1))) { r.i++; r.ws(); var id = r.ident(); if (id == null) { if (strict) throw r.err("esperaba un nombre después del punto"); continue; } path.push(id); continue; }
      if (c === "(") {
        var at = r.i; r.i++;
        var args = [];
        if (!path.length) { /* paréntesis suelto: se salta */ r.rawExpr(); if (r.s.charAt(r.i) === ")") r.i++; continue; }
        for (;;) {
          if (r.peek() === ")") { r.i++; break; }
          var save = r.i;
          if (strict) args.push(r.value());
          else { try { args.push(r.value()); var nx = r.peek(); if (nx !== "," && nx !== ")") throw new Error("x"); } catch (e) { r.i = save; args.push({ raw: r.rawExpr() }); } }
          var d = r.peek(); if (d === ",") { r.i++; continue; } if (d === ")") { r.i++; break; }
          if (strict) throw r.err("falta «,» o «)»"); if (r.i >= r.s.length) break; r.i++;
        }
        out.push({ name: path[path.length - 1], path: path.slice(), args: args, pos: at });
        path = [path.join(".") + "()"]; path.chained = true;
        /* lo que sigue encadenado (.x().y()) conserva de dónde viene */
        var nxt = r.peek(); if (nxt !== ".") path = [];
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { if (strict) throw r.err("texto suelto: ¿faltó un paréntesis?"); r.i++; while (r.i < r.s.length && r.s.charAt(r.i) !== c) { if (r.s.charAt(r.i) === "\\") r.i++; r.i++; } r.i++; path = []; continue; }
      var w = r.ident();
      if (w != null) { if (/^(const|let|var|export|default|await|return|new|import|from|async|function)$/.test(w)) { path = []; continue; } path = path.length && r.s.charAt(r.i - w.length - 1) === "." ? path.concat(w) : [w]; continue; }
      if (strict && !/[;=,]/.test(c)) throw r.err("no entiendo «" + c + "»");
      r.i++; path = [];
    }
    return out;
  }

  /* ═════════════ documento → código ═════════════ */
  function fnum(v) { if (typeof v !== "number") return v; var r = Math.round(v * 1e4) / 1e4; return Object.is(r, -0) ? 0 : r; }
  function lit(v, wide) {
    if (v == null) return "null";
    if (typeof v === "number") return String(fnum(v));
    if (typeof v === "boolean") return String(v);
    if (typeof v === "string") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(function (x) { return lit(x); }).join(", ") + "]";
    var ks = Object.keys(v).filter(function (k) { return v[k] !== undefined; });
    if (!ks.length) return "{}";
    return "{ " + ks.map(function (k) { return (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)) + ": " + lit(v[k]); }).join(", ") + " }";
  }
  function tpl(code) { return "`" + String(code).replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`"; }
  /* solo lo que difiere del valor por defecto */
  function diff(v, d) {
    if (isObj(v) && isObj(d)) { var o = {}; Object.keys(v).forEach(function (k) { var x = diff(v[k], d[k]); if (x !== undefined) o[k] = x; }); return Object.keys(o).length ? o : undefined; }
    return PC.same(v, d) ? undefined : v;
  }
  var LANG_FN = { js: "code", html: "html", svg: "svg", py: "python", glsl: "shader" };
  function toCode(doc, opt) {
    var d = PC.normalize(doc), r = d.recipe, r0 = PC.recipe0(), L = [], s = d.source;
    opt = opt || {};
    if (!opt.bare) L.push("// Musa Photo · este código ES la foto. Edítalo aquí o mueve los controles del editor: es lo mismo.");
    if (!s) L.push("photo()");
    else if (s.kind === "url") L.push("photo(" + JSON.stringify(s.url) + ")");
    else {
      var so = { width: s.w, height: s.h }; if (s.t) so.time = s.t; if (s.input) so.input = s.input; if (s.capture) so.capture = s.capture; if (s.transparent) so.transparent = true;
      L.push("photo." + LANG_FN[s.lang] + "(" + lit(so) + ", " + tpl(s.code) + ")");
    }
    if (d.name) L.push("  .name(" + JSON.stringify(d.name) + ")");
    var g = r.geo, g0 = r0.geo;
    if (!PC.same(g.crop, g0.crop)) L.push("  .crop(" + lit(g.crop) + ")");
    if (g.rot) L.push("  .rotate(" + g.rot * 90 + ")");
    if (g.flipH || g.flipV) L.push("  .flip(" + JSON.stringify(g.flipH && g.flipV ? "both" : g.flipH ? "h" : "v") + ")");
    if (g.straighten) L.push("  .straighten(" + fnum(g.straighten) + ")");
    if (g.persp) L.push("  .perspective(" + lit(g.persp) + ")");
    if (g.bg) L.push("  .background(" + JSON.stringify(g.bg) + ")");
    [["light", "basic"], ["whiteBalance", "wb"], ["color", "color"], ["hsl", "hsl"], ["grade", "grade"], ["detail", "detail"], ["effects", "fx"]].forEach(function (p) { var x = diff(r[p[1]], r0[p[1]]); if (x) L.push("  ." + p[0] + "(" + lit(x) + ")"); });
    var cv = diff(r.curve, r0.curve); if (cv) L.push("  .curve(" + lit(cv) + ")");
    if (r.bw.on) { var bx = diff({ r: r.bw.r, g: r.bw.g, b: r.bw.b }, { r: 100, g: 100, b: 100 }); L.push("  .blackWhite(" + (bx ? lit(bx) : "") + ")"); }
    r.masks.forEach(function (m) {
      var shape = { id: m.id }; ["name", "cx", "cy", "rx", "ry", "x1", "y1", "x2", "y2", "lo", "hi", "hue", "range", "src"].forEach(function (k) { if (m[k] != null) shape[k] = m[k]; });
      if (m.feather !== 0.5) shape.feather = m.feather; if (m.invert) shape.invert = true; if (!m.on) shape.on = false;
      L.push("  .mask(" + JSON.stringify(m.kind) + ", " + lit(shape) + ", " + lit(diff(m.adj, PC.ADJ0) || {}) + ")");
    });
    d.filters.forEach(function (f) {
      var p = { id: f.id }, F = PC.FILTERS[f.kind], code = null;
      F.params.forEach(function (q) { if (q[6] === "code") code = f[q[0]]; else p[q[0]] = f[q[0]]; });
      var ex = PC.FILTER_EXTRA[f.kind]; if (ex) Object.keys(ex).forEach(function (k) { if (f[k]) p[k] = f[k]; });
      if (f.values && Object.keys(f.values).length) p.values = f.values;
      if (f.name) p.name = f.name; if (f.mask) p.mask = f.mask; if (!f.on) p.on = false;
      L.push("  .filter(" + JSON.stringify(f.kind) + ", " + lit(p) + (code != null ? ", " + tpl(code) : "") + ")");
    });
    d.layers.forEach(function (y) {
      var c = { id: y.id }; if (y.name) c.name = y.name;
      var tail = {}; if (y.op !== 100) tail.opacity = y.op; if (y.blend !== "normal") tail.blend = y.blend; if (!y.vis) tail.visible = false; if (y.lock) tail.lock = true; if (y.mask) tail.mask = y.mask;
      var box = function (b, d0) { var x = diff(b, d0); return x || {}; };
      if (y.kind === "text") { var t = Object.assign({}, diff(y.text, Object.assign({}, PC.TEXT0, { s: y.text.s })) || {}); delete t.s; L.push("  .text(" + JSON.stringify(y.text.s) + ", " + lit(Object.assign(c, { x: y.text.x, y: y.text.y, size: y.text.size, color: y.text.color, font: y.text.font }, t, tail)) + ")"); }
      else if (y.kind === "image") L.push("  .image(" + JSON.stringify(y.src) + ", " + lit(Object.assign(c, { x: y.box.x, y: y.box.y, w: y.box.w, h: y.box.h }, y.box.rot ? { rot: y.box.rot } : {}, y.fit ? { fit: y.fit } : {}, tail)) + ")");
      else if (y.kind === "shape") { var sh = y.shape, so2 = { fill: sh.fill }; if (sh.stroke !== "none") { so2.stroke = sh.stroke; so2.sw = sh.sw; } if (sh.radius) so2.radius = sh.radius; if (sh.pts) { so2.pts = sh.pts; if (sh.type !== "line" && !sh.closed) so2.closed = false; if (sh.smooth) so2.smooth = true; } L.push("  .shape(" + JSON.stringify(sh.type) + ", " + lit(Object.assign(c, y.box ? { x: y.box.x, y: y.box.y, w: y.box.w, h: y.box.h } : {}, y.box && y.box.rot ? { rot: y.box.rot } : {}, so2, tail)) + ")"); }
      else L.push("  .paint(" + (y.src ? JSON.stringify(y.src) : "null") + ", " + lit(Object.assign(c, y.pre ? { pre: true } : {}, box(y.box, { x: 0, y: 0, w: 1, h: 1, rot: 0 }), tail)) + ")");
    });
    (d.slices || []).forEach(function (s) { L.push("  .slice(" + lit(s) + ")"); });
    if (d.samplers && d.samplers.length) L.push("  .samplers(" + lit(d.samplers) + ")");
    if (d.out) L.push("  .output(" + lit(d.out) + ")");
    return L.join("\n") + (opt.bare ? "" : "\n");
  }
  function toJSON(doc) { return JSON.stringify(PC.normalize(doc), null, 2) + "\n"; }

  /* ═════════════ código → documento ═════════════ */
  var FN_LANG = { code: "js", canvas: "js", js: "js", three: "js", p5: "js", html: "html", svg: "svg", python: "py", py: "py", shader: "glsl", glsl: "glsl" };
  var RECIPE_FN = { light: "basic", basic: "basic", tone: "basic", whiteBalance: "wb", wb: "wb", color: "color", hsl: "hsl", grade: "grade", colorGrade: "grade", grading: "grade", detail: "detail", effects: "fx", fx: "fx" };
  function pickLayerTail(o, y) {
    if (o.opacity != null) y.op = o.opacity; if (o.op != null) y.op = o.op; if (o.blend != null) y.blend = o.blend; if (o.visible != null) y.vis = !!o.visible; if (o.vis != null) y.vis = !!o.vis;
    if (o.lock) y.lock = true; if (o.mask) y.mask = o.mask; if (o.name != null) y.name = o.name; if (o.id != null) y.id = String(o.id);
    return y;
  }
  function interpret(cs, prev) {
    var d = PC.doc0(), started = false, extra = [];
    var need = function (c, i, type, what) { var v = c.args[i]; if (type === "obj" ? !isObj(v) : typeof v !== type) throw new Error("." + c.name + "(): " + what); return v; };
    cs.forEach(function (c) {
      var n = c.name, a = c.args, p0 = c.path[0];
      if (!started) {
        if (p0 !== "photo" && p0 !== "foto" && n !== "photo") throw new Error("El código empieza con photo(\"https://…\") o photo.code(…)");
        started = true;
        if (n === "photo" || n === "foto") {
          if (a[0] == null) d.source = null;
          else if (typeof a[0] === "string") d.source = { kind: "url", url: a[0] };
          else if (isObj(a[0])) { d.source = a[0].code ? Object.assign({ kind: "code" }, a[0]) : { kind: "url", url: a[0].url || a[0].src }; if (a[0].name) d.name = a[0].name; }
          else throw new Error("photo(): pon la dirección de la imagen entre comillas");
          return;
        }
        if (FN_LANG[n]) {
          var o = isObj(a[0]) ? a[0] : {}, code = typeof a[a.length - 1] === "string" ? a[a.length - 1] : o.code;
          if (typeof code !== "string") throw new Error("photo." + n + "(): falta el código entre comillas invertidas ` … `");
          d.source = { kind: "code", lang: FN_LANG[n], code: code, w: o.width || o.w, h: o.height || o.h, t: o.time || o.t, input: o.input, capture: o.capture, transparent: o.transparent };
          return;
        }
        throw new Error("No conozco photo." + n + "(): usa photo(url), photo.code, photo.html, photo.svg, photo.python o photo.shader");
      }
      if (n === "name") { d.name = String(need(c, 0, "string", "pon el nombre entre comillas")); return; }
      if (n === "crop") { var cr = need(c, 0, "obj", "usa { x, y, w, h } de 0 a 1"); d.recipe.geo.crop = cr; return; }
      if (n === "rotate") { var deg = +a[0]; if (!isFinite(deg)) throw new Error(".rotate(): pon los grados"); if (deg % 90 === 0) d.recipe.geo.rot = (((deg / 90) % 4) + 4) % 4; else if (Math.abs(deg) <= 45) d.recipe.geo.straighten = deg; else { var q = Math.round(deg / 90); d.recipe.geo.rot = ((q % 4) + 4) % 4; d.recipe.geo.straighten = deg - q * 90; } return; }
      if (n === "flip") { var f = String(a[0] == null ? "h" : a[0]).toLowerCase(); d.recipe.geo.flipH = /^(h|x|horizontal|both|hv)/.test(f); d.recipe.geo.flipV = /^(v|y|vertical|both)|hv$/.test(f); return; }
      if (n === "flipH" || n === "flop" || n === "mirror") { d.recipe.geo.flipH = a[0] !== false; return; }
      if (n === "flipV") { d.recipe.geo.flipV = a[0] !== false; return; }
      if (n === "straighten") { d.recipe.geo.straighten = +a[0] || 0; return; }
      if (n === "perspective") { if (a[0] == null || a[0] === false) { delete d.recipe.geo.persp; return; } if (!Array.isArray(a[0]) || a[0].length !== 4) throw new Error(".perspective(): pon las 4 esquinas [[x, y], …] de 0 a 1 (arriba-izq, arriba-der, abajo-der, abajo-izq)"); d.recipe.geo.persp = a[0]; return; }
      if (n === "background" || n === "canvasColor") { d.recipe.geo.bg = a[0] == null ? undefined : String(a[0]); return; }
      if (n === "slice") { if (!isObj(a[0])) throw new Error(".slice(): usa { x, y, w, h } de 0 a 1"); (d.slices = d.slices || []).push(a[0]); return; }
      if (n === "grid") { var rows = Math.max(1, Math.min(8, Math.round(+a[0] || 1))), cols = Math.max(1, Math.min(8, Math.round(+a[1] || 1))); d.slices = d.slices || []; for (var gy = 0; gy < rows; gy++) for (var gx = 0; gx < cols; gx++) d.slices.push({ x: gx / cols, y: gy / rows, w: 1 / cols, h: 1 / rows }); return; }
      if (n === "samplers" || n === "sampler") { if (n === "samplers") d.samplers = Array.isArray(a[0]) ? a[0] : []; else (d.samplers = d.samplers || []).push(Array.isArray(a[0]) ? a[0] : [a[0], a[1]]); return; }
      if (RECIPE_FN[n]) { PC.deepMerge(d.recipe[RECIPE_FN[n]], need(c, 0, "obj", "usa { nombre: valor }")); return; }
      if (n === "curve" || n === "curves") { if (Array.isArray(a[0])) d.recipe.curve.rgb = a[0]; else if (typeof a[0] === "string" && Array.isArray(a[1])) d.recipe.curve[a[0]] = a[1]; else PC.deepMerge(d.recipe.curve, need(c, 0, "obj", "usa { rgb: [[0, 0], [128, 140], [255, 255]] }")); return; }
      if (n === "blackWhite" || n === "bw" || n === "grayscaleMix") { if (a[0] === false) { d.recipe.bw.on = false; return; } d.recipe.bw.on = true; if (isObj(a[0])) PC.deepMerge(d.recipe.bw, a[0]); d.recipe.bw.on = !(isObj(a[0]) && a[0].on === false); return; }
      if (n === "mask") { var mk = typeof a[0] === "string" ? Object.assign({ kind: a[0] }, isObj(a[1]) ? a[1] : {}, { adj: isObj(a[2]) ? a[2] : (isObj(a[1]) && a[1].adj) || {} }) : isObj(a[0]) ? a[0] : null; if (!mk || PC.MASK_KINDS.indexOf(mk.kind) < 0) throw new Error(".mask(): el tipo es " + PC.MASK_KINDS.join(", ")); d.recipe.masks.push(mk); return; }
      if (n === "filter" || PC.FILTERS[n]) {
        var kind = n === "filter" ? a[0] : n, fp = n === "filter" ? a[1] : a[0], rest = n === "filter" ? a[2] : a[1];
        if (!PC.FILTERS[kind]) throw new Error(".filter(): no existe el filtro «" + kind + "». Hay: " + Object.keys(PC.FILTERS).join(", "));
        var fo = Object.assign({ kind: kind }, isObj(fp) ? fp : {});
        if (!isObj(fp) && fp != null && typeof fp !== "string") { var first = PC.FILTERS[kind].params[0]; if (first) fo[first[0]] = fp; }
        if (kind === "code") { var cd = typeof rest === "string" ? rest : typeof fp === "string" ? fp : fo.code; if (typeof cd !== "string") throw new Error(".filter(\"code\"): falta la función entre comillas invertidas"); fo.code = cd; }
        d.filters.push(fo); return;
      }
      if (n === "text") { var to = isObj(a[1]) ? a[1] : isObj(a[0]) ? a[0] : {}, tx = typeof a[0] === "string" ? a[0] : to.text != null ? to.text : to.s; d.layers.push(pickLayerTail(to, { kind: "text", text: Object.assign({}, to, { s: tx == null ? "Texto" : String(tx) }) })); return; }
      if (n === "image") { var io = isObj(a[1]) ? a[1] : isObj(a[0]) ? a[0] : {}, src = typeof a[0] === "string" ? a[0] : io.src || io.url; if (!src) throw new Error(".image(): pon la dirección de la imagen"); d.layers.push(pickLayerTail(io, { kind: "image", src: src, box: io, fit: io.fit })); return; }
      if (n === "shape") { var sp = isObj(a[1]) ? a[1] : isObj(a[0]) ? a[0] : {}, ty = typeof a[0] === "string" ? a[0] : sp.type; d.layers.push(pickLayerTail(sp, { kind: "shape", box: sp, shape: Object.assign({}, sp, { type: ty }) })); return; }
      if (n === "paint") { var po = isObj(a[1]) ? a[1] : isObj(a[0]) ? a[0] : {}, ps = typeof a[0] === "string" ? a[0] : po.src; d.layers.push(pickLayerTail(po, { kind: "paint", src: ps || undefined, pre: !!po.pre, box: po })); return; }
      if (n === "layer") { var lk = typeof a[0] === "string" ? a[0] : (a[0] || {}).kind, lo = isObj(a[1]) ? a[1] : isObj(a[0]) ? a[0] : {}; if (PC.LAYER_KINDS.indexOf(lk) < 0) throw new Error(".layer(): el tipo es " + PC.LAYER_KINDS.join(", ")); d.layers.push(pickLayerTail(lo, Object.assign({}, lo, { kind: lk, text: lk === "text" ? Object.assign({}, lo, lo.text || {}) : undefined, shape: lk === "shape" ? Object.assign({}, lo, lo.shape || {}) : undefined, box: lo.box || lo }))); return; }
      if (n === "output" || n === "size" || n === "export") { d.out = isObj(a[0]) ? a[0] : { maxW: +a[0] || undefined }; return; }
      if (/^(toFile|toBuffer|save|write|then|catch|jpeg|png|webp|toBlob|toDataURL)$/.test(n)) return;
      extra.push(n);
    });
    if (!started) throw new Error("El código empieza con photo(\"https://…\") o photo.code(…)");
    if (extra.length) throw new Error("No conozco ." + extra[0] + "(). Ajustes: " + Object.keys(RECIPE_FN).filter(function (k, i, a) { return ["basic", "tone", "wb", "colorGrade", "grading", "fx"].indexOf(k) < 0; }).join(", ") + ", curve, blackWhite, crop, rotate, flip, straighten, perspective, background, mask, filter, text, image, shape, paint, slice, grid, samplers");
    var out = PC.normalize(d);
    return prev ? reconcile(prev, out) : out;
  }
  /* quien escribe a mano no pone ids: se conservan los del documento anterior por posición y tipo (así no se pierden los píxeles ni la selección) */
  function reconcile(prev, next) {
    var p = PC.normalize(prev);
    var fix = function (olds, news, key) {
      var used = {}; news.forEach(function (n) { if (olds.some(function (o) { return o.id === n.id; })) used[n.id] = 1; });
      news.forEach(function (n) {
        if (used[n.id]) return;
        var cand = olds.filter(function (o) { return !used[o.id] && o[key] === n[key]; })[0];
        if (cand) { used[cand.id] = 1; n.id = cand.id; if (cand.src && !n.src && (n.kind === "paint" || n.kind === "brush")) n.src = cand.src; }
      });
    };
    fix(p.recipe.masks, next.recipe.masks, "kind"); fix(p.filters, next.filters, "kind"); fix(p.layers, next.layers, "kind"); if (p.slices && next.slices) fix(p.slices, next.slices, "_");
    return PC.normalize(next);
  }
  function parse(text, prev) {
    var s = String(text || "").replace(/^\uFEFF/, "");
    if (/^\s*[{[]/.test(s)) { var j; try { j = JSON.parse(s); } catch (e) { try { j = new Reader(s).value(); } catch (e2) { throw new Error("JSON inválido: " + e2.message); } } if (!isObj(j)) throw new Error("El JSON de la foto es un objeto { source, recipe, filters, layers }"); var out = PC.normalize(j); return prev ? reconcile(prev, out) : out; }
    return interpret(calls(s, true), prev);
  }

  /* ═════════════ otros dialectos → ajustes editables ═════════════ */
  function R() { return { filters: [], geo: {}, notes: [], missed: [], url: null, cropPx: null, resize: null }; }
  function addF(r, kind, p) { r.filters.push(Object.assign({ kind: kind }, p || {})); }
  function pct(v, def) { v = String(v == null ? "" : v).trim(); if (!v) return def; return /%$/.test(v) ? parseFloat(v) : parseFloat(v) * 100; }
  function angle(v) { v = String(v).trim(); var n = parseFloat(v); if (/rad$/.test(v)) return n * 180 / Math.PI; if (/turn$/.test(v)) return n * 360; if (/grad$/.test(v)) return n * 0.9; return n; }
  function norm180(a) { a = ((a % 360) + 360) % 360; return a > 180 ? a - 360 : a; }
  function len(v) { v = String(v).trim(); var n = parseFloat(v); if (/r?em$/.test(v)) return n * 16; return n; }
  function geoRotate(r, deg) {
    deg = ((deg % 360) + 360) % 360;
    if (deg % 90 === 0) r.geo.rot = ((r.geo.rot || 0) + deg / 90) % 4;
    else { var q = Math.round(deg / 90), rest = deg - q * 90; r.geo.rot = ((r.geo.rot || 0) + q) % 4; r.geo.straighten = clamp((r.geo.straighten || 0) + rest, -45, 45); }
  }
  function cssFilterList(val, r) {
    var re = /([a-z-]+)\(((?:[^()]|\([^()]*\))*)\)/gi, m, n = 0;
    while ((m = re.exec(val))) {
      var f = m[1].toLowerCase(), a = m[2].trim(); n++;
      if (f === "brightness") addF(r, "brightness", { amount: pct(a, 100) });
      else if (f === "contrast") addF(r, "contrast", { amount: pct(a, 100) });
      else if (f === "saturate") addF(r, "saturate", { amount: pct(a, 100) });
      else if (f === "grayscale") addF(r, "grayscale", { amount: pct(a, 100) });
      else if (f === "sepia") addF(r, "sepia", { amount: pct(a, 100) });
      else if (f === "invert") addF(r, "invert", { amount: pct(a, 100) });
      else if (f === "opacity") addF(r, "opacity", { amount: pct(a, 100) });
      else if (f === "hue-rotate") addF(r, "hueRotate", { angle: norm180(angle(a || "0")) });
      else if (f === "blur") addF(r, "blur", { radius: len(a || "0") });
      else if (f === "drop-shadow") r.missed.push("drop-shadow(" + a + "): una sombra es de la capa, no de la foto — agrégala en el editor de diseño");
      else if (f === "url") r.missed.push("filter: url(" + a + "): pega también el <filter> SVG al que apunta");
      else { n--; }
    }
    return n;
  }
  function importCss(text) {
    var r = R(), s = String(text), m, found = 0;
    var re = /(?:^|[\s;{"'])(?:-webkit-)?filter\s*:\s*([^;}"']+)/gi;
    while ((m = re.exec(s))) if (!/backdrop-$/.test(s.slice(Math.max(0, m.index - 9), m.index + 1))) found += cssFilterList(m[1], r);
    var rj = /\.filter\s*=\s*(["'`])([^"'`]+)\1/g; while ((m = rj.exec(s))) found += cssFilterList(m[2], r);
    if (!found && /^[\s\w\-().,%]+$/.test(s)) found += cssFilterList(s, r);
    if ((m = /(?:^|[\s;{"'])opacity\s*:\s*([\d.]+%?)/i.exec(s))) { var op = pct(m[1], 100); if (op < 100) addF(r, "opacity", { amount: op }); }
    if ((m = /transform\s*:\s*([^;}"']+)/i.exec(s))) {
      var t = m[1], q;
      if ((q = /rotate\(\s*(-?[\d.]+(?:deg|rad|turn|grad)?)\s*\)/i.exec(t))) geoRotate(r, angle(q[1]));
      if (/scaleX\(\s*-1\s*\)|scale\(\s*-1\s*,\s*1\s*\)/i.test(t)) r.geo.flipH = true;
      if (/scaleY\(\s*-1\s*\)|scale\(\s*1\s*,\s*-1\s*\)/i.test(t)) r.geo.flipV = true;
    }
    if ((m = /clip-path\s*:\s*inset\(\s*([\d.]+)%(?:\s+([\d.]+)%)?(?:\s+([\d.]+)%)?(?:\s+([\d.]+)%)?/i.exec(s))) {
      var tp = +m[1], rt = m[2] != null ? +m[2] : tp, bt = m[3] != null ? +m[3] : tp, lf = m[4] != null ? +m[4] : rt;
      r.geo.crop = { x: lf / 100, y: tp / 100, w: Math.max(0.01, 1 - (lf + rt) / 100), h: Math.max(0.01, 1 - (tp + bt) / 100) };
    }
    r.url = firstUrl(s);
    return r;
  }
  function firstUrl(s) {
    var m = /<img[^>]+src\s*=\s*["']([^"']+)["']/i.exec(s) || /url\(\s*["']?(https?:[^)"']+)["']?\s*\)/i.exec(s) || /\.src\s*=\s*["'](https?:[^"']+)["']/i.exec(s) || /(?:href|xlink:href)\s*=\s*["'](https?:[^"']+\.(?:jpe?g|png|webp|avif|gif)[^"']*)["']/i.exec(s) || /["'`](https?:\/\/[^"'`\s]+\.(?:jpe?g|png|webp|avif|gif)(?:\?[^"'`\s]*)?)["'`]/i.exec(s);
    return m ? m[1] : null;
  }
  function numArg(a) { if (typeof a === "number") return a; if (a && a.raw != null) { var n = parseFloat(a.raw); return isFinite(n) && /^[-+]?[\d.]+(e[-+]?\d+)?$/i.test(a.raw.trim()) ? n : NaN; } return NaN; }
  function flatNums(a) { if (Array.isArray(a)) return [].concat.apply([], a.map(flatNums)); return typeof a === "number" ? [a] : []; }
  function kernelF(r, k, div, bias, label) {
    var f = flatNums(k);
    if (f.length !== 9 && f.length !== 25) { r.missed.push(label + ": solo se convierten matrices de 3×3 o 5×5"); return; }
    addF(r, "convolve", { kernel: f, divisor: div || 1, bias: bias || 0 });
  }
  /* sharp (Node) */
  function importSharp(text) {
    var r = R(), cs = calls(text, false), on = false;
    cs.forEach(function (c) {
      var n = c.name, a = c.args, v = numArg(a[0]);
      if (n === "sharp") { on = true; if (typeof a[0] === "string" && /^https?:/.test(a[0])) r.url = a[0]; return; }
      if (!on) return;
      if (n === "resize") { var w = isObj(a[0]) ? a[0].width : v, h = isObj(a[0]) ? a[0].height : numArg(a[1]); r.resize = { w: w > 0 ? w : null, h: h > 0 ? h : null }; }
      else if (n === "rotate") { if (isFinite(v)) geoRotate(r, v); else r.notes.push("rotate() sin ángulo usa la orientación EXIF: Musa ya muestra la foto derecha"); }
      else if (n === "flip") r.geo.flipV = !r.geo.flipV;
      else if (n === "flop") r.geo.flipH = !r.geo.flipH;
      else if (n === "blur") addF(r, "blur", { radius: isFinite(v) ? v : 1 });
      else if (n === "sharpen") { var sg = isObj(a[0]) ? +a[0].sigma : v; addF(r, "unsharp", { amount: 100, radius: isFinite(sg) ? sg : 1 }); }
      else if (n === "gamma") addF(r, "gamma", { gamma: isFinite(v) ? v : 2.2 });
      else if (n === "negate") addF(r, "invert", { amount: 100 });
      else if (n === "normalize" || n === "normalise") addF(r, "normalize", { clip: 1 });
      else if (n === "grayscale" || n === "greyscale") { if (a[0] !== false) addF(r, "grayscale", { amount: 100 }); }
      else if (n === "threshold") addF(r, "threshold", { level: isFinite(v) ? v : 128 });
      else if (n === "tint") { if (typeof a[0] === "string") addF(r, "tint", { color: a[0], amount: 100 }); else if (isObj(a[0])) addF(r, "tint", { color: PC.toHex([a[0].r || 0, a[0].g || 0, a[0].b || 0]), amount: 100 }); else r.missed.push("tint(): no entendí el color"); }
      else if (n === "modulate" && isObj(a[0])) { var o = a[0]; if (o.brightness != null) addF(r, "brightness", { amount: o.brightness * 100 }); if (o.saturation != null) addF(r, "saturate", { amount: o.saturation * 100 }); if (o.hue != null) addF(r, "hueRotate", { angle: norm180(o.hue) }); if (o.lightness != null) addF(r, "colorMatrix", { matrix: [1, 0, 0, 0, o.lightness / 100, 0, 1, 0, 0, o.lightness / 100, 0, 0, 1, 0, o.lightness / 100, 0, 0, 0, 1, 0] }); }
      else if (n === "linear") { var A = isFinite(v) ? v : 1, B = isFinite(numArg(a[1])) ? numArg(a[1]) : 0; addF(r, "colorMatrix", { matrix: [A, 0, 0, 0, B / 255, 0, A, 0, 0, B / 255, 0, 0, A, 0, B / 255, 0, 0, 0, 1, 0] }); }
      else if (n === "recomb" && Array.isArray(a[0])) addF(r, "colorMatrix", { matrix: flatNums(a[0]) });
      else if (n === "convolve" && isObj(a[0])) kernelF(r, a[0].kernel, a[0].scale, a[0].offset, "convolve()");
      else if (n === "extract" && isObj(a[0])) r.cropPx = { x: a[0].left || 0, y: a[0].top || 0, w: a[0].width, h: a[0].height };
      else if (n === "median") r.missed.push("median(): no tiene equivalente exacto; usa «Reducción de ruido» en Detalle");
      else if (/^(composite|joinChannel|extractChannel|removeAlpha|ensureAlpha|flatten|trim|extend|affine|clahe|boolean|bandbool|unflatten|dilate|erode)$/.test(n)) r.missed.push(n + "()");
    });
    return r;
  }
  /* Jimp */
  function importJimp(text) {
    var r = R(), cs = calls(text, false);
    cs.forEach(function (c) {
      var n = c.name, a = c.args, v = numArg(a[0]);
      if (n === "read" && typeof a[0] === "string" && /^https?:/.test(a[0])) r.url = a[0];
      else if (n === "brightness" && isFinite(v)) { if (v <= 0) addF(r, "brightness", { amount: (1 + v) * 100 }); else addF(r, "colorMatrix", { matrix: [1 - v, 0, 0, 0, v, 0, 1 - v, 0, 0, v, 0, 0, 1 - v, 0, v, 0, 0, 0, 1, 0] }); }
      else if (n === "contrast" && isFinite(v)) addF(r, "contrast", { amount: clamp((v + 1) / Math.max(0.01, 1 - v), 0, 3) * 100 });
      else if (n === "greyscale" || n === "grayscale") addF(r, "grayscale", { amount: 100, weights: "601" });
      else if (n === "invert") addF(r, "invert", { amount: 100 });
      else if (n === "sepia") addF(r, "sepia", { amount: 100 });
      else if ((n === "blur" || n === "gaussian") && isFinite(v)) addF(r, "blur", { radius: n === "blur" ? v / 2 : v });
      else if (n === "posterize" && isFinite(v)) addF(r, "posterize", { levels: v });
      else if (n === "pixelate" && isFinite(v)) addF(r, "pixelate", { size: v });
      else if ((n === "opacity" || n === "fade") && isFinite(v)) addF(r, "opacity", { amount: (n === "fade" ? 1 - v : v) * 100 });
      else if (n === "rotate" && isFinite(v)) geoRotate(r, -v);
      else if (n === "flip" || n === "mirror") { if (a[0] === true) r.geo.flipH = !r.geo.flipH; if (a[1] === true) r.geo.flipV = !r.geo.flipV; }
      else if (n === "crop" && a.length >= 4) r.cropPx = { x: numArg(a[0]), y: numArg(a[1]), w: numArg(a[2]), h: numArg(a[3]) };
      else if (n === "resize" || n === "scaleToFit" || n === "cover" || n === "contain") r.resize = { w: v > 0 ? v : null, h: numArg(a[1]) > 0 ? numArg(a[1]) : null };
      else if (n === "normalize") addF(r, "normalize", { clip: 0 });
      else if (n === "convolute" && Array.isArray(a[0])) kernelF(r, a[0], 1, 0, "convolute()");
      else if (n === "threshold" && isObj(a[0])) addF(r, "threshold", { level: a[0].max != null ? a[0].max : 128 });
      else if (n === "color" && Array.isArray(a[0])) a[0].forEach(function (o) {
        var p = (o.params || [])[0];
        if (o.apply === "hue" || o.apply === "spin") addF(r, "hueRotate", { angle: norm180(+p || 0) });
        else if (o.apply === "saturate") addF(r, "saturate", { amount: 100 + (+p || 0) }); else if (o.apply === "desaturate") addF(r, "saturate", { amount: 100 - (+p || 0) });
        else if (o.apply === "lighten" || o.apply === "brighten") addF(r, "brightness", { amount: 100 + (+p || 0) }); else if (o.apply === "darken") addF(r, "brightness", { amount: 100 - (+p || 0) });
        else if (o.apply === "greyscale") addF(r, "grayscale", { amount: 100 });
        else if (o.apply === "tint") addF(r, "tint", { color: "#ffffff", amount: +p || 0 }); else if (o.apply === "shade") addF(r, "brightness", { amount: 100 - (+p || 0) });
        else r.missed.push("color(" + o.apply + ")");
      });
      else if (/^(dither565|dither16|composite|blit|mask|displace|fisheye|circle|shadow|print|background)$/.test(n)) r.missed.push(n + "()");
    });
    return r;
  }
  /* ── Python: Pillow y OpenCV (se leen las llamadas; no se ejecuta) ── */
  var PIL_KERNELS = {
    BLUR: [[1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1], 16, 0], CONTOUR: [[-1, -1, -1, -1, 8, -1, -1, -1, -1], 1, 255], DETAIL: [[0, -1, 0, -1, 10, -1, 0, -1, 0], 6, 0],
    EDGE_ENHANCE: [[-1, -1, -1, -1, 10, -1, -1, -1, -1], 2, 0], EDGE_ENHANCE_MORE: [[-1, -1, -1, -1, 9, -1, -1, -1, -1], 1, 0], EMBOSS: [[-1, 0, 0, 0, 1, 0, 0, 0, 0], 1, 128], FIND_EDGES: [[-1, -1, -1, -1, 8, -1, -1, -1, -1], 1, 0],
    SHARPEN: [[-2, -2, -2, -2, 32, -2, -2, -2, -2], 16, 0], SMOOTH: [[1, 1, 1, 1, 5, 1, 1, 1, 1], 13, 0], SMOOTH_MORE: [[1, 1, 1, 1, 1, 1, 5, 5, 5, 1, 1, 5, 44, 5, 1, 1, 5, 5, 5, 1, 1, 1, 1, 1, 1], 100, 0],
  };
  function pyNums(s) { return (String(s).match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || []).map(Number); }
  /* quita comentarios y junta líneas partidas dentro de paréntesis */
  function pyStatements(text) {
    var out = [], cur = "", depth = 0;
    String(text).split(/\r?\n/).forEach(function (line) {
      var l = "", q = null;
      for (var i = 0; i < line.length; i++) { var c = line.charAt(i); if (q) { l += c; if (c === "\\") { l += line.charAt(++i) || ""; continue; } if (c === q) q = null; continue; } if (c === '"' || c === "'") { q = c; l += c; continue; } if (c === "#") break; if (c === "(" || c === "[" || c === "{") depth++; if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1); l += c; }
      cur += (cur ? " " : "") + l.trim();
      if (!depth && !/\\$/.test(cur)) { if (cur.trim()) out.push(cur.trim()); cur = ""; } else cur = cur.replace(/\\$/, "");
    });
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  function importPython(text) {
    var r = R(), sts = pyStatements(text), unknown = 0, known = 0, kernels = {};
    sts.forEach(function (st) {
      var m, hit = false, T = function (re) { m = re.exec(st); return !!m; };
      if (/^(import|from)\s/.test(st) || /^(print|plt\.show|cv2\.waitKey|cv2\.destroyAllWindows|cv2\.imshow)\b/.test(st) || /\.(save|show)\(/.test(st) && !/=/.test(st.split("(")[0]) || /cv2\.imwrite\(/.test(st)) return;
      if (T(/(?:Image\.open|cv2\.imread)\(\s*["']([^"']+)["']/)) { if (/^https?:/.test(m[1])) r.url = m[1]; hit = true; }
      if (T(/(\w+)\s*=\s*(?:np|numpy)\.array\(\s*(\[[\s\S]*\])\s*(?:,[^)]*)?\)\s*(?:\/\s*([\d.]+))?/)) { kernels[m[1]] = { k: pyNums(m[2]), div: m[3] ? +m[3] : 1 }; hit = true; }
      var re = /ImageEnhance\.(Brightness|Contrast|Color|Sharpness)\([^)]*\)\.enhance\(\s*([-\d.eE]+)\s*\)/g;
      while ((m = re.exec(st))) { var f = +m[2]; hit = true; if (m[1] === "Brightness") addF(r, "brightness", { amount: f * 100 }); else if (m[1] === "Contrast") addF(r, "contrast", { amount: f * 100, pivot: "mean" }); else if (m[1] === "Color") addF(r, "saturate", { amount: f * 100, weights: "601" }); else { if (f >= 1) addF(r, "unsharp", { amount: (f - 1) * 100, radius: 1 }); else addF(r, "blur", { radius: (1 - f) * 1.2 }); r.notes.push("Sharpness(" + f + ") quedó como " + (f >= 1 ? "máscara de enfoque" : "desenfoque") + " equivalente"); } }
      re = /ImageFilter\.(GaussianBlur|BoxBlur|UnsharpMask|MedianFilter|MinFilter|MaxFilter|ModeFilter|RankFilter|Kernel|[A-Z_]{4,})\b(?:\(([^)]*)\))?/g;
      while ((m = re.exec(st))) {
        var nm = m[1], ar = m[2] || "", ns = pyNums(ar); hit = true;
        if (nm === "GaussianBlur") addF(r, "blur", { radius: ns.length ? ns[0] : 2 });
        else if (nm === "BoxBlur") addF(r, "blur", { radius: (ns[0] || 1) * 0.58 });
        else if (nm === "UnsharpMask") { var g = function (k, i, d) { var q = new RegExp(k + "\\s*=\\s*(-?[\\d.]+)").exec(ar); return q ? +q[1] : ns[i] != null && !/=/.test(ar) ? ns[i] : d; }; addF(r, "unsharp", { radius: g("radius", 0, 2), amount: g("percent", 1, 150), threshold: g("threshold", 2, 3) }); }
        else if (nm === "Kernel") { var size = /\(\s*(\d)\s*,\s*(\d)\s*\)/.exec(ar), rest = ar.replace(/\(\s*\d\s*,\s*\d\s*\)/, ""), list = /\[([^\]]*)\]|\(([^)]*)\)/.exec(rest), sc = /scale\s*=\s*([-\d.]+)/.exec(ar), of = /offset\s*=\s*([-\d.]+)/.exec(ar), kk = list ? pyNums(list[1] || list[2]) : []; var sum = kk.reduce(function (a, b) { return a + b; }, 0); if (size && kk.length) kernelF(r, kk, sc ? +sc[1] : sum || 1, of ? +of[1] : 0, "ImageFilter.Kernel"); else r.missed.push("ImageFilter.Kernel: no pude leer la matriz"); }
        else if (PIL_KERNELS[nm]) { var K = PIL_KERNELS[nm]; addF(r, "convolve", { kernel: K[0], divisor: K[1], bias: K[2] }); }
        else { r.missed.push("ImageFilter." + nm); unknown++; }
      }
      if (T(/ImageOps\.grayscale\(/) || T(/\.convert\(\s*["']L["']\s*\)/)) { addF(r, "grayscale", { amount: 100, weights: "601" }); hit = true; }
      if (T(/ImageOps\.invert\(/) || T(/cv2\.bitwise_not\(/)) { addF(r, "invert", { amount: 100 }); hit = true; }
      if (T(/ImageOps\.autocontrast\(([^)]*)\)/)) { var cu = /cutoff\s*=\s*([\d.]+)/.exec(m[1]); addF(r, "normalize", { clip: cu ? +cu[1] : 0 }); hit = true; }
      if (T(/ImageOps\.equalize\(/) || T(/cv2\.equalizeHist\(/)) { addF(r, "equalize", {}); hit = true; }
      if (T(/ImageOps\.posterize\([^,]+,\s*(\d+)\s*\)/)) { addF(r, "posterize", { levels: Math.pow(2, +m[1]) }); hit = true; }
      if (T(/ImageOps\.solarize\([^,)]+(?:,\s*(?:threshold\s*=\s*)?(\d+))?\s*\)/)) { addF(r, "solarize", { level: m[1] != null ? +m[1] : 128 }); hit = true; }
      if (T(/ImageOps\.mirror\(/) || T(/transpose\(\s*(?:Image\.)?(?:Transpose\.)?FLIP_LEFT_RIGHT\s*\)/)) { r.geo.flipH = !r.geo.flipH; hit = true; }
      if (T(/ImageOps\.flip\(/) || T(/transpose\(\s*(?:Image\.)?(?:Transpose\.)?FLIP_TOP_BOTTOM\s*\)/)) { r.geo.flipV = !r.geo.flipV; hit = true; }
      if (T(/transpose\(\s*(?:Image\.)?(?:Transpose\.)?ROTATE_(90|180|270)\s*\)/)) { geoRotate(r, -(+m[1])); hit = true; }
      if (T(/ImageOps\.colorize\([^,]+,\s*(?:black\s*=\s*)?["']([^"']+)["']\s*,\s*(?:white\s*=\s*)?["']([^"']+)["']/)) { addF(r, "duotone", { dark: m[1], light: m[2], amount: 100 }); hit = true; }
      if (T(/\.rotate\(\s*(-?[\d.]+)/) && !/cv2\.rotate/.test(st)) { geoRotate(r, -(+m[1])); hit = true; }
      if (T(/\.crop\(\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)\s*\)/)) { r.cropPx = { x: +m[1], y: +m[2], w: +m[3] - +m[1], h: +m[4] - +m[2] }; hit = true; }
      if (T(/\.(?:resize|thumbnail)\(\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/) || T(/cv2\.resize\([^,]+,\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/)) { r.resize = { w: +m[1], h: +m[2] }; hit = true; }
      if (T(/\.point\(\s*lambda\s+(\w+)\s*:\s*([^)]+)\)/)) {
        var v = m[1], ex = m[2].trim(), q;
        if ((q = new RegExp("^" + v + "\\s*\\*\\s*([\\d.]+)$").exec(ex))) addF(r, "brightness", { amount: +q[1] * 100 });
        else if ((q = new RegExp("^255\\s*-\\s*" + v + "$").exec(ex))) addF(r, "invert", { amount: 100 });
        else if ((q = new RegExp("^(?:255\\s+if\\s+" + v + "\\s*>=?\\s*(\\d+)\\s+else\\s+0|" + v + "\\s*>=?\\s*(\\d+)\\s+and\\s+255)$").exec(ex))) addF(r, "threshold", { level: +(q[1] || q[2]) });
        else if ((q = new RegExp("^" + v + "\\s*\\+\\s*(-?[\\d.]+)$").exec(ex))) addF(r, "colorMatrix", { matrix: [1, 0, 0, 0, +q[1] / 255, 0, 1, 0, 0, +q[1] / 255, 0, 0, 1, 0, +q[1] / 255, 0, 0, 0, 1, 0] });
        else { r.missed.push("point(lambda " + v + ": " + ex + ")"); unknown++; }
        hit = true;
      }
      /* OpenCV */
      if (T(/cv2\.GaussianBlur\([^,]+,\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)\s*,\s*(?:sigmaX\s*=\s*)?([\d.]+)/)) { var sg = +m[3] || (0.3 * ((+m[1] - 1) * 0.5 - 1) + 0.8); addF(r, "blur", { radius: sg }); hit = true; }
      if (T(/cv2\.blur\([^,]+,\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/)) { addF(r, "blur", { radius: +m[1] / 3.46 }); hit = true; }
      if (T(/cv2\.cvtColor\([^,]+,\s*cv2\.COLOR_(?:BGR|RGB)2GRAY\s*\)/)) { addF(r, "grayscale", { amount: 100, weights: "601" }); hit = true; }
      if (T(/cv2\.cvtColor\([^,]+,\s*cv2\.COLOR_(?:BGR2RGB|RGB2BGR|GRAY2BGR|GRAY2RGB|BGRA2BGR|BGR2BGRA)\s*\)/)) hit = true;
      if (T(/cv2\.convertScaleAbs\(([^)]*)\)/)) { var al = /alpha\s*=\s*(-?[\d.]+)/.exec(m[1]), be = /beta\s*=\s*(-?[\d.]+)/.exec(m[1]), A = al ? +al[1] : 1, Bq = be ? +be[1] : 0; addF(r, "colorMatrix", { matrix: [A, 0, 0, 0, Bq / 255, 0, A, 0, 0, Bq / 255, 0, 0, A, 0, Bq / 255, 0, 0, 0, 1, 0] }); hit = true; }
      if (T(/cv2\.flip\([^,]+,\s*(-?\d)\s*\)/)) { if (+m[1] === 0) r.geo.flipV = !r.geo.flipV; else if (+m[1] > 0) r.geo.flipH = !r.geo.flipH; else { r.geo.flipH = !r.geo.flipH; r.geo.flipV = !r.geo.flipV; } hit = true; }
      if (T(/cv2\.rotate\([^,]+,\s*cv2\.ROTATE_(90_CLOCKWISE|180|90_COUNTERCLOCKWISE)\s*\)/)) { geoRotate(r, m[1] === "180" ? 180 : m[1] === "90_CLOCKWISE" ? 90 : 270); hit = true; }
      if (T(/cv2\.threshold\([^,]+,\s*([\d.]+)\s*,\s*[\d.]+\s*,\s*cv2\.THRESH_BINARY(_INV)?\s*\)/)) { addF(r, "threshold", { level: +m[1] }); if (m[2]) addF(r, "invert", { amount: 100 }); hit = true; }
      if (T(/cv2\.filter2D\([^,]+,\s*-?\d+\s*,\s*(\w+)\s*\)/)) { var K2 = kernels[m[1]]; if (K2) kernelF(r, K2.k, K2.div, 0, "filter2D"); else { r.missed.push("cv2.filter2D: no encontré la matriz «" + m[1] + "»"); unknown++; } hit = true; }
      if (T(/cv2\.(medianBlur|bilateralFilter|Canny|Laplacian|Sobel|erode|dilate|morphologyEx|addWeighted|warpAffine|warpPerspective|inRange|applyColorMap|detailEnhance|stylization|pencilSketch|fastNlMeansDenoisingColored|LUT|merge|split|adaptiveThreshold|findContours|drawContours|putText|rectangle|circle|line)\(/)) { r.missed.push("cv2." + m[1]); unknown++; hit = true; }
      if (hit) known++; else if (/[=(]/.test(st) && !/^\s*(if|for|while|def|class|with|try|except|return|else|elif)\b/.test(st)) { /* una línea que no se reconoce y que hace algo */ if (/\b(img|image|im|frame|arr|pixels?|np|numpy|draw|ImageDraw|ImageChops|plt|fig|ax)\b/.test(st)) { unknown++; r.missed.push(st.slice(0, 70)); } }
      else if (/^\s*(for|while|def)\b/.test(st)) { unknown++; r.missed.push(st.slice(0, 70)); }
    });
    r.complete = known > 0 && unknown === 0;
    return r;
  }
  /* ImageMagick (convert / magick / mogrify) */
  function importMagick(text) {
    var r = R(), s = String(text).replace(/\\\r?\n/g, " "), tok = [], m, re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    while ((m = re.exec(s))) tok.push(m[1] != null ? m[1] : m[2] != null ? m[2] : m[3]);
    for (var i = 0; i < tok.length; i++) {
      var t = tok[i], a = tok[i + 1] || "", n = parseFloat(a), used = true;
      if (/^https?:\/\//.test(t) && !r.url) { r.url = t; continue; }
      if (t.charAt(0) !== "-" && t.charAt(0) !== "+") continue;
      var o = t.replace(/^[-+]+/, "").toLowerCase();
      if (o === "brightness-contrast") { var bc = a.split(/x/i), b = parseFloat(bc[0]) || 0, c = parseFloat(bc[1]) || 0; if (b) addF(r, "colorMatrix", { matrix: [1, 0, 0, 0, b / 200, 0, 1, 0, 0, b / 200, 0, 0, 1, 0, b / 200, 0, 0, 0, 1, 0] }); if (c) addF(r, "contrast", { amount: clamp(100 + c * 1.5, 0, 300) }); if (b || c) r.notes.push("-brightness-contrast usa una curva propia de ImageMagick: quedó el equivalente más cercano"); }
      else if (o === "modulate") { var q = a.split(","); if (q[0] && +q[0] !== 100) addF(r, "brightness", { amount: +q[0] }); if (q[1] && +q[1] !== 100) addF(r, "saturate", { amount: +q[1] }); if (q[2] && +q[2] !== 100) addF(r, "hueRotate", { angle: norm180((+q[2] - 100) * 1.8) }); }
      else if (o === "blur" || o === "gaussian-blur") { var sg = a.split(/x/i); addF(r, "blur", { radius: parseFloat(sg[1] != null ? sg[1] : sg[0]) || 1 }); }
      else if (o === "sharpen") { var ss = a.split(/x/i); addF(r, "unsharp", { amount: 100, radius: parseFloat(ss[1] != null ? ss[1] : ss[0]) || 1 }); }
      else if (o === "unsharp") { var u = /([\d.]+)x([\d.]+)(?:\+([\d.]+))?(?:\+([\d.]+))?/.exec(a) || []; addF(r, "unsharp", { radius: +u[2] || 1, amount: (u[3] != null ? +u[3] : 1) * 100, threshold: (u[4] != null ? +u[4] : 0.05) * 255 }); }
      else if (o === "negate") { addF(r, "invert", { amount: 100 }); used = false; }
      else if (o === "grayscale") addF(r, "grayscale", { amount: 100, weights: /709/.test(a) ? undefined : "601" });
      else if (o === "colorspace") { if (/^gray/i.test(a)) addF(r, "grayscale", { amount: 100 }); }
      else if (o === "type" && /grayscale/i.test(a)) addF(r, "grayscale", { amount: 100 });
      else if (o === "sepia-tone") addF(r, "sepia", { amount: clamp(n, 0, 100) });
      else if (o === "threshold") addF(r, "threshold", { level: /%/.test(a) ? n * 2.55 : n > 255 ? n / 257 : n });
      else if (o === "posterize") addF(r, "posterize", { levels: n });
      else if (o === "solarize") addF(r, "solarize", { level: /%/.test(a) ? n * 2.55 : n });
      else if (o === "gamma") addF(r, "gamma", { gamma: n });
      else if (o === "level") { var lv = a.replace(/%/g, "").split(","), pc = /%/.test(a); addF(r, "levels", { inBlack: (pc ? 2.55 : 1) * (+lv[0] || 0), inWhite: lv[1] != null ? (pc ? 2.55 : 1) * +lv[1] : 255, gamma: lv[2] != null ? +lv[2] : 1 }); }
      else if (o === "normalize") { addF(r, "normalize", { clip: 1 }); used = false; }
      else if (o === "auto-level") { addF(r, "normalize", { clip: 0 }); used = false; }
      else if (o === "equalize") { addF(r, "equalize", {}); used = false; }
      else if (o === "rotate") geoRotate(r, n);
      else if (o === "flip") { r.geo.flipV = !r.geo.flipV; used = false; }
      else if (o === "flop") { r.geo.flipH = !r.geo.flipH; used = false; }
      else if (o === "crop") { var cg = /(\d+)x(\d+)(?:\+(\d+)\+(\d+))?/.exec(a); if (cg) r.cropPx = { x: +cg[3] || 0, y: +cg[4] || 0, w: +cg[1], h: +cg[2] }; }
      else if (o === "resize" || o === "scale" || o === "thumbnail" || o === "sample") { var rg = /(\d+)?x?(\d+)?/.exec(a) || []; r.resize = { w: +rg[1] || null, h: +rg[2] || null }; }
      else if (o === "emboss") addF(r, "emboss", { strength: 100 });
      else if (o === "edge") addF(r, "edges", { strength: 100 });
      else if (o === "charcoal") { addF(r, "edges", { strength: 120, invert: 1 }); addF(r, "grayscale", { amount: 100 }); r.notes.push("-charcoal quedó como bordes en gris (aproximado)"); }
      else if (o === "motion-blur") { var mb = /([\d.]+)x([\d.]+)(?:\+(-?[\d.]+))?/.exec(a) || []; addF(r, "motionBlur", { distance: (+mb[2] || 4) * 3, angle: +mb[3] || 0 }); }
      else if (o === "noise" || o === "attenuate") { if (o === "noise") { addF(r, "noise", { amount: 12, mono: 0 }); used = false; if (/^[A-Za-z]/.test(a)) used = true; } }
      else if (o === "vignette") { r.vignette = -40; }
      else if (o === "tint" || o === "colorize") { var fill = tok[tok.indexOf("-fill") + 1]; addF(r, "tint", { color: tok.indexOf("-fill") >= 0 && fill ? fill : "#704214", amount: clamp(n || 50, 0, 100) }); }
      else if (/^(quality|strip|interlace|density|depth|format|path|fill|background|gravity|define|set|compress|sampling-factor|alpha|write|units|profile|limit|monitor|verbose|auto-orient)$/.test(o)) { if (/^(strip|auto-orient|verbose|monitor)$/.test(o)) used = false; }
      else { r.missed.push(t + (a && a.charAt(0) !== "-" ? " " + a : "")); used = !!a && a.charAt(0) !== "-"; }
      if (used) i++;
    }
    return r;
  }
  /* filtro SVG: lo que tiene equivalente queda editable; si usa primitivas sin equivalente, el SVG entero corre como código */
  function attr(tag, name) { var m = new RegExp("\\b" + name + "\\s*=\\s*[\"']([^\"']*)[\"']", "i").exec(tag); return m ? m[1] : null; }
  function importSvgFilter(text) {
    var r = R(), s = String(text), m, re = /<(fe[A-Za-z]+)\b([^>]*)>/g, curves = {};
    while ((m = re.exec(s))) {
      var tag = m[1], at = m[2];
      if (tag === "feGaussianBlur") addF(r, "blur", { radius: parseFloat(attr(at, "stdDeviation")) || 0 });
      else if (tag === "feColorMatrix") {
        var ty = attr(at, "type") || "matrix", v = attr(at, "values") || "";
        if (ty === "saturate") addF(r, "saturate", { amount: (parseFloat(v) || 0) * 100 });
        else if (ty === "hueRotate") addF(r, "hueRotate", { angle: norm180(parseFloat(v) || 0) });
        else if (ty === "luminanceToAlpha") r.missed.push("feColorMatrix luminanceToAlpha");
        else { var ns = pyNums(v); if (ns.length === 20) addF(r, "colorMatrix", { matrix: ns }); else r.missed.push("feColorMatrix: la matriz debe tener 20 valores"); }
      }
      else if (/^feFunc[RGB]$/.test(tag)) {
        var ch = tag.slice(-1).toLowerCase(), t2 = attr(at, "type");
        if (t2 === "table" || t2 === "discrete") { var tv = pyNums(attr(at, "tableValues") || ""); if (tv.length >= 2) curves[ch] = tv.map(function (y, i) { return [Math.round(i * 255 / (tv.length - 1)), Math.round(clamp(y, 0, 1) * 255)]; }); }
        else if (t2 === "linear") { curves["lin" + ch] = [parseFloat(attr(at, "slope") || "1"), parseFloat(attr(at, "intercept") || "0")]; }
        else if (t2 === "gamma") { curves["gam" + ch] = [parseFloat(attr(at, "amplitude") || "1"), parseFloat(attr(at, "exponent") || "1"), parseFloat(attr(at, "offset") || "0")]; }
      }
      else if (tag === "feConvolveMatrix") { var km = pyNums(attr(at, "kernelMatrix") || ""), dv = parseFloat(attr(at, "divisor") || "0"); kernelF(r, km, dv || km.reduce(function (a, b) { return a + b; }, 0) || 1, (parseFloat(attr(at, "bias") || "0")) * 255, "feConvolveMatrix"); }
      else if (/^(feComponentTransfer|feFuncA|feMerge|feMergeNode)$/.test(tag)) { /* contenedores */ }
      else r.missed.push("<" + tag + ">");
    }
    if (curves.r || curves.g || curves.b) { r.curve = {}; ["r", "g", "b"].forEach(function (k) { if (curves[k]) r.curve[k] = curves[k]; }); if (curves.r && PC.same(curves.r, curves.g) && PC.same(curves.g, curves.b)) r.curve = { rgb: curves.r }; r.notes.push("Las tablas de feComponentTransfer quedaron como puntos de la Curva de tono"); }
    if (curves.linr || curves.ling || curves.linb) { var L = function (k) { return curves["lin" + k] || [1, 0]; }; addF(r, "colorMatrix", { matrix: [L("r")[0], 0, 0, 0, L("r")[1], 0, L("g")[0], 0, 0, L("g")[1], 0, 0, L("b")[0], 0, L("b")[1], 0, 0, 0, 1, 0] }); }
    if (curves.gamr && curves.gamg && curves.gamb && PC.same(curves.gamr, curves.gamg) && PC.same(curves.gamg, curves.gamb) && curves.gamr[0] === 1 && curves.gamr[2] === 0) addF(r, "gamma", { gamma: 1 / curves.gamr[1] });
    else if (curves.gamr || curves.gamg || curves.gamb) r.missed.push("feFunc gamma distinto por canal");
    r.url = firstUrl(s);
    return r;
  }

  /* ═════════════ ¿qué es este texto? ═════════════ */
  function detect(text) {
    var s = String(text || "").trim();
    if (!s) return { kind: "empty" };
    if (/^[{[]/.test(s)) { try { var j = JSON.parse(s); if (isObj(j) && (j.recipe || j.source || j.filters || j.layers || j.basic || j.geo || j.masks || j.curve)) return { kind: "json" }; } catch (e) { /* no es JSON */ } }
    if (/^(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*(?:(?:const|let|var)\s+\w+\s*=\s*|export\s+default\s+)?(?:photo|foto)\s*(?:\.\s*\w+\s*)?\(/.test(s)) return { kind: "musa" };
    var svg = /<svg[\s>]/i.test(s), html = /<(?:!doctype|html|head|body|script|canvas|div|main|section|style|img|p|h[1-6]|span)\b/i.test(s);
    if (svg && /<filter[\s>]/i.test(s) && !/<(?:path|rect|circle|ellipse|polygon|polyline|text|line|g)\b/i.test(s.replace(/<filter[\s\S]*?<\/filter>/gi, ""))) return { kind: "svgfilter" };
    if (/^\s*<filter[\s>]/i.test(s) || (/^\s*<fe[A-Z]/i.test(s) && !svg)) return { kind: "svgfilter" };
    if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(s) && !/<script[\s>]/i.test(s) && !/<(?:html|body|div|canvas)\b/i.test(s)) return { kind: "gen", lang: "svg" };
    var py = /^\s*(?:from\s+(?:PIL|cv2|numpy|matplotlib|skimage)\b|import\s+(?:PIL|cv2|numpy|matplotlib|skimage)\b)/m.test(s) || /\b(?:Image\.open|Image\.new|ImageEnhance\.|ImageFilter\.|ImageOps\.|ImageDraw\.|cv2\.\w+\(|plt\.\w+\()/.test(s) && !/[{};]\s*$/m.test(s.split("\n").slice(0, 6).join("\n"));
    if (py) return { kind: "python" };
    if (/^\s*(?:magick|convert|mogrify)\s+\S/m.test(s) && /\s-[a-z]/.test(s)) return { kind: "imagemagick" };
    if (/\bsharp\s*\(/.test(s) && /\.\s*(?:toFile|toBuffer|resize|modulate|blur|sharpen|grayscale|greyscale|negate|rotate|tint|png|jpeg|webp)\s*\(/.test(s)) return { kind: "sharp" };
    if (/\bJimp\b|\bjimp\s*\.\s*read\b/.test(s)) return { kind: "jimp" };
    if (/void\s+mainImage\s*\(|gl_FragColor\s*=|^\s*precision\s+(?:lowp|mediump|highp)\s+float/m.test(s) && !/getContext|THREE\.|<script/i.test(s)) return { kind: "gen", lang: "glsl" };
    var draws = /getImageData|putImageData|fillRect|fillText|strokeRect|beginPath|\.arc\(|lineTo|createLinearGradient|createRadialGradient|THREE\.|new\s+p5|createCanvas\s*\(|function\s+(?:setup|draw)\s*\(|requestAnimationFrame|WebGLRenderer|getContext\(\s*["']webgl/.test(s);
    var cssF = /(?:^|[\s;{"'])(?:-webkit-)?filter\s*:\s*[a-z-]+\(|\.filter\s*=\s*["'`][a-z-]+\(/i.test(s) || /^\s*(?:(?:brightness|contrast|saturate|grayscale|sepia|invert|opacity|hue-rotate|blur)\([^)]*\)\s*)+;?\s*$/i.test(s);
    if (cssF && !draws) {
      /* una página entera con contenido propio no es «una foto con filtros»: se dibuja como página */
      var body = s.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<!--[\s\S]*?-->/gi, ""), tags = (body.match(/<(?!\/)(?!img\b|html\b|head\b|body\b|meta\b|link\b|title\b|!doctype)[a-z][^>]*>/gi) || []).length, txt = body.replace(/<[^>]+>/g, "").replace(/[^{}]*\{[^}]*\}/g, "").trim();
      if (!html || (tags <= 3 && txt.length < 40)) return { kind: "css" };
    }
    if (html || svg) return { kind: "gen", lang: "html" };
    if (draws || /\bdocument\.|\bwindow\.|=>|function\s*\(|\bconst\s|\blet\s/.test(s)) return { kind: "gen", lang: "js" };
    if (cssF) return { kind: "css" };
    return { kind: "unknown" };
  }
  var KIND_LABEL = { musa: "Musa Photo", json: "JSON de Musa", css: "CSS (filter)", svgfilter: "filtro SVG", sharp: "sharp (Node)", jimp: "Jimp", python: "Python (Pillow / OpenCV)", imagemagick: "ImageMagick", gen: "código que dibuja" };
  var LANG_LABEL = { js: "JavaScript (canvas, Three.js, p5…)", html: "HTML / CSS", svg: "SVG", py: "Python", glsl: "shader GLSL" };
  /* tamaño que declara el propio código (para no adivinar el lienzo) */
  function sizeHint(code, lang) {
    var s = String(code), m;
    if (lang === "svg") { var w = /<svg[^>]*\bwidth\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(s), h = /<svg[^>]*\bheight\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(s), vb = /<svg[^>]*\bviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s); if (w && h) return [+w[1], +h[1]]; if (vb) { var k = Math.max(1, 1080 / Math.max(+vb[1], +vb[2])); return [Math.round(+vb[1] * k), Math.round(+vb[2] * k)]; } return null; }
    if ((m = /createCanvas\(\s*(\d{2,4})\s*,\s*(\d{2,4})/.exec(s))) return [+m[1], +m[2]];
    if ((m = /<canvas[^>]*\bwidth\s*=\s*["']?(\d{2,4})["']?[^>]*\bheight\s*=\s*["']?(\d{2,4})/i.exec(s))) return [+m[1], +m[2]];
    var cw = /\.width\s*=\s*(\d{2,4})\b/.exec(s), ch = /\.height\s*=\s*(\d{2,4})\b/.exec(s); if (cw && ch) return [+cw[1], +ch[1]];
    if ((m = /Image\.new\(\s*["'][A-Z]+["']\s*,\s*\(\s*(\d{2,4})\s*,\s*(\d{2,4})\s*\)/.exec(s))) return [+m[1], +m[2]];
    if ((m = /figsize\s*=\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/.exec(s))) return [Math.round(+m[1] * 100), Math.round(+m[2] * 100)];
    if ((m = /(?:width|inline-size)\s*:\s*(\d{3,4})px[^}]*?(?:height|block-size)\s*:\s*(\d{3,4})px/.exec(s))) return [+m[1], +m[2]];
    return null;
  }
  /* ¿el programa usa una foto de entrada? (así un script que PROCESA una imagen recibe la que está abierta) */
  function usesInput(code, lang) {
    var s = String(code);
    if (lang === "py") return /Image\.open\(|cv2\.imread\(|plt\.imread\(|imageio\.imread\(/.test(s);
    if (lang === "glsl") return /iChannel0|u_image|u_texture|uTexture|uImage/.test(s);
    return /new\s+Image\s*\(|loadImage\s*\(|<img\b|TextureLoader|createImageBitmap|\bINPUT\b|\bmusaInput\b/.test(s);
  }
  /* aplica el resultado de un importador sobre un documento (o crea uno) */
  function applyImport(doc, r, mode) {
    var d = PC.normalize(doc || PC.doc0());
    if (mode === "replace") { var s = d.source, n = d.name; d = PC.doc0(); d.source = s; if (n) d.name = n; }
    if (r.url && (!d.source || mode === "replace")) d.source = { kind: "url", url: r.url };
    if (r.geo.rot != null) d.recipe.geo.rot = ((d.recipe.geo.rot + r.geo.rot) % 4 + 4) % 4;
    if (r.geo.straighten != null) d.recipe.geo.straighten = clamp(d.recipe.geo.straighten + r.geo.straighten, -45, 45);
    if (r.geo.flipH) d.recipe.geo.flipH = !d.recipe.geo.flipH;
    if (r.geo.flipV) d.recipe.geo.flipV = !d.recipe.geo.flipV;
    if (r.geo.crop) d.recipe.geo.crop = r.geo.crop;
    if (r.cropPx) d._cropPx = r.cropPx;
    if (r.curve) Object.keys(r.curve).forEach(function (k) { d.recipe.curve[k] = r.curve[k]; });
    if (r.vignette) d.recipe.fx.vignette = r.vignette;
    r.filters.forEach(function (f) { d.filters.push(f); });
    if (r.resize && (r.resize.w || r.resize.h)) d.out = Object.assign({}, d.out || {}, { maxW: Math.max(r.resize.w || 0, r.resize.h || 0) });
    var px = d._cropPx, out = PC.normalize(d);
    if (px) out._cropPx = px;
    return out;
  }
  /* un recorte en píxeles se vuelve proporcional cuando ya se sabe el tamaño de la foto */
  function resolveCropPx(doc, sw, sh) {
    var c = doc._cropPx; if (!c || !(sw > 0 && sh > 0)) return doc;
    var d = PC.clone(doc); delete d._cropPx;
    var odd = d.recipe.geo.rot % 2, ow = odd ? sh : sw, oh = odd ? sw : sh;
    d.recipe.geo.crop = { x: clamp(c.x / ow, 0, 0.99), y: clamp(c.y / oh, 0, 0.99), w: clamp(c.w / ow, 0.01, 1), h: clamp(c.h / oh, 0.01, 1) };
    return PC.normalize(d);
  }
  /* cualquier texto → { kind, label, doc?, source?, notes, missed, mode }
     mode: "doc" (documento completo: reemplaza), "adjust" (ajustes y filtros: se suman a la foto abierta), "source" (código que genera la imagen) */
  function importAny(text, cur) {
    var k = detect(text), s = String(text || ""), r, out = { kind: k.kind, label: KIND_LABEL[k.kind] || "código", notes: [], missed: [] };
    if (k.kind === "empty" || k.kind === "unknown") throw new Error(k.kind === "empty" ? "Pega un código primero" : "No reconozco este código. Sirve: código de Musa Photo, CSS filter, canvas / Three.js / p5 / shader, SVG, HTML, Python (Pillow, OpenCV, matplotlib), sharp, Jimp o ImageMagick");
    if (k.kind === "musa" || k.kind === "json") { out.doc = parse(s, cur); out.mode = "doc"; return out; }
    if (k.kind === "gen") { out.mode = "source"; out.lang = k.lang; out.label = LANG_LABEL[k.lang]; var sz = sizeHint(s, k.lang) || [1080, 1080]; out.source = PC.normSource({ kind: "code", lang: k.lang, code: s, w: sz[0], h: sz[1], input: usesInput(s, k.lang) && cur && cur.source && cur.source.kind === "url" ? cur.source.url : undefined }); return out; }
    if (k.kind === "css") r = importCss(s);
    else if (k.kind === "svgfilter") r = importSvgFilter(s);
    else if (k.kind === "sharp") r = importSharp(s);
    else if (k.kind === "jimp") r = importJimp(s);
    else if (k.kind === "imagemagick") r = importMagick(s);
    else if (k.kind === "python") {
      r = importPython(s);
      /* un script que hace algo que no es una cadena de ajustes (dibuja, recorre píxeles, usa numpy…) corre tal cual */
      if (!r.complete) { out.mode = "source"; out.lang = "py"; out.label = LANG_LABEL.py; var ps = sizeHint(s, "py") || [1080, 1080]; out.source = PC.normSource({ kind: "code", lang: "py", code: s, w: ps[0], h: ps[1], input: usesInput(s, "py") && cur && cur.source && cur.source.kind === "url" ? cur.source.url : undefined }); if (r.filters.length) out.notes.push("El script hace cosas que no son ajustes simples (" + r.missed.slice(0, 3).join("; ") + "): corre completo como código y su resultado es la foto"); return out; }
    }
    /* un SVG con primitivas sin equivalente se dibuja tal cual (exacto) en vez de aproximarlo */
    if (k.kind === "svgfilter" && r.missed.length && /<svg[\s>]/i.test(s)) { out.mode = "source"; out.lang = "svg"; out.label = LANG_LABEL.svg; var ss = sizeHint(s, "svg") || [1080, 1080]; out.source = PC.normSource({ kind: "code", lang: "svg", code: s, w: ss[0], h: ss[1] }); out.notes.push("El filtro usa " + r.missed.slice(0, 4).join(", ") + ": se dibuja el SVG completo para que quede idéntico"); return out; }
    if (!r.filters.length && !Object.keys(r.geo).length && !r.cropPx && !r.curve && !r.url && !r.resize) throw new Error("Leí el código (" + out.label + ") pero no encontré ajustes de imagen" + (r.missed.length ? ". No tienen equivalente: " + r.missed.slice(0, 4).join(", ") : ""));
    out.mode = "adjust"; out.notes = r.notes; out.missed = r.missed; out.count = r.filters.length + Object.keys(r.geo).length + (r.cropPx ? 1 : 0) + (r.curve ? 1 : 0);
    out.url = r.url; out.doc = applyImport(cur, r, "merge"); out.result = r;
    return out;
  }

  /* ═════════════ los números de un código (para Python, SVG y shaders; para JS/HTML el editor usa el lector del código vivo) ═════════════ */
  function values(code, lang) {
    var s = String(code || ""), out = [], i = 0, n = s.length, py = lang === "py", glsl = lang === "glsl", ml = lang === "svg" || lang === "html";
    var push = function (a, e) {
      var raw = s.slice(a, e), v = parseFloat(raw); if (!isFinite(v)) return;
      var ls = s.lastIndexOf("\n", a - 1) + 1, le = s.indexOf("\n", e); if (le < 0) le = n;
      var before = s.slice(Math.max(ls, a - 40), a), nm = /([A-Za-z_][\w.-]*)\s*(?:=|:|\()\s*["']?[^A-Za-z]*$/.exec(before) || /([A-Za-z_][\w.-]*)[^A-Za-z]*$/.exec(before);
      var dec = (raw.split(".")[1] || "").replace(/e.*$/i, "").length, mag = Math.abs(v);
      out.push({ i: out.length, s: a, e: e, value: v, label: (nm ? nm[1] : "valor").slice(-28), line: s.slice(0, a).split("\n").length, snippet: s.slice(ls, le).trim().slice(0, 90),
        min: v < 0 ? Math.min(v * 3, -1) : 0, max: mag <= 1 && dec ? Math.max(1, v * 3) : Math.max(mag * 3, 10), step: dec ? Math.pow(10, -Math.min(dec, 4)) : 1, int: !dec });
    };
    while (i < n && out.length < 80) {
      var c = s.charAt(i);
      if (!ml && (c === '"' || c === "'" || c === "`")) { var q = c; if (py && s.substr(i, 3) === q + q + q) { var e3 = s.indexOf(q + q + q, i + 3); i = e3 < 0 ? n : e3 + 3; continue; } i++; while (i < n && s.charAt(i) !== q) { if (s.charAt(i) === "\\") i++; if (!py && q !== "`" && s.charAt(i) === "\n") break; i++; } i++; continue; }
      if (py && c === "#") { var nl = s.indexOf("\n", i); i = nl < 0 ? n : nl; continue; }
      if (!py && !ml && c === "/" && s.charAt(i + 1) === "/") { var n2 = s.indexOf("\n", i); i = n2 < 0 ? n : n2; continue; }
      if (!py && c === "/" && s.charAt(i + 1) === "*") { var e2 = s.indexOf("*/", i + 2); i = e2 < 0 ? n : e2 + 2; continue; }
      if (ml && s.substr(i, 4) === "<!--") { var e4 = s.indexOf("-->", i + 4); i = e4 < 0 ? n : e4 + 3; continue; }
      if (ml && c === "#" && /^#[0-9a-fA-F]{3,8}\b/.test(s.substr(i, 9))) { i += /^#[0-9a-fA-F]{3,8}/.exec(s.substr(i, 9))[0].length; continue; }
      if (ml && (/^(?:d|points|viewBox|id|class|href|xmlns[\w:]*|xlink:href|src|version|transform|font-family|style)\s*=\s*["']/i.test(s.substr(i, 24)) && /[\s<]/.test(s.charAt(i - 1) || " "))) { var qa = /["']/.exec(s.substr(i, 24)), qi = i + qa.index, qe = s.indexOf(qa[0], qi + 1); i = qe < 0 ? n : qe + 1; continue; }
      if (/[A-Za-z_$]/.test(c)) { var w = /^[A-Za-z_$][\w$]*/.exec(s.substr(i, 60)); i += w[0].length; continue; }
      var m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(s.substr(i, 30));
      if (m) {
        var a = i, e = i + m[0].length, prev = s.charAt(a - 1), neg = prev === "-" && !/[\w)\]]/.test(s.charAt(a - 2) || " ") ;
        i = e;
        if (/[\w$.#]/.test(prev) && prev !== "-") continue;
        if (glsl && /^(?:[uf])?\b/.test(s.charAt(e)) && /[A-Za-z_]/.test(s.charAt(e))) continue;
        if (/[A-Za-z_]/.test(s.charAt(e)) && !/^(?:px|deg|em|rem|%|s|ms|f)\b/.test(s.substr(e, 4))) continue;
        if (/^0x/i.test(s.substr(a, 2))) continue;
        push(neg ? a - 1 : a, e); continue;
      }
      i++;
    }
    return out;
  }
  function setValue(code, lang, idx, v) {
    var vs = values(code, lang), x = vs[idx]; if (!x) return code;
    var t = x.int && Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : String(Math.round(v * 1e4) / 1e4);
    if (lang === "glsl" && !/[.e]/i.test(t) && /\./.test(code.slice(x.s, x.e))) t += ".0";
    return code.slice(0, x.s) + t + code.slice(x.e);
  }

  /* ═════════════ lo que se le cuenta a una IA sobre una foto (lo devuelve el MCP) ═════════════ */
  function describe(doc) {
    var d = PC.normalize(doc), r = d.recipe, r0 = PC.recipe0(), ch = [];
    ["basic", "wb", "color", "hsl", "curve", "grade", "detail", "fx", "bw", "geo"].forEach(function (k) { if (!PC.same(r[k], r0[k])) ch.push(k); });
    return { source: d.source ? (d.source.kind === "url" ? { kind: "url", url: d.source.url } : { kind: "code", lang: d.source.lang, width: d.source.w, height: d.source.h, time: d.source.t, lines: d.source.code.split("\n").length }) : null,
      adjusted: ch, masks: r.masks.map(function (m) { return { id: m.id, kind: m.kind, on: m.on, name: m.name }; }), filters: d.filters.map(function (f) { return { id: f.id, kind: f.kind, on: f.on }; }),
      layers: d.layers.map(function (y) { return { id: y.id, kind: y.kind, name: y.name, visible: y.vis, text: y.text ? y.text.s : undefined }; }),
      perspective: !!r.geo.persp, canvasExtended: r.geo.crop.x < 0 || r.geo.crop.y < 0 || r.geo.crop.x + r.geo.crop.w > 1 || r.geo.crop.y + r.geo.crop.h > 1, background: r.geo.bg || "transparent",
      slices: (d.slices || []).length, samplers: (d.samplers || []).length };
  }

  return { Reader: Reader, calls: calls, toCode: toCode, toJSON: toJSON, parse: parse, reconcile: reconcile, detect: detect, importAny: importAny, importCss: importCss, importSharp: importSharp, importJimp: importJimp, importPython: importPython, importMagick: importMagick, importSvgFilter: importSvgFilter,
    applyImport: applyImport, resolveCropPx: resolveCropPx, sizeHint: sizeHint, usesInput: usesInput, values: values, setValue: setValue, describe: describe, KIND_LABEL: KIND_LABEL, LANG_LABEL: LANG_LABEL, LANG_FN: LANG_FN };
});
