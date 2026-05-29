import { useRef, useEffect, useState, useCallback } from "react";
import { useCanvas, ToolName } from "../hooks/useCanvas";
import { useAutoSave } from "../hooks/useAutoSave";
import type { Canvas as FabricCanvas } from "fabric";

interface CanvasEditorProps {
  templateId: string | null;
  templateJson?: any;
  onToolChange?: (tool: ToolName) => void;
}

export function CanvasEditor({ templateId, templateJson, onToolChange }: CanvasEditorProps) {
  const {
    canvasRef,
    tool, setTool, zoom, zoomIn, zoomOut, zoomToFit,
    canUndo, canRedo, undo, redo,
    selectedObjects,
    initCanvas, loadTemplate, getCanvasJSON, pushHistory,
    exportPNG, exportSVG, exportJSON,
    group, ungroup, deleteSelected,
    copySelected, pasteObject, duplicateSelected,
    toggleLock, showGrid, align, distribute, booleanOp, autoLayout,
    getFrameCount, getFrames, createFrame, deleteFrame, renameFrame, moveObjectToFrame,
    exportFramePNG, exportAllFramesPNG, FRAME_MAX,
  } = useCanvas();

  const mountRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const gridOnRef = useRef(false);
  const clipboardRef = useRef<any>(null);
  const templateJsonRef = useRef(templateJson);
  templateJsonRef.current = templateJson;
  const initDoneRef = useRef(false);

  // Auto-save
  const { status: saveStatus } = useAutoSave({
    fabricRef,
    templateId,
    getExtraData: () => ({}),
    enabled: !!templateId,
  });

  // Step 1: Init canvas on mount (no template load, no setLoading)
  useEffect(() => {
    if (!mountRef.current || !containerRef.current) return;
    const c = initCanvas(mountRef.current, containerRef.current);
    fabricRef.current = c;
    initDoneRef.current = true;

    return () => {
      c.dispose();
      fabricRef.current = null;
      initDoneRef.current = false;
    };
  }, [initCanvas]);

  // Step 2: Load template once canvas is initialized
  useEffect(() => {
    if (!initDoneRef.current || !fabricRef.current) return;
    const tj = templateJsonRef.current;
    if (!tj?.canvas && !tj?.objects) return;
    queueMicrotask(() => loadTemplate(tj.canvas || tj));
  }, [loadTemplate, templateJson]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isInput = ["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName);
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (mod && (e.key === "Z" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); return; }
      if (mod && e.key === "c") { e.preventDefault(); clipboardRef.current = copySelected(); return; }
      if (mod && e.key === "v") { e.preventDefault(); pasteObject(clipboardRef.current); return; }
      if (mod && e.key === "d") { e.preventDefault(); duplicateSelected(); return; }
      if (e.key === "Delete" || e.key === "Backspace") { if (!isInput) { e.preventDefault(); deleteSelected(); } return; }
      if (mod && e.key === "g") { e.preventDefault(); group(); return; }
      if (mod && e.key === "G") { e.preventDefault(); ungroup(); return; }

      // Tool switching (not when typing)
      if (!isInput && !mod) {
        switch (e.key.toLowerCase()) {
          case "v": setTool("select"); onToolChange?.("select"); break;
          case "h": setTool("hand"); onToolChange?.("hand"); break;
          case "r": setTool("rect"); onToolChange?.("rect"); break;
          case "o": setTool("ellipse"); onToolChange?.("ellipse"); break;
          case "l": setTool("line"); onToolChange?.("line"); break;
          case "t": setTool("text"); onToolChange?.("text"); break;
          case "f": setTool("frame"); onToolChange?.("frame"); break;
          case "p": setTool("pen"); onToolChange?.("pen"); break;
          case "g": gridOnRef.current = !gridOnRef.current; showGrid(gridOnRef.current); break;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, copySelected, pasteObject, duplicateSelected, deleteSelected, group, ungroup, setTool, onToolChange, showGrid]);

  // Expose canvas controls via window for Toolbar integration
  useEffect(() => {
    (window as any).__canvasControls = {
      zoom, zoomIn, zoomOut, zoomToFit,
      undo, redo, canUndo, canRedo,
      getCanvasJSON, exportPNG, exportSVG, exportJSON, pushHistory,
      tool, setTool: (t: ToolName) => { setTool(t); onToolChange?.(t); },
      align, distribute, booleanOp, autoLayout,
      selectedObjects,
      _canvas: fabricRef.current,
      // Frame management
      getFrameCount, getFrames, createFrame, deleteFrame, renameFrame, moveObjectToFrame,
      exportFramePNG, exportAllFramesPNG,
      FRAME_MAX,
    };
  }, [zoom, zoomIn, zoomOut, zoomToFit, undo, redo, canUndo, canRedo, getCanvasJSON, exportPNG, exportSVG, exportJSON, pushHistory, tool, setTool, onToolChange, align, distribute, booleanOp, autoLayout, selectedObjects, getFrameCount, getFrames, createFrame, deleteFrame, renameFrame, moveObjectToFrame, exportFramePNG, exportAllFramesPNG, FRAME_MAX]);

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: "#1e1e2e" }}>
      <canvas ref={mountRef} style={{ display: "block" }} />
      {/* Zoom badge */}
      <div style={badgeStyle(true)}>
        {Math.round(zoom * 100)}% · Frames: {getFrameCount()}/{FRAME_MAX}
        {saveStatus === "saving" && " · Saving…"}
        {saveStatus === "saved" && " · Saved"}
        {saveStatus === "error" && " · Error"}
      </div>
      {/* Selection info */}
      {selectedObjects.length > 0 && (
        <div style={badgeStyle(false)}>
          {selectedObjects.length} selected
        </div>
      )}
    </div>
  );
}

function badgeStyle(isBottom: boolean): React.CSSProperties {
  return {
    position: "absolute",
    background: "rgba(0,0,0,0.6)", color: "#fff",
    padding: "3px 10px", borderRadius: 6, fontSize: 12,
    fontFamily: "monospace", pointerEvents: "none",
    ...(isBottom ? { bottom: 12, right: 12 } : { top: 8, left: 8, pointerEvents: "auto" }),
  };
}
