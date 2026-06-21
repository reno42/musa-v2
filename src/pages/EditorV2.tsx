import React, { useState, useCallback, useEffect, useRef } from "react";
import { CodePanel } from "../components/CodePanel";
import type { CodePanelRef } from "../components/CodePanel";
import { GoogleFontPicker } from "../components/GoogleFontPicker";
import { ElementProperties } from "../components/ElementProperties";
import { InsertToolbar } from "../components/InsertToolbar";
import { ActiveAgentsPanel } from "../components/ActiveAgentsPanel";
import { StructurePanel } from "../components/StructurePanel";
import { VariablesPanel } from "../components/VariablesPanel";
import { BrandPanel } from "../components/BrandPanel";
import { FormatPanel } from "../components/FormatPanel";
import { HtmlToolbar } from "../components/HtmlToolbar";
import { InfiniteHtmlCanvas, type HtmlToolName } from "../components/InfiniteHtmlCanvas";
import type { FrameData, SelectedElementInfo } from "../components/DesignFrame";
import { HtmlContextualPanel } from "../components/HtmlContextualPanel";
import { getTemplate } from "../lib/templateApi";
import { apiFetch } from "../lib/supabase";
import { subscribeTemplate, broadcastChange, subscribePresence } from "../lib/supabaseRealtime";
import { IconArrowLeft } from "../shared/icons";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface EditorV2Props {
  templateId: string;
  onBack: () => void;
}

const FRAME_GAP = 100;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 5;

const DEFAULT_HTML = `<div class="card">
  <h1 data-layer-id="heading">Hello World</h1>
  <p data-layer-id="paragraph">Edit this HTML + CSS in the panel on the left.</p>
</div>`;

const DEFAULT_CSS = `body {
  font-family: 'Inter', system-ui, sans-serif;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  margin: 0;
}

.card {
  background: rgba(255,255,255,0.95);
  border-radius: 16px;
  padding: 40px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  max-width: 480px;
  text-align: center;
}

h1 {
  font-size: 32px;
  font-weight: 700;
  color: #1a1a2e;
  margin: 0 0 16px;
}

p {
  font-size: 16px;
  color: #666;
  line-height: 1.6;
  margin: 0;
}`;

