/**
 * transformValue — REQ036 P2.2: canonical transform-string math in shared/,
 * so the schema sampler (export), the WAAPI compiler (preview) and the
 * editor helpers all parse/compose "translateX(Npx) translateY(Npx)
 * scale(N) rotate(Ndeg)" with ONE implementation (shared/README.md: no DOM,
 * no I/O; imported by editor, MCP and QA alike).
 *
 * P2.2 quadratic path: a keyframe may carry `ctrl` (a control point in the
 * SAME translate space as its value), turning the straight segment that
 * STARTS at it into a quadratic Bézier. quadAt() is the single sampler.
 */

export interface TransformParts { x: number; y: number; scale: number; rotate: number }

/** Parse any authored transform value into parts (missing pieces = identity).
 *  Tolerates arbitrary unit suffixes on translate/scale/rotate numbers. */
export function parseTransform(value: string | undefined | null): TransformParts {
  const v = (value || "").trim();
  const out: TransformParts = { x: 0, y: 0, scale: 1, rotate: 0 };
  if (!v) return out;
  const tx = /translateX\(\s*(-?[\d.]+)/.exec(v);
  const ty = /translateY\(\s*(-?[\d.]+)/.exec(v);
  const sc = /scale\(\s*(-?[\d.]+)/.exec(v);
  const ro = /rotate\(\s*(-?[\d.]+)/.exec(v);
  if (tx) out.x = Number(tx[1]);
  if (ty) out.y = Number(ty[1]);
  if (sc) out.scale = Number(sc[1]);
  if (ro) out.rotate = Number(ro[1]);
  return out;
}

/** Canonical transform string (the value every preset and the gizmo write). */
export function composeTransform(p: TransformParts): string {
  const r6 = (n: number) => Number(n.toFixed(3));
  return `translateX(${r6(p.x)}px) translateY(${r6(p.y)}px) scale(${r6(p.scale)}) rotate(${r6(p.rotate)}deg)`;
}

/** True when the value reduces to exactly the four canonical functions —
 *  curve interpolation may only rewrite values it fully understands; extra
 *  functions (skew, matrix…) fall back to straight-line interpolation. */
export function isCanonicalTransform(value: string | undefined | null): boolean {
  const v = (value || "").trim();
  if (!v) return false;
  const stripped = v
    .replace(/translateX\(\s*-?[\d.]+px\s*\)/g, "")
    .replace(/translateY\(\s*-?[\d.]+px\s*\)/g, "")
    .replace(/scale\(\s*-?[\d.]+\s*\)/g, "")
    .replace(/rotate\(\s*-?[\d.]+deg\s*\)/g, "");
  return stripped.trim().length === 0;
}

export interface XY { x: number; y: number }

/** Quadratic Bézier point at parameter u ∈ [0,1]: (1-u)²P0 + 2(1-u)u·C + u²P1. */
export function quadAt(p0: XY, c: XY, p1: XY, u: number): XY {
  const k = 1 - u;
  return {
    x: k * k * p0.x + 2 * k * u * c.x + u * u * p1.x,
    y: k * k * p0.y + 2 * k * u * c.y + u * u * p1.y,
  };
}
