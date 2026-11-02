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
    css = String(css || "").replace(/@import[^;]+;/g, function (m) { imports.push(m); return ""; });
    try { var sh = new CSSStyleSheet(); sh.replaceSync(css); return imports.join("\n") + "\n" + scopeRules(sh.cssRules, sc); }
    catch (e) { return imports.join("\n") + "\n" + css; }
  }

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
    P("fill", function () {
      if (n.tagName === "IMG") return 'url("' + (n.getAttribute("src") || "") + '") center/cover no-repeat';
      var c = cs(n); if (c.backgroundImage && c.backgroundImage !== "none") return /url\(/.test(c.backgroundImage) ? c.backgroundImage + " center/cover no-repeat" : c.backgroundImage; return hex(c.backgroundColor);
    }, function (v) {
      var u = (String(v).match(/url\(["']?([^"')]+)["']?\)/) || [])[1];
      if (n.tagName === "IMG" && u) { n.setAttribute("src", u); n.removeAttribute("srcset"); return; }
      if (u && /url\(/.test(cs(n).backgroundImage || "")) { n.style.backgroundImage = "url('" + u + "')"; return; }
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
    P("stroke", function () { return hex(cs(n).borderTopColor); }, function (v) { n.style.borderColor = v; });
    P("strokeW", function () { return parseFloat(cs(n).borderTopWidth) || 0; }, function (v) { n.style.borderWidth = v + "px"; if (v && cs(n).borderTopStyle === "none") n.style.borderStyle = "solid"; });
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
    n.setAttribute("data-layer-kind", o.type === "text" ? "text" : o.type === "image" ? "image" : "shape");
    (f._content || f._root).appendChild(n);
    return makeEl(n, f);
  }

  /* ── armar el documento del editor con un template real ── */
  function buildFrame(src, i, x) {
    if (!src.id) src.id = "frame_" + Date.now().toString(36) + "_" + (uid++);
    var w = +src.width || 1080, h = +src.height || 1080, id = "tf" + (uid++);
    var root = document.createElement("div");
    root.className = "mreal";
    root.setAttribute("data-tf", id);
    root.innerHTML = '<style data-scope>' + scopeCss(src.css, SCOPE(id)) + "</style>" + (src.html || "");
    var f = { name: src.name || "Frame " + (i + 1), x: x, y: 0, bg: src.background || "#ffffff", clip: true, els: [] };
    Object.defineProperty(f, "_root", { value: root, enumerable: false });
    Object.defineProperty(f, "_src", { value: src, enumerable: false });
    var top = root.children[1];
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
      var tag = n.tagName.toLowerCase(), txt = (n.children.length ? "" : (n.textContent || "").trim()).slice(0, 28), cls = (n.getAttribute("class") || "").split(/\s+/)[0];
      n.setAttribute("data-layer-id", "musa_" + Date.now().toString(36) + "_" + (uid++));
      if (!n.hasAttribute("data-layer-name")) n.setAttribute("data-layer-name", txt || cls || tag);
      if (!n.hasAttribute("data-layer-kind")) n.setAttribute("data-layer-kind", tag === "img" ? "image" : tag === "svg" ? "svg" : txt ? "text" : n.children.length ? "container" : "shape");
    });
    var nodes = [].slice.call(root.querySelectorAll("[data-layer-id]"));
    /* el contenedor raíz que ocupa todo el frame es el frame mismo, no una capa */
    if (top && nodes[0] === top && top.children.length) nodes.shift();
    f.els = nodes.map(function (n) { return makeEl(n, f); });
    return f;
  }

  function serializeFrame(f) {
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
  var uploads = {}, pendingUp = 0;
  function blobsIn(doc) {
    var out = [];
    doc.frames.forEach(function (f) { if (!f._root) return; f._root.querySelectorAll("*").forEach(function (n) {
      var src = n.tagName === "IMG" ? n.getAttribute("src") : null; if (src && /^blob:/.test(src)) out.push([n, "src", src]);
      var bg = n.style && n.style.backgroundImage, m = bg && bg.match(/url\(["']?(blob:[^"')]+)["']?\)/); if (m) out.push([n, "bg", m[1]]);
    }); });
    return out;
  }
  function uploadBlobs(doc) {
    blobsIn(doc).forEach(function (it) {
      var url = it[2];
      if (!uploads[url]) {
        pendingUp++;
        uploads[url] = fetch(url).then(function (r) { return r.blob(); }).then(function (b) { return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.readAsDataURL(b); }); })
          .then(function (data) { return api("/api/assets/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "foto-" + Date.now() + ".jpg", data: data, workspaceId: RB.ws }) }); })
          .then(function (x) { var a = x.data || x.asset || x; return a.url || (a.asset && a.asset.url); })
          .then(function (u) { pendingUp--; if (!u) throw new Error("sin url"); return u; }, function (e) { pendingUp--; toast("No se pudo subir la foto: " + (e && e.message)); throw e; });
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
  RB._ed = { payload: function () { return ED.doc && ED.doc._real ? payload(ED.doc) : null; }, blobs: function () { return ED.doc ? blobsIn(ED.doc).length : -1; }, pending: function () { return pendingUp; }, save: function () { save(true); } };
  function save(now) {
    var doc = ED.doc; if (!doc || !doc._real) return;
    clearTimeout(saveT);
    var run = function () {
      if (saving) { saveT = setTimeout(run, 800); return; }
      if (pendingUp || blobsIn(doc).length) { uploadBlobs(doc); saveT = setTimeout(run, 1000); return; }
      var p = payload(doc), sig = JSON.stringify(p);
      if (sig === doc._saved) return;
      saving = true;
      api("/api/templates/" + encodeURIComponent(doc._id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: sig })
        .then(function () { doc._saved = sig; remoteAt(doc); var t = RB.tpl.find(function (x) { return x.id === doc._id; }); if (t) t.name = doc.name; if (RB.f0) RB.f0[doc._id] = p.frames[0]; },
              function (e) { toast("No se pudo guardar: " + (e && e.message || "error")); })
        .then(function () { saving = false; });
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
    root.innerHTML = '<style data-scope>' + scopeCss(src.css, SCOPE(id)) + "</style>" + (src.html || "");
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

  /* Presentar: cada frame con su HTML real (colores, fotos y tipografía del diseño) */
  var _edPresent = edPresent;
  edPresent = function (i) {
    if (!ED.doc || !ED.doc._real) return _edPresent(i);
    ED.pi = Math.max(0, Math.min(i, ED.doc.frames.length - 1));
    var p = eq("#edPres"), f = ED.doc.frames[ED.pi], s = Math.min(innerWidth * 0.9 / f.w, (innerHeight - 90) / f.h);
    p.innerHTML = '<div class="ed-pbar">' + (ED.pi + 1) + " / " + ED.doc.frames.length + " · " + eesc(f.name) + ' · ← → para navegar · Esc para salir</div><button class="ed-px" title="Salir">×</button>';
    p.insertBefore(stage(frameClone(f), f.w, f.h, f.bg, s, "ed-mini-w"), p.firstChild);
    p.hidden = false;
  };

  /* ── exportar de verdad: PNG, JPG, SVG, PDF y JSON ── */
  function loadLib(src, glob) {
    if (window[glob]) return Promise.resolve(window[glob]);
    return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = src; s.onload = function () { res(window[glob]); }; s.onerror = function () { rej(new Error("no cargó " + src)); }; document.head.appendChild(s); });
  }
  function waitImages(el) {
    return Promise.all([].map.call(el.querySelectorAll("img"), function (im) { return im.complete ? 0 : new Promise(function (r) { im.onload = im.onerror = r; setTimeout(r, 8000); }); }));
  }
  function shot(f, scale) {
    return loadLib("vendor/html2canvas.min.js", "html2canvas").then(function () {
      var host = document.createElement("div");
      host.style.cssText = "position:fixed;left:0;top:0;z-index:-1;pointer-events:none";
      var inner = stage(frameClone(f), f.w, f.h, f.bg, 1).firstChild;
      inner.style.transform = "none"; inner.style.position = "relative";
      host.appendChild(inner); document.body.appendChild(host);
      inner.querySelectorAll("img").forEach(function (im) { im.crossOrigin = "anonymous"; if (im.src) im.src = im.src; });
      return waitImages(inner).then(function () {
        return html2canvas(inner, { useCORS: true, backgroundColor: f.bg || null, scale: scale, width: f.w, height: f.h, logging: false });
      }).then(function (c) { host.remove(); return c; }, function (e) { host.remove(); throw e; });
    });
  }
  function download(name, href) { var a = document.createElement("a"); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
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
      }).then(function () { pdf.save(base + ".pdf"); });
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
  }, true);
  var _mExp = MENUS.exportar;
  MENUS.exportar = function () {
    var items = _mExp();
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
  function pickFile(accept) {
    return new Promise(function (res) {
      var i = document.createElement("input"); i.type = "file"; i.accept = accept; i.style.display = "none";
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
  function htmlToFrame(html, name) {
    var d = new DOMParser().parseFromString(html, "text/html"), css = [].map.call(d.querySelectorAll("style"), function (s) { return s.textContent; }).join("\n");
    d.querySelectorAll("style,script").forEach(function (s) { s.remove(); });
    var root = d.body.firstElementChild, w = root ? parseFloat(root.style.width) || 1080 : 1080, h = root ? parseFloat(root.style.height) || 1080 : 1080;
    return { id: "frame_" + Date.now().toString(36), name: name || "Importado", html: d.body.innerHTML, css: css, width: w, height: h, background: "#ffffff", x: 0, y: 0 };
  }
  var IMPORT_TYPE = { "SVG": ["svg", ".svg,image/svg+xml"], "PSD": ["psd", ".psd"], "AI": ["ai", ".ai"], "FIG (Figma)": ["fig", ".fig"] };
  function doImport(label) {
    var doc = ED.doc;
    if (label === "Pegar HTML…") { var h = prompt("Pega el HTML (con su <style>) del frame:"); if (h && h.trim()) addFrames([htmlToFrame(h, "HTML pegado")]); return; }
    if (label === "HTML / CSS") return pickFile(".html,.htm,text/html").then(function (f) { if (f) return readText(f).then(function (t) { addFrames([htmlToFrame(t, f.name.replace(/\.\w+$/, ""))]); }); });
    if (label === "Template JSON") return pickFile(".json,application/json").then(function (f) { if (!f) return; return readText(f).then(function (t) { var j = JSON.parse(t), fr = j.frames || (j.data && j.data.frames) || []; if (!fr.length) throw new Error("el JSON no trae frames"); addFrames(fr); }); }).catch(function (e) { toast("No se pudo importar: " + e.message); });
    var tp = IMPORT_TYPE[label]; if (!tp) return toast(label + " todavía no está disponible");
    var ws = RB.ws, file;
    return pickFile(tp[1]).then(function (f) {
      if (!f) return; file = f;
      toast("Subiendo " + f.name + "…");
      save(true);
      return api("/api/design-imports/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: ws, size: f.size, name: f.name, sourceType: tp[0] }) })
        .then(function (x) { var u = x.data; return fetch(u.signedUrl, { method: "PUT", headers: { "Content-Type": f.type || "application/octet-stream", "x-upsert": "false" }, body: f }).then(function (r) { if (!r.ok) throw new Error("subida " + r.status); return u.id; }); })
        .then(function (id) { toast("Convirtiendo a capas editables…"); return api("/api/design-imports/jobs/" + id + "/convert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: ws }) }).then(function () { return id; }); })
        .then(function (id) { return api("/api/design-imports/jobs/" + id + "/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: ws, templateId: doc._id }) }); })
        .then(function () { toast(file.name + " importado como frames nuevos"); RB.openDesign(doc._id); });
    }).catch(function (e) { toast("No se pudo importar: " + (e && e.message || "error")); });
  }
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
      return readText(f).then(function (t) {
        var rows = parseCsv(t), head = (rows.shift() || []).map(function (h) { return h.trim(); });
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
        toast(out.length + " frames creados desde " + f.name);
      });
    }).catch(function (e) { toast("No se pudo aplicar el CSV: " + (e && e.message)); });
  }
  function shareUrl(doc) { var o; try { o = window.parent.location.origin; } catch (e) { o = location.origin; } return o + "/c/" + doc._id; }
  function setPublic(doc, on) {
    return api("/rest/v1/templates?id=eq." + encodeURIComponent(doc._id), { method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ is_public: on }) })
      .then(function () { doc._public = on; ED.share = on ? "publico" : "privado"; toast(on ? "Ahora es público: los invitados ven el diseño y comentan" : "Ahora es privado"); }, function (e) { toast("No se pudo cambiar: " + (e && e.message)); });
  }
  var _mImp = MENUS.import, _mBatch = MENUS.batch, _mShare = MENUS.compartir, _mEditor = MENUS.editor;
  MENUS.import = function () { var it = _mImp(); if (!ED.doc || !ED.doc._real) return it; return it.map(function (x) { return x && x.l ? Object.assign({}, x, { fn: function () { doImport(x.l); } }) : x; }); };
  MENUS.batch = function () { var it = _mBatch(); if (!ED.doc || !ED.doc._real) return it; return it.map(function (x) { return x && x.l ? Object.assign({}, x, { d: (x.d ? x.d + " · " : "") + "desde un CSV", fn: doBatch }) : x; }); };
  MENUS.compartir = function () {
    var it = _mShare(); if (!ED.doc || !ED.doc._real) return it; var doc = ED.doc;
    ED.share = doc._public ? "publico" : "privado";
    return _mShare().map(function (x) {
      if (!x || !x.l) return x;
      if (x.l === "Copiar enlace") return Object.assign({}, x, { d: shareUrl(doc).replace(/^https?:\/\//, ""), fn: function () { var u = shareUrl(doc); (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(function () { toast("Enlace copiado" + (doc._public ? "" : " · hazlo público para que tus invitados lo vean")); }, function () { prompt("Copia el enlace:", u); }); } });
      if (x.l === "Privado") return Object.assign({}, x, { on: !doc._public, fn: function () { setPublic(doc, false); } });
      if (x.l === "Público") return Object.assign({}, x, { on: !!doc._public, fn: function () { setPublic(doc, true); } });
      return x;
    });
  };
  MENUS.editor = function () {
    var it = _mEditor(); if (!ED.doc || !ED.doc._real) return it;
    return it.map(function (x) { return x && x.l === "Editor de video" ? Object.assign({}, x, { fn: function () { if (RB.videoFromDesign) RB.videoFromDesign(ED.doc); } }) : x; });
  };
  RB._buildFrame = function (src, x) { return buildFrame(src, ED.doc.frames.length, x); };
  RB.shotFrame = function (f) { return shot(f, 1).then(function (c) { return c.toDataURL("image/jpeg", 0.9); }); };

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
    var c = n.cloneNode(true);
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
      var label = prompt("Nombre de la versión:", "Versión guardada a mano"); if (label === null) return;
      save(true);
      setTimeout(function () {
        api("/api/templates/" + encodeURIComponent(doc._id) + "/versions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: label, kind: "marked" }) })
          .then(function () { toast("Versión guardada"); return loadVersions(doc); }, function (e) { toast("No se pudo guardar la versión: " + (e && e.message)); });
      }, 1600);
      return;
    }
    return _act.apply(this, arguments);
  };

  /* Historial: versiones reales del diseño */
  function loadVersions(doc) {
    return api("/api/templates/" + encodeURIComponent(doc._id) + "/versions?limit=30").then(function (x) {
      var list = (x && (x.data || x)) || [];
      list = Array.isArray(list) ? list : [];
      doc._versions = list;
      ED.versions = list.map(function (v, i) {
        var d = v.created_at || v.createdAt, who = v.author || v.author_name || v.createdBy || "";
        return [(v.label || (v.kind === "auto" ? "Autoguardado" : "Versión")) + " · " + (list.length - i), d ? new Date(d).toLocaleString("es-PE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "", who || "—"];
      });
      if (ED.open && ED.panel === "historial") edProps();
    }, function () { ED.versions = []; });
  }
  edRoot.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest('[data-demo^="Restaurar "]');
    if (!b || !ED.doc || !ED.doc._real) return;
    e.stopPropagation(); e.preventDefault();
    var all = [].slice.call(edRoot.querySelectorAll('[data-demo^="Restaurar "]')), v = (ED.doc._versions || [])[all.indexOf(b)];
    if (!v || !confirm("¿Restaurar esta versión? El estado actual queda guardado como versión.")) return;
    var id = ED.doc._id;
    save(true);
    api("/api/templates/" + encodeURIComponent(id) + "/versions/" + encodeURIComponent(v.id || v.versionId) + "/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(function () { toast("Versión restaurada"); RB.openDesign(id); }, function (err) { toast("No se pudo restaurar: " + (err && err.message)); });
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
    var k = prompt("Forma de la máscara: círculo, redondeado, rombo, triángulo o ninguna", "círculo"); if (!k) return;
    var shapes = { "círculo": "circle(50% at 50% 50%)", "circulo": "circle(50% at 50% 50%)", "redondeado": "inset(0 round 12%)", "rombo": "polygon(50% 0,100% 50%,50% 100%,0 50%)", "triángulo": "polygon(50% 0,100% 100%,0 100%)", "triangulo": "polygon(50% 0,100% 100%,0 100%)", "ninguna": "" };
    var shape = shapes[k.trim().toLowerCase()];
    if (shape === undefined) return toast("Forma no reconocida");
    snap(); o._n.style.clipPath = shape; if (o._n.tagName === "IMG") o._n.style.objectFit = "cover"; edRender(); toast(shape ? "Máscara aplicada" : "Máscara quitada");
  }
  function frameToTemplate() {
    var s = ED.sel, f = ED.doc.frames[s ? s.f : 0]; if (!f) return;
    var src = payload({ name: ED.doc.name, frames: [f] }).frames[0], name = prompt("Nombre de la plantilla:", f.name); if (!name) return;
    api("/api/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name, width: f.w, height: f.h, workspaceId: RB.ws, engine: "html", html: src.html, css: src.css }) })
      .then(function (x) {
        var t = (x && (x.data || x.template)) || x, id = t && (t.id || (t.template && t.template.id)); if (!id) throw new Error("sin id");
        return api("/api/templates/" + encodeURIComponent(id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name, frames: [Object.assign({}, src, { id: "frame_" + Date.now().toString(36), x: 0, y: 0 })] }) }).then(function () { return id; });
      })
      .then(function (id) { RB.tpl.unshift({ id: id, name: name, w: f.w, h: f.h }); TILES["crear/disenos"].unshift([eesc(name), "Sin marca", f.w + "×" + f.h]); toast("Plantilla «" + name + "» creada en Crear › Diseños"); }, function (e) { toast("No se pudo crear la plantilla: " + (e && e.message)); });
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
    return pickFile("image/*").then(function (f) {
      if (!f) return null; toast("Subiendo " + f.name + "…");
      return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.readAsDataURL(f); })
        .then(function (d) { return api("/api/assets/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: f.name, data: d, workspaceId: RB.ws }) }); })
        .then(function (x) { return { url: x.url, name: f.name }; });
    });
  }
  edRoot.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest('[data-demo="Subir imagen"],[data-demo="Subir recurso"],[data-demo="Reemplazar imagen"],[data-demo="Aplicar marca"],[data-demo="Verificar design system"]');
    if (!b || !ED.doc || !ED.doc._real) return;
    e.stopPropagation(); e.preventDefault();
    var k = b.dataset.demo, doc = ED.doc;
    if (k === "Reemplazar imagen") {
      var o = selObj(); if (!o || o.type !== "image") return toast("Selecciona una imagen");
      return pickImage().then(function (r) { if (!r) return; snap(); o.fill = "url('" + r.url + "') center/cover no-repeat"; edRender(); edProps(); toast("Imagen reemplazada"); }, function (err) { toast("No se pudo subir: " + (err && err.message)); });
    }
    if (k === "Subir imagen" || k === "Subir recurso") {
      return pickImage().then(function (r) {
        if (!r) return; var f = doc.frames[ED.sel ? ED.sel.f : 0]; snap();
        f.els.push(Object.assign({}, DEF, { type: "image", name: r.name, x: Math.round(f.w * .2), y: Math.round(f.h * .2), w: Math.round(f.w * .6), h: Math.round(f.w * .6), fill: "url('" + r.url + "') center/contain no-repeat" }));
        edRender(); edLayers(); toast("Imagen agregada al frame");
        if (RB.assets) RB.assets.unshift({ name: r.name, url: r.url, mime_type: "image/png" });
      }, function (err) { toast("No se pudo subir: " + (err && err.message)); });
    }
    if (k === "Aplicar marca") {
      return api("/rest/v1/brand_guidelines?workspace_id=eq." + encodeURIComponent(RB.ws) + "&select=id,name&order=updated_at.desc&limit=30").then(function (gs) {
        if (!gs || !gs.length) throw new Error("este espacio no tiene guías de marca: crea una con «Convertir archivo en design system»");
        var pick = prompt("¿Qué guía aplico?\n" + gs.map(function (g, i) { return (i + 1) + ". " + g.name; }).join("\n"), "1"); var g = gs[(+pick || 0) - 1]; if (!g) return;
        save(true);
        return RB.mcp("apply_brand_to_template", { templateId: doc._id, brandId: g.id }).then(function () { doc.brand = g.name; eq("#edBrand").textContent = g.name; toast("Marca «" + g.name + "» aplicada al archivo"); });
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
      var col = prompt("Color o degradado para rellenar la selección:", "#ff5e00"); if (!col) return;
      return afterMcp(doc, function () { return RB.mcp("fill_mask", { templateId: doc._id, frameId: fid, imageLayerId: L, fill: col }); }, "Selección rellenada");
    }
    var shape = label === "Eliminar exterior" ? "elipse" : prompt("Forma de la selección: elipse o rectángulo", "elipse"); if (!shape) return;
    var x = o.x + o.w * .1, y = o.y + o.h * .1, w = o.w * .8, h = o.h * .8, d;
    if (/rect/i.test(shape)) d = "M" + x + " " + y + " H" + (x + w) + " V" + (y + h) + " H" + x + " Z";
    else { var rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry; d = "M" + (cx - rx) + " " + cy + " a" + rx + " " + ry + " 0 1 0 " + (2 * rx) + " 0 a" + rx + " " + ry + " 0 1 0 " + (-2 * rx) + " 0 Z"; }
    return afterMcp(doc, function () { return RB.mcp("create_mask_from_path", { templateId: doc._id, frameId: fid, pathData: d, x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h), targetImageLayerId: L, mode: "include" }); }, label === "Eliminar exterior" ? "Se ocultó el exterior de la imagen" : "Selección creada (editable como trazado)");
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
          if (ED.doc && ED.doc !== doc) { Object.assign(ED, { z: keep.z, px: keep.px, py: keep.py, panel: keep.panel }); if (keep.sel && ED.doc.frames[keep.sel.f] && (keep.sel.e == null || ED.doc.frames[keep.sel.f].els[keep.sel.e])) ED.sel = keep.sel; edRender(); edLayers(); edProps(); edView(); toast("Actualizado: hubo cambios desde MCP"); }
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
  RB.openDesign = function (id) {
    if (typeof uiToast === "function") uiToast("Abriendo diseño…");
    api("/rest/v1/templates?id=eq." + encodeURIComponent(id) + "&select=id,name,data,workspace_id,is_public,updated_at").then(function (rows) {
      var t = rows && rows[0]; if (!t) throw new Error("no encontrado");
      var d = t.data || {}, src = Array.isArray(d.frames) && d.frames.length ? d.frames : [{ name: t.name, html: d.html || "", css: d.css || "", width: d.width, height: d.height, background: "#ffffff" }];
      var x = 0, frames = src.map(function (s, i) { var f = buildFrame(s, i, x); x += f.w + 120; return f; });
      var brand = (RB.brandName && d.brandId && RB.brandName[d.brandId]) || "Sin marca";
      var doc = { name: t.name || "Diseño", brand: brand, campaign: "—", tags: [], frames: frames, _real: true, _id: t.id, _public: !!t.is_public, _remoteAt: t.updated_at };
      ED_FILES.push({ name: doc.name, brand: "\u0000", campaign: "", tags: [], frames: [{ name: "", w: 1, h: 1, bg: "#fff", els: [] }] });
      var i = ED_FILES.length - 1;
      ED_DOCS[i] = doc;
      doc._saved = null;
      loadVersions(doc); loadPins(doc);
      location.hash = "crear/disenos/" + i;
    }).catch(function (e) { if (typeof uiToast === "function") uiToast("No se pudo abrir: " + (e && e.message)); });
  };
})();
