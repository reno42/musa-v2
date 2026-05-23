import { useState, useEffect, useCallback, useRef } from "react";
import type { RefObject } from "react";
import * as fabric from "fabric";
import type { StyleDefinition, CreateStyleRequest } from "@futuraria/shared";

// ── Types ─────────────────────────────────────────────────────────
type StyleTab = "color" | "text" | "effect";

interface StylesPanelProps {
  selectedObj: fabric.FabricObject | null;
  fabricRef: RefObject<fabric.Canvas | null>;
  onStyleChange?: () => void;
  styles: StyleDefinition[];
  onStylesChange: (styles: StyleDefinition[]) => void;
  /** Called when style edits need to propagate to all linked objects */
  onStyleEdited?: (style: StyleDefinition) => void;
}

// ── Icon Components ───────────────────────────────────────────────
const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="7" y1="2" x2="7" y2="12" /><line x1="2" y1="7" x2="12" y2="7" />
  </svg>
);

const LinkIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M5 7L7 5M4.5 9.5L2.5 7.5a2.12 2.12 0 010-3l1-1a2.12 2.12 0 013 0l2 2a2.12 2.12 0 010 3l-1 1a2.12 2.12 0 01-3 0l-2-2z" />
  </svg>
);

const UnlinkIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M5 7L7 5M4.5 9.5L2.5 7.5a2.12 2.12 0 010-3l1-1a2.12 2.12 0 013 0l2 2a2.12 2.12 0 010 3l-1 1a2.12 2.12 0 01-3 0" />
    <line x1="1" y1="11" x2="11" y2="1" />
  </svg>
);

const TrashIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M2 3h8M4.5 3V2a.5.5 0 01.5-.5h2a.5.5 0 01.5.5v1M9 3v6.5a1 1 0 01-1 1H4a1 1 0 01-1-1V3" />
  </svg>
);

// ── Style Preview ─────────────────────────────────────────────────
function ColorPreview({ fills }: { fills?: Array<{ color: string; opacity: number }> }) {
  if (!fills?.length) return <div className="style-preview style-preview-empty">?</div>;
  if (fills.length === 1) {
    return (
      <div
        className="style-preview"
        style={{ background: fills[0].color, opacity: fills[0].opacity }}
      />
    );
  }
  return (
    <div className="style-preview style-preview-multi">
      {fills.map((f, i) => (
        <div
          key={i}
          className="style-preview-stripe"
          style={{ background: f.color, opacity: f.opacity, width: `${100 / fills.length}%` }}
        />
      ))}
    </div>
  );
}

function TextPreview({ style }: { style: StyleDefinition }) {
  return (
    <div
      className="style-preview style-preview-text"
      style={{
        fontFamily: style.fontFamily || "Inter, sans-serif",
        fontSize: "11px",
        fontWeight: style.fontWeight || "normal",
        lineHeight: style.lineHeight || 1.2,
      }}
    >
      Aa
    </div>
  );
}

function EffectPreview({ effects }: { effects?: StyleDefinition["effects"] }) {
  if (!effects?.length) return <div className="style-preview style-preview-empty">∅</div>;
  const shadow = effects.find((e) => e.type === "shadow");
  return (
    <div
      className="style-preview"
      style={{
        background: "#6366f1",
        boxShadow: shadow
          ? `${shadow.props.offsetX || 0}px ${shadow.props.offsetY || 0}px ${shadow.props.blur || 0}px ${shadow.props.color || "rgba(0,0,0,0.3)"}`
          : "none",
      }}
    />
  );
}

// ── Style Card ────────────────────────────────────────────────────
function StyleCard({
  style,
  isActive,
  isLinked,
  onApply,
  onDetach,
  onEdit,
  onDelete,
}: {
  style: StyleDefinition;
  isActive: boolean;
  isLinked: boolean;
  onApply: () => void;
  onDetach: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`style-card ${isActive ? "style-card-active" : ""}`}>
      <div className="style-card-preview" onClick={onApply}>
        {style.type === "color" && <ColorPreview fills={style.fills} />}
        {style.type === "text" && <TextPreview style={style} />}
        {style.type === "effect" && <EffectPreview effects={style.effects} />}
      </div>
      <div className="style-card-info">
        <span className="style-card-name">{style.name}</span>
        <span className="style-card-type">{style.type}</span>
      </div>
      <div className="style-card-actions">
        {isLinked && (
          <button className="style-btn" title="Detach style" onClick={onDetach}>
            <UnlinkIcon />
          </button>
        )}
        {!isLinked && isActive && (
          <button className="style-btn" title="Apply style" onClick={onApply}>
            <LinkIcon />
          </button>
        )}
        <button className="style-btn" title="Edit style" onClick={onEdit}>
          ✎
        </button>
        <button className="style-btn style-btn-danger" title="Delete style" onClick={onDelete}>
          <TrashIcon />
        </button>
      </div>
    </div>
  );
}

