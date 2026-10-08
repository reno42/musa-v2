import { useRef, useEffect, useCallback, useState } from "react";
import type { HtmlToolName, WandClickPoint } from "./InfiniteHtmlCanvas";
import {
  cloneLayerCss,
  getCssPropertyValue,
  removeTransformFunction,
  setTransformFunction,
  updateCssProperties as mutateCssProperties,
} from "../lib/cssMutations";
import { createLayerId, duplicateLayerInHtml, ensureLayerIds } from "../lib/htmlMutations";
import { mapBodySelectors } from "../lib/frameCapture";
import { ensureDesignFontImports, sanitizeGoogleFontUrl } from "../lib/googleFonts";
import { pickTopmostByBounds } from "../lib/selectionModel";
import { reconcileFrameHtml } from "../lib/frameReconciler";
import { applyRichTextStyle, frameRichTextRegistry, MIXED_TEXT_STYLE, summarizeRichTextStyles } from "../lib/richText";
import {
  computeInkBounds,
  createSmoothPoint,
  deletePoint as deletePathPoint,
  findClosestPathSegment,
  fitPathBox,
  isPathClosed,
  movePathHandle,
  movePathPoint,
  parsePathData,
  serializePathData,
  splitPathSegment,
  toggleSmoothCorner,
  type PathPoint,
  type Point,
} from "../lib/pathData";
import {
  cornersFromShapePath,
  parametricVertices,
  parseVertexRadiiAttr,
  serializeVertexRadiiAttr,
  verticesToPath,
  type ShapeVertex,
} from "../lib/shapePaths";
import {
  bboxCorners,
  getHandleAt,
  getSegmentAt,
  getVertexAt,
  radiusFromHorizontalDrag,
  updateCornerRadius,
} from "../lib/shapeHandles";
import { transformPathData, type BrushStroke } from "../../shared/maskBake.ts";
import type { AnimationSchema } from "../../shared/animationSchema.ts";
import { layerZShadowCss } from "../../shared/layerOrder.ts";
import { createFrameAnimator, type FrameAnimator } from "../lib/animationEngine";
import { stopFrame } from "../lib/animationPlayback";
import { toFrameLocalBounds } from "../lib/canvasObjects";

/**
 * DesignFrame — Renders HTML/CSS inside a Shadow DOM container with
 * a visual interaction overlay (select, drag, resize) and bidirectional
 * code↔DOM sync.
 */

/**
 * Per-frame hit-test registry. Lets the canvas resolve a plain click on a
 * frame body to the topmost TOP-LEVEL layer under the cursor, respecting
 * layer-panel order (= DOM order, last child paints on top). Returns the
 * layerId, or null when the click landed on empty frame background.
 */
export type FrameHitTestFn = (clientX: number, clientY: number) => string | null;
export const frameHitTestRegistry = new Map<string, FrameHitTestFn>();

/**
 * Per-frame marquee selection. The canvas passes a client-space rectangle
 * (from an arrow-tool drag over the frame body); the frame multi-selects
 * every top-level object/group intersecting it — same result as
 * shift+clicking each one. Returns how many layers were selected.
 */
export type FrameMarqueeFn = (rect: { left: number; top: number; right: number; bottom: number }) => number;
export const frameMarqueeRegistry = new Map<string, FrameMarqueeFn>();

export interface FrameData {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  html: string;
  css: string;
  background: string;
  layoutMode?: "fixed" | "responsive";
  /** Declarative animation (timeline + clips + transitions) — compiled to
   *  WAAPI for preview and sampled for video export. One source of truth. */
  animation?: AnimationSchema;
  /** REQ-VID3: excluded from the reel export/preview (default false = in). */
  reelExcluded?: boolean;
  /** V3.2: CSS filter applied to this take in reel preview + export. */
  reelFilter?: string;
  /** V4.0: per-take framing on the project canvas (scale/pan). Absent =
   *  contain-fit centered. See src/lib/reelLayout.ts. */
  reelLayout?: { scale: number; xPct: number; yPct: number };
  /** V5: animated per-take effect (pure math in shared/videoEffectsCatalog). */
  reelFx?: { id: string; intensity: number };
  /** V5: static overlay fx ids (grain/vignette/scanlines/leak). */
  reelOverlayFx?: string[];
  /** P1.6: explicit z-order overrides for video mode (layerId → stack index,
   *  DOM document order as base). The design editor ignores it. */
  layerZ?: Record<string, number>;
  contentHash?: string;
  lastModifiedBy?: string;
  lastModifiedAt?: string;
}

export interface ShapeOptions {
  shape: "star" | "polygon";
  count: number;
  ratio: number;
  cornerRadius: number;
  size: number;
}

/** Canvas-level orphan object — lives outside any frame, rendered as a
 *  standalone div with inline style+html (no Shadow DOM, no clipping). */
export interface HtmlCanvasObject {
  id: string;
  name: string;
  kind: string;
  /** Root document objects are intentionally outside every frame. */
  frameId: null;
  html: string;
  css: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}

export interface SelectedElementInfo {
  layerId: string;
  tag: string;
  selector: string;
  computedStyles: Record<string, string>;
  frameId: string;
  /** Actual painted box in frame-local coordinates, including transforms. */
  visualBounds?: { x: number; y: number; width: number; height: number };
  isSvg: boolean;
  svgChildTag?: string;
  shapeOptions?: ShapeOptions;
  /** Effective radius of every shape vertex (F4) — null when the selection
   *  is not a shape with recoverable corners. */
  vertexRadii?: number[] | null;
  /** data-layer-kind of the selected element (group | container | frame | …). */
  layerKind?: string;
  /** Number of element children with their own data-layer-id. */
  childLayerCount?: number;
  /** Effective typography of the active character range. Mixed values remain editable. */
  richTextStyles?: Record<string, string>;
  textEditing?: boolean;
  /** `src` attribute for an <img> element — drives the Fill panel's image preview. */
  src?: string;
  movableLayers: Array<{
    layerId: string;
    position: string;
    left: string;
    top: string;
    translate: string;
    display: string;
  }>;
}

export interface LayerSelectionRequest {
  frameId: string;
  layerId: string;
  path?: number[];
  requestId: number;
}

export interface LayerVisualGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  contentWidth: number;
  contentHeight: number;
  contentOffsetX: number;
  contentOffsetY: number;
}

interface DesignFrameProps {
  frame: FrameData;
  isActive: boolean;
  zoom?: number;
  onActivate: (frameId: string) => void;
  onElementSelect?: (info: SelectedElementInfo | null) => void;
  /** A drag carried these layers entirely past the frame's edge, so they
   *  belong on the canvas now. Position is in frame coordinates. */
  onLayerEscape?: (
    layerIds: string[],
    box: { x: number; y: number; width: number; height: number },
    geometries?: Record<string, LayerVisualGeometry>,
  ) => void;
  selectionRequest?: LayerSelectionRequest | null;
  selectedLayerId?: string | null;
  selectedLayerIds?: readonly string[];
  onLayerSelectionChange?: (frameId: string, layerIds: string[], additive?: boolean) => void;
  onCssChange?: (frameId: string, newCss: string, newHtml?: string) => void;
  onHtmlChange?: (frameId: string, newHtml: string) => void;
  activeTool?: HtmlToolName;
  onAddPrimitive?: (type: "rect" | "circle" | "triangle" | "star" | "polygon" | "text", x: number, y: number, sides?: number, frameId?: string) => void;
  onDrawShape?: (type: "rect" | "circle" | "triangle" | "star" | "polygon", x: number, y: number, w: number, h: number, sides?: number) => void;
  onTextChange?: (layerId: string, newText: string) => void;
  onAddTextBox?: (x: number, y: number, w: number, h: number, initialText?: string, frameId?: string) => void;
  /** Text drag that straddled/escaped the frame: the box becomes an orphan. */
  onCreateOrphanText?: (x: number, y: number, w: number, h: number) => void;
  onAddPenPath?: (pathData: string, bounds: { x: number; y: number; width: number; height: number }, closed?: boolean) => void;
  onAddTextPath?: (pathData: string, bounds: { x: number; y: number; width: number; height: number }, clickX: number, clickY: number, startOffset: number, originalViewBox?: string) => void;
  onEditPathPoints?: (layerId: string, newPathD: string) => void;
  /** F4 A2: the frame reports entering/leaving vertex-edit mode so the app
   *  can reflect the mode in its chrome (e.g. an "Editing vertices" chip). */
  onVertexEditModeChange?: (layerId: string | null) => void;
  onElementDelete?: (layerId: string) => void;
  onElementDuplicate?: (layerId: string) => void;
  // ── F4 Borrador ──
  /** One completed brush trail over an <img> layer (image-local coords). */
  onBrushStroke?: (imageLayerId: string, stroke: BrushStroke) => void;
  /** Current brush diameter in px (from the toolbar / [ ] keys). */
  brushSize?: number;
  // ── F2 Varita ──
  /** Accumulated SAM click prompts over an <img> (normalized 0..1; Alt = neg). */
  onWandSegment?: (imageLayerId: string, src: string, points: WandClickPoint[]) => void;
  /** Image layer currently being segmented — drives the inline loader. */
  wandLoading?: string | null;
  // ── Phase 1-2: Frame-level interactions ──
  contentMode?: boolean;
  inMultiSelect?: boolean;
  isRenaming?: boolean;
  renameValue?: string;
  onLabelMouseDown?: (frameId: string, e: React.MouseEvent) => void;
  onLabelDoubleClick?: (frameId: string) => void;
  onRenameChange?: (value: string) => void;
  onRenameCommit?: () => void;
  onRenameCancel?: () => void;
  onEnterContentMode?: (frameId: string) => void;
  // ── Phase 5: Frame resize handles ──
  onFrameResize?: (frameId: string, width: number, height: number, x: number, y: number) => void;
  // Sprint 3.5: auto-edit newly created text layers
  autoEditLayerId?: string | null;
  onAutoEditHandled?: () => void;
}

const SEL = "#3B82F6";
const HANDLE = 7;
type ResizeDirection = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** SVG viewBox → overlay-space mapping for the vertex network. */
interface VectorMapping {
  vbX: number;
  vbY: number;
  svgScaleX: number;
  svgScaleY: number;
  svgLeft: number;
  svgTop: number;
}

/** Shared corner-radius drag parameters (path shapes and CSS divs). */
interface RadiusDragOptions {
  layerEl: Element;
  index: number;
  baseRadii: number[];
  maxRadius: number;
  rest: { x: number; y: number };
  /** Overlay px → local units (path shapes scale to viewBox units). */
  scale?: number;
  apply: (radii: number[], perCorner: boolean) => void;
  commit: (radii: number[], perCorner: boolean, value: number) => void;
}

const TRACKED_PROPS = [
  // Typography
  "font-family", "font-size", "font-weight", "font-style",
  "text-align", "line-height", "letter-spacing",
  "text-decoration", "text-transform", "white-space", "word-spacing",
  // Color & Background
  "color", "background-color", "background", "background-image",
  "background-size", "background-position", "background-repeat",
  // Spacing
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  // Border
  "border", "border-top", "border-right", "border-bottom", "border-left",
  "border-radius", "border-width", "border-style", "border-color",
  "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
  "outline", "outline-color", "outline-width", "outline-style", "outline-offset",
  // Dimensions
  "width", "height", "max-width", "max-height", "min-width", "min-height",
  // Position
  "position", "top", "left", "right", "bottom", "z-index",
  // Layout
  "display", "flex-direction", "flex-wrap", "gap", "row-gap", "column-gap",
  "align-items", "justify-content", "align-content", "align-self",
  "flex-grow", "flex-shrink", "flex-basis", "order",
  "grid-template-columns", "grid-template-rows", "grid-gap",
  // Overflow
  "overflow", "overflow-x", "overflow-y",
  // Effects
  "opacity", "box-shadow", "text-shadow",
  "transform", "transform-origin", "translate", "scale",
  "filter", "backdrop-filter",
  "mix-blend-mode", "background-blend-mode",
  "transition",
  // SVG-specific (for paths, shapes, etc.)
  "fill", "fill-opacity", "fill-rule",
  "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "stroke-dasharray", "stroke-dashoffset", "stroke-opacity",
];

function isConvertibleCssShape(layer: Element): boolean {
  if (layer.tagName.toLowerCase() !== "div" || layer.getAttribute("data-layer-kind") !== "shape" || layer.children.length > 0) return false;
  const computed = layer.ownerDocument.defaultView?.getComputedStyle(layer);
  return !!computed && !computed.borderTopLeftRadius.includes("%");
}

function isConvertedCssShapeSvg(element: Element | null): element is SVGSVGElement {
  if (!element || element.tagName.toLowerCase() !== "svg") return false;
  const svg = element as SVGSVGElement;
  if (svg.getAttribute("data-css-shape-converted") === "1") return true;
  // Compatibility with rectangles converted by the first vertex-edit release.
  return svg.getAttribute("data-layer-kind") === "svg"
    && svg.getAttribute("data-shape-custom") === "1"
    && svg.style.backgroundColor === "transparent"
    && svg.style.getPropertyPriority("background-color") === "important"
    && svg.querySelectorAll(":scope > path").length === 1;
}

/** True when a screen-space point hits the painted path, not its SVG viewport. */
function pointHitsConvertedShape(element: Element, clientX: number, clientY: number): boolean {
  if (!isConvertedCssShapeSvg(element)) return true;
  const path = element.querySelector(":scope > path") as SVGPathElement | null;
  const matrix = path?.getScreenCTM();
  if (!path || !matrix || typeof path.isPointInFill !== "function") return true;
  try {
    const screenPoint = element.createSVGPoint();
    screenPoint.x = clientX;
    screenPoint.y = clientY;
    const localPoint = screenPoint.matrixTransform(matrix.inverse());
    const computed = path.ownerDocument.defaultView?.getComputedStyle(path);
    const fillPainted = computed?.fill !== "none" && Number.parseFloat(computed?.fillOpacity || "1") > 0;
    const strokePainted = computed?.stroke !== "none"
      && Number.parseFloat(computed?.strokeOpacity || "1") > 0
      && Number.parseFloat(computed?.strokeWidth || "0") > 0;
    return (fillPainted && path.isPointInFill(localPoint))
      || (strokePainted && typeof path.isPointInStroke === "function" && path.isPointInStroke(localPoint));
  } catch {
    // Keep selection usable in browsers that cannot invert this SVG matrix.
    return true;
  }
}

