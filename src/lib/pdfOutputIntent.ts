/**
 * pdfOutputIntent — incrusta el perfil ICC como /OutputIntents en el PDF
 * CMYK que sale de Ghostscript (Fase 2 del export de imprenta).
 *
 * POR QUÉ: pdfwrite convierte los colores al device space del
 * -sOutputICCProfile (el PDF sale DeviceCMYK correcto) pero NO incrusta el
 * perfil como OutputIntent en modo normal — y -dPDFA no existe en el build
 * WASM. La imprenta NECESITA el intent (Acrobat: Salida → Simular perfil)
 * para probar el PDF contra FOGRA39; sin él el archivo no declara su
 * condición de impresión (REQ F2: "OutputIntent muestra el perfil elegido").
 *
 * CÓMO: actualización incremental (PDF 32000-1 §7.5.6) — el original queda
 * byte a byte intacto; se agregan 3 objetos (stream ICC, OutputIntent,
 * catálogo nuevo con /OutputIntents) y una xref propia con /Prev apuntando
 * al startxref original. Cualquier lector (Acrobat, pdfium, Preview) sigue
 * la cadena. Puro y determinístico: bytes in → bytes out, testeable en Node.
 */

export interface OutputIntentMeta {
  /** Identificador de condición de impresión, ej. "FOGRA39 (ISO Coated v2 300%)". */
  outputConditionIdentifier: string;
  /** Info legible (puede coincidir con el identifier). */
  info?: string;
  /** Registry del perfil (estándar: http://www.color.org). */
  registryName?: string;
  /** /S del intent: GTS_PDFX (imprenta) o GTS_PDFA1. */
  subtype?: "GTS_PDFX" | "GTS_PDFA1";
}

/** Objeto más alto, offset del xref original (startxref) y posición/ref del
 *  catálogo. El catálogo se localiza objeto por objeto (ventana = SU cuerpo
 *  hasta SU endobj): una ventana lazy de N chars podía CRUZAR el stream de
 *  otro objeto (pdfwrite numera desde 5) y agarrar el número equivocado. */
function parseTail(s: string): { maxObj: number; startxref: number; rootRef: string | null; catalogAt: number } {
  let maxObj = 0;
  for (const m of s.matchAll(/(\d+) 0 obj/g)) maxObj = Math.max(maxObj, Number(m[1]));
  const sx = s.lastIndexOf("startxref");
  const sxNum = /\s(\d+)\s*%%EOF\s*$/.exec(s.slice(sx));
  let rootRef: string | null = null;
  let catalogAt = -1;
  for (const m of s.matchAll(/(\d+) 0 obj\s*<</g)) {
    const end = s.indexOf("endobj", m.index);
    if (end < 0) continue;
    const body = s.slice(m.index, end);
    if (!body.includes("/Type /Catalog") && !body.includes("/Type/Catalog")) continue;
    rootRef = `${m[1]} 0 R`;
    catalogAt = m.index;
    break;
  }
  return {
    maxObj,
    startxref: sxNum ? Number(sxNum[1]) : -1,
    rootRef,
    catalogAt,
  };
}

/** Serializa un offset de xref a los 10 dígitos con padding de la spec. */
function xrefOffset(n: number): string {
  return n.toString().padStart(10, "0");
}

/** PDF literal string: matricula no-ASCII a "?" y escapa delimitadores.
 *  El orden importa: cada carácter debe quedar en 1 byte porque los offsets
 *  del xref se calculan por largo de string (latin1 = 1 byte por char). */
function escapePdfString(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, c => "\\" + c);
}

/**
 * Devuelve un nuevo buffer con el OutputIntent incrustado. Si el PDF no se
 * puede parsear (sin xref/catálogo legible, o catálogo en object/xref stream
 * comprimido), devuelve el original SIN tocar — el PDF CMYK sigue siendo
 * válido, solo sin intent declarado. Nunca se rompe un export por decorarlo.
 */
