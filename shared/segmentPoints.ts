/**
 * SAM click-prompt normalization — the one contract every surface that
 * feeds the MobileSAM decoder agrees on (REST /api/segment/click, MCP
 * segment_click, the Varita UI): points and boxes arrive either already
 * normalized 0..1 over the image, or in raw px with imageWidth/imageHeight,
 * and leave normalized 0..1. Pure functions in, values out (shared/README).
 */

export interface SegmentClickPoint {
  x: number;
  y: number;
  neg: boolean;
}

export interface SegmentClickBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function isPositiveDim(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * A coordinate set is treated as px when ANY value exceeds the normalized
 * range AND image dimensions are known — the same threshold SAM front-ends
 * use. Normalized prompts never leave 0..1, so there is no ambiguity.
 * Returns the divisors to map those coordinates to 0..1 (1 when normalized).
 */
function promptDivisors(
  coords: number[],
  imageWidth?: number | null,
  imageHeight?: number | null,
): { x: number; y: number } {
  if (isPositiveDim(imageWidth) && isPositiveDim(imageHeight) && coords.some(value => Math.abs(value) > 1.25)) {
    return { x: imageWidth, y: imageHeight };
  }
  return { x: 1, y: 1 };
}

/**
 * Validates incoming click prompts → normalized 0..1 over the image.
 * Non-finite entries are dropped; returns null when nothing survives.
 */
export function normalizeSegmentPoints(
  raw: unknown,
  imageWidth?: number | null,
  imageHeight?: number | null,
): SegmentClickPoint[] | null {
  if (!Array.isArray(raw)) return null;
  const candidates: Array<{ x: number; y: number; neg: boolean }> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const x = Number((entry as Record<string, unknown>).x);
    const y = Number((entry as Record<string, unknown>).y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    candidates.push({ x, y, neg: Boolean((entry as Record<string, unknown>).neg) });
  }
  if (candidates.length === 0) return null;
  const { x: divX, y: divY } = promptDivisors(candidates.flatMap(p => [p.x, p.y]), imageWidth, imageHeight);
  return candidates.map(p => ({ x: clamp01(p.x / divX), y: clamp01(p.y / divY), neg: p.neg }));
}

/**
 * Validates an incoming box prompt → normalized 0..1 over the image.
 * Returns null when the box is absent or degenerate (w/h ≤ 0).
 */
export function normalizeSegmentBox(
  raw: unknown,
  imageWidth?: number | null,
  imageHeight?: number | null,
): SegmentClickBox | null {
  if (!raw || typeof raw !== "object") return null;
  const x = Number((raw as Record<string, unknown>).x);
  const y = Number((raw as Record<string, unknown>).y);
  const w = Number((raw as Record<string, unknown>).w);
  const h = Number((raw as Record<string, unknown>).h);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  const { x: divX, y: divY } = promptDivisors([x, y, w, h], imageWidth, imageHeight);
  return {
    x: clamp01(x / divX),
    y: clamp01(y / divY),
    w: Math.min(1, w / divX),
    h: Math.min(1, h / divY),
  };
}
