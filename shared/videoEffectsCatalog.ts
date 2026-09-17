/**
 * videoEffectsCatalog — V5: THE single source of truth for the video-mode
 * transition/effect vocabulary. Everything the UI shows, the schema accepts
 * and both renderers implement is declared here:
 *
 *   TRANSITIONS      35 parametric transitions in 6 families (CapCut-style)
 *   LOOKS            24 color looks as css(intensity) functions
 *   TAKE_FX          6 animated per-take effects (pure math → free parity)
 *   OVERLAY_FX       4 static overlays (grain/vignette/scanlines/leak)
 *   LAYER_EFFECTS    12 layer tween generators (the old EFFECT_PRESETS + 6)
 *   TEXT_ANIMS       10 caption entrance ids (implemented in captions.ts)
 *
 * Parity contract: every transition id MUST have an entry in BOTH
 * PREVIEW_TRANSITIONS (src/lib/transitionPreview.ts) and EXPORT_TRANSITIONS
 * (src/lib/videoExport.ts) — vid-qa enforces it, and `TransitionType` is
 * derived from this array so a new id without renderers fails to compile
 * wherever the union is exhaustively consumed.
 *
 * Dependency rule: this file imports ONLY types (erased) — never runtime
 * code from the renderers — so vid-qa can import it under plain Node.
 */

import type { Tween } from "./animationSchema";

// ── Transition families (CapCut-style left rail) ──

export type TransitionFamily = "basic" | "camera" | "blur" | "light" | "overlay" | "mg";

export const TRANSITION_FAMILIES: Array<{ id: TransitionFamily; label: string; icon: string }> = [
  { id: "basic", label: "Básicas", icon: "◐" },
  { id: "camera", label: "Cámara", icon: "⤢" },
  { id: "blur", label: "Desenfoque", icon: "◍" },
  { id: "light", label: "Luz", icon: "✦" },
  { id: "overlay", label: "Formas", icon: "◯" },
  { id: "mg", label: "MG / Fun", icon: "▚" },
];

// ── Param definitions ──

export interface NumParam {
  readonly key: string; readonly label: string; readonly type: "number";
  readonly min: number; readonly max: number; readonly step: number; readonly default: number;
}
export interface EnumParam {
  readonly key: string; readonly label: string; readonly type: "enum";
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  readonly default: string;
}
export interface ColorParam {
  readonly key: string; readonly label: string; readonly type: "color"; readonly default: string;
}
export type TransitionParamDef = NumParam | EnumParam | ColorParam;

const DIRS = [
  { value: "left", label: "←" }, { value: "right", label: "→" },
  { value: "up", label: "↑" }, { value: "down", label: "↓" },
] as const;

const num = (key: string, label: string, min: number, max: number, step: number, def: number): NumParam =>
  ({ key, label, type: "number", min, max, step, default: def });
const en = (key: string, label: string, options: readonly { value: string; label: string }[], def: string): EnumParam =>
  ({ key, label, type: "enum", options, default: def });
const color = (key: string, label: string, def: string): ColorParam =>
  ({ key, label, type: "color", default: def });

// ── The transition vocabulary ──

export interface TransitionDef {
  readonly id: string;
  readonly family: TransitionFamily;
  readonly label: string;
  readonly icon: string;
  /** Default duration for NEW transitions of this type (s). */
  readonly durationSec: number;
  readonly params?: ReadonlyArray<TransitionParamDef>;
}

/**
 * The 35 types. The first 8 keep their V4 ids AND default visuals — docs
 * authored before V5 render identically (params absent → defaults chosen to
 * reproduce the V4 hardcoded values: slide dir=left, wipe softness=0,
 * zoom strength=0.25, zoom-out strength=0.4, blur strength=1, flash white).
 */
