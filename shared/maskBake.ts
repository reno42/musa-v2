/**
 * Mask baking — turning a closed bezier path into the CSS that masks an image.
 *
 * The rules of the mask mechanism live here because every surface must agree
 * on them: the editor's right-click menu, the MCP tools an agent drives, and
 * the QA suite. The mechanism (see brief F1):
 *
 * - The SOURCE OF TRUTH is the existing closed SVG path (svg > path[d]),
 *   tagged `data-mask-for="<imgLayerId>"` + `data-mask-mode="include|exclude"`.
 *   It stays fully editable; every edit re-bakes the CSS below.
 * - Application is non-destructive CSS on the image layer's own rule, never
 *   url(#id) references (they do not survive Shadow DOM / foreignObject /
 *   cheerio):
 *     · include, no brushes → `clip-path: path("evenodd, …")` (Chrome ≥123)
 *     · anything inverted or brushed → `mask-image: url("data:image/svg+xml;base64,…")`
 *       self-contained: base rect + subject path + brush strokes.
 *
 * Pure functions in, values out — no DOM, no I/O (see shared/README.md).
 */

export type MaskMode = "include" | "exclude";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** One brush dab trail, in IMAGE-LOCAL coordinates. erase paints black
 * (subtract), restore paints white (un-subtract). */
export interface BrushStroke {
  points: Array<{ x: number; y: number }>;
  size: number;
  mode: "erase" | "restore";
}

/** Every CSS property a previous bake may have written; cleared before each
 * new bake so switching clip ↔ mask never leaves a stale declaration behind. */
export const MASK_CSS_PROPERTIES: readonly string[] = [
  "clip-path",
  "mask-image",
  "-webkit-mask-image",
  "mask-size",
  "-webkit-mask-size",
  "mask-repeat",
  "-webkit-mask-repeat",
];

/** How the source path is visualized once it becomes a selection: a dashed
 * blue outline, fill off, so the subject stays visible through it. */
export const SELECTION_OUTLINE: Readonly<Record<string, string>> = {
  fill: "none",
  stroke: "#3B82F6",
  "stroke-width": "1.5",
  "stroke-dasharray": "5 4",
};

/** Brush-only masks (the eraser's auto full-rect) have no subject shape to
 * show — painting the dashed outline on them just leaves a blue rectangle
 * floating over the image. Their source path stays in the DOM (re-bakes
 * need its geometry) but renders nothing. */
export const BRUSH_ONLY_OUTLINE: Readonly<Record<string, string>> = {
  fill: "none",
  stroke: "none",
};

/** Marks a mask source path as brush-only (`data-mask-brush-only="true"`).
 * Set when the eraser auto-creates the full-rect mask; cleared when a real
 * subject path (Varita/F1) takes the mask over. */
export const BRUSH_ONLY_ATTR = "data-mask-brush-only";

// ── Path data transform ──────────────────────────────────────────

const COMMAND_LETTERS = "MmLlHhVvCcSsQqTtAaZz";
const SEGMENT_RE = new RegExp(`([${COMMAND_LETTERS}])([^${COMMAND_LETTERS}]*)`, "g");
const NUMBER_RE = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;

