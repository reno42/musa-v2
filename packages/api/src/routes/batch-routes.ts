// batch-routes.ts — Agent-facing batch design endpoint
// POST /api/templates/:id/batch
// Validates template, parses CSV, returns structured batch plan.
// The actual Fabric.js clone+fill runs client-side; this endpoint
// gives agents everything they need to drive the batch pipeline.
import { Router } from "express";
import * as templates from "../services/templates";

const router = Router();

/** Walk canvas.objects recursively to find named text layers */
function findTextLayers(objs: any[]): { name: string; type: string }[] {
  const result: { name: string; type: string }[] = [];
  const walk = (items: any[]) => {
    for (const o of items) {
      const t = o.type || "";
      if (t === "text" || t === "textbox" || t === "i-text") {
        const name = o.layerName || o.name || "";
        result.push({ name, type: t });
      }
      if (o.objects && Array.isArray(o.objects)) walk(o.objects);
    }
  };
  walk(objs);
  return result;
}

/** Simple CSV parser (server-side, no dependency needed) */
function simpleParseCSV(text: string): Record<string, string>[] | null {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cols[j] || "";
    }
    rows.push(row);
  }
  return rows;
}

// POST /api/templates/:id/batch
router.post("/:id/batch", async (req, res) => {
  try {
    const tpl = await templates.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const { mode, csv, templateName } = req.body;

    if (!mode || !["single", "multi", "carousel"].includes(mode)) {
      return res.status(400).json({ success: false, error: "mode must be: single, multi, or carousel" });
    }
    if (!csv || typeof csv !== "string") {
      return res.status(400).json({ success: false, error: "csv field is required (string)" });
    }

    const rows = simpleParseCSV(csv);
    if (!rows) {
      return res.status(400).json({ success: false, error: "CSV must have headers + at least 1 data row" });
    }

    // Extract text layers from canvas objects
    const canvasObjects = tpl.canvas.objects || [];
    const textLayers = findTextLayers(canvasObjects);
    const columns = textLayers.map((l) => l.name.replace(/^#/, ""));

    // Validate against CSV headers
    const csvHeaders = Object.keys(rows[0]);
    const missing = columns.filter((c) => !csvHeaders.includes(c));

    res.json({
      success: true,
      data: {
        mode,
        templateId: tpl.id,
        templateName: templateName || tpl.name,
        totalRows: rows.length,
        rows,
        columns,
        missingColumns: missing,
        valid: missing.length === 0,
        textLayerCount: textLayers.length,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
