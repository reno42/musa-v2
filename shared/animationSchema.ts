/**
 * Animation schema — the ONE source of truth for design animation
 * (docs/ANIMATION_VIDEO_EXPORT_SPEC.md).
 *
 * A frame's `animation` is a declarative JSON document (timeline + clips +
 * tweens + transitions). Two consumers compile from it and can never diverge:
 *
 * - PREVIEW: compileTween() → Web Animations API keyframes, driven live by
 *   src/lib/animationEngine.ts inside the frame's Shadow DOM.
 * - EXPORT: sampleAnimationAt() → the same interpolation math, evaluated at
 *   exact frame times and rasterized through the same SVG foreignObject
 *   pipeline used by every PNG export (WYSIWYG by construction).
 *
 * Pure functions in, values out — no DOM, no I/O (shared/README.md), so the
 * editor bundle, the MCP function and the QA suite all run the same code.
 */

// ── Model ────────────────────────────────────────────────────────

export type LoopMode = "once" | "loop" | "pingpong";

/** Animatable CSS surfaces. `transform`/`filter` cover translate/scale/
 * rotate/blur/etc. through their function syntax; box and color props are
 * first-class because presets lean on them. */
export const ANIMATION_PROPS: readonly string[] = [
  "transform",
  "opacity",
  "filter",
  "color",
  "backgroundColor",
  "backgroundPosition",
  "clipPath",
  "width",
  "height",
  "top",
  "left",
] as const;

export type AnimationProp = (typeof ANIMATION_PROPS)[number];

/** CSS property name the editor actually writes for each animatable prop
 * (camelCase from the schema → kebab-case for style application). */
export function cssPropertyOf(prop: string): string {
  if (prop === "clipPath") return "clip-path";
  if (prop === "backgroundColor") return "background-color";
  if (prop === "backgroundPosition") return "background-position";
  return prop;
}

export interface TimelineConfig {
  durationSec: number;
  fps: number;
  /** Reserved for export sizing; the editor always exports at frame size. */
  width: number;
  height: number;
  loop: LoopMode;
}

/** One animatable property over one layer, inside the clip's time window.
 * Keyframe `t` is normalized 0..1 WITHIN the clip (0 = clip start, 1 = clip
 * end); `value` is the full CSS value for the prop at that moment. */
export interface Keyframe {
  t: number;
  value: string;
}

export interface Tween {
  prop: AnimationProp | string;
  keyframes: Keyframe[];
  /** Any CSS easing: named, cubic-bezier(...) or spring(damping,stiffness)
   * (approximated to a bezier — WAAPI has no native spring). */
  easing: string;
}

export interface Clip {
  layerId: string;
  startSec: number;
  endSec: number;
  tweens: Tween[];
}

export type TransitionType = "fade" | "slide" | "zoom" | "wipe";

/** An outgoing transition: how THIS frame hands over to the next one in the
 * exported video. Lives on the from-frame's animation (see spec §4). */
export interface FrameTransition {
  toFrameId: string;
  type: TransitionType;
  durationSec: number;
}

export interface AnimationSchema {
  timeline: TimelineConfig;
  clips: Clip[];
  transitions: FrameTransition[];
}

// ── Easings ──────────────────────────────────────────────────────

export interface EasingPreset {
  id: string;
  label: string;
  /** The CSS/WAAPI easing string this preset maps to. */
  value: string;
}

export const EASING_PRESETS: readonly EasingPreset[] = [
  { id: "linear", label: "Linear", value: "linear" },
  { id: "ease", label: "Ease", value: "ease" },
  { id: "ease-in", label: "Ease in", value: "ease-in" },
  { id: "ease-out", label: "Ease out", value: "ease-out" },
  { id: "ease-in-out", label: "Ease in-out", value: "ease-in-out" },
  { id: "ease-out-quad", label: "Ease out quad", value: "cubic-bezier(0.25, 1, 0.5, 1)" },
  { id: "ease-out-back", label: "Ease out back", value: "cubic-bezier(0.34, 1.56, 0.64, 1)" },
  { id: "ease-out-expo", label: "Ease out expo", value: "cubic-bezier(0.19, 1, 0.22, 1)" },
  { id: "spring-soft", label: "Spring suave", value: "cubic-bezier(0.35, 1.4, 0.45, 1)" },
  { id: "spring-snappy", label: "Spring seca", value: "cubic-bezier(0.3, 1.6, 0.4, 1)" },
];

