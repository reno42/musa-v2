import React, { useState, useCallback } from "react";
import { apiFetch } from "../lib/supabase";

interface Element {
  tag: string;
  id: string;
  classes: string[];
  cssSelector: string;
}

interface Props {
  templateId: string;
  onSelectElement: (elementId: string) => void;
}

const panelStyle: React.CSSProperties = {
  background: "rgba(18,18,36,0.85)", borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.06)", padding: 12,
  color: "#e0e0e0", fontSize: 12, overflow: "auto",
};

const roleColors: Record<string, string> = {
  h1: "#4ade80", h2: "#4ade80", h3: "#a3e635",
  button: "#f97316", a: "#f97316",
  img: "#60a5fa", div: "#888", p: "#a3a3a3",
  section: "#c084fc", header: "#c084fc", footer: "#c084fc",
};

export function StructurePanel({ templateId, onSelectElement }: Props) {
  const [elements, setElements] = useState<Element[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const loadStructure = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0", method: "get_template_structure",
          params: { templateId }, id: 0,
        }),
      });
      const text = res?.result?.content?.[0]?.text;
      if (text) {
        const data = typeof text === "string" ? JSON.parse(text) : text;
        setElements(data.elements || []);
        setLoaded(true);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [templateId]);

  if (!loaded) {
    return (
      <div style={panelStyle}>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>Structure</div>
        <button type="button" onClick={loadStructure} disabled={loading}
          style={{ background: "#3B82F6", color: "#fff", border: "none", borderRadius: 4, padding: "6px 12px", cursor: "pointer", fontSize: 11, width: "100%" }}>
          {loading ? "Loading..." : "Analyze Structure"}
        </button>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>
        Structure ({elements.length} elements)
      </div>
      {elements.map((el, i) => (
        <div key={i}
          onClick={() => onSelectElement(el.id)}
          style={{
            display: "flex", alignItems: "center", gap: 6, padding: "3px 4px",
            cursor: "pointer", borderRadius: 4, marginBottom: 1,
            background: "transparent",
          }}
          onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
        >
          <span style={{ color: roleColors[el.tag] || "#888", fontWeight: 600, fontSize: 11, minWidth: 24 }}>
            {el.tag}
          </span>
          <span style={{ color: "#60a5fa", fontSize: 10, fontFamily: "monospace" }}>
            {el.cssSelector}
          </span>
          {el.classes.length > 0 && (
            <span style={{ fontSize: 10, color: "#666" }}>.{el.classes.join(".")}</span>
          )}
        </div>
      ))}
    </div>
  );
}
