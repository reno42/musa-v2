/**
 * GestureSettings — the Musa Hands panel (REQ Gesture Mode §6
 * GestureSettings.tsx + §10-r4 wizard = earned onboarding).
 *
 * The calibration wizard teaches the 3 base gestures while it samples
 * (palm → pinch → stillness, ~10s): one step that calibrates AND onboard,
 * with an honest skip ("usar sensibilidad default" — available, not featured).
 * The litmus: first layer moved by pinch in under 90s from the toggle.
 *
 * PRIVACY copy is deliberate (§10-r4): processing is 100% on-device — not a
 * single frame ever leaves the browser. Say it where the user can see it.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getActiveManager } from "../lib/gesture/bridge";
import {
  computeCalibration,
  saveCalibration,
} from "../lib/gesture/calibration";
import {
  getGestureState,
  saveGestureSettings,
  subscribeGesture,
  getLatestFrame,
  type HudFrame,
} from "../lib/gesture/gestureStore";

const WIZARD_STEPS = [
  { key: "palm", seconds: 3.5, title: "Muestra la PALMA abierta", hint: "Mano abierta, dedos separados, a la altura del pecho" },
  { key: "pinch", seconds: 3.5, title: "Haz PINCH y sostenlo", hint: "Une pulgar e índice despacio y quédate ahí" },
  { key: "still", seconds: 2.5, title: "Mano quieta, sin pinch", hint: "Mide el temblor para calibrar el suavizado" },
] as const;

export function GestureSettings({ onClose }: { onClose: () => void }) {
  const s = useSyncExternalStore(subscribeGesture, getGestureState);
  const [wizardStep, setWizardStep] = useState<number | null>(null);
  const [wizardLeft, setWizardLeft] = useState(0);
  const [wizardDone, setWizardDone] = useState<string | null>(null);
  const samples = useRef({ pinchOpen: 0.02, pinchClosed: 0.4, stillness: 0.01, lastWrist: null as { x: number; y: number } | null, stillFrames: 0 });

  // Wizard sampler: reads the live (non-reactive) tracking frames.
  useEffect(() => {
    if (wizardStep === null) return;
    samples.current.lastWrist = null;
    samples.current.stillFrames = 0;
    samples.current.stillness = 0.01;
    const startedAt = performance.now();
    let raf = 0;
    const tick = () => {
      const step = WIZARD_STEPS[wizardStep];
      const left = Math.max(0, step.seconds * 1000 - (performance.now() - startedAt));
      setWizardLeft(Math.ceil(left / 1000));
      // The live feed comes from the store's non-reactive frame slot.
      const live = latestFrameRef.current;
      if (live && live.hands.length > 0) {
        const hand = live.hands[0];
        if (step.key === "palm") {
          samples.current.pinchOpen = Math.max(samples.current.pinchOpen, hand.pinch);
        } else if (step.key === "pinch") {
          samples.current.pinchClosed = Math.min(samples.current.pinchClosed, hand.pinch);
        } else {
          const wrist = hand.landmarks[0];
          const last = samples.current.lastWrist;
          if (last) {
            const d = Math.hypot(wrist.x - last.x, wrist.y - last.y);
            samples.current.stillFrames++;
            const n = samples.current.stillFrames;
            samples.current.stillness = samples.current.stillness + (d - samples.current.stillness) / n;
          }
          samples.current.lastWrist = { x: wrist.x, y: wrist.y };
        }
      }
      if (left <= 0) {
        if (wizardStep + 1 < WIZARD_STEPS.length) {
          setWizardStep(wizardStep + 1);
        } else {
          finishWizard();
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardStep]);

  // Non-reactive frame slot pumped into a ref: 30fps must never re-render.
  const latestFrameRef = useRef<HudFrame | null>(null);
  useEffect(() => {
    let raf = 0;
    const pump = () => {
      latestFrameRef.current = getLatestFrame();
      raf = requestAnimationFrame(pump);
    };
    raf = requestAnimationFrame(pump);
    return () => cancelAnimationFrame(raf);
  }, []);

  const finishWizard = () => {
    const s2 = samples.current;
    const profile = computeCalibration("default", {
      pinchOpen: s2.pinchOpen,
      pinchClosed: Math.min(s2.pinchClosed, s2.pinchOpen * 0.8),
      stillness: s2.stillness,
    });
    saveCalibration(profile);
    getActiveManager()?.applyProfile(profile);
    setWizardStep(null);
    setWizardDone(`Calibrado: pinch ${(profile.pinchGrab * 100).toFixed(1)}% · suavizado ${profile.minCutoff.toFixed(2)}`);
    getActiveManager()?.arm();
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9500, background: "rgba(10,8,6,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 400, maxHeight: "80vh", overflowY: "auto", background: "#191410",
          border: "1px solid rgba(200,184,152,0.35)", borderRadius: 12, padding: 18,
          color: "#efe7d8", fontFamily: "inherit", boxShadow: "0 18px 50px rgba(0,0,0,0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <strong style={{ fontSize: 15 }}>Musa Hands</strong>
          <button type="button" onClick={onClose} title="Cerrar" style={btnGhost}>✕</button>
        </div>

        {s.status === "error" && (
          <div style={{ ...noteBox, borderColor: "rgba(239,68,68,0.5)", color: "#fecaca" }}>
            {s.message}
          </div>
        )}

        {wizardStep !== null ? (
          <div style={{ ...noteBox, marginBottom: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              Paso {wizardStep + 1}/{WIZARD_STEPS.length}: {WIZARD_STEPS[wizardStep].title} — {wizardLeft}s
            </div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>{WIZARD_STEPS[wizardStep].hint}</div>
            <div style={{ marginTop: 8, height: 6, borderRadius: 3, background: "rgba(200,184,152,0.15)" }}>
              <div style={{
                height: 6, borderRadius: 3, background: "#8b5cf6", transition: "width 200ms linear",
                width: `${100 - (wizardLeft / WIZARD_STEPS[wizardStep].seconds) * 100}%`,
              }} />
            </div>
            <button type="button" style={{ ...btnGhost, marginTop: 10 }} onClick={() => setWizardStep(null)}>
              Cancelar — usar sensibilidad default
            </button>
          </div>
        ) : (
          <>
            {wizardDone && <div style={{ ...noteBox, marginBottom: 12, color: "#bbf7d0" }}>{wizardDone}</div>}
            <button type="button" style={{ ...btnMain, marginBottom: 14 }} onClick={() => setWizardStep(0)}>
              Recalibrar (~10s — enseña los 3 gestos base)
            </button>
          </>
        )}

        <label style={row}>
          <span>Sensibilidad</span>
          <input
            type="range" min={0.2} max={1.5} step={0.05} value={s.sensitivity}
            onChange={(e) => saveGestureSettings({ sensitivity: Number(e.target.value) })}
          />
          <span style={{ minWidth: 34, textAlign: "right", fontFamily: "SF Mono, monospace", fontSize: 11 }}>{s.sensitivity.toFixed(2)}</span>
        </label>
        <label style={row}>
          <input type="checkbox" checked={s.hudVisible} onChange={(e) => saveGestureSettings({ hudVisible: e.target.checked })} />
          <span>Mostrar HUD (esqueleto y estado)</span>
        </label>
        <label style={row}>
          <input type="checkbox" checked={s.presenter} onChange={(e) => saveGestureSettings({ presenter: e.target.checked })} />
          <span>Modo presentador (HUD grande para grabar)</span>
        </label>
        <label style={row}>
          <input
            type="checkbox"
            checked={s.cursor}
            onChange={(e) => {
              saveGestureSettings({ cursor: e.target.checked });
              getActiveManager()?.setCursorMode(e.target.checked);
            }}
          />
          <span>Modo cursor — ☝️ índice = mouse · 🤏 pinch = click</span>
        </label>

        <div style={{ ...sectionTitle }}>Gestos · con su equivalente de teclado</div>
        <table style={table}>
          <tbody>
            <tr><td>☝️ Apuntar</td><td>Mover el cursor (el dedo es el mouse)</td><td>mouse</td></tr>
            <tr><td>🤏 Pinch corto</td><td>Click donde apunta (botones, tools)</td><td>click</td></tr>
            <tr><td>🤏 Pinch + mover</td><td>Arrastrar — dibuja con la tool activa</td><td>drag</td></tr>
            <tr><td>☝️ + 🤏 2ª mano</td><td>Zoom continuo (pellizca el aire)</td><td>ctrl+scroll</td></tr>
            <tr><td>Palmas 0.5s</td><td>Armar / pausar el modo</td><td>botón “Manos”</td></tr>
            <tr><td>Puño</td><td>Descanso (nada pasa)</td><td>—</td></tr>
            <tr><td>Palma + mover</td><td>Pan del lienzo</td><td>scroll / espacio+drag</td></tr>
            <tr><td>Pinch + mover</td><td>Mover la capa seleccionada</td><td>drag</td></tr>
            <tr><td>2 palmas ±</td><td>Zoom del lienzo</td><td>ctrl+scroll / + −</td></tr>
            <tr><td>Puño→palma</td><td>Play / stop del frame</td><td>panel Animación</td></tr>
            <tr><td>Victory + vertical</td><td>Scrub del playhead (en playback)</td><td>timeline</td></tr>
            <tr><td>Palma fling lateral</td><td>Frame anterior / siguiente</td><td>PgUp / PgDn</td></tr>
          </tbody>
        </table>

        <div style={{ ...noteBox, marginTop: 14, borderColor: "rgba(139,92,246,0.45)" }}>
          <strong>Privacidad:</strong> tus manos nunca salen de tu compu — el video se procesa
          100% en tu navegador (MediaPipe on-device) y cada frame se descarta. El HUD lleva el
          indicador de cámara por honestidad.
        </div>
        <div style={{ fontSize: 11, opacity: 0.65, marginTop: 8 }}>
          Primera activación descarga ~8 MB del modelo, una sola vez. Esc apaga todo.
        </div>
      </div>
    </div>
  );
}

const btnGhost = {
  background: "transparent", border: "1px solid rgba(200,184,152,0.3)", color: "#efe7d8",
  borderRadius: 6, padding: "3px 8px", fontSize: 12, cursor: "pointer",
} as const;

const btnMain = {
  width: "100%", background: "rgba(139,92,246,0.2)", border: "1px solid rgba(139,92,246,0.5)",
  color: "#d8c9ff", borderRadius: 8, padding: "8px 10px", fontSize: 13, cursor: "pointer",
} as const;

const row = {
  display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 8,
} as const;

const noteBox = {
  border: "1px solid rgba(200,184,152,0.3)", borderRadius: 8, padding: "8px 10px",
  fontSize: 12, lineHeight: 1.5, marginBottom: 10,
} as const;

const sectionTitle = {
  fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, opacity: 0.6,
  margin: "12px 0 6px",
} as const;

const table = {
  width: "100%", fontSize: 11.5, borderCollapse: "collapse" as const,
};