/** `spring(damping, stiffness)` → a cubic-bezier approximation. WAAPI cannot
 * integrate a real spring, so we map the damping feel onto overshoot: heavier
 * damping → no overshoot, light damping → up to ~20% overshoot. The x control
 * points stay inside [0,1] (required); only y may exceed 1 (the overshoot). */
export function normalizeEasing(easing: string | undefined | null): string {
  const raw = (easing || "ease").trim();
  const spring = /^spring\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/.exec(raw);
  if (spring) {
    const damping = Math.min(1, Math.max(0, Number(spring[1])));
    const stiffness = Math.min(1, Math.max(0, Number(spring[2])));
    const overshoot = (1 - damping) * 0.2;
    const speed = 0.2 + stiffness * 0.15;
    return `cubic-bezier(${(0.3 + speed / 2).toFixed(3)}, ${(1 + overshoot).toFixed(3)}, ${(0.55 - speed / 2).toFixed(3)}, 1)`;
  }
  if (
    raw === "linear" || raw === "ease" || raw === "ease-in" || raw === "ease-out" || raw === "ease-in-out" ||
    /^cubic-bezier\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\)$/.test(raw)
  ) return raw;
  return "ease";
}

/** Named → bezier params; bezier passes through. Returns null for linear. */
export function bezierOf(easing: string): [number, number, number, number] | null {
  const e = normalizeEasing(easing);
  if (e === "linear") return null;
  if (e === "ease") return [0.25, 0.1, 0.25, 1];
  if (e === "ease-in") return [0.42, 0, 1, 1];
  if (e === "ease-out") return [0, 0, 0.58, 1];
  if (e === "ease-in-out") return [0.42, 0, 0.58, 1];
  const m = /^cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/.exec(e);
  if (!m) return [0.25, 0.1, 0.25, 1];
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}

/** Evaluate a CSS cubic-bezier at progress x ∈ [0,1] → eased y. Newton-Raphson
 * with a bisection fallback — the same algorithm browsers implement for
 * cubic-bezier(), so the export sampler matches the WAAPI preview. */
export function evalBezier(bezier: [number, number, number, number] | null, x: number): number {
  if (!bezier) return x;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const [x1, y1, x2, y2] = bezier;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = sampleX(t) - x;
    if (Math.abs(err) < 1e-6) return sampleY(t);
    const d = sampleDX(t);
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  let lo = 0, hi = 1;
  t = x;
  for (let i = 0; i < 24; i++) {
    const err = sampleX(t) - x;
    if (Math.abs(err) < 1e-6) break;
    if (err > 0) hi = t; else lo = t;
    t = (lo + hi) / 2;
  }
  return sampleY(t);
}

// ── Value interpolation ──────────────────────────────────────────

const NUMBER_TOKEN_RE = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;

/** Interpolate two CSS values: every number token morphs (units/colors ride
 * along), everything else must match structurally. Values with mismatched
 * token structure fall back to a discrete step (previous keyframe before
 * mid-progress, next after) — browsers do the same for non-interpolable
 * pairs, and it keeps presets + custom values always renderable. */
export function interpolateValue(a: string, b: string, p: number): string {
  const an = a.match(NUMBER_TOKEN_RE);
  const bn = b.match(NUMBER_TOKEN_RE);
  if (!an || !bn || an.length !== bn.length) return p < 0.5 ? a : b;
  let out = "";
  let ai = 0, bi = 0, pos = 0;
  NUMBER_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUMBER_TOKEN_RE.exec(a)) !== null) {
    out += a.slice(pos, m.index);
    const av = Number(an[ai++]);
    const bv = Number(bn[bi++]);
    out += String(av + (bv - av) * p);
    pos = m.index + m[0].length;
  }
  out += a.slice(pos);
  return out;
}

// ── Sampling (export + scrub math) ───────────────────────────────

export type LayerSample = Record<string, string>;

