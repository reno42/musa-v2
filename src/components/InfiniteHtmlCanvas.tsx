import { useRef, useState, useCallback, useEffect } from "react";
import { DesignFrame, frameHitTestRegistry, frameMarqueeRegistry, type FrameData, type HtmlCanvasObject, type LayerSelectionRequest, type SelectedElementInfo } from "./DesignFrame";
import { CanvasGuides, type Guide, type ColumnConfig, type SmartGuide } from "./CanvasGuides";
import { computeAlignmentGuides, computeSpacingGuides, snapToGuides, type ElementBounds } from "../lib/smartGuides";

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
  canvasObjects: HtmlCanvasObject[];
  selectedFrameIds: Set<string>;
  selectedOrphanIds: Set<string>;
  contentFrameId: string | null;
  activeTool: HtmlToolName;
  zoom: number;
  onSelectFrame: (id: string | null) => void;
  onActivateFrame?: (frameId: string) => void;
  onFrameShiftClick?: (frameId: string) => void;
  onMarqueeSelect?: (ids: Set<string>) => void;
  onMarqueeSelectOrphans?: (ids: Set<string>) => void;
  onEnterContentMode?: (frameId: string) => void;
  onZoomChange: (z: number) => void;
  onFrameMove?: (id: string, x: number, y: number) => void;
  onMultiFrameMove?: (moves: { id: string; x: number; y: number }[]) => void;
  onDuplicateFrames?: (copies: { sourceId: string; x: number; y: number }[]) => void;
  onRenameFrame?: (frameId: string, name: string) => void;
  onElementSelect?: (info: SelectedElementInfo | null) => void;
  /** Click on frame body resolves the topmost layer under the cursor (layer-panel order). */
  onRequestLayerSelect?: (frameId: string, layerId: string, additive?: boolean) => void;
  layerSelectionRequest?: LayerSelectionRequest | null;
  selectedElement?: SelectedElementInfo | null;
  selectedLayerIds?: readonly string[];
  onLayerSelectionChange?: (frameId: string, layerIds: string[]) => void;
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
  /** Drawing tools on empty canvas create orphans instead of auto-frames. */
  onCreateOrphanFromTool?: (type: string, x: number, y: number, w: number, h: number) => void;
  /** Orphan selection */
  onSelectOrphan?: (id: string | null) => void;
  onOrphanShiftClick?: (id: string) => void;
  onOrphanMove?: (id: string, x: number, y: number) => void;
  onDeleteOrphan?: (id: string) => void;
  /** Inline text editing of orphan objects (double-click, or auto after create). */
  onOrphanHtmlChange?: (id: string, html: string) => void;
  autoEditOrphanId?: string | null;
  onAutoEditOrphanHandled?: () => void;
  // Sprint 3.5: auto-edit newly created text layers
  autoEditLayerId?: string | null;
  onAutoEditHandled?: () => void;
  // ── Canvas Guides (rulers, guides, grid, columns, smart guides) ──
  guides?: Guide[];
  onGuidesChange?: (guides: Guide[]) => void;
  showGrid?: boolean;
  gridSize?: number;
  showRulers?: boolean;
  columnConfig?: ColumnConfig | null;
  smartGuides?: SmartGuide[];
}

const CANVAS_BG = "#1E1E1E";
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 5;

