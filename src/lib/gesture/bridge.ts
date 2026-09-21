/**
 * GestureManager — the bridge (REQ Gesture Mode §6 bridge.ts). Owns the
 * tracker + classifier + One-Euro smoothing and maps intents onto the
 * editor's THREE EXISTING channels — it creates no new editor handlers:
 *
 *  1. VIEWPORT: pan/zoom/frame ride `futuraria:editor-viewport`
 *     (src/lib/editorViewport.ts) — the same CustomEvent ChatFAB's
 *     editor_pan/editor_zoom dispatch, consumed by InfiniteHtmlCanvas
 *     (pan) and EditorV2 (zoom/frame).
 *  2. PLAYBACK: play/stop/scrub call src/lib/animationPlayback.ts directly
 *     (playFrame/stopFrame/seekFrame) — scrub is gated on the frame actually
 *     playing (the engine only honors seeks while its rAF runs).
 *  3. LAYER DRAG: mutations go through the DocumentStore replaceCanvasObjects
 *     (live, undo-free) and commit ONE undo entry on release — the pointer
 *     -event injection path was rejected: setPointerCapture ignores synthetic
 *     pointerIds (plan v2, decision D1).
 *
 * Every action also lands in the local gesture_event log so the ChatFAB
 * agent can see what the human's hands did (REQ §7).
 */

import { GestureTracker, type TrackerFrame } from "./tracker";
import { GestureClassifier, type GestureIntent, type HandObs, type Obs } from "./classifier";
import { OneEuroPoint } from "./smoothing";
import { loadCalibration, type CalibrationProfile } from "./calibration";
import {
  recordGestureEvent,
  setGestureState,
  setLatestFrame,
  getGestureState,
} from "./gestureStore";

export interface GestureEditorActions {
  /** Pan the viewport (screen px). */
  pan(dx: number, dy: number): void;
  /** Multiply the editor zoom by `factor` (editor clamps). */
  zoom(factor: number): void;
  /** Try to grab the current selection as a drag target. */
  dragStart(): boolean;
  /** Move the grabbed layer (screen px; the editor converts to world px). */
  dragMove(dx: number, dy: number): void;
  dragEnd(): void;
  /** Toggle play/stop on the active frame. */
  playStop(): void;
  /** Previous/next frame. */
  frameDelta(delta: number): void;
  /** Begin scrubbing — only true while a frame is actually playing. */
  scrubStart(): boolean;
  /** Advance the playhead (seconds). */
  scrubMove(deltaSeconds: number): void;
  scrubEnd(): void;
  toast(message: string, kind: "success" | "error" | "info"): void;
  /** Active frame id (for the scrub gate). */
  frameId(): string | null;
  isPlaying(id: string | null): boolean;
  /** Air cursor (screen px). The pointing finger is the mouse. */
  cursorMove(x: number, y: number): void;
  cursorDown(x: number, y: number): void;
  /** x=-1 sentinel: hands lost — release blind and hide. */
  cursorUp(x: number, y: number): void;
}

// Gains: normalized image-space movement → screen px. Calibrated so a
// comfortable chest-to-face zone sweep pans roughly a laptop screen width.
const PAN_GAIN = 2.2;
const DRAG_GAIN = 2.0;
/** Seconds of timeline per full-screen-height of victory movement. */
const SCRUB_SECONDS_PER_HEIGHT = 3.5;
/** FPS adaptive: sustained tracking intervals past this degrade the camera. */
const DEGRADE_INTERVAL_MS = 42;
const DEGRADE_FRAMES = 45;

let activeManager: GestureManager | null = null;

export function isGestureActive(): boolean {
  return activeManager !== null;
}

export function getActiveManager(): GestureManager | null {
  return activeManager;
}

export class GestureManager {
  private tracker: GestureTracker | null = null;
  private classifier: GestureClassifier;
  private actions: GestureEditorActions;
  private filters = new Map<string, { wrist: OneEuroPoint; tip: OneEuroPoint }>();
  private slowFrames = 0;
  private lastPanLog = 0;
  private dragAllowed = false;
  private scrubAllowed = false;
  private stopped = false;

  private constructor(actions: GestureEditorActions, profile: CalibrationProfile) {
    this.actions = actions;
    this.classifier = new GestureClassifier({
      profile,
      cursorMode: getGestureState().cursor,
      canScrub: () => {
        const id = this.actions.frameId();
        return !!id && this.actions.isPlaying(id);
      },
    });
  }

