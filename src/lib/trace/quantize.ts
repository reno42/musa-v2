/**
 * Color reduction and noise removal for the local image trace.
 *
 * Algorithms (public descriptions, reimplemented from scratch):
 * - Black & White: ITU-R 601 luma (0.299/0.587/0.114) against a threshold.
 * - Grayscale: 1-D k-means (Lloyd) over the 256-level luma histogram.
 * - Color: 15-bit RGB histogram (5 bits/channel) with exact per-bin means;
 *   palette by Heckbert median cut (split the box with the largest weighted
 *   extent at the weighted median) followed by weighted Lloyd k-means
 *   refinement over the histogram bins.
 * - Denoise: 4-connected same-color components smaller than the minimum area
 *   merge into their most common neighboring color (BFS labeling).
 */

import { luma, type RGB, type TraceParams } from "./params.ts";

/** Label of a transparent (untraced) pixel. */
export const TRANSPARENT = 0xffff;

/** A palette-indexed image: one label per pixel (row-major) plus the palette. */
export interface Quantized {
  labels: Uint16Array;
  palette: RGB[];
}

interface UsedBin {
  index: number;
  mean: RGB;
  /** Pixel count as float (weighted k-means). */
  weight: number;
}

/** 15-bit histogram key: 5 bits per channel. */
function binKey(r: number, g: number, b: number): number {
  return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
}

function dist2(a: RGB, b: RGB): number {
  // Slightly perceptual channel weights.
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return 2 * dr * dr + 4 * dg * dg + 3 * db * db;
}

function nearestRgb(centers: RGB[], c: RGB): number {
  let best = Infinity;
  let bestI = 0;
  for (let i = 0; i < centers.length; i++) {
    const d = dist2(centers[i], c);
    if (d < best) {
      best = d;
      bestI = i;
    }
  }
  return bestI;
}

/** Drop unused palette entries and merge duplicate colors. */
function compact(labels: Uint16Array, palette: RGB[]): Quantized {
  const used = new Array<boolean>(palette.length).fill(false);
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (l !== TRANSPARENT) used[l] = true;
  }
  const remap = new Array<number>(palette.length).fill(0);
  const out: RGB[] = [];
  for (let i = 0; i < palette.length; i++) {
    if (!used[i]) continue;
    const c = palette[i];
    let found = -1;
    for (let j = 0; j < out.length; j++) {
      if (out[j][0] === c[0] && out[j][1] === c[1] && out[j][2] === c[2]) {
        found = j;
        break;
      }
    }
    if (found >= 0) {
      remap[i] = found;
    } else {
      out.push(c);
      remap[i] = out.length - 1;
    }
  }
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== TRANSPARENT) labels[i] = remap[labels[i]];
  }
  return { labels, palette: out };
}

/** 1-D k-means over a 256-bin histogram (Lloyd iterations, evenly spaced start). */
function kmeans1d(hist: Float64Array, k: number): number[] {
  let lo = 0;
  let hi = 255;
  for (let v = 0; v < 256; v++) {
    if (hist[v] > 0) {
      lo = v;
      break;
    }
  }
  for (let v = 255; v >= 0; v--) {
    if (hist[v] > 0) {
      hi = v;
      break;
    }
  }
  const levels: number[] = [];
  for (let i = 0; i < k; i++) {
    levels.push(k === 1 ? lo : lo + ((hi - lo) * i) / (k - 1));
  }
  const nearest1d = (v: number): number => {
    let best = Infinity;
    let bestI = 0;
    for (let i = 0; i < levels.length; i++) {
      const d = Math.abs(levels[i] - v);
      if (d < best) {
        best = d;
        bestI = i;
      }
    }
    return bestI;
  };
  for (let iter = 0; iter < 20; iter++) {
    const sum = new Array<number>(k).fill(0);
    const cnt = new Array<number>(k).fill(0);
    for (let v = 0; v < 256; v++) {
      const n = hist[v];
      if (n > 0) {
        const j = nearest1d(v);
        sum[j] += v * n;
        cnt[j] += n;
      }
    }
    let moved = false;
    for (let j = 0; j < k; j++) {
      if (cnt[j] > 0) {
        const m = sum[j] / cnt[j];
        if (Math.abs(m - levels[j]) > 0.01) moved = true;
        levels[j] = m;
      }
    }
    if (!moved) break;
  }
  return levels;
}

