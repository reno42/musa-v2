import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import html2canvas from "html2canvas";
import { CodePanel } from "../components/CodePanel";
import type { CodePanelRef } from "../components/CodePanel";
import { GoogleFontPicker } from "../components/GoogleFontPicker";
import { ActiveAgentsPanel } from "../components/ActiveAgentsPanel";
import { StructurePanel } from "../components/StructurePanel";
import { VariablesPanel } from "../components/VariablesPanel";
import { BrandPanel } from "../components/BrandPanel";
import { StyleLibraryModal } from "../components/StyleLibraryModal";
import { FormatPanel } from "../components/FormatPanel";
import { FloatingToolbar } from "../components/FloatingToolbar";
import { InfiniteHtmlCanvas, type HtmlToolName } from "../components/InfiniteHtmlCanvas";
import type { FrameData, LayerSelectionRequest, SelectedElementInfo } from "../components/DesignFrame";
import { HtmlContextualPanel } from "../components/HtmlContextualPanel";
import { HtmlLayersPanel } from "../components/HtmlLayersPanel";
import { ImageUploadModal } from "../components/ImageUploadModal";
import { SvgImportDialog, type RasterImageImport } from "../components/SvgImportDialog";
import { InsertToolbar } from "../components/InsertToolbar";
import { VersionHistoryPanel } from "../components/VersionHistoryPanel";
import { useDockablePanel } from "../hooks/useDockablePanel";
import { getTemplate, saveLocal } from "../lib/templateApi";
import { apiFetch } from "../lib/supabase";
import { mcpCall } from "../lib/mcpClient";
import { subscribeTemplate, broadcastChange, subscribePresence } from "../lib/supabaseRealtime";
import {
  appendCssOverride,
  cloneLayerCss,
  cloneLayerTreeCss,
  filterCssDeclarations,
  getCssPropertyValue,
  getExactRuleDeclarations,
  getLayerIdsWithDeclaration,
  mergeCssRules,
  parseCssDeclarations,
  removeLayerCss,
  removeLayersCss,
  removeCssOverride,
  updateCssProperty,
} from "../lib/cssMutations";
import {
  changeLayerTag,
  createLayerId,
  deleteLayerFromHtml,
  duplicateLayerInHtml,
  ensureLayerIds,
  extractLayerFromHtml,
  insertLayerIntoHtml,
  pasteLayerFromHtml,
  remapLayerTreeForTarget,
  reparentLayerInHtml,
  replaceLayerPathData,
  replaceLayerText,
  type LayerDropPlacement,
  type LayerStackChange,
  type LayerStackPlacement,
} from "../lib/htmlMutations";
import { ensureGoogleFontImport, injectGoogleFontIntoFrames } from "../lib/googleFonts";
import {
  persistDesignClipboard,
  readDesignClipboard,
  type DesignClipboard,
} from "../lib/designClipboard";
import { analyzePathData } from "../lib/pathData";
import { useToast } from "../components/Toast";
import {
  IconArrowLeft, IconSliders, IconLayout, IconDna, IconPalette,
  IconFile, IconBot, IconType, IconImage, IconCopy, IconTrash,
  IconDownload, IconTag,
  IconPointer, IconHand, IconZoomIn, IconZoomOut, IconMaximize,
  IconRectangle, IconCircleOutline, IconPen, IconPlus, IconChevronDown,
  IconAlignLeft, IconAlignCenter, IconAlignRight,
  IconHistory, IconWand, IconRefresh, IconGrid,
  IconUpload, IconSparkle, IconLink,
} from "../shared/icons";
import type { RealtimeChannel } from "@supabase/supabase-js";

// Deterministic hash for content change tracking (client-side, no crypto dependency)
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

interface EditorV2Props {
  templateId: string;
  onBack: () => void;
}

const FRAME_GAP = 100;
const BUILD_VERSION = "persist-fix-v4-2026-06-30";
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 5;

let generatedFrameSequence = 0;
function createFrameId(): string {
  generatedFrameSequence++;
  return `frame_${Date.now().toString(36)}_${generatedFrameSequence.toString(36)}`;
}