function fmt(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/**
 * Scale + translate path data. Absolute coordinates become
 * `v * s + d`; relative deltas only scale (the offset arrives with each
 * implicit current point). Arc radii scale per-axis — exact only under
 * uniform scale, which is the only scale this app's layers see.
 */
export function transformPathData(
  d: string,
  t: { sx: number; sy: number; dx: number; dy: number },
): string {
  const out: string[] = [];
  const tx = (x: number) => x * t.sx + t.dx;
  const ty = (y: number) => y * t.sy + t.dy;
  const sx = (x: number) => x * t.sx;
  const sy = (y: number) => y * t.sy;

  let match: RegExpExecArray | null;
  SEGMENT_RE.lastIndex = 0;
  while ((match = SEGMENT_RE.exec(d)) !== null) {
    const command = match[1];
    if (command === "Z" || command === "z") {
      out.push(command);
      continue;
    }
    const nums = (match[2].match(NUMBER_RE) || []).map(Number);
    const upper = command.toUpperCase();
    const absolute = command === upper;
    const X = absolute ? tx : sx;
    const Y = absolute ? ty : sy;

    if (upper === "H" || upper === "V") {
      out.push(command + nums.map(n => fmt(upper === "H" ? X(n) : Y(n))).join(" "));
      continue;
    }
    if (upper === "A") {
      const parts: string[] = [];
      for (let i = 0; i + 6 < nums.length + 1; i += 7) {
        const rx = nums[i], ry = nums[i + 1], rot = nums[i + 2], laf = nums[i + 3], sf = nums[i + 4];
        const x = nums[i + 5], y = nums[i + 6];
        // An incomplete trailing tuple (malformed arc flags without
        // separators) is passed through untouched rather than guessed at.
        if (![rx, ry, rot, laf, sf, x, y].every(Number.isFinite)) break;
        parts.push(`${fmt(sx(rx))} ${fmt(sy(ry))} ${fmt(rot)} ${fmt(laf)} ${fmt(sf)} ${fmt(X(x))} ${fmt(Y(y))}`);
      }
      out.push(command + parts.join(" "));
      continue;
    }

    // Remaining commands are (x,y)-pair based: ML 1 pair, STQ 2, C 3.
    const pairsPerCommand = upper === "C" ? 3 : upper === "S" || upper === "Q" ? 2 : 1;
    const flat: number[] = [];
    for (const n of nums) flat.push(Number.isFinite(n) ? n : 0);
    const parts: string[] = [];
    let first = true;
    for (let i = 0; i + 1 < flat.length; i += 2 * pairsPerCommand) {
      const chunk = flat.slice(i, i + 2 * pairsPerCommand);
      // M/m with extra pairs: SVG reads subsequent pairs as L/l, not new
      // subpaths — re-emitting them as M would punch fill holes.
      let letter = command;
      if (upper === "M" && !first) letter = absolute ? "L" : "l";
      first = false;
      const transformed: string[] = [];
      for (let p = 0; p + 1 < chunk.length; p += 2) {
        transformed.push(fmt(X(chunk[p])), fmt(Y(chunk[p + 1])));
      }
      parts.push(letter + transformed.join(" "));
    }
    out.push(parts.join(" "));
  }
  return out.join(" ");
}

/**
 * Bounding box of a path in its own coordinate space, measured over anchor
 * AND control points — a superset of the true curve extent, which is exactly
 * right for placing a viewBox around it (never clips the curve).
 */
export function pathDataBounds(d: string): Box | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let curX = 0, curY = 0, startX = 0, startY = 0;
  const consider = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  let match: RegExpExecArray | null;
  SEGMENT_RE.lastIndex = 0;
  while ((match = SEGMENT_RE.exec(d)) !== null) {
    const command = match[1];
    if (command === "Z" || command === "z") {
      curX = startX; curY = startY;
      continue;
    }
    const nums = (match[2].match(NUMBER_RE) || []).map(Number);
    const upper = command.toUpperCase();
    const absolute = command === upper;
    let i = 0;
    if (upper === "H" || upper === "V") {
      for (const n of nums) {
        if (upper === "H") curX = absolute ? n : curX + n;
        else curY = absolute ? n : curY + n;
        consider(curX, curY);
      }
      continue;
    }
    if (upper === "A") {
      for (; i + 6 < nums.length + 1; i += 7) {
        const x = nums[i + 5], y = nums[i + 6];
        curX = absolute ? x : curX + x;
        curY = absolute ? y : curY + y;
        consider(curX, curY);
      }
      continue;
    }
    const pairsPerCommand = upper === "C" ? 3 : upper === "S" || upper === "Q" ? 2 : 1;
    for (; i + 1 < nums.length; i += 2) {
      const x = absolute ? nums[i] : curX + nums[i];
      const y = absolute ? nums[i + 1] : curY + nums[i + 1];
      consider(x, y);
      // The LAST pair of each command group is the new current point;
      // control pairs only widen the bounds.
      if ((i / 2 + 1) % pairsPerCommand === 0) { curX = x; curY = y; }
      if (upper === "M" && i === 0) { startX = x; startY = y; }
    }
  }
  if (minX === Infinity || minY === Infinity) return null;
  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

// ── Geometry readers (string in, box out) ────────────────────────

/** `"x y w h"` → Box, or null when absent/unparseable. */
export function readViewBox(attr: string | null | undefined): Box | null {
  if (!attr) return null;
  const nums = (attr.match(NUMBER_RE) || []).map(Number);
  if (nums.length < 4 || nums.some(n => !Number.isFinite(n))) return null;
  return { left: nums[0], top: nums[1], width: nums[2], height: nums[3] };
}

function pxValue(styleAttr: string | null | undefined, ruleBlock: string, property: string): number | null {
  if (styleAttr) {
    const inline = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)px`, "i").exec(styleAttr);
    if (inline) return parseFloat(inline[1]);
  }
  if (ruleBlock) {
    const inRule = new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)px`, "i").exec(ruleBlock);
    if (inRule) return parseFloat(inRule[1]);
  }
  return null;
}

