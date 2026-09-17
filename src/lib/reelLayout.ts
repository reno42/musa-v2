/**
 * reelLayout — V4.0 per-take framing math (pure, shared by the preview and
 * the export so they can never diverge).
 *
 * A take is CONTAIN-fit onto the project canvas (black letterbox when the
 * aspects differ — the pre-V4 "iguala los aspect ratios" hard error) and can
 * then be re-framed by the user: `scale` multiplies the contain fit and
 * xPct/yPct pan the take by a % of the canvas size (0,0 = centered).
 */

import type { ReelProjectSettings } from "./videoTimelineDoc";

/** Per-take framing override — lives on FrameData.reelLayout. */
export interface ReelTakeLayout {
  /** 1 = contain fit; >1 crops into the take, <1 shrinks it. */
  scale: number;
  /** Pan offset as % of the project canvas (0 = centered). */
  xPct: number;
  yPct: number;
}

export const DEFAULT_TAKE_LAYOUT: ReelTakeLayout = { scale: 1, xPct: 0, yPct: 0 };

export function normalizeTakeLayout(raw: unknown): ReelTakeLayout {
  const l = (raw || {}) as Partial<ReelTakeLayout>;
  const num = (v: unknown, fb: number) => (typeof v === "number" && Number.isFinite(v) ? v : fb);
  return {
    scale: Math.min(8, Math.max(0.05, num(l.scale, 1))),
    xPct: Math.min(200, Math.max(-200, num(l.xPct, 0))),
    yPct: Math.min(200, Math.max(-200, num(l.yPct, 0))),
  };
}

export interface PlacedRect {
  /** Project-canvas px of the take's top-left corner. */
  left: number;
  top: number;
  /** On-screen size in project-canvas px (frame size × k). */
  width: number;
  height: number;
  /** Total scale applied to the frame's native pixels. */
  k: number;
}

/** Contain-fit + user re-frame of one take onto the project canvas. */
export function placeTake(
  project: Pick<ReelProjectSettings, "width" | "height">,
  frame: { width: number; height: number },
  layout?: ReelTakeLayout | null,
): PlacedRect {
  const l = normalizeTakeLayout(layout);
  const sBase = Math.min(project.width / Math.max(1, frame.width), project.height / Math.max(1, frame.height));
  const k = sBase * l.scale;
  const w = frame.width * k;
  const h = frame.height * k;
  const cx = project.width / 2 + (l.xPct / 100) * project.width;
  const cy = project.height / 2 + (l.yPct / 100) * project.height;
  return { left: cx - w / 2, top: cy - h / 2, width: w, height: h, k };
}

/** The layout scale that makes a take COVER the canvas (no letterbox). */
export function coverScale(project: Pick<ReelProjectSettings, "width" | "height">, frame: { width: number; height: number }): number {
  const sContain = Math.min(project.width / Math.max(1, frame.width), project.height / Math.max(1, frame.height));
  const sCover = Math.max(project.width / Math.max(1, frame.width), project.height / Math.max(1, frame.height));
  return sContain <= 0 ? 1 : sCover / sContain;
}

/** True when the take's aspect differs enough from the project to letterbox. */
export function aspectMismatch(project: Pick<ReelProjectSettings, "width" | "height">, frame: { width: number; height: number }): boolean {
  const a = project.width / Math.max(1, project.height);
  const b = frame.width / Math.max(1, frame.height);
  return Math.abs(a - b) / Math.max(a, b) > 0.02;
}
