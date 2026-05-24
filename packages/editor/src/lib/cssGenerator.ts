// cssGenerator.ts — Converts Fabric.js objects into CSS code
// Ported from Figma "HTML Mirror v2.4" plugin

import * as fabric from "fabric";
import { rgbToHex, rgbToCmyk, formatCmyk, blendToCSS, fontWeightFromStyle, sanitizeCSS } from "./colorUtils";

export interface CssBlock {
  /** CSS class selector (e.g. ".main-frame") */
  selector: string;
  /** CSS property lines */
  properties: string[];
  /** Metadata for display */
  meta: {
    nodeName: string;
    nodeType: string;
    fillHex?: string;
    fillRgb?: string;
    fillCmyk?: string;
    fontFamily?: string;
    fontSize?: number;
  };
}

/** Extract fill as { hex, rgb, cmyk, type, alpha } or null */
function extractFill(obj: any): Record<string, string | number> | null {
  const fill = obj.fill;
  if (!fill) return null;
  // Solid color fill
  if (typeof fill === "string") {
    let hex = fill;
    let alpha = obj.opacity ?? 1;

    // Normalize hex: handle 3-char (#RGB), 6-char (#RRGGBB), 8-char (#RRGGBBAA)
    if (hex.length === 4) {
      // #RGB → #RRGGBB
      hex = "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    } else if (hex.length === 9) {
      // #RRGGBBAA → extract alpha
      const a = parseInt(hex.slice(7, 9), 16) / 255;
      if (obj.opacity === undefined || obj.opacity === 1) {
        alpha = Math.round(a * 100) / 100;
      }
    }
    // Use 6-char hex for RGB extraction
    const safeHex = hex.length >= 7 ? hex.slice(0, 7) : hex;
    const ri = parseInt(safeHex.slice(1, 3), 16) / 255;
    const gi = parseInt(safeHex.slice(3, 5), 16) / 255;
    const bi = parseInt(safeHex.slice(5, 7), 16) / 255;
    const cmyk = rgbToCmyk(ri, gi, bi);
    return {
      type: "SOLID",
      hex: safeHex,
      rgb: `rgb(${Math.round(ri * 255)}, ${Math.round(gi * 255)}, ${Math.round(bi * 255)})`,
      cmyk: formatCmyk(cmyk),
      alpha,
    };
  }
  // Gradient
  if (fill && typeof fill === "object" && (fill as any).colorStops) {
    const stops = (fill as any).colorStops || [];
    const cs = stops
      .map((s: any) => `${s.color} ${Math.round((s.offset || 0) * 100)}%`)
      .join(", ");
    const type = (fill as any).type === "linear" ? "linear-gradient" : "radial-gradient";
    return { type: "GRADIENT", gradient: `${type}(${cs})`, alpha: obj.opacity ?? 1 };
  }
  return null;
}

/** Extract border-radius from Fabric rect */
function extractRadius(obj: any): number | null {
  if (obj.type === "rect" && typeof obj.rx === "number" && obj.rx > 0) {
    return obj.rx;
  }
  return null;
}

/** Extract shadow as CSS box-shadow */
function extractShadow(obj: any): string | null {
  if (!obj.shadow) return null;
  const s = obj.shadow as fabric.Shadow;
  const color = s.color || "rgba(0,0,0,0.25)";
  const ox = s.offsetX || 0;
  const oy = s.offsetY || 0;
  const blur = s.blur || 0;
  return `${ox}px ${oy}px ${blur}px ${color}`;
}

/** Extract typography info */
function extractTypography(obj: any) {
  if (obj.type !== "text" && obj.type !== "textbox" && obj.type !== "i-text") return null;
  return {
    family: obj.fontFamily || "Unknown",
    size: obj.fontSize || 16,
    weight: obj.fontWeight || fontWeightFromStyle(obj.fontStyle || "Regular"),
    style: obj.fontStyle === "italic" ? "italic" : "normal",
    lineHeight: obj.lineHeight || "normal",
    letterSpacing: obj.charSpacing ?? 0,
    align: obj.textAlign || "left",
    decoration:
      obj.underline && obj.linethrough
        ? "underline line-through"
        : obj.underline
          ? "underline"
          : obj.linethrough
            ? "line-through"
            : "none",
    textCase: "none",
    color: obj.fill
      ? typeof obj.fill === "string"
        ? obj.fill
        : "#000000"
      : "#000000",
  };
}

/**
 * Generate a CSS class for a single Fabric.js object.
 * Returns a CssBlock with selector, properties, and metadata.
 */
