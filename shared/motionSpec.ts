/**
 * MusaMotionSpec v1 — a portable, declarative description of editable motion.
 *
 * This module deliberately has no DOM, storage, React or server dependencies.
 * The MCP harness, design-video mode and standalone video project compiler all
 * consume the same normalized document so that generated motion has one source
 * of truth before a person changes it in the editor.
 */

import { normalizeAnimation, type AnimationSchema } from "./animationSchema.ts";

export const MUSA_MOTION_SPEC_VERSION = "1.0" as const;

export const MOTION_NODE_KINDS = [
  "text", "image", "video", "audio", "sticker", "shape", "svg", "group",
] as const;

export type MotionNodeKind = (typeof MOTION_NODE_KINDS)[number];
export type MotionEditability = "editable" | "atomic" | "baked" | "unsupported";
export type MotionValue = string | number | boolean | null;

export const MOTION_PROPERTIES = [
  "opacity", "transform", "x", "y", "scale", "rotation", "filter", "color",
  "backgroundColor", "clipPath", "width", "height", "top", "left",
  // Typography stays declarative too. Keeping these in the portable grammar
  // means a generator can preserve the author's chosen family/weight instead
  // of flattening every animated text node to the editor default.
  "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing",
  "textAlign", "background", "borderRadius",
] as const;

export type MotionProperty = (typeof MOTION_PROPERTIES)[number];

export interface MotionCanvas {
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  backgroundColor?: string;
}
export interface MotionAsset {
  id: string;
  kind: "image" | "video" | "audio" | "font" | "svg";
  /** Public or signed Supabase Storage URL. Binary content never lives here. */
  url: string;
  name?: string;
  durationMs?: number;
}

export interface MotionNode {
  id: string;
  kind: MotionNodeKind;
  name?: string;
  /** The editor tells the person exactly what can be modified. */
  editability: MotionEditability;
  startMs: number;
  endMs: number;
  parentId?: string;
  assetId?: string;
  text?: string;
  /** Static editable values. Animation belongs in keyframes. */
  props?: Record<string, MotionValue>;
  /** Provenance is display/audit metadata only; it never contains executable code. */
  source?: { adapter?: string; sourceNodeId?: string; component?: string };
}

export interface MotionKeyframe {
  id: string;
  nodeId: string;
  property: MotionProperty;
  timeMs: number;
  value: MotionValue;
  easing?: string;
}

export interface MotionEffect {
  id: string;
  /** Omit targetNodeId for a canvas-wide effect. */
  targetNodeId?: string;
  effectId: string;
  params?: Record<string, MotionValue>;
  editability?: MotionEditability;
}

export interface MotionTransition {
  id: string;
  fromNodeId?: string;
  toNodeId?: string;
  type: string;
  durationMs: number;
  params?: Record<string, MotionValue>;
}

export interface MusaMotionSpec {
  version: typeof MUSA_MOTION_SPEC_VERSION;
  id?: string;
  name?: string;
  canvas: MotionCanvas;
  assets: MotionAsset[];
  nodes: MotionNode[];
  keyframes: MotionKeyframe[];
  effects: MotionEffect[];
  transitions: MotionTransition[];
}

export type MotionValidationSeverity = "error" | "warning";

export interface MotionValidationIssue {
  severity: MotionValidationSeverity;
  code: string;
  path: string;
  message: string;
}

export interface MotionFidelityItem {
  id: string;
  kind: string;
  reason?: string;
}

export interface MotionFidelityReport {
  editable: MotionFidelityItem[];
  atomic: MotionFidelityItem[];
  baked: MotionFidelityItem[];
  unsupported: MotionFidelityItem[];
}

export interface MotionValidationResult {
  valid: boolean;
  spec: MusaMotionSpec | null;
  issues: MotionValidationIssue[];
  fidelity: MotionFidelityReport;
  fingerprint: string | null;
}

export interface MotionDiffEntry {
  id: string;
  before?: unknown;
  after?: unknown;
}

export interface MotionCollectionDiff {
  added: MotionDiffEntry[];
  removed: MotionDiffEntry[];
  changed: MotionDiffEntry[];
}

export interface MotionSpecDiff {
  unchanged: boolean;
  canvasChanged: boolean;
  assets: MotionCollectionDiff;
  nodes: MotionCollectionDiff;
  keyframes: MotionCollectionDiff;
  effects: MotionCollectionDiff;
  transitions: MotionCollectionDiff;
}

export type MotionPlanTrackType = "video" | "audio" | "text" | "sticker" | "effect";
export type MotionPlanMaterialKind = "video" | "image" | "audio" | "text" | "sticker" | "animation";

export interface MotionApplyPlanTrack {
  id: string;
  type: MotionPlanTrackType;
  zOrder: number;
}

export interface MotionApplyPlanMaterial {
  id: string;
  nodeId: string;
  kind: MotionPlanMaterialKind;
  payload: Record<string, unknown>;
}

export interface MotionApplyPlanSegment {
  id: string;
  nodeId: string;
  trackId: string;
  materialId: string;
  targetStartUs: number;
  targetDurUs: number;
  sourceStartUs?: number;
  sourceDurUs?: number;
}

export interface MotionApplyPlan {
  fingerprint: string;
  canvas: MotionCanvas;
  tracks: MotionApplyPlanTrack[];
  materials: MotionApplyPlanMaterial[];
  segments: MotionApplyPlanSegment[];
  effects: MotionEffect[];
  transitions: MotionTransition[];
  bindings: Array<{ nodeId: string; materialId: string; segmentId: string }>;
  unsupported: MotionFidelityItem[];
  warnings: MotionValidationIssue[];
}

const MAX_ASSETS = 512;
const MAX_NODES = 2_000;
const MAX_KEYFRAMES = 16_000;
const MAX_EFFECTS = 512;
const MAX_TRANSITIONS = 512;
const ID_MAX = 128;
const NAME_MAX = 160;
const TEXT_MAX = 8_000;
const TIME_MAX_MS = 3_600_000;

const emptyFidelity = (): MotionFidelityReport => ({ editable: [], atomic: [], baked: [], unsupported: [] });

