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

export interface TransformParts { x: number; y: number; scale: number; rotate: number }

/** Parse any authored transform value into parts (missing pieces = identity).
 *  Tolerates arbitrary unit suffixes on translate/scale/rotate numbers. */
export function parseTransform(value: string | undefined | null): TransformParts {
  const v = (value || "").trim();
  const out: TransformParts = { x: 0, y: 0, scale: 1, rotate: 0 };
  if (!v) return out;
  const tx = /translateX\(\s*(-?[\d.]+)/.exec(v);
  const ty = /translateY\(\s*(-?[\d.]+)/.exec(v);
  const sc = /scale\(\s*(-?[\d.]+)/.exec(v);
  const ro = /rotate\(\s*(-?[\d.]+)/.exec(v);
  if (tx) out.x = Number(tx[1]);
  if (ty) out.y = Number(ty[1]);
  if (sc) out.scale = Number(sc[1]);
  if (ro) out.rotate = Number(ro[1]);
  return out;
}

/** Canonical transform string (the value every preset and the gizmo write). */
export function composeTransform(p: TransformParts): string {
  const r6 = (n: number) => Number(n.toFixed(3));
  return `translateX(${r6(p.x)}px) translateY(${r6(p.y)}px) scale(${r6(p.scale)}) rotate(${r6(p.rotate)}deg)`;
}

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

/** Move one keyframe (by index) to a new take-local time. */
export function moveKeyframe(
  schemaIn: AnimationSchema | null | undefined,
  layerId: string,
  prop: string,
  kfIndex: number,
  newTLocal: number,
): EditResult {
  const base = schemaIn ? normalizeAnimation(schemaIn) : null;
  const clip = base ? findClip(base, layerId) : undefined;
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

/** Delete one keyframe by index (last one → the tween goes static-held). */
export function deleteKeyframe(
  schemaIn: AnimationSchema | null | undefined,
  layerId: string,
  prop: string,
  kfIndex: number,
): EditResult {
  const base = schemaIn ? normalizeAnimation(schemaIn) : null;
  const clip = base ? findClip(base, layerId) : undefined;
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

/** Set the easing of one property's tween. */
export function setTweenEasing(
  schemaIn: AnimationSchema | null | undefined,
  layerId: string,
  prop: string,
  easing: string,
): EditResult {
  const base = schemaIn ? normalizeAnimation(schemaIn) : null;
  if (!base) return { schema: null };
  const nextClips = base.clips.map(c => (c.layerId === layerId
    ? { ...c, tweens: c.tweens.map(tw => (String(tw.prop) === prop ? { ...tw, easing } : tw)) } : c));
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
