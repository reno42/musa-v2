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
import { useDockablePanel } from "../hooks/useDockablePanel";
import { getTemplate, saveLocal } from "../lib/templateApi";
import { apiFetch } from "../lib/supabase";
import { subscribeTemplate, broadcastChange, subscribePresence } from "../lib/supabaseRealtime";
import {
  IconArrowLeft, IconCode, IconSliders, IconLayout, IconDna, IconPalette,
  IconFile, IconBot, IconType, IconImage, IconCopy, IconTrash,
  IconDownload, IconChevronLeft, IconChevronRight, IconFrame, IconTag,
  IconPointer, IconHand, IconZoomIn, IconZoomOut, IconMaximize,
  IconRectangle, IconCircleOutline, IconPen, IconPlus, IconChevronDown,
  IconAlignLeft, IconAlignCenter, IconAlignRight,
} from "../shared/icons";
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
          setError("This template uses an unsupported engine. Only HTML templates are supported.");
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
      const active = updatedFrames.find(f => f.id === selectedFrameId) || updatedFrames[0];
      const payload = {
        frames: updatedFrames,
        html: active?.html || "",
        css: active?.css || "",
        name: templateName,
      };

      // ✅ Dual-write: localStorage first (freemium resilience, instant persistence)
      saveLocal(templateId, payload);

      // Sync to API + Supabase with exponential-backoff retry (max 3 attempts)
      const MAX_RETRIES = 3;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          await apiFetch(`/api/templates/${templateId}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });
          broadcastChange(realtimeChannelRef.current, templateId, active?.html || "", active?.css || "");
          lastBroadcastRef.current = { html: active?.html || "", css: active?.css || "" };
          retryCountRef.current = 0;
          break; // success
        } catch (err) {
          retryCountRef.current = attempt + 1;
          if (attempt < MAX_RETRIES) {
            const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
            console.warn(`[EditorV2] Auto-save retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`);
            await new Promise(r => setTimeout(r, delay));
          } else {
            console.warn("[EditorV2] Auto-save exhausted retries (cached in localStorage):", err);
          }
        }
      }
      setSaving(false);
    }, 2000);
  }, [templateId, selectedFrameId, templateName]);

  useEffect(() => {
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, []);

  // ── Realtime sync ──
  const realtimeReadyRef = useRef(false);
  const lastBroadcastRef = useRef<{ html: string; css: string } | null>(null);
  const framesRef = useRef(frames);
  framesRef.current = frames;

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
        try {
          const tpl = await getTemplate(templateId);
          if (!tpl) return;
          const t = tpl as any;
          const remoteUpdated = t.metadata?.updatedAt;
          if (remoteUpdated && remoteUpdated !== lastRemoteUpdate) {
            if (lastRemoteUpdate !== null) {
              // Safety: never replace non-empty local frames with empty remote frames
              if (t.frames && Array.isArray(t.frames) && t.frames.length > 0) {
                setFrames(t.frames);
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

  // ── Frame CSS change from DesignFrame (drag/resize) ──
  const handleFrameCssChange = useCallback((frameId: string, newCss: string) => {
    const updated = frames.map(f =>
      f.id === frameId ? { ...f, css: newCss } : f
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
  const handleAddPrimitive = useCallback((type: "rect" | "circle" | "text", x: number, y: number) => {
    if (!selectedFrameId) return;
    const layerId = `el_${Date.now().toString(36)}`;
    let html: string;
    let css: string;
    if (type === "rect") {
      html = `<div data-layer-id="${layerId}" style="width:200px;height:150px;background:#3B82F6;border-radius:8px;position:absolute;left:${x}px;top:${y}px;"></div>`;
      css = `[data-layer-id="${layerId}"] {\n  width: 200px;\n  height: 150px;\n  background: #3B82F6;\n  border-radius: 8px;\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n}\n`;
    } else if (type === "circle") {
      html = `<div data-layer-id="${layerId}" style="width:150px;height:150px;background:#EF4444;border-radius:50%;position:absolute;left:${x}px;top:${y}px;"></div>`;
      css = `[data-layer-id="${layerId}"] {\n  width: 150px;\n  height: 150px;\n  background: #EF4444;\n  border-radius: 50%;\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n}\n`;
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
  const handleDrawShape = useCallback((type: "rect" | "circle", x: number, y: number, w: number, h: number) => {
    if (!selectedFrameId) return;
    const layerId = `el_${Date.now().toString(36)}`;
    let html: string;
    let css: string;
    if (type === "rect") {
      html = `<div data-layer-id="${layerId}"></div>`;
      css = `[data-layer-id="${layerId}"] {\n  width: ${w}px;\n  height: ${h}px;\n  background: #3B82F6;\n  border-radius: 8px;\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n}\n`;
    } else {
      html = `<div data-layer-id="${layerId}"></div>`;
      css = `[data-layer-id="${layerId}"] {\n  width: ${w}px;\n  height: ${h}px;\n  background: #EF4444;\n  border-radius: 50%;\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n}\n`;
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

  // ── Phase C: Pen path creation ──
  const handleAddPenPath = useCallback((pathData: string, bounds: { x: number; y: number; width: number; height: number }) => {
    if (!selectedFrameId) return;
    const layerId = `el_${Date.now().toString(36)}`;
    const svgHtml = `<svg data-layer-id="${layerId}" viewBox="${bounds.x} ${bounds.y} ${Math.max(bounds.width, 1)} ${Math.max(bounds.height, 1)}" style="position:absolute;left:${bounds.x}px;top:${bounds.y}px;width:${Math.max(bounds.width, 1)}px;height:${Math.max(bounds.height, 1)}px;overflow:visible;"><path d="${pathData}" fill="none" stroke="#8B5CF6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
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
      if (mod && e.key === "z" && !e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); handleUndo(); return; }
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
  /// Capture a single frame to PNG blob via offscreen html2canvas (no page, no toolbars).
  const captureFrameToPng = useCallback(async (frame: FrameData, scale: number = 2): Promise<Blob | null> => {
    const container = document.createElement("div");
    container.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;";
    document.body.appendChild(container);

    const target = document.createElement("div");
    target.style.cssText = `width:${frame.width}px;height:${frame.height}px;overflow:hidden;position:relative;`;
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
      });

      return new Promise(resolve => {
        canvas.toBlob(blob => resolve(blob), "image/png");
      });
    } catch (err) {
      console.warn("[Export] Capture failed", err);
      return null;
    } finally {
      fontLinks.forEach(l => l.remove());
      container.remove();
    }
  }, []);

  const handleExportFramePNG = useCallback(async () => {
    if (!selectedFrame) return;
    setShowExportMenu(false);
    const blob = await captureFrameToPng(selectedFrame);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedFrame.name.replace(/[<>:"/\\|?*]/g, "_")}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, [selectedFrame, captureFrameToPng]);

  const handleExportAllFramesPNG = useCallback(async () => {
    setShowExportMenu(false);
    for (const frame of frames) {
      const blob = await captureFrameToPng(frame);
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${frame.name.replace(/[<>:"/\\|?*]/g, "_")}.png`;
      a.click();
      URL.revokeObjectURL(url);
      await new Promise(r => setTimeout(r, 300));
    }
  }, [frames, captureFrameToPng]);

  const [showExportMenu, setShowExportMenu] = useState(false);

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
    { id: "agents", icon: <IconBot size={14} />, title: "Agents" },
  ];

  return (
    <div className="editor-v2-root">
      {/* ═══ Top Bar ═══ */}
      <div className="editor-v2-topbar">
        <button type="button" onClick={onBack} className="editor-v2-topbar-btn" title="Back to Dashboard">
          <IconArrowLeft size={14} />
        </button>
        <span className="editor-v2-project-name">{templateName}</span>
        {selectedFrame && (
          <span className="editor-v2-frame-info">
            {selectedFrame.name} · {selectedFrame.width}×{selectedFrame.height}
          </span>
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
                <button type="button" onClick={() => { handleExportFramePNG(); setShowExportMenu(false); }} className="editor-v2-dropdown-item">
                  <IconImage size={14} /> Export Current Frame as PNG
                </button>
                <button type="button" onClick={() => { handleExportAllFramesPNG(); setShowExportMenu(false); }} className="editor-v2-dropdown-item">
                  <IconImage size={14} /> Export All Frames as PNG
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
            />
          </div>
        )}

        {/* ── Canvas (fills remaining space) ── */}
        <div id="canvas-container" className="editor-v2-canvas-area">
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
          {rightPanelTab === "agents" && (
            <ActiveAgentsPanel agents={activeAgents} />
          )}
        </div>
      )}
    </div>
  );
}
