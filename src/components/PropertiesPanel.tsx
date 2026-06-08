import { useState, useCallback, useRef, useEffect } from "react";
import type { FabricObject, Canvas } from "fabric";
import { Gradient, Shadow, FabricImage } from "fabric";
import { GoogleFontPicker } from "./GoogleFontPicker";

interface PropertiesPanelProps {
  selectedObjects: FabricObject[];
  onUpdate?: () => void;
  canvasRef?: React.RefObject<Canvas | null>;
}

const em = (n: number) => {
  if (n == null || isNaN(n)) return "0";
  return parseFloat(n.toFixed(2)).toString();
};

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
  const fieldPadding = String(obj.padding ?? 0);
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
  const isImageType = obj.type === "image" || obj.type === "Image" || obj.type === "FabricImage";
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
          <div style={{ padding: "0 10px 6px" }}>
            <ColorPicker
              color={(obj as any).frameFill || "#ffffff"}
              onChange={v => { commit("frameFill", v); commit("fill", v); }}
              resetKey={resetKey}
            />
          </div>
        </Section>
      )}

      {/* Border (Frame) */}
      {isFrameType && (
        <Section label="Border">
          <div style={{ padding: "0 10px 0" }}>
            <ColorPicker
              color={(obj as any).frameStroke || "#6366f1"}
              onChange={v => { commit("frameStroke", v); commit("stroke", v); }}
              resetKey={resetKey}
            />
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
          <div style={{ padding: "0 10px 6px" }}>
            <ColorPicker
              color={fieldFill.match(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/) ? fieldFill : "#000000"}
              onChange={v => commit("fill", v)}
              resetKey={resetKey}
            />
          </div>
        </Section>
      )}

      {/* Stroke (hidden for frames) */}
      {!isFrameType && (
        <Section label="Stroke">
          <div style={{ padding: "0 10px 0" }}>
            <ColorPicker
              color={fieldStroke.match(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/) ? fieldStroke : "#000000"}
              onChange={v => commit("stroke", v)}
              resetKey={resetKey}
            />
          <Row label="Width" defaultValue={fieldStrokeW} onChange={v => commit("strokeWidth", Number(v))} />
          <Row label="Dash" defaultValue={(obj as any).strokeDashArray?.join(",") || ""} onChange={v => {
            const arr = v ? v.split(",").map(Number).filter(n => !isNaN(n) && n >= 0) : null;
            commit("strokeDashArray", arr && arr.length > 0 ? arr : null);
          }} />
        </div>
      </Section>
      )}

      {/* Blend Mode (hidden for frames) */}
      {!isFrameType && (
        <Section label="Blend Mode">
          <div style={{ padding: "0 10px 6px" }}>
            <select
              defaultValue={(obj as any).globalCompositeOperation || "source-over"}
              onChange={e => commit("globalCompositeOperation", e.target.value)}
              style={selectStyle}
            >
              <option value="source-over">Normal</option>
              <option value="multiply">Multiply</option>
              <option value="screen">Screen</option>
              <option value="overlay">Overlay</option>
              <option value="darken">Darken</option>
              <option value="lighten">Lighten</option>
              <option value="color-dodge">Color Dodge</option>
              <option value="color-burn">Color Burn</option>
              <option value="difference">Difference</option>
              <option value="exclusion">Exclusion</option>
            </select>
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

      {/* Blur */}
      {!isFrameType && (
        <Section label="Blur">
          <BlurEditor obj={obj} commit={commit} resetKey={resetKey} />
        </Section>
      )}

      {/* Image Filters — only for image objects */}
      {isImageType && (
        <Section label="Filters">
          <ImageFiltersEditor obj={obj} resetKey={resetKey} />
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
          {/* Text Alignment */}
          <div style={{ padding: "0 10px 4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#7a7a90", flex: "0 0 40px", textAlign: "right" }}>Align</span>
              <div style={{ flex: 1, display: "flex", gap: 2 }}>
                {[
                  { value: "left", label: "\u2190" },
                  { value: "center", label: "\u2194" },
                  { value: "right", label: "\u2192" },
                  { value: "justify", label: "\u2261" },
                ].map(({ value, label }) => {
                  const active = (obj.textAlign || "left") === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      title={`Align ${value}`}
                      onClick={() => commit("textAlign", value)}
                      style={{
                        flex: 1, padding: "3px 4px", borderRadius: 4, fontSize: 13, cursor: "pointer",
                        background: active ? "#1a3a5c" : "#111118",
                        border: active ? "1px solid #3b82f6" : "1px solid #1c1c26",
                        color: active ? "#60a5fa" : "#7a7a90",
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <Row label="Spacing" defaultValue={fieldLetterSpacing} onChange={v => commit("charSpacing", Number(v))} />
          <Row label="Ln-Ht" defaultValue={fieldLineHeight} onChange={v => commit("lineHeight", Math.max(0.5, Math.min(4, Number(v))))} />
          <Row label="Pad" defaultValue={fieldPadding} onChange={v => commit("padding", Math.max(0, Math.min(100, Number(v))))} />
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

  // Derive angle from coords for linear gradients
  const getAngle = () => {
    if (!isGradient || gradType !== "linear") return 0;
    const c = fill.coords || {};
    const dx = (c.x2 ?? 1) - (c.x1 ?? 0);
    const dy = (c.y2 ?? 1) - (c.y1 ?? 0);
    return Math.round(Math.atan2(dy, dx) * 180 / Math.PI);
  };

  const angleToCoords = (deg: number) => {
    const rad = deg * Math.PI / 180;
    const cx = 0.5, cy = 0.5, r = 0.5;
    return {
      x1: cx - r * Math.cos(rad), y1: cy - r * Math.sin(rad),
      x2: cx + r * Math.cos(rad), y2: cy + r * Math.sin(rad),
    };
  };

  const applyGradient = (type: string) => {
    if (type === "none") { commit("fill", "#cccccc"); return; }
    const coords = type === "radial"
      ? { x1: 0.5, y1: 0.5, r1: 0, x2: 0.5, y2: 0.5, r2: 0.5 }
      : angleToCoords(135);
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

  const setAngle = (deg: number) => {
    if (!isGradient || gradType !== "linear") return;
    commit("fill", new Gradient({ ...fill, coords: angleToCoords(deg) }));
  };

  const updateStop = (i: number, color: string) => {
    if (!isGradient) return;
    const stops = [...fill.colorStops];
    stops[i] = { ...stops[i], color };
    commit("fill", new Gradient({ ...fill, colorStops: stops }));
  };

  const updateStopOffset = (i: number, offset: number) => {
    if (!isGradient) return;
    const stops = fill.colorStops.map((s: any, j: number) =>
      j === i ? { ...s, offset: Math.max(0, Math.min(1, offset)) } : s
    );
    stops.sort((a: any, b: any) => a.offset - b.offset);
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

  const angle = getAngle();

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
      {isGradient && gradType === "linear" && (
        <div style={{ marginBottom: 4 }}>
          <Row label="Angle" defaultValue={String(angle)} onChange={v => setAngle(Number(v))} />
        </div>
      )}
      {isGradient && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {fill.colorStops.map((stop: any, i: number) => (
            <div key={`grad-${resetKey}-${i}`} style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input
                key={`gradoff-${resetKey}-${i}`}
                defaultValue={String(Math.round(stop.offset * 100))}
                onBlur={e => updateStopOffset(i, Number(e.target.value) / 100)}
                style={{ width: 28, background: "#111118", border: "1px solid #1c1c26", color: "#7a7a90", borderRadius: 4, padding: "3px 2px", fontSize: 10, fontFamily: "monospace", textAlign: "center" }}
                title="Offset %"
              />
              <span style={{ fontSize: 10, color: "#5a5a70" }}>%</span>
              <input
                type="color"
                defaultValue={stop.color}
                onChange={e => updateStop(i, e.target.value)}
                style={{ width: 22, height: 20, border: "1px solid #1c1c26", borderRadius: 4, cursor: "pointer", background: "none", padding: 0 }}
              />
              <input
                defaultValue={stop.color}
                onBlur={e => updateStop(i, e.target.value)}
                style={{ flex: 1, background: "#111118", border: "1px solid #1c1c26", color: "#e4e4f0", borderRadius: 4, padding: "3px 4px", fontSize: 11, fontFamily: "monospace" }}
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

const SHADOW_PRESETS: { name: string; blur: number; offsetX: number; offsetY: number; color: string; opacity: number }[] = [
  { name: "Subtle", blur: 4, offsetX: 0, offsetY: 2, color: "#000000", opacity: 0.12 },
  { name: "Medium", blur: 8, offsetX: 0, offsetY: 4, color: "#000000", opacity: 0.2 },
  { name: "Strong", blur: 16, offsetX: 0, offsetY: 8, color: "#000000", opacity: 0.3 },
  { name: "Glow", blur: 20, offsetX: 0, offsetY: 0, color: "#6366f1", opacity: 0.5 },
];

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

  const applyPreset = (preset: typeof SHADOW_PRESETS[number]) => {
    const hex = preset.color + Math.round(preset.opacity * 255).toString(16).padStart(2, "0");
    commit("shadow", new Shadow({
      color: hex,
      blur: preset.blur,
      offsetX: preset.offsetX,
      offsetY: preset.offsetY,
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
      {/* Presets */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 6 }}>
        {SHADOW_PRESETS.map(p => (
          <button
            key={p.name}
            type="button"
            onClick={() => applyPreset(p)}
            title={`${p.name}: blur ${p.blur} offset ${p.offsetX},${p.offsetY} ${p.color} ${Math.round(p.opacity * 100)}%`}
            style={{
              flex: 1, padding: "2px 4px", borderRadius: 4, fontSize: 10, cursor: "pointer",
              background: "#111118", border: "1px solid #1c1c26", color: "#7a7a90",
              minWidth: 48,
            }}
          >
            {p.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => commit("shadow", null)}
          title="Remove shadow"
          style={{
            padding: "2px 4px", borderRadius: 4, fontSize: 10, cursor: "pointer",
            background: "#1a1111", border: "1px solid #2a1a1a", color: "#7a5a5a",
          }}
        >
          None
        </button>
      </div>
      {/* Toggle */}
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

// ── Blur Editor ────────────────────────────────────────────

function BlurEditor({ obj, commit, resetKey }: { obj: any; commit: (prop: string, value: any) => void; resetKey: number }) {
  // Fabric.js v6 stores blur as 0-1; we display as 0-50px
  const blurFilter = (obj.filters || []).find((f: any) => f?.type === 'Blur' || f?.constructor?.type === 'Blur');
  const hasBlur = !!blurFilter;
  const blurValue = blurFilter?.blur ? Math.round(blurFilter.blur * 50) : 0;

  const applyBlur = (enabled: boolean, value?: number) => {
    const otherFilters = (obj.filters || []).filter((f: any) => {
      const t = f?.type || f?.constructor?.type;
      return t !== 'Blur' && t !== 'blur';
    });
    if (!enabled) {
      obj.filters = otherFilters.length > 0 ? otherFilters : [];
      (obj as any).dirty = true;
      obj.canvas?.requestRenderAll();
      return;
    }
    const radius = (value ?? Math.max(1, blurValue)) / 50;
    try {
      const BlurClass = (FabricImage as any)?.filters?.Blur;
      if (BlurClass) {
        obj.filters = [...otherFilters, new BlurClass({ blur: Math.max(0.001, radius) })];
      }
    } catch { /* fallback: filter class not available */ }
    (obj as any).dirty = true;
    obj.canvas?.requestRenderAll();
  };

  const updateBlur = (value: number) => applyBlur(true, value);

  return (
    <div style={{ padding: "0 10px 6px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <button
          type="button"
          onClick={() => applyBlur(!hasBlur)}
          style={{
            flex: 1, padding: "3px 6px", borderRadius: 4, fontSize: 12, cursor: "pointer",
            background: hasBlur ? "#2a4a2a" : "#111118",
            border: hasBlur ? "1px solid #4ade80" : "1px solid #1c1c26",
            color: hasBlur ? "#4ade80" : "#7a7a90",
          }}
        >
          {hasBlur ? `Enabled \u2014 ${blurValue}px \u2713` : "Disabled"}
        </button>
      </div>
      {hasBlur && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="range"
            min={0} max={50} step={0.5}
            key={`blur-r-${resetKey}`}
            defaultValue={blurValue}
            onChange={e => updateBlur(Number(e.target.value))}
            style={{ flex: 1, accentColor: "#6366f1" }}
          />
          <input
            key={`blur-v-${resetKey}`}
            defaultValue={String(blurValue)}
            onBlur={e => {
              const v = Math.max(0, Math.min(50, Number(e.target.value) || 0));
              updateBlur(v);
            }}
            style={{ width: 40, background: "#111118", border: "1px solid #1c1c26", color: "#e4e4f0", borderRadius: 4, padding: "3px 4px", fontSize: 11, fontFamily: "monospace", textAlign: "center" }}
          />
          <span style={{ fontSize: 10, color: "#7a7a90" }}>px</span>
        </div>
      )}
    </div>
  );
}

// ── Image Filters Editor ───────────────────────────────────

const IMAGE_FILTER_PRESETS: { name: string; filters: { type: string; value?: number }[] }[] = [
  {
    name: "Grayscale",
    filters: [{ type: "Grayscale" }],
  },
  {
    name: "Sepia",
    filters: [{ type: "Sepia" }],
  },
  {
    name: "Vivid",
    filters: [
      { type: "Brightness", value: 0.1 },
      { type: "Contrast", value: 0.2 },
      { type: "Saturation", value: 0.5 },
    ],
  },
  {
    name: "Warm",
    filters: [
      { type: "HueRotation", value: 0.05 },
      { type: "Saturation", value: 0.15 },
    ],
  },
  {
    name: "Cool",
    filters: [
      { type: "HueRotation", value: -0.08 },
      { type: "Brightness", value: -0.05 },
    ],
  },
];

const FILTER_SLIDERS = [
  { type: "Brightness", label: "Brightness", min: -0.5, max: 0.5, step: 0.02, default: 0 },
  { type: "Contrast", label: "Contrast", min: -0.5, max: 0.5, step: 0.02, default: 0 },
  { type: "Saturation", label: "Saturation", min: -1, max: 1, step: 0.05, default: 0 },
  { type: "HueRotation", label: "Hue", min: -0.5, max: 0.5, step: 0.02, default: 0 },
  { type: "Blur", label: "Blur", min: 0, max: 0.3, step: 0.005, default: 0 },
];

function getFilterValue(obj: any, filterType: string): number {
  const f = (obj.filters || []).find((x: any) => x?.type === filterType || x?.constructor?.type === filterType);
  if (!f) return 0;
  const key = filterType === "HueRotation" ? "rotation" : filterType.toLowerCase();
  return f[key] ?? 0;
}

function setFilter(obj: any, filterType: string, value: number | undefined) {
  const filters = (obj.filters || []).filter((x: any) => {
    const t = x?.type || x?.constructor?.type;
    return t !== filterType;
  });
  if (value === undefined || value === 0) {
    // For slider types, remove if at default (except Sepia/Grayscale which are toggles)
    if (filterType === "Sepia" || filterType === "Grayscale") {
      // Don't remove — handled by presets
    }
  }
  if (value !== undefined && (value !== 0 || filterType === "Blur")) {
    try {
      const FilterClass = (FabricImage as any)?.filters?.[filterType];
      if (FilterClass) {
        const key = filterType === "HueRotation" ? "rotation" : filterType.toLowerCase();
        const params: any = { [key]: value };
        if (filterType === "Grayscale") params.mode = "average";
        if (filterType === "Invert") { params.alpha = false; params.invert = true; }
        filters.push(new FilterClass(params));
      }
    } catch { /* fallback */ }
  }
  obj.filters = filters;
  (obj as any).dirty = true;
  obj.canvas?.requestRenderAll();
}

function ImageFiltersEditor({ obj, resetKey }: { obj: any; resetKey: number }) {
  const applyPreset = (preset: typeof IMAGE_FILTER_PRESETS[number]) => {
    // Clear non-structural filters
    obj.filters = (obj.filters || []).filter((f: any) => {
      const t = f?.type || f?.constructor?.type;
      return !["Brightness", "Contrast", "Saturation", "HueRotation", "Blur", "Grayscale", "Sepia", "Invert"].includes(t);
    });
    for (const pf of preset.filters) {
      try {
        const FilterClass = (FabricImage as any)?.filters?.[pf.type];
        if (FilterClass) {
          const key = pf.type === "HueRotation" ? "rotation" : pf.type.toLowerCase();
          let params: any = { [key]: pf.value ?? 0 };
          if (pf.type === "Grayscale") params.mode = "average";
          if (pf.type === "Sepia") params = {};
          obj.filters.push(new FilterClass(params));
        }
      } catch { /* fallback */ }
    }
    (obj as any).dirty = true;
    obj.canvas?.requestRenderAll();
  };

  const hasAnyFilter = (obj.filters || []).some((f: any) => {
    const t = f?.type || f?.constructor?.type;
    return ["Brightness", "Contrast", "Saturation", "HueRotation", "Blur", "Grayscale", "Sepia", "Invert"].includes(t);
  });

  return (
    <div style={{ padding: "0 10px 6px" }}>
      {/* Presets */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 6 }}>
        {IMAGE_FILTER_PRESETS.map(p => (
          <button
            key={p.name}
            type="button"
            onClick={() => applyPreset(p)}
            title={p.name}
            style={{
              flex: 1, padding: "2px 4px", borderRadius: 4, fontSize: 10, cursor: "pointer",
              background: "#111118", border: "1px solid #1c1c26", color: "#7a7a90",
              minWidth: 44,
            }}
          >
            {p.name}
          </button>
        ))}
        {hasAnyFilter && (
          <button
            type="button"
            onClick={() => {
              obj.filters = (obj.filters || []).filter((f: any) => {
                const t = f?.type || f?.constructor?.type;
                return !["Brightness", "Contrast", "Saturation", "HueRotation", "Blur", "Grayscale", "Sepia", "Invert"].includes(t);
              });
              (obj as any).dirty = true;
              obj.canvas?.requestRenderAll();
            }}
            title="Reset all filters"
            style={{
              padding: "2px 4px", borderRadius: 4, fontSize: 10, cursor: "pointer",
              background: "#1a1111", border: "1px solid #2a1a1a", color: "#7a5a5a",
            }}
          >
            Reset
          </button>
        )}
      </div>

      {/* Sliders */}
      {FILTER_SLIDERS.map(s => {
        const cur = getFilterValue(obj, s.type);
        return (
          <div key={`ifl-${s.type}-${resetKey}`} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <span style={{ fontSize: 11, color: "#7a7a90", flex: "0 0 72px", textAlign: "right" }}>{s.label}</span>
            <input
              type="range"
              min={s.min} max={s.max} step={s.step}
              defaultValue={cur}
              onChange={e => setFilter(obj, s.type, Number(e.target.value))}
              style={{ flex: 1, accentColor: "#6366f1" }}
            />
            <span style={{ fontSize: 10, color: "#5a5a70", width: 32, textAlign: "right", fontFamily: "monospace" }}>
              {Math.round(cur * 100)}
            </span>
          </div>
        );
      })}

      {/* Toggle filters: Invert */}
      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
        <button
          type="button"
          onClick={() => {
            const hasInvert = (obj.filters || []).some((f: any) => (f?.type || f?.constructor?.type) === "Invert");
            if (hasInvert) {
              obj.filters = obj.filters.filter((f: any) => (f?.type || f?.constructor?.type) !== "Invert");
            } else {
              setFilter(obj, "Invert", 0); // Invert is a toggle, not a slider
            }
            (obj as any).dirty = true;
            obj.canvas?.requestRenderAll();
          }}
          style={{
            flex: 1, padding: "3px 6px", borderRadius: 4, fontSize: 11, cursor: "pointer",
            background: (obj.filters || []).some((f: any) => (f?.type || f?.constructor?.type) === "Invert") ? "#2a4a2a" : "#111118",
            border: (obj.filters || []).some((f: any) => (f?.type || f?.constructor?.type) === "Invert") ? "1px solid #4ade80" : "1px solid #1c1c26",
            color: (obj.filters || []).some((f: any) => (f?.type || f?.constructor?.type) === "Invert") ? "#4ade80" : "#7a7a90",
          }}
        >
          Invert
        </button>
      </div>
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

// ── Color Picker with hex/rgba toggle + alpha slider ────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("");
}

function ColorPicker({ color, onChange, resetKey }: { color: string; onChange: (v: string) => void; resetKey: number }) {
  const [mode, setMode] = useState<"hex" | "rgba">("hex");
  const alpha = color.length === 9 ? parseInt(color.slice(7, 9), 16) / 255 : 1;
  const rgb = hexToRgb(color);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="color"
          defaultValue={color.slice(0, 7)}
          onChange={e => onChange(e.target.value + (alpha < 1 ? Math.round(alpha * 255).toString(16).padStart(2, "0") : ""))}
          style={{ width: 28, height: 26, border: "1px solid #1c1c26", borderRadius: 4, cursor: "pointer", background: "none", padding: 0 }}
        />
        <input
          key={`cphex-${resetKey}`}
          defaultValue={color}
          onBlur={e => { const v = e.target.value.trim(); if (v.match(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/)) onChange(v); }}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button
          type="button"
          onClick={() => setMode(m => m === "hex" ? "rgba" : "hex")}
          style={{
            background: "none", border: "1px solid #1c1c26", color: "#7a7a90",
            borderRadius: 4, padding: "2px 5px", fontSize: 10, cursor: "pointer",
            whiteSpace: "nowrap",
          }}
          title="Toggle hex/RGBA"
        >
          {mode === "hex" ? "#" : "RGBA"}
        </button>
      </div>
      {mode === "rgba" && rgb && (
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {["r", "g", "b"].map(ch => (
            <input
              key={ch}
              defaultValue={String(rgb[ch as keyof typeof rgb])}
              onBlur={e => {
                const v = Math.max(0, Math.min(255, Number(e.target.value) || 0));
                const c = { ...rgb, [ch]: v };
                onChange(rgbToHex(c.r, c.g, c.b) + (alpha < 1 ? Math.round(alpha * 255).toString(16).padStart(2, "0") : ""));
              }}
              style={{ ...inputStyle, width: 36, textAlign: "center" }}
              placeholder={ch.toUpperCase()}
            />
          ))}
          <input
            type="range"
            min={0} max={100} defaultValue={Math.round(alpha * 100)}
            onChange={e => {
              const a = Number(e.target.value) / 100;
              onChange(color.slice(0, 7) + (a < 1 ? Math.round(a * 255).toString(16).padStart(2, "0") : ""));
            }}
            style={{ flex: 1, accentColor: "#6366f1" }}
            title="Alpha"
          />
          <span style={{ fontSize: 10, color: "#7a7a90", minWidth: 28, textAlign: "right" }}>
            {Math.round(alpha * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}
