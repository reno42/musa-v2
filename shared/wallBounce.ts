/**
 * wallBounce — the flagship "Rebotar contra bordes" parametrized preset
 * (Propuesta_UI_motion_graphics §8, P1.7).
 *
 * Deterministic geometry, zero physics: the object travels in straight
 * segments and touches the walls EXACTLY `contacts` times. The count is the
 * verifiable contract — computed against bounds that respect the object's
 * size (radius + margin), so "N contactos" is checkable in the editor
 * (numbered trajectory overlay) and in the exported video alike. A corner
 * touch counts as ONE contact event with both surfaces noted; the optional
 * "Llegada" (center) segment never adds contacts.
 *
 * Emits standard AnimationSchema clips: ONE linear transform clip for the
 * bounce phase (keyframe per contact — per-segment linear interpolation),
 * an optional ease-out "Llegada" clip (arrival at center) and an optional
 * opacity fade. Easing is per-tween, so phases with different easings must
 * be separate clips on the same layer (legal by the model).
 *
 * Pure functions in, values out — no DOM, no I/O (shared/README.md), so the
 * editor bundle, the trajectory overlay and the QA suite all run this code.
 */

import type { Clip } from "./animationSchema";

// ── Params ───────────────────────────────────────────────────────

/** The subset the UI edits (inspector form → overlay fills the geometry). */
export interface WallBounceUiParams {
  contacts: number;
  /** Bounce-phase duration, before Llegada/fade. */
  durationSec: number;
  /** 0 = right, 90 = down (screen coords, y grows down). */
  dirDeg: number;
  /** Constant speed ("velocity") vs equal time per segment ("intervals"). */
  rhythm: "velocity" | "intervals";
  endMode: "stay" | "center";
  arrivalSec: number;
  exitMode: "none" | "fade";
  fadeSec: number;
  /** Extra gap between the object edge and the wall. */
  margin: number;
}

export interface WallBounceParams extends WallBounceUiParams {
  layerId: string;
  /** The walls: frame size in px. */
  width: number;
  height: number;
  /** Absolute start position of the object center (frame px). */
  startCenter: { x: number; y: number };
  /** The layer's natural (untransformed) center — emitted translates are
   *  relative to it, matching the transform tween convention. */
  origin: { x: number; y: number };
  /** Object half-size: circle radius, conservative envelope otherwise. */
  radius: number;
}

export interface WallBounceContact {
  /** 1-based, chronological. */
  index: number;
  /** Center position at the touch (frame px). */
  x: number;
  y: number;
  side: "left" | "right" | "top" | "bottom" | "corner";
  /** Walls touched at this event — a corner lists both. */
  surfaces: Array<"left" | "right" | "top" | "bottom">;
  /** Absolute time of the touch inside the bounce phase. */
  tSec: number;
}

export interface WallBounceResult {
  clips: Clip[];
  contacts: WallBounceContact[];
  bounceDur: number;
  totalDurationSec: number;
}

// ── Helpers ──────────────────────────────────────────────────────

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const round2 = (n: number) => Math.round(n * 100) / 100;
const EPS = 1e-6;

const tf = (x: number, y: number) =>
  `translateX(${round2(x)}px) translateY(${round2(y)}px) scale(1) rotate(0deg)`;

// ── The generator ────────────────────────────────────────────────

