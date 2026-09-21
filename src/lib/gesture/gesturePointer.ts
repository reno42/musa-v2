/**
 * Air-cursor delivery. The classifier says WHERE; this module makes the
 * editor FEEL it: synthetic mouse events at the cursor so every REAL
 * handler runs — topbar buttons click, tools activate, drawing tools drag
 * through their own native flow (mousedown → live preview → mouseup commit).
 *
 * React does not require trusted events; the canvas flows run on React
 * mouse handlers + refs (no setPointerCapture), so this is safe here —
 * unlike the pointer-injection path rejected in plan v2 (decision D1).
 */

import { getCursorSlot, setCursorSlot } from "./gestureStore";

const CLICKABLE =
  "button, a, input, select, textarea, label, [role='button'], [data-gesture-click]";

function mouseEvent(type: string, x: number, y: number): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: type === "mouseup" ? 0 : 1,
  });
}

let downEl: Element | null = null;
let downWasClickable = false;

export function gestureCursorMove(x: number, y: number): void {
  setCursorSlot({ visible: true, x, y });
  if (downEl) downEl.dispatchEvent(mouseEvent("mousemove", x, y));
}

export function gestureCursorDown(x: number, y: number): void {
  setCursorSlot({ visible: true, x, y, down: true });
  const el = document.elementFromPoint(x, y);
  if (!el) {
    downEl = null;
    return;
  }
  const clickable = el.closest(CLICKABLE);
  const viewport = document.querySelector("[data-gesture-viewport]");
  if (clickable) {
    downEl = clickable;
    downWasClickable = true;
    clickable.dispatchEvent(mouseEvent("mousedown", x, y));
  } else if (viewport && (el === viewport || viewport.contains(el))) {
    // Dispatch on the viewport ITSELF: drawing tools require
    // e.target === viewportRef.current to start a stroke (InfiniteHtmlCanvas).
    downEl = viewport;
    downWasClickable = false;
    viewport.dispatchEvent(mouseEvent("mousedown", x, y));
  } else {
    downEl = el;
    downWasClickable = false;
    el.dispatchEvent(mouseEvent("mousedown", x, y));
  }
}

export function gestureCursorUp(x: number, y: number): void {
  if (x < 0) {
    // Sentinel: hands lost — release blind at the last known position.
    if (downEl) {
      const last = getCursorSlot();
      downEl.dispatchEvent(mouseEvent("mouseup", last.x, last.y));
    }
    downEl = null;
    downWasClickable = false;
    setCursorSlot({ visible: false, down: false });
    return;
  }
  setCursorSlot({ down: false });
  const el = downEl ?? document.elementFromPoint(x, y);
  if (el) {
    el.dispatchEvent(mouseEvent("mouseup", x, y));
    if (downWasClickable) {
      el.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: x,
          clientY: y,
          button: 0,
        }),
      );
    }
  }
  downEl = null;
  downWasClickable = false;
}
