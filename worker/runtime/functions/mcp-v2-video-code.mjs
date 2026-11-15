// Video como código (Musa Video Code) por MCP: el mismo puente que el panel «Código» del editor de video.
//
// · video_code_get: el proyecto escrito como HTML + GSAP (compatible con HyperFrames), Remotion (TSX) o JSON.
//   Usa los bloques que el editor guardó en video_editor_state (exactos, muestreados del render real); lo que cambió
//   después (por ejemplo, con las tools video_segment_*) se escribe aquí con las mismas reglas.
// · video_code_apply / video_project_create_from_code: el código vuelve como clips editables en las MISMAS tablas
//   que usa el editor (musa_video_*) + video_editor_state. Código de Musa y JSON se aplican aquí; HTML/Remotion
//   ajeno (que hay que ejecutar para saber dónde queda cada cosa) se guarda pendiente y el editor lo convierte al
//   abrir el proyecto, en un sandbox del navegador.
// Nunca se ejecuta JavaScript en el servidor: el código se lee con el analizador de literales de video-code-core.js.
import "../../../public/musa/video-live-core.js";
import "../../../public/musa/video-code-core.js";
import { getSupabaseAdmin } from "../../../api/src/services/supabase.ts";
import * as videoProjects from "../../../api/src/services/videoProjects.js";

const VC = globalThis.MusaVideoCode;
const ML = globalThis.MusaVideoLive;
const US = 1e6;
const S = (o) => ({ type: "string", ...o });

