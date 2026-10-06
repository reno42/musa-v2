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
import { buildReelTimeline, resolveTakeLocal, sampleReelAt, takeStartSec } from "../lib/sequencePlayback";
import { placeTake, coverScale, aspectMismatch, DEFAULT_TAKE_LAYOUT, type ReelTakeLayout } from "../lib/reelLayout";
import {
  composeTransform,
  parseTransform,
  clearLayerClip,
  deleteKeyframe,
  moveKeyframe,
  setClipOrigin,
  setKeyframeAt,
  setStaticValue,
  setTweenEasing,
  toggleKeyframeAt,
  type TransformParts,
} from "../lib/layerKeyframes";
import {
  downloadVideoBlob,
  exportReelVideo,
  probeExportSupport,
  type ExportSupport,
  type ReelAudioClipInput,
  type ReelExportMediaClip,
} from "../lib/videoExport";
import { decodeAudioForBeats, detectBeats } from "../lib/audioBeats";
import { PREVIEW_TRANSITIONS, type PreviewTransitionCtx } from "../lib/transitionPreview";
import { REEL_STORAGE_SOFT_LIMIT_BYTES, uploadReelAudio, uploadReelMedia, uploadReelVideo } from "../lib/reelUpload";
import { captionStyle } from "./video/captions";
import { TAKE_FX, composeTakeFx, overlayFxStyle, resolveTransitionParams, type TransitionParams } from "../../shared/videoEffectsCatalog.ts";
import { mapBodySelectors } from "../lib/frameCapture";
import { REEL_FORMAT_PRESETS, resolveProject, type ReelAudioClip, type ReelMediaClip, type ReelProjectSettings, type ReelTextClip, type VideoTimelineDoc } from "../lib/videoTimelineDoc";
import type { VideoDocStore } from "../lib/videoDocStore";
import type { FrameData } from "./DesignFrame";
import { useFrameThumbnails } from "./video/useFrameThumbnails";
import { VideoTimeline, type TimelineSelection } from "./video/VideoTimeline";
import { VideoInspector, EFFECT_PRESETS, type LayerEdit } from "./video/VideoInspector";
import { createLayerGizmo, type LayerGizmo } from "./video/layerGizmo";
import { VideoMediaPanel } from "./video/VideoMediaPanel";
import { FxLibraryPanel } from "./video/FxLibraryPanel";

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

// V4: loop-resolution lives in sequencePlayback.resolveTakeLocal — one copy
// shared with the export sampler (no more private duplicate to keep in sync).

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
  /** V5.2: animated take FX (null = none). */
  onFrameReelFxChange: (frameId: string, fx: { id: string; intensity: number } | null) => void;
  /** V5.3: static overlay FX stack (empty = none). */
  onFrameReelOverlayFxChange: (frameId: string, ids: string[]) => void;
  /** V4.0: per-take framing on the project canvas (null = contain reset). */
  onFrameLayoutChange: (frameId: string, layout: ReelTakeLayout | null) => void;
  /** V4.3: copy an AI-adapt prompt for one frame to the clipboard. */
  onAdaptWithAI: (frameId: string, w: number, h: number) => void;
  /** V4.3: bake one take's framing into the design html. */
  onBakeToDesign: (frameId: string) => void;
  onFramesReorder: (orderedIds: string[]) => void;
  onClose: () => void;
  addToast: (msg: string, kind?: "success" | "error" | "info") => void;
  workspaceId: string;
  videoTimelineDoc: VideoTimelineDoc;
  /** RF-08 (Fase 1.1): cada mutación lleva label para el journal. */
  onVideoTimelineChange: (doc: VideoTimelineDoc, meta?: { label?: string }) => void;
  /** Store dueño del journal (undo/redo por operación semántica). */
  videoDocStore: VideoDocStore;
  /** mod+Z cae al undo del documento de diseño si el journal está vacío. */
  onVideoUndoFallback?: () => void;
  onVideoRedoFallback?: () => void;
  /** RF-01: persistent header — reel name + save state live in the overlay. */
  templateName: string;
  saveState: "saving" | "saved";
}

