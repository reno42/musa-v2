import { useState, useCallback, useRef, useEffect } from "react";
import type { SelectedElementInfo, ShapeOptions } from "./DesignFrame";
import { GoogleFontPicker } from "./GoogleFontPicker";
import { setTransformFunction, updateCssProperty as setCssProperty, getCssPropertyValue } from "../lib/cssMutations";
import { ensureGoogleFontImport, injectGoogleFontIntoFrames } from "../lib/googleFonts";

/**
 * HtmlContextualPanel — Full design properties panel.
 * Covers typography, color/gradient, per-side spacing, per-side borders,
 * flex/grid, position, overflow, effects (shadow/filter/blend), transform,
 * transition, pseudo-states, and custom CSS.
 */

interface Props {
  element: SelectedElementInfo | null;
  css: string;
  onCssChange: (newCss: string) => void;
  onChangeTag?: (newTag: string) => void;
  onCopyStyle?: () => void;
  onPasteStyle?: () => void;
  hasClipboardStyle?: boolean;
  onConvertToPath?: (layerId: string, frameId: string) => void;
  onOutlineStroke?: (layerId: string, frameId: string) => void;
  onOffsetPath?: (layerId: string, frameId: string, offset: number) => void;
  onShapeOptionsChange?: (layerId: string, frameId: string, options: ShapeOptions) => void;
}

// ── Constants ──

const FONT_WEIGHTS = [
  { label: "Thin 100", value: "100" }, { label: "ExtraLight 200", value: "200" },
  { label: "Light 300", value: "300" }, { label: "Regular 400", value: "400" },
  { label: "Medium 500", value: "500" }, { label: "Semibold 600", value: "600" },
  { label: "Bold 700", value: "700" }, { label: "ExtraBold 800", value: "800" },
  { label: "Black 900", value: "900" },
];

const TEXT_DECORATIONS = [
  { label: "None", value: "none" }, { label: "Underline", value: "underline" },
  { label: "Overline", value: "overline" }, { label: "Line-through", value: "line-through" },
];

const TEXT_TRANSFORMS = [
  { label: "None", value: "none" }, { label: "UPPER", value: "uppercase" },
  { label: "lower", value: "lowercase" }, { label: "Capitalize", value: "capitalize" },
];

const ALIGNMENTS = [
  { label: "\u2190", value: "left", title: "Left" },
  { label: "\u2194", value: "center", title: "Center" },
  { label: "\u2192", value: "right", title: "Right" },
  { label: "\u2261", value: "justify", title: "Justify" },
];

const FLEX_DIRECTIONS = [
  { label: "\u2192 Row", value: "row" }, { label: "\u2193 Column", value: "column" },
  { label: "\u2190 Row Rev", value: "row-reverse" }, { label: "\u2191 Col Rev", value: "column-reverse" },
];

const JUSTIFY_CONTENTS = [
  { label: "Start", value: "flex-start" }, { label: "Center", value: "center" },
  { label: "End", value: "flex-end" }, { label: "Between", value: "space-between" },
  { label: "Around", value: "space-around" }, { label: "Evenly", value: "space-evenly" },
];

const ALIGN_ITEMS = [
  { label: "Start", value: "flex-start" }, { label: "Center", value: "center" },
  { label: "End", value: "flex-end" }, { label: "Stretch", value: "stretch" },
  { label: "Baseline", value: "baseline" },
];

const FLEX_WRAPS = [
  { label: "No Wrap", value: "nowrap" }, { label: "Wrap", value: "wrap" }, { label: "Wrap Rev", value: "wrap-reverse" },
];

const POSITIONS = ["static", "relative", "absolute", "fixed", "sticky"];

const OVERFLOWS = ["visible", "hidden", "scroll", "auto"];

const BLEND_MODES = [
  "normal", "multiply", "screen", "overlay", "darken", "lighten",
  "color-dodge", "color-burn", "hard-light", "soft-light",
  "difference", "exclusion", "hue", "saturation", "color", "luminosity",
];

const TRANSFORM_ORIGINS = ["center", "top left", "top right", "bottom left", "bottom right", "center top", "center bottom"];

const EASINGS = ["linear", "ease", "ease-in", "ease-out", "ease-in-out", "cubic-bezier(0.4, 0, 0.2, 1)"];

const PSEUDO_STATES = [":hover", ":active", ":focus"];

const SEMANTIC_TAGS = [
  "div", "section", "article", "aside", "header", "footer", "nav", "main",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "span", "a", "button", "label", "input", "form",
  "ul", "ol", "li", "img", "figure", "figcaption",
  "table", "thead", "tbody", "tr", "td", "th",
];

const DIMENSION_PROPS = new Set([
  "font-size", "width", "height", "max-width", "max-height", "min-width", "min-height",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border-radius", "gap", "row-gap", "column-gap",
  "top", "left", "right", "bottom",
  "letter-spacing", "word-spacing", "border-width", "stroke-width",
]);

// ── Styles ──

const panelStyle: React.CSSProperties = {
  width: "100%", minWidth: 0, background: "transparent",
  border: "none", borderRadius: 10,
  color: "#e0e0e0", fontSize: 12, fontFamily: "Inter, system-ui, sans-serif",
  overflow: "auto", padding: 0, maxHeight: "100%",
};

const sectionHead: React.CSSProperties = {
  padding: "6px 10px", fontSize: 10, color: "#7a7668", textTransform: "uppercase",
  letterSpacing: 1, borderBottom: "1px solid rgba(255,255,255,0.04)",
  display: "flex", justifyContent: "space-between", cursor: "pointer", userSelect: "none",
  background: "none", border: "none", width: "100%", textAlign: "left",
};

const inp: React.CSSProperties = {
  flex: 1, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.05)",
  color: "#f0ebe0", borderRadius: 4, padding: "3px 6px", fontSize: 11, fontFamily: "monospace",
};

const sel: React.CSSProperties = {
  flex: 1, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.04)",
  color: "#f0ebe0", borderRadius: 4, padding: "3px 6px", fontSize: 11,
};

const miniInp: React.CSSProperties = {
  ...inp, width: 48, minWidth: 48, padding: "2px 4px", fontSize: 10,
};

const colorInp: React.CSSProperties = {
  width: 26, height: 22, border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 4, cursor: "pointer", padding: 0, flexShrink: 0,
};

const sectionBody: React.CSSProperties = {
  padding: "6px 10px", display: "flex", flexDirection: "column", gap: 4,
  borderBottom: "1px solid rgba(255,255,255,0.04)",
};

