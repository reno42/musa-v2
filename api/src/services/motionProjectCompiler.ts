/**
 * MotionSpec → standalone video project persistence.
 *
 * This service is intentionally the only bridge between the portable
 * `shared/motionSpec.ts` contract and the relational `musa_video_*` model.
 * It has no renderer responsibilities: the editor/browser retain one visual
 * runtime, while this module gives the harness idempotent, tenant-scoped
 * persistence and a conservative human-change conflict policy.
 */

import {
  MUSA_MOTION_SPEC_VERSION,
  buildMotionApplyPlan,
  diffMotionSpecs,
  mergeMotionPlanFidelity,
  motionSpecHash,
  normalizeMotionSpec,
  type MotionApplyPlan,
  type MotionEditability,
  type MotionFidelityReport,
  type MotionSpecDiff,
  type MusaMotionSpec,
} from "../../../shared/motionSpec.ts";
import { getSupabaseAdmin } from "./supabase.ts";
import {
  VideoProjectError,
  createVideoProject,
  deleteVideoProject,
  getVideoProjectTree,
  type VideoProjectRow,
} from "./videoProjects.ts";

export type MotionSourceKind =
  | "musa"
  | "musa-js"
  | "hyperframes-subset"
  | "remotion-subset"
  | "html-css-keyframes";

