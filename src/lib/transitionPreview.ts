/**
 * transitionPreview — the DOM/CSS half of the V5 transition registry. PURE
 * logic: every fn mutates style bags (plain records) that VideoModeOverlay
 * applies to the pooled take wrappers, so this file never touches the DOM
 * directly and vid-qa can import it under plain Node.
 *
 * WYSIWYG contract: same keys and same math as EXPORT_TRANSITIONS
 * (src/lib/videoExport.ts). Both registries consume the SAME resolved params
 * and the SAME shared geometry from the catalog, so preview and export
 * cannot drift. The only documented approximations (glitch slice jitter on
 * live DOM, pixelize via stepped SVG filters, wipe feather via gradient mask)
 * keep the same read at equal progress.
 */

import {
  dirVec, dissolveTiles, pinwheelWedges, seeded, wedgeClipPath, GRAIN_URI,
  type TransitionParams,
} from "../../shared/videoEffectsCatalog.ts";

export interface Rect { x: number; y: number; w: number; h: number }

export interface PreviewTransitionCtx {
  /** Smoothed progress 0..1 — same smoothing as the export. */
  p: number;
  /** Project canvas px (the coordinate space the export draws in). */
  W: number; H: number;
  /** Fully resolved params (defaults filled) from the catalog. */
  pr: TransitionParams;
  /** Output frame index — seeds deterministic jitter (glitch). */
  frameIndex: number;
  bg: string;
  /** Style bags for the outgoing/incoming take wrappers (MUTATED). */
  from: Record<string, string>;
  to: Record<string, string>;
  /** Placed rects of both takes (for canvas-aligned clip shapes). */
  rectFrom: Rect; rectTo: Rect;
  /** Blur channel — composed with the take's look filter (legacy V4 path). */
  blurFrom: number; blurTo: number;
  /** Extra filter terms appended after look+blur (brightness, svg urls). */
  extraFrom?: string; extraTo?: string;
  /** Flash overlay channel (full-canvas colored div). */
  flash: number; flashColor: string;
  /** Cover overlays in project px (tiles/wedges/noise) — rendered into the
   *  fx layer BETWEEN the two takes (to below, covers, from above). */
  tiles: Array<Record<string, string>>;
}

export type PreviewTransitionFn = (c: PreviewTransitionCtx) => void;

/** Pose → CSS (transform/opacity/filter/blend) on a bag. Scale/rotate are
 *  CENTER-origin like the canvas registry's default. */
function pose(bag: Record<string, string>, s: { dx?: number; dy?: number; scale?: number; rot?: number; alpha?: number; filter?: string; blend?: string }): void {
  if (s.alpha !== undefined) bag.opacity = String(Math.min(1, Math.max(0, s.alpha)));
  const tf: string[] = [];
  if (s.dx || s.dy) tf.push(`translateX(${(s.dx ?? 0).toFixed(2)}px)`, `translateY(${(s.dy ?? 0).toFixed(2)}px)`);
  if (s.scale !== undefined && s.scale !== 1) tf.push(`scale(${s.scale.toFixed(4)})`);
  if (s.rot) tf.push(`rotate(${s.rot.toFixed(2)}deg)`);
  if (tf.length) {
    bag.transform = tf.join(" ");
    bag.transformOrigin = "50% 50%";
  }
  if (s.filter) bag.filter = s.filter;
  if (s.blend) bag.mixBlendMode = s.blend as "screen";
}

/** Soft-edge wipe via gradient mask (the canvas side steps 6 alpha strips). */
function wipeMask(dir: string, p: number, softness: number): string {
  const horizontal = dir === "left" || dir === "right";
  const axis = horizontal ? "90deg" : "180deg";
  const lead = p * 100;
  const band = softness * 100;
  const hard = Math.max(0, lead - band);
  const black = "rgba(0,0,0,1)", none = "rgba(0,0,0,0)";
  let stops: string;
  if (dir === "left" || dir === "up") {
    stops = `${black} ${hard.toFixed(2)}%, ${none} ${lead.toFixed(2)}%, ${none} 100%`;
  } else {
    stops = `${none} 0%, ${none} ${(100 - lead).toFixed(2)}%, ${black} ${(100 - hard).toFixed(2)}%, ${black} 100%`;
  }
  const g = `linear-gradient(${axis}, ${stops})`;
  return g;
}

