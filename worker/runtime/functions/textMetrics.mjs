// textMetrics — REQ-032 Tool 2: medición REAL de texto renderizado (server-side,
// sin browser, sin dependencias). El agente la consume EN TIEMPO DE CREACIÓN
// para elegir el tamaño correcto; el editor jamás re-ajusta texto por su cuenta
// (PROHIBIDO autofit en runtime — decisión de producto).
//
// Alcance v1 (honesto, documentado en la descripción del tool):
//   - Fuentes TTF/OTF crudas vía fontUrl, o custom fonts del workspace/user
//     (bucket custom-fonts). wOFF/wOF2 NO soportados (zlib/brotli no garantizado
//     en el runtime del worker) → error claro, no fallback inventado.
//   - Métricas = advance widths (hmtx) vía cmap format 4/12. Sin kerning ni
//     ligaduras — precisión típica ±2%, suficiente para decidir tamaño, no para
//     tipografía fina.
import { readFileSync } from "node:fs";

export class FontMetricsError extends Error {}

const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const s16 = (b, o) => ((u16(b, o) << 16) >> 16);
const u32 = (b, o) => (((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);

/**
 * Parsea un binario TTF/OTF y devuelve { unitsPerEm, codepointWidth(code),
 * hasGlyph(code) } — advances en unidades de fuente.
 */
export function parseFontMetrics(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 12) throw new FontMetricsError("Font binary too small");
  const magic = String.fromCharCode(b[0], b[1], b[2], b[3]);
  if (magic === "wOFF") throw new FontMetricsError("WOFF not supported server-side — provide a raw TTF/OTF (Google Fonts css2 serves TTF to old browser User-Agents)");
  if (magic === "wOF2") throw new FontMetricsError("WOFF2 not supported server-side (brotli) — provide a raw TTF/OTF");
  if (magic !== "\x00\x01\x00\x00" && magic !== "OTTO" && magic !== "true") {
    throw new FontMetricsError(`Not a TTF/OTF font (magic ${JSON.stringify(magic)})`);
  }

  const numTables = u16(b, 4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(b[rec], b[rec + 1], b[rec + 2], b[rec + 3]);
    tables[tag] = { offset: u32(b, rec + 8), length: u32(b, rec + 12) };
  }
  for (const need of ["head", "hhea", "maxp", "hmtx", "cmap"]) {
    if (!tables[need]) throw new FontMetricsError(`Font missing required table: ${need}`);
  }
  const unitsPerEm = u16(b, tables.head.offset + 18);
  if (!unitsPerEm) throw new FontMetricsError("Invalid unitsPerEm");
  const numGlyphs = u16(b, tables.maxp.offset + 4);
  const numberOfHMetrics = u16(b, tables.hhea.offset + 34);

  // cmap — preferir Unicode BMP (3,1)/(0,x) format 4; luego (3,10) format 12;
  // último recurso symbol (3,0).
  const cmapOff = tables.cmap.offset;
  const nSub = u16(b, cmapOff + 2);
  let sub4 = null, sub12 = null, subSym = null;
  for (let i = 0; i < nSub; i++) {
    const rec = cmapOff + 4 + i * 8;
    const pid = u16(b, rec), eid = u16(b, rec + 2);
    const off = cmapOff + u32(b, rec + 4);
    const fmt = u16(b, off);
    if (fmt === 4 && ((pid === 3 && eid === 1) || pid === 0)) sub4 = sub4 || off;
    if (fmt === 12 && pid === 3 && eid === 10) sub12 = sub12 || off;
    if (fmt === 4 && pid === 3 && eid === 0) subSym = subSym || off;
  }
  const sub = sub4 || sub12 || subSym;
  if (!sub) throw new FontMetricsError("No supported cmap subtable (needs format 4 or 12)");

  const glyphFor = (code) => {
    if (u16(b, sub) === 4) {
      const segCount = u16(b, sub + 6) / 2;
      const endBase = sub + 14;
      const startBase = endBase + segCount * 2 + 2;
      const deltaBase = startBase + segCount * 2;
      const rangeBase = deltaBase + segCount * 2;
      for (let i = 0; i < segCount; i++) {
        const end = u16(b, endBase + i * 2);
        if (code > end) continue;
        const start = u16(b, startBase + i * 2);
        if (code < start) return 0;
        const idRangeOffset = u16(b, rangeBase + i * 2);
        if (idRangeOffset === 0) return (code + s16(b, deltaBase + i * 2)) & 0xFFFF;
        const g = u16(b, rangeBase + i * 2 + idRangeOffset + (code - start) * 2);
        return g === 0 ? 0 : (g + s16(b, deltaBase + i * 2)) & 0xFFFF;
      }
      return 0;
    }
    const nGroups = u32(b, sub + 12);
    for (let i = 0; i < nGroups; i++) {
      const g = sub + 16 + i * 12;
      const startChar = u32(b, g), endChar = u32(b, g + 4), startGlyph = u32(b, g + 8);
      if (code >= startChar && code <= endChar) return startGlyph + (code - startChar);
      if (code < startChar) return 0;
    }
    return 0;
  };

  const advanceOfGlyph = (gid) => {
    if (!gid || gid >= numGlyphs) return 0;
    const idx = Math.min(gid, numberOfHMetrics - 1);
    return u16(b, tables.hmtx.offset + idx * 4);
  };

  const cache = new Map();
  return {
    unitsPerEm,
    codepointWidth(code) {
      if (cache.has(code)) return cache.get(code);
      const w = advanceOfGlyph(glyphFor(code));
      cache.set(code, w);
      return w;
    },
    hasGlyph(code) {
      return glyphFor(code) !== 0;
    },
  };
}

/** Ancho en px de una cadena (incluye letter-spacing por carácter, como CSS). */
function runWidth(str, font, fontSize, letterSpacing) {
  let units = 0;
  let chars = 0;
  for (const ch of str) {
    units += font.codepointWidth(ch.codePointAt(0));
    chars++;
  }
  return (units / font.unitsPerEm) * fontSize + chars * letterSpacing;
}

/**
 * Mide `text` contra una caja. Envuelve por palabras (split por espacio),
 * respeta \n manuales. Devuelve métricas redondeadas a 2 decimales y, si
 * desborda, suggestedFontSize = el mayor tamaño ENTERO que sí cabe (verificado
 * re-midiendo, no extrapolando).
 */
export function measureTextBox({ text, font, fontSize, letterSpacing = 0, boxWidth = null, boxHeight = null, lineHeight = 1.2 }) {
  const size = Number(fontSize);
  if (!isFinite(size) || size <= 0) throw new FontMetricsError("fontSize must be a positive number");
  const ls = Number(letterSpacing) || 0;
  const lh = Number(lineHeight) > 0 ? Number(lineHeight) : 1.2;
  const boxW = boxWidth != null && isFinite(Number(boxWidth)) ? Number(boxWidth) : null;
  const boxH = boxHeight != null && isFinite(Number(boxHeight)) ? Number(boxHeight) : null;

  const wrap = (sz) => {
    const lines = [];
    for (const para of String(text).replace(/\r\n?/g, "\n").split("\n")) {
      if (para === "") { lines.push(""); continue; }
      let current = "";
      for (const word of para.split(" ")) {
        const candidate = current ? current + " " + word : word;
        const candidateW = runWidth(candidate, font, sz, ls);
        if (current !== "" && boxW != null && candidateW > boxW) {
          lines.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }
      lines.push(current);
    }
    let renderedWidth = 0;
    for (const line of lines) renderedWidth = Math.max(renderedWidth, runWidth(line, font, sz, ls));
    return { lines, renderedWidth, renderedHeight: lines.length * lh * sz };
  };

  const fits = (m) => (boxW == null || m.renderedWidth <= boxW + 0.01) && (boxH == null || m.renderedHeight <= boxH + 0.01);
  const round2 = (n) => Math.round(n * 100) / 100;

  const measured = wrap(size);
  const overflows = !fits(measured);
  let suggestedFontSize;
  if (overflows && (boxW != null || boxH != null)) {
    for (let candidate = Math.floor(size); candidate >= 1; candidate--) {
      if (fits(wrap(candidate))) { suggestedFontSize = candidate; break; }
    }
  }

  return {
    lines: measured.lines.length,
    renderedWidth: round2(measured.renderedWidth),
    renderedHeight: round2(measured.renderedHeight),
    overflows,
    ...(suggestedFontSize !== undefined ? { suggestedFontSize } : {}),
  };
}

/**
 * Carga y parsea una fuente desde una URL HTTP(S) (TTF/OTF crudo).
 * Devuelve { font, resolvedAs } o null si la respuesta no es válida.
 */
export async function loadFontFromUrl(url, fetchImpl = fetch) {
  const resp = await fetchImpl(url);
  if (!resp.ok) throw new FontMetricsError(`fontUrl fetch failed: HTTP ${resp.status}`);
  const buf = new Uint8Array(await resp.arrayBuffer());
  return { font: parseFontMetrics(buf), resolvedAs: "url" };
}

// Resolución desde archivo local — solo tests.
export function loadFontFromFileSync(path) {
  return parseFontMetrics(readFileSync(path));
}
