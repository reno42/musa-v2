/**
 * Motion MCP-surface logic (REQ-056 F2 + REQ-057 F2) — the pure layer the
 * future `motion_lottie_import` / `motion_preset_list` / preset-aware
 * `motion_source_convert` tools call. Registered as tools in
 * `worker/runtime/functions/mcp.mjs`; the math lives here so it is
 * node-testable and shared with the editor.
 *
 * Deliberate dependency boundary: this module does NOT import
 * `shared/motionSpec.ts`. Specs cross it as plain JSON shaped like
 * MusaMotionSpec v1 (docs/requirements/REQ-046), so the worker shim stays a
 * thin adapter and this file never breaks when the spec module evolves.
 *
 * Honesty rules (same as the rest of the harness):
 *  - Pure functions in/out, no DOM, no I/O — node-testable.
 *  - Never throws on malformed input: issues come back structured.
 *  - Deterministic output: same input → same JSON (idempotent re-apply).
 *  - Generated keyframes never silently clobber existing ones: collisions
 *    are reported and skipped (preset path) or replace only the properties
 *    the import itself owns (Lottie path, for clean re-imports).
 */

import { mapLottieMotion, canonicalTransform, type LottieImportWarning, type LottieFidelityItem } from "./lottieImport.ts";
import {
  applyMotionPresetToSchema,
  findMotionPreset,
  motionPresetCatalogSummary,
  sanitizeMotionParams,
  type MotionPreset,
} from "./motionPresets.ts";

// ── Local structural types (MusaMotionSpec v1 shape, no import) ─────────

export interface SurfaceIssue {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
}

interface SpecNodeLike {
  id: string;
  kind?: string;
  name?: string;
  startMs?: number;
  endMs?: number;
  props?: Record<string, unknown>;
  /** REQ-057 F2: preset declaration consumed (and stripped) by expandSpecPresets. */
  preset?: unknown;
  [key: string]: unknown;
}

interface SpecLike {
  canvas?: { durationMs?: number; fps?: number; width?: number; height?: number };
  nodes?: SpecNodeLike[];
  keyframes?: Array<{ id: string; nodeId: string; property: string; timeMs: number; value: unknown; easing?: string }>;
  [key: string]: unknown;
}

/** A generated spec keyframe seed (id/nodeId assigned by the caller). */
interface KeyframeSeed {
  property: "x" | "y" | "scale" | "rotation" | "opacity";
  timeMs: number;
  value: number;
  easing?: string;
}

const asObj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const finite = (v: unknown, fallback: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Parses the canonical transform produced by this codebase
 * (`translateX(..px) translateY(..px) scale(..) rotate(..deg)`) back into
 * numbers. Only strings we generate are expected; anything else → null.
 */
export function parseCanonicalTransform(value: unknown): { x: number; y: number; scale: number; rotation: number } | null {
  if (typeof value !== "string") return null;
  const m = value.match(
    /^translateX\((-?[\d.]+)px\) translateY\((-?[\d.]+)px\) scale\((-?[\d.]+)\) rotate\((-?[\d.]+)deg\)$/,
  );
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some(n => !Number.isFinite(n))) return null;
  return { x: parts[0], y: parts[1], scale: parts[2], rotation: parts[3] };
}

/** One schema tween → numeric spec keyframe seeds at REAL keyframe times. */
function tweenToSeeds(tween: { prop: string; keyframes: Array<{ t: number; value: string }>; easing?: string }, windowStartMs: number, windowMs: number): KeyframeSeed[] {
  const seeds: KeyframeSeed[] = [];
  for (const kf of tween.keyframes) {
    const timeMs = Math.round(windowStartMs + kf.t * windowMs);
    if (tween.prop === "opacity") {
      const v = Number(kf.value);
      if (Number.isFinite(v)) seeds.push({ property: "opacity", timeMs, value: v, easing: tween.easing });
      continue;
    }
    if (tween.prop === "transform") {
      const parsed = parseCanonicalTransform(kf.value);
      if (!parsed) continue;
      seeds.push(
        { property: "x", timeMs, value: parsed.x, easing: tween.easing },
        { property: "y", timeMs, value: parsed.y, easing: tween.easing },
        { property: "scale", timeMs, value: parsed.scale, easing: tween.easing },
        { property: "rotation", timeMs, value: parsed.rotation, easing: tween.easing },
      );
    }
  }
  return seeds;
}

// ── REQ-057 F2 — preset catalog payload + spec expansion ────────────────

/** Payload for the future `motion_preset_list` tool: ids, params and windows
 *  an agent needs BEFORE writing keyframes by hand. */