export const TRANSITIONS = [
  // Basic
  { id: "fade", family: "basic", label: "Fundido", icon: "◐", durationSec: 0.6 },
  { id: "slide", family: "basic", label: "Desliza", icon: "⇥", durationSec: 0.6,
    params: [en("dir", "Dirección", DIRS, "left")] },
  { id: "slide-up", family: "basic", label: "Desliza ↑", icon: "⤒", durationSec: 0.6 },
  { id: "wipe", family: "basic", label: "Barrido", icon: "▥", durationSec: 0.6,
    params: [en("dir", "Borde", DIRS, "left"), num("softness", "Suavidad", 0, 0.5, 0.01, 0)] },
  { id: "push", family: "basic", label: "Cubre", icon: "⇉", durationSec: 0.5,
    params: [en("dir", "Dirección", DIRS, "left")] },
  { id: "fade-black", family: "basic", label: "A negro", icon: "◑", durationSec: 0.5 },
  { id: "tint", family: "basic", label: "Disuelvo color", icon: "❋", durationSec: 0.6,
    params: [color("color", "Color", "#e0b57a")] },
  // Camera
  { id: "zoom", family: "camera", label: "Zoom", icon: "⤢", durationSec: 0.6,
    params: [num("strength", "Fuerza", 0.05, 0.6, 0.01, 0.25)] },
  { id: "zoom-out", family: "camera", label: "Zoom out", icon: "⤡", durationSec: 0.6,
    params: [num("strength", "Fuerza", 0.1, 0.8, 0.01, 0.4)] },
  { id: "pan", family: "camera", label: "Paneo", icon: "⇢", durationSec: 0.6,
    params: [en("dir", "Dirección", DIRS, "left")] },
  { id: "spin", family: "camera", label: "Giro", icon: "⟳", durationSec: 0.7,
    params: [num("degrees", "Grados", 90, 720, 15, 180)] },
  { id: "whip-pan", family: "camera", label: "Latigazo", icon: "≫", durationSec: 0.4,
    params: [en("dir", "Dirección", DIRS, "left")] },
  { id: "simple-zoom", family: "camera", label: "Zoom suave", icon: "⤪", durationSec: 0.6,
    params: [num("strength", "Escala inicial", 1.05, 2, 0.01, 1.5)] },
  { id: "cross-zoom", family: "camera", label: "Doble zoom", icon: "⤫", durationSec: 0.6,
    params: [num("strength", "Fuerza", 0.1, 0.6, 0.01, 0.35)] },
  // Blur
  { id: "blur", family: "blur", label: "Desenfoque", icon: "◍", durationSec: 0.6,
    params: [num("strength", "Fuerza", 0.2, 2.5, 0.05, 1)] },
  { id: "linear-blur", family: "blur", label: "Desenfoque lineal", icon: "⇸", durationSec: 0.5,
    params: [en("dir", "Dirección", DIRS, "left")] },
  { id: "pixelize", family: "blur", label: "Pixelar", icon: "▦", durationSec: 0.6,
    params: [num("strength", "Fuerza", 0.3, 2, 0.05, 1)] },
  { id: "mosaic-grid", family: "blur", label: "Mosaico", icon: "⊞", durationSec: 0.7,
    params: [num("count", "Celdas", 2, 10, 1, 5)] },
  { id: "gaussian-dissolve", family: "blur", label: "Disuelvo difuso", icon: "◌", durationSec: 0.6,
    params: [num("strength", "Fuerza", 0.3, 2, 0.05, 1)] },
  // Light
  { id: "flash", family: "light", label: "Flash", icon: "✦", durationSec: 0.35,
    params: [color("color", "Color", "#ffffff")] },
  { id: "luma-burn", family: "light", label: "Sobreexposición", icon: "☀", durationSec: 0.5 },
  { id: "leak-sweep", family: "light", label: "Fuga de luz", icon: "⟡", durationSec: 0.7,
    params: [color("color", "Color", "#ffb36b")] },
  { id: "exposure-cut", family: "light", label: "Corte exposición", icon: "⚡", durationSec: 0.4 },
  { id: "glow-blend", family: "light", label: "Brillo screen", icon: "✧", durationSec: 0.6 },
  // Overlay / shapes
  { id: "circle-open", family: "overlay", label: "Círculo", icon: "◯", durationSec: 0.6,
    params: [en("mode", "Modo", [{ value: "in", label: "Abre" }, { value: "out", label: "Cierra" }], "in")] },
  { id: "diamond-open", family: "overlay", label: "Diamante", icon: "◇", durationSec: 0.6 },
  { id: "blinds", family: "overlay", label: "Persianas", icon: "▤", durationSec: 0.7,
    params: [num("count", "Láminas", 2, 12, 1, 5)] },
  { id: "checker", family: "overlay", label: "Damasco", icon: "▩", durationSec: 0.8,
    params: [num("count", "Celdas", 2, 8, 1, 4)] },
  { id: "bars-horizontal", family: "overlay", label: "Barras", icon: "☰", durationSec: 0.7,
    params: [num("count", "Barras", 2, 8, 1, 3)] },
  { id: "square-crop", family: "overlay", label: "Recorte", icon: "▢", durationSec: 0.6 },
  { id: "pinwheel", family: "overlay", label: "Molinete", icon: "✺", durationSec: 0.8,
    params: [num("count", "Aspas", 3, 12, 1, 6)] },
  // MG / fun
  { id: "glitch", family: "mg", label: "Glitch", icon: "▚", durationSec: 0.5,
    params: [num("strength", "Fuerza", 0.3, 2, 0.05, 1)] },
  { id: "echo", family: "mg", label: "Eco RGB", icon: "⧉", durationSec: 0.5,
    params: [num("strength", "Separación", 0.2, 1.5, 0.05, 1)] },
  { id: "static-fade", family: "mg", label: "Estática", icon: "▒", durationSec: 0.5 },
  { id: "swap", family: "mg", label: "Swap", icon: "⇅", durationSec: 0.5,
    params: [en("dir", "Salida", DIRS, "up")] },
] as const satisfies readonly TransitionDef[];

