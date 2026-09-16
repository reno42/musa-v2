/**
 * sequencePlayback — the multi-frame reel model (REQ-VID1).
 *
 * A template's frame ORDER is the reel: each frame plays its animation
 * timeline once (loop-aware, same math as the single-frame export), then an
 * optional transition hands off to the next frame. Transitions live on the
 * from-frame's animation (shared/animationSchema.ts FrameTransition) and are
 * matched to the next INCLUDED frame by toFrameId.
 *
 * Transition semantics (deterministic, WYSIWYG with the export):
 *   during a transition slot the outgoing frame HOLDS its final pose and the
 *   incoming frame sits at its authored state (t=0); the only motion is the
 *   transition itself (fade/slide/zoom/wipe). Total reel duration is
 *   therefore Σ take durations + Σ transition durations.
 *
 * Pure functions only — consumed by the Video Mode preview (live DOM) and by
 * exportReelVideo (canvas rasterization), so both can never diverge.
 */

import type { AnimationSchema, TransitionType } from "../../shared/animationSchema.ts";

export interface ReelFrameInput {
  id: string;
  animation?: AnimationSchema | null;
}

export interface ReelTake {
  frameId: string;
  index: number;
  /** Export length of this take: once → durationSec, pingpong → 2×, loop → 1 cycle. */
  durationSec: number;
  /** Transition that hands off to the NEXT take (null on the last one). */
  transitionOut: { type: TransitionType; durationSec: number } | null;
}

export type ReelSample =
  | { kind: "take"; takeIndex: number; frameId: string; localT: number }
  | {
      kind: "transition";
      slotIndex: number;
      type: TransitionType;
      progress: number;
      /** Outgoing frame holds its final pose. */
      fromTakeIndex: number;
      fromLocalT: number;
      /** Incoming frame at its authored state. */
      toTakeIndex: number;
      toLocalT: number;
    };

export interface ReelTimeline {
  takes: ReelTake[];
  /** Cumulative layout: segment i covers [startSec, endSec) of take i; the
   *  transition after take i covers [takeEnd, takeEnd + transition.durationSec). */
  segments: Array<{ takeIndex: number; startSec: number; endSec: number }>;
  slots: Array<{ slotIndex: number; fromTake: number; toTake: number; startSec: number; endSec: number; type: TransitionType }>;
  totalDurationSec: number;
  /** Uniform export grid: the max fps across takes (clamped 1..60). */
  fps: number;
}

/** Export length of one take — identical math to the single-frame export's
 *  resolveTimelineTime (src/lib/videoExport.ts); keep the two in sync. */
function takeExportLength(anim: AnimationSchema | null | undefined): number {
  const dur = Math.max(0.2, anim?.timeline.durationSec ?? 5);
  if (anim?.timeline.loop === "pingpong") return dur * 2;
  return dur; // "once" and one full "loop" cycle export the same length
}

/** Build the reel timeline from ordered frames (already filtered to the
 *  frames that participate — the caller owns reel membership). */
export function buildReelTimeline(frames: ReelFrameInput[], fpsOverride?: number): ReelTimeline {
  const takes: ReelTake[] = frames.map((f, index) => ({
    frameId: f.id,
    index,
    durationSec: takeExportLength(f.animation),
    transitionOut: null,
  }));

  // Transition lookup: first transition on the from-frame whose toFrameId is
  // ANY later frame in this reel (matches the next take by construction when
  // the author targeted the following frame; falls back to a hard cut).
  const laterIds = new Map<string, string>(); // frameId → id of the next take
  for (let i = 0; i < frames.length - 1; i++) laterIds.set(frames[i].id, frames[i + 1].id);
  const nextIds = new Set(frames.slice(1).map(f => f.id));
  for (let i = 0; i < frames.length - 1; i++) {
    const trs = frames[i].animation?.transitions || [];
    const target = laterIds.get(frames[i].id);
    const match = trs.find(t => t.toFrameId === target) || trs.find(t => nextIds.has(t.toFrameId));
    if (match) takes[i].transitionOut = { type: match.type, durationSec: Math.min(5, Math.max(0.1, match.durationSec || 0.6)) };
  }

  const segments: ReelTimeline["segments"] = [];
  const slots: ReelTimeline["slots"] = [];
  let cursor = 0;
  for (let i = 0; i < takes.length; i++) {
    const startSec = cursor;
    const endSec = cursor + takes[i].durationSec;
    segments.push({ takeIndex: i, startSec, endSec });
    cursor = endSec;
    const tr = takes[i].transitionOut;
    if (tr && i < takes.length - 1) {
      slots.push({ slotIndex: slots.length, fromTake: i, toTake: i + 1, startSec: endSec, endSec: endSec + tr.durationSec, type: tr.type });
      cursor = endSec + tr.durationSec;
    }
  }

  const fps = Math.min(60, Math.max(1, fpsOverride || frames.reduce((m, f) => Math.max(m, f.animation?.timeline.fps ?? 30), 30)));
  return { takes, segments, slots, totalDurationSec: cursor, fps };
}

/** Where is the playhead at global time tSec? Clamps to [0, total]. */
export function sampleReelAt(tl: ReelTimeline, tSec: number): ReelSample {
  const t = Math.min(Math.max(0, tSec), tl.totalDurationSec - 1e-6);
  const slot = tl.slots.find(s => t >= s.startSec && t < s.endSec);
  if (slot) {
    return {
      kind: "transition",
      slotIndex: slot.slotIndex,
      type: slot.type,
      progress: (t - slot.startSec) / Math.max(1e-6, slot.endSec - slot.startSec),
      fromTakeIndex: slot.fromTake,
      fromLocalT: tl.takes[slot.fromTake].durationSec,
      toTakeIndex: slot.toTake,
      toLocalT: 0,
    };
  }
  const seg = tl.segments.find(s => t >= s.startSec && t < s.endSec) || tl.segments[tl.segments.length - 1];
  if (!seg) return { kind: "take", takeIndex: 0, frameId: tl.takes[0]?.frameId || "", localT: 0 };
  return {
    kind: "take",
    takeIndex: seg.takeIndex,
    frameId: tl.takes[seg.takeIndex].frameId,
    localT: t - seg.startSec,
  };
}

/** Global time of a take's local time (for syncing the layer timeline's
 *  playhead and click-to-seek). */
export function takeStartSec(tl: ReelTimeline, takeIndex: number): number {
  return tl.segments[takeIndex]?.startSec ?? 0;
}
