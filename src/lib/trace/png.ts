/**
 * Decodificador PNG mínimo en TypeScript puro (REQ-043 Fase 1, vía MCP).
 * Sustituye a sharp donde no hay binarios nativos: Cloudflare Workers, Node
 * y el navegador. Infla con DecompressionStream (disponible en los tres
 * entornos) y desfiltra manualmente; soporta bit depths 1/2/4/8/16 y los
 * color types 0/2/3/4/6. PNG entrelazado (Adam7) se rechaza con error claro.
 */

import type { Raster } from "./quantize.ts";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

interface PngChunks {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  idat: Uint8Array[];
  palette: Uint8Array | null;
  trns: Uint8Array | null;
}

function readChunks(bytes: Uint8Array): PngChunks {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error("No es un archivo PNG válido.");
  }
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let ihdrSeen = false;
  const idat: Uint8Array[] = [];
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataStart = offset + 8;
    if (dataStart + length + 4 > bytes.length) throw new Error("PNG truncado.");
    const data = bytes.subarray(dataStart, dataStart + length);
    if (type === "IHDR") {
      if (length < 13) throw new Error("IHDR inválido.");
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      if (bytes[dataStart + 12] !== 0) throw new Error("PNG entrelazado (Adam7) no soportado.");
      ihdrSeen = true;
    } else if (type === "PLTE") {
      palette = data.slice();
    } else if (type === "tRNS") {
      trns = data.slice();
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataStart + length + 4;
  }
  if (!ihdrSeen || idat.length === 0) throw new Error("PNG sin IHDR o sin datos de imagen.");
  if (width <= 0 || height <= 0 || width > 32767 || height > 32767) throw new Error(`PNG con dimensiones inválidas (${width}×${height}).`);
  return { width, height, bitDepth, colorType, idat, palette, trns };
}

async function inflateZlib(parts: Uint8Array[]): Promise<Uint8Array> {
  const stream = new DecompressionStream("deflate");
  const blob = new Blob(parts as BlobPart[]);
  const buf = await new Response(blob.stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(buf);
}

function channelsOf(colorType: number): number {
  switch (colorType) {
    case 0: return 1; // grayscale
    case 2: return 3; // rgb
    case 3: return 1; // palette index
    case 4: return 2; // gray + alpha
    case 6: return 4; // rgba
    default: throw new Error(`Color type PNG ${colorType} no soportado.`);
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Reverse the per-scanline PNG filters in place over the inflated stream. */
function unfilter(raw: Uint8Array, width: number, height: number, bpp: number, stride: number): void {
  const prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    const row = raw.subarray(rowStart + 1, rowStart + 1 + stride);
    switch (filter) {
      case 0:
        break;
      case 1: // Sub
        for (let i = bpp; i < stride; i++) row[i] = (row[i] + row[i - bpp]) & 0xff;
        break;
      case 2: // Up
        for (let i = 0; i < stride; i++) row[i] = (row[i] + prev[i]) & 0xff;
        break;
      case 3: // Average
        for (let i = 0; i < stride; i++) {
          const left = i >= bpp ? row[i - bpp] : 0;
          row[i] = (row[i] + ((left + prev[i]) >> 1)) & 0xff;
        }
        break;
      case 4: // Paeth
        for (let i = 0; i < stride; i++) {
          const left = i >= bpp ? row[i - bpp] : 0;
          row[i] = (row[i] + paeth(left, prev[i], i >= bpp ? prev[i - bpp] : 0)) & 0xff;
        }
        break;
      default:
        throw new Error(`Filtro PNG desconocido (${filter}).`);
    }
    prev.set(row);
  }
}

/** Sample at (x, y) of channel c, normalizing 16-bit to the high byte.
 *  Each scanline occupies stride + 1 bytes in the raw stream (filter byte). */
function sample(raw: Uint8Array, stride: number, x: number, y: number, c: number, bitDepth: number, nChannels: number): number {
  const rowBase = y * (stride + 1) + 1;
  if (bitDepth === 16) return raw[rowBase + (x * nChannels + c) * 2];
  if (bitDepth === 8) return raw[rowBase + x * nChannels + c];
  // Sub-byte depths (1/2/4), MSB first, single channel only.
  const perByte = 8 / bitDepth;
  const byte = raw[rowBase + ((x / perByte) | 0)];
  const shift = 8 - bitDepth * ((x % perByte) + 1);
  const mask = (1 << bitDepth) - 1;
  return (byte >> shift) & mask;
}

/**
 * Decode a PNG file into an RGBA8 raster ready for traceImage. Transparent
 * pixels keep alpha < 128 so the quantizer skips them.
 */
export async function decodePngToRaster(file: Uint8Array | ArrayBuffer): Promise<Raster> {
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(file);
  const { width, height, bitDepth, colorType, idat, palette, trns } = readChunks(bytes);
  if (![1, 2, 4, 8, 16].includes(bitDepth)) throw new Error(`Bit depth PNG ${bitDepth} no soportado.`);
  if (colorType === 3 && !palette) throw new Error("PNG indexado sin paleta PLTE.");
  const nChannels = channelsOf(colorType);
  const stride = Math.ceil((width * nChannels * bitDepth) / 8);
  const bpp = Math.max(1, Math.floor((nChannels * bitDepth) / 8));
  const raw = await inflateZlib(idat);
  if (raw.length < height * (stride + 1)) throw new Error("PNG con datos incompletos.");
  unfilter(raw, width, height, bpp, stride);

  const rgba = new Uint8ClampedArray(width * height * 4);
  const scale = (v: number): number => (bitDepth === 16 || bitDepth === 8 ? v : Math.round((v * 255) / ((1 << bitDepth) - 1)));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 3) {
        const idx = sample(raw, stride, x, y, 0, bitDepth, 1);
        rgba[o] = palette![idx * 3];
        rgba[o + 1] = palette![idx * 3 + 1];
        rgba[o + 2] = palette![idx * 3 + 2];
        rgba[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else if (colorType === 0) {
        const g = scale(sample(raw, stride, x, y, 0, bitDepth, 1));
        rgba[o] = g;
        rgba[o + 1] = g;
        rgba[o + 2] = g;
        rgba[o + 3] = 255;
      } else if (colorType === 4) {
        const g = scale(sample(raw, stride, x, y, 0, bitDepth, 2));
        rgba[o] = g;
        rgba[o + 1] = g;
        rgba[o + 2] = g;
        rgba[o + 3] = scale(sample(raw, stride, x, y, 1, bitDepth, 2));
      } else if (colorType === 2) {
        rgba[o] = scale(sample(raw, stride, x, y, 0, bitDepth, 3));
        rgba[o + 1] = scale(sample(raw, stride, x, y, 1, bitDepth, 3));
        rgba[o + 2] = scale(sample(raw, stride, x, y, 2, bitDepth, 3));
        rgba[o + 3] = 255;
      } else {
        rgba[o] = scale(sample(raw, stride, x, y, 0, bitDepth, 4));
        rgba[o + 1] = scale(sample(raw, stride, x, y, 1, bitDepth, 4));
        rgba[o + 2] = scale(sample(raw, stride, x, y, 2, bitDepth, 4));
        rgba[o + 3] = scale(sample(raw, stride, x, y, 3, bitDepth, 4));
      }
    }
  }
  return { width, height, rgba };
}