export function DesignFrame({
  frame, isActive, zoom, onActivate, onElementSelect, onLayerEscape, onCssChange, onHtmlChange, onCreateOrphanText,
  selectionRequest, selectedLayerId, selectedLayerIds = [], onLayerSelectionChange,
  activeTool, onAddPrimitive, onDrawShape, onTextChange, onAddTextBox, onAddPenPath, onAddTextPath, onEditPathPoints, onVertexEditModeChange, onElementDelete, onElementDuplicate,
    onBrushStroke, brushSize = 24,
    onWandSegment, wandLoading = null,
  contentMode, inMultiSelect, isRenaming, renameValue, onLabelMouseDown, onLabelDoubleClick, onRenameChange, onRenameCommit, onRenameCancel, onEnterContentMode,
  onFrameResize,
  autoEditLayerId, onAutoEditHandled,
}: DesignFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<ShadowRoot | null>(null);
  const overlayRef = useRef<HTMLElement | null>(null);
  const selectedRef = useRef<Element | null>(null);
  const selectedSourceRef = useRef<Element | null>(null);
  const multiSelectedElsRef = useRef<Element[]>([]);
  const cssRef = useRef(frame.css);
  const htmlRef = useRef(frame.html);
  // Track the last CSS we wrote to React so we can skip ONLY our own echo.
  // A boolean flag would swallow the next update (e.g. undo) in a batched render.
  // Comparing content ensures we only skip when React feeds back the exact CSS
  // we just emitted via onCssChange.
  const lastEmittedCssRef = useRef<string | null>(null);
  const lastEmittedHtmlRef = useRef<string | null>(null);
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const onAddPrimitiveRef = useRef(onAddPrimitive);
  onAddPrimitiveRef.current = onAddPrimitive;
  const onDrawShapeRef = useRef(onDrawShape);
  onDrawShapeRef.current = onDrawShape;
  const onTextChangeRef = useRef(onTextChange);
  onTextChangeRef.current = onTextChange;
  const savedTextRangeRef = useRef<Range | null>(null);
  const onAddTextBoxRef = useRef(onAddTextBox);
  onAddTextBoxRef.current = onAddTextBox;
  const onCreateOrphanTextRef = useRef(onCreateOrphanText);
  onCreateOrphanTextRef.current = onCreateOrphanText;
  const onAddPenPathRef = useRef(onAddPenPath);
  onAddPenPathRef.current = onAddPenPath;
  const onAddTextPathRef = useRef(onAddTextPath);
  onAddTextPathRef.current = onAddTextPath;
  const onElementDeleteRef = useRef(onElementDelete);
  onElementDeleteRef.current = onElementDelete;
  const onElementDuplicateRef = useRef(onElementDuplicate);
  onElementDuplicateRef.current = onElementDuplicate;
  const onEditPathPointsRef = useRef(onEditPathPoints);
  onEditPathPointsRef.current = onEditPathPoints;
    const onVertexEditModeChangeRef = useRef(onVertexEditModeChange);
    onVertexEditModeChangeRef.current = onVertexEditModeChange;

  // F4 A2: switching away from select/hand exits vertex-edit mode so the
  // overlay never survives a tool change.
  useEffect(() => {
    if (activeTool && activeTool !== "select" && activeTool !== "hand" && vertexEditModeRef.current) {
      exitVertexEditModeRef.current?.();
      if (selectedRef.current) refreshOverlay(selectedRef.current);
    }
  }, [activeTool]);
  const onBrushStrokeRef = useRef(onBrushStroke);
  onBrushStrokeRef.current = onBrushStroke;
  const brushSizeRef = useRef(brushSize);
  brushSizeRef.current = brushSize;
  const onWandSegmentRef = useRef(onWandSegment);
  onWandSegmentRef.current = onWandSegment;
  const wandLoadingRef = useRef(wandLoading);
  wandLoadingRef.current = wandLoading;
  // Varita click state: frame coords for markers, normalized 0..1 for the payload.
  const wandPointsRef = useRef<Array<{ fx: number; fy: number; nx: number; ny: number; neg: boolean }>>([]);
  const wandContextRef = useRef<{ imageLayerId: string; src: string } | null>(null);
  const wandLastRef = useRef<{ t: number; x: number; y: number } | null>(null);
  const wandMarkersRef = useRef<SVGElement | null>(null);
  const wandHintRef = useRef<HTMLElement | null>(null);
  const wandLoaderRef = useRef<HTMLElement | null>(null);
  const wandKeysCleanupRef = useRef<(() => void) | null>(null);
  const onCssChangeRef = useRef(onCssChange);
  onCssChangeRef.current = onCssChange;
  const onHtmlChangeRef = useRef(onHtmlChange);
  onHtmlChangeRef.current = onHtmlChange;
  const onElementSelectRef = useRef(onElementSelect);
  onElementSelectRef.current = onElementSelect;

  useEffect(() => {
    frameRichTextRegistry.set(frame.id, (layerId, property, value) => {
      const content = shadowRef.current?.getElementById("__df_content") as HTMLElement | null;
      const root = content?.querySelector(`[data-layer-id="${CSS.escape(layerId)}"][data-layer-kind="text"]`) as HTMLElement | null;
      if (!content || !root) {
        // Silent kill switch: a miss here looks identical to "the picker is
        // broken" from the outside. Log loudly — this silence cost hours.
        console.warn("[rich-text] registry callback sin root", { frameId: frame.id, layerId, hadContent: !!content });
        return;
      }
      savedTextRangeRef.current = applyRichTextStyle(root, savedTextRangeRef.current, property, value);
      const selection = root.ownerDocument.getSelection();
      selection?.removeAllRanges();
      if (savedTextRangeRef.current) selection?.addRange(savedTextRangeRef.current);
      lastEmittedHtmlRef.current = content.innerHTML;
      onHtmlChangeRef.current?.(frame.id, content.innerHTML);
      emitElementSelection(root);
    });
    return () => { frameRichTextRegistry.delete(frame.id); };
  }, [frame.id]);
  const onLayerEscapeRef = useRef(onLayerEscape);
  onLayerEscapeRef.current = onLayerEscape;
  const onLayerSelectionChangeRef = useRef(onLayerSelectionChange);
  onLayerSelectionChangeRef.current = onLayerSelectionChange;
  const editingTextRef = useRef<Element | null>(null);
  const zoomRef = useRef(zoom || 1);
  zoomRef.current = zoom || 1;
  const onFrameResizeRef = useRef(onFrameResize);
  onFrameResizeRef.current = onFrameResize;

  // ── Sprint 3: Scope-based selection + hover preview ──
  const scopeRef = useRef<Element | null>(null);   // drill-down scope (null = root)
  const hoverPreviewRef = useRef<HTMLElement | null>(null);

  function emitFrameChange(updatedCss: string, updatedHtml?: string) {
    const cssChanged = updatedCss !== cssRef.current;
    const htmlChanged = updatedHtml !== undefined && updatedHtml !== htmlRef.current;
    cssRef.current = updatedCss;
    lastEmittedCssRef.current = cssChanged ? updatedCss : null;
    if (updatedHtml !== undefined) {
      htmlRef.current = updatedHtml;
      lastEmittedHtmlRef.current = htmlChanged ? updatedHtml : null;
    }
    const style = shadowRef.current?.querySelector("style");
    if (style) style.textContent = `#__df_content { width: ${frame.width}px; height: ${frame.height}px; overflow: hidden; }\n${mapBodySelectors(updatedCss)}`;
    onCssChangeRef.current?.(frame.id, updatedCss, updatedHtml);
  }

  // ── Sprint 3.5: Enter text edit mode on an element ──
  function enterTextEditMode(target: HTMLElement) {
    if (editingTextRef.current) return; // already editing
    editingTextRef.current = target;
    target.setAttribute("contenteditable", "true");
    target.style.outline = `2px solid ${SEL}`;
    target.style.outlineOffset = "2px";
    target.style.cursor = "text";
    // Select all text so the user can immediately type over the placeholder
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(target);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    target.focus();

    const onBlur = () => {
      target.removeEventListener("blur", onBlur);
      target.removeAttribute("contenteditable");
      target.style.outline = "";
      target.style.outlineOffset = "";
      target.style.cursor = "";
      editingTextRef.current = null;

      const layerId = target.getAttribute("data-layer-id");
      if (layerId) {
        const newText = target.textContent || "";
        onTextChangeRef.current?.(layerId, newText);
      }
    };
    target.addEventListener("blur", onBlur);

    // Prevent Enter/Escape from bubbling
    target.addEventListener("keydown", (ke: Event) => {
      const kbe = ke as KeyboardEvent;
      if (kbe.key === "Escape") target.blur();
      kbe.stopPropagation();
    });
  }

  // ── Sprint 3.5: Auto-edit newly created text layers ──
  useEffect(() => {
    if (!autoEditLayerId) return;
    const shadow = shadowRef.current;
    if (!shadow) return;
    const content = shadow.getElementById("__df_content");
    if (!content) return;
    // The layer can land a frame or two after this effect (the store commit
    // and this flag travel in the same React batch, but the shadow patch may
    // lag). A single rAF raced that patch and silently skipped both edit mode
    // AND the selection emission — the emission is what points the contextual
    // panel at the new text. Retry a few frames before giving up.
    let raf = 0;
    let tries = 0;
    const seek = () => {
      const el = content.querySelector(`[data-layer-id="${autoEditLayerId}"]`) as HTMLElement | null;
      if (el) {
        enterTextEditMode(el);
        selectElement(el);
        onAutoEditHandled?.();
        return;
      }
      if (++tries > 30) { onAutoEditHandled?.(); return; }
      raf = requestAnimationFrame(seek);
    };
    raf = requestAnimationFrame(seek);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [autoEditLayerId]);

  // ── Shadow DOM init (once) ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el || shadowRef.current) return;
    const shadow = el.attachShadow({ mode: "open" });
    shadowRef.current = shadow;

    // Google Fonts extraction: find @import url(...) in CSS
    const fontLinks = extractFontImports(frame.css);

    // Inject font links
    for (const href of fontLinks) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      shadow.appendChild(link);
    }

    // Style element — system defaults FIRST (user CSS comes after, cascade: user wins)
    const style = document.createElement("style");
    style.textContent = `#__df_content { width: ${frame.width}px; height: ${frame.height}px; overflow: hidden; }\n${mapBodySelectors(frame.css)}`;
    shadow.appendChild(style);

    // Editor interaction CSS: content wrapper is transparent to pointer events,
    // but individual children capture them. Click on empty space passes through
    // content → hits background div (frame select/drag). Click on element → element.
    const peStyle = document.createElement("style");
    peStyle.textContent = `#__df_content { pointer-events: none; } #__df_content * { pointer-events: auto; }`;
    shadow.appendChild(peStyle);

    // Content container
    const content = document.createElement("div");
    content.id = "__df_content";
    content.innerHTML = frame.html;
    // position and z-index are functional (stacking context). Keep inline.
    content.style.position = "relative";
    content.style.zIndex = "2";
    // width, height, overflow now come from <style> (above) — allows user CSS
    // body { } remapped by mapBodySelectors to #__df_content to override defaults.
    // Apply frame background as inline style — overrides CSS body background remapped to #__df_content
    content.style.background = frame.background || "transparent";
    shadow.appendChild(content);

    // Slot — distributes light DOM chrome (background, border, label) into shadow tree
    // Without this, light DOM children of the shadow host are invisible per Shadow DOM spec.
    const slot = document.createElement("slot");
    shadow.appendChild(slot);

    // Overlay layer
    const overlay = document.createElement("div");
    overlay.id = "__df_overlay";
    Object.assign(overlay.style, {
      position: "absolute", top: "0", left: "0",
      width: "100%", height: "100%",
      pointerEvents: "none", zIndex: "9999",
    });
    shadow.appendChild(overlay);
    overlayRef.current = overlay;

    // Attach interaction handlers
    setupInteraction(shadow, content, overlay);
  }, []);

  // ── Register the top-level hit-test used by plain clicks on the frame body ──
  // Kept in its own effect (not the shadow-init effect, which early-returns once
  // the shadow exists) so StrictMode's mount→cleanup→mount cycle re-registers it.
  // Iterates top-level layers in reverse DOM order: the layer highest in the
  // layers panel (last child) wins when bounding boxes overlap.
  useEffect(() => {
    const register = (): boolean => {
      const content = shadowRef.current?.getElementById("__df_content");
      if (!content) return false;
      frameHitTestRegistry.set(frame.id, (clientX, clientY) =>
        findTopmostLayerAtPoint(content, clientX, clientY)?.getAttribute("data-layer-id") || null,
      );
      frameMarqueeRegistry.set(frame.id, (rect) => {
        const hits = [...content.children].filter(child => {
          const lid = child.getAttribute("data-layer-id");
          if (!lid || lid.startsWith("auto_")) return false;
          const r = getVisualRect(child);
          return (r.width > 0 || r.height > 0)
            && r.left < rect.right && r.right > rect.left
            && r.top < rect.bottom && r.bottom > rect.top;
        });
        multiSelectedElsRef.current = hits;
        if (hits.length === 0) {
          selectedRef.current = null;
          clearOverlay();
          onElementSelect?.(null);
        } else {
          const last = hits[hits.length - 1];
          selectedRef.current = last;
          selectedSourceRef.current = last;
          refreshOverlay(last);
          drawAdditionalSelectionOutlines(hits.filter(element => element !== last));
          emitElementSelection(last, last);
        }
        onLayerSelectionChangeRef.current?.(
          frame.id,
          hits.flatMap(element => element.getAttribute("data-layer-id") || []),
        );
        return hits.length;
      });
      return true;
    };
    let raf = 0;
    if (!register()) raf = requestAnimationFrame(() => register());
    return () => {
      if (raf) cancelAnimationFrame(raf);
      frameHitTestRegistry.delete(frame.id);
      frameMarqueeRegistry.delete(frame.id);
    };
  }, [frame.id]);

  // ── Frame resize → live clip update ──
    // The clip rule lives in an imperative <style>; the css/html sync below
    // never re-runs on a pure resize, so a grown frame kept clipping at its
    // old size. Placed BEFORE that sync so on mount css always writes last.
    // NOTE: when the frame css carries a pinned `body { width/height }` (frames
    // created with the F tool embed it), mapBodySelectors re-emits it AFTER this
    // rule and cascade keeps the stale size — the resize effect alone cannot win.
    // handleFrameResize therefore rewrites the persisted body rule too.
    useEffect(() => {
      const style = shadowRef.current?.querySelector("style");
      if (style) style.textContent = `#__df_content { width: ${frame.width}px; height: ${frame.height}px; overflow: hidden; }\n${mapBodySelectors(cssRef.current)}`;
    }, [frame.width, frame.height]);

  // ── Code → DOM: CSS update (+ font auto-heal) ──
  useEffect(() => {
    // Skip only if React is feeding back the exact CSS we just emitted (echo suppression).
    // This allows undo/redo updates (different CSS) to flow through unblocked.
    if (lastEmittedCssRef.current === frame.css) {
      lastEmittedCssRef.current = null; // consume the echo
      return;
    }
    // A different update won the race; the older echo marker is now stale.
    lastEmittedCssRef.current = null;
    cssRef.current = frame.css;
    const shadow = shadowRef.current;
    if (!shadow) return;
    // AI/MCP write paths persist `font-family` without the Google Fonts import
    // the human picker writes — the browser then silently falls back. Heal on
    // every css/html arrival: missing imports are prepended for display AND
    // emitted back once so state, autosave and exports inherit the fix.
    const { css: healedCss } = ensureDesignFontImports(frame.css, frame.html);
    const style = shadow.querySelector("style");
    if (style) style.textContent = `#__df_content { width: ${frame.width}px; height: ${frame.height}px; overflow: hidden; }\n${mapBodySelectors(healedCss)}`;
    // Update font imports
    const existingLinks = shadow.querySelectorAll("link");
    const newHrefs = extractFontImports(healedCss);
    existingLinks.forEach(l => { if (!newHrefs.includes((l as HTMLLinkElement).href)) l.remove(); });
    for (const href of newHrefs) {
      if (![...shadow.querySelectorAll("link")].some(l => (l as HTMLLinkElement).href === href)) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        shadow.insertBefore(link, shadow.firstChild);
      }
    }
    if (healedCss !== frame.css) {
      // Mark BEFORE emitting so the store round-trip comes back as our echo
      // and the gate above consumes it — a non-idempotent heal can then loop
      // at most once instead of growing the css forever (same guard the
      // HTML effect sets below).
      lastEmittedCssRef.current = healedCss;
      onCssChangeRef.current?.(frame.id, healedCss);
    }
    if (selectedRef.current) {
      refreshOverlay(selectedRef.current);
      emitElementSelection(selectedRef.current, selectedSourceRef.current || selectedRef.current);
    }
  }, [frame.css, frame.html]);

  // ── REQ042 (eje z): the design canvas honors the explicit layerZ map ──
  // Until now the map was video-only, so z edits made in video mode were
  // invisible back in design mode. Plain [data-layer-id] selectors are safe
  // here: this style tag lives INSIDE the shadow root, so nothing leaks to
  // sibling frames (the main-document overlay still scopes via .vm-scope-N).
  useEffect(() => {
    const shadow = shadowRef.current;
    if (!shadow) return;
    const text = layerZShadowCss(frame.layerZ);
    let style = shadow.querySelector<HTMLStyleElement>("style[data-df-z]");
    if (!text) { style?.remove(); return; }
    if (!style) {
      style = document.createElement("style");
      style.setAttribute("data-df-z", "");
      shadow.appendChild(style);
    }
    style.textContent = text;
  }, [frame.layerZ]);

  // ── F0 animation preview: frame.animation → WAAPI inside __df_content ──
  // The animator owns a manual clock (scrub-exact, export-identical) and
  // cancels cleanly — the persisted html/css are never touched by a preview.
  const animatorRef = useRef<FrameAnimator | null>(null);
  useEffect(() => {
    const content = shadowRef.current?.getElementById("__df_content") as HTMLElement | null;
    if (!content) return;
    if (!animatorRef.current) animatorRef.current = createFrameAnimator(frame.id, content, frame.animation);
    else animatorRef.current.update(frame.animation);
  }, [frame.id, frame.animation]);
  useEffect(() => () => {
    animatorRef.current?.destroy();
    animatorRef.current = null;
    stopFrame(frame.id);
  }, [frame.id]);

  // ── Override content pointer-events for interactive modes ──
  // Static peStyle sets #__df_content { pointer-events: none } by default,
  // creating click-through gaps for frame-level selection/drag.
  // Override to "auto" only when the user is editing content directly.
  useEffect(() => {
    const shadow = shadowRef.current;
    if (!shadow) return;
    const content = shadow.getElementById("__df_content");
    if (!content) return;
    const needsInteractive = contentMode || (activeTool && activeTool !== "select" && activeTool !== "hand");
    content.style.pointerEvents = needsInteractive ? "auto" : "";
  }, [contentMode, activeTool]);

  // ── Varita: drop transient click prompts when the tool is left/unmounted ──
  useEffect(() => () => {
    wandPointsRef.current = [];
    wandLastRef.current = null;
    wandContextRef.current = null;
    wandKeysCleanupRef.current?.();
    wandKeysCleanupRef.current = null;
    wandMarkersRef.current?.remove();
    wandMarkersRef.current = null;
    wandHintRef.current?.remove();
    wandHintRef.current = null;
    wandLoaderRef.current?.remove();
    wandLoaderRef.current = null;
  }, [activeTool]);

  // ── Varita: inline loader over the image while its job runs ──
  useEffect(() => {
    if (!wandLoading) {
      wandLoaderRef.current?.remove();
      wandLoaderRef.current = null;
      return;
    }
    const content = shadowRef.current?.getElementById("__df_content");
    if (!content) return;
    const img = content.querySelector(`[data-layer-id="${CSS.escape(wandLoading)}"]`) as HTMLElement | null;
    if (!img) return;
    const rect = content.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();
    const z = zoomRef.current || 1;
    const loader = document.createElement("div");
    Object.assign(loader.style, {
      position: "absolute",
      left: `${(imgRect.left - rect.left) / z}px`,
      top: `${(imgRect.top - rect.top) / z}px`,
      width: `${imgRect.width / z}px`,
      height: `${imgRect.height / z}px`,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(30,30,30,0.55)",
      color: "#fff", fontSize: "13px", fontWeight: 600,
      pointerEvents: "none", zIndex: "9998",
    });
    loader.textContent = "Segmentando…";
    content.appendChild(loader);
    wandLoaderRef.current = loader;
    // The DOM patch that lands the mask sweeps this element away; the
    // ref cleanup runs when the job resolves and wandLoading clears.
  }, [wandLoading]);

  // ── Sync frame.background to #__df_content inline style ──
  // This overrides CSS body background remapped to #__df_content,
  // allowing the properties panel to control the frame's visible background.
  useEffect(() => {
    const shadow = shadowRef.current;
    if (!shadow) return;
    const content = shadow.getElementById("__df_content");
    if (!content) return;
    content.style.background = frame.background || "transparent";
  }, [frame.background]);

  // ── Code → DOM: HTML update ──
  useEffect(() => {
    // Echo suppression: skip if React feeds back the exact HTML we just emitted.
    // This prevents a full DOM rebuild + selection reset when the parent echoes
    // our own onHtmlChange back to us (identical to the CSS echo-suppression above).
    if (lastEmittedHtmlRef.current === frame.html) {
      lastEmittedHtmlRef.current = null; // consume the echo
      return;
    }
    // Do not let an older local emission suppress a later undo/external edit.
    lastEmittedHtmlRef.current = null;

    let html = frame.html;

    // Ensure every element carries a data-layer-id so mousedown never has to
    // create one reactively — that was the root cause of janky selection (S2a).
    // Wrapping text nodes in <span data-layer-id> also guarantees clickable
    // inline text for tools (pen, text-box, text-path).
    if (html.trim()) {
      const ensured = ensureLayerIds(html, createLayerId, frame.css);
      if (ensured !== html) {
        html = ensured;
        // Mark this HTML as ours so the echo-suppression gate above consumes
        // the feedback round-trip.
        lastEmittedHtmlRef.current = ensured;
      }
    }

    htmlRef.current = html;
    const shadow = shadowRef.current;
    if (!shadow) return;
    const content = shadow.getElementById("__df_content");
    if (!content) return;

    // Save current selection's layer-id so we can re-resolve it after the
    // innerHTML rewrite (Sprint-0.3). Without this, every external HTML
    // update (undo, variables panel, brand panel) silently clears selection.
    const savedLayerId = selectedRef.current?.getAttribute("data-layer-id") || null;

    // Incremental DOM patch (Sprint 2): only replace layers whose content changed.
    // This preserves untouched elements with their event listeners intact.
    // Falls back to full innerHTML for empty content (no layers to diff).
    if (html.trim() && html.includes("data-layer-id")) {
      reconcileFrameHtml(content, html);
    } else {
      content.innerHTML = html;
    }
    selectedRef.current = null;
    selectedSourceRef.current = null;
    clearOverlay();
    // Clear pen state on HTML update
    penPointsRef.current = [];
    penSvgRef.current = null;

    // Re-resolve selection by data-layer-id so the user never notices that
    // the DOM was rebuilt — the overlay, computed-style panel, and keyboard
    // shortcuts all stay wired to the same logical element.
    if (savedLayerId) {
      const resolved = content.querySelector(`[data-layer-id="${savedLayerId}"]`);
      if (resolved) selectElement(resolved);
    }

    // If ensureLayerIds enriched the HTML, push the enriched version upstream
    // so the canonical HTML in state matches what is actually in the DOM.
    if (html !== frame.html) {
      onHtmlChangeRef.current?.(frame.id, html);
    }
  }, [frame.html]);

  useEffect(() => {
    if (!selectionRequest || selectionRequest.frameId !== frame.id) return;
    const content = shadowRef.current?.getElementById("__df_content");
    if (!content) return;

    let element: Element | null = null;
    if (!selectionRequest.layerId.startsWith("auto_")) {
      element = content.querySelector(`[data-layer-id="${selectionRequest.layerId}"]`);
    }
    if (!element && selectionRequest.path?.length) {
      element = content;
      for (const index of selectionRequest.path) {
        element = element.children[index] || null;
        if (!element) break;
      }
    }
    if (!element) return;
    const textRoot = element.closest('[data-layer-kind="text"][data-layer-id]');
    if (textRoot && textRoot !== element) element = textRoot;
    if (!element.hasAttribute("data-layer-id")) {
      element.setAttribute("data-layer-id", createLayerId());
      htmlRef.current = content.innerHTML;
      lastEmittedHtmlRef.current = content.innerHTML;
      onHtmlChangeRef.current?.(frame.id, htmlRef.current);
    }
    selectElement(element);
  }, [selectionRequest]);

  useEffect(() => {
    if (selectedLayerId || selectionRequest) return;
    selectedRef.current = null;
    selectedSourceRef.current = null;
    clearOverlay();
  }, [selectedLayerId, selectionRequest]);

  useEffect(() => {
    const content = shadowRef.current?.getElementById("__df_content");
    if (!content) return;
    const elements = selectedLayerIds.flatMap(layerId => {
      const element = content.querySelector(`[data-layer-id="${CSS.escape(layerId)}"]`);
      return element ? [element] : [];
    });
    multiSelectedElsRef.current = elements;
    if (elements.length === 0) return;
    const primary = elements.find(element => element.getAttribute("data-layer-id") === selectedLayerId);
    if (primary) {
      selectedRef.current = primary;
      refreshOverlay(primary);
      drawAdditionalSelectionOutlines(elements.filter(element => element !== primary));
    } else {
      // La selección primaria vive en OTRO frame: este frame igual dibuja
      // los handlers visuales de sus objetos seleccionados — antes, un
      // frame con exactamente 1 seleccionado no dibujaba NADA y en una
      // selección cross-frame parecía que el objeto no estaba elegido.
      drawAdditionalSelectionOutlines(elements);
    }
  }, [selectedLayerIds, selectedLayerId, frame.html]);

  function emitElementSelection(element: Element, source: Element = element) {
    // Generic re-emits (html/css commit effects) pass the layer as both
    // element and source, which drops the painted-path source for SVG
    // shapes — the panel then loses svgChildTag and its fill row flips to
    // "no fill" (unmounting any open fill popup with it). When the caller
    // didn't pin a source, restore the remembered one if it still lives
    // inside this element.
    const rememberedSource = selectedSourceRef.current;
    const effectiveSource = source === element && rememberedSource && element.contains(rememberedSource)
      ? rememberedSource
      : source;
    const computed = effectiveSource.ownerDocument.defaultView!.getComputedStyle(effectiveSource);
    const computedStyles: Record<string, string> = {};
    for (const property of TRACKED_PROPS) computedStyles[property] = computed.getPropertyValue(property);

    const tag = element.tagName.toLowerCase();
    const visualRect = getVisualRect(element);
    const content = shadowRef.current?.getElementById("__df_content");
    const contentRect = content?.getBoundingClientRect();
    const z = zoomRef.current || 1;
    const visualBounds = contentRect ? toFrameLocalBounds(visualRect, contentRect, z) : undefined;
    const parentSvg = effectiveSource.closest?.("svg");
    const isSvg = tag === "svg" || !!parentSvg;
    const movableLayers = collectMovableElements(element).flatMap(item => {
      const layerId = item.getAttribute("data-layer-id");
      if (!layerId) return [];
      const layout = item.ownerDocument.defaultView!.getComputedStyle(item);
      return [{
        layerId,
        position: layout.position,
        left: layout.left,
        top: layout.top,
        translate: layout.translate,
        display: layout.display,
      }];
    });
    const shapeKind = element.getAttribute("data-shape") as ShapeOptions["shape"] | null;
    const shapeOptions: ShapeOptions | undefined = shapeKind === "star" || shapeKind === "polygon"
      ? {
          shape: shapeKind,
          count: Number(element.getAttribute("data-shape-count")) || (shapeKind === "star" ? 5 : 6),
          ratio: Number(element.getAttribute("data-shape-ratio")) || 0.4,
          cornerRadius: Number(element.getAttribute("data-shape-corner-radius")) || 0,
          size: Number(element.getAttribute("data-shape-size")) || 120,
        }
      : undefined;
    const shapePathForRadii = tag === "path" ? element : element.querySelector("path");
    const shapeGeometryForRadii = shapePathForRadii ? resolveShapeGeometry(shapePathForRadii) : null;

    const isRichText = element.getAttribute("data-layer-kind") === "text";
    const activeRange = isRichText && editingTextRef.current === element ? savedTextRangeRef.current : null;
    const richTextStyles = isRichText
      ? summarizeRichTextStyles(element as HTMLElement, activeRange)
      : undefined;
    if (richTextStyles) {
      for (const [property, value] of Object.entries(richTextStyles)) {
        if (value !== MIXED_TEXT_STYLE) computedStyles[property] = value;
      }
    }
    onElementSelectRef.current?.({
      layerId: element.getAttribute("data-layer-id") || "",
      tag,
      selector: getStyleSelector(element, effectiveSource),
      computedStyles,
      frameId: frame.id,
      visualBounds,
      isSvg,
      svgChildTag: isSvg && effectiveSource !== element ? effectiveSource.tagName.toLowerCase() : undefined,
      shapeOptions,
      vertexRadii: shapeGeometryForRadii ? shapeGeometryForRadii.radii : null,
      layerKind: element.getAttribute("data-layer-kind") || undefined,
      childLayerCount: [...element.children].filter(c => c.hasAttribute("data-layer-id")).length,
      richTextStyles,
      textEditing: editingTextRef.current === element,
      src: tag === "img" ? (element.getAttribute("src") || undefined) : undefined,
      movableLayers,
    });
  }

  function isSemanticGroup(element: Element): boolean {
    if (element.getAttribute("data-layer-kind") === "group") return true;
    return element.tagName.toLowerCase() !== "svg" && element.children.length > 0;
  }

  function collectMovableElements(element: Element): Element[] {
    if (!isSemanticGroup(element)) return [element];
    const layout = element.ownerDocument.defaultView!.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (layout.display !== "contents" && (rect.width > 0 || rect.height > 0)) return [element];
    return [...element.children].flatMap(child => collectMovableElements(child));
  }

  function getVisualRect(element: Element): DOMRect {
    const ownRect = element.getBoundingClientRect();
    if (ownRect.width > 0 || ownRect.height > 0) return ownRect;
    const rects = collectMovableElements(element)
      .map(item => item.getBoundingClientRect())
      .filter(rect => rect.width > 0 || rect.height > 0);
    if (rects.length === 0) return ownRect;
    const left = Math.min(...rects.map(rect => rect.left));
    const top = Math.min(...rects.map(rect => rect.top));
    const right = Math.max(...rects.map(rect => rect.right));
    const bottom = Math.max(...rects.map(rect => rect.bottom));
    return new DOMRect(left, top, right - left, bottom - top);
  }

  function selectElement(element: Element, source: Element = element): void {
    if (vertexEditModeRef.current && vertexEditModeRef.current.layerId !== closestLayerId(element)) {
      // Selection moved to another layer — leave vertex-edit mode.
      exitVertexEditModeRef.current?.();
    }
    // Any radius handles now belong to the SELECTED shape (rendered by
    // refreshOverlay), not to the hover preview.
    hoverRadiusRef.current = false;
    hoverTargetRef.current = null;
    selectedRef.current = element;
    selectedSourceRef.current = source;
    refreshOverlay(element);
    emitElementSelection(element, source);
  }

  /**
   * Object-first hit testing: a plain click picks the deepest OBJECT under
   * the cursor, not its container. Groups are structural and have no painted
   * hit area, so they are selected from Layers rather than stealing a child's
   * click. Auto-generated text-wrapper spans are never selection targets.
   */
  function findTopmostLayerAtPoint(content: Element, clientX: number, clientY: number): Element | null {
    const point = { x: clientX, y: clientY };
    const selectableKids = (parent: Element) =>
      [...parent.children].filter(child => {
        const lid = child.getAttribute("data-layer-id");
        return lid && !lid.startsWith("auto_")
          && pointHitsConvertedShape(child, clientX, clientY);
      });

    // Descend from the top-level hit to the deepest child under the point.
    let hit: Element | null = pickTopmostByBounds(selectableKids(content), point, getVisualRect);
    if (!hit) return null;
    if (hit.getAttribute("data-layer-kind") === "text") return hit;
    for (;;) {
      const deeper: Element | null = pickTopmostByBounds(selectableKids(hit), point, getVisualRect);
      if (!deeper) break;
      hit = deeper;
      if (hit.getAttribute("data-layer-kind") === "text") break;
    }

    // A group draws nothing of its own. If no painted/text child was hit,
    // treat the press as empty canvas; groups remain selectable in Layers.
    return hit.getAttribute("data-layer-kind") === "group" ? null : hit;
  }

  function drawAdditionalSelectionOutlines(elements: Element[]): void {
    const overlay = overlayRef.current;
    const content = shadowRef.current?.getElementById("__df_content");
    if (!overlay || !content) return;
    const contentRect = content.getBoundingClientRect();
    const z = zoomRef.current || 1;
    for (const element of elements) {
      const rect = getVisualRect(element);
      // Mismo handler visual que el box primario (borde 2px + puntos en las
      // esquinas): con 7 objetos seleccionados se VE que los 7 lo están.
      // La interacción (resize/rotate) queda solo en el primario.
      const outline = document.createElement("div");
      Object.assign(outline.style, {
        position: "absolute",
        left: `${(rect.left - contentRect.left) / z}px`,
        top: `${(rect.top - contentRect.top) / z}px`,
        width: `${rect.width / z}px`,
        height: `${rect.height / z}px`,
        border: `2px solid ${SEL}`,
        pointerEvents: "none",
        boxSizing: "border-box",
      });
      for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        const dot = document.createElement("div");
        Object.assign(dot.style, {
          position: "absolute",
          left: `${cx * 100}%`,
          top: `${cy * 100}%`,
          width: "8px",
          height: "8px",
          background: "#ffffff",
          border: `1px solid ${SEL}`,
          borderRadius: "2px",
          transform: `translate(${cx ? "-100%" : "0%"}, ${cy ? "-100%" : "0%"})`,
          pointerEvents: "none",
        });
        outline.appendChild(dot);
      }
      overlay.appendChild(outline);
    }
  }

  function clearOverlay() {
    if (overlayRef.current) overlayRef.current.innerHTML = "";
    pointEditPathRef.current = null;
    pointEditOverlayRef.current = null;
    vertexEditModeRef.current = null;
    exitVertexEditModeRef.current?.();
    exitVertexEditModeRef.current = null;
    selectedVerticesRef.current = new Set();
  }

  // ── F4: shape vertex interactions ──
  // A1 — hover a selected shape: circles at each vertex; grab one and drag
  //   horizontally (left = sharper, right = rounder) to round ALL corners.
  // A2 — triple-click a shape: editable-vertices mode (drag individual
  //   vertices with smart guides, click a segment midpoint to insert).
  const vertexEditModeRef = useRef<{ layerId: string } | null>(null);
  const exitVertexEditModeRef = useRef<(() => void) | null>(null);
  const radiusDragRef = useRef(false);
  // F4 A2: selected vertex indexes (Shift multi-select), the path element
  // being edited and its screen-space vertex positions (hit tests).
  const selectedVerticesRef = useRef<Set<number>>(new Set());
  const vertexPathElRef = useRef<Element | null>(null);
  const vertexScreenPointsRef = useRef<{ x: number; y: number }[]>([]);
  // Spec F4: hover state — the vertex under the cursor (8px hit), the
  // segment hovered for insertion, and whether a vertex drag is live
  // (hover rendering is skipped while dragging).
  const hoveredVertexIndexRef = useRef<number | null>(null);
  const hoveredSegmentRef = useRef<{ startIndex: number; x: number; y: number } | null>(null);
  const vertexDraggingRef = useRef(false);
  // Hover-preview ownership: which element owns the current preview, and
  // whether the radius handles on screen belong to an UNSELECTED hovered
  // shape (they must leave with the preview, unlike the selected shape's).
  const hoverTargetRef = useRef<Element | null>(null);
  const hoverRadiusRef = useRef(false);

  function closestLayerId(start: Element | null): string {
    for (let node: Element | null = start; node; node = node.parentElement) {
      const id = node.getAttribute("data-layer-id");
      if (id) return id;
    }
    return "";
  }

  function enterVertexEditMode(element: Element): void {
    const layerId = element.getAttribute("data-layer-id") || "";
    vertexEditModeRef.current = { layerId };
    selectedVerticesRef.current = new Set();
    const onKey = (event: KeyboardEvent) => {
      // Escape — or Enter while no anchor has focus (anchors keep Enter for
      // the accessible smooth/corner toggle) — leaves vertex-edit mode.
      const focused = shadowRef.current?.activeElement ?? null;
      const isExitKey = event.key === "Escape"
        || (event.key === "Enter" && !focused?.hasAttribute?.("data-pe-point"));
      if (isExitKey) {
        exitVertexEditModeRef.current?.();
        if (selectedRef.current) refreshOverlay(selectedRef.current);
        return;
      }
      // ── F4 A2: Delete/Backspace removes the selected vertices. With no
      // vertex selection the event falls through (the app deletes the layer).
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const editData = pointEditPathRef.current;
      const pathEl = vertexPathElRef.current;
      if (!editData || !pathEl) return;
      const selected = [...selectedVerticesRef.current].sort((a, b) => b - a);
      if (selected.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (editData.points.length - selected.length < 3) {
        showTransientHint("Minimum 3 points");
        return;
      }
      let next = editData.points;
      for (const index of selected) next = deletePathPoint(next, index);
      editData.points = next;
      selectedVerticesRef.current = new Set();
      persistPathPointEdit(pathEl, next, editData.closed, editData.layerId);
      if (selectedRef.current) refreshOverlay(selectedRef.current);
    };
    exitVertexEditModeRef.current = () => {
      document.removeEventListener("keydown", onKey);
      vertexEditModeRef.current = null;
      selectedVerticesRef.current = new Set();
      hoveredVertexIndexRef.current = null;
      hoveredSegmentRef.current = null;
      vertexDraggingRef.current = false;
      vertexPathElRef.current = null;
      exitVertexEditModeRef.current = null;
      onVertexEditModeChangeRef.current?.(null);
    };
    document.addEventListener("keydown", onKey);
    onVertexEditModeChangeRef.current?.(layerId);
    selectElement(element);
  }

  /** Short-lived overlay chip (e.g. the < 3 points warning). */
  function showTransientHint(text: string): void {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.querySelector("[data-transient-hint]")?.remove();
    const hint = document.createElement("div");
    hint.setAttribute("data-transient-hint", "");
    Object.assign(hint.style, {
      position: "absolute", left: "50%", top: "12px", transform: "translateX(-50%)",
      padding: "4px 10px", borderRadius: "6px",
      background: "rgba(239,68,68,0.92)", color: "#ffffff",
      fontSize: "11px", fontWeight: "600", fontFamily: "system-ui, sans-serif",
      pointerEvents: "none", whiteSpace: "nowrap", zIndex: "10002",
    });
    hint.textContent = text;
    overlay.appendChild(hint);
    window.setTimeout(() => hint.remove(), 1400);
  }

  /** Create (or replace) the corner-handle SVG + radius tooltip. */
  function createRadiusOverlay(): { svg: SVGSVGElement; label: HTMLElement } | null {
    const overlay = overlayRef.current;
    if (!overlay) return null;
    overlay.querySelector("[data-radius-overlay]")?.remove();
    overlay.querySelector("[data-radius-label]")?.remove();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    Object.assign(svg.style, {
      position: "absolute", top: "0", left: "0",
      width: "100%", height: "100%",
      pointerEvents: "none", zIndex: "10001",
      overflow: "visible",
    });
    svg.setAttribute("data-radius-overlay", "");
    overlay.appendChild(svg);
    const label = document.createElement("div");
    label.setAttribute("data-radius-label", "");
    Object.assign(label.style, {
      position: "absolute",
      display: "none",
      padding: "3px 8px",
      borderRadius: "4px",
      background: "#0F111A",
      border: "1px solid rgba(59,130,246,0.55)",
      color: "#ffffff",
      fontSize: "11px",
      fontWeight: "600",
      fontFamily: "system-ui, sans-serif",
      pointerEvents: "none",
      whiteSpace: "nowrap",
      zIndex: "10002",
    });
    overlay.appendChild(label);
    return { svg, label };
  }

  /** One corner handle: 10px visual, grab cursor, auto pointer events. */
  function createHandleCircle(rest: { x: number; y: number }, index: number): SVGCircleElement {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", `${rest.x}`);
    circle.setAttribute("cy", `${rest.y}`);
    circle.setAttribute("r", "5");
    circle.setAttribute("fill", "#ffffff");
    circle.setAttribute("stroke", "#3B82F6");
    circle.setAttribute("stroke-width", "2");
    circle.setAttribute("data-radius-handle", `${index}`);
    circle.style.cursor = "grab";
    circle.style.pointerEvents = "auto";
    return circle;
  }

  /**
   * Shared corner-radius drag: Alt drags a single corner, plain drag rounds
   * all of them. rAF-throttled; commits through the caller's callbacks.
   */
  function startRadiusDrag(options: RadiusDragOptions, event: MouseEvent): void {
    const overlay = overlayRef.current;
    const content = shadowRef.current?.getElementById("__df_content");
    if (!overlay || !content) return;
    const z = zoomRef.current || 1;
    const cRect = content.getBoundingClientRect();
    const project = (clientX: number, clientY: number): [number, number] => [
      (clientX - cRect.left) / z,
      (clientY - cRect.top) / z,
    ];
    const perCorner = event.altKey;
    const scale = options.scale ?? 1;
    const [p0x] = project(event.clientX, event.clientY);
    let current = options.baseRadii[options.index] ?? 0;
    let pending: number | null = null;
    let rafId = 0;
    radiusDragRef.current = true;

    const getLabel = (): HTMLElement => {
      let label = overlay.querySelector("[data-radius-label]") as HTMLElement | null;
      if (!label) {
        label = document.createElement("div");
        label.setAttribute("data-radius-label", "");
        Object.assign(label.style, {
          position: "absolute", display: "none",
          padding: "3px 8px", borderRadius: "4px",
          background: "#0F111A", border: "1px solid rgba(59,130,246,0.55)",
          color: "#ffffff", fontSize: "11px", fontWeight: "600",
          fontFamily: "system-ui, sans-serif", pointerEvents: "none",
          whiteSpace: "nowrap", zIndex: "10002",
        });
        overlay.appendChild(label);
      }
      return label;
    };
    const showLabelAt = (cx: number, cy: number, text: string) => {
      const label = getLabel();
      label.textContent = text;
      label.style.display = "block";
      label.style.left = `${cx + 12}px`;
      label.style.top = `${cy - 14}px`;
    };
    const applyRadius = (radius: number) => {
      options.apply(updateCornerRadius(options.baseRadii, perCorner ? options.index : null, radius), perCorner);
    };
    const onMove = (moveEvent: MouseEvent) => {
      const [mx] = project(moveEvent.clientX, moveEvent.clientY);
      current = radiusFromHorizontalDrag(options.baseRadii[options.index] ?? 0, mx - p0x, options.maxRadius, scale);
      pending = current;
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        if (pending == null) return;
        applyRadius(pending);
        showLabelAt(options.rest.x, options.rest.y, `Radius ${Math.round(pending)}`);
      });
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      if (pending != null) applyRadius(pending);
      radiusDragRef.current = false;
      const label = overlay.querySelector("[data-radius-label]");
      if (label) (label as HTMLElement).style.display = "none";
      options.commit(updateCornerRadius(options.baseRadii, perCorner ? options.index : null, current), perCorner, current);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  /**
   * F4 A1: corner widgets on a path shape (parametric star/polygon or
   * recovered corners). Drag right to round, left to sharpen; Alt drags one corner.
   */
  function renderRadiusHandles(
    geom: NonNullable<ReturnType<typeof resolveShapeGeometry>>,
    layerEl: Element,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const overlay = overlayRef.current;
    const content = shadowRef.current?.getElementById("__df_content");
    const created = createRadiusOverlay();
    if (!overlay || !content || !created) return;
    const { svg: radiusSvg, label: radiusLabel } = created;

    // Map each path vertex to overlay space by normalizing it against the
    // shape's own bounds (avoids viewBox maths entirely): the layer rect
    // (x, y, w, h) is the shape bounds as painted, so nx/ny ∈ [0,1] land
    // exactly on the painted corners.
    const xs = geom.vertices.map(v => v.x);
    const ys = geom.vertices.map(v => v.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const vw = Math.max(...xs) - minX || 1;
    const vh = Math.max(...ys) - minY || 1;
    // Overlay px → path-local px (path coordinates may differ from painted px).
    const toLocal = w > 0 ? vw / w : 1;
    const maxRadiusLocal = Math.min(vw, vh) / 2;
    const center = { x: x + w / 2, y: y + h / 2 };
    const INSET = 12; // rest distance from the corner, toward the center
    const z = zoomRef.current || 1;
    const cRect = content.getBoundingClientRect();
    const project = (clientX: number, clientY: number): [number, number] => [
      (clientX - cRect.left) / z,
      (clientY - cRect.top) / z,
    ];

    const restPositions = geom.vertices.map(vertex => {
      const nx = (vertex.x - minX) / vw;
      const ny = (vertex.y - minY) / vh;
      const cornerX = x + nx * w;
      const cornerY = y + ny * h;
      const ux = center.x - cornerX;
      const uy = center.y - cornerY;
      const uLen = Math.hypot(ux, uy) || 1;
      return { corner: { x: cornerX, y: cornerY }, rest: { x: cornerX + (ux / uLen) * INSET, y: cornerY + (uy / uLen) * INSET } };
    });

    const showLabelAt = (cx: number, cy: number, text: string) => {
      radiusLabel.textContent = text;
      radiusLabel.style.display = "block";
      radiusLabel.style.left = `${cx + 12}px`;
      radiusLabel.style.top = `${cy - 14}px`;
    };
    const currentRadius = () =>
      geom.uniform || (geom.radii.length ? geom.radii.reduce((a, b) => a + b, 0) / geom.radii.length : 0);

    restPositions.forEach(({ rest }, index) => {
      const handleCircle = createHandleCircle(rest, index);
      handleCircle.addEventListener("mouseenter", () => {
        if (radiusDragRef.current) return;
        showLabelAt(rest.x, rest.y, `Radius ${Math.round(currentRadius())}`);
      });
      handleCircle.addEventListener("mouseleave", () => {
        if (radiusDragRef.current) return;
        radiusLabel.style.display = "none";
      });
      handleCircle.addEventListener("mousedown", (event) => {
        event.stopPropagation();
        event.preventDefault();
        const [mx, my] = project(event.clientX, event.clientY);
        if (getHandleAt(mx, my, restPositions.map(p => p.rest), 12) !== index) return;
        // A handle on a hovered-but-unselected shape selects it first.
        if (selectedRef.current !== layerEl) selectElement(layerEl);
        startRadiusDrag({
          layerEl,
          index,
          baseRadii: geom.radii,
          maxRadius: maxRadiusLocal,
          rest,
          scale: toLocal,
          apply: (radii, perCorner) => {
            geom.path.setAttribute("d", verticesToPath(geom.vertices, radii));
            window.dispatchEvent(new CustomEvent("musa:shape-radius-live", {
              detail: { layerId: geom.layerId, uniform: perCorner ? geom.uniform : radii[0], radii },
            }));
          },
          commit: (radii, perCorner, value) => {
            if (perCorner) {
              geom.holder.setAttribute("data-vr", serializeVertexRadiiAttr(radii));
            } else {
              geom.holder.setAttribute("data-shape-corner-radius", `${Math.round(value * 10) / 10}`);
              geom.holder.removeAttribute("data-vr");
            }
            emitFrameChange(cssRef.current, content.innerHTML);
            emitElementSelection(layerEl, selectedSourceRef.current || layerEl);
          },
        }, event);
      });
      radiusSvg.appendChild(handleCircle);
    });
  }

  /**
   * F4 A1 for CSS rectangles (div data-layer-kind="shape"): the same 4
   * corner widgets drive border-radius instead of a path's d attribute.
   * Circles (border-radius in %) get no widgets.
   */
  function renderCssRadiusHandles(layerEl: Element, x: number, y: number, w: number, h: number): void {
    const overlay = overlayRef.current;
    const content = shadowRef.current?.getElementById("__df_content");
    const created = createRadiusOverlay();
    if (!overlay || !content || !created) return;
    const { svg: radiusSvg, label: radiusLabel } = created;

    const computed = layerEl.ownerDocument.defaultView!.getComputedStyle(layerEl);
    const cornerProps = ["border-top-left-radius", "border-top-right-radius", "border-bottom-left-radius", "border-bottom-right-radius"] as const;
    const cornerValues = cornerProps.map(prop => computed.getPropertyValue(prop));
    if (cornerValues.some(value => value.includes("%"))) return; // circle/ellipse

    const baseRadii = cornerValues.map(value => parseFloat(value) || 0);
    const corners = bboxCorners(x, y, w, h);
    const center = { x: x + w / 2, y: y + h / 2 };
    const maxRadius = Math.min(w, h) / 2;
    const INSET = 12;
    const z = zoomRef.current || 1;
    const cRect = content.getBoundingClientRect();
    const project = (clientX: number, clientY: number): [number, number] => [
      (clientX - cRect.left) / z,
      (clientY - cRect.top) / z,
    ];
    const geometry = corners.map(corner => {
      const ux = center.x - corner.x;
      const uy = center.y - corner.y;
      const uLen = Math.hypot(ux, uy) || 1;
      return { corner, rest: { x: corner.x + (ux / uLen) * INSET, y: corner.y + (uy / uLen) * INSET } };
    });

    const showLabelAt = (cx: number, cy: number, text: string) => {
      radiusLabel.textContent = text;
      radiusLabel.style.display = "block";
      radiusLabel.style.left = `${cx + 12}px`;
      radiusLabel.style.top = `${cy - 14}px`;
    };

    geometry.forEach(({ rest }, index) => {
      const handleCircle = createHandleCircle(rest, index);
      handleCircle.addEventListener("mouseenter", () => {
        if (radiusDragRef.current) return;
        showLabelAt(rest.x, rest.y, `Radius ${Math.round(baseRadii[index])}`);
      });
      handleCircle.addEventListener("mouseleave", () => {
        if (radiusDragRef.current) return;
        radiusLabel.style.display = "none";
      });
      handleCircle.addEventListener("mousedown", (event) => {
        event.stopPropagation();
        event.preventDefault();
        const [mx, my] = project(event.clientX, event.clientY);
        if (getHandleAt(mx, my, geometry.map(g => g.rest), 12) !== index) return;
        if (selectedRef.current !== layerEl) selectElement(layerEl);
        startRadiusDrag({
          layerEl,
          index,
          baseRadii,
          maxRadius,
          rest,
          apply: (radii) => {
            const elStyle = (layerEl as HTMLElement).style;
            elStyle.setProperty("border-top-left-radius", `${radii[0]}px`);
            elStyle.setProperty("border-top-right-radius", `${radii[1]}px`);
            elStyle.setProperty("border-bottom-left-radius", `${radii[2]}px`);
            elStyle.setProperty("border-bottom-right-radius", `${radii[3]}px`);
          },
          commit: (radii, perCorner) => {
            const selector = getSelector(layerEl);
            const props: Record<string, string> = perCorner
              ? {
                  "border-top-left-radius": `${radii[0]}px`,
                  "border-top-right-radius": `${radii[1]}px`,
                  "border-bottom-left-radius": `${radii[2]}px`,
                  "border-bottom-right-radius": `${radii[3]}px`,
                }
              : { "border-radius": `${radii[0]}px` };
            const updatedCss = updateCssRule(cssRef.current, selector, props);
            const elStyle = (layerEl as HTMLElement).style;
            elStyle.borderRadius = "";
            elStyle.removeProperty("border-top-left-radius");
            elStyle.removeProperty("border-top-right-radius");
            elStyle.removeProperty("border-bottom-left-radius");
            elStyle.removeProperty("border-bottom-right-radius");
            emitFrameChange(updatedCss, content.innerHTML);
            emitElementSelection(layerEl, selectedSourceRef.current || layerEl);
          },
        }, event);
      });
      radiusSvg.appendChild(handleCircle);
    });
  }

  /**
   * The editable anchor network: anchor circles, Bézier control lines +
   * handles, and — in interactive mode — 12px transparent hit circles
   * (Fitts) plus the selection highlight for multi-selected vertices.
   */
  function renderVectorNetwork(editSvg: SVGElement, points: PathPoint[], mapping: VectorMapping, closed: boolean, interactive: boolean): void {
    const screenPoints: { x: number; y: number }[] = [];
    for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
      const point = points[pointIndex];
      const px = (point.x - mapping.vbX) * mapping.svgScaleX + mapping.svgLeft;
      const py = (point.y - mapping.vbY) * mapping.svgScaleY + mapping.svgTop;
      screenPoints.push({ x: px, y: py });
    }

    // ── Spec F4: the vector network — straight lines between consecutive
    // vertices (#0099FF, 1px) drawn OVER the shape's own stroke. The vertex
    // circles are appended after these lines, so they stay on top of all. ──
    const segmentCount = closed ? screenPoints.length : Math.max(0, screenPoints.length - 1);
    for (let index = 0; index < segmentCount; index++) {
      const a = screenPoints[index];
      const b = screenPoints[(index + 1) % screenPoints.length];
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", `${a.x}`); line.setAttribute("y1", `${a.y}`);
      line.setAttribute("x2", `${b.x}`); line.setAttribute("y2", `${b.y}`);
      line.setAttribute("stroke", "#0099FF");
      line.setAttribute("stroke-width", "1");
      line.style.pointerEvents = "none";
      editSvg.appendChild(line);
    }

    for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
      const point = points[pointIndex];
      const px = screenPoints[pointIndex].x;
      const py = screenPoints[pointIndex].y;
      const selected = interactive && selectedVerticesRef.current.has(pointIndex);
      // Idle anchors stay subtle; hover/selection gains a compact blue fill.
      const emphasized = selected || (interactive && hoveredVertexIndexRef.current === pointIndex);

      const anchor = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      anchor.setAttribute("cx", `${px}`);
      anchor.setAttribute("cy", `${py}`);
      anchor.setAttribute("r", emphasized ? "2.25" : "1.75");
      anchor.setAttribute("fill", emphasized ? "#0099FF" : "#ffffff");
      anchor.setAttribute("stroke", emphasized ? "#ffffff" : "#0099FF");
      anchor.setAttribute("stroke-width", emphasized ? "1" : "0.75");
      anchor.setAttribute("data-pe-visual-anchor", "");
      if (interactive) {
        anchor.style.cursor = "pointer";
        anchor.style.pointerEvents = "auto";
        anchor.setAttribute("data-pe-point", `${pointIndex}`);
        anchor.setAttribute("data-pe-handle", "anchor");
        anchor.setAttribute("tabindex", "0");
        anchor.setAttribute("role", "button");
        anchor.setAttribute("aria-label", `Anchor ${pointIndex + 1}: ${point.type === "smooth" ? "curved" : "corner"}`);
      }
      editSvg.appendChild(anchor);

      for (const handleName of ["cpIn", "cpOut"] as const) {
        const handle = point[handleName];
        if (!handle) continue;
        const handleX = (handle.x - mapping.vbX) * mapping.svgScaleX + mapping.svgLeft;
        const handleY = (handle.y - mapping.vbY) * mapping.svgScaleY + mapping.svgTop;
        const color = handleName === "cpIn" ? "#F59E0B" : "#8B5CF6";

        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", `${px}`); line.setAttribute("y1", `${py}`);
        line.setAttribute("x2", `${handleX}`); line.setAttribute("y2", `${handleY}`);
        line.setAttribute("stroke", color); line.setAttribute("stroke-width", "1");
        line.setAttribute("opacity", "0.55"); line.style.pointerEvents = "none";
        editSvg.appendChild(line);

        const control = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        control.setAttribute("cx", `${handleX}`); control.setAttribute("cy", `${handleY}`);
        control.setAttribute("r", "1.75"); control.setAttribute("fill", color);
        control.setAttribute("stroke", "#fff"); control.setAttribute("stroke-width", "0.75");
        if (interactive) {
          control.style.cursor = "move";
          control.style.pointerEvents = "auto";
          control.setAttribute("data-pe-point", `${pointIndex}`);
          control.setAttribute("data-pe-handle", handleName);
          control.setAttribute("aria-label", `${handleName === "cpIn" ? "Incoming" : "Outgoing"} handle for anchor ${pointIndex + 1}`);
        }
        editSvg.appendChild(control);
        if (interactive) {
          editSvg.appendChild(makeVertexHitCircle(handleX, handleY, pointIndex, handleName));
        }
      }
      if (interactive) {
        editSvg.appendChild(makeVertexHitCircle(px, py, pointIndex, "anchor"));
      }
    }
    if (interactive) vertexScreenPointsRef.current = screenPoints;
  }

  /** Re-apply hover/insert visuals to the live edit overlay after a rebuild. */
  function refreshHoverVisuals(): void {
    const editSvg = pointEditOverlayRef.current;
    if (!editSvg) return;
    // Segment-insert indicator: a subtle prospective vertex at the projection.
    editSvg.querySelectorAll("[data-pe-insert]").forEach(node => node.remove());
    const segment = hoveredSegmentRef.current;
    if (segment && hoveredVertexIndexRef.current === null) {
      const marker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      marker.setAttribute("cx", `${segment.x}`);
      marker.setAttribute("cy", `${segment.y}`);
      marker.setAttribute("r", "1.75");
      marker.setAttribute("fill", "#ffffff");
      marker.setAttribute("stroke", "#0099FF");
      marker.setAttribute("stroke-width", "0.75");
      marker.style.pointerEvents = "none";
      marker.setAttribute("data-pe-insert", "");
      editSvg.appendChild(marker);
    }
    // Vertex circles: repaint hovered/selected vs. idle per the spec palette.
    editSvg.querySelectorAll("[data-pe-visual-anchor]").forEach(node => {
      const index = Number.parseInt(node.getAttribute("data-pe-point") || "-1", 10);
      const emphasized = hoveredVertexIndexRef.current === index || selectedVerticesRef.current.has(index);
      node.setAttribute("r", emphasized ? "2.25" : "1.75");
      node.setAttribute("fill", emphasized ? "#0099FF" : "#ffffff");
      node.setAttribute("stroke", emphasized ? "#ffffff" : "#0099FF");
      node.setAttribute("stroke-width", emphasized ? "1" : "0.75");
    });
  }

  /** Invisible 16px hit circle keeps the smaller visual anchors easy to grab. */
  function makeVertexHitCircle(cx: number, cy: number, pointIndex: number, handle: "anchor" | "cpIn" | "cpOut"): SVGCircleElement {
    const hit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    hit.setAttribute("cx", `${cx}`);
    hit.setAttribute("cy", `${cy}`);
    hit.setAttribute("r", "8");
    hit.setAttribute("fill", "transparent");
    hit.setAttribute("stroke", "none");
    hit.style.cursor = handle === "anchor" ? "pointer" : "move";
    hit.style.pointerEvents = "auto";
    hit.setAttribute("data-pe-point", `${pointIndex}`);
    hit.setAttribute("data-pe-handle", handle);
    return hit;
  }

  /** Resolve a shape/path layer whose vertices are already editable. */
  function findVertexEditableTarget(target: Element): Element | null {
    const layer = target.closest?.("[data-layer-id]");
    if (!layer) return null;
    if ((layer.getAttribute("data-layer-kind") || "") === "text") return null;
    const path = layer.tagName.toLowerCase() === "path" ? layer : layer.querySelector("path");
    const d = path?.getAttribute("d");
    if (!path || !d) return null;
    try {
      if (parsePathData(d).length < 1) return null;
    } catch {
      return null;
    }
    return layer;
  }

  /** Convert a simple CSS shape into a real path before vertex editing. */
  function convertCssShapeToEditablePath(layer: Element): Element | null {
    if (!isConvertibleCssShape(layer)) return null;
    const content = shadowRef.current?.getElementById("__df_content");
    if (!content) return null;
    const computed = layer.ownerDocument.defaultView?.getComputedStyle(layer);
    if (!computed || computed.borderTopLeftRadius.includes("%")) return null;
    const rect = getVisualRect(layer);
    const z = zoomRef.current || 1;
    const width = Math.max(1, Number.parseFloat(computed.width) || rect.width / z);
    const height = Math.max(1, Number.parseFloat(computed.height) || rect.height / z);
    const svg = layer.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const attribute of [...layer.attributes]) {
      if (attribute.name !== "style" && attribute.name !== "data-layer-kind") svg.setAttribute(attribute.name, attribute.value);
    }
    svg.setAttribute("data-layer-kind", "svg");
    svg.setAttribute("data-shape-custom", "1");
    svg.setAttribute("data-css-shape-converted", "1");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("style", (layer as HTMLElement).style.cssText);
    // Keep all paint on the path. Clearing only background-color is not enough:
    // a background shorthand/image would keep drawing the original rectangle.
    svg.style.setProperty("background", "none", "important");
    svg.style.setProperty("background-color", "transparent", "important");
    svg.style.setProperty("background-image", "none", "important");
    svg.style.setProperty("border", "none", "important");
    svg.style.setProperty("border-radius", "0", "important");
    svg.style.setProperty("box-shadow", "none", "important");
    svg.style.setProperty("pointer-events", "none", "important");
    svg.style.overflow = "visible";
    const path = layer.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", serializePathData([
      { type: "anchor", x: 0, y: 0 },
      { type: "anchor", x: width, y: 0 },
      { type: "anchor", x: width, y: height },
      { type: "anchor", x: 0, y: height },
    ], true));
    const fill = computed.backgroundColor === "rgba(0, 0, 0, 0)" ? "none" : computed.backgroundColor;
    path.setAttribute("fill", fill);
    const strokeWidth = Number.parseFloat(computed.borderTopWidth) || 0;
    path.setAttribute("stroke", strokeWidth > 0 && computed.borderTopStyle !== "none" ? computed.borderTopColor : "none");
    path.setAttribute("stroke-width", `${strokeWidth}`);
    path.style.setProperty("pointer-events", "visiblePainted", "important");
    svg.appendChild(path);
    layer.replaceWith(svg);
    const updatedCss = updateCssRule(cssRef.current, getSelector(svg), importantProperties({
      "background": "none",
      "background-color": "transparent",
      "background-image": "none",
      "border": "none",
      "border-radius": "0",
      "box-shadow": "none",
      "pointer-events": "none",
      "overflow": "visible",
    }));
    emitFrameChange(updatedCss, content.innerHTML);
    return svg;
  }

  /**
   * Make a converted rectangle's SVG box follow its edited path bounds. The
   * viewBox and CSS box move together, so the path keeps the same screen
   * position while selection no longer points at the obsolete rectangle.
   */
  function persistConvertedShapeBounds(
    targetPath: Element,
    points: PathPoint[],
    closed: boolean,
  ): boolean {
    const svg = targetPath.closest("svg");
    const content = shadowRef.current?.getElementById("__df_content");
    if (!isConvertedCssShapeSvg(svg) || !content || points.length === 0) return false;

    svg.setAttribute("data-css-shape-converted", "1");
    svg.setAttribute("preserveAspectRatio", "none");
    const oldViewBox = (svg.getAttribute("viewBox") || "0 0 1 1").split(/\s+/).map(Number);
    const [oldX = 0, oldY = 0, oldWidthRaw = 1, oldHeightRaw = 1] = oldViewBox;
    const computed = svg.ownerDocument.defaultView?.getComputedStyle(svg);
    const fitted = fitPathBox(
      points,
      { x: oldX, y: oldY, width: oldWidthRaw, height: oldHeightRaw },
      {
        left: Number.parseFloat(computed?.left || "") || 0,
        top: Number.parseFloat(computed?.top || "") || 0,
        width: Number.parseFloat(computed?.width || "") || Math.max(Math.abs(oldWidthRaw) || 1, 1),
        height: Number.parseFloat(computed?.height || "") || Math.max(Math.abs(oldHeightRaw) || 1, 1),
      },
    );

    targetPath.setAttribute("d", serializePathData(points, closed));
    svg.setAttribute("viewBox", `${fitted.x} ${fitted.y} ${fitted.width} ${fitted.height}`);
    svg.style.setProperty("left", `${fitted.left}px`, "important");
    svg.style.setProperty("top", `${fitted.top}px`, "important");
    svg.style.setProperty("width", `${fitted.cssWidth}px`, "important");
    svg.style.setProperty("height", `${fitted.cssHeight}px`, "important");
    svg.style.setProperty("background", "none", "important");
    svg.style.setProperty("background-color", "transparent", "important");
    svg.style.setProperty("background-image", "none", "important");
    svg.style.setProperty("pointer-events", "none", "important");
    (targetPath as HTMLElement | SVGElement).style.setProperty("pointer-events", "visiblePainted", "important");

    const updatedCss = updateCssRule(cssRef.current, getSelector(svg), importantProperties({
      left: `${fitted.left}px`,
      top: `${fitted.top}px`,
      width: `${fitted.cssWidth}px`,
      height: `${fitted.cssHeight}px`,
      background: "none",
      "background-color": "transparent",
      "background-image": "none",
      border: "none",
      "border-radius": "0",
      "box-shadow": "none",
      "pointer-events": "none",
      overflow: "visible",
    }));
    emitFrameChange(updatedCss, content.innerHTML);
    return true;
  }

  /** Persist every vertex-mode mutation through the same converted-shape path. */
  function persistPathPointEdit(
    targetPath: Element,
    points: PathPoint[],
    closed: boolean,
    layerId: string,
  ): boolean {
    const newPath = serializePathData(points, closed);
    targetPath.setAttribute("d", newPath);
    targetPath.closest("svg")?.setAttribute("data-shape-custom", "1");
    if (persistConvertedShapeBounds(targetPath, points, closed)) return true;
    if (layerId) onEditPathPointsRef.current?.(layerId, newPath);
    return false;
  }

  /**
   * Recover the editable geometry of a shape path: base vertices (parametric
   * star/polygon or recovered corners), the uniform radius and the effective
   * per-vertex radii. Null when the path has no recoverable corner model.
   */
  function resolveShapeGeometry(pathOwner: Element) {
    const path = pathOwner.tagName.toLowerCase() === "path" ? pathOwner : pathOwner.querySelector("path");
    if (!path) return null;
    const layer = path.closest("[data-layer-id]");
    const svg = path.closest("svg");
    const holder = svg || layer;
    const d = path.getAttribute("d");
    if (!d || !holder) return null;
    const kind = holder.getAttribute("data-shape");
    const custom = holder.getAttribute("data-shape-custom") === "1";
    const uniform = Number(holder.getAttribute("data-shape-corner-radius")) || 0;
    let vertices: ShapeVertex[] | null;
    if ((kind === "star" || kind === "polygon") && !custom) {
      vertices = parametricVertices({
        kind,
        count: Number(holder.getAttribute("data-shape-count")) || (kind === "star" ? 5 : 6),
        ratio: Number(holder.getAttribute("data-shape-ratio")) || 0.4,
        size: Number(holder.getAttribute("data-shape-size")) || 120,
      });
    } else {
      vertices = cornersFromShapePath(d);
    }
    if (!vertices) return null;
    return {
      path,
      layerId: layer?.getAttribute("data-layer-id") || "",
      holder,
      vertices,
      uniform,
      radii: parseVertexRadiiAttr(holder.getAttribute("data-vr"), uniform, vertices.length),
    };
  }

  function refreshOverlay(el: Element) {
    const overlay = overlayRef.current;
    const shadow = shadowRef.current;
    if (!overlay || !shadow) return;
    // Set by the selection-border branch below; the rotate handle (and its
    // live drag) reuses it to spin the box in sync with the element.
    let selectionBox: HTMLDivElement | null = null;
    overlay.innerHTML = "";
    pointEditPathRef.current = null;
    pointEditOverlayRef.current = null;

    const content = shadow.getElementById("__df_content")!;
    const elRect = getVisualRect(el);
    const cRect = content.getBoundingClientRect();
    const z = zoomRef.current || 1;
    const x = (elRect.left - cRect.left) / z;
    const y = (elRect.top - cRect.top) / z;
    const w = elRect.width / z;
    const h = elRect.height / z;

    // Check if selected element is an SVG path (for point editing)
    const elTag = el.tagName.toLowerCase();
    const isPathEl = elTag === "path";
    const pathEl = isPathEl ? el : (el as Element).querySelector?.("path");
    const hasPath = isPathEl || !!pathEl;
    const targetPath = (isPathEl ? el : pathEl) as Element | null;
    const pathData = targetPath?.getAttribute("d");

    // ── OBB (phase 1, rotate-only transforms) ──
    // An axis-aligned envelope around a rotated shape shows permanent gaps
    // at the corners. When the element carries a PURE rotation (matrix
    // without translate components, no independent rotate/scale/translate
    // properties), draw the LAYOUT box rotated by the same angle around the
    // same transform-origin — it hugs the shape and turns with it. Anything
    // else keeps the legacy AABB behaviour.
    let obbAngle = 0;
    let boxX = x, boxY = y, boxW = w, boxH = h;
    const elStyle = (el as HTMLElement).ownerDocument.defaultView!.getComputedStyle(el);
    const matrixMatch = elStyle.transform !== "none" ? elStyle.transform.match(/matrix\(([^)]+)\)/) : null;
    const independentPropsClean = elStyle.rotate === "none"
      && elStyle.scale === "none" && elStyle.translate === "none";
    if (matrixMatch && independentPropsClean) {
      const [m11, m12, , , m41, m42] = matrixMatch[1].split(",").map(Number);
      if (Number.isFinite(m11) && Number.isFinite(m12)
        && Math.abs(m41) < 0.01 && Math.abs(m42) < 0.01) {
        const layoutLeft = parseFloat(elStyle.left);
        const layoutTop = parseFloat(elStyle.top);
        const layoutWidth = parseFloat(elStyle.width);
        const layoutHeight = parseFloat(elStyle.height);
        if ([layoutLeft, layoutTop, layoutWidth, layoutHeight].every(Number.isFinite)) {
          obbAngle = Math.atan2(m12, m11);
          if (obbAngle !== 0) {
            boxX = layoutLeft; boxY = layoutTop; boxW = layoutWidth; boxH = layoutHeight;
          }
        }
      }
    }

    // Radius widgets are intentionally absent until the selected shape is hovered.

    // If this is an SVG path, render point editing overlay — but only in
    // explicit vertex-edit mode (F4 A2: entered by double-clicking the shape).
    const selectedLayerIdForMode = closestLayerId(el);
    const isVertexEditMode = !!vertexEditModeRef.current
      && vertexEditModeRef.current.layerId === selectedLayerIdForMode;

    // Spec F4: vertex-edit mode hides the selection bounding box (and the
    // radius/resize widgets live in the else-branch below) — only the vector
    // network is visible.
    if (!isVertexEditMode) {
      // Selection border — OBB: rotated with the element for pure-rotation
      // transforms, so it hugs rotated shapes and turns with them in real
      // time (the rotate drag below spins this same box).
      const box = document.createElement("div");
      Object.assign(box.style, {
        position: "absolute",
        left: `${boxX}px`, top: `${boxY}px`,
        width: `${boxW}px`, height: `${boxH}px`,
        border: `2px solid ${SEL}`,
        pointerEvents: "none",
        boxSizing: "border-box",
        transformOrigin: elStyle.transformOrigin,
        transform: obbAngle ? `rotate(${obbAngle}rad)` : "",
      });
      overlay.appendChild(box);
      selectionBox = box;
    }
    if (hasPath && pathData && targetPath && isVertexEditMode) {
      const points = parsePathData(pathData);
      const closed = isPathClosed(pathData);
      const layerId = el.getAttribute("data-layer-id") || targetPath.getAttribute("data-layer-id");
      pointEditPathRef.current = { layerId: layerId || "", points, closed };

      // Create point edit SVG overlay
      const editSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      editSvg.setAttribute("width", "100%");
      editSvg.setAttribute("height", "100%");
      Object.assign(editSvg.style, {
        position: "absolute", top: "0", left: "0",
        width: "100%", height: "100%",
        pointerEvents: "none", zIndex: "10000",
        overflow: "visible",
      });
      overlay.appendChild(editSvg);
      pointEditOverlayRef.current = editSvg;

      // Get SVG element's viewBox offset
      const svgEl = targetPath.closest("svg");
      const svgRect = svgEl?.getBoundingClientRect();
      const svgVbStr = svgEl?.getAttribute("viewBox");
      let vbX = 0, vbY = 0, vbWidth = 0, vbHeight = 0;
      if (svgVbStr) {
        const vbp = svgVbStr.split(/\s+/);
        vbX = parseFloat(vbp[0]) || 0;
        vbY = parseFloat(vbp[1]) || 0;
        vbWidth = parseFloat(vbp[2]) || 0;
        vbHeight = parseFloat(vbp[3]) || 0;
      }
      // Offset from content rect to SVG rect
      const svgLeft = svgRect ? (svgRect.left - cRect.left) / z : x;
      const svgTop = svgRect ? (svgRect.top - cRect.top) / z : y;
      const svgScaleX = svgRect && vbWidth ? (svgRect.width / z) / vbWidth : 1;
      const svgScaleY = svgRect && vbHeight ? (svgRect.height / z) / vbHeight : 1;

      vertexPathElRef.current = targetPath;
      const mapping: VectorMapping = { vbX, vbY, svgScaleX, svgScaleY, svgLeft, svgTop };
      renderVectorNetwork(editSvg, points, mapping, closed, true);

      // ── Spec F4: click anywhere on a segment to insert a vertex there.
      // Transparent 16px hit bands (±8px tolerance) over each segment; the
      // vertex circles are appended before them, so anchors win on overlap. ──
      if (points.length >= 2) {
        const screen = vertexScreenPointsRef.current;
        const segmentCount = closed ? points.length : points.length - 1;
        for (let startIndex = 0; startIndex < segmentCount; startIndex++) {
          const a = screen[startIndex];
          const b = screen[(startIndex + 1) % screen.length];
          if (!a || !b || (a.x === b.x && a.y === b.y)) continue;
          const segLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
          segLine.setAttribute("x1", `${a.x}`); segLine.setAttribute("y1", `${a.y}`);
          segLine.setAttribute("x2", `${b.x}`); segLine.setAttribute("y2", `${b.y}`);
          segLine.setAttribute("stroke", "transparent");
          segLine.setAttribute("stroke-width", "16");
          segLine.style.cursor = "copy";
          segLine.style.pointerEvents = "auto";
          segLine.setAttribute("data-pe-seg", `${startIndex}`);
          segLine.setAttribute("aria-label", `Insert vertex on segment ${startIndex + 1}`);
          // Keep the broad segment target behind the visible anchors so it
          // cannot steal a vertex drag where their hit areas overlap.
          editSvg.insertBefore(segLine, editSvg.firstChild);
        }
      }

      // Restore hover/insert visuals after the rebuild.
      refreshHoverVisuals();

      const persistPointEdit = (editData: { layerId: string; points: PathPoint[]; closed: boolean }) => {
        if (persistPathPointEdit(targetPath, editData.points, editData.closed, editData.layerId)) {
          refreshOverlay(targetPath.closest("[data-layer-id]") || el);
        }
      };

      const startVertexDrag = (
        editData: { layerId: string; points: PathPoint[]; closed: boolean },
        indices: number[],
        originIndex: number,
        dragHandle: "anchor" | "cpIn" | "cpOut",
      ) => {
        let workingPoints = editData.points;
        vertexDraggingRef.current = true;
        hoveredVertexIndexRef.current = null;
        hoveredSegmentRef.current = null;

        const svgEl2 = targetPath.closest("svg");
        const svgRect2 = svgEl2?.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();
        const svgLeft2 = svgRect2 ? (svgRect2.left - contentRect.left) / z : x;
        const svgTop2 = svgRect2 ? (svgRect2.top - contentRect.top) / z : y;
        const viewBox = (svgEl2?.getAttribute("viewBox") || "0 0 0 0").split(/\s+/).map(Number);
        const [vbX2 = 0, vbY2 = 0, vbWidth2 = 0, vbHeight2 = 0] = viewBox;
        const svgScaleX2 = svgRect2 && vbWidth2 ? (svgRect2.width / z) / vbWidth2 : 1;
        const svgScaleY2 = svgRect2 && vbHeight2 ? (svgRect2.height / z) / vbHeight2 : 1;
        const snapTolerance = 6 / (z * (((svgScaleX2 + svgScaleY2) / 2) || 1));

        const drawSmartGuides = (guideX: number | null, guideY: number | null) => {
          // A rAF flush may have rebuilt the overlay — draw into the live svg.
          const liveSvg = pointEditOverlayRef.current || editSvg;
          liveSvg.querySelectorAll("[data-pe-guide]").forEach(node => node.remove());
          const drawLine = (x1: number | string, y1: number | string, x2: number | string, y2: number | string) => {
            const guide = document.createElementNS("http://www.w3.org/2000/svg", "line");
            guide.setAttribute("x1", `${x1}`);
            guide.setAttribute("y1", `${y1}`);
            guide.setAttribute("x2", `${x2}`);
            guide.setAttribute("y2", `${y2}`);
            guide.setAttribute("stroke", "#F59E0B");
            guide.setAttribute("stroke-width", "1");
            guide.setAttribute("stroke-dasharray", "4 3");
            guide.setAttribute("opacity", "0.9");
            guide.style.pointerEvents = "none";
            guide.setAttribute("data-pe-guide", "");
            liveSvg.appendChild(guide);
          };
          if (guideX != null) {
            const gx = (guideX - vbX2) * svgScaleX2 + svgLeft2;
            drawLine(gx, 0, gx, "100%");
          }
          if (guideY != null) {
            const gy = (guideY - vbY2) * svgScaleY2 + svgTop2;
            drawLine(0, gy, "100%", gy);
          }
        };

        const eventToPathPoint = (mouseEvent: MouseEvent): Point => ({
          x: Math.round((((mouseEvent.clientX - contentRect.left) / z - svgLeft2) / svgScaleX2 + vbX2) * 10) / 10,
          y: Math.round((((mouseEvent.clientY - contentRect.top) / z - svgTop2) / svgScaleY2 + vbY2) * 10) / 10,
        });

        // Offsets of every dragged vertex from the origin, captured at drag
        // start so a multi-selection moves as a rigid set.
        const originPoint = workingPoints[originIndex];
        const offsets = new Map<number, Point>();
        indices.forEach(index => offsets.set(index, {
          x: workingPoints[index].x - originPoint.x,
          y: workingPoints[index].y - originPoint.y,
        }));

        // rAF throttle: accumulate the newest position, repaint once/frame.
        let pendingPosition: Point | null = null;
        let pendingAlt = false;
        let pendingGuides: { guideX: number | null; guideY: number | null } = { guideX: null, guideY: null };
        let rafId = 0;

        const flushPosition = (position: Point, guides: { guideX: number | null; guideY: number | null }) => {
          if (dragHandle === "anchor") {
            for (const index of indices) {
              const offset = offsets.get(index);
              if (!offset) continue;
              workingPoints = movePathPoint(workingPoints, index, index === originIndex
                ? position
                : { x: position.x + offset.x, y: position.y + offset.y });
            }
          } else {
            const remainsLinked = workingPoints[originIndex].type === "smooth" && !pendingAlt;
            workingPoints = movePathHandle(workingPoints, originIndex, dragHandle, position, remainsLinked);
          }
          editData.points = workingPoints;
          targetPath.setAttribute("d", serializePathData(workingPoints, editData.closed));
          refreshOverlay(el);
          drawSmartGuides(guides.guideX, guides.guideY);
        };

        const onPointMove = (mouseEvent: MouseEvent) => {
          const position = eventToPathPoint(mouseEvent);
          let snapped = position;
          let guideX: number | null = null;
          let guideY: number | null = null;
          if (dragHandle === "anchor") {
            // F4: smart guides — snap the dragged vertex to any other
            // anchor's X/Y so custom figures stay straight.
            for (let other = 0; other < workingPoints.length; other++) {
              if (other === originIndex) continue;
              if (guideX === null && Math.abs(workingPoints[other].x - position.x) < snapTolerance) {
                snapped = { ...snapped, x: workingPoints[other].x };
                guideX = workingPoints[other].x;
              }
              if (guideY === null && Math.abs(workingPoints[other].y - position.y) < snapTolerance) {
                snapped = { ...snapped, y: workingPoints[other].y };
                guideY = workingPoints[other].y;
              }
            }
          }
          pendingPosition = snapped;
          pendingAlt = mouseEvent.altKey;
          pendingGuides = { guideX, guideY };
          if (rafId) return;
          rafId = requestAnimationFrame(() => {
            rafId = 0;
            if (pendingPosition) flushPosition(pendingPosition, pendingGuides);
          });
        };

        const onPointUp = () => {
          document.removeEventListener("mousemove", onPointMove);
          document.removeEventListener("mouseup", onPointUp);
          vertexDraggingRef.current = false;
          if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
          if (pendingPosition) flushPosition(pendingPosition, pendingGuides);
          drawSmartGuides(null, null);
          persistPointEdit(editData);
        };
        document.addEventListener("mousemove", onPointMove);
        document.addEventListener("mouseup", onPointUp);
      };

      editSvg.addEventListener("mousedown", (event: Event) => {
        const target = event.target as SVGElement;

        // ── Spec F4: click a segment → insert a vertex AT the click point ──
        const segAttribute = target.getAttribute("data-pe-seg");
        if (segAttribute != null) {
          event.stopPropagation();
          event.preventDefault();
          const editData = pointEditPathRef.current;
          const screen = vertexScreenPointsRef.current;
          if (!editData || !screen) return;
          const startIndex = Number.parseInt(segAttribute, 10);
          const endIndex = Math.min(startIndex + 1, editData.points.length);
          const a = screen[startIndex];
          const b = screen[(startIndex + 1) % screen.length];
          if (!a || !b) return;
          // Fraction of the click along the segment (clamped 0..1).
          const mouseOverlay = {
            x: ((event as MouseEvent).clientX - cRect.left) / z,
            y: ((event as MouseEvent).clientY - cRect.top) / z,
          };
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const lengthSq = dx * dx + dy * dy;
          const t = lengthSq === 0
            ? 0
            : Math.min(1, Math.max(0, ((mouseOverlay.x - a.x) * dx + (mouseOverlay.y - a.y) * dy) / lengthSq));
          const withInsert = splitPathSegment(editData.points, endIndex, t, editData.closed);
          if (withInsert.length === editData.points.length) return;
          editData.points = withInsert;
          const insertedIndex = Math.min(endIndex, withInsert.length - 1);
          targetPath.setAttribute("d", serializePathData(withInsert, editData.closed));
          refreshOverlay(el);
          const refreshed = pointEditPathRef.current;
          if (refreshed) {
            selectedVerticesRef.current = new Set([insertedIndex]);
            startVertexDrag(refreshed, [insertedIndex], insertedIndex, "anchor");
          }
          return;
        }

        const pointAttribute = target.getAttribute("data-pe-point");
        const handle = target.getAttribute("data-pe-handle") as "anchor" | "cpIn" | "cpOut" | null;
        if (pointAttribute == null || !handle) return;
        event.stopPropagation();
        event.preventDefault();

        const pointIndex = Number.parseInt(pointAttribute, 10);
        const editData = pointEditPathRef.current;
        if (!editData?.points[pointIndex]) return;
        // Fitts: adjacent 12px hit circles overlap, so only a press that is
        // closest to this anchor counts as its drag.
        const screen = vertexScreenPointsRef.current;
        const mouseOverlay = {
          x: ((event as MouseEvent).clientX - cRect.left) / z,
          y: ((event as MouseEvent).clientY - cRect.top) / z,
        };
        if (handle === "anchor" && screen && getVertexAt(mouseOverlay.x, mouseOverlay.y, screen, 12) !== pointIndex) return;
        if (handle === "anchor" && !(event as MouseEvent).shiftKey) {
          selectedVerticesRef.current = new Set([pointIndex]);
        } else if (handle === "anchor") {
          const next = new Set(selectedVerticesRef.current);
          if (next.has(pointIndex)) next.delete(pointIndex);
          else next.add(pointIndex);
          selectedVerticesRef.current = next;
        }
        if (handle === "anchor" && selectedVerticesRef.current.has(pointIndex)) {
          startVertexDrag(editData, [...selectedVerticesRef.current], pointIndex, handle);
        } else if (handle !== "anchor") {
          startVertexDrag(editData, [pointIndex], pointIndex, handle);
        }
      });

      const toggleAnchor = (target: SVGElement) => {
        const pointAttribute = target.getAttribute("data-pe-point");
        if (pointAttribute == null || target.getAttribute("data-pe-handle") !== "anchor") return;
        const editData = pointEditPathRef.current;
        if (!editData) return;
        editData.points = toggleSmoothCorner(editData.points, Number.parseInt(pointAttribute, 10), editData.closed);
        persistPointEdit(editData);
        refreshOverlay(el);
      };

      editSvg.addEventListener("keydown", (event: Event) => {
        const keyboardEvent = event as KeyboardEvent;
        if (keyboardEvent.key !== "Enter" && keyboardEvent.key !== " ") return;
        keyboardEvent.stopPropagation();
        keyboardEvent.preventDefault();
        toggleAnchor(keyboardEvent.target as SVGElement);
      });
    } else if (selectionBox) {
      // Rotation handle (above selection box). Mounted INSIDE the selection
      // box so a rotated box carries it along (Figma-style orbit). Widget
      // offsets are padding-box relative: the extra -2px cancels the border.
      const rotLine = document.createElement("div");
      Object.assign(rotLine.style, {
        position: "absolute",
        left: `${boxW / 2 - 2.5}px`,
        top: `${-18}px`,
        width: "1px", height: "16px",
        borderLeft: "1px dashed rgba(59,130,246,0.4)",
        pointerEvents: "none",
      });
      selectionBox.appendChild(rotLine);

      const rotHandle = document.createElement("div");
      Object.assign(rotHandle.style, {
        position: "absolute",
        left: `${boxW / 2 - 9}px`,
        top: `${-26}px`,
        width: "14px", height: "14px",
        borderRadius: "50%",
        border: "2px solid #3B82F6",
        background: "rgba(59,130,246,0.15)",
        cursor: "grab",
        pointerEvents: "auto",
        boxSizing: "border-box",
      });
      selectionBox.appendChild(rotHandle);

      rotHandle.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const centerX = boxX + boxW / 2;
        const centerY = boxY + boxH / 2;
        const startAngle = Math.atan2(
          (e as MouseEvent).clientY - cRect.top - centerY * z,
          (e as MouseEvent).clientX - cRect.left - centerX * z
        );
        let currentRotation = 0;
        const selector = getSelector(el);
        const existingTransform = (el as HTMLElement).style.transform || getCssPropertyValue(cssRef.current, selector, "transform");
        const rotMatch = existingTransform.match(/rotate\(([^)]+)deg\)/);
        const baseRotation = rotMatch ? parseFloat(rotMatch[1]) : 0;

        const onRotMove = (ev: MouseEvent) => {
          const angle = Math.atan2(
            ev.clientY - cRect.top - centerY * z,
            ev.clientX - cRect.left - centerX * z
          );
          currentRotation = baseRotation + (angle - startAngle) * (180 / Math.PI);
          (el as HTMLElement).style.transform = setTransformFunction(existingTransform, "rotate", `${Math.round(currentRotation)}deg`);
          // Real-time box: spin the selection box (and its mounted handles)
          // with the element instead of waiting for the mouseup rebuild.
          if (selectionBox) selectionBox.style.transform = `rotate(${currentRotation}deg)`;
        };

        const onRotUp = () => {
          document.removeEventListener("mousemove", onRotMove);
          document.removeEventListener("mouseup", onRotUp);
          const finalTransform = Math.abs(currentRotation) < 0.5
            ? removeTransformFunction(existingTransform, "rotate") || "none"
            : setTransformFunction(existingTransform, "rotate", `${Math.round(currentRotation)}deg`);
          (el as HTMLElement).style.transform = finalTransform === "none" ? "" : finalTransform;
          const updated = updateCssRule(cssRef.current, selector, { transform: finalTransform });
          emitFrameChange(updated, content.innerHTML);
        };

        document.addEventListener("mousemove", onRotMove);
        document.addEventListener("mouseup", onRotUp);
      });

      // Vertex geometry is intentionally absent in normal selection mode.
      // Radius widgets are mounted separately, only while the selected shape
      // is hovered.
    }

    if (!isVertexEditMode && selectionBox) {
      const handles: [ResizeDirection, number, number, string][] = [
        ["nw", 0, 0, "nwse-resize"], ["n", 0.5, 0, "ns-resize"], ["ne", 1, 0, "nesw-resize"],
        ["w", 0, 0.5, "ew-resize"], ["e", 1, 0.5, "ew-resize"],
        ["sw", 0, 1, "nesw-resize"], ["s", 0.5, 1, "ns-resize"], ["se", 1, 1, "nwse-resize"],
      ];
      // Resize handles live INSIDE the selection box so a rotated box
      // carries them along. Resize MATH on rotated shapes stays phase 2 —
      // for unrotated elements boxX/Y/W/H equal the legacy AABB values.
      for (const [direction, cx, cy, cursor] of handles) {
        const handle = document.createElement("div");
        Object.assign(handle.style, {
          position: "absolute",
          left: `${cx * boxW - HANDLE / 2 - 2}px`,
          top: `${cy * boxH - HANDLE / 2 - 2}px`,
          width: `${HANDLE}px`, height: `${HANDLE}px`,
          background: SEL, border: "1px solid #fff",
          cursor, pointerEvents: "auto", boxSizing: "border-box",
        });
        selectionBox.appendChild(handle);
        handle.addEventListener("mousedown", (e) => {
          e.stopPropagation();
          e.preventDefault();
          startResize(el, e as MouseEvent, direction, boxX, boxY, boxW, boxH);
        });
      }
    }
  }

  const penPointsRef = useRef<PathPoint[]>([]);
  const penSvgRef = useRef<SVGElement | null>(null);
  // Point editing state
  const pointEditPathRef = useRef<{ layerId: string; points: PathPoint[]; closed: boolean } | null>(null);
  const pointEditOverlayRef = useRef<SVGElement | null>(null);

  // ── Pen preview renderer (supports bezier curves) ──
  function drawPenPreview(content: HTMLElement, pts: PathPoint[], draftPoint?: PathPoint) {
    // Ensure SVG container
    if (!penSvgRef.current) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      Object.assign(svg.style, {
        position: "absolute", top: "0", left: "0",
        width: "100%", height: "100%",
        pointerEvents: "none", zIndex: "9998",
        overflow: "visible",
      });
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "100%");
      content.appendChild(svg);
      penSvgRef.current = svg;
    }
    const svg = penSvgRef.current;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const previewPoints = draftPoint ? [...pts, draftPoint] : pts;
    if (previewPoints.length >= 1) {
      const pathD = serializePathData(previewPoints);

      const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
      pathEl.setAttribute("d", pathD);
      pathEl.setAttribute("fill", "none");
      pathEl.setAttribute("stroke", "#8B5CF6");
      pathEl.setAttribute("stroke-width", "2");
      pathEl.setAttribute("stroke-dasharray", "6,3");
      pathEl.setAttribute("stroke-linecap", "round");
      svg.appendChild(pathEl);
    }

    // Draw anchor points
    for (const p of previewPoints) {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", `${p.x}`);
      circle.setAttribute("cy", `${p.y}`);
      circle.setAttribute("r", p.type === "smooth" ? "5" : "4");
      circle.setAttribute("fill", p.type === "smooth" ? "#A78BFA" : "#8B5CF6");
      circle.setAttribute("stroke", "#fff");
      circle.setAttribute("stroke-width", "1.5");
      svg.appendChild(circle);

      // Draw control handles for bezier points
      if (p.cpIn) {
        const line1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line1.setAttribute("x1", `${p.x}`);
        line1.setAttribute("y1", `${p.y}`);
        line1.setAttribute("x2", `${p.cpIn.x}`);
        line1.setAttribute("y2", `${p.cpIn.y}`);
        line1.setAttribute("stroke", "#A78BFA");
        line1.setAttribute("stroke-width", "1");
        line1.setAttribute("opacity", "0.5");
        svg.appendChild(line1);

        const c1 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        c1.setAttribute("cx", `${p.cpIn.x}`); c1.setAttribute("cy", `${p.cpIn.y}`);
        c1.setAttribute("r", "3"); c1.setAttribute("fill", "#F59E0B");
        c1.setAttribute("stroke", "#fff"); c1.setAttribute("stroke-width", "1");
        svg.appendChild(c1);
      }
      if (p.cpOut) {
        const line2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line2.setAttribute("x1", `${p.x}`);
        line2.setAttribute("y1", `${p.y}`);
        line2.setAttribute("x2", `${p.cpOut.x}`);
        line2.setAttribute("y2", `${p.cpOut.y}`);
        line2.setAttribute("stroke", "#8B5CF6");
        line2.setAttribute("stroke-width", "1");
        line2.setAttribute("opacity", "0.5");
        svg.appendChild(line2);

        const c2 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        c2.setAttribute("cx", `${p.cpOut.x}`); c2.setAttribute("cy", `${p.cpOut.y}`);
        c2.setAttribute("r", "3"); c2.setAttribute("fill", "#8B5CF6");
        c2.setAttribute("stroke", "#fff"); c2.setAttribute("stroke-width", "1");
        svg.appendChild(c2);
      }
    }

  }

  function setupInteraction(shadow: ShadowRoot, content: HTMLElement, overlay: HTMLElement) {
    const DRAG_THRESHOLD = 4;

    // ── Sprint 3: Scope-based hit testing ──
    // Resolves what element a click should select based on current scope.
    // - Normal click → top-level ancestor within scope (child of scope/content)
    // - Ctrl/Cmd+click → deep select (exact element under cursor)
    function resolveHitTarget(target: Element, scope: Element | null, ctrlKey: boolean): Element | null {
      if (target === content || target.closest?.("#__df_overlay")) return null;
      // Legacy converted rectangles may still expose the transparent SVG host
      // as the event target. Only their painted child path is selectable.
      if (isConvertedCssShapeSvg(target)) return null;
      const textBlock = target.closest?.('[data-layer-kind="text"][data-layer-id]');
      if (textBlock && content.contains(textBlock)) return textBlock;
      // Ctrl/Cmd+click: deep select — nearest ancestor with data-layer-id
      if (ctrlKey) {
        let el: Element | null = target;
        while (el && el !== content) {
          if (el.hasAttribute("data-layer-id")) return el;
          el = el.parentElement;
        }
        return target as Element;
      }
      const root = scope || content;
      // Walk up to find direct child of root
      let el: Element | null = target as Element;
      while (el && el.parentElement && el.parentElement !== root) {
        el = el.parentElement;
      }
      if (el && el.parentElement === root && el.hasAttribute("data-layer-id")) return el;
      // Fallback: nearest ancestor with data-layer-id
      el = target as Element;
      while (el && el !== content) {
        if (el.hasAttribute("data-layer-id")) return el;
        el = el.parentElement;
      }
      return target as Element;
    }

    function showHoverPreview(el: Element) {
      hideHoverPreview();
      const cRect = content.getBoundingClientRect();
      const elRect = getVisualRect(el);
      const z = zoomRef.current || 1;
      const preview = document.createElement("div");
      preview.id = "__df_hover_preview";
      Object.assign(preview.style, {
        position: "absolute",
        left: `${(elRect.left - cRect.left) / z}px`,
        top: `${(elRect.top - cRect.top) / z}px`,
        width: `${elRect.width / z}px`,
        height: `${elRect.height / z}px`,
        border: "1px solid rgba(59,130,246,0.5)",
        background: "rgba(59,130,246,0.04)",
        pointerEvents: "none",
        boxSizing: "border-box",
        zIndex: "9998",
      });
      overlay.appendChild(preview);
      hoverPreviewRef.current = preview;

      hoverTargetRef.current = el;
    }

    function showSelectedRadiusHandles(el: Element) {
      hideHoverPreview();
      hoverTargetRef.current = el;
      const cRect = content.getBoundingClientRect();
      const elRect = getVisualRect(el);
      const z = zoomRef.current || 1;
      const x = (elRect.left - cRect.left) / z;
      const y = (elRect.top - cRect.top) / z;
      const w = elRect.width / z;
      const h = elRect.height / z;
      const path = el.tagName.toLowerCase() === "path" ? el : el.querySelector?.("path");
      const d = path?.getAttribute("d");
      if (path && d && cornersFromShapePath(d) !== null) {
        const geom = resolveShapeGeometry(el);
        if (geom) {
          renderRadiusHandles(geom, el, x, y, w, h);
          hoverRadiusRef.current = true;
        }
      } else if (el.tagName.toLowerCase() === "div" && el.getAttribute("data-layer-kind") === "shape") {
        renderCssRadiusHandles(el, x, y, w, h);
        hoverRadiusRef.current = true;
      }
    }

    function hideHoverPreview() {
      if (hoverPreviewRef.current) {
        hoverPreviewRef.current.remove();
        hoverPreviewRef.current = null;
      }
      hoverTargetRef.current = null;
      // Hover-owned radius handles leave without disturbing the selection UI.
      if (hoverRadiusRef.current) {
        hoverRadiusRef.current = false;
        if (!radiusDragRef.current) {
          overlay.querySelector("[data-radius-overlay]")?.remove();
          overlay.querySelector("[data-radius-label]")?.remove();
        }
      }
    }

    // ── Pen rubber band: preview the prospective segment between clicks ──
    // While the mouse is up, the next segment follows the cursor (Illustrator-style),
    // so the curve pulled by the previous drag is visible before committing a point.
    content.addEventListener("mousemove", (e: Event) => {
      const me = e as MouseEvent;

      // ── Pen rubber band ──
      if (activeToolRef.current === "pen" && me.buttons === 0) {
        const pts = penPointsRef.current;
        if (pts.length > 0) {
          const rect = content.getBoundingClientRect();
          const z = zoomRef.current || 1;
          const cursor = {
            x: Math.round((me.clientX - rect.left) / z),
            y: Math.round((me.clientY - rect.top) / z),
          };
          const closing = pts.length >= 2
            && Math.hypot(cursor.x - pts[0].x, cursor.y - pts[0].y) < 12;
          const draft: PathPoint = closing
            ? { type: "anchor", x: pts[0].x, y: pts[0].y, cpIn: pts[0].cpIn ? { ...pts[0].cpIn } : undefined }
            : { type: "anchor", ...cursor };
          drawPenPreview(content, pts, draft);
        }
        return;
      }

      // ── Hover preview (select/hand tool, no buttons pressed) ──
      if ((!activeToolRef.current || activeToolRef.current === "select" || activeToolRef.current === "hand") && me.buttons === 0) {
        if (vertexEditModeRef.current) return;
        const target = me.target as HTMLElement;
        if (!target || target === content) { hideHoverPreview(); return; }
        const hit = resolveHitTarget(target, scopeRef.current, me.ctrlKey || me.metaKey);
        if (hit && hit !== selectedRef.current) {
          showHoverPreview(hit);
        } else if (hit && hit === selectedRef.current) {
          if (hoverTargetRef.current !== hit || !hoverRadiusRef.current) showSelectedRadiusHandles(hit);
        } else if (!hit) {
          hideHoverPreview();
        }
      }
    });

    // ── Hide hover preview when mouse leaves the frame ──
    content.addEventListener("mouseleave", (event: Event) => {
      const relatedTarget = (event as MouseEvent).relatedTarget;
      if (relatedTarget instanceof Node && overlay.contains(relatedTarget)) return;
      hideHoverPreview();
    });

    // ── Varita (F2): transient click-prompt UI — markers, hint, commit ──
    function clearWandState() {
      wandPointsRef.current = [];
      wandLastRef.current = null;
      wandContextRef.current = null;
      wandKeysCleanupRef.current?.();
      wandKeysCleanupRef.current = null;
      wandMarkersRef.current?.remove();
      wandMarkersRef.current = null;
      wandHintRef.current?.remove();
      wandHintRef.current = null;
    }

    function drawWandMarkers(content: HTMLElement) {
      const points = wandPointsRef.current;
      let svg = wandMarkersRef.current;
      if (!svg) {
        svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        Object.assign(svg.style, {
          position: "absolute", left: "0px", top: "0px", width: "100%", height: "100%",
          overflow: "visible", pointerEvents: "none", zIndex: "9998",
        });
        content.appendChild(svg);
        wandMarkersRef.current = svg;
      }
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      points.forEach((p, i) => {
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", String(p.fx));
        circle.setAttribute("cy", String(p.fy));
        circle.setAttribute("r", "6");
        circle.setAttribute("fill", p.neg ? "#EF4444" : "#22C55E");
        circle.setAttribute("stroke", "#ffffff");
        circle.setAttribute("stroke-width", "2");
        svg.appendChild(circle);
        if (i === 0) {
          const count = document.createElementNS("http://www.w3.org/2000/svg", "text");
          count.setAttribute("x", String(p.fx + 9));
          count.setAttribute("y", String(p.fy - 9));
          count.setAttribute("fill", "#ffffff");
          count.setAttribute("font-size", "11");
          count.setAttribute("font-weight", "700");
          count.textContent = String(points.length);
          svg.appendChild(count);
        }
      });
    }

    function showWandHint(content: HTMLElement) {
      if (wandHintRef.current) return;
      const chip = document.createElement("div");
      Object.assign(chip.style, {
        position: "absolute", left: "50%", top: "12px", transform: "translateX(-50%)",
        padding: "4px 12px", borderRadius: "8px",
        background: "rgba(30,30,30,0.85)", color: "#e5e5e5",
        fontSize: "11px", lineHeight: 1.4, whiteSpace: "nowrap",
        pointerEvents: "none", zIndex: "9998",
      });
      chip.textContent = "Varita — clic: incluir · Alt+clic: excluir · doble clic o Enter: segmentar · Esc: limpiar";
      content.appendChild(chip);
      wandHintRef.current = chip;
    }

    function commitWand(content: HTMLElement) {
      const ctx = wandContextRef.current;
      const points = wandPointsRef.current.map(p => ({ x: p.nx, y: p.ny, neg: p.neg }));
      if (!ctx || points.length === 0) return;
      clearWandState();
      onWandSegmentRef.current?.(ctx.imageLayerId, ctx.src, points);
    }

    // ── Unified mousedown handler ──
    content.addEventListener("mousedown", (e: Event) => {
      const me = e as MouseEvent;
      if (me.button !== 0) return;
      const target = me.target as HTMLElement;
      const tool = activeToolRef.current;
      const rect = content.getBoundingClientRect();
      const z = zoomRef.current || 1;
      const mx = (me.clientX - rect.left) / z;
      const my = (me.clientY - rect.top) / z;

      // ── Drawing tools: rect / circle / triangle / star / polygon → drag-to-draw ──
      if (tool === "rect" || tool === "circle" || tool === "triangle" || tool === "star" || tool === "polygon") {
        e.stopPropagation();
        e.preventDefault();
        onActivate(frame.id);

        const startX = mx;
        const startY = my;
        let drawing = false;

        // Create preview element
        const preview = document.createElement("div");
        Object.assign(preview.style, {
          position: "absolute",
          left: `${startX}px`, top: `${startY}px`,
          width: "0px", height: "0px",
          border: `2px dashed ${tool === "rect" ? "#3B82F6" : "#EF4444"}`,
          background: tool === "rect" ? "rgba(59,130,246,0.1)" : "rgba(239,68,68,0.1)",
          borderRadius: tool === "circle" ? "50%" : "4px",
          pointerEvents: "none",
          boxSizing: "border-box",
          zIndex: "9998",
        });
        content.appendChild(preview);

        // Shift constrains to square/circle; Alt draws from the center outward.
        const dragRect = (ev: MouseEvent) => {
          const cx = (ev.clientX - rect.left) / z;
          const cy = (ev.clientY - rect.top) / z;
          let w = cx - startX;
          let h = cy - startY;
          if (ev.shiftKey) {
            const size = Math.max(Math.abs(w), Math.abs(h));
            w = w < 0 ? -size : size;
            h = h < 0 ? -size : size;
          }
          if (ev.altKey) {
            return { x: startX - Math.abs(w), y: startY - Math.abs(h), w: Math.abs(w) * 2, h: Math.abs(h) * 2 };
          }
          return {
            x: w < 0 ? startX + w : startX,
            y: h < 0 ? startY + h : startY,
            w: Math.abs(w),
            h: Math.abs(h),
          };
        };

        const onMove = (ev: MouseEvent) => {
          drawing = true;
          const box = dragRect(ev);
          preview.style.left = `${box.x}px`;
          preview.style.top = `${box.y}px`;
          preview.style.width = `${box.w}px`;
          preview.style.height = `${box.h}px`;
        };

        const onUp = (ev: MouseEvent) => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          preview.remove();

          if (!drawing) {
            // Short click → place default-sized primitive
            onAddPrimitiveRef.current?.(tool, Math.round(startX), Math.round(startY));
            return;
          }

          const box = dragRect(ev);
          const finalX = Math.round(box.x);
          const finalY = Math.round(box.y);
          const finalW = Math.max(10, Math.round(box.w));
          const finalH = Math.max(10, Math.round(box.h));

          const sides = (tool === "polygon" && ev.shiftKey) ? prompt("Number of sides?", "6") : undefined;
          const sidesNum = sides ? parseInt(sides) || 6 : undefined;
          onDrawShapeRef.current?.(tool, finalX, finalY, finalW, finalH, sidesNum);
        };

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        return;
      }

      // ── Pen tool: click to add points, drag for bezier handles ──
      if (tool === "pen") {
        e.stopPropagation();
        e.preventDefault();
        onActivate(frame.id);

        const point = { x: Math.round(mx), y: Math.round(my) };
        const pts = penPointsRef.current;

        // E0: Check if clicking near first point to close path
        if (pts.length >= 2) {
          const firstPt = pts[0];
          const dist = Math.hypot(point.x - firstPt.x, point.y - firstPt.y);
          if (dist < 12) {
            finalizePenPath(content, true);
            return;
          }
        }

        let dragged = false;

        const onPenMove = (ev: MouseEvent) => {
          const cx = (ev.clientX - rect.left) / z;
          const cy = (ev.clientY - rect.top) / z;
          const dx = cx - point.x;
          const dy = cy - point.y;
          const dist = Math.hypot(dx, dy);

          if (dist >= DRAG_THRESHOLD) {
            dragged = true;
            const outgoingHandle = { x: Math.round(cx), y: Math.round(cy) };
            drawPenPreview(content, pts, createSmoothPoint(point, outgoingHandle));
          }
        };

        const onPenUp = (ev: MouseEvent) => {
          document.removeEventListener("mousemove", onPenMove);
          document.removeEventListener("mouseup", onPenUp);

          if (!dragged) {
            // Click: add straight line point
            pts.push({ type: "anchor", ...point });
            drawPenPreview(content, pts);
          } else {
            const cx = (ev.clientX - rect.left) / z;
            const cy = (ev.clientY - rect.top) / z;
            pts.push(createSmoothPoint(point, { x: Math.round(cx), y: Math.round(cy) }));
            drawPenPreview(content, pts);
          }
        };

        document.addEventListener("mousemove", onPenMove);
        document.addEventListener("mouseup", onPenUp);
        return;
      }

      // ── Pen +: add point on an existing path segment ──
      if (tool === "pen-plus") {
        e.stopPropagation();
        e.preventDefault();
        onActivate(frame.id);

        const pathEls = content.querySelectorAll("svg path[d]");
        for (const pathEl of Array.from(pathEls)) {
          const d = pathEl.getAttribute("d");
          if (!d) continue;
          const points = parsePathData(d);
          const closed = isPathClosed(d);
          const closest = findClosestPathSegment(points, { x: mx, y: my }, closed);
          if (closest && closest.distance < 20) {
            const updated = splitPathSegment(points, closest.endIndex, closest.t, closed);
            pathEl.setAttribute("d", serializePathData(updated, closed));
            if (!persistConvertedShapeBounds(pathEl, updated, closed)) {
              emitFrameChange(cssRef.current, content.innerHTML);
            }
            return;
          }
        }
        return;
      }

      // ── Pen -: remove point from an existing path ──
      if (tool === "pen-minus") {
        e.stopPropagation();
        e.preventDefault();
        onActivate(frame.id);

        const pathEls = content.querySelectorAll("svg path[d]");
        for (const pathEl of Array.from(pathEls)) {
          const d = pathEl.getAttribute("d");
          if (!d) continue;
          const points = parsePathData(d);
          const closed = isPathClosed(d);

          // Find closest anchor point
          let bestIdx = -1;
          let bestDist = Infinity;
          for (let i = 0; i < points.length; i++) {
            const point = points[i];
            const dist = Math.hypot(mx - point.x, my - point.y);
            if (dist < bestDist) { bestDist = dist; bestIdx = i; }
          }

          if (bestDist < 12 && bestIdx >= 0 && points.length > 2) {
            const updated = deletePathPoint(points, bestIdx);
            pathEl.setAttribute("d", serializePathData(updated, closed));
            if (!persistConvertedShapeBounds(pathEl, updated, closed)) {
              emitFrameChange(cssRef.current, content.innerHTML);
            }
            return;
          }
        }
        return;
      }

      // ── Pen edit: convert straight segments to curves with handles ──
      if (tool === "pen-edit") {
        e.stopPropagation();
        e.preventDefault();
        onActivate(frame.id);

        const pathEls = content.querySelectorAll("svg path[d]");
        for (const pathEl of Array.from(pathEls)) {
          const d = pathEl.getAttribute("d");
          if (!d) continue;
          const points = parsePathData(d);
          const closed = isPathClosed(d);

          // Find closest anchor point
          let bestIdx = -1;
          let bestDist = Infinity;
          for (let i = 0; i < points.length; i++) {
            const point = points[i];
            const dist = Math.hypot(mx - point.x, my - point.y);
            if (dist < bestDist) { bestDist = dist; bestIdx = i; }
          }

          if (bestDist < 12 && bestIdx >= 0) {
            const anchor = points[bestIdx];
            let updated = points;
            let dragged = false;

            const onConvertMove = (mouseEvent: MouseEvent) => {
              const handle = {
                x: Math.round((mouseEvent.clientX - rect.left) / z),
                y: Math.round((mouseEvent.clientY - rect.top) / z),
              };
              if (Math.hypot(handle.x - anchor.x, handle.y - anchor.y) < DRAG_THRESHOLD) return;
              dragged = true;
              updated = points.map((point, index) => index === bestIdx ? createSmoothPoint(anchor, handle) : point);
              pathEl.setAttribute("d", serializePathData(updated, closed));
            };

            const onConvertUp = () => {
              document.removeEventListener("mousemove", onConvertMove);
              document.removeEventListener("mouseup", onConvertUp);
              if (!dragged) updated = toggleSmoothCorner(points, bestIdx, closed);
              pathEl.setAttribute("d", serializePathData(updated, closed));
              if (!persistConvertedShapeBounds(pathEl, updated, closed)) {
                emitFrameChange(cssRef.current, content.innerHTML);
              }
            };
            document.addEventListener("mousemove", onConvertMove);
            document.addEventListener("mouseup", onConvertUp);
            return;
          }
        }
        return;
      }

      // ── Pencil: freehand drawing ──
      if (tool === "pencil") {
        e.stopPropagation();
        e.preventDefault();
        onActivate(frame.id);

        const pencilPoints: { x: number; y: number }[] = [{ x: Math.round(mx), y: Math.round(my) }];

        // Ensure preview SVG exists
        if (!penSvgRef.current) {
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          Object.assign(svg.style, {
            position: "absolute", top: "0", left: "0",
            width: "100%", height: "100%",
            pointerEvents: "none", zIndex: "9998",
            overflow: "visible",
          });
          svg.setAttribute("width", "100%");
          svg.setAttribute("height", "100%");
          content.appendChild(svg);
          penSvgRef.current = svg;
        }

        const drawPencilPreview = () => {
          const svg = penSvgRef.current;
          if (!svg || pencilPoints.length < 2) return;
          while (svg.firstChild) svg.removeChild(svg.firstChild);
          let pd = `M ${pencilPoints[0].x} ${pencilPoints[0].y}`;
          for (let i = 1; i < pencilPoints.length; i++) {
            pd += ` L ${pencilPoints[i].x} ${pencilPoints[i].y}`;
          }
          const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
          pathEl.setAttribute("d", pd);
          pathEl.setAttribute("fill", "none");
          pathEl.setAttribute("stroke", "#8B5CF6");
          pathEl.setAttribute("stroke-width", "2");
          pathEl.setAttribute("stroke-linecap", "round");
          pathEl.setAttribute("stroke-linejoin", "round");
          svg.appendChild(pathEl);
        };

        const onPencilMove = (ev: MouseEvent) => {
          const cx = Math.round((ev.clientX - rect.left) / z);
          const cy = Math.round((ev.clientY - rect.top) / z);
          const last = pencilPoints[pencilPoints.length - 1];
          if (Math.hypot(cx - last.x, cy - last.y) >= 3) {
            pencilPoints.push({ x: cx, y: cy });
            drawPencilPreview();
          }
        };

        const onPencilUp = () => {
          document.removeEventListener("mousemove", onPencilMove);
          document.removeEventListener("mouseup", onPencilUp);
          if (pencilPoints.length >= 2) {
            penPointsRef.current = pencilPoints.map(p => ({ type: "anchor", x: p.x, y: p.y }));
            finalizePenPath(content, false);
          }
        };

        document.addEventListener("mousemove", onPencilMove);
        document.addEventListener("mouseup", onPencilUp);
        return;
      }

      // ── Eraser (F4): non-destructive mask strokes over images, delete elsewhere ──
      if (tool === "eraser") {
        e.stopPropagation();
        e.preventDefault();
        onActivate(frame.id);

        // An <img> under the pointer gets a mask brush stroke; any other
        // top-level layer is deleted (the tool's second verb). Mask source
        // paths (the dashed selection outline) are pass-throughs: deleting
        // them would silently destroy the mask geometry.
        const imgEl = (target as Element)?.closest?.("img[data-layer-id]") as HTMLElement | null;
        const imageLayerId = imgEl?.getAttribute("data-layer-id");
        if (!imgEl || !imageLayerId) {
          const hit = resolveHitTarget(target as Element, scopeRef.current, false);
          const hitId = hit?.getAttribute("data-layer-id");
          const isMaskSource = Boolean(hit && (hit.matches("path[data-mask-for]") || hit.querySelector?.("path[data-mask-for]")));
          if (hitId && !isMaskSource) onElementDeleteRef.current?.(hitId);
          return;
        }

        // Brush trails are stored in image-local coordinates: the mask
        // document is sized to the img's rendered box, so subtract its
        // on-screen origin (zoom-aware) from the frame-space point.
        const imgRect = imgEl.getBoundingClientRect();
        const imgLeft = (imgRect.left - rect.left) / z;
        const imgTop = (imgRect.top - rect.top) / z;
        const size = brushSizeRef.current || 24;
        const mode = me.altKey ? "restore" : "erase";
        const points: Array<{ x: number; y: number }> = [{ x: Math.round(mx - imgLeft), y: Math.round(my - imgTop) }];

        // Live preview: the trail painted over the image while dragging.
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        Object.assign(svg.style, {
          position: "absolute", left: "0px", top: "0px", width: "100%", height: "100%",
          overflow: "visible", pointerEvents: "none", zIndex: "9998",
        });
        const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
        pathEl.setAttribute("fill", "none");
        pathEl.setAttribute("stroke", mode === "restore" ? "#FFFFFF" : "#000000");
        pathEl.setAttribute("stroke-opacity", "0.75");
        pathEl.setAttribute("stroke-width", String(size));
        pathEl.setAttribute("stroke-linecap", "round");
        pathEl.setAttribute("stroke-linejoin", "round");
        svg.appendChild(pathEl);
        content.appendChild(svg);

        const drawPreview = () => {
          pathEl.setAttribute("d", `M ${points.map(p => `${p.x + imgLeft} ${p.y + imgTop}`).join(" L ")}`);
        };
        drawPreview();

        const onEraserMove = (ev: MouseEvent) => {
          const cx = (ev.clientX - rect.left) / z - imgLeft;
          const cy = (ev.clientY - rect.top) / z - imgTop;
          const last = points[points.length - 1];
          if (Math.hypot(cx - last.x, cy - last.y) >= 3) {
            points.push({ x: Math.round(cx), y: Math.round(cy) });
            drawPreview();
          }
        };

        const onEraserUp = () => {
          document.removeEventListener("mousemove", onEraserMove);
          document.removeEventListener("mouseup", onEraserUp);
          svg.remove();
          // A click without a drag = a single dab. A stroked path with one
          // point renders nothing, so duplicate it with a hair offset.
          if (points.length < 2) {
            const p = points[0];
            points.push({ x: p.x + 0.01, y: p.y });
          }
          onBrushStrokeRef.current?.(imageLayerId, { points, size, mode });
        };

        document.addEventListener("mousemove", onEraserMove);
        document.addEventListener("mouseup", onEraserUp);
        return;
      }

      // ── Varita (F2): clicks on an <img> accumulate SAM prompts ──
      if (tool === "wand") {
        e.stopPropagation();
        e.preventDefault();
        onActivate(frame.id);
        if (wandLoadingRef.current) return; // a job is already running on this frame

        const imgEl = (target as Element)?.closest?.("img[data-layer-id]") as HTMLElement | null;
        const imageLayerId = imgEl?.getAttribute("data-layer-id");
        const src = imgEl?.getAttribute("src") || "";
        if (!imgEl || !imageLayerId || !src) return;

        // Normalize the click to 0..1 over the image's rendered box
        // (zoom-aware) — the same contract REST/MCP segment_click use.
        const imgRect = imgEl.getBoundingClientRect();
        const imgLeft = (imgRect.left - rect.left) / z;
        const imgTop = (imgRect.top - rect.top) / z;
        const imgW = imgRect.width / z;
        const imgH = imgRect.height / z;
        const nx = Math.min(1, Math.max(0, (mx - imgLeft) / imgW));
        const ny = Math.min(1, Math.max(0, (my - imgTop) / imgH));
        const neg = Boolean(me.altKey);
        wandContextRef.current = { imageLayerId, src };

        // Double-click (same spot, fast) commits the accumulated set;
        // single clicks keep refining. Alt flips the prompt's sign.
        const now = performance.now();
        const last = wandLastRef.current;
        const isDouble = Boolean(last && now - last.t < 400 && Math.hypot(mx - last.x, my - last.y) < 8);
        wandLastRef.current = { t: now, x: mx, y: my };
        if (isDouble && wandPointsRef.current.length > 0) {
          wandPointsRef.current.pop(); // the re-click replaces the first hit
          wandPointsRef.current.push({ fx: mx, fy: my, nx, ny, neg });
          commitWand(content);
          return;
        }

        wandPointsRef.current.push({ fx: mx, fy: my, nx, ny, neg });
        drawWandMarkers(content);
        showWandHint(content);
        if (!wandKeysCleanupRef.current) {
          const onKey = (ke: KeyboardEvent) => {
            const t = ke.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
            if (ke.key === "Escape") clearWandState();
            else if (ke.key === "Enter") commitWand(content);
          };
          document.addEventListener("keydown", onKey);
          wandKeysCleanupRef.current = () => document.removeEventListener("keydown", onKey);
        }
        return;
      }

      // ── Text-on-path: click on a path to write text along it ──
      if (tool === "text-path") {
        e.stopPropagation();
        e.preventDefault();
        onActivate(frame.id);

        const pathEls = content.querySelectorAll("svg path[d]");
        let bestPath: SVGPathElement | null = null;
        let bestDist = Infinity;
        let bestStartOffset = 0;

        for (const pathEl of Array.from(pathEls)) {
          const svgPathEl = pathEl as SVGPathElement;
          const d = svgPathEl.getAttribute("d");
          if (!d) continue;

          try {
            const totalLen = svgPathEl.getTotalLength();
            if (totalLen <= 0) continue;

            // Sample the path at high resolution to find the closest point to the click
            const samples = Math.max(100, Math.ceil(totalLen / 2));
            let closestDist = Infinity;
            let closestIdx = 0;
            for (let i = 0; i <= samples; i++) {
              const pt = svgPathEl.getPointAtLength((i / samples) * totalLen);
              const d2 = Math.hypot(mx - pt.x, my - pt.y);
              if (d2 < closestDist) { closestDist = d2; closestIdx = i; }
            }

            if (closestDist < 16 && closestDist < bestDist) {
              bestDist = closestDist;
              bestPath = svgPathEl;
              bestStartOffset = (closestIdx / samples) * 100;
            }
          } catch (_) { /* skip unmeasurable paths */ }
        }

        if (bestPath && bestDist < 16) {
          const pathD = bestPath.getAttribute("d")!;
          // Get SVG bounding box and original viewBox
          const svgEl = bestPath.closest("svg");
          const svgRect = svgEl ? svgEl.getBoundingClientRect() : null;
          const originalViewBox = svgEl?.getAttribute("viewBox") || undefined;
          const bounds = {
            x: svgRect ? (svgRect.left - rect.left) / z : mx - 50,
            y: svgRect ? (svgRect.top - rect.top) / z : my - 20,
            width: svgRect ? svgRect.width / z : 300,
            height: svgRect ? svgRect.height / z : 40,
          };
          onAddTextPathRef.current?.(pathD, bounds, Math.round(mx), Math.round(my), Math.round(bestStartOffset), originalViewBox);
          return;
        }
        // No path found nearby — ignore click
        return;
      }

      // ── Frame tool: frames are drawn on the canvas background, not inside frames ──
      if (tool === "frame") return;

      // ── Text tool: click = auto-width text, drag = fixed-size text box ──
      if (tool === "text") {
        e.stopPropagation();
        e.preventDefault();
        onActivate(frame.id);
        const startX = mx;
        const startY = my;
        let drawing = false;

        const preview = document.createElement("div");
        Object.assign(preview.style, {
          position: "absolute",
          left: `${startX}px`, top: `${startY}px`,
          width: "0px", height: "0px",
          border: "1.5px dashed #3B82F6",
          background: "rgba(59,130,246,0.06)",
          pointerEvents: "none",
          boxSizing: "border-box",
          zIndex: "9998",
        });

        const onTextMove = (ev: MouseEvent) => {
          const cx = (ev.clientX - rect.left) / z;
          const cy = (ev.clientY - rect.top) / z;
          if (!drawing && Math.hypot(cx - startX, cy - startY) < DRAG_THRESHOLD) return;
          if (!drawing) { drawing = true; content.appendChild(preview); }
          preview.style.left = `${Math.min(startX, cx)}px`;
          preview.style.top = `${Math.min(startY, cy)}px`;
          preview.style.width = `${Math.abs(cx - startX)}px`;
          preview.style.height = `${Math.abs(cy - startY)}px`;
        };

        const onTextUp = (ev: MouseEvent) => {
          document.removeEventListener("mousemove", onTextMove);
          document.removeEventListener("mouseup", onTextUp);
          preview.remove();
          if (!drawing) {
            // Click: auto-width text (grows as you type), in the clicked frame
            onAddPrimitiveRef.current?.("text", Math.round(startX), Math.round(startY), undefined, frame.id);
            return;
          }
          const cx = (ev.clientX - rect.left) / z;
          const cy = (ev.clientY - rect.top) / z;
          const bx = Math.round(Math.min(startX, cx));
          const by = Math.round(Math.min(startY, cy));
          const bw = Math.max(40, Math.round(Math.abs(cx - startX)));
          const bh = Math.max(20, Math.round(Math.abs(cy - startY)));
          // Straddle rule: a box that crosses the frame edge is created
          // outside it, as a canvas-level orphan at absolute coordinates.
          if (bx < -1 || by < -1 || bx + bw > frame.width + 1 || by + bh > frame.height + 1) {
            onCreateOrphanTextRef.current?.(Math.round(frame.x + bx), Math.round(frame.y + by), bw, bh);
            return;
          }
          onAddTextBoxRef.current?.(bx, by, bw, bh, undefined, frame.id);
        };
        document.addEventListener("mousemove", onTextMove);
        document.addEventListener("mouseup", onTextUp);
        return;
      }

      // ── Select tool (default) ──
      const activeTextEditor = editingTextRef.current;
      if (activeTextEditor && target instanceof Node && (target === activeTextEditor || activeTextEditor.contains(target))) {
        // Preserve the text layer while the browser creates/extends a native
        // range. Object hit-testing here used to replace it with an ancestor.
        e.stopPropagation();
        onActivate(frame.id);
        emitElementSelection(activeTextEditor);
        return;
      }

      if (!target || target === content) {
        // Click on empty area: exit scope, finalize pen path, clear multi-select
        scopeRef.current = null;
        if (penPointsRef.current.length >= 2) {
          finalizePenPath(content);
        }
        selectedRef.current = null;
        multiSelectedElsRef.current = [];
        clearOverlay();
        onElementSelect?.(null);
        onLayerSelectionChangeRef.current?.(frame.id, []);
        return;
      }

      e.stopPropagation();
      onActivate(frame.id);

      // Finalize pen path if active
      if (penPointsRef.current.length >= 2) {
        finalizePenPath(content);
      }

      // ── Scope-based hit-testing (Sprint 3) ──
      // Click → top-level ancestor within scope. Ctrl/Cmd+click → deep select.
      const deepSelect = me.ctrlKey || me.metaKey;
      const geometricHit = deepSelect || scopeRef.current
        ? null
        : findTopmostLayerAtPoint(content, me.clientX, me.clientY);
      const hitTarget = geometricHit || resolveHitTarget(target as Element, scopeRef.current, deepSelect);
      if (!hitTarget) return;

      // If target is an SVG child element (path, circle, rect, etc.), walk up
      // to the <svg data-layer-id="..."> wrapper so we operate on the whole
      // SVG object — dragging, CSS changes, and selection should target the
      // wrapper, not the individual path child.
      let dragTarget: Element = hitTarget;
      let dragSource: Element = hitTarget.contains(target as Element) ? target as Element : hitTarget;
      const parentSvg = hitTarget.closest?.("svg");
      if (parentSvg && parentSvg !== hitTarget) {
        dragTarget = parentSvg;
      }

      // F4 A2: a press on the shape body (vertex presses stopPropagation
      // earlier) clears the vertex selection while staying in edit mode.
      if (vertexEditModeRef.current && selectedVerticesRef.current.size > 0) {
        selectedVerticesRef.current = new Set();
        refreshOverlay(selectedRef.current || dragTarget);
      }
      // Spec F4: while in vertex-edit mode a press on the EDITED shape's body
      // must not drag the shape or change the selection; presses on other
      // layers fall through so selectElement switches selection and exits.
      if (vertexEditModeRef.current && vertexEditModeRef.current.layerId === closestLayerId(dragTarget)) {
        return;
      }

      // ── Shift+click: toggle multi-selection ──
      if (me.shiftKey) {
        const lid = dragTarget.getAttribute("data-layer-id");
        if (!lid) return;
        if (multiSelectedElsRef.current.length === 0 && selectedRef.current) {
          multiSelectedElsRef.current = [selectedRef.current];
        }
        const idx = multiSelectedElsRef.current.findIndex(el => el.getAttribute("data-layer-id") === lid);
        if (idx >= 0) {
          multiSelectedElsRef.current.splice(idx, 1);
        } else {
          multiSelectedElsRef.current.push(dragTarget);
        }
        if (multiSelectedElsRef.current.length === 0) {
          selectedRef.current = null;
          clearOverlay();
          onElementSelect?.(null);
        } else {
          const last = multiSelectedElsRef.current[multiSelectedElsRef.current.length - 1];
          const lastSource = last === dragTarget ? dragSource : last;
          selectedRef.current = last;
          selectedSourceRef.current = lastSource;
          refreshOverlay(last);
          drawAdditionalSelectionOutlines(multiSelectedElsRef.current.filter(element => element !== last));
          emitElementSelection(last, lastSource);
        }
        onLayerSelectionChangeRef.current?.(
          frame.id,
          multiSelectedElsRef.current.flatMap(element => element.getAttribute("data-layer-id") || []),
          true, // Shift+click: additive — EditorV2 keeps other frames' entries
        );
        return;
      }

      // ── Click on a multi-selected element → start multi-drag ──
      const isInMultiSelect = multiSelectedElsRef.current.length > 1
        && multiSelectedElsRef.current.some(el => el === dragTarget);

      if (!isInMultiSelect) {
        // Regular click: clear multi-select, select single element
        multiSelectedElsRef.current = [];
        selectElement(dragTarget, dragSource);
        const layerId = dragTarget.getAttribute("data-layer-id");
        onLayerSelectionChangeRef.current?.(frame.id, layerId ? [layerId] : []);
      }

      // ═══════════════════════════════════════════════════
      // DRAG SETUP (single or multi)
      // ═══════════════════════════════════════════════════
      const SNAP = 8; // snap threshold in pixels
      const startDragX = me.clientX;
      const startDragY = me.clientY;
      const contentRect = content.getBoundingClientRect();

      // Build drag items — one for single drag, many for multi-drag.
      // Each item caches its initial visual position and dimensions
      // so getBoundingClientRect() is never called inside mousemove.
      interface DragItem {
        el: Element;
        origVisualX: number;
        origVisualY: number;
        origLeft: number;
        origTop: number;
        baseTranslate: { x: number; y: number };
        preservesFlow: boolean;
        elW: number;
        elH: number;
      }
      const buildDragItem = (el: Element): DragItem => {
        const c = el.ownerDocument.defaultView!.getComputedStyle(el);
        const rect = getVisualRect(el);
        return {
          el,
          origVisualX: (rect.left - contentRect.left) / z,
          origVisualY: (rect.top - contentRect.top) / z,
          origLeft: parseFloat(c.left) || (el as HTMLElement).offsetLeft || 0,
          origTop: parseFloat(c.top) || (el as HTMLElement).offsetTop || 0,
          baseTranslate: parseCssTranslate(c.translate),
          preservesFlow: c.position === "static",
          elW: rect.width / z,
          elH: rect.height / z,
        };
      };

      // Expand each target through collectMovableElements: a display:contents
      // GROUP has no box of its own — translating the wrapper does nothing.
      // Its children are the movable units and each commits its own position.
      const dragTargets = isInMultiSelect ? multiSelectedElsRef.current : [dragTarget];
      const dragItems: DragItem[] = dragTargets
        .flatMap(el => collectMovableElements(el))
        .map(buildDragItem);

      let duplicatedForDrag = false;
      let moved = false;
      let cachedGuides: ReturnType<typeof collectGuides> | null = null;
      let rafPending = false;

      // ── Reusable snap guide elements (persistent, toggled via display) ──
      let snapGuideContainer: HTMLElement | null = null;

      const showSnapGuides = (snapX: number | null, snapY: number | null) => {
        if (!snapGuideContainer) {
          snapGuideContainer = document.createElement("div");
          Object.assign(snapGuideContainer.style, {
            position: "absolute", left: "0", top: "0",
            width: "100%", height: "100%",
            pointerEvents: "none", zIndex: "9997",
          });
          overlay.appendChild(snapGuideContainer);
        }
        snapGuideContainer.innerHTML = "";
        if (snapX !== null) {
          const lineX = document.createElement("div");
          Object.assign(lineX.style, {
            position: "absolute", left: `${snapX}px`, top: "0",
            width: "1px", height: "100%",
            background: "#EF4444", opacity: "0.5",
          });
          snapGuideContainer.appendChild(lineX);
        }
        if (snapY !== null) {
          const lineY = document.createElement("div");
          Object.assign(lineY.style, {
            position: "absolute", left: "0", top: `${snapY}px`,
            width: "100%", height: "1px",
            background: "#EF4444", opacity: "0.5",
          });
          snapGuideContainer.appendChild(lineY);
        }
      };

      const hideSnapGuides = () => {
        if (snapGuideContainer) {
          snapGuideContainer.innerHTML = "";
        }
      };

      // ── Lightweight overlay update during drag ──
      // Only repositions selection boxes; skips text bar, font controls,
      // point edit overlay, and all the heavy DOM construction in refreshOverlay.
      const updateDragOverlay = (items: DragItem[]) => {
        const overlay = overlayRef.current;
        const contentEl = shadowRef.current?.getElementById("__df_content");
        if (!overlay || !contentEl) return;
        overlay.innerHTML = "";
        const zz = zoomRef.current || 1;
        const cr = contentEl.getBoundingClientRect();
        for (const item of items) {
          const rect = getVisualRect(item.el);
          const box = document.createElement("div");
          Object.assign(box.style, {
            position: "absolute",
            left: `${(rect.left - cr.left) / zz}px`,
            top: `${(rect.top - cr.top) / zz}px`,
            width: `${rect.width / zz}px`,
            height: `${rect.height / zz}px`,
            border: `2px solid ${SEL}`,
            pointerEvents: "none",
            boxSizing: "border-box",
          });
          overlay.appendChild(box);
        }
      };

      const duplicateForDrag = () => {
        if (dragItems.length !== 1) return; // multi-drag doesn't support Alt-duplicate
        const item = dragItems[0];
        const sourceLayerId = item.el.getAttribute("data-layer-id");
        if (!sourceLayerId) return;
        const duplicated = duplicateLayerInHtml(content.innerHTML, sourceLayerId, createLayerId);
        if (!duplicated) return;
        const newLayerId = duplicated.idMap.get(sourceLayerId);
        if (!newLayerId) return;

        const sourceChildId = dragSource.getAttribute("data-layer-id");
        const sourceTag = dragSource.tagName.toLowerCase();
        const updatedCss = cloneLayerCss(cssRef.current, duplicated.idMap);
        cssRef.current = updatedCss;
        const style = shadow.querySelector("style");
        if (style) style.textContent = updatedCss;
        content.innerHTML = duplicated.html;

        const clonedTarget = content.querySelector(`[data-layer-id="${newLayerId}"]`) as HTMLElement | null;
        if (!clonedTarget) return;
        const clonedSourceId = sourceChildId ? duplicated.idMap.get(sourceChildId) : null;
        const clonedSource = clonedSourceId
          ? content.querySelector(`[data-layer-id="${clonedSourceId}"]`)
          : clonedTarget.querySelector(sourceTag);

        if (item.preservesFlow) {
          clonedTarget.style.position = "absolute";
          clonedTarget.style.left = `${Math.round(item.origVisualX)}px`;
          clonedTarget.style.top = `${Math.round(item.origVisualY)}px`;
          clonedTarget.style.width = `${Math.round(item.elW)}px`;
        } else {
          clonedTarget.style.left = `${item.origLeft}px`;
          clonedTarget.style.top = `${item.origTop}px`;
        }

        const newItem = buildDragItem(clonedTarget);
        newItem.preservesFlow = false; // cloned element is explicitly absolute
        dragItems[0] = newItem;
        dragTarget = clonedTarget;
        dragSource = clonedSource || clonedTarget;
        duplicatedForDrag = true;
        selectedRef.current = clonedTarget;
        selectedSourceRef.current = dragSource;
        emitElementSelection(clonedTarget, dragSource);
      };

      // Collect snap guides from other elements in the frame
      function collectGuides(excludeEl: Element): { x: number; y: number; w: number; h: number }[] {
        const guides: { x: number; y: number; w: number; h: number }[] = [];
        const zz = zoomRef.current || 1;
        const allEls = content.querySelectorAll("[data-layer-id]");
        const cr = content.getBoundingClientRect();
        for (const el of allEls) {
          if (el === excludeEl) continue;
          const gr = el.getBoundingClientRect();
          guides.push({
            x: (gr.left - cr.left) / zz,
            y: (gr.top - cr.top) / zz,
            w: gr.width / zz,
            h: gr.height / zz,
          });
        }
        // Add frame edges as guides
        guides.push({ x: 0, y: 0, w: 0, h: frame.height }); // left edge
        guides.push({ x: frame.width, y: 0, w: 0, h: frame.height }); // right edge
        guides.push({ x: 0, y: 0, w: frame.width, h: 0 }); // top edge
        guides.push({ x: 0, y: frame.height, w: frame.width, h: 0 }); // bottom edge
        return guides;
      }

      const onDragMove = (ev: MouseEvent) => {
        const zz = zoomRef.current || 1;
        const dx = (ev.clientX - startDragX) / zz;
        const dy = (ev.clientY - startDragY) / zz;
        if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        if (!moved && (me.altKey || ev.altKey)) duplicateForDrag();
        moved = true;

        // Snap to guides (computed once — other elements are static)
        if (!cachedGuides) cachedGuides = collectGuides(dragItems[0].el);
        const guides = cachedGuides;

        for (const item of dragItems) {
          let snapX = item.origVisualX + dx;
          let snapY = item.origVisualY + dy;

          let snappedX = false, snappedY = false;
          for (const g of guides) {
            // Snap left edge to guide left/right
            if (!snappedX && Math.abs(snapX - g.x) < SNAP) { snapX = g.x; snappedX = true; }
            if (!snappedX && Math.abs(snapX - (g.x + g.w)) < SNAP) { snapX = g.x + g.w; snappedX = true; }
            // Snap right edge to guide left/right
            if (!snappedX && Math.abs(snapX + item.elW - g.x) < SNAP) { snapX = g.x - item.elW; snappedX = true; }
            if (!snappedX && Math.abs(snapX + item.elW - (g.x + g.w)) < SNAP) { snapX = g.x + g.w - item.elW; snappedX = true; }
            // Snap center to guide center
            if (!snappedX && Math.abs(snapX + item.elW / 2 - (g.x + g.w / 2)) < SNAP) { snapX = g.x + g.w / 2 - item.elW / 2; snappedX = true; }
            // Snap top edge to guide top/bottom
            if (!snappedY && Math.abs(snapY - g.y) < SNAP) { snapY = g.y; snappedY = true; }
            if (!snappedY && Math.abs(snapY - (g.y + g.h)) < SNAP) { snapY = g.y + g.h; snappedY = true; }
            // Snap bottom edge to guide top/bottom
            if (!snappedY && Math.abs(snapY + item.elH - g.y) < SNAP) { snapY = g.y - item.elH; snappedY = true; }
            if (!snappedY && Math.abs(snapY + item.elH - (g.y + g.h)) < SNAP) { snapY = g.y + g.h - item.elH; snappedY = true; }
            // Snap middle to guide middle
            if (!snappedY && Math.abs(snapY + item.elH / 2 - (g.y + g.h / 2)) < SNAP) { snapY = g.y + g.h / 2 - item.elH / 2; snappedY = true; }
          }

          // Show snap guides for the primary item only
          if (item === dragItems[0]) {
            if (snappedX || snappedY) {
              showSnapGuides(snappedX ? snapX : null, snappedY ? snapY : null);
            } else {
              hideSnapGuides();
            }
          }

          // ── Unified GPU-only positioning: use transform:translate() for ALL elements ──
          // No more branching on preservesFlow with left/top (which triggers layout).
          // The delta is computed relative to the element's initial visual position,
          // preserving any existing translate on flow elements.
          const deltaX = snapX - item.origVisualX;
          const deltaY = snapY - item.origVisualY;
          const targetStyle = (item.el as HTMLElement).style;
          // "important" beats a previously committed `translate: … !important`
          // stylesheet rule — without it, once an element has been moved and
          // saved, the NEXT drag wouldn't move it live at all.
          if (item.preservesFlow) {
            targetStyle.setProperty("translate", `${Math.round(item.baseTranslate.x + deltaX)}px ${Math.round(item.baseTranslate.y + deltaY)}px`, "important");
          } else {
            targetStyle.setProperty("translate", `${Math.round(deltaX)}px ${Math.round(deltaY)}px`, "important");
          }
        }

        // Lightweight overlay update — only repositions selection boxes (no text bar, no point edit)
        if (!rafPending) {
          rafPending = true;
          requestAnimationFrame(() => {
            updateDragOverlay(dragItems);
            rafPending = false;
          });
        }
      };

      const onDragUp = () => {
        document.removeEventListener("mousemove", onDragMove);
        document.removeEventListener("mouseup", onDragUp);
        hideSnapGuides();
        if (!moved) return;

        // ── Did it leave the frame? ──
        // Dragged far enough that its whole box clears the frame's edge, the
        // object is no longer part of this frame. Anything still overlapping
        // stays put and is simply clipped, which is what a frame is for.
        // Read before the commit loop below, which clears the translates.
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const item of dragItems) {
          const delta = parseCssTranslate((item.el as HTMLElement).style.translate);
          const x = item.origVisualX + delta.x;
          const y = item.origVisualY + delta.y;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x + item.elW);
          maxY = Math.max(maxY, y + item.elH);
        }
        const escaped = maxX <= 0 || minX >= frame.width || maxY <= 0 || minY >= frame.height;

        if (escaped && onLayerEscapeRef.current) {
          // The escaping units are what was SELECTED, not the drag items: a
          // group is expanded into its children to move them, and ejecting
          // those one by one would take the group apart.
          const layerIds = dragTargets
            .map(el => el.getAttribute("data-layer-id"))
            .filter((id): id is string => Boolean(id));
          if (layerIds.length) {
            const contentRect = content.getBoundingClientRect();
            const z = zoomRef.current || 1;
            const geometries: Record<string, LayerVisualGeometry> = {};
            for (const target of dragTargets) {
              const layerId = target.getAttribute("data-layer-id");
              if (!layerId) continue;
              const bounds = toFrameLocalBounds(getVisualRect(target), contentRect, z);
              const computed = target.ownerDocument.defaultView!.getComputedStyle(target);
              const translate = parseCssTranslate(computed.translate);
              const logicalX = (parseFloat(computed.left) || 0) + translate.x;
              const logicalY = (parseFloat(computed.top) || 0) + translate.y;
              geometries[layerId] = {
                ...bounds,
                contentWidth: parseFloat(computed.width) || bounds.width,
                contentHeight: parseFloat(computed.height) || bounds.height,
                contentOffsetX: bounds.x - logicalX,
                contentOffsetY: bounds.y - logicalY,
              };
            }
            for (const item of dragItems) (item.el as HTMLElement).style.translate = "";
            onLayerEscapeRef.current(layerIds, { x: minX, y: minY, width: maxX - minX, height: maxY - minY }, geometries);
            return;
          }
        }

        // Commit: translate transform deltas back to CSS left/top for all dragged items
        let updatedCss = cssRef.current;
        let updatedHtml: string | undefined;

        for (const item of dragItems) {
          const sel = getSelector(item.el);
          const dt = item.el as HTMLElement;
          const tx = dt.style.translate;
          // Reset inline transform so it doesn't persist on the DOM element
          dt.style.translate = "";

          const properties: Record<string, string> = {};
          if (item.preservesFlow) {
            properties.translate = tx;
          } else {
            // Convert transform delta back to explicit left/top for CSS persistence
            const parsed = parseCssTranslate(tx);
            properties.left = `${Math.round(item.origLeft + parsed.x)}px`;
            properties.top = `${Math.round(item.origTop + parsed.y)}px`;
          }
          if (duplicatedForDrag) properties.position = "absolute";
          updatedCss = updateCssRule(updatedCss, sel, importantProperties(properties));

          // A dragged image drags its mask along: the source path's d is in
          // frame coordinates, so it shifts by the same delta or the outline
          // (and every future bake) stays where the image USED to be. The
          // fill layer mirrors the image box, so it moves the same way.
          const dragLayerId = dt.getAttribute("data-layer-id");
          if (dragLayerId && dt.tagName.toLowerCase() === "img") {
            const parsed = parseCssTranslate(tx);
            if (parsed.x !== 0 || parsed.y !== 0) {
              const maskPath = content.querySelector(`path[data-mask-for="${dragLayerId}"]`);
              if (maskPath) {
                maskPath.setAttribute("d", transformPathData(maskPath.getAttribute("d") || "", { sx: 1, sy: 1, dx: parsed.x, dy: parsed.y }));
                updatedHtml = content.innerHTML;
              }
              const fillLayer = content.querySelector(`[data-fill-for="${dragLayerId}"]`);
              const fillId = fillLayer?.getAttribute("data-layer-id");
              if (fillLayer && fillId) {
                const fillSel = `[data-layer-id="${fillId}"]`;
                const currentLeft = parseFloat(getComputedStyle(fillLayer).left) || 0;
                const currentTop = parseFloat(getComputedStyle(fillLayer).top) || 0;
                updatedCss = updateCssRule(updatedCss, fillSel, {
                  left: `${Math.round(currentLeft + parsed.x)}px`,
                  top: `${Math.round(currentTop + parsed.y)}px`,
                });
              }
            }
          }
        }

        if (duplicatedForDrag) updatedHtml = content.innerHTML;
        emitFrameChange(updatedCss, updatedHtml);

        // Restore full overlay with text bar / point edit after commit.
        // Refresh on the SELECTED element (may be a group wrapper whose
        // children were the actual drag items), not the last drag item.
        if (selectedRef.current) {
          refreshOverlay(selectedRef.current);
        } else if (dragItems.length > 0) {
          refreshOverlay(dragItems[dragItems.length - 1].el);
        }
      };

      document.addEventListener("mousemove", onDragMove);
      document.addEventListener("mouseup", onDragUp);
    });

    // ── Triple-click: enter the mutually-exclusive vertex editing mode. ──
    content.addEventListener("click", (e: Event) => {
      const me = e as MouseEvent;
      if (me.detail !== 3 || vertexEditModeRef.current) return;
      const tool = activeToolRef.current;
      if (tool && tool !== "select" && tool !== "hand") return;
      const target = me.target as HTMLElement;
      if (!target || target === content) return;
      const hit = resolveHitTarget(target, scopeRef.current, me.ctrlKey || me.metaKey);
      const selected = selectedRef.current;
      const isAlreadySelected = !!hit && !!selected && closestLayerId(hit) === closestLayerId(selected);
      if (!isAlreadySelected || !hit) return;
      const vertexTarget = findVertexEditableTarget(target) || convertCssShapeToEditablePath(hit);
      if (!vertexTarget) return;
      e.stopPropagation();
      e.preventDefault();
      hideHoverPreview();
      enterVertexEditMode(vertexTarget);
    });

    // ── Double-click: scope drill-down or inline text editing ──
    content.addEventListener("dblclick", (e: Event) => {
      const me = e as MouseEvent;
      const target = me.target as HTMLElement;
      if (!target || target === content) {
        // F4 A2: double-click on empty canvas leaves vertex-edit mode.
        if (vertexEditModeRef.current) {
          e.stopPropagation();
          e.preventDefault();
          exitVertexEditModeRef.current?.();
          if (selectedRef.current) refreshOverlay(selectedRef.current);
        }
        return;
      }

      const tool = activeToolRef.current;
      // A double-click is the first two thirds of a triple-click. Reserve it
      // on selected shapes so it cannot start text editing or drill-down while
      // the user is trying to enter vertex mode.
      if (!tool || tool === "select" || tool === "hand") {
        const hit = resolveHitTarget(target, scopeRef.current, me.ctrlKey || me.metaKey);
        const selected = selectedRef.current;
        const isAlreadySelected = !!hit && !!selected && closestLayerId(hit) === closestLayerId(selected);
        if (isAlreadySelected && hit && (findVertexEditableTarget(target) || isConvertibleCssShape(hit))) {
          e.stopPropagation();
          e.preventDefault();
          return;
        }
      }
      // ── Scope drill-down (Sprint 3): enter container as new scope ──
      if (!tool || tool === "select" || tool === "hand") {
        const hit = resolveHitTarget(target, scopeRef.current, me.ctrlKey || me.metaKey);
        if (hit && hit !== content) {
          const kind = hit.getAttribute("data-layer-kind");
          // Drill into groups or containers with children
          if (kind === "group" || (!kind && hit.children.length > 0)) {
            e.stopPropagation();
            e.preventDefault();
            hideHoverPreview();
            scopeRef.current = hit;
            selectElement(hit);
            return;
          }
        }
      }

      if (editingTextRef.current) return; // already editing

      const hit = resolveHitTarget(target, scopeRef.current, false) as HTMLElement | null;
      const editTarget = hit?.getAttribute("data-layer-kind") === "text" ? hit : target;
      // Only allow editing on text-like elements
      const tag = editTarget.tagName.toLowerCase();
      const isTextLike = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "span", "a", "li", "div", "label", "button", "em", "strong", "small", "b", "i"].includes(tag);
      if (!isTextLike) return;

      // Editing a container as plain text would destroy its child structure.
      if (editTarget.children.length > 0 && editTarget.getAttribute("data-layer-kind") !== "text") return;

      e.stopPropagation();
      e.preventDefault();
      editingTextRef.current = editTarget;

      editTarget.setAttribute("contenteditable", "true");
      editTarget.setAttribute("spellcheck", "true");
      editTarget.style.outline = `1px solid ${SEL}`;
      editTarget.style.outlineOffset = "1px";
      editTarget.style.cursor = "text";
      editTarget.focus();
      emitElementSelection(editTarget);

      const rememberRange = () => {
        const selection = editTarget.ownerDocument.getSelection();
        if (!selection?.rangeCount) return;
        const range = selection.getRangeAt(0);
        if (!editTarget.contains(range.commonAncestorContainer)) return;
        savedTextRangeRef.current = range.cloneRange();
        emitElementSelection(editTarget);
      };
      editTarget.ownerDocument.addEventListener("selectionchange", rememberRange);

      const onBlur = () => {
        editTarget.removeEventListener("blur", onBlur);
        editTarget.ownerDocument.removeEventListener("selectionchange", rememberRange);
        editTarget.removeAttribute("contenteditable");
        editTarget.style.outline = "";
        editTarget.style.outlineOffset = "";
        editTarget.style.cursor = "";
        editingTextRef.current = null;
        onHtmlChangeRef.current?.(frame.id, content.innerHTML);
        emitElementSelection(editTarget);
      };

      editTarget.addEventListener("blur", onBlur);

      // Prevent Enter from bubbling to keyboard shortcuts
      editTarget.addEventListener("keydown", (ke: Event) => {
        const kbe = ke as KeyboardEvent;
        if (kbe.key === "Escape") {
          target.blur();
        }
        kbe.stopPropagation();
      });
    });

    // ── Spec F4: vertex hover — pointer cursor + blue hover circle over a
    // vertex (8px hit), green "+" insert indicator over a segment, default
    // elsewhere. Attached on document so it fires over the overlay children
    // and the empty canvas alike; skipped while a vertex drag is active. ──
    const onVertexHoverMove = (event: MouseEvent) => {
      if (!vertexEditModeRef.current || vertexDraggingRef.current) return;
      const editData = pointEditPathRef.current;
      const screen = vertexScreenPointsRef.current;
      if (!editData || !screen) return;
      const cRect = content.getBoundingClientRect();
      const z = zoomRef.current || 1;
      const inside = event.clientX >= cRect.left && event.clientX <= cRect.right
        && event.clientY >= cRect.top && event.clientY <= cRect.bottom;
      if (!inside) {
        hoveredVertexIndexRef.current = null;
        hoveredSegmentRef.current = null;
        refreshHoverVisuals();
        return;
      }
      const mouseX = (event.clientX - cRect.left) / z;
      const mouseY = (event.clientY - cRect.top) / z;
      const vertexIndex = getVertexAt(mouseX, mouseY, screen, 8);
      if (vertexIndex !== null) {
        hoveredVertexIndexRef.current = vertexIndex;
        hoveredSegmentRef.current = null;
      } else {
        hoveredVertexIndexRef.current = null;
        hoveredSegmentRef.current = getSegmentAt(mouseX, mouseY, screen, editData.closed, 8);
      }
      refreshHoverVisuals();
    };
    document.addEventListener("mousemove", onVertexHoverMove);

    // ── Keyboard shortcuts (within shadow host context) ──
    shadow.host.addEventListener("keydown", (e: Event) => {
      const kbe = e as KeyboardEvent;

      // ── Escape: exit scope → cancel pen → deselect ──
      if (kbe.key === "Escape") {
        hideHoverPreview();
        if (scopeRef.current) {
          // Exit current scope (go up one level toward root)
          const parent = scopeRef.current.parentElement;
          scopeRef.current = (parent && parent !== content && parent.closest?.("#__df_content")) ? parent : null;
          if (scopeRef.current) {
            selectElement(scopeRef.current);
          } else {
            selectedRef.current = null;
            clearOverlay();
            onElementSelect?.(null);
          }
          return;
        }
        if (penPointsRef.current.length > 0) {
          // Cancel pen path
          penPointsRef.current = [];
          if (penSvgRef.current) {
            penSvgRef.current.remove();
            penSvgRef.current = null;
          }
        }
        return;
      }

      if (kbe.key === "Enter" && penPointsRef.current.length >= 2) {
        finalizePenPath(content);
      }
    });
  }

  function finalizePenPath(content: HTMLElement, closed = false) {
    const pts = penPointsRef.current;
    if (pts.length < 2) return;

    const pathData = serializePathData(pts, closed);
    // Ink bounds, not control-handle bounds — the box must hug the drawing
    // from birth (computeBounds would span the Bézier handles and leave a
    // permanent "padding" gap around the inked curve).
    const bounds = computeInkBounds(pts, closed);

    onAddPenPathRef.current?.(pathData, bounds, closed);

    // Clean up SVG preview
    penPointsRef.current = [];
    if (penSvgRef.current) {
      penSvgRef.current.remove();
      penSvgRef.current = null;
    }
  }

  function startResize(el: Element, startEvent: MouseEvent, direction: ResizeDirection, ox: number, oy: number, ow: number, oh: number) {
    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    let target = el as HTMLElement;
    const computed = target.ownerDocument.defaultView!.getComputedStyle(target);
    const preservesFlow = computed.position === "static";
    let baseScale = parseCssScale(computed.scale);
    let baseLeft = parseFloat(computed.left) || 0;
    let baseTop = parseFloat(computed.top) || 0;
    let baseFontSize = parseFloat(computed.fontSize) || 0;
    let scalesText = target.children.length === 0 && /^(H[1-6]|P|SPAN|A|LI|LABEL|BUTTON|EM|STRONG|SMALL|B|I)$/.test(target.tagName);

    const affectsLeft = direction.includes("w");
    const affectsRight = direction.includes("e");
    const affectsTop = direction.includes("n");
    const affectsBottom = direction.includes("s");
    const isCorner = (affectsLeft || affectsRight) && (affectsTop || affectsBottom);
    // Text is NOT an image: resizing its box must never scale the glyphs.
    // Font size is edited in the text panel — or scaled explicitly by holding
    // Ctrl/Cmd during a corner resize (Figma's scale-tool behavior, opt-in).
    let fontWasScaled = false;

    // ── Alt key: clone the element and resize the clone ──
    let isAltClone = false;
    if (startEvent.altKey) {
      const sourceLayerId = target.getAttribute("data-layer-id");
      const parent = target.parentNode;
      if (sourceLayerId && parent) {
        // Clone element in DOM with new layer-ids
        const clone = target.cloneNode(true) as HTMLElement;
        const idMap = new Map<string, string>();
        for (const clonedEl of [clone, ...clone.querySelectorAll("[data-layer-id]")]) {
          const oldId = clonedEl.getAttribute("data-layer-id");
          if (!oldId) continue;
          const newId = createLayerId();
          idMap.set(oldId, newId);
          clonedEl.setAttribute("data-layer-id", newId);
        }
        // Clone CSS rules for the new IDs (no position offset — clone starts at same spot)
        const cssWithClone = cloneLayerCss(cssRef.current, idMap, 0);
        cssRef.current = cssWithClone;
        const shadow = shadowRef.current!;
        const style = shadow.querySelector("style");
        if (style) style.textContent = `#__df_content { width: ${frame.width}px; height: ${frame.height}px; overflow: hidden; }\n${mapBodySelectors(cssWithClone)}`;
        // Insert clone after original
        parent.insertBefore(clone, target.nextSibling);
        // Recompute style properties for the clone (it matches the original)
        const cloneComputed = clone.ownerDocument.defaultView!.getComputedStyle(clone);
        baseScale = parseCssScale(cloneComputed.scale);
        baseLeft = parseFloat(cloneComputed.left) || 0;
        baseTop = parseFloat(cloneComputed.top) || 0;
        baseFontSize = parseFloat(cloneComputed.fontSize) || 0;
        scalesText = clone.children.length === 0 && /^(H[1-6]|P|SPAN|A|LI|LABEL|BUTTON|EM|STRONG|SMALL|B|I)$/.test(clone.tagName);
        target = clone;
        isAltClone = true;
      }
    }

    // Drag-time inline styles carry "important" (the persisted stylesheet uses
    // !important, so plain inline values lose and nothing moves live). Every
    // touched property remembers its pre-drag inline value so the commit can
    // restore it — blanket removal would destroy inline styles the element
    // already had (position, font-size) before the drag.
    const priorInline = new Map<string, { value: string; priority: string }>();
    const setImp = (prop: string, val: string) => {
      if (!priorInline.has(prop)) {
        priorInline.set(prop, {
          value: target.style.getPropertyValue(prop),
          priority: target.style.getPropertyPriority(prop),
        });
      }
      target.style.setProperty(prop, val, "important");
    };

    const onMove = (ev: MouseEvent) => {
      const z = zoomRef.current || 1;
      const dx = (ev.clientX - startX) / z;
      const dy = (ev.clientY - startY) / z;
      const shift = ev.shiftKey;

      let newX = ox, newY = oy, newW = ow, newH = oh;

      if (shift && isCorner) {
        // ── Shift+corner: proportional resize maintaining aspect ratio ──
        const aspectRatio = ow / oh;
        const maxDim = Math.max(Math.abs(dx), Math.abs(dy));
        const signX = dx >= 0 ? 1 : -1;
        const signY = dy >= 0 ? 1 : -1;
        if (affectsRight) newW = Math.max(10, ow + maxDim * signX);
        if (affectsBottom) newH = Math.max(10, oh + maxDim * signY);
        if (affectsLeft) { newW = Math.max(10, ow - maxDim * signX); newX = ox + (ow - newW); }
        if (affectsTop) { newH = Math.max(10, oh - maxDim * signY); newY = oy + (oh - newH); }
        // Recalculate to maintain aspect
        if (affectsLeft || affectsRight) newH = Math.round(newW / aspectRatio);
        if (affectsTop || affectsBottom) newW = Math.round(newH * aspectRatio);
      } else if (shift && !isCorner) {
        // ── Shift+edge: maintain aspect via the controlled dimension ──
        const aspectRatio = ow / oh;
        if (affectsLeft || affectsRight) {
          newW = Math.max(10, ow + dx);
          newH = Math.round(newW / aspectRatio);
          if (affectsLeft) newX = ox + ow - newW;
        } else {
          newH = Math.max(10, oh + dy);
          newW = Math.round(newH * aspectRatio);
          if (affectsTop) newY = oy + oh - newH;
        }
      } else {
        // ── Unconstrained resize (original behavior) ──
        if (affectsLeft) {
          newX = ox + dx;
          newW = Math.max(10, ow - dx);
          if (newW === 10) newX = ox + ow - 10;
        }
        if (affectsRight) {
          newW = Math.max(10, ow + dx);
        }
        if (affectsTop) {
          newY = oy + dy;
          newH = Math.max(10, oh - dy);
          if (newH === 10) newY = oy + oh - 10;
        }
        if (affectsBottom) {
          newH = Math.max(10, oh + dy);
        }
      }

      // Opt-in font scaling: Ctrl/Cmd + corner handle scales the glyphs too.
      const wantsFontScale = (ev.ctrlKey || ev.metaKey) && scalesText && isCorner && baseFontSize > 0;
      if (wantsFontScale) {
        const scale = Math.sqrt((newW / Math.max(ow, 1)) * (newH / Math.max(oh, 1)));
        setImp("font-size", `${Math.max(1, Math.round(baseFontSize * scale * 100) / 100)}px`);
        fontWasScaled = true;
      }

      if (preservesFlow && !scalesText) {
        // Flow (static) non-text elements can't reposition — resize via transform scale.
        const scaleX = baseScale.x * (newW / Math.max(ow, 1));
        const scaleY = baseScale.y * (newH / Math.max(oh, 1));
        const originX = affectsLeft ? "right" : affectsRight ? "left" : "center";
        const originY = affectsTop ? "bottom" : affectsBottom ? "top" : "center";
        setImp("scale", `${Math.max(0.01, scaleX)} ${Math.max(0.01, scaleY)}`);
        setImp("transform-origin", `${originX} ${originY}`);
      } else if (preservesFlow) {
        // Flow TEXT: resize the box only — the text reflows live inside it.
        setImp("width", `${Math.round(newW)}px`);
        setImp("height", `${Math.round(newH)}px`);
      } else {
        setImp("width", `${Math.round(newW)}px`);
        setImp("height", `${Math.round(newH)}px`);
        if (affectsLeft || affectsTop) {
          if (affectsLeft) setImp("left", `${Math.round(baseLeft + newX - ox)}px`);
          if (affectsTop) setImp("top", `${Math.round(baseTop + newY - oy)}px`);
        }
      }
      refreshOverlay(target);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const sel = getSelector(target);
      const props: Record<string, string> = {};
      if (preservesFlow && !scalesText) {
        if (target.style.scale) props.scale = target.style.scale;
        if (target.style.transformOrigin) props["transform-origin"] = target.style.transformOrigin;
      } else {
        if (target.style.width) props.width = target.style.width;
        if (target.style.height) props.height = target.style.height;
      }
      if (fontWasScaled && target.style.fontSize) props["font-size"] = target.style.fontSize;
      if (!preservesFlow) {
        if (affectsLeft && target.style.left) props.left = target.style.left;
        if (affectsTop && target.style.top) props.top = target.style.top;
      }
      // Restore pre-drag inline values BEFORE committing: the stylesheet must
      // govern from here on (a lingering inline !important would silently
      // override every future panel/CSS edit), and the alt-clone path
      // serializes innerHTML — it must not bake drag artifacts into the file.
      // emitFrameChange syncs the <style> tag synchronously, so no flicker.
      for (const [prop, prev] of priorInline) {
        if (prev.value) target.style.setProperty(prop, prev.value, prev.priority);
        else target.style.removeProperty(prop);
      }
      const updated = updateCssRule(cssRef.current, sel, importantProperties(props));
      if (isAltClone) {
        // Persist the clone: save combined CSS + HTML so the new element survives
        const content = shadowRef.current!.getElementById("__df_content")!;
        emitFrameChange(updated, content.innerHTML);
        // Select the clone so the user can interact with it immediately
        selectElement(target);
      } else {
        emitFrameChange(updated);
      }
      refreshOverlay(target);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // ── Frame-level resize (handles on frame borders/corners) ──
  function startFrameResize(handle: string, e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const origW = frame.width;
    const origH = frame.height;
    const origX = frame.x;
    const origY = frame.y;
    const aspect = origW / origH;

    const affectsLeft = handle.includes("w");
    const affectsRight = handle.includes("e");
    const affectsTop = handle.includes("n");
    const affectsBottom = handle.includes("s");
    const isCorner = (affectsLeft || affectsRight) && (affectsTop || affectsBottom);

    const onMove = (ev: MouseEvent) => {
      const z = zoomRef.current || 1;
      const dx = (ev.clientX - startX) / z;
      const dy = (ev.clientY - startY) / z;
      const shift = ev.shiftKey;

      let newW = origW, newH = origH, newX = origX, newY = origY;

      if (shift && isCorner) {
        // Proportional resize: maintain aspect ratio
        const maxDim = Math.max(Math.abs(dx), Math.abs(dy));
        const signX = dx >= 0 ? 1 : -1;
        const signY = dy >= 0 ? 1 : -1;
        if (affectsRight) newW = Math.max(20, origW + maxDim * signX);
        if (affectsBottom) newH = Math.max(20, origH + maxDim * signY);
        if (affectsLeft) { newW = Math.max(20, origW - maxDim * signX); newX = origX + (origW - newW); }
        if (affectsTop) { newH = Math.max(20, origH - maxDim * signY); newY = origY + (origH - newH); }
        // Recalculate to maintain aspect
        if (affectsLeft || affectsRight) newH = Math.round(newW / aspect);
        if (affectsTop || affectsBottom) newW = Math.round(newH * aspect);
      } else if (shift && !isCorner) {
        // Edge resize with shift: snap to maintain aspect via the other dimension
        if (affectsLeft || affectsRight) {
          newW = Math.max(20, origW + dx);
          newH = Math.round(newW / aspect);
        } else {
          newH = Math.max(20, origH + dy);
          newW = Math.round(newH * aspect);
        }
      } else {
        if (affectsLeft) {
          newW = Math.max(20, origW - dx);
          newX = origX + origW - newW;
        }
        if (affectsRight) newW = Math.max(20, origW + dx);
        if (affectsTop) {
          newH = Math.max(20, origH - dy);
          newY = origY + origH - newH;
        }
        if (affectsBottom) newH = Math.max(20, origH + dy);
      }

      const el = containerRef.current;
      if (el) {
        el.style.left = `${Math.round(newX)}px`;
        el.style.top = `${Math.round(newY)}px`;
        el.style.width = `${Math.round(newW)}px`;
        el.style.height = `${Math.round(newH)}px`;
      }
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const el = containerRef.current;
      if (!el) return;
      const finalW = parseInt(el.style.width) || origW;
      const finalH = parseInt(el.style.height) || origH;
      const finalX = parseInt(el.style.left) || origX;
      const finalY = parseInt(el.style.top) || origY;
      onFrameResizeRef.current?.(frame.id, finalW, finalH, finalX, finalY);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  return (
    <div
      ref={containerRef}
      data-frame-id={frame.id}
      style={{
        position: "absolute",
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: frame.height,
        cursor: activeTool && ["rect", "circle", "triangle", "star", "polygon", "text", "text-path", "pen", "pen-plus", "pen-minus", "pen-edit", "pencil"].includes(activeTool) ? "crosshair" : "default",
      }}
    >
      {/* Background — click-through receiver for frame-level selection/drag.
          With #__df_content { pointer-events: none }, clicks on empty areas
          inside the frame fall through to this div.
          Disabled in content mode or when using drawing tools. */}
      <div style={{
        position: "absolute", inset: 0,
        background: frame.background,
        borderRadius: 2,
        pointerEvents: (contentMode || (activeTool && activeTool !== "select" && activeTool !== "hand")) ? "none" : "auto",
        zIndex: 1,
      }} />
      {activeTool === "select" && !contentMode && ([
        { top: -3, left: 0, right: 0, height: 7, cursor: "move" },
        { bottom: -3, left: 0, right: 0, height: 7, cursor: "move" },
        { top: 0, bottom: 0, left: -3, width: 7, cursor: "move" },
        { top: 0, bottom: 0, right: -3, width: 7, cursor: "move" },
      ] as const).map((edge, index) => (
        <div
          key={index}
          aria-hidden="true"
          onMouseDown={(event) => onLabelMouseDown?.(frame.id, event)}
          style={{ position: "absolute", zIndex: 4, pointerEvents: "auto", ...edge }}
        />
      ))}
      {/* Visual border — solid for frame-level, dashed for content mode (Phase 2).
          zIndex: 3 sits above content (2) and background (1). */}
      <div style={{
        position: "absolute", inset: 0,
        border: isActive
          ? (contentMode ? `2px dashed ${SEL}` : `2px solid ${SEL}`)
          : (inMultiSelect ? `2px solid ${SEL}80` : "1px solid rgba(255,255,255,0.1)"),
        borderRadius: 2, pointerEvents: "none", zIndex: 3,
        boxShadow: isActive
          ? `0 0 0 1px ${SEL}, 0 8px 32px rgba(59,130,246,0.15)`
          : "0 4px 16px rgba(0,0,0,0.25)",
      }} />
      {/* Label above frame — interactive: draggable + double-click to rename.
          Rendered last so it's on top. bottom: 100% places it visually above.

          Counter-scaled by the zoom. The label lives in frame coordinates, so
          it used to shrink with the canvas: at 50% an 11px label drew at 5.5
          real pixels, which is why it was there but not clickable. Dividing by
          the zoom holds it at a constant SCREEN size, so it reads and can be
          hit the same whether you are at 10% or 400% — and it no longer eats
          the artboard when you zoom out to see everything. */}
      <div
        data-frame-label-id={frame.id}
        aria-label={`Move frame ${frame.name}`}
        style={{
          position: "absolute", bottom: "100%", left: 0,
          transform: `scale(${1 / (zoom || 1)})`,
          // Anchored where the label meets the frame's top-left, so growing it
          // pushes away from the artwork rather than over it.
          transformOrigin: "bottom left",
          padding: "4px 10px", marginBottom: 6,
          fontSize: 14, fontFamily: "Inter, system-ui, sans-serif",
          fontWeight: 500,
          color: isActive ? "#60a5fa" : "#999",
          whiteSpace: "nowrap",
          pointerEvents: "auto",
          cursor: "grab",
          userSelect: "none",
          background: isActive ? "rgba(59,130,246,0.12)" : "rgba(30,30,30,0.6)",
          backdropFilter: "blur(8px)",
          borderRadius: 4,
          border: isActive ? "1px solid rgba(59,130,246,0.3)" : "1px solid rgba(255,255,255,0.06)",
          zIndex: 4,
        }}
        onMouseDown={(e) => onLabelMouseDown?.(frame.id, e)}
        onDoubleClick={(e) => { e.stopPropagation(); onLabelDoubleClick?.(frame.id); }}
      >
        {isRenaming ? (
          <input
            autoFocus
            value={renameValue ?? ""}
            onChange={(e) => onRenameChange?.(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); onRenameCommit?.(); }
              if (e.key === "Escape") { e.preventDefault(); onRenameCancel?.(); }
            }}
            onBlur={() => onRenameCommit?.()}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              // Matches the label it replaces: renaming should not resize it.
              fontSize: 14, fontFamily: "Inter, system-ui, sans-serif",
              background: "rgba(30,30,30,0.95)", color: "#fff",
              border: "1px solid #3B82F6", borderRadius: 3,
              padding: "2px 8px", outline: "none", width: 160,
            }}
          />
        ) : (
          <>
            {frame.name}
            <span style={{ marginLeft: 8, fontSize: 12, color: "#666" }}>
              {frame.width}×{frame.height}
            </span>
          </>
        )}
      </div>
      {/* ── Frame resize handles (Phase 5) — only for active frame in select/hand tool, not content mode ── */}
      {isActive && !contentMode && activeTool && (activeTool === "select" || activeTool === "hand") && (
        <>
          {([
            ["nw", 0, 0, "nwse-resize"],
            ["n", 0.5, 0, "ns-resize"],
            ["ne", 1, 0, "nesw-resize"],
            ["e", 1, 0.5, "ew-resize"],
            ["se", 1, 1, "nwse-resize"],
            ["s", 0.5, 1, "ns-resize"],
            ["sw", 0, 1, "nesw-resize"],
            ["w", 0, 0.5, "ew-resize"],
          ] as const).map(([pos, fx, fy, cursor]) => (
            <div
              key={pos}
              onMouseDown={(e) => startFrameResize(pos, e)}
              style={{
                position: "absolute",
                left: fx === 0.5 ? "50%" : fx === 0 ? -4 : undefined,
                right: fx === 1 ? -4 : undefined,
                top: fy === 0.5 ? "50%" : fy === 0 ? -4 : undefined,
                bottom: fy === 1 ? -4 : undefined,
                width: 8, height: 8,
                marginLeft: fx === 0.5 ? -4 : undefined,
                marginTop: fy === 0.5 ? -4 : undefined,
                background: SEL,
                border: "1.5px solid #fff",
                borderRadius: 1,
                cursor,
                pointerEvents: "auto",
                boxSizing: "border-box",
                zIndex: 5,
              }}
            />
          ))}
        </>
      )}
    </div>
  );
}

