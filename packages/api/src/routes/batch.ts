import { Router } from "express";
import { v4 as uuid } from "uuid";
import { store } from "../services/store.js";
import { z } from "zod";
import { validate } from "../middleware/validate.js";

export const batchRoutes = Router();

const batchSchema = z.object({
  data: z.array(z.record(z.string(), z.string())).min(1),
});

function findTextObjects(objs: any[]): any[] {
  const result: any[] = [];
  const walk = (arr: any[]) => {
    for (const o of arr) {
      if (o.type === "text" || o.type === "i-text" || o.type === "IText") result.push(o);
      if (o.objects && Array.isArray(o.objects)) walk(o.objects);
    }
  };
  walk(objs);
  return result;
}

function cloneTemplate(source: any, name: string): any {
  return {
    ...JSON.parse(JSON.stringify(source)),
    id: `tpl_${uuid().slice(0, 12)}`,
    name,
    metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  };
}

// POST /api/templates/:id/batch/single-post
// Clones template once per row, fills #VariableName text layers
batchRoutes.post("/:id/batch/single-post", validate(batchSchema), async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const results: any[] = [];
    let currentY = 0;

    for (let i = 0; i < req.body.data.length; i++) {
      const row = req.body.data[i];
      const clone = cloneTemplate(tpl, `${tpl.name} - ${i + 1}`);
      
      const texts = findTextObjects(clone.canvas.objects);
      for (const t of texts) {
        const key = (t.layerName || t.name || "").replace("#", "");
        if (row[key] !== undefined) t.text = row[key];
      }

      clone.canvas.viewport = { x: 0, y: currentY, zoom: 1 };
      currentY += (clone.height || 1080) + 100;

      store.templates.set(clone.id, clone);
      results.push({ id: clone.id, name: clone.name });
    }

    res.status(201).json({ success: true, data: results, total: results.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/templates/:id/batch/multi-post
// Uses Plantilla column to pick which template to clone per row
batchRoutes.post("/:id/batch/multi-post", validate(batchSchema), async (req, res) => {
  try {
    const results: any[] = [];
    let currentY = 0;

    for (const row of req.body.data) {
      const tplName = row["Plantilla"];
      if (!tplName) continue;

      // Find template by name in same workspace
      const source = [...store.templates.values()].find(
        t => t.name === tplName
      );
      if (!source) continue;

      const clone = cloneTemplate(source, `${tplName} - Generated ${results.length + 1}`);
      const texts = findTextObjects(clone.canvas.objects);
      for (const t of texts) {
        const key = (t.layerName || t.name || "").replace("#", "");
        if (row[key] !== undefined) t.text = row[key];
      }

      clone.canvas.viewport = { x: 0, y: currentY, zoom: 1 };
      currentY += (clone.height || 1080) + 100;

      store.templates.set(clone.id, clone);
      results.push({ id: clone.id, name: clone.name, source: tplName });
    }

    res.status(201).json({ success: true, data: results, total: results.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/templates/:id/batch/carousel
// Groups by ID_Carrusel, uses Plantilla_Slide to pick frame templates
batchRoutes.post("/:id/batch/carousel", validate(batchSchema), async (req, res) => {
  try {
    const data: Array<Record<string, string>> = req.body.data;
    const carousels: Record<string, Array<Record<string, string>>> = {};

    for (const row of data) {
      const id = row["ID_Carrusel"];
      if (!id) continue;
      if (!carousels[id]) carousels[id] = [];
      carousels[id].push(row);
    }

    const results: any[] = [];

    for (const carouselId in carousels) {
      const slides = carousels[carouselId];
      let currentX = 0;

      for (let i = 0; i < slides.length; i++) {
        const row = slides[i];
        const tplName = row["Plantilla_Slide"];
        if (!tplName) continue;

        const source = [...store.templates.values()].find(t => t.name === tplName);
        if (!source) continue;

        const clone = cloneTemplate(source, `Carousel_${carouselId}_Slide_${i + 1}`);
        const texts = findTextObjects(clone.canvas.objects);
        for (const t of texts) {
          const key = (t.layerName || t.name || "").replace("#", "");
          if (row[key] !== undefined) t.text = row[key];
        }

        clone.canvas.viewport = { x: currentX, y: 0, zoom: 1 };
        currentX += (clone.width || 1080) + 50;

        store.templates.set(clone.id, clone);
        results.push({ id: clone.id, name: clone.name, carouselId, slide: i + 1 });
      }
    }

    res.status(201).json({ success: true, data: results, total: results.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
