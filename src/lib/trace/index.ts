/**
 * Buscatrazos local — the full trace pipeline, pure TypeScript so the same
 * engine runs in the browser worker, in the Node QA tests and inside the
 * Cloudflare Worker (MCP `trace_image`).
 *
 * Pipeline: quantize (palette per mode) → denoise → layer order (largest
 * area first) → per layer: mask → crack-boundary trace → fill/stroke split →
 * Douglas–Peucker + Schneider Bézier fit. A global anchor budget turns
 * runaway results into a clean `tooComplex` failure instead of freezing the
 * tab; the budget is polled between layers so a worker can cancel mid-trace.
 */

import type { RGB, TraceParams } from "./params.ts";
import { DEFAULT_MAX_ANCHORS, MAX_PIXELS, deriveTolerances, isWhite, luma, rgbToHex } from "./params.ts";
import { TRANSPARENT, denoise, quantizeImage, type Quantized, type Raster } from "./quantize.ts";
import { traceMask } from "./contour.ts";
import { anchorCount, fitLoop, subPathToD, type FitOptions, type FitSubPath } from "./fit.ts";
import { centerlines } from "./centerline.ts";

/** One traced layer: either a filled silhouette or a stroked centre line. */
export interface TracedPath {
  /** SVG path data (M/C/L/Z), pixel coordinates of the source raster. */
  d: string;
  /** Fill color, or stroke color for stroked paths, as `#rrggbb`. */
  color?: string;
  /** Stroke width in px (strokes only). */
  strokeWidth?: number;
  /** Pixel count of the layer (reporting / QA). */
  pixels: number;
}

export interface TraceResult {
  paths: TracedPath[];
  /** The reduced palette, as `#rrggbb` (B/N yields white+black). */
  palette: string[];
  anchorCount: number;
}

export type TraceFailureCode = "empty" | "tooLarge" | "tooComplex" | "cancelled";

export interface TraceFailure {
  code: TraceFailureCode;
  message: string;
}

export type TraceOutcome = { ok: true; result: TraceResult } | { ok: false; failure: TraceFailure };

/** Otsu's threshold: the gray level maximizing between-class variance. */
export function otsuThreshold(img: Raster): number {
  const hist = new Float64Array(256);
  let total = 0;
  const { width: w, height: h, rgba } = img;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (rgba[o + 3] < 128) continue;
    hist[luma(rgba[o], rgba[o + 1], rgba[o + 2])]++;
    total++;
  }
  if (total === 0) return 128;
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * hist[v];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;
  for (let v = 0; v < 256; v++) {
    wB += hist[v];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += v * hist[v];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = v;
    }
  }
  // Otsu's v is the boundary of the darker class (pixels ≤ v); the tracer's
  // convention is `luma < threshold` = black, so the threshold is v + 1.
  return Math.min(255, best + 1);
}

interface PendingPath {
  d: string;
  anchors: number;
  color: RGB;
  pixels: number;
  stroke?: number;
}

/**
 * Trace a raster into vector paths.
 *
 * @param img source raster (RGBA8, row-major)
 * @param params trace parameters (panel state; use presets.ts for the 13 named presets)
 * @param maxAnchors total anchor budget (TooComplex beyond it)
 * @param onProgress progress callback, 0–1
 * @param shouldCancel polled between layers; `true` aborts with code `cancelled`
 */
