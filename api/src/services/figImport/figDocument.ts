/**
 * Maps the decoded Figma node graph onto the canonical Futuraria import
 * document: every frame becomes an artboard and every object its own editable
 * layer (text, vector primitives, images, groups) — never a flat SVG blob.
 *
 * The Kiwi schema embedded in each .fig changes between Figma versions, so
 * every field access goes through defensive candidate lists and unknown
 * structures degrade to fallback layers with explicit warnings.
 */
import {
  escapeImportHtml,
  finalizeImportDocument,
  importFontCssValue,
  safeImportId,
  sanitizeImportedSvg,
  type DesignImportArtboard,
  type DesignImportDocument,
  type DesignImportLayer,
  type DesignImportWarning,
} from "../../../../shared/designImport.ts";
import { SYSTEM_FONTS } from "../../data/systemFonts.ts";
import { decodeFigMessage, type FigSchema } from "./figKiwi.ts";

const FRAME_LIKE = new Set(["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE", "CARD"]);
const MAX_LAYERS_PER_ARTBOARD = 2000;
const MAX_WARNINGS = 50;
const MAX_ARTBOARDS = 120;

type Any = Record<string, any>;

/** First present, non-null value among candidate field names. */
function pick<T = Any>(node: Any | undefined | null, candidates: string[]): T | undefined {
  if (!node) return undefined;
  for (const name of candidates) {
    const value = node[name];
    if (value !== undefined && value !== null) return value as T;
  }
  return undefined;
}

function pickPath<T = Any>(node: Any | undefined | null, paths: string[][]): T | undefined {
  for (const path of paths) {
    let current: any = node;
    let ok = true;
    for (const key of path) {
      if (current === undefined || current === null) { ok = false; break; }
      current = current[key];
    }
    if (ok && current !== undefined && current !== null) return current as T;
  }
  return undefined;
}

interface FigNode {
  guid: string;
  parentGuid?: string;
  childGuids: string[];
  raw: Any;
  typeName: string;
  matrix: number[];
  abs: number[];
  width: number;
  height: number;
}

function guidKey(value: any): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const sessionId = value.sessionId ?? value.sessionID;
  const localId = value.localId ?? value.localID;
  if (sessionId === undefined || localId === undefined) return undefined;
  return `${sessionId}:${localId}`;
}

/** relativeTransform arrives as float[6], float[2][3] or an object of parts. */
function flattenMatrix(value: any): number[] {
  if (Array.isArray(value)) {
    const flat = value.flat(2).map(Number);
    if (flat.length >= 6 && flat.every(Number.isFinite)) return flat.slice(0, 6);
  }
  if (value && typeof value === "object") {
    const named = [value.a ?? value.xx, value.b ?? value.xy, value.c ?? value.x0 ?? value.tx, value.d ?? value.yx, value.e ?? value.yy ?? value.ty, value.f ?? value.y0].map(Number);
    if (named.length === 6 && named.every(Number.isFinite)) return named;
  }
  return [1, 0, 0, 0, 1, 0];
}

/** Row-major affine multiply for flattened [a,c,tx,b,d,ty] matrices. */
function multiply(m: number[], n: number[]): number[] {
  return [
    m[0] * n[0] + m[1] * n[3],
    m[0] * n[1] + m[1] * n[4],
    m[0] * n[2] + m[1] * n[5] + m[2],
    m[3] * n[0] + m[4] * n[3],
    m[3] * n[1] + m[4] * n[4],
    m[3] * n[2] + m[4] * n[5] + m[5],
  ];
}

function rgba(color: any, opacity = 1): string {
  if (!color || typeof color !== "object") return "transparent";
  const alpha = Number(color.a ?? 1) * opacity;
  return `rgba(${Math.round(Number(color.r || 0) * 255)},${Math.round(Number(color.g || 0) * 255)},${Math.round(Number(color.b || 0) * 255)},${Math.max(0, Math.min(1, alpha))})`;
}

function visiblePaints(paints: any): any[] {
  return (Array.isArray(paints) ? paints : []).filter(paint => paint && typeof paint === "object" && paint.visible !== false && Number(paint.opacity ?? 1) > 0);
}

