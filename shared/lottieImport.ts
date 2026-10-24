/**
 * Lottie → Musa motion mapping (REQ-056 foundation).
 *
 * A Lottie JSON cannot be rendered by Musa (no player, no shape renderer) —
 * what this module imports is the MOTION: each layer's transform and opacity
 * timeline becomes `AnimationSchema` clips the caller points at real editor
 * layers through `layerMap` (lottie layer name or `ind:<n>` → editor layerId).
 * The visual content itself (shapes, text, images, precomps) stays in the
 * Lottie file and is reported — never silently dropped.
 *
 * Honesty rules (same contract as the rest of the harness):
 *  - Pure functions in, values out — no DOM, no I/O, node-testable.
 *  - Malformed input never throws: it degrades to `schema: null` + warnings.
 *  - Everything this module cannot represent EXACTLY is reported in
 *    `warnings`/`fidelity`; the mapped result is deterministic (rounded
 *    values), so re-importing the same file yields the same schema.
 *
 * Fidelity decisions v1:
 *  - transform/opacity timelines + static base values → mapped (`editable`).
 *  - layers with `parent` chains → `unsupported` (v1 does not bake ancestor
 *    matrices — a wrong transform is worse than none).
 *  - mattes (`td`) → `unsupported`; masks, 3D, expressions, non-uniform
 *    scale, precomp internals → warnings, documented per case.
 *  - Hold keyframes are exactly representable (constant segment), no baking.
 *  - Per-segment Lottie easings (`o`/`i` bezier handles) become the tween's
 *    cubic-bezier; segments deviating from the dominant easing are baked
 *    into sampled keyframes so the sampler never lies about the curve.
 */

import {
  evalBezier,
  interpolateValue,
  normalizeAnimation,
  type AnimationSchema,
  type Clip,
  type Keyframe,
  type Tween,
} from "./animationSchema.ts";

export interface LottieFidelityItem {
  /** Lottie layer name (`nm`) or `layer#ind` fallback. */
  lottieLayer: string;
  editorLayerId?: string;
  editability: "editable" | "atomic" | "baked" | "unsupported";
  reason?: string;
}

export interface LottieImportWarning {
  code:
    | "unmapped-layer"
    | "parent-chain"
    | "matte"
    | "masks"
    | "3d-ignored"
    | "expression"
    | "non-uniform-scale"
    | "easing-baked"
    | "precomp-internals"
    | "visual-not-imported"
    | "clamped-duration"
    | "layers-capped"
    | "invalid-input";
  message: string;
  /** Lottie layer the warning refers to, when per-layer. */
  lottieLayer?: string;
}

/** Base (non-animated) values of a mapped layer — the adapter applies them
 *  as the editor layer's static styling; the schema only carries motion. */
export interface LottieStaticProps {
  transform?: string;
  opacity?: string;
}

export interface MappedLayerMotion {
  lottieLayer: string;
  editorLayerId: string;
  staticProps: LottieStaticProps;
  /** Present only when the layer actually animates something. */
  clip?: Clip;
}

export interface LottieImportResult {
  /** Normalized, editor-valid schema — or null when nothing could be mapped. */
  schema: AnimationSchema | null;
  mappedLayers: MappedLayerMotion[];
  fidelity: LottieFidelityItem[];
  warnings: LottieImportWarning[];
}

type Json = Record<string, unknown>;
type Bezier = [number, number, number, number];

const MAX_LAYERS = 200;
const MAX_DURATION_SEC = 600;
/** Sub-keyframes used to bake a segment whose easing deviates from the
 *  tween's dominant easing (12 samples ≈ visually exact for social fps). */
const BAKE_SAMPLES = 12;

const asObj = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const numArr = (v: unknown): number[] =>
  asArr(v).map(d => Number(d)).filter(n => Number.isFinite(n));

/** Deterministic number formatting: 3 decimals, no locale, no "-0". */
function fmt(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return String(Object.is(r, -0) ? 0 : r);
}

export function canonicalTransform(x: number, y: number, scale: number, rotate: number): string {
  return `translateX(${fmt(x)}px) translateY(${fmt(y)}px) scale(${fmt(scale)}) rotate(${fmt(rotate)}deg)`;
}

function bezierToEasingString(b: Bezier | null): string {
  return b ? `cubic-bezier(${b.map(fmt).join(", ")})` : "linear";
}

/** Lottie segment easing from the keyframe's out-handle and the next
 *  keyframe's in-handle. Per-dimension handles are averaged into one 2D
 *  bezier (deviation is bounded by the bake path when it matters). */
