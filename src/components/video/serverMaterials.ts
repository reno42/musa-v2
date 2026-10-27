/**
 * serverMaterials — creación server-first de materials/tracks/segments para
 * los paneles del editor standalone (REQ-063: Voz IA y Subtítulos).
 *
 * Mismo contrato que MediaBin: el POST devuelve la fila REAL (id del server),
 * y el llamador la absorbe con apply → absorbSaved, así el autosave NUNCA
 * re-POSTea lo que ya existe.
 *
 * TODAS las funciones reciben el doc EXPLÍCITO y devuelven el doc MÁS NUEVO:
 * encadenar material → segment necesita el doc post-creación, no el snapshot
 * inicial del render (stale closure). Null = falló (ya reportado a onError).
 */
import { apiFetch } from "../../lib/supabase";
import type { VideoApplyMeta, VideoMaterial, VideoProjectDoc, VideoSegment, VideoTrack } from "../../lib/videoProjectStore";

type ApplyFn = (next: VideoProjectDoc, meta: VideoApplyMeta) => void;
type OnError = (msg: string) => void;

/** POST /materials → fila real + doc nuevo. Null si falló (ya reportado). */
export async function createMaterial(
  doc: VideoProjectDoc,
  apply: ApplyFn,
  onError: OnError,
  kind: string,
  payload: Record<string, unknown>,
  label: string,
): Promise<{ material: VideoMaterial; doc: VideoProjectDoc } | null> {
  try {
    const pid = encodeURIComponent(doc.project.id);
    const res = await apiFetch<{ data: { material: VideoMaterial } }>(`/api/video-projects/${pid}/materials`, {
      method: "POST",
      body: JSON.stringify({ kind, payload }),
    });
    const material = res?.data?.material;
    if (!material) throw new Error("La respuesta no incluyó el material.");
    const next: VideoProjectDoc = { ...doc, materials: [...doc.materials, { ...material, slot: material.slot ?? null }] };
    apply(next, { label });
    return { material, doc: next };
  } catch (cause) {
    onError(cause instanceof Error ? cause.message : "No se pudo crear el material.");
    return null;
  }
}

/** Track compatible con `type`; lo crea server-first si no existe. */
export async function ensureTrack(
  doc: VideoProjectDoc,
  apply: ApplyFn,
  onError: OnError,
  type: "audio" | "text",
): Promise<{ track: VideoTrack; doc: VideoProjectDoc } | null> {
  const existing = doc.tracks.find((t) => t.type === type);
  if (existing) return { track: existing, doc };
  try {
    const pid = encodeURIComponent(doc.project.id);
    const zOrder = doc.tracks.reduce((max, t) => Math.max(max, t.z_order), -1) + 1;
    const res = await apiFetch<{ data: { track: { id: string; project_id: string; type: string; z_order: number } } }>(`/api/video-projects/${pid}/tracks`, {
      method: "POST",
      body: JSON.stringify({ type, zOrder }),
    });
    const row = res?.data?.track;
    if (!row) throw new Error("La respuesta no incluyó el track.");
    const track = { ...row, segments: [] } as unknown as VideoTrack;
    const next: VideoProjectDoc = { ...doc, tracks: [...doc.tracks, track] };
    apply(next, { label: `agregar track de ${type}` });
    return { track, doc: next };
  } catch (cause) {
    onError(cause instanceof Error ? cause.message : `No se pudo crear el track de ${type}.`);
    return null;
  }
}

/** POST /segments sobre un track del doc dado → doc nuevo con el clip. */
export async function placeSegment(
  doc: VideoProjectDoc,
  apply: ApplyFn,
  onError: OnError,
  input: { trackId: string; material: VideoMaterial; startUs: number; durUs: number },
  label: string,
): Promise<VideoProjectDoc | null> {
  try {
    const pid = encodeURIComponent(doc.project.id);
    const res = await apiFetch<{ data: { segment: VideoSegment } }>(`/api/video-projects/${pid}/segments`, {
      method: "POST",
      body: JSON.stringify({
        trackId: input.trackId,
        materialId: input.material.id,
        targetStartUs: Math.max(0, Math.round(input.startUs)),
        targetDurUs: Math.max(1, Math.round(input.durUs)),
        sourceStartUs: 0,
        sourceDurUs: Math.max(1, Math.round(input.durUs)),
      }),
    });
    const segment = res?.data?.segment;
    if (!segment) throw new Error("La respuesta no incluyó el segmento.");
    const seg: VideoSegment = { ...segment, extra_refs: segment.extra_refs ?? [] };
    const next: VideoProjectDoc = {
      ...doc,
      tracks: doc.tracks.map((t) => (t.id === input.trackId
        ? { ...t, segments: [...t.segments, seg].sort((a, b) => a.target_start_us - b.target_start_us) }
        : t)),
    };
    apply(next, { label });
    return next;
  } catch (cause) {
    onError(cause instanceof Error ? cause.message : "No se pudo agregar el clip al timeline.");
    return null;
  }
}
