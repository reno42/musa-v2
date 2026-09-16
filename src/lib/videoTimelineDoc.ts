/**
 * videoTimelineDoc — persisted, template-level state of the Video Mode
 * timeline that does NOT live on frames. Rides templates.data JSONB next to
 * frames / canvasObjects (validate.ts whitelists the key) — no migration.
 *
 * v2 schema (Video Mode v3):
 *   • audioClips — music/voice clips on the free audio track.
 *   • mediaClips — REAL video/image files as overlay clips ("capas de video"
 *     a lo CapCut): positioned anywhere on the timeline, trimmed from their
 *     source, composited ON TOP of the magnetic take track. Binaries live in
 *     Supabase Storage; only public URLs here.
 *   • textClips — captions/stickers: styled text windows over the reel.
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

export interface ReelMediaClip {
  id: string;
  kind: "video" | "image";
  name: string;
  url: string;
  /** Global position on the timeline (overlay lane). */
  startSec: number;
  /** Displayed duration (video: trimmed window; image: free). */
  durationSec: number;
  /** Video only: source in-point of the trimmed window. */
  trimInSec: number;
  /** Video only: probed full source duration (0 for images). */
  sourceDurationSec: number;
  /** 0..1.5 — the clip's own audio (videos). */
  volume: number;
  /** Per-clip CSS filter ("" = none). */
  filter: string;
}

export interface ReelTextClip {
  id: string;
  text: string;
  startSec: number;
  durationSec: number;
  /** Anchor position as % of frame size (0..100). */
  xPct: number;
  yPct: number;
  /** Font size as % of frame height (≈4..20). */
  sizePct: number;
  color: string;
  font: string;
  weight: number;
  /** Background pill ("" = none), e.g. "rgba(0,0,0,0.55)". */
  bg: string;
  anim: "none" | "fade" | "pop" | "slide-up";
}

export interface VideoTimelineDoc {
  version: 2;
  audioClips: ReelAudioClip[];
  mediaClips: ReelMediaClip[];
  textClips: ReelTextClip[];
}

export function emptyVideoTimelineDoc(): VideoTimelineDoc {
  return { version: 2, audioClips: [], mediaClips: [], textClips: [] };
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** Defensive parse of whatever the server returns (v1 docs migrate: they
 *  simply carry no media/text clips). */
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
          name: str(clip.name, 120) || "audio",
          url: clip.url as string,
          startSec: clamp(num(clip.startSec, 0), 0, 3600),
          durationSec: clamp(num(clip.durationSec, 10), 0.2, 3600),
          volume: clamp(num(clip.volume, 1), 0, 1.5),
          fadeInSec: clamp(num(clip.fadeInSec, 0), 0, 5),
          fadeOutSec: clamp(num(clip.fadeOutSec, 0), 0, 5),
        };
      });
  }

  if (Array.isArray(r.mediaClips)) {
    doc.mediaClips = r.mediaClips
      .filter(c => c && typeof c === "object" && typeof (c as ReelMediaClip).url === "string" && (c as ReelMediaClip).url)
      .map((c, i) => {
        const clip = c as Partial<ReelMediaClip>;
        const kind = clip.kind === "image" ? "image" : "video";
        return {
          id: typeof clip.id === "string" && clip.id ? clip.id : `media_${Date.now()}_${i}`,
          kind,
          name: str(clip.name, 120) || (kind === "image" ? "imagen" : "video"),
          url: clip.url as string,
          startSec: clamp(num(clip.startSec, 0), 0, 3600),
          durationSec: clamp(num(clip.durationSec, 4), 0.2, 3600),
          trimInSec: clamp(num(clip.trimInSec, 0), 0, 3600),
          sourceDurationSec: clamp(num(clip.sourceDurationSec, 0), 0, 36000),
          volume: clamp(num(clip.volume, 1), 0, 1.5),
          filter: str(clip.filter, 300),
        };
      });
  }

  if (Array.isArray(r.textClips)) {
    doc.textClips = r.textClips
      .filter(c => c && typeof c === "object" && typeof (c as ReelTextClip).text === "string")
      .map((c, i) => {
        const clip = c as Partial<ReelTextClip>;
        const anim = ["none", "fade", "pop", "slide-up"].includes(clip.anim as string)
          ? (clip.anim as ReelTextClip["anim"]) : "fade";
        return {
          id: typeof clip.id === "string" && clip.id ? clip.id : `text_${Date.now()}_${i}`,
          text: str(clip.text, 400),
          startSec: clamp(num(clip.startSec, 0), 0, 3600),
          durationSec: clamp(num(clip.durationSec, 3), 0.2, 3600),
          xPct: clamp(num(clip.xPct, 50), 0, 100),
          yPct: clamp(num(clip.yPct, 80), 0, 100),
          sizePct: clamp(num(clip.sizePct, 8), 2, 40),
          color: str(clip.color, 60) || "#ffffff",
          font: str(clip.font, 120) || "inherit",
          weight: clamp(num(clip.weight, 700), 100, 900),
          bg: str(clip.bg, 60),
          anim,
        };
      })
      .filter(c => c.text.length > 0);
  }

  return doc;
}
