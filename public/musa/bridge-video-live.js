/* bridge-video-live.js — clips de «código vivo» en el editor de video: Three.js, React Three Fiber (Remotion), p5.js,
 * PixiJS, WebGL, canvas y Lottie como clips EDITABLES.
 *
 * El clip es un clip de media (M) con `live` (ver video-live-core.js). Su código corre en un iframe aislado y cada
 * cuadro se pide por tiempo: la vista previa, el MP4 (cuadro por cuadro) y el código del video usan lo mismo.
 * En el inspector: tiempo del código (inicio, velocidad, bucle), los parámetros que el código expone (objetos
 * params/config/settings…, constantes en MAYÚSCULAS, defaultProps de Remotion, rangos de lil-gui) y los objetos de la
 * escena 3D (cámara, mallas, luces): mover, girar, escalar, color, opacidad, intensidad, FOV. Todo con keyframes ◆.
 * En la biblioteca (Media): «3D y código» con plantillas y «Pegar código».
 */
(function () {
  "use strict";
  if (window.__veLiveOn) return;
  var ML = window.MusaVideoLive;
  if (!ML || typeof VE === "undefined") { console.warn("[código vivo] falta video-live-core.js o el editor"); return; }
  window.__veLiveOn = true;

  var vq0 = function (s) { return document.querySelector(s); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var r2 = function (v) { return Math.round(v * 100) / 100; };
  function toast(m) { if (typeof vtoast === "function" && VE.open) vtoast(m); else if (typeof uiToast === "function") uiToast(m); }
  function W0() { try { return VFMT[(VE.p && VE.p.fmt) || "9:16"][0]; } catch (e) { return 1080; } }
  function H0() { try { return VFMT[(VE.p && VE.p.fmt) || "9:16"][1]; } catch (e) { return 1920; } }
  function cssId(id) { return window.CSS && CSS.escape ? CSS.escape(id) : String(id).replace(/["\\]/g, ""); }
  function shortErr(e) { return String(e || "error").split("\n")[0].replace(/^Error:\s*/, "").slice(0, 160); }

  /* ═════════════ el código manda: todo cambio del inspector pasa por el código ═════════════
     setSrc() deja el código nuevo en el clip; los ajustes (ov) se leen de su bloque «▸ musa». */
  var NORM = typeof WeakMap === "function" ? new WeakMap() : null, LASTIN = 0;
  function norm(c) { var L = c.live; if (!NORM || NORM.get(L) !== L.src) { ML.normalize(L); if (NORM) NORM.set(L, L.src); } return L; }
  function setSrc(c, src, quiet) {
    var L = c.live; src = String(src);
    if (src !== L.src) { L.src = src; L.ov = ML.ovOf(src); if (NORM) NORM.set(L, src); }
    cpExternal(c, "inspector");
    kick();
  }

  /* ═════════════ un cliente (iframe) por clip ═════════════ */
  var INST = {}, LASTP = null;
  function reloadSig(c) { var L = c.live; return ML.hash(JSON.stringify([ML.canon(L.src), L.kind, L.sel])); }
  function ovSig(c, I) { return ML.hash(JSON.stringify([c.live.ov || {}, (I && I.tmp) || {}])); }
  function ovNow(c, I) { return Object.assign({}, c.live.ov || {}, (I && I.tmp) || {}); }
  function sizeOf(c) { return ML.liveSize(c, W0(), H0()); }
  function tcOf(c, lt) { var L = c.live, sp = L.speed != null ? +L.speed : 1, x = Math.max(0, lt) * sp; if (+L.loop > 0) x = x % +L.loop; return Math.max(0, (+L.off || 0) + x); }
  function ltOf(c) { return r2(Math.max(0, Math.min(c.dur, VE.t - c.start))); }
  function kill(I) {
    clearTimeout(I.rt);
    if (I.next) { var nx = I.next; I.next = null; kill(nx); }
    try { I.cli.destroy(); } catch (e) { /* ya no está */ }
    if (I.last && I.last.bmp) try { I.last.bmp.close(); } catch (e) { /* idem */ }
    if (INST[I.id] === I) delete INST[I.id];
  }
  function clipOf(id) { return (VE.p && VE.p.m || []).find(function (x) { return x.id === id; }); }
  function create(c, reg) {
    var wh = sizeOf(c), L = norm(c);
    var I = { id: c.id, c: c, sig: reloadSig(c), src0: L.src, tmp: {}, W: wh[0], H: wh[1], chain: Promise.resolve(), busy: false, want: null, last: null, err: null, scene: null, st: "load", used: Date.now() };
    if (reg !== false) INST[c.id] = I;
    I.ovs = ovSig(c, I);
    try {
      I.cli = ML.client({ src: ML.runSrc(L), kind: L.kind || "html", sel: L.sel != null ? +L.sel : -1, ov: L.ov || {}, W: wh[0], H: wh[1], fps: (VE.p && VE.p.fps) || 30, dur: c.dur, r3: ML.usesR3(L),
        onScene: function (sc) { I.scene = sc; if (INST[I.id] === I && selLive() === I.c && !typing()) refreshInsp(); },
        onBoxes: function (bx) { I.boxes = bx || {}; if (INST[I.id] === I) drawSel(); } });
      I.cli.ready.then(function (st) {
        I.st = "ok"; I.info = st || {}; if (st && st.errors && st.errors.length) I.warn = st.errors[0];
        if (INST[I.id] === I) { paintAll(I); if (selLive() === I.c && !typing()) refreshInsp(); }
        setTimeout(warmNext, 60);
      }, function (e) { I.st = "err"; I.err = e && e.message; if (INST[I.id] === I) { paintAll(I); if (selLive() === I.c && !typing()) refreshInsp(); } });
    } catch (e) { I.st = "err"; I.err = e.message; I.cli = { ready: Promise.reject(e), destroy: function () {}, frame: function () { return Promise.reject(e); }, setOv: function () {}, scene: function () {}, resize: function () {} }; I.cli.ready.catch(function () {}); }
    return I;
  }
  /* el código nuevo ya cargó en su propio iframe: reemplaza al que estaba (que siguió dibujando con la vista previa) */
  function swap(I, N) {
    if (INST[I.id] !== I || I.next !== N) { if (INST[N.id] !== N) kill(N); return; }
    I.next = null;
    var cur = clipOf(I.id);
    if (!cur || !cur.live || reloadSig(cur) !== N.sig) { kill(N); if (VE.open) veStage(); return; }
    /* el último cuadro del código anterior se sigue viendo hasta que llega el del código nuevo (marcado «viejo» para
       pedirlo enseguida: antes, sin mover el playhead, un objeto agregado no se dibujaba ni aparecía en la escena) */
    INST[I.id] = N; N.c = cur; N.boxes = I.boxes; N.last = I.last; if (N.last) N.last.stale = true; I.last = null; if (!N.scene) { N.scene = I.scene; N.sceneOld = true; }
    kill(I);
    if (VE.open) veStage();
    if (selLive() === cur && !typing()) refreshInsp();
  }
  /* el cliente al día con el clip. Código distinto → otro iframe carga el código nuevo (más tarde si se está
     arrastrando un control) mientras el actual sigue dibujando con un ajuste de vista previa (I.tmp); cuando el nuevo
     está listo, lo reemplaza (sin parpadeo ni espera). Keyframes y bloque ▸ musa → sin recargar. */
  function inst(c) {
    norm(c);
    var I = INST[c.id];
    if (!I) return create(c);
    I.c = c; I.used = Date.now();
    var sig = reloadSig(c);
    if (sig !== I.sig) {
      if (I.next && I.next.sig !== sig) { var old = I.next; I.next = null; kill(old); }
      if (!I.next && !I.rt) I.rt = setTimeout(function () {
        I.rt = null;
        if (INST[I.id] !== I) return;
        var cur = clipOf(I.id); if (!cur || !cur.live || reloadSig(cur) === I.sig) return;
        if (I.st !== "ok") { var keep = I.last; I.last = null; kill(I); var R = create(cur); R.last = keep; if (keep) keep.stale = true; if (VE.open) veStage(); return; }
        var N = I.next = create(cur, false);
        N.cli.ready.then(function () { swap(I, N); }, function () { swap(I, N); });
      }, I.st !== "ok" ? 0 : Date.now() - LASTIN < 1500 ? 700 : 250);
    }
    var wh = sizeOf(c);
    if (wh[0] !== I.W || wh[1] !== I.H) { I.W = wh[0]; I.H = wh[1]; I.cli.resize(wh[0], wh[1]); I.last = null; }
    var os = ovSig(c, I);
    if (os !== I.ovs) { I.ovs = os; I.cli.setOv(ovNow(c, I)); }
    return I;
  }
  function setLast(I, f) { if (I.last && I.last.bmp && I.last.bmp !== f.bmp) try { I.last.bmp.close(); } catch (e) { /* idem */ } I.last = f; }
  function want(c, t) {
    var I = inst(c), lt = Math.max(0, Math.min(c.dur, t - c.start)), tc = tcOf(c, lt);
    if (I.last && !I.last.stale && Math.abs(I.last.tc - tc) < 1e-4 && Math.abs(I.last.lt - lt) < 1e-4 && I.last.ovs === I.ovs && (VE.playing || I.boxes)) return;
    I.want = { lt: lt, tc: tc }; pump(I);
  }
  function pump(I) {
    if (I.busy || !I.want || I.st === "err") return;
    var w = I.want, ovs = I.ovs, bxs = !VE.playing; I.want = null; I.busy = true;
    if (!bxs) I.boxes = null;
    var pr = I.chain.then(function () { return I.cli.frame(w.tc, { lt: w.lt, scene: !I.scene || I.sceneOld, boxes: bxs }); });
    I.chain = pr.catch(function () {});
    pr.then(function (r) {
      I.busy = false;
      if (r && r.bmp) { setLast(I, { lt: w.lt, tc: w.tc, ovs: ovs, bmp: r.bmp, w: r.w, h: r.h }); I.err = null; I.sceneOld = false; }
      else if (r && r.err) I.err = r.err;
      paintAll(I); pump(I);
    }, function (e) { I.busy = false; I.err = e && e.message || String(e); paintAll(I); });
  }
  /* vista previa inmediata de un cambio escrito en el código, sobre el código que ya corre */
  function preview(c, key, entry) { var I = INST[c.id]; if (!I) return; if (entry) I.tmp[key] = entry; else delete I.tmp[key]; }
  function preview3(c, rt, co, pr, val, sc) {
    var I = INST[c.id]; if (!I || !co) return;
    var o0 = ML.findObj(I.src0, "v:" + co.v), sl0 = o0 && o0.slots[pr];
    if (sl0 && sl0.mode === "param") {
      var an0 = ML.analyze(I.src0), p0 = an0.params.find(function (x) { return x.key === sl0.key; }); if (!p0 || p0.key.charAt(0) === "v") return;
      var pv = /^r[xyz]$/.test(pr) ? (+val || 0) * Math.PI / 180 : val;
      if (p0.type === "hex" && typeof pv === "string") pv = parseInt(pv.replace("#", ""), 16) || 0;
      I.tmp[sl0.key] = { v: pv }; return;
    }
    var base0 = sl0 && sl0.mode === "code" ? ML.slotVal(ML.sceneMap(I.src0), pr, sl0) : null;
    if (base0 == null) base0 = def3(pr, rt, sc);
    I.tmp["o:" + rt.k + "|" + pr] = { v: ML.toOff3(pr, val, base0) };
  }

  /* ═════════════ vista previa: un <canvas> dentro del clip, pintado con el último cuadro ═════════════ */
  function paintCv(cv, I) {
    var box = cv.parentNode, msg = box && box.querySelector(".ve-live-st");
    if (I.last && I.last.bmp) {
      if (cv.width !== I.last.w || cv.height !== I.last.h) { cv.width = I.last.w; cv.height = I.last.h; }
      var g = cv.getContext("2d"); g.clearRect(0, 0, cv.width, cv.height);
      try { g.drawImage(I.last.bmp, 0, 0); } catch (e) { /* cuadro cerrado */ }
      if (msg) { msg.hidden = I.st !== "err"; if (I.st === "err") msg.textContent = "⚠ " + shortErr(I.err); }
    } else if (msg) { msg.hidden = false; msg.textContent = I.st === "err" || I.err ? "⚠ " + shortErr(I.err) : "Cargando código 3D…"; }
  }
  function paintAll(I) { [].forEach.call(document.querySelectorAll('#veStageW canvas[data-live="' + cssId(I.id) + '"]'), function (cv) { paintCv(cv, I); }); }
  var _mh = mediaHTML;
  mediaHTML = function (c, t) {
    var h = _mh.apply(this, arguments);
    if (!c || !c.live || !h) return h;
    var inner = '<canvas data-live="' + esc(c.id) + '" class="ve-live" aria-label="' + esc(c.name || "Código 3D") + '"></canvas><span class="ve-live-st">Cargando código 3D…</span>';
    var i = h.lastIndexOf("</div>");
    return i < 0 ? h : h.slice(0, i) + inner + h.slice(i);
  };
  function liveTick() {
    if (!VE.open || !VE.p) { if (Object.keys(INST).length && !VE.open) Object.keys(INST).forEach(function (id) { kill(INST[id]); }); return; }
    if (LASTP !== VE.p && LASTP && LASTP._real && VE.p._real && LASTP._real.id !== VE.p._real.id) Object.keys(INST).forEach(function (id) { kill(INST[id]); });
    LASTP = VE.p;
    var t = VE.t, seen = {};
    (VE.p.m || []).forEach(function (c) {
      if (!c.live) return;
      seen[c.id] = 1;
      if (t >= c.start && t < c.start + c.dur) { var I = inst(c); paintAll(I); want(c, t); }
      else if (INST[c.id]) paintAll(INST[c.id]);
    });
    Object.keys(INST).forEach(function (id) { var I = INST[id]; if (!seen[id] || Date.now() - I.used > 180000) kill(I); });
    warmNext(); drawSel();
  }
  /* los demás clips 3D del video se cargan de a uno en segundo plano: al llegar el playhead ya están listos
     (antes cada clip empezaba a cargar recién cuando el playhead entraba: varios segundos de «Cargando código 3D…») */
  var WARM = { p: null, ids: {} };
  function warmNext() {
    if (!VE.open || !VE.p || !VE.p.m) return;
    if (WARM.p !== VE.p) WARM = { p: VE.p, ids: {} };
    var ks = Object.keys(INST); if (ks.length >= 4 || ks.some(function (id) { return INST[id].st === "load"; })) return;
    var c = VE.p.m.find(function (x) { return x.live && !INST[x.id] && !WARM.ids[x.id]; }); if (!c) return;
    WARM.ids[c.id] = 1; try { inst(c); } catch (e) { /* se cargará al llegar */ }
  }
  var _st = veStage;
  veStage = function () { var r = _st.apply(this, arguments); try { liveTick(); } catch (e) { console.warn("[código vivo]", e); } return r; };

  /* ═════════════ exportar (bridge-video.js): cuadro exacto en cada instante ═════════════ */
  var EXP = {}, EXPON = false;
  window.__veLive = {
    img: function (c) { var e = EXPON && EXP[c.id]; if (e) return e.bmp; var I = INST[c.id]; return I && I.last ? I.last.bmp : null; },
    prep: function (p, t) {
      EXPON = true;
      return Promise.all((p.m || []).filter(function (c) { return c.live && t >= c.start && t < c.start + c.dur; }).map(function (c) {
        var lt = t - c.start;
        /* si el código cambió y se va a recargar, se espera al nuevo (sin ajustes de vista previa); después, en fila */
        var ready = function () { var I = inst(c); return I.rt || reloadSig(c) !== I.sig ? new Promise(function (r) { setTimeout(r, 450); }).then(ready) : Promise.resolve(I); };
        return ready().then(function (I) {
          var prev = I.chain;
          var pr = prev.then(function () { return I.cli.frame(tcOf(c, lt), { lt: lt }); }).then(function (r) {
            if (r && r.bmp) { if (EXP[c.id]) try { EXP[c.id].bmp.close(); } catch (e) { /* idem */ } EXP[c.id] = { bmp: r.bmp, w: r.w, h: r.h }; }
          }, function () { /* ese cuadro sale sin el clip vivo */ });
          I.chain = pr;
          return pr;
        });
      }));
    },
    want: function (p, t) { (p.m || []).forEach(function (c) { if (c.live && t >= c.start && t < c.start + c.dur) want(c, t); }); },
    endExport: function () { EXPON = false; Object.keys(EXP).forEach(function (k) { try { EXP[k].bmp.close(); } catch (e) { /* idem */ } delete EXP[k]; }); },
    status: function (id) { var I = INST[id]; return I ? { st: I.st, err: I.err, warn: I.warn || null, has: !!(I.last && I.last.bmp), w: I.last ? I.last.w : 0, h: I.last ? I.last.h : 0, scene: I.scene, info: I.info || null, pending: !!(I.rt || (I.c && I.c.live && reloadSig(I.c) !== I.sig)) } : null; },
    analyze: function (c) { return anOf(c.live); },
    objects: function (c) { return ML.codeObjects(norm(c).src); },
    add: function (src, kind, name, opt) { return addLive(src, kind, name, opt || {}); },
    code: function (c) { cpOpen(c || selLive()); return CP.el; },
    /* lo que estás escribiendo en «</> Código del clip» pasa ya al clip (antes de juntar con cambios del MCP) */
    flushCode: function () { if (CP.dirty) cpApply(true); },
  };

  /* ═════════════ inspector ═════════════ */
  var AN = {};
  function anOf(L) { var k = ML.hash(String(L.src || "")); if (!AN[k]) { AN = {}; AN[k] = ML.analyze(String(L.src || "")); } return AN[k]; }
  function selLive() { var s = VE.sel; if (!s || s.tr !== "m" || !VE.p) return null; var c = VE.p.m[s.i]; return c && c.live ? c : null; }
  function typing() { var a = document.activeElement; return !!(a && a.closest && a.closest(".ve-live-insp") && /INPUT|TEXTAREA|SELECT/.test(a.tagName)); }
  function refreshInsp() { if (typeof veInsp === "function" && VE.open) veInsp(); }
  var SEL3 = {}, ADDT = {};
  function kfBtn(key, e, lt) {
    var has = e && e.kf && e.kf.length, at = has && e.kf.some(function (k) { return Math.abs(k.t - lt) < 0.02; });
    return '<button type="button" class="lv-kf' + (at ? " on" : has ? " has" : "") + '" data-lk="' + esc(key) + '" title="' + (at ? "Quitar el keyframe de este instante" : "Agregar un keyframe en el playhead (" + lt.toFixed(2) + " s del clip) · queda en el bloque ▸ musa del código") + '">◆</button>';
  }
  function colorHex(v) {
    var t = ML.hex6(v); if (/^#[0-9a-f]{6}$/i.test(t)) return t;
    try { var g = document.createElement("canvas").getContext("2d"); g.fillStyle = "#000000"; g.fillStyle = String(v); if (/^#[0-9a-f]{6}$/i.test(g.fillStyle)) return g.fillStyle; } catch (e) { /* sin canvas */ }
    return "#ffffff";
  }
  function field(key, label, type, v, opt, attr, kfable, e, lt, tag) {
    opt = opt || {};
    var inp;
    if (type === "num") inp = (opt.min != null && opt.max != null ? '<input type="range" ' + attr + '="' + esc(key) + '" min="' + opt.min + '" max="' + opt.max + '" step="' + (opt.step || (opt.max - opt.min) / 100) + '" value="' + v + '" aria-label="' + esc(label) + '">' : "")
      + '<input type="number" ' + attr + '="' + esc(key) + '" step="' + (opt.step || "any") + '" value="' + (isFinite(+v) ? r2(+v) : 0) + '" aria-label="' + esc(label) + '">';
    else if (type === "color" || type === "hex") { var hx = type === "hex" ? "#" + ("000000" + ((+v >>> 0) & 0xffffff).toString(16)).slice(-6) : colorHex(v); inp = '<input type="color" ' + attr + '="' + esc(key) + '" value="' + esc(hx) + '" aria-label="' + esc(label) + '">'; }
    else if (type === "bool") inp = '<select ' + attr + '="' + esc(key) + '" aria-label="' + esc(label) + '"><option value="1"' + (v ? " selected" : "") + '>Sí</option><option value="0"' + (v ? "" : " selected") + ">No</option></select>";
    else inp = '<input type="text" ' + attr + '="' + esc(key) + '" value="' + esc(v) + '" aria-label="' + esc(label) + '">';
    return '<div class="lv-f"><span class="lv-l" title="' + esc(key) + '">' + (tag || "") + esc(label) + "</span>" + inp + (kfable ? kfBtn(key, e, lt) : '<i class="lv-kf0"></i>') + "</div>";
  }
  var P3 = {
    cam: ["px", "py", "pz", "rx", "ry", "rz", "fov"],
    mesh: ["px", "py", "pz", "rx", "ry", "rz", "s", "color", "emi", "op", "vis"],
    light: ["px", "py", "pz", "color", "int", "vis"],
    other: ["px", "py", "pz", "rx", "ry", "rz", "s", "vis"],
  };
  var LBL = { px: ["Posición X", "Mover X (+)"], py: ["Posición Y", "Mover Y (+)"], pz: ["Posición Z", "Mover Z (+)"], rx: ["Giro X°", "Girar X (+°)"], ry: ["Giro Y°", "Girar Y (+°)"], rz: ["Giro Z°", "Girar Z (+°)"],
    s: ["Escala", "Escala ×"], color: ["Color", "Color"], emi: ["Brillo propio (emisivo)", "Brillo propio (emisivo)"], op: ["Opacidad", "Opacidad ×"], "int": ["Intensidad", "Intensidad ×"], vis: ["Visible", "Visible"], fov: ["Apertura (FOV°)", "Apertura (FOV°)"] };
  function type3(prop) { return prop === "color" || prop === "emi" ? "color" : prop === "vis" ? "bool" : "num"; }
  /* valor de una propiedad cuando el código no la escribe (lo que trae Three.js) */
  function def3(pr, rt, sc) {
    if (pr === "color") return colorHex((rt && rt.color) || "#ffffff");
    if (pr === "emi") return "#000000";
    if (pr === "vis") return !(rt && rt.vis === false);
    if (pr === "fov") return sc && sc.cam && sc.cam.fov != null ? sc.cam.fov : 50;
    return ML.off0(pr);
  }
  /* el objeto de la escena elegido y su objeto del código (por variable o por nombre) */
  function rtOf(c, sc) {
    var sel = SEL3[c.id] || "cam";
    if (sel !== "cam" && sc && sc.objs) { var o = sc.objs.find(function (x) { return x.k === sel; }); if (o) return o; }
    return { k: "cam", n: "Cámara", type: sc && sc.cam ? sc.cam.type : "Camera", v: sc && sc.cam ? sc.cam.v : null };
  }
  function coOf(src, rt) {
    if (!rt) return null;
    if (rt.k === "cam") return (rt.v && ML.findObj(src, "v:" + rt.v)) || ML.findObj(src, "cam");
    if (rt.v) { var a = ML.findObj(src, "v:" + rt.v); if (a) return a; }
    return rt.k.indexOf("n:") === 0 ? ML.findObj(src, rt.k) : null;
  }
  function ctx3(c) { var I = INST[c.id], sc = I && I.scene, rt = rtOf(c, sc); return { sc: sc, rt: rt, co: coOf(c.live.src, rt) }; }
  function baseOf(src, co, pr, rt, sc) { var sl = co && co.slots[pr], v = sl ? ML.slotVal(ML.sceneMap(src), pr, sl) : null; return v == null ? def3(pr, rt, sc) : pr === "color" || pr === "emi" ? colorHex(v) : v; }
  function srcTag(co, pr, sl) {
    var where = sl.mode === "param" ? "Cambia " + sl.key.slice(2) + " en tu código" : sl.mode === "add" ? (co.jsx ? "Se escribe en tu código (atributo nuevo en " + co.v + ")" : "Se escribe en tu código (línea nueva después de crear " + co.v + ")") : "Se escribe en tu código, en su lugar";
    return '<i class="lv-tag" title="' + esc(where) + '">&lt;/&gt;</i>';
  }
  function row3(c, ctx, pr, lt, ov) {
    var L = c.live, rt = ctx.rt, co = ctx.co, key = "o:" + rt.k + "|" + pr, e = ov[key], sl = co && co.slots[pr], inCode = !!(sl && sl.mode !== "over"), tp = type3(pr), val;
    if (inCode) val = ML.comb3(pr, baseOf(L.src, co, pr, rt, ctx.sc), ML.valAt(e, lt, undefined));
    else val = ML.valAt(e, lt, pr === "color" || pr === "emi" || pr === "vis" || pr === "fov" ? def3(pr, rt, ctx.sc) : ML.off0(pr));
    var tag = inCode ? srcTag(co, pr, sl) : sl ? '<i class="lv-tag lv-anim" title="Tu código calcula esto en cada cuadro: lo que pongas aquí se suma y queda en el bloque ▸ musa">+</i>' : "";
    return field(key, LBL[pr][inCode ? 0 : 1], tp, val, { step: /^r/.test(pr) || pr === "fov" ? 1 : 0.05 }, "data-l3", tp === "num", e, lt, tag);
  }
  function blockKeys(ov, pred) { return Object.keys(ov || {}).filter(pred); }
  function inspHTML(c) {
    var L = norm(c), I = INST[c.id], an = anOf(L), lib = ML.LIB_NAMES[an.lib] || "Código", lt = ltOf(c), ov = L.ov || {}, bk = ML.blockOf(L.src);
    var stt = !I ? "Mueve el playhead sobre el clip para cargarlo." : (I.st === "err" || I.err) ? "⚠ " + esc(shortErr(I.err)) : I.st === "ok" ? (I.info && I.info.seekable ? "Listo · se dibuja por tiempo (se puede saltar a cualquier instante)" : "Listo · se dibuja cuadro a cuadro (al volver atrás se recalcula desde 0)") : "Cargando el código…";
    if (I && I.warn && I.st === "ok") stt += " · aviso del código: " + esc(shortErr(I.warn));
    if (bk.err) stt += " · ⚠ el bloque ▸ musa del código tiene un error: " + esc(shortErr(bk.err));
    var wh = sizeOf(c), cpOn = CP.el && !CP.el.hidden && CP.c === c;
    var h = sec("Código vivo · " + esc(lib),
      '<div class="ed-note" style="grid-column:1/-1">' + stt + "</div>"
      + '<div class="ed-row" style="grid-column:1/-1"><button class="ed-btn pri" data-lact="edit" aria-pressed="' + (cpOn ? "true" : "false") + '">&lt;/&gt; Código del clip</button><button class="ed-btn" data-lact="reload">Recargar</button></div>'
      + '<div class="ed-note" style="grid-column:1/-1">El código manda: lo que cambias aquí (o tu IA por MCP) se escribe en el código al instante, y lo que escribes en el código aparece aquí para editar.</div>'
      + '<div class="lv-grid">' + field("lv.off", "Empieza en (s del código)", "num", L.off || 0, { step: 0.1 }, "data-lv", false) + field("lv.speed", "Velocidad ×", "num", L.speed != null ? L.speed : 1, { step: 0.05 }, "data-lv", false) + field("lv.loop", "Repetir cada (s · 0 = no)", "num", L.loop || 0, { step: 0.1 }, "data-lv", false) + "</div>"
      + '<div class="ed-note" style="grid-column:1/-1">Lienzo del código: ' + wh[0] + "×" + wh[1] + " px" + (L.W ? " (el de la composición de origen)" : " (toma la forma del clip: cambia Ancho y Proporción y el código se adapta)") + ". Mover, escalar, girar, opacidad, máscara y keyframes del clip funcionan como en cualquier imagen.</div>");
    var ps = an.params;
    if (ps.length) {
      var pk = blockKeys(ov, function (k) { return k.indexOf("o:") !== 0; });
      h += sec("Parámetros del código · " + ps.length, '<div class="ed-note" style="grid-column:1/-1">Los encontré en tu código (' + esc(Array.from(new Set(ps.map(function (p) { return p.key.charAt(0) === "v" ? "constantes" : p.key.charAt(0) === "r" ? "props de Remotion" : p.obj; }))).join(", ")) + "). Al cambiarlos se reescribe su valor en el código. ◆ = keyframes (quedan en el bloque ▸ musa).</div>"
        + '<div class="lv-grid">' + ps.map(function (p) { var e = ov[p.key]; return field(p.key, p.name, p.type, ML.valAt(e, lt, p.v), p, "data-lp", p.kfable, e, lt, '<i class="lv-tag" title="' + esc(p.key.slice(2)) + ' en tu código">&lt;/&gt;</i>'); }).join("") + "</div>"
        + (pk.length ? '<div class="ed-row" style="grid-column:1/-1"><button class="ed-btn" data-lact="resetp">Quitar los keyframes de los parámetros</button></div>' : ""));
    } else {
      h += sec("Parámetros del código", '<div class="ed-note" style="grid-column:1/-1">El código no expone parámetros. Para que aparezcan aquí, pon tus valores en un objeto <code>const params = { velocidad: 1, color: "#ff5e00" }</code> (también sirven config, settings, options o constantes en MAYÚSCULAS) y léelos en cada cuadro.</div>', false);
    }
    if (an.lib === "three" || an.lib === "three-r3f" || (I && I.scene)) {
      var sc = I && I.scene, addOk = (an.lib === "three" || an.lib === "three-r3f") && ML.canAdd(L.src);
      var addRow = addOk ? '<div class="lv-add" style="grid-column:1/-1"><select data-l3add aria-label="Objeto para agregar al código">' + [["box", "Caja"], ["sphere", "Esfera"], ["torus", "Toro"], ["knot", "Nudo"], ["cone", "Cono"], ["cylinder", "Cilindro"], ["icosa", "Icosaedro"], ["plane", "Plano"], ["pointLight", "Luz puntual"], ["dirLight", "Luz direccional"]].map(function (x) { return '<option value="' + x[0] + '"' + ((ADDT[c.id] || "box") === x[0] ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") + '</select><button class="ed-btn" data-lact="add3">＋ Agregar al código</button></div>' : "";
      if (sc && sc.objs) {
        var ctx = ctx3(c), rt = ctx.rt, co = ctx.co, sel = rt.k;
        var kind = sel === "cam" ? "cam" : rt.light ? "light" : rt.mesh ? "mesh" : "other";
        var codeNames = {}; ML.codeObjects(L.src).forEach(function (o) { codeNames[o.var] = 1; if (o.name) codeNames["n:" + o.name] = 1; });
        var opts = '<option value="cam"' + (sel === "cam" ? " selected" : "") + ">Cámara" + (sc.cam && sc.cam.type ? " · " + esc(sc.cam.type) : "") + (sc.cam && sc.cam.v ? " · </> " + esc(sc.cam.v) : "") + "</option>"
          + sc.objs.map(function (x) { var inC = (x.v && codeNames[x.v]) || codeNames["n:" + x.n]; return '<option value="' + esc(x.k) + '"' + (x.k === sel ? " selected" : "") + ">" + new Array(Math.min(6, x.d)).join("· ") + esc(x.n) + (x.n !== x.type ? " · " + esc(x.type) : "") + (x.inst ? " ×" + x.inst : "") + (inC ? " · </> " + esc(x.v || "") : "") + "</option>"; }).join("");
        var touched = blockKeys(ov, function (k) { return k.indexOf("o:" + rt.k + "|") === 0; }).length;
        var musaAdded = co && (ML.addedByMusa ? ML.addedByMusa(L.src, co) : new RegExp("/\\* agregado en Musa \\*/ const " + co.v.replace(/\$/g, "\\$") + " = ").test(L.src));
        h += sec("Escena 3D · " + sc.objs.length + " objetos",
          '<label class="ef full"><span>Objeto</span><select data-l3sel="1">' + opts + "</select></label>"
          + '<div class="ed-note" style="grid-column:1/-1">' + (co ? "En tu código: <code>" + esc(co.v) + "</code> <code>" + esc(co.cls) + "</code>" + (co.mat && co.mat.shared > 1 ? " · material compartido" : "") + '</div><div class="ed-note" style="grid-column:1/-1"><b class="lv-tag">&lt;/&gt;</b> se escribe en el código · <b class="lv-tag lv-anim">+</b> tu código lo anima en cada cuadro: el ajuste se suma' : "Este objeto no tiene una variable en el código (p. ej. viene de un modelo): los ajustes se suman y quedan en el bloque ▸ musa.") + "</div>"
          /* sin controles que no cambian nada: la luz ambiente no tiene posición y un material de puntos o básico no tiene brillo propio */
          + '<div class="lv-grid">' + P3[kind].filter(function (pr) { return !((rt.nopos && /^p[xyz]$/.test(pr)) || (pr === "emi" && rt.emi === 0)); }).map(function (pr) { return row3(c, ctx, pr, lt, ov); }).join("") + "</div>"
          + valsHTML(objVals(L.src, co), true)
          + '<div class="ed-note" style="grid-column:1/-1">Unidades de la escena 3D; giros en grados. ' + (sc.objs.length >= 160 ? "Se muestran los primeros 160 objetos. " : "") + "Ponle <code>name</code> a tus objetos en el código para encontrarlos fácil.</div>"
          + '<div class="ed-row" style="grid-column:1/-1">' + (touched ? '<button class="ed-btn" data-lact="reset3">Quitar keyframes y ajustes (+) de este objeto</button>' : "") + (musaAdded ? '<button class="ed-btn" data-lact="del3">Quitar este objeto del código</button>' : "") + '<button class="ed-btn" data-lact="scene">Volver a leer la escena</button></div>'
          + addRow);
      } else {
        h += sec("Escena 3D", '<div class="ed-note" style="grid-column:1/-1">' + (I && I.st === "ok" ? "La escena aparece cuando el código dibuja su primer cuadro con Three.js." : "Se lee cuando el código termina de cargar.") + '</div><div class="ed-row" style="grid-column:1/-1"><button class="ed-btn" data-lact="scene">Leer la escena</button></div>' + addRow, true);
      }
    }
    var allV = ML.codeValues(L.src).filter(function (x) { return x.via === "value"; });
    if (allV.length) {
      var groups = [], byG = {};
      allV.forEach(function (x) { var g = x.objLabel || "Escena, fondo y otros"; if (!byG[g]) { byG[g] = []; groups.push(g); } byG[g].push(x); });
      h += sec("Todos los valores del código · " + allV.length,
        '<div class="ed-note" style="grid-column:1/-1">Cada número, color, sí/no y nombre que hay en el código de este clip, con su control: forma de cada objeto, material, animación, fondo, cantidad de elementos. Cambiar uno reescribe ese valor en el código.</div>'
        + groups.map(function (g) { return '<div class="ed-mh lv-gh" style="grid-column:1/-1">' + esc(g) + "</div>" + valsHTML(byG[g], false); }).join(""), false);
    }
    return h;
  }
  /* los valores del código que pertenecen a un objeto (su forma, su material, su animación) */
  function objVals(src, co) {
    if (!co) return [];
    var key = co.kind === "cam" ? "cam" : co.name ? "n:" + co.name : "v:" + co.v;
    return ML.codeValues(src).filter(function (x) { return x.via === "value" && x.obj === key; });
  }
  function valsHTML(list, heads) {
    if (!list.length) return "";
    var h = "", last = null;
    list.forEach(function (x) {
      if (heads && x.part !== last) { last = x.part; h += '<div class="ed-mh lv-gh">' + esc(x.part || "Otros valores") + "</div>"; }
      var opt = x.type === "num" ? { step: x.int ? 1 : Math.abs(x.v) >= 10 ? 1 : Math.abs(x.v) >= 1 ? 0.1 : 0.01 } : {};
      h += field(String(x.i), x.label, x.type === "text" ? "text" : x.type, x.v, opt, "data-lc", false, null, 0, '<i class="lv-tag" title="' + esc("En tu código: " + x.code) + '">&lt;/&gt;</i>');
    });
    return '<div class="lv-grid lv-vals">' + h + "</div>";
  }
  var OPENS = {};
  var _insp = veInsp;
  veInsp = function () {
    var r = _insp.apply(this, arguments);
    try {
      var box = vq0("#veInsp"); if (!box) return r;
      var old = box.querySelector(".ve-live-insp"); if (old) old.remove();
      var c = selLive(); if (!c) return r;
      var wrap = document.createElement("div"); wrap.className = "ve-live-insp"; wrap.innerHTML = inspHTML(c);
      /* cada sección recuerda si la dejaste abierta o cerrada (el inspector se vuelve a dibujar con cada cambio) */
      [].forEach.call(wrap.querySelectorAll("details.ed-sec"), function (dt) {
        var sm = dt.querySelector("summary"), key = sm ? sm.textContent.split("·")[0].trim() : "";
        if (key in OPENS) dt.open = OPENS[key];
        dt.addEventListener("toggle", function () { OPENS[key] = dt.open; });
      });
      var first = box.querySelector(".ed-sec");
      if (first) box.insertBefore(wrap, first); else box.appendChild(wrap);
    } catch (e) { console.warn("[código vivo] inspector", e); }
    return r;
  };

  /* ── cambios desde el inspector: siempre al código ── */
  var lastSnap = { k: null, at: 0 };
  function snapOnce(k) { var now = Date.now(); if (lastSnap.k !== k || now - lastSnap.at > 1500) { if (typeof vsnap === "function") vsnap(); } lastSnap = { k: k, at: now }; }
  function paramOf(c, key) { return anOf(c.live).params.find(function (p) { return p.key === key; }) || null; }
  /* keyframe en el instante lt (lo cambia si ya hay uno ahí) */
  function kfAt(ent, lt, val) { var kf = ((ent && ent.kf) || []).map(function (k) { return Object.assign({}, k); }), k = kf.find(function (x) { return Math.abs(x.t - lt) < 0.02; }); if (k) k.v = val; else { kf.push({ t: lt, v: val }); kf.sort(function (a, b) { return a.t - b.t; }); } return { kf: kf }; }
  function kick() { if (VE.open) veStage(); }
  function readVal(el, type) {
    if (type === "num") { var n = parseFloat(el.value); return isFinite(n) ? n : 0; }
    if (type === "hex") return parseInt(String(el.value).replace("#", ""), 16) || 0;
    if (type === "bool") return el.value === "1";
    return el.value;
  }
  function twin(el) { var t = el.parentNode.querySelector((el.type === "range" ? 'input[type="number"]' : 'input[type="range"]')); if (t && t !== el) t.value = el.value; }
  function onEdit(e) {
    var el = e.target, c = selLive(); if (!c || !el.closest || !el.closest(".ve-live-insp")) return;
    var d = el.dataset, L = norm(c);
    if (d.lv) {
      if (e.type === "input" && el.type === "number" && el.value === "") return;
      snapOnce(d.lv);
      var v = parseFloat(el.value);
      if (d.lv === "lv.off") L.off = isFinite(v) ? Math.max(0, v) : 0;
      else if (d.lv === "lv.speed") L.speed = isFinite(v) ? v : 1;
      else if (d.lv === "lv.loop") { if (v > 0) L.loop = v; else delete L.loop; }
      kick(); return;
    }
    if (d.lc != null) {
      var it = ML.codeValues(L.src)[+d.lc]; if (!it) return;
      if (it.type === "text" && e.type !== "change") return;
      if (e.type === "input" && el.type === "number" && el.value === "") return;
      var cv = it.type === "num" ? parseFloat(el.value) : it.type === "bool" ? el.value === "1" : el.value;
      if (it.type === "num" && !isFinite(cv)) return;
      snapOnce("lc" + d.lc); LASTIN = Date.now();
      var ns = ML.setCodeValue(L.src, +d.lc, cv); if (ns === L.src) return;
      if (it.type === "text") { var nn = String(cv).replace(/[\n\r]/g, " ").trim().slice(0, 80); if (SEL3[c.id] === "n:" + it.v) SEL3[c.id] = "n:" + nn; var Ic = INST[c.id]; if (Ic) Ic.sceneOld = true; }
      setSrc(c, ns);
      if (it.type === "text") setTimeout(refreshInsp, 80);
      return;
    }
    if (d.lp) {
      var p = paramOf(c, d.lp); if (!p) return;
      if (e.type === "input" && el.type === "number" && el.value === "") return;
      snapOnce(d.lp); LASTIN = Date.now(); twin(el);
      var val = readVal(el, p.type), ent = L.ov[d.lp];
      if (ent && ent.kf && ent.kf.length) setSrc(c, ML.setOv(L.src, d.lp, kfAt(ent, ltOf(c), val)));
      else { preview(c, d.lp, p.key.charAt(0) === "v" ? null : { v: val }); setSrc(c, ML.setOv(ML.setParam(L.src, d.lp, val), d.lp, null), true); }
      return;
    }
    if (d.l3) {
      var pr = d.l3.slice(d.l3.lastIndexOf("|") + 1), tp = type3(pr);
      if (e.type === "input" && el.type === "number" && el.value === "") return;
      snapOnce(d.l3); LASTIN = Date.now();
      var v3 = readVal(el, tp), ctx = ctx3(c), sl = ctx.co && ctx.co.slots[pr], ent3 = L.ov[d.l3], hasKf = !!(ent3 && ent3.kf && ent3.kf.length);
      if (sl && sl.mode !== "over") {
        if (hasKf) setSrc(c, ML.setOv(L.src, d.l3, kfAt(ent3, ltOf(c), ML.toOff3(pr, v3, baseOf(L.src, ctx.co, pr, ctx.rt, ctx.sc)))));
        else { preview3(c, ctx.rt, ctx.co, pr, v3, ctx.sc); setSrc(c, ML.setOv(ML.set3(L.src, ctx.co.v, pr, v3), d.l3, null), true); }
      } else setSrc(c, ML.setOv(L.src, d.l3, hasKf ? kfAt(ent3, ltOf(c), v3) : { v: v3 }));
      return;
    }
    if (d.l3sel && e.type === "change") { SEL3[c.id] = el.value; refreshInsp(); }
    if (d.l3add != null && e.type === "change") ADDT[c.id] = el.value;
  }
  var insp = vq0("#veInsp");
  if (insp) {
    insp.addEventListener("input", onEdit);
    insp.addEventListener("change", onEdit);
    insp.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest(".ve-live-insp [data-lk], .ve-live-insp [data-lact]"); if (!b) return;
      var c = selLive(); if (!c) return;
      e.preventDefault(); e.stopPropagation();
      var L = norm(c), ov = L.ov || {};
      if (b.dataset.lk) {
        var key = b.dataset.lk, ent = ov[key], lt = ltOf(c), is3 = key.indexOf("o:") === 0;
        if (typeof vsnap === "function") vsnap();
        var cur = b.parentNode.querySelector('input[type="number"], input[type="color"], select, input[type="text"]');
        var p = is3 ? null : paramOf(c, key), pr = is3 ? key.slice(key.lastIndexOf("|") + 1) : null, tp = p ? p.type : type3(pr);
        var shown = cur ? readVal(cur, tp) : ML.valAt(ent, lt, p ? p.v : 0), val = shown;
        if (is3) { var ctx = ctx3(c), sl = ctx.co && ctx.co.slots[pr]; if (sl && sl.mode !== "over") val = ML.toOff3(pr, shown, baseOf(L.src, ctx.co, pr, ctx.rt, ctx.sc)); }
        var kf = ent && ent.kf ? ent.kf.slice() : [], at = kf.findIndex(function (k) { return Math.abs(k.t - lt) < 0.02; }), next;
        if (at >= 0) { kf.splice(at, 1); next = kf.length ? { kf: kf } : is3 && !(ctx3(c).co && ctx3(c).co.slots[pr] && ctx3(c).co.slots[pr].mode !== "over") ? { v: val } : null; }
        else next = kfAt(ent && ent.kf ? ent : null, lt, val);
        setSrc(c, ML.setOv(L.src, key, next));
        refreshInsp(); return;
      }
      var act = b.dataset.lact, I = INST[c.id];
      if (act === "edit") { if (CP.el && !CP.el.hidden && CP.c === c) cpClose(); else cpOpen(c); refreshInsp(); return; }
      if (act === "reload") { if (I) kill(I); kick(); setTimeout(refreshInsp, 50); return; }
      if (act === "scene") { if (I) { I.scene = null; I.cli.scene(); } kick(); return; }
      if (act === "resetp" || act === "reset3") {
        if (typeof vsnap === "function") vsnap();
        var r3 = act === "reset3" ? "o:" + ctx3(c).rt.k + "|" : null, src = L.src;
        Object.keys(ov).forEach(function (k) { if (r3 ? k.indexOf(r3) === 0 : k.indexOf("o:") !== 0) src = ML.setOv(src, k, null); });
        setSrc(c, src); refreshInsp(); return;
      }
      if (act === "add3") {
        var ty = (b.parentNode.querySelector("[data-l3add]") || {}).value || ADDT[c.id] || "box", r = ML.addObject(L.src, { type: ty });
        if (!r) { toast(ML.isR3 && ML.isR3(L.src) ? "No encontré el cierre del lienzo 3D (</ThreeCanvas> o </Canvas>) en el código para agregar el objeto" : "No encontré la escena (new THREE.Scene()) en el código para agregar el objeto"); return; }
        if (typeof vsnap === "function") vsnap();
        ADDT[c.id] = ty; SEL3[c.id] = "n:" + r.name; setSrc(c, r.src);
        if (I) I.scene = null;
        toast(r.v ? "«" + r.name + "» quedó en tu código (" + r.v + "): se edita aquí y en el código" : "«" + r.name + "» quedó en tu código: se edita aquí y en el código");
        setTimeout(refreshInsp, 60); return;
      }
      if (act === "del3") {
        var cx = ctx3(c), nsrc = cx.co ? ML.removeObject(L.src, cx.co.v) : null; if (!nsrc) return;
        if (typeof vsnap === "function") vsnap();
        Object.keys(ov).forEach(function (k) { if (k.indexOf("o:" + cx.rt.k + "|") === 0) nsrc = ML.setOv(nsrc, k, null); });
        SEL3[c.id] = "cam"; setSrc(c, nsrc); if (I) I.scene = null;
        toast("Quité «" + (cx.rt.n || cx.co.v) + "» del código"); setTimeout(refreshInsp, 60); return;
      }
    }, true);
  }

  /* ═════════════ código del clip: panel al lado, en vivo en los dos sentidos ═════════════
     Lo que cambia el inspector, el MCP, deshacer o el código del video aparece aquí al instante (la línea se ilumina);
     lo que escribes aquí se aplica solo al dejar de escribir y el inspector vuelve a leer parámetros y objetos. */
  var CP = { el: null, c: null, dirty: false, auto: null, fl: null, snap: false };
  function hlCode(src) {
    var out = "", re = /(<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(<\/?[a-zA-Z][\w-]*|\/?>)|(\b(?:const|let|var|function|return|import|from|export|default|new|if|else|for|while|true|false|null|this)\b)|(\b-?\d*\.?\d+\b|\b0x[0-9a-fA-F]+\b)/g, last = 0, m;
    while ((m = re.exec(src))) {
      out += esc(src.slice(last, m.index));
      var cls = m[1] ? (/▸ musa/.test(m[1]) ? "c mb" : "c") : m[2] ? "s" : m[3] ? "k" : m[4] ? "g" : "n";
      out += '<span class="' + cls + '">' + esc(m[0]) + "</span>";
      last = m.index + m[0].length;
    }
    return out + esc(src.slice(last)) + "\n";
  }
  function cpBuild() {
    if (CP.el) return CP.el;
    var el = document.createElement("div"); el.id = "veLiveCode"; el.hidden = true; el.setAttribute("role", "region"); el.setAttribute("aria-label", "Código del clip");
    el.innerHTML = '<div class="lc-h"><b>&lt;/&gt; Código del clip</b><span class="lc-n"></span><span class="lc-sp"></span><button type="button" class="lc-b p" data-lc="apply" title="Aplicar ahora (Ctrl+Enter)">Aplicar</button><button type="button" class="lc-b" data-lc="copy">Copiar</button><button type="button" class="lc-x" data-lc="close" aria-label="Cerrar el código del clip">×</button></div>'
      + '<div class="lc-ed"><div class="lc-gut" aria-hidden="true"></div><div class="lc-wrap"><div class="lc-fl" aria-hidden="true" hidden></div><pre class="lc-hl" aria-hidden="true"></pre><textarea spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Código del clip (editable)"></textarea></div></div>'
      + '<div class="lc-st" role="status"><i></i><span>Listo</span></div>';
    document.body.appendChild(el);
    CP.el = el; CP.ta = el.querySelector("textarea"); CP.hl = el.querySelector(".lc-hl"); CP.gut = el.querySelector(".lc-gut"); CP.flEl = el.querySelector(".lc-fl"); CP.st = el.querySelector(".lc-st span"); CP.dot = el.querySelector(".lc-st i"); CP.nm = el.querySelector(".lc-n");
    var ta = CP.ta;
    ta.addEventListener("scroll", cpScroll);
    ta.addEventListener("input", function () {
      if (!CP.dirty && typeof vsnap === "function") vsnap();
      CP.dirty = true; cpPaint(); cpStatus("Cambios sin aplicar · se aplican solos al dejar de escribir (Ctrl+Enter = ya)", "d");
      clearTimeout(CP.auto); CP.auto = setTimeout(function () { cpApply(false); }, 900);
    });
    ta.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); clearTimeout(CP.auto); cpApply(true); return; }
      if (e.key === "Tab") { e.preventDefault(); var s0 = ta.selectionStart, s1 = ta.selectionEnd; ta.setRangeText("  ", s0, s1, "end"); ta.dispatchEvent(new Event("input")); }
      if (e.key === "Escape") ta.blur();
    });
    ta.addEventListener("keyup", function (e) { e.stopPropagation(); });
    el.addEventListener("click", function (e) {
      var b = e.target.closest("[data-lc]"); if (!b) return;
      var a = b.dataset.lc;
      if (a === "close") return cpClose();
      if (a === "apply") { clearTimeout(CP.auto); return cpApply(true); }
      if (a === "copy") { try { navigator.clipboard.writeText(ta.value).then(function () { cpStatus("Código copiado", ""); }, function () { ta.select(); document.execCommand("copy"); }); } catch (er) { ta.select(); document.execCommand("copy"); } }
    });
    addEventListener("resize", function () { if (!el.hidden) cpPlace(); });
    setInterval(cpTick, 400);
    return el;
  }
  function cpPlace() {
    var el = CP.el, top = document.querySelector("#ve .ed-tr"), tl = document.querySelector("#ve .ve-tlbar") || document.querySelector("#veLanes"), bin = document.querySelector("#veBin");
    var t0 = top ? top.getBoundingClientRect().bottom : 48, b0 = tl ? tl.getBoundingClientRect().top : innerHeight * 0.65;
    if (b0 - t0 < 240) b0 = innerHeight - 8;
    var l0 = bin ? Math.max(0, bin.getBoundingClientRect().left) : 60;
    if (innerWidth < 860) l0 = 0;
    el.style.top = t0 + "px"; el.style.height = Math.max(220, b0 - t0) + "px"; el.style.left = l0 + "px"; el.style.width = Math.min(innerWidth - l0, Math.max(360, Math.min(620, innerWidth * 0.36))) + "px";
  }
  function cpStatus(m, k) { if (!CP.st) return; CP.st.textContent = m; CP.dot.className = k || ""; }
  function cpScroll() { CP.hl.scrollTop = CP.ta.scrollTop; CP.hl.scrollLeft = CP.ta.scrollLeft; CP.gut.scrollTop = CP.ta.scrollTop; cpFlashPos(); }
  var cpPT = null;
  function cpPaint() {
    clearTimeout(cpPT);
    cpPT = setTimeout(function () {
      var v = CP.ta.value; CP.hl.innerHTML = v.length < 400000 ? hlCode(v) : esc(v);
      var n = v.split("\n").length, g = ""; for (var i = 1; i <= n; i++) g += i + "\n"; CP.gut.textContent = g; cpScroll();
    }, 40);
  }
  var LH = 12 * 1.55;
  function cpFlashPos() { var f = CP.fl; if (!f || !CP.flEl) return; CP.flEl.style.top = (10 + f.a * LH - CP.ta.scrollTop) + "px"; CP.flEl.style.height = ((f.b - f.a + 1) * LH) + "px"; }
  /* el código cambió desde fuera: se escribe, se ilumina lo que cambió y se lleva a la vista */
  function cpSet(src, why) {
    var ta = CP.ta, old = ta.value; if (old === src) return;
    var a = 0, n = Math.min(old.length, src.length); while (a < n && old.charCodeAt(a) === src.charCodeAt(a)) a++;
    var b1 = old.length, b2 = src.length; while (b1 > a && b2 > a && old.charCodeAt(b1 - 1) === src.charCodeAt(b2 - 1)) { b1--; b2--; }
    var top = ta.scrollTop, caret = ta.selectionStart;
    ta.value = src; cpPaint();
    if (old) {
      var la = src.slice(0, a).split("\n").length - 1, lb = src.slice(0, Math.max(a, b2)).split("\n").length - 1;
      CP.fl = { a: la, b: Math.max(la, lb) }; CP.flEl.hidden = false; CP.flEl.classList.remove("go"); void CP.flEl.offsetWidth; CP.flEl.classList.add("go");
      clearTimeout(CP.flT); CP.flT = setTimeout(function () { CP.flEl.hidden = true; CP.fl = null; }, 1600);
      var y = la * LH;
      ta.scrollTop = y < top || y > top + ta.clientHeight - 3 * LH ? Math.max(0, y - ta.clientHeight / 3) : top;
      try { if (document.activeElement === ta) ta.selectionStart = ta.selectionEnd = Math.min(caret, src.length); } catch (e) { /* sin selección */ }
      cpStatus((why === "inspector" ? "Escrito desde el inspector" : "El código cambió (inspector, MCP o deshacer)") + " · línea " + (la + 1), "");
    }
    cpScroll();
  }
  function cpExternal(c) { if (!CP.el || CP.el.hidden || CP.c !== c || CP.dirty) return; cpSet(c.live.src, arguments[1]); }
  function cpOpen(c) {
    if (!c) return; cpBuild();
    if (CP.dirty && CP.c && CP.c !== c) cpApply(true);
    CP.c = c; CP.dirty = false; CP.el.hidden = false; cpPlace();
    CP.nm.textContent = "· " + (c.name || "clip");
    CP.ta.value = ""; cpSet(norm(c).src); CP.flEl.hidden = true;
    cpStatus("En vivo: lo que cambies en el inspector o por MCP se escribe aquí; lo que escribas aquí se aplica solo", "");
  }
  function cpClose() { if (!CP.el) return; if (CP.dirty) cpApply(true); CP.el.hidden = true; refreshInsp(); }
  function cpApply(force) {
    var c = CP.c; if (!c || !c.live || !CP.dirty) return;
    var v = CP.ta.value; if (!v.trim()) { cpStatus("El código está vacío: no se aplicó", "e"); return; }
    var b = ML.blockOf(v);
    if (b.has && b.err && !force) { cpStatus("El bloque ▸ musa tiene un error (" + shortErr(b.err) + "): corrígelo o Ctrl+Enter para aplicar sin sus ajustes", "e"); return; }
    CP.dirty = false;
    c.live.kind = kindOf(v); setSrc(c, v);
    var an = anOf(c.live), objs = an.lib === "three" ? ML.codeObjects(v).length : 0;
    cpStatus("Aplicado · " + an.params.length + " parámetro(s)" + (objs ? " · " + objs + " objeto(s) 3D del código" : "") + " editables en el inspector" + (b.err ? " · bloque ▸ musa con error (sin ajustes)" : ""), b.err ? "d" : "");
    if (typeof veInsp === "function") veInsp();
  }
  function cpTick() {
    if (!CP.el || CP.el.hidden) return;
    if (!VE.open || !VE.p) return cpClose();
    var s = selLive();
    if (s && s !== CP.c && !CP.dirty) cpOpen(s);
    var c = CP.c;
    if (!c || !VE.p.m || VE.p.m.indexOf(c) < 0) { var again = c && (VE.p.m || []).find(function (x) { return x.id === c.id && x.live; }); if (again) { CP.c = again; c = again; } else return cpClose(); }
    if (!CP.dirty && c.live.src !== CP.ta.value) cpSet(norm(c).src);
  }
  function kindOf(src) {
    var k = window.MusaVideoCode ? window.MusaVideoCode.detect(src) : "html";
    return k === "remotion" ? "remotion" : "html";
  }
  /* ventana para pegar código nuevo (clip nuevo) */
  function codeModal(title, src, note, onApply) {
    var old = vq0(".ve-live-modal"); if (old) old.remove();
    var m = document.createElement("div"); m.className = "ve-live-modal"; m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true"); m.setAttribute("aria-label", title);
    m.innerHTML = '<div class="lvm-box"><div class="lvm-h"><b>' + esc(title) + '</b><button type="button" class="lvm-x" aria-label="Cerrar">×</button></div>'
      + '<textarea spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Código"></textarea>'
      + '<div class="lvm-n">' + note + '</div><div class="lvm-f"><span class="lvm-err" role="status"></span><button type="button" class="ed-btn" data-m="no">Cancelar</button><button type="button" class="ed-btn pri" data-m="ok">Aplicar · Ctrl+Enter</button></div></div>';
    document.body.appendChild(m);
    var ta = m.querySelector("textarea"); ta.value = src || "";
    var close = function () { m.remove(); };
    var ok = function () {
      var v = ta.value; if (!v.trim()) { m.querySelector(".lvm-err").textContent = "Pega o escribe código primero."; return; }
      try { onApply(v); close(); } catch (er) { m.querySelector(".lvm-err").textContent = shortErr(er.message); }
    };
    m.addEventListener("click", function (e) { var b = e.target.closest("[data-m], .lvm-x"); if (!b) { if (e.target === m) close(); return; } if (b.dataset.m === "ok") ok(); else close(); });
    ta.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ok(); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "Tab") { e.preventDefault(); var s0 = ta.selectionStart, s1 = ta.selectionEnd; ta.value = ta.value.slice(0, s0) + "  " + ta.value.slice(s1); ta.selectionStart = ta.selectionEnd = s0 + 2; }
    });
    setTimeout(function () { ta.focus(); }, 30);
    return m;
  }

  /* ═════════════ biblioteca: «3D y código» ═════════════ */
  var TPL = [
    { n: "Cubo 3D", sub: "Three.js · color, tamaño, velocidad", w: 70, ar: 1, kind: "html", src: [
      '<!doctype html>', '<html>', '<head><meta charset="utf-8"><title>Cubo 3D</title>', '<style>html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; }</style></head>', '<body>', '<script type="module">',
      'import * as THREE from "three";', '',
      '// Parámetros: Musa los muestra en el inspector y se pueden animar con keyframes ◆',
      'const params = { speed: 1, size: 1.6, color: "#ff5e00", tilt: 0.45, light: 2.4 };', '',
      'const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });',
      'renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight); document.body.appendChild(renderer.domElement);',
      'const scene = new THREE.Scene();',
      'const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 100); camera.position.set(0, 0, 6);',
      'const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: params.color, roughness: 0.35, metalness: 0.2 }));',
      'cube.name = "Cubo"; scene.add(cube);',
      'const key = new THREE.DirectionalLight(0xffffff, params.light); key.name = "Luz principal"; key.position.set(3, 4, 5); scene.add(key);',
      'const amb = new THREE.AmbientLight(0xffffff, 0.6); amb.name = "Luz ambiente"; scene.add(amb);',
      'addEventListener("resize", () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });', '',
      'renderer.setAnimationLoop((ms) => {', '  const t = ms / 1000;', '  cube.scale.setScalar(params.size);', '  cube.rotation.set(params.tilt, t * params.speed, 0);', '  cube.material.color.set(params.color);', '  key.intensity = params.light;', '  renderer.render(scene, camera);', '});',
      '</script>', '</body>', '</html>'].join("\n") },
    { n: "Partículas 3D", sub: "Three.js · cantidad, color, giro", w: 100, ar: 0, kind: "html", src: [
      '<!doctype html>', '<html>', '<head><meta charset="utf-8"><title>Partículas 3D</title>', '<style>html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; }</style></head>', '<body>', '<script type="module">',
      'import * as THREE from "three";', '',
      'const COUNT = 4000;', 'const params = { spin: 0.25, size: 0.045, color: "#d2ff02", radius: 2.4, wave: 0.35 };', '',
      'const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });',
      'renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight); document.body.appendChild(renderer.domElement);',
      'const scene = new THREE.Scene();', 'const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100); camera.position.set(0, 0, 7);',
      'const pos = new Float32Array(COUNT * 3);',
      'for (let i = 0; i < COUNT; i++) { const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.cbrt(Math.random()); const s = Math.sqrt(1 - u * u); pos.set([s * Math.cos(a) * r, u * r, s * Math.sin(a) * r], i * 3); }',
      'const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));',
      'const mat = new THREE.PointsMaterial({ color: params.color, size: params.size, transparent: true, opacity: 0.9, depthWrite: false });',
      'const cloud = new THREE.Points(geo, mat); cloud.name = "Nube"; scene.add(cloud);',
      'addEventListener("resize", () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });', '',
      'renderer.setAnimationLoop((ms) => {', '  const t = ms / 1000;', '  cloud.rotation.y = t * params.spin;', '  cloud.rotation.x = Math.sin(t * 0.7) * params.wave;',
      '  cloud.scale.setScalar(params.radius);', '  mat.size = params.size; mat.color.set(params.color);', '  renderer.render(scene, camera);', '});',
      '</script>', '</body>', '</html>'].join("\n") },
    { n: "Degradado vivo", sub: "WebGL (shader) · dos colores y velocidad", w: 100, ar: 0, kind: "html", src: [
      '<!doctype html>', '<html>', '<head><meta charset="utf-8"><title>Degradado vivo</title>', '<style>html, body { margin: 0; height: 100%; overflow: hidden; } canvas { width: 100%; height: 100%; display: block; }</style></head>', '<body><canvas id="c"></canvas>', '<script>',
      'const params = { a: "#ff5e00", b: "#3b1cff", speed: 0.6, scale: 2.2 };', '',
      'const cv = document.getElementById("c"), gl = cv.getContext("webgl");',
      'const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);',
      'const vs = "attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }";',
      'const fs = "precision highp float; uniform vec2 r; uniform float t, k; uniform vec3 a, b;" +',
      '  "void main(){ vec2 u = gl_FragCoord.xy / r * k; float n = sin(u.x + t) + sin(u.y * 1.3 - t * .8) + sin((u.x + u.y) * .7 + t * 1.3);" +',
      '  "gl_FragColor = vec4(mix(a, b, .5 + .25 * n), 1.); }";',
      'const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };',
      'const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr); gl.useProgram(pr);',
      'gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);',
      'const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);',
      'const U = (n) => gl.getUniformLocation(pr, n);', '',
      'function draw(ms) {', '  cv.width = innerWidth; cv.height = innerHeight; gl.viewport(0, 0, cv.width, cv.height);',
      '  gl.uniform2f(U("r"), cv.width, cv.height); gl.uniform1f(U("t"), ms / 1000 * params.speed * 3); gl.uniform1f(U("k"), params.scale * 3);',
      '  gl.uniform3fv(U("a"), hex(params.a)); gl.uniform3fv(U("b"), hex(params.b));', '  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);', '  requestAnimationFrame(draw);', '}', 'requestAnimationFrame(draw);',
      '</script>', '</body>', '</html>'].join("\n") },
    { n: "Ondas generativas", sub: "p5.js · líneas, color y ruido", w: 100, ar: 0, kind: "html", src: [
      '<!doctype html>', '<html>', '<head><meta charset="utf-8"><title>Ondas generativas</title>', '<script src="https://cdn.jsdelivr.net/npm/p5@1.11.1/lib/p5.min.js"></script>', '<style>html, body { margin: 0; overflow: hidden; }</style></head>', '<body>', '<script>',
      'const params = { lines: 26, amp: 90, speed: 0.6, ink: "#f9f9f2", paper: "#111111", weight: 2 };', '',
      'function setup() { createCanvas(windowWidth, windowHeight); noFill(); }',
      'function windowResized() { resizeCanvas(windowWidth, windowHeight); }',
      'function draw() {', '  background(params.paper); stroke(params.ink); strokeWeight(params.weight);', '  const t = millis() / 1000 * params.speed;',
      '  for (let i = 0; i < params.lines; i++) {', '    const y0 = map(i, 0, params.lines - 1, height * 0.15, height * 0.85);', '    beginShape();',
      '    for (let x = 0; x <= width; x += 12) vertex(x, y0 + (noise(x * 0.004, i * 0.12, t) - 0.5) * params.amp * 2);', '    endShape();', '  }', '}',
      '</script>', '</body>', '</html>'].join("\n") },
    { n: "Nudo 3D (Remotion)", sub: "@remotion/three · props editables", w: 70, ar: 1, kind: "remotion", W: 1080, H: 1080, src: [
      'import React from "react";', 'import { Composition, registerRoot, useCurrentFrame, useVideoConfig, interpolate } from "remotion";', 'import { ThreeCanvas } from "@remotion/three";', '',
      'export const Nudo: React.FC<{ color: string; speed: number; size: number }> = ({ color, speed, size }) => {',
      '  const frame = useCurrentFrame();', '  const { width, height } = useVideoConfig();', '  const grow = interpolate(frame, [0, 20], [0, size], { extrapolateRight: "clamp" });',
      '  return (', '    <ThreeCanvas width={width} height={height}>', '      <ambientLight intensity={0.6} />', '      <directionalLight position={[3, 4, 5]} intensity={2.2} />',
      '      <mesh rotation={[0.5, (frame / 30) * speed, 0]} scale={grow}>', '        <torusKnotGeometry args={[0.8, 0.28, 160, 24]} />', '        <meshStandardMaterial color={color} roughness={0.3} metalness={0.3} />', '      </mesh>', '    </ThreeCanvas>', '  );', '};', '',
      'export const RemotionRoot: React.FC = () => (',
      '  <Composition id="Main" component={Nudo} durationInFrames={150} fps={30} width={1080} height={1080} defaultProps={{ color: "#ff5e00", speed: 1, size: 1.4 }} />', ');', 'registerRoot(RemotionRoot);'].join("\n") },
  ];
  function addLive(src, kind, name, opt) {
    if (!VE.p) return null;
    if (typeof vsnap === "function") vsnap();
    var p = VE.p, dur = opt.dur || 5, st = Math.round(Math.max(0, Math.min(VE.t, Math.max(0, veDur(p) - 0.5))) * 100) / 100;
    var full = !opt.ar, c = { id: nid(), name: name || "Código 3D", start: st, dur: dur, x: 50, y: 50, w: opt.w || 100, ar: full ? Math.round(W0() / H0() * 1e4) / 1e4 : opt.ar, radius: 0, bg: "transparent", anim: "none", opacity: 1,
      live: { src: src, kind: kind || kindOf(src), sel: -1, off: 0, speed: 1, ov: {} } };
    if (opt.W) { c.live.W = opt.W; c.live.H = opt.H; }
    p.m.push(c); VE.sel = { tr: "m", i: p.m.length - 1 };
    veAll(); veInsp();
    toast("Clip de código agregado en M: sus parámetros y su escena se editan en el inspector");
    return c;
  }
  var _bin = veBin;
  veBin = function () {
    var r = _bin.apply(this, arguments), box = vq0("#veBin");
    if (!box || !VE.p || VE.tab !== "media" || box.querySelector("[data-livetpl]")) return r;
    var item = function (l, sub, attrs) { return '<button class="ve-item" ' + attrs + '><span class="ve-bth lv-th" aria-hidden="true">3D</span><span><b>' + esc(l) + "</b><small>" + esc(sub) + "</small></span><i>+</i></button>"; };
    var h = '<div class="ve-bsec"><div class="ed-mh">3D y código — Three.js, p5, WebGL, Remotion</div>'
      + '<button class="ve-item" data-livenew="1"><span class="ve-bth lv-th" aria-hidden="true">&lt;/&gt;</span><span><b>Pegar código…</b><small>HTML, JS suelto o Remotion: entra como clip editable</small></span><i>+</i></button>'
      + TPL.map(function (t, i) { return item(t.n, t.sub, 'data-livetpl="' + i + '"'); }).join("") + "</div>";
    var after = box.querySelector(".ve-bsec:nth-of-type(2)");
    if (after) after.insertAdjacentHTML("afterend", h); else box.insertAdjacentHTML("beforeend", h);
    return r;
  };
  var bin = vq0("#veBin");
  if (bin) bin.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-livetpl],[data-livenew]"); if (!b || !VE.p) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (b.dataset.livenew) {
      codeModal("Pegar código 3D / canvas", "", "Three.js, React Three Fiber (Remotion con &lt;ThreeCanvas&gt;), p5.js, PixiJS, WebGL o canvas: HTML completo o JS suelto. El código que hacen las skills de HyperFrames, Remotion y onetake entra tal cual y queda editable: sus parámetros y sus objetos 3D aparecen en el inspector, y lo que cambies ahí se escribe en este código. Para mover textos y formas por separado usa «&lt;/&gt; Código» o Crear › Videos › «Desde código».", function (v) {
        var kind = kindOf(v), an = ML.analyze(v), lib = ML.LIB_NAMES[an.lib] || "Código";
        addLive(v, kind, lib + " · " + ((/<title>([^<]{1,60})<\/title>/i.exec(v) || [])[1] || "clip"), { w: 100, ar: 0 });
      });
      return;
    }
    var t = TPL[+b.dataset.livetpl]; if (!t) return;
    addLive(t.src, t.kind, t.n, { w: t.w, ar: t.ar, W: t.W, H: t.H });
  }, true);

  /* ═════════════ editar en el lienzo: clic en un objeto 3D → se elige; arrastrar lo mueve; las esquinas lo agrandan;
     barra con color, duplicar y quitar. Todo pasa por put3(): lo mismo que escribir el valor en el inspector, o sea
     que queda en el código. ═════════════ */
  var DRAG = null;
  function r3(v) { return Math.round(v * 1000) / 1000; }
  function get3(c, pr) {
    var L = norm(c), ctx = ctx3(c), lt = ltOf(c), e = (L.ov || {})["o:" + ctx.rt.k + "|" + pr], sl = ctx.co && ctx.co.slots[pr];
    if (sl && sl.mode !== "over") return ML.comb3(pr, baseOf(L.src, ctx.co, pr, ctx.rt, ctx.sc), ML.valAt(e, lt, undefined));
    return ML.valAt(e, lt, pr === "color" || pr === "emi" || pr === "vis" || pr === "fov" ? def3(pr, ctx.rt, ctx.sc) : ML.off0(pr));
  }
  function put3(c, pr, v3) {
    var L = norm(c), ctx = ctx3(c), key = "o:" + ctx.rt.k + "|" + pr, sl = ctx.co && ctx.co.slots[pr], ent = L.ov[key], hasKf = !!(ent && ent.kf && ent.kf.length);
    LASTIN = Date.now();
    if (sl && sl.mode !== "over") {
      if (hasKf) setSrc(c, ML.setOv(L.src, key, kfAt(ent, ltOf(c), ML.toOff3(pr, v3, baseOf(L.src, ctx.co, pr, ctx.rt, ctx.sc)))));
      else { preview3(c, ctx.rt, ctx.co, pr, v3, ctx.sc); setSrc(c, ML.setOv(ML.set3(L.src, ctx.co.v, pr, v3), key, null), true); }
    } else setSrc(c, ML.setOv(L.src, key, hasKf ? kfAt(ent, ltOf(c), v3) : { v: v3 }));
  }
  function selObj() {
    var c = selLive(); if (!c || VE.playing) return null;
    var I = INST[c.id], k = SEL3[c.id]; if (!I || !k || k === "cam" || !I.boxes || !I.boxes[k]) return null;
    if (!I.boxes[k].b) return null;
    return { c: c, I: I, k: k, bx: I.boxes[k] };
  }
  var CAMON = {};
  function nameOf(I, k) { var o = I.scene && I.scene.objs && I.scene.objs.find(function (x) { return x.k === k; }); return o ? o.n : k.replace(/^[nvi]:/, ""); }
  function pickBox(I, nx, ny, cur) {
    var best = null, ba = 1e9, bx = I.boxes || {};
    /* el objeto ya elegido manda si está bajo el cursor (dos objetos encimados: se sigue con el que tenías) */
    if (cur && bx[cur] && bx[cur].b) { var cb = bx[cur].b; if (nx >= cb[0] - 0.012 && nx <= cb[2] + 0.012 && ny >= cb[1] - 0.012 && ny <= cb[3] + 0.012) return cur; }
    Object.keys(bx).forEach(function (k) {
      var q = bx[k], b = q.b; if (!b) return;
      var a = Math.max(1e-6, (Math.min(1, b[2]) - Math.max(0, b[0])) * (Math.min(1, b[3]) - Math.max(0, b[1])));
      if (q.pts || a > 0.85) return;
      var m = 0.012; if (nx < b[0] - m || nx > b[2] + m || ny < b[1] - m || ny > b[3] + m) return;
      if (a < ba) { ba = a; best = k; }
    });
    return best;
  }
  function drawSel() {
    [].forEach.call(document.querySelectorAll("#veStageW .lv-sel"), function (el) { el.remove(); });
    [].forEach.call(document.querySelectorAll("#veStageW .lv-gz"), function (el) { el.remove(); });
    var s = selObj(); drawBar();
    /* las luces de la escena se ven como puntos sobre el lienzo (solo al editar ese clip, nunca en el video) */
    var lc = selLive(), LI = lc && !VE.playing && INST[lc.id], lcv = LI && LI.boxes && document.querySelector('#veStageW canvas[data-live="' + cssId(lc.id) + '"]');
    if (lcv && lcv.offsetWidth) {
      var kk = lcv.offsetWidth / Math.max(1, lcv.getBoundingClientRect().width);
      Object.keys(LI.boxes).forEach(function (k) {
        var q = LI.boxes[k]; if (!q.gz || !q.b || (s && s.k === k)) return;
        var g = document.createElement("div"); g.className = "lv-gz" + (q.off ? " off" : ""); g.title = nameOf(LI, k);
        g.style.cssText = "left:" + (q.b[0] + q.b[2]) * 50 + "%;top:" + (q.b[1] + q.b[3]) * 50 + "%;--k:" + kk.toFixed(3);
        lcv.parentNode.appendChild(g);
      });
    }
    if (!s) return;
    var cv = document.querySelector('#veStageW canvas[data-live="' + cssId(s.c.id) + '"]'); if (!cv || !cv.offsetWidth) return;
    var b = DRAG && DRAG.k === s.k && DRAG.box ? DRAG.box : s.bx.b, k = cv.offsetWidth / Math.max(1, cv.getBoundingClientRect().width);
    var x0 = Math.max(-0.02, b[0]), y0 = Math.max(-0.02, b[1]), x1 = Math.min(1.02, b[2]), y1 = Math.min(1.02, b[3]);
    var el = document.createElement("div"); el.className = "lv-sel";
    el.style.cssText = "left:" + x0 * 100 + "%;top:" + y0 * 100 + "%;width:" + Math.max(0.5, (x1 - x0) * 100) + "%;height:" + Math.max(0.5, (y1 - y0) * 100) + "%;--k:" + k.toFixed(3);
    if (s.bx.gz) el.className = "lv-sel gz";
    el.innerHTML = '<b>' + esc(nameOf(s.I, s.k)) + (s.bx.off ? " (fuera de cuadro)" : "") + "</b>" + (s.bx.gz ? "" : '<i data-l3h="nw"></i><i data-l3h="ne"></i><i data-l3h="sw"></i><i data-l3h="se"></i>');
    cv.parentNode.appendChild(el);
  }
  var BAR = { el: null, sig: "" };
  /* el objeto elegido para la barra: cualquiera de la escena (también luces, estrellas u objetos sin caja en pantalla) */
  function barObj() {
    var c = selLive(); if (!c || VE.playing) return null;
    var I = INST[c.id], k = SEL3[c.id]; if (!I || !I.scene || !I.scene.objs || !k) return null;
    if (k === "cam") return CAMON[c.id] ? { c: c, I: I, k: "cam", rt: { k: "cam", n: "Cámara", cam: 1 }, bx: (I.boxes && I.boxes.cam) || null } : null;
    var rt = I.scene.objs.find(function (x) { return x.k === k; }); if (!rt) return null;
    return { c: c, I: I, k: k, rt: rt, bx: (I.boxes && I.boxes[k]) || null };
  }
  function drawBar() {
    var host = vq0("#veBox"); if (!host) return;
    if (!BAR.el) {
      BAR.el = document.createElement("div"); BAR.el.id = "veL3Bar"; BAR.el.hidden = true; BAR.el.setAttribute("role", "toolbar"); BAR.el.setAttribute("aria-label", "Objeto 3D elegido");
      host.appendChild(BAR.el);
      BAR.el.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      BAR.el.addEventListener("input", function (e) { var c = selLive(); if (!c || !e.target.closest || !e.target.closest(".lb-c") || !barObj() || !/^#[0-9a-f]{6}$/i.test(e.target.value)) return; snapOnce("bar:color"); put3(c, "color", e.target.value); });
      BAR.el.addEventListener("change", function (e) { var c = selLive(); if (!c || !e.target.matches || !e.target.matches("[data-bsel]")) return; SEL3[c.id] = e.target.value || "cam"; CAMON[c.id] = e.target.value === "cam"; refreshInsp(); drawSel(); });
      BAR.el.addEventListener("click", barClick);
    } else if (BAR.el.parentNode !== host) host.appendChild(BAR.el);
    var c = selLive(), I = c && INST[c.id], objs = I && I.scene && I.scene.objs;
    if (!c || !VE.open || VE.playing || !objs || !objs.length) { BAR.el.hidden = true; BAR.sig = ""; return; }
    BAR.el.hidden = false;
    var s = barObj(), L = norm(c), ctx = s ? ctx3(c) : null, rt = s && s.rt;
    var isCam = !!(rt && rt.cam), canCol = !!(rt && (rt.mesh || rt.light)), canSize = !!(rt && !rt.light && !isCam);
    var rem = !!(s && ((ctx.co && ML.addedByMusa(L.src, ctx.co)) || (!ctx.co && ML.addedVar(L.src, rt.n))));
    var sig = c.id + "|" + (s ? s.k : "") + "|" + canCol + canSize + rem + "|" + objs.map(function (x) { return x.k; }).join(",");
    if (BAR.sig !== sig) {
      BAR.sig = sig;
      var list = '<select data-bsel aria-label="Objeto 3D" title="Elige cualquier objeto de la escena (también luces y fondos)"><option value="">' + (s ? "Soltar" : "Elegir objeto…") + "</option>"
        + '<option value="cam"' + (isCam ? " selected" : "") + ">Cámara</option>"
        + objs.map(function (x) { return '<option value="' + esc(x.k) + '"' + (s && x.k === s.k ? " selected" : "") + ">" + esc(x.n) + (x.light ? " · luz" : "") + "</option>"; }).join("") + "</select>";
      BAR.el.innerHTML = !s ? '<span class="lb-h">Haz clic en un objeto 3D del lienzo para moverlo, agrandarlo, cambiarle el color o duplicarlo</span>' + list
        : isCam ? list + '<button type="button" data-b="zin" title="Acercar (cierra la apertura)">Acercar</button><button type="button" data-b="zout" title="Alejar (abre la apertura)">Alejar</button><span class="lb-t">Arrastra el lienzo para mover la cámara</span><button type="button" data-b="more" title="Posición, giro, apertura, keyframes…">Más ajustes</button><button type="button" data-b="x" aria-label="Soltar la cámara" title="Soltar">×</button>'
        : list
        + (canCol ? '<label class="lb-c" title="Color"><input type="color" aria-label="Color del objeto"></label>' : "")
        + (canSize ? '<button type="button" data-b="sm" title="Más chico">−</button><span class="lb-t">Tamaño</span><button type="button" data-b="lg" title="Más grande">+</button>' : "")
        + '<button type="button" data-b="dup" title="Otra copia de este objeto, en el código">Duplicar</button>'
        + '<button type="button" data-b="del">' + (rem ? "Quitar" : "Ocultar") + "</button>"
        + '<button type="button" data-b="more" title="Giro, opacidad, brillo, keyframes…">Más ajustes</button>'
        + '<button type="button" data-b="x" aria-label="Soltar el objeto" title="Soltar">×</button>';
    }
    var ci = BAR.el.querySelector('input[type="color"], .lb-c input');
    if (ci && document.activeElement !== ci) { try { ci.value = colorHex(get3(c, "color")); } catch (e) { /* sin color */ } }
  }
  function barClick(e) {
    var bt = e.target.closest && e.target.closest("[data-b]"); if (!bt) return;
    var c = selLive(), s = barObj(); if (!c || !s) return;
    var act = bt.dataset.b, L = norm(c), ctx = ctx3(c), I = INST[c.id], nm = s.rt.n || nameOf(s.I, s.k);
    if (act === "x") { SEL3[c.id] = "cam"; CAMON[c.id] = false; refreshInsp(); drawSel(); return; }
    if (act === "zin" || act === "zout") { snapOnce("bar:fov"); put3(c, "fov", Math.max(5, Math.min(140, r2((+get3(c, "fov") || 50) + (act === "zin" ? -3 : 3))))); refreshInsp(); return; }
    if (act === "more") { var t = document.querySelector(".ve-live-insp [data-l3sel]"); if (t) { var d = t.closest("details"); if (d) d.open = true; t.scrollIntoView({ block: "start", behavior: "smooth" }); } return; }
    if (act === "sm" || act === "lg") { snapOnce("bar:s"); put3(c, "s", Math.max(0.02, r2(get3(c, "s") * (act === "lg" ? 1.1 : 1 / 1.1)))); refreshInsp(); return; }
    if (act === "dup") {
      if (!ctx.co) { toast("«" + nm + "» no está escrito como objeto en el código (viene de un modelo o lo crea un bucle): no lo puedo duplicar desde aquí"); return; }
      var bx = s.bx, del = bx ? [0, 1, 2].map(function (i) { return bx.ux[i] * 0.07 + bx.uy[i] * 0.05; }) : [0.6, 0, 0];
      var r = ML.dupObject(L.src, ctx.co.v, { pos: bx ? bx.p.map(function (v, i) { return v + del[i]; }) : null, delta: del }); if (!r) { toast("No pude duplicar «" + nm + "» en el código"); return; }
      if (typeof vsnap === "function") vsnap();
      SEL3[c.id] = "n:" + r.name; setSrc(c, r.src); if (I) I.sceneOld = true;
      toast("Dupliqué «" + nm + "» → «" + r.name + "». Arrástralo donde quieras"); setTimeout(refreshInsp, 60); return;
    }
    if (act === "del") {
      var vn = ctx.co && ML.addedByMusa(L.src, ctx.co) ? ctx.co.v : !ctx.co ? ML.addedVar(L.src, s.rt.n) : null, nsrc = vn ? ML.removeObject(L.src, vn) : null;
      if (typeof vsnap === "function") vsnap();
      if (nsrc) {
        Object.keys(L.ov || {}).forEach(function (k) { if (k.indexOf("o:" + s.k + "|") === 0) nsrc = ML.setOv(nsrc, k, null); });
        SEL3[c.id] = "cam"; setSrc(c, nsrc); if (I) I.sceneOld = true; toast("Quité «" + nm + "» del código");
      } else { put3(c, "vis", false); toast("Oculté «" + nm + "». Para verlo otra vez elígelo en la lista de la barra › Más ajustes › Visible"); }
      setTimeout(refreshInsp, 60); drawSel(); return;
    }
  }
  function dragApply() {
    var d = DRAG; if (!d) return; d.raf = 0;
    var e = d.ev, c = d.c; if (!e) return;
    if (clipOf(c.id) !== c || selLive() !== c || SEL3[c.id] !== d.k) { d.ev = null; return dragEnd(); }
    var dx = e.clientX - d.x0, dy = e.clientY - d.y0, b0 = d.b0;
    if (!d.moved) {
      if (Math.abs(dx) + Math.abs(dy) < 4) return;
      d.moved = true; if (typeof vsnap === "function") vsnap();
      d.start = d.mode === "move" || d.mode === "cam" ? { px: +get3(c, "px") || 0, py: +get3(c, "py") || 0, pz: +get3(c, "pz") || 0 } : { s: +get3(c, "s") || 1 };
    }
    if (d.mode === "cam") {
      /* la cámara va al revés que la mano: la escena sigue al cursor */
      var cnx = dx / d.r.width, cny = dy / d.r.height;
      ["px", "py", "pz"].forEach(function (pr, i) { if (Math.abs(d.bx.ux[i]) + Math.abs(d.bx.uy[i]) < 1e-6) return; put3(c, pr, r3(d.start[pr] - cnx * d.bx.ux[i] - cny * d.bx.uy[i])); });
    } else if (d.mode === "move") {
      var nx = dx / d.r.width, ny = dy / d.r.height;
      ["px", "py", "pz"].forEach(function (pr, i) {
        if (Math.abs(d.bx.ux[i]) + Math.abs(d.bx.uy[i]) < 1e-6) return;
        put3(c, pr, r3(d.start[pr] + nx * d.bx.ux[i] + ny * d.bx.uy[i]));
      });
      d.box = [b0[0] + nx, b0[1] + ny, b0[2] + nx, b0[3] + ny];
    } else {
      var cx = (b0[0] + b0[2]) / 2, cy = (b0[1] + b0[3]) / 2, px = d.r.left + cx * d.r.width, py = d.r.top + cy * d.r.height;
      var f = Math.max(0.05, Math.min(20, Math.hypot(e.clientX - px, e.clientY - py) / Math.max(8, Math.hypot(d.x0 - px, d.y0 - py))));
      put3(c, "s", Math.max(0.02, r3(d.start.s * f)));
      d.box = [cx + (b0[0] - cx) * f, cy + (b0[1] - cy) * f, cx + (b0[2] - cx) * f, cy + (b0[3] - cy) * f];
    }
    drawSel();
  }
  function dragMove(e) { var d = DRAG; if (!d) return; e.preventDefault(); d.ev = e; if (!d.raf) d.raf = requestAnimationFrame(dragApply); }
  function dragEnd(e) {
    var d = DRAG; if (!d) return;
    /* vale el lugar donde se soltó (si el último movimiento no llegó, o llegó agrupado, el objeto quedaba a mitad de camino) */
    if (e && e.type === "pointerup" && typeof e.clientX === "number") d.ev = e;
    if (d.raf) cancelAnimationFrame(d.raf);
    if (d.ev) dragApply();
    DRAG = null;
    window.removeEventListener("pointermove", dragMove, true); window.removeEventListener("pointerup", dragEnd, true); window.removeEventListener("pointercancel", dragEnd, true);
    document.documentElement.classList.remove("lv-dragging");
    if (d.moved) { var I = INST[d.c.id]; if (I && I.boxes && I.boxes[d.k] && d.box) I.boxes[d.k].b = d.box; refreshInsp(); }
    drawSel();
  }
  function dragStart(e, s, mode, rect) {
    DRAG = { mode: mode, c: s.c, k: s.k, bx: s.bx, b0: s.bx.b ? s.bx.b.slice() : [0, 0, 1, 1], x0: e.clientX, y0: e.clientY, r: rect, moved: false, ev: null, raf: 0, box: null };
    window.addEventListener("pointermove", dragMove, true); window.addEventListener("pointerup", dragEnd, true); window.addEventListener("pointercancel", dragEnd, true);
    document.documentElement.classList.add("lv-dragging");
  }
  /* en window y en captura: va antes que el arrastre de clips (bridge-video-dnd.js escucha en document). Si lo que
     agarras es un objeto 3D, se mueve ese objeto y no el clip entero. */
  window.addEventListener("pointerdown", function (e) {
    if (!VE.open || !VE.p || e.button || VE.playing || !e.target || !e.target.closest || !e.target.closest("#veBox")) return;
    if (window.__veDrawing && window.__veDrawing()) return;
    /* lo que se estaba escribiendo en otro campo se confirma (este clic no deja que el navegador le quite el foco) */
    var ae = document.activeElement; if (ae && ae !== document.body && /^(?:INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && !e.target.closest("#veL3Bar")) { try { ae.blur(); } catch (er) { /* sin foco */ } }
    var h = e.target.closest("[data-l3h]"), s0 = selObj();
    if (h && s0) {
      var cv0 = document.querySelector('#veStageW canvas[data-live="' + cssId(s0.c.id) + '"]'); if (!cv0) return;
      e.preventDefault(); e.stopImmediatePropagation(); dragStart(e, s0, "scale", cv0.getBoundingClientRect()); return;
    }
    if (!e.target.closest("#veStageW") || e.target.closest("[data-ti]")) return;
    var med = e.target.closest("[data-mi]"); if (!med) return;
    var i = +med.dataset.mi, c = VE.p.m[i]; if (!c || !c.live) return;
    var I = INST[c.id], cv = med.querySelector("canvas[data-live]"); if (!I || !cv) return;
    var r = cv.getBoundingClientRect(); if (!r.width || !r.height) return;
    var was = selLive() === c, k = pickBox(I, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, was ? SEL3[c.id] : null);
    if (!k && was && CAMON[c.id] && SEL3[c.id] === "cam" && I.boxes && I.boxes.cam) { e.preventDefault(); e.stopImmediatePropagation(); dragStart(e, { c: c, I: I, k: "cam", bx: I.boxes.cam }, "cam", r); return; }
    if (!k) {
      if (!was) { e.stopImmediatePropagation(); veSelect({ tr: "m", i: i }); }
      else if (SEL3[c.id] && SEL3[c.id] !== "cam") { SEL3[c.id] = "cam"; refreshInsp(); drawSel(); }
      return;
    }
    e.preventDefault(); e.stopImmediatePropagation();
    if (!was) veSelect({ tr: "m", i: i });
    CAMON[c.id] = false;
    if (SEL3[c.id] !== k) { SEL3[c.id] = k; refreshInsp(); }
    drawSel();
    dragStart(e, { c: c, I: I, k: k, bx: I.boxes[k] }, "move", r);
  }, true);
  window.__veLive.pick = function (id, nx, ny) { var I = INST[id]; return I ? pickBox(I, nx, ny) : null; };
  window.__veLive.boxes = function (id) { var I = INST[id]; return I && I.boxes ? JSON.parse(JSON.stringify(I.boxes)) : null; };
  window.__veLive.sel3 = function (id, k) { if (k !== undefined) { SEL3[id] = k; refreshInsp(); drawSel(); } return SEL3[id] || null; };

  /* ═════════════ estilos ═════════════ */
  if (!document.getElementById("ve-live-css")) {
    var css = document.createElement("style"); css.id = "ve-live-css";
    css.textContent = [
      ".ve-media canvas.ve-live{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit;pointer-events:none}",
      ".ve-media .ve-live-st{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:90%;padding:.4em .8em;border-radius:8px;background:rgba(0,0,0,.6);color:#fff;font:600 22px/1.3 Inter,sans-serif;text-align:center;pointer-events:none}",
      ".ve-media .ve-live-st[hidden]{display:none}",
      ".ve-media .lv-sel{position:absolute;box-sizing:border-box;border:calc(2px*var(--k,1)) solid #ff5e00;border-radius:calc(3px*var(--k,1));pointer-events:none;z-index:6;box-shadow:0 0 0 calc(1px*var(--k,1)) rgba(0,0,0,.45)}",
      ".ve-media .lv-sel b{position:absolute;left:calc(-2px*var(--k,1));bottom:100%;padding:calc(2px*var(--k,1)) calc(7px*var(--k,1));background:#ff5e00;color:#fff;font:700 calc(11px*var(--k,1))/1.5 Inter,sans-serif;border-radius:calc(4px*var(--k,1)) calc(4px*var(--k,1)) 0 0;white-space:nowrap}",
      ".ve-media .lv-sel i{position:absolute;width:calc(12px*var(--k,1));height:calc(12px*var(--k,1));margin:calc(-6px*var(--k,1));background:#fff;border:calc(2px*var(--k,1)) solid #ff5e00;border-radius:50%;box-sizing:border-box;pointer-events:auto;touch-action:none}",
      ".ve-media .lv-sel i[data-l3h=nw]{left:0;top:0;cursor:nwse-resize}.ve-media .lv-sel i[data-l3h=se]{left:100%;top:100%;cursor:nwse-resize}.ve-media .lv-sel i[data-l3h=ne]{left:100%;top:0;cursor:nesw-resize}.ve-media .lv-sel i[data-l3h=sw]{left:0;top:100%;cursor:nesw-resize}",
      "html.lv-dragging,html.lv-dragging *{cursor:grabbing!important;user-select:none!important}",
      ".ve-media .lv-sel.gz{border-radius:50%;border-style:dashed}",
      ".ve-media .lv-gz{position:absolute;width:calc(18px*var(--k,1));height:calc(18px*var(--k,1));margin:calc(-9px*var(--k,1));border-radius:50%;background:radial-gradient(circle,#fff 0 28%,#ffd84a 30% 55%,rgba(255,216,74,.25) 57%);border:calc(1.5px*var(--k,1)) solid rgba(0,0,0,.55);box-sizing:border-box;pointer-events:none;z-index:5}",
      ".ve-media .lv-gz.off{opacity:.55}",
      ".ve-live-insp .lv-gh{margin-top:8px;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--ed-dim,#9a9a9a)}",
      ".ve-live-insp .lv-vals .lv-l{white-space:normal;overflow:visible;line-height:1.25;word-break:break-word}",
      "#veBox{position:relative}",
      "#veL3Bar{position:absolute;left:50%;top:6px;transform:translateX(-50%);z-index:20;display:flex;align-items:center;gap:6px;max-width:calc(100% - 16px);padding:5px 8px;border-radius:10px;background:rgba(18,18,20,.94);border:1px solid rgba(255,255,255,.14);box-shadow:0 6px 24px rgba(0,0,0,.45);color:#fff;font:600 12px/1 Inter,sans-serif;white-space:nowrap;overflow-x:auto}",
      "#veL3Bar[hidden]{display:none}",
      "#veL3Bar .lb-h{font-weight:500;color:#cfcfcf;padding:3px 4px}",
      "#veL3Bar .lb-n{padding:4px 8px;border-radius:6px;background:#ff5e00;color:#fff;font-weight:700;max-width:160px;overflow:hidden;text-overflow:ellipsis}",
      "#veL3Bar .lb-t{color:#a8a8a8;font-weight:500}",
      "#veL3Bar select{height:26px;max-width:170px;padding:0 6px;border:1px solid rgba(255,255,255,.16);border-radius:6px;background:#ff5e00;color:#fff;font:700 12px/1 Inter,sans-serif;cursor:pointer}",
      "#veL3Bar .lb-h+select{background:rgba(255,255,255,.08);font-weight:600}",
      "#veL3Bar select option{background:#1b1b1e;color:#fff}",
      "#veL3Bar .lb-c input{width:28px;height:24px;padding:0;border:1px solid rgba(255,255,255,.25);border-radius:6px;background:none;cursor:pointer}",
      "#veL3Bar button{height:26px;min-width:26px;padding:0 9px;border:1px solid rgba(255,255,255,.16);border-radius:6px;background:rgba(255,255,255,.06);color:#fff;font:600 12px/1 Inter,sans-serif;cursor:pointer}",
      "#veL3Bar button:hover{background:rgba(255,255,255,.16)}",
      "#veL3Bar button:focus-visible,#veL3Bar input:focus-visible{outline:2px solid #ff5e00;outline-offset:1px}",
      ".ve-live-insp .lv-grid{display:grid;gap:6px;grid-column:1/-1}",
      ".ve-live-insp .lv-f{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:6px}",
      ".ve-live-insp .lv-f:has(input[type=range]){grid-template-columns:minmax(0,1fr) minmax(0,1fr) 72px auto}",
      ".ve-live-insp .lv-l{font-size:12px;color:var(--ed-dim,#9a9a9a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".ve-live-insp .lv-f input[type=number],.ve-live-insp .lv-f input[type=text],.ve-live-insp .lv-f select{width:84px;min-width:0}",
      ".ve-live-insp .lv-f input[type=text]{width:120px}",
      ".ve-live-insp .lv-f input[type=range]{width:100%;min-width:0}",
      ".ve-live-insp .lv-kf,.ve-live-insp .lv-kf0{width:26px;height:26px;border:0;border-radius:6px;background:transparent;color:#777;font-size:13px;cursor:pointer;display:inline-grid;place-items:center}",
      ".ve-live-insp .lv-kf:hover{background:rgba(255,255,255,.08);color:#fff}",
      ".ve-live-insp .lv-kf.has{color:#ffb38a}.ve-live-insp .lv-kf.on{color:#ff5e00;background:rgba(255,94,0,.14)}",
      ".ve-live-insp code{font-family:'JetBrains Mono',monospace;font-size:11px}",
      ".lv-th{display:grid!important;place-items:center;font:800 11px/1 'JetBrains Mono',monospace;color:#d2ff02;background:#1b1b1b!important}",
      ".ve-live-modal{position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.55);display:grid;place-items:center;padding:16px}",
      ".ve-live-modal .lvm-box{width:min(960px,100%);height:min(720px,100%);display:flex;flex-direction:column;background:#151515;color:#eee;border:1px solid #2a2a2a;border-radius:14px;overflow:hidden}",
      ".ve-live-modal .lvm-h{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #2a2a2a}",
      ".ve-live-modal .lvm-x{width:32px;height:32px;border:0;border-radius:8px;background:transparent;color:#bbb;font-size:22px;cursor:pointer}",
      ".ve-live-modal textarea{flex:1;min-height:0;resize:none;border:0;outline:0;background:#0d0d0d;color:#e8e8e8;padding:14px;font:13px/1.55 'JetBrains Mono',ui-monospace,monospace;tab-size:2;white-space:pre;overflow:auto}",
      ".ve-live-modal .lvm-n{padding:8px 14px;font-size:12px;color:#9a9a9a;border-top:1px solid #2a2a2a}",
      ".ve-live-modal .lvm-f{display:flex;gap:8px;align-items:center;justify-content:flex-end;padding:10px 14px}",
      ".ve-live-modal .lvm-err{margin-right:auto;color:#ff8a65;font-size:12px}",
      ".ve-live-insp .lv-tag{display:inline-block;min-width:18px;margin-right:5px;padding:0 3px;border-radius:4px;background:rgba(210,255,2,.12);color:#d2ff02;font:700 9px/14px 'JetBrains Mono',monospace;font-style:normal;text-align:center;vertical-align:1px}",
      ".ve-live-insp .lv-tag.lv-anim{background:rgba(255,179,138,.14);color:#ffb38a}",
      ".ve-live-insp .lv-add{display:flex;gap:6px;align-items:center}.ve-live-insp .lv-add select{flex:1;min-width:0}",
      ".ve-live-insp [data-lact=edit][aria-pressed=true]{outline:2px solid #d2ff02;outline-offset:1px}",
      "#veLiveCode{position:fixed;z-index:61;display:flex;flex-direction:column;background:#141412;border-right:1px solid #2a2a26;box-shadow:12px 0 40px rgba(0,0,0,.45);font:13px Inter,system-ui,sans-serif;color:#e8e6df}",
      "#veLiveCode[hidden]{display:none}",
      /* celular: hoja inferior como las demás del editor (antes quedaba debajo del editor y no se veía) */
      "@media (max-width:860px){#veLiveCode{z-index:155}}",
      "@media (max-width:760px){#veLiveCode{left:0!important;right:0!important;top:auto!important;bottom:calc(58px + env(safe-area-inset-bottom))!important;width:auto!important;height:min(62vh,560px)!important;border-right:0;border-top:1px solid #2a2a26;border-radius:16px 16px 0 0;box-shadow:0 -14px 40px rgba(0,0,0,.55);overflow:hidden}#veLiveCode .lc-h{flex-wrap:wrap}#veLiveCode .lc-x{font-size:22px;min-width:40px;min-height:40px}}",
      "#veLiveCode .lc-h{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid #2a2a26}",
      "#veLiveCode .lc-h b{font-weight:700;white-space:nowrap}#veLiveCode .lc-n{color:#9a978c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}#veLiveCode .lc-sp{flex:1}",
      "#veLiveCode .lc-b{background:#22221f;border:1px solid #34342f;color:#e8e6df;border-radius:7px;padding:5px 9px;font:600 12px Inter,sans-serif;cursor:pointer;white-space:nowrap}",
      "#veLiveCode .lc-b:hover{border-color:#ff5e00}#veLiveCode .lc-b.p{background:#ff5e00;border-color:#ff5e00;color:#141412}",
      "#veLiveCode .lc-x{background:transparent;border:0;color:#9a978c;font-size:18px;cursor:pointer;padding:2px 6px}",
      "#veLiveCode .lc-ed{position:relative;flex:1;min-height:0;display:flex}",
      "#veLiveCode .lc-gut{width:40px;flex:none;overflow:hidden;background:#11110f;color:#55534c;text-align:right;padding:10px 6px 10px 0;box-sizing:border-box;font:12px/1.55 'JetBrains Mono',ui-monospace,Menlo,monospace;user-select:none;white-space:pre}",
      "#veLiveCode .lc-wrap{position:relative;flex:1;min-width:0;overflow:hidden}",
      "#veLiveCode pre.lc-hl,#veLiveCode textarea{position:absolute;inset:0;margin:0;padding:10px 12px;box-sizing:border-box;font:12px/1.55 'JetBrains Mono',ui-monospace,Menlo,monospace;white-space:pre;overflow:auto;tab-size:2;border:0}",
      "#veLiveCode pre.lc-hl{pointer-events:none;color:#d8d5cb;background:transparent}",
      "#veLiveCode textarea{background:transparent;color:transparent;caret-color:#ff5e00;resize:none;outline:none}",
      "#veLiveCode textarea::selection{background:rgba(255,94,0,.35);color:transparent}",
      "#veLiveCode .lc-fl{position:absolute;left:0;right:0;background:rgba(210,255,2,.16);border-left:3px solid #d2ff02;pointer-events:none}",
      "#veLiveCode .lc-fl.go{animation:lcfl 1.6s ease-out forwards}@keyframes lcfl{0%{opacity:1}70%{opacity:.7}100%{opacity:0}}",
      "#veLiveCode .k{color:#ff9d5c}#veLiveCode .s{color:#c3e88d}#veLiveCode .n{color:#82aaff}#veLiveCode .c{color:#6b6960;font-style:italic}#veLiveCode .c.mb{color:#b9d84a;font-style:normal}#veLiveCode .g{color:#c792ea}",
      "#veLiveCode .lc-st{padding:6px 10px;border-top:1px solid #2a2a26;color:#9a978c;font-size:12px;display:flex;gap:10px;align-items:center;min-height:18px}",
      "#veLiveCode .lc-st i{width:8px;height:8px;border-radius:50%;background:#5bd16b;flex:none}#veLiveCode .lc-st i.d{background:#ffb347}#veLiveCode .lc-st i.e{background:#ff5c5c}",
      "@media (prefers-reduced-motion:reduce){#veLiveCode .lc-fl.go{animation:none;opacity:.6}}",
    ].join("\n");
    document.head.appendChild(css);
  }
  if (VE.open) { try { veBin(); veStage(); } catch (e) { /* el editor se dibuja solo */ } }
})();
