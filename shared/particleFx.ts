/**
 * particleFx — REQ044: animated particle overlays for the video stage
 * (confetti / rain / snow / sparks / fireflies). Same architecture as the
 * rest of the V5 effect vocabulary: ONE pure implementation consumed by
 * BOTH renderers — the preview's per-tick canvas and the export's
 * drawPlacedWithFx — so the two can never drift.
 *
 * Determinism: every particle's motion is a STATELESS function of time —
 * position = f(i, t) via the catalog's seeded() hash, never per-frame
 * integration. Preview (any display Hz) and export (fixed fps) sample the
 * same trajectory, so motion matches frame for frame.
 *
 * Density: d ∈ [0,1] scales the PARTICLE COUNT, not the alpha — more
 * density = more particles; 0 paints nothing.
 *
 * Dependency rule (mirrors videoEffectsCatalog): this file imports only the
 * catalog's pure seeded() — no renderer code — so QA can drive it under
 * plain Node with a recording stub context.
 */

import { seeded } from "./videoEffectsCatalog.ts";

export type ParticleFxId = "confetti" | "rain" | "snow" | "sparks" | "fireflies";

export interface ParticleFxDef {
  readonly id: ParticleFxId;
  readonly label: string;
  readonly icon: string;
  /** Particle count at density = 1 (scaled linearly below). */
  readonly base: number;
  /** Paint one deterministic instant. t = seconds since take start.
   *  Runs inside drawParticleFx's save/restore — may set fill/stroke/composite
   *  freely. Uses ONLY basic ops (rect/arc/line/translate/rotate) so a stub
   *  context can record every call for QA. */
  draw: (ctx: CanvasRenderingContext2D, W: number, H: number, t: number, d: number) => void;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Geometry scale — sizes/speeds are authored against a 1080 canvas. */
const kOf = (W: number, H: number) => Math.max(W, H) / 1080;
const countOf = (base: number, d: number) => Math.max(0, Math.round(base * clamp01(d)));
/** Positive-domain wrap (particles recycle through the frame). */
const wrap = (v: number, m: number) => { const r = v % m; return r < 0 ? r + m : r; };

// ── confetti: tumbling paper rects, festive palette, sway while falling ──

const CONFETTI_COLORS = ["#e0b57a", "#ffffff", "#7dd3fc", "#f472b6", "#86efac"];

const drawConfetti = (ctx: CanvasRenderingContext2D, W: number, H: number, t: number, d: number) => {
  const k = kOf(W, H), ky = H / 1080;
  const span = H + 60 * k;
  const n = countOf(70, d);
  for (let i = 0; i < n; i++) {
    const x0 = seeded(i, 11) * W;
    const v = (150 + seeded(i, 12) * 180) * ky;
    const w = (5 + seeded(i, 13) * 5) * k;
    const h = (9 + seeded(i, 14) * 8) * k;
    const spin = 2 + seeded(i, 15) * 5;
    const phase = seeded(i, 16) * Math.PI * 2;
    const sway = (10 + seeded(i, 17) * 26) * k;
    const y = wrap(seeded(i, 18) * span + v * t, span) - 30 * k;
    const x = x0 + Math.sin(t * 0.9 + phase) * sway;
    // Tumble: vertical squash oscillates — reads as a flipping paper strip.
    const squash = 0.35 + 0.65 * Math.abs(Math.cos(spin * 0.7 * t + phase));
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(phase + spin * t);
    ctx.fillStyle = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    ctx.fillRect(-w / 2, (-h * squash) / 2, w, h * squash);
    ctx.restore();
  }
};

// ── rain: steep thin streaks, two depth layers ──

const drawRain = (ctx: CanvasRenderingContext2D, W: number, H: number, t: number, d: number) => {
  const k = kOf(W, H), ky = H / 1080;
  const spanY = H + 80 * k, spanX = W + 80 * k;
  const n = countOf(110, d);
  ctx.strokeStyle = "rgba(188,214,235,0.5)";
  ctx.lineWidth = 1.5 * k;
  for (let i = 0; i < n; i++) {
    const near = i % 3 === 0;
    const v = (near ? 850 + seeded(i, 21) * 250 : 600 + seeded(i, 21) * 150) * ky;
    const len = (near ? 18 + seeded(i, 22) * 10 : 10 + seeded(i, 22) * 8) * k;
    const y = wrap(seeded(i, 23) * spanY + v * t, spanY) - 40 * k;
    const x = wrap(seeded(i, 24) * spanX + v * 0.12 * t, spanX) - 40 * k;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 0.12 * len, y - len);
    ctx.strokeStyle = near ? "rgba(188,214,235,0.5)" : "rgba(188,214,235,0.3)";
    ctx.lineWidth = (near ? 1.5 : 1.1) * k;
    ctx.stroke();
  }
};

// ── snow: soft dots drifting in slow sine paths ──

