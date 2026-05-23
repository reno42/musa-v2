import { useState, useCallback } from "react";
import type { GridStyle, GridStyleType, CreateGridStyleRequest } from "@futuraria/shared";

interface Props {
  gridStyles: GridStyle[];
  activeGridStyleId: string | null;
  onGridStylesChange: (styles: GridStyle[]) => void;
  onApplyGridStyle: (styleId: string) => void;
  onRemoveGridStyle: () => void;
}

const GRID_TYPE_ICONS: Record<GridStyleType, string> = {
  columns: "▥",
  rows: "▤",
  grid: "⊞",
};

export function GridStylesPanel({
  gridStyles,
  activeGridStyleId,
  onGridStylesChange,
  onApplyGridStyle,
  onRemoveGridStyle,
}: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleCreate = useCallback((req: CreateGridStyleRequest) => {
    const now = new Date().toISOString();
    const newStyle: GridStyle = {
      id: `gs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: req.name,
      type: req.type,
      count: req.count,
      gutter: req.gutter,
      margin: req.margin,
      color: req.color,
      visible: true,
      metadata: { createdAt: now, updatedAt: now },
    };
    onGridStylesChange([...gridStyles, newStyle]);
    setShowCreate(false);
  }, [gridStyles, onGridStylesChange]);

  const handleDelete = useCallback((id: string) => {
    onGridStylesChange(gridStyles.filter((s) => s.id !== id));
    if (activeGridStyleId === id) onRemoveGridStyle();
  }, [gridStyles, activeGridStyleId, onGridStylesChange, onRemoveGridStyle]);

  const handleUpdate = useCallback((id: string, updates: Partial<GridStyle>) => {
    onGridStylesChange(
      gridStyles.map((s) =>
        s.id === id
          ? { ...s, ...updates, metadata: { ...s.metadata, updatedAt: new Date().toISOString() } }
          : s
      )
    );
  }, [gridStyles, onGridStylesChange]);

  return (
    <div className="grid-styles-panel">
      <div className="grid-styles-header">
        <span>Grid Styles</span>
        <button className="tree-add-btn" onClick={() => setShowCreate(true)} title="Create grid style">
          +
        </button>
      </div>

      {/* Active grid indicator */}
      {activeGridStyleId && (
        <div className="grid-style-active-indicator">
          <span className="grid-style-active-label">Active:</span>
          <span className="grid-style-active-name">
            {gridStyles.find((s) => s.id === activeGridStyleId)?.name || "Unknown"}
          </span>
          <button
            className="grid-style-remove-btn"
            onClick={onRemoveGridStyle}
            title="Remove grid"
          >
            ×
          </button>
        </div>
      )}

      {/* Grid style list */}
      <div className="grid-styles-list">
        {gridStyles.length === 0 ? (
          <div className="grid-styles-empty">
            No grid styles yet.
            <br />
            <button className="styles-empty-btn" onClick={() => setShowCreate(true)}>
              Create one
            </button>
          </div>
        ) : (
          gridStyles.map((style) => (
            <GridStyleCard
              key={style.id}
              style={style}
              isActive={activeGridStyleId === style.id}
              onApply={() => onApplyGridStyle(style.id)}
              onEdit={() => setEditingId(style.id)}
              onDelete={() => handleDelete(style.id)}
              onUpdate={(updates) => handleUpdate(style.id, updates)}
              isEditing={editingId === style.id}
              onStopEdit={() => setEditingId(null)}
            />
          ))
        )}
      </div>

      {/* Create dialog */}
      {showCreate && (
        <CreateGridStyleDialog
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}

// ─── Grid Style Card ──────────────────────────────────────────────
function GridStyleCard({
  style,
  isActive,
  onApply,
  onEdit,
  onDelete,
  onUpdate,
  isEditing,
  onStopEdit,
}: {
  style: GridStyle;
  isActive: boolean;
  onApply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onUpdate: (updates: Partial<GridStyle>) => void;
  isEditing: boolean;
  onStopEdit: () => void;
}) {
  const [editName, setEditName] = useState(style.name);

  if (isEditing) {
    return (
      <div className="grid-style-card grid-style-editing">
        <div className="grid-style-edit-row">
          <input
            className="prop-input"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onUpdate({ name: editName });
                onStopEdit();
              }
              if (e.key === "Escape") onStopEdit();
            }}
            autoFocus
          />
        </div>
        <div className="grid-style-edit-row">
          <label className="prop-label" style={{ width: 50 }}>type</label>
          <select
            className="prop-select"
            value={style.type}
            onChange={(e) => onUpdate({ type: e.target.value as GridStyleType })}
          >
            <option value="columns">Columns</option>
            <option value="rows">Rows</option>
            <option value="grid">Grid</option>
          </select>
        </div>
        <div className="grid-style-edit-row">
          <label className="prop-label" style={{ width: 50 }}>count</label>
          <input
            className="prop-input prop-input-sm"
            type="number"
            min={1}
            max={24}
            value={style.count}
            onChange={(e) => onUpdate({ count: Number(e.target.value) })}
          />
        </div>
        <div className="grid-style-edit-row">
          <label className="prop-label" style={{ width: 50 }}>gutter</label>
          <input
            className="prop-input prop-input-sm"
            type="number"
            min={0}
            value={style.gutter}
            onChange={(e) => onUpdate({ gutter: Number(e.target.value) })}
          />
        </div>
        <div className="grid-style-edit-row">
          <label className="prop-label" style={{ width: 50 }}>margin</label>
          <input
            className="prop-input prop-input-sm"
            type="number"
            min={0}
            value={style.margin}
            onChange={(e) => onUpdate({ margin: Number(e.target.value) })}
          />
        </div>
        <div className="grid-style-edit-row">
          <label className="prop-label" style={{ width: 50 }}>color</label>
          <div className="color-swatch" style={{ background: style.color, width: 24, height: 24 }}>
            <input
              type="color"
              value={style.color}
              onChange={(e) => onUpdate({ color: e.target.value })}
            />
          </div>
          <input
            className="prop-input"
            value={style.color}
            onChange={(e) => onUpdate({ color: e.target.value })}
          />
        </div>
        <button className="style-dialog-btn" onClick={onStopEdit} style={{ marginTop: 4 }}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className={`grid-style-card ${isActive ? "grid-style-active" : ""}`}>
      <div className="grid-style-preview" onClick={onApply}>
        <GridStylePreview style={style} />
      </div>
      <div className="grid-style-info">
        <span className="grid-style-name">{style.name}</span>
        <span className="grid-style-meta">
          {GRID_TYPE_ICONS[style.type]} {style.count} · {style.gutter}px gap · {style.margin}px margin
        </span>
      </div>
      <div className="grid-style-actions">
        {isActive ? (
          <button
            className="style-btn grid-style-remove-btn-inline"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Remove from canvas"
          >
            ×
          </button>
        ) : (
          <button
            className="style-btn"
            onClick={(e) => { e.stopPropagation(); onApply(); }}
            title="Apply to canvas"
          >
            ▶
          </button>
        )}
        <button
          className="style-btn"
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          title="Edit"
        >
          ✎
        </button>
        <button
          className="style-btn style-btn-danger"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete"
        >
          🗑
        </button>
      </div>
    </div>
  );
}

// ─── Grid Style Preview (mini visual) ─────────────────────────────
function GridStylePreview({ style }: { style: GridStyle }) {
  const w = 48;
  const h = 32;
  const count = Math.min(style.count, 12);
  const margin = Math.min(style.margin, 4);
  const gutter = Math.min(style.gutter, 3);

  if (style.type === "columns") {
    const colW = (w - margin * 2 - gutter * (count - 1)) / count;
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        {Array.from({ length: count }).map((_, i) => (
          <rect
            key={i}
            x={margin + i * (colW + gutter)}
            y={margin}
            width={colW}
            height={h - margin * 2}
            fill={style.color}
            opacity={0.4}
            rx={1}
          />
        ))}
      </svg>
    );
  }

  if (style.type === "rows") {
    const rowH = (h - margin * 2 - gutter * (count - 1)) / count;
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        {Array.from({ length: count }).map((_, i) => (
          <rect
            key={i}
            x={margin}
            y={margin + i * (rowH + gutter)}
            width={w - margin * 2}
            height={rowH}
            fill={style.color}
            opacity={0.4}
            rx={1}
          />
        ))}
      </svg>
    );
  }

  // Grid
  const colW = (w - margin * 2 - gutter * (count - 1)) / count;
  const rowH = (h - margin * 2 - gutter * (Math.min(count, 6) - 1)) / Math.min(count, 6);
  const rowCount = Math.min(count, 6);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {Array.from({ length: count }).map((_, ci) =>
        Array.from({ length: rowCount }).map((_, ri) => (
          <rect
            key={`${ci}-${ri}`}
            x={margin + ci * (colW + gutter)}
            y={margin + ri * (rowH + gutter)}
            width={colW}
            height={rowH}
            fill={style.color}
            opacity={0.3}
            rx={1}
          />
        ))
      )}
    </svg>
  );
}

// ─── Create Grid Style Dialog ─────────────────────────────────────
function CreateGridStyleDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (req: CreateGridStyleRequest) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<GridStyleType>("columns");
  const [count, setCount] = useState(12);
  const [gutter, setGutter] = useState(20);
  const [margin, setMargin] = useState(80);
  const [color, setColor] = useState("#6366f1");

  const handleCreate = () => {
    if (!name.trim()) return;
    onCreate({ name: name.trim(), type, count, gutter, margin, color });
  };

  return (
    <div className="style-dialog-overlay" onClick={onClose}>
      <div className="style-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="style-dialog-header">
          <span>Create Grid Style</span>
          <button className="style-dialog-close" onClick={onClose}>×</button>
        </div>
        <div className="style-dialog-body">
          <div className="style-dialog-field">
            <label>Name</label>
            <input
              className="prop-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. 12-column layout"
              autoFocus
            />
          </div>
          <div className="style-dialog-field">
            <label>Type</label>
            <div className="style-type-tabs">
              {(["columns", "rows", "grid"] as const).map((t) => (
                <button
                  key={t}
                  className={`style-type-tab ${type === t ? "active" : ""}`}
                  onClick={() => setType(t)}
                >
                  {GRID_TYPE_ICONS[t]} {t}
                </button>
              ))}
            </div>
          </div>
          <div className="style-dialog-field">
            <label>Count</label>
            <input
              className="prop-input"
              type="number"
              min={1}
              max={24}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </div>
          <div className="style-dialog-field">
            <label>Gutter (px)</label>
            <input
              className="prop-input"
              type="number"
              min={0}
              value={gutter}
              onChange={(e) => setGutter(Number(e.target.value))}
            />
          </div>
          <div className="style-dialog-field">
            <label>Margin (px)</label>
            <input
              className="prop-input"
              type="number"
              min={0}
              value={margin}
              onChange={(e) => setMargin(Number(e.target.value))}
            />
          </div>
          <div className="style-dialog-field">
            <label>Color</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div className="color-swatch" style={{ background: color, width: 28, height: 28 }}>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
              </div>
              <input
                className="prop-input"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            </div>
          </div>
          {/* Preview */}
          <div className="grid-style-dialog-preview">
            <GridStylePreview
              style={{
                id: "preview",
                name,
                type,
                count,
                gutter,
                margin,
                color,
                metadata: { createdAt: "", updatedAt: "" },
              }}
            />
          </div>
        </div>
        <div className="style-dialog-footer">
          <button className="style-dialog-btn" onClick={onClose}>Cancel</button>
          <button
            className="style-dialog-btn style-dialog-btn-primary"
            onClick={handleCreate}
            disabled={!name.trim()}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