/** Closed union — adding a def here forces both renderer registries to follow. */
export type TransitionId = (typeof TRANSITIONS)[number]["id"];

// ── Param resolution (schema normalize + both renderers) ──

export type TransitionParams = Record<string, number | string>;

export function transitionDef(id: string): TransitionDef | undefined {
  return TRANSITIONS.find(t => t.id === id);
}

/** Full param set for a type: user values clamped/validated, defaults filled.
 *  Unknown keys are dropped — the schema never persists junk. */
export function resolveTransitionParams(id: string, raw?: TransitionParams | null): TransitionParams {
  const def = transitionDef(id);
  const out: TransitionParams = {};
  if (!def?.params) return out;
  for (const p of def.params) {
    const v = raw?.[p.key];
    if (p.type === "number") {
      const n = typeof v === "number" && Number.isFinite(v) ? v : p.default;
      out[p.key] = Math.min(p.max, Math.max(p.min, n));
    } else if (p.type === "enum") {
      out[p.key] = typeof v === "string" && p.options.some(o => o.value === v) ? v : p.default;
    } else {
      out[p.key] = typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : p.default;
    }
  }
  return out;
}

/** Validate/clamp a raw params object for PERSISTENCE (drops unknown keys).
 *  Returns undefined when the type has no params or nothing survives. */
export function sanitizeTransitionParams(id: string, raw?: TransitionParams | null): TransitionParams | undefined {
  const resolved = resolveTransitionParams(id, raw);
  const def = transitionDef(id);
  if (!def?.params || def.params.length === 0) return undefined;
  return resolved;
}

// ── Shared geometry (identical math feeds both renderers → free parity) ──

/** Unit direction vector: the direction the CONTENT moves. */
export function dirVec(dir: string): { x: number; y: number } {
  if (dir === "right") return { x: 1, y: 0 };
  if (dir === "up") return { x: 0, y: -1 };
  if (dir === "down") return { x: 0, y: 1 };
  return { x: -1, y: 0 }; // left (legacy default)
}