export function generateCSS(obj: fabric.FabricObject): CssBlock | null {
  const name = (obj as any).layerName || obj.type || "element";
  const selector = "." + sanitizeCSS(name) + `-${(obj as any).layerId?.slice(-6) || "000000"}`;

  const props: string[] = [];
  const meta: CssBlock["meta"] = {
    nodeName: name,
    nodeType: obj.type || "unknown",
  };

  // Position & Size
  if (typeof obj.left === "number") props.push(`left: ${Math.round(obj.left)}px`);
  if (typeof obj.top === "number") props.push(`top: ${Math.round(obj.top)}px`);
  if (typeof obj.width === "number") props.push(`width: ${Math.round((obj as any).width || 0)}px`);
  if (typeof obj.height === "number") props.push(`height: ${Math.round((obj as any).height || 0)}px`);

  // Opacity
  if (typeof obj.opacity === "number" && obj.opacity < 1) {
    props.push(`opacity: ${obj.opacity}`);
  }

  // Fill
  const fill = extractFill(obj);
  if (fill) {
    meta.fillHex = fill.hex as string;
    meta.fillRgb = fill.rgb as string;
    meta.fillCmyk = fill.cmyk as string;
    if (fill.type === "SOLID") {
      props.push(`background-color: ${fill.hex}`);
      props.push(`/* fill-rgb: ${fill.rgb} */`);
      props.push(`/* fill-cmyk: ${fill.cmyk} */`);
      if ((fill.alpha as number) < 1) props.push(`/* fill-opacity: ${fill.alpha} */`);
    } else if (fill.type === "GRADIENT") {
      props.push(`background: ${fill.gradient}`);
    }
  }

  // Stroke
  const stroke = obj.stroke;
  if (stroke) {
    props.push(`border-color: ${stroke}`);
    props.push(`border-width: ${obj.strokeWidth || 1}px`);
    if ((obj as any).strokeDashArray) {
      props.push(`border-style: dashed`);
    } else {
      props.push(`border-style: solid`);
    }
    props.push(`/* stroke-align: ${(obj as any).strokeAlign || "center"} */`);
  }

  // Border Radius
  const radius = extractRadius(obj);
  if (radius) props.push(`border-radius: ${Math.round(radius)}px`);

  // Shadow / Effects
  const shadow = extractShadow(obj);
  if (shadow) props.push(`box-shadow: ${shadow}`);

  // Blend Mode
  if ((obj as any).blendMode && (obj as any).blendMode !== "normal") {
    props.push(`mix-blend-mode: ${blendToCSS((obj as any).blendMode)}`);
  }

  // Typography
  const typo = extractTypography(obj);
  if (typo) {
    meta.fontFamily = typo.family;
    meta.fontSize = typo.size;
    props.push("");
    props.push("/* --- Typography --- */");
    props.push(`font-family: '${typo.family}'`);
    props.push(`font-size: ${typo.size}px`);
    props.push(`font-weight: ${typo.weight}`);
    if (typo.style === "italic") props.push(`font-style: italic`);
    props.push(`line-height: ${typo.lineHeight}`);
    if (typo.letterSpacing) props.push(`letter-spacing: ${typo.letterSpacing}px`);
    props.push(`text-align: ${typo.align}`);
    if (typo.decoration !== "none") props.push(`text-decoration: ${typo.decoration}`);
    props.push(`color: ${typo.color}`);
  }

  return { selector, properties: props, meta };
}

/**
 * Generate a full CSS stylesheet from a selection of objects.
 * Returns formatted CSS string.
 */
export function generateStylesheet(objects: fabric.FabricObject[]): string {
  const blocks = objects
    .map(generateCSS)
    .filter((b): b is CssBlock => b !== null && b.properties.length > 0);

  if (blocks.length === 0) return "/* Select at least one element to generate CSS */";

  const lines: string[] = [];
  lines.push("/* ══════════════════════════════════════ */");
  lines.push("/* Generated by Futuraria CSS Inspector    */");
  lines.push(`/* ${blocks.length} element(s) selected           */`);
  lines.push("/* ══════════════════════════════════════ */");
  lines.push("");

  for (const block of blocks) {
    const comment = `/* ${block.meta.nodeName} (${block.meta.nodeType}) */`;
    lines.push(comment);
    lines.push(`${block.selector} {`);
    for (const prop of block.properties) {
      lines.push(`  ${prop};`);
    }
    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}

/** Generate CSS for a single selected object (used by the properties panel) */
export function generateSingleCSS(obj: fabric.FabricObject | null): string {
  if (!obj) return "/* No element selected */";
  const block = generateCSS(obj);
  if (!block) return "/* Could not generate CSS for this element */";
  return block.properties.join(";\n") + ";";
}
