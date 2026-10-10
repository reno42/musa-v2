/**
 * Buscatrazos local (image trace) — parameters.
 *
 * The tracer converts a raster into filled vector shapes entirely client-side.
 * Pipeline: quantize → denoise → boundary following → polygon simplify →
 * least-squares Bézier fit (Schneider, Graphics Gems). The UI sliders map to
 * geometric tolerances through the derivation formulas below, mirroring the
 * classic image-trace parameterization (Illustrator's Image Trace panel
 * semantics, reimplemented from published algorithm descriptions only).
 */

export type TraceMode = "blackAndWhite" | "grayscale" | "color" | "logo";
export type TracePalette = "limited" | "fullTone" | "automatic" | "documentLibrary";
export type TraceMethod = "abutting" | "overlapping";

/** An sRGB color, one entry per channel. */
export type RGB = [number, number, number];

export interface TraceParams {
  mode: TraceMode;
  /** B/N: píxeles con luma < threshold son negros (0–255). Default 128. */
  threshold: number;
  /** Solo Color: de dónde salen los colores. */
  palette: TracePalette;
  /** Limited: tamaño de paleta (Color) / nº de grises 2–256 (Grayscale). Default 6. */
  colors: number;
  /** Full Tone / Automatic: 0 pocos – 100 muchos colores. Default 50. */
  colorDetail: number;
  /** Document Library: colores sRGB de la librería (máx `colors` usados). */
  swatches: Array<[number, number, number]>;
  /** Fidelidad 0–100: qué tan pegado al píxel. Default 50. */
  paths: number;
  /** Corners 0–100. Default 75. */
  corners: number;
  /** Áreas < noise px se ignoran. Default 25. */
  noise: number;
  /** Adyacente: cada color su área, comparten borde. Superpuesto: apilado sin hairlines. */
  method: TraceMethod;
  /** Sin shape de fondo blanco (luma ≥ 245 en los tres canales). */
  ignoreWhite: boolean;
  /** Curvas casi rectas → líneas. */
  snapCurvesToLines: boolean;
  /** Create: áreas rellenas. */
  fills: boolean;
  /** Create: líneas finas como trazos centrados. */
  strokes: boolean;
  /** px del rasgo más ancho que se traza como stroke. Default 10. */
  strokeWidth: number;
  /** Modo logo: "#rrggbb"; vacío = autodetectar. (Fase 1–3: logo degrada a B/N+Otsu.) */
  logoColors: string[];
}

/** Illustrator's [Default]: black and white, threshold 128. */
export function defaultTraceParams(): TraceParams {
  return {
    mode: "blackAndWhite",
    threshold: 128,
    palette: "limited",
    colors: 6,
    colorDetail: 50,
    swatches: [],
    paths: 50,
    corners: 75,
    noise: 25,
    method: "abutting",
    ignoreWhite: false,
    snapCurvesToLines: false,
    fills: true,
    strokes: false,
    strokeWidth: 10,
    logoColors: [],
  };
}

/** Fill missing fields of a partial params object with the defaults (panel state helper). */
export function normalizeTraceParams(partial: Partial<TraceParams> | null | undefined): TraceParams {
  return { ...defaultTraceParams(), ...(partial ?? {}) };
}

/** The most pixels an image to trace may have (64 MP ≈ 256 MB decoded); larger is refused. */
export const MAX_PIXELS = 64 << 20;

/** Default ceiling on total anchor points of one trace (TooComplex past this). */
export const DEFAULT_MAX_ANCHORS = 200_000;

export interface TraceTolerances {
  /** Maximum distance (px) of polygon vertices from the pixel boundary. */
  polygonTolerance: number;
  /** Curve fitting tolerance (px). */
  fitTolerance: number;
  /** Turn angle (degrees) above which a polygon vertex stays a corner. */
  cornerAngle: number;
}

/**
 * UI sliders (0–100 fidelity scales) → geometric tolerances:
 * - polygonTolerance = 0.55 + 0.75·(1−paths/100) px
 * - fitTolerance     = 0.2  + 1.6·(1−paths/100) px
 * - cornerAngle      = 150  − 115·(corners/100) degrees
 */
export function deriveTolerances(params: TraceParams): TraceTolerances {
  const f = Math.min(1, Math.max(0, params.paths / 100));
  const c = Math.min(1, Math.max(0, params.corners / 100));
  return {
    polygonTolerance: 0.55 + 0.75 * (1 - f),
    fitTolerance: 0.2 + 1.6 * (1 - f),
    cornerAngle: 150 - 115 * c,
  };
}

/** Luma (perceptual, integer) of an RGBA pixel. */
export function luma(r: number, g: number, b: number): number {
  return ((r * 299 + g * 587 + b * 114 + 500) / 1000) | 0;
}

/** White means ≥ 245 on every channel (drop-background threshold). */
export function isWhite(c: RGB): boolean {
  return c[0] >= 245 && c[1] >= 245 && c[2] >= 245;
}

/** `#rrggbb` for a color triple. */
export function rgbToHex(c: RGB): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}
