/**
 * GestureClassifier — turns per-frame hand observations into editor intents
 * (REQ Gesture Mode §5 vocabulary + §6 classifier.ts).
 *
 * Pure logic: no DOM, no React. QA/gesture-classifier.test.mjs drives it.
 *
 * Design per the REQ evidence base:
 *  - CONSENSUS: a canned gesture must hold 3 consecutive frames before it
 *    counts (§5.4) — kills recognizer flicker.
 *  - DWELL: continuous gestures (palm/pinch/victory) grab after ~150ms
 *    steady, so passing hands never yank the canvas.
 *  - COOLDOWNS: discrete actions (play/stop 600ms, frame swipe 500ms, mode
 *    toggle 900ms) cannot retrigger inside their window.
 *  - FIST = REST: cancels any active continuous gesture with zero effect
 *    (the anti-disaster trick from airmouse, §5.1).
 *  - CLEAN RE-ENTRY: hands gone for >300ms cancels drag/pan/scrub — the
 *    classic "layer glued to a dead pinch" bug can't happen (§11-F2 pulled
 *    into v1 because the failure mode is data loss during the demo).
 *  - SUSPENDED vs ARMED: the mode starts suspended (camera warm, nothing
 *    armed). Both-palms 500ms toggles. While suspended NOTHING is emitted
 *    but the toggle — you can talk and gesticulate in a call untouched.
 *
 * All deltas are in NORMALIZED image space; the bridge (bridge.ts) scales
 * them to screen/world pixels and mirrors X (front camera). Handedness
 * labels are unreliable on unmirrored feeds, so the dominant hand is chosen
 * geometrically (pinching hand first), never by label.
 */

import type { CalibrationProfile } from "./calibration";

export interface Pt {
  x: number;
  y: number;
  z: number;
}

export interface HandObs {
  landmarks: Pt[];
  handedness: string;
  /** Canned MediaPipe category ("Closed_Fist", "Open_Palm", "Victory"…) or "". */
  name: string;
  score: number;
  /** Normalized thumb-tip↔index-tip distance (landmarks 4↔8). */
  pinch: number;
}

export interface Obs {
  t: number;
  hands: HandObs[];
}

export type GestureIntent =
  | { kind: "toggle" }
  | { kind: "panStart" }
  | { kind: "pan"; dx: number; dy: number }
  | { kind: "panEnd" }
  | { kind: "dragStart" }
  | { kind: "drag"; dx: number; dy: number }
  | { kind: "dragEnd" }
  | { kind: "zoom"; factor: number }
  | { kind: "playStop" }
  | { kind: "frame"; delta: number }
  | { kind: "scrubStart" }
  | { kind: "scrub"; dy: number }
  | { kind: "scrubEnd" }
  /** Air cursor (screen mapping happens in the bridge): fingertip position. */
  | { kind: "cursor"; x: number; y: number }
  | { kind: "cursorDown"; x: number; y: number }
  /** x=-1 sentinel: hands lost — release blind and hide the cursor. */
  | { kind: "cursorUp"; x: number; y: number };

// ── Tunables (ms / normalized units) ──

const CONSENSUS_FRAMES = 3;
const CONSENSUS_WINDOW = 450;
const DWELL_MS = 150;
const TOGGLE_MS = 500;
const TOGGLE_COOLDOWN = 900;
const PLAY_COOLDOWN = 600;
const FRAME_COOLDOWN = 500;
const FIST_TO_PALM_WINDOW = 450;
const HANDS_LOST_MS = 300;

const WRIST = 0;
const INDEX_TIP = 8;
const PINCH_INDEX = 8;

/** Relative two-wrist distance change before zoom emits (dead zone). */
const ZOOM_DEAD = 0.015;
/** Fling velocity (normalized x per second) that converts a pan into a swipe. */
const SWIPE_VX = 2.1;
/** Window displacement (normalized) required for a swipe. */
const SWIPE_DIST = 0.16;
const SWIPE_WINDOW = 220;
/** After a play/stop or swipe, palm movement is ignored briefly. */
const PAN_SUPPRESS_MS = 450;

interface PanSample {
  t: number;
  x: number;
  y: number;
}

export class GestureClassifier {
  private mode: "suspended" | "armed" = "suspended";
  private profile: CalibrationProfile;
  private canScrub: () => boolean;

