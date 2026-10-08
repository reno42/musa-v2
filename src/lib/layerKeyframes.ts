/**
 * layerKeyframes — V4.1 authoring helpers for object animation (the
 * After Effects-style editor): property keyframes on a design layer, written
 * into the EXISTING shared grammar (frame.animation.clips — no new storage).
 *
 * All functions are pure (schema in → schema out) and run through
 * normalizeAnimation on the caller side, so editor, MCP and undo stay on one
 * code path. The transform tween uses the canonical value string
 * "translateX(Npx) translateY(Npx) scale(N) rotate(Ndeg)" — parse/compose
 * here so the inspector can edit x/y/scale/rotate independently.
 */

import {
  normalizeAnimation,
  type AnimationSchema,
  type Clip,
  type Keyframe,
  type Tween,
} from "../../shared/animationSchema.ts";

export const CANONICAL_TRANSFORM = "translateX(0px) translateY(0px) scale(1) rotate(0deg)";

// REQ036 P2.2: transform parse/compose moved to shared/transformValue.ts so
// the schema sampler and WAAPI compiler share ONE implementation. Re-exported
// here to keep every existing import surface unchanged.
export { parseTransform, composeTransform, isCanonicalTransform, quadAt } from "../../shared/transformValue.ts";
export type { TransformParts } from "../../shared/transformValue.ts";

/** "50% 30%" → { x: 50, y: 30 } (defaults 50/50). */
export function parseOrigin(origin: string | undefined): { x: number; y: number } {
  const m = origin ? /^\s*([\d.]+)%\s+([\d.]+)%\s*$/.exec(origin) : null;
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 50, y: 50 };
}

export function composeOrigin(x: number, y: number): string {
  return `${Math.round(x)}% ${Math.round(y)}%`;
}

/** Find the layer's clip. `takeDur` bounds the auto-created window. */
function findClip(schema: AnimationSchema, layerId: string): Clip | undefined {
  return schema.clips.find(c => c.layerId === layerId);
}

/** REQ034 P1.3: lane addressing — pick one of the layer's clips by its index
 *  in schema.clips (multi-clip layers: bounce + llegada + fade). */
function findClipAt(schema: AnimationSchema, layerId: string, clipIndex: number): Clip | undefined {
  const c = schema.clips[clipIndex];
  return c && c.layerId === layerId ? c : undefined;
}

function tweenOf(clip: Clip, prop: string): Tween | undefined {
  return clip.tweens.find(t => String(t.prop) === prop);
}

/** Index of the keyframe sitting at `tLocal` (seconds within the CLIP
 *  window) within epsilon — -1 when none. */
export function keyframeIndexAt(tween: Tween, clip: Clip, tLocalSec: number, epsSec = 0.02): number {
  const dur = Math.max(0.0001, clip.endSec - clip.startSec);
  const t = (tLocalSec - clip.startSec) / dur;
  for (let i = 0; i < tween.keyframes.length; i++) {
    if (Math.abs(tween.keyframes[i].t - t) * dur <= epsSec) return i;
  }
  return -1;
}

export interface EditResult {
  schema: AnimationSchema | null;
  /** The clip window the edit landed on (for UI feedback). */
  clip?: Clip;
}

/** Ensure the layer has a clip covering [0, takeDur] and a tween for `prop`,
 *  then upsert a keyframe at `tLocal` (take-local seconds) with `value`.
 *  This is the AUTO-KEY write path (gizmo gestures, inspector edits). */
