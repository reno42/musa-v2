import { useState, useCallback, useRef, useEffect } from "react";
import type { ComponentDefinition, ComponentProperty, ComponentPropertyType } from "@futuraria/shared";

// ─── Types ───────────────────────────────────────────────────────

interface Props {
  components: ComponentDefinition[];
  selectedInstanceComponentId?: string | null;
  instanceOverrides?: Record<string, any>;
  onCreateComponent: (name: string) => void;
  onInstantiate: (componentId: string) => void;
  onDeleteComponent: (componentId: string) => void;
  onDetachInstance: () => void;
  onEnterEditMode: (componentId: string) => void;
  onOverrideProperty: (propertyId: string, value: any) => void;
  onSelectMainComponent: (componentId: string) => void;
}

// ─── Property Controls ───────────────────────────────────────────

function PropertyControl({
  prop,
  value,
  onChange,
}: {
  prop: ComponentProperty;
  value: any;
  onChange: (val: any) => void;
}) {
  switch (prop.type) {
    case "boolean":
      return (
        <div className="prop-row">
          <label className="prop-label">{prop.name}</label>
          <button
            className={`toggle-btn ${value ? "on" : "off"}`}
            onClick={() => onChange(!value)}
          >
            {value ? "ON" : "OFF"}
          </button>
        </div>
      );

    case "text":
      return (
        <div className="prop-row">
          <label className="prop-label">{prop.name}</label>
          <input
            type="text"
            className="prop-input"
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );

    case "number":
      return (
        <div className="prop-row">
          <label className="prop-label">{prop.name}</label>
          <input
            type="number"
            className="prop-input"
            value={value ?? prop.defaultValue ?? 0}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        </div>
      );

    case "enum":
      return (
        <div className="prop-row">
          <label className="prop-label">{prop.name}</label>
          <select
            className="prop-select"
            value={value ?? prop.defaultValue}
            onChange={(e) => onChange(e.target.value)}
          >
            {(prop.options || []).map((opt) => (
              <option key={String(opt)} value={String(opt)}>
                {String(opt)}
              </option>
            ))}
          </select>
        </div>
      );

    case "color":
      return (
        <div className="prop-row">
          <label className="prop-label">{prop.name}</label>
          <div className="color-input-wrapper">
            <input
              type="color"
              className="prop-color"
              value={value ?? prop.defaultValue ?? "#000000"}
              onChange={(e) => onChange(e.target.value)}
            />
            <span className="color-hex">{value ?? prop.defaultValue ?? "#000000"}</span>
          </div>
        </div>
      );

    case "instance_swap":
      return (
        <div className="prop-row">
          <label className="prop-label">{prop.name}</label>
          <button className="instance-swap-btn" onClick={() => onChange(null)}>
            Swap Instance…
          </button>
        </div>
      );

    default:
      return null;
  }
}

// ─── Create Component Dialog ─────────────────────────────────────

function CreateDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="dialog-title">Create Component</h3>
        <p className="dialog-desc">
          Convert the selected objects into a reusable component.
        </p>
        <input
          ref={inputRef}
          type="text"
          className="dialog-input"
          placeholder="Component name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) onConfirm(name.trim());
            if (e.key === "Escape") onCancel();
          }}
        />
        <div className="dialog-actions">
          <button className="btn-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={!name.trim()}
            onClick={() => name.trim() && onConfirm(name.trim())}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────

