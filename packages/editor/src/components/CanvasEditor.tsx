/**
 * Canvas Editor Component
 * ──────────────────────────────────────────────────────────────
 * Main Fabric.js canvas wrapper. Initializes and manages the
 * fabric.Canvas instance, handles viewport transforms (zoom/pan),
 * object selection, and keyboard shortcuts.
 *
 * @module components/CanvasEditor
 *
 * State: Uses useCanvas hook for tool, zoom, grid, clipboard
 * Events: Mouse/keyboard → object manipulation, tool switching
 * DB:    None (all persistence via useRemoteSync hook)
 */

import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { Canvas as FabricCanvas } from "fabric";
import type { ToolName } from "../hooks/useCanvas";

interface Props {
  zoom: number;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  fabricRef: RefObject<FabricCanvas | null>;
  tool: ToolName;
  onCanvasReady?: () => void;
  children?: React.ReactNode;
}

export function CanvasEditor({ zoom, canvasRef, fabricRef, tool, onCanvasReady, children }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Notify parent when canvas element is mounted
  useEffect(() => {
    onCanvasReady?.();
  }, [onCanvasReady]);

  // Pan: middle mouse, space+drag, or hand tool left-click drag
  useEffect(() => {
    const el = wrapperRef.current; if (!el) return;
    let isPanning = false;
    let lastX = 0, lastY = 0;
    let spaceDown = false;

    const onKeyDown = (e: KeyboardEvent) => { if (e.code === "Space" && !e.repeat) { spaceDown = true; } };
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === "Space") spaceDown = false; };

    const onMouseDown = (e: MouseEvent) => {
      // Middle mouse OR space+left-click OR hand tool left-click
      if (e.button === 1 || (e.button === 0 && spaceDown) || (e.button === 0 && tool === "hand")) {
        isPanning = true; lastX = e.clientX; lastY = e.clientY; e.preventDefault();
      }
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!isPanning) return;
      const fc = fabricRef.current; if (!fc) return;
      const vpt = fc.viewportTransform;
      if (!vpt) return;
      vpt[4] += e.clientX - lastX;
      vpt[5] += e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      fc.renderAll();
    };
    const onMouseUp = () => { isPanning = false; };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("mousemove", onMouseMove);
    el.addEventListener("mouseup", onMouseUp);
    el.addEventListener("mouseleave", onMouseUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      el.removeEventListener("mousedown", onMouseDown);
      el.removeEventListener("mousemove", onMouseMove);
      el.removeEventListener("mouseup", onMouseUp);
      el.removeEventListener("mouseleave", onMouseUp);
    };
  }, [canvasRef, fabricRef, tool]);

  return (
    <div className="canvas-inner" ref={wrapperRef}>
      <canvas ref={canvasRef as any} />
      {children}
    </div>
  );
}
