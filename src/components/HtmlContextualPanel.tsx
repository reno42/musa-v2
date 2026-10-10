import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import type { SelectedElementInfo, ShapeOptions } from "./DesignFrame";
import { frameRichTextRegistry, MIXED_TEXT_STYLE, type RichTextProperty } from "../lib/richText";
import { GoogleFontPicker } from "./GoogleFontPicker";
import { setTransformFunction, removeTransformFunction, updateCssProperty as setCssProperty, getCssPropertyValue } from "../lib/cssMutations";
import { ensureGoogleFontImport, injectGoogleFontIntoFrames } from "../lib/googleFonts";
import { cssFontFamily, needsWebfont, primaryFamily } from "../lib/fontFamily";
import { styleTargets } from "../lib/selectionModel";
import { isGroupLayer, paintPropertiesFor, summarizeFills } from "../../shared/paintModel.ts";
import { getApiHeaders } from "../lib/apiKey";
import { prepareImageForUpload } from "../lib/imageCompress";
import { toHexColor, formatColor, parseColorText, hexToRgb, rgbToHsv, hsvToRgb, type ColorFormat } from "../lib/colorUtils";
import { isCmykSafe, clampToCmykGamut } from "../lib/cmykGamut";
import { SPOT_INKS, SPOT_NONE, findSpotInk } from "../lib/spotColors";
import {
  splitTopLevelCommas,
  parseGradientValue,
  buildGradientCss,
  gradientColorAt,
  DEFAULT_NEW_GRADIENT,
  type ParsedGradient,
} from "../lib/gradient";
import type { PathfinderOp } from "../lib/pathBoolean";
import type { SvgFillMedia } from "../lib/htmlMutations";
import { TRACE_PRESETS } from "../lib/trace/presets";
import type { AnimationSchema } from "../../shared/animationSchema.ts";
import { AnimationPanel } from "./AnimationPanel";

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
  /** REQ-043: Object → Path commands on the anchor model. */
  onObjectPathOp?: (op: "simplify" | "smooth" | "addAnchors" | "removeRedundant" | "join", layerId: string, frameId: string) => void;
  onShapeOptionsChange?: (layerId: string, frameId: string, options: ShapeOptions) => void;
  /** F4: per-vertex radius edit — index is the vertex position, "all" sets
   *  every vertex at once (uniform). */
  onShapeVertexRadiusChange?: (layerId: string, frameId: string, index: number | "all", value: number) => void;
  onGroupModeChange?: (layerId: string, frameId: string, mode: "group" | "container") => void;
  /** F1/REQ-043 buscatrazos: las 10 ops estilo Illustrator sobre la selección. */
  onBooleanOp?: (op: PathfinderOp) => void;
  /** True when ≥2 shapes with paths are selected — enables the buscatrazos. */
  booleanOpReady?: boolean;
  /** F2: fill media for svg shapes (gradients/photos need real svg defs). */
  onSvgFillMedia?: (frameId: string, layerId: string, media: SvgFillMedia) => void;
  /** F3 remove-background: swap an <img> layer's src to the cutout PNG.
   *  The editor stores the original src in data-orig-src (non-destructive). */
  onImageSrcChange?: (frameId: string, layerId: string, newSrc: string, origSrc: string | null) => void;
  /** F3 remove-background: restore the src saved in data-orig-src. */
  onImageRestore?: (frameId: string, layerId: string) => void;
  /** F1/F2/F4 masks: strip the image's mask entirely (CSS + strokes + the
   *  mask source layer) — the one-click revert for the eraser/selection. */
  onImageMaskRemove?: (frameId: string, layerId: string) => void;
  /** F0 animation: the selected layer's clip lives on the frame's persisted
   *  animation schema (single source of truth). */
  frameAnimation?: AnimationSchema | null;
  onFrameAnimationChange?: (next: AnimationSchema | null) => void;
  /** Total layers in the selection, cross-frame included. With ≥2 the
   *  Alineación buttons align the GROUP to its own extreme object via
   *  onAlignSelection; a lone element keeps the frame-relative placement. */
  alignTargetsCount?: number;
  /** Group-relative align (EditorV2's cross-frame handleAlign). */
  onAlignSelection?: (alignment: "left" | "centerH" | "right" | "top" | "centerV" | "bottom") => void;
  /** Bounds used by the Position category's align-to-frame buttons. */
  frameWidth: number;
  frameHeight: number;
  subTab: "properties" | "code" | "animation";
  /** Toolbar for the Code tab (align / reorder / group / copy-as / smart
   *  layout), owned and wired by EditorV2 — replaces the old floating ops
   *  strip that pushed the canvas down on every selection. */
  codeToolbar?: React.ReactNode;
  /** Video Mode v2 (REQ 4b.2.3): abre el modo video embebido desde la
   *  pestaña Animación sin importar qué esté seleccionado (capa incluida). */
  onOpenVideoMode?: () => void;
  /** Modo Foto (REQ-PHOTO-PLATFORM-001): abre el revelado fotográfico
   *  embebido para la imagen actual (botón "Editar foto" en Fill). */
  onOpenPhotoMode?: () => void;
  /** REQ-043 Fase 1 — buscatrazos local: traza la imagen seleccionada en el
   *  navegador (worker) con el preset elegido; sin IA ni red. */
  onTraceImage?: (preset: string) => void;
  /** True mientras el trace corre (deshabilita el botón). */
  traceBusy?: boolean;
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
// Numeric field with three ways to change the value: type (committed on
// Enter/blur — NOT per keystroke, so deleting digits just works), drag the
// label or the unfocused input horizontally (live), and ArrowUp/ArrowDown
// (±step, Shift = ×10, live). Double-click selects the whole number.
export function ScrubbyInput({
  value, onChange, min, max, step, suffix, label, style,
}: {
  value: string; onChange: (v: string) => void;
  min?: number; max?: number; step?: number; suffix?: string;
  label?: string; style?: React.CSSProperties;
}) {
  const dragRef = useRef<{ startX: number; startVal: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // While focused, the input shows its own draft: the committed value comes
  // back asynchronously (style applied → selection re-emitted → prop update),
  // so mirroring the prop directly clobbered mid-typing, and the old
  // `onBlur={() => onChange(value)}` re-applied a stale closure value.
  const [draft, setDraft] = useState<string | null>(null);

  const clamp = (n: number) => {
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    return n;
  };

  const commitDraft = () => {
    if (draft !== null) onChange(draft);
    setDraft(null);
  };

  // Label drag (existing gesture): horizontal scrub while the mouse is held.
  const handleMouseDown = (e: React.MouseEvent) => {
    const num = parseFloat(draft ?? value);
    if (isNaN(num)) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startVal: num };
    document.body.style.cursor = "ew-resize";

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const s = step || 1;
      const newVal = String(clamp(dragRef.current.startVal + Math.round(dx / s) * s));
      setDraft(newVal);
      onChange(newVal);
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

  // Input drag (new): press on the UNFOCUSED input and drag horizontally to
  // scrub. A plain click still focuses for typing — the scrub only arms past
  // a 3px threshold and mousedown is never prevented.
  const handleInputMouseDown = (e: React.MouseEvent) => {
    const input = inputRef.current;
    if (!input || document.activeElement === input) return;
    const num = parseFloat(draft ?? value);
    if (isNaN(num)) return;
    const startX = e.clientX;
    let armed = false;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      if (!armed && Math.abs(dx) < 3) return;
      armed = true;
      const s = step || 1;
      const newVal = String(clamp(num + Math.round(dx / s) * s));
      setDraft(newVal);
      onChange(newVal);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (armed) {
        // The scrub left its value in `draft`; focus + select so the next
        // keystroke replaces it. Blur/Enter commits what the scrub produced.
        input.focus();
        input.select();
      }
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
          title="Arrastra para ajustar"
        >
          {label}
        </span>
      )}
      <input
        ref={inputRef}
        value={draft ?? value}
        onChange={e => setDraft(e.target.value)}
        onBlur={commitDraft}
        onMouseDown={handleInputMouseDown}
        onDoubleClick={e => (e.target as HTMLInputElement).select()}
        onKeyDown={e => {
          if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); return; }
          if (e.key === "Escape") { setDraft(null); (e.target as HTMLInputElement).blur(); return; }
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const base = parseFloat(e.currentTarget.value);
            if (isNaN(base)) return;
            const s = (step || 1) * (e.shiftKey ? 10 : 1);
            const next = String(clamp(e.key === "ArrowUp" ? base + s : base - s));
            setDraft(next);
            // Arrows commit immediately (live feedback, like the label scrub).
            onChange(next);
          }
        }}
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
        {value === MIXED_TEXT_STYLE && <option value={MIXED_TEXT_STYLE} disabled>Mixed</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </PropRow>
  );
}

interface PaintTarget {
  layerId: string;
  selector: string;
  /** The property this particular layer paints its interior through. */
  property: string;
  strokeColor: string;
  strokeWidth: string;
}

/**
 * The paintable layers under a group.
 *
 * A group has no fill of its own — this IS its fill. Walking to the leaves is
 * what makes "set the fill of a group" mean "paint the interior of everything
 * inside it" rather than "draw a rectangle behind it". A nested group is
 * skipped and its own children are reached, since it paints nothing either.
 */
