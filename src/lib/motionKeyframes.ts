/**
 * motionKeyframes — safe, pure sampler for the declarative MotionSpec data
 * stored in a standalone video material payload.
 *
 * The portable MotionSpec validator already rejects executable source. This
 * module nevertheless treats persisted JSON as untrusted: it reads only the
 * documented properties, bounds numerical values, and rejects CSS strings
 * that can escape an inline property. Preview, Canvas export, and the
 * inspector can therefore share the same sampled values.
 */

export const MOTION_NUMERIC_PROPERTIES = [
  "opacity",
  "x",
  "y",
  "scale",
  "rotation",
] as const;

export const MOTION_DISCRETE_PROPERTIES = [
  "filter",
  "color",
  "backgroundColor",
  "width",
  "height",
  "top",
  "left",
  "transform",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "background",
  "borderRadius",
] as const;

export type MotionNumericProperty = (typeof MOTION_NUMERIC_PROPERTIES)[number];
export type MotionDiscreteProperty = (typeof MOTION_DISCRETE_PROPERTIES)[number];
export type MotionProperty = MotionNumericProperty | MotionDiscreteProperty;
export type MotionDiscreteValue = string | number;

export interface MotionPayloadKeyframe {
  id: string;
  property: MotionProperty;
  timeMs: number;
  value: number | MotionDiscreteValue;
  easing?: string;
}

export interface MotionPayloadProps {
  opacity?: number;
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  filter?: MotionDiscreteValue;
  color?: MotionDiscreteValue;
  backgroundColor?: MotionDiscreteValue;
  width?: MotionDiscreteValue;
  height?: MotionDiscreteValue;
  top?: MotionDiscreteValue;
  left?: MotionDiscreteValue;
  transform?: MotionDiscreteValue;
  fontFamily?: MotionDiscreteValue;
  fontSize?: MotionDiscreteValue;
  fontWeight?: MotionDiscreteValue;
  lineHeight?: MotionDiscreteValue;
  letterSpacing?: MotionDiscreteValue;
  textAlign?: MotionDiscreteValue;
  background?: MotionDiscreteValue;
  borderRadius?: MotionDiscreteValue;
}

/** Result intentionally has no CSS or DOM types, so it is usable by Canvas
 * export as well as the React preview. Undefined means that the material did
 * not declare that property. */
export type SampledMotionValues = MotionPayloadProps;

export interface MotionCanvasCoordinates {
  width: number;
  height: number;
}

export interface MotionCanvasOffset {
  xPct: number;
  yPct: number;
  xPx: number;
  yPx: number;
}

const PROPERTY_SET = new Set<string>([
  ...MOTION_NUMERIC_PROPERTIES,
  ...MOTION_DISCRETE_PROPERTIES,
]);
const NUMERIC_SET = new Set<string>(MOTION_NUMERIC_PROPERTIES);
const MAX_TIME_MS = 3_600_000;
const MAX_COORDINATE = 100_000;
const MAX_ROTATION = 360_000;
const MAX_SCALE = 1_000;
const MAX_STYLE_TEXT = 240;
// Safe enough for a single CSS property value. In particular this excludes
// `;`, braces, backslashes and `url(` so callers cannot turn a payload value
// into another declaration or fetch an arbitrary URL.
const SAFE_STYLE_TEXT = /^[a-zA-Z0-9#(),.%\s_+\-/'"]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanTime(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > MAX_TIME_MS) return null;
  return Math.round(value);
}

function cleanNumeric(property: MotionNumericProperty, value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  switch (property) {
    case "opacity":
      return Math.min(1, Math.max(0, value));
    case "scale":
      return Math.min(MAX_SCALE, Math.max(0.001, value));
    case "rotation":
      return Math.min(MAX_ROTATION, Math.max(-MAX_ROTATION, value));
    case "x":
    case "y":
      return Math.min(MAX_COORDINATE, Math.max(-MAX_COORDINATE, value));
  }
}

function cleanDiscrete(value: unknown): MotionDiscreteValue | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(MAX_COORDINATE, Math.max(-MAX_COORDINATE, value));
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_STYLE_TEXT || !SAFE_STYLE_TEXT.test(trimmed)) return null;
  if (/url\s*\(|expression\s*\(|[;{}\\]/i.test(trimmed)) return null;
  return trimmed;
}

function cleanValue(property: MotionProperty, value: unknown): number | MotionDiscreteValue | null {
  if (NUMERIC_SET.has(property)) return cleanNumeric(property as MotionNumericProperty, value);
  return cleanDiscrete(value);
}

function cleanEasing(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 80 || !SAFE_STYLE_TEXT.test(trimmed)) return undefined;
  return trimmed;
}

