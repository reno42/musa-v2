// packages/editor/src/components/CursorOverlay.tsx
// Renders remote user cursors as overlays on the canvas.

import { useState, useEffect } from "react";
import type { CursorPosition } from "@futuraria/shared";

interface Props {
  cursors: CursorPosition[];
  /** Current fabric viewport transform [scaleX, skewX, skewY, scaleY, translateX, translateY]. */
  viewportTransform: number[];
}

/** Fade out cursors after this many ms of inactivity. */
const CURSOR_FADE_MS = 3000;

export function CursorOverlay({ cursors, viewportTransform }: Props) {
  const [visibleCursors, setVisibleCursors] = useState<
    Map<string, { cursor: CursorPosition; lastUpdate: number }>
  >(new Map());

  // Update visible cursors when cursors prop changes
  useEffect(() => {
    setVisibleCursors((prev) => {
      const next = new Map(prev);
      const now = Date.now();
      for (const cursor of cursors) {
        next.set(cursor.userId, { cursor, lastUpdate: now });
      }
      return next;
    });
  }, [cursors]);

  // Periodically remove stale cursors
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setVisibleCursors((prev) => {
        const next = new Map(prev);
        let changed = false;
        for (const [key, val] of next) {
          if (now - val.lastUpdate > CURSOR_FADE_MS) {
            next.delete(key);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const [, , , , vpX, vpY] = viewportTransform;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
        zIndex: 10,
      }}
    >
      {Array.from(visibleCursors.entries()).map(([userId, { cursor, lastUpdate }]) => {
        const age = Date.now() - lastUpdate;
        const opacity = age > CURSOR_FADE_MS * 0.7
          ? Math.max(0, 1 - (age - CURSOR_FADE_MS * 0.7) / (CURSOR_FADE_MS * 0.3))
          : 1;

        // Transform canvas coordinates to screen coordinates
        const screenX = cursor.x + vpX;
        const screenY = cursor.y + vpY;

        return (
          <div
            key={userId}
            style={{
              position: "absolute",
              left: screenX,
              top: screenY,
              transform: "translate(-2px, -2px)",
              opacity,
              transition: "opacity 0.3s ease-out",
              pointerEvents: "none",
              zIndex: 10,
            }}
          >
            {/* Cursor arrow SVG */}
            <svg
              width="16"
              height="20"
              viewBox="0 0 16 20"
              fill="none"
              style={{ display: "block" }}
            >
              <path
                d="M1 1L1 16L5.5 12L10 19L13 17.5L8.5 10.5L14 9.5L1 1Z"
                fill={cursor.color}
                stroke="white"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
            {/* User name label */}
            <div
              style={{
                position: "absolute",
                left: 14,
                top: 14,
                background: cursor.color,
                color: "#fff",
                fontSize: 11,
                fontWeight: 600,
                fontFamily: "Inter, system-ui, sans-serif",
                padding: "2px 6px",
                borderRadius: 4,
                whiteSpace: "nowrap",
                lineHeight: 1.3,
                boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
              }}
            >
              {cursor.userName}
            </div>
          </div>
        );
      })}
    </div>
  );
}