function paintCss(paint: any): string {
  if (!paint) return "transparent";
  const type = String(paint.type || "SOLID").toUpperCase();
  if (type === "SOLID") return rgba(paint.color, Number(paint.opacity ?? 1));
  if (type.includes("GRADIENT")) {
    const stops = (Array.isArray(paint.gradientStops) ? paint.gradientStops : [])
      .map((stop: Any) => `${rgba(stop?.color)} ${Math.round(Number(stop?.position || 0) * 100)}%`).join(",");
    if (!stops) return "transparent";
    if (type === "GRADIENT_LINEAR") {
      const handles = Array.isArray(paint.gradientHandlePositions) ? paint.gradientHandlePositions : [];
      const start = handles[0] || { x: 0, y: 0.5 };
      const end = handles[1] || { x: 1, y: 0.5 };
      const angle = Math.round((Math.atan2(end.x - start.x, -(end.y - start.y)) * 180) / Math.PI);
      return `linear-gradient(${angle}deg,${stops})`;
    }
    return `radial-gradient(circle,${stops})`;
  }
  return "transparent";
}

function firstVisibleFill(node: Any): any | undefined {
  return visiblePaints(node.fills)[0];
}

function wrapperStyle(node: Any): string {
  const styles: string[] = [`overflow:${node.clipsContent === false ? "visible" : "hidden"}`, `opacity:${Math.max(0, Math.min(1, Number(node.opacity ?? 1)))}`];
  const matrix = flattenMatrix(pick(node, ["relativeTransform", "transform"]));
  if (matrix.some((value, index) => index < 4 && Math.abs(value - (index % 3 === 2 ? 0 : 1)) > 1e-6)) {
    styles.push(`transform:matrix(${matrix[0]},${matrix[1]},${matrix[2]},${matrix[3]},0,0)`, "transform-origin:0 0");
  }
  for (const effect of (Array.isArray(node.effects) ? node.effects : []) as Any[]) {
    if (!effect || effect.visible === false) continue;
    const type = String(effect.type || "").toUpperCase();
    if (type.includes("DROP_SHADOW") || type.includes("INNER_SHADOW")) {
      const inset = type.includes("INNER") ? "inset " : "";
      styles.push(`box-shadow:${inset}${Number(effect.offset?.x || 0)}px ${Number(effect.offset?.y || 0)}px ${Number(effect.radius || 0)}px ${rgba(effect.color)}`);
    } else if (type.includes("LAYER_BLUR")) styles.push(`filter:blur(${Number(effect.radius || 0)}px)`);
    else if (type.includes("BACKGROUND_BLUR")) styles.push(`backdrop-filter:blur(${Number(effect.radius || 0)}px)`);
  }
  return `${styles.join(";")};`;
}

function cornerRadius(node: Any): number {
  const uniform = Number(node.cornerRadius || 0);
  if (uniform) return uniform;
  const corners = ["rectangleTopLeftRadius", "rectangleTopRightRadius", "rectangleBottomLeftRadius", "rectangleBottomRightRadius"].map(key => Number(node[key] || 0)).filter(Boolean);
  return corners.length ? Math.max(...corners) : 0;
}

interface Context {
  schema: FigSchema;
  warnings: DesignImportWarning[];
  usedFonts: Set<string>;
  warn(layerId: string, message: string): void;
}