// ── CSS Utilities ──

function getSelector(el: Element): string {
  const lid = el.getAttribute("data-layer-id");
  if (lid) return `[data-layer-id="${lid}"]`;
  const id = el.id;
  if (id) return `#${id}`;
  // SVG elements have SVGAnimatedString for className, not a plain string
  const cls: any = el.className;
  const clsStr = typeof cls === "string" ? cls : (cls?.baseVal ?? "");
  if (clsStr.trim()) return `.${clsStr.trim().split(/\s+/)[0]}`;
  return el.tagName.toLowerCase();
}

function getStyleSelector(element: Element, source: Element): string {
  if (source === element) return getSelector(element);
  const svg = source.closest("svg");
  if (svg === element) return `${getSelector(element)} ${source.tagName.toLowerCase()}`;
  return getSelector(element);
}

function parseCssTranslate(value: string): { x: number; y: number } {
  if (!value || value === "none") return { x: 0, y: 0 };
  const parts = value.split(/\s+/).map(part => parseFloat(part));
  return {
    x: Number.isFinite(parts[0]) ? parts[0] : 0,
    y: Number.isFinite(parts[1]) ? parts[1] : 0,
  };
}

function parseCssScale(value: string): { x: number; y: number } {
  if (!value || value === "none") return { x: 1, y: 1 };
  const parts = value.split(/\s+/).map(part => parseFloat(part));
  const x = Number.isFinite(parts[0]) ? parts[0] : 1;
  return {
    x,
    y: Number.isFinite(parts[1]) ? parts[1] : x,
  };
}

