/**
 * Print export — PDF de imprenta 300dpi (Fase 1) + conversión CMYK con ICC
 * (Fase 2, motor Ghostscript WASM en Web Worker) + soft-proof (Fase 3).
 *
 * Arquitectura (no negociable, REQ Export Impresión): el diseño SIEMPRE vive
 * en RGB. El CMYK no es un estado del diseño ni del template: es una
 * transformación del artefacto exportado, en el momento de exportar. Este
 * módulo concentra la matemática pura (presets, escala de raster, placement)
 * y el armado del PDF físico en mm — sin DOM, para que la QA la importe en
 * Node igual que frameCapture. El rasterizado del frame vive en
 * frameCapture.rasterizeFrame; la orquestación (loop de frames, descarga,
 * worker) vive en EditorV2 + cmykEngine.
 *
 * Medidas SIEMPRE del archivo (feedback de producto): la página base mide
 * lo que el frame cae a 300dpi exactos (1080px → 91.44mm) + margen opcional
 * por lado. Sin presets A4/Carta ni orientación: la proporción es la del
 * frame. Sobre esa base el dialog puede ESCALAR el trabajo (paridad con el
 * "Scale To" de Illustrator: escribir 100mm → escala % → dpi efectivos con
 * warning si caen bajo 300), agregar SANGRADO (el diseño se estira para
 * cubrir corte + sangrado, como pide cualquier imprenta) y MARCAS DE CORTE
 * (8 trazos hairline fuera del sangrado).
 */

/** DPI fijo de producto: sin selector, evita confusiones (decisión del REQ). */
export const PRINT_DPI = 300;

export const MM_PER_INCH = 25.4;

export type PrintProfileId = "srgb" | "fogra39" | "gracol2013" | "iso_uncoated";
export type PrintCodec = "png" | "jpeg";

export interface PrintProfileMeta {
  id: PrintProfileId;
  label: string;
  desc: string;
  /** Archivo ICC esperado en /assets/print-engine/icc/ (null = sRGB puro). */
  iccFile: string | null;
  /** Sufijo de filename para el artefacto CMYK (null = sin sufijo). */
  suffix: string | null;
  /** Identificador de condición de impresión para el /OutputIntent del PDF
   *  CMYK (null = sRGB, sin intent). Es lo que muestra Acrobat en Salida. */
  condition: string | null;
  /** false mientras fetch-print-assets no confirme el .icc (se deshabilita en UI). */
  licensed: boolean;
}

export const PRINT_PROFILES: PrintProfileMeta[] = [
  { id: "srgb", label: "sRGB (digital)", desc: "PDF 300dpi en RGB, sin conversión", iccFile: null, suffix: null, condition: null, licensed: true },
  // FOGRA39 e ISO Uncoated se publican libremente por ECI (eci.org).
  { id: "fogra39", label: "FOGRA39 · Coated Europa", desc: "Offset estucado, estándar europeo", iccFile: "ISOcoated_v2_300_eci.icc", suffix: "FOGRA39", condition: "ISO Coated v2 300% (ECI)", licensed: true },
  { id: "iso_uncoated", label: "ISO Uncoated · FOGRA29", desc: "Offset sin estuco, menor saturación", iccFile: "UncoatedFOGRA29.icc", suffix: "ISO_Uncoated", condition: "ISO Uncoated FOGRA29", licensed: true },
  // GRACoL2013 (Idealliance CRPC7): redistribución con licencia — se publica
  // solo si el .icc fue colocado manualmente; fetch-print-assets lo detecta.
  { id: "gracol2013", label: "GRACoL2013 · Coated USA", desc: "Offset estucado, estándar USA", iccFile: "CGATS21_CRPC7.icc", suffix: "GRACoL2013", condition: "GRACoL2013 CRPC7", licensed: false },
];

export const CMYK_PROFILES = PRINT_PROFILES.filter(p => p.iccFile !== null) as Array<PrintProfileMeta & { iccFile: string; suffix: string }>;

/** Base pública donde fetch-print-assets deja el WASM + ICC + manifest. */
export const PRINT_ENGINE_BASE = "/assets/print-engine";

export interface PrintEngineManifest {
  engine: { file: string; ok: boolean; bytes?: number };
  profiles: Partial<Record<PrintProfileId, { file: string; ok: boolean; bytes?: number }>>;
}

