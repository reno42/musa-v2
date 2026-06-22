import { useState, useCallback } from "react";
import type { SelectedElementInfo } from "./DesignFrame";
import { GoogleFontPicker } from "./GoogleFontPicker";

/**
 * HtmlContextualPanel — Contextual tools that appear when an element
 * is selected inside a frame. Mirrors the "typometer", "paint brushes",
 * and "color palettes" on the real desk.
 */

interface Props {
  element: SelectedElementInfo | null;
  css: string;
  onCssChange: (newCss: string) => void;
  onChangeTag?: (newTag: string) => void;
}

const FONT_WEIGHTS = [
  { label: "Thin 100", value: "100" },
  { label: "ExtraLight 200", value: "200" },
  { label: "Light 300", value: "300" },
  { label: "Regular 400", value: "400" },
  { label: "Medium 500", value: "500" },
  { label: "Semibold 600", value: "600" },
  { label: "Bold 700", value: "700" },
  { label: "ExtraBold 800", value: "800" },
  { label: "Black 900", value: "900" },
];

const TEXT_DECORATIONS = [
  { label: "None", value: "none" },
  { label: "Underline", value: "underline" },
  { label: "Overline", value: "overline" },
  { label: "Line-through", value: "line-through" },
];

const TEXT_TRANSFORMS = [
  { label: "None", value: "none" },
  { label: "UPPER", value: "uppercase" },
  { label: "lower", value: "lowercase" },
  { label: "Capitalize", value: "capitalize" },
];

const ALIGNMENTS = [
  { label: "\u2190", value: "left", title: "Align Left" },
  { label: "\u2194", value: "center", title: "Align Center" },
  { label: "\u2192", value: "right", title: "Align Right" },
  { label: "\u2261", value: "justify", title: "Justify" },
];

const panelStyle: React.CSSProperties = {
  width: 260,
  background: "rgba(18,18,36,0.92)",
  backdropFilter: "blur(10px)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 8,
  color: "#e0e0e0",
  fontSize: 12,
  fontFamily: "Inter, system-ui, sans-serif",
  overflow: "auto",
  padding: 0,
};

const sectionHead: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: 10,
  color: "#7a7668",
  textTransform: "uppercase",
  letterSpacing: 1,
  borderBottom: "1px solid rgba(255,255,255,0.04)",
  display: "flex",
  justifyContent: "space-between",
  cursor: "pointer",
  userSelect: "none",
  background: "none",
  border: "none",
  width: "100%",
  textAlign: "left",
};

const inp: React.CSSProperties = {
  flex: 1,
  background: "rgba(15,15,15,0.5)",
  border: "1px solid rgba(255,255,255,0.05)",
  color: "#f0ebe0",
  borderRadius: 4,
  padding: "3px 6px",
  fontSize: 12,
  fontFamily: "monospace",
};

const sel: React.CSSProperties = {
  flex: 1,
  background: "rgba(15,15,15,0.5)",
  border: "1px solid rgba(255,255,255,0.04)",
  color: "#f0ebe0",
  borderRadius: 4,
  padding: "3px 6px",
  fontSize: 12,
};

const SEMANTIC_TAGS = [
  "div", "section", "article", "aside", "header", "footer", "nav", "main",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "span", "a", "button", "label", "input", "form",
  "ul", "ol", "li", "img", "figure", "figcaption",
  "table", "thead", "tbody", "tr", "td", "th",
];

/// CSS properties that require units (px when bare number)
const DIMENSION_PROPS = new Set([
  "font-size", "width", "height", "max-width", "max-height",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border-radius", "gap", "top", "left", "right", "bottom",
  "letter-spacing",
]);

function normalizeCssValue(value: string): string {
  const trimmed = value.trim();
  // Already has a unit or is a known keyword
  if (!trimmed || /[a-zA-Z%]/.test(trimmed)) return trimmed;
  // Bare number → add px
  if (/^\d+\.?\d*$/.test(trimmed)) return trimmed + "px";
  return trimmed;
}

/// Directly inject a Google Font <link> into every active Shadow DOM for immediate rendering.
/// Bypasses the React state → re-render → useEffect chain which is unreliable for @import.
function injectFontIntoShadowDOMs(fontUrl: string) {
  const href = `https://fonts.googleapis.com/css2?family=${fontUrl}:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&display=swap`;
  const frames = document.querySelectorAll("[data-frame-id]");
  for (const frameEl of frames) {
    for (const child of frameEl.querySelectorAll("*")) {
      if ((child as HTMLElement).shadowRoot) {
        const shadow = (child as HTMLElement).shadowRoot!;
        const existing = shadow.querySelectorAll("link");
        const already = [...existing].some(l => (l as HTMLLinkElement).href === href);
        if (!already) {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = href;
          shadow.insertBefore(link, shadow.firstChild);
        }
        break;
      }
    }
  }
  console.warn("[FONT] injectFontIntoShadowDOMs", { fontUrl, href, frameCount: frames.length });
}

