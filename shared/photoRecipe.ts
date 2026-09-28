/**
 * photoRecipe — esquema de receta fotográfica no destructiva (REQ-PHOTO-PLATFORM-001).
 *
 * Modelo Lightroom: la foto original es inmutable; una edición es una RECETA
 * versionada (lista canónica de operaciones + máscaras + geometría) que el
 * motor (WebGL2, src/lib/photoEngine.ts) aplica al vuelo. Este módulo es PURO
 * (cero DOM/GL) para que el API, el editor y los tests de QA compartan la
 * misma verdad: defaults, clamps, orden canónico, LUTs de curvas y la matriz
 * de geometría (crop/straighten/rotar/voltear).
 *
 * La receta viaja serializada en JSON (photo_versions.recipe_json) y, en el
 * lienzo del diseño, como atributo `data-photo-recipe` en base64url
 * (encodeRecipeAttr/decodeRecipeAttr) para reabrir la foto editable.
 */

// ── Versionado ──────────────────────────────────────────────────────────────

export const RECIPE_SCHEMA_VERSION = 1;

// ── Tipos de operaciones globales (orden canónico; una instancia por tipo) ──

export type OpType =
  | "basic"
  | "white_balance"
  | "color"
  | "hsl"
  | "tone_curve"
  | "color_grading"
  | "detail"
  | "effects"
  | "bw";

/** Orden canónico: normalizeRecipe reordena SIEMPRE a esta secuencia, así dos
 *  recetas con las mismas ops son byte-idénticas al compararlas. */
export const OP_ORDER: OpType[] = [
  "basic", "white_balance", "color", "hsl", "tone_curve",
  "color_grading", "detail", "effects", "bw",
];

export const HSL_BANDS = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"] as const;
export type HslBandKey = (typeof HSL_BANDS)[number];

/** Centro de cada banda en grados (falloff gaussiano de ±35°). */
export const HSL_BAND_HUE: Record<HslBandKey, number> = {
  red: 0, orange: 30, yellow: 60, green: 120, aqua: 180, blue: 240, purple: 280, magenta: 320,
};

export interface BasicParams { exposure: number; contrast: number; highlights: number; shadows: number; whites: number; blacks: number }
export interface WhiteBalanceParams { temp: number; tint: number }
export interface ColorParams { vibrance: number; saturation: number }
export interface HslBandParams { h: number; s: number; l: number }
export type HslParams = Record<HslBandKey, HslBandParams>;
export interface CurvePoint { x: number; y: number }
export interface ToneCurveParams { rgb: CurvePoint[]; r: CurvePoint[]; g: CurvePoint[]; b: CurvePoint[] }
export interface GradingRegion { hue: number; sat: number }
export interface ColorGradingParams { shadows: GradingRegion; midtones: GradingRegion; highlights: GradingRegion; blend: number; balance: number }
export interface DetailParams { texture: number; clarity: number; sharpen: number; denoise: number }
export interface EffectsParams { grain: number; vignetteAmount: number; vignetteMidpoint: number; vignetteFeather: number }
export interface BwParams { enabled: boolean; mix: { r: number; g: number; b: number } }

export interface PhotoOperation<P = unknown> {
  type: OpType;
  enabled: boolean;
  params: P;
}

// ── Geometría (crop/straighten/rotar/voltear) ──

export interface GeometryParams {
  /** Rectángulo de crop NORMALIZADO (0..1) sobre el lienzo ya rotado/recto. */
  crop: { x: number; y: number; w: number; h: number };
  /** Giros de 90° en sentido horario (0..3). */
  rotate90: 0 | 1 | 2 | 3;
  flipH: boolean;
  flipV: boolean;
  /** Enderezar, en grados (-45..45). */
  straighten: number;
}

// ── Máscaras ──

export type MaskKind = "radial" | "linear" | "brush";

/** Subconjunto de ajustes que una máscara puede llevar (fase 1). */
export interface MaskAdjustments {
  exposure: number;
  contrast: number;
  saturation: number;
  temp: number;
  tint: number;
}

export interface PhotoMask {
  id: string;
  kind: MaskKind;
  enabled: boolean;
  feather: number;   // 0 dura .. 1 suave
  invert: boolean;
  /** radial: centro cx,cy y radio r (0..1.5, normalizado al lado menor). */
  cx: number; cy: number; r: number;
  /** linear: extremos del degradado (0..1). */
  x1: number; y1: number; x2: number; y2: number;
  /** brush: el trazo vive en un canvas del overlay; la receta solo registra
   *  que existe (el píxel no va a la DB). Todas las máscaras brush comparten
   *  UN lienzo de pintura (limitación documentada de fase 1). */
  adjustments: MaskAdjustments;
}

