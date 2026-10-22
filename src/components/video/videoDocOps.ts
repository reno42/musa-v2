/**
 * videoDocOps — helpers PUROS de mutación del doc de video (REQ-VID11/12).
 * Todos devuelven un doc NUEVO (inmutable): el store los convierte en
 * comandos undoable con snapshot before/after. Nada de mutar in place.
 */
import type { VideoMaterial, VideoProjectDoc, VideoSegment, VideoTrack } from "../../lib/videoProjectStore";
import type { SegmentTiming } from "../../lib/videoTimelineMath";

export function findSegment(doc: VideoProjectDoc, segmentId: string | null): VideoSegment | null {
  if (!segmentId) return null;
  for (const t of doc.tracks) {
    const hit = t.segments.find((s) => s.id === segmentId);
    if (hit) return hit;
  }
  return null;
}

export function findTrack(doc: VideoProjectDoc, trackId: string | null): VideoTrack | null {
  if (!trackId) return null;
  return doc.tracks.find((t) => t.id === trackId) ?? null;
}

/** Reemplaza el timing de un segmento manteniendo el resto de sus campos. */
export function updateSegmentTiming(
  doc: VideoProjectDoc,
  segmentId: string,
  timing: SegmentTiming,
): VideoProjectDoc {
  return {
    ...doc,
    tracks: doc.tracks.map((t) => ({
      ...t,
      segments: t.segments.map((s) => (s.id === segmentId
        ? {
            ...s,
            target_start_us: Math.max(0, Math.round(timing.target_start_us)),
            target_dur_us: Math.max(1, Math.round(timing.target_dur_us)),
            source_start_us: timing.source_start_us,
            source_dur_us: timing.source_dur_us,
            speed: timing.speed,
          }
        : s)),
    })),
  };
}

/** Quita un segmento del doc (borrado optimista: el autosave manda DELETE). */
export function removeSegment(doc: VideoProjectDoc, segmentId: string): VideoProjectDoc {
  return {
    ...doc,
    tracks: doc.tracks.map((t) => ({ ...t, segments: t.segments.filter((s) => s.id !== segmentId) })),
  };
}

/** Agrega (o re-agrega, tras undo) un segmento ya existente en el doc. */
export function putSegment(doc: VideoProjectDoc, segment: VideoSegment): VideoProjectDoc {
  const exists = findSegment(doc, segment.id);
  const tracks = doc.tracks.map((t) => {
    if (t.id !== segment.track_id) return t;
    const segments = exists
      ? t.segments.map((s) => (s.id === segment.id ? segment : s))
      : [...t.segments, segment].sort((a, b) => a.target_start_us - b.target_start_us);
    return { ...t, segments };
  });
  return { ...doc, tracks };
}

/** durationUs del material si el payload la declara (clamp CapCut del trim). */
export function materialDurationUs(material: VideoMaterial | null): number | null {
  const dur = (material?.payload as { durationUs?: unknown } | undefined)?.durationUs;
  return typeof dur === "number" && Number.isFinite(dur) && dur > 0 ? Math.round(dur) : null;
}

export function materialMap(doc: VideoProjectDoc): Map<string, VideoMaterial> {
  return new Map(doc.materials.map((m) => [m.id, m]));
}

/** Fin del contenido (max target_end) — largo del timeline en µs. */
export function contentEndUs(doc: VideoProjectDoc): number {
  let end = 0;
  for (const t of doc.tracks) {
    for (const s of t.segments) {
      end = Math.max(end, s.target_start_us + s.target_dur_us);
    }
  }
  return end;
}

/** Track que recibe un material según su kind (video→video, audio→audio,
 *  texto/sticker→text). Null si no existe track compatible. */
export function trackForMaterialKind(doc: VideoProjectDoc, kind: string): VideoTrack | null {
  const want = kind === "audio" ? "audio" : kind === "text" ? "text" : "video";
  return doc.tracks.find((t) => t.type === want) ?? null;
}

/** Id de segmento generado en el cliente con el MISMO formato del service
 *  (vidseg_ + 12 hex): los add* aceptan id explícito, así la mitad derecha
 *  del split nace con id real y su undo la borra sin huérfanos. */
export function genSegmentId(): string {
  const bytes = new Uint8Array(6);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return "vidseg_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Split CapCut en `atUs` (VID12): la mitad IZQUIERDA conserva el id (el
 * autosave la manda como segment.patch) y la DERECHA nace con id nuevo
 * explícito (segment.add). Regla de oro por mitad: source_dur' =
 * round(target_dur' × speed) — el total de source consumido no cambia (± el
 * redondeo), así el clamp al fin del material se mantiene. Texto/sticker sin
 * source: se MATERIALIZA en ambas mitades igual que en el primer trim —
 * así el segment.add del autosave guarda exactamente lo que se previsualizó
 * (cero drift). Null si el corte no deja dos mitades de ≥ 1 µs.
 */
export function splitSegment(
  doc: VideoProjectDoc,
  segmentId: string,
  atUs: number,
  newId: string,
): VideoProjectDoc | null {
  const seg = findSegment(doc, segmentId);
  if (!seg) return null;
  const endUs = seg.target_start_us + seg.target_dur_us;
  const leftTarget = Math.round(atUs - seg.target_start_us);
  const rightTarget = Math.round(endUs - atUs);
  if (!Number.isFinite(leftTarget) || !Number.isFinite(rightTarget)) return null;
  if (leftTarget < 1 || rightTarget < 1) return null;
  const speed = seg.speed > 0 ? seg.speed : 1;
  const leftSourceDur = Math.max(1, Math.round(leftTarget * speed));
  const rightSourceDur = Math.max(1, Math.round(rightTarget * speed));
  const srcStart0 = seg.source_start_us ?? 0;
  const left: VideoSegment = {
    ...seg,
    target_dur_us: leftTarget,
    source_start_us: srcStart0,
    source_dur_us: leftSourceDur,
  };
  const right: VideoSegment = {
    ...seg,
    id: newId,
    target_start_us: Math.max(0, Math.round(atUs)),
    target_dur_us: rightTarget,
    source_start_us: Math.max(0, srcStart0 + leftSourceDur),
    source_dur_us: rightSourceDur,
  };
  return {
    ...doc,
    tracks: doc.tracks.map((t) => (t.id === seg.track_id
      ? { ...t, segments: [...t.segments.map((s) => (s.id === segmentId ? left : s)), right].sort((a, b) => a.target_start_us - b.target_start_us) }
      : t)),
  };
}
