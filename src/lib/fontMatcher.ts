/**
 * Font Matcher — «¿Qué fuente es?»
 *
 * In-house, deterministic, zero AI: given a cropped piece of a design (the
 * user frames the word) and the text it spells, every candidate font from
 * OUR OWN catalog is rendered with that same text and compared to the crop
 * by perceptual hash. The model never names the typeface — the math does.
 *
 * Why this exists: vision models guess "Arial" when asked to name a font
 * from pixels (they are readers of text, not typeface experts). The catalog
 * is finite and ours (Google live + system + the account's custom uploads),
 * so identification is a ranking problem, not an oracle problem. System
 * fonts ARE candidates on purpose: a design may genuinely use Arial — what
 * is forbidden is defaulting to it without verifying.
 *
 * Ranking: 8×8 average hash (aHash) of the normalized crop vs each
 * specimen, Hamming distance → similarity. Blunt but reproducible and
 * explainable, and the results render in the searched text so a human can
 * confirm at a glance. The catalog is popularity-sorted, so the candidate
 * cap keeps the common cases fast without hiding long-tail families (a
 * script filter — latin/korean — trims first, the Dongle case).
 */

import { loadGoogleFontInDocument } from "./googleFonts";
import { loadCustomFontInDocument, type CustomFont } from "./customFonts";

export interface FontMatchCandidate {
  family: string;
  source: "system" | "google" | "custom";
  subsets?: string[];
  variants?: string[];
  /** System fonts only — the CSS stack to write into the design. */
  stack?: string;
  custom?: CustomFont;
}

export interface FontMatch extends FontMatchCandidate {
  /** 0..1 — 1 minus normalized Hamming distance of the 8×8 aHash. */
  similarity: number;
}

/** Rendering every Google family is minutes; the catalog is popularity-
 *  sorted, so a cap keeps the common cases inside a couple of seconds while
 *  the script filter already removed most of the irrelevant families. */
export const MAX_CANDIDATES = 320;

/** Results shown after ranking — plenty for a human to eyeball-confirm. */
export const MAX_RESULTS = 15;

const HASH_GRID = 8;
const HASH_CANVAS = 32; // sampled every 4px → 8×8 bits

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function grayscaleHash(canvas: HTMLCanvasElement): { bits: Uint8Array; dark: number } {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const small = makeCanvas(HASH_CANVAS, HASH_CANVAS);
  const sctx = small.getContext("2d", { willReadFrequently: true })!;
  sctx.fillStyle = "#fff";
  sctx.fillRect(0, 0, HASH_CANVAS, HASH_CANVAS);
  sctx.drawImage(canvas, 0, 0, HASH_CANVAS, HASH_CANVAS);
  const { data } = sctx.getImageData(0, 0, HASH_CANVAS, HASH_CANVAS);
  const gray = new Float32Array(HASH_CANVAS * HASH_CANVAS);
  let total = 0;
  for (let i = 0; i < gray.length; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    total += gray[i];
  }
  const avg = total / gray.length;
  const bits = new Uint8Array(HASH_GRID * HASH_GRID);
  let dark = 0;
  for (let y = 0; y < HASH_GRID; y++) {
    for (let x = 0; x < HASH_GRID; x++) {
      // Sample the center of each grid cell of the 32×32 reduction.
      const si = (y * 4 + 2) * HASH_CANVAS + (x * 4 + 2);
      if (gray[si] < avg) { bits[y * HASH_GRID + x] = 1; dark++; }
    }
  }
  return { bits, dark };
}