export interface PrintOptions {
  /** Margen en blanco agregado por lado (mm). 0 = página = medida del frame. */
  marginMm: number;
  /** Calidad del JPEG interno (0.5–1). Se ignora con PNG. */
  jpegQuality: number;
  profile: PrintProfileId;
  codec: PrintCodec;
  /** Conservar alpha del frame (solo tiene efecto con sRGB + PNG). */
  transparent: boolean;
  /** Nombre base del archivo (sin extensión). Vacío = nombre del frame. */
  filename: string;
  /** Escala del trabajo: 1 = medidas del archivo a 300dpi exactos; >1
   *  agranda la página (dpi efectivos bajan — el dialog avisa si < 300). */
  scale: number;
  /** Sangrado por lado (mm): el diseño se estira para cubrir corte + 2×B. */
  bleedMm: number;
  /** Marcas de corte en las esquinas (el anillo de papel crece a B + 4mm). */
  cropMarks: boolean;
}

export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  marginMm: 0,
  jpegQuality: 0.92,
  profile: "srgb",
  codec: "png",
  transparent: false,
  filename: "",
  scale: 1,
  bleedMm: 0,
  cropMarks: false,
};

/** mm físicos que mide un lado de N px a 300dpi. */
export function pxToMm(px: number): number {
  return (px / PRINT_DPI) * MM_PER_INCH;
}

/** Límites de escala del trabajo: bajo 10% pierde sentido; sobre 5× el
 *  raster explota la memoria del canvas. El dialog acota con esto. */
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 5;

export function clampScale(scale: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}

export interface PrintGeometry {
  pageWmm: number;
  pageHmm: number;
  /** Multiplicador de raster sobre los px del frame (1 = dpi exactos; el
   *  dialog lo sube/baja cuando el usuario pide un tamaño físico). */
  scale: number;
  rasterW: number;
  rasterH: number;
  /** Tamaño dibujado de la imagen dentro de la página: corte + sangrado. */
  drawnWmm: number;
  drawnHmm: number;
  offXmm: number;
  offYmm: number;
  /** Corte (trim): medida final del diseño impreso, sin sangrado. */
  trimWmm: number;
  trimHmm: number;
  /** Sangrado por lado: el diseño se extiende más allá del corte. */
  bleedMm: number;
  /** Marcas de corte dibujadas fuera del sangrado. */
  cropMarks: boolean;
  /** Papel por lado alrededor del corte (margen blanco, o el anillo mínimo
   *  que exigen las marcas: sangrado + 4mm). */
  ringMm: number;
  /** DPI reales logrados sobre el área dibujada (peor eje). < 300 = warn. */
  effDpi: number;
}

export interface PrintGeometryExtra {
  /** Escala del trabajo (1 = medidas del archivo a 300dpi exactos). */
  scale?: number;
  /** Sangrado por lado en mm (0–20; el diseño se estira para cubrirlo). */
  bleedMm?: number;
  /** Marcas de corte: el anillo de papel crece a sangrado + 4mm si hace falta. */
  cropMarks?: boolean;
}

/** Página = medidas del archivo a 300dpi × escala + anillo de papel. El
 *  frame define la proporción; el sangrado estira el dibujo más allá del
 *  corte (y NECESITA papel: la página crece si el margen es menor) y las
 *  marcas de corte crecen el anillo a sangrado + 4mm si no alcanza. */
export function computePrintGeometry(frameW: number, frameH: number, marginMm = 0, extra: PrintGeometryExtra = {}): PrintGeometry {
  const fw = Math.max(1, Math.round(frameW));
  const fh = Math.max(1, Math.round(frameH));
  const scale = clampScale(extra.scale ?? 1);
  const bleed = Math.max(0, Math.min(20, extra.bleedMm ?? 0));
  const trimWmm = pxToMm(fw) * scale;
  const trimHmm = pxToMm(fh) * scale;
  const drawnWmm = trimWmm + bleed * 2;
  const drawnHmm = trimHmm + bleed * 2;
  const ring = Math.max(Math.max(0, marginMm), bleed + (extra.cropMarks ? 4 : 0));
  const rasterW = Math.max(1, Math.round(fw * scale));
  const rasterH = Math.max(1, Math.round(fh * scale));
  // dpi del DISEÑO (px del frame) sobre el tamaño REAL dibujado (sangrado
  // incluido). El raster se re-renderiza a escala (texto nítido), pero eso
  // no inventa píxeles: las fotos del diseño siguen cayendo a <300 dpi al
  // agrandar — y ese es exactamente el warning que muestra el dialog.
  const dpiW = fw / (drawnWmm / MM_PER_INCH);
  const dpiH = fh / (drawnHmm / MM_PER_INCH);
  return {
    pageWmm: trimWmm + ring * 2,
    pageHmm: trimHmm + ring * 2,
    scale,
    rasterW,
    rasterH,
    drawnWmm,
    drawnHmm,
    offXmm: (trimWmm + ring * 2 - drawnWmm) / 2,
    offYmm: (trimHmm + ring * 2 - drawnHmm) / 2,
    trimWmm,
    trimHmm,
    bleedMm: bleed,
    cropMarks: Boolean(extra.cropMarks),
    ringMm: ring,
    effDpi: Math.min(dpiW, dpiH),
  };
}

