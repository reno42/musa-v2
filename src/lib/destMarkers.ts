/**
 * destMarkers — REQ038 P2.4: canvas destinations ("punto de la i") + layer
 * links (the no-code "ride the leader" rule). Pure functions in, schema out —
 * every write runs through normalizeAnimation like the rest of the authoring
 * helpers, so editor, MCP and QA share one code path.
 */

import {
  normalizeAnimation,
  type AnimationSchema,
  type DestMarker,
  type LayerLink,
} from "../../shared/animationSchema.ts";

export type { DestMarker, LayerLink } from "../../shared/animationSchema.ts";

/** Fresh marker id — timestamp+rand keeps undo/redo collisions away. */
export function newMarkerId(): string {
  return `mark-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Insert or replace a marker (id = identity). */
export function upsertDestMarker(
  schemaIn: AnimationSchema | null | undefined,
  marker: DestMarker,
): AnimationSchema | null {
  const base = schemaIn ? normalizeAnimation(schemaIn) : null;
  if (!base) return null;
  const markers = [...(base.markers || []).filter(m => m.id !== marker.id), marker];
  return normalizeAnimation({ ...base, markers }) || null;
}

/** Drag edit: move a marker in frame px, everything else untouched. */
export function moveDestMarker(
  schemaIn: AnimationSchema | null | undefined,
  markerId: string,
  x: number,
  y: number,
): AnimationSchema | null {
  const base = schemaIn ? normalizeAnimation(schemaIn) : null;
  if (!base) return null;
  const markers = (base.markers || []).map(m =>
    m.id === markerId ? { ...m, x, y } : m);
  return normalizeAnimation({ ...base, markers }) || null;
}

export function deleteDestMarker(
  schemaIn: AnimationSchema | null | undefined,
  markerId: string,
): AnimationSchema | null {
  const base = schemaIn ? normalizeAnimation(schemaIn) : null;
  if (!base) return null;
  return normalizeAnimation({ ...base, markers: (base.markers || []).filter(m => m.id !== markerId) }) || null;
}

/** Set the follower's link — ONE leader per follower (replaces any previous
 *  rule of the same follower). Single-hop validity is normalize's job; the
 *  caller surfaces the rejection. */
export function setLayerLink(
  schemaIn: AnimationSchema | null | undefined,
  link: LayerLink,
): AnimationSchema | null {
  const base = schemaIn ? normalizeAnimation(schemaIn) : null;
  if (!base) return null;
  const links = [...(base.links || []).filter(l => l.followerId !== link.followerId), link];
  const next = normalizeAnimation({ ...base, links });
  // A normalize that DROPPED the link (cycle guard) must not look like success.
  if (!next || !(next.links || []).some(l => l.id === link.id)) return null;
  return next;
}

export function deleteLayerLink(
  schemaIn: AnimationSchema | null | undefined,
  linkId: string,
): AnimationSchema | null {
  const base = schemaIn ? normalizeAnimation(schemaIn) : null;
  if (!base) return null;
  return normalizeAnimation({ ...base, links: (base.links || []).filter(l => l.id !== linkId) }) || null;
}

/** The link that makes `layerId` a follower (or null). */
export function linkForFollower(
  schemaIn: AnimationSchema | null | undefined,
  layerId: string,
): LayerLink | null {
  const base = schemaIn ? normalizeAnimation(schemaIn) : null;
  return (base?.links || []).find(l => l.followerId === layerId) || null;
}
