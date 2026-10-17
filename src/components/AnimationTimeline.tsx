/**
 * AnimationTimeline — G1 (gap-analysis W2.1): the multi-track timeline for
 * ONE frame's animation, embedded in AnimationPanel's frame mode.
 *
 * Spec (Propuesta 07-oct §3.5/§6, scoped to the panel): regla en segundos,
 * cabezal arrastrable, fila por capa con su clip, carriles por propiedad
 * desplegables (rombos en el tiempo exacto), zoom (pps + Ctrl+rueda), snap
 * a keyframes/regla, prev/next keyframe y área de trabajo (in/out) que
 * delimita la reproducción.
 *
 * Pure view over AnimationSchema: seeking goes through onSeek (the playback
 * store), structure through buildTimelineLanes (the same projection the
 * video mode uses). Keyframe EDITING (drag/auto-key/copy) is G4 (W2.2) —
 * here a diamond click seeks the engine to its exact time.
 */

import { useMemo, useRef, useState } from "react";
import { buildTimelineLanes, lanePropLabel } from "../../shared/timelineLanes.ts";
import type { AnimationSchema } from "../../shared/animationSchema.ts";

const LABEL_W = 96;
const RULER_H = 22;
const ROW_H = 16;
const LANE_H = 13;
/** Snap radius in px — candidates within this distance of the cursor win. */
const SNAP_PX = 6;

const KF_COLORS: Record<string, string> = { transform: "#9fbed6", opacity: "#9fd6b2" };
const kfColor = (prop: string) => KF_COLORS[prop] || "#c8b898";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Nice ruler steps: first one whose labels clear ≥48px at the current zoom. */
function rulerStep(pps: number): number {
  for (const s of [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60]) {
    if (s * pps >= 48) return s;
  }
  return 60;
}

const fmtTick = (t: number, step: number) => (step < 1 ? `${t.toFixed(2).replace(/0$/, "")}s` : `${t}s`);

export interface AnimationTimelineProps {
  schema: AnimationSchema | null;
  /** Display order: animated layers ∪ frame top-level children. */
  layers: string[];
  timeSec: number;
  durationSec: number;
  onSeek: (t: number) => void;
  /** Work area (preview range). null = full timeline. Owned by the panel. */
  work: { in: number; out: number } | null;
  onWorkChange: (w: { in: number; out: number } | null) => void;
}

