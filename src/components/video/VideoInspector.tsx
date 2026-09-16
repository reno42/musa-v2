/**
 * VideoInspector — the Video Mode's right panel (CapCut property panel).
 * Context-aware: reel summary + export/publish + storage quota when nothing
 * is selected; take / layer-clip / media-clip / text-clip / audio-clip
 * editors when something is.
 *
 * V3 additions: export format picker (WebM/MP4), per-take look filters
 * (V3.2), media-clip editor (V3.4), caption/sticker editor (V3.5), layer
 * effect presets (V3.6) and beat detection (V3.8).
 */

import { normalizeAnimation, type AnimationSchema, type TransitionType, type Tween } from "../../../shared/animationSchema.ts";
import { takeStartSec, type ReelTimeline } from "../../lib/sequencePlayback";
import type { ReelAudioClip, ReelMediaClip, ReelTextClip, VideoTimelineDoc } from "../../lib/videoTimelineDoc";
import type { FrameData } from "../DesignFrame";
import type { TimelineSelection } from "./VideoTimeline";

export interface VideoInspectorProps {
  frames: FrameData[];
  included: FrameData[];
  tl: ReelTimeline;
  doc: VideoTimelineDoc;
  selection: TimelineSelection | null;
  onSelect: (sel: TimelineSelection | null) => void;
  onTakeDuration: (frame: FrameData, d: number) => void;
  onAnimationFrameChange: (frameId: string, next: AnimationSchema | null) => void;
  onTransitionChange: (fromFrame: FrameData, toFrameId: string, next: { type: TransitionType; durationSec: number } | null) => void;
  onFrameReelChange: (frameId: string, reelExcluded: boolean) => void;
  /** V3.2: per-take CSS look ("" = original). */
  onFrameReelFilterChange: (frameId: string, filter: string) => void;
  onAudioChange: (clipId: string, patch: Partial<ReelAudioClip> | null) => void;
  onMediaChange: (clipId: string, patch: Partial<ReelMediaClip> | null) => void;
  onTextChange: (clipId: string, patch: Partial<ReelTextClip> | null) => void;
  /** V3.6: apply an effect preset to a layer clip. */
  onApplyLayerEffect: (frameId: string, layerId: string, effectId: string) => void;
  /** V3.8: detect beats of an audio clip → timeline markers. */
  onDetectBeats: (clipId: string) => void;
  beatsBusy: boolean;
  exporting: boolean;
  progress: number;
  uploading: boolean;
  publishedUrl: string | null;
  onExport: () => void;
  onUploadPublish: () => void;
  onCopyUrl: () => void;
  homogeneous: boolean;
  sizesSummary: string;
  quota: { bytes: number; count: number } | null;
  exportFormat: "webm" | "mp4";
  onExportFormatChange: (f: "webm" | "mp4") => void;
}