const tileBag = (t: { x: number; y: number; w: number; h: number; alpha: number }, bg: string): Record<string, string> => ({
  position: "absolute",
  left: `${t.x.toFixed(2)}px`,
  top: `${t.y.toFixed(2)}px`,
  width: `${t.w.toFixed(2)}px`,
  height: `${t.h.toFixed(2)}px`,
  background: bg,
  opacity: t.alpha.toFixed(3),
});

const wedgeBags = (c: PreviewTransitionCtx, count: number): Array<Record<string, string>> =>
  pinwheelWedges(count, c.W / 2, c.H / 2, Math.hypot(c.W, c.H) / 2, c.p).map(w => ({
    position: "absolute", inset: "0px",
    clipPath: wedgeClipPath(w.points, c.W, c.H),
    background: c.bg,
    opacity: w.alpha.toFixed(3),
  }));

const num = (pr: TransitionParams, key: string, dflt: number): number => {
  const v = pr[key];
  return typeof v === "number" && Number.isFinite(v) ? v : dflt;
};
const str = (pr: TransitionParams, key: string, dflt: string): string => {
  const v = pr[key];
  return typeof v === "string" && v ? v : dflt;
};

/**
 * THE preview registry — one implementation per catalog transition id. vid-qa
 * asserts these keys === EXPORT keys === TRANSITIONS ids (WYSIWYG contract).
 */
