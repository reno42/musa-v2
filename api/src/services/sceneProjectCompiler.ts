/**
 * SceneSpec → standalone video project persistence (REQ-052).
 *
 * Bridge between the portable `shared/sceneSpec.ts` contract and the
 * relational `musa_video_*` model (mirrors motionProjectCompiler.ts). No
 * renderer responsibilities: the browser keeps one WebGL2 visual runtime,
 * while this module gives the harness idempotent, tenant-scoped persistence
 * with the same conservative human-change conflict policy as MotionSpec.
 */

import {
  MUSA_SCENE_SPEC_VERSION,
  buildSceneApplyPlan,
  diffSceneSpecs,
  mergeScenePlanFidelity,
  normalizeSceneSpec,
  resolveSceneSpecId,
  type MusaSceneSpec,
  type SceneApplyPlan,
  type SceneEditability,
  type SceneFidelityReport,
  type SceneSpecDiff,
} from "../../../shared/sceneSpec.ts";
import { getSupabaseAdmin } from "./supabase.ts";
import {
  VideoProjectError,
  createVideoProject,
  deleteVideoProject,
  getVideoProjectTree,
  type VideoProjectRow,
} from "./videoProjects.ts";

export type SceneSourceKind = "musa" | "musa-js" | "three-manifest-subset";

