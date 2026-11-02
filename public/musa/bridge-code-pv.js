/* bridge-code-pv.js — modo código completo para Fotos y Video.
 * Fotos: revelado (receta) + capas (texto editable; píxeles por referencia o reemplazables por URL)
 *        + máscaras de pincel (por referencia). Vista previa: la foto revelada de verdad.
 * Video: el proyecto entero (formato, pistas, tomas, textos, audio, efectos y transiciones) con
 *        vista previa del cuadro en el segundo que elijas.
 * Se carga después de bridge-code.js y reemplaza sus adaptadores de fotos y video.
 */
(function init() {
  var C = window.__musaCode; if (!C) return setTimeout(init, 100);
  var A = C.adapters;
  function J(o) { return JSON.stringify(o, null, 2); }
  function clean(o) { return JSON.parse(JSON.stringify(o, function (k, v) { return k.charAt(0) === "_" || typeof v === "function" || (v && v.nodeType) || (typeof HTMLCanvasElement !== "undefined" && v instanceof HTMLCanvasElement) ? undefined : v; })); }
  function RB() { return window.__musaReal; }
  function loadImg(url) { return new Promise(function (res, rej) { var im = new Image(); im.crossOrigin = "anonymous"; im.onload = function () { res(im); }; im.onerror = function () { rej(new Error("no se pudo cargar " + url)); }; im.src = url; }); }

  /* ───────── FOTOS ───────── */
  function layersSpec() {
    return phLayers().map(function (L) {
      var o = { id: L.id, kind: L.kind, name: L.name, opacidad: L.op, mezcla: L.blend, visible: L.vis };
      if (L.kind === "text" && L.text) o.texto = clean(L.text);
      else o.pixeles = "bitmap:capa-" + L.id;
      return o;
    });
  }
  function parsePhoto(files) {
    var by = {}; files.forEach(function (f) { by[f.name] = f.text; });
    var r = JSON.parse(by["revelado.json"]), l = JSON.parse(by["capas.json"] || '{"capas":[]}');
    if (!r || typeof r !== "object") throw new Error("revelado.json inválido");
    if (!Array.isArray(l.capas)) throw new Error("capas.json necesita la lista «capas»");
    l.capas.forEach(function (c, i) {
      if (c.kind !== "text" && c.kind !== "paint") throw new Error("capa " + (i + 1) + ": kind debe ser «text» o «paint»");
      if (c.kind === "text" && (!c.texto || typeof c.texto.s !== "string")) throw new Error("capa " + (i + 1) + ": falta texto.s");
    });
    return { r: r, capas: l.capas };
  }
  function textDefaults() {
    var any = phLayers().find(function (L) { return L.kind === "text" && L.text; });
    return any ? JSON.parse(JSON.stringify(any.text)) : { s: "Texto", x: 0.1, y: 0.1, size: 0.08, color: "#ffffff", weight: 700, font: Object.keys(typeof FONTS !== "undefined" ? FONTS : { sans: 1 })[0], vert: false };
  }
  function applyLayers(capas) {
    var cur = phLayers(), byId = {}, out = [], jobs = [];
    cur.forEach(function (L) { byId[L.id] = L; });
    capas.forEach(function (c) {
      var L = c.id != null && byId[c.id];
      if (!L) {
        L = phNewLayer(c.kind, c.kind === "text" ? { text: Object.assign(textDefaults(), c.texto || {}) } : {});
        phLayers().splice(phLayers().indexOf(L), 1);
      }
      L.name = c.name || L.name; L.op = c.opacidad == null ? L.op : Math.max(0, Math.min(100, +c.opacidad)); L.blend = c.mezcla || L.blend; L.vis = c.visible !== false;
      if (L.kind === "text" && c.texto) { L.text = Object.assign({}, L.text || textDefaults(), c.texto); phLayerRender(L); }
      if (L.kind === "paint" && typeof c.pixeles === "string" && /^https?:|^data:image\//.test(c.pixeles)) {
        jobs.push(loadImg(c.pixeles).then(function (im) { var x = L.cv.getContext("2d"); x.clearRect(0, 0, L.cv.width, L.cv.height); x.drawImage(im, 0, 0, L.cv.width, L.cv.height); }));
      }
      out.push(L);
    });
    PH.layersBy[PH.key] = out;
    if (!out.some(function (L) { return L.id === PH.layer; })) PH.layer = out.length ? out[out.length - 1].id : null;
    return Promise.all(jobs);
  }
  A.photo = {
    title: "Fotos",
    ready: function () { return typeof PH !== "undefined" && PH.open && PH.r && PH.src; },
    files: function () {
      return [
        { name: "revelado.json", lang: "json", text: J(clean(PH.r)) },
        { name: "capas.json", lang: "json", text: J({ _ayuda: "kind text = texto editable (texto.s, x, y, size, color, weight, font). kind paint = píxeles: deja «bitmap:capa-N» para conservarlos o pon una URL https/data:image para reemplazarlos. Borra una capa quitándola de la lista; el orden es de abajo hacia arriba.", capas: layersSpec() }) },
      ];
    },
    previewEl: function (box, files) {
      var p = parsePhoto(files), keepR = PH.r, keepL = PH.layersBy[PH.key];
      try {
        PH.r = Object.assign({}, keepR, p.r);
        var byId = {}; (keepL || []).forEach(function (L) { byId[L.id] = L; });
        PH.layersBy[PH.key] = p.capas.map(function (c) { var L = byId[c.id]; if (!L) return null; return Object.assign({}, L, { op: c.opacidad == null ? L.op : +c.opacidad, blend: c.mezcla || L.blend, vis: c.visible !== false }); }).filter(Boolean);
        var cv = phFlatten(900);
        box.innerHTML = ""; cv.style.cssText = "max-width:calc(100% - 32px);max-height:calc(100% - 32px);box-shadow:0 10px 40px rgba(0,0,0,.5)"; box.appendChild(cv);
      } finally { PH.r = keepR; PH.layersBy[PH.key] = keepL; }
    },
    apply: function (files) {
      var p = parsePhoto(files);
      phSnap();
      PH.r = Object.assign({}, PH.r, p.r);
      if (!Array.isArray(PH.r.masks)) PH.r.masks = [];
      if (!PH.r.masks.some(function (m) { return m.id === PH.mask; })) PH.mask = null;
      Object.keys(PH.brushCv || {}).forEach(function (id) { if (!PH.r.masks.some(function (m) { return String(m.id) === String(id); })) delete PH.brushCv[id]; });
      return applyLayers(p.capas).then(function () { phMountLayers(); phAll(); return "Foto actualizada (Ctrl+Z deshace el revelado)"; });
    },
    agent: function (files) {
      var p = parsePhoto(files), tid = PH.doc && PH.doc._id, lid = (PH.t && (PH.t.lid || PH.t.id)) || "<data-layer-id de la imagen>";
      var MAP = { basic: "basic", wb: "white_balance", color: "color", hsl: "hsl", curve: "tone_curve", grade: "color_grading", detail: "detail", fx: "effects", bw: "bw" };
      var ops = Object.keys(MAP).filter(function (k) { return p.r[k]; });
      return "## Revelar la misma foto (tools de fotos sobre la capa de imagen del diseño)\n" + C.mcpCall("photo_open_session", { templateId: tid || "<templateId>", layerId: lid })
        + ops.map(function (k) { return "\n\n" + C.mcpCall("photo_apply_operation", { templateId: tid || "<templateId>", layerId: lid, type: MAP[k], params: p.r[k] }); }).join("")
        + (ops.length ? "" : "\n\n" + C.mcpCall("photo_apply_operation", { templateId: tid || "<templateId>", layerId: lid, type: "basic", params: p.r.light || {} }))
        + "\n\n## Capas de texto y composición\n" + C.mcpCall("photo_compose_add_layer", { templateId: tid || "<templateId>", layerId: lid, kind: "text", name: "Titular", text: (p.capas.find(function (c) { return c.kind === "text"; }) || {}).texto || { s: "Texto" } });
    },
  };

  /* ───────── VIDEO ───────── */
  function vparse(files) {
    var p = JSON.parse(files[0].text);
    if (!p || !Array.isArray(p.v1)) throw new Error("el video necesita la pista «v1» (tomas)");
    ["m", "t", "a"].forEach(function (k) { if (p[k] != null && !Array.isArray(p[k])) throw new Error("«" + k + "» debe ser una lista"); });
    if (p.fmt && typeof VFMT !== "undefined" && !VFMT[p.fmt]) throw new Error("fmt debe ser uno de: " + Object.keys(VFMT).join(", "));
    return normalize(p);
  }
  /* lo que agregues por código recibe los mismos valores por defecto que pone el editor visual al crearlo */
  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }
  function normalize(p) {
    var id = function (x) { return x.id || nid(); };
    p.v1 = p.v1.map(function (c, i) {
      if (!c || typeof c !== "object") throw new Error("v1[" + i + "] debe ser un objeto");
      var o = Object.assign({ in: 0, speed: 1, vol: 1, look: "none", lookK: 1, fx: "none", ovl: "none", trans: null }, c, { id: id(c) });
      o.dur = num(o.dur, 3); if (o.dur <= 0) throw new Error("v1[" + i + "].dur debe ser mayor que 0");
      if (!o.kind) o.kind = o.scene || o.ref ? "scene" : "take";
      if (o.kind === "scene" && !o.fit) o.fit = "contain";
      return o;
    });
    p.t = (p.t || []).map(function (c, i) {
      var txt = c.text != null ? c.text : c.s;
      if (typeof txt !== "string") throw new Error("t[" + i + "] necesita «text»");
      var o = Object.assign({ x: 50, y: 82, size: 64, font: "Inter", weight: 800, color: "#ffffff", bg: "", anim: "pop" }, c, { id: id(c), text: txt });
      delete o.s; o.start = num(o.start, 0); o.dur = num(o.dur, 2); return o;
    });
    p.m = (p.m || []).map(function (c, i) {
      var o = Object.assign({ name: "Media", start: 0, dur: 3, x: 50, y: 50, w: 40, ar: 1, opacity: 1, radius: 0, anim: "fade", bg: "#333" }, c, { id: id(c) });
      if (c.url && !c.bg) o.bg = "url('" + c.url + "') center/cover no-repeat";
      o.start = num(o.start, 0); o.dur = num(o.dur, 3); return o;
    });
    p.a = (p.a || []).map(function (c, i) {
      var o = Object.assign({ name: "Audio", start: 0, dur: 5, vol: 0.7, fin: 0, fout: 0.5 }, c, { id: id(c) });
      o.start = num(o.start, 0); o.dur = num(o.dur, 5); return o;
    });
    return p;
  }
  var vt = 0;
  var _video = A.video;
  A.video = Object.assign({}, _video, {
    files: function () { return [{ name: "video.json", lang: "json", text: J(clean(VE.p)) }]; },
    previewEl: function (box, files) {
      var p = JSON.parse(JSON.stringify(vparse(files)));
      p.fmt = p.fmt || VE.p.fmt; relayout(p);
      var dur = Math.max(0.1, veDur(p)); if (vt > dur) vt = 0;
      var w = box.clientWidth - 32, h = box.clientHeight - 90;
      box.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;gap:10px;width:100%">' + stageMini(p, vt, [Math.max(120, w), Math.max(120, h)])
        + '<div style="display:flex;align-items:center;gap:8px;width:calc(100% - 32px);color:var(--e-muted);font-size:11px"><input type="range" min="0" max="' + dur + '" step="0.05" value="' + vt + '" style="flex:1;accent-color:var(--e-accent)"><span style="min-width:72px;text-align:right;font-variant-numeric:tabular-nums">' + vt.toFixed(2) + " / " + dur.toFixed(2) + " s</span></div></div>";
      box.querySelector("input").oninput = function (e) { vt = +e.target.value; A.video.previewEl(box, files); };
    },
    apply: function (files) {
      var p = vparse(files), f2 = [{ name: files[0].name, lang: "json", text: JSON.stringify(p) }];
      return _video.apply(f2).then(function (m) { files[0].text = J(clean(VE.p)); return m; });
    },
  });
})();
