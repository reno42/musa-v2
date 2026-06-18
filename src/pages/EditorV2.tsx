import React, { useState, useCallback, useEffect, useRef } from "react";
import { HtmlCanvas } from "../components/HtmlCanvas";
import { CodePanel } from "../components/CodePanel";
import type { CodePanelRef } from "../components/CodePanel";
import { GoogleFontPicker } from "../components/GoogleFontPicker";
import { getTemplate } from "../lib/templateApi";
import { apiFetch } from "../lib/supabase";
import { IconArrowLeft } from "../shared/icons";

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

  // Supabase Realtime polling: periodically check for external template changes
  // (Full WebSocket-based Supabase Realtime requires project config; polling works immediately)
  useEffect(() => {
    pollingRef.current = setInterval(async () => {
      try {
        const tpl = await getTemplate(templateId);
        if (!tpl) return;
        const t = tpl as any;
        const remoteUpdated = t.metadata?.updatedAt;
        if (remoteUpdated && remoteUpdated !== lastRemoteUpdate) {
          // Only update if the change came from outside (not our own saves)
          if (lastRemoteUpdate !== null) {
            setHtml(t.html || DEFAULT_HTML);
            setCss(t.css || DEFAULT_CSS);
            setTemplateName(t.name || "Untitled");
          }
          setLastRemoteUpdate(remoteUpdated);
        }
      } catch { /* silent - offline or API not available */ }
    }, 5000); // poll every 5 seconds
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [templateId, lastRemoteUpdate]);

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
      // Use the first class name as a CSS selector to search for
      selector = classMatch[1].split(/\s+/)[0];
    } else if (idMatch) {
      selector = `#${idMatch[1]}`;
    } else if (tagMatch) {
      selector = tagMatch[1];
    }

    if (selector) {
      // Find the line number in CSS where this selector is defined
      const cssLines = css.split("\n");
      let lineNumber = -1;
      for (let i = 0; i < cssLines.length; i++) {
        const line = cssLines[i].trim();
        // Match CSS selectors: .classname, #id, or tag { ... }
        if (line.startsWith(`.${selector}`) || line === selector || line.startsWith(`${selector} `) || line.startsWith(`${selector},`) || line.startsWith(`${selector}:`) || line.startsWith(`#${selector.replace("#", "")}`)) {
          lineNumber = i + 1;
          break;
        }
        // Also match when selector appears before {
        if (line.includes(`.${selector}`) && line.includes("{")) {
          lineNumber = i + 1;
          break;
        }
      }

      if (lineNumber > 0 && codePanelRef.current) {
        codePanelRef.current.scrollToLine(lineNumber);
      }
    }
  }, [html, css]);

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
        <button type="button" onClick={() => setShowFontPicker(!showFontPicker)} style={{ ...btnStyle, background: showFontPicker ? "#3B82F6" : "rgba(255,255,255,0.06)" }}>Fonts</button>
        <button type="button" onClick={() => setZoom(z => Math.min(2, z + 0.1))} style={btnStyle}>Zoom +</button>
        <span style={{ fontSize: 11, color: "#888" }}>{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom(z => Math.max(0.1, z - 0.1))} style={btnStyle}>Zoom -</button>
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

      {/* Main: Code Panel + Canvas */}
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
        <div style={canvasContainerStyle}>
          <HtmlCanvas
            html={html}
            css={css}
            width={width}
            height={height}
            zoom={zoom}
            onSelectElement={handleSelectElement}
          />
        </div>
      </div>
    </div>
  );
}