// ── Receta ──

export interface PhotoRecipe {
  schemaVersion: number;
  ops: PhotoOperation<BasicParams>[] | PhotoOperation[];
  masks: PhotoMask[];
  geometry: GeometryParams;
}

export type AnyRecipe = {
  schemaVersion: number;
  ops: Array<{ type: OpType; enabled: boolean; params: Record<string, unknown> }>;
  masks: PhotoMask[];
  geometry: GeometryParams;
};

// ── Defaults ──

export const DEFAULT_BASIC: BasicParams = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 };
export const DEFAULT_WB: WhiteBalanceParams = { temp: 0, tint: 0 };
export const DEFAULT_COLOR: ColorParams = { vibrance: 0, saturation: 0 };
export const DEFAULT_HSL: HslParams = HSL_BANDS.reduce((acc, band) => {
  acc[band] = { h: 0, s: 0, l: 0 };
  return acc;
}, {} as HslParams);
export const DEFAULT_CURVE: ToneCurveParams = { rgb: [], r: [], g: [], b: [] };
export const DEFAULT_GRADING: ColorGradingParams = {
  shadows: { hue: 220, sat: 0 }, midtones: { hue: 40, sat: 0 }, highlights: { hue: 50, sat: 0 },
  blend: 50, balance: 0,
};
export const DEFAULT_DETAIL: DetailParams = { texture: 0, clarity: 0, sharpen: 0, denoise: 0 };
export const DEFAULT_EFFECTS: EffectsParams = { grain: 0, vignetteAmount: 0, vignetteMidpoint: 50, vignetteFeather: 50 };
export const DEFAULT_BW: BwParams = { enabled: false, mix: { r: 100, g: 100, b: 100 } };
export const DEFAULT_GEOMETRY: GeometryParams = { crop: { x: 0, y: 0, w: 1, h: 1 }, rotate90: 0, flipH: false, flipV: false, straighten: 0 };
export const DEFAULT_MASK_ADJUSTMENTS: MaskAdjustments = { exposure: 0, contrast: 0, saturation: 0, temp: 0, tint: 0 };

export function createDefaultRecipe(): AnyRecipe {
  return {
    schemaVersion: RECIPE_SCHEMA_VERSION,
    ops: [
      { type: "basic", enabled: true, params: { ...DEFAULT_BASIC } },
      { type: "white_balance", enabled: true, params: { ...DEFAULT_WB } },
      { type: "color", enabled: true, params: { ...DEFAULT_COLOR } },
      { type: "hsl", enabled: true, params: JSON.parse(JSON.stringify(DEFAULT_HSL)) },
      { type: "tone_curve", enabled: true, params: JSON.parse(JSON.stringify(DEFAULT_CURVE)) },
      { type: "color_grading", enabled: true, params: JSON.parse(JSON.stringify(DEFAULT_GRADING)) },
      { type: "detail", enabled: true, params: { ...DEFAULT_DETAIL } },
      { type: "effects", enabled: true, params: { ...DEFAULT_EFFECTS } },
      { type: "bw", enabled: true, params: JSON.parse(JSON.stringify(DEFAULT_BW)) },
    ],
    masks: [],
    geometry: JSON.parse(JSON.stringify(DEFAULT_GEOMETRY)),
  };
}

// ── Clamps ──

const clamp = (v: unknown, lo: number, hi: number, fallback = 0): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(hi, Math.max(lo, n));
};
const clampBool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

function clampCurve(points: unknown): CurvePoint[] {
  if (!Array.isArray(points)) return [];
  const cleaned = points
    .filter((p): p is CurvePoint => !!p && typeof (p as CurvePoint).x === "number" && typeof (p as CurvePoint).y === "number")
    .map(p => ({ x: clamp(p.x, 0, 255, 0), y: clamp(p.y, 0, 255, 0) }));
  return cleaned.slice(0, 12);
}

