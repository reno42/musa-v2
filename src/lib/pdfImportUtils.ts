/**
 * Pure helpers for the editable PDF/Illustrator import (pdfImport.ts).
 * Zero DOM, zero pdf.js: every function here runs under Node's type-stripping
 * test runner (QA/pdf-design-import.test.mjs), so keep the module free of
 * enums, namespaces and value imports.
 */

// ── Matrices (PDF cm/Tm layout: [a, b, c, d, e, f]) ─────────────────────

export type Matrix = number[];

/** Compose two affine matrices: applyMatrix(mul(m, n), p) === applyMatrix(m, applyMatrix(n, p)). */
export function mulMatrix(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function matrixScale(m: Matrix): { x: number; y: number } {
  return { x: Math.hypot(m[0], m[1]), y: Math.hypot(m[2], m[3]) };
}

/** True when the matrix only scales/translates (no rotation or shear). */
export function isAxisAligned(m: Matrix, tolerance = 1e-3): boolean {
  return Math.abs(m[1]) <= tolerance && Math.abs(m[2]) <= tolerance;
}

// ── Colors ──────────────────────────────────────────────────────────────

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  return `#${[r, g, b].map(value => clamp(value).toString(16).padStart(2, "0")).join("")}`;
}

export function grayToHex(value: number): string {
  return rgbToHex(value * 255, value * 255, value * 255);
}

/** PDF /k operator: values in 0-1. */
export function cmykToHex(c: number, m: number, y: number, k: number): string {
  return rgbToHex(255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k));
}

// ── Paths ───────────────────────────────────────────────────────────────

/** pdf.js v6 fused path-buffer codes (DrawOPS inside the worker bundle). */
export const DRAW_OPS = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 } as const;

export interface BuiltPath {
  d: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Exact [M L L L Z] rectangle in device space — enables clip-path insets. */
  rect: { x: number; y: number; width: number; height: number } | null;
}

const fmt = (value: number) => {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
};

/**
 * Decode a pdf.js v6 fused constructPath buffer (DrawOPS codes interleaved
 * with floats, PDF user space, y-up) into an SVG path mapped through `matrix`
 * into device (CSS) space — the same composition the renderer's canvas
 * transform performs. Detects the rectangle shape the evaluator emits for
 * `re` so callers can use cheap clip-path insets instead of masks.
 */
