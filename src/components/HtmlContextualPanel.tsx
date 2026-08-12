import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { SelectedElementInfo, ShapeOptions } from "./DesignFrame";
import { GoogleFontPicker } from "./GoogleFontPicker";
import { setTransformFunction, updateCssProperty as setCssProperty, getCssPropertyValue } from "../lib/cssMutations";
import { ensureGoogleFontImport, injectGoogleFontIntoFrames } from "../lib/googleFonts";
import { cssFontFamily, needsWebfont, primaryFamily } from "../lib/fontFamily";
import { styleTargets } from "../lib/selectionModel";
import { getApiHeaders } from "../lib/apiKey";
import { prepareImageForUpload } from "../lib/imageCompress";
import { toHexColor } from "../lib/colorUtils";

/**
 * HtmlContextualPanel — the contextual panel's "Properties" tab (a
 * streamlined Position/Layout/Appearance/Fill/Stroke/Effects set, matching
 * this app's actual editing needs) plus the "Code" and "Animation" tabs for
 * whatever doesn't fit that set: tag/structure changes and raw CSS go to
 * Code, everything else (typography, spacing, flex/grid, states, etc.)
 * goes to Animation. Which tab renders is controlled by the `subTab` prop.
 */

interface Props {
  workspaceId: string;
  element: SelectedElementInfo | null;
  /** Every layer currently selected. A style change applies to all of them,
   *  not only to the one `element` happens to hold. */
  selectedLayerIds?: string[];
  /** The frame's full HTML — only used by the Code tab to show this
   *  element's own markup fragment. */
  html: string;
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
  onGroupModeChange?: (layerId: string, frameId: string, mode: "group" | "container") => void;
  /** Bounds used by the Position category's align-to-frame buttons. */
  frameWidth: number;
  frameHeight: number;
  subTab: "properties" | "code" | "animation";
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

const TEXT_ALIGNMENTS = [
  { label: "←", value: "left", title: "Left" },
  { label: "↔", value: "center", title: "Center" },
  { label: "→", value: "right", title: "Right" },
  { label: "≡", value: "justify", title: "Justify" },
];

const FLEX_DIRECTIONS = [
  { label: "→ Row", value: "row" }, { label: "↓ Column", value: "column" },
  { label: "← Row Rev", value: "row-reverse" }, { label: "↑ Col Rev", value: "column-reverse" },
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
  "border-radius", "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
  "gap", "row-gap", "column-gap",
  "top", "left", "right", "bottom",
  "letter-spacing", "word-spacing", "border-width", "stroke-width",
  "outline-width", "outline-offset",
]);

// ── Styles ──

const panelStyle: React.CSSProperties = {
  width: "100%", minWidth: 0, background: "transparent",
  border: "none", borderRadius: 10,
  color: "#e0e0e0", fontSize: 12, fontFamily: "Inter, system-ui, sans-serif",
  overflow: "auto", padding: 0, maxHeight: "100%", flex: 1,
  display: "flex", flexDirection: "column",
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

// A compact "label: input" pair meant to sit side-by-side with siblings in
// one row (Position X/Y, Layout W/H) — PropRow's 52px label column is too
// wide for that; this uses a narrow inline label instead.
function InlineField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0 }}>
      <span style={{ fontSize: 9, color: "#7a7668", flexShrink: 0 }}>{label}</span>
      {children}
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
  const [text, setText] = useState(value || "");

  useEffect(() => { setText(value || ""); }, [value]);

  const commit = useCallback(() => {
    const trimmed = text.trim();
    const normalized = trimmed.startsWith("#") ? trimmed : "#" + trimmed;
    if (/^#[0-9a-fA-F]{6}$/.test(normalized) || /^#[0-9a-fA-F]{3}$/.test(normalized)) {
      if (alpha < 1) {
        onChange(hexToRgba(normalized, alpha));
      } else {
        onChange(normalized);
      }
    } else {
      setText(value || "");
    }
  }, [text, alpha, value, onChange]);

  return (
    <PropRow label={label}>
      <input type="color" value={hex} onChange={e => {
        if (alpha < 1) {
          onChange(hexToRgba(e.target.value, alpha));
        } else {
          onChange(e.target.value);
        }
      }} style={colorInp} />
      <input value={text} onChange={e => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") { commit(); (e.target as HTMLInputElement).blur(); } }}
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

// ── Alignment icons (align-to-frame, Position category) ──

const ALIGN_BUTTONS: { key: "left" | "centerH" | "right" | "top" | "centerV" | "bottom"; title: string }[] = [
  { key: "left", title: "Align left" },
  { key: "centerH", title: "Align center horizontal" },
  { key: "right", title: "Align right" },
  { key: "top", title: "Align top" },
  { key: "bottom", title: "Align bottom" },
  { key: "centerV", title: "Align center vertical" },
];

function AlignIcon({ type }: { type: typeof ALIGN_BUTTONS[number]["key"] }) {
  const common = { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", stroke: "currentColor", strokeWidth: 1.2 } as const;
  switch (type) {
    case "left": return <svg {...common}><line x1="2" y1="1" x2="2" y2="13" /><rect x="2.5" y="2" width="4" height="3" /><rect x="2.5" y="8" width="7" height="3" /></svg>;
    case "centerH": return <svg {...common}><line x1="7" y1="1" x2="7" y2="13" /><rect x="5" y="2" width="4" height="3" /><rect x="3.5" y="8" width="7" height="3" /></svg>;
    case "right": return <svg {...common}><line x1="12" y1="1" x2="12" y2="13" /><rect x="7.5" y="2" width="4" height="3" /><rect x="5" y="8" width="7" height="3" /></svg>;
    case "top": return <svg {...common}><line x1="1" y1="2" x2="13" y2="2" /><rect x="2" y="2.5" width="3" height="4" /><rect x="8" y="2.5" width="3" height="7" /></svg>;
    case "centerV": return <svg {...common}><line x1="1" y1="7" x2="13" y2="7" /><rect x="2" y="5" width="3" height="4" /><rect x="8" y="3.5" width="3" height="7" /></svg>;
    case "bottom": return <svg {...common}><line x1="1" y1="12" x2="13" y2="12" /><rect x="2" y="7.5" width="3" height="4" /><rect x="8" y="4.5" width="3" height="7" /></svg>;
  }
}

// ── Utilities ──

function normalizeCssValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /[a-zA-Z%]/.test(trimmed)) return trimmed;
  if (/^-?\d+\.?\d*$/.test(trimmed)) return trimmed + "px";
  return trimmed;
}

function toHex(color?: string): string {
  return toHexColor(color);
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

// ── Stroke helpers (unifies CSS border/outline into one "position" concept
// design tools expose: inside/center/outside. CSS border is always drawn
// INSIDE the box; there is no native centered or outside border, so those
// two are simulated with `outline` — outline draws OUTSIDE the border edge
// by `outline-offset`, and a NEGATIVE offset of exactly -weight/2 pulls it
// inward to straddle the edge, which is what "center" looks like. ──

type StrokePosition = "inside" | "center" | "outside";

function readStroke(s: Record<string, string>): { position: StrokePosition; weight: number; color: string; alpha: number } {
  const outlineWidth = parseFloat(s["outline-width"]) || 0;
  const outlineActive = (s["outline-style"] || "none") !== "none" && outlineWidth > 0;
  if (outlineActive) {
    const offset = parseFloat(s["outline-offset"]) || 0;
    const position: StrokePosition = offset < 0 ? "center" : "outside";
    return { position, weight: outlineWidth, color: toHex(s["outline-color"]), alpha: parseAlpha(s["outline-color"]) };
  }
  const borderWidth = parseFloat(s["border-width"]) || 0;
  return { position: "inside", weight: borderWidth, color: toHex(s["border-color"] || "#000000"), alpha: parseAlpha(s["border-color"]) };
}

function writeStroke(
  updateMulti: (props: Record<string, string>) => void,
  next: { position: StrokePosition; weight: number; color: string; alpha: number },
) {
  const colorValue = next.alpha < 1 ? hexToRgba(next.color, next.alpha) : next.color;
  const visible = next.weight > 0;
  if (next.position === "inside") {
    updateMulti({
      "border-width": `${next.weight}px`, "border-style": visible ? "solid" : "none", "border-color": colorValue,
      "outline-width": "0", "outline-style": "none", "outline-offset": "0",
    });
  } else {
    updateMulti({
      "outline-width": `${next.weight}px`, "outline-style": visible ? "solid" : "none", "outline-color": colorValue,
      "outline-offset": next.position === "center" ? `${-next.weight / 2}px` : "0px",
      "border-width": "0", "border-style": "none",
    });
  }
}

// ── Box-shadow (Drop Shadow / Inner Shadow) helpers ──

interface ShadowEffect { x: number; y: number; blur: number; spread: number; color: string; alpha: number; inset: boolean }

function splitTopLevelCommas(str: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of str) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else { cur += ch; }
  }
  if (cur) out.push(cur);
  return out;
}

