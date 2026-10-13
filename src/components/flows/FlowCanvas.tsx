// FLW7 (REQ-FLW1..8 Fase 6) — canvas del flow builder sobre @xyflow/react
// (el gemelo React de @vue-flow, el stack de n8n). Reemplaza el lienzo hecho a
// mano de FlowEditor SIN tocar el contrato: las posiciones siguen viviendo en
// node.position / trigger.position (mismo JSON), flow_save sigue siendo la
// ÚNICA escritura (el canvas edita estado local del editor; «Guardar» persiste)
// y las tools flow_* no cambian.
//
// Paridad con el lienzo anterior (REQ-027 + gaps Fase 0/1/2):
// - Pan (arrastrar fondo), zoom (ctrl+rueda / pinch) y encuadre fitView al
//   montar (v60.2: salta al flow completo, clamp 0.4–1).
// - Conexión por puertos con salidas por rama: condition ✓/✗, switch una por
//   regla + fallback, y la salida when:"error" roja en TODOS los ejecutables.
// - Multi-selección: shift+clic alterna y shift+arrastrar en el vacío hace la
//   caja (Delete borra todo: lo sigue gestionando FlowEditor).
// - note / group renderizados n8n-style (nota adhesiva editable en el lienzo;
//   frame punteado que arrastra a sus miembros).
// - Línea organizativa del disparo (trigger.entry) punteada cian — NO es una
//   arista del grafo.
// - Feedback en vivo del run (REQ-042/047): ✓ verde, ✗ roja que QUEDA, reloj
//   ámbar en espera de IA y «—» verídico si el nodo no corrió.
// - Mini-mapa, controles de zoom y fondo punteado.
// - Badge de versión del nodo (FLW2): v{n} en tarjetas con version > 1.
// - Arrastrar nodos desde la paleta (HTML5 dnd → onDropNode).
//
// Lo que NO vive aquí: inspector, paleta (columna), historial, modal de nodo
// (REQ-047), runs ni guardado — todo queda en FlowEditor.

import { useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { NODE_META, type FlowEdge, type FlowNode } from "./flowTypes";

const NODE_W = 208;
// Puertos de salida (misma geometría del lienzo anterior): centros en 16px y
// cada 26px — inPos/enPos del editor calzan con estos valores.
const PORT_TOP0 = 16;
const PORT_STEP = 26;
// Id reservado del nodo disparo (igual que FlowEditor usa para `selected`).
export const TRIGGER_ID = "__trigger__";

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 6, color: "#fff", padding: "5px 8px", fontSize: 12, outline: "none",
};

// ── Disparo (nodo inicial): meta + iconos SVG — compartidos con el inspector
// de FlowEditor (sección Inicio), por eso se exportan. ──
export const TRIGGER_META: Record<"manual" | "webhook" | "schedule" | "error", { label: string; color: string; hint: string }> = {
  manual: { label: "Disparo manual", color: "#22d3ee", hint: "Ejecútalo con ▶ Ejecutar o pídeselo a tu IA (flow_run)" },
  webhook: { label: "Disparo webhook", color: "#22d3ee", hint: "Un POST a la URL del webhook ejecuta el flow" },
  schedule: { label: "Disparo horario", color: "#22d3ee", hint: "Los horarios los ejecuta tu IA con flow_due_check + flow_run" },
  error: { label: "Disparo de error", color: "#f87171", hint: "Corre solo cuando OTRO flow de este workspace falla (recibe input.flowId, flowName, failedNode). Actívalo (Activo) para que reciba los fallos." },
};
export const TRIGGER_ICONS: Record<"manual" | "webhook" | "schedule" | "error", React.ReactNode> = {
  manual: <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />,
  webhook: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>,
  schedule: <><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></>,
  error: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
};

/** Switch de nodo (activar/desactivar): píldora estilo n8n. La clase "nodrag"
 *  es OBLIGATORIA: el drag de @xyflow escucha pointerdown NATIVO en la tarjeta
 *  y solo respeta stopPropagation vía esa clase (React no alcanza a cancelarlo). */
export function Switch({ on, onToggle, title }: { on: boolean; onToggle: () => void; title?: string }) {
  return (
    <span role="switch" aria-checked={on} aria-label={title} title={title} tabIndex={0} className="nodrag"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onToggle(); } }}
      style={{ position: "relative", width: 30, height: 16, borderRadius: 9, flexShrink: 0, cursor: "pointer", display: "inline-block",
        background: on ? "rgba(74,222,128,0.85)" : "rgba(255,255,255,0.18)", transition: "background 0.15s" }}>
      <span style={{ position: "absolute", top: 2, left: on ? 16 : 2, width: 12, height: 12, borderRadius: 6, background: "#0e0e12", transition: "left 0.15s" }} />
    </span>
  );
}

/** Preview en vivo del frame elegido en un nodo template: iframe sandbox con
 *  el HTML/CSS REALES del frame (get_html_frames) — misma receta CSP que el
 *  inspector usa; FlowEditor la re-importa para su preview grande. */
