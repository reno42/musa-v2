import { useState, useEffect, useCallback } from "react";
import type { FabricObject } from "fabric";
import { mcpCall } from "../lib/mcpClient";
import { getTemplate } from "../lib/templateApi";

interface ComponentDef {
  id: string;
  name: string;
  description?: string;
  objectIds: string[];
  objects: any[];
  variants: VariantDef[];
  properties: any[];
  created: string;
}

interface VariantDef {
  id: string;
  name: string;
  overrides: Record<string, any>;
  created?: string;
}

interface ComponentsPanelProps {
  templateId: string | null;
  selectedObjects: FabricObject[];
  onUpdate?: () => void;
  onClose: () => void;
}

export function ComponentsPanel({ templateId, selectedObjects, onUpdate, onClose }: ComponentsPanelProps) {
  const [components, setComponents] = useState<ComponentDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newCompName, setNewCompName] = useState("");
  const [expandedComp, setExpandedComp] = useState<string | null>(null);
  const [showVariant, setShowVariant] = useState<string | null>(null);
  const [varName, setVarName] = useState("");
  const [varOverrides, setVarOverrides] = useState("{}");

  const loadComponents = useCallback(async () => {
    if (!templateId) return;
    setLoading(true);
    setError(null);
    try {
      const tpl = await getTemplate(templateId);
      const comps = (tpl as any)?.metadata?.components || [];
      setComponents(comps);
    } catch {
      setError("Failed to load components");
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => { loadComponents(); }, [loadComponents]);

  const handleCreate = async () => {
    if (!templateId || selectedObjects.length === 0 || !newCompName.trim()) return;
    const ids = selectedObjects.map(o => (o as any).layerName || (o as any).id || (o as any).name).filter(Boolean);
    if (ids.length === 0) return;
    try {
      await mcpCall("create_component", { templateId, name: newCompName.trim(), objectIds: ids });
      setNewCompName("");
      setShowCreate(false);
      await loadComponents();
    } catch (e: any) {
      setError(e.message || "Failed to create component");
    }
  };

  const handleCreateInstance = async (compId: string) => {
    if (!templateId) return;
    try {
      const result = await mcpCall("create_instance", {
        templateId,
        componentId: compId,
        x: Math.floor(Math.random() * 400 + 50),
        y: Math.floor(Math.random() * 300 + 50),
      });
      if (result?.created) onUpdate?.();
    } catch (e: any) {
      setError(e.message || "Failed to create instance");
    }
  };

  const handleAddVariant = async (compId: string) => {
    if (!templateId || !varName.trim()) return;
    let overrides: Record<string, any> = {};
    try { overrides = JSON.parse(varOverrides); } catch { setError("Invalid JSON for overrides"); return; }
    try {
      await mcpCall("add_variant", { templateId, componentId: compId, name: varName.trim(), overrides });
      setShowVariant(null);
      setVarName("");
      setVarOverrides("{}");
      await loadComponents();
    } catch (e: any) {
      setError(e.message || "Failed to add variant");
    }
  };

  const selCount = selectedObjects.length;

  return (
    <div className="glass-panel" style={{
      position: "fixed", top: 48, right: 0, bottom: 0, width: 300,
      display: "flex", flexDirection: "column", zIndex: 50,
      fontFamily: "Inter, sans-serif", fontSize: 12, color: "#c4c0b4",
    }}>
      {/* Header */}
      <div style={{
        padding: "10px 12px", borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>📦 Components</span>
        <button onClick={onClose} style={{
          background: "none", border: "none", color: "#7a7668", cursor: "pointer", fontSize: 16,
        }}>✕</button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {/* Create component */}
        <div style={{ padding: "0 10px 8px", borderBottom: "1px solid rgba(255, 255, 255, 0.04)", marginBottom: 4 }}>
          {showCreate ? (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <input
                autoFocus
                value={newCompName}
                onChange={e => setNewCompName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setShowCreate(false); }}
                placeholder="Component name..."
                style={inputStyle}
              />
              <button type="button" onClick={handleCreate} disabled={!newCompName.trim() || selCount === 0}
                style={{ ...btnSm, background: "#1a2a1a", border: "1px solid #2a4a2a", color: "#4ade80" }}>
                Save
              </button>
              <button type="button" onClick={() => setShowCreate(false)}
                style={{ ...btnSm, background: "rgba(15, 15, 15, 0.5)", border: "1px solid rgba(255, 255, 255, 0.04)", color: "#7a7668" }}>
                ✕
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => { setShowCreate(true); setNewCompName(""); }}
              disabled={selCount === 0}
              style={{
                width: "100%", padding: "5px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer",
                background: selCount > 0 ? "#1a2a3a" : "#111118",
                border: selCount > 0 ? "1px solid #2a3a5a" : "1px solid #1c1c26",
                color: selCount > 0 ? "#60a5fa" : "#7a7668",
              }}>
              + Create Component {selCount > 0 ? `(${selCount} selected)` : ""}
            </button>
          )}
        </div>

        {loading && <div style={emptyStyle}>Loading...</div>}
        {error && <div style={{ ...emptyStyle, color: "#e44" }}>{error}</div>}
        {!loading && !error && components.length === 0 && (
          <div style={emptyStyle}>No components yet. Select objects and create one.</div>
        )}

        {/* Component list */}
        {components.map(comp => {
          const isExpanded = expandedComp === comp.id;
          const variantCount = (comp.variants || []).length;
          return (
            <div key={comp.id} style={{
              margin: "4px 8px", borderRadius: 4,
              background: "rgba(15, 15, 15, 0.5)", border: "1px solid rgba(255, 255, 255, 0.04)",
            }}>
              {/* Main row */}
              <div
                onClick={() => setExpandedComp(isExpanded ? null : comp.id)}
                style={{
                  padding: "6px 8px", cursor: "pointer",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#f0ebe0" }}>
                    ◈ {comp.name}
                  </div>
                  <div style={{ fontSize: 10, color: "#7a7668", marginTop: 2 }}>
                    {comp.objectIds?.length || 0} objects
                    {variantCount > 0 && ` · ${variantCount} variants`}
                  </div>
                </div>
                <span style={{ fontSize: 10, color: "#7a7668", transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▶</span>
              </div>

              {/* Expanded: actions + variants */}
              {isExpanded && (
                <div style={{
                  borderTop: "1px solid #1c1c26",
                  padding: "6px 8px",
                  display: "flex", flexDirection: "column", gap: 4,
                }}>
                  {/* Action buttons */}
                  <div style={{ display: "flex", gap: 4 }}>
                    <button type="button" onClick={(e) => { e.stopPropagation(); handleCreateInstance(comp.id); }}
                      style={{
                        flex: 1, padding: "3px 6px", borderRadius: 3, fontSize: 10, cursor: "pointer",
                        background: "#1a2a1a", border: "1px solid #2a4a2a", color: "#4ade80",
                      }}>
                      + Instance
                    </button>
                    <button type="button" onClick={(e) => {
                      e.stopPropagation();
                      setShowVariant(showVariant === comp.id ? null : comp.id);
                      setVarName(""); setVarOverrides("{}");
                    }}
                      style={{
                        flex: 1, padding: "3px 6px", borderRadius: 3, fontSize: 10, cursor: "pointer",
                        background: "#1a1a2a", border: "1px solid #2a2a4a", color: "#c8b898",
                      }}>
                      + Variant
                    </button>
                  </div>

                  {/* Add variant form */}
                  {showVariant === comp.id && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 2 }}>
                      <input
                        autoFocus
                        value={varName}
                        onChange={e => setVarName(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") handleAddVariant(comp.id); if (e.key === "Escape") setShowVariant(null); }}
                        placeholder="Variant name (e.g. Hover)"
                        style={{ ...inputStyle, fontSize: 11, padding: "2px 6px" }}
                      />
                      <textarea
                        value={varOverrides}
                        onChange={e => setVarOverrides(e.target.value)}
                        placeholder='Overrides JSON: {"fill":"#45475a"}'
                        rows={2}
                        style={{ ...inputStyle, fontSize: 10, padding: "2px 6px", resize: "vertical", fontFamily: "monospace" }}
                      />
                      <button type="button" onClick={() => handleAddVariant(comp.id)}
                        disabled={!varName.trim()}
                        style={{
                          padding: "2px 6px", borderRadius: 3, fontSize: 10, cursor: "pointer",
                          background: varName.trim() ? "#1a2a1a" : "#111118",
                          border: varName.trim() ? "1px solid #2a4a2a" : "1px solid #1c1c26",
                          color: varName.trim() ? "#4ade80" : "#7a7668",
                        }}>
                        Save Variant
                      </button>
                    </div>
                  )}

                  {/* Variants list */}
                  {variantCount > 0 && (
                    <div style={{ marginTop: 2 }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: "#7a7668", marginBottom: 2 }}>
                        Variants:
                      </div>
                      {(comp.variants || []).map(v => (
                        <div key={v.id} style={{
                          padding: "2px 6px", marginBottom: 2, borderRadius: 3,
                          background: "#0a0a14", border: "1px solid #1a1a2a",
                          fontSize: 10,
                        }}>
                          <span style={{ color: "#c4c0b4" }}>{v.name}</span>
                          {v.overrides && Object.keys(v.overrides).length > 0 && (
                            <span style={{ color: "#7a7668", marginLeft: 6 }}>
                              {JSON.stringify(v.overrides).slice(0, 60)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const emptyStyle: React.CSSProperties = {
  padding: 20, color: "#666", fontSize: 12, textAlign: "center",
};

const inputStyle: React.CSSProperties = {
  flex: 1, background: "rgba(15, 15, 15, 0.5)", border: "1px solid rgba(255, 255, 255, 0.04)",
  color: "#f0ebe0", borderRadius: 4, padding: "3px 6px", fontSize: 12,
  fontFamily: "monospace", minWidth: 80,
};

const btnSm: React.CSSProperties = {
  padding: "3px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer",
};
