/**
 * EasingPicker — G7 (gap-analysis W1.3): the plain-language easing selector.
 *
 * Five curated curves (Lineal/Acelerar/Frenar/Acelerar-y-frenar/Salto), each
 * drawn with the SAME evalBezier the engine and the export sampler run, plus
 * a hover preview dot that traces the curve in real time. Raw bezier strings
 * never reach the screen as text: a stored custom curve (curve pad, MCP,
 * set_animation) displays as its closest curated label with a "≈" honesty
 * marker — display never mutates the value; only picking an option does.
 */

import { useEffect, useRef, useState } from "react";
import {
  SIMPLE_EASINGS,
  bezierOf,
  closestSimpleEasing,
  evalBezier,
} from "../../shared/animationSchema.ts";

/** Display y-range: headroom below 0 (anticipación) and above 1 (rebote) so
 *  the Salto overshoot stays visible inside the box instead of clipping. */
const CURVE_Y_MIN = -0.25;
const CURVE_Y_MAX = 1.3;

/** Mini curve SVG — 21 samples through evalBezier; `animate` runs a rAF dot
 *  that travels the curve (950ms travel + 350ms hold, looping). */
function EasingCurve({ value, size = 28, animate = false, accent = "#e8ddc8" }: {
  value: string;
  size?: number;
  animate?: boolean;
  accent?: string;
}) {
  const dotRef = useRef<SVGCircleElement | null>(null);
  const bez = bezierOf(value);
  const P = 3;
  const inner = size - 2 * P;
  const toX = (x: number) => P + x * inner;
  const toY = (y: number) => P + ((CURVE_Y_MAX - y) / (CURVE_Y_MAX - CURVE_Y_MIN)) * inner;
  const path = Array.from({ length: 21 }, (_, i) => {
    const x = i / 20;
    return `${i === 0 ? "M" : "L"}${toX(x).toFixed(1)} ${toY(evalBezier(bez, x)).toFixed(1)}`;
  }).join(" ");

  useEffect(() => {
    if (!animate) return;
    let raf = 0;
    const t0 = performance.now();
    const p = 3;
    const w = size - 2 * p;
    const xOf = (x: number) => p + x * w;
    const yOf = (y: number) => p + ((CURVE_Y_MAX - y) / (CURVE_Y_MAX - CURVE_Y_MIN)) * w;
    const step = (now: number) => {
      const dot = dotRef.current;
      if (dot) {
        const cyc = (now - t0) % 1300;
        const t = cyc < 950 ? cyc / 950 : 1;
        dot.setAttribute("cx", xOf(t).toFixed(1));
        dot.setAttribute("cy", yOf(evalBezier(bez, t)).toFixed(1));
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [animate, value, size, bez]);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flex: "none", background: "rgba(255,255,255,0.04)", borderRadius: 3 }} aria-hidden="true">
      <rect x={P} y={P} width={inner} height={inner} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={0.75} />
      <path data-qa="g7-curve" d={path} fill="none" stroke={accent} strokeWidth={1.25} />
      {animate && <circle data-qa="g7-dot" ref={dotRef} r={size > 20 ? 1.8 : 1.4} fill="#f0e6c8" />}
    </svg>
  );
}

export function EasingPicker({ easing, onPick, accent, compact = false }: {
  easing: string;
  onPick: (easing: string) => void;
  /** Optional lane accent color (VideoInspector codes lanes by easing). */
  accent?: string;
  /** Dense sizing for inline rows (video-mode lanes). */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const match = closestSimpleEasing(easing);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDocDown);
    return () => document.removeEventListener("pointerdown", onDocDown);
  }, [open]);

  const label = match.exact ? match.option.label : `≈ ${match.option.label}`;
  return (
    <div ref={rootRef} style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <button type="button" data-qa="g7-easing" onClick={() => setOpen(o => !o)}
        title={match.exact
          ? `Curva: ${match.option.label} — click para cambiar`
          : `Curva personalizada (la más parecida: ${match.option.label}) — elegir una opción la reemplaza`}
        style={{
          display: "flex", alignItems: "center", gap: 4, width: "100%", fontFamily: "inherit",
          background: "rgba(15,15,15,0.5)", border: `1px solid ${accent ? `${accent}55` : "rgba(255,255,255,0.05)"}`,
          color: accent || "#f0ebe0", borderRadius: 4, cursor: "pointer",
          padding: compact ? "1px 4px" : "2px 6px", fontSize: compact ? 9 : 10,
        }}>
        <EasingCurve value={easing} size={compact ? 14 : 16} accent={accent || "#e8ddc8"} />
        <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ fontSize: 7, color: "#8a8578" }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div data-qa="g7-menu" style={{
          position: "absolute", top: "100%", right: 0, marginTop: 3, zIndex: 60, minWidth: compact ? 190 : 215,
          display: "flex", flexDirection: "column", gap: 2, padding: 4,
          background: "#16140f", border: "1px solid rgba(200,184,152,0.3)", borderRadius: 5,
          boxShadow: "0 8px 24px rgba(0,0,0,0.55)",
        }}>
          {SIMPLE_EASINGS.map(s => {
            const isCurrent = match.exact && s.id === match.option.id;
            return (
              <button key={s.id} type="button" data-qa="g7-option" data-value={s.value}
                onPointerEnter={() => setHover(s.id)}
                onPointerLeave={() => setHover(h => (h === s.id ? null : h))}
                onClick={() => { onPick(s.value); setOpen(false); setHover(null); }}
                title={`${s.label} — ${s.about}`}
                style={{
                  display: "flex", alignItems: "center", gap: 6, textAlign: "left", cursor: "pointer",
                  fontFamily: "inherit", padding: "3px 4px", borderRadius: 4, color: "#e8e2d4",
                  background: isCurrent ? "rgba(200,184,152,0.12)" : hover === s.id ? "rgba(255,255,255,0.05)" : "transparent",
                  border: `1px solid ${isCurrent ? "rgba(200,184,152,0.45)" : "transparent"}`,
                }}>
                <EasingCurve value={s.value} size={compact ? 22 : 28} animate={hover === s.id} accent={isCurrent ? "#e0b57a" : "#e8ddc8"} />
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 10, lineHeight: 1.3 }}>{s.label}{isCurrent ? " · actual" : ""}</span>
                  <span style={{ fontSize: 8, color: "#96917f", lineHeight: 1.3 }}>{s.about}</span>
                </span>
              </button>
            );
          })}
          <span style={{ fontSize: 8, color: "#6f6a5e", padding: "2px 4px 0", lineHeight: 1.4 }}>
            La curva se dibuja con el mismo evaluador del motor; pasar el cursor la reproduce.
          </span>
        </div>
      )}
    </div>
  );
}
