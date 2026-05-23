import { useState, useCallback } from "react";
import type {
  Variable, VariableCollection, VariableType, VariableScope,
} from "@futuraria/shared";

// ─── Types ───────────────────────────────────────────────────────

interface Props {
  collections: VariableCollection[];
  variables: Variable[];
  activeModes: Record<string, string>;
  bindings: Map<string, Array<{ layerId: string; property: string }>>;
  selectedLayerId?: string;
  selectedLayerProperty?: string;
  onCreateCollection: (name: string, modes: string[]) => void;
  onUpdateCollection: (id: string, updates: Partial<VariableCollection>) => void;
  onDeleteCollection: (id: string) => void;
  onCreateVariable: (name: string, type: VariableType, collectionId: string, value?: string | number | boolean, scopes?: VariableScope[]) => void;
  onUpdateVariable: (id: string, updates: Partial<Variable>) => void;
  onDeleteVariable: (id: string) => void;
  onSetActiveMode: (collectionId: string, modeId: string) => void;
  onBindVariable: (variableId: string, layerId: string, property: string) => void;
  onUnbindVariable: (variableId: string, layerId: string, property: string) => void;
  onResolveValue: (variableId: string) => string | number | boolean | null;
  onSave: () => void;
}

// ─── Component ───────────────────────────────────────────────────

