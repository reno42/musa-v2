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
import { posterStyles } from "../../../api/src/services/designStatic.ts";

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
  {
    name: "design_code_get",
    description: "Diseño · Una lámina como CÓDIGO (Musa Design Code): un HTML que corre solo en cualquier navegador con su CSS, sus capas (data-layer-id/name/kind), su animación (<script id=\"musa-animation\"> = frame.animation, con portada y modo de presentación), sus capas de código vivo (data-live) y sus tomas (data-video). Sin el reproductor se ve en su portada; con design-player.js (incluido si player:true) se reproduce como en Presentar. Edítalo y mándalo con design_code_apply: vuelve la misma lámina.",
    inputSchema: { type: "object", properties: { templateId: S({}), frameId: S({ description: "Por defecto la primera lámina" }), player: { type: "boolean", description: "Incluir el reproductor (para abrirlo fuera de Musa)" } }, required: ["templateId"] },
  },
  {
    name: "design_code_apply",
    description: "Diseño · Reemplaza una lámina con código: Musa Design Code (de design_code_get) o cualquier HTML/CSS. Si el código trae JavaScript o <canvas> (Tailwind por CDN, GSAP, Three.js, React…), la lámina se termina de armar al abrir el diseño en el editor (corre una vez en un espacio aislado y queda 100 % editable, con sus animaciones y capas 3D); hasta entonces se ve lo estático. Mantiene el id y la posición de la lámina.",
    inputSchema: { type: "object", properties: { templateId: S({}), frameId: S({}), code: S({}), name: S({}) }, required: ["templateId", "code"] },
  },
  {
    name: "design_from_video",
    description: "Diseño · Lleva un video de Musa a una lámina de diseño (lo mismo que «→ Diseño» en el editor de video). part: scene (por defecto: la escena —entre cortes— donde cae atSec; la lámina reproduce esa escena al presentar), all (todo el video) o still (solo ese cuadro, quieto). atSec = la PORTADA: el cuadro del video que la lámina muestra quieta (lienzo, miniaturas, PDF); por defecto 0. La lámina se termina de armar la primera vez que el diseño se abre en el editor (el video corre una vez en un espacio aislado): textos y formas como capas, su movimiento como animación de la lámina, clips 3D como capas de código vivo y tomas como capas de video. templateId = agregarla a un diseño existente (si no, se crea uno). Después cambia la portada con set_animation { posterSec } cuando quieras.",
    inputSchema: { type: "object", properties: { projectId: S({ description: "Video de Musa" }), atSec: N({ description: "Portada: segundo del video" }), part: S({ enum: ["scene", "all", "still"] }), templateId: S({ description: "Diseño destino (opcional)" }), name: S({}), workspaceId: S({}) }, required: ["projectId"] },
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
  if (method === "design_code_get") {
    const tpl = await loadTpl(h, p), f = frameOf(tpl, p.frameId);
    const code = DC.frameToCode(f, { posterStyles: posterStyles(f.animation).styles, player: p.player ? h.apiBaseUrl() + "/musa/design-player.js" : "" });
    return { templateId: tpl.id, frameId: f.id, name: f.name, code, pendingCode: !!(f.codeSource && f.codeSource.src), editorUrl: editorUrl(tpl.id),
      note: "Edita y manda con design_code_apply. La portada (lo que se ve quieto) está en musa-animation.poster; el bloque <style id=\"musa-poster\"> se genera solo, no hace falta mantenerlo." };
  }
  if (method === "design_code_apply") {
    const tpl = await loadTpl(h, p), f = frameOf(tpl, p.frameId);
    const code = String(p.code || ""); if (!code.trim()) throw err("code es requerido", -32602);
    if (code.length > 4_000_000) throw err("El código supera 4 MB", -32602);
    const parsed = DC.codeToFrame(code);
    if (parsed.animationError) throw err("musa-animation no es JSON válido: " + parsed.animationError, -32602);
    if (parsed.needsBake) {
      /* JavaScript o canvas: se corre al abrir el diseño (mismo camino que importar por MCP); mientras, lo estático */
      f.codeSource = { src: code, id: "code_" + Date.now().toString(36), name: p.name || parsed.name || f.name, split: "single" };
      delete f.codeGroup;
    } else {
      delete f.codeSource;
      if (parsed.animation) { const a = normalizeAnimation(parsed.animation); if (a) f.animation = a; } else delete f.animation;
    }
    f.html = parsed.html || ""; f.css = parsed.css || "";
    if (parsed.width) f.width = parsed.width; if (parsed.height) f.height = parsed.height;
    if (parsed.background) f.background = parsed.background;
    if (p.name || parsed.name) f.name = String(p.name || parsed.name).slice(0, 120);
    f.lastModifiedBy = p.author || "agent:design_code_apply"; f.lastModifiedAt = new Date().toISOString();
    const saved = await h.templates.updateTemplate(tpl.id, { frames: tpl.frames });
    if (!saved) throw err("No se pudo guardar el diseño (reintenta)");
    return { templateId: tpl.id, frameId: f.id, pendingCode: !!parsed.needsBake, editorUrl: editorUrl(tpl.id),
      note: parsed.needsBake ? "El código trae JavaScript o canvas: se termina de armar (100 % editable, con animaciones y capas vivas) la primera vez que el diseño se abre en el editor." : "Aplicado: la lámina quedó como el código. Si el diseño está abierto en la web, se pone al día solo." };
  }
  if (method === "design_from_video") {
    if (!h.callTool) throw err("design_from_video no está disponible en este servidor");
    const g = await h.callTool("video_code_get", { projectId: p.projectId, format: "html" });
    if (!g || !g.code) throw err("No se pudo leer el video " + p.projectId, -32602);
    if (g.format === "pending") throw err("Este video tiene código pendiente de convertir: ábrelo una vez en el editor de video (" + (g.editorUrl || "") + ") y vuelve a intentar.", -32009);
    const W = Math.round(+(g.canvas && g.canvas.width) || 1080), H = Math.round(+(g.canvas && g.canvas.height) || 1920), D = Math.max(0.05, +g.durationS || 10);
    const part = p.part === "all" || p.part === "still" ? p.part : "scene", at = Math.max(0, Math.min(D, Number.isFinite(+p.atSec) ? +p.atSec : 0));
    /* las escenas: los clips de la pista principal (data-track-index="0") con su inicio y su largo, sin las colas de transición */
    const cuts = [];
    for (const m of String(g.code).matchAll(/class="v1" data-musa='([^']*)'[\s\S]*?data-start="([\d.]+)" data-duration="([\d.]+)"/g)) {
      let pre = 0, post = 0;
      try { const j = JSON.parse(m[1].replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&quot;/g, '"').replace(/&amp;/g, "&")); pre = +j._pre || 0; post = +j._post || 0; } catch { /* sin colas */ }
      const s0 = +m[2] + pre, e0 = +m[2] + +m[3] - post; if (e0 > s0) cuts.push([s0, e0]);
    }
    /* sin pista principal: los clips a pantalla completa (un 3D, una escena que ocupa todo) son las escenas */
    if (!cuts.length) for (const m of String(g.code).matchAll(/class="m[^"]*" style="[^"]*" data-musa='([^']*)'/g)) {
      try { const j = JSON.parse(m[1].replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&quot;/g, '"').replace(/&amp;/g, "&")); if ((+j.w || 0) >= 99.9 && Number.isFinite(+j.start) && +j.dur > 0) cuts.push([+j.start, +j.start + +j.dur]); } catch { /* ese no */ }
    }
    cuts.sort((a, b) => a[0] - b[0]);
    let t0 = 0, t1 = D;
    if (part === "still") { t0 = at; t1 = at; }
    else if (part === "scene") {
      const c = cuts.find((x) => at >= x[0] - 1e-6 && at < x[1] - 1e-6);
      if (c) { t0 = c[0]; t1 = c[1]; } else { const prev = cuts.filter((x) => x[1] <= at + 1e-6).pop(), next = cuts.find((x) => x[0] > at); t0 = prev ? prev[1] : 0; t1 = next ? next[0] : D; }
    }
    const name = String(p.name || "Desde el video" + (part === "still" ? " · cuadro " + at + " s" : " · " + Math.round(t0 * 100) / 100 + "–" + Math.round(t1 * 100) / 100 + " s")).slice(0, 120);
    let tplId = p.templateId;
    if (!tplId) {
      const ws = p.workspaceId || (auth && auth.workspaceId);
      if (!ws) throw err("workspaceId es requerido para crear el diseño (o pasa templateId)", -32602);
      const c = await h.callTool("create_template", { name, workspaceId: ws, engine: "html", width: W, height: H });
      tplId = c && c.templateId; if (!tplId) throw err("No se pudo crear el diseño");
    }
    const tpl = await loadTpl(h, { templateId: tplId }).catch(async () => ({ ...(await h.templates.getTemplate(tplId)), frames: [] }));
    const fresh = !p.templateId && tpl.frames.length === 1;
    const fid = fresh ? tpl.frames[0].id : "frame_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const x = fresh ? 0 : tpl.frames.reduce((mx, f) => Math.max(mx, (+f.x || 0) + (+f.width || 0)), 0) + 120;
    const frame = { id: fid, name, x, y: 0, width: W, height: H, background: "#000000", css: "",
      html: '<div data-layer-name="Se arma al abrir" style="position:absolute;inset:0;display:grid;place-items:center;background:#111;color:#bbb;font:600 28px Inter,system-ui,sans-serif;text-align:center;padding:40px">Esta lámina se arma la primera vez que abres el diseño en el editor.</div>',
      codeSource: { src: g.code, fromVideo: p.projectId, range: { t0, t1 }, snapAt: at, still: part === "still", size: { w: W, h: H }, name, id: "video_" + p.projectId } };
    if (fresh) tpl.frames[0] = frame; else tpl.frames.push(frame);
    const saved = await h.templates.updateTemplate(tplId, { frames: tpl.frames });
    if (!saved) throw err("No se pudo guardar el diseño (reintenta)");
    return { templateId: tplId, frameId: fid, part, range: { t0, t1 }, posterSec: part === "still" ? 0 : Math.round((at - t0) * 1000) / 1000, editorUrl: editorUrl(tplId),
      note: "La lámina se termina de armar al abrir el diseño en el editor (el video corre una vez en un espacio aislado): textos y formas como capas, su movimiento como animación, clips 3D como capas vivas y tomas como video. La portada es el cuadro " + at + " s del video; cámbiala con set_animation { posterSec } cuando quieras." };
  }
  throw err("Herramienta desconocida: " + method, -32601);
}
