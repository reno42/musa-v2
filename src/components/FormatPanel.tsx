import React, { useState, useCallback } from "react";
import { apiFetch } from "../lib/supabase";

interface Props {
  templateId: string;
  width: number;
  height: number;
  onTemplateCreated: (newTemplateId: string) => void;
}

const FORMATS = [
  { name: "Square", width: 1080, height: 1080 },
  { name: "Story", width: 1080, height: 1920 },
  { name: "Banner", width: 1920, height: 1080 },
  { name: "Feed", width: 1080, height: 1350 },
  { name: "Wide", width: 1200, height: 628 },
];

const panelStyle: React.CSSProperties = {
  background: "rgba(18,18,36,0.85)", borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.06)", padding: 12,
  color: "#e0e0e0", fontSize: 12, overflow: "auto",
};

const btnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)", color: "#ccc",
  border: "1px solid rgba(255,255,255,0.08)", borderRadius: 4,
  padding: "5px 8px", fontSize: 11, cursor: "pointer",
  fontFamily: "inherit", width: "100%", textAlign: "left" as const,
  display: "flex", justifyContent: "space-between",
};

export function FormatPanel({ templateId, width, height, onTemplateCreated }: Props) {
  const [adapting, setAdapting] = useState<string | null>(null);
  const [results, setResults] = useState<{ format: string; templateId: string }[]>([]);

  const adapt = useCallback(async (fmt: typeof FORMATS[0]) => {
    setAdapting(fmt.name);
    try {
      const res = await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0", method: "adapt_format",
          params: { templateId, targetFormat: { width: fmt.width, height: fmt.height, name: fmt.name } },
          id: 0,
        }),
      });
      const text = res?.result?.content?.[0]?.text;
      if (text) {
        const data = typeof text === "string" ? JSON.parse(text) : text;
        if (data.newTemplateId) {
          setResults(prev => [...prev, { format: fmt.name, templateId: data.newTemplateId }]);
          onTemplateCreated(data.newTemplateId);
        }
      }
    } catch { /* ignore */ }
    setAdapting(null);
  }, [templateId, onTemplateCreated]);

  return (
    <div style={panelStyle}>
      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>Format Adaptation</div>
      <div style={{ fontSize: 10, color: "#888", marginBottom: 8 }}>
        Current: {width}x{height}
      </div>
      {FORMATS.map(fmt => (
        <button key={fmt.name} onClick={() => adapt(fmt)} disabled={adapting !== null}
          style={{
            ...btnStyle,
            marginBottom: 4,
            opacity: adapting === fmt.name ? 0.5 : 1,
            background: fmt.width === width && fmt.height === height ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.06)",
          }}>
          <span>{fmt.name}</span>
          <span style={{ color: "#888", fontSize: 10 }}>{fmt.width}x{fmt.height}</span>
        </button>
      ))}
      {results.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, color: "#4ade80", marginBottom: 4 }}>Adapted:</div>
          {results.map((r, i) => (
            <div key={i} style={{ fontSize: 10, color: "#60a5fa", cursor: "pointer" }}
              onClick={() => window.open(`/?template=${r.templateId}&v=2`, "_blank")}>
              {r.format} → Open
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
