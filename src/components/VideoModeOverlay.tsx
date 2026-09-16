/**
 * VideoModeOverlay — "Modo Video" v3 (REQ-VID1..8 + V3 sprint).
 *
 * EMBEDDED in the editor chrome, CapCut layout:
 *   • Left  — media bin: takes, media uploads, music, voiceover recorder,
 *     text/stickers, workspace assets (Recursos).
 *   • Center — player (SAME export sampler ⇒ WYSIWYG) + transport + the
 *     V3 overlay layers: media clips (video/image pools) and text clips
 *     rendered through captions.ts — the exact module the export draws with.
 *   • Right — context inspector (take/layer/media/text/audio props, per-take
 *     look filters, effect presets, WebM/MP4 export, publish, quota).
 *   • Bottom — ONE multi-track timeline (V1 takes · layers · M media ·
 *     T text · A audio) with split/duplicate/delete + beat snapping.
 *
 * It never touches WAAPI: it edits frame.animation (single source of truth)
 * and renders through the export sampler. Everything else persists via the
 * template's videoTimeline doc (videoTimelineDoc.ts, schema v2).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cssPropertyOf,
  defaultAnimation,
  normalizeAnimation,
  sampleAnimationAt,
  type AnimationSchema,
  type TransitionType,
} from "../../shared/animationSchema.ts";
import { buildReelTimeline, sampleReelAt, takeStartSec } from "../lib/sequencePlayback";
import {
  downloadVideoBlob,
  exportReelVideo,
  type ReelAudioClipInput,
  type ReelExportMediaClip,
} from "../lib/videoExport";
import { decodeAudioForBeats, detectBeats } from "../lib/audioBeats";
import { uploadReelAudio, uploadReelMedia, uploadReelVideo } from "../lib/reelUpload";
import { captionStyle } from "./video/captions";
import { mapBodySelectors } from "../lib/frameCapture";
import type { ReelAudioClip, ReelMediaClip, ReelTextClip, VideoTimelineDoc } from "../lib/videoTimelineDoc";
import type { FrameData } from "./DesignFrame";
import { useFrameThumbnails } from "./video/useFrameThumbnails";
import { VideoTimeline, type TimelineSelection } from "./video/VideoTimeline";
import { VideoInspector, EFFECT_PRESETS } from "./video/VideoInspector";
import { VideoMediaPanel } from "./video/VideoMediaPanel";

// ── Local idiom ──

const smallBtn: React.CSSProperties = {
  fontSize: 10, padding: "3px 8px", borderRadius: 3,
  border: "1px solid rgba(200,184,152,0.15)", background: "rgba(200,184,152,0.05)",
  color: "#c8b898", cursor: "pointer", fontFamily: "inherit",
};
const muted: React.CSSProperties = { fontSize: 10, lineHeight: 1.5, color: "#7a7668" };

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

/** Keys the timeline handles — kept away from the editor's window-level
 *  shortcuts while the mode is open (S/Ctrl+D are the v3 clip ops). */
const HANDLED_KEYS = new Set([" ", "ArrowLeft", "ArrowRight", "Home", "Delete", "Backspace", "s", "S", "d", "D"]);

export interface VideoModeOverlayProps {
  frames: FrameData[];
  selectedFrameId: string | null;
  onAnimationFrameChange: (frameId: string, next: AnimationSchema | null) => void;
  onFrameReelChange: (frameId: string, reelExcluded: boolean) => void;
  /** V3.2: per-take CSS look filter ("" = original). */
  onFrameReelFilterChange: (frameId: string, filter: string) => void;
  onFramesReorder: (orderedIds: string[]) => void;
  onClose: () => void;
  addToast: (msg: string, kind?: "success" | "error" | "info") => void;
  workspaceId: string;
  videoTimelineDoc: VideoTimelineDoc;
  onVideoTimelineChange: (doc: VideoTimelineDoc) => void;
}