interface ColorBox {
  mean: RGB;
  weight: number;
  /** Pixel count of the box's heaviest single histogram bin. */
  peak: number;
}

/**
 * Heckbert median cut: repeatedly split the box with the largest weighted
 * extent along its widest channel, at the weighted median bin, while there
 * are fewer than `k` boxes and some box still spans more than `spread`
 * levels of a channel.
 */
function medianCut(used: UsedBin[], k: number, spread: number): ColorBox[] {
  if (used.length === 0) {
    return [{ mean: [255, 255, 255], weight: 0, peak: 0 }];
  }
  let boxes: number[][] = [used.map((_, i) => i)];
  while (boxes.length < k) {
    let best: { score: number; box: number; channel: number } | null = null;
    for (let bi = 0; bi < boxes.length; bi++) {
      const b = boxes[bi];
      if (b.length < 2) continue;
      const lo: [number, number, number] = [Infinity, Infinity, Infinity];
      const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
      let wsum = 0;
      for (const i of b) {
        const m = used[i].mean;
        for (let ch = 0; ch < 3; ch++) {
          if (m[ch] < lo[ch]) lo[ch] = m[ch];
          if (m[ch] > hi[ch]) hi[ch] = m[ch];
        }
        wsum += used[i].weight;
      }
      let channel = 0;
      let range = -1;
      for (let c = 0; c < 3; c++) {
        const r = hi[c] - lo[c];
        if (r > range) {
          range = r;
          channel = c;
        }
      }
      if (range <= Math.max(spread, 0)) continue;
      const score = range * Math.sqrt(wsum);
      if (!best || score > best.score) {
        best = { score, box: bi, channel };
      }
    }
    if (!best) break;
    const b = boxes[best.box].slice();
    const ch = best.channel;
    b.sort((x, y) => used[x].mean[ch] - used[y].mean[ch]);
    const total = b.reduce((acc, i) => acc + used[i].weight, 0);
    let acc = 0;
    let cut = 1;
    for (let j = 0; j < b.length; j++) {
      acc += used[b[j]].weight;
      if (acc >= total / 2) {
        cut = Math.min(Math.max(j + 1, 1), b.length - 1);
        break;
      }
    }
    const head = b.slice(0, cut);
    const tail = b.slice(cut);
    boxes = boxes.slice(0, best.box).concat([head, tail], boxes.slice(best.box + 1));
  }
  return boxes.map(b => {
    const s: [number, number, number] = [0, 0, 0];
    let w = 0;
    let peak = 0;
    for (const i of b) {
      const m = used[i].mean;
      const n = used[i].weight;
      s[0] += m[0] * n;
      s[1] += m[1] * n;
      s[2] += m[2] * n;
      w += n;
      if (n > peak) peak = n;
    }
    return { mean: [s[0] / w, s[1] / w, s[2] / w] as RGB, weight: w, peak };
  });
}

/** Weighted Lloyd refinement of `centers` over the histogram bins. */
function refine(used: UsedBin[], centers: RGB[]): RGB[] {
  const cs = centers.map(c => c.slice() as RGB);
  for (let iter = 0; iter < 12; iter++) {
    const sum = cs.map(() => [0, 0, 0] as [number, number, number]);
    const cnt = new Array<number>(cs.length).fill(0);
    for (const { mean, weight } of used) {
      const j = nearestRgb(cs, mean);
      sum[j][0] += mean[0] * weight;
      sum[j][1] += mean[1] * weight;
      sum[j][2] += mean[2] * weight;
      cnt[j] += weight;
    }
    let moved = 0;
    for (let j = 0; j < cs.length; j++) {
      if (cnt[j] > 0) {
        const m: RGB = [sum[j][0] / cnt[j], sum[j][1] / cnt[j], sum[j][2] / cnt[j]];
        moved = Math.max(moved, dist2(m, cs[j]));
        cs[j] = m;
      }
    }
    if (moved < 0.25) break;
  }
  return cs;
}

