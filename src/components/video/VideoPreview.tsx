/**
 * VideoPreview — preview estático en el playhead (REQ-VID11) + rendering de
 * companions de efecto (REQ-VID14 fase 1: DOM/CSS, sin shaders):
 *   · fx-lut        → CSS filter sobre el clip dueño del companion.
 *   · fx-overlay    → veladura con blend mode en el z del clip.
 *   · fx-text-anim  → caption animado (la animación arranca al activarse).
 *   · fx-sticker-kf → imagen con transform interpolado por keyframes.
 * Manifests custom se muestran como badge (feedback de companion presente).
 * variant="fullscreen" (VID12): el mismo stage ocupando el overlay.
 */
import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { VideoProjectDoc, VideoSegment } from "../../lib/videoProjectStore";
import {
  effectsForSegment,
  lutFilterCss,
  overlayStyle,
  stickerKeyframes,
  stickerPlacementStyle,
  stickerTransformAt,
  textAnimClass,
  textAnimInlineStyle,
} from "../../lib/videoEffects";
import { materialMap } from "./videoDocOps";

interface VideoPreviewProps {
  doc: VideoProjectDoc;
  playheadUs: number;
  selectedSegmentId: string | null;
  onSelectSegment: (segmentId: string | null) => void;
  /** El transporte vive en VideoProjectEditor; el monitor solo presenta su
   * estado para que fullscreen no abra un segundo reproductor con audio. */
  playing?: boolean;
  variant?: "inline" | "fullscreen";
}

const safeEffectUrl = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  return /^(https?:\/\/|\/)/.test(raw) ? raw : null;
};