/** Reads static properties from a material payload. Unknown keys are ignored. */
export function motionPropsFromPayload(payload: unknown): MotionPayloadProps {
  if (!isRecord(payload) || !isRecord(payload.props)) return {};
  const raw = payload.props;
  const props: MotionPayloadProps = {};
  for (const property of PROPERTY_SET) {
    const value = cleanValue(property as MotionProperty, raw[property]);
    if (value !== null) (props as Record<string, number | MotionDiscreteValue>)[property] = value;
  }
  return props;
}

/** Reads portable MotionSpec keyframes persisted on a material payload.
 * Invalid entries are omitted rather than guessed. Sorting is deterministic,
 * so an equivalent JSON document samples identically across preview/export. */
export function motionKeyframesFromPayload(payload: unknown): MotionPayloadKeyframe[] {
  if (!isRecord(payload) || !Array.isArray(payload.keyframes)) return [];
  const parsed: Array<MotionPayloadKeyframe & { order: number }> = [];
  for (let index = 0; index < payload.keyframes.length; index += 1) {
    const raw = payload.keyframes[index];
    if (!isRecord(raw) || typeof raw.property !== "string" || !PROPERTY_SET.has(raw.property)) continue;
    const property = raw.property as MotionProperty;
    const timeMs = cleanTime(raw.timeMs);
    const value = cleanValue(property, raw.value);
    if (timeMs === null || value === null) continue;
    const id = typeof raw.id === "string" && raw.id.trim()
      ? raw.id.trim().slice(0, 128)
      : `motion-kf-${index + 1}`;
    parsed.push({ id, property, timeMs, value, easing: cleanEasing(raw.easing), order: index });
  }
  return parsed
    .sort((a, b) => a.property.localeCompare(b.property) || a.timeMs - b.timeMs || a.id.localeCompare(b.id) || a.order - b.order)
    .map(({ order: _order, ...frame }) => frame);
}

/** True only when at least one valid keyframe survived parsing. */
export function hasMotionKeyframes(payload: unknown): boolean {
  return motionKeyframesFromPayload(payload).length > 0;
}

function sampleNumeric(frames: MotionPayloadKeyframe[], atMs: number, fallback: number | undefined): number | undefined {
  const numeric = frames.filter((frame): frame is MotionPayloadKeyframe & { value: number } => typeof frame.value === "number");
  if (numeric.length === 0) return fallback;
  if (atMs < numeric[0].timeMs) return numeric[0].value;
  // The parser orders same-time entries deterministically by id. The last
  // entry at that instant wins, matching ordinary keyframe authoring where a
  // later correction replaces the previous value rather than interpolating a
  // zero-length span.
  let previous = numeric[0];
  for (let index = 1; index < numeric.length; index += 1) {
    const next = numeric[index];
    if (next.timeMs <= atMs) {
      previous = next;
      continue;
    }
    const span = Math.max(1, next.timeMs - previous.timeMs);
    const progress = Math.min(1, Math.max(0, (atMs - previous.timeMs) / span));
    const eased = applyEasing(progress, previous.easing);
    return previous.value + (next.value - previous.value) * eased;
  }
  return previous.value;
}

/** The portable grammar accepts familiar CSS easing names and cubic-bezier.
 * Easing belongs to the keyframe a tween starts from, the same convention
 * used by CSS animations. Unknown values deliberately fall back to linear so
 * malformed persisted JSON cannot make preview and Canvas export diverge. */
function applyEasing(progress: number, raw: string | undefined): number {
  const t = Math.min(1, Math.max(0, progress));
  const easing = raw?.trim().toLowerCase() || "linear";
  if (easing === "linear") return t;
  if (easing === "ease") return cubicBezierAt(t, 0.25, 0.1, 0.25, 1);
  if (easing === "ease-in") return cubicBezierAt(t, 0.42, 0, 1, 1);
  if (easing === "ease-out") return cubicBezierAt(t, 0, 0, 0.58, 1);
  if (easing === "ease-in-out") return cubicBezierAt(t, 0.42, 0, 0.58, 1);
  const match = /^cubic-bezier\(\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*\)$/.exec(easing);
  if (!match) return t;
  const values = match.slice(1).map(Number);
  if (values.some((value) => !Number.isFinite(value))) return t;
  // CSS allows y control points outside 0..1 for overshoot, but x must remain
  // monotonic for a stable inverse. Reject the latter instead of guessing.
  if (values[0] < 0 || values[0] > 1 || values[2] < 0 || values[2] > 1) return t;
  return cubicBezierAt(t, values[0], values[1], values[2], values[3]);
}

