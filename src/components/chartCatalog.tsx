/**
 * chartCatalog — catálogo de formatos visuales (lado cliente).
 *
 * REQ "Planilla de Contenidos v2": el dropdown de "Tipo de gráfico" muestra
 * la ESTRUCTURA del tipo, no un diseño terminado — un timeline con hitos
 * genéricos, una matriz 2x2 vacía. El mensaje: "si tu copy habla de 10 etapas
 * y eliges timeline, la IA lo hará con 10 etapas — el preview enseña la
 * gramática, no el resultado."
 *
 * Las mismas recetas existen server-side (netlify/functions/chart-builder.mjs,
 * tool MCP create_chart). Este catálogo es el vocabulario compartido: key,
 * etiqueta y regla de cuándo usarlo (esa regla es la que la IA aplica cuando
 * `visualType` va vacío). Sin emojis — los previews son SVG inline.
 */

import { useEffect, useRef, useState,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";

export type ChartTypeKey =
  | "timeline" | "mindmap" | "journey" | "versus" | "matrix2x2"
  | "statgrid" | "storyarc" | "donut" | "vbars" | "hbars" | "line";

export interface ChartTypeDef {
  key: ChartTypeKey;
  label: string;
  /** Regla de cuándo usarlo — alimenta la sugerencia de la IA (visualType vacío). */
  useWhen: string;
  group: "knowledge" | "data";
}

export const CHART_TYPES: ChartTypeDef[] = [
  { key: "timeline", label: "Timeline", useWhen: "Procesos, roadmap, evolución en etapas (N etapas = N nodos)", group: "knowledge" },
  { key: "mindmap", label: "Mind map", useWhen: "Concepto central con ramas: sistema, taxonomy, ecosistema", group: "knowledge" },
  { key: "journey", label: "Journey / proceso", useWhen: "Experiencia paso a paso numerada", group: "knowledge" },
  { key: "versus", label: "Comparativa", useWhen: "A vs B, antes/después, atributo por atributo", group: "knowledge" },
  { key: "matrix2x2", label: "Matriz 2×2", useWhen: "Posicionamiento, frameworks, cuadrantes", group: "knowledge" },
  { key: "storyarc", label: "Story arc (3 tandas)", useWhen: "Serie narrativa: historia → técnico → empresa", group: "knowledge" },
  { key: "statgrid", label: "Cifras clave", useWhen: "KPIs agrupados: 2–4 stats duros", group: "data" },
  { key: "donut", label: "Donut", useWhen: "Split de % (máx 5 segmentos, Σ = 100%)", group: "data" },
  { key: "vbars", label: "Barras verticales", useWhen: "Proyecciones, crecimiento por período (máx 7)", group: "data" },
  { key: "hbars", label: "Barras horizontales", useWhen: "Jerarquías anidadas, TAM/SAM/SOM", group: "data" },
  { key: "line", label: "Línea", useWhen: "Curva de tracción, series temporales", group: "data" },
];

export const chartTypeByKey = (key: string | null | undefined): ChartTypeDef | undefined =>
  CHART_TYPES.find(t => t.key === key);

const ACCENT = "#d2ff02";
const VIOLET = "#854be8";
const STROKE = "#52525b";

/** Preview esquemático — la gramática del tipo, no un resultado. Base 64×44,
 *  escalable vía `width` (el SVG escala limpio por el viewBox). */
export function ChartTypePreview({ type, width = 64 }: { type: ChartTypeKey; width?: number }) {
  const common = { width, height: Math.round((width * 44) / 64), viewBox: "0 0 64 44", fill: "none" as const };
  switch (type) {
    case "timeline":
      return (
        <svg {...common} aria-hidden>
          <line x1="6" y1="22" x2="58" y2="22" stroke={STROKE} strokeWidth="1.5" />
          <line x1="6" y1="22" x2="34" y2="22" stroke={ACCENT} strokeWidth="1.5" />
          {[14, 26, 38, 50].map((x, i) => (
            <circle key={x} cx={x} cy="22" r="3" fill={i < 2 ? ACCENT : "#0a0a0a"} stroke={ACCENT} strokeWidth="1.5" />
          ))}
          <rect x="8" y="6" width="16" height="8" rx="2" stroke={STROKE} />
          <rect x="40" y="30" width="16" height="8" rx="2" stroke={STROKE} />
        </svg>
      );
    case "mindmap":
      return (
        <svg {...common} aria-hidden>
          <rect x="3" y="14" width="18" height="16" rx="3" fill={ACCENT} />
          <path d="M21 22 H30 M30 22 V8 M30 22 V22 M30 22 V36" stroke={STROKE} />
          {[6, 18, 30].map(y => (
            <g key={y}>
              <line x1="30" y1={y === 6 ? 8 : y === 18 ? 22 : 36} x2="38" y2={y} stroke={STROKE} />
              <rect x="38" y={y - 4} width="22" height="8" rx="2" stroke={STROKE} />
            </g>
          ))}
        </svg>
      );
    case "journey":
      return (
        <svg {...common} aria-hidden>
          <line x1="6" y1="12" x2="58" y2="12" stroke={STROKE} strokeWidth="1.5" />
          {[10, 24, 38, 54].map((x, i) => (
            <g key={x}>
              <circle cx={x} cy="12" r="3.5" fill="#0a0a0a" stroke={ACCENT} strokeWidth="1.5" />
              <rect x={x - 6} y="22" width="12" height="14" rx="2" stroke={STROKE} />
            </g>
          ))}
        </svg>
      );
    case "versus":
      return (
        <svg {...common} aria-hidden>
          <rect x="4" y="4" width="24" height="8" rx="4" fill={ACCENT} />
          <rect x="36" y="4" width="24" height="8" rx="4" fill={VIOLET} />
          <text x="32" y="12" fill={STROKE} fontSize="7" textAnchor="middle" fontWeight="700">VS</text>
          {[18, 27, 36].map(y => (
            <g key={y}>
              <rect x="4" y={y} width="24" height="6" rx="2" stroke={STROKE} />
              <rect x="36" y={y} width="24" height="6" rx="2" stroke={STROKE} />
            </g>
          ))}
        </svg>
      );
    case "matrix2x2":
      return (
        <svg {...common} aria-hidden>
          <rect x="14" y="4" width="44" height="36" stroke={STROKE} />
          <line x1="36" y1="4" x2="36" y2="40" stroke={STROKE} />
          <line x1="14" y1="22" x2="58" y2="22" stroke={STROKE} />
          <circle cx="25" cy="13" r="3" fill={ACCENT} />
          <circle cx="47" cy="31" r="3" fill={VIOLET} />
        </svg>
      );
    case "statgrid":
      return (
        <svg {...common} aria-hidden>
          {[4, 16, 28].map(y => (
            <g key={y}>
              <rect x="4" y={y} width="56" height="10" rx="2" stroke={STROKE} />
              <text x="9" y={y + 8} fill={ACCENT} fontSize="7" fontWeight="800">87</text>
            </g>
          ))}
        </svg>
      );
    case "storyarc":
      return (
        <svg {...common} aria-hidden>
          {[3, 24, 45].map((x, i) => (
            <g key={x}>
              <rect x={x} y="8" width="16" height="28" rx="3" stroke={STROKE} />
              <text x={x + 8} y="20" fill={ACCENT} fontSize="6" textAnchor="middle" fontWeight="800">{i + 1}</text>
            </g>
          ))}
          <path d="M20 22 h3 M41 22 h3 M38 19 l3 3 -3 3 M59 19 l-3 3 3 3" stroke={ACCENT} strokeWidth="1.2" fill="none" />
        </svg>
      );
    case "donut":
      return (
        <svg {...common} aria-hidden>
          <circle cx="20" cy="22" r="13" stroke={ACCENT} strokeWidth="6" strokeDasharray="52 82" fill="none" transform="rotate(-90 20 22)" />
          <circle cx="20" cy="22" r="13" stroke={VIOLET} strokeWidth="6" strokeDasharray="30 82" strokeDashoffset="-52" fill="none" transform="rotate(-90 20 22)" />
          <circle cx="20" cy="22" r="7" fill="#0a0a0a" />
          {[10, 19, 28].map((y, i) => (
            <g key={y}>
              <rect x="42" y={y} width="5" height="5" rx="1" fill={i === 0 ? ACCENT : i === 1 ? VIOLET : STROKE} />
              <rect x="50" y={y + 1} width="10" height="3" rx="1" fill={STROKE} />
            </g>
          ))}
        </svg>
      );
    case "vbars":
      return (
        <svg {...common} aria-hidden>
          <line x1="4" y1="40" x2="60" y2="40" stroke={STROKE} />
          {[[10, 22, false], [22, 14, false], [34, 28, true], [46, 10, false]].map(([x, y, hi], i) => (
            <g key={i}>
              <rect x={x as number} y={y as number} width="8" height={40 - (y as number)} rx="1.5"
                fill={hi ? ACCENT : "#26262b"} stroke={hi ? ACCENT : STROKE} />
            </g>
          ))}
        </svg>
      );
    case "hbars":
      return (
        <svg {...common} aria-hidden>
          {[[4, ACCENT, 52], [16, VIOLET, 36], [28, STROKE, 24]].map(([y, c, w], i) => (
            <g key={i}>
              <rect x="4" y={y as number} width="56" height="8" rx="4" stroke={STROKE} />
              <rect x="4" y={y as number} width={w as number} height="8" rx="4" fill={c as string} />
            </g>
          ))}
        </svg>
      );
    case "line":
      return (
        <svg {...common} aria-hidden>
          <path d="M4 38 C14 36 22 32 30 26 S50 12 60 8" stroke={ACCENT} strokeWidth="2" fill="none" />
          <path d="M4 38 C14 36 22 32 30 26 S50 12 60 8 L60 42 L4 42 Z" fill="rgba(210,255,2,0.08)" stroke="none" />
          <circle cx="30" cy="26" r="2.5" fill="#0a0a0a" stroke={ACCENT} strokeWidth="1.5" />
          <circle cx="60" cy="8" r="3" fill="#0a0a0a" stroke={ACCENT} strokeWidth="1.5" />
        </svg>
      );
  }
}

/** Check del ítem activo — mismo gesto que el CrmSelect del kit. */
function ChartTypeCheck() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={ACCENT}
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden
      style={{ flexShrink: 0 }}>
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  );
}

