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

// V5: transition vocabulary + param sanitation live in the effects catalog
// (the single source of truth shared with the UI and both renderers).
import { TRANSITIONS, sanitizeTransitionParams, type TransitionId, type TransitionParams } from "./videoEffectsCatalog.ts";
import { composeTransform, isCanonicalTransform, parseTransform, quadAt, type XY } from "./transformValue.ts";

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
  /** REQ036 P2.2: control point for the segment that STARTS at this keyframe,
   *  in the SAME translate space as `value` (layer-local px). Present → that
   *  segment is a quadratic Bézier (spatial path bend) instead of a straight
   *  line. Only honored on transform tweens with canonical values. */
  ctrl?: { x: number; y: number };
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
  /** V4.1 anchor point override (CSS transform-origin, e.g. "50% 30%").
   *  Static per clip — applied by every renderer that applies the tweens. */
  origin?: string;
  /** REQ037 P2.3: preset instance ownership — clips carrying this id are
   *  REGENERATED when the instance's params change and stripped on
   *  "convert to keyframes". Absent = hand-authored clip. */
  instanceId?: string;
}

/** V5 transition vocabulary — DERIVED from the catalog (shared/
 *  videoEffectsCatalog.ts), the single source of truth. Every id MUST have
 *  an implementation in BOTH renderers (src/lib/transitionPreview.ts +
 *  videoExport.EXPORT_TRANSITIONS); vid-qa enforces the parity and the
 *  derived union makes an unhandled id a compile error in exhaustive use. */
export type TransitionType = TransitionId;

/** An outgoing transition: how THIS frame hands over to the next one in the
 * exported video. Lives on the from-frame's animation (see spec §4). */
export interface FrameTransition {
  toFrameId: string;
  type: TransitionType;
  durationSec: number;
  /** V5: user-set params (already clamped by normalizeAnimation). Renderers
   *  resolve defaults through resolveTransitionParams(). */
  params?: TransitionParams;
}

/** REQ037 P2.3 — a non-destructive preset application: the authoring params
 *  stay live, so re-applying regenerates exactly the clips this instance
 *  owns (same layer), and "convert to keyframes" bakes them into plain
 *  clips. One active instance per layer·presetId. */
export interface PresetInstance {
  id: string;
  presetId: string;
  layerId: string;
  /** UI params as authored (primitives only — the preset's build fn owns
   *  their interpretation). */
  params: Record<string, number | string | boolean>;
}

/** REQ038 P2.4 — a named destination on the canvas: where the layer must
 *  ARRIVE at `tSec` (the "punto de la i" flow). Position in frame px. */
export interface DestMarker {
  id: string;
  layerId: string;
  label: string;
  tSec: number;
  x: number;
  y: number;
}

/** REQ038 P2.4 — a no-code "expression": follower rides the leader, i.e.
 *  leader translate + constant offset is ADDED to the follower's own
 *  (possibly animated) transform. Single-hop only — a leader may not
 *  itself be a follower (normalize enforces it). */
export interface LayerLink {
  id: string;
  followerId: string;
  leaderId: string;
  dx: number;
  dy: number;
}