export function setKeyframeAt(
  schemaIn: AnimationSchema | null | undefined,
  layerId: string,
  prop: string,
  tLocal: number,
  value: string,
  takeDur: number,
  easing = "ease-out",
): EditResult {
  const base = schemaIn ? normalizeAnimation(schemaIn) : null;
  if (!base) return { schema: null };
  let clip = findClip(base, layerId);
  const dur = Math.max(0.2, takeDur);
  if (!clip) {
    clip = { layerId, startSec: 0, endSec: dur, tweens: [] };
    base.clips = [...base.clips, clip];
  }
  let tween = tweenOf(clip, prop);
  if (!tween) {
    tween = { prop, keyframes: [{ t: 0, value }, { t: 1, value }], easing };
    clip.tweens = [...clip.tweens, tween];
  }
  const clipDur = Math.max(0.0001, clip.endSec - clip.startSec);
  const t = Math.min(1, Math.max(0, (tLocal - clip.startSec) / clipDur));
  const idx = keyframeIndexAt(tween, clip, tLocal);
  let keyframes: Keyframe[];
  if (idx >= 0) {
    keyframes = tween.keyframes.map((k, i) => (i === idx ? { ...k, value } : { ...k }));
  } else {
    keyframes = [...tween.keyframes, { t, value }].sort((a, b) => a.t - b.t);
    // Keep the schema invariant: outer keyframes pinned to the clip window.
    keyframes[0] = { ...keyframes[0], t: 0 };
    keyframes[keyframes.length - 1] = { ...keyframes[keyframes.length - 1], t: 1 };
  }
  const nextClips = base.clips.map(c => (c === clip
    ? { ...c, tweens: c.tweens.map(tw => (tw === tween ? { ...tw, keyframes } : tw)) }
    : c));
  return { schema: normalizeAnimation({ ...base, clips: nextClips }) || null, clip };
}

/** Replace a property's tween with a static hold (auto-key OFF edits). */
export function setStaticValue(
  schemaIn: AnimationSchema | null | undefined,
  layerId: string,
  prop: string,
  value: string,
  takeDur: number,
): EditResult {
  // Two pinned keys with the same value = the whole window holds.
  const first = setKeyframeAt(schemaIn, layerId, prop, 0, value, takeDur, "linear");
  if (!first.schema) return { schema: null };
  return setKeyframeAt(first.schema, layerId, prop, takeDur, value, takeDur, "linear");
}

/** Toggle a keyframe at `tLocal`: present → remove (falls back to a static
 *  hold when it was the last one); absent → add with the currently sampled
 *  value. Classic stopwatch behavior. */
export function toggleKeyframeAt(
  schemaIn: AnimationSchema | null | undefined,
  layerId: string,
  prop: string,
  tLocal: number,
  sampledValue: string,
  takeDur: number,
): EditResult {
  const base = schemaIn ? normalizeAnimation(schemaIn) : null;
  const clip = base ? findClip(base, layerId) : undefined;
  const tween = clip ? tweenOf(clip, prop) : undefined;
  if (clip && tween && keyframeIndexAt(tween, clip, tLocal) >= 0) {
    const clipDur = Math.max(0.0001, clip.endSec - clip.startSec);
    const t = Math.min(1, Math.max(0, (tLocal - clip.startSec) / clipDur));
    const remaining = tween.keyframes.filter(k => Math.abs(k.t - t) * clipDur > 0.02);
    let nextClips = base!.clips;
    if (remaining.length === 0) {
      // Last key removed → static hold at the sampled value.
      nextClips = nextClips.map(c => (c.layerId === layerId
        ? { ...c, tweens: c.tweens.filter(tw => tw !== tween) } : c));
    } else {
      nextClips = nextClips.map(c => (c.layerId === layerId
        ? { ...c, tweens: c.tweens.map(tw => (tw === tween ? { ...tw, keyframes: remaining } : tw)) } : c));
    }
    return { schema: normalizeAnimation({ ...base!, clips: nextClips }) || null, clip };
  }
  return setKeyframeAt(schemaIn, layerId, prop, tLocal, sampledValue, takeDur);
}

/** Move one keyframe (by index) to a new take-local time. `clipIndex` picks
 *  the lane's clip on multi-clip layers (undefined = first clip, legacy). */