export function FramePreview({ html, css, width, height, maxW }: { html: string; css: string; width: number; height: number; maxW: number }) {
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  const scale = Math.min(1, maxW / w);
  const srcDoc = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com; script-src 'none'; img-src 'self' https: data:; font-src 'self' https://fonts.gstatic.com"><style>html,body{margin:0;padding:0;width:${w}px;height:${h}px;overflow:hidden}</style><style>${css}</style></head><body>${html}</body></html>`;
  return (
    <div style={{ width: w * scale, height: h * scale, overflow: "hidden", borderRadius: 8, border: "1px solid rgba(255,255,255,0.14)", background: "#101014" }}>
      <iframe sandbox="allow-same-origin" srcDoc={srcDoc} title="Preview del frame elegido" scrolling="no"
        style={{ width: w, height: h, border: "none", transform: `scale(${scale})`, transformOrigin: "top left", pointerEvents: "none", display: "block" }} />
    </div>
  );
}

// ── Puertos de salida (paridad n8n): cada nodo declara sus salidas —
// condition ✓/✗, switch una por regla (con label corto en el puerto) +
// fallback, y TODOS los ejecutables añaden la salida when:"error" (roja) para
// enrutar fallos (plan B3). Las notas/grupos no tienen puertos. ──
function portsFor(node: FlowNode): { when?: string; color: string; glyph?: string; title: string }[] {
  if (node.type === "note" || node.type === "group") return []; // visuales: sin puertos
  if (node.type === "condition") {
    return [
      { when: "true", color: "#4ade80", glyph: "✓", title: "Salida verdadero" },
      { when: "false", color: "#f87171", glyph: "✗", title: "Salida falso" },
      { when: "error", color: "#f87171", glyph: "!", title: "Salida de error (si el nodo falla)" },
    ];
  }
  if (node.type === "switch") {
    const rules = Array.isArray(node.config?.rules) ? node.config.rules : [];
    const ports: { when: string; color: string; glyph?: string; title: string }[] = rules.map((r: any) => ({
      when: String(r?.label ?? ""),
      color: "#facc15",
      glyph: String(r?.label ?? "?").slice(0, 2) || "?",
      title: `Ruta ${r?.label ?? "?"}`,
    }));
    if (node.config?.fallback !== false) ports.push({ when: "fallback", color: "#fb923c", glyph: "…", title: "Ruta fallback (ninguna regla matcheó)" });
    ports.push({ when: "error", color: "#f87171", glyph: "!", title: "Salida de error (si el nodo falla)" });
    return ports;
  }
  return [
    { when: undefined, color: NODE_META[node.type]?.color ?? "#94a3b8", title: "Salida" },
    { when: "error", color: "#f87171", glyph: "!", title: "Salida de error (si el nodo falla)" },
  ];
}

