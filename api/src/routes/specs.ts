import { Router } from "express";
import { store } from "../services/store.js";

export const specRoutes = Router();

const CSS_PROPERTIES: Record<string, string[]> = {
  rect: ["left", "top", "width", "height", "fill", "stroke", "strokeWidth", "rx", "ry", "opacity", "angle"],
  ellipse: ["left", "top", "width", "height", "fill", "stroke", "strokeWidth", "opacity", "angle"],
  text: ["left", "top", "text", "fontSize", "fontFamily", "fill", "opacity", "angle", "fontWeight", "lineHeight"],
  "i-text": ["left", "top", "text", "fontSize", "fontFamily", "fill", "opacity", "angle", "fontWeight", "lineHeight"],
  IText: ["left", "top", "text", "fontSize", "fontFamily", "fill", "opacity", "angle", "fontWeight", "lineHeight"],
  image: ["left", "top", "width", "height", "src", "opacity", "angle"],
  line: ["left", "top", "width", "height", "x1", "y1", "x2", "y2", "stroke", "strokeWidth", "opacity"],
  group: ["left", "top", "opacity", "angle"],
};

function objToCSS(obj: any, parentLeft = 0, parentTop = 0): string {
  const type = obj.type || "unknown";
  const name = obj.layerName || obj.name || type;
  const classes = [`.layer-${name.replace(/[^a-zA-Z0-9_-]/g, "-")}`];
  const props = CSS_PROPERTIES[type] || ["left", "top", "width", "height", "fill", "opacity"];
  const rules: string[] = [];

  for (const prop of props) {
    const val = obj[prop];
    if (val === undefined || val === null) continue;

    switch (prop) {
      case "left":
        rules.push(`  left: ${val - parentLeft}px;`);
        break;
      case "top":
        rules.push(`  top: ${val - parentTop}px;`);
        break;
      case "width":
        rules.push(`  width: ${(val || 0) * (obj.scaleX || 1)}px;`);
        break;
      case "height":
        rules.push(`  height: ${(val || 0) * (obj.scaleY || 1)}px;`);
        break;
      case "fill":
        if (typeof val === "string" && val !== "transparent") {
          rules.push(`  background-color: ${val};`);
        }
        break;
      case "stroke":
        if (typeof val === "string" && val !== "transparent") {
          rules.push(`  border-color: ${val};`);
          rules.push(`  border-style: solid;`);
        }
        break;
      case "strokeWidth":
        rules.push(`  border-width: ${val}px;`);
        break;
      case "rx":
        rules.push(`  border-radius: ${val}px;`);
        break;
      case "fontSize":
        rules.push(`  font-size: ${val}px;`);
        break;
      case "fontFamily":
        rules.push(`  font-family: ${val};`);
        break;
      case "fontWeight":
        rules.push(`  font-weight: ${val};`);
        break;
      case "lineHeight":
        rules.push(`  line-height: ${val};`);
        break;
      case "text":
        rules.push(`  /* content: "${(val || "").slice(0, 50)}"; */`);
        break;
      case "angle":
        if (val !== 0) rules.push(`  transform: rotate(${val}deg);`);
        break;
      case "opacity":
        if (val !== 1) rules.push(`  opacity: ${val};`);
        break;
      case "src":
        rules.push(`  /* background-image: url(${val}); */`);
        break;
    }
  }

  rules.push(`  position: absolute;`);

  // Effects
  if (obj.shadow) {
    const s = obj.shadow;
    rules.push(`  box-shadow: ${s.offsetX || 0}px ${s.offsetY || 0}px ${s.blur || 0}px ${s.color || "rgba(0,0,0,0.3)"};`);
  }
  if (obj.blur !== undefined && obj.blur > 0) {
    rules.push(`  filter: blur(${obj.blur}px);`);
  }

  let css = `${classes.join(",\n")} {\n${rules.join("\n")}\n}`;

  // Recursively process groups
  if (type === "group" && obj.objects && Array.isArray(obj.objects)) {
    for (const child of obj.objects) {
      css += "\n\n" + objToCSS(child, obj.left || 0, obj.top || 0);
    }
  }

  return css;
}

function extractFrameCSS(frame: any, parentLeft = 0, parentTop = 0): string {
  let css = "";
  for (const obj of frame.objects || []) {
    css += (css ? "\n\n" : "") + objToCSS(obj, parentLeft + (frame.x || 0), parentTop + (frame.y || 0));
    if (obj.objects && Array.isArray(obj.objects)) {
      for (const child of obj.objects) {
        css += "\n\n" + objToCSS(child, parentLeft + (frame.x || 0) + (obj.left || 0), parentTop + (frame.y || 0) + (obj.top || 0));
      }
    }
  }
  return css;
}

// GET /api/templates/:id/specs
// Returns CSS representation of all objects in the canvas
specRoutes.get("/:id/specs", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const frameId = req.query.frameId as string | undefined;
    const format = (req.query.format as string) || "css";
    const specs: any = { templateId: tpl.id, name: tpl.name, width: tpl.width, height: tpl.height };

    if (format === "json") {
      const layers: any[] = [];

      const walk = (objs: any[], parentLeft = 0, parentTop = 0) => {
        for (const obj of objs) {
          const entry: any = {
            layerName: obj.layerName || obj.name,
            type: obj.type,
            position: { x: obj.left - parentLeft, y: obj.top - parentTop },
            size: { width: (obj.width || 0) * (obj.scaleX || 1), height: (obj.height || 0) * (obj.scaleY || 1) },
            fill: obj.fill,
            stroke: obj.stroke,
            strokeWidth: obj.strokeWidth,
            cornerRadius: obj.rx || obj.ry,
            opacity: obj.opacity,
            rotation: obj.angle,
            visible: obj.visible !== false,
          };
          if (obj.type === "text" || obj.type === "i-text" || obj.type === "IText") {
            entry.text = obj.text;
            entry.fontSize = obj.fontSize;
            entry.fontFamily = obj.fontFamily;
            entry.fontWeight = obj.fontWeight;
            entry.lineHeight = obj.lineHeight;
          }
          if (obj.shadow) entry.shadow = obj.shadow;
          if (obj.blur) entry.blur = obj.blur;
          layers.push(entry);
          if (obj.objects && Array.isArray(obj.objects)) walk(obj.objects, obj.left || 0, obj.top || 0);
        }
      };

      if (frameId) {
        const frame = tpl.frames.find((f: any) => f.id === frameId);
        if (!frame) return res.status(404).json({ success: false, error: "Frame not found" });
        walk(frame.objects, frame.x || 0, frame.y || 0);
      } else {
        // Walk only frame objects (canvas.objects is V1 legacy, removed)
        for (const frame of tpl.frames) walk(frame.objects, frame.x || 0, frame.y || 0);
      }
      specs.layers = layers;
    } else {
      // CSS format
      let css = `/* ${tpl.name} — ${tpl.width}x${tpl.height} */\n`;
      css += `.template {\n  position: relative;\n  width: ${tpl.width}px;\n  height: ${tpl.height}px;\n}\n\n`;

      if (frameId) {
        const frame = tpl.frames.find((f: any) => f.id === frameId);
        if (!frame) return res.status(404).json({ success: false, error: "Frame not found" });
        css += `/* Frame: ${frame.name} */\n${extractFrameCSS(frame)}`;
      } else {
        for (const frame of tpl.frames) {
          css += `\n/* Frame: ${frame.name} */\n${extractFrameCSS(frame)}\n`;
        }
      }
      specs.css = css;
    }

    res.json({ success: true, data: specs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