function paintableDescendants(html: string, layerId: string): PaintTarget[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = [...doc.body.querySelectorAll("[data-layer-id]")]
    .find(el => el.getAttribute("data-layer-id") === layerId);
  if (!root) return [];

  const targets: PaintTarget[] = [];
  for (const el of root.querySelectorAll("[data-layer-id]")) {
    const id = el.getAttribute("data-layer-id");
    if (!id) continue;
    const tag = el.tagName.toLowerCase();
    const isSvg = tag === "svg";
    const paint = paintPropertiesFor({
      tag,
      isSvg,
      // An <svg> wrapper paints through the shape inside it.
      svgChildTag: isSvg
        ? el.querySelector("path,rect,circle,ellipse,polygon,polyline,line,text")?.tagName.toLowerCase()
        : undefined,
      layerKind: el.getAttribute("data-layer-kind") || undefined,
    });
    if (paint.fill) {
      targets.push({
        layerId: id,
        selector: `[data-layer-id="${id}"]`,
        property: paint.fill,
        strokeColor: paint.strokeColor as string,
        strokeWidth: paint.strokeWidth as string,
      });
    }
  }
  return targets;
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
  { key: "left", title: "Alinear a la izquierda" },
  { key: "centerH", title: "Alinear centros horizontalmente" },
  { key: "right", title: "Alinear a la derecha" },
  { key: "top", title: "Alinear hacia arriba" },
  { key: "centerV", title: "Alinear centros verticalmente" },
  { key: "bottom", title: "Alinear hacia abajo" },
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

// REQ-043 Fase 3: las 10 ops del Pathfinder (orden de la parrilla 2×5).
const PF_OPS: { op: PathfinderOp; label: string; title: string }[] = [
  { op: "unite", label: "Unir", title: "Unir — combina todas las figuras en una" },
  { op: "minusFront", label: "Sustraer", title: "Sustraer — resta las figuras del frente a la de atrás (Ctrl+Alt+S)" },
  { op: "intersect", label: "Intersecar", title: "Intersecar — conserva solo el solape (Ctrl+Alt+I)" },
  { op: "exclude", label: "Excluir", title: "Excluir — conserva todo menos el solape (Ctrl+Alt+E)" },
  { op: "divide", label: "Dividir", title: "Dividir — corta en todas las regiones de intersección" },
  { op: "trim", label: "Recortar", title: "Recortar — elimina las partes tapadas; la de atrás sobrevive" },
  { op: "merge", label: "Fusionar", title: "Fusionar — como recortar, pero gana la pintura del frente" },
  { op: "crop", label: "Máscara", title: "Máscara — la figura del frente recorta a las de atrás" },
  { op: "outline", label: "Contorno", title: "Contorno — bordes de cada región sin relleno" },
  { op: "minusBack", label: "Menos atrás", title: "Menos atrás — resta las figuras de atrás a la del frente" },
];

/** Glifos 14×14 estilo Illustrator: A = rectángulo de atrás, C = círculo del
 * frente; los rellenos con fillRule evenodd leen la sustracción sin trucos
 * de color de fondo. */
function PathfinderIcon({ op }: { op: PathfinderOp }) {
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.1 } as const;
  const fill = { fill: "currentColor", stroke: "none" } as const;
  const faint = { ...stroke, strokeOpacity: 0.4 } as const;
  switch (op) {
    case "unite":
      return <svg width={14} height={14} viewBox="0 0 14 14"><path {...fill} d="M1.5,4.5 h6 v-1 h7 v7 h-7 v-1 h-6 Z" /></svg>;
    case "minusFront":
      return <svg width={14} height={14} viewBox="0 0 14 14"><path fillRule="evenodd" {...fill} d="M1.5,4.5 h6 v6 h-6 Z M8.5,3 a3.5,3.5 0 1,0 0,7 a3.5,3.5 0 1,0 0,-7 Z" /><circle cx="8.5" cy="6.5" r="3.5" {...stroke} /></svg>;
    case "intersect":
      return <svg width={14} height={14} viewBox="0 0 14 14"><circle cx="4.5" cy="6.5" r="3" {...faint} /><circle cx="8.5" cy="6.5" r="3" {...faint} /><path {...fill} d="M7,3.9 C9.3,4.8 9.3,8.2 7,9.1 C6,8 6,5 7,3.9 Z" /></svg>;
    case "exclude":
      return <svg width={14} height={14} viewBox="0 0 14 14"><path fillRule="evenodd" {...fill} d="M1.5,4.5 h6 v6 h-6 Z M8.5,3 a3.5,3.5 0 1,0 0,7 a3.5,3.5 0 1,0 0,-7 Z" /></svg>;
    case "divide":
      return <svg width={14} height={14} viewBox="0 0 14 14"><rect x="1.5" y="4.5" width="6" height="6" {...stroke} /><circle cx="8.5" cy="6.5" r="3.5" {...stroke} /><line x1="7.5" y1="3.1" x2="7.5" y2="10.2" {...stroke} /></svg>;
    case "trim":
      return <svg width={14} height={14} viewBox="0 0 14 14"><path fillRule="evenodd" {...fill} d="M1.5,4.5 h6 v6 h-6 Z M8.5,3 a3.5,3.5 0 1,0 0,7 a3.5,3.5 0 1,0 0,-7 Z" /><circle cx="8.5" cy="6.5" r="3.5" {...fill} /></svg>;
    case "merge":
      return <svg width={14} height={14} viewBox="0 0 14 14"><rect x="1.5" y="4.5" width="6" height="6" {...fill} /><circle cx="8.5" cy="6.5" r="3.5" {...fill} /><line x1="7.5" y1="3.1" x2="7.5" y2="10.2" {...stroke} /></svg>;
    case "crop":
      return <svg width={14} height={14} viewBox="0 0 14 14"><rect x="1.5" y="4.5" width="6" height="6" {...faint} /><circle cx="8.5" cy="6.5" r="3.5" {...stroke} /><path {...fill} d="M7,3.9 C9.3,4.8 9.3,8.2 7,9.1 C6,8 6,5 7,3.9 Z" /></svg>;
    case "outline":
      return <svg width={14} height={14} viewBox="0 0 14 14"><rect x="1.5" y="4.5" width="6" height="6" {...stroke} /><circle cx="8.5" cy="6.5" r="3.5" {...stroke} /></svg>;
    case "minusBack":
      return <svg width={14} height={14} viewBox="0 0 14 14"><path fillRule="evenodd" {...fill} d="M1.5,4.5 h6 v6 h-6 Z M8.5,3 a3.5,3.5 0 1,0 0,7 a3.5,3.5 0 1,0 0,-7 Z" /><circle cx="8.5" cy="6.5" r="3.5" {...faint} /></svg>;
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

function readStroke(s: Record<string, string>): { position: StrokePosition; weight: number; color: string; alpha: number; style: string } {
  const outlineWidth = parseFloat(s["outline-width"]) || 0;
  const outlineActive = (s["outline-style"] || "none") !== "none" && outlineWidth > 0;
  if (outlineActive) {
    const offset = parseFloat(s["outline-offset"]) || 0;
    const position: StrokePosition = offset < 0 ? "center" : "outside";
    return { position, weight: outlineWidth, color: toHex(s["outline-color"]), alpha: parseAlpha(s["outline-color"]), style: s["outline-style"] || "solid" };
  }
  const borderWidth = parseFloat(s["border-width"]) || 0;
  return { position: "inside", weight: borderWidth, color: toHex(s["border-color"] || "#000000"), alpha: parseAlpha(s["border-color"]), style: borderWidth > 0 && (s["border-style"] || "none") !== "none" ? s["border-style"] : "solid" };
}

function writeStroke(
  updateMulti: (props: Record<string, string>) => void,
  next: { position: StrokePosition; weight: number; color: string; alpha: number; style?: string },
) {
  const style = next.style || "solid";
  const colorValue = next.alpha < 1 ? hexToRgba(next.color, next.alpha) : next.color;
  const visible = next.weight > 0;
  if (next.position === "inside") {
    updateMulti({
      "border-width": `${next.weight}px`, "border-style": visible ? style : "none", "border-color": colorValue,
      "outline-width": "0", "outline-style": "none", "outline-offset": "0",
    });
  } else {
    updateMulti({
      "outline-width": `${next.weight}px`, "outline-style": visible ? style : "none", "outline-color": colorValue,
      "outline-offset": next.position === "center" ? `${-next.weight / 2}px` : "0px",
      "border-width": "0", "border-style": "none",
    });
  }
}

// ── Box-shadow (Drop Shadow / Inner Shadow) helpers ──

interface ShadowEffect { x: number; y: number; blur: number; spread: number; color: string; alpha: number; inset: boolean }

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
/** Explains what a control will do when the answer is not obvious from it. */
const mutedNote: React.CSSProperties = {
  fontSize: 10, lineHeight: 1.5, color: "#7a7668", padding: "2px 2px 4px",
};

// ── F1/F2/F3 popup primitives ──

const popupCard: React.CSSProperties = {
  position: "absolute", right: 8, top: "100%", marginTop: 2, zIndex: 40,
  background: "#1c1a16", border: "1px solid rgba(200,184,152,0.25)", borderRadius: 8,
  padding: 8, display: "flex", flexDirection: "column", gap: 6, width: 212,
  boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
};
/** Layout-only body for cards rendered INSIDE a PanelPopup: the popup owns
 * the card chrome (background, border, fixed clamped position). A nested
 * popupCard here used to hang its content BELOW the empty shell (top:100%)
 * and get cut by the viewport edge. */
const popupBody: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };

function EyeButton({ on, onClick, title }: { on: boolean; onClick: () => void; title?: string }) {
  return (
    <button type="button" title={title || (on ? "Ocultar" : "Mostrar")} onClick={onClick}
      style={{ fontSize: 11, lineHeight: 1, padding: "2px 4px", borderRadius: 3, border: "none",
        background: "none", cursor: "pointer", opacity: on ? 1 : 0.35, color: "#c8b898", flexShrink: 0 }}>
      👁
    </button>
  );
}

/**
 * Floating card anchored to a panel row: opens to the LEFT of the panel —
 * over the canvas, so it never covers the sections below the row — and
 * clamps itself to the viewport so it always stays fully on screen.
 * Portal-rendered because the panel scrolls and would otherwise clip an
 * absolutely-positioned card. Clicking anywhere outside (the anchor
 * included is exempt) closes it.
 */
function PanelPopup({ anchor, onClose, children }: {
  anchor: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const anchorEl = anchor.current;
      const card = cardRef.current;
      if (!anchorEl || !card) return;
      const ar = anchorEl.getBoundingClientRect();
      const cw = card.offsetWidth;
      const ch = card.offsetHeight;
      let left = ar.left - cw - 8;               // hacia la izquierda del panel
      if (left < 8) left = ar.right + 8;         // sin sitio: intenta a la derecha
      left = Math.max(8, Math.min(left, window.innerWidth - cw - 8));
      let top = ar.top;
      top = Math.max(8, Math.min(top, window.innerHeight - ch - 8));
      setPos({ left: Math.round(left), top: Math.round(top) });
    };
    place();
    // Content switches (color→degradado→foto) change the card's height.
    const observer = new ResizeObserver(place);
    if (cardRef.current) observer.observe(cardRef.current);
    document.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    const onDocPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (cardRef.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDocPointerDown, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("pointerdown", onDocPointerDown, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div ref={cardRef} onPointerDown={e => e.stopPropagation()}
      style={{ ...popupCard, position: "fixed", right: "auto", marginTop: 0, zIndex: 1000,
        left: pos?.left ?? -9999, top: pos?.top ?? -9999,
        visibility: pos ? "visible" : "hidden" }}>
      {children}
    </div>,
    document.body,
  );
}

const hexOf = (rgb: { r: number; g: number; b: number }) =>
  "#" + [rgb.r, rgb.g, rgb.b].map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("");

/**
 * Full color picker (F2): SV square + hue + alpha, with the value editable
 * as text in the selected format (hex/rgb/hsl/hsb/cmyk/css) — Enter applies.
 */
function ColorPickerCard({ hex, alpha, onChange, cmykOnly, onCmykOnlyChange }: {
  hex: string; alpha: number;
  onChange: (hex: string, alpha: number) => void;
  /** Solo CMYK: la interacción del picker queda clampeada al gamut imprenta. */
  cmykOnly: boolean;
  onCmykOnlyChange: (v: boolean) => void;
}) {
  const [format, setFormat] = useState<ColorFormat>("hex");
  const [text, setText] = useState(() => formatColor(hex, "hex", alpha));
  const svRef = useRef<HTMLDivElement>(null);
  const rgb = hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };
  const hsv = rgbToHsv(rgb);

  useEffect(() => { setText(formatColor(hex, format, alpha)); }, [hex, alpha, format]);

  const guard = (h: string) => (cmykOnly ? clampToCmykGamut(h) : h);
  const applyHsv = (h: number, s: number, v: number) => onChange(guard(hexOf(hsvToRgb({ h, s, v }))), alpha);

  const svDrag = (e: React.PointerEvent) => {
    const rect = svRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    const move = (clientX: number, clientY: number) => {
      const s = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const v = 1 - Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
      applyHsv(hsv.h, s, v);
    };
    move(e.clientX, e.clientY);
    const onMove = (ev: PointerEvent) => move(ev.clientX, ev.clientY);
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  const commitText = () => {
    const parsed = parseColorText(text);
    if (parsed) onChange(guard(parsed.hex), parsed.alpha);
    else setText(formatColor(hex, format, alpha));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <select value={format} onChange={e => setFormat(e.target.value as ColorFormat)} style={{ ...sel, flex: 1 }}>
          <option value="hex">HEX</option>
          <option value="rgb">RGB</option>
          <option value="hsl">HSL</option>
          <option value="hsb">HSB</option>
          <option value="cmyk">CMYK</option>
          <option value="css">CSS</option>
        </select>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 9.5, color: cmykOnly ? "#c8b898" : "#9a968a", cursor: "pointer", userSelect: "none" }}>
        <input type="checkbox" checked={cmykOnly} onChange={e => onCmykOnlyChange(e.target.checked)} style={{ accentColor: "#c8b898" }} />
        Solo CMYK (imprenta)
      </label>
      {!cmykOnly && !isCmykSafe(hex) && (
        <div style={{ fontSize: 9, color: "#d0936a" }}>⚠ Fuera del gamut CMYK — se apagará en imprenta</div>
      )}
      <input value={text} onChange={e => setText(e.target.value)} onBlur={commitText}
        onKeyDown={e => { if (e.key === "Enter") { commitText(); (e.target as HTMLInputElement).blur(); } }}
        style={inp} />
      <div ref={svRef} onPointerDown={svDrag}
        style={{ height: 118, borderRadius: 4, cursor: "crosshair", position: "relative",
          background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))`,
          border: "1px solid rgba(255,255,255,0.08)" }}>
        <span style={{ position: "absolute", left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`,
          width: 10, height: 10, borderRadius: "50%", transform: "translate(-50%, -50%)",
          border: "2px solid #fff", boxShadow: "0 0 3px rgba(0,0,0,0.6)", pointerEvents: "none" }} />
      </div>
      <input type="range" min={0} max={360} value={Math.round(hsv.h)}
        onChange={e => applyHsv(parseFloat(e.target.value), hsv.s, hsv.v)}
        style={{ accentColor: "#c8b898", background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)", borderRadius: 3, height: 8 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input type="range" min={0} max={100} value={Math.round(alpha * 100)}
          onChange={e => onChange(hex, parseInt(e.target.value) / 100)}
          style={{ flex: 1, accentColor: "#c8b898" }} />
        <span style={{ fontSize: 9, color: "#7a7668", width: 30, textAlign: "right" }}>{Math.round(alpha * 100)}%</span>
      </div>
    </div>
  );
}

/** Gradient editor with a draggable-stops bar (F2): click the bar to add a
 * node at that position with the interpolated color, drag nodes to move. */
function GradientEditor({ gradient, onChange }: {
  gradient: ParsedGradient;
  onChange: (g: ParsedGradient) => void;
}) {
  const [selStop, setSelStop] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);
  const selected = gradient.stops[Math.min(selStop, gradient.stops.length - 1)];

  const posFromX = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 50;
    return Math.round(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * 100);
  };

  const dragStop = (index: number, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelStop(index);
    const onMove = (ev: PointerEvent) => {
      onChange({ ...gradient, stops: gradient.stops.map((s, i) => i === index ? { ...s, pos: posFromX(ev.clientX) } : s) });
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  const addStopAt = (pos: number) => {
    if (gradient.stops.length >= 10) return;
    const at = gradientColorAt(gradient.stops, pos);
    const stops = [...gradient.stops, { color: at.color, alpha: at.alpha, pos }].sort((a, b) => a.pos - b.pos);
    setSelStop(stops.findIndex(s => s.pos === pos && s.color === at.color));
    onChange({ ...gradient, stops });
  };

  const removeStop = (index: number) => {
    if (gradient.stops.length <= 2) return;
    onChange({ ...gradient, stops: gradient.stops.filter((_, i) => i !== index) });
    setSelStop(0);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", gap: 3 }}>
        {(["linear", "radial", "conic", "diamond"] as const).map(t => (
          <button key={t} type="button" onClick={() => onChange({ ...gradient, type: t })}
            style={{ flex: 1, fontSize: 9, padding: "3px 2px", borderRadius: 3, cursor: "pointer",
              border: gradient.type === t ? "1px solid #c8b898" : "1px solid rgba(255,255,255,0.08)",
              background: gradient.type === t ? "rgba(200,184,152,0.14)" : "rgba(15,15,15,0.5)",
              color: gradient.type === t ? "#c8b898" : "#7a7668" }}>
            {t === "linear" ? "Lineal" : t === "radial" ? "Radial" : t === "conic" ? "Angular" : "Diamante"}
          </button>
        ))}
      </div>
      {gradient.type !== "radial" && (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 9, color: "#7a7668" }}>Ángulo</span>
          <ScrubbyInput value={String(gradient.angle)} min={0} max={360} suffix="°"
            onChange={v => onChange({ ...gradient, angle: parseInt(v) || 0 })} />
        </div>
      )}
      <div ref={barRef} onPointerDown={e => { e.preventDefault(); addStopAt(posFromX(e.clientX)); }}
        title="Click para añadir un nodo ahí"
        style={{ height: 18, borderRadius: 4, cursor: "copy", position: "relative",
          background: `${buildGradientCss(gradient)}, repeating-conic-gradient(#3a3a3a 0% 25%, #2a2a2a 0% 50%) 50% / 10px 10px`,
          border: "1px solid rgba(255,255,255,0.12)" }}>
        {gradient.stops.map((stop, i) => (
          <span key={i} onPointerDown={e => dragStop(i, e)}
            style={{ position: "absolute", left: `${stop.pos}%`, top: "50%", transform: "translate(-50%, -50%)",
              width: 12, height: 12, borderRadius: "50%", cursor: "ew-resize",
              background: stop.color, opacity: stop.alpha,
              border: i === selStop ? "2px solid #fff" : "1px solid rgba(0,0,0,0.6)",
              boxShadow: "0 1px 3px rgba(0,0,0,0.6)" }} />
        ))}
      </div>
      {selected && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input type="color" value={selected.color} onChange={e => {
              onChange({ ...gradient, stops: gradient.stops.map((s, i) => i === selStop ? { ...s, color: e.target.value } : s) });
            }} style={{ ...colorInp, width: 24, height: 20 }} />
            <input value={selected.color} onChange={e => {
              const hex = toHexColor(e.target.value, selected.color);
              onChange({ ...gradient, stops: gradient.stops.map((s, i) => i === selStop ? { ...s, color: hex } : s) });
            }} style={{ ...inp, width: 70 }} />
            <span style={{ fontSize: 9, color: "#7a7668" }}>α</span>
            <ScrubbyInput value={String(Math.round(selected.alpha * 100))} min={0} max={100} suffix="%"
              onChange={v => onChange({ ...gradient, stops: gradient.stops.map((s, i) => i === selStop ? { ...s, alpha: (parseInt(v) || 0) / 100 } : s) })}
              style={{ flex: 1 }} />
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <span style={{ fontSize: 9, color: "#7a7668" }}>Pos</span>
            <ScrubbyInput value={String(selected.pos)} min={0} max={100} suffix="%"
              onChange={v => onChange({ ...gradient, stops: gradient.stops.map((s, i) => i === selStop ? { ...s, pos: parseInt(v) || 0 } : s) })}
              style={{ flex: 1 }} />
            {gradient.stops.length > 2 && (
              <button type="button" onClick={() => removeStop(selStop)}
                style={{ fontSize: 10, padding: "1px 5px", borderRadius: 2, border: "none", background: "rgba(239,68,68,0.15)", color: "#EF4444", cursor: "pointer" }}>×</button>
            )}
          </div>
        </div>
      )}
      <button type="button" onClick={() => addStopAt(50)}
        style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, border: "1px dashed rgba(200,184,152,0.2)", background: "none", color: "#c8b898", cursor: "pointer" }}>
        + Nodo (centro)
      </button>
    </div>
  );
}