function normalizeMask(raw: unknown, index: number): PhotoMask | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const kind: MaskKind = m.kind === "linear" || m.kind === "brush" || m.kind === "radial" ? m.kind : "radial";
  const adj = (m.adjustments || {}) as Record<string, unknown>;
  return {
    id: typeof m.id === "string" && m.id ? m.id.slice(0, 40) : `mask_${index + 1}`,
    kind,
    enabled: clampBool(m.enabled, true),
    feather: clamp(m.feather, 0, 1, 0.5),
    invert: clampBool(m.invert, false),
    cx: clamp(m.cx, -0.5, 1.5, 0.5),
    cy: clamp(m.cy, -0.5, 1.5, 0.5),
    r: clamp(m.r, 0.01, 1.5, 0.4),
    x1: clamp(m.x1, 0, 1, 0.2),
    y1: clamp(m.y1, 0, 1, 0.5),
    x2: clamp(m.x2, 0, 1, 0.8),
    y2: clamp(m.y2, 0, 1, 0.5),
    adjustments: {
      exposure: clamp(adj.exposure, -100, 100),
      contrast: clamp(adj.contrast, -100, 100),
      saturation: clamp(adj.saturation, -100, 100),
      temp: clamp(adj.temp, -100, 100),
      tint: clamp(adj.tint, -100, 100),
    },
  };
}

/**
 * normalizeRecipe — completa ops faltantes con defaults, reordena al orden
 * canónico, clampa TODO número y descarta campos desconocidos. Es la única
 * puerta de entrada a la receta: el motor y el API asumen su salida.
 */
export function normalizeRecipe(input: unknown): AnyRecipe {
  const base = createDefaultRecipe();
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const rawOps = Array.isArray(raw.ops) ? raw.ops : [];

  for (const rawOp of rawOps) {
    if (!rawOp || typeof rawOp !== "object") continue;
    const op = rawOp as Record<string, unknown>;
    const type = OP_ORDER.find(t => t === op.type);
    if (!type) continue;
    const target = base.ops.find(o => o.type === type)!;
    target.enabled = clampBool(op.enabled, true);
    const p = (op.params || {}) as Record<string, unknown>;
    switch (type) {
      case "basic":
        target.params = {
          exposure: clamp(p.exposure, -100, 100), contrast: clamp(p.contrast, -100, 100),
          highlights: clamp(p.highlights, -100, 100), shadows: clamp(p.shadows, -100, 100),
          whites: clamp(p.whites, -100, 100), blacks: clamp(p.blacks, -100, 100),
        };
        break;
      case "white_balance":
        target.params = { temp: clamp(p.temp, -100, 100), tint: clamp(p.tint, -100, 100) };
        break;
      case "color":
        target.params = { vibrance: clamp(p.vibrance, -100, 100), saturation: clamp(p.saturation, -100, 100) };
        break;
      case "hsl": {
        const bands = {} as HslParams;
        for (const band of HSL_BANDS) {
          const b = (p as Record<string, unknown>)[band] as Record<string, unknown> | undefined;
          bands[band] = {
            h: clamp(b?.h, -30, 30), s: clamp(b?.s, -100, 100), l: clamp(b?.l, -100, 100),
          };
        }
        target.params = bands;
        break;
      }
      case "tone_curve":
        target.params = {
          rgb: clampCurve(p.rgb), r: clampCurve(p.r), g: clampCurve(p.g), b: clampCurve(p.b),
        };
        break;
      case "color_grading": {
        const region = (v: unknown, defHue: number): GradingRegion => {
          const r = (v || {}) as Record<string, unknown>;
          return { hue: clamp(r.hue, 0, 360, defHue), sat: clamp(r.sat, 0, 100) };
        };
        const g = (p || {}) as Record<string, unknown>;
        target.params = {
          shadows: region(g.shadows, 220), midtones: region(g.midtones, 40), highlights: region(g.highlights, 50),
          blend: clamp(g.blend, 0, 100, 50), balance: clamp(g.balance, -100, 100),
        };
        break;
      }
      case "detail":
        target.params = {
          texture: clamp(p.texture, -100, 100), clarity: clamp(p.clarity, -100, 100),
          sharpen: clamp(p.sharpen, 0, 100), denoise: clamp(p.denoise, 0, 100),
        };
        break;
      case "effects":
        target.params = {
          grain: clamp(p.grain, 0, 100),
          vignetteAmount: clamp(p.vignetteAmount, -100, 100),
          vignetteMidpoint: clamp(p.vignetteMidpoint, 0, 100, 50),
          vignetteFeather: clamp(p.vignetteFeather, 0, 100, 50),
        };
        break;
      case "bw": {
        const mix = (p.mix || {}) as Record<string, unknown>;
        target.params = {
          enabled: clampBool(p.enabled, false),
          mix: { r: clamp(mix.r, 0, 100, 100), g: clamp(mix.g, 0, 100, 100), b: clamp(mix.b, 0, 100, 100) },
        };
        break;
      }
    }
  }

  const rawMasks = Array.isArray(raw.masks) ? raw.masks : [];
  const masks = rawMasks
    .map((m, i) => normalizeMask(m, i))
    .filter((m): m is PhotoMask => m !== null)
    .slice(0, 6);

  const g = (raw.geometry || {}) as Record<string, unknown>;
  const crop = (g.crop || {}) as Record<string, unknown>;
  const cx = clamp(crop.x, 0, 1, 0);
  const cy = clamp(crop.y, 0, 1, 0);
  const geometry: GeometryParams = {
    crop: { x: cx, y: cy, w: clamp(crop.w, 0.05, 1 - cx, 1), h: clamp(crop.h, 0.05, 1 - cy, 1) },
    rotate90: (((clamp(g.rotate90, 0, 3) | 0) % 4) + 4) % 4 as GeometryParams["rotate90"],
    flipH: clampBool(g.flipH, false),
    flipV: clampBool(g.flipV, false),
    straighten: clamp(g.straighten, -45, 45),
  };

  return { schemaVersion: RECIPE_SCHEMA_VERSION, ops: base.ops, masks, geometry };
}

