import { useState, useCallback, useEffect, useRef } from "react";
import * as fabric from "fabric";
import type { StyleDefinition, ComponentDefinition, Comment, CommentReply, TemplateVersion, LayoutConstraint, AutoLayoutConfig, ResizingMode, BooleanOperation, Variable, VariableCollection, VariableType, VariableScope, GridStyle, ImageFitMode } from "@futuraria/shared";
import { performBooleanOperation } from "../lib/booleanOps";
import { useToast } from "../components/Toast";

// ─── Types ───────────────────────────────────────────────────────
export type ToolName =
  | "select" | "pencil" | "pen" | "rect" | "ellipse"
  | "line" | "text" | "image" | "frame" | "hand"
  | "eyedropper";

export interface LayerInfo {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  frameId?: string;
}

export interface FrameInfo {
  id: string;
  name: string;
  objectIds: string[];
}

export interface SectionInfo {
  id: string;
  name: string;
  color: string;
  collapsed: boolean;
  objectIds: string[];
}

export interface PageInfo {
  id: string;
  name: string;
  objectsJSON: any[];
  frames: FrameInfo[];
  vpt: { x: number; y: number; zoom: number };
  bgColor: string;
}

export interface SnapSettings {
  snapToGrid: boolean;
  gridSize: number;
  smartGuides: boolean;
  snapThreshold: number; // pixels
}

export interface ImageFilters {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  blur?: number;
  grayscale?: boolean;
  sepia?: boolean;
}

// ─── UID ─────────────────────────────────────────────────────────
let _uid = 0;
function uid(p = "n"): string { return `${p}_${Date.now()}_${++_uid}`; }

// ─── Module-level clipboard (shared across hook instances) ───────
let _clipboard: fabric.FabricObject | null = null;

// ─── Canvas coordinate system ────────────────────────────────────
const ORIGIN = 0;