// ── ScrubbyInput Component ──
// Drag left/right on the label to change the numeric value

function ScrubbyInput({
  value, onChange, min, max, step, suffix, label, style,
}: {
  value: string; onChange: (v: string) => void;
  min?: number; max?: number; step?: number; suffix?: string;
  label?: string; style?: React.CSSProperties;
}) {
  const dragRef = useRef<{ startX: number; startVal: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    const num = parseFloat(value);
    if (isNaN(num)) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startVal: num };
    document.body.style.cursor = "ew-resize";

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const s = step || 1;
      let newVal = dragRef.current.startVal + Math.round(dx / s) * s;
      if (min !== undefined) newVal = Math.max(min, newVal);
      if (max !== undefined) newVal = Math.min(max, newVal);
      onChange(String(newVal));
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, ...style }}>
      {label && (
        <span
          onMouseDown={handleMouseDown}
          style={{ fontSize: 10, color: "#7a7668", cursor: "ew-resize", flex: "0 0 36px", textAlign: "right", userSelect: "none" }}
          title="Drag to adjust"
        >
          {label}
        </span>
      )}
      <input
        ref={inputRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={() => onChange(value)}
        onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        style={{ ...miniInp, flex: label ? undefined : 1 }}
      />
      {suffix && <span style={{ fontSize: 9, color: "#555" }}>{suffix}</span>}
    </div>
  );
}

// ── Helper Components ──

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 10, color: "#7a7668", flex: "0 0 52px", textAlign: "right" }}>{label}</span>
      <div style={{ flex: 1, display: "flex", gap: 4, alignItems: "center" }}>{children}</div>
    </div>
  );
}

function SelectRow({ label, value, options, onChange }: {
  label: string; value: string; options: { label: string; value: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <PropRow label={label}>
      <select value={value || ""} onChange={e => onChange(e.target.value)} style={sel}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </PropRow>
  );
}

function ColorRow({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  const hex = toHex(value);
  const alpha = parseAlpha(value);
  return (
    <PropRow label={label}>
      <input type="color" value={hex} onChange={e => {
        if (alpha < 1) {
          onChange(hexToRgba(e.target.value, alpha));
        } else {
          onChange(e.target.value);
        }
      }} style={colorInp} />
      <input value={value || ""} onChange={e => onChange(e.target.value)}
        onBlur={() => onChange(value)}
        onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        style={inp} />
    </PropRow>
  );
}

function OpacityRow({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  const opacity = Math.max(0, Math.min(1, parseFloat(value) || 0));
  return (
    <PropRow label={label}>
      <input type="range" min="0" max="1" step="0.01" value={opacity}
        onChange={e => onChange(e.target.value)}
        style={{ flex: 1, accentColor: "#c8b898" }} />
      <span style={{ fontSize: 10, color: "#7a7668", width: 30, textAlign: "right" }}>
        {Math.round(opacity * 100)}%
      </span>
    </PropRow>
  );
}

// ── Per-side spacing box ──

function SpacingBox({ label, prefix, styles, onUpdate }: {
  label: string; prefix: "margin" | "padding";
  styles: Record<string, string>;
  onUpdate: (prop: string, value: string) => void;
}) {
  const top = styles[`${prefix}-top`] || styles[prefix] || "";
  const right = styles[`${prefix}-right`] || styles[prefix] || "";
  const bottom = styles[`${prefix}-bottom`] || styles[prefix] || "";
  const left = styles[`${prefix}-left`] || styles[prefix] || "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 9, color: "#7a7668", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gridTemplateRows: "auto auto auto", gap: 2, alignItems: "center", justifyItems: "center" }}>
        <span />
        <input value={top} onChange={e => onUpdate(`${prefix}-top`, e.target.value)} placeholder="0" style={{ ...miniInp, width: 40, textAlign: "center" }} title={`${prefix} top`} />
        <span />
        <input value={left} onChange={e => onUpdate(`${prefix}-left`, e.target.value)} placeholder="0" style={{ ...miniInp, width: 40, textAlign: "center" }} title={`${prefix} left`} />
        <div style={{ width: 36, height: 18, border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, color: "#555" }}>
          {prefix === "margin" ? "M" : "P"}
        </div>
        <input value={right} onChange={e => onUpdate(`${prefix}-right`, e.target.value)} placeholder="0" style={{ ...miniInp, width: 40, textAlign: "center" }} title={`${prefix} right`} />
        <span />
        <input value={bottom} onChange={e => onUpdate(`${prefix}-bottom`, e.target.value)} placeholder="0" style={{ ...miniInp, width: 40, textAlign: "center" }} title={`${prefix} bottom`} />
        <span />
      </div>
    </div>
  );
}

// ── Utilities ──

function normalizeCssValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /[a-zA-Z%]/.test(trimmed)) return trimmed;
  if (/^-?\d+\.?\d*$/.test(trimmed)) return trimmed + "px";
  return trimmed;
}

function toHex(color?: string): string {
  if (!color) return "#000000";
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    return "#" + color.slice(1).split("").map(char => char + char).join("");
  }
  if (/^#[0-9a-f]{6,8}$/i.test(color)) return color.slice(0, 7);

  const context = document.createElement("canvas").getContext("2d");
  if (context) {
    context.fillStyle = "#000000";
    context.fillStyle = color;
    color = context.fillStyle;
    if (color.startsWith("#")) return color.slice(0, 7);
  }
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) {
    return "#" + [m[1], m[2], m[3]].map(c =>
      Math.max(0, Math.min(255, parseInt(c))).toString(16).padStart(2, "0")
    ).join("");
  }
  return "#000000";
}

function parseAlpha(color?: string): number {
  if (!color) return 1;
  const m = color.match(/rgba?\([^,]+,[^,]+,[^,]+(?:,\s*([\d.]+))?\)/);
  if (m && m[1]) return parseFloat(m[1]);
  return 1;
}

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function updateElementCssProperty(css: string, selector: string, prop: string, value: string): string {
  const cleanValue = value
    .replace(/;+\s*$/, "")
    .replace(/\s*!important\s*$/i, "")
    .trim();
  let normalized = DIMENSION_PROPS.has(prop) ? normalizeCssValue(cleanValue) : cleanValue;
  if (normalized && !prop.startsWith("--")) normalized += " !important";
  return setCssProperty(css, selector, prop, normalized);
}

function updatePseudoCss(css: string, selector: string, pseudo: string, props: Record<string, string>): string {
  const pseudoSelector = `${selector}${pseudo}`;
  let updated = css;
  for (const [prop, value] of Object.entries(props)) {
    updated = setCssProperty(updated, pseudoSelector, prop, value);
  }
  return updated;
}

