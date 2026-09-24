import { useRef, useState, useCallback, useEffect } from "react";
import { DesignFrame, frameHitTestRegistry, frameMarqueeRegistry, type FrameData, type HtmlCanvasObject, type LayerSelectionRequest, type LayerVisualGeometry, type SelectedElementInfo } from "./DesignFrame";
import { CanvasGuides, type Guide, type ColumnConfig, type SmartGuide } from "./CanvasGuides";
import { computeAlignmentGuides, computeSpacingGuides, snapToGuides, type ElementBounds } from "../lib/smartGuides";
import { isRoundableCanvasShape, resizeCanvasObjectBounds, rotationDegreesFromTransform, rotationFromPointer, type CanvasResizeDirection } from "../lib/canvasObjects";
import { getCssPropertyValue, setTransformFunction } from "../lib/cssMutations";
import type { BrushStroke } from "../../shared/maskBake.ts";

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

export type HtmlToolName = "select" | "hand" | "frame" | "rect" | "circle" | "triangle" | "star" | "polygon" | "text" | "text-path" | "pen" | "pen-plus" | "pen-minus" | "pen-edit" | "pencil" | "eraser" | "wand" | "eyedropper" | "paint-bucket" | "gradient";

/** F2 Varita: one SAM click prompt, normalized 0..1 over the image.
 *  neg = Alt+click (background/exclude). */
export interface WandClickPoint {
  x: number;
  y: number;
  neg: boolean;
}

/** One Supabase design_comments row, mapped for canvas rendering. */
export interface CanvasCommentPin {
  id: string;
  xPct: number;
  yPct: number;
  body: string;
  authorName: string;
  status: string;
  source: string;
  createdAt: string;
  kanbanTaskId?: string | null;
}

/** Where a comment was requested: design coords + raw client coords (the
 *  caller uses client coords to position its composer popover). */
export interface CanvasCommentRequest {
  world: { x: number; y: number };
  screen: { x: number; y: number };
}

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
  /** A drag carried these layers clear of their frame. */
  onLayerEscape?: (frameId: string, layerIds: string[], box: { x: number; y: number; width: number; height: number }, geometries?: Record<string, LayerVisualGeometry>) => void;
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
  /** F4 A2: global vertex-edit mode entered/exited for a layer in a frame. */
  onVertexEditModeChange?: (frameId: string, layerId: string | null) => void;
  onElementDelete?: (layerId: string) => void;
  onElementDuplicate?: (layerId: string) => void;
  // ── F4 Borrador ──
  /** One completed brush trail over an <img> layer (frame + image-local coords). */
  onBrushStroke?: (frameId: string, imageLayerId: string, stroke: BrushStroke) => void;
  /** Current brush diameter in px (toolbar / [ ] keys). */
  brushSize?: number;
  // ── F2 Varita ──
  /** Accumulated SAM click prompts over an <img> (normalized 0..1; Alt = neg). */
  onWandSegment?: (frameId: string, imageLayerId: string, src: string, points: WandClickPoint[]) => void;
  /** Image layer currently being segmented — drives the inline loader. */
  wandLoading?: string | null;
  onFrameResize?: (id: string, width: number, height: number, x: number, y: number) => void;
  /** Frame tool (F/A): click = default 100×100 frame, drag = custom size. */
  onCreateFrame?: (x: number, y: number, w: number, h: number) => void;
  /** Drawing tools on empty canvas create orphans instead of auto-frames. */
  onCreateOrphanFromTool?: (type: string, x: number, y: number, w: number, h: number) => void;
  /** Text tool drag that straddled/escaped its frame: the box becomes an orphan. */
  onCreateOrphanText?: (x: number, y: number, w: number, h: number) => void;
  /** Orphan selection */
  onSelectOrphan?: (id: string | null) => void;
  onOrphanShiftClick?: (id: string) => void;
  onOrphanMove?: (id: string, x: number, y: number) => void;
  onOrphanResize?: (id: string, width: number, height: number, x: number, y: number) => void;
  onOrphanRotate?: (id: string, degrees: number) => void;
  onOrphanRadiusChange?: (id: string, radius: number) => void;
  onDeleteOrphan?: (id: string) => void;
  /** Drop an orphan onto a frame (drag-end detection on canvas). */
  onOrphanDropToFrame?: (orphanId: string, targetFrameId: string) => void;
  /** Eyedropper: reports the sampled color (hex/rgb) when user clicks on canvas. */
  onEyedropperPick?: (color: string) => void;
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
  /** Reserved space (px) for currently-docked left/right panels, so the
   *  canvas — and the ruler measured from its own container — stops before
   *  a docked panel instead of rendering underneath it. See EditorV2's
   *  canvasLeftInset/canvasRightInset. */
  leftInset?: number;
  rightInset?: number;
  /** Icon panel drag-and-drop: resolves the drop point through the canvas's
   *  own pan/zoom transform (which EditorV2 doesn't have access to) and
   *  reports back frame-local coordinates when the drop lands inside a
   *  frame, or world coordinates for an orphan — the caller never needs to
   *  know about pan/zoom itself. */
  onIconDrop?: (payload: { library: string; name: string; style: string; color: string; size: number }, x: number, y: number, frameId: string | null) => void;
  // ── Comment pins (design_comments) ──
  /** Pins rendered inside the transform layer (they pan/zoom with the design). */
  comments?: CanvasCommentPin[];
  /** Desktop toggle: hide the pin layer while editing. */
  showComments?: boolean;
  /** Mobile comment tool: a single tap opens the composer instead of panning. */
  commentMode?: boolean;
  /** Design-space bounds the pct pins map onto (EditorV2 computes the bbox). */
  commentBounds?: { x: number; y: number; width: number; height: number } | null;
  /** Double-tap (touch) / double-click (desktop, empty canvas) / comment-mode tap. */
  onCommentRequest?: (req: CanvasCommentRequest) => void;
  /** A pin was tapped (after a drag it's suppressed) — canvas shows its popover. */
  onCommentPinClick?: (commentId: string) => void;
  /** Pin dragged to a new position (pct coords over commentBounds). */
  onCommentPinMove?: (commentId: string, xPct: number, yPct: number) => void;
  /** Popover CRUD — the owner edits/resolves/deletes/files the comment. */
  onCommentEdit?: (commentId: string, body: string) => void;
  onCommentResolve?: (commentId: string, status: "open" | "resolved") => void;
  onCommentDelete?: (commentId: string) => void;
  onCommentToKanban?: (commentId: string) => void;
}

