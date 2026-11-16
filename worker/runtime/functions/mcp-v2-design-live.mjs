// Diseño ↔ código por MCP: las capas de «código vivo» de un diseño (Three.js, React Three Fiber, p5, canvas, gráficos…)
// se leen y se editan igual que en la web (bridge-design-live.js): el código manda y vive en la capa (data-live,
// codificado). Parámetros, valores del código, objetos 3D, tiempos y «cuadro propio» se escriben en el código con el
// mismo núcleo que el editor de video (video-live-core.js) — sin IA, sin tokens.
// La portada de la lámina y su modo de presentación se cambian con set_animation (posterSec, presentMode).
// El acceso al template (templateId → workspace) ya lo validó authorizeMcpCall antes de llegar aquí.
import * as cheerio from "cheerio";
import "../../../public/musa/video-live-core.js";
import "../../../public/musa/design-code-core.js";
import { normalizeAnimation, posterOf } from "../../../shared/animationSchema.ts";

const ML = globalThis.MusaVideoLive, DC = globalThis.MusaDesignCode;
const S = (o) => ({ type: "string", ...o });
const N = (o) => ({ type: "number", ...o });
const O = (o) => ({ type: "object", ...o });
const A = (o) => ({ type: "array", ...o });
const err = (message, code = -32000) => ({ code, message });

const TIMING = O({ description: "Tiempos de la capa: { start (segundo de la lámina en que arranca), offset (segundo del código en ese momento), speed, loop (segundos; 0 = sin bucle), holdSec (cuadro propio: segundo del código fijo, sin seguir a la lámina; null lo quita) }" });

export const DESIGN_LIVE_TOOLS = [
  {
    name: "design_live_get",
    description: "Diseño · Lee las capas de CÓDIGO VIVO de un diseño (Three.js, React Three Fiber, p5, PixiJS, canvas, Chart.js… que llegaron al pegar código o desde el editor de video) y el reloj de cada lámina. Por capa: nombre, librería, tiempos (start/offset/speed/loop/holdSec = cuadro propio), parámetros del código, objetos 3D con sus propiedades, todos los valores editables del código (values), el bloque ▸ musa y el código. Por lámina: portada (posterSec = el instante que muestran el lienzo, las miniaturas, el PDF y el enlace público), modo de presentación y duración. Edita con design_live_update; cambia la portada con set_animation { posterSec }.",
    inputSchema: { type: "object", properties: { templateId: S({}), frameId: S({ description: "Una lámina (por defecto, todas)" }), layerId: S({ description: "Una capa viva" }), includeCode: { type: "boolean", description: "Incluir el código (por defecto sí cuando pides una capa)" } }, required: ["templateId"] },
  },
  {
    name: "design_live_update",
    description: "Diseño · Edita una capa de código vivo: EL CÓDIGO MANDA, todo se escribe en su código (lo mismo que hace una persona en el lienzo o el inspector). code = reemplazar el código entero; params / values (cualquier número, color, sí/no o nombre del código, por id o «Objeto|Etiqueta») / scene { \"<objeto>|<prop>\": valor } con prop px py pz rx ry rz s color emi op int vis fov (objeto = name, variable o cam) / keyframes; addObjects [{type: box|sphere|torus|knot|cone|cylinder|icosa|plane|pointLight|dirLight, name, x, y, z, color, size}], duplicateObjects, removeObjects (solo los agregados en Musa); timing { start, offset, speed, loop, holdSec }. La imagen de portada de la capa se vuelve a generar al abrir el diseño en el editor.",
    inputSchema: { type: "object", properties: { templateId: S({}), frameId: S({}), layerId: S({}), code: S({ description: "Código completo nuevo (HTML, JS o Remotion TSX)" }), name: S({}), params: O({}), values: O({}), scene: O({}), keyframes: O({}), addObjects: A({ items: { type: "object" } }), duplicateObjects: A({ items: {} }), removeObjects: A({ items: { type: "string" } }), timing: TIMING }, required: ["templateId", "frameId", "layerId"] },
  },
  {
    name: "design_live_add",
    description: "Diseño · Agrega a una lámina una capa de CÓDIGO VIVO con tu código (HTML con <canvas>, Three.js, React Three Fiber/Remotion, p5, PixiJS, canvas 2D, Chart.js…). El código corre en un espacio aislado y queda editable como en el editor de video (objetos 3D en el lienzo, valores del código, tiempos). x/y/width/height en px del frame (por defecto ocupa la lámina). Para pegar una página entera (HTML con JavaScript, Tailwind, GSAP…) usa import_design_source: Musa la convierte en capas editables con sus animaciones.",
    inputSchema: { type: "object", properties: { templateId: S({}), frameId: S({}), code: S({}), kind: S({ enum: ["html", "remotion"] }), name: S({}), x: N({}), y: N({}), width: N({}), height: N({}), canvasIndex: N({ description: "Qué <canvas> del código se muestra (por defecto el más grande)" }), timing: TIMING }, required: ["templateId", "frameId", "code"] },
  },
];
export const DESIGN_LIVE_NAMES = new Set(DESIGN_LIVE_TOOLS.map((t) => t.name));