// ── Curvas: puntos → LUT de 256 ──

const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

/**
 * buildCurveLut — convierte puntos de control en una LUT de 256 entradas
 * monótona no decreciente. [] o [(0,0),(255,255)] → identidad exacta;
 * 2 puntos → recta; ≥3 → spline Catmull-Rom.
 */
export function buildCurveLut(points: CurvePoint[]): Uint8Array {
  const lut = new Uint8Array(256);
  let pts = (points || []).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map(p => ({ x: Math.min(255, Math.max(0, Math.round(p.x))), y: Math.min(255, Math.max(0, Math.round(p.y))) }));
  // Sin puntos no hay curva: identidad (resetear un canal NO debe aplastar
  // la foto a negro — el anchor implícito de abajo heredaría el y=0).
  if (pts.length === 0) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }
  pts.sort((a, b) => a.x - b.x);
  // 2 puntos = recta EXACTA (Catmull-Rom con anclas duplicadas cuelga un
  // escalón por debajo de la diagonal y rompería la identidad).
  if (pts.length === 2) {
    const [a, b] = pts;
    const span = Math.max(1, b.x - a.x);
    let straight = 0;
    for (let x = 0; x < 256; x++) {
      const t = Math.min(1, Math.max(0, (x - a.x) / span));
      const yc = Math.min(255, Math.max(0, Math.round(a.y + (b.y - a.y) * t)));
      straight = Math.max(straight, yc);
      lut[x] = straight;
    }
    return lut;
  }
  // Anclas implícitas en los extremos cuando la curva no las toca.
  if (pts.length === 0 || pts[0].x > 0) pts = [{ x: 0, y: pts.length ? pts[0].y : 0 }, ...pts];
  if (pts.length < 2 || pts[pts.length - 1].x < 255) pts = [...pts, { x: 255, y: pts[pts.length - 1].y }];

  let runningMax = 0;
  for (let x = 0; x < 256; x++) {
    // segmento i tal que pts[i].x <= x <= pts[i+1].x
    let i = 0;
    while (i < pts.length - 2 && pts[i + 1].x < x) i++;
    const p1 = pts[i];
    const p2 = pts[i + 1];
    let y: number;
    if (p2.x === p1.x) {
      y = p2.y;
    } else {
      const t = (x - p1.x) / (p2.x - p1.x);
      const p0 = pts[Math.max(0, i - 1)];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      y = catmullRom(p0.y, p1.y, p2.y, p3.y, t);
    }
    const yc = Math.min(255, Math.max(0, Math.round(y)));
    runningMax = Math.max(runningMax, yc); // monotonía: una curva de tono no puede invertir
    lut[x] = runningMax;
  }
  return lut;
}

// ── Geometría: matriz de muestreo fuente + tamaño de salida ──

export interface SourceTransform {
  /** 3x3 row-major: srcPx = M · [outPx, 1] en espacio PÍXEL del source. */
  mat: [number, number, number, number, number, number, number, number, number];
  outW: number;
  outH: number;
}

function mul3(a: number[], b: number[]): number[] {
  const out = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[r * 3 + k] * b[k * 3 + c];
      out[r * 3 + c] = s;
    }
  }
  return out;
}
const translation = (tx: number, ty: number): number[] => [1, 0, tx, 0, 1, ty, 0, 0, 1];
const scaleM = (sx: number, sy: number): number[] => [sx, 0, 0, 0, sy, 0, 0, 0, 1];
const rotation = (rad: number): number[] => [Math.cos(rad), -Math.sin(rad), 0, Math.sin(rad), Math.cos(rad), 0, 0, 0, 1];
const flipX = (): number[] => [-1, 0, 1, 0, 1, 0, 0, 0, 1];
const flipY = (): number[] => [1, 0, 0, 0, -1, 1, 0, 0, 1];

