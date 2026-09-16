/**
 * VideoModeOverlay — "Modo Video" (REQ-VID3/VID4, spec §4b).
 *
 * A full-screen mode where the editor's canvas becomes the viewer:
 *  • Stage: plays the reel sequence (takes + transitions) using the SAME
 *    sampler the export uses (sampleAnimationAt), so preview == export.
 *  • Storyboard strip (VID3): one thumbnail per frame, drag to reorder,
 *    "entra al reel" toggle, per-take duration, transition connector.
 *  • Layer timeline (VID4): one row per clip — drag the block, drag its
 *    edges, drag keyframe dots, scrub with the playhead.
 *  • Export: one button for the whole reel (REQ-VID2), aspect-ratio guard,
 *    optional background music (REQ-VID5) and public-URL upload (REQ-VID8).
 *
 * Like AnimationPanel, this never touches WAAPI: it edits frame.animation
 * (single source of truth) and renders through the export sampler.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cssPropertyOf,
  defaultAnimation,
  normalizeAnimation,
  sampleAnimationAt,
  type AnimationSchema,
} from "../../shared/animationSchema.ts";
import { buildReelTimeline, sampleReelAt, takeStartSec } from "../lib/sequencePlayback";
import { downloadVideoBlob, exportReelVideo } from "../lib/videoExport";
import { mapBodySelectors, rasterizeFrame } from "../lib/frameCapture";
import type { FrameData } from "./DesignFrame";

// ── Local idiom (matches AnimationPanel's glass styling) ──

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

const TRANSITION_LABELS: Record<string, string> = { fade: "Fundido", slide: "Desliza", zoom: "Zoom", wipe: "Barrido" };
const TRANSITION_ICONS: Record<string, string> = { fade: "◐", slide: "⇥", zoom: "⤢", wipe: "▥" };

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smoothstep = (p: number) => p * p * (3 - 2 * p);
const fmt = (t: number) => `${t.toFixed(2)}s`;

/** Loop-resolution for one take's local time — identical math to the export
 *  (videoExport.resolveTimelineTime); keep the two in sync. */
function resolveLocal(anim: AnimationSchema | null | undefined, tSec: number): number {
  if (!anim) return 0;
  const dur = Math.max(0.2, anim.timeline.durationSec);
  if (anim.timeline.loop === "once") return Math.min(tSec, dur);
  if (anim.timeline.loop === "loop") return tSec % dur;
  const cycle = tSec % (dur * 2);
  return cycle <= dur ? cycle : dur * 2 - cycle;
}

export interface VideoModeOverlayProps {
  frames: FrameData[];
  selectedFrameId: string | null;
  onAnimationFrameChange: (frameId: string, next: AnimationSchema | null) => void;
  onFrameReelChange: (frameId: string, reelExcluded: boolean) => void;
  onFramesReorder: (orderedIds: string[]) => void;
  onClose: () => void;
  addToast: (msg: string, kind?: "success" | "error" | "info") => void;
  workspaceId: string;
}