export interface SceneSpecRow {
  id: string;
  project_id: string;
  workspace_id: string;
  schema_version: string;
  source_kind: SceneSourceKind;
  source_spec: MusaSceneSpec;
  normalized_spec: MusaSceneSpec;
  source_hash: string;
  revision: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SceneBindingRow {
  id: string;
  scene_spec_id: string;
  project_id: string;
  node_id: string;
  node_kind: string;
  entity_kind: "track" | "material" | "segment";
  entity_id: string;
  editability: SceneEditability;
  source_hash: string;
  last_applied_revision: number;
  human_modified_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SceneSpecApplyResult {
  specId: string;
  projectId: string;
  revision: number;
  durationUs: number;
  conflicts: number;
  fingerprint: string;
  fidelity: SceneFidelityReport;
  warnings: Array<{ code: string; path: string; message: string }>;
}

export interface ApplySceneSpecOptions {
  workspaceId: string;
  sourceKind?: SceneSourceKind;
  author?: string;
  expectedRevision?: number;
  overwriteHuman?: boolean;
}

function sceneError(code: string, message: string, status = 400): VideoProjectError {
  return new VideoProjectError(code, message, status);
}

function sbClient() {
  const client = getSupabaseAdmin();
  if (!client) throw sceneError("SUPABASE_NOT_CONFIGURED", "SceneSpec requiere Supabase configurado.", 503);
  return client;
}

function boundedText(value: string, max = 120): string {
  return value.trim().slice(0, max);
}

function ratioFor(width: number, height: number): string {
  const gcd = (left: number, right: number): number => right ? gcd(right, left % right) : left;
  const divisor = gcd(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  return `${Math.round(width) / divisor}:${Math.round(height) / divisor}`;
}

function invalidSpecDetail(normalized: ReturnType<typeof normalizeSceneSpec>): string {
  return normalized.issues.filter((issue) => issue.severity === "error").map((issue) => issue.code).join(", ");
}

export async function getSceneSpec(projectId: string): Promise<SceneSpecRow | null> {
  const sb = sbClient();
  const { data, error } = await sb
    .from("musa_scene_specs")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw sceneError("SCENE_STORAGE", `No se pudo leer el SceneSpec: ${error.message}`, 503);
  return data as SceneSpecRow | null;
}

export async function getSceneBindings(projectId: string): Promise<SceneBindingRow[]> {
  const sb = sbClient();
  const { data, error } = await sb
    .from("musa_scene_bindings")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw sceneError("SCENE_STORAGE", `No se pudieron leer los bindings de escena: ${error.message}`, 503);
  return (data || []) as SceneBindingRow[];
}

export async function diffSceneProjectSpec(projectId: string, rawSpec: unknown): Promise<{
  current: SceneSpecRow | null;
  diff: SceneSpecDiff;
  fingerprint: string;
  sceneSpecId: string;
  fidelity: SceneFidelityReport;
  humanConflicts: SceneBindingRow[];
}> {
  const normalized = normalizeSceneSpec(rawSpec);
  if (!normalized.valid || !normalized.spec || !normalized.fingerprint) {
    throw sceneError("SCENE_SPEC_INVALID", invalidSpecDetail(normalized) || "SceneSpec inválido.");
  }
  const [current, bindings] = await Promise.all([getSceneSpec(projectId), getSceneBindings(projectId)]);
  const plan = buildSceneApplyPlan(normalized.spec, projectId);
  const humanConflicts = bindings.filter((binding) => binding.human_modified_at && binding.source_hash !== normalized.fingerprint);
  return {
    current,
    diff: diffSceneSpecs(current?.normalized_spec || null, normalized.spec),
    fingerprint: normalized.fingerprint,
    sceneSpecId: resolveSceneSpecId(normalized.spec),
    fidelity: mergeScenePlanFidelity(normalized.fidelity, plan),
    humanConflicts,
  };
}

export async function applySceneProjectSpec(
  projectId: string,
  rawSpec: unknown,
  options: ApplySceneSpecOptions,
): Promise<SceneSpecApplyResult> {
  const normalized = normalizeSceneSpec(rawSpec);
  if (!normalized.valid || !normalized.spec || !normalized.fingerprint) {
    throw sceneError("SCENE_SPEC_INVALID", invalidSpecDetail(normalized) || "SceneSpec inválido.");
  }
  const tree = await getVideoProjectTree(projectId);
  if (!tree) throw sceneError("NOT_FOUND", `Video project not found: ${projectId}`, 404);
  if (tree.project.workspace_id !== options.workspaceId) {
    throw sceneError("SCENE_PROJECT_WORKSPACE_MISMATCH", "El proyecto no pertenece al workspace indicado.", 403);
  }
  const plan: SceneApplyPlan = buildSceneApplyPlan(normalized.spec, projectId);
  const sb = sbClient();
  const { data, error } = await sb.rpc("musa_apply_scene_spec", {
    p_project_id: projectId,
    p_workspace_id: options.workspaceId,
    p_spec_id: plan.sceneSpecId,
    p_source_kind: options.sourceKind || "musa",
    p_schema_version: MUSA_SCENE_SPEC_VERSION,
    p_source_spec: normalized.spec,
    p_normalized_spec: normalized.spec,
    p_source_hash: normalized.fingerprint,
    p_expected_revision: options.expectedRevision ?? null,
    p_author: options.author || "ai:musa",
    p_plan: {
      project: {
        fps: String(plan.canvas.fps),
        canvasW: String(plan.canvas.width),
        canvasH: String(plan.canvas.height),
        ratio: ratioFor(plan.canvas.width, plan.canvas.height),
      },
      track: plan.track,
      material: plan.material,
      segment: plan.segment,
      bindings: plan.bindings,
    },
    p_overwrite_human: options.overwriteHuman === true,
  });
  if (error) {
    const message = error.message || "No se pudo aplicar el SceneSpec.";
    const conflict = /SCENE_(REVISION|HUMAN)_CONFLICT/.test(message);
    throw sceneError(conflict ? "SCENE_CONFLICT" : "SCENE_APPLY_FAILED", message, conflict ? 409 : 503);
  }
  const result = data as Record<string, unknown>;
  return {
    specId: String(result.specId || plan.sceneSpecId),
    projectId: String(result.projectId || projectId),
    revision: Number(result.revision || 0),
    durationUs: Number(result.durationUs || 0),
    conflicts: Number(result.conflicts || 0),
    fingerprint: normalized.fingerprint,
    fidelity: mergeScenePlanFidelity(normalized.fidelity, plan),
    warnings: normalized.issues
      .filter((issue) => issue.severity === "warning")
      .map(({ code, path, message }) => ({ code, path, message })),
  };
}

/** Create then immediately apply a SceneSpec. If the transactional apply
 * fails, the empty project is deleted so no partial project survives. */
export async function createSceneProjectFromSpec(
  rawSpec: unknown,
  options: Omit<ApplySceneSpecOptions, "expectedRevision"> & { name?: string },
): Promise<{ project: VideoProjectRow; result: SceneSpecApplyResult }> {
  const normalized = normalizeSceneSpec(rawSpec);
  if (!normalized.valid || !normalized.spec) {
    throw sceneError("SCENE_SPEC_INVALID", invalidSpecDetail(normalized) || "SceneSpec inválido.");
  }
  const spec = normalized.spec;
  const project = await createVideoProject(options.workspaceId, {
    name: boundedText(options.name || spec.name || "Escena 3D generada por Musa"),
    fps: spec.canvas.fps,
    canvasW: spec.canvas.width,
    canvasH: spec.canvas.height,
    ratio: ratioFor(spec.canvas.width, spec.canvas.height),
    durationUs: Math.round(spec.canvas.durationMs * 1_000),
  }, options.author || "ai:musa");
  try {
    const result = await applySceneProjectSpec(project.id, spec, options);
    return { project, result };
  } catch (error) {
    // Best-effort cleanup: same all-or-nothing result as motion creation,
    // without hiding the original apply failure.
    await deleteVideoProject(project.id).catch(() => undefined);
    throw error;
  }
}

/** Called after a human alters the generated track/material/segment. */
export async function markSceneBindingHumanModified(
  projectId: string,
  entityKind: SceneBindingRow["entity_kind"],
  entityId: string,
): Promise<number> {
  const sb = sbClient();
  const { data, error } = await sb.rpc("musa_mark_scene_binding_human_modified", {
    p_project_id: projectId,
    p_entity_kind: entityKind,
    p_entity_id: entityId,
  });
  if (error) throw sceneError("SCENE_STORAGE", `No se pudo registrar el cambio humano: ${error.message}`, 503);
  return Number(data || 0);
}