/** VectorNetwork → one SVG path expression covering every segment chain. */
function vectorNetworkToSvg(node: Any, ctx: Context, width: number, height: number, network: Any): string | null {
  const vertices = (Array.isArray(network?.vertices) ? network.vertices : []) as Any[];
  const segments = (Array.isArray(network?.segments) ? network.segments : []) as Any[];
  if (!vertices.length || !segments.length) return null;
  const point = (index: any): [number, number] | null => {
    const vertex = vertices[Number(index)];
    if (!vertex) return null;
    return [Number(vertex.x || 0), Number(vertex.y || 0)];
  };
  const control = (segment: Any, candidates: string[]): string | null => {
    for (const name of candidates) {
      if (segment[name] !== undefined && vertices[Number(segment[name])]) {
        const [x, y] = point(segment[name])!;
        return `${x.toFixed(2)} ${y.toFixed(2)}`;
      }
    }
    return null;
  };
  // Chain segments into continuous subpaths so fills render without pen lifts.
  const used = new Array(segments.length).fill(false);
  const outgoing = new Map<number, number[]>();
  segments.forEach((segment, index) => {
    const origin = Number(pick(segment, ["originVertex", "origin", "startVertex"]) ?? -1);
    if (origin >= 0) outgoing.set(origin, [...(outgoing.get(origin) || []), index]);
  });
  const parts: string[] = [];
  for (let index = 0; index < segments.length; index++) {
    if (used[index]) continue;
    let cursor = index;
    let start = point(pick(segments[cursor], ["originVertex", "origin", "startVertex"]));
    if (!start) continue;
    let d = `M${start[0].toFixed(2)} ${start[1].toFixed(2)}`;
    while (cursor !== undefined && cursor >= 0 && !used[cursor]) {
      used[cursor] = true;
      const segment = segments[cursor];
      const from = point(pick(segment, ["originVertex", "origin", "startVertex"]));
      const to = point(pick(segment, ["endVertex", "targetVertex", "end"]));
      if (!from || !to) break;
      const c1 = control(segment, ["cubicStartVertex", "startControl", "cubicOrigin"]);
      const c2 = control(segment, ["cubicEndVertex", "endControl", "cubicEnd"]);
      d += c1 && c2 ? `C${c1} ${c2} ${to[0].toFixed(2)} ${to[1].toFixed(2)}` : `L${to[0].toFixed(2)} ${to[1].toFixed(2)}`;
      const endVertex = Number(pick(segment, ["endVertex", "targetVertex", "end"]) ?? -1);
      cursor = (outgoing.get(endVertex) || []).find(candidate => !used[candidate]) ?? -1;
    }
    parts.push(d);
  }
  if (!parts.length) return null;
  const fill = firstVisibleFill(node);
  const stroke = visiblePaints(node.strokes)[0];
  const strokeWeight = Number(node.strokeWeight || 0);
  const d = parts.join("");
  // Presentation attributes only: the shared SVG sanitizer whitelists a
  // narrow set of style properties and rejects width/height/overflow.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.max(1, width)} ${Math.max(1, height)}" width="100%" height="100%" preserveAspectRatio="none" fill="${escapeImportHtml(paintCss(fill))}" fill-rule="nonzero" stroke="${stroke ? escapeImportHtml(paintCss(stroke)) : "none"}" stroke-width="${strokeWeight}"><path d="${escapeImportHtml(d)}"/></svg>`;
  return sanitizeImportedSvg(svg);
}

