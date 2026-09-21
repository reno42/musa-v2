/**
 * GestureTracker — MediaPipe Tasks Vision wrapper (REQ Gesture Mode §6
 * tracker.ts + §3 self-hosting rule + §4 camera conflict handling).
 *
 *  - Lazy: `import("@mediapipe/tasks-vision")` runs only when the user turns
 *    the mode on; the main bundle never sees it.
 *  - Self-hosted: FilesetResolver points at /wasm and the model at
 *    /models/gesture_recognizer.task (copied from the npm package into
 *    public/). No Google/jsDelivr CDN — MediaPipe rotates model URLs and the
 *    demo must not die on conference wifi (§10-r3).
 *  - GPU delegate with CPU fallback; runningMode VIDEO; numHands 2.
 *  - Camera errors are mapped to actionable Spanish messages — the
 *    NotReadableError case is the #1 demo risk (Meets desktop owns the cam).
 *  - The video element lives OFF-DOM; consumers draw landmarks, and the HUD
 *    may pull it for a tiny mirrored preview.
 */

import type { GestureRecognizer, GestureRecognizerResult } from "@mediapipe/tasks-vision";

export interface TrackerHand {
  landmarks: Array<{ x: number; y: number; z: number }>;
  handedness: string;
  /** Canned gesture name ("Closed_Fist"…) or "" when below confidence. */
  name: string;
  score: number;
  /** Normalized thumb↔index tip distance (landmarks 4↔8). */
  pinch: number;
}

export interface TrackerFrame {
  t: number;
  hands: TrackerHand[];
  /** EMA of inter-frame interval in ms (drives FPS adaptive). */
  interval: number;
}

const MODEL_PATH = "/models/gesture_recognizer.task";
const WASM_PATH = "/wasm";
const GESTURE_MIN_SCORE = 0.55;

/** Camera busy — the classic "Meets desktop owns the webcam" case (REQ §4). */
export function mapCameraError(err: unknown): Error {
  const e = err as { name?: string; message?: string } | null;
  const name = e?.name || "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new Error("Permiso de cámara denegado — actívalo desde el candado de la barra de direcciones y reintenta.");
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return new Error("Tu cámara la está usando otra app (Meets desktop, Zoom…). Ciérrala o usa Meets web en Chrome.");
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return new Error("No se encontró una cámara compatible con el modo gesto.");
  }
  return new Error(`No se pudo abrir la cámara: ${e?.message || "error desconocido"}`);
}

export class GestureTracker {
  private recognizer: GestureRecognizer | null = null;
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private rafId = 0;
  private vfcId = 0;
  private running = false;
  private lastVideoTime = -1;
  private lastFrameT = 0;
  private interval = 33;
  private onFrame: ((f: TrackerFrame) => void) | null = null;
  private degraded = false;

  static async create(): Promise<GestureTracker> {
    const tracker = new GestureTracker();
    const vision = await import("@mediapipe/tasks-vision");
    const fileset = await vision.FilesetResolver.forVisionTasks(WASM_PATH);
    const make = (delegate: "GPU" | "CPU") =>
      vision.GestureRecognizer.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate },
        runningMode: "VIDEO",
        numHands: 2,
      });
    try {
      tracker.recognizer = await make("GPU");
    } catch {
      // Some laptops fall back to software GL — tracking still works on CPU.
      tracker.recognizer = await make("CPU");
    }
    return tracker;
  }

  async start(onFrame: (f: TrackerFrame) => void, onError: (message: string) => void): Promise<void> {
    this.onFrame = onFrame;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 },
        },
      });
    } catch (err) {
      const mapped = mapCameraError(err);
      onError(mapped.message);
      throw mapped;
    }
    const video = (this.video = document.createElement("video"));
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.stream;
    await new Promise<void>((resolve) => {
      if (video.readyState >= 2) {
        resolve();
        return;
      }
      video.onloadeddata = () => resolve();
    });
    try {
      await video.play();
    } catch {
      // Off-DOM video can throw play() rejections in rare builds — the rVFC
      // loop still receives frames once readyState advances.
    }
    this.running = true;
    this.lastVideoTime = -1;
    this.lastFrameT = 0;
    this.loop();
  }

  getVideo(): HTMLVideoElement | null {
    return this.video;
  }

  isDegraded(): boolean {
    return this.degraded;
  }

  /** FPS adaptive (REQ §6.5): drop the camera resolution before the editor drops frames. */
  setResolution(width: number, height: number): void {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return;
    track
      .applyConstraints({ width: { ideal: width }, height: { ideal: height } })
      .catch(() => {
        // Driver refuses — the interval-based degradation guard simply won't reapply.
      });
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.vfcId = 0;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    const rec = this.recognizer;
    this.recognizer = null;
    try {
      await rec?.close();
    } catch {
      // Double-close protection — nothing to do.
    }
    this.onFrame = null;
  }

  private loop = (): void => {
    if (!this.running) return;
    const v = this.video;
    if (!v) return;
    const schedule = () => {
      if (!this.running) return;
      const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback;
      if (typeof rvfc === "function") {
        this.vfcId = rvfc.call(v, () => this.loop());
      } else {
        this.rafId = requestAnimationFrame(this.loop);
      }
    };
    if (v.readyState < 2 || v.currentTime === this.lastVideoTime) {
      schedule();
      return;
    }
    this.lastVideoTime = v.currentTime;
    const now = performance.now();
    if (this.lastFrameT > 0) {
      const iv = now - this.lastFrameT;
      if (iv > 4 && iv < 500) this.interval = this.interval * 0.8 + iv * 0.2;
    }
    this.lastFrameT = now;
    try {
      const res = this.recognizer!.recognizeForVideo(v, now);
      this.onFrame?.(toTrackerFrame(res, now, this.interval));
    } catch {
      // One bad frame must never kill the loop.
    }
    schedule();
  };
}

function pinchDistance(lms: Array<{ x: number; y: number }>): number {
  const a = lms[4];
  const b = lms[8];
  if (!a || !b) return 1;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function toTrackerFrame(res: GestureRecognizerResult, t: number, interval: number): TrackerFrame {
  const hands: TrackerHand[] = (res.landmarks || []).map((lm, i) => {
    const g = res.gestures?.[i]?.[0];
    const usable = g && g.score >= GESTURE_MIN_SCORE ? g.categoryName : "";
    const handed = res.handedness?.[i]?.[0];
    return {
      landmarks: lm.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      handedness: handed?.categoryName || "",
      name: usable,
      score: g?.score ?? 0,
      pinch: pinchDistance(lm),
    };
  });
  return { t, hands, interval };
}
