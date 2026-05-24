import { useState, useCallback, useEffect, useRef } from "react";
import * as fabric from "fabric";
import { CanvasEditor } from "./components/CanvasEditor";
import { CanvasRulers } from "./components/CanvasRulers";
import { LayersPanel } from "./components/LayersPanel";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { Toolbar } from "./components/Toolbar";
import { StatusBar } from "./components/StatusBar";
import { StylesPanel } from "./components/StylesPanel";
import { ComponentsPanel } from "./components/ComponentsPanel";
import { CommentsPanel } from "./components/CommentsPanel";
import { CommentPin } from "./components/CommentPin";
import { VersionHistoryPanel } from "./components/VersionHistoryPanel";
import { PrototypePanel } from "./components/PrototypePanel";
import { PrototypePreview } from "./components/PrototypePreview";
import { BranchPanel } from "./components/BranchPanel";
import { CssSpecsPanel } from "./components/CssSpecsPanel";
import { BatchPanel } from "./components/BatchPanel";
import { KeyboardShortcutsDialog } from "./components/KeyboardShortcutsDialog";
import { Dashboard } from "./components/Dashboard";
import { SettingsPanel } from "./components/SettingsPanel";
import { LoginPage } from "./components/LoginPage";
import { AutoSaveIndicator } from "./components/AutoSaveIndicator";
import { ToastProvider, useToast } from "./components/Toast";
import { useCanvas } from "./hooks/useCanvas";
import { usePrototype } from "./hooks/usePrototype";
import { useAuth } from "./hooks/useAuth";
import { useAutoSave } from "./hooks/useAutoSave";
import { useRemoteSync } from "./hooks/useRemoteSync";
import { getTemplate, createTemplate } from "./lib/templateApi";
import type { ToolName, LayerInfo, FrameInfo, PageInfo } from "./hooks/useCanvas";
import type { StyleDefinition, Comment, TemplateVersion } from "@futuraria/shared";

// ─── URL param helpers ───────────────────────────────────────────
function getTemplateIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("templateId");
}

function setTemplateIdInUrl(id: string | null) {
  const url = new URL(window.location.href);
  if (id) {
    url.searchParams.set("templateId", id);
  } else {
    url.searchParams.delete("templateId");
  }
  window.history.pushState({}, "", url.toString());
}