function parseBoxShadows(value: string): ShadowEffect[] {
  if (!value || value === "none") return [];
  return splitTopLevelCommas(value).map(part => {
    let str = part.trim();
    const inset = /\binset\b/.test(str);
    str = str.replace(/\binset\b/g, "").trim();
    const colorMatch = str.match(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}|\b[a-zA-Z]+\b/);
    let color = "#000000", alpha = 1;
    if (colorMatch) {
      color = toHexColor(colorMatch[0]);
      alpha = parseAlpha(colorMatch[0]);
      str = (str.slice(0, colorMatch.index) + str.slice((colorMatch.index || 0) + colorMatch[0].length)).trim();
    }
    const nums = str.split(/\s+/).filter(Boolean).map(v => parseFloat(v) || 0);
    const [x = 0, y = 0, blur = 0, spread = 0] = nums;
    return { x, y, blur, spread, color, alpha, inset };
  });
}

function formatShadow(sh: ShadowEffect): string {
  const color = sh.alpha < 1 ? hexToRgba(sh.color, sh.alpha) : sh.color;
  return `${sh.inset ? "inset " : ""}${sh.x}px ${sh.y}px ${sh.blur}px ${sh.spread}px ${color}`;
}

const DEFAULT_DROP_SHADOW: ShadowEffect = { x: 0, y: 4, blur: 8, spread: 0, color: "#000000", alpha: 0.15, inset: false };
const DEFAULT_INNER_SHADOW: ShadowEffect = { x: 0, y: 2, blur: 4, spread: 0, color: "#000000", alpha: 0.25, inset: true };

// ── filter/backdrop-filter chain helpers — get/set ONE function's args
// inside a chain without disturbing any other function already there (a
// photo's grayscale/contrast treatment, another effect's blur, etc). ──

function getFilterFn(filter: string, fnName: string): string | null {
  if (!filter || filter === "none") return null;
  const m = filter.match(new RegExp(`${fnName}\\(([^)]*)\\)`, "i"));
  return m ? m[1] : null;
}

function setFilterFn(filter: string, fnName: string, newValue: string | null): string {
  let current = filter && filter !== "none" ? filter : "";
  const re = new RegExp(`\\s*${fnName}\\([^)]*\\)`, "i");
  if (re.test(current)) {
    current = newValue !== null ? current.replace(re, ` ${fnName}(${newValue})`) : current.replace(re, "");
  } else if (newValue !== null) {
    current = current ? `${current} ${fnName}(${newValue})` : `${fnName}(${newValue})`;
  }
  return current.replace(/\s+/g, " ").trim() || "none";
}

// Noise/Texture/Dither — CSS has no native grain effect, so these render via
// an inline data-URI SVG feTurbulence filter chained onto `filter`, composited
// back over the element itself (feComposite over SourceGraphic) so the
// original content still shows through. The intensity is embedded in the
// filter's own id (e.g. "noise-filter-20") so re-reading the current value
// out of the CSS string is enough to know it's active and at what strength —
// no separate state needed, same principle as every other property here.
type NoiseKind = "noise" | "texture" | "dither";