export function AnimationTimeline({
  schema, layers, timeSec, durationSec, onSeek, work, onWorkChange,
}: AnimationTimelineProps) {
  const [pps, setPps] = useState(24);
  const [snap, setSnap] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<"seek" | "in" | "out" | null>(null);

  // Honest geometry: the ruler is EXACTLY durationSec·pps wide. A minimum
  // width would lie below it — the px/s label says one scale while ticks and
  // xToSec() (which divides by pps) map another, and zoom-out would silently
  // stop shrinking. Tiny widths just scroll; minWidth:100% keeps rows sane.
  const trackW = Math.max(8, Math.round(durationSec * pps));
  const animLayers = useMemo(() => new Set((schema?.clips || []).map(c => c.layerId)), [schema]);
  /** Lanes per layer, keyed for stable expansion (buildTimelineLanes is pure). */
  const lanesByLayer = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildTimelineLanes>>();
    for (const l of layers) {
      if (animLayers.has(l) || open.has(l)) map.set(l, buildTimelineLanes(schema, l));
    }
    return map;
  }, [schema, layers, animLayers, open]);

  /** All keyframe times (layer·lane agnostic) — snap candidates + prev/next. */
  const kfTimes = useMemo(() => {
    const ts: number[] = [];
    for (const lanes of lanesByLayer.values()) {
      for (const ln of lanes) for (const k of ln.keyframes) ts.push(k.tSec);
    }
    return ts.sort((a, b) => a - b);
  }, [lanesByLayer]);
  const step = rulerStep(pps);

  const xToSec = (clientX: number): number | null => {
    const r = rulerRef.current?.getBoundingClientRect();
    if (!r) return null;
    return clamp((clientX - r.left) / pps, 0, durationSec);
  };
  /** Snap to the nearest keyframe (then ruler step) within SNAP_PX. */
  const snapTime = (t: number): number => {
    if (!snap) return round2(t);
    const radiusSec = SNAP_PX / pps;
    let best = Infinity;
    let bestD = radiusSec;
    for (const k of kfTimes) {
      const d = Math.abs(k - t);
      if (d < bestD) { bestD = d; best = k; }
    }
    if (best !== Infinity) return best;
    const snapped = Math.round(t / (step / 2)) * (step / 2);
    return Math.abs(snapped - t) <= radiusSec ? round2(snapped) : round2(t);
  };

  const onRulerDown = (e: React.PointerEvent) => {
    const t = xToSec(e.clientX);
    if (t === null) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = "seek";
    onSeek(clamp(snapTime(t), 0, durationSec));
  };
  const onRulerMove = (e: React.PointerEvent) => {
    if (dragRef.current !== "seek" || !(e.buttons & 1)) return;
    const t = xToSec(e.clientX);
    if (t !== null) onSeek(clamp(snapTime(t), 0, durationSec));
  };
  const endDrag = () => { dragRef.current = null; };

  const workIn = work ? work.in : 0;
  const workOut = work ? work.out : durationSec;
  const setWork = (in_: number, out: number) => {
    const lo = clamp(round2(in_), 0, durationSec);
    const hi = clamp(round2(out), 0, durationSec);
    if (hi - lo < 0.1) return; // never collapse the area under 100ms
    const full = lo <= 0.004 && hi >= durationSec - 0.004;
    onWorkChange(full ? null : { in: lo, out: hi });
  };
  const handleDown = (which: "in" | "out") => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = which;
  };
  const handleMove = (which: "in" | "out") => (e: React.PointerEvent) => {
    if (dragRef.current !== which || !(e.buttons & 1)) return;
    const t = xToSec(e.clientX);
    if (t === null) return;
    const snapped = snapTime(t);
    if (which === "in") setWork(Math.min(snapped, workOut - 0.1), workOut);
    else setWork(workIn, Math.max(snapped, workIn + 0.1));
  };

  const ticks: Array<{ t: number; label: string }> = [];
  for (let t = 0; t <= durationSec + 1e-6; t += step) {
    ticks.push({ t: round2(t), label: fmtTick(t, step) });
  }

  const headBtn: React.CSSProperties = {
    fontSize: 9, padding: "2px 6px", borderRadius: 3, cursor: "pointer", fontFamily: "inherit",
    border: "1px solid rgba(200,184,152,0.15)", background: "rgba(200,184,152,0.05)", color: "#c8b898",
  };

  return (
    <div data-qa="g1-timeline" style={{ margin: "6px 10px", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 5, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Header: zoom + snap + work-area reset */}
      <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "3px 4px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <span style={{ fontSize: 9, color: "#96917f", letterSpacing: 0.5, textTransform: "uppercase", flex: 1 }}>Timeline multipista</span>
        <button type="button" data-qa="g1-zoom-out" onClick={() => setPps(p => clamp(Math.round((p / 1.5) * 10) / 10, 6, 240))} style={headBtn} title="Alejar (menos px por segundo)">−</button>
        <span style={{ fontSize: 8, color: "#6f6a5e", fontFamily: "monospace", minWidth: 30, textAlign: "center" }}>{Math.round(pps)}px/s</span>
        <button type="button" data-qa="g1-zoom-in" onClick={() => setPps(p => clamp(Math.round(p * 1.5 * 10) / 10, 6, 240))} style={headBtn} title="Acercar (más px por segundo) — o Ctrl+rueda sobre las pistas">+</button>
        <button type="button" data-qa="g1-snap" onClick={() => setSnap(s => !s)}
          style={{ ...headBtn, borderColor: snap ? "rgba(200,184,152,0.5)" : "rgba(255,255,255,0.06)", color: snap ? "#e8ddc8" : "#6f6a5e" }}
          title="Imán: el cabezal y el área de trabajo se pegan a keyframes y marcas de la regla">
          ⌖ {snap ? "on" : "off"}
        </button>
        {work && (
          <button type="button" onClick={() => onWorkChange(null)} style={headBtn} title="Quitar área de trabajo (volver al timeline completo)">⟲ área</button>
        )}
      </div>

      {/* Tracks: one scroller, sticky ruler + sticky label column */}
      <div
        data-qa="g1-track-area"
        style={{ overflowX: "auto", overflowY: "auto", maxHeight: 240 }}
        onWheel={e => {
          if (!e.ctrlKey) return;
          e.preventDefault();
          setPps(p => clamp(Math.round(p * (e.deltaY < 0 ? 1.1 : 1 / 1.1) * 10) / 10, 6, 240));
        }}
      >
        <div style={{ position: "relative", width: LABEL_W + trackW, minWidth: "100%" }}>
          {/* Ruler (sticky top) */}
          <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 3, background: "#14130f" }}>
            <div style={{ flex: `0 0 ${LABEL_W}px`, fontSize: 8, color: "#6f6a5e", padding: "2px 4px", borderRight: "1px solid rgba(255,255,255,0.05)" }}>seg</div>
            <div
              ref={rulerRef}
              data-qa="g1-ruler"
              style={{ position: "relative", width: trackW, height: RULER_H, cursor: "text", userSelect: "none", touchAction: "none" }}
              onPointerDown={onRulerDown}
              onPointerMove={onRulerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {/* Work-area shading (outside the area) */}
              {work && workIn > 0 && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: workIn * pps, background: "rgba(0,0,0,0.45)" }} />}
              {work && workOut < durationSec - 1e-6 && <div style={{ position: "absolute", left: workOut * pps, top: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.45)" }} />}
              {ticks.map(tk => (
                <div key={tk.t} style={{ position: "absolute", left: tk.t * pps, top: 0, bottom: 0, pointerEvents: "none" }}>
                  <div style={{ position: "absolute", left: 0, top: RULER_H - 6, width: 1, height: 6, background: "rgba(255,255,255,0.25)" }} />
                  <span style={{ position: "absolute", left: 2, top: 1, fontSize: 8, color: "#96917f", fontFamily: "monospace", whiteSpace: "nowrap" }}>{tk.label}</span>
                </div>
              ))}
              {/* Work-area handles */}
              <div data-qa="g1-work-in" title="Inicio del área de trabajo (arrastra; doble click = 0)"
                style={{ position: "absolute", left: workIn * pps - 4, top: 0, width: 8, height: RULER_H, cursor: "ew-resize", touchAction: "none" }}
                onPointerDown={handleDown("in")} onPointerMove={handleMove("in")} onPointerUp={endDrag} onPointerCancel={endDrag}
                onDoubleClick={() => setWork(0, workOut)}>
                <div style={{ position: "absolute", left: 3, top: 0, width: 2, height: RULER_H, background: "#e0b57a" }} />
              </div>
              <div data-qa="g1-work-out" title="Fin del área de trabajo (arrastra; doble click = fin del timeline)"
                style={{ position: "absolute", left: workOut * pps - 4, top: 0, width: 8, height: RULER_H, cursor: "ew-resize", touchAction: "none" }}
                onPointerDown={handleDown("out")} onPointerMove={handleMove("out")} onPointerUp={endDrag} onPointerCancel={endDrag}
                onDoubleClick={() => setWork(workIn, durationSec)}>
                <div style={{ position: "absolute", left: 3, top: 0, width: 2, height: RULER_H, background: "#e0b57a" }} />
              </div>
              {/* Playhead knob (the draggable head; the line spans all rows) */}
              <div data-qa="g1-playhead" title="Cabezal — arrastra para buscar"
                style={{ position: "absolute", left: clamp(timeSec, 0, durationSec) * pps - 5, top: 0, width: 10, height: RULER_H, cursor: "ew-resize", touchAction: "none", zIndex: 2 }}
                onPointerDown={onRulerDown} onPointerMove={onRulerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
                <div style={{ position: "absolute", left: 4, top: 0, width: 2, height: RULER_H, background: "#f0e6c8" }} />
                <div style={{ position: "absolute", left: 1, top: 0, width: 8, height: 5, background: "#f0e6c8", borderRadius: "1px 1px 0 0" }} />
              </div>
            </div>
          </div>

          {/* Full-height playhead line (scrolls with content) */}
          <div style={{ position: "absolute", top: 0, bottom: 0, left: LABEL_W + clamp(timeSec, 0, durationSec) * pps, width: 1.5, background: "#f0e6c8", opacity: 0.85, pointerEvents: "none", zIndex: 4 }} />

          {/* Layer rows */}
          {layers.map(layer => {
            const lanes = lanesByLayer.get(layer) || [];
            const hasAnim = animLayers.has(layer);
            const expanded = open.has(layer);
            const clip = hasAnim ? (schema?.clips || []).find(c => c.layerId === layer) : undefined;
            return (
              <div key={layer} style={{ display: "flex", borderTop: "1px solid rgba(255,255,255,0.03)" }}>
                <div
                  data-qa="g1-layer-row"
                  data-layer-id={layer}
                  style={{
                    flex: `0 0 ${LABEL_W}px`, position: "sticky", left: 0, zIndex: 2, background: "#14130f",
                    display: "flex", alignItems: "center", gap: 2, padding: "0 4px 0 0",
                    opacity: hasAnim ? 1 : 0.45, minHeight: ROW_H,
                  }}
                >
                  {hasAnim ? (
                    <button type="button" data-qa="g1-layer-toggle" onClick={() => setOpen(prev => {
                      const next = new Set(prev);
                      if (next.has(layer)) next.delete(layer); else next.add(layer);
                      return next;
                    })} style={{ ...headBtn, padding: "0 4px", fontSize: 8, lineHeight: "12px", flex: "none" }} title={expanded ? "Ocultar carriles por propiedad" : "Mostrar carriles por propiedad"}>
                      {expanded ? "▾" : "▸"}
                    </button>
                  ) : (
                    <span style={{ display: "inline-block", width: 16, flex: "none" }} />
                  )}
                  <span style={{ fontSize: 9, color: hasAnim ? "#e8ddc8" : "#6f6a5e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={layer}>{layer}</span>
                </div>
                <div style={{ position: "relative", width: trackW, minHeight: ROW_H }}>
                  {/* Clip window bar */}
                  {clip && (
                    <div title={`${layer} · clip ${clip.startSec.toFixed(2)}s → ${clip.endSec.toFixed(2)}s`}
                      style={{ position: "absolute", left: clip.startSec * pps, width: Math.max(2, (clip.endSec - clip.startSec) * pps), top: 3, height: ROW_H - 7, background: "rgba(200,184,152,0.22)", border: "1px solid rgba(200,184,152,0.35)", borderRadius: 2 }} />
                  )}
                  {/* Property lanes (expanded) */}
                  {expanded && lanes.map(ln => (
                    <div key={`${ln.clipIndex}:${ln.prop}`} data-qa="g1-lane" data-prop={ln.prop} data-clip-index={ln.clipIndex}
                      title={`${lanePropLabel(ln.prop)} · ${ln.startSec.toFixed(2)}s → ${ln.endSec.toFixed(2)}`}
                      style={{ position: "relative", height: LANE_H, marginTop: 1 }}>
                      <div style={{ position: "absolute", left: ln.startSec * pps, width: Math.max(2, (ln.endSec - ln.startSec) * pps), top: LANE_H / 2 - 1, height: 2, background: "rgba(255,255,255,0.08)" }} />
                      {ln.keyframes.map(k => (
                        <button key={k.index} type="button" data-qa="g1-kf" data-t={k.tSec}
                          title={`${lanePropLabel(ln.prop)} @ ${k.tSec.toFixed(2)}s — click: llevar el cabezal ahí`}
                          onClick={() => onSeek(clamp(k.tSec, 0, durationSec))}
                          style={{
                            position: "absolute", left: k.tSec * pps - 3, top: LANE_H / 2 - 3, width: 7, height: 7,
                            transform: "rotate(45deg)", background: kfColor(ln.prop),
                            border: "1px solid rgba(0,0,0,0.6)", padding: 0, cursor: "pointer",
                          }} />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {!schema && (
            <div style={{ padding: "6px 8px", fontSize: 9, color: "#6f6a5e" }}>
              Sin animación todavía — aplica un preset para ver pistas y keyframes.
            </div>
          )}
        </div>
      </div>
      <div style={{ fontSize: 8, color: "#6f6a5e", padding: "2px 6px", lineHeight: 1.4, borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        {work
          ? `Área de trabajo ${workIn.toFixed(2)}s → ${workOut.toFixed(2)}s — Play arranca en el inicio y pausa al salir del área.`
          : "Rueda con Ctrl = zoom · arrastra el cabezal o el área de trabajo · click en un rombo lleva el cabezal a su tiempo."}
      </div>
    </div>
  );
}
