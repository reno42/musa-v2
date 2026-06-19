import React, { useState, useCallback } from "react";
import { apiFetch } from "../lib/supabase";

interface CssVar {
  name: string;
  value: string;
  scope: string;
}

interface Props {
  templateId: string;
  onCssUpdated: (css: string) => void;
}

const panelStyle: React.CSSProperties = {
  background: "rgba(18,18,36,0.85)", borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.06)", padding: 12,
  color: "#e0e0e0", fontSize: 12, overflow: "auto",
};

const inputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 4, color: "#e0e0e0", padding: "3px 6px", fontSize: 11,
  width: "100%", outline: "none", fontFamily: "monospace",
};

export function VariablesPanel({ templateId, onCssUpdated }: Props) {
  const [vars, setVars] = useState<CssVar[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const loadVars = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0", method: "get_css_variables", params: { templateId }, id: 0,
        }),
      });
      const text = res?.result?.content?.[0]?.text;
      if (text) {
        const data = typeof text === "string" ? JSON.parse(text) : text;
        setVars(data.variables || []);
        setLoaded(true);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [templateId]);

  const saveVar = useCallback(async (name: string, value: string) => {
    try {
      await apiFetch<any>("/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0", method: "set_css_variable",
          params: { templateId, name, value }, id: 0,
        }),
      });
      const tpl = await apiFetch<any>(`/api/templates/${templateId}`);
      if (tpl.data) onCssUpdated(tpl.data.css || "");
      setVars(prev => prev.map(v => v.name === name ? { ...v, value } : v));
    } catch { /* ignore */ }
  }, [templateId, onCssUpdated]);

  if (!loaded) {
    return (
      <div style={panelStyle}>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>CSS Variables</div>
        <button type="button" onClick={loadVars} disabled={loading}
          style={{ background: "#3B82F6", color: "#fff", border: "none", borderRadius: 4, padding: "6px 12px", cursor: "pointer", fontSize: 11, width: "100%" }}>
          {loading ? "Loading..." : "Load Variables"}
        </button>
      </div>
    );
  }

  if (vars.length === 0) {
    return (
      <div style={panelStyle}>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>CSS Variables</div>
        <div style={{ color: "#666", fontSize: 11 }}>No CSS variables found in :root</div>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>
        CSS Variables ({vars.length})
      </div>
      {vars.map((v, i) => (
        <div key={i} style={{ marginBottom: 6, borderBottom: "1px solid rgba(255,255,255,0.04)", paddingBottom: 4 }}>
          <div style={{ fontFamily: "monospace", fontSize: 11, color: "#60a5fa", marginBottom: 2 }}>{v.name}</div>
          {editing === v.name ? (
            <div style={{ display: "flex", gap: 4 }}>
              <input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { saveVar(v.name, editValue); setEditing(null); } if (e.key === "Escape") setEditing(null); }}
                style={{ ...inputStyle, flex: 1 }} />
              <button onClick={() => { saveVar(v.name, editValue); setEditing(null); }}
                style={{ ...inputStyle, width: 40, background: "#22c55e", color: "#fff", cursor: "pointer" }}>OK</button>
            </div>
          ) : (
            <div onClick={() => { setEditing(v.name); setEditValue(v.value); }}
              style={{ fontFamily: "monospace", fontSize: 11, color: "#ccc", cursor: "pointer", padding: "2px 4px", borderRadius: 3 }}
              title="Click to edit">{v.value}</div>
          )}
        </div>
      ))}
    </div>
  );
}