/** The most histogram bins flat art's main colors spread over. */
const FLAT_BINS = 96;
/** The most colors Full Tone makes. */
export const FULL_TONE_MAX = 256;

/**
 * Automatic: how many colors flat art is made of, or null for continuous tone
 * (photos, gradients). Flat art keeps ~90% of its pixels in a few tight bins
 * whose median-cut colors each hold most of their box's weight.
 */
function flatColors(used: UsedBin[], detail: number): number | null {
  let total = 0;
  for (const u of used) total += u.weight;
  if (total <= 0) return 2;
  const byCount = used.slice().sort((a, b) => b.weight - a.weight);
  let covered = 0;
  let main = 0;
  for (const u of byCount) {
    const before = covered;
    covered += u.weight;
    main++;
    if (before >= 0.9 * total) {
      main--;
      break;
    }
  }
  if (main > FLAT_BINS) return null;
  const boxes = medianCut(used, 64, 24);
  const minShare = (0.04 - 0.035 * detail) * total;
  const colors = boxes.filter(b => b.weight >= minShare);
  const weight = colors.reduce((a, b) => a + b.weight, 0);
  const peaks = colors.reduce((a, b) => a + b.peak, 0);
  if (weight >= 0.9 * total && peaks >= 0.5 * weight && colors.length <= 32) {
    return Math.max(2, colors.length);
  }
  return null;
}

/** Document Library: the `k` swatches the most pixels are nearest to. */
function libraryColors(used: UsedBin[], swatches: RGB[], k: number): RGB[] {
  const all: RGB[] = [];
  for (const s of swatches) {
    const c: RGB = [s[0], s[1], s[2]];
    if (!all.some(a => a[0] === c[0] && a[1] === c[1] && a[2] === c[2])) all.push(c);
  }
  const weight = new Array<number>(all.length).fill(0);
  for (const { mean, weight: n } of used) {
    weight[nearestRgb(all, mean)] += n;
  }
  const order = all.map((_, i) => i).sort((a, b) => (weight[b] - weight[a]) || (a - b));
  return order.slice(0, Math.max(1, k)).map(i => all[i]);
}

function kmeansRgb(used: UsedBin[], k: number): RGB[] {
  return refine(used, medianCut(used, k, 0).map(b => b.mean));
}

/** Color mode's palette for the histogram bins, as `params.palette` asks. */
function colorPalette(used: UsedBin[], params: TraceParams): RGB[] {
  const k = Math.min(256, Math.max(2, Math.round(params.colors)));
  const detail = Math.min(1, Math.max(0, params.colorDetail / 100));
  const fullTone = () =>
    refine(used, medianCut(used, FULL_TONE_MAX, 96 - 88 * detail).map(b => b.mean));
  switch (params.palette) {
    case "limited":
      return kmeansRgb(used, k);
    case "fullTone":
      return fullTone();
    case "automatic": {
      const n = flatColors(used, detail);
      return n !== null ? kmeansRgb(used, n) : fullTone();
    }
    case "documentLibrary":
      return params.swatches.length > 0
        ? libraryColors(used, params.swatches, k)
        : kmeansRgb(used, k);
  }
}

/** The trace starts from an RGBA8 raster (row-major, top row first). */
export interface Raster {
  width: number;
  height: number;
  rgba: Uint8ClampedArray | Uint8Array;
}