// ── Main Component ──

export function HtmlContextualPanel({ element, css, onCssChange, onChangeTag, onCopyStyle, onPasteStyle, hasClipboardStyle, onConvertToPath, onOutlineStroke, onOffsetPath, onShapeOptionsChange }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    typography: true, fill: true, stroke: true, spacing: true, border: true,
    layout: true, shape: true, position: false, effects: false, transform: false,
    transition: false, states: false, custom: false,
  });
  const [activePseudo, setActivePseudo] = useState<string>(":hover");
  const [customCssText, setCustomCssText] = useState("");

  const toggle = (s: string) => setExpanded(prev => ({ ...prev, [s]: !prev[s] }));

  const update = useCallback((selector: string, prop: string, value: string) => {
    let updated = updateElementCssProperty(css, selector, prop, value);
    // Auto-set border-style to solid when border-width becomes non-zero
    if (prop === "border-width" && parseFloat(value) > 0) {
      const existingStyle = getCssPropertyValue(updated, selector, "border-style");
      if (!existingStyle || existingStyle === "none") {
        updated = updateElementCssProperty(updated, selector, "border-style", "solid");
      }
    }
    if (prop === "font-family") {
      const fontName = value.replace(/^['"]|['"]$/g, "").split(",")[0].trim();
      if (fontName && !/^(sans-serif|serif|monospace|cursive|fantasy|system-ui|inherit|initial|unset|Arial|Helvetica|Times New Roman|Georgia|Verdana|Courier New|Impact|Comic Sans|Trebuchet|Tahoma|Geneva|Inter)$/i.test(fontName)) {
        updated = ensureGoogleFontImport(updated, fontName);
        injectGoogleFontIntoFrames(fontName);
      }
    }
    onCssChange(updated);
  }, [css, onCssChange]);

  const updateMulti = useCallback((selector: string, props: Record<string, string>) => {
    let updated = css;
    for (const [k, v] of Object.entries(props)) {
      updated = updateElementCssProperty(updated, selector, k, v);
    }
    onCssChange(updated);
  }, [css, onCssChange]);

  const applyCustomCss = useCallback(() => {
    if (!element || !customCssText.trim()) return;
    const lines = customCssText.split("\n");
    let updated = css;
    for (const line of lines) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const prop = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).replace(/;$/, "").trim();
      if (prop && val) updated = updateElementCssProperty(updated, element.selector, prop, val);
    }
    onCssChange(updated);
    setCustomCssText("");
  }, [css, element, onCssChange]);

  if (!element) {
    return (
      <div style={{ ...panelStyle, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ color: "#7a7668", fontSize: 11, textAlign: "center" }}>
          Select an element inside a frame to edit its properties
        </div>
        {onCopyStyle && (
          <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
            <button type="button" onClick={onCopyStyle} disabled={!element}
              style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, border: "1px solid rgba(200,184,152,0.2)", background: "none", color: "#c8b898", cursor: element ? "pointer" : "not-allowed", opacity: element ? 1 : 0.3 }}>
              Copy Style
            </button>
            <button type="button" onClick={onPasteStyle} disabled={!hasClipboardStyle}
              style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, border: "1px solid rgba(200,184,152,0.2)", background: "none", color: "#c8b898", cursor: hasClipboardStyle ? "pointer" : "not-allowed", opacity: hasClipboardStyle ? 1 : 0.3 }}>
              Paste Style
            </button>
          </div>
        )}
      </div>
    );
  }

  const s = element.computedStyles;
  const isText = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "a", "li", "label", "button", "em", "strong", "small", "b", "i"].includes(element.tag);
  const isFlex = s["display"] === "flex" || s["display"] === "inline-flex";
  const isGrid = s["display"] === "grid" || s["display"] === "inline-grid";
  const isSvg = element.isSvg;
  const isSvgPath = isSvg && element.svgChildTag === "path";
  const isSvgShape = isSvg && ["path", "rect", "circle", "ellipse", "polygon", "polyline", "line"].includes(element.svgChildTag || "");
  const isSvgText = isSvg && element.svgChildTag === "text";

  return (
    <div className="html-contextual-panel" style={panelStyle}>
      {/* ── Header ── */}
      <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#c8b898" }}>{element.tag.toUpperCase()}</span>
          <span style={{ fontSize: 9, color: "#555", fontFamily: "monospace" }}>{element.selector.length > 30 ? element.selector.slice(0, 30) + "…" : element.selector}</span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {onChangeTag && !isSvg && (
            <select value={element.tag} onChange={e => onChangeTag(e.target.value)}
              style={{ flex: 1, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(200,184,152,0.2)", color: "#c8b898", borderRadius: 4, padding: "3px 6px", fontSize: 11, fontFamily: "monospace", cursor: "pointer" }}>
              {SEMANTIC_TAGS.map(tag => <option key={tag} value={tag}>{`<${tag}>`}</option>)}
            </select>
          )}
          {onCopyStyle && (
            <>
              <button type="button" onClick={onCopyStyle} title="Copy style" style={{ padding: "3px 6px", fontSize: 10, borderRadius: 4, border: "1px solid rgba(200,184,152,0.2)", background: "none", color: "#c8b898", cursor: "pointer" }}>📋</button>
              <button type="button" onClick={onPasteStyle} disabled={!hasClipboardStyle} title="Paste style" style={{ padding: "3px 6px", fontSize: 10, borderRadius: 4, border: "1px solid rgba(200,184,152,0.2)", background: "none", color: hasClipboardStyle ? "#c8b898" : "#555", cursor: hasClipboardStyle ? "pointer" : "not-allowed" }}>📎</button>
              {onConvertToPath && !isSvg && !isText && (
                <button type="button" onClick={() => onConvertToPath(element.layerId, element.frameId)}
                  title="Convert to SVG path"
                  style={{ padding: "3px 6px", fontSize: 10, borderRadius: 4, border: "1px solid rgba(168,85,247,0.3)", background: "rgba(168,85,247,0.1)", color: "#A78BFA", cursor: "pointer" }}>
                  ⬢→Path
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Typography ── */}
      {(isText || isSvgText) && (
        <>
          <SectionHead label="Typography" section="typography" expanded={expanded} toggle={toggle} />
          {expanded.typography && (
            <div style={sectionBody}>
              <PropRow label="Font">
                <GoogleFontPicker value={s["font-family"]?.replace(/['"]/g, "").split(",")[0] || ""} onChange={(f) => update(element.selector, "font-family", `'${f}'`)} />
              </PropRow>
              <PropRow label="Size">
                <ScrubbyInput value={s["font-size"] || ""} onChange={v => update(element.selector, "font-size", v)} label="" suffix="px" />
              </PropRow>
              <SelectRow label="Weight" value={s["font-weight"] || "400"} options={FONT_WEIGHTS} onChange={v => update(element.selector, "font-weight", v)} />
              <PropRow label="Align">
                <div style={{ display: "flex", gap: 2, flex: 1 }}>
                  {ALIGNMENTS.map(a => (
                    <button key={a.value} type="button" title={a.title}
                      onClick={() => update(element.selector, "text-align", a.value)}
                      style={{ flex: 1, padding: "3px 4px", borderRadius: 4, fontSize: 13, cursor: "pointer",
                        background: s["text-align"] === a.value ? "rgba(200,184,152,0.12)" : "rgba(15,15,15,0.5)",
                        border: s["text-align"] === a.value ? "1px solid #c8b898" : "1px solid rgba(255,255,255,0.04)",
                        color: s["text-align"] === a.value ? "#c8b898" : "#7a7668" }}>
                      {a.label}
                    </button>
                  ))}
                </div>
              </PropRow>
              <PropRow label="Spacing">
                <ScrubbyInput value={s["letter-spacing"] || "normal"} onChange={v => update(element.selector, "letter-spacing", v)} />
              </PropRow>
              <PropRow label="Line-H">
                <ScrubbyInput value={s["line-height"] || ""} onChange={v => update(element.selector, "line-height", v)} />
              </PropRow>
              <SelectRow label="Deco" value={s["text-decoration"] || "none"} options={TEXT_DECORATIONS} onChange={v => update(element.selector, "text-decoration", v)} />
              <SelectRow label="Case" value={s["text-transform"] || "none"} options={TEXT_TRANSFORMS} onChange={v => update(element.selector, "text-transform", v)} />
            </div>
          )}
        </>
      )}

      {/* ── Shape (parametric star/polygon controls) ── */}
      {element.shapeOptions && onShapeOptionsChange && (
        <>
          <SectionHead label="Shape" section="shape" expanded={expanded} toggle={toggle} />
          {expanded.shape && (
            <div style={sectionBody}>
              <PropRow label={element.shapeOptions.shape === "star" ? "Points" : "Sides"}>
                <ScrubbyInput value={String(element.shapeOptions.count)} min={3} max={60}
                  onChange={v => onShapeOptionsChange(element.layerId, element.frameId, { ...element.shapeOptions!, count: parseInt(v) || 3 })} />
              </PropRow>
              {element.shapeOptions.shape === "star" && (
                <PropRow label="Ratio">
                  <ScrubbyInput value={String(Math.round(element.shapeOptions.ratio * 100))} min={1} max={99} suffix="%"
                    onChange={v => onShapeOptionsChange(element.layerId, element.frameId, { ...element.shapeOptions!, ratio: (parseInt(v) || 40) / 100 })} />
                </PropRow>
              )}
              <PropRow label="Radius">
                <ScrubbyInput value={String(element.shapeOptions.cornerRadius)} min={0} max={200}
                  onChange={v => onShapeOptionsChange(element.layerId, element.frameId, { ...element.shapeOptions!, cornerRadius: parseInt(v) || 0 })} />
              </PropRow>
            </div>
          )}
        </>
      )}

      {/* ── Fill ── */}
      <SectionHead label={isSvgShape ? "Fill" : "Fill & Color"} section="fill" expanded={expanded} toggle={toggle} />
      {expanded.fill && (
        <div style={sectionBody}>
          {/* SVG path: fill color only */}
          {isSvgShape && (
            <>
              <ColorRow label="Fill" value={s["fill"] || s["color"] || "#8B5CF6"} onChange={v => update(element.selector, "fill", v)} />
              <OpacityRow label="Opacity" value={s["opacity"] || "1"} onChange={v => update(element.selector, "opacity", v)} />
            </>
          )}
          {/* SVG text: fill + color */}
          {isSvgText && (
            <>
              <ColorRow label="Fill" value={s["fill"] || s["color"] || "#333"} onChange={v => update(element.selector, "fill", v)} />
              <ColorRow label="Color" value={s["color"] || ""} onChange={v => update(element.selector, "color", v)} />
              <OpacityRow label="Opacity" value={s["opacity"] || "1"} onChange={v => update(element.selector, "opacity", v)} />
            </>
          )}
          {/* SVG wrapper or div: background-based */}
          {!isSvgShape && !isSvgText && (
            <>
              {isText && <ColorRow label="Text" value={s["color"] || ""} onChange={v => update(element.selector, "color", v)} />}
              <ColorRow label={isText ? "BG" : "Fill"} value={s["background-color"] || s["background"] || ""} onChange={v => update(element.selector, "background-color", v)} />
              <OpacityRow label="Opacity" value={s["opacity"] || "1"} onChange={v => update(element.selector, "opacity", v)} />
              {/* Gradient Builder */}
              <GradientBuilder
                key={element.layerId}
                value={s["background-image"] || ""}
                onChange={(v) => update(element.selector, "background-image", v)}
              />
              {/* Blend Mode */}
              <SelectRow label="Blend" value={s["mix-blend-mode"] || "normal"} options={BLEND_MODES.map(b => ({ label: b, value: b }))} onChange={v => update(element.selector, "mix-blend-mode", v)} />
            </>
          )}
        </div>
      )}

      {/* ── Stroke (SVG paths only) ── */}
      {isSvgShape && (
        <>
          <SectionHead label="Stroke" section="stroke" expanded={expanded} toggle={toggle} />
          {expanded.stroke && (
            <div style={sectionBody}>
              <ColorRow label="Color" value={s["stroke"] || "none"} onChange={v => update(element.selector, "stroke", v)} />
              <PropRow label="Width">
                <ScrubbyInput value={s["stroke-width"] || "2"} onChange={v => update(element.selector, "stroke-width", v)} suffix="px" />
              </PropRow>
              <SelectRow label="Linecap" value={s["stroke-linecap"] || "round"} options={[
                { label: "Butt", value: "butt" }, { label: "Round", value: "round" }, { label: "Square", value: "square" },
              ]} onChange={v => update(element.selector, "stroke-linecap", v)} />
              <SelectRow label="Linejoin" value={s["stroke-linejoin"] || "round"} options={[
                { label: "Miter", value: "miter" }, { label: "Round", value: "round" }, { label: "Bevel", value: "bevel" },
              ]} onChange={v => update(element.selector, "stroke-linejoin", v)} />
              <PropRow label="Dash">
                <input value={s["stroke-dasharray"] || ""} placeholder="4 4" onChange={e => update(element.selector, "stroke-dasharray", e.target.value)} style={inp} />
              </PropRow>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {[
                  { label: "Solid", val: "none" },
                  { label: "4-4", val: "4 4" },
                  { label: "8-4", val: "8 4" },
                  { label: "12-8-4-8", val: "12 8 4 8" },
                  { label: "Dotted", val: "1 6" },
                ].map(p => (
                  <button key={p.label} type="button" onClick={() => update(element.selector, "stroke-dasharray", p.val)}
                    style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, border: "1px solid rgba(200,184,152,0.15)", background: "rgba(200,184,152,0.05)", color: "#c8b898", cursor: "pointer" }}>
                    {p.label}
                  </button>
                ))}
              </div>
              {/* Path Operations */}
              {isSvgPath && (onOutlineStroke || onOffsetPath) && (
                <div style={{ display: "flex", gap: 6, marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(200,184,152,0.1)" }}>
                  {onOutlineStroke && (
                    <button type="button" onClick={() => onOutlineStroke(element.layerId, element.frameId)}
                      title="Convert stroke to filled outline path (expands path by stroke width)"
                      style={{ flex: 1, fontSize: 10, padding: "4px 6px", borderRadius: 4, border: "1px solid rgba(200,184,152,0.2)", background: "rgba(200,184,152,0.06)", color: "#c8b898", cursor: "pointer" }}>
                      ⬢ Outline Stroke
                    </button>
                  )}
                  {onOffsetPath && (
                    <>
                      <button type="button" onClick={() => onOffsetPath(element.layerId, element.frameId, -4)}
                        title="Shrink path inward by 4px"
                        style={{ fontSize: 10, padding: "4px 6px", borderRadius: 4, border: "1px solid rgba(200,184,152,0.2)", background: "rgba(200,184,152,0.06)", color: "#c8b898", cursor: "pointer" }}>
                        ⊖ Inset
                      </button>
                      <button type="button" onClick={() => onOffsetPath(element.layerId, element.frameId, 4)}
                        title="Expand path outward by 4px"
                        style={{ fontSize: 10, padding: "4px 6px", borderRadius: 4, border: "1px solid rgba(200,184,152,0.2)", background: "rgba(200,184,152,0.06)", color: "#c8b898", cursor: "pointer" }}>
                        ⊕ Outset
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Spacing (per-side) ── */}
      {!isSvgShape && (
        <>
          <SectionHead label="Spacing" section="spacing" expanded={expanded} toggle={toggle} />
          {expanded.spacing && (
            <div style={{ ...sectionBody, flexDirection: "row", gap: 12 }}>
              <SpacingBox label="Margin" prefix="margin" styles={s} onUpdate={(p, v) => update(element.selector, p, v)} />
              <SpacingBox label="Padding" prefix="padding" styles={s} onUpdate={(p, v) => update(element.selector, p, v)} />
            </div>
          )}
        </>
      )}

      {/* ── Border ── */}
      {!isSvgShape && (
        <>
          <SectionHead label="Border" section="border" expanded={expanded} toggle={toggle} />
          {expanded.border && (
        <div style={sectionBody}>
          {/* Per-side border width */}
          <PropRow label="Width">
            <ScrubbyInput value={s["border-width"] || "0"} onChange={v => update(element.selector, "border-width", v)} suffix="px" />
          </PropRow>
          <SelectRow label="Style" value={s["border-style"] || "none"} options={[
            { label: "None", value: "none" }, { label: "Solid", value: "solid" }, { label: "Dashed", value: "dashed" },
            { label: "Dotted", value: "dotted" }, { label: "Double", value: "double" }, { label: "Groove", value: "groove" },
            { label: "Ridge", value: "ridge" }, { label: "Inset", value: "inset" }, { label: "Outset", value: "outset" },
          ]} onChange={v => update(element.selector, "border-style", v)} />
          <ColorRow label="Color" value={s["border-color"] || "#000000"} onChange={v => update(element.selector, "border-color", v)} />
          {/* Per-side radius */}
          <PropRow label="Radius">
            <ScrubbyInput value={s["border-radius"] || "0"} onChange={v => update(element.selector, "border-radius", v)} suffix="px" />
          </PropRow>
          <div style={{ display: "flex", gap: 4 }}>
            {(["top-left", "top-right", "bottom-right", "bottom-left"] as const).map(corner => (
              <div key={corner} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <span style={{ fontSize: 8, color: "#555" }}>{corner.split("-").map(w => w[0]).join("")}</span>
                <input value={s[`border-${corner}-radius`] || ""} placeholder="0" onChange={e => update(element.selector, `border-${corner}-radius`, e.target.value)} style={{ ...miniInp, width: 36, textAlign: "center" }} />
              </div>
            ))}
          </div>
        </div>
          )}
        </>
      )}

      {/* ── Layout (Flex/Grid) ── */}
      {!isSvgShape && (
        <>
          <SectionHead label="Layout" section="layout" expanded={expanded} toggle={toggle} />
          {expanded.layout && (
        <div style={sectionBody}>
          <SelectRow label="Display" value={s["display"] || "block"} options={[
            { label: "Block", value: "block" }, { label: "Flex", value: "flex" }, { label: "Grid", value: "grid" },
            { label: "Inline", value: "inline" }, { label: "Inline-Block", value: "inline-block" },
            { label: "Inline-Flex", value: "inline-flex" }, { label: "None", value: "none" },
          ]} onChange={v => update(element.selector, "display", v)} />
          <PropRow label="W"><ScrubbyInput value={s["width"] || ""} onChange={v => update(element.selector, "width", v)} /></PropRow>
          <PropRow label="H"><ScrubbyInput value={s["height"] || ""} onChange={v => update(element.selector, "height", v)} /></PropRow>
          <PropRow label="Gap"><ScrubbyInput value={s["gap"] || ""} onChange={v => update(element.selector, "gap", v)} /></PropRow>

          {/* Flex controls */}
          {(isFlex) && (
            <>
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 4, marginTop: 2 }} />
              <SelectRow label="Dir" value={s["flex-direction"] || "row"} options={FLEX_DIRECTIONS} onChange={v => update(element.selector, "flex-direction", v)} />
              <SelectRow label="Justify" value={s["justify-content"] || "flex-start"} options={JUSTIFY_CONTENTS} onChange={v => update(element.selector, "justify-content", v)} />
              <SelectRow label="Align" value={s["align-items"] || "stretch"} options={ALIGN_ITEMS} onChange={v => update(element.selector, "align-items", v)} />
              <SelectRow label="Wrap" value={s["flex-wrap"] || "nowrap"} options={FLEX_WRAPS} onChange={v => update(element.selector, "flex-wrap", v)} />
              <PropRow label="Grow"><ScrubbyInput value={s["flex-grow"] || "0"} onChange={v => update(element.selector, "flex-grow", v)} /></PropRow>
              <PropRow label="Shrink"><ScrubbyInput value={s["flex-shrink"] || "1"} onChange={v => update(element.selector, "flex-shrink", v)} /></PropRow>
              <PropRow label="Basis"><input value={s["flex-basis"] || "auto"} onChange={e => update(element.selector, "flex-basis", e.target.value)} style={inp} /></PropRow>
              <SelectRow label="Self" value={s["align-self"] || "auto"} options={[{ label: "Auto", value: "auto" }, ...ALIGN_ITEMS]} onChange={v => update(element.selector, "align-self", v)} />
              <PropRow label="Order"><ScrubbyInput value={s["order"] || "0"} onChange={v => update(element.selector, "order", v)} /></PropRow>
            </>
          )}

          {/* Grid controls */}
          {isGrid && (
            <>
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 4, marginTop: 2 }} />
              <PropRow label="Cols"><input value={s["grid-template-columns"] || ""} placeholder="1fr 1fr" onChange={e => update(element.selector, "grid-template-columns", e.target.value)} style={inp} /></PropRow>
              <PropRow label="Rows"><input value={s["grid-template-rows"] || ""} placeholder="auto auto" onChange={e => update(element.selector, "grid-template-rows", e.target.value)} style={inp} /></PropRow>
              <PropRow label="Gap"><ScrubbyInput value={s["grid-gap"] || s["gap"] || ""} onChange={v => update(element.selector, "grid-gap", v)} /></PropRow>
            </>
          )}

          {/* Overflow */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 4, marginTop: 2 }} />
          <SelectRow label="Overflow" value={s["overflow"] || "visible"} options={OVERFLOWS.map(o => ({ label: o.charAt(0).toUpperCase() + o.slice(1), value: o }))} onChange={v => update(element.selector, "overflow", v)} />
          <SelectRow label="Ovflow-X" value={s["overflow-x"] || "visible"} options={OVERFLOWS.map(o => ({ label: o.charAt(0).toUpperCase() + o.slice(1), value: o }))} onChange={v => update(element.selector, "overflow-x", v)} />
          <SelectRow label="Ovflow-Y" value={s["overflow-y"] || "visible"} options={OVERFLOWS.map(o => ({ label: o.charAt(0).toUpperCase() + o.slice(1), value: o }))} onChange={v => update(element.selector, "overflow-y", v)} />
        </div>
          )}
        </>
      )}

      {/* ── Position ── */}
      <SectionHead label="Position" section="position" expanded={expanded} toggle={toggle} />
      {expanded.position && (
        <div style={sectionBody}>
          <SelectRow label="Type" value={s["position"] || "static"} options={POSITIONS.map(p => ({ label: p.charAt(0).toUpperCase() + p.slice(1), value: p }))} onChange={v => update(element.selector, "position", v)} />
          <PropRow label="Top"><ScrubbyInput value={s["top"] || ""} onChange={v => update(element.selector, "top", v)} /></PropRow>
          <PropRow label="Right"><ScrubbyInput value={s["right"] || ""} onChange={v => update(element.selector, "right", v)} /></PropRow>
          <PropRow label="Bottom"><ScrubbyInput value={s["bottom"] || ""} onChange={v => update(element.selector, "bottom", v)} /></PropRow>
          <PropRow label="Left"><ScrubbyInput value={s["left"] || ""} onChange={v => update(element.selector, "left", v)} /></PropRow>
          <PropRow label="Z-Index"><ScrubbyInput value={s["z-index"] || "0"} onChange={v => update(element.selector, "z-index", v)} /></PropRow>
        </div>
      )}

      {/* ── Effects ── */}
      <SectionHead label="Effects" section="effects" expanded={expanded} toggle={toggle} />
      {expanded.effects && (
        <div style={sectionBody}>
          <PropRow label="Shadow">
            <input value={s["box-shadow"] || "none"} placeholder="0 4px 6px rgba(0,0,0,0.1)" onChange={e => update(element.selector, "box-shadow", e.target.value)} style={inp} />
          </PropRow>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {[
              { label: "Subtle", val: "0 1px 3px rgba(0,0,0,0.12)" },
              { label: "Card", val: "0 4px 12px rgba(0,0,0,0.15)" },
              { label: "Pop", val: "0 8px 24px rgba(0,0,0,0.2)" },
              { label: "Inner", val: "inset 0 2px 4px rgba(0,0,0,0.1)" },
              { label: "Glow", val: "0 0 20px rgba(59,130,246,0.5)" },
            ].map(p => (
              <button key={p.label} type="button" onClick={() => update(element.selector, "box-shadow", p.val)}
                style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, border: "1px solid rgba(200,184,152,0.15)", background: "rgba(200,184,152,0.05)", color: "#c8b898", cursor: "pointer" }}>
                {p.label}
              </button>
            ))}
          </div>
          {isText && (
            <PropRow label="Txt Shadow">
              <input value={s["text-shadow"] || "none"} placeholder="0 2px 4px rgba(0,0,0,0.2)" onChange={e => update(element.selector, "text-shadow", e.target.value)} style={inp} />
            </PropRow>
          )}
          {/* CSS Filters */}
          <PropRow label="Filter">
            <input value={s["filter"] || "none"} placeholder="blur(4px) brightness(1.2)" onChange={e => update(element.selector, "filter", e.target.value)} style={inp} />
          </PropRow>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {[
              { label: "Blur", val: "blur(4px)" },
              { label: "Bright", val: "brightness(1.3)" },
              { label: "Contrast", val: "contrast(1.5)" },
              { label: "Grayscale", val: "grayscale(1)" },
              { label: "Sepia", val: "sepia(0.8)" },
              { label: "Invert", val: "invert(1)" },
            ].map(p => (
              <button key={p.label} type="button" onClick={() => update(element.selector, "filter", p.val)}
                style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, border: "1px solid rgba(200,184,152,0.15)", background: "rgba(200,184,152,0.05)", color: "#c8b898", cursor: "pointer" }}>
                {p.label}
              </button>
            ))}
          </div>
          <PropRow label="Backdrop">
            <input value={s["backdrop-filter"] || "none"} placeholder="blur(10px)" onChange={e => update(element.selector, "backdrop-filter", e.target.value)} style={inp} />
          </PropRow>
        </div>
      )}

      {/* ── Transform ── */}
      <SectionHead label="Transform" section="transform" expanded={expanded} toggle={toggle} />
      {expanded.transform && (
        <div style={sectionBody}>
          <PropRow label="Rotate">
            <ScrubbyInput value={extractTransformValue(s["transform"], "rotate") || "0"} onChange={v => update(element.selector, "transform", setTransformFunction(s["transform"], "rotate", normalizeAngleValue(v)))} suffix="°" />
          </PropRow>
          <PropRow label="Scale X">
            <ScrubbyInput value={extractTransformValue(s["transform"], "scaleX") || "1"} onChange={v => update(element.selector, "transform", setTransformFunction(s["transform"], "scaleX", v))} />
          </PropRow>
          <PropRow label="Scale Y">
            <ScrubbyInput value={extractTransformValue(s["transform"], "scaleY") || "1"} onChange={v => update(element.selector, "transform", setTransformFunction(s["transform"], "scaleY", v))} />
          </PropRow>
          <PropRow label="Skew X">
            <ScrubbyInput value={extractTransformValue(s["transform"], "skewX") || "0"} onChange={v => update(element.selector, "transform", setTransformFunction(s["transform"], "skewX", normalizeAngleValue(v)))} suffix="°" />
          </PropRow>
          <PropRow label="Skew Y">
            <ScrubbyInput value={extractTransformValue(s["transform"], "skewY") || "0"} onChange={v => update(element.selector, "transform", setTransformFunction(s["transform"], "skewY", normalizeAngleValue(v)))} suffix="°" />
          </PropRow>
          <SelectRow label="Origin" value={s["transform-origin"] || "center"} options={TRANSFORM_ORIGINS.map(o => ({ label: o, value: o }))} onChange={v => update(element.selector, "transform-origin", v)} />
        </div>
      )}

      {/* ── Transition ── */}
      <SectionHead label="Transition" section="transition" expanded={expanded} toggle={toggle} />
      {expanded.transition && (
        <div style={sectionBody}>
          <PropRow label="Property">
            <input value={extractTransitionPart(s["transition"], 0) || "all"} placeholder="all" onChange={e => update(element.selector, "transition", mergeTransition(s["transition"], 0, e.target.value))} style={inp} />
          </PropRow>
          <PropRow label="Duration">
            <ScrubbyInput value={extractTransitionPart(s["transition"], 1) || "0.3s"} onChange={v => update(element.selector, "transition", mergeTransition(s["transition"], 1, normalizeTimeValue(v)))} suffix="s" />
          </PropRow>
          <SelectRow label="Easing" value={extractTransitionPart(s["transition"], 2) || "ease"} options={EASINGS.map(e => ({ label: e, value: e }))} onChange={v => update(element.selector, "transition", mergeTransition(s["transition"], 2, v))} />
          <PropRow label="Delay">
            <ScrubbyInput value={extractTransitionPart(s["transition"], 3) || "0s"} onChange={v => update(element.selector, "transition", mergeTransition(s["transition"], 3, normalizeTimeValue(v)))} suffix="s" />
          </PropRow>
        </div>
      )}

      {/* ── Pseudo States ── */}
      <SectionHead label="States (:hover etc)" section="states" expanded={expanded} toggle={toggle} />
      {expanded.states && (
        <div style={sectionBody}>
          <div style={{ display: "flex", gap: 4 }}>
            {PSEUDO_STATES.map(p => (
              <button key={p} type="button" onClick={() => setActivePseudo(p)}
                style={{ flex: 1, padding: "3px 4px", borderRadius: 4, fontSize: 10, cursor: "pointer",
                  background: activePseudo === p ? "rgba(200,184,152,0.12)" : "rgba(15,15,15,0.5)",
                  border: activePseudo === p ? "1px solid #c8b898" : "1px solid rgba(255,255,255,0.04)",
                  color: activePseudo === p ? "#c8b898" : "#7a7668" }}>
                {p}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 9, color: "#555", marginTop: 2 }}>
            Editing: <code style={{ color: "#c8b898" }}>{element.selector}{activePseudo}</code>
          </div>
          <ColorRow label="Color" value="" onChange={v => onCssChange(updatePseudoCss(css, element.selector, activePseudo, { color: v }))} />
          <ColorRow label="BG" value="" onChange={v => onCssChange(updatePseudoCss(css, element.selector, activePseudo, { "background-color": v }))} />
          <PropRow label="Shadow">
            <input value="" placeholder="0 4px 12px rgba(0,0,0,0.2)" onChange={e => onCssChange(updatePseudoCss(css, element.selector, activePseudo, { "box-shadow": e.target.value }))} style={inp} />
          </PropRow>
          <PropRow label="Transform">
            <input value="" placeholder="scale(1.05)" onChange={e => onCssChange(updatePseudoCss(css, element.selector, activePseudo, { transform: e.target.value }))} style={inp} />
          </PropRow>
        </div>
      )}

      {/* ── Custom CSS ── */}
      <SectionHead label="Custom CSS" section="custom" expanded={expanded} toggle={toggle} />
      {expanded.custom && (
        <div style={sectionBody}>
          <textarea
            value={customCssText}
            onChange={e => setCustomCssText(e.target.value)}
            placeholder={"background: linear-gradient(...);\nbackdrop-filter: blur(10px);\nfont-variant-numeric: tabular-nums;"}
            style={{ ...inp, minHeight: 80, resize: "vertical", fontFamily: "monospace", fontSize: 10, width: "100%" }}
          />
          <button type="button" onClick={applyCustomCss}
            style={{ padding: "4px 10px", borderRadius: 4, fontSize: 10, cursor: "pointer",
              background: "rgba(200,184,152,0.1)", border: "1px solid rgba(200,184,152,0.3)", color: "#c8b898" }}>
            Apply to {element.selector.length > 20 ? element.selector.slice(0, 20) + "…" : element.selector}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Gradient Builder Component ──

function GradientBuilder({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [stops, setStops] = useState<{ color: string; pos: number }[]>([
    { color: "#667eea", pos: 0 },
    { color: "#764ba2", pos: 100 },
  ]);
  const [gradType, setGradType] = useState<"linear" | "radial" | "conic">("linear");
  const [angle, setAngle] = useState(90);
  const [expanded, setExpanded] = useState(false);

  // Parse existing gradient on mount
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || !value) return;
    initialized.current = true;
    if (value.includes("radial-gradient")) setGradType("radial");
    else if (value.includes("conic-gradient")) setGradType("conic");
    const angleMatch = value.match(/(\d+)deg/);
    if (angleMatch) setAngle(parseInt(angleMatch[1]));
    const colorMatches = value.match(/#[0-9a-fA-F]{3,8}\b/g);
    const posMatches = value.match(/(\d+)%/g);
    if (colorMatches && posMatches && colorMatches.length === posMatches.length) {
      setStops(colorMatches.map((c, i) => ({ color: c, pos: parseInt(posMatches[i]) })));
    }
  }, [value]);

  const buildGradient = useCallback(() => {
    const stopsStr = stops.map(s => `${s.color} ${s.pos}%`).join(", ");
    if (gradType === "linear") return `linear-gradient(${angle}deg, ${stopsStr})`;
    if (gradType === "radial") return `radial-gradient(circle, ${stopsStr})`;
    return `conic-gradient(from ${angle}deg, ${stopsStr})`;
  }, [stops, gradType, angle]);

  const previewStyle: React.CSSProperties = {
    height: 20, borderRadius: 4,
    background: buildGradient(),
    border: "1px solid rgba(255,255,255,0.06)",
    cursor: "pointer",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 9, color: "#7a7668", textTransform: "uppercase" }}>Gradient</span>
        <button type="button" onClick={() => setExpanded(!expanded)}
          style={{ fontSize: 9, color: "#c8b898", background: "none", border: "none", cursor: "pointer" }}>
          {expanded ? "−" : "+"}
        </button>
      </div>
      <div onClick={() => setExpanded(!expanded)} style={previewStyle} title="Click to expand" />
      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "4px 0" }}>
          {/* Type */}
          <div style={{ display: "flex", gap: 4 }}>
            {(["linear", "radial", "conic"] as const).map(t => (
              <button key={t} type="button" onClick={() => setGradType(t)}
                style={{
                  flex: 1, fontSize: 9, padding: "2px 4px", borderRadius: 3,
                  border: gradType === t ? "1px solid #c8b898" : "1px solid rgba(255,255,255,0.06)",
                  background: gradType === t ? "rgba(200,184,152,0.12)" : "rgba(15,15,15,0.5)",
                  color: gradType === t ? "#c8b898" : "#7a7668",
                  cursor: "pointer", textTransform: "capitalize",
                }}>
                {t}
              </button>
            ))}
          </div>
          {/* Angle */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 9, color: "#7a7668", width: 32 }}>Angle</span>
            <ScrubbyInput value={String(angle)} onChange={v => setAngle(parseInt(v) || 0)} min={0} max={360} suffix="°" />
          </div>
          {/* Color Stops */}
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 9, color: "#7a7668" }}>Stops</span>
            {stops.map((stop, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input type="color" value={stop.color} onChange={e => {
                  const newStops = [...stops];
                  newStops[i] = { ...newStops[i], color: e.target.value };
                  setStops(newStops);
                }} style={{ ...colorInp, width: 22, height: 18 }} />
                <input value={stop.color} onChange={e => {
                  const newStops = [...stops];
                  newStops[i] = { ...newStops[i], color: e.target.value };
                  setStops(newStops);
                }} style={{ ...inp, fontSize: 10, width: 64 }} />
                <ScrubbyInput value={String(stop.pos)} onChange={v => {
                  const newStops = [...stops];
                  newStops[i] = { ...newStops[i], pos: parseInt(v) || 0 };
                  setStops(newStops);
                }} min={0} max={100} suffix="%" style={{ flex: 1 }} />
                {stops.length > 2 && (
                  <button type="button" onClick={() => setStops(stops.filter((_, j) => j !== i))}
                    style={{ fontSize: 10, padding: "1px 4px", borderRadius: 2, border: "none", background: "rgba(239,68,68,0.15)", color: "#EF4444", cursor: "pointer" }}>
                    ×
                  </button>
                )}
              </div>
            ))}
            {stops.length < 4 && (
              <button type="button" onClick={() => setStops([...stops, { color: "#A78BFA", pos: 50 }])}
                style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, border: "1px dashed rgba(200,184,152,0.2)", background: "none", color: "#c8b898", cursor: "pointer" }}>
                + Add Stop
              </button>
            )}
          </div>
          {/* Apply */}
          <button type="button" onClick={() => onChange(buildGradient())}
            style={{ padding: "4px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer",
              background: "rgba(200,184,152,0.1)", border: "1px solid rgba(200,184,152,0.3)", color: "#c8b898" }}>
            Apply Gradient
          </button>
        </div>
      )}
    </div>
  );
}

