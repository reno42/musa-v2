/**
 * Frame animation engine — drives a frame's compiled tweens as WAAPI
 * animations inside its Shadow DOM content root.
 *
 * The clock is MANUAL: animations stay paused and the engine writes
 * `currentTime` every rAF tick (playing) or on demand (scrub). That makes the
 * preview mathematically identical to the export sampler
 * (shared/animationSchema.ts sampleAnimationAt) — no wall-clock drift between
 * what the user previews and what the video shows — and it makes loop /
 * pingpong exact rewinds of the same timeline instead of WAAPI iteration
 * bookkeeping.
 *
 * WAAPI never touches the persisted html/css: cancel() returns every layer to
 * its authored state, so previewing an animation is zero-risk for the design.
 */

import {
  compileAnimation,
  sampleAnimationAt,
  type AnimationSchema,
  type CompiledTween,
} from "../../shared/animationSchema.ts";
import {
  getFramePlayback,
  pauseFrame,
  publishFrameTime,
  stopFrame,
  subscribeFramePlayback,
  type FramePlaybackState,
} from "./animationPlayback";

export interface FrameAnimator {
  /** Swap the schema (edit, undo, preset apply) — keeps the current time. */
  update(schema: AnimationSchema | null | undefined): void;
  destroy(): void;
}