export function motionPresetListPayload(): Record<string, unknown> {
  return {
    presets: motionPresetCatalogSummary(),
    note: "Usa el id en node.preset (spec) o motion_preset_apply; los params se clampean a los rangos declarados — nunca se rechaza el spec por un valor fuera de rango.",
  };
}

export interface AppliedPreset {
  nodeId: string;
  preset: string;
  windowMs: { start: number; end: number };
  keyframes: number;
  skipped: number;
}

export interface ExpandPresetsResult {
  /** Spec WITHOUT preset declarations, with generated keyframes appended. */
  spec: Record<string, unknown> | null;
  applied: AppliedPreset[];
  issues: SurfaceIssue[];
}

/** Node `preset` declaration accepted shapes: `"id"` or
 *  `{ id, params?, windowMs?: { start, end } }`. */
function readPresetDecl(raw: unknown): { id: string; params: Record<string, unknown> | null; window: { start?: number; end?: number } | null } | null {
  if (typeof raw === "string") return { id: raw, params: null, window: null };
  const obj = asObj(raw);
  if (!obj || typeof obj.id !== "string") return null;
  return {
    id: obj.id,
    params: asObj(obj.params) as Record<string, unknown> | null,
    window: asObj(obj.windowMs) as { start?: number; end?: number } | null,
  };
}

/**
 * Expands `preset` declarations on nodes into concrete MotionSpec keyframes
 * (numbers for x/y/scale/rotation/opacity), via the SAME preset builders the
 * editor uses. Pure and idempotent: the expanded spec carries no preset
 * declarations, so expanding twice is a no-op. Unknown preset ids are ERRORS
 * listing the valid ids; params out of range are clamped (never fatal).
 */
export function expandSpecPresets(rawSpec: unknown): ExpandPresetsResult {
  const issues: SurfaceIssue[] = [];
  const applied: AppliedPreset[] = [];
  const spec = asObj(rawSpec);
  if (!spec) {
    return { spec: null, applied, issues: [{ severity: "error", code: "SPEC_REQUIRED", path: "$", message: "El spec debe ser un objeto JSON." }] };
  }
  const nodesRaw = Array.isArray(spec.nodes) ? spec.nodes : [];
  const existingKeyframes = Array.isArray(spec.keyframes) ? spec.keyframes.filter(kf => asObj(kf)) as NonNullable<SpecLike["keyframes"]> : [];
  const canvasDurationMs = finite(asObj(spec.canvas)?.durationMs, 3_600_000);

  const usedIds = new Set(existingKeyframes.map(kf => String(asObj(kf)?.id ?? "")));
  const collisions = new Set(existingKeyframes.map(kf => {
    const o = asObj(kf);
    return `${o?.nodeId}\u0000${o?.property}\u0000${finite(o?.timeMs, -1)}`;
  }));
  const generated: SpecLike["keyframes"] = [];

  const nodes = nodesRaw.map(rawNode => {
    const node = { ...(asObj(rawNode) || {}) } as SpecNodeLike;
    if (!node.preset) return node;
    const decl = readPresetDecl(node.preset);
    delete node.preset;
    const path = `$.nodes.${String(node.id ?? "?")}.preset`;
    if (!decl) {
      issues.push({ severity: "error", code: "PRESET_INVALID", path, message: "preset debe ser un id string o { id, params?, windowMs? }." });
      return node;
    }
    const preset: MotionPreset | undefined = findMotionPreset(decl.id);
    if (!preset) {
      issues.push({
        severity: "error",
        code: "PRESET_UNKNOWN",
        path,
        message: `Preset desconocido: ${decl.id}. Ids válidos: ${motionPresetCatalogSummary().map(p => p.id).join(", ")}.`,
      });
      return node;
    }
    const nodeId = String(node.id ?? "");
    const startRaw = finite(decl.window?.start, finite(node.startMs, 0));
    const endRaw = finite(decl.window?.end, finite(node.endMs, startRaw + 1_000));
    let start = Math.max(0, Math.min(startRaw, canvasDurationMs));
    let end = Math.max(0, Math.min(endRaw, canvasDurationMs));
    if (end - start < 100) end = Math.min(canvasDurationMs, start + 100);
    if (end - start < 100) start = Math.max(0, end - 100);
    if (end - start < 100) {
      issues.push({ severity: "error", code: "PRESET_WINDOW_INVALID", path, message: `Ventana degenerada (${start}..${end} ms).` });
      return node;
    }

    const schema = applyMotionPresetToSchema(null, nodeId, preset.id, decl.params, { startSec: start / 1_000, endSec: end / 1_000 });
    const clip = schema.clips.find(c => c.layerId === nodeId);
    const windowMs = end - start;
    // El compilador de specs mapea los keyframes al startMs..endMs del NODO:
    // un preset que anima solo una parte de la ventana del nodo se estira.
    // No es un error (el compilador decide), pero se avisa para que el agente
    // alinee ventana del preset y ventana del nodo.
    const nodeStart = finite(node.startMs, 0);
    const nodeEnd = finite(node.endMs, canvasDurationMs);
    if (Math.abs(nodeStart - start) > 1 || Math.abs(nodeEnd - end) > 1) {
      issues.push({
        severity: "warning",
        code: "PRESET_WINDOW_MISMATCH",
        path,
        message: `El preset anima [${start}, ${end}] ms pero el nodo va [${nodeStart}, ${nodeEnd}] ms — usa windowMs igual a la ventana del nodo para evitar estiramiento.`,
      });
    }
    const seeds = clip ? clip.tweens.flatMap(tw => tweenToSeeds(tw as unknown as Parameters<typeof tweenToSeeds>[0], start, windowMs)) : [];

    let emitted = 0;
    let skipped = 0;
    for (const seed of seeds) {
      const signature = `${nodeId}\u0000${seed.property}\u0000${seed.timeMs}`;
      if (collisions.has(signature)) {
        skipped += 1;
        continue;
      }
      collisions.add(signature);
      let id = `kfp-${nodeId}-${seed.property}-${seed.timeMs}`;
      while (usedIds.has(id)) id = `${id}+`;
      usedIds.add(id);
      const kf: NonNullable<SpecLike["keyframes"]>[number] = {
        id, nodeId, property: seed.property, timeMs: seed.timeMs, value: seed.value,
      };
      if (seed.easing) kf.easing = seed.easing;
      generated.push(kf);
      emitted += 1;
    }
    if (skipped > 0) {
      issues.push({ severity: "warning", code: "KEYFRAME_COLLISION", path, message: `${skipped} keyframes del preset se omitieron: ya existían para ese nodo/propiedad/tiempo.` });
    }
    applied.push({ nodeId, preset: preset.id, windowMs: { start, end }, keyframes: emitted, skipped });
    return node;
  });

  return {
    spec: { ...spec, nodes, keyframes: [...existingKeyframes, ...generated] },
    applied,
    issues,
  };
}

