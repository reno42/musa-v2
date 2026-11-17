// mcp-v2-photo.mjs — la foto como código para una IA (Musa Photo Code, public/musa/photo-code-core.js + photo-code-lang.js).
// Mismo documento que edita la web: fuente (imagen o código) → retoque → geometría → revelado → filtros → capas.
//   · Foto de Crear › Fotos: { assetId }. El documento vive en el archivo (source_meta.doc). Un original nunca se toca:
//     su primera edición crea la foto «editada» unida a él y esa es la que se sigue editando.
//   · Foto dentro de un diseño: { templateId, layerId }. El documento vive en la capa (data-photo).
// El servidor no pinta píxeles: escribe el documento y la foto queda «por pintar»; el navegador la dibuja y guarda su
// imagen la próxima vez que alguien la ve en Musa (o al instante si está abierta: se mezcla con lo que la persona edita).
// Nunca se ejecuta el código en el servidor: se lee con el analizador de literales.
import * as cheerio from "cheerio";
import "../../../public/musa/photo-code-core.js";
import "../../../public/musa/photo-code-lang.js";
import { getPhotoDoc, putPhotoDoc, createCodePhoto } from "./photo-sources.mjs";
import { PHOTO_PRESETS } from "../../../shared/photoRecipe.ts";

const PC = globalThis.MusaPhotoCode;
const S = (o) => ({ type: "string", ...o });
const O = (o) => ({ type: "object", ...o });
const A = (o) => ({ type: "array", ...o });
const err = (message, code = -32000) => ({ code, message });
const REF = {
  assetId: S({ description: "Foto de Crear › Fotos (photos_list → id). Alternativa a templateId + layerId." }),
  templateId: S({ description: "Diseño que contiene la foto" }), layerId: S({ description: "data-layer-id de la capa de imagen dentro del diseño" }), frameId: S({ description: "Frame dueño (opcional)" }),
};
const FILTER_DOC = Object.keys(PC.FILTERS).map((k) => k + "(" + PC.FILTERS[k].params.map((p) => p[0]).join(", ") + ")").join(" · ");

