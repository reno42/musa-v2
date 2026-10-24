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
 * Fidelity decisions v2 (REQ-056 F3):
 *  - transform/opacity timelines + static base values → mapped (`editable`).
 *  - precomps (ty:0 + refId) flatten deterministically up to depth 4: the
 *    composition of translate·rotate·uniform-scale chains stays inside the
 *    expressible set, evaluated at the union of REAL keyframe times. Cycles,
 *    missing refs and deeper nests are reported — never guessed.
 *  - anchor point (ks.a): with the renderer's transform-origin 0 0 the anchor
 *    folds into the translate (p − R(θ)·s·a) — exact while rotation/scale are
 *    static; sampled at keyframes when they animate (reported `baked`).
 *  - layers with `parent` chains → `unsupported` (sibling parenting is not
 *    baked — a wrong transform is worse than none).
 *  - mattes (`td`) → `unsupported`; masks, 3D, expressions, non-uniform
 *    scale → warnings, documented per case.
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
    | "precomp-depth"
    | "precomp-cycle"
    | "precomp-missing-ref"
    | "anchor-offset"
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
/** Precomp flattening depth limit (REQ-056 F3) — beyond this the branch is
 *  reported, not guessed (Worker CPU budget + honest fidelity). */
const MAX_PRECOMP_DEPTH = 4;
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

// ── Precomp flattening (REQ-056 F3) ─────────────────────────────────────
// A precomp layer (ty:0 + refId) is a container: its transform composes on
// top of every child layer's transform, and child keyframe times live in the
// PRECOMP timeline (shifted by the container's `ip`). The composition of
// translate·rotate·uniform-scale chains stays inside the expressible set, so
// flattening is exact at every evaluated time — no matrices are guessed.

interface ChainLink {
  /** The Lottie layer JSON at this depth (outermost precomp → leaf). */
  layer: Json;
  /** Cumulative frame shift: local frame + ipShift = root composition frame. */
  ipShift: number;
}

interface FlatLayer {
  /** Human-readable path (`precomp/hoja`) for warnings and fidelity. */
  name: string;
  /** layerMap lookup keys, most specific first. */
  mapKeys: string[];
  /** Outermost → leaf. A plain layer is a chain of one. */
  chain: ChainLink[];
}

const lottieName = (layer: Json): string =>
  typeof layer.nm === "string" && layer.nm.trim()
    ? layer.nm.trim()
    : `layer#${String(layer.ind ?? "?")}`;

const assetsById = (root: Json): Map<string, Json> => {
  const out = new Map<string, Json>();
  for (const raw of asArr(root.assets)) {
    const asset = asObj(raw);
    const id = asset && typeof asset.id === "string" ? asset.id : null;
    if (id && asset && Array.isArray(asset.layers)) out.set(id, asset);
  }
  return out;
};

/** Expands precomp containers into flat leaf chains (outermost → leaf).
 *  Precomp time mapping: a child's frame τ shows at container frame
 *  `container.ip + τ` (asset-relative ip is treated as 0, the bodymovin norm
 *  — assets with nonzero ip get a documented offset warning via extent math). */