export function createFrameAnimator(
  frameId: string,
  content: HTMLElement,
  initialSchema: AnimationSchema | null | undefined,
): FrameAnimator {
  let schema: AnimationSchema | null | undefined = initialSchema;
  let compiled: CompiledTween[] = [];
  /** Live WAAPI animations, one per compiled tween. */
  let running: Animation[] = [];
  /** REQ038 P2.4: layers riding a leader via a link — their transform tween
   *  (if any) is NOT compiled into WAAPI; the composed transform is written
   *  inline per tick instead (WAAPI would ignore inline styles). */
  let followerIds: Set<string> = new Set();
  let rafId = 0;
  /** Virtual clock origin (performance.now) for the current playing stretch. */
  let clockStartWall = 0;
  let clockStartOffsetSec = 0;

  const durationMs = () => (schema ? Math.max(16, schema.timeline.durationSec * 1000) : 0);

  function teardown() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    for (const anim of running) {
      try { anim.cancel(); } catch { /* already detached */ }
    }
    running = [];
    // REQ038: followers' inline transforms were engine-written — clear them
    // so teardown restores the authored state exactly like cancel() does.
    for (const followerId of followerIds) {
      const el = content.querySelector(`[data-layer-id="${CSS.escape(followerId)}"]`) as HTMLElement | null;
      if (el) el.style.transform = "";
    }
  }

  /** (Re)create the WAAPI animations from `compiled` at the CURRENT time. */
  function build(timeMs: number) {
    teardown();
    for (const ct of compiled) {
      // REQ038: a follower's transform is composed from its leader — written
      // inline by applyLinks, so the raw WAAPI tween must not exist (it would
      // override the inline style). Other props still animate via WAAPI.
      if (followerIds.has(ct.layerId) && ct.keyframes.some(k => "transform" in k)) continue;
      const el = content.querySelector(`[data-layer-id="${CSS.escape(ct.layerId)}"]`) as HTMLElement | null;
      if (!el) continue; // layer deleted or not yet rendered — skip, resync covers it
      try {
        const anim = el.animate(ct.keyframes, {
          duration: ct.durationMs,
          delay: ct.delayMs,
          fill: "both",
          easing: "linear", // easing lives on each keyframe (per-tween easings)
        });
        anim.pause();
        anim.currentTime = timeMs;
        running.push(anim);
      } catch {
        // Invalid prop/value for this element (e.g. color on an <img>) — the
        // preview must survive partial schemas, not crash the frame.
      }
    }
  }

  /** Apply a timeline position: loop wraps, pingpong reflects, once clamps. */
  function resolveTime(elapsedMs: number): number {
    const dur = durationMs();
    if (!schema || dur <= 0) return 0;
    const loop = schema.timeline.loop;
    if (loop === "once") return Math.min(elapsedMs, dur);
    if (loop === "loop") return elapsedMs % dur;
    // pingpong: forward-backward triangle over [0, 2*dur]
    const cycle = elapsedMs % (dur * 2);
    return cycle <= dur ? cycle : dur * 2 - cycle;
  }

  function applyTime(timeMs: number) {
    for (const anim of running) {
      try { anim.currentTime = timeMs; } catch { /* detached */ }
    }
    applyLinks(timeMs);
  }

  /** REQ038: followers ride their leader — the export sampler composes
   *  leader translate + offset + follower's own motion, so the preview writes
   *  the SAME value inline (WAAPI cannot compose across layers). */
  function applyLinks(timeMs: number) {
    const links = schema?.links || [];
    if (links.length === 0 || !schema) return;
    const samples = sampleAnimationAt(schema, timeMs / 1000);
    for (const link of links) {
      if (followerIds.has(link.leaderId)) continue; // normalize dropped chains; belt and suspenders
      const el = content.querySelector(`[data-layer-id="${CSS.escape(link.followerId)}"]`) as HTMLElement | null;
      if (!el) continue;
      const sample = samples.get(link.followerId);
      if (sample?.transform) el.style.transform = sample.transform;
    }
  }

  function tick() {
    // rafId keeps the CONSUMED id while this callback runs. publishFrameTime
    // below emits synchronously and our own playback subscription re-enters
    // syncState; if rafId were 0 here, that re-entry would schedule a second
    // rAF and every tick would double the chain (2^n callbacks → tab frozen).
    // tick() is the ONLY place that schedules the next frame while playing.
    const elapsed = (performance.now() - clockStartWall) / 1000 + clockStartOffsetSec;
    const timeMs = resolveTime(elapsed * 1000);
    applyTime(timeMs);
    if (schema) {
      const atEnd = schema.timeline.loop === "once" && elapsed >= schema.timeline.durationSec;
      if (atEnd) {
        // Hold the final frame for a beat, then reset to the authored state.
        publishFrameTime(frameId, schema.timeline.durationSec);
        rafId = 0; // release the slot only AFTER the re-entrant syncState saw it truthy
        window.setTimeout(() => stopFrame(frameId), 350);
        return;
      }
      publishFrameTime(frameId, timeMs / 1000);
    }
    rafId = requestAnimationFrame(tick);
  }

  function syncState(state: FramePlaybackState) {
    if (!schema || compiled.length === 0) {
      teardown();
      return;
    }
    if (state.playing) {
      clockStartWall = performance.now();
      clockStartOffsetSec = state.timeSec >= schema.timeline.durationSec - 1e-3 ? 0 : state.timeSec;
      if (!rafId) rafId = requestAnimationFrame(tick);
    } else {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      // Paused at 0 = authored state, nothing to hold.
      if (state.timeSec <= 0) teardown();
      else applyTime(resolveTime(state.timeSec * 1000));
    }
  }

  function update(next: AnimationSchema | null | undefined) {
    schema = next;
    compiled = next ? compileAnimation(next) : [];
    followerIds = new Set((next?.links || []).map(l => l.followerId));
    const state = getFramePlayback(frameId);
    if (compiled.length === 0) {
      teardown();
      if (state.playing) pauseFrame(frameId);
      return;
    }
    build(resolveTime(state.timeSec * 1000));
    syncState(state);
  }

  const unsubscribe = subscribeFramePlayback(frameId, () => syncState(getFramePlayback(frameId)));

  // Editor edits during preview replace animated elements — rebind instantly,
  // but COALESCED: build() cancels and recreates every WAAPI animation, so
  // rebuilding per raw DOM mutation (overlays, inspector refreshes) is too hot
  // and can chain with the mutations it causes. One rebuild per frame max,
  // never inside the mutation microtask.
  let rebuildRaf = 0;
  const observer = new MutationObserver(() => {
    if (compiled.length === 0 || rebuildRaf) return;
    rebuildRaf = requestAnimationFrame(() => {
      rebuildRaf = 0;
      const state = getFramePlayback(frameId);
      build(resolveTime(state.timeSec * 1000));
      syncState(state);
    });
  });
  observer.observe(content, { childList: true, subtree: true });

  update(initialSchema);

  return {
    update,
    destroy() {
      if (rebuildRaf) cancelAnimationFrame(rebuildRaf);
      teardown();
      observer.disconnect();
      unsubscribe();
    },
  };
}
