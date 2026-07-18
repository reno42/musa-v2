import { Router } from "express";
import { store } from "../services/store.js";

export const toolRoutes = Router();

// POST /api/templates/:id/tools/add-primitive — add visual primitive to a frame
toolRoutes.post("/:id/tools/add-primitive", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    if (tpl.engine !== "html") return res.status(400).json({ success: false, error: "Not an HTML template" });

    const { frameId, type, x = 0, y = 0, width, height, color, content, fontSize, borderRadius } = req.body;
    if (!frameId) return res.status(400).json({ success: false, error: "frameId required" });
    if (!["rect", "circle", "text"].includes(type)) return res.status(400).json({ success: false, error: "type must be rect, circle, or text" });

    const frames = tpl.frames || [];
    const frame: any = frames.find((f: any) => f.id === frameId);
    if (!frame) return res.status(404).json({ success: false, error: "Frame not found" });

    const layerId = `el_${Date.now().toString(36)}`;
    let elHtml: string, cssRule: string;

    if (type === "rect") {
      const w = width || 200, h = height || 150;
      const bg = color || "#3B82F6", br = borderRadius || "8px";
      elHtml = `<div data-layer-id="${layerId}"></div>`;
      cssRule = `[data-layer-id="${layerId}"] {\n  width: ${w}px;\n  height: ${h}px;\n  background: ${bg};\n  border-radius: ${br};\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n}`;
    } else if (type === "circle") {
      const size = width || height || 150;
      const bg = color || "#EF4444";
      elHtml = `<div data-layer-id="${layerId}"></div>`;
      cssRule = `[data-layer-id="${layerId}"] {\n  width: ${size}px;\n  height: ${size}px;\n  background: ${bg};\n  border-radius: 50%;\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n}`;
    } else {
      const fs = fontSize || 24;
      const clr = color || "#333333";
      elHtml = `<div data-layer-id="${layerId}">${content || "Text"}</div>`;
      cssRule = `[data-layer-id="${layerId}"] {\n  font-size: ${fs}px;\n  color: ${clr};\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n}`;
    }

    frame.html = (frame.html || "") + "\n" + elHtml;
    frame.css = (frame.css || "") + "\n" + cssRule + "\n";
    tpl.metadata.updatedAt = new Date().toISOString();
    res.status(201).json({ success: true, data: { layerName: layerId, type, frameId } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/templates/:id/tools/change-tag — change semantic tag of an element
toolRoutes.post("/:id/tools/change-tag", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    if (tpl.engine !== "html") return res.status(400).json({ success: false, error: "Not an HTML template" });

    const { frameId, elementId, newTag } = req.body;
    if (!elementId || !newTag) return res.status(400).json({ success: false, error: "elementId and newTag required" });

    let targetHtml = "";
    let targetObj: any = null;

    if (frameId && tpl.frames) {
      const frame: any = tpl.frames.find((f: any) => f.id === frameId);
      if (!frame) return res.status(404).json({ success: false, error: "Frame not found" });
      targetHtml = frame.html || "";
      targetObj = frame;
    } else {
      targetHtml = tpl.html || "";
      targetObj = tpl;
    }

    const escapedId = elementId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tagRe = new RegExp(`<(\\w+)([^>]*data-layer-id="${escapedId}"[^>]*)>([\\s\\S]*?)<\\/\\1>`, "i");
    const match = tagRe.exec(targetHtml);
    if (!match) return res.status(404).json({ success: false, error: "Element not found" });

    const oldTag = match[1];
    const newElHtml = `<${newTag}${match[2]}>${match[3]}</${newTag}>`;
    targetObj.html = targetHtml.replace(tagRe, newElHtml);
    tpl.metadata.updatedAt = new Date().toISOString();
    res.json({ success: true, data: { elementId, oldTag, newTag } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/templates/:id/tools/draw-shape — draw a shape with exact dimensions
// POST /api/templates/:id/tools/draw-path — create SVG path element
// POST /api/templates/:id/tools/transform-element — resize/reposition element
// POST /api/templates/:id/tools/group-elements — group elements in wrapper
// POST /api/templates/:id/tools/align-elements — align elements along axis

toolRoutes.post("/:id/tools/draw-shape", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    if (tpl.engine !== "html") return res.status(400).json({ success: false, error: "Not an HTML template" });

    const { frameId, type, x = 0, y = 0, width = 200, height = 150, color, borderRadius } = req.body;
    if (!frameId) return res.status(400).json({ success: false, error: "frameId required" });
    if (!["rect", "circle"].includes(type)) return res.status(400).json({ success: false, error: "type must be rect or circle" });

    const frames = tpl.frames || [];
    const frame: any = frames.find((f: any) => f.id === frameId);
    if (!frame) return res.status(404).json({ success: false, error: "Frame not found" });

    const layerId = `el_${Date.now().toString(36)}`;
    const bg = color || (type === "rect" ? "#3B82F6" : "#EF4444");
    const br = borderRadius || (type === "circle" ? "50%" : "8px");
    const elHtml = `<div data-layer-id="${layerId}"></div>`;
    const cssRule = `[data-layer-id="${layerId}"] {\n  width: ${width}px;\n  height: ${height}px;\n  background: ${bg};\n  border-radius: ${br};\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n}`;
    frame.html = (frame.html || "") + "\n" + elHtml;
    frame.css = (frame.css || "") + "\n" + cssRule + "\n";
    tpl.metadata.updatedAt = new Date().toISOString();
    res.status(201).json({ success: true, data: { layerName: layerId, type, x, y, width, height } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

toolRoutes.post("/:id/tools/draw-path", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    if (tpl.engine !== "html") return res.status(400).json({ success: false, error: "Not an HTML template" });

    const { frameId, pathData, x = 0, y = 0, width = 100, height = 100, stroke = "#8B5CF6", strokeWidth = 2 } = req.body;
    if (!frameId || !pathData) return res.status(400).json({ success: false, error: "frameId and pathData required" });

    const frames = tpl.frames || [];
    const frame: any = frames.find((f: any) => f.id === frameId);
    if (!frame) return res.status(404).json({ success: false, error: "Frame not found" });

    const layerId = `el_${Date.now().toString(36)}`;
    const svgHtml = `<svg data-layer-id="${layerId}" viewBox="${x} ${y} ${Math.max(width, 1)} ${Math.max(height, 1)}" style="position:absolute;left:${x}px;top:${y}px;width:${Math.max(width, 1)}px;height:${Math.max(height, 1)}px;overflow:visible;"><path d="${pathData}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const cssRule = `[data-layer-id="${layerId}"] {\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n  width: ${Math.max(width, 1)}px;\n  height: ${Math.max(height, 1)}px;\n  overflow: visible;\n}`;
    frame.html = (frame.html || "") + "\n" + svgHtml;
    frame.css = (frame.css || "") + "\n" + cssRule + "\n";
    tpl.metadata.updatedAt = new Date().toISOString();
    res.status(201).json({ success: true, data: { layerName: layerId, type: "path" } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

toolRoutes.post("/:id/tools/transform-element", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    if (tpl.engine !== "html") return res.status(400).json({ success: false, error: "Not an HTML template" });

    const { frameId, elementId, x, y, width, height, rotation } = req.body;
    if (!frameId || !elementId) return res.status(400).json({ success: false, error: "frameId and elementId required" });

    const frames = tpl.frames || [];
    const frame: any = frames.find((f: any) => f.id === frameId);
    if (!frame) return res.status(404).json({ success: false, error: "Frame not found" });

    const selector = `[data-layer-id="${elementId}"]`;
    const cssProps: Record<string, string> = { position: "absolute" };
    if (x !== undefined) cssProps.left = `${x}px`;
    if (y !== undefined) cssProps.top = `${y}px`;
    if (width !== undefined) cssProps.width = `${width}px`;
    if (height !== undefined) cssProps.height = `${height}px`;
    if (rotation !== undefined) cssProps.transform = `rotate(${rotation}deg)`;

    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const ruleRe = new RegExp(`(${escaped}\\s*\\{)([^}]*)(\\})`);
    const ruleMatch = ruleRe.exec(frame.css || "");
    if (ruleMatch) {
      let decl = ruleMatch[2];
      for (const [prop, value] of Object.entries(cssProps)) {
        const propRe = new RegExp(`${prop}\\s*:[^;]*;?`);
        if (propRe.test(decl)) {
          decl = decl.replace(propRe, `${prop}: ${value};`);
        } else {
          decl = decl.trimEnd() + `\n  ${prop}: ${value};\n`;
        }
      }
      frame.css = frame.css.replace(ruleRe, `${ruleMatch[1]}${decl}${ruleMatch[3]}`);
    } else {
      const rule = `\n${selector} {\n${Object.entries(cssProps).map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}`;
      frame.css = (frame.css || "") + rule;
    }
    tpl.metadata.updatedAt = new Date().toISOString();
    res.json({ success: true, data: { elementId, transforms: cssProps } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

toolRoutes.post("/:id/tools/group-elements", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    if (tpl.engine !== "html") return res.status(400).json({ success: false, error: "Not an HTML template" });

    const { frameId, elementIds, groupName } = req.body;
    if (!frameId || !elementIds || !Array.isArray(elementIds)) return res.status(400).json({ success: false, error: "frameId and elementIds[] required" });

    const frames = tpl.frames || [];
    const frame: any = frames.find((f: any) => f.id === frameId);
    if (!frame) return res.status(404).json({ success: false, error: "Frame not found" });

    const groupId = `el_${Date.now().toString(36)}`;
    let html = frame.html || "";
    const childHtmls: string[] = [];
    for (const elId of elementIds) {
      const elRe = new RegExp(`(<[^>]*data-layer-id="${elId}"[^>]*>[\\s\\S]*?<\\/[a-zA-Z0-9]+>|<[^>]*data-layer-id="${elId}"[^>]*\\s*\\/?>)`, "");
      const match = elRe.exec(html);
      if (match) {
        childHtmls.push(match[1]);
        html = html.replace(match[1], "");
      }
    }
    if (childHtmls.length === 0) return res.status(404).json({ success: false, error: "No matching elements found" });
    const wrapperHtml = `<div data-layer-id="${groupId}"${groupName ? ` class="${groupName}"` : ""}>${childHtmls.join("")}</div>`;
    frame.html = html + "\n" + wrapperHtml;
    frame.css = (frame.css || "") + `\n[data-layer-id="${groupId}"] {\n  position: relative;\n  display: flex;\n}\n`;
    tpl.metadata.updatedAt = new Date().toISOString();
    res.json({ success: true, data: { groupId, childrenCount: childHtmls.length } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

toolRoutes.post("/:id/tools/align-elements", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    if (tpl.engine !== "html") return res.status(400).json({ success: false, error: "Not an HTML template" });

    const { frameId, elementIds, align } = req.body;
    if (!frameId || !elementIds || !Array.isArray(elementIds) || !align) return res.status(400).json({ success: false, error: "frameId, elementIds[] and align required" });
    if (!["left", "center", "right", "top", "middle", "bottom"].includes(align)) return res.status(400).json({ success: false, error: "align must be left/center/right/top/middle/bottom" });

    const frames = tpl.frames || [];
    const frame: any = frames.find((f: any) => f.id === frameId);
    if (!frame) return res.status(404).json({ success: false, error: "Frame not found" });

    const elementData: { id: string; left: number; top: number; width: number; height: number }[] = [];
    for (const elId of elementIds) {
      const selector = `[data-layer-id="${elId}"]`;
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const ruleRe = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`);
      const match = ruleRe.exec(frame.css || "");
      if (match) {
        const decl = match[1];
        const left = parseInt(/left:\s*(\d+)/.exec(decl)?.[1] || "0");
        const top = parseInt(/top:\s*(\d+)/.exec(decl)?.[1] || "0");
        const width = parseInt(/width:\s*(\d+)/.exec(decl)?.[1] || "0");
        const height = parseInt(/height:\s*(\d+)/.exec(decl)?.[1] || "0");
        elementData.push({ id: elId, left, top, width, height });
      }
    }
    if (elementData.length < 2) return res.status(400).json({ success: false, error: "Need at least 2 elements to align" });

    let alignValue: number;
    if (["left", "center", "right"].includes(align)) {
      if (align === "left") alignValue = Math.min(...elementData.map(e => e.left));
      else if (align === "right") alignValue = Math.max(...elementData.map(e => e.left + e.width));
      else alignValue = elementData.reduce((sum, e) => sum + e.left + e.width / 2, 0) / elementData.length;
    } else {
      if (align === "top") alignValue = Math.min(...elementData.map(e => e.top));
      else if (align === "bottom") alignValue = Math.max(...elementData.map(e => e.top + e.height));
      else alignValue = elementData.reduce((sum, e) => sum + e.top + e.height / 2, 0) / elementData.length;
    }

    for (const el of elementData) {
      const selector = `[data-layer-id="${el.id}"]`;
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const ruleRe = new RegExp(`(${escaped}\\s*\\{)([^}]*)(\\})`);
      const ruleMatch = ruleRe.exec(frame.css);
      if (!ruleMatch) continue;
      let decl = ruleMatch[2];
      let prop: string, value: number;
      if (["left", "center", "right"].includes(align)) {
        prop = "left";
        value = align === "left" ? alignValue! : align === "right" ? alignValue! - el.width : Math.round(alignValue! - el.width / 2);
      } else {
        prop = "top";
        value = align === "top" ? alignValue! : align === "bottom" ? alignValue! - el.height : Math.round(alignValue! - el.height / 2);
      }
      const propRe = new RegExp(`${prop}\\s*:[^;]*;?`);
      if (propRe.test(decl)) {
        decl = decl.replace(propRe, `${prop}: ${value}px;`);
      } else {
        decl = decl.trimEnd() + `\n  ${prop}: ${value}px;\n`;
      }
      frame.css = frame.css.replace(ruleRe, `${ruleMatch[1]}${decl}${ruleMatch[3]}`);
    }
    tpl.metadata.updatedAt = new Date().toISOString();
    res.json({ success: true, data: { align, elementsAligned: elementData.length } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/templates/:id/tools/set-frame-background — set frame background color/image
toolRoutes.post("/:id/tools/set-frame-background", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    if (tpl.engine !== "html") return res.status(400).json({ success: false, error: "Not an HTML template" });

    const { frameId, background } = req.body;
    if (!frameId) return res.status(400).json({ success: false, error: "frameId required" });
    if (background === undefined) return res.status(400).json({ success: false, error: "background required" });

    const frames = tpl.frames || [];
    const frame: any = frames.find((f: any) => f.id === frameId);
    if (!frame) return res.status(404).json({ success: false, error: "Frame not found" });

    // Accept CSS background values: hex color, rgb(), linear-gradient(), url(), "transparent", etc.
    frame.background = String(background);
    tpl.metadata.updatedAt = new Date().toISOString();

    res.json({ success: true, data: { frameId, background: frame.background } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
