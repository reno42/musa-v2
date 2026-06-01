import { useState, useCallback, useRef, useEffect } from "react";
import type { FabricObject, Canvas } from "fabric";
import { Gradient, Shadow } from "fabric";
import { GoogleFontPicker } from "./GoogleFontPicker";

interface PropertiesPanelProps {
  selectedObjects: FabricObject[];
  onUpdate?: () => void;
  canvasRef?: React.RefObject<Canvas | null>;
}

const em = (n: number) => `${Math.round(n)}`;

export function PropertiesPanel({ selectedObjects, onUpdate, canvasRef }: PropertiesPanelProps) {
  // Track last committed object identity for key-based reset
  const lastObjRef = useRef<any>(null);
  // Use a reset key to remount inputs when selection changes
  const [resetKey, setResetKey] = useState(0);

  const obj = (selectedObjects && selectedObjects.length > 0) ? selectedObjects[0] as any : null;

  // Detect object change and trigger key reset
  if (obj !== lastObjRef.current) {
    lastObjRef.current = obj;
    // Schedule key bump after render
    if (obj) {
      Promise.resolve().then(() => setResetKey(k => k + 1));
    }
  }

  const commit = useCallback((prop: string, value: any) => {
    if (!obj) return;
    obj.set(prop as any, value);
    obj.setCoords();
    obj.canvas?.requestRenderAll();
    onUpdate?.();
  }, [obj, onUpdate]);

  const commitCanvas = useCallback((prop: string, value: any) => {
    const canvas = canvasRef?.current;
    if (!canvas) return;
    (canvas as any).set(prop, value);
    canvas.requestRenderAll();
    onUpdate?.();
  }, [canvasRef, onUpdate]);

  const commitScale = useCallback((prop: string, scaleKey: string, newValue: number) => {
    if (!obj) return;
    const cur = obj[prop] ?? 0;
    if (cur === 0) return;
    const s = newValue / cur;
    obj.set(scaleKey as any, s);
    obj.setCoords();
    obj.canvas?.requestRenderAll();
    onUpdate?.();
  }, [obj, onUpdate]);

  // Canvas-level properties when nothing is selected
  if (!obj) {
    const canvas = canvasRef?.current;
    if (canvas) {
      const bg = (canvas as any).backgroundColor || "transparent";
      return (
        <div style={panelStyle}>
          <div style={propsHeaderStyle}>
            <span>Canvas</span>
          </div>
          <Section label="Background">
            <div style={{ padding: "0 10px 6px", display: "flex", gap: 6 }}>
              <input
                type="color"
                aria-label="Canvas background color"
                defaultValue={typeof bg === "string" && bg.startsWith("#") ? bg : "#ffffff"}
                onChange={e => commitCanvas("backgroundColor", e.target.value)}
                style={{ width: 28, height: 26, border: "1px solid #1c1c26", borderRadius: 4, cursor: "pointer" }}
              />
              <input
                aria-label="Canvas background hex"
                defaultValue={bg === "transparent" ? "#ffffff" : bg}
                onChange={e => commitCanvas("backgroundColor", e.target.value)}
                style={inputStyle}
              />
            </div>
          </Section>
          <Section label="Dimensions">
            <Row label="W" defaultValue={em((canvas as any).width || 1080)} onChange={v => commitCanvas("width", Number(v))} />
            <Row label="H" defaultValue={em((canvas as any).height || 1080)} onChange={v => commitCanvas("height", Number(v))} />
          </Section>
        </div>
      );
    }
    return (
      <div style={panelStyle}>
        <div style={emptyStateStyle}>
          Select an object to edit properties
        </div>
      </div>
    );
  }

  // Compute all field values directly from the canvas object
  const fieldX = em(obj.left ?? 0);
  const fieldY = em(obj.top ?? 0);
  const fieldW = em((obj.width ?? 0) * (obj.scaleX ?? 1));
  const fieldH = em((obj.height ?? 0) * (obj.scaleY ?? 1));
  const fieldAngle = em(obj.angle ?? 0);
  const fieldOpacity = String(obj.opacity ?? 1);
  const fieldFill = typeof obj.fill === "string" ? obj.fill : "#cccccc";
  const fieldStroke = typeof obj.stroke === "string" ? obj.stroke : "transparent";
  const fieldStrokeW = String(obj.strokeWidth ?? 1);
  const fieldRx = em(obj.rx ?? obj.ry ?? 0);
  const fieldText = obj.text ?? "";
  const fieldFontSize = String(obj.fontSize ?? 24);
  const fieldFontFamily = obj.fontFamily ?? "Inter";
  const fieldFontWeight = String(obj.fontWeight ?? 400);
  const fieldFontStyle = obj.fontStyle ?? "normal";
  const fieldLocked = !!(obj.lockMovementX);
  const fieldVisible = obj.visible !== false;
  const fieldName = obj.layerName ?? obj.name ?? "";
  const fieldZIndex = String((obj.canvas?.getObjects() || []).indexOf(obj));
  const fieldLetterSpacing = String(obj.charSpacing ?? 0);
  const fieldLineHeight = String(obj.lineHeight ?? 1.2);
  const fieldUnderline = obj.underline ?? false;

  // Shadow helpers
  const hasShadow = !!(obj.shadow);
  const fieldShadowColor = obj.shadow?.color ?? "#000000";
  const fieldShadowBlur = String(obj.shadow?.blur ?? 0);
  const fieldShadowX = String(obj.shadow?.offsetX ?? 0);
  const fieldShadowY = String(obj.shadow?.offsetY ?? 0);

  const isTextType = obj.type === "text" || obj.type === "i-text" || obj.type === "IText" || obj.type === "Textbox" || obj.type === "textbox";
  const isRectType = obj.type === "rect" || obj.type === "Rect" || (obj as any).isFrameVisual;
  const isFrameType = !!(obj as any).isFrameVisual;
  const frameObjCount = isFrameType ? ((obj as any).canvas?.getObjects().filter((o: any) => o.frameId === (obj as any).frameId && !o.isFrameVisual).length || 0) : 0;

  return (
    <div key={resetKey} style={panelStyle}>
      {/* Header */}
      <div style={propsHeaderStyle}>
        <span>{isFrameType ? "Frame" : (obj.type || "Object")}{isFrameType ? ` (${frameObjCount} objects)` : ""}</span>
        <span style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            aria-label={fieldVisible ? "Hide object" : "Show object"}
            onClick={() => { commit("visible", !fieldVisible); }}
            style={iconBtn()}
          >
            👁
          </button>
          <button
            type="button"
            aria-label={fieldLocked ? "Unlock object" : "Lock object"}
            onClick={() => {
              const nv = !fieldLocked;
              commit("lockMovementX", nv);
              commit("lockMovementY", nv);
              commit("selectable", !nv);
            }}
            style={iconBtn()}
          >
            🔒
          </button>
        </span>
      </div>

      {/* Frame Name */}
      {isFrameType && (
        <Section label="Frame Name">
          <div style={{ padding: "0 10px 6px" }}>
            <input
              aria-label="Frame name"
              key={`fname-${resetKey}`}
              defaultValue={(obj as any).frameName || ""}
              onBlur={e => {
                const val = e.target.value.trim();
                if (val) {
                  commit("frameName", val);
                  commit("layerName", val);
                }
              }}
              style={inputStyle}
            />
          </div>
        </Section>
      )}

      {/* Background (Frame) */}
      {isFrameType && (
        <Section label="Background">
          <div style={{ padding: "0 10px 6px", display: "flex", gap: 6 }}>
            <input
              type="color"
              aria-label="Frame background color"
              key={`fbgcolor-${resetKey}`}
              defaultValue={(obj as any).frameFill || "#ffffff"}
              onChange={e => {
                commit("frameFill", e.target.value);
                commit("fill", e.target.value);
              }}
              style={{ width: 28, height: 26, border: "1px solid #1c1c26", borderRadius: 4, cursor: "pointer" }}
            />
            <input
              aria-label="Frame background hex"
              key={`fbghex-${resetKey}`}
              defaultValue={(obj as any).frameFill || "#ffffff"}
              onChange={e => {
                commit("frameFill", e.target.value);
                commit("fill", e.target.value);
              }}
              style={inputStyle}
            />
          </div>
        </Section>
      )}

      {/* Border (Frame) */}
      {isFrameType && (
        <Section label="Border">
          <div style={{ padding: "0 10px 0" }}>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="color"
                aria-label="Frame border color"
                key={`fscolor-${resetKey}`}
                defaultValue={(obj as any).frameStroke || "#6366f1"}
                onChange={e => {
                  commit("frameStroke", e.target.value);
                  commit("stroke", e.target.value);
                }}
                style={{ width: 28, height: 26, border: "1px solid #1c1c26", borderRadius: 4, cursor: "pointer" }}
              />
              <input
                aria-label="Frame border hex"
                key={`fshex-${resetKey}`}
                defaultValue={(obj as any).frameStroke || "#6366f1"}
                onChange={e => {
                  commit("frameStroke", e.target.value);
                  commit("stroke", e.target.value);
                }}
                style={inputStyle}
              />
            </div>
            <Row label="Width" defaultValue={fieldStrokeW} onChange={v => commit("strokeWidth", Number(v))} />
          </div>
        </Section>
      )}

      {/* Position & Size */}
      <Section label="Position & Size">
        <Row label="X" defaultValue={fieldX} onChange={v => commit("left", Number(v))} />
        <Row label="Y" defaultValue={fieldY} onChange={v => commit("top", Number(v))} />
        <Row label="W" defaultValue={fieldW} onChange={v => commitScale("width", "scaleX", Number(v))} />
        <Row label="H" defaultValue={fieldH} onChange={v => commitScale("height", "scaleY", Number(v))} />
        <Row label="R" defaultValue={fieldAngle} onChange={v => commit("angle", Number(v))} />
        <Row label="Opacity" defaultValue={fieldOpacity} onChange={v => commit("opacity", Math.min(1, Math.max(0, Number(v))))} />
        <Row label="Z-Idx" defaultValue={fieldZIndex} onChange={v => {
          const idx = parseInt(v, 10);
          if (isNaN(idx)) return;
          const objs = obj.canvas?.getObjects() || [];
          const curIdx = objs.indexOf(obj);
          if (curIdx === -1 || idx === curIdx) return;
          const clamped = Math.max(0, Math.min(idx, objs.length - 1));
          if (clamped > curIdx) {
            for (let i = curIdx; i < clamped; i++) obj.canvas?.moveTo(obj, i + 1);
          } else {
            for (let i = curIdx; i > clamped; i--) obj.canvas?.moveTo(obj, i - 1);
          }
          onUpdate?.();
        }} />
      </Section>

      {/* Layer Name */}
      <Section label="Layer Name">
        <div style={{ padding: "0 10px 6px" }}>
          <input
            key={`name-${resetKey}`}
            aria-label="Layer name"
            defaultValue={fieldName}
            onBlur={e => { commit("layerName", e.target.value || undefined); }}
            style={inputStyle}
          />
        </div>
      </Section>

      {/* Fill (hidden for frames) */}
      {!isFrameType && (
        <Section label="Fill">
          <div style={{ padding: "0 10px 6px", display: "flex", gap: 6 }}>
            <input
              type="color"
              aria-label="Fill color"
              key={`fillcolor-${resetKey}`}
              defaultValue={fieldFill.match(/^#[0-9a-fA-F]{6}$/) ? fieldFill : "#000000"}
              onChange={e => commit("fill", e.target.value)}
              style={{ width: 28, height: 26, border: "1px solid #1c1c26", borderRadius: 4, cursor: "pointer" }}
            />
            <input
              aria-label="Fill color hex"
              key={`fillhex-${resetKey}`}
              defaultValue={fieldFill}
              onChange={e => commit("fill", e.target.value)}
              style={inputStyle}
            />
          </div>
        </Section>
      )}

      {/* Stroke (hidden for frames) */}
      {!isFrameType && (
        <Section label="Stroke">
          <div style={{ padding: "0 10px 0" }}>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="color"
                aria-label="Stroke color"
                key={`strokecolor-${resetKey}`}
                defaultValue={fieldStroke.match(/^#[0-9a-fA-F]{6}$/) ? fieldStroke : "#000000"}
                onChange={e => commit("stroke", e.target.value)}
                style={{ width: 28, height: 26, border: "1px solid #1c1c26", borderRadius: 4, cursor: "pointer" }}
            />
            <input
              aria-label="Stroke color hex"
              key={`strokehex-${resetKey}`}
              defaultValue={fieldStroke}
              onChange={e => commit("stroke", e.target.value)}
              style={inputStyle}
            />
          </div>
          <Row label="Width" defaultValue={fieldStrokeW} onChange={v => commit("strokeWidth", Number(v))} />
        </div>
      </Section>
      )}

      {/* Gradient (hidden for frames) */}
      {!isFrameType && (
        <Section label="Gradient">
          <GradientEditor obj={obj} commit={commit} resetKey={resetKey} />
        </Section>
      )}

      {/* Shadow — text objects */}
      {isTextType && (
        <Section label="Shadow">
          <ShadowEditor obj={obj} commit={commit} resetKey={resetKey} hasShadow={hasShadow} fieldShadowColor={fieldShadowColor} fieldShadowBlur={fieldShadowBlur} fieldShadowX={fieldShadowX} fieldShadowY={fieldShadowY} />
        </Section>
      )}

      {/* Shadow — rect/circle/path objects */}
      {!isTextType && !isFrameType && (
        <Section label="Box Shadow">
          <ShadowEditor obj={obj} commit={commit} resetKey={resetKey} hasShadow={hasShadow} fieldShadowColor={fieldShadowColor} fieldShadowBlur={fieldShadowBlur} fieldShadowX={fieldShadowX} fieldShadowY={fieldShadowY} />
        </Section>
      )}

      {/* Corner Radius (rect only) */}
      {isRectType && (
        <Section label="Corner Radius">
          <Row label="Radius" defaultValue={fieldRx} onChange={v => { commit("rx", Number(v)); commit("ry", Number(v)); }} />
        </Section>
      )}

      {/* Text Properties */}
      {isTextType && (
        <Section label="Text">
          <div style={{ padding: "0 10px 6px" }}>
            <textarea
              aria-label="Text content"
              key={`text-${resetKey}`}
              defaultValue={fieldText}
              onBlur={e => commit("text", e.target.value)}
              style={{ ...inputStyle, height: 60, resize: "vertical" }}
            />
          </div>
          <Row label="Size" defaultValue={fieldFontSize} onChange={v => commit("fontSize", Number(v))} />
          <div style={{ padding: "0 10px 4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: "#7a7a90", flex: "0 0 40px", textAlign: "right" }}>Font</span>
              <GoogleFontPicker value={fieldFontFamily} onChange={v => commit("fontFamily", v)} />
            </div>
          </div>
          <div style={{ padding: "0 10px 4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#7a7a90", flex: "0 0 40px", textAlign: "right" }}>Weight</span>
              <select
                defaultValue={fieldFontWeight}
                onChange={e => commit("fontWeight", Number(e.target.value))}
                style={selectStyle}
              >
                {[100, 200, 300, 400, 500, 600, 700, 800, 900].map(w => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ padding: "0 10px 4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#7a7a90", flex: "0 0 40px", textAlign: "right" }}>Style</span>
              <select
                defaultValue={fieldFontStyle}
                onChange={e => commit("fontStyle", e.target.value)}
                style={selectStyle}
              >
                <option value="normal">Normal</option>
                <option value="italic">Italic</option>
              </select>
            </div>
          </div>
          <div style={{ padding: "0 10px 4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#7a7a90", flex: "0 0 40px", textAlign: "right" }}>Deco</span>
              <button
                type="button"
                onClick={() => commit("underline", !fieldUnderline)}
                style={{
                  flex: 1, padding: "3px 6px", borderRadius: 4, fontSize: 12, cursor: "pointer",
                  background: fieldUnderline ? "#2a4a2a" : "#111118",
                  border: fieldUnderline ? "1px solid #4ade80" : "1px solid #1c1c26",
                  color: fieldUnderline ? "#4ade80" : "#7a7a90",
                  textDecoration: "underline",
                }}
              >
                Underline
              </button>
            </div>
          </div>
          <Row label="Spacing" defaultValue={fieldLetterSpacing} onChange={v => commit("charSpacing", Number(v))} />
          <Row label="Ln-Ht" defaultValue={fieldLineHeight} onChange={v => commit("lineHeight", Math.max(0.5, Math.min(4, Number(v))))} />
        </Section>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ borderBottom: "1px solid #1c1c26" }}>
      <button
        type="button"
        aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
        onClick={() => setOpen(!open)}
        style={sectionHeaderStyle}
      >
        {label} <span>{open ? "▾" : "▸"}</span>
      </button>
      {open && children}
    </div>
  );
}

function Row({ label, defaultValue, onChange }: { label: string; defaultValue: string; onChange: (v: string) => void }) {
  return (
    <div style={rowStyle}>
      <span style={rowLabelStyle}>{label}</span>
      <input
        aria-label={label}
        defaultValue={defaultValue}
        onBlur={e => onChange(e.target.value)}
        style={inputStyle}
      />
    </div>
  );
}

// ── Gradient Editor ─────────────────────────────────────────

function GradientEditor({ obj, commit, resetKey }: { obj: any; commit: (prop: string, value: any) => void; resetKey: number }) {
  const fill = obj?.fill;
  const isGradient = fill && typeof fill === "object" && fill.type && fill.colorStops;
  const gradType = isGradient ? fill.type : "none";

  const applyGradient = (type: string) => {
    if (type === "none") { commit("fill", "#cccccc"); return; }
    const coords = type === "radial"
      ? { x1: 0.5, y1: 0.5, r1: 0, x2: 0.5, y2: 0.5, r2: 0.5 }
      : { x1: 0, y1: 0, x2: 1, y2: 1 };
    commit("fill", new Gradient({
      type: type as "linear" | "radial",
      gradientUnits: "percentage",
      coords,
      colorStops: [
        { offset: 0, color: "#4ade80" },
        { offset: 1, color: "#7c3aed" },
      ],
    }));
  };

  const updateStop = (i: number, color: string) => {
    if (!isGradient) return;
    const stops = [...fill.colorStops];
    stops[i] = { ...stops[i], color };
    commit("fill", new Gradient({ ...fill, colorStops: stops }));
  };

  const removeStop = (i: number) => {
    if (!isGradient) return;
    const stops = fill.colorStops.filter((_: any, j: number) => j !== i);
    if (stops.length < 2) { commit("fill", "#cccccc"); return; }
    commit("fill", new Gradient({ ...fill, colorStops: stops }));
  };

  const addStop = () => {
    if (!isGradient) return;
    const stops = [...fill.colorStops, { offset: 1, color: "#ffffff" }];
    stops.sort((a: any, b: any) => a.offset - b.offset);
    commit("fill", new Gradient({ ...fill, colorStops: stops }));
  };

  return (
    <div style={{ padding: "0 10px 6px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: "#7a7a90", flex: "0 0 40px", textAlign: "right" }}>Type</span>
        <select
          defaultValue={gradType}
          onChange={e => applyGradient(e.target.value)}
          style={selectStyle}
        >
          <option value="none">None</option>
          <option value="linear">Linear</option>
          <option value="radial">Radial</option>
        </select>
      </div>
      {isGradient && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {fill.colorStops.map((stop: any, i: number) => (
            <div key={`grad-${resetKey}-${i}`} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#7a7a90", minWidth: 30 }}>{Math.round(stop.offset * 100)}%</span>
              <input
                type="color"
                defaultValue={stop.color}
                onChange={e => updateStop(i, e.target.value)}
                style={{ width: 24, height: 22, border: "1px solid #1c1c26", borderRadius: 4, cursor: "pointer", background: "none", padding: 0 }}
              />
              <input
                defaultValue={stop.color}
                onBlur={e => updateStop(i, e.target.value)}
                style={{ flex: 1, background: "#111118", border: "1px solid #1c1c26", color: "#e4e4f0", borderRadius: 4, padding: "3px 6px", fontSize: 12, fontFamily: "monospace" }}
              />
              <button
                type="button"
                onClick={() => removeStop(i)}
                style={{ background: "none", border: "none", color: "#7a7a90", cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1 }}
                aria-label="Remove gradient stop"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addStop}
            style={{ background: "#1a2a1a", border: "1px solid #1c1c26", color: "#4ade80", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: 11 }}
          >
            + Add Stop
          </button>
        </div>
      )}
    </div>
  );
}

// ── Shadow Editor — text shadow / box shadow ────────────────

function ShadowEditor({ obj, commit, resetKey, hasShadow, fieldShadowColor, fieldShadowBlur, fieldShadowX, fieldShadowY }: {
  obj: any; commit: (prop: string, value: any) => void; resetKey: number;
  hasShadow: boolean; fieldShadowColor: string; fieldShadowBlur: string; fieldShadowX: string; fieldShadowY: string;
}) {
  const applyShadow = (enabled: boolean) => {
    if (!enabled) { commit("shadow", null); return; }
    commit("shadow", new Shadow({
      color: fieldShadowColor,
      blur: Number(fieldShadowBlur) || 4,
      offsetX: Number(fieldShadowX) || 2,
      offsetY: Number(fieldShadowY) || 2,
      affectStroke: false,
      nonScaling: false,
    }));
  };

  const updateShadow = (prop: string, val: string | number) => {
    const s = obj.shadow;
    if (!s) return;
    const update: any = { color: s.color, blur: s.blur, offsetX: s.offsetX, offsetY: s.offsetY, affectStroke: s.affectStroke, nonScaling: s.nonScaling };
    update[prop] = typeof val === "string" ? val : Number(val) || 0;
    commit("shadow", new Shadow(update));
  };

  return (
    <div style={{ padding: "0 10px 6px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <button
          type="button"
          onClick={() => applyShadow(!hasShadow)}
          style={{
            flex: 1, padding: "3px 6px", borderRadius: 4, fontSize: 12, cursor: "pointer",
            background: hasShadow ? "#2a4a2a" : "#111118",
            border: hasShadow ? "1px solid #4ade80" : "1px solid #1c1c26",
            color: hasShadow ? "#4ade80" : "#7a7a90",
          }}
        >
          {hasShadow ? "Enabled ✓" : "Disabled"}
        </button>
      </div>
      {hasShadow && (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
            <input
              type="color"
              defaultValue={fieldShadowColor}
              onChange={e => updateShadow("color", e.target.value)}
              style={{ width: 24, height: 22, border: "1px solid #1c1c26", borderRadius: 4, cursor: "pointer", background: "none", padding: 0 }}
            />
            <input
              defaultValue={fieldShadowColor}
              onBlur={e => updateShadow("color", e.target.value)}
              style={{ flex: 1, background: "#111118", border: "1px solid #1c1c26", color: "#e4e4f0", borderRadius: 4, padding: "3px 6px", fontSize: 12, fontFamily: "monospace" }}
            />
          </div>
          <Row label="Blur" defaultValue={fieldShadowBlur} onChange={v => updateShadow("blur", v)} />
          <Row label="X" defaultValue={fieldShadowX} onChange={v => updateShadow("offsetX", v)} />
          <Row label="Y" defaultValue={fieldShadowY} onChange={v => updateShadow("offsetY", v)} />
        </>
      )}
    </div>
  );
}

function iconBtn(): React.CSSProperties {
  return {
    background: "none", border: "1px solid #1c1c26", color: "#7a7a90",
    fontSize: 12, cursor: "pointer", borderRadius: 4, padding: "0 4px",
    lineHeight: "18px",
  };
}

const panelStyle: React.CSSProperties = {
  width: 240, height: "100%", background: "#0a0a0f", color: "#e4e4f0",
  fontFamily: "Inter, system-ui, sans-serif", fontSize: 12, overflowY: "auto",
  borderLeft: "1px solid #1c1c26",
};

const inputStyle: React.CSSProperties = {
  flex: 1, width: "100%", background: "#111118", border: "1px solid #1c1c26",
  color: "#e4e4f0", borderRadius: 4, padding: "3px 6px", fontSize: 12,
  fontFamily: "monospace",
};

const sectionHeaderStyle: React.CSSProperties = {
  width: "100%", padding: "5px 10px", fontSize: 12, color: "#5a5a70",
  textTransform: "uppercase", letterSpacing: 1, cursor: "pointer",
  display: "flex", justifyContent: "space-between", userSelect: "none",
  background: "none", border: "none", textAlign: "left",
};

const propsHeaderStyle: React.CSSProperties = {
  padding: "6px 10px", borderBottom: "1px solid #1c1c26",
  fontSize: 12, color: "#5a5a70", textTransform: "uppercase", letterSpacing: 1,
  display: "flex", justifyContent: "space-between",
};

const emptyStateStyle: React.CSSProperties = {
  padding: 20, color: "#666", fontSize: 12, textAlign: "center",
};

const rowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", padding: "2px 10px", gap: 6,
};

const rowLabelStyle: React.CSSProperties = {
  fontSize: 12, color: "#7a7a90", flex: "0 0 40px", textAlign: "right",
};

const selectStyle: React.CSSProperties = {
  flex: 1, background: "#111118", border: "1px solid #1c1c26",
  color: "#e4e4f0", borderRadius: 4, padding: "3px 6px", fontSize: 12,
};
