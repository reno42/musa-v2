import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Pestaña del Inspector: id estable, etiqueta y badge opcional (conteo). */
export type InspectorTab = { id: string; label: string; badge?: number | string };

const MIN_WIDTH = 420;
const MAX_WIDTH = 1000;
const DEFAULT_WIDTH = 560;

function clampWidth(value: number) {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(value)));
}

function storedWidth(storageKey: string) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? clampWidth(parsed) : DEFAULT_WIDTH;
  } catch { return DEFAULT_WIDTH; }
}

/**
 * v56 — Panel lateral inspector, el contenedor único de las fichas del CRM
 * (Deal, Persona, Marca) y de los nodos del grafo (Second Brain). Reemplaza
 * al modal centrado para lectura en serie: el tablero queda visible detrás,
 * cierras y arrastras la siguiente tarjeta sin perder tu lugar.
 *
 * Redimensionable como el panel contextual del editor: arrastra el borde
 * izquierdo (420–1000px) y el ancho se recuerda por storageKey. Esc o click
 * en el velo cierran. En pantallas angostas ocupa el ancho completo.
 */
export function InspectorDrawer({
  open,
  onClose,
  ariaLabel,
  eyebrow,
  title,
  actions,
  tabs,
  activeTab,
  onTabChange,
  children,
  storageKey,
  /** true (default) = velo que bloquea el fondo y cierra al click (fichas
   *  del CRM). false = sin velo: el fondo queda clicable — el grafo Second
   *  Brain se explora con la ficha pinned, como en Obsidian. */
  veil = true,
}: {
  open: boolean;
  onClose: () => void;
  /** Nombre accesible del diálogo (role="dialog" aria-label). */
  ariaLabel: string;
  /** Línea superior de contexto: marca · campaña, o el tipo de nodo. */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Acciones a la derecha del título (abrir archivo, WhatsApp, …). */
  actions?: ReactNode;
  /** Pestañas opcionales — sin ellas el cuerpo ocupa todo el panel. */
  tabs?: InspectorTab[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
  children: ReactNode;
  /** Clave de localStorage para recordar el ancho elegido. */
  storageKey: string;
  veil?: boolean;
}) {
  const [width, setWidth] = useState(() => storedWidth(storageKey));
  const panelRef = useRef<HTMLElement>(null);
  const draggingRef = useRef(false);
  // Espejo del ancho para leerlo al soltar: el último frame de drag puede
  // quedar un píxel atrás, imperceptible y evita persistir en cada move.
  const widthRef = useRef(width);
  useEffect(() => { widthRef.current = width; }, [width]);

  // El ancho vive entre montajes: al abrir se lee el último elegido.
  useEffect(() => {
    if (open) setWidth(storedWidth(storageKey));
  }, [open, storageKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Resize por el borde izquierdo: pointer events cubren mouse y touch.
  const onResizeDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    draggingRef.current = true;
    const startX = event.clientX;
    const startWidth = width;
    const panel = panelRef.current;
    if (panel) panel.style.transition = "none";
    const onMove = (move: PointerEvent) => {
      if (!draggingRef.current) return;
      setWidth(clampWidth(startWidth + (startX - move.clientX)));
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      try { window.localStorage.setItem(storageKey, String(widthRef.current)); } catch { /* almacenamiento lleno o bloqueado: el ancho elegido vive solo en esta sesión */ }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [storageKey, width]);

  if (!open) return null;

  const panel = (
    <section
      ref={panelRef}
      className="inspector-panel"
      role="dialog"
      aria-modal={veil ? "true" : undefined}
      aria-label={ariaLabel}
      tabIndex={-1}
      style={{ width }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="inspector-resize" role="separator" aria-orientation="vertical" aria-label="Redimensionar panel" onPointerDown={onResizeDown} />
      <header className="inspector-head">
        <div className="inspector-heading">
          {eyebrow && <p className="inspector-eyebrow">{eyebrow}</p>}
          <div className="inspector-title-row">
            <h3 className="inspector-title">{title}</h3>
            {actions && <div className="inspector-actions">{actions}</div>}
          </div>
        </div>
        <button type="button" className="inspector-close" aria-label="Cerrar panel" onClick={onClose}>×</button>
      </header>
      {tabs && tabs.length > 0 && (
        <nav className="inspector-tabs" role="tablist" aria-label={`${ariaLabel}: secciones`}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === activeTab}
              className={`inspector-tab${tab.id === activeTab ? " active" : ""}`}
              onClick={() => onTabChange?.(tab.id)}
            >
              {tab.label}
              {tab.badge !== undefined && <span>{tab.badge}</span>}
            </button>
          ))}
        </nav>
      )}
      <div className="inspector-body">{children}</div>
    </section>
  );

  // Con velo (CRM): el click fuera cierra. Sin velo (grafo): el wrapper no
  // captura pointer events y el canvas sigue vivo detrás de la ficha.
  return createPortal(
    veil ? (
      <div className="inspector-overlay" onClick={onClose}>{panel}</div>
    ) : (
      <div className="inspector-free">{panel}</div>
    ),
    document.body
  );
}
