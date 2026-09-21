/**
 * External store for Musa Hands UI state (REQ Gesture Mode §6 hud.tsx
 * backing store + §7 gesture_event log). Plain TS — React components
 * subscribe with useSyncExternalStore; ChatFAB reads the gesture log
 * directly for the local `get_recent_gestures` tool.
 *
 * The camera frame feed for the HUD travels OUTSIDE React on purpose
 * (setLatestFrame/getLatestFrame): 30fps updates must never re-render
 * the editor.
 */

export type GestureStatus = "off" | "loading" | "suspended" | "armed" | "error";

export interface GestureEventRecord {
  t: number;
  gesture: string;
  action: string;
  target?: string;
  detail?: string;
}

export interface GestureState {
  status: GestureStatus;
  /** Human message for the HUD (loading progress, errors, hints). */
  message: string;
  /** Current gesture label for the HUD ("palma → pan", …). */
  label: string;
  /** Tracking fps (EMA) for the quality mask. */
  fps: number;
  /** True once FPS adaptive dropped the camera resolution. */
  degraded: boolean;
  /** HUD visibility (settings). */
  hudVisible: boolean;
  /** Presenter mode: thick skeleton + big labels, made for the demo clip. */
  presenter: boolean;
  /** 0.2–1.5 — multiplies every movement gain. */
  sensitivity: number;
  /** Air-cursor route: pointing finger = mouse, pinch = click. */
  cursor: boolean;
}

interface PersistedSettings {
  hudVisible: boolean;
  presenter: boolean;
  sensitivity: number;
  cursor: boolean;
}

const SETTINGS_KEY = "musa-hands-settings-v1";
const DEFAULTS: GestureState = {
  status: "off",
  message: "",
  label: "",
  fps: 0,
  degraded: false,
  hudVisible: true,
  presenter: false,
  sensitivity: 0.7,
  cursor: true,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

let state: GestureState = { ...DEFAULTS };
const listeners = new Set<() => void>();

function loadPersisted(): void {
  try {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as Partial<PersistedSettings>;
    state = {
      ...state,
      hudVisible: s.hudVisible !== false,
      presenter: s.presenter === true,
      sensitivity: clamp(Number(s.sensitivity) || DEFAULTS.sensitivity, 0.2, 1.5),
      cursor: s.cursor !== false,
    };
  } catch {
    // Corrupt settings — defaults win.
  }
}
loadPersisted();

export function getGestureState(): GestureState {
  return state;
}

export function setGestureState(patch: Partial<GestureState>): void {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

/** Persist-only fields (survives reloads); the rest is session state. */
export function saveGestureSettings(patch: Partial<PersistedSettings>): void {
  setGestureState(patch);
  try {
    if (typeof localStorage === "undefined") return;
    const payload: PersistedSettings = {
      hudVisible: state.hudVisible,
      presenter: state.presenter,
      sensitivity: state.sensitivity,
      cursor: state.cursor,
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
  } catch {
    // Private mode — session-only settings.
  }
}

export function subscribeGesture(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ── gesture_event log (LOCAL, ChatFAB agent reads it — REQ §7) ──

const MAX_EVENTS = 40;
let events: GestureEventRecord[] = [];

export function recordGestureEvent(rec: GestureEventRecord): void {
  events = [rec, ...events].slice(0, MAX_EVENTS);
}

export function getRecentGestureEvents(limit = 15): GestureEventRecord[] {
  return events.slice(0, Math.max(1, limit));
}

export function clearGestureEvents(): void {
  events = [];
}

// ── Live tracking frame for the HUD canvas (non-reactive, 30fps) ──

export interface HudHand {
  landmarks: Array<{ x: number; y: number; z: number }>;
  handedness: string;
  pinch: number;
}

export interface HudFrame {
  t: number;
  hands: HudHand[];
  label: string;
}

let latestFrame: HudFrame | null = null;

export function setLatestFrame(frame: HudFrame | null): void {
  latestFrame = frame;
}

export function getLatestFrame(): HudFrame | null {
  return latestFrame;
}

// ── Air cursor slot (non-reactive, 30fps — same pattern as the HUD frame) ──

export interface CursorSlot {
  visible: boolean;
  /** Screen px. */
  x: number;
  y: number;
  /** Pinch held = button down (ring tightens in the overlay). */
  down: boolean;
}

let cursorSlot: CursorSlot = { visible: false, x: 0, y: 0, down: false };

export function setCursorSlot(patch: Partial<CursorSlot>): void {
  cursorSlot = { ...cursorSlot, ...patch };
}

export function getCursorSlot(): CursorSlot {
  return cursorSlot;
}
