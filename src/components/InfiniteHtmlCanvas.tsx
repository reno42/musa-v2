import { useRef, useState, useCallback, useEffect } from "react";
import { DesignFrame, type FrameData, type LayerSelectionRequest, type SelectedElementInfo } from "./DesignFrame";

/**
 * InfiniteHtmlCanvas — An infinite pannable/zoomable canvas that holds
 * DesignFrame containers (the "desk" holding "papers").
 *
 * Tools:
 *  - Select (V): click frame to select, drag frame/label to move,
 *    double-click frame to enter content mode, marquee drag on empty canvas
 *  - Hand (H): drag canvas to pan, scroll to zoom
 *  - Middle-click: always pans regardless of active tool
 *
 * Selection model (Figma-style):
 *  - Single click: select one frame (solid blue border)
 *  - Shift+click: toggle frame in/out of multi-selection
 *  - Drag empty canvas: marquee select intersecting frames
 *  - Double-click frame body: enter content mode (dashed border)
 *  - Click outside frame: exit content mode
 *  - Drag label: move frame (works in both modes)
 *  - Double-click label: rename inline
 */

export type HtmlToolName = "select" | "hand" | "frame" | "rect" | "circle" | "triangle" | "star" | "polygon" | "text" | "text-path" | "pen" | "pen-plus" | "pen-minus" | "pen-edit" | "pencil";

interface InfiniteHtmlCanvasProps {
  frames: FrameData[];
  selectedFrameId: string | null;
  selectedFrameIds: Set<string>;
  contentFrameId: string | null;
  activeTool: HtmlToolName;
  zoom: number;
  onSelectFrame: (id: string | null) => void;
  onActivateFrame?: (frameId: string) => void;
  onFrameShiftClick?: (frameId: string) => void;
  onMarqueeSelect?: (ids: Set<string>) => void;
  onEnterContentMode?: (frameId: string) => void;
  onZoomChange: (z: number) => void;
  onFrameMove?: (id: string, x: number, y: number) => void;
  onMultiFrameMove?: (moves: { id: string; x: number; y: number }[]) => void;
  onDuplicateFrames?: (copies: { sourceId: string; x: number; y: number }[]) => void;
  onRenameFrame?: (frameId: string, name: string) => void;
  onElementSelect?: (info: SelectedElementInfo | null) => void;
  layerSelectionRequest?: LayerSelectionRequest | null;
  selectedElement?: SelectedElementInfo | null;
  onFrameCssChange?: (frameId: string, newCss: string, newHtml?: string) => void;
  onFrameHtmlChange?: (frameId: string, newHtml: string) => void;
  onAddPrimitive?: (type: "rect" | "circle" | "triangle" | "star" | "polygon" | "text", x: number, y: number, sides?: number) => void;
  onDrawShape?: (type: "rect" | "circle" | "triangle" | "star" | "polygon", x: number, y: number, w: number, h: number, sides?: number) => void;
  onTextChange?: (layerId: string, newText: string) => void;
  onAddTextBox?: (x: number, y: number, w: number, h: number) => void;
  onAddPenPath?: (pathData: string, bounds: { x: number; y: number; width: number; height: number }, closed?: boolean) => void;
  onAddTextPath?: (pathData: string, bounds: { x: number; y: number; width: number; height: number }, clickX: number, clickY: number, startOffset: number, originalViewBox?: string) => void;
  onEditPathPoints?: (frameId: string, layerId: string, newPathD: string) => void;
  onElementDelete?: (layerId: string) => void;
  onElementDuplicate?: (layerId: string) => void;
  onFrameResize?: (id: string, width: number, height: number, x: number, y: number) => void;
  /** Frame tool (F/A): click = default 100×100 frame, drag = custom size. */
  onCreateFrame?: (x: number, y: number, w: number, h: number) => void;
  // Sprint 3.5: auto-edit newly created text layers
  autoEditLayerId?: string | null;
  onAutoEditHandled?: () => void;
}

const CANVAS_BG = "#1E1E1E";
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 5;

