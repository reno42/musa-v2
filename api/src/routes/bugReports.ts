import { Router } from "express";
import { v4 as uuid } from "uuid";
import { getSupabase, getSupabaseAdmin } from "../services/supabase.js";

export const bugReportRoutes = Router();

// POST /api/bug-reports — public, no auth required
bugReportRoutes.post("/", async (req, res) => {
  try {
    const { description, url, deviceInfo, consoleErrors, screenshot, userId } = req.body;

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
bugReportRoutes.get("/", async (_req, res) => {
  try {
    const sb = getSupabase();
    if (!sb) return res.status(500).json({ success: false, error: "Supabase not configured" });

    const { data, error } = await sb
      .from("bug_reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return res.status(500).json({ success: false, error: "Failed to fetch bug reports" });
    }

    return res.json({ success: true, data, total: data.length });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
