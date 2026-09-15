/**
 * Canonical document exchanged by browser imports, the HTTP API and MCP.
 * Keep this module dependency-free: it is bundled for both Node and Vite.
 */
export type DesignImportSource = "svg" | "psd" | "ai" | "pdf" | "fig" | "figma" | "image";
export type DesignImportFidelity = "editable" | "approximate" | "raster";

export interface DesignImportWarning {
  code: string;
  message: string;
  layerId?: string;
}

export interface DesignImportLayer {
  id: string;
  name: string;
  kind: "text" | "vector" | "image" | "group" | "fallback";
  x: number;
  y: number;
  width: number;
  height: number;
  fidelity: DesignImportFidelity;
  html: string;
  /** Extra positioning/paint properties applied to the addressable wrapper. */
  style?: string;
  /** Original Figma families used by this layer, including styled text runs. */
  fontFamilies?: string[];
  children?: DesignImportLayer[];
}

export interface DesignImportArtboard {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  layers: DesignImportLayer[];
}

export interface DesignImportDocument {
  version: "futuraria-import/v1";
  name: string;
  source: DesignImportSource;
  artboards: DesignImportArtboard[];
  warnings: DesignImportWarning[];
  report: { editable: number; approximate: number; raster: number };
  fonts?: { used: string[]; missing: string[] };
  /** Optional @font-face CSS (e.g. fonts embedded in a PDF) prepended to each artboard's css. */
  fontCss?: string;
}

/** Lightweight, server-produced inventory shown before a Figma import starts. */
export interface FigmaImportFramePreview {
  id: string;
  name: string;
  width: number;
  height: number;
  thumbnailUrl?: string;
}

/**
 * Durable state stored in design_import_jobs.result while a Figma selection is
 * being imported. `document` stays canonical so completed batches never need
 * to be converted again after a timeout or a rate-limit response.
 */
export interface FigmaImportBatchState {
  version: "futuraria-figma-batch/v1";
  url: string;
  frames: FigmaImportFramePreview[];
  selectedIds: string[];
  completedIds: string[];
  document: DesignImportDocument;
}

export function replaceImportFonts(document: DesignImportDocument, replacements: Record<string, string>): DesignImportDocument {
  const clone = structuredClone(document);
  const visit = (layer: DesignImportLayer) => {
    for (const source of layer.fontFamilies || []) {
      const replacement = replacements[source];
      if (!replacement) continue;
      const escapedSource = importFontCssValue(source);
      const escapedReplacement = importFontReplacementCssValue(replacement);
      layer.html = layer.html.split(`font-family:${escapedSource}`).join(`font-family:${escapedReplacement}`);
      layer.html = layer.html.split(`data-figma-font="${escapeImportHtml(source)}"`).join(`data-figma-font="${escapeImportHtml(replacement)}"`);
    }
    layer.fontFamilies = (layer.fontFamilies || []).map(family => replacements[family] || family);
    layer.children?.forEach(visit);
  };
  clone.artboards.forEach(artboard => artboard.layers.forEach(visit));
  const used = [...new Set((clone.fonts?.used || []).map(family => replacements[family] || family))];
  clone.fonts = { used, missing: (clone.fonts?.missing || []).filter(family => !replacements[family]) };
  return clone;
}

export function findMissingImportFonts(used: string[], available: string[]) {
  const known = new Set(available.map(family => family.trim().toLocaleLowerCase()).filter(Boolean));
  return [...new Set(used.map(family => family.trim()).filter(Boolean))].filter(family => !known.has(family.toLocaleLowerCase()));
}