// ── Section Head ──

function SectionHead({ label, section, expanded, toggle }: {
  label: string; section: string; expanded: Record<string, boolean>;
  toggle: (s: string) => void;
}) {
  return (
    <button type="button" onClick={() => toggle(section)} style={sectionHead}>
      {label} <span>{expanded[section] ? "\u25BE" : "\u25B8"}</span>
    </button>
  );
}

// ── Transform Helpers ──

function extractTransformValue(transform: string | undefined, fn: string): string {
  if (!transform || transform === "none") return "";
  const m = transform.match(new RegExp(`${fn}\\(([^)]+)\\)`));
  if (!m) return "";
  return m[1].replace(/deg$/, "").trim();
}

function normalizeAngleValue(value: string): string {
  const trimmed = value.trim();
  return /(?:deg|grad|rad|turn)$/i.test(trimmed) ? trimmed : `${trimmed}deg`;
}

function normalizeTimeValue(value: string): string {
  const trimmed = value.trim();
  return /(?:ms|s)$/i.test(trimmed) ? trimmed : `${trimmed}s`;
}

// ── Transition Helpers ──

function extractTransitionPart(transition: string | undefined, index: number): string {
  if (!transition || transition === "none") return "";
  const parts = transition.trim().split(/\s+/);
  return parts[index] || "";
}

function mergeTransition(existing: string | undefined, index: number, value: string): string {
  const parts = (existing && existing !== "none" ? existing : "all 0.3s ease 0s").trim().split(/\s+/);
  while (parts.length <= index) parts.push("0");
  parts[index] = value;
  return parts.join(" ");
}