/** Evaluate every tween of every clip at timeline time `tSec` → the inline
 * style payload per layer. `fill: both` semantics: before a clip starts its
 * first keyframe holds, after it ends its last keyframe holds. */
export function sampleAnimationAt(schema: AnimationSchema, tSec: number): Map<string, LayerSample> {
  const out = new Map<string, LayerSample>();
  for (const clip of schema.clips) {
    const duration = Math.max(0.0001, clip.endSec - clip.startSec);
    const local = Math.min(1, Math.max(0, (tSec - clip.startSec) / duration));
    const sample = out.get(clip.layerId) || {};
    for (const tween of clip.tweens) {
      sample[tween.prop] = sampleTween(tween, local);
    }
    out.set(clip.layerId, sample);
  }
  return out;
}

function sampleTween(tween: Tween, local: number): string {
  const frames = tween.keyframes;
  if (frames.length === 0) return "";
  if (frames.length === 1 || local <= frames[0].t) return frames[0].value;
  if (local >= frames[frames.length - 1].t) return frames[frames.length - 1].value;
  let i = 0;
  while (i < frames.length - 1 && local > frames[i + 1].t) i++;
  const a = frames[i];
  const b = frames[i + 1];
  const span = b.t - a.t;
  const raw = span <= 0 ? 1 : (local - a.t) / span;
  const eased = evalBezier(bezierOf(tween.easing), raw);
  return interpolateValue(a.value, b.value, eased);
}

// ── Presets ──────────────────────────────────────────────────────

export interface AnimationPreset {
  id: string;
  label: string;
  /** Tweens the preset contributes, with placeholder-free concrete values.
   * Distances are relative units the UI can rescale; they animate from the
   * layer's CURRENT styled state to the preset's end state. */
  tweens: Tween[];
}

/** Start values: neutral identity values per prop. A preset tween always
 * begins from the identity so it composes with the layer's existing CSS. */
const IDENTITY: Record<string, string> = {
  transform: "translateX(0px) translateY(0px) scale(1) rotate(0deg)",
  opacity: "1",
  filter: "blur(0px) brightness(1)",
};

export const ANIMATION_PRESETS: readonly AnimationPreset[] = [
  {
    id: "fade-in",
    label: "Fade in",
    tweens: [{ prop: "opacity", easing: "ease-out", keyframes: [{ t: 0, value: "0" }, { t: 1, value: "1" }] }],
  },
  {
    id: "fade-out",
    label: "Fade out",
    tweens: [{ prop: "opacity", easing: "ease-in", keyframes: [{ t: 0, value: "1" }, { t: 1, value: "0" }] }],
  },
  {
    id: "slide-in",
    label: "Slide in",
    tweens: [{
      prop: "transform",
      easing: "ease-out-expo",
      keyframes: [{ t: 0, value: "translateX(-60px) translateY(0px) scale(1) rotate(0deg)" }, { t: 1, value: IDENTITY.transform }],
    }],
  },
  {
    id: "slide-in-up",
    label: "Slide in ↑",
    tweens: [{
      prop: "transform",
      easing: "ease-out-expo",
      keyframes: [{ t: 0, value: "translateX(0px) translateY(60px) scale(1) rotate(0deg)" }, { t: 1, value: IDENTITY.transform }],
    }],
  },
  {
    id: "zoom-in",
    label: "Zoom in",
    tweens: [{
      prop: "transform",
      easing: "ease-out-back",
      keyframes: [{ t: 0, value: "translateX(0px) translateY(0px) scale(0.6) rotate(0deg)" }, { t: 1, value: IDENTITY.transform }],
    }],
  },
  {
    id: "blur-in",
    label: "Blur in",
    tweens: [
      { prop: "opacity", easing: "ease-out", keyframes: [{ t: 0, value: "0" }, { t: 1, value: "1" }] },
      { prop: "filter", easing: "ease-out", keyframes: [{ t: 0, value: "blur(12px) brightness(1)" }, { t: 1, value: IDENTITY.filter }] },
    ],
  },
  {
    id: "rotate",
    label: "Rotate in",
    tweens: [{
      prop: "transform",
      easing: "ease-out-back",
      keyframes: [{ t: 0, value: "translateX(0px) translateY(0px) scale(0.8) rotate(-45deg)" }, { t: 1, value: IDENTITY.transform }],
    }],
  },
  {
    id: "pop",
    label: "Pop / bounce",
    tweens: [{
      prop: "transform",
      easing: "spring-soft",
      keyframes: [
        { t: 0, value: "translateX(0px) translateY(0px) scale(0.3) rotate(0deg)" },
        { t: 1, value: IDENTITY.transform },
      ],
    }],
  },
  {
    id: "float",
    label: "Float (loop)",
    tweens: [{
      prop: "transform",
      easing: "ease-in-out",
      keyframes: [
        { t: 0, value: IDENTITY.transform },
        { t: 0.5, value: "translateX(0px) translateY(-14px) scale(1) rotate(0deg)" },
        { t: 1, value: IDENTITY.transform },
      ],
    }],
  },
  {
    id: "typewriter",
    label: "Typewriter",
    tweens: [{
      prop: "clipPath",
      easing: "linear",
      keyframes: [{ t: 0, value: "inset(0 100% 0 0)" }, { t: 1, value: "inset(0 0% 0 0)" }],
    }],
  },
];

