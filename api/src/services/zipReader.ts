/**
 * Lector de ZIP mínimo para importar diseños (HTML + CSS + imágenes + fuentes).
 * Sin dependencias: lee el directorio central y descomprime solo las entradas que
 * se piden (método 0 = guardado, 8 = deflate) con DecompressionStream, que existe
 * en Workers y en Node 18+. Rechaza rutas que salen de la carpeta (zip-slip) y
 * archivos que se inflan de más (bombas zip).
 */

export const ZIP_LIMITS = { bytes: 50 * 1024 * 1024, entries: 400, entryBytes: 15 * 1024 * 1024, totalBytes: 80 * 1024 * 1024 };

export interface ZipEntry { path: string; method: number; compressedSize: number; size: number; offset: number }

export class ZipIndex {
  readonly entries = new Map<string, ZipEntry>();
  private readonly data: Uint8Array;
  constructor(data: Uint8Array) { this.data = data; }

  has(path: string) { return this.entries.has(normalizeZipPath(path) || "\u0000"); }
  list() { return [...this.entries.keys()]; }

  async read(path: string): Promise<Uint8Array> {
    const entry = this.entries.get(normalizeZipPath(path) || "\u0000");
    if (!entry) throw new Error(`El ZIP no trae «${path}»`);
    const view = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
    if (view.getUint32(entry.offset, true) !== 0x04034b50) throw new Error("ZIP dañado (cabecera local)");
    const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
    const raw = this.data.subarray(start, start + entry.compressedSize);
    if (entry.method === 0) return raw.slice();
    if (entry.method !== 8) throw new Error(`«${entry.path}» usa una compresión no soportada; vuelve a crear el ZIP con la opción estándar`);
    const out = await new Response(new Blob([raw as unknown as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
    if (out.byteLength > ZIP_LIMITS.entryBytes) throw new Error(`«${entry.path}» pesa más de 15 MB`);
    return new Uint8Array(out);
  }

  async text(path: string) { return new TextDecoder("utf-8").decode(await this.read(path)); }
}

/** Ruta dentro del ZIP sin «..», sin barra inicial y con «/». Vacío si sale de la carpeta. */
export function normalizeZipPath(path: string) {
  const parts: string[] = [];
  for (const part of String(path || "").replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!parts.length) return ""; parts.pop(); continue; }
    parts.push(part);
  }
  return parts.join("/");
}

export function isZip(bytes: Uint8Array) {
  return bytes.length > 22 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5) ;
}

export function openZip(bytes: Uint8Array): ZipIndex {
  if (bytes.length > ZIP_LIMITS.bytes) throw new Error("El ZIP supera el límite de 50 MB");
  if (!isZip(bytes)) throw new Error("El archivo no es un ZIP válido");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ZIP dañado: no se encontró su índice");
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  if (count > ZIP_LIMITS.entries) throw new Error(`El ZIP trae ${count} archivos; el máximo es ${ZIP_LIMITS.entries}`);
  const zip = new ZipIndex(bytes);
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw new Error("ZIP dañado (directorio central)");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true), extraLen = view.getUint16(at + 30, true), commentLen = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const rawName = bytes.subarray(at + 46, at + 46 + nameLen);
    const name = (flags & 0x800 ? new TextDecoder("utf-8") : new TextDecoder("utf-8", { fatal: false })).decode(rawName);
    at += 46 + nameLen + extraLen + commentLen;
    if (flags & 1) throw new Error("El ZIP tiene contraseña; créalo sin cifrar");
    if (name.endsWith("/") || /(^|\/)__MACOSX\//.test(name) || /(^|\/)\.DS_Store$/.test(name)) continue;
    const path = normalizeZipPath(name);
    if (!path) throw new Error("El ZIP trae rutas que salen de su carpeta");
    if (size > ZIP_LIMITS.entryBytes) throw new Error(`«${path}» pesa más de 15 MB`);
    total += size;
    if (total > ZIP_LIMITS.totalBytes) throw new Error("El ZIP descomprimido supera 80 MB");
    if (compressedSize > 0 && size / compressedSize > 200) throw new Error("El ZIP tiene un archivo que se infla de forma anormal");
    zip.entries.set(path, { path, method, compressedSize, size, offset });
  }
  return zip;
}

/** El HTML principal: index.html más cercano a la raíz, si no el primer .html. */
export function mainHtmlPath(zip: ZipIndex) {
  const html = zip.list().filter((p) => /\.html?$/i.test(p)).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  return html.find((p) => /(^|\/)index\.html?$/i.test(p)) || html[0] || "";
}