const smallBtn: React.CSSProperties = {
  fontSize: 10, padding: "3px 8px", borderRadius: 3,
  border: "1px solid rgba(200,184,152,0.15)", background: "rgba(200,184,152,0.05)",
  color: "#c8b898", cursor: "pointer", fontFamily: "inherit",
};
const inp: React.CSSProperties = {
  background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)",
  color: "#f0ebe0", borderRadius: 4, padding: "2px 5px", fontSize: 10, fontFamily: "monospace",
};
const muted: React.CSSProperties = { fontSize: 10, lineHeight: 1.5, color: "#7a7668" };
const sectionTitle: React.CSSProperties = { fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#9a968a", marginBottom: 6 };

const TRANSITION_LABELS: Record<string, string> = { fade: "Fundido", slide: "Desliza", zoom: "Zoom", wipe: "Barrido" };
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const fmt = (t: number) => `${t.toFixed(2)}s`;
const mb = (b: number) => `${(b / (1024 * 1024)).toFixed(1)} MB`;
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** V3.2 look presets — same CSS filter strings in preview AND export. */
export const REEL_FILTER_PRESETS: Array<{ id: string; label: string; value: string }> = [
  { id: "none", label: "Original", value: "" },
  { id: "warm", label: "Cálido", value: "saturate(1.15) sepia(0.18) brightness(1.03)" },
  { id: "cold", label: "Frío", value: "saturate(1.05) hue-rotate(-12deg) brightness(1.02)" },
  { id: "bw", label: "B/N", value: "grayscale(1) contrast(1.08)" },
  { id: "sepia", label: "Sepia", value: "sepia(0.55) contrast(1.05)" },
  { id: "punch", label: "Contraste", value: "contrast(1.25) saturate(1.1)" },
  { id: "soft", label: "Suave", value: "brightness(1.08) contrast(0.92) saturate(0.95)" },
  { id: "cine", label: "Cine", value: "contrast(1.15) saturate(0.85) brightness(0.97)" },
];

/** V3.6 effect presets for layer clips — tween generators following the
 *  shared grammar (keyframes t 0..1 across the clip window). Tweens replace
 *  same-prop tweens on the clip and keep the rest. The mode root consumes
 *  this list to apply effects through onApplyLayerEffect. */
export const EFFECT_PRESETS: Array<{ id: string; label: string; props: string[]; make: () => Tween[] }> = [
  { id: "shake", label: "Shake", props: ["transform"], make: () => [{
    prop: "transform", easing: "linear",
    keyframes: [0, 0.09, 0.18, 0.27, 0.36, 0.45, 0.55, 0.64, 0.73, 0.82, 0.91, 1].map((t, i) => ({
      t, value: `translateX(${(i % 2 === 0 ? 1 : -1) * 6}px) translateY(0px) scale(1) rotate(0deg)`,
    })),
  }] },
  { id: "pulse", label: "Pulse", props: ["transform"], make: () => [{
    prop: "transform", easing: "ease-in-out",
    keyframes: [
      { t: 0, value: "translateX(0px) translateY(0px) scale(1) rotate(0deg)" },
      { t: 0.5, value: "translateX(0px) translateY(0px) scale(1.06) rotate(0deg)" },
      { t: 1, value: "translateX(0px) translateY(0px) scale(1) rotate(0deg)" },
    ],
  }] },
  { id: "glow", label: "Glow", props: ["filter"], make: () => [{
    prop: "filter", easing: "ease-in-out",
    keyframes: [
      { t: 0, value: "blur(0px) brightness(1)" },
      { t: 0.5, value: "blur(1.5px) brightness(1.35)" },
      { t: 1, value: "blur(0px) brightness(1)" },
    ],
  }] },
  { id: "pop-in", label: "Pop", props: ["transform"], make: () => [{
    prop: "transform", easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
    keyframes: [
      { t: 0, value: "translateX(0px) translateY(0px) scale(0.4) rotate(0deg)" },
      { t: 0.35, value: "translateX(0px) translateY(0px) scale(1.08) rotate(0deg)" },
      { t: 1, value: "translateX(0px) translateY(0px) scale(1) rotate(0deg)" },
    ],
  }] },
  { id: "ken-burns", label: "Ken Burns", props: ["transform"], make: () => [{
    prop: "transform", easing: "linear",
    keyframes: [
      { t: 0, value: "translateX(0px) translateY(0px) scale(1) rotate(0deg)" },
      { t: 1, value: "translateX(0px) translateY(0px) scale(1.12) rotate(0deg)" },
    ],
  }] },
  { id: "fade-in", label: "Fade", props: ["opacity"], make: () => [{
    prop: "opacity", easing: "ease-out",
    keyframes: [{ t: 0, value: "0" }, { t: 0.3, value: "1" }, { t: 1, value: "1" }],
  }] },
];

/** Preset chips + free-form CSS input, shared by the take and media editors. */
function FilterRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const activeId = REEL_FILTER_PRESETS.find(p => p.value === value)?.id ?? null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
        {REEL_FILTER_PRESETS.map(p => (
          <button key={p.id} type="button" title={p.value || "Sin filtro"}
            onClick={() => onChange(p.value)}
            style={{ ...smallBtn, padding: "2px 6px", borderColor: activeId === p.id ? "rgba(200,184,152,0.6)" : undefined, background: activeId === p.id ? "rgba(200,184,152,0.14)" : undefined }}>
            {p.label}
          </button>
        ))}
      </div>
      <input value={value} placeholder="CSS filter custom (ej. contrast(1.2))"
        onChange={e => onChange(e.target.value)} style={{ ...inp, width: "100%" }} />
    </div>
  );
}