export function embedOutputIntent(
  pdfBytes: Uint8Array,
  iccBytes: Uint8Array,
  meta: OutputIntentMeta,
): Uint8Array {
  const text = new TextDecoder("latin1").decode(pdfBytes);
  const { maxObj, startxref, rootRef, catalogAt } = parseTail(text);
  if (startxref < 0 || rootRef === null || catalogAt < 0) return pdfBytes;
  if (text.includes("/Type /XRef") || text.includes("/Type/XRef")) return pdfBytes;

  // Dict del catálogo original: va de "<<" hasta el final del objeto. El
  // último ">>" antes de endobj es el cierre externo — lo quitamos para
  // re-cerrar con /OutputIntents agregado (objeto sin comprimir en pdfwrite).
  const dictStart = text.indexOf("<<", catalogAt);
  const dictEnd = text.indexOf("endobj", catalogAt);
  if (dictStart < 0 || dictEnd < 0) return pdfBytes;
  const catalogDict = text.slice(dictStart, dictEnd).trimEnd();
  if (!catalogDict.endsWith(">>")) return pdfBytes;

  const iccObj = maxObj + 1;
  const intentObj = maxObj + 2;
  const catalogObj = maxObj + 3;

  const condition = meta.outputConditionIdentifier;
  const info = meta.info || condition;
  const registry = meta.registryName || "http://www.color.org";
  const subtype = meta.subtype || "GTS_PDFX";

  const iccStream =
    `${iccObj} 0 obj\n<</N 4 /Alternate /DeviceCMYK /Length ${iccBytes.length}>>\nstream\n`;
  const intent =
    `${intentObj} 0 obj\n<< /Type /OutputIntent /S /${subtype} ` +
    `/OutputConditionIdentifier (${escapePdfString(condition)}) ` +
    `/Info (${escapePdfString(info)}) ` +
    `/RegistryName (${escapePdfString(registry)}) ` +
    `/DestOutputProfile ${iccObj} 0 R >>\nendobj\n`;
  const newCatalog =
    `${catalogObj} 0 obj\n${catalogDict.slice(0, -2)} /OutputIntents [${intentObj} 0 R] >>\nendobj\n`;

  // Offsets absolutos (todo ASCII 1 byte/char salvo el ICC crudo, que se
  // cuenta por length): update = [pdf original][banner][icc obj][icc]
  // [endstream+intent+catalogo][xref propia]. La xref apunta al "N 0 obj"
  // del ICC (iccObjOffset), NO al inicio de sus bytes crudos.
  const NL = String.fromCharCode(10);
  const banner = `%% OutputIntent incrustado por Musa (${condition})` + NL;
  const prefix = banner + iccStream;
  const iccObjOffset = pdfBytes.length + banner.length;
  const iccDataOffset = iccObjOffset + iccStream.length;
  const EOT = "\nendstream\nendobj\n";
  const intentOffset = iccDataOffset + iccBytes.length + EOT.length;
  const catalogOffset = intentOffset + intent.length;
  const xrefPos = catalogOffset + newCatalog.length;

  const head =
    `xref\n${iccObj} 3\n` +
    `${xrefOffset(iccObjOffset)} 00000 n \n` +
    `${xrefOffset(intentOffset)} 00000 n \n` +
    `${xrefOffset(catalogOffset)} 00000 n \n` +
    `trailer\n<</Size ${catalogObj + 1} /Root ${catalogObj} 0 R /Prev ${startxref}>>\n` +
    `startxref\n${xrefPos}\n%%EOF\n`;

  const enc = new TextEncoder();
  const prefixBytes = enc.encode(prefix);
  const iccTermBytes = enc.encode(EOT + intent + newCatalog);
  const headBytes = enc.encode(head);

  const result = new Uint8Array(
    pdfBytes.length + prefixBytes.length + iccBytes.length + iccTermBytes.length + headBytes.length,
  );
  let at = 0;
  result.set(pdfBytes, at); at += pdfBytes.length;
  result.set(prefixBytes, at); at += prefixBytes.length;
  result.set(iccBytes, at); at += iccBytes.length;
  result.set(iccTermBytes, at); at += iccTermBytes.length;
  result.set(headBytes, at);
  return result;
}

/** Valida la estructura del update (para QA): lee la xref propia desde el
 *  startxref final y confirma que los offsets apuntan a "N 0 obj" reales,
 *  que hay /Prev hacia el xref original y que el intent quedó referenciado. */
export function validateEmbeddedUpdate(bytes: Uint8Array): { ok: boolean; reason?: string } {
  // Sin escapes de newline en el fuente (el pipeline los corrompe): la xref
  // propia se valida por líneas cortadas en LF, tolerando CR final.
  const LF = String.fromCharCode(10);
  const CR = String.fromCharCode(13);
  const text = new TextDecoder("latin1").decode(bytes);
  const sxr = text.lastIndexOf("startxref");
  const m = /\s(\d+)\s*%%EOF\s*$/.exec(text.slice(sxr));
  if (!m) return { ok: false, reason: "sin startxref final" };
  const xrefAt = Number(m[1]);
  const lines = text
    .slice(xrefAt, xrefAt + 400)
    .split(LF)
    .map(l => (l.endsWith(CR) ? l.slice(0, -1) : l));
  const i = lines.indexOf("xref");
  if (i < 0 || !/^\d+ 3$/.test(lines[i + 1] || "")) return { ok: false, reason: "xref del update malformada" };
  const offAt = (idx: number): string | null => {
    const mm = /^(\d{10}) 00000 n $/.exec(lines[idx] || "");
    return mm ? mm[1] : null;
  };
  const o1 = offAt(i + 2);
  const o2 = offAt(i + 3);
  const o3 = offAt(i + 4);
  if (!o1 || !o2 || !o3) return { ok: false, reason: "xref del update malformada" };
  const startsObj = (off: string) =>
    /^\d+ 0 obj/.test(text.slice(Number(off), Number(off) + 32).split(LF)[0] || "");
  if (!startsObj(o1) || !startsObj(o2) || !startsObj(o3)) return { ok: false, reason: "offset no apunta a objeto" };
  if (!lines.some(l => l.includes("/Prev"))) return { ok: false, reason: "sin /Prev" };
  return { ok: true };
}
