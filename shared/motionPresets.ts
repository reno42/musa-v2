/**
 * Native Musa motion presets for AI/MCP video flows (REQ-057 foundation).
 *
 * The harness lets an IA bring foreign motion as declarative manifests; the
 * HIGHER-fidelity path is composing from Musa's own vocabulary — these
 * presets ARE that vocabulary for video/motion: entrances, exits, loops,
 * camera-ish focus moves and kinetic type, each a deterministic Tween[]
 * builder over the ONE animation schema (shared/animationSchema.ts).
 *
 * Contract:
 *  - Pure: same preset + same sanitized params → byte-identical tweens.
 *  - Params are declared with types/ranges; sanitizeMotionParams clamps and
 *    drops unknowns, so MCP callers can never inject arbitrary JSON.
 *  - applyMotionPresetToSchema owns its clip via a STABLE instanceId
 *    (`presetId:layerId`), so re-applying regenerates exactly its own clip —
 *    idempotent by construction, and "convert to keyframes" (the editor's
 *    existing bake path) still works because instances are part of the
 *    schema contract (REQ037 P2.3).
 */

import {
  normalizeAnimation,
  type AnimationSchema,
  type Clip,
  type PresetInstance,
  type Tween,
} from "./animationSchema.ts";

export type MotionPresetCategory = "entrada" | "salida" | "bucle" | "enfoque" | "cinetico";

export const MOTION_PRESET_CATEGORIES: ReadonlyArray<{ id: MotionPresetCategory | "all"; label: string }> = [
  { id: "all", label: "Todos" },
  { id: "entrada", label: "Entrada" },
  { id: "salida", label: "Salida" },
  { id: "bucle", label: "Bucle" },
  { id: "enfoque", label: "Enfoque (cámara)" },
  { id: "cinetico", label: "Tipografía cinética" },
];

export interface MotionPresetParamSpec {
  name: string;
  type: "number" | "string" | "boolean";
  default: number | string | boolean;
  min?: number;
  max?: number;
  /** When present, string params must be one of these. */
  values?: string[];
  about?: string;
}

export interface MotionPreset {
  id: string;
  label: string;
  category: MotionPresetCategory;
  about: string;
  params: MotionPresetParamSpec[];
  /** Pure builder — returns fresh objects, never shared references. */
  build(p: Record<string, number | string | boolean>): Tween[];
}

type Params = Record<string, number | string | boolean>;

const num = (p: Params, name: string, fallback: number): number => {
  const v = p[name];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
};

/** Canonical transform string in the schema's 4-function order. */
const tf = (x: number, y: number, scale: number, rotate: number): string =>
  `translateX(${Math.round(x * 10) / 10}px) translateY(${Math.round(y * 10) / 10}px) scale(${Math.round(scale * 1000) / 1000}) rotate(${Math.round(rotate * 10) / 10}deg)`;

const IDENTITY_TF = tf(0, 0, 1, 0);

