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

/** Preview esquemático — la gramática del tipo, no un resultado. 64×44. */
export function ChartTypePreview({ type }: { type: ChartTypeKey }) {
  const common = { width: 64, height: 44, viewBox: "0 0 64 44", fill: "none" as const };
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
