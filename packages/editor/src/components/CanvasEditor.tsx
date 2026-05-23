import { useEffect, useRef } from "react";
import type { RefObject } from "react";

interface Props {
  zoom: number;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onCanvasReady?: () => void;
}

export function CanvasEditor({ zoom, canvasRef, onCanvasReady }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Notify parent when canvas element is mounted
  useEffect(() => {
    onCanvasReady?.();
  }, [onCanvasReady]);

  // Pan: middle mouse or space+drag
  useEffect(() => {
    const el = wrapperRef.current; if (!el) return;
    let isPanning = false;
    let lastX = 0, lastY = 0;
    let spaceDown = false;

    const onKeyDown = (e: KeyboardEvent) => { if (e.code === "Space" && !e.repeat) { spaceDown = true; } };
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === "Space") spaceDown = false; };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 1 || (e.button === 0 && spaceDown)) {
        isPanning = true; lastX = e.clientX; lastY = e.clientY; e.preventDefault();
      }
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!isPanning) return;
      const canvas = canvasRef.current; if (!canvas) return;
      const fc = (canvas as any).__fabric; if (!fc) return;
      const vpt = fc.viewportTransform;
      vpt[4] += e.clientX - lastX;
      vpt[5] += e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      fc.requestRenderAll();
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
  }, [canvasRef]);

  return (
    <div className="canvas-area" ref={wrapperRef}>
      <canvas ref={canvasRef as any} />
    </div>
  );
}
