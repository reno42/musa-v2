import { useRef, useState, useCallback, useEffect } from "react";
import { DesignFrame, type FrameData, type SelectedElementInfo } from "./DesignFrame";

/**
 * InfiniteHtmlCanvas — An infinite pannable/zoomable canvas that holds
 * DesignFrame containers (the "desk" holding "papers").
 *
 * Tools:
 *  - Select (V): click frame to select, drag frame to move on desk
 *  - Hand (H): drag canvas to pan, scroll to zoom
 *  - Middle-click: always pans regardless of active tool
 */

export type HtmlToolName = "select" | "hand" | "rect" | "circle" | "text" | "pen";

interface InfiniteHtmlCanvasProps {
  frames: FrameData[];
  selectedFrameId: string | null;
  activeTool: HtmlToolName;
  zoom: number;
  onSelectFrame: (id: string | null) => void;
  onZoomChange: (z: number) => void;
  onFrameMove?: (id: string, x: number, y: number) => void;
  onElementSelect?: (info: SelectedElementInfo | null) => void;
  onFrameCssChange?: (frameId: string, newCss: string) => void;
  onFrameHtmlChange?: (frameId: string, newHtml: string) => void;
  onAddPrimitive?: (type: "rect" | "circle" | "text", x: number, y: number) => void;
  onDrawShape?: (type: "rect" | "circle", x: number, y: number, w: number, h: number) => void;
  onTextChange?: (layerId: string, newText: string) => void;
  onAddPenPath?: (pathData: string, bounds: { x: number; y: number; width: number; height: number }) => void;
  onElementDelete?: (layerId: string) => void;
  onElementDuplicate?: (layerId: string) => void;
}

const CANVAS_BG = "#1a1a2e";
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 5;