/**
 * resolveOutputSize — dimensiones del lienzo de salida tras crop/rot90.
 * (pure, QA)
 */
export function resolveOutputSize(srcW: number, srcH: number, geometry: GeometryParams): { w: number; h: number } {
  const crop = geometry.crop;
  const w = Math.max(1, Math.round(srcW * crop.w));
  const h = Math.max(1, Math.round(srcH * crop.h));
  return geometry.rotate90 % 2 === 1 ? { w: h, h: w } : { w, h };
}

/**
 * composeGeometryMatrix — mapea cada píxel de la SALIDA (ya cropeada) al
 * píxel del ORIGINAL que lo alimenta: crop → straighten (con auto-fill) →
 * rotate90 → flips. Todo en espacio píxel para no distorsionar aspect.
 * (pure, QA)
 */
export function composeGeometryMatrix(srcW: number, srcH: number, geometry: GeometryParams): SourceTransform {
  const crop = geometry.crop;
  const cropW = srcW * crop.w;
  const cropH = srcH * crop.h;

  // 1. output px → crop px (identidad; la salida ES el crop)
  let m = translation(0, 0);

  // 2. straighten alrededor del centro del crop, con zoom de auto-relleno
  if (geometry.straighten !== 0) {
    const theta = (geometry.straighten * Math.PI) / 180;
    const cos = Math.abs(Math.cos(theta));
    const sin = Math.abs(Math.sin(theta));
    const s = Math.max(
      (cropW * cos + cropH * sin) / cropW,
      (cropW * sin + cropH * cos) / cropH,
    );
    m = mul3(m, translation(cropW / 2, cropH / 2));
    m = mul3(m, scaleM(1 / s, 1 / s));
    m = mul3(m, rotation(theta));
    m = mul3(m, translation(-cropW / 2, -cropH / 2));
  }

  // 3. rotate90 (horario): el lienzo sale del centro (cropW/2, cropH/2)
  if (geometry.rotate90 !== 0) {
    const k = geometry.rotate90 % 4;
    const swap = k % 2 === 1;
    const w2 = swap ? cropH : cropW;
    const h2 = swap ? cropW : cropH;
    m = mul3(m, translation(w2 / 2, h2 / 2));
    for (let i = 0; i < k; i++) m = mul3(m, rotation(-Math.PI / 2));
    m = mul3(m, translation(-cropW / 2, -cropH / 2));
  }

  // 4. flips sobre el crop
  if (geometry.flipH) m = mul3(m, flipX());
  if (geometry.flipV) m = mul3(m, flipY());

  // 5. crop px → source px (offset del rect de crop)
  m = mul3(m, translation(crop.x * srcW, crop.y * srcH));

  const size = resolveOutputSize(srcW, srcH, geometry);
  return {
    mat: [m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]] as SourceTransform["mat"],
    outW: size.w,
    outH: size.h,
  };
}

// ── ¿La receta edita algo? ──

function paramsDiffer(params: Record<string, unknown>, defaults: Record<string, unknown>): boolean {
  return Object.keys(defaults).some(k => {
    const a = params[k];
    const b = defaults[k];
    if (typeof b === "object" && b !== null) return JSON.stringify(a) !== JSON.stringify(b);
    return a !== b;
  });
}

export function recipeHasEdits(recipe: AnyRecipe): boolean {
  const def = createDefaultRecipe();
  for (const op of recipe.ops) {
    const d = def.ops.find(o => o.type === op.type)!;
    if (!op.enabled) continue; // desactivada = no edita (sus params sobran)
    if (op.type === "bw") {
      if (op.params.enabled) return true;
      continue;
    }
    if (paramsDiffer(op.params as Record<string, unknown>, d.params as Record<string, unknown>)) return true;
  }
  if (recipe.masks.length > 0) return true;
  const g = recipe.geometry;
  const dg = def.geometry;
  return (
    g.crop.x !== dg.crop.x || g.crop.y !== dg.crop.y || g.crop.w !== dg.crop.w || g.crop.h !== dg.crop.h ||
    g.rotate90 !== 0 || g.flipH || g.flipV || g.straighten !== 0
  );
}

// ── Presets curados ──

export interface PhotoPreset { id: string; name: string; patch: Partial<Record<OpType, Record<string, unknown>>> }