export function VideoModeOverlay({
  frames, selectedFrameId, onAnimationFrameChange, onFrameReelChange, onFrameReelFilterChange,
  onFrameReelFxChange, onFrameReelOverlayFxChange,
  onFrameLayoutChange, onAdaptWithAI, onBakeToDesign, onFramesReorder,
  onClose, addToast, workspaceId,
  videoTimelineDoc: doc, onVideoTimelineChange, videoDocStore, onVideoUndoFallback, onVideoRedoFallback,
  templateName, saveState,
}: VideoModeOverlayProps) {
  // ── Reel model + V4.0 project canvas ──
  const included = useMemo(() => frames.filter(f => !f.reelExcluded), [frames]);
  const tl = useMemo(() => buildReelTimeline(included), [included]);
  const project = useMemo(() => resolveProject(doc, frames), [doc, frames]);
  const mismatched = useMemo(() => included.filter(f => aspectMismatch(project, f)), [included, project]);

  // V4.1 auto-key — shared by the gizmo gestures and the inspector editor.
  const [autoKey, setAutoKey] = useState(true);
  const autoKeyRef = useRef(autoKey);
  autoKeyRef.current = autoKey;

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

  /** Paint the current global time onto the stage wrappers. V4.0: every take
   *  is placed on the project canvas (contain + re-frame); V5: the full
   *  35-type parametric vocabulary through PREVIEW_TRANSITIONS — the same
   *  registry math (and params) the export draws. */
  const applyLayers = useCallback(() => {
    const s = sampleReelAt(tl, tRef.current);
    const wraps = wrappersRef.current;
    const frameIndex = Math.round(tRef.current * (tl.fps || 30));
    const show = (id: string, on: boolean) => {
      const el = wraps.get(id);
      if (el) el.style.display = on ? "block" : "none";
    };
    for (const f of frames) show(f.id, false);
    activeTakeRef.current = null;
    if (flashRef.current) flashRef.current.style.opacity = "0";

    // V5: cover tiles / overlay FX pool — divs inside the scaler, wiped via
    // cssText each paint so no bag property ever survives into the next frame.
    const syncTiles = (bags: Array<Record<string, string>>) => {
      const layer = fxLayerRef.current;
      if (!layer) return;
      while (fxTilesRef.current.length < bags.length) {
        const el = document.createElement("div");
        layer.appendChild(el);
        fxTilesRef.current.push(el);
      }
      for (let i = 0; i < fxTilesRef.current.length; i++) {
        const el = fxTilesRef.current[i];
        const bag = bags[i];
        if (!bag) { el.style.display = "none"; continue; }
        el.style.cssText = "position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;display:block";
        for (const [k, v] of Object.entries(bag)) (el.style as unknown as Record<string, string>)[k] = v;
      }
    };

    const takeFilter = (frame: FrameData, blurPx: number, extra?: string) => {
      const terms = [frame.reelFilter || "", extra || ""].filter(Boolean);
      if (blurPx > 0.05) terms.push(`blur(${blurPx.toFixed(1)}px)`);
      return terms.join(" ");
    };

    const applyTake = (frame: FrameData, localT: number, wrapStyle: Record<string, string>, blurPx = 0, extraFilter?: string) => {
      show(frame.id, true);
      const el = wraps.get(frame.id);
      if (el) {
        // Per-paint paint props: transitions set them; stale values must
        // never survive into the next take/transition state.
        el.style.transform = "";
        el.style.opacity = "";
        el.style.clipPath = "";
        el.style.zIndex = "";
        const styleAny = el.style as unknown as Record<string, string>;
        styleAny.maskImage = "";
        styleAny.webkitMaskImage = "";
        styleAny.mixBlendMode = "";
        for (const [k, v] of Object.entries(wrapStyle)) styleAny[k] = v;
        // V4.0: contain-fit + user re-framing on the project canvas.
        const rect = placeTake(project, frame, frame.reelLayout);
        el.style.left = `${rect.left}px`;
        el.style.top = `${rect.top}px`;
        el.style.width = `${rect.width}px`;
        el.style.height = `${rect.height}px`;
        // V5: center-origin transition poses own this; plain takes keep the
        // legacy top-left anchor.
        el.style.transformOrigin = wrapStyle.transformOrigin || "top left";
        // Layer picking (gizmo) only while paused.
        el.style.pointerEvents = playingRef.current ? "none" : "auto";
        // V3.2 look + V5 transition blur/extra term — composed like the export.
        el.style.filter = takeFilter(frame, blurPx, extraFilter);
      }
      const anim = frame.animation ?? null;
      const samples = anim ? sampleAnimationAt(anim, resolveTakeLocal(anim, localT)) : null;
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
      const frame = included[s.takeIndex];
      activeTakeRef.current = frame ? { frameId: frame.id, localT: s.localT } : null;
      // V5.2 animated take FX: transform from localT (scrub-safe — no CSS
      // animation), identical math to the export's drawPlacedWithFx.
      const fxId = frame?.reelFx?.id;
      const fx = fxId ? TAKE_FX.find(f => f.id === fxId) : null;
      const fxState = fx && frame?.reelFx ? fx.at(s.localT, frame.reelFx.intensity, {
        w: project.width, h: project.height,
        beats: beatsRef.current,
        takeStartSec: takeStartSec(tl, s.takeIndex),
      }) : null;
      const fxT = fxState ? composeTakeFx(fxState) : "";
      applyTake(frame, s.localT, fxT ? { transform: fxT, transformOrigin: "top left" } : {});
      // V5.3 static overlay FX (grain/vignette/scanlines/leak).
      syncTiles(frame?.reelOverlayFx?.length ? frame.reelOverlayFx.map(id => overlayFxStyle(id, frameIndex)) : []);
    } else {
      activeTakeRef.current = null;
      const p = smoothstep(s.progress);
      const from = included[s.fromTakeIndex];
      const to = included[s.toTakeIndex];
      const rectOf = (f: FrameData) => {
        const r = placeTake(project, f, f.reelLayout);
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      };
      // V5: raw params off the from-frame's matched transition — the SAME
      // lookup buildReelTimeline uses; resolveTransitionParams fills defaults.
      const trs = from?.animation?.transitions || [];
      const match = trs.find(t => t.toFrameId === to?.id) || trs[0];
      const ctxP: PreviewTransitionCtx = {
        p,
        W: project.width,
        H: project.height,
        pr: resolveTransitionParams(s.type, match?.params),
        frameIndex,
        bg: project.bg,
        from: {},
        to: {},
        rectFrom: rectOf(from),
        rectTo: rectOf(to),
        blurFrom: 0,
        blurTo: 0,
        flash: 0,
        flashColor: "#ffffff",
        tiles: [],
      };
      (PREVIEW_TRANSITIONS[s.type] ?? PREVIEW_TRANSITIONS.fade)(ctxP);
      applyTake(from, tl.takes[s.fromTakeIndex].durationSec, ctxP.from, ctxP.blurFrom, ctxP.extraFrom);
      applyTake(to, 0, ctxP.to, ctxP.blurTo, ctxP.extraTo);
      if (flashRef.current) {
        flashRef.current.style.opacity = String(ctxP.flash);
        flashRef.current.style.background = ctxP.flashColor;
      }
      syncTiles(ctxP.tiles);
    }
    updateGizmoRef.current();
  }, [tl, included, frames, project]);

  useEffect(() => { applyLayers(); }, [tSec, applyLayers]);

  // ── Audio preview (one <audio> per doc clip, synced to the clock) ──
  const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  // ── V3.4 media preview pool (one <video> per clip) ──
  const mediaElsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  // ── V4.0/V4.1 stage refs: playhead/take guards, flash overlay, layer gizmo
  //  and ref-indirection so []-dep effects always see the latest closures. ──
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const stageBoxRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const fxLayerRef = useRef<HTMLDivElement>(null);
  const fxTilesRef = useRef<HTMLDivElement[]>([]);
  const activeTakeRef = useRef<{ frameId: string; localT: number } | null>(null);
  const gizmoRef = useRef<LayerGizmo | null>(null);
  const gizmoTargetRef = useRef<{ el: HTMLElement; frameId: string; layerId: string; parts: TransformParts } | null>(null);
  const livePartsRef = useRef<TransformParts>({ x: 0, y: 0, scale: 1, rotate: 0 });
  const [selection, setSelection] = useState<TimelineSelection | null>(null);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const updateGizmoRef = useRef<() => void>(() => {});
  const commitTransformRef = useRef<(frameId: string, layerId: string, parts: TransformParts) => void>(() => {});
  const fitRef = useRef(0);

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

  // ── V4.1 layer gizmo: lazy singleton over the stage box. Deltas come in
  //  DISPLAY px and are converted to frame px through the stage fit; every
  //  gesture commits exactly once through commitTransformRef. ──
  const updateGizmo = useCallback(() => {
    const stageBox = stageBoxRef.current;
    if (!stageBox) return;
    if (!gizmoRef.current) {
      const gizmo = createLayerGizmo(stageBox);
      gizmo.setHandlers({
        onMove: (dx, dy) => {
          const t = gizmoTargetRef.current;
          if (!t) return;
          const k = fitRef.current || 1;
          livePartsRef.current = { ...livePartsRef.current, x: t.parts.x + dx / k, y: t.parts.y + dy / k };
          t.el.style.transform = composeTransform(livePartsRef.current);
        },
        onScale: factor => {
          const t = gizmoTargetRef.current;
          if (!t) return;
          livePartsRef.current = { ...livePartsRef.current, scale: Math.max(0.02, t.parts.scale * factor) };
          t.el.style.transform = composeTransform(livePartsRef.current);
        },
        onRotate: delta => {
          const t = gizmoTargetRef.current;
          if (!t) return;
          livePartsRef.current = { ...livePartsRef.current, rotate: t.parts.rotate + delta };
          t.el.style.transform = composeTransform(livePartsRef.current);
        },
        onCommit: () => {
          const t = gizmoTargetRef.current;
          if (!t) return;
          commitTransformRef.current(t.frameId, t.layerId, { ...livePartsRef.current });
        },
      });
      gizmoRef.current = gizmo;
    }
    const gizmo = gizmoRef.current;
    if (gizmo.isDragging()) return;
    const sel = selectionRef.current;
    const active = activeTakeRef.current;
    const hide = () => { gizmo.hide(); gizmoTargetRef.current = null; };
    if (!sel || sel.kind !== "layer" || playingRef.current || !active || active.frameId !== sel.frameId) {
      hide();
      return;
    }
    const root = wrappersRef.current.get(sel.frameId);
    const layer = root?.querySelector<HTMLElement>(`[data-layer-id="${CSS.escape(sel.layerId)}"]`);
    if (!layer) { hide(); return; }
    const lr = layer.getBoundingClientRect();
    const sr = stageBox.getBoundingClientRect();
    if (lr.width <= 0 || lr.height <= 0) { hide(); return; }
    gizmo.show(lr.left - sr.left, lr.top - sr.top, lr.width, lr.height);
    // Sample the transform parts at the playhead for live editing.
    const frame = frames.find(f => f.id === sel.frameId);
    const schema = frame?.animation ? normalizeAnimation(frame.animation) : null;
    const anim = schema ?? defaultAnimation(frame?.width || 1080, frame?.height || 1920);
    const sample = sampleAnimationAt(anim, resolveTakeLocal(anim, active.localT)).get(sel.layerId) || {};
    const parts = parseTransform(sample.transform);
    livePartsRef.current = { ...parts };
    gizmoTargetRef.current = { el: layer, frameId: sel.frameId, layerId: sel.layerId, parts };
  }, [frames]);
  updateGizmoRef.current = updateGizmo;
  useEffect(() => { updateGizmoRef.current(); }, [selection, playing]);
  useEffect(() => () => { gizmoRef.current?.destroy(); gizmoRef.current = null; }, []);

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
  // Escape exits; mod+Z / mod+Shift+Z (o mod+Y) deshacen el journal del
  // modo video (RF-08) a nivel window: el foco puede estar en cualquier
  // lado. Los targets editables conservan el undo nativo del input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k !== "z" && k !== "y") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      e.stopPropagation();
      const isRedo = e.shiftKey || k === "y";
      const done = isRedo ? videoDocStore.redo() : videoDocStore.undo();
      if (done) { addToast(isRedo ? "Rehecho" : "Deshecho", "info"); return; }
      // Journal vacío: cae al undo/redo del documento de diseño (ops de
      // frames hechas desde el modo: duración de toma, keyframes…).
      if (isRedo) onVideoRedoFallback?.();
      else onVideoUndoFallback?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, videoDocStore, onVideoUndoFallback, onVideoRedoFallback, addToast]);

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
  // V4.0: the stage fits the PROJECT canvas — takes are placed inside it.
  const fit = project.width > 0 && project.height > 0
    ? Math.max(0.01, Math.min(fitArea.w / project.width, fitArea.h / project.height))
    : 0;
  fitRef.current = fit;
  const dispW = Math.round(project.width * fit);
  const dispH = Math.round(project.height * fit);

  // ── Thumbnails (shared hook — timeline + media panel) ──
  const thumbs = useFrameThumbnails(frames, 96);

  // ── Schema edits (same persistence path as AnimationPanel) ──
  const schemaOf = (frame: FrameData): AnimationSchema =>
    (frame.animation ? normalizeAnimation(frame.animation) : null) || defaultAnimation(frame.width, frame.height);

  const setTakeDuration = (frame: FrameData, d: number) => {
    const base = schemaOf(frame);
    onAnimationFrameChange(frame.id, normalizeAnimation({ ...base, timeline: { ...base.timeline, durationSec: clamp(d, 0.2, 600) } }));
  };

  const setTransition = (fromFrame: FrameData, toFrameId: string, next: { type: TransitionType; durationSec: number; params?: TransitionParams } | null) => {
    const base = schemaOf(fromFrame);
    const others = base.transitions.filter(t => t.toFrameId !== toFrameId);
    const transitions = next
      ? [...others, { toFrameId, type: next.type, durationSec: next.durationSec, ...(next.params && Object.keys(next.params).length ? { params: next.params } : {}) }]
      : others;
    onAnimationFrameChange(fromFrame.id, normalizeAnimation({ ...base, transitions }));
  };

  // ── Selection (state lives up with the V4.1 stage refs) ──

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
      // RF-035 D: quota real — bloquea antes de que Supabase falle.
      const audioBlocked = quotaBlocked(file.size);
      if (audioBlocked) { addToast(audioBlocked, "error"); return; }
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
      onVideoTimelineChange({ ...docRef.current, audioClips: [...docRef.current.audioClips, clip] }, { label: "añadir audio" });
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
    onVideoTimelineChange({ ...docRef.current, audioClips: clips }, { label: "editar audio" });
  };

  // ── V3.4 media doc edits ──
  const [mediaBusy, setMediaBusy] = useState(false);

  const handleMediaChange = (clipId: string, patch: Partial<ReelMediaClip> | null) => {
    const clips = patch === null
      ? docRef.current.mediaClips.filter(c => c.id !== clipId)
      : docRef.current.mediaClips.map(c => (c.id === clipId ? { ...c, ...patch } : c));
    onVideoTimelineChange({ ...docRef.current, mediaClips: clips }, { label: "editar media" });
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
    onVideoTimelineChange({ ...docRef.current, mediaClips: [...docRef.current.mediaClips, clip] }, { label: "añadir media" });
    setSelection({ kind: "media", clipId: clip.id });
    addToast(`Media añadido: ${name}`, "success");
  }, [tl.totalDurationSec, onVideoTimelineChange, addToast]);

  const handleMediaFilePicked = async (file: File) => {
    if (!workspaceId) { addToast("Sin workspace — no se puede subir el media", "error"); return; }
    // RF-035 D: quota real — bloquea antes de que Supabase falle.
    const mediaBlocked = quotaBlocked(file.size);
    if (mediaBlocked) { addToast(mediaBlocked, "error"); return; }
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
    onVideoTimelineChange({ ...docRef.current, textClips: clips }, { label: "editar texto" });
  };

  const addTextClip = (text: string, opts?: Partial<ReelTextClip>) => {
    const clip: ReelTextClip = {
      id: `text_${Date.now()}`, text,
      startSec: clamp(tRef.current, 0, Math.max(0, tl.totalDurationSec - 1)),
      durationSec: 3, xPct: 50, yPct: 78, sizePct: 5, color: "#ffffff",
      font: "system-ui, sans-serif", weight: 700, bg: "", anim: "fade",
      ...opts,
    };
    onVideoTimelineChange({ ...docRef.current, textClips: [...docRef.current.textClips, clip] }, { label: "añadir texto" });
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
      onVideoTimelineChange({ ...docRef.current, audioClips: [...docRef.current.audioClips.map(x => (x.id === c.id ? { ...x, durationSec: leftDur } : x)), right] }, { label: "dividir audio" });
      setSelection({ kind: "audio", clipId: right.id });
    } else if (target.list === "media") {
      const c = target.clip as ReelMediaClip;
      const right: ReelMediaClip = { ...c, id: `media_${Date.now()}_b`, startSec: t, durationSec: c.durationSec - leftDur };
      onVideoTimelineChange({ ...docRef.current, mediaClips: [...docRef.current.mediaClips.map(x => (x.id === c.id ? { ...x, durationSec: leftDur } : x)), right] }, { label: "dividir media" });
      setSelection({ kind: "media", clipId: right.id });
    } else {
      const c = target.clip as ReelTextClip;
      const right: ReelTextClip = { ...c, id: `text_${Date.now()}_b`, startSec: t, durationSec: c.durationSec - leftDur };
      onVideoTimelineChange({ ...docRef.current, textClips: [...docRef.current.textClips.map(x => (x.id === c.id ? { ...x, durationSec: leftDur } : x)), right] }, { label: "dividir texto" });
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
      onVideoTimelineChange({ ...docRef.current, audioClips: [...docRef.current.audioClips, copy] }, { label: "duplicar audio" });
      setSelection({ kind: "audio", clipId: copy.id });
      addToast(`Duplicado: ${c.name}`, "success");
    } else if (selection.kind === "media") {
      const c = docRef.current.mediaClips.find(x => x.id === selection.clipId);
      if (!c) return;
      const copy: ReelMediaClip = { ...c, id: `media_${Date.now()}_d`, startSec: c.startSec + c.durationSec };
      onVideoTimelineChange({ ...docRef.current, mediaClips: [...docRef.current.mediaClips, copy] }, { label: "duplicar media" });
      setSelection({ kind: "media", clipId: copy.id });
      addToast(`Duplicado: ${c.name}`, "success");
    } else if (selection.kind === "text") {
      const c = docRef.current.textClips.find(x => x.id === selection.clipId);
      if (!c) return;
      const copy: ReelTextClip = { ...c, id: `text_${Date.now()}_d`, startSec: c.startSec + c.durationSec };
      onVideoTimelineChange({ ...docRef.current, textClips: [...docRef.current.textClips, copy] }, { label: "duplicar texto" });
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

  // ── V4.0/V4.1 project + layer-object edits ──
  const handleProjectChange = (p: ReelProjectSettings) => {
    onVideoTimelineChange({ ...docRef.current, project: p }, { label: "formato del proyecto" });
    addToast(`Lienzo: ${p.width}×${p.height} (${p.preset})`, "info");
  };

  /** V4.0 Fit Advisor bulk action: every mismatched take goes cover. */
  const coverAllMismatched = () => {
    if (mismatched.length === 0) return;
    for (const f of mismatched) {
      onFrameLayoutChange(f.id, { scale: coverScale(project, f), xPct: 0, yPct: 0 });
    }
    addToast(`${mismatched.length} toma(s) rellenadas a ${project.width}×${project.height}`, "success");
  };

  /** V4.1: gizmo gesture commit — ONE undo entry per gesture (auto-key or
   *  static hold), at the active take's local time. */
  const commitLayerTransform = useCallback((frameId: string, layerId: string, parts: TransformParts) => {
    const incIdx = included.findIndex(f => f.id === frameId);
    const frame = included[incIdx];
    if (!frame) return;
    const base = schemaOf(frame);
    const s = sampleReelAt(tl, tRef.current);
    const localT = s.kind === "take" && s.takeIndex === incIdx ? s.localT : 0.001;
    const takeDur = tl.takes[incIdx]?.durationSec ?? base.timeline.durationSec;
    const value = composeTransform(parts);
    const next = autoKeyRef.current
      ? setKeyframeAt(base, layerId, "transform", localT, value, takeDur).schema
      : setStaticValue(base, layerId, "transform", value, takeDur).schema;
    if (next) onAnimationFrameChange(frameId, next);
  }, [included, tl, onAnimationFrameChange]);
  commitTransformRef.current = commitLayerTransform;

  /** V4.1: one Object-editor edit (see LayerEdit in VideoInspector). */
  const handleLayerEdit = (frameId: string, layerId: string, edit: LayerEdit) => {
    const incIdx = included.findIndex(f => f.id === frameId);
    const frame = included[incIdx];
    if (!frame) return;
    const base = schemaOf(frame);
    const takeDur = tl.takes[incIdx]?.durationSec ?? base.timeline.durationSec;
    const s = sampleReelAt(tl, tRef.current);
    const localT = s.kind === "take" && s.takeIndex === incIdx ? s.localT : 0.001;
    let next: AnimationSchema | null = null;
    switch (edit.kind) {
      case "transform":
        next = edit.animated
          ? setKeyframeAt(base, layerId, "transform", localT, composeTransform(edit.parts), takeDur).schema
          : setStaticValue(base, layerId, "transform", composeTransform(edit.parts), takeDur).schema;
        break;
      case "opacity":
        next = edit.animated
          ? setKeyframeAt(base, layerId, "opacity", localT, String(edit.value), takeDur).schema
          : setStaticValue(base, layerId, "opacity", String(edit.value), takeDur).schema;
        break;
      case "origin":
        next = setClipOrigin(base, layerId, edit.origin ?? undefined).schema;
        break;
      case "easing":
        next = setTweenEasing(base, layerId, "transform", edit.easing).schema;
        break;
      case "toggleKf":
        next = toggleKeyframeAt(base, layerId, edit.prop, localT, edit.sampled, takeDur).schema;
        break;
      case "clear":
        next = clearLayerClip(base, layerId).schema;
        break;
    }
    if (next) onAnimationFrameChange(frameId, next);
  };

  /** V4.1: keyframes of the selected layer clip in GLOBAL seconds. */
  const selLayerKfs = useMemo(() => {
    if (!selection || selection.kind !== "layer") return null;
    const incIdx = included.findIndex(f => f.id === selection.frameId);
    const frame = included[incIdx];
    if (!frame) return null;
    const schema = frame.animation ? normalizeAnimation(frame.animation) : null;
    const clip = schema?.clips.find(c => c.layerId === selection.layerId);
    if (!clip) return null;
    const takeStart = takeStartSec(tl, incIdx);
    const gStart = takeStart + clip.startSec;
    const gEnd = takeStart + clip.endSec;
    const kfs: Array<{ prop: string; index: number; tGlobal: number }> = [];
    for (const tw of clip.tweens) {
      tw.keyframes.forEach((k, i) => kfs.push({ prop: String(tw.prop), index: i, tGlobal: gStart + k.t * (clip.endSec - clip.startSec) }));
    }
    return { frameId: frame.id, layerId: clip.layerId, gStart, gEnd, kfs };
  }, [selection, included, tl]);

  const handleKfMove = (prop: string, index: number, tGlobal: number) => {
    if (!selLayerKfs || !selection || selection.kind !== "layer") return;
    const frame = included.find(f => f.id === selLayerKfs.frameId);
    const schema = frame?.animation ? normalizeAnimation(frame.animation) : null;
    if (!frame || !schema) return;
    const next = moveKeyframe(schema, selection.layerId, prop, index, tGlobal - selLayerKfs.gStart).schema;
    if (next) onAnimationFrameChange(frame.id, next);
  };

  const handleKfDelete = (prop: string, index: number) => {
    if (!selLayerKfs || !selection || selection.kind !== "layer") return;
    const frame = included.find(f => f.id === selLayerKfs.frameId);
    const schema = frame?.animation ? normalizeAnimation(frame.animation) : null;
    if (!frame || !schema) return;
    const next = deleteKeyframe(schema, selection.layerId, prop, index).schema;
    if (next) onAnimationFrameChange(frame.id, next);
  };

  /** V4.2: panel clip dropped on its lane — snap-assisted re-place. */
  const handleDropClip = (kind: "media" | "text" | "audio", clipId: string, startSec: number) => {
    if (kind === "media") handleMediaChange(clipId, { startSec });
    else if (kind === "text") handleTextChange(clipId, { startSec });
    else handleAudioChange(clipId, { startSec });
  };

  /** V4.1: stage click = pick the layer under the cursor (paused only). */
  const onStageClick = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest("[data-layer-id]");
    const active = activeTakeRef.current;
    if (target && active) {
      setSelection({ kind: "layer", frameId: active.frameId, layerId: target.getAttribute("data-layer-id") || "" });
    } else {
      setSelection(null);
    }
  };

  // ── V3.8 beat detection ──
  const [markers, setMarkers] = useState<number[]>([]);
  // V5: applyLayers reads beats through the ref — its deps stay stable.
  const beatsRef = useRef<number[]>([]);
  beatsRef.current = markers;
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
    // RF-035 0.3: codec compatibility verified BEFORE the user commits to a
    // render — re-probed when format or output dimensions change.
    const [exportSupport, setExportSupport] = useState<ExportSupport | null>(null);
    useEffect(() => {
      let alive = true;
      void probeExportSupport(exportFormat, project.width, project.height, tl.fps).then(s => { if (alive) setExportSupport(s); });
      return () => { alive = false; };
    }, [exportFormat, project.width, project.height, tl.fps]);
  const lastExportRef = useRef<{ blob: Blob; filename: string } | null>(null);
  const audioDataCache = useRef<Map<string, ArrayBuffer>>(new Map());

  const mismatchCount = mismatched.length;

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

  // RF-035 D: quota is now REAL — uploads are blocked before Supabase fails
  // opaquely with a full bucket. Returns the human reason or null.
  const quotaBlocked = (upcomingBytes: number): string | null => {
    if (!quota) return null;
    if (quota.bytes + upcomingBytes > REEL_STORAGE_SOFT_LIMIT_BYTES) {
      return `Espacio de medios lleno: ${(quota.bytes / 1e9).toFixed(2)} GB de ${(REEL_STORAGE_SOFT_LIMIT_BYTES / 1e9).toFixed(0)} GB en este workspace. Libera espacio antes de subir ${(upcomingBytes / 1e6).toFixed(1)} MB más.`;
    }
    return null;
  };

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
          layout: f.reelLayout ?? null,
        })),
        project: { width: project.width, height: project.height, bg: project.bg },
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
      // RF-035 D: block BEFORE the upload when the workspace bucket is full.
      const blocked = quotaBlocked(current.blob.size);
      if (blocked) { addToast(blocked, "error"); return; }
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
    if (!selection) return <span style={muted}>Sin selección — click en un clip del timeline o en la toma del player</span>;
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
          biblioteca={
            /* V5 Fase 3: unified effects library — applies to the current
             * selection via the same handlers the inspector uses. */
            <FxLibraryPanel
              selection={selection}
              included={included}
              doc={doc}
              tl={tl}
              tSec={tSec}
              onTransitionApply={(fromId, toId, pick) => {
                const from = frames.find(f => f.id === fromId);
                if (from) setTransition(from, toId, { ...pick, type: pick.type as TransitionType });
              }}
              onTransitionRemove={(fromId, toId) => {
                const from = frames.find(f => f.id === fromId);
                if (from) setTransition(from, toId, null);
              }}
              onLookApply={onFrameReelFilterChange}
              onLayerEffectApply={applyLayerEffect}
              onTextAnimApply={(clipId, anim) => handleTextChange(clipId, { anim })}
              addToast={addToast}
            />
          }
        />

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {/* Mode bar — RF-01: persistent project header. Answers without
              any interaction: what am I editing, is it saved, what format,
              and how do I leave. */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)", background: "rgba(10,10,10,0.5)" }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, color: "#c8b898", whiteSpace: "nowrap" }}>MODO VIDEO</span>
            <span title={templateName} style={{ fontSize: 13, fontWeight: 600, color: "#f0ebe0", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{templateName || "Reel sin título"}</span>
            {/* A-09: ancho reservado — "Guardando…" y "Guardado" miden distinto
                y hacían saltar el contador de tomas/duración. */}
            <span aria-live="polite" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: saveState === "saving" ? "#e8b64c" : "#7dd88f", whiteSpace: "nowrap", minWidth: 78 }}>
              <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: saveState === "saving" ? "#e8b64c" : "#7dd88f" }} />
              {saveState === "saving" ? "Guardando…" : "Guardado"}
            </span>
            <span style={muted}>{included.length} toma{included.length === 1 ? "" : "s"} · {fmt(tl.totalDurationSec)} · {tl.fps} fps · {project.width}×{project.height}</span>
            <select
              value={project.preset}
              title="Formato del lienzo de salida"
              aria-label="Formato del lienzo de salida"
              onChange={e => {
                const id = e.target.value as ReelProjectSettings["preset"];
                if (id === "custom") return;
                const p = REEL_FORMAT_PRESETS.find(x => x.id === id);
                if (p) handleProjectChange({ preset: p.id, width: p.width, height: p.height, bg: project.bg });
              }}
              style={{ fontSize: 11, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ebe0", borderRadius: 4, padding: "4px 8px", fontFamily: "inherit" }}
            >
              {REEL_FORMAT_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              <option value="custom">Custom · {project.width}×{project.height}</option>
            </select>
            {/* RF-08: undo/redo del journal — siempre visibles en el modo. */}
            <button
              type="button"
              onClick={() => { if (!videoDocStore.undo()) onVideoUndoFallback?.(); }}
              disabled={!videoDocStore.canUndo && !onVideoUndoFallback}
              title={videoDocStore.canUndo ? `Deshacer: ${videoDocStore.undoLabel ?? ""}` : "Deshacer"}
              aria-label="Deshacer"
              style={{ ...smallBtn, padding: "5px 10px", opacity: videoDocStore.canUndo || onVideoUndoFallback ? 1 : 0.35 }}
            >↩</button>
            <button
              type="button"
              onClick={() => { if (!videoDocStore.redo()) onVideoRedoFallback?.(); }}
              disabled={!videoDocStore.canRedo && !onVideoRedoFallback}
              title={videoDocStore.canRedo ? `Rehacer: ${videoDocStore.redoLabel ?? ""}` : "Rehacer"}
              aria-label="Rehacer"
              style={{ ...smallBtn, padding: "5px 10px", opacity: videoDocStore.canRedo || onVideoRedoFallback ? 1 : 0.35 }}
            >↪</button>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={onClose}
              aria-label="Volver al editor de diseño"
              style={{ ...smallBtn, padding: "7px 16px", fontSize: 12, fontWeight: 600, background: "rgba(200,184,152,0.15)", border: "1px solid rgba(200,184,152,0.45)", color: "#e8ddc8" }}
            >← Volver al diseño</button>
          </div>

          {/* Stage + V3 overlay layers + floating context chip */}
          <div ref={stageAreaRef} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minWidth: 0, position: "relative" }}>
            {fit > 0 && (
              <div
                ref={stageBoxRef}
                data-video-stage
                onClick={onStageClick}
                style={{ position: "relative", width: dispW, height: dispH, overflow: "hidden", background: project.bg, borderRadius: 4, boxShadow: "0 8px 40px rgba(0,0,0,0.6)" }}
              >
                <div
                  ref={scalerRef}
                  style={{ position: "absolute", top: 0, left: 0, width: project.width, height: project.height, transform: `scale(${fit})`, transformOrigin: "top left", pointerEvents: "none" }}
                >
                  {/* V5: transition cover tiles + take overlay FX (project px,
                    zIndex 1 = above the plates' default stacking, below an
                    outgoing plate lifted to zIndex 2 by tile dissolves) */}
                  <div ref={fxLayerRef} style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1 }} />
                </div>
                {/* V4.2: flash transition overlay */}
                <div ref={flashRef} style={{ position: "absolute", inset: 0, background: "#ffffff", opacity: 0, pointerEvents: "none" }} />
                {/* V5: SVG filter defs — pixelize (#vpix) + rgb split (#vecho) */}
                <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
                  <defs>
                    {[6, 14, 26, 44].map((cell, i) => (
                      <filter key={cell} id={`vpix-${i}`} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
                        <feFlood x={String(cell / 2 - 1)} y={String(cell / 2 - 1)} width="2" height="2" />
                        <feComposite width={String(cell)} height={String(cell)} />
                        <feTile />
                        <feComposite in="SourceGraphic" operator="in" />
                        <feMorphology operator="dilate" radius={String(cell / 2)} />
                      </filter>
                    ))}
                    {[6, 12, 24].map((dx, i) => (
                      <filter key={dx} id={`vecho-${i}`} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
                        <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="r" />
                        <feOffset in="r" dx={String(dx)} dy="0" result="ro" />
                        <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="g" />
                        <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="b" />
                        <feOffset in="b" dx={String(-dx)} dy="0" result="bo" />
                        <feBlend in="ro" in2="g" mode="screen" result="rg" />
                        <feBlend in="rg" in2="bo" mode="screen" />
                      </filter>
                    ))}
                  </defs>
                </svg>
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
            {/* RF-035 0.4: empty reel = guided state, not an empty rectangle.
              Primary action depends on WHY it's empty. */}
            {included.length === 0 && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, zIndex: 15, textAlign: "center", padding: "0 24px" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#f0ebe0" }}>Tu reel está vacío</div>
                <div style={{ ...muted, maxWidth: 380 }}>
                  {frames.length > 0
                    ? "Los frames del diseño se convierten en tomas. Incluye el primero y empieza a montar."
                    : "Este template no tiene frames todavía. Crea el diseño primero y vuelve al modo video."}
                </div>
                {frames.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => { onFrameReelChange(frames[0].id, false); setSelection({ kind: "take", frameId: frames[0].id }); }}
                    style={{ ...smallBtn, padding: "7px 16px", fontSize: 12, fontWeight: 600, background: "rgba(200,184,152,0.15)", border: "1px solid rgba(200,184,152,0.45)", color: "#e8ddc8" }}
                  >Usar el diseño como primera toma</button>
                ) : (
                  <button
                    type="button"
                    onClick={onClose}
                    style={{ ...smallBtn, padding: "7px 16px", fontSize: 12, fontWeight: 600, background: "rgba(200,184,152,0.15)", border: "1px solid rgba(200,184,152,0.45)", color: "#e8ddc8" }}
                  >Ir al editor de diseño</button>
                )}
              </div>
            )}
            {/* V4.0 Fit Advisor banner: takes that letterbox on this canvas. */}
            {mismatchCount > 0 && (
              <div style={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 8, background: "rgba(10,10,10,0.85)", border: "1px solid rgba(200,184,152,0.25)", borderRadius: 10, padding: "4px 10px", zIndex: 20 }}>
                <span style={muted}>⚠ {mismatchCount} toma{mismatchCount === 1 ? "" : "s"} con letterbox en {project.width}×{project.height}</span>
                <button type="button" onClick={coverAllMismatched} style={smallBtn}>Rellenar todas</button>
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
            project={project}
            selection={selection}
            tSec={tSec}
            onSelect={setSelection}
            onTakeDuration={setTakeDuration}
            onAnimationFrameChange={onAnimationFrameChange}
            onTransitionChange={setTransition}
            onFrameReelChange={onFrameReelChange}
            onFrameReelFilterChange={onFrameReelFilterChange}
            onFrameReelFxChange={onFrameReelFxChange}
            onFrameReelOverlayFxChange={onFrameReelOverlayFxChange}
            onFrameLayoutChange={onFrameLayoutChange}
            onProjectChange={handleProjectChange}
            onAudioChange={handleAudioChange}
            onMediaChange={handleMediaChange}
            onTextChange={handleTextChange}
            onApplyLayerEffect={applyLayerEffect}
            onLayerEdit={handleLayerEdit}
            onDetectBeats={clipId => void detectBeatsFor(clipId)}
            beatsBusy={beatsBusy}
            exporting={exporting}
            progress={progress}
            uploading={uploading}
            publishedUrl={publishedUrl}
            onExport={() => void doExport()}
            onUploadPublish={() => void uploadReel()}
            onCopyUrl={() => { if (publishedUrl) { void navigator.clipboard.writeText(publishedUrl); addToast("URL copiada", "success"); } }}
            mismatchCount={mismatchCount}
            quota={quota}
            exportSupport={exportSupport}
            exportFormat={exportFormat}
            onExportFormatChange={setExportFormat}
            onAdaptWithAI={onAdaptWithAI}
            onBakeToDesign={onBakeToDesign}
            autoKey={autoKey}
            onAutoKeyChange={setAutoKey}
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
        onDropClip={handleDropClip}
        layerKfs={selLayerKfs}
        onKfSeek={seek}
        onKfMove={handleKfMove}
        onKfDelete={handleKfDelete}
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
