/**
 * Video Projects API — REQ-VID10: superficie REST del módulo Video standalone
 * (modelo CapCut) para el HUMANO (UI drag & drop). La IA edita lo mismo vía
 * MCP tools video_*; ambos consumers pasan por api/src/services/videoProjects.ts
 * (mismas tablas musa_video_*, mismos validadores, cero drift).
 *
 * TODO el tiempo viaja en MICROSEGUNDOS — la API nunca acepta ni devuelve
 * segundos (regla dura del formato).
 *
 *   GET    /api/video-projects?workspaceId=&templatesOnly=     → lista
 *   POST   /api/video-projects                                  → crea
 *   GET    /api/video-projects/:projectId                       → árbol completo
 *   DELETE /api/video-projects/:projectId                       → borra (cascada)
 *   POST   /api/video-projects/:projectId/tracks                → agrega pista
 *   POST   /api/video-projects/:projectId/materials             → agrega material
 *   POST   /api/video-projects/:projectId/segments              → agrega clip
 *   PATCH  /api/video-projects/:projectId/segments/:segmentId   → move/trim/transform
 *   DELETE /api/video-projects/:projectId/segments/:segmentId   → borra clip
 *   POST   /api/video-projects/:projectId/effects               → companion de efecto
 *   POST   /api/video-projects/:projectId/register-template     → VID13 slots
 *   POST   /api/video-projects/:projectId/instantiate           → VID13 instancia
 */

import { Router } from "express";
import type { Request, Response } from "express";
import {
  VideoProjectError,
  addVideoMaterial,
  addVideoSegment,
  addVideoTrack,
  applyVideoEffect,
  createVideoProject,
  deleteVideoProject,
  deleteVideoSegment,
  getVideoProjectTree,
  instantiateVideoTemplate,
  listVideoProjects,
  moveVideoSegment,
  registerVideoTemplate,
  transformVideoSegment,
  trimVideoSegment,
} from "../services/videoProjects.js";
import { canAccessWorkspace } from "../services/tenancy.js";
import type { VideoProjectTree } from "../services/videoProjects.js";

export const videoProjectRoutes = Router();

/** Auth + tenant gate común: el tenant viene del ROW del project (no del
 *  input) — una key/sesión no cruza workspaces aunque conozca el id. Devuelve
 *  el árbol ya leído para que la ruta no lo pida otra vez. */
async function gate(req: Request, res: Response, minimum: "viewer" | "editor"): Promise<VideoProjectTree | null> {
  if (!req.auth) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return null;
  }
  const projectId = String(req.params.projectId || "").trim();
  if (!projectId) {
    res.status(400).json({ success: false, error: "projectId is required" });
    return null;
  }
  const tree = await getVideoProjectTree(projectId);
  if (!tree) {
    res.status(404).json({ success: false, error: "Video project not found" });
    return null;
  }
  if (!(await canAccessWorkspace(req.auth, tree.project.workspace_id, minimum))) {
    res.status(403).json({ success: false, error: "You do not have access to this workspace" });
    return null;
  }
  return tree;
}

/** VideoProjectError → HTTP con código estable; resto → 500. */
function fail(res: Response, cause: unknown): void {
  if (cause instanceof VideoProjectError) {
    res.status(cause.status).json({ success: false, error: cause.message, code: cause.code });
    return;
  }
  console.error("[video-projects] error:", cause instanceof Error ? cause.message : cause);
  res.status(500).json({ success: false, error: cause instanceof Error ? cause.message : "Video project operation failed" });
}

// ── Projects ────────────────────────────────────────────────────────────────

videoProjectRoutes.get("/", async (req, res) => {
  try {
    if (!req.auth) return void res.status(401).json({ success: false, error: "Authentication required" });
    const workspaceId = String(req.query.workspaceId || "").trim();
    if (!workspaceId) return void res.status(400).json({ success: false, error: "workspaceId is required" });
    if (!(await canAccessWorkspace(req.auth, workspaceId, "viewer"))) {
      return void res.status(403).json({ success: false, error: "You do not have access to this workspace" });
    }
    const projects = await listVideoProjects(workspaceId, { templatesOnly: req.query.templatesOnly === "true" });
    res.json({ success: true, data: { projects, total: projects.length } });
  } catch (cause) {
    fail(res, cause);
  }
});

videoProjectRoutes.post("/", async (req, res) => {
  try {
    if (!req.auth) return void res.status(401).json({ success: false, error: "Authentication required" });
    const workspaceId = String(req.body?.workspaceId || "").trim();
    if (!workspaceId) return void res.status(400).json({ success: false, error: "workspaceId is required" });
    if (!(await canAccessWorkspace(req.auth, workspaceId, "editor"))) {
      return void res.status(403).json({ success: false, error: "Editor role required" });
    }
    const project = await createVideoProject(workspaceId, {
      name: req.body?.name,
      fps: req.body?.fps,
      canvasW: req.body?.canvasW,
      canvasH: req.body?.canvasH,
      ratio: req.body?.ratio,
    }, "user");
    res.status(201).json({ success: true, data: { project } });
  } catch (cause) {
    fail(res, cause);
  }
});

videoProjectRoutes.get("/:projectId", async (req, res) => {
  try {
    const tree = await gate(req, res, "viewer");
    if (!tree) return;
    res.json({ success: true, data: { ...tree, note: "TODO en µs (1s = 1000000)." } });
  } catch (cause) {
    fail(res, cause);
  }
});