type FillKind = "solid" | "gradient" | "image" | "video";

const FILL_KIND_LABELS: { kind: FillKind; label: string }[] = [
  { kind: "solid", label: "Color" },
  { kind: "gradient", label: "Degradado" },
  { kind: "image", label: "Foto" },
  { kind: "video", label: "Video" },
];

/** The fill picker popup (F2): a type selector on top — full color,
 * degradado, foto o video — with the editor for the chosen type below. */
function FillPickerCard({ kind, hex, alpha, gradient, imageUrl, videoUrl, onKind, onSolid, onGradient, onImageUrl, onVideoUrl, onUpload, onClose, cmykOnly, onCmykOnlyChange }: {
  kind: FillKind; hex: string; alpha: number;
  gradient: ParsedGradient | null;
  imageUrl: string; videoUrl: string;
  cmykOnly: boolean;
  onCmykOnlyChange: (v: boolean) => void;
  onKind: (kind: FillKind) => void;
  onSolid: (hex: string, alpha: number) => void;
  onGradient: (g: ParsedGradient) => void;
  onImageUrl: (url: string) => void;
  onVideoUrl: (url: string) => void;
  onUpload: () => void;
  onClose: () => void;
}) {
  const [imageUrlText, setImageUrlText] = useState(imageUrl);
  const [videoUrlText, setVideoUrlText] = useState(videoUrl);
  useEffect(() => { setImageUrlText(imageUrl); }, [imageUrl]);
  useEffect(() => { setVideoUrlText(videoUrl); }, [videoUrl]);

  return (
    <div style={popupBody}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 3, flex: 1 }}>
          {FILL_KIND_LABELS.map(({ kind: k, label }) => (
            <button key={k} type="button" onClick={() => onKind(k)}
              style={{ flex: 1, fontSize: 9, padding: "3px 2px", borderRadius: 3, cursor: "pointer",
                border: kind === k ? "1px solid #c8b898" : "1px solid rgba(255,255,255,0.08)",
                background: kind === k ? "rgba(200,184,152,0.14)" : "rgba(15,15,15,0.5)",
                color: kind === k ? "#c8b898" : "#7a7668" }}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} style={{ fontSize: 11, color: "#7a7668", background: "none", border: "none", cursor: "pointer", marginLeft: 4 }}>×</button>
      </div>
      {kind === "solid" && <ColorPickerCard hex={hex} alpha={alpha} onChange={onSolid} cmykOnly={cmykOnly} onCmykOnlyChange={onCmykOnlyChange} />}
      {kind === "gradient" && (gradient
        ? <GradientEditor gradient={gradient} onChange={onGradient} />
        : <button type="button" onClick={() => onGradient(DEFAULT_NEW_GRADIENT)}
            style={{ fontSize: 10, padding: "5px 8px", borderRadius: 4, border: "1px dashed rgba(200,184,152,0.25)", background: "none", color: "#c8b898", cursor: "pointer" }}>
            + Crear degradado
          </button>)}
      {kind === "image" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <input value={imageUrlText} placeholder="https://… de la imagen"
            onChange={e => setImageUrlText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") onImageUrl(imageUrlText.trim()); }}
            onBlur={() => imageUrlText.trim() !== imageUrl && onImageUrl(imageUrlText.trim())}
            style={inp} />
          <div style={{ display: "flex", gap: 4 }}>
            <button type="button" onClick={onUpload} style={{ ...smallBtn, flex: 1 }}>Subir imagen</button>
            {imageUrl && <button type="button" onClick={() => { setImageUrlText(""); onImageUrl(""); }} style={{ ...smallBtn, flex: 1 }}>Quitar</button>}
          </div>
        </div>
      )}
      {kind === "video" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <input value={videoUrlText} placeholder="https://… del video"
            onChange={e => setVideoUrlText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") onVideoUrl(videoUrlText.trim()); }}
            onBlur={() => videoUrlText.trim() !== videoUrl && onVideoUrl(videoUrlText.trim())}
            style={inp} />
          <div style={mutedNote}>El video queda almacenado con la capa; la reproducción depende del soporte de la capa destino.</div>
        </div>
      )}
    </div>
  );
}

// ── Stroke FX (F3 border controls: básico / dinámico / pincelada) ──

interface StrokeFx {
  style: string;      // solid | dashed | dotted
  profile: string;    // uniform | taper | swell
  cap: string;        // straight | bevel | round
  capRound: number;   // 0-100
  frequency: number;  // 0-100
  wiggle: number;     // 0-100
  smoothen: number;   // 0-100
  brush: string;      // "" | brocha | pincel | crayola | lapiz | rotulador | aerografo
}

const DEFAULT_STROKE_FX: StrokeFx = {
  style: "solid", profile: "uniform", cap: "straight", capRound: 0,
  frequency: 20, wiggle: 0, smoothen: 50, brush: "",
};

const STROKE_BRUSHES: { value: string; label: string }[] = [
  { value: "brocha", label: "Brocha" }, { value: "pincel", label: "Pincel" },
  { value: "crayola", label: "Crayola" }, { value: "lapiz", label: "Lápiz" },
  { value: "rotulador", label: "Rotulador" }, { value: "aerografo", label: "Aerógrafo" },
];

function StrokeControlsCard({ fx, isSvg, onChange, onClose }: {
  fx: StrokeFx; isSvg: boolean;
  onChange: (next: Partial<StrokeFx>) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"basico" | "dinamico" | "pincelada">("basico");
  return (
    <div style={popupBody}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 3, flex: 1 }}>
          {(["basico", "dinamico", "pincelada"] as const).map(t => (
            <button key={t} type="button" onClick={() => setTab(t)}
              style={{ flex: 1, fontSize: 9, padding: "3px 2px", borderRadius: 3, cursor: "pointer", textTransform: "capitalize",
                border: tab === t ? "1px solid #c8b898" : "1px solid rgba(255,255,255,0.08)",
                background: tab === t ? "rgba(200,184,152,0.14)" : "rgba(15,15,15,0.5)",
                color: tab === t ? "#c8b898" : "#7a7668" }}>
              {t}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} style={{ fontSize: 11, color: "#7a7668", background: "none", border: "none", cursor: "pointer", marginLeft: 4 }}>×</button>
      </div>
      {tab === "basico" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <PropRow label="Estilo">
            <select value={fx.style} onChange={e => onChange({ style: e.target.value })} style={sel}>
              <option value="solid">Sólido</option>
              <option value="dashed">Discontinuo</option>
              <option value="dotted">Punteado</option>
            </select>
          </PropRow>
          <PropRow label="Perfil">
            <select value={fx.profile} onChange={e => onChange({ profile: e.target.value })} style={sel}>
              <option value="uniform">Uniforme</option>
              <option value="taper">Hacia punta</option>
              <option value="swell">Engrosado</option>
            </select>
          </PropRow>
          <PropRow label="Puntas">
            <select value={fx.cap} onChange={e => onChange({ cap: e.target.value })} style={sel}>
              <option value="straight">Recta</option>
              <option value="bevel">Biselada</option>
              <option value="round">Redondeada</option>
            </select>
          </PropRow>
          <PropRow label="Redondez">
            <ScrubbyInput value={String(fx.capRound)} min={0} max={100} suffix="%"
              onChange={v => onChange({ capRound: Math.max(0, Math.min(100, parseInt(v) || 0)) })} />
          </PropRow>
          <div style={mutedNote}>
            {isSvg
              ? "El estilo y las puntas se aplican al trazo del path; el perfil se almacena con la figura."
              : "El estilo se aplica al borde; perfil y puntas se almacenan con el trazo."}
          </div>
        </div>
      )}
      {tab === "dinamico" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <PropRow label="Frecuencia">
            <ScrubbyInput value={String(fx.frequency)} min={0} max={100} suffix="%"
              onChange={v => onChange({ frequency: Math.max(0, Math.min(100, parseInt(v) || 0)) })} />
          </PropRow>
          <PropRow label="Wiggle">
            <ScrubbyInput value={String(fx.wiggle)} min={0} max={100} suffix="%"
              onChange={v => onChange({ wiggle: Math.max(0, Math.min(100, parseInt(v) || 0)) })} />
          </PropRow>
          <PropRow label="Smooth">
            <ScrubbyInput value={String(fx.smoothen)} min={0} max={100} suffix="%"
              onChange={v => onChange({ smoothen: Math.max(0, Math.min(100, parseInt(v) || 0)) })} />
          </PropRow>
          <div style={mutedNote}>Los valores dinámicos se guardan junto al trazo para el render vectorial.</div>
        </div>
      )}
      {tab === "pincelada" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 3 }}>
            {STROKE_BRUSHES.map(b => (
              <button key={b.value} type="button" onClick={() => onChange({ brush: fx.brush === b.value ? "" : b.value })}
                style={{ fontSize: 9, padding: "4px 2px", borderRadius: 3, cursor: "pointer",
                  border: fx.brush === b.value ? "1px solid #c8b898" : "1px solid rgba(255,255,255,0.08)",
                  background: fx.brush === b.value ? "rgba(200,184,152,0.14)" : "rgba(15,15,15,0.5)",
                  color: fx.brush === b.value ? "#c8b898" : "#7a7668" }}>
                {b.label}
              </button>
            ))}
          </div>
          <div style={mutedNote}>La pincelada elegida viaja con el trazo (export e historial incluidos).</div>
        </div>
      )}
    </div>
  );
}

/** Effect type chooser shown by the Effects section's + button (F1). */
const EFFECT_CHOICES: { value: string; label: string }[] = [
  { value: "inner", label: "Sombra interior" },
  { value: "drop", label: "Sombra exterior" },
  { value: "layerBlur", label: "Layer Blur" },
  { value: "bgBlur", label: "Background Blur" },
  { value: "glass", label: "Glass" },
  { value: "noise", label: "Ruido" },
  { value: "texture", label: "Textura" },
  { value: "dither", label: "Trama" },
];