/** DPI efectivo post-raster para el reporte en UI (REQ F1 punto 6). */
export function effectiveDpi(rasterPx: number, drawnMm: number): number {
  return rasterPx / (drawnMm / MM_PER_INCH);
}

/** Fondo con el que se rasteriza: imprenta = blanco forzado si el frame es
 *  transparente (salvo sRGB+PNG con transparencia marcada explícita). */
export function printBackground(frameBackground: string | undefined, options: PrintOptions): string {
  if (options.transparent && options.profile === "srgb" && options.codec === "png") {
    return frameBackground && frameBackground !== "transparent" ? frameBackground : "transparent";
  }
  return frameBackground && frameBackground !== "transparent" ? frameBackground : "#ffffff";
}

export interface PrintPdfBuild {
  /** DataURL del raster (canvas.toDataURL) del frame ya rasterizado. */
  dataUrl: string;
  codec: PrintCodec;
  geometry: PrintGeometry;
}

/** Arma el PDF físico: página en mm (DPI real, no nominal), imagen
 *  centrada cubriendo corte + sangrado, marcas de corte opcionales, salida
 *  como bytes para descarga directa o para el worker de Ghostscript (Fase
 *  2). DOM-free salvo el import lazy de jsPDF. */
export async function buildPrintPdf(build: PrintPdfBuild): Promise<ArrayBuffer> {
  const { jsPDF } = await import("jspdf");
  const g = build.geometry;
  const pdf = new jsPDF({
    orientation: g.pageWmm > g.pageHmm ? "landscape" : "portrait",
    unit: "mm",
    format: [g.pageWmm, g.pageHmm],
    compress: true,
  });
  pdf.addImage(build.dataUrl, build.codec === "png" ? "PNG" : "JPEG", g.offXmm, g.offYmm, g.drawnWmm, g.drawnHmm);
  if (g.cropMarks) drawCropMarks(pdf, g);
  return pdf.output("arraybuffer") as ArrayBuffer;
}

/** Marcas de corte (paridad Illustrator): 2 trazos hairline negros por
 *  esquina del corte, fuera del sangrado — nacen a bleed+1mm del corte y
 *  miden 3mm. 0.088mm = 0.25pt, el hairline de imprenta. */
function drawCropMarks(pdf: { setDrawColor(r: number, g: number, b: number): void; setLineWidth(n: number): void; line(x1: number, y1: number, x2: number, y2: number): void }, g: PrintGeometry): void {
  const off = g.bleedMm + 1;
  const len = 3;
  const cx = g.pageWmm / 2;
  const cy = g.pageHmm / 2;
  const hw = g.trimWmm / 2;
  const hh = g.trimHmm / 2;
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.088);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const x = cx + sx * hw;
      const y = cy + sy * hh;
      pdf.line(x + sx * off, y, x + sx * (off + len), y);
      pdf.line(x, y + sy * off, x, y + sy * (off + len));
    }
  }
}

function sanitizeName(name: string): string {
  return (name || "frame").replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** nombre_300dpi.pdf (sRGB) / nombre_FOGRA39.pdf (CMYK, REQ F2). El nombre
 *  base lo escribe el usuario en el dialog; vacío = nombre del frame. */
export function printFilename(baseName: string, profile: PrintProfileId): string {
  const meta = PRINT_PROFILES.find(p => p.id === profile);
  const tail = meta?.suffix || "300dpi";
  return `${sanitizeName(baseName)}_${tail}.pdf`;
}