// The standalone player and Canvas exporter intentionally share a small,
// testable visual grammar. Keep unsupported CSS layout primitives out of a
// persisted video project rather than quietly rendering a different result.
const STANDALONE_UNSUPPORTED_PROPERTIES = new Set<MotionProperty>([
  "transform", "clipPath", "width", "height", "top", "left",
]);
const TEXT_ONLY_PROPERTIES = new Set<MotionProperty>([
  "color", "backgroundColor", "fontFamily", "fontSize", "fontWeight",
  "lineHeight", "letterSpacing", "textAlign", "background", "borderRadius",
]);
const STANDALONE_EFFECT_IDS = new Set(["fx-lut", "fx-overlay", "fx-text-anim"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value: unknown, max = ID_MAX): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().slice(0, max);
  return cleaned || null;
}

function finiteNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function cleanValue(value: unknown): MotionValue | undefined {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return value.slice(0, 2_000);
  return undefined;
}

function cleanValueRecord(raw: unknown): Record<string, MotionValue> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Record<string, MotionValue> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (Object.keys(out).length >= 64) break;
    const normalized = cleanValue(value);
    if (normalized !== undefined) out[key.slice(0, 80)] = normalized;
  }
  return Object.keys(out).length ? out : undefined;
}

function pushIssue(
  issues: MotionValidationIssue[],
  severity: MotionValidationSeverity,
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ severity, code, path, message });
}

function idFor(raw: unknown, fallback: string, seen: Set<string>, issues: MotionValidationIssue[], path: string): string | null {
  const id = cleanString(raw);
  if (!id) {
    pushIssue(issues, "error", "ID_REQUIRED", path, "Cada elemento requiere un id estable.");
    return null;
  }
  if (seen.has(id)) {
    pushIssue(issues, "error", "ID_DUPLICATE", path, `El id ${id} está repetido.`);
    return null;
  }
  seen.add(id);
  return id || fallback;
}

function normalizeEditability(raw: unknown): MotionEditability {
  return raw === "atomic" || raw === "baked" || raw === "unsupported" ? raw : "editable";
}

function normalizeNodeKind(raw: unknown): MotionNodeKind | null {
  return typeof raw === "string" && (MOTION_NODE_KINDS as readonly string[]).includes(raw)
    ? raw as MotionNodeKind
    : null;
}

function normalizeProperty(raw: unknown): MotionProperty | null {
  return typeof raw === "string" && (MOTION_PROPERTIES as readonly string[]).includes(raw)
    ? raw as MotionProperty
    : null;
}

function normalizeAssetKind(raw: unknown): MotionAsset["kind"] | null {
  return raw === "image" || raw === "video" || raw === "audio" || raw === "font" || raw === "svg"
    ? raw
    : null;
}

/**
 * Stable JSON for change detection and idempotency. It is intentionally not a
 * security primitive; callers must never use its fingerprint for auth.
 */