const CHIP: CSSProperties = {
  flexShrink: 0, display: "inline-flex", padding: 2, background: "#0a0a0a",
  border: "1px solid rgba(255,255,255,0.14)", borderRadius: 6,
};

/** Dropdown del catálogo para la planilla: el <select> nativo no admite
 *  previews dentro de sus options, así que el menú es propio — mismo contrato
 *  que CrmSelect (portal a body, ancla fixed al trigger, cierra con click
 *  fuera, Escape, scroll o resize; cerca del borde de abajo abre hacia
 *  arriba). Cada fila lleva su esquema para reconocer el formato al toque;
 *  vacío = la IA elige. */
export function ChartTypeSelect({ value, onChange, ariaLabel = "Tipo de gráfico" }: {
  value: string | null | undefined;
  onChange: (next: ChartTypeKey | null) => void;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const current = chartTypeByKey(value);

  useEffect(() => {
    if (!open) return;
    // Ancla fixed al rectángulo del trigger (el overflow del scroll horizontal
    // de la tabla recortaría un menú absoluto). Si no cabe abajo, abre arriba.
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const openUp = window.innerHeight - rect.bottom < 360 && rect.top > 380;
      setMenuPos({
        top: openUp ? Math.max(8, rect.top - 352) : rect.bottom + 4,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 260)),
      });
    }
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    };
    // El capture de window ve TAMBIÉN el scroll interno del menú: ese no
    // cierra — es el usuario leyendo las opciones. Solo el scroll del contenido
    // de debajo (el ancla se movió) y el resize cierran.
    const onMove = (event: Event) => {
      const target = event.target as Node | null;
      if (event.type === "scroll" && target instanceof Node
        && (menuRef.current?.contains(target) || rootRef.current?.contains(target))) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  // Flechas mueven el foco entre opciones — el mismo gesto de CrmSelect.
  const menuKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="option"]'));
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? Math.min(items.length - 1, index + 1) : Math.max(0, index - 1);
    items[next]?.focus();
  };

  const pick = (next: ChartTypeKey | null) => {
    onChange(next);
    setOpen(false);
    setHoverKey(null);
    triggerRef.current?.focus();
  };

  const rowStyle = (selected: boolean, hovered: boolean): CSSProperties => ({
    display: "flex", alignItems: "center", gap: 8, width: "100%",
    padding: "5px 8px", border: "none", borderRadius: 6, cursor: "pointer",
    fontFamily: "inherit", textAlign: "left",
    background: selected ? "rgba(210,255,2,0.10)" : hovered ? "rgba(255,255,255,0.08)" : "transparent",
  });

  return (
    <div ref={rootRef} style={{ display: "flex", minWidth: 0 }}>
      {/* El trigger ES el preview: con tipo elegido muestra su esquema, así la
          fila se reconoce de un vistazo sin abrir el menú. */}
      <button
        ref={triggerRef} type="button"
        aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}
        title={current ? current.useWhen : "Vacío = la IA elige el formato; lleno = la IA obedece el tipo"}
        onClick={() => setOpen(v => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 6, width: "100%", minHeight: 31,
          padding: "2px 6px", fontSize: 12, fontFamily: "inherit",
          color: "#fff", background: "#000",
          border: "1px solid rgba(255,255,255,0.18)", cursor: "pointer",
        }}
      >
        {current ? (
          <span style={CHIP}><ChartTypePreview type={current.key} width={36} /></span>
        ) : null}
        <span style={{
          flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap", textAlign: "left",
          color: current ? "#fff" : "rgba(255,255,255,0.45)",
        }}>
          {current ? current.label : "(IA elige)"}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 6" fill="none" aria-hidden style={{ flexShrink: 0 }}>
          <path d="M1 1l4 4 4-4" stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && createPortal(
        <ul
          ref={menuRef} role="listbox" aria-label={ariaLabel} onKeyDown={menuKeyDown}
          style={{
            position: "fixed", top: menuPos.top, left: menuPos.left, zIndex: 200,
            margin: 0, padding: 4, listStyle: "none",
            minWidth: 248, maxHeight: 340, overflowY: "auto",
            background: "#101319", border: "1px solid rgba(255,255,255,0.22)",
            borderRadius: 10, boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
          }}
        >
          <li>
            <button
              type="button" role="option" aria-selected={!current}
              onMouseEnter={() => setHoverKey("")} onMouseLeave={() => setHoverKey(null)}
              onClick={() => pick(null)}
              style={rowStyle(!current, hoverKey === "")}
            >
              <span style={{
                flex: 1, fontSize: 12, fontStyle: "italic",
                color: current ? "rgba(255,255,255,0.55)" : "#fff",
              }}>(IA elige)</span>
              {!current && <ChartTypeCheck />}
            </button>
          </li>
          {CHART_TYPES.map(t => (
            <li key={t.key}>
              <button
                type="button" role="option" aria-selected={t.key === current?.key}
                title={t.useWhen}
                onMouseEnter={() => setHoverKey(t.key)} onMouseLeave={() => setHoverKey(null)}
                onClick={() => pick(t.key)}
                style={rowStyle(t.key === current?.key, hoverKey === t.key)}
              >
                <span style={CHIP}><ChartTypePreview type={t.key} width={40} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    display: "block", fontSize: 12, fontWeight: 600, color: "#fff",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{t.label}</span>
                  <span style={{
                    display: "block", fontSize: 10, lineHeight: 1.3, color: "rgba(255,255,255,0.45)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{t.useWhen}</span>
                </span>
                {t.key === current?.key && <ChartTypeCheck />}
              </button>
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  );
}