export function InfiniteHtmlCanvas({
  frames, selectedFrameId, activeTool, zoom,
  onSelectFrame, onZoomChange, onFrameMove,
  onElementSelect, onFrameCssChange, onFrameHtmlChange,
  onAddPrimitive, onDrawShape, onTextChange, onAddPenPath, onElementDelete, onElementDuplicate,
}: InfiniteHtmlCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef(pan);
  panRef.current = pan;
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const [isDraggingFrame, setIsDraggingFrame] = useState(false);
  const dragFrameRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Auto-center all frames on first mount
  useEffect(() => {
    if (!viewportRef.current || frames.length === 0) return;
    const b = getBounds(frames);
    const vw = viewportRef.current.clientWidth;
    const vh = viewportRef.current.clientHeight;
    const bw = b.maxX - b.minX + 200;
    const bh = b.maxY - b.minY + 200;
    const fz = Math.min(vw / bw, vh / bh, 1);
    onZoomChange(Math.round(fz * 100) / 100);
    setPan({
      x: vw / 2 - ((b.minX + (b.maxX - b.minX) / 2)) * fz,
      y: vh / 2 - ((b.minY + (b.maxY - b.minY) / 2)) * fz,
    });
  }, []); // eslint-disable-line

  // Pan handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Middle-click always pans
    if (e.button === 1) {
      isPanning.current = true;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      e.preventDefault();
      return;
    }
    // Hand tool: left-click pans
    if (activeTool === "hand" && e.button === 0) {
      isPanning.current = true;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      return;
    }
    // Select tool: click on empty canvas deselects
    if (activeTool === "select" && e.button === 0 && e.target === viewportRef.current) {
      onSelectFrame(null);
      onElementSelect?.(null);
    }
    // Primitive tools: don't deselect the frame when clicking canvas background
    if (["rect", "circle", "text", "pen"].includes(activeTool) && e.button === 0 && e.target === viewportRef.current) {
      // Keep frame selected so primitive can be added
    }
  }, [activeTool, onSelectFrame, onElementSelect]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning.current) {
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      setPan(p => ({ x: p.x + dx, y: p.y + dy }));
      return;
    }
    // Frame dragging
    if (dragFrameRef.current) {
      const df = dragFrameRef.current;
      const dx = (e.clientX - df.startX) / zoom;
      const dy = (e.clientY - df.startY) / zoom;
      // Update frame position via direct DOM manipulation for performance
      const frameEl = document.querySelector(`[data-frame-id="${df.id}"]`) as HTMLElement;
      if (frameEl) {
        frameEl.style.left = `${df.origX + dx}px`;
        frameEl.style.top = `${df.origY + dy}px`;
      }
    }
  }, [zoom]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    isPanning.current = false;
    if (dragFrameRef.current) {
      const df = dragFrameRef.current;
      const dx = (e.clientX - df.startX) / zoom;
      const dy = (e.clientY - df.startY) / zoom;
      onFrameMove?.(df.id, df.origX + dx, df.origY + dy);
      dragFrameRef.current = null;
      setIsDraggingFrame(false);
    }
  }, [zoom, onFrameMove]);

  // Zoom with wheel — must use native listener with { passive: false }
  // because React attaches wheel as passive, making preventDefault() fail.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const factor = 0.999 ** e.deltaY;
      const newZoom = Math.min(Math.max(zoom * factor, MIN_ZOOM), MAX_ZOOM);
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const p = panRef.current;
      setPan({
        x: cx - (cx - p.x) * (newZoom / zoom),
        y: cy - (cy - p.y) * (newZoom / zoom),
      });
      onZoomChange(Math.round(newZoom * 1000) / 1000);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [zoom, onZoomChange]);

  // Frame drag start (only in select mode)
  const handleFrameMouseDown = useCallback((frameId: string, e: React.MouseEvent) => {
    if (activeTool !== "select" || e.button !== 0) return;
    const f = frames.find(fr => fr.id === frameId);
    if (!f) return;
    onSelectFrame(frameId);
    dragFrameRef.current = {
      id: frameId,
      startX: e.clientX,
      startY: e.clientY,
      origX: f.x,
      origY: f.y,
    };
    setIsDraggingFrame(true);
    e.stopPropagation();
  }, [activeTool, frames, onSelectFrame]);

  const cursor = activeTool === "hand"
    ? (isPanning.current ? "grabbing" : "grab")
    : (isDraggingFrame ? "move" : "default");

  return (
    <div
      ref={viewportRef}
      style={{
        width: "100%", height: "100%",
        overflow: "hidden", position: "relative",
        background: CANVAS_BG,
        cursor,
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Transform layer */}
      <div style={{
        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        transformOrigin: "0 0",
        position: "absolute", top: 0, left: 0,
        width: 0, height: 0,
      }}>
        {frames.map(frame => (
          <div
            key={frame.id}
            data-frame-id={frame.id}
            onMouseDown={(e) => handleFrameMouseDown(frame.id, e)}
          >
            <DesignFrame
              frame={frame}
              isActive={frame.id === selectedFrameId}
              onActivate={onSelectFrame}
              onElementSelect={onElementSelect}
              onCssChange={onFrameCssChange}
              onHtmlChange={onFrameHtmlChange}
              activeTool={activeTool}
              onAddPrimitive={onAddPrimitive}
              onDrawShape={onDrawShape}
              onTextChange={onTextChange}
              onAddPenPath={onAddPenPath}
              onElementDelete={onElementDelete}
              onElementDuplicate={onElementDuplicate}
            />
          </div>
        ))}
      </div>

      {/* Zoom badge */}
      <div style={{
        position: "absolute", bottom: 12, right: 12,
        background: "rgba(0,0,0,0.65)", color: "#fff",
        padding: "4px 10px", borderRadius: 6, fontSize: 12,
        fontFamily: "monospace", pointerEvents: "none",
        backdropFilter: "blur(6px)",
      }}>
        {Math.round(zoom * 100)}% &middot; {frames.length} frame{frames.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
}

function getBounds(frames: FrameData[]) {
  return frames.reduce(
    (a, f) => ({
      minX: Math.min(a.minX, f.x), minY: Math.min(a.minY, f.y),
      maxX: Math.max(a.maxX, f.x + f.width), maxY: Math.max(a.maxY, f.y + f.height),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}