export interface MotionSpecRow {
  id: string;
  project_id: string;
  workspace_id: string;
  schema_version: string;
  source_kind: MotionSourceKind;
  source_spec: MusaMotionSpec;
  normalized_spec: MusaMotionSpec;
  source_hash: string;
  revision: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface MotionBindingRow {
  id: string;
  motion_spec_id: string;
  project_id: string;
  node_id: string;
  node_kind: string;
  entity_kind: "track" | "material" | "segment" | "effect" | "transition";
  entity_id: string;
  editability: MotionEditability;
  source_hash: string;
  last_applied_revision: number;
  human_modified_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface MotionPersistencePlan {
  project: {
    name?: string;
    fps: number;
    canvasW: number;
    canvasH: number;
    ratio: string;
  };
  tracks: Array<{ id: string; type: string; zOrder: number }>;
  materials: Array<{ id: string; nodeId: string; kind: string; payload: Record<string, unknown>; slot?: unknown }>;
  segments: Array<{
    id: string;
    nodeId: string;
    trackId: string;
    materialId: string;
    targetStartUs: number;
    targetDurUs: number;
    sourceStartUs?: number;
    sourceDurUs?: number;
    speed?: number;
    clip?: unknown;
    extraRefs?: string[];
  }>;
  bindings: Array<{
    nodeId: string;
    nodeKind: string;
    entityKind: MotionBindingRow["entity_kind"];
    entityId: string;
    editability: MotionEditability;
    metadata?: Record<string, unknown>;
  }>;
}

export interface MotionSpecApplyResult {
  specId: string;
  projectId: string;
  revision: number;
  durationUs: number;
  conflicts: number;
  fingerprint: string;
  fidelity: MotionFidelityReport;
  warnings: Array<{ code: string; path: string; message: string }>;
}

export interface ApplyMotionSpecOptions {
  workspaceId: string;
  sourceKind?: MotionSourceKind;
  author?: string;
  expectedRevision?: number;
  overwriteHuman?: boolean;
}

function motionError(code: string, message: string, status = 400): VideoProjectError {
  return new VideoProjectError(code, message, status);
}

function sbClient() {
  const client = getSupabaseAdmin();
  if (!client) throw motionError("SUPABASE_NOT_CONFIGURED", "MotionSpec requiere Supabase configurado.", 503);
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

// REQ-052 v2 multi-tenant: el sufijo de efectos/transiciones también se scopea
// por projectId — dos proyectos con el mismo effect.id colisionaban en la PK.
function shortEntityId(prefix: string, projectId: string, seed: string): string {
  return `${prefix}${motionSpecHash({ seed: `${projectId}:${seed}` }).slice(-16)}`;
}

function nodeMap(spec: MusaMotionSpec): Map<string, MusaMotionSpec["nodes"][number]> {
  return new Map(spec.nodes.map((node) => [node.id, node]));
}

/**
 * Converts the shared plan into the JSON shape consumed by the transactional
 * SQL RPC. It remains pure so it can be tested without a Supabase account.
 */
export function motionPlanToPersistencePlan(spec: MusaMotionSpec, projectId: string, plan: MotionApplyPlan = buildMotionApplyPlan(spec, projectId)): MotionPersistencePlan {
  const nodes = nodeMap(spec);
  const segments: MotionPersistencePlan["segments"] = plan.segments.map((segment) => ({
    ...segment,
    speed: 1,
    extraRefs: [] as string[],
  }));
  // Preserve the coordinate system alongside the declarative keyframes. The
  // video player/exporter can then scale x/y from the generated composition
  // to the actual project canvas without guessing whether a value is pixels
  // or a normalized clip transform.
  const materials: MotionPersistencePlan["materials"] = plan.materials.map((material) => ({
    ...material,
    payload: {
      ...material.payload,
      motionCanvas: { width: spec.canvas.width, height: spec.canvas.height },
    },
  }));
  const bindings: MotionPersistencePlan["bindings"] = [];

  for (const track of plan.tracks) {
    bindings.push({
      nodeId: `track:${track.id}`,
      nodeKind: "track",
      entityKind: "track",
      entityId: track.id,
      editability: "editable",
      metadata: { type: track.type, zOrder: track.zOrder },
    });
  }

  for (const binding of plan.bindings) {
    const node = nodes.get(binding.nodeId);
    if (!node) continue;
    bindings.push({
      nodeId: binding.nodeId,
      nodeKind: node.kind,
      entityKind: "material",
      entityId: binding.materialId,
      editability: node.editability,
    });
    bindings.push({
      nodeId: binding.nodeId,
      nodeKind: node.kind,
      entityKind: "segment",
      entityId: binding.segmentId,
      editability: node.editability,
    });
  }

  const segmentForNode = new Map(segments.map((segment) => [segment.nodeId, segment]));
  for (const effect of plan.effects) {
    if (effect.editability === "unsupported") continue;
    const materialId = shortEntityId("vidmat_fx", projectId, effect.id);
    const effectPayload = {
      manifest: { name: effect.effectId, type: "MusaMotionEffect", zorder: 65 },
      params: effect.params || {},
      motionEffectId: effect.id,
      targetNodeId: effect.targetNodeId || null,
    };
    materials.push({ id: materialId, nodeId: `effect:${effect.id}`, kind: "effect", payload: effectPayload });
    if (effect.targetNodeId) {
      const target = segmentForNode.get(effect.targetNodeId);
      if (target && !target.extraRefs!.includes(materialId)) target.extraRefs!.push(materialId);
    } else {
      for (const target of segments) {
        if (!target.extraRefs!.includes(materialId)) target.extraRefs!.push(materialId);
      }
    }
    bindings.push({
      nodeId: `effect:${effect.id}`,
      nodeKind: "effect",
      entityKind: "effect",
      entityId: materialId,
      editability: effect.editability || "editable",
      metadata: { effectId: effect.effectId, targetNodeId: effect.targetNodeId || null },
    });
  }

  for (const transition of plan.transitions) {
    const materialId = shortEntityId("vidmat_tr", projectId, transition.id);
    materials.push({
      id: materialId,
      nodeId: `transition:${transition.id}`,
      kind: "transition",
      payload: {
        type: transition.type,
        durationUs: Math.round(transition.durationMs * 1_000),
        params: transition.params || {},
        fromNodeId: transition.fromNodeId || null,
        toNodeId: transition.toNodeId || null,
      },
    });
    const target = transition.toNodeId ? segmentForNode.get(transition.toNodeId) : undefined;
    if (target && !target.extraRefs!.includes(materialId)) target.extraRefs!.push(materialId);
    bindings.push({
      nodeId: `transition:${transition.id}`,
      nodeKind: "transition",
      entityKind: "transition",
      entityId: materialId,
      editability: "editable",
      metadata: { type: transition.type, fromNodeId: transition.fromNodeId || null, toNodeId: transition.toNodeId || null },
    });
  }

  return {
    project: {
      ...(spec.name ? { name: boundedText(spec.name) } : {}),
      fps: spec.canvas.fps,
      canvasW: spec.canvas.width,
      canvasH: spec.canvas.height,
      ratio: ratioFor(spec.canvas.width, spec.canvas.height),
    },
    tracks: plan.tracks.map((track) => ({ ...track })),
    materials,
    segments,
    bindings,
  };
}

export async function getMotionSpec(projectId: string): Promise<MotionSpecRow | null> {
  const sb = sbClient();
  const { data, error } = await sb
    .from("musa_motion_specs")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw motionError("MOTION_STORAGE", `No se pudo leer el MotionSpec: ${error.message}`, 503);
  return data as MotionSpecRow | null;
}

export async function getMotionBindings(projectId: string): Promise<MotionBindingRow[]> {
  const sb = sbClient();
  const { data, error } = await sb
    .from("musa_motion_bindings")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw motionError("MOTION_STORAGE", `No se pudieron leer los bindings: ${error.message}`, 503);
  return (data || []) as MotionBindingRow[];
}

export async function diffMotionProjectSpec(projectId: string, rawSpec: unknown): Promise<{
  current: MotionSpecRow | null;
  diff: MotionSpecDiff;
  fingerprint: string;
  fidelity: MotionFidelityReport;
  humanConflicts: MotionBindingRow[];
}> {
  const normalized = normalizeMotionSpec(rawSpec);
  if (!normalized.valid || !normalized.spec || !normalized.fingerprint) {
    const detail = normalized.issues.filter((issue) => issue.severity === "error").map((issue) => issue.code).join(", ");
    throw motionError("MOTION_SPEC_INVALID", detail || "MotionSpec inválido.");
  }
  const [current, bindings] = await Promise.all([getMotionSpec(projectId), getMotionBindings(projectId)]);
  const plan = buildMotionApplyPlan(normalized.spec, projectId);
  const humanConflicts = bindings.filter((binding) => binding.human_modified_at && binding.source_hash !== normalized.fingerprint);
  return {
    current,
    diff: diffMotionSpecs(current?.normalized_spec || null, normalized.spec),
    fingerprint: normalized.fingerprint,
    fidelity: mergeMotionPlanFidelity(normalized.fidelity, plan),
    humanConflicts,
  };
}

export async function applyMotionProjectSpec(
  projectId: string,
  rawSpec: unknown,
  options: ApplyMotionSpecOptions,
): Promise<MotionSpecApplyResult> {
  const normalized = normalizeMotionSpec(rawSpec);
  if (!normalized.valid || !normalized.spec || !normalized.fingerprint) {
    const detail = normalized.issues.filter((issue) => issue.severity === "error").map((issue) => issue.code).join(", ");
    throw motionError("MOTION_SPEC_INVALID", detail || "MotionSpec inválido.");
  }
  const tree = await getVideoProjectTree(projectId);
  if (!tree) throw motionError("NOT_FOUND", `Video project not found: ${projectId}`, 404);
  if (tree.project.workspace_id !== options.workspaceId) {
    throw motionError("MOTION_PROJECT_WORKSPACE_MISMATCH", "El proyecto no pertenece al workspace indicado.", 403);
  }
  const plan = buildMotionApplyPlan(normalized.spec, projectId);
  const persistencePlan = motionPlanToPersistencePlan(normalized.spec, projectId, plan);
  const sb = sbClient();
  const { data, error } = await sb.rpc("musa_apply_motion_spec", {
    p_project_id: projectId,
    p_workspace_id: options.workspaceId,
    p_source_kind: options.sourceKind || "musa",
    p_schema_version: MUSA_MOTION_SPEC_VERSION,
    p_source_spec: normalized.spec,
    p_normalized_spec: normalized.spec,
    p_source_hash: normalized.fingerprint,
    p_expected_revision: options.expectedRevision ?? null,
    p_author: options.author || "ai:musa",
    p_plan: persistencePlan,
    p_overwrite_human: options.overwriteHuman === true,
  });
  if (error) {
    const message = error.message || "No se pudo aplicar el MotionSpec.";
    const conflict = /MOTION_(REVISION|HUMAN)_CONFLICT/.test(message);
    throw motionError(conflict ? "MOTION_CONFLICT" : "MOTION_APPLY_FAILED", message, conflict ? 409 : 503);
  }
  const result = data as Record<string, unknown>;
  return {
    specId: String(result.specId || ""),
    projectId: String(result.projectId || projectId),
    revision: Number(result.revision || 0),
    durationUs: Number(result.durationUs || 0),
    conflicts: Number(result.conflicts || 0),
    fingerprint: normalized.fingerprint,
    fidelity: mergeMotionPlanFidelity(normalized.fidelity, plan),
    warnings: normalized.issues
      .filter((issue) => issue.severity === "warning")
      .map(({ code, path, message }) => ({ code, path, message })),
  };
}

/** Create then immediately apply a MotionSpec. If the transactional apply
 * fails, callers can safely delete the empty project; the MCP surface performs
 * that cleanup so no partial project survives an error. */
export async function createMotionProjectFromSpec(
  rawSpec: unknown,
  options: Omit<ApplyMotionSpecOptions, "expectedRevision"> & { name?: string },
): Promise<{ project: VideoProjectRow; result: MotionSpecApplyResult }> {
  const normalized = normalizeMotionSpec(rawSpec);
  if (!normalized.valid || !normalized.spec) {
    const detail = normalized.issues.filter((issue) => issue.severity === "error").map((issue) => issue.code).join(", ");
    throw motionError("MOTION_SPEC_INVALID", detail || "MotionSpec inválido.");
  }
  const spec = normalized.spec;
  const project = await createVideoProject(options.workspaceId, {
    name: boundedText(options.name || spec.name || "Motion generado por Musa"),
    fps: spec.canvas.fps,
    canvasW: spec.canvas.width,
    canvasH: spec.canvas.height,
    ratio: ratioFor(spec.canvas.width, spec.canvas.height),
    durationUs: Math.round(spec.canvas.durationMs * 1_000),
  }, options.author || "ai:musa");
  try {
    const result = await applyMotionProjectSpec(project.id, spec, options);
    return { project, result };
  } catch (error) {
    // The first INSERT happens before the SQL RPC knows the generated project
    // id. Best-effort cleanup preserves the same all-or-nothing result for a
    // new project without hiding the original apply failure.
    await deleteVideoProject(project.id).catch(() => undefined);
    throw error;
  }
}

/** Called after a human alters a generated material/segment/effect. */
export async function markMotionBindingHumanModified(
  projectId: string,
  entityKind: MotionBindingRow["entity_kind"],
  entityId: string,
): Promise<number> {
  const sb = sbClient();
  const { data, error } = await sb.rpc("musa_mark_motion_binding_human_modified", {
    p_project_id: projectId,
    p_entity_kind: entityKind,
    p_entity_id: entityId,
  });
  if (error) throw motionError("MOTION_STORAGE", `No se pudo registrar el cambio humano: ${error.message}`, 503);
  return Number(data || 0);
}
