/**
 * OnboardingTour — guided product tour with spotlight overlay.
 *
 * Everything is dimmed except the element being explained (spotlight via a
 * giant box-shadow cutout). A floating card shows the step text plus a
 * checklist of all steps so the user sees how much is left. Progress is
 * persisted in localStorage, so the tour survives the dashboard → editor
 * page switch mid-tour. Can be toggled/restarted from Settings.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// ── Persistence ──
const KEY_ENABLED = "futuraria-tour-enabled";
const KEY_DONE = "futuraria-tour-done";
const KEY_STEP = "futuraria-tour-step";

export function isOnboardingEnabled(): boolean {
  return localStorage.getItem(KEY_ENABLED) !== "0";
}
export function setOnboardingEnabled(on: boolean) {
  localStorage.setItem(KEY_ENABLED, on ? "1" : "0");
  window.dispatchEvent(new Event("futuraria-tour-changed"));
}
export function isOnboardingDone(): boolean {
  return localStorage.getItem(KEY_DONE) === "1";
}
export function restartOnboarding() {
  localStorage.setItem(KEY_ENABLED, "1");
  localStorage.removeItem(KEY_DONE);
  localStorage.setItem(KEY_STEP, "0");
  window.dispatchEvent(new Event("futuraria-tour-changed"));
}

export type TourAction = "tab-templates" | "tab-graph" | "open-first-template" | "back-to-dashboard" | "show-layers" | "show-props";
type TourPage = "dashboard" | "editor";

interface TourStep {
  id: string;
  page: TourPage;
  /** CSS selector to spotlight; null = centered modal, no spotlight. */
  target: string | null;
  title: string;
  body: string;
  /** Short label for the progress checklist. */
  label: string;
  /** Action the host must run when ENTERING this step (switch tab, etc). */
  onEnter?: TourAction;
  /** Extra content flag: renders the copyable AI prompt block. */
  aiPrompt?: boolean;
}

const STEPS: TourStep[] = [
  {
    id: "welcome", page: "dashboard", target: null, label: "Qué es Futuraria",
    title: "Bienvenido a Futuraria 👋",
    body: "Tu workspace de diseño open-source. Aquí creas diseños en HTML/CSS reales — posts, banners, decks — y lo especial: tu IA (Claude, u otro agente MCP) puede diseñar contigo dentro del editor, en vivo.",
  },
  {
    id: "templates", page: "dashboard", target: "[data-tour='templates-grid']", label: "Tus templates",
    title: "Aquí viven tus diseños",
    body: "Cada card es un template. Haz click en cualquiera para abrirlo en el editor. Con el botón + New creas uno desde cero. Al pulsar Siguiente abriremos uno para mostrarte el editor.",
    onEnter: "tab-templates",
  },
  {
    id: "canvas", page: "editor", target: "[data-tour='editor-canvas']", label: "El lienzo",
    title: "El lienzo infinito",
    body: "Aquí diseñas. Arrastra el fondo para moverte, usa la rueda o el trackpad para hacer zoom, click en un elemento para seleccionarlo y doble click en un texto para editarlo. Cada rectángulo grande es un frame (un diseño).",
  },
  {
    id: "toolbar", page: "editor", target: "[data-tour='editor-toolbar']", label: "Herramientas",
    title: "La barra de herramientas",
    body: "V selecciona, F crea frames, T texto, y tienes figuras, pluma bezier y más. Abajo están zoom y deshacer/rehacer (Ctrl+Z / Ctrl+Shift+Z). Desde aquí también muestras u ocultas los paneles de Código y Capas.",
  },
  {
    id: "layers", page: "editor", target: "[data-tour='editor-layers']", label: "Panel de capas",
    title: "Capas",
    body: "La jerarquía de tu diseño: frames, grupos y elementos. Reordena arrastrando, agrupa con Ctrl+G y desagrupa con Ctrl+Shift+G. Puedes ocultarlo desde la barra de herramientas.",
    onEnter: "show-layers",
  },
  {
    id: "props", page: "editor", target: "[data-tour='editor-props']", label: "Propiedades",
    title: "Panel de propiedades",
    body: "Al seleccionar un elemento, aquí editas sus colores, tipografía, bordes, sombras, tipo de grupo y más. Todo lo que cambias es CSS real — lo que ves es lo que exportas.",
    onEnter: "show-props",
  },
  {
    id: "ai", page: "editor", target: "[data-tour='editor-canvas']", label: "Diseña con tu IA",
    title: "Pídele el diseño a tu IA ✨",
    body: "Esto es lo que hace única a Futuraria: copia este prompt, pégaselo a tu agente (Claude Code, Cursor, etc.) y mira cómo el diseño cambia en vivo en este lienzo mientras la IA trabaja vía MCP.",
    aiPrompt: true,
  },
  {
    id: "graph", page: "dashboard", target: "[data-tour='graph-view']", label: "El Grafo (obsidian)",
    title: "Tu obsidian de diseño 🪐",
    body: "Cada orbe es un diseño; se conectan entre sí por marca y por tags, como en Obsidian. Arrastra los orbes para reacomodarlos, pasa el mouse para ver vecinos y haz click en uno para abrirlo. Sirve para ver tu sistema de diseño completo de un vistazo.",
    onEnter: "tab-graph",
  },
  {
    id: "done", page: "dashboard", target: null, label: "Listo",
    title: "¡Eso es todo! 🎉",
    body: "Ya conoces la plataforma. Puedes volver a ver este tour cuando quieras (o desactivarlo) desde Settings → Onboarding. Ahora: crea algo, o mejor — dile a tu IA que lo cree contigo.",
  },
];