function hamming(a: Uint8Array, b: Uint8Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

/** Trim a canvas to the bounding box of its dark pixels (the glyphs), so a
 *  crop with margins hashes the same as a tight one. */
function trimToInk(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lum < 128) { // ink on a white canvas
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return canvas; // blank — caller skips it via the dark count
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const out = makeCanvas(w, h);
  out.getContext("2d")!.drawImage(canvas, minX, minY, w, h, 0, 0, w, h);
  return out;
}

/** Hash of the user's framed crop: white background, ink trimmed, aHash. */
export function hashCrop(crop: HTMLCanvasElement): Uint8Array | null {
  const flat = makeCanvas(crop.width, crop.height);
  const ctx = flat.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(crop, 0, 0);
  const { bits, dark } = grayscaleHash(flat);
  if (dark < 4) return null; // empty frame — nothing to match
  return bits;
}

function renderSpecimen(text: string, cssFamily: string): Uint8Array | null {
  const canvas = makeCanvas(220, 80);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "middle";
  ctx.font = `52px ${cssFamily}`;
  const width = ctx.measureText(text).width;
  if (!Number.isFinite(width) || width <= 0 || width > 4096) return null;
  const scale = Math.min(1, (canvas.width - 12) / width);
  if (scale < 1) ctx.font = `${Math.floor(52 * scale)}px ${cssFamily}`;
  ctx.fillText(text, 6, canvas.height / 2);
  const trimmed = trimToInk(canvas);
  const { bits, dark } = grayscaleHash(trimmed);
  if (dark < 4) return null; // family has no glyphs for this text — skip it
  return bits;
}

async function ensureLoaded(candidate: FontMatchCandidate, text: string): Promise<string> {
  if (candidate.source === "custom" && candidate.custom) {
    try { await loadCustomFontInDocument(candidate.custom); } catch { /* cached or already registered */ }
    return `'${candidate.custom.familyName.replace(/'/g, "")}'`;
  }
  if (candidate.source === "google") {
    loadGoogleFontInDocument(candidate.family, candidate.variants?.length ? candidate.variants : ["regular"]);
    try { await document.fonts.load(`52px "${candidate.family}"`, text); } catch { /* falls back below */ }
    return `"${candidate.family.replace(/"/g, "")}"`;
  }
  return `"${candidate.family.replace(/"/g, "")}", sans-serif`;
}

function cssNameFor(candidate: FontMatchCandidate): string {
  if (candidate.source === "custom" && candidate.custom) return `'${candidate.custom.familyName.replace(/'/g, "")}'`;
  return `"${candidate.family.replace(/"/g, "")}"`;
}

/** Rank every candidate against the framed crop. Yields to the event loop
 *  between batches so the picker stays responsive while fonts load. */
export async function matchFontFromCrop(opts: {
  cropBits: Uint8Array;
  sampleText: string;
  candidates: FontMatchCandidate[];
  onProgress?: (done: number, total: number) => void;
}): Promise<FontMatch[]> {
  const { cropBits, sampleText, candidates, onProgress } = opts;
  const matches: FontMatch[] = [];
  const BATCH = 24;
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      await ensureLoaded(candidate, sampleText);
      const bits = renderSpecimen(sampleText, cssNameFor(candidate));
      if (bits) {
        const similarity = 1 - hamming(cropBits, bits) / (HASH_GRID * HASH_GRID);
        matches.push({ ...candidate, similarity });
      }
    } catch { /* a family that fails to load simply does not compete */ }
    if (onProgress && (i % BATCH === 0 || i === candidates.length - 1)) {
      onProgress(i + 1, candidates.length);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  matches.sort((a, b) => b.similarity - a.similarity);
  return matches.slice(0, MAX_RESULTS);
}

/** The candidate pool: OUR catalog (popularity order, script-filtered) plus
 *  the account's own uploads. System fonts stay in the race on purpose —
 *  confirming "this really is Arial" is a legitimate answer. */
export async function loadMatchCandidates(
  script: "latin" | "korean" | "any",
  customFonts: CustomFont[],
): Promise<FontMatchCandidate[]> {
  const pool: FontMatchCandidate[] = customFonts.map(font => ({
    family: font.familyName,
    source: "custom",
    custom: font,
  }));
  // The route caps a page at 500; the live library is ~1800 — paginate.
  for (let offset = 0; offset < 2000; offset += 500) {
    const res = await fetch(`/api/fonts/catalog?limit=500&offset=${offset}`);
    const json = await res.json().catch(() => null);
    const fonts = json?.data?.fonts as FontMatchCandidate[] | undefined;
    if (!fonts || fonts.length === 0) break;
    for (const font of fonts) {
      if (font.source === "system") { pool.push(font); continue; }
      if (script !== "any" && Array.isArray(font.subsets) && font.subsets.length > 0 && !font.subsets.includes(script)) continue;
      pool.push(font);
    }
    if (fonts.length < 500) break;
  }
  return pool.slice(0, MAX_CANDIDATES);
}
