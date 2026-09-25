/**
 * VideoMediaPanel — the Video Mode's left panel (CapCut media bin):
 *   • "Tomas": frames as draggable cards — drop them on the V track to
 *     reorder, or "+" to toggle reel membership.
 *   • "Media" (V3.4): upload video/image clips → overlay lanes on the
 *     timeline.
 *   • "Música": upload → public URL → audio clip on the A track.
 *   • "Voz en off" (V3.8): record from the mic (MediaRecorder) → same
 *     audio pipeline as music.
 *   • "Texto/Stickers" (V3.5/V3.6): add a caption or an emoji sticker clip.
 *   • "Recursos" (V3.9): the workspace's design-assets bucket — click to
 *     drop an image/video straight onto the timeline.
 */

import { useEffect, useRef, useState } from "react";
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
  workspaceId: string;
  addToast: (msg: string, kind?: "success" | "error" | "info") => void;
  /** V3.4: overlay uploads the file and appends a media clip. */
  onMediaFilePicked: (file: File) => void;
  mediaBusy: boolean;
  /** V3.9: place an existing asset URL as a media clip. */
  onAddMediaFromUrl: (url: string, kind: "video" | "image", name: string) => void;
  onAddText: () => void;
  onAddSticker: (emoji: string) => void;
  /** V3.8: overlay uploads the recorded take and appends the audio clip. */
  onVoiceoverFile: (file: File) => void;
  /** V5 Fase 3: the Biblioteca FX section — the overlay composes
   *  FxLibraryPanel and slots it here (keeps this panel's prop list flat). */
  biblioteca?: React.ReactNode;
}

