// css-routes.ts — Agent-facing CSS export endpoint
// GET /api/templates/:id/css?selector=layerName
// Walks canvas.objects and generates CSS blocks server-side.
import { Router } from "express";
import * as templates from "../services/templates";

const router = Router();

// --- Color utilities (server-side, mirrors colorUtils.ts) ---
function rgbToCmyk(r: number, g: number, b: number) {
  const k = 1 - Math.max(r, g, b);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
  const c = Math.round(((1 - r - k) / (1 - k)) * 100);
  const m = Math.round(((1 - g - k) / (1 - k)) * 100);
  const y = Math.round(((1 - b - k) / (1 - k)) * 100);
  return { c, m, y, k: Math.round(k * 100) };
}

function parseHex(hex: string): { r: number; g: number; b: number; a: number } | null {
  if (!hex || typeof hex !== "string") return null;
  let h = hex;
  if (h.length === 4) h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  let a = 1;
  if (h.length === 9) {
    a = parseInt(h.slice(7, 9), 16) / 255;
    h = h.slice(0, 7);
  }
  if (h.length !== 7 || h[0] !== "#") return null;
  return {
    r: parseInt(h.slice(1, 3), 16) / 255,
    g: parseInt(h.slice(3, 5), 16) / 255,
    b: parseInt(h.slice(5, 7), 16) / 255,
    a,
  };
}

function sanitizeCSS(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// --- CSS Generation ---
interface CssBlock {
  selector: string;
  properties: string[];
  meta: Record<string, any>;
}

function generateCSSForObject(obj: any): CssBlock | null {
  const name = obj.layerName || obj.type || "element";
  const layerId = obj.layerId || "";
  const selector = "." + sanitizeCSS(name) + "-" + (layerId.slice(-6) || "000000");
  const props: string[] = [];
  const meta: Record<string, any> = { nodeName: name, nodeType: obj.type || "unknown" };

  // Position & size
  if (typeof obj.left === "number") props.push(`left: ${Math.round(obj.left)}px`);
  if (typeof obj.top === "number") props.push(`top: ${Math.round(obj.top)}px`);
  if (typeof obj.width === "number") props.push(`width: ${Math.round(obj.width)}px`);
  if (typeof obj.height === "number") props.push(`height: ${Math.round(obj.height)}px`);

  // Opacity
  if (typeof obj.opacity === "number" && obj.opacity < 1) props.push(`opacity: ${obj.opacity}`);

  // Fill
  const fill = obj.fill;
  if (typeof fill === "string") {
    const parsed = parseHex(fill);
    if (parsed) {
      meta.fillHex = fill;
      meta.fillRgb = `rgb(${Math.round(parsed.r * 255)}, ${Math.round(parsed.g * 255)}, ${Math.round(parsed.b * 255)})`;
      const cmyk = rgbToCmyk(parsed.r, parsed.g, parsed.b);
      meta.fillCmyk = `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)`;
      props.push(`background-color: ${fill}`);
      props.push(`/* fill-rgb: ${meta.fillRgb} */`);
      props.push(`/* fill-cmyk: ${meta.fillCmyk} */`);
    }
  }

  // Stroke
  if (obj.stroke) {
    props.push(`border-color: ${obj.stroke}`);
    props.push(`border-width: ${obj.strokeWidth || 1}px`);
    props.push(`border-style: ${obj.strokeDashArray ? "dashed" : "solid"}`);
  }

  // Border radius
  if (obj.type === "rect" && typeof obj.rx === "number" && obj.rx > 0) {
    props.push(`border-radius: ${Math.round(obj.rx)}px`);
  }

  // Shadow
  if (obj.shadow) {
    const s = obj.shadow;
    const color = s.color || "rgba(0,0,0,0.25)";
    props.push(`box-shadow: ${s.offsetX || 0}px ${s.offsetY || 0}px ${s.blur || 0}px ${color}`);
  }

  // Typography
  const t = obj.type || "";
  if (t === "text" || t === "textbox" || t === "i-text") {
    meta.fontFamily = obj.fontFamily || "Unknown";
    meta.fontSize = obj.fontSize || 16;
    props.push("");
    props.push("/* --- Typography --- */");
    if (obj.fontFamily) props.push(`font-family: '${obj.fontFamily}'`);
    if (obj.fontSize) props.push(`font-size: ${obj.fontSize}px`);
    if (obj.fontWeight) props.push(`font-weight: ${obj.fontWeight}`);
    if (obj.fontStyle === "italic") props.push(`font-style: italic`);
    if (obj.lineHeight) props.push(`line-height: ${obj.lineHeight}`);
    if (obj.charSpacing) props.push(`letter-spacing: ${obj.charSpacing}px`);
    if (obj.textAlign) props.push(`text-align: ${obj.textAlign}`);
    if (obj.underline) props.push(`text-decoration: underline`);
    if (obj.linethrough) props.push(`text-decoration: line-through`);
    if (typeof obj.fill === "string") props.push(`color: ${obj.fill}`);
  }

  return { selector, properties: props, meta };
}

function walkAndGenerate(objs: any[], blocks: CssBlock[]) {
  for (const o of objs) {
    const block = generateCSSForObject(o);
    if (block && block.properties.length > 0) blocks.push(block);
    if (o.objects && Array.isArray(o.objects)) walkAndGenerate(o.objects, blocks);
  }
}

// GET /api/templates/:id/css
router.get("/:id/css", async (req, res) => {
  try {
    const tpl = await templates.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const selector = req.query.selector as string | undefined;
    const canvasObjects = tpl.canvas.objects || [];

    const blocks: CssBlock[] = [];
    walkAndGenerate(canvasObjects, blocks);

    // Filter by selector if provided
    const filtered = selector
      ? blocks.filter((b) => b.meta.nodeName === selector || b.selector.includes(sanitizeCSS(selector)))
      : blocks;

    // Build stylesheet
    const lines: string[] = [];
    lines.push("/* ══════════════════════════════════════ */");
    lines.push("/* Generated by Futuraria CSS API          */");
    lines.push(`/* Template: ${tpl.name}                    */`);
    lines.push("/* ══════════════════════════════════════ */");
    lines.push("");
    for (const b of filtered) {
      lines.push(`/* ${b.meta.nodeName} (${b.meta.nodeType}) */`);
      lines.push(`${b.selector} {`);
      for (const p of b.properties) lines.push(`  ${p};`);
      lines.push("}");
      lines.push("");
    }

    const stylesheet = lines.join("\n");

    // If ?format=css, return raw CSS; otherwise JSON with metadata
    if (req.query.format === "css") {
      res.setHeader("Content-Type", "text/css");
      return res.send(stylesheet);
    }

    res.json({
      success: true,
      data: {
        templateName: tpl.name,
        elementCount: filtered.length,
        totalElements: blocks.length,
        stylesheet,
        blocks: filtered,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
