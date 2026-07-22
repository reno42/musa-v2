import { Router } from "express";
import * as templates from "../services/templates.js";
import { createTemplate, updateTemplate } from "../services/templates.js";
import { canAccessWorkspace } from "../services/tenancy.js";

export const batchRoutes = Router();

/** Maximum CSV rows per batch to avoid Netlify 10s function timeout. */
const MAX_BATCH_ROWS = 15;

// ── Slot detection ──

/** Detect {{slot}} placeholders from text. */
function detectMustacheSlots(text: string): string[] {
  const slots = new Set<string>();
  const re = /\{\{(\w+)\}\}/g;
  let m;
  while ((m = re.exec(text)) !== null) slots.add(m[1]);
  return [...slots];
}

/** Detect data-slot="name" attributes from HTML. */
function detectDataSlots(html: string): string[] {
  const slots = new Set<string>();
  const re = /data-slot=["'](\w+)["']/g;
  let m;
  while ((m = re.exec(html)) !== null) slots.add(m[1]);
  return [...slots];
}

/** Detect ALL slots from a template (both {{slot}} and data-slot). */
function detectAllSlots(texts: string[]): { mustache: string[]; dataSlot: string[]; all: string[] } {
  const mustache = new Set<string>();
  const dataSlot = new Set<string>();
  for (const text of texts) {
    detectMustacheSlots(text).forEach((s) => mustache.add(s));
    detectDataSlots(text).forEach((s) => dataSlot.add(s));
  }
  return {
    mustache: [...mustache],
    dataSlot: [...dataSlot],
    all: [...new Set([...mustache, ...dataSlot])],
  };
}

// ── Slot substitution ──

/** Replace {{slot}} placeholders with row values in any string. */
function substituteMustache(text: string, row: Record<string, string>): string {
  let result = text;
  for (const [key, value] of Object.entries(row)) {
    result = result.split(`{{${key}}}`).join(value || "");
  }
  return result;
}

/**
 * Replace text content inside elements that have data-slot="name" attributes.
 * Uses regex to find elements like `<... data-slot="headline" ...>OLD</...>` and
 * replaces OLD with the CSV value for that column.
 */
function substituteDataSlots(html: string, row: Record<string, string>): string {
  let result = html;
  for (const [key, value] of Object.entries(row)) {
    if (!value) continue;
    // Match elements with data-slot="key" and replace their text content.
    // Handles self-closing tags (skip) and elements with children.
    const re = new RegExp(
      `(<[^>]*data-slot=["']${key}["'][^>]*>)([^<]*)(<\\/(?:div|span|p|h[1-6]|a|button|li|td|th|label|em|strong|b|i|small|sub|sup)>|<\\/[^>]+>)`,
      "gi"
    );
    result = result.replace(re, `$1${value}$3`);

    // Also handle data-slot on <img> — replace src
    const imgRe = new RegExp(
      `(<img[^>]*data-slot=["']${key}["'][^>]*src=["'])([^"']*)(["'])`,
      "gi"
    );
    result = result.replace(imgRe, `$1${value}$3`);
  }
  return result;
}

/**
 * Unified substitution: applies BOTH {{slot}} AND data-slot replacement
 * to HTML and CSS strings.
 */
function substituteUnified(text: string, row: Record<string, string>, isCss = false): string {
  let result = substituteMustache(text, row);
  if (!isCss) {
    result = substituteDataSlots(result, row);
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

// ── Slot validation rules ──

interface SlotRule {
  name: string;
  required: boolean;
  maxLength?: number;
  pattern?: string;
}

/** Heuristic slot validation rules based on common naming conventions. */
function inferSlotRules(slots: string[]): SlotRule[] {
  return slots.map((name) => {
    const rule: SlotRule = { name, required: true };
    // Image URLs: validate URL format
    if (name.includes("image") || name.includes("img") || name.includes("photo") || name.includes("url")) {
      rule.maxLength = 2000;
    }
    // Headlines: typical max 80 chars
    if (name.includes("headline") || name.includes("title") || name.includes("heading")) {
      rule.maxLength = 80;
    }
    // CTAs: short text
    if (name.includes("cta") || name.includes("button")) {
      rule.maxLength = 30;
    }
    // Suffix/subtitle: medium text
    if (name.includes("suffix") || name.includes("subtitle") || name.includes("sub")) {
      rule.maxLength = 50;
    }
    return rule;
  });
}

// ── Routes ──

/**
 * GET /api/templates/:id/batch/slots
 * Detects {{slot}} AND data-slot placeholders available for CSV substitution.
 */
batchRoutes.get("/:id/batch/slots", async (req, res) => {
  try {
    const tpl = await templates.getTemplate(req.params.id);
    if (!tpl) {
      return res.status(404).json({ success: false, error: "Template not found" });
    }
    const { mustache, dataSlot, all } = detectAllSlots(collectText(tpl));
    const rules = inferSlotRules(all);
    res.json({
      success: true,
      slots: all,
      mustacheSlots: mustache,
      dataSlots: dataSlot,
      rules,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/templates/:id/batch/validate
 * Validates CSV rows against detected slots before generation.
 * Returns per-cell validation issues.
 */
batchRoutes.post("/:id/batch/validate", async (req, res) => {
  try {
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

    const tpl = await templates.getTemplate(req.params.id);
    if (!tpl) {
      return res.status(404).json({ success: false, error: "Template not found" });
    }

    const { all } = detectAllSlots(collectText(tpl));
    const rules = inferSlotRules(all);
    const csvColumns = Object.keys(rows[0]);

    const issues: Array<{
      row: number;
      column: string;
      severity: "error" | "warning";
      message: string;
    }> = [];

    // Check for missing required slots (columns not in CSV)
    for (const rule of rules) {
      if (rule.required && !csvColumns.includes(rule.name)) {
        issues.push({
          row: 0,
          column: rule.name,
          severity: "error",
          message: `Required slot "${rule.name}" is missing from CSV headers`,
        });
      }
    }

    // Check each row
    rows.forEach((row: Record<string, string>, rowIdx: number) => {
      for (const rule of rules) {
        const value = row[rule.name];
        if (!value || !value.trim()) {
          if (rule.required) {
            issues.push({
              row: rowIdx + 1,
              column: rule.name,
              severity: "warning",
              message: `Row ${rowIdx + 1}: slot "${rule.name}" is empty`,
            });
          }
          continue;
        }

        // Length check
        if (rule.maxLength && value.length > rule.maxLength) {
          issues.push({
            row: rowIdx + 1,
            column: rule.name,
            severity: "warning",
            message: `Row ${rowIdx + 1}: "${rule.name}" is ${value.length} chars (max ${rule.maxLength}) — will be truncated`,
          });
        }

        // URL format check for image slots
        if ((rule.name.includes("image") || rule.name.includes("url")) && value) {
          if (!value.startsWith("http://") && !value.startsWith("https://") && !value.startsWith("data:image/")) {
            issues.push({
              row: rowIdx + 1,
              column: rule.name,
              severity: "warning",
              message: `Row ${rowIdx + 1}: "${rule.name}" doesn't look like a valid URL`,
            });
          }
        }
      }
    });

    const hasErrors = issues.some((i) => i.severity === "error");
    res.json({
      success: true,
      valid: !hasErrors,
      issues,
      slotCount: all.length,
      rowCount: rows.length,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/templates/batch-ready
 * Lists all templates that contain {{slot}} OR data-slot placeholders.
 * These are templates ready for batch CSV generation.
 */
batchRoutes.get("/batch-ready", async (req, res) => {
  try {
    const workspaceId = String(req.query.workspaceId || "");
    if (!workspaceId || !req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "viewer"))) {
      return res.status(403).json({ success: false, error: "Workspace access is required" });
    }
    const { data: allTemplates } = await templates.listTemplatesPaginated(200, 0, workspaceId);
    const batchReady = [];
    for (const tpl of allTemplates) {
      const texts = collectText(tpl);
      const { mustache, dataSlot, all } = detectAllSlots(texts);
      if (all.length > 0) {
        batchReady.push({
          id: tpl.id,
          name: tpl.name,
          slotCount: all.length,
          slots: all,
          mustacheSlots: mustache,
          dataSlots: dataSlot,
          workspaceId: tpl.workspaceId,
          updatedAt: tpl.metadata?.updatedAt,
        });
      }
    }
    res.json({ success: true, data: batchReady, count: batchReady.length });
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
 * Slot syntax: BOTH {{columnName}} string placeholders AND data-slot="name" attributes.
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
            html: frame.html ? substituteUnified(frame.html, row) : frame.html,
            css: frame.css ? substituteUnified(frame.css, row, true) : frame.css,
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
        css: tpl.css ? substituteUnified(tpl.css, rows[0], true) : "",
        background: (tpl.frames as any[])?.[0]?.background || "#ffffff",
      };
      if (tpl.html) updates.html = substituteUnified(tpl.html, rows[0]);
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
          html: frame.html ? substituteUnified(frame.html, row) : frame.html,
          css: frame.css ? substituteUnified(frame.css, row, true) : frame.css,
        }));

        const created = await createTemplate(
          `${tpl.name} — ${label}`,
          tpl.width || 1080, tpl.height || 1080,
          undefined, userId, ws,
        );
        const updates: any = {
          frames: newFrames,
          css: tpl.css ? substituteUnified(tpl.css, row, true) : "",
          background: (tpl.frames as any[])?.[0]?.background || "#ffffff",
        };
        if (tpl.html) updates.html = substituteUnified(tpl.html, row);
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
