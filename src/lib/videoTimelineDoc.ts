/**
 * videoTimelineDoc — persisted, template-level state of the Video Mode
 * timeline that does NOT live on frames (audio clip placement, future
 * timeline preferences). Rides templates.data JSONB next to frames /
 * canvasObjects (validate.ts whitelists the key) — no migration needed.
 */

export interface ReelAudioClip {
  id: string;
  name: string;
  /** Public URL (Supabase Storage) — never a data URL in the JSONB. */
  url: string;
  startSec: number;
  durationSec: number;
  /** 0..1.5. */
  volume: number;
  fadeInSec: number;
  fadeOutSec: number;
}

export interface VideoTimelineDoc {
  version: 1;
  audioClips: ReelAudioClip[];
}

export function emptyVideoTimelineDoc(): VideoTimelineDoc {
  return { version: 1, audioClips: [] };
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Defensive parse of whatever the server returns (or a stale doc shape). */
export function normalizeVideoTimelineDoc(raw: unknown): VideoTimelineDoc {
  const doc = emptyVideoTimelineDoc();
  if (!raw || typeof raw !== "object") return doc;
  const r = raw as Partial<VideoTimelineDoc>;
  if (Array.isArray(r.audioClips)) {
    doc.audioClips = r.audioClips
      .filter(c => c && typeof c === "object" && typeof (c as ReelAudioClip).url === "string" && (c as ReelAudioClip).url)
      .map((c, i) => {
        const clip = c as Partial<ReelAudioClip>;
        return {
          id: typeof clip.id === "string" && clip.id ? clip.id : `audio_${Date.now()}_${i}`,
          name: typeof clip.name === "string" ? clip.name.slice(0, 120) : "audio",
          url: clip.url as string,
          startSec: clamp(Number(clip.startSec) || 0, 0, 3600),
          durationSec: clamp(Number(clip.durationSec) || 10, 0.2, 3600),
          volume: clamp(Number(clip.volume ?? 1), 0, 1.5),
          fadeInSec: clamp(Number(clip.fadeInSec) || 0, 0, 5),
          fadeOutSec: clamp(Number(clip.fadeOutSec) || 0, 0, 5),
        };
      });
  }
  return doc;
}
