import React, { useState, useCallback, useEffect, useRef } from "react";
import { HtmlCanvas } from "../components/HtmlCanvas";
import { CodePanel } from "../components/CodePanel";
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

  const handleHtmlChange = useCallback((newHtml: string) => {
    setHtml(newHtml);
    autoSave(newHtml, css);
  }, [css, autoSave]);

  const handleCssChange = useCallback((newCss: string) => {
    setCss(newCss);
    autoSave(html, newCss);
  }, [html, autoSave]);

  const handleSelectElement = useCallback((layerId: string) => {
    console.log("[EditorV2] Selected element:", layerId);
    // Future: scroll to matching code in Monaco
  }, []);

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
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => setZoom(z => Math.min(2, z + 0.1))} style={btnStyle}>Zoom +</button>
        <span style={{ fontSize: 11, color: "#888" }}>{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom(z => Math.max(0.1, z - 0.1))} style={btnStyle}>Zoom -</button>
      </div>

      {/* Main: Code Panel + Canvas */}
      <div style={mainStyle}>
        <div style={codePanelStyle}>
          <CodePanel
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
