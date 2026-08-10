/**
 * Keeping a design's card from ever showing a black rectangle.
 *
 * The instinct is to snapshot when the user leaves. That cannot be made to
 * work, and it is worth being precise about why: rasterizing a frame and
 * uploading it is asynchronous, and no browser will wait for asynchronous work
 * during unload. `beforeunload` cannot await. `pagehide` gives you a handful of
 * milliseconds. And none of them fire at all when the laptop lid closes, the
 * battery dies, or the tab is killed for memory. An exit-triggered snapshot is
 * a snapshot that is missing exactly when you needed it.
 *
 * So this does the opposite: it snapshots when the work SETTLES. A few seconds
 * after the last edit, while the user is still sitting there, the thumbnail is
 * already saved. By the time they hit back, log out, close the tab or pull the
 * plug, there is nothing left to do — the capture happened minutes ago.
 *
 * Exit events are still wired up, but as a flush of something already pending,
 * never as the mechanism.
 *
 * Cost is the other half of the question. Three rules keep it cheap:
 *   1. Nothing is captured unless the design actually changed (a revision
 *      counter, not a deep compare).
 *   2. At most one capture per MIN_INTERVAL_MS, however furiously someone types.
 *   3. Captured small. A card is ~300px wide; rendering at 2x full size to
 *      throw the pixels away is most of the cost of a snapshot.
 */

/** Time after the last edit before it is worth spending a capture. */
export const SETTLE_MS = 4000;
/** Floor between two captures, so a long editing session cannot spin. */
export const MIN_INTERVAL_MS = 60_000;
/** Long edge of the stored thumbnail. Cards never show it bigger. */
export const THUMB_EDGE = 480;

export interface SnapshotDecision {
  capture: boolean;
  reason: "no-change" | "too-soon" | "nothing-to-capture" | "settled" | "flush";
}

/**
 * Whether this moment deserves a capture. Pure, so the policy can be tested
 * without a canvas: every guard that saves work lives here.
 */
export function shouldCapture(params: {
  revision: number;
  capturedRevision: number;
  lastCaptureAt: number;
  now: number;
  hasFrame: boolean;
  /** A flush is the page going away — the interval floor does not apply. */
  flush?: boolean;
}): SnapshotDecision {
  const { revision, capturedRevision, lastCaptureAt, now, hasFrame, flush } = params;
  if (!hasFrame) return { capture: false, reason: "nothing-to-capture" };
  if (revision === capturedRevision) return { capture: false, reason: "no-change" };
  if (!flush && now - lastCaptureAt < MIN_INTERVAL_MS) return { capture: false, reason: "too-soon" };
  return { capture: true, reason: flush ? "flush" : "settled" };
}

/**
 * Scale that renders the thumbnail at THUMB_EDGE on its longest side.
 *
 * Capped at 1 so a small frame is never blown up, and floored so a huge
 * artboard still produces something legible rather than a smudge.
 */
export function thumbnailScale(width: number, height: number, edge = THUMB_EDGE): number {
  const longest = Math.max(width || 0, height || 0);
  if (longest <= 0) return 1;
  return Math.min(1, Math.max(0.05, edge / longest));
}