export function traceImage(
  img: Raster,
  params: TraceParams,
  maxAnchors: number = DEFAULT_MAX_ANCHORS,
  onProgress?: (fraction: number) => void,
  shouldCancel?: () => boolean,
): TraceOutcome {
  const { width: w, height: h } = img;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { ok: false, failure: { code: "empty", message: "La imagen está vacía o no se pudo decodificar." } };
  }
  if (w * h > MAX_PIXELS) {
    const mp = (w * h) / 1e6;
    return {
      ok: false,
      failure: {
        code: "tooLarge",
        message: `La imagen es demasiado grande (${mp.toFixed(1)} MP). El máximo es 64 MP; reduce el tamaño e inténtalo de nuevo.`,
      },
    };
  }
  if (shouldCancel?.()) return { ok: false, failure: { code: "cancelled", message: "Trace cancelado." } };

  // Logo mode (Fase 1–3): degrades to black & white with an automatic
  // Otsu threshold; flat-color separation with fixed swatches lands later.
  let p = params;
  if (p.mode === "logo") {
    p = {
      ...p,
      mode: "blackAndWhite",
      threshold: p.threshold >= 1 && p.threshold <= 254 ? p.threshold : otsuThreshold(img),
      ignoreWhite: true,
      snapCurvesToLines: true,
    };
  }

  const q: Quantized = quantizeImage(img, p);
  denoise(q.labels, w, h, Math.max(0, Math.round(p.noise)));

  // Layer order: largest pixel area first (background before detail).
  const counts = new Array<number>(q.palette.length).fill(0);
  for (let i = 0; i < q.labels.length; i++) {
    const l = q.labels[i];
    if (l !== TRANSPARENT) counts[l]++;
  }
  const order = q.palette
    .map((_, i) => i)
    .filter(i => counts[i] > 0)
    .sort((a, b) => (counts[b] - counts[a]) || (a - b));

  const tol = deriveTolerances(p);
  const o: FitOptions = {
    polygonTol: tol.polygonTolerance,
    fitTol: tol.fitTolerance,
    cornerAngle: tol.cornerAngle,
    snapLines: p.snapCurvesToLines,
  };
  const rank = new Array<number>(order.length);
  order.forEach((label, r) => (rank[label] = r));

  const pending: PendingPath[] = [];
  let budget = maxAnchors;
  const add = (d: string, anchors: number, color: RGB, pixels: number, stroke?: number): boolean => {
    if (anchors > budget) return false;
    budget -= anchors;
    pending.push({ d, anchors, color, pixels, stroke });
    return true;
  };

  for (let oi = 0; oi < order.length; oi++) {
    if (shouldCancel?.()) return { ok: false, failure: { code: "cancelled", message: "Trace cancelado." } };
    const ci = order[oi];
    if (p.ignoreWhite && isWhite(q.palette[ci])) continue;
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < q.labels.length; i++) {
      const l = q.labels[i];
      if (l === TRANSPARENT) continue;
      // Adyacente: cada color es exactamente su área. Superpuesto: un color
      // cubre todo lo que viene después (sin hairlines entre capas).
      mask[i] = p.method === "overlapping" ? (rank[l] >= rank[ci] ? 1 : 0) : l === ci ? 1 : 0;
    }

    // Strokes: centre lines of the layer's thin features; their pixels then
    // drop out of the fill mask so wide areas stay filled, thin lines stroked.
    if (p.strokes) {
      const layerLabels = new Uint16Array(w * h);
      for (let i = 0; i < w * h; i++) layerLabels[i] = mask[i] ? ci : TRANSPARENT;
      const { thin, lines } = centerlines(layerLabels, ci, w, h, p.strokeWidth, o);
      for (const line of lines) {
        for (const sp of line.subPaths) {
          if (!add(subPathToD(sp), anchorCount(sp), q.palette[ci], line.pixels, line.width)) {
            return tooComplex(budget);
          }
        }
      }
      for (let i = 0; i < mask.length; i++) if (thin[i]) mask[i] = 0;
    }

    // Fills: boundary loops of what remains of the layer. Outer loop and
    // holes are separate subpaths concatenated in one path's `d`.
    const components = traceMask(mask, w, h);
    for (const comp of components) {
      if (Math.abs(comp.outer.area2) / 2 < Math.max(p.noise, 1)) continue;
      const loops: FitSubPath[] = [];
      const outer = fitLoop(comp.outer, o);
      if (outer) loops.push(outer);
      for (const hole of comp.holes) {
        if (Math.abs(hole.area2) / 2 < Math.max(p.noise, 1)) continue;
        const hl = fitLoop(hole, o);
        if (hl) loops.push(hl);
      }
      const anchors = loops.reduce((acc: number, s) => acc + anchorCount(s), 0);
      if (anchors > budget) return tooComplex(budget);
      budget -= anchors;
      pending.push({ d: loops.map(subPathToD).join(""), anchors, color: q.palette[ci], pixels: comp.pixels });
    }
    onProgress?.((oi + 1) / order.length);
  }

  const paths: TracedPath[] = [];
  for (const t of pending) {
    if (!t.d) continue;
    const hex = rgbToHex(t.color);
    paths.push(
      t.stroke !== undefined
        ? { d: t.d, color: hex, strokeWidth: Math.round(t.stroke * 100) / 100, pixels: t.pixels }
        : { d: t.d, color: hex, pixels: t.pixels },
    );
  }
  if (paths.length === 0) {
    return { ok: false, failure: { code: "empty", message: "No se encontraron formas que trazar. Prueba con otro modo o baja el Ruido." } };
  }
  return {
    ok: true,
    result: {
      paths,
      palette: q.palette.map(rgbToHex),
      anchorCount: maxAnchors - budget,
    },
  };
}

function tooComplex(budget: number): { ok: false; failure: TraceFailure } {
  return {
    ok: false,
    failure: {
      code: "tooComplex",
      message: `Este trace superaría el límite de puntos de ancla (quedan ${budget}). Sube el Ruido, baja Trazos/Colores o elige un preset de menor fidelidad.`,
    },
  };
}

/**
 * Inner <path> elements of a trace result — shared by traceResultToSvg and
 * the MCP trace_image tool (same markup on both sides, zero drift).
 */
export function traceResultPathsMarkup(result: TraceResult): string {
  return result.paths
    .map(t =>
      t.strokeWidth !== undefined
        ? `<path d="${t.d}" fill="none" stroke="${t.color ?? "currentColor"}" stroke-width="${t.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`
        : `<path d="${t.d}" fill="${t.color ?? "#000"}"/>`,
    )
    .join("");
}

/** Serialize a trace result to a standalone SVG (preview / MCP return value). */
export function traceResultToSvg(
  result: TraceResult,
  width: number,
  height: number,
  attrs: Record<string, string> = {},
): string {
  const attr = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${v.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`)
    .join("");
  return `<svg${attr} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${traceResultPathsMarkup(result)}</svg>`;
}

/** Indices of the set pixels of a mask (helper for QA assertions). */
export function pixelIndices(mask: Uint8Array, w: number, h: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < w * h; i++) if (mask[i]) out.push(i);
  return out;
}