export function moveKeyframe(
  schemaIn: AnimationSchema | null | undefined,
  layerId: string,
  prop: string,
  kfIndex: number,
  newTLocal: number,
  clipIndex?: number,
): EditResult {
  const base = schemaIn ? normalizeAnimation(schemaIn) : null;
  const clip = base
    ? (clipIndex === undefined ? findClip(base, layerId) : findClipAt(base, layerId, clipIndex))
    : undefined;
  const tween = clip ? tweenOf(clip, prop) : undefined;
  if (!base || !clip || !tween || kfIndex < 0 || kfIndex >= tween.keyframes.length) return { schema: null };
  const clipDur = Math.max(0.0001, clip.endSec - clip.startSec);
  const t = Math.min(1, Math.max(0, (newTLocal - clip.startSec) / clipDur));
  const keyframes = tween.keyframes
    .map((k, i) => (i === kfIndex ? { ...k, t } : { ...k }))
    .sort((a, b) => a.t - b.t);
  keyframes[0] = { ...keyframes[0], t: 0 };
  keyframes[keyframes.length - 1] = { ...keyframes[keyframes.length - 1], t: 1 };
  const nextClips = base.clips.map(c => (c.layerId === layerId
    ? { ...c, tweens: c.tweens.map(tw => (tw === tween ? { ...tw, keyframes } : tw)) } : c));
  return { schema: normalizeAnimation({ ...base, clips: nextClips }) || null, clip };
}

/** Delete one keyframe by index (last one → the tween goes static-held).
 *  `clipIndex` picks the lane's clip on multi-clip layers. */
export function deleteKeyframe(
  schemaIn: AnimationSchema | null | undefined,
  layerId: string,
  prop: string,
  kfIndex: number,
  clipIndex?: number,
): EditResult {
  const base = schemaIn ? normalizeAnimation(schemaIn) : null;
  const clip = base
    ? (clipIndex === undefined ? findClip(base, layerId) : findClipAt(base, layerId, clipIndex))
    : undefined;
  const tween = clip ? tweenOf(clip, prop) : undefined;
  if (!base || !clip || !tween || kfIndex < 0 || kfIndex >= tween.keyframes.length) return { schema: null };
  const keyframes = tween.keyframes.filter((_, i) => i !== kfIndex);
  let nextClips = base.clips;
  if (keyframes.length === 0) {
    nextClips = base.clips.map(c => (c.layerId === layerId
      ? { ...c, tweens: c.tweens.filter(tw => tw !== tween) } : c));
  } else {
    nextClips = base.clips.map(c => (c.layerId === layerId
      ? { ...c, tweens: c.tweens.map(tw => (tw === tween ? { ...tw, keyframes } : tw)) } : c));
  }
  return { schema: normalizeAnimation({ ...base, clips: nextClips }) || null, clip };
}

/** Duplicate one keyframe (by index): a copy with the SAME value lands
 *  strictly between the keyframe and its nearest neighbor, so the pinned
 *  outer keys stay pinned. No room → no change (schema null). */
export function duplicateKeyframe(
  schemaIn: AnimationSchema | null | undefined,
  layerId: string,
  prop: string,
  kfIndex: number,
  clipIndex?: number,
): EditResult {
  const base = schemaIn ? normalizeAnimation(schemaIn) : null;
  const clip = base
    ? (clipIndex === undefined ? findClip(base, layerId) : findClipAt(base, layerId, clipIndex))
    : undefined;
  const tween = clip ? tweenOf(clip, prop) : undefined;
  if (!base || !clip || !tween || kfIndex < 0 || kfIndex >= tween.keyframes.length) return { schema: null };
  const EPS = 1e-4;
  const sorted = [...tween.keyframes].sort((a, b) => a.t - b.t);
  const target = tween.keyframes[kfIndex];
  const si = sorted.indexOf(target);
  const prev = si > 0 ? sorted[si - 1] : undefined;
  const next = si < sorted.length - 1 ? sorted[si + 1] : undefined;
  let newT: number;
  if (next && next.t > target.t + 2 * EPS) newT = target.t + Math.min(0.15, (next.t - target.t) / 2);
  else if (prev && target.t > prev.t + 2 * EPS) newT = target.t - Math.min(0.15, (target.t - prev.t) / 2);
  else return { schema: null, clip };
  // Never collide with a neighbor nor take over a pinned outer slot.
  if (prev && newT <= prev.t + EPS) return { schema: null, clip };
  if (next && newT >= next.t - EPS) return { schema: null, clip };
  if (newT <= EPS || newT >= 1 - EPS) return { schema: null, clip };
  const keyframes = [...tween.keyframes, { t: newT, value: target.value }].sort((a, b) => a.t - b.t);
  keyframes[0] = { ...keyframes[0], t: 0 };
  keyframes[keyframes.length - 1] = { ...keyframes[keyframes.length - 1], t: 1 };
  const nextClips = base.clips.map(c => (c.layerId === layerId
    ? { ...c, tweens: c.tweens.map(tw => (tw === tween ? { ...tw, keyframes } : tw)) } : c));
  return { schema: normalizeAnimation({ ...base, clips: nextClips }) || null, clip };
}