// ─── Main Editor Component ───────────────────────────────────────
function Editor({ templateId, onBack }: { templateId: string; onBack: () => void }) {
  const { addToast } = useToast();
  const [selectedObj, setSelectedObj] = useState<fabric.FabricObject | null>(null);
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [activePageId, setActivePageId] = useState("");
  const [activeFrameId, setActiveFrameId] = useState("");
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<ToolName>("select");
  const [dragOver, setDragOver] = useState(false);
  const [templateName, setTemplateName] = useState("Untitled");
  const [loadingTemplate, setLoadingTemplate] = useState(true);

  // Eyedropper state
  const [eyedropperColor, setEyedropperColor] = useState<string | null>(null);
  const [showEyedropperPreview, setShowEyedropperPreview] = useState(false);

  // Outline mode
  const [outlineMode, setOutlineMode] = useState(false);

  // Alignment: track multi-selection
  const [hasMultiSelection, setHasMultiSelection] = useState(false);

  // Undo/Redo: track availability
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Smart Guides & Grid Snapping state (decoupled)
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [smartGuides, setSmartGuides] = useState(true);
  const [gridSize, setGridSize] = useState(10);
  const [showGrid, setShowGrid] = useState(true);

  // Canvas dimensions (from ResizeObserver via useCanvas)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  // Export dialog
  const [showExportDialog, setShowExportDialog] = useState(false);

  // Rename layer dialog
  const [renamingLayer, setRenamingLayer] = useState<string | null>(null);

  // Styles state
  const [styles, setStyles] = useState<StyleDefinition[]>([]);

  // Comments state
  const [comments, setComments] = useState<Comment[]>([]);
  const [showCommentsPanel, setShowCommentsPanel] = useState(false);

  // Version History state
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [showVersionPanel, setShowVersionPanel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Right panel tab
  const [rightPanelTab, setRightPanelTab] = useState<"properties" | "styles" | "components" | "prototype" | "code" | "batch">("properties");

  // Panel visibility
  const [showLeftPanel, setShowLeftPanel] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(true);

  // Prototype state
  const [showPreview, setShowPreview] = useState(false);

  // Space-held hand tool
  const spaceHeldRef = useRef(false);
  const prevToolRef = useRef<ToolName>("select");

  // Stable refs for active page/frame IDs (updated by useCanvas, read by callbacks)
  const activePageIdRef = useRef("");
  const activeFrameIdRef = useRef("");

  const onSelectionChange = useCallback((obj: fabric.FabricObject | null) => {
    setSelectedObj(obj);
    setHasMultiSelection(!!obj && obj.type === "activeselection");
    if (obj && (obj as any).frameId) setSelectedFrameId((obj as any).frameId);
  }, []);
  const onLayersChange = useCallback((l: LayerInfo[]) => setLayers(l), []);
  const onPagesChange = useCallback((p: PageInfo[]) => { setPages(p); setActivePageId(activePageIdRef.current); }, []);
  const onFramesChange = useCallback((f: FrameInfo[]) => { setFrames(f); setActiveFrameId(activeFrameIdRef.current); }, []);
  const onUndoRedoChange = useCallback((undo: boolean, redo: boolean) => {
    setCanUndo(undo);
    setCanRedo(redo);
  }, []);
  const onCanvasSizeChange = useCallback((size: { width: number; height: number }) => {
    setCanvasSize(size);
  }, []);
  const onCommentsChange = useCallback((c: Comment[]) => setComments(c), []);
  const onVersionsChange = useCallback((v: TemplateVersion[]) => { setVersions(v); setVersionsLoading(false); }, []);

  const canvas = useCanvas({
    onSelectionChange,
    onLayersChange,
    onPagesChange,
    onFramesChange,
    onUndoRedoChange,
    onCanvasSizeChange,
    onCommentsChange,
    onVersionsChange,
  });
  const { fabricRef, canvasRef, containerRef, setContainerRef, canvasMounted, setCanvasMounted } = canvas;

  // Keep active page/frame refs in sync with canvas
  useEffect(() => {
    activePageIdRef.current = canvas.activePageIdRef.current;
    activeFrameIdRef.current = canvas.activeFrameIdRef.current;
  });

  // ─── Auto-Save ────────────────────────────────────────────────
  const { status: saveStatus, forceSave } = useAutoSave({
    fabricRef,
    templateId,
    getExtraData: () => ({
      pages: pages,
      frames: frames,
      styles: styles,
      variables: {
        collections: canvas.getCollections(),
        variables: canvas.getVariables(),
        bindings: Object.fromEntries(canvas.variableBindingsRef.current.entries()),
      },
    }),
  });

  // ─── Remote Sync (poll for agent API changes) ─────────────────

  const reloadCanvasFromTemplate = useCallback((tpl: any) => {
    const c = fabricRef.current;
    if (!c || !tpl || !tpl.canvas) return;

    try {
      if (tpl.canvas.objects && tpl.canvas.objects.length > 0) {
        c.clear();
        fabric.util.enlivenObjects(tpl.canvas.objects).then((objects: any[]) => {
          for (const obj of objects) c.add(obj);
          c.renderAll();
        }).catch((err: any) => {
          console.error("Failed to enliven objects from template:", err);
                    addToast("warning", "Partial sync", "Some remote canvas objects could not be loaded");
        });
      }

      if (tpl.canvas.viewport) {
        const vp = tpl.canvas.viewport;
        c.setViewportTransform([vp.zoom, 0, 0, vp.zoom, vp.x, vp.y]);
        setZoom(vp.zoom);
      }

      if (tpl.name) setTemplateName(tpl.name);
      if (tpl.pages) { canvas.pagesRef.current = tpl.pages; setPages(tpl.pages); }
      if (tpl.frames) { canvas.framesRef.current = tpl.frames; setFrames(tpl.frames); }
      if (tpl.styles) { canvas.stylesRef.current = tpl.styles; setStyles(tpl.styles); }
    } catch (err) {
      console.error("Failed to reload canvas from template:", err);
      addToast("error", "Sync failed", "Could not apply remote changes to canvas");
    }
  }, [canvas]);

  const { hasRemoteChanges, acceptRemoteChanges, dismissRemoteChanges } = useRemoteSync({
    templateId,
    intervalMs: 15000,
    onExternalChange: reloadCanvasFromTemplate,
  });

  // ─── Load template on startup ─────────────────────────────────
  useEffect(() => {
    if (!templateId) return;

    let cancelled = false;

    (async () => {
      setLoadingTemplate(true);
      try {
        const tpl = await getTemplate(templateId);
        if (cancelled || !tpl) return;

        setTemplateName(tpl.name);

        // Load canvas JSON if present
        const c = fabricRef.current;
        if (c && tpl.canvas) {
          const canvasData = tpl.canvas;

          // If canvas has objects, load them
          if (canvasData.objects && canvasData.objects.length > 0) {
            c.clear();
            await fabric.util.enlivenObjects(canvasData.objects).then((objects: any[]) => {
              for (const obj of objects) {
                c.add(obj);
              }
              c.renderAll();
            }).catch((err: any) => {
              console.error("[loadTemplate] Failed to enliven objects:", err);
              addToast("warning", "Partial canvas load", "Some objects could not be restored from the template");
              c.renderAll();
            });
          }

          // Restore viewport
          if (canvasData.viewport) {
            const vp = canvasData.viewport;
            c.setViewportTransform([vp.zoom, 0, 0, vp.zoom, vp.x, vp.y]);
            setZoom(vp.zoom);
          }
        }

        // Restore pages/frames if saved
        if (tpl.pages && tpl.pages.length > 0) {
          canvas.pagesRef.current = tpl.pages;
          canvas.activePageIdRef.current = tpl.pages[0].id;
          setPages(tpl.pages);
          setActivePageId(tpl.pages[0].id);
        }

        if (tpl.frames && tpl.frames.length > 0) {
          canvas.framesRef.current = tpl.frames;
          canvas.activeFrameIdRef.current = tpl.frames[0]?.id || "";
          setFrames(tpl.frames);
          setActiveFrameId(tpl.frames[0]?.id || "");
        }

        // Restore styles
        if (tpl.styles && tpl.styles.length > 0) {
          canvas.stylesRef.current = tpl.styles;
          setStyles(tpl.styles);
        }

        // Restore variables
        if (tpl.variables) {
          if (tpl.variables.collections) canvas.collectionsRef.current = tpl.variables.collections;
          if (tpl.variables.variables) canvas.variablesRef.current = tpl.variables.variables;
          if (tpl.variables.bindings) {
            canvas.variableBindingsRef.current = new Map(Object.entries(tpl.variables.bindings));
          }
        }

        // Load comments and versions
        canvas.loadComments(templateId);
        setVersionsLoading(true);
        canvas.loadVersions(templateId);
      } catch (err) {
        // Only show toast for non-offline errors; blank canvas is expected offline
        const msg = (err as Error).message || "";
        if (!msg.includes("fetch") && !msg.includes("NetworkError") && !msg.includes("Failed to fetch")) {
          addToast("error", "Failed to load template", msg);
        }
      } finally {
        if (!cancelled) setLoadingTemplate(false);
      }
    })();

    return () => { cancelled = true; };
  }, [templateId]);

  // ─── Prototype hook ────────────────────────────────────────────
  const prototype = usePrototype({
    getFrameIds: () => canvas.framesRef.current.map((f) => f.id),
  });

  // ─── Tool change ───────────────────────────────────────────────
  const handleToolChange = useCallback((t: ToolName) => {
    setTool(t);
    canvas.setToolMode(t);
    if (t === "rect") { canvas.addRect(); setTool("select"); canvas.setToolMode("select"); }
    else if (t === "ellipse") { canvas.addEllipse(); setTool("select"); canvas.setToolMode("select"); }
    else if (t === "line") { canvas.addLine(); setTool("select"); canvas.setToolMode("select"); }
    else if (t === "frame") { canvas.addFrame(); setTool("select"); canvas.setToolMode("select"); }
    else if (t === "text") { canvas.addText(); setTool("select"); canvas.setToolMode("select"); }
    else if (t === "image") {
      openFilePicker((file) => {
        if (file.name.endsWith(".svg") || file.type === "image/svg+xml") readFileAs(file, "text", (r) => canvas.addSVG(r as string));
        else readFileAs(file, "dataUrl", (r) => canvas.addImage(r as string));
      });
      setTool("select"); canvas.setToolMode("select");
    }
    else if (t === "eyedropper") {
      setTool("eyedropper");
      canvas.setToolMode("eyedropper");
      setShowEyedropperPreview(true);
    }
  }, [canvas]);

  // ─── Pen tool ──────────────────────────────────────────────────
  useEffect(() => {
    const c = fabricRef.current; if (!c) return;
    const handler = (opt: fabric.TPointerEventInfo) => { if (tool === "pen") canvas.handlePenClick(opt); };
    c.on("mouse:down", handler);
    return () => { c.off("mouse:down", handler); };
  }, [tool, fabricRef, canvas.handlePenClick]);

  // ─── Eyedropper tool ──────────────────────────────────────────
  useEffect(() => {
    const c = fabricRef.current; if (!c) return;
    if (tool !== "eyedropper") {
      setShowEyedropperPreview(false);
      return;
    }

    const handleEyedropperClick = (opt: fabric.TPointerEventInfo) => {
      const color = canvas.sampleColor(opt.e as MouseEvent);
      if (color) {
        setEyedropperColor(color);
        const active = c.getActiveObject();
        if (active) {
          active.set("fill", color);
          c.renderAll();
        }
        setTool("select");
        canvas.setToolMode("select");
        setShowEyedropperPreview(false);
      }
    };

    const handleEyedropperMove = (opt: fabric.TPointerEventInfo) => {
      const color = canvas.sampleColor(opt.e as MouseEvent);
      if (color) setEyedropperColor(color);
    };

    c.on("mouse:down", handleEyedropperClick);
    c.on("mouse:move", handleEyedropperMove);
    return () => {
      c.off("mouse:down", handleEyedropperClick);
      c.off("mouse:move", handleEyedropperMove);
    };
  }, [tool, fabricRef, canvas]);

  // ─── Comment mode ─────────────────────────────────────────────
  useEffect(() => {
    const c = fabricRef.current; if (!c) return;
    if (!canvas.commentModeRef.current) return;

    const handleCommentClick = (opt: fabric.TPointerEventInfo) => {
      const pointer = c.getScenePoint(opt.e);
      const text = prompt("Add comment:");
      if (text) {
        canvas.addComment(pointer.x, pointer.y, text, "User", "current");
        canvas.setCommentMode(false);
        setShowCommentsPanel(true);
      }
    };

    c.on("mouse:down", handleCommentClick);
    return () => { c.off("mouse:down", handleCommentClick); };
  }, [tool, fabricRef, canvas]);

  // ─── Outline mode ─────────────────────────────────────────────
  const toggleOutlineMode = useCallback(() => {
    const next = !outlineMode;
    setOutlineMode(next);
    canvas.setOutlineMode(next);
  }, [outlineMode, canvas]);

  // ─── Snap settings (decoupled from showGrid) ───────────────────
  const handleToggleSnapToGrid = useCallback(() => {
    const next = !snapToGrid;
    setSnapToGrid(next);
    canvas.setSnapSettings({ snapToGrid: next });
  }, [snapToGrid, canvas]);

  const handleToggleSmartGuides = useCallback(() => {
    const next = !smartGuides;
    setSmartGuides(next);
    canvas.setSnapSettings({ smartGuides: next });
  }, [smartGuides, canvas]);

  const handleSetGridSize = useCallback((size: number) => {
    const clamped = Math.max(1, Math.min(100, size));
    setGridSize(clamped);
    canvas.setGridSize(clamped);
    if (showGrid) canvas.renderGrid();
  }, [showGrid, canvas]);

  const handleToggleGrid = useCallback(() => {
    const next = canvas.toggleShowGrid();
    setShowGrid(next);
  }, [canvas]);

  // Initialize settings on mount
  useEffect(() => {
    canvas.setSnapSettings({ snapToGrid, gridSize, smartGuides });
    canvas.setShowGrid(showGrid);
  }, []);

  // ─── Zoom (applies to fabric viewport) ─────────────────────────
  const applyZoom = useCallback((fn: (z: number) => number) => {
    const c = fabricRef.current; if (!c) return;
    const newZoom = fn(c.getZoom());
    const center = { x: c.width! / 2, y: c.height! / 2 };
    c.zoomToPoint(new fabric.Point(center.x, center.y), newZoom);
    setZoom(newZoom);
    c.renderAll();
  }, [fabricRef]);

  // ─── Keyboard shortcuts (Figma-matching) ───────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const isMeta = e.metaKey || e.ctrlKey;
      const isShift = e.shiftKey;
      const isAlt = e.altKey;

      // Delete / Backspace
      if (e.code === "Delete" || e.code === "Backspace") {
        if (!isMeta && !isShift && !isAlt) {
          canvas.deleteSelected();
          return;
        }
      }

      // Escape
      if (e.code === "Escape") {
        if (tool === "pen") {
          canvas.clearPen();
          setTool("select");
          canvas.setToolMode("select");
        } else if (canvas.commentModeRef.current) {
          canvas.setCommentMode(false);
        } else if (showExportDialog) {
          setShowExportDialog(false);
        } else if (renamingLayer) {
          setRenamingLayer(null);
        } else {
          const c = fabricRef.current;
          if (c) { c.discardActiveObject(); c.renderAll(); }
        }
        return;
      }

      // Enter: text editing or finish pen path
      if (e.code === "Enter") {
        if (tool === "pen") {
          canvas.finishPenPath();
          setTool("select");
          canvas.setToolMode("select");
          return;
        }
        // Enter text editing for selected Textbox
        if (!isMeta && !isShift && !isAlt) {
          const active = fabricRef.current?.getActiveObject();
          if (active && (active.type === "textbox" || active.type === "text" || active.type === "i-text")) {
            e.preventDefault();
            (active as any).enterEditing?.();
            fabricRef.current?.renderAll();
            return;
          }
        }
      }

      // Cmd + key shortcuts
      if (isMeta) {
        // Cmd+Z → Undo
        if (!isShift && !isAlt && e.code === "KeyZ") {
          e.preventDefault();
          canvas.undo();
          return;
        }
        // Cmd+Shift+Z → Redo
        if (isShift && !isAlt && e.code === "KeyZ") {
          e.preventDefault();
          canvas.redo();
          return;
        }
        // Cmd+Y → Toggle outline mode
        if (!isShift && !isAlt && e.code === "KeyY") {
          e.preventDefault();
          toggleOutlineMode();
          return;
        }
        // Cmd+D → Duplicate
        if (!isShift && !isAlt && e.code === "KeyD") {
          e.preventDefault();
          canvas.duplicateSelected();
          return;
        }
        // Cmd+A → Select all
        if (!isShift && !isAlt && e.code === "KeyA") {
          e.preventDefault();
          canvas.selectAll();
          return;
        }
        // Cmd+C → Copy
        if (!isShift && !isAlt && e.code === "KeyC") {
          e.preventDefault();
          canvas.copySelected();
          return;
        }
        // Cmd+V → Paste
        if (!isShift && !isAlt && e.code === "KeyV") {
          const active = fabricRef.current?.getActiveObject();
          if (active && ((active as any).isEditing || active.type === "textbox" || active.type === "i-text")) {
            return;
          }
          e.preventDefault();
          canvas.pasteFromClipboard();
          return;
        }
        // Cmd+Shift+V → Paste in place
        if (isShift && !isAlt && e.code === "KeyV") {
          e.preventDefault();
          canvas.pasteInPlace();
          return;
        }
        // Cmd+X → Cut
        if (!isShift && !isAlt && e.code === "KeyX") {
          e.preventDefault();
          canvas.cutSelected();
          return;
        }
        // Cmd+G → Group
        if (!isShift && !isAlt && e.code === "KeyG") {
          e.preventDefault();
          canvas.groupSelected();
          return;
        }
        // Cmd+Shift+G → Ungroup
        if (isShift && !isAlt && e.code === "KeyG") {
          e.preventDefault();
          canvas.ungroupSelected();
          return;
        }
        // Cmd+L → Lock/Unlock selected layer
        if (!isShift && !isAlt && e.code === "KeyL") {
          e.preventDefault();
          const sel = fabricRef.current?.getActiveObject();
          if (sel && (sel as any).layerId) {
            canvas.toggleLayerLock((sel as any).layerId);
          }
          return;
        }
        // Cmd+] → Bring forward
        if (!isShift && !isAlt && e.code === "BracketRight") {
          e.preventDefault();
          canvas.bringForward();
          return;
        }
        // Cmd+[ → Send backward
        if (!isShift && !isAlt && e.code === "BracketLeft") {
          e.preventDefault();
          canvas.sendBackward();
          return;
        }
        // Cmd+Alt+] → Bring to front
        if (!isShift && isAlt && e.code === "BracketRight") {
          e.preventDefault();
          canvas.bringToFront();
          return;
        }
        // Cmd+Alt+[ → Send to back
        if (!isShift && isAlt && e.code === "BracketLeft") {
          e.preventDefault();
          canvas.sendToBack();
          return;
        }
        // Ctrl+Alt+U → Boolean Union
        if (!isShift && isAlt && e.code === "KeyU") {
          e.preventDefault();
          canvas.applyBooleanOperation("union");
          return;
        }
        // Ctrl+Alt+S → Boolean Subtract
        if (!isShift && isAlt && e.code === "KeyS") {
          e.preventDefault();
          canvas.applyBooleanOperation("subtract");
          return;
        }
        // Ctrl+Alt+I → Boolean Intersect
        if (!isShift && isAlt && e.code === "KeyI") {
          e.preventDefault();
          canvas.applyBooleanOperation("intersect");
          return;
        }
        // Ctrl+Alt+E → Boolean Exclude
        if (!isShift && isAlt && e.code === "KeyE") {
          e.preventDefault();
          canvas.applyBooleanOperation("exclude");
          return;
        }
        // Cmd+1 → Zoom to fit all
        if (!isShift && !isAlt && e.code === "Digit1") {
          e.preventDefault();
          canvas.zoomToFit();
          const c1 = fabricRef.current;
          if (c1) setZoom(c1.getZoom());
          return;
        }
        // Cmd+2 → Zoom to selection
        if (!isShift && !isAlt && e.code === "Digit2") {
          e.preventDefault();
          canvas.zoomToSelection();
          const c2 = fabricRef.current;
          if (c2) setZoom(c2.getZoom());
          return;
        }
        // Cmd+' → Toggle grid
        if (!isShift && !isAlt && e.code === "Quote") {
          e.preventDefault();
          handleToggleGrid();
          return;
        }
        // Cmd+R → Rename selected layer
        if (!isShift && !isAlt && e.code === "KeyR") {
          e.preventDefault();
          const active = fabricRef.current?.getActiveObject();
          if (active && (active as any).layerId) {
            setRenamingLayer((active as any).layerId);
          }
          return;
        }
        // Cmd+Shift+E → Export dialog
        if (isShift && !isAlt && e.code === "KeyE") {
          e.preventDefault();
          setShowExportDialog(true);
          return;
        }
        // Cmd+Shift+S → Snap to grid toggle
        if (isShift && !isAlt && e.code === "KeyS") {
          e.preventDefault();
          handleToggleSnapToGrid();
          return;
        }
        // Cmd+Shift+H → Smart guides toggle
        if (isShift && !isAlt && e.code === "KeyH") {
          e.preventDefault();
          handleToggleSmartGuides();
          return;
        }
        // Cmd+S → Force save
        if (!isShift && !isAlt && e.code === "KeyS") {
          e.preventDefault();
          forceSave();
          canvas.createVersion(templateId, "Manual save");
          return;
        }
        // Cmd+P → Prototype preview
        if (!isShift && !isAlt && e.code === "KeyP") {
          e.preventDefault();
          if (showPreview) {
            prototype.stopPreview();
            setShowPreview(false);
          } else {
            prototype.startPreview();
            setShowPreview(true);
          }
          return;
        }
      }


      // Shift+A → Auto Layout
      if (e.code === "KeyA" && isShift && !isMeta && !isAlt) {
        e.preventDefault();
        canvas.selectionToAutoLayout();
        return;
      }
      // Zoom via keyboard (no modifiers)
      if (!isMeta && !isAlt) {
        if (e.code === "Equal" || e.code === "NumpadAdd") {
          e.preventDefault();
          applyZoom(z => Math.min(z * 1.1, 5));
          return;
        }
        if (e.code === "Minus" || e.code === "NumpadSubtract") {
          e.preventDefault();
          applyZoom(z => Math.max(z / 1.1, 0.1));
          return;
        }
        if (e.code === "Digit0" || e.code === "Numpad0") {
          e.preventDefault();
          applyZoom(() => 1);
          return;
        }
      }

      // Space → Hand tool (hold)
      if (e.code === "Space" && !isMeta && !isAlt && !e.repeat) {
        e.preventDefault();
        if (!spaceHeldRef.current) {
          spaceHeldRef.current = true;
          prevToolRef.current = tool;
          setTool("hand");
          canvas.setToolMode("hand");
        }
        return;
      }

      // Cmd+\ or Ctrl+\ → Toggle side panels
      if (e.code === "Backslash" && (isMeta || e.ctrlKey)) {
        e.preventDefault();
        setShowLeftPanel(p => !p);
        setShowRightPanel(p => !p);
        return;
      }

      // Cmd+K or Cmd+/ → Keyboard shortcuts dialog
      if (isMeta && !isShift && !isAlt && (e.code === "Slash" || e.code === "KeyK")) {
        e.preventDefault();
        setShowShortcuts(p => !p);
        return;
      }

      // Single-key tool shortcuts (no modifiers)
      if (!isMeta && !isAlt && !isShift) {
        switch (e.code) {
          case "KeyV": handleToolChange("select"); break;
          case "KeyP": handleToolChange("pencil"); break;
          case "KeyB": handleToolChange("pen"); break;
          case "KeyR": handleToolChange("rect"); break;
          case "KeyO": handleToolChange("ellipse"); break;
          case "KeyL": handleToolChange("line"); break;
          case "KeyF": handleToolChange("frame"); break;
          case "KeyT": handleToolChange("text"); break;
          case "KeyI": handleToolChange("eyedropper"); break;
          case "KeyH": handleToolChange("hand"); break;
          case "KeyK": setTool("select"); canvas.setToolMode("select"); break;
          case "KeyN": canvas.nextFrame(); break;
          case "KeyC": {
            // Toggle comment mode
            if (!canvas.commentModeRef.current) {
              canvas.setCommentMode(true);
              setShowCommentsPanel(true);
            }
            break;
          }
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && spaceHeldRef.current) {
        spaceHeldRef.current = false;
        setTool(prevToolRef.current);
        canvas.setToolMode(prevToolRef.current);
      }
    };

    window.addEventListener("keydown", handler);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [
    canvas, handleToolChange, tool, zoom,
    handleToggleSnapToGrid, handleToggleSmartGuides,
    handleToggleGrid, toggleOutlineMode,
    showExportDialog, renamingLayer, applyZoom, showPreview, prototype,
    forceSave, templateId,
  ]);

  // Scroll zoom
  useEffect(() => {
    const el = document.querySelector(".canvas-area"); if (!el) return;
    const handler = (e: Event) => {
      const we = e as unknown as WheelEvent;
      e.preventDefault();
      const c = fabricRef.current; if (!c) return;
      const delta = we.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.05, Math.min(5, c.getZoom() * delta));
      const pointer = c.getScenePoint(we);
      c.zoomToPoint(new fabric.Point(pointer.x, pointer.y), newZoom);
      setZoom(newZoom);
      c.renderAll();
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [fabricRef]);

  // ─── Drag & drop ───────────────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    for (const file of Array.from(e.dataTransfer.files)) {
      if (file.name.endsWith(".svg") || file.type === "image/svg+xml") readFileAs(file, "text", (r) => canvas.addSVG(r as string));
      else if (file.type.startsWith("image/")) readFileAs(file, "dataUrl", (r) => canvas.addImage(r as string));
    }
  }, [canvas]);

  const selectedLayer = layers.find((l) => l.id === (selectedObj as any)?.layerId) || null;

  if (loadingTemplate) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0a0a0a", color: "#888" }}>
        <div className="spinner" style={{ marginRight: 12 }} />
        Loading template...
      </div>
    );
  }

  return (
    <>
      <div className="top-bar">
        <div className="top-bar-left">
          <button
            onClick={onBack}
            style={{
              background: "none", border: "none", color: "#888", cursor: "pointer",
              padding: "4px 8px", borderRadius: 4, fontSize: 12, display: "flex",
              alignItems: "center", gap: 4,
            }}
            title="Back to Dashboard"
          >
            ← Back
          </button>
          <svg width="24" height="24" viewBox="0 0 40 40" fill="none"><rect width="40" height="40" rx="8" fill="#6366f1" /><path d="M12 28V12h6l5 8 5-8h6v16h-5V18l-6 10-6-10v10z" fill="white" /></svg>
          <span className="app-title">{templateName}</span>
          <AutoSaveIndicator status={saveStatus} />
          {tool === "pen" && <span className="tool-hint">Click to place points • Enter to finish • Esc to cancel</span>}
          {tool === "eyedropper" && <span className="tool-hint">Click on canvas to sample color • Esc to cancel</span>}
          {canvas.commentModeRef.current && <span className="tool-hint">Click on canvas to add comment • Esc to cancel</span>}
          {activeFrameId && <span className="frame-indicator">▢ {frames.find(f => f.id === activeFrameId)?.name || "Frame"}</span>}
        </div>
        <div className="top-bar-right">
          {/* Grid/Snap controls — decoupled */}
          <div className="snap-controls">
            <button
              className={`snap-btn ${snapToGrid ? 'active' : ''}`}
              onClick={handleToggleSnapToGrid}
              title="Snap to Grid (Ctrl+Shift+S)"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
                <rect x="0.5" y="0.5" width="5" height="5" rx="0.5" />
                <rect x="8.5" y="0.5" width="5" height="5" rx="0.5" />
                <rect x="0.5" y="8.5" width="5" height="5" rx="0.5" />
                <rect x="8.5" y="8.5" width="5" height="5" rx="0.5" />
              </svg>
              Snap
            </button>
            <button
              className={`snap-btn ${smartGuides ? 'active' : ''}`}
              onClick={handleToggleSmartGuides}
              title="Smart Guides (Ctrl+Shift+H)"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
                <line x1="7" y1="0" x2="7" y2="14" strokeDasharray="2 2" />
                <line x1="0" y1="7" x2="14" y2="7" strokeDasharray="2 2" />
                <rect x="2" y="2" width="4" height="4" rx="0.5" />
                <rect x="8" y="8" width="4" height="4" rx="0.5" />
              </svg>
              Guides
            </button>
            <button
              className={`snap-btn ${showGrid ? 'active' : ''}`}
              onClick={handleToggleGrid}
              title="Show Grid (Ctrl+`)"
            >
              ⊞ Grid
            </button>
            <div className="grid-size-control">
              <input
                type="number"
                className="grid-size-input"
                value={gridSize}
                onChange={(e) => handleSetGridSize(Number(e.target.value))}
                min={1}
                max={100}
                title="Grid size (px)"
              />
              <span className="grid-size-label">px</span>
            </div>
          </div>

          {/* Panel toggles */}
          <div className="panel-toggles" style={{ display: "flex", gap: 4, marginLeft: 8 }}>
            <button
              className={`snap-btn ${showCommentsPanel ? 'active' : ''}`}
              onClick={() => setShowCommentsPanel(!showCommentsPanel)}
              title="Comments (C to add)"
            >
              💬
            </button>
            <button
              className={`snap-btn ${showVersionPanel ? 'active' : ''}`}
              onClick={() => setShowVersionPanel(!showVersionPanel)}
              title="Version History"
            >
              🕐
            </button>
          </div>

          {/* Settings gear button */}
          <button
            onClick={() => setShowSettings(true)}
            style={{
              background: "none",
              border: "none",
              color: "#888",
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              marginLeft: 8,
            }}
            title="Settings (API Keys & Webhooks)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          </button>

          <span className="top-bar-shortcut">⌘Z undo · ⌘⇧Z redo · ⌘1 fit · ⌘2 zoom-sel · ⌘G group · ⌘C/V/X copy/paste/cut</span>
        </div>
      </div>

      {/* ─── Settings Panel ──────────────────────────────────────── */}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showShortcuts && <KeyboardShortcutsDialog isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />}

      {/* ─── Remote Changes Toast ─────────────────────────────────── */}
      {hasRemoteChanges && (
        <div style={{
          position: "fixed", top: 56, left: "50%", transform: "translateX(-50%)",
          background: "#1e3a5f", border: "1px solid #3b82f6", borderRadius: 8,
          padding: "10px 20px", zIndex: 1001, display: "flex", alignItems: "center", gap: 12,
          boxShadow: "0 4px 20px rgba(59,130,246,0.3)",
        }}>
          <span style={{ color: "#93c5fd", fontSize: 13 }}>
            🔄 Agent modified this design externally
          </span>
          <button onClick={acceptRemoteChanges} style={{
            background: "#3b82f6", color: "#fff", border: "none", borderRadius: 4,
            padding: "4px 12px", fontSize: 12, cursor: "pointer", fontWeight: 600,
          }}>Reload</button>
          <button onClick={dismissRemoteChanges} style={{
            background: "transparent", color: "#888", border: "none",
            cursor: "pointer", fontSize: 16, padding: "0 4px",
          }}>✕</button>
        </div>
      )}


      {/* ─── Eyedropper preview swatch ──────────────────────────── */}
      {showEyedropperPreview && eyedropperColor && (
        <div className="eyedropper-preview" style={{
          position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)",
          display: "flex", alignItems: "center", gap: 8,
          background: "#1e1e2e", border: "1px solid #333", borderRadius: 8,
          padding: "6px 12px", zIndex: 1000,
        }}>
          <div style={{
            width: 20, height: 20, borderRadius: 4,
            backgroundColor: eyedropperColor,
            border: "1px solid #555",
          }} />
          <span style={{ color: "#ccc", fontSize: 12, fontFamily: "monospace" }}>
            {eyedropperColor}
          </span>
        </div>
      )}

      {/* ─── Eyedropper persistent swatch ───────────────────────── */}
      {eyedropperColor && !showEyedropperPreview && (
        <div className="eyedropper-swatch" style={{
          position: "fixed", bottom: 80, right: 20,
          display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
          zIndex: 1000,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 6,
            backgroundColor: eyedropperColor,
            border: "2px solid #6366f1", cursor: "pointer",
          }}
            title={`Sampled: ${eyedropperColor}\nClick to copy`}
            onClick={() => navigator.clipboard.writeText(eyedropperColor)}
          />
          <span style={{ color: "#888", fontSize: 10 }}>{eyedropperColor}</span>
        </div>
      )}

      {/* ─── Export dialog ──────────────────────────────────────── */}
      {showExportDialog && (
        <div className="export-dialog-overlay" onClick={() => setShowExportDialog(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000,
          }}>
          <div className="export-dialog" onClick={(e) => e.stopPropagation()}
            style={{
              background: "#1e1e2e", borderRadius: 12, padding: 24,
              minWidth: 320, border: "1px solid #333",
            }}>
            <h3 style={{ margin: "0 0 16px", color: "#fff", fontSize: 16 }}>Export</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button className="export-dialog-btn" onClick={() => { canvas.exportPNG(); setShowExportDialog(false); }}>Export PNG</button>
              <button className="export-dialog-btn" onClick={() => { canvas.exportJPG(); setShowExportDialog(false); }}>Export JPG</button>
              <button className="export-dialog-btn" onClick={() => { canvas.exportSVG(); setShowExportDialog(false); }}>Export SVG</button>
              <button className="export-dialog-btn" onClick={() => { canvas.exportJSON(); setShowExportDialog(false); }}>Export JSON</button>
            </div>
            <p style={{ color: "#888", fontSize: 11, marginTop: 12 }}>⌘⇧E to toggle • Esc to close</p>
          </div>
        </div>
      )}

      {/* ─── Rename layer dialog ────────────────────────────────── */}
      {renamingLayer && (() => {
        const obj = fabricRef.current?.getObjects().find((o: any) => o.layerId === renamingLayer);
        const currentName = obj ? (obj as any).layerName || "" : "";
        return (
          <div className="rename-overlay" onClick={() => setRenamingLayer(null)}
            style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)",
              display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000,
            }}>
            <div className="rename-dialog" onClick={(e) => e.stopPropagation()}
              style={{
                background: "#1e1e2e", borderRadius: 12, padding: 24,
                minWidth: 300, border: "1px solid #333",
              }}>
              <h3 style={{ margin: "0 0 12px", color: "#fff", fontSize: 16 }}>Rename Layer</h3>
              <input
                type="text"
                defaultValue={currentName}
                autoFocus
                style={{
                  width: "100%", padding: "8px 12px", borderRadius: 6,
                  border: "1px solid #555", background: "#111", color: "#fff",
                  fontSize: 14, outline: "none",
                }}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") {
                    const input = ev.target as HTMLInputElement;
                    canvas.renameLayer(renamingLayer, input.value);
                    setRenamingLayer(null);
                  }
                  if (ev.key === "Escape") setRenamingLayer(null);
                }}
              />
            </div>
          </div>
        );
      })()}

      <div className="app" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
        {showLeftPanel && (
          <LayersPanel
            pages={pages} activePageId={activePageId}
            frames={frames} activeFrameId={activeFrameId}
            layers={layers} selectedLayer={selectedLayer} selectedFrameId={selectedFrameId}
            onSelectLayer={(l) => {
              const obj = fabricRef.current?.getObjects().find((o: any) => o.layerId === l.id);
              if (obj) { fabricRef.current?.setActiveObject(obj); fabricRef.current?.renderAll(); }
            }}
            onSelectFrame={(fid) => { canvas.selectFrame(fid); setSelectedFrameId(fid); }}
            onAddPage={canvas.addPage} onSwitchPage={canvas.switchPage}
            onRenamePage={canvas.renamePage} onDeletePage={canvas.deletePage}
            onAddFrame={canvas.addFrame} onRenameFrame={canvas.renameFrame} onDeleteFrame={canvas.deleteFrame}
            onDelete={canvas.deleteSelected} onDuplicate={canvas.duplicateSelected}
            onBringForward={canvas.bringForward} onSendBackward={canvas.sendBackward}
            onToggleLock={canvas.toggleLayerLock}
            onExportFrame={canvas.exportFrame}
          />
        )}
        {/* Left panel toggle button */}
        <button
          className="panel-toggle panel-toggle-left"
          onClick={() => setShowLeftPanel(p => !p)}
          title={showLeftPanel ? "Hide left panel (⌘\\)" : "Show left panel (⌘\\)"}
        >
          {showLeftPanel ? "◀" : "▶"}
        </button>

        <Toolbar
          tool={tool} onToolChange={handleToolChange}
          onExportPNG={canvas.exportPNG} onExportJPG={canvas.exportJPG}
          onExportSVG={canvas.exportSVG} onExportJSON={canvas.exportJSON}
          onZoomIn={() => applyZoom(z => Math.min(z * 1.2, 5))}
          onZoomOut={() => applyZoom(z => Math.max(z / 1.2, 0.05))}
          onZoomToFit={() => { canvas.zoomToFit(); setZoom(fabricRef.current?.getZoom() || 1); }}
          zoom={zoom}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={canvas.undo}
          onRedo={canvas.redo}
          onAlign={canvas.alignObjects}
          onDistribute={canvas.distributeObjects}
          hasMultiSelection={hasMultiSelection}
          eyedropperColor={eyedropperColor}
          onEyedropperClick={() => handleToolChange("eyedropper")}
          onAutoLayout={canvas.selectionToAutoLayout}
          canBooleanOp={canvas.canApplyBooleanOp()}
          onBooleanOp={canvas.applyBooleanOperation}
          onPrototypePreview={() => {
            prototype.startPreview();
            setShowPreview(true);
          }}
        />

        {/* Canvas area — wrapped in div with ref for ResizeObserver */}
        <div
          className="canvas-area"
          ref={setContainerRef}
          style={{ position: "relative", overflow: "hidden" }}
        >
          <CanvasEditor zoom={zoom} canvasRef={canvasRef} fabricRef={fabricRef} tool={tool} onCanvasReady={() => setCanvasMounted(true)}>
            <CanvasRulers fabricRef={fabricRef} zoom={zoom} canvasWidth={canvasSize.width} canvasHeight={canvasSize.height} />
          </CanvasEditor>

          {/* Comment pins overlay */}
          {comments.filter(c => !c.resolved).map((comment) => (
            <CommentPin
              key={comment.id}
              comment={comment}
              zoom={zoom}
              viewportX={fabricRef.current?.viewportTransform[4] || 0}
              viewportY={fabricRef.current?.viewportTransform[5] || 0}
              isActive={canvas.activeCommentIdRef.current === comment.id}
              onClick={(c) => {
                canvas.setActiveComment(c.id);
                setShowCommentsPanel(true);
              }}
            />
          ))}
        </div>

        {/* Right panel toggle button */}
        <button
          className="panel-toggle panel-toggle-right"
          onClick={() => setShowRightPanel(p => !p)}
          title={showRightPanel ? "Hide right panel (⌘\\)" : "Show right panel (⌘\\)"}
        >
          {showRightPanel ? "▶" : "◀"}
        </button>

        {/* Right panel with tabs */}
        {showRightPanel && (
        <div className="properties-panel">
          <div className="panel-tabs">
            <button
              className={`panel-tab ${rightPanelTab === "properties" ? "active" : ""}`}
              onClick={() => setRightPanelTab("properties")}
            >
              Properties
            </button>
            <button
              className={`panel-tab ${rightPanelTab === "styles" ? "active" : ""}`}
              onClick={() => setRightPanelTab("styles")}
            >
              Styles
            </button>
            <button
              className={`panel-tab ${rightPanelTab === "components" ? "active" : ""}`}
              onClick={() => setRightPanelTab("components")}
            >
              Components
            </button>
            <button
              className={`panel-tab ${rightPanelTab === "prototype" ? "active" : ""}`}
              onClick={() => setRightPanelTab("prototype")}
            >
              Prototype
            </button>
            <button
              className={`panel-tab ${rightPanelTab === "code" ? "active" : ""}`}
              onClick={() => setRightPanelTab("code")}
            >
              Code
            </button>
            <button
              className={`panel-tab ${rightPanelTab === "batch" ? "active" : ""}`}
              onClick={() => setRightPanelTab("batch")}
            >
              Batch
            </button>
          </div>

          {rightPanelTab === "properties" && (
            <PropertiesPanel
              selectedObj={selectedObj}
              fabricRef={fabricRef}
              onLayerUpdate={() => {
                const c = fabricRef.current;
                if (c) setLayers(c.getObjects().filter((o: any) => !o.isFrameVisual && !o.isFrameLabel && !o.isSectionLabel && !o.isSectionIndicator).map((o) => ({
                  id: (o as any).layerId || "", name: (o as any).layerName || o.type || "",
                  type: o.type || "", visible: o.visible !== false, locked: o.selectable === false,
                  frameId: (o as any).frameId,
                })));
              }}
            />
          )}

          {rightPanelTab === "styles" && (
            <StylesPanel
              selectedObj={selectedObj}
              fabricRef={fabricRef}
              onStyleChange={() => {
                const c = fabricRef.current;
                if (c) c.renderAll();
              }}
              styles={styles}
              onStylesChange={setStyles}
              onStyleEdited={(style) => canvas.propagateStyleUpdate(style)}
            />
          )}

          {rightPanelTab === "components" && (
            <ComponentsPanel
              components={canvas.getComponents()}
              selectedInstanceComponentId={
                selectedObj && (selectedObj as any).isComponentInstance
                  ? (selectedObj as any).componentId
                  : null
              }
              instanceOverrides={selectedObj ? (selectedObj as any).overrides || {} : {}}
              onCreateComponent={(name) => canvas.createComponent(name)}
              onInstantiate={(id) => canvas.instantiateComponent(id)}
              onDeleteComponent={(id) => canvas.deleteComponent(id)}
              onDetachInstance={() => canvas.detachInstance()}
              onEnterEditMode={(id) => canvas.enterComponentEditMode(id)}
              onOverrideProperty={(propId, val) => {
                if (selectedObj) canvas.setInstanceOverride((selectedObj as any).layerId, propId, val);
              }}
              onSelectMainComponent={(id) => canvas.enterComponentEditMode(id)}
            />
          )}

          {rightPanelTab === "prototype" && (
            <PrototypePanel
              selectedLayerId={selectedObj ? (selectedObj as any).layerId : null}
              frames={frames}
              prototype={prototype}
              onStartPreview={() => setShowPreview(true)}
            />
          )}

          {rightPanelTab === "code" && (
            <CssSpecsPanel
              selectedObj={selectedObj}
              fabricRef={fabricRef}
            />
          )}

          {rightPanelTab === "batch" && (
            <BatchPanel
              fabricRef={fabricRef}
            />
          )}
        </div>
        )}

        {/* Prototype Preview overlay */}
        {showPreview && (
          <PrototypePreview
            prototype={prototype}
            frames={frames}
            renderFrame={(frameId: string, width: number, height: number) => {
              // Render frame content by finding the frame objects
              const frame = frames.find((f) => f.id === frameId);
              if (!frame) return <div className="proto-frame-placeholder">Frame not found</div>;
              return (
                <div
                  className="proto-frame-render"
                  style={{ width, height, background: "#161616", position: "relative" }}
                >
                  <div style={{ padding: 16, color: "#fff", fontSize: 14 }}>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>{frame.name}</div>
                    <div style={{ color: "#888", fontSize: 12 }}>
                      {frame.objectIds.length} element{frame.objectIds.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                </div>
              );
            }}
            onClose={() => setShowPreview(false)}
          />
        )}

        {/* Comments panel (right side overlay) */}
        {showCommentsPanel && (
          <CommentsPanel
            comments={comments}
            activeCommentId={canvas.activeCommentIdRef.current}
            currentAuthor="User"
            onAddComment={(x, y, text) => {
              canvas.addComment(x, y, text, "User", "current");
            }}
            onAddReply={(id, text) => canvas.addReply(id, text, "User")}
            onResolve={(id) => canvas.resolveComment(id)}
            onReopen={(id) => canvas.reopenComment(id)}
            onDelete={(id) => canvas.deleteComment(id)}
            onSelectComment={(c) => canvas.setActiveComment(c?.id || null)}
            onClose={() => setShowCommentsPanel(false)}
          />
        )}

        {/* Version History panel (right side overlay) */}
        {showVersionPanel && (
          <VersionHistoryPanel
            versions={versions}
            currentVersionId={versions[0]?.id || null}
            isLoading={versionsLoading}
            onRestore={(id) => canvas.restoreVersion(id, templateId)}
            onSaveNamed={(msg) => canvas.createVersion(templateId, msg)}
            onClose={() => setShowVersionPanel(false)}
          />
        )}

        <StatusBar
          layerCount={layers.length}
          selectedLayer={selectedLayer}
          zoom={zoom}
          canvasSize={canvasSize}
        />
        {dragOver && <div className="upload-overlay"><div className="upload-msg">Drop SVG, PNG, or JPG to add</div></div>}
      </div>
    </>
  );
}

