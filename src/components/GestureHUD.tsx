/**
 * GestureHUD — the Musa Hands overlay (REQ Gesture Mode §6 hud.tsx).
 * Bottom-left card with the mirrored camera preview, hand skeleton, current
 * gesture label, status chip and the always-visible camera indicator
 * (honesty requirement §6.3) plus the "on-device" badge (§10-r4).
 *
 * Presenter mode (§10-r5 cola): bigger canvas, thick strokes and big labels
 * so the gestures read from the demo clip on a phone screen.
 *
 * Drawing runs on rAF against the store's non-reactive frame slot — 30fps
 * updates never touch React state.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getActiveManager } from "../lib/gesture/bridge";
import { getGestureState, subscribeGesture, getLatestFrame } from "../lib/gesture/gestureStore";
import { GestureSettings } from "./GestureSettings";

/** MediaPipe hand topology (21 landmarks). */
const EDGES: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export function GestureHUD({ onOff }: { onOff: () => void }) {
  const s = useSyncExternalStore(subscribeGesture, getGestureState);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cheatOpen, setCheatOpen] = useState(false);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      if (canvas) drawHud(canvas);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!s.hudVisible && s.status !== "error") {
    // Hidden HUD: a floating dot keeps the camera indicator honest (§6.3).
    return (
      <div
        title="Musa Hands activo — HUD oculto. La cámara sigue encendida (local, nada sale de tu compu)."
        style={{
          position: "fixed", left: 14, bottom: 14, zIndex: 9300,
          width: 12, height: 12, borderRadius: 999,
          background: s.status === "armed" ? "#22c55e" : "#eab308",
          border: "2px solid rgba(0,0,0,0.55)",
          boxShadow: "0 0 8px rgba(34,197,94,0.7)",
        }}
      >
        {settingsOpen && <GestureSettings onClose={() => setSettingsOpen(false)} />}
      </div>
    );
  }

  const presenter = s.presenter;
  const cw = presenter ? 340 : 224;
  const ch = presenter ? 255 : 168;
  const statusColor =
    s.status === "armed" ? "#22c55e" :
    s.status === "suspended" ? "#eab308" :
    s.status === "loading" ? "#60a5fa" : "#ef4444";
  const statusText =
    s.status === "armed" ? "ARMADO" :
    s.status === "suspended" ? "EN PAUSA" :
    s.status === "loading" ? "CARGANDO…" : "ERROR";

  return (
    <div
      style={{
        position: "fixed", left: 14, bottom: 14, zIndex: 9300,
        background: "rgba(20,16,12,0.88)", border: `1px solid ${statusColor}66`,
        borderRadius: 12, padding: 8, color: "#efe7d8",
        fontFamily: "inherit", backdropFilter: "blur(4px)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
      }}
    >
      <canvas
        ref={canvasRef}
        width={cw}
        height={ch}
        style={{ display: "block", borderRadius: 8, background: "#0d0b09", width: cw, height: ch }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7 }}>
        <span
          title="Indicador de cámara: encendida mientras el modo esté activo"
          style={{ width: 9, height: 9, borderRadius: 999, background: statusColor, boxShadow: `0 0 6px ${statusColor}` }}
        />
        <strong style={{ fontSize: presenter ? 15 : 11.5, letterSpacing: 0.6 }}>MUSA HANDS</strong>
        <span style={{
          fontSize: presenter ? 13 : 10, fontWeight: 700, padding: "1px 7px", borderRadius: 999,
          background: `${statusColor}22`, border: `1px solid ${statusColor}66`, color: statusColor,
        }}>
          {statusText}
        </span>
        <span style={{
          fontSize: presenter ? 12 : 9, padding: "1px 6px", borderRadius: 999,
          background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.4)", color: "#d8c9ff",
        }}>
          on-device
        </span>
        {s.fps > 0 && (
          <span style={{ fontSize: presenter ? 12 : 9.5, opacity: 0.65, fontFamily: "SF Mono, monospace" }}>
            {s.fps}fps{s.degraded ? " ·480p" : ""}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" title="Armar / pausar (también: ambas palmas 0.5s)" style={hudBtn} onClick={() => getActiveManager()?.toggleArm()}>
          {s.status === "armed" ? "⏸" : "▶"}
        </button>
        <button type="button" title="Cheat sheet" style={hudBtn} onClick={() => setCheatOpen((v) => !v)}>?</button>
        <button type="button" title="Ajustes y calibración" style={hudBtn} onClick={() => setSettingsOpen(true)}>⚙</button>
        <button type="button" title="Apagar (también: Esc)" style={hudBtn} onClick={onOff}>✕</button>
      </div>
      {(s.label || s.message) && (
        <div style={{ marginTop: 5, fontSize: presenter ? 16 : 11.5, minHeight: presenter ? 22 : 15, color: "#d8c9ff" }}>
          {s.label || s.message}
        </div>
      )}
      {cheatOpen && (
        <div style={{
          position: "absolute", left: 8, bottom: "100%", marginBottom: 8, width: 250,
          background: "rgba(20,16,12,0.96)", border: "1px solid rgba(200,184,152,0.35)",
          borderRadius: 10, padding: 10, fontSize: 11.5, lineHeight: 1.55,
        }}>
          <strong style={{ fontSize: 12 }}>Cheat sheet</strong>
          <div>☝️ apunta — cursor (el dedo es el mouse)</div>
          <div>🤏 pinch corto — click · sostenido + mover — arrastrar</div>
          <div>☝️ + 2ª mano pellizca — zoom</div>
          <div> palms 0.5s — armar / pausar</div>
          <div>✊ puño — descanso (nada pasa)</div>
          <div>✋ palma + mover — pan</div>
          <div>🤏 pinch + mover — mover capa</div>
          <div>✋✋ dos palmas ± — zoom</div>
          <div>✊→✋ play / stop del frame</div>
          <div>✌️ + vertical — scrub (en playback)</div>
          <div>✋ fling lateral — frame ◂ ▸</div>
        </div>
      )}
      {settingsOpen && <GestureSettings onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

const hudBtn = {
  background: "rgba(200,184,152,0.1)", border: "1px solid rgba(200,184,152,0.3)",
  color: "#efe7d8", borderRadius: 6, padding: "1px 7px", fontSize: 12,
  cursor: "pointer", lineHeight: 1.4,
} as const;

function drawHud(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const manager = getActiveManager();
  const video = manager?.getVideo();
  const presenter = getGestureState().presenter;

  // Mirrored preview (front camera should behave like a mirror).
  if (video && video.readyState >= 2) {
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.globalAlpha = 0.55;
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  const frame = getLatestFrame();
  if (!frame) return;
  const lw = presenter ? 3.5 : 2;
  for (const hand of frame.hands) {
    // Landmarks are normalized image coords; mirror X to match the preview.
    const px = (i: number) => (1 - hand.landmarks[i].x) * w;
    const py = (i: number) => hand.landmarks[i].y * h;
    ctx.strokeStyle = "#8b5cf6";
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (const [a, b] of EDGES) {
      ctx.moveTo(px(a), py(a));
      ctx.lineTo(px(b), py(b));
    }
    ctx.stroke();
    ctx.fillStyle = "#e9d5ff";
    for (let i = 0; i < hand.landmarks.length; i++) {
      const r = i === 4 || i === 8 ? (presenter ? 4.5 : 3) : presenter ? 3 : 2;
      ctx.beginPath();
      ctx.arc(px(i), py(i), r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Pinch indicator: ring around thumb+index midpoint, radius = distance.
    const mx = (px(4) + px(8)) / 2;
    const my = (py(4) + py(8)) / 2;
    const rr = Math.hypot(px(8) - px(4), py(8) - py(4)) + 6;
    ctx.strokeStyle = hand.pinch < 0.07 ? "#22c55e" : "rgba(233,213,255,0.8)";
    ctx.lineWidth = presenter ? 3 : 2;
    ctx.beginPath();
    ctx.arc(mx, my, Math.max(rr, 10), 0, Math.PI * 2);
    ctx.stroke();
  }
  if (frame.label && presenter) {
    ctx.fillStyle = "#d8c9ff";
    ctx.font = "700 20px inherit, sans-serif";
    ctx.fillText(frame.label, 10, h - 12);
  }
}
