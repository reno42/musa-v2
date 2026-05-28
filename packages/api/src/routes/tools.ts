import { Router } from "express";
import { v4 as uuid } from "uuid";
import { store } from "../services/store.js";
import {
  validate, drawShapeSchema, textSchema, imageSchema,
  booleanSchema, alignSchema, distributeSchema,
  transformSchema, autoLayoutSchema,
} from "../middleware/index.js";

export const toolRoutes = Router();

function getObjects(tpl: any, frameId?: string): any[] {
  if (frameId) {
    const frame = tpl.frames.find((f: any) => f.id === frameId);
    return frame ? frame.objects : [];
  }
  return tpl.canvas.objects;
}

function makeLayerName(prefix: string): string {
  return `${prefix}_${uuid().slice(0, 8)}`;
}

// POST /api/templates/:id/tools/draw
toolRoutes.post("/:id/tools/draw", validate(drawShapeSchema), async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const { tool, x, y, width, height, fill, stroke, strokeWidth, layerName, frameId } = req.body;
    const obj: any = {
      type: tool, layerName: layerName || makeLayerName(tool),
      left: x, top: y, width, height,
      fill: fill || "#cccccc", stroke: stroke || "transparent",
      strokeWidth: strokeWidth || 1,
      scaleX: 1, scaleY: 1, angle: 0, opacity: 1, visible: true,
    };

    if (tool === "star") { obj.points = 5; obj.innerRadius = width * 0.4; obj.outerRadius = width * 0.5; }
    if (tool === "polygon") obj.sides = 6;

    const objects = getObjects(tpl, frameId);
    objects.push(obj);
    tpl.metadata.updatedAt = new Date().toISOString();
    res.status(201).json({ success: true, data: obj });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/templates/:id/tools/text
toolRoutes.post("/:id/tools/text", validate(textSchema), async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const { text, x, y, fontSize, fontFamily, fill, layerName, frameId } = req.body;
    const obj: any = {
      type: "text", layerName: layerName || makeLayerName("text"),
      text, left: x, top: y,
      fontSize: fontSize || 24, fontFamily: fontFamily || "Inter",
      fill: fill || "#000000",
      scaleX: 1, scaleY: 1, angle: 0, opacity: 1, visible: true,
    };

    const objects = getObjects(tpl, frameId);
    objects.push(obj);
    tpl.metadata.updatedAt = new Date().toISOString();
    res.status(201).json({ success: true, data: obj });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/templates/:id/tools/image
toolRoutes.post("/:id/tools/image", validate(imageSchema), async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const { src, x, y, width, height, layerName, frameId } = req.body;
    const obj: any = {
      type: "image", layerName: layerName || makeLayerName("image"),
      src, left: x, top: y,
      width: width || 200, height: height || 200,
      scaleX: 1, scaleY: 1, angle: 0, opacity: 1, visible: true,
    };

    const objects = getObjects(tpl, frameId);
    objects.push(obj);
    tpl.metadata.updatedAt = new Date().toISOString();
    res.status(201).json({ success: true, data: obj });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/templates/:id/tools/boolean
toolRoutes.post("/:id/tools/boolean", validate(booleanSchema), async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const { operation, targetLayerNames, frameId } = req.body;
    const objects = getObjects(tpl, frameId);
    const targets = objects.filter((o: any) => targetLayerNames.includes(o.layerName || o.name));

    if (targets.length < 2) {
      return res.status(400).json({ success: false, error: "Need at least 2 matching layers for boolean operation" });
    }

    const combinedName = `${operation}_${targetLayerNames.join("_")}`;
    for (const t of targets) {
      const idx = objects.indexOf(t);
      if (idx !== -1) objects.splice(idx, 1);
    }

    objects.push({
      type: "group", layerName: combinedName, booleanOperation: operation,
      objects: targets.map((t: any) => ({ ...t })),
      left: targets[0].left, top: targets[0].top,
      scaleX: 1, scaleY: 1, angle: 0, opacity: 1, visible: true,
    });

    tpl.metadata.updatedAt = new Date().toISOString();
    res.json({ success: true, data: { operation, combinedName, affected: targetLayerNames } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/templates/:id/tools/align
toolRoutes.post("/:id/tools/align", validate(alignSchema), async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const { direction, targetLayerNames, frameId } = req.body;
    const objects = getObjects(tpl, frameId);
    const targets = targetLayerNames
      ? objects.filter((o: any) => targetLayerNames.includes(o.layerName || o.name))
      : objects;

    if (targets.length < 2) {
      return res.status(400).json({ success: false, error: "Need at least 2 layers to align" });
    }

    const bounds = targets.reduce((acc: any, o: any) => ({
      minX: Math.min(acc.minX, o.left || 0),
      minY: Math.min(acc.minY, o.top || 0),
      maxX: Math.max(acc.maxX, (o.left || 0) + (o.width || 0) * (o.scaleX || 1)),
      maxY: Math.max(acc.maxY, (o.top || 0) + (o.height || 0) * (o.scaleY || 1)),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

    for (const obj of targets) {
      const w = (obj.width || 0) * (obj.scaleX || 1);
      const h = (obj.height || 0) * (obj.scaleY || 1);
      switch (direction) {
        case "left": obj.left = bounds.minX; break;
        case "right": obj.left = bounds.maxX - w; break;
        case "center-h": obj.left = (bounds.minX + bounds.maxX) / 2 - w / 2; break;
        case "top": obj.top = bounds.minY; break;
        case "bottom": obj.top = bounds.maxY - h; break;
        case "center-v": obj.top = (bounds.minY + bounds.maxY) / 2 - h / 2; break;
      }
    }

    tpl.metadata.updatedAt = new Date().toISOString();
    res.json({ success: true, data: { direction, affected: targets.length } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/templates/:id/tools/distribute
toolRoutes.post("/:id/tools/distribute", validate(distributeSchema), async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const { direction, targetLayerNames, frameId } = req.body;
    const objects = getObjects(tpl, frameId);
    const targets = targetLayerNames
      ? objects.filter((o: any) => targetLayerNames.includes(o.layerName || o.name))
      : objects;

    if (targets.length < 3) {
      return res.status(400).json({ success: false, error: "Need at least 3 layers to distribute" });
    }

    if (direction === "horizontal") {
      targets.sort((a: any, b: any) => (a.left || 0) - (b.left || 0));
      const last = targets[targets.length - 1];
      const lastRight = (last.left || 0) + (last.width || 0) * (last.scaleX || 1);
      const firstLeft = targets[0].left || 0;
      const totalW = targets.reduce((s: number, o: any) => s + (o.width || 0) * (o.scaleX || 1), 0);
      const gap = targets.length > 1 ? (lastRight - firstLeft - totalW) / (targets.length - 1) : 0;
      let x = firstLeft;
      for (const obj of targets) { obj.left = x; x += (obj.width || 0) * (obj.scaleX || 1) + gap; }
    } else {
      targets.sort((a: any, b: any) => (a.top || 0) - (b.top || 0));
      const last = targets[targets.length - 1];
      const lastBottom = (last.top || 0) + (last.height || 0) * (last.scaleY || 1);
      const firstTop = targets[0].top || 0;
      const totalH = targets.reduce((s: number, o: any) => s + (o.height || 0) * (o.scaleY || 1), 0);
      const gap = targets.length > 1 ? (lastBottom - firstTop - totalH) / (targets.length - 1) : 0;
      let y = firstTop;
      for (const obj of targets) { obj.top = y; y += (obj.height || 0) * (obj.scaleY || 1) + gap; }
    }

    tpl.metadata.updatedAt = new Date().toISOString();
    res.json({ success: true, data: { direction, affected: targets.length } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/templates/:id/tools/transform
toolRoutes.post("/:id/tools/transform", validate(transformSchema), async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const { targetLayerName, frameId, ...props } = req.body;
    const objects = getObjects(tpl, frameId);
    const obj = objects.find((o: any) => (o.layerName || o.name) === targetLayerName);
    if (!obj) return res.status(404).json({ success: false, error: "Layer not found" });

    Object.assign(obj, props);
    tpl.metadata.updatedAt = new Date().toISOString();
    res.json({ success: true, data: obj });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/templates/:id/tools/upload — base64 image upload
toolRoutes.post("/:id/tools/upload", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const { base64, name, x = 0, y = 0, width, height, frameId } = req.body;
    if (!base64) return res.status(400).json({ success: false, error: "base64 data required" });

    const fileName = name || `img_${uuid().slice(0, 8)}.png`;
    const dataUrl = base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`;

    const obj: any = {
      type: "image", layerName: fileName,
      src: dataUrl, left: x, top: y,
      width: width || 200, height: height || 200,
      scaleX: 1, scaleY: 1, angle: 0, opacity: 1, visible: true,
    };

    const objects = getObjects(tpl, frameId);
    objects.push(obj);
    tpl.metadata.updatedAt = new Date().toISOString();
    res.status(201).json({ success: true, data: obj });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/templates/:id/tools/delete — delete objects by layerName
toolRoutes.post("/:id/tools/delete", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const { layerNames, frameId } = req.body;
    if (!layerNames || !Array.isArray(layerNames) || layerNames.length === 0) {
      return res.status(400).json({ success: false, error: "layerNames array required" });
    }

    const objects = getObjects(tpl, frameId);
    const removed: string[] = [];
    for (const name of layerNames) {
      const idx = objects.findIndex((o: any) => (o.layerName || o.name) === name);
      if (idx !== -1) { objects.splice(idx, 1); removed.push(name); }
    }

    tpl.metadata.updatedAt = new Date().toISOString();
    res.json({ success: true, data: { removed, count: removed.length } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/templates/:id/tools/reorder — change z-order
toolRoutes.post("/:id/tools/reorder", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const { layerName, position, frameId } = req.body;
    if (!layerName) return res.status(400).json({ success: false, error: "layerName required" });
    if (!["top", "bottom", "up", "down"].includes(position)) {
      return res.status(400).json({ success: false, error: "position must be: top, bottom, up, or down" });
    }

    const objects = getObjects(tpl, frameId);
    const idx = objects.findIndex((o: any) => (o.layerName || o.name) === layerName);
    if (idx === -1) return res.status(404).json({ success: false, error: "Layer not found" });

    const [item] = objects.splice(idx, 1);
    switch (position) {
      case "top": objects.push(item); break;
      case "bottom": objects.unshift(item); break;
      case "up": objects.splice(Math.min(idx + 1, objects.length), 0, item); break;
      case "down": objects.splice(Math.max(idx - 1, 0), 0, item); break;
    }

    tpl.metadata.updatedAt = new Date().toISOString();
    res.json({ success: true, data: { layerName, position } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/templates/:id/tools/svg-path — add custom SVG path
toolRoutes.post("/:id/tools/svg-path", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const { path, x = 0, y = 0, fill = "#cccccc", stroke = "transparent", strokeWidth = 1, layerName, frameId } = req.body;
    if (!path) return res.status(400).json({ success: false, error: "SVG path data required" });

    const obj: any = {
      type: "path", path,
      layerName: layerName || makeLayerName("path"),
      left: x, top: y, fill, stroke, strokeWidth,
      scaleX: 1, scaleY: 1, angle: 0, opacity: 1, visible: true,
    };

    const objects = getObjects(tpl, frameId);
    objects.push(obj);
    tpl.metadata.updatedAt = new Date().toISOString();
    res.status(201).json({ success: true, data: obj });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/templates/:id/tools/group — group layers
toolRoutes.post("/:id/tools/group", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const { layerNames, groupName, frameId } = req.body;
    if (!layerNames || !Array.isArray(layerNames) || layerNames.length < 2) {
      return res.status(400).json({ success: false, error: "layerNames array with at least 2 items required" });
    }

    const objects = getObjects(tpl, frameId);
    const members: any[] = [];
    for (const name of layerNames) {
      const idx = objects.findIndex((o: any) => (o.layerName || o.name) === name);
      if (idx !== -1) { members.push(...objects.splice(idx, 1)); }
    }

    if (members.length < 2) {
      return res.status(400).json({ success: false, error: "Need at least 2 layers to group" });
    }

    // Calculate bounding box
    const bounds = members.reduce((acc: any, o: any) => ({
      left: Math.min(acc.left, o.left || 0),
      top: Math.min(acc.top, o.top || 0),
    }), { left: Infinity, top: Infinity });

    const group = {
      type: "group",
      layerName: groupName || makeLayerName("group"),
      left: bounds.left, top: bounds.top,
      width: 0, height: 0,
      objects: members,
      scaleX: 1, scaleY: 1, angle: 0, opacity: 1, visible: true,
    };

    objects.push(group);
    tpl.metadata.updatedAt = new Date().toISOString();
    res.status(201).json({ success: true, data: group });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/templates/:id/tools/ungroup — ungroup a group
toolRoutes.post("/:id/tools/ungroup", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const { layerName, frameId } = req.body;
    if (!layerName) return res.status(400).json({ success: false, error: "layerName of the group required" });

    const objects = getObjects(tpl, frameId);
    const idx = objects.findIndex((o: any) => ((o.layerName || o.name) === layerName) && o.type === "group");
    if (idx === -1) return res.status(404).json({ success: false, error: "Group not found" });

    const group = objects.splice(idx, 1)[0];
    const children = group.objects || [];
    for (const child of children) {
      child.left = (group.left || 0) + (child.left || 0) - ((child.groupLeft || child.left) || 0);
      child.top = (group.top || 0) + (child.top || 0) - ((child.groupTop || child.top) || 0);
      objects.push(child);
    }

    tpl.metadata.updatedAt = new Date().toISOString();
    res.json({ success: true, data: { children: children.length, layerNames: children.map((c: any) => c.layerName || c.name) } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/templates/:id/tools/copy — copy a layer and store in clipboard-like response
toolRoutes.post("/:id/tools/copy", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const { layerName, frameId } = req.body;
    if (!layerName) return res.status(400).json({ success: false, error: "layerName required" });

    const objects = getObjects(tpl, frameId);
    const obj = objects.find((o: any) => (o.layerName || o.name) === layerName);
    if (!obj) return res.status(404).json({ success: false, error: "Layer not found" });

    res.json({ success: true, data: obj });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/templates/:id/tools/duplicate — duplicate a layer with offset
toolRoutes.post("/:id/tools/duplicate", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const { layerName, frameId, offsetX = 20, offsetY = 20 } = req.body;
    if (!layerName) return res.status(400).json({ success: false, error: "layerName required" });

    const objects = getObjects(tpl, frameId);
    const idx = objects.findIndex((o: any) => (o.layerName || o.name) === layerName);
    if (idx === -1) return res.status(404).json({ success: false, error: "Layer not found" });

    const clone = JSON.parse(JSON.stringify(objects[idx]));
    clone.layerName = `${layerName}_copy`;
    clone.left = (clone.left || 0) + offsetX;
    clone.top = (clone.top || 0) + offsetY;

    objects.push(clone);
    tpl.metadata.updatedAt = new Date().toISOString();
    res.status(201).json({ success: true, data: clone });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/templates/:id/tools/auto-layout
toolRoutes.post("/:id/tools/auto-layout", validate(autoLayoutSchema), async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const { targetLayerNames, direction = "horizontal", gap = 16, padding = 16, frameId } = req.body;
    const objects = getObjects(tpl, frameId);
    const targets = targetLayerNames
      .map((name: string) => objects.find((o: any) => (o.layerName || o.name) === name))
      .filter(Boolean);

    if (targets.length < 2) {
      return res.status(400).json({ success: false, error: "Need at least 2 layers for auto layout" });
    }

    let curX = targets[0].left;
    let curY = targets[0].top;
    for (const obj of targets) {
      obj.left = curX; obj.top = curY;
      if (direction === "horizontal") curX += (obj.width || 0) * (obj.scaleX || 1) + gap;
      else curY += (obj.height || 0) * (obj.scaleY || 1) + gap;
    }

    tpl.metadata.updatedAt = new Date().toISOString();
    res.json({ success: true, data: { direction, gap, padding, affected: targets.length } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
