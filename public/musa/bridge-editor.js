/* bridge-editor.js — el editor de diseño de la maqueta abriendo tus diseños reales.
 * Los frames se dibujan con su HTML y CSS originales (se ven igual que en el editor anterior).
 * Cada capa del panel es un elemento real del HTML (data-layer-id): mover, redimensionar, cambiar texto,
 * color o tipografía modifica ese HTML, y se guarda solo en /api/templates/:id.
 */
(function () {
  var RB = window.__musaReal;
  if (!RB || typeof ED === "undefined") return;
  var uid = 0;

  function bridge() { try { return window.parent.__musaBridge; } catch (e) { return null; } }
  function api(url, init) { var b = bridge(); return b ? b.api(url, init) : Promise.reject(new Error("sin puente")); }

  /* la regla .ed-el de la maqueta (position:absolute…) no debe pisar el CSS de tus diseños */
  try {
    [].forEach.call(document.styleSheets, function (sh) {
      var rs; try { rs = sh.cssRules; } catch (e) { return; }
      [].forEach.call(rs, function (r) { if (r.selectorText === ".ed-el") r.selectorText = ".ed-el:not([data-real])"; });
    });
  } catch (e) {}
  var stTop = document.createElement("style");
  stTop.textContent = "#ed .ed-tc{overflow-x:auto;scrollbar-width:none}#ed .ed-tc::-webkit-scrollbar{display:none}"
    + "@media (max-width:1560px){#ed .ed-top .ed-tb{padding:0 7px}#ed .ed-tc .ed-tb .cv{display:none}#ed .ed-name{max-width:190px}}"
    + "@media (max-width:1440px){#edPresent,#ed .ed-tc [data-menu=import],#edComments{font-size:0;gap:0;padding:0 8px}#edPublish{font-size:0}#edPublish::after{content:'Publicar';font-size:13px}}"
    + "@media (max-width:1300px){#ed .ed-name{max-width:140px}#ed .ed-logo{display:none}}";
  document.head.appendChild(stTop);
  var st = document.createElement("style");
  st.textContent = ".mreal.mreal{all:revert;position:absolute;inset:0;display:block}.mreal.mreal :where(*:not(svg):not(svg *):not(img):not(video):not(canvas):not(iframe)){all:revert}.ed-frame>.mreal{position:absolute;inset:0}.ed-world [data-real].ed-el:hover{outline:calc(1.5px / var(--z)) solid rgba(255,94,0,.55)}.ed-world [data-real][contenteditable=true]{outline:calc(2px / var(--z)) solid var(--e-accent);cursor:text}";
  document.head.appendChild(st);

  /* ── CSS de cada frame, encerrado en su frame para que no choque con los demás ──
     El selector se repite 3 veces para ganarle siempre al reseteo de abajo, que a su vez le gana a los
     estilos de la maqueta: así un diseño solo ve su propio CSS (en el editor, miniaturas, Presentar y exportar). */
  function SCOPE(id) { var a = '[data-tf="' + id + '"]'; return a + a + a; }
  function scopeRules(list, sc) {
    return [].map.call(list, function (r) {
      if (r.type === 1) {
        return r.selectorText.split(",").map(function (s) {
          s = s.trim();
          if (/^(:root|html|body)$/.test(s)) return sc;
          return sc + " " + s.replace(/^(:root|html|body)\s+/, "");
        }).join(",") + "{" + r.style.cssText + "}";
      }
      if (r.type === 4) return "@media " + r.conditionText + "{" + scopeRules(r.cssRules, sc) + "}";
      if (r.type === 12) return "@supports " + r.conditionText + "{" + scopeRules(r.cssRules, sc) + "}";
      return r.cssText;
    }).join("\n");
  }
  function scopeCss(css, sc) {
    var imports = [];
    // la URL puede traer «;» adentro (Google Fonts: wght@400;700): se respeta el url(...) o el texto entre comillas
    css = String(css || "").replace(/@import\s+(?:url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)|"[^"]*"|'[^']*')[^;]*;?/g, function (m) { imports.push(/;\s*$/.test(m) ? m : m + ";"); return ""; });
    try { var sh = new CSSStyleSheet(); sh.replaceSync(css); return imports.join("\n") + "\n" + scopeRules(sh.cssRules, sc); }
    catch (e) { return imports.join("\n") + "\n" + css; }
  }

  /* ── limpieza al dibujar: un diseño nunca ejecuta código en Musa ──
     Todo HTML de un frame (guardado, importado, de una IA o de diseños viejos) pasa por DOMPurify antes de
     entrar a la página: sin <script>, on…, javascript:, iframes ni CSS que ejecute. Como se guarda lo que se
     dibuja, al guardar el diseño queda limpio también en la base. Si DOMPurify no cargó, una limpieza propia. */
  var DROP = /^(script|noscript|iframe|frame|frameset|object|embed|applet|base|meta|link|title|template|portal|math|fencedframe)$/i;
  var PURIFY = {
    FORCE_BODY: true, ADD_TAGS: ["style"], ALLOW_DATA_ATTR: true, ALLOW_ARIA_ATTR: true,
    FORBID_TAGS: ["script", "noscript", "iframe", "frame", "frameset", "object", "embed", "applet", "base", "meta", "link", "title", "template", "portal", "math", "form"],
    FORBID_ATTR: ["srcdoc", "formaction", "action", "ping"],
    ADD_ATTR: ["crossorigin", "loading", "decoding", "target", "draggable", "playsinline", "muted", "autoplay", "loop", "poster", "preload", "controls", "xmlns", "xmlns:xlink", "xlink:href", "mask-type", "paint-order", "vector-effect"],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|blob):|#|\/|\.{0,2}\/|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    ADD_DATA_URI_TAGS: ["image", "feImage"],
  };
  function cleanCss(css) {
    return String(css || "")
      .replace(/</g, "\\3c ")
      .replace(/-->/g, "")
      .replace(/expression\s*\(/gi, "x-expression(")
      .replace(/(^|[;{\s])(-moz-binding|behavior)\s*:/gi, "$1x-blocked:")
      .replace(/url\(\s*(['"]?)\s*(?:javascript|vbscript|data:text\/html)[^)]*\)/gi, "none")
      .replace(/@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"([^"]*)"|'([^']*)')[^;]*;?/gi, function (m, a, b, c, d, e) { var href = a || b || c || d || e || ""; return /^https:\/\//i.test(href) ? m : ""; });
  }
  var hooked = false;
  function purify() {
    var P = window.DOMPurify;
    if (!P || !P.sanitize) return null;
    if (!hooked) {
      hooked = true;
      P.addHook("uponSanitizeAttribute", function (node, data) { if (data.attrName === "style") data.attrValue = cleanCss(data.attrValue); });
      P.addHook("uponSanitizeElement", function (node, data) {
        // (DOMPurify ya quita <animate>/<set> de SVG; el CSS de los <style> se limpia aquí)
        if (data.tagName === "style" && node.textContent && /<|expression|behavior|javascript:/i.test(node.textContent)) node.textContent = cleanCss(node.textContent);
      });
    }
    return P;
  }
  function cleanHtml(html) {
    html = String(html || "");
    if (!html) return html;
    var P = purify();
    if (P) return P.sanitize(html, PURIFY);
    // respaldo: árbol inerte (DOMParser no ejecuta ni carga nada) y se quita lo activo
    var d = new DOMParser().parseFromString("<body>" + html, "text/html");
    [].slice.call(d.body.querySelectorAll("*")).forEach(function (n) {
      if (!n.isConnected) return;
      if (DROP.test(n.tagName) || /^(set)$/i.test(n.tagName)) { n.remove(); return; }
      [].slice.call(n.attributes).forEach(function (a) {
        var k = a.name.toLowerCase(), v = String(a.value || "").replace(/[\u0000- ]+/g, "").toLowerCase();
        if (/^on/.test(k) || k === "srcdoc" || k === "formaction" || k === "action") n.removeAttribute(a.name);
        else if (/^(href|src|xlink:href|poster|data|background)$/.test(k) && /^(javascript|vbscript|data:text\/html)/.test(v)) n.removeAttribute(a.name);
        else if (k === "style") n.setAttribute("style", cleanCss(a.value));
      });
      if (n.tagName === "STYLE") n.textContent = cleanCss(n.textContent);
    });
    return d.body.innerHTML;
  }
  RB.cleanHtml = cleanHtml; RB.cleanCss = cleanCss;

  /* ── colores y medidas leídos del elemento real ── */
  function hex(c) {
    if (!c) return "transparent";
    var m = c.match(/rgba?\(([^)]+)\)/); if (!m) return c;
    var p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
    if (p.length > 3 && p[3] === 0) return "transparent";
    if (p.length > 3 && p[3] < 1) return c;
    return "#" + p.slice(0, 3).map(function (v) { return Math.round(v).toString(16).padStart(2, "0"); }).join("");
  }
  function cs(n) { return getComputedStyle(n); }
  function famOf(n) {
    var f = (cs(n).fontFamily || "Inter").split(",")[0].replace(/["']/g, "").trim();
    if (!FONTS[f]) FONTS[f] = "'" + f + "', sans-serif";
    return f;
  }
  function moveBy(n, dx, dy) {
    var c = cs(n);
    if (c.position === "absolute" || c.position === "fixed") {
      if (dx) { n.style.left = (parseFloat(c.left) || 0) + dx + "px"; if (n.style.right) { n.style.width = n.style.width || c.width; n.style.right = "auto"; } }
      if (dy) { n.style.top = (parseFloat(c.top) || 0) + dy + "px"; if (n.style.bottom) { n.style.height = n.style.height || c.height; n.style.bottom = "auto"; } }
    } else {
      var t = (n.style.translate || "0px 0px").split(/\s+/).map(parseFloat);
      n.style.translate = ((t[0] || 0) + dx) + "px " + ((t[1] || 0) + dy) + "px";
    }
  }

  /* formas dibujables de un vector (sin las de <defs>, máscaras o recortes) */
  function vecList(n) {
    return [].slice.call(n.querySelectorAll("path,rect,circle,ellipse,polygon,polyline,line")).filter(function (p) { return !p.closest("defs,clipPath,mask,pattern,symbol,marker"); });
  }
  /* copia al estilo en línea lo que el CSS del frame le daba a una capa (y a sus hijos): así se puede pegar
     o mover a otro frame u otro archivo sin perder su aspecto (el CSS de cada frame vive encerrado en él) */
  var BAKE = ["position", "left", "top", "width", "height", "display", "box-sizing", "background-color", "background-image", "background-size", "background-position", "background-repeat",
    "color", "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-align", "text-transform", "text-decoration-line", "white-space", "vertical-align",
    "border-top-left-radius", "border-top-right-radius", "border-bottom-left-radius", "border-bottom-right-radius", "border-top", "border-right", "border-bottom", "border-left",
    "padding-top", "padding-right", "padding-bottom", "padding-left", "box-shadow", "opacity", "transform", "transform-origin", "rotate", "scale", "translate", "clip-path", "filter", "backdrop-filter",
    "object-fit", "object-position", "overflow", "mix-blend-mode", "flex-direction", "justify-content", "align-items", "gap", "z-index"];
  function bakeInto(src, dst) {
    var a = [src].concat([].slice.call(src.querySelectorAll("*"))), b = [dst].concat([].slice.call(dst.querySelectorAll("*")));
    a.forEach(function (s, i) {
      var d = b[i]; if (!d || !d.style || s.closest("svg") && s.tagName.toLowerCase() !== "svg") return;
      var c = getComputedStyle(s);
      BAKE.forEach(function (p) {
        if (d.style.getPropertyValue(p)) return;
        var v = c.getPropertyValue(p); if (!v || v === "none" && /^(clip-path|filter|backdrop-filter|transform|rotate|scale|translate)$/.test(p)) return;
        if ((p === "left" || p === "top") && c.position === "static") return;
        d.style.setProperty(p, v);
      });
    });
    return dst;
  }

  /* ── una capa = un elemento real, con las mismas propiedades que espera el editor ── */
  function makeEl(n, f) {
    var kind = n.getAttribute("data-layer-kind") || "";
    var textual = /text/.test(kind) || (!n.children.length && n.textContent.trim());
    var calcType = function () {
      if (n.tagName === "IMG" || /image|img|photo/.test(kind)) return "image";
      if (textual) return "text";
      if (!n.children.length && n.isConnected && /url\(/.test(getComputedStyle(n).backgroundImage || "")) return "image";
      return "rect";
    };
    var type = calcType(), typeFixed = n.isConnected;
    var loose = { locked: n.getAttribute("data-locked") === "true", anim: "none", dur: 600, delay: 0, ease: "ease-out", tag: n.tagName.toLowerCase() };
    var rect = function () { var a = n.getBoundingClientRect(), b = f._root.getBoundingClientRect(), z = ED.z || 1; return { x: (a.left - b.left) / z, y: (a.top - b.top) / z, w: a.width / z, h: a.height / z }; };
    var e = {};
    Object.defineProperty(e, "type", { get: function () { if (!typeFixed && n.isConnected) { type = calcType(); typeFixed = true; } return type; }, set: function (v) { type = v; typeFixed = true; }, enumerable: true, configurable: true });
    Object.defineProperty(e, "_n", { value: n, enumerable: false });
    var P = function (k, get, set) { Object.defineProperty(e, k, { get: get, set: set || function () {}, enumerable: true, configurable: true }); };
    P("name", function () { return n.getAttribute("data-layer-name") || n.getAttribute("data-layer-id") || loose.tag; }, function (v) { n.setAttribute("data-layer-name", v); });
    P("tag", function () { return loose.tag; });
    P("x", function () { return Math.round(rect().x); }, function (v) { moveBy(n, v - rect().x, 0); });
    P("y", function () { return Math.round(rect().y); }, function (v) { moveBy(n, 0, v - rect().y); });
    P("w", function () { return Math.round(rect().w); }, function (v) { n.style.width = v + "px"; });
    P("h", function () { return Math.round(rect().h); }, function (v) { n.style.height = v + "px"; });
    P("rot", function () { return parseFloat(n.style.rotate) || 0; }, function (v) { n.style.rotate = v ? v + "deg" : ""; });
    P("opacity", function () { return +cs(n).opacity; }, function (v) { n.style.opacity = v; });
    /* capa vectorial (un <svg> o una capa svg/bezier del MCP) sin fondo propio: su relleno es el de sus trazos,
       no el fondo de la caja — antes «Relleno» pintaba un rectángulo detrás del logo en vez de recolorearlo */
    var VEC_SHAPES = "path,rect,circle,ellipse,polygon,polyline";
    var vecShapes = function (all) {
      var lone = n.children.length === 1 && n.firstElementChild.tagName.toLowerCase() === "svg";
      if (!(n.tagName.toLowerCase() === "svg" || lone || /^(svg|bezier)$/.test(n.getAttribute("data-layer-kind") || ""))) return null;
      var c = cs(n), bgOn = (c.backgroundImage && c.backgroundImage !== "none") || !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(c.backgroundColor);
      if (bgOn) return null;
      var s = vecList(n).filter(function (p) { return all || (p.getAttribute("fill") || "") !== "none"; });
      return s.length ? s : null;
    };
    P("fill", function () {
      if (n.tagName === "IMG") return 'url("' + (n.getAttribute("src") || "") + '") center/cover no-repeat';
      var vs = vecShapes(); if (vs) return hex(cs(vs[0]).fill);
      var c = cs(n); if (c.backgroundImage && c.backgroundImage !== "none") return /url\(/.test(c.backgroundImage) ? c.backgroundImage + " center/cover no-repeat" : c.backgroundImage; return hex(c.backgroundColor);
    }, function (v) {
      var u = (String(v).match(/url\(["']?([^"')]+)["']?\)/) || [])[1];
      if (n.tagName === "IMG" && u) { n.setAttribute("src", u); n.removeAttribute("srcset"); return; }
      if (u && /url\(/.test(cs(n).backgroundImage || "")) { n.style.backgroundImage = "url('" + u + "')"; return; }
      var vs = !u && !/gradient\(/.test(String(v)) && vecShapes();
      if (vs) { vs.forEach(function (p) { p.setAttribute("fill", v); p.style.fill = ""; }); return; }
      n.style.background = v;
    });
    P("photo", function () { try { return n.dataset.photo ? JSON.parse(n.dataset.photo) : undefined; } catch (e) { return undefined; } }, function (v) { if (v) n.dataset.photo = JSON.stringify(v); else delete n.dataset.photo; });
    P("color", function () { return hex(cs(n).color); }, function (v) { n.style.color = v; });
    P("font", function () { return famOf(n); }, function (v) { n.style.fontFamily = FONTS[v] || v; });
    P("size", function () { return Math.round(parseFloat(cs(n).fontSize) || 16); }, function (v) { n.style.fontSize = v + "px"; });
    P("weight", function () { return +cs(n).fontWeight || 400; }, function (v) { n.style.fontWeight = v; });
    P("lh", function () { var c = cs(n), l = parseFloat(c.lineHeight); return isNaN(l) ? 1.2 : Math.round(l / (parseFloat(c.fontSize) || 16) * 100) / 100; }, function (v) { n.style.lineHeight = v; });
    P("ls", function () { return parseFloat(cs(n).letterSpacing) || 0; }, function (v) { n.style.letterSpacing = v + "px"; });
    P("tt", function () { return cs(n).textTransform; }, function (v) { n.style.textTransform = v; });
    P("align", function () { var a = cs(n).textAlign; return a === "start" ? "left" : a === "end" ? "right" : a; }, function (v) { n.style.textAlign = v; });
    P("text", function () { return n.innerText; }, function (v) { if (!n.children.length) n.textContent = v; else n.innerText = v; });
    P("radius", function () { return parseFloat(cs(n).borderTopLeftRadius) || 0; }, function (v) { n.style.borderRadius = v + "px"; });
    /* en un vector, el borde es el trazo de sus formas (antes mostraba el gris del borde de la caja, QA Instinct 11) */
    P("stroke", function () { var vs = vecShapes(true); if (vs) { var st = cs(vs[0]).stroke; return st && st !== "none" ? hex(st) : "transparent"; } return hex(cs(n).borderTopColor); },
      function (v) { var vs = vecShapes(true); if (vs) { vs.forEach(function (p) { p.setAttribute("stroke", v); p.style.stroke = ""; }); return; } n.style.borderColor = v; });
    P("strokeW", function () { var vs = vecShapes(true); if (vs) return cs(vs[0]).stroke === "none" ? 0 : parseFloat(cs(vs[0]).strokeWidth) || 0; return parseFloat(cs(n).borderTopWidth) || 0; },
      function (v) { var vs = vecShapes(true); if (vs) { vs.forEach(function (p) { p.setAttribute("stroke-width", v); if (v && (p.getAttribute("stroke") || "none") === "none") p.setAttribute("stroke", "#111111"); }); return; } n.style.borderWidth = v + "px"; if (v && cs(n).borderTopStyle === "none") n.style.borderStyle = "solid"; });
    P("dash", function () { var s = cs(n).borderTopStyle; return s === "none" ? "solid" : s; }, function (v) { n.style.borderStyle = v; });
    P("shadow", function () { return cs(n).boxShadow === "none" ? 0 : 12; }, function (v) { n.style.boxShadow = v ? "0 " + v / 3 + "px " + v + "px rgba(0,0,0,.35)" : "none"; });
    P("blur", function () { var m = (cs(n).filter || "").match(/blur\(([\d.]+)px/); return m ? +m[1] : 0; }, function (v) { n.style.filter = v ? "blur(" + v + "px)" : ""; });
    P("bgblur", function () { var m = (cs(n).backdropFilter || "").match(/blur\(([\d.]+)px/); return m ? +m[1] : 0; }, function (v) { n.style.backdropFilter = v ? "blur(" + v + "px)" : ""; });
    P("blend", function () { return cs(n).mixBlendMode; }, function (v) { n.style.mixBlendMode = v; });
    P("sx", function () { var s = (n.style.scale || "1").split(/\s+/); return +s[0] || 1; }, function (v) { var s = (n.style.scale || "1 1").split(/\s+/); n.style.scale = v + " " + (s[1] || s[0] || 1); });
    P("sy", function () { var s = (n.style.scale || "1").split(/\s+/); return +(s[1] || s[0]) || 1; }, function (v) { var s = (n.style.scale || "1 1").split(/\s+/); n.style.scale = (s[0] || 1) + " " + v; });
    P("kx", function () { return 0; }); P("ky", function () { return 0; });
    P("disp", function () { var d = cs(n).display; return d === "flex" || d === "grid" ? d : "block"; }, function (v) { n.style.display = v; });
    P("dir", function () { return /column/.test(cs(n).flexDirection) ? "column" : "row"; }, function (v) { n.style.flexDirection = v; });
    P("jus", function () { return cs(n).justifyContent === "normal" ? "flex-start" : cs(n).justifyContent; }, function (v) { n.style.justifyContent = v; });
    P("ali", function () { return cs(n).alignItems === "normal" ? "stretch" : cs(n).alignItems; }, function (v) { n.style.alignItems = v; });
    P("gap", function () { return parseFloat(cs(n).gap) || 0; }, function (v) { n.style.gap = v + "px"; });
    P("hidden", function () { return n.style.display === "none"; }, function (v) { n.style.display = v ? "none" : ""; });
    P("locked", function () { return loose.locked; }, function (v) { loose.locked = !!v; if (v) n.setAttribute("data-locked", "true"); else n.removeAttribute("data-locked"); });
    ["anim", "dur", "delay", "ease"].forEach(function (k) { P(k, function () { return loose[k]; }, function (v) { loose[k] = v; }); });
    return e;
  }

  /* capas creadas con las herramientas (rectángulo, texto…) se vuelven HTML real */
  function materialize(o, f) {
    var tmp = document.createElement("div");
    tmp.innerHTML = elHTML(o);
    var n = tmp.firstElementChild;
    n.className = "";
    n.style.position = "absolute";
    n.style.boxSizing = "border-box";
    n.setAttribute("data-layer-id", "musa_" + Date.now().toString(36) + (uid++));
    n.setAttribute("data-layer-name", o.name || TYPE_LBL[o.type] || "Capa");
    n.setAttribute("data-layer-kind", o.type === "text" ? "text" : o.type === "image" ? "image" : o.type === "path" ? "svg" : "shape");
    (f._content || f._root).appendChild(n);
    return makeEl(n, f);
  }

  /* nombre legible desde el id («titleBig» → «title Big», «icon-chrome» → «icon chrome») o el alt de una imagen */
  function niceName(n) {
    var id = (n.getAttribute("id") || "").trim();
    if (id && !/^(musa_|frame_|tf\d|tp\d|root$)/i.test(id)) return id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").trim().slice(0, 40);
    var alt = (n.getAttribute("alt") || n.getAttribute("aria-label") || "").trim();
    return alt ? alt.slice(0, 40) : "";
  }

  /* ── armar el documento del editor con un template real ── */
  function buildFrame(src, i, x) {
    if (!src.id) src.id = "frame_" + Date.now().toString(36) + "_" + (uid++);
    var w = +src.width || 1080, h = +src.height || 1080, id = "tf" + (uid++);
    var root = document.createElement("div");
    root.className = "mreal";
    root.setAttribute("data-tf", id);
    root.innerHTML = '<style data-scope>' + scopeCss(cleanCss(src.css), SCOPE(id)) + "</style>" + cleanHtml(src.html || "");
    var f = { name: src.name || "Frame " + (i + 1), x: x, y: 0, bg: src.background || "#ffffff", clip: true, els: [] };
    Object.defineProperty(f, "_root", { value: root, enumerable: false });
    Object.defineProperty(f, "_src", { value: src, enumerable: false });
    /* el primer elemento es «la caja del frame» salvo que sea una capa hoja (svg, vector, texto, imagen, forma,
       botón): así llegan las capas sueltas de set_frame_layers. Antes esa capa se escondía y lo nuevo se metía dentro */
    var top = [].slice.call(root.children, 1).filter(function (c) { return !/^(STYLE|LINK|SCRIPT|META|TITLE|NOSCRIPT|TEMPLATE)$/i.test(c.tagName); })[0] || null;
    if (top && /^(svg|bezier|image|text|shape|button)$/.test(top.getAttribute("data-layer-kind") || "")) top = null;
    Object.defineProperty(f, "_content", { value: top && !/^(IMG|SVG|VIDEO|CANVAS|INPUT|BR|HR|PICTURE)$/i.test(top.tagName) ? top : root, enumerable: false });
    var W = w, H = h;
    Object.defineProperty(f, "w", { get: function () { return W; }, set: function (v) { W = +v; if (top && top.style.width) top.style.width = W + "px"; }, enumerable: true });
    Object.defineProperty(f, "h", { get: function () { return H; }, set: function (v) { H = +v; if (top && top.style.height) top.style.height = H + "px"; }, enumerable: true });
    /* código de una IA (o importado) sin marcas de capa: cada elemento visual se vuelve una capa editable
       con data-layer-id/name/kind, igual que lo que crea el editor — así humano y MCP editan lo mismo */
    var INLINE = /^(B|I|EM|STRONG|U|S|SMALL|SUB|SUP|MARK|BR|WBR|ABBR|CODE|SPAN|A)$/;
    [].slice.call(root.querySelectorAll("*")).forEach(function (n) {
      if (/^(STYLE|SCRIPT|BR|WBR|DEFS|LINEARGRADIENT|RADIALGRADIENT|STOP|CLIPPATH|MASK|TITLE|DESC|META|LINK)$/i.test(n.tagName)) return;
      if (n.closest("svg") && n.tagName.toLowerCase() !== "svg") return;
      if (n.hasAttribute("data-layer-id")) return;
      var par = n.parentElement, inText = par && INLINE.test(n.tagName) && [].some.call(par.childNodes, function (c) { return c.nodeType === 3 && c.textContent.trim(); });
      if (inText) return;
      /* el <svg> de una capa vectorial (svg/bezier, como las crea el MCP) es parte de esa capa, no una capa «svg» aparte */
      if (n.tagName.toLowerCase() === "svg" && par && par.hasAttribute("data-layer-id") && /^(svg|bezier)$/.test(par.getAttribute("data-layer-kind") || "")) return;
      var tag = n.tagName.toLowerCase(), txt = (n.children.length ? "" : (n.textContent || "").trim()).slice(0, 28), cls = (n.getAttribute("class") || "").split(/\s+/)[0];
      n.setAttribute("data-layer-id", "musa_" + Date.now().toString(36) + "_" + (uid++));
      if (!n.hasAttribute("data-layer-name")) n.setAttribute("data-layer-name", txt || niceName(n) || cls || tag);
      if (!n.hasAttribute("data-layer-kind")) n.setAttribute("data-layer-kind", tag === "img" ? "image" : tag === "svg" ? "svg" : txt ? "text" : n.children.length ? "container" : "shape");
    });
    var nodes = [].slice.call(root.querySelectorAll("[data-layer-id]"));
    /* capas importadas antes con nombre de etiqueta («div», «img», «tile», «svg»): si el código trae id o alt, ese es su nombre (QA Instinct 9) */
    nodes.forEach(function (n) {
      var nm = n.getAttribute("data-layer-name") || "", tag = n.tagName.toLowerCase(), cls = (n.getAttribute("class") || "").split(/\s+/)[0];
      if (nm && nm !== tag && nm !== cls) return;
      var better = niceName(n); if (better) n.setAttribute("data-layer-name", better);
    });
    /* el contenedor raíz que ocupa todo el frame es el frame mismo, no una capa */
    if (top && nodes[0] === top && top.children.length) nodes.shift();
    f.els = nodes.map(function (n) { return makeEl(n, f); });
    return f;
  }

  function serializeFrame(f) {
    if (!f._root) return (f._src && f._src.html) || ""; /* frame sin materializar (p.ej. creado y borrado al vuelo): serializar desde _src */
    var c = f._root.cloneNode(true), s = c.querySelector("style[data-scope]");
    if (s) s.remove();
    c.querySelectorAll("[data-real]").forEach(function (n) {
      n.classList.remove("ed-el");
      if (!n.getAttribute("class")) n.removeAttribute("class");
      n.removeAttribute("data-real"); n.removeAttribute("data-f"); n.removeAttribute("data-e"); n.removeAttribute("contenteditable");
    });
    return c.innerHTML;
  }
  function payload(doc) {
    return { name: doc.name, frames: doc.frames.map(function (f) {
      var s = f._src || {};
      return Object.assign({}, s, { name: f.name, x: f.x, y: f.y, width: f.w, height: f.h, background: f.bg, html: serializeFrame(f), css: s.css || "" });
    }) };
  }

  /* ── fotos reveladas: los blob: locales se suben a tus archivos y se reemplazan por su URL real ── */
  var uploads = {}, pendingUp = 0, failedUp = {};
  function blobsIn(doc) {
    var out = [];
    doc.frames.forEach(function (f) { if (!f._root) return; f._root.querySelectorAll("*").forEach(function (n) {
      /* blob: de fotos reveladas y data:image pegadas en el editor de código (el servidor borra las data: al guardar:
         la imagen quedaba rota, QA Instinct 24) */
      var src = n.tagName === "IMG" ? n.getAttribute("src") : null; if (src && /^(blob:|data:image\/)/.test(src)) out.push([n, "src", src]);
      var bg = n.style && n.style.backgroundImage, m = bg && bg.match(/url\(["']?((?:blob:|data:image\/)[^"')]+)["']?\)/); if (m) out.push([n, "bg", m[1]]);
    }); });
    /* una que no se pudo subir no frena el guardado para siempre */
    return out.filter(function (it) { return !failedUp[it[2]]; });
  }
  function uploadBlobs(doc) {
    blobsIn(doc).forEach(function (it) {
      var url = it[2];
      if (!uploads[url]) {
        pendingUp++;
        uploads[url] = fetch(url).then(function (r) { return r.blob(); }).then(function (b) { return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.readAsDataURL(b); }); })
          .then(function (data) { return api("/api/assets/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "foto-" + Date.now() + ".jpg", data: data, workspaceId: RB.ws }) }); })
          .then(function (x) { var a = x.data || x.asset || x; return a.url || (a.asset && a.asset.url); })
          .then(function (u) { pendingUp--; if (!u) throw new Error("sin url"); return u; }, function (e) { pendingUp--; failedUp[url] = 1; toast("No se pudo subir la imagen: " + (e && e.message)); throw e; });
      }
      uploads[url].then(function (u) {
        if (it[1] === "src") { if (it[0].getAttribute("src") === url) it[0].setAttribute("src", u); }
        else it[0].style.backgroundImage = it[0].style.backgroundImage.split(url).join(u);
        save();
      }, function () {});
    });
  }

  /* ── guardado automático ── */
  var saveT = null, saving = false;
  /* bridge-replica.js (herramientas de réplica editable) crea capas con el mismo modelo del editor */
  RB._mk = function (n, f) { return makeEl(n, f); };
  RB._ed = { payload: function () { return ED.doc && ED.doc._real ? payload(ED.doc) : null; }, blobs: function () { return ED.doc ? blobsIn(ED.doc).length : -1; }, pending: function () { return pendingUp; }, save: function () { save(true); } };
  function save(now) {
    var doc = ED.doc; if (!doc || !doc._real || importing) return;
    clearTimeout(saveT);
    var run = function () {
      if (saving) { saveT = setTimeout(run, 800); return; }
      if (pendingUp || blobsIn(doc).length) { uploadBlobs(doc); saveT = setTimeout(run, 1000); return; }
      var p = payload(doc), sig = JSON.stringify(p);
      if (sig === doc._saved) return;
      saving = true;
      window.__musaSaveState = { saving: true, at: Date.now() };
      if (typeof edStat === "function") edStat();
      api("/api/templates/" + encodeURIComponent(doc._id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: sig })
        .then(function () { doc._saved = sig; remoteAt(doc); var t = RB.tpl.find(function (x) { return x.id === doc._id; }); if (t) t.name = doc.name; if (RB.f0) RB.f0[doc._id] = p.frames[0]; },
              function (e) { toast("No se pudo guardar: " + (e && e.message || "error")); })
        .then(function () { saving = false; window.__musaSaveState = { saving: false, at: Date.now() }; if (typeof edStat === "function") edStat(); });
    };
    if (now) run(); else saveT = setTimeout(run, 1200);
  }

  /* ── el editor de la maqueta, conectado ── */
  var _edRender = edRender;
  edRender = function () {
    var doc = ED.doc;
    if (!ED.open || !doc || !doc._real) return _edRender();
    var fr = doc.frames;
    fr.forEach(function (f) {
      if (!f._root) return;
      var now = new Set(f.els.map(function (e) { return e && e._n; }));
      (f._known || []).forEach(function (n) { if (!now.has(n) && f._root.contains(n)) n.remove(); });
      f.els = f.els.map(function (e) { return e && e._n ? e : materialize(e, f); }).filter(function (e) { return e._n.isConnected || f._root.contains(e._n); });
    });
    fr.forEach(function (f) { if (f._root) Object.defineProperty(f, "_known", { value: f.els.map(function (e) { return e._n; }), writable: true, configurable: true, enumerable: false }); });
    /* frames creados en vivo (herramienta Frame) no tienen _root: materializarlos aquí,
       si no, snap()/payload explotan con cloneNode y borrar/guardar muere (QA 9-nov) */
    fr.forEach(function (f, fi) {
      if (f._root) return;
      var id = "tf" + (uid++);
      var root = document.createElement("div");
      root.className = "mreal";
      root.setAttribute("data-tf", id);
      var src = f._src || {};
      root.innerHTML = '<style data-scope>' + scopeCss(cleanCss(src.css || ""), SCOPE(id)) + "</style>" + cleanHtml(src.html || "");
      Object.defineProperty(f, "_root", { value: root, enumerable: false });
      if (!f._src) Object.defineProperty(f, "_src", { value: src, enumerable: false });
      var top = root.children[1];
      Object.defineProperty(f, "_content", { value: top && !/^(IMG|SVG|VIDEO|CANVAS|INPUT|BR|HR|PICTURE)$/i.test(top.tagName) ? top : root, enumerable: false });
      var W = f.w || 1080, H = f.h || 1080;
      if (!Object.getOwnPropertyDescriptor(f, "w")) Object.defineProperty(f, "w", { get: function () { return W; }, set: function (v) { W = +v; if (top && top.style.width) top.style.width = W + "px"; }, configurable: true, enumerable: true });
      if (!Object.getOwnPropertyDescriptor(f, "h")) Object.defineProperty(f, "h", { get: function () { return H; }, set: function (v) { H = +v; if (top && top.style.height) top.style.height = H + "px"; }, configurable: true, enumerable: true });
      f.els = (f.els || []).map(function (e) { return e && e._n ? e : materialize(e, f); });
    });
    var keep = fr.map(function (f) { return f.els; });
    fr.forEach(function (f) { f.els = []; });
    try { _edRender(); } finally { fr.forEach(function (f, i) { f.els = keep[i]; }); }
    fr.forEach(function (f, fi) {
      var box = world.querySelector('.ed-frame[data-f="' + fi + '"]');
      if (!box || !f._root) return;
      box.insertBefore(f._root, box.firstChild);
      /* orden de capas: entre hermanos, el DOM sigue el orden de la lista (traer al frente / enviar atrás) */
      var idx = new Map(); f.els.forEach(function (e, i) { idx.set(e._n, i); });
      var parents = new Set(); f.els.forEach(function (e) { if (e._n.parentNode) parents.add(e._n.parentNode); });
      parents.forEach(function (par) {
        var kids = [].filter.call(par.children, function (k) { return idx.has(k); });
        var sorted = kids.slice().sort(function (a, b) { return idx.get(a) - idx.get(b); });
        if (sorted.some(function (k, i) { return k !== kids[i]; })) sorted.forEach(function (k) { par.appendChild(k); });
      });
      f.els.forEach(function (e, ei) { var n = e._n; n.classList.add("ed-el"); n.setAttribute("data-real", "1"); n.dataset.f = fi; n.dataset.e = ei; });
    });
    world.querySelectorAll(".ed-flabel").forEach(function (l) { var f = fr[+l.dataset.f]; if (f) { l.style.maxWidth = f.w + "px"; l.style.overflow = "hidden"; l.style.textOverflow = "ellipsis"; l.style.whiteSpace = "nowrap"; } });
    edSelBox(); if (typeof edStat === "function") edStat();
    if (doc._saved == null) doc._saved = JSON.stringify(payload(doc)); else save();
  };
  var _snap = snap;
  snap = function () {
    if (!ED.doc || !ED.doc._real) return _snap();
    ED.hist.push(JSON.stringify(payload(ED.doc)));
    if (ED.hist.length > 100) ED.hist.shift();
    ED.fut = [];
    edTop();
  };
  var _undo = undo;
  undo = function (redo) {
    if (!ED.doc || !ED.doc._real) return _undo(redo);
    var from = redo ? ED.fut : ED.hist, to = redo ? ED.hist : ED.fut;
    if (!from.length) return;
    to.push(JSON.stringify(payload(ED.doc)));
    var p = JSON.parse(from.pop()), x = 0;
    ED.doc.name = p.name;
    ED.doc.frames = p.frames.map(function (s, i) { var f = buildFrame(s, i, s.x != null ? +s.x : x); f.y = +s.y || 0; x += (+s.width || 1080) + 120; return f; });
    ED.sel = null;
    edRender(); edLayers(); edProps(); edTop();
    toast(redo ? "Rehecho" : "Deshecho");
  };
  if (typeof elCode === "function") {
    var _elCode = elCode;
    elCode = function (o) {
      if (!o || !o._n) return _elCode(o);
      var c = o._n.cloneNode(true); c.classList.remove("ed-el"); c.removeAttribute("data-real"); c.removeAttribute("data-f"); c.removeAttribute("data-e");
      var f = ED.doc.frames[ED.sel ? ED.sel.f : 0];
      return { html: c.outerHTML, css: (f && f._src && f._src.css) || "" };
    };
  }
  var _edClose = edClose;
  edClose = function () { if (ED.doc && ED.doc._real) save(true); return _edClose.apply(this, arguments); };

  /* ── vista de un frame tal cual (presentación, miniaturas y exportación) ── */
  function rootFor(src) {
    var id = "tp" + (uid++), root = document.createElement("div");
    root.className = "mreal"; root.setAttribute("data-tf", id);
    root.style.cssText = "position:absolute;inset:0";
    root.innerHTML = '<style data-scope>' + scopeCss(cleanCss(src.css), SCOPE(id)) + "</style>" + cleanHtml(src.html || "");
    return root;
  }
  function frameClone(f) {
    var c = f._root.cloneNode(true);
    c.style.cssText = "position:absolute;inset:0";
    c.querySelectorAll(".ed-el").forEach(function (n) { n.classList.remove("ed-el"); });
    c.querySelectorAll("[contenteditable]").forEach(function (n) { n.removeAttribute("contenteditable"); });
    return c;
  }
  function stage(root, w, h, bg, s, cls) {
    var outer = document.createElement("div");
    if (cls) outer.className = cls;
    outer.style.cssText = "width:" + w * s + "px;height:" + h * s + "px;position:relative;overflow:hidden;flex:none";
    var inner = document.createElement("div");
    inner.style.cssText = "position:absolute;left:0;top:0;width:" + w + "px;height:" + h + "px;background:" + (bg || "#fff") + ";overflow:hidden;transform:scale(" + s + ");transform-origin:0 0";
    inner.appendChild(root);
    outer.appendChild(inner);
    return outer;
  }
  /* miniatura viva de un frame guardado (Crear › Diseños) */
  RB.preview = function (src, maxW, maxH) {
    var w = +src.width || 1080, h = +src.height || 1080, s = Math.min(maxW / w, maxH / h);
    var el = stage(rootFor(src), w, h, src.background, s);
    el.style.pointerEvents = "none"; el.style.borderRadius = "4px"; el.style.boxShadow = "0 2px 10px rgba(0,0,0,.25)";
    return el;
  };

  /* ── Presentar: computadora, tableta y celular, en vertical y horizontal ──
     · La lámina ocupa todo el espacio disponible y se reacomoda al girar el aparato (resize, orientationchange
       y visualViewport, con una segunda pasada porque iOS informa tarde el tamaño nuevo).
     · Celular/tableta: deslizar a los lados o tocar el borde izquierdo (atrás) / el resto (adelante).
     · Computadora: ← → espacio, Re Pág/Av Pág, Inicio/Fin, rueda del mouse, botones. Esc sale.
     · Controles que se ocultan solos, pantalla completa donde el navegador lo permite (en iPhone no existe:
       se oculta el botón), y la pantalla no se apaga mientras presentas (Wake Lock). */
  (function () {
    var css = ""
      + ".ed-pres{background:#000!important;gap:0!important;touch-action:none;user-select:none;-webkit-user-select:none;overscroll-behavior:none}"
      + ".ed-pres .pz-st{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden}"
      + ".ed-pres .pz-st>div{box-shadow:0 10px 50px rgba(0,0,0,.5);transition:opacity .18s ease-out}"
      + ".ed-pres .pz-st>div.pz-in{opacity:0}"
      + ".ed-pres .pz-ui{position:absolute;inset:0;pointer-events:none;transition:opacity .25s ease-out}"
      + ".ed-pres.pz-idle .pz-ui{opacity:0}"
      + ".ed-pres .pz-top{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;gap:10px;padding:max(12px,env(safe-area-inset-top)) max(14px,env(safe-area-inset-right)) 28px max(14px,env(safe-area-inset-left));background:linear-gradient(rgba(0,0,0,.6),transparent);color:#fff;font:600 13px/1.2 var(--sans,Inter,system-ui,sans-serif)}"
      + ".ed-pres .pz-top span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.85}"
      + ".ed-pres .pz-bot{position:absolute;left:50%;bottom:max(14px,env(safe-area-inset-bottom));transform:translateX(-50%);display:flex;align-items:center;gap:6px;background:rgba(20,20,20,.82);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-radius:999px;padding:5px;box-shadow:0 8px 30px rgba(0,0,0,.4)}"
      + ".ed-pres .pz-ui button{pointer-events:auto;border:0;background:transparent;color:#fff;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;cursor:pointer;padding:0;flex:none}"
      + ".ed-pres .pz-ui button:hover{background:rgba(255,255,255,.12)}.ed-pres .pz-ui button:focus-visible{outline:2px solid var(--accent,#ff5e00);outline-offset:1px}"
      + ".ed-pres .pz-ui button[disabled]{opacity:.3;cursor:default;background:transparent}"
      + ".ed-pres .pz-n{color:#fff;font:700 13px/1 var(--sans,Inter,system-ui,sans-serif);font-variant-numeric:tabular-nums;min-width:58px;text-align:center}"
      + ".ed-pres .pz-x{background:rgba(255,255,255,.12)!important}"
      + ".ed-pres .pz-hint{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(20,20,20,.88);color:#fff;border-radius:14px;padding:12px 16px;font:600 13px/1.35 var(--sans,Inter,system-ui,sans-serif);text-align:center;max-width:min(320px,80vw);pointer-events:none;transition:opacity .3s}"
      + ".ed-pres .pz-hint.off{opacity:0}"
      + ".ed-pres .pz-prog{position:absolute;left:0;bottom:0;height:3px;background:var(--accent,#ff5e00);transition:width .2s ease-out}"
      + "@media (max-width:520px),(max-height:520px){.ed-pres .pz-ui button{width:40px;height:40px}.ed-pres .pz-bot{gap:2px}}"
      + "@media (prefers-reduced-motion:reduce){.ed-pres .pz-st>div,.ed-pres .pz-ui{transition:none}}";
    var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

    var IC = {
      prev: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
      next: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
      fs: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
      fsx: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
      x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    };
    var P = { idleT: null, lock: null, fsMine: false, down: null, hinted: false, wheelAt: 0 };
    var touchy = function () { return matchMedia("(hover: none), (pointer: coarse)").matches; };
    function pres() { return eq("#edPres"); }
    function isOpen() { var p = pres(); return !!p && !p.hidden; }
    function frames() { return (ED.doc && ED.doc.frames) || []; }
    /* pantalla completa: se pide sobre el iframe de la app en la página de arriba (mismo sitio) */
    function fsTarget() { try { return window.frameElement || document.documentElement; } catch (e) { return document.documentElement; } }
    function fsDoc() { try { return window.frameElement ? window.parent.document : document; } catch (e) { return document; } }
    function fsOn() { var d = fsDoc(); return !!(d.fullscreenElement || d.webkitFullscreenElement); }
    function fsAble() { var t = fsTarget(); return !!(t && (t.requestFullscreen || t.webkitRequestFullscreen)) && !/iPhone|iPod/.test(navigator.userAgent); }
    function fsEnter() { var t = fsTarget(); try { var r = (t.requestFullscreen || t.webkitRequestFullscreen).call(t); P.fsMine = true; if (r && r.catch) r.catch(function () { P.fsMine = false; }); } catch (e) {} }
    function fsExit() { var d = fsDoc(); try { if (fsOn()) (d.exitFullscreen || d.webkitExitFullscreen).call(d); } catch (e) {} P.fsMine = false; }
    function wake(on) {
      try {
        if (on && navigator.wakeLock && !P.lock) navigator.wakeLock.request("screen").then(function (l) { P.lock = l; l.addEventListener("release", function () { P.lock = null; }); }, function () {});
        if (!on && P.lock) { P.lock.release(); P.lock = null; }
      } catch (e) {}
    }
    function size() {
      var p = pres(), w = p.clientWidth || innerWidth, h = p.clientHeight || innerHeight;
      if (window.visualViewport) { w = Math.min(w, visualViewport.width) || w; h = Math.min(h, visualViewport.height) || h; }
      return { w: w, h: h };
    }
    function fit(f) {
      var z = size(), m = Math.min(z.w, z.h) < 600 ? 6 : Math.round(Math.min(z.w, z.h) * 0.035);
      return Math.max(0.01, Math.min((z.w - 2 * m) / f.w, (z.h - 2 * m) / f.h));
    }
    function slide(f, s) {
      if (ED.doc && ED.doc._real) return stage(frameClone(f), f.w, f.h, f.bg, s, "ed-mini-w");
      var tmp = document.createElement("div"); tmp.innerHTML = frameMini(f, s); return tmp.firstElementChild;
    }
    function chrome() {
      var p = pres(), n = frames().length, f = frames()[ED.pi] || {};
      var ui = p.querySelector(".pz-ui");
      if (!ui) {
        ui = document.createElement("div"); ui.className = "pz-ui";
        ui.innerHTML = '<div class="pz-top"><span class="pz-t"></span><button type="button" class="pz-x" data-pz="close" aria-label="Salir de la presentación" title="Salir (Esc)">' + IC.x + "</button></div>"
          + '<div class="pz-bot" role="toolbar" aria-label="Presentación"><button type="button" data-pz="prev" aria-label="Lámina anterior">' + IC.prev + '</button><span class="pz-n" aria-live="polite"></span><button type="button" data-pz="next" aria-label="Lámina siguiente">' + IC.next + "</button>"
          + (fsAble() ? '<button type="button" data-pz="fs" aria-label="Pantalla completa" title="Pantalla completa (F)">' + IC.fs + "</button>" : "") + "</div>"
          + '<div class="pz-prog"></div>';
        p.appendChild(ui);
      }
      ui.querySelector(".pz-t").textContent = f.name || "";
      ui.querySelector(".pz-n").textContent = (ED.pi + 1) + " / " + n;
      ui.querySelector('[data-pz="prev"]').disabled = ED.pi <= 0;
      ui.querySelector('[data-pz="next"]').disabled = ED.pi >= n - 1;
      ui.querySelector(".pz-prog").style.width = (n ? ((ED.pi + 1) / n) * 100 : 0) + "%";
      var fb = ui.querySelector('[data-pz="fs"]');
      if (fb) { var on = fsOn(); fb.innerHTML = on ? IC.fsx : IC.fs; fb.setAttribute("aria-label", on ? "Salir de pantalla completa" : "Pantalla completa"); }
    }
    function wakeUi() {
      var p = pres(); p.classList.remove("pz-idle");
      clearTimeout(P.idleT); P.idleT = setTimeout(function () { if (isOpen()) p.classList.add("pz-idle"); }, touchy() ? 3500 : 2500);
    }
    function hint(text, ms) {
      var p = pres(), h = p.querySelector(".pz-hint");
      if (!h) { h = document.createElement("div"); h.className = "pz-hint"; h.setAttribute("role", "status"); p.appendChild(h); }
      h.textContent = text; h.classList.remove("off");
      clearTimeout(h._t); h._t = setTimeout(function () { h.classList.add("off"); }, ms || 2600);
    }
    /* dibuja la lámina i (anim = fundido al cambiar de lámina) */
    function render(i, anim) {
      var fr = frames(); if (!fr.length) return;
      ED.pi = Math.max(0, Math.min(i, fr.length - 1));
      var p = pres(), f = fr[ED.pi], s = fit(f);
      [].slice.call(p.children).forEach(function (c) { if (!c.classList.contains("pz-ui") && !c.classList.contains("pz-hint") && !c.classList.contains("pz-st")) c.remove(); });
      var stg = p.querySelector(".pz-st");
      if (!stg) { stg = document.createElement("div"); stg.className = "pz-st"; p.insertBefore(stg, p.firstChild); }
      var el = slide(f, s);
      if (anim) el.classList.add("pz-in");
      stg.innerHTML = ""; stg.appendChild(el);
      if (anim) requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.remove("pz-in"); }); });
      p._key = ED.pi + "|" + f.w + "x" + f.h + "|" + Math.round(s * 1000);
      chrome();
    }
    /* solo reescala si cambió el tamaño (girar, redimensionar, entrar a pantalla completa) */
    var relayT = null;
    function relayout() {
      if (!isOpen()) return;
      var f = frames()[ED.pi]; if (!f) return;
      var key = ED.pi + "|" + f.w + "x" + f.h + "|" + Math.round(fit(f) * 1000);
      if (key !== pres()._key) render(ED.pi, false);
      chrome(); suggestRotate();
    }
    function onResize() { relayout(); clearTimeout(relayT); relayT = setTimeout(relayout, 300); }
    function suggestRotate() {
      if (!touchy() || P.hinted) return;
      var f = frames()[ED.pi], z = size(); if (!f) return;
      var slideLand = f.w > f.h * 1.15, devPort = z.h > z.w * 1.15, slidePort = f.h > f.w * 1.15, devLand = z.w > z.h * 1.15;
      if ((slideLand && devPort) || (slidePort && devLand)) { P.hinted = true; hint(slideLand ? "Gira el teléfono para ver la lámina más grande" : "Gira el teléfono para ver la lámina en vertical", 3200); }
    }
    function go(i) {
      var n = frames().length; if (!n) return;
      var j = Math.max(0, Math.min(i, n - 1));
      if (j === ED.pi) { if (i >= n) hint("Fin de la presentación · Esc o ✕ para salir", 1800); wakeUi(); return; }
      render(j, true); wakeUi();
    }
    function close() {
      var p = pres(); if (!p) return;
      p.hidden = true; p.classList.remove("pz-idle"); clearTimeout(P.idleT);
      if (P.fsMine) fsExit();
      wake(false);
    }

    edPresent = function (i) {
      if (!ED.doc || !frames().length) return;
      var p = pres(), was = isOpen();
      p.hidden = false;
      if (!was) { P.hinted = false; p.setAttribute("role", "dialog"); p.setAttribute("aria-modal", "true"); p.setAttribute("aria-label", "Presentación"); p.tabIndex = -1; try { p.focus({ preventScroll: true }); } catch (e) {} }
      render(i == null ? 0 : i, was);
      wakeUi();
      if (!was) {
        wake(true);
        if (touchy()) setTimeout(function () { if (isOpen()) { hint(frames().length > 1 ? "Desliza o toca los lados para cambiar de lámina" : "Toca ✕ para salir", 2400); suggestRotate(); } }, 250);
      }
    };

    /* gestos y clics: se atienden aquí (fase de captura) para que el «clic = siguiente» de la maqueta no se sume */
    document.addEventListener("pointerdown", function (e) {
      if (!isOpen() || !pres().contains(e.target)) return;
      P.down = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId, ui: !!(e.target.closest && e.target.closest(".pz-ui button")) };
      wakeUi();
    }, true);
    document.addEventListener("pointerup", function (e) {
      if (!isOpen() || !P.down || P.down.id !== e.pointerId) return;
      var d = P.down; P.down = null;
      if (d.ui) return;
      var dx = e.clientX - d.x, dy = e.clientY - d.y, dt = Date.now() - d.t;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2 && dt < 900) { go(ED.pi + (dx < 0 ? 1 : -1)); return; }
      if (Math.abs(dy) > 70 && Math.abs(dy) > Math.abs(dx) * 1.5 && dt < 900) { go(ED.pi + (dy < 0 ? 1 : -1)); return; }
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 600) {
        var z = size();
        go(ED.pi + (e.clientX < z.w * 0.3 ? -1 : 1));
      }
    }, true);
    document.addEventListener("pointercancel", function () { P.down = null; }, true);
    document.addEventListener("click", function (e) {
      if (!isOpen() || !pres().contains(e.target)) return;
      e.stopPropagation(); e.preventDefault();
      var b = e.target.closest && e.target.closest("[data-pz]"); if (!b) return;
      var k = b.getAttribute("data-pz");
      if (k === "close") return close();
      if (k === "prev") return go(ED.pi - 1);
      if (k === "next") return go(ED.pi + 1);
      if (k === "fs") { if (fsOn()) fsExit(); else fsEnter(); setTimeout(chrome, 300); }
    }, true);
    document.addEventListener("mousemove", function () { if (isOpen()) wakeUi(); }, true);
    document.addEventListener("wheel", function (e) {
      if (!isOpen()) return;
      e.preventDefault();
      var now = Date.now(); if (now - P.wheelAt < 450 || Math.abs(e.deltaY) + Math.abs(e.deltaX) < 20) return;
      P.wheelAt = now; go(ED.pi + ((e.deltaY || e.deltaX) > 0 ? 1 : -1));
    }, { capture: true, passive: false });
    /* teclado: antes que los atajos del editor (que moverían la selección) */
    window.addEventListener("keydown", function (e) {
      if (!isOpen()) return;
      var k = e.key, n = frames().length;
      if (k === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); if (fsOn() && !P.fsMine) return; return close(); }
      var map = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, " ": 1, Enter: 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1, Backspace: -1 };
      if (k in map) { e.preventDefault(); e.stopImmediatePropagation(); return go(ED.pi + map[k]); }
      if (k === "Home") { e.preventDefault(); e.stopImmediatePropagation(); return go(0); }
      if (k === "End") { e.preventDefault(); e.stopImmediatePropagation(); return go(n - 1); }
      if (k === "f" || k === "F") { e.preventDefault(); e.stopImmediatePropagation(); if (fsAble()) { if (fsOn()) fsExit(); else fsEnter(); } return; }
      e.stopImmediatePropagation();
    }, true);
    /* girar / redimensionar / pantalla completa */
    addEventListener("resize", onResize);
    addEventListener("orientationchange", function () { setTimeout(onResize, 60); setTimeout(onResize, 400); });
    if (window.visualViewport) visualViewport.addEventListener("resize", onResize);
    try { if (window.screen && screen.orientation) screen.orientation.addEventListener("change", function () { setTimeout(onResize, 60); }); } catch (e) {}
    ["fullscreenchange", "webkitfullscreenchange"].forEach(function (ev) { try { fsDoc().addEventListener(ev, function () { if (!fsOn()) P.fsMine = false; setTimeout(onResize, 50); }); } catch (e) {} });
    document.addEventListener("visibilitychange", function () { if (!document.hidden && isOpen()) wake(true); });
    RB.presentClose = close;
  })();

  /* ── exportar de verdad: PNG, JPG, SVG, PDF y JSON ── */
  function loadLib(src, glob) {
    if (window[glob]) return Promise.resolve(window[glob]);
    return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = src; s.onload = function () { res(window[glob]); }; s.onerror = function () { rej(new Error("no cargó " + src)); }; document.head.appendChild(s); });
  }
  function waitImages(el) {
    return Promise.all([].map.call(el.querySelectorAll("img"), function (im) { return im.complete ? 0 : new Promise(function (r) { im.onload = im.onerror = r; setTimeout(r, 8000); }); }));
  }
  /* html2canvas no sabe de clip-path ni de filter: blur(): el papel rasgado salía como rectángulo y la sombra
     difuminada como un bloque (QA Instinct 1). Antes de la captura, cada capa hoja con recorte o desenfoque
     (color liso o imagen) se pinta en un canvas con su forma y se reemplaza por esa imagen. */
  function clipPathOf(v, w, h) {
    var m = /^(polygon|circle|ellipse|inset)\((.*)\)$/.exec(String(v || "").trim()); if (!m) return null;
    var L = function (t, ref) { t = String(t).trim(); return /%$/.test(t) ? parseFloat(t) / 100 * ref : parseFloat(t) || 0; };
    var p = new Path2D(), body = m[2].replace(/^(nonzero|evenodd)\s*,/, "");
    if (m[1] === "polygon") {
      var pts = body.split(",").map(function (s) { var q = s.trim().split(/\s+/); return [L(q[0], w), L(q[1], h)]; });
      if (pts.length < 3 || pts.some(function (q) { return isNaN(q[0]) || isNaN(q[1]); })) return null;
      pts.forEach(function (q, i) { if (i) p.lineTo(q[0], q[1]); else p.moveTo(q[0], q[1]); }); p.closePath(); return p;
    }
    var at = body.split(/\s+at\s+/), c = (at[1] || "50% 50%").trim().split(/\s+/), cx = L(c[0], w), cy = L(c[1] || "50%", h), r = at[0].trim().split(/\s+/);
    if (m[1] === "circle") { var rr = !r[0] || r[0] === "closest-side" ? Math.min(cx, cy, w - cx, h - cy) : r[0] === "farthest-side" ? Math.max(cx, cy, w - cx, h - cy) : L(r[0], Math.sqrt(w * w + h * h) / Math.SQRT2); p.arc(cx, cy, rr, 0, Math.PI * 2); return p; }
    if (m[1] === "ellipse") { p.ellipse(cx, cy, r[0] ? L(r[0], w) : w / 2, r[1] ? L(r[1], h) : h / 2, 0, 0, Math.PI * 2); return p; }
    var parts = body.split(/\s+round\s+/), v4 = parts[0].trim().split(/\s+/), t = L(v4[0], h), ri = L(v4[1] || v4[0], w), b = L(v4[2] || v4[0], h), le = L(v4[3] || v4[1] || v4[0], w), rad = parts[1] ? L(parts[1].split(/\s+/)[0], Math.min(w, h)) : 0;
    if (p.roundRect) p.roundRect(le, t, w - le - ri, h - t - b, rad); else p.rect(le, t, w - le - ri, h - t - b);
    return p;
  }
  function rasterFx(inner, scale) {
    var jobs = [];
    inner.querySelectorAll("*").forEach(function (n) {
      if (n.closest("svg") || n.children.length) return;
      var c = getComputedStyle(n), clip = c.clipPath && c.clipPath !== "none" ? c.clipPath : "", bm = /blur\(([\d.]+)px\)/.exec(c.filter || ""), blur = bm ? +bm[1] : 0;
      if (!clip && !blur) return;
      if (n.tagName !== "IMG" && (n.textContent || "").trim()) return; /* texto: se deja como está */
      var w = n.offsetWidth, h = n.offsetHeight; if (!w || !h) return;
      var img = n.tagName === "IMG" ? n : null, bgUrl = !img && (/url\(["']?([^"')]+)["']?\)/.exec(c.backgroundImage || "") || [])[1];
      if (!img && !bgUrl && /gradient\(/.test(c.backgroundImage || "")) return; /* degradados: html2canvas los pinta; el recorte se pierde */
      var path = clip ? clipPathOf(clip, w, h) : null; if (clip && !path) return;
      var pad = blur ? Math.ceil(blur * 3) : 0, abs = c.position === "absolute";
      if (pad && !abs) pad = 0;
      jobs.push(new Promise(function (res) {
        var draw = function (source) {
          try {
            var cv = document.createElement("canvas"), k = Math.max(1, scale);
            cv.width = Math.ceil((w + pad * 2) * k); cv.height = Math.ceil((h + pad * 2) * k);
            var x = cv.getContext("2d"); x.scale(k, k);
            if (blur && "filter" in x) x.filter = "blur(" + blur + "px)";
            x.translate(pad, pad);
            if (path) x.clip(path);
            if (source) {
              var iw = source.naturalWidth || source.width, ih = source.naturalHeight || source.height, fit = img ? c.objectFit : (/contain/.test(c.backgroundSize) ? "contain" : /cover/.test(c.backgroundSize) ? "cover" : "fill");
              if (fit === "cover" || fit === "contain") { var s = (fit === "cover" ? Math.max : Math.min)(w / iw, h / ih); x.drawImage(source, (w - iw * s) / 2, (h - ih * s) / 2, iw * s, ih * s); }
              else x.drawImage(source, 0, 0, w, h);
            } else { x.fillStyle = c.backgroundColor; x.fillRect(0, 0, w, h); }
            var url = cv.toDataURL("image/png");
            n.style.clipPath = "none"; n.style.filter = "none"; n.style.boxShadow = "none";
            if (pad) { n.style.left = (parseFloat(c.left) || 0) - pad + "px"; n.style.top = (parseFloat(c.top) || 0) - pad + "px"; n.style.width = w + pad * 2 + "px"; n.style.height = h + pad * 2 + "px"; }
            if (img) { img.src = url; img.style.objectFit = "fill"; }
            else { n.style.background = "url('" + url + "') 0 0 / 100% 100% no-repeat"; }
          } catch (e) { /* una imagen sin permiso (CORS) deja el canvas «sucio»: se queda como estaba */ }
          res();
        };
        if (!img && !bgUrl) return draw(null);
        var im = new Image(); im.crossOrigin = "anonymous";
        im.onload = function () { draw(im); }; im.onerror = function () { res(); };
        im.src = img ? img.currentSrc || img.src : bgUrl;
        setTimeout(res, 8000);
      }));
    });
    return Promise.all(jobs).then(function () { if (jobs.length) return new Promise(function (r) { requestAnimationFrame(function () { r(); }); }); });
  }
  /* prep(clon): ajusta la COPIA del frame antes de fotografiarla (nunca el diseño vivo); bg: fondo propio */
  function shot(f, scale, prep, bg) {
    return loadLib("vendor/html2canvas.min.js", "html2canvas").then(function () {
      var host = document.createElement("div");
      host.style.cssText = "position:fixed;left:0;top:0;z-index:-1;pointer-events:none";
      var clone = frameClone(f); if (prep) prep(clone);
      var useBg = bg !== undefined ? (bg || "transparent") : f.bg;
      var inner = stage(clone, f.w, f.h, useBg, 1).firstChild;
      inner.style.transform = "none"; inner.style.position = "relative";
      host.appendChild(inner); document.body.appendChild(host);
      inner.querySelectorAll("img").forEach(function (im) { im.crossOrigin = "anonymous"; if (im.src) im.src = im.src; });
      return waitImages(inner).then(function () { return RB._preShot ? RB._preShot(inner, scale || 1) : null; }).then(function () { return rasterFx(inner, scale || 1); }).then(function () {
        return html2canvas(inner, { useCORS: true, backgroundColor: bg !== undefined ? bg : (f.bg || null), scale: scale, width: f.w, height: f.h, logging: false });
      }).then(function (c) { host.remove(); return c; }, function (e) { host.remove(); throw e; });
    });
  }
  /* QA Instinct lote 2 #8: la exportación tarda y el navegador ya no cuenta el clic → sin descarga. RB.fileReady
     (bridge-replica.js) descarga si puede y si no deja un panel con el enlace real. */
  function download(name, href) {
    if (RB.fileReady) return fetch(href).then(function (r) { return r.blob(); }).then(function (b) { return RB.fileReady(b, name); });
    var a = document.createElement("a"); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }
  function safe(n) { return String(n || "diseño").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80); }
  function doExport(kind) {
    var doc = ED.doc, sel = ED.sel ? [doc.frames[ED.sel.f]] : doc.frames, base = safe(doc.name);
    toast("Exportando " + kind + "…");
    var each = function (fn) { return sel.reduce(function (p, f, i) { return p.then(function () { return fn(f, i); }); }, Promise.resolve()); };
    var job;
    if (kind === "PNG" || kind === "JPG") {
      job = each(function (f, i) { return shot(f, 1).then(function (c) { download(base + (sel.length > 1 ? "-" + (i + 1) : "") + "." + kind.toLowerCase(), c.toDataURL(kind === "PNG" ? "image/png" : "image/jpeg", 0.92)); }); });
    } else if (/^PDF/.test(kind)) {
      var hi = /Impresi/.test(kind), pdf = null;
      job = loadLib("vendor/jspdf.umd.min.js", "jspdf").then(function () {
        return each(function (f) { return shot(f, hi ? 2 : 1).then(function (c) {
          var o = f.w > f.h ? "l" : "p";
          if (!pdf) pdf = new window.jspdf.jsPDF({ unit: "px", format: [f.w, f.h], orientation: o, hotfixes: ["px_scaling"] });
          else pdf.addPage([f.w, f.h], o);
          pdf.addImage(c.toDataURL("image/jpeg", hi ? 0.98 : 0.9), "JPEG", 0, 0, f.w, f.h);
        }); });
      }).then(function () {   /* descarga directa (pdf.save abría about:blank en navegadores integrados, QA R1) */
        var blob = pdf.output("blob");
        if (window.__musaBajarPdf) return window.__musaBajarPdf(blob, base + ".pdf", null, { panel: "si-falla" });
        var u = URL.createObjectURL(blob), a = document.createElement("a"); a.href = u; a.download = base + ".pdf"; document.body.appendChild(a); a.click();
        setTimeout(function () { a.remove(); URL.revokeObjectURL(u); }, 60000);
      });
    } else if (kind === "SVG") {
      job = each(function (f, i) {
        var c = frameClone(f), xml = new XMLSerializer().serializeToString(c);
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + f.w + '" height="' + f.h + '"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:' + f.w + "px;height:" + f.h + "px;background:" + f.bg + ';overflow:hidden">' + xml + "</div></foreignObject></svg>";
        download(base + (sel.length > 1 ? "-" + (i + 1) : "") + ".svg", URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })));
      });
    } else if (/^JSON/.test(kind)) {
      job = Promise.resolve(download(base + ".json", URL.createObjectURL(new Blob([JSON.stringify(Object.assign({ id: doc._id, engine: "html" }, payload(doc)), null, 2)], { type: "application/json" }))));
    } else return toast(kind + " todavía no está disponible");
    job.then(function () { toast(kind + " listo"); }, function (e) { toast("No se pudo exportar: " + (e && e.message || "error")); });
  }
  edRoot.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest('[data-demo^="Exportar "]');
    if (b && ED.doc && ED.doc._real) { e.stopPropagation(); e.preventDefault(); doExport(b.dataset.demo.slice(9)); }
    else if (b && ED.doc && RB.on) { e.stopPropagation(); e.preventDefault(); sampleOffer("export"); }
  }, true);
  var _mExp = MENUS.exportar;
  MENUS.exportar = function () {
    var items = _mExp();
    if (ED.doc && !ED.doc._real && RB.on) return items.map(function (it) { return it && it.l && /^(PNG|JPG|SVG|PDF|PDF Impresión…|JSON \(template\))$/.test(it.l) ? Object.assign({}, it, { fn: function () { sampleOffer("export"); } }) : it; });
    if (!ED.doc || !ED.doc._real) return items;
    return items.map(function (it) { return it && it.l && /^(PNG|JPG|SVG|PDF|PDF Impresión…|JSON \(template\))$/.test(it.l) ? Object.assign({}, it, { fn: function () { doExport(it.l); } }) : it; });
  };

  if (typeof phSrcFor === "function") {
    var _phSrcFor = phSrcFor;
    phSrcFor = function (t) {
      if (!PH.doc || !PH.doc._real) return _phSrcFor(t);
      if (t.kind === "frame") return shot(PH.doc.frames[t.f], 1);
      if (t.kind !== "image") return _phSrcFor(t);
      var e = PH.doc.frames[t.f].els[t.e], url = e.photo && e.photo.orig ? e.photo.orig : phUrlOf(e.fill);
      if (!url) return _phSrcFor(t);
      if (PH_SRC.has(url)) return Promise.resolve(PH_SRC.get(url));
      return new Promise(function (res) {
        var im = new Image(); im.crossOrigin = "anonymous";
        im.onload = function () { var c = phCanvas(im.naturalWidth, im.naturalHeight); c.getContext("2d").drawImage(im, 0, 0); PH_SRC.set(url, c); res(c); };
        im.onerror = function () { phToast("No se pudo leer la foto original (permiso de la web de origen)"); res(phSynth(e)); };
        im.src = url;
      });
    };
  }

  /* ── menús del editor conectados: Importar, Batch, Compartir y Editor de video ── */
  function pickFile(accept, label) {
    return RB.pickFileVisible ? RB.pickFileVisible(accept, label) : new Promise(function (res) {
      var i = document.createElement("input"); i.type = "file"; i.accept = accept; i.style.display = "none";
      i.setAttribute("aria-label", label || "Elegir archivo"); i.setAttribute("data-musa-file", label || "archivo");
      i.onchange = function () { res(i.files && i.files[0]); i.remove(); };
      document.body.appendChild(i); i.click();
    });
  }
  function readText(f) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsText(f); }); }
  function addFrames(srcs) {
    var doc = ED.doc; snap();
    var x = doc.frames.reduce(function (m, f) { return Math.max(m, f.x + f.w); }, 0) + 120;
    srcs.forEach(function (s, i) { var f = buildFrame(s, doc.frames.length, x); x += f.w + 120; doc.frames.push(f); });
    ED.sel = { f: doc.frames.length - 1, e: null };
    edRender(); edLayers(); edProps(); edFit && edFit(doc.frames[doc.frames.length - 1]);
    save();
  }
  /* ── Importar: un solo motor en el servidor (/api/design-imports/html) para el editor, el MCP y la API ──
     Pegar HTML, archivo .html, URL, ZIP (HTML + CSS + imágenes + fuentes), arrastrar al lienzo o Ctrl+V.
     El servidor limpia el código, copia imágenes y fuentes a Musa, separa frames y devuelve un reporte.
     Sin ventanas del navegador: todo pasa en diálogos de Musa, así también lo puede hacer un agente. */
  var importing = false;
  var IMPORT_FORMATS = [
    { value: "", label: "El que indique el HTML (si no, 1080 × 1080)" }, { value: "post", label: "Post · 1080 × 1080" },
    { value: "portrait", label: "Vertical · 1080 × 1350" }, { value: "story", label: "Historia · 1080 × 1920" },
    { value: "landscape", label: "Horizontal · 1200 × 628" }, { value: "youtube", label: "Miniatura · 1280 × 720" },
    { value: "slide", label: "Presentación · 1920 × 1080" }, { value: "a4", label: "A4 · 794 × 1123" },
  ];
  var J = function (body) { return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), timeoutMs: 90000 }; };
  function errMsg(e) { return String((e && e.message) || e || "error").replace(/^API error:\s*\d+\s*[·:—-]?\s*/i, "") || "error"; }
  function escH(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function optionFields() {
    return [
      { name: "format", label: "Tamaño del frame", type: "select", value: "", options: IMPORT_FORMATS },
      { name: "split", label: "Separar en varios frames si trae varias secciones de tamaño fijo (por ejemplo, un pack de portadas)", type: "checkbox", value: true },
    ];
  }
  /* espera a que el diseño quede guardado: la importación escribe en el mismo diseño */
  function settle() {
    return new Promise(function (res) {
      if (ED.doc && ED.doc._empty) return res();
      save(true);
      var t0 = Date.now();
      (function wait() { if ((!saving && !pendingUp && !blobsIn(ED.doc).length) || Date.now() - t0 > 20000) return res(); setTimeout(wait, 200); })();
    });
  }
  function drain(first, pg) {
    function step(x) {
      var d = x && x.data; if (!d) throw new Error("respuesta vacía del servidor");
      if (d.done) return d;
      var a = (d.result && d.result.assets) || {};
      pg.set(d.progress || 10, a.total ? "Copiando imágenes y fuentes a Musa… " + (a.done + a.failed) + " de " + a.total : "Procesando…");
      return api("/api/design-imports/jobs/" + encodeURIComponent(d.id) + "/html-batch", J({ workspaceId: RB.ws })).then(step);
    }
    return first.then(step);
  }
  function runImport(start, original, label) {
    var doc = ED.doc;
    if (!doc || !doc._real) return toast("Abre un diseño guardado para importar");
    if (importing) return toast("Ya hay una importación en curso");
    importing = true;
    var pg = RB.progress("Importando a Musa", "Guardando tus cambios…");
    return settle().then(function () {
      pg.set(5, label || "Leyendo el diseño…");
      return drain(start(), pg);
    }).then(function (d) {
      pg.close();
      importing = false;
      RB._ownAt = Date.now();   /* el cambio lo hizo esta importación: no es «desde MCP» (QA R3-4) */
      return report(d, original, doc._id).then(function () { RB.openDesign(doc._id); });
    }, function (e) {
      pg.close();
      importing = false;
      return RB.notice("No se pudo importar", errMsg(e) + "\n\nEl diseño quedó como estaba.", { action: "import-error" });
    });
  }
  function importHtml(body, original) {
    var doc = ED.doc;
    body.workspaceId = RB.ws; body.templateId = doc._id;
    if (doc._brandId) body.brandId = doc._brandId;
    return runImport(function () { return api("/api/design-imports/html", J(body)); }, original, body.url ? "Trayendo la página…" : "Limpiando el código y armando los frames…");
  }
  function importZip(file, opts) {
    var doc = ED.doc;
    if (file.size > 50 * 1024 * 1024) return RB.notice("ZIP muy pesado", "El ZIP pesa " + (file.size / 1048576).toFixed(1) + " MB; el máximo es 50 MB.");
    opts = opts || {};
    return runImport(function () {
      return api("/api/design-imports/uploads", J({ workspaceId: RB.ws, size: file.size, name: file.name, sourceType: "zip" }))
        .then(function (x) { var u = x.data; return fetch(u.signedUrl, { method: "PUT", headers: { "Content-Type": "application/zip", "x-upsert": "false" }, body: file }).then(function (r) { if (!r.ok) throw new Error("no se pudo subir el ZIP (" + r.status + ")"); return u.id; }); })
        .then(function (id) { return api("/api/design-imports/jobs/" + encodeURIComponent(id) + "/convert", J({ workspaceId: RB.ws, templateId: doc._id, brandId: doc._brandId || undefined, name: opts.name || file.name.replace(/\.zip$/i, ""), format: opts.format || undefined, split: opts.split === false ? "single" : "auto" })); });
    }, null, "Subiendo " + file.name + "…");
  }
  /* reporte: qué se creó, qué se copió, qué se perdió o cambió, y el original al lado */
  function report(d, original, tplId) {
    var doc = d.result || {}, sum = d.summary || {}, boards = doc.artboards || [], assets = sum.assets || {}, fonts = sum.fonts || {}, warns = d.warnings || doc.warnings || [];
    var lines = [
      "<p class=\"msg\"><b>" + boards.length + " frame" + (boards.length === 1 ? "" : "s") + " nuevo" + (boards.length === 1 ? "" : "s") + "</b>: " + boards.map(function (b) { return escH(b.name) + " (" + b.width + " × " + b.height + ")"; }).join(", ") + "</p>",
      assets.total ? "<p class=\"msg\">Imágenes y fuentes copiadas a Musa: " + assets.done + " de " + assets.total + (assets.failed ? " · " + assets.failed + " no se pudieron copiar" : "") + "</p>" : "",
      fonts.google && fonts.google.length ? "<p class=\"msg\">Fuentes de Google: " + fonts.google.map(escH).join(", ") + "</p>" : "",
      fonts.hosted && fonts.hosted.length ? "<p class=\"msg\">Fuentes propias del diseño: " + fonts.hosted.map(escH).join(", ") + "</p>" : "",
      warns.length ? "<p class=\"msg\"><b>Revisa:</b></p><ul class=\"w\">" + warns.map(function (w) { return "<li>" + escH(w.message) + "</li>"; }).join("") + "</ul>" : "<p class=\"msg\">No se perdió nada en la importación.</p>",
      "<div class=\"imp-cmp\" style=\"display:grid;grid-template-columns:" + (original ? "1fr 1fr" : "1fr") + ";gap:12px;margin:4px 0 12px\">" +
        (original ? "<figure style=\"margin:0\"><figcaption style=\"font-size:12px;font-weight:700;margin-bottom:6px\">Original (sin scripts)</figcaption><div class=\"imp-orig\" style=\"height:240px;background:#fff;border-radius:10px;overflow:hidden;position:relative;border:1px solid #dcdacd\"></div></figure>" : "") +
        "<figure style=\"margin:0\"><figcaption style=\"font-size:12px;font-weight:700;margin-bottom:6px\">En Musa</figcaption><div class=\"imp-musa\" style=\"height:240px;background:#222;border-radius:10px;overflow:auto;display:flex;gap:10px;align-items:center;padding:10px;box-sizing:border-box\"></div></figure></div>",
    ];
    var p = RB.dialog({ title: warns.length ? "Importado, con avisos" : "Importado", body: lines.join(""), ok: "Ver en el editor", cancel: false, wide: original ? 2 : true, action: "import-report" });
    setTimeout(function () {
      var box = document.querySelector('[data-musa-dialog="import-report"]'); if (!box) return;
      var musa = box.querySelector(".imp-musa");
      var drawMusa = function (srcs) {
        musa.innerHTML = "";
        srcs.slice(0, 12).forEach(function (b) {
          var cell = document.createElement("div"); cell.style.cssText = "flex:none;display:grid;place-items:center";
          try { cell.appendChild(RB.preview(b, srcs.length > 1 ? 160 : 300, 210)); } catch (e) {}
          musa.appendChild(cell);
        });
      };
      drawMusa(boards.filter(function (b) { return b.raw; }).map(function (b) { return { html: b.raw.html, css: b.raw.css, width: b.width, height: b.height, background: b.background }; }));
      /* «En Musa» con lo que quedó guardado: las imágenes ya copiadas a tus archivos (antes salía sin los íconos, QA Instinct N3) */
      if (tplId) api("/rest/v1/templates?id=eq." + encodeURIComponent(tplId) + "&select=fr:data->frames").then(function (rows) {
        var fr = (rows && rows[0] && rows[0].fr) || []; if (!fr.length || !document.body.contains(musa)) return;
        var names = boards.map(function (b) { return b.name; }), mine = fr.filter(function (f) { return names.indexOf(f.name) >= 0; });
        drawMusa(mine.length ? mine.slice(-boards.length) : fr.slice(-boards.length));
      }, function () {});
      var orig = box.querySelector(".imp-orig");
      if (orig && original) {
        var w = (boards[0] && boards[0].width) || 1080, h = (boards[0] && boards[0].height) || 1080;
        var holder = orig.getBoundingClientRect(), s = Math.min((holder.width || 300) / Math.max(w, boards.length > 1 ? w * boards.length : w), (holder.height || 240) / h);
        var fr = document.createElement("iframe");
        fr.setAttribute("sandbox", ""); fr.setAttribute("title", "Original"); fr.setAttribute("tabindex", "-1");
        fr.style.cssText = "border:0;position:absolute;left:0;top:0;transform-origin:0 0;width:" + Math.max(w, w * boards.length) + "px;height:" + h + "px;transform:scale(" + s + ");pointer-events:none;background:#fff";
        /* como documento aparte (blob) y no srcdoc: con un HTML largo lleno de SVG el srcdoc quedaba en blanco (QA Instinct N2) */
        try { fr.src = URL.createObjectURL(new Blob([original], { type: "text/html" })); } catch (e) { fr.srcdoc = original; }
        orig.appendChild(fr);
      }
    }, 30);
    return p;
  }
  /* dónde va lo pegado: dentro del frame elegido (por defecto si hay uno) o como frame nuevo (QA Instinct 14) */
  function whereField() {
    var doc = ED.doc, fi = ED.sel ? ED.sel.f : 0, f = doc && doc.frames[fi];
    if (!f || doc._empty) return [];
    return [{ name: "where", label: "Dónde va", type: "select", value: "frame:" + fi, options: [{ value: "frame:" + fi, label: "Dentro del frame «" + f.name + "»" }, { value: "new", label: "Como frame nuevo" }] }];
  }
  function askHtml() {
    return RB.dialog({ title: "Pegar HTML", action: "paste-html", ok: "Importar", wide: true,
      message: "Pega el HTML completo (con sus <style>) o solo el cuerpo. Las imágenes con enlace https o pegadas adentro se copian a Musa.",
      fields: [{ name: "html", label: "HTML", type: "textarea", rows: 12, required: true, placeholder: "<!doctype html>…" }].concat(whereField(), optionFields()) })
      .then(function (v) {
        if (!v) return;
        if (/^frame:\d+$/.test(v.where || "")) return importIntoFrame(+v.where.split(":")[1], { html: v.html, name: "HTML pegado" });
        return importHtml({ html: v.html, name: "HTML pegado", format: v.format || undefined, split: v.split ? "auto" : "single" }, v.html);
      });
  }
  function splitImports(css) {
    var imps = [];
    var rest = String(css || "").replace(/@import\s+(?:url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)|"[^"]*"|'[^']*')[^;]*;?/g, function (m) { imps.push(/;\s*$/.test(m) ? m : m + ";"); return ""; });
    return [imps, rest];
  }
  /* mismo motor del servidor (limpia, copia imágenes y fuentes), pero sin crear frame: lo importado entra como
     un grupo dentro del frame elegido; su CSS se encierra en ese grupo para no tocar el resto del frame */
  function importIntoFrame(fi, body) {
    var doc = ED.doc;
    if (!doc || !doc._real || !doc.frames[fi]) return toast("Elige un frame para pegar adentro");
    if (importing) return toast("Ya hay una importación en curso");
    importing = true;
    var pg = RB.progress("Importando a Musa", "Guardando tus cambios…");
    body = Object.assign({}, body, { workspaceId: RB.ws, split: "single" }); delete body.templateId;
    return settle().then(function () {
      pg.set(5, "Limpiando el código…");
      return drain(api("/api/design-imports/html", J(body)), pg);
    }).then(function (d) {
      pg.close(); importing = false;
      var b = ((d.result || {}).artboards || [])[0];
      if (!b || !b.raw || !String(b.raw.html || "").trim()) throw new Error("el HTML no trajo nada que dibujar");
      if (ED.doc !== doc) throw new Error("cambiaste de diseño mientras se importaba");
      var f = doc.frames[fi]; snap();
      var pid = "p" + Date.now().toString(36), wrap = document.createElement("div");
      var w = Math.round(+b.width || 300), h = Math.round(+b.height || 300);
      wrap.setAttribute("data-paste", pid); wrap.setAttribute("data-layer-id", "musa_" + pid); wrap.setAttribute("data-layer-name", body.name || "HTML pegado"); wrap.setAttribute("data-layer-kind", "container");
      wrap.style.cssText = "position:absolute;left:" + Math.max(0, Math.round((f.w - w) / 2)) + "px;top:" + Math.max(0, Math.round((f.h - h) / 2)) + "px;width:" + w + "px;height:" + h + "px;overflow:visible";
      wrap.innerHTML = cleanHtml(b.raw.html);
      (f._content || f._root).appendChild(wrap);
      var mine = splitImports(scopeCss(cleanCss(b.raw.css || ""), '[data-paste="' + pid + '"]')), old = splitImports(f._src.css || "");
      f._src.css = old[0].concat(mine[0].filter(function (x) { return old[0].indexOf(x) < 0; })).join("\n") + "\n" + old[1].trim() + "\n/* " + (body.name || "HTML pegado") + " */\n" + mine[1].trim();
      var st = f._root.querySelector("style[data-scope]"); if (st) st.textContent = scopeCss(cleanCss(f._src.css), SCOPE(f._root.getAttribute("data-tf")));
      f.els.push(makeEl(wrap, f));
      edRender(); save(true);
      return settle().then(function () {
        var id = doc._id; RB.openDesign(id);
        /* al reabrir, cada elemento de lo pegado es su propia capa: se deja seleccionado el grupo */
        var n = 0, iv = setInterval(function () {
          var d2 = ED.doc; if (++n > 60) return clearInterval(iv);
          if (!d2 || d2 === doc || d2._id !== id || !d2.frames[fi]) return;
          clearInterval(iv);
          var at = d2.frames[fi].els.findIndex(function (e) { return e._n && e._n.getAttribute("data-paste") === pid; });
          if (at >= 0) select({ f: fi, e: at });
          toast("Pegado dentro de «" + f.name + "»" + (d.warnings && d.warnings.length ? " · " + d.warnings.length + " aviso(s): " + d.warnings[0].message : ""));
        }, 100);
      });
    }).catch(function (e) {
      pg.close(); importing = false;
      return RB.notice("No se pudo importar", errMsg(e) + "\n\nEl diseño quedó como estaba.", { action: "import-error" });
    });
  }
  function askUrl() {
    return RB.dialog({ title: "Importar desde una URL", action: "import-url", ok: "Importar",
      message: "Una página pública (https). Se trae con sus estilos, imágenes y fuentes; los scripts no corren.",
      fields: [{ name: "url", label: "URL", type: "url", required: true, placeholder: "https://…" }].concat(optionFields()),
      validate: function (v) { return /^https?:\/\/[^\s]+\.[^\s]+/i.test(v.url || "") ? "" : "Escribe una URL que empiece con https://"; } })
      .then(function (v) { if (v) return importHtml({ url: v.url.trim(), format: v.format || undefined, split: v.split ? "auto" : "single" }, null); });
  }
  function importHtmlFile(f, ask) {
    if (/\.zip$/i.test(f.name) || f.type === "application/zip" || f.type === "application/x-zip-compressed") {
      if (!ask) return importZip(f);
      return RB.dialog({ title: "Importar " + f.name, action: "import-zip", ok: "Importar", fields: optionFields() }).then(function (v) { if (v) return importZip(f, { format: v.format, split: v.split }); });
    }
    if (f.size > 8 * 1024 * 1024) return RB.notice("HTML muy pesado", "El archivo pesa más de 8 MB. Si trae imágenes pegadas adentro, mándalo como ZIP con las imágenes aparte.");
    return readText(f).then(function (t) {
      var name = f.name.replace(/\.\w+$/, "");
      if (!ask) return importHtml({ html: t, name: name }, t);
      return RB.dialog({ title: "Importar " + f.name, action: "import-html-file", ok: "Importar", fields: optionFields() })
        .then(function (v) { if (v) return importHtml({ html: t, name: name, format: v.format || undefined, split: v.split ? "auto" : "single" }, t); });
    });
  }
  var IMPORT_TYPE = { "SVG": ["svg", ".svg,image/svg+xml"], "PSD": ["psd", ".psd"], "AI": ["ai", ".ai"], "FIG (Figma)": ["fig", ".fig"], "PDF": ["pdf", ".pdf,application/pdf"], "Imagen o captura": ["image", ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"] };
  function importBinary(tp, f) {
    var doc = ED.doc, ws = RB.ws;
    toast("Subiendo " + f.name + "…");
    save(true);
    return api("/api/design-imports/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: ws, size: f.size, name: f.name, sourceType: tp[0] }) })
      .then(function (x) { var u = x.data; return fetch(u.signedUrl, { method: "PUT", headers: { "Content-Type": f.type || "application/octet-stream", "x-upsert": "false" }, body: f }).then(function (r) { if (!r.ok) throw new Error("subida " + r.status); return u.id; }); })
      .then(function (id) { toast("Convirtiendo a capas editables…"); return api("/api/design-imports/jobs/" + id + "/convert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: ws }), timeoutMs: 90000 }).then(function () { return id; }); })
      .then(function (id) { return api("/api/design-imports/jobs/" + id + "/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: ws, templateId: doc._id }) }); })
      .then(function () { toast(f.name + " importado como frames nuevos"); RB.openDesign(doc._id); })
      .catch(function (e) { RB.notice("No se pudo importar " + f.name, errMsg(e)); });
  }
  function doImport(label) {
    if (label === "Pegar HTML…") return askHtml();
    if (label === "Desde una URL…") return askUrl();
    if (label === "HTML / CSS") return pickFile(".html,.htm,text/html,.zip,application/zip").then(function (f) { if (f) return importHtmlFile(f, true); });
    if (label === "ZIP (HTML + imágenes)…") return pickFile(".zip,application/zip").then(function (f) { if (f) return importHtmlFile(f, true); });
    if (label === "Template JSON") return pickFile(".json,application/json").then(function (f) { if (!f) return; return readText(f).then(function (t) { var j = JSON.parse(t), fr = j.frames || (j.data && j.data.frames) || []; if (!fr.length) throw new Error("el JSON no trae frames"); addFrames(fr.map(function (x) { return Object.assign({}, x, { html: cleanHtml(x.html || ""), css: cleanCss(x.css || "") }); })); }); }).catch(function (e) { toast("No se pudo importar: " + e.message); });
    var tp = IMPORT_TYPE[label]; if (!tp) return toast(label + " todavía no está disponible");
    return pickFile(tp[1]).then(function (f) { if (f) return importBinary(tp, f); });
  }
  /* arrastrar archivos al lienzo */
  function dropType(f) {
    var n = f.name.toLowerCase();
    if (/\.(html?|zip)$/.test(n)) return "html";
    if (/\.svg$/.test(n)) return "SVG"; if (/\.psd$/.test(n)) return "PSD"; if (/\.ai$/.test(n)) return "AI"; if (/\.fig$/.test(n)) return "FIG (Figma)";
    return "";
  }
  edRoot.addEventListener("dragover", function (e) {
    if (!ED.open || !ED.doc || !ED.doc._real || !e.dataTransfer || [].indexOf.call(e.dataTransfer.types || [], "Files") < 0) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "copy";
  });
  edRoot.addEventListener("drop", function (e) {
    if (!ED.open || !ED.doc || !ED.doc._real || !e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    var f = e.dataTransfer.files[0], t = dropType(f);
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    if (t === "html") importHtmlFile(f, false); else importBinary(IMPORT_TYPE[t], f);
  }, true);
  /* Ctrl+V de código HTML en el lienzo (fuera de campos de texto) */
  document.addEventListener("paste", function (e) {
    if (!ED.open || !ED.doc || !ED.doc._real || importing) return;
    var t = e.target, tag = t && t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || (t && t.isContentEditable) || (t && t.closest && t.closest("[data-musa-dialog]"))) return;
    var txt = (e.clipboardData && e.clipboardData.getData("text/plain")) || "";
    if (txt.length < 30 || !/^\s*(?:<!doctype html|<html|<head|<body|<style|<(?:div|section|main|article|svg)\b)/i.test(txt) || !/<\/\w+>/.test(txt)) return;
    e.preventDefault(); e.stopPropagation();
    /* con un frame elegido se puede pegar adentro de ese frame, no solo como frame nuevo (QA Instinct 14) */
    var wf = whereField();
    RB.dialog({ title: "¿Importar el HTML pegado?", action: "paste-html-confirm", ok: "Importar", message: "Pegaste código HTML (" + Math.max(1, Math.round(txt.length / 1024)) + " KB).", fields: wf })
      .then(function (v) {
        if (!v) return;
        if (/^frame:\d+$/.test(v.where || "")) return importIntoFrame(+v.where.split(":")[1], { html: txt, name: "HTML pegado" });
        importHtml({ html: txt, name: "HTML pegado" }, txt);
      });
  }, true);
  /* Importar sin tener un diseño abierto: se crea uno nuevo y se importa ahí.
     Los de archivo eligen el archivo PRIMERO (el navegador solo abre el selector justo después de un clic). */
  var pendingImport = null;
  var NEW_KINDS = [
    { value: "Pegar HTML…", label: "Pegar HTML", hint: "Código de una IA o de otra herramienta, con sus estilos" },
    { value: "HTML / CSS", label: "Archivo HTML o ZIP", hint: "Un .html, o un .zip con su carpeta de CSS, imágenes y fuentes" },
    { value: "Desde una URL…", label: "Desde una URL", hint: "Una página pública" },
    { value: "FIG (Figma)", label: "Figma (.fig)", hint: "Archivo exportado desde Figma, con capas editables" },
    { value: "Imagen o captura", label: "Imagen o captura", hint: "PNG, JPG o WEBP como fondo de un frame" },
    { value: "PDF", label: "PDF", hint: "Cada página, un frame" },
    { value: "PSD", label: "Photoshop (.psd)" }, { value: "AI", label: "Illustrator (.ai)" }, { value: "SVG", label: "SVG" },
  ];
  function newDesignFor(name) {
    return api("/api/templates", J({ name: name, workspaceId: RB.ws, engine: "html", initialFrame: false }))
      .then(function (x) { var id = (x && x.data && x.data.id) || (x && x.id); if (!id) throw new Error("no se pudo crear el diseño"); return id; });
  }
  /* Primero se pide todo (archivo, código o URL, el nombre y el formato) y recién al confirmar se crea el diseño:
     antes se creaba el archivo «1-p3» con el nombre del ZIP aunque cancelaras (QA Instinct 8). */
  RB.importNew = function (kind) {
    if (!RB.on || !RB.ws) return;
    var fileKind = kind === "HTML / CSS" ? ".html,.htm,text/html,.zip,application/zip" : IMPORT_TYPE[kind] ? IMPORT_TYPE[kind][1] : null;
    var pick = fileKind ? pickFile(fileKind, "Archivo a importar") : Promise.resolve(null);
    return pick.then(function (file) {
      if (fileKind && !file) return;
      var htmlish = kind === "HTML / CSS" || kind === "Pegar HTML…" || kind === "Desde una URL…";
      var guess = file ? file.name.replace(/\.\w+$/, "") : "";
      /* el nombre se pide, no se inventa («HTML importado»): va primero y vacío si no hay archivo (QA Instinct 8) */
      var fields = [{ name: "name", label: "Nombre del diseño", value: guess, required: true, placeholder: kind === "Desde una URL…" ? "p. ej. Landing de la campaña" : "p. ej. Post lanzamiento" }];
      if (kind === "Pegar HTML…") fields.push({ name: "html", label: "HTML", type: "textarea", rows: 10, required: true, placeholder: "<!doctype html>…" });
      if (kind === "Desde una URL…") fields.push({ name: "url", label: "URL", type: "url", required: true, placeholder: "https://…" });
      if (htmlish) fields = fields.concat(optionFields());
      return RB.dialog({ title: file ? "Importar " + file.name : kind === "Desde una URL…" ? "Importar desde una URL" : kind === "Pegar HTML…" ? "Pegar HTML" : "Importar", action: "import-new", ok: "Importar", wide: kind === "Pegar HTML…", fields: fields,
        message: kind === "Pegar HTML…" ? "Pega el HTML completo (con sus <style>) o solo el cuerpo. Las imágenes con enlace https o pegadas adentro se copian a Musa." : kind === "Desde una URL…" ? "Una página pública (https). Se trae con sus estilos, imágenes y fuentes; los scripts no corren." : "",
        validate: function (v) { if (kind === "Desde una URL…" && !/^https?:\/\/[^\s]+\.[^\s]+/i.test(v.url || "")) return "Escribe una URL que empiece con https://"; return (v.name || "").trim() ? "" : "Ponle un nombre al diseño"; } })
        .then(function (v) {
          if (!v) return;
          var name = String(v.name || guess || "Diseño importado").trim().slice(0, 120);
          var pg = RB.progress("Preparando el diseño", "Creando «" + name + "»…");
          return newDesignFor(name).then(function (id) {
            pg.close();
            pendingImport = { id: id, kind: kind, file: file, name: name, html: v.html, url: v.url, format: v.format || undefined, split: v.split === false ? "single" : "auto" };
            RB.openDesign(id);
          }, function (e) { pg.close(); RB.notice("No se pudo crear el diseño", errMsg(e)); });
        });
    });
  };
  function runPending(doc) {
    var bj = RB._pendingBatch; if (bj && bj.id === doc._id) { RB._pendingBatch = null; setTimeout(function () { if (ED.doc === doc) { ED.sel = { f: 0, e: null }; RB.applyCsvText(bj.csv, "la planilla"); } }, 700); }
    var job = pendingImport; if (!job || job.id !== doc._id) return;
    pendingImport = null;
    setTimeout(function () {
      var o = { name: job.name, format: job.format, split: job.split };
      if (job.html) return importHtml({ html: job.html, name: job.name, format: o.format, split: o.split }, job.html);
      if (job.url) return importHtml({ url: job.url.trim(), name: job.name, format: o.format, split: o.split }, null);
      if (!job.file) return doImport(job.kind);
      if (job.kind !== "HTML / CSS") return importBinary(IMPORT_TYPE[job.kind], job.file);
      if (/\.zip$/i.test(job.file.name) || /zip/.test(job.file.type || "")) return importZip(job.file, { name: job.name, format: o.format, split: o.split !== "single" });
      return readText(job.file).then(function (t) { return importHtml({ html: t, name: job.name, format: o.format, split: o.split }, t); });
    }, 500);
  }
  RB.importChooser = function () {
    return RB.choose("Se crea un diseño nuevo con lo que importes. Todo queda editable.", NEW_KINDS, { title: "Importar a Musa", action: "import-chooser" })
      .then(function (k) { if (k) return RB.importNew(k); });
  };
  /* El botón «Importar» de Diseños y Crear › Importar abrían un diálogo de demostración con pasos falsos. */
  document.addEventListener("click", function (e) {
    if (!RB.on || !e.target.closest) return;
    var b = e.target.closest('[data-fx="imp"], .fx-menu [data-cm="import"]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    document.querySelectorAll(".fx-menu").forEach(function (x) { x.remove(); });
    RB.importChooser();
  }, true);
  /* Un diseño de ejemplo (Datos de ejemplo) no se puede importar ni exportar: se ofrece crear uno propio. */
  function sampleOffer(what) {
    return RB.dialog({ title: "Este es un diseño de ejemplo", action: "sample-design", ok: what === "import" ? "Crear un diseño e importar" : "Crear un diseño", message: "Los diseños de ejemplo muestran cómo se ve Musa con uso real, pero no se guardan ni se exportan. " + (what === "import" ? "Importa a un diseño tuyo:" : "Crea uno tuyo para exportarlo.") })
      .then(function (v) { if (!v) return; if (what === "import") return RB.importChooser(); if (window.__musaCreate) window.__musaCreate.open("diseno"); });
  }

  /* Diseños › Plantillas › «Abrir en el editor» mandaba a un diseño de ejemplo de la maqueta (el de tamaño más
     parecido). Conectado, crea un diseño nuevo con el nombre y el tamaño de la plantilla. */
  try {
    var tplDz = TPL_DEF["crear/disenos"], _tplUse = tplDz && tplDz.use;
    if (_tplUse) tplDz.use = function (x, i) {
      if (!RB.on || !window.__musaCreate) return _tplUse.apply(this, arguments);
      var row = (typeof TPL_DZ !== "undefined" && TPL_DZ[i]) || [];
      return window.__musaCreate.open("diseno", { name: x.t, w: row[2], h: row[3] });
    };
  } catch (e) {}

  /* para agentes y pruebas: la misma importación sin pasar por menús */
  RB.importHtml = function (body) { return importHtml(Object.assign({}, body), body && body.html || null); };

  /* Batch: un CSV → un frame por fila. Cada columna reemplaza el texto de la capa con ese nombre o {{columna}} */
  function parseCsv(t) {
    var rows = [], row = [], cur = "", q = false;
    for (var i = 0; i < t.length; i++) {
      var ch = t[i];
      if (q) { if (ch === '"' && t[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === "," || ch === ";") { row.push(cur); cur = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && t[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; } else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return c.trim(); }); });
  }
  function doBatch() {
    var doc = ED.doc, base = doc.frames[ED.sel ? ED.sel.f : 0];
    if (!base) return toast("Abre un diseño con al menos un frame");
    pickFile(".csv,text/csv").then(function (f) {
      if (!f) return;
      return readText(f).then(function (t) { applyCsv(doc, base, t, f.name); });
    }).catch(function (e) { toast("No se pudo aplicar el CSV: " + errMsg(e)); });
  }
  RB.applyCsvText = function (text, label) {
    var doc = ED.doc, base = doc && doc.frames[ED.sel ? ED.sel.f : 0];
    if (!doc || !doc._real || !base) return toast("Abre un diseño con al menos un frame");
    try { applyCsv(doc, base, text, label || "la planilla"); } catch (e) { toast("No se pudo aplicar el CSV: " + errMsg(e)); }
  };
  function applyCsv(doc, base, t, label) {
    (function () {
      {
        if (!t || !t.trim()) throw new Error("el archivo está vacío");
        var rows = parseCsv(t), head = (rows.shift() || []).map(function (h) { return h.trim(); });
        if (!head.length) throw new Error("el CSV no tiene encabezados: la primera fila debe listar los nombres de las capas de texto a reemplazar (una columna por capa), y cada fila de datos genera un frame");
        if (!rows.length) throw new Error("el CSV no tiene filas");
        var src = payload({ name: doc.name, frames: [base] }).frames[0];
        var out = rows.slice(0, 200).map(function (r, ri) {
          var tmp = document.createElement("div"); tmp.innerHTML = src.html;
          head.forEach(function (h, ci) {
            var v = r[ci] == null ? "" : r[ci];
            tmp.querySelectorAll("[data-layer-name],[data-layer-id]").forEach(function (n) {
              var nm = (n.getAttribute("data-layer-name") || n.getAttribute("data-layer-id") || "").toLowerCase();
              if (nm === h.toLowerCase()) { if (n.tagName === "IMG" && /^https?:/.test(v)) n.setAttribute("src", v); else if (!n.children.length) n.textContent = v; else n.innerText = v; }
            });
          });
          var html = tmp.innerHTML;
          head.forEach(function (h, ci) { html = html.split("{{" + h + "}}").join(String(r[ci] == null ? "" : r[ci]).replace(/</g, "&lt;")); });
          return Object.assign({}, src, { id: "frame_" + Date.now().toString(36) + ri, name: base.name + " · " + (r[0] || ri + 1), html: html });
        });
        addFrames(out);
        toast(out.length + " frames creados desde " + label);
      }
    })();
  }
  function shareUrl(doc) { var o; try { o = window.parent.location.origin; } catch (e) { o = location.origin; } return o + "/c/" + doc._id; }
  /* Un solo estado con tres niveles, el mismo que muestra la tarjeta en Mis diseños (QA Instinct 12: el diálogo decía
     «Privado» y la tarjeta «Compartido» porque miraban columnas distintas):
     solo yo = visibility private · equipo = shared · público = shared + is_public (enlace /c/) */
  function shareMode(doc) { return doc._public ? "publico" : doc._vis === "shared" ? "equipo" : "solo"; }
  RB.shareLabel = function (vis, pub) { return pub ? "Público" : vis === "shared" ? "Equipo" : "Solo yo"; };
  function setShare(doc, mode) {
    var body = { is_public: mode === "publico", visibility: mode === "solo" ? "private" : "shared" };
    return api("/rest/v1/templates?id=eq." + encodeURIComponent(doc._id), { method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(body) })
      .then(function () {
        doc._public = body.is_public; doc._vis = body.visibility; ED.share = mode === "publico" ? "publico" : "privado";
        if (RB.onShareChange) RB.onShareChange(doc._id, body.visibility, body.is_public);
        toast(mode === "publico" ? "Ahora es público: quien tenga el enlace lo ve y comenta" : mode === "equipo" ? "Ahora lo ve tu equipo (no es público)" : "Ahora solo lo ves tú (y los admins)");
      }, function (e) { toast("No se pudo cambiar: " + (e && e.message)); });
  }
  function setPublic(doc, on) { return setShare(doc, on ? "publico" : "equipo"); }
  /* ── panel de Capas con diseños pesados ──
     Cada capa son ~13 nodos en el panel: un frame importado con 12.000 elementos ponía ~155.000 nodos en la
     página y la pestaña se podía caer por memoria. Se muestran hasta 300 capas por frame (las de arriba y las
     cercanas a la selección) y un botón para ver más; el lienzo y la selección en el lienzo siguen completos. */
  if (typeof edLayers === "function") {
    var LAYER_CAP = 300, _edLayersFull = edLayers;
    ED.layerShow = ED.layerShow || {};
    edLayers = function () {
      var doc = ED.doc;
      if (!doc || !doc.frames || ED.lt === "recursos") return _edLayersFull.apply(this, arguments);
      var swapped = [];
      doc.frames.forEach(function (f, fi) {
        var n = f.els ? f.els.length : 0, cap = ED.layerShow[fi] || LAYER_CAP;
        if (n <= cap || ED.fold[fi]) return;
        var real = f.els, sparse = new Array(n), shown = 0;
        for (var i = n - 1; i >= 0 && shown < cap; i--, shown++) sparse[i] = real[i];
        var se = ED.sel && ED.sel.f === fi && ED.sel.e != null ? ED.sel.e : -1;
        if (se >= 0) for (var j = Math.max(0, se - 40); j <= Math.min(n - 1, se + 40); j++) if (!(j in sparse)) { sparse[j] = real[j]; shown++; }
        f.els = sparse; swapped.push([f, real, fi, shown, n]);
      });
      try { return _edLayersFull.apply(this, arguments); }
      finally {
        swapped.forEach(function (x) {
          x[0].els = x[1];
          var box = document.querySelector("#edLayers"), rows = box ? box.querySelectorAll('.ed-ly[data-f="' + x[2] + '"][data-e]') : [];
          var last = rows[rows.length - 1] || (box && box.querySelector('.ed-ly.fr[data-f="' + x[2] + '"]'));
          if (!last) return;
          var more = document.createElement("div");
          more.className = "ed-note"; more.style.cssText = "padding:8px 12px;display:flex;gap:8px;align-items:center;justify-content:space-between;font-size:11px";
          more.innerHTML = "<span>" + x[3] + " de " + x[4] + " capas · elige en el lienzo para ir a cualquiera</span>";
          var bt = document.createElement("button"); bt.className = "ed-btn"; bt.type = "button"; bt.textContent = "Mostrar más"; bt.setAttribute("data-action", "layers-more");
          bt.onclick = function (e) { e.stopPropagation(); ED.layerShow[x[2]] = (ED.layerShow[x[2]] || LAYER_CAP) + LAYER_CAP * 2; edLayers(); };
          more.appendChild(bt); last.after(more);
        });
      }
    };
  }
  if (typeof itemsHTML === "function") {
    var _itemsHTML = itemsHTML;
    var slug = function (t) { return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); };
    itemsHTML = function (items, base) {
      return _itemsHTML(items, base).replace(/<div class="ed-mi" role="menuitem" data-mi="([^"]+)">/g, function (m, id) {
        var it = menuItems[id]; if (!it || !it.l) return m;
        return '<div class="ed-mi" role="menuitem" data-mi="' + id + '" data-action="' + slug(it.l) + '" aria-label="' + escH(it.l) + '">';
      });
    };
  }
  var _mImp = MENUS.import, _mBatch = MENUS.batch, _mShare = MENUS.compartir, _mEditor = MENUS.editor;
  MENUS.import = function () {
    var it = _mImp();
    if (ED.doc && !ED.doc._real && RB.on) return it.map(function (x) { return x && x.l ? Object.assign({}, x, { fn: function () { sampleOffer("import"); } }) : x; });
    if (!ED.doc || !ED.doc._real) return it;
    var D = { "HTML / CSS": "Archivo .html o .zip con sus imágenes", "Pegar HTML…": "Código con sus &lt;style&gt;; se limpia y se copia a Musa", "SVG": "Vector", "Template JSON": "Frames exportados de Musa" };
    var out = it.map(function (x) { return x && x.l ? Object.assign({}, x, { d: x.d || D[x.l], fn: function () { doImport(x.l); } }) : x; });
    var at = out.findIndex(function (x) { return x && x.l === "Pegar HTML…"; });
    out.splice(at < 0 ? out.length : at + 1, 0,
      { l: "Desde una URL…", d: "Una página pública con sus estilos e imágenes", fn: function () { doImport("Desde una URL…"); } },
      { l: "ZIP (HTML + imágenes)…", d: "index.html con su carpeta de CSS, imágenes y fuentes", fn: function () { doImport("ZIP (HTML + imágenes)…"); } });
    return out;
  };
  MENUS.batch = function () { var it = _mBatch(); if (!ED.doc || !ED.doc._real) return it; return it.map(function (x) { return x && x.l ? Object.assign({}, x, { d: (x.d ? x.d + " · " : "") + "desde un CSV", fn: doBatch }) : x; }); };
  MENUS.compartir = function () {
    var it = _mShare(); if (!ED.doc || !ED.doc._real) return it; var doc = ED.doc;
    ED.share = doc._public ? "publico" : "privado";
    return _mShare().map(function (x) {
      if (!x || !x.l) return x;
      if (x.l === "Copiar enlace") return Object.assign({}, x, { d: shareUrl(doc).replace(/^https?:\/\//, ""), fn: function () { var u = shareUrl(doc); (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(function () { toast("Enlace copiado" + (doc._public ? "" : " · hazlo público para que tus invitados lo vean")); }, function () { window.__musaReal.promptBox("Copia el enlace", u, { title: "Copia el enlace", label: "Enlace", ok: "Listo" }); }); } });
      if (x.l === "Privado") return [
        { l: "Solo yo", d: "Solo tú y los admins del espacio", on: shareMode(doc) === "solo", fn: function () { setShare(doc, "solo"); } },
        { l: "Equipo", d: "Tu equipo y los clientes de la marca; no es público", on: shareMode(doc) === "equipo", fn: function () { setShare(doc, "equipo"); } }];
      if (x.l === "Público") return Object.assign({}, x, { d: "Quien tenga el enlace lo ve y comenta", on: shareMode(doc) === "publico", fn: function () { setShare(doc, "publico"); } });
      return x;
    }).reduce(function (a, x) { return a.concat(Array.isArray(x) ? x : [x]); }, []);
  };
  MENUS.editor = function () {
    var it = _mEditor(); if (!ED.doc || !ED.doc._real) return it;
    return it.map(function (x) { return x && x.l === "Editor de video" ? Object.assign({}, x, { fn: function () { if (RB.videoFromDesign) RB.videoFromDesign(ED.doc); } }) : x; });
  };
  RB._buildFrame = function (src, x) { return buildFrame(src, ED.doc.frames.length, x); };
  RB.shotFrame = function (f) { return shot(f, 1).then(function (c) { return c.toDataURL("image/jpeg", 0.9); }); };
  RB.shotFramePng = function (f, prep, bg) { return shot(f, 1, prep, bg).then(function (c) { return c.toDataURL("image/png"); }); };

  if (typeof phFilm === "function") {
    var _phFilm = phFilm;
    phFilm = function () {
      _phFilm.apply(this, arguments);
      if (!PH.doc || !PH.doc._real) return;
      var box = pq("#phFilm");
      if (PH.lt === "biblioteca") {
        var lib = (RB.assets || []).filter(function (a) { return /^image/.test(a.mime_type || "") && a.url; }).slice(0, 120);
        pq("#phLSub").textContent = "Tus imágenes · " + lib.length + " fotos";
        PH.libList = lib.map(function (a) { return { e: { name: a.name || "Foto", fill: "url('" + a.url + "')" }, d: { name: "Tus archivos", brand: "" }, url: a.url }; });
        var film = box.querySelector(".ph-film");
        if (film) film.innerHTML = PH.libList.map(function (x, i) { return '<button class="ph-fi" data-plib="' + i + '" title="' + eesc(x.e.name) + '"><span class="th" style="background-image:url(&#39;' + eesc(x.url) + '&#39;)"></span><span>' + eesc(x.e.name) + "</span></button>"; }).join("");
        return;
      }
      box.querySelectorAll("[data-ptg]").forEach(function (b) {
        var k = b.dataset.ptg; if (!/^\d+$/.test(k)) return;
        var f = PH.doc.frames[+k], th = b.querySelector(".th"); if (!f || !th) return;
        var s = Math.min(92 / f.w, 92 / f.h);
        th.innerHTML = ""; th.appendChild(stage(frameClone(f), f.w, f.h, f.bg, s)); th.insertAdjacentHTML("beforeend", "<em>Frame</em>");
      });
    };
    /* biblioteca: la foto se abre con permiso de lectura (CORS) para poder revelarla */
    pq("#phFilm").addEventListener("click", function (e) {
      var l = e.target.closest && e.target.closest("[data-plib]");
      if (!l || !PH.doc || !PH.doc._real) return;
      e.stopPropagation(); e.preventDefault();
      var x = PH.libList[+l.dataset.plib]; if (!x) return;
      phToast("Abriendo foto…");
      var im = new Image(); im.crossOrigin = "anonymous";
      im.onload = function () {
        var cv = phCanvas(im.naturalWidth, im.naturalHeight); cv.getContext("2d").drawImage(im, 0, 0); PH_SRC.set(x.url, cv);
        var t2 = phCanvas(120, 120 * cv.height / cv.width); t2.getContext("2d").drawImage(cv, 0, 0, t2.width, t2.height);
        PH.ups.push({ name: x.e.name, from: "Tus archivos", cv: cv, thumb: t2.toDataURL("image/jpeg", .8) });
        PH.lt = "fotos"; phGo("u" + (PH.ups.length - 1));
      };
      im.onerror = function () { phToast("No se pudo abrir esa foto"); };
      im.src = x.url;
    }, true);
  }

  /* ═════ Editor de diseño: lo que faltaba conectar ═════ */
  function cleanClone(n) {
    var c = bakeInto(n, n.cloneNode(true));
    [c].concat([].slice.call(c.querySelectorAll("*"))).forEach(function (x) {
      if (x.classList) x.classList.remove("ed-el");
      if (x.getAttribute && x.getAttribute("class") === "") x.removeAttribute("class");
      ["data-real", "data-f", "data-e", "contenteditable"].forEach(function (a) { if (x.removeAttribute) x.removeAttribute(a); });
      if (x.getAttribute && x.getAttribute("data-layer-id")) x.setAttribute("data-layer-id", "musa_" + Date.now().toString(36) + (uid++));
    });
    return c;
  }
  function addClone(f, html, near, d) {
    var tmp = document.createElement("div"); tmp.innerHTML = html; var n = tmp.firstElementChild; if (!n) return -1;
    if (near && near.parentNode && f._root.contains(near)) near.parentNode.insertBefore(n, near.nextSibling); else (f._content || f._root).appendChild(n);
    var nm = n.getAttribute("data-layer-name"); n.setAttribute("data-layer-name", (nm || "Capa") + " copia");
    var add = [n].concat([].slice.call(n.querySelectorAll("[data-layer-id]"))).map(function (x) { return makeEl(x, f); });
    var at = f.els.length;
    f.els.push.apply(f.els, add);
    if (d) { edRender(); moveBy(n, d, d); }
    return at;
  }
  var _act = act;
  act = function (a) {
    var doc = ED.doc;
    if (!doc || !doc._real) return _act.apply(this, arguments);
    var s = ED.sel, o = selObj(), isEl = s && s.e != null;
    if (a === "copy" && isEl && o && o._n) { ED.clip = JSON.stringify({ realHtml: cleanClone(o._n).outerHTML, f: s.f }); return toast("Copiado"); }
    if (a === "paste" || a === "duplicate" || a === "pasteAll") {
      var src = null;
      if (a === "duplicate") src = isEl && o && o._n ? { realHtml: cleanClone(o._n).outerHTML, f: s.f } : null;
      else { try { src = JSON.parse(ED.clip || "null"); } catch (e) { src = null; } }
      if (src && src.realHtml) {
        snap();
        if (a === "pasteAll") {
          doc.frames.forEach(function (f) { addClone(f, src.realHtml, null, 0); });
          edRender(); edLayers(); return toast("Pegado en " + doc.frames.length + " frames");
        }
        var fi = s ? s.f : src.f, at = addClone(doc.frames[fi], src.realHtml, a === "duplicate" ? o._n : null, 40);
        return select({ f: fi, e: at });
      }
    }
    if (a === "saveVersion") {
      return window.__musaReal.promptBox("Nombre de la versión", "Versión guardada a mano", { title: "Guardar versión", label: "Nombre", ok: "Guardar" }).then(function (label) { if (label === null) return;
      save(true);
      setTimeout(function () {
        api("/api/templates/" + encodeURIComponent(doc._id) + "/versions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: label, kind: "marked" }) })
          .then(function () { toast("Versión guardada"); return loadVersions(doc); }, function (e) { toast("No se pudo guardar la versión: " + (e && e.message)); });
      }, 1600);
      return;
    });
    }
    return _act.apply(this, arguments);
  };

  /* Historial: versiones reales del diseño.
     El autor se muestra como nombre real (no "human:<uuid>"): se resuelve contra los
     miembros del workspace con cache por sesión; si no hay match, se muestra "Tú". */
  var _whoCache = {};
  function resolveWho(raw) {
    var who = raw || "";
    var m = /^human:([0-9a-f-]{8,})$/i.exec(who);
    if (!m) return who || "—";
    var uid = m[1];
    if (_whoCache[uid]) return _whoCache[uid];
    if (_whoCache._pending) return "Tú";
    _whoCache._pending = true;
    try {
      var ws = (window.__musaReal && window.__musaReal.ws) || null;
      if (ws) api("/api/workspaces/" + encodeURIComponent(ws) + "/members").then(function (x) {
        var mem = (x && x.data) || [];
        mem.forEach(function (mm) { if (mm && mm.id) _whoCache[mm.id] = mm.display_name || (mm.email || "").split("@")[0] || "Miembro"; });
        var mine = mem.filter(function (mm) { return mm.id === uid; })[0];
        _whoCache[uid] = mine ? (mine.display_name || (mine.email || "").split("@")[0]) : "Tú";
        _whoCache._pending = false;
        if (ED.open && ED.panel === "historial") edProps();
      }).catch(function () { _whoCache[uid] = "Tú"; _whoCache._pending = false; });
    } catch (e) { _whoCache._pending = false; }
    return "Tú";
  }
  function loadVersions(doc) {
    return api("/api/templates/" + encodeURIComponent(doc._id) + "/versions?limit=30").then(function (x) {
      var list = (x && (x.data || x)) || [];
      list = Array.isArray(list) ? list : [];
      doc._versions = list;
      ED.versions = list.map(function (v, i) {
        var d = v.created_at || v.createdAt, who = resolveWho(v.author || v.author_name || v.createdBy || "");
        return [(v.label || (v.kind === "auto" ? "Autoguardado" : "Versión")) + " · " + (list.length - i), d ? new Date(d).toLocaleString("es-PE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "", who || "—"];
      });
      if (ED.open && ED.panel === "historial") edProps();
    }, function () { ED.versions = []; });
  }
  edRoot.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest('[data-demo^="Restaurar "]');
    if (!b || !ED.doc || !ED.doc._real) return;
    e.stopPropagation(); e.preventDefault();
    var all = [].slice.call(edRoot.querySelectorAll('[data-demo^="Restaurar "]')), v = (ED.doc._versions || [])[all.indexOf(b)];
    if (!v) return; return window.__musaReal.confirmBox("El estado actual queda guardado como versión.", { title: "¿Restaurar esta versión?", ok: "Restaurar" }).then(function (ok) { if (!ok) return;
    var id = ED.doc._id;
    save(true);
    api("/api/templates/" + encodeURIComponent(id) + "/versions/" + encodeURIComponent(v.id || v.versionId) + "/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(function () { toast("Versión restaurada"); RB.openDesign(id); }, function (err) { toast("No se pudo restaurar: " + (err && err.message)); });
  });
  }, true);

  /* Comentarios: pines reales (design_comments) */
  function loadPins(doc) {
    return api("/api/templates/" + encodeURIComponent(doc._id) + "/comments").then(function (x) {
      var list = (x && x.data) || [];
      ED.pins = list.filter(function (c) { return c.status !== "resolved"; }).map(function (c) {
        var fi = Math.max(0, doc.frames.findIndex(function (f) { return f._src && f._src.id === c.frame_id; })), f = doc.frames[fi] || doc.frames[0];
        var p = { x: f.x + f.w * (c.x_pct == null ? 50 : c.x_pct) / 100, y: f.y + f.h * (c.y_pct == null ? 50 : c.y_pct) / 100, t: (c.author_name ? c.author_name + ": " : "") + c.body, open: false };
        Object.defineProperty(p, "_id", { value: c.id, enumerable: false });
        return p;
      });
      if (ED.open && ED.doc === doc) edRender();
    }, function () {});
  }
  function syncPins(doc) {
    (ED.pins || []).forEach(function (p) {
      if (p._id || p._posting || !p.t || p.edit) return;
      var fi = frameAt(p.x, p.y), f = doc.frames[fi >= 0 ? fi : 0]; if (!f) return;
      Object.defineProperty(p, "_posting", { value: true, writable: true, enumerable: false });
      api("/api/templates/" + encodeURIComponent(doc._id) + "/comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: p.t, frameId: f._src && f._src.id, xPct: Math.round((p.x - f.x) / f.w * 1000) / 10, yPct: Math.round((p.y - f.y) / f.h * 1000) / 10, source: "editor_pin" }) })
        .then(function (x) { var c = x && x.data; if (c) Object.defineProperty(p, "_id", { value: c.id, enumerable: false }); }, function (e) { p._posting = false; toast("No se pudo guardar el comentario: " + (e && e.message)); });
    });
  }
  setInterval(function () { if (ED.open && ED.doc && ED.doc._real) syncPins(ED.doc); }, 1500);

  /* menú contextual: agrupar, desagrupar, recortar con máscara, plantilla, design system, BatchAMator */
  function groupSel() {
    var o = selObj(), s = ED.sel; if (!o || !o._n || !s || s.e == null) return toast("Selecciona una capa");
    var f = ED.doc.frames[s.f], n = o._n, c0 = getComputedStyle(n); snap();
    var g = document.createElement("div");
    g.setAttribute("data-layer-id", "group_" + Date.now().toString(36)); g.setAttribute("data-layer-name", "Grupo"); g.setAttribute("data-layer-kind", "container");
    if (c0.position === "absolute") { g.style.cssText = "position:absolute;left:" + c0.left + ";top:" + c0.top + ";width:" + c0.width + ";height:" + c0.height; n.style.left = "0px"; n.style.top = "0px"; }
    n.parentNode.insertBefore(g, n); g.appendChild(n);
    f.els.splice(s.e, 0, makeEl(g, f)); edRender(); edLayers(); select({ f: s.f, e: s.e }); toast("Agrupado");
  }
  function ungroup(n, f) {
    var par = n.parentNode, c0 = getComputedStyle(n), dx = parseFloat(c0.left) || 0, dy = parseFloat(c0.top) || 0, abs = c0.position === "absolute";
    [].slice.call(n.children).forEach(function (k) {
      if (abs && getComputedStyle(k).position === "absolute") { k.style.left = (parseFloat(getComputedStyle(k).left) || 0) + dx + "px"; k.style.top = (parseFloat(getComputedStyle(k).top) || 0) + dy + "px"; }
      par.insertBefore(k, n);
    });
    n.remove();
    f.els = f.els.filter(function (e) { return e._n !== n; });
  }
  function ungroupSel(all) {
    var s = ED.sel; if (!s) return toast("Selecciona un grupo o un frame");
    var f = ED.doc.frames[s.f]; snap();
    var groups = all ? f.els.filter(function (e) { return e._n.children.length && !/^(P|H\d|SPAN|A|LI|BUTTON|SVG|svg)$/.test(e._n.tagName) && e._n !== f._content; }).map(function (e) { return e._n; })
      : (selObj() && selObj()._n && selObj()._n.children.length ? [selObj()._n] : []);
    if (!groups.length) return toast("No hay grupos para desagrupar");
    groups.reverse().forEach(function (n) { if (f._root.contains(n)) ungroup(n, f); });
    ED.sel = null; edRender(); edLayers(); edProps(); toast(groups.length + (groups.length === 1 ? " grupo desagrupado" : " grupos desagrupados"));
  }
  function maskSel() {
    var o = selObj(); if (!o || !o._n || !ED.sel || ED.sel.e == null) return toast("Selecciona la capa a recortar");
    return window.__musaReal.choose("", ["círculo", "redondeado", "rombo", "triángulo", "ninguna"].map(function (x) { return { value: x, label: x[0].toUpperCase() + x.slice(1) }; }), { title: "Forma de la máscara", action: "mask-shape" }).then(function (k) { if (!k) return;
    var shapes = { "círculo": "circle(50% at 50% 50%)", "circulo": "circle(50% at 50% 50%)", "redondeado": "inset(0 round 12%)", "rombo": "polygon(50% 0,100% 50%,50% 100%,0 50%)", "triángulo": "polygon(50% 0,100% 100%,0 100%)", "triangulo": "polygon(50% 0,100% 100%,0 100%)", "ninguna": "" };
    var shape = shapes[k.trim().toLowerCase()];
    if (shape === undefined) return toast("Forma no reconocida");
    snap(); o._n.style.clipPath = shape; if (o._n.tagName === "IMG") o._n.style.objectFit = "cover"; edRender(); toast(shape ? "Máscara aplicada" : "Máscara quitada");
  });
  }
  function frameToTemplate() {
    var s = ED.sel, f = ED.doc.frames[s ? s.f : 0]; if (!f) return;
    var src = payload({ name: ED.doc.name, frames: [f] }).frames[0]; return window.__musaReal.promptBox("Nombre de la plantilla", f.name, { title: "Guardar como plantilla", label: "Nombre", ok: "Guardar" }).then(function (name) { if (!name) return;
    api("/api/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name, width: f.w, height: f.h, workspaceId: RB.ws, engine: "html", html: src.html, css: src.css }) })
      .then(function (x) {
        var t = (x && (x.data || x.template)) || x, id = t && (t.id || (t.template && t.template.id)); if (!id) throw new Error("sin id");
        return api("/api/templates/" + encodeURIComponent(id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name, frames: [Object.assign({}, src, { id: "frame_" + Date.now().toString(36), x: 0, y: 0 })] }) }).then(function () { return id; });
      })
      .then(function (id) { RB.tpl.unshift({ id: id, name: name, w: f.w, h: f.h }); TILES["crear/disenos"].unshift([eesc(name), "Sin marca", f.w + "×" + f.h]); toast("Plantilla «" + name + "» creada en Crear › Diseños"); }, function (e) { toast("No se pudo crear la plantilla: " + (e && e.message)); });
  });
  }
  function fileToDS() {
    toast("Extrayendo el design system…");
    save(true);
    setTimeout(function () {
      RB.mcp("extract_design_system", { templateIds: [ED.doc._id], workspaceId: RB.ws, name: ED.doc.name + " · design system" })
        .then(function (r) { toast("Design system creado: " + ((r && (r.name || (r.guideline && r.guideline.name))) || ED.doc.name)); }, function (e) { toast("No se pudo extraer: " + (e && e.message)); });
    }, 1600);
  }
  var _openCtx = openCtx;
  openCtx = function () {
    var r = _openCtx.apply(this, arguments);
    if (!ED.doc || !ED.doc._real) return r;
    var MAP = { "Agrupar": groupSel, "Desagrupar": function () { ungroupSel(false); }, "Desagrupar todo": function () { ungroupSel(true); }, "Recortar con máscara": maskSel, "BatchAMator": doBatch, "Convertir frame en plantilla": frameToTemplate, "Convertir archivo en design system": fileToDS };
    Object.keys(menuItems).forEach(function (k) { var it = menuItems[k]; if (it && MAP[it.l]) it.fn = MAP[it.l]; });
    return r;
  };
  document.addEventListener("keydown", function (e) {
    if (!ED.open || !ED.doc || !ED.doc._real || !(e.ctrlKey || e.metaKey) || String(e.key).toLowerCase() !== "g") return;
    if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    e.preventDefault(); e.stopPropagation(); if (e.shiftKey) ungroupSel(false); else groupSel();
  }, true);

  /* Recursos, imágenes y marca */
  function pickImage() {
    return pickFile("image/*", "Imagen para el diseño").then(function (f) {
      if (!f) return null; toast("Subiendo " + f.name + "…");
      return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.readAsDataURL(f); })
        .then(function (d) { return api("/api/assets/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: f.name, data: d, workspaceId: RB.ws }) }); })
        /* la subida responde { data: { url } }: antes se leía x.url (vacío) y la imagen no cambiaba (QA Instinct lote 2 #6) */
        .then(function (x) { var u = x && (x.url || (x.data && (x.data.url || (x.data.asset && x.data.asset.url))) || (x.asset && x.asset.url)); if (!u) throw new Error("el servidor no devolvió la imagen"); return { url: u, name: f.name }; });
    });
  }
  edRoot.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest('[data-demo="Subir imagen"],[data-demo="Subir recurso"],[data-demo="Reemplazar imagen"],[data-demo="Aplicar marca"],[data-demo="Verificar design system"]');
    if (!b || !ED.doc || !ED.doc._real) return;
    e.stopPropagation(); e.preventDefault();
    var k = b.dataset.demo, doc = ED.doc;
    if (k === "Reemplazar imagen") {
      var o = selObj(); if (!o || o.type !== "image") return toast("Selecciona una imagen");
      return pickImage().then(function (r) {
        if (!r) return; snap();
        var n = o._n, im = n.tagName === "IMG" ? n : n.querySelector && n.children.length === 1 && n.querySelector("img");
        if (im) { im.setAttribute("src", r.url); im.removeAttribute("srcset"); }
        else if (/url\(/.test(n.style.backgroundImage || getComputedStyle(n).backgroundImage || "")) n.style.backgroundImage = "url('" + r.url + "')";
        else o.fill = "url('" + r.url + "') center/cover no-repeat";
        edRender(); edProps(); toast("Imagen reemplazada");
      }, function (err) { toast("No se pudo subir: " + (err && err.message)); });
    }
    if (k === "Subir imagen" || k === "Subir recurso") {
      var fi0 = ED.sel ? ED.sel.f : 0;
      return pickImage().then(function (r) { if (r && ED.doc === doc) insertImage(r, fi0); }, function (err) { toast("No se pudo subir: " + (err && err.message)); });
    }
    if (k === "Aplicar marca") {
      return api("/rest/v1/brand_guidelines?workspace_id=eq." + encodeURIComponent(RB.ws) + "&select=id,name&order=updated_at.desc&limit=30").then(function (gs) {
        if (!gs || !gs.length) throw new Error("este espacio no tiene guías de marca: crea una con «Convertir archivo en design system»");
        return window.__musaReal.choose("", gs.map(function (g, i) { return { value: i, label: g.name }; }), { title: "¿Qué guía aplico?", action: "pick-guide" }).then(function (pick) { var g = pick == null ? null : gs[pick]; if (!g) return;
        save(true);
        return RB.mcp("apply_brand_to_template", { templateId: doc._id, brandId: g.id }).then(function () { doc.brand = g.name; eq("#edBrand").textContent = g.name; toast("Marca «" + g.name + "» aplicada al archivo"); });
      });
      }).catch(function (err) { toast("Aplicar marca: " + (err && err.message)); });
    }
    if (k === "Verificar design system") {
      save(true);
      return RB.mcp("verify_design_system", { templateId: doc._id }).then(function (r) {
        var sc = r && (r.score != null ? r.score : r.overallScore), iss = (r && (r.issues || r.problems)) || [];
        toast("Design system verificado" + (sc != null ? " · puntaje " + sc : "") + (iss.length ? " · " + iss.length + " observaciones" : " · sin observaciones"));
      }, function (err) { toast("Verificar: " + (err && err.message)); });
    }
  }, true);

  /* Editor de fotos: las recetas guardadas viajan con la foto en el diseño (data-photo) */
  if (typeof phAct === "function") {
    var _phAct = phAct;
    phAct = function (a) {
      var r = _phAct.apply(this, arguments);
      if (a === "saveRecipe" && PH.doc && PH.doc._real && PH.t && PH.t.kind === "image") {
        var e = phEl(); if (e) { e.photo = Object.assign({}, e.photo || { orig: phUrlOf(e.fill) }, { versions: PH.versions[PH.key] || [] }); save(); }
      }
      return r;
    };
  }
  if (typeof phLoad === "function") {
    var _phLoad = phLoad;
    phLoad = function (t) {
      var p = _phLoad.apply(this, arguments);
      try {
        if (PH.doc && PH.doc._real && t && t.kind === "image") { var e = PH.doc.frames[t.f].els[t.e], ph = e && e.photo; var key = PH.fi + ":" + t.key; if (ph && ph.versions && !PH.versions[key]) PH.versions[key] = ph.versions; }
      } catch (err) {}
      return p;
    };
  }

  /* ═════ Formas (buscatrazos) e Imagen (selecciones) con las herramientas MCP reales ═════ */
  function lid(e) { return e && e._n && e._n.getAttribute("data-layer-id"); }
  function overlaps(a, b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }
  function afterMcp(doc, promise, okMsg) {
    var id = doc._id;
    toast("Procesando…");
    save(true);
    return new Promise(function (r) { setTimeout(r, 1600); }).then(function () { return promise(); })
      .then(function () { toast(okMsg); RB.openDesign(id); }, function (e) { toast("No se pudo: " + (e && e.message || "error")); });
  }
  var PATH_OPS = { "Unir formas": "unite", "Sustraer formas": "minus_front", "Intersecar formas": "intersect", "Excluir formas": "exclude", "Dividir en caras": "divide", "Recortar solapes": "trim", "Fusionar": "merge", "Contornos": "outline", "Menos atrás": "minus_back" };
  function pathOp(label) {
    var o = selObj(), s = ED.sel, doc = ED.doc;
    if (!o || !o._n || !s || s.e == null) return toast("Selecciona una forma");
    var f = doc.frames[s.f], fid = f._src && f._src.id;
    var isShape = function (e) { return e.type === "rect" || e._n.tagName.toLowerCase() === "svg" || !!(e._n.querySelector && e._n.querySelector("path")); };
    var group = [o].concat(f.els.filter(function (e) { return e !== o && isShape(e) && e._n.children.length <= 1 && overlaps(e, o); }));
    if (group.length < 2 || !group.every(lid)) return toast("Pon otra forma encima o debajo de la seleccionada para combinarlas");
    var ids = group.map(lid);
    return afterMcp(doc, function () {
      var conv = group.filter(function (e) { return !(e._n.tagName.toLowerCase() === "svg" || e._n.querySelector("path")); });
      /* shape_to_path devuelve un id nuevo (newElementId): se reemplaza en la lista antes del buscatrazos */
      return conv.reduce(function (p, e) { return p.then(function () { var old = lid(e); return RB.mcp("shape_to_path", { templateId: doc._id, frameId: fid, elementId: old }).then(function (r) { var nid = r && (r.newElementId || r.layerId); if (nid) ids = ids.map(function (x) { return x === old ? nid : x; }); }); }); }, Promise.resolve())
        .then(function () { return RB.mcp("pathfinder", { templateId: doc._id, frameId: fid, layerIds: ids, op: PATH_OPS[label] }); });
    }, label + " listo");
  }
  function imgOp(label) {
    var o = selObj(), s = ED.sel, doc = ED.doc;
    if (!o || !o._n || o.type !== "image" || !lid(o)) return toast("Selecciona una imagen");
    var f = doc.frames[s.f], fid = f._src && f._src.id, L = lid(o);
    if (label === "Invertir selección") return afterMcp(doc, function () { return RB.mcp("invert_mask", { templateId: doc._id, frameId: fid, imageLayerId: L }); }, "Selección invertida");
    if (label === "Rellenar selección") {
      return window.__musaReal.promptBox("Un color (#ff5e00) o un degradado (linear-gradient(…)).", "#ff5e00", { title: "Rellenar la selección", label: "Color o degradado", ok: "Rellenar" }).then(function (col) { if (!col) return;
      return afterMcp(doc, function () { return RB.mcp("fill_mask", { templateId: doc._id, frameId: fid, imageLayerId: L, fill: col }); }, "Selección rellenada");
    });
    }
    return (label === "Eliminar exterior" ? Promise.resolve("elipse") : window.__musaReal.choose("", [{ value: "elipse", label: "Elipse" }, { value: "rectángulo", label: "Rectángulo" }], { title: "Forma de la selección", action: "selection-shape" })).then(function (shape) { if (!shape) return;
    var x = o.x + o.w * .1, y = o.y + o.h * .1, w = o.w * .8, h = o.h * .8, d;
    if (/rect/i.test(shape)) d = "M" + x + " " + y + " H" + (x + w) + " V" + (y + h) + " H" + x + " Z";
    else { var rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry; d = "M" + (cx - rx) + " " + cy + " a" + rx + " " + ry + " 0 1 0 " + (2 * rx) + " 0 a" + rx + " " + ry + " 0 1 0 " + (-2 * rx) + " 0 Z"; }
    return afterMcp(doc, function () { return RB.mcp("create_mask_from_path", { templateId: doc._id, frameId: fid, pathData: d, x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h), targetImageLayerId: L, mode: "include" }); }, label === "Eliminar exterior" ? "Se ocultó el exterior de la imagen" : "Selección creada (editable como trazado)");
  });
  }
  var _openCtx2 = openCtx;
  openCtx = function () {
    var r = _openCtx2.apply(this, arguments);
    if (!ED.doc || !ED.doc._real) return r;
    Object.keys(menuItems).forEach(function (k) {
      var it = menuItems[k]; if (!it || !it.l) return;
      if (PATH_OPS[it.l]) it.fn = function () { pathOp(it.l); };
      if (/^(Crear selección|Invertir selección|Eliminar exterior|Rellenar selección)$/.test(it.l)) it.fn = function () { imgOp(it.l); };
    });
    return r;
  };

  /* ── MCP primero: si una IA (o otra pestaña) cambia el diseño, el editor se pone al día solo ── */
  function remoteAt(doc) { return api("/rest/v1/templates?id=eq." + encodeURIComponent(doc._id) + "&select=updated_at").then(function (r) { if (r && r[0]) doc._remoteAt = r[0].updated_at; }, function () {}); }
  setInterval(function () {
    var doc = ED.doc;
    if (!ED.open || !doc || !doc._real || saving || pendingUp || (typeof PH !== "undefined" && PH.open) || document.activeElement && document.activeElement.isContentEditable) return;
    if (JSON.stringify(payload(doc)) !== doc._saved) return; /* cambios locales sin guardar: manda lo tuyo primero */
    api("/rest/v1/templates?id=eq." + encodeURIComponent(doc._id) + "&select=updated_at").then(function (r) {
      var at = r && r[0] && r[0].updated_at;
      if (!at || !doc._remoteAt || at === doc._remoteAt || ED.doc !== doc) return;
      var keep = { z: ED.z, px: ED.px, py: ED.py, sel: ED.sel, panel: ED.panel };
      RB.openDesign(doc._id);
      var n = 0, iv = setInterval(function () {
        if ((ED.doc && ED.doc !== doc && ED.doc._real) || ++n > 50) {
          clearInterval(iv);
          if (ED.doc && ED.doc !== doc) { Object.assign(ED, { z: keep.z, px: keep.px, py: keep.py, panel: keep.panel }); if (keep.sel && ED.doc.frames[keep.sel.f] && (keep.sel.e == null || ED.doc.frames[keep.sel.f].els[keep.sel.e])) ED.sel = keep.sel; edRender(); edLayers(); edProps(); edView(); if (Date.now() - (RB._ownAt || 0) > 90000) toast("Actualizado: este diseño cambió desde otra sesión o una IA (MCP)"); }
        }
      }, 100);
    }, function () {});
  }, 5000);

  /* captura de un frame guardado a PNG (para usar un diseño como escena de video) */
  RB.shotSrc = function (src) {
    var w = +src.width || 1080, h = +src.height || 1080, f = { w: w, h: h, bg: src.background || "#fff", _root: rootFor(src) };
    return shot(f, 1).then(function (c) { return c.toDataURL("image/jpeg", 0.9); });
  };

  /* abrir un diseño real en el editor */
  var RECENT = [], FREED = {};
  /* un diseño liberado de la memoria se vuelve a cargar al navegar a él */
  if (typeof edOpen === "function") {
    var _edOpenMem = edOpen;
    var SAMPLE_N = (typeof ED_FILES !== "undefined" && ED_FILES.length) || 0;
    edOpen = function (i) {
      if (FREED[i] && !ED_DOCS[i]) { var id = FREED[i]; delete FREED[i]; return RB.openDesign(id); }
      /* conectado: #crear/disenos/0 apuntaba a un diseño de ejemplo de la maqueta aunque tuvieras diseños propios */
      if (RB.on && +i < SAMPLE_N && !(ED_DOCS[i] && ED_DOCS[i]._real)) {
        var t = RB.tpl && RB.tpl[+i];
        if (t && t.id) return RB.openDesign(t.id);
        if (!RB.demoOn) { location.hash = "crear/disenos"; toast("Ese diseño no existe en tu espacio"); return; }
      }
      return _edOpenMem.apply(this, arguments);
    };
    /* al arrancar con #crear/disenos/N la maqueta abre su ejemplo N antes de que lleguen los diseños reales:
       apenas llegan, se cambia al real de esa posición */
    RB.onTpl = function () {
      var m = /^#crear\/disenos\/(\d+)$/.exec(location.hash);
      if (m && ED.open && ED.doc && !ED.doc._real) edOpen(+m[1]);
    };
    if (RB.tplLoaded) RB.onTpl();
  }
  RB.openDesign = function (id) {
    if (typeof uiToast === "function") uiToast("Abriendo diseño…");
    api("/rest/v1/templates?id=eq." + encodeURIComponent(id) + "&select=id,name,data,workspace_id,is_public,visibility,updated_at,meta:design_file_meta(brand_id)").then(function (rows) {
      var t = rows && rows[0]; if (!t) throw new Error("no encontrado");
      var d = t.data || {}, src = Array.isArray(d.frames) && d.frames.length ? d.frames : [{ name: t.name, html: d.html || "", css: d.css || "", width: d.width, height: d.height, background: "#ffffff" }];
      var x = 0, frames = src.map(function (s, i) { var f = buildFrame(s, i, x); x += f.w + 120; return f; });
      /* la marca vive en la ficha del archivo (design_file_meta); data.brandId casi nunca se guardaba */
      var metaB = t.meta && (Array.isArray(t.meta) ? (t.meta[0] || {}).brand_id : t.meta.brand_id);
      var bid = (d.brandId && RB.brandName && RB.brandName[d.brandId]) ? d.brandId : (metaB || d.brandId || null);
      var brand = (RB.brandName && bid && RB.brandName[bid]) || "Sin marca";
      var doc = { name: t.name || "Diseño", brand: brand, campaign: "—", tags: [], frames: frames, _real: true, _id: t.id, _public: !!t.is_public, _vis: t.visibility || "private", _remoteAt: t.updated_at, _brandId: bid };
      /* Una casilla por diseño: reabrirlo reemplaza la anterior en vez de sumar otra. Antes cada apertura
         dejaba el diseño viejo entero (con su DOM) en ED_DOCS: ~60 MB por vez con un archivo pesado, y un
         agente que reabría el mismo archivo terminaba tumbando la pestaña. Además solo se guardan en memoria
         los últimos diseños abiertos; uno liberado se vuelve a cargar si se navega a él. */
      var i = -1;
      Object.keys(ED_DOCS).forEach(function (k) { if (ED_DOCS[k] && ED_DOCS[k]._real && ED_DOCS[k]._id === t.id) i = +k; });
      if (i < 0) { ED_FILES.push({ name: doc.name, brand: "\u0000", campaign: "", tags: [], frames: [{ name: "", w: 1, h: 1, bg: "#fff", els: [] }] }); i = ED_FILES.length - 1; }
      ED_DOCS[i] = doc; delete FREED[i];
      RECENT = RECENT.filter(function (k) { return k !== i; }); RECENT.push(i);
      while (RECENT.length > 3) { var old = RECENT.shift(); if (ED_DOCS[old] && ED_DOCS[old]._real && old !== ED.fi) { FREED[old] = ED_DOCS[old]._id; delete ED_DOCS[old]; } }
      doc._saved = null;
      if (!Array.isArray(d.frames) || !d.frames.length) { doc._empty = true; doc._saved = JSON.stringify(payload(doc)); }
      loadVersions(doc); loadPins(doc);
      if (location.hash === "#crear/disenos/" + i) edOpen(i); else location.hash = "crear/disenos/" + i;
      runPending(doc);
    }).catch(function (e) { if (typeof uiToast === "function") uiToast("No se pudo abrir: " + (e && e.message)); });
  };

  /* ═════ QA Instinct · réplica de 3 posts (11-nov) ═════ */

  /* 0 · El <input id="phFile"> del editor de Foto vive siempre en la página. Un archivo puesto ahí con el editor de
     Foto cerrado lo abría sobre la ÚLTIMA foto editada (otro diseño, «Carrusel 5 errores CRM») y al cerrarlo la app
     saltaba a ese diseño. Con Foto cerrado, la imagen va al diseño abierto, al frame elegido. */
  function insertImage(r, fi) {
    var doc = ED.doc; if (!doc || !doc._real) return;
    var f = doc.frames[fi != null ? fi : ED.sel ? ED.sel.f : 0]; if (!f) return toast("Crea un frame primero");
    var at = doc.frames.indexOf(f);
    var im = new Image();
    im.onload = im.onerror = function () {
      var iw = im.naturalWidth || 1, ih = im.naturalHeight || 1, k = Math.min(f.w * .6 / iw, f.h * .6 / ih, 1) || 1, w = Math.round(iw * k) || Math.round(f.w * .6), h = Math.round(ih * k) || Math.round(f.w * .6);
      snap();
      f.els.push(Object.assign({}, DEF, { type: "image", name: r.name.replace(/\.\w+$/, ""), x: Math.round((f.w - w) / 2), y: Math.round((f.h - h) / 2), w: w, h: h, fill: "url('" + r.url + "') center/contain no-repeat" }));
      edRender(); edLayers(); select({ f: at, e: f.els.length - 1 }); toast("Imagen agregada a «" + f.name + "»");
      if (RB.assets) RB.assets.unshift({ name: r.name, url: r.url, mime_type: "image/png" });
    };
    im.src = r.url;
  }
  function uploadImageFile(f) {
    toast("Subiendo " + f.name + "…");
    return new Promise(function (res) { var rd = new FileReader(); rd.onload = function () { res(rd.result); }; rd.readAsDataURL(f); })
      .then(function (d) { return api("/api/assets/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: f.name, data: d, workspaceId: RB.ws }) }); })
      .then(function (x) { var a = (x && (x.data || x.asset)) || x || {}; var u = a.url || (a.asset && a.asset.url); if (!u) throw new Error("sin enlace"); return { url: u, name: f.name }; });
  }
  RB.insertImage = insertImage;
  (function () {
    var inp = document.getElementById("phFile"); if (!inp) return;
    inp.setAttribute("aria-label", "Subir una foto al editor de fotos");
    inp.addEventListener("change", function (e) {
      if (typeof PH !== "undefined" && PH.open) return;
      e.stopImmediatePropagation();
      var f = inp.files && inp.files[0]; inp.value = "";
      if (!f) return;
      if (!(ED.open && ED.doc && ED.doc._real)) return toast("Abre un diseño para subir la imagen");
      uploadImageFile(f).then(function (r) { insertImage(r); }, function (err) { toast("No se pudo subir: " + errMsg(err)); });
    }, true);
  })();

  /* 2 · Un <svg> importado era una capa rígida («Rectángulo»): ahora Props lo llama Vector, muestra cada forma con
     su relleno y su trazo, y «Separar en capas» (también Desagrupar) deja cada forma como capa propia. Los huecos de
     una letra (la «a») quedan con su forma: se separan solo las piezas que no están una dentro de otra. */
  function vecRoot(o) { var n = o && o._n; if (!n) return null; if (n.tagName.toLowerCase() === "svg") return n; return n.children.length === 1 && n.firstElementChild.tagName.toLowerCase() === "svg" ? n.firstElementChild : null; }
  function subpaths(d) {
    d = String(d || "").trim();
    if (!/^[Mm]/.test(d)) return null;
    var parts = d.split(/(?=[Mm])/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (parts.length < 2 || parts.slice(1).some(function (s) { return s[0] === "m"; })) return null; /* m relativas: se dejan juntas */
    return parts;
  }
  function vecParts(svg) {
    var out = [];
    vecList(svg).forEach(function (sh) {
      var subs = sh.tagName.toLowerCase() === "path" ? subpaths(sh.getAttribute("d")) : null;
      if (!subs) return out.push({ sh: sh });
      var boxes = subs.map(function (d) { var t = document.createElementNS("http://www.w3.org/2000/svg", "path"); t.setAttribute("d", d); sh.parentNode.appendChild(t); var b; try { b = t.getBBox(); } catch (e) { b = { x: 0, y: 0, width: 0, height: 0 }; } t.remove(); return b; });
      var inside = function (a, b) { return a !== b && a.x >= b.x - .5 && a.y >= b.y - .5 && a.x + a.width <= b.x + b.width + .5 && a.y + a.height <= b.y + b.height + .5; };
      var owner = boxes.map(function (b, i) { var best = -1; boxes.forEach(function (c, j) { if (i !== j && inside(b, c) && (best < 0 || c.width * c.height > boxes[best].width * boxes[best].height)) best = j; }); return best; });
      var groups = {}; subs.forEach(function (d, i) { var k = owner[i] < 0 ? i : owner[i]; (groups[k] = groups[k] || []).push(d); });
      var keys = Object.keys(groups);
      if (keys.length < 2) return out.push({ sh: sh });
      keys.forEach(function (k) { out.push({ sh: sh, d: groups[k].join(" ") }); });
    });
    return out;
  }
  function splitVector() {
    var o = selObj(), s = ED.sel, svg = vecRoot(o);
    if (!svg || !s || s.e == null) return toast("Selecciona un vector");
    var parts = vecParts(svg);
    if (parts.length < 2) return toast("Este vector es una sola forma (con sus huecos). Cambia su color o su trazo en «Formas del vector».");
    var f = ED.doc.frames[s.f], n = o._n, shapes = vecList(svg), base = o.name || "Vector", at = f.els.indexOf(o);
    snap();
    var made = parts.map(function (p, k) {
      var c = n.cloneNode(true), cs2 = vecList(c.tagName.toLowerCase() === "svg" ? c : c.firstElementChild), mine = cs2[shapes.indexOf(p.sh)];
      cs2.forEach(function (x) { if (x !== mine) x.remove(); });
      if (p.d && mine) mine.setAttribute("d", p.d);
      c.setAttribute("data-layer-id", "musa_" + Date.now().toString(36) + "_" + (uid++)); c.setAttribute("data-layer-name", base + " · " + (k + 1)); c.setAttribute("data-layer-kind", "svg");
      c.removeAttribute("id");
      return c;
    });
    made.reduce(function (prev, c) { prev.parentNode.insertBefore(c, prev.nextSibling); return c; }, n);
    n.remove();
    f.els.splice.apply(f.els, [at, 1].concat(made.map(function (c) { return makeEl(c, f); })));
    edRender(); edLayers(); select({ f: s.f, e: at + made.length - 1 });
    toast("Vector separado en " + made.length + " capas");
  }
  var _edPropsQA = edProps;
  edProps = function () {
    var r = _edPropsQA.apply(this, arguments);
    try {
      var o = selObj(), svg = ED.doc && ED.doc._real && ED.panel === "props" && ED.sel && ED.sel.e != null ? vecRoot(o) : null;
      if (!svg) return r;
      var box = eq("#edProps"), hd = box.querySelector(".ed-ph b"); if (hd) hd.textContent = "Vector";
      var shapes = vecList(svg).slice(0, 40), parts = vecParts(svg).length;
      var colr = function (v) { v = String(v || ""); if (/^#[0-9a-f]{6}$/i.test(v)) return v; if (/^#[0-9a-f]{3}$/i.test(v)) return "#" + v.slice(1).split("").map(function (c) { return c + c; }).join(""); var h = hex(v); return /^#[0-9a-f]{6}$/i.test(h) ? h : "#000000"; };
      var rows = shapes.map(function (sh, i) {
        var c = getComputedStyle(sh), fill = c.fill === "none" ? "" : colr(c.fill), st = c.stroke === "none" ? "" : colr(c.stroke);
        return '<div class="ed-kv" style="gap:6px"><span>Forma ' + (i + 1) + '</span><span style="display:flex;gap:6px;align-items:center">'
          + '<label title="Relleno" style="display:flex;gap:4px;align-items:center"><small>Relleno</small><input type="color" data-vs="' + i + '" data-vk="fill" value="' + (fill || "#000000") + '" aria-label="Relleno de la forma ' + (i + 1) + '"' + (fill ? "" : ' style="opacity:.4"') + "></label>"
          + '<label title="Trazo" style="display:flex;gap:4px;align-items:center"><small>Trazo</small><input type="color" data-vs="' + i + '" data-vk="stroke" value="' + (st || "#000000") + '" aria-label="Trazo de la forma ' + (i + 1) + '"' + (st ? "" : ' style="opacity:.4"') + "></label></span></div>";
      }).join("");
      var html = '<details class="ed-sec" open><summary>Formas del vector</summary><div class="ed-sb">' + rows
        + (parts > 1 ? '<button class="ed-btn" data-vsplit style="grid-column:1/-1">Separar en ' + parts + " capas</button>" : '<div class="ed-note">Una sola forma' + (vecParts(svg)[0] && /[Mm].*[Mm]/.test(vecParts(svg)[0].sh.getAttribute("d") || "") ? " con huecos" : "") + ": cambia su color o su trazo aquí.</div>")
        + "</div></details>";
      var ph = box.querySelector(".ed-ph"); if (ph) ph.insertAdjacentHTML("afterend", html);
    } catch (e) { console.warn("[editor] panel de vector", e); }
    return r;
  };
  var props2 = eq("#edProps");
  props2.addEventListener("focusin", function (e) { if (e.target.dataset && e.target.dataset.vs != null) snap(); });
  props2.addEventListener("input", function (e) {
    var t = e.target; if (!t.dataset || t.dataset.vs == null) return;
    var svg = vecRoot(selObj()), sh = svg && vecList(svg)[+t.dataset.vs]; if (!sh) return;
    sh.setAttribute(t.dataset.vk, t.value); sh.style[t.dataset.vk] = ""; t.style.opacity = "";
    if (t.dataset.vk === "stroke" && !parseFloat(sh.getAttribute("stroke-width"))) sh.setAttribute("stroke-width", "2");
    edRender();
  });
  props2.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("[data-vsplit]")) { e.stopPropagation(); splitVector(); } }, true);
  var _openCtxQA = openCtx;
  openCtx = function () {
    var r = _openCtxQA.apply(this, arguments);
    if (!ED.doc || !ED.doc._real || !vecRoot(selObj())) return r;
    Object.keys(menuItems).forEach(function (k) { var it = menuItems[k]; if (it && it.l === "Desagrupar") it.fn = splitVector; });
    return r;
  };

  /* 15 · Arrastrar una capa y soltarla sobre otro frame la pasa a ese frame (antes quedaba recortada en el suyo).
     Lleva sus estilos en línea porque el CSS de cada frame no sale de él. */
  var _startMoveQA = startMove;
  startMove = function (e) {
    var doc = ED.doc, s = ED.sel ? { f: ED.sel.f, e: ED.sel.e } : null, o = selObj();
    var r = _startMoveQA.apply(this, arguments);
    if (!doc || !doc._real || !s || s.e == null || !o || !o._n || o.locked || doc.frames.length < 2) return r;
    var x0 = e.clientX, y0 = e.clientY;
    var up = function (ev) { removeEventListener("pointerup", up); if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return; setTimeout(function () { reparent(doc, s.f, o); }, 0); };
    addEventListener("pointerup", up);
    return r;
  };
  function reparent(doc, fi, o) {
    if (ED.doc !== doc) return;
    var f1 = doc.frames[fi]; if (!f1 || f1.els.indexOf(o) < 0) return;
    var wx = f1.x + o.x, wy = f1.y + o.y, ti = frameAt(wx + o.w / 2, wy + o.h / 2);
    if (ti < 0 || ti === fi) return;
    var f2 = doc.frames[ti], n = o._n;
    var moved = f1.els.filter(function (x) { return x === o || n.contains(x._n); });
    bakeInto(n, n);
    f1.els = f1.els.filter(function (x) { return moved.indexOf(x) < 0; });
    (f2._content || f2._root).appendChild(n);
    n.style.position = "absolute"; n.style.margin = "0"; n.style.right = "auto"; n.style.bottom = "auto";
    var els2 = moved.map(function (x) { return makeEl(x._n, f2); }), e2 = els2[moved.indexOf(o)];
    f2.els.push.apply(f2.els, els2);
    edRender();
    e2.x = Math.round(wx - f2.x); e2.y = Math.round(wy - f2.y);
    edRender(); edLayers(); select({ f: ti, e: f2.els.indexOf(e2) });
    toast("Capa movida a «" + f2.name + "»");
  }
  /* ═════ QA Instinct · retest del 11-nov ═════ */

  /* 2b · menús más altos que la pantalla (el contextual tiene ~30 opciones): con 720 px de alto «Eliminar» quedaba
     fuera y sin scroll. Ahora el menú se achica a la pantalla y se desplaza; los submenús se ubican a la vista. */
  if (typeof place === "function") {
    var _placeQA = place;
    place = function (m, x, y) {
      m.style.maxHeight = ""; m.style.overflowY = ""; m.classList.remove("ed-mscroll");
      _placeQA(m, x, y);
      var lim = innerHeight - 16;
      if (m.offsetHeight > lim) {
        m.style.maxHeight = lim + "px"; m.style.overflowY = "auto"; m.style.overscrollBehavior = "contain";
        m.style.top = "8px"; m.classList.add("ed-mscroll");
      }
    };
    var stQA = document.createElement("style");
    /* Safari/WebKit: el reset «all: revert» de los frames dejaba -webkit-user-modify en read-only y el texto no se
       podía escribir aunque tuviera contenteditable (la edición en el lienzo nunca funcionó en Safari) */
    stQA.textContent = ".ed-mscroll .ed-mi .sub{position:fixed}.ed-mscroll{scrollbar-width:thin}"
      + ".mreal[contenteditable=true],.mreal [contenteditable=true],.mreal [contenteditable=true] *{-webkit-user-modify:read-write!important;-webkit-user-select:text!important;user-select:text!important;cursor:text}";
    document.head.appendChild(stQA);
    ["#edMenu", "#edCtx"].forEach(function (sel) {
      var m = document.querySelector(sel); if (!m) return;
      m.addEventListener("mouseover", function (e) {
        var it = e.target.closest && e.target.closest(".ed-mi"); if (!it) return;
        var sub = it.querySelector(":scope > .sub"); if (!sub) return;
        var r = it.getBoundingClientRect();
        if (m.classList.contains("ed-mscroll")) {
          var w = sub.offsetWidth || 230, left = r.right + 4 + w > innerWidth ? r.left - w - 4 : r.right + 4;
          sub.style.left = Math.max(4, left) + "px"; sub.style.top = Math.max(8, Math.min(r.top - 6, innerHeight - sub.offsetHeight - 8)) + "px";
        } else { sub.style.left = ""; sub.style.top = ""; }
      });
    });
  }

  /* clic derecho sobre una capa del panel Capas: la elige y abre el mismo menú que en el lienzo */
  var lyBox = document.querySelector("#edLayers");
  if (lyBox && typeof openCtx === "function") lyBox.addEventListener("contextmenu", function (e) {
    var row = e.target.closest && e.target.closest(".ed-ly"); if (!row || !ED.open || !ED.doc) return;
    e.preventDefault(); e.stopPropagation();
    var fi = +row.dataset.f, ei = row.dataset.e == null || row.dataset.e === "" ? null : +row.dataset.e;
    if (!ED.sel || ED.sel.f !== fi || ED.sel.e !== ei) select({ f: fi, e: ei });
    openCtx(e.clientX, e.clientY);
  });

  /* 13/15 · editar un texto en el lienzo. Además del doble clic: un clic sobre el texto que ya está elegido (sin
     arrastrar) o Enter entran a escribir. Antes, con herramientas que no mandan «dblclick» (y en textos con
     <span> o <b> adentro, que no eran «texto»), no había forma: la «b» seguía activando el Lápiz. */
  var INLINE_OK = /^(SPAN|B|STRONG|I|EM|U|S|SMALL|SUP|SUB|BR|A|MARK|CODE|FONT)$/;
  function textish(o) {
    if (!o || o.locked) return false;
    if (o.type === "text") return true;
    var n = o._n; if (!n || !(n.innerText || "").trim()) return false;
    return [].every.call(n.querySelectorAll("*"), function (k) { return INLINE_OK.test(k.tagName); });
  }
  function editSel() {
    var o = selObj(), n = selNode();
    if (!o || !n || n.isContentEditable || !textish(o)) return false;
    editText(n, o);
    return true;
  }
  RB.editSelText = editSel;
  document.addEventListener("keydown", function (e) {
    if (!ED.open || e.key !== "Enter" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || ED.pen) return;
    var t = e.target; if (t && t.closest && t.closest("input,textarea,select,button,[contenteditable=true],.mdlg")) return;
    if (!ED.sel || ED.sel.e == null) return;
    if (editSel()) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  var pdQA = null;
  cv.addEventListener("pointerdown", function (e) {
    pdQA = null;
    if (e.button !== 0 || ED.tool !== "select" || ED.space || ED.comments || !ED.sel || ED.sel.e == null) return;
    var n = e.target.closest && e.target.closest(".ed-el"), sn = selNode();
    if (!sn || n !== sn || sn.isContentEditable) return;
    pdQA = { x: e.clientX, y: e.clientY, t: Date.now(), key: ED.sel.f + ":" + ED.sel.e };
  }, true);
  cv.addEventListener("pointerup", function (e) {
    var p = pdQA; pdQA = null; if (!p) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 3 || Date.now() - p.t > 600) return;
    setTimeout(function () { if (ED.sel && ED.sel.f + ":" + ED.sel.e === p.key) editSel(); }, 0);
  }, true);
  cv.addEventListener("dblclick", function () { if (ED.tool === "select" && ED.sel && ED.sel.e != null) setTimeout(editSel, 0); });

  /* 10 · renombrar: se guarda al momento y la lista de Mis diseños (y «Mover») muestra el nombre nuevo */
  var nameIn = document.querySelector("#edName");
  function renameSync(now) {
    var d = ED.doc; if (!d || !d._real) return;
    var list = RB.tpl || [], i = -1;
    list.forEach(function (t, k) { if (t.id === d._id) i = k; });
    if (i >= 0) {
      list[i].name = d.name;
      var tl = typeof TILES !== "undefined" && TILES["crear/disenos"]; if (tl && tl[i]) tl[i][0] = eesc(d.name || "Sin nombre");
    }
    Object.keys(ED_DOCS).forEach(function (k) { if (ED_DOCS[k] === d && ED_FILES[k]) ED_FILES[k].name = d.name; });
    save(!!now);
    /* al confirmar, el nombre va también directo a la base (el guardado completo tarda unos segundos y
       una recarga inmediata mostraba el nombre viejo en la lista) */
    if (now && (d.name || "").trim()) api("/rest/v1/templates?id=eq." + encodeURIComponent(d._id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: d.name.trim().slice(0, 200) }) }).catch(function () {});
  }
  if (nameIn) {
    nameIn.addEventListener("input", function () { renameSync(false); });
    nameIn.addEventListener("change", function () { renameSync(true); });
    nameIn.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); nameIn.blur(); } });
  }

  /* 7 · Crear › Diseños › Lote con CSV: el diálogo de la maqueta solo simulaba (y su contador no cambiaba al
     editar la planilla). Conectado: eliges el diseño, pegas la planilla y se crean los frames de verdad. */
  function csvCount(t) { return Math.max(0, String(t || "").trim().split(/\r?\n/).filter(function (r) { return r.trim(); }).length - 1); }
  document.addEventListener("input", function (e) {
    var t = e.target; if (!t) return;
    if (t.id === "fxCsv") {
      var b = document.querySelector('[data-a="gen"]'), n = csvCount(t.value);
      if (b) b.textContent = "Generar " + n + (n === 1 ? " pieza" : " piezas");
    }
    if (t.name === "bcsv" && t.closest && t.closest("[data-musa-dialog]")) {
      var ok = t.closest("[data-musa-dialog]").querySelector(".b-ok"), m = csvCount(t.value);
      if (ok) ok.textContent = "Generar " + m + (m === 1 ? " pieza" : " piezas");
    }
  });
  if (typeof fxBatch === "function") {
    var _fxBatchQA = fxBatch;
    fxBatch = function () {
      if (!RB.on || !(RB.tpl || []).length) return _fxBatchQA.apply(this, arguments);
      var ex = "titulo,subtitulo\n5 ERRORES,que están matando tu CRM\n3 HÁBITOS,de los equipos que venden más";
      return RB.dialog({ title: "Producir por lote con CSV", action: "batch-csv", ok: "Generar " + csvCount(ex) + " piezas", wide: true,
        message: "Cada fila de la planilla crea un frame nuevo en el diseño elegido. La primera fila lleva los nombres de las capas de texto a reemplazar (los del panel Capas) o los {{marcadores}} del diseño.",
        fields: [
          { name: "tpl", label: "Diseño base", type: "select", value: RB.tpl[0].id, options: RB.tpl.slice(0, 200).map(function (t) { return { value: t.id, label: t.name || "Sin nombre" }; }) },
          { name: "bcsv", label: "Planilla (CSV)", type: "textarea", rows: 8, value: ex, required: true }],
        validate: function (v) { if (!csvCount(v.bcsv)) return "La planilla necesita la fila de nombres y al menos una fila de datos"; if (csvCount(v.bcsv) > 200) return "Hasta 200 filas por lote"; return ""; } })
        .then(function (v) {
          if (!v) return;
          RB._pendingBatch = { id: v.tpl, csv: v.bcsv };
          RB.openDesign(v.tpl);
        });
    };
  }

  /* A · Curvatura y Ancho: ya no son de muestra. Curvatura: clic en un trazado (Pluma o Lápiz) agrega un punto
     suave; arrastrar un punto re-curva el trazado (curva continua que pasa por todos los puntos). Ancho: arrastrar
     sobre un trazo lo engrosa (hacia arriba) o lo afina (hacia abajo). */
  if (typeof SIM !== "undefined" && SIM.delete) { SIM.delete("curvature"); SIM.delete("width"); }
  if (typeof TOOLS !== "undefined") {
    if (TOOLS.curvature) TOOLS.curvature[1] = "clic en un trazado agrega un punto suave; arrastra un punto para re-curvar";
    if (TOOLS.width) TOOLS.width[1] = "arrastra sobre un trazo: hacia arriba más grueso, hacia abajo más fino";
  }
  function onePath(o) {
    var n = o && o._n; if (!n) return null;
    var ps = n.tagName.toLowerCase() === "path" ? [n] : [].filter.call(n.querySelectorAll("path"), function (p) { return !p.closest("defs,clipPath,mask,pattern,symbol,marker"); });
    return ps.length === 1 ? ps[0] : null;
  }
  function anchorsOf(p) {
    try { var a = JSON.parse(p.getAttribute("data-anchors") || "null"); if (a && a.pts && a.pts.length > 1) return a; } catch (x) {}
    var d = (p.getAttribute("d") || "").trim();
    if (!d || /[^MLZz0-9\s,.\-eE]/.test(d)) return null; /* curvas que ya traía el archivo: no se reinterpretan */
    var closed = /z$/i.test(d), nums = d.replace(/[MLZz]/g, " ").trim().split(/[\s,]+/).map(Number), pts = [];
    for (var i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    if (pts.some(function (q) { return isNaN(q[0]) || isNaN(q[1]); }) || pts.length < 2) return null;
    if (closed && pts.length > 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    return { pts: pts, closed: closed, smooth: false };
  }
  function rr(v) { return Math.round(v * 10) / 10; }
  function dOf(a) {
    var P = a.pts, n = P.length, f = function (q) { return rr(q[0]) + " " + rr(q[1]); };
    if (!a.smooth || n < 3) return "M" + P.map(f).join(" L") + (a.closed ? "Z" : "");
    var g = function (i) { return a.closed ? P[(i + n) % n] : P[Math.max(0, Math.min(n - 1, i))]; };
    var s = "M" + f(P[0]), segs = a.closed ? n : n - 1;
    for (var i = 0; i < segs; i++) {
      var p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
      s += " C" + f([p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]) + " " + f([p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]) + " " + f(p2);
    }
    return s + (a.closed ? "Z" : "");
  }
  function setD(p, a) {
    p.setAttribute("d", dOf(a));
    p.setAttribute("data-anchors", JSON.stringify({ pts: a.pts.map(function (q) { return [rr(q[0]), rr(q[1])]; }), closed: a.closed, smooth: a.smooth }));
  }
  /* coordenadas: pantalla ↔ las del <svg> (viewBox, sin conservar proporción, como dibujan Pluma y Lápiz) */
  function vb(p) {
    var svg = p.ownerSVGElement, r = svg.getBoundingClientRect(), v = svg.viewBox && svg.viewBox.baseVal;
    var w = v && v.width ? v.width : r.width / (ED.z || 1), h = v && v.height ? v.height : r.height / (ED.z || 1);
    return { r: r, x: v && v.width ? v.x : 0, y: v && v.height ? v.y : 0, w: w, h: h };
  }
  function toScr(p, q, b) { b = b || vb(p); return [b.r.left + (q[0] - b.x) / b.w * b.r.width, b.r.top + (q[1] - b.y) / b.h * b.r.height]; }
  function toLoc(p, cx, cy, b) { b = b || vb(p); return [b.x + (cx - b.r.left) / b.r.width * b.w, b.y + (cy - b.r.top) / b.r.height * b.h]; }
  var ov = document.createElement("div");
  ov.setAttribute("aria-hidden", "true");
  ov.style.cssText = "position:fixed;pointer-events:none;z-index:60;overflow:hidden;left:0;top:0;width:0;height:0";
  edRoot.appendChild(ov);
  function drawAnchors() {
    var o = ED.open && ED.tool === "curvature" && ED.doc && ED.doc._real ? selObj() : null, p = o && onePath(o), a = p && anchorsOf(p);
    if (!a) { if (ov.innerHTML) ov.innerHTML = ""; return; }
    var c = cv.getBoundingClientRect(), b = vb(p);
    ov.style.left = c.left + "px"; ov.style.top = c.top + "px"; ov.style.width = c.width + "px"; ov.style.height = c.height + "px";
    ov.innerHTML = a.pts.map(function (q) { var s = toScr(p, q, b); return '<i style="position:absolute;left:' + (s[0] - c.left - 5) + "px;top:" + (s[1] - c.top - 5) + 'px;width:10px;height:10px;border-radius:50%;background:#fff;border:2px solid #ff5e00;box-sizing:border-box"></i>'; }).join("");
  }
  ["edSelBox", "edView"].forEach(function (fn) {
    if (typeof window[fn] !== "function") return;
    var orig = window[fn];
    window[fn] = function () { var r = orig.apply(this, arguments); try { drawAnchors(); } catch (x) {} return r; };
  });
  var _setToolQA = setTool;
  setTool = function (t) { var r = _setToolQA.apply(this, arguments); drawAnchors(); return r; };
  function nearSeg(P, closed, q) {
    var best = { d: Infinity, i: 0, t: 0 }, n = P.length, segs = closed ? n : n - 1;
    for (var i = 0; i < segs; i++) {
      var a = P[i], b = P[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1;
      var t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L)), px = a[0] + t * dx, py = a[1] + t * dy, d = Math.hypot(q[0] - px, q[1] - py);
      if (d < best.d) best = { d: d, i: i, t: t };
    }
    return best;
  }
  function layerAt(e) {
    var n = e.target.closest && e.target.closest(".ed-el"); if (!n) return null;
    var f = ED.doc.frames[+n.dataset.f]; return f ? { f: +n.dataset.f, e: +n.dataset.e, o: f.els[+n.dataset.e] } : null;
  }
  cv.addEventListener("pointerdown", function (e) {
    if (e.button !== 0 || ED.space || !ED.open || !ED.doc || !ED.doc._real) return;
    if (ED.tool !== "curvature" && ED.tool !== "width") return;
    var so = selObj(), sp = so && onePath(so), hit = layerAt(e), target = null;
    /* un punto del trazado elegido gana aunque haya otra capa encima */
    if (ED.tool === "curvature" && sp) {
      var a0 = anchorsOf(sp);
      if (a0) { var b0 = vb(sp); a0.pts.forEach(function (q, i) { var s = toScr(sp, q, b0); if (Math.hypot(s[0] - e.clientX, s[1] - e.clientY) < 10 && !target) target = { o: so, i: i }; }); }
    }
    /* Ancho: dentro de la caja del trazo elegido, actúa sobre él aunque otra capa quede encima */
    if (!target && ED.tool === "width" && so && so._n && vecList(so._n).length) { var sr = so._n.getBoundingClientRect(); if (e.clientX >= sr.left && e.clientX <= sr.right && e.clientY >= sr.top && e.clientY <= sr.bottom) target = { o: so }; }
    if (!target && hit) target = { o: hit.o, sel: hit };
    if (!target) return;
    var o = target.o;
    e.preventDefault(); e.stopImmediatePropagation();
    if (target.sel && (!ED.sel || ED.sel.f !== target.sel.f || ED.sel.e !== target.sel.e)) select({ f: target.sel.f, e: target.sel.e });
    if (o.locked) return toast("La capa está bloqueada");
    if (ED.tool === "width") {
      var n = o._n, shapes = vecList(n);
      if (!shapes.length) return toast("Ancho trabaja sobre trazos y vectores");
      var w0 = parseFloat(shapes[0].getAttribute("stroke-width") || getComputedStyle(shapes[0]).strokeWidth) || 0;
      if (!w0) w0 = 2;
      var moved = false;
      drag(e, function (dx, dy) {
        if (!moved && Math.hypot(dx, dy) < 3) return;
        if (!moved) { snap(); moved = true; }
        var w = Math.max(0.5, Math.min(400, rr(w0 * Math.pow(2, -dy / 90))));
        shapes.forEach(function (s) {
          s.setAttribute("stroke-width", w);
          if ((s.getAttribute("stroke") || getComputedStyle(s).stroke || "none") === "none") s.setAttribute("stroke", isHex(ED.front) ? ED.front : "#111111");
          s.style.strokeWidth = "";
        });
        var h = document.querySelector("#edHint"); if (h) h.innerHTML = "<b>Ancho</b> · " + w + " px";
      }, function () { if (moved) { edRender(); edProps(); toast("Grosor del trazo: " + (parseFloat(shapes[0].getAttribute("stroke-width")) || w0) + " px"); } else toast("Arrastra hacia arriba para engrosar el trazo o hacia abajo para afinarlo"); });
      return;
    }
    var p = onePath(o), a = p && anchorsOf(p);
    if (!a) return toast(p ? "Este trazado ya trae curvas propias: Curvatura trabaja sobre trazados de Pluma o Lápiz" : "Curvatura trabaja sobre un trazado (dibújalo con la Pluma o el Lápiz)");
    snap();
    var b = vb(p), idx = target.i;
    if (idx == null) {
      var q = toLoc(p, e.clientX, e.clientY, b), ns = nearSeg(a.pts, a.closed, q);
      if (ns.d * (b.r.width / b.w) > 24) { a.smooth = true; setD(p, a); edRender(); return toast("Trazado suavizado: arrastra sus puntos para re-curvar"); }
      a.pts.splice(ns.i + 1, 0, q); idx = ns.i + 1;
    }
    a.smooth = true; setD(p, a); p.ownerSVGElement.style.overflow = "visible"; drawAnchors();
    drag(e, function (dx, dy, ev) {
      a.pts[idx] = toLoc(p, ev.clientX, ev.clientY, b);
      setD(p, a); drawAnchors();
    }, function () { edRender(); edProps(); });
  }, true);
  /* ═════ QA Instinct · re-réplicas del 11-nov ═════ */

  /* N1 · una capa con clip-path (papel rasgado) que ocupa todo el frame: la caja de selección rodea la forma
     visible, no el frame entero, y Props tiene «Recorte» para editarlo o quitarlo. */
  function clipBounds(v, w, h) {
    var m = /^(polygon|circle|ellipse|inset)\((.*)\)$/.exec(String(v || "").trim()); if (!m) return null;
    var L = function (t, ref) { t = String(t).trim(); return /%$/.test(t) ? parseFloat(t) / 100 * ref : parseFloat(t) || 0; };
    var body = m[2].replace(/^(nonzero|evenodd)\s*,/, "");
    if (m[1] === "polygon") {
      var pts = body.split(",").map(function (s) { var q = s.trim().split(/\s+/); return [L(q[0], w), L(q[1], h)]; }).filter(function (q) { return !isNaN(q[0]) && !isNaN(q[1]); });
      if (pts.length < 3) return null;
      var xs = pts.map(function (q) { return q[0]; }), ys = pts.map(function (q) { return q[1]; });
      return [Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)];
    }
    if (m[1] === "inset") { var v4 = body.split(/\s+round\s+/)[0].trim().split(/\s+/), t = L(v4[0], h), r = L(v4[1] || v4[0], w), b = L(v4[2] || v4[0], h), l = L(v4[3] || v4[1] || v4[0], w); return [l, t, w - r, h - b]; }
    var at = body.split(/\s+at\s+/), c = (at[1] || "50% 50%").trim().split(/\s+/), cx = L(c[0], w), cy = L(c[1] || "50%", h), rr0 = at[0].trim().split(/\s+/);
    var rx = m[1] === "circle" ? (rr0[0] && !/side/.test(rr0[0]) ? L(rr0[0], Math.sqrt(w * w + h * h) / Math.SQRT2) : Math.min(cx, cy, w - cx, h - cy)) : (rr0[0] ? L(rr0[0], w) : w / 2);
    var ry = m[1] === "circle" ? rx : (rr0[1] ? L(rr0[1], h) : h / 2);
    return [cx - rx, cy - ry, cx + rx, cy + ry];
  }
  var _selBoxN1 = window.edSelBox;
  window.edSelBox = function () {
    var r = _selBoxN1.apply(this, arguments);
    try {
      var n = selNode(), o = selObj(), box = document.querySelector("#edSel");
      if (!n || !o || !o._n || !box || box.hidden) return r;
      var cp = getComputedStyle(n).clipPath; if (!cp || cp === "none") return r;
      var w = n.offsetWidth, h = n.offsetHeight, bb = clipBounds(cp, w, h); if (!bb || !w || !h) return r;
      var rc = n.getBoundingClientRect(), c = cv.getBoundingClientRect(), kx = rc.width / w, ky = rc.height / h;
      var x0 = Math.max(0, bb[0]), y0 = Math.max(0, bb[1]), x1 = Math.min(w, bb[2]), y1 = Math.min(h, bb[3]);
      if (x1 - x0 < 2 || y1 - y0 < 2 || (x1 - x0 > w - 2 && y1 - y0 > h - 2)) return r;
      Object.assign(box.style, { left: rc.left - c.left + x0 * kx + "px", top: rc.top - c.top + y0 * ky + "px", width: (x1 - x0) * kx + "px", height: (y1 - y0) * ky + "px" });
      var dim = box.querySelector(".ed-dim"); if (dim) dim.textContent = Math.round(x1 - x0) + " × " + Math.round(y1 - y0) + " · recorte";
    } catch (x) {}
    return r;
  };
  var _propsN1 = edProps;
  edProps = function () {
    var r = _propsN1.apply(this, arguments);
    try {
      var o = selObj(), n = o && o._n, box = eq("#edProps");
      if (!n || !box || ED.panel !== "props" || !ED.doc || !ED.doc._real) return r;
      var cp = n.style.clipPath || getComputedStyle(n).clipPath;
      if (!cp || cp === "none") return r;
      var html = '<details class="ed-sec" open><summary>Recorte (clip-path)</summary><div class="ed-sb">'
        + '<label class="ef full"><textarea rows="3" data-clip spellcheck="false" aria-label="Recorte de la capa (clip-path)">' + eesc(cp) + "</textarea></label>"
        + '<button class="ed-btn" data-clipoff style="grid-column:1/-1">Quitar recorte</button>'
        + '<div class="ed-note">La forma visible de la capa. Acepta polygon(), circle(), ellipse() o inset().</div></div></details>';
      var ph = box.querySelector(".ed-ph"); if (ph) ph.insertAdjacentHTML("afterend", html);
    } catch (x) {}
    return r;
  };
  props2.addEventListener("focusin", function (e) { if (e.target.dataset && e.target.dataset.clip != null) snap(); });
  props2.addEventListener("input", function (e) {
    var t = e.target; if (!t.dataset || t.dataset.clip == null) return;
    var o = selObj(); if (!o || !o._n) return;
    var v = t.value.trim();
    if (CSS.supports && !CSS.supports("clip-path", v)) { t.style.outline = "1px solid #d7261e"; return; }
    t.style.outline = ""; o._n.style.clipPath = v; edRender();
  });
  props2.addEventListener("click", function (e) {
    if (!e.target.closest || !e.target.closest("[data-clipoff]")) return;
    e.stopPropagation(); var o = selObj(); if (!o || !o._n) return;
    snap(); o._n.style.clipPath = "none"; edRender(); edProps(); toast("Recorte quitado: la capa se ve completa");
  }, true);

  /* N4 · en un vector, la fila «Fill» de abajo y «Relleno» de «Formas del vector» muestran lo mismo */
  props2.addEventListener("input", function (e) {
    var t = e.target; if (!t.dataset || t.dataset.vs == null || t.dataset.vk !== "fill" || t.dataset.vs !== "0") return;
    [].forEach.call(props2.querySelectorAll('[data-k="fill"]'), function (i) { if (i.type === "color" || /^#/.test(i.value)) i.value = t.value; });
  });
  props2.addEventListener("change", function (e) { var t = e.target; if (t.dataset && t.dataset.vs != null) setTimeout(function () { if (!props2.contains(document.activeElement) || document.activeElement === document.body) edProps(); }, 0); });

  /* N5 · Selección directa (A): las anclas y manejadores de cualquier trazado se ven y se arrastran
     (antes solo elegía la capa). Arrastrar un ancla mueve sus manejadores; un manejador cambia la curva. */
  if (typeof KEYMAP !== "undefined") KEYMAP.a = "direct-select";
  if (typeof TOOLS !== "undefined" && TOOLS["direct-select"]) TOOLS["direct-select"][2] = "A";
  function parseD(d) {
    var tk = String(d || "").match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [], i = 0, segs = [], cx = 0, cy = 0, sx = 0, sy = 0, cmd = "", lc = null, lq = null;
    var num = function () { return +tk[i++]; };
    while (i < tk.length) {
      if (/[a-z]/i.test(tk[i])) cmd = tk[i++]; else if (!cmd) return null;
      var rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(), ox = rel ? cx : 0, oy = rel ? cy : 0;
      if (C === "Z") { segs.push({ c: "Z", p: [] }); cx = sx; cy = sy; lc = lq = null; continue; }
      if (C === "M") { cx = ox + num(); cy = oy + num(); sx = cx; sy = cy; segs.push({ c: "M", p: [[cx, cy]] }); cmd = rel ? "l" : "L"; lc = lq = null; continue; }
      if (C === "L") { cx = ox + num(); cy = oy + num(); segs.push({ c: "L", p: [[cx, cy]] }); lc = lq = null; continue; }
      if (C === "H") { cx = ox + num(); segs.push({ c: "L", p: [[cx, cy]] }); lc = lq = null; continue; }
      if (C === "V") { cy = (rel ? cy : 0) + num(); segs.push({ c: "L", p: [[cx, cy]] }); lc = lq = null; continue; }
      if (C === "C" || C === "S") {
        var c1 = C === "C" ? [ox + num(), oy + num()] : lc ? [2 * cx - lc[0], 2 * cy - lc[1]] : [cx, cy];
        var c2 = [ox + num(), oy + num()]; cx = ox + num(); cy = oy + num();
        segs.push({ c: "C", p: [c1, c2, [cx, cy]] }); lc = c2; lq = null; continue;
      }
      if (C === "Q" || C === "T") {
        var q1 = C === "Q" ? [ox + num(), oy + num()] : lq ? [2 * cx - lq[0], 2 * cy - lq[1]] : [cx, cy];
        cx = ox + num(); cy = oy + num(); segs.push({ c: "Q", p: [q1, [cx, cy]] }); lq = q1; lc = null; continue;
      }
      if (C === "A") { var a = [num(), num(), num(), num(), num()]; cx = ox + num(); cy = oy + num(); segs.push({ c: "A", a: a, p: [[cx, cy]] }); lc = lq = null; continue; }
      return null;
    }
    return segs.length && !segs.some(function (s) { return s.p.some(function (q) { return isNaN(q[0]) || isNaN(q[1]); }) || (s.a && s.a.some(isNaN)); }) ? segs : null;
  }
  function serD(segs) {
    var f = function (q) { return rr(q[0]) + " " + rr(q[1]); };
    return segs.map(function (s) { return s.c === "Z" ? "Z" : s.c === "A" ? "A" + s.a.join(" ") + " " + f(s.p[0]) : s.c + s.p.map(f).join(" "); }).join(" ");
  }
  var DS = null; /* { p, segs } del trazado elegido */
  function dsPath() {
    var o = ED.open && ED.tool === "direct-select" && ED.doc && ED.doc._real ? selObj() : null, p = o && onePath(o);
    if (!p) { DS = null; return null; }
    if (!DS || DS.p !== p || DS.d !== p.getAttribute("d")) { var s = parseD(p.getAttribute("d")); DS = s && s.length <= 800 ? { p: p, segs: s, d: p.getAttribute("d") } : null; }
    return DS;
  }
  function dsPoints(ds) {
    /* anclas: el punto final de cada tramo; manejadores: los de C/Q, con el ancla a la que pertenecen */
    var out = [];
    ds.segs.forEach(function (s, si) {
      if (s.c === "Z") return;
      var end = s.p.length - 1;
      out.push({ si: si, k: end, kind: "a" });
      if (s.c === "C") { out.push({ si: si, k: 0, kind: "h", own: [si - 1, ds.segs[si - 1] ? ds.segs[si - 1].p.length - 1 : 0] }); out.push({ si: si, k: 1, kind: "h", own: [si, end] }); }
      if (s.c === "Q") out.push({ si: si, k: 0, kind: "h", own: [si, end] });
    });
    return out;
  }
  function drawNodes() {
    var ds = dsPath();
    if (!ds) return false;
    var c = cv.getBoundingClientRect(), b = vb(ds.p), pts = dsPoints(ds), L = [];
    ov.style.left = c.left + "px"; ov.style.top = c.top + "px"; ov.style.width = c.width + "px"; ov.style.height = c.height + "px";
    var S = function (q) { var s = toScr(ds.p, q, b); return [s[0] - c.left, s[1] - c.top]; };
    pts.forEach(function (pt) {
      if (pt.kind !== "h" || !ds.segs[pt.own[0]]) return;
      var h = S(ds.segs[pt.si].p[pt.k]), a = S(ds.segs[pt.own[0]].p[pt.own[1]]);
      L.push('<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + h[0] + '" y2="' + h[1] + '" stroke="#ff5e00" stroke-width="1"/>');
    });
    var dots = pts.map(function (pt) {
      var q = S(ds.segs[pt.si].p[pt.k]);
      return pt.kind === "a" ? '<rect x="' + (q[0] - 4) + '" y="' + (q[1] - 4) + '" width="8" height="8" fill="#fff" stroke="#ff5e00" stroke-width="1.5"/>' : '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="3.5" fill="#ff5e00"/>';
    });
    ov.innerHTML = '<svg width="' + c.width + '" height="' + c.height + '" style="position:absolute;left:0;top:0;overflow:visible">' + L.join("") + dots.join("") + "</svg>";
    return true;
  }
  var _drawAnchorsN5 = drawAnchors;
  drawAnchors = function () { if (drawNodes()) return; _drawAnchorsN5(); };
  cv.addEventListener("pointerdown", function (e) {
    if (e.button !== 0 || ED.tool !== "direct-select" || ED.space || !ED.open || !ED.doc || !ED.doc._real) return;
    var ds = dsPath(); if (!ds) return; /* sin trazado elegido: el clic elige la capa como siempre */
    var b = vb(ds.p), pts = dsPoints(ds), hit = null;
    pts.slice().sort(function (x, y) { return (x.kind === "h" ? 0 : 1) - (y.kind === "h" ? 0 : 1); }).some(function (pt) { var s = toScr(ds.p, ds.segs[pt.si].p[pt.k], b); if (Math.hypot(s[0] - e.clientX, s[1] - e.clientY) < 8) { hit = pt; return true; } return false; });
    if (!hit) return;
    var o = selObj(); if (o && o.locked) return;
    e.preventDefault(); e.stopImmediatePropagation();
    snap();
    var segs = ds.segs, p = ds.p, start = toLoc(p, e.clientX, e.clientY, b), moved = [];
    var grab = function (si, k) { if (segs[si] && segs[si].p[k]) moved.push([segs[si].p[k], segs[si].p[k].slice()]); };
    grab(hit.si, hit.k);
    if (hit.kind === "a") {
      var s = segs[hit.si], nx = segs[hit.si + 1];
      if (s.c === "C") grab(hit.si, 1);
      if (nx && nx.c === "C") grab(hit.si + 1, 0);
    }
    p.ownerSVGElement.style.overflow = "visible";
    drag(e, function (dx, dy, ev) {
      var q = toLoc(p, ev.clientX, ev.clientY, b), mx = q[0] - start[0], my = q[1] - start[1];
      moved.forEach(function (m) { m[0][0] = m[1][0] + mx; m[0][1] = m[1][1] + my; });
      p.setAttribute("d", serD(segs)); p.removeAttribute("data-anchors"); DS.d = p.getAttribute("d");
      drawNodes();
    }, function () { edRender(); edProps(); });
  }, true);
  /* herramientas de réplica editable (QA Instinct R3 + spec de herramientas nuevas) */
  (function () { var sc = document.createElement("script"); sc.src = "bridge-replica.js?v=" + Date.now().toString(36).slice(0, 6); document.head.appendChild(sc); })();
})();