export function EditorV2({ templateId, onBack }: EditorV2Props) {
  // ── Multi-frame state ──
  const [frames, setFrames] = useState<FrameData[]>([]);
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("New Design");
  const [activeTool, setActiveTool] = useState<HtmlToolName>("select");
  const [zoom, setZoom] = useState(0.5);

  // ── Undo/Redo ──
  const undoStack = useRef<FrameData[][]>([]);
  const redoStack = useRef<FrameData[][]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // ── UI state ──
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const codePanelRef = useRef<CodePanelRef>(null);
  const [selectedFont, setSelectedFont] = useState("");
  const [showFontPicker, setShowFontPicker] = useState(false);
  const [activeAgents, setActiveAgents] = useState<{ agentId: string; sectionId: string; onlineAt: string }[]>([]);
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const presenceChannelRef = useRef<RealtimeChannel | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [lastRemoteUpdate, setLastRemoteUpdate] = useState<string | null>(null);

  // ── Selected element (inside a frame) ──
  const [selectedElement, setSelectedElement] = useState<SelectedElementInfo | null>(null);
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<string>("contextual");

  // ── Derived: active frame ──
  const selectedFrame = frames.find(f => f.id === selectedFrameId) ?? null;
  const activeHtml = selectedFrame?.html ?? DEFAULT_HTML;
  const activeCss = selectedFrame?.css ?? DEFAULT_CSS;

  // ── Undo/Redo helpers ──
  const pushUndo = useCallback((current: FrameData[]) => {
    undoStack.current.push(JSON.parse(JSON.stringify(current)));
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  const handleUndo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    const prev = undoStack.current.pop()!;
    redoStack.current.push(JSON.parse(JSON.stringify(frames)));
    setFrames(prev);
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(true);
  }, [frames]);

  const handleRedo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    const next = redoStack.current.pop()!;
    undoStack.current.push(JSON.parse(JSON.stringify(frames)));
    setFrames(next);
    setCanUndo(true);
    setCanRedo(redoStack.current.length > 0);
  }, [frames]);

  // ── Load template → parse into frames ──
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const tpl = await getTemplate(templateId);
        if (cancelled) return;
        if (!tpl) { setError("Template not found"); setLoading(false); return; }
        const t = tpl as any;
        if (t.engine && t.engine !== "html") {
          setError("This template uses the Fabric.js engine. Open it in the Fabric editor.");
          setLoading(false);
          return;
        }
        setTemplateName(t.name || "Untitled");

        // Multi-frame support: if template has frames[], use them
        if (t.frames && Array.isArray(t.frames) && t.frames.length > 0) {
          const loaded: FrameData[] = t.frames.map((f: any, i: number) => ({
            id: f.id || `frame_${i}`,
            name: f.name || `Frame ${i + 1}`,
            x: f.x ?? (i * ((f.width || 1080) + FRAME_GAP)),
            y: f.y ?? 0,
            width: f.width || t.width || 1080,
            height: f.height || t.height || 1080,
            html: f.html || "",
            css: f.css || "",
            background: f.background || "#ffffff",
          }));
          setFrames(loaded);
          setSelectedFrameId(loaded[0]?.id ?? null);
        } else {
          // Legacy: single template → one frame
          const single: FrameData = {
            id: "frame_0",
            name: t.name || "Frame 1",
            x: 0, y: 0,
            width: t.width || 1080,
            height: t.height || 1080,
            html: t.html || DEFAULT_HTML,
            css: t.css || DEFAULT_CSS,
            background: "#ffffff",
          };
          setFrames([single]);
          setSelectedFrameId(single.id);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Failed to load template");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [templateId]);

  // ── Auto-save (debounced 2s) ──
  const autoSave = useCallback((updatedFrames: FrameData[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        // Save frames array + backward-compat single html/css
        const active = updatedFrames.find(f => f.id === selectedFrameId) || updatedFrames[0];
        await apiFetch(`/api/templates/${templateId}`, {
          method: "PUT",
          body: JSON.stringify({
            frames: updatedFrames,
            html: active?.html || "",
            css: active?.css || "",
          }),
        });
        broadcastChange(realtimeChannelRef.current, templateId, active?.html || "", active?.css || "");
      } catch (err) {
        console.warn("[EditorV2] Auto-save failed:", err);
      } finally {
        setSaving(false);
      }
    }, 2000);
  }, [templateId, selectedFrameId]);

  useEffect(() => {
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, []);

  // ── Realtime sync ──
  useEffect(() => {
    const channel = subscribeTemplate(templateId, (newHtml, newCss) => {
      if (!selectedFrameId) return;
      setFrames(prev => prev.map(f =>
        f.id === selectedFrameId
          ? { ...f, html: newHtml || f.html, css: newCss || f.css }
          : f
      ));
    });
    if (channel) {
      realtimeChannelRef.current = channel;
    } else {
      pollingRef.current = setInterval(async () => {
        try {
          const tpl = await getTemplate(templateId);
          if (!tpl) return;
          const t = tpl as any;
          const remoteUpdated = t.metadata?.updatedAt;
          if (remoteUpdated && remoteUpdated !== lastRemoteUpdate) {
            if (lastRemoteUpdate !== null) {
              if (t.frames) {
                setFrames(t.frames);
              } else {
                setFrames(prev => prev.map(f =>
                  f.id === selectedFrameId
                    ? { ...f, html: t.html || f.html, css: t.css || f.css }
                    : f
                ));
              }
            }
            setLastRemoteUpdate(remoteUpdated);
          }
        } catch { /* silent */ }
      }, 5000);
    }
    const pChannel = subscribePresence(templateId, (agents) => setActiveAgents(agents));
    if (pChannel) presenceChannelRef.current = pChannel;
    return () => {
      if (realtimeChannelRef.current) { realtimeChannelRef.current.unsubscribe(); realtimeChannelRef.current = null; }
      if (presenceChannelRef.current) { presenceChannelRef.current.unsubscribe(); presenceChannelRef.current = null; }
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [templateId, selectedFrameId]);

  // ── Code panel handlers (edit active frame) ──
  const handleHtmlChange = useCallback((newHtml: string) => {
    if (!selectedFrameId) return;
    const updated = frames.map(f =>
      f.id === selectedFrameId ? { ...f, html: newHtml } : f
    );
    pushUndo(frames);
    setFrames(updated);
    autoSave(updated);
  }, [selectedFrameId, frames, autoSave, pushUndo]);

  const handleCssChange = useCallback((newCss: string) => {
    if (!selectedFrameId) return;
    const updated = frames.map(f =>
      f.id === selectedFrameId ? { ...f, css: newCss } : f
    );
    pushUndo(frames);
    setFrames(updated);
    autoSave(updated);
  }, [selectedFrameId, frames, autoSave, pushUndo]);

  // ── Frame CSS change from DesignFrame (drag/resize) ──
  const handleFrameCssChange = useCallback((frameId: string, newCss: string) => {
    const updated = frames.map(f =>
      f.id === frameId ? { ...f, css: newCss } : f
    );
    setFrames(updated);
    autoSave(updated);
  }, [frames, autoSave]);

  const handleFrameHtmlChange = useCallback((frameId: string, newHtml: string) => {
    const updated = frames.map(f =>
      f.id === frameId ? { ...f, html: newHtml } : f
    );
    setFrames(updated);
    autoSave(updated);
  }, [frames, autoSave]);

  // ── Frame operations ──
  const addFrame = useCallback((preset: { name: string; width: number; height: number }) => {
    const lastFrame = frames[frames.length - 1];
    const newX = lastFrame ? lastFrame.x + lastFrame.width + FRAME_GAP : 0;
    const newY = lastFrame ? lastFrame.y : 0;
    const newFrame: FrameData = {
      id: `frame_${Date.now()}`,
      name: preset.name,
      x: newX, y: newY,
      width: preset.width, height: preset.height,
      html: `<div class="card">\n  <h1 data-layer-id="title">${preset.name}</h1>\n  <p data-layer-id="desc">Start designing...</p>\n</div>`,
      css: `body {\n  font-family: 'Inter', system-ui, sans-serif;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  width: ${preset.width}px;\n  height: ${preset.height}px;\n  margin: 0;\n  background: #ffffff;\n}\n.card {\n  text-align: center;\n  padding: 40px;\n}\nh1 {\n  font-size: 48px;\n  font-weight: 700;\n  color: #1a1a2e;\n  margin: 0 0 16px;\n}\np {\n  font-size: 20px;\n  color: #666;\n  margin: 0;\n}`,
      background: "#ffffff",
    };
    pushUndo(frames);
    const updated = [...frames, newFrame];
    setFrames(updated);
    setSelectedFrameId(newFrame.id);
    autoSave(updated);
  }, [frames, autoSave, pushUndo]);

  const handleFrameMove = useCallback((id: string, x: number, y: number) => {
    const updated = frames.map(f =>
      f.id === id ? { ...f, x: Math.round(x), y: Math.round(y) } : f
    );
    pushUndo(frames);
    setFrames(updated);
    autoSave(updated);
  }, [frames, autoSave, pushUndo]);

  const deleteSelectedFrame = useCallback(() => {
    if (!selectedFrameId || frames.length <= 1) return;
    pushUndo(frames);
    const updated = frames.filter(f => f.id !== selectedFrameId);
    setFrames(updated);
    setSelectedFrameId(updated[0]?.id ?? null);
    autoSave(updated);
  }, [selectedFrameId, frames, autoSave, pushUndo]);

  const duplicateFrame = useCallback(() => {
    const src = frames.find(f => f.id === selectedFrameId);
    if (!src) return;
    const clone: FrameData = {
      ...src,
      id: `frame_${Date.now()}`,
      name: `${src.name} (copy)`,
      x: src.x + src.width + FRAME_GAP,
    };
    pushUndo(frames);
    const updated = [...frames, clone];
    setFrames(updated);
    setSelectedFrameId(clone.id);
    autoSave(updated);
  }, [selectedFrameId, frames, autoSave, pushUndo]);

  // ── Zoom helpers ──
  const handleZoomIn = useCallback(() => setZoom(z => Math.min(MAX_ZOOM, z + 0.1)), []);
  const handleZoomOut = useCallback(() => setZoom(z => Math.max(MIN_ZOOM, z - 0.1)), []);
  const handleZoomToFit = useCallback(() => {
    const el = document.getElementById("canvas-container");
    if (!el || frames.length === 0) return;
    const b = frames.reduce(
      (a, f) => ({
        minX: Math.min(a.minX, f.x), minY: Math.min(a.minY, f.y),
        maxX: Math.max(a.maxX, f.x + f.width), maxY: Math.max(a.maxY, f.y + f.height),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    const bw = b.maxX - b.minX + 200;
    const bh = b.maxY - b.minY + 200;
    const cw = el.clientWidth - 32;
    const ch = el.clientHeight - 32;
    setZoom(Math.round(Math.min(cw / bw, ch / bh, 1) * 100) / 100);
  }, [frames]);

  // ── Font select ──
  const handleFontSelect = useCallback((fontFamily: string) => {
    if (!fontFamily || !selectedFrameId) return;
    setSelectedFont(fontFamily);
    setShowFontPicker(false);
    const fontUrl = fontFamily.replace(/ /g, "+");
    const importLine = `@import url('https://fonts.googleapis.com/css2?family=${fontUrl}:wght@400;700&display=swap');\n`;
    let newCss = activeCss;
    if (!newCss.includes(fontUrl)) newCss = importLine + newCss;
    const snippet = `\n/* Suggested: font-family: '${fontFamily}', sans-serif; */\n`;
    if (!newCss.includes(`'${fontFamily}'`)) newCss += snippet;
    handleCssChange(newCss);
  }, [activeCss, selectedFrameId, handleCssChange]);

  // ── Element selection from DesignFrame ──
  const handleElementSelect = useCallback((info: SelectedElementInfo | null) => {
    setSelectedElement(info);
    if (info) setShowRightPanel(true);
  }, []);

  // ── Contextual panel CSS change ──
  const handleContextualCssChange = useCallback((newCss: string) => {
    handleCssChange(newCss);
  }, [handleCssChange]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isInput = ["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName);
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "z" && !e.shiftKey) { e.preventDefault(); handleUndo(); return; }
      if (mod && (e.key === "Z" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); handleRedo(); return; }
      if (!isInput && !mod) {
        switch (e.key.toLowerCase()) {
          case "v": setActiveTool("select"); break;
          case "h": setActiveTool("hand"); break;
          case "delete":
          case "backspace":
            if (selectedFrameId && frames.length > 1) deleteSelectedFrame();
            break;
          case "d":
            if (mod) { e.preventDefault(); duplicateFrame(); }
            break;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleUndo, handleRedo, deleteSelectedFrame, duplicateFrame, selectedFrameId, frames.length]);

  // ── Export ──
  const handleExportPNG = useCallback(() => {
    window.open(`/api/templates/${templateId}/render`, "_blank");
  }, [templateId]);

  const handleExportJSON = useCallback(async () => {
    const tpl = await getTemplate(templateId);
    if (tpl) {
      const blob = new Blob([JSON.stringify({ ...tpl, frames }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${templateName}.futuraria.json`;
      a.click(); URL.revokeObjectURL(url);
    }
  }, [templateId, templateName, frames]);

  // ── Styles ──
  const containerStyle: React.CSSProperties = {
    display: "flex", flexDirection: "column",
    height: "100vh", width: "100vw",
    background: "#0d0d1a", color: "#e0e0e0",
    fontFamily: "'Inter', system-ui, sans-serif", overflow: "hidden",
  };
  const topBarStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 12,
    padding: "8px 16px",
    background: "rgba(18,18,36,0.9)",
    borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0,
  };
  const btnStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.06)", color: "#e0e0e0",
    border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6,
    padding: "6px 12px", cursor: "pointer", fontSize: 13, fontFamily: "inherit",
    display: "flex", alignItems: "center", gap: 4,
  };
  const mainStyle: React.CSSProperties = { display: "flex", flex: 1, overflow: "hidden" };
  const codePanelStyle: React.CSSProperties = { width: 400, flexShrink: 0, height: "100%", padding: 8 };

  // ── Loading / Error ──
  if (loading) {
    return (
      <div style={{ ...containerStyle, alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#888", fontSize: 16 }}>Loading template...</div>
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ ...containerStyle, alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: "#f87171", fontSize: 16, marginBottom: 12 }}>{error}</div>
          <button type="button" onClick={onBack} style={btnStyle}>
            <IconArrowLeft size={14} /> Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {/* Top Bar */}
      <div style={topBarStyle}>
        <button type="button" onClick={onBack} style={btnStyle}>
          <IconArrowLeft size={14} /> Dashboard
        </button>
        <span style={{ fontSize: 15, fontWeight: 600, color: "#e0e0e0" }}>{templateName}</span>
        {selectedFrame && (
          <span style={{ fontSize: 11, color: "#888", marginLeft: 8 }}>
            {selectedFrame.name} &middot; {selectedFrame.width}x{selectedFrame.height}
          </span>
        )}
        {saving && <span style={{ fontSize: 11, color: "#60a5fa", marginLeft: 8 }}>Saving...</span>}
        {activeAgents.length > 0 && (
          <span style={{ fontSize: 11, color: "#4ade80", marginLeft: 8, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", display: "inline-block" }} />
            {activeAgents.length} active
          </span>
        )}
        <div style={{ flex: 1 }} />
        {/* Right panel tabs */}
        <button type="button" onClick={() => { setShowRightPanel(!showRightPanel || rightPanelTab !== "contextual"); setRightPanelTab("contextual"); }} style={{ ...btnStyle, background: showRightPanel && rightPanelTab === "contextual" ? "#3B82F6" : "rgba(255,255,255,0.06)" }}>Props</button>
        <button type="button" onClick={() => { setShowRightPanel(!showRightPanel || rightPanelTab !== "structure"); setRightPanelTab("structure"); }} style={{ ...btnStyle, background: showRightPanel && rightPanelTab === "structure" ? "#3B82F6" : "rgba(255,255,255,0.06)" }}>Struct</button>
        <button type="button" onClick={() => { setShowRightPanel(!showRightPanel || rightPanelTab !== "vars"); setRightPanelTab("vars"); }} style={{ ...btnStyle, background: showRightPanel && rightPanelTab === "vars" ? "#3B82F6" : "rgba(255,255,255,0.06)" }}>Vars</button>
        <button type="button" onClick={() => { setShowRightPanel(!showRightPanel || rightPanelTab !== "brand"); setRightPanelTab("brand"); }} style={{ ...btnStyle, background: showRightPanel && rightPanelTab === "brand" ? "#3B82F6" : "rgba(255,255,255,0.06)" }}>Brand</button>
        <button type="button" onClick={() => { setShowRightPanel(!showRightPanel || rightPanelTab !== "format"); setRightPanelTab("format"); }} style={{ ...btnStyle, background: showRightPanel && rightPanelTab === "format" ? "#3B82F6" : "rgba(255,255,255,0.06)" }}>Format</button>
        <button type="button" onClick={() => { setShowRightPanel(!showRightPanel || rightPanelTab !== "agents"); setRightPanelTab("agents"); }} style={{ ...btnStyle, background: showRightPanel && rightPanelTab === "agents" ? "#3B82F6" : "rgba(255,255,255,0.06)" }}>Agents</button>
        <button type="button" onClick={() => setShowFontPicker(!showFontPicker)} style={{ ...btnStyle, background: showFontPicker ? "#3B82F6" : "rgba(255,255,255,0.06)" }}>Fonts</button>
        <button type="button" onClick={handleExportPNG} style={btnStyle}>PNG</button>
        <button type="button" onClick={handleExportJSON} style={btnStyle}>JSON</button>
        {/* Frame actions */}
        <button type="button" onClick={duplicateFrame} style={{ ...btnStyle, fontSize: 10 }} title="Duplicate frame (Ctrl+D)">Dup</button>
        <button type="button" onClick={deleteSelectedFrame} style={{ ...btnStyle, fontSize: 10, color: frames.length > 1 ? "#f87171" : "#666" }} disabled={frames.length <= 1} title="Delete frame (Del)">Del</button>
      </div>

      {/* Font Picker Dropdown */}
      {showFontPicker && (
        <div style={{
          position: "absolute", top: 44, right: 8, zIndex: 50,
          background: "rgba(18,18,36,0.95)", borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.1)", padding: 8,
          maxHeight: 360, overflow: "auto", minWidth: 240,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}>
          <GoogleFontPicker value={selectedFont} onChange={handleFontSelect} />
        </div>
      )}

      {/* Toolbar (Select, Hand, Frame presets, Zoom) */}
      <HtmlToolbar
        tool={activeTool}
        onToolChange={setActiveTool}
        onAddFrame={addFrame}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomToFit={handleZoomToFit}
        zoom={zoom}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        saving={saving}
      />

      {/* Insert Toolbar (HTML elements) */}
      <InsertToolbar templateId={templateId} onHtmlUpdated={(h, c) => {
        if (!selectedFrameId) return;
        const updated = frames.map(f =>
          f.id === selectedFrameId ? { ...f, html: h, css: c } : f
        );
        setFrames(updated);
        autoSave(updated);
      }} />

      {/* Main: Code Panel + Infinite Canvas + Properties */}
      <div style={mainStyle}>
        <div style={codePanelStyle}>
          <CodePanel
            ref={codePanelRef}
            html={activeHtml}
            css={activeCss}
            onHtmlChange={handleHtmlChange}
            onCssChange={handleCssChange}
          />
        </div>

        {/* Infinite Canvas (the desk) */}
        <div id="canvas-container" style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <InfiniteHtmlCanvas
            frames={frames}
            selectedFrameId={selectedFrameId}
            activeTool={activeTool}
            zoom={zoom}
            onSelectFrame={setSelectedFrameId}
            onZoomChange={setZoom}
            onFrameMove={handleFrameMove}
            onElementSelect={handleElementSelect}
            onFrameCssChange={handleFrameCssChange}
            onFrameHtmlChange={handleFrameHtmlChange}
          />
        </div>

        {/* Right Panel */}
        {showRightPanel && (
          <div style={{ width: 270, flexShrink: 0, height: "100%", padding: 8, overflow: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
            {rightPanelTab === "contextual" && (
              <HtmlContextualPanel
                element={selectedElement}
                css={activeCss}
                onCssChange={handleContextualCssChange}
              />
            )}
            {rightPanelTab === "structure" && (
              <StructurePanel templateId={templateId} onSelectElement={(id) => {
                const el = document.querySelector(`[data-layer-id="${id}"]`);
                if (el) (el as HTMLElement).click();
              }} />
            )}
            {rightPanelTab === "vars" && (
              <VariablesPanel templateId={templateId} onCssUpdated={(c) => handleCssChange(c)} />
            )}
            {rightPanelTab === "brand" && (
              <BrandPanel templateId={templateId} onCssUpdated={(c) => handleCssChange(c)} />
            )}
            {rightPanelTab === "format" && (
              <FormatPanel templateId={templateId} width={selectedFrame?.width ?? 1080} height={selectedFrame?.height ?? 1080} onTemplateCreated={(id) => {
                window.open(`/?template=${id}&v=2`, "_blank");
              }} />
            )}
            {rightPanelTab === "agents" && (
              <ActiveAgentsPanel agents={activeAgents} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