  // consensus on canned gestures
  private cand: { name: string; n: number; t0: number } | null = null;
  private committed = "";
  private committedAt = 0;
  private prevCommitted = "";

  // both-palms toggle + zoom share the two-palm pose
  private toggleStart: number | null = null;
  private toggleSpread: number | null = null;
  /** -Infinity: the epoch must not count as "just fired" for the first action. */
  private lastToggleAt = -Infinity;
  private lastPlayAt = -Infinity;
  private lastFrameAt = -Infinity;
  private zoomSpread: number | null = null;

  // pan (open palm)
  private panActive = false;
  private panCandidateSince: number | null = null;
  private panLast: Pt | null = null;
  private panSamples: PanSample[] = [];
  private panSuppressedUntil = 0;
  private swipeArmedUntil = 0;

  // pinch drag
  private pinchFrames = 0;
  private dragActive = false;
  private dragCandidateSince: number | null = null;
  private dragLast: Pt | null = null;

  // victory scrub
  private scrubActive = false;
  private scrubCandidateSince: number | null = null;
  private scrubLastY: number | null = null;

  // hand loss
  private lastHandsT: number | null = null;

  // air cursor (Pointing_Up = the mouse; pinch = the button)
  private cursorMode = false;
  private cursorDown = false;
  /** Second-hand pinch baseline while the zoom clutch is engaged. */
  private clutchDist: number | null = null;

  label = "";

  constructor(opts: { profile: CalibrationProfile; canScrub: () => boolean; cursorMode?: boolean }) {
    this.profile = opts.profile;
    this.canScrub = opts.canScrub;
    this.cursorMode = opts.cursorMode === true;
  }

  setProfile(profile: CalibrationProfile): void {
    this.profile = profile;
  }

  setMode(mode: "suspended" | "armed"): void {
    this.mode = mode;
    if (mode === "suspended") {
      this.cancelContinuous();
    }
  }

  getMode(): "suspended" | "armed" {
    return this.mode;
  }

  /** Cursor route toggle (settings). Off restores the legacy pinch-drag-layer. */
  setCursorMode(on: boolean): void {
    this.cursorMode = on;
    if (!on) this.clutchDist = null;
  }

  /** Explicit API for "frames stopped arriving / no hands in view". */
  notifyHandsLost(t: number): GestureIntent[] {
    this.lastHandsT = null;
    const intents = this.collectContinuousCancels(t);
    this.cand = null;
    this.committed = "";
    this.toggleStart = null;
    this.toggleSpread = null;
    if (this.mode === "armed") this.label = "";
    return intents;
  }

