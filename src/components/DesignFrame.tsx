import { useRef, useEffect, useCallback, useState } from "react";
import type { HtmlToolName } from "./InfiniteHtmlCanvas";
import {
  cloneLayerCss,
  getCssPropertyValue,
  removeTransformFunction,
  setTransformFunction,
  updateCssProperties as mutateCssProperties,
} from "../lib/cssMutations";
import { createLayerId, duplicateLayerInHtml, ensureLayerIds } from "../lib/htmlMutations";
import { pickTopmostByBounds } from "../lib/selectionModel";
import { reconcileFrameHtml } from "../lib/frameReconciler";
import {
  computeBounds,
  createSmoothPoint,
  deletePoint as deletePathPoint,
  findClosestPathSegment,
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
  isSvg: boolean;
  svgChildTag?: string;
  shapeOptions?: ShapeOptions;
  /** data-layer-kind of the selected element (group | container | frame | …). */
  layerKind?: string;
  /** Number of element children with their own data-layer-id. */
  childLayerCount?: number;
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

interface DesignFrameProps {
  frame: FrameData;
  isActive: boolean;
  zoom?: number;
  onActivate: (frameId: string) => void;
  onElementSelect?: (info: SelectedElementInfo | null) => void;
  selectionRequest?: LayerSelectionRequest | null;
  selectedLayerId?: string | null;
  selectedLayerIds?: readonly string[];
  onLayerSelectionChange?: (frameId: string, layerIds: string[]) => void;
  onCssChange?: (frameId: string, newCss: string, newHtml?: string) => void;
  onHtmlChange?: (frameId: string, newHtml: string) => void;
  activeTool?: HtmlToolName;
  onAddPrimitive?: (type: "rect" | "circle" | "triangle" | "star" | "polygon" | "text", x: number, y: number, sides?: number) => void;
  onDrawShape?: (type: "rect" | "circle" | "triangle" | "star" | "polygon", x: number, y: number, w: number, h: number, sides?: number) => void;
  onTextChange?: (layerId: string, newText: string) => void;
  onAddTextBox?: (x: number, y: number, w: number, h: number) => void;
  onAddPenPath?: (pathData: string, bounds: { x: number; y: number; width: number; height: number }, closed?: boolean) => void;
  onAddTextPath?: (pathData: string, bounds: { x: number; y: number; width: number; height: number }, clickX: number, clickY: number, startOffset: number, originalViewBox?: string) => void;
  onEditPathPoints?: (layerId: string, newPathD: string) => void;
  onElementDelete?: (layerId: string) => void;
  onElementDuplicate?: (layerId: string) => void;
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

export function DesignFrame({
  frame, isActive, zoom, onActivate, onElementSelect, onCssChange, onHtmlChange,
  selectionRequest, selectedLayerId, selectedLayerIds = [], onLayerSelectionChange,
  activeTool, onAddPrimitive, onDrawShape, onTextChange, onAddTextBox, onAddPenPath, onAddTextPath, onEditPathPoints, onElementDelete, onElementDuplicate,
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
  const onAddTextBoxRef = useRef(onAddTextBox);
  onAddTextBoxRef.current = onAddTextBox;
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
  const onCssChangeRef = useRef(onCssChange);
  onCssChangeRef.current = onCssChange;
  const onHtmlChangeRef = useRef(onHtmlChange);
  onHtmlChangeRef.current = onHtmlChange;
  const onElementSelectRef = useRef(onElementSelect);
  onElementSelectRef.current = onElementSelect;
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
    cssRef.current = updatedCss;
    lastEmittedCssRef.current = updatedCss;
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
    // Wait a tick for the reconciler to finish DOM patching
    requestAnimationFrame(() => {
      const el = content.querySelector(`[data-layer-id="${autoEditLayerId}"]`) as HTMLElement | null;
      if (el) {
        enterTextEditMode(el);
        selectElement(el);
      }
      onAutoEditHandled?.();
    });
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
      return true;
    };
    let raf = 0;
    if (!register()) raf = requestAnimationFrame(() => register());
    return () => { if (raf) cancelAnimationFrame(raf); frameHitTestRegistry.delete(frame.id); };
  }, [frame.id]);

  // ── Code → DOM: CSS update ──
  useEffect(() => {
    // Skip only if React is feeding back the exact CSS we just emitted (echo suppression).
    // This allows undo/redo updates (different CSS) to flow through unblocked.
    if (lastEmittedCssRef.current === frame.css) {
      lastEmittedCssRef.current = null; // consume the echo
      return;
    }
    cssRef.current = frame.css;
    const shadow = shadowRef.current;
    if (!shadow) return;
    const style = shadow.querySelector("style");
    if (style) style.textContent = `#__df_content { width: ${frame.width}px; height: ${frame.height}px; overflow: hidden; }\n${mapBodySelectors(frame.css)}`;
    // Update font imports
    const existingLinks = shadow.querySelectorAll("link");
    const newHrefs = extractFontImports(frame.css);
    existingLinks.forEach(l => { if (!newHrefs.includes((l as HTMLLinkElement).href)) l.remove(); });
    for (const href of newHrefs) {
      if (![...shadow.querySelectorAll("link")].some(l => (l as HTMLLinkElement).href === href)) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        shadow.insertBefore(link, shadow.firstChild);
      }
    }
    if (selectedRef.current) {
      refreshOverlay(selectedRef.current);
      emitElementSelection(selectedRef.current, selectedSourceRef.current || selectedRef.current);
    }
  }, [frame.css]);

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

    let html = frame.html;

    // Ensure every element carries a data-layer-id so mousedown never has to
    // create one reactively — that was the root cause of janky selection (S2a).
    // Wrapping text nodes in <span data-layer-id> also guarantees clickable
    // inline text for tools (pen, text-box, text-path).
    if (html.trim()) {
      const ensured = ensureLayerIds(html, createLayerId);
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
    if (elements.length <= 1) return;
    const primary = elements.find(element => element.getAttribute("data-layer-id") === selectedLayerId)
      || elements[elements.length - 1];
    selectedRef.current = primary;
    refreshOverlay(primary);
    drawAdditionalSelectionOutlines(elements.filter(element => element !== primary));
  }, [selectedLayerIds, selectedLayerId, frame.html]);

  function emitElementSelection(element: Element, source: Element = element) {
    const computed = source.ownerDocument.defaultView!.getComputedStyle(source);
    const computedStyles: Record<string, string> = {};
    for (const property of TRACKED_PROPS) computedStyles[property] = computed.getPropertyValue(property);

    const tag = element.tagName.toLowerCase();
    const parentSvg = source.closest?.("svg");
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

    onElementSelectRef.current?.({
      layerId: element.getAttribute("data-layer-id") || "",
      tag,
      selector: getStyleSelector(element, source),
      computedStyles,
      frameId: frame.id,
      isSvg,
      svgChildTag: isSvg && source !== element ? source.tagName.toLowerCase() : undefined,
      shapeOptions,
      layerKind: element.getAttribute("data-layer-kind") || undefined,
      childLayerCount: [...element.children].filter(c => c.hasAttribute("data-layer-id")).length,
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

  /** Mini-button for the floating text bar. */
  function mkBtn(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.addEventListener("mousedown", (ev) => { ev.stopPropagation(); ev.preventDefault(); });
    btn.addEventListener("click", (ev) => { ev.stopPropagation(); onClick(); });
    Object.assign(btn.style, {
      width: "22px", height: "22px",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      border: "none", borderRadius: "4px",
      background: "rgba(255,255,255,0.08)",
      color: "#ccc", cursor: "pointer",
      fontFamily: "Inter, system-ui, sans-serif", fontSize: "11px",
      lineHeight: "1", padding: "0",
    });
    btn.addEventListener("mouseenter", () => { btn.style.background = "rgba(255,255,255,0.15)"; });
    btn.addEventListener("mouseleave", () => { btn.style.background = "rgba(255,255,255,0.08)"; });
    return btn;
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
    selectedRef.current = element;
    selectedSourceRef.current = source;
    refreshOverlay(element);
    emitElementSelection(element, source);
  }

  function findTopmostLayerAtPoint(content: Element, clientX: number, clientY: number): Element | null {
    const topLevel = [...content.children].filter(child => child.hasAttribute("data-layer-id"));
    return pickTopmostByBounds(topLevel, { x: clientX, y: clientY }, getVisualRect);
  }

  function drawAdditionalSelectionOutlines(elements: Element[]): void {
    const overlay = overlayRef.current;
    const content = shadowRef.current?.getElementById("__df_content");
    if (!overlay || !content) return;
    const contentRect = content.getBoundingClientRect();
    const z = zoomRef.current || 1;
    for (const element of elements) {
      const rect = getVisualRect(element);
      const outline = document.createElement("div");
      Object.assign(outline.style, {
        position: "absolute",
        left: `${(rect.left - contentRect.left) / z}px`,
        top: `${(rect.top - contentRect.top) / z}px`,
        width: `${rect.width / z}px`,
        height: `${rect.height / z}px`,
        border: `1px solid ${SEL}`,
        pointerEvents: "none",
        boxSizing: "border-box",
      });
      overlay.appendChild(outline);
    }
  }

  function clearOverlay() {
    if (overlayRef.current) overlayRef.current.innerHTML = "";
    pointEditPathRef.current = null;
    pointEditOverlayRef.current = null;
  }

  function refreshOverlay(el: Element) {
    const overlay = overlayRef.current;
    const shadow = shadowRef.current;
    if (!overlay || !shadow) return;
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

    // Selection border (always show)
    const box = document.createElement("div");
    Object.assign(box.style, {
      position: "absolute",
      left: `${x}px`, top: `${y}px`,
      width: `${w}px`, height: `${h}px`,
      border: `2px solid ${SEL}`,
      pointerEvents: "none",
      boxSizing: "border-box",
    });
    overlay.appendChild(box);

    // ── Sprint 3.5: Mini floating text bar above text elements ──
    const textElTag = el.tagName.toLowerCase();
    const isTextLike = el.getAttribute("data-layer-kind") === "text"
      || ["p", "h1", "h2", "h3", "h4", "h5", "h6", "span", "div"].includes(textElTag);
    if (isTextLike && !el.closest("svg") && el.textContent?.trim()) {
      const computed = shadow.host.ownerDocument.defaultView!.getComputedStyle(el);
      const fontSize = parseFloat(computed.fontSize) || 16;
      const isBold = parseInt(computed.fontWeight, 10) >= 600;
      const textColor = computed.color || "#333";
      const currentFont = (computed.fontFamily || "Inter").split(",")[0].replace(/['"]/g, "").trim();
      const letterSpacing = parseFloat(computed.letterSpacing) || 0;
      const lineHeight = parseFloat(computed.lineHeight) || 1.4;

      const FONT_LIST = ["Inter", "system-ui", "Georgia", "'Courier New'", "Trebuchet MS", "Arial", "Impact", "'Comic Sans MS'"];

      const bar = document.createElement("div");
      Object.assign(bar.style, {
        position: "absolute",
        left: `${x}px`,
        top: `${Math.max(0, y - 36)}px`,
        height: "28px",
        display: "flex",
        alignItems: "center",
        gap: "4px",
        padding: "0 6px",
        background: "rgba(30,30,35,0.95)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: "6px",
        pointerEvents: "auto",
        zIndex: "10001",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: "11px",
        color: "#e0e0e0",
        whiteSpace: "nowrap",
        userSelect: "none",
      });

      // Helper: apply a CSS property change from the mini bar
      const applyCss = (prop: string, val: string) => {
        (el as HTMLElement).style[prop as any] = val;
        const sel = getSelector(el);
        const updated = updateCssRule(cssRef.current, sel, importantProperties({ [prop]: val }));
        emitFrameChange(updated);
        refreshOverlay(el); // re-render the bar with updated values
      };

      // Font-family cycle button
      const fontBtn = document.createElement("button");
      const fontAbbr = currentFont.length > 8 ? currentFont.slice(0, 7) + "…" : currentFont;
      fontBtn.textContent = fontAbbr;
      fontBtn.style.cssText = "width:auto;padding:0 6px;height:22px;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:4px;background:rgba(255,255,255,0.08);color:#93c5fd;cursor:pointer;font-family:Inter,system-ui,sans-serif;font-size:10px;line-height:1;white-space:nowrap";
      fontBtn.addEventListener("mousedown", (ev) => { ev.stopPropagation(); ev.preventDefault(); });
      fontBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const idx = FONT_LIST.findIndex(f => f.replace(/['"]/g, "").trim() === currentFont);
        const next = FONT_LIST[(idx + 1) % FONT_LIST.length];
        applyCss("font-family", next);
      });
      fontBtn.addEventListener("mouseenter", () => { fontBtn.style.background = "rgba(255,255,255,0.15)"; });
      fontBtn.addEventListener("mouseleave", () => { fontBtn.style.background = "rgba(255,255,255,0.08)"; });

      // Font size stepper
      const sizeDown = mkBtn("−", () => applyCss("font-size", `${Math.max(8, fontSize - 2)}px`));
      const sizeLabel = document.createElement("span");
      sizeLabel.textContent = `${Math.round(fontSize)}px`;
      sizeLabel.style.minWidth = "28px";
      sizeLabel.style.textAlign = "center";
      const sizeUp = mkBtn("+", () => applyCss("font-size", `${Math.min(200, fontSize + 2)}px`));

      // Bold toggle
      const boldBtn = mkBtn("B", () => applyCss("font-weight", isBold ? "400" : "700"));
      boldBtn.style.fontWeight = isBold ? "700" : "400";
      boldBtn.style.color = isBold ? "#93c5fd" : "#aaa";

      // Letter-spacing stepper
      const lsDown = mkBtn("←→", () => applyCss("letter-spacing", `${Math.max(-5, +(letterSpacing - 0.5).toFixed(2))}px`));
      lsDown.style.width = "auto"; lsDown.style.padding = "0 4px"; lsDown.style.fontSize = "8px";
      const lsLabel = document.createElement("span");
      lsLabel.textContent = `${letterSpacing.toFixed(1)}`;
      lsLabel.style.minWidth = "20px";
      lsLabel.style.textAlign = "center";
      lsLabel.style.fontSize = "10px";
      const lsUp = mkBtn("→←", () => applyCss("letter-spacing", `${Math.min(20, +(letterSpacing + 0.5).toFixed(2))}px`));
      lsUp.style.width = "auto"; lsUp.style.padding = "0 4px"; lsUp.style.fontSize = "8px";

      // Line-height stepper
      const lhDown = mkBtn("↕", () => applyCss("line-height", `${Math.max(0.5, +(lineHeight - 0.1).toFixed(2))}`));
      lhDown.style.width = "auto"; lhDown.style.padding = "0 4px"; lhDown.style.fontSize = "8px";
      const lhLabel = document.createElement("span");
      lhLabel.textContent = `${lineHeight.toFixed(1)}`;
      lhLabel.style.minWidth = "20px";
      lhLabel.style.textAlign = "center";
      lhLabel.style.fontSize = "10px";
      const lhUp = mkBtn("↕", () => applyCss("line-height", `${Math.min(5, +(lineHeight + 0.1).toFixed(2))}`));
      lhUp.style.width = "auto"; lhUp.style.padding = "0 4px"; lhUp.style.fontSize = "8px";

      // Color swatches
      const swatches = ["#111", "#333", "#3B82F6", "#EF4444", "#10B981", "#F59E0B"];
      const swatchRow = document.createElement("div");
      swatchRow.style.display = "flex";
      swatchRow.style.gap = "3px";
      swatchRow.style.marginLeft = "4px";
      for (const sw of swatches) {
        const dot = document.createElement("div");
        Object.assign(dot.style, {
          width: "14px", height: "14px",
          borderRadius: "3px",
          background: sw,
          border: sw === textColor ? "2px solid #fff" : "1px solid rgba(255,255,255,0.2)",
          cursor: "pointer",
          boxSizing: "border-box",
        });
        dot.addEventListener("mousedown", (ev) => { ev.stopPropagation(); ev.preventDefault(); });
        dot.addEventListener("click", (ev) => { ev.stopPropagation(); applyCss("color", sw); });
        swatchRow.appendChild(dot);
      }

      const sep = document.createElement("div");
      sep.style.width = "1px";
      sep.style.height = "16px";
      sep.style.background = "rgba(255,255,255,0.12)";
      sep.style.margin = "0 1px";

      bar.appendChild(fontBtn);
      bar.appendChild(sizeDown);
      bar.appendChild(sizeLabel);
      bar.appendChild(sizeUp);
      bar.appendChild(sep.cloneNode());
      bar.appendChild(boldBtn);
      bar.appendChild(sep.cloneNode());
      bar.appendChild(lsDown);
      bar.appendChild(lsLabel);
      bar.appendChild(lsUp);
      bar.appendChild(sep.cloneNode());
      bar.appendChild(lhDown);
      bar.appendChild(lhLabel);
      bar.appendChild(lhUp);
      bar.appendChild(swatchRow);
      overlay.appendChild(bar);
    }

    // If this is an SVG path, render point editing overlay
    if (hasPath && pathData && targetPath) {
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

      // Render anchor points and control handles
      for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
        const point = points[pointIndex];
        const px = (point.x - vbX) * svgScaleX + svgLeft;
        const py = (point.y - vbY) * svgScaleY + svgTop;

        // Anchor point
        const anchor = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        anchor.setAttribute("cx", `${px}`);
        anchor.setAttribute("cy", `${py}`);
        anchor.setAttribute("r", point.type === "smooth" ? "5" : "4");
        anchor.setAttribute("fill", pointIndex === 0 ? "#10B981" : point.type === "smooth" ? "#A78BFA" : "#3B82F6");
        anchor.setAttribute("stroke", "#fff");
        anchor.setAttribute("stroke-width", "1.5");
        anchor.style.cursor = "move";
        anchor.style.pointerEvents = "auto";
        anchor.setAttribute("data-pe-point", `${pointIndex}`);
        anchor.setAttribute("data-pe-handle", "anchor");
        anchor.setAttribute("tabindex", "0");
        anchor.setAttribute("role", "button");
        anchor.setAttribute("aria-label", `Anchor ${pointIndex + 1}: ${point.type === "smooth" ? "curved" : "corner"}`);
        editSvg.appendChild(anchor);

        for (const handleName of ["cpIn", "cpOut"] as const) {
          const handle = point[handleName];
          if (!handle) continue;
          const handleX = (handle.x - vbX) * svgScaleX + svgLeft;
          const handleY = (handle.y - vbY) * svgScaleY + svgTop;
          const color = handleName === "cpIn" ? "#F59E0B" : "#8B5CF6";

          const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
          line.setAttribute("x1", `${px}`); line.setAttribute("y1", `${py}`);
          line.setAttribute("x2", `${handleX}`); line.setAttribute("y2", `${handleY}`);
          line.setAttribute("stroke", color); line.setAttribute("stroke-width", "1");
          line.setAttribute("opacity", "0.55"); line.style.pointerEvents = "none";
          editSvg.appendChild(line);

          const control = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          control.setAttribute("cx", `${handleX}`); control.setAttribute("cy", `${handleY}`);
          control.setAttribute("r", "3.5"); control.setAttribute("fill", color);
          control.setAttribute("stroke", "#fff"); control.setAttribute("stroke-width", "1");
          control.style.cursor = "move"; control.style.pointerEvents = "auto";
          control.setAttribute("data-pe-point", `${pointIndex}`);
          control.setAttribute("data-pe-handle", handleName);
          control.setAttribute("aria-label", `${handleName === "cpIn" ? "Incoming" : "Outgoing"} handle for anchor ${pointIndex + 1}`);
          editSvg.appendChild(control);
        }
      }

      const persistPointEdit = (editData: { layerId: string; points: PathPoint[]; closed: boolean }) => {
        const newPath = serializePathData(editData.points, editData.closed);
        targetPath.setAttribute("d", newPath);
        if (editData.layerId) onEditPathPointsRef.current?.(editData.layerId, newPath);
      };

      editSvg.addEventListener("mousedown", (event: Event) => {
        const target = event.target as SVGElement;
        const pointAttribute = target.getAttribute("data-pe-point");
        const handle = target.getAttribute("data-pe-handle") as "anchor" | "cpIn" | "cpOut" | null;
        if (pointAttribute == null || !handle) return;
        event.stopPropagation();
        event.preventDefault();

        const pointIndex = Number.parseInt(pointAttribute, 10);
        const editData = pointEditPathRef.current;
        if (!editData?.points[pointIndex]) return;
        let workingPoints = editData.points;

        const svgEl2 = targetPath.closest("svg");
        const svgRect2 = svgEl2?.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();
        const svgLeft2 = svgRect2 ? (svgRect2.left - contentRect.left) / z : x;
        const svgTop2 = svgRect2 ? (svgRect2.top - contentRect.top) / z : y;
        const viewBox = (svgEl2?.getAttribute("viewBox") || "0 0 0 0").split(/\s+/).map(Number);
        const [vbX2 = 0, vbY2 = 0, vbWidth2 = 0, vbHeight2 = 0] = viewBox;
        const svgScaleX2 = svgRect2 && vbWidth2 ? (svgRect2.width / z) / vbWidth2 : 1;
        const svgScaleY2 = svgRect2 && vbHeight2 ? (svgRect2.height / z) / vbHeight2 : 1;

        const eventToPathPoint = (mouseEvent: MouseEvent): Point => ({
          x: Math.round((((mouseEvent.clientX - contentRect.left) / z - svgLeft2) / svgScaleX2 + vbX2) * 10) / 10,
          y: Math.round((((mouseEvent.clientY - contentRect.top) / z - svgTop2) / svgScaleY2 + vbY2) * 10) / 10,
        });

        const onPointMove = (mouseEvent: MouseEvent) => {
          const position = eventToPathPoint(mouseEvent);
          if (handle === "anchor") {
            workingPoints = movePathPoint(workingPoints, pointIndex, position);
          } else {
            const remainsLinked = workingPoints[pointIndex].type === "smooth" && !mouseEvent.altKey;
            workingPoints = movePathHandle(workingPoints, pointIndex, handle, position, remainsLinked);
          }
          editData.points = workingPoints;
          targetPath.setAttribute("d", serializePathData(workingPoints, editData.closed));
          refreshOverlay(el);
        };

        const onPointUp = () => {
          document.removeEventListener("mousemove", onPointMove);
          document.removeEventListener("mouseup", onPointUp);
          persistPointEdit(editData);
        };
        document.addEventListener("mousemove", onPointMove);
        document.addEventListener("mouseup", onPointUp);
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

      editSvg.addEventListener("dblclick", (event: Event) => {
        const target = event.target as SVGElement;
        if (!target.hasAttribute("data-pe-point")) return;
        event.stopPropagation();
        event.preventDefault();
        toggleAnchor(target);
      });
      editSvg.addEventListener("keydown", (event: Event) => {
        const keyboardEvent = event as KeyboardEvent;
        if (keyboardEvent.key !== "Enter" && keyboardEvent.key !== " ") return;
        keyboardEvent.stopPropagation();
        keyboardEvent.preventDefault();
        toggleAnchor(keyboardEvent.target as SVGElement);
      });
    } else {
      // Rotation handle (above selection box)
      const rotHandleY = y - 24;
      // Dashed line from top-center to rotation handle
      const rotLine = document.createElement("div");
      Object.assign(rotLine.style, {
        position: "absolute",
        left: `${x + w / 2 - 0.5}px`,
        top: `${rotHandleY + 8}px`,
        width: "1px", height: `${y - rotHandleY - 8}px`,
        borderLeft: "1px dashed rgba(59,130,246,0.4)",
        pointerEvents: "none",
      });
      overlay.appendChild(rotLine);

      const rotHandle = document.createElement("div");
      Object.assign(rotHandle.style, {
        position: "absolute",
        left: `${x + w / 2 - 7}px`,
        top: `${rotHandleY}px`,
        width: "14px", height: "14px",
        borderRadius: "50%",
        border: "2px solid #3B82F6",
        background: "rgba(59,130,246,0.15)",
        cursor: "grab",
        pointerEvents: "auto",
        boxSizing: "border-box",
      });
      overlay.appendChild(rotHandle);

      rotHandle.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const centerX = x + w / 2;
        const centerY = y + h / 2;
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

    }

    const handles: [ResizeDirection, number, number, string][] = [
      ["nw", 0, 0, "nwse-resize"], ["n", 0.5, 0, "ns-resize"], ["ne", 1, 0, "nesw-resize"],
      ["w", 0, 0.5, "ew-resize"], ["e", 1, 0.5, "ew-resize"],
      ["sw", 0, 1, "nesw-resize"], ["s", 0.5, 1, "ns-resize"], ["se", 1, 1, "nwse-resize"],
    ];
    for (const [direction, cx, cy, cursor] of handles) {
      const handle = document.createElement("div");
      Object.assign(handle.style, {
        position: "absolute",
        left: `${x + cx * w - HANDLE / 2}px`,
        top: `${y + cy * h - HANDLE / 2}px`,
        width: `${HANDLE}px`, height: `${HANDLE}px`,
        background: SEL, border: "1px solid #fff",
        cursor, pointerEvents: "auto", boxSizing: "border-box",
      });
      overlay.appendChild(handle);
      handle.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        startResize(el, e as MouseEvent, direction, x, y, w, h);
      });
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
    }

    function hideHoverPreview() {
      if (hoverPreviewRef.current) {
        hoverPreviewRef.current.remove();
        hoverPreviewRef.current = null;
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
        const target = me.target as HTMLElement;
        if (!target || target === content) { hideHoverPreview(); return; }
        const hit = resolveHitTarget(target, scopeRef.current, me.ctrlKey || me.metaKey);
        if (hit && hit !== selectedRef.current) {
          showHoverPreview(hit);
        } else if (!hit) {
          hideHoverPreview();
        }
      }
    });

    // ── Hide hover preview when mouse leaves the frame ──
    content.addEventListener("mouseleave", () => {
      hideHoverPreview();
    });

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
            emitFrameChange(cssRef.current, content.innerHTML);
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
            emitFrameChange(cssRef.current, content.innerHTML);
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
              emitFrameChange(cssRef.current, content.innerHTML);
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
            // Click: auto-width text (grows as you type)
            onAddPrimitiveRef.current?.("text", Math.round(startX), Math.round(startY));
            return;
          }
          const cx = (ev.clientX - rect.left) / z;
          const cy = (ev.clientY - rect.top) / z;
          onAddTextBoxRef.current?.(
            Math.round(Math.min(startX, cx)),
            Math.round(Math.min(startY, cy)),
            Math.max(40, Math.round(Math.abs(cx - startX))),
            Math.max(20, Math.round(Math.abs(cy - startY))),
          );
        };
        document.addEventListener("mousemove", onTextMove);
        document.addEventListener("mouseup", onTextUp);
        return;
      }

      // ── Select tool (default) ──
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

      const dragItems: DragItem[] = isInMultiSelect
        ? multiSelectedElsRef.current.map(buildDragItem)
        : [buildDragItem(dragTarget)];

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
          if (item.preservesFlow) {
            targetStyle.translate = `${Math.round(item.baseTranslate.x + deltaX)}px ${Math.round(item.baseTranslate.y + deltaY)}px`;
          } else {
            targetStyle.translate = `${Math.round(deltaX)}px ${Math.round(deltaY)}px`;
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
        }

        if (duplicatedForDrag) updatedHtml = content.innerHTML;
        emitFrameChange(updatedCss, updatedHtml);

        // Restore full overlay with text bar / point edit after commit
        if (dragItems.length > 0) {
          refreshOverlay(dragItems[dragItems.length - 1].el);
        }
      };

      document.addEventListener("mousemove", onDragMove);
      document.addEventListener("mouseup", onDragUp);
    });

    // ── Double-click: scope drill-down or inline text editing ──
    content.addEventListener("dblclick", (e: Event) => {
      const me = e as MouseEvent;
      const target = me.target as HTMLElement;
      if (!target || target === content) return;

      // ── Scope drill-down (Sprint 3): enter container as new scope ──
      const tool = activeToolRef.current;
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

      // Only allow editing on text-like elements
      const tag = target.tagName.toLowerCase();
      const isTextLike = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "span", "a", "li", "div", "label", "button", "em", "strong", "small", "b", "i"].includes(tag);
      if (!isTextLike) return;

      // Editing a container as plain text would destroy its child structure.
      if (target.children.length > 0) return;

      e.stopPropagation();
      e.preventDefault();
      editingTextRef.current = target;

      target.setAttribute("contenteditable", "true");
      target.style.outline = `2px solid ${SEL}`;
      target.style.outlineOffset = "2px";
      target.style.cursor = "text";
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

      // Prevent Enter from bubbling to keyboard shortcuts
      target.addEventListener("keydown", (ke: Event) => {
        const kbe = ke as KeyboardEvent;
        if (kbe.key === "Escape") {
          target.blur();
        }
        kbe.stopPropagation();
      });
    });

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
    const bounds = computeBounds(pts);

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
    const target = el as HTMLElement;
    const computed = target.ownerDocument.defaultView!.getComputedStyle(target);
    const preservesFlow = computed.position === "static";
    const baseScale = parseCssScale(computed.scale);
    const baseLeft = parseFloat(computed.left) || 0;
    const baseTop = parseFloat(computed.top) || 0;
    const baseFontSize = parseFloat(computed.fontSize) || 0;
    const scalesText = target.children.length === 0 && /^(H[1-6]|P|SPAN|A|LI|LABEL|BUTTON|EM|STRONG|SMALL|B|I)$/.test(target.tagName);

    const affectsLeft = direction.includes("w");
    const affectsRight = direction.includes("e");
    const affectsTop = direction.includes("n");
    const affectsBottom = direction.includes("s");
    const isCorner = (affectsLeft || affectsRight) && (affectsTop || affectsBottom);
    const resizesFlowText = preservesFlow && scalesText && isCorner && baseFontSize > 0;

    const onMove = (ev: MouseEvent) => {
      const z = zoomRef.current || 1;
      const dx = (ev.clientX - startX) / z;
      const dy = (ev.clientY - startY) / z;

      let newX = ox, newY = oy, newW = ow, newH = oh;

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

      if (resizesFlowText) {
        const scale = Math.sqrt((newW / Math.max(ow, 1)) * (newH / Math.max(oh, 1)));
        target.style.fontSize = `${Math.max(1, Math.round(baseFontSize * scale * 100) / 100)}px`;
      } else if (preservesFlow) {
        const scaleX = baseScale.x * (newW / Math.max(ow, 1));
        const scaleY = baseScale.y * (newH / Math.max(oh, 1));
        const originX = affectsLeft ? "right" : affectsRight ? "left" : "center";
        const originY = affectsTop ? "bottom" : affectsBottom ? "top" : "center";
        target.style.scale = `${Math.max(0.01, scaleX)} ${Math.max(0.01, scaleY)}`;
        target.style.transformOrigin = `${originX} ${originY}`;
      } else {
        target.style.width = `${Math.round(newW)}px`;
        target.style.height = `${Math.round(newH)}px`;
        if (scalesText && isCorner && baseFontSize > 0) {
          const scale = Math.sqrt((newW / Math.max(ow, 1)) * (newH / Math.max(oh, 1)));
          target.style.fontSize = `${Math.max(1, Math.round(baseFontSize * scale * 100) / 100)}px`;
        }
        if (affectsLeft || affectsTop) {
          if (affectsLeft) target.style.left = `${Math.round(baseLeft + newX - ox)}px`;
          if (affectsTop) target.style.top = `${Math.round(baseTop + newY - oy)}px`;
        }
      }
      refreshOverlay(el);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const sel = getSelector(target);
      let props: Record<string, string>;
      if (resizesFlowText) {
        props = { "font-size": target.style.fontSize };
      } else if (preservesFlow) {
        props = { scale: target.style.scale, "transform-origin": target.style.transformOrigin };
      } else {
        props = { width: target.style.width, height: target.style.height };
      }
      if (!preservesFlow) {
        if (scalesText && isCorner && target.style.fontSize) props["font-size"] = target.style.fontSize;
        if (affectsLeft || affectsTop) {
          if (affectsLeft) props.left = target.style.left;
          if (affectsTop) props.top = target.style.top;
        }
      }
      const updated = updateCssRule(cssRef.current, sel, importantProperties(props));
      emitFrameChange(updated);
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
      {/* Label above frame — interactive: draggable + double-click to rename (Phase 1).
          Rendered last so it's on top. bottom: 100% places it visually above the frame. */}
      <div
        data-frame-label-id={frame.id}
        aria-label={`Move frame ${frame.name}`}
        style={{
          position: "absolute", bottom: "100%", left: 0,
          padding: "2px 8px", marginBottom: 4,
          fontSize: 11, fontFamily: "Inter, system-ui, sans-serif",
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
              fontSize: 11, fontFamily: "Inter, system-ui, sans-serif",
              background: "rgba(30,30,30,0.95)", color: "#fff",
              border: "1px solid #3B82F6", borderRadius: 3,
              padding: "1px 6px", outline: "none", width: 120,
            }}
          />
        ) : (
          <>
            {frame.name}
            <span style={{ marginLeft: 6, fontSize: 10, color: "#555" }}>
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
function mapBodySelectors(css: string): string {
  // Pass 1 — body / html at selector start (line start, after brace, after comma)
  return css
    .replace(/([{}]\s*|,\s*|^\s*)html\b/gm, "$1#__df_content")
    .replace(/([{}]\s*|,\s*|^\s*)body\b/gm, "$1#__df_content")
    // Pass 2 — descendant selectors (whitespace-preceded, e.g. "div body", "html body")
    .replace(/(\s)html\b/g, "$1#__df_content")
    .replace(/(\s)body\b/g, "$1#__df_content");
}

function extractFontImports(css: string): string[] {
  // Extract ALL @import url(...) from CSS — Google Fonts, Phosphor Icons, any CDN.
  // Each becomes a <link rel="stylesheet"> injected into the Shadow DOM.
  const re = /@import\s+url\(['"]?(https?:\/\/[^'"]+)['"]?\)/g;
  const hrefs: string[] = [];
  let m;
  while ((m = re.exec(css)) !== null) hrefs.push(m[1]);
  return hrefs;
}

function updateCssRule(css: string, selector: string, props: Record<string, string>): string {
  return mutateCssProperties(css, selector, props);
}
