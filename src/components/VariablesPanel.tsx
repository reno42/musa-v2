import { useState, useEffect, useCallback } from "react";
import type { FabricObject } from "fabric";
import { mcpCall } from "../lib/mcpClient";
import { getTemplate } from "../lib/templateApi";

interface VariableItem {
  id: string;
  name: string;
  type: "color" | "number" | "string";
  value: any;
  collectionId?: string;
}

interface CollectionItem {
  id: string;
  name: string;
  modes: string[];
}

interface VariablesTabProps {
  templateId: string | null;
  selectedObjects: FabricObject[];
  onUpdate?: () => void;
}

export function VariablesTab({ templateId, selectedObjects, onUpdate }: VariablesTabProps) {
  const [variables, setVariables] = useState<VariableItem[]>([]);
  const [collections, setCollections] = useState<CollectionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState("Light");
  const [showCreateVar, setShowCreateVar] = useState(false);
  const [showCreateColl, setShowCreateColl] = useState(false);
  const [newVarName, setNewVarName] = useState("");
  const [newVarType, setNewVarType] = useState<"color" | "number" | "string">("color");
  const [newVarValue, setNewVarValue] = useState("#cba6f7");
  const [newVarCollId, setNewVarCollId] = useState("");
  const [newCollName, setNewCollName] = useState("");
  const [linkOpen, setLinkOpen] = useState<string | null>(null);

  const loadVariables = useCallback(async () => {
    if (!templateId) return;
    setLoading(true);
    setError(null);
    try {
      const tpl = await getTemplate(templateId);
      setVariables(tpl?.variables?.variables || []);
      setCollections(tpl?.variables?.collections || []);
    } catch {
      setError("Failed to load variables");
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => { loadVariables(); }, [loadVariables]);

  const handleCreateVar = async () => {
    if (!templateId || !newVarName.trim()) return;
    try {
      const params: any = { templateId, name: newVarName.trim(), type: newVarType, value: newVarValue };
      if (newVarCollId) params.collectionId = newVarCollId;
      await mcpCall("create_variable", params);
      setShowCreateVar(false);
      setNewVarName("");
      await loadVariables();
    } catch (e: any) {
      setError(e.message || "Failed to create variable");
    }
  };

  const handleCreateColl = async () => {
    if (!templateId || !newCollName.trim()) return;
    try {
      await mcpCall("create_collection", { templateId, name: newCollName.trim(), modes: ["Light", "Dark"] });
      setShowCreateColl(false);
      setNewCollName("");
      await loadVariables();
    } catch (e: any) {
      setError(e.message || "Failed to create collection");
    }
  };

  const handleLink = async (variableId: string, property: string) => {
    if (!templateId || selectedObjects.length === 0) return;
    const targetName = (selectedObjects[0] as any).layerName || (selectedObjects[0] as any).name;
    if (!targetName) return;
    try {
      await mcpCall("link_variable", { templateId, variableId, targetLayerName: targetName, property });
      setLinkOpen(null);
      onUpdate?.();
    } catch (e: any) {
      setError(e.message || "Failed to link variable");
    }
  };

  const varsByColl: Record<string, VariableItem[]> = {};
  for (const v of variables) {
    const cid = v.collectionId || "_ungrouped";
    if (!varsByColl[cid]) varsByColl[cid] = [];
    varsByColl[cid].push(v);
  }

  if (!templateId) return <div style={emptyStyle}>Open a template to manage variables</div>;
  if (loading) return <div style={emptyStyle}>Loading variables...</div>;
  if (error) return <div style={{ ...emptyStyle, color: "#e44" }}>{error}</div>;

  return (
    <div style={{ padding: "8px 0", overflowY: "auto", height: "100%" }}>
      {/* Mode selector */}
      <div style={{ padding: "0 10px 6px", display: "flex", gap: 4, borderBottom: "1px solid #1c1c26" }}>
        {["Light", "Dark"].map(mode => (
          <button key={mode} type="button" onClick={() => setActiveMode(mode)}
            style={{
              flex: 1, padding: "3px 6px", borderRadius: 4, fontSize: 11, cursor: "pointer",
              background: activeMode === mode ? "#1a2a3a" : "#111118",
              border: activeMode === mode ? "1px solid #3b82f6" : "1px solid #1c1c26",
              color: activeMode === mode ? "#60a5fa" : "#7a7a90",
            }}>
            {mode}
          </button>
        ))}
      </div>

      {/* Create buttons */}
      <div style={{ padding: "6px 10px", display: "flex", gap: 4, borderBottom: "1px solid #1c1c26" }}>
        <button type="button" onClick={() => { setShowCreateVar(!showCreateVar); setShowCreateColl(false); }}
          style={{ flex: 1, ...actionBtn("#60a5fa") }}>+ Variable</button>
        <button type="button" onClick={() => { setShowCreateColl(!showCreateColl); setShowCreateVar(false); }}
          style={{ flex: 1, ...actionBtn("#4ade80") }}>+ Collection</button>
      </div>

      {/* Create Variable form */}
      {showCreateVar && (
        <div style={{ padding: "6px 10px", borderBottom: "1px solid #1c1c26", background: "#111118" }}>
          <input value={newVarName} onChange={e => setNewVarName(e.target.value)} placeholder="Name" style={inputSm} />
          <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
            <select value={newVarType} onChange={e => setNewVarType(e.target.value as any)} style={selectSm}>
              <option value="color">Color</option>
              <option value="number">Number</option>
              <option value="string">String</option>
            </select>
            {newVarType === "color" ? (
              <input type="color" value={newVarValue} onChange={e => setNewVarValue(e.target.value)} style={{ width: 28, height: 26, border: "1px solid #1c1c26", borderRadius: 4, cursor: "pointer", background: "none", padding: 0 }} />
            ) : (
              <input value={newVarValue} onChange={e => setNewVarValue(e.target.value)} placeholder="Value" style={inputSm} />
            )}
            <button type="button" onClick={handleCreateVar} style={{ ...actionBtn("#60a5fa"), padding: "2px 6px", flex: 0 }}>Save</button>
          </div>
        </div>
      )}

      {/* Create Collection form */}
      {showCreateColl && (
        <div style={{ padding: "6px 10px", borderBottom: "1px solid #1c1c26", background: "#111118" }}>
          <div style={{ display: "flex", gap: 4 }}>
            <input value={newCollName} onChange={e => setNewCollName(e.target.value)} placeholder="Collection name" style={inputSm} />
            <button type="button" onClick={handleCreateColl} style={{ ...actionBtn("#4ade80"), padding: "2px 6px", flex: 0 }}>Save</button>
          </div>
        </div>
      )}

      {/* Variable list by collection */}
      {Object.keys(varsByColl).length === 0 && (
        <div style={emptyStyle}>No variables yet. Create one to start.</div>
      )}

      {Object.entries(varsByColl).map(([collId, collVars]) => {
        const coll = collections.find(c => c.id === collId);
        return (
          <div key={collId} style={{ borderBottom: "1px solid #1c1c26" }}>
            {coll && (
              <div style={{ padding: "4px 10px", fontSize: 10, fontWeight: 600, color: "#5a5a70", textTransform: "uppercase", letterSpacing: 1 }}>
                {coll.name}
              </div>
            )}
            {collVars.map(v => (
              <div key={v.id} style={{
                padding: "4px 10px", display: "flex", alignItems: "center", gap: 6,
                borderTop: "1px solid #0a0a0f",
              }}>
                {/* Color swatch */}
                {v.type === "color" && (
                  <span style={{ width: 12, height: 12, borderRadius: 2, background: String(v.value), border: "1px solid #2a2a3a", flexShrink: 0 }} />
                )}
                <span style={{ flex: 1, fontSize: 11, color: "#e4e4f0" }}>{v.name}</span>
                <span style={{ fontSize: 10, color: "#5a5a70", fontFamily: "monospace" }}>
                  {v.type === "color" ? String(v.value).slice(0, 7) : String(v.value)}
                </span>
                {/* Link to selected */}
                <button type="button" onClick={() => setLinkOpen(linkOpen === v.id ? null : v.id)}
                  disabled={selectedObjects.length === 0}
                  style={{
                    padding: "1px 4px", borderRadius: 3, fontSize: 9, cursor: "pointer",
                    background: selectedObjects.length > 0 ? "#1a2a1a" : "#111118",
                    border: selectedObjects.length > 0 ? "1px solid #2a4a2a" : "1px solid #1c1c26",
                    color: selectedObjects.length > 0 ? "#4ade80" : "#5a5a70",
                  }}>
                  🔗
                </button>
              </div>
            ))}
            {/* Link dropdown */}
            {linkOpen && (
              <div style={{ padding: "4px 10px 6px", background: "#0a0a0f", borderTop: "1px solid #1c1c26" }}>
                <div style={{ fontSize: 10, color: "#7a7a90", marginBottom: 3 }}>Link to property:</div>
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                  {["fill", "stroke", "fontSize", "fontFamily", "width", "height"].map(prop => (
                    <button key={prop} type="button" onClick={() => handleLink(linkOpen, prop)}
                      style={{
                        padding: "2px 5px", borderRadius: 3, fontSize: 9, cursor: "pointer",
                        background: "#111118", border: "1px solid #1c1c26", color: "#7a7a90",
                      }}>
                      {prop}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const emptyStyle: React.CSSProperties = {
  padding: 20, color: "#666", fontSize: 12, textAlign: "center",
};

const inputSm: React.CSSProperties = {
  flex: 1, background: "#111118", border: "1px solid #1c1c26",
  color: "#e4e4f0", borderRadius: 4, padding: "3px 4px", fontSize: 11,
  fontFamily: "monospace", width: "100%",
};

const selectSm: React.CSSProperties = {
  flex: 1, background: "#111118", border: "1px solid #1c1c26",
  color: "#e4e4f0", borderRadius: 4, padding: "3px 4px", fontSize: 11,
};

function actionBtn(color: string): React.CSSProperties {
  return {
    padding: "3px 6px", borderRadius: 4, fontSize: 11, cursor: "pointer",
    background: "#111118", border: `1px solid ${color}33`, color,
  };
}