export const MOTION_PRESETS: readonly MotionPreset[] = [
  {
    id: "musa.motion.rise-in",
    label: "Rise in",
    category: "entrada",
    about: "Sube desde abajo con fade y desaceleración.",
    params: [{ name: "distPx", type: "number", default: 64, min: 8, max: 480 }],
    build: p => {
      const d = num(p, "distPx", 64);
      return [
        { prop: "transform", easing: "ease-out-expo", keyframes: [{ t: 0, value: tf(0, d, 1, 0) }, { t: 1, value: IDENTITY_TF }] },
        { prop: "opacity", easing: "ease-out", keyframes: [{ t: 0, value: "0" }, { t: 1, value: "1" }] },
      ];
    },
  },
  {
    id: "musa.motion.drift-in",
    label: "Drift in",
    category: "entrada",
    about: "Entra lateralmente con desaceleración.",
    params: [{ name: "distPx", type: "number", default: 72, min: 8, max: 960 }],
    build: p => {
      const d = num(p, "distPx", 72);
      return [{ prop: "transform", easing: "ease-out-expo", keyframes: [{ t: 0, value: tf(-d, 0, 1, 0) }, { t: 1, value: IDENTITY_TF }] }];
    },
  },
  {
    id: "musa.motion.zoom-settle",
    label: "Zoom settle",
    category: "entrada",
    about: "Crece desde el 85% con rebote sutil y fade.",
    params: [{ name: "fromScale", type: "number", default: 0.85, min: 0.2, max: 0.98 }],
    build: p => [
      { prop: "transform", easing: "ease-out-back", keyframes: [{ t: 0, value: tf(0, 0, num(p, "fromScale", 0.85), 0) }, { t: 1, value: IDENTITY_TF }] },
      // Ojo: normalizeAnimation fija el último keyframe en t=1 — un fade que
      // "termina antes" se estiraría; el fade completo vive en [0,1].
      { prop: "opacity", easing: "ease-out", keyframes: [{ t: 0, value: "0" }, { t: 1, value: "1" }] },
    ],
  },
  {
    id: "musa.motion.blur-focus-in",
    label: "Blur focus in",
    category: "entrada",
    about: "Aparece desenfocado y enfoca.",
    params: [{ name: "blurPx", type: "number", default: 14, min: 2, max: 60 }],
    build: p => {
      const b = num(p, "blurPx", 14);
      return [
        { prop: "opacity", easing: "ease-out", keyframes: [{ t: 0, value: "0" }, { t: 1, value: "1" }] },
        { prop: "filter", easing: "ease-out", keyframes: [{ t: 0, value: `blur(${b}px) brightness(1)` }, { t: 1, value: "blur(0px) brightness(1)" }] },
      ];
    },
  },
  {
    id: "musa.motion.fall-away",
    label: "Fall away",
    category: "salida",
    about: "Sale hacia arriba con fade acelerado.",
    params: [{ name: "distPx", type: "number", default: 56, min: 8, max: 480 }],
    build: p => {
      const d = num(p, "distPx", 56);
      return [
        { prop: "transform", easing: "ease-in", keyframes: [{ t: 0, value: IDENTITY_TF }, { t: 1, value: tf(0, -d, 1, 0) }] },
        { prop: "opacity", easing: "ease-in", keyframes: [{ t: 0, value: "1" }, { t: 1, value: "0" }] },
      ];
    },
  },
  {
    id: "musa.motion.zoom-blow-out",
    label: "Zoom blow out",
    category: "salida",
    about: "Crece y se desvanece hacia la cámara.",
    params: [{ name: "toScale", type: "number", default: 1.25, min: 1.02, max: 3 }],
    build: p => [
      { prop: "transform", easing: "ease-in", keyframes: [{ t: 0, value: IDENTITY_TF }, { t: 1, value: tf(0, 0, num(p, "toScale", 1.25), 0) }] },
      { prop: "opacity", easing: "ease-in", keyframes: [{ t: 0, value: "1" }, { t: 1, value: "0" }] },
    ],
  },
  {
    id: "musa.motion.pulse-loop",
    label: "Pulse loop",
    category: "bucle",
    about: "Latido de escala en loop.",
    params: [{ name: "amount", type: "number", default: 0.04, min: 0.005, max: 0.3 }],
    build: p => {
      const a = num(p, "amount", 0.04);
      return [{ prop: "transform", easing: "ease-in-out", keyframes: [
        { t: 0, value: tf(0, 0, 1, 0) },
        { t: 0.5, value: tf(0, 0, 1 + a, 0) },
        { t: 1, value: tf(0, 0, 1, 0) },
      ] }];
    },
  },
  {
    id: "musa.motion.float-loop",
    label: "Float loop",
    category: "bucle",
    about: "Flotación vertical en loop.",
    params: [{ name: "distPx", type: "number", default: 14, min: 2, max: 120 }],
    build: p => {
      const d = num(p, "distPx", 14);
      return [{ prop: "transform", easing: "ease-in-out", keyframes: [
        { t: 0, value: tf(0, 0, 1, 0) },
        { t: 0.5, value: tf(0, -d, 1, 0) },
        { t: 1, value: tf(0, 0, 1, 0) },
      ] }];
    },
  },
  {
    id: "musa.motion.wobble-loop",
    label: "Wobble loop",
    category: "bucle",
    about: "Oscilación de rotación en loop.",
    params: [{ name: "deg", type: "number", default: 2, min: 0.5, max: 20 }],
    build: p => {
      const r = num(p, "deg", 2);
      return [{ prop: "transform", easing: "ease-in-out", keyframes: [
        { t: 0, value: tf(0, 0, 1, -r) },
        { t: 0.5, value: tf(0, 0, 1, r) },
        { t: 1, value: tf(0, 0, 1, -r) },
      ] }];
    },
  },
  {
    id: "musa.motion.ken-burns-in",
    label: "Ken Burns in",
    category: "enfoque",
    about: "Zoom lento con deriva — vida de foto fija.",
    params: [
      { name: "toScale", type: "number", default: 1.12, min: 1.01, max: 1.6 },
      { name: "driftX", type: "number", default: -24, min: -400, max: 400 },
      { name: "driftY", type: "number", default: -12, min: -400, max: 400 },
    ],
    build: p => [{ prop: "transform", easing: "linear", keyframes: [
      { t: 0, value: tf(0, 0, 1, 0) },
      { t: 1, value: tf(num(p, "driftX", -24), num(p, "driftY", -12), num(p, "toScale", 1.12), 0) },
    ] }],
  },
  {
    id: "musa.motion.pan-across",
    label: "Pan across",
    category: "enfoque",
    about: "Barrido lateral de cámara sobre la capa.",
    params: [{ name: "distPx", type: "number", default: 120, min: 10, max: 1200 }],
    build: p => {
      const d = num(p, "distPx", 120);
      return [{ prop: "transform", easing: "linear", keyframes: [
        { t: 0, value: tf(-d, 0, 1, 0) },
        { t: 1, value: tf(d, 0, 1, 0) },
      ] }];
    },
  },
  {
    id: "musa.motion.type-on",
    label: "Type on",
    category: "cinetico",
    about: "Revela texto de izquierda a derecha.",
    params: [{ name: "softPx", type: "number", default: 0, min: 0, max: 40 }],
    build: p => {
      const soft = num(p, "softPx", 0);
      return [{ prop: "clipPath", easing: "linear", keyframes: [
        { t: 0, value: `inset(-10% 100% -10% 0 round ${soft}px)` },
        { t: 1, value: `inset(-10% 0% -10% 0 round ${soft}px)` },
      ] }];
    },
  },
  {
    id: "musa.motion.word-cascade",
    label: "Word cascade",
    category: "cinetico",
    about: "Bloque de texto que sube escalonado (una capa por palabra).",
    params: [
      { name: "staggerSec", type: "number", default: 0.12, min: 0.02, max: 1 },
      { name: "distPx", type: "number", default: 40, min: 4, max: 240 },
    ],
    // Words are separate editor layers; the adapter calls buildMotionClip per
    // word with an offset window — this preset builds ONE word's clip.
    build: p => {
      const d = num(p, "distPx", 40);
      return [
        { prop: "transform", easing: "ease-out-expo", keyframes: [{ t: 0, value: tf(0, d, 1, 0) }, { t: 1, value: IDENTITY_TF }] },
        { prop: "opacity", easing: "ease-out", keyframes: [{ t: 0, value: "0" }, { t: 1, value: "1" }] },
      ];
    },
  },
];