function EffectsAddCard({ onPick, onClose }: { onPick: (value: string) => void; onClose: () => void }) {
  return (
    <div style={popupBody}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 9, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1 }}>Elegir efecto</span>
        <button type="button" onClick={onClose} style={{ fontSize: 11, color: "#7a7668", background: "none", border: "none", cursor: "pointer" }}>×</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
        {EFFECT_CHOICES.map(choice => (
          <button key={choice.value} type="button" onClick={() => onPick(choice.value)} style={smallBtn}>
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ──

export function HtmlContextualPanel({
  workspaceId, element, selectedLayerIds, html, css, onCssChange, onChangeTag, onCopyStyle, onPasteStyle, hasClipboardStyle,
  onConvertToPath, onOutlineStroke, onOffsetPath, onObjectPathOp, onShapeOptionsChange, onShapeVertexRadiusChange, onGroupModeChange, onImageSrcChange, onImageRestore, onImageMaskRemove,
  onBooleanOp, booleanOpReady, onSvgFillMedia, alignTargetsCount, onAlignSelection,
  frameWidth, frameHeight, subTab, frameAnimation, onFrameAnimationChange, codeToolbar, onOpenVideoMode, onOpenPhotoMode,
  onTraceImage, traceBusy,
}: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    align: true, position: true, rotation: true, layout: true, appearance: true, fill: true, stroke: true, effects: true,
    typography: true, groupmode: true, shape: true, spacing: true, border: true,
    flexgrid: true, oldposition: false, transform: false, transition: false, states: false,
  });
  // REQ-043: preset activo del buscatrazos local (el select del Fill de imágenes).
  const [tracePreset, setTracePreset] = useState("Black and White Logo");
  // REQ-043: delta del desplazamiento de trazado (Offset Path).
  const [offsetDelta, setOffsetDelta] = useState(4);
  const [activePseudo, setActivePseudo] = useState<string>(":hover");
  const [customCssText, setCustomCssText] = useState("");
  const [copied, setCopied] = useState<"html" | "css" | null>(null);
  // ── F1/F2/F3 popup + submenu state ──
  const [fillPickerOpen, setFillPickerOpen] = useState(false);
  // "Solo CMYK" del picker de relleno: filtra la interacción al gamut de
  // imprenta (aprox sin ICC; la prueba exacta es el soft-proof del export).
  const [cmykOnly, setCmykOnly] = useState(false);
  const [typeAdvancedOpen, setTypeAdvancedOpen] = useState(false);
  const [strokeControlsOpen, setStrokeControlsOpen] = useState(false);
  const [strokePickerOpen, setStrokePickerOpen] = useState(false);
  const [fxAddOpen, setFxAddOpen] = useState(false);
  const [fxOpenKey, setFxOpenKey] = useState<string | null>(null);
  // Rows the floating popups anchor to (see PanelPopup).
  const fillRowRef = useRef<HTMLDivElement>(null);
  const strokeRowRef = useRef<HTMLDivElement>(null);
  const fxAddRowRef = useRef<HTMLDivElement>(null);

  const toggle = (s: string) => setExpanded(prev => ({ ...prev, [s]: !prev[s] }));
  
    // ── F4 A1: live radius feedback while a vertex circle is dragged on the
    // canvas — the gesture broadcasts musa:shape-radius-live per frame. ──
    const [liveShapeRadius, setLiveShapeRadius] = useState<{ layerId: string; uniform: number; radii: number[] } | null>(null);
    const [vertexListOpen, setVertexListOpen] = useState(false);
    useEffect(() => {
      const onLiveRadius = (event: Event) => {
        setLiveShapeRadius((event as CustomEvent<{ layerId: string; uniform: number; radii: number[] }>).detail);
      };
      window.addEventListener("musa:shape-radius-live", onLiveRadius);
      return () => window.removeEventListener("musa:shape-radius-live", onLiveRadius);
    }, []);
    useEffect(() => {
      setLiveShapeRadius(null);
      setVertexListOpen(false);
      setFillPickerOpen(false);
      setStrokeControlsOpen(false);
      setFxAddOpen(false);
      setFxOpenKey(null);
    }, [element?.layerId]);
    const shapeRadii = element?.vertexRadii ?? null;
    const shapeRadiusDisplay = element && liveShapeRadius?.layerId === element.layerId
      ? liveShapeRadius.uniform
      : element?.shapeOptions?.cornerRadius ?? 0;

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

  /**
   * Sequential writes inside one handler must compose. handleCssChange
   * replaces the frame stylesheet wholesale, so two update() calls in the
   * same burst — each computing from the render's css prop — left only the
   * last one standing ("+ Añadir borde" wrote border-width, then
   * --stroke-mem, and the memory write erased the border; the fill eye and
   * the fill picker lost their writes the same way). The chain buffer lives
   * exactly one microtask: long enough to link one burst, never across
   * interactions.
   */
  const cssChainRef = useRef<string | null>(null);
  const commitCss = useCallback((next: string) => {
    cssChainRef.current = next;
    queueMicrotask(() => { cssChainRef.current = null; });
    onCssChange(next);
  }, [onCssChange]);

  const update = useCallback((selector: string, prop: string, value: string) => {
    let updated = cssChainRef.current ?? css;
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
    commitCss(updated);
  }, [css, commitCss, targetsFor]);

  const updateMulti = useCallback((selector: string, props: Record<string, string>) => {
    let updated = cssChainRef.current ?? css;
    for (const target of targetsFor(selector)) {
      for (const [k, v] of Object.entries(props)) {
        updated = updateElementCssProperty(updated, target, k, v);
      }
    }
    commitCss(updated);
  }, [css, commitCss, targetsFor]);

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

  // ── Background image upload (reuses /api/assets/upload → design-assets bucket). The handler
  // lives below the isSvgShape/isSvgText flags — svg uploads route to svg defs. ──
  const bgImageInputRef = useRef<HTMLInputElement>(null);

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
  const textStyles = element.richTextStyles || s;
  const applyTypography = (property: RichTextProperty, value: string) => {
    // Rich-text (span-level) styling only exists inside a frame's Shadow DOM:
    // the registry is keyed by frame id, so an orphan text (whose synthetic
    // element carries the ORPHAN id as frameId, see EditorV2) never has an
    // entry. Falling back to the CSS branch keeps those changes applying —
    // and persisting — instead of dying silently on the optional call.
    const richCall = element.layerKind === "text" ? frameRichTextRegistry.get(element.frameId) : undefined;
    if (richCall) {
      richCall(element.layerId, property, value);
    } else {
      if (element.layerKind === "text") {
        // A text layer WITHOUT a registry entry means a dead/duplicate
        // registration (unmount cleanup deletes the key). Log loudly: this
        // exact silence cost hours of debugging.
        console.warn("[typography] text layer sin rich-text registry — aplicando por CSS", { frameId: element.frameId, layerId: element.layerId, selector: element.selector });
      }
      update(element.selector, property, value);
    }
  };
  const textValue = (property: RichTextProperty, fallback = "") => textStyles[property] || fallback;
  const selector = element.selector;

  /**
   * A layer has exactly two paints: a fill and a stroke. Which property
   * carries the fill depends on what the layer is — a div colours its interior
   * with background-color, a path with fill, a glyph with color — but the
   * control is called Fill in every case, and a group gets none of its own.
   */
  const isGroup = isGroupLayer({ tag: element.tag, layerKind: element.layerKind });
  const fillProperty = paintPropertiesFor({
    tag: element.tag,
    isSvg: element.isSvg,
    svgChildTag: element.svgChildTag,
    layerKind: element.layerKind,
  }).fill;

  const groupTargets = useMemo(
    () => (isGroup ? paintableDescendants(html, element.layerId) : []),
    [isGroup, html, element.layerId],
  );
  const groupTargetCount = groupTargets.length;
  const groupFills = useMemo(
    () => summarizeFills(groupTargets.map(target => ({
      layerId: target.layerId,
      value: getCssPropertyValue(css, target.selector, target.property),
    }))),
    [groupTargets, css],
  );

  /** Writes a fill to specific members of the group, each through its own property. */
  const setGroupFill = useCallback((layerIds: string[], value: string) => {
    const wanted = new Set(layerIds);
    let updated = css;
    for (const target of groupTargets) {
      if (!wanted.has(target.layerId)) continue;
      updated = updateElementCssProperty(updated, target.selector, target.property, value);
    }
    onCssChange(updated);
  }, [css, groupTargets, onCssChange]);

  const fillWholeGroup = useCallback((value: string) => {
    setGroupFill(groupTargets.map(target => target.layerId), value);
  }, [setGroupFill, groupTargets]);

  /**
   * A group's stroke outlines its members, not the rectangle around them —
   * the same reasoning as its fill. Written per member, since each one strokes
   * through a different property.
   */
  const setGroupStroke = useCallback((prop: "color" | "width", value: string) => {
    let updated = css;
    for (const target of groupTargets) {
      updated = updateElementCssProperty(
        updated, target.selector,
        prop === "color" ? target.strokeColor : target.strokeWidth,
        value,
      );
      // A border with no style draws nothing however wide it is set.
      if (prop === "width" && target.strokeWidth === "border-width" && parseFloat(value) > 0) {
        const style = getCssPropertyValue(updated, target.selector, "border-style");
        if (!style || style === "none") {
          updated = updateElementCssProperty(updated, target.selector, "border-style", "solid");
        }
      }
    }
    onCssChange(updated);
  }, [css, groupTargets, onCssChange]);

  const groupStrokes = useMemo(
    () => summarizeFills(groupTargets.map(target => ({
      layerId: target.layerId,
      value: getCssPropertyValue(css, target.selector, target.strokeColor),
    }))),
    [groupTargets, css],
  );
  // A layer is text when it is a semantic text tag OR was created/classified
  // as text (the Text tool emits <div data-layer-kind="text">). Without the
  // layerKind check, text-tool layers hide the Typography section entirely —
  // and with it, the font picker and custom font uploads.
  const isText = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "a", "li", "label", "button", "em", "strong", "small", "b", "i"].includes(element.tag) || element.layerKind === "text";
  const isFlex = s["display"] === "flex" || s["display"] === "inline-flex";
  const isGrid = s["display"] === "grid" || s["display"] === "inline-grid";
  const isSvg = element.isSvg;
  const isSvgPath = isSvg && element.svgChildTag === "path";
  const isSvgShape = isSvg && ["path", "rect", "circle", "ellipse", "polygon", "polyline", "line"].includes(element.svgChildTag || "");
  const isSvgText = isSvg && element.svgChildTag === "text";
  const isImage = element.tag === "img";

  // Svg shapes paint fills with real defs (a CSS background can't tint a
  // <path>) — every fill write for them routes through onSvgFillMedia.
  // Shapes only: applyLayerSvgFill paints a <path>; svg <text> keeps the css
  // fill branch it has always used.
  const svgFillSupported = Boolean(isSvgShape && onSvgFillMedia);

  // ── Position category: align-to-frame ──
  const alignTo = (key: typeof ALIGN_BUTTONS[number]["key"]) => {
    // Multi-selección (cross-frame incluida): alinea el GRUPO contra su
    // propio objeto extremo — nunca contra el frame. Un elemento solo
    // conserva la colocación relativa al frame de abajo (semántica Figma).
    if ((alignTargetsCount ?? 0) > 1 && onAlignSelection) {
      onAlignSelection(key);
      return;
    }
    const w = parseFloat(s["width"]) || 0;
    const h = parseFloat(s["height"]) || 0;
    if (key === "left") update(selector, "left", "0px");
    else if (key === "centerH") update(selector, "left", `${Math.round((frameWidth - w) / 2)}px`);
    else if (key === "right") update(selector, "left", `${Math.round(frameWidth - w)}px`);
    else if (key === "top") update(selector, "top", "0px");
    else if (key === "centerV") update(selector, "top", `${Math.round((frameHeight - h) / 2)}px`);
    else if (key === "bottom") update(selector, "top", `${Math.round(frameHeight - h)}px`);
  };

  // ── F2: fill photo upload (shared with the picker's Foto tab; divs paint
  // it as a background, svg shapes as a pattern def) ──
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

      if (svgFillSupported) {
        onSvgFillMedia!(element.frameId, element.layerId, { kind: "image", url: result.url });
        let readback = updateElementCssProperty(css, element.selector, "--fill-image", result.url);
        readback = updateElementCssProperty(readback, element.selector, "--fill-gradient", "0");
        onCssChange(readback);
      } else {
        const bgValue = `url(${result.url}) center/cover no-repeat`;
        let updated = updateElementCssProperty(css, element.selector, "background-image", bgValue);
        updated = updateElementCssProperty(updated, element.selector, "background-size", "cover");
        onCssChange(updated);
      }

      e.target.value = ""; // reset for re-upload of same file
    } catch (err: any) {
      console.error("[BG_IMAGE] Upload failed:", err);
    }
  }, [css, element, onCssChange, workspaceId, svgFillSupported, onSvgFillMedia]);

  // ── F3: Quitar fondo (remove-background, u2netp) ──
  const [removeBgState, setRemoveBgState] = useState<"idle" | "loading" | "error">("idle");
  const [removeBgError, setRemoveBgError] = useState("");

  /** Original src saved by a previous cutout swap (data-orig-src attribute). */
  const imageOrigSrc = useMemo(() => {
    if (!isImage) return null;
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      return doc.querySelector(selector)?.getAttribute("data-orig-src") || null;
    } catch { return null; }
  }, [html, selector, isImage]);

  /** True when the selected image carries a mask (eraser strokes or a
   *  selection path) — drives the "Quitar máscara" revert button. */
  const imageHasMask = useMemo(() => {
    if (!isImage) return false;
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const layerId = element?.layerId;
      if (!layerId) return false;
      const img = doc.querySelector(`img[data-layer-id="${layerId}"]`);
      return Boolean(img?.hasAttribute("data-mask-brushes") || doc.querySelector(`path[data-mask-for="${layerId}"]`));
    } catch { return false; }
  }, [html, element, isImage]);

  const handleMaskRemove = useCallback(() => {
    if (!element || !onImageMaskRemove) return;
    onImageMaskRemove(element.frameId, element.layerId);
  }, [element, onImageMaskRemove]);

  /**
   * Zero-LLM pipeline: the REST route queues a segment_jobs row and
   * dispatches the image-segment-background Netlify function (local u2netp).
   * The warm-model case (1-3s) is polled here so it feels synchronous; a
   * cold start keeps running in background and the job row stays pollable.
   */
  const handleRemoveBackground = useCallback(async () => {
    if (!element?.src || !onImageSrcChange) return;
    setRemoveBgState("loading");
    setRemoveBgError("");
    try {
      const res = await fetch("/api/segment/remove-background", {
        method: "POST",
        headers: { ...getApiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ url: element.src, workspaceId }),
      }).then(r => r.json());
      if (!res?.success) throw new Error(res?.error || "remove-background failed");

      let result = res.result || null;
      if (res.jobId && !result) {
        const deadline = Date.now() + 90_000;
        while (Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 1500));
          const poll = await fetch(`/api/segment/jobs/${res.jobId}`, { headers: getApiHeaders() }).then(r => r.json());
          if (poll?.success && poll.status === "done") { result = poll.result; break; }
          if (poll?.success && poll.status === "error") throw new Error(poll.error || "Inference failed");
        }
      }
      if (!result?.cutoutUrl) throw new Error("The job did not produce a cutout");
      onImageSrcChange(element.frameId, element.layerId, result.cutoutUrl, element.src);
      setRemoveBgState("idle");
    } catch (err: any) {
      console.error("[REMOVE_BG] failed:", err);
      setRemoveBgState("error");
      setRemoveBgError(err?.message || "remove-background failed");
    }
  }, [element, workspaceId, onImageSrcChange]);

  const handleRestoreOriginal = useCallback(() => {
    if (!element || !imageOrigSrc || !onImageRestore) return;
    onImageRestore(element.frameId, element.layerId);
  }, [element, imageOrigSrc, onImageRestore]);

  const stroke = readStroke(s);
  const shadows = useMemo(() => parseBoxShadows(s["box-shadow"] || ""), [s["box-shadow"]]);
  const writeShadows = (next: ShadowEffect[]) => update(selector, "box-shadow", next.length ? next.map(formatShadow).join(", ") : "none");
  const layerBlur = getFilterFn(s["filter"] || "", "blur");
  const bgBlur = getFilterFn(s["backdrop-filter"] || "", "blur");
  const hasGlass = /saturate/.test(s["backdrop-filter"] || "");

  // ── F2: unified fill model. One row + one picker for every medium — the
  // picker edits solid/gradient/image/video and the writes fan out to the
  // property each medium paints with (css for divs/text, svg defs for shapes).
  const fillMemRaw = getCssPropertyValue(css, selector, "--fill-mem");
  const fillMemActive = Boolean(fillMemRaw && fillMemRaw !== "0" && fillMemRaw !== "none");
  const bgImageValue = s["background-image"] || "";
  // The computed `fill` of the <svg> wrapper never shows what a path paints:
  // gradient/image live in <defs> and the solid sits on the path's own
  // attribute. Read the painted element back from the frame html instead.
  const svgPaintedFill = useMemo(() => {
    if (!svgFillSupported || !element) return s["fill"] || "";
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const layerNode = doc.querySelector(selector);
      if (!layerNode) return "";
      const painted = layerNode.matches("path") ? layerNode : layerNode.querySelector("path");
      return painted?.getAttribute("fill") || "";
    } catch { return ""; }
  }, [html, selector, svgFillSupported, element, s["fill"]]);
  // The pen paints paths from the CSS rule (`[sel] path { fill: ... }`), so
  // the attribute read comes back empty for them. Fall back to the painted
  // path's computed fill — and treat computed "none" as a REAL state
  // (transparent), never the #c8b898 accent fallback below, which is
  // reserved for "no fill data at all".
  const svgComputedFill = svgFillSupported ? (s["fill"] || "") : "";
  const svgPaintedRaw = svgPaintedFill || (svgComputedFill === "none" ? "rgba(0, 0, 0, 0)" : svgComputedFill);
  const svgFillRaw = svgFillSupported
    ? (svgPaintedRaw.startsWith("url(") ? "" : svgPaintedRaw)
    : (s["fill"] || "");
  const svgFillIsRef = svgFillRaw.startsWith("url(");
  const svgGradientMemRaw = getCssPropertyValue(css, selector, "--fill-gradient") || "";
  const svgImageMemRaw = getCssPropertyValue(css, selector, "--fill-image") || "";
  // "0" is the cleared marker written when another medium takes over the fill.
  const svgGradientMem = svgGradientMemRaw && svgGradientMemRaw !== "0" ? svgGradientMemRaw : "";
  const svgImageMem = svgImageMemRaw && svgImageMemRaw !== "0" ? svgImageMemRaw : "";
  const fillVideoUrl = getCssPropertyValue(css, selector, "--fill-video") || "";
  const fillGradientCss = svgFillSupported ? svgGradientMem : bgImageValue;
  const fillGradientParsed = fillGradientCss ? parseGradientValue(fillGradientCss) : null;
  const fillImageUrl = svgFillSupported ? svgImageMem : (/^url\(/.test(bgImageValue) ? bgImageValue : "");
  const effectiveFillValue = element.layerKind === "text" && fillProperty === "color"
    ? textValue("color")
    : s[fillProperty || "background-color"];
  const fillSolidRaw = svgFillSupported ? (svgFillIsRef ? "" : svgFillRaw) : (effectiveFillValue === MIXED_TEXT_STYLE ? "" : (effectiveFillValue || ""));
  const fillPropName = fillProperty || "background-color";
  const fillSolidHex = toHex(fillSolidRaw || "#c8b898");
  const fillSolidAlpha = parseAlpha(fillSolidRaw || "#c8b898");
  let memFillKind: FillKind = "solid";
  if (fillMemActive) {
    try { memFillKind = (JSON.parse(fillMemRaw) as { kind?: FillKind }).kind || "solid"; } catch { memFillKind = "solid"; }
  }
  const fillKind: FillKind = fillMemActive
    ? memFillKind
    : fillVideoUrl ? "video"
      : fillGradientParsed ? "gradient"
        : fillImageUrl ? "image"
          : "solid";

  const writeFillSolid = useCallback((hex: string, alpha: number) => {
    if (svgFillSupported && element) {
      // A presentation attribute ALWAYS loses to author CSS, and pen shapes
      // carry their fill in the `[sel] path` rule — writing only the
      // attribute updated the panel's read-back while the canvas stayed
      // black. The rule is what paints, so it takes the colour; the
      // attribute write stays as the read-back/export source of truth.
      update(`${selector} path`, "fill", hex);
      onSvgFillMedia!(element.frameId, element.layerId, { kind: "solid", color: hex });
      update(selector, "fill-opacity", String(alpha));
      update(selector, "--fill-gradient", "0");
      update(selector, "--fill-image", "0");
      return;
    }
    const color = alpha < 1 ? hexToRgba(hex, alpha) : hex;
    if (element?.layerKind === "text" && fillPropName === "color") applyTypography("color", color);
    else update(selector, fillPropName, color);
    if (fillGradientParsed || fillImageUrl) update(selector, "background-image", "none");
    update(selector, "--fill-mem", "0");
  }, [svgFillSupported, element, onSvgFillMedia, selector, fillProperty, fillGradientParsed, fillImageUrl, update]);

  const writeFillGradient = useCallback((g: ParsedGradient) => {
    const gradientCss = buildGradientCss(g);
    if (svgFillSupported && element) {
      onSvgFillMedia!(element.frameId, element.layerId, { kind: "gradient", css: gradientCss });
      // Same cascade rule as the solid case: the `[sel] path` CSS rule beats
      // the fill attribute, so a pen shape would keep its old colour under a
      // freshly-installed defs gradient. Point the rule at the def directly
      // (applyLayerSvgFill names it musa-fill-<layerId>).
      update(`${selector} path`, "fill", `url(#musa-fill-${element.layerId})`);
      // The gradient lives in svg defs; this memory prop is what the picker
      // reads back to show/reopen the same degradado.
      update(selector, "--fill-gradient", gradientCss);
      update(selector, "--fill-image", "0");
      return;
    }
    update(selector, "background-image", gradientCss);
    update(selector, "--fill-mem", "0");
  }, [svgFillSupported, element, onSvgFillMedia, selector, update]);

  const writeFillImage = useCallback((url: string) => {
    if (svgFillSupported && element) {
      onSvgFillMedia!(element.frameId, element.layerId, url ? { kind: "image", url } : { kind: "solid", color: fillSolidHex });
      update(selector, "--fill-image", url || "0");
      update(selector, "--fill-gradient", "0");
      return;
    }
    update(selector, "background-image", url ? `url(${url}) center/cover no-repeat` : "none");
    update(selector, "--fill-mem", "0");
  }, [svgFillSupported, element, onSvgFillMedia, selector, fillSolidHex, update]);

  const writeFillVideo = useCallback((url: string) => {
    update(selector, "--fill-video", url);
  }, [selector, update]);

  const switchFillKind = useCallback((kind: FillKind) => {
    if (kind === "solid") writeFillSolid(fillSolidHex, fillSolidAlpha);
    else if (kind === "gradient") {
      if (!fillGradientParsed) writeFillGradient(DEFAULT_NEW_GRADIENT);
    } else if (kind === "image") writeFillImage(fillImageUrl);
    else if (kind === "video") writeFillVideo(fillVideoUrl);
  }, [writeFillSolid, writeFillGradient, writeFillImage, writeFillVideo, fillSolidHex, fillSolidAlpha, fillGradientParsed, fillImageUrl, fillVideoUrl]);

  // Activar "Solo CMYK" clampa el relleno sólido actual al gamut de una vez
  // (los degradados/fotos no se tocan aquí: el checkbox cubre el picker).
  const handleCmykOnlyChange = useCallback((v: boolean) => {
    setCmykOnly(v);
    if (v && fillKind === "solid" && fillSolidRaw) {
      writeFillSolid(clampToCmykGamut(fillSolidHex), fillSolidAlpha);
    }
  }, [fillKind, fillSolidRaw, writeFillSolid, fillSolidHex, fillSolidAlpha]);

  // ── Imprenta: sobreimpresión (mix-blend-mode:multiply — el raster foreignObject
  // del export lo aplica tal cual, así el PDF lleva la tinta acumulada real) y
  // tinta plana (--spot-ink viaja en el CSS del frame; el dialog de imprenta la
  // lista para pedir placa aparte).
  const spotInkRaw = getCssPropertyValue(css, selector, "--spot-ink") || SPOT_NONE;
  const spotInkObj = findSpotInk(spotInkRaw);
  const applySpotInk = useCallback((idOrName: string) => {
    const ink = findSpotInk(idOrName);
    update(selector, "--spot-ink", ink ? ink.name : SPOT_NONE);
    if (ink) writeFillSolid(ink.hex, fillSolidAlpha);
  }, [selector, update, writeFillSolid, fillSolidAlpha]);

  const toggleFillHidden = useCallback(() => {
    if (!fillMemActive) {
      const mem = JSON.stringify({
        kind: fillKind, hex: fillSolidHex, alpha: fillSolidAlpha,
        gradientCss: fillGradientCss, imageUrl: fillImageUrl, videoUrl: fillVideoUrl,
      });
      if (svgFillSupported && element) {
        onSvgFillMedia!(element.frameId, element.layerId, { kind: "none" });
      } else {
        update(selector, fillPropName, "transparent");
        if (fillGradientParsed || fillImageUrl) update(selector, "background-image", "none");
      }
      update(selector, "--fill-mem", mem);
    } else {
      try {
        const mem = JSON.parse(fillMemRaw) as { kind: FillKind; hex?: string; alpha?: number; gradientCss?: string; imageUrl?: string; videoUrl?: string };
        if (svgFillSupported && element) {
          if (mem.kind === "gradient" && mem.gradientCss) onSvgFillMedia!(element.frameId, element.layerId, { kind: "gradient", css: mem.gradientCss });
          else if (mem.kind === "image" && mem.imageUrl) onSvgFillMedia!(element.frameId, element.layerId, { kind: "image", url: mem.imageUrl });
          else onSvgFillMedia!(element.frameId, element.layerId, { kind: "solid", color: mem.hex || "#c8b898" });
        } else {
          if (mem.kind === "gradient" && mem.gradientCss) update(selector, "background-image", mem.gradientCss);
          else if (mem.kind === "image" && mem.imageUrl) update(selector, "background-image", mem.imageUrl);
          if (mem.hex) update(selector, fillPropName, (mem.alpha ?? 1) < 1 ? hexToRgba(mem.hex, mem.alpha ?? 1) : mem.hex);
        }
      } catch { /* corrupted memory — leave hidden */ return; }
      update(selector, "--fill-mem", "0");
    }
  }, [fillMemActive, fillKind, fillSolidHex, fillSolidAlpha, fillGradientCss, fillImageUrl, fillVideoUrl, svgFillSupported, element, onSvgFillMedia, selector, fillPropName, fillGradientParsed, update]);

  // ── F3: stroke gating (oculto hasta +) + eye memory ──
  const strokeMemRaw = getCssPropertyValue(css, selector, "--stroke-mem");
  const strokeMemActive = Boolean(strokeMemRaw && strokeMemRaw !== "0");
  const strokeFx = useMemo<StrokeFx>(() => ({
    style: stroke.style || "solid",
    profile: getCssPropertyValue(css, selector, "--stroke-profile") || "uniform",
    cap: getCssPropertyValue(css, selector, "--stroke-cap") || "straight",
    capRound: parseInt(getCssPropertyValue(css, selector, "--stroke-cap-round") || "0") || 0,
    frequency: parseInt(getCssPropertyValue(css, selector, "--stroke-freq") || "20") || 20,
    wiggle: parseInt(getCssPropertyValue(css, selector, "--stroke-wiggle") || "0") || 0,
    smoothen: parseInt(getCssPropertyValue(css, selector, "--stroke-smooth") || "50") || 50,
    brush: getCssPropertyValue(css, selector, "--stroke-brush") || "",
  }), [css, selector, stroke.style]);
  const divStrokeOn = ((s["border-style"] || "none") !== "none" && (parseFloat(s["border-width"]) || 0) > 0)
    || ((s["outline-style"] || "none") !== "none" && (parseFloat(s["outline-width"]) || 0) > 0);
  const svgStrokeOn = (parseFloat(s["stroke-width"]) || 0) > 0;
  const strokePresent = isGroup ? true : strokeMemActive || (isSvgShape ? svgStrokeOn : divStrokeOn);

  const addStroke = useCallback(() => {
    if (isSvgShape) {
      updateMulti(selector, { stroke: "#000000", "stroke-width": "1px", "--stroke-mem": "0" });
    } else {
      writeStroke(props => updateMulti(selector, props), { position: "inside", weight: 1, color: "#000000", alpha: 1, style: "solid" });
      update(selector, "--stroke-mem", "0");
    }
  }, [isSvgShape, selector, updateMulti]);

  const toggleStrokeHidden = useCallback(() => {
    if (isGroup) return;
    if (isSvgShape) {
      if (!strokeMemActive) {
        update(selector, "--stroke-mem", JSON.stringify({ width: parseFloat(s["stroke-width"]) || 1 }));
        update(selector, "stroke-width", "0px");
      } else {
        try {
          const mem = JSON.parse(strokeMemRaw) as { width?: number };
          update(selector, "stroke-width", `${mem.width || 1}px`);
        } catch { update(selector, "stroke-width", "1px"); }
        update(selector, "--stroke-mem", "0");
      }
      return;
    }
    if (!strokeMemActive) {
      update(selector, "--stroke-mem", JSON.stringify(stroke));
      writeStroke(props => updateMulti(selector, props), { ...stroke, weight: stroke.weight || 1, style: stroke.style });
      // hide: drop the visible drawing, keep the values in the memory prop
      writeStroke(props => updateMulti(selector, props), { ...stroke, weight: stroke.weight || 1, style: stroke.style, alpha: stroke.alpha });
      updateMulti(selector, { "border-width": "0px", "border-style": "none", "outline-width": "0px", "outline-style": "none" });
    } else {
      try {
        const mem = JSON.parse(strokeMemRaw) as { position: StrokePosition; weight: number; color: string; alpha: number; style?: string };
        writeStroke(props => updateMulti(selector, props), mem);
      } catch {
        writeStroke(props => updateMulti(selector, props), { position: "inside", weight: 1, color: "#000000", alpha: 1, style: "solid" });
      }
      update(selector, "--stroke-mem", "0");
    }
  }, [isGroup, isSvgShape, strokeMemActive, strokeMemRaw, stroke, selector, update, updateMulti]);

  const applyStrokeFx = useCallback((next: Partial<StrokeFx>) => {
    if (next.style !== undefined) {
      if (isSvgShape) {
        const dash = next.style === "dashed" ? "6 4" : next.style === "dotted" ? "1 4" : "none";
        update(selector, "stroke-dasharray", dash);
      } else {
        writeStroke(props => updateMulti(selector, props), { ...stroke, style: next.style });
      }
    }
    if (next.cap !== undefined) {
      if (isSvgShape) {
        const cap = next.cap === "round" ? "round" : "butt";
        const join = next.cap === "round" ? "round" : next.cap === "bevel" ? "bevel" : "miter";
        updateMulti(selector, { "stroke-linecap": cap, "stroke-linejoin": join, "--stroke-cap": next.cap });
      } else {
        update(selector, "--stroke-cap", next.cap);
      }
    }
    if (next.profile !== undefined) update(selector, "--stroke-profile", next.profile);
    if (next.capRound !== undefined) update(selector, "--stroke-cap-round", String(next.capRound));
    if (next.frequency !== undefined) update(selector, "--stroke-freq", String(next.frequency));
    if (next.wiggle !== undefined) update(selector, "--stroke-wiggle", String(next.wiggle));
    if (next.smoothen !== undefined) update(selector, "--stroke-smooth", String(next.smoothen));
    if (next.brush !== undefined) update(selector, "--stroke-brush", next.brush || "0");
  }, [isSvgShape, stroke, selector, update, updateMulti]);

  // ── F1: effects with + / ojito / config — hidden values live in --fx-* props ──
  const parseHiddenShadowList = useCallback((raw: string): ShadowEffect[] =>
    raw && raw !== "0" ? raw.split(";;").flatMap(part => parseBoxShadows(part.trim())) : [], []);
  const memShadowsRaw = getCssPropertyValue(css, selector, "--fx-shadows");
  const hiddenShadows = parseHiddenShadowList(memShadowsRaw);
  const memLayerBlur = getCssPropertyValue(css, selector, "--fx-layerblur");
  const memBgBlur = getCssPropertyValue(css, selector, "--fx-bgblur");
  const memGlass = getCssPropertyValue(css, selector, "--fx-glass");
  const memNoises = (["noise", "texture", "dither"] as NoiseKind[]).map(kind => ({
    kind,
    value: getCssPropertyValue(css, selector, `--fx-${kind}`),
  }));

  const fxHasAny = shadows.length > 0 || layerBlur != null || bgBlur != null || hasGlass
    || hiddenShadows.length > 0
    || (memLayerBlur && memLayerBlur !== "0") || (memBgBlur && memBgBlur !== "0") || (memGlass && memGlass !== "0")
    || memNoises.some(n => n.value && n.value !== "0");

  const addEffect = useCallback((value: string) => {
    setFxAddOpen(false);
    if (value === "drop") {
      writeShadows([...shadows, DEFAULT_DROP_SHADOW]);
      setFxOpenKey(`sh:${shadows.length}`);
    } else if (value === "inner") {
      writeShadows([...shadows, DEFAULT_INNER_SHADOW]);
      setFxOpenKey(`sh:${shadows.length}`);
    } else if (value === "layerBlur") {
      update(selector, "--fx-layerblur", "0");
      update(selector, "filter", setFilterFn(s["filter"] || "", "blur", "8px"));
      setFxOpenKey("layerBlur");
    } else if (value === "bgBlur") {
      update(selector, "--fx-bgblur", "0");
      update(selector, "backdrop-filter", setFilterFn(s["backdrop-filter"] || "", "blur", "12px"));
      setFxOpenKey("bgBlur");
    } else if (value === "glass") {
      update(selector, "--fx-glass", "0");
      update(selector, "backdrop-filter", setFilterFn(setFilterFn(s["backdrop-filter"] || "", "blur", "12px"), "saturate", "1.8"));
      setFxOpenKey("glass");
    } else {
      const kind = value as NoiseKind;
      update(selector, `--fx-${kind}`, "0");
      update(selector, "filter", setNoiseFilter(s["filter"] || "", kind, 0.2));
      setFxOpenKey(kind);
    }
  }, [shadows, writeShadows, s, selector, update]);

  const hideShadowAt = useCallback((index: number) => {
    const target = shadows[index];
    if (!target) return;
    const memList = [...hiddenShadows, target];
    update(selector, "--fx-shadows", memList.map(formatShadow).join(";;"));
    writeShadows(shadows.filter((_, j) => j !== index));
  }, [shadows, hiddenShadows, selector, update, writeShadows]);

  const showHiddenShadowAt = useCallback((index: number) => {
    const target = hiddenShadows[index];
    if (!target) return;
    const rest = hiddenShadows.filter((_, j) => j !== index);
    update(selector, "--fx-shadows", rest.length ? rest.map(formatShadow).join(";;") : "0");
    writeShadows([...shadows, target]);
  }, [shadows, hiddenShadows, selector, update, writeShadows]);

  // ── F2 fill row: swatch preview + hex (solid) + transparencia % + ojito ──
  const fillSwatchBackground = fillKind === "solid" ? fillSolidHex
    : fillKind === "gradient" ? (fillGradientCss || "#333")
      : fillKind === "image" ? `url("${fillImageUrl}") center/cover`
        : "linear-gradient(135deg, #1c1a16, #4a4438)";
  const fillAvgAlpha = fillGradientParsed
    ? fillGradientParsed.stops.reduce((acc, st) => acc + st.alpha, 0) / (fillGradientParsed.stops.length || 1)
    : 1;
  const fillAlphaPct = fillKind === "solid" ? fillSolidAlpha * 100
    : fillKind === "gradient" ? fillAvgAlpha * 100
      : (parseFloat(s["opacity"]) || 1) * 100;

  const [fillHexText, setFillHexText] = useState(fillSolidHex);
  useEffect(() => { setFillHexText(fillSolidHex); }, [fillSolidHex]);
  const applyFillHexText = useCallback(() => {
    const parsed = parseColorText(fillHexText);
    if (parsed) writeFillSolid(parsed.hex, fillSolidAlpha);
    else setFillHexText(fillSolidHex);
  }, [fillHexText, fillSolidAlpha, fillSolidHex, writeFillSolid]);

  const applyFillAlphaPct = useCallback((v: string) => {
    const next = Math.max(0, Math.min(100, parseFloat(v) || 0)) / 100;
    if (fillKind === "solid") { writeFillSolid(fillSolidHex, next); return; }
    if (fillKind === "gradient" && fillGradientParsed) {
      // rescale every stop's alpha proportionally so relative blends survive
      writeFillGradient({
        ...fillGradientParsed,
        stops: fillGradientParsed.stops.map(st => ({
          ...st, alpha: fillAvgAlpha > 0 ? Math.max(0, Math.min(1, (st.alpha / fillAvgAlpha) * next)) : next,
        })),
      });
      return;
    }
    update(selector, "opacity", String(next));
  }, [fillKind, fillSolidHex, fillGradientParsed, fillAvgAlpha, writeFillSolid, writeFillGradient, selector, update]);

  // ── F1 effects: compact rows (nombre + ojito + ×); hide/show swaps the
  // live value with a --fx-* memory prop so nothing is lost by hiding. ──
  const fxMemToggle = useCallback((memProp: string, curValue: string | null, apply: (v: string | null) => void) => {
    const mem = getCssPropertyValue(css, selector, memProp);
    if (curValue != null) {
      update(selector, memProp, curValue);
      apply(null);
    } else if (mem && mem !== "0") {
      apply(mem);
      update(selector, memProp, "0");
    }
  }, [css, selector, update]);

  const activeNoises = (["noise", "texture", "dither"] as NoiseKind[])
    .map(kind => ({ kind, value: findNoiseFilter(s["filter"] || "", kind) }))
    .filter(n => n.value != null);
  const fxCount = shadows.length + hiddenShadows.length
    + (layerBlur != null ? 1 : 0) + (bgBlur != null ? 1 : 0) + (hasGlass ? 1 : 0)
    + activeNoises.length
    + (memLayerBlur && memLayerBlur !== "0" ? 1 : 0) + (memBgBlur && memBgBlur !== "0" ? 1 : 0)
    + (memGlass && memGlass !== "0" ? 1 : 0)
    + memNoises.filter(n => n.value && n.value !== "0").length;

  const fxRow = (key: string, label: string, opts?: { hidden?: boolean; onHide?: () => void; onShow?: () => void; onRemove?: () => void }) => (
    <div key={key} style={{ display: "flex", gap: 4, alignItems: "center", padding: "3px 6px", borderRadius: 4,
      background: "rgba(15,15,15,0.35)", border: "1px solid rgba(255,255,255,0.04)", opacity: opts?.hidden ? 0.45 : 1 }}>
      <button type="button" onClick={() => setFxOpenKey(fxOpenKey === key ? "" : key)}
        style={{ flex: 1, textAlign: "left", fontSize: 10, color: "#c8b898", background: "none", border: "none", cursor: "pointer", padding: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </button>
      {opts?.onHide && <EyeButton on onClick={opts.onHide} title="Ocultar (queda en memoria)" />}
      {opts?.onShow && <EyeButton on={false} onClick={opts.onShow} title="Mostrar" />}
      {opts?.onRemove && (
        <button type="button" title="Quitar" onClick={opts.onRemove}
          style={{ fontSize: 10, padding: "1px 5px", borderRadius: 2, border: "none", background: "rgba(239,68,68,0.15)", color: "#EF4444", cursor: "pointer" }}>×</button>
      )}
    </div>
  );

  return (
    <div className="html-contextual-panel" style={panelStyle}>
      {/* ── Minimal header, shown on every sub-tab ── */}
      <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#c8b898" }}>{element.tag.toUpperCase()}</span>
        <span style={{ fontSize: 9, color: "#555", fontFamily: "monospace" }}>{selector.length > 30 ? selector.slice(0, 30) + "…" : selector}</span>
      </div>

      {subTab === "properties" && (
        <div style={{ overflow: "auto", flex: 1 }}>
          {/* ══ Buscatrazos (REQ-043 Fase 3): 10 ops estilo Illustrator, parrilla 2×5 ══ */}
          {!isText && !isGroup && onBooleanOp && (
            <div style={{ padding: "6px 10px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 9, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1 }}>Buscatrazos</span>
                {!booleanOpReady && <span style={{ fontSize: 9, color: "#5a5850" }}>2+ figuras</span>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4 }}>
                {PF_OPS.map(({ op, label, title }) => (
                  <button key={op} type="button" disabled={!booleanOpReady} onClick={() => onBooleanOp(op)}
                    title={booleanOpReady ? title : `${title} — selecciona dos o más figuras`}
                    style={{ ...smallBtn, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "4px 0 3px", opacity: booleanOpReady ? 1 : 0.35, cursor: booleanOpReady ? "pointer" : "not-allowed" }}>
                    <PathfinderIcon op={op} />
                    <span style={{ fontSize: 7.5, lineHeight: 1 }}>{label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ══ Alineación (F1): 6 buttons, one row ══ */}
          <SectionHead label="Alineación" section="align" expanded={expanded} toggle={toggle} />
          {expanded.align && (
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
            </div>
          )}

          {/* ══ Posición ══ */}
          <SectionHead label="Posición" section="position" expanded={expanded} toggle={toggle} />
          {expanded.position && (
            <div style={sectionBody}>
              <div style={{ display: "flex", gap: 8 }}>
                <InlineField label="X"><ScrubbyInput value={String(parseInt(s["left"]) || 0)} onChange={v => update(selector, "left", `${parseInt(v) || 0}px`)} /></InlineField>
                <InlineField label="Y"><ScrubbyInput value={String(parseInt(s["top"]) || 0)} onChange={v => update(selector, "top", `${parseInt(v) || 0}px`)} /></InlineField>
              </div>
            </div>
          )}

          {/* ══ Rotación (F1): grados + reflejo horizontal + reflejo vertical ══ */}
          <SectionHead label="Rotación" section="rotation" expanded={expanded} toggle={toggle} />
          {expanded.rotation && (
            <div style={sectionBody}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <InlineField label="°">
                  <ScrubbyInput value={extractTransformValue(s["transform"], "rotate") || "0"}
                    onChange={v => update(selector, "transform", setTransformFunction(s["transform"], "rotate", normalizeAngleValue(v)))} suffix="°" />
                </InlineField>
                <button type="button" title="Reflejar horizontalmente"
                  onClick={() => update(selector, "transform", extractTransformValue(s["transform"], "scaleX") === "-1"
                    ? removeTransformFunction(s["transform"], "scaleX")
                    : setTransformFunction(s["transform"], "scaleX", "-1"))}
                  style={{ ...smallBtn, padding: "3px 8px", ...(extractTransformValue(s["transform"], "scaleX") === "-1" ? smallBtnActive : {}) }}>
                  ⇔
                </button>
                <button type="button" title="Reflejar verticalmente"
                  onClick={() => update(selector, "transform", extractTransformValue(s["transform"], "scaleY") === "-1"
                    ? removeTransformFunction(s["transform"], "scaleY")
                    : setTransformFunction(s["transform"], "scaleY", "-1"))}
                  style={{ ...smallBtn, padding: "3px 8px", ...(extractTransformValue(s["transform"], "scaleY") === "-1" ? smallBtnActive : {}) }}>
                  ⇕
                </button>
              </div>
            </div>
          )}

          {/* ══ Dimensiones ══ */}
          <SectionHead label="Dimensiones" section="layout" expanded={expanded} toggle={toggle} />
          {expanded.layout && (
            <div style={sectionBody}>
              <div style={{ display: "flex", gap: 8 }}>
                <InlineField label="W"><ScrubbyInput value={s["width"] || ""} onChange={v => update(selector, "width", v)} /></InlineField>
                <InlineField label="H"><ScrubbyInput value={s["height"] || ""} onChange={v => update(selector, "height", v)} /></InlineField>
              </div>
            </div>
          )}

          {/* ══ Apariencia (F1): opacidad + radio + radio-por-vértice en un row ══ */}
          <SectionHead label="Apariencia" section="appearance" expanded={expanded} toggle={toggle} />
          {expanded.appearance && (
            <div style={sectionBody}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <InlineField label="Op">
                  <ScrubbyInput value={String(Math.round((parseFloat(s["opacity"]) || 0) * 100))} min={0} max={100} suffix="%"
                    onChange={v => update(selector, "opacity", String(Math.max(0, Math.min(100, parseInt(v) || 0)) / 100))} />
                </InlineField>
                {shapeRadii ? (
                  <>
                    <InlineField label="Radio">
                      {/* F4: live while a canvas vertex circle is dragged */}
                      <ScrubbyInput value={String(Math.round(shapeRadiusDisplay || 0))} min={0} suffix="px"
                        onChange={v => {
                          const next = Math.max(0, parseFloat(v) || 0);
                          if (element.shapeOptions && onShapeOptionsChange) {
                            onShapeOptionsChange(element.layerId, element.frameId, { ...element.shapeOptions, cornerRadius: next });
                          } else {
                            onShapeVertexRadiusChange?.(element.layerId, element.frameId, "all", next);
                          }
                        }} />
                    </InlineField>
                    <button type="button" title="Radio por vértice" onClick={() => setVertexListOpen(open => !open)}
                      style={{ ...smallBtn, padding: "3px 6px", ...(vertexListOpen ? smallBtnActive : {}) }}>
                      ◈ {shapeRadii.length}
                    </button>
                  </>
                ) : (
                  <InlineField label="Radio">
                    <ScrubbyInput value={s["border-radius"] || "0"} onChange={v => update(selector, "border-radius", v)} suffix="px" />
                  </InlineField>
                )}
              </div>
              {shapeRadii && vertexListOpen && (
                <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "4px 6px", borderRadius: 4, background: "rgba(15,15,15,0.35)", border: "1px solid rgba(255,255,255,0.04)" }}>
                  {shapeRadii.map((radius, index) => (
                    <PropRow key={index} label={`V${index + 1}`}>
                      <ScrubbyInput
                        value={String(Math.round((element && liveShapeRadius?.layerId === element.layerId
                          ? liveShapeRadius.radii[index]
                          : radius) || 0))}
                        min={0} suffix="px"
                        onChange={v => onShapeVertexRadiusChange?.(element.layerId, element.frameId, index, Math.max(0, parseFloat(v) || 0))} />
                    </PropRow>
                  ))}
                  {shapeRadii.length > 0 && (
                    <PropRow label="Reset">
                      <button type="button" style={smallBtn}
                        onClick={() => onShapeVertexRadiusChange?.(element.layerId, element.frameId, "all", 0)}>
                        Todas a 0
                      </button>
                    </PropRow>
                  )}
                </div>
              )}
              {!shapeRadii && (
                <div style={{ display: "flex", gap: 4 }}>
                  {(["top-left", "top-right", "bottom-right", "bottom-left"] as const).map(corner => (
                    <div key={corner} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                      <span style={{ fontSize: 8, color: "#555" }}>{corner.split("-").map(w => w[0]).join("")}</span>
                      <input value={s[`border-${corner}-radius`] || ""} placeholder="0" onChange={e => update(selector, `border-${corner}-radius`, e.target.value)} style={{ ...miniInp, width: 36, textAlign: "center" }} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ══ Fill (F2): swatch + hex + transparencia + ojito; doble click abre el picker ══ */}
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
                  {onOpenPhotoMode && element.src && (
                    <button type="button" style={smallBtn} onClick={onOpenPhotoMode}
                      title="Abre el Modo Foto: revelado no destructivo de esta imagen (luz, color, curvas, HSL, máscaras, recetas). El original nunca se reescribe.">
                      Editar foto
                    </button>
                  )}
                  {onImageSrcChange && element.src && (
                    <>
                      <button type="button" onClick={handleRemoveBackground} disabled={removeBgState === "loading"}
                        style={{ ...smallBtn, opacity: removeBgState === "loading" ? 0.55 : 1, cursor: removeBgState === "loading" ? "wait" : "pointer" }}>
                        {removeBgState === "loading" ? "Quitando fondo…" : removeBgState === "error" ? "Reintentar (quitar fondo)" : "Quitar fondo"}
                      </button>
                      {removeBgError && <div style={mutedNote}>{removeBgError}</div>}
                    </>
                  )}
                  {imageOrigSrc && onImageRestore && (
                    <button type="button" style={smallBtn} onClick={handleRestoreOriginal}>Restaurar</button>
                  )}
                  {imageHasMask && onImageMaskRemove && (
                    <button type="button" style={smallBtn} onClick={handleMaskRemove}
                      title="Quita la máscara (trazos del borrador / selección) y restaura la imagen completa. No destructivo: Ctrl+Z lo devuelve.">
                      Quitar máscara
                    </button>
                  )}
                  {onTraceImage && (
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <select value={tracePreset} onChange={e => setTracePreset(e.target.value)}
                        style={{ ...inp, flex: 1, minWidth: 0 }}
                        title="Preset del buscatrazos local (Image Trace, REQ-043)">
                        {TRACE_PRESETS.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                      </select>
                      <button type="button" disabled={traceBusy}
                        style={{ ...smallBtn, flexShrink: 0, opacity: traceBusy ? 0.55 : 1, cursor: traceBusy ? "wait" : "pointer" }}
                        onClick={() => onTraceImage(tracePreset)}
                        title="Convierte la imagen en vectores editables en tu navegador — sin IA ni red (REQ-043).">
                        {traceBusy ? "Trazando…" : "Trazar"}
                      </button>
                    </div>
                  )}
                  <OpacityRow label="Opacity" value={s["opacity"] || "1"} onChange={v => update(selector, "opacity", v)} />
                </>
              ) : isGroup ? (
                /* A group paints nothing itself. Its fill is the fill of
                   everything inside it, listed one entry per distinct colour
                   so each hex can be read and copied. */
                <>
                  {groupFills.length === 0 ? (
                    <>
                      <ColorRow label="Fill" value="" onChange={fillWholeGroup} />
                      <div style={mutedNote}>
                        Nada dentro tiene relleno. El color pintará el interior de los {groupTargetCount} objetos,
                        no un rectángulo detrás.
                      </div>
                    </>
                  ) : (
                    <>
                      {groupFills.map((entry, index) => (
                        <ColorRow
                          key={entry.layerIds.join(",")}
                          label={groupFills.length > 1 ? `Fill ${index + 1}` : "Fill"}
                          value={entry.value}
                          onChange={v => setGroupFill(entry.layerIds, v)}
                        />
                      ))}
                      {groupFills.length > 1 && (
                        <PropRow label="Todos">
                          <button type="button" style={smallBtn} onClick={() => fillWholeGroup(groupFills[0].value)}>
                            Igualar los {groupFills.length} rellenos
                          </button>
                        </PropRow>
                      )}
                    </>
                  )}
                  <OpacityRow label="Opacity" value={s["opacity"] || "1"} onChange={v => update(selector, "opacity", v)} />
                </>
              ) : svgFillSupported || fillProperty ? (
                /* One row for every medium — color, degradado, foto o video.
                   The swatch previews the kind; double-click opens the picker. */
                <div ref={fillRowRef} style={{ position: "relative", display: "flex", flexDirection: "column", gap: 4 }}>
                  <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} onChange={handleBgImageUpload} ref={bgImageInputRef} />
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <div title="Click: abrir el picker de relleno (color, degradado, foto, video)"
                      onDoubleClick={() => setFillPickerOpen(true)}
                      onClick={() => setFillPickerOpen(o => !o)}
                      style={{ width: 26, height: 22, flexShrink: 0, borderRadius: 4, cursor: "pointer",
                        border: "1px solid rgba(255,255,255,0.15)", background: fillSwatchBackground }} />
                    {fillKind === "solid" ? (
                      <input value={fillHexText} onChange={e => setFillHexText(e.target.value)}
                        onBlur={applyFillHexText}
                        onKeyDown={e => { if (e.key === "Enter") applyFillHexText(); }}
                        style={{ ...inp, flex: 1, minWidth: 0 }} />
                    ) : (
                      <button type="button" onClick={() => setFillPickerOpen(true)}
                        title={fillKind === "image" ? fillImageUrl : undefined}
                        style={{ ...smallBtn, flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {fillKind === "gradient" && fillGradientParsed
                          ? `${fillGradientParsed.type === "linear" ? "Lineal" : fillGradientParsed.type === "radial" ? "Radial" : fillGradientParsed.type === "conic" ? "Angular" : "Diamante"} · ${fillGradientParsed.stops.length} nodos`
                          : fillKind === "image" ? "Foto de relleno"
                            : "Video de relleno"}
                      </button>
                    )}
                    <InlineField label="Trans">
                      <ScrubbyInput value={String(Math.round(fillAlphaPct))} min={0} max={100} suffix="%"
                        onChange={applyFillAlphaPct} />
                    </InlineField>
                    <EyeButton on={!fillMemActive} onClick={toggleFillHidden} />
                  </div>
                  {fillPickerOpen && (
                    <PanelPopup anchor={fillRowRef} onClose={() => setFillPickerOpen(false)}>
                      <FillPickerCard
                        kind={fillKind}
                        hex={fillSolidHex} alpha={fillSolidAlpha}
                        gradient={fillGradientParsed}
                        imageUrl={fillImageUrl} videoUrl={fillVideoUrl}
                        onKind={switchFillKind}
                        onSolid={writeFillSolid}
                        onGradient={writeFillGradient}
                        onImageUrl={writeFillImage}
                        onVideoUrl={writeFillVideo}
                        onUpload={() => bgImageInputRef.current?.click()}
                        onClose={() => setFillPickerOpen(false)}
                        cmykOnly={cmykOnly}
                        onCmykOnlyChange={handleCmykOnlyChange} />
                    </PanelPopup>
                  )}
                  {fillKind === "video" && (
                    <div style={mutedNote}>El video se guarda en la capa (--fill-video); la reproducción en el lienzo depende del soporte del elemento.</div>
                  )}
                  {/* Imprenta: vive en el CSS del frame → sobrevive al raster del
                      export y al guardado; ver handleCmykOnlyChange/applySpotInk. */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    {/* REQ-027: dropdown completo en Propiedades (los 16 blend
                        modes CSS de BLEND_MODES, misma constante que la
                        sección Blend del Code tab). El checkbox multiply
                        original quedó cubierto por "Multiply (imprenta)": es
                        el modo que absorbe tinta y el que respeta el flujo
                        CMYK del export. */}
                    <PropRow label="Blend">
                      <select value={s["mix-blend-mode"] || "normal"}
                        onChange={e => update(selector, "mix-blend-mode", e.target.value)}
                        style={sel}>
                        {BLEND_MODES.map(b => (
                          <option key={b} value={b}>
                            {b === "multiply" ? "Multiply (imprenta)" : b.charAt(0).toUpperCase() + b.slice(1)}
                          </option>
                        ))}
                      </select>
                    </PropRow>
                    <PropRow label="Tinta">
                      <select value={spotInkObj ? spotInkObj.name : SPOT_NONE}
                        onChange={e => applySpotInk(e.target.value)} style={sel}>
                        <option value={SPOT_NONE}>— ninguna —</option>
                        {SPOT_INKS.map(ink => <option key={ink.id} value={ink.name}>{ink.name}</option>)}
                      </select>
                    </PropRow>
                    {spotInkObj && (
                      <div style={mutedNote}>
                        Spot: el PDF lleva la aproximación CMYK {spotInkObj.cmyk.join(" · ")}; para la tinta real pide placa aparte en imprenta.
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={mutedNote}>Este elemento no tiene relleno propio.</div>
              )}
            </div>
          )}

          {/* ══ Tipografía (F1): Font/Size/Weight/Spacing/Align; avanzados bajo toggle ══ */}
          {(isText || isSvgText) && (
            <>
              <SectionHead label="Tipografía" section="typography" expanded={expanded} toggle={toggle} />
              {expanded.typography && (
                <div style={sectionBody}>
                  <PropRow label="Font">
                    <GoogleFontPicker value={textValue("font-family") === MIXED_TEXT_STYLE ? "Mixed" : primaryFamily(textValue("font-family"))} onChange={(f) => applyTypography("font-family", cssFontFamily(f))} />
                  </PropRow>
                  <PropRow label="Size">
                    <ScrubbyInput value={textValue("font-size") === MIXED_TEXT_STYLE ? "" : textValue("font-size")} onChange={v => applyTypography("font-size", v)} label="" suffix="px" />
                  </PropRow>
                  <SelectRow label="Weight" value={textValue("font-weight", "400")} options={FONT_WEIGHTS} onChange={v => applyTypography("font-weight", v)} />
                  <PropRow label="Spacing">
                    <ScrubbyInput value={textValue("letter-spacing", "normal") === MIXED_TEXT_STYLE ? "" : textValue("letter-spacing", "normal")} onChange={v => applyTypography("letter-spacing", v)} />
                  </PropRow>
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
                  <button type="button" onClick={() => setTypeAdvancedOpen(o => !o)}
                    style={{ ...smallBtn, width: "100%", ...(typeAdvancedOpen ? smallBtnActive : {}) }}>
                    {typeAdvancedOpen ? "− Controles avanzados" : "+ Controles avanzados"}
                  </button>
                  {typeAdvancedOpen && (
                    <>
                      <SelectRow label="Deco" value={textValue("text-decoration", "none")} options={TEXT_DECORATIONS} onChange={v => applyTypography("text-decoration", v)} />
                      <SelectRow label="Case" value={textValue("text-transform", "none")} options={TEXT_TRANSFORMS} onChange={v => applyTypography("text-transform", v)} />
                      <PropRow label="Line-H">
                        <ScrubbyInput value={textValue("line-height") === MIXED_TEXT_STYLE ? "" : textValue("line-height")} onChange={v => applyTypography("line-height", v)} />
                      </PropRow>
                      <PropRow label="Txt Shadow">
                        <input value={s["text-shadow"] || "none"} placeholder="0 2px 4px rgba(0,0,0,0.2)" onChange={e => update(selector, "text-shadow", e.target.value)} style={inp} />
                      </PropRow>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {/* ══ Borde (F3): oculto hasta +; color/transparencia/ojito + posición/grosor/controles ══ */}
          <SectionHead label="Borde" section="stroke" expanded={expanded} toggle={toggle} />
          {expanded.stroke && (
            <div style={sectionBody}>
              {isGroup ? (
                /* Outlines the members, not the rectangle around them. */
                <>
                  <div style={{ display: "flex", gap: 8 }}>
                    <InlineField label="Color">
                      <input type="color" value={toHex(groupStrokes[0]?.value)} onChange={e => setGroupStroke("color", e.target.value)} style={colorInp} />
                    </InlineField>
                    <InlineField label="Weight">
                      <ScrubbyInput value="0" min={0} onChange={v => setGroupStroke("width", `${Math.max(0, parseFloat(v) || 0)}px`)} suffix="px" />
                    </InlineField>
                  </div>
                  <div style={mutedNote}>
                    Se aplica al contorno de los {groupTargetCount} objetos del grupo.
                    {groupStrokes.length > 1 && ` Ahora tienen ${groupStrokes.length} colores distintos.`}
                  </div>
                </>
              ) : !strokePresent ? (
                <button type="button" onClick={addStroke} style={{ ...smallBtn, width: "100%" }}>+ Añadir borde</button>
              ) : (
                <div ref={strokeRowRef} style={{ position: "relative", display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <button type="button" title="Color del borde" onClick={() => setStrokePickerOpen(o => !o)}
                      style={{ ...colorInp, background: isSvgShape ? toHex(s["stroke"]) : stroke.color }} />
                    {strokePickerOpen && (
                      <PanelPopup anchor={strokeRowRef} onClose={() => setStrokePickerOpen(false)}>
                        <ColorPickerCard
                          hex={isSvgShape ? toHex(s["stroke"]) : stroke.color}
                          alpha={isSvgShape ? Math.max(0, Math.min(1, parseFloat(s["stroke-opacity"]) || 1)) : stroke.alpha}
                          cmykOnly={cmykOnly}
                          onCmykOnlyChange={handleCmykOnlyChange}
                          onChange={(hex, alpha) => {
                            if (isSvgShape) {
                              update(selector, "stroke", hex);
                              update(selector, "stroke-opacity", String(alpha));
                            } else {
                              writeStroke(props => updateMulti(selector, props), { ...stroke, color: hex, alpha });
                            }
                          }} />
                      </PanelPopup>
                    )}
                    {isSvgShape ? (
                      <InlineField label="Trans">
                        <ScrubbyInput value={String(Math.round((parseFloat(s["stroke-opacity"]) || 1) * 100))} min={0} max={100} suffix="%"
                          onChange={v => update(selector, "stroke-opacity", String(Math.max(0, Math.min(100, parseFloat(v) || 0)) / 100))} />
                      </InlineField>
                    ) : (
                      <InlineField label="Trans">
                        <ScrubbyInput value={String(Math.round(stroke.alpha * 100))} min={0} max={100} suffix="%"
                          onChange={v => writeStroke(props => updateMulti(selector, props),
                            { ...stroke, alpha: Math.max(0, Math.min(100, parseFloat(v) || 0)) / 100 })} />
                      </InlineField>
                    )}
                    <EyeButton on={!strokeMemActive} onClick={toggleStrokeHidden} />
                    <button type="button" title="Quitar borde"
                      onClick={() => isSvgShape
                        ? updateMulti(selector, { "stroke-width": "0px", "--stroke-mem": "0" })
                        : updateMulti(selector, { "border-width": "0px", "border-style": "none", "outline-width": "0px", "outline-style": "none", "--stroke-mem": "0" })}
                      style={{ ...smallBtn, color: "#EF4444" }}>×</button>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {!isSvgShape && (
                      <InlineField label="Pos">
                        <select value={stroke.position}
                          onChange={e => writeStroke(props => updateMulti(selector, props), { ...stroke, position: e.target.value as StrokePosition })}
                          style={sel}>
                          <option value="inside">Adentro</option>
                          <option value="center">Centro</option>
                          <option value="outside">Afuera</option>
                        </select>
                      </InlineField>
                    )}
                    <InlineField label="Grosor">
                      <ScrubbyInput value={isSvgShape ? String(parseFloat(s["stroke-width"]) || 0) : String(stroke.weight)} min={0}
                        onChange={v => {
                          const px = Math.max(0, parseFloat(v) || 0);
                          if (isSvgShape) update(selector, "stroke-width", `${px}px`);
                          else writeStroke(props => updateMulti(selector, props), { ...stroke, weight: px });
                        }} suffix="px" />
                    </InlineField>
                    {/* REQ-027: control dashed — cada rama habla su dialecto:
                        SVG usa strokeDasharray (ya estaba en el modelo), el
                        borde CSS usa border/outline-style. */}
                    <InlineField label="Dash">
                      <select
                        value={isSvgShape ? (s["stroke-dasharray"] || "none") : (s["border-style"] || "solid")}
                        onChange={e => {
                          const v = e.target.value;
                          if (isSvgShape) update(selector, "stroke-dasharray", v);
                          else updateMulti(selector, { "border-style": v, "outline-style": v });
                        }}
                        style={sel}>
                        {isSvgShape ? (
                          <>
                            <option value="none">Sólida</option>
                            <option value="2 4">Punteada</option>
                            <option value="4 4">Rayas 4·4</option>
                            <option value="8 8">Rayas 8·8</option>
                          </>
                        ) : (
                          <>
                            <option value="solid">Sólida</option>
                            <option value="dotted">Punteada</option>
                            <option value="dashed">Rayas</option>
                          </>
                        )}
                      </select>
                    </InlineField>
                    <button type="button" title="Controles del trazo" onClick={() => setStrokeControlsOpen(o => !o)}
                      style={{ ...smallBtn, ...(strokeControlsOpen ? smallBtnActive : {}) }}>⚙</button>
                  </div>
                  {strokeControlsOpen && (
                    <PanelPopup anchor={strokeRowRef} onClose={() => setStrokeControlsOpen(false)}>
                      <StrokeControlsCard fx={strokeFx} isSvg={isSvgShape} onChange={applyStrokeFx} onClose={() => setStrokeControlsOpen(false)} />
                    </PanelPopup>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ══ Efectos (F1): + añade; filas compactas con ojito/×; config al click en el nombre ══ */}
          <SectionHead label="Efectos" section="effects" expanded={expanded} toggle={toggle} />
          {expanded.effects && (
            <div style={sectionBody}>
              {!fxHasAny ? (
                <div style={{ position: "relative" }} ref={fxAddRowRef}>
                  <button type="button" onClick={() => setFxAddOpen(true)} style={{ ...smallBtn, width: "100%" }}>+ Añadir efecto</button>
                  {fxAddOpen && (
                    <PanelPopup anchor={fxAddRowRef} onClose={() => setFxAddOpen(false)}>
                      <EffectsAddCard onPick={addEffect} onClose={() => setFxAddOpen(false)} />
                    </PanelPopup>
                  )}
                </div>
              ) : (
                <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", position: "relative" }} ref={fxAddRowRef}>
                    <button type="button" title="Añadir efecto" onClick={() => setFxAddOpen(true)} style={{ ...smallBtn, width: 24, flexShrink: 0 }}>+</button>
                    {fxAddOpen && (
                      <PanelPopup anchor={fxAddRowRef} onClose={() => setFxAddOpen(false)}>
                        <EffectsAddCard onPick={addEffect} onClose={() => setFxAddOpen(false)} />
                      </PanelPopup>
                    )}
                    <span style={{ fontSize: 9, color: "#7a7668" }}>{fxCount} {fxCount === 1 ? "efecto" : "efectos"}</span>
                  </div>
                  {shadows.map((sh, i) => fxRow(`sh:${i}`, sh.inset ? `Sombra interna ${i + 1}` : `Sombra ${i + 1}`, {
                    onHide: () => hideShadowAt(i),
                    onRemove: () => writeShadows(shadows.filter((_, j) => j !== i)),
                  }))}
                  {hiddenShadows.map((sh, i) => fxRow(`hsh:${i}`, sh.inset ? `Sombra interna ${i + 1} (oculta)` : `Sombra ${i + 1} (oculta)`, {
                    hidden: true,
                    onShow: () => showHiddenShadowAt(i),
                    onRemove: () => {
                      const rest = hiddenShadows.filter((_, j) => j !== i);
                      update(selector, "--fx-shadows", rest.length ? rest.map(formatShadow).join(";;") : "0");
                    },
                  }))}
                  {layerBlur != null && fxRow("layerBlur", "Layer Blur", {
                    onHide: () => fxMemToggle("--fx-layerblur", layerBlur, v => update(selector, "filter", setFilterFn(s["filter"] || "", "blur", v))),
                    onRemove: () => {
                      update(selector, "filter", setFilterFn(s["filter"] || "", "blur", null));
                      update(selector, "--fx-layerblur", "0");
                    },
                  })}
                  {layerBlur == null && memLayerBlur && memLayerBlur !== "0" && fxRow("layerBlur", "Layer Blur (oculto)", {
                    hidden: true,
                    onShow: () => fxMemToggle("--fx-layerblur", null, v => update(selector, "filter", setFilterFn(s["filter"] || "", "blur", v))),
                    onRemove: () => update(selector, "--fx-layerblur", "0"),
                  })}
                  {bgBlur != null && fxRow("bgBlur", "Background Blur", {
                    onHide: () => fxMemToggle("--fx-bgblur", bgBlur, v => update(selector, "backdrop-filter", setFilterFn(s["backdrop-filter"] || "", "blur", v))),
                    onRemove: () => {
                      update(selector, "backdrop-filter", setFilterFn(s["backdrop-filter"] || "", "blur", null));
                      update(selector, "--fx-bgblur", "0");
                    },
                  })}
                  {bgBlur == null && memBgBlur && memBgBlur !== "0" && fxRow("bgBlur", "Background Blur (oculto)", {
                    hidden: true,
                    onShow: () => fxMemToggle("--fx-bgblur", null, v => update(selector, "backdrop-filter", setFilterFn(s["backdrop-filter"] || "", "blur", v))),
                    onRemove: () => update(selector, "--fx-bgblur", "0"),
                  })}
                  {hasGlass && fxRow("glass", "Glass", {
                    onHide: () => fxMemToggle("--fx-glass", "glass", v => update(selector, "backdrop-filter",
                      v ? setFilterFn(setFilterFn(s["backdrop-filter"] || "", "blur", bgBlur ?? "12px"), "saturate", "1.8") : setFilterFn(s["backdrop-filter"] || "", "saturate", null))),
                    onRemove: () => {
                      update(selector, "backdrop-filter", setFilterFn(s["backdrop-filter"] || "", "saturate", null));
                      update(selector, "--fx-glass", "0");
                    },
                  })}
                  {!hasGlass && memGlass && memGlass !== "0" && fxRow("glass", "Glass (oculto)", {
                    hidden: true,
                    onShow: () => fxMemToggle("--fx-glass", null, v => update(selector, "backdrop-filter",
                      v ? setFilterFn(setFilterFn(s["backdrop-filter"] || "", "blur", bgBlur ?? "12px"), "saturate", "1.8") : setFilterFn(s["backdrop-filter"] || "", "saturate", null))),
                    onRemove: () => update(selector, "--fx-glass", "0"),
                  })}
                  {activeNoises.map(({ kind, value }) => fxRow(kind, kind[0].toUpperCase() + kind.slice(1), {
                    onHide: () => fxMemToggle(`--fx-${kind}`, String(value), v => update(selector, "filter", setNoiseFilter(s["filter"] || "", kind, v ? parseFloat(v) : null))),
                    onRemove: () => {
                      update(selector, "filter", setNoiseFilter(s["filter"] || "", kind, null));
                      update(selector, `--fx-${kind}`, "0");
                    },
                  }))}
                  {memNoises.filter(n => n.value && n.value !== "0").map(({ kind }) => fxRow(`h-${kind}`, `${kind[0].toUpperCase() + kind.slice(1)} (oculto)`, {
                    hidden: true,
                    onShow: () => fxMemToggle(`--fx-${kind}`, null, v => update(selector, "filter", setNoiseFilter(s["filter"] || "", kind, v ? parseFloat(v) : null))),
                    onRemove: () => update(selector, `--fx-${kind}`, "0"),
                  }))}

                  {/* config card for the clicked row */}
                  {fxOpenKey && fxOpenKey.startsWith("sh:") && shadows[parseInt(fxOpenKey.slice(3))] && (() => {
                    const i = parseInt(fxOpenKey.slice(3));
                    const sh = shadows[i];
                    return (
                      <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: 6, borderRadius: 4, background: "rgba(15,15,15,0.35)", border: "1px solid rgba(255,255,255,0.04)" }}>
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
                          <InlineField label="Alpha"><ScrubbyInput value={String(Math.round(sh.alpha * 100))} min={0} max={100} suffix="%"
                            onChange={v => writeShadows(shadows.map((x, j) => j === i ? { ...x, alpha: Math.max(0, Math.min(100, parseFloat(v) || 0)) / 100 } : x))} /></InlineField>
                        </div>
                      </div>
                    );
                  })()}
                  {fxOpenKey === "layerBlur" && layerBlur != null && (
                    <PropRow label="Layer Blur">
                      <ScrubbyInput value={String(parseFloat(layerBlur) || 0)} min={0} suffix="px"
                        onChange={v => update(selector, "filter", setFilterFn(s["filter"] || "", "blur", `${Math.max(0, parseInt(v) || 0)}px`))} />
                    </PropRow>
                  )}
                  {fxOpenKey === "bgBlur" && bgBlur != null && (
                    <PropRow label="BG Blur">
                      <ScrubbyInput value={String(parseFloat(bgBlur) || 0)} min={0} suffix="px"
                        onChange={v => update(selector, "backdrop-filter", setFilterFn(s["backdrop-filter"] || "", "blur", `${Math.max(0, parseInt(v) || 0)}px`))} />
                    </PropRow>
                  )}
                  {fxOpenKey === "glass" && hasGlass && (
                    <PropRow label="Glass">
                      <ScrubbyInput value={String(getFilterFn(s["backdrop-filter"] || "", "saturate") || "1.8")} suffix="×"
                        onChange={v => update(selector, "backdrop-filter", setFilterFn(s["backdrop-filter"] || "", "saturate", v))} />
                    </PropRow>
                  )}
                  {activeNoises.filter(n => fxOpenKey === n.kind).map(({ kind, value }) => (
                    <OpacityRow key={kind} label={kind[0].toUpperCase() + kind.slice(1)} value={String(value)}
                      onChange={v => update(selector, "filter", setNoiseFilter(s["filter"] || "", kind, Math.max(0, Math.min(1, parseFloat(v) || 0))))} />
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      )}

      {subTab === "code" && (
        <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 10, overflow: "auto", flex: 1 }}>
          {codeToolbar && (
            <div>
              <div style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Operaciones</div>
              {codeToolbar}
            </div>
          )}
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
          {/* REQ 4b.2.3: entrar al Modo Video desde la pestaña Animación —
              sin depender de tener un frame seleccionado (sirve también con
              una capa suelta). El modo es un modo del EDITOR, no un ajuste. */}
          {onOpenVideoMode && (
            <button
              type="button"
              onClick={onOpenVideoMode}
              style={{
                ...smallBtn, width: "100%", padding: "6px 8px", fontSize: 11, marginBottom: 8,
                borderColor: "rgba(200,184,152,0.4)", background: "rgba(200,184,152,0.12)",
              }}
            >
              🎬 Modo Video — storyboard del reel
            </button>
          )}
          {/* ── F0 animation authoring for the selected layer (spec §3): the
              JSON schema edits here and previews live via the playback store. ── */}
          {element && onFrameAnimationChange && (
            <AnimationPanel
              frameId={element.frameId}
              layerId={element.layerId}
              animation={frameAnimation ?? null}
              onAnimationChange={onFrameAnimationChange}
            />
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
                </div>
              )}
            </>
          )}

          {/* ── REQ-043: Objeto → Trazado — comandos sobre el modelo de
              anclas + contorno/desplazamiento con la geometría real ── */}
          {isSvgPath && element && (onObjectPathOp || onOutlineStroke || onOffsetPath) && (
            <>
              <SectionHead label="Objeto → Trazado" section="pathops" expanded={expanded} toggle={toggle} />
              {expanded.pathops !== false && (
                <div style={sectionBody}>
                  {onObjectPathOp && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      <button type="button" onClick={() => onObjectPathOp("simplify", element.layerId, element.frameId)} style={{ ...smallBtn, justifyContent: "center" }}>Simplificar</button>
                      <button type="button" onClick={() => onObjectPathOp("smooth", element.layerId, element.frameId)} style={{ ...smallBtn, justifyContent: "center" }}>Suavizar</button>
                      <button type="button" onClick={() => onObjectPathOp("addAnchors", element.layerId, element.frameId)} style={{ ...smallBtn, justifyContent: "center" }}>Añadir anclas</button>
                      <button type="button" onClick={() => onObjectPathOp("removeRedundant", element.layerId, element.frameId)} style={{ ...smallBtn, justifyContent: "center" }}>Quitar redundantes</button>
                      <button type="button" onClick={() => onObjectPathOp("join", element.layerId, element.frameId)} style={{ ...smallBtn, gridColumn: "1 / -1", justifyContent: "center" }}>Unir{booleanOpReady ? " (selección)" : ""}</button>
                    </div>
                  )}
                  {onOutlineStroke && (
                    <button type="button" onClick={() => onOutlineStroke(element.layerId, element.frameId)} style={{ ...smallBtn, width: "100%", justifyContent: "center", marginTop: 6 }}>Outline Stroke</button>
                  )}
                  {onOffsetPath && (
                    <PropRow label="Desplazar (px)">
                      <ScrubbyInput value={String(offsetDelta)} min={1} max={200} suffix="px"
                        onChange={v => setOffsetDelta(Math.max(0.5, parseFloat(v) || 4))} />
                      <button type="button" onClick={() => onOffsetPath(element.layerId, element.frameId, -Math.abs(offsetDelta))} style={smallBtn}>−</button>
                      <button type="button" onClick={() => onOffsetPath(element.layerId, element.frameId, Math.abs(offsetDelta))} style={smallBtn}>+</button>
                    </PropRow>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── Stroke details (SVG paths only): linecap/join/dash ── */}
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
