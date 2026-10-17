/**
 * gifEncoder — minimal zero-dep GIF89a writer for reel export (G17 dialog:
 * MP4/WebM/GIF). Motion graphics art is flat-color dominant, so a shared
 * 256-color median-cut palette + nearest-index mapping keeps quality high
 * without per-frame local tables; LZW is the classic GIF variant
 * (LSB-first bit packing, clear/EOI codes, 12-bit ceiling).
 *
 * Scope (deliberately narrow):
 *  • one global color table (power-of-two size, ≤ 256 colors)
 *  • full frames only (disposal "do not dispose"), NETSCAPE2.0 loop ext
 *  • no transparency, no interlace, no local color tables
 */

/** Median-cut palette from RGB samples (byte triples). Returns 3×2^k bytes. */
export function buildPalette(samples: Uint8Array, maxColors = 256): Uint8Array {
  const n = samples.length / 3;
  if (n === 0) return new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

  // Bound the working set — median cut is O(n log n) per split; 64k samples
  // already describe motion-graphic palettes exhaustively.
  let idx = Array.from({ length: n }, (_, i) => i);
  if (n > 65_536) {
    const keep: number[] = [];
    const stride = n / 65_536;
    for (let f = 0; f < 65_536; f++) keep.push(Math.min(n - 1, Math.floor(f * stride)));
    idx = keep;
  }

  interface Box { ids: number[] }
  const channelRange = (b: Box): [number, number, number] => {
    let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
    for (const i of b.ids) {
      const r = samples[i * 3], g = samples[i * 3 + 1], bb = samples[i * 3 + 2];
      if (r < rmin) rmin = r; if (r > rmax) rmax = r;
      if (g < gmin) gmin = g; if (g > gmax) gmax = g;
      if (bb < bmin) bmin = bb; if (bb > bmax) bmax = bb;
    }
    return [rmax - rmin, gmax - gmin, bmax - bmin];
  };

  let boxes: Box[] = [{ ids: idx }];
  while (boxes.length < maxColors) {
    // Split the box with the largest (range × population) — color-accurate
    // for flat art (huge count, tiny range) and gradients alike.
    let best = -1, bestScore = -1, bestChan = 0;
    for (let bi = 0; bi < boxes.length; bi++) {
      if (boxes[bi].ids.length < 2) continue;
      const [r, g, b] = channelRange(boxes[bi]);
      const chans: Array<[number, number]> = [[r, 0], [g, 1], [b, 2]];
      const [range, chan] = chans.reduce((a, c) => (c[0] > a[0] ? c : a));
      const score = range * boxes[bi].ids.length;
      if (range > 0 && score > bestScore) { bestScore = score; best = bi; bestChan = chan; }
    }
    if (best < 0) break; // every box is a single color
    const box = boxes[best];
    box.ids.sort((a, b) => samples[a * 3 + bestChan] - samples[b * 3 + bestChan]);
    const mid = box.ids.length >> 1;
    boxes.splice(best, 1, { ids: box.ids.slice(0, mid) }, { ids: box.ids.slice(mid) });
  }

  const colors = boxes.map(b => {
    let r = 0, g = 0, bl = 0;
    for (const i of b.ids) { r += samples[i * 3]; g += samples[i * 3 + 1]; bl += samples[i * 3 + 2]; }
    const m = Math.max(1, b.ids.length);
    return [Math.round(r / m), Math.round(g / m), Math.round(bl / m)] as const;
  });

  // Pad to a power-of-two table (GIF GCT), minimum 4 entries (min code size 2).
  let pow = 4;
  while (pow < colors.length && pow < 256) pow <<= 1;
  const out = new Uint8Array(pow * 3);
  colors.slice(0, pow).forEach((c, i) => { out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2]; });
  return out;
}

/** Nearest palette index (Euclidean) with a per-image memo — the same RGB
 *  triple repeats massively in flat art, so the cache does the heavy lifting. */
export function nearestIndexFactory(palette: Uint8Array): (r: number, g: number, b: number) => number {
  const cache = new Map<number, number>();
  return (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const entries = palette.length / 3;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < entries; i++) {
      const dr = r - palette[i * 3], dg = g - palette[i * 3 + 1], db = b - palette[i * 3 + 2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; best = i; if (d === 0) break; }
    }
    cache.set(key, best);
    return best;
  };
}

