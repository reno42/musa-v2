import { useState, useEffect, useCallback } from "react";
import type { FabricObject, Canvas } from "fabric";
import { mcpCall } from "../lib/mcpClient";
import { getTemplate } from "../lib/templateApi";

interface StyleItem {
  id: string;
  name: string;
  type: string;
  properties: Record<string, any>;
}

interface StylesTabProps {
  templateId: string | null;
  selectedObjects: FabricObject[];
  canvasRef?: React.RefObject<Canvas | null>;
  onUpdate?: () => void;
}

export function StylesTab({ templateId, selectedObjects, canvasRef, onUpdate }: StylesTabProps) {
  const [styles, setStyles] = useState<StyleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const loadStyles = useCallback(async () => {
    if (!templateId) return;
    setLoading(true);
    setError(null);
    try {
      const tpl = await getTemplate(templateId);
      setStyles(tpl?.styles || []);
    } catch {
      setError("Failed to load styles");
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => { loadStyles(); }, [loadStyles]);

  const handleCreate = async () => {
    const sel = selectedObjects[0];
    if (!sel || !templateId || !newName.trim()) return;
    const layerName = (sel as any).layerName || (sel as any).name || "";
    const type = sel.type || "rect";
    try {
      await mcpCall("create_style", { templateId, name: newName.trim(), type, sourceLayerName: layerName });
      setNewName("");
      setCreating(false);
      await loadStyles();
    } catch (e: any) {
      setError(e.message || "Failed to create style");
    }
  };

  const handleApply = async (styleId: string) => {
    if (!templateId || selectedObjects.length === 0) return;
    const names = selectedObjects.map(o => (o as any).layerName || (o as any).name).filter(Boolean);
    if (names.length === 0) return;
    try {
      await mcpCall("apply_style", { templateId, styleId, targetLayerNames: names });
      onUpdate?.();
    } catch (e: any) {
      setError(e.message || "Failed to apply style");
    }
  };

  const handleDelete = async (styleId: string) => {
    if (!templateId) return;
    // Remove from local state (optimistic) — MCP currently has no delete_style
    setStyles(prev => prev.filter(s => s.id !== styleId));
  };

  if (!templateId) return <div style={emptyStyle}>Open a template to manage styles</div>;
  if (loading) return <div style={emptyStyle}>Loading styles...</div>;
  if (error) return <div style={{ ...emptyStyle, color: "#e44" }}>{error}</div>;

  return (
    <div style={{ padding: "8px 0", overflowY: "auto", height: "100%" }}>
      {/* Create style */}
      <div style={{ padding: "0 10px 8px", borderBottom: "1px solid #1c1c26" }}>
        {creating ? (
          <div style={{ display: "flex", gap: 4 }}>
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setCreating(false); }}
              placeholder="Style name..."
              style={inputStyle}
            />
            <button type="button" onClick={handleCreate} disabled={!newName.trim()}
              style={{ ...btnSm, background: "#1a2a1a", border: "1px solid #2a4a2a", color: "#4ade80" }}>Save</button>
            <button type="button" onClick={() => setCreating(false)}
              style={{ ...btnSm, background: "#111118", border: "1px solid #1c1c26", color: "#7a7a90" }}>✕</button>
          </div>
        ) : (
          <button type="button" onClick={() => { setCreating(true); setNewName(""); }}
            disabled={selectedObjects.length !== 1}
            style={{
              width: "100%", padding: "4px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer",
              background: selectedObjects.length === 1 ? "#1a2a3a" : "#111118",
              border: selectedObjects.length === 1 ? "1px solid #2a3a5a" : "1px solid #1c1c26",
              color: selectedObjects.length === 1 ? "#60a5fa" : "#5a5a70",
            }}>
            + Create Style from Selection
          </button>
        )}
      </div>

      {/* Style list */}
      {styles.length === 0 && !loading && (
        <div style={emptyStyle}>No styles yet. Select an object and create one.</div>
      )}
      {styles.map(s => (
        <div key={s.id} style={{
          margin: "4px 8px", padding: "6px 8px", borderRadius: 4,
          background: "#111118", border: "1px solid #1c1c26",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#e4e4f0" }}>{s.name}</span>
            <span style={{ fontSize: 10, color: "#5a5a70" }}>{s.type}</span>
          </div>
          {/* Property preview */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
            {s.properties?.fill && typeof s.properties.fill === "string" && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, color: "#7a7a90" }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: s.properties.fill, border: "1px solid #2a2a3a" }} /> Fill
              </span>
            )}
            {s.properties?.fontSize && (
              <span style={{ fontSize: 10, color: "#7a7a90" }}>{s.properties.fontSize}px</span>
            )}
            {s.properties?.fontFamily && (
              <span style={{ fontSize: 10, color: "#7a7a90" }}>{s.properties.fontFamily}</span>
            )}
          </div>
          {/* Actions */}
          <div style={{ display: "flex", gap: 4 }}>
            <button type="button" onClick={() => handleApply(s.id)}
              disabled={selectedObjects.length === 0}
              style={{
                flex: 1, padding: "2px 6px", borderRadius: 3, fontSize: 10, cursor: "pointer",
                background: selectedObjects.length > 0 ? "#1a2a1a" : "#111118",
                border: selectedObjects.length > 0 ? "1px solid #2a4a2a" : "1px solid #1c1c26",
                color: selectedObjects.length > 0 ? "#4ade80" : "#5a5a70",
              }}>
              Apply
            </button>
            <button type="button" onClick={() => handleDelete(s.id)}
              style={{
                padding: "2px 6px", borderRadius: 3, fontSize: 10, cursor: "pointer",
                background: "#1a1111", border: "1px solid #2a1a1a", color: "#7a5a5a",
              }}>
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

const emptyStyle: React.CSSProperties = {
  padding: 20, color: "#666", fontSize: 12, textAlign: "center",
};

const inputStyle: React.CSSProperties = {
  flex: 1, background: "#111118", border: "1px solid #1c1c26",
  color: "#e4e4f0", borderRadius: 4, padding: "3px 6px", fontSize: 12,
  fontFamily: "monospace",
};

const btnSm: React.CSSProperties = {
  padding: "3px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer",
};
