/**
 * captions — ONE source of truth for how a ReelTextClip looks at a given
 * local time. The preview (VideoModeOverlay DOM) and the export (canvas
 * 2D draw in videoExport) both render through these functions, so what
 * you see is what gets muxed. Keep the two visual paths in sync by
 * changing ONLY this file.
 */

import type { ReelTextClip } from "../../lib/videoTimelineDoc";

export interface CaptionAnimState { opacity: number; scale: number; dyPct: number; chars?: number; blurPx?: number }

const IN = 0.3;   // entrance duration (s)
const OUT = 0.25; // exit duration (s)
const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);

/** Entrance/exit animation state at localT seconds into the clip. */
export function captionAnimAt(clip: ReelTextClip, localT: number): CaptionAnimState {
  const state: CaptionAnimState = { opacity: 1, scale: 1, dyPct: 0 };
  const tIn = Math.min(1, Math.max(0, localT / IN));
  const tOut = Math.min(1, Math.max(0, (clip.durationSec - localT) / OUT));
  const p = easeOutCubic(tIn);

  switch (clip.anim) {
    case "fade":
      state.opacity = p;
      break;
    case "pop":
      state.opacity = Math.min(1, tIn * 2);
      state.scale = 0.6 + 0.4 * p + 0.12 * Math.sin(p * Math.PI); // tiny overshoot
      break;
    case "slide-up":
      state.opacity = p;
      state.dyPct = (1 - p) * 8; // % of frame height
      break;
    // ── V5 additions ──
    case "slide-down":
      state.opacity = p;
      state.dyPct = -(1 - p) * 8;
      break;
    case "zoom-in":
      state.opacity = Math.min(1, tIn * 2);
      state.scale = 0.4 + 0.6 * p;
      break;
    case "blur-in":
      state.opacity = p;
      state.blurPx = (1 - p) * 8;
      break;
    case "bounce-in":
      state.opacity = Math.min(1, tIn * 2.5);
      state.scale = 0.6 + 0.4 * p + 0.18 * Math.sin(p * Math.PI); // strong overshoot
      break;
    case "typewriter":
      state.opacity = Math.min(1, tIn * 4);
      state.chars = Math.min(1, localT / Math.max(0.3, clip.durationSec * 0.6));
      break;
    default:
      state.opacity = Math.min(1, tIn * 4);
  }
  state.opacity *= Math.min(1, tOut);
  return state;
}

/** V5: text revealed at localT — typewriter slices by the chars fraction;
 *  every other anim returns the full text. BOTH renderers must draw THIS. */
export function captionTextAt(clip: ReelTextClip, localT: number): string {
  const a = captionAnimAt(clip, localT);
  if (a.chars === undefined) return clip.text;
  return clip.text.slice(0, Math.max(0, Math.round(clip.text.length * a.chars)));
}

/** DOM style for the preview overlay. Frame box = displayed stage size. */
export function captionStyle(clip: ReelTextClip, frameW: number, frameH: number, localT: number): React.CSSProperties {
  const a = captionAnimAt(clip, localT);
  const fontSize = (clip.sizePct / 100) * frameH;
  return {
    position: "absolute",
    left: `${clip.xPct}%`,
    top: `${clip.yPct + a.dyPct}%`,
    transform: `translate(-50%, -50%) scale(${a.scale})`,
    opacity: a.opacity,
    fontSize,
    fontFamily: clip.font,
    fontWeight: clip.weight,
    color: clip.color,
    background: clip.bg || "transparent",
    padding: clip.bg ? "0.25em 0.6em" : 0,
    borderRadius: clip.bg ? "0.3em" : 0,
    lineHeight: 1.25,
    whiteSpace: "pre",
    textAlign: "center",
    filter: a.blurPx ? `blur(${a.blurPx.toFixed(1)}px)` : undefined,
    textShadow: "0 1px 4px rgba(0,0,0,0.45)",
    pointerEvents: "none",
    maxWidth: "96%",
  };
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Canvas draw for the export path — mirrors captionStyle exactly. */
export function drawCaption(ctx: CanvasRenderingContext2D, clip: ReelTextClip, frameW: number, frameH: number, localT: number) {
  const a = captionAnimAt(clip, localT);
  if (a.opacity <= 0.01) return;
  const fontSize = (clip.sizePct / 100) * frameH;
  const cx = (clip.xPct / 100) * frameW;
  const cy = ((clip.yPct + a.dyPct) / 100) * frameH;

  ctx.save();
  if (a.blurPx) ctx.filter = `blur(${a.blurPx.toFixed(1)}px)`;
  ctx.translate(cx, cy);
  ctx.scale(a.scale, a.scale);
  ctx.globalAlpha = a.opacity;
  ctx.font = `${clip.weight} ${fontSize}px ${clip.font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lines = captionTextAt(clip, localT).split("\n");
  if (lines.every(l => l.length === 0)) {
    ctx.restore();
    return;
  }
  const lineH = fontSize * 1.25;
  const widest = Math.max(...lines.map(l => ctx.measureText(l).width));
  const padX = fontSize * 0.6;
  const padY = fontSize * 0.25;

  if (clip.bg) {
    ctx.fillStyle = clip.bg;
    roundRectPath(ctx, -widest / 2 - padX, -((lines.length * lineH) / 2) - padY, widest + padX * 2, lines.length * lineH + padY * 2, fontSize * 0.3);
    ctx.fill();
  }

  ctx.fillStyle = clip.color;
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = fontSize * 0.18;
  ctx.shadowOffsetY = fontSize * 0.05;
  const y0 = -((lines.length - 1) * lineH) / 2;
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], 0, y0 + i * lineH);
  ctx.restore();
}