  /** Launch the camera + model. Resolves once tracking is live (suspended). */
  static async launch(actions: GestureEditorActions, profile?: CalibrationProfile): Promise<GestureManager> {
    if (activeManager) {
      throw new Error("Gesture mode ya está activo.");
    }
    const mgr = new GestureManager(actions, profile ?? loadCalibration());
    activeManager = mgr;
    setGestureState({ status: "loading", message: "Descargando modelo (~8 MB, una sola vez)…", label: "", fps: 0, degraded: false });
    try {
      mgr.tracker = await GestureTracker.create();
      await mgr.tracker.start(mgr.handleFrame, (message) => {
        setGestureState({ status: "error", message, label: "" });
      });
    } catch (err) {
      activeManager = null;
      mgr.stopped = true;
      setGestureState({ status: "error", message: err instanceof Error ? err.message : "No se pudo iniciar el modo gesto.", label: "" });
      throw err;
    }
    setGestureState({ status: "suspended", message: "Palmas a la cámara medio segundo para armar. Esc o el botón apagan todo." });
    return mgr;
  }

  getMode(): "suspended" | "armed" {
    return this.classifier.getMode();
  }

  /** Off-DOM camera feed — the HUD draws the tiny mirrored preview from it. */
  getVideo(): HTMLVideoElement | null {
    return this.tracker?.getVideo() ?? null;
  }

  /** Both-palms toggle landed → flip suspended/armed. */
  toggleArm(): void {
    if (this.classifier.getMode() === "armed") {
      this.suspend();
    } else {
      this.arm();
    }
  }

  arm(): void {
    this.classifier.setMode("armed");
    setGestureState({ status: "armed", label: "" });
    this.actions.toast("Musa Hands ARMADO — ☝️ apunta: cursor · 🤏 pinch: click · palma: pan", "success");
    recordGestureEvent({ t: Date.now(), gesture: "palmas", action: "arm" });
  }

  suspend(): void {
    this.classifier.setMode("suspended");
    setGestureState({ status: "suspended", label: "", message: "En pausa — nada responde. Palmas a la cámara para rearmar." });
    this.actions.toast("Musa Hands en pausa — tus gestos ya no tocan el editor.", "info");
    recordGestureEvent({ t: Date.now(), gesture: "palmas", action: "suspend" });
  }

  /** Re-arm with a fresh calibration profile (wizard finished). */
  applyProfile(profile: CalibrationProfile): void {
    this.classifier.setProfile(profile);
  }

  /** Cursor route toggle (settings panel) — live, no camera restart. */
  setCursorMode(on: boolean): void {
    this.classifier.setCursorMode(on);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    const tracker = this.tracker;
    this.tracker = null;
    if (activeManager === this) activeManager = null;
    setLatestFrame(null);
    setGestureState({ status: "off", message: "", label: "", fps: 0 });
    try {
      await tracker?.stop();
    } catch {
      // Camera already gone — nothing to clean.
    }
  }

  // ── frame pipeline ──

  private handleFrame = (f: TrackerFrame): void => {
    if (this.stopped) return;
    const s = getGestureState();
    const fps = f.interval > 1 ? Math.round(1000 / f.interval) : s.fps;
    if (fps !== s.fps) setGestureState({ fps });

    setLatestFrame({
      t: f.t,
      label: this.classifier.label,
      hands: f.hands.map((h) => ({ landmarks: h.landmarks, handedness: h.handedness, pinch: h.pinch })),
    });

    const obs = this.buildObservation(f);
    const intents = obs.hands.length === 0 ? this.classifier.notifyHandsLost(f.t) : this.classifier.update(obs);
    for (const intent of intents) {
      this.applyIntent(intent);
    }
    this.adaptPerformance(f);
  };

  /** Smooth wrist (0) and index tip (8) per physical hand, keyed by handedness. */
  private buildObservation(f: TrackerFrame): Obs {
    const hands: HandObs[] = f.hands.map((h) => {
      const key = h.handedness || (h.landmarks[0].x < 0.5 ? "A" : "B");
      let flt = this.filters.get(key);
      if (!flt) {
        flt = { wrist: new OneEuroPoint(1.4, 0.3), tip: new OneEuroPoint(1.6, 0.35) };
        this.filters.set(key, flt);
      }
      const lm = h.landmarks.map((p) => ({ x: p.x, y: p.y, z: p.z }));
      const w = flt.wrist.filter(lm[0].x, lm[0].y, f.t);
      lm[0] = { ...lm[0], x: w.x, y: w.y };
      const tp = flt.tip.filter(lm[8].x, lm[8].y, f.t);
      lm[8] = { ...lm[8], x: tp.x, y: tp.y };
      return { landmarks: lm, handedness: h.handedness, name: h.name, score: h.score, pinch: h.pinch };
    });
    if (f.hands.length === 0 && this.filters.size > 0) {
      this.filters.clear();
    }
    return { t: f.t, hands };
  }

