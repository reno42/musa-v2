/**
 * Per-frame animation playback state — a tiny external store so the panel
 * (play/scrub controls) can drive every DesignFrame instance without prop
 * drilling through InfiniteHtmlCanvas.
 *
 * The engine owns the clock while playing (it publishes elapsed time here);
 * the panel owns it while scrubbing (it publishes a seek time). Same pattern
 * as frameHitTestRegistry: cross-component coordination without React state.
 */

export interface FramePlaybackState {
  playing: boolean;
  /** Timeline position in seconds (publishes while playing AND while scrubbing). */
  timeSec: number;
}

type Listener = () => void;

const states = new Map<string, FramePlaybackState>();
const listeners = new Map<string, Set<Listener>>();

function stateOf(frameId: string): FramePlaybackState {
  let s = states.get(frameId);
  if (!s) {
    s = { playing: false, timeSec: 0 };
    states.set(frameId, s);
  }
  return s;
}

function emit(frameId: string) {
  const subs = listeners.get(frameId);
  if (!subs) return;
  for (const fn of subs) fn();
}

export function subscribeFramePlayback(frameId: string, listener: Listener): () => void {
  let subs = listeners.get(frameId);
  if (!subs) {
    subs = new Set();
    listeners.set(frameId, subs);
  }
  subs.add(listener);
  return () => { subs!.delete(listener); };
}

export function getFramePlayback(frameId: string): FramePlaybackState {
  return stateOf(frameId);
}

export function playFrame(frameId: string, fromSec = 0) {
  const s = stateOf(frameId);
  states.set(frameId, { playing: true, timeSec: fromSec });
  emit(frameId);
}

export function pauseFrame(frameId: string) {
  const s = stateOf(frameId);
  states.set(frameId, { playing: false, timeSec: s.timeSec });
  emit(frameId);
}

/** Stop = pause + rewind (the editor's canvas returns to its authored state). */
export function stopFrame(frameId: string) {
  states.set(frameId, { playing: false, timeSec: 0 });
  emit(frameId);
}

/** Panel-driven scrub: seeks the engine's timeline to an exact time. */
export function seekFrame(frameId: string, timeSec: number) {
  const s = stateOf(frameId);
  states.set(frameId, { playing: s.playing, timeSec: Math.max(0, timeSec) });
  emit(frameId);
}

/** Engine-driven tick while playing (rAF clock). */
export function publishFrameTime(frameId: string, timeSec: number) {
  states.set(frameId, { playing: true, timeSec: Math.max(0, timeSec) });
  emit(frameId);
}

/** Stop every playing frame (e.g. leaving the editor). */
export function stopAllPlayback() {
  for (const frameId of states.keys()) {
    states.set(frameId, { playing: false, timeSec: 0 });
    emit(frameId);
  }
}