export const PHOTO_PRESETS: PhotoPreset[] = [
  { id: "nitido", name: "Nítido", patch: { detail: { sharpen: 40, clarity: 15, texture: 10 }, basic: { contrast: 8 } } },
  { id: "calido-dorado", name: "Cálido dorado", patch: { white_balance: { temp: 22, tint: 4 }, basic: { exposure: 4, shadows: 12 }, color: { vibrance: 14 } } },
  { id: "frio-cine", name: "Frío cine", patch: { white_balance: { temp: -18, tint: -4 }, tone_curve: { rgb: [{ x: 0, y: 14 }, { x: 255, y: 246 }] }, color: { saturation: -12 }, color_grading: { shadows: { hue: 220, sat: 18 }, highlights: { hue: 45, sat: 10 } } } },
  { id: "bn-clasico", name: "B/N clásico", patch: { bw: { enabled: true, mix: { r: 100, g: 100, b: 100 } }, basic: { contrast: 12 }, detail: { sharpen: 20 } } },
  { id: "bn-contraste", name: "B/N contraste", patch: { bw: { enabled: true, mix: { r: 120, g: 90, b: 70 } }, basic: { contrast: 34, whites: 16, blacks: -14 }, tone_curve: { rgb: [{ x: 0, y: 6 }, { x: 255, y: 252 }] } } },
  { id: "vintage-fade", name: "Vintage fade", patch: { tone_curve: { rgb: [{ x: 0, y: 26 }, { x: 255, y: 232 }] }, color: { saturation: -18, vibrance: 8 }, effects: { grain: 24, vignetteAmount: -22 }, white_balance: { temp: 10 } } },
  { id: "vibrante-redes", name: "Vibrante redes", patch: { color: { vibrance: 34, saturation: 12 }, basic: { contrast: 16, shadows: 10 }, detail: { clarity: 14, sharpen: 24 } } },
  { id: "retrato-suave", name: "Retrato suave", patch: { detail: { denoise: 26, sharpen: 12 }, basic: { highlights: -14, shadows: 14 }, color: { vibrance: 10, saturation: -6 }, effects: { vignetteAmount: -14 } } },
];

/** Aplica un preset sobre la receta actual (merge por op; lo demás intacto). */
export function applyPreset(recipe: AnyRecipe, preset: PhotoPreset): AnyRecipe {
  const merged = JSON.parse(JSON.stringify(recipe)) as AnyRecipe;
  for (const op of merged.ops) {
    const patch = preset.patch[op.type];
    if (!patch) continue;
    if (op.type === "hsl") continue; // los presets fase 1 no tocan HSL por banda
    if (op.type === "tone_curve") continue;
    if (op.type === "color_grading") {
      const g = op.params as unknown as ColorGradingParams;
      const p = patch as Record<string, unknown>;
      if (p.shadows) g.shadows = { ...g.shadows, ...(p.shadows as Partial<GradingRegion>) };
      if (p.midtones) g.midtones = { ...g.midtones, ...(p.midtones as Partial<GradingRegion>) };
      if (p.highlights) g.highlights = { ...g.highlights, ...(p.highlights as Partial<GradingRegion>) };
      continue;
    }
    op.params = { ...op.params, ...patch };
  }
  return normalizeRecipe(merged);
}

// ── Estado de render resuelto (lo que consume el motor) ──

export interface ResolvedHslBand { h: number; s: number; l: number }

export interface ResolvedRenderState {
  basic: BasicParams;
  whiteBalance: WhiteBalanceParams;
  color: ColorParams;
  /** 8 bandas NORMALIZADAS a -1..1 (el shader las re-escala). */
  hsl: ResolvedHslBand[];
  curves: ToneCurveParams;
  /** Raw: hue en grados, sat/blend 0..100, balance -100..100. */
  grading: ColorGradingParams;
  detail: DetailParams;
  effects: EffectsParams;
  bw: BwParams;
  masks: PhotoMask[];
}

const pickOp = <T>(recipe: AnyRecipe, type: OpType): { enabled: boolean; params: T } => {
  const found = recipe.ops.find(o => o.type === type);
  if (found) return { enabled: found.enabled !== false, params: found.params as T };
  const def = createDefaultRecipe().ops.find(o => o.type === type)!;
  return { enabled: true, params: def.params as T };
};

/**
 * resolveRenderState — aplana la receta a los valores efectivos: una op
 * desactivada aporta sus DEFAULTS (neutros), las máscaras desactivadas
 * desaparecen y el HSL sale normalizado a -1..1. (pure, QA)
 */
