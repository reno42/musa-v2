// Réplicas 100 % editables (QA Instinct, spec 2026-11-11): las herramientas que convierten una referencia en
// capas nativas de Musa — vectores, texto real, texto mono (ASCII), tramas, máscaras, texto en trayectoria,
// emoji vectorial, texturas, sujeto/fondo por capas, borrado de zonas y el informe «raster vs vector».
// Cada una escribe en el HTML del frame igual que el editor de la web (bridge-replica.js): mismas capas,
// mismos atributos (data-layer-*, data-mr-fx, data-mr-tp), así lo que crea una IA se edita en la web y al revés.
// El acceso al template (templateId → workspace) ya lo validó authorizeMcpCall antes de llegar aquí.
import * as cheerio from "cheerio";
import jpeg from "jpeg-js";
import { sanitizeImportedSvg, splitSvgParts } from "../../../shared/designImport.ts";
import { colorLayers, colorName, traceParams, QUIVER_MODELS } from "./vectorize-modes.mjs";

const S = (o) => ({ type: "string", ...o });
const N = (o) => ({ type: "number", ...o });
const B = (o) => ({ type: "boolean", ...o });
const BASE = { templateId: S({ description: "Diseño (template) donde se trabaja" }), frameId: S({ description: "Frame; por defecto el primero" }) };
const BOX = { x: N({ description: "px en el frame" }), y: N({}), width: N({}), height: N({}) };

export const REPLICA_TOOLS = [
  {
    name: "image_vectorize_svg",
    description: "Réplicas · Vectorizar una imagen (PNG o JPG) y devolver el SVG, sin tocar ningún diseño. Lo usa el editor de video para pasar un logo o ícono raster a vector nativo (QA Instinct T5/T14). engine \"trace\" (por defecto: a color con curvas; opciones colorPrecision 2-32, filterSpeckle, cornerThreshold, pathPrecision, removeBackground) o \"color_layers\" (una forma por región de color; opciones maxColors, tolerance, simplify, keepBackground). Da imageUrl o imageBase64.",
    inputSchema: { type: "object", properties: { imageUrl: S({}), imageBase64: S({}), engine: S({ enum: ["trace", "color_layers"] }), options: { type: "object", description: "Opciones del motor" } } },
  },
  {
    name: "layer_vectorize",
    description: "Réplicas · Vectorizar una imagen en capas vectoriales nativas, agrupadas bajo «Vector · <capa>», recoloreables por separado. Tres motores: engine \"trace\" (por defecto, gratis, motor propio de Musa a color con curvas; opciones al estilo VTracer: colormode color|bw, colorPrecision 2-32, filterSpeckle, cornerThreshold 0-180, pathPrecision 0-10, hierarchical stacked|cutout, removeBackground) · \"color_layers\" (una capa con nombre por región de color —«forma rosa 3»— y las letras como huecos del manchón —«letra 1»…—; opciones: colors [#hex picados] o maxColors, tolerance, minArea, simplify, lettersAsLayers, keepBackground) · \"ai\" (Quiver con la llave del usuario; model arrow-1.1|arrow-2|arrow-2-telos; SIN confirmCost:true solo devuelve el costo estimado y no cobra). Da layerId de una capa imagen o imageBase64/imageUrl (PNG o JPG). Responde las capas creadas y qué quedó raster.",
    inputSchema: { type: "object", properties: { ...BASE, layerId: S({}), imageBase64: S({}), imageUrl: S({}), engine: S({ enum: ["trace", "color_layers", "ai"] }), options: { type: "object", description: "Opciones del motor (ver descripción)" }, model: S({}), confirmCost: B({}), hideOriginal: B({}), ...BOX }, required: ["templateId"] },
  },
  {
    name: "image_extract_text_layers",
    description: "Réplicas · OCR de diseño: lee cada bloque de texto de una imagen de referencia y lo crea como CAPA DE TEXTO REAL (contenido exacto, posición, tamaño, peso, color, interletraje, alineación) con la fuente más cercana del catálogo (Google Fonts, incluidas blackletter, serif, mono, script y CJK) ya aplicada, y la confianza de cada bloque. Usa tu llave de visión (Gemini/OpenAI/Anthropic) o créditos. x/y/width/height = dónde está la imagen en el frame (por defecto el frame entero). ascii=true transcribe arte ASCII como un bloque monoespaciado.",
    inputSchema: { type: "object", properties: { ...BASE, imageUrl: S({}), imageBase64: S({}), layerId: S({ description: "Capa imagen de referencia (toma su URL y su caja)" }), ...BOX, insert: B({ description: "false = solo devuelve los bloques" }), ascii: B({}) }, required: ["templateId"] },
  },
  {
    name: "text_create_ascii",
    description: "Réplicas · Arte ASCII como texto monoespaciado real (una capa <pre>: espacios y saltos se respetan; line-height 1 y tracking 0 atados a la grilla). Da text (el ASCII tal cual) o imageBase64/imageUrl (PNG o JPG) + columns para convertir una imagen a ASCII. font por defecto Space Mono.",
    inputSchema: { type: "object", properties: { ...BASE, text: S({}), imageBase64: S({}), imageUrl: S({}), columns: N({}), invert: B({}), ramp: S({ description: "Caracteres de claro a oscuro, ej. ' .:-=+*#%@'" }), font: S({}), fontSize: N({}), color: S({}), name: S({}), ...BOX }, required: ["templateId"] },
  },
  {
    name: "layer_apply_halftone",
    description: "Réplicas · Halftone (trama de puntos) NO destructivo: crea una capa vectorial de puntos/cuadros/líneas calculada de la imagen (PNG o JPG) con parámetros editables (cell px, angle, shape circle|square|line, color, background, threshold). La original queda oculta; remove=true quita la trama y la vuelve a mostrar.",
    inputSchema: { type: "object", properties: { ...BASE, layerId: S({}), imageBase64: S({}), imageUrl: S({}), cell: N({}), angle: N({}), shape: S({ enum: ["circle", "square", "line"] }), color: S({}), background: S({}), threshold: N({}), remove: B({}) }, required: ["templateId", "layerId"] },
  },
  {
    name: "layer_set_mask",
    description: "Réplicas · Máscara de forma sobre cualquier capa (clip-path nativo, sobrevive guardar y reabrir): shape none|circle|ellipse|rounded|diamond|triangle|hexagon|star, size 10-100 (%), cx/cy 0-100 (%), radius 0-50 (% para rounded).",
    inputSchema: { type: "object", properties: { ...BASE, layerId: S({}), shape: S({ enum: ["none", "circle", "ellipse", "rounded", "diamond", "triangle", "hexagon", "star"] }), size: N({}), cx: N({}), cy: N({}), radius: N({}) }, required: ["templateId", "layerId", "shape"] },
  },
  {
    name: "import_svg_paths",
    description: "Réplicas · Importa un SVG (código o URL) como N capas vectoriales nativas, una por forma o grupo de primer nivel, alineadas y recoloreables por separado (en vez de un bloque rígido).",
    inputSchema: { type: "object", properties: { ...BASE, svg: S({}), url: S({}), name: S({}), ...BOX }, required: ["templateId"] },
  },
  {
    name: "text_set_path",
    description: "Réplicas · Texto vertical o en trayectoria como propiedad nativa de una capa de texto: mode horizontal | vertical (letras apiladas) | vertical-up | vertical-down (girado) | arc | circle | wave; curve -100..100. El texto sigue editable (contenido, fuente, tamaño, color) y sobrevive reabrir.",
    inputSchema: { type: "object", properties: { ...BASE, layerId: S({}), mode: S({ enum: ["horizontal", "vertical", "vertical-up", "vertical-down", "arc", "circle", "wave"] }), curve: N({}), text: S({}), font: S({}), size: N({}), color: S({}), weight: N({}) }, required: ["templateId", "layerId", "mode"] },
  },
  {
    name: "emoji_insert_vector",
    description: "Réplicas · Inserta un emoji como capa VECTORIAL (Twemoji, CC-BY 4.0) recoloreable por forma en Props; color opcional lo deja de un solo color.",
    inputSchema: { type: "object", properties: { ...BASE, emoji: S({}), color: S({}), size: N({}), x: N({}), y: N({}) }, required: ["templateId", "emoji"] },
  },
  {
    name: "layer_apply_texture",
    description: "Réplicas · Textura paramétrica (filtro SVG, no bitmap): grain | paper | crayon | noise | none, amount 0-100. En un vector se aplica a sus trazos (recolorear no la pierde); en otras capas va como capa de textura encima, con su misma caja.",
    inputSchema: { type: "object", properties: { ...BASE, layerId: S({}), texture: S({ enum: ["grain", "paper", "crayon", "noise", "none"] }), amount: N({}) }, required: ["templateId", "layerId", "texture"] },
  },
  {
    name: "layer_split_subject",
    description: "Réplicas · Separa una foto en capas SIN tocar la original: «Sujeto» (PNG con transparencia real) y «Fondo» (la escena sin el sujeto, reconstruida). Usa Nano Banana con tu llave de Gemini o créditos.",
    inputSchema: { type: "object", properties: { ...BASE, layerId: S({}), imageUrl: S({}) }, required: ["templateId", "layerId"] },
  },
  {
    name: "image_inpaint_region",
    description: "Réplicas · Borra una zona de una foto (texto, logo, objeto) y reconstruye el fondo. region {x,y,w,h} en fracciones 0-1 de la imagen. Reversible: la capa guarda la URL original (restore=true la devuelve). Usa Nano Banana con tu llave de Gemini o créditos.",
    inputSchema: { type: "object", properties: { ...BASE, layerId: S({}), region: { type: "object", properties: { x: N({}), y: N({}), w: N({}), h: N({}) } }, what: S({ description: "Qué hay en la zona (ej. 'el logo')" }), markedImageBase64: S({ description: "Opcional: la imagen con la zona marcada en magenta" }), restore: B({}) }, required: ["templateId", "layerId"] },
  },
  {
    name: "design_layer_report",
    description: "Réplicas · Informe «raster vs vector» por capa de un diseño: texto real, vector, forma/color, imagen (raster) y efectos paramétricos (halftone, textura, texto en trayectoria), con conteos por frame.",
    inputSchema: { type: "object", properties: { templateId: S({}), frameId: S({}) }, required: ["templateId"] },
  },
];
export const REPLICA_NAMES = new Set(REPLICA_TOOLS.map((t) => t.name));