  private applyIntent(intent: GestureIntent): void {
    const a = this.actions;
    const w = typeof window !== "undefined" ? window.innerWidth : 1280;
    const h = typeof window !== "undefined" ? window.innerHeight : 800;
    const sens = getGestureState().sensitivity;
    const now = Date.now();
    switch (intent.kind) {
      case "toggle":
        this.toggleArm();
        break;
      case "panStart":
        break;
      case "pan": {
        // Front camera: image x grows opposite to the user's right → mirror X.
        const dx = -intent.dx * w * PAN_GAIN * sens;
        const dy = intent.dy * h * PAN_GAIN * sens;
        a.pan(dx, dy);
        if (now - this.lastPanLog > 1500) {
          this.lastPanLog = now;
          recordGestureEvent({ t: now, gesture: "palma", action: "pan", detail: `${Math.round(dx)},${Math.round(dy)}` });
        }
        break;
      }
      case "panEnd":
        break;
      case "dragStart":
        this.dragAllowed = a.dragStart();
        if (this.dragAllowed) {
          recordGestureEvent({ t: now, gesture: "pinch", action: "grab_layer" });
        } else {
          this.classifier.rejectDrag();
        }
        break;
      case "drag": {
        if (!this.dragAllowed) break;
        const dx = -intent.dx * w * DRAG_GAIN * sens;
        const dy = intent.dy * h * DRAG_GAIN * sens;
        a.dragMove(dx, dy);
        break;
      }
      case "dragEnd":
        if (this.dragAllowed) {
          this.dragAllowed = false;
          a.dragEnd();
          recordGestureEvent({ t: now, gesture: "pinch", action: "move_layer" });
        }
        break;
      case "zoom": {
        a.zoom(intent.factor);
        recordGestureEvent({ t: now, gesture: "2 palmas", action: "zoom", detail: intent.factor.toFixed(2) });
        break;
      }
      case "playStop":
        a.playStop();
        recordGestureEvent({ t: now, gesture: "puño→palma", action: "play_stop" });
        break;
      case "frame":
        a.frameDelta(intent.delta);
        recordGestureEvent({ t: now, gesture: "swipe", action: intent.delta > 0 ? "next_frame" : "prev_frame" });
        break;
      case "scrubStart":
        this.scrubAllowed = a.scrubStart();
        if (this.scrubAllowed) {
          recordGestureEvent({ t: now, gesture: "victory", action: "scrub_start" });
        } else {
          this.scrubAllowed = false;
        }
        break;
      case "scrub": {
        if (!this.scrubAllowed) break;
        const ds = intent.dy * h * SCRUB_SECONDS_PER_HEIGHT * sens;
        a.scrubMove(ds);
        break;
      }
      case "scrubEnd":
        if (this.scrubAllowed) {
          this.scrubAllowed = false;
          a.scrubEnd();
          recordGestureEvent({ t: now, gesture: "victory", action: "scrub_end" });
        }
        break;
      case "cursor": {
        // Front camera: image x grows opposite to the user's right → mirror X,
        // same as pan. Screen px, no sensitivity gain: a mouse must be 1:1.
        a.cursorMove((1 - intent.x) * w, intent.y * h);
        break;
      }
      case "cursorDown": {
        a.cursorDown((1 - intent.x) * w, intent.y * h);
        recordGestureEvent({ t: now, gesture: "cursor", action: "press" });
        break;
      }
      case "cursorUp": {
        if (intent.x < 0) {
          a.cursorUp(-1, -1); // sentinel: hands lost — release blind + hide
          break;
        }
        a.cursorUp((1 - intent.x) * w, intent.y * h);
        recordGestureEvent({ t: now, gesture: "cursor", action: "release" });
        break;
      }
    }
  }

  /** FPS adaptive (REQ §6.5): editor health beats tracking fidelity. */
  private adaptPerformance(f: TrackerFrame): void {
    const s = getGestureState();
    if (s.degraded) return;
    if (f.interval > DEGRADE_INTERVAL_MS) {
      this.slowFrames++;
      if (this.slowFrames >= DEGRADE_FRAMES && this.tracker) {
        this.slowFrames = 0;
        this.tracker.setResolution(480, 360);
        setGestureState({ degraded: true, message: "Modo ahorro: cámara a 480p para no frenar el editor." });
      }
    } else {
      this.slowFrames = Math.max(0, this.slowFrames - 1);
    }
  }
}