function importantProperties(properties: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(properties).map(([property, value]) => [
    property,
    `${value.replace(/\s*!important\s*$/i, "").trim()} !important`,
  ]));
}

/**
 * Maps `body` and `html` selectors to `#__df_content` so that CSS written for
 * full-page documents works inside the Shadow DOM (which has no <body>).
 *
 * Covers:
 *   body { }                — line start / after brace
 *   .foo, body { }          — after comma
 *   } body { }              — after closing brace
 *   @media (...) { body {} } — inside at-rules (via multiline ^)
 *   body.class { }           — compound class
 *   body > .x { }            — combinator
 *   html body { }            — descendant (whitespace-preceded)
 *   body.dark { }            — compound class with dot
 */
function extractFontImports(css: string): string[] {
  // Extract ALL @import url(...) from CSS — Google Fonts, Phosphor Icons, any CDN.
  // Each becomes a <link rel="stylesheet"> injected into the Shadow DOM.
  const re = /@import\s+url\(['"]?(https?:\/\/[^'"]+)['"]?\)/g;
  const hrefs: string[] = [];
  let m;
  while ((m = re.exec(css)) !== null) hrefs.push(sanitizeGoogleFontUrl(m[1]));
  return hrefs;
}

function updateCssRule(css: string, selector: string, props: Record<string, string>): string {
  return mutateCssProperties(css, selector, props);
}
