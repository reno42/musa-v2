import { Router } from "express";
import { v4 as uuid } from "uuid";
import { getSupabase, getSupabaseAdmin } from "../services/supabase.js";
import { canAccessWorkspace } from "../services/tenancy.js";

export const bugReportRoutes = Router();

// Ciclo de vida compartido con el tool MCP report_bug y ReportsSection.
const BUG_STATUSES = ["nuevo", "en_progreso", "corregido", "descartado"] as const;
const BUG_SEVERITIES = ["baja", "media", "alta", "critica"] as const;

// POST /api/bug-reports — public, no auth required
bugReportRoutes.post("/", async (req, res) => {
  try {
    const {
      description, url, deviceInfo, consoleErrors, screenshot, userId,
      // Campos del flujo reportes (humano o IA):
      steps, codeHints, severity, workspaceId, reporterKind,
    } = req.body;

    if (!description || typeof description !== "string" || description.trim().length === 0) {
      return res.status(400).json({ success: false, error: "description is required" });
    }
    if (description.length > 5000) {
      return res.status(400).json({ success: false, error: "description too long (max 5000 chars)" });
    }

    const sb = getSupabase();
    if (!sb) {
      return res.status(500).json({ success: false, error: "Supabase not configured" });
    }

    // Handle base64 screenshot upload
    let screenshotUrl: string | null = null;
    if (screenshot && typeof screenshot === "string" && screenshot.startsWith("data:image/")) {
      try {
        const adminSb = getSupabaseAdmin() || sb;
        const [mimePart, dataPart] = screenshot.split(",");
        const mime = (mimePart.match(/data:([^;]+)/) || [])[1] || "image/png";
        const ext = mime.split("/")[1] || "png";
        const buf = Buffer.from(dataPart, "base64");
        const key = `bug-${uuid().slice(0, 12)}.${ext}`;

        const { error: uploadErr } = await adminSb.storage
          .from("bug-screenshots")
          .upload(key, buf, { contentType: mime, upsert: true });

        if (!uploadErr) {
          const { data: urlData } = adminSb.storage.from("bug-screenshots").getPublicUrl(key);
          screenshotUrl = urlData?.publicUrl || null;
        }
      } catch (uploadError: any) {
        console.error("Screenshot upload failed:", uploadError.message);
        // Non-blocking: save report even if screenshot upload fails
      }
    }

    const row: Record<string, unknown> = {
      description: description.trim(),
      url: url || null,
      device_info: deviceInfo || {},
      console_errors: consoleErrors || [],
      screenshot_url: screenshotUrl,
    };
    if (userId) row.user_id = userId;
    if (typeof steps === "string" && steps.trim()) row.steps = steps.slice(0, 20000);
    if (typeof codeHints === "string" && codeHints.trim()) row.code_hints = codeHints.slice(0, 20000);
    if (typeof severity === "string" && (BUG_SEVERITIES as readonly string[]).includes(severity)) row.severity = severity;
    // workspace_id es text en la base (ids de workspace con prefijo, p.ej.
    // ws_user_…) — NO exigir formato uuid: solo un string saneado no vacío.
    if (typeof workspaceId === "string" && workspaceId.trim()) row.workspace_id = workspaceId.trim().slice(0, 64);
    if (reporterKind === "ia") row.reporter_kind = "ia";

    const { data, error } = await sb.from("bug_reports").insert(row).select("id").single();

    if (error) {
      console.error("bug_reports insert failed:", error);
      return res.status(500).json({ success: false, error: "Failed to save bug report" });
    }

    return res.status(201).json({ success: true, data: { id: data.id, screenshotUrl } });
  } catch (err: any) {
    console.error("bug_reports route error:", err);
    return res.status(500).json({ success: false, error: err.message || "Internal error" });
  }
});

// GET /api/bug-reports — requires auth (service_role or logged-in user)
// Filtros opcionales: ?status=nuevo&reporterKind=ia&severity=alta&workspaceId=...&limit=200
bugReportRoutes.get("/", async (req, res) => {
  try {
    const sb = getSupabase();
    if (!sb) return res.status(500).json({ success: false, error: "Supabase not configured" });

    let query = sb.from("bug_reports").select("*").order("created_at", { ascending: false });
    const status = typeof req.query.status === "string" ? req.query.status : "";
    if ((BUG_STATUSES as readonly string[]).includes(status)) query = query.eq("status", status);
    const reporterKind = typeof req.query.reporterKind === "string" ? req.query.reporterKind : "";
    if (reporterKind === "ia" || reporterKind === "humano") query = query.eq("reporter_kind", reporterKind);
    const severity = typeof req.query.severity === "string" ? req.query.severity : "";
    if ((BUG_SEVERITIES as readonly string[]).includes(severity)) query = query.eq("severity", severity);
    const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : "";
    if (workspaceId.trim()) query = query.eq("workspace_id", workspaceId.trim());
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 100;
    query = query.limit(limit);

    const { data, error } = await query;
    if (error) {
      return res.status(500).json({ success: false, error: "Failed to fetch bug reports" });
    }

    return res.json({ success: true, data, total: data.length });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/bug-reports/:id/status — cambia el estado del reporte
// (nuevo → en_progreso → corregido | descartado). Permiso: admin,
// editor del workspace del reporte, o el usuario que lo creó.
bugReportRoutes.patch("/:id/status", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const { status, fixNotes } = req.body || {};
    if (!(BUG_STATUSES as readonly string[]).includes(status)) {
      return res.status(400).json({ success: false, error: `status must be one of: ${BUG_STATUSES.join(", ")}` });
    }
    if (fixNotes !== undefined && (typeof fixNotes !== "string" || fixNotes.length > 5000)) {
      return res.status(400).json({ success: false, error: "fixNotes too long (max 5000 chars)" });
    }
    const authCtx = req.auth;
    if (!authCtx || authCtx.authType === "dev" && authCtx.userId === "anonymous") {
      return res.status(401).json({ success: false, error: "Authentication required to update report status" });
    }

    const sb = getSupabaseAdmin() || getSupabase();
    if (!sb) return res.status(500).json({ success: false, error: "Supabase not configured" });

    const { data: row, error: fetchErr } = await sb
      .from("bug_reports")
      .select("id, user_id, workspace_id, status")
      .eq("id", id)
      .maybeSingle();
    if (fetchErr) return res.status(500).json({ success: false, error: "Failed to fetch bug report" });
    if (!row) return res.status(404).json({ success: false, error: "Bug report not found" });

    const allowed =
      authCtx.isAdmin === true ||
      (!!row.workspace_id && (await canAccessWorkspace(authCtx, row.workspace_id, "editor"))) ||
      (!!row.user_id && row.user_id === authCtx.userId);
    if (!allowed) return res.status(403).json({ success: false, error: "Not allowed to update this report" });

    const patch: Record<string, unknown> = {
      status,
      resolved_at: status === "corregido" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    if (typeof fixNotes === "string" && fixNotes.trim()) patch.fix_notes = fixNotes.trim();

    const { data, error } = await sb.from("bug_reports").update(patch).eq("id", id).select().single();
    if (error) {
      console.error("bug_reports status update failed:", error);
      return res.status(500).json({ success: false, error: "Failed to update bug report" });
    }

    return res.json({ success: true, data });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