const drawSnow = (ctx: CanvasRenderingContext2D, W: number, H: number, t: number, d: number) => {
  const k = kOf(W, H), ky = H / 1080;
  const span = H + 40 * k;
  const n = countOf(90, d);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  for (let i = 0; i < n; i++) {
    const r = (1.6 + seeded(i, 31) * 3) * k;
    const v = (40 + seeded(i, 32) * 80) * ky;
    const amp = (14 + seeded(i, 33) * 30) * k;
    const freq = 0.4 + seeded(i, 34) * 0.8;
    const phase = seeded(i, 35) * Math.PI * 2;
    const x0 = seeded(i, 36) * W;
    const y = wrap(seeded(i, 37) * span + v * t, span) - 20 * k;
    const x = x0 + Math.sin(t * freq + phase) * amp;
    ctx.beginPath();
    ctx.globalAlpha = 0.45 + seeded(i, 38) * 0.5;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
};

// ── sparks: embers rising from the bottom, brighter when young ──

const drawSparks = (ctx: CanvasRenderingContext2D, W: number, H: number, t: number, d: number) => {
  const k = kOf(W, H), ky = H / 1080;
  const span = H + 20 * k;
  const n = countOf(46, d);
  ctx.globalCompositeOperation = "lighter";
  ctx.lineWidth = 2 * k;
  for (let i = 0; i < n; i++) {
    const x0 = seeded(i, 41) * W;
    const v = (130 + seeded(i, 42) * 220) * ky;
    const wob = (8 + seeded(i, 43) * 18) * k;
    const wobF = 1.5 + seeded(i, 44) * 2;
    const phase = seeded(i, 45) * Math.PI * 2;
    const y = H + 10 * k - wrap(seeded(i, 46) * span + v * t, span);
    const x = x0 + Math.sin(t * wobF + phase) * wob;
    const life = clamp01(y / H); // 1 = just born at the bottom, 0 = burnt out
    const flicker = 0.55 + 0.45 * Math.sin(t * (6 + seeded(i, 47) * 6) + phase * 1.7);
    const len = (6 + seeded(i, 48) * 10) * k;
    const a = Math.max(0, life * 1.2 - 0.2) * flicker;
    if (a <= 0.02) continue;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + len);
    ctx.strokeStyle = `rgba(255,${170 + Math.floor(seeded(i, 49) * 60)},60,${a.toFixed(3)})`;
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
};

// ── fireflies: glowing dots on slow Lissajous wander, pulsing ──

const drawFireflies = (ctx: CanvasRenderingContext2D, W: number, H: number, t: number, d: number) => {
  const k = kOf(W, H);
  const n = countOf(22, d);
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < n; i++) {
    const x0 = seeded(i, 61) * W;
    const y0 = seeded(i, 62) * H;
    const ax = (30 + seeded(i, 63) * 70) * k;
    const ay = (20 + seeded(i, 64) * 50) * k;
    const fx = 0.25 + seeded(i, 65) * 0.5;
    const fy = 0.2 + seeded(i, 66) * 0.45;
    const p1 = seeded(i, 67) * Math.PI * 2;
    const p2 = seeded(i, 68) * Math.PI * 2;
    const x = x0 + Math.sin(t * fx * Math.PI * 2 + p1) * ax;
    const y = y0 + Math.sin(t * fy * Math.PI * 2 + p2) * ay;
    const pulse = 0.5 + 0.5 * Math.sin(t * (0.8 + seeded(i, 69) * 1.4) * Math.PI * 2 + p1 * 1.7);
    const r = (1.4 + seeded(i, 70) * 1.8) * k;
    const a = 0.15 + 0.75 * pulse;
    ctx.beginPath();
    ctx.fillStyle = `rgba(216,242,148,${(a * 0.22).toFixed(3)})`;
    ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = `rgba(233,255,170,${a.toFixed(3)})`;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
};

// ── The vocabulary (order = UI order) ──

export const PARTICLE_FX: ParticleFxDef[] = [
  { id: "confetti", label: "Confeti", icon: "🎉", base: 70, draw: drawConfetti },
  { id: "rain", label: "Lluvia", icon: "☂", base: 110, draw: drawRain },
  { id: "snow", label: "Nieve", icon: "❄", base: 90, draw: drawSnow },
  { id: "sparks", label: "Chispas", icon: "✦", base: 46, draw: drawSparks },
  { id: "fireflies", label: "Luciérnagas", icon: "·", base: 22, draw: drawFireflies },
];

export function particleFxDef(id: string): ParticleFxDef | undefined {
  return PARTICLE_FX.find(p => p.id === id);
}

/** Single entry both renderers call: lookup + clamps + save/restore framing.
 *  Unknown ids and zero density are silent no-ops (schema tolerance). */
export function drawParticleFx(
  ctx: CanvasRenderingContext2D, id: string, W: number, H: number, t: number, density: number,
): void {
  const def = particleFxDef(id);
  if (!def) return;
  const d = clamp01(density);
  if (d <= 0.001 || W <= 0 || H <= 0) return;
  ctx.save();
  def.draw(ctx, W, H, Math.max(0, t), d);
  ctx.restore();
}
