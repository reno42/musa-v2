/**
 * VideoTimeline — the CapCut-style multi-track timeline (Video Mode v2/v3).
 *
 * ONE continuous timeline:
 *   • V1 (magnetic main track): takes as contiguous clips — drag to reorder
 *     (insertion marker, CapCut-style), right edge = trim (= take duration),
 *     click = select. Transition diamonds sit between clips (click → editor).
 *   • L-rows: one track per animated layer — clips live inside their take's
 *     window; drag to move/trim (commit = clip times on the owning frame's
 *     animation schema).
 *   • M-row (V3.4): video/image clips — free placement, move + edge trims
 *     (right edge capped by the source length minus trim-in).
 *   • T-row (V3.5): caption/sticker clips — free placement, move + trims.
 *   • A-row: music clips — free placement, edge trim, loop on export.
 *   • Ruler + zoom + playhead scrub + snapping + beat markers (V3.8) +
 *     keyboard (Space, arrows, Home, S = split, Ctrl+D = duplicate, Del).
 *
 * Pure view: every commit goes through callbacks owned by the mode root.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  normalizeAnimation,
  type AnimationSchema,
  type TransitionType,
} from "../../../shared/animationSchema.ts";
import { projectTimelineTracks, type ReelTimeline } from "../../lib/sequencePlayback";
import { transitionDef, type TransitionParams } from "../../../shared/videoEffectsCatalog.ts";
import { lanePropLabel, type TimelineLane } from "../../../shared/timelineLanes.ts";
import { TransitionLibrary } from "./TransitionLibrary";
import type { ReelAudioClip, ReelMediaClip, ReelTextClip, VideoTimelineDoc } from "../../lib/videoTimelineDoc";
import type { FrameData } from "../DesignFrame";

export type TimelineSelection =
  | { kind: "take"; frameId: string }
  | { kind: "layer"; frameId: string; layerId: string }
  | { kind: "audio"; clipId: string }
  | { kind: "media"; clipId: string }
  | { kind: "text"; clipId: string };

export interface VideoTimelineProps {
  frames: FrameData[];
  included: FrameData[];
  tl: ReelTimeline;
  doc: VideoTimelineDoc;
  tSec: number;
  playing: boolean;
  thumbs: Record<string, string>;
  selection: TimelineSelection | null;
  /** V3.8: detected beat markers (snapping helpers + ruler notches). */
  markers: number[];
  onSeek: (t: number) => void;
  onTogglePlay: () => void;
  onSelect: (sel: TimelineSelection | null) => void;
  onTakeDuration: (frame: FrameData, d: number) => void;
  onAnimationFrameChange: (frameId: string, next: AnimationSchema | null) => void;
  onFramesReorder: (orderedIds: string[]) => void;
  onTransitionChange: (fromFrame: FrameData, toFrameId: string, next: { type: TransitionType; durationSec: number; params?: TransitionParams } | null) => void;
  onAudioChange: (clipId: string, patch: Partial<ReelAudioClip> | null) => void;
  onMediaChange: (clipId: string, patch: Partial<ReelMediaClip> | null) => void;
  onTextChange: (clipId: string, patch: Partial<ReelTextClip> | null) => void;
  /** V3.3 ops — the mode root decides what the playhead/selection mean. */
  onSplitAtPlayhead: () => void;
  onDuplicateSelection: () => void;
  onDeleteSelection: () => void;
  /** Media-panel drop: (re)insert a frame at an included index. */
  onDropFrame?: (frameId: string, insertIncIdx: number) => void;
  /** V4.2: panel clip dropped on its lane — snap the new startSec. */
  onDropClip?: (kind: "media" | "text" | "audio", clipId: string, startSec: number) => void;
  /** REQ034 P1.3: per-property lanes of the selected layer — ONE lane per
   *  clip·tween (bounce + llegada + fade = three lanes, own easing each),
   *  keyframe times already projected to global seconds. */
  layerLanes?: {
    frameId: string;
    layerId: string;
    lanes: Array<TimelineLane & { gStart: number; gEnd: number; kfs: Array<TimelineLane["keyframes"][number] & { tGlobal: number }> }>;
  } | null;
  onKfSeek?: (t: number) => void;
  onKfMove?: (clipIndex: number, prop: string, index: number, tGlobal: number) => void;
  onKfDelete?: (clipIndex: number, prop: string, index: number) => void;
}

// ── Local idiom (matches the v1 overlay's glass styling) ──
const smallBtn: React.CSSProperties = {
  fontSize: 10, padding: "2px 8px", borderRadius: 3,
  border: "1px solid rgba(200,184,152,0.15)", background: "rgba(200,184,152,0.05)",
  color: "#c8b898", cursor: "pointer", fontFamily: "inherit",
};
const muted: React.CSSProperties = { fontSize: 10, lineHeight: 1.4, color: "#7a7668" };

const LABEL_W = 116;
const ROW_H = 46;
const LAYER_H = 24;
const CLIP_H = 32;
const RULER_H = 20;

// V5: the transition vocabulary lives in the shared catalog (via TransitionLibrary).

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const fmt = (t: number) => `${t.toFixed(2)}s`;
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

