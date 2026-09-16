/**
 * VideoInspector — the Video Mode's right panel (CapCut property panel).
 * Context-aware: reel summary + export/publish + storage quota when nothing
 * is selected; take / layer-clip / audio-clip editors when something is.
 */

import { normalizeAnimation, type AnimationSchema, type TransitionType } from "../../../shared/animationSchema.ts";
import { takeStartSec, type ReelTimeline } from "../../lib/sequencePlayback";
import type { ReelAudioClip, VideoTimelineDoc } from "../../lib/videoTimelineDoc";
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
  onAudioChange: (clipId: string, patch: Partial<ReelAudioClip> | null) => void;
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

export function VideoInspector({
  frames, included, tl, doc, selection, onSelect,
  onTakeDuration, onAnimationFrameChange, onTransitionChange, onFrameReelChange, onAudioChange,
  exporting, progress, uploading, publishedUrl, onExport, onUploadPublish, onCopyUrl,
  homogeneous, sizesSummary, quota,
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
        <button type="button" disabled={exporting || !homogeneous || included.length === 0} onClick={onExport}
          style={{ ...smallBtn, width: "100%", padding: "6px 8px", fontSize: 11, opacity: exporting ? 0.6 : 1 }}>
          {exporting ? `Renderizando… ${Math.round(progress * 100)}%` : "⬇ Exportar reel (WebM)"}
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
        const schema = selTake.animation ? normalizeAnimation(selTake.animation) : null;
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
          </div>
        );
      })()}

      {/* ── Selected audio clip ── */}
      {selAudio && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={sectionTitle}>Clip de audio</div>
          <div style={{ fontSize: 11, color: "#c8b898", fontFamily: "monospace", wordBreak: "break-all" }}>{selAudio.name}</div>
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

      {!selTake && !selAudio && selection?.kind !== "layer" && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 }}>
          <div style={muted}>
            Selecciona un clip en el timeline para editarlo aquí. El orden del reel es el orden de las tomas en V1.
          </div>
        </div>
      )}
    </div>
  );
}

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