/** Reduce `img` to a palette according to `params.mode`. */
export function quantizeImage(img: Raster, params: TraceParams): Quantized {
  const { width: w, height: h, rgba } = img;
  const n = w * h;
  if (params.mode === "blackAndWhite") {
    const t = params.threshold;
    const labels = new Uint16Array(n);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (rgba[o + 3] < 128) {
        labels[i] = TRANSPARENT;
      } else {
        labels[i] = luma(rgba[o], rgba[o + 1], rgba[o + 2]) < t ? 1 : 0;
      }
    }
    return { labels, palette: [[255, 255, 255], [0, 0, 0]] };
  }

  if (params.mode === "grayscale") {
    const hist = new Float64Array(256);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (rgba[o + 3] >= 128) hist[luma(rgba[o], rgba[o + 1], rgba[o + 2])]++;
    }
    const levels = kmeans1d(hist, Math.min(256, Math.max(2, Math.round(params.colors))));
    const lut = new Uint16Array(256);
    for (let v = 0; v < 256; v++) {
      let best = Infinity;
      let bestI = 0;
      for (let j = 0; j < levels.length; j++) {
        const d = Math.abs(levels[j] - v);
        if (d < best) {
          best = d;
          bestI = j;
        }
      }
      lut[v] = bestI;
    }
    const labels = new Uint16Array(n);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      labels[i] = rgba[o + 3] < 128 ? TRANSPARENT : lut[luma(rgba[o], rgba[o + 1], rgba[o + 2])];
    }
    const palette: RGB[] = levels.map(l => {
      const g = Math.max(0, Math.min(255, Math.round(l)));
      return [g, g, g];
    });
    return compact(labels, palette);
  }

  // Color (and asked-for Logo): 15-bit histogram with exact bin means.
  const binsN = new Float64Array(1 << 15);
  const binsSum = new Float64Array((1 << 15) * 3);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (rgba[o + 3] < 128) continue;
    const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
    const key = binKey(r, g, b);
    binsN[key]++;
    binsSum[key * 3] += r;
    binsSum[key * 3 + 1] += g;
    binsSum[key * 3 + 2] += b;
  }
  const used: UsedBin[] = [];
  for (let key = 0; key < 1 << 15; key++) {
    const count = binsN[key];
    if (count > 0) {
      used.push({
        index: key,
        mean: [binsSum[key * 3] / count, binsSum[key * 3 + 1] / count, binsSum[key * 3 + 2] / count],
        weight: count,
      });
    }
  }
  const centers = colorPalette(used, params);
  const lut = new Uint16Array(1 << 15);
  for (const { index, mean } of used) {
    lut[index] = nearestRgb(centers, mean);
  }
  const labels = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    labels[i] = rgba[o + 3] < 128
      ? TRANSPARENT
      : lut[binKey(rgba[o], rgba[o + 1], rgba[o + 2])];
  }
  const palette: RGB[] = centers.map(c => [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])]);
  return compact(labels, palette);
}

/**
 * Merge 4-connected same-label components smaller than `minArea` pixels into
 * their most common neighboring label (ties: higher count, then lower label
 * id). Transparent pixels are never relabeled.
 */
export function denoise(labels: Uint16Array, w: number, h: number, minArea: number): void {
  if (minArea <= 1 || w === 0 || h === 0 || labels.length !== w * h) return;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const comp: number[] = [];
  const neigh: Array<[number, number]> = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || labels[start] === TRANSPARENT) continue;
    const l = labels[start];
    comp.length = 0;
    neigh.length = 0;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    let small = true;
    while (stack.length > 0) {
      const i = stack.pop()!;
      if (small) {
        comp.push(i);
        if (comp.length >= minArea) small = false;
      }
      const x = i % w;
      const y = (i / w) | 0;
      const visit = (j: number) => {
        const lj = labels[j];
        if (lj === l) {
          if (!seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        } else if (lj !== TRANSPARENT) {
          const found = neigh.find(e => e[0] === lj);
          if (found) found[1]++;
          else neigh.push([lj, 1]);
        }
      };
      if (x > 0) visit(i - 1);
      if (x + 1 < w) visit(i + 1);
      if (y > 0) visit(i - w);
      if (y + 1 < h) visit(i + w);
    }
    if (small && neigh.length > 0) {
      // Most common neighbor color; ties break toward the lower label id.
      let best: [number, number] = neigh[0];
      for (const e of neigh) {
        if (e[1] > best[1] || (e[1] === best[1] && e[0] < best[0])) best = e;
      }
      for (const i of comp) labels[i] = best[0];
    }
  }
}