export function InfiniteHtmlCanvas({
  frames, selectedFrameId, selectedFrameIds, contentFrameId, activeTool, zoom,
  onSelectFrame, onActivateFrame, onFrameShiftClick, onMarqueeSelect, onEnterContentMode,
  onZoomChange, onFrameMove, onMultiFrameMove, onDuplicateFrames, onRenameFrame,
  onElementSelect, onFrameCssChange, onFrameHtmlChange,
  layerSelectionRequest, selectedElement,
  onAddPrimitive, onDrawShape, onTextChange, onAddTextBox, onAddPenPath, onAddTextPath, onEditPathPoints, onElementDelete, onElementDuplicate,
  onFrameResize, onCreateFrame,
  autoEditLayerId, onAutoEditHandled,
}: InfiniteHtmlCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef(pan);
  panRef.current = pan;
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const [isDraggingFrame, setIsDraggingFrame] = useState(false);
  const dragFrameRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number; duplicate: boolean; moved: boolean } | null>(null);

  // Multi-frame drag state (Phase 4)
  const multiDragRef = useRef<{ startX: number; startY: number; frames: { id: string; origX: number; origY: number }[]; duplicate: boolean; moved: boolean } | null>(null);

  // Marquee selection state (Phase 3)
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Frame tool draw state — click places a default frame, drag sizes a custom one.
  // The ref mirrors the state so mouseup reads the latest rect even when React
  // hasn't re-rendered between mousemove and mouseup.
  const frameDrawStartRef = useRef<{ x: number; y: number } | null>(null);
  const frameDrawRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const [frameDrawRect, setFrameDrawRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Label rename state (Phase 1)
  const [renamingFrameId, setRenamingFrameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Auto-center all frames on first mount
  useEffect(() => {
    if (!viewportRef.current || frames.length === 0) return;
    const b = getBounds(frames);
    const vw = viewportRef.current.clientWidth;
    const vh = viewportRef.current.clientHeight;
    const bw = b.maxX - b.minX + 200;
    const bh = b.maxY - b.minY + 200;
    const fz = Math.min(vw / bw, vh / bh, 1);
    // Clamp to MIN_ZOOM: wide decks (many 1920px frames side by side) or a
    // not-yet-laid-out viewport (clientWidth 0) used to round fz down to 0,
    // rendering the whole canvas at scale(0) — invisible frames.
    onZoomChange(Math.max(Math.round(fz * 100) / 100, MIN_ZOOM));
    setPan({
      x: vw / 2 - ((b.minX + (b.maxX - b.minX) / 2)) * fz,
      y: vh / 2 - ((b.minY + (b.maxY - b.minY) / 2)) * fz,
    });
  }, []); // eslint-disable-line

  // Convert screen coords to canvas coords
  const screenToCanvas = useCallback((clientX: number, clientY: number) => {
    const rect = viewportRef.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left - panRef.current.x) / zoom,
      y: (clientY - rect.top - panRef.current.y) / zoom,
    };
  }, [zoom]);

  // Start frame drag — multi-frame aware (Phase 4)
  const startFrameDrag = useCallback((frameId: string, e: React.MouseEvent) => {
    const f = frames.find(fr => fr.id === frameId);
    if (!f) return;
    const inSelection = selectedFrameIds.has(frameId);
    if (inSelection && selectedFrameIds.size > 1) {
      // Multi-frame drag: track all selected frames
      const selectedFrames = frames.filter(fr => selectedFrameIds.has(fr.id));
      multiDragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        frames: selectedFrames.map(fr => ({ id: fr.id, origX: fr.x, origY: fr.y })),
        duplicate: e.altKey,
        moved: false,
      };
    } else {
      dragFrameRef.current = {
        id: frameId,
        startX: e.clientX,
        startY: e.clientY,
        origX: f.x,
        origY: f.y,
        duplicate: e.altKey,
        moved: false,
      };
    }
    setIsDraggingFrame(true);
  }, [frames, selectedFrameIds]);

  // Canvas-level mousedown — handles pan, marquee start, deselection
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
    // Select tool: click on empty canvas deselects + starts marquee (Phase 3)
    if (activeTool === "select" && e.button === 0 && e.target === viewportRef.current) {
      onSelectFrame(null);
      onElementSelect?.(null);
      // Start marquee
      const pt = screenToCanvas(e.clientX, e.clientY);
      marqueeStartRef.current = pt;
      setMarqueeRect(null);
    }
    // Frame tool: start drawing a new frame on the empty canvas
    if (activeTool === "frame" && e.button === 0 && e.target === viewportRef.current) {
      frameDrawStartRef.current = screenToCanvas(e.clientX, e.clientY);
      frameDrawRectRef.current = null;
      setFrameDrawRect(null);
      return;
    }
    // Primitive tools: don't deselect the frame when clicking canvas background
    if (["rect", "circle", "text", "pen"].includes(activeTool) && e.button === 0 && e.target === viewportRef.current) {
      // Keep frame selected so primitive can be added
    }
  }, [activeTool, onSelectFrame, onElementSelect, screenToCanvas]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning.current) {
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      setPan(p => ({ x: p.x + dx, y: p.y + dy }));
      return;
    }
    // Single frame dragging
    if (dragFrameRef.current) {
      const df = dragFrameRef.current;
      const dx = (e.clientX - df.startX) / zoom;
      const dy = (e.clientY - df.startY) / zoom;
      if (!df.moved && Math.hypot(dx, dy) < 3) return;
      df.moved = true;
      const frameEl = document.querySelector(`[data-frame-id="${df.id}"]`) as HTMLElement;
      if (frameEl) {
        frameEl.style.transform = `translate(${dx}px, ${dy}px)`;
      }
      return;
    }
    // Multi-frame dragging (Phase 4)
    if (multiDragRef.current) {
      const md = multiDragRef.current;
      const dx = (e.clientX - md.startX) / zoom;
      const dy = (e.clientY - md.startY) / zoom;
      if (!md.moved && Math.hypot(dx, dy) < 3) return;
      md.moved = true;
      for (const f of md.frames) {
        const el = document.querySelector(`[data-frame-id="${f.id}"]`) as HTMLElement;
        if (el) {
          el.style.transform = `translate(${dx}px, ${dy}px)`;
        }
      }
      return;
    }
    // Frame tool drawing
    if (frameDrawStartRef.current) {
      const pt = screenToCanvas(e.clientX, e.clientY);
      const start = frameDrawStartRef.current;
      let w = pt.x - start.x;
      let h = pt.y - start.y;
      if (e.shiftKey) {
        const size = Math.max(Math.abs(w), Math.abs(h));
        w = w < 0 ? -size : size;
        h = h < 0 ? -size : size;
      }
      const rect = {
        x: w < 0 ? start.x + w : start.x,
        y: h < 0 ? start.y + h : start.y,
        w: Math.abs(w),
        h: Math.abs(h),
      };
      frameDrawRectRef.current = rect;
      setFrameDrawRect(rect);
      return;
    }
    // Marquee selection (Phase 3)
    if (marqueeStartRef.current) {
      const pt = screenToCanvas(e.clientX, e.clientY);
      const start = marqueeStartRef.current;
      setMarqueeRect({
        x: Math.min(start.x, pt.x),
        y: Math.min(start.y, pt.y),
        w: Math.abs(pt.x - start.x),
        h: Math.abs(pt.y - start.y),
      });
    }
  }, [zoom, screenToCanvas]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    isPanning.current = false;
    // Single frame drag commit
    if (dragFrameRef.current) {
      const df = dragFrameRef.current;
      const dx = (e.clientX - df.startX) / zoom;
      const dy = (e.clientY - df.startY) / zoom;
      const frameEl = document.querySelector(`[data-frame-id="${df.id}"]`) as HTMLElement | null;
      if (frameEl) frameEl.style.transform = "";
      if (df.moved) {
        if (df.duplicate) onDuplicateFrames?.([{ sourceId: df.id, x: df.origX + dx, y: df.origY + dy }]);
        else onFrameMove?.(df.id, Math.round(df.origX + dx), Math.round(df.origY + dy));
      }
      dragFrameRef.current = null;
      setIsDraggingFrame(false);
    }
    // Multi-frame drag commit (Phase 4)
    if (multiDragRef.current) {
      const md = multiDragRef.current;
      const dx = (e.clientX - md.startX) / zoom;
      const dy = (e.clientY - md.startY) / zoom;
      const moves = md.frames.map(f => ({
        id: f.id,
        x: Math.round(f.origX + dx),
        y: Math.round(f.origY + dy),
      }));
      for (const frame of md.frames) {
        const frameEl = document.querySelector(`[data-frame-id="${frame.id}"]`) as HTMLElement | null;
        if (frameEl) frameEl.style.transform = "";
      }
      if (md.moved) {
        if (md.duplicate) onDuplicateFrames?.(moves.map(move => ({ sourceId: move.id, x: move.x, y: move.y })));
        else onMultiFrameMove?.(moves);
      }
      multiDragRef.current = null;
      setIsDraggingFrame(false);
    }
    // Frame tool commit: drag = custom size, click = default 100×100
    if (frameDrawStartRef.current) {
      const start = frameDrawStartRef.current;
      frameDrawStartRef.current = null;
      const rect = frameDrawRectRef.current;
      frameDrawRectRef.current = null;
      setFrameDrawRect(null);
      if (rect && rect.w >= 4 && rect.h >= 4) {
        onCreateFrame?.(Math.round(rect.x), Math.round(rect.y), Math.max(20, Math.round(rect.w)), Math.max(20, Math.round(rect.h)));
      } else {
        onCreateFrame?.(Math.round(start.x), Math.round(start.y), 100, 100);
      }
      return;
    }
    // Marquee selection commit (Phase 3) — AABB intersection
    if (marqueeStartRef.current && marqueeRect) {
      const ids = new Set<string>();
      for (const f of frames) {
        if (
          f.x < marqueeRect.x + marqueeRect.w &&
          f.x + f.width > marqueeRect.x &&
          f.y < marqueeRect.y + marqueeRect.h &&
          f.y + f.height > marqueeRect.y
        ) {
          ids.add(f.id);
        }
      }
      if (ids.size > 0) onMarqueeSelect?.(ids);
    }
    marqueeStartRef.current = null;
    setMarqueeRect(null);
  }, [zoom, onFrameMove, onMultiFrameMove, onDuplicateFrames, onMarqueeSelect, onCreateFrame, frames, marqueeRect, frameDrawRect]);

  // Zoom with wheel — must use native listener with { passive: false }
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

  // Frame body mousedown — single/shift/multi drag logic (Phase 2 + 4)
  const handleFrameMouseDown = useCallback((frameId: string, e: React.MouseEvent) => {
    if (activeTool !== "select" || e.button !== 0) return;
    // Don't intercept clicks in content mode — let Shadow DOM handle them
    if (contentFrameId === frameId) return;

    // Shift+click: toggle in/out of selection (Phase 2)
    if (e.shiftKey) {
      onFrameShiftClick?.(frameId);
      e.stopPropagation();
      return;
    }

    // If already in multi-selection, start group drag
    if (selectedFrameIds.has(frameId) && selectedFrameIds.size > 1) {
      startFrameDrag(frameId, e);
    } else {
      onSelectFrame(frameId);
      startFrameDrag(frameId, e);
    }
    e.stopPropagation();
  }, [activeTool, contentFrameId, selectedFrameIds, onSelectFrame, onFrameShiftClick, startFrameDrag]);

  // Label mousedown — starts drag from label (Phase 1)
  const handleLabelMouseDown = useCallback((frameId: string, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    // Shift+click on label also toggles selection
    if (e.shiftKey) {
      onFrameShiftClick?.(frameId);
      return;
    }

    // Start drag (multi-aware)
    if (selectedFrameIds.has(frameId) && selectedFrameIds.size > 1) {
      startFrameDrag(frameId, e);
    } else {
      onSelectFrame(frameId);
      startFrameDrag(frameId, e);
    }
  }, [selectedFrameIds, onSelectFrame, onFrameShiftClick, startFrameDrag]);

  // Label double-click — start inline rename (Phase 1)
  const handleLabelDoubleClick = useCallback((frameId: string) => {
    const f = frames.find(fr => fr.id === frameId);
    if (!f) return;
    setRenamingFrameId(frameId);
    setRenameValue(f.name);
  }, [frames]);

  // Rename commit / cancel (Phase 1)
  const handleRenameCommit = useCallback(() => {
    if (renamingFrameId && renameValue.trim()) {
      onRenameFrame?.(renamingFrameId, renameValue.trim());
    }
    setRenamingFrameId(null);
    setRenameValue("");
  }, [renamingFrameId, renameValue, onRenameFrame]);

  const handleRenameCancel = useCallback(() => {
    setRenamingFrameId(null);
    setRenameValue("");
  }, []);

  // Frame body double-click — enter content mode (Phase 2)
  const handleFrameDoubleClick = useCallback((frameId: string, e: React.MouseEvent) => {
    if (activeTool === "select" && contentFrameId !== frameId) {
      e.stopPropagation();
      onEnterContentMode?.(frameId);
    }
  }, [activeTool, contentFrameId, onEnterContentMode]);

  const cursor = activeTool === "hand"
    ? (isPanning.current ? "grabbing" : "grab")
    : activeTool === "frame"
      ? "crosshair"
      : (isDraggingFrame ? "move" : marqueeRect ? "crosshair" : "default");

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
            onDoubleClick={(e) => handleFrameDoubleClick(frame.id, e)}
          >
            <DesignFrame
              frame={frame}
              isActive={frame.id === selectedFrameId}
              inMultiSelect={selectedFrameIds.has(frame.id) && selectedFrameIds.size > 1}
              contentMode={contentFrameId === frame.id}
              zoom={zoom}
              onActivate={onActivateFrame ?? onSelectFrame}
              onElementSelect={onElementSelect}
              selectionRequest={layerSelectionRequest?.frameId === frame.id ? layerSelectionRequest : null}
              selectedLayerId={selectedElement?.frameId === frame.id ? selectedElement.layerId : null}
              onCssChange={onFrameCssChange}
              onHtmlChange={onFrameHtmlChange}
              activeTool={activeTool}
              onAddPrimitive={onAddPrimitive}
              onDrawShape={onDrawShape}
              onTextChange={onTextChange}
              onAddTextBox={onAddTextBox}
              onAddPenPath={onAddPenPath}
              onAddTextPath={onAddTextPath}
              onEditPathPoints={(layerId, newPathD) => onEditPathPoints?.(frame.id, layerId, newPathD)}
              onElementDelete={onElementDelete}
              onElementDuplicate={onElementDuplicate}
              onLabelMouseDown={handleLabelMouseDown}
              onLabelDoubleClick={handleLabelDoubleClick}
              onEnterContentMode={onEnterContentMode}
              isRenaming={renamingFrameId === frame.id}
              renameValue={renameValue}
              onRenameChange={setRenameValue}
              onRenameCommit={handleRenameCommit}
              onRenameCancel={handleRenameCancel}
              onFrameResize={onFrameResize}
              autoEditLayerId={autoEditLayerId}
              onAutoEditHandled={onAutoEditHandled}
            />
          </div>
        ))}

        {/* Frame tool draw preview */}
        {frameDrawRect && (
          <div style={{
            position: "absolute",
            left: frameDrawRect.x,
            top: frameDrawRect.y,
            width: frameDrawRect.w,
            height: frameDrawRect.h,
            background: "rgba(255,255,255,0.85)",
            border: "1px solid rgba(59,130,246,0.9)",
            pointerEvents: "none",
            zIndex: 10000,
          }} />
        )}

        {/* Marquee selection rectangle (Phase 3) */}
        {marqueeRect && (
          <div style={{
            position: "absolute",
            left: marqueeRect.x,
            top: marqueeRect.y,
            width: marqueeRect.w,
            height: marqueeRect.h,
            background: "rgba(59,130,246,0.1)",
            border: "1px solid rgba(59,130,246,0.6)",
            pointerEvents: "none",
            zIndex: 10000,
          }} />
        )}
      </div>

      {/* Zoom + selection badge */}
      <div style={{
        position: "absolute", bottom: 12, right: 12,
        background: "rgba(0,0,0,0.65)", color: "#fff",
        padding: "4px 10px", borderRadius: 6, fontSize: 12,
        fontFamily: "monospace", pointerEvents: "none",
        backdropFilter: "blur(6px)",
      }}>
        {Math.round(zoom * 100)}% &middot; {frames.length} frame{frames.length !== 1 ? "s" : ""}
        {selectedFrameIds.size > 1 && ` &middot; ${selectedFrameIds.size} selected`}
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