const MAX_DIMENSION = 16_384;
const SVG_ELEMENTS = new Set("svg g defs path rect circle ellipse polygon polyline line text tspan textPath image use linearGradient radialGradient stop clipPath mask pattern filter feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence title desc symbol".split(" "));
const SVG_ATTRIBUTES = new Set("id xmlns xmlns:xlink version x y x1 y1 x2 y2 dx dy cx cy r rx ry width height viewBox preserveAspectRatio d points transform fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity clip-path clip-rule mask filter color font-family font-size font-weight font-style letter-spacing word-spacing text-anchor dominant-baseline alignment-baseline textLength lengthAdjust offset stop-color stop-opacity gradientUnits gradientTransform spreadMethod patternUnits patternContentUnits patternTransform maskUnits maskContentUnits clipPathUnits href xlink:href style display visibility overflow vector-effect paint-order shape-rendering color-interpolation-filters filterUnits primitiveUnits in in2 result mode type values operator k1 k2 k3 k4 stdDeviation flood-color flood-opacity dx dy scale xChannelSelector yChannelSelector baseFrequency numOctaves seed stitchTiles radius edgeMode kernelMatrix kernelUnitLength order divisor bias targetX targetY preserveAlpha surfaceScale diffuseConstant specularConstant specularExponent limitingConeAngle azimuth elevation pointsAtX pointsAtY pointsAtZ z amplitude exponent intercept slope tableValues".split(" "));
const LINK_ATTRIBUTES = /\s+(?:href|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
SVG_ELEMENTS.add("style");
SVG_ATTRIBUTES.add("class");
const STYLE_PROPERTY = /^(?:fill|stroke|opacity|fill-opacity|stroke-opacity|stroke-width|stroke-linecap|stroke-linejoin|stroke-miterlimit|stroke-dasharray|stroke-dashoffset|fill-rule|clip-rule|clip-path|mask|filter|font-family|font-size|font-weight|font-style|letter-spacing|word-spacing|text-anchor|display|visibility|isolation)\s*:\s*[^{}]+$/;

function validateSvgStyle(value: string) {
  value = value.replace(/[\r\n\t]/g, " ");
  if (/[<>\\\u0000-\u001f@]/.test(value) || /\/\*|expression\s*\(|(?:https?|javascript|vbscript):/i.test(value)) throw new Error("Estilo SVG no permitido.");
  if (/url\s*\(/i.test(value) && !/^[^()]*$/.test(value.replace(/url\(\s*["']?#[\w:.-]+["']?\s*\)/gi, ""))) throw new Error("URL SVG no permitida.");
  if (!value.split(";").every(declaration => !declaration.trim() || STYLE_PROPERTY.test(declaration.trim()))) throw new Error("Estilo SVG no permitido. Usa atributos de presentación.");
  return value;
}

function isSafeSvgReference(value: string) {
  const target = value.trim();
  return target.startsWith("#") || /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(target);
}

export function safeImportId(input: string, fallback = "layer") {
  const clean = input.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return clean || fallback;
}

export function escapeImportHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function importFontCssValue(value: string) {
  return escapeImportHtml(JSON.stringify(String(value || "sans-serif").replace(/[\\;{}\u0000-\u001f]/g, "")));
}

function importFontReplacementCssValue(value: string) {
  const safe = String(value || "sans-serif").replace(/[;{}\u0000-\u001f]/g, "").trim();
  if (!safe || !/^[\w\s,'".-]+$/.test(safe)) throw new Error("La fuente de reemplazo no es válida.");
  return escapeImportHtml(safe);
}

export function sanitizeImportedSvg(svg: string) {
  if (typeof svg !== "string" || !/<svg\b/i.test(svg)) throw new Error("El archivo no contiene un SVG válido.");
  if (svg.length > 8_000_000) throw new Error("El SVG supera el límite de 8 MB.");
  // Reject XML expansion and active/timed content instead of attempting to
  // repair it. These constructs have no design-editing value and are easy to
  // disguise with entities or animation attributes.
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(svg)) throw new Error("El SVG contiene declaraciones XML no permitidas.");
  if (/<(?:animate|animateMotion|animateTransform|set)\b/i.test(svg)) throw new Error("El SVG contiene animaciones activas no permitidas.");
  if (/\b@import\b/i.test(svg)) throw new Error("El SVG intenta importar estilos externos.");
  for (const match of svg.matchAll(LINK_ATTRIBUTES)) {
    const target = match[1] ?? match[2] ?? match[3] ?? "";
    if (!isSafeSvgReference(target)) throw new Error("El SVG contiene una referencia externa no permitida.");
  }
  for (const match of svg.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
    if (!isSafeSvgReference(match[2])) throw new Error("El SVG contiene una URL de estilo no permitida.");
  }
  // Parse a deliberately restricted XML grammar and serialize accepted tokens.
  // Never pass original markup through: browser HTML repair and CSS escapes
  // make replacement-based sanitizers unsafe.
  const source = svg.replace(/^\s*<\?xml\s[^?]*\?>/i, "").replace(/<!--[\s\S]*?-->/g, "");
  const tokens = /<[^>]*>|[^<]+/gy;
  const stack: string[] = [];
  const output: string[] = [];
  let end = 0;
  let rootSeen = false;
  let scopeHash = 2166136261;
  for (let i = 0; i < source.length; i++) scopeHash = Math.imul(scopeHash ^ source.charCodeAt(i), 16777619);
  const scope = `s${(scopeHash >>> 0).toString(36)}`;
  const decode = (value: string) => value.replace(/&(?:#(x[0-9a-f]+|\d+)|(amp|lt|gt|quot|apos));/gi, (_all, numeric, named) => {
    if (numeric) {
      const code = numeric[0].toLowerCase() === "x" ? parseInt(numeric.slice(1), 16) : Number(numeric);
      if (code < 32 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw new Error("Entidad SVG no permitida.");
      return String.fromCodePoint(code);
    }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[named.toLowerCase()];
  });
  for (const match of source.matchAll(tokens)) {
    end = match.index + match[0].length;
    const token = match[0];
    if (!token.startsWith("<")) {
      if (stack[stack.length - 1] === "style") {
        const css = decode(token).trim();
        const rules = /\s*([.#A-Za-z][\w\s.,#-]*)\s*\{([^{}]*)\}\s*/gy;
        let offset = 0;
        for (const rule of css.matchAll(rules)) {
          offset = rule.index + rule[0].length;
          const selectors = rule[1].split(",").map(selector => {
            if (!selector.trim().split(/\s+/).every(part => /^(?:[.#][\w-]+|[A-Za-z][A-Za-z0-9]*)$/.test(part))) throw new Error("Selector SVG no permitido.");
            return `[data-import-svg-scope="${scope}"] ${selector.trim()}`;
          });
          output.push(`${selectors.join(",")}{${validateSvgStyle(rule[2].trim())}}`);
        }
        if (offset !== css.length) throw new Error("Hoja de estilos SVG no permitida.");
        continue;
      }
      if (!stack.length && token.trim()) throw new Error("Texto fuera del SVG no permitido.");
      output.push(escapeImportHtml(decode(token)));
      continue;
    }
    const tag = token.match(/^<(\/)?([A-Za-z][A-Za-z0-9]*)([\s\S]*?)(\/?)>$/);
    if (!tag || !SVG_ELEMENTS.has(tag[2])) throw new Error("Elemento SVG no permitido. Exporta como SVG estático con atributos de presentación.");
    const [, closing, name, attributes, selfClosing] = tag;
    if (closing) {
      if (attributes.trim() || selfClosing || stack.pop() !== name) throw new Error("Estructura SVG no permitida.");
      output.push(`</${name}>`);
      continue;
    }
    if (!stack.length) {
      if (rootSeen || name !== "svg") throw new Error("Se requiere una única raíz SVG.");
      rootSeen = true;
    }
    let rest = attributes;
    const attrs: string[] = [];
    const seen = new Set<string>();
    while (rest.trim()) {
      const attr = rest.match(/^\s+([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/);
      if (!attr) throw new Error("Atributo SVG no permitido: usa valores entre comillas.");
      rest = rest.slice(attr[0].length);
      const key = attr[1];
      if (!SVG_ATTRIBUTES.has(key) || seen.has(key)) throw new Error("Atributo SVG no permitido.");
      seen.add(key);
      const value = decode(attr[2] ?? attr[3]);
      if (/[<>\\\u0000-\u001f]/.test(value) || /\/\*|@|expression\s*\(|(?:https?|javascript|vbscript):/i.test(value) && !key.startsWith("xmlns")) throw new Error("Valor SVG no permitido.");
      if (key === "xmlns" && value !== "http://www.w3.org/2000/svg" || key === "xmlns:xlink" && value !== "http://www.w3.org/1999/xlink") throw new Error("Namespace SVG no permitido.");
      if ((key === "href" || key === "xlink:href") && !/^(?:#[\w:.-]+|data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+)$/.test(value)) throw new Error("Referencia SVG externa no permitida.");
      if (/url\s*\(/i.test(value) && !value.replace(/url\(\s*["']?#[\w:.-]+["']?\s*\)/gi, "").match(/^[^()]*$/)) throw new Error("URL SVG no permitida.");
      if (key === "style") validateSvgStyle(value);
      attrs.push(`${key}="${escapeImportHtml(value)}"`);
    }
    if (name === "svg" && !stack.length) attrs.push(`data-import-svg-scope="${scope}"`);
    output.push(`<${name}${attrs.length ? " " + attrs.join(" ") : ""}${selfClosing ? "/" : ""}>`);
    if (!selfClosing) stack.push(name);
  }
  if (end !== source.length || stack.length || !rootSeen) throw new Error("SVG incompleto o no permitido.");
  return output.join("");
}

function svgDimensions(svg: string) {
  const root = svg.match(/<svg\b([^>]*)>/i)?.[1] || "";
  const attr = (name: string) => root.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
  const viewBox = attr("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const parsedWidth = Number.parseFloat(attr("width") || "");
  const parsedHeight = Number.parseFloat(attr("height") || "");
  const width = Number.isFinite(parsedWidth) ? parsedWidth : Number(viewBox?.[2]) || 1080;
  const height = Number.isFinite(parsedHeight) ? parsedHeight : Number(viewBox?.[3]) || 1080;
  return {
    width: Math.max(1, Math.min(MAX_DIMENSION, Math.round(width))),
    height: Math.max(1, Math.min(MAX_DIMENSION, Math.round(height))),
  };
}

export function importSvgDocument(svg: string, fileName = "Imported SVG"): DesignImportDocument {
  const clean = sanitizeImportedSvg(svg);
  const { width, height } = svgDimensions(clean);
  const name = fileName.replace(/\.svg$/i, "") || "Imported SVG";
  return finalizeImportDocument({
    version: "futuraria-import/v1",
    name,
    source: "svg",
    artboards: [{
      id: `artboard-${safeImportId(name)}`,
      name,
      width,
      height,
      background: "#ffffff",
      layers: [{ id: `vector-${safeImportId(name)}`, name, kind: "vector", x: 0, y: 0, width, height, fidelity: "approximate", html: clean }],
    }],
    warnings: [{ code: "svg_visual", message: "SVG conservado como bloque vectorial; no se han convertido sus elementos en capas nativas." }],
    report: { editable: 0, approximate: 0, raster: 0 },
  });
}

export function createFallbackImportDocument(options: {
  name: string;
  source: Extract<DesignImportSource, "ai" | "pdf" | "fig">;
  previewDataUrl?: string;
  message: string;
  width?: number;
  height?: number;
}) {
  const width = options.width || 1080;
  const height = options.height || 1080;
  const id = safeImportId(options.name);
  const preview = options.previewDataUrl
    ? `<img src="${escapeImportHtml(options.previewDataUrl)}" alt="" style="width:100%;height:100%;object-fit:contain">`
    : `<div style="box-sizing:border-box;width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:64px;background:#f5f5f4;color:#292524;font:24px/1.4 system-ui;text-align:center"><div><strong>${escapeImportHtml(options.name)}</strong><br><span style="font-size:18px">${escapeImportHtml(options.message)}</span></div></div>`;
  return finalizeImportDocument({
    version: "futuraria-import/v1",
    name: options.name,
    source: options.source,
    artboards: [{ id: `artboard-${id}`, name: options.name, width, height, background: "#ffffff", layers: [{ id: `fallback-${id}`, name: options.name, kind: "fallback", x: 0, y: 0, width, height, fidelity: "raster", html: preview }] }],
    warnings: [{ code: `${options.source}_fallback`, message: options.message }],
    report: { editable: 0, approximate: 0, raster: 0 },
  });
}

export function finalizeImportDocument(document: DesignImportDocument): DesignImportDocument {
  if (!document.artboards.length) throw new Error("La importación no produjo ninguna mesa de trabajo.");
  const report = { editable: 0, approximate: 0, raster: 0 };
  const visit = (layer: DesignImportLayer) => {
    report[layer.fidelity] += 1;
    layer.children?.forEach(visit);
  };
  document.artboards.forEach(artboard => {
    artboard.width = Math.max(1, Math.min(MAX_DIMENSION, Math.round(artboard.width || 1080)));
    artboard.height = Math.max(1, Math.min(MAX_DIMENSION, Math.round(artboard.height || 1080)));
    artboard.layers.forEach(visit);
  });
  return { ...document, report };
}

export function renderImportArtboard(artboard: DesignImportArtboard) {
  const flatten = (layer: DesignImportLayer): string => {
    const style = `position:absolute;left:${layer.x}px;top:${layer.y}px;width:${layer.width}px;height:${layer.height}px;${layer.style || "overflow:hidden;"}`;
    const children = layer.children?.map(flatten).join("") || "";
    const editorKind = layer.kind === "group" || layer.kind === "vector" ? "group" : layer.kind === "text" ? "text" : "container";
    return `<div data-layer-id="${escapeImportHtml(layer.id)}" data-layer-name="${escapeImportHtml(layer.name)}" data-layer-kind="${editorKind}" data-import-fidelity="${layer.fidelity}" style="${style}">${layer.html}${children}</div>`;
  };
  return {
    html: artboard.layers.map(flatten).join("\n"),
    css: `[data-import-fidelity] img,[data-import-fidelity] svg{display:block;width:100%;height:100%}`,
    width: artboard.width,
    height: artboard.height,
    name: artboard.name,
  };
}

export function isFigmaDesignUrl(raw: string) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && /^(?:www\.)?figma\.com$/i.test(url.hostname) && /^\/(?:file|design)\/[a-z0-9]+(?:\/|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function parseFigmaDesignUrl(raw: string) {
  if (!isFigmaDesignUrl(raw)) throw new Error("Usa un enlace de archivo o diseño de figma.com.");
  const url = new URL(raw);
  const parts = url.pathname.split("/").filter(Boolean);
  return { fileKey: parts[1], nodeId: url.searchParams.get("node-id")?.replace(/-/g, ":") || undefined };
}
