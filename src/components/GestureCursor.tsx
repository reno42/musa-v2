/**
 * The air cursor — a dot that mirrors the pointing finger (REQ cursor
 * route). Non-interactive by design (pointer-events: none): it SHOWS,
 * the synthetic events from gesturePointer ACT.
 *
 * 30fps position updates go through direct style writes on a non-reactive
 * store slot — they must never re-render the editor.
 */

import { useEffect, useRef } from "react";
import { getCursorSlot } from "../lib/gesture/gestureStore";

export function GestureCursor() {
  const dotRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let raf = 0;
    const pump = () => {
      const c = getCursorSlot();
      const dot = dotRef.current;
      if (dot) {
        dot.style.transform = `translate(${c.x - 9}px, ${c.y - 9}px)`;
        dot.style.opacity = c.visible ? "1" : "0";
      }
      const ring = ringRef.current;
      if (ring) {
        ring.style.transform = `translate(${c.x - 18}px, ${c.y - 18}px) scale(${c.down ? 0.7 : 1})`;
        ring.style.opacity = c.visible ? (c.down ? "0.9" : "0.45") : "0";
      }
      raf = requestAnimationFrame(pump);
    };
    raf = requestAnimationFrame(pump);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, pointerEvents: "none" }} aria-hidden="true">
      <div
        ref={ringRef}
        style={{
          position: "absolute", left: 0, top: 0, width: 36, height: 36,
          borderRadius: 999, border: "2px solid #a78bfa", opacity: 0,
          transition: "transform 80ms ease-out, opacity 150ms",
        }}
      />
      <div
        ref={dotRef}
        style={{
          position: "absolute", left: 0, top: 0, width: 18, height: 18,
          borderRadius: 999, background: "#c4b5fd", opacity: 0,
          border: "2px solid rgba(20,16,12,0.7)",
          boxShadow: "0 0 10px rgba(139,92,246,0.8)",
        }}
      />
    </div>
  );
}