export function VideoPreview({ doc, playheadUs, selectedSegmentId, onSelectSegment, playing = false, variant = "inline" }: VideoPreviewProps) {
  const materials = materialMap(doc);
  const active: Array<{ seg: VideoSegment; z: number }> = [];
  const activeAudio: VideoSegment[] = [];
  for (const t of doc.tracks) {
    for (const s of t.segments) {
      if (playheadUs >= s.target_start_us && playheadUs < s.target_start_us + s.target_dur_us) {
        if (t.type === "audio") activeAudio.push(s);
        else active.push({ seg: s, z: t.z_order });
      }
    }
  }
  active.sort((a, b) => a.z - b.z); // z bajo = fondo, se pinta primero

  const ratio = doc.project.canvas_w / Math.max(1, doc.project.canvas_h);

  // Renderiza los companions kind=effect de un segmento activo (en su z).
  const renderEffects = (seg: VideoSegment) =>
    effectsForSegment(doc, seg).map(({ materialId, effect }) => {
      const params = effect.params;
      switch (effect.manifest.name) {
        case "fx-overlay": {
          return <div key={materialId} className="vp-fx-overlay" style={overlayStyle(params)} aria-hidden="true" />;
        }
        case "fx-text-anim": {
          const text = typeof params.text === "string" && params.text.trim() ? params.text : "Texto";
          return (
            <div
              key={materialId}
              className={`vp-fx-caption ${textAnimClass(params)}`}
              style={textAnimInlineStyle(params)}
            >
              {text}
            </div>
          );
        }
        case "fx-sticker-kf": {
          const url = safeEffectUrl(params.url);
          const kfAt = stickerTransformAt(stickerKeyframes(params), playheadUs - seg.target_start_us);
          if (!url) {
            return (
              <div key={materialId} className="vp-fx-sticker vp-fx-sticker-missing" style={stickerPlacementStyle(kfAt)}>
                sticker sin URL
              </div>
            );
          }
          return (
            <img
              key={materialId}
              className="vp-fx-sticker"
              src={url}
              alt=""
              draggable={false}
              style={stickerPlacementStyle(kfAt)}
            />
          );
        }
        default: {
          return (
            <span key={materialId} className="vp-fx-badge" title={`manifest: ${effect.manifest.name} (${effect.manifest.type})`}>
              {effect.manifest.name}
            </span>
          );
        }
      }
    });

  // CSS filter acumulado de todos los LUT del clip (vida en el clip, no en el stage).
  const lutStyleFor = (seg: VideoSegment): CSSProperties | null => {
    const filters = effectsForSegment(doc, seg)
      .map(({ effect }) => lutFilterCss(effect.params))
      .filter((f): f is string => Boolean(f));
    return filters.length > 0 ? { filter: filters.join(" ") } : null;
  };

  return (
    <div className={variant === "fullscreen" ? "vp-preview-wrap vp-preview-fullscreen" : "vp-preview-wrap"}>
      <div
        className={variant === "fullscreen" ? "vp-stage vp-stage-fullscreen" : "vp-stage"}
        style={{ aspectRatio: `${ratio}` }}
        onPointerDown={() => onSelectSegment(null)}
      >
        {active.length === 0 && (
          <span className="vp-stage-empty">Sin clip en {playheadUs.toLocaleString("es-AR")} µs</span>
        )}
        {active.map(({ seg }) => {
          const m = materials.get(seg.material_id);
          const payload = (m?.payload ?? {}) as { text?: unknown; url?: unknown; style?: unknown };
          const selected = seg.id === selectedSegmentId;
          const lutStyle = lutStyleFor(seg);

          // Material de TEXTO: estilado por payload.style si viene (VID12).
          if (m?.kind === "text" && typeof payload.text === "string") {
            return (
              <div key={seg.id}>
                <div
                  className={selected ? "vp-stage-text vp-stage-selected" : "vp-stage-text"}
                  style={textPayloadStyle(payload.style)}
                  onPointerDown={(e) => { e.stopPropagation(); onSelectSegment(seg.id); }}
                >
                  {payload.text}
                </div>
                {renderEffects(seg)}
              </div>
            );
          }

          const url = safeEffectUrl(payload.url);
          if ((m?.kind === "video" || m?.kind === "image") && url) {
            return (
              <div key={seg.id} className="vp-stage-layer">
                <MediaLayer
                  segment={seg}
                  kind={m.kind}
                  url={url}
                  playheadUs={playheadUs}
                  playing={playing}
                  selected={selected}
                  filter={lutStyle?.filter}
                  onSelect={() => onSelectSegment(seg.id)}
                />
                {renderEffects(seg)}
              </div>
            );
          }

          const name = typeof payload.url === "string" ? (payload.url.split("/").pop() ?? "video") : m?.kind ?? "clip";
          return (
            <div key={seg.id}>
              <div
                className={selected ? "vp-stage-rect vp-stage-selected" : "vp-stage-rect"}
                style={lutStyle ?? undefined}
                onPointerDown={(e) => { e.stopPropagation(); onSelectSegment(seg.id); }}
              >
                <span>{name}</span>
                <span className="vp-stage-rect-time">
                  {((playheadUs - seg.target_start_us) / 1_000_000).toFixed(2)}s
                </span>
              </div>
              {renderEffects(seg)}
            </div>
          );
        })}
        {activeAudio.map((seg) => {
          const material = materials.get(seg.material_id);
          const url = safeEffectUrl((material?.payload as { url?: unknown } | undefined)?.url);
          return url && material?.kind === "audio"
            ? <AudioLayer key={seg.id} segment={seg} url={url} playing={playing} playheadUs={playheadUs} />
            : null;
        })}
      </div>
      {variant === "inline" && (
        <p className="vp-hint" style={{ margin: "8px 0 0", textAlign: "center" }}>
          {doc.project.canvas_w}×{doc.project.canvas_h} · {doc.project.fps} fps · preview de posición
        </p>
      )}
    </div>
  );
}