export interface AnimationSchema {
  timeline: TimelineConfig;
  clips: Clip[];
  transitions: FrameTransition[];
  /** REQ037 P2.3: live preset instances (absent when none — legacy documents
   *  normalize to exactly the same JSON as before). */
  instances?: PresetInstance[];
  /** REQ038 P2.4: canvas destinations + layer links (absent when none). */
  markers?: DestMarker[];
  links?: LayerLink[];
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
  // REQ-VID7b: agents write preset IDS ("ease-out-expo") through set_animation;
  // accept them and resolve to the preset's real bezier instead of degrading
  // the tween to a plain "ease".
  const preset = EASING_PRESETS.find(e => e.id === raw);
  if (preset) return preset.value;
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

// ── G7: the five plain-language easings (selector, nunca bezier como texto) ──

/** The curated curve vocabulary the editors expose (gap G7). Every value is
 *  a string normalizeEasing/bezierOf already solve — no new engine paths, just
 *  an honest human selector over the existing evaluator. */
export interface SimpleEasing {
  id: "linear" | "accelerate" | "decelerate" | "accelerate-decelerate" | "overshoot";
  label: string;
  about: string;
  value: string;
}

export const SIMPLE_EASINGS: readonly SimpleEasing[] = [
  { id: "linear", label: "Lineal", about: "Velocidad constante, sin curva", value: "linear" },
  { id: "accelerate", label: "Acelerar", about: "Arranca suave y gana velocidad", value: "ease-in" },
  { id: "decelerate", label: "Frenar", about: "Arranca rápido y frena al llegar", value: "ease-out" },
  { id: "accelerate-decelerate", label: "Acelerar y frenar", about: "Suave al arrancar y al llegar", value: "ease-in-out" },
  { id: "overshoot", label: "Salto", about: "Pasa el objetivo y rebota de vuelta", value: "cubic-bezier(0.34, 1.56, 0.64, 1)" },
];

/** Closest curated option for ANY stored easing (agents, MCP and the curve
 *  pad can still write raw beziers — that stays a power path). Exact value
 *  match wins; otherwise the option whose samples sit nearest over [0,1],
 *  measured with the same evalBezier the engine runs. Callers show the label
 *  with a "≈" marker and MUST NOT mutate the stored value on display. */
export function closestSimpleEasing(easing: string | undefined | null): { option: SimpleEasing; exact: boolean } {
  const raw = normalizeEasing(easing);
  const exact = SIMPLE_EASINGS.find(s => s.value === raw);
  if (exact) return { option: exact, exact: true };
  const bez = bezierOf(raw);
  let best = SIMPLE_EASINGS[0];
  let bestD = Infinity;
  for (const s of SIMPLE_EASINGS) {
    const sb = bezierOf(s.value);
    let d = 0;
    for (let i = 1; i <= 9; i++) {
      const x = i / 10;
      const dy = evalBezier(bez, x) - evalBezier(sb, x);
      d += dy * dy;
    }
    if (d < bestD) { bestD = d; best = s; }
  }
  return { option: best, exact: false };
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
  // REQ038 P2.4: layer links ride the leader — leader translate + constant
  // offset is ADDED to the follower's own sample (single-hop; cycles were
  // dropped at normalize). A follower without its own transform sample gets
  // the pure ride: layers position via left/top, their static transform
  // base is identity.
  const links = schema.links || [];
  if (links.length > 0) {
    const followers = new Set(links.map(l => l.followerId));
    for (const link of links) {
      if (followers.has(link.leaderId)) continue;
      const lead = out.get(link.leaderId);
      if (!lead?.transform) continue;
      const lp = parseTransform(lead.transform);
      const fol = out.get(link.followerId);
      const fp = fol?.transform
        ? parseTransform(fol.transform)
        : { x: 0, y: 0, scale: 1, rotate: 0 };
      const next = composeTransform({
        x: fp.x + lp.x + link.dx,
        y: fp.y + lp.y + link.dy,
        scale: fp.scale,
        rotate: fp.rotate,
      });
      if (fol) fol.transform = next;
      else out.set(link.followerId, { transform: next });
    }
  }
  return out;
}

/** REQ036 P2.2: interpolate two canonical transform values where the spatial
 *  path is a quadratic Bézier: translate x/y ride the curve at eased progress
 *  `p`, scale/rotate still lerp linearly. Non-canonical values (extra
 *  functions) degrade to the plain token lerp — never break rendering. */
function interpolateTransformCurve(a: string, b: string, p: number, ctrl: XY): string {
  if (!isCanonicalTransform(a) || !isCanonicalTransform(b)) return interpolateValue(a, b, p);
  const pa = parseTransform(a);
  const pb = parseTransform(b);
  const q = quadAt({ x: pa.x, y: pa.y }, ctrl, { x: pb.x, y: pb.y }, p);
  return composeTransform({
    x: q.x,
    y: q.y,
    scale: pa.scale + (pb.scale - pa.scale) * p,
    rotate: pa.rotate + (pb.rotate - pa.rotate) * p,
  });
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
  // P2.2: a ctrl on either endpoint bends this segment's spatial path.
  const ctrl = tween.prop === "transform" ? (a.ctrl || b.ctrl || null) : null;
  return ctrl
    ? interpolateTransformCurve(a.value, b.value, eased, ctrl)
    : interpolateValue(a.value, b.value, eased);
}

// ── Presets ──────────────────────────────────────────────────────

/** P2.6 compact categories — the library groups by phase, never by internal
 *  taxonomy. "reveal" covers clip-path/text reveals. */
export type PresetCategory = "entrada" | "salida" | "bucle" | "reveal";

export const PRESET_CATEGORIES: ReadonlyArray<{ id: PresetCategory | "all"; label: string }> = [
  { id: "all", label: "Todos" },
  { id: "entrada", label: "Entrada" },
  { id: "salida", label: "Salida" },
  { id: "bucle", label: "Bucle" },
  { id: "reveal", label: "Reveal" },
];

export interface AnimationPreset {
  id: string;
  label: string;
  /** P2.6 library metadata: compact category + one-line description the
   *  cards show (search matches label + about + id). */
  category: PresetCategory;
  about: string;
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
    category: "entrada",
    about: "Aparece subiendo la opacidad.",
    tweens: [{ prop: "opacity", easing: "ease-out", keyframes: [{ t: 0, value: "0" }, { t: 1, value: "1" }] }],
  },
  {
    id: "fade-out",
    label: "Fade out",
    category: "salida",
    about: "Desaparece bajando la opacidad.",
    tweens: [{ prop: "opacity", easing: "ease-in", keyframes: [{ t: 0, value: "1" }, { t: 1, value: "0" }] }],
  },
  {
    id: "slide-in",
    label: "Slide in",
    category: "entrada",
    about: "Entra desde la izquierda con desaceleración.",
    tweens: [{
      prop: "transform",
      easing: "ease-out-expo",
      keyframes: [{ t: 0, value: "translateX(-60px) translateY(0px) scale(1) rotate(0deg)" }, { t: 1, value: IDENTITY.transform }],
    }],
  },
  {
    id: "slide-in-up",
    label: "Slide in ↑",
    category: "entrada",
    about: "Entra desde abajo con desaceleración.",
    tweens: [{
      prop: "transform",
      easing: "ease-out-expo",
      keyframes: [{ t: 0, value: "translateX(0px) translateY(60px) scale(1) rotate(0deg)" }, { t: 1, value: IDENTITY.transform }],
    }],
  },
  {
    id: "zoom-in",
    label: "Zoom in",
    category: "entrada",
    about: "Crece desde el 60% con rebote sutil.",
    tweens: [{
      prop: "transform",
      easing: "ease-out-back",
      keyframes: [{ t: 0, value: "translateX(0px) translateY(0px) scale(0.6) rotate(0deg)" }, { t: 1, value: IDENTITY.transform }],
    }],
  },
  {
    id: "blur-in",
    label: "Blur in",
    category: "entrada",
    about: "Aparece desenfocado y va enfocando.",
    tweens: [
      { prop: "opacity", easing: "ease-out", keyframes: [{ t: 0, value: "0" }, { t: 1, value: "1" }] },
      { prop: "filter", easing: "ease-out", keyframes: [{ t: 0, value: "blur(12px) brightness(1)" }, { t: 1, value: IDENTITY.filter }] },
    ],
  },
  {
    id: "rotate",
    label: "Rotate in",
    category: "entrada",
    about: "Entra girando -45° con rebote.",
    tweens: [{
      prop: "transform",
      easing: "ease-out-back",
      keyframes: [{ t: 0, value: "translateX(0px) translateY(0px) scale(0.8) rotate(-45deg)" }, { t: 1, value: IDENTITY.transform }],
    }],
  },
  {
    id: "pop",
    label: "Pop / bounce",
    category: "entrada",
    about: "Aparece desde el 30% con resorte.",
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
    category: "bucle",
    about: "Flota arriba y abajo en loop.",
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
    category: "reveal",
    about: "Revela de izquierda a derecha (clip-path).",
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
        const kf: Keyframe = { t: num(k.t, 0, 0, 1), value };
        // P2.2: keep a finite ctrl (clamped), drop anything else — unknown
        // garbage must never survive a normalize round-trip.
        const ctrlRaw = k.ctrl && typeof k.ctrl === "object" ? (k.ctrl as Record<string, unknown>) : null;
        const cx = ctrlRaw ? Number(ctrlRaw.x) : NaN;
        const cy = ctrlRaw ? Number(ctrlRaw.y) : NaN;
        if (Number.isFinite(cx) && Number.isFinite(cy)) {
          kf.ctrl = { x: Math.min(10000, Math.max(-10000, cx)), y: Math.min(10000, Math.max(-10000, cy)) };
        }
        keyframes.push(kf);
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
    const origin = typeof c.origin === "string" && c.origin.trim()
      ? c.origin.trim().slice(0, 60) : undefined;
    const instanceId = typeof c.instanceId === "string" && c.instanceId.trim()
      ? c.instanceId.trim().slice(0, 80) : undefined;
    const clipOut: Clip = { layerId, startSec, endSec: Math.max(endSec, startSec + 0.05), tweens };
    if (origin) clipOut.origin = origin;
    if (instanceId) clipOut.instanceId = instanceId;
    clips.push(clipOut);
  }