export const PHOTO_CODE_TOOLS = [
  { name: "photo_code_get",
    description: "Fotos · Una foto como CÓDIGO (Musa Photo): photo(\"url\") o photo.code(…) seguido de una línea por ajuste (.light, .whiteBalance, .color, .hsl, .curve, .grade, .detail, .effects, .blackWhite, .crop, .rotate, .flip, .straighten, .mask, .filter, .text, .image, .shape, .paint). Es exactamente lo que ve y edita la persona en el editor de fotos (panel «</> Código»). Devuelve code, doc (el mismo documento en JSON), un resumen y rev. Sirve para fotos de Crear › Fotos (assetId) y para fotos dentro de un diseño (templateId + layerId).",
    inputSchema: O({ properties: { ...REF }, required: [] }) },
  { name: "photo_code_apply",
    description: "Fotos · Escribe una foto desde código. Acepta código Musa Photo (reemplaza el documento), JSON del documento, o código de OTRO dialecto que se convierte solo: CSS filter / canvas ctx.filter, filtro SVG, sharp, Jimp, Pillow u OpenCV (Python), ImageMagick → quedan como ajustes y filtros editables que se SUMAN a la foto; y código que DIBUJA o procesa píxeles (canvas, Three.js, p5, WebGL/shader, SVG, HTML/CSS, Python con Pillow/numpy/matplotlib) → queda como fuente de la foto (corre aislado en el navegador; si usa una imagen de entrada recibe la foto actual). Todo sigue editable en la web. Si assetId es un original, crea su foto editada y devuelve el assetId nuevo.",
    inputSchema: O({ properties: { ...REF, code: S({ description: "Código Musa Photo, JSON o de otro dialecto" }), name: S({}) }, required: ["code"] }) },
  { name: "photo_edit",
    description: "Fotos · Cambia partes de una foto sin reescribirla. set: { \"basic.exposure\": 12, \"wb.temp\": -8, \"geo.crop\": {x,y,w,h}, \"fx.vignette\": -20 … } (rutas de la receta: basic, wb, color, hsl.<banda>, curve.<canal>, grade, detail (incluye dehaze), fx, bw, geo). recipe: parche por objetos. addFilters / updateFilters ({id,…}) / removeFilters ([id]) / orderFilters — filtros: " + FILTER_DOC + ". addMasks / updateMasks / removeMasks — kind radial | linear | brush | lum | color con adj { exposure, contrast, highlights, shadows, saturation, temp, tint, clarity }. addLayers / updateLayers / removeLayers / orderLayers — kind text { text: { s, x, y, size, color, font, weight, align… } }, image { src, box }, shape { shape: { type, fill, stroke, sw, radius, pts }, box }, paint { src }. Coordenadas y tamaños de 0 a 1 respecto de la foto. reset: [\"all\" | \"recipe\" | \"filters\" | \"layers\" | \"masks\" | \"slices\" | \"samplers\" | un grupo]. source: { url } o { code, lang, width, height, time }. Geometría: geo.crop puede salir de 0–1 (mesa de trabajo: lienzo más grande) con geo.bg \"#rrggbb\" (sin geo.bg = transparente); geo.persp = 4 esquinas [[x,y],…] (arriba-izq, arriba-der, abajo-der, abajo-izq, 0–1 en la foto girada) = recorte en perspectiva (null lo quita). addSlices / updateSlices / removeSlices: cortes { x, y, w, h, name } para exportar en partes (carrusel, mosaico). samplers: [[x,y],…] hasta 10 muestras de color. Formas con shape.smooth: true pasan suaves por sus puntos (pluma de curvatura).",
    inputSchema: O({ properties: { ...REF, set: O({}), recipe: O({}), source: O({}), name: S({}), reset: A({ items: S({}) }),
      addFilters: A({ items: O({}) }), updateFilters: A({ items: O({}) }), removeFilters: A({ items: S({}) }), orderFilters: A({ items: S({}) }),
      addMasks: A({ items: O({}) }), updateMasks: A({ items: O({}) }), removeMasks: A({ items: S({}) }),
      addLayers: A({ items: O({}) }), updateLayers: A({ items: O({}) }), removeLayers: A({ items: S({}) }), orderLayers: A({ items: S({}) }),
      addSlices: A({ items: O({}) }), updateSlices: A({ items: O({}) }), removeSlices: A({ items: S({}) }), samplers: A({ items: A({ items: { type: "number" } }) }) }, required: [] }) },
  { name: "photo_create_from_code",
    description: "Fotos · Crea una foto NUEVA en Crear › Fotos a partir de código: código que dibuja una imagen (canvas, Three.js, p5, WebGL/shader GLSL, SVG, HTML/CSS, Python con Pillow/matplotlib/numpy) o código Musa Photo / CSS filter / sharp… que ajusta una imagen por su URL. Queda como foto editable (revelado, filtros, capas) y su código se sigue editando. El navegador la dibuja al abrirla. Devuelve assetId y editorUrl.",
    inputSchema: O({ properties: { workspaceId: S({}), code: S({}), name: S({}), width: { type: "number" }, height: { type: "number" }, time: { type: "number", description: "Segundo del código que se usa como imagen (animaciones)" }, tags: A({ items: S({}) }) }, required: ["workspaceId", "code"] }) },
  { name: "photo_to_design",
    description: "Fotos · Lleva una foto de Crear › Fotos a un diseño nuevo, como capa de imagen que se sigue editando en el editor de fotos (con su revelado, filtros, capas y código). Devuelve templateId, layerId y editorUrl.",
    inputSchema: O({ properties: { assetId: S({}), name: S({}), width: { type: "number" }, height: { type: "number" } }, required: ["assetId"] }) },
];
export const PHOTO_CODE_NAMES = new Set(PHOTO_CODE_TOOLS.map((t) => t.name));
export const PHOTO_CODE_READ = ["photo_code_get"];
/* las tools photo_* anteriores ahora leen y escriben el MISMO documento (antes guardaban en un lugar que la web no leía) */
export const PHOTO_LEGACY = new Set(["photo_open_session", "photo_create_variant", "photo_apply_operation", "photo_update_operation", "photo_remove_operation", "photo_create_mask", "photo_update_mask", "photo_apply_preset", "photo_restore_version", "photo_compare_versions",
  "photo_compose_get", "photo_compose_add_layer", "photo_compose_update_layer", "photo_compose_delete_layer", "photo_compose_reorder_layers", "photo_compose_duplicate_layer", "photo_compose_set_layer_mask", "photo_compose_clear"]);