export function findPreset(id: string): AnimationPreset | undefined {
  return ANIMATION_PRESETS.find(p => p.id === id);
}

/** Apply a preset to a layer: replaces the layer's clip (keeping its window
 * if it already had one), leaving every other clip untouched. */
export function applyPresetToSchema(
  schema: AnimationSchema | null | undefined,
  layerId: string,
  presetId: string,
  windowSec?: { startSec: number; endSec: number },
): AnimationSchema {
  const preset = findPreset(presetId);
  if (!preset) throw new Error(`Unknown animation preset: ${presetId}`);
  const base = schema || defaultAnimation();
  const existing = base.clips.find(c => c.layerId === layerId);
  const startSec = windowSec?.startSec ?? existing?.startSec ?? 0;
  const endSec = windowSec?.endSec ?? existing?.endSec ?? Math.min(startSec + 1.2, Math.max(startSec + 0.2, base.timeline.durationSec));
  const clip: Clip = {
    layerId,
    startSec: Math.min(startSec, endSec - 0.1),
    endSec,
    tweens: preset.tweens.map(t => ({ ...t, keyframes: t.keyframes.map(k => ({ ...k })) })),
  };
  return {
    ...base,
    clips: [...base.clips.filter(c => c.layerId !== layerId), clip],
  };
}

// ── Normalization (every write path runs this: editor, MCP, undo) ──

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Sanitize arbitrary JSON (MCP input, stale documents) into a valid schema
 * or null when there is nothing animation-shaped in it. Never throws. */