function placeholderSvg(label: string): string {
  return sanitizeImportedSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="100%" height="100%" preserveAspectRatio="none"><rect width="200" height="200" fill="#ececf1" stroke="#c9c9d4" stroke-width="2" stroke-dasharray="6 5"/><text x="100" y="104" font-family="system-ui" font-size="14" fill="#6b6b7b" text-anchor="middle">${escapeImportHtml(label)}</text></svg>`);
}

/** VECTOR/STAR/POLYGON/BOOLEAN_OPERATION geometry via its vector network. */
function vectorLayer(node: Any, ctx: Context, id: string, width: number, height: number): DesignImportLayer {
  const network = pickPath<Any>(node, [
    ["vectorNetwork"],
    ["vectorNetworkData", "vectorNetwork"],
    ["vectorData", "vectorNetwork"],
  ]);
  let html: string | null = null;
  if (network) {
    try { html = vectorNetworkToSvg(node, ctx, width, height, network); } catch { html = null; }
  }
  const blobIndex = pick<number>(node, ["vectorNetworkBlob", "vectorDataBlobIndex"]);
  if (!html && blobIndex !== undefined) {
    // Blob-backed networks need the root blobs table; surface why it is skipped.
    ctx.warn(id, `${node.name || id} guarda su geometría en un blob binario que esta versión no decodifica; se colocó un marcador editable.`);
  }
  if (!html) html = placeholderSvg(String(node.name || "vector"));
  return { id, name: String(node.name || "Vector"), kind: "vector", x: 0, y: 0, width, height, fidelity: network ? "editable" : "approximate", style: wrapperStyle(node), html };
}

function textStyleCss(style: Any, color: string): string {
  const family = String(style?.fontFamily || "sans-serif");
  return `font-family:${importFontCssValue(family)};font-size:${Number(style?.fontSize || 16)}px;font-weight:${Number(style?.fontWeight || 400)};font-style:${style?.italic ? "italic" : "normal"};line-height:${Number(style?.lineHeightPx || style?.fontSize || 16)}px;letter-spacing:${Number(style?.letterSpacing || 0)}px;color:${color}`;
}

function textLayer(node: Any, ctx: Context, id: string, width: number, height: number): DesignImportLayer {
  const textData = (node.textData && typeof node.textData === "object" ? node.textData : {}) as Any;
  const characters = String(pick(node, ["characters"]) ?? textData.characters ?? "");
  const base = (pick<Any>(node, ["style"]) ?? textData.style ?? {}) as Any;
  const overrides = Array.isArray(node.characterStyleOverrides) ? node.characterStyleOverrides.map(Number) : Array.isArray(textData.characterStyleOverrides) ? textData.characterStyleOverrides.map(Number) : [];
  let table = node.styleOverrideTable || textData.styleOverrideTable || {};
  if (!Array.isArray(table) && typeof table === "object") table = Object.values(table);
  const color = paintCss(firstVisibleFill(node));
  const families = new Set<string>();
  let html = "";
  for (let start = 0; start < characters.length;) {
    const override = overrides[start] || 0;
    let end = start + 1;
    while (end < characters.length && (overrides[end] || 0) === override) end++;
    const run = { ...base, ...((table as Any[])[override] || {}) } as Any;
    const family = String(run.fontFamily || base.fontFamily || "sans-serif");
    families.add(family);
    html += `<span data-figma-font="${escapeImportHtml(family)}" style="${textStyleCss(run, paintCss(firstVisibleFill({ fills: run.fills }) || firstVisibleFill(node)))}">${escapeImportHtml(characters.slice(start, end))}</span>`;
    start = end;
  }
  if (!characters) html = "<span></span>";
  families.forEach(family => ctx.usedFonts.add(family));
  const align = String(node.textAlignHorizontal || base.textAlignHorizontal || "LEFT").toLowerCase();
  return {
    id,
    name: String(node.name || "Text"),
    kind: "text",
    x: 0, y: 0, width, height,
    fidelity: "editable",
    style: wrapperStyle(node),
    fontFamilies: [...families],
    html: `<div contenteditable="true" style="width:100%;height:100%;white-space:pre-wrap;text-align:${align}">${html}</div>`,
  };
}

function imageLayer(node: Any, ctx: Context, id: string, width: number, height: number): DesignImportLayer {
  const fills = Array.isArray(node.fills) ? node.fills : [];
  const imageRef = String(pick(node, ["imageRef"]) ?? (fills[0] && typeof fills[0] === "object" ? fills[0].imageRef : undefined) ?? "imagen");
  ctx.warn(id, `${node.name || id} usa una imagen (${imageRef.slice(0, 24)}…) cuyos píxeles no viajan dentro del .fig; se colocó un marcador reemplazable.`);
  return { id, name: String(node.name || "Image"), kind: "image", x: 0, y: 0, width, height, fidelity: "raster", style: wrapperStyle(node), html: placeholderSvg("imagen") };
}

function shapeLayer(node: Any, type: string, id: string, width: number, height: number): DesignImportLayer | null {
  const fill = paintCss(firstVisibleFill(node));
  const stroke = visiblePaints(node.strokes)[0];
  const strokeWeight = Number(node.strokeWeight || 0);
  let shape = "";
  if (type === "RECTANGLE") shape = `<rect width="100%" height="100%" rx="${cornerRadius(node)}"/>`;
  else if (type === "ELLIPSE") shape = `<ellipse cx="50%" cy="50%" rx="50%" ry="50%"/>`;
  else if (type === "LINE") shape = `<line x1="0" y1="0" x2="${Math.max(1, width)}" y2="0"/>`;
  else return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.max(1, width)} ${Math.max(1, height)}" width="100%" height="100%" preserveAspectRatio="none" fill="${escapeImportHtml(fill)}" stroke="${stroke ? escapeImportHtml(paintCss(stroke)) : "none"}" stroke-width="${strokeWeight}">${shape}</svg>`;
  return { id, name: String(node.name || type), kind: "vector", x: 0, y: 0, width, height, fidelity: "editable", style: wrapperStyle(node), html: sanitizeImportedSvg(svg) };
}