const newRev = () => "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function urlOfEl($, el) {
  const src = $(el).attr("src"); if (src) return src;
  const m = /background(?:-image)?\s*:[^;]*url\(\s*["']?([^"')]+)["']?\s*\)/i.exec($(el).attr("style") || "");
  return m ? m[1].replace(/&quot;|&#39;/g, "") : null;
}
function metaToDoc(ph, fill) {
  if (!ph) return PC.normalize({ source: fill ? { kind: "url", url: fill } : null });
  return PC.normalize({ source: ph.source || (ph.orig || fill ? { kind: "url", url: ph.orig || fill } : null), recipe: ph.recipe, filters: ph.filters, layers: ph.layers, out: ph.out, slices: ph.slices, samplers: ph.samplers });
}
/* abre la foto: { doc, rev, save(doc, label) } */
async function open(p, auth, h) {
  if (p.assetId) {
    const g = await getPhotoDoc(auth, { assetId: p.assetId });
    return { kind: "asset", w: g.photo.width, h: g.photo.height, doc: g.doc, rev: g.rev, name: g.photo.name, isOriginal: g.isOriginal, workspaceId: g.workspaceId, url: g.photo.url,
      editorUrl: `${h.apiBaseUrl()}/#crear/fotos/${encodeURIComponent(p.assetId)}/editar`,
      async save(doc, o = {}) {
        for (let i = 0; i < 4; i++) {
          const r = await putPhotoDoc(auth, { assetId: p.assetId, doc, name: o.name, expectRev: i ? undefined : g.rev }, auth && auth.userId);
          if (!r.conflict) return { assetId: r.photo.id, created: !!r.created, fromAssetId: r.fromAssetId, rev: r.rev, editorUrl: `${h.apiBaseUrl()}/#crear/fotos/${encodeURIComponent(r.photo.id)}/editar` };
          if (!o.redo) throw err("La foto cambió mientras tanto: vuelve a leerla con photo_code_get");
          doc = o.redo(r.doc ? PC.normalize(r.doc) : g.doc); g.rev = r.rev;
        }
        throw err("No se pudo guardar la foto (cambia demasiado seguido): reintenta");
      } };
  }
  if (!p.templateId) throw err("Indica assetId (foto de Crear › Fotos) o templateId + layerId (foto dentro de un diseño)", -32602);
  const tpl = await h.templates.getTemplate(p.templateId);
  if (!tpl) throw err("Template not found: " + p.templateId, -32602);
  let found = null;
  for (const f of tpl.frames || []) {
    if (p.frameId && f.id !== p.frameId) continue;
    const $ = cheerio.load(String(f.html || ""), null, false);
    const els = p.layerId ? $('[data-layer-id="' + String(p.layerId).replace(/"/g, "") + '"]').toArray() : $("img[data-layer-id],[data-photo]").toArray();
    const el = els.find((x) => urlOfEl($, x)) || null;
    if (el) { found = { f, $, el }; break; }
  }
  if (!found) throw err(p.layerId ? "No hay una capa de imagen con layerId " + p.layerId + " en ese diseño" : "El diseño no tiene fotos: indica layerId", -32602);
  const { f, $, el } = found, fill = urlOfEl($, el);
  let ph = null; try { ph = JSON.parse($(el).attr("data-photo") || "null"); } catch (e) { ph = null; }
  const doc = metaToDoc(ph, fill), layerId = $(el).attr("data-layer-id");
  return { kind: "layer", doc, rev: ph && ph.rev || null, name: $(el).attr("data-layer-name") || "Foto", meta: ph, frameId: f.id, layerId, url: fill,
    editorUrl: `${h.apiBaseUrl()}/#crear/disenos/tpl:${encodeURIComponent(tpl.id)}`,
    async save(doc2, o = {}) {
      const versions = ((ph && ph.versions) || []).slice(0, 19);
      if (ph && ph.recipe) versions.unshift({ n: (o.label || "Antes del cambio de la IA"), t: new Date().toISOString().slice(0, 16).replace("T", " "), r: JSON.stringify(ph.recipe) });
      const meta = { orig: (ph && ph.orig) || (doc2.source && doc2.source.kind === "url" ? doc2.source.url : null) || fill, recipe: doc2.recipe, edited: true, rev: newRev(), stale: true, versions };
      if (doc2.source && doc2.source.kind === "url" && doc2.source.url !== meta.orig) meta.orig = doc2.source.url;
      if (doc2.filters.length) meta.filters = doc2.filters;
      if (doc2.layers.length) meta.layers = doc2.layers;
      if (doc2.source && doc2.source.kind === "code") meta.source = doc2.source;
      if (doc2.out) meta.out = doc2.out;
      if (doc2.slices && doc2.slices.length) meta.slices = doc2.slices;
      if (doc2.samplers && doc2.samplers.length) meta.samplers = doc2.samplers;
      $(el).attr("data-photo", JSON.stringify(meta));
      f.html = $.html(); f.lastModifiedBy = o.author || "agent:photo"; f.lastModifiedAt = new Date().toISOString();
      const saved = await h.templates.updateTemplate(tpl.id, { frames: tpl.frames });
      if (!saved) throw err("No se pudo guardar el diseño (reintenta)");
      return { templateId: tpl.id, frameId: f.id, layerId, rev: meta.rev, editorUrl: `${h.apiBaseUrl()}/#crear/disenos/tpl:${encodeURIComponent(tpl.id)}` };
    } };
}
const NOTE = "Guardado. La imagen se vuelve a pintar en el navegador: al instante si la foto está abierta en Musa, o la próxima vez que alguien la vea.";
function out(ph, doc, saved, extra) { return { ...saved, summary: PC.describe(doc), code: PC.toCode(doc), ...(extra || {}), note: NOTE }; }
function wrap(fn) { try { return fn(); } catch (e) { if (e && e.code) throw e; throw err(String(e && e.message || e), -32602); } }

/* documento de la receta antigua ({ ops, geometry, masks }) o de la nueva */
function recipeIn(r) {
  if (!r || typeof r !== "object") throw err("recipe object is required", -32602);
  if (!Array.isArray(r.ops)) return PC.normRecipe(r);
  let o = PC.recipe0();
  for (const op of r.ops) { if (op && op.enabled !== false && op.type) PC.deepMerge(o, PC.opToPatch(op.type, op.params || {})); }
  if (r.geometry) PC.deepMerge(o, PC.opToPatch("geometry", r.geometry));
  if (Array.isArray(r.masks)) o.masks = r.masks;
  return PC.normRecipe(o);
}
function legacyLayer(L, i) {
  const o = { id: L.id, index: i, kind: L.kind, name: L.name, blend: L.blend, opacity: L.op / 100, visible: L.vis };
  if (L.kind === "text") o.text = { value: L.text.s, size: L.text.size, color: L.text.color, font: L.text.font, x: L.text.x, y: L.text.y, vertical: L.text.vert };
  if (L.src) o.src = L.src; if (L.mask) o.mask = L.mask; if (L.box) o.box = L.box; if (L.shape) o.shape = L.shape;
  return o;
}
function layerPatch(p) {
  const o = {};
  if (p.name != null) o.name = p.name; if (p.blend != null) o.blend = p.blend; if (p.visible != null) o.vis = !!p.visible;
  if (p.opacity != null) o.op = p.opacity <= 1 ? Math.round(p.opacity * 100) : p.opacity;
  if (p.text) { o.text = {}; const t = p.text; if (t.value != null) o.text.s = String(t.value); ["s", "size", "color", "font", "x", "y", "weight", "align", "italic", "ls", "lh", "rot"].forEach((k) => { if (t[k] != null) o.text[k] = t[k]; }); if (t.vertical != null) o.text.vert = !!t.vertical; }
  if (typeof p.dataUrl === "string" && /^https?:/.test(p.dataUrl)) o.src = p.dataUrl;
  if (typeof p.src === "string") o.src = p.src;
  if (p.box) o.box = p.box; if (p.shape) o.shape = p.shape;
  return o;
}

export async function handlePhotoCodeTool(method, p, auth, h) {
  if (!PC || !PC.toCode) throw err("El motor de fotos no está disponible en este servidor");
  if (method === "photo_code_get") {
    const ph = await open(p, auth, h);
    return { ...(ph.kind === "asset" ? { assetId: p.assetId, isOriginal: ph.isOriginal } : { templateId: p.templateId, frameId: ph.frameId, layerId: ph.layerId }), name: ph.name, rev: ph.rev, code: PC.toCode(ph.doc), doc: ph.doc, summary: PC.describe(ph.doc), imageUrl: ph.url, editorUrl: ph.editorUrl,
      filters: Object.keys(PC.FILTERS), notes: ["Coordenadas y tamaños van de 0 a 1 respecto de la foto ya recortada.", "Los valores de luz y color van de -100 a 100; un filtro con amount = 100 es neutro en brightness/contrast/saturate.", ph.kind === "asset" && ph.isOriginal ? "Es un original: al escribirle se crea su foto editada (el original no se toca) y te devuelvo el assetId nuevo." : "Escribe con photo_edit (partes) o photo_code_apply (todo)."] };
  }
  if (method === "photo_code_apply") {
    const code = String(p.code || ""); if (!code.trim()) throw err("code es requerido", -32602);
    if (code.length > 600000) throw err("El código supera 600 KB", -32602);
    const ph = await open(p, auth, h);
    const make = (cur) => wrap(() => {
      const r = PC.importAny(code, cur);
      let doc = r.mode === "source" ? PC.normalize({ ...cur, source: r.source }) : r.doc;
      if (!doc.source) doc.source = cur.source;
      if (doc._cropPx) {
        if (ph.w > 0 && ph.h > 0 && cur.source && cur.source.kind === "url") doc = PC.resolveCropPx(doc, ph.w, ph.h);
        else r.missed = (r.missed || []).concat("recorte en píxeles (no conozco el tamaño de la imagen desde aquí: usa photo_edit con geo.crop de 0 a 1)");
      }
      return { doc: PC.normalize(doc), r };
    });
    const m = make(ph.doc), saved = await ph.save(m.doc, { name: p.name, label: "Antes de aplicar código", redo: (cur) => make(cur).doc });
    return out(ph, m.doc, saved, { understoodAs: m.r.label, mode: m.r.mode, notes: m.r.notes && m.r.notes.length ? m.r.notes : undefined, notConverted: m.r.missed && m.r.missed.length ? m.r.missed : undefined });
  }
  if (method === "photo_edit") {
    const ph = await open(p, auth, h);
    const make = (cur) => wrap(() => PC.applyEdits(cur, p));
    const e = make(ph.doc);
    if (!e.changed) return { ...(p.assetId ? { assetId: p.assetId } : { templateId: p.templateId, layerId: ph.layerId }), unchanged: true, summary: PC.describe(e.doc), code: PC.toCode(e.doc) };
    const saved = await ph.save(e.doc, { name: p.name, label: "Antes del cambio de la IA", redo: (cur) => make(cur).doc });
    return out(ph, e.doc, saved, { added: e.added });
  }
  if (method === "photo_create_from_code") {
    const code = String(p.code || ""); if (!code.trim()) throw err("code es requerido", -32602);
    const r = wrap(() => PC.importAny(code, null));
    let doc = r.mode === "source" ? PC.normalize({ source: { ...r.source, w: +p.width || r.source.w, h: +p.height || r.source.h, t: p.time != null ? +p.time : r.source.t } }) : r.doc;
    if (!doc || !doc.source) throw err("Este código ajusta una imagen pero no dice cuál: incluye su dirección (photo(\"https://…\"), <img src>, url(...)) o aplícalo a una foto existente con photo_code_apply", -32602);
    let c; try { c = await createCodePhoto(auth, { workspaceId: p.workspaceId, name: p.name, doc, tags: p.tags }, auth && auth.userId); } catch (e) { throw err(e.message || String(e), e.status === 403 ? -32003 : -32000); }
    return { assetId: c.photo.id, name: c.photo.name, rev: c.rev, understoodAs: r.label, mode: r.mode, summary: PC.describe(doc), code: PC.toCode(doc), editorUrl: `${h.apiBaseUrl()}/#crear/fotos/${encodeURIComponent(c.photo.id)}/editar`, notes: r.notes && r.notes.length ? r.notes : undefined, notConverted: r.missed && r.missed.length ? r.missed : undefined,
      note: "Foto creada. Se dibuja en el navegador la primera vez que alguien la abre o la ve en Crear › Fotos." };
  }
  if (method === "photo_to_design") {
    let g; try { g = await getPhotoDoc(auth, { assetId: p.assetId }); } catch (e) { throw err(e.message || String(e), e.status === 404 ? -32004 : -32000); }
    const doc = g.doc, ph = g.photo, W = Math.max(16, Math.round(+p.width || ph.width || (doc.source && doc.source.w) || 1080)), H = Math.max(16, Math.round(+p.height || ph.height || (doc.source && doc.source.h) || 1080));
    const k = Math.min(1, 2400 / Math.max(W, H)), w = Math.round(W * k), hh = Math.round(H * k);
    const meta = g.isOriginal ? { orig: ph.url, recipe: PC.recipe0(), rev: newRev() } : { orig: doc.source && doc.source.kind === "url" ? doc.source.url : (doc.source && doc.source.poster) || ph.url, recipe: doc.recipe, edited: true, rev: newRev(), stale: !!ph.stale || undefined,
      ...(doc.filters.length ? { filters: doc.filters } : {}), ...(doc.layers.length ? { layers: doc.layers } : {}), ...(doc.source && doc.source.kind === "code" ? { source: doc.source } : {}) };
    const a = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const lid = "foto_" + Date.now().toString(36);
    const html = `<img data-layer-id="${lid}" data-layer-name="${a(ph.name || "Foto")}" data-layer-kind="image" src="${a(ph.url)}" alt="" data-photo="${a(JSON.stringify(meta))}" style="position:absolute;left:0;top:0;width:${w}px;height:${hh}px;object-fit:cover">`;
    const t = await h.callTool("create_html_template", { workspaceId: g.workspaceId, name: String(p.name || (ph.name || "Foto") + " · diseño").slice(0, 120), width: w, height: hh, initialHtml: html, initialCss: "" });
    const id = t && (t.id || t.templateId || (t.template && t.template.id));
    if (!id) throw err("No se pudo crear el diseño");
    return { templateId: id, layerId: lid, editorUrl: `${h.apiBaseUrl()}/#crear/disenos/tpl:${encodeURIComponent(id)}`, note: "La foto quedó como capa de imagen: se sigue editando con photo_edit { templateId, layerId } o con doble clic en la web." };
  }

  /* ── compatibilidad: las tools photo_* anteriores sobre el mismo documento ── */
  const ph = await open(p.assetId ? p : { templateId: p.templateId, layerId: p.layerId, frameId: p.frameId }, auth, h);
  const ref = ph.kind === "asset" ? { assetId: p.assetId } : { templateId: p.templateId, frameId: ph.frameId, layerId: ph.layerId };
  const write = async (make, label) => { const d = wrap(() => make(ph.doc)); const saved = await ph.save(d, { label, redo: (cur) => make(cur) }); return { ...ref, ...saved, recipe: PC.toShared(d.recipe), summary: PC.describe(d), note: NOTE }; };
  const withRecipe = (cur, fn) => { const d = PC.clone(cur); fn(d.recipe); return PC.normalize(d); };
  const pick = (cur) => { const id = p.targetLayerId, i = p.layerIndex; const L = id != null ? cur.layers.find((x) => x.id === String(id)) : cur.layers[+i]; if (!L) throw err("No hay una capa con ese id o índice (photo_compose_get lista las capas)", -32602); return L; };
  switch (method) {
    case "photo_open_session":
      return { ...ref, name: ph.name, sourceUrl: ph.doc.source && ph.doc.source.kind === "url" ? ph.doc.source.url : null, recipe: PC.toShared(ph.doc.recipe), hasEdits: PC.edited(ph.doc), doc: ph.doc, code: PC.toCode(ph.doc), rev: ph.rev,
        versions: ((ph.meta && ph.meta.versions) || []).map((v, i) => ({ id: String(i), label: v.n, createdAt: v.t })), editorUrl: ph.editorUrl,
        _note: "La foto completa (filtros, capas, fuente de código) está en doc y code: usa photo_edit / photo_code_apply para todo lo que no sea el revelado." };
    case "photo_create_variant": return write((cur) => PC.normalize({ ...cur, recipe: recipeIn(p.recipe) }), p.label ? "IA · " + String(p.label).slice(0, 60) : "IA · variante");
    case "photo_apply_operation": case "photo_update_operation": case "photo_remove_operation": {
      if (!p.type) throw err("type is required", -32602);
      const key = PC.OP_KEY[p.type]; if (!key) throw err("Operación desconocida: " + p.type + " (" + PC.OPS.join(", ") + ", geometry)", -32602);
      return write((cur) => withRecipe(cur, (r) => {
        if (method !== "photo_update_operation") r[key] = PC.recipe0()[key];
        if (method !== "photo_remove_operation") PC.deepMerge(r, PC.opToPatch(p.type, p.params || {}));
        if (p.type === "bw" && method === "photo_apply_operation" && p.enabled !== false && (p.params || {}).enabled == null) r.bw.on = true;
      }), "IA · " + method.replace("photo_", "") + " " + p.type);
    }
    case "photo_create_mask": return write((cur) => withRecipe(cur, (r) => { const m = PC.normMask(p.mask || {}); if (!m) throw err("mask.kind debe ser " + PC.MASK_KINDS.join(", "), -32602); if (r.masks.length >= PC.MAX_MASKS) throw err("Máximo " + PC.MAX_MASKS + " máscaras", -32602); r.masks = r.masks.filter((x) => x.id !== m.id).concat(m); }), "IA · máscara");
    case "photo_update_mask": return write((cur) => PC.applyEdits(cur, { updateMasks: [{ ...(p.patch || {}), adj: (p.patch || {}).adjustments || (p.patch || {}).adj, id: p.maskId }] }).doc, "IA · máscara");
    case "photo_apply_preset": {
      const pr = PHOTO_PRESETS.find((x) => x.id === p.presetId); if (!pr) throw err("presetId desconocido: " + PHOTO_PRESETS.map((x) => x.id).join(", "), -32602);
      return write((cur) => withRecipe(cur, (r) => { const b = PC.recipe0(); ["basic", "wb", "color", "detail", "fx", "bw", "grade", "curve"].forEach((k) => { r[k] = b[k]; }); Object.keys(pr.patch).forEach((t) => PC.deepMerge(r, PC.opToPatch(t, pr.patch[t]))); if (pr.patch.bw && pr.patch.bw.enabled !== false) r.bw.on = true; }), "IA · preset " + pr.name);
    }
    case "photo_restore_version": {
      const vs = (ph.meta && ph.meta.versions) || [], v = vs[+p.versionId]; if (!v) throw err("No existe esa versión (photo_open_session → versions[].id)", -32602);
      return write((cur) => PC.normalize({ ...cur, recipe: JSON.parse(v.r) }), "IA · restaurar versión");
    }
    case "photo_compare_versions": {
      const vs = (ph.meta && ph.meta.versions) || [], a2 = p.versionA != null ? vs[+p.versionA] : vs[0], b2 = p.versionB != null ? vs[+p.versionB] : null;
      const ra = a2 ? PC.normRecipe(JSON.parse(a2.r)) : PC.recipe0(), rb = b2 ? PC.normRecipe(JSON.parse(b2.r)) : ph.doc.recipe, ch = [];
      const walk = (x, y, pre) => Object.keys(x).forEach((k) => { if (k === "masks") return; if (x[k] && typeof x[k] === "object" && !Array.isArray(x[k])) walk(x[k], y[k] || {}, pre + k + "."); else if (!PC.same(x[k], y[k])) ch.push({ key: pre + k, from: x[k], to: y[k] }); });
      walk(ra, rb, "");
      return { ...ref, changed: ch.length > 0 || !PC.same(ra.masks, rb.masks), changes: ch, masksChanged: !PC.same(ra.masks, rb.masks) };
    }
    case "photo_compose_get": return { ...ref, layers: ph.doc.layers.map(legacyLayer), blends: PC.BLENDS, max: PC.MAX_LAYERS, _note: "Además de paint y text hay capas image y shape: créalas con photo_edit { addLayers }." };
    case "photo_compose_add_layer": {
      if (p.kind !== "paint" && p.kind !== "text") throw err("kind debe ser paint o text (para image y shape usa photo_edit { addLayers })", -32602);
      if (p.kind === "text" && !(p.text && (p.text.value != null || p.text.s != null))) throw err("text.value es requerido", -32602);
      return write((cur) => { const e = PC.applyEdits(cur, { addLayers: [{ kind: p.kind, ...layerPatch(p) }] }); const d = e.doc; if (p.index != null) { const L = d.layers.pop(); d.layers.splice(Math.max(0, Math.min(d.layers.length, +p.index)), 0, L); } return d; }, "IA · capa");
    }
    case "photo_compose_update_layer": return write((cur) => PC.applyEdits(cur, { updateLayers: [{ id: pick(cur).id, ...layerPatch(p.patch || {}) }] }).doc, "IA · capa");
    case "photo_compose_delete_layer": return write((cur) => PC.applyEdits(cur, { removeLayers: [pick(cur).id] }).doc, "IA · capa");
    case "photo_compose_duplicate_layer": return write((cur) => { const L = PC.clone(pick(cur)); L.id = PC.uid("l"); L.name = (L.name + " copia").slice(0, 60); const d = PC.clone(cur); d.layers.splice(d.layers.findIndex((x) => x.id === pick(cur).id) + 1, 0, L); return PC.normalize(d); }, "IA · capa");
    case "photo_compose_reorder_layers": {
      const order = p.order || p.layerIds || p.ids; if (!Array.isArray(order)) throw err("order (lista de ids de abajo hacia arriba) es requerido", -32602);
      return write((cur) => PC.applyEdits(cur, { orderLayers: order.map(String) }).doc, "IA · orden de capas");
    }
    case "photo_compose_set_layer_mask": {
      const mk = p.mask != null ? p.mask : p.maskUrl;
      if (mk && !/^https?:/.test(String(mk))) throw err("La máscara de capa es la dirección https de una imagen (su transparencia es la máscara); súbela con upload_image", -32602);
      return write((cur) => { const d = PC.clone(cur), L = d.layers.find((x) => x.id === pick(cur).id); if (mk) L.mask = String(mk); else delete L.mask; return PC.normalize(d); }, "IA · máscara de capa");
    }
    case "photo_compose_clear": return write((cur) => PC.applyEdits(cur, { reset: ["layers"] }).doc, "IA · quitar capas");
  }
  throw err("Método desconocido: " + method, -32601);
}
