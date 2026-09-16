/**
 * VideoTimeline — the CapCut-style multi-track timeline (Video Mode v2).
 *
 * Replaces the v1 storyboard strip + per-take mini timeline with ONE
 * continuous timeline:
 *   • V1 (magnetic main track): takes as contiguous clips — drag to reorder
 *     (insertion marker, CapCut-style), right edge = trim (= take duration),
 *     click = select. Transition diamonds sit between clips (click → editor).
 *   • L-rows: one track per animated layer ("capas apiladas") — clips live
 *     inside their take's window; drag to move/trim (commit = clip times on
 *     the owning frame's animation schema).
 *   • A-row: music clips — free placement (drag), edge trim, loop on export.
 *   • Ruler + zoom + playhead scrub + snapping + keyboard (Space, arrows,
 *     Home, Del).
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
import type { ReelAudioClip, VideoTimelineDoc } from "../../lib/videoTimelineDoc";
import type { FrameData } from "../DesignFrame";

export type TimelineSelection =
  | { kind: "take"; frameId: string }
  | { kind: "layer"; frameId: string; layerId: string }
  | { kind: "audio"; clipId: string };

export interface VideoTimelineProps {
  frames: FrameData[];
  included: FrameData[];
  tl: ReelTimeline;
  doc: VideoTimelineDoc;
  tSec: number;
  playing: boolean;
  thumbs: Record<string, string>;
  selection: TimelineSelection | null;
  onSeek: (t: number) => void;
  onTogglePlay: () => void;
  onSelect: (sel: TimelineSelection | null) => void;
  onTakeDuration: (frame: FrameData, d: number) => void;
  onAnimationFrameChange: (frameId: string, next: AnimationSchema | null) => void;
  onFramesReorder: (orderedIds: string[]) => void;
  onTransitionChange: (fromFrame: FrameData, toFrameId: string, next: { type: TransitionType; durationSec: number } | null) => void;
  onAudioChange: (clipId: string, patch: Partial<ReelAudioClip> | null) => void;
  /** Media-panel drop: (re)insert a frame at an included index. */
  onDropFrame?: (frameId: string, insertIncIdx: number) => void;
}

// ── Local idiom (matches the v1 overlay's glass styling) ──
const smallBtn: React.CSSProperties = {
  fontSize: 10, padding: "2px 8px", borderRadius: 3,
  border: "1px solid rgba(200,184,152,0.15)", background: "rgba(200,184,152,0.05)",
  color: "#c8b898", cursor: "pointer", fontFamily: "inherit",
};
const muted: React.CSSProperties = { fontSize: 10, lineHeight: 1.4, color: "#7a7668" };

const LABEL_W = 92;
const ROW_H = 46;
const LAYER_H = 24;
const AUDIO_H = 32;
const RULER_H = 20;

const TRANSITION_LABELS: Record<string, string> = { fade: "Fundido", slide: "Desliza", zoom: "Zoom", wipe: "Barrido" };
const TRANSITION_ICONS: Record<string, string> = { fade: "◐", slide: "⇥", zoom: "⤢", wipe: "▥" };

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const fmt = (t: number) => `${t.toFixed(2)}s`;
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

type DragState =
  | { mode: "scrub" }
  | { mode: "takeMove"; incIdx: number; startX: number; moved: boolean }
  | { mode: "takeTrim"; incIdx: number; startX: number; startDur: number }
  | { mode: "layer"; kind: "move" | "l" | "r"; frameId: string; layerId: string; startX: number; gStart: number; gEnd: number; takeStart: number; takeDur: number }
  | { mode: "audio"; kind: "move" | "l" | "r"; clipId: string; startX: number; start: number; dur: number };