const muted: React.CSSProperties = { fontSize: 10, lineHeight: 1.5, color: "#7a7668" };
const smallBtn: React.CSSProperties = {
  fontSize: 10, padding: "2px 7px", borderRadius: 3,
  border: "1px solid rgba(200,184,152,0.15)", background: "rgba(200,184,152,0.05)",
  color: "#c8b898", cursor: "pointer", fontFamily: "inherit",
};
const sectionTitle: React.CSSProperties = { fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#9a968a", marginBottom: 6 };

const STICKERS = ["🔥", "😂", "❤️", "👍", "✨", "💯", "🎉", "👀", "💀", "🤯", "👑", "🎵"];

interface ResFile { name: string; mimeType: string; url: string }

export function VideoMediaPanel({
  frames, included, thumbs, doc, selection, onSelect, onFrameReelChange, onAudioFilePicked, audioBusy, onSeekToTake,
  workspaceId, addToast, onMediaFilePicked, mediaBusy, onAddMediaFromUrl, onAddText, onAddSticker, onVoiceoverFile,
  biblioteca,
}: VideoMediaPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const mediaFileRef = useRef<HTMLInputElement>(null);
  const includedIds = new Set(included.map(f => f.id));

  // ── V3.8 voiceover recorder ──
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const recRef = useRef<{ rec: MediaRecorder; timer: number } | null>(null);

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(m => MediaRecorder.isTypeSupported(m)) || "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        const ext = (rec.mimeType || "").includes("mp4") ? "m4a" : "webm";
        onVoiceoverFile(new File([blob], `voz_${Date.now()}.${ext}`, { type: blob.type || "audio/webm" }));
      };
      rec.start();
      setRecSecs(0);
      const timer = window.setInterval(() => setRecSecs(s => s + 1), 1000);
      recRef.current = { rec, timer };
      setRecording(true);
    } catch (err) {
      addToast(`Micrófono no disponible: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  };
  const stopRec = () => {
    const r = recRef.current;
    if (!r) return;
    window.clearInterval(r.timer);
    try { r.rec.stop(); } catch { /* already stopped */ }
    recRef.current = null;
    setRecording(false);
  };
  useEffect(() => () => { if (recRef.current) window.clearInterval(recRef.current.timer); }, []);

  // ── V3.9 Recursos (workspace design-assets) ──
  const [resFiles, setResFiles] = useState<ResFile[] | null>(null);
  const [resLoading, setResLoading] = useState(false);
  const loadRecursos = async () => {
    if (!workspaceId) return;
    setResLoading(true);
    try {
      const res = await fetch(`/api/storage/files?workspaceId=${encodeURIComponent(workspaceId)}&bucket=design-assets`);
      const json = await res.json().catch(() => null);
      const all: ResFile[] = json?.success && Array.isArray(json?.data?.files) ? json.data.files : [];
      setResFiles(all
        .filter(f => typeof f?.url === "string" && (String(f.mimeType || "").startsWith("image/") || String(f.mimeType || "").startsWith("video/")))
        .slice(0, 24));
    } catch {
      setResFiles([]);
    } finally {
      setResLoading(false);
    }
  };
  useEffect(() => { void loadRecursos(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [workspaceId]);

  return (
    <div style={{ flex: "0 0 218px", borderRight: "1px solid rgba(255,255,255,0.06)", padding: "10px", display: "flex", flexDirection: "column", gap: 12, overflow: "auto", minHeight: 0 }}>
      {/* ── Tomas ── */}
      <div>
        <div style={sectionTitle}>Tomas — arrastra al timeline</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {frames.map(f => {
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

      {/* ── Biblioteca FX (V5 Fase 3) — composed by the overlay ── */}
      {biblioteca}

      {/* ── Media (V3.4) ── */}
      <div>
        <div style={sectionTitle}>Media — video/imágenes</div>
        <button type="button" disabled={mediaBusy} onClick={() => mediaFileRef.current?.click()} style={{ ...smallBtn, width: "100%", padding: "5px 8px", opacity: mediaBusy ? 0.6 : 1 }}>
          {mediaBusy ? "Subiendo…" : "🎬 Subir video o imagen"}
        </button>
        <input ref={mediaFileRef} type="file" accept="video/*,image/*" style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (f) onMediaFilePicked(f); e.target.value = ""; }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
          {doc.mediaClips.map(mc => {
            const sel = selection?.kind === "media" && selection.clipId === mc.id;
            return (
              <div key={mc.id}
                draggable
                onDragStart={e => {
                  e.dataTransfer.setData("text/clip-kind", "media");
                  e.dataTransfer.setData("text/clip-id", mc.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => onSelect({ kind: "media", clipId: mc.id })}
                title="Arrastra al lane M del timeline para recolocarlo (con snap)"
                style={{
                  display: "flex", alignItems: "center", gap: 5, padding: "3px 6px", borderRadius: 3, cursor: "grab", userSelect: "none",
                  border: `1px solid ${sel ? "rgba(224,181,122,0.55)" : "rgba(255,255,255,0.06)"}`,
                  background: sel ? "rgba(224,181,122,0.08)" : "rgba(255,255,255,0.02)",
                }}>
                <span style={{ fontSize: 10 }}>{mc.kind === "image" ? "🖼" : "🎬"}</span>
                <span style={{ ...muted, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mc.name}</span>
                <span style={{ ...muted, fontSize: 9 }}>{mc.startSec.toFixed(1)}s</span>
              </div>
            );
          })}
          {doc.mediaClips.length === 0 && <div style={{ ...muted, fontSize: 9 }}>Sin clips de media.</div>}
        </div>
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
                draggable
                onDragStart={e => {
                  e.dataTransfer.setData("text/clip-kind", "audio");
                  e.dataTransfer.setData("text/clip-id", clip.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => onSelect({ kind: "audio", clipId: clip.id })}
                title="Arrastra al lane ♪ del timeline para recolocarlo (con snap)"
                style={{
                  display: "flex", alignItems: "center", gap: 5, padding: "3px 6px", borderRadius: 3, cursor: "grab", userSelect: "none",
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

      {/* ── Voz en off (V3.8) ── */}
      <div>
        <div style={sectionTitle}>Voz en off</div>
        {recording ? (
          <button type="button" onClick={stopRec} style={{ ...smallBtn, width: "100%", padding: "5px 8px", color: "#e07a7a", borderColor: "rgba(224,122,122,0.4)" }}>
            ⏺ Grabando… {recSecs}s — parar
          </button>
        ) : (
          <button type="button" disabled={audioBusy} onClick={() => void startRec()} style={{ ...smallBtn, width: "100%", padding: "5px 8px", opacity: audioBusy ? 0.6 : 1 }}>
            🎙 Grabar voz
          </button>
        )}
        <div style={{ ...muted, fontSize: 9, marginTop: 4 }}>La grabación se sube como clip de audio al playhead.</div>
      </div>

      {/* ── Texto + Stickers (V3.5/V3.6) ── */}
      <div>
        <div style={sectionTitle}>Texto y stickers</div>
        <button type="button" onClick={onAddText} style={{ ...smallBtn, width: "100%", padding: "5px 8px" }}>
          T Añadir texto/caption
        </button>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
          {STICKERS.map(s => (
            <button key={s} type="button" title={`Sticker ${s}`}
              onClick={() => onAddSticker(s)}
              style={{ ...smallBtn, fontSize: 14, padding: "2px 6px" }}>
              {s}
            </button>
          ))}
        </div>
        {/* V4.2: existing text clips — drag to the T lane to re-place. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
          {doc.textClips.map(tc => {
            const sel = selection?.kind === "text" && selection.clipId === tc.id;
            return (
              <div key={tc.id}
                draggable
                onDragStart={e => {
                  e.dataTransfer.setData("text/clip-kind", "text");
                  e.dataTransfer.setData("text/clip-id", tc.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => onSelect({ kind: "text", clipId: tc.id })}
                title="Arrastra al lane T del timeline para recolocarlo (con snap)"
                style={{
                  display: "flex", alignItems: "center", gap: 5, padding: "3px 6px", borderRadius: 3, cursor: "grab", userSelect: "none",
                  border: `1px solid ${sel ? "rgba(224,181,122,0.55)" : "rgba(255,255,255,0.06)"}`,
                  background: sel ? "rgba(224,181,122,0.08)" : "rgba(255,255,255,0.02)",
                }}>
                <span style={{ fontSize: 10 }}>{tc.text.length <= 2 ? tc.text : "T"}</span>
                <span style={{ ...muted, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tc.text.replace(/\n/g, " ")}</span>
                <span style={{ ...muted, fontSize: 9 }}>{tc.startSec.toFixed(1)}s</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Recursos (V3.9) ── */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ ...sectionTitle, marginBottom: 0, flex: 1 }}>Recursos del workspace</div>
          <button type="button" onClick={() => void loadRecursos()} title="Recargar" style={{ ...smallBtn, padding: "1px 6px" }}>↻</button>
        </div>
        <div style={{ ...muted, fontSize: 9, margin: "4px 0 6px" }}>Assets de design-assets — click para añadir al playhead.</div>
        {resLoading && <div style={{ ...muted, fontSize: 9 }}>Cargando…</div>}
        {!resLoading && resFiles && resFiles.length === 0 && <div style={{ ...muted, fontSize: 9 }}>Sin imágenes/videos en el bucket.</div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
          {(resFiles || []).map((f, i) => {
            const isVideo = String(f.mimeType).startsWith("video/");
            const kind: "video" | "image" = isVideo ? "video" : "image";
            return (
              <button key={`${f.url.slice(-24)}-${i}`} type="button"
                onClick={() => onAddMediaFromUrl(f.url, kind, f.name)}
                title={`${f.name} — añadir como clip ${kind === "video" ? "de video" : "de imagen"}`}
                style={{
                  position: "relative", height: 52, borderRadius: 4, overflow: "hidden", cursor: "pointer", padding: 0,
                  border: "1px solid rgba(255,255,255,0.08)", background: "#000", textAlign: "left",
                }}>
                {isVideo ? (
                  <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🎬</span>
                ) : (
                  <img src={f.url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                )}
                <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "1px 4px", fontSize: 8, color: "#e8dcc0", background: "rgba(0,0,0,0.55)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "monospace" }}>
                  {f.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ ...muted, fontSize: 9, marginTop: "auto" }}>
        Consejo: los clips de capa viven dentro de la ventana de su toma; media/texto/audio son libres.
      </div>
    </div>
  );
}
