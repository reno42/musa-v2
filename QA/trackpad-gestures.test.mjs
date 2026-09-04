/**
 * Trackpad gestures on the editor canvas.
 *
 * The wheel handler is the one place where pinch-zoom and two-finger pan
 * live. A regression here is invisible in unit maths and brutal in the
 * hands: the canvas stops following the fingers or hijacks the browser's
 * page zoom. These assertions pin the wiring, not the feel.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const readRepo = rel => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

const gestureEffect = () => {
  const canvas = readRepo("src/components/InfiniteHtmlCanvas.tsx");
  return canvas.slice(
    canvas.indexOf("Trackpad gestures: pinch = zoom"),
    canvas.indexOf("// ── Touch: 1 finger pans"),
  );
};

test("wheel handler separates pinch (ctrl+wheel) from two-finger pan", () => {
  const canvas = readRepo("src/components/InfiniteHtmlCanvas.tsx");
  // Pinch arrives as ctrl+wheel; two-finger scroll as a plain wheel.
  assert.match(canvas, /e\.ctrlKey \|\| e\.metaKey/);
  assert.match(canvas, /\{ x: nextPan\.x - e\.deltaX \* unit, y: nextPan\.y - e\.deltaY \* unit \}/);
  // Zoom stays clamped and anchored: the world point under the fingers holds.
  assert.match(canvas, /Math\.min\(MAX_ZOOM, Math\.max\(MIN_ZOOM, nextZoom \* Math\.exp\(-dy \* 0\.007\)\)\)/);
  assert.match(canvas, /x: cx - \(cx - nextPan\.x\) \* \(target \/ nextZoom\)/);
});

test("gestures commit once per frame and stay non-passive", () => {
  const effect = gestureEffect();
  assert.match(effect, /requestAnimationFrame\(flush\)/);
  assert.match(effect, /cancelAnimationFrame\(raf\)/);
  // Re-sync on gesture start so buttons/zoom-to-fit between gestures win.
  assert.match(effect, /now - lastWheelAt > 150/);
  assert.match(effect, /passive: false/);
});

test("the gesture path never switches or reads the active tool", () => {
  const effect = gestureEffect();
  assert.doesNotMatch(effect, /setActiveTool/);
});

test("the effect subscribes once — it must not depend on zoom", () => {
  const canvas = readRepo("src/components/InfiniteHtmlCanvas.tsx");
  assert.match(gestureEffect(), /\}, \[onZoomChange\]\);/);
  // Refs mirror the props so the gesture never reads a stale closure.
  assert.match(canvas, /const zoomRef = useRef\(zoom\);\s*\n\s*zoomRef\.current = zoom;/);
});