export function resolveRenderState(recipe: AnyRecipe): ResolvedRenderState {
  const basic = pickOp<BasicParams>(recipe, "basic");
  const wb = pickOp<WhiteBalanceParams>(recipe, "white_balance");
  const color = pickOp<ColorParams>(recipe, "color");
  const hslOp = pickOp<HslParams>(recipe, "hsl");
  const curveOp = pickOp<ToneCurveParams>(recipe, "tone_curve");
  const gradeOp = pickOp<ColorGradingParams>(recipe, "color_grading");
  const detailOp = pickOp<DetailParams>(recipe, "detail");
  const effectsOp = pickOp<EffectsParams>(recipe, "effects");
  const bwOp = pickOp<BwParams>(recipe, "bw");

  return {
    basic: basic.enabled ? basic.params : { ...DEFAULT_BASIC },
    whiteBalance: wb.enabled ? wb.params : { ...DEFAULT_WB },
    color: color.enabled ? color.params : { ...DEFAULT_COLOR },
    hsl: HSL_BANDS.map(band => {
      const p = hslOp.enabled ? hslOp.params[band] : { h: 0, s: 0, l: 0 };
      return { h: p.h / 30, s: p.s / 100, l: p.l / 100 };
    }),
    curves: curveOp.enabled ? curveOp.params : JSON.parse(JSON.stringify(DEFAULT_CURVE)),
    grading: gradeOp.enabled ? gradeOp.params : JSON.parse(JSON.stringify(DEFAULT_GRADING)),
    detail: detailOp.enabled ? detailOp.params : { ...DEFAULT_DETAIL },
    effects: effectsOp.enabled ? effectsOp.params : { ...DEFAULT_EFFECTS },
    bw: {
      enabled: bwOp.enabled && bwOp.params.enabled === true,
      mix: bwOp.params.mix ?? { ...DEFAULT_BW.mix },
    },
    masks: (recipe.masks || []).filter(m => m.enabled),
  };
}

// ── Crop: rect en espacio DISPLAY → espacio SOURCE ──

export interface NormRect { x: number; y: number; w: number; h: number }

/**
 * displayRectToSourceRect — el crop UI se dibuja sobre la imagen YA rotada y
 * volteada (lo que ve el usuario), pero geometry.crop vive en el espacio del
 * original (la matriz compone crop→straighten→rot90→flip). Convierte el rect
 * de display al rect equivalente del source. (pure, QA)
 */
export function displayRectToSourceRect(rect: NormRect, geometry: GeometryParams): NormRect {
  // 1. des-hacer flips (espejo del eje en display)
  let { x, y, w, h } = rect;
  if (geometry.flipH) x = 1 - x - w;
  if (geometry.flipV) y = 1 - y - h;
  // 2. des-hacer rot90 horario
  const k = geometry.rotate90 % 4;
  if (k === 1) return { x: y, y: 1 - x - w, w: h, h: w };
  if (k === 2) return { x: 1 - x - w, y: 1 - y - h, w, h };
  if (k === 3) return { x: 1 - y - h, y: x, w: h, h: w };
  return { x, y, w, h };
}

// ── Serialización para data-photo-recipe (base64url, unicode-safe) ──