export function buildPathBuffer(buffer: ArrayLike<number>, matrix: Matrix): BuiltPath | null {
  if (!buffer || typeof buffer.length !== "number") return null;
  const parts: string[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let cursorX = 0, cursorY = 0;
  let commands = 0;
  let candidate: { moveX: number; moveY: number; lines: Array<[number, number]> } | null = null;
  const track = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  const point = (x: number, y: number): [number, number] => applyMatrix(matrix, x, y);
  let offset = 0;
  while (offset < buffer.length) {
    const code = buffer[offset++];
    if (code === DRAW_OPS.moveTo) {
      if (!Number.isFinite(buffer[offset]) || !Number.isFinite(buffer[offset + 1])) return null;
      [cursorX, cursorY] = point(buffer[offset], buffer[offset + 1]); offset += 2;
      parts.push(`M${fmt(cursorX)} ${fmt(cursorY)}`);
      track(cursorX, cursorY);
      commands = 1;
      candidate = { moveX: cursorX, moveY: cursorY, lines: [] };
    } else if (code === DRAW_OPS.lineTo) {
      if (!Number.isFinite(buffer[offset]) || !Number.isFinite(buffer[offset + 1])) return null;
      [cursorX, cursorY] = point(buffer[offset], buffer[offset + 1]); offset += 2;
      parts.push(`L${fmt(cursorX)} ${fmt(cursorY)}`);
      track(cursorX, cursorY);
      if (candidate) {
        if (candidate.lines.length < 3) candidate.lines.push([cursorX, cursorY]);
        else candidate = null;
      }
      commands++;
    } else if (code === DRAW_OPS.curveTo) {
      if (buffer.length - offset < 6) return null;
      const [x1, y1] = point(buffer[offset], buffer[offset + 1]);
      const [x2, y2] = point(buffer[offset + 2], buffer[offset + 3]);
      [cursorX, cursorY] = point(buffer[offset + 4], buffer[offset + 5]); offset += 6;
      parts.push(`C${fmt(x1)} ${fmt(y1)} ${fmt(x2)} ${fmt(y2)} ${fmt(cursorX)} ${fmt(cursorY)}`);
      track(x1, y1); track(x2, y2); track(cursorX, cursorY);
      candidate = null;
      commands++;
    } else if (code === DRAW_OPS.quadraticCurveTo) {
      if (buffer.length - offset < 4) return null;
      const qx = buffer[offset], qy = buffer[offset + 1], ex = buffer[offset + 2], ey = buffer[offset + 3]; offset += 4;
      // Quadratic → cubic: controls sit two thirds of the way to the control point.
      const [x1, y1] = point(cursorX + (2 / 3) * (qx - cursorX), cursorY + (2 / 3) * (qy - cursorY));
      const [x2, y2] = point(ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey));
      [cursorX, cursorY] = point(ex, ey);
      parts.push(`C${fmt(x1)} ${fmt(y1)} ${fmt(x2)} ${fmt(y2)} ${fmt(cursorX)} ${fmt(cursorY)}`);
      track(x1, y1); track(x2, y2); track(cursorX, cursorY);
      candidate = null;
      commands++;
    } else if (code === DRAW_OPS.closePath) {
      parts.push("Z");
      commands++;
    } else {
      // Unknown buffer code: bail out rather than emit corrupt geometry.
      return null;
    }
  }
  if (!parts.length || !Number.isFinite(minX)) return null;
  let rect: BuiltPath["rect"] = null;
  if (commands === 5 && candidate && candidate.lines.length === 3) {
    const [[lx1, ly1], [lx2, ly2], [lx3, ly3]] = candidate.lines;
    const aligned = Math.abs(ly1 - candidate.moveY) <= 0.5 && Math.abs(lx2 - lx1) <= 0.5
      && Math.abs(ly3 - ly2) <= 0.5 && Math.abs(lx3 - candidate.moveX) <= 0.5;
    if (aligned) {
      const x = Math.min(candidate.moveX, lx1, lx2, lx3);
      const y = Math.min(candidate.moveY, ly1, ly2, ly3);
      const width = Math.max(Math.abs(lx1 - candidate.moveX), Math.abs(lx3 - candidate.moveX));
      const height = Math.max(Math.abs(ly2 - candidate.moveY), Math.abs(ly3 - candidate.moveY));
      if (width > 0 && height > 0) rect = { x, y, width, height };
    }
  }
  return { d: parts.join(""), minX, minY, maxX, maxY, rect };
}

// ── PostScript font names ───────────────────────────────────────────────

export interface PsFontMeta {
  family: string;
  weight: number;
  style: "normal" | "italic";
  /** Stable identity for line bucketing (family|weight|style). */
  key: string;
}

/** Ordered long-first: style words stripped from name tokens (prefix/suffix). */
const PS_STYLE_WORDS = [
  "extrabold", "ultrabold", "semibold", "demibold", "extralight", "ultralight",
  "black", "heavy", "bold", "light", "thin", "medium", "regular", "roman", "book", "italic", "oblique",
  "bd", "blk", "xb", "xl", "lt", "md", "it", "bi",
] as const;

const PS_WEIGHT_BY_WORD: Record<string, number> = {
  extrabold: 800, ultrabold: 800, xb: 800,
  semibold: 600, demibold: 600, sb: 600,
  ultralight: 200, extralight: 200, xl: 200,
  black: 900, blk: 900, heavy: 900,
  bold: 700, bd: 700,
  light: 300, lt: 300,
  thin: 100,
  medium: 500, md: 500,
};

const PS_ITALIC_WORDS = new Set(["italic", "oblique", "it", "bi"]);

/**
 * Derive (family, weight, style) from an embedded-font PostScript name:
 * "ABCDEF+OpenSans-SemiBold" → { family: "Open Sans", weight: 600, ... }.
 * Standard-14 names ("Helvetica", "Times-Roman") degrade gracefully.
 */