  update(obs: Obs): GestureIntent[] {
    const intents: GestureIntent[] = [];
    const t = obs.t;

    if (obs.hands.length > 0) {
      this.lastHandsT = t;
    } else if (this.lastHandsT !== null && t - this.lastHandsT >= HANDS_LOST_MS) {
      return this.notifyHandsLost(t);
    } else {
      // Brief dropout — hold the continuous state; don't emit anything new.
      return intents;
    }

    const both = bothPalms(obs);

    // ── Mode toggle: both palms, still, TOGGLE_MS ──
    // Works suspended or armed. Any real spread change (zoom intent) or hand
    // drop resets the dwell so talking with two open palms doesn't flip it.
    if (both) {
      const spread = wristSpread(obs.hands);
      if (this.toggleStart === null) {
        this.toggleStart = t;
        this.toggleSpread = spread;
      }
      const drift = this.toggleSpread ? Math.abs(spread - this.toggleSpread) / Math.max(this.toggleSpread, 0.05) : 0;
      const dwellDone = t - this.toggleStart >= TOGGLE_MS;
      const cooled = t - this.lastToggleAt >= TOGGLE_COOLDOWN;
      if (drift < ZOOM_DEAD * 2) {
        if (dwellDone && cooled) {
          this.lastToggleAt = t;
          this.toggleStart = null;
          this.toggleSpread = null;
          intents.push({ kind: "toggle" });
          return intents;
        }
      } else if (this.mode === "armed") {
        // Spread changed meaningfully → this is a zoom, not a toggle dwell.
        this.toggleStart = null;
        this.toggleSpread = null;
        const factor = this.trackZoom(spread, t);
        if (factor !== null) intents.push({ kind: "zoom", factor });
        // Zoom owns the hands this frame — no single-hand actions.
        return intents;
      } else {
        this.toggleStart = t;
        this.toggleSpread = spread;
      }
      if (!dwellDone || !cooled) {
        // Still inside the toggle dwell (or cooling down) — hold.
        return intents;
      }
    } else {
      this.toggleStart = null;
      this.toggleSpread = null;
    }

    if (this.mode === "suspended") {
      this.decayConsensus();
      return intents;
    }

    // ── Single dominant hand ──
    const hand = pickDominant(obs);
    if (!hand) {
      this.decayConsensus();
      return intents;
    }
    const tip = hand.landmarks[INDEX_TIP];
    const wrist = hand.landmarks[WRIST];
    const g = this.commitCanned(hand.name, t);

    // ── CURSOR MODE: the pointing hand IS the mouse (Pointing_Up). ──
    // Pinch = button: tap = click, hold + move = drag — the delivery layer
    // (gesturePointer) decides click vs drag by what's under the cursor.
    // While held the pose may flicker to Closed_Fist; the hold survives
    // until pinch reopens or the hands are lost (sentinel cursorUp).
    if (this.cursorMode && (g === "Pointing_Up" || this.cursorDown)) {
      if (!this.cursorDown) {
        if (hand.pinch <= this.profile.pinchGrab) {
          this.cursorDown = true;
          this.label = "cursor — click";
          intents.push({ kind: "cursorDown", x: tip.x, y: tip.y });
        } else {
          this.label = "cursor";
          intents.push({ kind: "cursor", x: tip.x, y: tip.y });
        }
      } else if (hand.pinch >= this.profile.pinchRelease) {
        this.cursorDown = false;
        this.label = "cursor";
        intents.push({ kind: "cursorUp", x: tip.x, y: tip.y });
      } else {
        intents.push({ kind: "cursor", x: tip.x, y: tip.y });
      }
      // Second hand pinches the air = zoom clutch (cursor hand keeps aiming).
      const other = obs.hands.find((h) => h !== hand);
      if (this.clutchDist === null) {
        if (other && other.pinch <= this.profile.pinchGrab * 1.6) {
          this.clutchDist = Math.max(other.pinch, 0.03);
        }
      } else if (!other || other.pinch >= this.profile.pinchRelease * 2.2) {
        this.clutchDist = null;
      } else {
        const factor = smoothFactor(other.pinch / this.clutchDist);
        if (factor !== 1) {
          this.label = "pellizco 2ª mano — zoom";
          intents.push({ kind: "zoom", factor });
        }
      }
      return intents;
    }
    this.clutchDist = null;

    // FIST = REST: cancel everything, touch nothing.
    if (g === "Closed_Fist") {
      this.cancelContinuous();
      this.label = "puño — descanso";
      this.prevCommitted = g;
      this.committedAt = t;
      return intents;
    }

    // FIST → OPEN quickly = play/stop (discrete, demo-friendly §5.3).
    if (
      g === "Open_Palm" &&
      this.prevCommitted === "Closed_Fist" &&
      t - this.committedAt <= FIST_TO_PALM_WINDOW &&
      t - this.lastPlayAt > PLAY_COOLDOWN
    ) {
      this.lastPlayAt = t;
      this.prevCommitted = g;
      this.committedAt = t;
      this.cancelContinuous();
      // The opening palm must not jerk-pan right after the toggle.
      this.panSuppressedUntil = t + PAN_SUPPRESS_MS;
      this.label = "play / stop";
      intents.push({ kind: "playStop" });
      return intents;
    }

    // VICTORY = scrub the playhead (only while a frame is playing — gate).
    if (g === "Victory") {
      if (this.scrubActive) {
        if (this.scrubLastY !== null) {
          const dy = tip.y - this.scrubLastY;
          this.scrubLastY = tip.y;
          this.label = "scrub ▸";
          intents.push({ kind: "scrub", dy });
        }
      } else if (this.canScrub()) {
        if (this.scrubCandidateSince === null) {
          this.scrubCandidateSince = t;
        } else if (t - this.scrubCandidateSince >= DWELL_MS) {
          this.scrubActive = true;
          this.scrubLastY = tip.y;
          this.label = "scrub ▸";
          intents.push({ kind: "scrubStart" });
        }
      } else {
        this.scrubCandidateSince = null;
        this.label = "victory (sin playback)";
      }
      this.decayConsensus();
      return intents;
    } else if (this.scrubActive) {
      this.scrubActive = false;
      this.scrubCandidateSince = null;
      this.scrubLastY = null;
      intents.push({ kind: "scrubEnd" });
    }

    // PINCH = grab the selected layer (geometric, hysteresis §5.2).
    if (this.dragActive) {
      if (hand.pinch > this.profile.pinchRelease) {
        this.dragActive = false;
        this.dragLast = null;
        this.pinchFrames = 0;
        this.label = "";
        intents.push({ kind: "dragEnd" });
      } else if (this.dragLast) {
        const dx = tip.x - this.dragLast.x;
        const dy = tip.y - this.dragLast.y;
        this.dragLast = tip;
        this.label = "mover capa ▸";
        if (Math.abs(dx) > 0.0005 || Math.abs(dy) > 0.0005) {
          intents.push({ kind: "drag", dx, dy });
        }
      }
      this.decayConsensus();
      return intents;
    }

    // OPEN PALM = pan (+ fast fling = frame swipe §5.3).
    if (this.panActive && g !== "Open_Palm") {
      this.endPan(intents);
    }

    if (g === "Open_Palm") {
      if (!this.panActive) {
        if (t < this.swipeArmedUntil || t < this.panSuppressedUntil) {
          this.decayConsensus();
          return intents;
        }
        if (this.panCandidateSince === null) {
          // Dwell: the palm pose itself held since consensus — no anchor check,
          // a hand drifting during the 150ms must still be able to grab.
          this.panCandidateSince = t;
        } else if (t - this.panCandidateSince >= DWELL_MS) {
          this.panActive = true;
          this.panLast = wrist;
          this.panSamples = [{ t, x: wrist.x, y: wrist.y }];
          this.label = "palma — pan";
          intents.push({ kind: "panStart" });
        }
      } else if (this.panLast) {
        const dx = wrist.x - this.panLast.x;
        const dy = wrist.y - this.panLast.y;
        this.panLast = wrist;
        this.panSamples.push({ t, x: wrist.x, y: wrist.y });
        while (this.panSamples.length > 2 && t - this.panSamples[0].t > SWIPE_WINDOW) {
          this.panSamples.shift();
        }
        const swipe = detectSwipe(this.panSamples);
        if (swipe && t - this.lastFrameAt > FRAME_COOLDOWN) {
          this.lastFrameAt = t;
          this.endPan(intents);
          this.panSuppressedUntil = t + PAN_SUPPRESS_MS;
          this.swipeArmedUntil = t + PAN_SUPPRESS_MS;
          this.label = swipe > 0 ? "swipe ◂ frame" : "swipe ▸ frame";
          intents.push({ kind: "frame", delta: swipe });
          this.decayConsensus();
          return intents;
        }
        this.label = "palma — pan";
        if (Math.abs(dx) > 0.0004 || Math.abs(dy) > 0.0004) {
          intents.push({ kind: "pan", dx, dy });
        }
      }
    }

    // PINCH START (not dragging yet): mini-consensus + dwell. Disabled in
    // cursor mode — there the pinch is the MOUSE BUTTON, not a layer grab.
    if (this.cursorMode) {
      this.pinchFrames = 0;
      this.dragCandidateSince = null;
    } else if (!this.panActive && !this.dragActive) {
      if (hand.pinch <= this.profile.pinchGrab) {
        this.pinchFrames++;
        if (this.pinchFrames >= 2) {
          if (this.dragCandidateSince === null) {
            // Dwell starts when the closed pinch itself is first seen — no
            // anchor check: closing in while approaching must still grab.
            this.dragCandidateSince = t;
          } else if (t - this.dragCandidateSince >= DWELL_MS) {
            this.dragActive = true;
            this.dragCandidateSince = null;
            this.dragLast = tip;
            this.cancelPanSilent();
            this.label = "pinch — mover capa";
            intents.push({ kind: "dragStart" });
          }
        }
      } else {
        this.pinchFrames = 0;
        this.dragCandidateSince = null;
      }
    }

    // NOTE: no decayConsensus() here — the candidate must SURVIVE across
    // frames or the 3-frame consensus can never commit (commitCanned owns
    // candidate invalidation: different pose, window expiry, hand loss).
    return intents;
  }

