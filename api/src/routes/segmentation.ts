import { Router } from "express";
import { getSupabase, uploadAsset } from "../services/supabase.js";
import { canAccessWorkspace } from "../services/tenancy.js";
import {
  createSegmentJob,
  dispatchSegmentJob,
  findExistingCutout,
  getSegmentJob,
} from "../services/segmentation.js";
import { normalizeSegmentBox, normalizeSegmentPoints } from "../../../shared/segmentPoints.ts";

export const segmentationRoutes = Router();

type SegmentInputResolution =
  | { ok: true; inputUrl: string; sourceAssetId: string | null; sourceName: string }
  | { ok: false; status: number; error: string };

/**
 * Resolves a job's input image URL from { assetId | url | dataUrl } — the
 * same contract as remove-background minus its cutout idempotency (click
 * jobs are prompt-specific and always re-run). Returns an HTTP error
 * descriptor instead of throwing so the caller can answer with the right
 * status code.
 */
async function resolveSegmentInput(body: Record<string, unknown>): Promise<SegmentInputResolution> {
  const { assetId, url, dataUrl, workspaceId, name } = body;
  if (assetId) {
    const sb = getSupabase();
    if (!sb) return { ok: false, status: 503, error: "Supabase not configured" };
    const { data: asset, error } = await sb.from("assets")
      .select("id, name, url, workspace_id")
      .eq("id", assetId)
      .maybeSingle();
    if (error) return { ok: false, status: 500, error: error.message };
    if (!asset) return { ok: false, status: 404, error: "Asset not found" };
    if (asset.workspace_id && asset.workspace_id !== workspaceId) {
      return { ok: false, status: 403, error: "Asset belongs to another workspace" };
    }
    return {
      ok: true,
      inputUrl: asset.url,
      sourceAssetId: asset.id,
      sourceName: (name as string) || asset.name || "",
    };
  }
  if (dataUrl) {
    // Inline image → store it as a workspace asset first. That gives the
    // job a bucket URL (CORS-clean) and the same src:<id> provenance.
    const matches = String(dataUrl).match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
    if (!matches) return { ok: false, status: 400, error: "Invalid dataUrl format" };
    const mimeType = matches[1];
    const imageBuffer = Buffer.from(matches[2], "base64");
    if (imageBuffer.length > 5 * 1024 * 1024) {
      return { ok: false, status: 413, error: "La imagen supera el límite de 5MB" };
    }
    const id = `asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const ext = mimeType.split("/")[1] === "svg+xml" ? "svg" : mimeType.split("/")[1] || "png";
    const filename = `${id}.${ext}`;
    const publicUrl = await uploadAsset(filename, imageBuffer, mimeType, workspaceId as string);
    const sb = getSupabase();
    if (sb) {
      const { error } = await sb.from("assets").upsert({
        id, name: name || "Imagen", filename,
        mime_type: mimeType, size_bytes: imageBuffer.length,
        url: publicUrl, tags: [], workspace_id: workspaceId,
      });
      if (error) return { ok: false, status: 500, error: error.message };
    }
    return { ok: true, inputUrl: publicUrl, sourceAssetId: id, sourceName: (name as string) || "Imagen" };
  }
  const trimmed = String(url || "").trim();
  if (!/^https?:\/\//i.test(trimmed)) return { ok: false, status: 400, error: "url must be http(s)" };
  return { ok: true, inputUrl: trimmed, sourceAssetId: null, sourceName: (name as string) || "" };
}

/**
 * POST /api/segment/remove-background
 * Body: { assetId | url | dataUrl, workspaceId, name? }
 *
 * Creates a queued segment_jobs row (kind=remove_background, u2netp) and
 * dispatches the image-segment-background BACKGROUND function — Netlify
 * answers 202 immediately, the inference runs up to 15 min in background.
 * The caller polls GET /api/segment/jobs/:id.
 *
 * Idempotency: an asset already tagged ["cutout", "src:<assetId>"] in
 * this workspace is returned as-is (no re-processing, no new job).
 */
segmentationRoutes.post("/remove-background", async (req, res) => {
  try {
    const { assetId, url, dataUrl, workspaceId, name } = req.body || {};
    if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
    if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "editor"))) {
      return res.status(403).json({ success: false, error: "Editor access to the workspace is required" });
    }
    if (!assetId && !url && !dataUrl) {
      return res.status(400).json({ success: false, error: "Provide assetId, url or dataUrl" });
    }

    let inputUrl = "";
    let sourceAssetId: string | null = null;
    let sourceName = name || "";

    if (assetId) {
      const sb = getSupabase();
      if (!sb) return res.status(503).json({ success: false, error: "Supabase not configured" });
      const { data: asset, error } = await sb.from("assets")
        .select("id, name, url, workspace_id")
        .eq("id", assetId)
        .maybeSingle();
      if (error) throw error;
      if (!asset) return res.status(404).json({ success: false, error: "Asset not found" });
      if (asset.workspace_id && asset.workspace_id !== workspaceId) {
        return res.status(403).json({ success: false, error: "Asset belongs to another workspace" });
      }
      inputUrl = asset.url;
      const resolvedAssetId: string = asset.id;
      sourceAssetId = resolvedAssetId;
      sourceName = name || asset.name || "";

      // Idempotency: reuse the existing derived cutout when there is one.
      const existing = await findExistingCutout(workspaceId, resolvedAssetId);
      if (existing) {
        return res.json({ success: true, idempotent: true, result: { ...existing, engine: "u2netp" } });
      }
    } else if (dataUrl) {
      // Inline image → store it as a workspace asset first. That gives the
      // job a bucket URL (CORS-clean) and the same src:<id> idempotency.
      const matches = String(dataUrl).match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
      if (!matches) return res.status(400).json({ success: false, error: "Invalid dataUrl format" });
      const mimeType = matches[1];
      const imageBuffer = Buffer.from(matches[2], "base64");
      if (imageBuffer.length > 5 * 1024 * 1024) {
        return res.status(413).json({ success: false, error: "La imagen supera el límite de 5MB" });
      }
      const id = `asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const ext = mimeType.split("/")[1] === "svg+xml" ? "svg" : mimeType.split("/")[1] || "png";
      const filename = `${id}.${ext}`;
      const publicUrl = await uploadAsset(filename, imageBuffer, mimeType, workspaceId);
      const sb = getSupabase();
      if (sb) {
        const { error } = await sb.from("assets").upsert({
          id, name: name || "Imagen", filename,
          mime_type: mimeType, size_bytes: imageBuffer.length,
          url: publicUrl, tags: [], workspace_id: workspaceId,
        });
        if (error) throw error;
      }
      inputUrl = publicUrl;
      sourceAssetId = id;
      sourceName = name || "Imagen";
    } else {
      inputUrl = String(url || "").trim();
      if (!/^https?:\/\//i.test(inputUrl)) {
        return res.status(400).json({ success: false, error: "url must be http(s)" });
      }
    }

    const job = await createSegmentJob("remove_background", inputUrl, workspaceId, {
      sourceAssetId,
      sourceName,
    });
    const dispatch = await dispatchSegmentJob(job.id);
    return res.status(202).json({
      success: true,
      jobId: job.id,
      status: job.status,
      dispatched: dispatch.dispatched,
      ...(dispatch.dispatched ? {} : { dispatchError: dispatch.error }),
      pollUrl: `/api/segment/jobs/${job.id}`,
      hint: dispatch.dispatched
        ? undefined
        : "El job quedó queued; el sweep del background function lo procesará igual.",
    });
  } catch (err: any) {
    console.error("[segment] remove-background failed:", err?.message || err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/segment/click
 * Body: { assetId | url | dataUrl, workspaceId, points?: [{x,y,neg}],
 *        box?: {x,y,w,h}, imageWidth?, imageHeight?, name? }
 *
 * Creates a queued segment_jobs row (kind=segment_click, MobileSAM: one
 * encoder pass, then the decoder runs with every prompt point together) and
 * dispatches the image-segment-background BACKGROUND function (immediate
 * 202). Points/box are normalized 0..1 over the image; px coordinates are
 * accepted when imageWidth/imageHeight are given. The caller polls
 * GET /api/segment/jobs/:id.
 */
segmentationRoutes.post("/click", async (req, res) => {
  try {
    const body = req.body || {};
    const { workspaceId } = body;
    if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
    if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "editor"))) {
      return res.status(403).json({ success: false, error: "Editor access to the workspace is required" });
    }
    const points = normalizeSegmentPoints(body.points, body.imageWidth, body.imageHeight);
    const box = normalizeSegmentBox(body.box, body.imageWidth, body.imageHeight);
    if (!points && !box) {
      return res.status(400).json({
        success: false,
        error: "Provide points [{x,y,neg}] or box {x,y,w,h} — normalized 0..1, or px with imageWidth/imageHeight",
      });
    }
    const input = await resolveSegmentInput(body);
    if (!input.ok) return res.status(input.status).json({ success: false, error: input.error });

    const job = await createSegmentJob("segment_click", input.inputUrl, workspaceId, {
      points: points || [],
      ...(box ? { box } : {}),
      sourceAssetId: input.sourceAssetId,
      sourceName: input.sourceName,
    });
    const dispatch = await dispatchSegmentJob(job.id);
    return res.status(202).json({
      success: true,
      jobId: job.id,
      status: job.status,
      dispatched: dispatch.dispatched,
      ...(dispatch.dispatched ? {} : { dispatchError: dispatch.error }),
      pollUrl: `/api/segment/jobs/${job.id}`,
      hint: dispatch.dispatched
        ? undefined
        : "El job quedó queued; el sweep del background function lo procesará igual.",
    });
  } catch (err: any) {
    console.error("[segment] click failed:", err?.message || err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/segment/jobs/:id — poll a job. Fast enough for the ~8s MCP
 * poll loop; every read is one indexed select. Done jobs carry the full
 * result_json: cutoutUrl (PNG alpha), maskUrl, svgPath (boundary trace),
 * bbox, image dims.
 */
segmentationRoutes.get("/jobs/:id", async (req, res) => {
  try {
    const job = await getSegmentJob(req.params.id);
    if (!job) return res.status(404).json({ success: false, error: "Job not found" });
    if (job.workspace_id && (!req.auth || !(await canAccessWorkspace(req.auth, job.workspace_id, "viewer")))) {
      return res.status(403).json({ success: false, error: "Workspace access is required" });
    }
    res.json({
      success: true,
      jobId: job.id,
      status: job.status,
      kind: job.kind,
      ...(job.status === "done" ? { result: job.result_json } : {}),
      ...(job.status === "error" ? { error: job.error } : {}),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
