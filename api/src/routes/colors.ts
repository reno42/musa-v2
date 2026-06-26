import { Router } from "express";
import { store } from "../services/store.js";

export const colorRoutes = Router();

// GET /api/templates/:id/colors — extract palette with usage counts
colorRoutes.get("/:id/colors", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const palette: Record<string, { count: number; types: Set<string> }> = {};

    function extractColor(val: any): string | null {
      if (typeof val === "string" && val.startsWith("#") && val.length >= 4) return val.toUpperCase();
      if (typeof val === "string" && val.startsWith("rgb")) return val;
      return null;
    }

    function scan(obj: any) {
      const fill = extractColor(obj.fill);
      if (fill) {
        if (!palette[fill]) palette[fill] = { count: 0, types: new Set() };
        palette[fill].count++;
        palette[fill].types.add(obj.type || "unknown");
      }
      const stroke = extractColor(obj.stroke);
      if (stroke) {
        if (!palette[stroke]) palette[stroke] = { count: 0, types: new Set() };
        palette[stroke].count++;
        palette[stroke].types.add(`${obj.type || "unknown"}-stroke`);
      }
      if (obj.objects && Array.isArray(obj.objects)) {
        for (const child of obj.objects) scan(child);
      }
    }

    for (const frame of tpl.frames) {
      for (const obj of frame.objects) scan(obj);
    }

    const colors = Object.entries(palette)
      .map(([color, info]) => ({
        color,
        count: info.count,
        usedBy: [...info.types],
      }))
      .sort((a, b) => b.count - a.count);

    res.json({ success: true, data: { colors, total: colors.length } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