export const VIDEO_CODE_TOOLS = [
  {
    name: "video_code_get",
    description: "Video como código: devuelve el proyecto de video COMPLETO como código editable. format \"html\" (por defecto) = una página HTML + GSAP compatible con HyperFrames: cada clip es un elemento con data-start / data-duration (textos .t, media .m, tomas .v1, audio <audio>) y su movimiento son llamadas tl.set / tl.to / tl.fromTo dentro de un bloque «// ▸ id … // ◂ id»; se reproduce sola en un navegador y se renderiza con `npx hyperframes render`. format \"remotion\" = componente React/Remotion (TSX). format \"json\" = el estado del editor tal cual. Para cambiar el video: edita el código y mándalo con video_code_apply (lo que no toques vuelve exacto desde data-musa; lo que cambies manda).",
    inputSchema: { type: "object", properties: { projectId: S({ description: "Proyecto de video (video_project_list)" }), format: S({ enum: ["html", "remotion", "json"], description: "html (HyperFrames/GSAP, por defecto), remotion o json" }) }, required: ["projectId"] },
  },
  {
    name: "video_code_apply",
    description: "Video como código: reemplaza el contenido del proyecto con el código dado y lo deja editable en el editor (mismas tablas musa_video_* y video_editor_state). Acepta el HTML de Musa (el de video_code_get, editado: cambia textos, estilos, data-start/data-duration, agrega o borra clips, o reescribe los tl.to/fromTo de un bloque) y el JSON de Musa: se aplican al instante. También acepta HTML ajeno (HyperFrames, GSAP, CSS, anime.js) y Remotion (TSX/JSX): como hay que ejecutarlo para medir dónde queda cada elemento, queda pendiente y el editor lo convierte en clips al abrir editorUrl (needsEditor:true). Devuelve el resumen de clips y los avisos.",
    inputSchema: { type: "object", properties: { projectId: S({}), workspaceId: S({ description: "Opcional; se verifica que el proyecto sea de ese espacio" }), code: S({ description: "El código del video (HTML, TSX/JSX o JSON)" }) }, required: ["projectId", "code"] },
  },
  {
    name: "video_project_create_from_code",
    description: "Video como código: crea un proyecto de video NUEVO desde código y lo deja editable clip por clip en el editor de Musa. Código de Musa (HTML de video_code_get o JSON) entra al instante. HTML ajeno (HyperFrames, GSAP, CSS) o Remotion (TSX/JSX) se convierte al abrir editorUrl en el navegador (queda pendiente: needsEditor:true). El tamaño sale de data-width/data-height (HTML) o de <Composition width height> / musaVideo (Remotion). Ejemplo mínimo HTML: <div id=\"root\" data-composition-id=\"main\" data-width=\"1080\" data-height=\"1920\" data-duration=\"5\" data-musa-video=\"1\"><div class=\"clip\" data-start=\"0\" data-duration=\"3\"><div id=\"t-hola\" class=\"t\" style=\"left:50%;top:40%;font-size:96px;color:#fff\">Hola</div></div></div><script>const tl = gsap.timeline({paused:true}); tl.from(\"#t-hola\", {y: 200, opacity: 0, duration: 0.8, ease: \"power3.out\"}, 0); window.__timelines[\"main\"] = tl;</script>",
    inputSchema: { type: "object", properties: { workspaceId: S({ description: "Espacio que será dueño del video" }), name: S({ description: "Nombre (por defecto el <title> del código)" }), code: S({ description: "El código del video" }) }, required: ["workspaceId", "code"] },
  },
  {
    name: "video_live_add",
    description: "Código vivo: agrega al video un clip 3D / generativo hecho con CÓDIGO que queda EDITABLE en el editor de Musa (no se convierte en imagen fija). Sirve Three.js, React Three Fiber (Remotion con <ThreeCanvas> de @remotion/three), p5.js, PixiJS, WebGL/shaders, canvas 2D y Lottie: HTML completo, JS suelto (se envuelve solo; `import ... from \"three\"` funciona) o Remotion TSX. El código corre en un iframe aislado y se dibuja cuadro a cuadro por tiempo con los contratos de las skills de video: hf-seek (HyperFrames), window.__seek/__ready/__meta (onetake), timelines GSAP, requestAnimationFrame/setAnimationLoop/p5 draw (determinista, Math.random con semilla) y useCurrentFrame (Remotion). EL CÓDIGO MANDA y se sincroniza solo (sin IA): lo que se cambie en el editor o con video_live_update se escribe en el código al instante, y lo que se escriba en el código vuelve a ser editable. Editable: (1) parámetros = propiedades literales de objetos params/config/settings/options/controls/theme (o marcados con // @musa), constantes en MAYÚSCULAS, defaultProps de <Composition> y rangos de lil-gui → su literal se reescribe; (2) objetos de Three.js con variable (const cube = new THREE.Mesh(…), luces, cámaras): posición, giro, escala, color, emisivo, opacidad, intensidad, FOV, visible → se reescribe su literal (cube.position.set(…), color: 0x…, new THREE.DirectionalLight(color, intensidad)) o se agrega una línea; si el valor sale de un parámetro (color: params.color) se cambia el parámetro; (3) lo que el código calcula en cada cuadro y los keyframes → bloque «▸ musa» (JSON en un comentario dentro del código, editable a mano); (4) tiempo (offset, speed, loop) y el clip como cualquier media. Ponle `name` a tus objetos 3D y deja los valores ajustables en `const params = {…}`. Devuelve los parámetros y los objetos encontrados.",
    inputSchema: { type: "object", properties: {
      projectId: S({ description: "Proyecto de video" }), code: S({ description: "El código (HTML, JS suelto o Remotion TSX)" }), kind: S({ enum: ["html", "remotion"], description: "Por defecto se detecta" }), name: S({}),
      start: { type: "number", description: "Segundo del video donde empieza (por defecto 0)" }, duration: { type: "number", description: "Segundos (por defecto 5)" },
      x: { type: "number", description: "Centro X en % del cuadro (50)" }, y: { type: "number", description: "Centro Y en % (50)" }, width: { type: "number", description: "Ancho en % del cuadro (100 = pantalla completa)" }, aspect: { type: "number", description: "Ancho/alto del clip (por defecto el del video si width=100, si no 1)" },
      canvasWidth: { type: "number", description: "Tamaño fijo del lienzo del código en px (si no, toma la forma del clip)" }, canvasHeight: { type: "number" }, canvasIndex: { type: "number", description: "Qué <canvas> de la página se usa (por defecto el más grande)" },
      offset: { type: "number", description: "Segundo del código en el que empieza el clip" }, speed: { type: "number" }, loop: { type: "number", description: "Repetir cada N segundos del código" },
      params: { type: "object", description: "Valores fijos: { \"speed\": 2, \"color\": \"#ff5e00\" } (nombre del parámetro o su key p:/v:/r:)" },
      keyframes: { type: "object", description: "Keyframes por parámetro o ajuste 3D: { \"speed\": [{ \"t\": 0, \"v\": 0 }, { \"t\": 2, \"v\": 3, \"e\": \"smooth\" }] } (t = segundos del clip; e: lin|smooth|in|out|hold)" },
      scene: { type: "object", description: "Escena 3D (Three.js): { \"Cubo|px\": 1.5, \"cube|ry\": 45, \"cam|fov\": 40, \"Luz principal|int\": 1.5 } (objeto por name, por variable del código o cam). props: px py pz, rx ry rz (grados), s, color, emi, op, int, vis, fov. Si la propiedad está en el código (objects[].props[p].mode = code/param/add en video_live_get) el valor es ABSOLUTO y se escribe en el código; si la calcula el código en cada cuadro (mode offset) es un AJUSTE (posición/giro se suman; escala/opacidad/intensidad multiplican) y va al bloque ▸ musa. { kf: [...] } = keyframes de ajuste. null = quitar el ajuste." },
      addObjects: { type: "array", description: "Agregar objetos 3D al código (Three.js con new THREE.Scene()): [{ type: box|sphere|torus|knot|cone|cylinder|icosa|plane|pointLight|dirLight, name, color, x, y, z, size, intensity }]. Quedan con variable y name, editables.", items: { type: "object" } },
    }, required: ["projectId", "code"] },
  },
  {
    name: "video_live_update",
    description: "Código vivo: cambia un clip 3D / de código de un video (video_live_get para ver sus parámetros y objetos). Todo se escribe en el código del clip al instante y sin IA: valores fijos → su literal en el código; objetos 3D con variable → cube.position.set(…), color: 0x…, intensidad… (o una línea nueva); en React Three Fiber / Remotion los elementos del JSX (<mesh name=… position={[…]}>, luces, material hijo, cámara de <ThreeCanvas camera>) → sus atributos (o uno nuevo); keyframes y ajustes sobre lo que el código anima → bloque «▸ musa». También: reemplazar el código, agregar objetos 3D (addObjects), tiempo (offset, speed, loop) y posición/tamaño/tiempo del clip. Lo que no mandes queda igual. Si la persona tiene el editor abierto y está guardando, se vuelve a leer y se aplica otra vez sin pisar lo suyo. includeCode:true devuelve el código resultante.",
    inputSchema: { type: "object", properties: {
      projectId: S({}), clipId: S({ description: "id del clip (video_live_get)" }), code: S({ description: "Código nuevo (opcional)" }), name: S({}),
      start: { type: "number" }, duration: { type: "number" }, x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, aspect: { type: "number" },
      offset: { type: "number" }, speed: { type: "number" }, loop: { type: "number" }, canvasWidth: { type: "number" }, canvasHeight: { type: "number" },
      params: { type: "object", description: "Valores fijos de parámetros: se reescriben en el código" }, keyframes: { type: "object", description: "Keyframes por parámetro o propiedad 3D (\"Cubo|ry\"): van al bloque ▸ musa" }, scene: { type: "object", description: "Igual que en video_live_add: absoluto si la propiedad está en el código, ajuste si la anima el código" },
      addObjects: { type: "array", items: { type: "object" }, description: "Agregar objetos 3D al código: [{ type: box|sphere|torus|knot|cone|cylinder|icosa|plane|pointLight|dirLight, name, color, x, y, z, size }]" },
      includeCode: { type: "boolean", description: "true = devolver el código resultante" },
      reset: { type: "boolean", description: "true = quita el bloque ▸ musa (keyframes y ajustes) antes de aplicar; lo escrito en el código queda" },
    }, required: ["projectId", "clipId"] },
  },
  {
    name: "video_live_get",
    description: "Código vivo: los clips 3D / de código de un video con su código (la fuente de verdad, con el bloque ▸ musa), el tipo (Three.js, p5, WebGL, Remotion 3D…), sus parámetros (valor en el código, keyframes, rango), los objetos 3D del código (variable, name y, por propiedad, mode: code = literal en el código, param = sale de un parámetro, add = se agrega una línea, offset = la calcula el código y se ajusta en el bloque) y las entradas del bloque.",
    inputSchema: { type: "object", properties: { projectId: S({}), clipId: S({ description: "Opcional: solo ese clip" }), includeCode: { type: "boolean", description: "Incluir el código (por defecto true)" } }, required: ["projectId"] },
  },
];
export const VIDEO_CODE_NAMES = new Set(VIDEO_CODE_TOOLS.map((t) => t.name));