  // ── internals ──

  private commitCanned(name: string, t: number): string {
    if (!name) {
      this.cand = null;
      return "";
    }
    if (this.committed === name) {
      this.committedAt = t;
      return name;
    }
    if (!this.cand || this.cand.name !== name) {
      this.cand = { name, n: 1, t0: t };
    } else if (t - this.cand.t0 > CONSENSUS_WINDOW) {
      this.cand = { name, n: 1, t0: t };
    } else {
      this.cand.n++;
      if (this.cand.n >= CONSENSUS_FRAMES) {
        this.prevCommitted = this.committed;
        this.committed = name;
        this.committedAt = t;
        this.cand = null;
        return name;
      }
    }
    return this.committed === name ? name : "";
  }

  private decayConsensus(): void {
    this.cand = null;
  }

  private trackZoom(spread: number, t: number): number | null {
    if (this.zoomSpread === null) {
      this.zoomSpread = spread;
      return null;
    }
    const factor = spread / Math.max(this.zoomSpread, 0.05);
    if (Math.abs(factor - 1) < ZOOM_DEAD) return null;
    this.zoomSpread = spread;
    this.label = factor > 1 ? "zoom +" : "zoom −";
    void t;
    return smoothFactor(factor);
  }

  private endPan(intents: GestureIntent[]): void {
    if (!this.panActive) return;
    this.panActive = false;
    this.panCandidateSince = null;
    this.panLast = null;
    this.panSamples = [];
    this.label = "";
    intents.push({ kind: "panEnd" });
  }

