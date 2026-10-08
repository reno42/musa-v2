/**
 * presetLibrary — REQ040 P2.6: one library, one apply path.
 *
 * The card UI (AnimationPanel) and any future host share this module:
 * search/filter over the catalog, the hover-preview CSS built from each
 * preset's OWN tweens (same per-segment easing the engine runs), the
 * compatibility gate with the exact user-facing messages, and
 * applyPresetConsistent — the only way a generic preset lands in a schema
 * (clip tagged + live PresetInstance record, sibling instances of the layer
 * dropped). Every gate failure returns the reason and leaves the document
 * untouched.
 */

import {
  ANIMATION_PRESETS,
  findPreset,
  normalizeAnimation,
  normalizeEasing,
  applyPresetToSchema,
  type AnimationPreset,
  type AnimationSchema,
  type PresetCategory,
  type Tween,
} from "../../shared/animationSchema.ts";
import { instanceIdFor } from "./presetInstances.ts";

export type { PresetCategory, AnimationPreset } from "../../shared/animationSchema.ts";

// ── Search / categories ──────────────────────────────────────────

/** Catalog filter: category chip + free text (matches label, about, id). */
export function filterPresets(query: string, category: PresetCategory | "all"): AnimationPreset[] {
  const q = query.trim().toLowerCase();
  return ANIMATION_PRESETS.filter(p =>
    (category === "all" || p.category === category) &&
    (!q || `${p.label} ${p.about} ${p.id}`.toLowerCase().includes(q)));
}

// ── Compatibility gate (verbatim messages per P2.6 §10.2) ────────

export interface PresetTarget {
  layerId: string;
  /** false = not a visual layer (audio track, empty selection…). */
  visual: boolean;
  /** Set when the incompatible target is specifically an audio track. */
  kind?: "audio";
}

export type PresetCompat =
  | { ok: true }
  | { ok: false; reason: string };

/** Shown BEFORE anything happens: no target, non-visual target, or an
 *  unknown preset id refuse to apply and explain why. */
export function checkPresetCompat(presetId: string, target: PresetTarget | null): PresetCompat {
  const preset = findPreset(presetId);
  if (!preset) return { ok: false, reason: `Preset desconocido: ${presetId}` };
  if (!target || !target.layerId) {
    return { ok: false, reason: `Selecciona un objeto para aplicar ${preset.label}` };
  }
  if (!target.visual) {
    return {
      ok: false,
      reason: target.kind === "audio"
        ? "Este efecto requiere un objeto visual; la pista Audio no es compatible"
        : "Este efecto requiere un objeto visual",
    };
  }
  return { ok: true };
}

// ── Hover previews (CSS built from the preset's own tweens) ──────

/** Stable keyframes name per preset id. */
export function previewName(presetId: string): string {
  return `musapv-${presetId.replace(/[^a-z0-9-]/gi, "")}`;
}

/** One @keyframes rule per preset, merging its tweens on the shared 0..1
 *  axis. Each stop carries the OWNING tween's easing as
 *  animation-timing-function — the same interpolation the engine runs, so
 *  the hover preview is faithful, not decorative. (Limitation: stops shared
 *  by tweens with DIFFERENT easings take the first tween's — true for every
 *  preset today.) */
function previewKeyframes(preset: AnimationPreset): string {
  const stops = new Map<number, string[]>();
  for (const tween of preset.tweens) {
    const timing = `animation-timing-function: ${normalizeEasing(tween.easing)};`;
    tween.keyframes.forEach((k, i) => {
      const decls = stops.get(k.t) || [];
      if (i < tween.keyframes.length - 1) decls.push(timing);
      decls.push(`${tween.prop}: ${k.value};`);
      stops.set(k.t, decls);
    });
  }
  const body = [...stops.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, decls]) => `  ${Math.round(t * 100)}% { ${decls.join(" ")} }`)
    .join("\n");
  return `@keyframes ${previewName(preset.id)} {\n${body}\n}`;
}

/** The <style> block a card grid needs (dedup happens by construction —
 *  one rule per preset id). */
export function previewCssBlock(presets: readonly AnimationPreset[]): string {
  return presets.map(previewKeyframes).join("\n");
}

/** Outer animation shorthand: loops while hovered/focused. Segments ride
 *  the per-stop timing functions above, so the outer easing stays linear. */
export function previewAnimationValue(presetId: string, durationMs = 1300): string {
  return `${previewName(presetId)} ${durationMs}ms linear infinite`;
}

/** The tween surface the preview relies on (kept for QA symmetry). */
export function previewTweenProps(preset: AnimationPreset): string[] {
  return preset.tweens.map((t: Tween) => t.prop);
}

// ── Consistent apply / removal ───────────────────────────────────

export type PresetApplyResult =
  | { ok: true; schema: AnimationSchema; instanceId: string }
  | { ok: false; reason: string };

/** THE apply path for generic presets ("aplicación consistente", P2.6):
 *  compat gate → clip via applyPresetToSchema (replaces the layer's whole
 *  clip, keeps its window) → clip tagged + recorded as a live PresetInstance
 *  with params {} (generic presets are param-less; wallBounce keeps its own
 *  params flow). One active preset per layer: applying drops that layer's
 *  sibling instance records — the clip they owned was replaced. */
export function applyPresetConsistent(
  schemaIn: AnimationSchema | null | undefined,
  presetId: string,
  target: PresetTarget,
  windowSec?: { startSec: number; endSec: number },
): PresetApplyResult {
  const gate = checkPresetCompat(presetId, target);
  if (!gate.ok) return gate;
  const withClip = applyPresetToSchema(schemaIn, target.layerId, presetId, windowSec);
  const base = normalizeAnimation(withClip);
  if (!base) return { ok: false, reason: "No se pudo aplicar el preset — el documento quedó intacto" };
  const instId = instanceIdFor(target.layerId, presetId);
  const clip = base.clips.find(c => c.layerId === target.layerId);
  if (!clip) return { ok: false, reason: "No se pudo aplicar el preset — el documento quedó intacto" };
  const schema = normalizeAnimation({
    ...base,
    clips: base.clips.map(c => (c === clip ? { ...c, instanceId: instId } : c)),
    instances: [
      ...(base.instances || []).filter(i => i.layerId !== target.layerId),
      { id: instId, presetId, layerId: target.layerId, params: {} },
    ],
  });
  return schema
    ? { ok: true, schema, instanceId: instId }
    : { ok: false, reason: "No se pudo aplicar el preset — el documento quedó intacto" };
}

/** Consistent removal: the layer's clip AND its instance records go
 *  together, so "quitar" never leaves a dangling record. */
export function removeLayerAnimation(
  schemaIn: AnimationSchema | null | undefined,
  layerId: string,
): AnimationSchema | null {
  const base = schemaIn ? normalizeAnimation(schemaIn) : null;
  if (!base) return null;
  return normalizeAnimation({
    ...base,
    clips: base.clips.filter(c => c.layerId !== layerId),
    instances: (base.instances || []).filter(i => i.layerId !== layerId),
  });
}
