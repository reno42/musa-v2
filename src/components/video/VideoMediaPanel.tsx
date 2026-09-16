/**
 * VideoMediaPanel — the Video Mode's left panel (CapCut media bin):
 * "Tomas" (frames as draggable cards — drop them on the V track to reorder,
 * or "+" to toggle reel membership) and "Música" (upload → public URL →
 * audio clip on the A track).
 */

import { useRef } from "react";
import type { VideoTimelineDoc } from "../../lib/videoTimelineDoc";
import type { FrameData } from "../DesignFrame";
import type { TimelineSelection } from "./VideoTimeline";

export interface VideoMediaPanelProps {
  frames: FrameData[];
  included: FrameData[];
  thumbs: Record<string, string>;
  doc: VideoTimelineDoc;
  selection: TimelineSelection | null;
  onSelect: (sel: TimelineSelection | null) => void;
  onFrameReelChange: (frameId: string, reelExcluded: boolean) => void;
  /** Overlay uploads the file and appends the audio clip. */
  onAudioFilePicked: (file: File) => void;
  audioBusy: boolean;
  onSeekToTake: (frameId: string) => void;
}

const muted: React.CSSProperties = { fontSize: 10, lineHeight: 1.5, color: "#7a7668" };
const smallBtn: React.CSSProperties = {
  fontSize: 10, padding: "2px 7px", borderRadius: 3,
  border: "1px solid rgba(200,184,152,0.15)", background: "rgba(200,184,152,0.05)",
  color: "#c8b898", cursor: "pointer", fontFamily: "inherit",
};
const sectionTitle: React.CSSProperties = { fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#9a968a", marginBottom: 6 };

export function VideoMediaPanel({
  frames, included, thumbs, doc, selection, onSelect, onFrameReelChange, onAudioFilePicked, audioBusy, onSeekToTake,
}: VideoMediaPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const includedIds = new Set(included.map(f => f.id));

  return (
    <div style={{ flex: "0 0 218px", borderRight: "1px solid rgba(255,255,255,0.06)", padding: "10px", display: "flex", flexDirection: "column", gap: 12, overflow: "auto", minHeight: 0 }}>
      {/* ── Tomas ── */}
      <div>
        <div style={sectionTitle}>Tomas — arrastra al timeline</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {frames.map((f, i) => {
            const inReel = includedIds.has(f.id);
            const incIdx = included.findIndex(x => x.id === f.id);
            const sel = selection?.kind === "take" && selection.frameId === f.id;
            return (
              <div
                key={f.id}
                draggable
                onDragStart={e => {
                  e.dataTransfer.setData("text/frame-id", f.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => { onSelect({ kind: "take", frameId: f.id }); if (inReel) onSeekToTake(f.id); }}
                title={inReel ? `Toma ${incIdx + 1} — arrastra a V1 para reordenar` : "Fuera del reel — arrastra a V1 o pulsa +"}
                style={{
                  display: "flex", gap: 7, alignItems: "center", padding: 5, borderRadius: 5, cursor: "grab", userSelect: "none",
                  border: `1px solid ${sel ? "rgba(200,184,152,0.55)" : "rgba(255,255,255,0.07)"}`,
                  background: sel ? "rgba(200,184,152,0.07)" : "rgba(255,255,255,0.02)",
                  opacity: inReel ? 1 : 0.45,
                }}
              >
                <div style={{ width: 54, height: 40, flexShrink: 0, borderRadius: 3, overflow: "hidden", background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {thumbs[f.id]
                    ? <img src={thumbs[f.id]} alt="" draggable={false} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                    : <span style={{ fontSize: 8, color: "#666" }}>render…</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: "#c8b898", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {inReel ? `${incIdx + 1}. ` : "· "}{f.name}
                  </div>
                  <div style={{ ...muted, fontSize: 9 }}>
                    {f.width}×{f.height} · {(f.animation?.timeline.durationSec ?? 5).toFixed(1)}s
                  </div>
                </div>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); onFrameReelChange(f.id, inReel); }}
                  title={inReel ? "Sacar del reel" : "Añadir al final del reel"}
                  style={{ ...smallBtn, color: inReel ? "#e07a7a" : "#9fd6a0", flexShrink: 0 }}
                >
                  {inReel ? "✕" : "+"}
                </button>
              </div>
            );
          })}
        </div>
        <div style={{ ...muted, marginTop: 5, fontSize: 9 }}>El orden del reel es el orden de V1 — {frames.length} frame{frames.length === 1 ? "" : "s"} en el archivo.</div>
      </div>

      {/* ── Música ── */}
      <div>
        <div style={sectionTitle}>Música</div>
        <button type="button" disabled={audioBusy} onClick={() => fileRef.current?.click()} style={{ ...smallBtn, width: "100%", padding: "5px 8px", opacity: audioBusy ? 0.6 : 1 }}>
          {audioBusy ? "Subiendo…" : "♪ Subir audio (mp3, wav, ogg…)"}
        </button>
        <input ref={fileRef} type="file" accept="audio/*" style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (f) onAudioFilePicked(f); e.target.value = ""; }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
          {doc.audioClips.map(clip => {
            const sel = selection?.kind === "audio" && selection.clipId === clip.id;
            return (
              <div key={clip.id}
                onClick={() => onSelect({ kind: "audio", clipId: clip.id })}
                style={{
                  display: "flex", alignItems: "center", gap: 5, padding: "3px 6px", borderRadius: 3, cursor: "pointer",
                  border: `1px solid ${sel ? "rgba(224,181,122,0.55)" : "rgba(255,255,255,0.06)"}`,
                  background: sel ? "rgba(224,181,122,0.08)" : "rgba(255,255,255,0.02)",
                }}>
                <span style={{ fontSize: 10 }}>♪</span>
                <span style={{ ...muted, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{clip.name}</span>
                <span style={{ ...muted, fontSize: 9 }}>{clip.startSec.toFixed(1)}s</span>
              </div>
            );
          })}
          {doc.audioClips.length === 0 && <div style={{ ...muted, fontSize: 9 }}>Sin clips de audio.</div>}
        </div>
      </div>

      <div style={{ ...muted, fontSize: 9, marginTop: "auto" }}>
        Consejo: los clips de capa viven dentro de la ventana de su toma; la música es libre.
      </div>
    </div>
  );
}