  private cancelPanSilent(): void {
    this.panActive = false;
    this.panCandidateSince = null;
    this.panLast = null;
    this.panSamples = [];
  }

  private collectContinuousCancels(t: number): GestureIntent[] {
    const intents: GestureIntent[] = [];
    if (this.panActive) {
      this.endPan(intents);
      this.panSuppressedUntil = t + PAN_SUPPRESS_MS;
    }
    if (this.dragActive) {
      this.dragActive = false;
      this.dragLast = null;
      this.pinchFrames = 0;
      this.dragCandidateSince = null;
      intents.push({ kind: "dragEnd" });
    }
    if (this.scrubActive) {
      this.scrubActive = false;
      this.scrubCandidateSince = null;
      this.scrubLastY = null;
      intents.push({ kind: "scrubEnd" });
    }
    this.zoomSpread = null;
    this.clutchDist = null;
    if (this.cursorDown) {
      this.cursorDown = false;
      intents.push({ kind: "cursorUp", x: -1, y: -1 });
    }
    return intents;
  }

  private cancelContinuous(): void {
    this.collectContinuousCancels(0);
  }

  /** For the bridge: a dragStart was rejected (no target) — forget the grab. */
  rejectDrag(): void {
    this.dragActive = false;
    this.dragLast = null;
    this.dragCandidateSince = null;
    this.pinchFrames = 0;
  }
}

// ── pure helpers ──

function bothPalms(obs: Obs): boolean {
  if (obs.hands.length < 2) return false;
  return obs.hands.every((h) => h.name === "Open_Palm" && h.score >= 0.4);
}

function wristSpread(hands: HandObs[]): number {
  const a = hands[0].landmarks[WRIST];
  const b = hands[1].landmarks[WRIST];
  return dist(a, b);
}

function pickDominant(obs: Obs): HandObs | null {
  if (obs.hands.length === 0) return null;
  // The pointing hand is the CURSOR — it always wins, even while the other
  // hand pinches (the zoom clutch would otherwise steal dominance).
  const pointing = obs.hands.find((h) => h.name === "Pointing_Up");
  if (pointing) return pointing;
  // The pinching hand wins; otherwise the first steady canned pose; else hand 0.
  const grabbing = obs.hands.find((h) => h.pinch <= 0.09);
  if (grabbing) return grabbing;
  return obs.hands[0];
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function detectSwipe(samples: PanSample[]): number | null {
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dt = (last.t - first.t) / 1000;
  // 0.02: reject same-frame samples only — a 30fps fling (~33ms) is legit.
  if (dt <= 0.02) return null;
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  if (Math.abs(dx) < SWIPE_DIST || Math.abs(dx) < Math.abs(dy)) return null;
  const vx = dx / dt;
  if (Math.abs(vx) < SWIPE_VX) return null;
  // Image space: hand flings right (x+) → next frame.
  return vx > 0 ? 1 : -1;
}

/** Damp single-frame zoom jumps: the recognizer jitter would stutter the scale. */
function smoothFactor(factor: number): number {
  const capped = Math.max(0.85, Math.min(1.18, factor));
  return 1 + (capped - 1) * 0.6;
}
