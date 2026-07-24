import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import {
  createVersion,
  listVersions,
  getVersionMeta,
  getVersionPayload,
  restoreVersion,
  deleteVersion,
  diffVersions,
} from "../services/versionHistory.js";

export const versionRoutes = Router();

/**
 * Who is producing this change. Agents identify themselves with an explicit
 * `author` (or the x-agent-name header) so the history can distinguish Lara
 * from Claude Opus from the person at the keyboard; a signed-in human falls
 * back to their user id.
 */
function resolveAuthor(req: Request): string {
  const explicit = (req.body?.author || req.headers["x-agent-name"]) as string | undefined;
  if (explicit) {
    const name = String(explicit).trim().slice(0, 80);
    return name.includes(":") ? name : `agent:${name}`;
  }
  const auth = req.auth;
  if (auth?.authType === "user" && auth.userId) return `human:${auth.userId}`;
  if (auth?.authType === "workspace_key") return `agent:workspace-key`;
  return "human:local";
}

const createSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  kind: z.enum(["auto", "marked"]).optional(),
  author: z.string().max(80).optional(),
});

/**
 * POST /api/templates/:id/versions — snapshot the design's current state.
 * Ctrl/Cmd+S and the Save button send kind:"marked" so the version is kept
 * forever; automatic saves send kind:"auto" and rotate.
 */
versionRoutes.post("/:id/versions", validate(createSchema), async (req, res) => {
  try {
    const version = await createVersion(req.params.id, {
      kind: req.body?.kind === "auto" ? "auto" : "marked",
      label: req.body?.label,
      author: resolveAuthor(req),
    });
    if (!version) {
      return res.status(503).json({
        success: false,
        error: "Version history unavailable (Supabase not configured or template missing)",
      });
    }
    res.status(201).json({ success: true, data: version });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /api/templates/:id/versions — metadata only; payloads stay in storage. */
versionRoutes.get("/:id/versions", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const data = await listVersions(req.params.id, limit);
    res.json({ success: true, data, total: data.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/templates/:id/versions/:versionId — full payload.
 * Pass ?meta=1 for the metadata row without downloading the frames.
 */
versionRoutes.get("/:id/versions/:versionId", async (req, res) => {
  try {
    const meta = await getVersionMeta(req.params.versionId);
    if (!meta) return res.status(404).json({ success: false, error: "Version not found" });
    if (req.query.meta) return res.json({ success: true, data: meta });
    const payload = await getVersionPayload(req.params.versionId);
    if (!payload) return res.status(404).json({ success: false, error: "Version payload missing" });
    res.json({ success: true, data: { ...meta, ...payload } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/templates/:id/versions/:versionId/diff — what changed, per frame.
 * ?to=<versionId> compares two stored versions; omitted compares against the
 * live design. ?frameId=<id> narrows it to one frame.
 */
versionRoutes.get("/:id/versions/:versionId/diff", async (req, res) => {
  try {
    const diff = await diffVersions(
      req.params.id,
      req.params.versionId,
      (req.query.to as string) || undefined,
      (req.query.frameId as string) || undefined,
    );
    if (!diff) return res.status(404).json({ success: false, error: "Version not found" });
    res.json({ success: true, data: diff });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /api/templates/:id/versions/:versionId/restore — restore all frames. */
versionRoutes.post("/:id/versions/:versionId/restore", async (req, res) => {
  try {
    const restored = await restoreVersion(req.params.id, req.params.versionId, resolveAuthor(req));
    if (!restored) return res.status(404).json({ success: false, error: "Version not found" });
    res.json({ success: true, data: restored });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

versionRoutes.delete("/:id/versions/:versionId", async (req, res) => {
  try {
    const ok = await deleteVersion(req.params.versionId);
    if (!ok) return res.status(404).json({ success: false, error: "Version not found" });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