/* ───────── utilidades ───────── */
const err = (m, code = -32000) => ({ code, message: m });
let seq = 0;
const lid = (p = "musa") => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`;
const escHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const escAttr = escHtml;
const num = (v, d) => (Number.isFinite(+v) ? +v : d);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;
const SYSTEM_FONTS = /^(inter|arial|helvetica|georgia|times new roman|courier new|verdana|system-ui|monospace|serif|sans-serif)$/i;

async function loadFrame(h, p) {
  const tpl = await h.templates.getTemplate(p.templateId);
  if (!tpl) throw err(`Template not found: ${p.templateId}`);
  h.requireFrames(tpl);
  const frame = p.frameId ? (tpl.frames || []).find((f) => f.id === p.frameId) : (tpl.frames || [])[0];
  if (!frame) throw err(`Frame not found: ${p.frameId}`);
  return { tpl, frame };
}
async function saveTpl(h, p, tpl) {
  tpl.metadata = tpl.metadata || {};
  tpl.metadata.updatedAt = new Date().toISOString();
  const ok = await h.templates.updateTemplate(p.templateId, { frames: tpl.frames, html: tpl.html, css: tpl.css });
  if (!ok) throw err("No se pudo guardar el diseño (Supabase). Reintenta.");
}
function addFont(frame, fam) {
  if (!fam || SYSTEM_FONTS.test(fam)) return;
  const href = `https://fonts.googleapis.com/css?family=${encodeURIComponent(fam).replace(/%20/g, "+")}:400,500,700,900&display=swap`;
  if (!String(frame.css || "").includes(href)) frame.css = `@import url("${href}");\n${frame.css || ""}`;
}
function $frame(frame) { return cheerio.load(frame.html || "", { xmlMode: false }, false); }
function layerEl($, id) { const el = $(`[data-layer-id="${String(id).replace(/"/g, "")}"]`).first(); if (!el.length) throw err(`Capa no encontrada: ${id}`); return el; }
function styleOf(el) { const o = {}; String(el.attr("style") || "").split(";").forEach((d) => { const i = d.indexOf(":"); if (i > 0) o[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim(); }); return o; }
function setStyle(el, patch) { const o = styleOf(el); Object.entries(patch).forEach(([k, v]) => { if (v == null || v === "") delete o[k]; else o[k] = v; }); el.attr("style", Object.entries(o).map(([k, v]) => `${k}:${v}`).join(";")); }
function urlOfEl(el) {
  if ((el[0]?.tagName || "").toLowerCase() === "img") return el.attr("src");
  const m = /url\(["']?([^"')]+)["']?\)/.exec(styleOf(el)["background-image"] || styleOf(el).background || "");
  if (m) return m[1];
  const img = el.find("img").first(); return img.length ? img.attr("src") : null;
}
function boxOf(h, frame, id, p) {
  const b = id ? h.readBox(frame.html, frame.css, id) : { x: 0, y: 0 };
  return { x: num(p.x, b.x || 0), y: num(p.y, b.y || 0), w: num(p.width, b.width || frame.width || 1080), h: num(p.height, b.height || frame.height || 1080) };
}
const absStyle = (b) => `position:absolute;left:${r2(b.x)}px;top:${r2(b.y)}px;width:${r2(b.w)}px;height:${r2(b.h)}px;margin:0;box-sizing:border-box`;
async function imageBytes(h, p, url) {
  if (p.imageBase64) {
    const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(p.imageBase64);
    return { buffer: Buffer.from(m ? m[2] : p.imageBase64, "base64"), mimeType: m ? m[1] : "image/png" };
  }
  if (!url) throw err("Falta la imagen (imageUrl, imageBase64 o layerId de una imagen)", -32602);
  return h.fetchImageBytes(url);
}
const isPng = (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50;
const isJpg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8;
/* PNG o JPG → RGBA (Nano Banana y las fotos suelen ser JPG); se achica a «max» px de lado */
async function rasterOf(h, buf, max = 1600) {
  let r;
  if (isPng(buf)) r = await h.decodePngToRaster(new Uint8Array(buf));
  else if (isJpg(buf)) { const d = jpeg.decode(new Uint8Array(buf), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 600 }); r = { width: d.width, height: d.height, rgba: d.data }; }
  else throw err("Formato de imagen no soportado: usa PNG o JPG", -32602);
  const k = Math.min(1, max / Math.max(r.width, r.height));
  if (k >= 1) return r;
  const w = Math.max(1, Math.round(r.width * k)), hh = Math.max(1, Math.round(r.height * k)), out = new Uint8Array(w * hh * 4);
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) { const si = (Math.min(r.height - 1, Math.floor(y / k)) * r.width + Math.min(r.width - 1, Math.floor(x / k))) * 4, di = (y * w + x) * 4; out[di] = r.rgba[si]; out[di + 1] = r.rgba[si + 1]; out[di + 2] = r.rgba[si + 2]; out[di + 3] = r.rgba[si + 3]; }
  return { width: w, height: hh, rgba: out };
}
function lum(r, g, b) { return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; }

/* PNG RGBA → bytes (deflate nativo del runtime) */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function encodePng(w, h, rgba) {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1); }
  const comp = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const chunk = (type, data) => { const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer); dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i); out.set(data, 8); dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length))); return out; };
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", comp), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((n, a) => n + a.length, 0), png = new Uint8Array(total); let o = 0; parts.forEach((a) => { png.set(a, o); o += a.length; });
  return png;
}

