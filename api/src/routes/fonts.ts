import { Router } from "express";
import { store } from "../services/store.js";

export const fontRoutes = Router();

// GET /api/templates/:id/fonts — list fonts with usage counts
fontRoutes.get("/:id/fonts", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const fontMap: Record<string, { count: number; sizes: Set<number>; weights: Set<string> }> = {};

    function scan(obj: any) {
      if (
        obj.type === "text" || obj.type === "i-text" ||
        obj.type === "IText" || obj.type === "Textbox" || obj.type === "textbox"
      ) {
        const family = obj.fontFamily || "Inter";
        if (!fontMap[family]) {
          fontMap[family] = { count: 0, sizes: new Set(), weights: new Set() };
        }
        fontMap[family].count++;
        if (obj.fontSize) fontMap[family].sizes.add(obj.fontSize);
        if (obj.fontWeight) fontMap[family].weights.add(String(obj.fontWeight));
      }
      if (obj.objects && Array.isArray(obj.objects)) {
        for (const child of obj.objects) scan(child);
      }
    }

    for (const frame of tpl.frames) {
      for (const obj of frame.objects) scan(obj);
    }

    const fonts = Object.entries(fontMap)
      .map(([family, info]) => ({
        family,
        count: info.count,
        sizes: [...info.sizes].sort((a, b) => a - b),
        weights: [...info.weights],
      }))
      .sort((a, b) => b.count - a.count);

    res.json({ success: true, data: { fonts, total: fonts.length } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
