/**
 * layerGizmo — After Effects-style transform gizmo for the Video Mode stage.
 *
 * A transparent overlay (display-px space of the stage box) with:
 *   • move   — drag the selection box body
 *   • scale  — drag the SE corner handle (uniform, around the box center)
 *   • rotate — drag the stem handle above the box (angle around the center)
 *
 * All deltas are reported in DISPLAY px; the owner converts them to frame px
 * (divide by the stage fit) and applies them to the layer's transform parts.
 * Live feedback happens on every pointermove; `onCommit` fires ONCE per
 * gesture so the undo stack gets a single entry (AE behavior).
 */

export interface GizmoHandlers {
  /** Live move gesture: display-px delta since the drag started. */
  onMove?: (dxDisplay: number, dyDisplay: number) => void;
  /** Live scale gesture: ratio vs the box size at gesture start. */
  onScale?: (factor: number) => void;
  /** Live rotate gesture: degrees vs the angle at gesture start. */
  onRotate?: (deltaDeg: number) => void;
  /** Gesture ended — commit exactly once. */
  onCommit?: () => void;
}

export interface LayerGizmo {
  /** Position the gizmo over a layer (display px within the host). */
  show(left: number, top: number, width: number, height: number): void;
  hide(): void;
  setHandlers(h: GizmoHandlers): void;
  isDragging(): boolean;
  destroy(): void;
}

const BORDER = "1.5px solid #7ab3e0";
const ACCENT = "#7ab3e0";

export function createLayerGizmo(host: HTMLElement): LayerGizmo {
  const root = document.createElement("div");
  root.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:30;display:none;";
  host.appendChild(root);
  // Gizmo gestures must never surface as a stage click (the stage click
  // resolves layer selection — a drag-release here would deselect).
  root.addEventListener("click", e => e.stopPropagation());

  const box = document.createElement("div");
  box.style.cssText = `position:absolute;border:${BORDER};pointer-events:auto;cursor:move;box-shadow:0 0 0 1px rgba(0,0,0,0.5);`;
  root.appendChild(box);

  // Rotate stem: a vertical line + knob above the top edge center.
  const stem = document.createElement("div");
  stem.style.cssText = `position:absolute;left:50%;top:0;width:1px;height:-18px;pointer-events:none;background:${ACCENT};`;
  root.appendChild(stem);
  const knob = document.createElement("div");
  knob.style.cssText = `position:absolute;left:50%;top:-24px;width:9px;height:9px;margin-left:-4.5px;border-radius:50%;background:${ACCENT};pointer-events:auto;cursor:crosshair;border:1px solid #0a0a0a;`;
  root.appendChild(knob);

  // SE corner = scale.
  const corner = document.createElement("div");
  corner.style.cssText = "position:absolute;right:-5px;bottom:-5px;width:10px;height:10px;background:#0a0a0a;border:1.5px solid " + ACCENT + ";pointer-events:auto;cursor:nwse-resize;";
  box.appendChild(corner);

  let handlers: GizmoHandlers = {};
  let drag: {
    kind: "move" | "scale" | "rotate";
    startX: number; startY: number;
    cx: number; cy: number;      // box center (display px, viewport coords)
    startDist: number;
    startAngle: number;
    moved: boolean;
  } | null = null;

  const gestureKind = (el: HTMLElement): "move" | "scale" | "rotate" =>
    el === corner ? "scale" : el === knob ? "rotate" : "move";

  const onDown = (e: PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const boxRect = box.getBoundingClientRect();
    const cx = boxRect.left + boxRect.width / 2;
    const cy = boxRect.top + boxRect.height / 2;
    const dx = e.clientX - cx, dy = e.clientY - cy;
    drag = {
      kind: gestureKind(e.target as HTMLElement),
      startX: e.clientX, startY: e.clientY,
      cx, cy,
      startDist: Math.max(4, Math.hypot(dx, dy)),
      startAngle: Math.atan2(dy, dx) * (180 / Math.PI),
      moved: false,
    };
  };

  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    drag.moved = true;
    if (drag.kind === "move") {
      handlers.onMove?.(e.clientX - drag.startX, e.clientY - drag.startY);
    } else if (drag.kind === "scale") {
      const dx = e.clientX - drag.cx, dy = e.clientY - drag.cy;
      handlers.onScale?.(Math.max(0.02, Math.hypot(dx, dy) / drag.startDist));
    } else {
      const dx = e.clientX - drag.cx, dy = e.clientY - drag.cy;
      const ang = Math.atan2(dy, dx) * (180 / Math.PI);
      handlers.onRotate?.(ang - drag.startAngle);
    }
  };

  const onUp = () => {
    if (!drag) return;
    const wasDrag = drag;
    drag = null;
    if (wasDrag.moved) handlers.onCommit?.();
  };

  box.addEventListener("pointerdown", onDown);
  corner.addEventListener("pointerdown", onDown);
  knob.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);

  return {
    show(left, top, width, height) {
      root.style.display = "block";
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
      stem.style.left = `${left + width / 2}px`;
      stem.style.top = `${top - 18}px`;
      stem.style.height = "18px";
      knob.style.left = `${left + width / 2 - 4.5}px`;
      knob.style.top = `${top - 28}px`;
    },
    hide() { root.style.display = "none"; },
    setHandlers(h) { handlers = h || {}; },
    isDragging() { return drag !== null; },
    destroy() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      root.remove();
    },
  };
}