/** Resumen de config por nodo (dentro de la tarjeta del canvas). */
function NodeBody({ node, runOutput, flowInputs }: { node: FlowNode; runOutput?: unknown; flowInputs?: any[] }) {
  const c = node.config ?? {};
  const rows: [string, string][] = [];
  if (c.url != null) rows.push(["url", String(c.url || "—")]);
  if (c.username) rows.push(["usuario", `@${c.username}`]);
  if (c.instanceUrl) rows.push(["instancia", String(c.instanceUrl)]);
  if (node.type === "ai") rows.push(["modelo", `${c.provider ?? "—"}${c.model ? ` · ${c.model}` : ""}`]);
  if (node.type === "ai") rows.push(["credencial", c.credentialId ? String(c.credentialId) : "sin credencial"]);
  if (node.type === "agent") {
    rows.push(["modelo", `${c.provider ?? "—"}${c.model ? ` · ${c.model}` : ""}`]);
    rows.push(["credencial", c.credentialId ? String(c.credentialId) : "sin credencial"]);
    rows.push(["tools", Array.isArray(c.tools) && c.tools.length ? c.tools.join(", ") : "responde directo"]);
    rows.push(["iteraciones", String(Number(c.maxIterations) || 4)]);
  }
  if (node.type === "template") rows.push(["archivo+frame", c.templateId && c.frameId ? `${String(c.frameId).slice(0, 14)}` : "a configurar"]);
  if (c.maxItems != null && ["ai", "template", "source_rss", "source_http", "source_nitter"].includes(node.type)) rows.push(["máx items", String(c.maxItems)]);
  if (node.type === "condition") rows.push(["si", `${c.path ?? "—"} ${c.operator ?? ""}${c.value !== undefined ? ` ${c.value}` : ""}`]);
  if (node.type === "switch") rows.push(["si", `${c.path ?? "—"} · ${Array.isArray(c.rules) ? c.rules.length : 0} reglas${c.fallback !== false ? " + fallback" : ""}`]);
  if (node.type === "loop") rows.push(["lote", `${Number(c.batchSize) || 5} items`]);
  if (node.type === "merge") rows.push(["modo", c.mode === "branch" ? `pasa entrada ${Number(c.branch) || 1}` : c.mode === "byKey" ? `une por ${c.key || "clave"}` : "concatena"]);
  if (node.type === "compare") {
    rows.push(["diff", `A vs B · ${c.mode ?? "all"}`]);
    rows.push(["claves", Array.isArray(c.keys) && c.keys.length ? c.keys.join(", ") : "id"]);
  }
  if (node.type === "tool") rows.push(["tool", String(c.tool || "a configurar")]);
  if (node.type === "wait") rows.push(["pausa", `${Number(c.seconds) || 5}s`]);
  if (node.type === "wait_webhook" || node.type === "approval") {
    rows.push(["espera", `${node.type === "approval" ? "aprobación" : "callback"} ≤ ${Number(c.timeoutMinutes) || 60}m`]);
    if (c.message) rows.push(["mensaje", String(c.message).slice(0, 60)]);
  }
  if (node.type === "subflow") rows.push(["flow", c.flowId ? String(c.flowId) : "a configurar"]);
  if (node.type === "code") rows.push(["js", String(c.js ?? "").split("\n").find((line: string) => line.trim() && !line.trim().startsWith("//")) ?? "js inline"]);
  if (node.type === "text") rows.push(["texto", String(c.template || "—").slice(0, 80)]);
  if (node.type === "report") rows.push(["título", String(c.title || "Reporte")]);
  if (node.type === "preview") rows.push(["vista", String(c.title || "Resultado")]);
  // Flows-brand: un map que solo aplana {{input.*}} (el Brief) se lee como el
  // formulario: label del input + su valor.
  if (node.type === "map" && c.value && typeof c.value === "object" && !Array.isArray(c.value)) {
    const briefRows: [string, string][] = [];
    for (const [k, v] of Object.entries(c.value as Record<string, unknown>)) {
      const m = typeof v === "string" ? /^\{\{input\.([A-Za-z0-9_-]+)\}\}$/.exec(v.trim()) : null;
      const field = m && flowInputs ? flowInputs.find((f: any) => f?.key === m[1]) : null;
      if (field) briefRows.push([field.label || k, String(field.default ?? "—")]);
    }
    if (briefRows.length) rows.push(...briefRows);
  }
  return (
    <div style={{ padding: "7px 10px 9px", display: "grid", gap: 2 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ fontSize: 10.5, color: "rgba(255,255,255,0.55)", display: "flex", gap: 6, minWidth: 0 }}>
          <span style={{ color: "rgba(255,255,255,0.32)", flexShrink: 0 }}>{k}</span>
          <span title={v} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
        </div>
      ))}
      {node.type === "preview" && runOutput != null && <PreviewResultView output={runOutput} />}
      {node.enabled === false && <div style={{ fontSize: 10, color: "#fbbf24" }}>nodo deshabilitado</div>}
    </div>
  );
}

/** Resultado del run en el nodo preview (v63): pinta la view{} acotada que
 *  produce el engine — texto (con imagen si la salida es una URL/data-URI),
 *  items (conteo + primeros) o JSON. Sin run todavía: mensaje guía. */
function PreviewResultView({ output }: { output: any }) {
  const view = output?.view ?? {};
  if (view.kind === "empty") {
    return <div style={{ marginTop: 5, fontSize: 10, color: "rgba(255,255,255,0.35)" }}>sin resultado aún — corre el flow</div>;
  }
  const imgSrc = typeof view.text === "string" && /^(https?:\/\/\S+|data:image\/\S+)$/i.test(view.text.trim()) ? view.text.trim() : null;
  return (
    <div style={{ marginTop: 6, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 6, display: "grid", gap: 4 }}>
      {view.kind === "text" && (
        <>
          {imgSrc && <img src={imgSrc} alt="Resultado del flow" style={{ width: "100%", maxHeight: 150, objectFit: "contain", borderRadius: 6, background: "rgba(255,255,255,0.04)" }} />}
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.8)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 130, overflowY: "auto" }}>
            {view.text}
            {view.truncated && <span style={{ color: "rgba(255,255,255,0.35)" }}> … (recortado — completo en Historial)</span>}
          </div>
        </>
      )}
      {view.kind === "items" && (
        <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.55)", display: "grid", gap: 3 }}>
          <span>{view.count} item{view.count === 1 ? "" : "s"}</span>
          {(view.items ?? []).slice(0, 3).map((it: any, i: number) => (
            <div key={i} style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", background: "rgba(255,255,255,0.05)", borderRadius: 5, padding: "3px 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {typeof it === "string" ? it : typeof it?.title === "string" ? it.title : typeof it?.text === "string" ? it.text : (() => { try { return JSON.stringify(it)?.slice(0, 90); } catch { return String(it); } })()}
            </div>
          ))}
        </div>
      )}
      {view.kind === "json" && (
        <pre style={{ margin: 0, fontSize: 10, fontFamily: "inherit", color: "rgba(255,255,255,0.7)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 130, overflowY: "auto" }}>
          {view.json}{view.truncated ? " …" : ""}
        </pre>
      )}
    </div>
  );
}