export function stableMotionStringify(value: unknown): string {
  const stack = new WeakSet<object>();
  const visit = (item: unknown): string => {
    if (item === null) return "null";
    if (typeof item === "string") return JSON.stringify(item);
    if (typeof item === "number") return Number.isFinite(item) ? String(item) : "null";
    if (typeof item === "boolean") return item ? "true" : "false";
    if (typeof item === "undefined" || typeof item === "function" || typeof item === "symbol") return "null";
    if (Array.isArray(item)) return `[${item.map(visit).join(",")}]`;
    if (!isRecord(item)) return "null";
    if (stack.has(item)) return JSON.stringify("[circular]");
    stack.add(item);
    const body = Object.keys(item).sort().filter((key) => item[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${visit(item[key])}`).join(",");
    stack.delete(item);
    return `{${body}}`;
  };
  return visit(value);
}

/** Deterministic FNV-1a 64-bit content fingerprint for idempotency/diffs. */
export function motionSpecHash(spec: MusaMotionSpec | unknown): string {
  const text = stableMotionStringify(spec);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < text.length; index++) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return `ms1-${hash.toString(16).padStart(16, "0")}`;
}

/** Alias that makes source/report code read more clearly. */
export const motionSpecFingerprint = motionSpecHash;

/**
 * Sanitizes an untrusted object into MusaMotionSpec v1. Invalid items are
 * omitted from the normalized document and reported. A caller must reject a
 * result with `valid:false` before persistence.
 */
export function normalizeMotionSpec(raw: unknown): MotionValidationResult {
  const issues: MotionValidationIssue[] = [];
  const fidelity = emptyFidelity();
  if (!isRecord(raw)) {
    pushIssue(issues, "error", "SPEC_REQUIRED", "$", "MotionSpec debe ser un objeto JSON.");
    return { valid: false, spec: null, issues, fidelity, fingerprint: null };
  }

  for (const forbidden of ["script", "javascript", "jsx", "tsx", "html", "css"]) {
    if (forbidden in raw) {
      pushIssue(issues, "error", "EXECUTABLE_SOURCE_REJECTED", `$.${forbidden}`, "El MotionSpec no acepta código ejecutable ni markup crudo.");
    }
  }

  if (raw.version !== undefined && raw.version !== MUSA_MOTION_SPEC_VERSION) {
    pushIssue(issues, "error", "VERSION_UNSUPPORTED", "$.version", `Se esperaba versión ${MUSA_MOTION_SPEC_VERSION}.`);
  }

  const canvasRaw = isRecord(raw.canvas) ? raw.canvas : {};
  if (!isRecord(raw.canvas)) pushIssue(issues, "error", "CANVAS_REQUIRED", "$.canvas", "MotionSpec requiere canvas.");
  const canvas: MotionCanvas = {
    width: Math.round(finiteNumber(canvasRaw.width, 1080, 16, 10_000)),
    height: Math.round(finiteNumber(canvasRaw.height, 1080, 16, 10_000)),
    fps: Math.round(finiteNumber(canvasRaw.fps, 30, 1, 60)),
    durationMs: Math.round(finiteNumber(canvasRaw.durationMs, 5_000, 1, TIME_MAX_MS)),
  };
  const backgroundColor = cleanString(canvasRaw.backgroundColor, 64);
  if (backgroundColor) canvas.backgroundColor = backgroundColor;

  const assets: MotionAsset[] = [];
  const assetIds = new Set<string>();
  const assetsRaw = Array.isArray(raw.assets) ? raw.assets : [];
  if (assetsRaw.length > MAX_ASSETS) pushIssue(issues, "error", "ASSET_LIMIT", "$.assets", `Máximo ${MAX_ASSETS} assets.`);
  for (let index = 0; index < Math.min(assetsRaw.length, MAX_ASSETS); index++) {
    const item = assetsRaw[index];
    const path = `$.assets[${index}]`;
    if (!isRecord(item)) {
      pushIssue(issues, "error", "ASSET_INVALID", path, "El asset debe ser un objeto.");
      continue;
    }
    const id = idFor(item.id, `asset-${index}`, assetIds, issues, `${path}.id`);
    const kind = normalizeAssetKind(item.kind);
    const url = cleanString(item.url, 4_096);
    if (!id || !kind || !url) {
      if (!kind) pushIssue(issues, "error", "ASSET_KIND_INVALID", `${path}.kind`, "kind debe ser image, video, audio, font o svg.");
      if (!url) pushIssue(issues, "error", "ASSET_URL_REQUIRED", `${path}.url`, "Asset requiere una URL de Storage o HTTPS.");
      continue;
    }
    if (!/^(https?:\/\/|\/|supabase:\/\/)/.test(url)) {
      pushIssue(issues, "error", "ASSET_URL_INVALID", `${path}.url`, "La URL del asset debe ser http(s), ruta absoluta o supabase://.");
      continue;
    }
    const asset: MotionAsset = { id, kind, url };
    const name = cleanString(item.name, NAME_MAX);
    if (name) asset.name = name;
    if (item.durationMs !== undefined) asset.durationMs = Math.round(finiteNumber(item.durationMs, 0, 0, TIME_MAX_MS));
    assets.push(asset);
  }

  const nodes: MotionNode[] = [];
  const nodeIds = new Set<string>();
  const nodesRaw = Array.isArray(raw.nodes) ? raw.nodes : [];
  if (nodesRaw.length > MAX_NODES) pushIssue(issues, "error", "NODE_LIMIT", "$.nodes", `Máximo ${MAX_NODES} nodos.`);
  for (let index = 0; index < Math.min(nodesRaw.length, MAX_NODES); index++) {
    const item = nodesRaw[index];
    const path = `$.nodes[${index}]`;
    if (!isRecord(item)) {
      pushIssue(issues, "error", "NODE_INVALID", path, "El nodo debe ser un objeto.");
      continue;
    }
    const id = idFor(item.id, `node-${index}`, nodeIds, issues, `${path}.id`);
    const kind = normalizeNodeKind(item.kind);
    if (!id || !kind) {
      if (!kind) pushIssue(issues, "error", "NODE_KIND_INVALID", `${path}.kind`, "kind no es compatible con MotionSpec v1.");
      continue;
    }
    let startMs = Math.round(finiteNumber(item.startMs, 0, 0, canvas.durationMs));
    let endMs = Math.round(finiteNumber(item.endMs, canvas.durationMs, 0, canvas.durationMs));
    if (endMs <= startMs) {
      pushIssue(issues, "error", "NODE_TIME_INVALID", path, "endMs debe ser mayor que startMs.");
      if (startMs >= canvas.durationMs) startMs = Math.max(0, canvas.durationMs - 1);
      endMs = Math.min(canvas.durationMs, Math.max(startMs + 1, endMs));
    }
    const node: MotionNode = { id, kind, editability: normalizeEditability(item.editability), startMs, endMs };
    const name = cleanString(item.name, NAME_MAX);
    if (name) node.name = name;
    const parentId = cleanString(item.parentId);
    if (parentId) node.parentId = parentId;
    const assetId = cleanString(item.assetId);
    if (assetId) node.assetId = assetId;
    const text = cleanString(item.text, TEXT_MAX);
    if (text) node.text = text;
    const props = cleanValueRecord(item.props);
    if (props) node.props = props;
    if (isRecord(item.source)) {
      const source: NonNullable<MotionNode["source"]> = {};
      const adapter = cleanString(item.source.adapter, 80);
      const sourceNodeId = cleanString(item.source.sourceNodeId, ID_MAX);
      const component = cleanString(item.source.component, 120);
      if (adapter) source.adapter = adapter;
      if (sourceNodeId) source.sourceNodeId = sourceNodeId;
      if (component) source.component = component;
      if (Object.keys(source).length) node.source = source;
    }
    if ((kind === "image" || kind === "video" || kind === "audio" || kind === "sticker" || kind === "svg") && !assetId) {
      pushIssue(issues, "error", "NODE_ASSET_REQUIRED", `${path}.assetId`, `${kind} requiere assetId.`);
    }
    if (kind === "text" && !text) pushIssue(issues, "error", "NODE_TEXT_REQUIRED", `${path}.text`, "text requiere contenido.");
    nodes.push(node);
  }

  for (const node of nodes) {
    if (node.assetId && !assetIds.has(node.assetId)) {
      pushIssue(issues, "error", "NODE_ASSET_MISSING", `$.nodes.${node.id}.assetId`, `No existe el asset ${node.assetId}.`);
    }
    if (node.parentId && !nodeIds.has(node.parentId)) {
      pushIssue(issues, "error", "NODE_PARENT_MISSING", `$.nodes.${node.id}.parentId`, `No existe el nodo padre ${node.parentId}.`);
    }
    fidelity[node.editability].push({ id: node.id, kind: node.kind });
  }

  const keyframes: MotionKeyframe[] = [];
  const keyframeIds = new Set<string>();
  const keyframeSignature = new Set<string>();
  const keyframesRaw = Array.isArray(raw.keyframes) ? raw.keyframes : [];
  if (keyframesRaw.length > MAX_KEYFRAMES) pushIssue(issues, "error", "KEYFRAME_LIMIT", "$.keyframes", `Máximo ${MAX_KEYFRAMES} keyframes.`);
  for (let index = 0; index < Math.min(keyframesRaw.length, MAX_KEYFRAMES); index++) {
    const item = keyframesRaw[index];
    const path = `$.keyframes[${index}]`;
    if (!isRecord(item)) {
      pushIssue(issues, "error", "KEYFRAME_INVALID", path, "El keyframe debe ser un objeto.");
      continue;
    }
    const id = idFor(item.id, `keyframe-${index}`, keyframeIds, issues, `${path}.id`);
    const nodeId = cleanString(item.nodeId);
    const property = normalizeProperty(item.property);
    const value = cleanValue(item.value);
    if (!id || !nodeId || !property || value === undefined) {
      if (!nodeId) pushIssue(issues, "error", "KEYFRAME_NODE_REQUIRED", `${path}.nodeId`, "Keyframe requiere nodeId.");
      if (!property) pushIssue(issues, "error", "KEYFRAME_PROPERTY_INVALID", `${path}.property`, "La propiedad no es animable.");
      if (value === undefined) pushIssue(issues, "error", "KEYFRAME_VALUE_INVALID", `${path}.value`, "El valor debe ser string, número, boolean o null.");
      continue;
    }
    if (!nodeIds.has(nodeId)) {
      pushIssue(issues, "error", "KEYFRAME_NODE_MISSING", `${path}.nodeId`, `No existe el nodo ${nodeId}.`);
      continue;
    }
    const timeMs = Math.round(finiteNumber(item.timeMs, 0, 0, canvas.durationMs));
    const signature = `${nodeId}\u0000${property}\u0000${timeMs}`;
    if (keyframeSignature.has(signature)) {
      pushIssue(issues, "error", "KEYFRAME_DUPLICATE", path, "No puede haber dos keyframes de la misma propiedad en el mismo instante.");
      continue;
    }
    keyframeSignature.add(signature);
    const keyframe: MotionKeyframe = { id, nodeId, property, timeMs, value };
    const easing = cleanString(item.easing, 160);
    if (easing) keyframe.easing = easing;
    keyframes.push(keyframe);
  }
  keyframes.sort((a, b) => a.nodeId.localeCompare(b.nodeId) || a.property.localeCompare(b.property) || a.timeMs - b.timeMs || a.id.localeCompare(b.id));

  const effects: MotionEffect[] = [];
  const effectIds = new Set<string>();
  const effectsRaw = Array.isArray(raw.effects) ? raw.effects : [];
  if (effectsRaw.length > MAX_EFFECTS) pushIssue(issues, "error", "EFFECT_LIMIT", "$.effects", `Máximo ${MAX_EFFECTS} efectos.`);
  for (let index = 0; index < Math.min(effectsRaw.length, MAX_EFFECTS); index++) {
    const item = effectsRaw[index];
    const path = `$.effects[${index}]`;
    if (!isRecord(item)) {
      pushIssue(issues, "error", "EFFECT_INVALID", path, "El efecto debe ser un objeto.");
      continue;
    }
    const id = idFor(item.id, `effect-${index}`, effectIds, issues, `${path}.id`);
    const effectId = cleanString(item.effectId, 120);
    const targetNodeId = cleanString(item.targetNodeId);
    if (!id || !effectId) {
      if (!effectId) pushIssue(issues, "error", "EFFECT_ID_REQUIRED", `${path}.effectId`, "El efecto requiere effectId.");
      continue;
    }
    if (targetNodeId && !nodeIds.has(targetNodeId)) {
      pushIssue(issues, "error", "EFFECT_NODE_MISSING", `${path}.targetNodeId`, `No existe el nodo ${targetNodeId}.`);
      continue;
    }
    const effect: MotionEffect = { id, effectId };
    if (targetNodeId) effect.targetNodeId = targetNodeId;
    const params = cleanValueRecord(item.params);
    if (params) effect.params = params;
    const editability = item.editability === "atomic" || item.editability === "baked" || item.editability === "unsupported" || item.editability === "editable"
      ? item.editability : undefined;
    if (editability) effect.editability = editability;
    effects.push(effect);
  }

  const transitions: MotionTransition[] = [];
  const transitionIds = new Set<string>();
  const transitionsRaw = Array.isArray(raw.transitions) ? raw.transitions : [];
  if (transitionsRaw.length > MAX_TRANSITIONS) pushIssue(issues, "error", "TRANSITION_LIMIT", "$.transitions", `Máximo ${MAX_TRANSITIONS} transiciones.`);
  for (let index = 0; index < Math.min(transitionsRaw.length, MAX_TRANSITIONS); index++) {
    const item = transitionsRaw[index];
    const path = `$.transitions[${index}]`;
    if (!isRecord(item)) {
      pushIssue(issues, "error", "TRANSITION_INVALID", path, "La transición debe ser un objeto.");
      continue;
    }
    const id = idFor(item.id, `transition-${index}`, transitionIds, issues, `${path}.id`);
    const type = cleanString(item.type, 120);
    const fromNodeId = cleanString(item.fromNodeId);
    const toNodeId = cleanString(item.toNodeId);
    if (!id || !type) {
      if (!type) pushIssue(issues, "error", "TRANSITION_TYPE_REQUIRED", `${path}.type`, "La transición requiere type.");
      continue;
    }
    if (fromNodeId && !nodeIds.has(fromNodeId)) {
      pushIssue(issues, "error", "TRANSITION_FROM_MISSING", `${path}.fromNodeId`, `No existe el nodo ${fromNodeId}.`);
      continue;
    }
    if (toNodeId && !nodeIds.has(toNodeId)) {
      pushIssue(issues, "error", "TRANSITION_TO_MISSING", `${path}.toNodeId`, `No existe el nodo ${toNodeId}.`);
      continue;
    }
    const transition: MotionTransition = {
      id,
      type,
      durationMs: Math.round(finiteNumber(item.durationMs, 600, 1, Math.min(30_000, canvas.durationMs))),
    };
    if (fromNodeId) transition.fromNodeId = fromNodeId;
    if (toNodeId) transition.toNodeId = toNodeId;
    const params = cleanValueRecord(item.params);
    if (params) transition.params = params;
    transitions.push(transition);
  }

  const spec: MusaMotionSpec = {
    version: MUSA_MOTION_SPEC_VERSION,
    canvas,
    assets,
    nodes,
    keyframes,
    effects,
    transitions,
  };
  const id = cleanString(raw.id);
  const name = cleanString(raw.name, NAME_MAX);
  if (id) spec.id = id;
  if (name) spec.name = name;

  const valid = issues.every((issue) => issue.severity !== "error");
  return { valid, spec, issues, fidelity, fingerprint: motionSpecHash(spec) };
}

/** Alias for callers that use validation language rather than normalization. */
export const validateMotionSpec = normalizeMotionSpec;

function diffCollection<T extends { id: string }>(before: readonly T[], after: readonly T[]): MotionCollectionDiff {
  const oldById = new Map(before.map((item) => [item.id, item]));
  const newById = new Map(after.map((item) => [item.id, item]));
  const added: MotionDiffEntry[] = [];
  const removed: MotionDiffEntry[] = [];
  const changed: MotionDiffEntry[] = [];
  for (const [id, item] of newById) {
    const old = oldById.get(id);
    if (!old) added.push({ id, after: item });
    else if (stableMotionStringify(old) !== stableMotionStringify(item)) changed.push({ id, before: old, after: item });
  }
  for (const [id, item] of oldById) if (!newById.has(id)) removed.push({ id, before: item });
  return { added, removed, changed };
}

/** Stable, node-id-oriented diff used before reapplying AI-generated motion. */
export function diffMotionSpecs(current: MusaMotionSpec | null | undefined, incoming: MusaMotionSpec): MotionSpecDiff {
  const before = current || {
    version: MUSA_MOTION_SPEC_VERSION,
    canvas: incoming.canvas,
    assets: [], nodes: [], keyframes: [], effects: [], transitions: [],
  } satisfies MusaMotionSpec;
  const assets = diffCollection(before.assets, incoming.assets);
  const nodes = diffCollection(before.nodes, incoming.nodes);
  const keyframes = diffCollection(before.keyframes, incoming.keyframes);
  const effects = diffCollection(before.effects, incoming.effects);
  const transitions = diffCollection(before.transitions, incoming.transitions);
  const canvasChanged = stableMotionStringify(before.canvas) !== stableMotionStringify(incoming.canvas);
  const unchanged = !canvasChanged && [assets, nodes, keyframes, effects, transitions]
    .every((collection) => collection.added.length === 0 && collection.removed.length === 0 && collection.changed.length === 0);
  return { unchanged, canvasChanged, assets, nodes, keyframes, effects, transitions };
}

// REQ-052 v2 multi-tenant (paridad con sceneSpec): el sufijo NUNCA se deriva
// solo del node.id — dos proyectos con un nodo llamado igual ("t1", "title")
// colisionarían en las PKs globales de musa_video_*. Se scopea por projectId;
// sigue siendo determinista → re-aplicar es upsert limpio.
function shortId(projectId: string, value: string): string {
  return motionSpecHash({ value: `${projectId}:${value}` }).slice(-12);
}

function trackTypeFor(node: MotionNode): MotionPlanTrackType {
  if (node.kind === "audio") return "audio";
  if (node.kind === "text") return "text";
  if (node.kind === "sticker") return "sticker";
  return "video";
}

function materialKindFor(node: MotionNode): MotionPlanMaterialKind {
  if (node.kind === "audio") return "audio";
  if (node.kind === "text") return "text";
  // Static stickers and SVG assets already use the browser image pipeline.
  // Persisting them as image materials lets the human move/trim them and lets
  // the standalone Canvas renderer show the same asset instead of a generic
  // unsupported placeholder.
  if (node.kind === "sticker" || node.kind === "svg") return "image";
  if (node.kind === "video") return "video";
  if (node.kind === "image") return "image";
  return "animation";
}

/**
 * Low-level project plan. Deterministic ids per (projectId, node) so a compiler
 * can apply the same source spec idempotently (re-apply = upsert) while N
 * motion projects coexist without colliding on the global musa_video_* PKs.
 */
export function buildMotionApplyPlan(spec: MusaMotionSpec, projectId: string): MotionApplyPlan {
  const normalized = normalizeMotionSpec(spec);
  if (!normalized.valid || !normalized.spec || !normalized.fingerprint) {
    const summary = normalized.issues.filter((issue) => issue.severity === "error").map((issue) => issue.code).join(", ");
    throw new Error(`MOTION_SPEC_INVALID: ${summary || "normalization failed"}`);
  }
  const source = normalized.spec;
  const assetById = new Map(source.assets.map((asset) => [asset.id, asset]));
  const nodeById = new Map(source.nodes.map((node) => [node.id, node]));
  const keyframesByNode = new Map<string, MotionKeyframe[]>();
  for (const frame of source.keyframes) {
    const group = keyframesByNode.get(frame.nodeId) || [];
    group.push(frame);
    keyframesByNode.set(frame.nodeId, group);
  }
  const fontAssets = source.assets
    .filter((asset) => asset.kind === "font")
    .map((asset) => ({ id: asset.id, family: asset.name || asset.id, url: asset.url }));
  const tracksById = new Map<string, MotionApplyPlanTrack>();
  const tracks: MotionApplyPlanTrack[] = [];
  const materials: MotionApplyPlanMaterial[] = [];
  const segments: MotionApplyPlanSegment[] = [];
  const bindings: MotionApplyPlan["bindings"] = [];
  const unsupported: MotionFidelityItem[] = [];

  const ensureTrack = (node: MotionNode, visualOrder: number): MotionApplyPlanTrack => {
    const type = trackTypeFor(node);
    // Audio has no visual stacking. Visual nodes deliberately receive their
    // own track so source order survives text/image/sticker mixing and a
    // person can reorder any generated layer in the existing timeline.
    // La pista de audio ya no es un id global literal (vidtrk_motion_audio):
    // dos proyectos con audio colisionaban SIEMPRE. Sufijo por proyecto.
    const id = type === "audio" ? `vidtrk_ma${shortId(projectId, "audio")}` : `vidtrk_m${shortId(projectId, node.id)}`;
    const existing = tracksById.get(id);
    if (existing) return existing;
    const zOrder = type === "audio" ? 0 : 10 + visualOrder;
    const track = { id, type, zOrder };
    tracksById.set(id, track);
    tracks.push(track);
    return track;
  };

  const nodeHasVisualState = (node: MotionNode | undefined) => Boolean(node && (
    Object.keys(node.props || {}).length > 0 || (keyframesByNode.get(node.id)?.length || 0) > 0
  ));
  const nodeProblem = (node: MotionNode, nodeKeyframes: MotionKeyframe[]): string | null => {
    if (node.editability === "unsupported") return "unsupported node";
    if (node.kind === "shape") return "shape needs a standalone vector renderer";
    if (node.kind === "audio" && (Object.keys(node.props || {}).length > 0 || nodeKeyframes.length > 0)) {
      return "audio motion properties need an audio automation renderer";
    }
    const properties = [...Object.keys(node.props || {}), ...nodeKeyframes.map((frame) => frame.property)] as MotionProperty[];
    const unsupportedProperty = properties.find((property) => STANDALONE_UNSUPPORTED_PROPERTIES.has(property));
    if (unsupportedProperty) return `property ${unsupportedProperty} has no standalone renderer`;
    const textOnly = properties.find((property) => TEXT_ONLY_PROPERTIES.has(property) && node.kind !== "text");
    if (textOnly) return `property ${textOnly} is supported only by text nodes`;
    let parentId = node.parentId;
    const seenParents = new Set<string>();
    while (parentId && !seenParents.has(parentId)) {
      seenParents.add(parentId);
      const parent = nodeById.get(parentId);
      if (!parent) break;
      if (nodeHasVisualState(parent)) return `parent ${parent.id} has transforms that cannot be inherited yet`;
      parentId = parent.parentId;
    }
    return null;
  };

  let visualOrder = 0;
  for (const node of source.nodes) {
    const nodeKeyframes = keyframesByNode.get(node.id) || [];
    if (node.kind === "group") {
      if (nodeHasVisualState(node)) unsupported.push({ id: node.id, kind: node.kind, reason: "group transforms need a hierarchy renderer" });
      continue;
    }
    const problem = nodeProblem(node, nodeKeyframes);
    if (problem) {
      unsupported.push({ id: node.id, kind: node.kind, reason: problem });
      continue;
    }
    const track = ensureTrack(node, visualOrder);
    if (node.kind !== "audio") visualOrder += 1;
    const materialId = `vidmat_m${shortId(projectId, node.id)}`;
    const segmentId = `vidseg_m${shortId(projectId, node.id)}`;
    const kind = materialKindFor(node);
    const props = { ...(node.props || {}) };
    const asset = node.assetId ? assetById.get(node.assetId) : undefined;
    if (node.kind === "text" && asset?.kind === "font" && typeof props.fontFamily !== "string") props.fontFamily = asset.name || asset.id;
    const payload: Record<string, unknown> = {
      nodeId: node.id,
      nodeKind: node.kind,
      editability: node.editability,
      props,
      keyframes: nodeKeyframes,
    };
    if (kind === "text") payload.text = node.text || " ";
    if (fontAssets.length) payload.fontAssets = fontAssets;
    if (asset && asset.kind !== "font") {
      payload.url = asset.url;
      if (asset.durationMs !== undefined) payload.durationUs = Math.round(asset.durationMs * 1_000);
    }
    materials.push({ id: materialId, nodeId: node.id, kind, payload });
    const targetStartUs = Math.round(node.startMs * 1_000);
    const targetDurUs = Math.max(1, Math.round((node.endMs - node.startMs) * 1_000));
    const segment: MotionApplyPlanSegment = {
      id: segmentId,
      nodeId: node.id,
      trackId: track.id,
      materialId,
      targetStartUs,
      targetDurUs,
    };
    if (kind === "audio" || kind === "video") {
      segment.sourceStartUs = 0;
      segment.sourceDurUs = targetDurUs;
    }
    segments.push(segment);
    bindings.push({ nodeId: node.id, materialId, segmentId });
  }

  return {
    fingerprint: normalized.fingerprint,
    canvas: source.canvas,
    tracks,
    materials,
    segments,
    effects: source.effects.filter((effect) => {
      if (effect.editability === "unsupported" || !STANDALONE_EFFECT_IDS.has(effect.effectId)) {
        unsupported.push({ id: `effect:${effect.id}`, kind: "effect", reason: effect.editability === "unsupported" ? "unsupported effect" : `effect ${effect.effectId} has no standalone renderer` });
        return false;
      }
      return true;
    }),
    transitions: source.transitions.filter((transition) => {
      unsupported.push({ id: `transition:${transition.id}`, kind: "transition", reason: "transitions need a standalone renderer" });
      return false;
    }),
    bindings,
    unsupported,
    warnings: normalized.issues.filter((issue) => issue.severity === "warning"),
  };
}

/** Combines schema-level editability with the stricter standalone renderer
 * capability check. Call this at every harness boundary so an agent never
 * hears "editable" for a node that would be omitted or blocked on export. */
export function mergeMotionPlanFidelity(
  base: MotionFidelityReport,
  plan: Pick<MotionApplyPlan, "unsupported">,
): MotionFidelityReport {
  const unsupportedIds = new Set(plan.unsupported.map((item) => item.id));
  const existing = new Set(base.unsupported.map((item) => `${item.id}\u0000${item.reason || ""}`));
  const extras = plan.unsupported.filter((item) => {
    const key = `${item.id}\u0000${item.reason || ""}`;
    if (existing.has(key)) return false;
    existing.add(key);
    return true;
  });
  return {
    editable: base.editable.filter((item) => !unsupportedIds.has(item.id)),
    atomic: base.atomic.filter((item) => !unsupportedIds.has(item.id)),
    baked: base.baked.filter((item) => !unsupportedIds.has(item.id)),
    unsupported: [...base.unsupported, ...extras],
  };
}

function cssValue(property: MotionProperty, value: MotionValue): string {
  if (typeof value === "string") return value;
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (property === "width" || property === "height" || property === "top" || property === "left") return `${value}px`;
  return String(value);
}

function numericAt(keyframes: MotionKeyframe[], property: MotionProperty, atMs: number, fallback: number): number {
  const candidates = keyframes.filter((frame) => frame.property === property && typeof frame.value === "number" && frame.timeMs <= atMs);
  const latest = candidates[candidates.length - 1];
  return latest && typeof latest.value === "number" ? latest.value : fallback;
}

function transformAt(node: MotionNode, keyframes: MotionKeyframe[], atMs: number): string {
  const props = node.props || {};
  const x = numericAt(keyframes, "x", atMs, typeof props.x === "number" ? props.x : 0);
  const y = numericAt(keyframes, "y", atMs, typeof props.y === "number" ? props.y : 0);
  const scale = numericAt(keyframes, "scale", atMs, typeof props.scale === "number" ? props.scale : 1);
  const rotation = numericAt(keyframes, "rotation", atMs, typeof props.rotation === "number" ? props.rotation : 0);
  return `translateX(${x}px) translateY(${y}px) scale(${scale}) rotate(${rotation}deg)`;
}

/**
 * Compiles the subset that design Video Mode already knows into its existing
 * AnimationSchema. The standalone compiler consumes buildMotionApplyPlan().
 */
export function motionSpecToAnimationSchema(spec: MusaMotionSpec): {
  schema: AnimationSchema;
  unsupported: MotionFidelityItem[];
} {
  const normalized = normalizeMotionSpec(spec);
  if (!normalized.valid || !normalized.spec) throw new Error("MOTION_SPEC_INVALID");
  const source = normalized.spec;
  const clips: Array<Record<string, unknown>> = [];
  const unsupported = [...normalized.fidelity.unsupported];
  for (const node of source.nodes) {
    if (node.kind === "group" || node.editability === "unsupported") continue;
    const frames = source.keyframes.filter((frame) => frame.nodeId === node.id);
    const tweenGroups = new Map<string, MotionKeyframe[]>();
    for (const frame of frames) {
      const prop = ["x", "y", "scale", "rotation"].includes(frame.property) ? "transform" : frame.property;
      const list = tweenGroups.get(prop) || [];
      list.push(frame);
      tweenGroups.set(prop, list);
    }
    if (!tweenGroups.size) continue;
    const tweens: Array<Record<string, unknown>> = [];
    for (const [prop, group] of tweenGroups) {
      const values = group.slice().sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id));
      const keyframes = values.map((frame) => ({
        t: (frame.timeMs - node.startMs) / Math.max(1, node.endMs - node.startMs),
        value: prop === "transform"
          ? (frame.property === "transform" ? cssValue(frame.property, frame.value) : transformAt(node, frames, frame.timeMs))
          : cssValue(frame.property, frame.value),
      }));
      tweens.push({ prop, easing: values[0]?.easing || "ease", keyframes });
    }
    clips.push({ layerId: node.id, startSec: node.startMs / 1_000, endSec: node.endMs / 1_000, tweens });
  }
  const animation = normalizeAnimation({
    timeline: {
      durationSec: source.canvas.durationMs / 1_000,
      fps: source.canvas.fps,
      width: source.canvas.width,
      height: source.canvas.height,
      loop: "once",
    },
    clips,
    transitions: [],
  });
  if (!animation) throw new Error("MOTION_SCHEMA_COMPILE_FAILED");
  return { schema: animation, unsupported };
}

/** Source formats the harness can translate without evaluating user code.
 * HyperFrames and Remotion adapters consume a small declarative manifest;
 * raw HTML/GSAP/TSX remains intentionally unsupported. */
/** `musa-js` is intentionally an output channel, not a JavaScript runtime:
 * a generator may produce the JSON document, but the harness never evaluates
 * the source code that produced it. */
export type MotionSourceKind = "musa" | "musa-js" | "hyperframes-subset" | "remotion-subset" | "html-css-keyframes";

export interface MotionSourceConversion extends MotionValidationResult {
  sourceKind: MotionSourceKind;
  adapter: string;
}

function conversionError(kind: MotionSourceKind, code: string, message: string): MotionSourceConversion {
  const issues: MotionValidationIssue[] = [{ severity: "error", code, path: "$", message }];
  return { sourceKind: kind, adapter: kind, valid: false, spec: null, issues, fidelity: emptyFidelity(), fingerprint: null };
}

function sourceNumber(raw: Record<string, unknown>, names: string[], fallback: number): number {
  for (const name of names) {
    const value = raw[name];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return fallback;
}

function sourceNodeKind(raw: unknown): MotionNodeKind | null {
  const value = typeof raw === "string" ? raw.toLowerCase() : "";
  if (["text", "title", "caption", "span", "p", "h1", "h2"].includes(value)) return "text";
  if (["image", "img", "imageasset"].includes(value)) return "image";
  if (["video", "offthreadvideo", "videoplayer"].includes(value)) return "video";
  if (["audio", "audioasset"].includes(value)) return "audio";
  if (["sticker"].includes(value)) return "sticker";
  if (["shape", "rect", "circle", "path"].includes(value)) return "shape";
  if (["svg"].includes(value)) return "svg";
  if (["group", "sequence", "div"].includes(value)) return "group";
  return normalizeNodeKind(value);
}

function sourceProps(raw: Record<string, unknown>): Record<string, MotionValue> | undefined {
  const from = isRecord(raw.props) ? raw.props : isRecord(raw.style) ? raw.style : {};
  const out: Record<string, MotionValue> = {};
  for (const key of MOTION_PROPERTIES) {
    const value = from[key];
    const clean = cleanValue(value);
    if (clean !== undefined) out[key] = clean;
  }
  const x = cleanValue(from.x ?? from.left);
  const y = cleanValue(from.y ?? from.top);
  const scale = cleanValue(from.scale);
  const rotation = cleanValue(from.rotation ?? from.rotate);
  if (x !== undefined) out.x = x;
  if (y !== undefined) out.y = y;
  if (scale !== undefined) out.scale = scale;
  if (rotation !== undefined) out.rotation = rotation;
  return Object.keys(out).length ? out : undefined;
}

/**
 * Converts a safe manifest exported by a narrow HyperFrames/Remotion adapter
 * to MusaMotionSpec. It deliberately refuses source strings so the harness
 * cannot become a runtime for GSAP, React or arbitrary markup.
 */
export function convertMotionSource(sourceKind: MotionSourceKind, raw: unknown): MotionSourceConversion {
  if (sourceKind === "musa" || sourceKind === "musa-js") {
    return { ...normalizeMotionSpec(raw), sourceKind, adapter: sourceKind };
  }
  if (!isRecord(raw)) {
    return conversionError(sourceKind, "SOURCE_MANIFEST_REQUIRED", "El adaptador requiere un manifiesto JSON; no ejecuta código fuente.");
  }
  if (typeof raw.code === "string" || typeof raw.html === "string" || typeof raw.css === "string" || typeof raw.tsx === "string" || typeof raw.jsx === "string") {
    return conversionError(sourceKind, "SOURCE_CODE_REJECTED", "El arnés acepta un manifiesto declarativo del adaptador, no HTML, GSAP, JSX o TSX ejecutable.");
  }

  const composition = sourceKind === "remotion-subset" && isRecord(raw.composition) ? raw.composition : raw;
  const fps = Math.round(sourceNumber(composition, ["fps"], 30));
  const width = Math.round(sourceNumber(composition, ["width", "canvasW"], 1080));
  const height = Math.round(sourceNumber(composition, ["height", "canvasH"], 1080));
  const durationMs = sourceKind === "remotion-subset"
    ? Math.round(sourceNumber(composition, ["durationMs"], sourceNumber(composition, ["durationInFrames"], fps * 5) / Math.max(1, fps) * 1_000))
    : Math.round(sourceNumber(composition, ["durationMs"], sourceNumber(composition, ["durationInFrames"], fps * 5) / Math.max(1, fps) * 1_000));
  const sourceNodes = Array.isArray(raw.nodes) ? raw.nodes
    : Array.isArray(raw.layers) ? raw.layers
      : Array.isArray(raw.sequences) ? raw.sequences
        : Array.isArray(composition.nodes) ? composition.nodes
          : [];
  if (sourceNodes.length === 0) {
    return conversionError(sourceKind, "SOURCE_NODES_REQUIRED", "El manifiesto requiere nodes, layers o sequences.");
  }

  const assets: Array<Record<string, unknown>> = Array.isArray(raw.assets) ? raw.assets.map((asset) => isRecord(asset) ? { ...asset } : asset as Record<string, unknown>) : [];
  const assetIds = new Set(assets.filter(isRecord).map((asset) => cleanString(asset.id)).filter((id): id is string => Boolean(id)));
  const nodes: Array<Record<string, unknown>> = [];
  const keyframes: Array<Record<string, unknown>> = [];

  sourceNodes.forEach((item, index) => {
    if (!isRecord(item)) return;
    const id = cleanString(item.id) || `node-${index + 1}`;
    const kind = sourceNodeKind(item.kind ?? item.type ?? item.component);
    if (!kind || kind === "group") return;
    const fromFrames = sourceKind === "remotion-subset" ? sourceNumber(item, ["from", "startFrame"], 0) : null;
    const durationFrames = sourceKind === "remotion-subset" ? sourceNumber(item, ["durationInFrames", "frames"], Number.NaN) : Number.NaN;
    const startMs = Math.round(sourceNumber(item, ["startMs", "start"], fromFrames === null ? 0 : fromFrames / Math.max(1, fps) * 1_000));
    const endMs = Math.round(sourceNumber(item, ["endMs", "end"], Number.isFinite(durationFrames)
      ? startMs + durationFrames / Math.max(1, fps) * 1_000
      : durationMs));
    const props = sourceProps(item);
    const node: Record<string, unknown> = {
      id,
      kind,
      editability: item.editability === "atomic" || item.editability === "baked" || item.editability === "unsupported" ? item.editability : "editable",
      startMs,
      endMs,
      source: { adapter: sourceKind, sourceNodeId: cleanString(item.id) || id, component: cleanString(item.component ?? item.type, 120) || undefined },
    };
    const name = cleanString(item.name, NAME_MAX);
    if (name) node.name = name;
    const text = cleanString(item.text ?? (isRecord(item.props) ? item.props.text : undefined), TEXT_MAX);
    if (kind === "text") node.text = text || "Texto";
    let assetId = cleanString(item.assetId);
    const src = cleanString(item.src ?? item.url, 4_096);
    if (!assetId && src) {
      assetId = `asset-${id}`;
      if (!assetIds.has(assetId)) {
        assets.push({ id: assetId, kind: kind === "audio" ? "audio" : kind === "video" ? "video" : kind === "svg" ? "svg" : "image", url: src });
        assetIds.add(assetId);
      }
    }
    if (assetId) node.assetId = assetId;
    if (props) node.props = props;
    nodes.push(node);

    const localKeyframes = Array.isArray(item.keyframes) ? item.keyframes : [];
    localKeyframes.forEach((frame, frameIndex) => {
      if (!isRecord(frame)) return;
      const property = normalizeProperty(frame.property ?? frame.prop);
      const value = cleanValue(frame.value);
      if (!property || value === undefined) return;
      const frameMs = sourceKind === "remotion-subset" && typeof frame.frame === "number"
        ? startMs + Math.round(frame.frame / Math.max(1, fps) * 1_000)
        : Math.round(sourceNumber(frame, ["timeMs", "time"], startMs));
      keyframes.push({ id: cleanString(frame.id) || `kf-${id}-${frameIndex + 1}`, nodeId: id, property, timeMs: frameMs, value, easing: cleanString(frame.easing, 160) || undefined });
    });
  });

  const converted = normalizeMotionSpec({
    version: MUSA_MOTION_SPEC_VERSION,
    id: cleanString(raw.id),
    name: cleanString(raw.name, NAME_MAX),
    canvas: { width, height, fps, durationMs, backgroundColor: cleanString(composition.backgroundColor, 64) || undefined },
    assets,
    nodes,
    keyframes,
    effects: Array.isArray(raw.effects) ? raw.effects : [],
    transitions: Array.isArray(raw.transitions) ? raw.transitions : [],
  });
  return { ...converted, sourceKind, adapter: sourceKind };
}