function flattenPrecomps(
  layers: unknown[],
  assets: Map<string, Json>,
  warnings: LottieImportWarning[],
  opts: { depth: number; shift: number; path: string; activeRefs: string[]; ancestors: ChainLink[] },
): FlatLayer[] {
  const out: FlatLayer[] = [];
  for (const raw of layers) {
    const layer = asObj(raw);
    if (!layer) continue;
    const nm = lottieName(layer);
    const name = opts.path ? `${opts.path}/${nm}` : nm;
    if (layer.ty === 0 && typeof layer.refId === "string" && layer.refId) {
      const refId = layer.refId;
      if (opts.activeRefs.includes(refId)) {
        warnings.push({ code: "precomp-cycle", message: `Precomp cíclico (${refId}): la rama se descarta.`, lottieLayer: name });
        continue;
      }
      if (opts.depth >= MAX_PRECOMP_DEPTH) {
        warnings.push({ code: "precomp-depth", message: `Anidamiento de precomps más profundo que ${MAX_PRECOMP_DEPTH}: no se aplana.`, lottieLayer: name });
        continue;
      }
      const asset = assets.get(refId);
      if (!asset) {
        warnings.push({ code: "precomp-missing-ref", message: `refId ${refId} sin asset con layers: la rama se descarta.`, lottieLayer: name });
        continue;
      }
      out.push(...flattenPrecomps(asArr(asset.layers), assets, warnings, {
        depth: opts.depth + 1,
        shift: opts.shift + (Number(layer.ip) || 0),
        path: name,
        activeRefs: [...opts.activeRefs, refId],
        ancestors: [...opts.ancestors, { layer, ipShift: opts.shift }],
      }));
      continue;
    }
    const ind = `ind:${String(layer.ind ?? "?")}`;
    out.push({
      name,
      mapKeys: opts.path
        ? [name, nm, `${opts.path}:${ind}`, ind]
        : [nm, ind],
      chain: [...opts.ancestors, { layer, ipShift: opts.shift }],
    });
  }
  return out;
}

interface LevelTracks {
  pos: Track; scl: Track; rot: Track; opa: Track; anch: Track;
  shift: number;
}

/** Composed state of the chain at root frame `t`: translate/rotate/uniform
 *  scale about the renderer's transform-origin 0 0, opacity multiplied. */
function composeStateAt(levels: LevelTracks[], t: number): { x: number; y: number; scale: number; rotDeg: number; opacity: number } {
  let ax = 0, ay = 0, accRot = 0, accScale = 1, opacity = 1;
  for (const lvl of levels) {
    const tt = t - lvl.shift;
    const px = valueAt(lvl.pos, tt, 0);
    const py = valueAt(lvl.pos, tt, 1);
    const th = (valueAt(lvl.rot, tt, 0) * Math.PI) / 180;
    const s = valueAt(lvl.scl, tt, 0) / 100;
    const axL = valueAt(lvl.anch, tt, 0);
    const ayL = valueAt(lvl.anch, tt, 1);
    // Anchor fold (origin 0 0): translate(p − R(θ)·s·a).
    const bx = px - s * (Math.cos(th) * axL - Math.sin(th) * ayL);
    const by = py - s * (Math.sin(th) * axL + Math.cos(th) * ayL);
    // outer ∘ level: A += R(accRot)·accScale·B ; θ += θ ; s *= s ; o *= o.
    ax += accScale * (Math.cos(accRot) * bx - Math.sin(accRot) * by);
    ay += accScale * (Math.sin(accRot) * bx + Math.cos(accRot) * by);
    accRot += th;
    accScale *= s;
    opacity *= valueAt(lvl.opa, tt, 0) / 100;
  }
  return { x: ax, y: ay, scale: accScale, rotDeg: (accRot * 180) / Math.PI, opacity };
}

/** Builds the schema tweens for one FLAT chain's transform+opacity motion.
 *  The clip window IS the motion extent (root frames): the schema pins every
 *  tween's first/last keyframe to t=0/1, so a wider window would stretch it. */