/** Set the easing of one property's tween. `clipIndex` picks the lane's clip
 *  on multi-clip layers (undefined = every clip of the prop, legacy). */
export function setTweenEasing(
  schemaIn: AnimationSchema | null | undefined,
  layerId: string,
  prop: string,
  easing: string,
  clipIndex?: number,
): EditResult {
  const base = schemaIn ? normalizeAnimation(schemaIn) : null;
  if (!base) return { schema: null };
  const nextClips = base.clips.map((c, ci) => {
    if (c.layerId !== layerId) return c;
    if (clipIndex !== undefined && ci !== clipIndex) return c;
    return { ...c, tweens: c.tweens.map(tw => (String(tw.prop) === prop ? { ...tw, easing } : tw)) };
  });
  return { schema: normalizeAnimation({ ...base, clips: nextClips }) || null };
}

/** P1.4: rewrite one keyframe's VALUE in place — its time never moves and
 *  its neighbors stay byte-identical (trajectory node drags: editing SPACE
 *  must never edit TIME; A-04). `clipIndex` picks the lane's clip. */
export function setKeyframeValue(
  schemaIn: AnimationSchema | null | undefined,
  layerId: string,
  prop: string,
  kfIndex: number,
  value: string,
  clipIndex?: number,
): EditResult {
  const base = schemaIn ? normalizeAnimation(schemaIn) : null;
  const clip = base
    ? (clipIndex === undefined ? findClip(base, layerId) : findClipAt(base, layerId, clipIndex))
    : undefined;
  const tween = clip ? tweenOf(clip, prop) : undefined;
  if (!base || !clip || !tween || kfIndex < 0 || kfIndex >= tween.keyframes.length) return { schema: null };
  const keyframes = tween.keyframes.map((k, i) => (i === kfIndex ? { ...k, value } : { ...k }));
  const nextClips = base.clips.map(c => (c.layerId === layerId
    ? { ...c, tweens: c.tweens.map(tw => (tw === tween ? { ...tw, keyframes } : tw)) } : c));
  return { schema: normalizeAnimation({ ...base, clips: nextClips }) || null, clip };
}

/** P2.2: set/clear the spatial control point of the segment that STARTS at
 *  `kfIndex` (the trajectory Bézier handle). `ctrl` null → straight again.
 *  The segment needs a following keyframe, so the LAST keyframe is invalid. */
export function setKeyframeCtrl(
  schemaIn: AnimationSchema | null | undefined,
  layerId: string,
  prop: string,
  kfIndex: number,
  ctrl: { x: number; y: number } | null,
  clipIndex?: number,
): EditResult {
  const base = schemaIn ? normalizeAnimation(schemaIn) : null;
  const clip = base
    ? (clipIndex === undefined ? findClip(base, layerId) : findClipAt(base, layerId, clipIndex))
    : undefined;
  const tween = clip ? tweenOf(clip, prop) : undefined;
  if (!base || !clip || !tween || kfIndex < 0 || kfIndex >= tween.keyframes.length - 1) return { schema: null };
  const keyframes = tween.keyframes.map((k, i) => {
    if (i !== kfIndex) return { ...k };
    if (!ctrl) {
      const { ctrl: _dropCtrl, ...rest } = k;
      return rest;
    }
    return { ...k, ctrl: { x: Math.round(ctrl.x * 100) / 100, y: Math.round(ctrl.y * 100) / 100 } };
  });
  const nextClips = base.clips.map(c => (c.layerId === layerId
    ? { ...c, tweens: c.tweens.map(tw => (tw === tween ? { ...tw, keyframes } : tw)) } : c));
  return { schema: normalizeAnimation({ ...base, clips: nextClips }) || null, clip };
}