/** `translate: 12px 3px` (or a single value), or the equivalent function
 * inside `transform: translate(…)`, → its px pair. Moves committed by the
 * editor land as left/top (absolute layers), the translate property
 * (flow-preserving drags) or a transform function (panel edits) — a layer's
 * REAL frame box only follows the move when all of them are read. */
function readTranslate(styleAttr: string | null | undefined, ruleBlock: string): { x: number; y: number } {
  const source = styleAttr && /translate\s*:/i.test(styleAttr) ? styleAttr : ruleBlock;
  const text = source || "";
  let match = /(?:^|[;\s])translate\s*:\s*(-?\d+(?:\.\d+)?)px(?:\s+(-?\d+(?:\.\d+)?)px)?/i.exec(text);
  if (!match) match = /transform\s*:\s*[^;]*?translate\(\s*(-?\d+(?:\.\d+)?)px(?:\s*,\s*(-?\d+(?:\.\d+)?)px)?/i.exec(text);
  if (!match) return { x: 0, y: 0 };
  const x = parseFloat(match[1]);
  const y = match[2] !== undefined ? parseFloat(match[2]) : x;
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
}

/**
 * A layer's frame-space box from its inline style attribute and its
 * `[data-layer-id]` CSS rule (inline wins, as in the cascade). Layers in
 * this editor are absolutely positioned in px, so anything else (percent,
 * auto) reads as "no box" and the caller decides what that means.
 */
export function readLayerBox(
  styleAttr: string | null | undefined,
  css: string,
  layerId: string,
): Box | null {
  const escaped = `[data-layer-id="${layerId}"]`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css || "");
  const block = rule ? rule[1] : "";
  const left = pxValue(styleAttr, block, "left");
  const top = pxValue(styleAttr, block, "top");
  const width = pxValue(styleAttr, block, "width");
  const height = pxValue(styleAttr, block, "height");
  if (left === null || top === null || width === null || height === null) return null;
  // Fold a committed translate into the origin so the box is where the layer
  // actually renders — otherwise every bake after a flow-preserving move
  // computes its mask against the pre-move position.
  const t = readTranslate(styleAttr, block);
  return { left: left + t.x, top: top + t.y, width, height };
}

// ── Brush strokes (stored as data-mask-brushes on the img) ───────

export function parseBrushesAttr(value: string | null | undefined): BrushStroke[] {
  if (!value) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const strokes: BrushStroke[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw as Partial<BrushStroke>;
    if (!Array.isArray(candidate.points)) continue;
    const points = candidate.points
      .filter((p): p is { x: number; y: number } =>
        Boolean(p) && typeof (p as { x?: unknown }).x === "number" && typeof (p as { y?: unknown }).y === "number")
      .map(p => ({ x: p.x, y: p.y }));
    if (points.length === 0) continue;
    strokes.push({
      points,
      size: Math.max(1, Number(candidate.size) || 12),
      mode: candidate.mode === "restore" ? "restore" : "erase",
    });
  }
  return strokes;
}

export function serializeBrushesAttr(strokes: BrushStroke[]): string {
  return JSON.stringify(strokes.map(s => ({ points: s.points, size: s.size, mode: s.mode })));
}

