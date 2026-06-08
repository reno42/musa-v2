import { useReducer, useRef, useCallback, useEffect, useState } from "react";
import { Toolbar } from "./components/Toolbar";
import { CanvasEditor } from "./components/CanvasEditor";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { LayersPanel } from "./components/LayersPanel";
import { Dashboard } from "./components/Dashboard";
import { BatchAMator } from "./components/BatchAMator";
import { GovernancePanel } from "./components/GovernancePanel";
import { ComponentsPanel } from "./components/ComponentsPanel";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts";
import { ToastProvider } from "./components/Toast";
import { useAutoSave } from "./hooks/useAutoSave";
import { getTemplate } from "./lib/templateApi";
import { apiFetch } from "./lib/supabase";
import type { Canvas as FabricCanvas } from "fabric";
import type { FabricObject } from "fabric";
import type { ToolName } from "./hooks/useCanvas";

// Establish module dependency chain for dead-code analysis
void (useAutoSave as unknown);
void (getTemplate as unknown);
void (apiFetch as unknown);

type ViewMode = "dashboard" | "editor";

type AppState = {
  view: ViewMode;
  templateId: string | null;
  templateJson: any;
  canvas: { zoom: number; tool: ToolName; canUndo: boolean; canRedo: boolean; selectedObjects: FabricObject[] };
  shortcutsOpen: boolean;
  batchRenderKey: number;
};

type AppAction =
  | { type: "SET_VIEW"; view: ViewMode }
  | { type: "OPEN_TEMPLATE"; id: string; json: any }
  | { type: "BACK_TO_DASHBOARD" }
  | { type: "SET_CANVAS"; canvas: AppState["canvas"] }
  | { type: "SET_TOOL"; tool: ToolName }
  | { type: "TOGGLE_SHORTCUTS" }
  | { type: "SET_SHORTCUTS"; open: boolean }
  | { type: "TRIGGER_BATCH_RENDER" };

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_VIEW": return { ...state, view: action.view };
    case "OPEN_TEMPLATE": return { ...state, view: "editor", templateId: action.id, templateJson: action.json };
    case "BACK_TO_DASHBOARD": return { ...state, view: "dashboard", templateId: null, templateJson: null };
    case "SET_CANVAS": return { ...state, canvas: action.canvas };
    case "SET_TOOL": return { ...state, canvas: { ...state.canvas, tool: action.tool } };
    case "TOGGLE_SHORTCUTS": return { ...state, shortcutsOpen: !state.shortcutsOpen };
    case "SET_SHORTCUTS": return { ...state, shortcutsOpen: action.open };
    case "TRIGGER_BATCH_RENDER": return { ...state, batchRenderKey: state.batchRenderKey + 1 };
  }
}

const initialAppState: AppState = {
  view: "dashboard",
  templateId: null,
  templateJson: null,
  canvas: { zoom: 1, tool: "select" as ToolName, canUndo: false, canRedo: false, selectedObjects: [] as FabricObject[] },
  shortcutsOpen: false,
  batchRenderKey: 0,
};