async function loadTpl(h, p) {
  const tpl = await h.templates.getTemplate(p.templateId);
  if (!tpl) throw err("Template not found: " + p.templateId, -32602);
  if (!Array.isArray(tpl.frames) || !tpl.frames.length) throw err("NO_FRAMES_ERROR: este diseño no tiene frames");
  return tpl;
}
function frameOf(tpl, id) {
  const f = id ? tpl.frames.find((x) => x.id === id) : tpl.frames[0];
  if (!f) throw err(`Frame not found: ${id} (frames: ${tpl.frames.map((x) => x.id).slice(0, 20).join(", ")})`, -32602);
  return f;
}
function load$(frame) { return cheerio.load(String(frame.html || ""), null, false); }
function liveEls($) { return $('[data-layer-kind="live"][data-live]').toArray(); }
function styleBox(st) {
  const g = (k) => { const m = new RegExp("(?:^|;)\\s*" + k + "\\s*:\\s*(-?[\\d.]+)px", "i").exec(String(st || "")); return m ? +m[1] : null; };
  return { x: g("left"), y: g("top"), width: g("width"), height: g("height") };
}
function describe($, el, withCode) {
  const L = DC.decLive($(el).attr("data-live")) || {};
  const an = ML.analyze(String(L.src || "")), ov = ML.ovOf(L.src) || {}, bk = ML.blockOf(L.src);
  return {
    layerId: $(el).attr("data-layer-id"), name: $(el).attr("data-layer-name") || L.name || "Código vivo",
    lib: ML.LIB_NAMES[an.lib] || "Código", kind: L.kind || "html", box: styleBox($(el).attr("style")),
    timing: { start: +L.start || 0, offset: +L.off || 0, speed: L.speed != null ? +L.speed : 1, loop: +L.loop || 0, holdSec: L.hold != null ? +L.hold : null },
    view: { width: L.W || null, height: L.H || null, fit: L.fit || "viewport", canvasIndex: L.sel != null ? L.sel : -1 },
    posterImage: L.poster && L.poster.url ? { url: L.poster.url, atSec: L.poster.at != null ? L.poster.at : null } : null,
    params: an.params.map((x) => { const e = ov[x.key]; return { key: x.key, name: x.name, type: x.type, value: x.v, keyframes: e && e.kf ? e.kf : undefined }; }),
    objects: an.lib === "three" || an.lib === "three-r3f" ? ML.codeObjects(L.src) : [],
    canAddObjects: (an.lib === "three" || an.lib === "three-r3f") && ML.canAdd(L.src),
    values: ML.codeValues(L.src).filter((x) => x.via === "value").slice(0, 600).map((x) => ({ id: x.i, object: x.objLabel || undefined, part: x.part || undefined, label: x.label, type: x.type === "hex" ? "color" : x.type, value: x.type === "hex" ? "#" + ("000000" + Number(x.v).toString(16)).slice(-6) : x.v })),
    block: Object.keys(ov).map((k) => ({ key: k, ...ov[k] })), blockError: bk.err || undefined,
    code: withCode ? L.src : undefined,
  };
}
function frameClock(f) {
  const a = f.animation ? normalizeAnimation(f.animation) : null;
  return { posterSec: a ? posterOf(a) : 0, presentMode: (a && a.present && a.present.mode) || "enter", durationSec: a ? a.timeline.durationSec : null, animations: a ? a.clips.length : 0 };
}
function timingInto(L, t) {
  if (!t || typeof t !== "object") return;
  const n = (v) => (v != null && Number.isFinite(+v) ? +v : null);
  if (n(t.start) != null) L.start = Math.max(0, n(t.start));
  if (n(t.offset) != null) L.off = Math.max(0, n(t.offset));
  if (n(t.speed) != null) L.speed = n(t.speed);
  if (n(t.loop) != null) { if (n(t.loop) > 0) L.loop = n(t.loop); else delete L.loop; }
  if (t.holdSec === null) delete L.hold; else if (n(t.holdSec) != null) L.hold = Math.max(0, n(t.holdSec));
}
/* donde van las capas nuevas: dentro de la caja del frame si el HTML tiene una (igual que el editor) */
function contentBox($) {
  const tops = $.root().children().toArray().filter((c) => c.type === "tag" && !/^(style|link|meta|script|title|noscript|template)$/i.test(c.name || ""));
  const top = tops[0];
  if (!top || tops.length > 1) return $.root();
  if (/^(svg|bezier|image|text|shape|button|live)$/.test($(top).attr("data-layer-kind") || "")) return $.root();
  if (/^(img|svg|video|canvas|input|br|hr|picture)$/i.test(top.name || "")) return $.root();
  if (!$(top).children().length) return $.root();
  return $(top);
}