/// Commit on Enter — applies the property immediately instead of waiting for blur
function commitOnEnter(updater: (sel: string, prop: string, value: string) => void, selector: string, prop: string) {
  return (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      updater(selector, prop, e.currentTarget.value);
      e.currentTarget.blur();
    }
  };
}

export function HtmlContextualPanel({ element, css, onCssChange, onChangeTag }: Props) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    typography: true, color: true, spacing: true, layout: true,
  });

  const toggle = (s: string) => setExpandedSections(prev => ({ ...prev, [s]: !prev[s] }));

  const updateProp = useCallback((selector: string, prop: string, value: string) => {
    let normalized = DIMENSION_PROPS.has(prop) ? normalizeCssValue(value) : value;
    if (prop === "font-family") normalized = normalized.replace(/['"]*$/g, "").replace(/;?\s*$/, "") + " !important";
    let updated = updateCssProperty(css, selector, prop, normalized);
    const matched = new RegExp(`(${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{)([^}]*)(\\})`).test(css);
    console.warn("[CSS PROP] updateCssProperty result", { prop, value: normalized, matched, updatedLen: updated.length, cssLen: css.length });

    // Auto-add Google Font @import when font-family is set
    if (prop === "font-family") {
      console.warn("[FONT] updateProp font-family called", { value, cssLen: css.length });
      const fontName = value.replace(/^['"]|['"]$/g, "").split(",")[0].trim();
      if (fontName && !/^(sans-serif|serif|monospace|cursive|fantasy|system-ui|inherit|initial|unset|Arial|Helvetica|Times New Roman|Georgia|Verdana|Courier New|Impact|Comic Sans|Trebuchet|Tahoma|Geneva|Inter)$/i.test(fontName)) {
        const fontUrl = fontName.replace(/ /g, "+");
        if (!updated.includes(`family=${fontUrl}`)) {
          const importLine = `@import url('https://fonts.googleapis.com/css2?family=${fontUrl}:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&display=swap');\n`;
          updated = importLine + updated;
          // Directly inject the font into every Shadow DOM for immediate effect
          injectFontIntoShadowDOMs(fontUrl);
        } else {
          // Import already exists — still ensure the link is in Shadow DOM
          injectFontIntoShadowDOMs(fontUrl);
        }
      }
    }

    onCssChange(updated);
  }, [css, onCssChange]);

  if (!element) {
    return (
      <div style={{ ...panelStyle, padding: 16 }}>
        <div style={{ color: "#7a7668", fontSize: 11, textAlign: "center" }}>
          Select an element inside a frame to edit its properties
        </div>
      </div>
    );
  }

  const s = element.computedStyles;
  const isText = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "a", "li", "label", "button"].includes(element.tag);

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#c8b898" }}>
            {element.tag.toUpperCase()}
          </span>
          <span style={{ fontSize: 10, color: "#666", fontFamily: "monospace" }}>
            {element.selector}
          </span>
        </div>
        {/* Semantic Tag Selector */}
        {onChangeTag && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 0.5 }}>Tag</span>
            <select
              value={element.tag}
              onChange={e => onChangeTag(e.target.value)}
              style={{
                flex: 1,
                background: "rgba(15,15,15,0.5)",
                border: "1px solid rgba(200,184,152,0.2)",
                color: "#c8b898",
                borderRadius: 4,
                padding: "3px 6px",
                fontSize: 11,
                fontFamily: "monospace",
                cursor: "pointer",
              }}
            >
              {SEMANTIC_TAGS.map(tag => (
                <option key={tag} value={tag}>{`<${tag}>`}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Typography Section */}
      {isText && (
        <>
          <button type="button" onClick={() => toggle("typography")} style={sectionHead}>
            Typography <span>{expandedSections.typography ? "\u25BE" : "\u25B8"}</span>
          </button>
          {expandedSections.typography && (
            <div style={{ padding: "6px 10px", display: "flex", flexDirection: "column", gap: 4, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              {/* Font Family */}
              <PropRow label="Font">
                <GoogleFontPicker
                  value={s["font-family"]?.replace(/['"]/g, "").split(",")[0] || ""}
                  onChange={(fontFamily) => {
                    console.warn("[PICKER→UPROP] onChange fired", { fontFamily, selector: element.selector, cssLen: css.length });
                    updateProp(element.selector, "font-family", `'${fontFamily}'`);
                  }}
                />
              </PropRow>

              {/* Font Size */}
              <PropRow label="Size">
                <input
                  defaultValue={s["font-size"] || ""}
                  onBlur={e => updateProp(element.selector, "font-size", e.target.value)}
                  onKeyDown={commitOnEnter(updateProp, element.selector, "font-size")}
                  style={{ ...inp, width: 60 }}
                />
              </PropRow>

              {/* Font Weight */}
              <PropRow label="Weight">
                <select
                  defaultValue={s["font-weight"] || "400"}
                  onChange={e => updateProp(element.selector, "font-weight", e.target.value)}
                  style={sel}
                >
                  {FONT_WEIGHTS.map(fw => (
                    <option key={fw.value} value={fw.value}>{fw.label} ({fw.value})</option>
                  ))}
                </select>
              </PropRow>

              {/* Text Align */}
              <PropRow label="Align">
                <div style={{ display: "flex", gap: 2, flex: 1 }}>
                  {ALIGNMENTS.map(a => (
                    <button
                      key={a.value}
                      type="button"
                      title={a.title}
                      onClick={() => updateProp(element.selector, "text-align", a.value)}
                      style={{
                        flex: 1, padding: "3px 4px", borderRadius: 4, fontSize: 13, cursor: "pointer",
                        background: s["text-align"] === a.value ? "rgba(200,184,152,0.12)" : "rgba(15,15,15,0.5)",
                        border: s["text-align"] === a.value ? "1px solid #c8b898" : "1px solid rgba(255,255,255,0.04)",
                        color: s["text-align"] === a.value ? "#c8b898" : "#7a7668",
                      }}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </PropRow>

              {/* Letter Spacing */}
              <PropRow label="Spacing">
                <input
                  defaultValue={s["letter-spacing"] || "normal"}
                  onBlur={e => updateProp(element.selector, "letter-spacing", e.target.value)}
                  onKeyDown={commitOnEnter(updateProp, element.selector, "letter-spacing")}
                  style={{ ...inp, width: 60 }}
                />
              </PropRow>

              {/* Line Height */}
              <PropRow label="Line-H">
                <input
                  defaultValue={s["line-height"] || ""}
                  onBlur={e => updateProp(element.selector, "line-height", e.target.value)}
                  onKeyDown={commitOnEnter(updateProp, element.selector, "line-height")}
                  style={{ ...inp, width: 60 }}
                />
              </PropRow>

              {/* Text Decoration */}
              <PropRow label="Deco">
                <select
                  defaultValue={s["text-decoration"] || "none"}
                  onChange={e => updateProp(element.selector, "text-decoration", e.target.value)}
                  style={sel}
                >
                  {TEXT_DECORATIONS.map(d => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </PropRow>

              {/* Text Transform */}
              <PropRow label="Case">
                <select
                  defaultValue={s["text-transform"] || "none"}
                  onChange={e => updateProp(element.selector, "text-transform", e.target.value)}
                  style={sel}
                >
                  {TEXT_TRANSFORMS.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </PropRow>
            </div>
          )}
        </>
      )}

      {/* Color Section */}
      <button type="button" onClick={() => toggle("color")} style={sectionHead}>
        Color <span>{expandedSections.color ? "\u25BE" : "\u25B8"}</span>
      </button>
      {expandedSections.color && (
        <div style={{ padding: "6px 10px", display: "flex", flexDirection: "column", gap: 4, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <PropRow label="Text">
            <input
              type="color"
              defaultValue={toHex(s["color"]) || "#000000"}
              onChange={e => updateProp(element.selector, "color", e.target.value)}
              style={{ width: 28, height: 24, border: "1px solid rgba(255,255,255,0.04)", borderRadius: 4, cursor: "pointer", padding: 0 }}
            />
            <input
              defaultValue={s["color"] || ""}
              onBlur={e => updateProp(element.selector, "color", e.target.value)}
              onKeyDown={commitOnEnter(updateProp, element.selector, "color")}
              style={inp}
            />
          </PropRow>
          <PropRow label="BG">
            <input
              type="color"
              defaultValue={toHex(s["background-color"]) || "#ffffff"}
              onChange={e => updateProp(element.selector, "background-color", e.target.value)}
              style={{ width: 28, height: 24, border: "1px solid rgba(255,255,255,0.04)", borderRadius: 4, cursor: "pointer", padding: 0 }}
            />
            <input
              defaultValue={s["background-color"] || s["background"] || ""}
              onBlur={e => updateProp(element.selector, "background-color", e.target.value)}
              onKeyDown={commitOnEnter(updateProp, element.selector, "background-color")}
              style={inp}
            />
          </PropRow>
          <PropRow label="Opacity">
            <input
              type="range" min="0" max="1" step="0.05"
              defaultValue={s["opacity"] || "1"}
              onChange={e => updateProp(element.selector, "opacity", e.target.value)}
              style={{ flex: 1, accentColor: "#c8b898" }}
            />
            <span style={{ fontSize: 10, color: "#7a7668", width: 30, textAlign: "right" }}>
              {Math.round(parseFloat(s["opacity"] || "1") * 100)}%
            </span>
          </PropRow>
        </div>
      )}

      {/* Spacing Section */}
      <button type="button" onClick={() => toggle("spacing")} style={sectionHead}>
        Spacing <span>{expandedSections.spacing ? "\u25BE" : "\u25B8"}</span>
      </button>
      {expandedSections.spacing && (
        <div style={{ padding: "6px 10px", display: "flex", flexDirection: "column", gap: 4, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <PropRow label="Margin">
            <input defaultValue={s["margin"] || ""} onBlur={e => updateProp(element.selector, "margin", e.target.value)} onKeyDown={commitOnEnter(updateProp, element.selector, "margin")} style={inp} />
          </PropRow>
          <PropRow label="Padding">
            <input defaultValue={s["padding"] || ""} onBlur={e => updateProp(element.selector, "padding", e.target.value)} onKeyDown={commitOnEnter(updateProp, element.selector, "padding")} style={inp} />
          </PropRow>
          <PropRow label="Border">
            <input defaultValue={s["border"] || ""} onBlur={e => updateProp(element.selector, "border", e.target.value)} onKeyDown={commitOnEnter(updateProp, element.selector, "border")} style={inp} />
          </PropRow>
          <PropRow label="Radius">
            <input defaultValue={s["border-radius"] || ""} onBlur={e => updateProp(element.selector, "border-radius", e.target.value)} onKeyDown={commitOnEnter(updateProp, element.selector, "border-radius")} style={inp} />
          </PropRow>
        </div>
      )}

      {/* Layout Section */}
      <button type="button" onClick={() => toggle("layout")} style={sectionHead}>
        Layout <span>{expandedSections.layout ? "\u25BE" : "\u25B8"}</span>
      </button>
      {expandedSections.layout && (
        <div style={{ padding: "6px 10px", display: "flex", flexDirection: "column", gap: 4, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <PropRow label="Display">
            <select
              defaultValue={s["display"] || "block"}
              onChange={e => updateProp(element.selector, "display", e.target.value)}
              style={sel}
            >
              <option value="block">Block</option>
              <option value="flex">Flex</option>
              <option value="grid">Grid</option>
              <option value="inline">Inline</option>
              <option value="inline-block">Inline-Block</option>
              <option value="none">None</option>
            </select>
          </PropRow>
          <PropRow label="W">
            <input defaultValue={s["width"] || ""} onBlur={e => updateProp(element.selector, "width", e.target.value)} onKeyDown={commitOnEnter(updateProp, element.selector, "width")} style={{ ...inp, width: 60 }} />
          </PropRow>
          <PropRow label="H">
            <input defaultValue={s["height"] || ""} onBlur={e => updateProp(element.selector, "height", e.target.value)} onKeyDown={commitOnEnter(updateProp, element.selector, "height")} style={{ ...inp, width: 60 }} />
          </PropRow>
          <PropRow label="Gap">
            <input defaultValue={s["gap"] || ""} onBlur={e => updateProp(element.selector, "gap", e.target.value)} onKeyDown={commitOnEnter(updateProp, element.selector, "gap")} style={{ ...inp, width: 60 }} />
          </PropRow>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 11, color: "#7a7668", flex: "0 0 52px", textAlign: "right" }}>{label}</span>
      <div style={{ flex: 1, display: "flex", gap: 4, alignItems: "center" }}>{children}</div>
    </div>
  );
}

function toHex(color?: string): string {
  if (!color) return "#000000";
  if (color.startsWith("#")) return color.slice(0, 7);
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) {
    return "#" + [m[1], m[2], m[3]].map(c =>
      Math.max(0, Math.min(255, parseInt(c))).toString(16).padStart(2, "0")
    ).join("");
  }
  return "#000000";
}

function updateCssProperty(css: string, selector: string, prop: string, value: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ruleRe = new RegExp(`(${escaped}\\s*\\{)([^}]*)(\\})`);
  const match = ruleRe.exec(css);

  if (match) {
    let decl = match[2];
    const propRe = new RegExp(`${prop}\\s*:[^;]*;?`);
    if (propRe.test(decl)) {
      decl = decl.replace(propRe, `${prop}: ${value};`);
    } else {
      decl = decl.trimEnd() + `\n  ${prop}: ${value};\n`;
    }
    return css.replace(ruleRe, `${match[1]}${decl}${match[3]}`);
  }
  return css + `\n${selector} {\n  ${prop}: ${value};\n}`;
}