/** Deterministic pseudo-random 0..1 — jitter/seeds must match in both renderers. */
export function seeded(i: number, salt: number): number {
  const v = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

export interface TileRect { x: number; y: number; w: number; h: number; alpha: number }

/**
 * Tile-dissolve covers for blinds/bars/checker/mosaic — the same rects+alphas
 * are painted as divs in preview and fillRects in export. Covers fade in
 * stagger order; at p=0 all opaque, at p=1 all gone.
 */
export function dissolveTiles(
  kind: "columns" | "rows" | "checker" | "grid",
  count: number,
  W: number, H: number,
  p: number,
): TileRect[] {
  const n = Math.max(2, Math.round(count));
  const out: TileRect[] = [];
  const order: number[] = [];
  if (kind === "columns" || kind === "rows") {
    for (let i = 0; i < n; i++) order.push(i);
  } else {
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) order.push(r * n + c);
    if (kind === "checker") {
      // Wave from the top-left corner: sort by (row+col), ties by row.
      order.sort((a, b) => {
        const ka = Math.floor(a / n) + (a % n), kb = Math.floor(b / n) + (b % n);
        return ka !== kb ? ka - kb : Math.floor(a / n) - Math.floor(b / n);
      });
    }
  }
  const m = order.length;
  for (let k = 0; k < m; k++) {
    const i = order[k];
    const start = m <= 1 ? 0 : (k / (m - 1)) * 0.55;
    const alpha = Math.min(1, Math.max(0, 1 - (p - start) / 0.45));
    let x = 0, y = 0, w = W, h = H;
    if (kind === "columns") { x = (i / n) * W; w = W / n; }
    else if (kind === "rows") { y = (i / n) * H; h = H / n; }
    else { x = (i % n) * (W / n); y = Math.floor(i / n) * (H / n); w = W / n; h = H / n; }
    if (alpha > 0.005) out.push({ x, y, w, h, alpha });
  }
  return out;
}

export interface Wedge { points: Array<[number, number]>; alpha: number }

/** Pinwheel covers — angular sectors fading in stagger order (same contract
 *  as dissolveTiles: opaque at p=0, gone at p=1). */
