import React, { useState, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { rasterizeFrame, canvasToBlob, inlineFrameImages, mapBodySelectors } from "../lib/frameCapture";
import { downloadBlob } from "../lib/download";
import { CodePanel } from "../components/CodePanel";
import { GoogleFontPicker } from "../components/GoogleFontPicker";
import { OnboardingTour, type TourAction } from "../components/OnboardingTour";
import { FileInfoPanel } from "../components/FileInfoPanel";
import { StyleLibraryPanel } from "../components/StyleLibraryPanel";
import { FloatingToolbar } from "../components/FloatingToolbar";
import { ExportPanel, type ExportFormat } from "../components/ExportPanel";
import { DesignImportModal } from "../components/DesignImportModal";
import { ImportRouterModal, type ImportRoute, detectRoute as detectImportRoute } from "../components/ImportRouterModal";
import type { ImportResult } from "../lib/designImport";
import { InfiniteHtmlCanvas, type HtmlToolName } from "../components/InfiniteHtmlCanvas";
import type { Guide, ColumnConfig } from "../components/CanvasGuides";
import type { FrameData, HtmlCanvasObject, LayerSelectionRequest, SelectedElementInfo, ShapeOptions } from "../components/DesignFrame";
import { frameMarqueeRegistry } from "../components/DesignFrame";
import { toHexColor } from "../lib/colorUtils";
import { HtmlContextualPanel } from "../components/HtmlContextualPanel";
import { HtmlLayersPanel } from "../components/HtmlLayersPanel";
import { BatchAMator } from "../components/BatchAMator";
import { SvgImportDialog, type RasterImageImport } from "../components/SvgImportDialog";
import { InsertToolbar } from "../components/InsertToolbar";
import { PasteHtmlModal, type PasteResult } from "../components/PasteHtmlModal";
import { parseHtmlDocument } from "../lib/htmlParser";
import { IconPicker } from "../components/IconPicker";
import { VersionHistoryPanel } from "../components/VersionHistoryPanel";

import { useDockablePanel } from "../hooks/useDockablePanel";
import { getTemplate, saveLocal } from "../lib/templateApi";
import { apiFetch } from "../lib/supabase";
import { getApiHeaders } from "../lib/apiKey";
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
  dedupeLayerIds,
  deleteLayerFromHtml,
  duplicateLayerInHtml,
  ensureLayerIds,
  extractLayerFromHtml,
  groupLayersInHtml,
  insertLayerIntoHtml,
  pasteLayerFromHtml,
  remapLayerTreeForTarget,
  reparentLayerInHtml,
  replaceLayerPathData,
  replaceLayerText,
  ungroupLayerInHtml,
  wrapLayersInFrame,
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
import { updateSelection } from "../lib/selectionModel";
import { generatePolygonPath, generateStarPath, clampShapeCount } from "../lib/shapePaths";
import { installAgentBridge } from "../lib/agentBridge";
import { findCanvasObjectPosition, normalizeCanvasObject } from "../lib/canvasObjects";
import { measureContainerForBake, convertContainerToGroup, convertGroupToContainer, ungroupPreservingLayout } from "../lib/groupSemantics";
import { DocumentStore, createDocumentStore } from "../lib/documentStore";
import { useToast } from "../components/Toast";
import {
  IconArrowLeft, IconSliders, IconPalette,
  IconBot, IconType, IconCopy, IconTrash,
  IconDownload, IconTag,
  IconPointer, IconHand, IconZoomIn, IconZoomOut, IconMaximize,
  IconRectangle, IconCircleOutline, IconPen, IconChevronDown,
  IconAlignLeft, IconAlignCenter, IconAlignRight,
  IconHistory, IconWand, IconGrid, IconColumns, IconRuler, IconShapes, IconEraser, IconX, IconInfo,
  IconSearch, IconLayers,
  IconUpload, IconCode,
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
  onOpenTemplate?: (id: string) => void;
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

let generatedOrphanSeq = 0;
function createOrphanId(): string {
  generatedOrphanSeq++;
  return `orphan_${Date.now().toString(36)}_${generatedOrphanSeq.toString(36)}`;
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

/**
 * Robust Shadow DOM contenteditable detection using composedPath().
 * In Shadow DOM, `e.target` is retargeted to the shadow host during capture phase,
 * and `document.activeElement` may be null or the shadow host between keystrokes.
 * `composedPath()` preserves the full event path including elements inside the shadow tree.
 */
function isEditingInShadowDOM(e: KeyboardEvent): boolean {
  const path = e.composedPath();
  for (let i = 0; i < path.length; i++) {
    const el = path[i];
    if (el instanceof HTMLElement) {
      if (el.isContentEditable || el.matches("input, textarea, select, [contenteditable='true']")) {
        return true;
      }
    }
  }
  return false;
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
const batchMenuItemStyle: React.CSSProperties = {
  textAlign: "left", background: "transparent", border: "none", borderRadius: 6,
  padding: "8px 10px", cursor: "pointer", color: "#f0ebe0", fontFamily: "inherit",
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

export function EditorV2({ templateId, onBack, onOpenTemplate }: EditorV2Props) {
  const { addToast } = useToast();
  // ── DocumentStore (transactional single source of truth, replaces 77 manual pushUndo calls) ──
  const storeRef = useRef<DocumentStore | null>(null);
  if (!storeRef.current) storeRef.current = createDocumentStore();
  const store = storeRef.current;
  // QA probe: verification agents inspect undo depth / frames without guessing.
  if (typeof window !== "undefined") (window as any).__docStore = store;
  const frames = useSyncExternalStore(store.subscribe, store.getSnapshot) as FrameData[];
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [templateName, setTemplateName] = useState("New Design");
  const [templateWorkspaceId, setTemplateWorkspaceId] = useState("default");
  const [activeTool, setActiveTool] = useState<HtmlToolName>("select");
  const [zoom, setZoom] = useState(0.5);
  const [editingZoomTopbar, setEditingZoomTopbar] = useState(false);
  const [rightPanelWidth, setRightPanelWidth] = useState(270);
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const handleRightPanelResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeStateRef.current = { startX: e.clientX, startWidth: rightPanelWidth };
    const onMove = (ev: MouseEvent) => {
      if (!resizeStateRef.current) return;
      const delta = resizeStateRef.current.startX - ev.clientX;
      const next = Math.min(560, Math.max(220, resizeStateRef.current.startWidth + delta));
      setRightPanelWidth(next);
    };
    const onUp = () => {
      resizeStateRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [rightPanelWidth]);
  // Sprint 3.5: auto-edit newly created text layers
  const [autoEditLayerId, setAutoEditLayerId] = useState<string | null>(null);

  // Agent bridge: window.futurariaAgent gives AI agents frame snapshots + layout lint
  useEffect(() => { installAgentBridge(); }, []);

  // ── Sync canUndo/canRedo from DocumentStore ──
  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      setCanUndo(store.canUndo);
      setCanRedo(store.canRedo);
    });
    // Initial sync
    setCanUndo(store.canUndo);
    setCanRedo(store.canRedo);
    return unsubscribe;
  }, [store]);

  // ── UI state ──
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const lastPushTimeRef = useRef(0);
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
  const lastRemoteUpdateRef = useRef<string | null>(null);
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
  // Sub-tabs of the "contextual" page specifically — whatever is currently
  // selected (an element or a frame), Properties/Code/Animation all inspect
  // THAT same selection, just from a different angle.
  const [contextualSubTab, setContextualSubTab] = useState<"properties" | "code" | "animation">("properties");
  // Opens the Properties panel's Code sub-tab — the single place code now
  // lives (the old left-docked Code Panel toolbar button showed the exact
  // same html/css/handlers as this tab, so it was removed as a duplicate).
  const openCodeTab = useCallback(() => {
    if (showRightPanel && rightPanelTab === "contextual" && contextualSubTab === "code") {
      setShowRightPanel(false);
      return;
    }
    setRightPanelTab("contextual");
    setContextualSubTab("code");
    setShowRightPanel(true);
  }, [showRightPanel, rightPanelTab, contextualSubTab]);
  const [multiSelectLayerIds, setMultiSelectLayerIds] = useState<string[]>([]);
  const [canvasObjects, setCanvasObjects] = useState<HtmlCanvasObject[]>([]);
  const canvasObjectsRef = useRef(canvasObjects);
  canvasObjectsRef.current = canvasObjects;
  const [showSvgImport, setShowSvgImport] = useState(false);

  // ── Figma-style selection state ──
  const [selectedFrameIds, setSelectedFrameIds] = useState<Set<string>>(new Set());
  const [contentFrameId, setContentFrameId] = useState<string | null>(null);
  const [selectedOrphanIds, setSelectedOrphanIds] = useState<Set<string>>(new Set());

  // ── Derived: active frame ──
  const selectedFrame = frames.find(f => f.id === selectedFrameId) ?? null;
  const activeHtml = selectedFrame?.html ?? DEFAULT_HTML;
  const activeCss = selectedFrame?.css ?? DEFAULT_CSS;

  // ── Undo/Redo via DocumentStore ──
  // canUndo/canRedo derived from store, synced via useEffect below

  const handleUndo = useCallback(() => {
    if (!store.canUndo) return;
    const success = store.undo();
    if (!success) return;
    const cur = store.frames as FrameData[];
    lastPushTimeRef.current = 0;
    setSelectedElement(null);
    setContentFrameId(cid => cid && cur.some(f => f.id === cid) ? cid : null);
    setSelectedFrameId(cid => cid && cur.some(f => f.id === cid) ? cid : cur[0]?.id ?? null);
    setSelectedFrameIds(current => {
      const valid = new Set([...current].filter(id => cur.some(f => f.id === id)));
      if (valid.size === 0 && cur[0]) valid.add(cur[0].id);
      return valid;
    });
    isDirtyRef.current = true;
    autoSaveRef.current(cur);
  }, [store]);

  const handleRedo = useCallback(() => {
    if (!store.canRedo) return;
    const success = store.redo();
    if (!success) return;
    const cur = store.frames as FrameData[];
    lastPushTimeRef.current = 0;
    setSelectedElement(null);
    setContentFrameId(cid => cid && cur.some(f => f.id === cid) ? cid : null);
    setSelectedFrameId(cid => cid && cur.some(f => f.id === cid) ? cid : cur[0]?.id ?? null);
    setSelectedFrameIds(current => {
      const valid = new Set([...current].filter(id => cur.some(f => f.id === id)));
      if (valid.size === 0 && cur[0]) valid.add(cur[0].id);
      return valid;
    });
    isDirtyRef.current = true;
    autoSaveRef.current(cur);
  }, [store]);

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
          const loaded: FrameData[] = t.frames.map((f: any, i: number) => {
            // Legacy designs repeat data-layer-id across elements; normalize
            // before anything addresses a layer by id (see dedupeLayerIds).
            const unique = dedupeLayerIds(f.html || "", f.css || "", createLayerId);
            return {
              id: f.id || `frame_${i}`,
              name: f.name || `Frame ${i + 1}`,
              x: f.x ?? (i * ((f.width || 1080) + FRAME_GAP)),
              y: f.y ?? 0,
              width: f.width || t.width || 1080,
              height: f.height || t.height || 1080,
              html: ensureLayerIds(unique.html, createLayerId),
              css: unique.css,
              background: f.background || "#ffffff",
            };
          });
          store.replaceAll(loaded);
          setSelectedFrameId(loaded[0]?.id ?? null);
          // Loaded data is the baseline, not an undoable user action.
          lastPushTimeRef.current = 0;
          setCanUndo(false);
          setCanRedo(false);
        } else {
          // Legacy: single template → one frame
          const unique = dedupeLayerIds(t.html || DEFAULT_HTML, t.css || DEFAULT_CSS, createLayerId);
          const single: FrameData = {
            id: "frame_0",
            name: t.name || "Frame 1",
            x: 0, y: 0,
            width: t.width || 1080,
            height: t.height || 1080,
            html: ensureLayerIds(unique.html, createLayerId),
            css: unique.css,
            background: "#ffffff",
          };
          store.replaceAll([single]);
          setSelectedFrameId(single.id);
          // Loaded data is the baseline, not an undoable user action.
          lastPushTimeRef.current = 0;
          setCanUndo(false);
          setCanRedo(false);
        }
        const loadedCanvasObjects = Array.isArray(t.canvasObjects)
          ? t.canvasObjects.map((object: any, index: number) => normalizeCanvasObject(object, index))
          : [];
        canvasObjectsRef.current = loadedCanvasObjects;
        setCanvasObjects(loadedCanvasObjects);
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
      canvasObjects: canvasObjectsRef.current,
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

  /**
   * Explicit save (Ctrl/⌘+S or the Save button): flush whatever the debounce
   * is holding, then mark a permanent version. Marked versions are never
   * rotated away, unlike the automatic ones.
   */
  const [savingVersion, setSavingVersion] = useState(false);
  const handleSaveVersion = useCallback(async () => {
    if (savingVersion) return;
    setSavingVersion(true);
    try {
      // ── Phase 1: Save frames to server (blocking — this MUST succeed) ──
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
      const currentFrames = framesRef.current;
      const active = currentFrames.find(f => f.id === selectedFrameId) || currentFrames[0];
      await apiFetch(`/api/templates/${templateId}`, {
        method: "PUT",
        body: JSON.stringify({
          frames: currentFrames.map(f => ({
            ...f,
            contentHash: simpleHash((f.html || "") + "||" + (f.css || "")),
            lastModifiedBy: "human",
            lastModifiedAt: new Date().toISOString(),
          })),
          canvasObjects: canvasObjectsRef.current,
          html: active?.html || "",
          css: active?.css || "",
          name: templateName,
        }),
      });
      isDirtyRef.current = false;

      // ── Phase 2: Create version snapshot (non-blocking — bonus, not required) ──
      try {
        const res = await apiFetch<any>(`/api/templates/${templateId}/versions`, {
          method: "POST",
          body: JSON.stringify({ kind: "marked", label: "Guardado manual" }),
        });
        if (res?.data) {
          addToast("Versión guardada en el historial.", "success");
        } else {
          addToast("Diseño guardado correctamente.", "success");
        }
      } catch {
        // Frames saved successfully — version creation is a bonus feature.
        addToast("Diseño guardado correctamente.", "success");
      }
      window.dispatchEvent(new Event("futuraria-version-saved"));
    } catch (err: any) {
      addToast(`No se pudo guardar el diseño: ${err?.message || "error de conexión"}`, "error");
    }
    setSavingVersion(false);
  }, [savingVersion, templateId, selectedFrameId, templateName, addToast]);

  const commitCanvasObjects = useCallback((next: HtmlCanvasObject[], updatedFrames = framesRef.current) => {
    canvasObjectsRef.current = next;
    setCanvasObjects(next);
    autoSave(updatedFrames);
  }, [autoSave]);

  // ── Flush pending save on tab close / navigation ──
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (isDirtyRef.current && saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        // Sync: send last known state via sendBeacon (fire-and-forget)
        const lastFrames = framesRef.current;
        const active = lastFrames.find(f => f.id === selectedFrameId) || lastFrames[0];
        const payload = JSON.stringify({
          frames: lastFrames.map(f => ({...f, contentHash: simpleHash((f.html || "") + "||" + (f.css || "")), lastModifiedBy: "human", lastModifiedAt: new Date().toISOString()})),
          canvasObjects: canvasObjectsRef.current,
          html: active?.html || "",
          css: active?.css || "",
          name: templateName,
        });
        try { navigator.sendBeacon(`/api/templates/${templateId}`, new Blob([payload], { type: "application/json" })); } catch {}
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [templateId, selectedFrameId, templateName]);

  // AI/remote-authored content can arrive pre-grouped — an agent composing a
  // few related elements (a photo + its caption, an icon + label) naturally
  // wraps them in one group, the same shorthand a human would reach for. But
  // this app's default is a flat layer list: every meaningful object
  // independently selectable and movable. Whenever a frame's html changes
  // from OUTSIDE this session (an MCP tool call, another collaborator), find
  // any TOP-LEVEL group wrapper in the new html and dissolve it the exact
  // same safe way the user's own "Ungroup" button does — bake each child's
  // live RENDERED position onto it before removing the wrapper, so nothing
  // shifts. Only top-level: a legitimately compound object (an icon built
  // from nested paths) keeps its internal structure.
  const autoUngroupIncomingFrame = useCallback((frameId: string) => {
    // Two rAFs: the first commits the state update, the second waits for
    // the browser to have actually painted the new html so getBoundingClientRect
    // reflects it — measuring one frame too early reads the STALE layout.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const frame = (framesRef.current as FrameData[]).find(f => f.id === frameId);
        if (!frame) return;
        const doc = new DOMParser().parseFromString(frame.html, "text/html");
        const topGroups = [...doc.body.children].filter(el => el.getAttribute("data-layer-kind") === "group");
        if (topGroups.length === 0) return;
        let html = frame.html;
        for (const el of topGroups) {
          const layerId = el.getAttribute("data-layer-id");
          if (!layerId) continue;
          const bake = measureContainerForBake(frameId, layerId);
          if (!bake) continue; // not rendered yet / not found — leave it grouped rather than guess
          const next = ungroupPreservingLayout(html, bake);
          if (next) html = next;
        }
        if (html === frame.html) return;
        const updated = (framesRef.current as FrameData[]).map(f => f.id === frameId ? { ...f, html } : f);
        store.replaceAll(updated);
        autoSave(updated);
      });
    });
  }, [autoSave]);

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
      const curFrames = store.frames as FrameData[];
      store.replaceAll(curFrames.map(f =>
        f.id === targetFrameId
          ? { ...f, html: newHtml, css: newCss }
          : f
      ));
      autoUngroupIncomingFrame(targetFrameId);
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
          if (remoteUpdated && remoteUpdated !== lastRemoteUpdateRef.current) {
            if (lastRemoteUpdateRef.current !== null) {
              const remoteCanvasObjects = Array.isArray(t.canvasObjects)
                ? t.canvasObjects.map((object: any, index: number) => normalizeCanvasObject(object, index))
                : [];
              if (JSON.stringify(canvasObjectsRef.current) !== JSON.stringify(remoteCanvasObjects)) {
                canvasObjectsRef.current = remoteCanvasObjects;
                setCanvasObjects(remoteCanvasObjects);
              }
              // Safety: never replace non-empty local frames with empty remote frames
              if (t.frames && Array.isArray(t.frames) && t.frames.length > 0) {
                // Only update if frame data actually differs (avoid unnecessary re-renders)
                const localJson = JSON.stringify(framesRef.current);
                const remoteJson = JSON.stringify(t.frames);
                if (localJson !== remoteJson) {
                  store.replaceAll(t.frames as FrameData[]);
                  for (const rf of t.frames as FrameData[]) autoUngroupIncomingFrame(rf.id);
                }
              } else if (framesRef.current.length > 0 && (!t.frames || t.frames.length === 0)) {
                // Remote has no frames but we do → re-save our frames as recovery
                autoSave(framesRef.current);
              } else if (t.html !== undefined || t.css !== undefined) {
                const _pf = store.frames as FrameData[];
                store.replaceAll(_pf.map(f =>
                  f.id === selectedFrameId
                    ? { ...f, html: t.html || f.html, css: t.css || f.css }
                    : f
                ));
                if (selectedFrameId) autoUngroupIncomingFrame(selectedFrameId);
              }
            }
            lastRemoteUpdateRef.current = remoteUpdated;
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
    // Coalesce: only push undo if >300ms since last push (avoids one-undo-per-keystroke)
    const now = Date.now();
    if (now - lastPushTimeRef.current > 300) {
            lastPushTimeRef.current = now;
    }
    store.replaceAllWithUndo(updated, "code edit");
    autoSave(updated);
  }, [selectedFrameId, frames, autoSave]);

  const handleCssChange = useCallback((newCss: string) => {
    if (!selectedFrameId) return;
    const updated = frames.map(f =>
      f.id === selectedFrameId ? { ...f, css: newCss } : f
    );
    const now = Date.now();
    if (now - lastPushTimeRef.current > 300) {
            lastPushTimeRef.current = now;
    }
    store.replaceAllWithUndo(updated, "code edit");
    autoSave(updated);
  }, [selectedFrameId, frames, autoSave]);

  // ── Frame CSS (+ optional HTML) change from DesignFrame (drag/resize) ──
  const handleFrameCssChange = useCallback((frameId: string, newCss: string, newHtml?: string) => {
    const updated = frames.map(f =>
      f.id === frameId ? { ...f, css: newCss, ...(newHtml ? { html: newHtml } : {}) } : f
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [frames, autoSave]);

  const handleFrameHtmlChange = useCallback((frameId: string, newHtml: string) => {
    const updated = frames.map(f =>
      f.id === frameId ? { ...f, html: newHtml } : f
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [frames, autoSave]);

  // ── Figma-style frame selection handlers ──
  const handleSelectFrame = useCallback((id: string | null) => {
    setSelectedFrameId(id);
    setSelectedFrameIds(id ? new Set([id]) : new Set());
    setContentFrameId(null);
    setSelectedElement(null);
    setLayerSelectionRequest(null);
    setMultiSelectLayerIds([]);
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
    setMultiSelectLayerIds([]);
  }, []);

  const handleMarqueeSelect = useCallback((ids: Set<string>) => {
    setSelectedFrameIds(ids);
    if (ids.size > 0) setSelectedFrameId(Array.from(ids)[0]);
    else setSelectedFrameId(null);
    setContentFrameId(null);
    setSelectedElement(null);
    setMultiSelectLayerIds([]);
  }, []);

  const handleMarqueeSelectOrphans = useCallback((ids: Set<string>) => {
    setSelectedOrphanIds(ids);
    if (ids.size > 0) setSelectedFrameId(null);
  }, []);

  const handleEnterContentMode = useCallback((frameId: string) => {
    setContentFrameId(frameId);
    setSelectedFrameId(frameId);
    setSelectedFrameIds(new Set([frameId]));
    setSelectedOrphanIds(new Set());
  }, []);

  // ── Orphan (canvas-level object) handlers ──
  const handleSelectOrphan = useCallback((id: string | null) => {
    setSelectedOrphanIds(id ? new Set([id]) : new Set());
    setContentFrameId(null);
    setSelectedElement(null);
    if (id) setSelectedFrameId(null);
    setMultiSelectLayerIds([]);
  }, []);

  const handleOrphanShiftClick = useCallback((id: string) => {
    setSelectedOrphanIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setContentFrameId(null);
    setSelectedElement(null);
    setMultiSelectLayerIds([]);
  }, []);

  const handleOrphanMove = useCallback((id: string, x: number, y: number) => {
    commitCanvasObjects(canvasObjectsRef.current.map(object =>
      object.id === id ? { ...object, x: Math.round(x), y: Math.round(y) } : object
    ));
  }, [commitCanvasObjects]);

  const handleDeleteOrphan = useCallback((id: string) => {
    commitCanvasObjects(canvasObjectsRef.current.filter(object => object.id !== id));
    setSelectedOrphanIds(prev => { const next = new Set(prev); next.delete(id); return next; });
  }, [commitCanvasObjects]);

  /** Create a canvas-level orphan object from a drawing tool on empty canvas. */
  const handleCreateOrphanFromTool = useCallback((type: string, x: number, y: number, w: number, h: number) => {
    const orphanId = createOrphanId();
    let html = "";
    let css = "";
    const nameMap: Record<string, string> = { rect: "Rectangle", circle: "Circle", triangle: "Triangle", star: "Star", polygon: "Polygon", text: "Text", pen: "Bezier", pencil: "Pencil Stroke" };
    const oname = nameMap[type] || type;
    if (type === "rect") {
      html = `<div data-layer-id="${orphanId}" data-layer-name="${oname}" data-layer-kind="shape"></div>`;
      css = `[data-layer-id="${orphanId}"] {\n  position: absolute;\n  left: 0;\n  top: 0;\n  width: ${w}px;\n  height: ${h}px;\n  background: #3B82F6;\n  border-radius: 8px;\n}`;
    } else if (type === "circle") {
      html = `<div data-layer-id="${orphanId}" data-layer-name="${oname}" data-layer-kind="shape"></div>`;
      css = `[data-layer-id="${orphanId}"] {\n  position: absolute;\n  left: 0;\n  top: 0;\n  width: ${w}px;\n  height: ${h}px;\n  background: #EF4444;\n  border-radius: 50%;\n}`;
    } else if (type === "triangle") {
      html = `<svg data-layer-id="${orphanId}" data-layer-name="${oname}" data-layer-kind="svg" viewBox="0 0 ${w} ${h}" style="position:absolute;left:0;top:0;width:${w}px;height:${h}px;overflow:visible;"><path d="M${w / 2} 0 L0 ${h} L${w} ${h} Z" fill="#10B981" stroke="#059669" stroke-width="2"/></svg>`;
      css = `[data-layer-id="${orphanId}"] {\n  position: absolute;\n  left: 0;\n  top: 0;\n  width: ${w}px;\n  height: ${h}px;\n  overflow: visible;\n}`;
    } else if (type === "star") {
      const s = Math.max(w, h);
      const d = generateStarPath(s, 5, 0.4);
      html = `<svg data-layer-id="${orphanId}" data-layer-name="${oname}" data-layer-kind="svg" data-shape="star" viewBox="0 0 ${s} ${s}" style="position:absolute;left:0;top:0;width:${s}px;height:${s}px;overflow:visible;"><path d="${d}" fill="#F59E0B" stroke="#D97706" stroke-width="2"/></svg>`;
      css = `[data-layer-id="${orphanId}"] {\n  position: absolute;\n  left: 0;\n  top: 0;\n  width: ${s}px;\n  height: ${s}px;\n  overflow: visible;\n}`;
    } else if (type === "polygon") {
      const n = clampShapeCount(6);
      const s = Math.max(w, h);
      const d = generatePolygonPath(s, n);
      html = `<svg data-layer-id="${orphanId}" data-layer-name="${oname}" data-layer-kind="svg" data-shape="polygon" viewBox="0 0 ${s} ${s}" style="position:absolute;left:0;top:0;width:${s}px;height:${s}px;overflow:visible;"><path d="${d}" fill="#8B5CF6" stroke="#7C3AED" stroke-width="2"/></svg>`;
      css = `[data-layer-id="${orphanId}"] {\n  position: absolute;\n  left: 0;\n  top: 0;\n  width: ${s}px;\n  height: ${s}px;\n  overflow: visible;\n}`;
    } else if (type === "pen" || type === "pencil") {
      html = `<svg data-layer-id="${orphanId}" data-layer-name="${oname}" data-layer-kind="bezier" viewBox="0 0 ${w} ${h}" style="position:absolute;left:0;top:0;width:${w}px;height:${h}px;overflow:visible;"><path d="M 0 ${h} C ${w * 0.25} ${h * 0.25}, ${w * 0.75} ${h * 0.75}, ${w} 0" fill="none" stroke="#111827" stroke-width="2" stroke-linecap="round"/></svg>`;
      css = `[data-layer-id="${orphanId}"] {
  position: absolute;
  left: 0;
  top: 0;
  width: ${w}px;
  height: ${h}px;
  overflow: visible;
}`;
    } else {
      html = `<div data-layer-id="${orphanId}" data-layer-name="${oname}" data-layer-kind="text" style="font-size:24px;color:#333;position:absolute;left:0;top:0;">Type something</div>`;
      css = `[data-layer-id="${orphanId}"] {\n  font-size: 24px;\n  color: #333;\n  position: absolute;\n  left: 0;\n  top: 0;\n}`;
    }
    const newOrphan: HtmlCanvasObject = {
      id: orphanId,
      name: oname,
      kind: type === "text" ? "text" : type === "pen" || type === "pencil" ? "bezier" : "shape",
      frameId: null,
      html, css,
      x: Math.round(x), y: Math.round(y),
      width: w, height: h,
      zIndex: canvasObjectsRef.current.length + frames.length,
    };
    commitCanvasObjects([...canvasObjectsRef.current, newOrphan]);
    setSelectedOrphanIds(new Set([orphanId]));
    setActiveTool("select");
    // Text starts in edit mode so the user can type immediately
    if (type === "text") setAutoEditOrphanId(orphanId);
  }, [frames.length, commitCanvasObjects]);

  const [autoEditOrphanId, setAutoEditOrphanId] = useState<string | null>(null);

  /** Commit inline-edited orphan HTML (text typed on the canvas). */
  const handleOrphanHtmlChange = useCallback((id: string, html: string) => {
    const updated = canvasObjectsRef.current.map(o => o.id === id ? { ...o, html } : o);
    commitCanvasObjects(updated);
  }, [commitCanvasObjects]);

  /** Orphan CSS change (from inline editing or context panel) */
  const handleOrphanCssChange = useCallback((orphanId: string, newCss: string, newHtml?: string) => {
    commitCanvasObjects(canvasObjectsRef.current.map(o =>
      o.id === orphanId ? { ...o, css: newCss, ...(newHtml !== undefined ? { html: newHtml } : {}) } : o
    ));
  }, [commitCanvasObjects]);

  /** Reorder orphan z-index in layers panel */
  const handleOrphanZReorder = useCallback((orphanId: string, newZ: number) => {
    const next = canvasObjectsRef.current
      .map(object => object.id === orphanId ? { ...object, zIndex: newZ } : object)
      .sort((a, b) => a.zIndex - b.zIndex);
    commitCanvasObjects(next);
  }, [commitCanvasObjects]);

  /** Move a layer from a frame to canvas (orphan) preserving visual position */
  const handleMoveLayerToCanvas = useCallback((frameId: string, layerId: string) => {
    const frame = frames.find(f => f.id === frameId);
    if (!frame) return;
    const extracted = extractLayerFromHtml(frame.html, layerId);
    if (!extracted) return;
    const transferredCss = cloneLayerTreeCss(frame.css, extracted.layerHtml, extracted.layerIds, new Map(extracted.layerIds.map(id => [id, id])), 0);
    const sourceCss = removeLayersCss(frame.css, extracted.layerIds);
    // Get visual position: use frame's position as offset
    const newOrphan: HtmlCanvasObject = {
      id: createOrphanId(),
      name: /data-layer-name=["']([^"']+)["']/i.exec(extracted.layerHtml)?.[1] || "Object",
      kind: /data-layer-kind=["']([^"']+)["']/i.exec(extracted.layerHtml)?.[1] || "shape",
      frameId: null,
      html: extracted.layerHtml,
      css: transferredCss,
      x: frame.x, y: frame.y,
      width: frame.width, height: frame.height,
      zIndex: canvasObjectsRef.current.length + frames.length,
    };
    const updated = frames.map(f => f.id === frameId ? { ...f, html: extracted.html, css: sourceCss } : f);
    store.replaceAllWithUndo(updated, "move to canvas");
    commitCanvasObjects([...canvasObjectsRef.current, newOrphan], updated);
    addToast("Layer moved to canvas.", "success");
  }, [frames, commitCanvasObjects, addToast]);

  /** Move an orphan into a target frame */
  const handleMoveOrphanToFrame = useCallback((orphanId: string, targetFrameId: string) => {
    const orphan = canvasObjects.find(o => o.id === orphanId);
    const targetFrame = frames.find(f => f.id === targetFrameId);
    if (!orphan || !targetFrame) return;
    const inserted = insertLayerIntoHtml(targetFrame.html, orphan.html, null, "inside");
    if (!inserted) { addToast("Could not insert object into frame.", "error"); return; }
    const combinedCss = mergeCssRules(targetFrame.css, orphan.css);
    const updated = frames.map(f => f.id === targetFrameId ? { ...f, html: inserted.html, css: combinedCss } : f);
    store.replaceAllWithUndo(updated, "move to frame");
    commitCanvasObjects(canvasObjectsRef.current.filter(object => object.id !== orphanId), updated);
    setSelectedOrphanIds(prev => { const next = new Set(prev); next.delete(orphanId); return next; });
    addToast("Object moved into frame.", "success");
  }, [canvasObjects, frames, commitCanvasObjects, addToast]);

  const handleRenameFrame = useCallback((frameId: string, newName: string) => {
        const updated = frames.map(f => f.id === frameId ? { ...f, name: newName } : f);
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [frames, autoSave]);

  const handleMultiFrameMove = useCallback((moves: { id: string; x: number; y: number }[]) => {

    const moveMap = new Map(moves.map(m => [m.id, { x: m.x, y: m.y }]));
    const updated = frames.map(f =>
      moveMap.has(f.id) ? { ...f, x: moveMap.get(f.id)!.x, y: moveMap.get(f.id)!.y } : f
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [frames, autoSave]);

  // ── Frame operations ──
  const handleFrameMove = useCallback((id: string, x: number, y: number) => {
    const updated = frames.map(f =>
      f.id === id ? { ...f, x: Math.round(x), y: Math.round(y) } : f
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [frames, autoSave]);

  const handleFrameResize = useCallback((id: string, width: number, height: number, x: number, y: number) => {
    const updated = frames.map(f =>
      f.id === id ? { ...f, x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) } : f
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [frames, autoSave]);

  const handleFrameBackgroundChange = useCallback((bg: string) => {
    if (!selectedFrameId) return;
    const updated = frames.map(f =>
      f.id === selectedFrameId ? { ...f, background: bg } : f
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [selectedFrameId, frames, autoSave]);

  const handleFrameDimensionChange = useCallback((field: "width" | "height", value: number) => {
    if (!selectedFrameId || !value || value < 10) return;
    const updated = frames.map(f =>
      f.id === selectedFrameId ? { ...f, [field]: Math.round(value) } : f
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [selectedFrameId, frames, autoSave]);

  const handleFrameBackgroundImage = useCallback(async (file: File) => {
    if (!selectedFrameId) return;
    try {
      // Read file as base64
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });
      // Upload to Supabase Storage via API
      const res = await apiFetch<{ url: string }>("/api/assets/upload-file", {
        method: "POST",
        body: JSON.stringify({
          name: file.name,
          data: b64,
          filename: file.name,
          mimeType: file.type,
          workspaceId: templateWorkspaceId || undefined,
        }),
      });
      // Set frame background to cover image
      const bgValue = `url(${res.url}) center/cover no-repeat`;
      const updated = frames.map(f =>
        f.id === selectedFrameId ? { ...f, background: bgValue } : f
      );
      store.replaceAllWithUndo(updated, "edit");
      autoSave(updated);
      addToast("Background image applied", "success");
    } catch (err: any) {
      console.error("[BG_IMAGE] Upload failed:", err);
      addToast("Failed to upload background image", "error");
    }
  }, [selectedFrameId, frames, autoSave, templateWorkspaceId, addToast]);

  const deleteFrames = useCallback((frameIds: Set<string>): boolean => {
    if (frameIds.size === 0) return false;
    const updated = frames.filter(frame => !frameIds.has(frame.id));
    if (updated.length === 0 || updated.length === frames.length) return false;

    store.replaceAllWithUndo(updated, "edit");
    setSelectedFrameId(updated[0]?.id ?? null);
    setSelectedFrameIds(updated[0]?.id ? new Set([updated[0].id]) : new Set());
    setContentFrameId(null);
    setSelectedElement(null);
    setLayerSelectionRequest(null);
    autoSave(updated);
    return true;
  }, [frames, autoSave]);

  const deleteSelectedFrame = useCallback(() => {
    if (!selectedFrameId) return;
    deleteFrames(new Set([selectedFrameId]));
  }, [selectedFrameId, deleteFrames]);

  const duplicateFrame = useCallback(() => {
    const src = frames.find(f => f.id === selectedFrameId);
    if (!src) return;
    const clone = cloneFrame(src, src.x + src.width + FRAME_GAP, src.y, `Frame ${nextFrameNumber(frames)}`);
        const updated = [...frames, clone];
    store.replaceAllWithUndo(updated, "edit");
    setSelectedFrameId(clone.id);
    setSelectedFrameIds(new Set([clone.id]));
    setContentFrameId(null);
    setSelectedElement(null);
    autoSave(updated);
  }, [selectedFrameId, frames, autoSave]);

  const handleDuplicateFramesAtPositions = useCallback((copies: { sourceId: string; x: number; y: number }[]) => {
    if (copies.length === 0) return;
    let frameNumber = nextFrameNumber(frames);
    const clones = copies.flatMap(({ sourceId, x, y }) => {
      const source = frames.find(frame => frame.id === sourceId);
      if (!source) return [];
      return [cloneFrame(source, x, y, `Frame ${frameNumber++}`)];
    });
    if (clones.length === 0) return;

        const updated = [...frames, ...clones];
    store.replaceAllWithUndo(updated, "edit");
    setSelectedFrameId(clones[0].id);
    setSelectedFrameIds(new Set(clones.map(frame => frame.id)));
    setSelectedElement(null);
    autoSave(updated);
  }, [frames, autoSave]);

  const handleLayerStackChange = useCallback((frameId: string, change: LayerStackChange) => {
    const frame = frames.find(item => item.id === frameId);
    if (!frame) return;

    const stackedCss = applyLayerStack(frame.css, change.siblingLayerIds);
    const updated = frames.map(item => item.id === frameId
      ? { ...item, html: change.html, css: stackedCss }
      : item);
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [frames, autoSave]);

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
      store.replaceAllWithUndo(updated, "edit");
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

    store.replaceAllWithUndo(updated, "edit");
    setSelectedFrameId(targetFrameId);
    setSelectedFrameIds(new Set());
    setContentFrameId(targetFrameId);
    setSelectedElement(null);
    autoSave(updated);
  }, [frames, autoSave, addToast]);

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
    store.replaceAllWithUndo(reordered, "edit");
    autoSave(reordered);
  }, [frames, autoSave]);

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
  const handleSelectLayerElement = useCallback((frameId: string, layerId: string, path?: number[], additive = false) => {
    setSelectedFrameId(frameId);
    setSelectedFrameIds(new Set());
    setContentFrameId(frameId);
    setMultiSelectLayerIds(current => updateSelection(current, layerId, additive && selectedFrameId === frameId));
    setLayerSelectionRequest({
      frameId,
      layerId,
      path,
      requestId: ++layerSelectionSequenceRef.current,
    });
  }, [selectedFrameId]);

  const handleLayerSelectionChange = useCallback((frameId: string, layerIds: string[]) => {
    setMultiSelectLayerIds(layerIds);
    if (layerIds.length === 0) return;
    setSelectedFrameId(frameId);
    setSelectedFrameIds(new Set());
    setContentFrameId(frameId);
    setSelectedOrphanIds(new Set());
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
      const d = generateStarPath(s, 5, 0.4);
      html = `<svg data-layer-id="${layerId}" data-layer-name="Star" data-layer-kind="svg" data-shape="star" data-shape-count="5" data-shape-ratio="0.4" data-shape-corner-radius="0" data-shape-size="${s}" viewBox="0 0 ${s} ${s}" style="position:absolute;left:${x}px;top:${y}px;width:${s}px;height:${s}px;overflow:visible;"><path d="${d}" fill="#F59E0B" stroke="#D97706" stroke-width="2"/></svg>`;
      css = `[data-layer-id="${layerId}"] {\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n  width: ${s}px;\n  height: ${s}px;\n  overflow: visible;\n}\n`;
    } else if (type === "polygon") {
      const n = clampShapeCount(sides || 6);
      const s = 120;
      const d = generatePolygonPath(s, n);
      html = `<svg data-layer-id="${layerId}" data-layer-name="Polygon" data-layer-kind="svg" data-shape="polygon" data-shape-count="${n}" data-shape-corner-radius="0" data-shape-size="${s}" viewBox="0 0 ${s} ${s}" style="position:absolute;left:${x}px;top:${y}px;width:${s}px;height:${s}px;overflow:visible;"><path d="${d}" fill="#8B5CF6" stroke="#7C3AED" stroke-width="2"/></svg>`;
      css = `[data-layer-id="${layerId}"] {\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n  width: ${s}px;\n  height: ${s}px;\n  overflow: visible;\n}\n`;
    } else {
      html = `<div data-layer-id="${layerId}" data-layer-name="Text" data-layer-kind="text" style="font-size:24px;color:#333;position:absolute;left:${x}px;top:${y}px;">Type something</div>`;
      css = `[data-layer-id="${layerId}"] {\n  font-size: 24px;\n  color: #333;\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n}\n`;
    }
    const updated = frames.map(f =>
      f.id === selectedFrameId
        ? { ...f, html: f.html + "\n" + html, css: f.css + "\n" + css }
        : f
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    setAutoEditLayerId(layerId); // Sprint 3.5: auto-edit new text
    setActiveTool("select"); // Switch back to select after placing
  }, [selectedFrameId, frames, autoSave]);

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
      const d = generateStarPath(s, 5, 0.4);
      html = `<svg data-layer-id="${layerId}" data-layer-name="Star" data-layer-kind="svg" data-shape="star" data-shape-count="5" data-shape-ratio="0.4" data-shape-corner-radius="0" data-shape-size="${s}" viewBox="0 0 ${s} ${s}" style="position:absolute;left:${x}px;top:${y}px;width:${s}px;height:${s}px;overflow:visible;"><path d="${d}" fill="#F59E0B" stroke="#D97706" stroke-width="2"/></svg>`;
      css = `[data-layer-id="${layerId}"] {\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n  width: ${s}px;\n  height: ${s}px;\n  overflow: visible;\n}\n`;
    } else {
      // polygon — parametric path with configurable sides
      const n = clampShapeCount(sides || 6);
      const s = Math.max(w, h);
      const d = generatePolygonPath(s, n);
      html = `<svg data-layer-id="${layerId}" data-layer-name="Polygon" data-layer-kind="svg" data-shape="polygon" data-shape-count="${n}" data-shape-corner-radius="0" data-shape-size="${s}" viewBox="0 0 ${s} ${s}" style="position:absolute;left:${x}px;top:${y}px;width:${s}px;height:${s}px;overflow:visible;"><path d="${d}" fill="#8B5CF6" stroke="#7C3AED" stroke-width="2"/></svg>`;
      css = `[data-layer-id="${layerId}"] {\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n  width: ${s}px;\n  height: ${s}px;\n  overflow: visible;\n}\n`;
    }
    const updated = frames.map(f =>
      f.id === selectedFrameId
        ? { ...f, html: f.html + "\n" + html, css: f.css + "\n" + css }
        : f
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    setActiveTool("select");
  }, [selectedFrameId, frames, autoSave]);

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
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [selectedFrameId, frames, autoSave]);

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
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [frames, autoSave]);

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
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    setActiveTool("select");
    if (analysis.degeneracy === "point") {
      addToast("El trazado degeneró en un punto. Se conservó para que puedas corregir sus anclas.", "error");
    } else if (analysis.selfIntersections > 0 || analysis.singularities > 0) {
      addToast(`Trazado creado con ${analysis.selfIntersections} auto-intersección(es) y ${analysis.singularities} punto(s) singular(es).`, "info");
    }
  }, [selectedFrameId, frames, autoSave, addToast]);

  // ── Frame tool (F/A): click = 100×100 frame, drag = custom dimensions ──
  const handleCreateFrameAt = useCallback((x: number, y: number, w: number, h: number) => {
    const newFrame: FrameData = {
      id: createFrameId(),
      name: `Frame ${nextFrameNumber(frames)}`,
      x, y, width: w, height: h,
      html: "",
      css: `body {\n  font-family: 'Inter', system-ui, sans-serif;\n  position: relative;\n  width: ${w}px;\n  height: ${h}px;\n  margin: 0;\n  background: #ffffff;\n  overflow: hidden;\n}\n`,
      background: "#ffffff",
    };
        const updated = [...frames, newFrame];
    store.replaceAllWithUndo(updated, "edit");
    setSelectedFrameId(newFrame.id);
    setSelectedFrameIds(new Set([newFrame.id]));
    autoSave(updated);
    setActiveTool("select");
  }, [frames, autoSave]);

  // ── Text tool drag: fixed-size text box (click creates auto-width text) ──
  const handleAddTextBox = useCallback((x: number, y: number, w: number, h: number, initialText?: string) => {
    if (!selectedFrameId) return;
    const layerId = createLayerId();
    const text = (initialText ?? "Type something")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = `<div data-layer-id="${layerId}" data-layer-name="Text" data-layer-kind="text" data-text-resizing="fixed" style="font-size:24px;color:#333;position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;overflow:hidden;">${text}</div>`;
    const css = `[data-layer-id="${layerId}"] {\n  font-size: 24px;\n  color: #333;\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n  width: ${w}px;\n  height: ${h}px;\n  overflow: hidden;\n}\n`;
    const updated = frames.map(f =>
      f.id === selectedFrameId
        ? { ...f, html: f.html + "\n" + html, css: f.css + "\n" + css }
        : f
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    setAutoEditLayerId(layerId); // Sprint 3.5: auto-edit new text
    setActiveTool("select");
  }, [selectedFrameId, frames, autoSave]);

  // Pasting plain OS-clipboard text (not something copied from inside this
  // editor) creates a new text block with that content, dropped near the
  // center of whichever frame is selected.
  const handlePasteTextAsBlock = useCallback((text: string) => {
    if (!selectedFrameId) { addToast("Selecciona un frame primero.", "error"); return; }
    const frame = frames.find(f => f.id === selectedFrameId);
    if (!frame) return;
    const w = Math.min(400, Math.max(160, frame.width - 80));
    const h = 120;
    const x = Math.max(20, Math.round((frame.width - w) / 2));
    const y = Math.max(20, Math.round((frame.height - h) / 2));
    handleAddTextBox(x, y, w, h, text);
  }, [selectedFrameId, frames, handleAddTextBox, addToast]);

  // Shared "apply parsed HTML/CSS as a frame" logic — used by both the
  // PasteHtmlModal (manual import) and the native-paste "paste as image" path.
  // Pasted code from an external chat (told to mark icons with data-icon-hint
  // instead of drawing them itself — see the icon-hint convention shared with
  // image_to_design/import_design) gets those placeholders swapped for real
  // Phosphor SVGs before the frame is created. Only fires when the marker is
  // actually present, so ordinary pastes take the exact same synchronous path
  // as before.
  const applyPastedHtmlAsFrame = useCallback(async (result: PasteResult) => {
    if (result.html?.includes("data-icon-hint")) {
      try {
        const res = await apiFetch<any>("/mcp", {
          method: "POST",
          body: JSON.stringify({ jsonrpc: "2.0", method: "resolve_icon_hints", params: { html: result.html }, id: 1 }),
        });
        const content = res?.result?.content?.[0];
        const data = content?.type === "text" && content.text ? JSON.parse(content.text) : null;
        if (data?.html) result = { ...result, html: data.html };
      } catch { /* fall through and apply the unresolved HTML rather than block the paste */ }
    }
    const w = result.width || 1080;
    const h = result.height || 1080;
    if (selectedFrameId) {
      const updated = frames.map(f =>
        f.id === selectedFrameId ? { ...f, html: result.html, css: result.css } : f
      );
      store.replaceAllWithUndo(updated, "edit");
      autoSave(updated);
      openCodeTab();
    } else {
      const pos = (() => {
        if (frames.length === 0) return { x: 100, y: 100 };
        const last = frames[frames.length - 1];
        return { x: last.x + last.width + FRAME_GAP, y: last.y };
      })();
      const newFrame: FrameData = {
        id: createFrameId(),
        name: `Frame ${nextFrameNumber(frames)}`,
        x: pos.x, y: pos.y,
        width: w, height: h,
        html: result.html,
        css: result.css,
        background: "#ffffff",
      };
      const updated = [...frames, newFrame];
      store.replaceAllWithUndo(updated, "edit");
      setSelectedFrameId(newFrame.id);
      setSelectedFrameIds(new Set([newFrame.id]));
      autoSave(updated);
      openCodeTab();
    }
  }, [selectedFrameId, frames, autoSave, openCodeTab]);

  // Detects clipboard text that's plausibly a renderable design (HTML doc/fragment
  // or a JSON template) rather than plain prose — used to trigger the paste-choice dialog.
  const looksLikeRenderableCode = useCallback((text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (/^<!doctype html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return true;
    // A handful of real HTML tags (not just one stray "<" in prose)
    const tagMatches = trimmed.match(/<\/?(div|span|section|header|footer|nav|button|img|a|p|h[1-6]|ul|li|table|style)\b/gi);
    if (tagMatches && tagMatches.length >= 2) return true;
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && (parsed.html || parsed.frames || parsed.css)) return true;
      } catch { /* not valid JSON — fall through */ }
    }
    return false;
  }, []);

  const PASTE_SNOOZE_KEY = "futuraria:pasteImagePromptSnoozeUntil";
  const isPasteImagePromptSnoozed = useCallback((): boolean => {
    const raw = localStorage.getItem(PASTE_SNOOZE_KEY);
    if (!raw) return false;
    const until = parseInt(raw, 10);
    return Number.isFinite(until) && Date.now() < until;
  }, []);
  const snoozePasteImagePrompt = useCallback((days: number) => {
    const until = Date.now() + days * 24 * 60 * 60 * 1000;
    localStorage.setItem(PASTE_SNOOZE_KEY, String(until));
  }, []);

  const [pasteChoiceText, setPasteChoiceText] = useState<string | null>(null);
  const [pasteChoiceSnoozeDays, setPasteChoiceSnoozeDays] = useState(7);
  const [pasteChoiceSnoozeEnabled, setPasteChoiceSnoozeEnabled] = useState(false);

  const resolvePasteAsImage = useCallback(async (text: string) => {
    try {
      const trimmed = text.trim();
      if (trimmed.startsWith("{")) {
        const parsed = JSON.parse(trimmed);
        await applyPastedHtmlAsFrame({ html: parsed.html || "", css: parsed.css || "", width: parsed.width, height: parsed.height });
      } else {
        const parsed = parseHtmlDocument(trimmed);
        await applyPastedHtmlAsFrame({ html: parsed.html, css: parsed.css, width: parsed.width, height: parsed.height });
      }
      addToast("✓ Pegado como diseño", "success");
    } catch {
      addToast("No se pudo interpretar el contenido pegado, se pegó como texto.", "error");
      handlePasteTextAsBlock(text);
    }
  }, [applyPastedHtmlAsFrame, handlePasteTextAsBlock, addToast]);

  const handlePasteChoiceConfirm = useCallback((asImage: boolean) => {
    const text = pasteChoiceText;
    if (pasteChoiceSnoozeEnabled) snoozePasteImagePrompt(pasteChoiceSnoozeDays);
    setPasteChoiceText(null);
    if (!text) return;
    if (asImage) resolvePasteAsImage(text);
    else handlePasteTextAsBlock(text);
  }, [pasteChoiceText, pasteChoiceSnoozeEnabled, pasteChoiceSnoozeDays, snoozePasteImagePrompt, resolvePasteAsImage, handlePasteTextAsBlock]);

  // ── Wrap selection in a frame (Ctrl+Alt+G) — Figma-style "frame selection" ──
  // Measures rendered layer bounds through the frame's shadow DOM, then nests
  // the layers inside a new frame container that becomes their coordinate system.
  const handleWrapSelectionInFrame = useCallback(() => {
    if (!selectedFrameId) return;
    const layerIds = multiSelectLayerIds.length > 0
      ? multiSelectLayerIds
      : selectedElement && selectedElement.frameId === selectedFrameId && selectedElement.layerId
        ? [selectedElement.layerId]
        : [];
    if (layerIds.length === 0) {
      addToast("Selecciona una o más capas para envolverlas en un frame.", "info");
      return;
    }
    const frame = frames.find(candidate => candidate.id === selectedFrameId);
    if (!frame) return;

    const wrapper = document.querySelector(`[data-frame-id="${selectedFrameId}"]`);
    const host = wrapper && [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot?.getElementById("__df_content"));
    const content = host?.shadowRoot?.getElementById("__df_content");
    if (!content) return;
    const contentRect = content.getBoundingClientRect();
    const scale = zoom || 1;
    const rects: Array<{ layerId: string; left: number; top: number; width: number; height: number }> = [];
    for (const layerId of layerIds) {
      const element = content.querySelector(`[data-layer-id="${layerId}"]`);
      if (!element) {
        addToast("No se encontró una de las capas seleccionadas.", "error");
        return;
      }
      const rect = element.getBoundingClientRect();
      rects.push({
        layerId,
        left: (rect.left - contentRect.left) / scale,
        top: (rect.top - contentRect.top) / scale,
        width: rect.width / scale,
        height: rect.height / scale,
      });
    }

    const minX = Math.floor(Math.min(...rects.map(r => r.left)));
    const minY = Math.floor(Math.min(...rects.map(r => r.top)));
    const maxX = Math.ceil(Math.max(...rects.map(r => r.left + r.width)));
    const maxY = Math.ceil(Math.max(...rects.map(r => r.top + r.height)));
    const frameLayerId = createLayerId();
    const newHtml = wrapLayersInFrame(
      frame.html,
      rects.map(r => ({
        layerId: r.layerId,
        left: Math.round(r.left - minX),
        top: Math.round(r.top - minY),
        width: Math.round(r.width),
        height: Math.round(r.height),
      })),
      {
        layerId: frameLayerId,
        name: "Frame",
        left: minX,
        top: minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
      },
    );
    if (!newHtml) {
      addToast("Las capas deben compartir el mismo padre para envolverlas.", "error");
      return;
    }
    const updated = frames.map(candidate =>
      candidate.id === selectedFrameId ? { ...candidate, html: newHtml } : candidate
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    setMultiSelectLayerIds([]);
    addToast(`${rects.length} capa(s) envuelta(s) en un frame.`, "success");
  }, [selectedFrameId, multiSelectLayerIds, selectedElement, frames, zoom, autoSave, addToast]);

  // ── Parametric shape options: star/polygon count, star ratio, corner radius ──
  const handleShapeOptionsChange = useCallback((layerId: string, frameId: string, options: ShapeOptions) => {
    const frame = frames.find(candidate => candidate.id === frameId);
    if (!frame) return;
    const size = options.size || 120;
    const count = clampShapeCount(options.count);
    const d = options.shape === "star"
      ? generateStarPath(size, count, options.ratio, options.cornerRadius)
      : generatePolygonPath(size, count, options.cornerRadius);
    const newHtml = replaceLayerPathData(frame.html, layerId, d, {
      "data-shape": options.shape,
      "data-shape-count": String(count),
      "data-shape-ratio": String(options.ratio),
      "data-shape-corner-radius": String(options.cornerRadius),
      "data-shape-size": String(size),
    });
    if (newHtml === null || newHtml === frame.html) return;
    const updated = frames.map(candidate => candidate.id === frameId ? { ...candidate, html: newHtml } : candidate);
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [frames, autoSave]);

  // ── Text on Path: write text along an existing SVG path ──
  const handleAddTextPath = useCallback((pathData: string, bounds: { x: number; y: number; width: number; height: number }, clickX: number, clickY: number, startOffset: number, originalViewBox?: string) => {
    if (!selectedFrameId) return;
    const layerId = createLayerId();
    const pathId = `tp_${Date.now().toString(36)}`;
    // Use original SVG viewBox if available; otherwise fall back to screen-space bounds
    const vb = originalViewBox
      ? originalViewBox.split(/\s+/).map(Number)
      : [bounds.x, bounds.y, Math.max(bounds.width, 1), Math.max(bounds.height, 1)];
    const svgHtml = `<svg data-layer-id="${layerId}" data-layer-name="Text on path" data-layer-kind="text" viewBox="${vb[0]} ${vb[1]} ${Math.max(vb[2], 1)} ${Math.max(vb[3], 1)}" style="position:absolute;left:${bounds.x}px;top:${bounds.y}px;width:${Math.max(bounds.width, 1)}px;height:${Math.max(bounds.height, 1)}px;overflow:visible;"><defs><path id="${pathId}" d="${pathData}"/></defs><text fill="#c4c0b4" font-size="18" font-family="inherit"><textPath href="#${pathId}" startOffset="${startOffset}%">Text</textPath></text></svg>`;
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
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    setActiveTool("select");
  }, [selectedFrameId, frames, autoSave]);

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
      // MCP errors come back as HTTP 200 with a jsonrpc `error` field, not a
      // thrown fetch error — res.result silently being absent used to fail
      // this completely quietly (no toast, no console). Surface it now.
      if (res.error) {
        addToast(`Pathfinder falló: ${res.error.message || "error desconocido"}`, "error");
      } else if (res.result) {
        const tpl = await getTemplate(templateId);
        const t = tpl as any;
        if (t?.frames && Array.isArray(t.frames)) {
          const updated = t.frames.map((f: any) => ({
            ...frames.find(lf => lf.id === f.id),
            html: f.html || "",
            css: f.css || "",
          }));
          if (updated.length > 0) {
            store.replaceAllWithUndo(updated, "edit");
            autoSave(updated);
          }
        }
      }
    } catch (err: any) {
      addToast(`Pathfinder falló: ${err?.message || "error desconocido"}`, "error");
    }
    setMultiSelectLayerIds([]);
  }, [selectedFrameId, multiSelectLayerIds, templateId, frames, autoSave, addToast]);

  // ── Phase G: SVG Import ──
  const handleSvgImported = useCallback(async (newTemplateId: string) => {
    setShowSvgImport(false);
    onBack();
  }, [onBack]);

  const handleRasterImageImported = useCallback(async (image: RasterImageImport) => {
    const frame = frames.find(item => item.id === selectedFrameId);

    // Upload to Supabase Storage instead of embedding base64 in HTML.
    // This keeps the JSONB template row small and prevents 502 timeouts.
    let imgSrc = image.dataUrl;
    try {
      const uploadRes = await apiFetch<{ url: string; assetId: string }>('/api/assets/upload', {
        method: 'POST',
        body: JSON.stringify({
          name: image.name,
          data: image.dataUrl,
          workspaceId: templateWorkspaceId,
        }),
      });
      if (uploadRes?.url) {
        imgSrc = uploadRes.url;
      }
    } catch {
      addToast("No se pudo subir a Storage — usando imagen temporal.", "error");
    }

    const layerId = createLayerId();
    const imageElement = document.createElement("img");
    imageElement.setAttribute("data-layer-id", layerId);
    imageElement.setAttribute("data-layer-name", image.name);
    imageElement.setAttribute("data-layer-kind", "image");
    imageElement.setAttribute("alt", image.name);
    imageElement.setAttribute("src", imgSrc);
    imageElement.setAttribute("draggable", "false");

    const sourceWidth = Math.max(1, image.width || 512);
    const sourceHeight = Math.max(1, image.height || 512);
    if (!frame) {
      const scale = Math.min(1, 800 / sourceWidth, 800 / sourceHeight);
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const position = findCanvasObjectPosition(frames, canvasObjectsRef.current);
      const imageCss = `[data-layer-id="${layerId}"] {
  position: absolute;
  left: 0;
  top: 0;
  width: ${width}px;
  height: ${height}px;
  display: block;
  object-fit: contain;
}`;
      const object: HtmlCanvasObject = {
        id: layerId,
        name: image.name,
        kind: "image",
        frameId: null,
        html: imageElement.outerHTML,
        css: imageCss,
        ...position,
        width,
        height,
        zIndex: frames.length + canvasObjectsRef.current.length,
      };
      commitCanvasObjects([...canvasObjectsRef.current, object]);
      handleSelectOrphan(object.id);
      setShowSvgImport(false);
      addToast("Imagen insertada en el canvas.", "success");
      return;
    }

    const inserted = insertLayerIntoHtml(frame.html, imageElement.outerHTML, null, "inside");
    if (!inserted) {
      addToast("No se pudo insertar la imagen en el frame.", "error");
      return;
    }

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

    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    handleSelectLayerElement(frame.id, layerId);
    addToast("Imagen insertada en el frame.", "success");
  }, [frames, selectedFrameId, autoSave, handleSelectLayerElement, handleSelectOrphan, addToast, templateWorkspaceId, commitCanvasObjects]);

  const handleAssetUploaded = useCallback(async (asset: { name: string; url: string; width?: number; height?: number }) => {
    let sourceWidth = asset.width || 512;
    let sourceHeight = asset.height || 512;
    if (!asset.width || !asset.height) {
      const dimensions = await new Promise<{ width: number; height: number } | null>((resolve) => {
        const probe = new Image();
        probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
        probe.onerror = () => resolve(null);
        probe.src = asset.url;
      });
      if (dimensions) {
        sourceWidth = dimensions.width;
        sourceHeight = dimensions.height;
      }
    }
    const scale = Math.min(1, 800 / sourceWidth, 800 / sourceHeight);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const position = findCanvasObjectPosition(frames, canvasObjectsRef.current);
    const layerId = createLayerId();
    const imageElement = document.createElement("img");
    imageElement.setAttribute("data-layer-id", layerId);
    imageElement.setAttribute("data-layer-name", asset.name);
    imageElement.setAttribute("data-layer-kind", "image");
    imageElement.setAttribute("src", asset.url);
    imageElement.setAttribute("alt", asset.name);
    imageElement.setAttribute("draggable", "false");
    const html = imageElement.outerHTML;
    const css = `[data-layer-id="${layerId}"] {
  position: absolute;
  left: 0;
  top: 0;
  width: ${width}px;
  height: ${height}px;
  display: block;
  object-fit: contain;
}`;
    const object: HtmlCanvasObject = {
      id: layerId,
      name: asset.name,
      kind: "image",
      frameId: null,
      html,
      css,
      ...position,
      width,
      height,
      zIndex: frames.length + canvasObjectsRef.current.length,
    };
    commitCanvasObjects([...canvasObjectsRef.current, object]);
    handleSelectOrphan(object.id);
    addToast("Imagen añadida al canvas.", "success");
  }, [frames, commitCanvasObjects, handleSelectOrphan, addToast]);

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
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    setSelectedElement(null);
  }, [selectedFrameId, frames, autoSave]);

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
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
  }, [selectedFrameId, frames, autoSave]);

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
      store.replaceAllWithUndo(updated, "edit");
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
        const updated = [...frames, ...clones];
    store.replaceAllWithUndo(updated, "edit");
    setSelectedFrameId(clones[0].id);
    setSelectedFrameIds(new Set(clones.map(frame => frame.id)));
    setContentFrameId(null);
    setSelectedElement(null);
    autoSave(updated);
    addToast(`${clones.length} frame${clones.length === 1 ? "" : "s"} pegado${clones.length === 1 ? "" : "s"}.`, "success");
  }, [selectedFrameId, frames, autoSave, addToast]);

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
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    setSelectedElement(prev => prev ? { ...prev, tag: newTag } : null);
  }, [selectedElement, selectedFrameId, frames, autoSave]);

  // ── Convert element to SVG path ──
  const handleConvertToPath = useCallback(async (layerId: string, frameId: string) => {
    if (!templateId) return;
    try {
      const result = await mcpCall("shape_to_path", { templateId, frameId, elementId: layerId });
      if (result?.success) {
        // Reload template to get updated frames
        const tpl = await getTemplate(templateId);
        if (tpl && tpl.frames) {

          store.replaceAll(tpl.frames as FrameData[]);
          autoSave(tpl.frames);
        }
      }
    } catch (err) {
      console.error("[ConvertToPath] Error:", err);
    }
  }, [templateId, frames, autoSave]);

  // ── Outline stroke: convert stroke to filled outline path ──
  const handleOutlineStroke = useCallback(async (layerId: string, frameId: string) => {
    if (!templateId) return;
    try {
      const result = await mcpCall("outline_stroke", { templateId, frameId, layerId });
      if (result?.success) {
        const tpl = await getTemplate(templateId);
        if (tpl && tpl.frames) {

          store.replaceAll(tpl.frames as FrameData[]);
          autoSave(tpl.frames);
        }
      }
    } catch (err) {
      console.error("[OutlineStroke] Error:", err);
    }
  }, [templateId, frames, autoSave]);

  // ── Offset path: inset/outset by distance ──
  const handleOffsetPath = useCallback(async (layerId: string, frameId: string, offset: number) => {
    if (!templateId) return;
    try {
      const result = await mcpCall("offset_path", { templateId, frameId, layerId, offset });
      if (result?.success) {
        const tpl = await getTemplate(templateId);
        if (tpl && tpl.frames) {

          store.replaceAll(tpl.frames as FrameData[]);
          autoSave(tpl.frames);
        }
      }
    } catch (err) {
      console.error("[OffsetPath] Error:", err);
    }
  }, [templateId, frames, autoSave]);


  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Escape closes dropdowns
      if (e.key === "Escape") {
        setShowFontPicker(false);
        return;
      }
      if (isEditingInShadowDOM(e)) return;
      // The floating chat panel lives outside the editor's own DOM tree, so
      // isEditableTarget (input/textarea/contenteditable only) doesn't catch
      // plain text selections inside its message bubbles — without this,
      // Ctrl+C in the chat was hijacked into "copy the selected frame".
      if ((e.target as HTMLElement)?.closest?.('[data-chat-fab-panel]')) return;
      const mod = e.metaKey || e.ctrlKey;
      // Ctrl/⌘+Alt combos: wrap in frame + boolean operations (Figma-style)
      if (mod && e.altKey) {
        switch (e.key.toLowerCase()) {
          case "g": e.preventDefault(); handleWrapSelectionInFrame(); return;
          case "u": e.preventDefault(); handlePathfinder("union"); return;
          case "s": e.preventDefault(); handlePathfinder("subtract"); return;
          case "i": e.preventDefault(); handlePathfinder("intersect"); return;
          case "e": e.preventDefault(); handlePathfinder("exclude"); return;
        }
      }
      if (mod && e.key === "z" && !e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); handleUndo(); return; }
      if (mod && (e.key === "Z" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); e.stopImmediatePropagation(); handleRedo(); return; }
      // Ctrl+S (Windows) / ⌘+S (Mac): save a permanent version instead of
      // letting the browser open its "save page" dialog.
      if (mod && e.key.toLowerCase() === "s" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        handleSaveVersion();
        return;
      }
      if (mod && e.key === "/") { e.preventDefault(); openCodeTab(); return; }
      if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        if (showRightPanel && rightPanelTab === "batch") {
          setShowRightPanel(false);
        } else {
          setBatchCheckedFrameIds(selectedFrameIds.size > 0 ? new Set(selectedFrameIds) : new Set(selectedFrameId ? [selectedFrameId] : []));
          setRightPanelTab("batch");
          setShowRightPanel(true);
        }
        return;
      }
      if (mod && e.key.toLowerCase() === "c" && !e.shiftKey) { e.preventDefault(); copySelection(); return; }
      if (mod && e.key.toLowerCase() === "x" && !e.shiftKey) { e.preventDefault(); cutSelection(); return; }
      if (mod && e.key.toLowerCase() === "v" && !e.shiftKey) { e.preventDefault(); pasteSelection(); return; }
      if (mod && e.key.toLowerCase() === "d" && !e.shiftKey) { e.preventDefault(); duplicateFrame(); return; }
      if (mod && e.key.toLowerCase() === "g" && !e.shiftKey && !e.altKey) { e.preventDefault(); handleGroup(); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === "g") { e.preventDefault(); handleUngroup(); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === "d") { e.preventDefault(); if (selectedElement) handleDuplicateElement(selectedElement.layerId); return; }
      // Select all objects in the active frame
      if (mod && e.key.toLowerCase() === "a" && !e.shiftKey) {
        const fid = contentFrameId || selectedElement?.frameId || selectedFrameId || frames[0]?.id;
        if (fid) {
          e.preventDefault();
          frameMarqueeRegistry.get(fid)?.({ left: -1e9, top: -1e9, right: 1e9, bottom: 1e9 });
        }
        return;
      }
      // Zoom: Ctrl+= / Ctrl+- / Ctrl+0 (fit)
      if (mod && (e.key === "=" || e.key === "+")) { e.preventDefault(); handleZoomIn(); return; }
      if (mod && e.key === "-") { e.preventDefault(); handleZoomOut(); return; }
      if (mod && e.key === "0") { e.preventDefault(); handleZoomToFit(); return; }
      // Reorder: Ctrl+] forward, Ctrl+[ backward (Shift = front/back)
      if (mod && e.key === "]") { e.preventDefault(); if (selectedElement) handleReorder(e.shiftKey ? "top" : "up"); return; }
      if (mod && e.key === "[") { e.preventDefault(); if (selectedElement) handleReorder(e.shiftKey ? "bottom" : "down"); return; }
      // Canvas guides: Ctrl+R = toggle rulers, Ctrl+' = toggle pixel grid, Ctrl+; = toggle column panel
      if (mod && e.key.toLowerCase() === "r" && !e.altKey && !e.shiftKey) { e.preventDefault(); setShowRulers(v => !v); return; }
      if (mod && e.key === "'") { e.preventDefault(); setShowGrid(v => !v); return; }
      if (mod && e.key === ";") { e.preventDefault(); setShowColumnPanel(v => !v); return; }
      if (!mod) {
        switch (e.key.toLowerCase()) {
          case "v": setActiveTool("select"); break;
          case "h": setActiveTool("hand"); break;
          case "f":
          case "a": setActiveTool("frame"); break;
          case "r": setActiveTool("rect"); break;
          case "o": setActiveTool("circle"); break;
          case "s": setActiveTool("star"); break;
          case "g": setActiveTool("triangle"); break;
          case "n": setActiveTool("polygon"); break;
          case "t":
            if (e.shiftKey) { setActiveTool("text-path"); }
            else { setActiveTool("text"); }
            break;
          case "p": setActiveTool("pen"); break;
          case "b": setActiveTool("pencil"); break;
          case "z": handleZoomIn(); break;
          case "delete":
          case "backspace":
            if (selectedElement) {
              handleDeleteElement(selectedElement.layerId);
            } else if (selectedOrphanIds.size > 0) {
              for (const id of selectedOrphanIds) {
                handleDeleteOrphan(id);
              }
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
      if ((e.target as HTMLElement)?.closest?.('[data-chat-fab-panel]')) return;
      const hasSelection = Boolean(selectedElement && selectedElement.frameId === selectedFrameId)
        || selectedFrameIds.size > 0
        || Boolean(selectedFrameId);
      if (!hasSelection) return;
      e.preventDefault();
      e.clipboardData?.setData("text/plain", "Futuraria design object");
      copySelection();
    };
    const handleNativePaste = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if ((e.target as HTMLElement)?.closest?.('[data-chat-fab-panel]')) return;
      if (readDesignClipboard()) {
        e.preventDefault();
        pasteSelection();
        return;
      }
      const text = e.clipboardData?.getData("text/plain") || "";
      if (!text.trim()) return;
      e.preventDefault();
      if (looksLikeRenderableCode(text) && !isPasteImagePromptSnoozed()) {
        setPasteChoiceText(text);
      } else {
        handlePasteTextAsBlock(text);
      }
    };
    const handleNativeCut = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if ((e.target as HTMLElement)?.closest?.('[data-chat-fab-panel]')) return;
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
  }, [handleUndo, handleRedo, copySelection, cutSelection, pasteSelection, deleteSelectedFrame, duplicateFrame, handleDeleteElement, handleDuplicateElement, handleElementNudge, handleWrapSelectionInFrame, handlePathfinder, selectedElement, selectedFrameId, selectedFrameIds, frames.length, contentFrameId, handleFrameMove, frames, handleZoomIn, handleZoomOut, handleZoomToFit, handleSaveVersion, openCodeTab, looksLikeRenderableCode, isPasteImagePromptSnoozed, handlePasteTextAsBlock, showRightPanel, rightPanelTab]);

  // ── Export ──
  /// Serialize a frame to SVG for vector export
  // ── Native SVG generation: walks DOM tree, resolves styles, emits <rect>/<text>/<image> ──
  // Unlike foreignObject SVG, this produces elements Figma and Illustrator can import.
  const buildFrameSvg = useCallback(async (frame: FrameData): Promise<string> => {
    const w = frame.width || 1080;
    const h = frame.height || 1080;
    const bg = frame.background || "#ffffff";
    const html = frame.html || "";
    const css = frame.css || "";

    const escXml = (t: string) => t.replace(/[<>&'"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

    // Render into a hidden, real DOM (a shadow root, mirroring DesignFrame's
    // own #__df_content scoping) instead of reimplementing CSS by hand. The
    // previous version only ever read an element's OWN inline left/top as
    // an absolute offset — anything positioned by document flow, a parent's
    // padding, or a flex "Contenedor" layout (never an explicit left/top)
    // silently landed at (0,0), which is exactly the "image pinned to the
    // top-left, text missing" bug reported against real exports. Letting the
    // browser do the actual layout, then reading it back with
    // getBoundingClientRect/getComputedStyle, handles any layout mode
    // correctly and also gives exact CSS cascade resolution (any selector
    // shape) for free — no bespoke selector matcher needed.
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-99999px;top:0;pointer-events:none;";
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const styleEl = document.createElement("style");
    styleEl.textContent = `#__df_content { width: ${w}px; height: ${h}px; overflow: hidden; }\n${mapBodySelectors(css)}`;
    shadow.appendChild(styleEl);
    const content = document.createElement("div");
    content.id = "__df_content";
    content.innerHTML = html;
    content.style.position = "relative";
    content.style.background = bg;
    shadow.appendChild(content);

    // Let images (already inlined as data: URIs by the caller) and web
    // fonts settle before measuring — an unloaded image or fallback font
    // metric would throw off the box sizes we're about to read.
    const imgs = Array.from(content.querySelectorAll("img"));
    await Promise.all(imgs.map(img => img.complete ? Promise.resolve() : new Promise<void>(resolve => {
      img.addEventListener("load", () => resolve(), { once: true });
      img.addEventListener("error", () => resolve(), { once: true });
      setTimeout(resolve, 2000);
    })));
    if (document.fonts?.ready) { try { await document.fonts.ready; } catch { /* fall back to default metrics */ } }

    const svgParts: string[] = [];

    // ── Filters: CSS `filter` has no direct SVG-attribute equivalent — each
    // function becomes an SVG filter primitive, chained in source order
    // (grayscale/saturate → feColorMatrix, contrast/brightness → a linear
    // feComponentTransfer, blur → feGaussianBlur). Needed because real
    // designs chain more than grayscale alone, e.g.
    // `grayscale(100%) contrast(220%) brightness(95%)` for a halftone photo
    // treatment — translating only the grayscale term left the exported
    // photo visibly flatter than the PNG/JPG export of the same frame.
    const filterDefs: string[] = [];
    const filterIdByKey = new Map<string, string>();
    const getOrCreateFilter = (primitives: string[]): string => {
      if (!primitives.length) return "";
      const key = primitives.join("|");
      let id = filterIdByKey.get(key);
      if (!id) {
        id = `f-${filterIdByKey.size}`;
        filterIdByKey.set(key, id);
        filterDefs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">${primitives.join("")}</filter>`);
      }
      return id;
    };
    const buildFilterChain = (raw: string): string => {
      if (!raw || raw === "none") return "";
      const primitives: string[] = [];
      for (const fn of raw.matchAll(/([a-z-]+)\(([^)]*)\)/g)) {
        const name = fn[1];
        const arg = fn[2].trim();
        if (name === "grayscale" || name === "saturate") {
          let amt = parseFloat(arg) || 0;
          if (arg.includes("%")) amt /= 100;
          const values = name === "grayscale" ? (1 - Math.max(0, Math.min(1, amt))).toFixed(3) : amt.toFixed(3);
          primitives.push(`<feColorMatrix type="saturate" values="${values}"/>`);
        } else if (name === "contrast") {
          let c = parseFloat(arg) || 1;
          if (arg.includes("%")) c /= 100;
          const intercept = (0.5 * (1 - c)).toFixed(3);
          primitives.push(`<feComponentTransfer><feFuncR type="linear" slope="${c}" intercept="${intercept}"/><feFuncG type="linear" slope="${c}" intercept="${intercept}"/><feFuncB type="linear" slope="${c}" intercept="${intercept}"/></feComponentTransfer>`);
        } else if (name === "brightness") {
          let b = parseFloat(arg) || 1;
          if (arg.includes("%")) b /= 100;
          primitives.push(`<feComponentTransfer><feFuncR type="linear" slope="${b}"/><feFuncG type="linear" slope="${b}"/><feFuncB type="linear" slope="${b}"/></feComponentTransfer>`);
        } else if (name === "blur") {
          const px = parseFloat(arg) || 0;
          primitives.push(`<feGaussianBlur stdDeviation="${(px / 2).toFixed(2)}"/>`);
        }
      }
      const id = getOrCreateFilter(primitives);
      return id ? ` filter="url(#${id})"` : "";
    };

    // ── Gradients & masks: parse a computed `linear-gradient(...)` (found
    // anywhere inside a background-image/mask-image value — paren-depth
    // scan, not a naive regex, so nested rgba(...) stops don't break it)
    // into angle + color stops, shared by background fills and masks.
    const splitTopLevel = (str: string, sep: string): string[] => {
      const out: string[] = [];
      let depth = 0, cur = "";
      for (const ch of str) {
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        if (ch === sep && depth === 0) { out.push(cur); cur = ""; } else { cur += ch; }
      }
      if (cur) out.push(cur);
      return out;
    };
    const splitColorAlpha = (color: string): { color: string; alpha: number } => {
      const m = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/);
      if (m) return { color: `rgb(${m[1]}, ${m[2]}, ${m[3]})`, alpha: m[4] !== undefined ? parseFloat(m[4]) : 1 };
      return { color, alpha: 1 };
    };
    const DIRECTION_ANGLES: Record<string, number> = {
      top: 0, bottom: 180, left: 270, right: 90,
      "top right": 45, "right top": 45, "bottom right": 135, "right bottom": 135,
      "bottom left": 225, "left bottom": 225, "top left": 315, "left top": 315,
    };
    const parseLinearGradient = (source: string): { angleDeg: number; stops: { color: string; pct: number }[] } | null => {
      const startIdx = source.indexOf("linear-gradient(");
      if (startIdx === -1) return null;
      let depth = 0, end = -1;
      for (let i = startIdx + "linear-gradient(".length - 1; i < source.length; i++) {
        if (source[i] === "(") depth++;
        else if (source[i] === ")") { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end === -1) return null;
      const parts = splitTopLevel(source.slice(startIdx + "linear-gradient(".length, end), ",").map(p => p.trim());
      if (!parts.length) return null;
      let angleDeg = 180; // CSS default direction is "to bottom"
      let stopParts = parts;
      const angleMatch = parts[0].match(/^(-?[\d.]+)deg$/);
      if (angleMatch) { angleDeg = parseFloat(angleMatch[1]); stopParts = parts.slice(1); }
      else if (/^to\s+/i.test(parts[0])) {
        const dir = parts[0].replace(/^to\s+/i, "").trim().toLowerCase();
        angleDeg = DIRECTION_ANGLES[dir] ?? 180;
        stopParts = parts.slice(1);
      }
      const stops = stopParts.map(p => {
        const colorMatch = p.match(/^(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}|[a-zA-Z]+)/);
        const color = colorMatch ? colorMatch[0] : "#000000";
        const pctMatch = p.slice(color.length).trim().match(/(-?[\d.]+)%/);
        return { color, pct: pctMatch ? parseFloat(pctMatch[1]) : null };
      });
      if (stops.length) {
        if (stops[0].pct === null) stops[0].pct = 0;
        if (stops[stops.length - 1].pct === null) stops[stops.length - 1].pct = 100;
        for (let i = 1; i < stops.length - 1; i++) {
          if (stops[i].pct === null) {
            let j = i; while (j < stops.length && stops[j].pct === null) j++;
            const startPct = stops[i - 1].pct as number, endPct = stops[j].pct as number, span = j - i + 1;
            for (let k = i; k < j; k++) stops[k].pct = startPct + (endPct - startPct) * (k - i + 1) / span;
          }
        }
      }
      return { angleDeg, stops: stops as { color: string; pct: number }[] };
    };
    const angleToCoords = (deg: number) => {
      const rad = (deg * Math.PI) / 180;
      const dx = Math.sin(rad), dy = -Math.cos(rad);
      return { x1: (0.5 - dx / 2).toFixed(4), y1: (0.5 - dy / 2).toFixed(4), x2: (0.5 + dx / 2).toFixed(4), y2: (0.5 + dy / 2).toFixed(4) };
    };
    const gradDefs: string[] = [];
    const gradIdByKey = new Map<string, string>();
    const getOrCreateGradient = (parsed: { angleDeg: number; stops: { color: string; pct: number }[] }): string => {
      const key = JSON.stringify(parsed);
      let id = gradIdByKey.get(key);
      if (!id) {
        id = `grad-${gradIdByKey.size}`;
        gradIdByKey.set(key, id);
        const { x1, y1, x2, y2 } = angleToCoords(parsed.angleDeg);
        const stops = parsed.stops.map(s => {
          const { color, alpha } = splitColorAlpha(s.color);
          return `<stop offset="${s.pct}%" stop-color="${escXml(color)}" stop-opacity="${alpha}"/>`;
        }).join("");
        gradDefs.push(`<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops}</linearGradient>`);
      }
      return id;
    };
    const resolveBackgroundFill = (cs: CSSStyleDeclaration): { type: "none" | "color" | "gradient"; value: string } => {
      const bgImage = cs.backgroundImage;
      if (bgImage && bgImage !== "none") {
        const parsed = parseLinearGradient(bgImage);
        if (parsed) return { type: "gradient", value: getOrCreateGradient(parsed) };
      }
      const bgColor = cs.backgroundColor;
      if (bgColor && !/rgba?\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bgColor)) return { type: "color", value: bgColor };
      return { type: "none", value: "" };
    };
    const maskIdByKey = new Map<string, string>();
    // A CSS mask gradient fades by ALPHA, not luminance — SVG <mask> defaults
    // to luminance. Using a solid white stop whose stop-opacity carries the
    // source alpha makes luminance*alpha reduce to the same alpha ramp, so
    // the two agree without needing mask-type="alpha" support everywhere.
    const resolveMask = (cs: CSSStyleDeclaration): string | null => {
      const maskImage = cs.getPropertyValue("mask-image") || cs.getPropertyValue("-webkit-mask-image");
      if (!maskImage || maskImage === "none") return null;
      const parsed = parseLinearGradient(maskImage);
      if (!parsed) return null;
      const key = JSON.stringify(parsed);
      let id = maskIdByKey.get(key);
      if (!id) {
        id = `mask-${maskIdByKey.size}`;
        maskIdByKey.set(key, id);
        const { x1, y1, x2, y2 } = angleToCoords(parsed.angleDeg);
        const gradId = `${id}-g`;
        const stops = parsed.stops.map(s => `<stop offset="${s.pct}%" stop-color="#ffffff" stop-opacity="${splitColorAlpha(s.color).alpha}"/>`).join("");
        gradDefs.push(`<linearGradient id="${gradId}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops}</linearGradient>`);
        gradDefs.push(`<mask id="${id}"><rect x="-10%" y="-10%" width="120%" height="120%" fill="url(#${gradId})"/></mask>`);
      }
      return id;
    };

    // ── Box-shadow: this app's card shadows are hard-edged (0 blur radius —
    // a flat offset duplicate, not a soft glow), so most exports never touch
    // the blur path at all; it's included for designs that do use a soft
    // shadow. Multiple comma-separated shadows aren't split — real designs
    // here use exactly one.
    const parseBoxShadow = (raw: string): { color: string; offsetX: number; offsetY: number; blur: number; spread: number } | null => {
      if (!raw || raw === "none" || /^inset\b/.test(raw.trim())) return null;
      const first = splitTopLevel(raw, ",")[0].trim();
      const colorMatch = first.match(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}/);
      const color = colorMatch ? colorMatch[0] : "rgba(0,0,0,0.5)";
      const [offsetX = 0, offsetY = 0, blur = 0, spread = 0] = (color ? first.replace(color, "") : first).trim().split(/\s+/).filter(Boolean).map(v => parseFloat(v) || 0);
      return { color, offsetX, offsetY, blur, spread };
    };

    // Wraps text to the element's real content width using the same font
    // the SVG will declare, since SVG <text> never auto-wraps — without
    // this, long copy (card body text, headlines) rendered as a single
    // <text> ran straight off the edge of the frame instead of wrapping
    // onto multiple lines like the on-screen design.
    const measureCtx = document.createElement("canvas").getContext("2d");
    const wrapText = (text: string, fontSpec: string, maxWidth: number): string[] => {
      if (!measureCtx || !(maxWidth > 0)) return [text];
      measureCtx.font = fontSpec;
      const words = text.split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      const lines: string[] = [];
      let current = words[0];
      for (let i = 1; i < words.length; i++) {
        const trial = `${current} ${words[i]}`;
        if (measureCtx.measureText(trial).width > maxWidth) { lines.push(current); current = words[i]; }
        else current = trial;
      }
      lines.push(current);
      return lines;
    };

    const contentRect = content.getBoundingClientRect();

    const walkNode = (node: Element) => {
      for (const child of Array.from(node.children) as HTMLElement[]) {
        const tag = child.tagName.toLowerCase();
        if (["script", "style", "link", "meta"].includes(tag)) continue;

        const rect = child.getBoundingClientRect();
        const cs = getComputedStyle(child);
        const text = (child.textContent || "").trim();
        const hasChildren = child.children.length > 0;

        const x = rect.left - contentRect.left;
        const y = rect.top - contentRect.top;
        const width = rect.width;
        const height = rect.height;
        const opacity = parseFloat(cs.opacity) || 1;
        const radius = parseFloat(cs.borderTopLeftRadius) || 0;

        // Box-shadow — a separate rect painted BEFORE (i.e. beneath) the
        // element's own fill, matching CSS's default shadow stacking.
        const shadow = width > 0 && height > 0 ? parseBoxShadow(cs.boxShadow) : null;
        if (shadow) {
          const blurAttr = shadow.blur > 0 ? ` filter="url(#${getOrCreateFilter([`<feGaussianBlur stdDeviation="${(shadow.blur / 2).toFixed(2)}"/>`])})"` : "";
          const sx = x + shadow.offsetX - shadow.spread, sy = y + shadow.offsetY - shadow.spread;
          const sw = Math.max(0, width + shadow.spread * 2), sh = Math.max(0, height + shadow.spread * 2);
          svgParts.push(`<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="${escXml(shadow.color)}" rx="${radius}" opacity="${opacity}"${blurAttr}/>`);
        }

        // Background (solid or gradient) — separate from border, since a
        // border-only element (fill: none) still needs to paint SOMETHING,
        // and a divider that's only border-bottom (this app's card headers,
        // image containers) has no "uniform border" to fold into one rect.
        const fillInfo = resolveBackgroundFill(cs);
        const maskId = resolveMask(cs);
        const maskAttr = maskId ? ` mask="url(#${maskId})"` : "";
        if (fillInfo.type !== "none" && width > 0 && height > 0) {
          const fill = fillInfo.type === "gradient" ? `url(#${fillInfo.value})` : escXml(fillInfo.value);
          svgParts.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" rx="${radius}" opacity="${opacity}"${maskAttr}/>`);
        }

        // Border — a plain outline rect when all 4 sides match (the common
        // case), otherwise individual <line> segments per side, since real
        // designs here also use single-side borders as dividers
        // (`.card-header{border-bottom:2px solid}`) that a "check the top
        // side only" shortcut would silently miss.
        if (width > 0 && height > 0) {
          const sides = (["Top", "Right", "Bottom", "Left"] as const).map(edge => {
            const w = parseFloat((cs as any)[`border${edge}Width`]) || 0;
            return { w, style: (cs as any)[`border${edge}Style`], color: (cs as any)[`border${edge}Color`], has: w > 0 && (cs as any)[`border${edge}Style`] !== "none" };
          });
          const [top, right, bottom, left] = sides;
          const uniform = top.has && right.has && bottom.has && left.has
            && [right, bottom, left].every(s => s.w === top.w && s.color === top.color);
          if (uniform) {
            // SVG strokes are centered on the path; CSS borders sit fully
            // inside the box. Insetting by half the stroke width lines the
            // stroke's outer edge up with the CSS border's outer edge.
            const inset = top.w / 2;
            svgParts.push(`<rect x="${x + inset}" y="${y + inset}" width="${Math.max(0, width - top.w)}" height="${Math.max(0, height - top.w)}" fill="none" rx="${radius}" stroke="${escXml(top.color)}" stroke-width="${top.w}" opacity="${opacity}"/>`);
          } else {
            if (top.has) svgParts.push(`<line x1="${x}" y1="${y + top.w / 2}" x2="${x + width}" y2="${y + top.w / 2}" stroke="${escXml(top.color)}" stroke-width="${top.w}" opacity="${opacity}"/>`);
            if (bottom.has) svgParts.push(`<line x1="${x}" y1="${y + height - bottom.w / 2}" x2="${x + width}" y2="${y + height - bottom.w / 2}" stroke="${escXml(bottom.color)}" stroke-width="${bottom.w}" opacity="${opacity}"/>`);
            if (left.has) svgParts.push(`<line x1="${x + left.w / 2}" y1="${y}" x2="${x + left.w / 2}" y2="${y + height}" stroke="${escXml(left.color)}" stroke-width="${left.w}" opacity="${opacity}"/>`);
            if (right.has) svgParts.push(`<line x1="${x + width - right.w / 2}" y1="${y}" x2="${x + width - right.w / 2}" y2="${y + height}" stroke="${escXml(right.color)}" stroke-width="${right.w}" opacity="${opacity}"/>`);
          }
        }

        if (tag === "img") {
          const src = child.getAttribute("src") || "";
          if (src && width > 0 && height > 0) {
            svgParts.push(`<image x="${x}" y="${y}" width="${width}" height="${height}" href="${escXml(src)}" preserveAspectRatio="xMidYMid slice"${buildFilterChain(cs.filter)}${maskAttr}/>`);
          }
        } else if (text && !hasChildren) {
          const fontFamily = cs.fontFamily.replace(/["']/g, "");
          const fontSize = cs.fontSize;
          const fontWeight = cs.fontWeight;
          const color = cs.color;
          const textAlign = cs.textAlign;
          // Text sits in the CONTENT box, inset from the border box by
          // padding/border — using the border box directly (as the first
          // pass did) placed text too high and too far left/right on any
          // padded element, e.g. a card body with `padding: 10px 8px`.
          const padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0, padT = parseFloat(cs.paddingTop) || 0;
          const bL = parseFloat(cs.borderLeftWidth) || 0, bR = parseFloat(cs.borderRightWidth) || 0, bT = parseFloat(cs.borderTopWidth) || 0;
          const contentX = x + bL + padL;
          const contentY = y + bT + padT;
          const contentWidth = Math.max(0, width - bL - bR - padL - padR);
          const anchor = textAlign === "center" ? "middle" : (textAlign === "right" || textAlign === "end") ? "end" : "start";
          const textX = textAlign === "center" ? contentX + contentWidth / 2 : (textAlign === "right" || textAlign === "end") ? contentX + contentWidth : contentX;
          const lines = wrapText(text, `${fontWeight} ${fontSize} ${fontFamily}`, contentWidth);
          let lineHeight = parseFloat(cs.lineHeight);
          if (!cs.lineHeight || cs.lineHeight === "normal" || Number.isNaN(lineHeight)) lineHeight = parseFloat(fontSize) * 1.2;
          const baseY = contentY + parseFloat(fontSize);
          const tspans = lines.map((line, i) => `<tspan x="${textX}" y="${baseY + i * lineHeight}">${escXml(line)}</tspan>`).join("");
          svgParts.push(`<text font-family="${escXml(fontFamily)}" font-size="${escXml(fontSize)}" font-weight="${escXml(fontWeight)}" fill="${escXml(color)}" text-anchor="${anchor}" opacity="${opacity}">${tspans}</text>`);
        }

        walkNode(child);
      }
    };

    walkNode(content);
    host.remove();

    // Extract font links
    const fontImportRe = /@import\s+url\(['"]?(https:\/\/fonts\.googleapis\.com[^'")]+)['"]?\)\s*;/g;
    const fontLinks: string[] = [];
    let fm;
    while ((fm = fontImportRe.exec(css)) !== null) {
      // Google Fonts URLs are built with `&` between query params
      // (…&display=swap) — a bare `&` in XML must start a valid entity
      // reference, so every SVG export with a Google Font (the overwhelming
      // majority of designs) produced a file that failed to parse: "This
      // page contains the following errors: error … EntityRef: expecting
      // ';'". escXml turns it into the required `&amp;`.
      fontLinks.push(`<link rel="stylesheet" href="${escXml(fm[1])}"/>`);
    }

    // Matches the balanced url(...) first, THEN the statement-ending `;` —
    // a Google Fonts URL commonly has its own `;` inside (wght@400;700),
    // which a naive /@import[^;]+;/ would stop at prematurely, leaving a
    // dangling css fragment (e.g. "700&display=swap');") in the CDATA block.
    const cleanCss = css.replace(/@import\s+url\([^)]*\)[^;]*;/g, "").replace(/@font-face\s*\{[^}]*\}/g, "");

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xhtml="http://www.w3.org/1999/xhtml"
     width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <style><![CDATA[${cleanCss}]]></style>
    ${fontLinks.join("\n  ")}
    ${filterDefs.join("\n    ")}
    ${gradDefs.join("\n    ")}
  </defs>
  <rect width="${w}" height="${h}" fill="${escXml(bg)}"/>
  ${svgParts.join("\n  ")}