// ── Create Style Dialog ───────────────────────────────────────────
function CreateStyleDialog({
  initialType,
  selectedObj,
  onClose,
  onCreate,
}: {
  initialType: StyleTab;
  selectedObj: fabric.FabricObject | null;
  onClose: () => void;
  onCreate: (req: CreateStyleRequest) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<StyleTab>(initialType);

  const handleCreate = () => {
    if (!name.trim()) return;

    const req: CreateStyleRequest = { name: name.trim(), type };

    if (selectedObj) {
      if (type === "color") {
        const fill = selectedObj.fill as string;
        if (fill) {
          req.fills = [{ color: fill, opacity: selectedObj.opacity ?? 1 }];
        }
      } else if (type === "text") {
        req.fontFamily = (selectedObj as any).fontFamily;
        req.fontSize = (selectedObj as any).fontSize;
        req.fontWeight = String((selectedObj as any).fontWeight || "normal");
        req.lineHeight = (selectedObj as any).lineHeight;
        req.letterSpacing = (selectedObj as any).charSpacing;
      } else if (type === "effect") {
        const shadow = selectedObj.shadow as any;
        if (shadow) {
          req.effects = [
            {
              type: "shadow",
              props: {
                color: shadow.color,
                blur: shadow.blur,
                offsetX: shadow.offsetX,
                offsetY: shadow.offsetY,
              },
            },
          ];
        }
      }
    }

    onCreate(req);
    onClose();
  };

  return (
    <div className="style-dialog-overlay" onClick={onClose}>
      <div className="style-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="style-dialog-header">
          <span>Create Style</span>
          <button className="style-dialog-close" onClick={onClose}>×</button>
        </div>
        <div className="style-dialog-body">
          <div className="style-dialog-field">
            <label>Name</label>
            <input
              className="prop-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Primary Blue"
              autoFocus
            />
          </div>
          <div className="style-dialog-field">
            <label>Type</label>
            <div className="style-type-tabs">
              {(["color", "text", "effect"] as const).map((t) => (
                <button
                  key={t}
                  className={`style-type-tab ${type === t ? "active" : ""}`}
                  onClick={() => setType(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          {selectedObj && (
            <div className="style-dialog-hint">
              {type === "color" && "Will capture the fill color from the selected object."}
              {type === "text" && "Will capture typography settings from the selected text."}
              {type === "effect" && "Will capture shadow/effects from the selected object."}
            </div>
          )}
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

// ── Edit Style Dialog ─────────────────────────────────────────────
function EditStyleDialog({
  style,
  onClose,
  onSave,
}: {
  style: StyleDefinition;
  onClose: () => void;
  onSave: (updates: Partial<StyleDefinition>) => void;
}) {
  const [name, setName] = useState(style.name);
  const [fills, setFills] = useState(style.fills || []);
  const [fontFamily, setFontFamily] = useState(style.fontFamily || "");
  const [fontSize, setFontSize] = useState(style.fontSize || 16);
  const [fontWeight, setFontWeight] = useState(style.fontWeight || "normal");
  const [lineHeight, setLineHeight] = useState(style.lineHeight || 1.2);
  const [letterSpacing, setLetterSpacing] = useState(style.letterSpacing || 0);
  const [effects, setEffects] = useState(style.effects || []);

  const handleSave = () => {
    const updates: Partial<StyleDefinition> = { name };

    if (style.type === "color") {
      updates.fills = fills;
    } else if (style.type === "text") {
      updates.fontFamily = fontFamily;
      updates.fontSize = fontSize;
      updates.fontWeight = fontWeight;
      updates.lineHeight = lineHeight;
      updates.letterSpacing = letterSpacing;
    } else if (style.type === "effect") {
      updates.effects = effects;
    }

    onSave(updates);
    onClose();
  };

  return (
    <div className="style-dialog-overlay" onClick={onClose}>
      <div className="style-dialog style-dialog-lg" onClick={(e) => e.stopPropagation()}>
        <div className="style-dialog-header">
          <span>Edit Style: {style.name}</span>
          <button className="style-dialog-close" onClick={onClose}>×</button>
        </div>
        <div className="style-dialog-body">
          <div className="style-dialog-field">
            <label>Name</label>
            <input className="prop-input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          {style.type === "color" && (
            <div className="style-dialog-section">
              <label>Color Fills</label>
              {fills.map((fill, i) => (
                <div key={i} className="style-fill-row">
                  <div className="color-swatch" style={{ background: fill.color }}>
                    <input
                      type="color"
                      value={fill.color}
                      onChange={(e) => {
                        const next = [...fills];
                        next[i] = { ...next[i], color: e.target.value };
                        setFills(next);
                      }}
                    />
                  </div>
                  <input
                    className="prop-input"
                    value={fill.color}
                    onChange={(e) => {
                      const next = [...fills];
                      next[i] = { ...next[i], color: e.target.value };
                      setFills(next);
                    }}
                  />
                  <input
                    className="prop-range"
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={fill.opacity}
                    onChange={(e) => {
                      const next = [...fills];
                      next[i] = { ...next[i], opacity: Number(e.target.value) };
                      setFills(next);
                    }}
                  />
                  <button
                    className="style-btn style-btn-danger"
                    onClick={() => setFills(fills.filter((_, j) => j !== i))}
                  >
                    <TrashIcon />
                  </button>
                </div>
              ))}
              <button
                className="style-add-btn"
                onClick={() => setFills([...fills, { color: "#6366f1", opacity: 1 }])}
              >
                <PlusIcon /> Add Fill
              </button>
            </div>
          )}

          {style.type === "text" && (
            <div className="style-dialog-section">
              <label>Typography</label>
              <div className="style-dialog-field">
                <span className="prop-label">Font Family</span>
                <input className="prop-input" value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} placeholder="Inter, sans-serif" />
              </div>
              <div className="style-dialog-field">
                <span className="prop-label">Font Size</span>
                <input className="prop-input" type="number" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} />
              </div>
              <div className="style-dialog-field">
                <span className="prop-label">Font Weight</span>
                <select className="prop-select" value={fontWeight} onChange={(e) => setFontWeight(e.target.value)}>
                  <option value="100">Thin</option>
                  <option value="300">Light</option>
                  <option value="normal">Regular</option>
                  <option value="500">Medium</option>
                  <option value="600">Semi</option>
                  <option value="bold">Bold</option>
                  <option value="900">Black</option>
                </select>
              </div>
              <div className="style-dialog-field">
                <span className="prop-label">Line Height</span>
                <input className="prop-input" type="number" step={0.1} value={lineHeight} onChange={(e) => setLineHeight(Number(e.target.value))} />
              </div>
              <div className="style-dialog-field">
                <span className="prop-label">Letter Spacing (px/1000)</span>
                <input className="prop-input" type="number" value={letterSpacing} onChange={(e) => setLetterSpacing(Number(e.target.value))} />
              </div>
            </div>
          )}

          {style.type === "effect" && (
            <div className="style-dialog-section">
              <label>Effects</label>
              {effects.map((effect, i) => (
                <div key={i} className="style-effect-row">
                  <select
                    className="prop-select"
                    value={effect.type}
                    onChange={(e) => {
                      const next = [...effects];
                      next[i] = { ...next[i], type: e.target.value as any };
                      setEffects(next);
                    }}
                  >
                    <option value="shadow">Shadow</option>
                    <option value="blur">Blur</option>
                    <option value="glow">Glow</option>
                  </select>
                  <div className="style-effect-props">
                    <input
                      className="prop-input"
                      type="number"
                      placeholder="blur"
                      value={effect.props.blur || 0}
                      onChange={(e) => {
                        const next = [...effects];
                        next[i] = { ...next[i], props: { ...next[i].props, blur: Number(e.target.value) } };
                        setEffects(next);
                      }}
                    />
                    <input
                      className="prop-input"
                      type="number"
                      placeholder="offsetX"
                      value={effect.props.offsetX || 0}
                      onChange={(e) => {
                        const next = [...effects];
                        next[i] = { ...next[i], props: { ...next[i].props, offsetX: Number(e.target.value) } };
                        setEffects(next);
                      }}
                    />
                    <input
                      className="prop-input"
                      type="number"
                      placeholder="offsetY"
                      value={effect.props.offsetY || 0}
                      onChange={(e) => {
                        const next = [...effects];
                        next[i] = { ...next[i], props: { ...next[i].props, offsetY: Number(e.target.value) } };
                        setEffects(next);
                      }}
                    />
                  </div>
                  <button
                    className="style-btn style-btn-danger"
                    onClick={() => setEffects(effects.filter((_, j) => j !== i))}
                  >
                    <TrashIcon />
                  </button>
                </div>
              ))}
              <button
                className="style-add-btn"
                onClick={() =>
                  setEffects([
                    ...effects,
                    { type: "shadow", props: { color: "rgba(0,0,0,0.3)", blur: 10, offsetX: 0, offsetY: 4 } },
                  ])
                }
              >
                <PlusIcon /> Add Effect
              </button>
            </div>
          )}
        </div>
        <div className="style-dialog-footer">
          <button className="style-dialog-btn" onClick={onClose}>Cancel</button>
          <button className="style-dialog-btn style-dialog-btn-primary" onClick={handleSave}>
            Save & Update Linked
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main StylesPanel ──────────────────────────────────────────────
export function StylesPanel({
  selectedObj,
  fabricRef,
  onStyleChange,
  styles,
  onStylesChange,
  onStyleEdited,
}: StylesPanelProps) {
  const [activeTab, setActiveTab] = useState<StyleTab>("color");
  const [showCreate, setShowCreate] = useState(false);
  const [editingStyle, setEditingStyle] = useState<StyleDefinition | null>(null);
  const [, tick] = useState(0);
  const force = () => tick((n) => n + 1);

  // Track which style is linked to the selected object
  const linkedStyleId = selectedObj ? (selectedObj as any).styleId : undefined;

  // Filter styles by active tab
  const filteredStyles = styles.filter((s) => s.type === activeTab);

  // ── Apply style to selected object ──
  const handleApply = useCallback(
    (style: StyleDefinition) => {
      if (!selectedObj) return;
      const c = fabricRef.current;
      if (!c) return;

      applyStyleToObject(selectedObj, style);
      (selectedObj as any).styleId = style.id;

      c.renderAll();
      onStyleChange?.();
      force();
    },
    [selectedObj, fabricRef, onStyleChange],
  );

  // ── Detach style from selected object ──
  const handleDetach = useCallback(() => {
    if (!selectedObj) return;
    delete (selectedObj as any).styleId;
    fabricRef.current?.renderAll();
    onStyleChange?.();
    force();
  }, [selectedObj, fabricRef, onStyleChange]);

  // ── Create style from selected object ──
  const handleCreate = useCallback(
    (req: CreateStyleRequest) => {
      const now = new Date().toISOString();
      const newStyle: StyleDefinition = {
        id: `style_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: req.name,
        type: req.type,
        fills: req.fills,
        fontFamily: req.fontFamily,
        fontSize: req.fontSize,
        fontWeight: req.fontWeight,
        lineHeight: req.lineHeight,
        letterSpacing: req.letterSpacing,
        effects: req.effects,
        metadata: { createdAt: now, updatedAt: now },
      };

      const updated = [...styles, newStyle];
      onStylesChange(updated);
      onStyleChange?.();

      // If we have a selected object, also link it
      if (selectedObj) {
        (selectedObj as any).styleId = newStyle.id;
        fabricRef.current?.renderAll();
      }
    },
    [styles, selectedObj, fabricRef, onStylesChange, onStyleChange],
  );

  // ── Edit style (propagate to all linked objects) ──
  const handleSaveEdit = useCallback(
    (updates: Partial<StyleDefinition>) => {
      if (!editingStyle) return;
      const c = fabricRef.current;
      if (!c) return;

      const updatedStyle: StyleDefinition = {
        ...editingStyle,
        ...updates,
        metadata: { ...editingStyle.metadata, updatedAt: new Date().toISOString() },
      };

      const updatedStyles = styles.map((s) => (s.id === updatedStyle.id ? updatedStyle : s));
      onStylesChange(updatedStyles);

      // Propagate to all linked objects on canvas
      for (const obj of c.getObjects()) {
        if ((obj as any).styleId === updatedStyle.id) {
          applyStyleToObject(obj, updatedStyle);
        }
      }
      c.renderAll();

      onStyleEdited?.(updatedStyle);
      onStyleChange?.();
      setEditingStyle(null);
    },
    [editingStyle, styles, fabricRef, onStylesChange, onStyleEdited, onStyleChange],
  );

  // ── Delete style ──
  const handleDelete = useCallback(
    (styleId: string) => {
      const updated = styles.filter((s) => s.id !== styleId);
      onStylesChange(updated);

      // Detach from all objects
      const c = fabricRef.current;
      if (c) {
        for (const obj of c.getObjects()) {
          if ((obj as any).styleId === styleId) {
            delete (obj as any).styleId;
          }
        }
        c.renderAll();
      }

      onStyleChange?.();
    },
    [styles, fabricRef, onStylesChange, onStyleChange],
  );

  return (
    <div className="styles-panel">
      <div className="sidebar-header">
        <span>Styles</span>
        <button
          className="styles-add-btn"
          title="Create new style"
          onClick={() => setShowCreate(true)}
        >
          <PlusIcon />
        </button>
      </div>

      {/* Tabs */}
      <div className="styles-tabs">
        {(["color", "text", "effect"] as const).map((tab) => (
          <button
            key={tab}
            className={`styles-tab ${activeTab === tab ? "active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
            <span className="styles-tab-count">{styles.filter((s) => s.type === tab).length}</span>
          </button>
        ))}
      </div>

      {/* Style List */}
      <div className="styles-list">
        {filteredStyles.length === 0 ? (
          <div className="styles-empty">
            No {activeTab} styles yet.
            <br />
            <button className="styles-empty-btn" onClick={() => setShowCreate(true)}>
              Create one
            </button>
          </div>
        ) : (
          filteredStyles.map((style) => (
            <StyleCard
              key={style.id}
              style={style}
              isActive={linkedStyleId === style.id}
              isLinked={linkedStyleId === style.id}
              onApply={() => handleApply(style)}
              onDetach={handleDetach}
              onEdit={() => setEditingStyle(style)}
              onDelete={() => handleDelete(style.id)}
            />
          ))
        )}
      </div>

      {/* Create Dialog */}
      {showCreate && (
        <CreateStyleDialog
          initialType={activeTab}
          selectedObj={selectedObj}
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}

      {/* Edit Dialog */}
      {editingStyle && (
        <EditStyleDialog
          style={editingStyle}
          onClose={() => setEditingStyle(null)}
          onSave={handleSaveEdit}
        />
      )}
    </div>
  );
}

// ── Utility: Apply style properties to a Fabric.js object ────────
export function applyStyleToObject(obj: fabric.FabricObject, style: StyleDefinition) {
  if (style.type === "color" && style.fills?.length) {
    const primary = style.fills[0];
    obj.set("fill", primary.color);
    if (primary.opacity !== undefined) obj.set("opacity", primary.opacity);
  }

  if (style.type === "text") {
    const isText = obj.type === "textbox" || obj.type === "i-text";
    if (!isText) return; // Only apply text styles to text objects

    if (style.fontFamily) obj.set("fontFamily", style.fontFamily);
    if (style.fontSize) obj.set("fontSize", style.fontSize);
    if (style.fontWeight) obj.set("fontWeight", style.fontWeight);
    if (style.lineHeight) obj.set("lineHeight", style.lineHeight);
    if (style.letterSpacing !== undefined) obj.set("charSpacing", style.letterSpacing);
  }

  if (style.type === "effect" && style.effects?.length) {
    const primaryShadow = style.effects.find((e) => e.type === "shadow");
    if (primaryShadow) {
      const shadow = new fabric.Shadow({
        color: primaryShadow.props.color || "rgba(0,0,0,0.3)",
        blur: primaryShadow.props.blur || 0,
        offsetX: primaryShadow.props.offsetX || 0,
        offsetY: primaryShadow.props.offsetY || 0,
      });
      obj.set("shadow", shadow);
    }

    // Blur effect via image filters (only for images)
    const blurEffect = style.effects.find((e) => e.type === "blur");
    if (blurEffect && obj.type === "image") {
      const img = obj as fabric.FabricImage;
      const existingFilters = img.filters || [];
      const hasBlur = existingFilters.some((f) => f instanceof fabric.filters.Blur);
      if (!hasBlur && blurEffect.props.blur) {
        img.filters = [...existingFilters, new fabric.filters.Blur({ blur: blurEffect.props.blur })];
        img.applyFilters();
      }
    }
  }
}
