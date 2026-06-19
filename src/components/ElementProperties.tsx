import React, { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../lib/supabase";

interface SelectedElement {
  elementId: string;
  tag: string;
  classes: string[];
  cssProperties: string[];
  htmlSnippet: string;
}

interface Props {
  element: SelectedElement | null;
  templateId: string;
  onElementUpdated: (html: string, css: string) => void;
}

const panelStyle: React.CSSProperties = {
  background: "rgba(18,18,36,0.85)",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.06)",
  padding: 12,
  color: "#e0e0e0",
  fontSize: 12,
  overflow: "auto",
};

const inputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 4,
  color: "#e0e0e0",
  padding: "4px 8px",
  fontSize: 11,
  width: "100%",
  outline: "none",
  marginBottom: 4,
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: "#888",
  marginBottom: 2,
  textTransform: "uppercase" as const,
  letterSpacing: 0.5,
};

function parseCssProp(props: string[], key: string): string {
  const prop = props.find(p => p.trim().startsWith(key));
  return prop ? prop.split(":")[1]?.trim() || "" : "";
}

export function ElementProperties({ element, templateId, onElementUpdated }: Props) {
  const [cssUpdate, setCssUpdate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!element) return;
    setCssUpdate("");
  }, [element]);

  const handleUpdateCss = useCallback(async () => {
    if (!element || !cssUpdate.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0", method: "update_element",
          params: { templateId, elementId: element.elementId, css: cssUpdate },
          id: 0,
        }),
      });
      if (res.result) {
        // Refresh template to get updated html/css
        const tpl = await apiFetch<any>(`/api/templates/${templateId}`);
        if (tpl.data) {
          onElementUpdated(tpl.data.html || "", tpl.data.css || "");
        }
      }
    } catch { /* ignore */ }
    setSaving(false);
  }, [element, cssUpdate, templateId, onElementUpdated]);

  const handleQuickProp = useCallback(async (prop: string, value: string) => {
    if (!element) return;
    setSaving(true);
    try {
      await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0", method: "update_element",
          params: { templateId, elementId: element.elementId, css: `${prop}: ${value};` },
          id: 0,
        }),
      });
      const tpl = await apiFetch<any>(`/api/templates/${templateId}`);
      if (tpl.data) onElementUpdated(tpl.data.html || "", tpl.data.css || "");
    } catch { /* ignore */ }
    setSaving(false);
  }, [element, templateId, onElementUpdated]);

  if (!element) {
    return (
      <div style={panelStyle}>
        <div style={{ color: "#888", textAlign: "center", padding: 20 }}>
          Click an element in the preview to edit its properties
        </div>
      </div>
    );
  }

  const color = parseCssProp(element.cssProperties, "color");
  const bg = parseCssProp(element.cssProperties, "background");
  const fontSize = parseCssProp(element.cssProperties, "font-size");
  const padding = parseCssProp(element.cssProperties, "padding");
  const borderRadius = parseCssProp(element.cssProperties, "border-radius");
  const textAlign = parseCssProp(element.cssProperties, "text-align");

  return (
    <div style={panelStyle}>
      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>
        {element.tag}
        {element.classes.length > 0 && <span style={{ color: "#60a5fa", marginLeft: 6 }}>.{element.classes[0]}</span>}
      </div>
      <div style={{ color: "#888", fontSize: 10, marginBottom: 8 }}>{element.elementId}</div>

      {/* Quick property buttons */}
      <div style={labelStyle}>Quick Properties</div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
        <button type="button" onClick={() => handleQuickProp("color", "#ffffff")} style={{ ...inputStyle, width: "auto", padding: "3px 8px", cursor: "pointer", marginBottom: 0 }}>Color</button>
        <button type="button" onClick={() => handleQuickProp("background-color", "#3B82F6")} style={{ ...inputStyle, width: "auto", padding: "3px 8px", cursor: "pointer", marginBottom: 0 }}>Bg</button>
        <button type="button" onClick={() => handleQuickProp("font-size", "24px")} style={{ ...inputStyle, width: "auto", padding: "3px 8px", cursor: "pointer", marginBottom: 0 }}>Font</button>
        <button type="button" onClick={() => handleQuickProp("text-align", "center")} style={{ ...inputStyle, width: "auto", padding: "3px 8px", cursor: "pointer", marginBottom: 0 }}>Center</button>
        <button type="button" onClick={() => handleQuickProp("border-radius", "12px")} style={{ ...inputStyle, width: "auto", padding: "3px 8px", cursor: "pointer", marginBottom: 0 }}>Radius</button>
        <button type="button" onClick={() => handleQuickProp("padding", "16px")} style={{ ...inputStyle, width: "auto", padding: "3px 8px", cursor: "pointer", marginBottom: 0 }}>Pad</button>
      </div>

      {/* Current properties */}
      <div style={labelStyle}>Current Properties</div>
      <div style={{ fontSize: 11, color: "#aaa", lineHeight: 1.6, marginBottom: 8 }}>
        {element.cssProperties.length > 0
          ? element.cssProperties.map((p, i) => <div key={i} style={{ fontFamily: "monospace" }}>{p.trim()}</div>)
          : <div style={{ color: "#666" }}>No CSS properties found</div>}
      </div>

      {/* Custom CSS input */}
      <div style={labelStyle}>Set CSS Properties</div>
      <textarea
        placeholder="color: red; font-size: 24px;"
        value={cssUpdate}
        onChange={e => setCssUpdate(e.target.value)}
        style={{ ...inputStyle, height: 60, resize: "vertical", fontFamily: "monospace" }}
      />
      <button
        type="button"
        onClick={handleUpdateCss}
        disabled={!cssUpdate.trim() || saving}
        style={{
          ...inputStyle,
          background: "#3B82F6", color: "#fff",
          cursor: cssUpdate.trim() ? "pointer" : "default",
          marginTop: 4, marginBottom: 0, opacity: cssUpdate.trim() ? 1 : 0.5,
        }}
      >
        {saving ? "Applying..." : "Apply CSS"}
      </button>
    </div>
  );
}