export function VideoModeOverlay({
  frames, selectedFrameId, onAnimationFrameChange, onFrameReelChange, onFramesReorder, onClose, addToast, workspaceId,
}: VideoModeOverlayProps) {
  // ── Reel model ──
  const included = useMemo(() => frames.filter(f => !f.reelExcluded), [frames]);
  const tl = useMemo(() => buildReelTimeline(included), [included]);

  const [selTakeId, setSelTakeId] = useState<string | null>(
    selectedFrameId && included.some(f => f.id === selectedFrameId) ? selectedFrameId : included[0]?.id ?? null,
  );
  const selTakeIdx = included.findIndex(f => f.id === selTakeId);

  // ── Playback clock ──
  const [playing, setPlaying] = useState(false);
  const [tSec, setTSec] = useState(0);
  const tRef = useRef(0);
  const rafRef = useRef(0);
  const lastWallRef = useRef(0);

  const seek = useCallback((t: number) => {
    const v = clamp(t, 0, Math.max(0, tl.totalDurationSec - 0.001));
    tRef.current = v;
    setTSec(v);
  }, [tl.totalDurationSec]);

  // ── Stage DOM (scoped re-render of each frame's html+css) ──
  const scalerRef = useRef<HTMLDivElement>(null);
  const wrappersRef = useRef<Map<string, HTMLDivElement>>(new Map());

  // Build/rebuild one wrapper per frame whenever the design data changes.
  const frameStamp = frames.map(f => `${f.id}:${(f.contentHash || "").slice(0, 8)}:${f.css.length}:${f.html.length}`).join("|");
  useEffect(() => {
    const scaler = scalerRef.current;
    if (!scaler) return;
    const next = new Map<string, HTMLDivElement>();
    frames.forEach((f, i) => {
      let el = wrappersRef.current.get(f.id);
      const scopeCls = `vm-scope-${i}`;
      const scopedCss = mapBodySelectors(f.css).replace(/#__df_content/g, `.${scopeCls}`);
      const signature = `${scopedCss.length}:${f.html.length}:${(f.contentHash || "").slice(0, 8)}`;
      if (!el || el.dataset.signature !== signature) {
        el = document.createElement("div");
        el.dataset.signature = signature;
        el.style.cssText = `position:absolute;top:0;left:0;width:${f.width}px;height:${f.height}px;overflow:hidden;background:${f.background || "transparent"};`;
        const style = document.createElement("style");
        style.textContent = scopedCss;
        const content = document.createElement("div");
        content.className = scopeCls;
        content.innerHTML = f.html;
        el.replaceChildren(style, content);
      }
      el.style.display = "none";
      if (el.parentElement !== scaler) scaler.appendChild(el);
      next.set(f.id, el);
    });
    // Drop wrappers of deleted frames.
    for (const [id, el] of wrappersRef.current) if (!next.has(id)) el.remove();
    wrappersRef.current = next;
  }, [frameStamp, frames]);

  /** Paint the current global time onto the stage wrappers. */
  const applyLayers = useCallback(() => {
    const s = sampleReelAt(tl, tRef.current);
    const wraps = wrappersRef.current;
    const show = (id: string, on: boolean) => {
      const el = wraps.get(id);
      if (el) el.style.display = on ? "block" : "none";
    };
    for (const f of frames) show(f.id, false);

    const applyTake = (frame: FrameData, localT: number, wrapStyle: Record<string, string>) => {
      show(frame.id, true);
      const el = wraps.get(frame.id);
      if (el) {
        for (const [k, v] of Object.entries(wrapStyle)) (el.style as unknown as Record<string, string>)[k] = v;
      }
      const anim = frame.animation ?? null;
      const samples = anim ? sampleAnimationAt(anim, resolveLocal(anim, localT)) : null;
      const root = wraps.get(frame.id);
      if (root && samples) {
        for (const [layerId, props] of samples) {
          const layer = root.querySelector<HTMLElement>(`[data-layer-id="${CSS.escape(layerId)}"]`);
          if (!layer) continue;
          for (const [prop, value] of Object.entries(props)) layer.style.setProperty(cssPropertyOf(prop), value);
        }
      }
    };

    if (s.kind === "take") {
      applyTake(included[s.takeIndex], s.localT, {});
    } else {
      const p = smoothstep(s.progress);
      const from = included[s.fromTakeIndex];
      const to = included[s.toTakeIndex];
      const style: Record<string, string> = {};
      const styleTo: Record<string, string> = {};
      if (s.type === "slide") { style.transform = `translateX(${-p * 100}%)`; styleTo.transform = `translateX(${(1 - p) * 100}%)`; }
      else if (s.type === "zoom") {
        style.transform = `scale(${1 + 0.25 * p})`; style.opacity = String(1 - p);
        styleTo.transform = `scale(${1.25 - 0.25 * p})`; styleTo.opacity = String(p);
      } else if (s.type === "wipe") { styleTo.clipPath = `inset(0 ${(1 - p) * 100}% 0 0)`; }
      else { styleTo.opacity = String(p); }
      applyTake(from, tl.takes[s.fromTakeIndex].durationSec, style);
      applyTake(to, 0, styleTo);
    }
  }, [tl, included, frames]);

  useEffect(() => { applyLayers(); }, [tSec, applyLayers]);

  // rAF playback loop (reel previews loop — it's a reel).
  useEffect(() => {
    if (!playing) return;
    lastWallRef.current = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = (now - lastWallRef.current) / 1000;
      lastWallRef.current = now;
      let t = tRef.current + dt;
      if (tl.totalDurationSec > 0) t = t % tl.totalDurationSec;
      tRef.current = t;
      setTSec(t);
      // Background music follows the clock (loop handled by the element).
      const audio = audioRef.current;
      if (audio && audio.duration > 0) {
        const target = Math.min(t, audio.duration - 0.01);
        if (Math.abs(audio.currentTime - target) > 0.35) audio.currentTime = target;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, tl.totalDurationSec]);

  const togglePlay = () => {
    const next = !playing;
    setPlaying(next);
    const audio = audioRef.current;
    if (audio) {
      if (next) {
        audio.currentTime = Math.min(tRef.current, Math.max(0, audio.duration - 0.01));
        void audio.play().catch(() => { /* autoplay guards — silent */ });
      } else audio.pause();
    }
  };

  // Escape closes the mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── Stage fit ──
  const stageAreaRef = useRef<HTMLDivElement>(null);
  const [fitArea, setFitArea] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = stageAreaRef.current;
    if (!el) return;
    const measure = () => setFitArea({ w: el.clientWidth - 28, h: el.clientHeight - 28 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const first = included[0] || frames[0];
  const fit = first && first.width > 0 ? Math.max(0.01, Math.min(fitArea.w / first.width, fitArea.h / first.height)) : 0;

  // ── Storyboard thumbnails (cheap static renders, cached) ──
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const thumbStamp = frames.map(f => `${f.id}:${(f.contentHash || "").slice(0, 8)}`).join("|");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const f of frames) {
        if (cancelled) return;
        if (thumbs[f.id]) continue;
        try {
          const scale = Math.min(1, 96 / Math.max(1, f.height));
          const canvas = await rasterizeFrame({ html: f.html, css: f.css, width: f.width, height: f.height, background: f.background }, scale);
          const url = canvas.toDataURL("image/png");
          if (cancelled) return;
          setThumbs(prev => ({ ...prev, [f.id]: url }));
        } catch { /* thumbnail is cosmetic */ }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbStamp]);

  // ── Schema edits (same persistence path as AnimationPanel) ──
  const schemaOf = (frame: FrameData): AnimationSchema =>
    (frame.animation ? normalizeAnimation(frame.animation) : null) || defaultAnimation(frame.width, frame.height);

  /** Duration edits keep timeline-only schemas (the panel drops clips==0
   *  schemas; here the reel needs the duration even without clips). */
  const setTakeDuration = (frame: FrameData, d: number) => {
    const base = schemaOf(frame);
    onAnimationFrameChange(frame.id, normalizeAnimation({ ...base, timeline: { ...base.timeline, durationSec: clamp(d, 0.2, 600) } }));
  };

  const setTransition = (fromFrame: FrameData, toFrameId: string, next: { type: "fade" | "slide" | "zoom" | "wipe"; durationSec: number } | null) => {
    const base = schemaOf(fromFrame);
    const others = base.transitions.filter(t => t.toFrameId !== toFrameId);
    const transitions = next ? [...others, { toFrameId, type: next.type, durationSec: next.durationSec }] : others;
    onAnimationFrameChange(fromFrame.id, normalizeAnimation({ ...base, transitions }));
  };

  // ── Storyboard drag-reorder ──
  const dragIdxRef = useRef<number | null>(null);
  const [dragActive, setDragActive] = useState<number | null>(null);
  const [editingTr, setEditingTr] = useState<number | null>(null); // take index whose outgoing transition is being edited

  const reorderTo = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    const ids = frames.map(f => f.id);
    const [moved] = ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, moved);
    onFramesReorder(ids);
  };

  // ── Audio (REQ-VID5) ──
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioFile, setAudioFile] = useState<{ name: string; data: ArrayBuffer; url: string } | null>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const pickAudio = async (file: File | undefined) => {
    if (!file) return;
    try {
      const data = await file.arrayBuffer();
      if (audioFile) URL.revokeObjectURL(audioFile.url);
      setAudioFile({ name: file.name, data, url: URL.createObjectURL(file) });
      addToast(`Música: ${file.name} — se muxea al exportar (fade out automático)`, "info");
    } catch {
      addToast("No se pudo leer el archivo de audio", "error");
    }
  };
  const removeAudio = () => {
    if (audioFile) URL.revokeObjectURL(audioFile.url);
    setAudioFile(null);
    if (audioRef.current) audioRef.current.pause();
  };

  // ── Export (REQ-VID2) + upload (REQ-VID8) ──
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const lastExportRef = useRef<{ blob: Blob; filename: string } | null>(null);

  const sizes = new Set(included.map(f => `${f.width}x${f.height}`));
  const homogeneous = sizes.size <= 1;

  const doExport = async (): Promise<void> => {
    if (exporting || included.length === 0) return;
    if (!homogeneous) {
      addToast(`Tomas con tamaños distintos (${[...sizes].join(" vs ")}) — iguala el aspect ratio antes de exportar`, "error");
      return;
    }
    setExporting(true);
    setProgress(0);
    try {
      const result = await exportReelVideo({
        frames: included.map(f => ({ id: f.id, html: f.html, css: f.css, width: f.width, height: f.height, background: f.background, animation: f.animation ?? null })),
        audio: audioFile ? { data: audioFile.data } : undefined,
        onProgress: setProgress,
      });
      const filename = `reel_${result.takeCount}tomas_${result.durationSec.toFixed(1)}s.${result.mimeType.includes("mp4") ? "mp4" : "webm"}`;
      lastExportRef.current = { blob: result.blob, filename };
      downloadVideoBlob(result.blob, filename);
      addToast(`Reel exportado: ${result.takeCount} tomas · ${fmt(result.durationSec)} (${result.method === "webcodecs" ? "WebCodecs" : "MediaRecorder"}${result.withAudio ? " · audio" : ""})`, "success");
    } catch (err) {
      addToast(`Export del reel falló: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setExporting(false);
    }
  };

  const uploadReel = async () => {
    if (uploading) return;
    try {
      let current = lastExportRef.current;
      if (!current) {
        await doExport();
        current = lastExportRef.current;
        if (!current) return;
      }
      setUploading(true);
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
        reader.onerror = () => reject(new Error("No se pudo leer el blob"));
        reader.readAsDataURL(current.blob);
      });
      const res = await fetch("/api/storage/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, filename: current.filename, dataBase64, mimeType: current.blob.type || "video/webm" }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success && json?.data?.url) {
        setPublishedUrl(String(json.data.url));
        addToast("Reel subido — URL pública lista para publicar (Zernio mediaUrl)", "success");
      } else {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      addToast(`Upload falló: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setUploading(false);
    }
  };

  // ── Derived values for the selected take ──
  const selTake = selTakeIdx >= 0 ? included[selTakeIdx] : null;
  const selLocalT = selTakeIdx >= 0 ? clamp(tSec - takeStartSec(tl, selTakeIdx), 0, tl.takes[selTakeIdx]?.durationSec ?? 0) : 0;

  if (frames.length === 0) return null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(8,8,8,0.97)", display: "flex", flexDirection: "column", color: "#f0ebe0", fontFamily: "inherit" }}>
      {/* ── Top bar ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: 1, color: "#c8b898" }}>MODO VIDEO</span>
        <span style={muted}>{included.length} toma{included.length === 1 ? "" : "s"} · {fmt(tl.totalDurationSec)} · {tl.fps} fps</span>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={togglePlay} style={{ ...smallBtn, padding: "4px 14px", fontSize: 11 }}>
          {playing ? "❚❚ Pausa" : "▶ Play"}
        </button>
        <button type="button" onClick={() => { setPlaying(false); if (audioRef.current) audioRef.current.pause(); seek(0); }} style={smallBtn} title="Stop y rebobinar">■</button>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => audioInputRef.current?.click()} style={smallBtn} title="Música de fondo (se muxea al exportar)">
          {audioFile ? `♪ ${audioFile.name.slice(0, 22)}` : "♪ Música"}
        </button>
        {audioFile && <button type="button" onClick={removeAudio} style={{ ...smallBtn, color: "#e07a7a" }} title="Quitar música">✕</button>}
        <input ref={audioInputRef} type="file" accept="audio/*" style={{ display: "none" }} onChange={e => { void pickAudio(e.target.files?.[0]); e.target.value = ""; }} />
        <button type="button" onClick={onClose} style={{ ...smallBtn, padding: "4px 12px" }}>← Volver al diseño</button>
      </div>

      {/* ── Stage + right rail ── */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div ref={stageAreaRef} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minWidth: 0, position: "relative" }}>
          {first && fit > 0 && (
            <div style={{ position: "relative", width: first.width * fit, height: first.height * fit, overflow: "hidden", background: "#000", borderRadius: 4, boxShadow: "0 8px 40px rgba(0,0,0,0.6)" }}>
              <div
                ref={scalerRef}
                style={{ position: "absolute", top: 0, left: 0, width: first.width, height: first.height, transform: `scale(${fit})`, transformOrigin: "top left", pointerEvents: "none" }}
              />
            </div>
          )}
          {!first && <div style={muted}>Sin frames en el archivo.</div>}
        </div>

        {/* Right rail: export + selected take info */}
        <div style={{ flex: "0 0 250px", borderLeft: "1px solid rgba(255,255,255,0.06)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10, overflow: "auto" }}>
          <div>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#9a968a", marginBottom: 6 }}>Exportar reel</div>
            {!homogeneous && (
              <div style={{ ...muted, color: "#e0b57a", border: "1px solid rgba(224,181,122,0.3)", borderRadius: 4, padding: 6, marginBottom: 6 }}>
                Tomas con tamaños distintos ({[...sizes].join(" vs ")}). Iguala los aspect ratios para exportar.
              </div>
            )}
            <button type="button" disabled={exporting || !homogeneous || included.length === 0} onClick={() => void doExport()}
              style={{ ...smallBtn, width: "100%", padding: "6px 8px", fontSize: 11, opacity: exporting ? 0.6 : 1 }}>
              {exporting ? `Renderizando… ${Math.round(progress * 100)}%` : "⬇ Exportar reel (WebM)"}
            </button>
            {exporting && (
              <div style={{ height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 2, marginTop: 6, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${progress * 100}%`, background: "#c8b898", transition: "width 120ms linear" }} />
              </div>
            )}
            <div style={{ ...muted, marginTop: 5 }}>Render 100% en el navegador: {included.length} toma{included.length === 1 ? "" : "s"}, transiciones incluidas{audioFile ? ", con audio" : ""}.</div>
          </div>

          <div>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#9a968a", marginBottom: 6 }}>Publicar</div>
            <button type="button" disabled={uploading} onClick={() => void uploadReel()} style={{ ...smallBtn, width: "100%", padding: "5px 8px", opacity: uploading ? 0.6 : 1 }}>
              {uploading ? "Subiendo…" : "⬆ Exportar y subir (URL pública)"}
            </button>
            {publishedUrl && (
              <div style={{ marginTop: 6 }}>
                <div style={{ ...inp, fontSize: 9, wordBreak: "break-all", padding: "4px 6px" }}>{publishedUrl}</div>
                <button type="button" onClick={() => { void navigator.clipboard.writeText(publishedUrl); addToast("URL copiada", "success"); }} style={{ ...smallBtn, marginTop: 4, width: "100%" }}>
                  Copiar URL para mediaUrl (Zernio)
                </button>
              </div>
            )}
          </div>

          {selTake && (
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#9a968a", marginBottom: 4 }}>Toma seleccionada</div>
              <div style={{ fontSize: 11, color: "#c8b898", fontFamily: "monospace", marginBottom: 4 }}>{selTake.name}</div>
              <div style={muted}>
                {fmt(tl.takes[selTakeIdx]?.durationSec ?? 0)}
                {tl.takes[selTakeIdx]?.transitionOut ? ` · transición: ${TRANSITION_LABELS[tl.takes[selTakeIdx].transitionOut!.type]}` : " · corte al cambio"}
                {" · "}click en el timeline para mover el playhead
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Scrub bar ── */}
      <div style={{ padding: "6px 14px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 10, fontFamily: "monospace", color: "#c8b898", flexShrink: 0 }}>{fmt(tSec)} / {fmt(tl.totalDurationSec)}</span>
        <input type="range" min={0} max={Math.max(0.01, tl.totalDurationSec)} step={0.01} value={Math.min(tSec, tl.totalDurationSec)}
          onChange={e => { setPlaying(false); if (audioRef.current) audioRef.current.pause(); seek(parseFloat(e.target.value) || 0); }}
          style={{ flex: 1, accentColor: "#c8b898" }} />
      </div>

      {/* ── Storyboard strip (VID3) ── */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "8px 14px" }}>
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#9a968a", marginBottom: 6 }}>Tomas — arrastra para reordenar · el orden del archivo es el orden del reel</div>
        <div style={{ display: "flex", gap: 8, alignItems: "stretch", overflowX: "auto", paddingBottom: 4 }}>
          {frames.map((f, i) => {
            const inReel = !f.reelExcluded;
            const takeIdx = included.findIndex(x => x.id === f.id);
            const nextIncluded = takeIdx >= 0 && takeIdx < included.length - 1 ? included[takeIdx + 1] : null;
            const tr = takeIdx >= 0 ? tl.takes[takeIdx]?.transitionOut : null;
            return (
              <div key={f.id} style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                <div
                  draggable
                  onDragStart={() => { dragIdxRef.current = i; setDragActive(i); }}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); if (dragIdxRef.current !== null) reorderTo(dragIdxRef.current, i); dragIdxRef.current = null; setDragActive(null); }}
                  onDragEnd={() => { dragIdxRef.current = null; setDragActive(null); }}
                  onClick={() => setSelTakeId(f.id)}
                  style={{
                    width: 128, borderRadius: 5, padding: 5, cursor: "grab", userSelect: "none",
                    border: `1px solid ${f.id === selTakeId ? "rgba(200,184,152,0.55)" : dragActive === i ? "rgba(200,184,152,0.35)" : "rgba(255,255,255,0.08)"}`,
                    background: f.id === selTakeId ? "rgba(200,184,152,0.06)" : "rgba(255,255,255,0.02)",
                    opacity: inReel ? 1 : 0.38,
                    display: "flex", flexDirection: "column", gap: 4,
                  }}
                >
                  <div style={{ height: 52, display: "flex", alignItems: "center", justifyContent: "center", background: "#000", borderRadius: 3, overflow: "hidden" }}>
                    {thumbs[f.id]
                      ? <img src={thumbs[f.id]} alt={f.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} draggable={false} />
                      : <span style={{ fontSize: 9, color: "#666" }}>render…</span>}
                  </div>
                  <div style={{ fontSize: 9, color: "#c8b898", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {i + 1}. {f.name}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <input type="number" min={0.2} max={600} step={0.5} value={f.animation?.timeline.durationSec ?? 5}
                      title="Duración de la toma (s)"
                      onChange={e => setTakeDuration(f, parseFloat(e.target.value) || 5)}
                      onClick={e => e.stopPropagation()}
                      style={{ ...inp, flex: 1, fontSize: 9 }} />
                    <label title={inReel ? "Entra al reel" : "Excluida del reel"} onClick={e => e.stopPropagation()}
                      style={{ fontSize: 9, color: inReel ? "#9fd6a0" : "#777", cursor: "pointer", display: "flex", alignItems: "center", gap: 2 }}>
                      <input type="checkbox" checked={inReel} onChange={e => onFrameReelChange(f.id, !e.target.checked)} style={{ accentColor: "#9fd6a0" }} />
                      reel
                    </label>
                  </div>
                </div>
                {/* Transition connector to the next included take */}
                {inReel && nextIncluded && (
                  <div style={{ position: "relative", flexShrink: 0 }}>
                    <button type="button" onClick={() => setEditingTr(editingTr === takeIdx ? null : takeIdx)}
                      title="Transición hacia la siguiente toma"
                      style={{ ...smallBtn, display: "flex", alignItems: "center", gap: 3, fontSize: 9, padding: "3px 6px" }}>
                      {tr ? <>{TRANSITION_ICONS[tr.type]} {TRANSITION_LABELS[tr.type]} {tr.durationSec.toFixed(1)}s</> : "✂ corte"}
                    </button>
                    {editingTr === takeIdx && (
                      <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 10, background: "#141414", border: "1px solid rgba(200,184,152,0.3)", borderRadius: 5, padding: 8, display: "flex", flexDirection: "column", gap: 6, width: 168 }}>
                        <div style={{ fontSize: 9, color: "#9a968a" }}>De «{f.name}» a «{nextIncluded.name}»</div>
                        <div style={{ display: "flex", gap: 4 }}>
                          {(["fade", "slide", "zoom", "wipe"] as const).map(t => (
                            <button key={t} type="button" title={TRANSITION_LABELS[t]}
                              onClick={() => setTransition(f, nextIncluded.id, { type: t, durationSec: tr?.durationSec ?? 0.6 })}
                              style={{ ...smallBtn, flex: 1, padding: "4px 0", borderColor: tr?.type === t ? "rgba(200,184,152,0.6)" : undefined, background: tr?.type === t ? "rgba(200,184,152,0.14)" : undefined }}>
                              {TRANSITION_ICONS[t]}
                            </button>
                          ))}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ ...muted, flex: 1 }}>Duración</span>
                          <input type="number" min={0.1} max={5} step={0.1} value={tr?.durationSec ?? 0.6}
                            onChange={e => setTransition(f, nextIncluded.id, { type: tr?.type ?? "fade", durationSec: clamp(parseFloat(e.target.value) || 0.6, 0.1, 5) })}
                            style={{ ...inp, width: 52 }} />
                          <span style={muted}>s</span>
                        </div>
                        {tr && (
                          <button type="button" onClick={() => setTransition(f, nextIncluded.id, null)} style={{ ...smallBtn, color: "#e07a7a", borderColor: "rgba(224,122,122,0.3)" }}>
                            Quitar transición (corte seco)
                          </button>
                        )}
                        <button type="button" onClick={() => setEditingTr(null)} style={smallBtn}>Listo</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Layer timeline of the selected take (VID4) ── */}
      <LayerTimeline
        key={selTakeId || "none"}
        schema={selTake?.animation ?? null}
        durationSec={tl.takes[selTakeIdx]?.durationSec ?? 5}
        localT={selLocalT}
        onSeekLocal={lt => { setPlaying(false); if (audioRef.current) audioRef.current.pause(); seek(takeStartSec(tl, selTakeIdx) + clamp(lt, 0, tl.takes[selTakeIdx]?.durationSec ?? 0)); }}
        onChange={next => { if (selTake) onAnimationFrameChange(selTake.id, next); }}
      />

      {/* Hidden audio element for preview */}
      {audioFile && <audio ref={audioRef} src={audioFile.url} loop preload="auto" style={{ display: "none" }} />}
    </div>
  );
}

// ── VID4: the per-layer timeline ("After Effects liviano") ──

interface LayerTimelineProps {
  schema: AnimationSchema | null;
  durationSec: number;
  localT: number;
  onSeekLocal: (t: number) => void;
  /** Receives the FULL normalized replacement schema (or null when the last
   *  clip is removed — the host decides the commit policy). */
  onChange: (next: AnimationSchema | null) => void;
}

function LayerTimeline({ schema, durationSec, localT, onSeekLocal, onChange }: LayerTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const px = width / Math.max(0.01, durationSec);

  const clips = useMemo(() => [...(schema?.clips || [])].sort((a, b) => a.startSec - b.startSec), [schema]);
  const layerNames = useMemo(() => {
    try {
      const doc = new DOMParser().parseFromString(`<body>${(schema?.clips || []).length ? "" : ""}</body>`, "text/html");
      void doc;
    } catch { /* cosmetic only */ }
    return null;
  }, [schema]);
  void layerNames;

  const dragRef = useRef<null | {
    mode: "move" | "l" | "r" | "kf";
    clipLayerId: string;
    startX: number;
    start: number;
    end: number;
    kfs?: Array<{ tweenIdx: number; kfIdx: number }>;
    blockLeft?: number;
    blockW?: number;
  }>(null);

  const commitClip = (layerId: string, patch: Partial<{ startSec: number; endSec: number }>) => {
    if (!schema) return;
    const nextClips = schema.clips.map(c => (c.layerId === layerId ? { ...c, ...patch } : c));
    const next = normalizeAnimation({ ...schema, clips: nextClips });
    if (next) onChange(next);
  };

  const commitKeyframes = (layerId: string, tweenIdx: number, updates: Array<{ kfIdx: number; t: number }>) => {
    if (!schema) return;
    const nextClips = schema.clips.map(c => {
      if (c.layerId !== layerId) return c;
      const tweens = c.tweens.map((tw, ti) => {
        if (ti !== tweenIdx) return tw;
        const keyframes = tw.keyframes.map((kf, ki) => {
          const hit = updates.find(u => u.kfIdx === ki);
          return hit ? { ...kf, t: clamp(hit.t, 0, 1) } : kf;
        });
        // Keep keyframes ordered by t after a drag.
        keyframes.sort((a, b) => a.t - b.t);
        return { ...tw, keyframes };
      });
      return { ...c, tweens };
    });
    const next = normalizeAnimation({ ...schema, clips: nextClips });
    if (next) onChange(next);
  };

  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d || width <= 0) return;
    const dt = (e.clientX - d.startX) / px;
    if (d.mode === "kf") {
      const local = clamp((e.clientX - (d.blockLeft ?? 0)) / Math.max(1, d.blockW ?? 1), 0, 1);
      // The FIRST recorded (tween, keyframe) pair drives; siblings recorded at
      // the same t follow it so multi-prop keyframes stay in sync.
      const firstPair = d.kfs?.[0];
      if (!firstPair) return;
      commitKeyframes(d.clipLayerId, firstPair.tweenIdx, (d.kfs || []).map(pair => ({ kfIdx: pair.kfIdx, t: local })));
      return;
    }
    if (d.mode === "move") {
      const ns = clamp(d.start + dt, 0, durationSec - 0.05);
      const ne = clamp(d.end + dt, ns + 0.05, durationSec);
      commitClip(d.clipLayerId, { startSec: ns, endSec: ne });
    } else if (d.mode === "l") {
      commitClip(d.clipLayerId, { startSec: clamp(d.start + dt, 0, d.end - 0.05) });
    } else {
      commitClip(d.clipLayerId, { endSec: clamp(d.end + dt, d.start + 0.05, durationSec) });
    }
  }, [px, width, durationSec, schema]);

  useEffect(() => {
    const move = (e: PointerEvent) => onPointerMove(e);
    const up = () => { dragRef.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [onPointerMove]);

  const seekFromEvent = (e: React.PointerEvent) => {
    const el = trackRef.current;
    if (!el || width <= 0) return;
    const rect = el.getBoundingClientRect();
    onSeekLocal((e.clientX - rect.left) / px);
  };

  const tickStep = durationSec > 16 ? 2 : durationSec > 6 ? 1 : 0.5;

  return (
    <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "8px 14px 10px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 5 }}>
        <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#9a968a" }}>Timeline de la toma</span>
        <span style={muted}>arrastra bloques (mover) · bordes (duración) · puntos (keyframes) · click = scrub</span>
      </div>
      <div ref={trackRef} style={{ position: "relative", height: Math.max(46, 26 + clips.length * 26), background: "rgba(255,255,255,0.02)", borderRadius: 4, border: "1px solid rgba(255,255,255,0.05)", overflow: "hidden", cursor: "text" }}
        onPointerDown={seekFromEvent}>
        {/* Ruler ticks */}
        {width > 0 && Array.from({ length: Math.floor(durationSec / tickStep) + 1 }, (_, i) => {
          const t = i * tickStep;
          return (
            <div key={i} style={{ position: "absolute", left: t * px, top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.045)", pointerEvents: "none" }}>
              <span style={{ position: "absolute", top: 1, left: 2, fontSize: 8, color: "#5a5648", fontFamily: "monospace" }}>{t % 1 === 0 ? `${t}s` : ""}</span>
            </div>
          );
        })}
        {/* Clip blocks */}
        {width > 0 && clips.map(clip => {
          const left = clip.startSec * px;
          const w = Math.max(6, (clip.endSec - clip.startSec) * px);
          return (
            <div key={clip.layerId} style={{ position: "absolute", left, top: 22, width: w, height: 20 }}>
              <div
                onPointerDown={e => { e.stopPropagation(); dragRef.current = { mode: "move", clipLayerId: clip.layerId, startX: e.clientX, start: clip.startSec, end: clip.endSec }; }}
                style={{ position: "absolute", inset: 0, background: "rgba(200,184,152,0.22)", border: "1px solid rgba(200,184,152,0.5)", borderRadius: 3, cursor: "grab", overflow: "hidden" }}
                title={`${clip.layerId} · ${clip.tweens.length} tween(s)`}
              >
                <span style={{ position: "absolute", left: 4, top: 2, fontSize: 8, color: "#e8dcc0", fontFamily: "monospace", whiteSpace: "nowrap", pointerEvents: "none" }}>
                  {clip.layerId.length > 22 ? clip.layerId.slice(0, 20) + "…" : clip.layerId}
                </span>
              </div>
              {/* Edge resize handles */}
              <div onPointerDown={e => { e.stopPropagation(); dragRef.current = { mode: "l", clipLayerId: clip.layerId, startX: e.clientX, start: clip.startSec, end: clip.endSec }; }}
                style={{ position: "absolute", left: -3, top: 0, width: 7, height: "100%", cursor: "ew-resize" }} />
              <div onPointerDown={e => { e.stopPropagation(); dragRef.current = { mode: "r", clipLayerId: clip.layerId, startX: e.clientX, start: clip.startSec, end: clip.endSec }; }}
                style={{ position: "absolute", right: -3, top: 0, width: 7, height: "100%", cursor: "ew-resize" }} />
              {/* Keyframe dots (union across tweens; middle keyframes only —
                  the 0/1 endpoints are the block edges themselves) */}
              {clip.tweens.map((tw, ti) => tw.keyframes.map((kf, ki) => {
                if (ki === 0 || ki === tw.keyframes.length - 1) return null;
                const dotLeft = (clip.startSec + kf.t * (clip.endSec - clip.startSec)) * px - left - 3;
                return (
                  <div key={`${ti}:${ki}`}
                    onPointerDown={e => {
                      e.stopPropagation();
                      // Grab every tween's keyframe sitting at the same t.
                      const kfs: Array<{ tweenIdx: number; kfIdx: number }> = [];
                      clip.tweens.forEach((tw2, ti2) => tw2.keyframes.forEach((kf2, ki2) => {
                        if (ki2 > 0 && ki2 < tw2.keyframes.length - 1 && Math.abs(kf2.t - kf.t) < 0.02) kfs.push({ tweenIdx: ti2, kfIdx: ki2 });
                      }));
                      dragRef.current = { mode: "kf", clipLayerId: clip.layerId, startX: e.clientX, start: clip.startSec, end: clip.endSec, kfs, blockLeft: left, blockW: w };
                    }}
                    title={`${tw.prop} @ ${(kf.t * (clip.endSec - clip.startSec)).toFixed(2)}s`}
                    style={{
                      position: "absolute", left: dotLeft, top: 22, width: 7, height: 7, borderRadius: "50%",
                      background: "#e8dcc0", border: "1px solid rgba(0,0,0,0.5)", cursor: "ew-resize", zIndex: 2,
                    }} />
                );
              }))}
            </div>
          );
        })}
        {/* Playhead */}
        {width > 0 && (
          <div style={{ position: "absolute", left: localT * px, top: 0, bottom: 0, width: 2, background: "#e0b57a", pointerEvents: "none" }}>
            <div style={{ position: "absolute", top: -1, left: -3, width: 8, height: 8, borderRadius: "50%", background: "#e0b57a" }} />
          </div>
        )}
        {clips.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", ...muted }}>
            Esta toma no tiene clips — aplica presets desde el panel Animación o pídeselo a la IA.
          </div>
        )}
      </div>
    </div>
  );
}