/** Transition steps: leaving step N requires this action to reach step N+1's page. */
const EXIT_ACTIONS: Record<string, TourAction> = {
  templates: "open-first-template",
  ai: "back-to-dashboard",
};

interface Props {
  page: TourPage;
  onAction?: (action: TourAction) => void;
}

export function OnboardingTour({ page, onAction }: Props) {
  const [step, setStep] = useState<number>(() => {
    const s = parseInt(localStorage.getItem(KEY_STEP) || "0", 10);
    return Number.isFinite(s) ? Math.min(Math.max(s, 0), STEPS.length - 1) : 0;
  });
  const [active, setActive] = useState<boolean>(() => isOnboardingEnabled() && !isOnboardingDone());
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [copied, setCopied] = useState(false);
  const enteredRef = useRef<string | null>(null);

  // React to Settings toggle / restart from anywhere
  useEffect(() => {
    const sync = () => {
      setActive(isOnboardingEnabled() && !isOnboardingDone());
      const s = parseInt(localStorage.getItem(KEY_STEP) || "0", 10);
      if (Number.isFinite(s)) setStep(Math.min(Math.max(s, 0), STEPS.length - 1));
    };
    window.addEventListener("futuraria-tour-changed", sync);
    return () => window.removeEventListener("futuraria-tour-changed", sync);
  }, []);

  const current = STEPS[step];
  const visible = active && current.page === page;

  // Run the step's onEnter host action (switch tab) exactly once per step
  useEffect(() => {
    if (!visible) return;
    if (current.onEnter && enteredRef.current !== current.id) {
      enteredRef.current = current.id;
      onAction?.(current.onEnter);
    }
  }, [visible, current, onAction]);

  // Track the target rect (layout shifts, panel docking, tab switches)
  useEffect(() => {
    if (!visible) { setRect(null); return; }
    if (!current.target) { setRect(null); return; }
    let raf = 0;
    const measure = () => {
      const el = document.querySelector(current.target!);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect(prev =>
          prev && Math.abs(prev.left - r.left) < 1 && Math.abs(prev.top - r.top) < 1 &&
          Math.abs(prev.width - r.width) < 1 && Math.abs(prev.height - r.height) < 1 ? prev : r);
      } else {
        setRect(null);
      }
    };
    measure();
    const iv = setInterval(measure, 350);
    const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      clearInterval(iv);
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [visible, current]);

  const persistStep = (n: number) => {
    localStorage.setItem(KEY_STEP, String(n));
    setStep(n);
    setCopied(false);
  };

  const finish = useCallback(() => {
    localStorage.setItem(KEY_DONE, "1");
    setActive(false);
  }, []);

  const next = () => {
    const exit = EXIT_ACTIONS[current.id];
    if (step >= STEPS.length - 1) { finish(); return; }
    persistStep(step + 1);
    // Fire the page transition AFTER persisting so the other page's
    // instance picks the tour up at the right step.
    if (exit) onAction?.(exit);
  };
  const back = () => { if (step > 0) persistStep(step - 1); };

  if (!visible) return null;

  // ── AI prompt block content ──
  const tplId = new URLSearchParams(window.location.search).get("template") || "TU_TEMPLATE_ID";
  const aiPromptText =
    `Conéctate al MCP de Futuraria en ${window.location.origin}/mcp (header x-api-key) ` +
    `y mejora el diseño del template ${tplId}: dale una paleta más atrevida, un titular grande ` +
    `y mejor jerarquía tipográfica. Usa get_template para leerlo. Para generar la composición usa ` +
    `set_frame_layers: entrega cada texto, imagen, botón, SVG y figura como una capa hermana independiente ` +
    `con id, name, kind, x, y, width y height. No envuelvas objetos en divs ni grupos; usa grupos solo si ` +
    `son una decisión explícita del diseño. Para material de trabajo que debe quedar fuera de los frames usa ` +
    `set_canvas_layers; esas capas llevan frameId null y no aparecen en las exportaciones. Para retoques posteriores ` +
    `usa las herramientas quirúrgicas por layer-id.`;

  const copyPrompt = () => {
    navigator.clipboard?.writeText(aiPromptText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ── Popup placement: below target if it fits, above otherwise, else centered ──
  const CARD_W = 400;
  let cardStyle: React.CSSProperties;
  if (rect) {
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow > 320 ? rect.bottom + 14 : Math.max(14, rect.top - 14 - 320);
    const left = Math.min(Math.max(14, rect.left + rect.width / 2 - CARD_W / 2), window.innerWidth - CARD_W - 14);
    cardStyle = { position: "fixed", top, left, width: CARD_W };
  } else {
    cardStyle = { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: CARD_W };
  }

  return createPortal(
    <>
      {/* Spotlight: dim everything except the target via a huge box-shadow */}
      {rect ? (
        <div style={{
          position: "fixed",
          top: rect.top - 6, left: rect.left - 6,
          width: rect.width + 12, height: rect.height + 12,
          borderRadius: 12,
          boxShadow: "0 0 0 200vmax rgba(4, 4, 14, 0.78)",
          border: "1.5px solid rgba(139, 92, 246, 0.9)",
          zIndex: 9998, pointerEvents: "none",
          transition: "all 0.35s cubic-bezier(0.22, 1, 0.36, 1)",
        }} />
      ) : (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(4, 4, 14, 0.78)",
          zIndex: 9998, pointerEvents: "none", transition: "background 0.35s ease",
        }} />
      )}

      {/* Step card */}
      <div className="liquid-glass" style={{
        ...cardStyle, zIndex: 9999, borderRadius: 18, padding: 22,
        background: "rgba(18, 16, 34, 0.92)", backdropFilter: "blur(18px)",
        border: "1px solid rgba(139, 92, 246, 0.35)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        color: "#fff", maxWidth: "calc(100vw - 28px)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#a78bfa", letterSpacing: "0.06em" }}>
            PASO {step + 1} DE {STEPS.length}
          </span>
          <button type="button" onClick={finish}
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: 11, cursor: "pointer", padding: 4 }}>
            Saltar tour ✕
          </button>
        </div>

        <h3 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 8px" }}>{current.title}</h3>
        <p style={{ fontSize: 13, lineHeight: 1.55, color: "rgba(255,255,255,0.75)", margin: "0 0 14px" }}>{current.body}</p>

        {current.aiPrompt && (
          <div style={{ marginBottom: 14 }}>
            <div style={{
              fontSize: 11.5, fontFamily: "monospace", lineHeight: 1.5,
              background: "rgba(0,0,0,0.45)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 10, padding: "10px 12px", color: "#c4b5fd",
              maxHeight: 110, overflowY: "auto",
            }}>
              {aiPromptText}
            </div>
            <button type="button" onClick={copyPrompt} style={{
              marginTop: 8, borderRadius: 100, padding: "6px 14px", fontSize: 12, fontWeight: 600,
              border: "1px solid rgba(139,92,246,0.5)", cursor: "pointer",
              background: copied ? "rgba(52,211,153,0.2)" : "rgba(139,92,246,0.2)",
              color: copied ? "#6ee7b7" : "#c4b5fd",
            }}>
              {copied ? "✓ Copiado" : "Copiar prompt"}
            </button>
          </div>
        )}

        {/* Progress checklist */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px",
          padding: "10px 12px", borderRadius: 12, background: "rgba(255,255,255,0.04)", marginBottom: 14,
        }}>
          {STEPS.map((s, i) => (
            <div key={s.id} style={{
              display: "flex", alignItems: "center", gap: 6, fontSize: 11,
              color: i < step ? "#6ee7b7" : i === step ? "#fff" : "rgba(255,255,255,0.35)",
              fontWeight: i === step ? 600 : 400,
            }}>
              <span style={{
                width: 13, height: 13, borderRadius: 4, flexShrink: 0,
                display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9,
                border: i < step ? "1px solid #34d399" : i === step ? "1px solid #a78bfa" : "1px solid rgba(255,255,255,0.2)",
                background: i < step ? "rgba(52,211,153,0.2)" : "transparent",
              }}>
                {i < step ? "✓" : ""}
              </span>
              {s.label}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <button type="button" onClick={back} disabled={step === 0} style={{
            borderRadius: 100, padding: "8px 18px", fontSize: 12.5, fontWeight: 600,
            border: "1px solid rgba(255,255,255,0.15)", cursor: step === 0 ? "default" : "pointer",
            background: "transparent", color: step === 0 ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.7)",
          }}>
            ← Atrás
          </button>
          <button type="button" onClick={next} style={{
            borderRadius: 100, padding: "8px 22px", fontSize: 12.5, fontWeight: 700,
            border: "none", cursor: "pointer",
            background: "linear-gradient(135deg, #8b5cf6, #6d28d9)", color: "#fff",
          }}>
            {step === 0 ? "Empezar" : step === STEPS.length - 1 ? "Finalizar" : "Siguiente →"}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
