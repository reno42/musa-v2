import React, { useState, useCallback, useEffect, useRef } from "react";
import { HtmlCanvas } from "../components/HtmlCanvas";
import { CodePanel } from "../components/CodePanel";
import type { CodePanelRef } from "../components/CodePanel";
import { GoogleFontPicker } from "../components/GoogleFontPicker";
import { ElementProperties } from "../components/ElementProperties";
import { InsertToolbar } from "../components/InsertToolbar";
import { getTemplate } from "../lib/templateApi";
import { apiFetch } from "../lib/supabase";
import { subscribeTemplate, broadcastChange, subscribePresence } from "../lib/supabaseRealtime";
import { IconArrowLeft } from "../shared/icons";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface EditorV2Props {
  templateId: string;
  onBack: () => void;
}

const DEFAULT_HTML = `<div class="card">
  <h1>Hello World</h1>
  <p>Edit this HTML + CSS in the panel on the left.</p>
</div>`;

const DEFAULT_CSS = `body {
  font-family: 'Inter', system-ui, sans-serif;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
  const [html, setHtml] = useState(DEFAULT_HTML);
  const [css, setCss] = useState(DEFAULT_CSS);
  const [templateName, setTemplateName] = useState("New HTML Template");
  const [width, setWidth] = useState(1080);
  const [height, setHeight] = useState(1080);
  const [zoom, setZoom] = useState(0.5);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const codePanelRef = useRef<CodePanelRef>(null);
  const [selectedFont, setSelectedFont] = useState("");
  const [showFontPicker, setShowFontPicker] = useState(false);
  const [activeAgents, setActiveAgents] = useState<{ agentId: string; sectionId: string }[]>([]);
  const [lastRemoteUpdate, setLastRemoteUpdate] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const presenceChannelRef = useRef<RealtimeChannel | null>(null);
  const [selectedElement, setSelectedElement] = useState<any>(null);
  const [showRightPanel, setShowRightPanel] = useState(false);

  // Load template on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const tpl = await getTemplate(templateId);
        if (cancelled) return;
        if (!tpl) {
          setError("Template not found");
          setLoading(false);
          return;
        }
        const t = tpl as any;
        if (t.engine && t.engine !== "html") {
          setError("This template uses the Fabric.js engine. Open it in the Fabric editor.");
          setLoading(false);
          return;
        }
        setTemplateName(t.name || "Untitled");
        setWidth(t.width || 1080);
        setHeight(t.height || 1080);
        setHtml(t.html || DEFAULT_HTML);
        setCss(t.css || DEFAULT_CSS);
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Failed to load template");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [templateId]);

  // Auto-save on html/css change (debounced 2s)
  const autoSave = useCallback((newHtml: string, newCss: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        await apiFetch(`/api/templates/${templateId}`, {
          method: "PUT",
          body: JSON.stringify({ html: newHtml, css: newCss }),
        });
        // Broadcast via Realtime
        broadcastChange(realtimeChannelRef.current, templateId, newHtml, newCss);
      } catch (err) {
        console.warn("[EditorV2] Auto-save failed:", err);
      } finally {
        setSaving(false);
      }
    }, 2000);
  }, [templateId]);

  useEffect(() => {
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, []);

  // Supabase Realtime WebSocket (replaces polling)
  useEffect(() => {
    const channel = subscribeTemplate(templateId, (newHtml, newCss) => {
      setHtml(newHtml || html);
      setCss(newCss || css);
    });
    if (channel) {
      realtimeChannelRef.current = channel;
      // Fallback polling if Realtime is not configured
    } else {
      // Use polling as fallback when Supabase URL not configured
      pollingRef.current = setInterval(async () => {
        try {
          const tpl = await getTemplate(templateId);
          if (!tpl) return;
          const t = tpl as any;
          const remoteUpdated = t.metadata?.updatedAt;
          if (remoteUpdated && remoteUpdated !== lastRemoteUpdate) {
            if (lastRemoteUpdate !== null) {
              setHtml(t.html || DEFAULT_HTML);
              setCss(t.css || DEFAULT_CSS);
            }
            setLastRemoteUpdate(remoteUpdated);
          }
        } catch { /* silent */ }
      }, 5000);
    }
    // Presence tracking
    const pChannel = subscribePresence(templateId, (agents) => {
      setActiveAgents(agents.map(a => ({ agentId: a.agentId, sectionId: a.sectionId })));
    });
    if (pChannel) presenceChannelRef.current = pChannel;

    return () => {
      if (realtimeChannelRef.current) { realtimeChannelRef.current.unsubscribe(); realtimeChannelRef.current = null; }
      if (presenceChannelRef.current) { presenceChannelRef.current.unsubscribe(); presenceChannelRef.current = null; }
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [templateId]);

  const handleHtmlChange = useCallback((newHtml: string) => {
    setHtml(newHtml);
    autoSave(newHtml, css);
  }, [css, autoSave]);

  const handleCssChange = useCallback((newCss: string) => {
    setCss(newCss);
    autoSave(html, newCss);
  }, [html, autoSave]);

  const handleFontSelect = useCallback((fontFamily: string) => {
    if (!fontFamily) return;
    setSelectedFont(fontFamily);
    setShowFontPicker(false);

    // Build @import URL for the font
    const fontUrl = fontFamily.replace(/ /g, "+");
    const importLine = `@import url('https://fonts.googleapis.com/css2?family=${fontUrl}:wght@400;700&display=swap');\n`;

    // Prepend @import to CSS (if not already present)
    let newCss = css;
    if (!newCss.includes(fontUrl)) {
      newCss = importLine + newCss;
    }

    // Append a commented suggestion snippet
    const snippet = `\n/* Suggested: font-family: '${fontFamily}', sans-serif; */\n`;
    if (!newCss.includes(`'${fontFamily}'`)) {
      newCss += snippet;
    }

    setCss(newCss);
    autoSave(html, newCss);
  }, [css, html, autoSave]);

  const handleSelectElement = useCallback((layerId: string) => {
    // Search HTML for the element with data-layer-id, extract class attribute
    const classMatch = html.match(new RegExp(`data-layer-id="${layerId}"[^>]*class="([^"]*)"`));
    const idMatch = html.match(new RegExp(`data-layer-id="${layerId}"[^>]*id="([^"]*)"`));
    const tagMatch = html.match(new RegExp(`<([a-zA-Z0-9]+)[^>]*data-layer-id="${layerId}"`));

    let selector: string | null = null;
    if (classMatch) {
      selector = classMatch[1].split(/\s+/)[0];
    } else if (idMatch) {
      selector = `#${idMatch[1]}`;
    } else if (tagMatch) {
      selector = tagMatch[1];
    }

    if (selector) {
      const cssLines = css.split("\n");
      let lineNumber = -1;
      for (let i = 0; i < cssLines.length; i++) {
        const line = cssLines[i].trim();
        if (line.startsWith(`.${selector}`) || line === selector || line.startsWith(`${selector} `) || line.startsWith(`${selector},`) || line.startsWith(`${selector}:`) || line.startsWith(`#${selector.replace("#", "")}`)) {
          lineNumber = i + 1; break;
        }
        if (line.includes(`.${selector}`) && line.includes("{")) { lineNumber = i + 1; break; }
      }
      if (lineNumber > 0 && codePanelRef.current) {
        codePanelRef.current.scrollToLine(lineNumber);
      }
    }

    // Populate selected element for properties panel
    const classes = classMatch ? classMatch[1].split(/\s+/) : [];
    const tag = tagMatch ? tagMatch[1] : "unknown";
    // Find CSS properties for this element
    const cssProperties: string[] = [];
    const cssRuleRe = /([^{]+)\{([^}]+)\}/g;
    let rm;
    while ((rm = cssRuleRe.exec(css)) !== null) {
      const sel = rm[1].trim();
      if (classes.some(c => sel.includes(`.${c}`)) || sel === tag || sel.includes(`#${layerId}`)) {
        cssProperties.push(...rm[2].split(";").filter(Boolean).map(s => s.trim()));
      }
    }
    setSelectedElement({
      elementId: layerId, tag, classes, cssProperties,
      htmlSnippet: html.substring(html.indexOf(`data-layer-id="${layerId}"`) - 20, html.indexOf(`data-layer-id="${layerId}"`) + 200),
    });
    setShowRightPanel(true);
  }, [html, css]);

  // Export handlers
  const handleExportPNG = useCallback(() => {
    window.open(`/api/templates/${templateId}/render`, "_blank");
  }, [templateId]);

  const handleExportJSON = useCallback(async () => {
    const tpl = await getTemplate(templateId);
    if (tpl) {
      const blob = new Blob([JSON.stringify(tpl, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${templateName}.futuraria.json`;
      a.click(); URL.revokeObjectURL(url);
    }
  }, [templateId, templateName]);

  const handleZoomToFit = useCallback(() => {
    const containerEl = document.getElementById("canvas-container");
    if (containerEl) {
      const cw = containerEl.clientWidth - 32;
      const ch = containerEl.clientHeight - 32;
      const fitScale = Math.min(cw / width, ch / height, 1);
      setZoom(Math.round(fitScale * 10) / 10);
    }
  }, [width, height]);

  // ── Styles ──
  const containerStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    width: "100vw",
    background: "#0d0d1a",
    color: "#e0e0e0",
    fontFamily: "'Inter', system-ui, sans-serif",
    overflow: "hidden",
  };

  const topBarStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "8px 16px",
    background: "rgba(18,18,36,0.9)",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    flexShrink: 0,
  };

  const btnStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.06)",
    color: "#e0e0e0",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 6,
    padding: "6px 12px",
    cursor: "pointer",
    fontSize: 13,
    fontFamily: "inherit",
    display: "flex",
    alignItems: "center",
    gap: 4,
  };

  const mainStyle: React.CSSProperties = {
    display: "flex",
    flex: 1,
    overflow: "hidden",
  };

  const codePanelStyle: React.CSSProperties = {
    width: 420,
    flexShrink: 0,
    height: "100%",
    padding: 8,
  };

  const canvasContainerStyle: React.CSSProperties = {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    overflow: "auto",
  };

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
        <span style={{ fontSize: 11, color: "#888", marginLeft: 8 }}>{width}x{height}</span>
        {saving && <span style={{ fontSize: 11, color: "#60a5fa", marginLeft: "auto" }}>Saving...</span>}
        {activeAgents.length > 0 && (
          <span style={{ fontSize: 11, color: "#4ade80", marginLeft: 8, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", display: "inline-block" }} />
            {activeAgents.length} active
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => setShowRightPanel(!showRightPanel)} style={{ ...btnStyle, background: showRightPanel ? "#3B82F6" : "rgba(255,255,255,0.06)" }}>Props</button>
        <button type="button" onClick={() => setShowFontPicker(!showFontPicker)} style={{ ...btnStyle, background: showFontPicker ? "#3B82F6" : "rgba(255,255,255,0.06)" }}>Fonts</button>
        <button type="button" onClick={handleExportPNG} style={btnStyle}>PNG</button>
        <button type="button" onClick={handleExportJSON} style={btnStyle}>JSON</button>
        <button type="button" onClick={handleZoomToFit} style={btnStyle} title="Fit to screen">Fit</button>
        <button type="button" onClick={() => setZoom(z => Math.min(2, z + 0.1))} style={btnStyle}>+</button>
        <span style={{ fontSize: 11, color: "#888", minWidth: 36, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom(z => Math.max(0.1, z - 0.1))} style={btnStyle}>-</button>
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

      {/* Insert Toolbar */}
      <InsertToolbar templateId={templateId} onHtmlUpdated={(h, c) => { setHtml(h); setCss(c); }} />

      {/* Main: Code Panel + Canvas + Properties */}
      <div style={mainStyle}>
        <div style={codePanelStyle}>
          <CodePanel
            ref={codePanelRef}
            html={html}
            css={css}
            onHtmlChange={handleHtmlChange}
            onCssChange={handleCssChange}
          />
        </div>
        <div id="canvas-container" style={canvasContainerStyle}>
          <HtmlCanvas
            html={html}
            css={css}
            width={width}
            height={height}
            zoom={zoom}
            onSelectElement={handleSelectElement}
          />
        </div>
        {showRightPanel && (
          <div style={{ width: 240, flexShrink: 0, height: "100%", padding: 8, overflow: "auto" }}>
            <ElementProperties
              element={selectedElement}
              templateId={templateId}
              onElementUpdated={(h, c) => { setHtml(h); setCss(c); }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