function nextFrameNumber(frames: FrameData[]): number {
  return frames.reduce((highest, frame) => {
    const match = /^Frame\s+(\d+)$/i.exec(frame.name.trim());
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0) + 1;
}

function cloneFrame(source: FrameData, x: number, y: number, name: string): FrameData {
  return {
    ...source,
    id: createFrameId(),
    name,
    x: Math.round(x),
    y: Math.round(y),
  };
}

function applyLayerStack(css: string, siblingLayerIds: string[]): string {
  return siblingLayerIds.reduce((updated, layerId, index) => updateCssProperty(
    updated,
    `[data-layer-id="${layerId}"]`,
    "z-index",
    `${index + 1} !important`,
  ), css);
}

function parseTranslate(value: string): { x: number; y: number } {
  if (!value || value === "none") return { x: 0, y: 0 };
  const parts = value.split(/\s+/).map(part => parseFloat(part) || 0);
  return { x: parts[0] || 0, y: parts[1] || 0 };
}

function snapshotFrames(frames: FrameData[]): FrameData[] {
  return frames.map(frame => ({ ...frame }));
}

function frameSnapshotsMatch(first: FrameData[], second: FrameData[]): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

interface PenStyle {
  fill: string;
  stroke: string;
  strokeWidth: string;
  strokeLinecap: string;
  strokeLinejoin: string;
  strokeDasharray: string;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches("input, textarea, select, [contenteditable='true']") || target.isContentEditable;
}

const GEOMETRY_PROPERTIES = new Set([
  "position", "top", "right", "bottom", "left", "z-index",
  "width", "height", "min-width", "min-height", "max-width", "max-height",
  "display", "transform", "transform-origin", "translate", "scale",
]);

const COPY_STYLE_PROPERTIES = new Set([
  "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing",
  "text-align", "text-decoration", "text-transform", "color", "opacity",
  "background", "background-color", "background-image", "background-size", "background-position", "background-repeat",
  "border", "border-width", "border-style", "border-color", "border-radius",
  "box-shadow", "text-shadow", "filter", "backdrop-filter", "mix-blend-mode",
]);

const elemBtnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)", color: "#ccc",
  border: "1px solid rgba(255,255,255,0.08)", borderRadius: 4,
  padding: "3px 8px", fontSize: 11, cursor: "pointer",
  fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center",
  minWidth: 28, minHeight: 24,
};
const sepStyle: React.CSSProperties = {
  width: 1, height: 20, background: "rgba(255,255,255,0.08)", margin: "0 4px",
};

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
  const { addToast } = useToast();
  // ── Multi-frame state ──
  const [frames, setFrames] = useState<FrameData[]>([]);
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("New Design");
  const [templateWorkspaceId, setTemplateWorkspaceId] = useState("default");
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
  const retryCountRef = useRef(0);
  const lastPushTimeRef = useRef(0);
  const codePanelRef = useRef<CodePanelRef>(null);
  const [selectedFont, setSelectedFont] = useState("");
  const [showFontPicker, setShowFontPicker] = useState(false);
  const [editingFrameName, setEditingFrameName] = useState<string | null>(null);
  const frameNameInputRef = useRef<HTMLInputElement>(null);
  const [editingTemplateName, setEditingTemplateName] = useState<string | null>(null);
  const templateNameInputRef = useRef<HTMLInputElement>(null);
  const [activeAgents, setActiveAgents] = useState<{ agentId: string; sectionId: string; onlineAt: string }[]>([]);
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const presenceChannelRef = useRef<RealtimeChannel | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [lastRemoteUpdate, setLastRemoteUpdate] = useState<string | null>(null);
  const isDirtyRef = useRef(false);
  const autoSaveRef = useRef<(frames: FrameData[]) => void>(() => {});
  const framesRef = useRef(frames);
  framesRef.current = frames;
  const lastPenStyleRef = useRef<PenStyle>({
    fill: "none",
    stroke: "#111827",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeDasharray: "none",
  });

  // ── Selected element (inside a frame) ──
  const [selectedElement, setSelectedElement] = useState<SelectedElementInfo | null>(null);
  const [layerSelectionRequest, setLayerSelectionRequest] = useState<LayerSelectionRequest | null>(null);
  const layerSelectionSequenceRef = useRef(0);
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<string>("contextual");
  const [multiSelectLayerIds, setMultiSelectLayerIds] = useState<string[]>([]);
  const [showSvgImport, setShowSvgImport] = useState(false);
  const [showStyleLibrary, setShowStyleLibrary] = useState(false);

  // ── Figma-style selection state ──
  const [selectedFrameIds, setSelectedFrameIds] = useState<Set<string>>(new Set());
  const [contentFrameId, setContentFrameId] = useState<string | null>(null);

  // ── Derived: active frame ──
  const selectedFrame = frames.find(f => f.id === selectedFrameId) ?? null;
  const activeHtml = selectedFrame?.html ?? DEFAULT_HTML;
  const activeCss = selectedFrame?.css ?? DEFAULT_CSS;

  // ── Undo/Redo helpers ──
  const pushUndo = useCallback((current: FrameData[]) => {
    const snapshot = snapshotFrames(current);
    const previous = undoStack.current[undoStack.current.length - 1];
    if (previous && frameSnapshotsMatch(previous, snapshot)) return;
    undoStack.current.push(snapshot);
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  const handleUndo = useCallback(() => {
    if (undoStack.current.length === 0) {
      return;
    }
    const prev = undoStack.current.pop()!;
    redoStack.current.push(snapshotFrames(framesRef.current));
    setFrames(prev);
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(true);
    lastPushTimeRef.current = 0;
    setSelectedElement(null);
    setContentFrameId(current => current && prev.some(frame => frame.id === current) ? current : null);
    setSelectedFrameId(current => current && prev.some(frame => frame.id === current) ? current : prev[0]?.id || null);
    setSelectedFrameIds(current => {
      const valid = new Set([...current].filter(id => prev.some(frame => frame.id === id)));
      if (valid.size === 0 && prev[0]) valid.add(prev[0].id);
      return valid;
    });
    isDirtyRef.current = true;
    autoSaveRef.current(prev);
  }, []);

  const handleRedo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    const next = redoStack.current.pop()!;
    undoStack.current.push(snapshotFrames(framesRef.current));
    setFrames(next);
    setCanUndo(true);
    setCanRedo(redoStack.current.length > 0);
    lastPushTimeRef.current = 0;
    setSelectedElement(null);
    setContentFrameId(current => current && next.some(frame => frame.id === current) ? current : null);
    setSelectedFrameId(current => current && next.some(frame => frame.id === current) ? current : next[0]?.id || null);
    setSelectedFrameIds(current => {
      const valid = new Set([...current].filter(id => next.some(frame => frame.id === id)));
      if (valid.size === 0 && next[0]) valid.add(next[0].id);
      return valid;
    });
    isDirtyRef.current = true;
    autoSaveRef.current(next);
  }, []);

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
          setError("This template uses an unsupported engine. Only HTML templates are supported.");
          setLoading(false);
          return;
        }
        setTemplateName(t.name || "Untitled");
        if (t.workspaceId) setTemplateWorkspaceId(t.workspaceId);

        // Multi-frame support: if template has frames[], use them
        if (t.frames && Array.isArray(t.frames) && t.frames.length > 0) {
          const loaded: FrameData[] = t.frames.map((f: any, i: number) => ({
            id: f.id || `frame_${i}`,
            name: f.name || `Frame ${i + 1}`,
            x: f.x ?? (i * ((f.width || 1080) + FRAME_GAP)),
            y: f.y ?? 0,
            width: f.width || t.width || 1080,
            height: f.height || t.height || 1080,
            html: ensureLayerIds(f.html || "", createLayerId),
            css: f.css || "",
            background: f.background || "#ffffff",
          }));
          setFrames(loaded);
          setSelectedFrameId(loaded[0]?.id ?? null);
          // Loaded data is the baseline, not an undoable user action.
          undoStack.current = [];
          redoStack.current = [];
          lastPushTimeRef.current = 0;
          setCanUndo(false);
          setCanRedo(false);
        } else {
          // Legacy: single template → one frame
          const single: FrameData = {
            id: "frame_0",
            name: t.name || "Frame 1",
            x: 0, y: 0,
            width: t.width || 1080,
            height: t.height || 1080,
            html: ensureLayerIds(t.html || DEFAULT_HTML, createLayerId),
            css: t.css || DEFAULT_CSS,
            background: "#ffffff",
          };
          setFrames([single]);
          setSelectedFrameId(single.id);
          // Loaded data is the baseline, not an undoable user action.
          undoStack.current = [];
          redoStack.current = [];
          lastPushTimeRef.current = 0;
          setCanUndo(false);
          setCanRedo(false);
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

  // ── Auto-save (immediate localStorage, debounced API sync) ──
  const autoSave = useCallback((updatedFrames: FrameData[]) => {
    const active = updatedFrames.find(f => f.id === selectedFrameId) || updatedFrames[0];

    // Compute content hash + attribution for change tracking
    const hashedFrames = updatedFrames.map(f => ({
      ...f,
      contentHash: simpleHash((f.html || "") + "||" + (f.css || "")),
      lastModifiedBy: "human",
      lastModifiedAt: new Date().toISOString(),
    }));

    const payload = {
      frames: hashedFrames,
      html: active?.html || "",
      css: active?.css || "",
      name: templateName,
    };

    // ✅ Immediate localStorage write (synchronous — survives refresh/tab close)
    try {
      saveLocal(templateId, payload);
    } catch (localErr) {
      console.error("[SAVE] localStorage FAILED:", localErr);
      addToast("Error crítico: no se pudo guardar localmente. Verifica el espacio disponible.", "error", true);
    }

    // ✅ Mark as dirty so polling won't overwrite our state
    isDirtyRef.current = true;

    // ✅ Debounced API sync (2s)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true);

      // Sync to API + Supabase with exponential-backoff retry (max 3 attempts)
      const MAX_RETRIES = 3;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const putRes = await apiFetch(`/api/templates/${templateId}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });
          broadcastChange(realtimeChannelRef.current, templateId, active?.id || "", active?.html || "", active?.css || "");
          lastBroadcastRef.current = { html: active?.html || "", css: active?.css || "" };
          retryCountRef.current = 0;
          isDirtyRef.current = false;
          break;
        } catch (err) {
          console.error(`[SAVE] API PUT attempt ${attempt + 1}/${MAX_RETRIES + 1} FAILED:`, err);
          retryCountRef.current = attempt + 1;
          if (attempt < MAX_RETRIES) {
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise(r => setTimeout(r, delay));
          } else {
            console.error("[SAVE] Auto-save exhausted retries (cached in localStorage):", err);
            addToast("No se pudieron sincronizar los cambios con el servidor. Guardados localmente.", "error");
          }
        }
      }
      setSaving(false);
    }, 2000);
  }, [templateId, selectedFrameId, templateName, addToast]);

  // Keep autoSaveRef in sync so undo/redo can call the latest version
  autoSaveRef.current = autoSave;

  useEffect(() => {
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, []);

  // ── Realtime sync ──
  const realtimeReadyRef = useRef(false);
  const lastBroadcastRef = useRef<{ html: string; css: string } | null>(null);

  useEffect(() => {
    realtimeReadyRef.current = false; // Reset on re-mount
    const channel = subscribeTemplate(templateId, (remoteFrameId, newHtml, newCss) => {
      // Skip the initial callback fired when the channel is first joined
      if (!realtimeReadyRef.current) {
        realtimeReadyRef.current = true;
        return;
      }
      const targetFrameId = remoteFrameId || selectedFrameId;
      if (!targetFrameId) return;
      // Ignore our own broadcasts
      if (lastBroadcastRef.current &&
          lastBroadcastRef.current.html === newHtml &&
          lastBroadcastRef.current.css === newCss) {
        return;
      }
      setFrames(prev => prev.map(f =>
        f.id === targetFrameId
          ? { ...f, html: newHtml, css: newCss }
          : f
      ));
    });
    if (channel) {
      realtimeChannelRef.current = channel;
    } else {
      pollingRef.current = setInterval(async () => {
        // ✅ Guard: skip polling entirely if we have unsaved local changes
        if (isDirtyRef.current) {
          return;
        }
        try {
          const tpl = await getTemplate(templateId);
          if (!tpl) return;
          const t = tpl as any;
          const remoteUpdated = t.metadata?.updatedAt;
          if (remoteUpdated && remoteUpdated !== lastRemoteUpdate) {
            if (lastRemoteUpdate !== null) {
              // Safety: never replace non-empty local frames with empty remote frames
              if (t.frames && Array.isArray(t.frames) && t.frames.length > 0) {
                // Only update if frame data actually differs (avoid unnecessary re-renders)
                const localJson = JSON.stringify(framesRef.current);
                const remoteJson = JSON.stringify(t.frames);
                if (localJson !== remoteJson) {
                  setFrames(t.frames);
                }
              } else if (framesRef.current.length > 0 && (!t.frames || t.frames.length === 0)) {
                // Remote has no frames but we do → re-save our frames as recovery
                autoSave(framesRef.current);
              } else if (t.html !== undefined || t.css !== undefined) {
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
    // Coalesce: only push undo if >800ms since last push (avoids one-undo-per-keystroke)
    const now = Date.now();
    if (now - lastPushTimeRef.current > 800) {
      pushUndo(frames);
      lastPushTimeRef.current = now;
    }
    setFrames(updated);
    autoSave(updated);
  }, [selectedFrameId, frames, autoSave, pushUndo]);

  const handleCssChange = useCallback((newCss: string) => {
    if (!selectedFrameId) return;
    const updated = frames.map(f =>
      f.id === selectedFrameId ? { ...f, css: newCss } : f
    );
    const now = Date.now();
    if (now - lastPushTimeRef.current > 800) {
      pushUndo(frames);
      lastPushTimeRef.current = now;
    }
    setFrames(updated);
    autoSave(updated);
  }, [selectedFrameId, frames, autoSave, pushUndo]);

  // ── Frame CSS (+ optional HTML) change from DesignFrame (drag/resize) ──
  const handleFrameCssChange = useCallback((frameId: string, newCss: string, newHtml?: string) => {
    const updated = frames.map(f =>
      f.id === frameId ? { ...f, css: newCss, ...(newHtml ? { html: newHtml } : {}) } : f
    );
    pushUndo(frames);
    setFrames(updated);
    autoSave(updated);
  }, [frames, autoSave, pushUndo]);

  const handleFrameHtmlChange = useCallback((frameId: string, newHtml: string) => {
    const updated = frames.map(f =>
      f.id === frameId ? { ...f, html: newHtml } : f
    );
    pushUndo(frames);
    setFrames(updated);
    autoSave(updated);
  }, [frames, autoSave, pushUndo]);

  // ── Figma-style frame selection handlers ──
  const handleSelectFrame = useCallback((id: string | null) => {
    setSelectedFrameId(id);
    setSelectedFrameIds(id ? new Set([id]) : new Set());
    setContentFrameId(null);
    setSelectedElement(null);
    setLayerSelectionRequest(null);
  }, []);

  const handleActivateFrame = useCallback((frameId: string) => {
    setSelectedFrameId(frameId);
  }, []);

  const handleFrameShiftClick = useCallback((frameId: string) => {
    setSelectedFrameIds(prev => {
      const next = new Set(prev);
      if (next.has(frameId)) next.delete(frameId);
      else next.add(frameId);
      if (next.size === 1) setSelectedFrameId(Array.from(next)[0]);
      else if (next.size === 0) setSelectedFrameId(null);
      return next;
    });
    setContentFrameId(null);
    setSelectedElement(null);
  }, []);

  const handleMarqueeSelect = useCallback((ids: Set<string>) => {
    setSelectedFrameIds(ids);
    if (ids.size > 0) setSelectedFrameId(Array.from(ids)[0]);
    else setSelectedFrameId(null);
    setContentFrameId(null);
    setSelectedElement(null);
  }, []);

  const handleEnterContentMode = useCallback((frameId: string) => {
    setContentFrameId(frameId);
    setSelectedFrameId(frameId);
    setSelectedFrameIds(new Set([frameId]));
  }, []);

  const handleRenameFrame = useCallback((frameId: string, newName: string) => {
    pushUndo(frames);
    const updated = frames.map(f => f.id === frameId ? { ...f, name: newName } : f);
    setFrames(updated);
    autoSave(updated);
  }, [frames, autoSave, pushUndo]);

  const handleMultiFrameMove = useCallback((moves: { id: string; x: number; y: number }[]) => {
    pushUndo(frames);
    const moveMap = new Map(moves.map(m => [m.id, { x: m.x, y: m.y }]));
    const updated = frames.map(f =>
      moveMap.has(f.id) ? { ...f, x: moveMap.get(f.id)!.x, y: moveMap.get(f.id)!.y } : f
    );
    setFrames(updated);
    autoSave(updated);
  }, [frames, autoSave, pushUndo]);

  // ── Frame operations ──
  const addFrame = useCallback((preset: { name: string; width: number; height: number }) => {
    const lastFrame = frames[frames.length - 1];
    const newX = lastFrame ? lastFrame.x + lastFrame.width + FRAME_GAP : 0;
    const newY = lastFrame ? lastFrame.y : 0;
    const newFrame: FrameData = {
      id: createFrameId(),
      name: `Frame ${nextFrameNumber(frames)}`,
      x: newX, y: newY,
      width: preset.width, height: preset.height,
      html: `<div class="card" data-layer-id="card">\n  <h1 data-layer-id="title">${preset.name}</h1>\n  <p data-layer-id="desc">Start designing...</p>\n</div>`,
      css: `body {\n  font-family: 'Inter', system-ui, sans-serif;\n  position: relative;\n  width: ${preset.width}px;\n  height: ${preset.height}px;\n  margin: 0;\n  background: #ffffff;\n  overflow: hidden;\n}\n.card {\n  position: absolute;\n  left: 50%;\n  top: 50%;\n  transform: translate(-50%, -50%);\n  text-align: center;\n  padding: 40px;\n}\nh1 {\n  font-size: 48px;\n  font-weight: 700;\n  color: #1a1a2e;\n  margin: 0 0 16px;\n}\np {\n  font-size: 20px;\n  color: #666;\n  margin: 0;\n}`,
      background: "#ffffff",
    };
    pushUndo(frames);
    const updated = [...frames, newFrame];
    setFrames(updated);
    setSelectedFrameId(newFrame.id);
    setSelectedFrameIds(new Set([newFrame.id]));
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

  const handleFrameResize = useCallback((id: string, width: number, height: number, x: number, y: number) => {
    const updated = frames.map(f =>
      f.id === id ? { ...f, x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) } : f
    );
    pushUndo(frames);
    setFrames(updated);
    autoSave(updated);
  }, [frames, autoSave, pushUndo]);

  const deleteFrames = useCallback((frameIds: Set<string>): boolean => {
    if (frameIds.size === 0) return false;
    const updated = frames.filter(frame => !frameIds.has(frame.id));
    if (updated.length === 0 || updated.length === frames.length) return false;

    pushUndo(frames);
    setFrames(updated);
    setSelectedFrameId(updated[0]?.id ?? null);
    setSelectedFrameIds(updated[0]?.id ? new Set([updated[0].id]) : new Set());
    setContentFrameId(null);
    setSelectedElement(null);
    setLayerSelectionRequest(null);
    autoSave(updated);
    return true;
  }, [frames, autoSave, pushUndo]);

  const deleteSelectedFrame = useCallback(() => {
    if (!selectedFrameId) return;
    deleteFrames(new Set([selectedFrameId]));
  }, [selectedFrameId, deleteFrames]);

  const duplicateFrame = useCallback(() => {
    const src = frames.find(f => f.id === selectedFrameId);
    if (!src) return;
    const clone = cloneFrame(src, src.x + src.width + FRAME_GAP, src.y, `Frame ${nextFrameNumber(frames)}`);
    pushUndo(frames);
    const updated = [...frames, clone];
    setFrames(updated);
    setSelectedFrameId(clone.id);
    setSelectedFrameIds(new Set([clone.id]));
    setContentFrameId(null);
    setSelectedElement(null);
    autoSave(updated);
  }, [selectedFrameId, frames, autoSave, pushUndo]);

  const handleDuplicateFramesAtPositions = useCallback((copies: { sourceId: string; x: number; y: number }[]) => {
    if (copies.length === 0) return;
    let frameNumber = nextFrameNumber(frames);
    const clones = copies.flatMap(({ sourceId, x, y }) => {
      const source = frames.find(frame => frame.id === sourceId);
      if (!source) return [];
      return [cloneFrame(source, x, y, `Frame ${frameNumber++}`)];
    });
    if (clones.length === 0) return;

    pushUndo(frames);
    const updated = [...frames, ...clones];
    setFrames(updated);
    setSelectedFrameId(clones[0].id);
    setSelectedFrameIds(new Set(clones.map(frame => frame.id)));
    setSelectedElement(null);
    autoSave(updated);
  }, [frames, autoSave, pushUndo]);

  const handleLayerStackChange = useCallback((frameId: string, change: LayerStackChange) => {
    const frame = frames.find(item => item.id === frameId);
    if (!frame) return;

    const stackedCss = applyLayerStack(frame.css, change.siblingLayerIds);
    const updated = frames.map(item => item.id === frameId
      ? { ...item, html: change.html, css: stackedCss }
      : item);
    pushUndo(frames);
    setFrames(updated);
    autoSave(updated);
  }, [frames, autoSave, pushUndo]);

  const handleLayerDrop = useCallback((
    sourceFrameId: string,
    layerId: string,
    targetFrameId: string,
    targetLayerId: string | null,
    placement: LayerDropPlacement,
  ) => {
    const sourceFrame = frames.find(frame => frame.id === sourceFrameId);
    const targetFrame = frames.find(frame => frame.id === targetFrameId);
    if (!sourceFrame || !targetFrame) return;

    if (sourceFrameId === targetFrameId) {
      const change = reparentLayerInHtml(sourceFrame.html, layerId, targetLayerId, placement);
      if (!change) {
        addToast("No se puede mover una capa dentro de sí misma.", "error");
        return;
      }
      const updated = frames.map(frame => frame.id === sourceFrameId
        ? { ...frame, html: change.html, css: applyLayerStack(frame.css, change.siblingLayerIds) }
        : frame);
      pushUndo(frames);
      setFrames(updated);
      setSelectedElement(null);
      autoSave(updated);
      return;
    }

    const extracted = extractLayerFromHtml(sourceFrame.html, layerId);
    if (!extracted) return;
    const remapped = remapLayerTreeForTarget(extracted.layerHtml, targetFrame.html, createLayerId);
    if (!remapped) return;
    const inserted = insertLayerIntoHtml(targetFrame.html, remapped.html, targetLayerId, placement);
    if (!inserted) {
      addToast("No se pudo insertar la capa en el destino.", "error");
      return;
    }

    const transferredCss = cloneLayerTreeCss(
      sourceFrame.css,
      extracted.layerHtml,
      extracted.layerIds,
      remapped.idMap,
    );
    const sourceCss = removeLayersCss(sourceFrame.css, extracted.layerIds);
    const combinedTargetCss = mergeCssRules(targetFrame.css, transferredCss);
    const targetCss = applyLayerStack(combinedTargetCss, inserted.siblingLayerIds);
    const updated = frames.map(frame => {
      if (frame.id === sourceFrameId) return { ...frame, html: extracted.html, css: sourceCss };
      if (frame.id === targetFrameId) return { ...frame, html: inserted.html, css: targetCss };
      return frame;
    });

    pushUndo(frames);
    setFrames(updated);
    setSelectedFrameId(targetFrameId);
    setSelectedFrameIds(new Set());
    setContentFrameId(targetFrameId);
    setSelectedElement(null);
    autoSave(updated);
  }, [frames, autoSave, pushUndo, addToast]);

  const handleFrameReorder = useCallback((
    sourceFrameId: string,
    targetFrameId: string,
    placement: LayerStackPlacement,
  ) => {
    if (sourceFrameId === targetFrameId) return;
    const reordered = [...frames];
    const sourceIndex = reordered.findIndex(frame => frame.id === sourceFrameId);
    if (sourceIndex < 0) return;
    const [source] = reordered.splice(sourceIndex, 1);
    const targetIndex = reordered.findIndex(frame => frame.id === targetFrameId);
    if (targetIndex < 0) return;
    reordered.splice(placement === "above" ? targetIndex : targetIndex + 1, 0, source);
    pushUndo(frames);
    setFrames(reordered);
    autoSave(reordered);
  }, [frames, autoSave, pushUndo]);

  // ── Zoom helpers ──
  const handleZoomIn = useCallback(() => setZoom(z => Math.min(MAX_ZOOM, z + 0.1)), []);
  const handleZoomOut = useCallback(() => setZoom(z => Math.max(MIN_ZOOM, z - 0.1)), []);
  const handleZoomSet = useCallback((val: number) => setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, val))), []);
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
    let newCss = ensureGoogleFontImport(activeCss, fontFamily);
    injectGoogleFontIntoFrames(fontFamily);
    if (selectedElement) {
      newCss = updateCssProperty(newCss, selectedElement.selector, "font-family", `'${fontFamily}' !important`);
    }
    handleCssChange(newCss);
  }, [activeCss, selectedFrameId, selectedElement, handleCssChange]);

  // ── Element selection from DesignFrame ──
  const handleElementSelect = useCallback((info: SelectedElementInfo | null) => {
    setLayerSelectionRequest(null);
    setSelectedElement(info);
    if (info) {
      setSelectedFrameId(info.frameId);
      setSelectedFrameIds(new Set());
      setContentFrameId(info.frameId);
      setShowRightPanel(true);
      if (info.isSvg && info.svgChildTag === "path") {
        lastPenStyleRef.current = {
          fill: info.computedStyles.fill || "none",
          stroke: info.computedStyles.stroke || "#111827",
          strokeWidth: info.computedStyles["stroke-width"] || "2",
          strokeLinecap: info.computedStyles["stroke-linecap"] || "round",
          strokeLinejoin: info.computedStyles["stroke-linejoin"] || "round",
          strokeDasharray: info.computedStyles["stroke-dasharray"] || "none",
        };
      }
    }
  }, []);

  const handleElementNudge = useCallback((info: SelectedElementInfo, deltaX: number, deltaY: number) => {
    const frame = frames.find(item => item.id === info.frameId);
    if (!frame || info.movableLayers.length === 0) return;

    let updatedCss = frame.css;
    for (const layer of info.movableLayers) {
      const selector = `[data-layer-id="${layer.layerId}"]`;
      const currentLeft = getCssPropertyValue(updatedCss, selector, "left") || layer.left;
      const currentTop = getCssPropertyValue(updatedCss, selector, "top") || layer.top;
      const hasPixelPosition = /^-?\d+(?:\.\d+)?px/.test(currentLeft)
        || /^-?\d+(?:\.\d+)?px/.test(currentTop);
      if (layer.position === "static" || !hasPixelPosition) {
        const translate = parseTranslate(getCssPropertyValue(updatedCss, selector, "translate") || layer.translate);
        updatedCss = updateCssProperty(
          updatedCss,
          selector,
          "translate",
          `${translate.x + deltaX}px ${translate.y + deltaY}px !important`,
        );
        if (layer.display === "inline") {
          updatedCss = updateCssProperty(updatedCss, selector, "display", "inline-block !important");
        }
      } else {
        updatedCss = updateCssProperty(updatedCss, selector, "left", `${(parseFloat(currentLeft) || 0) + deltaX}px !important`);
        updatedCss = updateCssProperty(updatedCss, selector, "top", `${(parseFloat(currentTop) || 0) + deltaY}px !important`);
      }
    }
    handleFrameCssChange(info.frameId, updatedCss);
  }, [frames, handleFrameCssChange]);

  // ── Layer selection from Layers Panel → click element in canvas ──
  const handleSelectLayerElement = useCallback((frameId: string, layerId: string, path?: number[]) => {
    setSelectedFrameId(frameId);
    setSelectedFrameIds(new Set());
    setContentFrameId(frameId);
    setLayerSelectionRequest({
      frameId,
      layerId,
      path,
      requestId: ++layerSelectionSequenceRef.current,
    });
  }, []);

  // ── Contextual panel CSS change ──
  const handleContextualCssChange = useCallback((newCss: string) => {
    handleCssChange(newCss);
  }, [handleCssChange]);

  // ── Add visual primitive to active frame ──
  const handleAddPrimitive = useCallback((type: "rect" | "circle" | "triangle" | "star" | "polygon" | "text", x: number, y: number, sides?: number) => {
    if (!selectedFrameId) return;
    const layerId = createLayerId();
    let html: string;
    let css: string;
    const defaultSize = type === "polygon" ? 120 : (type === "star" ? 130 : 150);
    if (type === "rect") {
      html = `<div data-layer-id="${layerId}" data-layer-name="Rectangle" data-layer-kind="shape" style="width:200px;height:150px;background:#3B82F6;border-radius:8px;position:absolute;left:${x}px;top:${y}px;"></div>`;
      css = `[data-layer-id="${layerId}"] {\n  width: 200px;\n  height: 150px;\n  background: #3B82F6;\n  border-radius: 8px;\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n}\n`;
    } else if (type === "circle") {
      html = `<div data-layer-id="${layerId}" data-layer-name="Circle" data-layer-kind="shape" style="width:150px;height:150px;background:#EF4444;border-radius:50%;position:absolute;left:${x}px;top:${y}px;"></div>`;
      css = `[data-layer-id="${layerId}"] {\n  width: 150px;\n  height: 150px;\n  background: #EF4444;\n  border-radius: 50%;\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n}\n`;
    } else if (type === "triangle") {
      const w = 150, h = 150;
      html = `<svg data-layer-id="${layerId}" data-layer-name="Triangle" data-layer-kind="svg" viewBox="0 0 ${w} ${h}" style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;overflow:visible;"><path d="M${w / 2} 0 L0 ${h} L${w} ${h} Z" fill="#10B981" stroke="#059669" stroke-width="2"/></svg>`;
      css = `[data-layer-id="${layerId}"] {\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n  width: ${w}px;\n  height: ${h}px;\n  overflow: visible;\n}\n`;
    } else if (type === "star") {
      const s = 130;
      const hw = s / 2; const hh = s / 2;
      const outerR = hw * 0.95; const innerR = hw * 0.38;
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const angle = (Math.PI / 2 * -1) + (Math.PI / 5) * i;
        const r = i % 2 === 0 ? outerR : innerR;
        pts.push(`${Math.round(hw + r * Math.cos(angle))},${Math.round(hh + r * Math.sin(angle))}`);
      }
      html = `<svg data-layer-id="${layerId}" data-layer-name="Star" data-layer-kind="svg" viewBox="0 0 ${s} ${s}" style="position:absolute;left:${x}px;top:${y}px;width:${s}px;height:${s}px;overflow:visible;"><path d="M${pts.join(" L")} Z" fill="#F59E0B" stroke="#D97706" stroke-width="2"/></svg>`;
      css = `[data-layer-id="${layerId}"] {\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n  width: ${s}px;\n  height: ${s}px;\n  overflow: visible;\n}\n`;
    } else if (type === "polygon") {
      const n = sides || 6;
      const s = 120;
      const hw = s / 2; const hh = s / 2;
      const r = hw * 0.92;
      const pts: string[] = [];
      for (let i = 0; i < n; i++) {
        const angle = (Math.PI / 2 * -1) + (2 * Math.PI / n) * i;
        pts.push(`${Math.round(hw + r * Math.cos(angle))},${Math.round(hh + r * Math.sin(angle))}`);
      }
      html = `<svg data-layer-id="${layerId}" data-layer-name="Polygon" data-layer-kind="svg" viewBox="0 0 ${s} ${s}" style="position:absolute;left:${x}px;top:${y}px;width:${s}px;height:${s}px;overflow:visible;"><path d="M${pts.join(" L")} Z" fill="#8B5CF6" stroke="#7C3AED" stroke-width="2"/></svg>`;
      css = `[data-layer-id="${layerId}"] {\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n  width: ${s}px;\n  height: ${s}px;\n  overflow: visible;\n}\n`;
    } else {
      html = `<div data-layer-id="${layerId}" data-layer-name="Text" data-layer-kind="text" style="font-size:24px;color:#333;position:absolute;left:${x}px;top:${y}px;">Text</div>`;
      css = `[data-layer-id="${layerId}"] {\n  font-size: 24px;\n  color: #333;\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n}\n`;
    }
    const updated = frames.map(f =>
      f.id === selectedFrameId
        ? { ...f, html: f.html + "\n" + html, css: f.css + "\n" + css }
        : f
    );
    pushUndo(frames);
    setFrames(updated);
    autoSave(updated);
    setActiveTool("select"); // Switch back to select after placing
  }, [selectedFrameId, frames, autoSave, pushUndo]);

  // ── Phase C: Draw shape with exact dimensions (drag-to-draw) ──
  const handleDrawShape = useCallback((type: "rect" | "circle" | "triangle" | "star" | "polygon", x: number, y: number, w: number, h: number, sides?: number) => {
    if (!selectedFrameId) return;
    const layerId = createLayerId();
    let html: string;
    let css: string;
    if (type === "rect") {
      html = `<div data-layer-id="${layerId}" data-layer-name="Rectangle" data-layer-kind="shape"></div>`;
      css = `[data-layer-id="${layerId}"] {\n  width: ${w}px;\n  height: ${h}px;\n  background: #3B82F6;\n  border-radius: 8px;\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n}\n`;
    } else if (type === "circle") {
      html = `<div data-layer-id="${layerId}" data-layer-name="Circle" data-layer-kind="shape"></div>`;
      css = `[data-layer-id="${layerId}"] {\n  width: ${w}px;\n  height: ${h}px;\n  background: #EF4444;\n  border-radius: 50%;\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n}\n`;
    } else if (type === "triangle") {
      html = `<svg data-layer-id="${layerId}" data-layer-name="Triangle" data-layer-kind="svg" viewBox="0 0 ${w} ${h}" style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;overflow:visible;"><path d="M${w / 2} 0 L0 ${h} L${w} ${h} Z" fill="#10B981" stroke="#059669" stroke-width="2"/></svg>`;
      css = `[data-layer-id="${layerId}"] {\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n  width: ${w}px;\n  height: ${h}px;\n  overflow: visible;\n}\n`;
    } else if (type === "star") {
      const s = Math.max(w, h);
      const hw = s / 2; const hh = s / 2;
      const outerR = hw * 0.95; const innerR = hw * 0.38;
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const angle = (Math.PI / 2 * -1) + (Math.PI / 5) * i;
        const r = i % 2 === 0 ? outerR : innerR;
        pts.push(`${Math.round(hw + r * Math.cos(angle))},${Math.round(hh + r * Math.sin(angle))}`);
      }
      html = `<svg data-layer-id="${layerId}" data-layer-name="Star" data-layer-kind="svg" viewBox="0 0 ${s} ${s}" style="position:absolute;left:${x}px;top:${y}px;width:${s}px;height:${s}px;overflow:visible;"><path d="M${pts.join(" L")} Z" fill="#F59E0B" stroke="#D97706" stroke-width="2"/></svg>`;
      css = `[data-layer-id="${layerId}"] {\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n  width: ${s}px;\n  height: ${s}px;\n  overflow: visible;\n}\n`;
    } else {
      // polygon — uses SVG path with configurable sides
      const n = sides || 6;
      const s = Math.max(w, h);
      const hw = s / 2; const hh = s / 2;
      const r = hw * 0.92;
      const pts: string[] = [];
      for (let i = 0; i < n; i++) {
        const angle = (Math.PI / 2 * -1) + (2 * Math.PI / n) * i;
        pts.push(`${Math.round(hw + r * Math.cos(angle))},${Math.round(hh + r * Math.sin(angle))}`);
      }
      html = `<svg data-layer-id="${layerId}" data-layer-name="Polygon" data-layer-kind="svg" viewBox="0 0 ${s} ${s}" style="position:absolute;left:${x}px;top:${y}px;width:${s}px;height:${s}px;overflow:visible;"><path d="M${pts.join(" L")} Z" fill="#8B5CF6" stroke="#7C3AED" stroke-width="2"/></svg>`;
      css = `[data-layer-id="${layerId}"] {\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n  width: ${s}px;\n  height: ${s}px;\n  overflow: visible;\n}\n`;
    }
    const updated = frames.map(f =>
      f.id === selectedFrameId
        ? { ...f, html: f.html + "\n" + html, css: f.css + "\n" + css }
        : f
    );
    pushUndo(frames);
    setFrames(updated);
    autoSave(updated);
    setActiveTool("select");
  }, [selectedFrameId, frames, autoSave, pushUndo]);

  // ── Phase C: Inline text editing ──
  const handleTextChange = useCallback((layerId: string, newText: string) => {
    if (!selectedFrameId) return;
    const frame = frames.find(f => f.id === selectedFrameId);
    if (!frame) return;
    const newHtml = replaceLayerText(frame.html, layerId, newText);
    if (newHtml === null) return;
    const updated = frames.map(f =>
      f.id === selectedFrameId ? { ...f, html: newHtml } : f
    );
    pushUndo(frames);
    setFrames(updated);
    autoSave(updated);
  }, [selectedFrameId, frames, autoSave, pushUndo]);

  const handleEditPathPoints = useCallback((frameId: string, layerId: string, newPathD: string) => {
    const frame = frames.find(candidate => candidate.id === frameId);
    if (!frame) return;
    const analysis = analyzePathData(newPathD);
    const newHtml = replaceLayerPathData(frame.html, layerId, newPathD, {
      "data-bezier-model": "chained-cubic",
      "data-bezier-degeneracy": analysis.degeneracy,
      "data-bezier-self-intersections": String(analysis.selfIntersections),
      "data-bezier-singularities": String(analysis.singularities),
    });
    if (newHtml === null || newHtml === frame.html) return;
    const updated = frames.map(candidate => candidate.id === frameId ? { ...candidate, html: newHtml } : candidate);
    pushUndo(frames);
    setFrames(updated);
    autoSave(updated);
  }, [frames, autoSave, pushUndo]);

  // ── Phase E: Pen path creation (supports closed paths) ──
  const handleAddPenPath = useCallback((pathData: string, bounds: { x: number; y: number; width: number; height: number }, closed?: boolean) => {
    if (!selectedFrameId) return;
    const layerId = createLayerId();
    const style = lastPenStyleRef.current;
    const fill = closed && style.fill === "none" ? "#3B82F6" : style.fill;
    const analysis = analyzePathData(pathData, Boolean(closed));
    const svgHtml = `<svg data-layer-id="${layerId}" data-layer-name="Bezier" data-layer-kind="bezier" data-bezier-model="chained-cubic" data-bezier-degeneracy="${analysis.degeneracy}" data-bezier-self-intersections="${analysis.selfIntersections}" data-bezier-singularities="${analysis.singularities}" viewBox="${bounds.x} ${bounds.y} ${Math.max(bounds.width, 1)} ${Math.max(bounds.height, 1)}" style="position:absolute;left:${bounds.x}px;top:${bounds.y}px;width:${Math.max(bounds.width, 1)}px;height:${Math.max(bounds.height, 1)}px;overflow:visible;"><path d="${pathData}"/></svg>`;
    const css = `[data-layer-id="${layerId}"] {\n  position: absolute;\n  left: ${bounds.x}px;\n  top: ${bounds.y}px;\n  width: ${Math.max(bounds.width, 1)}px;\n  height: ${Math.max(bounds.height, 1)}px;\n  overflow: visible;\n}\n[data-layer-id="${layerId}"] path {\n  fill: ${fill};\n  stroke: ${style.stroke};\n  stroke-width: ${style.strokeWidth};\n  stroke-linecap: ${style.strokeLinecap};\n  stroke-linejoin: ${style.strokeLinejoin};\n  stroke-dasharray: ${style.strokeDasharray};\n}\n`;
    const updated = frames.map(f =>
      f.id === selectedFrameId
        ? { ...f, html: f.html + "\n" + svgHtml, css: f.css + "\n" + css }
        : f
    );
    pushUndo(frames);
    setFrames(updated);
    autoSave(updated);
    setActiveTool("select");
    if (analysis.degeneracy === "point") {
      addToast("El trazado degeneró en un punto. Se conservó para que puedas corregir sus anclas.", "error");
    } else if (analysis.selfIntersections > 0 || analysis.singularities > 0) {
      addToast(`Trazado creado con ${analysis.selfIntersections} auto-intersección(es) y ${analysis.singularities} punto(s) singular(es).`, "info");
    }
  }, [selectedFrameId, frames, autoSave, pushUndo, addToast]);

  // ── Text on Path: write text along an existing SVG path ──
  const handleAddTextPath = useCallback((pathData: string, bounds: { x: number; y: number; width: number; height: number }, clickX: number, clickY: number, startOffset: number) => {
    if (!selectedFrameId) return;
    const layerId = createLayerId();
    const pathId = `tp_${Date.now().toString(36)}`;
    const svgHtml = `<svg data-layer-id="${layerId}" data-layer-name="Text on path" data-layer-kind="text" viewBox="${bounds.x} ${bounds.y} ${Math.max(bounds.width, 1)} ${Math.max(bounds.height, 1)}" style="position:absolute;left:${bounds.x}px;top:${bounds.y}px;width:${Math.max(bounds.width, 1)}px;height:${Math.max(bounds.height, 1)}px;overflow:visible;"><defs><path id="${pathId}" d="${pathData}"/></defs><text fill="#c4c0b4" font-size="18" font-family="inherit"><textPath href="#${pathId}" startOffset="${startOffset}%">Text</textPath></text></svg>`;
    const css = `[data-layer-id="${layerId}"] {
  position: absolute;
  left: ${bounds.x}px;
  top: ${bounds.y}px;
  width: ${Math.max(bounds.width, 1)}px;
  height: ${Math.max(bounds.height, 1)}px;
  overflow: visible;
}
`;
    const updated = frames.map(f =>
      f.id === selectedFrameId
        ? { ...f, html: f.html + "\n" + svgHtml, css: f.css + "\n" + css }
        : f
    );
    pushUndo(frames);
    setFrames(updated);
    autoSave(updated);
    setActiveTool("select");
  }, [selectedFrameId, frames, autoSave, pushUndo]);

  // ── Phase F: Pathfinder boolean operations ──
  const handlePathfinder = useCallback(async (op: "union" | "subtract" | "intersect" | "exclude") => {
    if (!selectedFrameId || multiSelectLayerIds.length < 2) return;
    try {
      const res = await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0", method: "pathfinder",
          params: { templateId, frameId: selectedFrameId, elementIdA: multiSelectLayerIds[0], elementIdB: multiSelectLayerIds[1], operation: op },
          id: 0,
        }),
      });
      if (res.result) {
        const tpl = await getTemplate(templateId);
        const t = tpl as any;
        if (t?.frames && Array.isArray(t.frames)) {
          const updated = t.frames.map((f: any) => ({
            ...frames.find(lf => lf.id === f.id),
            html: f.html || "",
            css: f.css || "",
          }));
          if (updated.length > 0) {
            pushUndo(frames);
            setFrames(updated);
            autoSave(updated);
          }
        }
      }
    } catch (err) { console.warn("[Pathfinder] Failed:", err); }
    setMultiSelectLayerIds([]);
  }, [selectedFrameId, multiSelectLayerIds, templateId, frames, autoSave, pushUndo]);

  // ── Phase G: SVG Import ──
  const handleSvgImportOpen = useCallback(() => setShowSvgImport(true), []);
  const handleSvgImported = useCallback(async (newTemplateId: string) => {
    setShowSvgImport(false);
    onBack();
  }, [onBack]);

  const handleRasterImageImported = useCallback((image: RasterImageImport) => {
    const frame = frames.find(item => item.id === selectedFrameId);
    if (!frame) {
      addToast("Selecciona un frame antes de importar la imagen.", "error");
      return;
    }

    const layerId = createLayerId();
    const imageElement = document.createElement("img");
    imageElement.setAttribute("data-layer-id", layerId);
    imageElement.setAttribute("data-layer-name", image.name);
    imageElement.setAttribute("data-layer-kind", "image");
    imageElement.setAttribute("alt", image.name);
    imageElement.setAttribute("src", image.dataUrl);
    imageElement.setAttribute("draggable", "false");

    const inserted = insertLayerIntoHtml(frame.html, imageElement.outerHTML, null, "inside");
    if (!inserted) {
      addToast("No se pudo insertar la imagen en el frame.", "error");
      return;
    }

    const sourceWidth = Math.max(1, image.width || 512);
    const sourceHeight = Math.max(1, image.height || 512);
    const availableWidth = Math.max(1, frame.width - 80);
    const availableHeight = Math.max(1, frame.height - 80);
    const scale = Math.min(1, availableWidth / sourceWidth, availableHeight / sourceHeight);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const left = Math.round((frame.width - width) / 2);
    const top = Math.round((frame.height - height) / 2);
    const imageCss = `[data-layer-id="${layerId}"] {
  position: absolute;
  left: ${left}px;
  top: ${top}px;
  width: ${width}px;
  height: ${height}px;
  display: block;
  object-fit: contain;
}`;
    const updated = frames.map(item => item.id === frame.id
      ? { ...item, html: inserted.html, css: mergeCssRules(item.css, imageCss) }
      : item);

    pushUndo(frames);
    setFrames(updated);
    autoSave(updated);
    handleSelectLayerElement(frame.id, layerId);
    addToast("Imagen insertada en el frame.", "success");
  }, [frames, selectedFrameId, pushUndo, autoSave, handleSelectLayerElement, addToast]);

  // ── Phase C: Delete element inside frame ──
  const handleDeleteElement = useCallback((layerId: string, frameId = selectedFrameId) => {
    if (!frameId) return;
    const frame = frames.find(f => f.id === frameId);
    if (!frame) return;
    const newHtml = deleteLayerFromHtml(frame.html, layerId);
    if (newHtml === null) return;
    const newCss = removeLayerCss(frame.css, layerId);
    const updated = frames.map(f =>
      f.id === frameId ? { ...f, html: newHtml, css: newCss } : f
    );
    pushUndo(frames);
    setFrames(updated);
    autoSave(updated);
    setSelectedElement(null);
  }, [selectedFrameId, frames, autoSave, pushUndo]);

  // ── Phase C: Duplicate element inside frame ──
  const handleDuplicateElement = useCallback((layerId: string, frameId = selectedFrameId) => {
    if (!frameId) return;
    const frame = frames.find(f => f.id === frameId);
    if (!frame) return;
    const duplicated = duplicateLayerInHtml(frame.html, layerId, createLayerId);
    if (!duplicated) return;
    const newCss = cloneLayerCss(frame.css, duplicated.idMap, 20);
    const updated = frames.map(f =>
      f.id === frameId
        ? { ...f, html: duplicated.html, css: newCss }
        : f
    );
    pushUndo(frames);
    setFrames(updated);
    autoSave(updated);
  }, [selectedFrameId, frames, autoSave, pushUndo]);

  // ── Change semantic tag of selected element ──
  const captureSelection = useCallback((): DesignClipboard | null => {
    if (selectedElement && selectedElement.frameId === selectedFrameId) {
      const sourceFrame = frames.find(frame => frame.id === selectedElement.frameId);
      if (!sourceFrame) return null;
      return {
        kind: "element",
        frameId: sourceFrame.id,
        layerId: selectedElement.layerId,
        html: sourceFrame.html,
        css: sourceFrame.css,
        layout: {
          left: selectedElement.computedStyles.left,
          top: selectedElement.computedStyles.top,
          translate: selectedElement.computedStyles.translate,
        },
        pasteCount: 0,
      };
    }

    const frameIds = selectedFrameIds.size > 0
      ? selectedFrameIds
      : new Set(selectedFrameId ? [selectedFrameId] : []);
    const copiedFrames = frames.filter(frame => frameIds.has(frame.id)).map(frame => ({ ...frame }));
    return copiedFrames.length > 0
      ? { kind: "frames", frames: copiedFrames, pasteCount: 0 }
      : null;
  }, [selectedElement, selectedFrameId, selectedFrameIds, frames]);

  const copySelection = useCallback(() => {
    const clipboard = captureSelection();
    if (!clipboard) return;
    const availableAcrossProjects = persistDesignClipboard(clipboard);
    if (clipboard.kind === "element") {
      addToast(availableAcrossProjects
        ? "Elemento copiado. Puedes pegarlo en otro proyecto."
        : "Elemento copiado en esta pestaña; es demasiado grande para compartirlo entre pestañas.",
      availableAcrossProjects ? "success" : "error");
      return;
    }
    const copiedFrames = clipboard.frames;
    const message = `${copiedFrames.length} frame${copiedFrames.length === 1 ? "" : "s"} copiado${copiedFrames.length === 1 ? "" : "s"}`;
    addToast(availableAcrossProjects
      ? `${message}. Puedes pegarlo en otro proyecto.`
      : `${message} en esta pestaña; es demasiado grande para compartirlo entre pestañas.`,
    availableAcrossProjects ? "success" : "error");
  }, [captureSelection, addToast]);

  const cutSelection = useCallback(() => {
    const clipboard = captureSelection();
    if (!clipboard) return;

    if (clipboard.kind === "element") {
      persistDesignClipboard(clipboard);
      handleDeleteElement(clipboard.layerId, clipboard.frameId);
      addToast("Elemento cortado.", "success");
      return;
    }

    const frameIds = new Set(clipboard.frames.map(frame => frame.id));
    if (!deleteFrames(frameIds)) {
      addToast("El diseño debe conservar al menos un frame.", "error");
      return;
    }
    persistDesignClipboard(clipboard);
    addToast(`${clipboard.frames.length} frame${clipboard.frames.length === 1 ? "" : "s"} cortado${clipboard.frames.length === 1 ? "" : "s"}.`, "success");
  }, [captureSelection, handleDeleteElement, deleteFrames, addToast]);

  const pasteSelection = useCallback(() => {
    const clipboard = readDesignClipboard();
    if (!clipboard) {
      addToast("No hay ningún elemento o frame copiado.", "error");
      return;
    }
    clipboard.pasteCount++;
    persistDesignClipboard(clipboard);
    const offset = clipboard.pasteCount * 20;

    if (clipboard.kind === "element") {
      const targetFrameId = selectedFrameId || clipboard.frameId;
      const targetFrame = frames.find(frame => frame.id === targetFrameId);
      if (!targetFrame) return;
      const sourceLayer = extractLayerFromHtml(clipboard.html, clipboard.layerId);
      if (!sourceLayer) return;
      const pasted = pasteLayerFromHtml(
        targetFrame.html,
        clipboard.html,
        clipboard.layerId,
        createLayerId,
        offset,
      );
      if (!pasted) return;
      let pastedCss = cloneLayerTreeCss(
        clipboard.css,
        sourceLayer.layerHtml,
        sourceLayer.layerIds,
        pasted.idMap,
        offset,
      );
      const rootSelector = `[data-layer-id="${pasted.rootLayerId}"]`;
      let offsetByPosition = false;
      for (const property of ["left", "top"] as const) {
        const value = clipboard.layout[property];
        if (!/^-?\d+(?:\.\d+)?px$/.test(value)) continue;
        pastedCss = updateCssProperty(
          pastedCss,
          rootSelector,
          property,
          `${parseFloat(value) + offset}px`,
        );
        offsetByPosition = true;
      }
      if (!offsetByPosition) {
        const translate = parseTranslate(clipboard.layout.translate);
        pastedCss = updateCssProperty(
          pastedCss,
          rootSelector,
          "translate",
          `${translate.x + offset}px ${translate.y + offset}px`,
        );
      }
      const newCss = mergeCssRules(targetFrame.css, pastedCss);
      const updated = frames.map(frame => frame.id === targetFrameId
        ? { ...frame, html: pasted.html, css: newCss }
        : frame);
      pushUndo(frames);
      setFrames(updated);
      setSelectedFrameId(targetFrameId);
      setSelectedFrameIds(new Set([targetFrameId]));
      setContentFrameId(targetFrameId);
      setSelectedElement(null);
      setActiveTool("select");
      autoSave(updated);
      addToast("Elemento pegado.", "success");
      return;
    }

    let frameNumber = nextFrameNumber(frames);
    const clones = clipboard.frames.map(source => cloneFrame(
      source,
      source.x + offset,
      source.y + offset,
      `Frame ${frameNumber++}`,
    ));
    pushUndo(frames);
    const updated = [...frames, ...clones];
    setFrames(updated);
    setSelectedFrameId(clones[0].id);
    setSelectedFrameIds(new Set(clones.map(frame => frame.id)));
    setContentFrameId(null);
    setSelectedElement(null);
    autoSave(updated);
    addToast(`${clones.length} frame${clones.length === 1 ? "" : "s"} pegado${clones.length === 1 ? "" : "s"}.`, "success");
  }, [selectedFrameId, frames, autoSave, pushUndo, addToast]);

  const handleChangeTag = useCallback((newTag: string) => {
    if (!selectedElement || !selectedFrameId) return;
    const frame = frames.find(f => f.id === selectedElement.frameId);
    if (!frame) return;

    const layerId = selectedElement.layerId;
    const newHtml = changeLayerTag(frame.html, layerId, newTag);
    if (newHtml === null) return;

    const updated = frames.map(f =>
      f.id === selectedElement.frameId ? { ...f, html: newHtml } : f
    );
    pushUndo(frames);
    setFrames(updated);
    autoSave(updated);
    setSelectedElement(prev => prev ? { ...prev, tag: newTag } : null);
  }, [selectedElement, selectedFrameId, frames, autoSave, pushUndo]);

  // ── Convert element to SVG path ──
  const handleConvertToPath = useCallback(async (layerId: string, frameId: string) => {
    if (!templateId) return;
    try {
      const result = await mcpCall("shape_to_path", { templateId, frameId, elementId: layerId });
      if (result?.success) {
        // Reload template to get updated frames
        const tpl = await getTemplate(templateId);
        if (tpl && tpl.frames) {
          pushUndo(frames);
          setFrames(tpl.frames);
          autoSave(tpl.frames);
        }
      }
    } catch (err) {
      console.error("[ConvertToPath] Error:", err);
    }
  }, [templateId, frames, autoSave, pushUndo]);

  // ── Outline stroke: convert stroke to filled outline path ──
  const handleOutlineStroke = useCallback(async (layerId: string, frameId: string) => {
    if (!templateId) return;
    try {
      const result = await mcpCall("outline_stroke", { templateId, frameId, layerId });
      if (result?.success) {
        const tpl = await getTemplate(templateId);
        if (tpl && tpl.frames) {
          pushUndo(frames);
          setFrames(tpl.frames);
          autoSave(tpl.frames);
        }
      }
    } catch (err) {
      console.error("[OutlineStroke] Error:", err);
    }
  }, [templateId, frames, autoSave, pushUndo]);

  // ── Offset path: inset/outset by distance ──
  const handleOffsetPath = useCallback(async (layerId: string, frameId: string, offset: number) => {
    if (!templateId) return;
    try {
      const result = await mcpCall("offset_path", { templateId, frameId, layerId, offset });
      if (result?.success) {
        const tpl = await getTemplate(templateId);
        if (tpl && tpl.frames) {
          pushUndo(frames);
          setFrames(tpl.frames);
          autoSave(tpl.frames);
        }
      }
    } catch (err) {
      console.error("[OffsetPath] Error:", err);
    }
  }, [templateId, frames, autoSave, pushUndo]);


  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Escape closes dropdowns
      if (e.key === "Escape") {
        setShowFontPicker(false);
        return;
      }
      if (isEditableTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "z" && !e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); handleUndo(); return; }
      if (mod && (e.key === "Z" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); e.stopImmediatePropagation(); handleRedo(); return; }
      if (mod && e.key === "/") { e.preventDefault(); setShowCodePanel(p => !p); return; }
      if (mod && e.key.toLowerCase() === "c" && !e.shiftKey) { e.preventDefault(); copySelection(); return; }
      if (mod && e.key.toLowerCase() === "x" && !e.shiftKey) { e.preventDefault(); cutSelection(); return; }
      if (mod && e.key.toLowerCase() === "v" && !e.shiftKey) { e.preventDefault(); pasteSelection(); return; }
      if (mod && e.key.toLowerCase() === "d" && !e.shiftKey) { e.preventDefault(); duplicateFrame(); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === "d") { e.preventDefault(); if (selectedElement) handleDuplicateElement(selectedElement.layerId); return; }
      if (!mod) {
        switch (e.key.toLowerCase()) {
          case "v": setActiveTool("select"); break;
          case "h": setActiveTool("hand"); break;
          case "r": setActiveTool("rect"); break;
          case "o": setActiveTool("circle"); break;
          case "t":
            if (e.shiftKey) { setActiveTool("text-path"); }
            else { setActiveTool("text"); }
            break;
          case "p": setActiveTool("pen"); break;
          case "b": setActiveTool("pencil"); break;
          case "delete":
          case "backspace":
            if (selectedElement) {
              handleDeleteElement(selectedElement.layerId);
            } else if (selectedFrameId && frames.length > 1) {
              deleteSelectedFrame();
            }
            break;
          case "arrowleft":
          case "arrowright":
          case "arrowup":
          case "arrowdown":
            if (selectedElement) {
              e.preventDefault();
              const step = e.shiftKey ? 10 : 1;
              let deltaX = 0;
              let deltaY = 0;
              if (e.key === "ArrowLeft") deltaX = -step;
              if (e.key === "ArrowRight") deltaX = step;
              if (e.key === "ArrowUp") deltaY = -step;
              if (e.key === "ArrowDown") deltaY = step;
              handleElementNudge(selectedElement, deltaX, deltaY);
            } else if (selectedFrameId && !contentFrameId) {
              e.preventDefault();
              const f = frames.find(fr => fr.id === selectedFrameId);
              if (f) {
                const step = e.shiftKey ? 10 : 1;
                let nx = f.x, ny = f.y;
                if (e.key === "ArrowLeft") nx -= step;
                if (e.key === "ArrowRight") nx += step;
                if (e.key === "ArrowUp") ny -= step;
                if (e.key === "ArrowDown") ny += step;
                handleFrameMove(f.id, nx, ny);
              }
            }
            break;
        }
      }
    };
    const handleNativeCopy = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const hasSelection = Boolean(selectedElement && selectedElement.frameId === selectedFrameId)
        || selectedFrameIds.size > 0
        || Boolean(selectedFrameId);
      if (!hasSelection) return;
      e.preventDefault();
      e.clipboardData?.setData("text/plain", "Futuraria design object");
      copySelection();
    };
    const handleNativePaste = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target) || !readDesignClipboard()) return;
      e.preventDefault();
      pasteSelection();
    };
    const handleNativeCut = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const hasSelection = Boolean(selectedElement && selectedElement.frameId === selectedFrameId)
        || selectedFrameIds.size > 0
        || Boolean(selectedFrameId);
      if (!hasSelection) return;
      e.preventDefault();
      e.clipboardData?.setData("text/plain", "Futuraria design object");
      cutSelection();
    };
    window.addEventListener("keydown", handler, { capture: true });
    window.addEventListener("copy", handleNativeCopy, { capture: true });
    window.addEventListener("cut", handleNativeCut, { capture: true });
    window.addEventListener("paste", handleNativePaste, { capture: true });
    return () => {
      window.removeEventListener("keydown", handler, { capture: true });
      window.removeEventListener("copy", handleNativeCopy, { capture: true });
      window.removeEventListener("cut", handleNativeCut, { capture: true });
      window.removeEventListener("paste", handleNativePaste, { capture: true });
    };
  }, [handleUndo, handleRedo, copySelection, cutSelection, pasteSelection, deleteSelectedFrame, duplicateFrame, handleDeleteElement, handleDuplicateElement, handleElementNudge, selectedElement, selectedFrameId, selectedFrameIds, frames.length, contentFrameId, handleFrameMove, frames]);

  // ── Export ──
  /// Serialize a frame to SVG for vector export
  // ── Native SVG generation: walks DOM tree, resolves styles, emits <rect>/<text>/<image> ──
  // Unlike foreignObject SVG, this produces elements Figma and Illustrator can import.
  const buildFrameSvg = useCallback((frame: FrameData): string => {
    const w = frame.width || 1080;
    const h = frame.height || 1080;
    const bg = frame.background || "#ffffff";
    const html = frame.html || "";
    const css = frame.css || "";

    // Parse CSS rules
    const cssRules: { selector: string; props: Record<string, string> }[] = [];
    const cleanCss = css.replace(/@import[^;]+;/g, "").replace(/@font-face\s*\{[^}]*\}/g, "");
    const ruleRe = /([^{}]+)\{([^}]*)\}/g;
    let rm;
    while ((rm = ruleRe.exec(cleanCss)) !== null) {
      const selectors = rm[1].trim().split(",").map(s => s.trim());
      const props: Record<string, string> = {};
      for (const decl of rm[2].trim().split(";")) {
        const idx = decl.indexOf(":");
        if (idx > 0) {
          const p = decl.slice(0, idx).trim();
          const v = decl.slice(idx + 1).trim();
          if (p && v) props[p] = v;
        }
      }
      if (Object.keys(props).length > 0) {
        for (const sel of selectors) cssRules.push({ selector: sel, props });
      }
    }

    // Simple selector matching
    const matchesSel = (el: HTMLElement, selector: string): boolean => {
      if (/^[a-z0-9]+$/i.test(selector)) return el.tagName.toLowerCase() === selector;
      if (selector.startsWith("#")) return el.id === selector.slice(1);
      if (selector.startsWith(".")) return el.classList.contains(selector.slice(1));
      const compound = selector.match(/^([a-z0-9]+)?(?:\.([\w-]+))?(?:#([\w-]+))?$/i);
      if (compound) {
        const [, tag, cls, id] = compound;
        if (tag && el.tagName.toLowerCase() !== tag) return false;
        if (cls && !el.classList.contains(cls)) return false;
        if (id && el.id !== id) return false;
        return true;
      }
      return false;
    };

    const resolveStyles = (el: HTMLElement): Record<string, string> => {
      const resolved: Record<string, string> = {};
      // Inline styles first
      const inline = el.getAttribute("style") || "";
      for (const decl of inline.split(";")) {
        const idx = decl.indexOf(":");
        if (idx > 0) resolved[decl.slice(0, idx).trim()] = decl.slice(idx + 1).trim();
      }
      // CSS rules cascade on top
      for (const { selector, props } of cssRules) {
        if (matchesSel(el, selector)) Object.assign(resolved, props);
      }
      return resolved;
    };

    const escXml = (t: string) => t.replace(/[<>&'"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

    // Parse HTML into temp container
    const tmp = document.createElement("div");
    tmp.innerHTML = `<div id="__svgroot">${html}</div>`;
    const root = tmp.querySelector("#__svgroot") as HTMLElement;
    if (!root) return `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${bg}"/></svg>`;

    const svgParts: string[] = [];

    const walkNode = (node: HTMLElement, offsetX: number, offsetY: number) => {
      for (const child of Array.from(node.children) as HTMLElement[]) {
        const tag = child.tagName.toLowerCase();
        if (["script", "style", "link", "meta"].includes(tag)) continue;

        const style = resolveStyles(child);
        const text = (child.textContent || "").trim();
        const hasChildren = child.children.length > 0;

        const left = parseInt(style["left"]) || 0;
        const top = parseInt(style["top"]) || 0;
        const width = parseInt(style["width"]) || 0;
        const height = parseInt(style["height"]) || 0;
        const fontSize = style["font-size"] || style["fontSize"] || "16px";
        const fontFamily = (style["font-family"] || style["fontFamily"] || "sans-serif").replace(/["']/g, "");
        const color = style["color"] || "#000000";
        const fontWeight = style["font-weight"] || style["fontWeight"] || "400";
        const textAlign = style["text-align"] || style["textAlign"] || "left";
        const background = style["background"] || style["background-color"] || style["backgroundColor"] || "";
        const borderRadius = style["border-radius"] || style["borderRadius"] || "";
        const opacity = parseFloat(style["opacity"]) || 1;

        const x = left + offsetX;
        const y = top + offsetY;

        // Background rect
        const bgC = background.match(/#[0-9a-f]{3,8}/i)?.[0] || background.match(/rgba?\([^)]+\)/i)?.[0] || "";
        if (bgC && width && height) {
          const rx = borderRadius.match(/(\d+)/)?.[1] || "0";
          svgParts.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${bgC}" rx="${rx}" opacity="${opacity}"/>`);
        }

        // Image
        if (tag === "img") {
          const src = child.getAttribute("src") || "";
          if (src && width && height) {
            svgParts.push(`<image x="${x}" y="${y}" width="${width}" height="${height}" href="${escXml(src)}" preserveAspectRatio="xMidYMid slice"/>`);
          }
        }

        // Text (leaf nodes only)
        if (text && !hasChildren && tag !== "img") {
          const anchor = textAlign === "center" ? "middle" : textAlign === "right" ? "end" : "start";
          const textX = textAlign === "center" ? x + width / 2 : textAlign === "right" ? x + width : x;
          const textY = y + parseInt(fontSize) || y + 16;
          svgParts.push(`<text x="${textX}" y="${textY}" font-family="${escXml(fontFamily)}" font-size="${escXml(fontSize)}" font-weight="${escXml(fontWeight)}" fill="${color}" text-anchor="${anchor}" opacity="${opacity}">${escXml(text)}</text>`);
        }

        // Recurse
        walkNode(child, x, y);
      }
    };

    walkNode(root, 0, 0);

    // Extract font links
    const fontImportRe = /@import\s+url\(['"]?(https:\/\/fonts\.googleapis\.com[^'")]+)['"]?\)\s*;/g;
    const fontLinks: string[] = [];
    let fm;
    while ((fm = fontImportRe.exec(css)) !== null) {
      fontLinks.push(`<link rel="stylesheet" href="${fm[1]}"/>`);
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xhtml="http://www.w3.org/1999/xhtml"
     width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <style><![CDATA[${cleanCss}]]></style>
    ${fontLinks.join("\n  ")}
  </defs>
  <rect width="${w}" height="${h}" fill="${bg}"/>
  ${svgParts.join("\n  ")}
</svg>`;
  }, []);

  /// Capture a single frame to PNG/blob via offscreen html2canvas (no page, no toolbars).
  const captureFrameToPng = useCallback(async (frame: FrameData, scale: number = 2, format: "png" | "jpg" = "png"): Promise<Blob | null> => {
    const container = document.createElement("div");
    container.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;";
    document.body.appendChild(container);

    const target = document.createElement("div");
    target.style.cssText = `width:${frame.width}px;height:${frame.height}px;overflow:hidden;position:relative;`;
    if (format === "jpg" && frame.background) {
      target.style.background = frame.background;
    }
    const style = document.createElement("style");
    style.textContent = frame.css;
    target.appendChild(style);
    const content = document.createElement("div");
    content.innerHTML = frame.html;
    target.appendChild(content);
    container.appendChild(target);

    const importRe = /@import\s+url\(['"]?(https:\/\/fonts\.googleapis\.com[^'")]+)['"]?\)\s*;/g;
    let m;
    const fontLinks: HTMLLinkElement[] = [];
    while ((m = importRe.exec(frame.css)) !== null) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = m[1];
      document.head.appendChild(link);
      fontLinks.push(link);
    }

    try {
      if (document.fonts?.ready) await document.fonts.ready;
      else await new Promise(r => setTimeout(r, 2000));

      const canvas = await html2canvas(target, {
        width: frame.width,
        height: frame.height,
        scale,
        useCORS: true,
        allowTaint: true,
        backgroundColor: format === "jpg" ? (frame.background || "#ffffff") : null,
      });

      return new Promise(resolve => {
        const mimeType = format === "jpg" ? "image/jpeg" : "image/png";
        const quality = format === "jpg" ? 0.92 : undefined;
        canvas.toBlob(blob => resolve(blob), mimeType, quality);
      });
    } catch (err) {
      console.warn("[Export] Capture failed", err);
      return null;
    } finally {
      fontLinks.forEach(l => l.remove());
      container.remove();
    }
  }, []);

  const handleExportFramePNG = useCallback(async (format: "png" | "jpg" = "png") => {
    if (!selectedFrame) return;
    setShowExportMenu(false);
    const blob = await captureFrameToPng(selectedFrame, format === "jpg" ? 1 : 2, format);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedFrame.name.replace(/[<>:"/\\|?*]/g, "_")}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [selectedFrame, captureFrameToPng]);

  const handleExportAllFramesPNG = useCallback(async (format: "png" | "jpg" = "png") => {
    setShowExportMenu(false);
    for (const frame of frames) {
      const blob = await captureFrameToPng(frame, format === "jpg" ? 1 : 2, format);
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${frame.name.replace(/[<>:"/\\|?*]/g, "_")}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      await new Promise(r => setTimeout(r, 300));
    }
  }, [frames, captureFrameToPng]);

  const handleExportFrameSVG = useCallback(async () => {
    if (!selectedFrame) return;
    setShowExportMenu(false);
    const svgString = buildFrameSvg(selectedFrame);
    const blob = new Blob([svgString], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedFrame.name.replace(/[<>:"/\\|?*]/g, "_")}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [selectedFrame]);

  const handleExportAllFramesSVG = useCallback(async () => {
    setShowExportMenu(false);
    for (const frame of frames) {
      const svgString = buildFrameSvg(frame);
      const blob = new Blob([svgString], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${frame.name.replace(/[<>:"/\\|?*]/g, "_")}.svg`;
      a.click();
      URL.revokeObjectURL(url);
      await new Promise(r => setTimeout(r, 200));
    }
  }, [frames, buildFrameSvg]);

  // ── PDF export via jsPDF ──
  const handleExportFramePDF = useCallback(async () => {
    if (!selectedFrame) return;
    setShowExportMenu(false);
    const blob = await captureFrameToPng(selectedFrame, 2, "png");
    if (!blob) return;
    const { jsPDF } = await import("jspdf");
    const reader = new FileReader();
    const imgData = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const f = selectedFrame;
    const pdf = new jsPDF({
      orientation: (f.width || 1080) > (f.height || 1080) ? "landscape" : "portrait",
      unit: "px",
      format: [f.width || 1080, f.height || 1080],
    });
    pdf.addImage(imgData, "PNG", 0, 0, f.width || 1080, f.height || 1080);
    pdf.save(`${f.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`);
  }, [selectedFrame, captureFrameToPng]);

  const handleExportAllFramesPDF = useCallback(async () => {
    setShowExportMenu(false);
    const { jsPDF } = await import("jspdf");
    for (const frame of frames) {
      const blob = await captureFrameToPng(frame, 2, "png");
      if (!blob) continue;
      const reader = new FileReader();
      const imgData = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const pdf = new jsPDF({
        orientation: (frame.width || 1080) > (frame.height || 1080) ? "landscape" : "portrait",
        unit: "px",
        format: [frame.width || 1080, frame.height || 1080],
      });
      pdf.addImage(imgData, "PNG", 0, 0, frame.width || 1080, frame.height || 1080);
      pdf.save(`${frame.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`);
      await new Promise(r => setTimeout(r, 300));
    }
  }, [frames, captureFrameToPng]);

  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showImageUpload, setShowImageUpload] = useState(false);
  const [saveRecipeMsg, setSaveRecipeMsg] = useState("");

  const handleSaveRecipe = useCallback(async () => {
    setSaveRecipeMsg("");
    try {
      const res = await apiFetch<{ recipeId: string; name: string }>("/recipes", {
        method: "POST",
        body: JSON.stringify({
          name: templateName || "Untitled Key Visual",
          description: `${templateName} - saved ${new Date().toLocaleDateString()}`,
          workspaceId: templateWorkspaceId,
          templateHtml: selectedFrame?.html || "",
          templateCss: selectedFrame?.css || "",
          structure: {
            layout: { width: selectedFrame?.width || 1080, height: selectedFrame?.height || 1080 },
            colors: [],
            typography: [],
          },
        }),
      });
      setSaveRecipeMsg(`✓ Key Visual saved: ${res.name}`);
      setTimeout(() => setSaveRecipeMsg(""), 3000);
    } catch (e: any) {
      setSaveRecipeMsg(`✗ Failed: ${e.message}`);
      setTimeout(() => setSaveRecipeMsg(""), 4000);
    }
  }, [templateName, templateWorkspaceId, selectedFrame]);

  // ── Extract Design System (R6: Human UI path) ──
  const handleExtractDesignSystem = useCallback(async () => {
    try {
      const mcpRes = await fetch("/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: "generate_design_artifacts", arguments: { templateId, action: "generate" } },
          id: 1,
        }),
      });
      const json = await mcpRes.json();
      const text = json?.result?.content?.[0]?.text;
      if (!text) throw new Error("No artifacts returned");
      const data = JSON.parse(text);

      const downloads = [
        { name: `${templateName.replace(/[<>:"/\\|?* ]/g, "_")}_DESIGN.md`, content: data.designMd, type: "text/markdown" },
        { name: `${templateName.replace(/[<>:"/\\|?* ]/g, "_")}_tokens.json`, content: data.tokensJson, type: "application/json" },
        { name: `${templateName.replace(/[<>:"/\\|?* ]/g, "_")}_shared.css`, content: data.sharedCss, type: "text/css" },
      ];

      for (const d of downloads) {
        if (!d.content) continue;
        const blob = new Blob([d.content], { type: d.type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = d.name;
        a.click();
        URL.revokeObjectURL(url);
        await new Promise(r => setTimeout(r, 150));
      }
    } catch (e: any) {
      console.error("[Extract DS]", e);
      addToast("Error al extraer el design system: " + (e?.message || "Error desconocido"), "error");
    }
  }, [templateId, templateName, addToast]);

  // ── Frame rename (double-click in top bar) ──
  const commitFrameRename = useCallback(() => {
    if (!selectedFrameId || editingFrameName === null) return;
    const trimmed = editingFrameName.trim();
    if (!trimmed) { setEditingFrameName(null); return; }
    const updated = frames.map(f =>
      f.id === selectedFrameId ? { ...f, name: trimmed } : f
    );
    pushUndo(frames);
    setFrames(updated);
    setEditingFrameName(null);
    autoSave(updated);
  }, [selectedFrameId, editingFrameName, frames, autoSave, pushUndo]);

  // ── Template (workspace) rename ──
  const commitTemplateRename = useCallback(async () => {
    if (!templateId || editingTemplateName === null) return;
    const trimmed = editingTemplateName.trim();
    if (!trimmed || trimmed === templateName) { setEditingTemplateName(null); return; }
    try {
      const result = await mcpCall("rename_template", { templateId, name: trimmed });
      if (result?.success) {
        setTemplateName(trimmed);
      } else {
        addToast("No se pudo renombrar el template.", "error");
      }
    } catch (err) {
      console.error("[TemplateRename] Error:", err);
      addToast("Error al renombrar el template.", "error");
    }
    setEditingTemplateName(null);
  }, [templateId, editingTemplateName, templateName, addToast]);

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

  // ── Code panel visibility ──
  const [showCodePanel, setShowCodePanel] = useState(false);
  const [showLayersPanel, setShowLayersPanel] = useState(false);
  const [showInsertBar, setShowInsertBar] = useState(false);
  const [showVersionPanel, setShowVersionPanel] = useState(false);
  const [layoutMode, setLayoutMode] = useState<"fixed" | "smart">("fixed");
  const [mcpLoading, setMcpLoading] = useState<string | null>(null);
  const [mcpMsg, setMcpMsg] = useState("");
  const [clipboardStyle, setClipboardStyle] = useState<string | null>(null);
  const lockedLayersByFrame = useMemo(() => new Map(
    frames.map(frame => [frame.id, getLayerIdsWithDeclaration(frame.css, "pointer-events", "none")]),
  ), [frames]);
  const hiddenLayersByFrame = useMemo(() => new Map(
    frames.map(frame => [frame.id, getLayerIdsWithDeclaration(frame.css, "display", "none")]),
  ), [frames]);

  // ── Copy / Paste Style ──
  const handleCopyStyle = useCallback(() => {
    if (!selectedElement) return;
    const declarations = getExactRuleDeclarations(activeCss, selectedElement.selector);
    const styleDeclarations = declarations
      ? filterCssDeclarations(declarations, GEOMETRY_PROPERTIES)
      : Object.entries(selectedElement.computedStyles)
        .filter(([property, value]) => COPY_STYLE_PROPERTIES.has(property) && value && value !== "none" && value !== "normal")
        .map(([property, value]) => `${property}: ${value};`)
        .join("\n");
    if (styleDeclarations) {
      setClipboardStyle(styleDeclarations);
      setMcpMsg("✓ Style copied");
      setTimeout(() => setMcpMsg(""), 1500);
    }
  }, [selectedElement, activeCss]);

  const handlePasteStyle = useCallback(() => {
    if (!selectedElement || !clipboardStyle) return;
    let updated = activeCss;
    for (const declaration of parseCssDeclarations(clipboardStyle)) {
      updated = updateCssProperty(updated, selectedElement.selector, declaration.property, declaration.value);
    }
    handleCssChange(updated);
    setMcpMsg("✓ Style pasted");
    setTimeout(() => setMcpMsg(""), 1500);
  }, [selectedElement, clipboardStyle, activeCss, handleCssChange]);

  // ── Lock / Hide toggle ──
  const handleLockToggle = useCallback((frameId: string, layerId: string, locked: boolean) => {
    const frame = frames.find(item => item.id === frameId);
    if (!frame) return;
    const selector = `[data-layer-id="${layerId}"]`;
    const updated = locked
      ? appendCssOverride(frame.css, selector, "pointer-events", "none !important")
      : removeCssOverride(frame.css, selector, "pointer-events", "none !important");
    handleFrameCssChange(frameId, updated);
  }, [frames, handleFrameCssChange]);

  const handleHideToggle = useCallback((frameId: string, layerId: string, hidden: boolean) => {
    const frame = frames.find(item => item.id === frameId);
    if (!frame) return;
    const selector = `[data-layer-id="${layerId}"]`;
    const updated = hidden
      ? appendCssOverride(frame.css, selector, "display", "none !important")
      : removeCssOverride(frame.css, selector, "display", "none !important");
    handleFrameCssChange(frameId, updated);
  }, [frames, handleFrameCssChange]);

  // ── Generic MCP call helper ──
  const callMcp = useCallback(async (method: string, params: any) => {
    const res = await apiFetch<any>("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 0 }),
    });
    const text = res?.result?.content?.[0]?.text;
    return text ? (typeof text === "string" ? JSON.parse(text) : text) : res?.result;
  }, []);

  // ── Reload template data from server after MCP mutations ──
  const reloadFromServer = useCallback(async () => {
    const tpl = await getTemplate(templateId);
    const t = tpl as any;
    if (t?.frames && Array.isArray(t.frames)) {
      const updated = t.frames.map((f: any) => ({
        ...framesRef.current.find(lf => lf.id === f.id),
        html: f.html || "",
        css: f.css || "",
      }));
      if (updated.length > 0) {
        pushUndo(framesRef.current);
        setFrames(updated);
        autoSaveRef.current(updated);
      }
    }
  }, [templateId, pushUndo]);

  // ── Element operations (align/group/reorder/copy-as) ──
  const handleAlign = useCallback(async (alignment: string) => {
    if (!selectedFrameId || !selectedElement) return;
    setMcpLoading("align");
    try {
      await callMcp("align_elements", {
        templateId, frameId: selectedFrameId,
        elementIds: multiSelectLayerIds.length > 1 ? multiSelectLayerIds : [selectedElement.layerId],
        alignment,
      });
      await reloadFromServer();
      setMcpMsg("✓ Aligned");
    } catch { setMcpMsg("✗ Align failed"); }
    setMcpLoading(null);
    setTimeout(() => setMcpMsg(""), 2000);
  }, [selectedFrameId, selectedElement, multiSelectLayerIds, templateId, callMcp, reloadFromServer]);

  const handleGroup = useCallback(async () => {
    if (!selectedFrameId || multiSelectLayerIds.length < 2) return;
    setMcpLoading("group");
    try {
      await callMcp("group_elements", {
        templateId, frameId: selectedFrameId, elementIds: multiSelectLayerIds,
      });
      await reloadFromServer();
      setMcpMsg("✓ Grouped");
    } catch { setMcpMsg("✗ Group failed"); }
    setMcpLoading(null);
    setTimeout(() => setMcpMsg(""), 2000);
  }, [selectedFrameId, multiSelectLayerIds, templateId, callMcp, reloadFromServer]);

  const handleReorder = useCallback(async (direction: "up" | "down" | "top" | "bottom") => {
    if (!selectedFrameId || !selectedElement) return;
    setMcpLoading("reorder");
    try {
      await callMcp("reorder_element", {
        templateId, frameId: selectedFrameId, elementId: selectedElement.layerId, direction,
      });
      await reloadFromServer();
      setMcpMsg("✓ Reordered");
    } catch { setMcpMsg("✗ Reorder failed"); }
    setMcpLoading(null);
    setTimeout(() => setMcpMsg(""), 2000);
  }, [selectedFrameId, selectedElement, templateId, callMcp, reloadFromServer]);

  const handleCopyAs = useCallback(async (format: "html" | "css" | "json") => {
    if (!selectedFrameId || !selectedElement) return;
    try {
      const data = await callMcp("copy_as", {
        templateId, frameId: selectedFrameId, elementId: selectedElement.layerId, format,
      });
      const text = typeof data === "string" ? data : (data?.content || JSON.stringify(data, null, 2));
      await navigator.clipboard.writeText(text);
      setMcpMsg(`✓ Copied as ${format.toUpperCase()}`);
    } catch { setMcpMsg("✗ Copy failed"); }
    setTimeout(() => setMcpMsg(""), 2000);
  }, [selectedFrameId, selectedElement, templateId, callMcp]);

  // ── Smart Layout toggle ──
  const handleSmartLayout = useCallback(async (mode: "smart" | "fixed") => {
    setLayoutMode(mode);
    if (mode === "smart" && selectedFrameId) {
      setMcpLoading("smart");
      try {
        await callMcp("smart_layout", {
          templateId, frameId: selectedFrameId,
          layout: "grid",
        });
        await reloadFromServer();
        setMcpMsg("✓ Smart layout applied");
      } catch { setMcpMsg("✗ Smart layout failed"); }
      setMcpLoading(null);
    } else if (mode === "fixed" && selectedFrameId) {
      // Remove smart layout CSS by reloading original template
      await reloadFromServer();
      setMcpMsg("✓ Fixed layout restored");
    }
    setTimeout(() => setMcpMsg(""), 2000);
  }, [selectedFrameId, templateId, callMcp, reloadFromServer]);

  // ── Design system actions ──
  const handleLintDesign = useCallback(async () => {
    setMcpLoading("lint");
    try {
      const data = await callMcp("lint_design", { templateId });
      const issues = data?.issues || [];
      setMcpMsg(`✓ Lint: ${issues.length} issues found`);
    } catch { setMcpMsg("✗ Lint failed"); }
    setMcpLoading(null);
    setTimeout(() => setMcpMsg(""), 3000);
  }, [templateId, callMcp]);

  const handleEnhance = useCallback(async () => {
    setMcpLoading("enhance");
    try {
      await callMcp("enhance_template", { templateId });
      await reloadFromServer();
      setMcpMsg("✓ Template enhanced");
    } catch { setMcpMsg("✗ Enhance failed"); }
    setMcpLoading(null);
    setTimeout(() => setMcpMsg(""), 3000);
  }, [templateId, callMcp, reloadFromServer]);

  const handleExportTokens = useCallback(async () => {
    setMcpLoading("tokens");
    try {
      const data = await callMcp("export_design_tokens", { templateId });
      const json = JSON.stringify(data?.tokens || data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${templateName.replace(/[^a-zA-Z0-9_]/g, "_")}_tokens.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMcpMsg("✓ Tokens exported");
    } catch { setMcpMsg("✗ Token export failed"); }
    setMcpLoading(null);
    setTimeout(() => setMcpMsg(""), 3000);
  }, [templateId, templateName, callMcp]);

  // ── Variable operations ──
  const handleExtractVars = useCallback(async () => {
    setMcpLoading("extract");
    try {
      await callMcp("extract_variables", { templateId });
      await reloadFromServer();
      setMcpMsg("✓ Variables extracted");
    } catch { setMcpMsg("✗ Extract failed"); }
    setMcpLoading(null);
    setTimeout(() => setMcpMsg(""), 3000);
  }, [templateId, callMcp, reloadFromServer]);

  const handleApplyVars = useCallback(async () => {
    setMcpLoading("applyvars");
    try {
      await callMcp("apply_variables", { templateId });
      await reloadFromServer();
      setMcpMsg("✓ Variables applied");
    } catch { setMcpMsg("✗ Apply failed"); }
    setMcpLoading(null);
    setTimeout(() => setMcpMsg(""), 3000);
  }, [templateId, callMcp, reloadFromServer]);

  // ── Import template ──
  const handleImportTemplate = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await callMcp("import_template", { data, workspaceId: templateWorkspaceId });
      setMcpMsg("✓ Template imported");
    } catch { setMcpMsg("✗ Import failed"); }
    setTimeout(() => setMcpMsg(""), 3000);
    e.target.value = "";
  }, [callMcp, templateWorkspaceId]);

  // ── Dockable panels ──
  const rightDock = useDockablePanel(window.innerWidth - 290, 56, "right");
  const codeDock = useDockablePanel(0, 56, "left");
  const layersDock = useDockablePanel(380, 56, "left");
  const toolbarDock = useDockablePanel(20, 80, "left");

  const codeIsDocked = showCodePanel && codeDock.state.isDocked;
  const layersIsDocked = showLayersPanel && layersDock.state.isDocked;
  const layersDockOffset = codeIsDocked && codeDock.state.dockSide === layersDock.state.dockSide ? 380 : 0;
  const leftPanelsWidth = (codeIsDocked && codeDock.state.dockSide === "left" ? 380 : 0)
    + (layersIsDocked && layersDock.state.dockSide === "left" ? 260 : 0);
  const toolbarLeft = toolbarDock.state.isDocked ? leftPanelsWidth : undefined;

  // ── Background Render Worker ──
  // Polls for pending render jobs created by MCP export_batch.
  // When jobs are found, renders each frame offscreen via html2canvas
  // and uploads the resulting PNG to the server for AI agent retrieval.
  const renderWorkerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const renderingRef = useRef(false);
  // Only poll when a render job has been explicitly requested.
  // Without this gate, the worker fires every 10s on every template load,
  // hitting a non-existent endpoint (/api/render/queue/pending) and generating 400s.
  const renderPollEnabledRef = useRef(false);

  useEffect(() => {
    // Skip entirely if no render job has been queued — prevents the constant
    // stream of 400 errors from polling a non-existent endpoint.
    if (!renderPollEnabledRef.current) return;

    const API_BASE = window.location.origin;
    const POLL_INTERVAL = 10000; // 10 seconds

    const processJob = async (job: any) => {
      const frame = framesRef.current.find(f => f.id === job.frameId);
      if (!frame) {
        console.warn("[RenderWorker] Frame not found for job", job);
        return;
      }

      // Create offscreen container
      const container = document.createElement("div");
      container.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;";
      document.body.appendChild(container);

      // Build render target with exact frame dimensions
      const target = document.createElement("div");
      target.style.cssText = `width:${frame.width}px;height:${frame.height}px;overflow:hidden;position:relative;`;
      const style = document.createElement("style");
      style.textContent = frame.css;
      target.appendChild(style);
      const content = document.createElement("div");
      content.innerHTML = frame.html;
      target.appendChild(content);
      container.appendChild(target);

      try {
        // Wait for fonts to load (extract @import from CSS)
        const importRe = /@import\s+url\(['"]?(https:\/\/fonts\.googleapis\.com[^'")]+)['"]?\)\s*;/g;
        let m;
        const fontLinks: HTMLLinkElement[] = [];
        while ((m = importRe.exec(frame.css)) !== null) {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = m[1];
          document.head.appendChild(link);
          fontLinks.push(link);
        }

        // Wait for fonts
        if (document.fonts?.ready) {
          await document.fonts.ready;
        } else {
          await new Promise(r => setTimeout(r, 2000));
        }

        // Capture
        const canvas = await html2canvas(target, {
          width: frame.width,
          height: frame.height,
          scale: job.scale || 2,
          useCORS: true,
          allowTaint: true,
        });

        const dataUrl = canvas.toDataURL("image/png");

        // Upload to server
        const res = await fetch(`${API_BASE}/api/render/job/${job.jobId}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pngDataUrl: dataUrl }),
        });
        const json = await res.json();

        // Cleanup font links
        fontLinks.forEach(l => l.remove());
      } catch (err) {
        console.warn("[RenderWorker] Render failed", err);
      } finally {
        container.remove();
      }
    };

    const poll = async () => {
      if (renderingRef.current) return; // Don't stack polls
      try {
        const res = await fetch(`${API_BASE}/api/render/queue/pending?templateId=${encodeURIComponent(templateId)}`);
        if (!res.ok) return;
        const data = await res.json();
        const pending: any[] = data.pending || [];
        if (pending.length === 0) return;

        renderingRef.current = true;
        for (const job of pending) {
          await processJob(job);
        }
        renderingRef.current = false;
      } catch {
        /* silent - will retry next poll */
        renderingRef.current = false;
      }
    };

    // Initial poll + interval
    poll();
    renderWorkerRef.current = setInterval(poll, POLL_INTERVAL);

    return () => {
      if (renderWorkerRef.current) clearInterval(renderWorkerRef.current);
    };
  }, [templateId]);

  // ── Loading / Error ──
  if (loading) {
    return (
      <div style={{ display: "flex", height: "100vh", width: "100vw", background: "#0d0d1a", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#888", fontSize: 16 }}>Loading template...</div>
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ display: "flex", height: "100vh", width: "100vw", background: "#0d0d1a", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: "#f87171", fontSize: 16, marginBottom: 12 }}>{error}</div>
          <button type="button" onClick={onBack} className="glass-btn">
            <IconArrowLeft size={14} /> Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const RIGHT_PANEL_TABS = [
    { id: "contextual", icon: <IconSliders size={14} />, title: "Properties" },
    { id: "structure", icon: <IconLayout size={14} />, title: "Structure" },
    { id: "vars", icon: <IconDna size={14} />, title: "Variables" },
    { id: "brand", icon: <IconPalette size={14} />, title: "Brand" },
    { id: "format", icon: <IconFile size={14} />, title: "Format" },
    { id: "history", icon: <IconHistory size={14} />, title: "History" },
    { id: "agents", icon: <IconBot size={14} />, title: "Agents" },
  ];

  return (
    <div className="editor-v2-root">
      {/* ═══ Top Bar ═══ */}
      <div className="editor-v2-topbar">
        <button type="button" onClick={onBack} className="editor-v2-topbar-btn" title="Back to Dashboard">
          <IconArrowLeft size={14} />
        </button>
        {editingTemplateName !== null ? (
          <input
            ref={templateNameInputRef}
            value={editingTemplateName}
            onChange={e => setEditingTemplateName(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") commitTemplateRename();
              if (e.key === "Escape") { setEditingTemplateName(null); }
            }}
            onBlur={commitTemplateRename}
            className="editor-v2-project-name"
            autoFocus
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(200,184,152,0.4)",
              borderRadius: 4,
              color: "#c8b898",
              fontSize: 13,
              fontFamily: "inherit",
              padding: "2px 8px",
              outline: "none",
              width: 200,
            }}
          />
        ) : (
          <span
            className="editor-v2-project-name"
            onDoubleClick={() => setEditingTemplateName(templateName)}
            title="Double-click to rename workspace"
            style={{ cursor: "text" }}
          >
            {templateName}
          </span>
        )}
        {selectedFrame && (
          editingFrameName !== null ? (
            <input
              ref={frameNameInputRef}
              value={editingFrameName}
              onChange={e => setEditingFrameName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") commitFrameRename();
                if (e.key === "Escape") { setEditingFrameName(null); }
              }}
              onBlur={commitFrameRename}
              className="editor-v2-frame-info"
              autoFocus
              style={{
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(200,184,152,0.4)",
                borderRadius: 4,
                color: "#c8b898",
                fontSize: 12,
                fontFamily: "inherit",
                padding: "2px 6px",
                outline: "none",
                width: 180,
              }}
            />
          ) : (
            <span
              className="editor-v2-frame-info"
              onDoubleClick={() => setEditingFrameName(selectedFrame.name)}
              title="Double-click to rename"
              style={{ cursor: "text" }}
            >
              {selectedFrame.name} · {selectedFrame.width}×{selectedFrame.height}
            </span>
          )
        )}
        {saving && <span className="editor-v2-saving">Saving...</span>}
        {activeAgents.length > 0 && (
          <span className="editor-v2-agents">
            <span className="editor-v2-agents-dot" />
            {activeAgents.length}
          </span>
        )}
        <div style={{ flex: 1 }} />

        {/* Right panel tab icons */}
        {RIGHT_PANEL_TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={`editor-v2-topbar-icon-btn ${showRightPanel && rightPanelTab === tab.id ? "active" : ""}`}
            onClick={() => {
              if (showRightPanel && rightPanelTab === tab.id) {
                setShowRightPanel(false);
              } else {
                setRightPanelTab(tab.id);
                setShowRightPanel(true);
              }
            }}
            title={tab.title}
          >
            {tab.icon}
          </button>
        ))}

        <div className="editor-v2-topbar-sep" />

        <button type="button" className="editor-v2-topbar-icon-btn" onClick={() => setShowStyleLibrary(true)} title="Style Library">
          <IconPalette size={14} />
          <span style={{ fontSize: 9, marginLeft: 3 }}>Library</span>
        </button>

        <button type="button" className="editor-v2-topbar-icon-btn" onClick={() => setShowFontPicker(!showFontPicker)} title="Fonts">
          <IconType size={14} />
        </button>
        {/* Export Dropdown */}
        <div style={{ position: "relative" }}>
          <button type="button" className="editor-v2-topbar-icon-btn" onClick={() => setShowExportMenu(!showExportMenu)} title="Export">
            <IconDownload size={14} />
            <IconChevronDown size={8} style={{ marginLeft: 2 }} />
          </button>
          {showExportMenu && (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 98 }} onClick={() => setShowExportMenu(false)} />
              <div className="editor-v2-dropdown-menu" style={{ position: "absolute", right: 0, top: "100%", zIndex: 99, marginTop: 4 }}>
                <button type="button" onClick={() => { handleExportFramePNG("png"); setShowExportMenu(false); }} className="editor-v2-dropdown-item">
                  <IconImage size={14} /> Export Current Frame as PNG
                </button>
                <button type="button" onClick={() => { handleExportFramePNG("jpg"); setShowExportMenu(false); }} className="editor-v2-dropdown-item">
                  <IconImage size={14} /> Export Current Frame as JPG
                </button>
                <button type="button" onClick={() => { handleExportFrameSVG(); setShowExportMenu(false); }} className="editor-v2-dropdown-item">
                  <IconImage size={14} /> Export Current Frame as SVG
                </button>
                <button type="button" onClick={() => { handleExportFramePDF(); setShowExportMenu(false); }} className="editor-v2-dropdown-item">
                  <IconDownload size={14} /> Export Current Frame as PDF
                </button>
                <div className="editor-v2-dropdown-sep" />
                <button type="button" onClick={() => { handleExportAllFramesPNG("png"); setShowExportMenu(false); }} className="editor-v2-dropdown-item">
                  <IconImage size={14} /> Export All Frames as PNG
                </button>
                <button type="button" onClick={() => { handleExportAllFramesPNG("jpg"); setShowExportMenu(false); }} className="editor-v2-dropdown-item">
                  <IconImage size={14} /> Export All Frames as JPG
                </button>
                <button type="button" onClick={() => { handleExportAllFramesSVG(); setShowExportMenu(false); }} className="editor-v2-dropdown-item">
                  <IconImage size={14} /> Export All Frames as SVG
                </button>
                <button type="button" onClick={() => { handleExportAllFramesPDF(); setShowExportMenu(false); }} className="editor-v2-dropdown-item">
                  <IconDownload size={14} /> Export All Frames as PDF
                </button>
                <div className="editor-v2-dropdown-sep" />
                <button type="button" onClick={() => { handleExportJSON(); setShowExportMenu(false); }} className="editor-v2-dropdown-item">
                  <IconDownload size={14} /> Export as JSON
                </button>
              </div>
            </>
          )}
        </div>

        <div className="editor-v2-topbar-sep" />

        <button
          type="button"
          className="editor-v2-topbar-icon-btn"
          onClick={handleSaveRecipe}
          title="Save as Key Visual (Recipe)"
        >
          <IconTag size={14} />
        </button>

        <button
          type="button"
          className="editor-v2-topbar-icon-btn"
          onClick={() => setShowImageUpload(true)}
          title="Upload Images"
        >
          <IconImage size={14} />
        </button>

        <div className="editor-v2-topbar-sep" />

        <button type="button" className="editor-v2-topbar-icon-btn" onClick={duplicateFrame} title="Duplicate frame (Ctrl+D)">
          <IconCopy size={14} />
        </button>
        <button
          type="button"
          className={`editor-v2-topbar-icon-btn ${frames.length <= 1 ? "disabled" : ""}`}
          onClick={deleteSelectedFrame}
          disabled={frames.length <= 1}
          title="Delete frame (Del)"
        >
          <IconTrash size={14} />
        </button>

        <div className="editor-v2-topbar-sep" />

        <button
          type="button"
          className="editor-v2-topbar-icon-btn"
          onClick={handleExtractDesignSystem}
          title="Extract Design System — downloads DESIGN.md, tokens.json, and shared.css"
        >
          <IconDownload size={14} />
          <span style={{ fontSize: 9, marginLeft: 3 }}>DS</span>
        </button>

               <div className="editor-v2-topbar-sep" />

        {/* Insert toolbar toggle */}
        <button
          type="button"
          className={`editor-v2-topbar-icon-btn ${showInsertBar ? "active" : ""}`}
          onClick={() => setShowInsertBar(!showInsertBar)}
          title="Insert Elements Bar"
        >
          <IconPlus size={14} />
        </button>

        {/* Import template */}
        <label className="editor-v2-topbar-icon-btn" title="Import Template JSON">
          <IconUpload size={14} />
          <input type="file" accept=".json" onChange={handleImportTemplate} style={{ display: "none" }} />
        </label>

        {/* Lint design */}
        <button
          type="button"
          className="editor-v2-topbar-icon-btn"
          onClick={handleLintDesign}
          disabled={mcpLoading === "lint"}
          title="Lint Design — check for issues"
        >
          <IconWand size={14} />
        </button>

        {/* Enhance template */}
        <button
          type="button"
          className="editor-v2-topbar-icon-btn"
          onClick={handleEnhance}
          disabled={mcpLoading === "enhance"}
          title="Enhance — AI-suggested improvements"
        >
          <IconSparkle size={14} />
        </button>

        {/* Export design tokens */}
        <button
          type="button"
          className="editor-v2-topbar-icon-btn"
          onClick={handleExportTokens}
          disabled={mcpLoading === "tokens"}
          title="Export Design Tokens as JSON"
        >
          <IconDna size={14} />
          <span style={{ fontSize: 9, marginLeft: 1 }}>X</span>
        </button>

        {/* Extract variables */}
        <button
          type="button"
          className="editor-v2-topbar-icon-btn"
          onClick={handleExtractVars}
          disabled={mcpLoading === "extract"}
          title="Extract CSS variables from template"
        >
          <IconRefresh size={14} />
        </button>

        {/* Apply variables */}
        <button
          type="button"
          className="editor-v2-topbar-icon-btn"
          onClick={handleApplyVars}
          disabled={mcpLoading === "applyvars"}
          title="Replace hardcoded values with CSS variables"
        >
          <IconLink size={14} />
        </button>
      </div>

      {/* ═══ Font Picker Dropdown ═══ */}
      {showFontPicker && (
        <div className="editor-v2-font-picker-dropdown">
          <GoogleFontPicker value={selectedFont} onChange={handleFontSelect} />
        </div>
      )}

      {/* ═══ Main Area ═══ */}
      <div className="editor-v2-main">
        {/* ── Code Panel (slide-in from left) ── */}
        {showCodePanel && (
          <div className="editor-v2-code-panel" style={codeDock.panelStyle(380, 0)}>
            <div className="dock-handle" {...codeDock.handleProps}>
              <span>Code</span>
              <button type="button" onClick={() => codeDock.toggleDock("left")} className="dock-pin-btn" title={codeDock.state.isDocked ? "Undock" : "Dock left"}>
                {codeDock.state.isDocked ? "📌" : "📍"}
              </button>
            </div>
            <CodePanel
              ref={codePanelRef}
              html={activeHtml}
              css={activeCss}
              onHtmlChange={handleHtmlChange}
              onCssChange={handleCssChange}
            />
          </div>
        )}

        {/* ── Layers Panel (slide-in from left, next to Code Panel) ── */}
        {showLayersPanel && (
          <div className="editor-v2-layers-panel" style={layersDock.panelStyle(260, layersDockOffset)}>
            <div className="dock-handle" {...layersDock.handleProps}>
              <span>Layers</span>
              <button type="button" onClick={() => layersDock.toggleDock("left")} className="dock-pin-btn" title={layersDock.state.isDocked ? "Undock" : "Dock left"}>
                {layersDock.state.isDocked ? "📌" : "📍"}
              </button>
            </div>
            <HtmlLayersPanel
              frames={frames}
              selectedFrameId={selectedFrameId}
              selectedFrameIds={selectedFrameIds}
              selectedElementId={selectedElement?.layerId || null}
              onSelectFrame={handleSelectFrame}
              onSelectElement={handleSelectLayerElement}
              onHtmlChange={handleFrameHtmlChange}
              onLayerStackChange={handleLayerStackChange}
              onLayerDrop={handleLayerDrop}
              onFrameReorder={handleFrameReorder}
              onLayerDelete={(frameId, layerId) => handleDeleteElement(layerId, frameId)}
              onLayerDuplicate={(frameId, layerId) => handleDuplicateElement(layerId, frameId)}
              onMultiSelectChange={setMultiSelectLayerIds}
              onLockToggle={handleLockToggle}
              onHideToggle={handleHideToggle}
              lockedLayersByFrame={lockedLayersByFrame}
              hiddenLayersByFrame={hiddenLayersByFrame}
            />
          </div>
        )}

        {/* ── Canvas (fills remaining space) ── */}
        <div id="canvas-container" className="editor-v2-canvas-area">
          {/* ── Insert Toolbar (toggleable) ── */}
          {showInsertBar && (
            <InsertToolbar
              templateId={templateId}
              onHtmlUpdated={(html, css) => {
                if (selectedFrameId) {
                  handleFrameCssChange(selectedFrameId, css, html);
                }
              }}
              onSvgImport={() => setShowSvgImport(true)}
            />
          )}
          {/* ── Element Operations Bar (when element selected) ── */}
          {selectedElement && (
            <div style={{
              display: "flex", gap: 2, padding: "4px 8px",
              background: "rgba(12,12,36,0.8)", backdropFilter: "blur(12px)",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              flexShrink: 0, flexWrap: "wrap", alignItems: "center",
            }}>
              {/* Align buttons */}
              <button type="button" onClick={() => handleAlign("left")} title="Align Left"
                style={elemBtnStyle}><IconAlignLeft size={14} /></button>
              <button type="button" onClick={() => handleAlign("center")} title="Align Center"
                style={elemBtnStyle}><IconAlignCenter size={14} /></button>
              <button type="button" onClick={() => handleAlign("right")} title="Align Right"
                style={elemBtnStyle}><IconAlignRight size={14} /></button>
              <div style={sepStyle} />
              {/* Reorder buttons */}
              <button type="button" onClick={() => handleReorder("up")} title="Bring Forward"
                style={elemBtnStyle}>↑</button>
              <button type="button" onClick={() => handleReorder("down")} title="Send Backward"
                style={elemBtnStyle}>↓</button>
              <button type="button" onClick={() => handleReorder("top")} title="Bring to Front"
                style={elemBtnStyle}>⤒</button>
              <button type="button" onClick={() => handleReorder("bottom")} title="Send to Back"
                style={elemBtnStyle}>⤓</button>
              <div style={sepStyle} />
              {/* Group button */}
              <button type="button" onClick={handleGroup} disabled={multiSelectLayerIds.length < 2}
                title="Group Elements"
                style={{ ...elemBtnStyle, opacity: multiSelectLayerIds.length < 2 ? 0.4 : 1 }}>Group</button>
              <div style={sepStyle} />
              {/* Copy-as buttons */}
              <button type="button" onClick={() => handleCopyAs("html")} title="Copy as HTML"
                style={elemBtnStyle}>HTML</button>
              <button type="button" onClick={() => handleCopyAs("css")} title="Copy as CSS"
                style={elemBtnStyle}>CSS</button>
              <button type="button" onClick={() => handleCopyAs("json")} title="Copy as JSON"
                style={elemBtnStyle}>JSON</button>
              <div style={sepStyle} />
              {/* Smart / Fixed layout toggle */}
              <button type="button"
                onClick={() => handleSmartLayout(layoutMode === "fixed" ? "smart" : "fixed")}
                disabled={mcpLoading === "smart"}
                title="Toggle smart vs fixed layout"
                style={{
                  ...elemBtnStyle,
                  background: layoutMode === "smart" ? "rgba(139,92,246,0.3)" : "rgba(255,255,255,0.06)",
                  color: layoutMode === "smart" ? "#a78bfa" : "#ccc",
                  fontWeight: 600,
                }}>
                {mcpLoading === "smart" ? "..." : layoutMode === "smart" ? "Smart" : "Fixed"}
              </button>
            </div>
          )}
          <InfiniteHtmlCanvas
            frames={frames}
            selectedFrameId={selectedFrameId}
            selectedFrameIds={selectedFrameIds}
            contentFrameId={contentFrameId}
            activeTool={activeTool}
            zoom={zoom}
            onSelectFrame={handleSelectFrame}
            onActivateFrame={handleActivateFrame}
            onFrameShiftClick={handleFrameShiftClick}
            onMarqueeSelect={handleMarqueeSelect}
            onEnterContentMode={handleEnterContentMode}
            onZoomChange={setZoom}
            onFrameMove={handleFrameMove}
            onMultiFrameMove={handleMultiFrameMove}
            onDuplicateFrames={handleDuplicateFramesAtPositions}
            onRenameFrame={handleRenameFrame}
            onElementSelect={handleElementSelect}
            layerSelectionRequest={layerSelectionRequest}
            selectedElement={selectedElement}
            onFrameCssChange={handleFrameCssChange}
            onFrameHtmlChange={handleFrameHtmlChange}
            onAddPrimitive={handleAddPrimitive}
            onDrawShape={handleDrawShape}
            onTextChange={handleTextChange}
            onAddPenPath={handleAddPenPath}
            onAddTextPath={handleAddTextPath}
            onEditPathPoints={handleEditPathPoints}
            onElementDelete={handleDeleteElement}
            onElementDuplicate={handleDuplicateElement}
            onFrameResize={handleFrameResize}
          />
        </div>
      </div>

      {/* ═══ Floating Left Toolbar ═══ */}
      <div style={{ ...toolbarDock.panelStyle(56), ...(toolbarLeft !== undefined ? { left: toolbarLeft } : {}) }}>
        <div className="dock-handle" {...toolbarDock.handleProps} style={{ justifyContent: "center", padding: "2px 4px", minHeight: 16 }}>
          <span style={{ fontSize: 8, letterSpacing: 2 }}>TOOLS</span>
        </div>
        <FloatingToolbar
          tool={activeTool}
          onToolChange={setActiveTool}
          onAddFrame={addFrame}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomToFit={handleZoomToFit}
          onZoomSet={handleZoomSet}
          zoom={zoom}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          multiSelectCount={multiSelectLayerIds.length}
          onPathfinder={handlePathfinder}
          onSvgImport={handleSvgImportOpen}
          showCode={showCodePanel}
          showLayers={showLayersPanel}
          onToggleCode={() => setShowCodePanel(v => !v)}
          onToggleLayers={() => setShowLayersPanel(v => !v)}
        />
      </div>

      {/* ═══ Floating Right Properties Panel ═══ */}
      {showRightPanel && (
        <div className="editor-v2-right-panel" style={rightDock.panelStyle(260)}>
          <div className="dock-handle" {...rightDock.handleProps}>
            <span>Properties</span>
            <button type="button" onClick={() => rightDock.toggleDock("right")} className="dock-pin-btn" title={rightDock.state.isDocked ? "Undock" : "Dock right"}>
              {rightDock.state.isDocked ? "📌" : "📍"}
            </button>
          </div>
          {rightPanelTab === "contextual" && (
            <HtmlContextualPanel
              element={selectedElement}
              css={activeCss}
              onCssChange={handleContextualCssChange}
              onChangeTag={handleChangeTag}
              onCopyStyle={handleCopyStyle}
              onPasteStyle={handlePasteStyle}
              hasClipboardStyle={!!clipboardStyle}
              onConvertToPath={handleConvertToPath}
              onOutlineStroke={handleOutlineStroke}
              onOffsetPath={handleOffsetPath}
            />
          )}
          {rightPanelTab === "structure" && (
            <StructurePanel templateId={templateId} onSelectElement={(id: string) => {
              const el = document.querySelector(`[data-layer-id="${id}"]`);
              if (el) (el as HTMLElement).click();
            }} />
          )}
          {rightPanelTab === "vars" && (
            <VariablesPanel templateId={templateId} onCssUpdated={(c: string) => handleCssChange(c)} />
          )}
          {rightPanelTab === "brand" && (
            <BrandPanel templateId={templateId} onCssUpdated={(c: string) => handleCssChange(c)} />
          )}
          {rightPanelTab === "format" && (
            <FormatPanel templateId={templateId} width={selectedFrame?.width ?? 1080} height={selectedFrame?.height ?? 1080} onTemplateCreated={(id: string) => {
              window.open(`/?template=${id}&v=2`, "_blank");
            }} />
          )}
          {rightPanelTab === "history" && (
            <VersionHistoryPanel templateId={templateId} onRestore={reloadFromServer} />
          )}
          {rightPanelTab === "agents" && (
            <ActiveAgentsPanel agents={activeAgents} />
          )}
        </div>
      )}

      {/* ═══ SVG Import Dialog ═══ */}
      {showSvgImport && (
        <SvgImportDialog
          workspaceId={templateWorkspaceId}
          onImported={handleSvgImported}
          onRasterImported={handleRasterImageImported}
          onClose={() => setShowSvgImport(false)}
        />
      )}

      {/* ═══ Image Upload Modal ═══ */}
      {showImageUpload && (
        <ImageUploadModal
          onClose={() => setShowImageUpload(false)}
          onAssetUploaded={(asset) => {
            if (asset) {
              addToast("✓ Imagen subida correctamente.", "success");
            } else {
              addToast("Error al subir la imagen.", "error");
            }
          }}
        />
      )}

      {/* ═══ Save Recipe Toast ═══ */}
      {saveRecipeMsg && (
        <div style={{
          position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 600, padding: "8px 20px", borderRadius: 8,
          background: saveRecipeMsg.startsWith("✓") ? "rgba(34,197,94,0.9)" : "rgba(239,68,68,0.9)",
          color: "#fff", fontSize: 13, fontWeight: 500,
          boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
        }}>
          {saveRecipeMsg}
        </div>
      )}

      {/* ═══ MCP Action Toast ═══ */}
      {mcpMsg && (
        <div style={{
          position: "fixed", bottom: 56, left: "50%", transform: "translateX(-50%)",
          zIndex: 600, padding: "6px 16px", borderRadius: 6,
          background: mcpMsg.startsWith("✓") ? "rgba(34,197,94,0.85)" : "rgba(239,68,68,0.85)",
          color: "#fff", fontSize: 12, fontWeight: 500,
          boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
          backdropFilter: "blur(8px)",
        }}>
          {mcpMsg}
        </div>
      )}

      {/* ═══ Style Library Modal ═══ */}
      {showStyleLibrary && (
        <StyleLibraryModal
          workspaceId={templateWorkspaceId || "default"}
          onClose={() => setShowStyleLibrary(false)}
          onToast={(msg, type) => addToast(msg, type || "info")}
        />
      )}
    </div>
  );
}
