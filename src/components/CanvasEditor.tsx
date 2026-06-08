import { useRef, useEffect, useState, useCallback } from "react";
import { useCanvas, ToolName } from "../hooks/useCanvas";
import { useAutoSave } from "../hooks/useAutoSave";
import type { Canvas as FabricCanvas } from "fabric";
import { Line } from "fabric";

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
    enterCropMode, exitCropMode, applyCropMode,
  } = useCanvas();

  const mountRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const gridOnRef = useRef(false);
  const clipboardRef = useRef<any>(null);
  const templateJsonRef = useRef(templateJson);
  templateJsonRef.current = templateJson;
  const initDoneRef = useRef(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const [showRulers, setShowRulers] = useState(false);
  const guidesRef = useRef<Line[]>([]);

  // Space-to-pan: hold Space to temporarily activate hand tool
  const spaceActiveRef = useRef(false);
  const prevToolRef = useRef<ToolName>("select");
  // Keep prevToolRef in sync with current tool
  useEffect(() => { if (!spaceActiveRef.current) prevToolRef.current = tool; }, [tool]);

  // Auto-save
  const { status: saveStatus } = useAutoSave({
    fabricRef,
    templateId,
    getExtraData: () => ({
      name: templateJsonRef.current?.name,
    }),
    enabled: !!templateId,
    canvasReady,
  });

  // Step 1: Init canvas on mount (no template load, no setLoading)
  useEffect(() => {
    if (!mountRef.current || !containerRef.current) return;
    const c = initCanvas(mountRef.current, containerRef.current);
    fabricRef.current = c;
    initDoneRef.current = true;
    setCanvasReady(true);

    return () => {
      c.dispose();
      fabricRef.current = null;
      initDoneRef.current = false;
      setCanvasReady(false);
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

      // Space-to-pan: hold Space for temporary hand tool
      if (!isInput && !mod && e.key === " " && !spaceActiveRef.current) {
        e.preventDefault();
        spaceActiveRef.current = true;
        prevToolRef.current = tool;
        setTool("hand");
        onToolChange?.("hand");
        return;
      }

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
    const keyupHandler = (e: KeyboardEvent) => {
      if (e.key === " " && spaceActiveRef.current) {
        spaceActiveRef.current = false;
        setTool(prevToolRef.current);
        onToolChange?.(prevToolRef.current);
      }
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("keyup", keyupHandler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("keyup", keyupHandler);
    };
  }, [undo, redo, copySelected, pasteObject, duplicateSelected, deleteSelected, group, ungroup, setTool, onToolChange, showGrid]);

  // Guide line helpers
  const addGuide = useCallback((orientation: "h" | "v", pos: number) => {
    const c = fabricRef.current;
    if (!c) return;
    const guide = new Line(
      orientation === "h" ? [0, 0, c.width!, 0] : [0, 0, 0, c.height!],
      {
        stroke: "#f43f5e", strokeWidth: 1,
        strokeDashArray: [6, 4],
        selectable: false, evented: false, excludeFromExport: true,
        left: orientation === "v" ? pos : undefined,
        top: orientation === "h" ? pos : undefined,
      },
    );
    (guide as any).isGuideLine = true;
    c.add(guide);
    guidesRef.current.push(guide);
    c.requestRenderAll();
  }, []);

  const clearGuides = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    for (const g of guidesRef.current) c.remove(g);
    guidesRef.current = [];
    c.requestRenderAll();
  }, []);

  const toggleRulers = useCallback(() => {
    setShowRulers(prev => {
      if (prev) clearGuides();
      return !prev;
    });
  }, [clearGuides]);

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
      // Crop mode
      enterCropMode, exitCropMode, applyCropMode,
      // Frame management
      getFrameCount, getFrames, createFrame, deleteFrame, renameFrame, moveObjectToFrame,
      exportFramePNG, exportAllFramesPNG,
      FRAME_MAX,
      // Rulers & Guides
      showRulers, toggleRulers, clearGuides,
    };
  }, [zoom, zoomIn, zoomOut, zoomToFit, undo, redo, canUndo, canRedo, getCanvasJSON, exportPNG, exportSVG, exportJSON, pushHistory, tool, setTool, onToolChange, align, distribute, booleanOp, autoLayout, selectedObjects, enterCropMode, exitCropMode, applyCropMode, getFrameCount, getFrames, createFrame, deleteFrame, renameFrame, moveObjectToFrame, exportFramePNG, exportAllFramesPNG, FRAME_MAX, showRulers, toggleRulers, clearGuides]);

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: "#1e1e2e" }}>
      {/* Ruler overlays */}
      {showRulers && (
        <>
          <RulerBar
            orientation="h"
            zoom={zoom}
            containerWidth={containerRef.current?.clientWidth ?? 0}
            onCreateGuide={(pos) => addGuide("h", pos)}
          />
          <RulerBar
            orientation="v"
            zoom={zoom}
            containerWidth={containerRef.current?.clientHeight ?? 0}
            onCreateGuide={(pos) => addGuide("v", pos)}
          />
        </>
      )}
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

// ── Ruler Bar ───────────────────────────────────────────────

const RULER_SIZE = 24;

function RulerBar({ orientation, zoom, containerWidth, onCreateGuide }: {
  orientation: "h" | "v";
  zoom: number;
  containerWidth: number;
  onCreateGuide: (pos: number) => void;
}) {
  const isH = orientation === "h";
  const tickStep = zoom < 0.5 ? 200 : zoom < 1 ? 100 : zoom < 2 ? 50 : 25;
  const ticks: { pos: number; label: string }[] = [];
  for (let i = 0; i <= containerWidth; i += tickStep) {
    if (i % (tickStep * 5) === 0) {
      ticks.push({ pos: i, label: String(Math.round(i / zoom)) });
    } else {
      ticks.push({ pos: i, label: "" });
    }
  }

  return (
    <div
      style={{
        position: "absolute",
        [isH ? "top" : "left"]: 0,
        [isH ? "left" : "top"]: isH ? RULER_SIZE : 0,
        [isH ? "width" : "height"]: containerWidth,
        [isH ? "height" : "width"]: RULER_SIZE,
        background: "#16161e",
        zIndex: 10,
        borderBottom: isH ? "1px solid #2a2a3a" : undefined,
        borderRight: !isH ? "1px solid #2a2a3a" : undefined,
        overflow: "hidden",
      }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const local = isH ? e.clientX - rect.left : e.clientY - rect.top;
        onCreateGuide(local / zoom);
      }}
    >
      {ticks.map((t, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            [isH ? "left" : "top"]: t.pos,
            [isH ? "top" : "left"]: 0,
            [isH ? "width" : "height"]: 1,
            [isH ? "height" : "width"]: t.label ? 12 : 7,
            background: "#4a4a5a",
          }}
        >
          {t.label && (
            <span style={{
              position: "absolute",
              [isH ? "top" : "left"]: 13,
              [isH ? "left" : "top"]: 3,
              fontSize: 9, fontFamily: "monospace", color: "#7a7a90",
              whiteSpace: "nowrap",
            }}>
              {t.label}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