  const transitions: FrameTransition[] = [];
  for (const tRaw of Array.isArray(input.transitions) ? input.transitions : []) {
    if (!tRaw || typeof tRaw !== "object") continue;
    const t = tRaw as unknown as Record<string, unknown>;
    const toFrameId = str(t.toFrameId);
    const type = typeof t.type === "string" && TRANSITIONS.some(td => td.id === t.type)
      ? (t.type as TransitionType) : "fade";
    if (!toFrameId) continue;
    const durationSec = num(t.durationSec, 0.6, 0.1, 5);
    // V5: params validated against the catalog (unknown keys dropped,
    // numbers clamped, enums/colors whitelisted). Absent → defaults at render.
    const params = sanitizeTransitionParams(type, (t.params ?? null) as TransitionParams | null);
    transitions.push(params
      ? { toFrameId, type, durationSec, params }
      : { toFrameId, type, durationSec });
  }

  // REQ037 P2.3: live preset instances — primitives-only params, capped.
  const instances: PresetInstance[] = [];
  for (const iRaw of Array.isArray(input.instances) ? input.instances : []) {
    if (!iRaw || typeof iRaw !== "object" || instances.length >= 64) continue;
    const i = iRaw as unknown as Record<string, unknown>;
    const id = str(i.id);
    const presetId = str(i.presetId);
    const layerId = str(i.layerId);
    if (!id || !presetId || !layerId) continue;
    const params: Record<string, number | string | boolean> = {};
    if (i.params && typeof i.params === "object") {
      for (const [k, v] of Object.entries(i.params as Record<string, unknown>)) {
        if (params[k] !== undefined || Object.keys(params).length >= 40) continue;
        if (typeof v === "number" && Number.isFinite(v)) params[k] = v;
        else if (typeof v === "string") params[k] = v.slice(0, 120);
        else if (typeof v === "boolean") params[k] = v;
      }
    }
    instances.push({ id: id.slice(0, 80), presetId: presetId.slice(0, 40), layerId: layerId.slice(0, 120), params });
  }