export const PREVIEW_TRANSITIONS: Record<string, PreviewTransitionFn> = {
  fade: c => pose(c.from, { alpha: 1 - c.p }),
  // `to` stays visible with a plain crossfade (pose on `to` sets opacity p).
  slide: c => {
    const d = dirVec(str(c.pr, "dir", "left"));
    pose(c.from, { dx: d.x * c.p * c.W, dy: d.y * c.p * c.H });
    pose(c.to, { dx: -d.x * (1 - c.p) * c.W, dy: -d.y * (1 - c.p) * c.H });
  },
  "slide-up": c => {
    pose(c.from, { dy: -c.p * c.H });
    pose(c.to, { dy: (1 - c.p) * c.H });
  },
  wipe: c => {
    const dir = str(c.pr, "dir", "left");
    const softness = num(c.pr, "softness", 0);
    if (softness < 0.005) {
      // Legacy exact string (dir left = the V4 hardcoded visual).
      const v = (1 - c.p) * 100;
      c.to.clipPath =
        dir === "left" ? `inset(0 ${v.toFixed(3)}% 0 0)`
          : dir === "right" ? `inset(0 0 0 ${v.toFixed(3)}%)`
            : dir === "up" ? `inset(0 0 ${v.toFixed(3)}% 0)`
              : `inset(${v.toFixed(3)}% 0 0 0)`;
    } else {
      const g = wipeMask(dir, c.p, softness);
      c.to.maskImage = g;
      c.to.WebkitMaskImage = g;
    }
  },
  push: c => {
    const d = dirVec(str(c.pr, "dir", "left"));
    pose(c.to, { dx: -d.x * (1 - c.p) * c.W, dy: -d.y * (1 - c.p) * c.H });
    const gw = 34;
    if (d.x !== 0) {
      const ex = d.x < 0 ? (1 - c.p) * c.W : c.W - (1 - c.p) * c.W;
      c.tiles.push({
        position: "absolute", left: `${(d.x < 0 ? ex - gw : ex).toFixed(2)}px`, top: "0px",
        width: `${gw}px`, height: `${c.H}px`,
        background: `linear-gradient(90deg, ${d.x < 0 ? "rgba(0,0,0,0), rgba(0,0,0,0.3)" : "rgba(0,0,0,0.3), rgba(0,0,0,0)"})`,
      });
    } else {
      const ey = d.y < 0 ? (1 - c.p) * c.H : c.H - (1 - c.p) * c.H;
      c.tiles.push({
        position: "absolute", left: "0px", top: `${(d.y < 0 ? ey - gw : ey).toFixed(2)}px`,
        width: `${c.W}px`, height: `${gw}px`,
        background: `linear-gradient(180deg, ${d.y < 0 ? "rgba(0,0,0,0), rgba(0,0,0,0.3)" : "rgba(0,0,0,0.3), rgba(0,0,0,0)"})`,
      });
    }
  },
  "fade-black": c => {
    if (c.p < 0.5) pose(c.from, { alpha: 1 - 2 * c.p });
    else pose(c.to, { alpha: 2 * c.p - 1 });
  },
  tint: c => {
    pose(c.to, { alpha: c.p });
    const f = Math.sin(c.p * Math.PI);
    if (f > 0.01) {
      c.tiles.push({ position: "absolute", inset: "0px", background: str(c.pr, "color", "#e0b57a"), opacity: (0.35 * f).toFixed(3) });
    }
  },
  zoom: c => {
    const k = num(c.pr, "strength", 0.25);
    pose(c.from, { scale: 1 + k * c.p, alpha: 1 - c.p });
    pose(c.to, { scale: 1 + k * (1 - c.p), alpha: c.p });
  },
  "zoom-out": c => {
    const k = num(c.pr, "strength", 0.4);
    c.from.zIndex = "2";
    pose(c.from, { scale: 1 + k * c.p, alpha: 1 - c.p });
  },
  pan: c => {
    const d = dirVec(str(c.pr, "dir", "left"));
    pose(c.from, { dx: d.x * c.p * 0.35 * c.W, dy: d.y * c.p * 0.35 * c.H, alpha: 1 - c.p });
    pose(c.to, { dx: -d.x * (1 - c.p) * 0.35 * c.W, dy: -d.y * (1 - c.p) * 0.35 * c.H, alpha: c.p });
  },
  spin: c => {
    const deg = num(c.pr, "degrees", 180);
    pose(c.from, { scale: 1 - 0.3 * c.p, rot: deg * c.p, alpha: 1 - c.p });
    pose(c.to, { scale: 0.7 + 0.3 * c.p, rot: -deg * (1 - c.p), alpha: c.p });
  },
  "whip-pan": c => {
    const d = dirVec(str(c.pr, "dir", "left"));
    c.blurFrom = 24 * Math.sin(c.p * Math.PI);
    c.blurTo = c.blurFrom;
    pose(c.from, { dx: d.x * c.p * c.W, dy: d.y * c.p * c.H });
    pose(c.to, { dx: -d.x * (1 - c.p) * c.W, dy: -d.y * (1 - c.p) * c.H });
  },
  "simple-zoom": c => {
    const k = num(c.pr, "strength", 1.5);
    pose(c.to, { scale: k - (k - 1) * c.p, alpha: c.p });
  },
  "cross-zoom": c => {
    const k = num(c.pr, "strength", 0.35);
    pose(c.from, { scale: 1 + k * c.p, alpha: 1 - c.p });
    pose(c.to, { scale: 1 - k + k * c.p, alpha: c.p });
  },
  blur: c => {
    const k = num(c.pr, "strength", 1);
    c.blurFrom = c.p * 14 * k;
    c.blurTo = (1 - c.p) * 14 * k;
    pose(c.to, { alpha: c.p });
  },
  "linear-blur": c => {
    const d = dirVec(str(c.pr, "dir", "left"));
    c.blurFrom = 16 * Math.sin(c.p * Math.PI);
    c.blurTo = c.blurFrom;
    pose(c.from, { dx: d.x * c.p * 0.25 * c.W, dy: d.y * c.p * 0.25 * c.H, alpha: 1 - 0.5 * c.p });
    pose(c.to, { dx: -d.x * (1 - c.p) * 0.25 * c.W, dy: -d.y * (1 - c.p) * 0.25 * c.H, alpha: 0.5 + 0.5 * c.p });
  },
  pixelize: c => {
    const k = num(c.pr, "strength", 1);
    const s = Math.sin(c.p * Math.PI) * k;
    if (s > 0.04) {
      const idx = s > 1.2 ? 3 : s > 0.7 ? 2 : s > 0.3 ? 1 : 0;
      c.extraFrom = `url(#vpix-${idx})`;
      c.extraTo = c.extraFrom;
    }
    pose(c.from, { alpha: 1 - c.p });
    pose(c.to, { alpha: c.p });
  },
  "mosaic-grid": c => {
    c.tiles.push(...dissolveTiles("grid", num(c.pr, "count", 5), c.W, c.H, c.p).map(t => tileBag(t, c.bg)));
    c.from.zIndex = "2";
    pose(c.from, { alpha: 1 - c.p });
  },
  "gaussian-dissolve": c => {
    const k = num(c.pr, "strength", 1);
    c.blurFrom = 10 * k * c.p;
    c.blurTo = 10 * k * (1 - c.p);
    pose(c.from, { alpha: 1 - c.p });
    pose(c.to, { alpha: c.p });
  },
  flash: c => {
    pose(c.to, { alpha: c.p });
    c.flash = Math.sin(c.p * Math.PI);
    c.flashColor = str(c.pr, "color", "#ffffff");
  },
  "luma-burn": c => {
    c.extraFrom = `brightness(${(1 + 7 * c.p).toFixed(2)})`;
    c.extraTo = `brightness(${(1 + 7 * (1 - c.p)).toFixed(2)})`;
    pose(c.to, { alpha: c.p });
  },
  "leak-sweep": c => {
    const col = str(c.pr, "color", "#ffb36b");
    pose(c.to, { alpha: c.p });
    const f = Math.sin(c.p * Math.PI);
    if (f > 0.01) {
      const bw = c.W * 0.6;
      const x0 = (c.p * 1.6 - 0.3) * c.W;
      c.tiles.push({
        position: "absolute", left: `${x0.toFixed(2)}px`, top: "0px",
        width: `${bw.toFixed(2)}px`, height: `${c.H}px`,
        background: `linear-gradient(90deg, rgba(0,0,0,0), ${col}, rgba(0,0,0,0))`,
        opacity: f.toFixed(3), mixBlendMode: "screen",
      });
    }
  },
  "exposure-cut": c => {
    if (c.p >= 0.5) {
      const spike = Math.max(0, 1 - Math.abs(2 * c.p - 1) * 4);
      if (spike > 0.02) c.extraTo = `brightness(${(1 + 2 * spike).toFixed(2)})`;
    }
  },
  "glow-blend": c => {
    pose(c.to, { alpha: Math.min(0.85, c.p), blend: "screen" });
    if (c.p > 0.5) pose(c.to, { alpha: (c.p - 0.5) / 0.5 });
  },
  "circle-open": c => {
    const maxR = Math.hypot(c.W, c.H) / 2;
    const cx = c.W / 2 - c.rectTo.x;
    const cy = c.H / 2 - c.rectTo.y;
    if (str(c.pr, "mode", "in") === "out") {
      c.to.clipPath = `circle(${(maxR * (1 - c.p)).toFixed(2)}px at ${cx.toFixed(2)}px ${cy.toFixed(2)}px)`;
    } else {
      c.to.clipPath = `circle(${(maxR * c.p).toFixed(2)}px at ${cx.toFixed(2)}px ${cy.toFixed(2)}px)`;
    }
  },
  "diamond-open": c => {
    const d = Math.max(c.W, c.H) * 0.75 * c.p;
    const cx = c.W / 2 - c.rectTo.x;
    const cy = c.H / 2 - c.rectTo.y;
    c.to.clipPath = `polygon(${(cx).toFixed(2)}px ${(cy - d).toFixed(2)}px, ${(cx + d).toFixed(2)}px ${(cy).toFixed(2)}px, ${(cx).toFixed(2)}px ${(cy + d).toFixed(2)}px, ${(cx - d).toFixed(2)}px ${(cy).toFixed(2)}px)`;
  },
  blinds: c => {
    c.tiles.push(...dissolveTiles("columns", num(c.pr, "count", 5), c.W, c.H, c.p).map(t => tileBag(t, c.bg)));
    c.from.zIndex = "2";
    pose(c.from, { alpha: 1 - c.p });
  },
  checker: c => {
    c.tiles.push(...dissolveTiles("checker", num(c.pr, "count", 4), c.W, c.H, c.p).map(t => tileBag(t, c.bg)));
    c.from.zIndex = "2";
    pose(c.from, { alpha: 1 - c.p });
  },
  "bars-horizontal": c => {
    c.tiles.push(...dissolveTiles("rows", num(c.pr, "count", 3), c.W, c.H, c.p).map(t => tileBag(t, c.bg)));
    c.from.zIndex = "2";
    pose(c.from, { alpha: 1 - c.p });
  },
  "square-crop": c => {
    const s = Math.max(c.W, c.H) * 1.15 * c.p;
    const l = c.W / 2 - s / 2 - c.rectTo.x;
    const t = c.H / 2 - s / 2 - c.rectTo.y;
    const r = c.rectTo.w - (l + s);
    const b = c.rectTo.h - (t + s);
    c.to.clipPath = `inset(${t.toFixed(2)}px ${r.toFixed(2)}px ${b.toFixed(2)}px ${l.toFixed(2)}px)`;
  },
  pinwheel: c => {
    c.tiles.push(...wedgeBags(c, num(c.pr, "count", 6)));
    c.from.zIndex = "2";
    pose(c.from, { alpha: 1 - c.p });
  },
  glitch: c => {
    const k = num(c.pr, "strength", 1);
    const amp = 26 * k * Math.sin(c.p * Math.PI);
    const sh = Math.floor(c.frameIndex * 1.7);
    pose(c.from, { alpha: 1 - c.p * 0.4 });
    // DOM can't slice live content — global jitter + seeded cover bars echo
    // the export's true slice displacement at the same progress.
    pose(c.to, { dx: (seeded(3, sh) * 2 - 1) * amp });
    for (const i of [2, 5]) {
      const y = c.H * seeded(i, sh + 9);
      c.tiles.push({
        position: "absolute", left: "0px", top: `${y.toFixed(2)}px`,
        width: `${c.W}px`, height: `${(3 + 6 * seeded(i, sh + 3)).toFixed(2)}px`,
        background: c.bg, opacity: (0.55 * Math.sin(c.p * Math.PI)).toFixed(3),
      });
    }
  },
  echo: c => {
    const k = num(c.pr, "strength", 1);
    const off = 18 * k * Math.sin(c.p * Math.PI);
    pose(c.to, { alpha: c.p });
    if (off > 0.5) {
      const idx = off > 18 ? 2 : off > 9 ? 1 : 0;
      c.extraTo = `url(#vecho-${idx})`;
    }
  },
  "static-fade": c => {
    pose(c.to, { alpha: c.p });
    const f = Math.sin(c.p * Math.PI);
    if (f > 0.01) {
      c.tiles.push({
        position: "absolute", inset: "0px",
        backgroundImage: `url("${GRAIN_URI}")`,
        backgroundSize: "160px 160px",
        backgroundPosition: `${(c.frameIndex * 53) % 160}px ${(c.frameIndex * 97) % 160}px`,
        opacity: (0.9 * f).toFixed(3),
      });
    }
  },
  swap: c => {
    const d = dirVec(str(c.pr, "dir", "up"));
    pose(c.from, { dx: d.x * c.p * 0.8 * c.W, dy: d.y * c.p * 0.8 * c.H, alpha: 1 - c.p });
    pose(c.to, { dx: -d.x * (1 - c.p) * 0.8 * c.W, dy: -d.y * (1 - c.p) * 0.8 * c.H, alpha: Math.min(1, c.p * 1.5) });
  },
};