/** GIF LZW: compress indices into sub-block-chunked bytes (min code size
 *  header byte NOT included — the encoder writes it per frame). */
function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoi + 1;
  let dict = new Map<number, number>();

  const out: number[] = [];
  let cur = 0, curShift = 0;
  const emit = (code: number) => {
    cur |= code << curShift;
    curShift += codeSize;
    while (curShift >= 8) { out.push(cur & 0xff); cur >>>= 8; curShift -= 8; }
  };

  emit(clear);
  if (indices.length > 0) {
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = (prefix << 8) | k;
      const found = dict.get(key);
      if (found !== undefined) { prefix = found; continue; }
      emit(prefix);
      if (nextCode === 4096) {
        emit(clear);
        dict = new Map();
        codeSize = minCodeSize + 1;
        nextCode = eoi + 1;
      } else {
        if (nextCode >= (1 << codeSize)) codeSize++;
        dict.set(key, nextCode++);
      }
      prefix = k;
    }
    emit(prefix);
  }
  emit(eoi);
  if (curShift > 0) out.push(cur & 0xff);

  // 255-byte sub-blocks + terminator.
  const blocks: number[] = [];
  for (let i = 0; i < out.length; i += 255) {
    const len = Math.min(255, out.length - i);
    blocks.push(len, ...out.slice(i, i + len));
  }
  blocks.push(0);
  return new Uint8Array(blocks);
}

export interface GifEncoderOptions {
  width: number;
  height: number;
  /** Global color table: 3×2^k bytes (from buildPalette). */
  palette: Uint8Array;
  /** Loop count (0 = forever). */
  loop?: number;
}

export class GifEncoder {
  private readonly opts: GifEncoderOptions;
  private readonly frames: Array<{ payload: Uint8Array; delayCs: number }> = [];

  constructor(opts: GifEncoderOptions) {
    this.opts = opts;
  }

  addFrame(indices: Uint8Array, delayCs: number): void {
    if (indices.length !== this.opts.width * this.opts.height) {
      throw new Error("gifEncoder: frame size mismatch");
    }
    const entries = this.opts.palette.length / 3;
    let bits = 2;
    while (1 << bits < entries) bits++;
    this.frames.push({ payload: lzwEncode(indices, bits), delayCs: Math.max(2, delayCs) });
  }

  finish(): Blob {
    if (this.frames.length === 0) throw new Error("gifEncoder: no frames added");
    const { width, height, palette } = this.opts;
    const entries = palette.length / 3;
    let bits = 2;
    while (1 << bits < entries) bits++;

    const head: number[] = [];
    const pushStr = (s: string) => { for (const ch of s) head.push(ch.charCodeAt(0)); };
    const push16 = (v: number) => { head.push(v & 0xff, (v >> 8) & 0xff); };

    pushStr("GIF89a");
    push16(width); push16(height);
    head.push(0x80 | (bits - 1), 0, 0); // GCT flag | size, bg, aspect
    for (const b of palette) head.push(b);
    // NETSCAPE2.0 loop extension
    head.push(0x21, 0xff, 0x0b);
    pushStr("NETSCAPE2.0");
    head.push(0x03, 0x01);
    push16(this.opts.loop ?? 0);
    head.push(0x00);

    for (const f of this.frames) {
      head.push(0x21, 0xf9, 0x04, 0x04); // GCE, disposal 1 (do not dispose)
      push16(f.delayCs);
      head.push(0x00, 0x00); // no transparency, block terminator
      head.push(0x2c);
      push16(0); push16(0); push16(width); push16(height);
      head.push(0x00); // no LCT, no interlace
      head.push(bits); // LZW min code size
      for (const b of f.payload) head.push(b);
    }
    head.push(0x3b); // trailer

    // Cast: TS models Uint8Array as Uint8Array<ArrayBufferLike>, which BlobPart
    // rejects; our array is a plain-ArrayBuffer backed one.
    return new Blob([new Uint8Array(head) as unknown as BlobPart], { type: "image/gif" });
  }
}
