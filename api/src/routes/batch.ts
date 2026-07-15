import { Router } from "express";
import * as templates from "../services/templates.js";
import { createTemplate, updateTemplate } from "../services/templates.js";

export const batchRoutes = Router();

/** Maximum CSV rows per batch to avoid Netlify 10s function timeout. */
const MAX_BATCH_ROWS = 15;

/** Detect {{slot}} placeholders from HTML or CSS. */
function detectSlots(text: string): string[] {
  const slots = new Set<string>();
  const re = /\{\{(\w+)\}\}/g;
  let m;
  while ((m = re.exec(text)) !== null) slots.add(m[1]);
  return [...slots];
}

/** Replace {{slot}} placeholders with row values in any string. */
function substitute(text: string, row: Record<string, string>): string {
  let result = text;
  for (const [key, value] of Object.entries(row)) {
    result = result.split(`{{${key}}}`).join(value || "");
  }
  return result;
}

/** Collect all HTML+CSS strings from a template to scan for slots. */
function collectText(tpl: any): string[] {
  const parts: string[] = [];
  if (tpl.html) parts.push(tpl.html);
  if (tpl.css) parts.push(tpl.css);
  if (Array.isArray(tpl.frames)) {
    for (const f of tpl.frames) {
      if (f.html) parts.push(f.html);
      if (f.css) parts.push(f.css);
    }
  }
  return parts;
}

/**
 * GET /api/templates/:id/batch/slots
 * Detects {{slot}} placeholders available for CSV substitution.
 */
batchRoutes.get("/:id/batch/slots", async (req, res) => {
  try {
    const tpl = await templates.getTemplate(req.params.id);
    if (!tpl) {
      return res.status(404).json({ success: false, error: "Template not found" });
    }
    const allSlots = new Set<string>();
    for (const text of collectText(tpl)) {
      detectSlots(text).forEach((s) => allSlots.add(s));
    }
    res.json({ success: true, slots: [...allSlots] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/templates/:id/batch/:mode
 * Generate designs from a CSV data array.
 *
 * Modes:
 *   single-post / multi-post → N templates, each with frames substituted per row
 *   carousel → 1 template with N×(master frames), one set per CSV row
 *
 * Slot syntax: {{columnName}} in HTML text or CSS — replaced with CSV cell value.
 *
 * Body: { data: Record<string, string>[] }
 */
batchRoutes.post("/:id/batch/:mode", async (req, res) => {
  try {
    const { id, mode } = req.params;
    const { data: rows } = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, error: "data must be a non-empty array" });
    }
    if (rows.length > MAX_BATCH_ROWS) {
      return res.status(400).json({
        success: false,
        error: `Maximum ${MAX_BATCH_ROWS} rows per batch (Netlify 10s timeout). Split your CSV.`,
      });
    }

    const tpl = await templates.getTemplate(id);
    if (!tpl) {
      return res.status(404).json({ success: false, error: "Template not found" });
    }

    const userId = (tpl.metadata as any)?.createdBy || "dev_user_default";
    const ws = tpl.workspaceId || "default";
    const FRAME_GAP = 100;
    const results: any[] = [];

    if (mode === "carousel") {
      // One template, frames repeated for each CSV row
      const newFrames: any[] = [];
      let frameIndex = 0;

      for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
        const row = rows[rowIdx];
        for (const frame of (tpl.frames as any[]) || []) {
          const offsetX = frameIndex * ((frame.width || tpl.width || 1080) + FRAME_GAP);
          newFrames.push({
            ...frame,
            id: `frame_b${rowIdx}_${frame.id || frameIndex}`,
            name: row.name || row.title || `${frame.name || "Slide"} ${rowIdx + 1}`,
            x: offsetX,
            y: frame.y || 0,
            html: frame.html ? substitute(frame.html, row) : frame.html,
            css: frame.css ? substitute(frame.css, row) : frame.css,
            background: (frame as any).background || "#ffffff",
          });
          frameIndex++;
        }
      }

      const created = await createTemplate(
        `${tpl.name} — Carousel (${rows.length})`,
        tpl.width || 1080, tpl.height || 1080,
        undefined, userId, ws,
      );
      const updates: any = {
        frames: newFrames,
        css: tpl.css ? substitute(tpl.css, rows[0]) : "",
        background: (tpl.frames as any[])?.[0]?.background || "#ffffff",
      };
      if (tpl.html) updates.html = substitute(tpl.html, rows[0]);
      const saved = await updateTemplate(created.id, updates);
      results.push(saved);
    } else {
      // single-post / multi-post: N templates, one per row
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const label = row.name || row.title || row.headline || `Variant ${i + 1}`;

        const newFrames = ((tpl.frames as any[]) || []).map((frame: any, fi: number) => ({
          ...frame,
          id: `frame_b${i}_${frame.id || fi}`,
          html: frame.html ? substitute(frame.html, row) : frame.html,
          css: frame.css ? substitute(frame.css, row) : frame.css,
        }));

        const created = await createTemplate(
          `${tpl.name} — ${label}`,
          tpl.width || 1080, tpl.height || 1080,
          undefined, userId, ws,
        );
        const updates: any = {
          frames: newFrames,
          css: tpl.css ? substitute(tpl.css, row) : "",
          background: (tpl.frames as any[])?.[0]?.background || "#ffffff",
        };
        if (tpl.html) updates.html = substitute(tpl.html, row);
        const saved = await updateTemplate(created.id, updates);
        if (saved) results.push(saved);
      }
    }

    res.json({ success: true, data: results, count: results.length });
  } catch (err: any) {
    console.error("[batch] Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});