export function buildWallBounce(p: WallBounceParams): WallBounceResult {
  const contactsN = Math.round(p.contacts);
  if (!Number.isFinite(contactsN) || contactsN < 1 || contactsN > 100) {
    throw new Error(`Contactos debe estar entre 1 y 100 (recibido ${p.contacts}).`);
  }
  const dur = clamp(p.durationSec, 0.3, 120);
  const arrival = clamp(p.arrivalSec, 0.1, 5);
  const fade = clamp(p.fadeSec, 0.1, 5);
  const r = Math.max(1, p.radius);
  const margin = Math.max(0, p.margin);
  const minX = margin + r, maxX = p.width - margin - r;
  const minY = margin + r, maxY = p.height - margin - r;
  if (maxX - minX < 1 || maxY - minY < 1) {
    throw new Error(`El objeto (Ø ${round2(r * 2)}px) no cabe en ${p.width}×${p.height} con margen ${round2(margin)}px — reduce el tamaño del objeto o el margen.`);
  }

  // Start clamped inside the reachable bounds (a start on/behind a wall would
  // fake an instant contact — the clamp makes it a real, visible touch).
  let x = clamp(p.startCenter.x, minX, maxX);
  let y = clamp(p.startCenter.y, minY, maxY);
  const rad = (p.dirDeg * Math.PI) / 180;
  let vx = Math.cos(rad);
  let vy = Math.sin(rad);
  if (Math.abs(vx) < EPS && Math.abs(vy) < EPS) { vx = Math.SQRT1_2; vy = Math.SQRT1_2; }

  // Ray-march: straight segments, mirror the velocity at each wall touch.
  const contacts: WallBounceContact[] = [];
  const pts: Array<{ x: number; y: number }> = [{ x, y }];
  const segLens: number[] = [];
  for (let i = 0; i < contactsN; i++) {
    // Time to each wall (sign guards prevent zero-time re-hits of the wall
    // we just bounced off — the classic reflection bug).
    const tx = vx > EPS ? (maxX - x) / vx : vx < -EPS ? (minX - x) / vx : Infinity;
    const ty = vy > EPS ? (maxY - y) / vy : vy < -EPS ? (minY - y) / vy : Infinity;
    const t = Math.min(tx, ty);
    if (!Number.isFinite(t)) break; // unreachable with valid bounds — safety net
    x += vx * t;
    y += vy * t;
    // Snap to the wall (fp error) and note every touched surface: a corner
    // is ONE contact event with two surfaces.
    const surfaces: Array<"left" | "right" | "top" | "bottom"> = [];
    if (Math.abs(x - maxX) < 0.01) { x = maxX; surfaces.push("right"); }
    else if (Math.abs(x - minX) < 0.01) { x = minX; surfaces.push("left"); }
    if (Math.abs(y - maxY) < 0.01) { y = maxY; surfaces.push("bottom"); }
    else if (Math.abs(y - minY) < 0.01) { y = minY; surfaces.push("top"); }
    if (surfaces.length === 0) break; // fp paranoia — never loop without a wall
    contacts.push({
      index: i + 1,
      x: round2(x), y: round2(y),
      side: surfaces.length >= 2 ? "corner" : surfaces[0],
      surfaces,
      tSec: 0, // filled below
    });
    if (surfaces.includes("left") || surfaces.includes("right")) vx = -vx;
    if (surfaces.includes("top") || surfaces.includes("bottom")) vy = -vy;
    const prev = pts[pts.length - 1];
    segLens.push(Math.hypot(x - prev.x, y - prev.y));
    pts.push({ x, y });
  }
  if (contacts.length < contactsN) {
    throw new Error(`Trayectoría degenerada: solo ${contacts.length} de ${contactsN} contactos alcanzables — revisa posición o dirección inicial.`);
  }

  // Timing: "velocity" = constant speed (time ∝ segment length); "intervals"
  // = equal time per segment. N contacts ⇒ N segments from start through the
  // last touch, totalling the bounce duration.
  const totalLen = segLens.reduce((a, b) => a + b, 0);
  const segTimes = segLens.map(len =>
    p.rhythm === "intervals" ? dur / contactsN : totalLen > 0 ? (len / totalLen) * dur : 0,
  );
  let bounceDur = 0;
  for (let i = 0; i < contacts.length; i++) {
    bounceDur += segTimes[i];
    contacts[i].tSec = round2(bounceDur);
  }
  bounceDur = round2(Math.max(0.05, bounceDur));

  // Bounce clip: linear transform tween, one keyframe per path point.
  const bounceClip: Clip = {
    layerId: p.layerId,
    startSec: 0,
    endSec: bounceDur,
    tweens: [{
      prop: "transform",
      easing: "linear",
      keyframes: pts.map((pt, i) => ({
        // pts[i] time = 0 for the start, contacts[i-1].tSec afterwards.
        t: i === 0 ? 0 : round2(clamp(contacts[i - 1].tSec / bounceDur, 0, 1)),
        value: tf(pt.x - p.origin.x, pt.y - p.origin.y),
      })),
    }],
  };

  const clips: Clip[] = [bounceClip];

  // Llegada (optional): ease-out straight to the frame center from the last
  // touch — labeled separately and NEVER counted as a contact.
  let afterBounce = bounceDur;
  if (p.endMode === "center") {
    const last = pts[pts.length - 1];
    clips.push({
      layerId: p.layerId,
      startSec: bounceDur,
      endSec: round2(bounceDur + arrival),
      tweens: [{
        prop: "transform",
        easing: "ease-out",
        keyframes: [
          { t: 0, value: tf(last.x - p.origin.x, last.y - p.origin.y) },
          { t: 1, value: tf(p.width / 2 - p.origin.x, p.height / 2 - p.origin.y) },
        ],
      }],
    });
    afterBounce = bounceDur + arrival;
  }

  // Fade out (optional): opacity 1 → 0 at the very end.
  if (p.exitMode === "fade") {
    clips.push({
      layerId: p.layerId,
      startSec: round2(afterBounce),
      endSec: round2(afterBounce + fade),
      tweens: [{
        prop: "opacity",
        easing: "ease-in",
        keyframes: [{ t: 0, value: "1" }, { t: 1, value: "0" }],
      }],
    });
    afterBounce = afterBounce + fade;
  }

  return { clips, contacts, bounceDur, totalDurationSec: round2(afterBounce) };
}