/** P1.5: total animated span of one layer (min clip start → max clip end),
 *  for the inspector's "Duración total" retime control. */
export function layerAnimationSpan(
  schemaIn: AnimationSchema | null | undefined,
  layerId: string,
): { startSec: number; endSec: number } | null {
  const base = schemaIn ? normalizeAnimation(schemaIn) : null;
  if (!base) return null;
  const clips = base.clips.filter(c => c.layerId === layerId);
  if (clips.length === 0) return null;
  return {
    startSec: Math.min(...clips.map(c => c.startSec)),
    endSec: Math.max(...clips.map(c => c.endSec)),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** P1.5: retime — rescale the layer's whole animation (clip windows and the
 *  times keyframes land on; keyframe t is normalized so it rides along)
 *  WITHOUT touching any value: same contacts, same destination, new rhythm
 *  (A-06: the contact count survives retiming). Quantization is SEQUENTIAL
 *  so a preset chain (bounce → llegada → fade) stays contiguous at any
 *  scale; normalizeAnimation's 50ms minimum clip duration may grow the
 *  total slightly when the requested span would compress a clip below it. */
export function retimeLayerClips(
  schemaIn: AnimationSchema | null | undefined,
  layerId: string,
  newSpanSec: number,
): EditResult {
  const base = schemaIn ? normalizeAnimation(schemaIn) : null;
  const clips = base ? base.clips.filter(c => c.layerId === layerId) : [];
  if (!base || clips.length === 0) return { schema: null };
  const minStart = Math.min(...clips.map(c => c.startSec));
  const span = Math.max(0.0001, Math.max(...clips.map(c => c.endSec)) - minStart);
  const k = Math.min(600, Math.max(0.2, newSpanSec)) / span;
  const ordered = [...clips].sort((a, b) => a.startSec - b.startSec);
  const times = new Map<Clip, { startSec: number; endSec: number }>();
  let prevEnd: number | null = null;
  for (const c of ordered) {
    const rawStart = minStart + (c.startSec - minStart) * k;
    const rawEnd = minStart + (c.endSec - minStart) * k;
    const startSec = prevEnd !== null ? prevEnd : round2(rawStart);
    const endSec = round2(Math.max(startSec + 0.05, rawEnd));
    times.set(c, { startSec, endSec });
    prevEnd = endSec;
  }
  const nextClips = base.clips.map(c => (times.has(c) ? { ...c, ...times.get(c)! } : c));
  return { schema: normalizeAnimation({ ...base, clips: nextClips }) || null };
}

/** Set the clip's anchor point (CSS transform-origin). */
export function setClipOrigin(
  schemaIn: AnimationSchema | null | undefined,
  layerId: string,
  origin: string | undefined,
): EditResult {
  const base = schemaIn ? normalizeAnimation(schemaIn) : null;
  if (!base) return { schema: null };
  const nextClips = base.clips.map(c => (c.layerId === layerId
    ? (origin ? { ...c, origin } : (() => { const { origin: _drop, ...rest } = c; return rest; })())
    : c));
  return { schema: normalizeAnimation({ ...base, clips: nextClips }) || null };
}

/** Delete the layer's whole clip (AE: clear keyframes). */
export function clearLayerClip(
  schemaIn: AnimationSchema | null | undefined,
  layerId: string,
): EditResult {
  const base = schemaIn ? normalizeAnimation(schemaIn) : null;
  if (!base) return { schema: null };
  return { schema: normalizeAnimation({ ...base, clips: base.clips.filter(c => c.layerId !== layerId) }) || null };
}