export function encodeRecipeAttr(recipe: AnyRecipe): string {
  const json = JSON.stringify(normalizeRecipe(recipe));
  // encodeURIComponent produce ASCII puro → btoa seguro con acentos/emojis.
  return btoa(encodeURIComponent(json)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeRecipeAttr(attr: string): AnyRecipe | null {
  try {
    const b64 = attr.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(atob(b64));
    return normalizeRecipe(JSON.parse(json));
  } catch {
    return null;
  }
}

// ── Helpers MCP (REQ-32 Fase 2): mutaciones puras de receta ────────────────
// La familia photo_* de mcp.mjs y el QA comparten estas primitivas para que
// una acción UI y su tool MCP produzcan el mismo resultado (REQ §8.8).

export interface RecipeParamChange { key: string; from: unknown; to: unknown }

export interface RecipeOpDiff { type: OpType; changed: boolean; keys: RecipeParamChange[] }

export interface RecipeDiff {
  changed: boolean;
  ops: RecipeOpDiff[];
  masksAdded: string[];
  masksRemoved: string[];
  masksChanged: string[];
  geometryChanged: boolean;
}

const jsonEq = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * setRecipeOperation — REEMPLAZA los params de una op (o merge superficial
 * con opts.merge) y la habilita. Las claves que se omiten vuelven a default
 * tras normalizeRecipe: "aplicar" es determinista, no acumulativo. Lanza si
 * el tipo es desconocido.
 */
export function setRecipeOperation(
  recipe: AnyRecipe,
  type: OpType,
  params: Record<string, unknown>,
  opts?: { merge?: boolean; enabled?: boolean },
): AnyRecipe {
  const next = JSON.parse(JSON.stringify(recipe)) as AnyRecipe;
  const op = next.ops.find(o => o.type === type);
  if (!op) throw new Error(`Operación desconocida: ${type}`);
  op.params = { ...(opts?.merge ? (op.params as Record<string, unknown>) : {}), ...params };
  op.enabled = opts?.enabled !== undefined ? Boolean(opts.enabled) : true;
  return normalizeRecipe(next);
}

/** resetRecipeOperation — la op vuelve a sus defaults (neutra). */
export function resetRecipeOperation(recipe: AnyRecipe, type: OpType): AnyRecipe {
  const next = JSON.parse(JSON.stringify(recipe)) as AnyRecipe;
  const op = next.ops.find(o => o.type === type);
  if (!op) throw new Error(`Operación desconocida: ${type}`);
  const def = createDefaultRecipe().ops.find(o => o.type === type)!;
  op.params = JSON.parse(JSON.stringify(def.params));
  return normalizeRecipe(next);
}

/**
 * upsertRecipeMask — añade una máscara normalizada (o reemplaza la de igual
 * id). Error si al AÑADIR se superarían las 6 permitidas; reemplazar una
 * existente nunca crece.
 */
export function upsertRecipeMask(recipe: AnyRecipe, mask: unknown): AnyRecipe {
  const next = JSON.parse(JSON.stringify(recipe)) as AnyRecipe;
  const normalized = normalizeMask(mask, next.masks.length);
  if (!normalized) throw new Error("Máscara inválida");
  const existing = next.masks.findIndex(m => m.id === normalized.id);
  if (existing < 0 && next.masks.length >= 6) throw new Error("Límite de 6 máscaras alcanzado");
  if (existing >= 0) next.masks[existing] = normalized;
  else next.masks.push(normalized);
  return normalizeRecipe(next);
}

/** patchRecipeMask — parche parcial de una máscara por id (adjustments en merge). */
export function patchRecipeMask(recipe: AnyRecipe, maskId: string, patch: Partial<PhotoMask>): AnyRecipe {
  const next = JSON.parse(JSON.stringify(recipe)) as AnyRecipe;
  const mask = next.masks.find(m => m.id === maskId);
  if (!mask) throw new Error(`Máscara no encontrada: ${maskId}`);
  const { adjustments, ...rest } = patch as Partial<PhotoMask> & { adjustments?: Partial<MaskAdjustments> };
  Object.assign(mask, rest);
  if (adjustments) mask.adjustments = { ...mask.adjustments, ...adjustments };
  return normalizeRecipe(next);
}

/**
 * diffRecipes — qué cambió entre dos versiones de receta (photo_compare_versions
 * y el historial de la UI). Ops en orden canónico; keys compara TODA clave de
 * params con igualdad JSON profunda. (pure, QA)
 */
export function diffRecipes(a: AnyRecipe, b: AnyRecipe): RecipeDiff {
  const def = createDefaultRecipe();
  const ops: RecipeOpDiff[] = [];
  for (const op of b.ops) {
    const prev = a.ops.find(o => o.type === op.type);
    const before = (prev?.params ?? def.ops.find(o => o.type === op.type)!.params) as Record<string, unknown>;
    const after = op.params as Record<string, unknown>;
    const keys: RecipeParamChange[] = [];
    for (const key of Object.keys(after)) {
      if (!jsonEq(before[key], after[key])) keys.push({ key, from: before[key] ?? null, to: after[key] ?? null });
    }
    const enabledChanged = (prev ? prev.enabled : true) !== op.enabled;
    ops.push({ type: op.type, changed: keys.length > 0 || enabledChanged, keys });
  }
  const aIds = new Set(a.masks.map(m => m.id));
  const bIds = new Set(b.masks.map(m => m.id));
  const masksAdded = [...bIds].filter(id => !aIds.has(id));
  const masksRemoved = [...aIds].filter(id => !bIds.has(id));
  const masksChanged = [...bIds].filter(id => {
    if (!aIds.has(id)) return false;
    return !jsonEq(a.masks.find(m => m.id === id), b.masks.find(m => m.id === id));
  });
  const geometryChanged = !jsonEq(a.geometry, b.geometry);
  return {
    changed: ops.some(o => o.changed) || masksAdded.length > 0 || masksRemoved.length > 0
      || masksChanged.length > 0 || geometryChanged,
    ops,
    masksAdded,
    masksRemoved,
    masksChanged,
    geometryChanged,
  };
}