export function VideoInspector({
  frames, included, tl, doc, selection, onSelect,
  onTakeDuration, onAnimationFrameChange, onTransitionChange, onFrameReelChange, onFrameReelFilterChange,
  onAudioChange, onMediaChange, onTextChange, onApplyLayerEffect, onDetectBeats, beatsBusy,
  exporting, progress, uploading, publishedUrl, onExport, onUploadPublish, onCopyUrl,
  homogeneous, sizesSummary, quota, exportFormat, onExportFormatChange,
}: VideoInspectorProps) {
  const frameById = new Map(frames.map(f => [f.id, f] as const));

  const patchTimeline = (frame: FrameData, patch: Partial<AnimationSchema["timeline"]>) => {
    const schema = frame.animation ? normalizeAnimation(frame.animation) : null;
    if (!schema) return;
    const next = normalizeAnimation({ ...schema, timeline: { ...schema.timeline, ...patch } });
    if (next) onAnimationFrameChange(frame.id, next);
  };

  const selTake = selection?.kind === "take" ? frameById.get(selection.frameId) || null : null;
  const selTakeIdx = selTake ? included.findIndex(f => f.id === selTake.id) : -1;
  const selAudio = selection?.kind === "audio" ? doc.audioClips.find(c => c.id === selection.clipId) || null : null;
  const selMedia = selection?.kind === "media" ? doc.mediaClips.find(c => c.id === selection.clipId) || null : null;
  const selText = selection?.kind === "text" ? doc.textClips.find(c => c.id === selection.clipId) || null : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "10px 12px", overflow: "auto", flex: 1, minHeight: 0 }}>
      {/* ── Reel + export ── */}
      <div>
        <div style={sectionTitle}>Exportar reel</div>
        {!homogeneous && (
          <div style={{ ...muted, color: "#e0b57a", border: "1px solid rgba(224,181,122,0.3)", borderRadius: 4, padding: 6, marginBottom: 6 }}>
            Tomas con tamaños distintos ({sizesSummary}). Iguala los aspect ratios para exportar.
          </div>
        )}
        <div style={{ display: "flex", gap: 4, marginBottom: 5 }}>
          {(["webm", "mp4"] as const).map(f => (
            <button key={f} type="button" onClick={() => onExportFormatChange(f)} title={f === "mp4" ? "MediaRecorder avc1 + audio en tiempo real" : "WebCodecs VP9/VP8 + Opus"}
              style={{ ...smallBtn, flex: 1, padding: "4px 0", borderColor: exportFormat === f ? "rgba(200,184,152,0.6)" : undefined, background: exportFormat === f ? "rgba(200,184,152,0.14)" : undefined }}>
              {f === "webm" ? "WebM" : "MP4"}
            </button>
          ))}
        </div>
        <button type="button" disabled={exporting || !homogeneous || included.length === 0} onClick={onExport}
          style={{ ...smallBtn, width: "100%", padding: "6px 8px", fontSize: 11, opacity: exporting ? 0.6 : 1 }}>
          {exporting ? `Renderizando… ${Math.round(progress * 100)}%` : `⬇ Exportar reel (${exportFormat === "mp4" ? "MP4" : "WebM"})`}
        </button>
        {exporting && (
          <div style={{ height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 2, marginTop: 6, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progress * 100}%`, background: "#c8b898", transition: "width 120ms linear" }} />
          </div>
        )}
        <div style={{ ...muted, marginTop: 5 }}>
          {included.length} toma{included.length === 1 ? "" : "s"} · {fmt(tl.totalDurationSec)} · {tl.fps} fps · render 100% en el navegador
        </div>
      </div>

      <div>
        <div style={sectionTitle}>Publicar</div>
        <button type="button" disabled={uploading} onClick={onUploadPublish} style={{ ...smallBtn, width: "100%", padding: "5px 8px", opacity: uploading ? 0.6 : 1 }}>
          {uploading ? "Subiendo…" : "⬆ Exportar y subir (URL pública)"}
        </button>
        {publishedUrl && (
          <div style={{ marginTop: 6 }}>
            <div style={{ ...inp, fontSize: 9, wordBreak: "break-all", padding: "4px 6px" }}>{publishedUrl}</div>
            <button type="button" onClick={onCopyUrl} style={{ ...smallBtn, marginTop: 4, width: "100%" }}>
              Copiar URL para mediaUrl (Zernio)
            </button>
          </div>
        )}
        {quota && (
          <div style={{ ...muted, marginTop: 6 }}>
            Storage: {mb(quota.bytes)} en {quota.count} archivo{quota.count === 1 ? "" : "s"}
            <div style={{ height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 2, marginTop: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(100, (quota.bytes / (1024 * 1024 * 1024)) * 100)}%`, background: quota.bytes > 800 * 1024 * 1024 ? "#e07a7a" : "#9fd6a0" }} />
            </div>
            <div style={{ marginTop: 2 }}>límite free tier ≈ 1 GB</div>
          </div>
        )}
      </div>

      {/* ── Selected take ── */}
      {selTake && selTakeIdx >= 0 && (() => {
        const take = tl.takes[selTakeIdx];
        const nextInc = included[selTakeIdx + 1];
        const tr = take?.transitionOut || null;
        return (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={sectionTitle}>Toma seleccionada</div>
            <div style={{ fontSize: 11, color: "#c8b898", fontFamily: "monospace" }}>{selTake.name}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ ...muted, flex: 1 }}>Duración</span>
              <input type="number" min={0.2} max={600} step={0.5} value={selTake.animation?.timeline.durationSec ?? 5}
                onChange={e => onTakeDuration(selTake, parseFloat(e.target.value) || 5)} style={{ ...inp, width: 56 }} />
              <span style={muted}>s</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ ...muted, flex: 1 }}>Loop</span>
              <select value={selTake.animation?.timeline.loop ?? "once"} title="Comportamiento del loop dentro de la toma"
                onChange={e => patchTimeline(selTake, { loop: e.target.value as "once" | "loop" | "pingpong" })}
                style={{ ...inp, flex: 1 }}>
                <option value="once">Once</option>
                <option value="loop">Loop</option>
                <option value="pingpong">Ping-pong</option>
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ ...muted, flex: 1 }}>FPS de la toma</span>
              <input type="number" min={1} max={60} value={selTake.animation?.timeline.fps ?? 30}
                onChange={e => patchTimeline(selTake, { fps: clamp(parseInt(e.target.value, 10) || 30, 1, 60) })} style={{ ...inp, width: 48 }} />
            </div>
            <label style={{ fontSize: 10, color: "#9fd6a0", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
              <input type="checkbox" checked onChange={e => onFrameReelChange(selTake.id, !e.target.checked)} style={{ accentColor: "#9fd6a0" }} />
              entra al reel
            </label>

            {/* V3.2: look filter */}
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={muted}>Look (V3.2) — filtro CSS sobre la toma</span>
              <FilterRow value={selTake.reelFilter || ""} onChange={v => onFrameReelFilterChange(selTake.id, v)} />
            </div>

            {nextInc && (
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={muted}>Transición → «{nextInc.name}»</span>
                <div style={{ display: "flex", gap: 3 }}>
                  {(["fade", "slide", "zoom", "wipe"] as const).map(t => (
                    <button key={t} type="button" title={TRANSITION_LABELS[t]}
                      onClick={() => onTransitionChange(selTake, nextInc.id, { type: t, durationSec: tr?.durationSec ?? 0.6 })}
                      style={{ ...smallBtn, flex: 1, padding: "4px 0", borderColor: tr?.type === t ? "rgba(200,184,152,0.6)" : undefined, background: tr?.type === t ? "rgba(200,184,152,0.14)" : undefined }}>
                      {t === "fade" ? "◐" : t === "slide" ? "⇥" : t === "zoom" ? "⤢" : "▥"}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ ...muted, flex: 1 }}>Duración</span>
                  <input type="number" min={0.1} max={5} step={0.1} value={tr?.durationSec ?? 0.6}
                    onChange={e => onTransitionChange(selTake, nextInc.id, { type: tr?.type ?? "fade", durationSec: clamp(parseFloat(e.target.value) || 0.6, 0.1, 5) })}
                    style={{ ...inp, width: 52 }} />
                  <span style={muted}>s</span>
                </div>
                {tr && (
                  <button type="button" onClick={() => onTransitionChange(selTake, nextInc.id, null)} style={{ ...smallBtn, color: "#e07a7a", borderColor: "rgba(224,122,122,0.3)" }}>
                    Quitar (corte seco)
                  </button>
                )}
              </div>
            )}
            <div style={muted}>Empieza en {fmt(takeStartSec(tl, selTakeIdx))} del reel.</div>
          </div>
        );
      })()}

      {/* ── Selected layer clip ── */}
      {selection?.kind === "layer" && (() => {
        const frame = frameById.get(selection.frameId);
        const schema = frame?.animation ? normalizeAnimation(frame.animation) : null;
        const clip = schema?.clips.find(c => c.layerId === selection.layerId);
        return (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={sectionTitle}>Clip de capa</div>
            <div style={{ fontSize: 11, color: "#c8b898", fontFamily: "monospace" }}>{trunc(selection.layerId, 22)}</div>
            {frame && <div style={muted}>en «{frame.name}»</div>}
            {clip ? (
              <div style={muted}>
                {clip.tweens.length} tween(s) · {fmt(clip.startSec)} → {fmt(clip.endSec)} de la toma
                <br />Arrástralo en el timeline para moverlo o recortarlo (los keyframes se estiran con él).
              </div>
            ) : (
              <div style={muted}>Sin clips.</div>
            )}
            {/* V3.6: effect presets */}
            {frame && clip && (
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={muted}>Efectos (V3.6) — reemplazan tweens de la misma propiedad</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                  {EFFECT_PRESETS.map(ef => (
                    <button key={ef.id} type="button" onClick={() => onApplyLayerEffect(frame.id, selection.layerId, ef.id)}
                      style={{ ...smallBtn, padding: "2px 6px" }}>
                      {ef.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Selected media clip (V3.4) ── */}
      {selMedia && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={sectionTitle}>Clip de media</div>
          <div style={{ fontSize: 11, color: "#c8b898", fontFamily: "monospace", wordBreak: "break-all" }}>
            {selMedia.kind === "image" ? "🖼" : "🎬"} {selMedia.name}
          </div>
          {selMedia.kind === "video" && selMedia.sourceDurationSec > 0 && (
            <div style={muted}>Fuente: {fmt(selMedia.sourceDurationSec)}</div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ ...muted, flex: 1 }}>Empieza en</span>
            <input type="number" min={0} max={3600} step={0.1} value={selMedia.startSec}
              onChange={e => onMediaChange(selMedia.id, { startSec: clamp(parseFloat(e.target.value) || 0, 0, 3600) })} style={{ ...inp, width: 56 }} />
            <span style={muted}>s</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ ...muted, flex: 1 }}>Duración</span>
            <input type="number" min={0.2} max={3600} step={0.2} value={selMedia.durationSec}
              onChange={e => onMediaChange(selMedia.id, { durationSec: clamp(parseFloat(e.target.value) || 4, 0.2, 3600) })} style={{ ...inp, width: 56 }} />
            <span style={muted}>s</span>
          </div>
          {selMedia.kind === "video" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ ...muted, flex: 1 }}>Trim-in</span>
                <input type="number" min={0} max={3600} step={0.1} value={selMedia.trimInSec}
                  onChange={e => onMediaChange(selMedia.id, { trimInSec: clamp(parseFloat(e.target.value) || 0, 0, 3600) })} style={{ ...inp, width: 56 }} />
                <span style={muted}>s</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ ...muted, flex: 1 }}>Volumen</span>
                <input type="range" min={0} max={150} value={Math.round(selMedia.volume * 100)}
                  onChange={e => onMediaChange(selMedia.id, { volume: clamp(parseInt(e.target.value, 10) / 100, 0, 1.5) })}
                  style={{ flex: 1.4, accentColor: "#c8b898" }} />
                <span style={{ ...muted, width: 30, textAlign: "right" }}>{Math.round(selMedia.volume * 100)}%</span>
              </div>
            </>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={muted}>Look del clip</span>
            <FilterRow value={selMedia.filter} onChange={v => onMediaChange(selMedia.id, { filter: v })} />
          </div>
          <button type="button" onClick={() => { onMediaChange(selMedia.id, null); onSelect(null); }} style={{ ...smallBtn, color: "#e07a7a", borderColor: "rgba(224,122,122,0.3)" }}>
            Quitar del timeline
          </button>
        </div>
      )}

      {/* ── Selected text clip (V3.5) ── */}
      {selText && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={sectionTitle}>Texto / sticker</div>
          <textarea value={selText.text} rows={2}
            onChange={e => onTextChange(selText.id, { text: e.target.value })}
            style={{ ...inp, width: "100%", resize: "vertical", fontFamily: "inherit" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ ...muted, flex: 1 }}>X / Y (%)</span>
            <input type="number" min={0} max={100} value={Math.round(selText.xPct)}
              onChange={e => onTextChange(selText.id, { xPct: clamp(parseFloat(e.target.value) || 50, 0, 100) })} style={{ ...inp, width: 46 }} />
            <input type="number" min={0} max={100} value={Math.round(selText.yPct)}
              onChange={e => onTextChange(selText.id, { yPct: clamp(parseFloat(e.target.value) || 50, 0, 100) })} style={{ ...inp, width: 46 }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ ...muted, flex: 1 }}>Tamaño</span>
            <input type="range" min={2} max={40} step={0.5} value={selText.sizePct}
              onChange={e => onTextChange(selText.id, { sizePct: clamp(parseFloat(e.target.value) || 5, 2, 40) })}
              style={{ flex: 1.4, accentColor: "#c8b898" }} />
            <span style={{ ...muted, width: 34, textAlign: "right" }}>{selText.sizePct}%</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ ...muted, flex: 1 }}>Color / peso</span>
            <input type="color" value={selText.color} onChange={e => onTextChange(selText.id, { color: e.target.value })}
              style={{ width: 26, height: 20, padding: 0, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", cursor: "pointer" }} />
            <select value={String(selText.weight)} onChange={e => onTextChange(selText.id, { weight: clamp(parseInt(e.target.value, 10) || 700, 100, 900) })} style={inp}>
              <option value="400">400</option>
              <option value="700">700</option>
              <option value="900">900</option>
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ ...muted, flex: 1 }}>Fuente / fondo</span>
            <select value={selText.font} onChange={e => onTextChange(selText.id, { font: e.target.value })} style={{ ...inp, flex: 1 }}>
              <option value="system-ui, sans-serif">Sans</option>
              <option value="Georgia, serif">Serif</option>
              <option value="ui-monospace, monospace">Mono</option>
            </select>
            <input type="color" value={selText.bg || "#111111"} onChange={e => onTextChange(selText.id, { bg: e.target.value })}
              title="Fondo (píldora)" style={{ width: 26, height: 20, padding: 0, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", cursor: "pointer" }} />
            {selText.bg && (
              <button type="button" title="Quitar fondo" onClick={() => onTextChange(selText.id, { bg: "" })} style={{ ...smallBtn, padding: "2px 5px" }}>✕</button>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ ...muted, flex: 1 }}>Animación</span>
            <select value={selText.anim} onChange={e => onTextChange(selText.id, { anim: e.target.value as ReelTextClip["anim"] })} style={{ ...inp, flex: 1 }}>
              <option value="none">Ninguna</option>
              <option value="fade">Fade</option>
              <option value="pop">Pop</option>
              <option value="slide-up">Slide up</option>
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ ...muted, flex: 1 }}>Inicio / duración</span>
            <input type="number" min={0} max={3600} step={0.1} value={selText.startSec}
              onChange={e => onTextChange(selText.id, { startSec: clamp(parseFloat(e.target.value) || 0, 0, 3600) })} style={{ ...inp, width: 52 }} />
            <input type="number" min={0.2} max={3600} step={0.2} value={selText.durationSec}
              onChange={e => onTextChange(selText.id, { durationSec: clamp(parseFloat(e.target.value) || 3, 0.2, 3600) })} style={{ ...inp, width: 52 }} />
            <span style={muted}>s</span>
          </div>
          <button type="button" onClick={() => { onTextChange(selText.id, null); onSelect(null); }} style={{ ...smallBtn, color: "#e07a7a", borderColor: "rgba(224,122,122,0.3)" }}>
            Quitar del timeline
          </button>
        </div>
      )}

      {/* ── Selected audio clip ── */}
      {selAudio && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={sectionTitle}>Clip de audio</div>
          <div style={{ fontSize: 11, color: "#c8b898", fontFamily: "monospace", wordBreak: "break-all" }}>{selAudio.name}</div>
          <button type="button" disabled={beatsBusy} onClick={() => onDetectBeats(selAudio.id)}
            style={{ ...smallBtn, width: "100%", opacity: beatsBusy ? 0.6 : 1 }} title="Detecta onsets y añade markers de snap en el timeline (V3.8)">
            {beatsBusy ? "Analizando…" : "🥁 Detectar beats"}
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ ...muted, flex: 1 }}>Empieza en</span>
            <input type="number" min={0} max={3600} step={0.1} value={selAudio.startSec}
              onChange={e => onAudioChange(selAudio.id, { startSec: clamp(parseFloat(e.target.value) || 0, 0, 3600) })} style={{ ...inp, width: 56 }} />
            <span style={muted}>s</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ ...muted, flex: 1 }}>Duración</span>
            <input type="number" min={0.2} max={3600} step={0.5} value={selAudio.durationSec}
              onChange={e => onAudioChange(selAudio.id, { durationSec: clamp(parseFloat(e.target.value) || 10, 0.2, 3600) })} style={{ ...inp, width: 56 }} />
            <span style={muted}>s (loop)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ ...muted, flex: 1 }}>Volumen</span>
            <input type="range" min={0} max={150} value={Math.round(selAudio.volume * 100)}
              onChange={e => onAudioChange(selAudio.id, { volume: clamp(parseInt(e.target.value, 10) / 100, 0, 1.5) })}
              style={{ flex: 1.4, accentColor: "#c8b898" }} />
            <span style={{ ...muted, width: 30, textAlign: "right" }}>{Math.round(selAudio.volume * 100)}%</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ ...muted }}>Fade in</span>
            <input type="number" min={0} max={5} step={0.1} value={selAudio.fadeInSec}
              onChange={e => onAudioChange(selAudio.id, { fadeInSec: clamp(parseFloat(e.target.value) || 0, 0, 5) })} style={{ ...inp, width: 44 }} />
            <span style={{ ...muted }}>out</span>
            <input type="number" min={0} max={5} step={0.1} value={selAudio.fadeOutSec}
              onChange={e => onAudioChange(selAudio.id, { fadeOutSec: clamp(parseFloat(e.target.value) || 0, 0, 5) })} style={{ ...inp, width: 44 }} />
            <span style={muted}>s</span>
          </div>
          <button type="button" onClick={() => { onAudioChange(selAudio.id, null); onSelect(null); }} style={{ ...smallBtn, color: "#e07a7a", borderColor: "rgba(224,122,122,0.3)" }}>
            Quitar del timeline
          </button>
        </div>
      )}

      {!selTake && !selAudio && !selMedia && !selText && selection?.kind !== "layer" && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 }}>
          <div style={muted}>
            Selecciona un clip en el timeline para editarlo aquí. El orden del reel es el orden de las tomas en V1.
          </div>
        </div>
      )}
    </div>
  );
}