export function VideoTimeline({
  frames, included, tl, doc, tSec, playing, thumbs, selection,
  onSeek, onTogglePlay, onSelect, onTakeDuration, onAnimationFrameChange, onFramesReorder,
  onTransitionChange, onAudioChange, onDropFrame,
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
    return pts;
  }, [tl, total]);

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
  }, [xToSec, pps, tl, included, insertAt, total, onSeek, onTakeDuration, commitLayerClip, onAudioChange, reorderIncluded, snap]);

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

  // ── Keyboard (Space / arrows / Home / Del) ──
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === " ") { e.preventDefault(); e.stopPropagation(); onTogglePlay(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); onSeek(tSec - (e.shiftKey ? 1 : 1 / tl.fps)); }
    else if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); onSeek(tSec + (e.shiftKey ? 1 : 1 / tl.fps)); }
    else if (e.key === "Home") { e.preventDefault(); e.stopPropagation(); onSeek(0); }
    else if ((e.key === "Delete" || e.key === "Backspace") && selection?.kind === "audio") {
      e.preventDefault(); e.stopPropagation();
      onAudioChange(selection.clipId, null);
      onSelect(null);
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
    fontSize: 9, letterSpacing: 0.5, color: "#9a968a",
    background: "#101010", borderRight: "1px solid rgba(255,255,255,0.06)",
    overflow: "hidden", whiteSpace: "nowrap",
  };

  const selBorder = (on: boolean) => `1px solid ${on ? "rgba(224,181,122,0.9)" : "rgba(200,184,152,0.4)"}`;

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
        <span style={{ fontSize: 10, fontFamily: "monospace", color: "#c8b898" }}>{fmt(tSec)} / {fmt(total)}</span>
        <div style={{ flex: 1 }} />
        <span style={muted}>{included.length} toma{included.length === 1 ? "" : "s"} · {tl.fps} fps</span>
        <span style={muted}>zoom</span>
        <input type="range" min={16} max={320} step={8} value={pps} onChange={e => setPps(parseInt(e.target.value, 10) || 64)} style={{ width: 90, accentColor: "#c8b898" }} />
        <span style={{ ...muted, display: ["take", "layer", "audio"].includes(selection?.kind || "") ? "none" : undefined }}>
          arrastra clips · borde derecho = recortar · click en la regla = scrub
        </span>
      </div>

      {/* Scrollable tracks */}
      <div ref={scrollRef} style={{ overflowX: "auto", overflowY: "auto", maxHeight: 226, position: "relative" }}>
        <div style={{ width: LABEL_W + laneW }}>
          {/* Ruler */}
          <div style={{ display: "flex", height: RULER_H }}>
            <div style={labelCell} />
            <div
              ref={rulerRef}
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
              {/* Playhead handle */}
              <div style={{ position: "absolute", left: tSec * pps - 5, top: 0, width: 10, height: 10, background: "#e0b57a", clipPath: "polygon(0 0, 100% 0, 50% 100%)", pointerEvents: "none", zIndex: 8 }} />
            </div>
          </div>

          {/* Lanes */}
          <div style={{ position: "relative" }}>
            {/* V1 — magnetic take track */}
            <div style={{ display: "flex", height: ROW_H, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={labelCell}>V1 · Tomas</div>
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
                      title={tr ? `${TRANSITION_LABELS[tr.type]} ${tr.durationSec.toFixed(1)}s — click para editar` : "Corte seco — click para añadir transición"}
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
                <div style={labelCell}>Capas</div>
                <div style={{ ...muted, display: "flex", alignItems: "center", padding: "0 10px" }}>
                  Sin clips de capa — aplica presets de animación y aparecen aquí apiladas por capa.
                </div>
              </div>
            )}

            {/* Audio track */}
            <div style={{ display: "flex", height: AUDIO_H, borderTop: "1px solid rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={labelCell}>♪ Audio</div>
              <div style={{ position: "relative", width: laneW, background: "rgba(255,255,255,0.015)" }}>
                {doc.audioClips.map(clip => {
                  const sel = selection?.kind === "audio" && selection.clipId === clip.id;
                  const left = clip.startSec * pps;
                  const w = Math.max(10, clip.durationSec * pps);
                  return (
                    <div key={clip.id} style={{ position: "absolute", left, top: 4, width: w, height: AUDIO_H - 9 }}>
                      <div
                        onPointerDown={e => {
                          e.stopPropagation();
                          onSelect({ kind: "audio", clipId: clip.id });
                          dragRef.current = { mode: "audio", kind: "move", clipId: clip.id, startX: e.clientX, start: clip.startSec, dur: clip.durationSec };
                        }}
                        title={`${clip.name} · ${fmt(clip.startSec)} → ${fmt(clip.startSec + clip.durationSec)} · vol ${Math.round(clip.volume * 100)}%`}
                        style={{
                          position: "absolute", inset: 0, borderRadius: 3, cursor: "grab", overflow: "hidden",
                          background: sel ? "rgba(224,181,122,0.4)" : "rgba(224,181,122,0.2)",
                          border: selBorder(sel),
                        }}
                      >
                        <span style={{ position: "absolute", left: 4, top: 1, fontSize: 8, color: "#f0dfc0", fontFamily: "monospace", whiteSpace: "nowrap", pointerEvents: "none" }}>
                          ♪ {trunc(clip.name, Math.max(8, Math.floor(w / 6.5)))}
                        </span>
                      </div>
                      <div data-handle="1" onPointerDown={e => {
                        e.stopPropagation();
                        dragRef.current = { mode: "audio", kind: "l", clipId: clip.id, startX: e.clientX, start: clip.startSec, dur: clip.durationSec };
                      }} style={{ position: "absolute", left: -2, top: 0, width: 6, height: "100%", cursor: "ew-resize" }} />
                      <div data-handle="1" onPointerDown={e => {
                        e.stopPropagation();
                        dragRef.current = { mode: "audio", kind: "r", clipId: clip.id, startX: e.clientX, start: clip.startSec, dur: clip.durationSec };
                      }} style={{ position: "absolute", right: -2, top: 0, width: 6, height: "100%", cursor: "ew-resize" }} />
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
        const tr = tl.takes[vc.takeIndex]?.transitionOut || null;
        const boundary = (vc.startSec + vc.durSec) * pps;
        return (
          <div
            style={{
              position: "fixed", left: Math.min((rulerRef.current?.getBoundingClientRect().left ?? 0) + boundary + 6, window.innerWidth - 210),
              top: (scrollRef.current?.getBoundingClientRect().top ?? 100) + 34, zIndex: 60,
              background: "#141414", border: "1px solid rgba(200,184,152,0.3)", borderRadius: 6,
              padding: 8, display: "flex", flexDirection: "column", gap: 6, width: 186,
              boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
            }}
          >
            <div style={{ fontSize: 9, color: "#9a968a" }}>De «{trunc(fromFrame.name, 14)}» a «{trunc(nextInc.name, 14)}»</div>
            <div style={{ display: "flex", gap: 4 }}>
              {(["fade", "slide", "zoom", "wipe"] as const).map(t => (
                <button key={t} type="button" title={TRANSITION_LABELS[t]}
                  onClick={() => onTransitionChange(fromFrame, nextInc.id, { type: t, durationSec: tr?.durationSec ?? 0.6 })}
                  style={{ ...smallBtn, flex: 1, padding: "4px 0", borderColor: tr?.type === t ? "rgba(200,184,152,0.6)" : undefined, background: tr?.type === t ? "rgba(200,184,152,0.14)" : undefined }}>
                  {TRANSITION_ICONS[t]}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ ...muted, flex: 1 }}>Duración</span>
              <input type="number" min={0.1} max={5} step={0.1} value={tr?.durationSec ?? 0.6}
                onChange={e => onTransitionChange(fromFrame, nextInc.id, { type: tr?.type ?? "fade", durationSec: clamp(parseFloat(e.target.value) || 0.6, 0.1, 5) })}
                style={{ width: 52, background: "rgba(15,15,15,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ebe0", borderRadius: 4, padding: "2px 5px", fontSize: 10, fontFamily: "monospace" }} />
              <span style={muted}>s</span>
            </div>
            {tr && (
              <button type="button" onClick={() => onTransitionChange(fromFrame, nextInc.id, null)} style={{ ...smallBtn, color: "#e07a7a", borderColor: "rgba(224,122,122,0.3)" }}>
                Quitar transición (corte seco)
              </button>
            )}
            <button type="button" onClick={() => setTrEdit(null)} style={smallBtn}>Listo</button>
          </div>
        );
      })()}
    </div>
  );
}