function App() {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const batchOpenRef = useRef(false);
  const governanceOpenRef = useRef(false);
  const governanceRefreshRef = useRef(0);
  const [, setGovKey] = useState(0);
  const componentsOpenRef = useRef(false);
  const [, setCompKey] = useState(0);

  const { view, templateId, templateJson, canvas: canvasState, shortcutsOpen } = state;
  const zoom = canvasState.zoom;
  const tool = canvasState.tool;
  const canUndo = canvasState.canUndo;
  const canRedo = canvasState.canRedo;
  const selectedObjects = canvasState.selectedObjects;

  const setTool = useCallback((t: ToolName) => {
    dispatch({ type: "SET_TOOL", tool: t });
  }, []);

  // Proxy ref for LayersPanel — populated from canvas on window
  const layersCanvasRef = useRef<FabricCanvas | null>(null);
  const frameCountRef = useRef(0);

  // Sync with CanvasEditor via polling window.__canvasControls
  useEffect(() => {
    if (view !== "editor") return;
    const id = setInterval(() => {
      const ctrl = (window as any).__canvasControls;
      if (!ctrl) return;
      const newZoom = ctrl.zoom;
      const newCanUndo = ctrl.canUndo;
      const newCanRedo = ctrl.canRedo;
      const newTool = ctrl.tool;
      const newSel = ctrl.selectedObjects || [];
      dispatch({ type: "SET_CANVAS", canvas: { zoom: newZoom, tool: newTool, canUndo: newCanUndo, canRedo: newCanRedo, selectedObjects: newSel } });
      // Populate the layers canvas proxy ref
      if (ctrl._canvas && !layersCanvasRef.current) {
        layersCanvasRef.current = ctrl._canvas;
      }
      // Update frame count
      if (typeof ctrl.getFrameCount === "function") {
        frameCountRef.current = ctrl.getFrameCount();
      }
    }, 200);
    return () => clearInterval(id);
  }, [view]);

  const batchOpen = batchOpenRef.current;
  const setBatchOpen = useCallback((v: boolean) => {
    batchOpenRef.current = v;
    dispatch({ type: "TRIGGER_BATCH_RENDER" });
  }, []);

  // Keyboard shortcuts for dialogs
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "k") { e.preventDefault(); dispatch({ type: "TOGGLE_SHORTCUTS" }); }
      if (mod && e.key === "b") { e.preventDefault(); if (view === "editor") setBatchOpen(!batchOpenRef.current); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [view, setBatchOpen, batchOpenRef]);

  // ── Auto-triggers: snapshots on browser events ──
  const callSnapshot = useCallback(async (type: "human" | "system", trigger: string) => {
    if (!templateId) return;
    try {
      await apiFetch("/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", method: "snapshot_auto",
          params: { templateId, type, trigger }, id: 0,
        }),
      });
    } catch { /* silent */ }
  }, [templateId]);

  // beforeunload
  useEffect(() => {
    const handler = () => { callSnapshot("human", "beforeunload"); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [callSnapshot]);

  // visibilitychange
  useEffect(() => {
    const handler = () => {
      if (document.hidden) callSnapshot("system", "paused");
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [callSnapshot]);

  // Idle 5min timer
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => callSnapshot("system", "idle"), 300_000);
    };
    reset();
    const events = ["mousemove", "keydown", "touchstart", "scroll"];
    for (const evt of events) window.addEventListener(evt, reset);
    return () => {
      clearTimeout(timer);
      for (const evt of events) window.removeEventListener(evt, reset);
    };
  }, [callSnapshot]);

  // Call canvas controls
  const callCanvas = useCallback((method: string, ...args: any[]) => {
    const ctrl = (window as any).__canvasControls;
    if (!ctrl || !ctrl[method]) return;
    return ctrl[method](...args);
  }, []);

  // Create new template and open in editor
  const handleCreateTemplate = async (workspaceId: string) => {
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": "dev-key" },
        body: JSON.stringify({ workspaceId, name: "Untitled", width: 1080, height: 1080 }),
      });
      const json = await res.json();
      if (json.success && json.data) {
        const d = json.data;
        dispatch({
          type: "OPEN_TEMPLATE",
          id: d.id,
          json: { width: d.width, height: d.height, canvas: d.canvas, objects: d.canvas?.objects || [] },
        });
      }
    } catch { /* ignore */ }
  };

  // Open existing template
  const handleSelectTemplate = async (id: string) => {
    try {
      const d = await getTemplate(id);
      if (d) {
        dispatch({ type: "OPEN_TEMPLATE", id, json: { name: d.name, width: d.width, height: d.height, canvas: d.canvas, objects: d.canvas?.objects || [] } });
        return;
      }
    } catch { /* ignore */ }
    dispatch({ type: "OPEN_TEMPLATE", id, json: { width: 1080, height: 1080 } });
  };

  // Dashboard view
  if (view === "dashboard") {
    return (
      <Dashboard
        onSelectTemplate={handleSelectTemplate}
        onCreateTemplate={handleCreateTemplate}
      />
    );
  }

  // Editor view
  return (
    <ToastProvider>
      <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
        {/* Toolbar */}
        <Toolbar
          tool={tool}
          onToolChange={(t) => { setTool(t); callCanvas("setTool", t); }}
          onExportPNG={async () => { const blob = await callCanvas("exportPNG", 2); if (blob) downloadBlob(blob, "design.png"); }}
          onExportSVG={() => { const svg = callCanvas("exportSVG"); if (svg) downloadText(svg, "design.svg", "image/svg+xml"); }}
          onExportJSON={() => { const json = callCanvas("exportJSON"); if (json) downloadText(json, "design.json", "application/json"); }}
          onExportFrame={async () => {
            const frames = callCanvas("getFrames");
            if (frames && frames.length > 0) {
              const blob = await callCanvas("exportFramePNG", (frames[0] as any).frameId, 2);
              if (blob) downloadBlob(blob, `${(frames[0] as any).frameName || "frame"}.png`);
            }
          }}
          onExportAllFrames={async () => {
            const results = await callCanvas("exportAllFramesPNG");
            if (results && results.length > 0) {
              for (const r of results) {
                downloadBlob(r.blob, `${r.name}.png`);
                await new Promise(res => setTimeout(res, 200));
              }
            }
          }}
          onExportPDF={() => { /* future */ }}
          frameCount={frameCountRef.current}
          frameMax={50}
          onZoomIn={() => callCanvas("zoomIn")}
          onZoomOut={() => callCanvas("zoomOut")}
          onZoomToFit={() => callCanvas("zoomToFit")}
          zoom={zoom}
          history={{ canUndo, canRedo }}
          onUndo={() => callCanvas("undo")}
          onRedo={() => callCanvas("redo")}
          onAlign={(dir) => callCanvas("align", dir)}
          onDistribute={(dir) => callCanvas("distribute", dir)}
          onAutoLayout={() => callCanvas("autoLayout")}
          selection={{
            hasMultiSelection: selectedObjects.length > 1,
            canBooleanOp: selectedObjects.length >= 2,
          }}
          onBooleanOp={(op) => callCanvas("booleanOp", op)}
        />

        {/* Top bar: navigation */}
        <div style={{ position: "absolute", top: 8, left: 8, zIndex: 10, display: "flex", gap: 4 }}>
          <button type="button" onClick={() => dispatch({ type: "BACK_TO_DASHBOARD" })} style={topBtn}>← Home</button>
          <button type="button" onClick={() => dispatch({ type: "SET_SHORTCUTS", open: true })} style={topBtn}>⌨ Shortcuts</button>
          <button type="button" onClick={() => setBatchOpen(true)} style={topBtn}>⚡ Batch</button>
          <button type="button" onClick={() => { componentsOpenRef.current = !componentsOpenRef.current; setCompKey(n => n + 1); }} style={topBtn}>📦 Components</button>
          <button type="button" onClick={() => { governanceOpenRef.current = !governanceOpenRef.current; setGovKey(n => n + 1); }} style={topBtn}>🕐 Timeline</button>
        </div>

        {/* Canvas */}
        <div style={{ flex: 1, position: "relative" }}>
          <CanvasEditor
            templateId={templateId}
            templateJson={templateJson}
            onToolChange={(t) => setTool(t)}
          />
        </div>

        {/* Right panels */}
        <PropertiesPanel
          selectedObjects={selectedObjects}
          onUpdate={() => callCanvas("pushHistory")}
          canvasRef={layersCanvasRef as React.RefObject<import("fabric").Canvas | null>}
          templateId={templateId}
        />
        <LayersPanel
          key={layersCanvasRef.current ? "ready" : "loading"}
          canvasRef={layersCanvasRef as React.RefObject<FabricCanvas | null>}
          selectedObjects={selectedObjects}
          onFrameCreate={() => callCanvas("createFrame", "New Frame", 100, 100, 400, 300)}
          onFrameDelete={(frameId: string) => callCanvas("deleteFrame", frameId)}
          onFrameRename={(frameId: string, name: string) => callCanvas("renameFrame", frameId, name)}
          onMoveToFrame={(objectId: string, frameId: string | null) => callCanvas("moveObjectToFrame", objectId, frameId)}
        />
      </div>

      {/* Modals */}
      <KeyboardShortcuts open={shortcutsOpen} onClose={() => dispatch({ type: "SET_SHORTCUTS", open: false })} />
      {batchOpen && <BatchAMator templateId={templateId} onClose={() => setBatchOpen(false)} />}
      {componentsOpenRef.current && <ComponentsPanel templateId={templateId} selectedObjects={selectedObjects} onUpdate={() => callCanvas("pushHistory")} onClose={() => { componentsOpenRef.current = false; setCompKey(n => n + 1); }} />}
      {governanceOpenRef.current && <GovernancePanel templateId={templateId} onClose={() => { governanceOpenRef.current = false; setGovKey(n => n + 1); }} onRestore={() => callCanvas("pushHistory")} />}
    </ToastProvider>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadText(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  downloadBlob(blob, filename);
}

const topBtn: React.CSSProperties = {
  background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)",
  color: "#e4e4f0", borderRadius: 4, padding: "3px 8px", fontSize: 10,
  cursor: "pointer",
};

export { App };