// ─── Hook ────────────────────────────────────────────────────────
export function useCanvas(opts: {
  onSelectionChange: (obj: fabric.FabricObject | null) => void;
  onLayersChange: (layers: LayerInfo[]) => void;
  onPagesChange: (pages: PageInfo[]) => void;
  onFramesChange: (frames: FrameInfo[]) => void;
  onUndoRedoChange?: (canUndo: boolean, canRedo: boolean) => void;
  onCanvasSizeChange?: (size: { width: number; height: number }) => void;
  onCommentsChange?: (comments: Comment[]) => void;
  onVersionsChange?: (versions: TemplateVersion[]) => void;
}) {
  const { addToast } = useToast();
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // ─── State ─────────────────────────────────────────────────────
  const pagesRef = useRef<PageInfo[]>([]);
  const activePageIdRef = useRef<string>("");
  const framesRef = useRef<FrameInfo[]>([]);
  const activeFrameIdRef = useRef<string>("");
  const penPoints = useRef<{ x: number; y: number }[]>([]);
  const penLines = useRef<fabric.Line[]>([]);
  const penDots = useRef<fabric.Circle[]>([]);

  // ─── Smart Guides & Grid Snapping ────────────────────────────
  const snapSettingsRef = useRef<SnapSettings>({
    snapToGrid: true,
    gridSize: 10,
    smartGuides: true,
    snapThreshold: 5,
  });
  const guideLinesRef = useRef<fabric.Line[]>([]);
  const isDraggingRef = useRef(false);

  // ─── Grid visual toggle (decoupled from snapToGrid) ──────────
  const showGridRef = useRef(true);

  // ─── Grid Styles State ──────────────────────────────────────
  const gridStylesRef = useRef<GridStyle[]>([]);
  const activeGridStyleIdRef = useRef<string | null>(null);

  // ─── Image Fit Mode State ──────────────────────────────────
  const imageFitModesRef = useRef<Map<string, ImageFitMode>>(new Map());

  // ─── Copy/Paste Clipboard ────────────────────────────────────
  const clipboardRef = useRef<string | null>(null);

  // ─── Canvas dimensions ───────────────────────────────────────
  const canvasSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  // ─── Outline Mode ────────────────────────────────────────────
  const outlineModeRef = useRef(false);
  const originalFillsRef = useRef<Map<string, string>>(new Map());

  // ─── Styles State ────────────────────────────────────────────
  const stylesRef = useRef<StyleDefinition[]>([]);

  // ─── Component System State ──────────────────────────────────
  const componentsRef = useRef<Map<string, ComponentDefinition>>(new Map());
  const instanceRegistryRef = useRef<Map<string, string>>(new Map());

  // ─── Comments State ──────────────────────────────────────────
  const commentsRef = useRef<Comment[]>([]);
  const commentModeRef = useRef(false);
  const activeCommentIdRef = useRef<string | null>(null);

  // ─── Sections State ──────────────────────────────────────────
  const sectionsRef = useRef<SectionInfo[]>([]);

  // ─── Version History State ───────────────────────────────────
  const versionsRef = useRef<TemplateVersion[]>([]);
  const versionsLoadingRef = useRef(false);
  const versionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastVersionDataRef = useRef<string>("");

  // ─── Variables / Design Tokens State ─────────────────────────
  const variablesRef = useRef<Variable[]>([]);
  const collectionsRef = useRef<VariableCollection[]>([]);
  const activeModeRef = useRef<Record<string, string>>({});
  const variableBindingsRef = useRef<Map<string, Array<{ layerId: string; property: string }>>>(new Map());

  // ─── Undo/Redo State Stacks ─────────────────────────────────
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const MAX_HISTORY = 50;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRestoringRef = useRef(false);
  const initialStateSavedRef = useRef(false);

  // Get current page
  const currentPage = () => pagesRef.current.find(p => p.id === activePageIdRef.current);

  // ─── Undo/Redo Helpers ─────────────────────────────────────────

  /** Capture the current canvas state as a JSON string. */
  const captureState = useCallback((): string | null => {
    const c = fabricRef.current;
    if (!c) return null;
    const json = (c.toJSON as any)(["layerId", "layerName", "frameId", "isFrameVisual", "isFrameBg", "isClosedPath", "isFrameLabel", "imageFilters", "styleId", "componentId", "isComponentInstance", "constraints", "isSection", "isSectionBg", "isSectionLabel", "isSectionIndicator", "sectionId", "sectionColor"]);
    return JSON.stringify(json);
  }, []);

  /** Push current state onto the undo stack (clears redo). */
  const pushUndoState = useCallback(() => {
    if (isRestoringRef.current) return;
    const state = captureState();
    if (!state) return;
    if (undoStackRef.current.length > 0 && undoStackRef.current[undoStackRef.current.length - 1] === state) return;
    undoStackRef.current.push(state);
    if (undoStackRef.current.length > MAX_HISTORY) {
      undoStackRef.current.shift();
    }
    redoStackRef.current = [];
    opts.onUndoRedoChange?.(undoStackRef.current.length > 0, redoStackRef.current.length > 0);
  }, [captureState, opts.onUndoRedoChange]);

  /** Debounced version — waits 300ms after last change before saving. */
  const debouncedPushState = useCallback(() => {
    if (isRestoringRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      pushUndoState();
      saveTimerRef.current = null;
    }, 300);
  }, [pushUndoState]);

  /** Restore a canvas state from JSON string. */
  const restoreState = useCallback((stateJSON: string) => {
    const c = fabricRef.current;
    if (!c) return;
    isRestoringRef.current = true;

    const data = JSON.parse(stateJSON);
    c.getObjects().forEach(obj => c.remove(obj));

    fabric.util.enlivenObjects(data.objects || []).then((objects: any[]) => {
      for (const obj of objects) {
        c.add(obj);
      }
      c.discardActiveObject();
      c.renderAll();
      syncLayers();
      isRestoringRef.current = false;
    }).catch((err: any) => {
      console.error("[restoreState] Failed to enliven objects:", err);
      addToast("error", "Undo/redo failed", "Canvas state could not be restored");
      isRestoringRef.current = false;
    });
  }, []);

  /** Undo: pop from undo stack, push current to redo, restore previous. */
  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const c = fabricRef.current;
    if (!c) return;

    const current = captureState();
    if (current) redoStackRef.current.push(current);

    const previous = undoStackRef.current.pop()!;
    restoreState(previous);

    opts.onUndoRedoChange?.(undoStackRef.current.length > 0, redoStackRef.current.length > 0);
  }, [captureState, restoreState, opts.onUndoRedoChange]);

  /** Redo: pop from redo stack, push current to undo, restore next. */
  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const c = fabricRef.current;
    if (!c) return;

    const current = captureState();
    if (current) undoStackRef.current.push(current);

    const next = redoStackRef.current.pop()!;
    restoreState(next);

    opts.onUndoRedoChange?.(undoStackRef.current.length > 0, redoStackRef.current.length > 0);
  }, [captureState, restoreState, opts.onUndoRedoChange]);

  /** Query whether undo/redo is available. */
  const canUndo = useCallback(() => undoStackRef.current.length > 0, []);
  const canRedo = useCallback(() => redoStackRef.current.length > 0, []);

  // ─── Copy / Paste / Cut ────────────────────────────────────────

  /** Copy selected object(s) to internal clipboard as serialized JSON. */
  const copySelected = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const active = c.getActiveObject();
    if (!active) return;

    const json = (active.toJSON as any)(["layerId", "layerName", "frameId", "isClosedPath", "imageFilters", "styleId", "componentId", "isComponentInstance", "constraints", "isSection", "isSectionBg", "isSectionLabel", "isSectionIndicator", "sectionId", "sectionColor"]);
    clipboardRef.current = JSON.stringify(json);
  }, []);

  /** Cut selected object(s) — copy then delete. */
  const cutSelected = useCallback(() => {
    copySelected();
    deleteSelected();
  }, [copySelected]);

  /** Paste from clipboard with optional offset. */
  const pasteFromClipboard = useCallback(async (inPlace = false) => {
    const c = fabricRef.current;
    if (!c || !clipboardRef.current) return;

    const data = JSON.parse(clipboardRef.current);
    isRestoringRef.current = true;

    await fabric.util.enlivenObjects(data.objects || [data]).then((objects: any[]) => {
      if (objects.length === 0) { isRestoringRef.current = false; return; }

      let pasteObj: fabric.FabricObject;
      if (objects.length === 1) {
        pasteObj = objects[0];
      } else {
        pasteObj = new fabric.Group(objects);
      }

      (pasteObj as any).layerId = uid();
      if ((pasteObj as any).layerName) {
        (pasteObj as any).layerName = `${(pasteObj as any).layerName}_copy`;
      }

      if (!inPlace) {
        pasteObj.set({
          left: (pasteObj.left || 0) + 20,
          top: (pasteObj.top || 0) + 20,
        });
      }

      c.add(pasteObj);
      c.setActiveObject(pasteObj);
      c.renderAll();
      isRestoringRef.current = false;
    }).catch((err: any) => {
      console.error("[paste] Failed to enliven clipboard objects:", err);
      addToast("error", "Paste failed", "Clipboard data could not be restored");
      isRestoringRef.current = false;
    });
  }, []);

  /** Paste in place (same position as source). */
  const pasteInPlace = useCallback(async () => {
    await pasteFromClipboard(true);
  }, [pasteFromClipboard]);

  // ─── Group / Ungroup ───────────────────────────────────────────

  /** Group selected objects into a fabric.Group. */
  const groupSelected = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;

    const active = c.getActiveObject();
    if (!active || active.type !== "activeselection") return;

    const selection = active as fabric.ActiveSelection;
    const objs = selection.removeAll();
    c.discardActiveObject();

    const group = new fabric.Group(objs, {
      left: selection.left,
      top: selection.top,
    });

    (group as any).layerId = uid();
    (group as any).layerName = `group_${(group as any).layerId}`;
    (group as any).frameId = (objs[0] as any)?.frameId || activeFrameIdRef.current;

    c.add(group);
    c.setActiveObject(group);
    c.renderAll();
  }, []);

  /** Ungroup a fabric.Group, extracting children back to canvas. */
  const ungroupSelected = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;

    const active = c.getActiveObject();
    if (!active || active.type !== "group") return;

    const group = active as fabric.Group;
    const items = group.removeAll();
    c.remove(group);

    for (const item of items) {
      if (!(item as any).frameId) {
        (item as any).frameId = (group as any).frameId;
      }
      c.add(item);
    }

    const selection = new fabric.ActiveSelection(items, { canvas: c });
    c.setActiveObject(selection);
    c.renderAll();
  }, []);

  // ─── Select All ────────────────────────────────────────────────

  /** Select all non-frame, non-grid, non-guide objects on canvas. */
  const selectAll = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;

    const selectableObjects = c.getObjects().filter((obj: any) => {
      return !obj.isFrameVisual && !obj.isFrameLabel && !obj.isGridLine && !obj.isGuideLine &&
             obj.selectable !== false && obj.evented !== false;
    });

    if (selectableObjects.length === 0) return;

    const selection = new fabric.ActiveSelection(selectableObjects, { canvas: c });
    c.setActiveObject(selection);
    c.renderAll();
  }, []);

  // ─── Grid visual control ───────────────────────────────────────

  /** Get whether grid is visually shown. */
  const getShowGrid = useCallback(() => showGridRef.current, []);

  /** Toggle grid visual display. */
  const toggleShowGrid = useCallback(() => {
    showGridRef.current = !showGridRef.current;
    if (showGridRef.current) {
      renderGrid();
    } else {
      const c = fabricRef.current;
      if (c) {
        c.getObjects().filter((o: any) => o.isGridLine).forEach((o) => c.remove(o));
        c.renderAll();
      }
    }
    return showGridRef.current;
  }, []);

  /** Set grid visual display explicitly. */
  const setShowGrid = useCallback((show: boolean) => {
    showGridRef.current = show;
    if (show) {
      renderGrid();
    } else {
      const c = fabricRef.current;
      if (c) {
        c.getObjects().filter((o: any) => o.isGridLine).forEach((o) => c.remove(o));
        c.renderAll();
      }
    }
  }, []);

  // ─── Grid Styles CRUD ──────────────────────────────────────────

  const setGridStyles = useCallback((styles: GridStyle[]) => {
    gridStylesRef.current = styles;
  }, []);

  const getGridStyles = useCallback(() => gridStylesRef.current, []);

  const getActiveGridStyleId = useCallback(() => activeGridStyleIdRef.current, []);

  /** Apply a grid style to the canvas as an overlay. */
  const applyGridStyle = useCallback((styleId: string) => {
    const style = gridStylesRef.current.find((s) => s.id === styleId);
    if (!style) return;
    activeGridStyleIdRef.current = styleId;
    renderGridStyleOverlay(style);
  }, []);

  /** Remove the active grid style overlay. */
  const removeGridStyle = useCallback(() => {
    activeGridStyleIdRef.current = null;
    const c = fabricRef.current;
    if (!c) return;
    c.getObjects().filter((o: any) => o.isGridStyleLine).forEach((o) => c.remove(o));
    c.renderAll();
  }, []);

  /** Render a grid style as colored overlay lines on the canvas. */
  const renderGridStyleOverlay = useCallback((style: GridStyle) => {
    const c = fabricRef.current;
    if (!c) return;

    // Remove existing grid style lines
    c.getObjects().filter((o: any) => o.isGridStyleLine).forEach((o) => c.remove(o));

    const zoom = c.getZoom();
    const vpt = c.viewportTransform;
    const canvasW = c.width!;
    const canvasH = c.height!;

    // Calculate visible area in canvas coordinates
    const offsetX = vpt[4];
    const offsetY = vpt[5];
    const viewStartX = -offsetX / zoom;
    const viewStartY = -offsetY / zoom;
    const viewEndX = viewStartX + canvasW / zoom;
    const viewEndY = viewStartY + canvasH / zoom;

    const { count, gutter, margin, color } = style;
    const opacity = 0.25;
    const lineW = 1 / zoom;

    if (style.type === "columns" || style.type === "grid") {
      const totalGutter = gutter * (count - 1);
      const availableW = (viewEndX - viewStartX) - margin * 2 - totalGutter;
      const colW = availableW / count;

      for (let i = 0; i < count; i++) {
        const x = viewStartX + margin + i * (colW + gutter);
        const line = new fabric.Line([x, viewStartY, x, viewEndY], {
          stroke: color,
          strokeWidth: lineW,
          opacity,
          selectable: false,
          evented: false,
          excludeFromExport: true,
        });
        (line as any).isGridStyleLine = true;
        c.add(line);

        // Right edge of column
        const x2 = x + colW;
        const line2 = new fabric.Line([x2, viewStartY, x2, viewEndY], {
          stroke: color,
          strokeWidth: lineW,
          opacity,
          selectable: false,
          evented: false,
          excludeFromExport: true,
        });
        (line2 as any).isGridStyleLine = true;
        c.add(line2);
      }
    }

    if (style.type === "rows" || style.type === "grid") {
      const totalGutter = gutter * (count - 1);
      const availableH = (viewEndY - viewStartY) - margin * 2 - totalGutter;
      const rowH = availableH / count;

      for (let i = 0; i < count; i++) {
        const y = viewStartY + margin + i * (rowH + gutter);
        const line = new fabric.Line([viewStartX, y, viewEndX, y], {
          stroke: color,
          strokeWidth: lineW,
          opacity,
          selectable: false,
          evented: false,
          excludeFromExport: true,
        });
        (line as any).isGridStyleLine = true;
        c.add(line);

        const y2 = y + rowH;
        const line2 = new fabric.Line([viewStartX, y2, viewEndX, y2], {
          stroke: color,
          strokeWidth: lineW,
          opacity,
          selectable: false,
          evented: false,
          excludeFromExport: true,
        });
        (line2 as any).isGridStyleLine = true;
        c.add(line2);
      }
    }

    // Send grid style lines to back (above regular grid but below objects)
    const styleLines = c.getObjects().filter((o: any) => o.isGridStyleLine);
    for (const sl of styleLines) c.sendObjectToBack(sl);
    // Regular grid lines are already at the very back, so style lines sit above them
    c.renderAll();
  }, []);

  // ─── Image Fit Mode ────────────────────────────────────────────

  /** Set image fit mode for a specific image object. */
  const setImageFitMode = useCallback((layerId: string, fitMode: ImageFitMode) => {
    imageFitModesRef.current.set(layerId, fitMode);
    const c = fabricRef.current;
    if (!c) return;
    const obj = c.getObjects().find((o: any) => o.layerId === layerId);
    if (!obj || obj.type !== "image") return;

    const img = obj as fabric.FabricImage;
    const imgW = img.width || 1;
    const imgH = img.height || 1;

    // Store original image dimensions if not stored
    if (!(img as any)._origImgWidth) {
      (img as any)._origImgWidth = imgW;
      (img as any)._origImgHeight = imgH;
    }

    const origW = (img as any)._origImgWidth || imgW;
    const origH = (img as any)._origImgHeight || imgH;

    // Get the "container" dimensions (current scaled size)
    const containerW = imgW * (img.scaleX || 1);
    const containerH = imgH * (img.scaleY || 1);

    if (fitMode.mode === "fill") {
      // Fill: image covers entire container, maintaining aspect ratio
      const scale = Math.max(containerW / origW, containerH / origH);
      img.set({
        scaleX: scale,
        scaleY: scale,
      });
      // Apply clipPath to container bounds
      const clipRect = new fabric.Rect({
        width: containerW,
        height: containerH,
        absolutePositioned: false,
      });
      img.clipPath = clipRect;
    } else if (fitMode.mode === "fit") {
      // Fit: entire image visible within container
      const scale = Math.min(containerW / origW, containerH / origH);
      img.set({
        scaleX: scale,
        scaleY: scale,
      });
      const clipRect = new fabric.Rect({
        width: containerW,
        height: containerH,
        absolutePositioned: false,
      });
      img.clipPath = clipRect;
    } else if (fitMode.mode === "crop") {
      // Crop: user-controlled via offset and scale
      const scale = fitMode.scale || 1;
      img.set({
        scaleX: scale,
        scaleY: scale,
        left: (img.left || 0) + fitMode.offsetX,
        top: (img.top || 0) + fitMode.offsetY,
      });
      const clipRect = new fabric.Rect({
        width: containerW / scale,
        height: containerH / scale,
        absolutePositioned: false,
      });
      img.clipPath = clipRect;
    }

    c.renderAll();
  }, []);

  const getImageFitMode = useCallback((layerId: string): ImageFitMode | undefined => {
    return imageFitModesRef.current.get(layerId);
  }, []);

  // ─── Canvas Resize with ResizeObserver ─────────────────────────

  const updateCanvasSize = useCallback(() => {
    const c = fabricRef.current;
    const container = containerRef.current;
    if (!c || !container) return;

    const rect = container.getBoundingClientRect();
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);

    if (w <= 0 || h <= 0) return;

    c.setDimensions({ width: w, height: h });
    canvasSizeRef.current = { width: w, height: h };
    opts.onCanvasSizeChange?.({ width: w, height: h });
    c.renderAll();
  }, [opts.onCanvasSizeChange]);

  /** Attach a container ref for ResizeObserver. */
  const setContainerRef = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
  }, []);

  // ─── Eyedropper ────────────────────────────────────────────────

  /** Sample the color at the pointer position on the Fabric.js canvas. */
  const sampleColor = useCallback((e: MouseEvent): string | null => {
    const c = fabricRef.current;
    if (!c) return null;

    const canvasEl = c.getElement();
    const ctx = canvasEl.getContext("2d");
    if (!ctx) return null;

    const rect = canvasEl.getBoundingClientRect();
    const scaleX = canvasEl.width / rect.width;
    const scaleY = canvasEl.height / rect.height;
    const x = Math.floor((e.clientX - rect.left) * scaleX);
    const y = Math.floor((e.clientY - rect.top) * scaleY);

    if (x < 0 || y < 0 || x >= canvasEl.width || y >= canvasEl.height) return null;

    const pixel = ctx.getImageData(x, y, 1, 1).data;
    const r = pixel[0];
    const g = pixel[1];
    const b = pixel[2];
    const a = pixel[3];

    if (a === 0) return null;

    const hex = "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
    return hex;
  }, []);

  // ─── Zoom to Fit / Zoom to Selection ───────────────────────────

  /** Zoom and pan to fit all visible objects in the viewport. */
  const zoomToFit = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;

    const objects = c.getObjects().filter(
      (o: any) => !o.isGridLine && !o.isGuideLine && o.visible !== false
    );
    if (objects.length === 0) {
      c.setViewportTransform([1, 0, 0, 1, 0, 0]);
      c.renderAll();
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const obj of objects) {
      const br = obj.getBoundingRect();
      minX = Math.min(minX, br.left);
      minY = Math.min(minY, br.top);
      maxX = Math.max(maxX, br.left + br.width);
      maxY = Math.max(maxY, br.top + br.height);
    }

    const contentW = maxX - minX;
    const contentH = maxY - minY;
    if (contentW === 0 || contentH === 0) return;

    const el = c.getElement();
    const viewW = el.clientWidth;
    const viewH = el.clientHeight;

    const padding = 0.1;
    const scaleX = (viewW * (1 - padding * 2)) / contentW;
    const scaleY = (viewH * (1 - padding * 2)) / contentH;
    const newZoom = Math.min(scaleX, scaleY, 5);

    const centerX = minX + contentW / 2;
    const centerY = minY + contentH / 2;
    const newVptX = viewW / 2 - centerX * newZoom;
    const newVptY = viewH / 2 - centerY * newZoom;

    c.setViewportTransform([newZoom, 0, 0, newZoom, newVptX, newVptY]);
    c.renderAll();
  }, []);

  /** Zoom and pan to fit the currently selected object(s) in the viewport. */
  const zoomToSelection = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;

    const active = c.getActiveObject();
    if (!active) {
      zoomToFit();
      return;
    }

    const br = active.getBoundingRect();
    const contentW = br.width;
    const contentH = br.height;
    if (contentW === 0 || contentH === 0) return;

    const el = c.getElement();
    const viewW = el.clientWidth;
    const viewH = el.clientHeight;

    const padding = 0.2;
    const scaleX = (viewW * (1 - padding * 2)) / contentW;
    const scaleY = (viewH * (1 - padding * 2)) / contentH;
    const newZoom = Math.min(scaleX, scaleY, 5);

    const centerX = br.left + contentW / 2;
    const centerY = br.top + contentH / 2;
    const newVptX = viewW / 2 - centerX * newZoom;
    const newVptY = viewH / 2 - centerY * newZoom;

    c.setViewportTransform([newZoom, 0, 0, newZoom, newVptX, newVptY]);
    c.renderAll();
  }, [zoomToFit]);

  // ─── Outline Mode ──────────────────────────────────────────────

  /** Toggle outline mode: strips fills, shows only strokes/borders. */
  const setOutlineMode = useCallback((enabled: boolean) => {
    const c = fabricRef.current;
    if (!c) return;
    outlineModeRef.current = enabled;

    const objects = c.getObjects().filter(
      (o: any) => !o.isGridLine && !o.isGuideLine && !o.isFrameLabel
    );

    if (enabled) {
      originalFillsRef.current.clear();
      for (const obj of objects) {
        const fill = obj.fill as string;
        if (fill && fill !== "transparent") {
          originalFillsRef.current.set((obj as any).layerId || "", fill);
          obj.set({
            fill: "transparent",
            stroke: obj.stroke || "#6366f1",
            strokeWidth: Math.max(obj.strokeWidth || 1, 1),
          });
        }
      }
    } else {
      for (const obj of objects) {
        const id = (obj as any).layerId || "";
        const original = originalFillsRef.current.get(id);
        if (original) {
          obj.set({ fill: original });
        }
      }
    }

    c.renderAll();
  }, []);

  // ─── Z-order: Bring to Front / Send to Back ────────────────────

  /** Bring selected object to the very front of the stacking order. */
  const bringToFront = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const obj = c.getActiveObject();
    if (obj) {
      c.bringObjectToFront(obj);
      c.renderAll();
    }
  }, []);

  /** Send selected object to the very back of the stacking order. */
  const sendToBack = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const obj = c.getActiveObject();
    if (obj) {
      c.sendObjectToBack(obj);
      c.renderAll();
    }
  }, []);

  // ─── Next Frame ────────────────────────────────────────────────

  /** Select and navigate to the next frame in the list. */
  const nextFrame = useCallback(() => {
    const frames = framesRef.current;
    if (frames.length === 0) return;

    const currentIdx = frames.findIndex(f => f.id === activeFrameIdRef.current);
    const nextIdx = (currentIdx + 1) % frames.length;
    selectFrame(frames[nextIdx].id);
  }, []);

  // ─── Rename Layer ──────────────────────────────────────────────

  /** Rename a layer by its layerId. */
  const renameLayer = useCallback((layerId: string, newName: string) => {
    const c = fabricRef.current;
    if (!c) return;

    const obj = c.getObjects().find((o: any) => o.layerId === layerId);
    if (obj) {
      (obj as any).layerName = newName;
      c.renderAll();
      syncLayers();
    }
  }, []);

  /** Toggle lock/unlock for a layer. Locked layers can't be selected or moved. */
  const toggleLayerLock = useCallback((layerId: string) => {
    const c = fabricRef.current;
    if (!c) return;

    const obj = c.getObjects().find((o: any) => o.layerId === layerId);
    if (obj) {
      const locked = !obj.selectable;
      obj.set({ selectable: locked, evented: locked });
      if (locked) c.discardActiveObject();
      c.renderAll();
      syncLayers();
    }
  }, []);

  // Track when canvas element is mounted (so init effect re-runs after loading state clears)
  const [canvasMounted, setCanvasMounted] = useState(false);

  // ─── Init ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current || fabricRef.current) return;

    const initialWidth = containerRef.current?.clientWidth || (window.innerWidth - 328);
    const initialHeight = containerRef.current?.clientHeight || (window.innerHeight - 44);

    const c = new fabric.Canvas(canvasRef.current, {
      width: initialWidth,
      height: initialHeight,
      backgroundColor: "#0a0a0a",
      selection: true,
      preserveObjectStacking: true,
      controlsAboveOverlay: true,
    });
    fabricRef.current = c;
    (canvasRef.current as any).__fabric = c;

    canvasSizeRef.current = { width: initialWidth, height: initialHeight };
    opts.onCanvasSizeChange?.({ width: initialWidth, height: initialHeight });

    // ResizeObserver for dynamic canvas sizing
    let resizeObserver: ResizeObserver | null = null;
    if (containerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        updateCanvasSize();
        if (showGridRef.current) renderGrid();
      });
      resizeObserver.observe(containerRef.current);
    }

    // Create Page 1 with a default frame
    const pageId = uid("page");
    const defaultFrameId = uid("frame");
    pagesRef.current = [{
      id: pageId,
      name: "Page 1",
      objectsJSON: [],
      frames: [{ id: defaultFrameId, name: "Frame 1", objectIds: [] }],
      vpt: { x: 0, y: 0, zoom: 1 },
      bgColor: "#0a0a0a",
    }];
    activePageIdRef.current = pageId;
    framesRef.current = [{ id: defaultFrameId, name: "Frame 1", objectIds: [] }];
    activeFrameIdRef.current = defaultFrameId;

    // Create the default frame visual on canvas
    addFrameVisual(c, defaultFrameId, "Frame 1", 100, 100, 1080, 1080);

    // Sync events
    const sync = () => syncLayers();
    c.on("selection:created", (e) => {
      const obj = e.selected?.[0] || null;
      opts.onSelectionChange(obj);
      if (obj && (obj as any).isFrameBg) {
        activeFrameIdRef.current = (obj as any).frameId;
        opts.onFramesChange(framesRef.current);
      }
    });
    c.on("selection:updated", (e) => {
      const obj = e.selected?.[0] || null;
      opts.onSelectionChange(obj);
      if (obj && (obj as any).isFrameBg) {
        activeFrameIdRef.current = (obj as any).frameId;
        opts.onFramesChange(framesRef.current);
      }
    });
    c.on("selection:cleared", () => opts.onSelectionChange(null));

    // Undo/Redo: Hook into canvas mutation events
    c.on("object:modified", () => {
      sync();
      debouncedPushState();
    });
    c.on("object:added", () => {
      sync();
      if (!initialStateSavedRef.current && c.getObjects().length > 0) {
        setTimeout(() => {
          pushUndoState();
          initialStateSavedRef.current = true;
        }, 100);
      } else {
        debouncedPushState();
      }
    });
    c.on("object:removed", () => {
      sync();
      if (!isRestoringRef.current) {
        debouncedPushState();
      }
    });

    // Smart Guides + Grid Snapping
    setupSmartGuides(c);

    sync();
    opts.onPagesChange(pagesRef.current);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (resizeObserver) resizeObserver.disconnect();
      c.dispose();
      fabricRef.current = null;
    };
  }, [canvasMounted]);

  // ─── Sync layers ───────────────────────────────────────────────
  const syncLayers = useCallback(() => {
    const c = fabricRef.current; if (!c) return;
    const layers: LayerInfo[] = [];
    for (const frame of framesRef.current) frame.objectIds = [];
    for (const section of sectionsRef.current) section.objectIds = [];

    for (const obj of c.getObjects()) {
      const m = obj as any;
      if (m.isFrameVisual || m.isFrameLabel || m.isSectionLabel || m.isSectionIndicator) continue;
      const isFrame = !!m.isFrameBg;
      const isSection = !!m.isSectionBg;
      const layer: LayerInfo = {
        id: m.layerId || uid(),
        name: m.layerName || obj.type || "obj",
        type: isSection ? "section" : isFrame ? "frame" : (obj.type || "obj"),
        visible: obj.visible !== false,
        locked: obj.selectable === false,
        frameId: m.frameId,
      };
      layers.push(layer);
      if (m.frameId && !isFrame) {
        const f = framesRef.current.find(fr => fr.id === m.frameId);
        if (f) f.objectIds.push(m.layerId);
      }
      if (m.sectionId && !isSection) {
        const s = sectionsRef.current.find(sec => sec.id === m.sectionId);
        if (s) s.objectIds.push(m.layerId);
      }
    }
    opts.onLayersChange(layers);
    opts.onFramesChange(framesRef.current);
  }, []);

  // ─── Frame visual (background rect + label) ────────────────────
  const addFrameVisual = (c: fabric.Canvas, fid: string, name: string, x: number, y: number, w: number, h: number) => {
    const bg = new fabric.Rect({
      left: x, top: y, width: w, height: h,
      fill: "#161616", stroke: "#444", strokeWidth: 1,
      selectable: true,
      evented: true,
      hasControls: true,
      lockRotation: false,
      cornerColor: "#6366f1",
      cornerStrokeColor: "#6366f1",
      borderColor: "#6366f1",
      transparentCorners: false,
      cornerSize: 8,
    });
    (bg as any).isFrameVisual = true;
    (bg as any).isFrameBg = true;
    (bg as any).frameId = fid;
    (bg as any).layerName = name;
    (bg as any).layerId = fid;
    c.add(bg);

    // Initialize frame size snapshot for constraints
    frameSizeSnapshotRef.current.set(fid, { left: x, top: y, width: w, height: h });

    const label = new fabric.Textbox(name, {
      left: x, top: y - 28,
      fontSize: 18, fill: "#ddd",
      fontFamily: "Inter, sans-serif",
      fontWeight: "bold",
      selectable: false,
      evented: true,
      width: 400,
      hoverCursor: "pointer",
    });
    (label as any).isFrameVisual = true;
    (label as any).isFrameLabel = true;
    (label as any).frameId = fid;
    c.add(label);

    label.on("mousedown", () => {
      const frameBg = c.getObjects().find(
        (o: any) => o.isFrameVisual && o.isFrameBg && o.frameId === fid
      );
      if (frameBg) {
        c.setActiveObject(frameBg);
        c.renderAll();
      }
    });

    bg.on("moving", () => {
      label.set({ left: bg.left, top: (bg.top || 0) - 28 });
      c.renderAll();
    });
    bg.on("scaling", () => {
      label.set({ left: bg.left, top: (bg.top || 0) - 28 });
      if (!frameSizeSnapshotRef.current.has(fid)) {
        const br = bg.getBoundingRect();
        frameSizeSnapshotRef.current.set(fid, { left: br.left, top: br.top, width: br.width, height: br.height });
      }
      c.renderAll();
    });
    bg.on("modified", () => {
      label.set({ left: bg.left, top: (bg.top || 0) - 28 });
      const frame = framesRef.current.find(f => f.id === fid);
      if (frame) label.set("text", frame.name);
      applyConstraintsToFrame(fid, bg);
      c.renderAll();
      syncLayers();
    });
  };

  // ─── Smart Guides & Grid Snapping Engine ───────────────────────
  const setupSmartGuides = (c: fabric.Canvas) => {
    c.on("object:moving", (e) => {
      const target = e.target;
      if (!target || (target as any).isFrameLabel) return;
      isDraggingRef.current = true;

      const settings = snapSettingsRef.current;
      const zoom = c.getZoom();

      clearGuideLines(c);

      const targetBounds = getObjectBounds(target);

      if (settings.snapToGrid) {
        const gridSize = settings.gridSize;
        const snappedLeft = Math.round(targetBounds.left / gridSize) * gridSize;
        const snappedTop = Math.round(targetBounds.top / gridSize) * gridSize;
        target.set({
          left: snappedLeft + (target.left! - targetBounds.left),
          top: snappedTop + (target.top! - targetBounds.top),
        });
        target.setCoords();
      }

      if (settings.smartGuides) {
        const threshold = settings.snapThreshold / zoom;
        const otherObjects = c.getObjects().filter(
          (o) => o !== target && !(o as any).isFrameLabel && !(o as any).isFrameVisual
        );

        const { snapX, snapY, guides } = findAlignmentGuides(
          target, targetBounds, otherObjects, threshold
        );

        if (snapX !== null) {
          target.set({ left: target.left! + (snapX - targetBounds.centerX) });
          target.setCoords();
        }
        if (snapY !== null) {
          target.set({ top: target.top! + (snapY - targetBounds.centerY) });
          target.setCoords();
        }

        for (const g of guides) {
          const line = createGuideLine(c, g, zoom);
          guideLinesRef.current.push(line);
        }
      }

      c.renderAll();
    });

    c.on("object:scaling", (e) => {
      const target = e.target;
      if (!target || !snapSettingsRef.current.snapToGrid) return;
      const gridSize = snapSettingsRef.current.gridSize;

      const w = (target.width || 0) * (target.scaleX || 1);
      const h = (target.height || 0) * (target.scaleY || 1);
      const snappedW = Math.round(w / gridSize) * gridSize;
      const snappedH = Math.round(h / gridSize) * gridSize;
      target.set({
        scaleX: snappedW / (target.width || 1),
        scaleY: snappedH / (target.height || 1),
      });
      target.setCoords();
    });

    c.on("mouse:up", () => {
      if (isDraggingRef.current) {
        clearGuideLines(c);
        isDraggingRef.current = false;
      }
    });
  };

  const getObjectBounds = (obj: fabric.FabricObject) => {
    const br = obj.getBoundingRect();
    return {
      left: br.left,
      top: br.top,
      right: br.left + br.width,
      bottom: br.top + br.height,
      centerX: br.left + br.width / 2,
      centerY: br.top + br.height / 2,
      width: br.width,
      height: br.height,
    };
  };

  const findAlignmentGuides = (
    target: fabric.FabricObject,
    targetBounds: ReturnType<typeof getObjectBounds>,
    others: fabric.FabricObject[],
    threshold: number
  ) => {
    let snapX: number | null = null;
    let snapY: number | null = null;
    const guides: { type: 'horizontal' | 'vertical'; pos: number; start: number; end: number }[] = [];

    for (const other of others) {
      const otherBounds = getObjectBounds(other);

      const verticalChecks = [
        { targetVal: targetBounds.left,    otherVal: otherBounds.left },
        { targetVal: targetBounds.left,    otherVal: otherBounds.right },
        { targetVal: targetBounds.right,   otherVal: otherBounds.left },
        { targetVal: targetBounds.right,   otherVal: otherBounds.right },
        { targetVal: targetBounds.centerX, otherVal: otherBounds.centerX },
      ];

      for (const check of verticalChecks) {
        const diff = check.targetVal - check.otherVal;
        if (Math.abs(diff) < threshold) {
          if (snapX === null || Math.abs(diff) < Math.abs(snapX - targetBounds.centerX)) {
            snapX = check.otherVal;
          }
          const minY = Math.min(targetBounds.top, otherBounds.top);
          const maxY = Math.max(targetBounds.bottom, otherBounds.bottom);
          guides.push({ type: 'vertical', pos: check.otherVal, start: minY - 20, end: maxY + 20 });
        }
      }

      const horizontalChecks = [
        { targetVal: targetBounds.top,     otherVal: otherBounds.top },
        { targetVal: targetBounds.top,     otherVal: otherBounds.bottom },
        { targetVal: targetBounds.bottom,  otherVal: otherBounds.top },
        { targetVal: targetBounds.bottom,  otherVal: otherBounds.bottom },
        { targetVal: targetBounds.centerY, otherVal: otherBounds.centerY },
      ];

      for (const check of horizontalChecks) {
        const diff = check.targetVal - check.otherVal;
        if (Math.abs(diff) < threshold) {
          if (snapY === null || Math.abs(diff) < Math.abs(snapY - targetBounds.centerY)) {
            snapY = check.otherVal;
          }
          const minX = Math.min(targetBounds.left, otherBounds.left);
          const maxX = Math.max(targetBounds.right, otherBounds.right);
          guides.push({ type: 'horizontal', pos: check.otherVal, start: minX - 20, end: maxX + 20 });
        }
      }
    }

    const uniqueGuides = guides.filter((g, i, arr) =>
      arr.findIndex((x) => x.type === g.type && Math.abs(x.pos - g.pos) < 1) === i
    );

    return { snapX, snapY, guides: uniqueGuides };
  };

  const createGuideLine = (
    c: fabric.Canvas,
    guide: { type: 'horizontal' | 'vertical'; pos: number; start: number; end: number },
    zoom: number
  ): fabric.Line => {
    const isH = guide.type === 'horizontal';
    const coords: [number, number, number, number] = isH
      ? [guide.start, guide.pos, guide.end, guide.pos]
      : [guide.pos, guide.start, guide.pos, guide.end];

    const line = new fabric.Line(coords, {
      stroke: isH ? '#22c55e' : '#3b82f6',
      strokeWidth: 1 / zoom,
      selectable: false,
      evented: false,
      excludeFromExport: true,
      strokeDashArray: [4 / zoom, 4 / zoom],
      opacity: 0.8,
    });
    (line as any).isGuideLine = true;
    c.add(line);
    c.bringObjectToFront(line);
    return line;
  };

  const clearGuideLines = (c: fabric.Canvas) => {
    for (const line of guideLinesRef.current) {
      c.remove(line);
    }
    guideLinesRef.current = [];
  };

  // ─── Snap Settings API ──────────────────────────────────────────
  const setSnapSettings = useCallback((settings: Partial<SnapSettings>) => {
    snapSettingsRef.current = { ...snapSettingsRef.current, ...settings };
  }, []);

  const getSnapSettings = useCallback(() => snapSettingsRef.current, []);

  const toggleSnapToGrid = useCallback(() => {
    snapSettingsRef.current.snapToGrid = !snapSettingsRef.current.snapToGrid;
    return snapSettingsRef.current.snapToGrid;
  }, []);

  const toggleSmartGuides = useCallback(() => {
    snapSettingsRef.current.smartGuides = !snapSettingsRef.current.smartGuides;
    return snapSettingsRef.current.smartGuides;
  }, []);

  const setGridSize = useCallback((size: number) => {
    snapSettingsRef.current.gridSize = Math.max(1, size);
  }, []);

  // ─── Render grid overlay ────────────────────────────────────────
  const renderGrid = useCallback(() => {
    const c = fabricRef.current; if (!c) return;
    c.getObjects().filter((o: any) => o.isGridLine).forEach((o) => c.remove(o));
    c.getObjects().filter((o: any) => o.isGridStyleLine).forEach((o) => c.remove(o));

    if (!showGridRef.current) {
      c.renderAll();
      return;
    }

    const gridSize = snapSettingsRef.current.gridSize;
    const zoom = c.getZoom();
    const vpt = c.viewportTransform;
    const canvasWidth = c.width!;
    const canvasHeight = c.height!;

    if (zoom < 0.3) { c.renderAll(); return; }

    const offsetX = vpt[4];
    const offsetY = vpt[5];
    const startX = Math.floor(-offsetX / zoom / gridSize) * gridSize;
    const startY = Math.floor(-offsetY / zoom / gridSize) * gridSize;
    const endX = startX + canvasWidth / zoom + gridSize * 2;
    const endY = startY + canvasHeight / zoom + gridSize * 2;

    const majorEvery = 5;

    for (let x = startX; x <= endX; x += gridSize) {
      const isMajor = Math.round(x / gridSize) % majorEvery === 0;
      const line = new fabric.Line([x, startY, x, endY], {
        stroke: isMajor ? '#2a2a3a' : '#1e1e2e',
        strokeWidth: (isMajor ? 0.8 : 0.4) / zoom,
        selectable: false,
        evented: false,
        excludeFromExport: true,
      });
      (line as any).isGridLine = true;
      c.add(line);
    }

    for (let y = startY; y <= endY; y += gridSize) {
      const isMajor = Math.round(y / gridSize) % majorEvery === 0;
      const line = new fabric.Line([startX, y, endX, y], {
        stroke: isMajor ? '#2a2a3a' : '#1e1e2e',
        strokeWidth: (isMajor ? 0.8 : 0.4) / zoom,
        selectable: false,
        evented: false,
        excludeFromExport: true,
      });
      (line as any).isGridLine = true;
      c.add(line);
    }

    const gridLines = c.getObjects().filter((o: any) => o.isGridLine);
    for (const gl of gridLines) c.sendObjectToBack(gl);

    // Re-render active grid style overlay on top of regular grid
    if (activeGridStyleIdRef.current) {
      const activeStyle = gridStylesRef.current.find(s => s.id === activeGridStyleIdRef.current);
      if (activeStyle) renderGridStyleOverlay(activeStyle);
    }

    c.renderAll();
  }, []);

  // Render grid on zoom
  useEffect(() => {
    const c = fabricRef.current; if (!c) return;
    const handler = () => { if (showGridRef.current) renderGrid(); };
    c.on("mouse:wheel", handler);
    return () => { c.off("mouse:wheel", handler); };
  }, [renderGrid]);

  // ─── Save current page state ───────────────────────────────────
  const savePage = useCallback(() => {
    const c = fabricRef.current; if (!c) return;
    const page = currentPage(); if (!page) return;
    const objs = c.getObjects().filter((o: any) => !o.isFrameVisual && !o.isGridLine && !o.isGuideLine);
    page.objectsJSON = objs.map(o => o.toObject(["layerId", "layerName", "frameId", "isClosedPath", "imageFilters", "styleId", "componentId", "isComponentInstance"]));
    page.vpt = {
      x: c.viewportTransform[4],
      y: c.viewportTransform[5],
      zoom: c.getZoom(),
    };
    page.frames = framesRef.current.map(f => ({ ...f }));
  }, []);

  // ─── Load a page ───────────────────────────────────────────────
  const loadPage = useCallback((pageId: string) => {
    const c = fabricRef.current; if (!c) return;
    savePage();

    const page = pagesRef.current.find(p => p.id === pageId);
    if (!page) return;

    c.clear();
    c.backgroundColor = page.bgColor;
    activePageIdRef.current = pageId;
    framesRef.current = page.frames;
    activeFrameIdRef.current = framesRef.current[0]?.id || "";

    for (const frame of framesRef.current) {
      const idx = framesRef.current.indexOf(frame);
      addFrameVisual(c, frame.id, frame.name, 100 + idx * 1200, 100, 1080, 1080);
    }

    if (page.objectsJSON.length > 0) {
      const promises = page.objectsJSON.map((data: any) =>
        fabric.util.enlivenObjects([data]).then(([obj]: any) => { if (obj) c.add(obj); })
      );
      Promise.all(promises).then(() => {
        syncLayers();
        c.renderAll();
        if (showGridRef.current) renderGrid();
      }).catch((err: any) => {
        console.error("[switchPage] Failed to enliven page objects:", err);
        addToast("error", "Page load failed", "Some page objects could not be restored");
        syncLayers();
        c.renderAll();
        if (showGridRef.current) renderGrid();
      });
    } else {
      syncLayers();
      if (showGridRef.current) renderGrid();
    }

    c.setViewportTransform([page.vpt.zoom, 0, 0, page.vpt.zoom, page.vpt.x, page.vpt.y]);
    c.renderAll();
    opts.onPagesChange(pagesRef.current);

    undoStackRef.current = [];
    redoStackRef.current = [];
    initialStateSavedRef.current = false;
    opts.onUndoRedoChange?.(false, false);
  }, [savePage, renderGrid]);

  // ─── Page CRUD ─────────────────────────────────────────────────
  const addPage = useCallback(() => {
    const pageId = uid("page");
    pagesRef.current.push({
      id: pageId,
      name: `Page ${pagesRef.current.length + 1}`,
      objectsJSON: [],
      frames: [],
      vpt: { x: 0, y: 0, zoom: 1 },
      bgColor: "#0a0a0a",
    });
    loadPage(pageId);
  }, [loadPage]);

  const switchPage = useCallback((pageId: string) => { loadPage(pageId); }, [loadPage]);

  const renamePage = useCallback((pageId: string, name: string) => {
    const page = pagesRef.current.find(p => p.id === pageId);
    if (page) page.name = name;
    opts.onPagesChange(pagesRef.current);
  }, []);

  const deletePage = useCallback((pageId: string) => {
    if (pagesRef.current.length <= 1) return;
    pagesRef.current = pagesRef.current.filter(p => p.id !== pageId);
    if (activePageIdRef.current === pageId) loadPage(pagesRef.current[0].id);
    opts.onPagesChange(pagesRef.current);
  }, [loadPage]);

  // ─── Frame CRUD ────────────────────────────────────────────────
  const addFrame = useCallback(() => {
    const c = fabricRef.current; if (!c) return;
    const fid = uid("frame");
    const name = `Frame ${framesRef.current.length + 1}`;

    let x = 100, y = 100;
    const lastFrame = framesRef.current[framesRef.current.length - 1];
    if (lastFrame) {
      const lastVisual = c.getObjects().find((o: any) => o.isFrameVisual && o.frameId === lastFrame.id && o.type === "rect");
      if (lastVisual) x = (lastVisual.left || 0) + (lastVisual.width || 0) + 100;
    }

    addFrameVisual(c, fid, name, x, y, 1080, 1080);
    framesRef.current.push({ id: fid, name, objectIds: [] });
    activeFrameIdRef.current = fid;

    const page = currentPage();
    if (page) page.frames = [...framesRef.current];

    syncLayers();
    opts.onPagesChange(pagesRef.current);
  }, []);

  const selectFrame = useCallback((fid: string) => {
    const c = fabricRef.current; if (!c) return;
    activeFrameIdRef.current = fid;

    const visual = c.getObjects().find((o: any) => o.isFrameVisual && o.frameId === fid && o.type === "rect");
    if (visual) {
      const fx = visual.left || 0;
      const fy = visual.top || 0;
      const fw = (visual.width || 0) * (visual.scaleX || 1);
      const fh = (visual.height || 0) * (visual.scaleY || 1);
      const el = c.getElement();
      const viewW = el.clientWidth;
      const viewH = el.clientHeight;
      const zoom = c.getZoom();
      const newVptX = viewW / 2 - (fx + fw / 2) * zoom;
      const newVptY = viewH / 2 - (fy + fh / 2) * zoom;
      c.setViewportTransform([zoom, 0, 0, zoom, newVptX, newVptY]);
      c.renderAll();
    }
    syncLayers();
  }, []);

  const renameFrame = useCallback((fid: string, name: string) => {
    const c = fabricRef.current; if (!c) return;
    const frame = framesRef.current.find(f => f.id === fid);
    if (!frame) return;
    frame.name = name;
    const label = c.getObjects().find((o: any) => o.isFrameVisual && o.frameId === fid && o.type === "textbox");
    if (label) { (label as any).text = name; c.renderAll(); }
    syncLayers();
    opts.onPagesChange(pagesRef.current);
  }, []);

  const deleteFrame = useCallback((fid: string) => {
    const c = fabricRef.current; if (!c) return;

    c.getObjects().filter((o: any) => o.frameId === fid).forEach(o => c.remove(o));
    c.getObjects().filter((o: any) => (o as any).frameId === fid).forEach(o => c.remove(o));

    framesRef.current = framesRef.current.filter(f => f.id !== fid);

    if (activeFrameIdRef.current === fid) {
      activeFrameIdRef.current = framesRef.current[0]?.id || "";
    }

    const page = currentPage();
    if (page) page.frames = [...framesRef.current];

    syncLayers();
    opts.onPagesChange(pagesRef.current);
  }, []);

  // ─── Tool mode ─────────────────────────────────────────────────
  const setToolMode = useCallback((tool: ToolName) => {
    const c = fabricRef.current; if (!c) return;
    c.isDrawingMode = false;
    c.selection = true;
    c.defaultCursor = "default";
    c.hoverCursor = "move";
    if (tool === "pencil") {
      c.isDrawingMode = true;
      c.freeDrawingBrush = new fabric.PencilBrush(c);
      c.freeDrawingBrush.color = "#ffffff";
      c.freeDrawingBrush.width = 2;
    } else if (tool === "pen") { c.selection = false; c.defaultCursor = "crosshair"; }
    else if (tool === "hand") { c.selection = false; c.defaultCursor = "grab"; }
    else if (tool === "eyedropper") {
      c.selection = false;
      c.defaultCursor = "crosshair";
      c.hoverCursor = "crosshair";
    }
    else if (tool !== "select") { c.selection = false; c.defaultCursor = "crosshair"; }
  }, []);

  // ─── Object placement helper ───────────────────────────────────
  const placeInFrame = (obj: fabric.FabricObject) => {
    const c = fabricRef.current; if (!c) return;

    if ((obj as any).isFrameBg) {
      (obj as any).layerId = uid();
      c.add(obj);
      c.setActiveObject(obj);
      c.renderAll();
      return;
    }

    const fid = activeFrameIdRef.current;
    (obj as any).layerId = uid();
    (obj as any).frameId = fid;
    const frameVisual = c.getObjects().find((o: any) => o.isFrameVisual && o.frameId === fid && o.type === "rect");
    if (frameVisual && !obj.left) {
      obj.set({
        left: (frameVisual.left || 0) + 100,
        top: (frameVisual.top || 0) + 100,
      });
    }
    c.add(obj);
    c.setActiveObject(obj);
    c.renderAll();
  };

  // ─── Shape creation ────────────────────────────────────────────
  const addRect = useCallback(() => {
    const id = uid();
    const obj = new fabric.Rect({
      left: 200, top: 200, width: 200, height: 150,
      fill: "#6366f1", rx: 8, ry: 8,
      shadow: new fabric.Shadow({ color: "rgba(0,0,0,0.2)", blur: 10, offsetY: 4 }),
    });
    (obj as any).layerName = `rect_${id}`;
    placeInFrame(obj);
  }, []);

  const addEllipse = useCallback(() => {
    const id = uid();
    const obj = new fabric.Ellipse({ left: 200, top: 200, rx: 100, ry: 80, fill: "#22c55e" });
    (obj as any).layerName = `ellipse_${id}`;
    placeInFrame(obj);
  }, []);

  const addLine = useCallback(() => {
    const id = uid();
    const obj = new fabric.Line([200, 300, 500, 300], { stroke: "#ffffff", strokeWidth: 2 });
    (obj as any).layerName = `line_${id}`;
    placeInFrame(obj);
  }, []);

  const addText = useCallback((text = "Edit me") => {
    const id = uid();
    const obj = new fabric.Textbox(text, {
      left: 200, top: 200, width: 300,
      fontSize: 32, fill: "#ffffff", fontFamily: "Inter, sans-serif",
    });
    (obj as any).layerName = `text_${id}`;
    placeInFrame(obj);
  }, []);

  const addImage = useCallback((src: string) => {
    const imgEl = new Image(); imgEl.crossOrigin = "anonymous";
    imgEl.onload = () => {
      const id = uid();
      const img = new fabric.FabricImage(imgEl, { left: 200, top: 200 });
      if (img.width && img.height) { const s = Math.min(500 / img.width, 500 / img.height, 1); img.scale(s); }
      (img as any).layerName = `image_${id}`;
      (img as any).imageFilters = {};
      placeInFrame(img);
    };
    imgEl.src = src;
  }, []);

  const addSVG = useCallback((svgString: string) => {
    (fabric.loadSVGFromString as any)(svgString).then((result: any) => {
      const objects = (result.objects || []).filter(Boolean) as fabric.FabricObject[];
      if (objects.length === 0) return;
      const id = uid();
      if (objects.length === 1) {
        const obj = objects[0]; obj.set({ left: 200, top: 200 });
        (obj as any).layerName = `svg_${id}`;
        placeInFrame(obj);
      } else {
        const group = new fabric.Group(objects); group.set({ left: 200, top: 200 });
        if (group.width && group.height) { const s = Math.min(500 / group.width, 500 / group.height, 1); group.scale(s); }
        (group as any).layerName = `svg_${id}`;
        placeInFrame(group);
      }
    });
  }, []);

  // ─── Image Filters ─────────────────────────────────────────────
  const applyImageFilters = useCallback((img: fabric.FabricImage, filters: ImageFilters) => {
    const fabricFilters: any[] = [];

    if (filters.brightness && filters.brightness !== 0) {
      fabricFilters.push(new fabric.filters.Brightness({ brightness: filters.brightness }));
    }
    if (filters.contrast && filters.contrast !== 0) {
      fabricFilters.push(new fabric.filters.Contrast({ contrast: filters.contrast }));
    }
    if (filters.saturation && filters.saturation !== 0) {
      fabricFilters.push(new fabric.filters.Saturation({ saturation: filters.saturation }));
    }
    if (filters.blur && filters.blur > 0) {
      fabricFilters.push(new fabric.filters.Blur({ blur: filters.blur }));
    }
    if (filters.grayscale) {
      fabricFilters.push(new fabric.filters.Grayscale());
    }
    if (filters.sepia) {
      fabricFilters.push(new fabric.filters.Sepia());
    }

    img.filters = fabricFilters;
    img.applyFilters();

    (img as any).imageFilters = filters;

    fabricRef.current?.renderAll();
  }, []);

  // ─── Constraints Engine ────────────────────────────────────────

  /** Snapshot of frame dimensions before resize, keyed by frameId. */
  const frameSizeSnapshotRef = useRef<Map<string, { width: number; height: number; left: number; top: number }>>(new Map());

  /**
   * Apply layout constraints to a child object when its parent frame is resized.
   */
  const applyConstraints = useCallback((
    child: fabric.FabricObject,
    parentOld: { left: number; top: number; width: number; height: number },
    parentNew: { left: number; top: number; width: number; height: number },
    constraints: LayoutConstraint,
  ) => {
    const childLeft = child.left || 0;
    const childTop = child.top || 0;
    const childW = (child.width || 0) * (child.scaleX || 1);
    const childH = (child.height || 0) * (child.scaleY || 1);

    const distLeft = childLeft - parentOld.left;
    const distTop = childTop - parentOld.top;
    const distRight = (parentOld.left + parentOld.width) - (childLeft + childW);
    const distBottom = (parentOld.top + parentOld.height) - (childTop + childH);

    let newLeft = childLeft;
    let newTop = childTop;
    let newScaleX = child.scaleX || 1;
    let newScaleY = child.scaleY || 1;

    // ─── Horizontal ─────────────────────────────────────────────
    const hasLeft = constraints.left !== undefined && constraints.left !== false;
    const hasRight = constraints.right !== undefined && constraints.right !== false;
    const hasCenterX = constraints.centerX === true;
    const isLeftScale = constraints.left === "scale";
    const isRightScale = constraints.right === "scale";

    if (hasLeft && hasRight) {
      if (isLeftScale && isRightScale) {
        const ratioX = parentNew.width / parentOld.width;
        newLeft = parentNew.left + distLeft * ratioX;
        newScaleX = (child.scaleX || 1) * ratioX;
      } else {
        const newDistLeft = isLeftScale ? distLeft * (parentNew.width / parentOld.width) : distLeft;
        const newDistRight = isRightScale ? distRight * (parentNew.width / parentOld.width) : distRight;
        newLeft = parentNew.left + newDistLeft;
        const newChildW = parentNew.width - newDistLeft - newDistRight;
        newScaleX = (newChildW / (child.width || 1)) || child.scaleX || 1;
      }
    } else if (hasLeft) {
      newLeft = isLeftScale
        ? parentNew.left + distLeft * (parentNew.width / parentOld.width)
        : parentNew.left + distLeft;
    } else if (hasRight) {
      if (isRightScale) {
        const rightRatio = parentNew.width / parentOld.width;
        newLeft = parentNew.left + parentNew.width - distRight * rightRatio - childW * newScaleX;
      } else {
        newLeft = parentNew.left + parentNew.width - distRight - childW;
      }
    } else if (hasCenterX) {
      const oldCenterOffset = (childLeft + childW / 2) - (parentOld.left + parentOld.width / 2);
      newLeft = parentNew.left + parentNew.width / 2 + oldCenterOffset - childW / 2;
    } else if (parentOld.width !== 0) {
      const ratioX = parentNew.width / parentOld.width;
      newLeft = parentNew.left + distLeft * ratioX;
    }

    // ─── Vertical ───────────────────────────────────────────────
    const hasTop = constraints.top !== undefined && constraints.top !== false;
    const hasBottom = constraints.bottom !== undefined && constraints.bottom !== false;
    const hasCenterY = constraints.centerY === true;
    const isTopScale = constraints.top === "scale";
    const isBottomScale = constraints.bottom === "scale";

    if (hasTop && hasBottom) {
      if (isTopScale && isBottomScale) {
        const ratioY = parentNew.height / parentOld.height;
        newTop = parentNew.top + distTop * ratioY;
        newScaleY = (child.scaleY || 1) * ratioY;
      } else {
        const newDistTop = isTopScale ? distTop * (parentNew.height / parentOld.height) : distTop;
        const newDistBottom = isBottomScale ? distBottom * (parentNew.height / parentOld.height) : distBottom;
        newTop = parentNew.top + newDistTop;
        const newChildH = parentNew.height - newDistTop - newDistBottom;
        newScaleY = (newChildH / (child.height || 1)) || child.scaleY || 1;
      }
    } else if (hasTop) {
      newTop = isTopScale
        ? parentNew.top + distTop * (parentNew.height / parentOld.height)
        : parentNew.top + distTop;
    } else if (hasBottom) {
      if (isBottomScale) {
        const bottomRatio = parentNew.height / parentOld.height;
        newTop = parentNew.top + parentNew.height - distBottom * bottomRatio - childH * newScaleY;
      } else {
        newTop = parentNew.top + parentNew.height - distBottom - childH;
      }
    } else if (hasCenterY) {
      const oldCenterOffsetY = (childTop + childH / 2) - (parentOld.top + parentOld.height / 2);
      newTop = parentNew.top + parentNew.height / 2 + oldCenterOffsetY - childH / 2;
    } else if (parentOld.height !== 0) {
      const ratioY = parentNew.height / parentOld.height;
      newTop = parentNew.top + distTop * ratioY;
    }

    child.set({ left: newLeft, top: newTop, scaleX: newScaleX, scaleY: newScaleY });
    child.setCoords();
  }, []);

  /** Apply constraints to all children of a frame when it is resized. */
  const applyConstraintsToFrame = useCallback((frameId: string, frameObj: fabric.FabricObject) => {
    const c = fabricRef.current;
    if (!c) return;

    const snapshot = frameSizeSnapshotRef.current.get(frameId);
    const newBounds = frameObj.getBoundingRect();
    const parentNew = { left: newBounds.left, top: newBounds.top, width: newBounds.width, height: newBounds.height };

    if (!snapshot) {
      frameSizeSnapshotRef.current.set(frameId, parentNew);
      return;
    }

    if (Math.abs(snapshot.width - parentNew.width) < 0.5 && Math.abs(snapshot.height - parentNew.height) < 0.5) return;

    const children = c.getObjects().filter(
      (o: any) => o.frameId === frameId && !o.isFrameVisual && !o.isFrameLabel
    );

    for (const child of children) {
      const childConstraints: LayoutConstraint | undefined = (child as any).constraints;
      if (childConstraints) {
        applyConstraints(child, snapshot, parentNew, childConstraints);
      }
    }

    frameSizeSnapshotRef.current.set(frameId, parentNew);
    c.renderAll();
  }, [applyConstraints]);

  /** Set constraints on the currently selected object. */
  const setConstraints = useCallback((constraints: LayoutConstraint) => {
    const c = fabricRef.current;
    if (!c) return;
    const obj = c.getActiveObject();
    if (!obj) return;
    (obj as any).constraints = constraints;
    c.renderAll();
  }, []);

  /** Get constraints from the currently selected object. */
  const getConstraints = useCallback((): LayoutConstraint | undefined => {
    const c = fabricRef.current;
    if (!c) return undefined;
    const obj = c.getActiveObject();
    if (!obj) return undefined;
    return (obj as any).constraints;
  }, []);

  // ─── Style Functions ───────────────────────────────────────────

  /** Apply a style to the currently selected object. */
  const applyStyle = useCallback((styleId: string, styles: StyleDefinition[]) => {
    const c = fabricRef.current;
    if (!c) return;
    const obj = c.getActiveObject();
    if (!obj) return;

    const style = styles.find((s) => s.id === styleId);
    if (!style) return;

    if (style.type === "color" && style.fills?.length) {
      const primary = style.fills[0];
      obj.set("fill", primary.color);
      if (primary.opacity !== undefined) obj.set("opacity", primary.opacity);
    }

    if (style.type === "text") {
      const isText = obj.type === "textbox" || obj.type === "i-text";
      if (isText) {
        if (style.fontFamily) obj.set("fontFamily", style.fontFamily);
        if (style.fontSize) obj.set("fontSize", style.fontSize);
        if (style.fontWeight) obj.set("fontWeight", style.fontWeight);
        if (style.lineHeight) obj.set("lineHeight", style.lineHeight);
        if (style.letterSpacing !== undefined) obj.set("charSpacing", style.letterSpacing);
      }
    }

    if (style.type === "effect" && style.effects?.length) {
      const shadowEffect = style.effects.find((e) => e.type === "shadow");
      if (shadowEffect) {
        const shadow = new fabric.Shadow({
          color: shadowEffect.props.color || "rgba(0,0,0,0.3)",
          blur: shadowEffect.props.blur || 0,
          offsetX: shadowEffect.props.offsetX || 0,
          offsetY: shadowEffect.props.offsetY || 0,
        });
        obj.set("shadow", shadow);
      }
    }

    (obj as any).styleId = styleId;

    c.renderAll();
    syncLayers();
  }, [syncLayers]);

  /** Create a new style from the currently selected object's properties. */
  const createStyleFromObject = useCallback((
    name: string,
    type: "color" | "text" | "effect"
  ): StyleDefinition | null => {
    const c = fabricRef.current;
    if (!c) return null;
    const obj = c.getActiveObject();
    if (!obj) return null;

    const now = new Date().toISOString();
    const base: StyleDefinition = {
      id: `style_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      type,
      metadata: { createdAt: now, updatedAt: now },
    };

    if (type === "color") {
      const fill = obj.fill as string;
      if (fill) {
        base.fills = [{ color: fill, opacity: obj.opacity ?? 1 }];
      }
    }

    if (type === "text") {
      const isText = obj.type === "textbox" || obj.type === "i-text";
      if (isText) {
        base.fontFamily = (obj as any).fontFamily;
        base.fontSize = (obj as any).fontSize;
        base.fontWeight = String((obj as any).fontWeight || "normal");
        base.lineHeight = (obj as any).lineHeight;
        base.letterSpacing = (obj as any).charSpacing;
      }
    }

    if (type === "effect") {
      const shadow = obj.shadow as any;
      if (shadow) {
        base.effects = [
          {
            type: "shadow",
            props: {
              color: shadow.color,
              blur: shadow.blur,
              offsetX: shadow.offsetX,
              offsetY: shadow.offsetY,
            },
          },
        ];
      }
    }

    (obj as any).styleId = base.id;

    return base;
  }, []);

  /** Remove the style link from the selected object. */
  const detachStyle = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const obj = c.getActiveObject();
    if (!obj) return;
    delete (obj as any).styleId;
    c.renderAll();
    syncLayers();
  }, [syncLayers]);

  /** Propagate style changes to all objects linked to that style. */
  const propagateStyleUpdate = useCallback((updatedStyle: StyleDefinition) => {
    const c = fabricRef.current;
    if (!c) return;

    for (const obj of c.getObjects()) {
      if ((obj as any).styleId === updatedStyle.id) {
        if (updatedStyle.type === "color" && updatedStyle.fills?.length) {
          const primary = updatedStyle.fills[0];
          obj.set("fill", primary.color);
          if (primary.opacity !== undefined) obj.set("opacity", primary.opacity);
        }

        if (updatedStyle.type === "text") {
          const isText = obj.type === "textbox" || obj.type === "i-text";
          if (isText) {
            if (updatedStyle.fontFamily) obj.set("fontFamily", updatedStyle.fontFamily);
            if (updatedStyle.fontSize) obj.set("fontSize", updatedStyle.fontSize);
            if (updatedStyle.fontWeight) obj.set("fontWeight", updatedStyle.fontWeight);
            if (updatedStyle.lineHeight) obj.set("lineHeight", updatedStyle.lineHeight);
            if (updatedStyle.letterSpacing !== undefined) obj.set("charSpacing", updatedStyle.letterSpacing);
          }
        }

        if (updatedStyle.type === "effect" && updatedStyle.effects?.length) {
          const shadowEffect = updatedStyle.effects.find((e) => e.type === "shadow");
          if (shadowEffect) {
            const shadow = new fabric.Shadow({
              color: shadowEffect.props.color || "rgba(0,0,0,0.3)",
              blur: shadowEffect.props.blur || 0,
              offsetX: shadowEffect.props.offsetX || 0,
              offsetY: shadowEffect.props.offsetY || 0,
            });
            obj.set("shadow", shadow);
          }
        }
      }
    }

    c.renderAll();
    syncLayers();
  }, [syncLayers]);

  // ─── Component System ──────────────────────────────────────────

  /** Create a new ComponentDefinition from the currently selected objects. */
  const createComponent = useCallback((name: string, selectedOnly = true): ComponentDefinition | null => {
    const c = fabricRef.current;
    if (!c) return null;

    let objects: fabric.FabricObject[];
    if (selectedOnly) {
      const active = c.getActiveObject();
      if (!active) return null;
      objects = active.type === "activeselection"
        ? (active as fabric.ActiveSelection).getObjects()
        : [active];
    } else {
      objects = c.getObjects().filter((o: any) => !o.isFrameVisual && !o.isFrameLabel);
    }

    if (objects.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    objects.forEach((obj) => {
      const br = obj.getBoundingRect();
      minX = Math.min(minX, br.left);
      minY = Math.min(minY, br.top);
      maxX = Math.max(maxX, br.left + br.width);
      maxY = Math.max(maxY, br.top + br.height);
    });

    const compWidth = maxX - minX;
    const compHeight = maxY - minY;

    const layers: any[] = objects.map((obj) => {
      const serialized = (obj as any).toObject([
        "layerId", "layerName", "frameId", "isFrameVisual",
        "isClosedPath", "isFrameLabel", "imageFilters",
        "componentId", "isComponentInstance", "styleId",
      ]);
      serialized.x = (obj.left || 0) - minX;
      serialized.y = (obj.top || 0) - minY;
      serialized.width = (obj.width || 0) * (obj.scaleX || 1);
      serialized.height = (obj.height || 0) * (obj.scaleY || 1);
      serialized.rotation = obj.angle || 0;
      serialized.opacity = obj.opacity ?? 1;
      serialized.visible = obj.visible !== false;
      serialized.locked = obj.selectable === false;
      serialized.type = obj.type || "rect";
      serialized.name = (obj as any).layerName || obj.type || "layer";
      serialized.id = (obj as any).layerId || uid("layer");
      return serialized;
    });

    const compId = uid("comp");
    const now = new Date().toISOString();
    const component: ComponentDefinition = {
      id: compId,
      name,
      properties: [],
      defaultValues: {},
      canvas: { width: Math.round(compWidth), height: Math.round(compHeight), background: "transparent" },
      layers,
      metadata: { createdAt: now, updatedAt: now },
    };

    componentsRef.current.set(compId, component);

    objects.forEach((obj) => c.remove(obj));
    instantiateComponent(compId, minX, minY);

    return component;
  }, []);

  /** Place a component instance on the canvas. */
  const instantiateComponent = useCallback((componentId: string, x?: number, y?: number): fabric.Group | null => {
    const c = fabricRef.current;
    if (!c) return null;

    const component = componentsRef.current.get(componentId);
    if (!component) return null;

    const fabricObjects: fabric.FabricObject[] = [];
    component.layers.forEach((layerData) => {
      let obj: fabric.FabricObject | null = null;
      const left = (x ?? 200) + (layerData.x || 0);
      const top = (y ?? 200) + (layerData.y || 0);

      switch (layerData.type) {
        case "rect":
          obj = new fabric.Rect({
            left, top,
            width: layerData.width || 100,
            height: layerData.height || 100,
            fill: layerData.fill || "#6366f1",
            stroke: layerData.stroke,
            strokeWidth: layerData.strokeWidth,
            rx: layerData.cornerRadius,
            ry: layerData.cornerRadius,
            angle: layerData.rotation || 0,
            opacity: layerData.opacity ?? 1,
          });
          break;
        case "ellipse":
          obj = new fabric.Ellipse({
            left, top,
            rx: (layerData.width || 100) / 2,
            ry: (layerData.height || 100) / 2,
            fill: layerData.fill || "#22c55e",
            stroke: layerData.stroke,
            strokeWidth: layerData.strokeWidth,
            angle: layerData.rotation || 0,
            opacity: layerData.opacity ?? 1,
          });
          break;
        case "text":
        case "textbox":
        case "i-text":
          obj = new fabric.Textbox(layerData.text || "Text", {
            left, top,
            width: layerData.width || 200,
            fontSize: layerData.fontSize || 32,
            fill: layerData.fill || "#ffffff",
            fontFamily: layerData.fontFamily || "Inter, sans-serif",
            fontWeight: layerData.fontWeight || "normal",
            textAlign: layerData.align || "left",
            lineHeight: layerData.lineHeight,
            angle: layerData.rotation || 0,
            opacity: layerData.opacity ?? 1,
          });
          break;
        case "image":
          obj = new fabric.Rect({
            left, top,
            width: layerData.width || 100,
            height: layerData.height || 100,
            fill: "#333333",
            stroke: "#6366f1",
            strokeWidth: 1,
            strokeDashArray: [5, 5],
            angle: layerData.rotation || 0,
            opacity: layerData.opacity ?? 1,
          });
          (obj as any).layerName = layerData.name || "image_placeholder";
          break;
        default:
          obj = new fabric.Rect({
            left, top,
            width: layerData.width || 50,
            height: layerData.height || 50,
            fill: "#555555",
            angle: layerData.rotation || 0,
            opacity: layerData.opacity ?? 1,
          });
      }

      if (obj) {
        (obj as any).layerId = layerData.id || uid("layer");
        (obj as any).layerName = layerData.name || layerData.type;
        fabricObjects.push(obj);
      }
    });

    if (fabricObjects.length === 0) return null;

    const group = new fabric.Group(fabricObjects, {
      left: x ?? 200,
      top: y ?? 200,
    });

    const instanceId = uid("inst");
    (group as any).layerId = instanceId;
    (group as any).layerName = `${component.name} instance`;
    (group as any).componentId = componentId;
    (group as any).isComponentInstance = true;

    group.set({
      borderColor: "#a855f7",
      cornerColor: "#a855f7",
      cornerStrokeColor: "#a855f7",
      transparentCorners: false,
      cornerSize: 8,
    });

    instanceRegistryRef.current.set(instanceId, componentId);

    c.add(group);
    c.setActiveObject(group);
    c.renderAll();
    syncLayers();
    debouncedPushState();

    return group;
  }, []);

  /** Detach an instance — break the link to the component definition. */
  const detachInstance = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;

    const active = c.getActiveObject();
    if (!active || !(active as any).isComponentInstance) return;

    const instanceId = (active as any).layerId;
    const group = active as fabric.Group;

    const items = group.getObjects();
    group.removeAll();
    c.remove(group);

    items.forEach((item) => {
      (item as any).componentId = undefined;
      (item as any).isComponentInstance = undefined;
      c.add(item);
    });

    instanceRegistryRef.current.delete(instanceId);

    c.discardActiveObject();
    c.renderAll();
    syncLayers();
    pushUndoState();
  }, []);

  /** Enter component edit mode. */
  const enterComponentEditMode = useCallback((componentId: string) => {
    const component = componentsRef.current.get(componentId);
    if (!component) return;

    const c = fabricRef.current;
    if (!c) return;

    const page = currentPage();
    if (page) {
      const json = (c.toJSON as any)(["layerId", "layerName", "frameId", "isFrameVisual", "isClosedPath", "imageFilters", "componentId", "isComponentInstance", "styleId", "constraints", "isSection", "isSectionBg", "isSectionLabel", "isSectionIndicator", "sectionId", "sectionColor"]);
      page.objectsJSON = json.objects || [];
    }

    c.getObjects().forEach((o) => c.remove(o));

    component.layers.forEach((layerData) => {
      let obj: fabric.FabricObject | null = null;
      switch (layerData.type) {
        case "rect":
          obj = new fabric.Rect({
            left: layerData.x, top: layerData.y,
            width: layerData.width, height: layerData.height,
            fill: layerData.fill || "#6366f1",
            stroke: layerData.stroke,
            strokeWidth: layerData.strokeWidth,
            rx: layerData.cornerRadius, ry: layerData.cornerRadius,
            angle: layerData.rotation || 0,
            opacity: layerData.opacity ?? 1,
          });
          break;
        case "ellipse":
          obj = new fabric.Ellipse({
            left: layerData.x, top: layerData.y,
            rx: (layerData.width || 100) / 2, ry: (layerData.height || 100) / 2,
            fill: layerData.fill || "#22c55e",
            angle: layerData.rotation || 0,
            opacity: layerData.opacity ?? 1,
          });
          break;
        case "text":
        case "textbox":
        case "i-text":
          obj = new fabric.Textbox(layerData.text || "Text", {
            left: layerData.x, top: layerData.y,
            width: layerData.width || 200,
            fontSize: layerData.fontSize || 32,
            fill: layerData.fill || "#ffffff",
            fontFamily: layerData.fontFamily || "Inter, sans-serif",
            angle: layerData.rotation || 0,
            opacity: layerData.opacity ?? 1,
          });
          break;
      }
      if (obj) {
        (obj as any).layerId = layerData.id;
        (obj as any).layerName = layerData.name;
        (obj as any).isComponentEdit = true;
        c.add(obj);
      }
    });

    c.renderAll();
    syncLayers();
  }, []);

  /** Save edits made in component edit mode back to the component definition. */
  const saveComponentEdits = useCallback((componentId: string) => {
    const c = fabricRef.current;
    if (!c) return;

    const component = componentsRef.current.get(componentId);
    if (!component) return;

    const layers: any[] = c.getObjects()
      .filter((o: any) => o.isComponentEdit)
      .map((obj) => {
        const serialized = (obj as any).toObject([
          "layerId", "layerName", "frameId", "isFrameVisual",
          "isClosedPath", "isFrameLabel", "imageFilters",
          "componentId", "isComponentInstance", "isComponentEdit", "styleId",
        ]);
        serialized.x = obj.left || 0;
        serialized.y = obj.top || 0;
        serialized.width = (obj.width || 0) * (obj.scaleX || 1);
        serialized.height = (obj.height || 0) * (obj.scaleY || 1);
        serialized.rotation = obj.angle || 0;
        serialized.opacity = obj.opacity ?? 1;
        serialized.visible = obj.visible !== false;
        serialized.locked = obj.selectable === false;
        serialized.type = obj.type || "rect";
        serialized.name = (obj as any).layerName || obj.type || "layer";
        serialized.id = (obj as any).layerId || uid("layer");
        return serialized;
      });

    component.layers = layers;
    component.metadata.updatedAt = new Date().toISOString();

    let maxX = 0, maxY = 0;
    layers.forEach((l) => {
      maxX = Math.max(maxX, (l.x || 0) + (l.width || 0));
      maxY = Math.max(maxY, (l.y || 0) + (l.height || 0));
    });
    component.canvas.width = Math.round(maxX);
    component.canvas.height = Math.round(maxY);
  }, []);

  /** Update a property override on the selected instance. */
  const setInstanceOverride = useCallback((instanceId: string, propertyId: string, value: any) => {
    const c = fabricRef.current;
    if (!c) return;

    const obj = c.getObjects().find((o: any) => o.layerId === instanceId);
    if (!obj || !(obj as any).isComponentInstance) return;

    if (!(obj as any).overrides) (obj as any).overrides = {};
    (obj as any).overrides[propertyId] = value;

    pushUndoState();
  }, []);

  /** Get all saved components. */
  const getComponents = useCallback((): ComponentDefinition[] => {
    return Array.from(componentsRef.current.values());
  }, []);

  /** Get a single component by id. */
  const getComponent = useCallback((id: string): ComponentDefinition | undefined => {
    return componentsRef.current.get(id);
  }, []);

  /** Delete a component definition. */
  const deleteComponent = useCallback((id: string) => {
    componentsRef.current.delete(id);
  }, []);

  /** Get the component definition for a given instance. */
  const getInstanceComponent = useCallback((fabricObject: fabric.FabricObject): ComponentDefinition | null => {
    const componentId = (fabricObject as any).componentId;
    if (!componentId) return null;
    return componentsRef.current.get(componentId) || null;
  }, []);

  // ─── Comments ──────────────────────────────────────────────────

  /** Toggle comment placement mode. */
  const setCommentMode = useCallback((active: boolean) => {
    commentModeRef.current = active;
    const c = fabricRef.current;
    if (!c) return;
    c.defaultCursor = active ? "crosshair" : "default";
    c.selection = !active;
  }, []);

  /** Add a new comment at canvas coordinates. */
  const addComment = useCallback(
    (x: number, y: number, text: string, author: string, templateId: string) => {
      const comment: Comment = {
        id: `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        templateId,
        x,
        y,
        author,
        text,
        thread: [],
        resolved: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      commentsRef.current = [...commentsRef.current, comment];
      opts.onCommentsChange?.(commentsRef.current);
      return comment;
    },
    [],
  );

  /** Add a reply to an existing comment thread. */
  const addReply = useCallback(
    (commentId: string, text: string, author: string) => {
      const comment = commentsRef.current.find((c) => c.id === commentId);
      if (!comment) return;
      const reply: CommentReply = {
        id: `rpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        author,
        text,
        createdAt: new Date().toISOString(),
      };
      comment.thread.push(reply);
      comment.updatedAt = new Date().toISOString();
      commentsRef.current = [...commentsRef.current];
      opts.onCommentsChange?.(commentsRef.current);
    },
    [],
  );

  /** Mark a comment as resolved. */
  const resolveComment = useCallback((commentId: string) => {
    const comment = commentsRef.current.find((c) => c.id === commentId);
    if (!comment) return;
    comment.resolved = true;
    comment.updatedAt = new Date().toISOString();
    commentsRef.current = [...commentsRef.current];
    opts.onCommentsChange?.(commentsRef.current);
  }, []);

  /** Reopen a resolved comment. */
  const reopenComment = useCallback((commentId: string) => {
    const comment = commentsRef.current.find((c) => c.id === commentId);
    if (!comment) return;
    comment.resolved = false;
    comment.updatedAt = new Date().toISOString();
    commentsRef.current = [...commentsRef.current];
    opts.onCommentsChange?.(commentsRef.current);
  }, []);

  /** Delete a comment and its thread. */
  const deleteComment = useCallback((commentId: string) => {
    commentsRef.current = commentsRef.current.filter((c) => c.id !== commentId);
    if (activeCommentIdRef.current === commentId) {
      activeCommentIdRef.current = null;
    }
    opts.onCommentsChange?.(commentsRef.current);
  }, []);

  /** Set the active (selected) comment. */
  const setActiveComment = useCallback((commentId: string | null) => {
    activeCommentIdRef.current = commentId;
  }, []);

  /** Load comments from API. */
  const loadComments = useCallback(async (templateId: string) => {
    try {
      const res = await fetch(`/api/comments?templateId=${templateId}`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        commentsRef.current = json.data;
        opts.onCommentsChange?.(commentsRef.current);
      }
    } catch (e) {
      console.error("[Comments] Failed to load:", e);
    }
  }, []);

  /** Sync a comment to the server. */
  const syncComment = useCallback(async (comment: Comment) => {
    try {
      await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(comment),
      });
    } catch (e) {
      console.error("[Comments] Failed to sync:", e);
    }
  }, []);

  // ─── Version History ───────────────────────────────────────────

  /** Create a version snapshot. */
  const createVersion = useCallback(
    async (templateId: string, message?: string, author?: string) => {
      const c = fabricRef.current;
      if (!c) return;

      const json = (c.toJSON as any)([
        "layerId", "layerName", "frameId", "isFrameVisual",
        "isClosedPath", "imageFilters", "styleId",
        "isSection", "isSectionBg", "isSectionLabel", "isSectionIndicator", "sectionId", "sectionColor",
      ]);

      const dataStr = JSON.stringify(json);
      if (dataStr === lastVersionDataRef.current) return;
      lastVersionDataRef.current = dataStr;

      const versionNumber =
        versionsRef.current.length > 0
          ? Math.max(...versionsRef.current.map((v) => v.versionNumber)) + 1
          : 1;

      const version: TemplateVersion = {
        id: `ver_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        templateId,
        versionNumber,
        data: json as any,
        author,
        message,
        createdAt: new Date().toISOString(),
      };

      versionsRef.current = [version, ...versionsRef.current];

      if (versionsRef.current.length > 50) {
        versionsRef.current = versionsRef.current.slice(0, 50);
      }

      try {
        await fetch(`/api/templates/${templateId}/versions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(version),
        });
      } catch (e) {
        console.error("[Versions] Failed to sync:", e);
        addToast("warning", "Version not saved", "Could not sync version snapshot to server");
      }

      opts.onVersionsChange?.(versionsRef.current);
      return version;
    },
    [],
  );

  /** Debounced auto-version. */
  const debouncedAutoVersion = useCallback(
    (templateId: string, author?: string) => {
      if (versionTimerRef.current) clearTimeout(versionTimerRef.current);
      versionTimerRef.current = setTimeout(() => {
        createVersion(templateId, undefined, author);
        versionTimerRef.current = null;
      }, 5000);
    },
    [createVersion],
  );

  /** Load version history from API. */
  const loadVersions = useCallback(async (templateId: string) => {
    versionsLoadingRef.current = true;
    try {
      const res = await fetch(`/api/templates/${templateId}/versions`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        versionsRef.current = json.data;
        opts.onVersionsChange?.(versionsRef.current);
      }
    } catch (e) {
      console.error("[Versions] Failed to load:", e);
      addToast("error", "Failed to load version history", (e as Error).message);
    } finally {
      versionsLoadingRef.current = false;
      opts.onVersionsChange?.(versionsRef.current);
    }
  }, []);

  /** Restore the canvas to a specific version. */
  const restoreVersion = useCallback(
    async (versionId: string, templateId: string) => {
      try {
        const res = await fetch(
          `/api/templates/${templateId}/versions/${versionId}/restore`,
          { method: "POST" },
        );
        const json = await res.json();
        if (json.success && json.data) {
          restoreState(JSON.stringify(json.data));
        }
      } catch (e) {
        console.error("[Versions] Failed to restore:", e);
        addToast("error", "Failed to restore version", "Could not load the selected version snapshot");
      }
    },
    [restoreState],
  );

  // ─── Sections Engine ─────────────────────────────────────────

  /** Create a section visual on the canvas. */
  const createSection = useCallback((name: string, x = 100, y = 100, width = 600, height = 400, color = "#6366f1") => {
    const c = fabricRef.current; if (!c) return null;
    const sid = uid("section");

    // Semi-transparent background rect
    const bg = new fabric.Rect({
      left: x, top: y, width, height,
      fill: color + "18",
      stroke: color,
      strokeWidth: 2,
      strokeDashArray: [8, 4],
      rx: 8, ry: 8,
      selectable: true,
      evented: true,
      hasControls: true,
    });
    (bg as any).layerId = sid;
    (bg as any).layerName = name;
    (bg as any).isSection = true;
    (bg as any).isSectionBg = true;
    (bg as any).sectionColor = color;
    c.add(bg);

    // Section label at top
    const label = new fabric.Textbox(name, {
      left: x + 8, top: y - 24,
      fontSize: 14, fill: color,
      fontFamily: "Inter, sans-serif",
      fontWeight: "600",
      selectable: false,
      evented: true,
      hoverCursor: "pointer",
      width: 300,
    });
    (label as any).layerId = uid();
    (label as any).layerName = name;
    (label as any).isSection = true;
    (label as any).isSectionLabel = true;
    (label as any).sectionId = sid;
    c.add(label);

    // Collapse indicator
    const indicator = new fabric.Text("●", {
      left: x - 16, top: y - 24,
      fontSize: 10, fill: color,
      selectable: false,
      evented: false,
    });
    (indicator as any).layerId = uid();
    (indicator as any).isSection = true;
    (indicator as any).isSectionIndicator = true;
    (indicator as any).sectionId = sid;
    c.add(indicator);

    // Click label to select section bg
    label.on("mousedown", () => {
      const sectionBg = c.getObjects().find((o: any) => o.isSectionBg && (o as any).layerId === sid);
      if (sectionBg) { c.setActiveObject(sectionBg); c.renderAll(); }
    });

    // Move sync
    bg.on("moving", () => {
      label.set({ left: (bg.left || 0) + 8, top: (bg.top || 0) - 24 });
      indicator.set({ left: (bg.left || 0) - 16, top: (bg.top || 0) - 24 });
      c.renderAll();
    });
    bg.on("modified", () => {
      label.set({ left: (bg.left || 0) + 8, top: (bg.top || 0) - 24 });
      indicator.set({ left: (bg.left || 0) - 16, top: (bg.top || 0) - 24 });
      c.renderAll();
      syncLayers();
    });

    const section: SectionInfo = { id: sid, name, color, collapsed: false, objectIds: [] };
    sectionsRef.current = [...sectionsRef.current, section];
    syncLayers();
    return section;
  }, []);

  /** Toggle collapse/expand of a section. */
  const toggleSectionCollapse = useCallback((sectionId: string) => {
    const c = fabricRef.current; if (!c) return;
    const section = sectionsRef.current.find(s => s.id === sectionId);
    if (!section) return;
    section.collapsed = !section.collapsed;
    const collapsed = section.collapsed;

    // Hide/show children assigned to this section
    for (const obj of c.getObjects()) {
      if ((obj as any).sectionId === sectionId) {
        obj.set("visible", !collapsed);
      }
    }

    // Update visual indicator
    c.getObjects().forEach((o: any) => {
      if (o.isSectionIndicator && o.sectionId === sectionId) {
        o.set("text", collapsed ? "▶" : "●");
      }
    });

    sectionsRef.current = [...sectionsRef.current];
    c.renderAll();
    syncLayers();
  }, []);

  /** Assign a layer to a section. */
  const assignToSection = useCallback((layerId: string, sectionId: string) => {
    const c = fabricRef.current; if (!c) return;
    const obj = c.getObjects().find((o: any) => o.layerId === layerId);
    if (!obj) return;
    (obj as any).sectionId = sectionId;
    syncLayers();
  }, []);

  /** Remove a layer from its section. */
  const removeFromSection = useCallback((layerId: string) => {
    const c = fabricRef.current; if (!c) return;
    const obj = c.getObjects().find((o: any) => o.layerId === layerId);
    if (!obj) return;
    delete (obj as any).sectionId;
    syncLayers();
  }, []);

  /** Rename a section. */
  const renameSection = useCallback((sectionId: string, newName: string) => {
    const c = fabricRef.current; if (!c) return;
    const section = sectionsRef.current.find(s => s.id === sectionId);
    if (!section) return;
    section.name = newName;
    // Update label
    c.getObjects().forEach((o: any) => {
      if (o.isSectionLabel && o.sectionId === sectionId) {
        o.set("text", newName);
      }
    });
    sectionsRef.current = [...sectionsRef.current];
    c.renderAll();
    syncLayers();
  }, []);

  /** Change section color. */
  const setSectionColor = useCallback((sectionId: string, color: string) => {
    const c = fabricRef.current; if (!c) return;
    const section = sectionsRef.current.find(s => s.id === sectionId);
    if (!section) return;
    section.color = color;
    c.getObjects().forEach((o: any) => {
      if (o.isSectionBg && o.layerId === sectionId) {
        o.set({ fill: color + "18", stroke: color });
        (o as any).sectionColor = color;
      }
      if (o.isSectionLabel && o.sectionId === sectionId) {
        o.set("fill", color);
      }
      if (o.isSectionIndicator && o.sectionId === sectionId) {
        o.set("fill", color);
      }
    });
    sectionsRef.current = [...sectionsRef.current];
    c.renderAll();
  }, []);

  /** Delete a section (not its children). */
  const deleteSection = useCallback((sectionId: string) => {
    const c = fabricRef.current; if (!c) return;
    // Remove section visuals
    c.getObjects().filter((o: any) =>
      (o.isSectionBg && o.layerId === sectionId) ||
      (o.isSectionLabel && o.sectionId === sectionId) ||
      (o.isSectionIndicator && o.sectionId === sectionId)
    ).forEach(o => c.remove(o));
    // Unassign children
    c.getObjects().forEach((o: any) => {
      if (o.sectionId === sectionId) delete o.sectionId;
    });
    sectionsRef.current = sectionsRef.current.filter(s => s.id !== sectionId);
    syncLayers();
  }, []);

  /** Get all sections. */
  const getSections = useCallback((): SectionInfo[] => sectionsRef.current, []);

  // ─── Variables / Design Tokens Engine ────────────────────────

  /** Resolve a variable's value for the currently active mode, following alias chains. */
  const resolveVariableValue = useCallback((variable: Variable, depth = 0): string | number | boolean | null => {
    if (depth > 10) return null; // prevent infinite alias loops
    const activeMode = activeModeRef.current[variable.collectionId];
    const val = variable.values[activeMode] ?? Object.values(variable.values)[0];
    if (val === undefined || val === null) return null;
    if (variable.aliasOf) {
      const aliased = variablesRef.current.find(v => v.id === variable.aliasOf);
      if (aliased) return resolveVariableValue(aliased, depth + 1);
    }
    return val;
  }, []);

  /** Get resolved value for a variable by id. */
  const getVariableValue = useCallback((variableId: string): string | number | boolean | null => {
    const v = variablesRef.current.find(vr => vr.id === variableId);
    if (!v) return null;
    return resolveVariableValue(v);
  }, [resolveVariableValue]);

  /** Create a new variable collection. */
  const createCollection = useCallback((name: string, modes: string[] = ["Default"]): VariableCollection => {
    const now = new Date().toISOString();
    const col: VariableCollection = {
      id: `col_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      modes,
      defaultMode: modes[0],
      createdAt: now,
      updatedAt: now,
    };
    collectionsRef.current = [...collectionsRef.current, col];
    activeModeRef.current[col.id] = col.defaultMode;
    return col;
  }, []);

  /** Update a collection. */
  const updateCollection = useCallback((id: string, updates: Partial<Omit<VariableCollection, "id" | "createdAt">>) => {
    collectionsRef.current = collectionsRef.current.map(c =>
      c.id === id ? { ...c, ...updates, updatedAt: new Date().toISOString() } : c
    );
  }, []);

  /** Delete a collection and all its variables. */
  const deleteCollection = useCallback((id: string) => {
    collectionsRef.current = collectionsRef.current.filter(c => c.id !== id);
    variablesRef.current = variablesRef.current.filter(v => v.collectionId !== id);
    delete activeModeRef.current[id];
    for (const [varId] of variableBindingsRef.current) {
      if (!variablesRef.current.find(v => v.id === varId)) {
        variableBindingsRef.current.delete(varId);
      }
    }
  }, []);

  /** Create a new variable. */
  const createVariable = useCallback((
    name: string,
    type: VariableType,
    collectionId: string,
    initialValue?: string | number | boolean,
    scopes?: VariableScope[],
  ): Variable => {
    const collection = collectionsRef.current.find(c => c.id === collectionId);
    if (!collection) throw new Error(`Collection ${collectionId} not found`);
    const now = new Date().toISOString();
    const values: Record<string, string | number | boolean> = {};
    for (const mode of collection.modes) {
      values[mode] = initialValue ?? (type === "color" ? "#6366f1" : type === "number" ? 0 : type === "boolean" ? false : "");
    }
    const v: Variable = {
      id: `var_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      type,
      values,
      collectionId,
      scopes,
      createdAt: now,
      updatedAt: now,
    };
    variablesRef.current = [...variablesRef.current, v];
    return v;
  }, []);

  /** Update a variable. */
  const updateVariable = useCallback((id: string, updates: Partial<Omit<Variable, "id" | "createdAt">>) => {
    variablesRef.current = variablesRef.current.map(v =>
      v.id === id ? { ...v, ...updates, updatedAt: new Date().toISOString() } : v
    );
    if (updates.values || updates.aliasOf) {
      propagateVariableToCanvas(id);
    }
  }, []);

  /** Delete a variable. */
  const deleteVariable = useCallback((id: string) => {
    variablesRef.current = variablesRef.current.filter(v => v.id !== id);
    variableBindingsRef.current.delete(id);
  }, []);

  /** Set the active mode for a collection. */
  const setActiveMode = useCallback((collectionId: string, modeId: string) => {
    activeModeRef.current[collectionId] = modeId;
    const colVars = variablesRef.current.filter(v => v.collectionId === collectionId);
    for (const v of colVars) propagateVariableToCanvas(v.id);
  }, []);

  /** Bind a variable to a layer property. */
  const bindVariableToProperty = useCallback((variableId: string, layerId: string, property: string) => {
    const bindings = variableBindingsRef.current.get(variableId) || [];
    if (!bindings.find(b => b.layerId === layerId && b.property === property)) {
      bindings.push({ layerId, property });
      variableBindingsRef.current.set(variableId, bindings);
    }
    applyVariableToObject(variableId, layerId, property);
  }, []);

  /** Unbind a variable from a layer property. */
  const unbindVariableFromProperty = useCallback((variableId: string, layerId: string, property: string) => {
    const bindings = variableBindingsRef.current.get(variableId) || [];
    variableBindingsRef.current.set(
      variableId,
      bindings.filter(b => !(b.layerId === layerId && b.property === property))
    );
  }, []);

  /** Get which variable is bound to a specific layer+property. */
  const getBoundVariable = useCallback((layerId: string, property: string): Variable | null => {
    for (const [varId, bindings] of variableBindingsRef.current) {
      if (bindings.find(b => b.layerId === layerId && b.property === property)) {
        return variablesRef.current.find(v => v.id === varId) || null;
      }
    }
    return null;
  }, []);

  /** Apply a variable's resolved value to a fabric object property. */
  const applyVariableToObject = useCallback((variableId: string, layerId: string, property: string) => {
    const c = fabricRef.current;
    if (!c) return;
    const obj = c.getObjects().find((o: any) => o.layerId === layerId);
    if (!obj) return;
    const val = getVariableValue(variableId);
    if (val === null || val === undefined) return;
    obj.set(property, val);
    c.renderAll();
  }, [getVariableValue]);

  /** Propagate a variable to all its bound canvas objects. */
  const propagateVariableToCanvas = useCallback((variableId: string) => {
    const bindings = variableBindingsRef.current.get(variableId);
    if (!bindings) return;
    for (const { layerId, property } of bindings) {
      applyVariableToObject(variableId, layerId, property);
    }
  }, [applyVariableToObject]);

  /** Propagate ALL variables to canvas (e.g., after mode switch). */
  const propagateAllVariables = useCallback(() => {
    for (const [varId] of variableBindingsRef.current) {
      propagateVariableToCanvas(varId);
    }
  }, [propagateVariableToCanvas]);

  const getVariables = useCallback((): Variable[] => variablesRef.current, []);
  const getCollections = useCallback((): VariableCollection[] => collectionsRef.current, []);
  const getActiveMode = useCallback((collectionId: string): string => {
    return activeModeRef.current[collectionId] || collectionsRef.current.find(c => c.id === collectionId)?.defaultMode || "Default";
  }, []);

  /** Load variables from API. */
  const loadVariables = useCallback(async (templateId: string) => {
    try {
      const res = await fetch(`/api/variables?templateId=${templateId}`);
      const json = await res.json();
      if (json.success) {
        if (json.data?.collections) collectionsRef.current = json.data.collections;
        if (json.data?.variables) variablesRef.current = json.data.variables;
        if (json.data?.bindings) {
          variableBindingsRef.current = new Map(Object.entries(json.data.bindings));
        }
        for (const col of collectionsRef.current) {
          if (!activeModeRef.current[col.id]) activeModeRef.current[col.id] = col.defaultMode;
        }
        propagateAllVariables();
      }
    } catch (e) {
      console.error("[Variables] Failed to load:", e);
    }
  }, [propagateAllVariables]);

  /** Save variables to API. */
  const saveVariables = useCallback(async (templateId: string) => {
    try {
      const bindingsObj: Record<string, Array<{ layerId: string; property: string }>> = {};
      for (const [varId, bindings] of variableBindingsRef.current) {
        bindingsObj[varId] = bindings;
      }
      await fetch("/api/variables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId,
          collections: collectionsRef.current,
          variables: variablesRef.current,
          bindings: bindingsObj,
        }),
      });
    } catch (e) {
      console.error("[Variables] Failed to save:", e);
    }
  }, []);

  // ─── Alignment ─────────────────────────────────────────────────
  type AlignDirection = "left" | "center-h" | "right" | "top" | "center-v" | "bottom";

  const alignObjects = useCallback((direction: AlignDirection) => {
    const c = fabricRef.current;
    if (!c) return;

    const activeObj = c.getActiveObject();
    if (!activeObj || activeObj.type !== "activeselection") return;

    const selection = activeObj as fabric.ActiveSelection;
    const objects = selection.getObjects();
    if (objects.length < 2) return;

    const selBounds = selection.getBoundingRect();

    objects.forEach((obj) => {
      const objBounds = obj.getBoundingRect();
      let dx = 0;
      let dy = 0;

      switch (direction) {
        case "left":
          dx = selBounds.left - objBounds.left;
          break;
        case "center-h":
          dx = selBounds.left + selBounds.width / 2 - (objBounds.left + objBounds.width / 2);
          break;
        case "right":
          dx = selBounds.left + selBounds.width - (objBounds.left + objBounds.width);
          break;
        case "top":
          dy = selBounds.top - objBounds.top;
          break;
        case "center-v":
          dy = selBounds.top + selBounds.height / 2 - (objBounds.top + objBounds.height / 2);
          break;
        case "bottom":
          dy = selBounds.top + selBounds.height - (objBounds.top + objBounds.height);
          break;
      }

      obj.set({
        left: (obj.left || 0) + dx,
        top: (obj.top || 0) + dy,
      });
      obj.setCoords();
    });

    c.renderAll();
  }, []);

  // ─── Distribution ──────────────────────────────────────────────
  const distributeObjects = useCallback(
    (direction: "horizontal" | "vertical") => {
      const c = fabricRef.current;
      if (!c) return;

      const activeObj = c.getActiveObject();
      if (!activeObj || activeObj.type !== "activeselection") return;

      const selection = activeObj as fabric.ActiveSelection;
      const objects = selection.getObjects();
      if (objects.length < 3) return;

      const items = objects.map((obj) => ({
        obj,
        rect: obj.getBoundingRect(),
      }));

      if (direction === "horizontal") {
        items.sort((a, b) => a.rect.left - b.rect.left);

        const first = items[0].rect;
        const last = items[items.length - 1].rect;
        const totalSpan = last.left + last.width - first.left;
        const totalObjWidth = items.reduce((s, it) => s + it.rect.width, 0);
        const gap = (totalSpan - totalObjWidth) / (items.length - 1);

        let cursor = first.left;
        items.forEach((it, i) => {
          if (i === 0) {
            cursor += it.rect.width + gap;
            return;
          }
          const dx = cursor - it.rect.left;
          it.obj.set({ left: (it.obj.left || 0) + dx });
          it.obj.setCoords();
          cursor += it.rect.width + gap;
        });
      } else {
        items.sort((a, b) => a.rect.top - b.rect.top);

        const first = items[0].rect;
        const last = items[items.length - 1].rect;
        const totalSpan = last.top + last.height - first.top;
        const totalObjHeight = items.reduce((s, it) => s + it.rect.height, 0);
        const gap = (totalSpan - totalObjHeight) / (items.length - 1);

        let cursor = first.top;
        items.forEach((it, i) => {
          if (i === 0) {
            cursor += it.rect.height + gap;
            return;
          }
          const dy = cursor - it.rect.top;
          it.obj.set({ top: (it.obj.top || 0) + dy });
          it.obj.setCoords();
          cursor += it.rect.height + gap;
        });
      }

      c.renderAll();
    },
    [],
  );


  // ─── Auto Layout Engine ─────────────────────────────────────────

  /** Apply auto layout to a group/frame: repositions children based on config. */
  const applyAutoLayout = useCallback((parentObj: fabric.FabricObject) => {
    const c = fabricRef.current;
    if (!c) return;

    const config: AutoLayoutConfig | undefined = (parentObj as any).autoLayout;
    if (!config || !config.enabled) return;

    // Get children
    let children: fabric.FabricObject[];
    if (parentObj.type === "group") {
      children = (parentObj as fabric.Group).getObjects().slice();
    } else if ((parentObj as any).isFrameBg) {
      const frameId = (parentObj as any).frameId;
      children = c.getObjects().filter(
        (o: any) => o.frameId === frameId && !o.isFrameVisual && !o.isFrameLabel
      );
    } else {
      return;
    }
    if (children.length === 0) return;

    // Sort by current position to maintain order
    if (config.direction === "horizontal") {
      children.sort((a, b) => (a.left || 0) - (b.left || 0));
    } else {
      children.sort((a, b) => (a.top || 0) - (b.top || 0));
    }

    const pad = config.padding;
    const isH = config.direction === "horizontal";

    const parentLeft = parentObj.left || 0;
    const parentTop = parentObj.top || 0;
    const parentW = (parentObj.width || 0) * (parentObj.scaleX || 1);
    const parentH = (parentObj.height || 0) * (parentObj.scaleY || 1);

    const contentLeft = parentLeft + pad.left;
    const contentTop = parentTop + pad.top;
    const contentW = parentW - pad.left - pad.right;
    const contentH = parentH - pad.top - pad.bottom;

    // Measure children
    interface CI { obj: fabric.FabricObject; w: number; h: number; mode: ResizingMode; }
    const infos: CI[] = children.map((obj) => ({
      obj,
      w: (obj.width || 0) * (obj.scaleX || 1),
      h: (obj.height || 0) * (obj.scaleY || 1),
      mode: ((obj as any).resizingMode || "fixed") as ResizingMode,
    }));

    // Wrap: split into lines
    const lines: CI[][] = [];
    const gapVal = typeof config.gap === "number" ? config.gap : 0;
    const isAutoGap = config.gap === "auto";

    if (config.wrap) {
      let curLine: CI[] = [];
      let curSize = 0;
      const maxCross = isH ? contentW : contentH;

      for (const info of infos) {
        const itemMain = isH ? (info.mode === "fill" ? 0 : info.w) : (info.mode === "fill" ? 0 : info.h);
        const next = curSize + (curLine.length > 0 ? gapVal : 0) + itemMain;
        if (curLine.length > 0 && next > maxCross) {
          lines.push(curLine);
          curLine = [info];
          curSize = itemMain;
        } else {
          curLine.push(info);
          curSize = next;
        }
      }
      if (curLine.length > 0) lines.push(curLine);
    } else {
      lines.push(infos);
    }

    let crossOffset = 0;
    let totalMain = 0;
    let totalCross = 0;

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const fillItems = line.filter(i => i.mode === "fill");
      const fixedItems = line.filter(i => i.mode !== "fill");

      // Compute fill size
      const fixedTotal = isH
        ? fixedItems.reduce((s, i) => s + i.w, 0)
        : fixedItems.reduce((s, i) => s + i.h, 0);
      const gaps = isAutoGap ? 0 : gapVal * (line.length - 1);
      const available = (isH ? contentW : contentH) - fixedTotal - gaps;
      const fillSize = fillItems.length > 0 ? available / fillItems.length : 0;

      // Auto gap
      const effectiveGap = isAutoGap && line.length > 1
        ? ((isH ? contentW : contentH) - fixedTotal) / (line.length - 1)
        : gapVal;

      // Line cross-axis size
      let lineCross = 0;
      for (const info of line) {
        const c2 = isH
          ? (info.mode === "fill" ? contentH : info.h)
          : (info.mode === "fill" ? contentW : info.w);
        if (c2 > lineCross) lineCross = c2;
      }

      // Position each child
      let mainCursor = isH ? contentLeft : contentTop;

      for (const info of line) {
        const mainSize = isH
          ? (info.mode === "fill" ? fillSize : info.w)
          : (info.mode === "fill" ? fillSize : info.h);
        let crossSize = isH ? info.h : info.w;
        let crossPos = isH ? contentTop + crossOffset : contentLeft + crossOffset;

        // Cross-axis alignment
        switch (config.alignItems) {
          case "center":
            crossPos += (lineCross - crossSize) / 2;
            break;
          case "end":
            crossPos += lineCross - crossSize;
            break;
          case "stretch":
            crossSize = lineCross;
            break;
        }

        const newLeft = isH ? mainCursor : crossPos;
        const newTop = isH ? crossPos : mainCursor;

        info.obj.set({ left: newLeft, top: newTop });
        info.obj.setCoords();

        // Apply fill resizing
        if (info.mode === "fill") {
          const origW = info.obj.width || 1;
          const origH = info.obj.height || 1;
          if (isH) {
            info.obj.set({
              scaleX: mainSize / origW,
              scaleY: crossSize / origH,
            });
          } else {
            info.obj.set({
              scaleX: crossSize / origW,
              scaleY: mainSize / origH,
            });
          }
          info.obj.setCoords();
        }

        mainCursor += mainSize + effectiveGap;

        // Recurse into nested auto layout
        if ((info.obj as any).autoLayout?.enabled) {
          applyAutoLayout(info.obj);
        }
      }

      crossOffset += lineCross + (li < lines.length - 1 ? gapVal : 0);
      if (isH) {
        const lineMain = mainCursor - contentLeft;
        totalMain = Math.max(totalMain, lineMain);
      } else {
        const lineMain = mainCursor - contentTop;
        totalMain = Math.max(totalMain, lineMain);
      }
    }
    totalCross = crossOffset;

    // Hug mode: resize parent
    const parentMode: ResizingMode = (parentObj as any).resizingMode || "hug";
    if (parentMode === "hug") {
      const newW = (isH ? totalMain : totalCross) + pad.left + pad.right;
      const newH = (isH ? totalCross : totalMain) + pad.top + pad.bottom;
      parentObj.set({
        scaleX: newW / (parentObj.width || 1),
        scaleY: newH / (parentObj.height || 1),
      });
      parentObj.setCoords();
    }

    c.renderAll();
  }, []);

  /** Toggle auto layout on/off for the selected object. */
  const toggleAutoLayout = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const active = c.getActiveObject();
    if (!active) return;

    const cur: AutoLayoutConfig | undefined = (active as any).autoLayout;
    if (cur?.enabled) {
      (active as any).autoLayout = { ...cur, enabled: false };
    } else {
      (active as any).autoLayout = {
        enabled: true,
        direction: "horizontal",
        padding: { top: 10, right: 10, bottom: 10, left: 10 },
        gap: 10,
        alignItems: "start",
        wrap: false,
      };
      applyAutoLayout(active);
    }
    c.renderAll();
    syncLayers();
    pushUndoState();
  }, [applyAutoLayout, syncLayers, pushUndoState]);

  /** Update auto layout properties on the selected object. */
  const updateAutoLayout = useCallback((updates: Partial<AutoLayoutConfig>) => {
    const c = fabricRef.current;
    if (!c) return;
    const active = c.getActiveObject();
    if (!active) return;

    const cur: AutoLayoutConfig = (active as any).autoLayout || {
      enabled: true, direction: "horizontal",
      padding: { top: 10, right: 10, bottom: 10, left: 10 },
      gap: 10, alignItems: "start", wrap: false,
    };
    (active as any).autoLayout = { ...cur, ...updates };
    if ((active as any).autoLayout.enabled) applyAutoLayout(active);
    c.renderAll();
    syncLayers();
    pushUndoState();
  }, [applyAutoLayout, syncLayers, pushUndoState]);

  /** Update resizing mode on a child and re-layout parent. */
  const updateResizingMode = useCallback((obj: fabric.FabricObject, mode: ResizingMode) => {
    (obj as any).resizingMode = mode;
    const c = fabricRef.current;
    if (!c) return;
    for (const parent of c.getObjects()) {
      if (parent.type === "group") {
        const gc = (parent as fabric.Group).getObjects();
        if (gc.includes(obj) && (parent as any).autoLayout?.enabled) {
          applyAutoLayout(parent);
          break;
        }
      }
    }
    c.renderAll();
    syncLayers();
    pushUndoState();
  }, [applyAutoLayout, syncLayers, pushUndoState]);

  /** Convert selection to auto layout group. */
  const selectionToAutoLayout = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const active = c.getActiveObject();
    if (!active) return;

    if (active.type === "group" || (active as any).isFrameBg) {
      toggleAutoLayout();
      return;
    }

    if (active.type === "activeselection") {
      const sel = active as fabric.ActiveSelection;
      const objs = sel.removeAll();
      c.discardActiveObject();

      const group = new fabric.Group(objs, { left: sel.left, top: sel.top });
      (group as any).layerId = uid();
      (group as any).layerName = `autolayout_${(group as any).layerId}`;
      (group as any).frameId = (objs[0] as any)?.frameId || activeFrameIdRef.current;
      (group as any).autoLayout = {
        enabled: true, direction: "horizontal",
        padding: { top: 10, right: 10, bottom: 10, left: 10 },
        gap: 10, alignItems: "start", wrap: false,
      };

      c.add(group);
      c.setActiveObject(group);
      applyAutoLayout(group);
      c.renderAll();
      syncLayers();
      pushUndoState();
    }
  }, [toggleAutoLayout, applyAutoLayout, syncLayers, pushUndoState]);

  // ─── Pen tool ──────────────────────────────────────────────────
  const handlePenClick = useCallback((opt: fabric.TPointerEventInfo) => {
    const c = fabricRef.current; if (!c) return;
    const pointer = c.getScenePoint(opt.e);
    penPoints.current.push({ x: pointer.x, y: pointer.y });
    const dot = new fabric.Circle({ left: pointer.x - 4, top: pointer.y - 4, radius: 4, fill: "#6366f1", selectable: false, evented: false });
    c.add(dot); penDots.current.push(dot);
    if (penPoints.current.length > 1) {
      const prev = penPoints.current[penPoints.current.length - 2];
      const line = new fabric.Line([prev.x, prev.y, pointer.x, pointer.y], { stroke: "#6366f1", strokeWidth: 1, selectable: false, evented: false, strokeDashArray: [4, 4] });
      c.add(line); penLines.current.push(line);
    }
    c.renderAll();
  }, []);

  const finishPenPath = useCallback(() => {
    const c = fabricRef.current; if (!c) return;
    const pts = penPoints.current;
    if (pts.length < 2) { clearPen(); return; }
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x} ${pts[i].y}`;
    const isClosed = Math.sqrt((pts[0].x - pts[pts.length - 1].x) ** 2 + (pts[0].y - pts[pts.length - 1].y) ** 2) < 30;
    if (isClosed) d += " Z";
    clearPen();
    const id = uid();
    const path = new fabric.Path(d, { fill: isClosed ? "#6366f1" : "transparent", stroke: "#ffffff", strokeWidth: 2, strokeLineCap: "round", strokeLineJoin: "round" });
    (path as any).layerName = `path_${id}`;
    (path as any).isClosedPath = isClosed;
    placeInFrame(path);
  }, []);

  const clearPen = useCallback(() => {
    const c = fabricRef.current; if (!c) return;
    penLines.current.forEach(l => c.remove(l));
    penDots.current.forEach(d => c.remove(d));
    penLines.current = []; penDots.current = []; penPoints.current = [];
    c.renderAll();
  }, []);

  // ─── Object ops ────────────────────────────────────────────────
  const deleteSelected = useCallback(() => {
    const c = fabricRef.current; if (!c) return;
    c.getActiveObjects().forEach(obj => c.remove(obj));
    c.discardActiveObject(); c.renderAll();
  }, []);

  const duplicateSelected = useCallback(async () => {
    const c = fabricRef.current; if (!c) return;
    const obj = c.getActiveObject(); if (!obj) return;
    const clone = await obj.clone();
    clone.set({ left: (obj.left || 0) + 20, top: (obj.top || 0) + 20 });
    (clone as any).layerName = `${(obj as any).layerName || "clone"}_copy`;
    (clone as any).layerId = uid();
    (clone as any).frameId = (obj as any).frameId;
    c.add(clone); c.setActiveObject(clone); c.renderAll();
  }, []);

  const bringForward = useCallback(() => {
    const c = fabricRef.current; if (!c) return;
    const obj = c.getActiveObject();
    if (obj) { c.bringObjectForward(obj); c.renderAll(); }
  }, []);

  const sendBackward = useCallback(() => {
    const c = fabricRef.current; if (!c) return;
    const obj = c.getActiveObject();
    if (obj) { c.sendObjectBackwards(obj); c.renderAll(); }
  }, []);

  // ─── Export ────────────────────────────────────────────────────
  const exportFrame = useCallback((fid: string, format: "png" | "jpg" | "svg") => {
    const c = fabricRef.current; if (!c) return;
    const visual = c.getObjects().find((o: any) => o.isFrameVisual && o.frameId === fid && o.type === "rect");
    if (!visual) return;
    const x = visual.left || 0, y = visual.top || 0;
    const w = (visual.width || 0) * (visual.scaleX || 1);
    const h = (visual.height || 0) * (visual.scaleY || 1);
    const objs = c.getObjects().filter((o: any) => o.frameId === fid && !o.isFrameVisual);
    const tc = document.createElement("canvas"); tc.width = w * 2; tc.height = h * 2;
    const ctx = tc.getContext("2d")!; ctx.scale(2, 2);
    const origVpt = c.viewportTransform;
    c.setViewportTransform([1, 0, 0, 1, -x, -y]);
    for (const obj of objs) obj.render(ctx);
    c.setViewportTransform(origVpt);
    downloadDataUrl(tc.toDataURL(format === "jpg" ? "jpeg" : format, 0.95), `${framesRef.current.find(f => f.id === fid)?.name || "frame"}.${format}`);
  }, []);

  const exportPNG = useCallback(() => { if (activeFrameIdRef.current) exportFrame(activeFrameIdRef.current, "png"); }, [exportFrame]);
  const exportJPG = useCallback(() => { if (activeFrameIdRef.current) exportFrame(activeFrameIdRef.current, "jpg"); }, [exportFrame]);
  const exportSVG = useCallback(() => {
    const c = fabricRef.current; if (!c) return;
    const blob = new Blob([c.toSVG()], { type: "image/svg+xml" });
    downloadDataUrl(URL.createObjectURL(blob), "design.svg");
  }, []);
  const exportJSON = useCallback(() => {
    const c = fabricRef.current; if (!c) return;
    const json = (c.toJSON as any)(["layerId", "layerName", "frameId", "isFrameVisual", "isClosedPath", "imageFilters", "styleId", "componentId", "isComponentInstance", "constraints", "isSection", "isSectionBg", "isSectionLabel", "isSectionIndicator", "sectionId", "sectionColor"]);
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
    downloadDataUrl(URL.createObjectURL(blob), "design.json");
  }, []);

  // ─── Export & Upload (for API/webhook integration) ───────────────

  /** Export canvas as PNG/SVG and upload to API. Returns the export data. */
  const exportAndUpload = useCallback(async (
    templateId: string,
    format: "png" | "svg" | "jpg" = "png",
    scale: number = 2,
    webhookUrl?: string
  ): Promise<{ success: boolean; data?: any; error?: string }> => {
    const c = fabricRef.current;
    if (!c) return { success: false, error: "Canvas not initialized" };

    try {
      let imageData: string;

      if (format === "svg") {
        const svgString = c.toSVG();
        imageData = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgString)));
      } else {
        const multiplier = scale;
        const dataUrl = c.toDataURL({
          format: format === "jpg" ? "jpeg" : "png",
          multiplier,
          quality: format === "jpg" ? 0.95 : undefined,
        });
        imageData = dataUrl;
      }

      const el = c.getElement();
      const payload = {
        imageData,
        format,
        width: el.width,
        height: el.height,
        webhookUrl,
      };

      const res = await fetch(`/api/templates/${templateId}/export/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await res.json();
      return result;
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }, []);

  /** Export canvas as data URL (no upload). */
  const exportToDataUrl = useCallback((format: "png" | "svg" | "jpg" = "png", scale: number = 2): string | null => {
    const c = fabricRef.current;
    if (!c) return null;

    if (format === "svg") {
      return c.toSVG();
    }

    return c.toDataURL({
      format: format === "jpg" ? "jpeg" : "png",
      multiplier: scale,
      quality: format === "jpg" ? 0.95 : undefined,
    });
  }, []);

  // ─── Boolean Operations ──────────────────────────────────────────

  /**
   * Apply a boolean operation to the currently selected objects.
   * Requires 2+ shapes selected (ActiveSelection or Group).
   * The result is a Path with the computed SVG path.
   * Original shapes are removed and replaced by the result.
   */
  const applyBooleanOperation = useCallback((operation: BooleanOperation) => {
    const c = fabricRef.current;
    if (!c) return;

    const active = c.getActiveObject();
    if (!active) return;

    let objects: fabric.FabricObject[];
    if (active.type === "activeselection") {
      objects = (active as fabric.ActiveSelection).getObjects();
    } else if (active.type === "group") {
      objects = (active as fabric.Group).getObjects();
    } else {
      return;
    }

    if (objects.length < 2) return;

    // Perform boolean operation on pairs iteratively
    let currentObj = objects[0];
    for (let i = 1; i < objects.length; i++) {
      const result = performBooleanOperation(operation, currentObj, objects[i], c);
      if (!result) {
        console.warn(`[BooleanOps] Operation ${operation} failed at step ${i}`);
        return;
      }

      // Create a fabric.Path from the result SVG path
      const pathObj = new fabric.Path(result.pathD, {
        fill: (currentObj.fill as string) || "#6366f1",
        stroke: currentObj.stroke as string || undefined,
        strokeWidth: currentObj.strokeWidth || 0,
      });

      // Position the path at the result bounds
      pathObj.set({
        left: result.bounds.x,
        top: result.bounds.y,
      });

      currentObj = pathObj;
    }

    // Tag the result
    const id = uid("bool");
    (currentObj as any).layerId = id;
    (currentObj as any).layerName = `${operation}_${id}`;
    (currentObj as any).frameId = (objects[0] as any).frameId || activeFrameIdRef.current;
    (currentObj as any).fillRule = "evenodd";

    // Remove original objects
    for (const obj of objects) {
      c.remove(obj);
    }

    // If the active object is still the selection, discard it
    c.discardActiveObject();

    // Add the result
    c.add(currentObj);
    c.setActiveObject(currentObj);
    c.renderAll();

    syncLayers();
    pushUndoState();
  }, [syncLayers, pushUndoState]);

  /** Check if the current selection supports boolean operations (2+ shapes). */
  const canApplyBooleanOp = useCallback((): boolean => {
    const c = fabricRef.current;
    if (!c) return false;
    const active = c.getActiveObject();
    if (!active) return false;
    if (active.type === "activeselection") {
      return (active as fabric.ActiveSelection).getObjects().length >= 2;
    }
    if (active.type === "group") {
      return (active as fabric.Group).getObjects().length >= 2;
    }
    return false;
  }, []);

  return {
    fabricRef, canvasRef,
    containerRef, setContainerRef,
    canvasMounted, setCanvasMounted,
    pagesRef, activePageIdRef,
    addPage, switchPage, renamePage, deletePage,
    framesRef, activeFrameIdRef,
    addFrame, selectFrame, renameFrame, deleteFrame, exportFrame,
    addRect, addEllipse, addLine, addText, addImage, addSVG,
    handlePenClick, finishPenPath, clearPen,
    setToolMode,
    deleteSelected, duplicateSelected, bringForward, sendBackward,
    exportPNG, exportJPG, exportSVG, exportJSON,
    exportAndUpload, exportToDataUrl,
    // Undo/Redo
    undo,
    redo,
    canUndo,
    canRedo,
    // Copy/Paste
    copySelected,
    cutSelected,
    pasteFromClipboard,
    pasteInPlace,
    clipboardRef,
    // Group/Ungroup
    groupSelected,
    ungroupSelected,
    // Select All
    selectAll,
    // Alignment & Distribution
    alignObjects,
    distributeObjects,
    // Auto Layout
    applyAutoLayout,
    toggleAutoLayout,
    updateAutoLayout,
    updateResizingMode,
    selectionToAutoLayout,
    // Image Filters
    applyImageFilters,
    // Smart Guides & Grid Snapping
    snapSettingsRef,
    setSnapSettings,
    getSnapSettings,
    toggleSnapToGrid,
    toggleSmartGuides,
    setGridSize,
    renderGrid,
    // Grid visual (decoupled from snap)
    showGridRef,
    getShowGrid,
    toggleShowGrid,
    setShowGrid,
    // Canvas sizing
    canvasSizeRef,
    updateCanvasSize,
    // Eyedropper
    sampleColor,
    // Zoom to fit
    zoomToFit,
    zoomToSelection,
    // Outline mode
    setOutlineMode,
    // Z-order extremes
    bringToFront,
    sendToBack,
    // Next frame
    nextFrame,
    // Rename layer
    renameLayer,
    toggleLayerLock,
    // Styles
    stylesRef,
    applyStyle,
    createStyleFromObject,
    detachStyle,
    propagateStyleUpdate,
    // Components
    componentsRef,
    instanceRegistryRef,
    createComponent,
    instantiateComponent,
    detachInstance,
    enterComponentEditMode,
    saveComponentEdits,
    setInstanceOverride,
    getComponents,
    getComponent,
    deleteComponent,
    getInstanceComponent,
    // Comments
    commentModeRef,
    commentsRef,
    activeCommentIdRef,
    setCommentMode,
    addComment,
    addReply,
    resolveComment,
    reopenComment,
    deleteComment,
    setActiveComment,
    loadComments,
    syncComment,
    // Version History
    versionsRef,
    versionsLoadingRef,
    createVersion,
    debouncedAutoVersion,
    loadVersions,
    restoreVersion,
    // Sections
    sectionsRef,
    createSection,
    toggleSectionCollapse,
    assignToSection,
    removeFromSection,
    renameSection,
    setSectionColor,
    deleteSection,
    getSections,
    // Constraints
    frameSizeSnapshotRef,
    applyConstraintsToFrame,
    setConstraints,
    getConstraints,
    // Boolean Operations
    applyBooleanOperation,
    canApplyBooleanOp,
    // Variables / Design Tokens
    variablesRef,
    collectionsRef,
    activeModeRef,
    variableBindingsRef,
    resolveVariableValue,
    getVariableValue,
    createCollection,
    updateCollection,
    deleteCollection,
    createVariable,
    updateVariable,
    deleteVariable,
    setActiveMode,
    bindVariableToProperty,
    unbindVariableFromProperty,
    getBoundVariable,
    propagateAllVariables,
    getVariables,
    getCollections,
    getActiveMode,
    loadVariables,
    saveVariables,
    // Grid Styles
    gridStylesRef,
    activeGridStyleIdRef,
    setGridStyles,
    getGridStyles,
    getActiveGridStyleId,
    applyGridStyle,
    removeGridStyle,
    renderGridStyleOverlay,
    // Image Fit Mode
    imageFitModesRef,
    setImageFitMode,
    getImageFitMode,
  };
}

function downloadDataUrl(url: string, name: string) {
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
}