// ── The bake itself ──────────────────────────────────────────────

export interface MaskBakeArgs {
  /** d of the closed subject path, in ITS OWN svg coordinate space. */
  pathData: string;
  /** The svg layer's rendered box in frame space. */
  pathBox: Box;
  /** The svg's viewBox, or null when the path data is already frame coords. */
  viewBox: Box | null;
  /** The image layer's box in frame space. */
  imageBox: Box;
  mode: MaskMode;
  /** Brush strokes in image-local coordinates (already stored on the img). */
  brushes?: BrushStroke[];
}

export interface MaskBakeResult {
  property: "clip-path" | "mask-image";
  value: string;
  /** Extra declarations the property needs (mask-size, mask-repeat). */
  companions: Record<string, string>;
  /** The translated path in image-local coordinates — reused by the fill layer. */
  localPathData: string;
}

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** UTF-8 → base64 without btoa/Buffer, so the same code runs in the browser
 * bundle, the api server and the esbuild-packaged function. */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    out += B64_ALPHABET[((b1 & 15) << 2) | (b2 >> 6)];
    out += i + 2 < bytes.length ? B64_ALPHABET[b2 & 63] : "=";
  }
  return out;
}

/**
 * Bakes the mask declaration for an image layer from the geometry of the
 * path layer that targets it:
 *
 *   framePoint = (pathPoint - viewBoxOrigin) * scale + svgTopleft
 *   localPoint = framePoint - imageTopleft
 *
 * Returns null when the inputs cannot describe a mask (empty path data,
 * zero-sized viewBox or image). Include-mode without brushes uses the
 * lightweight clip-path; everything else builds the self-contained SVG
 * mask document: base rect (all-visible for exclude, all-hidden for
 * include) → subject path in the opposite colour → brush strokes in
 * order (erase = black, restore = white).
 */
export function bakePathMask(args: MaskBakeArgs): MaskBakeResult | null {
  if (!args.pathData.trim()) return null;
  const vb = args.viewBox;
  // A degenerate viewBox (zero size) divides to ±Infinity/NaN and is caught
  // by the finite check below — a mask from it would be garbage, so it bakes
  // nothing rather than something wrong.
  const sx = vb ? args.pathBox.width / vb.width : 1;
  const sy = vb ? args.pathBox.height / vb.height : 1;
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || Math.abs(sx) < 1e-6 || Math.abs(sy) < 1e-6) return null;
  // With a viewBox: frame = (p - vbOrigin) * scale + svgTopleft.
  // Without one the d is already in frame coordinates — only the image
  // origin is subtracted.
  const dx = vb ? args.pathBox.left - vb.left * sx - args.imageBox.left : -args.imageBox.left;
  const dy = vb ? args.pathBox.top - vb.top * sy - args.imageBox.top : -args.imageBox.top;
  const localPathData = transformPathData(args.pathData, { sx, sy, dx, dy });

  const brushes = args.brushes || [];
  if (args.mode === "include" && brushes.length === 0) {
    return {
      property: "clip-path",
      value: `path("evenodd, ${localPathData}")`,
      companions: {},
      localPathData,
    };
  }

  const w = Math.max(1, Math.round(args.imageBox.width));
  const h = Math.max(1, Math.round(args.imageBox.height));
  const base = args.mode === "include" ? "#000000" : "#ffffff";
  const subject = args.mode === "include" ? "#ffffff" : "#000000";

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  svg += `<rect x="0" y="0" width="${w}" height="${h}" fill="${base}"/>`;
  svg += `<path d="${localPathData}" fill="${subject}" fill-rule="evenodd"/>`;
  for (const stroke of brushes) {
    const color = stroke.mode === "restore" ? "#ffffff" : "#000000";
    const d = `M ${stroke.points.map(p => `${fmt(p.x)} ${fmt(p.y)}`).join(" L ")}`;
    svg += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${fmt(stroke.size)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  svg += `</svg>`;

  return {
    property: "mask-image",
    value: `url("data:image/svg+xml;base64,${toBase64(svg)}")`,
    companions: {
      "mask-size": "100% 100%",
      "mask-repeat": "no-repeat",
    },
    localPathData,
  };
}