// ── REQ-056 F2 — Lottie → spec integration ───────────────────────────────

export interface LottieSpecApplication {
  nodeId: string;
  lottieLayer: string;
  keyframes: number;
  replaced: number;
  windowMs: { start: number; end: number };
}

export interface LottieImportIntoSpecResult {
  ok: boolean;
  /** Spec with Lottie motion injected — validate with the harness next. */
  spec: Record<string, unknown> | null;
  applied: LottieSpecApplication[];
  fidelity: LottieFidelityItem[];
  warnings: LottieImportWarning[];
  issues: SurfaceIssue[];
}

/**
 * Autocorrelates Lottie layers to spec nodes by name (node.id, then
 * node.name; precomp children also match `contenedor/hoja`), maps the motion,
 * and injects numeric keyframes into the spec. Re-import REPLACES the
 * properties the import owns per node (idempotent) and leaves everything
 * else untouched. Visuals are never created — nodes must already exist.
 */
export function importLottieMotionIntoSpec(lottie: unknown, rawSpec: unknown): LottieImportIntoSpecResult {
  const spec = asObj(rawSpec);
  if (!spec) {
    return { ok: false, spec: null, applied: [], fidelity: [], warnings: [], issues: [{ severity: "error", code: "SPEC_REQUIRED", path: "$", message: "El spec debe ser un objeto JSON." }] };
  }
  const nodesRaw = Array.isArray(spec.nodes) ? spec.nodes : [];
  const autoMap: Record<string, string> = {};
  for (const raw of nodesRaw) {
    const node = asObj(raw);
    if (!node || typeof node.id !== "string") continue;
    autoMap[node.id] = node.id;
    if (typeof node.name === "string" && node.name.trim()) autoMap[node.name.trim()] = node.id;
  }

  const mapped = mapLottieMotion(lottie, autoMap);
  if (!mapped.schema) {
    const first = mapped.warnings.find(w => w.code === "invalid-input");
    return {
      ok: false,
      spec: null,
      applied: [],
      fidelity: mapped.fidelity,
      warnings: mapped.warnings,
      issues: [{ severity: "error", code: "LOTTIE_INVALID", path: "$", message: first?.message || "El Lottie no se pudo mapear." }],
    };
  }

  const existingKeyframes = (Array.isArray(spec.keyframes) ? spec.keyframes : []).filter(kf => asObj(kf)) as NonNullable<SpecLike["keyframes"]>;
  const applied: LottieSpecApplication[] = [];
  const injectedByNodeProp = new Map<string, NonNullable<SpecLike["keyframes"]>>();
  const staticPropsByNode = new Map<string, Record<string, unknown>>();

  // Pre-cálculo por capa. OJO: el tween de transform tiene prop "transform",
  // pero genera keyframes x/y/scale/rotation — la titularidad se decide sobre
  // las seeds reales, no sobre el prop del tween.
  const layerPlans = mapped.mappedLayers.map(layer => {
    if (!layer.clip) {
      // static-only: plega staticProps en node.props (determinista).
      const props: Record<string, unknown> = {};
      const transform = layer.staticProps.transform !== undefined ? parseCanonicalTransform(layer.staticProps.transform) : null;
      if (transform) {
        props.x = transform.x;
        props.y = transform.y;
        props.scale = transform.scale;
        props.rotation = transform.rotation;
      }
      if (layer.staticProps.opacity !== undefined) props.opacity = Number(layer.staticProps.opacity);
      if (Object.keys(props).length) staticPropsByNode.set(layer.editorLayerId, props);
      return null;
    }
    const windowStartMs = Math.round(layer.clip.startSec * 1_000);
    const windowMs = Math.round((layer.clip.endSec - layer.clip.startSec) * 1_000);
    const seeds = layer.clip.tweens.flatMap(tw => tweenToSeeds(tw as unknown as Parameters<typeof tweenToSeeds>[0], windowStartMs, windowMs));
    return { layer, windowStartMs, windowMs, seeds };
  }).filter((plan): plan is NonNullable<typeof plan> => plan !== null);

  // (nodeId, property) que este import reemplaza — calculado ANTES de generar
  // ids: los ids de los keyframes propios quedan libres para reusarse, así
  // re-importar el mismo archivo produce el mismo spec (idempotencia).
  const ownedPropsByNode = new Map<string, Set<string>>();
  for (const plan of layerPlans) {
    const props = ownedPropsByNode.get(plan.layer.editorLayerId) ?? new Set<string>();
    for (const seed of plan.seeds) props.add(seed.property);
    ownedPropsByNode.set(plan.layer.editorLayerId, props);
  }
  const ownedByImport = (kf: { nodeId?: unknown; property?: unknown }): boolean =>
    ownedPropsByNode.get(String(kf.nodeId))?.has(String(kf.property)) ?? false;
  const usedIds = new Set(existingKeyframes.filter(kf => !ownedByImport(asObj(kf)!)).map(kf => String(asObj(kf)?.id ?? "")));

  for (const { layer, windowStartMs, windowMs, seeds } of layerPlans) {
    const nodeId = layer.editorLayerId;
    const injected: NonNullable<SpecLike["keyframes"]> = [];
    for (const seed of seeds) {
      let id = `kfl-${nodeId}-${seed.property}-${seed.timeMs}`;
      while (usedIds.has(id)) id = `${id}+`;
      usedIds.add(id);
      const kf: NonNullable<SpecLike["keyframes"]>[number] = {
        id, nodeId, property: seed.property, timeMs: seed.timeMs, value: seed.value,
      };
      if (seed.easing) kf.easing = seed.easing;
      injected.push(kf);
    }
    for (const property of new Set(injected.map(kf => kf.property))) {
      injectedByNodeProp.set(`${nodeId}\u0000${property}`, injected.filter(kf => kf.property === property));
    }
    applied.push({
      nodeId,
      lottieLayer: layer.lottieLayer,
      keyframes: injected.length,
      replaced: 0,
      windowMs: { start: windowStartMs, end: windowStartMs + windowMs },
    });
  }

  const kept = existingKeyframes.filter(kf => !ownedByImport(kf));
  for (const a of applied) {
    a.replaced = existingKeyframes.filter(kf => kf.nodeId === a.nodeId && ownedByImport(kf)).length;
  }

  const nodes = nodesRaw.map(raw => {
    const node = { ...(asObj(raw) || {}) } as SpecNodeLike;
    if (typeof node.id !== "string") return node;
    const statics = staticPropsByNode.get(node.id);
    if (statics) node.props = { ...(asObj(node.props) || {}), ...statics };
    return node;
  });

  return {
    ok: true,
    spec: { ...spec, nodes, keyframes: [...kept, ...[...injectedByNodeProp.values()].flat()] },
    applied,
    fidelity: mapped.fidelity,
    warnings: mapped.warnings,
    issues: [],
  };
}

/** Canonical transform helper re-exported for surface tests/tools. */
export { canonicalTransform };

/** Sanitized params of one preset — for tools that preview a preset's
 *  behavior before applying it (defaults when params are omitted). */
export function motionPresetParamsPayload(presetId: string): { preset: string; params: Record<string, unknown> } | null {
  const preset = findMotionPreset(presetId);
  if (!preset) return null;
  return { preset: preset.id, params: sanitizeMotionParams(preset, null) };
}
