/* bridge-video.js — el editor de video de la maqueta abriendo tus proyectos reales (musa_video_*).
 * Pista de video → V1 (clips de video e imágenes), pista de texto → T (textos), audio → A.
 * Cada cambio (mover, recortar, velocidad, borrar, textos, clips nuevos) se guarda en /api/video-projects.
 */
(function () {
  var RB = window.__musaReal;
  if (!RB || typeof VE === "undefined") return;
  function bridge() { try { return window.parent.__musaBridge; } catch (e) { return null; } }
  function api(url, init) { var b = bridge(); return b ? b.api(url, init) : Promise.reject(new Error("sin puente")); }
  function json(method, body) { return { method: method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }; }
  var US = 1e6, r3 = function (v) { return Math.round(v * 1000) / 1000; };

  /* ── proyecto real → formato del editor ── */
  function takeFor(url, name, dur, matId) {
    var i = VTAKES.findIndex(function (t) { return t.blob === url; });
    if (i < 0) { VTAKES.push({ name: name, src: "Video", dur: dur || 10, bg: "#000", blob: url, _mat: matId || null }); i = VTAKES.length - 1; }
    else if (matId && !VTAKES[i]._mat) VTAKES[i]._mat = matId;
    return i;
  }
  RB.takeFor = takeFor;
  function build(tree) {
    var pj = tree.project, mats = {};
    (tree.materials || []).forEach(function (m) { mats[m.id] = m; });
    var fmt = VFMT[pj.ratio] ? pj.ratio : "16:9", W = VFMT[fmt][0], H = VFMT[fmt][1];
    var p = { name: pj.name || "Video", brand: RB.ws && WSS[RB.ws] ? WSS[RB.ws].own : "", fmt: fmt, fps: pj.fps || 30, pad: "#000000", v1: [], m: [], t: [], a: [] };
    Object.defineProperty(p, "_real", { value: { id: pj.id, tracks: {}, known: {}, mats: mats }, enumerable: false });
    var R = p._real, tracks = (tree.tracks || []).slice().sort(function (a, b) { return a.z_order - b.z_order; });
    tracks.forEach(function (tk) {
      if (!R.tracks[tk.type]) R.tracks[tk.type] = tk.id;
      (tk.segments || []).slice().sort(function (a, b) { return a.target_start_us - b.target_start_us; }).forEach(function (sg) {
        var m = mats[sg.material_id] || {}, pl = m.payload || {}, start = sg.target_start_us / US, dur = sg.target_dur_us / US;
        var c = null;
        if (tk.type === "video" && R.tracks.video === tk.id) {
          if (m.kind === "video") c = take(takeFor(pl.url, pl.name || "Clip de video", (pl.durationUs || sg.source_dur_us) / US, m.id), dur, { in: sg.source_start_us / US, speed: +sg.speed || 1 });
          else if (m.kind === "image") c = scene(SC(pl.name || "Imagen", W, H, "#000", [IM("Imagen", 0, 0, W, H, "url('" + pl.url + "') center/cover no-repeat")]), dur, { speed: +sg.speed || 1 });
          if (c) p.v1.push(c);
        } else if (tk.type === "video") {
          if (m.kind === "image" || m.kind === "video") { c = { id: nid(), name: pl.name || "Media", start: start, dur: dur, x: pl.x != null ? pl.x : 50, y: pl.y != null ? pl.y : 50, w: pl.w || 40, ar: pl.ar || 1, radius: pl.radius || 0, bg: "url('" + pl.url + "') center/cover no-repeat", anim: "fade" }; p.m.push(c); }
        } else if (tk.type === "text" && m.kind === "text") {
          c = cap(pl.text || "", start, dur, { x: pl.x != null ? pl.x : 50, y: pl.y != null ? pl.y : 82, size: pl.size || pl.fontSize || 64, font: FONTS[pl.font] ? pl.font : "Inter", weight: pl.weight || 800, color: pl.color || "#ffffff", bg: pl.bg || "", anim: pl.anim || "pop" });
          p.t.push(c);
        } else if (tk.type === "audio" && m.kind === "audio") {
          c = { id: nid(), name: pl.name || "Audio", start: start, dur: dur, vol: pl.volume != null ? pl.volume : 1, fin: 0, fout: 0, url: pl.url };
          p.a.push(c);
        }
        if (c) { Object.defineProperty(c, "_seg", { value: sg.id, writable: true, enumerable: false }); Object.defineProperty(c, "_mat", { value: m.id, writable: true, enumerable: false }); R.known[sg.id] = snapOf(c); }
      });
    });
    relayout(p);
    p.v1.forEach(function (c) { if (c._seg) R.known[c._seg] = snapOf(c); });
    return p;
  }
  function snapOf(c) { return JSON.stringify({ s: r3(c.start), d: r3(c.dur), i: r3(c.in || 0), v: c.speed || 1, t: c.text, x: c.x, y: c.y, z: c.size, f: c.font, w: c.weight, col: c.color, bg: c.bg, n: c.name }); }

  /* ── guardar: compara el timeline con lo último guardado y manda solo los cambios ── */
  var timer = null, busy = false, again = false;
  function schedule() { clearTimeout(timer); VE._pend = true; timer = setTimeout(function () { VE._pend = false; sync(); }, 900); }
  function ensureTrack(p, type) {
    var R = p._real;
    if (R.tracks[type]) return Promise.resolve(R.tracks[type]);
    return api("/api/video-projects/" + R.id + "/tracks?workspaceId=" + RB.ws, json("POST", { type: type })).then(function (x) { R.tracks[type] = x.data.track.id; return R.tracks[type]; });
  }
  function ensureOverlayTrack(p) {
    var R = p._real;
    if (R.overlay) return Promise.resolve(R.overlay);
    return api("/api/video-projects/" + R.id + "/tracks?workspaceId=" + RB.ws, json("POST", { type: "video", zOrder: 50 })).then(function (x) { R.overlay = x.data.track.id; return R.overlay; });
  }
  function matPayload(c, kind) {
    if (kind === "text") return { text: c.text || " ", x: c.x, y: c.y, size: c.size, font: c.font, weight: c.weight, color: c.color, bg: c.bg, anim: c.anim };
    var url = (String(c.bg || "").match(/url\(["']?([^"')]+)["']?\)/) || [])[1];
    return { url: url, name: c.name, x: c.x, y: c.y, w: c.w, ar: c.ar, radius: c.radius };
  }
  function sync() {
    var p = VE.open && VE.p && VE.p._real ? VE.p : null;
    if (!p) return;
    if (busy) { again = true; return; }
    busy = true;
    var R = p._real, base = "/api/video-projects/" + R.id, q = "?workspaceId=" + encodeURIComponent(RB.ws), ops = [], alive = {};
    relayout(p);
    var seg = function (c, trackType, kind, payloadFn, mkMaterial) {
      if (c._seg) {
        alive[c._seg] = 1;
        var now = snapOf(c);
        if (now === R.known[c._seg]) return;
        var old = JSON.parse(R.known[c._seg] || "{}");
        ops.push(function () {
          var body = { targetStartUs: Math.round(c.start * US), sourceStartUs: Math.round((c.in || 0) * US), sourceDurUs: Math.round(c.dur * (c.speed || 1) * US) };
          if ((c.speed || 1) !== old.v) body.speed = c.speed || 1;
          var jobs = [api(base + "/segments/" + c._seg + q, json("PATCH", body))];
          if (payloadFn && (old.t !== c.text || old.x !== c.x || old.y !== c.y || old.z !== c.size || old.col !== c.color || old.bg !== c.bg || old.f !== c.font || old.w !== c.weight))
            jobs.push(api(base + "/materials/" + c._mat + q, json("PATCH", { payload: payloadFn(c) })));
          return Promise.all(jobs).then(function () { R.known[c._seg] = now; });
        });
      } else {
        ops.push(function () {
          var trackP = trackType === "overlay" ? ensureOverlayTrack(p) : ensureTrack(p, trackType);
          return Promise.all([trackP, mkMaterial()]).then(function (r) {
            if (!r[1]) return;
            return api(base + "/segments" + q, json("POST", { trackId: r[0], materialId: r[1], targetStartUs: Math.round(c.start * US), targetDurUs: Math.round(c.dur * US), sourceStartUs: Math.round((c.in || 0) * US), sourceDurUs: Math.round(c.dur * (c.speed || 1) * US), speed: c.speed || 1 }))
              .then(function (x) {
                Object.defineProperty(c, "_seg", { value: x.data.segment.id, writable: true, enumerable: false });
                Object.defineProperty(c, "_mat", { value: r[1], writable: true, enumerable: false });
                R.known[c._seg] = snapOf(c);
              });
          });
        });
      }
    };
    var postMat = function (kind, payload) { return api(base + "/materials" + q, json("POST", { kind: kind, payload: payload })).then(function (x) { return x.data.material.id; }); };
    p.v1.forEach(function (c) {
      seg(c, "video", null, null, function () {
        if (c.kind === "take") {
          var tk = VTAKES[c.take];
          if (!tk || !tk.blob || /^blob:/.test(tk.blob)) { vtoast("Este clip todavía no se puede guardar: súbelo primero a tus archivos"); return Promise.resolve(null); }
          return tk._mat ? Promise.resolve(tk._mat) : postMat("video", { url: tk.blob, name: tk.name, durationUs: Math.round((tk.dur || c.dur) * US) }).then(function (id) { tk._mat = id; return id; });
        }
        var img = c.scene && c.scene.els && c.scene.els[0] && String(c.scene.els[0].fill || "").match(/url\(["']?([^"')]+)["']?\)/);
        if (img && /^https?:/.test(img[1])) return postMat("image", { url: img[1], name: c.name });
        if (img && /^data:image/.test(img[1])) return upload(img[1], c.name).then(function (u) { c.scene.els[0].fill = "url('" + u + "') center/cover no-repeat"; return postMat("image", { url: u, name: c.name }); });
        return Promise.resolve(null); /* escena armada a mano: vive en video_editor_state */
      });
    });
    p.m.forEach(function (c) { seg(c, "overlay", "image", function (x) { return matPayload(x, "image"); }, function () {
      var u = matPayload(c, "image").url;
      if (!u) return Promise.resolve(null);
      return (/^data:/.test(u) ? upload(u, c.name) : Promise.resolve(u)).then(function (url) { c.bg = "url('" + url + "') center/cover no-repeat"; var pl = matPayload(c, "image"); pl.url = url; return postMat("image", pl); });
    }); });
    p.t.forEach(function (c) { seg(c, "text", "text", function (x) { return matPayload(x, "text"); }, function () { return postMat("text", matPayload(c, "text")); }); });
    p.a.forEach(function (c) { seg(c, "audio", "audio", null, function () { return c.url ? postMat("audio", { url: c.url, name: c.name }) : Promise.resolve(null); }); });
    Object.keys(R.known).forEach(function (id) {
      if (!alive[id]) ops.push(function () { return api(base + "/segments/" + id + q, { method: "DELETE" }).then(function () { delete R.known[id]; }); });
    });
    ops.reduce(function (pr, f) { return pr.then(f); }, Promise.resolve())
      .then(function () { return saveState(p); })
      .then(function () { return api("/rest/v1/musa_video_projects?id=eq." + encodeURIComponent(R.id) + "&select=updated_at").then(function (r) { if (r && r[0]) R.remoteAt = r[0].updated_at; }, function () {}); })
      .then(null, function (e) { vtoast("No se pudo guardar: " + (e && e.message || "error")); })
      .then(function () { busy = false; if (again) { again = false; schedule(); } });
  }
  function upload(dataUrl, name) {
    return api("/api/assets/upload", json("POST", { name: (name || "escena") + ".png", data: dataUrl, workspaceId: RB.ws })).then(function (x) { var a = x.data || x.asset || x; return a.url || (a.asset && a.asset.url); });
  }

  /* ── estado visual del editor (transiciones, looks, efectos, animaciones, escenas a mano, música, fondo) ── */
  var UI_KEYS = ["look", "lookK", "fx", "ovl", "trans", "fit", "mo", "kf", "vol", "fin", "fout", "anim", "x", "y", "w", "ar", "radius", "size", "font", "weight", "color", "bg", "name", "in", "speed"];
  function serialClip(c) { var o = JSON.parse(JSON.stringify(c)); o._s = c._seg || null; if (c.kind === "take" && VTAKES[c.take]) o.takeUrl = VTAKES[c.take].blob; return o; }
  function saveState(p) {
    var R = p._real, st = { fmt: p.fmt, pad: p.pad, fps: p.fps, v1: p.v1.map(serialClip), m: p.m.map(serialClip), t: p.t.map(serialClip), a: p.a.map(serialClip) };
    var sig = JSON.stringify(st); if (sig === R.stateSig) return Promise.resolve();
    return api("/rest/v1/video_editor_state", { method: "POST", headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ project_id: R.id, workspace_id: RB.ws, state: st }) })
      .then(function () { R.stateSig = sig; });
  }
  function restoreClip(c) { delete c._s; if (c.kind === "take" && c.takeUrl) c.take = takeFor(c.takeUrl, c.name, c.dur); delete c.takeUrl; c.id = c.id || nid(); return c; }
  function mergeState(p, st) {
    if (!st || !Array.isArray(st.v1)) return p;
    var bySeg = {};
    ["v1", "m", "t", "a"].forEach(function (k) { (st[k] || []).forEach(function (c) { if (c._s) bySeg[c._s] = c; }); });
    /* lo que guarda la base (material/segmento) manda: el estado solo completa lo visual que la base no guarda */
    var FROM_DB = { t: { text: 1, x: 1, y: 1, size: 1, font: 1, weight: 1, color: 1, bg: 1, anim: 1 }, m: { x: 1, y: 1, w: 1, ar: 1, radius: 1, bg: 1, name: 1 }, a: { name: 1 }, v1: { name: 1 } };
    ["v1", "m", "t", "a"].forEach(function (k) { p[k].forEach(function (c) { var sv = c._seg && bySeg[c._seg]; if (sv) UI_KEYS.forEach(function (u) { if (sv[u] !== undefined && u !== "in" && u !== "speed" && !FROM_DB[k][u]) c[u] = sv[u]; }); }); });
    st.v1.forEach(function (c, i) { if (!c._s) p.v1.splice(Math.min(i, p.v1.length), 0, restoreClip(c)); });
    ["m", "t", "a"].forEach(function (k) { (st[k] || []).forEach(function (c) { if (!c._s) p[k].push(restoreClip(c)); }); });
    if (st.pad) p.pad = st.pad;
    relayout(p);
    return p;
  }

  /* cualquier ajuste en el editor (inspector, timeline, menús) programa un guardado */
  ["input", "change", "pointerup", "keyup"].forEach(function (ev) { veRoot.addEventListener(ev, function () { if (VE.open && VE.p && VE.p._real) schedule(); }, true); });

  /* cada cambio del timeline programa un guardado */
  var _veAll = veAll;
  veAll = function () { var r = _veAll.apply(this, arguments); if (VE.p && VE.p._real) schedule(); return r; };
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
    if (secs[1]) secs[1].innerHTML = '<div class="ed-mh">Tus imágenes — se suman en M, en el playhead</div>' + (A.filter(function (a) { return /^image/.test(a.mime_type || "") && a.url; }).slice(0, 60).map(function (a) {
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
        p.v1.push(scene(SC(b.querySelector("b").textContent, W, H, "#000", [IM("Diseño", 0, 0, W, H, "url('" + dataUrl + "') center/contain no-repeat")]), 3));
        veAll(); veInsp && veInsp();
        vtoast("Escena agregada al final de V1");
      }, function (err) { vtoast("No se pudo agregar: " + (err && err.message)); });
  }, true);

  /* ── Exportar reel de verdad: se compone en un canvas y se graba (MP4 si el navegador puede, si no WebM) ── */
  function loadImg(url) { return new Promise(function (res) { var im = new Image(); im.crossOrigin = "anonymous"; im.onload = function () { res(im); }; im.onerror = function () { res(null); }; im.src = url; }); }
  function cover(g, src, sw, sh, W, H, contain) { if (!sw || !sh) return; var s = contain ? Math.min(W / sw, H / sh) : Math.max(W / sw, H / sh); g.drawImage(src, (W - sw * s) / 2, (H - sh * s) / 2, sw * s, sh * s); }
  function urlOf(fill) { var m = String(fill || "").match(/url\(["']?([^"')]+)["']?\)/); return m ? m[1] : null; }
  function exportReal(opts, onProg) {
    var p = VE.p, W0 = VFMT[p.fmt][0], H0 = VFMT[p.fmt][1], k = Math.min(1, (+opts.r || 1080) / Math.min(W0, H0)), W = Math.round(W0 * k / 2) * 2, H = Math.round(H0 * k / 2) * 2;
    var fps = +opts.fps || p.fps || 30, dur = veDur(p);
    var cv = document.createElement("canvas"); cv.width = W; cv.height = H; var g = cv.getContext("2d");
    var imgs = {}, vids = {}, urls = [];
    p.v1.forEach(function (c) { if (c.kind === "scene" && c.scene) c.scene.els.forEach(function (e) { var u = urlOf(e.fill); if (u) urls.push(u); }); });
    p.m.forEach(function (c) { var u = urlOf(c.bg); if (u) urls.push(u); });
    return Promise.all(urls.map(function (u) { return loadImg(u).then(function (im) { imgs[u] = im; }); })).then(function () {
      p.v1.forEach(function (c) { if (c.kind === "take" && VTAKES[c.take] && VTAKES[c.take].blob && !vids[c.id]) { var v = document.createElement("video"); v.crossOrigin = "anonymous"; v.src = VTAKES[c.take].blob; v.preload = "auto"; v.playsInline = true; vids[c.id] = v; } });
      return Promise.all(Object.keys(vids).map(function (id) { var v = vids[id]; return new Promise(function (r) { if (v.readyState >= 2) r(); v.onloadeddata = r; v.onerror = r; setTimeout(r, 8000); }); }));
    }).then(function () {
      var mime = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"].filter(function (m) { return opts.f === "webm" ? /webm/.test(m) : true; }).find(function (m) { return window.MediaRecorder && MediaRecorder.isTypeSupported(m); });
      var stream = cv.captureStream(fps), chunks = [];
      try {
        var ac = new (window.AudioContext || window.webkitAudioContext)(), dest = ac.createMediaStreamDestination();
        Object.keys(vids).forEach(function (id) { try { ac.createMediaElementSource(vids[id]).connect(dest); } catch (e) {} });
        dest.stream.getAudioTracks().forEach(function (t) { stream.addTrack(t); });
      } catch (e) {}
      var auds = [];
      try {
        var ac2 = window.__mbAC || (window.__mbAC = new (window.AudioContext || window.webkitAudioContext)()), dest2 = ac2.createMediaStreamDestination();
        p.a.filter(function (x) { return x.url; }).forEach(function (x) { var au = new Audio(); au.crossOrigin = "anonymous"; au.src = x.url; au.volume = x.vol != null ? x.vol : 1; try { ac2.createMediaElementSource(au).connect(dest2); } catch (e) {} auds.push({ c: x, el: au, on: false }); });
        dest2.stream.getAudioTracks().forEach(function (t) { stream.addTrack(t); });
      } catch (e) {}
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
          g.fillStyle = p.pad || "#000"; g.fillRect(0, 0, W, H);
          var c = p.v1.find(function (x) { return t >= x.start && t < x.start + x.dur; });
          if (c && c.kind === "take" && vids[c.id]) {
            var v = vids[c.id];
            if (playing !== c.id) { Object.keys(vids).forEach(function (id) { if (id !== c.id) vids[id].pause(); }); v.currentTime = (c.in || 0) + (t - c.start) * (c.speed || 1); v.playbackRate = c.speed || 1; v.play().catch(function () {}); playing = c.id; }
            cover(g, v, v.videoWidth, v.videoHeight, W, H);
          } else if (c && c.kind === "scene" && c.scene) {
            playing = null;
            c.scene.els.forEach(function (e) { var im = imgs[urlOf(e.fill)]; if (im) cover(g, im, im.naturalWidth, im.naturalHeight, W, H, /contain/.test(e.fill)); });
          }
          p.m.filter(function (x) { return t >= x.start && t < x.start + x.dur; }).forEach(function (x) {
            var im = imgs[urlOf(x.bg)]; if (!im) return;
            var w = W * (x.w || 40) / 100, h = w / (x.ar || 1); g.drawImage(im, W * x.x / 100 - w / 2, H * x.y / 100 - h / 2, w, h);
          });
          p.t.filter(function (x) { return t >= x.start && t < x.start + x.dur; }).forEach(function (x) {
            var size = (x.size || 64) * k; g.font = (x.weight || 800) + " " + size + "px " + (FONTS[x.font] || "Inter,sans-serif"); g.textAlign = "center"; g.textBaseline = "middle";
            var lines = String(x.text || "").split("\n"), lh = size * 1.15, cx = W * x.x / 100, cy = H * x.y / 100 - (lines.length - 1) * lh / 2;
            if (x.bg) { var mw = Math.max.apply(null, lines.map(function (l) { return g.measureText(l).width; })); g.fillStyle = x.bg; g.fillRect(cx - mw / 2 - size * .55, cy - size * .7, mw + size * 1.1, lh * lines.length + size * .3); }
            g.fillStyle = x.color || "#fff"; lines.forEach(function (l, i) { g.fillText(l, cx, cy + i * lh); });
          });
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
    });
  }
  RB.exportReel = exportReal;
  vq("#veModal").addEventListener("click", function (e) {
    if (!e.target.closest || !e.target.closest("[data-mgo]") || !VE.p || !VE.p._real) return;
    e.stopPropagation(); e.preventDefault();
    var m = vq("#veModal"), val = function (k) { var el = m.querySelector('[data-k="' + k + '"]'); return el ? el.value : null; };
    var bar = vq("#veProg i"), txt = vq("#veProgT"), btn = e.target.closest("[data-mgo]");
    btn.disabled = true;
    exportReal({ f: val("f"), r: val("r"), fps: val("fps") }, function (k) { bar.style.width = k + "%"; txt.textContent = k < 100 ? "Grabando el reel… " + k + "% (se graba en tiempo real)" : "Listo."; })
      .then(function (blob) {
        var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = (VE.p.name || "reel").replace(/[\/:*?"<>|]+/g, "-") + (/mp4/.test(blob.type) ? ".mp4" : ".webm"); document.body.appendChild(a); a.click(); a.remove();
        txt.textContent = "Listo: " + (blob.size / 1e6).toFixed(1).replace(".", ",") + " MB descargados (" + (/mp4/.test(blob.type) ? "MP4" : "WebM") + ").";
      }, function (err) { txt.textContent = "No se pudo exportar: " + (err && err.message || "error") + ". Si un clip viene de otra web sin permiso (CORS), súbelo a tus archivos."; })
      .then(function () { btn.disabled = false; });
  }, true);

  /* MCP primero: si una IA cambia el proyecto (segmentos, materiales), el editor se recarga solo */
  setInterval(function () {
    var p = VE.open && VE.p && VE.p._real ? VE.p : null;
    if (!p || busy || timer && VE._pend || VE.playing) return;
    api("/rest/v1/musa_video_projects?id=eq." + encodeURIComponent(p._real.id) + "&select=updated_at").then(function (r) {
      var at = r && r[0] && r[0].updated_at;
      if (!at || !p._real.remoteAt || at === p._real.remoteAt || VE.p !== p || busy) return;
      var t = VE.t, sel = VE.sel, idx = p._real.idx;
      p._real.remoteAt = at;
      delete VE_DOCS["videos/" + idx];
      RB.openVideo(p._real.id, idx).then(function () { setTimeout(function () { if (VE.open) { VE.t = t; VE.sel = sel; veAll(); vtoast("Actualizado: hubo cambios desde MCP"); } }, 400); });
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
    return Promise.all([
      api("/api/video-projects/" + encodeURIComponent(id) + "?workspaceId=" + encodeURIComponent(RB.ws)),
      api("/rest/v1/video_editor_state?project_id=eq." + encodeURIComponent(id) + "&select=state").catch(function () { return []; })
    ]).then(function (res) {
      var remote = res[0] && res[0].data && res[0].data.project && res[0].data.project.updated_at;
      var x = res[0], st = res[1] && res[1][0] && res[1][0].state;
      var p = mergeState(build(x.data), st), key = "videos/" + idx;
      if (st) p._real.stateSig = null;
      VE_DOCS[key] = p;
      p._real.idx = idx; p._real.remoteAt = remote;
      if (location.hash === "#crear/videos/" + idx) { if (VE.open && VE.key === key) { VE.p = p; VE.hist = []; VE.fut = []; veBin(); veInsp(); veAll(); } else if (typeof veSync === "function") veSync(); }
      else location.hash = "crear/videos/" + idx;
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
        v.onseeked = function () { var g = c.getContext("2d"), s = Math.max(c.width / v.videoWidth, c.height / v.videoHeight); g.drawImage(v, (c.width - v.videoWidth * s) / 2, (c.height - v.videoHeight * s) / 2, v.videoWidth * s, v.videoHeight * s); };
      });
    }, function () {});
  };

  /* Editor › «Editor de video» desde un diseño: crea un proyecto real con cada frame como escena */
  RB.videoFromDesign = function (doc) {
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
        TILES["crear/videos"].unshift([eesc(doc.name + " · video"), eesc(WSS[R.ws] ? WSS[R.ws].own : ""), Math.floor(doc.frames.length * 3 / 60) + ":" + String(doc.frames.length * 3 % 60).padStart(2, "0")]);
        Object.keys(VE_DOCS).forEach(function (k) { if (/^videos\//.test(k)) delete VE_DOCS[k]; });
        return RB.openVideo(pid, 0);
      })
      .catch(function (e) { toast("No se pudo crear el video: " + (e && e.message || "error")); });
  };

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