</svg>`;
  }, []);

  // Capture a single frame to a PNG/JPG blob via rasterizeFrame (see frameCapture.ts
  // for why this replaced html2canvas — it dropped CSS filters and body/html styles).
  const captureFrameToPng = useCallback(async (frame: FrameData, scale: number = 2, format: "png" | "jpg" = "png"): Promise<Blob | null> => {
    // JPEG has no alpha channel: an unresolved "transparent" background would
    // rasterize as solid BLACK once flattened, not white — always resolve to
    // an opaque color for jpg. PNG keeps true transparency when the frame has
    // none set.
    const background = frame.background || (format === "jpg" ? "#ffffff" : "transparent");
    try {
      const canvas = await rasterizeFrame(
        { html: frame.html, css: frame.css, width: frame.width, height: frame.height, background },
        scale,
      );
      const mimeType = format === "jpg" ? "image/jpeg" : "image/png";
      const quality = format === "jpg" ? 0.92 : undefined;
      return await canvasToBlob(canvas, mimeType, quality);
    } catch (err) {
      console.warn("[Export] Capture failed", err);
      return null;
    }
  }, []);

  /* Capture first frame as PNG base64 — for FileInfoPanel cover */
  const handleCoverCapture = useCallback(async (): Promise<string | null> => {
    if (!selectedFrame) return null;
    try {
      const blob = await captureFrameToPng(selectedFrame, 1.5, "png");
      if (!blob) return null;
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } catch { return null; }
  }, [selectedFrame, captureFrameToPng]);

  // Export operates on whichever frames are currently SELECTED (a multi-frame
  // selection on the canvas — see exportTargetFrames below), not a "current
  // frame vs literally every frame" toggle. A user with 7 frames who wants
  // to hand a client only 3 selects those 3 and exports; there's no longer a
  // separate "all frames" mode to reach for.
  const handleExportFramesPNG = useCallback(async (targetFrames: FrameData[], format: "png" | "jpg" = "png") => {
    for (const frame of targetFrames) {
      const blob = await captureFrameToPng(frame, 2, format);
      if (!blob) continue;
      downloadBlob(blob, `${frame.name.replace(/[<>:"/\\|?*]/g, "_")}.${format}`);
      if (targetFrames.length > 1) await new Promise(r => setTimeout(r, 300));
    }
  }, [captureFrameToPng]);

  // SVG export bakes external images (Storage URLs) into data: URIs first —
  // a downloaded .svg opened directly in a browser tab CAN load external
  // images fine, but most consumers (thumbnailers, dragging it into another
  // <img>, pasting into design tools) treat it as an image resource, which
  // triggers the exact same "SVG-as-image skips external resources" browser
  // rule documented in frameCapture.ts. Inlining makes the file self-contained
  // everywhere, matching the PNG/JPG export's guarantee.
  const handleExportFramesSVG = useCallback(async (targetFrames: FrameData[]) => {
    for (const frame of targetFrames) {
      const { html, css } = await inlineFrameImages(frame.html, frame.css);
      const svgString = await buildFrameSvg({ ...frame, html, css });
      const blob = new Blob([svgString], { type: "image/svg+xml" });
      downloadBlob(blob, `${frame.name.replace(/[<>:"/\\|?*]/g, "_")}.svg`);
      if (targetFrames.length > 1) await new Promise(r => setTimeout(r, 200));
    }
  }, [buildFrameSvg]);

  // ── PDF export via jsPDF ──
  const handleExportFramesPDF = useCallback(async (targetFrames: FrameData[]) => {
    const { jsPDF } = await import("jspdf");
    for (const frame of targetFrames) {
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
      if (targetFrames.length > 1) await new Promise(r => setTimeout(r, 300));
    }
  }, [captureFrameToPng]);

  const [showPasteHtml, setShowPasteHtml] = useState(false);
  const [batchCheckedFrameIds, setBatchCheckedFrameIds] = useState<Set<string>>(new Set());
  const [batchHoveredFrameId, setBatchHoveredFrameId] = useState<string | null>(null);
  const [showBatchMenu, setShowBatchMenu] = useState(false);
  const [showDesignImport, setShowDesignImport] = useState(false);

  // ── Unified Import router: one entry point that detects what was
  // dropped/picked and opens the right specialized tool (SVG editor,
  // design-file import, HTML/CSS import, or template restore), pre-loaded
  // with the file. handleImportRoute is declared further down (after
  // importTemplateFile exists) so it can list that as a dependency. ──
  const [showImportRouter, setShowImportRouter] = useState(false);
  const [routedImportFile, setRoutedImportFile] = useState<File | null>(null);

  // ── Design import handler (SVG/PSD/AI/FIG → new frame) ──
  const handleDesignImport = useCallback(async (result: ImportResult) => {
    if (result.warning && !result.html) {
      addToast(result.warning, "error", true);
      return;
    }
    const newFrame: FrameData = {
      id: `frame-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: result.name || "Imported Design",
      x: 100 + frames.length * 40,
      y: 100 + frames.length * 40,
      width: result.width || 1080,
      height: result.height || 1080,
      html: result.html,
      css: result.css,
      background: "#ffffff",
    };
    const updated = [...frames, newFrame];
    store.replaceAllWithUndo(updated, "import design");
    setSelectedFrameId(newFrame.id);
    autoSave(updated);
    if (result.warning) addToast(result.warning, "error");
    else addToast(`Diseño "${newFrame.name}" importado correctamente.`, "success");
  }, [frames, store, setSelectedFrameId, autoSave, addToast]);

  // ── Canvas Guides state ──
  const [guides, setGuides] = useState<Guide[]>([]);
  const [showGrid, setShowGrid] = useState(true);
  const [showRulers, setShowRulers] = useState(true);
  const [gridSize] = useState(8);
  const [showColumnPanel, setShowColumnPanel] = useState(false);
  const [columnConfig, setColumnConfig] = useState<ColumnConfig | null>(null);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [saveRecipeMsg, setSaveRecipeMsg] = useState("");

  // Saves whichever frame(s) are currently selected — same selection
  // resolution rule used by Export (multi-select if there is one, else the
  // single active frame) — as a reusable Key Visual. Multi-frame recipes
  // store every frame in structure.frames; template_html/css keep the
  // first frame for older readers.
  const handleSaveRecipe = useCallback(async () => {
    const ids = selectedFrameIds.size > 0 ? selectedFrameIds : new Set(selectedFrameId ? [selectedFrameId] : []);
    const targetFrames = frames.filter(f => ids.has(f.id));
    if (targetFrames.length === 0) {
      setSaveRecipeMsg("✗ Select one or more frames first");
      setTimeout(() => setSaveRecipeMsg(""), 3000);
      return;
    }
    setSaveRecipeMsg("");
    try {
      const res = await apiFetch<{ recipeId: string; name: string }>("/api/recipes", {
        method: "POST",
        body: JSON.stringify({
          name: templateName || "Untitled Key Visual",
          description: `${templateName} - saved ${new Date().toLocaleDateString()}`,
          workspaceId: templateWorkspaceId,
          templateHtml: targetFrames[0].html || "",
          templateCss: targetFrames[0].css || "",
          structure: {
            layout: { width: targetFrames[0].width || 1080, height: targetFrames[0].height || 1080 },
            frames: targetFrames.map(f => ({ name: f.name, html: f.html || "", css: f.css || "", width: f.width, height: f.height })),
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
  }, [templateName, templateWorkspaceId, frames, selectedFrameId, selectedFrameIds]);

  // ── Extract Design System (R6: Human UI path) ──
  const handleExtractDesignSystem = useCallback(async () => {
    try {
      const mcpRes = await fetch("/mcp", {
        method: "POST",
        headers: getApiHeaders(),
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
        downloadBlob(blob, d.name);
        await new Promise(r => setTimeout(r, 150));
      }
    } catch (e: any) {
      console.error("[Extract DS]", e);
      addToast("Error al extraer el design system: " + (e?.message || "Error desconocido"), "error");
    }
  }, [templateId, templateName, addToast]);

  // Every frame's own stylesheet, combined into one downloadable file —
  // whole-template scope (see WHOLE_TEMPLATE_FORMATS), same as JSON/Tokens/
  // Design.md, not the per-frame selection PNG/JPG/SVG/PDF use.
  const handleExportCss = useCallback(() => {
    const combined = frames.map(f => `/* ── ${f.name} ── */\n${f.css || ""}`).join("\n\n");
    const blob = new Blob([combined], { type: "text/css" });
    downloadBlob(blob, `${templateName.replace(/[<>:"/\\|?* ]/g, "_")}.css`);
  }, [frames, templateName]);

  // ── Publish Style to Style Library (saves to brand_guidelines) ──
  // Extracts colors/typography/CSS from EVERY frame in this template (not
  // just the one selected in the canvas — generate_design_artifacts always
  // reads tpl.frames in full) and either creates a new Style Library entry
  // or auto-merges into an existing one with a matching "fingerprint".
  const [publishingStyle, setPublishingStyle] = useState(false);
  // Captures a style from whichever frame(s) are currently selected (not
  // "every frame in the template" — a template can hold several unrelated
  // designs) under an explicit name the caller supplies. Naming is on
  // purpose never inferred from the frame or template name: that's what was
  // silently colliding different captures into the same Style Library
  // entry.
  const handlePublishStyle = useCallback(async (name: string): Promise<boolean> => {
    const ids = selectedFrameIds.size > 0 ? selectedFrameIds : new Set(selectedFrameId ? [selectedFrameId] : []);
    if (ids.size === 0) {
      addToast("Selecciona uno o varios frames primero.", "error");
      return false;
    }
    if (!name.trim()) {
      addToast("El estilo necesita un nombre.", "error");
      return false;
    }
    setPublishingStyle(true);
    try {
      const mcpRes = await fetch("/mcp", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: "generate_design_artifacts", arguments: { templateId, action: "publish", brandName: name.trim(), frameIds: [...ids] } },
          id: 1,
        }),
      });
      const json = await mcpRes.json();
      if (json?.error) throw new Error(json.error.message);
      const text = json?.result?.content?.[0]?.text;
      if (!text) throw new Error("No response from publish");
      const data = JSON.parse(text);
      if (data._published) {
        const msg = data.autoMerged
          ? `Estilo "${name.trim()}" actualizado (ya existía con ese nombre)`
          : `Estilo publicado en Style Library como "${name.trim()}"`;
        addToast(msg + (data.brandId ? ` (brandId: ${data.brandId})` : ""), "success");
        return true;
      }
      throw new Error("Publish did not complete");
    } catch (e: any) {
      console.error("[Publish Style]", e);
      addToast("Error al publicar estilo: " + (e?.message || "Error desconocido"), "error");
      return false;
    } finally {
      setPublishingStyle(false);
    }
  }, [templateId, selectedFrameId, selectedFrameIds, addToast]);

  // ── Frame rename (double-click in top bar) ──
  const commitFrameRename = useCallback(() => {
    if (!selectedFrameId || editingFrameName === null) return;
    const trimmed = editingFrameName.trim();
    if (!trimmed) { setEditingFrameName(null); return; }
    const updated = frames.map(f =>
      f.id === selectedFrameId ? { ...f, name: trimmed } : f
    );
    store.replaceAllWithUndo(updated, "edit");
    setEditingFrameName(null);
    autoSave(updated);
  }, [selectedFrameId, editingFrameName, frames, autoSave]);

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
      const blob = new Blob([JSON.stringify({ ...tpl, frames, canvasObjects: canvasObjectsRef.current }, null, 2)], { type: "application/json" });
      downloadBlob(blob, `${templateName}.futuraria.json`);
    }
  }, [templateId, templateName, frames]);

  const [showLayersPanel, setShowLayersPanel] = useState(false);
  const [showInsertBar, setShowInsertBar] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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
      const currentFrames = framesRef.current;
      // Merge: preserve local frame data (x, y, w, h, etc), update html/css from server
      const updated = t.frames.map((f: any) => {
        // Server/MCP payloads can reintroduce duplicate layer ids — normalize
        // here too, not only on first load.
        const unique = dedupeLayerIds(f.html ?? "", f.css ?? "", createLayerId);
        const local = currentFrames.find(lf => lf.id === f.id);
        if (local) {
          return { ...local, html: unique.html, css: unique.css };
        }
        // New frame from server (e.g., created by MCP tool)
        return {
          id: f.id,
          name: f.name || "Frame",
          x: f.x ?? 0, y: f.y ?? 0,
          width: f.width ?? 1080, height: f.height ?? 1080,
          html: unique.html, css: unique.css,
          background: f.background ?? "#ffffff",
        };
      });
      if (updated.length > 0) {
        store.replaceAllWithUndo(updated, "edit");
        autoSaveRef.current(updated);
      }
    }
  }, [templateId]);

  // Convert the currently-selected image (frame-based <img> layer or an
  // orphan canvas image object) into an AI-replicated editable design.
  // Works the same whether the image lives on our own Supabase bucket or is
  // a remote/hyperlinked URL — either way it's just a fetchable src. The
  // result lands in a brand-new frame placed to the right of the source
  // image, so selecting-and-clicking feels like "make this editable" rather
  // than "upload something".
  const handleConvertSelectedImageToDesign = useCallback(async () => {
    let srcUrl: string | null = null;
    let srcX = 0, srcY = 0, srcW = 1080, srcH = 1080;

    if (selectedElement?.src) {
      const frame = frames.find(f => f.id === selectedElement.frameId);
      if (!frame) { addToast("Selecciona una imagen primero.", "error"); return; }
      srcUrl = selectedElement.src;
      const left = parseFloat(selectedElement.computedStyles.left) || 0;
      const top = parseFloat(selectedElement.computedStyles.top) || 0;
      srcW = parseFloat(selectedElement.computedStyles.width) || srcW;
      srcH = parseFloat(selectedElement.computedStyles.height) || srcH;
      srcX = frame.x + left;
      srcY = frame.y + top;
    } else if (selectedOrphanIds.size === 1) {
      const obj = canvasObjects.find(o => selectedOrphanIds.has(o.id));
      if (!obj || obj.kind !== "image") { addToast("Selecciona una imagen primero.", "error"); return; }
      srcUrl = obj.html.match(/src="([^"]+)"/)?.[1] || null;
      srcX = obj.x; srcY = obj.y; srcW = obj.width || srcW; srcH = obj.height || srcH;
    } else {
      addToast("Selecciona una imagen en el editor primero.", "error");
      return;
    }
    if (!srcUrl) { addToast("La imagen seleccionada no tiene una fuente válida.", "error"); return; }

    setMcpLoading("imageToDesign");
    try {
      const resp = await fetch(srcUrl);
      if (!resp.ok) throw new Error(`No se pudo descargar la imagen (${resp.status})`);
      const blob = await resp.blob();
      const imageBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
        reader.readAsDataURL(blob);
      });

      const newFrame: FrameData = {
        id: createFrameId(),
        name: `Frame ${nextFrameNumber(frames)}`,
        x: Math.round(srcX + srcW + FRAME_GAP), y: Math.round(srcY),
        width: Math.round(srcW) || 1080, height: Math.round(srcH) || 1080,
        html: "", css: "",
        background: "#ffffff",
      };
      const updated = [...frames, newFrame];
      store.replaceAllWithUndo(updated, "edit");
      setSelectedFrameId(newFrame.id);
      setSelectedFrameIds(new Set([newFrame.id]));

      // Persist synchronously (bypassing the 2s-debounced autoSave) so the
      // server-side template already has this frame when image_to_design
      // looks it up by id.
      await apiFetch(`/api/templates/${templateId}`, {
        method: "PUT",
        body: JSON.stringify({
          frames: updated,
          canvasObjects: canvasObjectsRef.current,
          html: newFrame.html,
          css: newFrame.css,
          name: templateName,
        }),
      });

      addToast("🤖 Analizando imagen con IA...", "info");
      const res = await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "image_to_design",
          params: { templateId, imageBase64, frameId: newFrame.id, width: newFrame.width, height: newFrame.height },
          id: 0,
        }),
      });
      if (res.error) throw new Error(res.error.message || "image_to_design falló");
      await reloadFromServer();
      addToast("✓ Diseño generado junto a la imagen original.", "success");
    } catch (err: any) {
      addToast(`No se pudo convertir la imagen: ${err?.message || "error desconocido"}`, "error");
    }
    setMcpLoading(null);
  }, [selectedElement, selectedOrphanIds, canvasObjects, frames, templateId, templateName, reloadFromServer, addToast]);

  // Batchamator commits its generated duplicates the same way any other
  // frame-adding action does — append + undo-tracked + autosaved.
  const handleBatchGenerate = useCallback((updatedFrames: FrameData[]) => {
    store.replaceAllWithUndo(updatedFrames, "edit");
    autoSave(updatedFrames);
  }, [autoSave]);

  // Opens the Batchamator panel, seeding its checklist from whatever's
  // selected on canvas right now — but only when actually opening it (not
  // when it's already the active tab), so re-clicking doesn't clobber a
  // checklist the user built up manually.
  const openBatchPanel = useCallback(() => {
    if (showRightPanel && rightPanelTab === "batch") {
      setShowRightPanel(false);
      return;
    }
    setBatchCheckedFrameIds(selectedFrameIds.size > 0 ? new Set(selectedFrameIds) : new Set(selectedFrameId ? [selectedFrameId] : []));
    setRightPanelTab("batch");
    setShowRightPanel(true);
  }, [showRightPanel, rightPanelTab, selectedFrameIds, selectedFrameId]);

  // Scans a frame's HTML for <img> tags and uploads each distinct src as a
  // Workspace Asset — data: URLs go straight through, http(s) URLs (e.g. an
  // AI-placed image) are fetched and re-uploaded so they land in our own
  // storage, same approach as AssetsPanel's "save selection as asset".
  // Used by the Batchamator "Content Machine" flow to auto-capture any
  // logo/photo/pattern already sitting in the chosen frame.
  const saveFrameImagesAsAssets = useCallback(async (frame: FrameData): Promise<number> => {
    if (!frame.html) return 0;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = frame.html;
    const imgs = Array.from(wrapper.querySelectorAll("img"));
    const seen = new Set<string>();
    let saved = 0;
    for (const img of imgs) {
      const src = img.getAttribute("src");
      if (!src || seen.has(src)) continue;
      seen.add(src);
      try {
        let dataUrl = src;
        if (!dataUrl.startsWith("data:")) {
          const resp = await fetch(src);
          const blob = await resp.blob();
          if (!blob.type.startsWith("image/")) continue;
          dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }
        const name = img.getAttribute("data-layer-name") || img.getAttribute("alt") || `Asset ${saved + 1}`;
        await apiFetch("/api/assets/upload", {
          method: "POST",
          body: JSON.stringify({ name, data: dataUrl, workspaceId: templateWorkspaceId }),
        });
        saved++;
      } catch (e) {
        console.error("[Content Machine] No se pudo guardar la imagen como asset:", e);
      }
    }
    return saved;
  }, [templateWorkspaceId]);

  // ── Batchamator ▸ Content Machine ──
  // 1) guarda el frame elegido como Key Visual, 2) guarda cualquier png/jpg
  // que contenga como Asset, 3) abre el panel de Batchamator (CSV) ya listo
  // para exportar/rellenar/resubir sobre ese mismo frame.
  const handleContentMachine = useCallback(async () => {
    setShowBatchMenu(false);
    const ids = selectedFrameIds.size > 0 ? selectedFrameIds : new Set(selectedFrameId ? [selectedFrameId] : []);
    const targetFrames = frames.filter(f => ids.has(f.id));
    if (targetFrames.length === 0) {
      addToast("Selecciona un frame primero.", "error");
      return;
    }
    await handleSaveRecipe();
    let totalAssets = 0;
    for (const f of targetFrames) {
      totalAssets += await saveFrameImagesAsAssets(f);
    }
    if (totalAssets > 0) {
      addToast(`✓ ${totalAssets} imagen${totalAssets === 1 ? "" : "es"} guardada${totalAssets === 1 ? "" : "s"} como Asset.`, "success");
    }
    openBatchPanel();
  }, [selectedFrameIds, selectedFrameId, frames, handleSaveRecipe, saveFrameImagesAsAssets, openBatchPanel, addToast]);

  // ── Batchamator ▸ Brand Guidelines / Design System ──
  // Ambos toman el frame seleccionado (como "Logotipo" o como "inspiración",
  // según el caso), extraen tokens vía generate_design_artifacts (que ya
  // aplica el fallback a Inter cuando no hay tipografía) y lo guardan como
  // Style en la Biblioteca, con un nombre sugerido para que quede claro de
  // dónde salió.
  const handleCaptureStyleFromSelection = useCallback(async (suffix: string) => {
    setShowBatchMenu(false);
    const ids = selectedFrameIds.size > 0 ? selectedFrameIds : new Set(selectedFrameId ? [selectedFrameId] : []);
    if (ids.size === 0) {
      addToast("Selecciona uno o varios frames primero.", "error");
      return;
    }
    const suggestedName = `${(templateName || "Marca").trim()}_${suffix}`;
    const ok = await handlePublishStyle(suggestedName);
    if (ok) {
      setRightPanelTab("styleLibrary");
      setShowRightPanel(true);
    }
  }, [selectedFrameIds, selectedFrameId, templateName, handlePublishStyle]);

  const handleBrandGuidelinesCapture = useCallback(() => handleCaptureStyleFromSelection("BrandGuidelines"), [handleCaptureStyleFromSelection]);
  const handleDesignSystemCapture = useCallback(() => handleCaptureStyleFromSelection("DesignSystem"), [handleCaptureStyleFromSelection]);

  // While the Batchamator panel is open, outline the canvas frame under the
  // mouse (light) and every checked frame (stronger) — a direct DOM effect
  // rather than new InfiniteHtmlCanvas props, since frame wrapper nodes are
  // keyed by frame.id and stable across re-renders.
  useEffect(() => {
    const active = showRightPanel && rightPanelTab === "batch";
    const wrappers = document.querySelectorAll<HTMLElement>("[data-frame-id]");
    wrappers.forEach(el => {
      const id = el.getAttribute("data-frame-id");
      if (!active || !id) {
        el.style.outline = "";
        el.style.outlineOffset = "";
        return;
      }
      if (id === batchHoveredFrameId) {
        el.style.outline = "2px solid rgba(200,184,152,0.55)";
        el.style.outlineOffset = "-2px";
      } else if (batchCheckedFrameIds.has(id)) {
        el.style.outline = "2px solid rgba(200,184,152,0.95)";
        el.style.outlineOffset = "-2px";
      } else {
        el.style.outline = "";
        el.style.outlineOffset = "";
      }
    });
  }, [showRightPanel, rightPanelTab, batchHoveredFrameId, batchCheckedFrameIds, frames]);

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
    // ── Orphan grouping ──
    if (selectedOrphanIds.size >= 2) {
      const selected = canvasObjects.filter(o => selectedOrphanIds.has(o.id));
      if (selected.length < 2) return;
      const groupId = createOrphanId();
      // Compute bounds
      const minX = Math.min(...selected.map(o => o.x));
      const minY = Math.min(...selected.map(o => o.y));
      const maxX = Math.max(...selected.map(o => o.x + o.width));
      const maxY = Math.max(...selected.map(o => o.y + o.height));
      // Combine HTML: wrap children in a group div with display:contents.
      // Adjust each child's left/top to be relative to the group origin so
      // they preserve their visual canvas position inside the group.
      let combinedHtml = `<div data-layer-id="${groupId}" data-layer-name="Group" data-layer-kind="group" style="display:contents;">`;
      let combinedCss = "";
      for (const o of selected) {
        const relLeft = o.x - minX;
        const relTop = o.y - minY;
        // Adjust inline style left/top (for SVG-based orphans)
        let adjustedHtml = o.html
          .replace(/(style="[^"]*?left:\s*)\d+px/, `$1${relLeft}px`)
          .replace(/(style="[^"]*?top:\s*)\d+px/, `$1${relTop}px`);
        // Adjust CSS left/top/width/height for this child's data-layer-id rule
        const layerIdMatch = o.html.match(/data-layer-id="([^"]+)"/);
        if (layerIdMatch) {
          const lid = layerIdMatch[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          let adjustedCss = o.css;
          adjustedCss = adjustedCss.replace(
            new RegExp(`(\\[data-layer-id="${lid}"\\][^{]*\\{[^}]*?left:\\s*)\\d+px`, "s"),
            `$1${relLeft}px`,
          );
          adjustedCss = adjustedCss.replace(
            new RegExp(`(\\[data-layer-id="${lid}"\\][^{]*\\{[^}]*?top:\\s*)\\d+px`, "s"),
            `$1${relTop}px`,
          );
          combinedCss += "\n" + adjustedCss;
        } else {
          combinedCss += "\n" + o.css;
        }
        combinedHtml += adjustedHtml;
      }
      combinedHtml += "</div>";
      const groupOrphan: HtmlCanvasObject = {
        id: groupId, name: "Group",
        kind: "group", frameId: null,
        html: combinedHtml, css: combinedCss,
        x: minX, y: minY,
        width: maxX - minX, height: maxY - minY,
        zIndex: Math.max(...selected.map(o => o.zIndex)),
      };
      commitCanvasObjects([...canvasObjectsRef.current.filter(o => !selectedOrphanIds.has(o.id)), groupOrphan]);
      setSelectedOrphanIds(new Set([groupId]));
      return;
    }
    // ── Frame element grouping (local, consistent with layers panel) ──
    if (!selectedFrameId || multiSelectLayerIds.length < 2) return;
    const frame = frames.find(f => f.id === selectedFrameId);
    if (!frame) return;
    const result = groupLayersInHtml(
      frame.html,
      [...multiSelectLayerIds],
      `grp_${Date.now().toString(36)}`,
    );
    if (result) {
      const updated = frames.map(f => f.id === selectedFrameId ? { ...f, html: result } : f);
      store.replaceAllWithUndo(updated, "group");
      autoSave(updated);
    }
  }, [selectedFrameId, multiSelectLayerIds, selectedOrphanIds, canvasObjects, frames, autoSave, commitCanvasObjects]);

  const handleUngroup = useCallback(async () => {
    // ── Orphan ungrouping ──
    if (selectedOrphanIds.size > 0) {
      const newOrphans: HtmlCanvasObject[] = [];
      const toRemove = new Set<string>();
      for (const oid of selectedOrphanIds) {
        const obj = canvasObjects.find(o => o.id === oid);
        if (!obj) continue;
        // Parse the orphan's HTML to find group children with data-layer-id
        const parser = new DOMParser();
        const doc = parser.parseFromString(obj.html, "text/html");
        const groupWrapper = doc.body.firstElementChild;
        if (groupWrapper && groupWrapper.getAttribute("data-layer-kind") === "group") {
          // Extract each child as a separate orphan, preserving visual position
          let idx = 0;
          for (const child of Array.from(groupWrapper.children)) {
            const childHtml = child.outerHTML;
            const childLayerId = child.getAttribute("data-layer-id") || createOrphanId();
            // Parse inline style and/or CSS for child's relative position + dimensions
            let childLeft = 0, childTop = 0, childW = obj.width, childH = obj.height;
            const inlineStyle = (child as HTMLElement).style?.cssText || "";
            const inlineLeft = inlineStyle.match(/left:\s*(\d+(?:\.\d+)?)px/);
            const inlineTop = inlineStyle.match(/top:\s*(\d+(?:\.\d+)?)px/);
            const inlineW = inlineStyle.match(/width:\s*(\d+(?:\.\d+)?)px/);
            const inlineH = inlineStyle.match(/height:\s*(\d+(?:\.\d+)?)px/);
            if (inlineLeft) childLeft = parseFloat(inlineLeft[1]);
            if (inlineTop) childTop = parseFloat(inlineTop[1]);
            if (inlineW) childW = parseFloat(inlineW[1]);
            if (inlineH) childH = parseFloat(inlineH[1]);
            // Fallback: parse CSS rule for this child's layer-id
            if (!inlineLeft || !inlineTop) {
              const escapedId = childLayerId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const cssRuleRe = new RegExp(`\\[data-layer-id="${escapedId}"\\]\\s*\\{([^}]*)\\}`, "s");
              const cssMatch = obj.css.match(cssRuleRe);
              if (cssMatch) {
                const ruleBody = cssMatch[1];
                const cssLeft = ruleBody.match(/left:\s*(\d+(?:\.\d+)?)px/);
                const cssTop = ruleBody.match(/top:\s*(\d+(?:\.\d+)?)px/);
                const cssW = ruleBody.match(/width:\s*(\d+(?:\.\d+)?)px/);
                const cssH = ruleBody.match(/height:\s*(\d+(?:\.\d+)?)px/);
                if (!inlineLeft && cssLeft) childLeft = parseFloat(cssLeft[1]);
                if (!inlineTop && cssTop) childTop = parseFloat(cssTop[1]);
                if (!inlineW && cssW) childW = parseFloat(cssW[1]);
                if (!inlineH && cssH) childH = parseFloat(cssH[1]);
              }
            }
            // Filter CSS to only this child's rule + restore left/top to 0
            // (the orphan's x/y now carries the canvas position)
            let childCss = "";
            const escapedId2 = childLayerId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const cssRuleRe2 = new RegExp(`\\[data-layer-id="${escapedId2}"\\]\\s*\\{[^}]*\\}`, "s");
            const ruleMatch = obj.css.match(cssRuleRe2);
            if (ruleMatch) {
              // Extract the matched rule and reset left/top to 0 for the new standalone orphan
              childCss = ruleMatch[0]
                .replace(/left:\s*\d+(?:\.\d+)?px/, "left: 0")
                .replace(/top:\s*\d+(?:\.\d+)?px/, "top: 0");
            }
            newOrphans.push({
              id: childLayerId, name: child.getAttribute("data-layer-name") || `Layer ${idx + 1}`,
              kind: child.getAttribute("data-layer-kind") || "shape", frameId: null,
              html: childHtml, css: childCss,
              x: Math.round(obj.x + childLeft), y: Math.round(obj.y + childTop),
              width: Math.round(childW), height: Math.round(childH),
              zIndex: obj.zIndex + idx,
            });
            idx++;
          }
          toRemove.add(oid);
        }
      }
      if (newOrphans.length > 0) {
        commitCanvasObjects([...canvasObjectsRef.current.filter(o => !toRemove.has(o.id)), ...newOrphans]);
        setSelectedOrphanIds(new Set(newOrphans.map(o => o.id)));
        return;
      }
    }
    // ── Frame element ungrouping (safe: bakes positions + text styles first) ──
    if (!selectedFrameId || !selectedElement) return;
    // Never dissolve a leaf: ungrouping only makes sense with layer children.
    if (!selectedElement.childLayerCount) {
      addToast("Ese elemento no es un grupo (no tiene capas hijas).", "info");
      return;
    }
    const frame = frames.find(f => f.id === selectedFrameId);
    if (!frame) return;
    const bake = measureContainerForBake(selectedFrameId, selectedElement.layerId);
    const newHtml = bake
      ? ungroupPreservingLayout(frame.html, bake)
      : ungroupLayerInHtml(frame.html, selectedElement.layerId);
    if (!newHtml) return;
    const updated = frames.map(f => f.id === selectedFrameId ? { ...f, html: newHtml } : f);
    store.replaceAllWithUndo(updated, "ungroup");
    autoSave(updated);
    setSelectedElement(null);
  }, [selectedFrameId, selectedElement, selectedOrphanIds, canvasObjects, frames, autoSave, commitCanvasObjects]);

  // ── Figma-style container semantics toggle: Grupo (posiciones fijas) ⇄ Contenedor (auto layout) ──
  const handleGroupModeChange = useCallback((layerId: string, frameId: string, mode: "group" | "container") => {
    const frame = frames.find(f => f.id === frameId);
    if (!frame) return;
    const bake = measureContainerForBake(frameId, layerId);
    if (!bake) { addToast("No se pudo medir el grupo en el lienzo.", "error"); return; }
    const newHtml = mode === "group"
      ? convertContainerToGroup(frame.html, bake)
      : convertGroupToContainer(frame.html, bake);
    if (!newHtml || newHtml === frame.html) return;
    const updated = frames.map(f => f.id === frameId ? { ...f, html: newHtml } : f);
    store.replaceAllWithUndo(updated, mode === "group" ? "to-group" : "to-container");
    autoSave(updated);
    addToast(mode === "group"
      ? "Convertido a Grupo: cada hijo ahora es dueño de su posición y tipografía."
      : "Convertido a Contenedor: los hijos fluyen en auto layout.", "success");
  }, [frames, autoSave, addToast]);

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

  const handleExportTokens = useCallback(async () => {
    setMcpLoading("tokens");
    try {
      const data = await callMcp("export_design_tokens", { templateId });
      const json = JSON.stringify(data?.tokens || data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      downloadBlob(blob, `${templateName.replace(/[^a-zA-Z0-9_]/g, "_")}_tokens.json`);
      setMcpMsg("✓ Tokens exported");
    } catch { setMcpMsg("✗ Token export failed"); }
    setMcpLoading(null);
    setTimeout(() => setMcpMsg(""), 3000);
  }, [templateId, templateName, callMcp]);

  // The frames export actually acts on: the multi-select if there is one,
  // else whichever single frame is active — same resolution rule already
  // used for copy/paste (captureSelection above).
  const exportTargetFrames = useMemo(() => {
    const ids = selectedFrameIds.size > 0
      ? selectedFrameIds
      : new Set(selectedFrameId ? [selectedFrameId] : []);
    return frames.filter(f => ids.has(f.id));
  }, [frames, selectedFrameId, selectedFrameIds]);

  // JSON and Tokens ignore the selection entirely — both always operate on
  // the whole template (see ExportPanel's WHOLE_TEMPLATE_FORMATS). Declared
  // after handleExportJSON/handleExportTokens so this can list them as
  // dependencies.
  const handleUnifiedExport = useCallback(async (format: ExportFormat) => {
    if (format === "json") { await handleExportJSON(); return; }
    if (format === "tokens") { await handleExportTokens(); return; }
    if (format === "designSystem") { await handleExtractDesignSystem(); return; }
    if (format === "css") { handleExportCss(); return; }
    if (exportTargetFrames.length === 0) return;
    if (format === "png" || format === "jpg") await handleExportFramesPNG(exportTargetFrames, format);
    else if (format === "svg") await handleExportFramesSVG(exportTargetFrames);
    else if (format === "pdf") await handleExportFramesPDF(exportTargetFrames);
  }, [exportTargetFrames, handleExportFramesPNG, handleExportFramesSVG, handleExportFramesPDF,
      handleExportJSON, handleExportTokens, handleExtractDesignSystem, handleExportCss]);

  // ── Import template ──
  const importTemplateFile = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await callMcp("import_template", { data, workspaceId: templateWorkspaceId });
      setMcpMsg("✓ Template imported");
    } catch { setMcpMsg("✗ Import failed"); }
    setTimeout(() => setMcpMsg(""), 3000);
  }, [callMcp, templateWorkspaceId]);

  const handleImportRoute = useCallback((route: ImportRoute, file?: File) => {
    setShowImportRouter(false);
    if (route === "template") {
      if (file) importTemplateFile(file);
      return;
    }
    setRoutedImportFile(file || null);
    if (route === "svg") setShowSvgImport(true);
    else if (route === "design") setShowDesignImport(true);
    else if (route === "html") setShowPasteHtml(true);
  }, [importTemplateFile]);

  // Editor-wide file drop: dropping anywhere in the editor (not just inside
  // the Import modal) inserts the file immediately. Images are uploaded to
  // the Supabase bucket via upload-file (no assetId returned — it does NOT
  // become a reusable asset until the user explicitly adds it as one via the
  // Assets panel). Other recognized file types (svg/psd/ai/fig/html/json) are
  // routed to their existing specialized importer, pre-loaded with the file.
  const handleAppDroppedImage = useCallback(async (file: File) => {
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });
      const res = await apiFetch<{ url: string }>("/api/assets/upload-file", {
        method: "POST",
        body: JSON.stringify({
          name: file.name,
          data: b64,
          filename: file.name,
          mimeType: file.type,
          workspaceId: templateWorkspaceId || undefined,
        }),
      });
      await handleAssetUploaded({ name: file.name, url: res.url });
    } catch (err: any) {
      console.error("[APP_DROP] Image upload failed:", err);
      addToast("No se pudo subir la imagen.", "error");
    }
  }, [templateWorkspaceId, addToast, handleAssetUploaded]);

  const [isAppDragOver, setIsAppDragOver] = useState(false);
  const appDragCounterRef = useRef(0);

  const handleAppDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
  }, []);

  const handleAppDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    appDragCounterRef.current += 1;
    setIsAppDragOver(true);
  }, []);

  const handleAppDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    appDragCounterRef.current = Math.max(0, appDragCounterRef.current - 1);
    if (appDragCounterRef.current === 0) setIsAppDragOver(false);
  }, []);

  const handleAppDrop = useCallback((e: React.DragEvent) => {
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    e.preventDefault();
    appDragCounterRef.current = 0;
    setIsAppDragOver(false);
    // A file-related modal is already open with its own drop zone — let it
    // handle this drop instead of double-processing the file.
    if (showImportRouter || showSvgImport || showDesignImport || showPasteHtml) return;
    Array.from(files).forEach(file => {
      const isImage = file.type.startsWith("image/") && !/\.svg$/i.test(file.name);
      if (isImage) {
        handleAppDroppedImage(file);
        return;
      }
      const route = detectImportRoute(file);
      if (route) {
        handleImportRoute(route, file);
      } else {
        addToast(`No se reconoce el tipo de archivo "${file.name}".`, "error");
      }
    });
  }, [showImportRouter, showSvgImport, showDesignImport, showPasteHtml, handleAppDroppedImage, handleImportRoute, addToast]);

  // ── Dockable panels ──
  const rightDock = useDockablePanel(window.innerWidth - 290, 56, "right");
  const layersDock = useDockablePanel(380, 56, "left");
  const toolbarDock = useDockablePanel(20, 80, "left");

  const layersIsDocked = showLayersPanel && layersDock.state.isDocked;
  const layersDockOffset = 0;
  const leftPanelsWidth = (layersIsDocked && layersDock.state.dockSide === "left" ? 260 : 0);
  const toolbarLeft = toolbarDock.state.isDocked ? leftPanelsWidth : undefined;
  // Docked panels float via position:fixed (see useDockablePanel) so by
  // default they render OVER the canvas instead of reserving space for it —
  // the ruler, being sized to its own container, then draws its ticks
  // straight through them. Insetting the canvas by each currently-docked
  // panel's width makes the canvas (and therefore the ruler, which measures
  // this same shrunken container) stop before the panel instead of running
  // under it. Undocked/dragging panels are free-floating and don't reserve
  // space; z-index ordering (see CanvasGuides) keeps them visually on top
  // of the ruler in that case instead.
  const canvasLeftInset = leftPanelsWidth + (toolbarDock.state.isDocked ? 56 : 0);
  const canvasRightInset = (showRightPanel && rightDock.state.isDocked && rightDock.state.dockSide === "right") ? rightPanelWidth : 0;

  // ── Background Render Worker ──
  // Polls for pending render jobs created by MCP export_batch.
  // When jobs are found, renders each frame via rasterizeFrame (frameCapture.ts)
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

      try {
        const canvas = await rasterizeFrame(
          { html: frame.html, css: frame.css, width: frame.width, height: frame.height, background: frame.background || "transparent" },
          job.scale || 2,
        );
        const dataUrl = canvas.toDataURL("image/png");

        // Upload to server
        await fetch(`${API_BASE}/api/render/job/${job.jobId}/complete`, {
          method: "POST",
          headers: getApiHeaders(),
          body: JSON.stringify({ pngDataUrl: dataUrl }),
        });
      } catch (err) {
        console.warn("[RenderWorker] Render failed", err);
      }
    };

    const poll = async () => {
      if (renderingRef.current) return; // Don't stack polls
      try {
        const res = await fetch(`${API_BASE}/api/render/queue/pending?templateId=${encodeURIComponent(templateId)}`, { headers: getApiHeaders() });
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
      <div style={{ display: "flex", height: "100vh", width: "100vw", background: "#080808", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#888", fontSize: 16 }}>Loading template...</div>
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ display: "flex", height: "100vh", width: "100vw", background: "#080808", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: "#f87171", fontSize: 16, marginBottom: 12 }}>{error}</div>
          <button type="button" onClick={onBack} className="glass-btn">
            <IconArrowLeft size={14} /> Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const RIGHT_PANEL_TITLES: Record<string, string> = {
    contextual: "Properties",
    history: "History",
    meta: "Information",
    styleLibrary: "Biblioteca",
    batch: "Batchamator",
  };

  return (
    <div
      className="editor-v2-root"
      onDragEnter={handleAppDragEnter}
      onDragOver={handleAppDragOver}
      onDragLeave={handleAppDragLeave}
      onDrop={handleAppDrop}
    >
      {isAppDragOver && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999, pointerEvents: "none",
          border: "3px dashed #c8b898", background: "rgba(200,184,152,0.06)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "#111", color: "#e0e0e0", padding: "10px 18px", borderRadius: 8,
            fontSize: 14, border: "1px solid rgba(200,184,152,0.4)",
          }}>
            Suelta el archivo para agregarlo
          </div>
        </div>
      )}
      {/* ═══ Top Bar ═══ */}
      <div className="editor-v2-topbar">
        <button type="button" onClick={onBack} className="editor-v2-topbar-btn" title="Back to Dashboard">
          <IconArrowLeft size={14} />
        </button>
        {/* Hamburger — visible on mobile/tablet */}
        <button type="button" className="editor-v2-hamburger" onClick={() => setMobileMenuOpen(true)} aria-label="Open menu">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
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

        {/* ═══ Zona: Documento (zoom + guardado de versión) ═══ */}
        <div className="editor-v2-topbar-group" data-tour="topbar-documento" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Zoom: magnifying glass first (so it reads as "this is zoom"),
              then -, live level (click to type an exact %), then +. Moved
              here from the floating left toolbar so it's always visible
              next to Guardar. */}
          <span className="editor-v2-topbar-icon-btn" style={{ cursor: "default", opacity: 0.6 }} title="Zoom">
            <IconSearch size={13} />
          </span>
          <button
            type="button"
            className="editor-v2-topbar-icon-btn"
            onClick={handleZoomOut}
            title="Zoom Out"
          >
            <IconZoomOut size={13} />
          </button>
          {editingZoomTopbar ? (
            <input
              type="number"
              step={5}
              min={5}
              max={500}
              autoFocus
              defaultValue={Math.round(zoom * 100)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const v = parseInt((e.target as HTMLInputElement).value) || 100;
                  handleZoomSet(Math.min(500, Math.max(5, v)) / 100);
                  setEditingZoomTopbar(false);
                }
                if (e.key === "Escape") setEditingZoomTopbar(false);
              }}
              onBlur={(e) => {
                const raw = parseInt((e.target as HTMLInputElement).value);
                if (!isNaN(raw)) handleZoomSet(Math.min(500, Math.max(5, raw)) / 100);
                setEditingZoomTopbar(false);
              }}
              style={{
                width: 46, height: 24, borderRadius: 6, textAlign: "center",
                background: "rgba(200,184,152,0.12)", border: "1px solid #c8b898",
                color: "#c8b898", fontSize: 11, fontFamily: "SF Mono, monospace",
                outline: "none", padding: 0,
              }}
            />
          ) : (
            <button
              type="button"
              className="editor-v2-topbar-icon-btn"
              onClick={() => setEditingZoomTopbar(true)}
              title="Click to edit zoom %"
              style={{ fontSize: 11, fontFamily: "SF Mono, monospace" }}
            >
              {Math.round(zoom * 100)}%
            </button>
          )}
          <button
            type="button"
            className="editor-v2-topbar-icon-btn"
            onClick={handleZoomIn}
            title="Zoom In"
          >
            <IconZoomIn size={13} />
          </button>

          <button
            type="button"
            className="editor-v2-topbar-icon-btn"
            onClick={handleSaveVersion}
            disabled={savingVersion}
            title="Guardar versión (Ctrl/⌘+S) — queda permanente en el historial"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            <span style={{ fontSize: 9, marginLeft: 3 }}>{savingVersion ? "…" : "Guardar"}</span>
          </button>

          {/* History sits right next to Guardar — it's the record of what
              that button produces, not a design-context panel. */}
          <button
            type="button"
            className={`editor-v2-topbar-icon-btn ${showRightPanel && rightPanelTab === "history" ? "active" : ""}`}
            onClick={() => {
              if (showRightPanel && rightPanelTab === "history") {
                setShowRightPanel(false);
              } else {
                setRightPanelTab("history");
                setShowRightPanel(true);
              }
            }}
            title="History"
          >
            <IconHistory size={14} />
          </button>

          {/* Information: brand/campaign/tags metadata for this file
              (formerly labeled "Obsidian") — also where the cover-image
              capture lives (Dashboard prefers this cover over the auto
              thumbnail, so the old separate "Capture Thumbnail" button
              was redundant). */}
          <button
            type="button"
            className={`editor-v2-topbar-icon-btn ${showRightPanel && rightPanelTab === "meta" ? "active" : ""}`}
            onClick={() => {
              if (showRightPanel && rightPanelTab === "meta") {
                setShowRightPanel(false);
              } else {
                setRightPanelTab("meta");
                setShowRightPanel(true);
              }
            }}
            title="Information — marca, campaña, tags y conexiones del grafo"
          >
            <IconInfo size={14} />
          </button>
        </div>

        <div className="editor-v2-topbar-sep" />

        {/* ═══ Zona: Bibliotecas (recursos reusables que guardas y aplicas
            a otros diseños — estilos, assets, iconos, key visuals, y el
            contexto de marca/campaña de Obsidian) ═══ */}
        <div className="editor-v2-topbar-group" data-tour="topbar-bibliotecas" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Biblioteca: opens as a right-side panel (like Properties/
              History/Información) — Estilos (Brand Guidelines), Plantillas
              (Key Visuals) y Recursos (Assets) viven en sus pestañas internas. */}
          <button
            type="button"
            className={`editor-v2-topbar-icon-btn ${showRightPanel && rightPanelTab === "styleLibrary" ? "active" : ""}`}
            onClick={() => {
              if (showRightPanel && rightPanelTab === "styleLibrary") {
                setShowRightPanel(false);
              } else {
                setRightPanelTab("styleLibrary");
                setShowRightPanel(true);
              }
            }}
            title="Biblioteca — Estilos, Plantillas y Recursos"
          >
            <IconPalette size={14} />
            <span style={{ fontSize: 9, marginLeft: 3 }}>Biblioteca</span>
          </button>

        </div>

        <div className="editor-v2-topbar-sep" />

        {/* ═══ Zona: Import / Export (mover contenido dentro y fuera) ═══ */}
        <div className="editor-v2-topbar-group" data-tour="topbar-import-export" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Import: single entry point that routes to the right tool (SVG
              editor, design-file import, or HTML/CSS import) based on
              what's dropped or picked — see ImportRouterModal. */}
          <button
            type="button"
            className="editor-v2-topbar-icon-btn"
            onClick={() => setShowImportRouter(true)}
            title="Import (SVG, PSD, AI, FIG, HTML/CSS, Template JSON)"
            style={{ color: "var(--editor-accent, #6c5ce7)" }}
          >
            <IconUpload size={14} />
            <span style={{ fontSize: 11, marginLeft: 4 }}>Import</span>
          </button>

          {/* Export: format dropdown + scope toggle + export button */}
          <ExportPanel
            frames={frames}
            selectedFrames={exportTargetFrames}
            onExport={handleUnifiedExport}
          />
        </div>

        <div className="editor-v2-topbar-sep" />

        {/* ═══ Zona: Automatizaciones (IA + generación en lote) ═══ */}
        <div className="editor-v2-topbar-group" data-tour="topbar-automatizaciones" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Image to Design — acts on the selected image, no upload popup */}
          <button
            type="button"
            className="editor-v2-topbar-icon-btn"
            onClick={handleConvertSelectedImageToDesign}
            disabled={mcpLoading === "imageToDesign"}
            title="Convert selected image to Design (AI Vision)"
            style={{ background: "linear-gradient(135deg, rgba(200,184,152,0.15), rgba(168,146,106,0.15))" }}
          >
            <span style={{ fontSize: 14 }}>{mcpLoading === "imageToDesign" ? "⏳" : "🪄"}</span>
          </button>

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

          {/* Batchamator — un botón, tres flujos: Content Machine, Brand
              Guidelines, Design System. Ver handleContentMachine /
              handleBrandGuidelinesCapture / handleDesignSystemCapture. */}
          <div style={{ position: "relative" }}>
            <button
              type="button"
              className={`editor-v2-topbar-icon-btn ${(showRightPanel && rightPanelTab === "batch") || showBatchMenu ? "active" : ""}`}
              onClick={() => setShowBatchMenu(v => !v)}
              title="Batchamator — Content Machine, Brand Guidelines, Design System"
            >
              <IconGrid size={14} />
              <span style={{ fontSize: 9, marginLeft: 1 }}>B</span>
            </button>
            {showBatchMenu && (
              <>
                <div
                  onClick={() => setShowBatchMenu(false)}
                  style={{ position: "fixed", inset: 0, zIndex: 999 }}
                />
                <div
                  style={{
                    position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 1000,
                    background: "var(--glass-bg)", backdropFilter: "blur(20px) saturate(180%)",
                    WebkitBackdropFilter: "blur(20px) saturate(180%)",
                    border: "1px solid var(--glass-border)", borderRadius: 10,
                    padding: 6, width: 240, display: "flex", flexDirection: "column", gap: 2,
                  }}
                >
                  <button
                    type="button" onClick={handleContentMachine} style={batchMenuItemStyle}
                    onMouseOver={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
                    onMouseOut={e => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 12.5 }}>📄 Content Machine</div>
                    <div style={{ fontSize: 10.5, color: "#9a9484", marginTop: 1 }}>Guarda como Plantilla + Assets, exporta CSV para generar variantes</div>
                  </button>
                  <button
                    type="button" onClick={handleBrandGuidelinesCapture} style={batchMenuItemStyle}
                    onMouseOver={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
                    onMouseOut={e => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 12.5 }}>🎨 Brand Guidelines</div>
                    <div style={{ fontSize: 10.5, color: "#9a9484", marginTop: 1 }}>Toma el frame como logotipo y arma un Style de marca</div>
                  </button>
                  <button
                    type="button" onClick={handleDesignSystemCapture} style={batchMenuItemStyle}
                    onMouseOver={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
                    onMouseOut={e => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 12.5 }}>🧩 Design System</div>
                    <div style={{ fontSize: 10.5, color: "#9a9484", marginTop: 1 }}>Toma el frame como inspiración y arma un Style reusable</div>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="editor-v2-topbar-sep" />

        {/* ═══ Zona: Guías del lienzo (visualizadores / toggles) ═══ */}
        <div className="editor-v2-topbar-group" data-tour="topbar-guias" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            className={`editor-v2-topbar-icon-btn ${showRightPanel && rightPanelTab === "contextual" ? "active" : ""}`}
            onClick={() => {
              if (showRightPanel && rightPanelTab === "contextual") {
                setShowRightPanel(false);
              } else {
                setRightPanelTab("contextual");
                setShowRightPanel(true);
              }
            }}
            title="Toggle Properties"
          >
            <IconSliders size={14} />
          </button>
          <button
            type="button"
            className={`editor-v2-topbar-icon-btn ${showLayersPanel ? "active" : ""}`}
            onClick={() => setShowLayersPanel(v => !v)}
            title="Toggle Layers"
          >
            <IconLayers size={14} />
          </button>
          <button
            type="button"
            className={`editor-v2-topbar-icon-btn ${showRulers ? "active" : ""}`}
            onClick={() => setShowRulers(v => !v)}
            title="Toggle Rulers (Ctrl+R)"
          >
            <IconRuler size={14} />
          </button>
          <button
            type="button"
            className={`editor-v2-topbar-icon-btn ${showGrid ? "active" : ""}`}
            onClick={() => setShowGrid(v => !v)}
            title="Toggle Pixel Grid (Ctrl+')"
          >
            <IconGrid size={14} />
          </button>
          <button
            type="button"
            className={`editor-v2-topbar-icon-btn ${showColumnPanel ? "active" : ""}`}
            onClick={() => setShowColumnPanel(v => !v)}
            title="Column Guides — configure layout columns"
          >
            <IconColumns size={14} />
          </button>
          {guides.length > 0 && (
            <button
              type="button"
              className="editor-v2-topbar-icon-btn"
              onClick={() => setGuides([])}
              title="Clear all guides"
            >
              <IconEraser size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ═══ Column Config Panel ═══ */}
      {showColumnPanel && (
        <div style={{
          position: "absolute", top: 56, right: 16, zIndex: 6000,
          background: "rgba(28,28,30,0.97)", backdropFilter: "blur(16px)",
          border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10,
          padding: "16px 18px", width: 240, boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
          fontFamily: "Inter, system-ui, sans-serif",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>Column Guides</span>
            <button
              type="button"
              onClick={() => setShowColumnPanel(false)}
              style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", padding: 2 }}
            >
              <IconX size={14} />
            </button>
          </div>

          {/* Enable/disable */}
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={columnConfig !== null}
              onChange={(e) => {
                if (e.target.checked) {
                  setColumnConfig({ count: 6, gutter: 24, margin: 48 });
                } else {
                  setColumnConfig(null);
                }
              }}
              style={{ accentColor: "#3B82F6" }}
            />
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>Enable columns on selected frame</span>
          </label>

          {columnConfig && (
            <>
              {/* Count */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 4 }}>Columns</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="range" min={1} max={24} step={1}
                    value={columnConfig.count}
                    onChange={(e) => setColumnConfig({ ...columnConfig, count: parseInt(e.target.value) })}
                    style={{ flex: 1, accentColor: "#3B82F6" }}
                  />
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", width: 28, textAlign: "right", fontFamily: "monospace" }}>{columnConfig.count}</span>
                </div>
              </div>

              {/* Gutter */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 4 }}>Gutter (px)</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="range" min={0} max={100} step={1}
                    value={columnConfig.gutter}
                    onChange={(e) => setColumnConfig({ ...columnConfig, gutter: parseInt(e.target.value) })}
                    style={{ flex: 1, accentColor: "#3B82F6" }}
                  />
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", width: 28, textAlign: "right", fontFamily: "monospace" }}>{columnConfig.gutter}</span>
                </div>
              </div>

              {/* Margin */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 4 }}>Margin (px)</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="range" min={0} max={200} step={1}
                    value={columnConfig.margin}
                    onChange={(e) => setColumnConfig({ ...columnConfig, margin: parseInt(e.target.value) })}
                    style={{ flex: 1, accentColor: "#3B82F6" }}
                  />
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", width: 28, textAlign: "right", fontFamily: "monospace" }}>{columnConfig.margin}</span>
                </div>
              </div>

              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 }}>
                {selectedFrameId ? "Showing on selected frame" : "Select a frame to see columns"}
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ Hamburger Slide-out Menu (mobile/tablet) ═══ */}
      {mobileMenuOpen && (
        <>
          <div className="landing-menu-overlay" onClick={() => setMobileMenuOpen(false)} />
          <div className="landing-menu-panel">
            <div className="landing-menu-header">
              <span style={{ fontSize: 16, fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>Menu</span>
              <button type="button" className="landing-menu-close" onClick={() => setMobileMenuOpen(false)} aria-label="Close menu">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="landing-menu-nav">
              {/* Title */}
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "rgba(255,255,255,0.3)", padding: "0 12px", marginBottom: 4 }}>Actions</div>
              
              {/* Properties tabs */}
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "rgba(255,255,255,0.3)", padding: "8px 12px 4px" }}>Panels</div>
              <button type="button" className="landing-menu-link"
                onClick={() => {
                  if (showRightPanel && rightPanelTab === "history") setShowRightPanel(false);
                  else { setRightPanelTab("history"); setShowRightPanel(true); }
                  setMobileMenuOpen(false);
                }}
                style={{ fontSize: 13, padding: "10px 14px" }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconHistory size={16} /> History
                </span>
              </button>
              <button type="button" className="landing-menu-link"
                onClick={() => {
                  if (showRightPanel && rightPanelTab === "contextual") setShowRightPanel(false);
                  else { setRightPanelTab("contextual"); setShowRightPanel(true); }
                  setMobileMenuOpen(false);
                }}
                style={{ fontSize: 13, padding: "10px 14px" }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconSliders size={16} /> Properties
                </span>
              </button>
              <button type="button" className="landing-menu-link"
                onClick={() => {
                  if (showRightPanel && rightPanelTab === "meta") setShowRightPanel(false);
                  else { setRightPanelTab("meta"); setShowRightPanel(true); }
                  setMobileMenuOpen(false);
                }}
                style={{ fontSize: 13, padding: "10px 14px" }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconInfo size={16} /> Information
                </span>
              </button>
              
              <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "8px 0" }} />
              
              <button type="button" className="landing-menu-link"
                onClick={() => {
                  if (showRightPanel && rightPanelTab === "styleLibrary") setShowRightPanel(false);
                  else { setRightPanelTab("styleLibrary"); setShowRightPanel(true); }
                  setMobileMenuOpen(false);
                }}
                style={{ fontSize: 13, padding: "10px 14px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconPalette size={16} /> Biblioteca
                </span>
              </button>
              <button type="button" className="landing-menu-link" onClick={() => { setShowFontPicker(!showFontPicker); setMobileMenuOpen(false); }}
                style={{ fontSize: 13, padding: "10px 14px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconType size={16} /> Font Picker
                </span>
              </button>
              <button type="button" className="landing-menu-link" onClick={() => { setShowImportRouter(true); setMobileMenuOpen(false); }}
                style={{ fontSize: 13, padding: "10px 14px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconUpload size={16} /> Import
                </span>
              </button>

              <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "8px 0" }} />

              <button type="button" className="landing-menu-link" onClick={() => { duplicateFrame(); setMobileMenuOpen(false); }}
                style={{ fontSize: 13, padding: "10px 14px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconCopy size={16} /> Duplicate Frame
                </span>
              </button>
              <button type="button" className="landing-menu-link" onClick={() => { deleteSelectedFrame(); setMobileMenuOpen(false); }}
                disabled={frames.length <= 1}
                style={{ fontSize: 13, padding: "10px 14px", opacity: frames.length <= 1 ? 0.3 : 1 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconTrash size={16} /> Delete Frame
                </span>
              </button>
              
              <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "8px 0" }} />
              
              <button type="button" className="landing-menu-link" onClick={() => { handleExtractDesignSystem(); setMobileMenuOpen(false); }}
                style={{ fontSize: 13, padding: "10px 14px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconDownload size={16} /> Extract Design System
                </span>
              </button>
              <button type="button" className="landing-menu-link" onClick={() => { handleConvertSelectedImageToDesign(); setMobileMenuOpen(false); }}
                style={{ fontSize: 13, padding: "10px 14px", background: "rgba(200,184,152,0.1)" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 16 }}>🪄</span> Image to Design
                </span>
              </button>
              <button type="button" className="landing-menu-link" onClick={() => { setShowIconPicker(true); setMobileMenuOpen(false); }}
                style={{ fontSize: 13, padding: "10px 14px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconShapes size={16} /> Icons
                </span>
              </button>
              
              <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "8px 0" }} />
              
              <button type="button" className="landing-menu-link" onClick={() => { handleLintDesign(); setMobileMenuOpen(false); }}
                style={{ fontSize: 13, padding: "10px 14px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconWand size={16} /> Lint Design
                </span>
              </button>
              <button type="button" className="landing-menu-link" onClick={() => { handleContentMachine(); setMobileMenuOpen(false); }}
                style={{ fontSize: 13, padding: "10px 14px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconGrid size={16} /> Batchamator: Content Machine
                </span>
              </button>
              <button type="button" className="landing-menu-link" onClick={() => { handleBrandGuidelinesCapture(); setMobileMenuOpen(false); }}
                style={{ fontSize: 13, padding: "10px 14px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconGrid size={16} /> Batchamator: Brand Guidelines
                </span>
              </button>
              <button type="button" className="landing-menu-link" onClick={() => { handleDesignSystemCapture(); setMobileMenuOpen(false); }}
                style={{ fontSize: 13, padding: "10px 14px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconGrid size={16} /> Batchamator: Design System
                </span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* ═══ Font Picker Dropdown ═══ */}
      {showFontPicker && (
        <div className="editor-v2-font-picker-dropdown">
          <GoogleFontPicker value={selectedFont} onChange={handleFontSelect} />
        </div>
      )}

      {/* ═══ Main Area ═══ */}
      <div className="editor-v2-main" data-tour="editor-canvas">
        {/* ── Layers Panel (slide-in from left) ── */}
        {showLayersPanel && (
          <div className="editor-v2-layers-panel" data-tour="editor-layers" style={layersDock.panelStyle(260, layersDockOffset)}>
            <div className="dock-handle" {...layersDock.handleProps}>
              <span>Layers</span>
              <button type="button" onClick={() => layersDock.toggleDock("left")} className="dock-pin-btn" title={layersDock.state.isDocked ? "Undock" : "Dock left"}>
                {layersDock.state.isDocked ? "📌" : "📍"}
              </button>
            </div>
            <HtmlLayersPanel
              frames={frames}
              canvasObjects={canvasObjects}
              selectedFrameId={selectedFrameId}
              selectedFrameIds={selectedFrameIds}
              selectedOrphanIds={selectedOrphanIds}
              selectedElementId={selectedElement?.layerId || null}
              selectedElementIds={multiSelectLayerIds}
              onSelectFrame={handleSelectFrame}
              onFrameShiftClick={handleFrameShiftClick}
              onSelectElement={handleSelectLayerElement}
              onSelectOrphan={handleSelectOrphan}
              onOrphanShiftClick={handleOrphanShiftClick}
              onOrphanDelete={handleDeleteOrphan}
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
            <div className="editor-v2-insert-bar">
            <InsertToolbar
              templateId={templateId}
              onHtmlUpdated={(html, css) => {
                if (selectedFrameId) {
                  handleFrameCssChange(selectedFrameId, css, html);
                }
              }}
            />
            </div>
          )}
          {/* ── Element Operations Bar (when element selected) ── */}
          {selectedElement && (
            <div className="editor-v2-elem-ops" style={{
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
                  background: layoutMode === "smart" ? "rgba(200,184,152,0.3)" : "rgba(255,255,255,0.06)",
                  color: layoutMode === "smart" ? "#a78bfa" : "#ccc",
                  fontWeight: 600,
                }}>
                {mcpLoading === "smart" ? "..." : layoutMode === "smart" ? "Smart" : "Fixed"}
              </button>
            </div>
          )}
          <InfiniteHtmlCanvas
            leftInset={canvasLeftInset}
            rightInset={canvasRightInset}
            frames={frames}
            canvasObjects={canvasObjects}
            selectedFrameIds={selectedFrameIds}
            selectedOrphanIds={selectedOrphanIds}
            contentFrameId={contentFrameId}
            activeTool={activeTool}
            zoom={zoom}
            onSelectFrame={handleSelectFrame}
            onActivateFrame={handleActivateFrame}
            onFrameShiftClick={handleFrameShiftClick}
            onMarqueeSelect={handleMarqueeSelect}
            onMarqueeSelectOrphans={handleMarqueeSelectOrphans}
            onEnterContentMode={handleEnterContentMode}
            onZoomChange={setZoom}
            onFrameMove={handleFrameMove}
            onMultiFrameMove={handleMultiFrameMove}
            onDuplicateFrames={handleDuplicateFramesAtPositions}
            onRenameFrame={handleRenameFrame}
            onElementSelect={handleElementSelect}
            onRequestLayerSelect={(frameId, layerId, additive) => handleSelectLayerElement(frameId, layerId, undefined, additive)}
            layerSelectionRequest={layerSelectionRequest}
            selectedElement={selectedElement}
            selectedLayerIds={multiSelectLayerIds}
            onLayerSelectionChange={handleLayerSelectionChange}
            onFrameCssChange={handleFrameCssChange}
            onFrameHtmlChange={handleFrameHtmlChange}
            onAddPrimitive={handleAddPrimitive}
            onDrawShape={handleDrawShape}
            onTextChange={handleTextChange}
            onAddPenPath={handleAddPenPath}
            onAddTextPath={handleAddTextPath}
            onAddTextBox={handleAddTextBox}
            onEditPathPoints={handleEditPathPoints}
            onElementDelete={handleDeleteElement}
            onElementDuplicate={handleDuplicateElement}
            onFrameResize={handleFrameResize}
            onCreateFrame={handleCreateFrameAt}
            onCreateOrphanFromTool={handleCreateOrphanFromTool}
            onSelectOrphan={handleSelectOrphan}
            onOrphanShiftClick={handleOrphanShiftClick}
            onOrphanMove={handleOrphanMove}
            onDeleteOrphan={handleDeleteOrphan}
            onOrphanHtmlChange={handleOrphanHtmlChange}
            autoEditOrphanId={autoEditOrphanId}
            onAutoEditOrphanHandled={() => setAutoEditOrphanId(null)}
            autoEditLayerId={autoEditLayerId}
            onAutoEditHandled={() => setAutoEditLayerId(null)}
            guides={guides}
            onGuidesChange={setGuides}
            showGrid={showGrid}
            gridSize={gridSize}
            showRulers={showRulers}
            columnConfig={columnConfig}
            smartGuides={[]}
          />
        </div>
      </div>

      {/* ═══ Floating Left Toolbar ═══ */}
      <div className="editor-v2-floating-toolbar" data-tour="editor-toolbar" style={{ ...toolbarDock.panelStyle(56), ...(toolbarLeft !== undefined ? { left: toolbarLeft } : {}) }}>
        <div className="dock-handle" {...toolbarDock.handleProps} style={{ justifyContent: "center", padding: "2px 4px", minHeight: 16 }}>
          <span style={{ fontSize: 8, letterSpacing: 2 }}>TOOLS</span>
        </div>
        <FloatingToolbar
          tool={activeTool}
          onToolChange={setActiveTool}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          multiSelectCount={multiSelectLayerIds.length}
          onPathfinder={handlePathfinder}
          onIconPicker={() => setShowIconPicker(true)}
          onGroup={handleGroup}
          onUngroup={handleUngroup}
          canGroup={multiSelectLayerIds.length >= 2 || selectedOrphanIds.size >= 2}
          canUngroup={(!!selectedElement && !!selectedElement.childLayerCount) || selectedOrphanIds.size > 0}
        />
      </div>

      {/* ═══ Floating Right Properties Panel ═══ */}
      {showRightPanel && (
        <div className="editor-v2-right-panel" data-tour="editor-props" style={{ ...rightDock.panelStyle(rightPanelWidth), width: rightPanelWidth }}>
          {/* Drag the left edge to resize */}
          <div
            onMouseDown={handleRightPanelResizeStart}
            title="Arrastra para cambiar el ancho"
            style={{
              position: "absolute", left: -3, top: 0, bottom: 0, width: 6,
              cursor: "ew-resize", zIndex: 5,
            }}
          />
          <div className="dock-handle" {...rightDock.handleProps}>
            <span>{RIGHT_PANEL_TITLES[rightPanelTab] || "Properties"}</span>
            <button type="button" onClick={() => rightDock.toggleDock("right")} className="dock-pin-btn" title={rightDock.state.isDocked ? "Undock" : "Dock right"}>
              {rightDock.state.isDocked ? "📌" : "📍"}
            </button>
          </div>
          {rightPanelTab === "contextual" && (selectedElement || selectedFrame) && (
            <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
              {(["properties", "code", "animation"] as const).map(t => (
                <button key={t} type="button" onClick={() => setContextualSubTab(t)}
                  style={{
                    flex: 1, padding: "6px 4px", fontSize: 10, textTransform: "capitalize",
                    background: contextualSubTab === t ? "rgba(255,255,255,0.06)" : "transparent",
                    color: contextualSubTab === t ? "#e0e0e0" : "#888",
                    border: "none", borderBottom: contextualSubTab === t ? "2px solid #c8b898" : "2px solid transparent",
                    cursor: "pointer", fontFamily: "inherit",
                  }}>
                  {t}
                </button>
              ))}
            </div>
          )}
          {rightPanelTab === "contextual" && selectedElement && (
            <HtmlContextualPanel
              workspaceId={templateWorkspaceId}
              element={selectedElement}
              html={activeHtml}
              css={activeCss}
              onCssChange={handleContextualCssChange}
              onChangeTag={handleChangeTag}
              onCopyStyle={handleCopyStyle}
              onPasteStyle={handlePasteStyle}
              hasClipboardStyle={!!clipboardStyle}
              onConvertToPath={handleConvertToPath}
              onOutlineStroke={handleOutlineStroke}
              onOffsetPath={handleOffsetPath}
              onShapeOptionsChange={handleShapeOptionsChange}
              onGroupModeChange={handleGroupModeChange}
              frameWidth={selectedFrame?.width || 0}
              frameHeight={selectedFrame?.height || 0}
              subTab={contextualSubTab}
            />
          )}
          {rightPanelTab === "contextual" && !selectedElement && contextualSubTab === "properties" && (
            selectedFrame ? (
              <div style={{ padding: "4px", display: "flex", flexDirection: "column", gap: 6, overflow: "auto", flex: 1 }}>
                {/* Frame Name */}
                <div style={{ padding: "6px 10px", fontSize: 13, fontWeight: 600, color: "#f0ebe0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  {selectedFrame.name}
                </div>

                {/* Dimensions */}
                <div style={{ padding: "0 10px" }}>
                  <div style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Dimensions</div>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <input
                      type="number"
                      value={selectedFrame.width}
                      onChange={(e) => { const v = Number(e.target.value); if (v >= 10) handleFrameDimensionChange("width", v); }}
                      style={{ flex: 1, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.05)", color: "#f0ebe0", borderRadius: 4, padding: "3px 6px", fontSize: 11, fontFamily: "monospace", minWidth: 0 }}
                      min={10}
                    />
                    <span style={{ color: "#555", fontSize: 11, flexShrink: 0 }}>×</span>
                    <input
                      type="number"
                      value={selectedFrame.height}
                      onChange={(e) => { const v = Number(e.target.value); if (v >= 10) handleFrameDimensionChange("height", v); }}
                      style={{ flex: 1, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.05)", color: "#f0ebe0", borderRadius: 4, padding: "3px 6px", fontSize: 11, fontFamily: "monospace", minWidth: 0 }}
                      min={10}
                    />
                  </div>
                </div>

                {/* Background */}
                <div style={{ padding: "0 10px" }}>
                  <div style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Background</div>
                  <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      type="color"
                      value={toHexColor(selectedFrame.background)}
                      onChange={(e) => handleFrameBackgroundChange(e.target.value)}
                      style={{ width: 28, height: 24, border: "1px solid rgba(255,255,255,0.06)", borderRadius: 4, cursor: "pointer", padding: 0, flexShrink: 0, background: "none" }}
                    />
                    <input
                      type="text"
                      value={selectedFrame.background || ""}
                      onChange={(e) => handleFrameBackgroundChange(e.target.value)}
                      style={{ flex: 1, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.05)", color: "#f0ebe0", borderRadius: 4, padding: "3px 6px", fontSize: 11, fontFamily: "monospace", minWidth: 0 }}
                      placeholder="transparent"
                    />
                    <button
                      type="button"
                      onClick={() => handleFrameBackgroundChange("transparent")}
                      style={{ padding: "3px 8px", fontSize: 10, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 4, color: "#888", cursor: "pointer", fontFamily: "inherit" }}
                      title="Make background fully transparent"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => { const inp = document.getElementById("__frame_bg_image_input"); inp?.click(); }}
                      style={{ padding: "3px 8px", fontSize: 10, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 4, color: "#888", cursor: "pointer", fontFamily: "inherit" }}
                      title="Upload background image"
                    >
                      🖼
                    </button>
                    <input
                      id="__frame_bg_image_input"
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFrameBackgroundImage(file);
                        e.target.value = "";
                      }}
                    />
                  </div>
                  {/* Quick color swatches */}
                  <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                    {["#ffffff", "#000000", "#1a1a2e", "#16213e", "#0f3460", "#e94560", "#f5f5f5", "#333333", "#ff6b6b", "#51cf66", "#339af0", "#fcc419"].map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => handleFrameBackgroundChange(c)}
                        style={{ width: 18, height: 18, borderRadius: 3, border: "1px solid rgba(255,255,255,0.1)", background: c, cursor: "pointer", padding: 0, flexShrink: 0 }}
                        title={c}
                      />
                    ))}
                  </div>
                </div>

                {/* Position (read-only) */}
                <div style={{ padding: "0 10px", fontSize: 10, color: "#555" }}>
                  Position: {selectedFrame.x}, {selectedFrame.y}
                </div>
              </div>
            ) : null
          )}
          {rightPanelTab === "contextual" && !selectedElement && selectedFrame && contextualSubTab === "code" && (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: 8 }}>
              <CodePanel html={activeHtml} css={activeCss} onHtmlChange={handleHtmlChange} onCssChange={handleCssChange} />
            </div>
          )}
          {rightPanelTab === "contextual" && !selectedElement && selectedFrame && contextualSubTab === "animation" && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#7a7668", fontSize: 12, padding: 24, textAlign: "center", lineHeight: 1.6 }}>
              Sin herramientas de animación todavía.
            </div>
          )}
          {rightPanelTab === "contextual" && !selectedElement && !selectedFrame && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#7a7668", fontSize: 12, padding: 24, textAlign: "center", lineHeight: 1.6 }}>
              Select a frame or element<br />to edit its properties
            </div>
          )}
          {rightPanelTab === "history" && (
            <VersionHistoryPanel templateId={templateId} onRestore={reloadFromServer} />
          )}
          {rightPanelTab === "meta" && (
            <FileInfoPanel
              templateId={templateId}
              onCoverCapture={handleCoverCapture}
            />
          )}
          {rightPanelTab === "styleLibrary" && (
            <StyleLibraryPanel
              workspaceId={templateWorkspaceId || "default"}
              onToast={(msg, type) => addToast(msg, type || "info")}
              onPublish={handlePublishStyle}
              publishing={publishingStyle}
              onSaveKeyVisual={handleSaveRecipe}
              saveRecipeMsg={saveRecipeMsg}
              selectedFrameCount={selectedFrameIds.size > 0 ? selectedFrameIds.size : (selectedFrameId ? 1 : 0)}
              onOpenTemplate={onOpenTemplate}
              onAssetUploaded={handleAssetUploaded}
              selectedImageSrc={selectedElement?.src}
              onManageStorage={() => {
                sessionStorage.setItem("dashboardInitialTab", "storage");
                setShowRightPanel(false);
                onBack();
              }}
            />
          )}
          {rightPanelTab === "batch" && (
            <BatchAMator
              frames={frames}
              checkedFrameIds={batchCheckedFrameIds}
              onCheckedFrameIdsChange={setBatchCheckedFrameIds}
              onFrameHover={setBatchHoveredFrameId}
              onGenerate={handleBatchGenerate}
            />
          )}
        </div>
      )}

      {/* ═══ SVG Import Dialog ═══ */}
      {showSvgImport && (
        <SvgImportDialog
          workspaceId={templateWorkspaceId}
          initialFile={routedImportFile}
          onImported={handleSvgImported}
          onRasterImported={handleRasterImageImported}
          onClose={() => { setShowSvgImport(false); setRoutedImportFile(null); }}
        />
      )}



      {/* ═══ Paste HTML/CSS Modal ═══ */}
      {showPasteHtml && (
        <PasteHtmlModal
          initialFile={routedImportFile}
          onClose={() => { setShowPasteHtml(false); setRoutedImportFile(null); }}
          onApply={async (result: PasteResult) => {
            await applyPastedHtmlAsFrame(result);
            addToast("✓ HTML/CSS applied", "success");
            setShowPasteHtml(false);
          }}
        />
      )}

      {/* ═══ Paste-as-image detection dialog ═══ */}
      {pasteChoiceText !== null && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: 20, width: 360, color: "#e0e0e0" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>¿Cómo quieres pegar esto?</div>
            <div style={{ fontSize: 12, color: "#999", marginBottom: 16 }}>
              El contenido copiado parece ser código (HTML/JSON). Puedes pegarlo como un diseño editable o como texto plano.
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <button type="button" onClick={() => handlePasteChoiceConfirm(true)} style={{ flex: 1, padding: "8px 10px", borderRadius: 6, border: "1px solid rgba(200,184,152,0.4)", background: "rgba(200,184,152,0.15)", color: "#e0e0e0", cursor: "pointer", fontSize: 13 }}>Pegar como imagen</button>
              <button type="button" onClick={() => handlePasteChoiceConfirm(false)} style={{ flex: 1, padding: "8px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#e0e0e0", cursor: "pointer", fontSize: 13 }}>Pegar como texto</button>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#aaa" }}>
              <input type="checkbox" checked={pasteChoiceSnoozeEnabled} onChange={e => setPasteChoiceSnoozeEnabled(e.target.checked)} />
              No preguntar durante
              <input
                type="number"
                min={1}
                max={90}
                value={pasteChoiceSnoozeDays}
                onChange={e => setPasteChoiceSnoozeDays(Math.max(1, Math.min(90, parseInt(e.target.value, 10) || 1)))}
                style={{ width: 48, background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 4, color: "#e0e0e0", padding: "2px 4px" }}
              />
              días
            </label>
          </div>
        </div>
      )}

      {/* ═══ Design Import Modal (SVG, PSD, AI, FIG) ═══ */}
      <DesignImportModal
        open={showDesignImport}
        initialFiles={routedImportFile ? [routedImportFile] : null}
        onClose={() => { setShowDesignImport(false); setRoutedImportFile(null); }}
        onImport={handleDesignImport}
        workspaceId={templateWorkspaceId}
      />

      {/* ═══ Unified Import router — one button, detects the file type ═══ */}
      {showImportRouter && (
        <ImportRouterModal
          onClose={() => setShowImportRouter(false)}
          onRoute={handleImportRoute}
        />
      )}

      {/* ═══ Icon Picker ═══ */}
      {showIconPicker && (
        <IconPicker
          templateId={templateId}
          // Fall back to the only frame when nothing's explicitly selected —
          // the overwhelmingly common single-canvas case — instead of making
          // the user click into the frame first just to open this picker.
          frameId={selectedFrameId || (frames.length === 1 ? frames[0].id : null)}
          onClose={() => setShowIconPicker(false)}
          onInsert={() => {
            addToast("✓ Icon inserted", "success");
            reloadFromServer();
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


      {/* ═══ Guided onboarding tour (editor steps) ═══ */}
      <OnboardingTour
        page="editor"
        onAction={(action: TourAction) => {
          if (action === "back-to-dashboard") onBack();
          else if (action === "show-layers") setShowLayersPanel(true);
          else if (action === "show-props") setShowRightPanel(true);
        }}
      />
    </div>
  );
}