function planChainMotion(
  flat: FlatLayer,
  fps: number,
  warnings: LottieImportWarning[],
): { staticProps: LottieStaticProps; tweens: Tween[]; extentMin: number; extentMax: number; anchorBaked: boolean } | null {
  const leafLink = flat.chain[flat.chain.length - 1];
  if (!asObj(leafLink.layer.ks)) return null;
  const levels: LevelTracks[] = flat.chain.map(link => {
    const ks = asObj(link.layer.ks) || {};
    return {
      pos: parsePosition(ks),
      scl: oneTrack(ks.s),
      rot: oneTrack(ks.r),
      opa: oneTrack(ks.o),
      anch: oneTrack(ks.a),
      shift: link.ipShift,
    };
  });
  const warn = (code: LottieImportWarning["code"], message: string) =>
    warnings.push({ code, message, lottieLayer: flat.name });

  // Escala no uniforme: el schema solo expresa escala única (el eje Y sigue al X).
  const leafKs = asObj(leafLink.layer.ks) || {};
  const sx0 = (oneTrack(leafKs.s).frames[0]?.v[0] ?? 100) / 100;
  const sy0 = (oneTrack(leafKs.s).frames[0]?.v[1] ?? sx0 * 100) / 100;
  if (Math.abs(sx0 - sy0) > 0.005) {
    warn("non-uniform-scale", "Escala no uniforme: el eje Y sigue al X (escala única).");
  }

  // Anchor honesty: with rotation/scale animating, the folded translate is
  // sampled at keyframes (preview == export — same sampler — but the pivot
  // itself is no longer editable), so fidelity says `baked`.
  const anchorNonZero = levels.some(lvl => lvl.anch.frames.some(f => f.v.some(c => Math.abs(c) > 1e-6)));
  const rotOrScaleAnimated = levels.some(lvl => trackAnimated(lvl.rot) || trackAnimated(lvl.scl));
  const anchorBaked = anchorNonZero && rotOrScaleAnimated;
  if (anchorNonZero) {
    warn("anchor-offset", anchorBaked
      ? "Anchor ≠ 0 con rotación/escala animada: el offset se hornea en los keyframes (el pivot original no queda editable)."
      : "Anchor ≠ 0: el offset se pliega en el translate (exacto mientras rotación/escala no animen).");
  }

  const transformAnimated = levels.some(lvl => trackAnimated(lvl.pos) || trackAnimated(lvl.scl) || trackAnimated(lvl.rot) || trackAnimated(lvl.anch));
  const opacityAnimated = levels.some(lvl => trackAnimated(lvl.opa));

  // Root-frame union of REAL keyframe times per tween family.
  const timesOf = (pick: (lvl: LevelTracks) => Track[]): number[] => {
    const set = new Set<number>();
    for (const lvl of levels) {
      for (const tr of pick(lvl)) {
        if (!trackAnimated(tr)) continue;
        for (const f of tr.frames) set.add(f.t + lvl.shift);
      }
    }
    return [...set].sort((a, b) => a - b);
  };
  const transformTimes = timesOf(lvl => [lvl.pos, lvl.scl, lvl.rot, lvl.anch]);
  const opacityTimes = timesOf(lvl => [lvl.opa]);
  const allTimes = [...new Set([...transformTimes, ...opacityTimes])].sort((a, b) => a - b);

  const state0 = composeStateAt(levels, 0);
  const staticProps: LottieStaticProps = {};
  if (!transformAnimated) staticProps.transform = canonicalTransform(state0.x, state0.y, state0.scale, state0.rotDeg);
  if (!opacityAnimated) staticProps.opacity = fmt(state0.opacity);

  if (allTimes.length === 0) {
    const inPoint = (Number.isFinite(Number(leafLink.layer.ip)) ? Number(leafLink.layer.ip) : 0) + leafLink.ipShift;
    return { staticProps, tweens: [], extentMin: inPoint, extentMax: inPoint, anchorBaked };
  }
  const extentMin = allTimes[0];
  const extentMax = allTimes[allTimes.length - 1];
  const toLocal = (frame: number): number =>
    Math.min(1, Math.max(0, (frame - extentMin) / (extentMax - extentMin || 1)));

  const tweens: Tween[] = [];

  if (transformTimes.length > 0) {
    const keys: Keyframe[] = transformTimes.map(tFrame => {
      const st = composeStateAt(levels, tFrame);
      return { t: toLocal(tFrame), value: canonicalTransform(st.x, st.y, st.scale, st.rotDeg) };
    });
    // Owner easing: the LEAF's own real keyframes keep their segment bezier
    // (position > scale > rotation, as v1); ancestor-driven boundaries inherit
    // the previous owner so the vote stays representative of the leaf.
    const leaf = levels[levels.length - 1];
    const ownerEase = new Map<number, Bezier | null>();
    for (const tr of [leaf.pos, leaf.scl, leaf.rot]) {
      if (!trackAnimated(tr)) continue;
      for (const f of tr.frames) if (!ownerEase.has(f.t + leaf.shift)) ownerEase.set(f.t + leaf.shift, f.ease);
    }
    const segEase = new Map<number, Bezier | null>();
    let last: Bezier | null = null;
    for (const tFrame of transformTimes) {
      if (ownerEase.has(tFrame)) last = ownerEase.get(tFrame) ?? null;
      segEase.set(tFrame, last);
    }
    const flattened = flattenSegments(keys, segEase, warn);
    tweens.push({ prop: "transform", keyframes: holdExtend(flattened.keyframes), easing: flattened.easing });
  }

  if (opacityTimes.length > 0) {
    const keys: Keyframe[] = opacityTimes.map(tFrame => ({
      t: toLocal(tFrame),
      value: fmt(composeStateAt(levels, tFrame).opacity),
    }));
    // El nivel animado MÁS EXTERNO es el dueño del easing de opacidad:
    // convención determinista cuando varios niveles animan a la vez.
    const owner = levels.find(lvl => trackAnimated(lvl.opa))!;
    const segEase = new Map<number, Bezier | null>();
    for (const f of owner.opa.frames) segEase.set(f.t + owner.shift, f.ease);
    const flattened = flattenSegments(keys, segEase, () => {});
    tweens.push({ prop: "opacity", keyframes: holdExtend(flattened.keyframes), easing: flattened.easing });
  }

  return { staticProps, tweens, extentMin, extentMax, anchorBaked };
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

  const assets = assetsById(root);
  const flatLayers = flattenPrecomps(layers, assets, warnings, {
    depth: 0,
    shift: 0,
    path: "",
    activeRefs: [],
    ancestors: [],
  });

  const clips: Clip[] = [];
  for (const flat of flatLayers) {
    if (mappedLayers.length >= MAX_LAYERS) {
      warnings.push({ code: "layers-capped", message: `Layers por encima de ${MAX_LAYERS} se ignoran.` });
      break;
    }
    const leaf = flat.chain[flat.chain.length - 1].layer;
    const name = flat.name;
    const editorLayerId = flat.mapKeys.map(key => layerMap[key]).find(Boolean);

    // Sibling parenting remains unsupported (precomp CONTAINERS are flattened;
    // `parent` references between layers are a different mechanism).
    if (flat.chain.some(link => link.layer.parent !== undefined)) {
      fidelity.push({ lottieLayer: name, editorLayerId, editability: "unsupported", reason: "parent-chain" });
      warnings.push({ code: "parent-chain", message: "Layer con `parent`: los offsets de ancestro no se hornean.", lottieLayer: name });
      continue;
    }
    if (leaf.td !== undefined) {
      fidelity.push({ lottieLayer: name, editorLayerId, editability: "unsupported", reason: "matte" });
      warnings.push({ code: "matte", message: "Matte no soportado.", lottieLayer: name });
      continue;
    }
    if (flat.chain.some(link => link.layer.ddd === 1)) {
      warnings.push({ code: "3d-ignored", message: "Layer 3D: el eje Z se ignora.", lottieLayer: name });
    }
    if (leaf.hasMask || leaf.masksProperties) {
      warnings.push({ code: "masks", message: "Masks no se importan.", lottieLayer: name });
    }
    if (leaf.ty === 4 || leaf.ty === 5) {
      warnings.push({ code: "visual-not-imported", message: "El visual (shape/text) no se importa: solo su motion.", lottieLayer: name });
    }
    if (leaf.ef !== undefined) {
      warnings.push({ code: "expression", message: "Efectos/expresiones de la layer no se traducen.", lottieLayer: name });
    }

    if (!editorLayerId) {
      fidelity.push({ lottieLayer: name, editability: "unsupported", reason: "unmapped-layer" });
      warnings.push({ code: "unmapped-layer", message: "Sin entrada en layerMap: el motion de esta layer no se mapea.", lottieLayer: name });
      continue;
    }

    const plan = planChainMotion(flat, fps, warnings);
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
    fidelity.push(
      plan.anchorBaked
        ? { lottieLayer: name, editorLayerId, editability: "baked", reason: "anchor-offset" }
        : { lottieLayer: name, editorLayerId, editability: "editable" },
    );
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
