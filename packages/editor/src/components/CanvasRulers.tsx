import { useEffect, useRef } from "react";
import type { Canvas as FabricCanvas } from "fabric";

interface Props {
  fabricRef: React.RefObject<FabricCanvas | null>;
  zoom: number;
  /** Viewport pan offset */
  panX?: number;
  panY?: number;
  /** Canvas dimensions */
  canvasWidth: number;
  canvasHeight: number;
}

const RULER_SIZE = 24;

/**
 * Figma-style rulers: horizontal top ruler + vertical left ruler.
 * Tick marks and labels update with zoom and pan position.
 */
export function CanvasRulers({ fabricRef, zoom, canvasWidth, canvasHeight }: Props) {
  const hRuler = useRef<HTMLCanvasElement>(null);
  const vRuler = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = fabricRef.current;
    if (!c) return;

    const draw = () => {
      drawRuler(hRuler.current, "h", c, zoom, canvasWidth);
      drawRuler(vRuler.current, "v", c, zoom, canvasHeight);
    };

    draw();
    c.on("after:render", draw);
    return () => { c.off("after:render", draw); };
  }, [fabricRef, zoom, canvasWidth, canvasHeight]);

  return (
    <>
      <canvas
        ref={hRuler}
        className="ruler ruler-h"
        width={canvasWidth + RULER_SIZE}
        height={RULER_SIZE}
        style={{ position: "absolute", top: 0, left: RULER_SIZE, height: RULER_SIZE, zIndex: 50 }}
      />
      <canvas
        ref={vRuler}
        className="ruler ruler-v"
        width={RULER_SIZE}
        height={canvasHeight + RULER_SIZE}
        style={{ position: "absolute", top: RULER_SIZE, left: 0, width: RULER_SIZE, zIndex: 50 }}
      />
      {/* Corner box */}
      <div style={{
        position: "absolute", top: 0, left: 0,
        width: RULER_SIZE, height: RULER_SIZE,
        background: "#1a1a2e", borderRight: "1px solid #333", borderBottom: "1px solid #333",
        zIndex: 51,
      }} />
    </>
  );
}

function drawRuler(
  canvas: HTMLCanvasElement | null,
  orientation: "h" | "v",
  fc: FabricCanvas,
  zoom: number,
  canvasDim: number,
) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const vpt = fc.viewportTransform;
  if (!vpt) return;
  const panX = vpt[4];
  const panY = vpt[5];

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Border
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, canvas.width, canvas.height);

  const isH = orientation === "h";
  const pan = isH ? panX : panY;

  // Calculate visible range
  const start = (-pan) / zoom;
  const end = start + canvasDim / zoom;

  // Determine step size based on zoom
  let step = 100;
  if (zoom < 0.1) step = 1000;
  else if (zoom < 0.3) step = 500;
  else if (zoom < 0.6) step = 200;
  else if (zoom < 1.5) step = 100;
  else step = 50;

  ctx.fillStyle = "#888";
  ctx.strokeStyle = "#555";
  ctx.font = "9px Inter, sans-serif";

  for (let pos = Math.floor(start / step) * step; pos <= end; pos += step) {
    const screenPos = (pos * zoom + pan);
    const halfStep = step / 2;

    if (isH) {
      const x = screenPos + RULER_SIZE;

      // Half-step tick
      for (let sub = pos + halfStep; sub < pos + step; sub += halfStep) {
        const subX = (sub * zoom + pan) + RULER_SIZE;
        ctx.beginPath();
        ctx.moveTo(subX, RULER_SIZE - 5);
        ctx.lineTo(subX, RULER_SIZE);
        ctx.stroke();
      }

      // Full-step tick
      ctx.beginPath();
      ctx.moveTo(x, RULER_SIZE - 10);
      ctx.lineTo(x, RULER_SIZE);
      ctx.stroke();

      // Label
      ctx.fillText(String(Math.round(pos)), x + 2, 11);
    } else {
      const y = screenPos + RULER_SIZE;

      // Half-step tick
      for (let sub = pos + halfStep; sub < pos + step; sub += halfStep) {
        const subY = (sub * zoom + pan) + RULER_SIZE;
        ctx.beginPath();
        ctx.moveTo(RULER_SIZE - 5, subY);
        ctx.lineTo(RULER_SIZE, subY);
        ctx.stroke();
      }

      // Full-step tick
      ctx.beginPath();
      ctx.moveTo(RULER_SIZE - 10, y);
      ctx.lineTo(RULER_SIZE, y);
      ctx.stroke();

      // Label (vertical)
      ctx.save();
      ctx.translate(9, y + 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(String(Math.round(pos)), 0, 0);
      ctx.restore();
    }
  }
}
