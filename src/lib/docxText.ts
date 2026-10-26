/**
 * REQ-059 (bloque A) — Importación de guiones al teleprompter.
 *
 * Lee .txt / .md / .docx a texto plano SIN agregar dependencias al bundle:
 * el repo no tiene mammoth ni jszip, y un .docx es apenas un ZIP con un XML
 * adentro. Así que:
 *  1. se parsea el central directory del ZIP a mano (EOCD → entradas),
 *  2. se busca `word/document.xml`,
 *  3. se descomprime con `DecompressionStream("deflate-raw")` (nativo en
 *     navegadores modernos y Node ≥21) o se copia si está "stored",
 *  4. se convierte el XML a texto: `</w:p>` → salto de párrafo, `<w:br/>` →
 *     newline, `<w:tab/>` → tab, y después afuera todos los tags.
 *
 * Honesty rules: todo lo parseable es función pura y node-testable; si el
 * navegador no tiene `deflate-raw` el error es explícito (el usuario guarda
 * como .txt) — jamás se devuelve texto roto como si fuera válido.
 */

export class ScriptImportError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ScriptImportError";
  }
}

/** Nombre de la parte obligatoria de un .docx. */
export const DOCX_DOCUMENT_PART = "word/document.xml";

interface ZipEntry {
  method: number;
  dataOffset: number;
  compSize: number;
  name: string;
}

/** Lee el central directory y devuelve la entrada pedida (o null). */
export function findZipEntry(buf: ArrayBuffer, wantedName: string): ZipEntry | null {
  const total = buf.byteLength;
  if (total < 22) return null;
  const view = new DataView(buf);
  const EOCD_SIG = 0x06054b50;

  // El EOCD vive al final; su comentario puede tener hasta 65 535 bytes.
  let eocd = -1;
  const floor = Math.max(0, total - 65_558);
  for (let i = total - 22; i >= floor; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) return null;

  const entries = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true); // offset del central directory
  const u8 = new Uint8Array(buf);

  for (let n = 0; n < entries; n++) {
    if (ptr + 46 > total || view.getUint32(ptr, true) !== 0x02014b50) return null;
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = new TextDecoder().decode(u8.subarray(ptr + 46, ptr + 46 + nameLen));

    if (name === wantedName) {
      //cabecera local: su nombre/extra pueden diferir del central → releer longitudes.
      if (localOffset + 30 > total || view.getUint32(localOffset, true) !== 0x04034b50) return null;
      const localNameLen = view.getUint16(localOffset + 26, true);
      const localExtraLen = view.getUint16(localOffset + 28, true);
      return {
        method,
        compSize,
        name,
        dataOffset: localOffset + 30 + localNameLen + localExtraLen,
      };
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/** Infla una entrada de ZIP: 0 = stored (copia), 8 = deflate-raw nativo. */
export async function inflateZipEntry(buf: ArrayBuffer, entry: ZipEntry): Promise<Uint8Array> {
  const u8 = new Uint8Array(buf);
  const slice = u8.subarray(entry.dataOffset, entry.dataOffset + entry.compSize);
  if (entry.method === 0) return slice.slice();
  if (entry.method !== 8) {
    throw new ScriptImportError("DOCX_METHOD_UNSUPPORTED", "El .docx usa un método de compresión que este navegador no soporta.");
  }
  if (typeof DecompressionStream === "undefined") {
    throw new ScriptImportError("DOCX_NO_INFLATE", "Este navegador no puede descomprimir .docx. Guardá el guion como .txt e importalo.");
  }
  let raw: Uint8Array;
  try {
    const stream = new Blob([slice]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    raw = new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    throw new ScriptImportError("DOCX_CORRUPT", "El .docx está dañado o no es un Word válido.");
  }
  return raw;
}

/** `word/document.xml` → texto plano del documento. */
export function documentXmlToText(xml: string): string {
  // Párrafos: todo lo que cierra </w:p> es un salto de línea.
  const blocks = xml.split(/<\/w:p\s*>/);
  const out: string[] = [];
  for (const block of blocks) {
    let text = block
      .replace(/<w:br\s*\/>/gi, "\n")
      .replace(/<w:tab\s*\/>/gi, "\t")
      // Salta el contenido que NO es texto visible (códigos de campo, etc.)
      .replace(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/gi, "")
      .replace(/<[^>]+>/g, "");
    text = decodeXmlEntities(text);
    if (text.trim() !== "" || text.includes("\n")) out.push(text);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function safeFromCodePoint(n: number): string {
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

/** Markdown → texto para leer en voz alta: se van los marcadores, queda el contenido. */
export function stripMarkdown(md: string): string {
  return (md || "")
    .replace(/```[\s\S]*?```/g, "")           // bloques de código
    .replace(/^---+$/gm, "")                   // front matter / hr
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")  // imágenes → alt
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")   // links → texto
    .replace(/^#{1,6}\s+/gm, "")               // headings
    .replace(/^\s*>\s?/gm, "")                 // blockquote
    .replace(/^\s*[-*+]\s+/gm, "")             // bullets
    .replace(/^\s*\d+\.\s+/gm, "")             // listas numeradas
    .replace(/`([^`]*)`/g, "$1")               // inline code
    .replace(/(\*\*|__)(.*?)\1/g, "$2")         // bold
    .replace(/(\*|_)(.*?)\1/g, "$2")            // italics
    .replace(/~~(.*?)~~/g, "$1")                // strikethrough
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface ScriptFileLike {
  name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

/**
 * Punto de entrada del importador: resuelve por extensión y devuelve texto
 * plano listo para el teleprompter. Errores explícitos (ScriptImportError)
 * para que la UI los muestre sin romper.
 */
export async function scriptFileToText(file: ScriptFileLike): Promise<string> {
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".docx")) {
    const buf = await file.arrayBuffer();
    const entry = findZipEntry(buf, DOCX_DOCUMENT_PART);
    if (!entry) {
      throw new ScriptImportError("DOCX_NO_DOCUMENT", "El archivo no tiene la parte word/document.xml: no es un .docx válido.");
    }
    const xml = new TextDecoder("utf-8").decode(await inflateZipEntry(buf, entry));
    const text = documentXmlToText(xml);
    if (!text) {
      throw new ScriptImportError("DOCX_EMPTY", "El .docx no tiene texto legible (¿está vacío?).");
    }
    return text;
  }
  const raw = (await file.text()).replace(/\r\n/g, "\n");
  if (name.endsWith(".md") || name.endsWith(".markdown")) return stripMarkdown(raw);
  return raw.trim();
}
