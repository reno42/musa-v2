import { Router } from "express";
import { getSupabaseAdmin } from "../services/supabase.js";
import { dispatchWebhook } from "../services/webhooks.js";

/**
 * Guest mobile comments — the public half of the design_comments system.
 *
 * The share link `/c/:templateId` (MobileComments.tsx) points a phone at a
 * design. No account, no API key: the auth middleware bypasses
 * `/api/comments-share/` and writes go through the service-role client (RLS
 * bypass), the same path the MCP `comment_add` tool takes. Comments land in
 * `design_comments` (source `mobile_pin`) and, when the author opts in, a
 * matching card in `design_kanban_tasks` so their AIs can apply the feedback.
 */
export const commentShareRoutes = Router();

// ── Anti-abuse: tighter per-IP cap for guest POSTs ──
// The global rateLimit allows 100 req/min/IP; anonymous writes deserve less.
const POST_MAX = 12;
const POST_WINDOW_MS = 60_000;
const postCounts = new Map<string, { count: number; resetAt: number }>();

function guestPostAllowed(ip: string): boolean {
  const now = Date.now();
  const entry = postCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    postCounts.set(ip, { count: 1, resetAt: now + POST_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  if (postCounts.size > 5000) {
    for (const [key, e] of postCounts) {
      if (now > e.resetAt) postCounts.delete(key);
    }
  }
  return entry.count <= POST_MAX;
}

function clampPct(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// GET /api/comments-share/:templateId — editor-shaped preview + its comments.
// The response carries the full frame payloads (html/css) so the guest share
// page (/c/:templateId, SharedDesignGate.tsx) can paint the REAL design
// behind its auth gate. Caps keep a hostile-sized template from turning the
// unauthenticated endpoint into a bandwidth/firehose liability.
const MAX_SHARE_FRAMES = 30;
const MAX_SHARE_FRAME_BYTES = 2 * 1024 * 1024;

commentShareRoutes.get("/:templateId", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    if (!sb) return res.status(503).json({ success: false, error: "Supabase not configured" });

    // select("*") keeps the read fail-open: before migration v28 the
    // is_public column doesn't exist, and `=== false` never matches on
    // undefined — guests keep access until the owner opts out.
    const { data: tpl, error } = await sb.from("templates")
      .select("*")
      .eq("id", req.params.templateId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return res.status(500).json({ success: false, error: error.message });
    if (!tpl) return res.status(404).json({ success: false, error: "Design not found" });

    if ((tpl as any).is_public === false) {
      return res.status(403).json({
        success: false,
        code: "PRIVATE",
        error: "Este diseño es privado. Pide a su autor que lo comparta.",
      });
    }

    // Frames live inside the data JSONB (see services/templates.ts).
    let payload: any = (tpl as any).data || {};
    if (typeof payload === "string") {
      try { payload = JSON.parse(payload); } catch { payload = {}; }
    }
    const rawFrames: any[] = Array.isArray(payload.frames) ? payload.frames : [];
    const frames: Record<string, unknown>[] = [];
    let shareBytes = 0;
    for (const frame of rawFrames.slice(0, MAX_SHARE_FRAMES)) {
      const html = typeof frame?.html === "string" ? frame.html : "";
      const css = typeof frame?.css === "string" ? frame.css : "";
      if (shareBytes + html.length + css.length > MAX_SHARE_FRAME_BYTES) break;
      shareBytes += html.length + css.length;
      frames.push({
        id: String(frame?.id || `frame_${frames.length}`),
        name: String(frame?.name || `Frame ${frames.length + 1}`),
        x: Number(frame?.x) || 0,
        y: Number(frame?.y) || 0,
        width: Number(frame?.width) || Number(payload.width) || 1080,
        height: Number(frame?.height) || Number(payload.height) || 1080,
        html,
        css,
        background: frame?.background || frame?.fill || null,
      });
    }
    const framesTruncated = frames.length < rawFrames.length;

    const { data: comments, error: cErr } = await sb.from("design_comments")
      .select("id, body, author_name, x_pct, y_pct, status, source, kanban_task_id, created_at")
      .eq("template_id", req.params.templateId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (cErr) return res.status(500).json({ success: false, error: cErr.message });

    return res.json({
      success: true,
      data: {
        template: {
          id: tpl.id,
          name: tpl.name,
          workspaceId: tpl.workspace_id || null,
          isBrandManual: Boolean((tpl as any).is_brand_manual),
          thumbnail: payload.thumbnail || null,
          width: Number(payload.width) || 1080,
          height: Number(payload.height) || 1080,
          background: payload.background || null,
          frames,
          framesTruncated,
        },
        comments: comments || [],
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || "Comments load failed" });
  }
});

// POST /api/comments-share/:templateId — guest comment (+ optional Kanban card).
// Mirrors the MCP comment_add insert shape; comment_type is intentionally
// omitted (column exists only in the MCP handler's assumptions, not in the
// migrations) so the insert can't fail on an unknown column.
commentShareRoutes.post("/:templateId", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    if (!sb) return res.status(503).json({ success: false, error: "Supabase not configured" });

    const ip = (req.headers["x-forwarded-for"] as string) || req.socket?.remoteAddress || "unknown";
    if (!guestPostAllowed(ip)) {
      return res.status(429).json({ success: false, error: "Demasiados comentarios seguidos — espera un minuto." });
    }

    const text = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!text || text.length > 500) {
      return res.status(400).json({ success: false, error: "El comentario debe tener entre 1 y 500 caracteres." });
    }
    const author = (typeof req.body?.authorName === "string" ? req.body.authorName.trim() : "").slice(0, 60) || "Invitado";
    const xPct = clampPct(req.body?.xPct, 50);
    const yPct = clampPct(req.body?.yPct, 50);
    const createKanbanTask = req.body?.createKanbanTask === true;
    // The editor's own composer posts through this public endpoint too
    // (no auth on mobile), so it can tag the row as editor_pin.
    const source = req.body?.source === "editor_pin" ? "editor_pin" : "mobile_pin";

    const { data: tpl, error: tplErr } = await sb.from("templates")
      .select("*")
      .eq("id", req.params.templateId)
      .is("deleted_at", null)
      .maybeSingle();
    if (tplErr) return res.status(500).json({ success: false, error: tplErr.message });
    if (!tpl) return res.status(404).json({ success: false, error: "Design not found" });

    if ((tpl as any).is_public === false) {
      return res.status(403).json({
        success: false,
        code: "PRIVATE",
        error: "Este diseño es privado. Pide a su autor que lo comparta.",
      });
    }

    const row: Record<string, unknown> = {
      id: randomId("comment"),
      template_id: tpl.id,
      frame_id: null,
      workspace_id: (tpl as any).workspace_id || null,
      account_id: null,
      x_pct: xPct,
      y_pct: yPct,
      body: text,
      author_name: author,
      source,
    };
    const { data: comment, error } = await sb.from("design_comments").insert(row).select().single();
    if (error) return res.status(500).json({ success: false, error: "Comment insert failed: " + error.message });

    let kanbanTask: any = null;
    if (createKanbanTask) {
      const taskId = randomId("card");
      const { data: kt, error: ktErr } = await sb.from("design_kanban_tasks").insert({
        id: taskId,
        title: `Comentario: ${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`,
        workspace_id: (tpl as any).workspace_id || null,
        template_id: tpl.id,
        frame_id: null,
        brief: `${text}\n\n(Pin móvil en x ${Math.round(xPct)}% / y ${Math.round(yPct)}% — dejado por ${author} desde el móvil)`,
        status: "backlog",
        type: "other",
        created_by: author,
        tags: ["comment", "mobile_pin"],
        account_id: null,
      }).select().single();
      if (!ktErr && kt) {
        kanbanTask = kt;
        await sb.from("design_comments").update({ kanban_task_id: taskId }).eq("id", comment.id);
      }
    }

    return res.status(201).json({ success: true, data: { comment, kanbanTask } });
    // Outgoing webhooks (Configuración → APIs/Webhooks) — invitados móviles incluidos.
    void dispatchWebhook("comment.created", {
      templateId: tpl.id, workspaceId: (tpl as any).workspace_id || null,
      commentId: (comment as any).id, body: text.slice(0, 200),
      frameId: null, source, author,
    }, { workspaceId: (tpl as any).workspace_id || null });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || "Comment save failed" });
  }
});