// ─── App Root with Routing ───────────────────────────────────────
export default function App() {
  const auth = useAuth();
  const [templateId, setTemplateId] = useState<string | null>(getTemplateIdFromUrl());
  const [localMode, setLocalMode] = useState(false);

  // Sync URL when templateId changes
  useEffect(() => {
    setTemplateIdInUrl(templateId);
  }, [templateId]);

  // Handle browser back/forward
  useEffect(() => {
    const handler = () => {
      setTemplateId(getTemplateIdFromUrl());
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  const handleSelectTemplate = useCallback((id: string) => {
    setTemplateId(id);
  }, []);

  const handleCreateNew = useCallback(async () => {
    // Dashboard handles creation and calls onSelectTemplate
  }, []);

  const handleBack = useCallback(() => {
    setTemplateId(null);
  }, []);

  const handleSkipLogin = useCallback(() => {
    setLocalMode(true);
  }, []);

  // Loading state
  if (auth.loading) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", background: "#0a0a0a", color: "#888",
      }}>
        <div className="spinner" style={{ marginRight: 12 }} />
        Loading...
      </div>
    );
  }

  // Auth required but not logged in and not in local mode
  if (!auth.isLocal && !auth.user && !localMode) {
    return <LoginPage onLogin={auth.login} onSkipLogin={handleSkipLogin} />;
  }

  // Determine userId for API calls
  const userId = auth.user?.id || "local";

  // Routing
  if (templateId) {
    return <ToastProvider><Editor templateId={templateId} onBack={handleBack} /></ToastProvider>;
  }

  return (
    <ToastProvider>
    <Dashboard
      userId={userId}
      onSelectTemplate={handleSelectTemplate}
      onCreateNew={handleCreateNew}
    />
    </ToastProvider>
  );
}

function openFilePicker(cb: (file: File) => void) {
  const input = document.createElement("input"); input.type = "file"; input.accept = "image/*,.svg";
  input.onchange = (e) => { const file = (e.target as HTMLInputElement).files?.[0]; if (file) cb(file); }; input.click();
}
function readFileAs(file: File, mode: "text" | "dataUrl", cb: (r: string | ArrayBuffer) => void) {
  const reader = new FileReader(); reader.onload = () => cb(reader.result!);
  if (mode === "text") reader.readAsText(file); else reader.readAsDataURL(file);
}