export async function handleDesignLiveTool(method, p, auth, h) {
  if (!ML || !DC) throw err("Código vivo no disponible en este servidor");
  const editorUrl = (id) => `${h.apiBaseUrl()}/#crear/disenos/tpl:${encodeURIComponent(id)}`;
  if (method === "design_live_get") {
    const tpl = await loadTpl(h, p);
    const frames = (p.frameId ? [frameOf(tpl, p.frameId)] : tpl.frames).map((f) => {
      const $ = load$(f);
      const layers = liveEls($).filter((el) => !p.layerId || $(el).attr("data-layer-id") === p.layerId).map((el) => describe($, el, p.includeCode != null ? !!p.includeCode : !!p.layerId));
      return { frameId: f.id, name: f.name, ...frameClock(f), liveLayers: layers, pendingCode: !!(f.codeSource && f.codeSource.src) };
    }).filter((f) => !p.layerId || f.liveLayers.length);
    if (p.layerId && !frames.length) throw err("No hay una capa viva con layerId " + p.layerId, -32602);
    return { templateId: tpl.id, frames, editorUrl: editorUrl(tpl.id),
      notes: ["posterSec (portada) = el instante de la lámina que muestran el lienzo, las miniaturas, el PDF y el enlace público: cámbialo con set_animation { posterSec } cuando quieras", "presentMode: enter = se reproduce al entrar y queda en su último cuadro · click = portada y se reproduce con un clic · poster = quieta", "pendingCode = el código llegó sin navegador: se termina de convertir al abrir el diseño en el editor"] };
  }
  if (method === "design_live_update") {
    const tpl = await loadTpl(h, p), f = frameOf(tpl, p.frameId), $ = load$(f);
    const el = liveEls($).find((x) => $(x).attr("data-layer-id") === p.layerId);
    if (!el) throw err("No hay una capa viva con layerId " + p.layerId + " en el frame " + f.id + " (design_live_get lista las capas)", -32602);
    const L = DC.decLive($(el).attr("data-live"));
    if (!L) throw err("La capa no tiene código válido");
    if (p.code != null) { const code = String(p.code); if (!code.trim()) throw err("code vacío", -32602); if (code.length > 2_000_000) throw err("El código supera 2 MB", -32602); L.src = code; }
    const live = { src: L.src, kind: L.kind, ov: ML.ovOf(L.src) };
    const unknown = ML.applyEdits(live, { params: p.params, keyframes: p.keyframes, scene: p.scene, values: p.values && typeof p.values === "object" ? p.values : undefined,
      addObjects: Array.isArray(p.addObjects) ? p.addObjects.slice(0, 20) : undefined, duplicateObjects: Array.isArray(p.duplicateObjects) ? p.duplicateObjects.slice(0, 20) : undefined, removeObjects: Array.isArray(p.removeObjects) ? p.removeObjects.slice(0, 20) : undefined });
    L.src = live.src;
    timingInto(L, p.timing);
    /* la imagen de portada ya no corresponde: el editor la vuelve a dibujar al abrir */
    if (L.poster) L.poster = { ...L.poster, sig: "stale" };
    $(el).attr("data-live", DC.encLive(L));
    if (p.name) $(el).attr("data-layer-name", String(p.name).slice(0, 80));
    f.html = $.html(); f.lastModifiedBy = p.author || "agent:design_live_update"; f.lastModifiedAt = new Date().toISOString();
    const saved = await h.templates.updateTemplate(tpl.id, { frames: tpl.frames });
    if (!saved) throw err("No se pudo guardar el diseño (reintenta)");
    return { templateId: tpl.id, frameId: f.id, layer: describe(load$(f), load$(f)('[data-layer-id="' + String(p.layerId).replace(/"/g, "") + '"]').get(0), false), unknown: unknown.length ? unknown : undefined, editorUrl: editorUrl(tpl.id),
      note: "Escrito en el código de la capa. Si el diseño está abierto en la web, se pone al día solo." };
  }
  if (method === "design_live_add") {
    const tpl = await loadTpl(h, p), f = frameOf(tpl, p.frameId), $ = load$(f);
    const code = String(p.code || ""); if (!code.trim()) throw err("code es requerido", -32602);
    if (code.length > 2_000_000) throw err("El código supera 2 MB", -32602);
    const W = Math.max(16, Math.round(+p.width || +f.width || 1080)), H = Math.max(16, Math.round(+p.height || +f.height || 1080));
    const kind = p.kind === "remotion" || /from\s*["']remotion["']|useCurrentFrame\s*\(/.test(code) ? "remotion" : "html";
    const an = ML.analyze(code), name = String(p.name || (ML.LIB_NAMES[an.lib] || "Código") + " · escena").slice(0, 80);
    const L = DC.cleanLive({ src: code, kind, sel: p.canvasIndex != null ? +p.canvasIndex : -1, W, H, fit: "viewport", start: 0, off: 0, speed: 1, fps: 30 });
    timingInto(L, p.timing);
    const id = "musa_live_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    contentBox($).append(DC.liveHtml(L, { x: Math.round(+p.x || 0), y: Math.round(+p.y || 0), w: W, h: H }, id, name));
    f.html = $.html(); f.lastModifiedBy = p.author || "agent:design_live_add"; f.lastModifiedAt = new Date().toISOString();
    const saved = await h.templates.updateTemplate(tpl.id, { frames: tpl.frames });
    if (!saved) throw err("No se pudo guardar el diseño (reintenta)");
    return { templateId: tpl.id, frameId: f.id, layerId: id, layer: describe(load$(f), load$(f)('[data-layer-id="' + id + '"]').get(0), false), editorUrl: editorUrl(tpl.id),
      note: "La capa corre su código en un espacio aislado y se edita con design_live_update o en la web (clic en un objeto 3D). Su imagen de portada se genera al abrir el diseño en el editor." };
  }
  throw err("Herramienta desconocida: " + method, -32601);
}