export function VariablesPanel({
  collections, variables, activeModes, bindings,
  selectedLayerId, selectedLayerProperty,
  onCreateCollection, onUpdateCollection, onDeleteCollection,
  onCreateVariable, onUpdateVariable, onDeleteVariable,
  onSetActiveMode, onBindVariable, onUnbindVariable,
  onResolveValue, onSave,
}: Props) {
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set());
  const [showNewCollection, setShowNewCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [newCollectionModes, setNewCollectionModes] = useState("Light, Dark");
  const [addingVariableTo, setAddingVariableTo] = useState<string | null>(null);
  const [newVarName, setNewVarName] = useState("");
  const [newVarType, setNewVarType] = useState<VariableType>("color");
  const [editingVarId, setEditingVarId] = useState<string | null>(null);
  const [draggedVarId, setDraggedVarId] = useState<string | null>(null);
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [editModeName, setEditModeName] = useState("");

  const toggleCollection = (id: string) => {
    setExpandedCollections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleCreateCollection = () => {
    if (!newCollectionName.trim()) return;
    const modes = newCollectionModes.split(",").map(m => m.trim()).filter(Boolean);
    onCreateCollection(newCollectionName.trim(), modes.length ? modes : ["Default"]);
    setNewCollectionName("");
    setNewCollectionModes("Light, Dark");
    setShowNewCollection(false);
  };

  const handleAddVariable = (collectionId: string) => {
    if (!newVarName.trim()) return;
    onCreateVariable(newVarName.trim(), newVarType, collectionId);
    setNewVarName("");
    setNewVarType("color");
    setAddingVariableTo(null);
  };

  const handleDragStart = (e: React.DragEvent, variableId: string) => {
    e.dataTransfer.setData("application/variable-id", variableId);
    e.dataTransfer.effectAllowed = "copy";
    setDraggedVarId(variableId);
  };

  const handleDragEnd = () => {
    setDraggedVarId(null);
  };

  const getBoundProperty = (varId: string): string | null => {
    if (!selectedLayerId) return null;
    const varBindings = bindings.get(varId);
    if (!varBindings) return null;
    const found = varBindings.find(b => b.layerId === selectedLayerId);
    return found?.property || null;
  };

  const scopeLabel = (s: VariableScope): string => {
    const map: Record<VariableScope, string> = {
      fill: "Fill", stroke: "Stroke", fontSize: "Font Size", fontFamily: "Font Family",
      opacity: "Opacity", lineHeight: "Line Height", letterSpacing: "Letter Spacing",
      cornerRadius: "Radius", shadow: "Shadow", "*": "All",
    };
    return map[s] || s;
  };

  return (
    <div className="variables-panel">
      <div className="sidebar-header">
        <span>Variables</span>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            className="add-btn"
            onClick={() => setShowNewCollection(!showNewCollection)}
            title="New Collection"
          >
            +
          </button>
          <button className="add-btn" onClick={onSave} title="Save variables">
            💾
          </button>
        </div>
      </div>

      {/* New Collection form */}
      {showNewCollection && (
        <div className="var-form">
          <input
            className="prop-input"
            placeholder="Collection name"
            value={newCollectionName}
            onChange={(e) => setNewCollectionName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateCollection()}
            autoFocus
          />
          <input
            className="prop-input"
            placeholder="Modes (comma-separated)"
            value={newCollectionModes}
            onChange={(e) => setNewCollectionModes(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateCollection()}
          />
          <div className="var-form-actions">
            <button className="var-btn var-btn-primary" onClick={handleCreateCollection}>Create</button>
            <button className="var-btn" onClick={() => setShowNewCollection(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Collections list */}
      {collections.length === 0 && !showNewCollection && (
        <div className="empty-state">No variable collections yet.<br />Click + to create one.</div>
      )}

      {collections.map((col) => {
        const isExpanded = expandedCollections.has(col.id);
        const colVars = variables.filter(v => v.collectionId === col.id);
        const activeMode = activeModes[col.id] || col.defaultMode;

        return (
          <div key={col.id} className="var-collection">
            {/* Collection header */}
            <div className="var-collection-header" onClick={() => toggleCollection(col.id)}>
              <span className="var-collection-arrow">{isExpanded ? "▼" : "▶"}</span>
              {editingCollectionId === col.id ? (
                <input
                  className="var-inline-input"
                  value={editModeName}
                  onChange={(e) => setEditModeName(e.target.value)}
                  onBlur={() => {
                    onUpdateCollection(col.id, { name: editModeName });
                    setEditingCollectionId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      onUpdateCollection(col.id, { name: editModeName });
                      setEditingCollectionId(null);
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                />
              ) : (
                <span
                  className="var-collection-name"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingCollectionId(col.id);
                    setEditModeName(col.name);
                  }}
                >
                  {col.name}
                </span>
              )}
              <button
                className="var-icon-btn"
                onClick={(e) => { e.stopPropagation(); onDeleteCollection(col.id); }}
                title="Delete collection"
              >
                🗑
              </button>
            </div>

            {/* Mode selector */}
            <div className="var-mode-selector">
              {col.modes.map((mode) => (
                <button
                  key={mode}
                  className={`var-mode-btn ${activeMode === mode ? "active" : ""}`}
                  onClick={() => onSetActiveMode(col.id, mode)}
                >
                  {mode}
                </button>
              ))}
            </div>

            {isExpanded && (
              <>
                {/* Variables list */}
                {colVars.map((v) => {
                  const resolved = onResolveValue(v.id);
                  const boundProp = getBoundProperty(v.id);
                  const isEditing = editingVarId === v.id;

                  return (
                    <div
                      key={v.id}
                      className={`var-item ${boundProp ? "var-item-bound" : ""} ${draggedVarId === v.id ? "var-item-dragging" : ""}`}
                      draggable
                      onDragStart={(e) => handleDragStart(e, v.id)}
                      onDragEnd={handleDragEnd}
                    >
                      <div className="var-item-header">
                        <span className="var-item-type-badge">{v.type}</span>
                        {isEditing ? (
                          <input
                            className="var-inline-input"
                            defaultValue={v.name}
                            onBlur={(e) => {
                              onUpdateVariable(v.id, { name: e.target.value });
                              setEditingVarId(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                onUpdateVariable(v.id, { name: (e.target as HTMLInputElement).value });
                                setEditingVarId(null);
                              }
                            }}
                            autoFocus
                          />
                        ) : (
                          <span
                            className="var-item-name"
                            onDoubleClick={() => setEditingVarId(v.id)}
                          >
                            {v.name}
                            {v.aliasOf && <span className="var-alias-badge">→ alias</span>}
                          </span>
                        )}
                        {boundProp && (
                          <span className="var-bound-badge" title={`Bound to ${boundProp}`}>
                            🔗 {boundProp}
                          </span>
                        )}
                        <button
                          className="var-icon-btn"
                          onClick={() => onDeleteVariable(v.id)}
                          title="Delete variable"
                        >
                          ✕
                        </button>
                      </div>

                      {/* Value editor (per mode) */}
                      <div className="var-item-value">
                        {v.type === "color" && (
                          <div className="var-value-color">
                            <input
                              type="color"
                              value={String(resolved || "#6366f1")}
                              onChange={(e) => {
                                const newValues = { ...v.values, [activeMode]: e.target.value };
                                onUpdateVariable(v.id, { values: newValues });
                              }}
                            />
                            <input
                              className="prop-input"
                              value={String(resolved || "#6366f1")}
                              onChange={(e) => {
                                const newValues = { ...v.values, [activeMode]: e.target.value };
                                onUpdateVariable(v.id, { values: newValues });
                              }}
                            />
                          </div>
                        )}
                        {v.type === "number" && (
                          <input
                            className="prop-input"
                            type="number"
                            value={Number(resolved ?? 0)}
                            onChange={(e) => {
                              const newValues = { ...v.values, [activeMode]: Number(e.target.value) };
                              onUpdateVariable(v.id, { values: newValues });
                            }}
                          />
                        )}
                        {v.type === "string" && (
                          <input
                            className="prop-input"
                            value={String(resolved ?? "")}
                            onChange={(e) => {
                              const newValues = { ...v.values, [activeMode]: e.target.value };
                              onUpdateVariable(v.id, { values: newValues });
                            }}
                          />
                        )}
                        {v.type === "boolean" && (
                          <label className="checkbox-row">
                            <input
                              type="checkbox"
                              checked={Boolean(resolved ?? false)}
                              onChange={(e) => {
                                const newValues = { ...v.values, [activeMode]: e.target.checked };
                                onUpdateVariable(v.id, { values: newValues });
                              }}
                            />
                            <span>{resolved ? "true" : "false"}</span>
                          </label>
                        )}
                      </div>

                      {/* Bind/unbind button */}
                      {selectedLayerId && (
                        <div className="var-item-actions">
                          {boundProp ? (
                            <button
                              className="var-btn var-btn-sm"
                              onClick={() => onUnbindVariable(v.id, selectedLayerId, boundProp)}
                            >
                              Unbind
                            </button>
                          ) : (
                            <select
                              className="prop-select var-bind-select"
                              value=""
                              onChange={(e) => {
                                if (e.target.value) onBindVariable(v.id, selectedLayerId, e.target.value);
                              }}
                            >
                              <option value="">Bind to…</option>
                              {getCompatibleProperties(v.type).map((prop) => (
                                <option key={prop.value} value={prop.value}>{prop.label}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Add variable form */}
                {addingVariableTo === col.id ? (
                  <div className="var-form var-form-inline">
                    <input
                      className="prop-input"
                      placeholder="Variable name"
                      value={newVarName}
                      onChange={(e) => setNewVarName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddVariable(col.id)}
                      autoFocus
                    />
                    <select
                      className="prop-select"
                      value={newVarType}
                      onChange={(e) => setNewVarType(e.target.value as VariableType)}
                    >
                      <option value="color">Color</option>
                      <option value="number">Number</option>
                      <option value="string">String</option>
                      <option value="boolean">Boolean</option>
                    </select>
                    <div className="var-form-actions">
                      <button className="var-btn var-btn-primary" onClick={() => handleAddVariable(col.id)}>Add</button>
                      <button className="var-btn" onClick={() => setAddingVariableTo(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="var-add-var-btn"
                    onClick={() => setAddingVariableTo(col.id)}
                  >
                    + Add variable
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────

/** Get the layer properties compatible with a variable type. */
function getCompatibleProperties(type: VariableType): Array<{ value: string; label: string }> {
  switch (type) {
    case "color":
      return [
        { value: "fill", label: "Fill" },
        { value: "stroke", label: "Stroke" },
        { value: "backgroundColor", label: "Background" },
      ];
    case "number":
      return [
        { value: "fontSize", label: "Font Size" },
        { value: "strokeWidth", label: "Stroke Width" },
        { value: "opacity", label: "Opacity" },
        { value: "lineHeight", label: "Line Height" },
        { value: "charSpacing", label: "Letter Spacing" },
        { value: "rx", label: "Corner Radius" },
      ];
    case "string":
      return [
        { value: "fontFamily", label: "Font Family" },
        { value: "text", label: "Text" },
      ];
    case "boolean":
      return [
        { value: "visible", label: "Visible" },
        { value: "flipX", label: "Flip H" },
        { value: "flipY", label: "Flip V" },
      ];
    default:
      return [];
  }
}
