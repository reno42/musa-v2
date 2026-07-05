import React, { useCallback } from "react";
import { apiFetch } from "../lib/supabase";

interface Props {
  templateId: string;
  onHtmlUpdated: (html: string, css: string) => void;
  onSvgImport?: () => void;
}

const barStyle: React.CSSProperties = {
  display: "flex", gap: 4, padding: "4px 8px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  flexWrap: "wrap", flexShrink: 0,
};

const btnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  color: "#ccc",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 4,
  padding: "3px 8px",
  fontSize: 11,
  cursor: "pointer",
  fontFamily: "inherit",
};

const sectionStyle: React.CSSProperties = {
  display: "flex", gap: 2, alignItems: "center",
  borderRight: "1px solid rgba(255,255,255,0.06)",
  paddingRight: 6, marginRight: 2,
};

export function InsertToolbar({ templateId, onHtmlUpdated, onSvgImport }: Props) {
  const addElement = useCallback(async (tag: string, html: string, css: string) => {
    try {
      const res = await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0", method: "add_element",
          params: { templateId, tag, html, css, position: "append" },
          id: 0,
        }),
      });
      if (res.result) {
        const tpl = await apiFetch<any>(`/api/templates/${templateId}`);
        if (tpl.data) onHtmlUpdated(tpl.data.html || "", tpl.data.css || "");
      }
    } catch { /* ignore */ }
  }, [templateId, onHtmlUpdated]);

  const addStyle = useCallback(async (cssSnippet: string) => {
    try {
      await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0", method: "add_element",
          params: { templateId, tag: "div", html: "", css: cssSnippet, position: "append" },
          id: 0,
        }),
      });
      const tpl = await apiFetch<any>(`/api/templates/${templateId}`);
      if (tpl.data) onHtmlUpdated(tpl.data.html || "", tpl.data.css || "");
    } catch { /* ignore */ }
  }, [templateId, onHtmlUpdated]);

  return (
    <div style={barStyle}>
      {/* SVG Import */}
      {onSvgImport && (
        <div style={sectionStyle}>
          <button type="button" onClick={onSvgImport} style={{ ...btnStyle, background: "#8B5CF6", color: "#fff" }} title="Import SVG file or paste code">
            + SVG
          </button>
        </div>
      )}

      {/* Elements */}
      <div style={sectionStyle}>
        <button type="button" onClick={() => addElement("div", "", "")} style={btnStyle} title="Add Div">+ Div</button>
        <button type="button" onClick={() => addElement("h1", "Heading", "font-size: 32px; font-weight: 700;")} style={btnStyle} title="Add H1">+ H1</button>
        <button type="button" onClick={() => addElement("h2", "Subheading", "font-size: 24px; font-weight: 600;")} style={btnStyle} title="Add H2">+ H2</button>
        <button type="button" onClick={() => addElement("p", "Paragraph text", "font-size: 16px; line-height: 1.5;")} style={btnStyle} title="Add Paragraph">+ P</button>
        <button type="button" onClick={() => addElement("button", "Button", "padding: 12px 24px; background: #3B82F6; color: #fff; border: none; border-radius: 8px; cursor: pointer;")} style={btnStyle} title="Add Button">+ Btn</button>
        <button type="button" onClick={() => addElement("img", "", "")} style={btnStyle} title="Add Image">+ Img</button>
        <button type="button" onClick={() => addElement("span", "text", "")} style={btnStyle} title="Add Span">+ Span</button>
      </div>

      {/* Shapes */}
      <div style={sectionStyle}>
        <button type="button" onClick={() => addElement("div", "", "width: 200px; height: 200px; background: #3B82F6;")} style={{ ...btnStyle, background: "#3B82F6", color: "#fff" }}>Rect</button>
        <button type="button" onClick={() => addElement("div", "", "width: 200px; height: 200px; background: #EF4444; border-radius: 50%;")} style={{ ...btnStyle, background: "#EF4444", color: "#fff" }}>Circle</button>
      </div>

      {/* Layout */}
      <div style={sectionStyle}>
        <button type="button" onClick={() => addStyle("display: flex; flex-direction: row; gap: 16px;")} style={btnStyle}>Flex Row</button>
        <button type="button" onClick={() => addStyle("display: flex; flex-direction: column; gap: 16px;")} style={btnStyle}>Flex Col</button>
        <button type="button" onClick={() => addStyle("display: grid; grid-template-columns: 1fr 1fr; gap: 16px;")} style={btnStyle}>Grid 2</button>
      </div>

      {/* Align */}
      <div style={sectionStyle}>
        <button type="button" onClick={() => addStyle("text-align: left;")} style={btnStyle}>Left</button>
        <button type="button" onClick={() => addStyle("text-align: center;")} style={btnStyle}>Center</button>
        <button type="button" onClick={() => addStyle("text-align: right;")} style={btnStyle}>Right</button>
      </div>
    </div>
  );
}