export function normalizeAnimation(raw: unknown): AnimationSchema | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Partial<AnimationSchema> & Record<string, unknown>;
  const timelineRaw = (input.timeline || {}) as Record<string, unknown>;

  const clips: Clip[] = [];
  for (const clipRaw of Array.isArray(input.clips) ? input.clips : []) {
    if (!clipRaw || typeof clipRaw !== "object") continue;
    const c = clipRaw as unknown as Record<string, unknown>;
    const layerId = str(c.layerId);
    if (!layerId) continue;
    const startSec = num(c.startSec, 0, 0, 600);
    const endSec = num(c.endSec, startSec + 1, startSec + 0.05, 600);

    const propSeen = new Set<string>();
    const tweens: Tween[] = [];
    for (const tweenRaw of Array.isArray(c.tweens) ? c.tweens : []) {
      if (!tweenRaw || typeof tweenRaw !== "object") continue;
      const tw = tweenRaw as Record<string, unknown>;
      const prop = str(tw.prop);
      if (!prop || propSeen.has(prop)) continue; // one tween per prop per clip
      const framesRaw = Array.isArray(tw.keyframes) ? tw.keyframes : [];
      const keyframes: Keyframe[] = [];
      for (const kRaw of framesRaw) {
        if (!kRaw || typeof kRaw !== "object") continue;
        const k = kRaw as Record<string, unknown>;
        const value = str(k.value);
        if (value === null) continue;
        keyframes.push({ t: num(k.t, 0, 0, 1), value });
      }
      if (keyframes.length === 0) continue;
      keyframes.sort((a, b) => a.t - b.t);
      // Clamp the sorted window to [0,1] with the outer keyframes pinned.
      if (keyframes.length === 1) keyframes.push({ ...keyframes[0], t: 1 });
      keyframes[0] = { ...keyframes[0], t: 0 };
      keyframes[keyframes.length - 1] = { ...keyframes[keyframes.length - 1], t: 1 };
      propSeen.add(prop);
      tweens.push({ prop, keyframes, easing: normalizeEasing(typeof tw.easing === "string" ? tw.easing : "ease") });
    }
    if (tweens.length === 0) continue;
    clips.push({ layerId, startSec, endSec: Math.max(endSec, startSec + 0.05), tweens });
  }

  const transitions: FrameTransition[] = [];
  for (const tRaw of Array.isArray(input.transitions) ? input.transitions : []) {
    if (!tRaw || typeof tRaw !== "object") continue;
    const t = tRaw as unknown as Record<string, unknown>;
    const toFrameId = str(t.toFrameId);
    const type = t.type === "slide" || t.type === "zoom" || t.type === "wipe" ? t.type : "fade";
    if (!toFrameId) continue;
    transitions.push({ toFrameId, type, durationSec: num(t.durationSec, 0.6, 0.1, 5) });
  }

  return {
    timeline: {
      durationSec: num(timelineRaw.durationSec, 5, 0.2, 600),
      fps: num(timelineRaw.fps, 30, 1, 60),
      width: num(timelineRaw.width, 1080, 16, 10000),
      height: num(timelineRaw.height, 1080, 16, 10000),
      loop: timelineRaw.loop === "loop" || timelineRaw.loop === "pingpong" ? timelineRaw.loop : "once",
    },
    clips,
    transitions,
  };
}

export function defaultAnimation(width = 1080, height = 1080): AnimationSchema {
  return {
    timeline: { durationSec: 5, fps: 30, width, height, loop: "once" },
    clips: [],
    transitions: [],
  };
}

// ── WAAPI compilation (preview) ─────────────────────────────────

export interface CompiledTween {
  layerId: string;
  delayMs: number;
  durationMs: number;
  /** camelCase prop → WAAPI keyframes list. Offsets are 0..1 within the clip
   * window; the driver adds fill:"both" so the identity holds outside it. */
  keyframes: Array<Record<string, string | number>>;
}

/** Compile one clip's tweens into standalone WAAPI animations (one per tween,
 * so per-property easings survive — WAAPI keyframe easing applies per
 * keyframe, not per property). */
export function compileClip(clip: Clip): CompiledTween[] {
  const durationMs = Math.max(50, (clip.endSec - clip.startSec) * 1000);
  return clip.tweens.map(tween => {
    const keyframes = tween.keyframes.map(k => ({
      offset: Math.min(1, Math.max(0, k.t)),
      [tween.prop]: k.value,
      ...(k.t < 1 ? { easing: normalizeEasing(tween.easing) } : {}),
    }));
    return {
      layerId: clip.layerId,
      delayMs: clip.startSec * 1000,
      durationMs,
      keyframes,
    };
  });
}

export function compileAnimation(schema: AnimationSchema): CompiledTween[] {
  return schema.clips.flatMap(compileClip);
}

/** Summary for UI + MCP responses. */
export function animationStats(schema: AnimationSchema | null | undefined): {
  hasAnimation: boolean; clips: number; layers: string[]; transitions: number; durationSec: number; loop: LoopMode; fps: number;
} {
  if (!schema || schema.clips.length === 0) {
    return { hasAnimation: false, clips: 0, layers: [], transitions: schema?.transitions.length || 0, durationSec: 0, loop: "once", fps: 30 };
  }
  return {
    hasAnimation: true,
    clips: schema.clips.length,
    layers: schema.clips.map(c => c.layerId),
    transitions: schema.transitions.length,
    durationSec: schema.timeline.durationSec,
    loop: schema.timeline.loop,
    fps: schema.timeline.fps,
  };
}