function AudioLayer({ segment, url, playheadUs, playing }: { segment: VideoSegment; url: string; playheadUs: number; playing: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const localSourceSec = Math.max(0, (segment.source_start_us ?? 0) / 1_000_000
    + ((playheadUs - segment.target_start_us) / 1_000_000) * Math.max(0.01, segment.speed || 1));
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (Math.abs(el.currentTime - localSourceSec) > 0.12) {
      try { el.currentTime = localSourceSec; } catch { /* metadata aún no llegó */ }
    }
    el.playbackRate = Math.min(16, Math.max(0.0625, segment.speed || 1));
    if (playing) void el.play().catch(() => {});
    else el.pause();
  }, [localSourceSec, playing, segment.speed]);
  return <audio ref={audioRef} src={url} preload="auto" />;
}

function MediaLayer({
  segment, kind, url, playheadUs, playing, selected, filter, onSelect,
}: {
  segment: VideoSegment;
  kind: "video" | "image";
  url: string;
  playheadUs: number;
  playing: boolean;
  selected: boolean;
  filter?: string;
  onSelect: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const localSourceSec = Math.max(0, (segment.source_start_us ?? 0) / 1_000_000
    + ((playheadUs - segment.target_start_us) / 1_000_000) * Math.max(0.01, segment.speed || 1));
  const transform = clipStyle(segment.clip);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (Math.abs(el.currentTime - localSourceSec) > 0.12) {
      try { el.currentTime = localSourceSec; } catch { /* metadata aún no llegó */ }
    }
    el.playbackRate = Math.min(16, Math.max(0.0625, segment.speed || 1));
    if (playing) void el.play().catch(() => {});
    else el.pause();
  }, [localSourceSec, playing, segment.speed]);

  const common = {
    className: selected ? "vp-stage-media vp-stage-selected" : "vp-stage-media",
    style: { ...transform, filter },
    onPointerDown: (e: React.PointerEvent) => { e.stopPropagation(); onSelect(); },
  };
  if (kind === "image") return <img {...common} src={url} alt="" draggable={false} />;
  return <video {...common} ref={videoRef} src={url} playsInline preload="auto" />;
}

function clipStyle(raw: VideoSegment["clip"]): CSSProperties {
  const clip = raw && typeof raw === "object" ? raw : {};
  const n = (key: string, fallback: number) => {
    const v = clip[key];
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
  };
  const x = Math.min(1, Math.max(-1, n("x", 0))) * 50;
  const y = Math.min(1, Math.max(-1, n("y", 0))) * 50;
  const scale = Math.min(100, Math.max(0.01, n("scale", 1)));
  const rotate = n("rotation", 0);
  const alpha = Math.min(1, Math.max(0, n("alpha", 1)));
  const flip = clip.flip && typeof clip.flip === "object" ? clip.flip as Record<string, unknown> : null;
  return {
    transform: `translate(${x}%, ${y}%) rotate(${rotate}deg) scale(${scale}) scale(${flip?.x === true ? -1 : 1}, ${flip?.y === true ? -1 : 1})`,
    opacity: alpha,
  };
}

/** Estilo del texto del material (payload.style saneado, mismas reglas que
 *  textAnimInlineStyle — color/fontSize/fontWeight; nada de url()). */
function textPayloadStyle(raw: unknown): CSSProperties | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const style = raw as Record<string, unknown>;
  const out: CSSProperties = {};
  const safe = /^[a-zA-Z0-9#(),.%\s_-]*$/;
  if (typeof style.color === "string" && style.color.length <= 60 && safe.test(style.color) && !/url\(/i.test(style.color)) {
    out.color = style.color;
  }
  if (typeof style.fontSize === "number" && Number.isFinite(style.fontSize)) {
    out.fontSize = `${Math.min(0.28, Math.max(0.04, style.fontSize)) * 100}cqw`;
  }
  if (typeof style.fontWeight === "number" && Number.isFinite(style.fontWeight)) {
    out.fontWeight = Math.min(900, Math.max(100, Math.round(style.fontWeight)));
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
