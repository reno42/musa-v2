/**
 * One-Euro filter (Casiez et al., CHI 2012) — the standard filter for
 * hand-tracking input: kills jitter at rest without the perceptible lag of a
 * heavy low-pass, because the cutoff adapts to speed (slow = tight, fast =
 * permissive). REQ Gesture Mode §6 smoothing.ts.
 *
 * Plain erasable TS only — QA/*.test.mjs imports this with
 * node --experimental-strip-types.
 */

export class OneEuroFilter {
  private hatX: number | null = null;
  private hatDx = 0;
  private lastT: number | null = null;

  minCutoff: number;
  beta: number;
  dCutoff: number;

  constructor(minCutoff = 1.2, beta = 0.25, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  /** Smoothed frequency cutoff: alpha = 1 / (1 + tau/dt). */
  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x: number, tMs: number): number {
    if (this.hatX === null || this.lastT === null) {
      this.hatX = x;
      this.lastT = tMs;
      return x;
    }
    const dt = Math.max((tMs - this.lastT) / 1000, 1e-3);
    this.lastT = tMs;
    const dx = (x - this.hatX) / dt;
    const aD = OneEuroFilter.alpha(this.dCutoff, dt);
    this.hatDx = aD * dx + (1 - aD) * this.hatDx;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.hatDx);
    const a = OneEuroFilter.alpha(cutoff, dt);
    this.hatX = a * x + (1 - a) * this.hatX;
    return this.hatX;
  }

  reset(): void {
    this.hatX = null;
    this.hatDx = 0;
    this.lastT = null;
  }
}

/** 2D point filter for normalized landmark space (wrist, index tip). */
export class OneEuroPoint {
  private fx: OneEuroFilter;
  private fy: OneEuroFilter;

  constructor(minCutoff = 1.2, beta = 0.25) {
    this.fx = new OneEuroFilter(minCutoff, beta);
    this.fy = new OneEuroFilter(minCutoff, beta);
  }

  filter(x: number, y: number, tMs: number): { x: number; y: number } {
    return { x: this.fx.filter(x, tMs), y: this.fy.filter(y, tMs) };
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
  }
}