export function findMotionPreset(id: string): MotionPreset | undefined {
  return MOTION_PRESETS.find(p => p.id === id);
}

/** Clamps numbers to their declared range, validates string enums, drops
 *  unknown keys — deterministic and MCP-safe. */
export function sanitizeMotionParams(
  preset: MotionPreset,
  input: Record<string, unknown> | null | undefined,
): Params {
  const out: Params = {};
  for (const spec of preset.params) {
    const v = input ? input[spec.name] : undefined;
    if (spec.type === "number") {
      const n = typeof v === "number" ? v : (v === undefined || v === null ? Number(spec.default) : Number(v));
      const finite = Number.isFinite(n) ? n : Number(spec.default);
      const lo = spec.min ?? -1e9;
      const hi = spec.max ?? 1e9;
      out[spec.name] = Math.round(Math.min(hi, Math.max(lo, finite)) * 1000) / 1000;
    } else if (spec.type === "boolean") {
      out[spec.name] = typeof v === "boolean" ? v : Boolean(spec.default);
    } else {
      const s = typeof v === "string" ? v : String(spec.default);
      out[spec.name] = spec.values && !spec.values.includes(s) ? String(spec.default) : s.slice(0, 120);
    }
  }
  return out;
}

const MIN_WINDOW_SEC = 0.1;
const MAX_WINDOW_SEC = 600;