export function pinwheelWedges(count: number, cx: number, cy: number, r: number, p: number): Wedge[] {
  const n = Math.max(3, Math.round(count));
  const out: Wedge[] = [];
  for (let i = 0; i < n; i++) {
    const start = n <= 1 ? 0 : (i / (n - 1)) * 0.55;
    const alpha = Math.min(1, Math.max(0, 1 - (p - start) / 0.45));
    if (alpha <= 0.005) continue;
    const a0 = (i / n) * Math.PI * 2 - Math.PI / 2;
    const a1 = a0 + (Math.PI * 2) / n;
    const points: Array<[number, number]> = [[cx, cy]];
    const STEPS = 6;
    for (let s = 0; s <= STEPS; s++) {
      const a = a0 + ((a1 - a0) * s) / STEPS;
      points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    out.push({ points, alpha });
  }
  return out;
}

/** CSS clip-path polygon string for a wedge (preview cover divs). */
export function wedgeClipPath(points: Array<[number, number]>, W: number, H: number): string {
  return `polygon(${points.map(([x, y]) => `${((x / W) * 100).toFixed(2)}% ${((y / H) * 100).toFixed(2)}%`).join(",")})`;
}

// ── Color looks (per-take CSS filters, parameterized by intensity 0..1) ──

export type LookFamily = "original" | "warm" | "cool" | "bw" | "vintage" | "cine" | "vivid" | "dreamy";

export const LOOK_FAMILIES: Array<{ id: LookFamily; label: string }> = [
  { id: "original", label: "Original" }, { id: "warm", label: "Cálidos" }, { id: "cool", label: "Fríos" },
  { id: "bw", label: "B/N" }, { id: "vintage", label: "Vintage" }, { id: "cine", label: "Cine" },
  { id: "vivid", label: "Vívidos" }, { id: "dreamy", label: "Soñados" },
];

export interface ReelLookDef {
  readonly id: string;
  readonly label: string;
  readonly family: LookFamily;
  /** CSS filter string at intensity i ∈ [0,1]. i=1 on the legacy 8 === the
   *  exact V4 preset strings. */
  css: (i: number) => string;
}

const l1 = (i: number, base: number) => (1 + (base - 1) * i).toFixed(2); // 1→identity scale
const f2 = (i: number, k: number) => (k * i).toFixed(2);

export const LOOKS: ReelLookDef[] = [
  { id: "none", label: "Original", family: "original", css: () => "" },
  // Cálidos
  { id: "warm", label: "Cálido", family: "warm", css: i => `saturate(${l1(i, 1.15)}) sepia(${f2(i, 0.18)}) brightness(${l1(i, 1.03)})` },
  { id: "golden", label: "Dorado", family: "warm", css: i => `saturate(${l1(i, 1.2)}) sepia(${f2(i, 0.32)}) contrast(${l1(i, 1.05)})` },
  { id: "sunset", label: "Atardecer", family: "warm", css: i => `sepia(${f2(i, 0.25)}) hue-rotate(${(-15 * i).toFixed(1)}deg) saturate(${l1(i, 1.25)}) contrast(${l1(i, 1.08)})` },
  { id: "peach", label: "Durazno", family: "warm", css: i => `sepia(${f2(i, 0.15)}) saturate(${l1(i, 1.25)}) brightness(${l1(i, 1.06)})` },
  // Fríos
  { id: "cold", label: "Frío", family: "cool", css: i => `saturate(${l1(i, 1.05)}) hue-rotate(${(-12 * i).toFixed(1)}deg) brightness(${l1(i, 1.02)})` },
  { id: "arctic", label: "Ártico", family: "cool", css: i => `hue-rotate(${(15 * i).toFixed(1)}deg) saturate(${l1(i, 1.1)}) brightness(${l1(i, 1.05)})` },
  { id: "icy", label: "Hielo", family: "cool", css: i => `contrast(${l1(i, 1.1)}) saturate(${l1(i, 0.85)}) brightness(${l1(i, 1.06)}) hue-rotate(${(8 * i).toFixed(1)}deg)` },
  // B/N
  { id: "bw", label: "B/N", family: "bw", css: i => `grayscale(${i.toFixed(2)}) contrast(${l1(i, 1.08)})` },
  { id: "noir", label: "Noir", family: "bw", css: i => `grayscale(${i.toFixed(2)}) contrast(${l1(i, 1.35)}) brightness(${l1(i, 0.92)})` },
  { id: "silver", label: "Plata", family: "bw", css: i => `grayscale(${i.toFixed(2)}) brightness(${l1(i, 1.1)}) contrast(${l1(i, 0.95)})` },
  // Vintage
  { id: "sepia", label: "Sepia", family: "vintage", css: i => `sepia(${f2(i, 0.55)}) contrast(${l1(i, 1.05)})` },
  { id: "vhs", label: "VHS", family: "vintage", css: i => `saturate(${l1(i, 1.3)}) contrast(${l1(i, 1.15)}) brightness(${l1(i, 1.02)}) hue-rotate(${(-8 * i).toFixed(1)}deg) blur(${(0.4 * i).toFixed(1)}px)` },
  { id: "faded", label: "Decolorado", family: "vintage", css: i => `contrast(${l1(i, 0.82)}) saturate(${l1(i, 0.78)}) brightness(${l1(i, 1.12)}) sepia(${f2(i, 0.12)})` },
  { id: "film85", label: "Film 85", family: "vintage", css: i => `sepia(${f2(i, 0.2)}) contrast(${l1(i, 1.1)}) saturate(${l1(i, 0.9)})` },
  // Cine
  { id: "cine", label: "Cine", family: "cine", css: i => `contrast(${l1(i, 1.15)}) saturate(${l1(i, 0.85)}) brightness(${l1(i, 0.97)})` },
  { id: "teal-orange", label: "Teal & Orange", family: "cine", css: i => `contrast(${l1(i, 1.2)}) saturate(${l1(i, 1.15)}) hue-rotate(${(-6 * i).toFixed(1)}deg) sepia(${f2(i, 0.08)})` },
  { id: "matte", label: "Mate", family: "cine", css: i => `contrast(${l1(i, 0.9)}) saturate(${l1(i, 0.9)}) brightness(${l1(i, 1.05)})` },
  // Vívidos
  { id: "punch", label: "Contraste", family: "vivid", css: i => `contrast(${l1(i, 1.25)}) saturate(${l1(i, 1.1)})` },
  { id: "vivid", label: "Vívido", family: "vivid", css: i => `saturate(${l1(i, 1.5)}) contrast(${l1(i, 1.12)})` },
  { id: "candy", label: "Caramelo", family: "vivid", css: i => `saturate(${l1(i, 1.6)}) hue-rotate(${(-10 * i).toFixed(1)}deg) brightness(${l1(i, 1.04)})` },
  // Soñados
  { id: "soft", label: "Suave", family: "dreamy", css: i => `brightness(${l1(i, 1.08)}) contrast(${l1(i, 0.92)}) saturate(${l1(i, 0.95)})` },
  { id: "dreamy", label: "Onírico", family: "dreamy", css: i => `blur(${(1 * i).toFixed(1)}px) brightness(${l1(i, 1.12)}) saturate(${l1(i, 0.9)})` },
  { id: "hazy", label: "Brumoso", family: "dreamy", css: i => `contrast(${l1(i, 0.85)}) brightness(${l1(i, 1.15)}) blur(${(0.6 * i).toFixed(1)}px) saturate(${l1(i, 0.85)})` },
];

// ── Animated per-take FX (pure math — one implementation, two consumers) ──

export interface TakeFxState { dx: number; dy: number; scale: number; rotate: number; opacity: number }
export interface TakeFxCtx { w: number; h: number; beats?: number[]; takeStartSec?: number }

export interface TakeFxDef {
  readonly id: string;
  readonly label: string;
  /** State at localT seconds into the take. Numbers only — the preview composes
   *  the transform string, the export feeds ctx transforms. Both callers apply
   *  with TOP-LEFT origin, so dx/dy must self-compensate for centered moves. */
  at: (localT: number, intensity: number, ctx: TakeFxCtx) => Partial<TakeFxState>;
}

export const TAKE_FX: TakeFxDef[] = [
  {
    id: "shake", label: "Shake", at: (t, i) => ({
      dx: Math.sin(t * 68) * 8 * i,
      dy: Math.cos(t * 53) * 5 * i,
      scale: 1, rotate: 0, opacity: 1,
    }),
  },
  {
    id: "beat-punch", label: "Punch al beat", at: (t, i, ctx) => {
      const beats = ctx.beats;
      if (!beats || beats.length === 0 || ctx.takeStartSec === undefined) return { scale: 1, dx: 0, dy: 0, rotate: 0, opacity: 1 };
      const g = ctx.takeStartSec + t;
      // Latest beat at most 0.35s ago → decaying kick.
      let best = -1;
      for (const b of beats) { if (b <= g && b > best) best = b; }
      if (best < 0) return { scale: 1, dx: 0, dy: 0, rotate: 0, opacity: 1 };
      const dt = g - best;
      if (dt > 0.35) return { scale: 1, dx: 0, dy: 0, rotate: 0, opacity: 1 };
      const k = 1 - dt / 0.35;
      const c = 1 + 0.06 * i * k * k;
      return { dx: (ctx.w * (1 - c)) / 2, dy: (ctx.h * (1 - c)) / 2, scale: c, rotate: 0, opacity: 1 };
    },
  },
  {
    id: "pulse", label: "Pulso", at: (t, i, ctx) => {
      const c = 1 + 0.04 * i * Math.sin((t * Math.PI * 2) / 1.2);
      return { dx: (ctx.w * (1 - c)) / 2, dy: (ctx.h * (1 - c)) / 2, scale: c, rotate: 0, opacity: 1 };
    },
  },
  {
    id: "sway", label: "Oscilación", at: (t, i) => ({
      dx: Math.sin((t * Math.PI * 2) / 3) * 10 * i,
      dy: 0, scale: 1.04,
      rotate: Math.sin((t * Math.PI * 2) / 3) * 1.2 * i, opacity: 1,
    }),
  },
  {
    id: "flicker", label: "Parpadeo", at: (t, i) => ({
      opacity: Math.max(0.35, 1 - i * 0.3 * Math.max(0, Math.sin(t * 43) * Math.sin(t * 7.3))),
      dx: 0, dy: 0, scale: 1, rotate: 0,
    }),
  },
  {
    id: "drift", label: "Deriva", at: (t, i) => ({
      dx: Math.sin((t * Math.PI * 2) / 5) * 20 * i,
      dy: Math.cos((t * Math.PI * 2) / 7) * 14 * i,
      scale: 1.05, rotate: 0, opacity: 1,
    }),
  },
];

/** Canonical transform string from an fx state (top-left origin). */
export function composeTakeFx(s: Partial<TakeFxState>): string {
  const { dx = 0, dy = 0, scale = 1, rotate = 0 } = s;
  if (dx === 0 && dy === 0 && scale === 1 && rotate === 0) return "";
  return `translateX(${dx.toFixed(2)}px) translateY(${dy.toFixed(2)}px) scale(${scale.toFixed(4)}) rotate(${rotate.toFixed(2)}deg)`;
}

// ── Static overlay FX ──

export type OverlayFxId = "grain" | "vignette" | "scanlines" | "leak";

export const OVERLAY_FX: Array<{ id: OverlayFxId; label: string; icon: string }> = [
  { id: "grain", label: "Grano", icon: "░" },
  { id: "vignette", label: "Viñeta", icon: "◎" },
  { id: "scanlines", label: "Scanlines", icon: "▤" },
  { id: "leak", label: "Fuga luz", icon: "⟡" },
];

const GRAIN_URI =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/><feColorMatrix type='saturate' values='0'/></filter><rect width='160' height='160' filter='url(#n)' opacity='0.6'/></svg>",
  );