/* ───────── proyecto (filas + video_editor_state) → modelo del editor ───────── */
const FROM_DB = { t: ["text", "x", "y", "size", "font", "weight", "color", "bg", "anim"], m: ["x", "y", "w", "ar", "radius", "bg", "name"], a: ["name"], v1: ["name"] };
const r2 = (v) => Math.round(v * 100) / 100;
function mnum(v, ref) { if (typeof v === "number" && isFinite(v)) return v; const t = String(v == null ? "" : v).trim(); if (!t) return null; if (/%$/.test(t)) return parseFloat(t) / 100 * ref; const n = parseFloat(t); return isFinite(n) ? n : null; }
/* material de una especificación de movimiento → valores del editor (igual que motionApply en bridge-video.js) */
function motionApply(c, pl, tr, W, H, CW, CH) {
  if (!pl || !(pl.nodeKind || pl.props || (pl.keyframes && pl.keyframes.length))) return;
  const pr = pl.props || {}, kfs = (pl.keyframes || []).filter((k) => k && typeof k.value === "number").slice().sort((a, b) => a.timeMs - b.timeMs);
  const kx = W / CW, first = (prop) => { const f = kfs.find((k) => k.property === prop); return f ? f.value : null; };
  let bx = mnum(pr.x, CW), by = mnum(pr.y, CH);
  if (bx == null) bx = first("x"); if (by == null) by = first("y");
  if (bx != null) c.x = r2(bx / CW * 100); if (by != null) c.y = r2(by / CH * 100);
  if (tr === "t") {
    const fs = mnum(pr.fontSize, CH); if (fs) c.size = Math.round(fs * kx);
    if (pr.fontFamily) c.font = String(pr.fontFamily).split(",")[0].replace(/["']/g, "").trim();
    if (pr.fontWeight != null && +pr.fontWeight) c.weight = +pr.fontWeight;
    if (pr.color) c.color = String(pr.color);
    const tb = pr.backgroundColor || pr.background; if (tb) c.bg = String(tb);
    c.exact = true;
  } else {
    const w = mnum(pr.width, CW), h = mnum(pr.height, CH);
    if (w) c.w = r2(w / CW * 100);
    if (w && h) c.ar = Math.round(w / h * 1000) / 1000;
    if (!pl.url) { const col = pr.backgroundColor || pr.background || pr.color; if (col) c.bg = String(col); }
    if (typeof pr.opacity === "number") c.opacity = pr.opacity;
  }
  if (!kfs.length) return;
  const s0 = typeof pr.scale === "number" ? pr.scale : 1, rot0 = typeof pr.rotation === "number" ? pr.rotation : 0, o0 = tr === "t" && typeof pr.opacity === "number" ? pr.opacity : 1;
  const at = (prop, tms, def) => { const L = kfs.filter((k) => k.property === prop); if (!L.length) return def; if (tms <= L[0].timeMs) return L[0].value; if (tms >= L[L.length - 1].timeMs) return L[L.length - 1].value; for (let i = 1; i < L.length; i++) if (tms <= L[i].timeMs) { const a = L[i - 1], b = L[i], u = (tms - a.timeMs) / Math.max(1, b.timeMs - a.timeMs); return a.value + (b.value - a.value) * u; } return def; };
  const st = c.start * 1000, times = [...new Set(kfs.map((k) => k.timeMs))];
  if (tr === "m" && kfs.some((k) => k.property === "opacity")) c.opacity = 1;
  c.kf = times.map((tms) => ({ t: r2(Math.max(0, (tms - st) / 1000)), x: r2((at("x", tms, bx || 0) - (bx || 0)) * kx), y: r2((at("y", tms, by || 0) - (by || 0)) * kx), s: r2(at("scale", tms, s0)), r: r2(at("rotation", tms, rot0)), o: r2(at("opacity", tms, o0)) }));
  c.anim = "none";
}
function rowClip(kind, sg, m, W, H, CW, CH, nth) {
  const pl = (m && m.payload) || {}, start = sg.target_start_us / US, dur = sg.target_dur_us / US, id = "c" + String(sg.id).slice(-8);
  let c = null;
  if (kind === "v1") {
    if (m.kind === "video") c = { id, kind: "take", name: pl.name || "Clip de video", dur, in: (sg.source_start_us || 0) / US, speed: +sg.speed || 1, vol: 1, look: "none", lookK: 1, fx: "none", ovl: "none", trans: null, takeUrl: pl.url };
    else if (m.kind === "image") c = { id, kind: "scene", name: pl.name || "Imagen", scene: { name: pl.name || "Imagen", w: W, h: H, bg: "transparent", els: [{ type: "image", name: "Imagen", x: 0, y: 0, w: W, h: H, fill: "url('" + pl.url + "') center/cover no-repeat", opacity: 1, rot: 0, sx: 1, sy: 1, kx: 0, ky: 0, radius: 0 }] }, dur, in: 0, speed: +sg.speed || 1, fit: "contain", look: "none", lookK: 1, fx: "none", ovl: "none", trans: null };
  } else if (kind === "m") {
    c = { id, name: pl.name || (pl.nodeId ? String(pl.nodeId).replace(/[_-]+/g, " ") : "Media"), start, dur, x: pl.x != null ? pl.x : 50, y: pl.y != null ? pl.y : 50, w: pl.w || 40, ar: pl.ar || 1, radius: pl.radius || 0, bg: pl.url ? "url('" + pl.url + "') center/" + (pl.fit || "cover") + " no-repeat" : (pl.bg || "#ffffff"), anim: pl.anim || "fade" };
    if (pl.shape) c.shape = pl.shape; if (pl.opacity != null) c.opacity = pl.opacity;
    motionApply(c, pl, "m", W, H, CW, CH);
  } else if (kind === "t") {
    c = { id, text: typeof pl.text === "string" ? pl.text.replace(/\s+$/, "") : "", start, dur, x: pl.x != null ? pl.x : 50, y: pl.y != null ? pl.y : 82, size: pl.size || pl.fontSize || 64, font: pl.font || "Inter", weight: pl.weight || 800, color: pl.color || "#ffffff", bg: pl.bg || "", anim: pl.anim || "pop" };
    motionApply(c, pl, "t", W, H, CW, CH);
  } else if (kind === "a") c = { id, name: pl.name || "Audio", start, dur, vol: pl.volume != null ? pl.volume : 1, fin: 0, fout: 0, url: pl.url };
  if (c && sg.clip && typeof sg.clip === "object" && (kind === "t" || kind === "m")) {
    const k = sg.clip;
    if (typeof k.x === "number" && k.x !== 0) c.x = r2(50 + k.x * 50);
    if (typeof k.y === "number" && k.y !== 0) c.y = r2(50 + k.y * 50);
    if (typeof k.scale === "number" && k.scale > 0 && k.scale !== 1) { if (kind === "t") c.size = Math.round((c.size || 64) * k.scale); else c.w = r2((c.w || 40) * k.scale); }
    if (typeof k.alpha === "number" && k.alpha < 1) { if (kind === "t") c.kf = [{ t: 0, x: 0, y: 0, s: 1, r: 0, o: k.alpha }]; else c.opacity = k.alpha; }
    if (typeof k.rotation === "number" && k.rotation) c.kf = [{ t: 0, x: 0, y: 0, s: 1, r: k.rotation, o: (c.kf && c.kf[0] && c.kf[0].o) || 1 }];
  }
  if (c) c._s = sg.id;
  void nth;
  return c;
}
export function buildModel(tree, st) {
  const pj = tree.project, mats = {};
  (tree.materials || []).forEach((m) => { mats[m.id] = m; });
  const W = +pj.canvas_w || 1080, H = +pj.canvas_h || 1920;
  const model = { name: pj.name || "Video", W, H, fmt: pj.ratio || null, fps: pj.fps || 30, pad: "#000000", grad: null, total: null, persp: null, gtr: null, markers: null, lanes: null, v1: [], m: [], t: [], a: [] };
  Object.values(mats).forEach((cm) => { if (cm && cm.kind === "canvas" && cm.payload) { const cp = cm.payload; if (cp.backgroundColor || cp.bg) model.pad = String(cp.backgroundColor || cp.bg); if (+cp.durationMs > 0) model.total = Math.round(cp.durationMs / 10) / 100; } });
  const tracks = (tree.tracks || []).slice().sort((a, b) => a.z_order - b.z_order), main = {}, motionTr = {};
  tracks.forEach((tk) => (tk.segments || []).forEach((sg) => { const mm = mats[sg.material_id]; if (mm && mm.payload && mm.payload.nodeKind) motionTr[tk.id] = 1; }));
  let overlay = null;
  tracks.forEach((tk) => { if (tk.type === "video" && +tk.z_order >= 50) { if (!overlay) overlay = tk.id; } else if (!main[tk.type] && !motionTr[tk.id]) main[tk.type] = tk.id; });
  const db = { v1: [], m: [], t: [], a: [] };
  tracks.forEach((tk) => {
    (tk.segments || []).slice().sort((a, b) => a.target_start_us - b.target_start_us).forEach((sg) => {
      const m = mats[sg.material_id] || {}, shapeOnly = m.kind === "image" && !(m.payload && m.payload.url);
      let k = null;
      if (tk.type === "video" && main.video === tk.id && !shapeOnly) k = "v1";
      else if (tk.type === "video" || tk.type === "sticker") k = m.kind === "image" || m.kind === "video" || m.kind === "sticker" ? "m" : null;
      else if (tk.type === "text" && m.kind === "text") k = "t";
      else if (tk.type === "audio" && m.kind === "audio") k = "a";
      if (!k) return;
      const c = rowClip(k, sg, m, W, H, W, H);
      if (c) db[k].push(c);
    });
  });
  /* el estado del editor completa lo visual (y manda entero si quedó «pendiente») */
  if (st && Array.isArray(st.v1)) {
    const pend = !!st.pending;
    ["v1", "m", "t", "a"].forEach((k) => {
      const saved = (st[k] || []).map((c) => JSON.parse(JSON.stringify(c))), bySeg = {};
      saved.forEach((c) => { if (c._s) bySeg[c._s] = c; });
      const inDb = {}; db[k].forEach((c) => { inDb[c._s] = c; });
      const out = [];
      saved.forEach((sc) => {
        if (sc._s && inDb[sc._s] && !pend) {
          const d = inDb[sc._s], c = Object.assign({}, sc);
          FROM_DB[k].forEach((f) => { if (d[f] !== undefined) c[f] = d[f]; });
          c.start = d.start; c.dur = d.dur;
          if (k === "v1") { c.dur = d.dur; if (d.kind === "take") { c.in = d.in; c.speed = d.speed; c.takeUrl = d.takeUrl || c.takeUrl; } }
          out.push(c);
        } else if (!sc._s || pend) out.push(sc);
      });
      if (!pend) db[k].forEach((d) => { if (!bySeg[d._s]) out.push(d); });
      model[k] = out;
    });
    ["pad", "grad", "total", "persp", "gtr", "markers", "lanes"].forEach((f) => { if (st[f] != null) model[f] = st[f]; });
    if (st.fmt) model.fmt = st.fmt;
  } else ["v1", "m", "t", "a"].forEach((k) => { model[k] = db[k]; });
  ["v1", "m", "t", "a"].forEach((k) => model[k].forEach((c) => { delete c._s; delete c._row; if (k === "v1" && c.kind === "take") delete c.take; }));
  VC.relayoutV1(model);
  return model;
}

/* ───────── modelo → filas (las mismas que escribe el editor al guardar) ───────── */
function matFor(k, c) {
  if (k === "t") return { kind: "text", payload: { text: String(c.text || "").trim() ? String(c.text) : "​", x: c.x, y: c.y, size: c.size, font: c.font, weight: c.weight, color: c.color, bg: c.bg, anim: c.anim } };
  if (k === "a") return /^https?:\/\//.test(c.url || "") ? { kind: "audio", payload: { url: c.url, name: c.name } } : null;
  if (k === "v1") {
    if (c.kind === "take") return /^https?:\/\//.test(c.takeUrl || "") ? { kind: "video", payload: { url: c.takeUrl, name: c.name, durationUs: Math.round(((+c.in || 0) + (+c.dur || 0) * (+c.speed || 1)) * US) } } : null;
    const im = c.scene && c.scene.els && c.scene.els.length === 1 && String(c.scene.els[0].fill || "").match(/url\(["']?(https?:[^"')]+)["']?\)/);
    return im ? { kind: "image", payload: { url: im[1], name: c.name } } : null;
  }
  let url = (String(c.bg || "").match(/url\(["']?([^"')]+)["']?\)/) || [])[1], big = false;
  if (url && /^data:image\/svg/.test(url) && url.length > 40000) { url = undefined; big = true; }
  if (url && /^data:/.test(url) && !/^data:image\/svg\+xml;base64,/.test(url)) return null;
  const o = { url, name: c.name, x: c.x, y: c.y, w: c.w, ar: c.ar, radius: c.radius };
  if (!url) { o.bg = big ? "transparent" : (c.bg || "transparent"); if (c.shape) o.shape = c.shape; if (/^url\(/.test(o.bg)) o.bg = "transparent"; }
  if (c.opacity != null) o.opacity = c.opacity;
  return { kind: "image", payload: o };
}
function rid(prefix) { const a = "abcdefghijklmnopqrstuvwxyz0123456789"; let s = ""; for (let i = 0; i < 16; i++) s += a[Math.floor(Math.random() * 36)]; return prefix + s; }
/* ───────── edición a la vez (editor abierto + MCP): cada escritura del estado lleva una revisión (state.rev) y solo se
   escribe si el estado sigue en la revisión que se leyó (comparar y escribir en un solo UPDATE). Si alguien escribió en
   el medio, se vuelve a leer y se aplica otra vez el cambio: nunca se pisa lo que hizo la persona en el editor. ───────── */
function newRev() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CONFLICT = () => ({ conflict: true, code: -32009, message: "El video cambió mientras se escribía (alguien lo está editando): vuelve a intentarlo" });
async function loadStateRow(projectId) {
  const sb = getSupabaseAdmin(); if (!sb) return { st: null, hasRow: false };
  const { data, error } = await sb.from("video_editor_state").select("state").eq("project_id", projectId).maybeSingle();
  if (error) throw { code: -32000, message: "No se pudo leer el estado del editor: " + error.message };
  return { st: data ? data.state : null, hasRow: !!data };
}
/* expect = { rev, hasRow } leído antes; sin expect, escribe siempre (proyecto nuevo) */
async function casState(sb, projectId, workspaceId, st, expect) {
  const now = new Date().toISOString();
  if (!expect) {
    const { error } = await sb.from("video_editor_state").upsert({ project_id: projectId, workspace_id: workspaceId, state: st, updated_at: now }, { onConflict: "project_id" });
    if (error) throw { code: -32000, message: "No se pudo guardar el estado del editor: " + error.message };
    return true;
  }
  if (!expect.hasRow) {
    const { data, error } = await sb.from("video_editor_state").upsert({ project_id: projectId, workspace_id: workspaceId, state: st, updated_at: now }, { onConflict: "project_id", ignoreDuplicates: true }).select("project_id");
    if (error) throw { code: -32000, message: "No se pudo guardar el estado del editor: " + error.message };
    return !!(data && data.length);
  }
  let q = sb.from("video_editor_state").update({ state: st, updated_at: now }).eq("project_id", projectId);
  q = expect.rev ? q.eq("state->>rev", String(expect.rev)) : q.is("state->>rev", null);
  const { data, error } = await q.select("project_id");
  if (error) throw { code: -32000, message: "No se pudo guardar el estado del editor: " + error.message };
  return !!(data && data.length);
}
/* el estado lo está escribiendo otro (el editor a mitad de un guardado): se espera un poco antes de leerlo */
const busyState = (st) => !!(st && st.pending && Date.now() - +st.pending < 15000);

/* ───────── herramientas que escriben las filas directo (video_segment_*, video_material_*, video_track_add,
   video_effect_*, video_template_register, motion/scene_project_apply_spec): antes de escribir esperan a que el editor
   abierto termine el guardado que tenga a medias y, después, suben la revisión del estado. El editor abierto ve la
   revisión nueva y junta el cambio con lo suyo (antes recargaba el video entero, o su próximo guardado escondía el
   cambio de la IA). ───────── */
export async function withEditorSync(projectId, fn) {
  const id = String(projectId || "").trim();
  if (!id) return fn();
  for (let i = 0; i < 6; i++) {
    let st = null;
    try { st = (await loadStateRow(id)).st; } catch { break; }
    if (!busyState(st)) break;
    await sleep(1500);
  }
  const out = await fn();
  try { await touchState(id); } catch { /* el cambio ya quedó en la base: el editor lo junta al guardar o al abrir */ }
  return out;
}
async function touchState(projectId) {
  const sb = getSupabaseAdmin(); if (!sb) return null;
  let ws = null;
  for (let i = 0; i < 4; i++) {
    const { st, hasRow } = await loadStateRow(projectId);
    if (!hasRow && !ws) {
      const { data } = await sb.from("musa_video_projects").select("workspace_id").eq("id", projectId).maybeSingle();
      if (!data) return null;
      ws = data.workspace_id;
    }
    const base = st && typeof st === "object" && !Array.isArray(st) ? st : {}, rev = newRev();
    if (await casState(sb, projectId, ws, { ...base, rev }, { rev: base.rev || null, hasRow })) return rev;
    await sleep(120 + Math.floor(Math.random() * 380));
  }
  return null;
}

/* tree: las filas ya leídas (DESPUÉS del estado) por quien llama; si no viene, se leen aquí */
async function writeModel(projectId, workspaceId, model, extraState, expect, treeIn) {
  const sb = getSupabaseAdmin(); if (!sb) throw { code: -32000, message: "Sin base de datos" };
  const tree = treeIn || await videoProjects.getVideoProjectTree(projectId);
  if (!tree) throw { code: -32004, message: `Video project not found: ${projectId}` };
  const key = Object.entries({ "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350], "16:9": [1920, 1080] }).find(([, v]) => v[0] === model.W && v[1] === model.H);
  const ratio = key ? key[0] : (model.W + ":" + model.H).slice(0, 12);
  const tracks = (tree.tracks || []).slice().sort((a, b) => a.z_order - b.z_order), T = {};
  tracks.forEach((tk) => { if (tk.type === "video" && +tk.z_order >= 50) { if (!T.ov) T.ov = tk.id; } else if (!T[tk.type]) T[tk.type] = tk.id; });
  const need = async (k, type, z) => { if (!T[k]) { const t = await videoProjects.addVideoTrack(projectId, z != null ? { type, zOrder: z } : { type }); T[k] = t.id; } return T[k]; };
  const mats = [], segs = [], warn = [], st = { fmt: ratio, pad: model.pad || "#000000", grad: model.grad || null, total: model.total || null, persp: model.persp || null, fps: model.fps || 30, gtr: model.gtr || null, markers: model.markers || null, lanes: model.lanes || null, v1: [], m: [], t: [], a: [] };
  const lane = { v1: ["video", "video", 0], m: ["ov", "video", 50], t: ["text", "text"], a: ["audio", "audio"] };
  VC.relayoutV1(model);
  for (const k of ["v1", "m", "t", "a"]) {
    for (const c0 of model[k] || []) {
      const c = JSON.parse(JSON.stringify(c0)), mf = matFor(k, c);
      if (!c.id) c.id = rid("c").slice(0, 10);
      if (mf) {
        try { mf.payload = videoProjects.validateMaterialPayload(mf.kind, mf.payload); } catch (e) { warn.push((c.name || c.text || c.id) + ": " + (e.message || e)); mf.payload = null; }
      }
      if (mf && mf.payload) {
        const L = lane[k], track = await need(L[0], L[1], L[2]), mid = rid("vidmat_"), sid = rid("vidseg_"), speed = k === "v1" ? (+c.speed || 1) : 1;
        const dUs = Math.max(1, Math.round((+c.dur || 0.1) * US));
        mats.push({ id: mid, project_id: projectId, kind: mf.kind, payload: mf.payload, slot: null });
        segs.push({ id: sid, track_id: track, material_id: mid, target_start_us: Math.round((+c.start || 0) * US), target_dur_us: dUs, source_start_us: Math.round((+c.in || 0) * US), source_dur_us: Math.max(1, Math.round(dUs * speed)), speed, clip: null, extra_refs: [] });
        c._s = sid;
      } else c._s = null;
      if (k === "v1" && c.kind === "take" && !/^https?:/.test(c.takeUrl || "")) warn.push("La toma «" + (c.name || c.id) + "» necesita un video con URL pública (https)");
      st[k].push(c);
    }
  }
  Object.assign(st, extraState || {});
  /* 1 · reclamo: la foto completa queda «pendiente» con una revisión nueva, solo si nadie escribió desde que se leyó.
     Así un editor abierto no puede guardar encima a mitad de esto (su revisión ya no coincide: junta los cambios). */
  const rev1 = newRev();
  if (!(await casState(sb, projectId, workspaceId, { ...st, rev: rev1, pending: Date.now() }, expect))) throw CONFLICT();
  /* 2 · contenido anterior: se reemplaza entero (los ids de clip se conservan en el estado). Se borra por pista y por
     proyecto (dos pedidos, sin importar cuántos clips haya; también lo creado entre la lectura y el reclamo) */
  const trackIds = (tree.tracks || []).map((t) => t.id);
  if (trackIds.length) { const { error } = await sb.from("musa_video_segments").delete().in("track_id", trackIds); if (error) throw { code: -32000, message: "No se pudo limpiar el video: " + error.message }; }
  { const { error } = await sb.from("musa_video_materials").delete().eq("project_id", projectId).neq("kind", "canvas"); if (error) throw { code: -32000, message: "No se pudo limpiar el video: " + error.message }; }
  for (let i = 0; i < mats.length; i += 100) { const { error } = await sb.from("musa_video_materials").insert(mats.slice(i, i + 100)); if (error) throw { code: -32000, message: "No se pudieron crear los materiales: " + error.message }; }
  for (let i = 0; i < segs.length; i += 100) { const { error } = await sb.from("musa_video_segments").insert(segs.slice(i, i + 100)); if (error) throw { code: -32000, message: "No se pudieron crear los clips: " + error.message }; }
  const durUs = Math.round(VC.durOf(model) * US);
  await sb.from("musa_video_projects").update({ canvas_w: model.W, canvas_h: model.H, fps: model.fps || 30, ratio, duration_us: durUs, updated_at: new Date().toISOString() }).eq("id", projectId);
  /* 3 · la foto final (con las filas nuevas). Si en el medio alguien tomó la foto pendiente (ya trae este cambio, con
     los ids de estas filas) y guardó la suya, esa manda y estas filas siguen siendo las suyas: no se tocan. */
  const rev2 = newRev();
  if (!(await casState(sb, projectId, workspaceId, { ...st, rev: rev2 }, { rev: rev1, hasRow: true }))) warn.push("El editor abierto tomó este cambio y lo terminó de guardar él");
  return { clips: { v1: st.v1.length, m: st.m.length, t: st.t.length, a: st.a.length }, warnings: warn, durationS: VC.durOf(model), rev: rev2 };
}

async function loadState(projectId) {
  const sb = getSupabaseAdmin(); if (!sb) return null;
  const { data } = await sb.from("video_editor_state").select("state").eq("project_id", projectId).maybeSingle();
  return data ? data.state : null;
}
async function projectWs(projectId) {
  const sb = getSupabaseAdmin();
  const { data } = await sb.from("musa_video_projects").select("id, workspace_id, name").eq("id", projectId).maybeSingle();
  if (!data) throw { code: -32004, message: `Video project not found: ${projectId}` };
  return data;
}
/* el código → modelo (lo que se puede leer sin ejecutar) */
function parseCode(code) {
  const kind = VC.detect(code);
  if (kind === "musa-html") { const r = VC.fromMusaHtml(code); return { kind, ...r }; }
  if (kind === "musa-json") return { kind, ...VC.fromJson(code) };
  if (kind === "html" || kind === "remotion") {
    /* tamaño y nombre para crear el proyecto; el resto lo mide el editor */
    const num = (re) => { const m = re.exec(code); return m ? +m[1] : null; };
    const W = kind === "remotion" ? num(/width\s*[=:]\s*\{?\s*(\d{2,5})/) : num(/data-width\s*=\s*["']?(\d{2,5})/), H = kind === "remotion" ? num(/height\s*[=:]\s*\{?\s*(\d{2,5})/) : num(/data-height\s*=\s*["']?(\d{2,5})/);
    const fps = num(/(?:data-fps\s*=\s*["']?|fps\s*[=:]\s*\{?\s*)(\d{1,3})/) || 30, title = (/<title>([^<]{1,80})<\/title>/i.exec(code) || [])[1];
    return { kind, pending: true, model: { name: title || (kind === "remotion" ? "Video Remotion" : "Video desde código"), W: W || 1920, H: H || 1080, fps, v1: [], m: [], t: [], a: [] }, warnings: [] };
  }
  if (kind === "unknown" && ML && ML.isCanvasCode(code)) return { kind: "html", pending: true, model: { name: "Video 3D desde código", W: 1080, H: 1920, fps: 30, v1: [], m: [], t: [], a: [] }, warnings: [] };
  if (kind === "motion-spec") throw { code: -32602, message: "Es un MusaMotionSpec: usa motion_project_create_from_spec / motion_project_apply_spec." };
  throw { code: -32602, message: "No reconozco el código: manda HTML (HyperFrames/GSAP/CSS), Remotion (TSX/JSX) o el JSON/HTML de Musa (video_code_get)." };
}

/* ───────── código vivo (Three.js, p5, WebGL, canvas, Remotion 3D) ───────── */
const nOr = (v, d) => (typeof v === "number" && isFinite(v) ? v : v != null && v !== "" && isFinite(+v) ? +v : d);
/* el código manda: params, keyframes, escena y objetos nuevos se escriben en el código del clip (video-live-core) */
function applyLiveEdits(c, p) {
  return ML.applyEdits(c.live, { params: p.params, keyframes: p.keyframes, scene: p.scene, addObjects: Array.isArray(p.addObjects) ? p.addObjects.slice(0, 20) : undefined });
}
function describeLive(c, withCode) {
  const L = ML.normalize(c.live || {}), an = ML.analyze(String(L.src || "")), ov = L.ov || {}, bk = ML.blockOf(L.src);
  return {
    clipId: c.id, name: c.name, lib: ML.LIB_NAMES[an.lib] || "Código", kind: L.kind || "html",
    start: c.start, duration: c.dur, x: c.x, y: c.y, width: c.w, aspect: c.ar,
    timing: { offset: +L.off || 0, speed: L.speed != null ? +L.speed : 1, loop: +L.loop || 0 },
    canvas: L.W && L.H ? { width: L.W, height: L.H, fixed: true } : { fixed: false, note: "toma la forma del clip" },
    params: an.params.map((x) => { const e = ov[x.key]; return { key: x.key, name: x.name, type: x.type, value: x.v, keyframes: e && e.kf ? e.kf : undefined, animatable: !!x.kfable, min: x.min, max: x.max }; }),
    objects: an.lib === "three" || an.lib === "three-r3f" ? ML.codeObjects(L.src) : [],
    canAddObjects: (an.lib === "three" || an.lib === "three-r3f") && ML.canAdd(L.src),
    block: Object.keys(ov).map((k) => ({ key: k, ...ov[k] })),
    blockError: bk.err || undefined,
    code: withCode === false ? undefined : L.src,
  };
}
async function liveTx(projectId, p, fn) {
  const proj = await projectWs(projectId);
  if (p.workspaceId && p.workspaceId !== proj.workspace_id) throw { code: -32003, message: "Video project belongs to another workspace" };
  /* leer el estado (primero) y las filas → aplicar el cambio → escribir solo si nadie escribió en el medio; si no, otra
     vuelta con lo nuevo. Presupuesto de pedidos: el plan de Workers corta en 50 por llamada. */
  let budget = 44;
  for (let tries = 0, waits = 0; ; ) {
    const { st, hasRow } = await loadStateRow(projectId); budget -= 1;
    if (busyState(st) && waits < 6 && budget > 16) { waits++; await sleep(1500); continue; }
    if (budget < 14) throw { code: -32009, message: "El editor abierto está guardando cambios sin parar: vuelve a intentar en unos segundos (tu cambio no se aplicó)" };
    if (st && st.codePending && st.codePending.src) throw { code: -32009, message: "Este video tiene código pendiente de convertir: ábrelo una vez en el editor (editorUrl de video_code_apply) y vuelve a intentar." };
    const tree = await videoProjects.getVideoProjectTree(projectId); budget -= 4;
    if (!tree) throw { code: -32004, message: `Video project not found: ${projectId}` };
    const model = buildModel(tree, st), out = fn(model);
    try {
      const res = await writeModel(projectId, proj.workspace_id, model, null, { rev: (st && st.rev) || null, hasRow }, tree);
      return { out, res };
    } catch (e) {
      budget -= 1;
      if (!(e && e.conflict) || ++tries > 4 || budget < 14) { if (e && e.conflict) { delete e.conflict; e.message = "El editor abierto guardó cambios justo ahora: vuelve a intentar (tu cambio no se aplicó)"; } throw e; }
      await sleep(250 + Math.floor(Math.random() * 750));
    }
  }
}

export async function handleVideoCodeTool(method, p, auth, h) {
  const editorUrl = (id) => `${h.apiBaseUrl()}/#video/${encodeURIComponent(id)}`;
  if (method === "video_live_add" || method === "video_live_update") {
    if (!ML) throw { code: -32000, message: "Código vivo no disponible en este servidor" };
    const projectId = String(p.projectId || "");
    if (p.code != null && String(p.code).length > 2_000_000) throw { code: -32602, message: "El código supera 2 MB" };
    const { out, res } = await liveTx(projectId, p, (model) => {
      let c;
      if (method === "video_live_add") {
        const code = String(p.code || ""); if (!code.trim()) throw { code: -32602, message: "code es requerido" };
        const kind = p.kind === "remotion" || p.kind === "html" ? p.kind : VC.detect(code) === "remotion" ? "remotion" : "html";
        const w = Math.max(1, Math.min(400, nOr(p.width, 100))), an = ML.analyze(code);
        const title = (/<title>([^<]{1,60})<\/title>/i.exec(code) || [])[1];
        c = { id: rid("c").slice(0, 10), name: String(p.name || ((ML.LIB_NAMES[an.lib] || "Código") + (title ? " · " + title : ""))).slice(0, 80),
          start: Math.max(0, nOr(p.start, 0)), dur: Math.max(0.1, nOr(p.duration, 5)), x: nOr(p.x, 50), y: nOr(p.y, 50), w, ar: nOr(p.aspect, w >= 99.9 ? Math.round(model.W / model.H * 1e4) / 1e4 : 1),
          radius: 0, bg: "transparent", anim: "none", opacity: 1, live: { src: code, kind, sel: nOr(p.canvasIndex, -1), off: Math.max(0, nOr(p.offset, 0)), speed: nOr(p.speed, 1), ov: {} } };
        if (nOr(p.loop, 0) > 0) c.live.loop = +p.loop;
        if (nOr(p.canvasWidth, 0) > 0 && nOr(p.canvasHeight, 0) > 0) { c.live.W = Math.min(4096, Math.round(+p.canvasWidth)); c.live.H = Math.min(4096, Math.round(+p.canvasHeight)); }
        model.m.push(c);
      } else {
        c = (model.m || []).find((x) => x.id === String(p.clipId || ""));
        if (!c || !c.live) throw { code: -32004, message: "No hay un clip de código vivo con ese id (video_live_get)" };
        if (p.reset) { ML.normalize(c.live); c.live.src = ML.writeBlock(c.live.src, {}); c.live.ov = {}; }
        if (p.code != null && String(p.code).trim()) { c.live.src = String(p.code); c.live.ov = ML.ovOf(c.live.src); c.live.kind = p.kind === "remotion" || p.kind === "html" ? p.kind : VC.detect(c.live.src) === "remotion" ? "remotion" : "html"; }
        if (p.name != null) c.name = String(p.name).slice(0, 80);
        [["start", "start"], ["duration", "dur"], ["x", "x"], ["y", "y"], ["width", "w"], ["aspect", "ar"]].forEach(([a, b]) => { if (p[a] != null && isFinite(+p[a])) c[b] = +p[a]; });
        if (p.offset != null) c.live.off = Math.max(0, nOr(p.offset, 0));
        if (p.speed != null) c.live.speed = nOr(p.speed, 1);
        if (p.loop != null) { if (nOr(p.loop, 0) > 0) c.live.loop = +p.loop; else delete c.live.loop; }
        if (nOr(p.canvasWidth, 0) > 0 && nOr(p.canvasHeight, 0) > 0) { c.live.W = Math.round(+p.canvasWidth); c.live.H = Math.round(+p.canvasHeight); }
      }
      const unknown = applyLiveEdits(c, p);
      return { clip: describeLive(c, !!p.includeCode), unknown };
    });
    return { projectId, ...out, clips: res.clips, durationS: res.durationS, editorUrl: editorUrl(projectId),
      warnings: res.warnings.concat(out.unknown.length ? ["Parámetros que no encontré en el código (revisa video_live_get): " + out.unknown.join(", ")] : []),
      note: "El código del clip ya tiene los cambios (en el editor se ven al instante en «</> Código del clip»). Lo que alguien cambie en el inspector también se escribe en el código: léelo con video_live_get antes de reescribirlo entero." };
  }
  if (method === "video_live_get") {
    if (!ML) throw { code: -32000, message: "Código vivo no disponible en este servidor" };
    const projectId = String(p.projectId || "");
    const tree = await videoProjects.getVideoProjectTree(projectId);
    if (!tree) throw { code: -32004, message: `Video project not found: ${projectId}` };
    const model = buildModel(tree, await loadState(projectId));
    const list = (model.m || []).filter((c) => c.live && (!p.clipId || c.id === p.clipId)).map((c) => describeLive(c, p.includeCode !== false));
    return { projectId, clips: list, editorUrl: editorUrl(projectId), note: list.length ? "Cambia parámetros, keyframes o la escena 3D con video_live_update." : "Este video no tiene clips de código vivo. Agrega uno con video_live_add." };
  }
  if (method === "video_code_get") {
    const projectId = String(p.projectId || "");
    const tree = await videoProjects.getVideoProjectTree(projectId);
    if (!tree) throw { code: -32004, message: `Video project not found: ${projectId}` };
    const st = await loadState(projectId), model = buildModel(tree, st), fmt = p.format === "remotion" || p.format === "json" ? p.format : "html";
    if (st && st.codePending && st.codePending.src) return { projectId, format: "pending", code: st.codePending.src, needsEditor: true, editorUrl: editorUrl(projectId), note: "Este video llegó como código que hay que ejecutar (HTML ajeno o Remotion) y todavía no se abrió en el editor. Abre editorUrl para convertirlo en clips; mientras tanto devuelvo el código original." };
    /* el código que escribió el editor, clip por clip (video_code_blocks; los guardados viejos lo tenían en el estado) */
    let blocks = (st && st.code && st.code.blocks) || {};
    try {
      const { data: rows, error } = await getSupabaseAdmin().from("video_code_blocks").select("clip_id, fp, block").eq("project_id", projectId);
      if (!error && rows) { blocks = { ...blocks }; rows.forEach((r) => { blocks[r.clip_id] = { fp: r.fp, html: r.block && r.block.html, js: r.block && r.block.js, pre: r.block && r.block.pre, eases: r.block && r.block.eases }; }); }
    } catch (e) { /* sin la tabla (migración 43): se escribe lo semántico */ }
    const g = VC.generate(model, { blocks });
    const code = fmt === "json" ? VC.toJson(model) : fmt === "remotion" ? VC.toRemotion(g.code) : g.code;
    const clips = { v1: model.v1.length, m: model.m.length, t: model.t.length, a: model.a.length };
    return { projectId, format: fmt, clips, durationS: VC.durOf(model), canvas: { width: model.W, height: model.H, fps: model.fps }, code, editorUrl: editorUrl(projectId),
      note: (g.missing.length ? g.missing.length + " clip(s) con movimiento compuesto (órbitas, ráfagas, cámara…) quedan con un comentario: abre el editor una vez para escribirlo cuadro a cuadro; igual vuelven exactos desde data-musa. " : "")
        + "Edita y manda con video_code_apply. Lo que no cambies vuelve exacto (data-musa); en un bloque «▸ id» que cambies, manda tu GSAP." };
  }
  if (method === "video_code_apply") {
    const projectId = String(p.projectId || ""), proj = await projectWs(projectId);
    if (p.workspaceId && p.workspaceId !== proj.workspace_id) throw { code: -32003, message: "Video project belongs to another workspace" };
    const code = String(p.code || ""); if (!code.trim()) throw { code: -32602, message: "code es requerido" };
    if (code.length > 4_000_000) throw { code: -32602, message: "El código supera 4 MB" };
    const r = parseCode(code);
    if (r.pending) {
      const sb = getSupabaseAdmin(), st0 = (await loadState(projectId)) || {};
      const st = { ...st0, rev: newRev(), codePending: { src: code, kind: r.kind, at: Date.now() } };
      delete st.pending;
      await sb.from("video_editor_state").upsert({ project_id: projectId, workspace_id: proj.workspace_id, state: st, updated_at: new Date().toISOString() }, { onConflict: "project_id" });
      await sb.from("musa_video_projects").update({ updated_at: new Date().toISOString() }).eq("id", projectId);
      return { projectId, needsEditor: true, kind: r.kind, editorUrl: editorUrl(projectId), note: "Código guardado. Es código que hay que ejecutar (HTML ajeno o Remotion): al abrir editorUrl, el editor lo corre en un sandbox y lo convierte en clips editables (y lo guarda). Después video_code_get ya devuelve el video como código de Musa." };
    }
    /* el código reemplaza el video: se escribe sobre la revisión actual (si el editor guardó en el medio, otra vuelta) */
    let res, budget = 40;
    for (let tries = 0, waits = 0; ; ) {
      const { st, hasRow } = await loadStateRow(projectId); budget -= 1;
      if (busyState(st) && waits < 6 && budget > 16) { waits++; await sleep(1500); continue; }
      const tree = await videoProjects.getVideoProjectTree(projectId); budget -= 4;
      try { res = await writeModel(projectId, proj.workspace_id, JSON.parse(JSON.stringify(r.model)), null, { rev: (st && st.rev) || null, hasRow }, tree); break; }
      catch (e) { budget -= 1; if (!(e && e.conflict) || ++tries > 4 || budget < 14) { if (e && e.conflict) { delete e.conflict; e.message = "El editor abierto guardó cambios justo ahora: vuelve a intentar"; } throw e; } await sleep(250 + Math.floor(Math.random() * 750)); }
    }
    return { projectId, kind: r.kind, ...res, changed: r.changed || [], warnings: (r.warnings || []).concat(res.warnings), editorUrl: editorUrl(projectId), note: "Aplicado en las mismas tablas que el editor. Abre editorUrl para verlo y seguir editando con arrastrar y soltar." };
  }
  if (method === "video_project_create_from_code") {
    const workspaceId = String(p.workspaceId || "").trim(); if (!workspaceId) throw { code: -32602, message: "workspaceId es requerido (list_workspaces)" };
    const code = String(p.code || ""); if (!code.trim()) throw { code: -32602, message: "code es requerido" };
    if (code.length > 4_000_000) throw { code: -32602, message: "El código supera 4 MB" };
    const r = parseCode(code), m = r.model;
    const key = Object.entries({ "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350], "16:9": [1920, 1080] }).find(([, v]) => v[0] === m.W && v[1] === m.H);
    const project = await videoProjects.createVideoProject(workspaceId, { name: String(p.name || m.name || "Video desde código").slice(0, 120), canvasW: m.W, canvasH: m.H, fps: m.fps || 30, ratio: key ? key[0] : (m.W + ":" + m.H).slice(0, 12) }, "ai:musa");
    if (r.pending) {
      const sb = getSupabaseAdmin();
      await sb.from("video_editor_state").upsert({ project_id: project.id, workspace_id: workspaceId, state: { fmt: project.ratio, fps: m.fps || 30, pad: "#000000", v1: [], m: [], t: [], a: [], rev: newRev(), codePending: { src: code, kind: r.kind, at: Date.now() } }, updated_at: new Date().toISOString() }, { onConflict: "project_id" });
      return { project, needsEditor: true, kind: r.kind, editorUrl: editorUrl(project.id), note: "Proyecto creado. Al abrir editorUrl, el editor ejecuta el código en un sandbox y lo convierte en clips editables (textos, formas, imágenes, vectores, video y audio con keyframes)." };
    }
    const res = await writeModel(project.id, workspaceId, m, null, { rev: null, hasRow: false });
    return { project, kind: r.kind, ...res, warnings: (r.warnings || []).concat(res.warnings), editorUrl: editorUrl(project.id), note: "Video creado y editable en el editor (mismas tablas). Léelo como código con video_code_get." };
  }
  throw { code: -32601, message: "Método desconocido: " + method };
}
