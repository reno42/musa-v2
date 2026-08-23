import { Router } from "express";
import { getSupabaseAdmin } from "../services/supabase.js";

/**
 * Editor-side comments — the owner half of the design_comments system.
 *
 * Mounted at /api/templates, so `requireTemplateAccess` already verified
 * the caller owns (or can access) the template before any handler runs.
 * Reads/writes go through the service-role client (RLS bypass), the same
 * path the MCP `comment_add` tool and /api/comments-share use.
 *
 * Replaces the old in-memory `commentRoutes` (comments.ts), which wrote
 * into store.getTemplate() and was lost on every restart.
 */
export const designCommentRoutes = Router();

const ALLOWED_STATUSES = ["open", "resolved", "archived"];

function clampPct(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// GET /api/templates/:templateId/comments — every pin on the design
// (mobile guests + editor pins), newest first, open ones up front.
designCommentRoutes.get("/:templateId/comments", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    if (!sb) return res.status(503).json({ success: false, error: "Supabase not configured" });

    const { data: comments, error } = await sb.from("design_comments")
      .select("id, template_id, frame_id, x_pct, y_pct, body, author_name, author_avatar, status, source, kanban_task_id, created_at")
      .eq("template_id", req.params.templateId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return res.status(500).json({ success: false, error: error.message });

    return res.json({ success: true, data: comments || [], total: (comments || []).length });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || "Comments load failed" });
  }
});

// POST /api/templates/:templateId/comments — owner adds a pin from the
// editor (double-tap / comment tool / composer). Source: editor_pin.
designCommentRoutes.post("/:templateId/comments", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    if (!sb) return res.status(503).json({ success: false, error: "Supabase not configured" });

    const text = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!text || text.length > 500) {
      return res.status(400).json({ success: false, error: "El comentario debe tener entre 1 y 500 caracteres." });
    }

    const row: Record<string, unknown> = {
      id: randomId("comment"),
      template_id: req.params.templateId,
      frame_id: (typeof req.body?.frameId === "string" && req.body.frameId) || null,
      // requireTemplateAccess already resolved this — one less lookup.
      workspace_id: req.templateWorkspaceId || null,
      account_id: null,
      x_pct: clampPct(req.body?.xPct, 50),
      y_pct: clampPct(req.body?.yPct, 50),
      body: text,
      author_name: "Tú",
      source: "editor_pin",
    };

    const { data: comment, error } = await sb.from("design_comments").insert(row).select().single();
    if (error) return res.status(500).json({ success: false, error: "Comment insert failed: " + error.message });

    return res.status(201).json({ success: true, data: comment });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || "Comment save failed" });
  }
});

// PATCH /api/templates/:templateId/comments/:commentId — status change
// (open / resolved / archived), the same lifecycle the Kanban uses.
designCommentRoutes.patch("/:templateId/comments/:commentId", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    if (!sb) return res.status(503).json({ success: false, error: "Supabase not configured" });

    const status = typeof req.body?.status === "string" ? req.body.status : "";
    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: "Estado inválido: usa open, resolved o archived." });
    }

    const { data: comment, error } = await sb.from("design_comments")
      .update({ status })
      .eq("id", req.params.commentId)
      .eq("template_id", req.params.templateId)
      .select()
      .single();
    if (error) return res.status(404).json({ success: false, error: "Comentario no encontrado." });

    return res.json({ success: true, data: comment });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || "Comment update failed" });
  }
});

// DELETE /api/templates/:templateId/comments/:commentId
designCommentRoutes.delete("/:templateId/comments/:commentId", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    if (!sb) return res.status(503).json({ success: false, error: "Supabase not configured" });

    const { error } = await sb.from("design_comments")
      .delete()
      .eq("id", req.params.commentId)
      .eq("template_id", req.params.templateId);
    if (error) return res.status(404).json({ success: false, error: "Comentario no encontrado." });

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || "Comment delete failed" });
  }
});

// GET /api/templates/:templateId/public — current visibility flag.
// Fail-open: before migration v28 the column doesn't exist, so `=== false`
// never matches and the design reports as public (same behavior guests see).
designCommentRoutes.get("/:templateId/public", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    if (!sb) return res.status(503).json({ success: false, error: "Supabase not configured" });

    const { data: tpl, error } = await sb.from("templates")
      .select("*")
      .eq("id", req.params.templateId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return res.status(500).json({ success: false, error: error.message });
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    return res.json({ success: true, data: { isPublic: (tpl as any).is_public !== false } });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || "Public state load failed" });
  }
});

// PATCH /api/templates/:templateId/public — owner flips the share link
// on/off. Body: { isPublic: boolean }.
designCommentRoutes.patch("/:templateId/public", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    if (!sb) return res.status(503).json({ success: false, error: "Supabase not configured" });
    if (typeof req.body?.isPublic !== "boolean") {
      return res.status(400).json({ success: false, error: "isPublic debe ser true o false." });
    }

    const { data: tpl, error } = await sb.from("templates")
      .update({ is_public: req.body.isPublic })
      .eq("id", req.params.templateId)
      .select("*")
      .maybeSingle();
    if (error) {
      // Pre-migration v28: the column doesn't exist yet. Fail loud here
      // (the editor shows a toast) — guests keep fail-open access.
      return res.status(503).json({
        success: false,
        error: "No se pudo guardar el cambio. Aplica la migración supabase_migrations_v28.sql (columna templates.is_public).",
      });
    }
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    return res.json({ success: true, data: { isPublic: (tpl as any).is_public !== false } });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || "Public state save failed" });
  }
});
