/**
 * expressionRules — REQ043: no-code expression rules (wiggle/loop/pulse).
 *
 * Musa-style "expresiones": parametric RULES, never raw JS. Each rule
 * COMPILES to plain transform tweens over the layer's clip window, so every
 * existing renderer (design preview, player, exporter) plays them with zero
 * changes — the rule never reaches runtime. Applications follow the P2.3
 * instance contract: the clip is tagged with the instance id, the record
 * keeps the authored params live (editing recompiles), and "convertir a
 * keyframes" bakes exactly like presets.
 *
 * Wiggle is DETERMINISTIC: a seeded PRNG turns the same params into the
 * same keyframes on every compile, so preview, player and export agree.
 */

import {
  normalizeAnimation,
  defaultAnimation,
  type AnimationSchema,
  type Clip,
  type Keyframe,
  type PresetInstance,
} from "../../shared/animationSchema.ts";
import { instanceIdFor, upsertPresetInstance } from "./presetInstances.ts";

export interface ExpressionParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface ExpressionRule {
  id: string;
  label: string;
  about: string;
  /** Tween easing used by the compiled clip. */
  easing: string;
  params: readonly ExpressionParamDef[];
  /** `t` spans the clip window (0 = start, 1 = end). Deterministic. */
  keyframes(p: Record<string, number>): Keyframe[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const xform = (x = 0, y = 0, scale = 1, rotate = 0): string =>
  `translateX(${round2(x)}px) translateY(${round2(y)}px) scale(${round2(scale)}) rotate(${round2(rotate)}deg)`;

/** mulberry32 — tiny seeded PRNG; the seed param makes wiggle reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Alternating ping-pong keyframes: start value, N excursions, back to base. */
function pingPong(base: string, excursions: string[], cycles: number): Keyframe[] {
  const total = Math.max(1, Math.round(cycles) * 2);
  const kfs: Keyframe[] = [{ t: 0, value: base }];
  for (let i = 1; i < total; i++) kfs.push({ t: i / total, value: i % 2 === 1 ? excursions[0] : base });
  kfs.push({ t: 1, value: base });
  return kfs;
}

export const EXPRESSION_RULES: readonly ExpressionRule[] = [
  {
    id: "exp-wiggle",
    label: "Temblor (wiggle)",
    about: "Vibra de forma aleatoria pero determinista: la semilla fija el patrón.",
    easing: "linear",
    params: [
      { key: "amplitud", label: "Amplitud (deg)", min: 0.5, max: 30, step: 0.5, default: 6 },
      { key: "velocidad", label: "Velocidad (ciclos/s)", min: 0.5, max: 12, step: 0.5, default: 4 },
      { key: "semilla", label: "Semilla", min: 1, max: 99, step: 1, default: 7 },
    ],
    keyframes: (p) => {
      // Compiled with the clip window in compileExpressionClip — `p` carries
      // the resolved window through the private fields below (see compile).
      const steps = Math.max(3, Math.round(p.velocidad * p.__winSec) * 2);
      const rand = mulberry32(Math.round(p.semilla) * 1013 + 7);
      const kfs: Keyframe[] = [{ t: 0, value: xform(0, 0, 1, 0) }];
      for (let i = 1; i < steps; i++) {
        kfs.push({ t: i / steps, value: xform(0, 0, 1, p.amplitud * (rand() * 2 - 1)) });
      }
      kfs.push({ t: 1, value: xform(0, 0, 1, 0) });
      return kfs;
    },
  },
  {
    id: "exp-loop",
    label: "Ida y vuelta (loop)",
    about: "Se desplaza en horizontal y regresa, en ciclos uniformes.",
    easing: "ease-in-out",
    params: [
      { key: "distancia", label: "Distancia (px)", min: -200, max: 200, step: 2, default: 24 },
      { key: "ciclos", label: "Ciclos", min: 1, max: 20, step: 1, default: 3 },
    ],
    keyframes: (p) => pingPong(xform(0, 0, 1, 0), [xform(p.distancia, 0, 1, 0)], p.ciclos),
  },
  {
    id: "exp-pulse",
    label: "Latido (pulse)",
    about: "Crece y vuelve a su tamaño, al ritmo de los ciclos.",
    easing: "ease-in-out",
    params: [
      { key: "intensidad", label: "Intensidad (%)", min: 2, max: 50, step: 1, default: 12 },
      { key: "ciclos", label: "Ciclos", min: 1, max: 20, step: 1, default: 4 },
    ],
    keyframes: (p) => pingPong(xform(0, 0, 1, 0), [xform(0, 0, 1 + p.intensidad / 100, 0)], p.ciclos),
  },
];

export function findExpressionRule(ruleId: string): ExpressionRule | undefined {
  return EXPRESSION_RULES.find(r => r.id === ruleId);
}

/** Human label for an instance panel (expressions and presets alike). */
export function expressionLabel(ruleId: string): string {
  return findExpressionRule(ruleId)?.label ?? ruleId;
}

/** Clamp/repair authored params against the rule's definitions. */
export function sanitizeExpressionParams(
  rule: ExpressionRule,
  raw: Record<string, number | string | boolean> | undefined | null,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const def of rule.params) {
    const n = typeof raw?.[def.key] === "number" ? (raw[def.key] as number) : Number(raw?.[def.key]);
    out[def.key] = Number.isFinite(n) ? Math.min(def.max, Math.max(def.min, n)) : def.default;
  }
  return out;
}

export function defaultExpressionParams(rule: ExpressionRule): Record<string, number> {
  return sanitizeExpressionParams(rule, null);
}

/** Compile a rule to the layer's clip over `[startSec, endSec]`. The wiggle
 *  rule reads the window length through `__winSec` (its step count depends
 *  on real seconds, not just normalized t). */
export function compileExpressionClip(
  ruleId: string,
  params: Record<string, number | string | boolean> | undefined | null,
  startSec: number,
  endSec: number,
): Clip | null {
  const rule = findExpressionRule(ruleId);
  if (!rule || !(endSec > startSec + 0.04)) return null;
  const clean = sanitizeExpressionParams(rule, params);
  const p = { ...clean, __winSec: endSec - startSec } as Record<string, number>;
  return {
    layerId: "", // the caller stamps the layer
    startSec,
    endSec,
    tweens: [{ prop: "transform", easing: rule.easing, keyframes: rule.keyframes(p) }],
  };
}

export type ExpressionApplyResult =
  | { ok: true; schema: AnimationSchema; instanceId: string }
  | { ok: false; reason: string };

/** Apply a rule to one layer — the SAME consistency model as presets: the
 *  layer's previous clip (and its instance record) is REPLACED, the fresh
 *  clip is tagged with the instance id and the authored params are recorded.
 *  Window defaults to the full timeline (loops/wiggles want everything). */
export function applyExpressionToSchema(
  schemaIn: AnimationSchema | null | undefined,
  layerId: string,
  ruleId: string,
  params?: Record<string, number | string | boolean> | null,
  windowSec?: { startSec: number; endSec: number },
): ExpressionApplyResult {
  const rule = findExpressionRule(ruleId);
  if (!rule) return { ok: false, reason: `Regla desconocida: ${ruleId}` };
  if (!layerId) return { ok: false, reason: "Selecciona un objeto para aplicar la expresión" };
  const base = normalizeAnimation(schemaIn || defaultAnimation());
  if (!base) return { ok: false, reason: "No se pudo preparar la animación" };
  const existing = base.clips.find(c => c.layerId === layerId);
  const dur = base.timeline.durationSec || 5;
  const startSec = Math.max(0, windowSec?.startSec ?? existing?.startSec ?? 0);
  const endSec = Math.min(dur, Math.max(startSec + 0.2, windowSec?.endSec ?? existing?.endSec ?? dur));
  const clip = compileExpressionClip(ruleId, params, startSec, endSec);
  if (!clip) return { ok: false, reason: "Ventana demasiado corta para la expresión" };
  clip.layerId = layerId;
  const clean = sanitizeExpressionParams(rule, params);
  const instId = instanceIdFor(layerId, ruleId);
  const instance: PresetInstance = { id: instId, presetId: ruleId, layerId, params: clean };
  // One clip per layer (same contract as applyPresetToSchema): drop the
  // layer's previous clip AND its previous instance record before upserting.
  const prepped: AnimationSchema = {
    ...base,
    clips: base.clips.filter(c => c.layerId !== layerId),
    instances: (base.instances || []).filter(i => i.layerId !== layerId),
  };
  const res = upsertPresetInstance(prepped, instance, [clip]);
  if (!res.schema) return { ok: false, reason: "No se pudo aplicar la expresión" };
  return { ok: true, schema: res.schema, instanceId: instId };
}

/** Parameter edit on a live expression: recompiles ONLY the clips the
 *  instance owns, keeping their window (the P2.3 regeneration contract). */
export function updateExpressionParams(
  schemaIn: AnimationSchema | null | undefined,
  instanceId: string,
  params: Record<string, number | string | boolean>,
): ExpressionApplyResult {
  const base = normalizeAnimation(schemaIn);
  if (!base) return { ok: false, reason: "Sin animación que editar" };
  const inst = (base.instances || []).find(i => i.id === instanceId);
  if (!inst) return { ok: false, reason: "Instancia no encontrada" };
  const owned = base.clips.filter(c => c.instanceId === instanceId);
  if (owned.length === 0) return { ok: false, reason: "La instancia no tiene clip propio" };
  const rule = findExpressionRule(inst.presetId);
  if (!rule) return { ok: false, reason: `${inst.presetId} no es una expresión` };
  const win = owned[0];
  const fresh = compileExpressionClip(inst.presetId, params, win.startSec, win.endSec);
  if (!fresh) return { ok: false, reason: "Parámetros inválidos" };
  fresh.layerId = inst.layerId;
  const clean = sanitizeExpressionParams(rule, params);
  const res = upsertPresetInstance(base, { ...inst, params: clean }, [fresh]);
  if (!res.schema) return { ok: false, reason: "No se pudo actualizar la expresión" };
  return { ok: true, schema: res.schema, instanceId };
}

/** The active expression instance of a layer, if any. */
export function expressionOfLayer(
  schemaIn: AnimationSchema | null | undefined,
  layerId: string,
): PresetInstance | null {
  const base = normalizeAnimation(schemaIn);
  return (base?.instances || []).find(i => i.layerId === layerId && findExpressionRule(i.presetId)) || null;
}
