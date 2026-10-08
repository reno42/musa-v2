/**
 * presetInstances — REQ037 P2.3: non-destructive preset applications.
 *
 * A PresetInstance keeps the authoring params LIVE: the clips it owns are
 * tagged with `instanceId`, so re-applying regenerates exactly those clips
 * (other layers and hand-authored clips are never touched) and "convert to
 * keyframes" bakes them by stripping the tag. Pure functions in, schema out
 * — every write runs through normalizeAnimation like the rest of the
 * authoring helpers, so editor, MCP and undo stay on one code path.
 */

import {
  normalizeAnimation,
  type AnimationSchema,
  type Clip,
  type PresetInstance,
} from "../../shared/animationSchema.ts";

export type { PresetInstance } from "../../shared/animationSchema.ts";

export interface InstanceEditResult {
  schema: AnimationSchema | null;
  /** The instance as recorded after the edit (null = removed). */
  instance: PresetInstance | null;
}

/** Stable per-layer·preset instance id — one active instance per pair. */
export function instanceIdFor(layerId: string, presetId: string): string {
  return `inst-${presetId}-${layerId}`;
}

/** Insert/replace an instance: drops the clips it previously owned, inserts
 *  the fresh build tagged with the instance id, and records the params.
 *  `replacedClips` = the clips the caller already removed (e.g. the wall
 *  bounce replaces ALL of the layer's clips, matching its P1.7 contract). */
export function upsertPresetInstance(
  schemaIn: AnimationSchema | null | undefined,
  instance: PresetInstance,
  freshClips: Clip[],
): InstanceEditResult {
  const base = schemaIn ? normalizeAnimation(schemaIn) : null;
  if (!base) return { schema: null, instance: null };
  const tagged = freshClips.map(c => ({ ...c, instanceId: instance.id }));
  const kept = base.clips.filter(c => c.instanceId !== instance.id);
  const instances = [
    ...(base.instances || []).filter(i => i.id !== instance.id),
    instance,
  ];
  const schema = normalizeAnimation({ ...base, clips: [...kept, ...tagged], instances }) || null;
  return schema ? { schema, instance } : { schema: null, instance: null };
}

/** "Convertir a keyframes": the owned clips stay EXACTLY as they are but
 *  lose their tag (hand-authored from now on) and the record is removed. */
export function bakePresetInstance(
  schemaIn: AnimationSchema | null | undefined,
  instanceId: string,
): InstanceEditResult {
  const base = schemaIn ? normalizeAnimation(schemaIn) : null;
  if (!base) return { schema: null, instance: null };
  const clips = base.clips.map(c => {
    if (c.instanceId !== instanceId) return c;
    const { instanceId: _drop, ...rest } = c;
    return rest;
  });
  const instances = (base.instances || []).filter(i => i.id !== instanceId);
  const schema = normalizeAnimation({ ...base, clips, instances }) || null;
  return schema ? { schema, instance: null } : { schema: null, instance: null };
}

/** Remove an instance — `withClips` true also deletes the clips it owns
 *  (full undo of the preset); false behaves like a bake. */
export function removePresetInstance(
  schemaIn: AnimationSchema | null | undefined,
  instanceId: string,
  withClips: boolean,
): InstanceEditResult {
  const base = schemaIn ? normalizeAnimation(schemaIn) : null;
  if (!base) return { schema: null, instance: null };
  const clips = withClips
    ? base.clips.filter(c => c.instanceId !== instanceId)
    : base.clips;
  const instances = (base.instances || []).filter(i => i.id !== instanceId);
  const schema = normalizeAnimation({ ...base, clips, instances }) || null;
  return schema ? { schema, instance: null } : { schema: null, instance: null };
}

/** The live instance of a layer·preset pair (or of any preset when
 *  `presetId` is omitted — first match). */
export function instanceOfLayer(
  schemaIn: AnimationSchema | null | undefined,
  layerId: string,
  presetId?: string,
): PresetInstance | null {
  const base = schemaIn ? normalizeAnimation(schemaIn) : null;
  const found = (base?.instances || []).find(i =>
    i.layerId === layerId && (!presetId || i.presetId === presetId));
  return found || null;
}