export function VideoModeOverlay({
  frames, selectedFrameId, onAnimationFrameChange, onFrameReelChange, onFrameReelFilterChange, onFramesReorder,
  onClose, addToast, workspaceId,
  videoTimelineDoc: doc, onVideoTimelineChange,
}: VideoModeOverlayProps) {
  // ── Reel model ──
  const included = useMemo(() => frames.filter(f => !f.reelExcluded), [frames]);
  const tl = useMemo(() => buildReelTimeline(included), [included]);

  // ── Playback clock ──
  const [playing, setPlaying] = useState(false);
  const [tSec, setTSec] = useState(0);
  const tRef = useRef(0);
  const rafRef = useRef(0);
  const lastWallRef = useRef(0);
  const docRef = useRef(doc);
  docRef.current = doc;

  const seek = useCallback((t: number) => {
    const v = clamp(t, 0, Math.max(0, tl.totalDurationSec - 0.001));
    tRef.current = v;
    setTSec(v);
  }, [tl.totalDurationSec]);

  // ── Stage DOM (scoped re-render of each frame's html+css) ──
  const scalerRef = useRef<HTMLDivElement>(null);
  const wrappersRef = useRef<Map<string, HTMLDivElement>>(new Map());

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
        // V3.2: per-take look — same filter string the export injects.
        el.style.filter = frame.reelFilter || "";
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

  // ── Audio preview (one <audio> per doc clip, synced to the clock) ──
  const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  // ── V3.4 media preview pool (one <video> per clip) ──
  const mediaElsRef = useRef<Map<string, HTMLVideoElement>>(new Map());

  /** Sync the pooled preview videos to the clock (play/pause + drift fix). */
  const syncMedia = useCallback((t: number, playingNow: boolean) => {
    for (const mc of docRef.current.mediaClips) {
      if (mc.kind !== "video") continue;
      const el = mediaElsRef.current.get(mc.id);
      if (!el) continue;
      const active = t >= mc.startSec && t < mc.startSec + mc.durationSec;
      if (active) {
        const dur = Number.isFinite(el.duration) ? el.duration : 0;
        const local = dur > 0 ? (mc.trimInSec + (t - mc.startSec)) % dur : 0;
        if (dur > 0 && Math.abs(el.currentTime - local) > (playingNow ? 0.35 : 0.12)) {
          try { el.currentTime = local; } catch { /* metadata not ready yet */ }
        }
        el.volume = clamp(mc.volume, 0, 1);
        if (playingNow && el.paused) void el.play().catch(() => { /* autoplay guards */ });
        if (!playingNow && !el.paused) el.pause();
      } else if (!el.paused) {
        el.pause();
      }
    }
  }, []);

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
      // Every placed clip follows the clock: active clips sync + play,
      // everything else pauses (loop handled by the element).
      for (const clip of docRef.current.audioClips) {
        const el = audioElsRef.current.get(clip.id);
        if (!el) continue;
        const active = t >= clip.startSec && t < clip.startSec + clip.durationSec && el.duration > 0;
        if (active) {
          const local = (t - clip.startSec) % el.duration;
          if (Math.abs(el.currentTime - local) > 0.35) el.currentTime = local;
          el.volume = clamp(clip.volume, 0, 1); // preview clamps; export honors up to 1.5
          if (el.paused) void el.play().catch(() => { /* autoplay guards */ });
        } else if (!el.paused) {
          el.pause();
        }
      }
      syncMedia(t, true);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, tl.totalDurationSec, syncMedia]);

  // Paused scrubbing: keep videos frame-accurate without playing them.
  useEffect(() => {
    if (!playing) syncMedia(tSec, false);
  }, [tSec, playing, syncMedia]);

  const togglePlay = () => {
    const next = !playing;
    setPlaying(next);
    if (next) {
      // Prime the clips active at the current playhead (needs the user
      // gesture — rAF-issued play() alone can be blocked).
      for (const clip of doc.audioClips) {
        const el = audioElsRef.current.get(clip.id);
        if (!el) continue;
        if (tRef.current >= clip.startSec && tRef.current < clip.startSec + clip.durationSec && el.duration > 0) {
          el.currentTime = (tRef.current - clip.startSec) % el.duration;
          void el.play().catch(() => { /* autoplay guards */ });
        }
      }
      syncMedia(tRef.current, true);
    } else {
      for (const el of audioElsRef.current.values()) el.pause();
      for (const el of mediaElsRef.current.values()) el.pause();
    }
  };

  const stopAll = () => {
    setPlaying(false);
    for (const el of audioElsRef.current.values()) el.pause();
    for (const el of mediaElsRef.current.values()) el.pause();
    seek(0);
  };

  // Escape exits (window-level: focus can sit anywhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Root-capture swallow: the timeline's keys must not trigger editor
   *  shortcuts (mod+B batch, mod+/ code, …). */
  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    if (HANDLED_KEYS.has(e.key)) e.stopPropagation();
  };

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
  const dispW = first ? Math.round(first.width * fit) : 0;
  const dispH = first ? Math.round(first.height * fit) : 0;

  // ── Thumbnails (shared hook — timeline + media panel) ──
  const thumbs = useFrameThumbnails(frames, 96);

  // ── Schema edits (same persistence path as AnimationPanel) ──
  const schemaOf = (frame: FrameData): AnimationSchema =>
    (frame.animation ? normalizeAnimation(frame.animation) : null) || defaultAnimation(frame.width, frame.height);

  const setTakeDuration = (frame: FrameData, d: number) => {
    const base = schemaOf(frame);
    onAnimationFrameChange(frame.id, normalizeAnimation({ ...base, timeline: { ...base.timeline, durationSec: clamp(d, 0.2, 600) } }));
  };

  const setTransition = (fromFrame: FrameData, toFrameId: string, next: { type: TransitionType; durationSec: number } | null) => {
    const base = schemaOf(fromFrame);
    const others = base.transitions.filter(t => t.toFrameId !== toFrameId);
    const transitions = next ? [...others, { toFrameId, type: next.type, durationSec: next.durationSec }] : others;
    onAnimationFrameChange(fromFrame.id, normalizeAnimation({ ...base, transitions }));
  };

  // ── Selection ──
  const [selection, setSelection] = useState<TimelineSelection | null>(null);

  const seekToTake = (frameId: string) => {
    const incIdx = included.findIndex(f => f.id === frameId);
    if (incIdx >= 0) seek(takeStartSec(tl, incIdx) + 0.001);
  };

  /** Media-panel drop on V1: membership fix + stitched reorder, both over
   *  the SAME updated base array so the two commits can't clobber. */
  const handleDropFrame = (frameId: string, insertIncIdx: number) => {
    const wasExcluded = frames.find(f => f.id === frameId)?.reelExcluded ?? false;
    if (wasExcluded) onFrameReelChange(frameId, false);
    const updated = frames.map(f => (f.id === frameId ? { ...f, reelExcluded: false } : f));
    const incIds = updated.filter(f => !f.reelExcluded).map(f => f.id);
    const from = incIds.indexOf(frameId);
    if (from < 0) return;
    incIds.splice(from, 1);
    incIds.splice(clamp(insertIncIdx, 0, incIds.length), 0, frameId);
    const out: string[] = [];
    let k = 0;
    for (const f of updated) {
      if (f.reelExcluded) out.push(f.id);
      else out.push(incIds[k++] ?? f.id);
    }
    onFramesReorder(out);
  };

  // ── Audio doc edits ──
  const [audioBusy, setAudioBusy] = useState(false);

  const handleAudioFilePicked = async (file: File) => {
    if (!workspaceId) { addToast("Sin workspace — no se puede subir el audio", "error"); return; }
    setAudioBusy(true);
    try {
      const url = await uploadReelAudio(workspaceId, file);
      const duration = await new Promise<number>(resolve => {
        const probe = new Audio();
        probe.preload = "metadata";
        probe.onloadedmetadata = () => resolve(Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : 30);
        probe.onerror = () => resolve(30);
        probe.src = url;
      });
      const clip: ReelAudioClip = {
        id: `audio_${Date.now()}`,
        name: file.name,
        url,
        startSec: clamp(tRef.current, 0, Math.max(0, tl.totalDurationSec - 1)),
        durationSec: Math.max(2, duration),
        volume: 1,
        fadeInSec: 0.3,
        fadeOutSec: 1.2,
      };
      onVideoTimelineChange({ ...docRef.current, audioClips: [...docRef.current.audioClips, clip] });
      setSelection({ kind: "audio", clipId: clip.id });
      addToast(`Audio añadido: ${file.name} — se muxea al exportar`, "success");
    } catch (err) {
      addToast(`Audio falló: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setAudioBusy(false);
    }
  };

  const handleAudioChange = (clipId: string, patch: Partial<ReelAudioClip> | null) => {
    const clips = patch === null
      ? docRef.current.audioClips.filter(c => c.id !== clipId)
      : docRef.current.audioClips.map(c => (c.id === clipId ? { ...c, ...patch } : c));
    onVideoTimelineChange({ ...docRef.current, audioClips: clips });
  };

  // ── V3.4 media doc edits ──
  const [mediaBusy, setMediaBusy] = useState(false);

  const handleMediaChange = (clipId: string, patch: Partial<ReelMediaClip> | null) => {
    const clips = patch === null
      ? docRef.current.mediaClips.filter(c => c.id !== clipId)
      : docRef.current.mediaClips.map(c => (c.id === clipId ? { ...c, ...patch } : c));
    onVideoTimelineChange({ ...docRef.current, mediaClips: clips });
  };

  const addMediaClipFromUrl = useCallback(async (url: string, kind: "video" | "image", name: string) => {
    let sourceDurationSec = 0;
    if (kind === "video") {
      sourceDurationSec = await new Promise<number>(resolve => {
        const probe = document.createElement("video");
        probe.preload = "metadata";
        probe.onloadedmetadata = () => resolve(Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : 0);
        probe.onerror = () => resolve(0);
        probe.src = url;
      });
    }
    const clip: ReelMediaClip = {
      id: `media_${Date.now()}`, name, url, kind,
      startSec: clamp(tRef.current, 0, Math.max(0, tl.totalDurationSec - 1)),
      durationSec: kind === "video" ? Math.max(2, sourceDurationSec || 5) : 4,
      trimInSec: 0, sourceDurationSec, volume: 1, filter: "",
    };
    onVideoTimelineChange({ ...docRef.current, mediaClips: [...docRef.current.mediaClips, clip] });
    setSelection({ kind: "media", clipId: clip.id });
    addToast(`Media añadido: ${name}`, "success");
  }, [tl.totalDurationSec, onVideoTimelineChange, addToast]);

  const handleMediaFilePicked = async (file: File) => {
    if (!workspaceId) { addToast("Sin workspace — no se puede subir el media", "error"); return; }
    setMediaBusy(true);
    try {
      const { url, kind } = await uploadReelMedia(workspaceId, file);
      await addMediaClipFromUrl(url, kind, file.name);
      void refreshQuota();
    } catch (err) {
      addToast(`Media falló: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setMediaBusy(false);
    }
  };

  // ── V3.5 text doc edits ──
  const handleTextChange = (clipId: string, patch: Partial<ReelTextClip> | null) => {
    const clips = patch === null
      ? docRef.current.textClips.filter(c => c.id !== clipId)
      : docRef.current.textClips.map(c => (c.id === clipId ? { ...c, ...patch } : c));
    onVideoTimelineChange({ ...docRef.current, textClips: clips });
  };

  const addTextClip = (text: string, opts?: Partial<ReelTextClip>) => {
    const clip: ReelTextClip = {
      id: `text_${Date.now()}`, text,
      startSec: clamp(tRef.current, 0, Math.max(0, tl.totalDurationSec - 1)),
      durationSec: 3, xPct: 50, yPct: 78, sizePct: 5, color: "#ffffff",
      font: "system-ui, sans-serif", weight: 700, bg: "", anim: "fade",
      ...opts,
    };
    onVideoTimelineChange({ ...docRef.current, textClips: [...docRef.current.textClips, clip] });
    setSelection({ kind: "text", clipId: clip.id });
  };

  const handleAddText = () => {
    addTextClip("Texto nuevo");
    addToast("Texto añadido en el playhead — edítalo en el inspector", "success");
  };
  const handleAddSticker = (emoji: string) => {
    addTextClip(emoji, { yPct: 42, sizePct: 16, anim: "pop" });
  };

  // ── V3.3 clip ops (timeline toolbar + S / Ctrl+D / Del) ──
  const splitAtPlayhead = () => {
    const t = tRef.current;
    const inWin = (c: { startSec: number; durationSec: number }) => t > c.startSec + 0.05 && t < c.startSec + c.durationSec - 0.05;
    // Priority: the selected clip if the playhead crosses it, else the
    // topmost clip under the playhead (audio → media → text).
    let target: { list: "audio" | "media" | "text"; clip: ReelAudioClip | ReelMediaClip | ReelTextClip } | null = null;
    if (selection?.kind === "audio") { const c = docRef.current.audioClips.find(x => x.id === selection.clipId); if (c && inWin(c)) target = { list: "audio", clip: c }; }
    if (!target && selection?.kind === "media") { const c = docRef.current.mediaClips.find(x => x.id === selection.clipId); if (c && inWin(c)) target = { list: "media", clip: c }; }
    if (!target && selection?.kind === "text") { const c = docRef.current.textClips.find(x => x.id === selection.clipId); if (c && inWin(c)) target = { list: "text", clip: c }; }
    if (!target) { const c = docRef.current.audioClips.find(inWin); if (c) target = { list: "audio", clip: c }; }
    if (!target) { const c = docRef.current.mediaClips.find(inWin); if (c) target = { list: "media", clip: c }; }
    if (!target) { const c = docRef.current.textClips.find(inWin); if (c) target = { list: "text", clip: c }; }
    if (!target) { addToast("Nada que dividir en el playhead", "info"); return; }

    const leftDur = t - target.clip.startSec;
    if (target.list === "audio") {
      const c = target.clip as ReelAudioClip;
      const right: ReelAudioClip = { ...c, id: `audio_${Date.now()}_b`, startSec: t, durationSec: c.durationSec - leftDur };
      onVideoTimelineChange({ ...docRef.current, audioClips: [...docRef.current.audioClips.map(x => (x.id === c.id ? { ...x, durationSec: leftDur } : x)), right] });
      setSelection({ kind: "audio", clipId: right.id });
    } else if (target.list === "media") {
      const c = target.clip as ReelMediaClip;
      const right: ReelMediaClip = { ...c, id: `media_${Date.now()}_b`, startSec: t, durationSec: c.durationSec - leftDur };
      onVideoTimelineChange({ ...docRef.current, mediaClips: [...docRef.current.mediaClips.map(x => (x.id === c.id ? { ...x, durationSec: leftDur } : x)), right] });
      setSelection({ kind: "media", clipId: right.id });
    } else {
      const c = target.clip as ReelTextClip;
      const right: ReelTextClip = { ...c, id: `text_${Date.now()}_b`, startSec: t, durationSec: c.durationSec - leftDur };
      onVideoTimelineChange({ ...docRef.current, textClips: [...docRef.current.textClips.map(x => (x.id === c.id ? { ...x, durationSec: leftDur } : x)), right] });
      setSelection({ kind: "text", clipId: right.id });
    }
    addToast("Clip dividido en el playhead", "success");
  };

  const duplicateSelection = () => {
    if (!selection) { addToast("Selecciona un clip para duplicar", "info"); return; }
    if (selection.kind === "audio") {
      const c = docRef.current.audioClips.find(x => x.id === selection.clipId);
      if (!c) return;
      const copy: ReelAudioClip = { ...c, id: `audio_${Date.now()}_d`, startSec: c.startSec + c.durationSec };
      onVideoTimelineChange({ ...docRef.current, audioClips: [...docRef.current.audioClips, copy] });
      setSelection({ kind: "audio", clipId: copy.id });
      addToast(`Duplicado: ${c.name}`, "success");
    } else if (selection.kind === "media") {
      const c = docRef.current.mediaClips.find(x => x.id === selection.clipId);
      if (!c) return;
      const copy: ReelMediaClip = { ...c, id: `media_${Date.now()}_d`, startSec: c.startSec + c.durationSec };
      onVideoTimelineChange({ ...docRef.current, mediaClips: [...docRef.current.mediaClips, copy] });
      setSelection({ kind: "media", clipId: copy.id });
      addToast(`Duplicado: ${c.name}`, "success");
    } else if (selection.kind === "text") {
      const c = docRef.current.textClips.find(x => x.id === selection.clipId);
      if (!c) return;
      const copy: ReelTextClip = { ...c, id: `text_${Date.now()}_d`, startSec: c.startSec + c.durationSec };
      onVideoTimelineChange({ ...docRef.current, textClips: [...docRef.current.textClips, copy] });
      setSelection({ kind: "text", clipId: copy.id });
      addToast("Texto duplicado", "success");
    } else {
      addToast("Solo se duplican clips de audio/media/texto", "info");
    }
  };

  const deleteSelection = () => {
    if (!selection) return;
    if (selection.kind === "audio") { handleAudioChange(selection.clipId, null); setSelection(null); }
    else if (selection.kind === "media") { handleMediaChange(selection.clipId, null); setSelection(null); }
    else if (selection.kind === "text") { handleTextChange(selection.clipId, null); setSelection(null); }
  };

  // ── V3.6 effect presets on layer clips ──
  const applyLayerEffect = (frameId: string, layerId: string, effectId: string) => {
    const frame = frames.find(f => f.id === frameId);
    const schema = frame?.animation ? normalizeAnimation(frame.animation) : null;
    if (!frame || !schema) return;
    const ef = EFFECT_PRESETS.find(e => e.id === effectId);
    if (!ef) return;
    const nextClips = schema.clips.map(c => {
      if (c.layerId !== layerId) return c;
      const kept = c.tweens.filter(t => !ef.props.includes(String(t.prop)));
      return { ...c, tweens: [...kept, ...ef.make()] };
    });
    const next = normalizeAnimation({ ...schema, clips: nextClips });
    if (next) {
      onAnimationFrameChange(frameId, next);
      addToast(`Efecto ${ef.label} aplicado a ${layerId}`, "success");
    }
  };

  // ── V3.8 beat detection ──
  const [markers, setMarkers] = useState<number[]>([]);
  const [beatsBusy, setBeatsBusy] = useState(false);
  const detectBeatsFor = async (clipId: string) => {
    const clip = docRef.current.audioClips.find(c => c.id === clipId);
    if (!clip) return;
    setBeatsBusy(true);
    try {
      const data = await fetchAudioData(clip.url);
      const buffer = await decodeAudioForBeats(data);
      const { beats } = detectBeats(buffer);
      setMarkers(beats);
      addToast(`${beats.length} beats detectados — ahora son puntos de snap`, "success");
    } catch (err) {
      addToast(`Beat detection falló: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setBeatsBusy(false);
    }
  };

  // ── Export (REQ-VID2 + V3.7) + upload (REQ-VID8) + quota ──
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<"webm" | "mp4">("webm");
  const lastExportRef = useRef<{ blob: Blob; filename: string } | null>(null);
  const audioDataCache = useRef<Map<string, ArrayBuffer>>(new Map());

  const sizes = new Set(included.map(f => `${f.width}x${f.height}`));
  const homogeneous = sizes.size <= 1;
  const sizesSummary = [...sizes].join(" vs ");

  const [quota, setQuota] = useState<{ bytes: number; count: number } | null>(null);
  const refreshQuota = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await fetch(`/api/storage/usage?workspaceId=${encodeURIComponent(workspaceId)}`);
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success && json?.data) {
        setQuota({ bytes: Number(json.data.bytes) || 0, count: Number(json.data.count) || 0 });
      }
    } catch { /* quota is cosmetic */ }
  }, [workspaceId]);
  useEffect(() => { void refreshQuota(); }, [refreshQuota]);

  const fetchAudioData = async (url: string): Promise<ArrayBuffer> => {
    const hit = audioDataCache.current.get(url);
    if (hit) return hit;
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    audioDataCache.current.set(url, buf);
    return buf;
  };

  const doExport = async (): Promise<void> => {
    if (exporting || included.length === 0) return;
    if (!homogeneous) {
      addToast(`Tomas con tamaños distintos (${sizesSummary}) — iguala el aspect ratio antes de exportar`, "error");
      return;
    }
    setExporting(true);
    setProgress(0);
    try {
      const audioTracks: ReelAudioClipInput[] = [];
      for (const clip of docRef.current.audioClips) {
        try {
          audioTracks.push({
            data: await fetchAudioData(clip.url),
            startSec: clip.startSec,
            durationSec: clip.durationSec,
            volume: clip.volume,
            fadeInSec: clip.fadeInSec,
            fadeOutSec: clip.fadeOutSec,
          });
        } catch { /* one broken clip must not kill the export */ }
      }
      const mediaClipsExport: ReelExportMediaClip[] = docRef.current.mediaClips.map(mc => ({
        kind: mc.kind, url: mc.url, startSec: mc.startSec, durationSec: mc.durationSec,
        trimInSec: mc.trimInSec, sourceDurationSec: mc.sourceDurationSec, volume: mc.volume, filter: mc.filter,
      }));
      const result = await exportReelVideo({
        frames: included.map(f => ({
          id: f.id, html: f.html, css: f.css, width: f.width, height: f.height,
          background: f.background, animation: f.animation ?? null, filter: f.reelFilter || undefined,
        })),
        audioTracks: audioTracks.length > 0 ? audioTracks : undefined,
        mediaClips: mediaClipsExport.length > 0 ? mediaClipsExport : undefined,
        texts: docRef.current.textClips.length > 0 ? docRef.current.textClips : undefined,
        format: exportFormat,
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
      const url = await uploadReelVideo(workspaceId, current.blob, current.filename);
      setPublishedUrl(url);
      addToast("Reel subido — URL pública lista para publicar (Zernio mediaUrl)", "success");
      void refreshQuota();
    } catch (err) {
      addToast(`Upload falló: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setUploading(false);
    }
  };

  // ── Context chip over the preview (floating toolbar, Clipchamp-style) ──
  const contextChip = (() => {
    if (!selection) return <span style={muted}>Sin selección — click en un clip del timeline</span>;
    if (selection.kind === "take") {
      const f = frames.find(x => x.id === selection.frameId);
      const incIdx = included.findIndex(x => x.id === selection.frameId);
      return <span style={{ fontSize: 10, color: "#c8b898", fontFamily: "monospace" }}>🎥 Toma: {f?.name} ({fmt(tl.takes[incIdx]?.durationSec ?? 0)})</span>;
    }
    if (selection.kind === "layer") return <span style={{ fontSize: 10, color: "#c8b898", fontFamily: "monospace" }}>⬡ Capa: {selection.layerId}</span>;
    if (selection.kind === "media") {
      const c = doc.mediaClips.find(x => x.id === selection.clipId);
      return <span style={{ fontSize: 10, color: "#c8b898", fontFamily: "monospace" }}>🎬 Media: {c?.name}</span>;
    }
    if (selection.kind === "text") {
      const c = doc.textClips.find(x => x.id === selection.clipId);
      return <span style={{ fontSize: 10, color: "#c8b898", fontFamily: "monospace" }}>T Texto: {c ? c.text.slice(0, 18) : ""}</span>;
    }
    const clip = doc.audioClips.find(c => c.id === selection.clipId);
    return <span style={{ fontSize: 10, color: "#c8b898", fontFamily: "monospace" }}>♪ Audio: {clip?.name}</span>;
  })();

  if (frames.length === 0) {
    return (
      <div style={{ position: "absolute", inset: 0, zIndex: 5, background: "#0a0a0a", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={muted}>Sin frames en el archivo — crea uno para armar el reel.</div>
      </div>
    );
  }

  return (
    <div
      onKeyDownCapture={onKeyDownCapture}
      style={{ position: "absolute", inset: 0, zIndex: 5, background: "#0a0a0a", display: "flex", flexDirection: "column", color: "#f0ebe0", fontFamily: "inherit", overflow: "hidden" }}
    >
      {/* ── Body: media | player | inspector ── */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <VideoMediaPanel
          frames={frames}
          included={included}
          thumbs={thumbs}
          doc={doc}
          selection={selection}
          onSelect={setSelection}
          onFrameReelChange={onFrameReelChange}
          onAudioFilePicked={f => void handleAudioFilePicked(f)}
          audioBusy={audioBusy}
          onSeekToTake={seekToTake}
          workspaceId={workspaceId}
          addToast={addToast}
          onMediaFilePicked={f => void handleMediaFilePicked(f)}
          mediaBusy={mediaBusy}
          onAddMediaFromUrl={(url, kind, name) => void addMediaClipFromUrl(url, kind, name)}
          onAddText={handleAddText}
          onAddSticker={handleAddSticker}
          onVoiceoverFile={f => void handleAudioFilePicked(f)}
        />

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {/* Mode bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, color: "#c8b898" }}>MODO VIDEO</span>
            <span style={muted}>{included.length} toma{included.length === 1 ? "" : "s"} · {fmt(tl.totalDurationSec)} · {tl.fps} fps</span>
            <div style={{ flex: 1 }} />
            <button type="button" onClick={onClose} style={{ ...smallBtn, padding: "4px 12px" }}>← Volver al diseño</button>
          </div>

          {/* Stage + V3 overlay layers + floating context chip */}
          <div ref={stageAreaRef} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minWidth: 0, position: "relative" }}>
            {first && fit > 0 && (
              <div style={{ position: "relative", width: dispW, height: dispH, overflow: "hidden", background: "#000", borderRadius: 4, boxShadow: "0 8px 40px rgba(0,0,0,0.6)" }}>
                <div
                  ref={scalerRef}
                  style={{ position: "absolute", top: 0, left: 0, width: first.width, height: first.height, transform: `scale(${fit})`, transformOrigin: "top left", pointerEvents: "none" }}
                />
                {/* V3.4 media overlay (displayed-size box, like the export canvas) */}
                <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
                  {doc.mediaClips.map(mc => {
                    const active = tSec >= mc.startSec && tSec < mc.startSec + mc.durationSec;
                    const common: React.CSSProperties = {
                      position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain",
                      filter: mc.filter || undefined, display: active ? "block" : "none",
                    };
                    if (mc.kind === "image") {
                      return <img key={mc.id} src={mc.url} alt="" crossOrigin="anonymous" style={common} />;
                    }
                    return (
                      <video
                        key={mc.id}
                        ref={el => { if (el) mediaElsRef.current.set(mc.id, el); else mediaElsRef.current.delete(mc.id); }}
                        src={mc.url}
                        crossOrigin="anonymous"
                        muted
                        playsInline
                        preload="auto"
                        style={common}
                      />
                    );
                  })}
                  {/* V3.5 text overlay — SAME renderer the export draws with */}
                  {doc.textClips.map(tc => {
                    const active = tSec >= tc.startSec && tSec < tc.startSec + tc.durationSec;
                    if (!active) return null;
                    return (
                      <div key={tc.id} style={captionStyle(tc, dispW, dispH, tSec - tc.startSec)}>{tc.text}</div>
                    );
                  })}
                </div>
              </div>
            )}
            <div style={{ position: "absolute", top: 8, left: 12, right: 12, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
              <div style={{ background: "rgba(10,10,10,0.8)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "3px 12px", pointerEvents: "auto" }}>
                {contextChip}
              </div>
            </div>
          </div>

          {/* Transport */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            <button type="button" onClick={togglePlay} style={{ ...smallBtn, padding: "4px 14px", fontSize: 11 }}>
              {playing ? "❚❚ Pausa" : "▶ Play"}
            </button>
            <button type="button" onClick={stopAll} style={smallBtn} title="Stop y rebobinar">■</button>
            <span style={{ fontSize: 10, fontFamily: "monospace", color: "#c8b898" }}>{fmt(tSec)} / {fmt(tl.totalDurationSec)}</span>
            <div style={{ flex: 1 }} />
            <span style={muted}>Space = play · S = dividir · Ctrl+D = duplicar · Del = borrar clip</span>
          </div>
        </div>

        <div style={{ flex: "0 0 268px", borderLeft: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", minHeight: 0, background: "#0d0d0d" }}>
          <VideoInspector
            frames={frames}
            included={included}
            tl={tl}
            doc={doc}
            selection={selection}
            onSelect={setSelection}
            onTakeDuration={setTakeDuration}
            onAnimationFrameChange={onAnimationFrameChange}
            onTransitionChange={setTransition}
            onFrameReelChange={onFrameReelChange}
            onFrameReelFilterChange={onFrameReelFilterChange}
            onAudioChange={handleAudioChange}
            onMediaChange={handleMediaChange}
            onTextChange={handleTextChange}
            onApplyLayerEffect={applyLayerEffect}
            onDetectBeats={clipId => void detectBeatsFor(clipId)}
            beatsBusy={beatsBusy}
            exporting={exporting}
            progress={progress}
            uploading={uploading}
            publishedUrl={publishedUrl}
            onExport={() => void doExport()}
            onUploadPublish={() => void uploadReel()}
            onCopyUrl={() => { if (publishedUrl) { void navigator.clipboard.writeText(publishedUrl); addToast("URL copiada", "success"); } }}
            homogeneous={homogeneous}
            sizesSummary={sizesSummary}
            quota={quota}
            exportFormat={exportFormat}
            onExportFormatChange={setExportFormat}
          />
        </div>
      </div>

      {/* ── Timeline dock ── */}
      <VideoTimeline
        frames={frames}
        included={included}
        tl={tl}
        doc={doc}
        tSec={tSec}
        playing={playing}
        thumbs={thumbs}
        selection={selection}
        markers={markers}
        onSeek={t => { seek(t); }}
        onTogglePlay={togglePlay}
        onSelect={setSelection}
        onTakeDuration={setTakeDuration}
        onAnimationFrameChange={onAnimationFrameChange}
        onFramesReorder={onFramesReorder}
        onTransitionChange={setTransition}
        onAudioChange={handleAudioChange}
        onMediaChange={handleMediaChange}
        onTextChange={handleTextChange}
        onSplitAtPlayhead={splitAtPlayhead}
        onDuplicateSelection={duplicateSelection}
        onDeleteSelection={deleteSelection}
        onDropFrame={handleDropFrame}
      />

      {/* Hidden audio elements (one per persisted clip) */}
      {doc.audioClips.map(clip => (
        <audio
          key={clip.id}
          ref={el => { if (el) audioElsRef.current.set(clip.id, el); else audioElsRef.current.delete(clip.id); }}
          src={clip.url}
          loop
          preload="auto"
          style={{ display: "none" }}
        />
      ))}
    </div>
  );
}