export function InfiniteHtmlCanvas({
  frames, canvasObjects, selectedFrameIds, selectedOrphanIds, contentFrameId, activeTool, zoom,
  onSelectFrame, onActivateFrame, onFrameShiftClick, onMarqueeSelect, onEnterContentMode,
  onZoomChange, onFrameMove, onMultiFrameMove, onDuplicateFrames, onRenameFrame,
  onElementSelect, onRequestLayerSelect, onFrameCssChange, onFrameHtmlChange,
  layerSelectionRequest, selectedElement, selectedLayerIds = [], onLayerSelectionChange,
  onAddPrimitive, onDrawShape, onTextChange, onAddTextBox, onAddPenPath, onAddTextPath, onEditPathPoints, onElementDelete, onElementDuplicate,
  onFrameResize, onCreateFrame, onCreateOrphanFromTool,
  onSelectOrphan, onOrphanShiftClick, onOrphanMove, onDeleteOrphan, onMarqueeSelectOrphans,
  onOrphanHtmlChange, autoEditOrphanId, onAutoEditOrphanHandled,
  autoEditLayerId, onAutoEditHandled,
  guides = [], onGuidesChange, showGrid = true, gridSize = 8, showRulers = true, columnConfig = null, smartGuides = [],
}: InfiniteHtmlCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef(pan);
  panRef.current = pan;
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const [isDraggingFrame, setIsDraggingFrame] = useState(false);
  const dragFrameRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number; duplicate: boolean; moved: boolean; ghostEl?: HTMLElement | null; snapDx: number; snapDy: number } | null>(null);

  // Multi-frame drag state (Phase 4)
  const multiDragRef = useRef<{ startX: number; startY: number; frames: { id: string; origX: number; origY: number }[]; duplicate: boolean; moved: boolean; ghostEls?: HTMLElement[] } | null>(null);

  // Orphan drag state
  const orphanDragRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);
  const [isDraggingOrphan, setIsDraggingOrphan] = useState(false);

  // Marquee selection state (Phase 3)
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // When set, the active marquee selects ELEMENTS inside this frame instead of frames.
  const elementMarqueeFrameRef = useRef<string | null>(null);

  // Alt-drag duplicate: dashed outline(s) marking where the originals stay
  // while the moved copy follows the cursor (real-time duplicate preview).
  const [dupPlaceholders, setDupPlaceholders] = useState<{ x: number; y: number; w: number; h: number }[] | null>(null);

  // Frame tool draw state — click places a default frame, drag sizes a custom one.
  // The ref mirrors the state so mouseup reads the latest rect even when React
  // hasn't re-rendered between mousemove and mouseup.
  const frameDrawStartRef = useRef<{ x: number; y: number } | null>(null);
  const frameDrawRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const [frameDrawRect, setFrameDrawRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Label rename state (Phase 1)
  const [renamingFrameId, setRenamingFrameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Smart guides during drag
  const [liveSmartGuides, setLiveSmartGuides] = useState<SmartGuide[]>([]);

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
        snapDx: 0,
        snapDy: 0,
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
      onSelectOrphan?.(null);
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
    // Drawing tools on empty canvas create independent root objects.
    const drawingTools = ["rect", "circle", "triangle", "star", "polygon", "text", "pen", "pencil"];
    if (drawingTools.includes(activeTool) && e.button === 0 && e.target === viewportRef.current) {
      // Start tracking for drag-to-size (same as frame tool), or create on click
      frameDrawStartRef.current = screenToCanvas(e.clientX, e.clientY);
      frameDrawRectRef.current = null;
      setFrameDrawRect(null);
      return;
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
      const dxPx = e.clientX - df.startX;
      const dyPx = e.clientY - df.startY;
      if (!df.moved && Math.hypot(dxPx, dyPx) < 3) return;
      if (!df.moved) {
        df.moved = true;
        const f = frames.find(fr => fr.id === df.id);
        if (df.duplicate && f) {
          // Leave a dashed outline where the original stays; the frame the
          // user drags reads as the moving duplicate.
          setDupPlaceholders([{ x: f.x, y: f.y, w: f.width, h: f.height }]);
        } else {
          // Plain drag selects the frame it moves.
          onSelectFrame(df.id);
        }
      }
      const dx = dxPx / zoom;
      const dy = dyPx / zoom;

      // ── Snap to guides + other frames' edges ──
      const dragFrame = frames.find(fr => fr.id === df.id);
      let snapDx = dx, snapDy = dy;
      if (dragFrame) {
        const liveX = df.origX + dx;
        const liveY = df.origY + dy;
        // Collect snap positions from user guides + other frame edges
        const xGuidePositions: number[] = [
          ...guides.filter(g => g.orientation === "v").map(g => g.position),
          ...frames.filter(fr => fr.id !== df.id).flatMap(fr => [fr.x, fr.x + fr.width, fr.x + fr.width / 2]),
        ];
        const yGuidePositions: number[] = [
          ...guides.filter(g => g.orientation === "h").map(g => g.position),
          ...frames.filter(fr => fr.id !== df.id).flatMap(fr => [fr.y, fr.y + fr.height, fr.y + fr.height / 2]),
        ];
        // Snap left edge, center, right edge
        const snappedLeft = snapToGuides(liveX, xGuidePositions);
        const snappedCenter = snapToGuides(liveX + dragFrame.width / 2, xGuidePositions);
        const snappedRight = snapToGuides(liveX + dragFrame.width, xGuidePositions);
        const snappedTop = snapToGuides(liveY, yGuidePositions);
        const snappedCenterY = snapToGuides(liveY + dragFrame.height / 2, yGuidePositions);
        const snappedBottom = snapToGuides(liveY + dragFrame.height, yGuidePositions);
        // Pick the best snap (whichever actually snapped)
        const snapCandidates = [
          { dx: snappedLeft - liveX, priority: 0 },
          { dx: snappedCenter - (liveX + dragFrame.width / 2), priority: 0 },
          { dx: snappedRight - (liveX + dragFrame.width), priority: 0 },
        ].filter(s => Math.abs(s.dx) > 0.1);
        if (snapCandidates.length > 0) {
          snapDx = dx + snapCandidates.sort((a, b) => Math.abs(a.dx) - Math.abs(b.dx))[0].dx;
        }
        const snapCandidatesY = [
          { dy: snappedTop - liveY },
          { dy: snappedCenterY - (liveY + dragFrame.height / 2) },
          { dy: snappedBottom - (liveY + dragFrame.height) },
        ].filter(s => Math.abs(s.dy) > 0.1);
        if (snapCandidatesY.length > 0) {
          snapDy = dy + snapCandidatesY.sort((a, b) => Math.abs(a.dy) - Math.abs(b.dy))[0].dy;
        }
      }

      const frameEl = document.querySelector(`[data-frame-id="${df.id}"]`) as HTMLElement;
      if (frameEl) frameEl.style.transform = `translate(${snapDx}px, ${snapDy}px)`;
      // Persist snap for mouseup commit
      df.snapDx = snapDx;
      df.snapDy = snapDy;

      // ── Compute smart guides (alignment + spacing) ──
      const liveX = df.origX + snapDx;
      const liveY = df.origY + snapDy;
      if (dragFrame) {
        const dragBounds: ElementBounds = { x: liveX, y: liveY, width: dragFrame.width, height: dragFrame.height };
        const others: ElementBounds[] = frames
          .filter(fr => fr.id !== df.id)
          .map(fr => ({ x: fr.x, y: fr.y, width: fr.width, height: fr.height }));
        const alignGuides = computeAlignmentGuides(dragBounds, others);
        const spacingGuides = computeSpacingGuides(dragBounds, others);
        setLiveSmartGuides([...alignGuides, ...spacingGuides]);
      }
      return;
    }
    // Multi-frame dragging (Phase 4)
    if (multiDragRef.current) {
      const md = multiDragRef.current;
      const dxPx = e.clientX - md.startX;
      const dyPx = e.clientY - md.startY;
      if (!md.moved && Math.hypot(dxPx, dyPx) < 3) return;
      if (!md.moved) {
        md.moved = true;
        if (md.duplicate) {
          setDupPlaceholders(md.frames.map(mf => {
            const f = frames.find(fr => fr.id === mf.id);
            return f ? { x: f.x, y: f.y, w: f.width, h: f.height } : { x: mf.origX, y: mf.origY, w: 0, h: 0 };
          }));
        }
      }
      const dx = dxPx / zoom;
      const dy = dyPx / zoom;
      for (const f of md.frames) {
        const el = document.querySelector(`[data-frame-id="${f.id}"]`) as HTMLElement;
        if (el) el.style.transform = `translate(${dx}px, ${dy}px)`;
      }
      return;
    }
    // Orphan dragging
    if (orphanDragRef.current) {
      const od = orphanDragRef.current;
      const dx = (e.clientX - od.startX) / zoom;
      const dy = (e.clientY - od.startY) / zoom;
      if (!od.moved && Math.hypot(dx, dy) < 3) return;
      od.moved = true;
      const el = document.querySelector(`[data-canvas-object-id="${od.id}"]`) as HTMLElement;
      if (el) el.style.transform = `translate(${dx}px, ${dy}px)`;
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
  }, [zoom, screenToCanvas, frames, onSelectFrame, guides]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    isPanning.current = false;
    setDupPlaceholders(null);
    // Single frame drag commit
    if (dragFrameRef.current) {
      const df = dragFrameRef.current;
      const frameEl = document.querySelector(`[data-frame-id="${df.id}"]`) as HTMLElement | null;
      if (frameEl) frameEl.style.transform = "";
      if (df.moved) {
        // Use snapped offsets if available (snap-to-guide), else raw
        const finalDx = df.snapDx;
        const finalDy = df.snapDy;
        if (df.duplicate) onDuplicateFrames?.([{ sourceId: df.id, x: Math.round(df.origX + finalDx), y: Math.round(df.origY + finalDy) }]);
        else onFrameMove?.(df.id, Math.round(df.origX + finalDx), Math.round(df.origY + finalDy));
      }
      dragFrameRef.current = null;
      setIsDraggingFrame(false);
      setLiveSmartGuides([]);
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
    // Orphan drag commit
    if (orphanDragRef.current) {
      const od = orphanDragRef.current;
      const dx = (e.clientX - od.startX) / zoom;
      const dy = (e.clientY - od.startY) / zoom;
      const el = document.querySelector(`[data-canvas-object-id="${od.id}"]`) as HTMLElement | null;
      if (el) el.style.transform = "";
      if (od.moved) onOrphanMove?.(od.id, Math.round(od.origX + dx), Math.round(od.origY + dy));
      orphanDragRef.current = null;
      setIsDraggingOrphan(false);
    }
    // Frame tool / drawing-tool auto-frame commit: drag = custom size, click = default
    if (frameDrawStartRef.current) {
      const start = frameDrawStartRef.current;
      frameDrawStartRef.current = null;
      const rect = frameDrawRectRef.current;
      frameDrawRectRef.current = null;
      setFrameDrawRect(null);
      const isDrawingTool = ["rect", "circle", "triangle", "star", "polygon", "text", "pen", "pencil"].includes(activeTool);
      if (rect && rect.w >= 4 && rect.h >= 4) {
        if (isDrawingTool) onCreateOrphanFromTool?.(activeTool, Math.round(rect.x), Math.round(rect.y), Math.max(20, Math.round(rect.w)), Math.max(20, Math.round(rect.h)));
        else onCreateFrame?.(Math.round(rect.x), Math.round(rect.y), Math.max(20, Math.round(rect.w)), Math.max(20, Math.round(rect.h)));
      } else {
        // Click (no drag): default-size orphan or frame
        if (isDrawingTool) onCreateOrphanFromTool?.(activeTool, Math.round(start.x), Math.round(start.y), 150, 150);
        else onCreateFrame?.(Math.round(start.x), Math.round(start.y), 100, 100);
      }
      return;
    }
    // Element-marquee commit: rubber-band over a frame body selects the
    // objects it touches (canvas coords → client coords → frame registry).
    if (elementMarqueeFrameRef.current) {
      const targetFrame = elementMarqueeFrameRef.current;
      elementMarqueeFrameRef.current = null;
      if (marqueeRect && (marqueeRect.w > 3 || marqueeRect.h > 3)) {
        const vp = viewportRef.current?.getBoundingClientRect();
        if (vp) {
          const p = panRef.current;
          const clientRect = {
            left: vp.left + p.x + marqueeRect.x * zoom,
            top: vp.top + p.y + marqueeRect.y * zoom,
            right: vp.left + p.x + (marqueeRect.x + marqueeRect.w) * zoom,
            bottom: vp.top + p.y + (marqueeRect.y + marqueeRect.h) * zoom,
          };
          frameMarqueeRegistry.get(targetFrame)?.(clientRect);
        }
      }
      marqueeStartRef.current = null;
      setMarqueeRect(null);
      return;
    }
    // Marquee selection commit (Phase 3) — AABB intersection
    if (marqueeStartRef.current && marqueeRect) {
      const frameIds = new Set<string>();
      // Frames
      for (const f of frames) {
        if (
          f.x < marqueeRect.x + marqueeRect.w &&
          f.x + f.width > marqueeRect.x &&
          f.y < marqueeRect.y + marqueeRect.h &&
          f.y + f.height > marqueeRect.y
        ) {
          frameIds.add(f.id);
        }
      }
      // Orphans — batch-collect all intersected IDs
      const orphanIds = new Set<string>();
      for (const obj of canvasObjects) {
        if (
          obj.x < marqueeRect.x + marqueeRect.w &&
          obj.x + obj.width > marqueeRect.x &&
          obj.y < marqueeRect.y + marqueeRect.h &&
          obj.y + obj.height > marqueeRect.y
        ) {
          orphanIds.add(obj.id);
        }
      }
      if (orphanIds.size > 0) onMarqueeSelectOrphans?.(orphanIds);
      else onSelectOrphan?.(null);
      if (frameIds.size > 0) onMarqueeSelect?.(frameIds);
      else onSelectFrame(null);
    }
    marqueeStartRef.current = null;
    setMarqueeRect(null);
  }, [zoom, onFrameMove, onMultiFrameMove, onDuplicateFrames, onMarqueeSelect, onMarqueeSelectOrphans, onCreateFrame, onCreateOrphanFromTool, activeTool, frames, canvasObjects, marqueeRect, frameDrawRect, onOrphanMove, onSelectOrphan, onRequestLayerSelect, onElementSelect, onSelectFrame]);

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

  // ── Orphan inline text editing ──
  // The orphan's html root becomes contenteditable in place; blur commits the
  // new markup back through onOrphanHtmlChange. Escape cancels, Enter+blur save.
  const editingOrphanRef = useRef<string | null>(null);
  const startOrphanTextEdit = useCallback((orphanId: string) => {
    const container = document.querySelector(`[data-canvas-object-id="${orphanId}"]`);
    const editable = container?.querySelector("[data-layer-id]") as HTMLElement | null;
    if (!editable || editingOrphanRef.current === orphanId) return;
    editingOrphanRef.current = orphanId;
    const originalText = editable.textContent || "";
    editable.setAttribute("contenteditable", "true");
    editable.style.outline = "2px solid #3B82F6";
    editable.style.outlineOffset = "2px";
    editable.style.cursor = "text";
    editable.style.minWidth = "20px";
    editable.style.minHeight = "1em";
    editable.focus();
    // Select all so typing replaces the placeholder immediately
    const range = document.createRange();
    range.selectNodeContents(editable);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    let cancelled = false;
    const cleanup = () => {
      editable.removeEventListener("blur", onBlur);
      editable.removeEventListener("keydown", onKey);
      editable.removeAttribute("contenteditable");
      editable.style.outline = "";
      editable.style.outlineOffset = "";
      editable.style.cursor = "";
      editingOrphanRef.current = null;
    };
    const onBlur = () => {
      if (cancelled) { editable.textContent = originalText; cleanup(); return; }
      cleanup();
      const wrapper = editable.closest("[data-canvas-object-id]");
      const htmlRoot = wrapper?.querySelector("[data-layer-id]");
      if (htmlRoot) onOrphanHtmlChange?.(orphanId, htmlRoot.outerHTML);
    };
    const onKey = (ke: KeyboardEvent) => {
      if (ke.key === "Escape") { cancelled = true; editable.blur(); }
      ke.stopPropagation(); // keep editor shortcuts out while typing
    };
    editable.addEventListener("blur", onBlur);
    editable.addEventListener("keydown", onKey);
  }, [onOrphanHtmlChange]);

  // Auto-edit a freshly created text orphan (the text tool flow).
  // The orphan node appears on a later render — retry briefly until it exists.
  useEffect(() => {
    if (!autoEditOrphanId) return;
    let tries = 0;
    const iv = window.setInterval(() => {
      const node = document.querySelector(`[data-canvas-object-id="${autoEditOrphanId}"] [data-layer-id]`);
      if (node || ++tries > 20) {
        window.clearInterval(iv);
        if (node) startOrphanTextEdit(autoEditOrphanId);
        onAutoEditOrphanHandled?.();
      }
    }, 50);
    return () => window.clearInterval(iv);
  }, [autoEditOrphanId, startOrphanTextEdit, onAutoEditOrphanHandled]);

  // ── Orphan mouse handlers ──
  const startOrphanDrag = useCallback((orphanId: string, e: React.MouseEvent) => {
    const obj = canvasObjects.find(o => o.id === orphanId);
    if (!obj) return;
    orphanDragRef.current = { id: orphanId, startX: e.clientX, startY: e.clientY, origX: obj.x, origY: obj.y, moved: false };
    setIsDraggingOrphan(true);
  }, [canvasObjects]);

  const handleOrphanMouseDown = useCallback((orphanId: string, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // While editing text inside this orphan, let the caret work normally.
    if (editingOrphanRef.current === orphanId || (e.target as HTMLElement).isContentEditable) return;
    e.stopPropagation();
    if (activeTool !== "select" && activeTool !== "hand") return;
    // Shift+click: toggle in/out of selection
    if (e.shiftKey) { onOrphanShiftClick?.(orphanId); return; }
    onSelectOrphan?.(orphanId);
    startOrphanDrag(orphanId, e);
  }, [activeTool, onSelectOrphan, onOrphanShiftClick, startOrphanDrag]);

  // Frame body mousedown.
  //
  // A frame is NEVER selected by a plain click on its body — only its NAME
  // selects it. A plain click resolves the topmost layer under the cursor
  // (see handleMouseUp). Dragging the body moves the frame (and selects it
  // once movement starts); Alt+drag duplicates. Shift+click toggles the
  // frame in the multi-selection; dragging an already-multi-selected frame
  // moves the whole group.
  const handleFrameMouseDown = useCallback((frameId: string, e: React.MouseEvent) => {
    if (activeTool !== "select" || e.button !== 0) return;
    // Don't intercept clicks in content mode — let Shadow DOM handle them
    if (contentFrameId === frameId) return;

    const layerId = frameHitTestRegistry.get(frameId)?.(e.clientX, e.clientY) ?? null;
    if (layerId) {
      onRequestLayerSelect?.(frameId, layerId, e.shiftKey);
      e.stopPropagation();
      return;
    }

    // Empty frame area: deselect and arm an ELEMENT marquee — dragging the
    // arrow tool over the frame body rubber-band-selects multiple objects.
    onSelectFrame(null);
    onElementSelect?.(null);
    elementMarqueeFrameRef.current = frameId;
    marqueeStartRef.current = screenToCanvas(e.clientX, e.clientY);
    setMarqueeRect(null);
    e.stopPropagation();
  }, [activeTool, contentFrameId, onRequestLayerSelect, onSelectFrame, onElementSelect, screenToCanvas]);

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
              isActive={selectedFrameIds.has(frame.id)}
              inMultiSelect={selectedFrameIds.has(frame.id) && selectedFrameIds.size > 1}
              contentMode={contentFrameId === frame.id}
              zoom={zoom}
              onActivate={onActivateFrame ?? onSelectFrame}
              onElementSelect={onElementSelect}
              selectionRequest={layerSelectionRequest?.frameId === frame.id ? layerSelectionRequest : null}
              selectedLayerId={selectedElement?.frameId === frame.id ? selectedElement.layerId : null}
              selectedLayerIds={selectedElement?.frameId === frame.id ? selectedLayerIds : []}
              onLayerSelectionChange={onLayerSelectionChange}
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

        {/* Canvas-level orphan objects (outside all frames) */}
        {canvasObjects.map(obj => {
          const isSelected = selectedOrphanIds.has(obj.id);
          return (
            <div
              key={obj.id}
              data-canvas-object-id={obj.id}
              onMouseDown={(e) => handleOrphanMouseDown(obj.id, e)}
              onDoubleClick={(e) => {
                if (obj.kind === "text") { e.stopPropagation(); startOrphanTextEdit(obj.id); }
              }}
              style={{
                position: "absolute",
                left: obj.x, top: obj.y,
                width: obj.width, height: obj.height,
                overflow: "visible",
                zIndex: obj.zIndex,
                cursor: isDraggingOrphan && orphanDragRef.current?.id === obj.id ? "grabbing" : isSelected ? "move" : "default",
              }}
            >
              <style>{obj.css}</style>
              <div dangerouslySetInnerHTML={{ __html: obj.html }} />
              {isSelected && (
                <div style={{
                  position: "absolute", inset: 0,
                  border: "2px solid #3B82F6",
                  borderRadius: 2, pointerEvents: "none",
                  boxShadow: "0 0 0 1px #3B82F6",
                }} />
              )}
            </div>
          );
        })}

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

        {/* Alt-drag duplicate: dashed outline where each original stays */}
        {dupPlaceholders?.map((p, i) => (
          <div key={`dup-${i}`} style={{
            position: "absolute",
            left: p.x, top: p.y, width: p.w, height: p.h,
            border: "2px dashed rgba(59,130,246,0.7)",
            background: "rgba(59,130,246,0.05)",
            pointerEvents: "none",
            zIndex: 9999,
          }} />
        ))}

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

      {/* ═══ Canvas Guides: rulers, guides, grid, smart guides ═══ */}
      <CanvasGuides
        pan={pan}
        zoom={zoom}
        guides={guides}
        onGuidesChange={onGuidesChange || (() => {})}
        showGrid={showGrid}
        gridSize={gridSize}
        showRulers={showRulers}
        columnConfig={columnConfig}
        columnFrameBounds={(() => {
          if (!columnConfig || selectedFrameIds.size !== 1) return null;
          const sf = frames.find(fr => selectedFrameIds.has(fr.id));
          return sf ? { x: sf.x, y: sf.y, width: sf.width, height: sf.height } : null;
        })()}
        smartGuides={[...smartGuides, ...liveSmartGuides]}
      />

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