type DragState =
  | { mode: "scrub" }
  | { mode: "takeMove"; incIdx: number; startX: number; moved: boolean }
  | { mode: "takeTrim"; incIdx: number; startX: number; startDur: number }
  | { mode: "layer"; kind: "move" | "l" | "r"; frameId: string; layerId: string; startX: number; gStart: number; gEnd: number; takeStart: number; takeDur: number }
  | { mode: "audio"; kind: "move" | "l" | "r"; clipId: string; startX: number; start: number; dur: number }
  | { mode: "media"; kind: "move" | "l" | "r"; clipId: string; startX: number; start: number; dur: number; maxDur: number }
  | { mode: "text"; kind: "move" | "l" | "r"; clipId: string; startX: number; start: number; dur: number }
  | { mode: "kf"; clipIndex: number; prop: string; index: number; startX: number; gStart: number; gEnd: number };

export function VideoTimeline({
  frames, included, tl, doc, tSec, playing, thumbs, selection, markers,
  onSeek, onTogglePlay, onSelect, onTakeDuration, onAnimationFrameChange, onFramesReorder,
  onTransitionChange, onAudioChange, onMediaChange, onTextChange,
  onSplitAtPlayhead, onDuplicateSelection, onDeleteSelection, onDropFrame, onDropClip,
  layerLanes, onKfSeek, onKfMove, onKfDelete,
}: VideoTimelineProps) {
  const projected = useMemo(() => projectTimelineTracks(tl, included), [tl, included]);
  const frameById = useMemo(() => new Map(frames.map(f => [f.id, f] as const)), [frames]);

  const [pps, setPps] = useState(64); // px per second (zoom)
  const laneW = Math.max(120, tl.totalDurationSec * pps);

  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);

  const dragRef = useRef<DragState | null>(null);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [dropInc, setDropInc] = useState<number | null>(null);
  const suppressClickRef = useRef(false);

  const [trEdit, setTrEdit] = useState<number | null>(null); // take index whose outgoing transition is being edited

  const total = tl.totalDurationSec;

  const xToSec = useCallback((clientX: number): number => {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return (clientX - rect.left) / pps;
  }, [pps]);

  const snapPoints = useMemo(() => {
    const pts: number[] = [0, total];
    for (const s of tl.segments) pts.push(s.startSec, s.endSec);
    for (const s of tl.slots) pts.push(s.startSec, s.endSec);
    for (const c of doc.mediaClips) pts.push(c.startSec, c.startSec + c.durationSec);
    for (const c of doc.textClips) pts.push(c.startSec, c.startSec + c.durationSec);
    for (const m of markers) pts.push(m);
    return pts;
  }, [tl, total, doc.mediaClips, doc.textClips, markers]);

  const snap = useCallback((t: number, skip?: (p: number) => boolean): number => {
    const thr = 8 / pps;
    let best = t;
    let bestD = thr;
    for (const p of snapPoints) {
      if (skip && Math.abs(p - t) < 1e-6) { if (skip(p)) continue; }
      else if (skip && skip(p)) continue;
      const d = Math.abs(p - t);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }, [pps, snapPoints]);

  /** Reorder within the INCLUDED sequence, stitching excluded frames back at
   *  their relative positions (the file order stays complete). */
  const reorderIncluded = useCallback((fromInc: number, toInc: number) => {
    if (fromInc === toInc) return;
    const incIds = included.map(f => f.id);
    const [moved] = incIds.splice(fromInc, 1);
    incIds.splice(toInc, 0, moved);
    const out: string[] = [];
    let k = 0;
    for (const f of frames) {
      if (f.reelExcluded) out.push(f.id);
      else out.push(incIds[k++] ?? f.id);
    }
    onFramesReorder(out);
  }, [included, frames, onFramesReorder]);

  const commitLayerClip = useCallback((frameId: string, layerId: string, patch: { startSec?: number; endSec?: number }) => {
    const frame = frameById.get(frameId);
    const schema = frame?.animation ? normalizeAnimation(frame.animation) : null;
    if (!schema) return;
    const nextClips = schema.clips.map(c => (c.layerId === layerId ? { ...c, ...patch } : c));
    const next = normalizeAnimation({ ...schema, clips: nextClips });
    if (next) onAnimationFrameChange(frameId, next);
  }, [frameById, onAnimationFrameChange]);

  // ── Global pointer handlers (one set for every drag mode) ──
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      suppressClickRef.current = true;
      if (d.mode === "scrub") {
        onSeek(clamp(xToSec(e.clientX), 0, Math.max(0, total - 0.001)));
      } else if (d.mode === "takeMove") {
        const x = xToSec(e.clientX);
        let idx = 0;
        for (const seg of tl.segments) {
          const center = seg.startSec + (seg.endSec - seg.startSec) / 2;
          if (x > center) idx++;
        }
        setInsertAt(clamp(idx, 0, included.length));
      } else if (d.mode === "takeTrim") {
        const dt = (e.clientX - d.startX) / pps;
        const frame = included[d.incIdx];
        if (frame) onTakeDuration(frame, clamp(d.startDur + dt, 0.3, 600));
      } else if (d.mode === "layer") {
        const dx = (e.clientX - d.startX) / pps;
        const len = d.gEnd - d.gStart;
        if (d.kind === "move") {
          let ns = snap(d.gStart + dx, p => Math.abs(p - d.gStart) < 1e-6 || Math.abs(p - d.gEnd) < 1e-6);
          ns = clamp(ns, d.takeStart, d.takeStart + Math.max(0, d.takeDur - len));
          commitLayerClip(d.frameId, d.layerId, { startSec: ns - d.takeStart, endSec: ns - d.takeStart + len });
        } else if (d.kind === "l") {
          let ns = snap(d.gStart + dx, p => Math.abs(p - d.gStart) < 1e-6);
          ns = clamp(ns, d.takeStart, d.gEnd - 0.05);
          commitLayerClip(d.frameId, d.layerId, { startSec: ns - d.takeStart });
        } else {
          let ne = snap(d.gEnd + dx, p => Math.abs(p - d.gEnd) < 1e-6);
          ne = clamp(ne, d.gStart + 0.05, d.takeStart + d.takeDur);
          commitLayerClip(d.frameId, d.layerId, { endSec: ne - d.takeStart });
        }
      } else if (d.mode === "audio") {
        const dx = (e.clientX - d.startX) / pps;
        if (d.kind === "move") {
          const ns = Math.max(0, snap(d.start + dx, p => Math.abs(p - d.start) < 1e-6));
          onAudioChange(d.clipId, { startSec: ns });
        } else if (d.kind === "l") {
          const ns = clamp(snap(d.start + dx, p => Math.abs(p - d.start) < 1e-6), Math.max(0, d.start - d.dur + 0.2), d.start + d.dur - 0.2);
          onAudioChange(d.clipId, { startSec: ns, durationSec: d.start + d.dur - ns });
        } else {
          const nd = clamp(snap(d.start + d.dur + dx, p => Math.abs(p - d.start + d.dur) < 1e-6) - d.start, 0.2, 3600);
          onAudioChange(d.clipId, { durationSec: nd });
        }
      } else if (d.mode === "media") {
        const dx = (e.clientX - d.startX) / pps;
        if (d.kind === "move") {
          const ns = Math.max(0, snap(d.start + dx, p => Math.abs(p - d.start) < 1e-6));
          onMediaChange(d.clipId, { startSec: ns });
        } else if (d.kind === "l") {
          const ns = clamp(snap(d.start + dx, p => Math.abs(p - d.start) < 1e-6), Math.max(0, d.start - d.dur + 0.2), d.start + d.dur - 0.2);
          onMediaChange(d.clipId, { startSec: ns, durationSec: d.start + d.dur - ns });
        } else {
          const nd = clamp(snap(d.start + d.dur + dx, p => Math.abs(p - (d.start + d.dur)) < 1e-6) - d.start, 0.2, Math.max(0.2, d.maxDur));
          onMediaChange(d.clipId, { durationSec: nd });
        }
      } else if (d.mode === "text") {
        const dx = (e.clientX - d.startX) / pps;
        if (d.kind === "move") {
          const ns = Math.max(0, snap(d.start + dx, p => Math.abs(p - d.start) < 1e-6));
          onTextChange(d.clipId, { startSec: ns });
        } else if (d.kind === "l") {
          const ns = clamp(snap(d.start + dx, p => Math.abs(p - d.start) < 1e-6), Math.max(0, d.start - d.dur + 0.2), d.start + d.dur - 0.2);
          onTextChange(d.clipId, { startSec: ns, durationSec: d.start + d.dur - ns });
        } else {
          const nd = clamp(snap(d.start + d.dur + dx, p => Math.abs(p - (d.start + d.dur)) < 1e-6) - d.start, 0.2, 3600);
          onTextChange(d.clipId, { durationSec: nd });
        }
      } else if (d.mode === "kf") {
        // V4.1: dragging a keyframe diamond — stays inside its lane's window.
        const t = xToSec(e.clientX);
        if (onKfMove) onKfMove(d.clipIndex, d.prop, d.index, clamp(t, d.gStart, d.gEnd));
      }
    };
    const up = () => {
      const d = dragRef.current;
      if (d?.mode === "takeMove" && insertAt !== null && insertAt !== d.incIdx) {
        const target = insertAt > d.incIdx ? insertAt - 1 : insertAt;
        reorderIncluded(d.incIdx, target);
      }
      dragRef.current = null;
      setInsertAt(null);
      setTimeout(() => { suppressClickRef.current = false; }, 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [xToSec, pps, tl, included, insertAt, total, onSeek, onTakeDuration, commitLayerClip, onAudioChange, onMediaChange, onTextChange, reorderIncluded, snap, onKfMove]);

  const startScrub = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).dataset?.handle) return;
    dragRef.current = { mode: "scrub" };
    onSeek(clamp(xToSec(e.clientX), 0, Math.max(0, total - 0.001)));
  };

  // Keep the playhead visible while playing (CapCut auto-follow).
  useEffect(() => {
    if (!playing) return;
    const el = scrollRef.current;
    if (!el) return;
    const x = tSec * pps;
    const view = el.clientWidth - LABEL_W;
    if (x < el.scrollLeft || x > el.scrollLeft + view - 40) {
      el.scrollLeft = Math.max(0, x - view / 2);
    }
  }, [tSec, playing, pps]);

  // ── Keyboard (Space / arrows / Home / S / Ctrl+D / Del) ──
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === " ") { e.preventDefault(); e.stopPropagation(); onTogglePlay(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); onSeek(tSec - (e.shiftKey ? 1 : 1 / tl.fps)); }
    else if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); onSeek(tSec + (e.shiftKey ? 1 : 1 / tl.fps)); }
    else if (e.key === "Home") { e.preventDefault(); e.stopPropagation(); onSeek(0); }
    else if ((e.key === "s" || e.key === "S") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); e.stopPropagation(); onSplitAtPlayhead();
    }
    else if ((e.key === "d" || e.key === "D") && (e.ctrlKey || e.metaKey)) {
      e.preventDefault(); e.stopPropagation(); onDuplicateSelection();
    }
    else if ((e.key === "Delete" || e.key === "Backspace") && (selection?.kind === "audio" || selection?.kind === "media" || selection?.kind === "text")) {
      e.preventDefault(); e.stopPropagation();
      onDeleteSelection();
    }
  };

  const tickStep = pps > 160 ? 0.25 : pps > 80 ? 0.5 : pps > 40 ? 1 : 2;
  const ticks: number[] = useMemo(() => {
    const out: number[] = [];
    for (let t = 0; t <= total + 1e-6; t += tickStep) out.push(Math.round(t * 100) / 100);
    return out;
  }, [total, tickStep]);

  const labelCell: React.CSSProperties = {
    flex: `0 0 ${LABEL_W}px`, position: "sticky", left: 0, zIndex: 6,
    padding: "0 8px", display: "flex", alignItems: "center",
    fontSize: 11, letterSpacing: 0.3, color: "#a8a498",
    background: "#101010", borderRight: "1px solid rgba(255,255,255,0.06)",
    overflow: "hidden", whiteSpace: "nowrap",
  };

  const selBorder = (on: boolean) => `1px solid ${on ? "rgba(224,181,122,0.9)" : "rgba(200,184,152,0.4)"}`;

  /** Generic free-clip body — shared look for audio/media/text lanes. */
  const freeClip = (
    icon: string, label: string, title: string,
    sel: boolean, tint: string,
    startDown: (e: React.PointerEvent) => void,
    lDown: (e: React.PointerEvent) => void,
    rDown: (e: React.PointerEvent) => void,
    w: number,
  ) => (
    <div style={{ position: "absolute", top: 4, width: w, height: CLIP_H - 9 }}>
      <div
        onPointerDown={startDown}
        title={title}
        style={{
          position: "absolute", inset: 0, borderRadius: 3, cursor: "grab", overflow: "hidden",
          background: sel ? "rgba(224,181,122,0.4)" : tint,
          border: selBorder(sel),
        }}
      >
        <span style={{ position: "absolute", left: 4, top: 1, fontSize: 8, color: "#f0dfc0", fontFamily: "monospace", whiteSpace: "nowrap", pointerEvents: "none" }}>
          {icon} {label}
        </span>
      </div>
      <div data-handle="1" onPointerDown={lDown} style={{ position: "absolute", left: -2, top: 0, width: 6, height: "100%", cursor: "ew-resize" }} />
      <div data-handle="1" onPointerDown={rDown} style={{ position: "absolute", right: -2, top: 0, width: 6, height: "100%", cursor: "ew-resize" }} />
    </div>
  );

  return (
    <div
      data-vm-timeline
      tabIndex={0}
      onKeyDown={onKeyDown}
      style={{ borderTop: "1px solid rgba(255,255,255,0.07)", background: "#0c0c0c", outline: "none", flexShrink: 0 }}
    >
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <button type="button" onClick={onTogglePlay} style={{ ...smallBtn, padding: "3px 12px", fontSize: 11 }} title="Space">
          {playing ? "❚❚" : "▶"}
        </button>
        <button type="button" onClick={() => onSeek(0)} style={smallBtn} title="Al inicio (Home)">⏮</button>
        <button type="button" onClick={onSplitAtPlayhead} style={smallBtn} title="Dividir clip seleccionado en el playhead (S)">✂ Split</button>
        <button type="button" onClick={onDuplicateSelection} style={smallBtn} title="Duplicar clip seleccionado (Ctrl+D)">⧉ Dup</button>
        <button type="button" onClick={onDeleteSelection} style={smallBtn} title="Borrar clip seleccionado (Del)">🗑</button>
        <span style={{ fontSize: 10, fontFamily: "monospace", color: "#c8b898" }}>{fmt(tSec)} / {fmt(total)}</span>
        <div style={{ flex: 1 }} />
        <span style={muted}>{included.length} toma{included.length === 1 ? "" : "s"} · {tl.fps} fps</span>
        <span style={muted}>zoom</span>
        <input type="range" min={16} max={320} step={8} value={pps} onChange={e => setPps(parseInt(e.target.value, 10) || 64)} style={{ width: 90, accentColor: "#c8b898" }} />
      </div>

      {/* Scrollable tracks */}
      <div ref={scrollRef} style={{ overflowX: "auto", overflowY: "auto", maxHeight: 268, position: "relative" }}>
        <div style={{ width: LABEL_W + laneW }}>
          {/* Ruler */}
          <div style={{ display: "flex", height: RULER_H }}>
            <div style={labelCell} />
            <div
              ref={rulerRef}
              data-video-ruler
              onPointerDown={startScrub}
              style={{ position: "relative", width: laneW, background: "rgba(255,255,255,0.02)", cursor: "text", userSelect: "none" }}
            >
              {ticks.map(t => (
                <div key={t} style={{ position: "absolute", left: t * pps, top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.06)", pointerEvents: "none" }}>
                  <span style={{ position: "absolute", top: 1, left: 2, fontSize: 8, color: "#5a5648", fontFamily: "monospace" }}>
                    {Number.isInteger(t) ? `${t}s` : ""}
                  </span>
                </div>
              ))}
              {/* V3.8: beat markers */}
              {markers.map((m, i) => (
                <div key={`mk-${i}`} style={{ position: "absolute", left: m * pps - 1, bottom: 0, width: 2, height: 7, background: "#e0b57a", opacity: 0.85, pointerEvents: "none", zIndex: 5 }} />
              ))}
              {/* Playhead handle */}
              <div style={{ position: "absolute", left: tSec * pps - 5, top: 0, width: 10, height: 10, background: "#e0b57a", clipPath: "polygon(0 0, 100% 0, 50% 100%)", pointerEvents: "none", zIndex: 8 }} />
            </div>
          </div>

          {/* Lanes */}
          <div style={{ position: "relative" }}>
            {/* V1 — magnetic take track */}
            <div style={{ display: "flex", height: ROW_H, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={labelCell} title="Tomas del reel — una fila magnética, se reordenan arrastrando">Tomas · V1</div>
              <div
                style={{ position: "relative", width: laneW, background: "rgba(255,255,255,0.02)" }}
                onDragOver={e => {
                  if (onDropFrame) {
                    e.preventDefault();
                    const x = xToSec(e.clientX);
                    let idx = 0;
                    for (const seg of tl.segments) if (x > seg.startSec + (seg.endSec - seg.startSec) / 2) idx++;
                    setDropInc(clamp(idx, 0, included.length));
                  }
                }}
                onDragLeave={() => setDropInc(null)}
                onDrop={e => {
                  e.preventDefault();
                  const frameId = e.dataTransfer.getData("text/frame-id");
                  setDropInc(null);
                  if (frameId && onDropFrame) onDropFrame(frameId, dropInc ?? included.length);
                }}
              >
                {projected.vClips.map((vc, i) => {
                  const f = frameById.get(vc.frameId);
                  const sel = selection?.kind === "take" && selection.frameId === vc.frameId;
                  return (
                    <div
                      key={vc.frameId}
                      onPointerDown={e => {
                        e.stopPropagation();
                        onSelect({ kind: "take", frameId: vc.frameId });
                        dragRef.current = { mode: "takeMove", incIdx: i, startX: e.clientX, moved: false };
                      }}
                      onClick={() => { if (!suppressClickRef.current) onSelect({ kind: "take", frameId: vc.frameId }); }}
                      title={`${f?.name || vc.frameId} · ${fmt(vc.durSec)} — arrastra para reordenar`}
                      style={{
                        position: "absolute", left: vc.startSec * pps + 1, top: 4,
                        width: Math.max(14, vc.durSec * pps - 2), height: ROW_H - 10,
                        borderRadius: 4, overflow: "hidden", cursor: "grab", userSelect: "none",
                        border: selBorder(sel),
                        background: "rgba(200,184,152,0.08)",
                        boxShadow: sel ? "0 0 0 1px rgba(224,181,122,0.35)" : undefined,
                      }}
                    >
                      {thumbs[vc.frameId] && (
                        <img src={thumbs[vc.frameId]} alt="" draggable={false}
                          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.4, pointerEvents: "none" }} />
                      )}
                      <span style={{ position: "absolute", left: 4, top: 2, right: 4, fontSize: 9, color: "#e8dcc0", fontFamily: "monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textShadow: "0 1px 2px rgba(0,0,0,0.9)", pointerEvents: "none" }}>
                        {i + 1}. {f?.name || vc.frameId}
                      </span>
                      <span style={{ position: "absolute", left: 4, bottom: 2, fontSize: 8, color: "#bdb49a", fontFamily: "monospace", textShadow: "0 1px 2px rgba(0,0,0,0.9)", pointerEvents: "none" }}>
                        {fmt(vc.durSec)}
                      </span>
                      {/* Trim handle (right edge — the magnetic track grows left-to-right) */}
                      <div
                        data-handle="1"
                        onPointerDown={e => {
                          e.stopPropagation();
                          onSelect({ kind: "take", frameId: vc.frameId });
                          dragRef.current = { mode: "takeTrim", incIdx: i, startX: e.clientX, startDur: vc.durSec };
                        }}
                        title="Recortar duración de la toma"
                        style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 7, cursor: "ew-resize", background: "linear-gradient(to left, rgba(224,181,122,0.35), transparent)" }}
                      />
                    </div>
                  );
                })}

                {/* Transition diamonds between takes */}
                {projected.vClips.slice(0, -1).map(vc => {
                  const boundary = (vc.startSec + vc.durSec) * pps;
                  const tr = tl.takes[vc.takeIndex]?.transitionOut;
                  const fromFrame = frameById.get(vc.frameId);
                  const nextInc = included[vc.takeIndex + 1];
                  if (!fromFrame || !nextInc) return null;
                  return (
                    <button
                      key={`tr-${vc.frameId}`}
                      type="button"
                      title={tr ? `${transitionDef(tr.type)?.label ?? tr.type} ${tr.durationSec.toFixed(1)}s — click para editar` : "Corte seco — click para añadir transición"}
                      onClick={e => { e.stopPropagation(); setTrEdit(trEdit === vc.takeIndex ? null : vc.takeIndex); }}
                      style={{
                        position: "absolute", left: boundary - 8, top: ROW_H / 2 - 8, width: 16, height: 16,
                        transform: "rotate(45deg)", zIndex: 10, cursor: "pointer",
                        background: tr ? "#c8b898" : "#1c1c1c",
                        border: `1px solid ${tr ? "rgba(232,220,192,0.9)" : "rgba(200,184,152,0.4)"}`,
                        borderRadius: 2, padding: 0, fontSize: 0,
                      }}
                    />
                  );
                })}

                {/* Insertion marker (reorder drag) */}
                {insertAt !== null && (
                  <div style={{ position: "absolute", left: (insertAt < projected.vClips.length ? projected.vClips[insertAt].startSec : total) * pps - 1, top: 0, bottom: 0, width: 2, background: "#e0b57a", zIndex: 15, pointerEvents: "none" }} />
                )}
                {/* Media-panel drop marker */}
                {dropInc !== null && (
                  <div style={{ position: "absolute", left: (dropInc < projected.vClips.length ? projected.vClips[dropInc].startSec : total) * pps - 1, top: 0, bottom: 0, width: 2, background: "#9fd6a0", zIndex: 15, pointerEvents: "none" }} />
                )}
              </div>
            </div>

            {/* Layer tracks — "capas apiladas" */}
            {projected.layerTracks.map(track => (
              <div key={track.layerId} style={{ display: "flex", height: LAYER_H, borderTop: "1px solid rgba(255,255,255,0.035)" }}>
                <div style={{ ...labelCell, fontSize: 8 }} title={track.layerId}>{trunc(track.layerId, 14)}</div>
                <div style={{ position: "relative", width: laneW, background: "rgba(255,255,255,0.012)" }}>
                  {track.clips.map(clip => {
                    const sel = selection?.kind === "layer" && selection.frameId === clip.frameId && selection.layerId === clip.layerId;
                    const left = clip.startSec * pps;
                    const w = Math.max(6, (clip.endSec - clip.startSec) * pps);
                    return (
                      <div key={`${clip.frameId}:${clip.layerId}:${clip.takeIndex}`} style={{ position: "absolute", left, top: 3, width: w, height: LAYER_H - 7 }}>
                        <div
                          onPointerDown={e => {
                            e.stopPropagation();
                            onSelect({ kind: "layer", frameId: clip.frameId, layerId: clip.layerId });
                            const seg = tl.segments[clip.takeIndex];
                            dragRef.current = { mode: "layer", kind: "move", frameId: clip.frameId, layerId: clip.layerId, startX: e.clientX, gStart: clip.startSec, gEnd: clip.endSec, takeStart: seg.startSec, takeDur: tl.takes[clip.takeIndex].durationSec };
                          }}
                          title={`${clip.layerId} @ ${fmt(clip.startSec)} · ${clip.tweenCount} tween(s)`}
                          style={{
                            position: "absolute", inset: 0, borderRadius: 3, cursor: "grab", overflow: "hidden",
                            background: sel ? "rgba(224,181,122,0.35)" : "rgba(159,190,214,0.28)",
                            border: selBorder(sel),
                          }}
                        >
                          <span style={{ position: "absolute", left: 3, top: 1, fontSize: 8, color: "#dfe8f0", fontFamily: "monospace", whiteSpace: "nowrap", pointerEvents: "none" }}>
                            {trunc(clip.layerId, Math.max(6, Math.floor(w / 6)))}
                          </span>
                        </div>
                        <div data-handle="1" onPointerDown={e => {
                          e.stopPropagation();
                          const seg = tl.segments[clip.takeIndex];
                          dragRef.current = { mode: "layer", kind: "l", frameId: clip.frameId, layerId: clip.layerId, startX: e.clientX, gStart: clip.startSec, gEnd: clip.endSec, takeStart: seg.startSec, takeDur: tl.takes[clip.takeIndex].durationSec };
                        }} style={{ position: "absolute", left: -2, top: 0, width: 6, height: "100%", cursor: "ew-resize" }} />
                        <div data-handle="1" onPointerDown={e => {
                          e.stopPropagation();
                          const seg = tl.segments[clip.takeIndex];
                          dragRef.current = { mode: "layer", kind: "r", frameId: clip.frameId, layerId: clip.layerId, startX: e.clientX, gStart: clip.startSec, gEnd: clip.endSec, takeStart: seg.startSec, takeDur: tl.takes[clip.takeIndex].durationSec };
                        }} style={{ position: "absolute", right: -2, top: 0, width: 6, height: "100%", cursor: "ew-resize" }} />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {projected.layerTracks.length === 0 && (
              <div style={{ display: "flex", height: 22, borderTop: "1px solid rgba(255,255,255,0.035)" }}>
                <div style={labelCell} title="Capas animadas por keyframes — una fila por capa">Capas</div>
                <div style={{ ...muted, display: "flex", alignItems: "center", padding: "0 10px" }}>
                  Sin clips de capa — aplica presets de animación y aparecen aquí apiladas por capa.
                </div>
              </div>
            )}

            {/* REQ034 P1.3: keyframe diamonds, one lane row per clip·tween. */}
            {layerLanes && (
              <div style={{ display: "flex", height: 20, borderTop: "1px solid rgba(255,255,255,0.035)" }}>
                <div style={{ ...labelCell, fontSize: 8 }} title={`${layerLanes.layerId} — carriles por clip·propiedad (click = seek · arrastra = mover · doble click = borrar)`}>◆ KF</div>
                <div
                  style={{ position: "relative", width: laneW, background: "rgba(255,255,255,0.02)" }}
                  onPointerDown={e => {
                    if ((e.target as HTMLElement).dataset?.kf) return;
                    if (onKfSeek && layerLanes.lanes.length > 0) {
                      const first = layerLanes.lanes[0];
                      const last = layerLanes.lanes[layerLanes.lanes.length - 1];
                      onKfSeek(clamp(xToSec(e.clientX), first.gStart, last.gEnd));
                    }
                  }}
                >
                  {layerLanes.lanes.map((ln, li) => {
                    const top = 1 + (li % 3) * 5;
                    const color = ln.prop === "transform" ? "#9fbed6" : "#9fd6b2";
                    return (
                      <div key={`${ln.clipIndex}:${ln.prop}`}>
                        <div
                          title={`${lanePropLabel(ln.prop)} · ${ln.easing} — ventana del carril`}
                          style={{ position: "absolute", left: ln.gStart * pps, width: Math.max(2, (ln.gEnd - ln.gStart) * pps), top: top + 6, height: 2, background: color, opacity: 0.22, borderRadius: 1 }}
                        />
                        {ln.kfs.map(k => (
                          <div
                            key={`${k.index}`}
                            data-kf="1"
                            title={`${lanePropLabel(ln.prop)} · ${ln.easing} · #${k.index + 1} @ ${fmt(k.tGlobal)} — arrastra para mover · doble click para borrar`}
                            onPointerDown={e => {
                              e.stopPropagation();
                              if (onKfMove) dragRef.current = { mode: "kf", clipIndex: ln.clipIndex, prop: ln.prop, index: k.index, startX: e.clientX, gStart: ln.gStart, gEnd: ln.gEnd };
                            }}
                            onDoubleClick={e => {
                              e.stopPropagation();
                              if (onKfDelete) onKfDelete(ln.clipIndex, ln.prop, k.index);
                            }}
                            style={{
                              position: "absolute", left: k.tGlobal * pps - 3.5, top, width: 7, height: 7,
                              transform: "rotate(45deg)", background: color,
                              border: "1px solid rgba(0,0,0,0.6)", cursor: "ew-resize", zIndex: 8,
                            }}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Media track (V3.4) */}
            <div style={{ display: "flex", height: CLIP_H, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={labelCell} title="Videos e imágenes superpuestos como clips libres">Media · M</div>
              <div
                style={{ position: "relative", width: laneW, background: "rgba(255,255,255,0.015)" }}
                onDragOver={e => { if (onDropClip) e.preventDefault(); }}
                onDrop={e => {
                  if (!onDropClip) return;
                  e.preventDefault();
                  if (e.dataTransfer.getData("text/clip-kind") !== "media") return;
                  const clipId = e.dataTransfer.getData("text/clip-id");
                  if (clipId) onDropClip("media", clipId, snap(clamp(xToSec(e.clientX), 0, Math.max(0, total - 0.2))));
                }}
              >
                {doc.mediaClips.map(mc => {
                  const sel = selection?.kind === "media" && selection.clipId === mc.id;
                  const maxDur = mc.kind === "video" && mc.sourceDurationSec > 0
                    ? Math.max(0.2, mc.sourceDurationSec - mc.trimInSec)
                    : 3600;
                  const w = Math.max(10, mc.durationSec * pps);
                  return (
                    <div key={mc.id} style={{ position: "absolute", left: mc.startSec * pps, top: 0 }}>
                      {freeClip(
                        mc.kind === "image" ? "🖼" : "🎬",
                        trunc(mc.name, Math.max(8, Math.floor(w / 6.5))),
                        `${mc.name} · ${fmt(mc.startSec)} → ${fmt(mc.startSec + mc.durationSec)}${mc.kind === "video" ? ` · trim-in ${fmt(mc.trimInSec)}` : ""}`,
                        sel, "rgba(159,190,214,0.26)",
                        e => {
                          e.stopPropagation();
                          onSelect({ kind: "media", clipId: mc.id });
                          dragRef.current = { mode: "media", kind: "move", clipId: mc.id, startX: e.clientX, start: mc.startSec, dur: mc.durationSec, maxDur };
                        },
                        e => {
                          e.stopPropagation();
                          onSelect({ kind: "media", clipId: mc.id });
                          dragRef.current = { mode: "media", kind: "l", clipId: mc.id, startX: e.clientX, start: mc.startSec, dur: mc.durationSec, maxDur };
                        },
                        e => {
                          e.stopPropagation();
                          onSelect({ kind: "media", clipId: mc.id });
                          dragRef.current = { mode: "media", kind: "r", clipId: mc.id, startX: e.clientX, start: mc.startSec, dur: mc.durationSec, maxDur };
                        },
                        w,
                      )}
                    </div>
                  );
                })}
                {doc.mediaClips.length === 0 && (
                  <div style={{ ...muted, display: "flex", alignItems: "center", height: "100%", padding: "0 10px" }}>
                    Sin clips de media — súbelos desde el panel izquierdo.
                  </div>
                )}
              </div>
            </div>

            {/* Text track (V3.5) */}
            <div style={{ display: "flex", height: CLIP_H, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={labelCell} title="Texto, stickers y captions con animación">Texto · T</div>
              <div
                style={{ position: "relative", width: laneW, background: "rgba(255,255,255,0.015)" }}
                onDragOver={e => { if (onDropClip) e.preventDefault(); }}
                onDrop={e => {
                  if (!onDropClip) return;
                  e.preventDefault();
                  if (e.dataTransfer.getData("text/clip-kind") !== "text") return;
                  const clipId = e.dataTransfer.getData("text/clip-id");
                  if (clipId) onDropClip("text", clipId, snap(clamp(xToSec(e.clientX), 0, Math.max(0, total - 0.2))));
                }}
              >
                {doc.textClips.map(tc => {
                  const sel = selection?.kind === "text" && selection.clipId === tc.id;
                  const w = Math.max(10, tc.durationSec * pps);
                  return (
                    <div key={tc.id} style={{ position: "absolute", left: tc.startSec * pps, top: 0 }}>
                      {freeClip(
                        "T",
                        trunc(tc.text.replace(/\n/g, " "), Math.max(6, Math.floor(w / 6.5))),
                        `${trunc(tc.text.replace(/\n/g, " "), 40)} · ${fmt(tc.startSec)} → ${fmt(tc.startSec + tc.durationSec)} · ${tc.anim}`,
                        sel, "rgba(159,214,178,0.22)",
                        e => {
                          e.stopPropagation();
                          onSelect({ kind: "text", clipId: tc.id });
                          dragRef.current = { mode: "text", kind: "move", clipId: tc.id, startX: e.clientX, start: tc.startSec, dur: tc.durationSec };
                        },
                        e => {
                          e.stopPropagation();
                          onSelect({ kind: "text", clipId: tc.id });
                          dragRef.current = { mode: "text", kind: "l", clipId: tc.id, startX: e.clientX, start: tc.startSec, dur: tc.durationSec };
                        },
                        e => {
                          e.stopPropagation();
                          onSelect({ kind: "text", clipId: tc.id });
                          dragRef.current = { mode: "text", kind: "r", clipId: tc.id, startX: e.clientX, start: tc.startSec, dur: tc.durationSec };
                        },
                        w,
                      )}
                    </div>
                  );
                })}
                {doc.textClips.length === 0 && (
                  <div style={{ ...muted, display: "flex", alignItems: "center", height: "100%", padding: "0 10px" }}>
                    Sin textos — añade captions o stickers desde el panel izquierdo.
                  </div>
                )}
              </div>
            </div>

            {/* Audio track */}
            <div style={{ display: "flex", height: CLIP_H, borderTop: "1px solid rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={labelCell} title="Música y voz en off — mezcla por clips">Audio · A</div>
              <div
                style={{ position: "relative", width: laneW, background: "rgba(255,255,255,0.015)" }}
                onDragOver={e => { if (onDropClip) e.preventDefault(); }}
                onDrop={e => {
                  if (!onDropClip) return;
                  e.preventDefault();
                  if (e.dataTransfer.getData("text/clip-kind") !== "audio") return;
                  const clipId = e.dataTransfer.getData("text/clip-id");
                  if (clipId) onDropClip("audio", clipId, snap(clamp(xToSec(e.clientX), 0, Math.max(0, total - 0.2))));
                }}
              >
                {doc.audioClips.map(clip => {
                  const sel = selection?.kind === "audio" && selection.clipId === clip.id;
                  const w = Math.max(10, clip.durationSec * pps);
                  return (
                    <div key={clip.id} style={{ position: "absolute", left: clip.startSec * pps, top: 0 }}>
                      {freeClip(
                        "♪",
                        trunc(clip.name, Math.max(8, Math.floor(w / 6.5))),
                        `${clip.name} · ${fmt(clip.startSec)} → ${fmt(clip.startSec + clip.durationSec)} · vol ${Math.round(clip.volume * 100)}%`,
                        sel, "rgba(224,181,122,0.2)",
                        e => {
                          e.stopPropagation();
                          onSelect({ kind: "audio", clipId: clip.id });
                          dragRef.current = { mode: "audio", kind: "move", clipId: clip.id, startX: e.clientX, start: clip.startSec, dur: clip.durationSec };
                        },
                        e => {
                          e.stopPropagation();
                          onSelect({ kind: "audio", clipId: clip.id });
                          dragRef.current = { mode: "audio", kind: "l", clipId: clip.id, startX: e.clientX, start: clip.startSec, dur: clip.durationSec };
                        },
                        e => {
                          e.stopPropagation();
                          onSelect({ kind: "audio", clipId: clip.id });
                          dragRef.current = { mode: "audio", kind: "r", clipId: clip.id, startX: e.clientX, start: clip.startSec, dur: clip.durationSec };
                        },
                        w,
                      )}
                    </div>
                  );
                })}
                {doc.audioClips.length === 0 && (
                  <div style={{ ...muted, display: "flex", alignItems: "center", height: "100%", padding: "0 10px" }}>
                    Sin música — súbela desde el panel izquierdo.
                  </div>
                )}
              </div>
            </div>

            {/* Playhead across all lanes */}
            <div style={{ position: "absolute", left: LABEL_W + tSec * pps, top: 0, bottom: 0, width: 2, background: "#e0b57a", pointerEvents: "none", zIndex: 18 }} />
          </div>
        </div>
      </div>

      {/* Transition popover (anchored over the V lane) */}
      {trEdit !== null && projected.vClips[trEdit] && (() => {
        const vc = projected.vClips[trEdit];
        const fromFrame = frameById.get(vc.frameId);
        const nextInc = included[vc.takeIndex + 1];
        if (!fromFrame || !nextInc) return null;
        // V5: read the CURRENT transition (with params) from the from-frame's
        // schema — transitionOut on the timeline only carries type+duration.
        const trRaw = fromFrame.animation?.transitions?.find(t => t.toFrameId === nextInc.id) || null;
        const boundary = (vc.startSec + vc.durSec) * pps;
        return (
          <div
            style={{
              position: "fixed", left: Math.min((rulerRef.current?.getBoundingClientRect().left ?? 0) + boundary + 6, window.innerWidth - 268),
              top: (scrollRef.current?.getBoundingClientRect().top ?? 100) + 34, zIndex: 60,
              background: "#141414", border: "1px solid rgba(200,184,152,0.3)", borderRadius: 6,
              padding: 8, display: "flex", flexDirection: "column", gap: 6, width: 252,
              boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
            }}
          >
            <div style={{ fontSize: 9, color: "#9a968a" }}>De «{trunc(fromFrame.name, 14)}» a «{trunc(nextInc.name, 14)}»</div>
            <TransitionLibrary
              current={trRaw ? { type: trRaw.type, durationSec: trRaw.durationSec, params: trRaw.params } : null}
              onApply={pick => onTransitionChange(fromFrame, nextInc.id, { ...pick, type: pick.type as TransitionType })}
              onRemove={trRaw ? () => onTransitionChange(fromFrame, nextInc.id, null) : undefined}
            />
            <button type="button" onClick={() => setTrEdit(null)} style={smallBtn}>Listo</button>
          </div>
        );
      })()}
    </div>
  );
}
