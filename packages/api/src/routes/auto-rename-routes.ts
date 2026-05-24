// auto-rename-routes.ts — Agent-facing auto-rename endpoint
// POST /api/templates/:id/auto-rename
// Analyzes canvas groups/objects and returns a rename plan.
import { Router } from "express";
import * as templates from "../services/templates";

const router = Router();

/** Group objects by Y-axis proximity into rows (server-side) */
function groupByRows(objs: any[], threshold = 300) {
  const sorted = [...objs].sort((a, b) => (a.top || 0) - (b.top || 0));
  const rows: { objects: any[]; y: number }[] = [];
  let currentRow: any[] = [];
  let currentY = sorted[0]?.top || 0;

  for (const o of sorted) {
    const oy = o.top || 0;
    if (Math.abs(oy - currentY) > threshold) {
      if (currentRow.length > 0) rows.push({ objects: currentRow, y: currentY });
      currentRow = [];
      currentY = oy;
    }
    currentRow.push(o);
  }
  if (currentRow.length > 0) rows.push({ objects: currentRow, y: currentY });

  for (const row of rows) {
    row.objects.sort((a, b) => (a.left || 0) - (b.left || 0));
  }
  return rows;
}

/** Walk objects recursively to find all text layers */
function findTexts(objs: any[]): any[] {
  const result: any[] = [];
  const walk = (items: any[]) => {
    for (const o of items) {
      const t = o.type || "";
      if (t === "text" || t === "textbox" || t === "i-text") result.push(o);
      if (o.objects && Array.isArray(o.objects)) walk(o.objects);
    }
  };
  walk(objs);
  return result;
}

// POST /api/templates/:id/auto-rename
router.post("/:id/auto-rename", async (req, res) => {
  try {
    const tpl = await templates.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const mode = req.body.mode || "unico";
    if (!["unico", "variable", "carrusel"].includes(mode)) {
      return res.status(400).json({ success: false, error: "mode must be: unico, variable, or carrusel" });
    }

    const canvasObjects = tpl.canvas.objects || [];
    const groups = canvasObjects.filter((o: any) => o.type === "group");

    if (groups.length === 0) {
      return res.json({
        success: true,
        data: { mode, groupCount: 0, rows: 0, renamePlan: [], message: "No groups found in template" },
      });
    }

    const rows = groupByRows(groups);
    const renamePlan: any[] = [];

    let carruselIndex = 1;
    let plantillaIndex = 1;
    let postIndex = 1;

    for (const row of rows) {
      let slideIndex = 1;
      for (const group of row.objects) {
        const groupName =
          mode === "carrusel"
            ? `Carrusel_${carruselIndex}_Slide_${slideIndex}`
            : mode === "variable"
              ? `Plantilla_${plantillaIndex}`
              : `PostTemplate_${postIndex}`;

        const texts = findTexts(group.objects || []);
        const textRenames: { from: string; to: string }[] = [];
        let textIdx = 1;
        const prefix = mode === "carrusel" ? "Carrusel" : mode === "variable" ? "Variable" : "Unico";

        for (const t of texts) {
          textRenames.push({
            from: t.layerName || t.name || `text-${textIdx}`,
            to: `#${prefix}${textIdx}`,
          });
          textIdx++;
        }

        renamePlan.push({
          group: { from: group.layerName || group.name, to: groupName },
          textCount: texts.length,
          textRenames,
        });

        slideIndex++;
        plantillaIndex++;
        postIndex++;
      }
      carruselIndex++;
    }

    res.json({
      success: true,
      data: {
        mode,
        groupCount: groups.length,
        rows: rows.length,
        renamePlan,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
