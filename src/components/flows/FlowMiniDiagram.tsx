// FlowMiniDiagram — preview visual de un preset de la biblioteca: dibuja el
// grafo (nodos posicionados + edges) como SVG estático. Sirve a la tarjeta
// (compacto, sin labels) y al popup de detalle (grande, con labels y zoom
// manejado por el contenedor padre). Puro: cero estado del editor.
import type { FlowPreset } from "../../data/flowLibrary";

const NODE_FILL: Record<string, string> = {
  trigger: "#4ade80",
  source_rss: "#38bdf8",
  source_nitter: "#38bdf8",
  source_http: "#38bdf8",
  map: "#94a3b8",
  text: "#94a3b8",
  ai: "#c084fc",
  ai_task: "#a78bfa",
  agent: "#c084fc",
  template: "#f472b6",
  merge: "#fbbf24",
  condition: "#facc15",
  switch: "#facc15",
  http: "#60a5fa",
  tool: "#4ade80",
  report: "#64748b",
  preview: "#22d3ee",
  wait: "#fb923c",
  wait_webhook: "#fb923c",
  approval: "#fb923c",
};

function nodeFill(type: string): string {
  return NODE_FILL[type] ?? "#64748b";
}

/** Metadatos del preset para el popup: usa IA, corre al instante, tools. */
export function flowPresetMeta(preset: FlowPreset): { usesAI: boolean; webSearch: boolean; tools: string[]; inputsCount: number } {
  const types = new Set(preset.nodes.map((n) => n.type));
  const tools = Array.from(new Set(preset.nodes.filter((n) => n.type === "tool" && typeof n.config?.tool === "string").map((n) => String(n.config.tool))));
  return {
    usesAI: types.has("ai") || types.has("ai_task") || types.has("agent"),
    webSearch: preset.nodes.some((n) => n.config?.webSearch === true),
    tools,
    inputsCount: Array.isArray(preset.inputs) ? preset.inputs.length : 0,
  };
}

export function FlowMiniDiagram({ preset, showLabels = false, height = 96 }: { preset: FlowPreset; showLabels?: boolean; height?: number }) {
  const nodes = preset.nodes;
  if (!nodes.length) {
    return (
      <div style={{ height, display: "grid", placeItems: "center", fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
        Canvas vacío — agrega nodos con el editor
      </div>
    );
  }
  // Normaliza posiciones al viewBox: padding fijo y nodo "virtual" de trigger
  // a la izquierda (el canvas del editor lo dibuja aparte — acá igual).
  const pad = 46;
  const xs = nodes.map((n) => n.position.x);
  const ys = nodes.map((n) => n.position.y);
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad;
  const vbW = Math.max(320, maxX - minX);
  const vbH = Math.max(160, maxY - minY);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const NW = 118;
  const NH = 30;
  const pos = (n: (typeof nodes)[number]) => ({ x: n.position.x - minX, y: n.position.y - minY });
  const hasTrigger = preset.trigger != null;
  const firstNodes = nodes.filter((n) => !preset.edges.some((e) => e.to === n.id));
  const trigX = Math.max(-pad + 6, Math.min(...firstNodes.map((n) => pos(n).x)) - 150);
  const trigY = firstNodes.length ? pos(firstNodes[0]).y : vbH / 2;
  const aspect = vbW / vbH;
  const width = Math.round(height * aspect);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${vbW} ${vbH}`} role="img" aria-label={`Diagrama del flow ${preset.name}: ${nodes.length} nodos`} style={{ display: "block", maxWidth: "100%" }}>
      {/* Edges primero (debajo de los nodos) */}
      {hasTrigger && firstNodes.map((n) => {
        const p = pos(n);
        const x1 = trigX + NW;
        return <path key={`t-${n.id}`} d={`M ${x1} ${trigY + NH / 2} C ${x1 + 40} ${trigY + NH / 2}, ${p.x - 40} ${p.y + NH / 2}, ${p.x} ${p.y + NH / 2}`} fill="none" stroke="rgba(74,222,128,0.4)" strokeWidth={2} />;
      })}
      {preset.edges.map((e, i) => {
        const a = byId.get(e.from);
        const b = byId.get(e.to);
        if (!a || !b) return null;
        const pa = pos(a);
        const pb = pos(b);
        const x1 = pa.x + NW;
        const x2 = pb.x;
        const y1 = pa.y + NH / 2;
        const y2 = pb.y + NH / 2;
        const mid = Math.max(30, (x2 - x1) / 2);
        return <path key={`${e.from}-${e.to}-${i}`} d={`M ${x1} ${y1} C ${x1 + mid} ${y1}, ${x2 - mid} ${y2}, ${x2} ${y2}`} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={2} />;
      })}
      {hasTrigger && (
        <g>
          <rect x={trigX} y={trigY} width={NW} height={NH} rx={8} fill="rgba(74,222,128,0.12)" stroke="rgba(74,222,128,0.55)" strokeWidth={1.5} />
          {showLabels && <text x={trigX + NW / 2} y={trigY + NH / 2 + 4} textAnchor="middle" fontSize={11} fill="#4ade80">Disparo</text>}
        </g>
      )}
      {nodes.map((n) => {
        const p = pos(n);
        const fill = nodeFill(n.type);
        return (
          <g key={n.id}>
            <rect x={p.x} y={p.y} width={NW} height={NH} rx={8} fill={`${fill}22`} stroke={fill} strokeWidth={1.5} />
            <circle cx={p.x + 12} cy={p.y + NH / 2} r={4.5} fill={fill} />
            {showLabels && (
              <text x={p.x + 24} y={p.y + NH / 2 + 4} fontSize={11.5} fill="rgba(255,255,255,0.88)">
                {n.label.length > 13 ? `${n.label.slice(0, 12)}…` : n.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