const CANVAS_BG = "#1E1E1E";
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 5;

export function InfiniteHtmlCanvas({
  frames, canvasObjects, selectedFrameIds, selectedOrphanIds, contentFrameId, activeTool, zoom,
  onSelectFrame, onActivateFrame, onFrameShiftClick, onMarqueeSelect, onEnterContentMode,
  onZoomChange, onFrameMove, onMultiFrameMove, onDuplicateFrames, onRenameFrame,
  onElementSelect, onLayerEscape, onRequestLayerSelect, onFrameCssChange, onFrameHtmlChange,
  layerSelectionRequest, selectedElement, selectedLayerIds = [], onLayerSelectionChange,
  onAddPrimitive, onDrawShape, onTextChange, onAddTextBox, onAddPenPath, onAddTextPath, onEditPathPoints, onVertexEditModeChange, onElementDelete, onElementDuplicate,
  onBrushStroke, brushSize = 24,
  onWandSegment, wandLoading = null,
  onFrameResize, onCreateFrame, onCreateOrphanFromTool, onCreateOrphanText,
  onSelectOrphan, onOrphanShiftClick, onOrphanMove, onOrphanResize, onOrphanRotate, onOrphanRadiusChange, onOrphanDropToFrame, onDeleteOrphan, onMarqueeSelectOrphans, onEyedropperPick,
  onOrphanHtmlChange, autoEditOrphanId, onAutoEditOrphanHandled,
  autoEditLayerId, onAutoEditHandled,
  guides = [], onGuidesChange, showGrid = true, gridSize = 8, showRulers = true, columnConfig = null, smartGuides = [],
  leftInset = 0, rightInset = 0,
  onIconDrop,
  comments = [], showComments = true, commentMode = false, commentBounds = null,
  onCommentRequest, onCommentPinClick, onCommentPinMove,
  onCommentEdit, onCommentResolve, onCommentDelete, onCommentToKanban,
}: InfiniteHtmlCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef(pan);
  panRef.current = pan;
  // Mirror of the zoom prop: the wheel gesture reads refs instead of the
  // effect closure, so it never races the zoom buttons or zoom-to-fit.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const [isDraggingFrame, setIsDraggingFrame] = useState(false);
  const dragFrameRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number; duplicate: boolean; moved: boolean; ghostEl?: HTMLElement | null; snapDx: number; snapDy: number } | null>(null);

  // Multi-frame drag state (Phase 4)
  const multiDragRef = useRef<{ startX: number; startY: number; frames: { id: string; origX: number; origY: number }[]; duplicate: boolean; moved: boolean; ghostEls?: HTMLElement[] } | null>(null);

  // Orphan drag state
  const orphanDragRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);
  const orphanResizeRef = useRef<{
    id: string;
    direction: CanvasResizeDirection;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origWidth: number;
    origHeight: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const orphanRotateRef = useRef<{
    id: string;
    center: { x: number; y: number };
    startPointer: { x: number; y: number };
    initialDegrees: number;
    degrees: number;
    initialTransform: string;
  } | null>(null);
  const orphanRadiusRef = useRef<{
    id: string;
    startX: number;
    initialRadius: number;
    radius: number;
    maxRadius: number;
  } | null>(null);
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

  const ICON_DRAG_MIME = "application/x-futuraria-icon";
  const handleIconDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes(ICON_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);
  const handleIconDrop = useCallback((e: React.DragEvent) => {
    if (!onIconDrop || !e.dataTransfer?.types?.includes(ICON_DRAG_MIME)) return;
    const raw = e.dataTransfer.getData(ICON_DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    let payload: { library: string; name: string; style: string; color: string; size: number };
    try { payload = JSON.parse(raw); } catch { return; }
    const pt = screenToCanvas(e.clientX, e.clientY);
    // Topmost frame containing the drop point wins (last in array = drawn
    // last = on top, same convention the rest of this canvas uses).
    const target = [...frames].reverse().find(f =>
      pt.x >= f.x && pt.x <= f.x + f.width && pt.y >= f.y && pt.y <= f.y + f.height
    );
    if (target) {
      onIconDrop(payload, pt.x - target.x - payload.size / 2, pt.y - target.y - payload.size / 2, target.id);
    } else {
      onIconDrop(payload, pt.x - payload.size / 2, pt.y - payload.size / 2, null);
    }
  }, [frames, onIconDrop, screenToCanvas]);

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
    // Eyedropper: sample pixel color from any element under cursor
    if (activeTool === "eyedropper" && e.button === 0) {
      let el = document.elementFromPoint(e.clientX, e.clientY);
      // Traverse into Shadow DOM (frame content) if present
      while (el?.shadowRoot) {
        const inner = el.shadowRoot.elementFromPoint(e.clientX, e.clientY);
        if (!inner || inner === el) break;
        el = inner;
      }
      if (el) {
        const styles = window.getComputedStyle(el);
        const bg = styles.backgroundColor;
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
          onEyedropperPick?.(bg);
        }
      }
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
    if (orphanRotateRef.current) {
      const rotation = orphanRotateRef.current;
      rotation.degrees = rotationFromPointer(
        rotation.center,
        rotation.startPointer,
        { x: e.clientX, y: e.clientY },
        rotation.initialDegrees,
      );
      const controls = document.querySelector(`[data-canvas-object-controls="${rotation.id}"]`) as HTMLElement | null;
      if (controls) controls.style.transform = `rotate(${rotation.degrees}deg)`;
      const root = document.querySelector(`[data-canvas-object-id="${rotation.id}"] [data-layer-id="${rotation.id}"]`) as HTMLElement | null;
      if (root) root.style.transform = setTransformFunction(rotation.initialTransform, "rotate", `${rotation.degrees}deg`);
      return;
    }
    if (orphanRadiusRef.current) {
      const radius = orphanRadiusRef.current;
      radius.radius = Math.max(0, Math.min(radius.maxRadius, radius.initialRadius + (e.clientX - radius.startX) / zoom));
      const root = document.querySelector(`[data-canvas-object-id="${radius.id}"] [data-layer-id="${radius.id}"]`) as HTMLElement | null;
      if (root) root.style.borderRadius = `${radius.radius}px`;
      return;
    }
    // Root-object resize. Preview the wrapper directly for a fluid drag; the
    // owner commits both geometry and matching root CSS on mouseup.
    if (orphanResizeRef.current) {
      const resize = orphanResizeRef.current;
      const dx = (e.clientX - resize.startX) / zoom;
      const dy = (e.clientY - resize.startY) / zoom;
      const { x, y, width, height } = resizeCanvasObjectBounds({
        x: resize.origX,
        y: resize.origY,
        width: resize.origWidth,
        height: resize.origHeight,
      }, resize.direction, dx, dy);
      Object.assign(resize, { x, y, width, height });
      const el = document.querySelector(`[data-canvas-object-id="${resize.id}"]`) as HTMLElement | null;
      if (el) {
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.width = `${width}px`;
        el.style.height = `${height}px`;
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
    if (orphanRotateRef.current) {
      const rotation = orphanRotateRef.current;
      const root = document.querySelector(`[data-canvas-object-id="${rotation.id}"] [data-layer-id="${rotation.id}"]`) as HTMLElement | null;
      if (root) root.style.transform = "";
      onOrphanRotate?.(rotation.id, Math.round(rotation.degrees * 10) / 10);
      orphanRotateRef.current = null;
      return;
    }
    if (orphanRadiusRef.current) {
      const radius = orphanRadiusRef.current;
      const root = document.querySelector(`[data-canvas-object-id="${radius.id}"] [data-layer-id="${radius.id}"]`) as HTMLElement | null;
      if (root) root.style.borderRadius = "";
      onOrphanRadiusChange?.(radius.id, Math.round(radius.radius));
      orphanRadiusRef.current = null;
      return;
    }
    if (orphanResizeRef.current) {
      const resize = orphanResizeRef.current;
      onOrphanResize?.(
        resize.id,
        Math.round(resize.width),
        Math.round(resize.height),
        Math.round(resize.x),
        Math.round(resize.y),
      );
      orphanResizeRef.current = null;
      return;
    }
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
      const el = document.querySelector(`[data-canvas-object-id="${od.id}"]`) as HTMLElement | null;
      if (el) el.style.transform = "";
      if (od.moved) {
        // Check if the orphan was dropped over a frame body
        let targetFrameId: string | null = null;
        let hitEl = document.elementFromPoint(e.clientX, e.clientY);
        // Traverse through Shadow DOM to find the DesignFrame content
        while (hitEl) {
          if (hitEl instanceof HTMLElement) {
            const frameWrapper = hitEl.closest("[data-frame-id]") as HTMLElement | null;
            if (frameWrapper) {
              targetFrameId = frameWrapper.dataset.frameId || null;
              break;
            }
          }
          if (hitEl instanceof ShadowRoot) {
            hitEl = hitEl.elementFromPoint(e.clientX, e.clientY) || hitEl.host;
          } else if ((hitEl as Element).shadowRoot) {
            hitEl = (hitEl as Element).shadowRoot!.elementFromPoint(e.clientX, e.clientY) || hitEl;
          } else {
            hitEl = (hitEl as Element).parentElement;
          }
        }
        if (targetFrameId && onOrphanDropToFrame) {
          onOrphanDropToFrame(od.id, targetFrameId);
        } else {
          const dx = (e.clientX - od.startX) / zoom;
          const dy = (e.clientY - od.startY) / zoom;
          onOrphanMove?.(od.id, Math.round(od.origX + dx), Math.round(od.origY + dy));
        }
      }
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
        // Click (no drag): default-size orphan or frame. Text passes 0,0 so
        // the handler can tell click (auto-width) from a drawn box.
        if (isDrawingTool) onCreateOrphanFromTool?.(activeTool, Math.round(start.x), Math.round(start.y), 0, 0);
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
  }, [zoom, onFrameMove, onMultiFrameMove, onDuplicateFrames, onMarqueeSelect, onMarqueeSelectOrphans, onCreateFrame, onCreateOrphanFromTool, activeTool, frames, canvasObjects, marqueeRect, frameDrawRect, onOrphanMove, onOrphanResize, onOrphanRotate, onOrphanRadiusChange, onSelectOrphan, onRequestLayerSelect, onElementSelect, onSelectFrame]);

  // ── Trackpad gestures: pinch = zoom, two-finger scroll = pan ──
  // The browser reports a trackpad pinch as ctrl+wheel; a two-finger scroll
  // is a plain wheel carrying deltaX/deltaY. Neither touches activeTool —
  // they are intercepted here, at the viewport, so the pen, the rect or any
  // other tool stays exactly as it was (Figma behaviour). Wheel events
  // arrive faster than frames, so they accumulate into gesture-local
  // targets and one requestAnimationFrame commits them per frame; refs
  // instead of the closure kill the stale-zoom jumps of the previous
  // handler, and the listener now subscribes once instead of on every zoom
  // change. Must stay non-passive: preventDefault is what stops the
  // browser's own ctrl+wheel page zoom and the overscroll gesture.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    let raf = 0;
    let panDirty = false;
    let zoomDirty = false;
    let lastWheelAt = 0;
    // Gesture-local targets: consecutive wheel events accumulate here and
    // the flush commits them once per frame.
    let nextZoom = zoomRef.current;
    let nextPan = panRef.current;

    const flush = () => {
      raf = 0;
      if (panDirty) { panDirty = false; setPan(nextPan); }
      if (zoomDirty) {
        zoomDirty = false;
        onZoomChange(Math.round(nextZoom * 1000) / 1000);
      }
    };

    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const now = performance.now();
      // First event of a gesture: re-sync with React state in case zoom or
      // pan moved elsewhere meanwhile (buttons, zoom-to-fit, hand drag).
      if (now - lastWheelAt > 150) {
        nextZoom = zoomRef.current;
        nextPan = panRef.current;
      }
      lastWheelAt = now;
      // A notched mouse wheel reports lines/pages; a trackpad reports pixels.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      if (e.ctrlKey || e.metaKey) {
        // Pinch: exponential steps feel equal at every zoom level (a notch
        // of a physical wheel is capped so one click can't blow past the
        // whole range), and the world point under the fingers stays pinned
        // to the fingers.
        const dy = Math.max(-30, Math.min(30, e.deltaY * unit));
        const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom * Math.exp(-dy * 0.007)));
        const rect = el.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        nextPan = {
          x: cx - (cx - nextPan.x) * (target / nextZoom),
          y: cy - (cy - nextPan.y) * (target / nextZoom),
        };
        nextZoom = target;
        panDirty = true;
        zoomDirty = true;
      } else {
        // Two-finger scroll pans the canvas 1:1 — the hand tool without
        // switching to the hand tool.
        nextPan = { x: nextPan.x - e.deltaX * unit, y: nextPan.y - e.deltaY * unit };
        panDirty = true;
      }
      if (!raf) raf = requestAnimationFrame(flush);
    };

    el.addEventListener("wheel", handler, { passive: false });
    return () => {
      el.removeEventListener("wheel", handler);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [onZoomChange]);

  // ChatFAB's editor_pan lands here: the same setPan the two-finger scroll
  // commits, so the AI pans the canvas exactly like the human's fingers —
  // viewport-only, the active tool never notices.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string; dx?: number; dy?: number }>).detail;
      if (!detail || detail.type !== "pan") return;
      const p = panRef.current;
      setPan({ x: p.x + (Number(detail.dx) || 0), y: p.y + (Number(detail.dy) || 0) });
    };
    window.addEventListener("futuraria:editor-viewport", handler);
    return () => window.removeEventListener("futuraria:editor-viewport", handler);
  }, []);

  // ── Touch: 1 finger pans, 2 fingers pinch-zoom, double-tap comments ──
  // Native listeners with { passive: false } — preventDefault on touchstart
  // stops page scroll/bounce AND suppresses the synthesized mouse events, so
  // mobile gets exactly three gestures and nothing else competes with them.
  const touchStateRef = useRef<{
    mode: "none" | "pan" | "pinch";
    startX: number; startY: number;
    lastX: number; lastY: number;
    moved: boolean;
    pinchDist0: number;
    pinchMidX: number; pinchMidY: number;
    zoom0: number;
    pan0: { x: number; y: number };
  }>({ mode: "none", startX: 0, startY: 0, lastX: 0, lastY: 0, moved: false, pinchDist0: 0, pinchMidX: 0, pinchMidY: 0, zoom0: 1, pan0: { x: 0, y: 0 } });
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      // Pins (and their popover) own their gestures — dragging a pin with a
      // finger or typing in the popover must not start a pan. Skipping
      // preventDefault here keeps the compatibility click for a plain tap.
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("[data-comment-pin-id], .editor-v2-comment-popover")) return;
      e.preventDefault();
      const s = touchStateRef.current;
      if (e.touches.length >= 2) {
        const a = e.touches[0];
        const b = e.touches[1];
        s.mode = "pinch";
        s.pinchDist0 = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
        s.pinchMidX = (a.clientX + b.clientX) / 2;
        s.pinchMidY = (a.clientY + b.clientY) / 2;
        s.zoom0 = zoom;
        s.pan0 = { ...panRef.current };
        return;
      }
      const t = e.touches[0];
      s.mode = "pan";
      s.startX = t.clientX;
      s.startY = t.clientY;
      s.lastX = t.clientX;
      s.lastY = t.clientY;
      s.moved = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      const s = touchStateRef.current;
      // A touch that started on a pin or its popover never entered pan/pinch
      // mode — leave the gesture alone so the browser still delivers the
      // compatibility click for a plain tap (canceling touchmove here would
      // swallow it and the popover would never open on mobile).
      if (s.mode === "none") return;
      e.preventDefault();
      if (s.mode === "pinch" && e.touches.length >= 2) {
        const a = e.touches[0];
        const b = e.touches[1];
        const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
        if (s.pinchDist0 > 0 && dist > 0) {
          const newZoom = Math.min(Math.max(s.zoom0 * (dist / s.pinchDist0), MIN_ZOOM), MAX_ZOOM);
          const rect = el.getBoundingClientRect();
          const cx = s.pinchMidX - rect.left;
          const cy = s.pinchMidY - rect.top;
          setPan({
            x: cx - (cx - s.pan0.x) * (newZoom / s.zoom0),
            y: cy - (cy - s.pan0.y) * (newZoom / s.zoom0),
          });
          onZoomChange(Math.round(newZoom * 1000) / 1000);
        }
        return;
      }
      if (s.mode === "pan" && e.touches.length === 1) {
        const t = e.touches[0];
        const dx = t.clientX - s.lastX;
        const dy = t.clientY - s.lastY;
        s.lastX = t.clientX;
        s.lastY = t.clientY;
        if (Math.abs(t.clientX - s.startX) + Math.abs(t.clientY - s.startY) > 8) s.moved = true;
        setPan(p => ({ x: p.x + dx, y: p.y + dy }));
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      const s = touchStateRef.current;
      // Pinch collapsed back to one finger → restart pan from its position
      // (no jump: panning is delta-based, the stored point only matters for
      // tap detection).
      if (s.mode === "pinch" && e.touches.length === 1) {
        const t = e.touches[0];
        s.mode = "pan";
        s.startX = t.clientX;
        s.startY = t.clientY;
        s.lastX = t.clientX;
        s.lastY = t.clientY;
        s.moved = false;
        return;
      }
      if (e.touches.length > 0) return;
      const wasPan = s.mode === "pan";
      s.mode = "none";
      if (!wasPan || s.moved || !onCommentRequest) return;
      // Tap: double-tap (same point, ≤300ms) or single tap in comment mode.
      const now = Date.now();
      const prev = lastTapRef.current;
      lastTapRef.current = { time: now, x: s.startX, y: s.startY };
      const isDoubleTap = !!prev && now - prev.time <= 300 && Math.hypot(s.startX - prev.x, s.startY - prev.y) <= 30;
      if (isDoubleTap || commentMode) {
        const pt = screenToCanvas(s.startX, s.startY);
        onCommentRequest({ world: pt, screen: { x: s.startX, y: s.startY } });
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [zoom, commentMode, onCommentRequest, screenToCanvas, onZoomChange]);

  // ── Comment pins: drag with a finger (or mouse) ──
  // Pointer events unify both inputs; the delta is divided by zoom so the
  // pin tracks the finger in design space. pointerup commits the new
  // position via onCommentPinMove and arms a one-shot click suppression so
  // the popover doesn't open right after a drag.
  const pinDragRef = useRef<{ id: string; startClientX: number; startClientY: number; worldX: number; worldY: number; moved: boolean } | null>(null);
  const [pinDragPos, setPinDragPos] = useState<{ id: string; x: number; y: number } | null>(null);
  const suppressPinClickRef = useRef(false);

  const startPinDrag = useCallback((e: React.PointerEvent, pin: CanvasCommentPin) => {
    // stopPropagation keeps the canvas pan from starting. Deliberately NO
    // preventDefault: canceling pointerdown suppresses the compatibility
    // click on touch, which would break tap-to-open. The pin's own
    // touchAction:none stops the browser from scrolling the gesture away.
    e.stopPropagation();
    if (!commentBounds) return;
    pinDragRef.current = {
      id: pin.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      worldX: commentBounds.x + (pin.xPct / 100) * commentBounds.width,
      worldY: commentBounds.y + (pin.yPct / 100) * commentBounds.height,
      moved: false,
    };
    setPinDragPos({ id: pin.id, x: pinDragRef.current.worldX, y: pinDragRef.current.worldY });
    suppressPinClickRef.current = false;
    setActivePinId(null); // dragging closes the popover
  }, [commentBounds]);

  useEffect(() => {
    if (!pinDragPos) return;
    const onMove = (e: PointerEvent) => {
      const d = pinDragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startClientX;
      const dy = e.clientY - d.startClientY;
      if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
      setPinDragPos({ id: d.id, x: d.worldX + dx / zoom, y: d.worldY + dy / zoom });
    };
    const onUp = (e: PointerEvent) => {
      const d = pinDragRef.current;
      pinDragRef.current = null;
      setPinDragPos(null);
      if (!d || !commentBounds) return;
      const dx = e.clientX - d.startClientX;
      const dy = e.clientY - d.startClientY;
      if (!d.moved) return; // a plain tap — let click open the popover
      suppressPinClickRef.current = true;
      const worldX = d.worldX + dx / zoom;
      const worldY = d.worldY + dy / zoom;
      const xPct = Math.max(0, Math.min(100, ((worldX - commentBounds.x) / commentBounds.width) * 100));
      const yPct = Math.max(0, Math.min(100, ((worldY - commentBounds.y) / commentBounds.height) * 100));
      onCommentPinMove?.(d.id, Math.round(xPct), Math.round(yPct));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [pinDragPos, zoom, commentBounds, onCommentPinMove]);

  // ── Comment pin popover (tap a pin → read it, edit, resolve, delete,
  //    file to Kanban). activePinId stores the id so the card re-reads the
  //    live row from `comments` after every CRUD op (deleted = closes). ──
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState<string | null>(null);
  const activePin = activePinId ? comments.find(c => c.id === activePinId) || null : null;
  useEffect(() => { setEditingBody(null); }, [activePinId]);

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

  const startOrphanResize = useCallback((
    orphanId: string,
    direction: CanvasResizeDirection,
    e: React.MouseEvent,
  ) => {
    if (e.button !== 0) return;
    const object = canvasObjects.find(item => item.id === orphanId);
    if (!object) return;
    e.preventDefault();
    e.stopPropagation();
    orphanDragRef.current = null;
    orphanResizeRef.current = {
      id: object.id,
      direction,
      startX: e.clientX,
      startY: e.clientY,
      origX: object.x,
      origY: object.y,
      origWidth: object.width,
      origHeight: object.height,
      x: object.x,
      y: object.y,
      width: object.width,
      height: object.height,
    };
  }, [canvasObjects]);

  const startOrphanRotate = useCallback((orphanId: string, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const object = canvasObjects.find(item => item.id === orphanId);
    const wrapper = document.querySelector(`[data-canvas-object-id="${orphanId}"]`) as HTMLElement | null;
    if (!object || !wrapper) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = wrapper.getBoundingClientRect();
    const initialTransform = getCssPropertyValue(object.css, `[data-layer-id="${object.id}"]`, "transform");
    orphanRotateRef.current = {
      id: object.id,
      center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      startPointer: { x: e.clientX, y: e.clientY },
      initialDegrees: rotationDegreesFromTransform(initialTransform),
      degrees: rotationDegreesFromTransform(initialTransform),
      initialTransform,
    };
  }, [canvasObjects]);

  const startOrphanRadius = useCallback((orphanId: string, initialRadius: number, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const object = canvasObjects.find(item => item.id === orphanId);
    if (!object) return;
    e.preventDefault();
    e.stopPropagation();
    orphanRadiusRef.current = {
      id: object.id,
      startX: e.clientX,
      initialRadius,
      radius: initialRadius,
      maxRadius: Math.min(object.width, object.height) / 2,
    };
  }, [canvasObjects]);

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
      data-testid="editor-canvas-viewport"
      style={{
        width: leftInset || rightInset ? `calc(100% - ${leftInset + rightInset}px)` : "100%",
        marginLeft: leftInset || undefined,
        height: "100%",
        overflow: "hidden", position: "relative",
        background: CANVAS_BG,
        cursor,
        transition: "margin-left 0.15s ease, width 0.15s ease",
        touchAction: "none",
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDragOver={handleIconDragOver}
      onDrop={handleIconDrop}
      onDoubleClick={(e) => {
        // Desktop mirror of the mobile double-tap: double-click the empty
        // canvas (not a frame, not an orphan) to leave a comment there.
        if (e.target !== viewportRef.current || !onCommentRequest) return;
        const pt = screenToCanvas(e.clientX, e.clientY);
        onCommentRequest({ world: pt, screen: { x: e.clientX, y: e.clientY } });
      }}
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
              onLayerEscape={(layerIds, box, geometries) => onLayerEscape?.(frame.id, layerIds, box, geometries)}
              onCreateOrphanText={onCreateOrphanText}
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
              onVertexEditModeChange={(layerId) => onVertexEditModeChange?.(frame.id, layerId)}
              onElementDelete={onElementDelete}
              onElementDuplicate={onElementDuplicate}
              onBrushStroke={(imageLayerId, stroke) => onBrushStroke?.(frame.id, imageLayerId, stroke)}
              brushSize={brushSize}
              onWandSegment={(imageLayerId, src, points) => onWandSegment?.(frame.id, imageLayerId, src, points)}
              wandLoading={wandLoading}
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
          const selector = `[data-layer-id="${obj.id}"]`;
          const transform = getCssPropertyValue(obj.css, selector, "transform");
          const rotation = rotationDegreesFromTransform(transform);
          const radiusValue = getCssPropertyValue(obj.css, selector, "border-radius");
          const radius = /^\d+(?:\.\d+)?px$/i.test(radiusValue.trim()) ? parseFloat(radiusValue) : 0;
          const canRound = isRoundableCanvasShape(obj.kind, obj.html, radiusValue);
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
                <div
                  data-canvas-object-controls={obj.id}
                  style={{
                    position: "absolute",
                    inset: 0,
                    pointerEvents: "none",
                    transform: `rotate(${rotation}deg)`,
                    transformOrigin: "center",
                  }}
                >
                  <div style={{
                    position: "absolute", inset: 0,
                    border: `${2 / zoom}px solid #3B82F6`,
                    borderRadius: 2, pointerEvents: "none",
                  }} />
                  {selectedOrphanIds.size === 1 && ([
                    ["nw", "0%", "0%"], ["n", "50%", "0%"], ["ne", "100%", "0%"],
                    ["e", "100%", "50%"], ["se", "100%", "100%"], ["s", "50%", "100%"],
                    ["sw", "0%", "100%"], ["w", "0%", "50%"],
                  ] as const).map(([direction, left, top]) => (
                    <button
                      key={direction}
                      type="button"
                      aria-label={`Redimensionar objeto hacia ${direction}`}
                      onMouseDown={event => startOrphanResize(obj.id, direction, event)}
                      onClick={event => event.stopPropagation()}
                      style={{
                        position: "absolute",
                        left,
                        top,
                        width: 8 / zoom,
                        height: 8 / zoom,
                        minWidth: 0,
                        minHeight: 0,
                        padding: 0,
                        border: `${1 / zoom}px solid #3B82F6`,
                        borderRadius: 1,
                        background: "#FFFFFF",
                        transform: "translate(-50%, -50%)",
                        cursor: `${direction}-resize`,
                        zIndex: 2,
                        pointerEvents: "auto",
                      }}
                    />
                  ))}
                  {selectedOrphanIds.size === 1 && (
                    <>
                      <div style={{
                        position: "absolute",
                        left: "50%",
                        top: -28 / zoom,
                        height: 28 / zoom,
                        borderLeft: `${1 / zoom}px solid #3B82F6`,
                        pointerEvents: "none",
                      }} />
                      <button
                        type="button"
                        aria-label="Rotar objeto"
                        onMouseDown={event => startOrphanRotate(obj.id, event)}
                        onClick={event => event.stopPropagation()}
                        style={{
                          position: "absolute",
                          left: "50%",
                          top: -32 / zoom,
                          width: 10 / zoom,
                          height: 10 / zoom,
                          minWidth: 0,
                          minHeight: 0,
                          padding: 0,
                          border: `${1 / zoom}px solid #3B82F6`,
                          borderRadius: "50%",
                          background: "#FFFFFF",
                          transform: "translate(-50%, -50%)",
                          cursor: "grab",
                          pointerEvents: "auto",
                        }}
                      />
                      {canRound && (
                        <button
                          type="button"
                          aria-label="Redondear esquinas"
                          onMouseDown={event => startOrphanRadius(obj.id, radius, event)}
                          onClick={event => event.stopPropagation()}
                          style={{
                            position: "absolute",
                            left: Math.min(Math.max(radius, 12 / zoom), obj.width / 2),
                            top: 12 / zoom,
                            width: 9 / zoom,
                            height: 9 / zoom,
                            minWidth: 0,
                            minHeight: 0,
                            padding: 0,
                            border: `${1 / zoom}px solid #3B82F6`,
                            borderRadius: "50%",
                            background: "#3B82F6",
                            transform: "translate(-50%, -50%)",
                            cursor: "ew-resize",
                            pointerEvents: "auto",
                          }}
                        />
                      )}
                    </>
                  )}
                </div>
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

        {/* Comment pins (design_comments) — live inside the transform layer so
            they pan/zoom with the design; inverse-scaled so they keep a
            constant on-screen size at any zoom. Draggable with a finger or
            the mouse; a tap opens the popover with the full comment + CRUD. */}
        {showComments && comments.length > 0 && commentBounds && comments.map((pin) => {
          const dragging = pinDragPos?.id === pin.id;
          const x = dragging ? pinDragPos!.x : commentBounds.x + (pin.xPct / 100) * commentBounds.width;
          const y = dragging ? pinDragPos!.y : commentBounds.y + (pin.yPct / 100) * commentBounds.height;
          const resolved = pin.status !== "open";
          return (
            <div
              key={pin.id}
              data-comment-pin-id={pin.id}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => startPinDrag(e, pin)}
              onClick={(e) => {
                e.stopPropagation();
                if (suppressPinClickRef.current) { suppressPinClickRef.current = false; return; }
                onCommentPinClick?.(pin.id);
                setActivePinId(prev => prev === pin.id ? null : pin.id);
              }}
              title={`${pin.authorName}: ${pin.body.slice(0, 60)}`}
              style={{
                position: "absolute",
                left: x, top: y,
                transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                transformOrigin: "center",
                width: 24, height: 24,
                borderRadius: "50%",
                background: resolved ? "#9CA3AF" : pin.source === "editor_pin" ? "#3B82F6" : "#F59E0B",
                border: "2px solid #fff",
                boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#fff", fontSize: 12, fontWeight: 700,
                cursor: dragging ? "grabbing" : "grab",
                touchAction: "none",
                userSelect: "none",
                zIndex: 11000,
              }}
            >
              •
            </div>
          );
        })}

        {/* Pin popover — anchored to the pin in design space, inverse-scaled
            to a constant on-screen size. Reads the live row from `comments`,
            so every CRUD action re-renders it (and deletes close it). */}
        {activePin && commentBounds && (
          <div
            className="editor-v2-comment-popover"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              left: commentBounds.x + (activePin.xPct / 100) * commentBounds.width,
              top: commentBounds.y + (activePin.yPct / 100) * commentBounds.height,
              transform: `scale(${1 / zoom})`,
              transformOrigin: "left top",
              zIndex: 11001,
            }}
          >
            <div
              style={{
                marginLeft: 22, marginTop: -10,
                width: 230,
                padding: 10,
                borderRadius: 12,
                background: "rgba(15,15,20,0.97)",
                border: "1px solid rgba(255,255,255,0.14)",
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                fontFamily: "Inter, system-ui, sans-serif",
                color: "#e0e0e0",
                fontSize: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                <strong style={{ fontSize: 11 }}>{activePin.authorName || "Invitado"}</strong>
                <span style={{ fontSize: 10, color: "#7a7668" }}>
                  {activePin.createdAt ? new Date(activePin.createdAt).toLocaleDateString("es", { day: "numeric", month: "short" }) : ""}
                  {activePin.source === "editor_pin" ? " · editor" : " · invitado"}
                </span>
                <button
                  type="button"
                  onClick={() => setActivePinId(null)}
                  aria-label="Cerrar"
                  style={{ marginLeft: "auto", background: "none", border: "none", color: "#999", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 2 }}
                >
                  ×
                </button>
              </div>
              {editingBody === null ? (
                <p style={{ margin: "0 0 8px", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{activePin.body}</p>
              ) : (
                <textarea
                  autoFocus
                  value={editingBody}
                  onChange={(e) => setEditingBody(e.target.value)}
                  rows={3}
                  maxLength={500}
                  style={{
                    width: "100%", boxSizing: "border-box", padding: "6px 8px", marginBottom: 6,
                    borderRadius: 8, border: "1px solid rgba(200,184,152,0.5)",
                    background: "rgba(255,255,255,0.05)", color: "#e0e0e0",
                    fontSize: 12, fontFamily: "inherit", lineHeight: 1.5, resize: "none", outline: "none",
                  }}
                />
              )}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {editingBody === null ? (
                  <>
                    <button type="button" onClick={() => setEditingBody(activePin.body)}
                      style={pinPopBtn("rgba(255,255,255,0.1)", "#c8b898")}>
                      Editar
                    </button>
                    <button type="button"
                      onClick={() => onCommentResolve?.(activePin.id, activePin.status === "open" ? "resolved" : "open")}
                      style={pinPopBtn("rgba(255,255,255,0.1)", "#9ca3af")}>
                      {activePin.status === "open" ? "Resolver" : "Reabrir"}
                    </button>
                    <button type="button"
                      disabled={!!activePin.kanbanTaskId}
                      onClick={() => onCommentToKanban?.(activePin.id)}
                      title={activePin.kanbanTaskId ? "Ya está en el Kanban" : "Crea una tarea en el Kanban con este comentario"}
                      style={pinPopBtn("rgba(59,130,246,0.4)", activePin.kanbanTaskId ? "#6b7280" : "#60a5fa")}>
                      {activePin.kanbanTaskId ? "En Kanban" : "Al Kanban"}
                    </button>
                    <button type="button"
                      onClick={() => { onCommentDelete?.(activePin.id); setActivePinId(null); }}
                      style={pinPopBtn("rgba(239,68,68,0.3)", "#f87171")}>
                      Eliminar
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button"
                      onClick={() => { if (editingBody.trim()) onCommentEdit?.(activePin.id, editingBody.trim()); setEditingBody(null); }}
                      style={pinPopBtn("rgba(200,184,152,0.3)", "#c8b898")}>
                      Guardar
                    </button>
                    <button type="button"
                      onClick={() => setEditingBody(null)}
                      style={pinPopBtn("rgba(255,255,255,0.1)", "#9ca3af")}>
                      Cancelar
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
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

      {/* Zoom + selection badge — bottom-left per user request */}
      <div style={{
        position: "absolute", bottom: 12, left: 12,
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

/** Shared styling for the pin popover's small action buttons. */
function pinPopBtn(border: string, color: string): React.CSSProperties {
  return {
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 6,
    border: `1px solid ${border}`,
    background: "transparent",
    color,
    cursor: "pointer",
  };
}