function sanitizeWindow(
  windowSec: { startSec: number; endSec: number } | undefined,
  fallbackEndSec: number,
): { startSec: number; endSec: number } {
  const rawStart = windowSec?.startSec ?? 0;
  const rawEnd = windowSec?.endSec ?? fallbackEndSec;
  const startSec = Math.max(0, Number.isFinite(rawStart) ? rawStart : 0);
  const endSec = Math.min(MAX_WINDOW_SEC, Math.max(startSec + MIN_WINDOW_SEC, Number.isFinite(rawEnd) ? rawEnd : startSec + MIN_WINDOW_SEC));
  return { startSec, endSec };
}

/** Builds a preset clip on a window. Throws on unknown preset id — caller
 *  (MCP tool) surfaces it as an actionable error. */
export function buildMotionClip(
  presetId: string,
  params: Record<string, unknown> | null | undefined,
  windowSec?: { startSec: number; endSec: number },
  fallbackEndSec = 1.2,
): { clip: Clip; preset: MotionPreset; sanitized: Params } {
  const preset = findMotionPreset(presetId);
  if (!preset) throw new Error(`Preset de motion desconocido: ${presetId}`);
  const sanitized = sanitizeMotionParams(preset, params);
  const window = sanitizeWindow(windowSec, fallbackEndSec);
  const clip: Clip = {
    layerId: "",
    startSec: window.startSec,
    endSec: window.endSec,
    tweens: preset.build(sanitized).map(t => ({ ...t, keyframes: t.keyframes.map(k => ({ ...k })) })),
  };
  return { clip, preset, sanitized };
}

/**
 * Applies (or re-applies) a preset to one layer, replacing the layer's
 * previous preset-owned clip and leaving every other clip untouched. The
 * instance id is `${presetId}:${layerId}` — stable, so re-application is
 * idempotent and the editor's "convert to keyframes" keeps working.
 */
export function applyMotionPresetToSchema(
  schema: AnimationSchema | null | undefined,
  layerId: string,
  presetId: string,
  params?: Record<string, unknown> | null,
  windowSec?: { startSec: number; endSec: number },
): AnimationSchema {
  const { clip, preset, sanitized } = buildMotionClip(
    presetId,
    params,
    windowSec,
    Math.min(schema?.timeline.durationSec ?? 1.2, 1.2),
  );
  const base = schema ?? normalizeAnimation({
    timeline: { durationSec: 5, fps: 30, width: 1080, height: 1080, loop: "once" },
    clips: [],
    transitions: [],
  });
  if (!base) throw new Error("No se pudo normalizar el documento de animación base.");
  const instanceId = `${presetId}:${layerId}`;
  const owned: Clip = { ...clip, layerId, instanceId };
  const clips = [...base.clips.filter(c => !(c.layerId === layerId && c.instanceId === instanceId)), owned];
  const instances: PresetInstance[] = [
    ...(base.instances ?? []).filter(i => !(i.presetId === presetId && i.layerId === layerId)),
    { id: instanceId, presetId, layerId, params: sanitized },
  ];
  // The apply path normalizes exactly like every other write path (editor,
  // MCP, undo): the returned document is already the persisted shape.
  const normalized = normalizeAnimation({ ...base, clips, instances });
  return normalized ?? { ...base, clips, instances };
}

/** Compact catalog for MCP discovery responses. */
export function motionPresetCatalogSummary(): Array<{
  id: string; label: string; category: MotionPresetCategory; about: string;
  params: MotionPresetParamSpec[];
}> {
  return MOTION_PRESETS.map(p => ({
    id: p.id,
    label: p.label,
    category: p.category,
    about: p.about,
    params: p.params,
  }));
}