/* ───────── generadores compartidos con la web (bridge-replica.js hace lo mismo) ───────── */
export function maskCss(shape, size = 100, cx = 50, cy = 50, radius = 12) {
  const s = clamp(num(size, 100), 5, 100) / 100, x = clamp(num(cx, 50), 0, 100), y = clamp(num(cy, 50), 0, 100);
  const poly = (pts) => `polygon(${pts.map(([px, py]) => `${r2(x + (px - 50) * s)}% ${r2(y + (py - 50) * s)}%`).join(",")})`;
  switch (shape) {
    case "circle": return `circle(${r2(50 * s)}% at ${x}% ${y}%)`;
    case "ellipse": return `ellipse(${r2(50 * s)}% ${r2(50 * s)}% at ${x}% ${y}%)`;
    case "rounded": { const t = r2(y - 50 * s), l = r2(x - 50 * s), b = r2(100 - (y + 50 * s)), rr = r2(100 - (x + 50 * s)); return `inset(${t}% ${rr}% ${b}% ${l}% round ${clamp(num(radius, 12), 0, 50)}%)`; }
    case "diamond": return poly([[50, 0], [100, 50], [50, 100], [0, 50]]);
    case "triangle": return poly([[50, 0], [100, 100], [0, 100]]);
    case "hexagon": return poly([[25, 0], [75, 0], [100, 50], [75, 100], [25, 100], [0, 50]]);
    case "star": { const pts = []; for (let i = 0; i < 10; i++) { const rr = i % 2 ? 20 : 50, a = (i * 36 - 90) * Math.PI / 180; pts.push([50 + rr * Math.cos(a), 52 + rr * Math.sin(a)]); } return poly(pts); }
    default: return "";
  }
}
export function asciiFromRgba(w, h, rgba, cols = 80, ramp = " .:-=+*#%@", invert = false) {
  cols = clamp(Math.round(cols), 8, 300);
  const rows = Math.max(1, Math.round(cols * (h / w) * 0.55)), cw = w / cols, ch = h / rows, out = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      let sum = 0, a = 0, n = 0;
      for (let yy = Math.floor(r * ch); yy < Math.min(h, Math.floor((r + 1) * ch)); yy += Math.max(1, Math.floor(ch / 3))) {
        for (let xx = Math.floor(c * cw); xx < Math.min(w, Math.floor((c + 1) * cw)); xx += Math.max(1, Math.floor(cw / 3))) {
          const i = (yy * w + xx) * 4; sum += lum(rgba[i], rgba[i + 1], rgba[i + 2]); a += rgba[i + 3] / 255; n++;
        }
      }
      const L = n ? sum / n : 1, A = n ? a / n : 0;
      if (A < 0.1) { line += " "; continue; }
      const v = invert ? 1 - L : L;
      line += ramp[Math.min(ramp.length - 1, Math.floor(v * ramp.length))];
    }
    out.push(line.replace(/\s+$/, ""));
  }
  return out.join("\n");
}
export function halftoneSvg(w, h, rgba, box, o) {
  const cell = clamp(num(o.cell, 10), 3, 80), ang = num(o.angle, 45) * Math.PI / 180, shape = o.shape || "circle";
  const color = o.color || "#111111", thr = clamp(num(o.threshold, 0), 0, 100) / 100, cos = Math.cos(ang), sin = Math.sin(ang);
  const W = box.w, H = box.h, diag = Math.hypot(W, H), cx = W / 2, cy = H / 2, marks = [];
  let n = 0;
  for (let v = -diag / 2; v <= diag / 2 && n < 16000; v += cell) {
    for (let u = -diag / 2; u <= diag / 2 && n < 16000; u += cell) {
      const X = cx + u * cos - v * sin, Y = cy + u * sin + v * cos;
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const ix = Math.floor(X / W * w), iy = Math.floor(Y / H * h), i = (iy * w + ix) * 4;
      if (rgba[i + 3] < 25) continue;
      const d = 1 - lum(rgba[i], rgba[i + 1], rgba[i + 2]);
      if (d <= thr + 0.02) continue;
      const k = Math.sqrt(d);
      if (shape === "square") { const s = r2(cell * 0.92 * k); marks.push(`<rect x="${r2(X - s / 2)}" y="${r2(Y - s / 2)}" width="${s}" height="${s}"/>`); }
      else if (shape === "line") { const t = r2(cell * 0.9 * d); marks.push(`<rect x="${r2(X - cell / 2)}" y="${r2(Y - t / 2)}" width="${r2(cell)}" height="${t}" transform="rotate(${r2(o.angle ?? 45)} ${r2(X)} ${r2(Y)})"/>`); }
      else marks.push(`<circle cx="${r2(X)}" cy="${r2(Y)}" r="${r2(cell * 0.56 * k)}"/>`);
      n++;
    }
  }
  return `<svg viewBox="0 0 ${r2(W)} ${r2(H)}" width="100%" height="100%" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${o.background ? `<rect width="100%" height="100%" fill="${escAttr(o.background)}"/>` : ""}<g fill="${escAttr(color)}">${marks.join("")}</g></svg>`;
}
export function textPathSvg(cfg, w, h) {
  const curve = clamp(num(cfg.curve, 50), -100, 100), size = num(cfg.size, 48), id = cfg.pid || lid("tp");
  let d;
  if (cfg.mode === "circle") { const r = Math.max(10, Math.min(w, h) / 2 - size * 0.7), cx = w / 2, cy = h / 2; d = `M ${r2(cx)} ${r2(cy + r)} A ${r2(r)} ${r2(r)} 0 1 1 ${r2(cx + 0.01)} ${r2(cy + r)}`; }
  else if (cfg.mode === "wave") { const a = h / 2 * Math.abs(curve) / 100 * 0.8, y = h / 2, q = w / 4; d = `M 0 ${r2(y)} Q ${r2(q)} ${r2(y - a)} ${r2(2 * q)} ${r2(y)} T ${r2(w)} ${r2(y)}`; }
  else { const y = curve >= 0 ? h - size * 0.4 : size, k = (curve / 100) * (h - size); d = `M 0 ${r2(y)} Q ${r2(w / 2)} ${r2(y - 2 * k)} ${r2(w)} ${r2(y)}`; }
  const fam = String(cfg.font || "Inter").replace(/["<>]/g, "");
  return `<svg viewBox="0 0 ${r2(w)} ${r2(h)}" width="100%" height="100%" overflow="visible" xmlns="http://www.w3.org/2000/svg"><path id="${id}" d="${d}" fill="none"/><text font-family="'${fam}', sans-serif" font-size="${r2(size)}" font-weight="${num(cfg.weight, 700)}" fill="${escAttr(cfg.color || "#111111")}" letter-spacing="${num(cfg.ls, 0)}"><textPath href="#${id}" startOffset="50%" text-anchor="middle">${escHtml(cfg.text || "")}</textPath></text></svg>`;
}
export const TEXTURES = {
  grain: (k, id) => `<filter id="${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="n"/><feColorMatrix in="n" type="saturate" values="0" result="g"/><feComponentTransfer in="g" result="a"><feFuncA type="linear" slope="${r2(0.6 * k)}"/></feComponentTransfer><feComposite in="a" in2="SourceGraphic" operator="in" result="m"/><feBlend in="SourceGraphic" in2="m" mode="multiply"/></filter>`,
  paper: (k, id) => `<filter id="${id}"><feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="4" seed="7" result="n"/><feDiffuseLighting in="n" lighting-color="#ffffff" surfaceScale="${r2(2 * k)}" result="l"><feDistantLight azimuth="45" elevation="60"/></feDiffuseLighting><feComposite in="l" in2="SourceGraphic" operator="in" result="m"/><feBlend in="SourceGraphic" in2="m" mode="multiply"/></filter>`,
  crayon: (k, id) => `<filter id="${id}"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" seed="11" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="${r2(2 + 4 * k)}" xChannelSelector="R" yChannelSelector="G" result="d"/><feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="1" seed="5" result="g"/><feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${r2(-2.2 * k)} ${r2(1 + 0.9 * k)}" result="holes"/><feComposite in="d" in2="holes" operator="in"/></filter>`,
  noise: (k, id) => `<filter id="${id}"><feTurbulence type="turbulence" baseFrequency="0.65" numOctaves="3" seed="2" result="n"/><feColorMatrix in="n" type="saturate" values="0" result="g"/><feComponentTransfer in="g" result="a"><feFuncA type="linear" slope="${r2(0.8 * k)}"/></feComponentTransfer><feComposite in="a" in2="SourceGraphic" operator="in" result="m"/><feBlend in="SourceGraphic" in2="m" mode="overlay"/></filter>`,
};
export function twemojiUrl(emoji) {
  const cps = [...String(emoji).trim()].map((c) => c.codePointAt(0).toString(16));
  const keep = cps.includes("200d") ? cps : cps.filter((c) => c !== "fe0f");
  return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/${keep.join("-")}.svg`;
}
const FONT_CATALOG = {
  sans: ["Inter", "Inter Tight", "Roboto", "Montserrat", "Poppins", "DM Sans", "Manrope", "Archivo", "Work Sans", "Space Grotesk", "Helvetica Neue"],
  serif: ["Playfair Display", "Cormorant Garamond", "Libre Baskerville", "DM Serif Display", "Lora", "EB Garamond", "Bodoni Moda", "Fraunces"],
  mono: ["Space Mono", "JetBrains Mono", "IBM Plex Mono", "Courier Prime", "VT323"],
  blackletter: ["UnifrakturMaguntia", "UnifrakturCook", "Pirata One", "Grenze Gotisch", "New Rocker"],
  script: ["Caveat", "Pacifico", "Dancing Script", "Great Vibes", "Permanent Marker"],
  display: ["Anton", "Bebas Neue", "Oswald", "Archivo Black", "Syne", "Abril Fatface", "Alfa Slab One", "Rubik Mono One"],
  cjk: ["Noto Sans SC", "Noto Serif SC", "Noto Sans JP", "Noto Sans KR"],
};
const ALL_FONTS = Object.values(FONT_CATALOG).flat();
function pickFont(name, cat) {
  const hit = ALL_FONTS.find((f) => f.toLowerCase() === String(name || "").toLowerCase());
  if (hit) return hit;
  const c = String(cat || "").toLowerCase();
  const key = /black|goth|fraktur/.test(c) ? "blackletter" : /mono|ascii/.test(c) ? "mono" : /script|hand/.test(c) ? "script" : /cjk|chinese|japan|korea/.test(c) ? "cjk" : /serif/.test(c) && !/sans/.test(c) ? "serif" : /display|condens|poster/.test(c) ? "display" : "sans";
  return FONT_CATALOG[key][0];
}
/* Nano Banana a veces se niega (IMAGE_RECITATION, SAFETY, sin imagen): un segundo intento con otra redacción */
async function nano(h, prompt, imageBase64, alt) {
  try { const r = await h.callTool("ai_generate_image", { prompt, imageBase64 }); if (r?.imageBase64) return r; throw err("sin imagen"); }
  catch (e) { const m = String(e?.message || e); if (/NO_GEMINI|créditos|llave|key/i.test(m)) throw e; return h.callTool("ai_generate_image", { prompt: alt || prompt + " Output only the edited photo.", imageBase64 }); }
}
/* Nano Banana puede recomponer (mover o escalar al sujeto): se busca el desplazamiento y la escala que hacen
   calzar el recorte sobre la foto original, primero gruesa (32 px) y luego fina (64 px). Devuelve la caja relativa. */
function gridOf(r, n) { const out = new Float32Array(n * n * 4); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const si = (Math.min(r.height - 1, Math.floor((y + 0.5) * r.height / n)) * r.width + Math.min(r.width - 1, Math.floor((x + 0.5) * r.width / n))) * 4, di = (y * n + x) * 4; out[di] = r.rgba[si]; out[di + 1] = r.rgba[si + 1]; out[di + 2] = r.rgba[si + 2]; out[di + 3] = r.rgba[si + 3]; } return out; }
function alignScore(o, c, n, dx, dy, sc) {
  let sum = 0, cnt = 0, miss = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const ci = (y * n + x) * 4; if (c[ci + 3] < 160) continue;
    const X = Math.round((x - n / 2) * sc + n / 2 + dx), Y = Math.round((y - n / 2) * sc + n / 2 + dy);
    if (X < 0 || Y < 0 || X >= n || Y >= n) { miss++; continue; }
    const oi = (Y * n + X) * 4; sum += Math.abs(o[oi] - c[ci]) + Math.abs(o[oi + 1] - c[ci + 1]) + Math.abs(o[oi + 2] - c[ci + 2]); cnt++;
  }
  return cnt ? sum / cnt + miss * 2 : Infinity;
}
function alignSubject(orig, cut) {
  let best = { dx: 0, dy: 0, s: 1, v: Infinity };
  const o32 = gridOf(orig, 32), c32 = gridOf(cut, 32);
  for (const sc of [0.8, 0.9, 1, 1.1, 1.25]) for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) { const v = alignScore(o32, c32, 32, dx, dy, sc); if (v < best.v) best = { dx: dx / 32, dy: dy / 32, s: sc, v }; }
  const o64 = gridOf(orig, 64), c64 = gridOf(cut, 64); let fine = { ...best, v: Infinity };
  for (const sc of [best.s - 0.05, best.s, best.s + 0.05]) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const DX = Math.round(best.dx * 64) + dx, DY = Math.round(best.dy * 64) + dy, v = alignScore(o64, c64, 64, DX, DY, sc); if (v < fine.v) fine = { dx: DX / 64, dy: DY / 64, s: sc, v }; }
  return fine;
}
function parseJson(text) { const s = String(text || ""), a = s.indexOf("{"), b = s.lastIndexOf("}"); if (a < 0 || b < a) return null; try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; } }

/* ───────── dispatcher ───────── */
export async function handleReplicaTool(method, p, auth, h) {
  switch (method) {
    case "image_vectorize_svg": {
      const o = { ...(p.options || {}), ...p }, engine = o.engine === "color_layers" ? "color_layers" : "trace";
      if (!p.imageBase64 && !p.imageUrl) throw err("Falta la imagen a vectorizar (imageUrl o imageBase64)", -32602);
      const img = await imageBytes(h, p, p.imageUrl);
      let W, H, inner = "", n = 0;
      if (engine === "trace") {
        const ras = await rasterOf(h, img.buffer, 900); W = ras.width; H = ras.height;
        const out = h.traceImage(ras, { ...h.normalizeTraceParams(null), ...traceParams(o) }, 300000);
        if (!out.ok) throw err("No se pudo vectorizar: " + out.failure.message);
        for (const t of out.result.paths) { const c = t.color || "#000000"; n++; inner += t.strokeWidth !== undefined ? `<path d="${t.d}" fill="none" stroke="${c}" stroke-width="${t.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>` : `<path d="${t.d}" fill="${c}"/>`; }
      } else {
        const ras = await rasterOf(h, img.buffer, 600); W = ras.width; H = ras.height;
        const r = colorLayers(ras, { maxColors: o.maxColors, tolerance: o.tolerance, simplify: o.simplify, lettersAsLayers: false, keepBackground: o.keepBackground });
        for (const l of r.layers) { n++; inner += `<path d="${l.d}" fill="${l.fill}" fill-rule="evenodd"/>`; }
      }
      if (!n) throw err("No salió ninguna forma: prueba con más colores o sin quitar el fondo");
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${inner}</svg>`;
      if (svg.length > 400000) throw err("El vector salió muy pesado: baja los colores o la precisión");
      return { engine, svg, width: W, height: H, paths: n };
    }
    case "layer_vectorize": {
      /* tres modos (anexo de Instinct): trace (gratis, motor propio), color_layers (capa por región y por letra), ai (Quiver) */
      const o = { ...(p.options || {}), ...p }, engine = o.engine === "color_layers" || o.engine === "ai" ? o.engine : (o.engine === "quiver" ? "ai" : "trace");
      const { tpl, frame } = await loadFrame(h, p); const $ = $frame(frame);
      let url = p.imageUrl, srcEl = null;
      if (p.layerId) { srcEl = layerEl($, p.layerId); url = url || urlOfEl(srcEl); }
      if (!p.imageBase64 && !url) throw err("Falta la imagen a vectorizar", -32602);
      const b = boxOf(h, frame, p.layerId, p), img = await imageBytes(h, p, url);
      let W, H, parts = [], extra = {};
      if (engine === "trace") {
        const ras = await rasterOf(h, img.buffer, 900); W = ras.width; H = ras.height;
        const out = h.traceImage(ras, { ...h.normalizeTraceParams(null), ...traceParams(o) }, 300000);
        if (!out.ok) throw err("No se pudo vectorizar: " + out.failure.message);
        const byColor = new Map();
        for (const t of out.result.paths) { const c = t.color || "#000000"; if (!byColor.has(c)) byColor.set(c, []); byColor.get(c).push(t); }
        const cnt = {};
        for (const [c, list] of byColor) { const nm = colorName(c); cnt[nm] = (cnt[nm] || 0) + 1; parts.push({ name: "color " + nm + " " + cnt[nm], fill: c, inner: list.map((t) => t.strokeWidth !== undefined ? `<path d="${t.d}" fill="none" stroke="${c}" stroke-width="${t.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>` : `<path d="${t.d}" fill="${c}"/>`).join("") }); }
        extra = { palette: out.result.palette, anchors: out.result.anchorCount };
      } else if (engine === "color_layers") {
        const ras = await rasterOf(h, img.buffer, 600); W = ras.width; H = ras.height;
        const r = colorLayers(ras, { colors: o.colors, maxColors: o.maxColors, tolerance: o.tolerance, minArea: o.minArea, simplify: o.simplify, smooth: o.smooth, lettersAsLayers: o.lettersAsLayers, keepBackground: o.keepBackground });
        parts = r.layers.map((l) => ({ name: l.name, fill: l.fill, inner: `<path d="${l.d}" fill="${l.fill}" fill-rule="evenodd"/>` }));
        extra = { palette: r.palette, background: r.background, letters: r.layers.filter((l) => l.kind === "letra").length };
      } else {
        const model = QUIVER_MODELS[o.model] ? o.model : "arrow-1.1", ras0 = await rasterOf(h, img.buffer, 2048);
        const estimate = QUIVER_MODELS[model].estimate(ras0.width * ras0.height);
        if (!o.confirmCost) return { needsConfirmation: true, engine, model, estimate, models: Object.entries(QUIVER_MODELS).map(([k, v]) => ({ model: k, label: v.label, estimate: v.estimate(ras0.width * ras0.height) })), note: "Vuelve a llamar con confirmCost: true para pagar y vectorizar." };
        let key = null; try { key = auth?.userId ? (await h.getUserKey(auth.userId, "quiver")).key : null; } catch { key = null; }
        if (!key) throw err("NO_QUIVER_KEY: agrega tu llave de Quiver en Configuración › Integraciones (Quiver AI) y vuelve a intentar. Los modos Normal y Por color son gratis.");
        const qr = await fetch("https://api.quiver.ai/v1/svgs/vectorizations", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, auto_crop: false, stream: false, image: { base64: img.buffer.toString("base64") } }) });
        if (!qr.ok) throw err(`Quiver respondió ${qr.status}: ${(await qr.text().catch(() => "")).slice(0, 160)}`);
        const qj = await qr.json(), svg = sanitizeImportedSvg(String(qj?.data?.[0]?.svg || qj?.svg || ""));
        if (!svg) throw err("Quiver no devolvió un SVG");
        const vb = /viewBox\s*=\s*["']\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([-\d.e]+)[\s,]+([-\d.e]+)/i.exec(svg); W = vb ? +vb[1] : ras0.width; H = vb ? +vb[2] : ras0.height;
        const sp = splitSvgParts(svg), list = sp.length >= 2 ? sp : [svg];
        parts = list.map((x, i) => ({ name: "Quiver " + (i + 1), raw: x.replace(/<svg\b/i, '<svg width="100%" height="100%" preserveAspectRatio="none"').replace(/(<svg\b[^>]*?)\s(width|height)="(?!100%)[^"]*"/gi, "$1") }));
        extra = { model, estimate, usage: qj?.usage || null, credits: qj?.credits ?? null };
      }
      if (!parts.length) throw err("No salió ninguna forma: prueba con más colores, otro umbral o menos limpieza de manchas");
      const gid = lid("vec"), srcName = srcEl ? (srcEl.attr("data-layer-name") || "imagen") : "imagen", made = [];
      const kids = parts.slice(0, 200).map((pt) => { const id = lid("vecl"); made.push({ layerId: id, name: pt.name, fill: pt.fill || null }); return `<div data-layer-id="${id}" data-layer-name="${escAttr(pt.name)}" data-layer-kind="svg" style="position:absolute;left:0;top:0;width:100%;height:100%;margin:0">${pt.raw || `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${pt.inner}</svg>`}</div>`; }).join("");
      const group = `<div data-layer-id="${gid}" data-layer-name="${escAttr("Vector · " + srcName)}" data-layer-kind="container" data-mr-vec="${escAttr(JSON.stringify({ engine, src: srcEl ? srcEl.attr("data-layer-id") : null }))}" style="${absStyle(b)}">${kids}</div>`;
      if (srcEl) srcEl.after(group); else $.root().append(group);
      const hide = srcEl && p.hideOriginal !== false; if (hide) setStyle(srcEl, { display: "none" });
      frame.html = $.html(); await saveTpl(h, p, tpl);
      return { engine, groupId: gid, layerId: gid, vectorLayers: made.length, layers: made, paths: made.length, rasterResidual: hide ? [srcName + " (original, oculta)"] : [], hiddenOriginal: !!hide, ...extra };
    }
    case "image_extract_text_layers": {
      const { tpl, frame } = await loadFrame(h, p);
      let url = p.imageUrl;
      if (p.layerId && !url && !p.imageBase64) url = urlOfEl(layerEl($frame(frame), p.layerId));
      const b = boxOf(h, frame, p.layerId, p);
      const img = await imageBytes(h, p, url);
      const vision = await h.resolveVisionProvider(auth);
      if (!vision) throw err("NO_VISION_KEY: conecta una llave de Gemini, OpenAI o Anthropic en Configuración › Integraciones (o usa créditos de Musa).");
      const catalog = Object.entries(FONT_CATALOG).map(([k, v]) => `${k}: ${v.join(", ")}`).join("\n");
      const prompt = p.ascii
        ? `This image contains ASCII art made of monospace characters. Transcribe it EXACTLY, row by row, preserving every space. Return ONLY JSON: {"blocks":[{"text":"<rows joined with \\n>","x0":0,"y0":0,"x1":1000,"y1":1000,"size":<font size as 0-1000 of image height>,"color":"#hex","category":"mono","font":"Space Mono","confidence":0-1}]}`
        : `You are a typography OCR for design replication. Find EVERY text block in the image (headlines, body, labels, buttons, numbers; any script incl. Chinese). For each block return its exact text (keep line breaks with \\n), its bounding box in 0-1000 coordinates of the image (x0,y0,x1,y1), the font size as 0-1000 of the image HEIGHT (cap-to-descender em size, not the box height), weight (100-900), italic (bool), color (#hex), align (left|center|right), letterSpacing in em, category (sans|serif|mono|blackletter|script|display|cjk) and the closest font chosen ONLY from this catalog:\n${catalog}\nand a confidence 0-1. Return ONLY JSON: {"blocks":[...]}`;
      const raw = await h.callVision({ provider: vision.provider, key: vision.key, base64: img.buffer.toString("base64"), mimeType: img.mimeType, prompt });
      const j = parseJson(raw);
      if (!j || !Array.isArray(j.blocks)) throw err("El modelo de visión no devolvió bloques de texto legibles. Reintenta.");
      const made = [], $ = $frame(frame);
      for (const bl of j.blocks.slice(0, 80)) {
        const text = String(bl.text || "").trim(); if (!text) continue;
        const font = p.ascii ? "Space Mono" : pickFont(bl.font, bl.category);
        const x0 = clamp(num(bl.x0, 0), 0, 1000), y0 = clamp(num(bl.y0, 0), 0, 1000), x1 = clamp(num(bl.x1, 1000), x0 + 1, 1000);
        const size = Math.max(6, r2(num(bl.size, 40) / 1000 * b.h));
        const id = lid("ocr"), al = /center|right/.test(bl.align) ? bl.align : "left";
        const st = `position:absolute;left:${r2(b.x + x0 / 1000 * b.w)}px;top:${r2(b.y + y0 / 1000 * b.h)}px;width:${r2((x1 - x0) / 1000 * b.w * 1.04)}px;margin:0;font-family:'${font}',${p.ascii ? "monospace" : "sans-serif"};font-size:${size}px;font-weight:${clamp(Math.round(num(bl.weight, 400) / 100) * 100, 100, 900)};${bl.italic ? "font-style:italic;" : ""}color:${/^#[0-9a-f]{3,8}$/i.test(bl.color || "") ? bl.color : "#111111"};line-height:${p.ascii ? 1 : 1.15};letter-spacing:${r2(num(bl.letterSpacing, 0))}em;text-align:${al};white-space:${p.ascii ? "pre" : "pre-wrap"}`;
        made.push({ layerId: id, text, font, size, confidence: clamp(num(bl.confidence, 0.5), 0, 1), category: bl.category || null });
        if (p.insert !== false) { $.root().append(`<${p.ascii ? "pre" : "div"} data-layer-id="${id}" data-layer-name="${escAttr("Texto · " + text.replace(/\s+/g, " ").slice(0, 28))}" data-layer-kind="text" data-ocr-confidence="${r2(clamp(num(bl.confidence, 0.5), 0, 1))}" style="${st}">${escHtml(text)}</${p.ascii ? "pre" : "div"}>`); addFont(frame, font); }
      }
      if (p.insert !== false && made.length) { frame.html = $.html(); await saveTpl(h, p, tpl); }
      return { blocks: made, provider: vision.provider, inserted: p.insert !== false };
    }
    case "text_create_ascii": {
      const { tpl, frame } = await loadFrame(h, p);
      let text = p.text;
      if (!text) {
        const img = await imageBytes(h, p, p.imageUrl);
        const ras = await rasterOf(h, img.buffer, 1200);
        text = asciiFromRgba(ras.width, ras.height, ras.rgba, num(p.columns, 80), p.ramp || " .:-=+*#%@", !!p.invert);
      }
      text = String(text).replace(/\r\n?/g, "\n");
      const lines = text.split("\n"), cols = Math.max(1, ...lines.map((l) => l.length));
      const fs = num(p.fontSize, p.width ? num(p.width, 600) / (cols * 0.6) : 12), font = p.font || "Space Mono", id = lid("ascii");
      const st = `position:absolute;left:${r2(num(p.x, 0))}px;top:${r2(num(p.y, 0))}px;margin:0;padding:0;font-family:'${font}',monospace;font-size:${r2(fs)}px;line-height:1;letter-spacing:0;white-space:pre;font-variant-ligatures:none;color:${escAttr(p.color || "#111111")}`;
      const $ = $frame(frame); $.root().append(`<pre data-layer-id="${id}" data-layer-name="${escAttr(p.name || "ASCII")}" data-layer-kind="text" data-mr-ascii="1" style="${st}">${escHtml(text)}</pre>`);
      frame.html = $.html(); addFont(frame, font); await saveTpl(h, p, tpl);
      return { layerId: id, columns: cols, rows: lines.length, fontSize: r2(fs), editable: "text" };
    }
    case "layer_apply_halftone": {
      const { tpl, frame } = await loadFrame(h, p);
      const $ = $frame(frame), el = layerEl($, p.layerId);
      const fx = (() => { try { return JSON.parse(el.attr("data-mr-fx") || "null"); } catch { return null; } })();
      if (p.remove) {
        const orig = fx?.orig ? $(`[data-layer-id="${fx.orig}"]`) : null;
        if (fx?.t === "halftone") { el.remove(); if (orig?.length) setStyle(orig, { display: null }); }
        else { $(`[data-mr-fx*='"orig":"${p.layerId}"']`).remove(); setStyle(el, { display: null }); }
        frame.html = $.html(); await saveTpl(h, p, tpl); return { removed: true };
      }
      const srcEl = fx?.t === "halftone" && fx.orig ? layerEl($, fx.orig) : el;
      const img = await imageBytes(h, p, fx?.src || urlOfEl(srcEl));
      const ras = await rasterOf(h, img.buffer, 1200);
      const b = boxOf(h, frame, srcEl.attr("data-layer-id"), {});
      const o = { cell: num(p.cell, fx?.cell ?? 10), angle: num(p.angle, fx?.angle ?? 45), shape: p.shape || fx?.shape || "circle", color: p.color || fx?.color || "#111111", background: p.background ?? fx?.background ?? "", threshold: num(p.threshold, fx?.threshold ?? 0) };
      const svg = halftoneSvg(ras.width, ras.height, ras.rgba, b, o);
      const metaObj = { t: "halftone", orig: srcEl.attr("data-layer-id"), src: fx?.src || urlOfEl(srcEl), ...o };
      const id = fx?.t === "halftone" ? p.layerId : lid("halftone");
      if (fx?.t === "halftone") { el.html(svg); el.attr("data-mr-fx", JSON.stringify(metaObj)); }
      else { srcEl.after(`<div data-layer-id="${id}" data-layer-name="Halftone · ${escAttr(srcEl.attr("data-layer-name") || "imagen")}" data-layer-kind="svg" data-mr-fx="${escAttr(JSON.stringify(metaObj))}" style="${absStyle(b)}">${svg}</div>`); setStyle(srcEl, { display: "none" }); }
      frame.html = $.html(); await saveTpl(h, p, tpl);
      return { layerId: id, ...o, editable: "parámetros (cell, angle, shape, color, threshold)" };
    }
    case "layer_set_mask": {
      const { tpl, frame } = await loadFrame(h, p);
      const $ = $frame(frame), el = layerEl($, p.layerId), cp = maskCss(p.shape, p.size, p.cx, p.cy, p.radius);
      setStyle(el, { "clip-path": cp || null, "-webkit-clip-path": cp || null });
      if (cp) el.attr("data-mr-mask", JSON.stringify({ shape: p.shape, size: num(p.size, 100), cx: num(p.cx, 50), cy: num(p.cy, 50), radius: num(p.radius, 12) })); else el.removeAttr("data-mr-mask");
      frame.html = $.html(); await saveTpl(h, p, tpl);
      return { layerId: p.layerId, clipPath: cp || "none" };
    }
    case "import_svg_paths": {
      const { tpl, frame } = await loadFrame(h, p);
      let svg = p.svg;
      if (!svg && p.url) { const r = await fetch(String(p.url)); if (!r.ok) throw err(`No se pudo leer el SVG (${r.status})`); svg = await r.text(); }
      if (!svg) throw err("Falta svg o url", -32602);
      const clean = sanitizeImportedSvg(String(svg));
      const vb = /viewBox\s*=\s*["']\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([-\d.e]+)[\s,]+([-\d.e]+)/i.exec(clean);
      const nw = vb ? +vb[1] : num(/\swidth\s*=\s*["']?([\d.]+)/i.exec(clean)?.[1], 100), nh = vb ? +vb[2] : num(/\sheight\s*=\s*["']?([\d.]+)/i.exec(clean)?.[1], 100);
      const w = num(p.width, nw), hh = num(p.height, p.width ? num(p.width, nw) * nh / nw : nh);
      const b = { x: num(p.x, 0), y: num(p.y, 0), w, h: hh };
      const parts = splitSvgParts(clean); const list = parts.length >= 2 ? parts : [clean];
      const fit = (s) => s.replace(/<svg\b/i, '<svg width="100%" height="100%" preserveAspectRatio="xMidYMid meet"').replace(/(<svg\b[^>]*?)\s(width|height)="(?!100%)[^"]*"/gi, "$1");
      const $ = $frame(frame), name = p.name || "SVG", ids = [];
      list.forEach((s, i) => { const id = lid("svg"); ids.push(id); $.root().append(`<div data-layer-id="${id}" data-layer-name="${escAttr(list.length > 1 ? `${name} · ${i + 1}` : name)}" data-layer-kind="svg" style="${absStyle(b)}">${fit(s)}</div>`); });
      frame.html = $.html(); await saveTpl(h, p, tpl);
      return { layerIds: ids, layers: ids.length, editable: "vector" };
    }
    case "text_set_path": {
      const { tpl, frame } = await loadFrame(h, p);
      const $ = $frame(frame), el = layerEl($, p.layerId), st = styleOf(el);
      const old = (() => { try { return JSON.parse(el.attr("data-mr-tp") || "null"); } catch { return null; } })();
      const text = p.text ?? old?.text ?? el.text().trim();
      const cfg = { text, mode: p.mode, curve: num(p.curve, old?.curve ?? 50), font: p.font || old?.font || (st["font-family"] || "Inter").split(",")[0].replace(/['"]/g, "").trim(), size: num(p.size, old?.size ?? (parseFloat(st["font-size"]) || 48)), color: p.color || old?.color || st.color || "#111111", weight: num(p.weight, old?.weight ?? (parseFloat(st["font-weight"]) || 700)) };
      const b = boxOf(h, frame, p.layerId, {});
      if (/^vertical/.test(p.mode) || p.mode === "horizontal") {
        const restore = old ? `<div data-layer-id="${p.layerId}" data-layer-name="${escAttr(el.attr("data-layer-name") || "Texto")}" data-layer-kind="text" style="position:absolute;left:${r2(b.x)}px;top:${r2(b.y)}px;margin:0;font-family:'${cfg.font}',sans-serif;font-size:${cfg.size}px;font-weight:${cfg.weight};color:${escAttr(cfg.color)};white-space:pre-wrap">${escHtml(text)}</div>` : null;
        const target = restore ? (el.replaceWith(restore), layerEl($, p.layerId)) : el;
        const vm = p.mode === "vertical" ? { "writing-mode": "vertical-rl", "text-orientation": "upright", rotate: null } : p.mode === "vertical-up" ? { "writing-mode": "vertical-rl", "text-orientation": "mixed", rotate: "180deg" } : p.mode === "vertical-down" ? { "writing-mode": "vertical-rl", "text-orientation": "mixed", rotate: null } : { "writing-mode": null, "text-orientation": null, rotate: null };
        setStyle(target, vm);
        target.attr("data-mr-dir", p.mode === "horizontal" ? null : p.mode);
      } else {
        const w = Math.max(b.w || 0, cfg.size * Math.max(4, text.length) * 0.62), hh = p.mode === "circle" ? w : Math.max(b.h || 0, cfg.size * 3);
        cfg.pid = lid("tp");
        el.replaceWith(`<div data-layer-id="${p.layerId}" data-layer-name="${escAttr(el.attr("data-layer-name") || "Texto en trayectoria")}" data-layer-kind="svg" data-mr-tp="${escAttr(JSON.stringify(cfg))}" style="${absStyle({ x: b.x, y: b.y, w, h: hh })}">${textPathSvg(cfg, w, hh)}</div>`);
        addFont(frame, cfg.font);
      }
      frame.html = $.html(); await saveTpl(h, p, tpl);
      return { layerId: p.layerId, mode: p.mode, text, editable: "texto (contenido, fuente, tamaño, color)" };
    }
    case "emoji_insert_vector": {
      const { tpl, frame } = await loadFrame(h, p);
      const r = await fetch(twemojiUrl(p.emoji));
      if (!r.ok) throw err(`No encontré ese emoji como vector (${r.status})`);
      let svg = sanitizeImportedSvg(await r.text());
      if (p.color) svg = svg.replace(/fill="#[0-9a-fA-F]{3,8}"/g, `fill="${escAttr(p.color)}"`);
      svg = svg.replace(/<svg\b/i, '<svg width="100%" height="100%"');
      const s = num(p.size, 160), id = lid("emoji"), $ = $frame(frame);
      $.root().append(`<div data-layer-id="${id}" data-layer-name="Emoji ${escAttr(p.emoji)}" data-layer-kind="svg" style="${absStyle({ x: num(p.x, 0), y: num(p.y, 0), w: s, h: s })}">${svg}</div>`);
      frame.html = $.html(); await saveTpl(h, p, tpl);
      return { layerId: id, source: "Twemoji (CC-BY 4.0)", editable: "vector" };
    }
    case "layer_apply_texture": {
      const { tpl, frame } = await loadFrame(h, p);
      const $ = $frame(frame), el = layerEl($, p.layerId), svgEl = el.is("svg") ? el : el.children("svg").first();
      const k = clamp(num(p.amount, 60), 0, 100) / 100, fid = `mrtex_${p.layerId.replace(/[^\w-]/g, "")}`;
      $(`[data-mr-fx*='"t":"texture"'][data-mr-fx*='"target":"${p.layerId}"']`).remove();
      if (svgEl.length) {
        svgEl.find(`filter#${fid}`).remove(); const g = svgEl.children(`g[data-mr-tex]`);
        if (g.length) { g.replaceWith(g.html()); }
        if (p.texture !== "none") { svgEl.prepend(`<defs>${TEXTURES[p.texture](Math.max(0.05, k), fid)}</defs>`); const inner = svgEl.html(); svgEl.html(`<g data-mr-tex="${p.texture}" filter="url(#${fid})">${inner}</g>`); }
      } else if (p.texture !== "none") {
        const b = boxOf(h, frame, p.layerId, {}), id = lid("tex");
        el.after(`<div data-layer-id="${id}" data-layer-name="Textura · ${p.texture}" data-layer-kind="svg" data-mr-fx='${JSON.stringify({ t: "texture", target: p.layerId, texture: p.texture, amount: Math.round(k * 100) })}' style="${absStyle(b)};pointer-events:none;mix-blend-mode:multiply"><svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><defs>${TEXTURES[p.texture](Math.max(0.05, k), fid)}</defs><rect width="100%" height="100%" fill="#ffffff" filter="url(#${fid})"/></svg></div>`);
      }
      frame.html = $.html(); await saveTpl(h, p, tpl);
      return { layerId: p.layerId, texture: p.texture, amount: Math.round(k * 100) };
    }
    case "layer_split_subject": {
      const { frame } = await loadFrame(h, p);
      const $ = $frame(frame), el = layerEl($, p.layerId), url = p.imageUrl || urlOfEl(el);
      if (!url) throw err("La capa no es una imagen");
      const img = await imageBytes(h, {}, url), b64 = `data:${img.mimeType};base64,${img.buffer.toString("base64")}`;
      const subj = await nano(h, "Keep ONLY the main subject of this exact photo (people, product or main object, with hair and fine edges), same position, size and framing, and replace EVERYTHING else with a perfectly flat pure green #00FF00 background. No shadows on the green, no new elements.", b64, "Photo edit: replace the background behind the main subject with solid chroma-key green (#00FF00). Leave the subject itself untouched, same size and position.");
      const plate = await nano(h, "Remove the main subject (people, product or main object) from this exact photo and reconstruct the background behind it naturally, same framing, lighting and size. Do not add anything new.", b64, "Photo edit: erase the main subject and fill the area with the surrounding background so it looks like an empty scene.");
      const dec = (d) => Buffer.from(String(d).replace(/^data:[^;]+;base64,/, ""), "base64");
      const sb = dec(subj?.imageBase64 || "");
      const ras = await rasterOf(h, sb, 2048), px = ras.rgba;
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i], g = px[i + 1], bl = px[i + 2], gr = g - Math.max(r, bl);
        const a = gr > 90 ? 0 : gr > 35 ? Math.round(255 * (90 - gr) / 55) : 255;
        px[i + 3] = Math.min(px[i + 3], a); if (a < 255 && a > 0) px[i + 1] = Math.min(g, Math.max(r, bl));
      }
      const png = await encodePng(ras.width, ras.height, px instanceof Uint8Array ? px : new Uint8Array(px.buffer));
      let fit = { dx: 0, dy: 0, s: 1 };
      try { fit = alignSubject(await rasterOf(h, img.buffer, 512), { width: ras.width, height: ras.height, rgba: px }); } catch { /* sin alinear */ }
      const up1 = await h.callTool("upload_image", { data: `data:image/png;base64,${Buffer.from(png).toString("base64")}`, name: "Sujeto recortado.png", workspaceId: p.workspaceId });
      const up2 = await h.callTool("upload_image", { data: plate.imageBase64, name: "Fondo sin sujeto.png", workspaceId: p.workspaceId });
      const again = await loadFrame(h, p), $2 = $frame(again.frame), el2 = layerEl($2, p.layerId), box = boxOf(h, again.frame, p.layerId, {});
      const nm = el2.attr("data-layer-name") || "Foto", idF = lid("fondo"), idS = lid("sujeto");
      const layer = (id, name, u, bx) => `<div data-layer-id="${id}" data-layer-name="${escAttr(name)}" data-layer-kind="image" style="${absStyle(bx)};background-image:url('${escAttr(u)}');background-size:100% 100%;background-repeat:no-repeat"></div>`;
      const sbox = { x: box.x + box.w * (0.5 - 0.5 * fit.s + fit.dx), y: box.y + box.h * (0.5 - 0.5 * fit.s + fit.dy), w: box.w * fit.s, h: box.h * fit.s };
      el2.after(layer(idF, `${nm} · fondo`, up2.url, box) + layer(idS, `${nm} · sujeto`, up1.url, sbox));
      again.frame.html = $2.html(); await saveTpl(h, p, again.tpl);
      return { aligned: { dx: r2(fit.dx), dy: r2(fit.dy), scale: r2(fit.s) }, original: p.layerId, subjectLayerId: idS, backgroundLayerId: idF, subjectUrl: up1.url, backgroundUrl: up2.url, note: "La original queda intacta debajo; el sujeto es PNG con transparencia." };
    }
    case "image_inpaint_region": {
      const { tpl, frame } = await loadFrame(h, p);
      const $ = $frame(frame), el = layerEl($, p.layerId);
      if (p.restore) {
        const o = el.attr("data-orig-src"); if (!o) throw err("Esta capa no tiene un borrado que deshacer");
        if (el.is("img")) el.attr("src", o); else setStyle(el, { "background-image": `url('${o}')` });
        el.removeAttr("data-orig-src"); frame.html = $.html(); await saveTpl(h, p, tpl); return { restored: true, url: o };
      }
      const url = urlOfEl(el); if (!url) throw err("La capa no es una imagen");
      const rg = p.region || {}, x = clamp(num(rg.x, 0), 0, 1), y = clamp(num(rg.y, 0), 0, 1), w = clamp(num(rg.w, 0.2), 0.01, 1), hh = clamp(num(rg.h, 0.2), 0.01, 1);
      const zone = `the rectangle from ${Math.round(x * 100)}% to ${Math.round((x + w) * 100)}% horizontally and ${Math.round(y * 100)}% to ${Math.round((y + hh) * 100)}% vertically`;
      let b64 = p.markedImageBase64;
      if (!b64) { const img = await imageBytes(h, {}, url); b64 = `data:${img.mimeType};base64,${img.buffer.toString("base64")}`; }
      const prompt = `${p.markedImageBase64 ? "Erase everything inside the magenta rectangle (and the magenta rectangle itself)" : `Erase ${p.what ? p.what + " located in " : "everything inside "}${zone} of this photo`} and reconstruct what was behind it so the area is clean and continuous with its surroundings (same texture, light and perspective, no blur). Keep the rest of the image EXACTLY the same, same framing and size. Do not add text or new elements.`;
      const out = await nano(h, prompt, b64);
      if (!out?.imageBase64) throw err("Nano Banana no devolvió imagen");
      const up = await h.callTool("upload_image", { data: out.imageBase64, name: "Zona borrada.png", workspaceId: p.workspaceId });
      if (!el.attr("data-orig-src")) el.attr("data-orig-src", url);
      if (el.is("img")) el.attr("src", up.url); else setStyle(el, { "background-image": `url('${up.url}')` });
      frame.html = $.html(); await saveTpl(h, p, tpl);
      return { layerId: p.layerId, url: up.url, original: url, reversible: true };
    }
    case "design_layer_report": {
      const tpl = await h.templates.getTemplate(p.templateId);
      if (!tpl) throw err(`Template not found: ${p.templateId}`);
      const frames = (tpl.frames || []).filter((f) => !p.frameId || f.id === p.frameId);
      return { frames: frames.map((f) => reportFrame(f)) };
    }
  }
  throw err(`Herramienta desconocida: ${method}`, -32601);
}

export function classifyLayer($, el) {
  const tag = (el[0]?.tagName || "").toLowerCase(), st = String(el.attr("style") || "");
  if (el.attr("data-mr-tp")) return "texto en trayectoria";
  const fx = el.attr("data-mr-fx") || "";
  if (/"t":"halftone"/.test(fx)) return "efecto halftone (vector)";
  if (/"t":"texture"/.test(fx)) return "textura (paramétrica)";
  if (tag === "svg" || el.children("svg").length === 1 && !el.children().not("svg").length) return "vector";
  if (tag === "img" || /background(-image)?\s*:[^;]*url\(/i.test(st)) return /\.svg(\?|$)/i.test(urlOfEl(el) || "") ? "vector (archivo SVG)" : "imagen (raster)";
  const own = el.contents().filter((_, n) => n.type === "text" && String(n.data || "").trim()).length;
  if (own || ["p", "h1", "h2", "h3", "h4", "h5", "h6", "span", "pre", "a", "button", "li"].includes(tag) && el.text().trim()) return "texto";
  return "forma / color";
}
function reportFrame(f) {
  const $ = cheerio.load(f.html || "", { xmlMode: false }, false), layers = [];
  $("[data-layer-id]").each((_, n) => { const el = $(n); if (el.parents("svg").length) return; layers.push({ layerId: el.attr("data-layer-id"), name: el.attr("data-layer-name") || el.attr("data-layer-id"), kind: classifyLayer($, el), hidden: /display\s*:\s*none/.test(el.attr("style") || "") }); });
  const count = {}; layers.filter((l) => !l.hidden).forEach((l) => { count[l.kind] = (count[l.kind] || 0) + 1; });
  return { frameId: f.id, name: f.name, counts: count, raster: layers.filter((l) => !l.hidden && l.kind === "imagen (raster)").map((l) => l.name), layers };
}