function bezierFromHandles(outH: unknown, inH: unknown): Bezier | null {
  const comp = (h: unknown, key: "x" | "y"): number | null => {
    const o = asObj(h);
    if (!o) return null;
    const v = o[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (Array.isArray(v)) {
      const arr = v.map(d => Number(d)).filter(n => Number.isFinite(n));
      if (arr.length === 0) return null;
      return arr.reduce((a, b) => a + b, 0) / arr.length;
    }
    return null;
  };
  const x1 = comp(outH, "x");
  const y1 = comp(outH, "y");
  const x2 = comp(inH, "x");
  const y2 = comp(inH, "y");
  if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
  return [x1, y1, x2, y2];
}

/** One parsed transform-property track: keyframes in COMPOSITION FRAMES.
 *  `ease` is the cubic-bezier of the segment STARTING at that keyframe. */
interface TrackKeyframe { t: number; v: number[]; ease: Bezier | null; hold: boolean }
interface Track { animated: boolean; frames: TrackKeyframe[] }

function oneTrack(prop: unknown): Track {
  const po = asObj(prop);
  if (!po) return { animated: false, frames: [] };
  const kfs = asArr(po.k).map(k => asObj(k)).filter((k): k is Json => !!k);
  if (po.a !== 1 || kfs.length === 0) {
    // Static value: scalar (`k: 80`) or vector (`k: [100, 100]`).
    const v = Array.isArray(po.k)
      ? numArr(po.k)
      : Number.isFinite(Number(po.k)) ? [Number(po.k)] : [];
    return { animated: false, frames: v.length ? [{ t: 0, v, ease: null, hold: false }] : [] };
  }
  const frames: TrackKeyframe[] = [];
  for (let i = 0; i < kfs.length; i++) {
    const kf = kfs[i];
    const t = Number(kf.t);
    if (!Number.isFinite(t)) continue;
    let v = numArr(kf.s);
    if (v.length === 0) {
      // Legacy files may omit `s` and carry the end value in the PREVIOUS
      // keyframe's `e`.
      const prev = i > 0 ? numArr(kfs[i - 1].e) : [];
      if (prev.length === 0) continue;
      v = prev;
    }
    // Lottie easing handles BOTH live on the keyframe that STARTS the
    // segment: `o` is the outgoing handle, `i` the incoming one of the same
    // segment (the last keyframe has neither — no outgoing segment).
    frames.push({ t, v, ease: bezierFromHandles(kf.o, kf.i), hold: kf.h === 1 });
  }
  return { animated: true, frames };
}

/** Position supports split dimensions (`p.s === true` with `p.x`/`p.y`). */
function parsePosition(ks: Json): Track {
  const p = asObj(ks.p);
  if (p && p.s === true) {
    const x = oneTrack(p.x);
    const y = oneTrack(p.y);
    if (!x.animated && !y.animated) {
      const vx = x.frames[0]?.v[0] ?? 0;
      const vy = y.frames[0]?.v[0] ?? 0;
      return { animated: false, frames: [{ t: 0, v: [vx, vy], ease: null, hold: false }] };
    }
    const times = new Set<number>();
    for (const f of x.frames) times.add(f.t);
    for (const f of y.frames) times.add(f.t);
    const frames = [...times].sort((a, b) => a - b).map(t => ({
      t,
      v: [valueAt(x, t, 0), valueAt(y, t, 0)],
      ease: (x.animated ? x : y).frames.find(f => f.t === t)?.ease ?? null,
      hold: false,
    }));
    return { animated: true, frames };
  }
  return oneTrack(ks.p);
}

/** Component value of a track at composition frame `t` (hold = constant). */
function valueAt(track: Track, t: number, component: number): number {
  const frames = track.frames;
  if (frames.length === 0) return 0;
  if (t <= frames[0].t) return frames[0].v[component] ?? 0;
  const last = frames[frames.length - 1];
  if (t >= last.t) return last.v[component] ?? 0;
  let i = 0;
  while (i < frames.length - 1 && t > frames[i + 1].t) i++;
  const a = frames[i];
  const b = frames[i + 1];
  if (a.hold) return a.v[component] ?? 0;
  const span = b.t - a.t;
  const raw = span <= 0 ? 1 : (t - a.t) / span;
  const eased = a.ease ? evalBezier(a.ease, raw) : raw;
  const av = a.v[component] ?? 0;
  const bv = b.v[component] ?? 0;
  return av + (bv - av) * eased;
}

const trackAnimated = (t: Track): boolean => t.animated && t.frames.length > 1;

/** Builds the schema tweens for one layer's transform+opacity motion.
 *  `extentMin/Max` are the composition frames the motion actually spans —
 *  the clip window, because the schema pins every tween's first/last
 *  keyframe to t=0/1 (a wider window would stretch the animation). */
function planLayerMotion(
  layer: Json,
  fps: number,
  warnings: LottieImportWarning[],
  layerName: string,
): { staticProps: LottieStaticProps; tweens: Tween[]; extentMin: number; extentMax: number } | null {
  const ks = asObj(layer.ks);
  if (!ks) return null;
  const warn = (code: LottieImportWarning["code"], message: string) =>
    warnings.push({ code, message, lottieLayer: layerName });

  const pos = parsePosition(ks);
  const scl = oneTrack(ks.s);
  const rot = oneTrack(ks.r);
  const opa = oneTrack(ks.o);

  const posAnimated = trackAnimated(pos);
  const sclAnimated = trackAnimated(scl);
  const rotAnimated = trackAnimated(rot);
  const opaAnimated = trackAnimated(opa);

  const sx0 = (scl.frames[0]?.v[0] ?? 100) / 100;
  const sy0 = (scl.frames[0]?.v[1] ?? sx0 * 100) / 100;
  if (Math.abs(sx0 - sy0) > 0.005) {
    warn("non-uniform-scale", "Escala no uniforme: el eje Y sigue al X (escala única).");
  }

  const staticProps: LottieStaticProps = {};
  if (!posAnimated && !sclAnimated && !rotAnimated) {
    staticProps.transform = canonicalTransform(
      pos.frames[0]?.v[0] ?? 0,
      pos.frames[0]?.v[1] ?? 0,
      sx0,
      rot.frames[0]?.v[0] ?? 0,
    );
  }
  if (!opaAnimated) staticProps.opacity = fmt((opa.frames[0]?.v[0] ?? 100) / 100);

  const animatedTracks = [pos, scl, rot, opa].filter(trackAnimated);
  const allFrameTimes = animatedTracks.flatMap(tr => tr.frames.map(f => f.t));
  // Sin tracks animados no hay clip (el caller solo usa staticProps); el extent
  // devuelto es irrelevante pero debe ser un par finito — usamos el in-point.
  const inPoint = Number.isFinite(Number(layer.ip)) ? Number(layer.ip) : 0;
  if (allFrameTimes.length === 0) return { staticProps, tweens: [], extentMin: inPoint, extentMax: inPoint };
  const extentMin = Math.min(...allFrameTimes);
  const extentMax = Math.max(...allFrameTimes);

  const toLocal = (frame: number): number =>
    Math.min(1, Math.max(0, (frame - extentMin) / (extentMax - extentMin || 1)));

  const tweens: Tween[] = [];

  // Transform: union of the animated props' real keyframe times. The clip
  // window IS the motion extent, so normalize's pinned t=0/t=1 are real
  // keyframes and holds ride the fill-both semantics of the sampler.
  if (posAnimated || sclAnimated || rotAnimated) {
    // Union of real keyframe times only — every boundary is owned by a prop,
    // so the easing vote below reflects actual Lottie segments.
    const union = new Set<number>();
    for (const tr of [pos, scl, rot]) {
      if (trackAnimated(tr)) for (const f of tr.frames) union.add(f.t);
    }
    const times = [...union].sort((a, b) => a - b);
    const keys: Keyframe[] = times.map(tFrame => ({
      t: toLocal(tFrame),
      value: canonicalTransform(
        valueAt(pos, tFrame, 0),
        valueAt(pos, tFrame, 1),
        valueAt(scl, tFrame, 0) / 100,
        valueAt(rot, tFrame, 0),
      ),
    }));

    // Per-boundary easing: the prop that owns the keyframe wins
    // (position > scale > rotation); union-only times inherit the previous.
    const ownerEase = new Map<number, Bezier | null>();
    for (const tr of [pos, scl, rot]) {
      if (!trackAnimated(tr)) continue;
      for (const f of tr.frames) {
        if (!ownerEase.has(f.t)) ownerEase.set(f.t, f.ease);
      }
    }
    const segEase = new Map<number, Bezier | null>();
    let last: Bezier | null = null;
    for (const tFrame of times) {
      if (ownerEase.has(tFrame)) last = ownerEase.get(tFrame) ?? null;
      segEase.set(tFrame, last);
    }

    const flattened = flattenSegments(keys, segEase, warn);
    tweens.push({ prop: "transform", keyframes: holdExtend(flattened.keyframes), easing: flattened.easing });
  }

  if (opaAnimated) {
    const times = [...new Set<number>(opa.frames.map(f => f.t))].sort((a, b) => a - b);
    const keys: Keyframe[] = times.map(tFrame => ({
      t: toLocal(tFrame),
      value: fmt(valueAt(opa, tFrame, 0) / 100),
    }));
    const segEase = new Map<number, Bezier | null>();
    for (const f of opa.frames) segEase.set(f.t, f.ease);
    const flattened = flattenSegments(keys, segEase, () => {});
    tweens.push({ prop: "opacity", keyframes: holdExtend(flattened.keyframes), easing: flattened.easing });
  }

  return { staticProps, tweens, extentMin, extentMax };
}

/** The schema pins every tween's first/last keyframe to t=0/1 — a tween that
 *  ends before its clip does would be stretched. Holds are exact (constant
 *  values), so we extend with constant keyframes over the missing edges. */
function holdExtend(keys: Keyframe[]): Keyframe[] {
  const out = [...keys];
  if (out.length > 0 && out[0].t > 1e-6) out.unshift({ t: 0, value: out[0].value });
  const last = out[out.length - 1];
  if (out.length > 0 && last.t < 1 - 1e-6) out.push({ t: 1, value: last.value });
  return out;
}

/** Lays one tween's segments onto keyframes: segments matching the dominant
 *  bezier keep their true easing; deviating segments are baked into sampled
 *  keyframes so the single per-tween easing never misrepresents them. */
function flattenSegments(
  keys: Keyframe[],
  segEase: Map<number, Bezier | null>,
  warn: (code: LottieImportWarning["code"], message: string) => void,
): { keyframes: Keyframe[]; easing: string } {
  const keyOf = (b: Bezier | null): string => (b ? b.map(fmt).join(",") : "linear");
  const count = new Map<string, number>();
  // Vote over REAL segments only (a boundary with an outgoing segment); the
  // final keyframe has no outgoing segment and must not vote "linear".
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keyOf(segEase.get(keys[i].t) ?? null);
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  let dominantKey = "linear";
  let dominantCount = -1;
  for (const [k, c] of count) {
    if (c > dominantCount) { dominantCount = c; dominantKey = k; }
  }
  const dominant: Bezier | null =
    dominantKey === "linear" ? null : (dominantKey.split(",").map(Number) as Bezier);

  const out: Keyframe[] = [];
  const push = (kf: Keyframe) => {
    if (out.length === 0 || out[out.length - 1].t !== kf.t) out.push(kf);
  };
  for (let i = 0; i < keys.length; i++) {
    const isLast = i === keys.length - 1;
    const ease = segEase.get(keys[i].t) ?? null;
    if (isLast || keyOf(ease) === dominantKey) {
      push(keys[i]);
      continue;
    }
    // Deviating segment — bake N samples through ITS bezier.
    warn("easing-baked", `Segmento con easing propio horneado en ${BAKE_SAMPLES} muestras.`);
    const segStart = keys[i];
    const segEnd = keys[i + 1];
    const span = segEnd.t - segStart.t;
    for (let sIdx = 0; sIdx <= BAKE_SAMPLES; sIdx++) {
      const u = sIdx / BAKE_SAMPLES;
      const eased = ease ? evalBezier(ease, u) : u;
      push({ t: segStart.t + span * u, value: interpolateValue(segStart.value, segEnd.value, eased) });
    }
  }
  return { keyframes: out, easing: bezierToEasingString(dominant) };
}

/** Maps a Lottie composition's motion onto editor layers. */
export function mapLottieMotion(
  lottie: unknown,
  layerMap: Record<string, string> = {},
): LottieImportResult {
  const warnings: LottieImportWarning[] = [];
  const fidelity: LottieFidelityItem[] = [];
  const mappedLayers: MappedLayerMotion[] = [];
  const fail = (message: string): LottieImportResult => ({
    schema: null,
    mappedLayers,
    fidelity,
    warnings: [...warnings, { code: "invalid-input", message }],
  });
  const root = asObj(lottie);
  if (!root) return fail("La entrada no es un objeto Lottie (JSON de composición).");

  const fr = Number(root.fr);
  const fps = Number.isFinite(fr) && fr >= 1 && fr <= 60 ? fr : 30;
  const ip = Math.max(0, Number(root.ip) || 0);
  const opRaw = Number(root.op);
  const op = Number.isFinite(opRaw) && opRaw > ip ? opRaw : ip + 5 * fps;
  let durationSec = (op - ip) / fps;
  if (durationSec > MAX_DURATION_SEC) {
    durationSec = MAX_DURATION_SEC;
    warnings.push({ code: "clamped-duration", message: `Duración recortada a ${MAX_DURATION_SEC}s.` });
  }
  const layers = asArr(root.layers);
  if (layers.length === 0) return fail("La composición no tiene layers.");

  const clips: Clip[] = [];
  for (const raw of layers) {
    const layer = asObj(raw);
    if (!layer) continue;
    if (mappedLayers.length >= MAX_LAYERS) {
      warnings.push({ code: "layers-capped", message: `Layers por encima de ${MAX_LAYERS} se ignoran.` });
      break;
    }
    const name = typeof layer.nm === "string" && layer.nm.trim()
      ? layer.nm.trim()
      : `layer#${String(layer.ind ?? "?")}`;
    const editorLayerId =
      layerMap[name] ?? (layer.ind !== undefined ? layerMap[`ind:${String(layer.ind)}`] : undefined);

    if (layer.parent !== undefined) {
      fidelity.push({ lottieLayer: name, editorLayerId, editability: "unsupported", reason: "parent-chain" });
      warnings.push({ code: "parent-chain", message: "Layer con `parent`: los offsets de ancestro no se hornean en v1.", lottieLayer: name });
      continue;
    }
    if (layer.td !== undefined) {
      fidelity.push({ lottieLayer: name, editorLayerId, editability: "unsupported", reason: "matte" });
      warnings.push({ code: "matte", message: "Matte no soportado en v1.", lottieLayer: name });
      continue;
    }
    if (layer.ddd === 1) {
      warnings.push({ code: "3d-ignored", message: "Layer 3D: el eje Z se ignora.", lottieLayer: name });
    }
    if (layer.hasMask || layer.masksProperties) {
      warnings.push({ code: "masks", message: "Masks no se importan.", lottieLayer: name });
    }
    if (layer.ty === 0) {
      warnings.push({ code: "precomp-internals", message: "Precomp: las layers internas no se recorren en v1.", lottieLayer: name });
    }
    if (layer.ty === 4 || layer.ty === 5) {
      warnings.push({ code: "visual-not-imported", message: "El visual (shape/text) no se importa: solo su motion.", lottieLayer: name });
    }
    if (layer.ef !== undefined) {
      warnings.push({ code: "expression", message: "Efectos/expresiones de la layer no se traducen.", lottieLayer: name });
    }

    if (!editorLayerId) {
      fidelity.push({ lottieLayer: name, editability: "unsupported", reason: "unmapped-layer" });
      warnings.push({ code: "unmapped-layer", message: "Sin entrada en layerMap: el motion de esta layer no se mapea.", lottieLayer: name });
      continue;
    }

    const plan = planLayerMotion(layer, fps, warnings, name);
    if (!plan) {
      fidelity.push({ lottieLayer: name, editorLayerId, editability: "unsupported", reason: "no-ks" });
      continue;
    }
    if (plan.tweens.length === 0) {
      fidelity.push({ lottieLayer: name, editorLayerId, editability: "editable", reason: "static-only" });
      mappedLayers.push({ lottieLayer: name, editorLayerId, staticProps: plan.staticProps });
      continue;
    }
    const extentStart = plan.extentMin / fps;
    const extentLen = (plan.extentMax - plan.extentMin) / fps;
    const clip: Clip = {
      layerId: editorLayerId,
      startSec: extentStart,
      endSec: Math.max(extentStart + 0.05, extentStart + Math.min(extentLen, MAX_DURATION_SEC)),
      tweens: plan.tweens,
    };
    clips.push(clip);
    mappedLayers.push({ lottieLayer: name, editorLayerId, staticProps: plan.staticProps, clip });
    fidelity.push({ lottieLayer: name, editorLayerId, editability: "editable" });
  }

  const schema = normalizeAnimation({
    timeline: {
      durationSec,
      fps,
      width: Math.max(16, Math.min(10000, Number(root.w) || 1080)),
      height: Math.max(16, Math.min(10000, Number(root.h) || 1080)),
      loop: "once" as const,
    },
    clips,
    transitions: [],
  });
  if (!schema) return fail("Ninguna layer mapeó a clips válidos.");
  return { schema, mappedLayers, fidelity, warnings };
}