// ── Badge de estado del run (REQ-042/047): ✗ roja que QUEDA hasta el próximo
// run, reloj ámbar en espera de IA y «—» verídico si el nodo no corrió en el
// último run terminado. ──
function RunBadge({ st, isLive, stFull, hasLastRun, isNote }: {
  st?: { ok: boolean; error?: string; waiting?: boolean };
  isLive: boolean;
  stFull: any | null;
  hasLastRun: boolean;
  isNote: boolean;
}) {
  const stWaiting = st?.waiting === true || stFull?.output?.waiting === true;
  if (!st && !isLive && hasLastRun && !stFull && !isNote) {
    return (
      <span title="Sin ejecutar en el último run — el run está en espera de tu IA, falló antes con «detener el run», o este nodo se agregó/deshabilitó después"
        style={{ position: "absolute", top: -9, right: -9, minWidth: 18, height: 18, padding: "0 4px", borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, lineHeight: 1, zIndex: 2, color: "rgba(255,255,255,0.55)", background: "#2a2a33", border: "1px solid rgba(255,255,255,0.25)" }}>—</span>
    );
  }
  if (stWaiting && !isLive) {
    return (
      <span title="En espera de tu IA — la tarea está en flow_ai_tasks; cuando tu IA entregue con flow_ai_complete el run sigue solo y este lienzo se actualiza"
        style={{ position: "absolute", top: -9, right: -9, minWidth: 18, height: 18, padding: "0 3px", borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, lineHeight: 1, zIndex: 2, color: "#451a03", background: "#fbbf24", border: "1px solid rgba(0,0,0,0.4)" }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></svg>
      </span>
    );
  }
  if (!(st || isLive)) return null;
  const fullErr = stFull?.error ? `${stFull.error.code ?? "ERROR"}: ${stFull.error.message ?? ""}`.slice(0, 220) : (st?.error ?? "");
  return (
    <span title={st ? (st.ok ? "OK en este run — clic para ver entrada/salida" : `Falló aquí — ${fullErr || "ver Historial"}`) : "Ejecutando…"}
      style={{ position: "absolute", top: -9, right: -9, minWidth: 18, height: 18, padding: "0 4px", borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, lineHeight: 1, zIndex: 2, color: st && !st.ok ? "#450a0a" : "#052e16", background: st ? (st.ok ? "#4ade80" : "#f87171") : "#4ade80", border: "1px solid rgba(0,0,0,0.4)", opacity: st ? 1 : 0.9 }}>
      {st ? (st.ok ? "✓" : "✗") : "…"}
    </span>
  );
}

// ── Tarjeta de nodo ejecutable (la gran mayoría): header + badge de run +
// preview template + NodeBody + puerto de entrada + puertos por rama. ──
function MusaNode({ data }: NodeProps) {
  const d = data as any;
  const node: FlowNode = d.node;
  const meta = NODE_META[node.type] ?? { label: node.type, color: "#888" };
  const st = d.st as { ok: boolean; error?: string; waiting?: boolean } | undefined;
  const isLive: boolean = d.isLive === true;
  const grouped: boolean = d.grouped === true;
  return (
    <div style={{
      width: NODE_W,
      background: "#131318",
      border: `1px solid ${d.selected ? meta.color : grouped ? "#38bdf8" : st ? (st.ok ? "rgba(74,222,128,0.75)" : "rgba(248,113,113,0.8)") : isLive ? "rgba(74,222,128,0.85)" : "rgba(255,255,255,0.12)"}`,
      boxShadow: d.selected ? `0 0 0 2px ${meta.color}44` : st ? (st.ok ? "0 0 0 2px rgba(74,222,128,0.35)" : "0 0 0 2px rgba(248,113,113,0.4)") : isLive ? "0 0 0 2px rgba(74,222,128,0.5), 0 0 14px rgba(74,222,128,0.35)" : grouped ? "0 0 0 2px rgba(56,189,248,0.35)" : "none",
      borderRadius: 10, userSelect: "none",
      opacity: node.enabled === false ? 0.55 : 1,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: meta.color, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.9)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.label}</span>
        {Number(node.version) > 1 && (
          <span title={`Versión ${node.version} del schema del nodo (FLW2)`}
            style={{ fontSize: 8.5, fontWeight: 700, color: "#a5f3fc", background: "rgba(34,211,238,0.12)", border: "1px solid rgba(34,211,238,0.35)", borderRadius: 4, padding: "0 4px", lineHeight: "13px", flexShrink: 0 }}>
            v{node.version}
          </span>
        )}
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{meta.label}</span>
        {d.pinned === true && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            style={{ flexShrink: 0 }}><title>Datos pineados (B7): con mode:dev este nodo usa estos datos en vez de ejecutarse</title><path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z" /></svg>
        )}
        <Switch on={node.enabled !== false} onToggle={() => d.onToggle(node.id, node.enabled === false)} title="Activar o desactivar nodo (los deshabilitados se ignoran en el run)" />
      </div>
      <RunBadge st={st} isLive={isLive} stFull={d.stFull} hasLastRun={d.hasLastRun === true} isNote={false} />
      {/* Preview del diseño elegido (nodo template): visible en el lienzo sin clicar nada. */}
      {node.type === "template" && d.frame ? (
        <div style={{ padding: "6px 8px 0" }}>
          <FramePreview html={d.frame.html} css={d.frame.css} width={d.frame.width} height={d.frame.height} maxW={190} />
        </div>
      ) : null}
      <NodeBody node={node} runOutput={d.runOutput} flowInputs={d.flowInputs} />
      {/* puerto de entrada */}
      <Handle type="target" position={Position.Left} id="in" title="Entrada"
        style={{ top: 30, width: 16, height: 16, borderRadius: "50%", background: "#1c1c22", border: "2px solid rgba(255,255,255,0.3)" }} />
      {/* puertos de salida: condition ✓/✗, switch reglas+fallback, y la salida
          when:"error" roja en todos (plan B3) */}
      {portsFor(node).map((port, pi) => (
        <Handle key={port.when ?? "out"} type="source" position={Position.Right} id={port.when ?? "out"} title={port.title}
          style={{ top: PORT_TOP0 + pi * PORT_STEP, width: 16, height: 16, borderRadius: "50%", background: "#1c1c22", border: `2px solid ${port.color}88`, cursor: "crosshair", color: port.color, fontSize: 8, lineHeight: "10px", textAlign: "center" }}>
          {port.glyph ?? ""}
        </Handle>
      ))}
    </div>
  );
}

