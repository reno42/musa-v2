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
  st.textContent = ".ed-frame>.mreal{position:absolute;inset:0}.ed-world [data-real].ed-el:hover{outline:calc(1.5px / var(--z)) solid rgba(255,94,0,.55)}.ed-world [data-real][contenteditable=true]{outline:calc(2px / var(--z)) solid var(--e-accent);cursor:text}";
  document.head.appendChild(st);

  /* ── CSS de cada frame, encerrado en su frame para que no choque con los demás ── */
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
    var type = n.tagName === "IMG" || /image|img|photo/.test(kind) ? "image"
      : /text/.test(kind) || (!n.children.length && n.textContent.trim()) ? "text" : "rect";
    var loose = { locked: n.getAttribute("data-locked") === "true", anim: "none", dur: 600, delay: 0, ease: "ease-out", tag: n.tagName.toLowerCase() };
    var rect = function () { var a = n.getBoundingClientRect(), b = f._root.getBoundingClientRect(), z = ED.z || 1; return { x: (a.left - b.left) / z, y: (a.top - b.top) / z, w: a.width / z, h: a.height / z }; };
    var e = { type: type };
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
    P("fill", function () { var c = cs(n); return c.backgroundImage && c.backgroundImage !== "none" && !/url\(/.test(c.backgroundImage) ? c.backgroundImage : hex(c.backgroundColor); }, function (v) { n.style.background = v; });
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
    var w = +src.width || 1080, h = +src.height || 1080, id = "tf" + (uid++);
    var root = document.createElement("div");
    root.className = "mreal";
    root.setAttribute("data-tf", id);
    root.innerHTML = '<style data-scope>' + scopeCss(src.css, '[data-tf="' + id + '"]') + "</style>" + (src.html || "");
    var f = { name: src.name || "Frame " + (i + 1), x: x, y: 0, bg: src.background || "#ffffff", clip: true, els: [] };
    Object.defineProperty(f, "_root", { value: root, enumerable: false });
    Object.defineProperty(f, "_src", { value: src, enumerable: false });
    var top = root.children[1];
    Object.defineProperty(f, "_content", { value: top || root, enumerable: false });
    var W = w, H = h;
    Object.defineProperty(f, "w", { get: function () { return W; }, set: function (v) { W = +v; if (top && top.style.width) top.style.width = W + "px"; }, enumerable: true });
    Object.defineProperty(f, "h", { get: function () { return H; }, set: function (v) { H = +v; if (top && top.style.height) top.style.height = H + "px"; }, enumerable: true });
    var nodes = [].slice.call(root.querySelectorAll("[data-layer-id]"));
    if (!nodes.length) nodes = [].slice.call(root.querySelectorAll("*")).filter(function (n) { return n.tagName !== "STYLE" && n.tagName !== "BR"; });
    /* el contenedor raíz que ocupa todo el frame es el frame mismo, no una capa */
    if (top && nodes[0] === top) nodes.shift();
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

  /* ── guardado automático ── */
  var saveT = null, saving = false;
  function save(now) {
    var doc = ED.doc; if (!doc || !doc._real) return;
    clearTimeout(saveT);
    var run = function () {
      if (saving) { saveT = setTimeout(run, 800); return; }
      var p = payload(doc), sig = JSON.stringify(p);
      if (sig === doc._saved) return;
      saving = true;
      api("/api/templates/" + encodeURIComponent(doc._id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: sig })
        .then(function () { doc._saved = sig; var t = RB.tpl.find(function (x) { return x.id === doc._id; }); if (t) t.name = doc.name; },
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
      f.els = f.els.map(function (e) { return e && e._n ? e : materialize(e, f); }).filter(function (e) { return e._n.isConnected || f._root.contains(e._n); });
    });
    var keep = fr.map(function (f) { return f.els; });
    fr.forEach(function (f) { f.els = []; });
    try { _edRender(); } finally { fr.forEach(function (f, i) { f.els = keep[i]; }); }
    fr.forEach(function (f, fi) {
      var box = world.querySelector('.ed-frame[data-f="' + fi + '"]');
      if (!box || !f._root) return;
      box.insertBefore(f._root, box.firstChild);
      f.els.forEach(function (e, ei) { var n = e._n; n.classList.add("ed-el"); n.setAttribute("data-real", "1"); n.dataset.f = fi; n.dataset.e = ei; });
    });
    edSelBox();
    save();
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

  /* abrir un diseño real en el editor */
  RB.openDesign = function (id) {
    if (typeof uiToast === "function") uiToast("Abriendo diseño…");
    api("/rest/v1/templates?id=eq." + encodeURIComponent(id) + "&select=id,name,data,workspace_id").then(function (rows) {
      var t = rows && rows[0]; if (!t) throw new Error("no encontrado");
      var d = t.data || {}, src = Array.isArray(d.frames) && d.frames.length ? d.frames : [{ name: t.name, html: d.html || "", css: d.css || "", width: d.width, height: d.height, background: "#ffffff" }];
      var x = 0, frames = src.map(function (s, i) { var f = buildFrame(s, i, x); x += f.w + 120; return f; });
      var brand = (RB.brandName && d.brandId && RB.brandName[d.brandId]) || "Sin marca";
      var doc = { name: t.name || "Diseño", brand: brand, campaign: "—", tags: [], frames: frames, _real: true, _id: t.id };
      ED_FILES.push({ name: doc.name, brand: "\u0000", campaign: "", tags: [], frames: [{ name: "", w: 1, h: 1, bg: "#fff", els: [] }] });
      var i = ED_FILES.length - 1;
      ED_DOCS[i] = doc;
      doc._saved = JSON.stringify(payload(doc));
      location.hash = "crear/disenos/" + i;
    }).catch(function (e) { if (typeof uiToast === "function") uiToast("No se pudo abrir: " + (e && e.message)); });
  };
})();