function cubicBezierAt(x: number, x1: number, y1: number, x2: number, y2: number): number {
  const cubic = (t: number, p1: number, p2: number) => {
    const inv = 1 - t;
    return 3 * inv * inv * t * p1 + 3 * inv * t * t * p2 + t * t * t;
  };
  // Binary search is deterministic and behaves well at flat control points.
  let low = 0;
  let high = 1;
  for (let index = 0; index < 18; index += 1) {
    const mid = (low + high) / 2;
    if (cubic(mid, x1, x2) < x) low = mid;
    else high = mid;
  }
  return cubic((low + high) / 2, y1, y2);
}

function sampleDiscrete(frames: MotionPayloadKeyframe[], atMs: number, fallback: MotionDiscreteValue | undefined): MotionDiscreteValue | undefined {
  if (frames.length === 0) return fallback;
  let result: MotionDiscreteValue = frames[0].value as MotionDiscreteValue;
  for (const frame of frames) {
    if (frame.timeMs > atMs) break;
    result = frame.value as MotionDiscreteValue;
  }
  return result;
}

/**
 * Samples a material's declarative motion at the global project time in ms.
 * Numerical properties interpolate linearly. Discrete CSS-like properties
 * switch at their keyframe time. The first keyframe is the state before the
 * animation begins, mirroring how portable MotionSpec clips are authored.
 */
export function sampleMotionPayload(payload: unknown, atGlobalMs: number): SampledMotionValues {
  const atMs = Math.min(MAX_TIME_MS, Math.max(0, Number.isFinite(atGlobalMs) ? atGlobalMs : 0));
  const props = motionPropsFromPayload(payload);
  const frames = motionKeyframesFromPayload(payload);
  const sampled: SampledMotionValues = { ...props };
  for (const property of MOTION_NUMERIC_PROPERTIES) {
    const value = sampleNumeric(frames.filter((frame) => frame.property === property), atMs, props[property]);
    if (value !== undefined) sampled[property] = value;
  }
  for (const property of MOTION_DISCRETE_PROPERTIES) {
    const value = sampleDiscrete(frames.filter((frame) => frame.property === property), atMs, props[property]);
    if (value !== undefined) sampled[property] = value;
  }
  return sampled;
}

/** The compiler stores the authored composition size with each material. Use
 * it to turn portable pixel x/y values into the target preview/export canvas
 * without depending on the browser's responsive stage dimensions. */
export function motionCanvasCoordinates(
  payload: unknown,
  fallbackWidth: number,
  fallbackHeight: number,
): MotionCanvasCoordinates {
  const fallback = {
    width: Math.max(1, Number.isFinite(fallbackWidth) ? fallbackWidth : 1),
    height: Math.max(1, Number.isFinite(fallbackHeight) ? fallbackHeight : 1),
  };
  if (!isRecord(payload) || !isRecord(payload.motionCanvas)) return fallback;
  const width = payload.motionCanvas.width;
  const height = payload.motionCanvas.height;
  return {
    width: typeof width === "number" && Number.isFinite(width) && width > 0 ? width : fallback.width,
    height: typeof height === "number" && Number.isFinite(height) && height > 0 ? height : fallback.height,
  };
}

/** Maps MotionSpec's pixel x/y to both responsive percentages and target
 * canvas pixels. A missing x/y has zero offset. */
export function motionCanvasOffset(
  payload: unknown,
  values: SampledMotionValues,
  targetWidth: number,
  targetHeight: number,
): MotionCanvasOffset {
  const source = motionCanvasCoordinates(payload, targetWidth, targetHeight);
  const x = typeof values.x === "number" ? values.x : 0;
  const y = typeof values.y === "number" ? values.y : 0;
  const width = Math.max(1, targetWidth);
  const height = Math.max(1, targetHeight);
  return {
    xPct: (x / source.width) * 100,
    yPct: (y / source.height) * 100,
    xPx: (x / source.width) * width,
    yPx: (y / source.height) * height,
  };
}
