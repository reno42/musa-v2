/**
 * timelineLanes — per-property lanes for the animation editor (P1.3 of the
 * motion-graphics proposal: "carriles de propiedades y rombos editables").
 *
 * A LANE is one clip·tween pair of one layer: the wall-bounce preset emits
 * THREE clips for the same layer (bounce transform·linear, llegada
 * transform·ease-out, fade opacity·ease-in), so lanes are keyed by the clip's
 * index in schema.clips — NOT by property name. Same grammar as
 * shared/wallBounce.ts, no new storage: lanes are a projection of
 * AnimationSchema for the timeline diamonds and the inspector panel.
 *
 * Pure functions in, values out — no DOM, no I/O (shared/README.md). Pass a
 * NORMALIZED schema (the callers already normalize); keyframe `index` is the
 * position inside tween.keyframes, the handle the move/delete/duplicate
 * editors in src/lib/layerKeyframes.ts address.
 */

import type { AnimationSchema } from "./animationSchema";

// ── Labels ───────────────────────────────────────────────────────

/** UI label per animated property (unknown props fall through raw). */
export const LANE_PROP_LABELS: Record<string, string> = {
  transform: "Transform",
  opacity: "Opacidad",
};

export function lanePropLabel(prop: string): string {
  return LANE_PROP_LABELS[prop] ?? prop;
}

// ── Lane projection ──────────────────────────────────────────────

export interface LaneKeyframeRef {
  /** Position inside tween.keyframes — the edit handle. */
  index: number;
  /** Normalized time within the clip window (0..1). */
  t: number;
  /** Absolute take-local time of the keyframe (clip window applied). */
  tSec: number;
  value: string;
}

export interface TimelineLane {
  /** Position of the owning clip in schema.clips — the lane identity. */
  clipIndex: number;
  prop: string;
  easing: string;
  /** Clip window in take-local seconds. */
  startSec: number;
  endSec: number;
  keyframes: LaneKeyframeRef[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** One lane per clip·tween of `layerId`, ordered by clip window start.
 *  A property animated in several clips (bounce + llegada) yields separate
 *  lanes with their own easing — that is the point. */
export function buildTimelineLanes(
  schema: AnimationSchema | null | undefined,
  layerId: string,
): TimelineLane[] {
  const lanes: TimelineLane[] = [];
  schema?.clips.forEach((clip, clipIndex) => {
    if (clip.layerId !== layerId) return;
    const dur = Math.max(0, clip.endSec - clip.startSec);
    for (const tw of clip.tweens) {
      const keyframes = tw.keyframes
        .map((k, index) => ({
          index,
          t: k.t,
          tSec: round2(clip.startSec + k.t * dur),
          value: String(k.value),
        }))
        .sort((a, b) => (a.t - b.t) || (a.index - b.index));
      lanes.push({
        clipIndex,
        prop: String(tw.prop),
        easing: String(tw.easing ?? "linear"),
        startSec: clip.startSec,
        endSec: clip.endSec,
        keyframes,
      });
    }
  });
  return lanes.sort((a, b) => (a.startSec - b.startSec) || (a.clipIndex - b.clipIndex));
}
