/**
 * ActivityBars.tsx — mini gráfico de barras (SVG) de actividad por día.
 * Extraído de InicioResumen para reuso en medir/reportes. Solo tokens.
 */
import type { ActivityRange } from "../../lib/apiV2/inicio";

export function ActivityBars({ data }: { data: ActivityRange }) {
  const days = data.days.slice(-14);
  const max = Math.max(1, ...days.map(d => d.designOps + d.framesCreated + d.templatesCreated));
  return (
    <svg
      className="ds-chart"
      viewBox={`0 0 ${days.length * 28} 120`}
      role="img"
      aria-label="Actividad de los últimos 14 días"
      style={{ width: "100%", display: "block", overflow: "visible" }}
    >
      {days.map((d, i) => {
        const total = d.designOps + d.framesCreated + d.templatesCreated;
        const h = Math.round((total / max) * 96);
        return (
          <g key={d.date}>
            <rect
              x={i * 28 + 6}
              y={104 - h}
              width={16}
              height={h}
              rx={3}
              fill={i === days.length - 1 ? "var(--ds-accent)" : "var(--ds-l2)"}
            />
            <text x={i * 28 + 14} y={118} textAnchor="middle" fill="var(--ds-muted)" fontSize="9" fontFamily="var(--ds-font-sans)">
              {d.date.slice(8)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