function buildNoiseFilterTerm(kind: NoiseKind, intensity: number): string {
  const id = `${kind}-filter-${Math.round(intensity * 100)}`;
  const freq = kind === "noise" ? 0.9 : kind === "texture" ? 0.15 : 0.75;
  const octaves = kind === "texture" ? 3 : 2;
  const type = kind === "dither" ? "turbulence" : "fractalNoise";
  const svg = `<svg xmlns='http://www.w3.org/2000/svg'><filter id='${id}'>`
    + `<feTurbulence type='${type}' baseFrequency='${freq}' numOctaves='${octaves}' stitchTiles='stitch'/>`
    + `<feColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${intensity} 0'/>`
    + `<feComposite operator='over' in2='SourceGraphic'/>`
    + `</filter></svg>#${id}`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

function findNoiseFilter(filter: string, kind: NoiseKind): number | null {
  const m = (filter || "").match(new RegExp(`${kind}-filter-(\\d+)`));
  return m ? parseInt(m[1]) / 100 : null;
}

function setNoiseFilter(filter: string, kind: NoiseKind, intensity: number | null): string {
  const current = filter && filter !== "none" ? filter : "";
  const stripped = current
    .replace(/url\("data:image\/svg\+xml[^"]*"\)/g, m => (m.includes(`${kind}-filter`) ? "" : m))
    .replace(/\s+/g, " ").trim();
  if (intensity === null) return stripped || "none";
  const term = buildNoiseFilterTerm(kind, intensity);
  return (stripped ? `${stripped} ${term}` : term);
}

const smallBtn: React.CSSProperties = {
  fontSize: 9, padding: "3px 7px", borderRadius: 3,
  border: "1px solid rgba(200,184,152,0.15)", background: "rgba(200,184,152,0.05)",
  color: "#c8b898", cursor: "pointer",
};
const smallBtnActive: React.CSSProperties = {
  ...smallBtn, background: "rgba(200,184,152,0.18)", border: "1px solid #c8b898",
};

// ── Main Component ──

export function HtmlContextualPanel({
  workspaceId, element, selectedLayerIds, html, css, onCssChange, onChangeTag, onCopyStyle, onPasteStyle, hasClipboardStyle,
  onConvertToPath, onOutlineStroke, onOffsetPath, onShapeOptionsChange, onGroupModeChange,
  frameWidth, frameHeight, subTab,
}: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    position: true, layout: true, appearance: true, fill: true, stroke: true, effects: true,
    typography: true, groupmode: true, shape: true, spacing: true, border: true,
    flexgrid: true, oldposition: false, transform: false, transition: false, states: false,
  });
  const [activePseudo, setActivePseudo] = useState<string>(":hover");
  const [customCssText, setCustomCssText] = useState("");
  const [copied, setCopied] = useState<"html" | "css" | null>(null);

  const toggle = (s: string) => setExpanded(prev => ({ ...prev, [s]: !prev[s] }));

  /**
   * Every selector a change applies to. The panel is handed one element, so
   * each control wrote to that alone and a multi-selection had its fill —
   * and everything else — applied to a single object.
   *
   * Only the element's own selector fans out. A pseudo-element or a nested
   * selector passed by a specific control means that exact target.
   */
  const targetsFor = useCallback((selector: string) => (
    element && selector === element.selector
      ? styleTargets(element.selector, element.layerId, selectedLayerIds ?? [])
      : [selector]
  ), [element, selectedLayerIds]);

  const update = useCallback((selector: string, prop: string, value: string) => {
    let updated = css;
    for (const target of targetsFor(selector)) {
      updated = updateElementCssProperty(updated, target, prop, value);
      // Auto-set border-style to solid when border-width becomes non-zero
      if (prop === "border-width" && parseFloat(value) > 0) {
        const existingStyle = getCssPropertyValue(updated, target, "border-style");
        if (!existingStyle || existingStyle === "none") {
          updated = updateElementCssProperty(updated, target, "border-style", "solid");
        }
      }
    }
    if (prop === "font-family" && needsWebfont(value)) {
      // A hand-written list of installed families used to stand in for this,
      // and it could only ever go stale against the catalogue. Carrying a
      // fallback stack is the reliable signal that a font is already local.
      // The webfont is fetched once, not once per selected object.
      const fontName = primaryFamily(value);
      updated = ensureGoogleFontImport(updated, fontName);
      injectGoogleFontIntoFrames(fontName);
    }
    onCssChange(updated);
  }, [css, onCssChange, targetsFor]);

  const updateMulti = useCallback((selector: string, props: Record<string, string>) => {
    let updated = css;
    for (const target of targetsFor(selector)) {
      for (const [k, v] of Object.entries(props)) {
        updated = updateElementCssProperty(updated, target, k, v);
      }
    }
    onCssChange(updated);
  }, [css, onCssChange, targetsFor]);

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

  // ── Background image upload (reuses /api/assets/upload → design-assets bucket) ──
  const bgImageInputRef = useRef<HTMLInputElement>(null);

  const handleBgImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !element) return;
    try {
      // Shrunk here, where the file already is. A phone photo is routinely
      // 8-12MB and none of it survives being drawn into a frame.
      const { dataUrl: base64 } = await prepareImageForUpload(file);

      const result = await fetch(`/api/assets/upload`, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({ name: file.name.replace(/\.[^.]+$/, ""), data: base64, workspaceId }),
      }).then(r => r.json());

      if (!result.url) throw new Error("Upload succeeded but no URL returned");

      const bgValue = `url(${result.url}) center/cover no-repeat`;
      let updated = updateElementCssProperty(css, element.selector, "background-image", bgValue);
      updated = updateElementCssProperty(updated, element.selector, "background-size", "cover");
      onCssChange(updated);

      e.target.value = ""; // reset for re-upload of same file
    } catch (err: any) {
      console.error("[BG_IMAGE] Upload failed:", err);
    }
  }, [css, element, onCssChange, workspaceId]);

  // ── Code tab: this element's own markup + CSS rule, read from the frame ──
  const elementHtml = useMemo(() => {
    if (!element) return "";
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const el = doc.querySelector(element.selector);
      return el ? el.outerHTML : "";
    } catch { return ""; }
  }, [html, element?.selector]);

  const elementCss = useMemo(() => {
    if (!element) return "";
    const escaped = element.selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`, "g"));
    return matches ? matches.join("\n\n") : "";
  }, [css, element?.selector]);

  const copyText = (which: "html" | "css", text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  };

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
  const selector = element.selector;
  const isText = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "a", "li", "label", "button", "em", "strong", "small", "b", "i"].includes(element.tag);
  const isFlex = s["display"] === "flex" || s["display"] === "inline-flex";
  const isGrid = s["display"] === "grid" || s["display"] === "inline-grid";
  const isSvg = element.isSvg;
  const isSvgPath = isSvg && element.svgChildTag === "path";
  const isSvgShape = isSvg && ["path", "rect", "circle", "ellipse", "polygon", "polyline", "line"].includes(element.svgChildTag || "");
  const isSvgText = isSvg && element.svgChildTag === "text";
  const isImage = element.tag === "img";

  // ── Position category: align-to-frame ──
  const alignTo = (key: typeof ALIGN_BUTTONS[number]["key"]) => {
    const w = parseFloat(s["width"]) || 0;
    const h = parseFloat(s["height"]) || 0;
    if (key === "left") update(selector, "left", "0px");
    else if (key === "centerH") update(selector, "left", `${Math.round((frameWidth - w) / 2)}px`);
    else if (key === "right") update(selector, "left", `${Math.round(frameWidth - w)}px`);
    else if (key === "top") update(selector, "top", "0px");
    else if (key === "centerV") update(selector, "top", `${Math.round((frameHeight - h) / 2)}px`);
    else if (key === "bottom") update(selector, "top", `${Math.round(frameHeight - h)}px`);
  };

  const stroke = readStroke(s);
  const shadows = useMemo(() => parseBoxShadows(s["box-shadow"] || ""), [s["box-shadow"]]);
  const writeShadows = (next: ShadowEffect[]) => update(selector, "box-shadow", next.length ? next.map(formatShadow).join(", ") : "none");
  const layerBlur = getFilterFn(s["filter"] || "", "blur");
  const bgBlur = getFilterFn(s["backdrop-filter"] || "", "blur");
  const hasGlass = /saturate/.test(s["backdrop-filter"] || "");

  return (
    <div className="html-contextual-panel" style={panelStyle}>
      {/* ── Minimal header, shown on every sub-tab ── */}
      <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#c8b898" }}>{element.tag.toUpperCase()}</span>
        <span style={{ fontSize: 9, color: "#555", fontFamily: "monospace" }}>{selector.length > 30 ? selector.slice(0, 30) + "…" : selector}</span>
      </div>

      {subTab === "properties" && (
        <div style={{ overflow: "auto", flex: 1 }}>
          {/* ══ Position ══ */}
          <SectionHead label="Position" section="position" expanded={expanded} toggle={toggle} />
          {expanded.position && (
            <div style={sectionBody}>
              <div style={{ display: "flex", gap: 2 }}>
                {ALIGN_BUTTONS.map(a => (
                  <button key={a.key} type="button" title={a.title} onClick={() => alignTo(a.key)}
                    style={{ flex: 1, padding: "5px 0", borderRadius: 4, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.05)", color: "#c8b898" }}>
                    <AlignIcon type={a.key} />
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <InlineField label="X"><ScrubbyInput value={String(parseInt(s["left"]) || 0)} onChange={v => update(selector, "left", `${parseInt(v) || 0}px`)} /></InlineField>
                <InlineField label="Y"><ScrubbyInput value={String(parseInt(s["top"]) || 0)} onChange={v => update(selector, "top", `${parseInt(v) || 0}px`)} /></InlineField>
              </div>
              <PropRow label="Rotation">
                <ScrubbyInput value={extractTransformValue(s["transform"], "rotate") || "0"}
                  onChange={v => update(selector, "transform", setTransformFunction(s["transform"], "rotate", normalizeAngleValue(v)))} suffix="°" />
              </PropRow>
            </div>
          )}

          {/* ══ Layout ══ */}
          <SectionHead label="Layout" section="layout" expanded={expanded} toggle={toggle} />
          {expanded.layout && (
            <div style={sectionBody}>
              <div style={{ display: "flex", gap: 8 }}>
                <InlineField label="W"><ScrubbyInput value={s["width"] || ""} onChange={v => update(selector, "width", v)} /></InlineField>
                <InlineField label="H"><ScrubbyInput value={s["height"] || ""} onChange={v => update(selector, "height", v)} /></InlineField>
              </div>
            </div>
          )}

          {/* ══ Appearance ══ */}
          <SectionHead label="Appearance" section="appearance" expanded={expanded} toggle={toggle} />
          {expanded.appearance && (
            <div style={sectionBody}>
              <OpacityRow label="Opacity" value={s["opacity"] || "1"} onChange={v => update(selector, "opacity", v)} />
              <PropRow label="Radius">
                <ScrubbyInput value={s["border-radius"] || "0"} onChange={v => update(selector, "border-radius", v)} suffix="px" />
              </PropRow>
              <div style={{ display: "flex", gap: 4 }}>
                {(["top-left", "top-right", "bottom-right", "bottom-left"] as const).map(corner => (
                  <div key={corner} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                    <span style={{ fontSize: 8, color: "#555" }}>{corner.split("-").map(w => w[0]).join("")}</span>
                    <input value={s[`border-${corner}-radius`] || ""} placeholder="0" onChange={e => update(selector, `border-${corner}-radius`, e.target.value)} style={{ ...miniInp, width: 36, textAlign: "center" }} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ══ Fill ══ */}
          <SectionHead label="Fill" section="fill" expanded={expanded} toggle={toggle} />
          {expanded.fill && (
            <div style={sectionBody}>
              {isImage ? (
                <>
                  {element.src && (
                    <div style={{ borderRadius: 4, overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)", aspectRatio: "16/9", background: "rgba(0,0,0,0.3)" }}>
                      <img src={element.src} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                    </div>
                  )}
                  <OpacityRow label="Opacity" value={s["opacity"] || "1"} onChange={v => update(selector, "opacity", v)} />
                </>
              ) : isSvgShape ? (
                <>
                  <ColorRow label="Color" value={s["fill"] || s["color"] || "#c8b898"} onChange={v => update(selector, "fill", v)} />
                  <OpacityRow label="Opacity" value={s["fill-opacity"] || "1"} onChange={v => update(selector, "fill-opacity", v)} />
                </>
              ) : isSvgText ? (
                <>
                  <ColorRow label="Fill" value={s["fill"] || s["color"] || "#333"} onChange={v => update(selector, "fill", v)} />
                  <OpacityRow label="Opacity" value={s["fill-opacity"] || "1"} onChange={v => update(selector, "fill-opacity", v)} />
                </>
              ) : (
                <>
                  {isText && <ColorRow label="Text" value={s["color"] || ""} onChange={v => update(selector, "color", v)} />}
                  <ColorRow label={isText ? "BG" : "Fill"} value={s["background-color"] || s["background"] || ""} onChange={v => update(selector, "background-color", v)} />
                  <OpacityRow label="Opacity" value={s["opacity"] || "1"} onChange={v => update(selector, "opacity", v)} />
                  <GradientBuilder key={element.layerId} value={s["background-image"] || ""} onChange={(v) => update(selector, "background-image", v)} />
                  <PropRow label="Img">
                    <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} onChange={handleBgImageUpload} ref={bgImageInputRef} />
                    <button type="button" onClick={() => bgImageInputRef.current?.click()} style={smallBtn}>🖼 Image</button>
                  </PropRow>
                </>
              )}
            </div>
          )}

          {/* ══ Stroke ══ */}
          <SectionHead label="Stroke" section="stroke" expanded={expanded} toggle={toggle} />
          {expanded.stroke && (
            <div style={sectionBody}>
              {isSvgShape ? (
                <>
                  <div style={{ display: "flex", gap: 8 }}>
                    <InlineField label="Color">
                      <input type="color" value={toHex(s["stroke"])} onChange={e => update(selector, "stroke", e.target.value)} style={colorInp} />
                    </InlineField>
                    <InlineField label="Opacity">
                      <ScrubbyInput value={s["stroke-opacity"] || "1"} onChange={v => update(selector, "stroke-opacity", v)} min={0} max={1} step={0.01} />
                    </InlineField>
                  </div>
                  <PropRow label="Weight">
                    <ScrubbyInput value={s["stroke-width"] || "0"} onChange={v => update(selector, "stroke-width", v)} suffix="px" />
                  </PropRow>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 8 }}>
                    <InlineField label="Color">
                      <input type="color" value={stroke.color} onChange={e => writeStroke(props => updateMulti(selector, props), { ...stroke, color: e.target.value })} style={colorInp} />
                    </InlineField>
                    <InlineField label="Opacity">
                      <ScrubbyInput value={String(stroke.alpha)} min={0} max={1} step={0.01}
                        onChange={v => writeStroke(props => updateMulti(selector, props), { ...stroke, alpha: Math.max(0, Math.min(1, parseFloat(v) || 0)) })} />
                    </InlineField>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <InlineField label="Position">
                      <select value={stroke.position} onChange={e => writeStroke(props => updateMulti(selector, props), { ...stroke, position: e.target.value as StrokePosition })} style={sel}>
                        <option value="inside">Inside</option>
                        <option value="center">Center</option>
                        <option value="outside">Outside</option>
                      </select>
                    </InlineField>
                    <InlineField label="Weight">
                      <ScrubbyInput value={String(stroke.weight)} min={0}
                        onChange={v => writeStroke(props => updateMulti(selector, props), { ...stroke, weight: Math.max(0, parseInt(v) || 0) })} suffix="px" />
                    </InlineField>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ══ Effects ══ */}
          <SectionHead label="Effects" section="effects" expanded={expanded} toggle={toggle} />
          {expanded.effects && (
            <div style={sectionBody}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                <button type="button" style={smallBtn} onClick={() => writeShadows([...shadows, DEFAULT_DROP_SHADOW])}>+ Drop Shadow</button>
                <button type="button" style={smallBtn} onClick={() => writeShadows([...shadows, DEFAULT_INNER_SHADOW])}>+ Inner Shadow</button>
                <button type="button" style={layerBlur != null ? smallBtnActive : smallBtn}
                  onClick={() => update(selector, "filter", setFilterFn(s["filter"] || "", "blur", layerBlur != null ? null : "8px"))}>
                  Layer Blur
                </button>
                <button type="button" style={bgBlur != null ? smallBtnActive : smallBtn}
                  onClick={() => update(selector, "backdrop-filter", setFilterFn(s["backdrop-filter"] || "", "blur", bgBlur != null ? null : "12px"))}>
                  Background Blur
                </button>
                <button type="button" style={hasGlass ? smallBtnActive : smallBtn}
                  onClick={() => update(selector, "backdrop-filter", hasGlass
                    ? setFilterFn(s["backdrop-filter"] || "", "saturate", null)
                    : setFilterFn(setFilterFn(s["backdrop-filter"] || "", "blur", bgBlur ?? "12px"), "saturate", "1.8"))}>
                  Glass
                </button>
                {(["noise", "texture", "dither"] as NoiseKind[]).map(kind => {
                  const active = findNoiseFilter(s["filter"] || "", kind);
                  return (
                    <button key={kind} type="button" style={active != null ? smallBtnActive : smallBtn}
                      onClick={() => update(selector, "filter", setNoiseFilter(s["filter"] || "", kind, active != null ? null : 0.2))}>
                      {kind[0].toUpperCase() + kind.slice(1)}
                    </button>
                  );
                })}
              </div>

              {shadows.map((sh, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 3, padding: "6px", borderRadius: 4, background: "rgba(15,15,15,0.35)", border: "1px solid rgba(255,255,255,0.04)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 9, color: "#7a7668", textTransform: "uppercase" }}>{sh.inset ? "Inner Shadow" : "Drop Shadow"}</span>
                    <button type="button" onClick={() => writeShadows(shadows.filter((_, j) => j !== i))}
                      style={{ fontSize: 10, padding: "1px 5px", borderRadius: 2, border: "none", background: "rgba(239,68,68,0.15)", color: "#EF4444", cursor: "pointer" }}>×</button>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <InlineField label="X"><ScrubbyInput value={String(sh.x)} onChange={v => writeShadows(shadows.map((x, j) => j === i ? { ...x, x: parseInt(v) || 0 } : x))} /></InlineField>
                    <InlineField label="Y"><ScrubbyInput value={String(sh.y)} onChange={v => writeShadows(shadows.map((x, j) => j === i ? { ...x, y: parseInt(v) || 0 } : x))} /></InlineField>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <InlineField label="Blur"><ScrubbyInput value={String(sh.blur)} min={0} onChange={v => writeShadows(shadows.map((x, j) => j === i ? { ...x, blur: Math.max(0, parseInt(v) || 0) } : x))} /></InlineField>
                    <InlineField label="Spread"><ScrubbyInput value={String(sh.spread)} onChange={v => writeShadows(shadows.map((x, j) => j === i ? { ...x, spread: parseInt(v) || 0 } : x))} /></InlineField>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <InlineField label="Color"><input type="color" value={sh.color} onChange={e => writeShadows(shadows.map((x, j) => j === i ? { ...x, color: e.target.value } : x))} style={colorInp} /></InlineField>
                    <InlineField label="Opacity"><ScrubbyInput value={String(sh.alpha)} min={0} max={1} step={0.01} onChange={v => writeShadows(shadows.map((x, j) => j === i ? { ...x, alpha: Math.max(0, Math.min(1, parseFloat(v) || 0)) } : x))} /></InlineField>
                  </div>
                </div>
              ))}

              {layerBlur != null && (
                <PropRow label="Layer Blur">
                  <ScrubbyInput value={String(parseFloat(layerBlur) || 0)} min={0} onChange={v => update(selector, "filter", setFilterFn(s["filter"] || "", "blur", `${Math.max(0, parseInt(v) || 0)}px`))} suffix="px" />
                </PropRow>
              )}
              {bgBlur != null && (
                <PropRow label="BG Blur">
                  <ScrubbyInput value={String(parseFloat(bgBlur) || 0)} min={0} onChange={v => update(selector, "backdrop-filter", setFilterFn(s["backdrop-filter"] || "", "blur", `${Math.max(0, parseInt(v) || 0)}px`))} suffix="px" />
                </PropRow>
              )}
              {(["noise", "texture", "dither"] as NoiseKind[]).map(kind => {
                const active = findNoiseFilter(s["filter"] || "", kind);
                if (active == null) return null;
                return (
                  <OpacityRow key={kind} label={kind[0].toUpperCase() + kind.slice(1)} value={String(active)}
                    onChange={v => update(selector, "filter", setNoiseFilter(s["filter"] || "", kind, Math.max(0, Math.min(1, parseFloat(v) || 0))))} />
                );
              })}
            </div>
          )}

          {/* ══ Typography (moved here from "animation" — text props belong in Properties) ══ */}
          {(isText || isSvgText) && (
            <>
              <SectionHead label="Typography" section="typography" expanded={expanded} toggle={toggle} />
              {expanded.typography && (
                <div style={sectionBody}>
                  <PropRow label="Font">
                    <GoogleFontPicker value={primaryFamily(s["font-family"] || "")} onChange={(f) => update(selector, "font-family", cssFontFamily(f))} />
                  </PropRow>
                  <PropRow label="Size">
                    <ScrubbyInput value={s["font-size"] || ""} onChange={v => update(selector, "font-size", v)} label="" suffix="px" />
                  </PropRow>
                  <SelectRow label="Weight" value={s["font-weight"] || "400"} options={FONT_WEIGHTS} onChange={v => update(selector, "font-weight", v)} />
                  <PropRow label="Align">
                    <div style={{ display: "flex", gap: 2, flex: 1 }}>
                      {TEXT_ALIGNMENTS.map(a => (
                        <button key={a.value} type="button" title={a.title}
                          onClick={() => update(selector, "text-align", a.value)}
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
                    <ScrubbyInput value={s["letter-spacing"] || "normal"} onChange={v => update(selector, "letter-spacing", v)} />
                  </PropRow>
                  <PropRow label="Line-H">
                    <ScrubbyInput value={s["line-height"] || ""} onChange={v => update(selector, "line-height", v)} />
                  </PropRow>
                  <SelectRow label="Deco" value={s["text-decoration"] || "none"} options={TEXT_DECORATIONS} onChange={v => update(selector, "text-decoration", v)} />
                  <SelectRow label="Case" value={s["text-transform"] || "none"} options={TEXT_TRANSFORMS} onChange={v => update(selector, "text-transform", v)} />
                  <PropRow label="Txt Shadow">
                    <input value={s["text-shadow"] || "none"} placeholder="0 2px 4px rgba(0,0,0,0.2)" onChange={e => update(selector, "text-shadow", e.target.value)} style={inp} />
                  </PropRow>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {subTab === "code" && (
        <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 10, overflow: "auto", flex: 1 }}>
          {onChangeTag && !isSvg && (
            <div>
              <div style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Tag</div>
              <select value={element.tag} onChange={e => onChangeTag(e.target.value)}
                style={{ width: "100%", background: "rgba(15,15,15,0.5)", border: "1px solid rgba(200,184,152,0.2)", color: "#c8b898", borderRadius: 4, padding: "4px 6px", fontSize: 11, fontFamily: "monospace", cursor: "pointer" }}>
                {SEMANTIC_TAGS.map(tag => <option key={tag} value={tag}>{`<${tag}>`}</option>)}
              </select>
            </div>
          )}

          {(onCopyStyle || onConvertToPath) && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {onCopyStyle && <button type="button" onClick={onCopyStyle} style={smallBtn}>📋 Copy style</button>}
              {onPasteStyle && <button type="button" onClick={onPasteStyle} disabled={!hasClipboardStyle} style={{ ...smallBtn, opacity: hasClipboardStyle ? 1 : 0.4, cursor: hasClipboardStyle ? "pointer" : "not-allowed" }}>📎 Paste style</button>}
              {onConvertToPath && !isSvg && !isText && <button type="button" onClick={() => onConvertToPath(element.layerId, element.frameId)} style={smallBtn}>⬢→Path</button>}
            </div>
          )}

          {onGroupModeChange && !!element.childLayerCount && !isSvg && (
            <div>
              <div style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Tipo de grupo</div>
              <div style={{ display: "flex", gap: 4 }}>
                {([
                  { mode: "group" as const, label: "Grupo", hint: "Posiciones fijas: cada hijo es dueño de su lugar y tipografía. Desagrupar no cambia nada." },
                  { mode: "container" as const, label: "Contenedor", hint: "Auto layout: los hijos fluyen (columna/fila/gap) y heredan estilos del contenedor." },
                ]).map(({ mode, label, hint }) => {
                  const active = mode === "group" ? element.layerKind === "group" : element.layerKind !== "group";
                  return (
                    <button key={mode} type="button" title={hint}
                      onClick={() => !active && onGroupModeChange(element.layerId, element.frameId, mode)}
                      style={{ flex: 1, padding: "5px 8px", borderRadius: 6, fontSize: 11, cursor: active ? "default" : "pointer",
                        background: active ? "rgba(200,184,152,0.14)" : "rgba(15,15,15,0.5)",
                        border: active ? "1px solid #c8b898" : "1px solid rgba(255,255,255,0.06)",
                        color: active ? "#c8b898" : "#7a7668" }}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1 }}>HTML</span>
              <button type="button" onClick={() => copyText("html", elementHtml)} style={smallBtn}>{copied === "html" ? "Copied" : "Copy"}</button>
            </div>
            <pre style={{ background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 4, padding: 8, fontSize: 10.5, fontFamily: "monospace", color: "#c8c4b4", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 160, overflow: "auto", margin: 0 }}>
              {elementHtml || "(sin markup)"}
            </pre>
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1 }}>CSS</span>
              <button type="button" onClick={() => copyText("css", elementCss)} style={smallBtn}>{copied === "css" ? "Copied" : "Copy"}</button>
            </div>
            <pre style={{ background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 4, padding: 8, fontSize: 10.5, fontFamily: "monospace", color: "#c8c4b4", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 160, overflow: "auto", margin: 0 }}>
              {elementCss || "(sin reglas propias)"}
            </pre>
          </div>

          <div>
            <div style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Custom CSS</div>
            <textarea
              value={customCssText}
              onChange={e => setCustomCssText(e.target.value)}
              placeholder={"background: linear-gradient(...);\nbackdrop-filter: blur(10px);\nfont-variant-numeric: tabular-nums;"}
              style={{ ...inp, minHeight: 70, resize: "vertical", fontFamily: "monospace", fontSize: 10, width: "100%" }}
            />
            <button type="button" onClick={applyCustomCss} style={{ ...smallBtn, marginTop: 4, padding: "4px 10px" }}>
              Apply to {selector.length > 20 ? selector.slice(0, 20) + "…" : selector}
            </button>
          </div>
        </div>
      )}

      {subTab === "animation" && (
        <div style={{ overflow: "auto", flex: 1 }}>
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
                </div>
              )}
            </>
          )}

          {/* ── Stroke details (SVG paths only): linecap/join/dash + path ops ── */}
          {isSvgPath && (
            <>
              <SectionHead label="Stroke Detail" section="stroke" expanded={expanded} toggle={toggle} />
              {expanded.stroke && (
                <div style={sectionBody}>
                  <SelectRow label="Linecap" value={s["stroke-linecap"] || "round"} options={[
                    { label: "Butt", value: "butt" }, { label: "Round", value: "round" }, { label: "Square", value: "square" },
                  ]} onChange={v => update(selector, "stroke-linecap", v)} />
                  <SelectRow label="Linejoin" value={s["stroke-linejoin"] || "round"} options={[
                    { label: "Miter", value: "miter" }, { label: "Round", value: "round" }, { label: "Bevel", value: "bevel" },
                  ]} onChange={v => update(selector, "stroke-linejoin", v)} />
                  <PropRow label="Dash">
                    <input value={s["stroke-dasharray"] || ""} placeholder="4 4" onChange={e => update(selector, "stroke-dasharray", e.target.value)} style={inp} />
                  </PropRow>
                  {(onOutlineStroke || onOffsetPath) && (
                    <div style={{ display: "flex", gap: 6, marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(200,184,152,0.1)" }}>
                      {onOutlineStroke && (
                        <button type="button" onClick={() => onOutlineStroke(element.layerId, element.frameId)} style={{ ...smallBtn, flex: 1 }}>⬢ Outline Stroke</button>
                      )}
                      {onOffsetPath && (
                        <>
                          <button type="button" onClick={() => onOffsetPath(element.layerId, element.frameId, -4)} style={smallBtn}>⊖ Inset</button>
                          <button type="button" onClick={() => onOffsetPath(element.layerId, element.frameId, 4)} style={smallBtn}>⊕ Outset</button>
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
                  <SpacingBox label="Margin" prefix="margin" styles={s} onUpdate={(p, v) => update(selector, p, v)} />
                  <SpacingBox label="Padding" prefix="padding" styles={s} onUpdate={(p, v) => update(selector, p, v)} />
                </div>
              )}
            </>
          )}

          {/* ── Border style/color (radius lives in Properties → Appearance) ── */}
          {!isSvgShape && (
            <>
              <SectionHead label="Border" section="border" expanded={expanded} toggle={toggle} />
              {expanded.border && (
                <div style={sectionBody}>
                  <SelectRow label="Style" value={s["border-style"] || "none"} options={[
                    { label: "None", value: "none" }, { label: "Solid", value: "solid" }, { label: "Dashed", value: "dashed" },
                    { label: "Dotted", value: "dotted" }, { label: "Double", value: "double" }, { label: "Groove", value: "groove" },
                    { label: "Ridge", value: "ridge" }, { label: "Inset", value: "inset" }, { label: "Outset", value: "outset" },
                  ]} onChange={v => update(selector, "border-style", v)} />
                  <ColorRow label="Color" value={s["border-color"] || "#000000"} onChange={v => update(selector, "border-color", v)} />
                </div>
              )}
            </>
          )}

          {/* ── Blend mode ── */}
          {!isSvgShape && !isSvgText && (
            <>
              <SectionHead label="Blend" section="blend" expanded={expanded} toggle={toggle} />
              {expanded.blend !== false && (
                <div style={sectionBody}>
                  <SelectRow label="Blend" value={s["mix-blend-mode"] || "normal"} options={BLEND_MODES.map(b => ({ label: b, value: b }))} onChange={v => update(selector, "mix-blend-mode", v)} />
                </div>
              )}
            </>
          )}

          {/* ── Layout (Flex/Grid/Overflow) ── */}
          {!isSvgShape && (
            <>
              <SectionHead label="Flex / Grid" section="flexgrid" expanded={expanded} toggle={toggle} />
              {expanded.flexgrid && (
                <div style={sectionBody}>
                  <SelectRow label="Display" value={s["display"] || "block"} options={[
                    { label: "Block", value: "block" }, { label: "Flex", value: "flex" }, { label: "Grid", value: "grid" },
                    { label: "Inline", value: "inline" }, { label: "Inline-Block", value: "inline-block" },
                    { label: "Inline-Flex", value: "inline-flex" }, { label: "None", value: "none" },
                  ]} onChange={v => update(selector, "display", v)} />
                  <PropRow label="Gap"><ScrubbyInput value={s["gap"] || ""} onChange={v => update(selector, "gap", v)} /></PropRow>

                  {isFlex && (
                    <>
                      <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 4, marginTop: 2 }} />
                      <SelectRow label="Dir" value={s["flex-direction"] || "row"} options={FLEX_DIRECTIONS} onChange={v => update(selector, "flex-direction", v)} />
                      <SelectRow label="Justify" value={s["justify-content"] || "flex-start"} options={JUSTIFY_CONTENTS} onChange={v => update(selector, "justify-content", v)} />
                      <SelectRow label="Align" value={s["align-items"] || "stretch"} options={ALIGN_ITEMS} onChange={v => update(selector, "align-items", v)} />
                      <SelectRow label="Wrap" value={s["flex-wrap"] || "nowrap"} options={FLEX_WRAPS} onChange={v => update(selector, "flex-wrap", v)} />
                      <PropRow label="Grow"><ScrubbyInput value={s["flex-grow"] || "0"} onChange={v => update(selector, "flex-grow", v)} /></PropRow>
                      <PropRow label="Shrink"><ScrubbyInput value={s["flex-shrink"] || "1"} onChange={v => update(selector, "flex-shrink", v)} /></PropRow>
                      <PropRow label="Basis"><input value={s["flex-basis"] || "auto"} onChange={e => update(selector, "flex-basis", e.target.value)} style={inp} /></PropRow>
                      <SelectRow label="Self" value={s["align-self"] || "auto"} options={[{ label: "Auto", value: "auto" }, ...ALIGN_ITEMS]} onChange={v => update(selector, "align-self", v)} />
                      <PropRow label="Order"><ScrubbyInput value={s["order"] || "0"} onChange={v => update(selector, "order", v)} /></PropRow>
                    </>
                  )}

                  {isGrid && (
                    <>
                      <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 4, marginTop: 2 }} />
                      <PropRow label="Cols"><input value={s["grid-template-columns"] || ""} placeholder="1fr 1fr" onChange={e => update(selector, "grid-template-columns", e.target.value)} style={inp} /></PropRow>
                      <PropRow label="Rows"><input value={s["grid-template-rows"] || ""} placeholder="auto auto" onChange={e => update(selector, "grid-template-rows", e.target.value)} style={inp} /></PropRow>
                      <PropRow label="Gap"><ScrubbyInput value={s["grid-gap"] || s["gap"] || ""} onChange={v => update(selector, "grid-gap", v)} /></PropRow>
                    </>
                  )}

                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 4, marginTop: 2 }} />
                  <SelectRow label="Overflow" value={s["overflow"] || "visible"} options={OVERFLOWS.map(o => ({ label: o.charAt(0).toUpperCase() + o.slice(1), value: o }))} onChange={v => update(selector, "overflow", v)} />
                </div>
              )}
            </>
          )}

          {/* ── Position details (type, edges beyond X/Y, z-index) ── */}
          <SectionHead label="Position Detail" section="oldposition" expanded={expanded} toggle={toggle} />
          {expanded.oldposition && (
            <div style={sectionBody}>
              <SelectRow label="Type" value={s["position"] || "static"} options={POSITIONS.map(p => ({ label: p.charAt(0).toUpperCase() + p.slice(1), value: p }))} onChange={v => update(selector, "position", v)} />
              <PropRow label="Right"><ScrubbyInput value={s["right"] || ""} onChange={v => update(selector, "right", v)} /></PropRow>
              <PropRow label="Bottom"><ScrubbyInput value={s["bottom"] || ""} onChange={v => update(selector, "bottom", v)} /></PropRow>
              <PropRow label="Z-Index"><ScrubbyInput value={s["z-index"] || "0"} onChange={v => update(selector, "z-index", v)} /></PropRow>
            </div>
          )}

          {/* ── Transform detail (scale/skew/origin — rotation lives in Properties → Position) ── */}
          <SectionHead label="Transform Detail" section="transform" expanded={expanded} toggle={toggle} />
          {expanded.transform && (
            <div style={sectionBody}>
              <PropRow label="Scale X">
                <ScrubbyInput value={extractTransformValue(s["transform"], "scaleX") || "1"} onChange={v => update(selector, "transform", setTransformFunction(s["transform"], "scaleX", v))} />
              </PropRow>
              <PropRow label="Scale Y">
                <ScrubbyInput value={extractTransformValue(s["transform"], "scaleY") || "1"} onChange={v => update(selector, "transform", setTransformFunction(s["transform"], "scaleY", v))} />
              </PropRow>
              <PropRow label="Skew X">
                <ScrubbyInput value={extractTransformValue(s["transform"], "skewX") || "0"} onChange={v => update(selector, "transform", setTransformFunction(s["transform"], "skewX", normalizeAngleValue(v)))} suffix="°" />
              </PropRow>
              <PropRow label="Skew Y">
                <ScrubbyInput value={extractTransformValue(s["transform"], "skewY") || "0"} onChange={v => update(selector, "transform", setTransformFunction(s["transform"], "skewY", normalizeAngleValue(v)))} suffix="°" />
              </PropRow>
              <SelectRow label="Origin" value={s["transform-origin"] || "center"} options={TRANSFORM_ORIGINS.map(o => ({ label: o, value: o }))} onChange={v => update(selector, "transform-origin", v)} />
            </div>
          )}

          {/* ── Transition ── */}
          <SectionHead label="Transition" section="transition" expanded={expanded} toggle={toggle} />
          {expanded.transition && (
            <div style={sectionBody}>
              <PropRow label="Property">
                <input value={extractTransitionPart(s["transition"], 0) || "all"} placeholder="all" onChange={e => update(selector, "transition", mergeTransition(s["transition"], 0, e.target.value))} style={inp} />
              </PropRow>
              <PropRow label="Duration">
                <ScrubbyInput value={extractTransitionPart(s["transition"], 1) || "0.3s"} onChange={v => update(selector, "transition", mergeTransition(s["transition"], 1, normalizeTimeValue(v)))} suffix="s" />
              </PropRow>
              <SelectRow label="Easing" value={extractTransitionPart(s["transition"], 2) || "ease"} options={EASINGS.map(e => ({ label: e, value: e }))} onChange={v => update(selector, "transition", mergeTransition(s["transition"], 2, v))} />
              <PropRow label="Delay">
                <ScrubbyInput value={extractTransitionPart(s["transition"], 3) || "0s"} onChange={v => update(selector, "transition", mergeTransition(s["transition"], 3, normalizeTimeValue(v)))} suffix="s" />
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
                Editing: <code style={{ color: "#c8b898" }}>{selector}{activePseudo}</code>
              </div>
              <ColorRow label="Color" value="" onChange={v => onCssChange(updatePseudoCss(css, selector, activePseudo, { color: v }))} />
              <ColorRow label="BG" value="" onChange={v => onCssChange(updatePseudoCss(css, selector, activePseudo, { "background-color": v }))} />
              <PropRow label="Shadow">
                <input value="" placeholder="0 4px 12px rgba(0,0,0,0.2)" onChange={e => onCssChange(updatePseudoCss(css, selector, activePseudo, { "box-shadow": e.target.value }))} style={inp} />
              </PropRow>
              <PropRow label="Transform">
                <input value="" placeholder="scale(1.05)" onChange={e => onCssChange(updatePseudoCss(css, selector, activePseudo, { transform: e.target.value }))} style={inp} />
              </PropRow>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Gradient parsing ──
// Split on top-level commas only (a paren-depth counter, not a naive regex
// split) — a color-stop list like "rgb(1,2,3) 0%, rgb(4,5,6) 100%" has
// commas INSIDE the rgb() calls that must not become stop boundaries.
const GRADIENT_DIRECTION_ANGLES: Record<string, number> = {
  top: 0, bottom: 180, left: 270, right: 90,
  "top right": 45, "right top": 45, "bottom right": 135, "right bottom": 135,
  "bottom left": 225, "left bottom": 225, "top left": 315, "left top": 315,
};

interface GradientStop { color: string; alpha: number; pos: number }
interface ParsedGradient { type: "linear" | "radial" | "conic"; angle: number; stops: GradientStop[] }

/**
 * Parse ANY CSS gradient — critically, one whose colors come back from
 * getComputedStyle() as rgb()/rgba(), which is what the browser always
 * reports regardless of how the source CSS was authored. The previous
 * parser only matched literal #hex via regex, so it silently failed on
 * every computed value, leaving the UI stuck showing its hardcoded purple
 * placeholder instead of the design's real gradient — editing then meant
 * "Apply" overwrote the real gradient with that placeholder.
 */
function parseGradientValue(value: string): ParsedGradient | null {
  if (!value || value === "none") return null;
  const typeMatch = value.match(/(linear|radial|conic)-gradient\(/);
  if (!typeMatch) return null;
  const type = typeMatch[1] as "linear" | "radial" | "conic";
  const openIdx = value.indexOf(typeMatch[0]) + typeMatch[0].length - 1;
  let depth = 0, end = -1;
  for (let i = openIdx; i < value.length; i++) {
    if (value[i] === "(") depth++;
    else if (value[i] === ")") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return null;
  const parts = splitTopLevelCommas(value.slice(openIdx + 1, end)).map(p => p.trim());
  if (!parts.length) return null;

  let angle = 90;
  let stopParts = parts;
  const first = parts[0] || "";
  if (type === "linear") {
    const angleMatch = first.match(/^(-?[\d.]+)deg$/);
    if (angleMatch) { angle = parseFloat(angleMatch[1]); stopParts = parts.slice(1); }
    else if (/^to\s+/i.test(first)) {
      angle = GRADIENT_DIRECTION_ANGLES[first.replace(/^to\s+/i, "").trim().toLowerCase()] ?? 90;
      stopParts = parts.slice(1);
    }
  } else {
    // radial()/conic()'s leading shape/position descriptor ("circle at
    // center", "from 45deg") has no color. A real stop is just a color
    // token optionally followed by one "N%" and nothing else — anything
    // that doesn't fit that shape is the descriptor, not the first stop.
    const angleMatch = first.match(/from\s+(-?[\d.]+)deg/);
    if (angleMatch) angle = parseFloat(angleMatch[1]);
    const isJustAStop = /^(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}|[a-zA-Z]+)\s*(-?[\d.]+%)?\s*$/.test(first);
    if (!isJustAStop && parts.length > 1) stopParts = parts.slice(1);
  }

  const stops: GradientStop[] = [];
  stopParts.forEach((p, i) => {
    const colorMatch = p.match(/^(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}|[a-zA-Z]+)/);
    if (!colorMatch) return;
    const colorToken = colorMatch[0];
    const rest = p.slice(colorToken.length).trim();
    const pctMatch = rest.match(/(-?[\d.]+)%/);
    stops.push({
      color: toHexColor(colorToken),
      alpha: parseAlpha(colorToken),
      pos: pctMatch ? parseFloat(pctMatch[1]) : Math.round((i / Math.max(1, stopParts.length - 1)) * 100),
    });
  });
  return stops.length >= 2 ? { type, angle, stops } : null;
}

function buildGradientCss(g: ParsedGradient): string {
  const stopsStr = g.stops.map(s => `${s.alpha < 1 ? hexToRgba(s.color, s.alpha) : s.color} ${s.pos}%`).join(", ");
  if (g.type === "linear") return `linear-gradient(${g.angle}deg, ${stopsStr})`;
  if (g.type === "radial") return `radial-gradient(circle, ${stopsStr})`;
  return `conic-gradient(from ${g.angle}deg, ${stopsStr})`;
}

const DEFAULT_NEW_GRADIENT: ParsedGradient = {
  type: "linear", angle: 90,
  stops: [{ color: "#667eea", alpha: 1, pos: 0 }, { color: "#764ba2", alpha: 1, pos: 100 }],
};

// ── Gradient Builder Component ──

function GradientBuilder({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [gradient, setGradient] = useState<ParsedGradient | null>(() => parseGradientValue(value));
  const [expanded, setExpanded] = useState(false);
  // Tracks the CSS string WE last emitted, so an incoming `value` that only
  // echoes our own edit doesn't re-parse and reset mid-drag — but a value
  // that changed for any OTHER reason (undo, another collaborator, the AI
  // editing this same element) does re-sync the editor to it.
  const lastAppliedRef = useRef<string | null>(null);

  useEffect(() => {
    if (value === lastAppliedRef.current) return;
    setGradient(parseGradientValue(value));
  }, [value]);

  const apply = useCallback((next: ParsedGradient) => {
    setGradient(next);
    const css = buildGradientCss(next);
    lastAppliedRef.current = css;
    onChange(css);
  }, [onChange]);

  const removeGradient = useCallback(() => {
    setGradient(null);
    lastAppliedRef.current = "none";
    onChange("none");
  }, [onChange]);

  if (!gradient) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 9, color: "#7a7668", textTransform: "uppercase" }}>Gradient</span>
        <button type="button" onClick={() => apply(DEFAULT_NEW_GRADIENT)}
          style={{ fontSize: 10, padding: "5px 8px", borderRadius: 4, border: "1px dashed rgba(200,184,152,0.25)", background: "none", color: "#c8b898", cursor: "pointer" }}>
          + Add Gradient
        </button>
      </div>
    );
  }

  const previewStyle: React.CSSProperties = {
    height: 20, borderRadius: 4,
    background: buildGradientCss(gradient),
    border: "1px solid rgba(255,255,255,0.06)",
    cursor: "pointer",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 9, color: "#7a7668", textTransform: "uppercase" }}>Gradient</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button type="button" onClick={removeGradient} title="Remove gradient"
            style={{ fontSize: 9, color: "#EF4444", background: "none", border: "none", cursor: "pointer" }}>
            Remove
          </button>
          <button type="button" onClick={() => setExpanded(!expanded)}
            style={{ fontSize: 9, color: "#c8b898", background: "none", border: "none", cursor: "pointer" }}>
            {expanded ? "−" : "+"}
          </button>
        </div>
      </div>
      <div onClick={() => setExpanded(!expanded)} style={previewStyle} title="Click to expand" />
      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "4px 0" }}>
          {/* Type */}
          <div style={{ display: "flex", gap: 4 }}>
            {(["linear", "radial", "conic"] as const).map(t => (
              <button key={t} type="button" onClick={() => apply({ ...gradient, type: t })}
                style={{
                  flex: 1, fontSize: 9, padding: "2px 4px", borderRadius: 3,
                  border: gradient.type === t ? "1px solid #c8b898" : "1px solid rgba(255,255,255,0.06)",
                  background: gradient.type === t ? "rgba(200,184,152,0.12)" : "rgba(15,15,15,0.5)",
                  color: gradient.type === t ? "#c8b898" : "#7a7668",
                  cursor: "pointer", textTransform: "capitalize",
                }}>
                {t}
              </button>
            ))}
          </div>
          {/* Angle (linear/conic only — radial's "circle" has no direction) */}
          {gradient.type !== "radial" && (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 9, color: "#7a7668", width: 32 }}>Angle</span>
              <ScrubbyInput value={String(gradient.angle)} onChange={v => apply({ ...gradient, angle: parseInt(v) || 0 })} min={0} max={360} suffix="°" />
            </div>
          )}
          {/* Color Stops */}
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 9, color: "#7a7668" }}>Stops</span>
            {gradient.stops.map((stop, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input type="color" value={stop.color} onChange={e => {
                  const newStops = [...gradient.stops];
                  newStops[i] = { ...newStops[i], color: e.target.value };
                  apply({ ...gradient, stops: newStops });
                }} style={{ ...colorInp, width: 22, height: 18 }} />
                <input value={stop.color} onChange={e => {
                  const newStops = [...gradient.stops];
                  newStops[i] = { ...newStops[i], color: toHexColor(e.target.value, newStops[i].color) };
                  apply({ ...gradient, stops: newStops });
                }} style={{ ...inp, fontSize: 10, width: 64 }} />
                <ScrubbyInput value={String(stop.pos)} onChange={v => {
                  const newStops = [...gradient.stops];
                  newStops[i] = { ...newStops[i], pos: parseInt(v) || 0 };
                  apply({ ...gradient, stops: newStops });
                }} min={0} max={100} suffix="%" style={{ flex: 1 }} />
                {gradient.stops.length > 2 && (
                  <button type="button" onClick={() => apply({ ...gradient, stops: gradient.stops.filter((_, j) => j !== i) })}
                    style={{ fontSize: 10, padding: "1px 4px", borderRadius: 2, border: "none", background: "rgba(239,68,68,0.15)", color: "#EF4444", cursor: "pointer" }}>
                    ×
                  </button>
                )}
              </div>
            ))}
            {gradient.stops.length < 8 && (
              <button type="button" onClick={() => apply({ ...gradient, stops: [...gradient.stops, { color: "#A78BFA", alpha: 1, pos: 50 }] })}
                style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, border: "1px dashed rgba(200,184,152,0.2)", background: "none", color: "#c8b898", cursor: "pointer" }}>
                + Add Stop
              </button>
            )}
          </div>
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
      {label} <span>{expanded[section] ? "▾" : "▸"}</span>
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