function buildLayer(node: FigNode, byGuid: Map<string, FigNode>, ctx: Context, origin: number[], depth: number, budget: { layers: number }): DesignImportLayer | null {
  const raw = node.raw;
  if (raw.visible === false || raw.visible === 0) return null;
  const id = `fig-${safeImportId(String(raw.name || node.guid), node.guid.replace(/[^a-z0-9_-]/gi, "-"))}`;
  const width = Math.max(1, node.width);
  const height = Math.max(1, node.height);
  // Local position relative to the artboard origin, ignoring artboard rotation.
  // Flattened matrices are [a,c,tx,b,d,ty]: translation lives at 2 and 5.
  const localX = node.abs[2] - origin[0];
  const localY = node.abs[5] - origin[1];
  const place = (layer: DesignImportLayer): DesignImportLayer => ({ ...layer, x: Math.round(localX * 100) / 100, y: Math.round(localY * 100) / 100 });
  const type = node.typeName;

  const isContainer = Boolean(node.childGuids.length) || type === "GROUP" || FRAME_LIKE.has(type);
  if (!isContainer || type === "TEXT") {
    if (type === "TEXT") return place(textLayer(raw, ctx, id, width, height));
    const shape = shapeLayer(raw, type, id, width, height);
    if (shape) return place(shape);
    if (["VECTOR", "STAR", "REGULAR_POLYGON", "BOOLEAN_OPERATION", "LINE"].includes(type) || !type) {
      if (budget.layers >= MAX_LAYERS_PER_ARTBOARD) return null;
      return place(vectorLayer(raw, ctx, id, width, height));
    }
  }
  if (budget.layers >= MAX_LAYERS_PER_ARTBOARD) return null;
  const children: DesignImportLayer[] = [];
  for (const childGuid of node.childGuids) {
    const child = byGuid.get(childGuid);
    if (!child) continue;
    budget.layers += 1;
    const layer = buildLayer(child, byGuid, ctx, origin, depth + 1, budget);
    if (layer) children.unshift(layer); // Kiwi children render bottom-up like Figma.
  }
  const background = paintCss(firstVisibleFill(raw));
  return place({
    id,
    name: String(raw.name || type || "Group"),
    kind: "group",
    x: 0, y: 0, width, height,
    fidelity: children.every(child => child.fidelity === "editable") ? "editable" : "approximate",
    style: `${wrapperStyle(raw)}background:${background !== "transparent" ? background : "transparent"};`,
    html: "",
    children,
  });
}

export interface BuildFigDocumentOptions {
  name: string;
}