videoProjectRoutes.delete("/:projectId", async (req, res) => {
  try {
    if (!(await gate(req, res, "editor"))) return;
    await deleteVideoProject(String(req.params.projectId));
    res.json({ success: true, data: { projectId: req.params.projectId, deleted: true } });
  } catch (cause) {
    fail(res, cause);
  }
});

// ── Tracks / materials ──────────────────────────────────────────────────────

videoProjectRoutes.post("/:projectId/tracks", async (req, res) => {
  try {
    if (!(await gate(req, res, "editor"))) return;
    const track = await addVideoTrack(String(req.params.projectId), { type: req.body?.type, zOrder: req.body?.zOrder });
    res.status(201).json({ success: true, data: { track } });
  } catch (cause) {
    fail(res, cause);
  }
});

videoProjectRoutes.post("/:projectId/materials", async (req, res) => {
  try {
    if (!(await gate(req, res, "editor"))) return;
    const material = await addVideoMaterial(String(req.params.projectId), {
      kind: req.body?.kind,
      payload: req.body?.payload,
      slot: req.body?.slot,
    }, "user");
    res.status(201).json({ success: true, data: { material } });
  } catch (cause) {
    fail(res, cause);
  }
});

// ── Segments (el camino caliente del drag: PATCH por operación) ─────────────

videoProjectRoutes.post("/:projectId/segments", async (req, res) => {
  try {
    if (!(await gate(req, res, "editor"))) return;
    const segment = await addVideoSegment({
      projectId: String(req.params.projectId),
      trackId: String(req.body?.trackId || ""),
      materialId: String(req.body?.materialId || ""),
      targetStartUs: req.body?.targetStartUs,
      targetDurUs: req.body?.targetDurUs,
      sourceStartUs: req.body?.sourceStartUs,
      sourceDurUs: req.body?.sourceDurUs,
      speed: req.body?.speed,
      clip: req.body?.clip,
      extraRefs: Array.isArray(req.body?.extraRefs) ? req.body.extraRefs : [],
    });
    res.status(201).json({ success: true, data: { segment } });
  } catch (cause) {
    fail(res, cause);
  }
});

/** PATCH = move (targetStartUs) | trim (sourceStartUs/sourceDurUs) |
 *  transform (clip) — combinables; cada campo presente dispara su operación. */
videoProjectRoutes.patch("/:projectId/segments/:segmentId", async (req, res) => {
  try {
    const gateTree = await gate(req, res, "editor");
    if (!gateTree) return;
    const projectId = gateTree.project.id;
    const segmentId = String(req.params.segmentId || "");
    const body = req.body || {};
    let segment = null;
    if (body.targetStartUs !== undefined) {
      segment = await moveVideoSegment(projectId, segmentId, body.targetStartUs);
    }
    if (body.sourceStartUs !== undefined || body.sourceDurUs !== undefined) {
      segment = await trimVideoSegment(projectId, segmentId, {
        sourceStartUs: body.sourceStartUs,
        sourceDurUs: body.sourceDurUs,
      });
    }
    if (body.clip !== undefined) {
      segment = await transformVideoSegment(projectId, segmentId, body.clip);
    }
    if (!segment) {
      return void res.status(400).json({ success: false, error: "Nada que aplicar: manda targetStartUs (move), sourceStartUs/sourceDurUs (trim) o clip (transform)" });
    }
    res.json({ success: true, data: { segment } });
  } catch (cause) {
    fail(res, cause);
  }
});

videoProjectRoutes.delete("/:projectId/segments/:segmentId", async (req, res) => {
  try {
    const gateTree = await gate(req, res, "editor");
    if (!gateTree) return;
    const projectId = gateTree.project.id;
    await deleteVideoSegment(projectId, String(req.params.segmentId));
    res.json({ success: true, data: { segmentId: req.params.segmentId, deleted: true } });
  } catch (cause) {
    fail(res, cause);
  }
});

// ── Efectos / Templates ─────────────────────────────────────────────────────

videoProjectRoutes.post("/:projectId/effects", async (req, res) => {
  try {
    const gateTree = await gate(req, res, "editor");
    if (!gateTree) return;
    const projectId = gateTree.project.id;
    const result = await applyVideoEffect(projectId, {
      segmentId: req.body?.segmentId,
      trackId: req.body?.trackId,
      effectId: req.body?.effectId,
      manifest: req.body?.manifest,
      params: req.body?.params,
    }, "user");
    res.status(201).json({ success: true, data: result });
  } catch (cause) {
    fail(res, cause);
  }
});

videoProjectRoutes.post("/:projectId/register-template", async (req, res) => {
  try {
    const gateTree = await gate(req, res, "editor");
    if (!gateTree) return;
    const projectId = gateTree.project.id;
    const project = await registerVideoTemplate(projectId, Array.isArray(req.body?.slots) ? req.body.slots : []);
    res.json({ success: true, data: { project } });
  } catch (cause) {
    fail(res, cause);
  }
});

videoProjectRoutes.post("/:projectId/instantiate", async (req, res) => {
  try {
    const gateTree = await gate(req, res, "editor");
    if (!gateTree) return;
    const projectId = gateTree.project.id;
    const tree = await instantiateVideoTemplate(projectId, {
      name: req.body?.name,
      slots: req.body?.slots && typeof req.body.slots === "object" ? req.body.slots : {},
    }, "user");
    res.status(201).json({ success: true, data: tree });
  } catch (cause) {
    fail(res, cause);
  }
});
