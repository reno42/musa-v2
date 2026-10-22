/**
 * ProjectTimeline — timeline drag & drop del editor de video (REQ-VID11).
 *
 * · SOLO pointer events (pointerdown/move/up + setPointerCapture): cero
 *   listeners globales de mouse, cero HTML5 drag&drop.
 * · Bloque: drag → target_start_us (snap magnético 8px a bordes de otros
 *   clips, playhead y marcas de 1s, con guía visible). Bordes: trim que
 *   recalcula source con la regla de oro y clampea al material — las MISMAS
 *   fórmulas del service (videoTimelineMath), así el PATCH del autosave
 *   produce exactamente el estado que se ve.
 * · Zoom = px/µs SOLO visual (slider log + Ctrl+wheel anclado al cursor;
 *   en touch, pinch con el MISMO ancla).
 * · VID12 touch: drag vertical en zona vacía = scroll de tracks.
 * · Feedback continuo: timecode en vivo durante el gesto + guía de alineación.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { VideoProjectDoc, VideoMaterial, VideoSegment } from "../../lib/videoProjectStore";
import type { VideoApplyMeta } from "../../lib/videoProjectStore";
import {
  DEFAULT_DROP_DUR_US,
  SNAP_TOLERANCE_PX,
  US_PER_SECOND,
  computeTrimLeft,
  computeTrimRight,
  formatTimecode,
  snapCandidates,
  snapEdge,
  snapMove,
} from "../../lib/videoTimelineMath";
import {
  contentEndUs,
  findSegment,
  materialDurationUs,
  updateSegmentTiming,
} from "./videoDocOps";

const MIN_US_PER_PX = 100;       // 1s = 10_000 px
const MAX_US_PER_PX = 500_000;   // 1s = 2 px
const RULER_H = 26;
const ROW_H = 52;
const TAIL_PAD_US = 10 * US_PER_SECOND; // espacio vacío al final del timeline

interface ProjectTimelineProps {
  doc: VideoProjectDoc;
  selectedSegmentId: string | null;
  playheadUs: number;
  usPerPx: number;
  onSeek: (us: number) => void;
  onSelectSegment: (segmentId: string | null) => void;
  onDocChange: (next: VideoProjectDoc, meta: VideoApplyMeta) => void;
  onZoomChange: (usPerPx: number) => void;
}

type DragMode = "move" | "trimL" | "trimR";

interface DragState {
  mode: DragMode;
  segmentId: string;
  pointerId: number;
  grabOffsetUs: number; // move: pointerUs − target_start del origen
  originStartUs: number; // trimL: target_start del origen
  origin: { target_start_us: number; target_dur_us: number; source_start_us: number | null; source_dur_us: number | null; speed: number };
  key: string;
  label: string;
}

function labelForMaterial(m: VideoMaterial | null): string {
  const p = (m?.payload ?? {}) as { url?: unknown; text?: unknown };
  if (typeof p.text === "string" && p.text.trim()) return p.text.trim().slice(0, 40);
  if (typeof p.url === "string" && p.url) {
    const file = p.url.split("/").pop() || p.url;
    return decodeURIComponent(file).slice(0, 40);
  }
  return m ? m.kind : "clip";
}

export function ProjectTimeline(props: ProjectTimelineProps) {
  const { doc, selectedSegmentId, playheadUs, usPerPx, onSeek, onSelectSegment, onDocChange, onZoomChange } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const scrubRef = useRef(false);
  const gestureSeq = useRef(0);
  const zoomAnchor = useRef<{ usAtCursor: number; cursorOffsetPx: number } | null>(null);

  const [guideUs, setGuideUs] = useState<number | null>(null);
  const [tip, setTip] = useState<{ px: number; text: string } | null>(null);

  // ── VID12 (touch): pinch = zoom anclado al punto medio; drag vertical en
  // zona vacía = scroll de tracks. Solo pointer events, como todo el timeline.
  const touchRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ dist: number; midX: number } | null>(null);
  const panRef = useRef<{ id: number; startY: number; startTop: number } | null>(null);

  const onScrollPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return; // mouse: rueda/slider, scroll nativo
    touchRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touchRef.current.size === 2) {
      const [a, b] = [...touchRef.current.values()];
      pinchRef.current = { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), midX: (a.x + b.x) / 2 };
      panRef.current = null; // el pinch gana el gesto
    } else if (touchRef.current.size === 1) {
      panRef.current = { id: e.pointerId, startY: e.clientY, startTop: scrollRef.current?.scrollTop ?? 0 };
    }
  };

  const onScrollPointerMove = (e: React.PointerEvent) => {
    if (!touchRef.current.has(e.pointerId)) return;
    touchRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const el = scrollRef.current;
    if (!el) return;
    if (touchRef.current.size >= 2 && pinchRef.current) {
      const [a, b] = [...touchRef.current.values()];
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const factor = dist / pinchRef.current.dist;
      if (Math.abs(factor - 1) >= 0.02) {
        // Mismo ancla que Ctrl+wheel: el µs bajo el punto medio no se mueve.
        const rect = el.getBoundingClientRect();
        const usAtMid = Math.max(0, (pinchRef.current.midX - rect.left + el.scrollLeft) * usPerPx);
        zoomAnchor.current = { usAtCursor: usAtMid, cursorOffsetPx: pinchRef.current.midX - rect.left };
        const next = Math.min(MAX_US_PER_PX, Math.max(MIN_US_PER_PX, usPerPx / factor));
        if (next !== usPerPx) onZoomChange(next);
        pinchRef.current = { dist, midX: (a.x + b.x) / 2 };
      }
      return;
    }
    const pan = panRef.current;
    if (pan && pan.id === e.pointerId && Math.abs(e.clientY - pan.startY) > 2) {
      el.scrollTop = Math.max(0, pan.startTop - (e.clientY - pan.startY));
    }
  };

  const onScrollPointerUp = (e: React.PointerEvent) => {
    touchRef.current.delete(e.pointerId);
    if (touchRef.current.size < 2) pinchRef.current = null;
    if (panRef.current?.id === e.pointerId) panRef.current = null;
  };

  const contentEnd = contentEndUs(doc);
  const contentUs = Math.max(contentEnd + TAIL_PAD_US, DEFAULT_DROP_DUR_US * 4);
  const contentPx = Math.ceil(contentUs / usPerPx);

  // ── pointer → µs (coordenada de contenido) ──
  const pointerToUs = useCallback((clientX: number): number => {
    const el = scrollRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left + el.scrollLeft) * usPerPx);
  }, [usPerPx]);

  // ── gestos de bloque (move / trim) ──
  const beginDrag = (e: React.PointerEvent, seg: VideoSegment, mode: DragMode) => {
    e.stopPropagation();
    const pointerUs = pointerToUs(e.clientX);
    const seq = gestureSeq.current++;
    dragRef.current = {
      mode,
      segmentId: seg.id,
      pointerId: e.pointerId,
      grabOffsetUs: pointerUs - seg.target_start_us,
      originStartUs: seg.target_start_us,
      origin: {
        target_start_us: seg.target_start_us,
        target_dur_us: seg.target_dur_us,
        source_start_us: seg.source_start_us,
        source_dur_us: seg.source_dur_us,
        speed: seg.speed,
      },
      key: `gesto:${seq}`,
      label: mode === "move" ? "mover clip" : "recortar clip",
    };
    onSelectSegment(seg.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onDragMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const pointerUs = pointerToUs(e.clientX);
    const seg = findSegment(doc, drag.segmentId);
    if (!seg) return;
    const materialsById = new Map(doc.materials.map((m) => [m.id, m]));
    const matDur = materialDurationUs(materialsById.get(seg.material_id) ?? null);
    const segments = doc.tracks.flatMap((t) => t.segments);
    const candidates = snapCandidates({
      excludeSegmentId: seg.id,
      segments,
      playheadUs,
      windowEndUs: contentUs,
    });
    const tol = SNAP_TOLERANCE_PX * usPerPx;

    if (drag.mode === "move") {
      const desired = pointerUs - drag.grabOffsetUs;
      const r = snapMove(desired, seg.target_dur_us, candidates, tol, Math.max(0, contentUs - seg.target_dur_us));
      const next = updateSegmentTiming(doc, seg.id, {
        target_start_us: r.startUs,
        target_dur_us: seg.target_dur_us,
        source_start_us: seg.source_start_us,
        source_dur_us: seg.source_dur_us,
        speed: seg.speed,
      });
      onDocChange(next, { label: drag.label, coalesceKey: drag.key });
      setGuideUs(r.guideUs);
      setTip({ px: r.startUs / usPerPx, text: formatTimecode(r.startUs, 3) });
      return;
    }

    // Trim: dt absoluto desde el borde del ORIGEN (sin acumulación de error).
    if (drag.mode === "trimL") {
      const rawDt = pointerUs - drag.originStartUs;
      const snapped = snapEdge(drag.originStartUs + rawDt, candidates, tol);
      const dt = snapped.value - drag.originStartUs;
      const timing = computeTrimLeft(drag.origin, dt, matDur);
      onDocChange(updateSegmentTiming(doc, seg.id, timing), { label: drag.label, coalesceKey: drag.key });
      setGuideUs(snapped.guideUs);
      setTip({ px: timing.target_start_us / usPerPx, text: formatTimecode(timing.target_dur_us, 3) });
      return;
    }
    const originRightUs = drag.origin.target_start_us + drag.origin.target_dur_us;
    const rawDt = pointerUs - originRightUs;
    const snapped = snapEdge(originRightUs + rawDt, candidates, tol);
    const dt = snapped.value - originRightUs;
    const timing = computeTrimRight(drag.origin, dt, matDur);
    onDocChange(updateSegmentTiming(doc, seg.id, timing), { label: drag.label, coalesceKey: drag.key });
    setGuideUs(snapped.guideUs);
    setTip({ px: (timing.target_start_us + timing.target_dur_us) / usPerPx, text: formatTimecode(timing.target_dur_us, 3) });
  };

  const endDrag = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    setGuideUs(null);
    setTip(null);
  };

  // ── ruler scrub (click + drag = seek) — stopPropagation: el pan/pinch del
  // contenedor no debe arrancar desde el ruler.
  const onRulerPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    scrubRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onSeek(Math.round(pointerToUs(e.clientX)));
  };
  const onRulerPointerMove = (e: React.PointerEvent) => {
    if (!scrubRef.current) return;
    onSeek(Math.round(pointerToUs(e.clientX)));
  };
  const onRulerPointerUp = () => { scrubRef.current = false; };

  // ── zoom: Ctrl+wheel anclado al cursor (listener nativo no-passivo) ──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const usAtCursor = Math.max(0, (e.clientX - rect.left + el.scrollLeft) * usPerPx);
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      const next = Math.min(MAX_US_PER_PX, Math.max(MIN_US_PER_PX, usPerPx * factor));
      if (next === usPerPx) return;
      zoomAnchor.current = { usAtCursor, cursorOffsetPx: e.clientX - rect.left };
      onZoomChange(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [usPerPx, onZoomChange]);

  // Tras cada cambio de zoom, re-ancla el scroll para que el µs bajo el
  // cursor no se mueva (sensación CapCut de zoom "hacia el cursor").
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = zoomAnchor.current;
    if (!el || !anchor) return;
    zoomAnchor.current = null;
    el.scrollLeft = Math.max(0, anchor.usAtCursor / usPerPx - anchor.cursorOffsetPx);
  }, [usPerPx]);

  // Slider logarítmico: 0..100 → MIN..MAX.
  const zoomSliderValue = Math.round(
    (100 * Math.log(usPerPx / MIN_US_PER_PX)) / Math.log(MAX_US_PER_PX / MIN_US_PER_PX),
  );
  const onZoomSlider = (v: number) => {
    onZoomChange(MIN_US_PER_PX * Math.pow(MAX_US_PER_PX / MIN_US_PER_PX, v / 100));
  };

  // ── marcas del ruler: paso tal que gap ≥ 70 px ──
  const stepsUs = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600].map((s) => s * US_PER_SECOND);
  const stepUs = stepsUs.find((s) => s / usPerPx >= 70) ?? stepsUs[stepsUs.length - 1];
  const marks: Array<{ us: number; major: boolean }> = [];
  for (let us = 0; us <= contentUs; us += stepUs) {
    marks.push({ us: Math.round(us), major: true });
  }

  const displayTracks = [...doc.tracks].sort((a, b) => b.z_order - a.z_order);
  const materialsById = new Map(doc.materials.map((m) => [m.id, m]));

  return (
    <div className="vp-timeline">
      <div className="vp-tl-toolbar">
        <span className="vp-tl-time" role="status">{formatTimecode(playheadUs, 3)}</span>
        <span style={{ flex: 1 }} />
        <span className="vp-tl-zoom-label">Zoom</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Number.isFinite(zoomSliderValue) ? Math.max(0, Math.min(100, zoomSliderValue)) : 0}
          onChange={(e) => onZoomSlider(Number(e.target.value))}
          aria-label="Zoom del timeline"
        />
        <span className="vp-tl-zoom-label">{usPerPx < 1000 ? `${Math.round(usPerPx)} µs/px` : `${(usPerPx / 1000).toFixed(usPerPx < 10_000 ? 1 : 0)} ms/px`}</span>
      </div>

      <div className="vp-tl-body">
        <div className="vp-tl-labels" style={{ paddingTop: RULER_H }}>
          {displayTracks.map((t) => (
            <div key={t.id} className="vp-tl-label" style={{ height: ROW_H }}>
              <span className={`vp-track-chip vp-track-${t.type}`}>{t.type}</span>
              <span className="vp-track-z">z{t.z_order}</span>
            </div>
          ))}
          {displayTracks.length === 0 && (
            <div className="vp-tl-label" style={{ height: ROW_H }}>
              <span className="vp-track-z">sin tracks</span>
            </div>
          )}
        </div>

        <div
          ref={scrollRef}
          className="vp-tl-scroll"
          onPointerDown={onScrollPointerDown}
          onPointerMove={onScrollPointerMove}
          onPointerUp={onScrollPointerUp}
          onPointerCancel={onScrollPointerUp}
        >
          <div className="vp-tl-content" style={{ width: contentPx }}>
            {/* Ruler sticky: click/drag = scrub del playhead */}
            <div
              className="vp-tl-ruler"
              style={{ height: RULER_H }}
              onPointerDown={onRulerPointerDown}
              onPointerMove={onRulerPointerMove}
              onPointerUp={onRulerPointerUp}
            >
              {marks.map((m) => (
                <span key={m.us} className="vp-tl-mark" style={{ left: m.us / usPerPx }}>
                  {formatTimecode(m.us)}
                </span>
              ))}
            </div>

            {displayTracks.map((t) => (
              <div
                key={t.id}
                className={`vp-tl-row vp-tl-${t.type}`}
                style={{ height: ROW_H }}
                onPointerDown={() => onSelectSegment(null)}
              >
                {t.segments.map((s) => {
                  const m = materialsById.get(s.material_id) ?? null;
                  const selected = s.id === selectedSegmentId;
                  return (
                    <div
                      key={s.id}
                      className={selected ? "vp-block vp-block-selected" : "vp-block"}
                      style={{
                        left: s.target_start_us / usPerPx,
                        width: Math.max(3, s.target_dur_us / usPerPx),
                      }}
                      title={`${labelForMaterial(m)} · ${formatTimecode(s.target_start_us, 3)} → ${formatTimecode(s.target_start_us + s.target_dur_us, 3)}`}
                      onPointerDown={(e) => beginDrag(e, s, "move")}
                      onPointerMove={onDragMove}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                    >
                      <span className="vp-block-label">{labelForMaterial(m)}</span>
                      <span className="vp-block-dur">{formatTimecode(s.target_dur_us)}</span>
                      <span
                        className="vp-block-handle vp-handle-l"
                        title="Recortar inicio"
                        onPointerDown={(e) => beginDrag(e, s, "trimL")}
                        onPointerMove={onDragMove}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                      />
                      <span
                        className="vp-block-handle vp-handle-r"
                        title="Recortar fin"
                        onPointerDown={(e) => beginDrag(e, s, "trimR")}
                        onPointerMove={onDragMove}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                      />
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Guía de alineación del snap (visible solo durante el gesto) */}
            {guideUs !== null && (
              <span className="vp-guide" style={{ left: guideUs / usPerPx }} aria-hidden="true" />
            )}
            {/* Playhead sobre todas las filas */}
            <span className="vp-playhead" style={{ left: playheadUs / usPerPx }} aria-hidden="true" />
          </div>
        </div>
      </div>

      {tip && (
        <span className="vp-tooltip" style={{ left: tip.px + 132 }}>{tip.text}</span>
      )}
    </div>
  );
}