/** Preview style bag for one overlay fx (frame index drives grain jitter). */
export function overlayFxStyle(id: string, frameIndex: number): Record<string, string> {
  switch (id) {
    case "grain":
      return {
        backgroundImage: `url("${GRAIN_URI}")`,
        backgroundSize: "160px 160px",
        backgroundPosition: `${(frameIndex * 53) % 160}px ${(frameIndex * 97) % 160}px`,
        opacity: "0.16",
        mixBlendMode: "overlay",
      };
    case "vignette":
      return { background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.45) 100%)" };
    case "scanlines":
      return { background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.14) 0px, rgba(0,0,0,0.14) 1px, transparent 1px, transparent 4px)" };
    case "leak":
      return { background: "radial-gradient(circle at 85% 12%, rgba(255,179,107,0.5), transparent 45%)", mixBlendMode: "screen" };
    default:
      return {};
  }
}

// ── Layer effects (tween generators — the old EFFECT_PRESETS + 6 new) ──

export interface LayerEffectDef {
  readonly id: string;
  readonly label: string;
  readonly props: string[];
  make: () => Tween[];
}

const tf = (x: number, y: number, s: number, r: number) =>
  `translateX(${x}px) translateY(${y}px) scale(${s}) rotate(${r}deg)`;

export const LAYER_EFFECTS: LayerEffectDef[] = [
  { id: "shake", label: "Shake", props: ["transform"], make: () => [{
    prop: "transform", easing: "linear",
    keyframes: [0, 0.09, 0.18, 0.27, 0.36, 0.45, 0.55, 0.64, 0.73, 0.82, 0.91, 1].map((t, i) => ({
      t, value: tf((i % 2 === 0 ? 1 : -1) * 6, 0, 1, 0),
    })),
  }] },
  { id: "pulse", label: "Pulse", props: ["transform"], make: () => [{
    prop: "transform", easing: "ease-in-out",
    keyframes: [
      { t: 0, value: tf(0, 0, 1, 0) },
      { t: 0.5, value: tf(0, 0, 1.06, 0) },
      { t: 1, value: tf(0, 0, 1, 0) },
    ],
  }] },
  { id: "glow", label: "Glow", props: ["filter"], make: () => [{
    prop: "filter", easing: "ease-in-out",
    keyframes: [
      { t: 0, value: "blur(0px) brightness(1)" },
      { t: 0.5, value: "blur(1.5px) brightness(1.35)" },
      { t: 1, value: "blur(0px) brightness(1)" },
    ],
  }] },
  { id: "pop-in", label: "Pop", props: ["transform"], make: () => [{
    prop: "transform", easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
    keyframes: [
      { t: 0, value: tf(0, 0, 0.4, 0) },
      { t: 0.35, value: tf(0, 0, 1.08, 0) },
      { t: 1, value: tf(0, 0, 1, 0) },
    ],
  }] },
  { id: "ken-burns", label: "Ken Burns", props: ["transform"], make: () => [{
    prop: "transform", easing: "linear",
    keyframes: [
      { t: 0, value: tf(0, 0, 1, 0) },
      { t: 1, value: tf(0, 0, 1.12, 0) },
    ],
  }] },
  { id: "fade-in", label: "Fade", props: ["opacity"], make: () => [{
    prop: "opacity", easing: "ease-out",
    keyframes: [{ t: 0, value: "0" }, { t: 0.3, value: "1" }, { t: 1, value: "1" }],
  }] },
  // V5 additions
  { id: "rotate-in", label: "Rotar entrada", props: ["transform"], make: () => [{
    prop: "transform", easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
    keyframes: [
      { t: 0, value: tf(0, 0, 0.92, -8) },
      { t: 1, value: tf(0, 0, 1, 0) },
    ],
  }] },
  { id: "slide-bounce", label: "Rebote", props: ["transform"], make: () => [{
    prop: "transform", easing: "ease-out",
    keyframes: [
      { t: 0, value: tf(0, -30, 1, 0) },
      { t: 0.6, value: tf(0, 8, 1, 0) },
      { t: 0.8, value: tf(0, -3, 1, 0) },
      { t: 1, value: tf(0, 0, 1, 0) },
    ],
  }] },
  { id: "wiggle", label: "Wiggle", props: ["transform"], make: () => [{
    prop: "transform", easing: "ease-in-out",
    keyframes: [0, 0.25, 0.5, 0.75, 1].map((t, i) => ({ t, value: tf(0, 0, 1, (i % 2 === 0 ? 1 : -1) * 3) })),
  }] },
  { id: "flicker", label: "Flicker", props: ["opacity"], make: () => [{
    prop: "opacity", easing: "linear",
    keyframes: [0, 0.15, 0.3, 0.45, 0.6, 0.8, 1].map((t, i) => ({ t, value: String(i % 2 === 0 ? 0 : 1) })),
  }] },
  { id: "drift", label: "Deriva", props: ["transform"], make: () => [{
    prop: "transform", easing: "linear",
    keyframes: [
      { t: 0, value: tf(0, 0, 1, 0) },
      { t: 1, value: tf(14, -8, 1, 0) },
    ],
  }] },
  { id: "zoom-out-soft", label: "Zoom suave", props: ["transform"], make: () => [{
    prop: "transform", easing: "ease-out",
    keyframes: [
      { t: 0, value: tf(0, 0, 1.12, 0) },
      { t: 1, value: tf(0, 0, 1, 0) },
    ],
  }] },
];

// ── Text anims (implemented in captions.ts — this list drives the UI) ──

export type TextAnimId =
  | "fade" | "pop" | "slide-up" | "none"
  | "typewriter" | "slide-down" | "zoom-in" | "blur-in" | "bounce-in";

export const TEXT_ANIMS: Array<{ id: TextAnimId; label: string }> = [
  { id: "fade", label: "Fundido" },
  { id: "pop", label: "Pop" },
  { id: "slide-up", label: "Sube" },
  { id: "slide-down", label: "Baja" },
  { id: "zoom-in", label: "Zoom in" },
  { id: "blur-in", label: "Blur in" },
  { id: "bounce-in", label: "Rebote" },
  { id: "typewriter", label: "Máquina" },
  { id: "none", label: "Ninguna" },
];