export function ComponentsPanel({
  components,
  selectedInstanceComponentId,
  instanceOverrides = {},
  onCreateComponent,
  onInstantiate,
  onDeleteComponent,
  onDetachInstance,
  onEnterEditMode,
  onOverrideProperty,
  onSelectMainComponent,
}: Props) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const filtered = components.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  // The component definition for the currently selected instance
  const activeComponent = selectedInstanceComponentId
    ? components.find((c) => c.id === selectedInstanceComponentId)
    : null;

  // ─── Drag to canvas ─────────────────────────────────────────────
  const handleDragStart = useCallback(
    (e: React.DragEvent, componentId: string) => {
      setDraggedId(componentId);
      e.dataTransfer.setData("application/component-id", componentId);
      e.dataTransfer.effectAllowed = "copy";
    },
    []
  );

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
  }, []);

  // ─── Render ─────────────────────────────────────────────────────
  return (
    <div className="sidebar components-panel">
      <div className="sidebar-header">
        <span>Components</span>
        <button
          className="tree-add-btn"
          onClick={() => setShowCreateDialog(true)}
          title="Create Component from Selection"
        >
          +
        </button>
      </div>

      {/* Search */}
      <div className="components-search">
        <input
          type="text"
          placeholder="Search components…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="search-input"
        />
      </div>

      {/* Instance properties panel (when an instance is selected) */}
      {activeComponent && (
        <div className="instance-section">
          <div className="instance-header">
            <span className="instance-badge">◆ Instance</span>
            <span className="instance-name">{activeComponent.name}</span>
          </div>

          {/* Component properties */}
          {activeComponent.properties.length > 0 && (
            <div className="instance-properties">
              {activeComponent.properties.map((prop) => (
                <PropertyControl
                  key={prop.id}
                  prop={prop}
                  value={
                    instanceOverrides[prop.id] !== undefined
                      ? instanceOverrides[prop.id]
                      : prop.defaultValue
                  }
                  onChange={(val) => onOverrideProperty(prop.id, val)}
                />
              ))}
            </div>
          )}

          {/* Instance actions */}
          <div className="instance-actions">
            <button
              className="action-link"
              onClick={() =>
                selectedInstanceComponentId &&
                onSelectMainComponent(selectedInstanceComponentId)
              }
            >
              ↗ Select Main Component
            </button>
            <button className="action-link danger" onClick={onDetachInstance}>
              ⊘ Detach Instance
            </button>
          </div>
        </div>
      )}

      {/* Component list */}
      <div className="components-list">
        {filtered.length === 0 && (
          <div className="empty-state">
            <span className="empty-icon">◇</span>
            <span className="empty-text">
              {components.length === 0
                ? "No components yet. Select objects and press +"
                : "No matches"}
            </span>
          </div>
        )}

        {filtered.map((comp) => {
          const isExpanded = expandedId === comp.id;

          return (
            <div
              key={comp.id}
              className={`component-card ${draggedId === comp.id ? "dragging" : ""}`}
              draggable
              onDragStart={(e) => handleDragStart(e, comp.id)}
              onDragEnd={handleDragEnd}
            >
              {/* Card header */}
              <div
                className="component-card-header"
                onClick={() => setExpandedId(isExpanded ? null : comp.id)}
                onDoubleClick={() => onEnterEditMode(comp.id)}
              >
                <div className="component-thumbnail">
                  <span className="component-icon">⬡</span>
                </div>
                <div className="component-info">
                  <span className="component-name">{comp.name}</span>
                  <span className="component-meta">
                    {comp.layers.length} layer{comp.layers.length !== 1 ? "s" : ""}
                    {comp.properties.length > 0 &&
                      ` · ${comp.properties.length} prop${comp.properties.length !== 1 ? "s" : ""}`}
                  </span>
                </div>
                <span className="expand-arrow">{isExpanded ? "▾" : "▸"}</span>
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="component-details">
                  {comp.description && (
                    <p className="comp-desc">{comp.description}</p>
                  )}
                  <div className="comp-actions">
                    <button
                      className="comp-action-btn"
                      onClick={() => onInstantiate(comp.id)}
                    >
                      Place Instance
                    </button>
                    <button
                      className="comp-action-btn"
                      onClick={() => onEnterEditMode(comp.id)}
                    >
                      Edit Master
                    </button>
                    <button
                      className="comp-action-btn danger"
                      onClick={() => onDeleteComponent(comp.id)}
                    >
                      Delete
                    </button>
                  </div>
                  {comp.metadata.tags && comp.metadata.tags.length > 0 && (
                    <div className="comp-tags">
                      {comp.metadata.tags.map((tag) => (
                        <span key={tag} className="tag-chip">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Create dialog */}
      {showCreateDialog && (
        <CreateDialog
          onConfirm={(name) => {
            onCreateComponent(name);
            setShowCreateDialog(false);
          }}
          onCancel={() => setShowCreateDialog(false)}
        />
      )}

      {/* Styles */}
      <style>{`
        .components-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
        }
        .components-search {
          padding: 8px 12px;
          border-bottom: 1px solid var(--border, #222);
        }
        .search-input {
          width: 100%;
          padding: 6px 10px;
          background: var(--surface-2, #1a1a1a);
          border: 1px solid var(--border, #333);
          border-radius: 6px;
          color: var(--text, #eee);
          font-size: 12px;
          outline: none;
        }
        .search-input:focus {
          border-color: var(--accent, #6366f1);
        }

        /* Instance section */
        .instance-section {
          padding: 12px;
          background: rgba(168, 85, 247, 0.08);
          border-bottom: 1px solid var(--border, #222);
        }
        .instance-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }
        .instance-badge {
          font-size: 10px;
          color: #a855f7;
          background: rgba(168, 85, 247, 0.15);
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 600;
        }
        .instance-name {
          font-size: 12px;
          font-weight: 600;
          color: var(--text, #eee);
        }
        .instance-properties {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 8px;
        }
        .prop-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .prop-label {
          font-size: 11px;
          color: var(--text-muted, #888);
          flex-shrink: 0;
        }
        .prop-input, .prop-select {
          flex: 1;
          max-width: 140px;
          padding: 3px 6px;
          background: var(--surface-2, #1a1a1a);
          border: 1px solid var(--border, #333);
          border-radius: 4px;
          color: var(--text, #eee);
          font-size: 11px;
        }
        .prop-color {
          width: 24px;
          height: 24px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          padding: 0;
        }
        .color-input-wrapper {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .color-hex {
          font-size: 10px;
          color: var(--text-muted, #888);
          font-family: monospace;
        }
        .toggle-btn {
          padding: 2px 10px;
          border-radius: 10px;
          border: 1px solid var(--border, #333);
          font-size: 10px;
          font-weight: 600;
          cursor: pointer;
          min-width: 42px;
        }
        .toggle-btn.on {
          background: rgba(168, 85, 247, 0.2);
          color: #a855f7;
          border-color: #a855f7;
        }
        .toggle-btn.off {
          background: var(--surface-2, #1a1a1a);
          color: var(--text-muted, #888);
        }
        .instance-swap-btn {
          font-size: 11px;
          padding: 2px 8px;
          background: var(--surface-2, #1a1a1a);
          border: 1px solid var(--border, #333);
          border-radius: 4px;
          color: var(--text, #eee);
          cursor: pointer;
        }
        .instance-actions {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .action-link {
          background: none;
          border: none;
          color: #a855f7;
          font-size: 11px;
          cursor: pointer;
          text-align: left;
          padding: 2px 0;
        }
        .action-link:hover {
          text-decoration: underline;
        }
        .action-link.danger {
          color: #ef4444;
        }

        /* Component list */
        .components-list {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
        }
        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 32px 16px;
          gap: 8px;
          color: var(--text-muted, #666);
        }
        .empty-icon {
          font-size: 24px;
          opacity: 0.4;
        }
        .empty-text {
          font-size: 11px;
          text-align: center;
        }

        /* Component card */
        .component-card {
          background: var(--surface-1, #111);
          border: 1px solid var(--border, #222);
          border-radius: 8px;
          margin-bottom: 6px;
          overflow: hidden;
          cursor: grab;
          transition: border-color 0.15s;
        }
        .component-card:hover {
          border-color: var(--border-hover, #444);
        }
        .component-card.dragging {
          opacity: 0.5;
          border-color: #a855f7;
        }
        .component-card-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          cursor: pointer;
          user-select: none;
        }
        .component-thumbnail {
          width: 36px;
          height: 36px;
          background: var(--surface-2, #1a1a1a);
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .component-icon {
          font-size: 18px;
          color: #a855f7;
        }
        .component-info {
          flex: 1;
          min-width: 0;
        }
        .component-name {
          display: block;
          font-size: 12px;
          font-weight: 600;
          color: var(--text, #eee);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .component-meta {
          display: block;
          font-size: 10px;
          color: var(--text-muted, #666);
        }
        .expand-arrow {
          font-size: 10px;
          color: var(--text-muted, #666);
          flex-shrink: 0;
        }

        /* Expanded details */
        .component-details {
          padding: 0 10px 10px;
        }
        .comp-desc {
          font-size: 11px;
          color: var(--text-muted, #888);
          margin: 0 0 8px;
        }
        .comp-actions {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        .comp-action-btn {
          font-size: 10px;
          padding: 4px 8px;
          background: var(--surface-2, #1a1a1a);
          border: 1px solid var(--border, #333);
          border-radius: 4px;
          color: var(--text, #eee);
          cursor: pointer;
        }
        .comp-action-btn:hover {
          border-color: var(--accent, #6366f1);
        }
        .comp-action-btn.danger:hover {
          border-color: #ef4444;
          color: #ef4444;
        }
        .comp-tags {
          display: flex;
          gap: 4px;
          flex-wrap: wrap;
          margin-top: 6px;
        }
        .tag-chip {
          font-size: 9px;
          padding: 2px 6px;
          background: var(--surface-2, #1a1a1a);
          border-radius: 3px;
          color: var(--text-muted, #888);
        }

        /* Dialog */
        .dialog-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
        }
        .dialog {
          background: var(--surface-1, #111);
          border: 1px solid var(--border, #333);
          border-radius: 12px;
          padding: 20px;
          width: 320px;
        }
        .dialog-title {
          font-size: 14px;
          font-weight: 600;
          color: var(--text, #eee);
          margin: 0 0 6px;
        }
        .dialog-desc {
          font-size: 12px;
          color: var(--text-muted, #888);
          margin: 0 0 12px;
        }
        .dialog-input {
          width: 100%;
          padding: 8px 10px;
          background: var(--surface-2, #1a1a1a);
          border: 1px solid var(--border, #333);
          border-radius: 6px;
          color: var(--text, #eee);
          font-size: 13px;
          outline: none;
          margin-bottom: 12px;
          box-sizing: border-box;
        }
        .dialog-input:focus {
          border-color: var(--accent, #6366f1);
        }
        .dialog-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }
        .btn-cancel {
          padding: 6px 14px;
          background: none;
          border: 1px solid var(--border, #333);
          border-radius: 6px;
          color: var(--text-muted, #888);
          cursor: pointer;
          font-size: 12px;
        }
        .btn-primary {
          padding: 6px 14px;
          background: #a855f7;
          border: none;
          border-radius: 6px;
          color: white;
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
        }
        .btn-primary:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