  // REQ038 P2.4: canvas destinations + layer links. Links are single-hop:
  // a link whose leader is itself a follower is dropped (cycle guard).
  const markers: DestMarker[] = [];
  for (const mRaw of Array.isArray(input.markers) ? input.markers : []) {
    if (!mRaw || typeof mRaw !== "object" || markers.length >= 64) continue;
    const m = mRaw as unknown as Record<string, unknown>;
    const id = str(m.id);
    const layerId = str(m.layerId);
    if (!id || !layerId) continue;
    const mx = Number(m.x);
    const my = Number(m.y);
    if (!Number.isFinite(mx) || !Number.isFinite(my)) continue;
    markers.push({
      id: id.slice(0, 80),
      layerId: layerId.slice(0, 120),
      label: (str(m.label) || "destino").slice(0, 40),
      tSec: num(m.tSec, 0, 0, 600),
      x: Math.min(10000, Math.max(-10000, mx)),
      y: Math.min(10000, Math.max(-10000, my)),
    });
  }
  const links: LayerLink[] = [];
  const linkFollowers = new Set<string>();
  for (const lRaw of Array.isArray(input.links) ? input.links : []) {
    if (!lRaw || typeof lRaw !== "object" || links.length >= 32) continue;
    const l = lRaw as unknown as Record<string, unknown>;
    const id = str(l.id);
    const followerId = str(l.followerId);
    const leaderId = str(l.leaderId);
    if (!id || !followerId || !leaderId || followerId === leaderId) continue;
    if (linkFollowers.has(leaderId)) continue; // single-hop only
    const dx = Number(l.dx);
    const dy = Number(l.dy);
    linkFollowers.add(followerId);
    links.push({
      id: id.slice(0, 80),
      followerId: followerId.slice(0, 120),
      leaderId: leaderId.slice(0, 120),
      dx: Number.isFinite(dx) ? Math.min(10000, Math.max(-10000, dx)) : 0,
      dy: Number.isFinite(dy) ? Math.min(10000, Math.max(-10000, dy)) : 0,
    });
  }