export function psFontMeta(rawName: string): PsFontMeta {
  const name = String(rawName || "").replace(/^[A-Z]{6}\+/, "").trim() || "Helvetica";
  const tokens = name.split(/[\s\-_,+]+/).filter(Boolean);
  let weight = 400;
  let italic = false;
  const familyTokens: string[] = [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    const matched: string[] = [];
    let stripped = lower;
    let changed = true;
    while (changed && stripped) {
      changed = false;
      for (const word of PS_STYLE_WORDS) {
        if (stripped.startsWith(word)) {
          matched.push(word);
          stripped = stripped.slice(word.length);
          changed = true;
          break;
        }
        if (stripped.endsWith(word)) {
          matched.push(word);
          stripped = stripped.slice(0, stripped.length - word.length);
          changed = true;
          break;
        }
      }
    }
    let display = token;
    for (const word of matched) {
      display = display.replace(new RegExp(word, "i"), " ");
    }
    display = display.trim();
    if (display) familyTokens.push(display);
    for (const word of matched) {
      weight = PS_WEIGHT_BY_WORD[word] ?? weight;
      italic = italic || PS_ITALIC_WORDS.has(word);
    }
  }
  let family = familyTokens
    .join(" ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!family) family = name;
  return { family, weight, style: italic ? "italic" : "normal", key: `${family}|${weight}|${italic ? "italic" : "normal"}` };
}

// ── Text line bucketing ─────────────────────────────────────────────────

export interface TextSegment {
  /** Baseline origin, device (artboard CSS) space. */
  x: number;
  y: number;
  fontSize: number;
  /** Identity (font family/weight/size/color) that must match to merge. */
  key: string;
  text: string;
  width: number;
}

/**
 * Merge glyph runs that sit on the same visual line (same style key, same
 * baseline within 20% of the em, x-advance chaining). Words separated by a
 * visible gap get an explicit space so the merged layer stays readable.
 */
export function bucketTextLines(segments: TextSegment[]): TextSegment[] {
  const sorted = [...segments].sort((a, b) => a.y - b.y || a.x - b.x);
  const linesByKey = new Map<string, TextSegment[]>();
  for (const segment of sorted) {
    const candidates = linesByKey.get(segment.key);
    let merged = false;
    if (candidates) {
      // Scan backwards: the closest preceding line on this style key.
      for (let index = candidates.length - 1; index >= 0 && index >= candidates.length - 50; index--) {
        const line = candidates[index];
        const gap = segment.x - (line.x + line.width);
        if (Math.abs(line.y - segment.y) > Math.max(1, segment.fontSize * 0.2)) continue;
        if (gap < -segment.fontSize * 0.5 || gap > segment.fontSize * 1.8) continue;
        const needsSpace = gap > segment.fontSize * 0.25 && !/\s$/.test(line.text) && !/^\s/.test(segment.text);
        line.text += `${needsSpace ? " " : ""}${segment.text}`;
        line.width = segment.x + segment.width - line.x;
        merged = true;
        break;
      }
    }
    if (!merged) {
      const line = { ...segment };
      if (!candidates) linesByKey.set(segment.key, [line]);
      else candidates.push(line);
    }
  }
  return [...linesByKey.values()].flat().sort((a, b) => a.y - b.y || a.x - b.x);
}

// ── Shadings → SVG gradients ────────────────────────────────────────────

export interface ShadingSpec {
  /** PDF shading type: 2 = axial, 3 = radial; anything else is unsupported. */
  type: number;
  /** Coordinates in the SAME space the caller's SVG uses. */
  coords: number[];
  stops: Array<{ offset: number; color: number[] }>;
}

/** Build gradient defs + a fill reference; null when the shading can't be approximated. */
export function shadingFillSvg(shading: ShadingSpec, id: string): { defs: string; fill: string } | null {
  const stops = (shading.stops || [])
    .filter(stop => Array.isArray(stop.color) && stop.color.length >= 3)
    .map(stop => {
      const alpha = stop.color.length > 3 ? Number(stop.color[3] ?? 1) : 1;
      const color = rgbToHex(Number(stop.color[0]) * 255, Number(stop.color[1]) * 255, Number(stop.color[2]) * 255);
      return `<stop offset="${Math.round(Math.max(0, Math.min(1, Number(stop.offset) || 0)) * 100)}%" stop-color="${color}" stop-opacity="${Math.round(alpha * 100) / 100}"/>`;
    })
    .join("");
  if (!stops) return null;
  if (shading.type === 2 && shading.coords.length >= 4) {
    const [x0, y0, x1, y1] = shading.coords.map(Number);
    return { defs: `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fmt(x0)}" y1="${fmt(y0)}" x2="${fmt(x1)}" y2="${fmt(y1)}">${stops}</linearGradient>`, fill: `url(#${id})` };
  }
  if (shading.type === 3 && shading.coords.length >= 6) {
    const [, , , x1, y1, r1] = shading.coords.map(Number);
    return { defs: `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${fmt(x1)}" cy="${fmt(y1)}" r="${fmt(Math.max(1, Number(r1)))}">${stops}</radialGradient>`, fill: `url(#${id})` };
  }
  return null;
}

// ── Boxes ───────────────────────────────────────────────────────────────

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function unionBox(boxes: Box[]): Box {
  if (!boxes.length) return { x: 0, y: 0, width: 1, height: 1 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}
