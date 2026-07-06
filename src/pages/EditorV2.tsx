import React, { useState, useCallback, useEffect, useRef } from "react";
import html2canvas from "html2canvas";
import { CodePanel } from "../components/CodePanel";
import type { CodePanelRef } from "../components/CodePanel";
import { GoogleFontPicker } from "../components/GoogleFontPicker";
import { ActiveAgentsPanel } from "../components/ActiveAgentsPanel";
import { StructurePanel } from "../components/StructurePanel";
import { VariablesPanel } from "../components/VariablesPanel";
import { BrandPanel } from "../components/BrandPanel";
import { FormatPanel } from "../components/FormatPanel";
import { FloatingToolbar } from "../components/FloatingToolbar";
import { InfiniteHtmlCanvas, type HtmlToolName } from "../components/InfiniteHtmlCanvas";
import type { FrameData, SelectedElementInfo } from "../components/DesignFrame";
import { HtmlContextualPanel } from "../components/HtmlContextualPanel";
import { HtmlLayersPanel } from "../components/HtmlLayersPanel";
import { ImageUploadModal } from "../components/ImageUploadModal";
import { SvgImportDialog } from "../components/SvgImportDialog";
import { InsertToolbar } from "../components/InsertToolbar";
import { VersionHistoryPanel } from "../components/VersionHistoryPanel";
import { useDockablePanel } from "../hooks/useDockablePanel";
import { getTemplate, saveLocal } from "../lib/templateApi";
import { apiFetch } from "../lib/supabase";
import { mcpCall } from "../lib/mcpClient";
import { subscribeTemplate, broadcastChange, subscribePresence } from "../lib/supabaseRealtime";
import {
  IconArrowLeft, IconCode, IconSliders, IconLayout, IconDna, IconPalette,
  IconFile, IconBot, IconType, IconImage, IconCopy, IconTrash,
  IconDownload, IconChevronLeft, IconChevronRight, IconFrame, IconTag,
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

/// Directly inject a Google Font <link> into every active Shadow DOM for immediate rendering.
function injectFontIntoShadowDOMs(fontUrl: string) {
  const href = `https://fonts.googleapis.com/css2?family=${fontUrl}:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&display=swap`;
  const frames = document.querySelectorAll("[data-frame-id]");
  for (const frameEl of frames) {
    for (const child of frameEl.querySelectorAll("*")) {
      if ((child as HTMLElement).shadowRoot) {
        const shadow = (child as HTMLElement).shadowRoot!;
        const existing = shadow.querySelectorAll("link");
        const already = [...existing].some(l => (l as HTMLLinkElement).href === href);
        if (!already) {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = href;
          shadow.insertBefore(link, shadow.firstChild);
        }
        break;
      }
    }
  }
}

export function EditorV2({ templateId, onBack }: EditorV2Props) {
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

  // ── Selected element (inside a frame) ──
  const [selectedElement, setSelectedElement] = useState<SelectedElementInfo | null>(null);
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<string>("contextual");
  const [multiSelectLayerIds, setMultiSelectLayerIds] = useState<string[]>([]);
  const [showSvgImport, setShowSvgImport] = useState(false);

  // ── Derived: active frame ──
  const selectedFrame = frames.find(f => f.id === selectedFrameId) ?? null;
  const activeHtml = selectedFrame?.html ?? DEFAULT_HTML;
  const activeCss = selectedFrame?.css ?? DEFAULT_CSS;

  // ── Undo/Redo helpers ──
  const pushUndo = useCallback((current: FrameData[]) => {
    console.error("[UNDO] pushUndo called", { stackSize: undoStack.current.length, frameCount: current.length });
    undoStack.current.push(JSON.parse(JSON.stringify(current)));
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  const handleUndo = useCallback(() => {
    console.error("[UNDO] Ctrl+Z FIRED", { stackSize: undoStack.current.length });
    if (undoStack.current.length === 0) {
      console.error("[UNDO] Undo stack EMPTY — nothing to undo");
      return;
    }
    const prev = undoStack.current.pop()!;
    // Push current state to redo stack BEFORE setFrames (StrictMode-safe: outside updater)
    redoStack.current.push(JSON.parse(JSON.stringify(framesRef.current)));
    setFrames(prev);
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(true);
    isDirtyRef.current = true;
    autoSaveRef.current(prev);
  }, []);

  const handleRedo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    const next = redoStack.current.pop()!;
    // Push current state to undo stack BEFORE setFrames (StrictMode-safe: outside updater)
    undoStack.current.push(JSON.parse(JSON.stringify(framesRef.current)));
    setFrames(next);
    setCanUndo(true);
    setCanRedo(redoStack.current.length > 0);
    isDirtyRef.current = true;
    autoSaveRef.current(next);
  }, []);

  // ── Load template → parse into frames ──
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        console.error("[LOAD] FETCHING TEMPLATE", { templateId, BUILD_VERSION });
        const tpl = await getTemplate(templateId);
        console.error("[LOAD] getTemplate returned:", { hasTpl: !!tpl, framesLen: (tpl as any)?.frames?.length, hasHtml: !!(tpl as any)?.html, hasCss: !!(tpl as any)?.css, metadata: (tpl as any)?.metadata });
        if (cancelled) return;
        if (!tpl) { setError("Template not found"); setLoading(false); console.error("[LOAD] ✗ Template not found"); return; }
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
            html: f.html || "",
            css: f.css || "",
            background: f.background || "#ffffff",
          }));
          setFrames(loaded);
          setSelectedFrameId(loaded[0]?.id ?? null);
          // Reset undo stack and push initial state so Ctrl+Z can revert to loaded state
          undoStack.current = [];
          redoStack.current = [];
          undoStack.current.push(JSON.parse(JSON.stringify(loaded)));
          setCanUndo(false);
          setCanRedo(false);
          console.error("[LOAD] ✓ Parsed frames:", { count: loaded.length, ids: loaded.map(f => f.id), firstHtmlLen: loaded[0]?.html?.length, firstCssLen: loaded[0]?.css?.length });
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
          // Reset undo stack and push initial state
          undoStack.current = [];
          redoStack.current = [];
          undoStack.current.push(JSON.parse(JSON.stringify([single])));
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
      console.error("[SAVE] ✓ localStorage IMMEDIATE save OK", { templateId, framesLen: updatedFrames.length });
    } catch (localErr) {
      console.error("[SAVE] ✗ localStorage FAILED:", localErr);
    }

    // ✅ Mark as dirty so polling won't overwrite our state
    isDirtyRef.current = true;

    // ✅ Debounced API sync (2s)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true);
      console.error("[SAVE] ═══ API SYNC FIRED ═══", { templateId, frameCount: updatedFrames.length });

      // Sync to API + Supabase with exponential-backoff retry (max 3 attempts)
      const MAX_RETRIES = 3;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const putRes = await apiFetch(`/api/templates/${templateId}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });
          console.error("[SAVE] ✓ API PUT OK", { attempt, responseHasFrames: !!(putRes as any)?.data?.frames });
          broadcastChange(realtimeChannelRef.current, templateId, active?.html || "", active?.css || "");
          lastBroadcastRef.current = { html: active?.html || "", css: active?.css || "" };
          retryCountRef.current = 0;
          isDirtyRef.current = false; // clear dirty flag after successful sync
          break;
        } catch (err) {
          console.error(`[SAVE] ✗ API PUT attempt ${attempt + 1}/${MAX_RETRIES + 1} FAILED:`, err);
          retryCountRef.current = attempt + 1;
          if (attempt < MAX_RETRIES) {
            const delay = Math.pow(2, attempt) * 1000;
            console.warn(`[EditorV2] Auto-save retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`);
            await new Promise(r => setTimeout(r, delay));
          } else {
            console.warn("[EditorV2] Auto-save exhausted retries (cached in localStorage):", err);
          }
        }
      }
      setSaving(false);
      console.error("[SAVE] ═══ API SYNC COMPLETE ═══");
    }, 2000);
  }, [templateId, selectedFrameId, templateName]);

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
    const channel = subscribeTemplate(templateId, (newHtml, newCss) => {
      // Skip the initial callback fired when the channel is first joined
      if (!realtimeReadyRef.current) {
        realtimeReadyRef.current = true;
        return;
      }
      if (!selectedFrameId) return;
      // Ignore our own broadcasts
      if (lastBroadcastRef.current &&
          lastBroadcastRef.current.html === newHtml &&
          lastBroadcastRef.current.css === newCss) {
        return;
      }
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
        // ✅ Guard: skip polling entirely if we have unsaved local changes
        if (isDirtyRef.current) {
          console.warn("[POLL] Skipping — local changes pending API sync");
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
                  console.warn("[POLL] Remote frames differ from local — updating");
                  setFrames(t.frames);
                }
              } else if (framesRef.current.length > 0 && (!t.frames || t.frames.length === 0)) {
                // Remote has no frames but we do → re-save our frames as recovery
                console.warn("[EditorV2] Polling returned empty frames, re-saving local frames");
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
    console.warn("[CSS STATE] handleCssChange entry", { selectedFrameId, newCssLen: newCss.length, frameCount: frames.length, hasImport: newCss.startsWith("@import") });
    if (!selectedFrameId) { console.warn("[CSS STATE] ABORTED — no selectedFrameId"); return; }
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
    console.error("[FRAME-CSS] handleFrameCssChange entry", { frameId, cssLen: newCss.length, hasHtml: !!newHtml });
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
    // Use full weight range for all variants
    const importLine = `@import url('https://fonts.googleapis.com/css2?family=${fontUrl}:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&display=swap');\n`;
    let newCss = activeCss;
    if (!newCss.includes(`family=${fontUrl}`)) newCss = importLine + newCss;

    // Directly inject the font into every Shadow DOM for immediate effect
    injectFontIntoShadowDOMs(fontUrl);

    // Apply font-family to selected element's CSS rule if one is selected
    if (selectedElement) {
      const escaped = selectedElement.selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const ruleRe = new RegExp(`(${escaped}\\s*\\{)([^}]*)(\\})`);
      const ruleMatch = ruleRe.exec(newCss);
      if (ruleMatch) {
        let decl = ruleMatch[2];
        const famRe = /font-family\s*:[^;]*;?/;
        if (famRe.test(decl)) {
          decl = decl.replace(famRe, `font-family: '${fontFamily}', sans-serif;`);
        } else {
          decl = decl.trimEnd() + `\n  font-family: '${fontFamily}', sans-serif;\n`;
        }
        newCss = newCss.replace(ruleRe, `${ruleMatch[1]}${decl}${ruleMatch[3]}`);
      }
    }
    handleCssChange(newCss);
  }, [activeCss, selectedFrameId, selectedElement, handleCssChange]);

  // ── Element selection from DesignFrame ──
  const handleElementSelect = useCallback((info: SelectedElementInfo | null) => {
    setSelectedElement(info);
    if (info) setShowRightPanel(true);
  }, []);

  // ── Layer selection from Layers Panel → click element in canvas ──
  const handleSelectLayerElement = useCallback((layerId: string, path?: number[]) => {
    if (!selectedFrameId) return;
    const frameEl = document.querySelector(`[data-frame-id="${selectedFrameId}"]`);
    if (!frameEl) return;
    const allChildren = frameEl.querySelectorAll("*");
    let shadow: ShadowRoot | null = null;
    for (const child of allChildren) {
      if (child.shadowRoot) { shadow = child.shadowRoot; break; }
    }
    if (!shadow) return;
    const content = shadow.getElementById("__df_content");
    if (!content) return;

    let el: Element | null = null;

    // Try data-layer-id lookup first
    if (!layerId.startsWith("auto_")) {
      el = content.querySelector(`[data-layer-id="${layerId}"]`);
    }

    // Fallback: walk DOM by path for auto-generated layers
    if (!el && path && path.length > 0) {
      el = content;
      for (let i = 0; i < path.length; i++) {
        const idx = path[i];
        if (idx < el.children.length) {
          el = el.children[idx];
        } else {
          el = null;
          break;
        }
      }
    }

    if (el) {
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent("mousedown", {
        bubbles: true, composed: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 0, view: window,
      }));
    }
  }, [selectedFrameId]);

  // ── Contextual panel CSS change ──
  const handleContextualCssChange = useCallback((newCss: string) => {
    handleCssChange(newCss);
  }, [handleCssChange]);

  // ── Add visual primitive to active frame ──
  const handleAddPrimitive = useCallback((type: "rect" | "circle" | "triangle" | "star" | "polygon" | "text", x: number, y: number, sides?: number) => {
    if (!selectedFrameId) return;
    const layerId = `el_${Date.now().toString(36)}`;
    let html: string;
    let css: string;
    const defaultSize = type === "polygon" ? 120 : (type === "star" ? 130 : 150);
    if (type === "rect") {
      html = `<div data-layer-id="${layerId}" style="width:200px;height:150px;background:#3B82F6;border-radius:8px;position:absolute;left:${x}px;top:${y}px;"></div>`;
      css = `[data-layer-id="${layerId}"] {\n  width: 200px;\n  height: 150px;\n  background: #3B82F6;\n  border-radius: 8px;\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n}\n`;
    } else if (type === "circle") {
      html = `<div data-layer-id="${layerId}" style="width:150px;height:150px;background:#EF4444;border-radius:50%;position:absolute;left:${x}px;top:${y}px;"></div>`;
      css = `[data-layer-id="${layerId}"] {\n  width: 150px;\n  height: 150px;\n  background: #EF4444;\n  border-radius: 50%;\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n}\n`;
    } else if (type === "triangle") {
      const w = 150, h = 150;
      html = `<svg data-layer-id="${layerId}" viewBox="0 0 ${w} ${h}" style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;overflow:visible;"><path d="M${w / 2} 0 L0 ${h} L${w} ${h} Z" fill="#10B981" stroke="#059669" stroke-width="2"/></svg>`;
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
      html = `<svg data-layer-id="${layerId}" viewBox="0 0 ${s} ${s}" style="position:absolute;left:${x}px;top:${y}px;width:${s}px;height:${s}px;overflow:visible;"><path d="M${pts.join(" L")} Z" fill="#F59E0B" stroke="#D97706" stroke-width="2"/></svg>`;
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
      html = `<svg data-layer-id="${layerId}" viewBox="0 0 ${s} ${s}" style="position:absolute;left:${x}px;top:${y}px;width:${s}px;height:${s}px;overflow:visible;"><path d="M${pts.join(" L")} Z" fill="#8B5CF6" stroke="#7C3AED" stroke-width="2"/></svg>`;
      css = `[data-layer-id="${layerId}"] {\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n  width: ${s}px;\n  height: ${s}px;\n  overflow: visible;\n}\n`;
    } else {
      html = `<div data-layer-id="${layerId}" style="font-size:24px;color:#333;position:absolute;left:${x}px;top:${y}px;">Text</div>`;
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
    const layerId = `el_${Date.now().toString(36)}`;
    let html: string;
    let css: string;
    if (type === "rect") {
      html = `<div data-layer-id="${layerId}"></div>`;
      css = `[data-layer-id="${layerId}"] {\n  width: ${w}px;\n  height: ${h}px;\n  background: #3B82F6;\n  border-radius: 8px;\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n}\n`;
    } else if (type === "circle") {
      html = `<div data-layer-id="${layerId}"></div>`;
      css = `[data-layer-id="${layerId}"] {\n  width: ${w}px;\n  height: ${h}px;\n  background: #EF4444;\n  border-radius: 50%;\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n}\n`;
    } else if (type === "triangle") {
      html = `<svg data-layer-id="${layerId}" viewBox="0 0 ${w} ${h}" style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;overflow:visible;"><path d="M${w / 2} 0 L0 ${h} L${w} ${h} Z" fill="#10B981" stroke="#059669" stroke-width="2"/></svg>`;
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
      html = `<svg data-layer-id="${layerId}" viewBox="0 0 ${s} ${s}" style="position:absolute;left:${x}px;top:${y}px;width:${s}px;height:${s}px;overflow:visible;"><path d="M${pts.join(" L")} Z" fill="#F59E0B" stroke="#D97706" stroke-width="2"/></svg>`;
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
      html = `<svg data-layer-id="${layerId}" viewBox="0 0 ${s} ${s}" style="position:absolute;left:${x}px;top:${y}px;width:${s}px;height:${s}px;overflow:visible;"><path d="M${pts.join(" L")} Z" fill="#8B5CF6" stroke="#7C3AED" stroke-width="2"/></svg>`;
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
    // Replace the text content of the element with the given layer-id
    const elRe = new RegExp(`(<[^>]*data-layer-id="${layerId.replace(/[[\]"\\]/g, "\\$&")}"[^>]*>)([\\s\\S]*?)(<\\/[a-zA-Z0-9]+>)`, "i");
    const match = elRe.exec(frame.html);
    if (!match) return;
    const newHtml = frame.html.replace(elRe, `${match[1]}${newText}${match[3]}`);
    const updated = frames.map(f =>
      f.id === selectedFrameId ? { ...f, html: newHtml } : f
    );
    pushUndo(frames);
    setFrames(updated);
    autoSave(updated);
  }, [selectedFrameId, frames, autoSave, pushUndo]);

  // ── Phase E: Pen path creation (supports closed paths) ──
  const handleAddPenPath = useCallback((pathData: string, bounds: { x: number; y: number; width: number; height: number }, closed?: boolean) => {
    if (!selectedFrameId) return;
    const layerId = `el_${Date.now().toString(36)}`;
    const fillValue = closed ? "rgba(139,92,246,0.18)" : "none";
    const svgHtml = `<svg data-layer-id="${layerId}" viewBox="${bounds.x} ${bounds.y} ${Math.max(bounds.width, 1)} ${Math.max(bounds.height, 1)}" style="position:absolute;left:${bounds.x}px;top:${bounds.y}px;width:${Math.max(bounds.width, 1)}px;height:${Math.max(bounds.height, 1)}px;overflow:visible;"><path d="${pathData}" fill="${fillValue}" stroke="#8B5CF6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const css = `[data-layer-id="${layerId}"] {\n  position: absolute;\n  left: ${bounds.x}px;\n  top: ${bounds.y}px;\n  width: ${Math.max(bounds.width, 1)}px;\n  height: ${Math.max(bounds.height, 1)}px;\n  overflow: visible;\n}\n`;
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

  // ── Phase C: Delete element inside frame ──
  const handleDeleteElement = useCallback((layerId: string) => {
    if (!selectedFrameId) return;
    const frame = frames.find(f => f.id === selectedFrameId);
    if (!frame) return;
    // Remove HTML element
    const elRe = new RegExp(`<[^>]*data-layer-id="${layerId}"[^>]*>[\\s\\S]*?<\\/[a-zA-Z0-9]+>|<[^>]*data-layer-id="${layerId}"[^>]*\\s*\\/?>`, "g");
    const newHtml = frame.html.replace(elRe, "");
    // Remove CSS rule
    const cssRe = new RegExp(`\\[data-layer-id="${layerId}"\\]\\s*\\{[^}]*\\}\\s*`, "g");
    const newCss = frame.css.replace(cssRe, "");
    const updated = frames.map(f =>
      f.id === selectedFrameId ? { ...f, html: newHtml, css: newCss } : f
    );
    pushUndo(frames);
    setFrames(updated);
    autoSave(updated);
    setSelectedElement(null);
  }, [selectedFrameId, frames, autoSave, pushUndo]);

  // ── Phase C: Duplicate element inside frame ──
  const handleDuplicateElement = useCallback((layerId: string) => {
    if (!selectedFrameId) return;
    const frame = frames.find(f => f.id === selectedFrameId);
    if (!frame) return;
    // Find the element HTML
    const elRe = new RegExp(`(<[^>]*data-layer-id="${layerId}"[^>]*>[\\s\\S]*?<\\/[a-zA-Z0-9]+>|<[^>]*data-layer-id="${layerId}"[^>]*\\s*\\/?>)`, "");
    const match = elRe.exec(frame.html);
    if (!match) return;
    const newLayerId = `el_${Date.now().toString(36)}`;
    // Clone HTML with new layer-id
    const clonedHtml = match[1].replace(`data-layer-id="${layerId}"`, `data-layer-id="${newLayerId}"`);
    // Clone CSS with new layer-id selector
    const cssRe = new RegExp(`\\[data-layer-id="${layerId}"\\]\\s*\\{([^}]*)\\}`, "");
    const cssMatch = cssRe.exec(frame.css);
    let newCss = "";
    if (cssMatch) {
      // Offset position slightly
      let decl = cssMatch[1];
      const leftMatch = /left:\s*(\d+)px/.exec(decl);
      const topMatch = /top:\s*(\d+)px/.exec(decl);
      if (leftMatch) decl = decl.replace(/left:\s*\d+px/, `left: ${parseInt(leftMatch[1]) + 20}px`);
      if (topMatch) decl = decl.replace(/top:\s*\d+px/, `top: ${parseInt(topMatch[1]) + 20}px`);
      newCss = `\n[data-layer-id="${newLayerId}"] {${decl}}\n`;
    }
    const updated = frames.map(f =>
      f.id === selectedFrameId
        ? { ...f, html: f.html + "\n" + clonedHtml, css: f.css + newCss }
        : f
    );
    pushUndo(frames);
    setFrames(updated);
    autoSave(updated);
  }, [selectedFrameId, frames, autoSave, pushUndo]);

  // ── Change semantic tag of selected element ──
  const handleChangeTag = useCallback((newTag: string) => {
    if (!selectedElement || !selectedFrameId) return;
    const frame = frames.find(f => f.id === selectedElement.frameId);
    if (!frame) return;

    const oldTag = selectedElement.tag;
    const layerId = selectedElement.layerId;

    // Replace the opening tag in HTML
    const openTagRe = new RegExp(`<${oldTag}([^>]*data-layer-id="${layerId.replace(/[[\]"\\]/g, "\\$&")}"[^>]*)>`);
    const closeTagRe = new RegExp(`</${oldTag}>`);
    let newHtml = frame.html;
    const openMatch = openTagRe.exec(newHtml);
    if (openMatch) {
      newHtml = newHtml.replace(openTagRe, `<${newTag}$1>`);
      // Replace the corresponding closing tag
      const openPos = newHtml.indexOf(openMatch[0]);
      const afterOpen = newHtml.slice(openPos + openMatch[0].length);
      const closeIdx = afterOpen.search(closeTagRe);
      if (closeIdx >= 0) {
        newHtml = newHtml.slice(0, openPos + openMatch[0].length + closeIdx) +
          `</${newTag}>` +
          newHtml.slice(openPos + openMatch[0].length + closeIdx + oldTag.length + 3);
      }
    }

    // Update CSS selector
    const oldSelector = `[data-layer-id="${layerId}"]`;
    // CSS selectors don't change with tag (they use attribute selectors), so no CSS update needed

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
      const isInput = ["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName);
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "z" && !e.shiftKey) { console.error("[KEY] Ctrl+Z captured (target:", (e.target as HTMLElement).tagName, ")"); e.preventDefault(); e.stopImmediatePropagation(); handleUndo(); return; }
      if (mod && (e.key === "Z" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); e.stopImmediatePropagation(); handleRedo(); return; }
      if (mod && e.key === "/") { e.preventDefault(); setShowCodePanel(p => !p); return; }
      if (mod && e.key.toLowerCase() === "d" && !e.shiftKey) { e.preventDefault(); duplicateFrame(); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === "d") { e.preventDefault(); if (selectedElement) handleDuplicateElement(selectedElement.layerId); return; }
      if (!isInput && !mod) {
        switch (e.key.toLowerCase()) {
          case "v": setActiveTool("select"); break;
          case "h": setActiveTool("hand"); break;
          case "r": setActiveTool("rect"); break;
          case "o": setActiveTool("circle"); break;
          case "t": setActiveTool("text"); break;
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
        }
      }
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [handleUndo, handleRedo, deleteSelectedFrame, duplicateFrame, handleDeleteElement, handleDuplicateElement, selectedElement, selectedFrameId, frames.length]);

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
      alert("Failed to extract design system: " + (e?.message || e));
    }
  }, [templateId, templateName]);

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
      }
    } catch (err) {
      console.error("[TemplateRename] Error:", err);
    }
    setEditingTemplateName(null);
  }, [templateId, editingTemplateName, templateName]);

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
  const [lockedLayers, setLockedLayers] = useState<Set<string>>(new Set());
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());

  // ── Copy / Paste Style ──
  const handleCopyStyle = useCallback(() => {
    if (!selectedElement) return;
    // Extract all CSS for the current selector
    const escaped = selectedElement.selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const ruleRe = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`);
    const match = ruleRe.exec(activeCss);
    if (match) {
      setClipboardStyle(match[1].trim());
      setMcpMsg("✓ Style copied");
      setTimeout(() => setMcpMsg(""), 1500);
    }
  }, [selectedElement, activeCss]);

  const handlePasteStyle = useCallback(() => {
    if (!selectedElement || !clipboardStyle) return;
    const escaped = selectedElement.selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const ruleRe = new RegExp(`(${escaped}\\s*\\{)([^}]*)(\\})`);
    const match = ruleRe.exec(activeCss);
    let updated: string;
    if (match) {
      updated = activeCss.replace(ruleRe, `${match[1]}\n  ${clipboardStyle}\n${match[3]}`);
    } else {
      updated = activeCss + `\n${selectedElement.selector} {\n  ${clipboardStyle}\n}`;
    }
    handleCssChange(updated);
    setMcpMsg("✓ Style pasted");
    setTimeout(() => setMcpMsg(""), 1500);
  }, [selectedElement, clipboardStyle, activeCss, handleCssChange]);

  // ── Lock / Hide toggle ──
  const handleLockToggle = useCallback((layerId: string, locked: boolean) => {
    setLockedLayers(prev => {
      const next = new Set(prev);
      locked ? next.add(layerId) : next.delete(layerId);
      return next;
    });
    if (locked) {
      handleCssChange(activeCss + `\n[data-layer-id="${layerId}"] { pointer-events: none !important; }`);
    } else {
      const escaped = layerId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      handleCssChange(activeCss.replace(new RegExp(`\\[data-layer-id="${escaped}"\\]\\s*\\{[^}]*pointer-events[^}]*\\}\\s*`, 'g'), ''));
    }
  }, [activeCss, handleCssChange]);

  const handleHideToggle = useCallback((layerId: string, hidden: boolean) => {
    setHiddenLayers(prev => {
      const next = new Set(prev);
      hidden ? next.add(layerId) : next.delete(layerId);
      return next;
    });
    if (hidden) {
      handleCssChange(activeCss + `\n[data-layer-id="${layerId}"] { display: none !important; }`);
    } else {
      const escaped = layerId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      handleCssChange(activeCss.replace(new RegExp(`\\[data-layer-id="${escaped}"\\]\\s*\\{[^}]*display[^}]*\\}\\s*`, 'g'), ''));
    }
  }, [activeCss, handleCssChange]);

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
  const codeDock = useDockablePanel(0, 56, null);
  const layersDock = useDockablePanel(0, 56, null);
  const toolbarDock = useDockablePanel(20, 80, "left");

  // ── Background Render Worker ──
  // Polls for pending render jobs created by MCP export_batch.
  // When jobs are found, renders each frame offscreen via html2canvas
  // and uploads the resulting PNG to the server for AI agent retrieval.
  const renderWorkerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const renderingRef = useRef(false);

  useEffect(() => {
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
        console.warn("[RenderWorker] Job complete", { jobId: job.jobId, status: json.status });

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
          <div className="editor-v2-code-panel" style={codeDock.panelStyle(380)}>
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
          <div className="editor-v2-layers-panel" style={layersDock.panelStyle(260)}>
            <div className="dock-handle" {...layersDock.handleProps}>
              <span>Layers</span>
              <button type="button" onClick={() => layersDock.toggleDock("left")} className="dock-pin-btn" title={layersDock.state.isDocked ? "Undock" : "Dock left"}>
                {layersDock.state.isDocked ? "📌" : "📍"}
              </button>
            </div>
            <HtmlLayersPanel
              html={activeHtml}
              frameId={selectedFrameId || ""}
              selectedElementId={selectedElement?.layerId || null}
              onSelectElement={handleSelectLayerElement}
              onHtmlChange={handleHtmlChange}
              onLayerDelete={handleDeleteElement}
              onLayerDuplicate={handleDuplicateElement}
              onMultiSelectChange={setMultiSelectLayerIds}
              onLockToggle={handleLockToggle}
              onHideToggle={handleHideToggle}
              lockedLayers={lockedLayers}
              hiddenLayers={hiddenLayers}
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
            activeTool={activeTool}
            zoom={zoom}
            onSelectFrame={setSelectedFrameId}
            onZoomChange={setZoom}
            onFrameMove={handleFrameMove}
            onElementSelect={handleElementSelect}
            onFrameCssChange={handleFrameCssChange}
            onFrameHtmlChange={handleFrameHtmlChange}
            onAddPrimitive={handleAddPrimitive}
            onDrawShape={handleDrawShape}
            onTextChange={handleTextChange}
            onAddPenPath={handleAddPenPath}
            onElementDelete={handleDeleteElement}
            onElementDuplicate={handleDuplicateElement}
          />
        </div>
      </div>

      {/* ═══ Code Panel Toggle ═══ */}
      <button
        type="button"
        className="editor-v2-code-toggle"
        onClick={() => setShowCodePanel(!showCodePanel)}
        title={showCodePanel ? "Hide Code (Ctrl+/)" : "Show Code (Ctrl+/)"}
      >
        <IconCode size={14} />
        {showCodePanel ? <IconChevronLeft size={10} /> : <IconChevronRight size={10} />}
      </button>

      {/* ═══ Layers Panel Toggle ═══ */}
      <button
        type="button"
        className="editor-v2-layers-toggle"
        onClick={() => setShowLayersPanel(!showLayersPanel)}
        title={showLayersPanel ? "Hide Layers" : "Show Layers"}
      >
        <IconLayout size={14} />
        {showLayersPanel ? <IconChevronLeft size={10} /> : <IconChevronRight size={10} />}
      </button>

      {/* ═══ Floating Left Toolbar ═══ */}
      <div style={toolbarDock.panelStyle(56)}>
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
          zoom={zoom}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          multiSelectCount={multiSelectLayerIds.length}
          onPathfinder={handlePathfinder}
          onSvgImport={handleSvgImportOpen}
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
          onClose={() => setShowSvgImport(false)}
        />
      )}

      {/* ═══ Image Upload Modal ═══ */}
      {showImageUpload && (
        <ImageUploadModal
          onClose={() => setShowImageUpload(false)}
          onAssetUploaded={(asset) => {
            console.log("[EditorV2] Asset uploaded:", asset);
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
    </div>
  );
}