  const out: AnimationSchema = {
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
  if (instances.length > 0) out.instances = instances;
  if (markers.length > 0) out.markers = markers;
  if (links.length > 0) out.links = links;
  return out;
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
    // P2.2: curved segments (a keyframe with `ctrl`) are baked into uniform
    // linear time-samples — WAAPI cannot draw a spatial Bézier between two
    // offsets. Straight segments keep the exact keyframe + per-tween easing.
    const kfs = tween.keyframes;
    const keyframes: Array<Record<string, string | number>> = [];
    const push = (t: number, value: string, easing?: string) => {
      keyframes.push({
        offset: Math.min(1, Math.max(0, t)),
        [tween.prop]: value,
        ...(easing ? { easing } : {}),
      });
    };
    const segCtrl = (i: number): { x: number; y: number } | null => {
      const next = kfs[i + 1];
      return tween.prop === "transform" && next ? (kfs[i].ctrl || next.ctrl || null) : null;
    };
    if (kfs.length > 0) {
      push(kfs[0].t, kfs[0].value, segCtrl(0) ? "linear" : normalizeEasing(tween.easing));
    }
    for (let i = 0; i < kfs.length - 1; i++) {
      const a = kfs[i];
      const b = kfs[i + 1];
      const ctrl = segCtrl(i);
      if (ctrl) {
        const N = 14;
        const hasNextSeg = i + 2 < kfs.length;
        const nextCtrl = hasNextSeg ? (kfs[i + 1].ctrl || kfs[i + 2].ctrl || null) : null;
        for (let s = 1; s <= N; s++) {
          // When the NEXT segment is straight, its plain branch pushes the
          // exact endpoint below — avoid a duplicate offset here. When this
          // is the last segment (or the next is also curved), s = N IS the
          // exact endpoint and must be pushed.
          if (s === N && hasNextSeg && !nextCtrl) continue;
          const u = s / N;
          const eased = evalBezier(bezierOf(tween.easing), u);
          push(
            a.t + (b.t - a.t) * u,
            interpolateTransformCurve(a.value, b.value, eased, ctrl),
            s < N || (hasNextSeg && nextCtrl) ? "linear" : undefined,
          );
        }
      } else {
        push(b.t, b.value, segCtrl(i + 1) ? "linear" : (b.t < 1 ? normalizeEasing(tween.easing) : undefined));
      }
    }
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
