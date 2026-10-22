/**
 * standaloneVideoExport — puente del proyecto CapCut standalone al encoder
 * probado del Video Mode. Conserva una sola ruta de codec/audio/canvas y
 * traduce las filas `musa_video_*` a sus entradas declarativas.
 */
import { defaultAnimation } from "../../shared/animationSchema.ts";
import {
  downloadVideoBlob,
  exportReelVideo,
  type ReelAudioClipInput,
  type ReelExportMediaClip,
  type ReelExportResult,
} from "./videoExport";
import type { ReelTextClip } from "./videoTimelineDoc";
import type { VideoMaterial, VideoProjectDoc, VideoSegment } from "./videoProjectStore";
import { contentEndUs, materialMap } from "../components/video/videoDocOps";

const US = 1_000_000;

type MediaPayload = { url?: unknown; durationUs?: unknown; name?: unknown; filter?: unknown };
type TextPayload = { text?: unknown; style?: unknown };

function publicUrl(payload: MediaPayload): string | null {
  return typeof payload.url === "string" && /^(https?:\/\/|\/)/.test(payload.url) ? payload.url : null;
}

function seconds(us: number | null | undefined, fallback: number): number {
  return typeof us === "number" && Number.isFinite(us) && us > 0 ? us / US : fallback;
}

function mediaClip(seg: VideoSegment, material: VideoMaterial): ReelExportMediaClip | null {
  if (material.kind !== "video" && material.kind !== "image") return null;
  const payload = material.payload as MediaPayload;
  const url = publicUrl(payload);
  if (!url) return null;
  return {
    kind: material.kind,
    url,
    startSec: seg.target_start_us / US,
    durationSec: seg.target_dur_us / US,
    trimInSec: (seg.source_start_us ?? 0) / US,
    sourceDurationSec: seconds(payload.durationUs as number | undefined, 0),
    volume: 1,
    filter: typeof payload.filter === "string" ? payload.filter : "",
    transform: seg.clip as ReelExportMediaClip["transform"],
  };
}

function textClip(seg: VideoSegment, material: VideoMaterial): ReelTextClip | null {
  if (material.kind !== "text") return null;
  const payload = material.payload as TextPayload;
  if (typeof payload.text !== "string" || !payload.text.trim()) return null;
  const style = payload.style && typeof payload.style === "object" ? payload.style as Record<string, unknown> : {};
  return {
    id: seg.id,
    text: payload.text,
    startSec: seg.target_start_us / US,
    durationSec: seg.target_dur_us / US,
    xPct: 50,
    yPct: 78,
    sizePct: typeof style.fontSize === "number" ? Math.min(28, Math.max(4, style.fontSize * 100)) : 6,
    color: typeof style.color === "string" ? style.color : "#ffffff",
    font: typeof style.fontFamily === "string" ? style.fontFamily : "system-ui, sans-serif",
    weight: typeof style.fontWeight === "number" ? Math.min(900, Math.max(100, style.fontWeight)) : 700,
    bg: typeof style.background === "string" ? style.background : "",
    anim: "fade",
  };
}

async function audioClip(seg: VideoSegment, material: VideoMaterial): Promise<ReelAudioClipInput | null> {
  if (material.kind !== "audio") return null;
  const url = publicUrl(material.payload as MediaPayload);
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo leer el audio ${url}.`);
  return {
    data: await res.arrayBuffer(),
    startSec: seg.target_start_us / US,
    durationSec: seg.target_dur_us / US,
    volume: 1,
    fadeInSec: 0,
    fadeOutSec: 0,
    offsetSec: (seg.source_start_us ?? 0) / US,
    loopWhenShort: false,
  };
}

export interface StandaloneExportOptions {
  format?: "webm" | "mp4";
  scale?: number;
  onProgress?: (fraction: number) => void;
}

/** Exporta el mismo documento que el editor muestra. Los medios cargan desde
 * Storage/URLs públicas; una URL que no permita CORS produce un error útil
 * del encoder en vez de aparentar que se exportó el clip. */
export async function exportStandaloneVideo(
  doc: VideoProjectDoc,
  options: StandaloneExportOptions = {},
): Promise<ReelExportResult> {
  const durationSec = Math.max(0.1, contentEndUs(doc) / US);
  const materials = materialMap(doc);
  const media: ReelExportMediaClip[] = [];
  const texts: ReelTextClip[] = [];
  const audio: ReelAudioClipInput[] = [];

  for (const track of doc.tracks) {
    for (const seg of track.segments) {
      const material = materials.get(seg.material_id);
      if (!material) continue;
      const m = mediaClip(seg, material);
      if (m) { media.push(m); continue; }
      const t = textClip(seg, material);
      if (t) { texts.push(t); continue; }
      if (track.type === "audio") {
        const a = await audioClip(seg, material);
        if (a) audio.push(a);
      }
    }
  }

  const animation = defaultAnimation(doc.project.canvas_w, doc.project.canvas_h);
  animation.timeline.durationSec = durationSec;
  animation.timeline.fps = doc.project.fps;
  return exportReelVideo({
    // Una toma vacía sostiene el canvas. Los materiales standalone se
    // componen por encima desde su timeline real, sin convertirlos a slides.
    frames: [{
      id: doc.project.id,
      html: "<div></div>",
      css: "html,body,#__df_content{margin:0;width:100%;height:100%;background:#000}",
      width: doc.project.canvas_w,
      height: doc.project.canvas_h,
      background: "#000000",
      animation,
    }],
    project: { width: doc.project.canvas_w, height: doc.project.canvas_h, bg: "#000000" },
    fps: doc.project.fps,
    scale: options.scale ?? 1,
    format: options.format ?? "webm",
    mediaClips: media.length ? media : undefined,
    texts: texts.length ? texts : undefined,
    audioTracks: audio.length ? audio : undefined,
    onProgress: options.onProgress,
  });
}

export { downloadVideoBlob };
