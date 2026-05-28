import { Router } from "express";
import { v4 as uuid } from "uuid";
import { store } from "../services/store.js";
import { z } from "zod";
import { validate } from "../middleware/validate.js";

export const componentRoutes = Router();

const createSchema = z.object({
  name: z.string().min(1).max(200),
  layerNames: z.array(z.string()).min(1),
  description: z.string().max(500).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  properties: z.record(z.string(), z.any()).optional(),
});

// POST /api/templates/:id/components — create component from layers
componentRoutes.post("/:id/components", validate(createSchema), async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const { name, layerNames, description } = req.body;

    // Find the layers to turn into a component
    const layers: any[] = [];
    for (const ln of layerNames) {
      const idx = tpl.canvas.objects.findIndex((o: any) => (o.layerName || o.name) === ln);
      if (idx !== -1) {
        layers.push(...tpl.canvas.objects.splice(idx, 1));
      }
    }

    if (layers.length === 0) {
      return res.status(400).json({ success: false, error: "No matching layers found" });
    }

    const component = {
      id: `cmp_${uuid().slice(0, 12)}`,
      name,
      description: description || "",
      layers,
      instances: [] as string[],
      createdAt: new Date().toISOString(),
    };

    tpl.components.push(component);
    tpl.metadata.updatedAt = new Date().toISOString();
    res.status(201).json({ success: true, data: component });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/templates/:id/components — list components
componentRoutes.get("/:id/components", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    res.json({ success: true, data: tpl.components, total: tpl.components.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/templates/:id/components/:compId/instantiate — place instance
componentRoutes.post("/:id/components/:compId/instantiate", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const comp = tpl.components.find((c: any) => c.id === req.params.compId);
    if (!comp) return res.status(404).json({ success: false, error: "Component not found" });

    const { x = 100, y = 100 } = req.body;

    // Clone layers at target position
    const clones = comp.layers.map((layer: any) => {
      const clone = JSON.parse(JSON.stringify(layer));
      clone.layerName = `${comp.name}_instance_${uuid().slice(0, 6)}`;
      clone.left = (clone.left || 0) + x;
      clone.top = (clone.top || 0) + y;
      clone.componentId = comp.id;
      return clone;
    });

    // If single layer, push directly; if multiple, group them
    if (clones.length === 1) {
      tpl.canvas.objects.push(clones[0]);
    } else {
      const group = {
        type: "group",
        layerName: `${comp.name}_instance`,
        left: x, top: y, width: 0, height: 0,
        objects: clones,
        scaleX: 1, scaleY: 1, angle: 0, opacity: 1, visible: true,
        componentId: comp.id,
      };
      tpl.canvas.objects.push(group);
    }

    comp.instances.push(clones.length === 1 ? clones[0].layerName : `${comp.name}_instance`);
    tpl.metadata.updatedAt = new Date().toISOString();
    res.status(201).json({ success: true, data: { instances: comp.instances.length } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/templates/:id/components/:compId — update component (propagate to instances)
componentRoutes.put("/:id/components/:compId", validate(updateSchema), async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const comp = tpl.components.find((c: any) => c.id === req.params.compId);
    if (!comp) return res.status(404).json({ success: false, error: "Component not found" });

    if (req.body.name) comp.name = req.body.name;
    if (req.body.description !== undefined) comp.description = req.body.description;

    // Propagate property changes to all instances
    if (req.body.properties) {
      const props = req.body.properties;

      // Update source layers
      for (const layer of comp.layers) {
        Object.assign(layer, props);
      }

      // Propagate to instances
      const walk = (objs: any[]) => {
        for (const o of objs) {
          if (o.componentId === comp.id) {
            Object.assign(o, props);
          }
          if (o.objects && Array.isArray(o.objects)) walk(o.objects);
        }
      };
      walk(tpl.canvas.objects);
      for (const f of tpl.frames) walk(f.objects);
    }

    tpl.metadata.updatedAt = new Date().toISOString();
    res.json({ success: true, data: comp });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/templates/:id/components/:compId
componentRoutes.delete("/:id/components/:compId", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const idx = tpl.components.findIndex((c: any) => c.id === req.params.compId);
    if (idx === -1) return res.status(404).json({ success: false, error: "Component not found" });

    tpl.components.splice(idx, 1);
    tpl.metadata.updatedAt = new Date().toISOString();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