/** Reconstruct the node tree and convert it to the canonical import document. */
export function buildFigDocument(schema: FigSchema, data: Buffer, options: BuildFigDocumentOptions): DesignImportDocument {
  const rootTypeName = [...schema.definitions.keys()].find(name => /^NodeChanges$/i.test(name))
    || [...schema.definitions.keys()].find(name => /nodechanges/i.test(name));
  if (!rootTypeName) throw new Error("El archivo no contiene cambios de nodos de Figma.");
  const root = decodeFigMessage(schema, rootTypeName, data) as Any;
  const changes = (pick<Any[]>(root, ["nodeChanges"]) || []) as Any[];
  if (!changes.length) throw new Error("El archivo no contiene nodos convertibles.");

  const ctx: Context = {
    schema,
    warnings: [],
    usedFonts: new Set<string>(),
    warn(layerId: string, message: string) {
      if (ctx.warnings.length < MAX_WARNINGS) ctx.warnings.push({ code: "fig_layer", layerId, message });
    },
  };

  const byGuid = new Map<string, FigNode>();
  for (const raw of changes) {
    const guid = guidKey(pick(raw, ["guid"]));
    if (!guid) continue;
    const typeName = String(pick(raw, ["type"]) || "");
    byGuid.set(guid, {
      guid,
      parentGuid: guidKey(pick(raw, ["parentIndex", "guidParent", "parent", "parentGuid"])),
      childGuids: ((pick<Any[]>(raw, ["children"]) || []) as Any[]).map(guidKey).filter(Boolean) as string[],
      raw,
      typeName,
      matrix: flattenMatrix(pick(raw, ["relativeTransform", "transform"])),
      abs: [1, 0, 0, 0, 1, 0],
      width: Number(pickPath(raw, [["size", "x"], ["width"]]) ?? 0),
      height: Number(pickPath(raw, [["size", "y"], ["height"]]) ?? 0),
    });
  }
  // Figma's NodeChanges carry no nested children: the tree comes from
  // parentIndex links, so derive missing child lists from them.
  for (const node of byGuid.values()) {
    if (!node.parentGuid || !byGuid.has(node.parentGuid)) continue;
    const parent = byGuid.get(node.parentGuid)!;
    if (!parent.childGuids.includes(node.guid)) parent.childGuids.push(node.guid);
  }

  // Absolute matrices from the tree roots (document → canvas → …).
  const roots = [...byGuid.values()].filter(node => !node.parentGuid || !byGuid.has(node.parentGuid));
  const applyAbs = (node: FigNode, parentAbs: number[]) => {
    node.abs = multiply(parentAbs, node.matrix);
    for (const childGuid of node.childGuids) {
      const child = byGuid.get(childGuid);
      if (child) applyAbs(child, node.abs);
    }
  };
  roots.forEach(node => applyAbs(node, [1, 0, 0, 0, 1, 0]));

  // Artboards = frame-like nodes whose ancestors contain no other frame.
  const artboardNodes: FigNode[] = [];
  const visit = (node: FigNode, insideFrame: boolean) => {
    const isFrame = FRAME_LIKE.has(node.typeName);
    if (isFrame && !insideFrame) artboardNodes.push(node);
    for (const childGuid of node.childGuids) {
      const child = byGuid.get(childGuid);
      if (child) visit(child, insideFrame || isFrame);
    }
  };
  roots.filter(node => ["CANVAS", "DOCUMENT"].includes(node.typeName) || FRAME_LIKE.has(node.typeName) || !node.parentGuid)
    .forEach(node => visit(node, false));

  if (!artboardNodes.length) throw new Error("El archivo no contiene frames importables.");
  const selected = artboardNodes.slice(0, MAX_ARTBOARDS);
  if (artboardNodes.length > MAX_ARTBOARDS) ctx.warnings.push({ code: "fig_truncated", message: `Solo se importaron los primeros ${MAX_ARTBOARDS} frames del archivo.` });

  const artboards: DesignImportArtboard[] = selected.map(node => {
    const width = Math.max(1, Math.round(node.width || 1080));
    const height = Math.max(1, Math.round(node.height || 1080));
    const origin = [node.abs[2], node.abs[5]];
    const budget = { layers: 0 };
    const layers: DesignImportLayer[] = [];
    for (const childGuid of node.childGuids) {
      const child = byGuid.get(childGuid);
      if (!child) continue;
      budget.layers += 1;
      const layer = buildLayer(child, byGuid, ctx, origin, 1, budget);
      if (layer) layers.unshift(layer);
    }
    const background = paintCss(firstVisibleFill(node.raw) || pick(node.raw, ["backgroundColor"]) && { type: "SOLID", color: pick(node.raw, ["backgroundColor"]) });
    return {
      id: `fig-artboard-${safeImportId(String(node.raw.name || node.guid), node.guid.replace(/[^a-z0-9_-]/gi, "-"))}`,
      name: String(node.raw.name || "Figma frame"),
      width,
      height,
      background: background !== "transparent" ? background : "#ffffff",
      layers,
    };
  });

  const used = [...ctx.usedFonts].filter(family => family && family !== "sans-serif");
  const available = new Set(SYSTEM_FONTS.map(font => font.family.toLowerCase()));
  const missing = used.filter(family => !available.has(family.toLowerCase()));
  return finalizeImportDocument({
    version: "futuraria-import/v1",
    name: options.name,
    source: "fig",
    artboards,
    warnings: ctx.warnings,
    report: { editable: 0, approximate: 0, raster: 0 },
    fonts: { used, missing },
  });
}