// ── Nota adhesiva (n8n sticky): se edita EN el lienzo; no participa del grafo. ──
function NoteNode({ data }: NodeProps) {
  const d = data as any;
  const node: FlowNode = d.node;
  return (
    <div style={{
      width: NODE_W, background: "rgba(163,230,53,0.07)",
      border: `1px solid ${d.selected ? "#a3e635" : "rgba(163,230,53,0.35)"}`,
      boxShadow: d.selected ? "0 0 0 2px rgba(163,230,53,0.3)" : "none",
      borderRadius: 10, userSelect: "none", opacity: node.enabled === false ? 0.55 : 1,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid rgba(163,230,53,0.15)" }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: "#a3e635", flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.9)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.label}</span>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>Nota</span>
        <Switch on={node.enabled !== false} onToggle={() => d.onToggle(node.id, node.enabled === false)} title="Activar o desactivar nota" />
      </div>
      <div style={{ padding: "0 10px 9px" }}>
        <textarea className="nodrag nowheel" value={String(node.config?.text ?? "")}
          onFocus={() => d.onNoteFocus()}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => d.onPatchConfig(node.id, { text: e.target.value })}
          placeholder="Nota adhesiva (no se ejecuta)"
          style={{ ...inputStyle, minHeight: 58, resize: "vertical", background: "rgba(163,230,53,0.06)" }} />
      </div>
    </div>
  );
}

// ── Grupo (plan A6): frame punteado con título — arrastrarlo MUEVE a los
// nodos dentro de su bbox (el delta lo aplica FlowCanvas vía onNodesMove);
// colapsar la encoge; NO se conecta ni se ejecuta. ──
function GroupNode({ data }: NodeProps) {
  const d = data as any;
  const node: FlowNode = d.node;
  const collapsed = node.config?.collapsed === true;
  return (
    <div style={{
      width: "100%", height: "100%",
      border: `1.5px dashed ${d.selected ? "#cbd5e1" : "rgba(203,213,225,0.4)"}`,
      boxShadow: d.selected ? "0 0 0 2px rgba(203,213,225,0.28)" : "none",
      background: collapsed ? "rgba(203,213,225,0.06)" : "rgba(203,213,225,0.035)",
      borderRadius: 12, userSelect: "none",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px" }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: "#cbd5e1", flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, fontWeight: 600, color: "rgba(255,255,255,0.72)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(node.config?.title || "Grupo")}</span>
        {!collapsed && <span style={{ fontSize: 9.5, color: "rgba(255,255,255,0.35)" }}>{Number(d.memberCount) || 0} nodo{Number(d.memberCount) === 1 ? "" : "s"}</span>}
        <button type="button" className="nodrag" title={collapsed ? "Expandir grupo" : "Colapsar grupo"} aria-label={collapsed ? "Expandir grupo" : "Colapsar grupo"}
          onClick={() => d.onPatchConfig(node.id, { collapsed: !collapsed })}
          style={{ display: "inline-flex", alignItems: "center", border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.85)", borderRadius: 6, padding: "1px 6px", fontSize: 10, cursor: "pointer" }}>
          {collapsed ? "▸" : "▾"}
        </button>
      </div>
    </div>
  );
}

// ── Tarjeta del disparo (nodo inicial): espejo del trigger del flow. Su
// posición vive en trigger.position y su handle de salida dibuja la línea
// organizativa (trigger.entry) — NO es una arista del grafo. ──
function TriggerNode({ data }: NodeProps) {
  const d = data as any;
  const trigger = d.trigger ?? {};
  const t = (trigger.type ?? "manual") as "manual" | "webhook" | "schedule" | "error";
  const tmeta = TRIGGER_META[t] ?? TRIGGER_META.manual;
  const sel = d.selected === true;
  const row = (k: string, v: string) => (
    <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.55)", display: "flex", gap: 6, minWidth: 0 }}>
      <span style={{ color: "rgba(255,255,255,0.32)", flexShrink: 0 }}>{k}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
    </div>
  );
  return (
    <div style={{
      width: NODE_W, background: "#131318",
      border: `1px solid ${sel ? tmeta.color : "rgba(255,255,255,0.12)"}`,
      boxShadow: sel ? `0 0 0 2px ${tmeta.color}44` : "none",
      borderRadius: 10, userSelect: "none",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: tmeta.color, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.9)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tmeta.label}</span>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>Trigger</span>
      </div>
      <div style={{ padding: "7px 10px 9px", display: "grid", gap: 2 }}>
        {t === "schedule" && <>{row("cron", trigger.cron || "—")}{row("zona", trigger.timezone || "—")}</>}
        {t === "webhook" && row("run", "POST al webhook del flow")}
        {t === "manual" && row("run", "▶ Ejecutar o tu IA (flow_run)")}
        {t === "error" && row("run", "cuando otro flow falla")}
      </div>
      <Handle type="source" position={Position.Right} id="entry" title="Arrastra a un nodo para marcar el arranque visual"
        style={{ top: 30, width: 16, height: 16, borderRadius: "50%", background: "#1c1c22", border: "2px solid rgba(34,211,238,0.55)", cursor: "crosshair" }} />
    </div>
  );
}

const nodeTypes: NodeTypes = { musa: MusaNode, note: NoteNode, group: GroupNode, trigger: TriggerNode };

export type FlowCanvasProps = {
  nodes: FlowNode[];
  edges: FlowEdge[];
  trigger: any;
  /** Fallback cuando el trigger aún no tiene position (flow nuevo). */
  triggerFallbackPos: { x: number; y: number };
  selected: string | null;
  selectedEdge: number | null;
  entrySel: boolean;
  selIds: string[];
  liveRun: { steps: Record<string, { ok: boolean; error?: string; waiting?: boolean }>; active: boolean } | null;
  liveNodeId: string | null;
  lastRunSteps: Record<string, any> | null;
  lastRunFull: any | null;
  flowInputs?: any[];
  pins: Record<string, string>;
  frameCache: Record<string, { id: string; html: string; css: string; width: number; height: number }[]>;
  onPaneClick: () => void;
  onPaneDoubleClick: () => void;
  /** clean click = selecciona + inspector + modal; additive = shift+clic (alterna multi-selección). */
  onNodeClick: (id: string, additive: boolean) => void;
  onTriggerClick: () => void;
  onEdgeClick: (index: number) => void;
  onEntryClick: () => void;
  onConnect: (from: string, when: string | undefined, to: string) => void;
  /** Espejo de la selección interna de xyflow → selIds del editor. */
  onSelectionSync: (ids: string[]) => void;
  onMoveStart: () => void;
  onNodesMove: (updates: Record<string, { x: number; y: number }>) => void;
  onTriggerMove: (pos: { x: number; y: number }) => void;
  onToggleNode: (id: string, next: boolean) => void;
  onPatchConfig: (id: string, patch: Record<string, any>) => void;
  onNoteFocus: () => void;
  onDropNode: (key: string, at: { x: number; y: number }) => void;
};

export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function FlowCanvasInner(props: FlowCanvasProps) {
  const { screenToFlowPosition } = useReactFlow();
  // Contexto de arrastre de grupos: bbox y miembros capturados al INICIO del
  // drag — durante el drag el grupo diff su delta y los miembros lo siguen.
  const groupCtx = useRef<Record<string, { x: number; y: number; members: { id: string; x: number; y: number }[] }>>({});

  const groupMembers = (node: FlowNode) => {
    const gw = Math.max(120, Math.min(4000, Number(node.config?.width) || 340));
    const ghFull = Math.max(80, Math.min(4000, Number(node.config?.height) || 220));
    return props.nodes.filter((m) => m.id !== node.id && m.type !== "group"
      && m.position.x >= node.position.x && m.position.x + NODE_W <= node.position.x + gw
      && m.position.y >= node.position.y && m.position.y + 96 <= node.position.y + ghFull);
  };

  // ── Derivación FlowEditor → xyflow (el estado del editor SIEMPRE manda). ──
  const rfNodes: Node[] = [];
  const tpos = (props.trigger?.position ?? props.triggerFallbackPos) as { x: number; y: number };
  rfNodes.push({
    id: TRIGGER_ID,
    type: "trigger",
    position: tpos,
    data: { trigger: props.trigger, selected: props.selected === TRIGGER_ID },
    zIndex: 1,
  });
  for (const node of props.nodes) {
    const st = props.liveRun?.steps?.[node.id];
    const isLive = !!props.liveRun?.active && props.liveNodeId === node.id;
    const grouped = props.selIds.length > 1 && props.selIds.includes(node.id);
    if (node.type === "group") {
      const gw = Math.max(120, Math.min(4000, Number(node.config?.width) || 340));
      const ghFull = Math.max(80, Math.min(4000, Number(node.config?.height) || 220));
      const collapsed = node.config?.collapsed === true;
      rfNodes.push({
        id: node.id,
        type: "group",
        position: node.position,
        zIndex: 0, // el frame queda DEBAJO de las tarjetas
        style: { width: gw, height: collapsed ? 36 : ghFull },
        data: { node, selected: props.selected === node.id || grouped, memberCount: groupMembers(node).length },
      });
      continue;
    }
    if (node.type === "note") {
      rfNodes.push({
        id: node.id,
        type: "note",
        position: node.position,
        zIndex: 1,
        data: {
          node,
          selected: props.selected === node.id || grouped,
          onToggle: props.onToggleNode,
          onPatchConfig: props.onPatchConfig,
          onNoteFocus: props.onNoteFocus,
        },
      });
      continue;
    }
    const frames = node.type === "template" && node.config?.templateId ? (props.frameCache[String(node.config.templateId)] ?? []) : [];
    const frame = node.config?.templateId && node.config?.frameId ? frames.find((f) => f.id === node.config.frameId) ?? null : null;
    rfNodes.push({
      id: node.id,
      type: "musa",
      position: node.position,
      zIndex: 1,
      data: {
        node,
        selected: props.selected === node.id || grouped,
        grouped,
        st,
        isLive,
        stFull: props.lastRunFull && Array.isArray(props.lastRunFull.steps)
          ? props.lastRunFull.steps.find((s: any) => s?.nodeId === node.id) ?? null
          : null,
        hasLastRun: !!props.lastRunFull && Array.isArray(props.lastRunFull.steps),
        runOutput: node.type === "preview" ? props.lastRunSteps?.[node.id] : undefined,
        flowInputs: props.flowInputs,
        pinned: Boolean(props.pins[node.id] && String(props.pins[node.id]).trim()),
        frame,
        onToggle: props.onToggleNode,
      },
    });
  }

  // ── Derivación de aristas: índice del edge del editor va en data (Delete y
  // selección lo referencian); la línea del disparo es un edge de solo-pintura. ──
  const rfEdges: Edge[] = props.edges.map((e, i) => {
    const sel = props.selectedEdge === i;
    const color = e.when === "true" ? "#4ade80" : e.when === "false" || e.when === "error" ? "#f87171" : e.when === "fallback" ? "#fb923c" : e.when ? "#facc15" : "rgba(255,255,255,0.35)";
    return {
      id: `e${i}:${e.from}>${e.to}:${e.when ?? ""}`,
      source: e.from,
      target: e.to,
      sourceHandle: e.when ?? "out",
      targetHandle: "in",
      style: {
        stroke: sel ? "#38bdf8" : color,
        strokeWidth: sel ? 2.4 : 1.6,
        ...(e.when === "error" ? { strokeDasharray: "6 4", opacity: 0.8 } : {}),
      },
      data: { index: i },
    };
  });
  const entryTarget = props.trigger?.entry ? props.nodes.find((n) => n.id === props.trigger.entry) : null;
  if (entryTarget) {
    rfEdges.push({
      id: "entry-line",
      source: TRIGGER_ID,
      target: entryTarget.id,
      sourceHandle: "entry",
      targetHandle: "in",
      style: {
        stroke: props.entrySel ? "#38bdf8" : "rgba(34,211,238,0.55)",
        strokeWidth: props.entrySel ? 2.4 : 1.6,
        strokeDasharray: "7 5",
      },
      data: { entry: true },
    });
  }

  // ── Drag: los position changes de xyflow son ABSOLUTOS — se aplican directo
  // al estado del editor; grupos arrastran a sus miembros con el mismo delta.
  // El disparo mueve trigger.position. ──
  const onNodesChange = (changes: NodeChange[]) => {
    const upd: Record<string, { x: number; y: number }> = {};
    let trig: { x: number; y: number } | null = null;
    for (const ch of changes) {
      if (ch.type !== "position" || !ch.position) continue;
      if (ch.id === TRIGGER_ID) { trig = { x: Math.round(ch.position.x), y: Math.round(ch.position.y) }; continue; }
      upd[ch.id] = { x: Math.round(ch.position.x), y: Math.round(ch.position.y) };
    }
    const ctx = groupCtx.current;
    for (const [gid, g] of Object.entries(ctx)) {
      const cur = upd[gid];
      if (!cur) continue;
      const dx = cur.x - g.x;
      const dy = cur.y - g.y;
      for (const m of g.members) upd[m.id] = { x: Math.round(m.x + dx), y: Math.round(m.y + dy) };
    }
    if (trig) props.onTriggerMove(trig);
    if (Object.keys(upd).length) props.onNodesMove(upd);
  };
  const onNodeDragStart = (_e: unknown, node: Node) => {
    props.onMoveStart(); // undo: snapshot ANTES del primer movimiento
    const ctx: Record<string, { x: number; y: number; members: { id: string; x: number; y: number }[] }> = {};
    const nd = node.data as any;
    if (nd?.node?.type === "group") {
      const gnode: FlowNode = nd.node;
      ctx[node.id] = { x: node.position.x, y: node.position.y, members: groupMembers(gnode).map((m) => ({ id: m.id, x: m.position.x, y: m.position.y })) };
    }
    groupCtx.current = ctx;
  };
  const onNodeDragStop = () => { groupCtx.current = {}; };

  // ── Conexión: el handle origen codifica la rama (id = when; "out" = la
  // normal). La semántica (fan-in, notas/grupos, entry) la resuelve el editor. ──
  const onConnect = (c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    const when = !c.sourceHandle || c.sourceHandle === "out" ? undefined : c.sourceHandle;
    props.onConnect(c.source, when, c.target);
  };

  // ── Clic de nodo: ignora puertos y controles internos (nodrag); shift/ctrl
  // alterna multi-selección; el disparo tiene su propio handler. ──
  const onNodeClick = (e: React.MouseEvent, node: Node) => {
    const t = e.target as HTMLElement;
    if (t.closest(".react-flow__handle") || t.closest(".nodrag")) return;
    if (node.id === TRIGGER_ID) { props.onTriggerClick(); return; }
    props.onNodeClick(node.id, e.shiftKey || e.ctrlKey || e.metaKey);
  };

  const onEdgeClick = (_e: React.MouseEvent, edge: Edge) => {
    const d = edge.data as any;
    if (d?.entry) props.onEntryClick();
    else props.onEdgeClick(Number(d?.index ?? 0));
  };

  const onSelectionChange = ({ nodes: sel }: { nodes: Node[]; edges: Edge[] }) => {
    props.onSelectionSync(sel.map((n) => n.id).filter((id) => id !== TRIGGER_ID));
  };

  // ── DnD desde la paleta: dataTransfer guarda la key del nodo; al soltar se
  // convierte pantalla → coords del flow y el editor agrega ahí. ──
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("application/musa-flow-node")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const key = e.dataTransfer.getData("application/musa-flow-node");
    if (!key) return;
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    props.onDropNode(key, { x: Math.round(p.x), y: Math.round(p.y - 14) });
  };

  const miniColor = (n: Node) =>
    n.id === TRIGGER_ID ? "#22d3ee" : n.type === "group" ? "#cbd5e1" : (NODE_META[(n.data as any)?.node?.type]?.color ?? "#94a3b8");

  return (
    <div
      style={{ flex: 1, minWidth: 0, position: "relative", background: "#0a0a0d" }}
      onDoubleClick={(e) => {
        // Doble clic en el VACÍO abre la paleta (paridad del lienzo anterior);
        // sobre nodos/controles no hace nada.
        const t = e.target as HTMLElement;
        if (t.closest(".react-flow__node") || t.closest(".react-flow__controls") || t.closest(".react-flow__minimap")) return;
        props.onPaneDoubleClick();
      }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={props.onPaneClick}
        onEdgeClick={onEdgeClick}
        onConnect={onConnect}
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onSelectionChange={onSelectionChange}
        onDrop={onDrop}
        onDragOver={onDragOver}
        // Delete/Backspace los gestiona FlowEditor (deleteSelection con undo);
        // xyflow NUNCA borra por su cuenta.
        deleteKeyCode={null}
        multiSelectionKeyCode="Shift"
        zoomOnScroll={false}
        panOnScroll
        zoomOnDoubleClick={false}
        fitView
        fitViewOptions={{ padding: 0.2, minZoom: 0.4, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
        connectionLineStyle={{ stroke: "#38bdf8", strokeWidth: 1.8, strokeDasharray: "5 4" }}
        isValidConnection={(c) => c.source !== c.target}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color="rgba(255,255,255,0.09)" />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          position="top-right"
          pannable
          zoomable
          bgColor="#131318"
          maskColor="rgba(10,10,13,0.72)"
          style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8 }}
          nodeColor={miniColor}
        />
      </ReactFlow>
    </div>
  );
}
