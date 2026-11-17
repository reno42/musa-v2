/* bridge-video.js — el editor de video de la maqueta abriendo tus proyectos reales (musa_video_*).
 * Pista de video → V1 (clips de video e imágenes), pista de texto → T (textos), audio → A.
 * Cada cambio (mover, recortar, velocidad, borrar, textos, clips nuevos) se guarda en /api/video-projects.
 */
(function () {
  var RB = window.__musaReal;
  if (!RB || typeof VE === "undefined") return;
  function bridge() { try { return window.parent.__musaBridge; } catch (e) { return null; } }
  function api(url, init) { var b = bridge(); return b ? b.api(url, init) : Promise.reject(new Error("sin puente")); }
  function json(method, body) { return { method: method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}), timeoutMs: 30000 }; }
  var US = 1e6, r3 = function (v) { return Math.round(v * 1000) / 1000; };

  /* ── proyecto real → formato del editor ── */
  function takeFor(url, name, dur, matId) {
    var i = VTAKES.findIndex(function (t) { return t.blob === url; });
    if (i < 0) { VTAKES.push({ name: name, src: "Video", dur: dur || 10, bg: "#000", blob: url, _mat: matId || null }); i = VTAKES.length - 1; }
    else if (matId && !VTAKES[i]._mat) VTAKES[i]._mat = matId;
    return i;
  }
  RB.takeFor = takeFor;
  /* cualquier fuente con nombre válido (Google Fonts): antes una que no estaba en la lista fija volvía a Inter al recargar */
  function fontOk(n) { if (FONTS[n]) return n; if (/^[A-Za-z0-9 ]{2,40}$/.test(n || "")) { FONTS[n] = "'" + n + "',sans-serif"; return n; } return "Inter"; }
  function build(tree) {
    var pj = tree.project, mats = {};
    (tree.materials || []).forEach(function (m) { mats[m.id] = m; });
    /* tamaño propio (un video hecho desde un diseño de 1080×1431): se registra como formato y no se recorta */
    if (pj.ratio && !VFMT[pj.ratio] && +pj.canvas_w > 0 && +pj.canvas_h > 0) VFMT[pj.ratio] = [+pj.canvas_w, +pj.canvas_h, "Diseño " + pj.canvas_w + "×" + pj.canvas_h];
    var fmt = VFMT[pj.ratio] ? pj.ratio : "16:9", W = VFMT[fmt][0], H = VFMT[fmt][1];
    var p = { name: pj.name || "Video", brand: RB.ws && WSS[RB.ws] ? WSS[RB.ws].own : "", fmt: fmt, fps: pj.fps || 30, pad: "#000000", v1: [], m: [], t: [], a: [] };
    Object.defineProperty(p, "_real", { value: { id: pj.id, tracks: {}, known: {}, mats: mats }, enumerable: false });
    var R = p._real, tracks = (tree.tracks || []).slice().sort(function (a, b) { return a.z_order - b.z_order; });
    /* pistas creadas por una especificación de movimiento (motion_project_create_from_spec, «código»): cada capa
       va en su pista y ninguna es V1; sus valores (px del lienzo, keyframes) se traducen a clips editables */
    var motionTr = {}, CW = +pj.canvas_w || W, CH = +pj.canvas_h || H;
    /* material «canvas» (MCP video_material_add kind=canvas): fondo y duración del proyecto */
    Object.keys(mats).forEach(function (k) { var cm = mats[k]; if (cm && cm.kind === "canvas" && cm.payload) { var cpl = cm.payload; if (cpl.backgroundColor || cpl.bg) p.pad = String(cpl.backgroundColor || cpl.bg); if (+cpl.durationMs > 0) p.total = Math.round(cpl.durationMs / 10) / 100; } });
    tracks.forEach(function (tk) { (tk.segments || []).forEach(function (sg) { var mm = mats[sg.material_id]; if (mm && mm.payload && mm.payload.nodeKind) motionTr[tk.id] = 1; }); });
    tracks.forEach(function (tk) {
      /* QA Instinct B10: un proyecto sin V1 propia tomaba su pista de superposición (video, z 50) como V1 al abrirse,
         y todos los clips de Media se volvían escenas de V1 a pantalla completa. Además cada sesión creaba otra
         pista de superposición. Ahora z ≥ 50 = superposición (Media) y se reutiliza la primera. */
      var isOv = tk.type === "video" && +tk.z_order >= 50;
      if (isOv) { if (!R.overlay) R.overlay = tk.id; }
      else if (!R.tracks[tk.type] && !motionTr[tk.id]) R.tracks[tk.type] = tk.id;
      (tk.segments || []).slice().sort(function (a, b) { return a.target_start_us - b.target_start_us; }).forEach(function (sg) {
        var m = mats[sg.material_id] || {}, pl = m.payload || {}, start = sg.target_start_us / US, dur = sg.target_dur_us / US;
        var c = null;
        /* una forma (imagen sin archivo) nunca es una toma de V1: va a la pista M aunque esté en la pista base */
        var shapeOnly = m.kind === "image" && !pl.url;
        if (tk.type === "video" && R.tracks.video === tk.id && !shapeOnly) {
          if (m.kind === "video") c = take(takeFor(pl.url, pl.name || "Clip de video", (pl.durationUs || sg.source_dur_us) / US, m.id), dur, { in: sg.source_start_us / US, speed: +sg.speed || 1 });
          else if (m.kind === "image") c = scene(SC(pl.name || "Imagen", W, H, "transparent", [IM("Imagen", 0, 0, W, H, "url('" + pl.url + "') center/cover no-repeat")]), dur, { speed: +sg.speed || 1 });
          if (c) p.v1.push(c);
        } else if (tk.type === "video" || tk.type === "sticker") {
          if (m.kind === "image" || m.kind === "video" || m.kind === "sticker") { c = { id: nid(), name: pl.name || (pl.nodeId ? String(pl.nodeId).replace(/[_-]+/g, " ") : "Media"), start: start, dur: dur, x: pl.x != null ? pl.x : 50, y: pl.y != null ? pl.y : 50, w: pl.w || 40, ar: pl.ar || 1, radius: pl.radius || 0, bg: pl.url ? "url('" + pl.url + "') center/" + (pl.fit || "cover") + " no-repeat" : (pl.bg || "#ffffff"), anim: pl.anim || "fade" }; if (pl.shape) c.shape = pl.shape; if (pl.opacity != null) c.opacity = pl.opacity; motionApply(c, pl, "m", W, H, CW, CH); p.m.push(c); }
        } else if (tk.type === "text" && m.kind === "text") {
          c = cap(typeof pl.text === "string" ? pl.text.replace(/\s+$/, "") : "", start, dur, { x: pl.x != null ? pl.x : 50, y: pl.y != null ? pl.y : 82, size: pl.size || pl.fontSize || 64, font: fontOk(pl.font), weight: pl.weight || 800, color: pl.color || "#ffffff", bg: pl.bg || "", anim: pl.anim || "pop" });
          motionApply(c, pl, "t", W, H, CW, CH);
          p.t.push(c);
        } else if (tk.type === "audio" && m.kind === "audio") {
          c = { id: nid(), name: pl.name || "Audio", start: start, dur: dur, vol: pl.volume != null ? pl.volume : 1, fin: 0, fout: 0, url: pl.url };
          p.a.push(c);
        }
        /* transform del clip escrito por MCP (video_segment_transform: x,y -1..1, scale, rotation, alpha):
           antes el editor lo ignoraba y el clip quedaba en su lugar por defecto */
        var cl = sg.clip;
        if (c && cl && typeof cl === "object" && (tk.type === "text" || p.m.indexOf(c) >= 0)) {
          /* el editor se queda con este transform: al guardar ese clip lo escribe en el material y limpia el del segmento
             (antes, mover después ese clip en el editor se perdía al recargar: el transform del MCP volvía a mandar) */
          (R.clipT = R.clipT || {})[sg.id] = 1;
          if (typeof cl.x === "number" && cl.x !== 0) c.x = Math.round((50 + cl.x * 50) * 100) / 100;
          if (typeof cl.y === "number" && cl.y !== 0) c.y = Math.round((50 + cl.y * 50) * 100) / 100;
          if (typeof cl.scale === "number" && cl.scale > 0 && cl.scale !== 1) { if (tk.type === "text") c.size = Math.round((c.size || 64) * cl.scale); else c.w = Math.round((c.w || 40) * cl.scale * 100) / 100; }
          if (typeof cl.alpha === "number" && cl.alpha < 1) { if (tk.type === "text") c.kf = [{ t: 0, x: 0, y: 0, s: 1, r: 0, o: cl.alpha }]; else c.opacity = cl.alpha; }
          if (typeof cl.rotation === "number" && cl.rotation) c.kf = [{ t: 0, x: 0, y: 0, s: 1, r: cl.rotation, o: (c.kf && c.kf[0] && c.kf[0].o) || 1 }];
        }
        if (c) { Object.defineProperty(c, "_seg", { value: sg.id, writable: true, enumerable: false }); Object.defineProperty(c, "_mat", { value: m.id, writable: true, enumerable: false }); R.known[sg.id] = snapOf(c); }
      });
    });
    relayout(p);
    p.v1.forEach(function (c) { if (c._seg) R.known[c._seg] = snapOf(c); });
    return p;
  }
  /* material de una especificación de movimiento → valores del editor: x/y = centro en px del lienzo de la spec,
     fontSize/width/height en px, colores, radio, opacidad y keyframes (x/y absolutos → desplazamientos en px) */
  function mnum(v, ref) { if (typeof v === "number" && isFinite(v)) return v; var t = String(v == null ? "" : v).trim(); if (!t) return null; if (/%$/.test(t)) return parseFloat(t) / 100 * ref; var n = parseFloat(t); return isFinite(n) ? n : null; }
  function r2m(v) { return Math.round(v * 100) / 100; }
  function motionApply(c, pl, tr, W, H, CW, CH) {
    if (!pl || !(pl.nodeKind || pl.props || (pl.keyframes && pl.keyframes.length))) return;
    var pr = pl.props || {}, kfs = (pl.keyframes || []).filter(function (k) { return k && typeof k.value === "number"; }).slice().sort(function (a, b) { return a.timeMs - b.timeMs; });
    var kx = W / CW, first = function (prop) { var f = kfs.find(function (k) { return k.property === prop; }); return f ? f.value : null; };
    var bx = mnum(pr.x, CW), by = mnum(pr.y, CH);
    if (bx == null) bx = first("x"); if (by == null) by = first("y");
    if (bx != null) c.x = r2m(bx / CW * 100); if (by != null) c.y = r2m(by / CH * 100);
    if (tr === "t") {
      var fs = mnum(pr.fontSize, CH); if (fs) c.size = Math.round(fs * kx);
      if (pr.fontFamily) c.font = fontOk(String(pr.fontFamily).split(",")[0].replace(/["']/g, "").trim());
      if (pr.fontWeight != null && +pr.fontWeight) c.weight = +pr.fontWeight;
      if (pr.color) c.color = String(pr.color);
      var tb = pr.backgroundColor || pr.background; if (tb) c.bg = String(tb);
      c.exact = true;
      var lsp = mnum(pr.letterSpacing, CW); if (lsp) c.ls = Math.round(lsp * kx * 10) / 10;
      if (/italic|oblique/.test(String(pr.fontStyle || ""))) c.italic = true;
    } else {
      var w = mnum(pr.width, CW), h = mnum(pr.height, CH);
      if (w) c.w = r2m(w / CW * 100);
      if (w && h) c.ar = Math.round(w / h * 1000) / 1000;
      if (!pl.url) { var col = pr.backgroundColor || pr.background || pr.color; if (col) c.bg = String(col); }
      var br = mnum(pr.borderRadius, Math.min(w || 0, h || 0));
      /* círculo solo si es cuadrado; una píldora (radio = medio alto) conserva su forma, no se vuelve óvalo */
      if (br) { if (w && h && Math.abs(w - h) < 2 && br >= Math.min(w, h) / 2 - 0.5) c.shape = "circle"; else c.radius = Math.round(Math.min(br, Math.min(w || br, h || br) / 2) * kx); }
      if (typeof pr.opacity === "number") c.opacity = pr.opacity;
    }
    var s0 = typeof pr.scale === "number" ? pr.scale : 1, rot0 = typeof pr.rotation === "number" ? pr.rotation : 0, o0 = tr === "t" && typeof pr.opacity === "number" ? pr.opacity : 1;
    if (!kfs.length && s0 === 1 && rot0 === 0 && o0 === 1) return applyAnimProps(c, pr);
    var at = function (prop, tms, def) {
      var L = kfs.filter(function (k) { return k.property === prop; }); if (!L.length) return def;
      if (tms <= L[0].timeMs) return L[0].value; if (tms >= L[L.length - 1].timeMs) return L[L.length - 1].value;
      for (var i = 1; i < L.length; i++) if (tms <= L[i].timeMs) { var a = L[i - 1], b = L[i], u = (tms - a.timeMs) / Math.max(1, b.timeMs - a.timeMs); return a.value + (b.value - a.value) * u; }
      return def;
    };
    var st = c.start * 1000, times = kfs.map(function (k) { return k.timeMs; }).filter(function (t, i, A) { return A.indexOf(t) === i; });
    if (!times.length) times = [st];
    if (tr === "m" && kfs.some(function (k) { return k.property === "opacity"; })) c.opacity = 1;
    c.kf = times.map(function (tms) {
      return { t: r2m(Math.max(0, (tms - st) / 1000)), x: r2m((at("x", tms, bx || 0) - (bx || 0)) * kx), y: r2m((at("y", tms, by || 0) - (by || 0)) * kx), s: r2m(at("scale", tms, s0)), r: r2m(at("rotation", tms, rot0)), o: r2m(at("opacity", tms, o0)) };
    });
    if (kfs.length) c.anim = "none";
    applyAnimProps(c, pr);
  }
  /* entrada pedida por la spec (props.animation: words, fly-in, pop…) y tiempos por palabra */
  RB.veMotionApply = motionApply;
  function applyAnimProps(c, pr) {
    var an = String(pr.animation || ""); if (!an) return;
    var ok = typeof CAPANIM !== "undefined" && CAPANIM.some(function (x) { return x[0] === an; }); if (!ok) return;
    c.anim = an;
    if (pr.wordTimes != null && pr.wordTimes !== "") c.wordTimes = String(pr.wordTimes);
    if (+pr.wordGap > 0) c.wordGap = +pr.wordGap;
  }
  /* QA Instinct B23/B15: el ancho, la proporción, el radio, la opacidad, la forma y la entrada no estaban en la huella,
     así que cambiar solo el Ancho (o la Entrada de un texto) nunca llegaba a la base y al recargar volvía a 40 / Pop */
  function snapOf(c) { return JSON.stringify({ s: r3(c.start), d: r3(c.dur), i: r3(c.in || 0), v: c.speed || 1, t: c.text, x: c.x, y: c.y, z: c.size, f: c.font, w: c.weight, col: c.color, bg: c.bg, n: c.name, wd: c.w, ar: c.ar, rd: c.radius, op: c.opacity, sh: c.shape, an: c.anim }); }

  /* ── guardar: compara el timeline con lo último guardado y manda solo los cambios ── */
  var timer = null, busy = false, again = false;
  function schedule() { clearTimeout(timer); VE._pend = true; timer = setTimeout(function () { VE._pend = false; sync(); }, 900); }
  function ensureTrack(p, type) {
    var R = p._real;
    if (R.tracks[type]) return Promise.resolve(R.tracks[type]);
    /* una sola creación por pista aunque se guarden varios clips nuevos en paralelo */
    R.mk = R.mk || {}; if (R.mk[type]) return R.mk[type];
    return (R.mk[type] = api("/api/video-projects/" + R.id + "/tracks?workspaceId=" + RB.ws, json("POST", { type: type })).then(function (x) { R.tracks[type] = x.data.track.id; return R.tracks[type]; }, function (e) { delete R.mk[type]; throw e; }));
  }
  function ensureOverlayTrack(p) {
    var R = p._real;
    if (R.overlay) return Promise.resolve(R.overlay);
    R.mk = R.mk || {}; if (R.mk.ov) return R.mk.ov;
    return (R.mk.ov = api("/api/video-projects/" + R.id + "/tracks?workspaceId=" + RB.ws, json("POST", { type: "video", zOrder: 50 })).then(function (x) { R.overlay = x.data.track.id; return R.overlay; }, function (e) { delete R.mk.ov; throw e; }));
  }
  function matPayload(c, kind) {
    if (kind === "text") return { text: c.text || " ", x: c.x, y: c.y, size: c.size, font: c.font, weight: c.weight, color: c.color, bg: c.bg, anim: c.anim };
    var url = (String(c.bg || "").match(/url\(["']?([^"')]+)["']?\)/) || [])[1], big = false;
    /* un vector en línea de más de 40.000 caracteres (un logo vectorizado grande) no entra en la base: vive en el estado
       del editor (c.svg) y el material queda como forma transparente; antes ese clip no se guardaba */
    if (url && /^data:image\/svg/.test(url) && url.length > 40000) { url = undefined; big = true; }
    var o = { url: url, name: c.name, x: c.x, y: c.y, w: c.w, ar: c.ar, radius: c.radius };
    if (!url) { o.bg = big ? "transparent" : c.bg; if (c.shape) o.shape = c.shape; }
    if (c.opacity != null) o.opacity = c.opacity;
    return o;
  }
  function sync() {
    var p = VE.open && VE.p && VE.p._real ? VE.p : null;
    if (!p || p._real.retired) return;
    if (busy) { again = true; return; }
    busy = true;
    var R = p._real, base = "/api/video-projects/" + R.id, q = "?workspaceId=" + encodeURIComponent(RB.ws), ops = [], alive = {};
    relayout(p);
    /* la foto que se guarda es la de ESTE momento (la misma con la que se arman las filas). Lo que cambies mientras se
       guarda va en el próximo guardado. Antes la foto final se tomaba al terminar: el estado decía «texto nuevo» y la
       fila todavía el viejo, y si tu IA leía justo en ese momento escribía el viejo y al juntar se perdía tu último cambio */
    var snap = editorState(p);
    var seg = function (c, trackType, kind, payloadFn, mkMaterial) {
      if (c._seg) {
        alive[c._seg] = 1;
        var now = snapOf(c);
        if (now === R.known[c._seg]) return;
        var old = JSON.parse(R.known[c._seg] || "{}");
        ops.push(function () {
          var body = { targetStartUs: Math.round(c.start * US), sourceStartUs: Math.round((c.in || 0) * US), sourceDurUs: Math.round(c.dur * (c.speed || 1) * US) };
          if ((c.speed || 1) !== old.v) body.speed = c.speed || 1;
          var clipT = !!(payloadFn && R.clipT && R.clipT[c._seg]);
          if (clipT) body.clip = null;
          /* El undo puede revivir un clip con el _seg de una fila ya borrada en la BD:
             el PATCH daría 404 y cortaría TODA la cadena de guardado. Si el segmento
             no existe, se re-crea con POST (id nuevo) y el clip adopta ese id. */
          var patchSeg = function () {
            return api(base + "/segments/" + c._seg + q, json("PATCH", body)).catch(function (e) {
              if (!/404|not found/i.test(e && e.message || "")) throw e;
              var trackP = trackType === "overlay" ? ensureOverlayTrack(p) : ensureTrack(p, trackType);
              return Promise.all([trackP, mkMaterial ? mkMaterial() : Promise.resolve(c._mat)]).then(function (r) {
                var matId = r[1] || c._mat;
                if (!matId) throw e;
                return api(base + "/segments" + q, json("POST", { trackId: r[0], materialId: matId, targetStartUs: Math.round(c.start * US), targetDurUs: Math.round(c.dur * US), sourceStartUs: Math.round((c.in || 0) * US), sourceDurUs: Math.round(c.dur * (c.speed || 1) * US), speed: c.speed || 1 }))
                  .then(function (x) {
                    Object.defineProperty(c, "_seg", { value: x.data.segment.id, writable: true, enumerable: false });
                    alive[c._seg] = 1; (R.own = R.own || {})[c._seg] = 1;
                  });
              });
            });
          };
          var jobs = [patchSeg()];
          if (payloadFn && (clipT || old.t !== c.text || old.x !== c.x || old.y !== c.y || old.z !== c.size || old.col !== c.color || old.bg !== c.bg || old.f !== c.font || old.w !== c.weight
            || old.n !== c.name || old.wd !== c.w || old.ar !== c.ar || old.rd !== c.radius || old.op !== c.opacity || old.sh !== c.shape || old.an !== c.anim))
            jobs.push(api(base + "/materials/" + c._mat + q, json("PATCH", { payload: payloadFn(c) })).catch(function (e) {
              if (!/404|not found/i.test(e && e.message || "")) throw e;
              return mkMaterial ? mkMaterial().then(function (id) { c._mat = id || c._mat; return id; }) : null;
            }));
          return Promise.all(jobs).then(function () { R.known[c._seg] = now; if (clipT) delete R.clipT[c._seg]; });
        });
      } else {
        ops.push(function () {
          /* la huella se toma cuando se arma el material: si el clip cambia mientras se crea (por ejemplo el ancho de
             14 imágenes recién agregadas), el próximo guardado ve la diferencia y la manda. Antes se tomaba al final y
             el cambio quedaba marcado como guardado sin estarlo (QA Instinct B23, lo encontró «Guardar y comprobar») */
          var snap0 = snapOf(c);
          /* ids propios, fijos para este clip: si un pedido se corta y se reintenta, el servidor reconoce el id y no
             crea otro clip igual (antes un reintento duplicaba el clip) */
          if (!c._pm) Object.defineProperty(c, "_pm", { value: newId("vidmat_"), writable: true, enumerable: false });
          if (!c._ps) Object.defineProperty(c, "_ps", { value: newId("vidseg_"), writable: true, enumerable: false });
          var trackP = trackType === "overlay" ? ensureOverlayTrack(p) : ensureTrack(p, trackType);
          return Promise.all([trackP, mkMaterial(c._pm)]).then(function (r) {
            if (!r[1]) return;
            return api(base + "/segments" + q, json("POST", { id: c._ps, trackId: r[0], materialId: r[1], targetStartUs: Math.round(c.start * US), targetDurUs: Math.round(c.dur * US), sourceStartUs: Math.round((c.in || 0) * US), sourceDurUs: Math.round(c.dur * (c.speed || 1) * US), speed: c.speed || 1 }))
              .catch(function (e) { if (dupErr(e)) return { data: { segment: { id: c._ps } } }; throw e; })
              .then(function (x) {
                Object.defineProperty(c, "_seg", { value: x.data.segment.id, writable: true, enumerable: false });
                Object.defineProperty(c, "_mat", { value: r[1], writable: true, enumerable: false });
                R.known[c._seg] = snap0; (R.own = R.own || {})[c._seg] = 1;
              });
          });
        });
      }
    };
    var postMat = function (kind, payload, id) {
      return api(base + "/materials" + q, json("POST", id ? { id: id, kind: kind, payload: payload } : { kind: kind, payload: payload }))
        .then(function (x) { return x.data.material.id; }, function (e) { if (id && dupErr(e)) return id; throw e; });
    };
    p.v1.forEach(function (c) {
      seg(c, "video", null, null, function () {
        if (c.kind === "take") {
          var tk = VTAKES[c.take];
          if (!tk || !tk.blob || /^blob:/.test(tk.blob)) { vtoast("Este clip todavía no se puede guardar: súbelo primero a tus archivos"); return Promise.resolve(null); }
          /* el material de la toma tiene que ser de ESTE proyecto: la lista de tomas es de la sesión y antes reusaba el de
             otro video (la base respondía REF_FOREIGN_PROJECT y el proyecto quedaba «Sin guardar · reintentando») */
          var own = tk._mat && R.mats && R.mats[tk._mat];
          return own ? Promise.resolve(tk._mat) : postMat("video", { url: tk.blob, name: tk.name, durationUs: Math.round((tk.dur || c.dur) * US) }).then(function (id) { tk._mat = id; if (R.mats) R.mats[id] = { id: id, kind: "video" }; return id; });
        }
        var img = c.scene && c.scene.els && c.scene.els[0] && String(c.scene.els[0].fill || "").match(/url\(["']?([^"')]+)["']?\)/);
        if (img && /^https?:/.test(img[1])) return postMat("image", { url: img[1], name: c.name });
        if (img && /^data:image/.test(img[1])) return upload(img[1], c.name).then(function (u) { c.scene.els[0].fill = "url('" + u + "') center/cover no-repeat"; return postMat("image", { url: u, name: c.name }); });
        return Promise.resolve(null); /* escena armada a mano: vive en video_editor_state */
      });
    });
    p.m.forEach(function (c) { seg(c, "overlay", "image", function (x) { return matPayload(x, "image"); }, function (mid) {
      var u = matPayload(c, "image").url;
      if (!u) return Promise.resolve(null);
      /* un vector o ícono en línea (data:image/svg) NO se sube a «Tus imágenes»: la base lo acepta tal cual (antes cada
         ícono o vector que se guardaba creaba una copia nueva en la biblioteca, con el nombre creciendo «.png.png…») */
      return (/^data:/.test(u) && !/^data:image\/svg/.test(u) ? upload(u, c.name) : Promise.resolve(u)).then(function (url) { if (url !== u) c.bg = "url('" + url + "') center/cover no-repeat"; var pl = matPayload(c, "image"); pl.url = url; return postMat("image", pl, mid); });
    }); });
    p.t.forEach(function (c) { seg(c, "text", "text", function (x) { return matPayload(x, "text"); }, function (mid) { return postMat("text", matPayload(c, "text"), mid); }); });
    p.a.forEach(function (c) { seg(c, "audio", "audio", null, function (mid) { return c.url ? postMat("audio", { url: c.url, name: c.name }, mid) : Promise.resolve(null); }); });
    Object.keys(R.known).forEach(function (id) {
      /* 404 al borrar = la fila ya no existe (cadena anterior la borró): igual de logrado */
      if (!alive[id]) ops.push(function () { return api(base + "/segments/" + id + q, { method: "DELETE" }).catch(function (e) { if (!/404|not found/i.test(e && e.message || "")) throw e; }).then(function () { delete R.known[id]; }); });
    });
    saveUi("saving");
    /* QA Instinct B28: antes iba un pedido tras otro (40 cambios ≈ 20 s) y recargar a mitad dejaba el proyecto mezclado.
       Ahora van de a 6 en paralelo y el estado visual se guarda al final.
       QA Instinct T20 (todo o nada): ANTES de tocar la base se guarda la foto completa marcada «pendiente». Si el guardado
       se corta a la mitad, al abrir manda esa foto entera (no una mezcla) y la base se pone al día sola. */
    (ops.length ? saveState(p, true, snap) : Promise.resolve())
      .then(function () { return pool(ops, 10); })
      .then(function () { return saveState(p, false, linkSegs(p, snap)); })
      .then(function () { R.savedAt = Date.now(); return api("/rest/v1/musa_video_projects?id=eq." + encodeURIComponent(R.id) + "&select=updated_at").then(function (r) { if (r && r[0]) { R.remoteAt = r[0].updated_at; R.remoteSync = Date.now(); } }, function () {}); })
      .then(function () { if (R.failN) vtoast("Cambios guardados"); R.failN = 0; window.__veUnsaved = false; saveUi(again || VE._pend ? "saving" : "ok"); if (RB.veAfterSave) try { RB.veAfterSave(p); } catch (e) {} if (RB.veAfterSaveCode) try { RB.veAfterSaveCode(p); } catch (e) {} },
        function (e) {
          /* alguien escribió el video mientras guardábamos (tu IA por MCP, otra pestaña): se juntan los cambios y se
             vuelve a guardar. Nada se pisa (antes el guardado borraba lo que había hecho la IA). */
          if (e && e.conflict && (R.cfN || 0) < 6) return mergeRemote(p, "save").catch(failed);
          return failed(e);
        })
      .then(function () { busy = false; if (again) { again = false; schedule(); } });
    /* falla (red lenta, «API request timed out»): se avisa una vez y se reintenta solo, sin perder lo hecho
       (QA Instinct bug 6: antes no había reintento ni aviso de qué quedaba sin guardar) */
    function failed(e) {
          if (e && e.conflict) R.cfN = 0;
          R.failN = (R.failN || 0) + 1; window.__veUnsaved = true;
          saveUi("err");
          if (R.failN === 1 || R.failN % 5 === 0) vtoast("Sin guardar todavía (" + String(e && e.message || "error").replace(/^API error:\s*/, "") + "): reintento solo en unos segundos");
          setTimeout(function () { if (VE.p === p) schedule(); }, Math.min(30000, 3000 * R.failN));
    }
  }
  function newId(pre) { var a = "abcdefghijklmnopqrstuvwxyz0123456789", s = ""; for (var i = 0; i < 16; i++) s += a[Math.floor(Math.random() * 36)]; return pre + s; }
  /* el servidor ya tiene ese id (un pedido anterior sí llegó aunque la respuesta se perdió) */
  function dupErr(e) { return /duplicate|already exists|23505|unique/i.test(String(e && e.message || "")); }
  /* corre las tareas de a «n» en paralelo; si una falla, espera a las demás y falla (se reintenta todo lo que quede) */
  function pool(tasks, n) {
    return new Promise(function (res, rej) {
      var i = 0, live = 0, err = null;
      function next() {
        if (i >= tasks.length && !live) return err ? rej(err) : res();
        while (live < n && i < tasks.length) {
          var t = tasks[i++]; live++;
          Promise.resolve().then(t).catch(function (e) { err = err || e; }).then(function () { live--; next(); });
        }
      }
      next();
    });
  }
  /* indicador de guardado en la barra del editor (QA Instinct T20: no había forma de saber si ya se guardó) */
  var saveSt = "ok";
  function saveUi(st) {
    saveSt = st;
    var top = document.querySelector("#ve .ed-tr"); if (!top) return;
    var el = top.querySelector(".ve-saved");
    if (!el) { el = document.createElement("span"); el.className = "ve-saved"; el.setAttribute("role", "status"); el.style.cssText = "font:600 11px Inter,sans-serif;color:#9a978c;margin:0 8px;white-space:nowrap"; top.insertBefore(el, top.firstChild); }
    if (!top.querySelector("[data-vesave]") && VE.p && VE.p._real) { var sb = document.createElement("button"); sb.className = "ed-btn"; sb.dataset.vesave = "1"; sb.textContent = "Guardar"; sb.title = "Guarda ahora y comprueba, leyendo el proyecto del servidor, que al recargar quede igual"; sb.style.cssText = "height:28px;padding:0 10px;margin-right:6px"; el.after(sb); }
    el.textContent = st === "saving" ? "Guardando…" : st === "err" ? "Sin guardar · reintentando" : "Guardado";
    el.style.color = st === "err" ? "#ff8a5c" : "#9a978c";
  }
  RB.veSaveState = function () { return { st: saveSt, pend: !!VE._pend, busy: busy }; };
  /* QA Instinct T20: «Guardar» guarda ya, vuelve a leer el proyecto desde el servidor (como una recarga) y compara
     clip por clip. Dice si quedó igual o qué no coincide (y lo vuelve a guardar). */
  function flush() {
    return new Promise(function (res) {
      clearTimeout(timer); VE._pend = false; if (!busy) sync();
      var t0 = Date.now();
      (function w() { if (!busy && !VE._pend) return res(saveSt); if (Date.now() - t0 > 90000) return res("timeout"); setTimeout(w, 300); })();
    });
  }
  var VKEYS = { m: ["start", "dur", "x", "y", "w", "anim", "opacity"], t: ["start", "dur", "text", "x", "y", "size", "weight", "anim", "color"], a: ["start", "dur"], v1: ["dur"] };
  RB.veVerify = function () {
    var p = VE.open && VE.p && VE.p._real ? VE.p : null; if (!p) return Promise.resolve({ ok: false, n: 0, diff: ["Abre un video tuyo"] });
    var R = p._real; saveUi("saving");
    return flush().then(function (st) {
      if (st !== "ok") throw new Error("el guardado no terminó (" + st + ")");
      return Promise.all([
        api("/api/video-projects/" + encodeURIComponent(R.id) + "?workspaceId=" + encodeURIComponent(RB.ws)),
        api("/rest/v1/video_editor_state?project_id=eq." + encodeURIComponent(R.id) + "&select=state")
      ]);
    }).then(function (res) {
      var q = mergeState(build(res[0].data), res[1] && res[1][0] && res[1][0].state), diff = [], n = 0;
      var r3v = function (v) { return typeof v === "number" ? Math.round(v * 100) / 100 : v == null ? "" : v; };
      ["v1", "m", "t", "a"].forEach(function (k) {
        if (q[k].length !== p[k].length) diff.push(k + ": " + p[k].length + " en el editor, " + q[k].length + " guardados");
        q[k].forEach(function (d) { if (!p[k].some(function (c) { return c.id === d.id; })) diff.push("sobra «" + String(d.name || d.text || "clip").slice(0, 24) + "» (" + (d._seg ? "en la base" : "en el estado") + ")"); });
        p[k].forEach(function (c) {
          n++; var d = q[k].find(function (x) { return x.id === c.id; });
          if (!d) return diff.push("falta «" + (c.name || c.text || "clip") + "»");
          VKEYS[k].forEach(function (f) { if (String(r3v(c[f])) !== String(r3v(d[f]))) diff.push("«" + String(c.name || c.text || "clip").slice(0, 20) + "» " + f + ": " + r3v(c[f]) + " ≠ " + r3v(d[f])); });
        });
      });
      saveUi(diff.length ? "err" : "ok");
      if (diff.length) schedule();
      else if (RB.veAfterSave) try { RB.veAfterSave(p, "Guardado con «Guardar»", true); } catch (e) {}
      return { ok: !diff.length, n: n, diff: diff };
    }).catch(function (e) { saveUi("err"); return { ok: false, n: 0, diff: [String(e && e.message || e)] }; });
  };
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-vesave]"); if (!b) return;
    e.preventDefault(); b.disabled = true; b.textContent = "Comprobando…";
    RB.veVerify().then(function (r) {
      b.disabled = false; b.textContent = "Guardar";
      vtoast(r.ok ? "Guardado y comprobado: al recargar, los " + r.n + " clips quedan iguales" : "No coincidía todo (" + r.diff.slice(0, 3).join(" · ") + "): lo guardo de nuevo");
    });
  });
  /* salir con cambios sin guardar: guarda ya y avisa */
  addEventListener("beforeunload", function (e) {
    if (!(VE.open && VE.p && VE.p._real)) return;
    if (VE._pend || busy || window.__veUnsaved) { if (VE._pend) { clearTimeout(timer); VE._pend = false; sync(); } e.preventDefault(); e.returnValue = ""; return ""; }
  });
  document.addEventListener("visibilitychange", function () { if (document.hidden && VE._pend && VE.p && VE.p._real) { clearTimeout(timer); VE._pend = false; sync(); } });
  function upload(dataUrl, name) {
    return api("/api/assets/upload", json("POST", { name: String(name || "escena").replace(/(\.(png|jpe?g|webp|gif|svg))+$/i, "") + ".png", data: dataUrl, workspaceId: RB.ws })).then(function (x) { var a = x.data || x.asset || x; return a.url || (a.asset && a.asset.url); });
  }

  /* ── estado visual del editor (transiciones, looks, efectos, animaciones, escenas a mano, música, fondo) ── */
  var UI_KEYS = ["look", "lookK", "fx", "ovl", "trans", "fit", "mo", "kf", "vol", "fin", "fout", "anim", "x", "y", "w", "ar", "radius", "size", "font", "weight", "color", "bg", "name", "in", "speed",
    /* editor pro (bridge-video-pro.js): brillo, ajuste al ancho, relleno degradado, forma, opacidad */
    "glow", "glowR", "autofit", "grad", "shape", "opacity",
    /* morph de texto, trayectorias con curva e íconos */
    "enD", "morphTo", "morphAt", "morphD", "curve", "icon", "iconColor", "wordTimes", "wordGap", "exact", "ls", "italic",
    /* motion (QA Instinct reel Comfy v3): órbita, grupo, pila, vector SVG, forma vectorial, recorrido dibujado, morph entre clips */
    "orb", "grp", "stD", "stDir", "stB", "stR", "stDist", "svg", "svgMap", "vshape", "path", "morphClip",
    /* QA Instinct T12/T5: pila con física (sus keyframes son de la simulación) e imagen original de un clip vectorizado */
    "_pk", "_raster",
    /* QA Instinct T7: capa de pintado (delante / detrás) entre pistas */
    "zi",
    /* QA Instinct v16 (wishlist): desenfoque de movimiento automático, máscara, expresiones, capa de ajuste, audio */
    "mbA", "mask", "expr", "adj", "duck", "volk",
    /* código vivo (Three.js, p5, WebGL, canvas, Remotion 3D): bridge-video-live.js */
    "live"];
  function serialClip(c) { var o = JSON.parse(JSON.stringify(c)); o._s = c._seg || null; if (c.kind === "take" && VTAKES[c.take]) o.takeUrl = VTAKES[c.take].blob; return o; }
  /* la foto completa del editor (también la usan el historial de versiones y «Restaurar») */
  function editorState(p, lite) {
    /* el código de cada clip (video como código) va aparte, en video_code_blocks: aquí no pesa en cada guardado */
    void lite;
    return { fmt: p.fmt, pad: p.pad, grad: p.grad || null, total: p.total || null, totalUser: p.totalUser ? 1 : null, persp: p.persp || null, fps: p.fps, gtr: p.gtr || null, markers: p.markers || null, lanes: p.lanes || null, v1: p.v1.map(serialClip), m: p.m.map(serialClip), t: p.t.map(serialClip), a: p.a.map(serialClip) };
  }
  RB.veStateOf = editorState;
  /* restaurar una foto: se guarda como «pendiente» (manda entera) y se reabre; la base se pone al día sola */
  RB.veRestoreState = function (st) {
    var p = VE.open && VE.p && VE.p._real ? VE.p : null; if (!p || !st) return Promise.reject(new Error("abre el video"));
    var R = p._real, idx = R.idx, body = Object.assign({}, st, { pending: Date.now(), rev: newRev() });
    clearTimeout(timer); VE._pend = false;
    return api("/rest/v1/video_editor_state", { method: "POST", headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ project_id: R.id, workspace_id: RB.ws, state: body }) })
      .then(function () { delete VE_DOCS["videos/" + idx]; return RB.openVideo(R.id, idx); });
  };
  /* ── edición a la vez (tu IA por MCP, otra pestaña): el estado lleva una revisión (state.rev) y este editor solo lo
     escribe si sigue en la revisión que leyó o escribió (un solo UPDATE con la condición). Si no coincide, alguien
     cambió el video: se juntan los cambios (mergeRemote) y se guarda lo juntado. ── */
  function newRev() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function sigOf(st) { var ML = window.MusaVideoLive; return ML && ML.stable ? ML.stable(st) : JSON.stringify(st); }
  function conflictErr() { var e = new Error("el video cambió en el servidor"); e.conflict = true; return e; }
  /* la foto del inicio del guardado con los ids de fila que se crearon en el medio (clips nuevos, filas recreadas) */
  function linkSegs(p, snap) {
    var o = JSON.parse(JSON.stringify(snap)), by = {};
    ["v1", "m", "t", "a"].forEach(function (k) { p[k].forEach(function (c) { by[c.id] = c._seg || null; }); });
    ["v1", "m", "t", "a"].forEach(function (k) { (o[k] || []).forEach(function (c) { if (by[c.id] !== undefined) c._s = by[c.id]; }); });
    return o;
  }
  function saveState(p, pending, given) {
    var R = p._real, st = given ? JSON.parse(JSON.stringify(given)) : editorState(p);
    var sig = sigOf(st); if (!pending && sig === R.stateSig) return Promise.resolve();
    var base = JSON.parse(JSON.stringify(st)), rev = newRev();
    st.rev = rev; if (pending) { st.pending = Date.now(); R.myPend = st.pending; }
    var req = R.hasRow === false
      ? api("/rest/v1/video_editor_state?on_conflict=project_id", { method: "POST", headers: { "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify({ project_id: R.id, workspace_id: RB.ws, state: st }), timeoutMs: 30000 })
      : api("/rest/v1/video_editor_state?project_id=eq." + encodeURIComponent(R.id) + (R.rev ? "&state->>rev=eq." + encodeURIComponent(R.rev) : "&state->>rev=is.null"), { method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ state: st }), timeoutMs: 30000 });
    return req.then(function (rows) {
      if (!Array.isArray(rows) || !rows.length) throw conflictErr();
      R.rev = rev; R.hasRow = true; R.base = base; R.stateSig = pending ? null : sig; R.cfN = 0;
    });
  }
  RB.veNewRev = newRev;
  /* otro módulo escribió el estado de este proyecto (código convertido): queda como la revisión conocida */
  RB.veSetRev = function (p, rev, st) {
    if (!p || !p._real) return; var R = p._real; R.rev = rev; R.hasRow = true;
    if (st) { var b = JSON.parse(JSON.stringify(st)); delete b.rev; delete b.pending; R.base = b; R.stateSig = null; }
  };

  /* lee el proyecto del servidor como lo arma el editor (filas + estado), con su revisión y la base para juntar */
  function fetchProject(id, strict, ownPend) {
    return Promise.all([
      api("/api/video-projects/" + encodeURIComponent(id) + "?workspaceId=" + encodeURIComponent(RB.ws)),
      api("/rest/v1/video_editor_state?project_id=eq." + encodeURIComponent(id) + "&select=state").catch(function (e) { if (strict) throw e; return null; }),
      api("/rest/v1/musa_motion_specs?project_id=eq." + encodeURIComponent(id) + "&select=canvas:normalized_spec->canvas&order=revision.desc&limit=1").catch(function () { return []; })
    ]).then(function (res) {
      var remote = res[0] && res[0].data && res[0].data.project && res[0].data.project.updated_at;
      var x = res[0], row = res[1] && res[1][0], st = row && row.state;
      /* la marca «pendiente» la puso este mismo editor (su guardado ya escribió las filas; alguien subió la revisión en
         el medio): las filas están completas, así que se leen como siempre (no manda la foto entera) */
      var own = !!(st && st.pending && ownPend && +st.pending === +ownPend), stB = own ? Object.assign({}, st, { pending: 0 }) : st;
      var p = fixIds(mergeState(build(x.data), stB)), R = p._real;
      /* lo que la base guarda de cada clip ya está al día: el primer guardado no reenvía lo que solo vive en el estado
         (antes, cada vez que se abría un video se volvían a escribir las filas de sus textos). Con una foto «pendiente»
         no: ahí la base se pone al día a propósito. */
      if (stB && !stB.pending) ["v1", "m", "t", "a"].forEach(function (k) { p[k].forEach(function (c) { if (c._seg && R.known[c._seg]) R.known[c._seg] = snapOf(c); }); });
      /* proyecto hecho con una especificación de movimiento: su fondo y su duración (antes negro y mínimo 5 s) */
      var cvs = res[2] && res[2][0] && res[2][0].canvas;
      if (cvs) { if (!(st && st.pad) && cvs.backgroundColor) p.pad = String(cvs.backgroundColor); if (!p.total && +cvs.durationMs > 0) p.total = Math.round(cvs.durationMs / 10) / 100; }
      R.remoteAt = remote;
      /* sin poder leer el estado: revisión desconocida (el primer guardado junta con lo que haya en vez de pisarlo) */
      if (res[1] === null) { R.hasRow = true; R.rev = "?"; } else { R.hasRow = !!row; R.rev = (st && st.rev) || null; }
      R.base = JSON.parse(JSON.stringify(editorState(p)));
      return { p: p, st: st, own: own };
    });
  }
  /* juntar: base (lo último que este editor guardó o leyó) + lo mío (el editor ahora) + lo del servidor */
  function mergeRemote(p, why) {
    var R = p._real, ML = window.MusaVideoLive, tries = 0;
    if (window.__veLive && window.__veLive.flushCode) try { window.__veLive.flushCode(); } catch (e) { /* sin panel */ }
    var get = function () {
      return fetchProject(R.id, true, R.myPend).then(function (f) {
        /* lo está escribiendo otro justo ahora (el MCP a mitad): se espera a que termine para juntar lo completo */
        if (f.st && f.st.pending && !f.own && Date.now() - +f.st.pending < 15000 && ++tries < 12) return new Promise(function (r) { setTimeout(r, 1200); }).then(get);
        return f;
      });
    };
    return get().then(function (f) { return untilReleased().then(function () { return f; }); }).then(function (f) {
      if (VE.p !== p || !VE.open) return;
      if (window.__veLive && window.__veLive.flushCode) try { window.__veLive.flushCode(); } catch (e) { /* sin panel */ }
      if ((f.st && f.st.codePending) || !ML || !ML.mergeStates) { delete VE_DOCS["videos/" + R.idx]; return RB.openVideo(R.id, R.idx); }
      var q = f.p, Q = q._real, st = f.st, K = ["v1", "m", "t", "a"];
      /* filas que creó este editor y que el estado del servidor ya no nombra: quedaron sueltas porque el MCP reemplazó
         las filas mientras guardábamos. Se sacan (el próximo guardado las borra) para que no salgan clips repetidos. */
      if (st && Array.isArray(st.v1) && (!st.pending || f.own) && R.own) {
        var refs = {}; K.forEach(function (k) { (st[k] || []).forEach(function (c) { if (c._s) refs[c._s] = 1; }); });
        K.forEach(function (k) { q[k] = q[k].filter(function (c) { return !(c._seg && R.own[c._seg] && !refs[c._seg]); }); });
      }
      /* clips que solo existen como filas (sin estado todavía): mismo id que en la base, por su fila */
      var bySeg = {}, used = {};
      K.forEach(function (k) { ((R.base || {})[k] || []).forEach(function (c) { if (c._s && c.id) bySeg[c._s] = c.id; }); q[k].forEach(function (c) { used[c.id] = 1; }); });
      K.forEach(function (k) { q[k].forEach(function (c) { var bid = c._seg && bySeg[c._seg]; if (bid && bid !== c.id && !used[bid]) { delete used[c.id]; c.id = bid; used[bid] = 1; } }); });
      var theirs = JSON.parse(JSON.stringify(editorState(q))), mine = JSON.parse(JSON.stringify(editorState(p)));
      var mg = ML.mergeStates(R.base || null, mine, theirs);
      applyMerged(q, mg.state);
      Q.idx = R.idx; Q.own = R.own; Q.base = theirs; Q.stateSig = st && st.pending ? null : sigOf(theirs);
      Q.cfN = why === "save" ? (R.cfN || 0) + 1 : 0; Q.editAt = R.editAt; Q.failN = R.failN; Q.savedAt = R.savedAt; Q.remoteSync = R.remoteSync;
      swapDoc(p, q, mg);
    });
  }
  function applyMerged(q, S) {
    ["v1", "m", "t", "a"].forEach(function (k) {
      var by = {}; q[k].forEach(function (c) { by[c.id] = c; });
      q[k] = (S[k] || []).map(function (j) {
        var mc = restoreClip(JSON.parse(JSON.stringify(j))), c = by[j.id];
        if (!c) return mc;
        Object.keys(c).forEach(function (u) { delete c[u]; });
        return Object.assign(c, mc);
      });
    });
    ["fmt", "pad", "grad", "total", "persp", "fps", "gtr", "markers", "lanes"].forEach(function (f) { if (S[f] != null) q[f] = S[f]; else if (f !== "fmt" && f !== "fps") delete q[f]; });
    relayout(q);
  }
  /* el editor pasa a mostrar lo juntado sin cerrar nada: misma selección, mismo tiempo; el inspector se redibuja
     cuando no estás escribiendo en él */
  function swapDoc(p, q, mg) {
    var key = "videos/" + p._real.idx, sel = VE.sel, selId = sel && p[sel.tr] && p[sel.tr][sel.i] ? p[sel.tr][sel.i].id : null;
    /* el historial (deshacer) se vacía solo si llegaron cambios de afuera: deshacer no debe revertir lo que hizo la IA */
    p._real.retired = true; VE_DOCS[key] = q; VE.p = q; if (mg.theirs) { VE.hist = []; VE.fut = []; } VE._msel = {};
    if (selId) { var ni = (q[sel.tr] || []).findIndex(function (c) { return c.id === selId; }); VE.sel = ni >= 0 ? { tr: sel.tr, i: ni } : null; }
    var ids = {}; ["v1", "m", "t", "a"].forEach(function (k) { q[k].forEach(function (c) { if (c._seg) ids[c.id] = [c._seg, c._mat]; }); }); VE._ids = ids; VE._real = q._real;
    var typing = function () { var a = document.activeElement; return !!(a && a.closest && a.closest("#veInsp,.ve-insp") && /INPUT|TEXTAREA|SELECT/.test(a.tagName)); };
    veBin(); veAll();
    if (!typing()) veInsp(); else (function later(n) { setTimeout(function () { if (VE.p !== q) return; if (typing() && n < 120) return later(n + 1); veInsp(); }, 500); })(0);
    var names = mg.conflicts.map(function (c) { return "«" + String(c.name || "clip").slice(0, 24) + "»"; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).slice(0, 3).join(", ");
    if (mg.conflicts.length) vtoast("Se juntaron tus cambios con los de tu IA (MCP). En " + names + " cambiaron lo mismo: quedó lo tuyo");
    else if (mg.theirs && mg.mine) vtoast("Se juntaron tus cambios con los que hizo tu IA (MCP) mientras editabas");
    else if (mg.theirs) vtoast("Actualizado: hubo cambios desde MCP");
  }
  RB.veMergeRemote = function () { var p = VE.open && VE.p && VE.p._real ? VE.p : null; if (!p || busy) return Promise.resolve(false); busy = true; return mergeRemote(p, "manual").then(function () { return true; }, function () { return false; }).then(function (v) { busy = false; if (again) { again = false; schedule(); } return v; }); };
  /* ids de clip únicos: al recargar, el contador de ids (nid) empezaba de nuevo y podía repetir el id de un clip
     guardado (dos «c82»): el morph entre clips, «Editar varios» y el código del video se confundían. Ahora el contador
     sigue después del id más alto del proyecto y los repetidos que ya existan se reparan al abrir. */
  function fixIds(p) {
    var max = 0, seen = {};
    ["v1", "m", "t", "a"].forEach(function (k) { (p[k] || []).forEach(function (c) { var m = /^c(\d+)$/.exec(c.id || ""); if (m) max = Math.max(max, +m[1]); }); });
    try { if (typeof vid !== "undefined" && vid < max) vid = max; } catch (e) { /* sin contador */ }
    ["v1", "m", "t", "a"].forEach(function (k) { (p[k] || []).forEach(function (c) { if (!c.id || seen[c.id]) c.id = nid(); seen[c.id] = 1; }); });
    return p;
  }
  RB.veFixIds = fixIds;
  function restoreClip(c) { delete c._s; if (c.kind === "take" && c.takeUrl) c.take = takeFor(c.takeUrl, c.name, c.dur); delete c.takeUrl; c.id = c.id || nid(); return c; }
  function mergeState(p, st) {
    if (!st || !Array.isArray(st.v1)) return p;
    var bySeg = {};
    ["v1", "m", "t", "a"].forEach(function (k) { (st[k] || []).forEach(function (c) { if (c._s) bySeg[c._s] = c; }); });
    /* lo que guarda la base (material/segmento) manda: el estado solo completa lo visual que la base no guarda */
    var FROM_DB = { t: { text: 1, x: 1, y: 1, size: 1, font: 1, weight: 1, color: 1, bg: 1, anim: 1 }, m: { x: 1, y: 1, w: 1, ar: 1, radius: 1, bg: 1, name: 1 }, a: { name: 1 }, v1: { name: 1 } };
    /* QA Instinct T20: un guardado que se cortó a la mitad dejó la foto completa «pendiente»: manda entera y la base se
       pone al día al abrir (los segmentos que la foto no tiene se borran, los que faltan se crean) */
    var pend = !!st.pending, inDb = {};
    ["v1", "m", "t", "a"].forEach(function (k) { p[k].forEach(function (c) { if (c._seg) inDb[c._seg] = 1; }); });
    if (pend) { ["v1", "m", "t", "a"].forEach(function (k) { p[k] = p[k].filter(function (c) { return !c._seg || bySeg[c._seg]; }); }); p._real.resync = true; }
    ["v1", "m", "t", "a"].forEach(function (k) { p[k].forEach(function (c) {
      var sv = c._seg && bySeg[c._seg]; if (!sv) return;
      /* el id del clip se conserva entre cargas: «Morph hacia otro clip» y las marcas de «Editar varios» lo usan */
      if (sv.id) c.id = sv.id;
      if (pend) { Object.keys(sv).forEach(function (u) { if (["_s", "takeUrl", "take", "kind", "id"].indexOf(u) < 0) c[u] = sv[u]; }); return; }
      UI_KEYS.forEach(function (u) { if (sv[u] !== undefined && u !== "in" && u !== "speed" && !FROM_DB[k][u]) c[u] = sv[u]; });
    }); });
    /* con una foto «pendiente» (guardado cortado o «Restaurar») también vuelven los clips cuyo segmento ya no está en la
       base: se crean de nuevo con su mismo id y su lugar en la lista */
    var back = function (c) { return !c._s || (pend && !inDb[c._s]); };
    st.v1.forEach(function (c, i) { if (back(c)) p.v1.splice(Math.min(i, p.v1.length), 0, restoreClip(c)); });
    ["m", "t", "a"].forEach(function (k) { (st[k] || []).forEach(function (c) { if (back(c)) p[k].push(restoreClip(c)); }); });
    /* QA Instinct B24/B27: el orden de los clips cambiaba entre cargas (venía del orden de pistas/fechas de la base);
       ahora se respeta el orden guardado (que también es el orden de pintado: delante/detrás) */
    ["m", "t", "a"].forEach(function (k) {
      var ord = {}, oid = {}; (st[k] || []).forEach(function (c, i) { if (c._s) ord[c._s] = i; if (c.id) oid[c.id] = i; });
      var pos = p[k].map(function (c, i) { return [c, c._seg && ord[c._seg] != null ? ord[c._seg] : oid[c.id] != null ? oid[c.id] : 1e6 + i]; });
      pos.sort(function (a, b) { return a[1] - b[1]; });
      p[k] = pos.map(function (x) { return x[0]; });
    });
    if (st.pad) p.pad = st.pad;
    if (st.grad) p.grad = st.grad;
    if (st.total) p.total = st.total;
    if (st.totalUser) p.totalUser = true;
    if (p.total && !p.totalUser && contentEnd(p) > p.total + 1e-6) delete p.total;
    if (st.persp) p.persp = st.persp;
    if (st.gtr) p.gtr = st.gtr;
    if (st.markers) p.markers = st.markers;
    if (st.lanes) p.lanes = st.lanes;
    relayout(p);
    return p;
  }

  /* un arrastre en curso (timeline, lienzo, deslizadores): se junta recién al soltar */
  var ptrDown = 0;
  veRoot.addEventListener("pointerdown", function () { ptrDown = Date.now(); }, true);
  ["pointerup", "pointercancel"].forEach(function (ev) { addEventListener(ev, function () { ptrDown = 0; }, true); });
  addEventListener("blur", function (e) { if (e.target === window) ptrDown = 0; });
  function untilReleased() {
    return new Promise(function (res) { var t0 = Date.now(); (function w() { if (!ptrDown || Date.now() - t0 > 60000 || Date.now() - ptrDown > 120000) return res(); setTimeout(w, 150); })(); });
  }
  /* cualquier ajuste en el editor (inspector, timeline, menús) programa un guardado */
  ["input", "change", "pointerup", "keyup"].forEach(function (ev) { veRoot.addEventListener(ev, function () { if (VE.open && VE.p && VE.p._real) { VE.p._real.editAt = Date.now(); schedule(); } }, true); });

  /* cada cambio del timeline programa un guardado */
  var _veAll = veAll;
  /* la duración que viene de una especificación o de un diseño (p.total sin totalUser) es un mínimo: si agregas una toma,
     un audio o un subtítulo más largo, el video crece. Antes un video hecho desde un diseño quedaba en 3 s y todo lo que
     sumabas después se cortaba. Solo «Total (s)» escrito por la persona fija la duración. */
  function contentEnd(p) { var e = 0; ["v1", "m", "t", "a"].forEach(function (k) { (p[k] || []).forEach(function (c) { var x = (+c.start || 0) + (+c.dur || 0); if (x > e) e = x; }); }); return e; }
  RB.contentEnd = contentEnd;
  veAll = function () {
    var p = VE.p; if (p && p.total && !p.totalUser && contentEnd(p) > p.total + 1e-6) delete p.total;
    var r = _veAll.apply(this, arguments); if (VE.p && VE.p._real) schedule(); return r;
  };
  var _vundo = vundo;
  vundo = function () { var r = _vundo.apply(this, arguments); if (VE.p && VE.p._real) schedule(); return r; };
  /* vstate guarda el proyecto como JSON: los ids reales viajan aparte */
  var _veClose = veClose;
  veClose = function () { if (VE.p && VE.p._real) { clearTimeout(timer); sync(); } return _veClose.apply(this, arguments); };

  /* deshacer: el JSON pierde los ids reales; se los devolvemos por id de clip */
  var _vsnap = vsnap;
  vsnap = function () {
    if (VE.p && VE.p._real) { var m = {}; ["v1", "m", "t", "a"].forEach(function (k) { VE.p[k].forEach(function (c) { if (c._seg) m[c.id] = [c._seg, c._mat]; }); }); VE._ids = Object.assign(VE._ids || {}, m); VE._real = VE.p._real; }
    return _vsnap.apply(this, arguments);
  };
  vundo = (function (prev) {
    return function () {
      var real = VE.p && VE.p._real, r = prev.apply(this, arguments);
      if (real && VE.p && !VE.p._real) {
        Object.defineProperty(VE.p, "_real", { value: real, enumerable: false });
        ["v1", "m", "t", "a"].forEach(function (k) { VE.p[k].forEach(function (c) { var ids = VE._ids && VE._ids[c.id]; if (ids) { Object.defineProperty(c, "_seg", { value: ids[0], writable: true, enumerable: false }); Object.defineProperty(c, "_mat", { value: ids[1], writable: true, enumerable: false }); } }); });
        schedule();
      }
      return r;
    };
  })(vundo);

  /* ── panel de medios: tus videos, tus imágenes y tus diseños ── */
  var _veBin = veBin;
  veBin = function () {
    _veBin.apply(this, arguments);
    if (!VE.p || !VE.p._real || VE.tab !== "media") return;
    var box = vq("#veBin") || document.querySelector(".ve-bin");
    var secs = (box || document).querySelectorAll(".ve-bsec");
    var A = (RB.assets || []);
    var add = function (l, sub, attrs, th) { return '<button class="ve-item" ' + attrs + ">" + th + "<span><b>" + eesc(l) + "</b>" + (sub ? "<small>" + sub + "</small>" : "") + "</span><i>+</i></button>"; };
    if (secs[0]) secs[0].querySelectorAll("small").forEach(function (sm) { sm.textContent = sm.textContent.replace("grabada ahora", "video"); });
    if (secs[1]) secs[1].innerHTML = '<div class="ed-mh">Tus imágenes — se suman en M, en el playhead</div>' + ((RB.uniqImgs ? RB.uniqImgs(A) : A.filter(function (a) { return /^image/.test(a.mime_type || "") && a.url; })).slice(0, 60).map(function (a) {
      return add(a.name || "Imagen", "imagen", 'data-add="media" data-v="' + eesc((a.name || "Imagen").replace(/\|/g, " ")) + "|url(&#39;" + eesc(a.url) + '&#39;) center/cover no-repeat"', '<span class="ve-bth" style="background:url(&#39;' + eesc(a.url) + '&#39;) center/cover"></span>');
    }).join("") || '<div class="ed-note">Sube imágenes en Configuración › Almacenamiento.</div>');
    if (secs[2]) secs[2].innerHTML = '<div class="ed-mh">Tus diseños — clic para sumarlos como escena al final de V1</div>' + (RB.tpl || []).slice(0, 60).map(function (t) {
      return add(t.name || "Diseño", (t.w && t.h ? t.w + "×" + t.h : "diseño"), 'data-rdesign="' + eesc(t.id) + '"', '<span class="ve-bth" style="background:#222"></span>');
    }).join("");
  };
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-rdesign]");
    if (!b || !VE.open || !VE.p || !VE.p._real) return;
    e.stopPropagation(); e.preventDefault();
    var id = b.dataset.rdesign;
    vtoast("Preparando la escena…");
    var src = RB.f0 && RB.f0[id];
    (src ? Promise.resolve(src) : api("/rest/v1/templates?id=eq." + encodeURIComponent(id) + "&select=f0:data->frames->0").then(function (r) { return r && r[0] && r[0].f0; }))
      .then(function (s) { if (!s) throw new Error("diseño vacío"); return RB.shotSrc(s); })
      .then(function (dataUrl) {
        var p = VE.p, W = VFMT[p.fmt][0], H = VFMT[p.fmt][1];
        vsnap();
        p.v1.push(scene(SC(b.querySelector("b").textContent, W, H, "transparent", [IM("Diseño", 0, 0, W, H, "url('" + dataUrl + "') center/contain no-repeat")]), 3));
        veAll(); veInsp && veInsp();
        vtoast("Escena agregada al final de V1");
      }, function (err) { vtoast("No se pudo agregar: " + (err && err.message)); });
  }, true);

  /* ── Exportar reel de verdad: se compone en un canvas y se graba (MP4 si el navegador puede, si no WebM) ── */
  function loadImg(url) { return new Promise(function (res) { var im = new Image(); im.crossOrigin = "anonymous"; im.onload = function () { res(im); }; im.onerror = function () { res(null); }; im.src = url; }); }
  function cover(g, src, sw, sh, W, H, contain) { if (!sw || !sh) return; var s = contain ? Math.min(W / sw, H / sh) : Math.max(W / sw, H / sh); g.drawImage(src, (W - sw * s) / 2, (H - sh * s) / 2, sw * s, sh * s); }
  function urlOf(fill) { var m = String(fill || "").match(/url\(["']?([^"')]+)["']?\)/); return m ? m[1] : null; }
  /* degradados igual que el CSS de la vista previa (gradCss en bridge-video-pro.js), centrados en (cx, cy) */
  function paintGrad(g, gr, w, h, cx, cy) {
    var a = gr.a || "#ff5e00", halo = gr.type === "halo", b = halo ? (String(a).slice(0, 7) + "00") : (gr.b || "#111111"), G;
    if (gr.type === "radial" || halo) {
      G = g.createRadialGradient(cx, cy, 0, cx, cy, Math.sqrt(w * w + h * h) / 2);
      G.addColorStop(0, a); G.addColorStop(halo ? 0.7 : 1, b); if (halo) G.addColorStop(1, b);
    } else {
      var th = (gr.angle != null ? +gr.angle : 135) * Math.PI / 180, dx = Math.sin(th), dy = -Math.cos(th), L = Math.abs(w * dx) + Math.abs(h * dy);
      G = g.createLinearGradient(cx - dx * L / 2, cy - dy * L / 2, cx + dx * L / 2, cy + dy * L / 2);
      G.addColorStop(0, a); G.addColorStop(1, b);
    }
    return G;
  }
  /* fondo del video; «Anillos concéntricos» (QA Instinct reel Comfy v11): anillos suaves sobre el color de fondo */
  function paintBg(g, p, W, H) {
    var gr = p.grad;
    if (gr && gr.type === "rings") {
      g.fillStyle = gr.b || "#f9f9f2"; g.fillRect(0, 0, W, H);
      var gap = Math.max(20, +gr.gap || 150), rw = Math.max(1, +gr.rw || 10), R = Math.sqrt(W * W + H * H) / 2;
      g.save(); g.strokeStyle = gr.a || "#e4dcf7"; g.lineWidth = rw; g.shadowColor = gr.a || "#e4dcf7"; g.shadowBlur = rw * 1.5;
      for (var r = gap; r < R + gap; r += gap) { g.beginPath(); g.arc(W / 2, H / 2, r, 0, Math.PI * 2); g.stroke(); }
      g.restore(); return;
    }
    g.fillStyle = gr ? paintGrad(g, gr, W, H, W / 2, H / 2) : (p.pad || "#000"); g.fillRect(0, 0, W, H);
  }
  function rrect(g, x, y, w, h, r) { r = Math.max(0, Math.min(r, w / 2, h / 2)); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function stateOf(x, t, kind) { var P = window.__vePro; return P ? P.state(x, t, kind) : { dx: 0, dy: 0, s: 1, r: 0, o: kind === "m" ? (x.opacity != null ? x.opacity : 1) : 1 }; }
  function bgOfX(x) { var P = window.__vePro; return P && P.bgOf ? P.bgOf(x) : x.bg; }
  function drawMedia(g, x, t, W, H, k, imgs) {
    var st = stateOf(x, t, "m"), w = W * (x.w || 40) / 100, h = w / (x.ar || 1), bgx = bgOfX(x);
    g.save();
    if (st.blur > 0.05) g.filter = "blur(" + (st.blur * k).toFixed(1) + "px)";
    g.globalAlpha = Math.max(0, Math.min(1, st.o));
    g.translate(W * x.x / 100 + st.dx * k, H * x.y / 100 + st.dy * k); g.rotate((st.r || 0) * Math.PI / 180); g.scale(st.s, st.s);
    var glow = x.glow || (st.glow ? "#ffffff" : ""); if (glow) { g.shadowColor = glow; g.shadowBlur = (x.glowR != null ? +x.glowR : 24) * k; }
    /* QA Instinct v16: máscara con forma (y revelado animado) */
    var Pm = window.__vePro; if (x.mask && Pm && Pm.maskPath) { Pm.maskPath(g, x, t, w, h); g.clip(); }
    rrect(g, -w / 2, -h / 2, w, h, x.shape === "circle" ? Math.min(w, h) / 2 : (x.radius || 0) * k);
    var LVx = window.__veLive, im = x.live && LVx ? LVx.img(x) : imgs[urlOf(bgx)];
    if (im) {
      g.save(); g.clip();
      var iw = im.naturalWidth || im.width || w, ih = im.naturalHeight || im.height || h, s = /contain/.test(bgx) ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
      g.drawImage(im, -iw * s / 2, -ih * s / 2, iw * s, ih * s);
      g.restore();
    } else if (!urlOf(bgx)) {
      g.fillStyle = x.grad ? paintGrad(g, x.grad, w, h, 0, 0) : (x.bg || "#ff5e00");
      g.fill();
    }
    g.restore();
  }
  function drawText(g, x, t, W, H, k, W0) {
    var P = window.__vePro, st = stateOf(x, t, "t"), size = (P ? P.fitSize(x, W0) : (x.size || 64)) * k;
    var mp = P && P.morphP ? P.morphP(x, t - x.start) : null;
    var text = String(mp != null && mp >= 1 ? x.morphTo : (x.text || "")), txt = st.chars != null ? text.slice(0, Math.round(text.length * st.chars)) : text;
    var lines = txt.split("\n"), lh = size * 1.1;
    g.save();
    if (st.blur > 0.05) g.filter = "blur(" + (st.blur * k).toFixed(1) + "px)";
    g.globalAlpha = Math.max(0, Math.min(1, st.o));
    g.translate(W * x.x / 100 + st.dx * k, H * x.y / 100 + st.dy * k); g.rotate((st.r || 0) * Math.PI / 180); g.scale(st.s, st.s);
    g.font = (x.italic ? "italic " : "") + (x.weight || 800) + " " + size + "px " + (FONTS[x.font] || "Inter,sans-serif"); g.textAlign = "center"; g.textBaseline = "middle";
    if ("letterSpacing" in g) g.letterSpacing = (x.ls ? x.ls * k : 0) + "px";
    var y0 = -(lines.length - 1) * lh / 2;
    if (x.mask && P && P.maskPath) { var mwM = Math.max.apply(null, String(text).split("\n").map(function (l) { return g.measureText(l).width; })); P.maskPath(g, x, t, mwM + (x.bg ? size * 1.1 : 0), lh * lines.length + (x.bg ? size * 0.4 : 0)); g.clip(); }
    if (x.bg) {
      var mw = Math.max.apply(null, String(text).split("\n").map(function (l) { return g.measureText(l).width; }));
      g.fillStyle = x.bg; rrect(g, -mw / 2 - size * .55, y0 - lh / 2 - size * .2, mw + size * 1.1, lh * lines.length + size * .4, size * .35); g.fill();
    }
    var glow = x.glow || (st.glow ? (x.color || "#ffffff") : "");
    g.fillStyle = x.color || "#fff";
    var paint0 = function (ls) { var y = -(ls.length - 1) * lh / 2; ls.forEach(function (l, i) { g.fillText(l, 0, y + i * lh); }); };
    var paint = function () {
      if (mp == null || mp <= 0 || mp >= 1) return paint0(lines);
      /* morph: el texto A se desvanece y desenfoca mientras aparece B (igual que en la vista previa) */
      var a0 = g.globalAlpha, bl = 14 * k;
      g.globalAlpha = a0 * (1 - mp); g.filter = "blur(" + (mp * bl).toFixed(1) + "px)"; paint0(lines);
      g.globalAlpha = a0 * mp; g.filter = "blur(" + ((1 - mp) * bl).toFixed(1) + "px)"; paint0(String(x.morphTo).split("\n"));
      g.globalAlpha = a0; g.filter = st.blur > 0.05 ? "blur(" + (st.blur * k).toFixed(1) + "px)" : "none";
    };
    if (glow) { g.shadowColor = glow; g.shadowBlur = (x.glowR != null ? +x.glowR : 24) * k * 2; paint(); g.shadowBlur = (x.glowR != null ? +x.glowR : 24) * k * 0.6; paint(); g.shadowBlur = 0; }
    paint();
    g.restore();
  }
  /* las fuentes de los textos, cargadas antes de grabar (si no, el canvas usa la de reserva) */
  function fontsReady(p) {
    if (!document.fonts) return Promise.resolve();
    var P = window.__vePro;
    return Promise.race([Promise.all((p.t || []).map(function (x) { if (P) P.ensureFont(x.font); return document.fonts.load((x.weight || 800) + " 64px " + (FONTS[x.font] || "Inter")).catch(function () {}); })), new Promise(function (r) { setTimeout(r, 4000); })]);
  }
  /* textos y media en el orden de profundidad (eje Z): lo de atrás primero, igual que la vista previa */
  function paintFree(g, p, t, W, H, k, imgs, W0) {
    var P = window.__vePro;
    var list = P && P.order ? P.order(p, t) : p.m.filter(function (x) { return t >= x.start && t < x.start + x.dur; }).map(function (c) { return { k: "m", c: c }; }).concat(p.t.filter(function (x) { return t >= x.start && t < x.start + x.dur; }).map(function (c) { return { k: "t", c: c }; }));
    /* pistas ocultas (ojo en el nombre de la pista): no se exportan */
    var LN = p.lanes || {};
    list.forEach(function (q) {
      if ((q.k === "m" && LN.m && LN.m.hide) || (q.k === "t" && LN.t && LN.t.hide)) return;
      if (q.c.hideM) return;   /* el clip que sirve de recorte no se pinta solo */
      if (q.c.adj) return adjPaint(g, q.c, t, W, H, k);
      if (q.c.matte) return mattePaint(g, p, q, t, W, H, k, imgs, W0);
      g.save(); if (q.k === "m") drawMedia(g, q.c, t, W, H, k, imgs); else drawText(g, q.c, t, W, H, k, W0); g.restore();
    });
  }
  /* QA Instinct v16: capa de ajuste (afecta todo lo que está debajo) y recorte con la forma de otro clip (track matte) */
  var OFF = {};
  function offCv(n, W, H) { var c = OFF[n] || (OFF[n] = document.createElement("canvas")); if (c.width !== W || c.height !== H) { c.width = W; c.height = H; } return c; }
  function adjPaint(g, x, t, W, H, k) {
    var P = window.__vePro; if (!P || !P.adjFilter) return;
    var st = stateOf(x, t, "m"), f = P.adjFilter(x, t - x.start, k); if (!f) return;
    var cp = offCv("adj", W, H), cg = cp.getContext("2d"); cg.clearRect(0, 0, W, H); cg.drawImage(g.canvas, 0, 0);
    g.save(); g.globalAlpha = Math.max(0, Math.min(1, st.o)); g.filter = f; g.drawImage(cp, 0, 0); g.restore();
  }
  function mattePaint(g, p, q, t, W, H, k, imgs, W0) {
    var M = (p.m || []).find(function (c) { return c.id === q.c.matte; });
    var off = offCv("matte", W, H), og = off.getContext("2d"); og.clearRect(0, 0, W, H);
    og.save(); if (q.k === "m") drawMedia(og, q.c, t, W, H, k, imgs); else drawText(og, q.c, t, W, H, k, W0); og.restore();
    if (M && t >= M.start && t < M.start + M.dur) { og.save(); og.globalCompositeOperation = "destination-in"; drawMedia(og, Object.assign({}, M, { hideM: false, opacity: 1 }), t, W, H, k, imgs); og.restore(); }
    else if (M) og.clearRect(0, 0, W, H);
    g.drawImage(off, 0, 0);
  }
  /* QA Instinct v16: estabilización (el video se corre al revés de lo que se movió el punto seguido) */
  function coverV(g, v, c, t, W, H, k) {
    var P = window.__vePro, o = P && P.stabAt ? P.stabAt(c, t - c.start) : null;
    if (!o) return cover(g, v, v.videoWidth, v.videoHeight, W, H, c.fit === "contain");
    g.save(); g.translate(W / 2, H / 2); g.scale(o.z, o.z); g.translate(-W / 2 - o.x * k, -H / 2 - o.y * k);
    cover(g, v, v.videoWidth, v.videoHeight, W, H, c.fit === "contain"); g.restore();
  }
  function exportReal(opts, onProg) {
    var p = VE.p, W0 = VFMT[p.fmt][0], H0 = VFMT[p.fmt][1], k = Math.min(1, (+opts.r || 1080) / Math.min(W0, H0)), W = Math.round(W0 * k / 2) * 2, H = Math.round(H0 * k / 2) * 2;
    var fps = +opts.fps || p.fps || 30, dur = veDur(p);
    var cv = document.createElement("canvas"); cv.width = W; cv.height = H; var g = cv.getContext("2d");
    if (!cv.captureStream || !window.MediaRecorder) return Promise.reject(new Error("este navegador no puede exportar video. Usa Chrome, Edge o Safari actualizados"));
    var imgs = {}, vids = {}, urls = [];
    p.v1.forEach(function (c) { if (c.kind === "scene" && c.scene) c.scene.els.forEach(function (e) { var u = urlOf(e.fill); if (u) urls.push(u); }); });
    p.m.forEach(function (c) { var u = urlOf(bgOfX(c)); if (u) urls.push(u); });
    return Promise.all(urls.map(function (u) { return loadImg(u).then(function (im) { imgs[u] = im; }); }).concat([fontsReady(p)])).then(function () {
      p.v1.forEach(function (c) { if (c.kind === "take" && VTAKES[c.take] && VTAKES[c.take].blob && !vids[c.id]) { var v = document.createElement("video"); v.crossOrigin = "anonymous"; v.src = VTAKES[c.take].blob; v.preload = "auto"; v.playsInline = true; vids[c.id] = v; } });
      return Promise.all(Object.keys(vids).map(function (id) { var v = vids[id]; return new Promise(function (r) { if (v.readyState >= 2) r(); v.onloadeddata = r; v.onerror = r; setTimeout(r, 8000); }); }));
    }).then(function () {
      /* Audio: UNA sola pista con todo mezclado (tomas + audios propios), y solo si hay sonido. Antes iban dos pistas
         (una por cada AudioContext), vacías si no había nada que sonara: el MP4 salía cortado (un video de 5 s
         quedaba en 1,6 s) y sin audio. */
      var stream = cv.captureStream(fps), chunks = [], auds = [], nSrc = 0, ac = null, dest = null;
      try {
        ac = window.__mbAC || (window.__mbAC = new (window.AudioContext || window.webkitAudioContext)());
        dest = ac.createMediaStreamDestination();
        Object.keys(vids).forEach(function (id) { try { ac.createMediaElementSource(vids[id]).connect(dest); nSrc++; } catch (e) {} });
        p.a.filter(function (x) { return x.url; }).forEach(function (x) { var au = new Audio(); au.crossOrigin = "anonymous"; au.src = x.url; au.volume = x.vol != null ? x.vol : 1; try { ac.createMediaElementSource(au).connect(dest); nSrc++; } catch (e) {} auds.push({ c: x, el: au, on: false }); });
        if (nSrc) { if (ac.state === "suspended" && ac.resume) ac.resume(); dest.stream.getAudioTracks().slice(0, 1).forEach(function (t) { stream.addTrack(t); }); }
      } catch (e) {}
      var withAudio = stream.getAudioTracks().length > 0;
      var mime = (withAudio ? ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"] : ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"])
        .filter(function (m) { return opts.f === "webm" ? /webm/.test(m) : true; }).find(function (m) { return window.MediaRecorder && MediaRecorder.isTypeSupported(m); });
      var rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8e6 } : undefined);
      rec.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
      return new Promise(function (res, rej) {
        rec.onstop = function () { res(new Blob(chunks, { type: (mime || "video/webm").split(";")[0] })); };
        rec.onerror = function (e) { rej(e.error || new Error("grabación")); };
        rec.start(250);
        var t0 = performance.now(), playing = null;
        var frame = function () {
          var t = (performance.now() - t0) / 1000;
          if (t >= dur) { Object.keys(vids).forEach(function (id) { vids[id].pause(); }); auds.forEach(function (A) { A.el.pause(); }); rec.stop(); onProg(100); return; }
          onProg(Math.round(t / dur * 100));
          auds.forEach(function (A) { var inside = t >= A.c.start && t < A.c.start + A.c.dur; if (inside && !A.on) { A.on = true; A.el.currentTime = Math.max(0, t - A.c.start); A.el.play().catch(function () {}); } else if (!inside && A.on) { A.on = false; A.el.pause(); } });
          paintBg(g, p, W, H);
          var c = p.v1.find(function (x) { return t >= x.start && t < x.start + x.dur; });
          if (c && c.kind === "take" && vids[c.id]) {
            var v = vids[c.id];
            if (playing !== c.id) { Object.keys(vids).forEach(function (id) { if (id !== c.id) vids[id].pause(); }); v.currentTime = (c.in || 0) + (t - c.start) * (c.speed || 1); v.playbackRate = c.speed || 1; v.play().catch(function () {}); playing = c.id; }
            coverV(g, v, c, t, W, H, k);
          } else if (c && c.kind === "scene" && c.scene) {
            playing = null;
            c.scene.els.forEach(function (e) { var im = imgs[urlOf(e.fill)]; if (im) cover(g, im, im.naturalWidth, im.naturalHeight, W, H, /contain/.test(e.fill)); });
          }
          /* textos y media con el MISMO cálculo que la vista previa (bridge-video-pro.js): entrada, keyframes,
             efecto continuo, brillo, ajuste al ancho, formas y degradados. Antes el MP4 no animaba nada de T/M. */
          if (window.__veLive) window.__veLive.want(p, t);
          paintFree(g, p, t, W, H, k, imgs, W0);
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
    });
  }
  RB.exportReel = exportReal;
  /* ── Exportar cuadro por cuadro (WebCodecs): 30 cuadros exactos por segundo y duración exacta, más rápido que
     el tiempo real. MediaRecorder grababa en vivo: el MP4 salía con ~29 fps variables y dependía de que la
     pestaña no se trabara. Sin WebCodecs (o si se pide WebM) se usa la grabación de siempre. ── */
  function loadMuxer() {
    if (window.Mp4Muxer) return Promise.resolve(window.Mp4Muxer);
    return new Promise(function (res, rej) {
      var s = document.createElement("script"); s.src = "vendor/mp4-muxer.min.js?v=513";
      s.onload = function () { window.Mp4Muxer ? res(window.Mp4Muxer) : rej(new Error("no cargó el empaquetador MP4")); };
      s.onerror = function () { rej(new Error("no cargó el empaquetador MP4")); };
      document.head.appendChild(s);
    });
  }
  function avcCodec(W, H, fps) {
    var list = W * H > 2228224 ? ["avc1.640033", "avc1.640034"] : ["avc1.640028", "avc1.4d0028", "avc1.42e028", "avc1.42e01f"];
    return list.reduce(function (pr, c) {
      return pr.then(function (found) {
        if (found) return found;
        return VideoEncoder.isConfigSupported({ codec: c, width: W, height: H, bitrate: 8e6, framerate: fps }).then(function (r) { return r.supported ? c : null; }, function () { return null; });
      });
    }, Promise.resolve(null));
  }
  /* audio: tomas de V1 y audios propios mezclados sin conexión, con volumen y fundidos */
  function mixAudio(p, dur, rate) {
    var srcs = [];
    p.v1.forEach(function (c) { if (c.kind === "take" && VTAKES[c.take] && VTAKES[c.take].blob && (c.vol == null || c.vol > 0)) srcs.push({ url: VTAKES[c.take].blob, start: c.start, dur: c.dur, off: c.in || 0, rate: c.speed || 1, vol: c.vol != null ? c.vol : 1, fin: 0, fout: 0 }); });
    if (!(p.lanes && p.lanes.a && p.lanes.a.mute)) p.a.forEach(function (x) { if (x.url) srcs.push({ c: x, url: x.url, start: x.start, dur: x.dur, off: x.in || 0, rate: 1, vol: x.vol != null ? x.vol : 1, fin: x.fin || 0, fout: x.fout || 0 }); });
    if (!srcs.length || !window.OfflineAudioContext) return Promise.resolve(null);
    var oc = new OfflineAudioContext(2, Math.ceil(dur * rate), rate), got = 0;
    return Promise.all(srcs.map(function (s) {
      return fetch(s.url, { mode: "cors" }).then(function (r) { return r.arrayBuffer(); }).then(function (b) { return oc.decodeAudioData(b); }).then(function (buf) {
        var src = oc.createBufferSource(), gn = oc.createGain();
        src.buffer = buf; src.playbackRate.value = s.rate; src.connect(gn); gn.connect(oc.destination);
        var t0 = Math.max(0, s.start), t1 = Math.min(dur, s.start + s.dur);
        var PG = window.__vePro;
        if (PG && PG.gainAt && s.c && ((s.c.volk && s.c.volk.length) || s.c.duck)) {
          /* QA Instinct v16: volumen con keyframes y «bajar la música cuando hay voz» (ducking), cada 50 ms */
          var fade = function (tt) { var f = 1; if (s.fin > 0) f = Math.min(f, (tt - t0) / s.fin); if (s.fout > 0) f = Math.min(f, (t1 - tt) / s.fout); return Math.max(0, Math.min(1, f)); };
          gn.gain.setValueAtTime(PG.gainAt(p, s.c, t0) * fade(t0), t0);
          for (var tt = t0 + 0.05; tt < t1; tt += 0.05) gn.gain.linearRampToValueAtTime(Math.max(0, PG.gainAt(p, s.c, tt) * fade(tt)), tt);
          gn.gain.linearRampToValueAtTime(Math.max(0, PG.gainAt(p, s.c, t1) * fade(t1)), t1);
        } else {
        gn.gain.setValueAtTime(s.fin > 0 ? 0 : s.vol, t0);
        if (s.fin > 0) gn.gain.linearRampToValueAtTime(s.vol, t0 + s.fin);
        if (s.fout > 0) { gn.gain.setValueAtTime(s.vol, Math.max(t0, t1 - s.fout)); gn.gain.linearRampToValueAtTime(0, t1); }
        }
        src.start(t0, s.off, Math.max(0, (t1 - t0) * s.rate)); got++;
      }, function () { /* un audio sin permiso (CORS) o en un formato que no se decodifica: se omite */ });
    })).then(function () { return got ? oc.startRendering() : null; });
  }
  function seekTo(v, t) {
    return new Promise(function (r) {
      if (Math.abs(v.currentTime - t) < 0.001 && v.readyState >= 2) return r();
      var done = false, fin = function () { if (done) return; done = true; v.removeEventListener("seeked", fin); r(); };
      v.addEventListener("seeked", fin); try { v.currentTime = t; } catch (e) { fin(); } setTimeout(fin, 1500);
    });
  }
  /* agrega al MP4 la caja colr (nclx: BT.709, sRGB, rango completo) dentro de avc1 y corre los offsets de mdat */
  function withColr(buf) {
    try {
      var u8 = new Uint8Array(buf), dv = new DataView(buf), typ = function (o) { return String.fromCharCode(u8[o + 4], u8[o + 5], u8[o + 6], u8[o + 7]); };
      var find = function (from, to, name) { for (var o = from; o + 8 <= to;) { var sz = dv.getUint32(o); if (sz < 8) return -1; if (typ(o) === name) return o; o += sz; } return -1; };
      var moov = find(0, u8.length, "moov"); if (moov < 0) return buf;
      var mdat = find(0, u8.length, "mdat"), path = [moov], cur = moov;
      var trak = -1;
      for (var o = moov + 8; o < moov + dv.getUint32(moov);) { var sz = dv.getUint32(o); if (typ(o) === "trak") { var hd = find(o + 8, o + sz, "mdia"), hdlr = hd >= 0 ? find(hd + 8, hd + dv.getUint32(hd), "hdlr") : -1; if (hdlr >= 0 && String.fromCharCode(u8[hdlr + 16], u8[hdlr + 17], u8[hdlr + 18], u8[hdlr + 19]) === "vide") { trak = o; break; } } o += sz; }
      if (trak < 0) return buf;
      path.push(trak); cur = trak;
      ["mdia", "minf", "stbl", "stsd"].forEach(function (n) { if (cur < 0) return; cur = find(cur + 8, cur + dv.getUint32(cur), n); path.push(cur); });
      if (cur < 0) return buf;
      var avc1 = find(cur + 16, cur + dv.getUint32(cur), "avc1"); if (avc1 < 0) return buf;
      path.push(avc1);
      if (find(avc1 + 86, avc1 + dv.getUint32(avc1), "colr") >= 0) return buf;
      var at = avc1 + dv.getUint32(avc1), ADD = 19, out = new Uint8Array(u8.length + ADD), odv = new DataView(out.buffer);
      out.set(u8.subarray(0, at), 0);
      var colr = [0, 0, 0, 19, 99, 111, 108, 114, 110, 99, 108, 120, 0, 1, 0, 13, 0, 1, 128];
      out.set(colr, at); out.set(u8.subarray(at), at + ADD);
      path.forEach(function (b) { odv.setUint32(b, dv.getUint32(b) + ADD); });
      if (mdat > moov) {
        /* los offsets de muestras (stco/co64) de TODAS las pistas apuntan a mdat, que se corrió ADD bytes */
        var scan = function (from, to) {
          for (var q = from; q + 8 <= to;) {
            var size = odv.getUint32(q), t = String.fromCharCode(out[q + 4], out[q + 5], out[q + 6], out[q + 7]); if (size < 8) return;
            if (/^(trak|mdia|minf|stbl)$/.test(t)) scan(q + 8, q + size);
            else if (t === "stco") { var n = odv.getUint32(q + 12); for (var i = 0; i < n; i++) odv.setUint32(q + 16 + i * 4, odv.getUint32(q + 16 + i * 4) + ADD); }
            else if (t === "co64") { var m = odv.getUint32(q + 12); for (var j = 0; j < m; j++) { var lo = odv.getUint32(q + 20 + j * 8) + ADD; odv.setUint32(q + 20 + j * 8, lo >>> 0); if (lo > 0xffffffff) odv.setUint32(q + 16 + j * 8, odv.getUint32(q + 16 + j * 8) + 1); } }
            q += size;
          }
        };
        scan(moov + 8, moov + odv.getUint32(moov));
      }
      return out.buffer;
    } catch (e) { return buf; }
  }
  function exportFrames(opts, onProg) {
    var p = VE.p, W0 = VFMT[p.fmt][0], H0 = VFMT[p.fmt][1], k = Math.min(1, (+opts.r || 1080) / Math.min(W0, H0)), W = Math.round(W0 * k / 2) * 2, H = Math.round(H0 * k / 2) * 2;
    var fps = +opts.fps || p.fps || 30, dur = veDur(p), N = Math.max(1, Math.round(dur * fps)), RATE = 48000;
    var cv = document.createElement("canvas"); cv.width = W; cv.height = H; var g = cv.getContext("2d");
    var imgs = {}, vids = {}, urls = [];
    p.v1.forEach(function (c) { if (c.kind === "scene" && c.scene) c.scene.els.forEach(function (e) { var u = urlOf(e.fill); if (u) urls.push(u); }); });
    p.m.forEach(function (c) { var u = urlOf(bgOfX(c)); if (u) urls.push(u); });
    var codec, muxer, ve, ae, failed = null, audioBuf = null;
    onProg(0, "Preparando imágenes, fuentes y audio…");
    return Promise.all([loadMuxer(), avcCodec(W, H, fps)].concat(urls.map(function (u) { return loadImg(u).then(function (im) { imgs[u] = im; }); })).concat([fontsReady(p)])).then(function (r) {
      codec = r[1]; if (!codec) throw new Error("este navegador no puede codificar H.264 a " + W + "×" + H);
      p.v1.forEach(function (c) { if (c.kind === "take" && VTAKES[c.take] && VTAKES[c.take].blob && !vids[c.id]) { var v = document.createElement("video"); v.crossOrigin = "anonymous"; v.muted = true; v.src = VTAKES[c.take].blob; v.preload = "auto"; v.playsInline = true; vids[c.id] = v; } });
      return Promise.all(Object.keys(vids).map(function (id) { var v = vids[id]; return new Promise(function (r) { if (v.readyState >= 2) r(); v.onloadeddata = r; v.onerror = r; setTimeout(r, 8000); }); }));
    }).then(function () {
      return mixAudio(p, dur, RATE).catch(function () { return null; });
    }).then(function (ab) {
      audioBuf = ab;
      var aacOk = !audioBuf ? Promise.resolve(false) : window.AudioEncoder ? AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", sampleRate: RATE, numberOfChannels: 2, bitrate: 128000 }).then(function (x) { return !!x.supported; }, function () { return false; }) : Promise.resolve(false);
      return aacOk;
    }).then(function (aacOk) {
      if (audioBuf && !aacOk) throw Object.assign(new Error("sin AAC"), { fallback: true });
      var M = window.Mp4Muxer;
      muxer = new M.Muxer({ target: new M.ArrayBufferTarget(), video: { codec: "avc", width: W, height: H, frameRate: fps }, audio: audioBuf ? { codec: "aac", numberOfChannels: 2, sampleRate: RATE } : undefined, fastStart: "in-memory", firstTimestampBehavior: "offset" });
      /* el lienzo se codifica en rango completo BT.709 (sRGB): se declara en el MP4 (caja colr). Sin esto los
         reproductores lo leían como rango limitado y los colores salían lavados (arena → casi blanco) */
      var CS = { primaries: "bt709", transfer: "iec61966-2-1", matrix: "bt709", fullRange: true };
      ve = new VideoEncoder({ output: function (ch, meta) { if (meta && meta.decoderConfig) meta.decoderConfig.colorSpace = Object.assign({}, CS, meta.decoderConfig.colorSpace || {}, { fullRange: meta.decoderConfig.colorSpace && meta.decoderConfig.colorSpace.fullRange != null ? meta.decoderConfig.colorSpace.fullRange : true }); muxer.addVideoChunk(ch, meta); }, error: function (e) { failed = e; } });
      ve.configure({ codec: codec, width: W, height: H, bitrate: W * H >= 2073600 ? 10e6 : 6e6, framerate: fps });
      var i = 0;
      var step = function () {
        if (failed) return Promise.reject(failed);
        if (i >= N) return Promise.resolve();
        var t = i / fps, c = p.v1.find(function (x) { return t >= x.start && t < x.start + x.dur; });
        var ready = c && c.kind === "take" && vids[c.id] ? seekTo(vids[c.id], (c.in || 0) + (t - c.start) * (c.speed || 1)) : Promise.resolve();
        if (window.__veLive) ready = Promise.all([ready, window.__veLive.prep(p, t)]);
        return ready.then(function () {
          g.globalAlpha = 1; g.filter = "none";
          paintBg(g, p, W, H);
          if (c && c.kind === "take" && vids[c.id]) { var v = vids[c.id]; coverV(g, v, c, t, W, H, k); }
          else if (c && c.kind === "scene" && c.scene) c.scene.els.forEach(function (e) { var im = imgs[urlOf(e.fill)]; if (im) cover(g, im, im.naturalWidth, im.naturalHeight, W, H, /contain/.test(e.fill)); });
          paintFree(g, p, t, W, H, k, imgs, W0);
          var fr = new VideoFrame(cv, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
          ve.encode(fr, { keyFrame: i % (fps * 2) === 0 }); fr.close();
          i++;
          if (i % 6 === 0) onProg(Math.round(i / N * 95), "Armando el video cuadro por cuadro… " + i + " de " + N + " cuadros");
          /* dejar respirar al codificador y a la página */
          return ve.encodeQueueSize > 6 || i % 10 === 0 ? new Promise(function (r) { setTimeout(r, 0); }).then(step) : step();
        });
      };
      return step().then(function () { return ve.flush(); });
    }).then(function () {
      if (!audioBuf) return;
      onProg(97, "Agregando el audio…");
      ae = new AudioEncoder({ output: function (ch, meta) { muxer.addAudioChunk(ch, meta); }, error: function (e) { failed = e; } });
      ae.configure({ codec: "mp4a.40.2", sampleRate: RATE, numberOfChannels: 2, bitrate: 128000 });
      var L = audioBuf.getChannelData(0), R = audioBuf.numberOfChannels > 1 ? audioBuf.getChannelData(1) : L, CH = 4800;
      for (var off = 0; off < L.length; off += CH) {
        var n = Math.min(CH, L.length - off), data = new Float32Array(n * 2);
        data.set(L.subarray(off, off + n), 0); data.set(R.subarray(off, off + n), n);
        var ad = new AudioData({ format: "f32-planar", sampleRate: RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(off / RATE * 1e6), data: data });
        ae.encode(ad); ad.close();
      }
      return ae.flush();
    }).then(function () {
      if (failed) throw failed;
      muxer.finalize();
      try { ve.close(); } catch (e) {} try { if (ae) ae.close(); } catch (e) {}
      onProg(100, "Listo.");
      return new Blob([withColr(muxer.target.buffer)], { type: "video/mp4" });
    }, function (e) {
      try { if (ve && ve.state !== "closed") ve.close(); } catch (x) {} try { if (ae && ae.state !== "closed") ae.close(); } catch (x) {}
      throw e;
    });
  }
  RB.exportFrames = exportFrames;
  /* un cuadro del video como imagen (mismo dibujo que la exportación a MP4): lo usa «Este cuadro al editor de fotos» */
  RB.videoStill = function (t, side) {
    var p = VE.p, W0 = VFMT[p.fmt][0], H0 = VFMT[p.fmt][1], k = Math.min(1, (+side || 2160) / Math.max(W0, H0)), W = Math.round(W0 * k), H = Math.round(H0 * k);
    var cv = document.createElement("canvas"); cv.width = W; cv.height = H; var g = cv.getContext("2d"), imgs = {}, urls = [];
    t = Math.max(0, Math.min(veDur(p) - 1e-3, +t || 0));
    var c = p.v1.find(function (x) { return t >= x.start && t < x.start + x.dur; });
    if (c && c.kind === "scene" && c.scene) c.scene.els.forEach(function (e) { var u = urlOf(e.fill); if (u) urls.push(u); });
    p.m.forEach(function (x) { var u = urlOf(bgOfX(x)); if (u) urls.push(u); });
    var v = null;
    return Promise.all(urls.map(function (u) { return loadImg(u).then(function (im) { imgs[u] = im; }); }).concat([fontsReady(p)])).then(function () {
      if (!(c && c.kind === "take" && VTAKES[c.take] && VTAKES[c.take].blob)) return;
      v = document.createElement("video"); v.crossOrigin = "anonymous"; v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = VTAKES[c.take].blob;
      return new Promise(function (r) { if (v.readyState >= 2) r(); v.onloadeddata = r; v.onerror = r; setTimeout(r, 8000); }).then(function () { return seekTo(v, (c.in || 0) + (t - c.start) * (c.speed || 1)); });
    }).then(function () { return window.__veLive ? window.__veLive.prep(p, t) : null; }).then(function () {
      g.globalAlpha = 1; g.filter = "none";
      paintBg(g, p, W, H);
      if (v && v.readyState >= 2) coverV(g, v, c, t, W, H, k);
      else if (c && c.kind === "scene" && c.scene) c.scene.els.forEach(function (e) { var im = imgs[urlOf(e.fill)]; if (im) cover(g, im, im.naturalWidth, im.naturalHeight, W, H, /contain/.test(e.fill)); });
      paintFree(g, p, t, W, H, k, imgs, W0);
      if (v) { try { v.removeAttribute("src"); v.load(); } catch (e) { /* sin video */ } }
      return cv;
    });
  };
  RB.videoImgOf = function (x) { return urlOf(bgOfX(x)); };

  vq("#veModal").addEventListener("click", function (e) {
    if (!e.target.closest || !e.target.closest("[data-mgo]") || !VE.p || !VE.p._real) return;
    e.stopPropagation(); e.preventDefault();
    var m = vq("#veModal"), val = function (k) { var el = m.querySelector('[data-k="' + k + '"]'); return el ? el.value : null; };
    var bar = vq("#veProg i"), txt = vq("#veProgT"), btn = e.target.closest("[data-mgo]");
    /* timeline vacía: antes grababa y «descargaba» un video de 0 MB como si fuera válido (QA Instinct V6) */
    var pv = VE.p, has = (pv.v1 || []).length + (pv.t || []).length + (pv.m || []).length + (pv.a || []).length;
    if (!has) { txt.textContent = "La timeline está vacía: agrega una toma, un diseño, un texto o una imagen antes de exportar."; bar.style.width = "0%"; return; }
    btn.disabled = true;
    var o = { f: val("f"), r: val("r"), fps: val("fps") };
    var prog = function (k, msg) { bar.style.width = k + "%"; txt.textContent = msg || (k < 100 ? "Grabando el reel… " + k + "% (se graba en tiempo real)" : "Listo."); };
    var frameWay = o.f !== "webm" && window.VideoEncoder && window.VideoFrame;
    (frameWay ? exportFrames(o, prog).catch(function (er) {
      if (er && (er.fallback || /H\.264|empaquetador/.test(er.message || ""))) { prog(0, "Este navegador no arma el video cuadro por cuadro: se graba en tiempo real…"); return exportReal(o, prog); }
      throw er;
    }) : exportReal(o, prog))
      .then(function (blob) {
        if (!blob || blob.size < 1024) { txt.textContent = "No se grabó nada (el archivo salió vacío). Revisa que la timeline tenga clips visibles y vuelve a intentar."; return; }
        var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = (VE.p.name || "reel").replace(/[\/:*?"<>|]+/g, "-") + (/mp4/.test(blob.type) ? ".mp4" : ".webm"); document.body.appendChild(a); a.click(); a.remove();
        txt.textContent = "Listo: " + (blob.size / 1e6).toFixed(1).replace(".", ",") + " MB descargados (" + (/mp4/.test(blob.type) ? "MP4" : "WebM") + ").";
      }, function (err) { var em = String(err && err.message || "error"); txt.textContent = "No se pudo exportar: " + em + (/navegador/.test(em) ? "." : ". Si un clip viene de otra web sin permiso (CORS), súbelo a tus archivos."); })
      .then(function () { btn.disabled = false; if (window.__veLive) window.__veLive.endExport(); });
  }, true);

  /* exportar a un archivo sin descargarlo (lo usan «Exportar en lote» y el GIF) */
  RB.veExportBlob = function (o2, prog2) {
    var fw = o2.f !== "webm" && window.VideoEncoder && window.VideoFrame;
    var endL = function (x) { if (window.__veLive) window.__veLive.endExport(); return x; };
    var endE = function (e) { if (window.__veLive) window.__veLive.endExport(); throw e; };
    return (fw ? exportFrames(o2, prog2).catch(function (er) { if (er && (er.fallback || /H\.264|empaquetador/.test(er.message || ""))) return exportReal(o2, prog2); throw er; }) : exportReal(o2, prog2)).then(endL, endE);
  };
  /* MCP primero: si una IA cambia el proyecto (segmentos, materiales, código), el editor junta el cambio con lo tuyo */
  setInterval(function () {
    var p = VE.open && VE.p && VE.p._real ? VE.p : null;
    if (!p || busy || timer && VE._pend || VE.playing || window.__veUnsaved || ptrDown) return;
    /* con el cursor en el Inspector o recién editado: solo se junta un cambio con revisión nueva (no se recarga nada:
       el campo que escribes sigue igual, QA Instinct bug 7) */
    var ae = document.activeElement, editing = !!(ae && ae.closest && ae.closest("#veInsp,.ve-insp,#veLiveCode")) || !!(p._real.editAt && Date.now() - p._real.editAt < 20000);
    Promise.all([
      api("/rest/v1/musa_video_projects?id=eq." + encodeURIComponent(p._real.id) + "&select=updated_at"),
      api("/rest/v1/video_editor_state?project_id=eq." + encodeURIComponent(p._real.id) + "&select=rev:state->>rev,pending:state->>pending").catch(function () { return null; })
    ]).then(function (rr) {
      var r = rr[0], row = rr[1] && rr[1][0], at = r && r[0] && r[0].updated_at;
      if (VE.p !== p || busy) return;
      /* el estado cambió de revisión: lo escribió otro (MCP, otra pestaña). Se junta con lo de aquí (nada se pierde) */
      if (rr[1] && (row ? (p._real.hasRow === false || (row.rev || null) !== p._real.rev) : false)) {
        if (row.pending && Date.now() - +row.pending < 15000 && !(p._real.myPend && +row.pending === +p._real.myPend)) return;
        if (ptrDown || VE._pend) return;
        busy = true;
        mergeRemote(p, "poll").catch(function () { /* el próximo ciclo */ }).then(function () { busy = false; if (again) { again = false; schedule(); } });
        return;
      }
      if (editing || !at || !p._real.remoteAt || at === p._real.remoteAt || VE.p !== p || busy) return;
      /* si el cambio lo hizo NUESTRO autosave (aún sin leer su updated_at), no es externo: adoptar y no re-abrir.
         Ya leído, cualquier otro cambio es de afuera (MCP) aunque el autosave haya sido hace poco: antes se adoptaba
         en silencio durante 12 s y el siguiente autosave pisaba lo que había hecho la IA. */
      if (p._real.savedAt && Date.now() - p._real.savedAt < 12000 && !(p._real.remoteSync >= p._real.savedAt)) { p._real.remoteAt = at; return; }
      p._real.remoteAt = at;
      busy = true;
      mergeRemote(p, "poll").catch(function () { /* el próximo ciclo */ }).then(function () { busy = false; if (again) { again = false; schedule(); } });
    }, function () {});
  }, 5000);

  /* ── abrir un proyecto real ── */
  function realTakes() {
    if (RB._vtk) return; RB._vtk = true;
    for (var i = VTAKES.length - 1; i >= 0; i--) if (!VTAKES[i].blob || /^blob:/.test(VTAKES[i].blob) === false && !VTAKES[i]._mat && !VTAKES[i]._asset) VTAKES.splice(i, 1);
    (RB.assets || []).filter(function (a) { return /^video/.test(a.mime_type || "") && a.url; }).forEach(function (a) {
      if (!VTAKES.some(function (t) { return t.blob === a.url; })) VTAKES.push({ name: a.name || "Video", src: "Tus archivos", dur: 10, bg: "#000", blob: a.url, _asset: a.id });
    });
  }
  RB.openVideo = function (id, idx) {
    realTakes();
    vtoast && vtoast("Abriendo video…");
    /* el mismo proyecto ya abierto con cambios por guardar: se mandan antes de leerlo de nuevo */
    if (VE.p && VE.p._real && VE.p._real.id === id && VE._pend && !busy) { clearTimeout(timer); VE._pend = false; sync(); }
    return fetchProject(id).then(function (f) {
      var p = f.p, st = f.st, key = "videos/" + idx;
      if (st) p._real.stateSig = null;
      /* otras copias de este proyecto en memoria quedan retiradas y ya no guardan (antes una copia vieja podía
         escribir su foto encima de la nueva) */
      Object.keys(VE_DOCS).forEach(function (k) { var d = VE_DOCS[k]; if (d && d !== p && d._real && d._real.id === id) { d._real.retired = true; if (k !== key) delete VE_DOCS[k]; } });
      VE_DOCS[key] = p;
      p._real.idx = idx;
      if (location.hash === "#crear/videos/" + idx) { if (VE.open && VE.key === key) { VE.p = p; VE.hist = []; VE.fut = []; veBin(); veInsp(); veAll(); } else if (typeof veSync === "function") veSync(); }
      else location.hash = "crear/videos/" + idx;
      setTimeout(function () { saveUi(saveSt); }, 600);
      if (p._real.resync) setTimeout(function () { if (VE.open && VE.p && VE.p._real && VE.p._real.id === p._real.id) { vtoast("Se recuperó tu último guardado completo: lo termino de guardar"); VE.p._real.stateSig = null; clearTimeout(timer); VE._pend = false; sync(); } }, 1500);
    }).catch(function (e) { if (typeof uiToast === "function") uiToast("No se pudo abrir el video: " + (e && e.message)); });
  };
  /* miniatura del primer instante de cada proyecto */
  RB.videoThumb = function (id, el) {
    api("/api/video-projects/" + encodeURIComponent(id) + "?workspaceId=" + encodeURIComponent(RB.ws)).then(function (x) {
      var p = build(x.data); el.innerHTML = stageMini(p, Math.min(0.5, veDur(p) / 2), [el.clientWidth - 28, el.clientHeight - 28]);
      el.querySelectorAll("canvas[data-vid]").forEach(function (c) {
        var cl = p.v1.find(function (y) { return y.id === c.dataset.vid; }), tk = cl && VTAKES[cl.take];
        if (!tk || !tk.blob) return;
        var v = document.createElement("video"); v.src = tk.blob; v.muted = true; v.preload = "auto"; v.crossOrigin = "anonymous";
        v.onloadeddata = function () { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); };
        v.onseeked = function () { var g = c.getContext("2d"), s = (cl.fit === "contain" ? Math.min : Math.max)(c.width / v.videoWidth, c.height / v.videoHeight); g.clearRect(0, 0, c.width, c.height); g.drawImage(v, (c.width - v.videoWidth * s) / 2, (c.height - v.videoHeight * s) / 2, v.videoWidth * s, v.videoHeight * s); };
      });
    }, function () {});
  };

  /* Editor › «Editor de video» desde un diseño: crea un proyecto real con cada frame como escena */
  RB.videoFromDesignShots = function (doc) {
    var f0 = doc.frames[0]; if (!f0) return;
    var ar = f0.w / f0.h, fmt = Object.keys(VFMT).sort(function (a, b) { return Math.abs(VFMT[a][0] / VFMT[a][1] - ar) - Math.abs(VFMT[b][0] / VFMT[b][1] - ar); })[0];
    toast("Creando el video desde «" + doc.name + "»…");
    var pid, q = function () { return "?workspaceId=" + encodeURIComponent(RB.ws); };
    api("/api/video-projects", json("POST", { workspaceId: RB.ws, name: doc.name + " · video", ratio: fmt, canvasW: VFMT[fmt][0], canvasH: VFMT[fmt][1], fps: 30 }))
      .then(function (x) { pid = x.data.project.id; return api("/api/video-projects/" + pid + q()); })
      .then(function (x) {
        var vt = ((x.data.tracks || []).find(function (t) { return t.type === "video"; }) || {}).id;
        return (vt ? Promise.resolve(vt) : api("/api/video-projects/" + pid + "/tracks" + q(), json("POST", { type: "video" })).then(function (y) { return y.data.track.id; })).then(function (track) {
          return doc.frames.reduce(function (pr, f, i) {
            return pr.then(function () {
              return RB.shotFrame(f).then(function (data) { return upload(data, f.name); })
                .then(function (url) { return api("/api/video-projects/" + pid + "/materials" + q(), json("POST", { kind: "image", payload: { url: url, name: f.name } })); })
                .then(function (m) { return api("/api/video-projects/" + pid + "/segments" + q(), json("POST", { trackId: track, materialId: m.data.material.id, targetStartUs: i * 3 * US, targetDurUs: 3 * US, sourceStartUs: 0, sourceDurUs: 3 * US, speed: 1 })); })
                .then(function () { toast("Escena " + (i + 1) + " de " + doc.frames.length + " lista"); });
            });
          }, Promise.resolve());
        });
      })
      .then(function () {
        var R = RB; R.vids = R.vids || []; R.vids.unshift({ id: pid, name: doc.name + " · video", ratio: fmt, duration_us: doc.frames.length * 3 * US });
        TILES["crear/videos"].unshift([eesc(doc.name + " · video"), eesc(doc.brand && doc.brand !== "Sin marca" ? doc.brand : "Sin marca"), Math.floor(doc.frames.length * 3 / 60) + ":" + String(doc.frames.length * 3 % 60).padStart(2, "0")]);
        Object.keys(VE_DOCS).forEach(function (k) { if (/^videos\//.test(k)) delete VE_DOCS[k]; });
        return RB.openVideo(pid, 0);
      })
      .catch(function (e) { toast("No se pudo crear el video: " + (e && e.message || "error")); });
  };


  /* ═════ Diseño → video, capa por capa (editable) ═════
     Antes: cada frame se fotografiaba (html2canvas), se subía y entraba como UNA escena en V1: lento, sin
     fuentes, con textos perdidos y recortado al formato más cercano. Ahora cada capa del diseño pasa como lo
     que es: texto → pista T (fuente, tamaño, color y posición reales, línea por línea si va alineado a un lado),
     imagen → M con su archivo, vector → M (el SVG se sube tal cual), forma de color → forma de M. Lo que no tiene
     equivalente (degradados recortados, filtros…) va a una sola imagen de fondo por frame, debajo. El video
     usa el tamaño exacto del diseño y se crea en una sola llamada (motion spec). Cada frame dura 3 s. */
  var SECS_PER_FRAME = 3;
  function d2vColor(c) { return !c || /^(transparent|rgba\(0, 0, 0, 0\))$/.test(c) ? null : c; }
  function d2vRotation(el) {
    var t = getComputedStyle(el).transform; if (!t || t === "none") return 0;
    var m = t.match(/matrix\(([^)]+)\)/); if (!m) return 0;
    var v = m[1].split(",").map(Number); return Math.round(Math.atan2(v[1], v[0]) * 180 / Math.PI * 10) / 10;
  }
  function d2vOpacity(el, stop) { var o = 1; for (var n = el; n && n !== stop; n = n.parentElement) o *= +getComputedStyle(n).opacity || 0; return Math.round(o * 1000) / 1000; }
  function d2vHidden(el, stop) {
    for (var n = el; n && n !== stop; n = n.parentElement) { var c = getComputedStyle(n); if (c.display === "none" || c.visibility === "hidden" || +c.opacity === 0) return true; }
    return false;
  }
  var INLINE = /^(SPAN|B|STRONG|I|EM|U|S|SMALL|SUP|SUB|BR|A|MARK|CODE|FONT)$/;
  function d2vTextish(el) { return !!(el.innerText || "").trim() && [].every.call(el.querySelectorAll("*"), function (k) { return INLINE.test(k.tagName); }); }
  /* líneas visibles del texto (el ajuste de línea del diseño), con su caja */
  function d2vLines(el) {
    var lines = [], tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), node, rg = document.createRange();
    while ((node = tw.nextNode())) {
      var s = node.textContent, re = /\S+/g, m;
      while ((m = re.exec(s))) {
        rg.setStart(node, m.index); rg.setEnd(node, m.index + m[0].length);
        var rs = rg.getClientRects(); if (!rs.length) continue;
        var r = rs[0], L = lines[lines.length - 1];
        if (!L || r.top > L.bottom - r.height * 0.4) lines.push(L = { words: [], left: r.left, right: r.right, top: r.top, bottom: r.bottom });
        L.words.push(m[0]); L.left = Math.min(L.left, r.left); L.right = Math.max(L.right, r.right); L.top = Math.min(L.top, r.top); L.bottom = Math.max(L.bottom, r.bottom);
      }
    }
    return lines;
  }
  function d2vSvg(el) {
    var svg = el.tagName.toLowerCase() === "svg" ? el : el.querySelector("svg");
    var c = svg.cloneNode(true), src = [svg].concat([].slice.call(svg.querySelectorAll("*"))), dst = [c].concat([].slice.call(c.querySelectorAll("*")));
    /* el color que viene del CSS del diseño queda escrito en el SVG (si no, el archivo sale negro) */
    src.forEach(function (n, i) { var d = dst[i]; if (!d || !d.setAttribute) return; var cs = getComputedStyle(n); ["fill", "stroke", "stroke-width", "opacity", "fill-opacity", "stroke-opacity", "fill-rule"].forEach(function (p) { var v = cs.getPropertyValue(p); if (v && !(p === "opacity" && v === "1")) d.setAttribute(p, v); }); });
    var r = svg.getBoundingClientRect();
    if (!c.getAttribute("viewBox")) c.setAttribute("viewBox", "0 0 " + (svg.width.baseVal.value || r.width) + " " + (svg.height.baseVal.value || r.height));
    c.setAttribute("xmlns", "http://www.w3.org/2000/svg"); c.setAttribute("width", Math.round(svg.width.baseVal.value || r.width)); c.setAttribute("height", Math.round(svg.height.baseVal.value || r.height));
    c.removeAttribute("style"); c.removeAttribute("class");
    return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(c))));
  }
  /* caja con degradado y/o recorte (clip-path) → SVG equivalente: queda como vector editable, sin foto */
  function splitTop(str) { var out = [], d = 0, cur = ""; for (var i = 0; i < str.length; i++) { var ch = str[i]; if (ch === "(") d++; if (ch === ")") d--; if (ch === "," && !d) { out.push(cur.trim()); cur = ""; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; }
  function boxToSvg(el) {
    var cs = getComputedStyle(el), w = el.offsetWidth, h = el.offsetHeight; if (!w || !h) return null;
    if (cs.filter && cs.filter !== "none" || cs.boxShadow && cs.boxShadow !== "none" || /url\(/.test(cs.backgroundImage || "")) return null;
    var defs = "", fill = d2vColor(cs.backgroundColor) || "none", bi = cs.backgroundImage || "none";
    if (bi !== "none") {
      var m = /^(linear|radial)-gradient\((.*)\)$/.exec(bi.trim()); if (!m || splitTop(bi).length > 1 && !/^(linear|radial)-gradient\(/.test(bi)) return null;
      var parts = splitTop(m[2]), first = parts[0], ang = 180, stops;
      if (m[1] === "linear") {
        var dm = /^(-?[\d.]+)deg$/.exec(first), to = /^to (.+)$/.exec(first);
        if (dm) { ang = +dm[1]; parts.shift(); } else if (to) { ang = { top: 0, right: 90, bottom: 180, left: 270, "top right": 45, "right top": 45, "bottom right": 135, "right bottom": 135, "bottom left": 225, "left bottom": 225, "top left": 315, "left top": 315 }[to[1]]; if (ang == null) return null; parts.shift(); }
      } else if (!/^(rgb|#|hsl|transparent)/.test(first)) parts.shift();
      stops = parts.map(function (st, i) { var mm = /^(.*?\))\s*([\d.]+%)?$/.exec(st) || /^(\S+)\s*([\d.]+%)?$/.exec(st); if (!mm) return null; return { c: mm[1], o: mm[2] || (Math.round(i / Math.max(1, parts.length - 1) * 1000) / 10 + "%") }; });
      if (stops.some(function (x) { return !x; })) return null;
      var st = stops.map(function (x) { return '<stop offset="' + x.o + '" stop-color="' + x.c + '"/>'; }).join("");
      if (m[1] === "linear") {
        var a = ang * Math.PI / 180, L = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a)), cx = w / 2, cy = h / 2, dx = Math.sin(a) * L / 2, dy = -Math.cos(a) * L / 2;
        defs += '<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="' + (cx - dx) + '" y1="' + (cy - dy) + '" x2="' + (cx + dx) + '" y2="' + (cy + dy) + '">' + st + "</linearGradient>";
      } else defs += '<radialGradient id="g" gradientUnits="userSpaceOnUse" cx="' + w / 2 + '" cy="' + h / 2 + '" r="' + Math.sqrt(w * w + h * h) / 2 + '">' + st + "</radialGradient>";
      if (fill !== "none") defs += ""; fill = "url(#g)";
    }
    var base = d2vColor(cs.backgroundColor) && bi !== "none" ? '<rect width="' + w + '" height="' + h + '" fill="' + cs.backgroundColor + '"/>' : "";
    var rx = parseFloat(cs.borderTopLeftRadius) || 0, shape = '<rect width="' + w + '" height="' + h + '" rx="' + Math.min(rx, w / 2, h / 2) + '" fill="' + fill + '"/>', clipAttr = "";
    var cp = cs.clipPath && cs.clipPath !== "none" ? cs.clipPath : "";
    if (cp) {
      var pm = /^polygon\((.*)\)$/.exec(cp), Lp = function (t, ref) { t = String(t).trim(); return /%$/.test(t) ? parseFloat(t) / 100 * ref : parseFloat(t) || 0; };
      if (!pm) return null;
      var pts = pm[1].replace(/^(nonzero|evenodd)\s*,/, "").split(",").map(function (q) { var v = q.trim().split(/\s+/); return Lp(v[0], w) + "," + Lp(v[1], h); }).join(" ");
      defs += '<clipPath id="c"><polygon points="' + pts + '"/></clipPath>'; clipAttr = ' clip-path="url(#c)"';
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '"><defs>' + defs + "</defs><g" + clipAttr + ">" + base + shape + "</g></svg>";
    return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
  }
  function designToSpec(doc) {
    var f0 = doc.frames[0], W = Math.round(f0.w), H = Math.round(f0.h), nodes = [], uploads = [], rasters = [], conv = new Set();
    doc.frames.forEach(function (f, fi) {
      var root = f._root; if (!root) return;
      var t0 = fi * SECS_PER_FRAME * 1000, t1 = t0 + SECS_PER_FRAME * 1000;
      var rr = (f._content || root).getBoundingClientRect(), k = rr.width / (f.w || W) || 1, sx = W / (f.w || W), sy = H / (f.h || H);
      var box = function (r) { return { x: ((r.left + r.right) / 2 - rr.left) / k * sx, y: ((r.top + r.bottom) / 2 - rr.top) / k * sy, w: r.width / k * sx, h: r.height / k * sy }; };
      var bg = d2vColor(f.bg) || d2vColor(getComputedStyle(f._content || root).backgroundColor) || "#ffffff";
      nodes.push({ id: "f" + fi + "_fondo", type: "shape", name: (f.name || "Frame " + (fi + 1)) + " · fondo", startMs: t0, endMs: t1, props: { x: W / 2, y: H / 2, width: W, height: H, backgroundColor: bg } });
      var done = new Set(), complex = [], n = 0, startAt = nodes.length, elOf = new Map(), cpush = complex.push, zAt = null;
      /* el arte no editable va a la altura de la primera capa que representa (no al fondo: lo tapaban las formas) */
      complex.push = function () { if (zAt == null) zAt = nodes.length; return cpush.apply(complex, arguments); };
      var all = [].slice.call((f._content || root).querySelectorAll("*")), curEl = null;
      /* cada capa no textual recuerda de qué elemento salió (para pasarla al fondo si el frame tiene demasiadas) */
      nodes.push = function (x) { if (x && x.type !== "text" && curEl) elOf.set(x.id, curEl); return Array.prototype.push.apply(this, arguments); };
      all.forEach(function (el) {
        if (done.has(el) || el.closest("svg") && el.tagName.toLowerCase() !== "svg" || /^(STYLE|SCRIPT|BR|DEFS|TITLE)$/i.test(el.tagName)) return;
        var anc = el.parentElement; while (anc && anc !== root) { if (done.has(anc)) return; anc = anc.parentElement; }
        if (d2vHidden(el, root)) { done.add(el); return; }
        var cs = getComputedStyle(el), r = el.getBoundingClientRect(); if (r.width < 0.5 || r.height < 0.5) return;
        var id = "f" + fi + "_" + (++n), nm = el.getAttribute("data-layer-name") || el.id || el.tagName.toLowerCase(), op = d2vOpacity(el, root), rot = d2vRotation(el);
        var clip = cs.clipPath && cs.clipPath !== "none", fx = cs.filter && cs.filter !== "none", grad = /gradient\(/.test(cs.backgroundImage || ""), url = (/url\(["']?([^"')]+)["']?\)/.exec(cs.backgroundImage || "") || [])[1];
        var tag = el.tagName.toLowerCase(); curEl = el;
        if (tag === "img") {
          var src = el.currentSrc || el.getAttribute("src") || ""; if (!src) return;
          var b = box(r), node = { id: id, type: "image", name: nm, startMs: t0, endMs: t1, props: { x: b.x, y: b.y, width: b.w, height: b.h, opacity: op, rotation: rot }, src: src };
          if (clip || fx) { complex.push(el); done.add(el); return; }
          if (/^data:/.test(src)) uploads.push({ node: node, data: src });
          nodes.push(node); done.add(el); conv.add(el); return;
        }
        if (tag === "svg" || (el.children.length === 1 && el.firstElementChild.tagName.toLowerCase() === "svg" && !(el.innerText || "").trim() && !d2vColor(cs.backgroundColor))) {
          if (clip || fx) { complex.push(el); done.add(el); [].forEach.call(el.querySelectorAll("*"), function (x) { done.add(x); }); return; }
          var bs = box((tag === "svg" ? el : el.firstElementChild).getBoundingClientRect()), sn = { id: id, type: "image", name: nm, startMs: t0, endMs: t1, props: { x: bs.x, y: bs.y, width: bs.w, height: bs.h, opacity: op, rotation: rot } };
          try { var sv = d2vSvg(el); if (sv.length <= 38000) sn.src = sv; else uploads.push({ node: sn, data: sv }); nodes.push(sn); conv.add(el); } catch (e) { complex.push(el); }
          done.add(el); [].forEach.call(el.querySelectorAll("*"), function (x) { done.add(x); }); return;
        }
        /* fondo propio de la caja: color → forma; imagen → imagen; degradado/recorte/filtro → al fondo rasterizado */
        var hasBox = d2vColor(cs.backgroundColor) || url || grad || (parseFloat(cs.borderTopWidth) > 0 && d2vColor(cs.borderTopColor));
        if (hasBox) {
          var bb = box(r);
          var vsv = (clip || grad) && !fx ? boxToSvg(el) : null;
          if (vsv) { var vn = { id: id + "b", type: "image", name: nm, startMs: t0, endMs: t1, props: { x: bb.x, y: bb.y, width: el.offsetWidth * sx, height: el.offsetHeight * sy, opacity: op, rotation: rot } }; if (vsv.length <= 38000) vn.src = vsv; else uploads.push({ node: vn, data: vsv }); nodes.push(vn); }
          else if (clip || fx || grad || (cs.boxShadow && cs.boxShadow !== "none" && !d2vTextish(el))) complex.push(el);
          else if (url) nodes.push({ id: id + "b", type: "image", name: nm, startMs: t0, endMs: t1, props: { x: bb.x, y: bb.y, width: el.offsetWidth * sx, height: el.offsetHeight * sy, opacity: op, rotation: rot }, src: url });
          else if (d2vColor(cs.backgroundColor)) {
            var rad = parseFloat(cs.borderTopLeftRadius) || 0, ow = el.offsetWidth, oh = el.offsetHeight;
            if (/%/.test(cs.borderTopLeftRadius)) rad = parseFloat(cs.borderTopLeftRadius) / 100 * Math.min(ow, oh);
            nodes.push({ id: id + "b", type: "shape", name: nm, startMs: t0, endMs: t1, props: { x: bb.x, y: bb.y, width: ow * sx, height: oh * sy, backgroundColor: cs.backgroundColor, borderRadius: Math.min(rad, Math.min(ow, oh) / 2) * sx, opacity: op, rotation: rot } });
          } else complex.push(el);
        }
        if (d2vTextish(el)) {
          if (clip || fx || /gradient|url/.test(cs.backgroundImage || "") && cs.webkitBackgroundClip === "text") { complex.push(el); done.add(el); return; }
          var lines = d2vLines(el); if (!lines.length) return;
          var tt = cs.textTransform, txt = function (s) { return tt === "uppercase" ? s.toUpperCase() : tt === "lowercase" ? s.toLowerCase() : s; };
          var size = parseFloat(cs.fontSize) * sy, fam = (cs.fontFamily || "Inter").split(",")[0].replace(/["']/g, "").trim();
          var tp = { fontSize: Math.round(size * 10) / 10, fontFamily: fam, fontWeight: +cs.fontWeight || 400, color: cs.color, opacity: op, rotation: rot };
          if (cs.letterSpacing && cs.letterSpacing !== "normal" && parseFloat(cs.letterSpacing)) tp.letterSpacing = Math.round(parseFloat(cs.letterSpacing) * sy * 10) / 10;
          if (/italic|oblique/.test(cs.fontStyle)) tp.fontStyle = "italic";
          var centered = /center/.test(cs.textAlign) || lines.length === 1;
          if (centered) {
            var ub = { left: Math.min.apply(null, lines.map(function (l) { return l.left; })), right: Math.max.apply(null, lines.map(function (l) { return l.right; })), top: lines[0].top, bottom: lines[lines.length - 1].bottom };
            ub.width = ub.right - ub.left; ub.height = ub.bottom - ub.top;
            var tb = box(ub);
            nodes.push({ id: id, type: "text", name: nm, text: txt(lines.map(function (l) { return l.words.join(" "); }).join("\n")), startMs: t0, endMs: t1, props: Object.assign({ x: tb.x, y: tb.y }, tp) });
          } else lines.forEach(function (l, li) {
            var lb = box({ left: l.left, right: l.right, top: l.top, bottom: l.bottom, width: l.right - l.left, height: l.bottom - l.top });
            nodes.push({ id: id + "_l" + li, type: "text", name: nm + (lines.length > 1 ? " · línea " + (li + 1) : ""), text: txt(l.words.join(" ")), startMs: t0, endMs: t1, props: Object.assign({ x: lb.x, y: lb.y }, tp) });
          });
          done.add(el); conv.add(el); [].forEach.call(el.querySelectorAll("*"), function (x) { done.add(x); });
        }
      });
      delete nodes.push;
      /* más de 120 capas en un frame: las formas e imágenes de más abajo pasan a la imagen de fondo (los textos siguen editables) */
      var mine = nodes.slice(startAt + 1), extra = mine.length - 120;
      if (extra > 0) {
        var drop = mine.filter(function (x) { return x.type !== "text" && elOf.has(x.id); }).slice(0, extra);
        drop.forEach(function (x) { var el = elOf.get(x.id); complex.push(el); conv.delete(el); nodes.splice(nodes.indexOf(x), 1); var ui = uploads.findIndex(function (u) { return u.node === x; }); if (ui >= 0) uploads.splice(ui, 1); });
      }
      if (complex.length) rasters.push({ f: f, fi: fi, els: complex, t0: t0, t1: t1, conv: conv, after: zAt != null && zAt > 0 ? nodes[Math.min(zAt, nodes.length) - 1] : null });
    });
    return { W: W, H: H, nodes: nodes, uploads: uploads, rasters: rasters };
  }
  /* lo que no se puede volver capa editable: una sola imagen por frame con SOLO esas capas (lo demás oculto) */
  function rasterComplex(job) {
    /* se trabaja sobre una COPIA del frame: antes se ocultaban capas en el diseño vivo y el autoguardado alcanzaba
       a guardar el diseño con sus capas ocultas */
    var f = job.f, root = f._root, keep = new Set();
    job.els.forEach(function (el) { keep.add(el); [].forEach.call(el.querySelectorAll("*"), function (x) { keep.add(x); }); for (var a = el.parentElement; a && a !== root; a = a.parentElement) keep.add(a); });
    var live = [].slice.call(root.querySelectorAll("*")), plan = live.map(function (el) {
      if (/^(STYLE|SCRIPT)$/i.test(el.tagName)) return 0;
      if (!keep.has(el) || job.conv.has(el)) return 1;                       /* ocultar */
      var inComplex = job.els.some(function (c) { return c === el || c.contains(el); });
      return inComplex ? 0 : 2;                                               /* 2 = contenedor: sin su fondo */
    });
    return RB.shotFramePng(f, function (clone) {
      var all = clone.querySelectorAll("*");
      plan.forEach(function (k, i) { var el = all[i]; if (!el || !k) return; if (k === 1) el.style.visibility = "hidden"; else el.style.background = "transparent"; });
    }, null);
  }
  RB._d2v = { spec: function (d) { return designToSpec(d); }, raster: function (j) { return rasterComplex(j); } };
  RB.videoFromDesign = function (doc) {
    if (!doc || !doc.frames || !doc.frames.length) return;
    if (ED && ED.open && ED.doc === doc && typeof edRender === "function") edRender();
    var t0 = performance.now(), sp;
    try { sp = designToSpec(doc); } catch (e) { return toast("No se pudo leer el diseño: " + (e && e.message || e)); }
    var name = doc.name + " · video", pg = RB.progress ? RB.progress("Pasando el diseño al editor de video", "Leyendo " + sp.nodes.length + " capas…") : null;
    var set = function (pc, msg) { if (pg) pg.set(pc, msg); };
    var up = function (data, nm) { return api("/api/assets/upload", json("POST", { name: (nm || "capa") + (/svg/.test(data.slice(0, 30)) ? ".svg" : ".png"), data: data, workspaceId: RB.ws })).then(function (x) { var a = x.data || x.asset || x; return a.url || (a.asset && a.asset.url); }); };
    /* subidas en paralelo (de a 6) */
    var jobs = sp.uploads.map(function (u) { return function () { return up(u.data, u.node.name).then(function (url) { u.node.src = url; }, function () { u.node._drop = true; }); }; });
    var run = function (list, n) { var i = 0, next = function () { if (i >= list.length) return Promise.resolve(); var f = list[i++]; return f().then(next); }; var ws = []; for (var k = 0; k < Math.min(n, list.length); k++) ws.push(next()); return Promise.all(ws); };
    set(10, sp.uploads.length ? "Subiendo " + sp.uploads.length + " vectores e imágenes…" : "Armando el video…");
    if (sp.rasters.length) set(10, "Subiendo capas y copiando lo que no es editable (filtros, sombras)…");
    Promise.all([run(jobs, 8), Promise.resolve().then(function () {
      if (!sp.rasters.length) return;
      return sp.rasters.reduce(function (pr, r) {
        return pr.then(function () { return rasterComplex(r).then(function (d) { return up(d, "fondo " + (r.fi + 1)); }).then(function (url) {
          var at = r.after ? sp.nodes.indexOf(r.after) : -1; if (at < 0) at = sp.nodes.findIndex(function (x) { return x.id === "f" + r.fi + "_fondo"; });
          sp.nodes.splice(at + 1, 0, { id: "f" + r.fi + "_arte", type: "image", name: (r.f.name || "Frame") + " · arte sin capas", startMs: r.t0, endMs: r.t1, props: { x: sp.W / 2, y: sp.H / 2, width: sp.W, height: sp.H }, src: url });
        }, function (e) { console.warn("[diseño→video] fondo no editable", e); }); });
      }, Promise.resolve());
    })]).then(function () {
      set(75, "Creando el video…");
      var manifest = { name: name, width: sp.W, height: sp.H, fps: 30, durationMs: doc.frames.length * SECS_PER_FRAME * 1000, backgroundColor: (sp.nodes[0] && sp.nodes[0].props.backgroundColor) || "#ffffff", nodes: sp.nodes.filter(function (x) { return !x._drop && (x.type !== "image" || x.src); }) };
      return RB.mcp("motion_source_convert", { workspaceId: RB.ws, sourceKind: "hyperframes-subset", source: manifest });
    }).then(function (c) {
      if (!c || !c.valid) throw new Error((c && c.issues && c.issues[0] && c.issues[0].message) || "no se pudo armar el video");
      return RB.mcp("motion_project_create_from_spec", { workspaceId: RB.ws, spec: c.spec, sourceKind: "hyperframes-subset", name: name });
    }).then(function (res) {
      var pid = res && res.project && res.project.id; if (!pid) throw new Error("el servidor no devolvió el video");
      if (pg) pg.close();
      var R = RB; R.vids = R.vids || []; R.vids.unshift({ id: pid, name: name, ratio: res.project.ratio, duration_us: doc.frames.length * SECS_PER_FRAME * US });
      TILES["crear/videos"].unshift([eesc(name), eesc(doc.brand && doc.brand !== "Sin marca" ? doc.brand : "Sin marca"), Math.floor(doc.frames.length * SECS_PER_FRAME / 60) + ":" + String(doc.frames.length * SECS_PER_FRAME % 60).padStart(2, "0")]);
      Object.keys(VE_DOCS).forEach(function (k) { if (/^videos\//.test(k)) delete VE_DOCS[k]; });
      var u = res.result && res.result.fidelity && res.result.fidelity.unsupported || [];
      toast("Video listo en " + Math.round((performance.now() - t0) / 100) / 10 + " s: " + sp.nodes.length + " capas editables" + (u.length ? " · " + u.length + " no pasaron" : ""));
      return RB.openVideo(pid, 0);
    }).catch(function (e) { if (pg) pg.close(); toast("No se pudo crear el video: " + (e && e.message || "error")); });
  };
  /* ═════ Editor de fotos → video: la foto revelada (con sus capas y su transparencia: un calado queda calado) entra
     como clip de Media en un video nuevo o en uno que ya tienes. Antes el menú «Editor de video» del editor de fotos
     abría una vista de muestra que no se guardaba. ═════ */
  function waitVideo(pid) {
    return new Promise(function (res, rej) {
      var n = 0, iv = setInterval(function () {
        if (typeof VE !== "undefined" && VE.open && VE.p && VE.p._real && VE.p._real.id === pid) { clearInterval(iv); res(); }
        else if (++n > 240) { clearInterval(iv); rej(new Error("el video no abrió")); }
      }, 125);
    });
  }
  function ratioFor(ar) { return ar >= 1.25 ? "16:9" : ar <= 0.8 ? "9:16" : "1:1"; }
  RB.photoToVideo = function (o) {
    o = o || {};
    var cv = o.canvas; if (!cv || !cv.width) return Promise.resolve(toast("No hay foto para llevar al video"));
    var name = String(o.name || "Foto").replace(/\.[a-z0-9]{2,4}$/i, "").slice(0, 60) || "Foto", ar = cv.width / cv.height;
    var vids = (RB.vids || []).slice(0, 8);
    var choices = [{ value: "__new", label: "Video nuevo (" + ratioFor(ar) + ")" }].concat(vids.map(function (v) { return { value: v.id, label: v.name || "Video" }; }));
    return (RB.choose ? RB.choose("¿A qué video llevo «" + name + "»?", choices, { title: "Llevar la foto al editor de video" }) : Promise.resolve("__new")).then(function (pick) {
      if (!pick) return;
      var pg = RB.progress ? RB.progress("Llevando la foto al video", "Subiendo la imagen…") : null, set = function (pc, m) { if (pg) pg.set(pc, m); };
      var data = cv.toDataURL("image/png"), pid = pick === "__new" ? null : pick;
      return api("/api/assets/upload", json("POST", { name: name + ".png", data: data, workspaceId: RB.ws })).then(function (x) {
        var a = x.data || x.asset || x, url = a.url || (a.asset && a.asset.url); if (!url) throw new Error("no se pudo subir la imagen");
        if (RB.assets && a && a.id) RB.assets.unshift(a.asset || a);
        if (pid) return url;
        set(45, "Creando el video…");
        var fmt = ratioFor(ar);
        return api("/api/video-projects", json("POST", { workspaceId: RB.ws, name: name + " · video", ratio: fmt, canvasW: VFMT[fmt][0], canvasH: VFMT[fmt][1], fps: 30 })).then(function (y) {
          pid = y.data.project.id; RB.vids = RB.vids || []; RB.vids.unshift({ id: pid, name: name + " · video", ratio: fmt, duration_us: 0 });
          Object.keys(VE_DOCS).forEach(function (k) { if (/^videos\//.test(k)) delete VE_DOCS[k]; });
          return url;
        });
      }).then(function (url) {
        set(70, "Abriendo el video…");
        var idx = (RB.vids || []).findIndex(function (v) { return v.id === pid; });
        return Promise.resolve(RB.openVideo(pid, idx < 0 ? 0 : idx)).then(function () { return waitVideo(pid); }).then(function () {
          var p = VE.p, W = VFMT[p.fmt][0], H = VFMT[p.fmt][1], A = W / H;
          /* entra entera en el lienzo (sin recortar), en el playhead */
          var w = Math.round((ar >= A ? 100 : 100 * ar / A) * 100) / 100;
          if (typeof vsnap === "function") vsnap();
          p.m.push({ id: nid(), name: name, bg: "url('" + url + "') center/contain no-repeat", start: Math.round(VE.t * 100) / 100, dur: 4, x: 50, y: 50, w: w, ar: Math.round(ar * 1e4) / 1e4, radius: 0, opacity: 1, anim: "fade" });
          VE.sel = { tr: "m", i: p.m.length - 1 }; veAll(); veInsp();
          if (pg) pg.close();
          toast("«" + name + "» quedó en Media (M) a las " + fmtT(VE.t) + (o.alpha ? " · con su transparencia" : "") + ": muévela, agrándala o anímala como cualquier clip");
        });
      }).catch(function (e) { if (pg) pg.close(); toast("No se pudo llevar la foto al video: " + (e && e.message || "error")); });
    });
  };
  /* el menú «Editor de video» del editor de fotos: la foto revelada, o el diseño entero si la foto es de un diseño */
  if (typeof PH_MENUS !== "undefined" && PH_MENUS.editor) {
    var _phEd = PH_MENUS.editor;
    PH_MENUS.editor = function () {
      var it = _phEd();
      var doc = typeof ED_DOCS !== "undefined" && PH && ED_DOCS[PH.fi], real = doc && doc._real;
      var hasAlpha = function (cv) { try { var g = cv.getContext("2d"), d = g.getImageData(0, 0, cv.width, cv.height).data; for (var i = 3; i < d.length; i += 4 * 97) if (d[i] < 250) return true; } catch (e) { /* sin lectura */ } return false; };
      var out = [];
      it.forEach(function (x) {
        if (!x || x.l !== "Editor de video") { out.push(x); return; }
        out.push({ l: "Llevar esta foto a un video", d: "Con tus ajustes y capas; un calado queda transparente", fn: function () {
          var cv = phFlatten(2048);
          RB.photoToVideo({ canvas: cv, name: (PH.t && PH.t.name) || "Foto", alpha: hasAlpha(cv) });
        } });
        if (real) out.push({ l: "Pasar el diseño entero a video", d: "Cada frame es una escena con sus capas editables", fn: function () {
          var n = 0, iv = setInterval(function () {
            if (typeof ED !== "undefined" && ED.open && ED.doc && ED.doc._id === doc._id) { clearInterval(iv); setTimeout(function () { RB.videoFromDesign(ED.doc); }, 600); }
            else if (++n > 120) { clearInterval(iv); toast("No se pudo abrir el diseño"); }
          }, 125);
          if (RB.openDesign) RB.openDesign(doc._id);
        } });
      });
      return out;
    };
  }

  /* recargar: el video abierto se recuerda por su id */
  var prevStable = RB.stableHashExtra;
  RB.stableHashExtra = function (h) {
    var m = h.match(/^#crear\/videos\/(\d+)$/);
    if (m && VE_DOCS["videos/" + m[1]] && VE_DOCS["videos/" + m[1]]._real) return "#crear/videos/vid:" + VE_DOCS["videos/" + m[1]]._real.id;
    return prevStable ? prevStable(h) : h;
  };
  var prevRestore = RB.restoreEditors, prevSave = RB.saveEditors;
  RB.saveEditors = function (s) {
    if (prevSave) prevSave(s);
    if (VE.open && VE.p && VE.p._real) s.ve = { id: VE.p._real.id, t: VE.t, sel: VE.sel, tab: VE.tab, pps: VE.pps };
  };
  RB.restoreEditors = function (s) {
    var m = location.hash.match(/^#crear\/videos\/vid:(.+)$/);
    if (!m) return prevRestore ? prevRestore(s) : Promise.resolve();
    var idx = (RB.vids || []).findIndex(function (v) { return v.id === m[1]; });
    if (idx < 0) idx = (RB.vids || []).length;
    return RB.openVideo(m[1], idx).then(function () {
      return new Promise(function (res) {
        var n = 0, iv = setInterval(function () {
          if ((VE.open && VE.p && VE.p._real) || ++n > 60) {
            clearInterval(iv);
            if (s.ve && VE.open) { VE.t = s.ve.t || 0; VE.sel = s.ve.sel || null; VE.tab = s.ve.tab || VE.tab; if (s.ve.pps) VE.pps = s.ve.pps; veBin(); veInsp(); veAll(); }
            res();
          }
        }, 100);
      });
    });
  };
})();

/* editor de video pro (keyframes y efectos en textos y media, formas, subir imagen y audio, fuentes, UX): se carga
   desde aquí para no tocar la lista de bridge.js */
(function () {
  if (document.querySelector('script[data-ve-pro]')) return;
  var s = document.createElement("script");
  s.src = "bridge-video-pro.js";
  s.setAttribute("data-ve-pro", "1");
  document.body.appendChild(s);
})();
