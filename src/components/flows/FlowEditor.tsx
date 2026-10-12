// REQ-027 — FlowEditor: canvas de nodos del flow builder.
// Toda operación de datos va por mcpCall a las tools flow_* (flow_save /
// flow_run / list_templates / get_html_frames) — la UI es solo otro cliente
// MCP; nada de rutas privadas. El botón Ejecutar llama la MISMA flow_run que
// usa una IA o el webhook.

import { useCallback, useEffect, useRef, useState } from "react";
import { mcpCall } from "../../lib/mcpClient";
import { downloadBlob } from "../../lib/download";
import {
  AI_PROVIDERS, CATEGORIES, CONDITION_OPERATORS, NODE_META, NODE_PALETTE, NODE_PALETTE_ADVANCED, SWITCH_OPERATORS,
  type FlowDef, type FlowEdge, type FlowCredential, type FlowNode, type FlowRun, type FlowRunStep, type PaletteEntry,
} from "./flowTypes";
import { findFlowTool, FLOW_TOOLS } from "../../data/flowToolCatalog";
import { ToolConfigForm } from "./ToolConfigForm";

const CANVAS_W = 2200;
const CANVAS_H = 1400;
const NODE_W = 208;
// Lienzo "infinito": el origen (0,0) del contenido queda centrado y hay un
// mundo extra panneable hacia cada lado (coords negativas incluidas —
// clampPosition del server ya las admite: ±1e6). El arrastre NO re-clampa a ≥0.
const M_X = CANVAS_W;
const M_Y = CANVAS_H;
const WORLD_W = CANVAS_W + 2 * M_X;
const WORLD_H = CANVAS_H + 2 * M_Y;

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 6, color: "#fff", padding: "5px 8px", fontSize: 12, outline: "none",
};
const labelStyle: React.CSSProperties = { fontSize: 10.5, color: "rgba(255,255,255,0.45)", margin: "8px 0 3px", textTransform: "uppercase", letterSpacing: 0.4 };
const btnBase: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.05)",
  color: "rgba(255,255,255,0.85)", borderRadius: 7, padding: "5px 11px", fontSize: 12, cursor: "pointer",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      {children}
    </div>
  );
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
  // formulario: label del input + su valor (demo al instalar, lo que escribas
  // al correr). El orden de las filas = orden del mini-form del run.
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

/** Switch de nodo (activar/desactivar): píldora al estilo n8n — verde activo,
 *  gris inactivo. Los deshabilitados se guardan con enabled:false y el run los
 *  ignora. stopPropagation en pointerdown: vive en el encabezado arrastrable
 *  de la tarjeta y no debe iniciar un drag. */
function Switch({ on, onToggle, title }: { on: boolean; onToggle: () => void; title?: string }) {
  return (
    <span role="switch" aria-checked={on} aria-label={title} title={title} tabIndex={0}
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
 *  el HTML/CSS REALES del frame (get_html_frames) — la misma receta CSP de
 *  HtmlCanvas, sin el puente de selección — escalado al ancho del inspector. */
function FramePreview({ html, css, width, height, maxW }: { html: string; css: string; width: number; height: number; maxW: number }) {
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
// condition ✓/✗, switch una por regla + fallback, y TODOS los ejecutables
// añaden la salida when:"error" (roja, puntero «!») para enrutar fallos
// (plan B3). Las notas no tienen puertos: no participan del grafo. ──
const PORT_TOP0 = 16;
const PORT_STEP = 26;
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
    const ports: { when: string; color: string; glyph?: string; title: string }[] = rules.map((r: any) => ({ when: String(r?.label ?? ""), color: "#facc15", title: `Ruta ${r?.label ?? "?"}` }));
    if (node.config?.fallback !== false) ports.push({ when: "fallback", color: "#fb923c", title: "Ruta fallback (ninguna regla matcheó)" });
    ports.push({ when: "error", color: "#f87171", glyph: "!", title: "Salida de error (si el nodo falla)" });
    return ports;
  }
  return [
    { when: undefined, color: NODE_META[node.type]?.color ?? "#94a3b8", title: "Salida" },
    { when: "error", color: "#f87171", glyph: "!", title: "Salida de error (si el nodo falla)" },
  ];
}
function portTop(node: FlowNode, when?: string) {
  const idx = portsFor(node).findIndex((p) => (p.when ?? undefined) === (when ?? undefined));
  return idx >= 0 ? PORT_TOP0 + idx * PORT_STEP : 30;
}

// REQ-047: pista en español por código de error del run (modal de nodo).
const RUN_ERROR_HINTS: Record<string, string> = {
  VALIDATION: "Configuración inválida: revisa los campos del nodo (usuario, URL, credencial, esquema…).",
  NITTER_CONFIG: "El nodo de X no pudo armar su feed: revisa el usuario (sin @) y la instancia Nitter; prueba otra instancia si sigue fallando.",
  AI_SCHEMA: "La IA respondió algo que no cumple el esquema JSON pedido: simplifica el schema o aclara el formato en el prompt.",
  CREDENTIAL_MISSING: "Falta una credencial o su contenido está incompleto: créala/asígnala al nodo.",
  CONFIG: "Configuración interna incompleta (webhook/secreto).",
  DISABLED: "Flows está deshabilitado en este entorno.",
  FLOW_RATE_LIMITED: "Demasiados runs seguidos (protección freemium): espera un rato y reintenta.",
  CONCURRENCY_LIMIT: "Ya hay varios runs en marcha para este workspace: espera a que terminen.",
  WAIT_EXPIRED: "La pausa del run expiró: vuelve a lanzar el flow.",
  RESUME_NOT_FOUND: "No hay run en espera con ese token (ya se resolvió o expiró).",
  RUN_TIMEOUT: "El run tardó demasiado y se cortó: reduce items o tokens.",
  TIMEOUT: "La llamada tardó demasiado: revisa la URL o el servicio externo.",
  HTTP_STATUS: "El servicio externo respondió un código de error: revisa URL, cabeceras y credenciales.",
  HTTP_FETCH: "No se pudo conectar al servicio externo (red, DNS o URL inválida).",
};

/** Cuenta items de una entrada/salida ({items:[…]} o array) para el modal. */
function countItemsOf(v: unknown): number | null {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === "object" && Array.isArray((v as { items?: unknown[] }).items)) return (v as { items: unknown[] }).items.length;
  return null;
}

/** Visor JSON (Historial): entrada/salida de cada paso, acotado. */
function JsonBox({ value, maxHeight = 190 }: { value: unknown; maxHeight?: number }) {
  let text: string;
  if (typeof value === "string") text = value;
  else { try { text = JSON.stringify(value, null, 2); } catch { text = String(value); } }
  return (
    <pre style={{ margin: "4px 0 0 15px", padding: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 6, fontSize: 10, color: "rgba(255,255,255,0.6)", overflowX: "auto", maxHeight, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
      {String(text ?? "—").slice(0, 2400)}
    </pre>
  );
}

// ── Disparo (nodo inicial, estilo n8n): vive en la paleta (sección Inicio) y
// en el lienzo como tarjeta arrastrable y CONECTABLE: su línea al primer nodo
// es organizativa (trigger.entry, no es una arista del graph) — el run sigue
// empezando en los nodos fuente y el engine no cambia. ──
const TRIGGER_META: Record<"manual" | "webhook" | "schedule" | "error", { label: string; color: string; hint: string }> = {
  manual: { label: "Disparo manual", color: "#22d3ee", hint: "Ejecútalo con ▶ Ejecutar o pídeselo a tu IA (flow_run)" },
  webhook: { label: "Disparo webhook", color: "#22d3ee", hint: "Un POST a la URL del webhook ejecuta el flow" },
  schedule: { label: "Disparo horario", color: "#22d3ee", hint: "Los horarios los ejecuta tu IA con flow_due_check + flow_run" },
  error: { label: "Disparo de error", color: "#f87171", hint: "Corre solo cuando OTRO flow de este workspace falla (recibe input.flowId, flowName, failedNode). Actívalo (Activo) para que reciba los fallos." },
};
const TRIGGER_ICONS: Record<"manual" | "webhook" | "schedule" | "error", React.ReactNode> = {
  manual: <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />,
  webhook: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>,
  schedule: <><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></>,
  error: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
};

type FrameInfo = { id: string; name: string; width: number; height: number; html: string; css: string };
const toFrameInfo = (f: any): FrameInfo => ({ id: f.id, name: f.name ?? f.id, width: f.width, height: f.height, html: String(f.html ?? ""), css: String(f.css ?? "") });

export function FlowEditor(props: {
  workspaceId: string;
  flow: FlowDef;
  credentials: FlowCredential[];
  onClose: () => void;
  onSaved: (flowId: string, webhookUrl?: string) => void;
  onNotice: (kind: "ok" | "err" | "info", text: string) => void;
  onRunFlow: (flowId: string) => unknown;
  running: boolean;
}) {
  const { workspaceId, credentials, onClose, onSaved, onNotice, onRunFlow, running } = props;
  const [name, setName] = useState(props.flow.name);
  const [enabled, setEnabled] = useState(props.flow.enabled);
  // D4-lite: candado de edición — flow_save lo impone server-side (solo admin
  // toca un flow bloqueado); el run NO se ve afectado.
  const [locked, setLocked] = useState(props.flow.locked === true);
  // Tags (D1) y variables (B10) como texto editable: se resuelven al guardar.
  const [tagsText, setTagsText] = useState((props.flow.tags ?? []).join(", "));
  const [varsText, setVarsText] = useState(props.flow.vars && Object.keys(props.flow.vars).length ? JSON.stringify(props.flow.vars, null, 0) : "");
  const [trigger, setTrigger] = useState<any>(props.flow.trigger ?? { type: "manual" });
  const [nodes, setNodes] = useState<FlowNode[]>(props.flow.nodes);
  const [edges, setEdges] = useState<FlowEdge[]>(props.flow.edges);
  const [selected, setSelected] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false); // acordeón del inspector: solo abre al clicar un nodo
  const [paletteOpen, setPaletteOpen] = useState(false); // columna derecha de nodos: OCULTA por defecto — solo el botón «+ Agregar nodo» o el doble clic en el vacío la abren
  const [panning, setPanning] = useState(false); // arrastra el fondo del lienzo para desplazarlo (cursor manito)
  const [connecting, setConnecting] = useState<{ from: string; when?: string } | null>(null);
  const [connectPoint, setConnectPoint] = useState<{ x: number; y: number } | null>(null); // cursor en coords de canvas — guía de conexión
  const [saving, setSaving] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [templateOptions, setTemplateOptions] = useState<{ id: string; name: string }[]>([]);
  const dragRef = useRef<{ id: string; ids: string[]; dx: number; dy: number; orig: Record<string, { x: number; y: number }>; pushed?: boolean } | null>(null);
  const triggerDragRef = useRef<{ dx: number; dy: number; pushed?: boolean } | null>(null); // arrastre del nodo inicial (disparo)
  const connectStartRef = useRef<{ x: number; y: number } | null>(null); // pointerdown del puerto — umbral clic vs arrastre
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(1); // espejo del zoom para handlers sin re-suscribir
  const fitPendingRef = useRef<{ cx: number; cy: number } | null>(null); // encuadre fit-view pendiente: se aplica tras el commit del zoom
  const panRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null); // origen del jalón del fondo
  type GraphSnap = { nodes: FlowNode[]; edges: FlowEdge[]; trigger: any };
  const undoRef = useRef<GraphSnap[]>([]); // snapshots de TODAS las mutaciones (n8n-style full undo)
  const redoRef = useRef<GraphSnap[]>([]);
  const graphRef = useRef<GraphSnap>({ nodes, edges, trigger: props.flow.trigger ?? { type: "manual" } });
  const [selectedEdge, setSelectedEdge] = useState<number | null>(null); // conexión seleccionada (índice) — Delete la borra
  const [editorTab, setEditorTab] = useState<"editor" | "historial">("editor"); // pestañas del builder, como en el resto de la web
  const [runs, setRuns] = useState<FlowRun[] | null>(null); // historial del flow actual (pestaña Historial)
  const [entrySel, setEntrySel] = useState(false); // línea disparo→nodo seleccionada (Delete la borra)
  const [zoom, setZoom] = useState(1); // zoom del lienzo: pinch del trackpad o ctrl+rueda (0.4–2)
  // ── Paridad n8n (FLOW_BUILDER_GAP_VS_N8N Fase 0/Fase 1) ──
  const [selIds, setSelIds] = useState<string[]>([]); // multi-selección: shift+clic o box con shift+arrastrar en el vacío
  const [boxSel, setBoxSel] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null); // rubber band (coords de contenido)
  const boxRef = useRef<{ x0: number; y0: number } | null>(null);
  const clipRef = useRef<{ nodes: FlowNode[]; edges: FlowEdge[] } | null>(null); // portapapeles Ctrl/Cmd+C → V
  const [pins, setPins] = useState<Record<string, string>>({}); // datos pineados (B7): anulan la ejecución del nodo en el próximo run
  const paletteInputRef = useRef<HTMLInputElement | null>(null);
  const [paletteQuery, setPaletteQuery] = useState("");
    const [paletteCategory, setPaletteCategory] = useState("todas"); // plan picker: chip de categoría activa
    const [paletteAdvanced, setPaletteAdvanced] = useState(() => localStorage.getItem("flows.paletteAdvanced") === "1"); // P2 visible
    const [paletteIndex, setPaletteIndex] = useState(0); // teclado: fila resaltada
    const [collapsedCats, setCollapsedCats] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem("flows.paletteCollapsed") ?? "{}"); } catch { return {}; } });
    const [recentKeys, setRecentKeys] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem("flows.recentNodes") ?? "[]"); } catch { return []; } });
  const [flowVersions, setFlowVersions] = useState<any[] | null>(null); // versiones de edición (D2, flow_get.versions)
  const [runsTick, setRunsTick] = useState(0); // re-consulta del historial tras Reintentar
  const [pinsRunning, setPinsRunning] = useState(false); // run con pines (B7) en curso
  const [retrying, setRetrying] = useState<string | null>(null); // re-ejecución desde Historial en curso
  // REQ-042 (feedback en vivo del run): steps por nodo vistos vía flow_history
  // mientras flow_run está en vuelo + estado final (la ✗ roja QUEDA hasta el
  // próximo run). active = el run sigue corriendo (nodo "en marcha" en verde).
  const [liveRun, setLiveRun] = useState<{ steps: Record<string, { ok: boolean; error?: string; waiting?: boolean }>; active: boolean } | null>(null);
  const [flowOptions, setFlowOptions] = useState<{ id: string; name: string }[] | null>(null); // flows del workspace (nodo subflow)
  const [scrollPos, setScrollPos] = useState({ x: 0, y: 0 }); // espejo del scroll del lienzo para el mini-mapa (A9)
  // Resultado del último run (nodo Vista previa): nodeId → output. Lo pintan
  // las tarjetas preview en el lienzo; se hidrata del Historial al abrir.
  const [lastRunSteps, setLastRunSteps] = useState<Record<string, any> | null>(null);
    // REQ-047 (modal de nodo estilo n8n): nodo abierto + run completo (steps con
    // input/output/error) que alimenta el modal; clickPos distingue clic de drag.
    const [nodeModal, setNodeModal] = useState<string | null>(null);
    const [lastRunFull, setLastRunFull] = useState<any | null>(null);
    const clickPosRef = useRef<{ x: number; y: number } | null>(null);

  const selectedNode = nodes.find((n) => n.id === selected) ?? null;

  // Alimenta las tarjetas preview con las salidas de un run terminado.
  const applyRunSteps = (res: any) => {
    if (!Array.isArray(res?.steps)) return; // fallo/early-return: conserva lo visible
    const steps = res.steps;
    setLastRunSteps(Object.fromEntries(steps.map((s: any) => [s.nodeId, s.output]).filter(([, v]: any) => v != null)));
        setLastRunFull({ ...res, ...(res?.wait?.expiresAt ? { expiresAt: res.wait.expiresAt } : {}) }); // REQ-047: run completo para el modal (el historial lo refinará al abrir)
  };

  // REQ-042 (feedback en vivo): envuelve la promesa de flow_run y sondea
  // flow_history (1.5s) mientras vuela — el backend persiste steps POR NODO
  // (onStep), así el canvas pinta progreso real: ✓ verde al pasar, ✗ rojo
  // donde falla (y ahí se queda). El resultado final SIEMPRE gana al sondeo.
  function stepsToMap(steps: any): Record<string, { ok: boolean; error?: string; waiting?: boolean }> {
    const map: Record<string, { ok: boolean; error?: string; waiting?: boolean }> = {};
    for (const s of Array.isArray(steps) ? steps : []) {
      if (!s?.nodeId) continue;
      // waiting: un paso ai_task NO es un éxito — el run quedó pausado ahí.
      map[String(s.nodeId)] = { ok: s.ok !== false, error: s.error?.message ? String(s.error.message).slice(0, 300) : undefined, waiting: s?.output?.waiting === true };
    }
    return map;
  }
  // REQ-047: estado de run legible — "waiting" NO es error (antes salía en
  // rojo y en inglés, y parecía un fallo cuando es una pausa por diseño).
  function runStatusInfo(status?: string): { label: string; color: string } | null {
    if (!status) return null;
    if (status === "waiting") return { label: "en espera de tu IA", color: "#fbbf24" };
    if (status === "running") return { label: "ejecutando", color: "#60a5fa" };
    if (status === "success") return { label: "completado", color: "#4ade80" };
    if (status === "failed" || status === "error") return { label: "falló", color: "#f87171" };
    return { label: status, color: "rgba(255,255,255,0.6)" };
  }
  function hace(ms: number): string {
    const m = Math.round(ms / 60000);
    if (m < 1) return "hace instantes";
    if (m < 60) return `hace ${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `hace ${h} h`;
    return `hace ${Math.round(h / 24)} d`;
  }
  function trackRun(p: Promise<any>): Promise<any> {
    setLiveRun({ steps: {}, active: true });
    let timer = 0;
    const stop = () => { if (timer) { window.clearInterval(timer); timer = 0; } };
    timer = window.setInterval(() => {
      if (!props.flow.id) return; // flow sin guardar: nada que sondear
      void mcpCall("flow_history", { flowId: props.flow.id, workspaceId, limit: 1 }).then((h: any) => {
        const r = h?.runs?.[0];
        if (!r) return;
        setLiveRun({ steps: stepsToMap(r.steps), active: r.status === "running" });
      }).catch(() => {});
    }, 1500);
    return p.then((res: any) => {
      stop();
      setLiveRun({ steps: stepsToMap(res?.steps), active: false });
      return res;
    }, (err: any) => {
      stop();
      setLiveRun(null);
      throw err;
    });
  }
  // Nodo "en marcha" (verde) durante un run vivo: el primero SIN step
  // recorriendo el grafo desde las entradas (aprox del walk del engine; es
  // feedback visual, no semántica de ramas).
  function liveNodeId(): string | null {
    if (!liveRun?.active) return null;
    const incoming = new Map<string, number>();
    const succ = new Map<string, string[]>();
    for (const e of edges) {
      if (e.when === "error") continue;
      incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
      const list = succ.get(e.from) ?? [];
      list.push(e.to);
      succ.set(e.from, list);
    }
    const queue = nodes.filter((n) => !incoming.get(n.id)).map((n) => n.id);
    const seen = new Set<string>();
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (!liveRun.steps[id] && nodes.some((n) => n.id === id)) return id;
      queue.push(...(succ.get(id) ?? []));
    }
    return null;
  }

  // ── Frames por template (cache): alimenta el select del inspector Y los
  // previews dentro de las tarjetas template del lienzo — UNA llamada
  // get_html_frames por template, no por nodo ni por selección. ──
  const [frameCache, setFrameCache] = useState<Record<string, FrameInfo[]>>({});
  const frameCacheRef = useRef<Record<string, FrameInfo[]>>({});
  const inflightFramesRef = useRef<Record<string, boolean>>({});
  const frameOptions = (selectedNode?.type === "template" && selectedNode.config?.templateId ? frameCache[String(selectedNode.config.templateId)] : undefined) ?? [];
  const tplKey = nodes.filter((n) => n.type === "template" && n.config?.templateId).map((n) => String(n.config.templateId)).sort().join(",");
  useEffect(() => {
    const ids = Array.from(new Set(tplKey ? tplKey.split(",") : []));
    const missing = ids.filter((id) => !frameCacheRef.current[id] && !inflightFramesRef.current[id]);
    if (!missing.length) return;
    missing.forEach((id) => { inflightFramesRef.current[id] = true; });
    let alive = true;
    Promise.all(missing.map((id) =>
      mcpCall("get_html_frames", { templateId: id })
        .then((res: any) => [id, (res?.frames ?? []).map(toFrameInfo)] as const)
        .catch((e) => { onNotice("err", `get_html_frames: ${e?.message ?? e}`); return [id, [] as FrameInfo[]] as const; })
    )).then((entries) => {
      if (!alive) return;
      const next = { ...frameCacheRef.current };
      entries.forEach(([id, frames]) => { next[id] = frames; delete inflightFramesRef.current[id]; });
      frameCacheRef.current = next;
      setFrameCache(next);
    });
    return () => { alive = false; };
  }, [tplKey, onNotice]);

  // Posición del nodo inicial: esquina del lienzo; si un nodo pisa esa zona
  // se corre a la derecha del más lejano para no encimarse.
  const triggerPos = (() => {
    if (!nodes.some((n) => n.position.x < 300 && n.position.y < 220)) return { x: 40, y: 40 };
    const maxX = nodes.reduce((m, n) => Math.max(m, n.position.x), 0);
    return { x: maxX + 60, y: 40 };
  })();

  const loadTemplateOptions = useCallback(async () => {
    try {
      const res = await mcpCall("list_templates", { workspaceId, limit: 100 });
      setTemplateOptions((res?.data ?? res?.templates ?? []).map((t: any) => ({ id: t.id, name: t.name ?? t.id })));
    } catch (e: any) {
      onNotice("err", `list_templates: ${e?.message ?? e}`);
    }
  }, [workspaceId, onNotice]);

  useEffect(() => {
    if (selectedNode?.type === "template" && templateOptions.length === 0) void loadTemplateOptions();
  }, [selectedNode?.type, templateOptions.length, loadTemplateOptions]);

  // Historial del flow (pestaña Historial): flow_history filtrado por flowId —
  // la MISMA tool que la pestaña runs de FlowsTab. Recarga al entrar y cada vez
  // que Reintentar (o un run con pines) termina (runsTick).
  useEffect(() => {
    if (editorTab !== "historial" || !props.flow.id) return;
    let alive = true;
    setRuns(null);
    mcpCall("flow_history", { workspaceId, flowId: props.flow.id, limit: 30 })
      .then((res: any) => { if (alive) setRuns(res?.runs ?? []); })
      .catch((e: any) => { if (alive) { setRuns([]); onNotice("err", `flow_history: ${e?.message ?? e}`); } });
    return () => { alive = false; };
  }, [editorTab, props.flow.id, workspaceId, onNotice, runsTick]);

  // Versiones de edición (plan D2): flow_get trae versions[] (snapshot previo
  // por cada save, acotado a 10). Si el server aún no expone la columna
  // (migración v63 pendiente), queda [] y la sección no se pinta.
  useEffect(() => {
    if (!props.flow.id) return;
    let alive = true;
    mcpCall("flow_get", { flowId: props.flow.id, workspaceId })
      .then((res: any) => { if (alive) setFlowVersions(Array.isArray(res?.flow?.versions) ? res.flow.versions : []); })
      .catch(() => { if (alive) setFlowVersions([]); });
    return () => { alive = false; };
  }, [props.flow.id, workspaceId]);

// Último run al abrir el editor (nodo Vista previa): muestra el resultado
// ANTERIOR sin re-correr — flow_history limit 1 de ESTE flow.
  useEffect(() => {
    setLastRunSteps(null);
    if (!props.flow.id) return;
    let alive = true;
    mcpCall("flow_history", { workspaceId, flowId: props.flow.id, limit: 1 })
      .then((res: any) => {
        const run = res?.runs?.[0];
        if (alive && Array.isArray(run?.steps) && run.steps.length) {
          setLastRunSteps(Object.fromEntries(run.steps.map((s: any) => [s.nodeId, s.output]).filter(([, v]: any) => v != null)));
          setLastRunFull(run); // REQ-047
        }
      })
      .catch(() => { /* sin historial: la vista queda vacía hasta correr */ });
    return () => { alive = false; };
  }, [props.flow.id, workspaceId]);

  // REQ-047 (modo vigilancia): un run waiting NO terminó — sondea flow_history
  // cada 8s mientras dure la espera: cuando tu IA atiende la tarea, el lienzo
  // despierta SOLO (badges azules de ejecución → verdes) sin recargar nada.
  const runStatus = lastRunFull?.status ?? null;
  useEffect(() => {
    if (runStatus !== "waiting" || !props.flow.id) return;
    let alive = true;
    const seenLen = Array.isArray(lastRunFull?.steps) ? lastRunFull.steps.length : -1;
    const timer = window.setInterval(() => {
      void mcpCall("flow_history", { workspaceId, flowId: props.flow.id, limit: 1 }).then((res: any) => {
        const r = res?.runs?.[0];
        if (!alive || !r) return;
        const len = Array.isArray(r.steps) ? r.steps.length : 0;
        // Repinta si el run dejó de esperar (retomó/terminó/falló) o si la
        // espera avanzó a OTRO nodo de espera (mismo status, más pasos).
        if (r.status !== "waiting" || len !== seenLen) {
          setLastRunFull({ ...r, ...(r.wait?.expiresAt ? { expiresAt: r.wait.expiresAt } : {}) });
          setLastRunSteps(Object.fromEntries((Array.isArray(r.steps) ? r.steps : []).map((s: any) => [s.nodeId, s.output]).filter(([, v]: any) => v != null)));
        }
      }).catch(() => { /* la espera sigue: reintenta en el próximo tick */ });
    }, 8000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [runStatus, props.flow.id, workspaceId]);

  // REQ-047: al abrir el modal de un nodo, refresca el run completo desde
  // flow_history — la fuente autoritativa con input+output+error por paso
  // (la respuesta de flow_run puede venir recortada).
  useEffect(() => {
    if (!nodeModal || !props.flow.id) return;
    let alive = true;
    mcpCall("flow_history", { workspaceId, flowId: props.flow.id, limit: 1 })
      .then((res: any) => {
        const r = res?.runs?.[0];
        if (alive && r && Array.isArray(r.steps) && r.steps.length) setLastRunFull(r);
      })
      .catch(() => { /* el modal usa el último run ya conocido */ });
    return () => { alive = false; };
  }, [nodeModal, props.flow.id, workspaceId]);

  // Flows del workspace (nodo subflow): se cargan UNA vez al configurar el
  // primer nodo subflow — flow_list, la misma tool del board.
  useEffect(() => {
    if (selectedNode?.type !== "subflow" || flowOptions) return;
    let alive = true;
    mcpCall("flow_list", { workspaceId })
      .then((res: any) => { if (alive) setFlowOptions((res?.flows ?? []).map((f: any) => ({ id: f.id, name: f.name }))); })
      .catch(() => { if (alive) setFlowOptions([]); });
    return () => { alive = false; };
  }, [selectedNode?.type, flowOptions, workspaceId]);

  // ── Drag de nodos (grupal si hay multi-selección) y del nodo inicial:
  // mantén presionado y jala — grid de 10px. El snapshot para undo se apila
  // ANTES del primer movimiento (graphRef aún guarda el estado previo). ──
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const tdrag = triggerDragRef.current;
      if (tdrag) {
        if (!tdrag.pushed) { pushUndo(); tdrag.pushed = true; }
        const x = Math.round(((e.clientX - rect.left + (canvasRef.current?.scrollLeft ?? 0)) / zoomRef.current - M_X - tdrag.dx) / 10) * 10;
        const y = Math.round(((e.clientY - rect.top + (canvasRef.current?.scrollTop ?? 0)) / zoomRef.current - M_Y - tdrag.dy) / 10) * 10;
        setTrigger((prev: any) => ({ ...(prev ?? { type: "manual" }), position: { x, y } }));
        return;
      }
      const drag = dragRef.current;
      if (!drag) return;
      if (!drag.pushed) { pushUndo(); drag.pushed = true; }
      const nx = Math.round(((e.clientX - rect.left + (canvasRef.current?.scrollLeft ?? 0)) / zoomRef.current - M_X - drag.dx) / 10) * 10;
      const ny = Math.round(((e.clientY - rect.top + (canvasRef.current?.scrollTop ?? 0)) / zoomRef.current - M_Y - drag.dy) / 10) * 10;
      const base = drag.orig[drag.id] ?? { x: 0, y: 0 };
      const ddx = nx - base.x;
      const ddy = ny - base.y;
      setNodes((prev) => prev.map((n) => (drag.ids.includes(n.id)
        ? { ...n, position: { x: (drag.orig[n.id]?.x ?? n.position.x) + ddx, y: (drag.orig[n.id]?.y ?? n.position.y) + ddy } }
        : n)));
    };
    const up = () => { dragRef.current = null; triggerDragRef.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, []);

  // ── Box-select (n8n): shift + arrastrar en el vacío dibuja una banda que
  // selecciona todos los nodos que toca. ──
  useEffect(() => {
    const canvasPoint = (e: PointerEvent) => {
      const el = canvasRef.current;
      if (!el) return { x: 0, y: 0 };
      const r = el.getBoundingClientRect();
      return { x: (e.clientX - r.left + el.scrollLeft) / zoomRef.current - M_X, y: (e.clientY - r.top + el.scrollTop) / zoomRef.current - M_Y };
    };
    const move = (e: PointerEvent) => {
      if (!boxRef.current) return;
      const p = canvasPoint(e);
      setBoxSel((prev) => (prev ? { ...prev, x1: p.x, y1: p.y } : prev));
    };
    const up = () => {
      if (!boxRef.current) return;
      const b = boxRef.current;
      boxRef.current = null;
      setBoxSel((cur) => {
        if (cur) {
          const x0 = Math.min(b.x0, cur.x1); const x1 = Math.max(b.x0, cur.x1);
          const y0 = Math.min(b.y0, cur.y1); const y1 = Math.max(b.y0, cur.y1);
          if (Math.abs(x1 - x0) > 6 || Math.abs(y1 - y0) > 6) {
            const ids = nodes.filter((n) => n.position.x < x1 && n.position.x + NODE_W > x0 && n.position.y < y1 && n.position.y + 96 > y0).map((n) => n.id);
            setSelIds(ids);
            if (ids.length) { setSelected(null); setInspectorOpen(false); }
          }
        }
        return null;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [nodes]);

  // ── Pan del lienzo: mantener clic en el vacío y jalar desplaza el scroll
  // del canvas (la manito pasa a "grabbing" mientras dura el jalón). ──
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const pan = panRef.current;
      const el = canvasRef.current;
      if (!pan || !el) return;
      el.scrollLeft = pan.sl - (e.clientX - pan.x);
      el.scrollTop = pan.st - (e.clientY - pan.y);
    };
    const up = () => { if (panRef.current) { panRef.current = null; setPanning(false); } };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, []);

  // ── Zoom del lienzo: pinch del trackpad (el navegador lo envía como
  // ctrl+rueda) o ctrl+rueda de mouse; el scroll de dos dedos SIN ctrl queda
  // como pan nativo del contenedor. El zoom ancla al cursor: el punto bajo el
  // puntero no se mueve mientras escala. Listener nativo NO pasivo para poder
  // hacer preventDefault (si no, el navegador hace zoom de la página). ──
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const vx = e.clientX - rect.left;
      const vy = e.clientY - rect.top;
      const z = zoomRef.current;
      const nz = Math.min(2, Math.max(0.4, z * Math.exp(-e.deltaY * 0.01)));
      if (nz === z) return;
      const ratio = nz / z;
      el.scrollLeft = (el.scrollLeft + vx) * ratio - vx;
      el.scrollTop = (el.scrollTop + vy) * ratio - vy;
      zoomRef.current = nz;
      setZoom(nz);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [editorTab]); // se resuscribe al volver del tab Historial (el canvas se remonta)

  // Lienzo infinito — al montar (y al volver del tab Historial) el viewport
  // salta AL FLOW (feedback v60.2: «que me lleve a donde está y donde se pueda
  // ver el flow completo»): encuadra trigger + nodos al centro y hace zoom out
  // automático si el grafo no cabe en pantalla (clamp 0.4–1, los mismos límites
  // de la rueda — nunca zoom-in por encima de 1 para flows chicos). Sin grafo,
  // centra el origen del contenido como antes. Deps intencionales: SOLO al
  // (re)montar el canvas — re-correrlo en cada drag secuestraría la vista.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || editorTab !== "editor") return;
    const tp = (trigger?.position ?? triggerPos) as { x: number; y: number };
    const boxW = (n: FlowNode) => (n.type === "group" ? Math.max(120, Math.min(4000, Number(n.config?.width) || 340)) : NODE_W);
    const xs = nodes.length ? [...nodes.map((n) => n.position.x), tp.x] : [0];
    const ys = nodes.length ? [...nodes.map((n) => n.position.y), tp.y] : [0];
    const x1 = nodes.length ? Math.max(...nodes.map((n) => n.position.x + boxW(n)), tp.x + NODE_W) : NODE_W;
    const y1 = nodes.length ? Math.max(...nodes.map((n) => n.position.y + 96), tp.y + 96) : 96;
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const bw = Math.max(1, x1 - x0);
    const bh = Math.max(1, y1 - y0);
    const pad = 80; // aire en px de pantalla alrededor del grafo
    const nz = Math.min(1, Math.max(0.4, Math.min((el.clientWidth - pad) / bw, (el.clientHeight - pad) / bh)));
    const cx = (x0 + bw / 2 + M_X) * nz;
    const cy = (y0 + bh / 2 + M_Y) * nz;
    if (nz === zoomRef.current) {
      el.scrollLeft = cx - el.clientWidth / 2;
      el.scrollTop = cy - el.clientHeight / 2;
    } else {
      // El scroll se aplica tras el commit del zoom (el wrapper ya mide
      // WORLD*zoom): así el extent nuevo no recorta el scroll asignado.
      fitPendingRef.current = { cx, cy };
      zoomRef.current = nz;
      setZoom(nz);
    }
  }, [editorTab]);

  // Aplica el encuadre pendiente después de que el zoom re-renderizó el
  // canvas (el guard espera a que el zoomRef y el estado coincidan —
  // evita consumir el ref en el mismo pase en que se creó).
  useEffect(() => {
    const el = canvasRef.current;
    const fit = fitPendingRef.current;
    if (!el || !fit || zoomRef.current !== zoom) return;
    fitPendingRef.current = null;
    el.scrollLeft = fit.cx - el.clientWidth / 2;
    el.scrollTop = fit.cy - el.clientHeight / 2;
  }, [zoom]);

  // Mini-mapa (A9): espejo del scroll del lienzo — listener pasivo; se
  // resuscribe al volver del tab Historial (el canvas se remonta).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || editorTab !== "editor") return;
    const onScroll = () => setScrollPos({ x: el.scrollLeft, y: el.scrollTop });
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [editorTab]);

  // ── Conexión de nodos: arrastra del puerto de salida y suelta sobre el
  // nodo de entrada (o clic en salida → clic en entrada). Mientras conectas,
  // una guía punteada sigue al cursor; Esc o clic en el vacío cancela. ──
  useEffect(() => {
    if (!connecting) { setConnectPoint(null); return; }
    const toCanvas = (e: PointerEvent) => {
      const el = canvasRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: (e.clientX - r.left + el.scrollLeft) / zoomRef.current - M_X, y: (e.clientY - r.top + el.scrollTop) / zoomRef.current - M_Y };
    };
    const move = (e: PointerEvent) => {
      const p = toCanvas(e);
      if (p) setConnectPoint(p);
    };
    const up = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const card = el?.closest("[data-connect-node]") as HTMLElement | null;
      const targetId = card?.getAttribute("data-connect-node") ?? null;
      if (targetId && targetId !== connecting.from) { completeConnection(targetId); return; }
      // Soltar casi sin mover = clic: queda el modo clic-clic (la guía sigue
      // al cursor hasta conectar). Soltar en el vacío tras arrastrar cancela.
      const start = connectStartRef.current;
      const moved = !start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4;
      if (moved) { setConnecting(null); setConnectPoint(null); }
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setConnecting(null); setConnectPoint(null); } };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key);
    };
  }, [connecting]);

  function addNode(entry: PaletteEntry) {
    const type = entry.type;
    const id = `${type.split("_")[0].replace("source", "src")}${nodes.length + 1}_${Math.random().toString(36).slice(2, 5)}`;
    const node: FlowNode = {
      id, type, label: entry.label, enabled: true, onError: type.startsWith("source") ? "continue" : "stop",
      config: entry.config(), position: { x: 40 + (nodes.length % 5) * 250, y: 40 + Math.floor(nodes.length / 5) * 150 },
    };
    setNodes((prev) => [...prev, node]);
    setSelected(id);
    setInspectorOpen(true); // el nodo nuevo nace con su panel abierto: se configura al instante
    setRecentKeys((prev) => {
      const next = [entry.key, ...prev.filter((k) => k !== entry.key)].slice(0, 8);
      try { localStorage.setItem("flows.recentNodes", JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  }

  function patchNode(id: string, patch: Partial<FlowNode>) {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }
  function patchConfig(id: string, patch: Record<string, any>) {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, config: { ...n.config, ...patch } } : n)));
  }

  // Paleta (plan FLOW_NODE_PICKER): búsqueda plana con badge de categoría o
  // secciones agrupadas; P2 solo con «Mostrar avanzadas»; recientes en
  // localStorage; ↑↓ + Enter agregan sin mouse.
  const paletteAll = paletteAdvanced ? [...NODE_PALETTE, ...NODE_PALETTE_ADVANCED] : NODE_PALETTE;
  const paletteQ = paletteQuery.trim().toLowerCase();
  const paletteMatches = paletteQ
    ? paletteAll.filter((p) => `${p.label} ${p.hint} ${p.category} ${p.keywords ?? ""} ${p.type}`.toLowerCase().includes(paletteQ))
    : paletteAll.filter((p) => paletteCategory === "todas" || p.category === paletteCategory);
  const paletteGroups = CATEGORIES
    .map((c) => [c.id, paletteMatches.filter((p) => p.category === c.id)] as const)
    .filter(([, list]) => list.length > 0);
  const recentEntries = recentKeys.map((k) => paletteAll.find((p) => p.key === k)).filter((p): p is PaletteEntry => !!p);
  const catLabel = (id: string) => CATEGORIES.find((c) => c.id === id)?.label ?? id;
  const catColor = (id: string) => CATEGORIES.find((c) => c.id === id)?.color ?? "#94a3b8";

  function paletteRow(p: PaletteEntry, idx: number, withCategory: boolean) {
    const color = p.color ?? NODE_META[p.type]?.color ?? "#94a3b8";
    const active = idx >= 0 && idx === paletteIndex;
    return (
      <button key={p.key} type="button" onClick={() => addNode(p)} title={p.hint} onMouseEnter={() => { if (idx >= 0) setPaletteIndex(idx); }}
        style={{ ...btnBase, justifyContent: "flex-start", gap: 8, borderColor: active ? color : `${color}55`, background: active ? `${color}1f` : "rgba(255,255,255,0.05)" }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
        <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.label}</span>
        {p.tier === 0 && <span style={{ fontSize: 8, padding: "1px 4px", borderRadius: 4, border: "1px solid rgba(52,211,153,0.45)", color: "#6ee7b7", flexShrink: 0 }}>P0</span>}
        {p.tier === 2 && <span style={{ fontSize: 8, padding: "1px 4px", borderRadius: 4, border: "1px solid rgba(148,163,184,0.45)", color: "rgba(255,255,255,0.55)", flexShrink: 0 }}>P2</span>}
        {withCategory && <span style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", flexShrink: 0 }}>{catLabel(p.category)}</span>}
      </button>
    );
  }

  // Cambio de tipo de disparo SIN resetear lo visual: la posición en el
  // lienzo y la línea al nodo de entrada (entry) se conservan — solo cambian
  // las condiciones internas (cron/zona se precargan al pasar a schedule y
  // se conservan si vuelves a schedule).
  function setTriggerType(t: "manual" | "webhook" | "schedule" | "error") {
    setTrigger((prev: any) => {
      const next = { ...(prev ?? {}), type: t };
      if (t === "schedule" && !next.cron) { next.cron = "0 8 * * *"; if (!next.timezone) next.timezone = "America/Lima"; }
      return next;
    });
  }

  function completeConnection(targetId: string) {
    if (!connecting || connecting.from === targetId) { setConnecting(null); setConnectPoint(null); return; }
    const target = nodes.find((n) => n.id === targetId);
    if (target?.type === "note" || target?.type === "group") {
      // Visuales: no participan del grafo (flow_save rechaza sus edges) —
      // la conexión se cancela con aviso.
      setConnecting(null);
      setConnectPoint(null);
      onNotice("info", target.type === "group" ? "Los grupos no se conectan: son solo visuales." : "Las notas no se conectan: son solo visuales.");
      return;
    }
    if (connecting.from === "__trigger__") {
      // Disparo → nodo: línea organizativa. Vive en el trigger (entry), NO en
      // edges: el run empieza siempre en los nodos fuente (contrato del
      // engine) y flow_save no aceptaría una arista hacia un id ajeno.
      setTrigger((prev: any) => ({ ...(prev ?? { type: "manual" }), entry: targetId }));
      setConnecting(null);
      setConnectPoint(null);
      setEntrySel(false);
      return;
    }
    // Fan-in (varias entradas): mismo set que valida flow_save — ai/report
    // agregan streams; merge/loop/code se suman en la paridad n8n (Fase 2).
    const fanIn = target != null && ["ai", "report", "merge", "loop", "code", "compare", "sort", "dedupe", "aggregate", "limit"].includes(target.type);
    setEdges((prev) => {
      // Un nodo = una entrada (reemplaza la arista entrante previa), EXCEPTO ai
      // que admite fan-in de varias fuentes — igual que valida flow_save.
      const cleaned = fanIn ? prev : prev.filter((e) => e.to !== targetId);
      const next: FlowEdge = { from: connecting.from, to: targetId };
      if (connecting.when) next.when = connecting.when;
      return [...cleaned, next];
    });
    setConnecting(null);
    setConnectPoint(null);
  }

  // ── Undo/redo completo (n8n-style): cada mutación (mover, conectar, borrar,
  // editar, pegar) apila un snapshot {nodes, edges, trigger}; Ctrl+Z retrocede,
  // Ctrl+Shift+Z / Ctrl+Y avanza. graphRef evita snapshots con estado viejo. ──
  useEffect(() => { graphRef.current = { nodes, edges, trigger }; });
  const cloneSnap = (g: GraphSnap): GraphSnap => ({
    nodes: g.nodes.map((n) => ({ ...n, config: { ...n.config } })),
    edges: g.edges.map((e) => ({ ...e })),
    trigger: g.trigger ? { ...g.trigger } : g.trigger,
  });
  function pushUndo() {
    undoRef.current.push(cloneSnap(graphRef.current));
    if (undoRef.current.length > 80) undoRef.current.shift();
    redoRef.current = [];
  }
  function undo() {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(cloneSnap(graphRef.current));
    applySnap(prev);
  }
  function redo() {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(cloneSnap(graphRef.current));
    applySnap(next);
  }
  function applySnap(snap: GraphSnap) {
    setNodes(snap.nodes);
    setEdges(snap.edges);
    setTrigger(snap.trigger ?? { type: "manual" });
    setSelected(null); setSelIds([]); setSelectedEdge(null); setEntrySel(false); setInspectorOpen(false);
  }

  function deleteNode(id: string) {
    pushUndo();
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.from !== id && e.to !== id));
    if (graphRef.current.trigger?.entry === id) {
      // El nodo borrado era el destino de la línea del disparo: muere con él.
      setTrigger((prev: any) => { const next = { ...(prev ?? { type: "manual" }) }; delete next.entry; return next; });
      setEntrySel(false);
    }
    setSelected(null);
    setSelectedEdge(null);
    setEntrySel(false);
    setInspectorOpen(false);
  }

  /** Delete global: borra la conexión seleccionada, la línea del disparo o
   *  TODA la selección (nodo seleccionado + multi-selección). */
  function deleteSelection(): boolean {
    if (selectedEdge != null) {
      pushUndo();
      setEdges((prev) => prev.filter((_, idx) => idx !== selectedEdge));
      setSelectedEdge(null);
      return true;
    }
    if (entrySel) {
      pushUndo();
      setTrigger((prev: any) => { const next = { ...(prev ?? { type: "manual" }) }; delete next.entry; return next; });
      setEntrySel(false);
      return true;
    }
    const ids = Array.from(new Set([...(selected && selected !== "__trigger__" ? [selected] : []), ...selIds]));
    if (!ids.length) return false;
    pushUndo();
    setNodes((prev) => prev.filter((n) => !ids.includes(n.id)));
    setEdges((prev) => prev.filter((e) => !ids.includes(e.from) && !ids.includes(e.to)));
    if (ids.includes(graphRef.current.trigger?.entry ?? "")) {
      setTrigger((prev: any) => { const next = { ...(prev ?? { type: "manual" }) }; delete next.entry; return next; });
      setEntrySel(false);
    }
    setSelected(null); setSelIds([]); setSelectedEdge(null); setEntrySel(false); setInspectorOpen(false);
    return true;
  }

  // ── Copiar/pegar/duplicar (n8n): Ctrl+C guarda nodos+edges internos en el
  // portapapeles; Ctrl+V los pega desplazados con ids nuevos; Ctrl+D duplica
  // la selección in situ. ──
  function buildClip() {
    const ids = new Set([...(selected && selected !== "__trigger__" ? [selected] : []), ...selIds]);
    if (!ids.size) return null;
    const cn = nodes.filter((n) => ids.has(n.id)).map((n) => ({ ...n, config: { ...n.config } }));
    if (!cn.length) return null;
    const idset = new Set(cn.map((n) => n.id));
    const ce = edges.filter((e) => idset.has(e.from) && idset.has(e.to)).map((e) => ({ ...e }));
    return { nodes: cn, edges: ce };
  }
  function copySelection() {
    const clip = buildClip();
    if (!clip) return;
    clipRef.current = clip;
    onNotice("info", `${clip.nodes.length} nodo(s) copiados — Ctrl/Cmd+V para pegar.`);
  }
  function pasteFrom(clip: { nodes: FlowNode[]; edges: FlowEdge[] }) {
    pushUndo();
    const map = new Map<string, string>();
    const stamp = Math.random().toString(36).slice(2, 6);
    const nn = clip.nodes.map((n, i) => {
      const id = `${n.type.split("_")[0].replace("source", "src")}${nodes.length + i + 1}_${stamp}`;
      map.set(n.id, id);
      return { ...n, id, config: { ...n.config }, position: { x: n.position.x + 28, y: n.position.y + 28 } };
    });
    const ne = clip.edges
      .filter((e) => map.has(e.from) && map.has(e.to))
      .map((e) => ({ from: map.get(e.from)!, to: map.get(e.to)!, ...(e.when ? { when: e.when } : {}) }));
    setNodes((prev) => [...prev, ...nn]);
    setEdges((prev) => [...prev, ...ne]);
    setSelIds(nn.map((n) => n.id));
    setSelected(null); setSelectedEdge(null); setEntrySel(false); setInspectorOpen(false);
  }
  function pasteClipboard() {
    if (clipRef.current?.nodes.length) pasteFrom(clipRef.current);
  }
  function duplicateSelection() {
    const clip = buildClip();
    if (clip) pasteFrom(clip);
  }

  // Auto-organizar (plan A9-lite): capas por BFS desde las raíces — x por nivel,
  // y por índice dentro del nivel. Las notas no se mueven. Ctrl+Z deshace.
  function autoLayout() {
    pushUndo();
    const outgoingMap = new Map<string, string[]>();
    const incoming = new Map<string, number>();
    for (const n of nodes) { outgoingMap.set(n.id, []); incoming.set(n.id, 0); }
    for (const e of edges) {
      if (!outgoingMap.has(e.from) || !incoming.has(e.to)) continue; // notas u aristas huérfanas
      outgoingMap.get(e.from)!.push(e.to);
      incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
    }
    const visible = nodes.filter((n) => n.type !== "note" && n.type !== "group");
    const level = new Map<string, number>();
    const q = visible.filter((n) => (incoming.get(n.id) ?? 0) === 0).map((n) => { level.set(n.id, 0); return n.id; });
    while (q.length) {
      const id = q.shift()!;
      for (const to of outgoingMap.get(id) ?? []) {
        if (!level.has(to)) { level.set(to, (level.get(id) ?? 0) + 1); q.push(to); }
      }
    }
    for (const n of visible) if (!level.has(n.id)) level.set(n.id, 0); // ciclos/huérfanos → col 0
    const cols = new Map<number, string[]>();
    for (const n of visible) {
      const l = level.get(n.id) ?? 0;
      if (!cols.has(l)) cols.set(l, []);
      cols.get(l)!.push(n.id);
    }
    setNodes((prev) => prev.map((n) => {
      if (n.type === "note" || n.type === "group") return n; // visuales: no se mueven
      const l = level.get(n.id) ?? 0;
      const col = cols.get(l) ?? [];
      const row = Math.max(0, col.indexOf(n.id));
      return { ...n, position: { x: 60 + l * 300, y: 40 + row * 170 } };
    }));
    onNotice("ok", "Nodos organizados por capas (Ctrl+Z para deshacer).");
  }

  async function save() {
    if (locked) { onNotice("err", "El flow está bloqueado: solo un admin puede guardarlo (D4-lite)."); return; }
    setSaving(true);
    try {
      // Tags (D1): lista por comas. Variables (B10): JSON de escalares.
      const tags = tagsText.split(",").map((t) => t.trim()).filter(Boolean);
      let vars: Record<string, unknown> = {};
      if (varsText.trim()) {
        try { vars = JSON.parse(varsText); } catch { onNotice("err", "Variables: JSON inválido — corrígelo o vacía el campo para guardar."); setSaving(false); return; }
      }
      const params: Record<string, any> = {
        workspaceId, name, enabled,
        trigger: trigger?.type ? trigger : { type: "manual" },
        nodes: nodes.map((n) => ({ id: n.id, type: n.type, label: n.label, enabled: n.enabled !== false, onError: n.onError, retry: n.retry || undefined, config: n.config, position: n.position })),
        edges,
        tags,
        vars,
        // Flows-brand: el editor aún no edita inputs — los PRESERVA tal cual
        // (se definen por flow_save/MCP); soltarlos borraría el mini-form.
        ...(Array.isArray(props.flow.inputs) && props.flow.inputs.length ? { inputs: props.flow.inputs } : {}),
        locked: locked || undefined, // D4-lite: viaja con el save (ausente = preserva la anterior)
      };
      if (props.flow.id) params.id = props.flow.id;
      const res = await mcpCall("flow_save", params);
      if (res?.webhookUrl) setWebhookUrl(String(res.webhookUrl));
      onNotice("ok", res?.enabled ? `Flow guardado y activo (${res.flowId}).` : `Borrador guardado (${res.flowId}).`);
      onSaved(String(res.flowId), res?.webhookUrl ? String(res.webhookUrl) : undefined);
    } catch (e: any) {
      onNotice("err", String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  // Guardado por teclado: Ctrl+S (Windows/Linux) y Cmd+S (macOS). El botón
  // Guardar sigue siendo el camino visible; el ref evita re-suscribir por render.
  const saveRef = useRef({ save, saving });
  useEffect(() => { saveRef.current = { save, saving }; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        if (!saveRef.current.saving) void saveRef.current.save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Teclado del builder (n8n-style): Delete/Backspace borra TODA la
  // selección (conexión, línea del disparo, nodo o grupo); Ctrl+Z / Ctrl+Shift+Z
  // / Ctrl+Y undo/redo completo; Ctrl+C/V/D copiar/pegar/duplicar; Tab abre la
  // paleta con el buscador enfocado. Ignora teclas mientras se escribe en un
  // campo y fuera de la pestaña Editor. ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editorTab !== "editor") return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const key = String(e.key).toLowerCase();
      if (ctrl && !e.altKey && key === "z") {
        e.preventDefault(); e.stopPropagation();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (ctrl && !e.altKey && key === "y") {
        e.preventDefault(); e.stopPropagation();
        redo();
        return;
      }
      if (ctrl && !e.altKey && key === "c") { copySelection(); return; }
      if (ctrl && !e.altKey && key === "v") { e.preventDefault(); pasteClipboard(); return; }
      if (ctrl && !e.altKey && key === "d") { e.preventDefault(); e.stopPropagation(); duplicateSelection(); return; }
      if (e.key === "Tab" && !ctrl) {
        e.preventDefault();
        setPaletteOpen(true);
        setTimeout(() => paletteInputRef.current?.focus(), 80);
        return;
      }
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      e.preventDefault();
      deleteSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editorTab, selected, selectedEdge, entrySel, selIds, nodes, edges, trigger]);

  async function exportJson() {
    try {
      if (!props.flow.id) { onNotice("info", "Guarda el flow antes de exportarlo."); return; }
      const res = await mcpCall("flow_export", { flowId: props.flow.id, workspaceId });
      downloadBlob(new Blob([String(res.json ?? JSON.stringify(res.export, null, 2))], { type: "application/json" }), `${name.replace(/[^\w-]+/g, "_") || "flow"}.json`);
      onNotice("ok", "Exportado sin credenciales (credentialId removidos por diseño).");
    } catch (e: any) {
      onNotice("err", String(e?.message ?? e));
    }
  }

  async function rotateWebhook() {
    if (!props.flow.id) return;
    try {
      const res = await mcpCall("flow_webhook_rotate", { flowId: props.flow.id, workspaceId });
      if (res?.webhookUrl) setWebhookUrl(String(res.webhookUrl));
      onNotice("ok", "Webhook rotado: la URL anterior quedó muerta. Copia la nueva (se muestra solo esta vez).");
    } catch (e: any) {
      onNotice("err", String(e?.message ?? e));
    }
  }

  // ── Run con pines (B7): flow_run con input.__pins — los nodos pineados NO
  // se ejecutan y usan estos datos. La herramienta de debug n8n-style. ──
  async function runWithPins() {
    if (!props.flow.id || pinsRunning) return;
    setPinsRunning(true);
    try {
      const parsed: Record<string, unknown> = {};
      for (const [id, raw] of Object.entries(pins)) {
        if (!raw?.trim()) continue;
        try { parsed[id] = JSON.parse(raw); } catch { parsed[id] = raw; }
      }
      const res = await trackRun(mcpCall("flow_run", { flowId: props.flow.id, workspaceId, input: { __pins: parsed } }));
      applyRunSteps(res);
      const ok = res?.status === "success";
      onNotice(ok ? "ok" : "err", ok ? `Run con pines OK (${res.runId}).` : `Run con pines falló: ${res?.error?.message ?? res?.error ?? "ver Historial"}.`);
      setRunsTick((t) => t + 1);
    } catch (e: any) {
      onNotice("err", `flow_run: ${e?.message ?? e}`);
    } finally {
      setPinsRunning(false);
    }
  }

  // Reintentar desde el Historial: MISMA flow_run que el botón Ejecutar —
  // nueva corrida del flow con su input por defecto (el run original queda
  // intacto en el historial para comparar).
  async function rerunRun() {
    if (!props.flow.id || retrying) return;
    setRetrying("__all__");
    try {
      const res = await trackRun(mcpCall("flow_run", { flowId: props.flow.id, workspaceId }));
      applyRunSteps(res);
      onNotice(res?.status === "success" ? "ok" : "err", `Re-ejecutado (${res?.runId}): ${res?.status}.`);
      setRunsTick((t) => t + 1);
    } catch (e: any) {
      onNotice("err", `flow_run: ${e?.message ?? e}`);
    } finally {
      setRetrying(null);
    }
  }

  // F8 (n8n "Run from node"): re-ejecuta desde un paso del Historial — los
  // ancestros del nodo en el grafo ACTUAL se pinean con SUS salidas de ESTE run
  // (input.__pins) y solo el nodo elegido hacia adelante se ejecuta de verdad.
  // Usa el flow GUARDADO (igual que cualquier run); salidas truncadas a 4KB.
  async function rerunFromStep(run: FlowRun, step: FlowRunStep) {
    if (!props.flow.id || retrying) return;
    setRetrying(step.nodeId);
    try {
      if (!nodes.some((n) => n.id === step.nodeId)) {
        onNotice("err", `El nodo ${step.label} ya no existe en el editor; guarda/sincroniza el flow y reintenta.`);
        return;
      }
      const outs = new Map((run.steps ?? []).map((s) => [s.nodeId, s.output]));
      const ancestors = new Set<string>();
      const stack = [step.nodeId];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const e of edges) {
          if (e.to !== cur || ancestors.has(e.from)) continue;
          ancestors.add(e.from);
          stack.push(e.from);
        }
      }
      const pins: Record<string, unknown> = {};
      for (const id of ancestors) {
        if (!outs.has(id)) continue; // no corrió en ese run: se ejecuta de verdad
        pins[id] = outs.get(id) ?? null;
      }
      const res = await trackRun(mcpCall("flow_run", { flowId: props.flow.id, workspaceId, input: Object.keys(pins).length ? { __pins: pins } : {} }));
      applyRunSteps(res);
      const ok = res?.status === "success";
      onNotice(ok ? "ok" : "err", `Re-run desde "${step.label}" (${res?.runId}): ${res?.status}.`);
      setRunsTick((t) => t + 1);
    } catch (e: any) {
      onNotice("err", `flow_run: ${e?.message ?? e}`);
    } finally {
      setRetrying(null);
    }
  }

  // Restaurar versión (plan D2): vuelve el editor al snapshot elegido — NO
  // guarda: el usuario revisa y confirma con Guardar (que archiva la actual).
  function restoreVersion(v: any) {
    if (!v?.nodes || !Array.isArray(v.nodes)) { onNotice("err", "Versión sin nodos: no se puede restaurar."); return; }
    pushUndo();
    setNodes(v.nodes);
    setEdges(Array.isArray(v.edges) ? v.edges : []);
    setTrigger(v.trigger ?? { type: "manual" });
    onNotice("info", `Versión del ${String(v.at ?? "").slice(0, 16).replace("T", " ")} cargada en el editor — Guardar para hacerla definitiva.`);
    setEditorTab("editor");
  }

  // Zoom por pasos (botones del chip −/%/+): ancla al centro del viewport.
  const setZoomStep = (dir: 1 | -1) => {
    const el = canvasRef.current;
    const z = zoomRef.current;
    const nz = Math.min(2, Math.max(0.4, Math.round((z + dir * 0.1) * 10) / 10));
    if (!el || nz === z) return;
    const vx = el.clientWidth / 2;
    const vy = el.clientHeight / 2;
    const ratio = nz / z;
    el.scrollLeft = (el.scrollLeft + vx) * ratio - vx;
    el.scrollTop = (el.scrollTop + vy) * ratio - vy;
    zoomRef.current = nz;
    setZoom(nz);
  };

  const portPos = (node: FlowNode, when?: string) => ({ x: node.position.x + NODE_W, y: node.position.y + portTop(node, when) });
  const inPos = (node: FlowNode) => ({ x: node.position.x, y: node.position.y + 30 });

  // Multi-selección: pinta anillo cian en los nodos del grupo (además del
  // seleccionado individual). Se consume en el drag grupal y en Delete.
  const isGrouped = (id: string) => selIds.includes(id) && selIds.length > 0;

  // ── Pestaña Historial: últimas ejecuciones de ESTE flow (flow_history). ──
  const statusColor = (s: string) => (s === "success" ? "#4ade80" : s === "failed" ? "#f87171" : s === "waiting" ? "#38bdf8" : "#fbbf24");

  // Diff visual de versiones (plan D2): compara el snapshot con el editor
  // ACTUAL por id de nodo — añadidos/quitados/cambiados (cambia label, config,
  // tipo, enabled o posición).
  function diffVersion(v: any): { added: string[]; removed: string[]; changed: string[] } {
    const snap = (n: any) => JSON.stringify({ t: n.type, l: n.label, c: n.config ?? {}, e: n.enabled, p: n.position });
    const cur = new Map<string, string>(nodes.map((n): [string, string] => [n.id, snap(n)]));
    const old = new Map<string, string>((Array.isArray(v?.nodes) ? v.nodes : []).map((n: any): [string, string] => [String(n.id), snap(n)]));
    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];
    for (const [id, s] of old) { if (!cur.has(id)) added.push(id); else if (cur.get(id) !== s) changed.push(id); }
    for (const id of cur.keys()) if (!old.has(id)) removed.push(id);
    return { added, removed, changed };
  }
  function renderHistorial() {
    return (
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", flex: 1, minWidth: 200 }}>
            Últimas ejecuciones de este flow. ▶ Ejecutar usa la MISMA flow_run que tu IA o el webhook. Clic en un paso para ver su entrada/salida.
          </div>
          {props.flow.id && (
            <button type="button" className="workspace-button" disabled={retrying != null || running} onClick={() => void rerunRun()}
              style={{ opacity: retrying != null || running ? 0.5 : 1 }} title="Lanza una corrida nueva con flow_run (los runs anteriores quedan en el historial)">
              {retrying != null ? "Ejecutando…" : "↻ Reintentar"}
            </button>
          )}
        </div>
        {!runs ? (
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Cargando historial…</div>
        ) : runs.length === 0 ? (
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Sin ejecuciones todavía.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {runs.map((r) => (
              <details key={r.runId} style={{ background: "#131318", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "9px 12px" }}>
                <summary style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "rgba(255,255,255,0.85)", listStyle: "none" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 8, background: statusColor(r.status), flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, textTransform: "capitalize" }}>{r.status}</span>
                  {r.status === "waiting" && r.waitingKind && (
                    <span title={r.title ?? "Run en pausa"} style={{ fontSize: 10, color: "#c4b5fd", border: "1px solid rgba(196,181,253,0.45)", borderRadius: 999, padding: "1px 8px" }}>
                      {r.waitingKind === "ai" ? `IA${r.title ? `: ${r.title}` : ""}` : r.waitingKind === "approval" ? "aprobación" : "webhook"}
                    </span>
                  )}
                  <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 11 }}>{new Date(r.startedAt).toLocaleString()}</span>
                  {r.finishedAt && <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 11 }}>→ {new Date(r.finishedAt).toLocaleTimeString()}</span>}
                  <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 11, marginLeft: "auto" }}>{r.steps?.length ?? 0} pasos</span>
                </summary>
                {r.error && <div style={{ marginTop: 8, fontSize: 11, color: "#fca5a5" }}>{r.error}</div>}
                {!!r.steps?.length && (
                  <div style={{ marginTop: 8, display: "grid", gap: 2 }}>
                    {r.steps.map((s, si) => (
                      <details key={`${r.runId}-${si}`} style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "4px 0" }}>
                        <summary style={{ cursor: "pointer", display: "flex", gap: 8, fontSize: 11, color: "rgba(255,255,255,0.6)", listStyle: "none", flexWrap: "wrap", alignItems: "center" }}>
                          <span style={{ color: s.ok ? "#4ade80" : "#f87171" }}>{s.ok ? "ok" : "fail"}</span>
                          <span style={{ color: "rgba(255,255,255,0.8)" }}>{s.label}</span>
                          <span style={{ color: "rgba(255,255,255,0.35)" }}>{s.type} · {s.ms}ms</span>
                          {s.pinned && <span title="Este paso usó datos pineados: no se ejecutó" style={{ color: "#fbbf24", fontSize: 10 }}>pineado</span>}
                          {s.error && <span style={{ color: "#fca5a5" }}>{s.error.code}: {s.error.message}</span>}
                          {props.flow.id && (
                            <button type="button" onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); void rerunFromStep(r, s); }} disabled={retrying != null}
                              style={{ ...btnBase, padding: "1px 7px", fontSize: 10, marginLeft: "auto", flexShrink: 0, opacity: retrying != null ? 0.5 : 1 }}
                              title="F8 (n8n 'Run from node'): re-ejecuta pineando los ancestros de este nodo con SUS salidas de este run (usa el flow guardado)">▶ desde aquí</button>
                          )}
                        </summary>
                        {s.input !== undefined && (
                          <div>
                            <div style={{ ...labelStyle, margin: "4px 0 0 15px" }}>Entrada</div>
                            <JsonBox value={s.input} />
                          </div>
                        )}
                        {s.output !== undefined && (
                          <div>
                            <div style={{ ...labelStyle, margin: "4px 0 0 15px" }}>Salida</div>
                            <JsonBox value={s.output} />
                          </div>
                        )}
                      </details>
                    ))}
                  </div>
                )}
              </details>
            ))}
          </div>
        )}
        {/* Versiones de edición (plan D2): snapshot previo por cada Guardar.
            Restaurar carga el snapshot en el editor — Guardar lo hace definitivo. */}
        {flowVersions != null && flowVersions.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={labelStyle}>Versiones ({flowVersions.length} · queda la anterior de cada Guardar)</div>
            <div style={{ display: "grid", gap: 6 }}>
              {flowVersions.map((v, vi) => (
                <details key={vi} style={{ background: "#131318", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "8px 12px" }}>
                  <summary style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontSize: 11.5, color: "rgba(255,255,255,0.8)", listStyle: "none" }}>
                    <span style={{ color: "rgba(255,255,255,0.45)" }}>{String(v.at ?? "").slice(0, 16).replace("T", " ")}</span>
                    <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name ?? "—"}</span>
                    <span style={{ color: "rgba(255,255,255,0.35)" }}>{Array.isArray(v.nodes) ? v.nodes.length : 0} nodos</span>
                    <span style={{ marginLeft: "auto", flexShrink: 0 }}>
                      <button type="button" onClick={(e) => { e.stopPropagation(); restoreVersion(v); }}
                        style={{ ...btnBase, padding: "2px 9px", fontSize: 11 }} title="Carga esta versión en el editor (luego Guardar para confirmar)">Restaurar</button>
                    </span>
                  </summary>
                  {(() => {
                    // Diff visual (D2): añadidos/quitados/cambiados vs el editor actual.
                    const d = diffVersion(v);
                    return (
                      <div style={{ marginTop: 6, display: "flex", gap: 10, flexWrap: "wrap", fontSize: 10.5 }}>
                        <span style={{ color: d.added.length ? "#4ade80" : "rgba(255,255,255,0.3)" }}>+{d.added.length} nuevos</span>
                        <span style={{ color: d.removed.length ? "#f87171" : "rgba(255,255,255,0.3)" }}>−{d.removed.length} quitados</span>
                        <span style={{ color: d.changed.length ? "#fbbf24" : "rgba(255,255,255,0.3)" }}>~{d.changed.length} cambiados</span>
                        <span style={{ color: "rgba(255,255,255,0.28)" }}>vs el editor actual</span>
                      </div>
                    );
                  })()}
                  {!!v.nodes?.length && (
                    <div style={{ marginTop: 6, display: "grid", gap: 2 }}>
                      {v.nodes.slice(0, 40).map((vn: any, ni: number) => (
                        <div key={ni} style={{ fontSize: 10.5, color: "rgba(255,255,255,0.5)" }}>
                          {NODE_META[vn.type]?.label ?? vn.type} · {vn.label}
                        </div>
                      ))}
                    </div>
                  )}
                </details>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Página, no popup: el builder vive DENTRO del tab de Flows, debajo de la
  // navbar global (que queda visible con todas sus pestañas) y «Volver»
  // regresa al board. Al ser una página con deep-link propio
  // (#workspace/flows/<pane>/<flowId>), el refresh entra directo acá.
  return (
    <div className="flow-shell" style={{ height: "100%", background: "#0e0e12", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Barra superior — el mismo chrome que el resto de la web: fila con
            pestañas (.crm-nav-tab) y fila de acciones (.crm-contacts-toolbar
            + .workspace-button). */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px 4px", flexWrap: "wrap" }}>
          {/* Volver: regresa al board de Mis flows — el builder es una página
              dentro del tab, no un popup que se cierra. */}
          <button type="button" onClick={onClose} className="crm-nav-tab" title="Volver a Mis flows" aria-label="Volver a Mis flows">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
          </button>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del flow"
            style={{ ...inputStyle, width: 220, fontSize: 13, fontWeight: 600, background: "rgba(255,255,255,0.05)" }} />
          {/* Activo/Borrador como switch (n8n): es el estado del flow entero. */}
          <span title={enabled ? "Activo: flow_save validará TODO configurado" : "Borrador: admite nodos template sin archivo+frame"}
            onClick={() => setEnabled(!enabled)}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", userSelect: "none" }}>
            <Switch on={enabled} onToggle={() => setEnabled(!enabled)} />
            <span style={{ fontSize: 11.5, fontWeight: 600, color: enabled ? "#4ade80" : "rgba(255,255,255,0.55)" }}>{enabled ? "Activo" : "Borrador"}</span>
          </span>
          {/* REQ-047: chip del último run — la visibilidad que faltaba
              (n8n-feel): espera/ejecución/fin SIN abrir el modal. Clic →
              pestaña Historial. El modo vigilancia lo mantiene vivo. */}
          {(() => {
            if (liveRun?.active) {
              return <span title="El run está en marcha" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "#93c5fd", border: "1px solid rgba(96,165,250,0.5)", background: "rgba(96,165,250,0.12)", borderRadius: 999, padding: "3px 11px" }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.2-8.56" /></svg>
                Ejecutando…</span>;
            }
            const rs = runStatusInfo(lastRunFull?.status);
            if (!rs) return null;
            const age = lastRunFull?.startedAt ? hace(Date.now() - new Date(lastRunFull.startedAt).getTime()) : "";
            const exp = lastRunFull?.status === "waiting" && lastRunFull?.expiresAt ? ` · expira en ${Math.max(0, Math.round((new Date(lastRunFull.expiresAt).getTime() - Date.now()) / 60000))} min` : "";
            return (
              <button type="button" onClick={() => setEditorTab("historial")}
                title="Estado del último run — clic para ver el Historial completo"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: rs.color, border: `1px solid ${rs.color}66`, background: `${rs.color}1f`, borderRadius: 999, padding: "3px 11px", cursor: "pointer" }}>
                <span style={{ width: 7, height: 7, borderRadius: 8, background: rs.color }} />
                Run: {rs.label}{exp}{lastRunFull?.status !== "waiting" && age ? ` · ${age}` : ""}
              </button>
            );
          })()}
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button type="button" className={editorTab === "editor" ? "crm-nav-tab active" : "crm-nav-tab"} title="Editor de nodos" aria-label="Editor"
              onClick={() => setEditorTab("editor")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="5" cy="6" r="2.2" /><circle cx="5" cy="18" r="2.2" /><rect x="14" y="9" width="7" height="6" rx="1.5" /><path d="M7 6c4 0 3 5 7 5" /><path d="M7 18c4 0 3-5 7-5" /></svg>
            </button>
            <button type="button" className={editorTab === "historial" ? "crm-nav-tab active" : "crm-nav-tab"} disabled={!props.flow.id}
              title={props.flow.id ? "Historial de ejecuciones (flow_history)" : "Guarda el flow para ver su historial"} aria-label="Historial"
              onClick={() => setEditorTab("historial")}
              style={props.flow.id ? undefined : { opacity: 0.35, cursor: "not-allowed" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>
            </button>
          </div>
        </div>
        {/* Fila de acciones — mismos botones house que el toolbar de Flows. */}
        <div className="crm-contacts-toolbar" style={{ padding: "6px 14px 10px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <button type="button" className="workspace-button secondary" aria-pressed={paletteOpen} onClick={() => setPaletteOpen((v) => !v)}
            title={paletteOpen ? "Ocultar la columna de nodos (doble clic en el lienzo la reabre)" : "Agregar nodo: también con doble clic en el vacío del lienzo"}>
            + Agregar nodo
          </button>
          <button type="button" className="workspace-button secondary" onClick={autoLayout} title="Auto-organiza los nodos por capas (izquierda→derecha; Ctrl+Z deshace)">Ordenar</button>
          <button type="button" className="workspace-button secondary" onClick={exportJson}>Exportar</button>
          {props.flow.id && (
            <button type="button" className="workspace-button secondary" aria-pressed={locked}
              onClick={() => { const next = !locked; setLocked(next); onNotice("info", next ? "Al guardar, el flow queda BLOQUEADO (solo un admin podrá editarlo/borrarlo)." : "Al guardar, el flow queda desbloqueado (requiere permisos de admin).") }}
              title={locked ? "Bloqueado (D4): el run sigue funcionando, pero la edición requiere admin. Clic para pedir desbloqueo al guardar." : "Congela la edición del flow (D4-lite): el run sigue; solo un admin revierte."}
              style={locked ? { borderColor: "rgba(251,191,36,0.5)", color: "#fcd34d" } : undefined}>
              {locked ? "Bloqueado" : "Bloquear"}
            </button>
          )}
          {trigger?.type === "webhook" && props.flow.id && (
            <button type="button" className="workspace-button secondary" onClick={() => void rotateWebhook()} title="Invalida la URL actual y genera una nueva (se muestra solo esta vez)">Rotar webhook</button>
          )}
          <div style={{ flex: 1 }} />
          {props.flow.id && (
            <button type="button" className="workspace-button" disabled={running} onClick={() => { const r = Promise.resolve(onRunFlow(props.flow.id!)); void trackRun(r).then((res: any) => applyRunSteps(res)).catch(() => {}); }} style={{ opacity: running ? 0.5 : 1 }}>
              {running ? "Ejecutando…" : "▶ Ejecutar"}
            </button>
          )}
          {props.flow.id && Object.keys(pins).length > 0 && (
            <button type="button" className="workspace-button" disabled={pinsRunning} onClick={() => void runWithPins()}
              style={{ opacity: pinsRunning ? 0.5 : 1, borderColor: "rgba(251,191,36,0.5)", color: "#fcd34d" }}
              title="flow_run con input.__pins: los nodos pineados NO se ejecutan y usan estos datos (debug estilo n8n)">
              {pinsRunning ? "Ejecutando…" : `▶ Con pines (${Object.keys(pins).length})`}
            </button>
          )}
          <button type="button" className="workspace-button" onClick={save} disabled={saving || locked} style={{ opacity: saving ? 0.5 : 1 }} title={locked ? "Flow bloqueado (D4-lite): solo un admin puede guardar" : undefined}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>

        {/* Tags (D1) + Variables (B10): viajan con flow_save; el board filtra por tags
            y los nodos leen las variables como {{vars.nombre}}. */}
        <div style={{ display: "flex", gap: 8, padding: "0 14px 8px", flexWrap: "wrap" }}>
          <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="Etiquetas, separadas, por coma"
            title="Tags del flow (D1): el board filtra por ellas (máx 10, 24 caracteres)" aria-label="Etiquetas del flow"
            style={{ ...inputStyle, width: 220, fontSize: 11.5 }} />
          <input value={varsText} onChange={(e) => setVarsText(e.target.value)} placeholder='Variables JSON: {"moneda": "PEN"}'
            title="Variables del flow (B10): los nodos las leen como {{vars.nombre}} (escalares, máx 20)" aria-label="Variables del flow"
            style={{ ...inputStyle, width: 280, fontSize: 11.5, fontFamily: "monospace" }} />
        </div>

        {webhookUrl && (
          <div style={{ margin: "8px 14px 0", padding: "8px 12px", borderRadius: 8, background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.4)", fontSize: 11.5, color: "#fcd34d", wordBreak: "break-all" }}>
            Webhook (cópiala AHORA — se muestra solo esta vez): <code style={{ userSelect: "all" }}>{webhookUrl}</code>
          </div>
        )}

        {editorTab === "historial" ? renderHistorial() : (
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* Canvas — el fondo se jala para desplazar el lienzo: el cursor es
              flecha normal al reposo y SOLO pasa a manito (grabbing) mientras
              dura el jalón. Doble clic en el vacío abre la columna de nodos. */}
          <div style={{ flex: 1, position: "relative", minWidth: 0, display: "flex" }}>
          <div ref={canvasRef} style={{ flex: 1, overflow: "auto", background: "#0a0a0d", position: "relative", cursor: connecting ? "crosshair" : panning ? "grabbing" : "default" }}
            onPointerDown={(e) => {
              if (e.target !== canvasRef.current && !(e.target as HTMLElement).dataset.canvasBg) return;
              setSelected(null); setSelIds([]); setSelectedEdge(null); setConnecting(null); setInspectorOpen(false);
              if (!connecting) {
                const el = canvasRef.current;
                if (el && e.shiftKey) {
                  // Box-select (n8n): shift + arrastrar en el vacío selecciona en grupo.
                  const r = el.getBoundingClientRect();
                  const p = { x: (e.clientX - r.left + el.scrollLeft) / zoomRef.current - M_X, y: (e.clientY - r.top + el.scrollTop) / zoomRef.current - M_Y };
                  boxRef.current = { x0: p.x, y0: p.y };
                  setBoxSel({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
                  return;
                }
                if (el) { panRef.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop }; setPanning(true); }
              }
            }}
            onDoubleClick={(e) => { if (e.target === canvasRef.current || (e.target as HTMLElement).dataset.canvasBg) setPaletteOpen(true); }}>
            {/* El wrapper define la extensión scrollable escalada; el interior
                se transforma con scale(zoom) — las coords de contenido quedan
                intactas para drag, puertos y SVG. */}
            <div data-canvas-bg="1" style={{ width: WORLD_W * zoom, height: WORLD_H * zoom, position: "relative" }}>
              <div data-canvas-bg="1" style={{ width: WORLD_W, height: WORLD_H, position: "absolute", top: 0, left: 0, transform: `scale(${zoom})`, transformOrigin: "0 0",
              backgroundImage: "radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)", backgroundSize: "22px 22px" }} >
              <svg width={WORLD_W} height={WORLD_H} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
              {/* El SVG cubre el mundo entero (infinito); el translate mapea
                  las coords de contenido (negativas incluidas) al mundo. */}
              <g transform={`translate(${M_X} ${M_Y})`}>
                {edges.map((edge, i) => {
                  const from = nodes.find((n) => n.id === edge.from);
                  const to = nodes.find((n) => n.id === edge.to);
                  if (!from || !to) return null;
                  const a = { x: from.position.x + NODE_W, y: from.position.y + portTop(from, edge.when) };
                  const b = inPos(to);
                  const path = `M ${a.x} ${a.y} C ${a.x + 60} ${a.y}, ${b.x - 60} ${b.y}, ${b.x} ${b.y}`;
                  const color = edge.when === "true" ? "#4ade80" : edge.when === "false" || edge.when === "error" ? "#f87171" : edge.when === "fallback" ? "#fb923c" : edge.when ? "#facc15" : "rgba(255,255,255,0.35)";
                  const sel = selectedEdge === i;
                  return (
                    <g key={`${edge.from}>${edge.to}:${edge.when ?? ""}`}>
                      <path d={path} stroke={sel ? "#38bdf8" : color} strokeWidth={sel ? 2.4 : 1.6} fill="none" strokeDasharray={edge.when === "error" ? "6 4" : undefined} opacity={edge.when === "error" ? 0.8 : 1} />
                      <path d={path} stroke="transparent" strokeWidth={14} fill="none" style={{ pointerEvents: "stroke", cursor: "pointer" }}
                        onClick={(e) => { e.stopPropagation(); setSelectedEdge(sel ? null : i); setEntrySel(false); }}>
                        <title>{sel ? "Seleccionada — presiona Delete para borrarla" : "Clic para seleccionar la conexión (Delete la borra)"}</title>
                      </path>
                    </g>
                  );
                })}
                {/* Línea disparo → nodo: organizativa (trigger.entry), NO es
                    una arista del graph. Clic la selecciona; Delete la borra. */}
                {(() => {
                  const entryTarget = trigger?.entry ? nodes.find((n) => n.id === trigger.entry) : null;
                  if (!entryTarget) return null;
                  const tp = (trigger?.position ?? triggerPos) as { x: number; y: number };
                  const a = { x: tp.x + NODE_W, y: tp.y + 30 };
                  const b = inPos(entryTarget);
                  const path = `M ${a.x} ${a.y} C ${a.x + 60} ${a.y}, ${b.x - 60} ${b.y}, ${b.x} ${b.y}`;
                  return (
                    <g>
                      <path d={path} stroke={entrySel ? "#38bdf8" : "rgba(34,211,238,0.55)"} strokeWidth={entrySel ? 2.4 : 1.6} strokeDasharray="7 5" fill="none" />
                      <path d={path} stroke="transparent" strokeWidth={14} fill="none" style={{ pointerEvents: "stroke", cursor: "pointer" }}
                        onClick={(e) => { e.stopPropagation(); setEntrySel((v) => !v); setSelectedEdge(null); }}>
                        <title>{entrySel ? "Seleccionada — presiona Delete para borrarla" : "Clic para seleccionar la línea del disparo (Delete la borra)"}</title>
                      </path>
                    </g>
                  );
                })()}
                {/* Guía de conexión: sigue al cursor mientras conectas */}
                {connecting && connectPoint && (() => {
                  const isTrigger = connecting.from === "__trigger__";
                  const from = isTrigger ? null : nodes.find((n) => n.id === connecting.from);
                  if (!isTrigger && !from) return null;
                  const tp = (trigger?.position ?? triggerPos) as { x: number; y: number };
                  const a = isTrigger ? { x: tp.x + NODE_W, y: tp.y + 30 } : { x: (from as FlowNode).position.x + NODE_W, y: (from as FlowNode).position.y + portTop(from as FlowNode, connecting.when) };
                  const color = isTrigger ? "#22d3ee" : connecting.when === "true" ? "#4ade80" : connecting.when === "false" || connecting.when === "error" ? "#f87171" : connecting.when === "fallback" ? "#fb923c" : connecting.when ? "#facc15" : String(NODE_META[(from as FlowNode).type]?.color ?? "#38bdf8");
                  const flip = connectPoint.x < a.x;
                  const dx = Math.max(40, Math.abs(connectPoint.x - a.x) / 2);
                  return (
                    <path d={`M ${a.x} ${a.y} C ${a.x + (flip ? -dx : dx)} ${a.y}, ${connectPoint.x + (flip ? dx : -dx)} ${connectPoint.y}, ${connectPoint.x} ${connectPoint.y}`}
                      stroke={color} strokeWidth={1.8} strokeDasharray="5 4" fill="none" opacity={0.9} />
                  );
                })()}
              </g>
              </svg>

              {/* Banda de box-select (shift + arrastrar en el vacío) */}
              {boxSel && (() => {
                const x = Math.min(boxSel.x0, boxSel.x1) + M_X;
                const y = Math.min(boxSel.y0, boxSel.y1) + M_Y;
                return <div style={{ position: "absolute", left: x, top: y, width: Math.abs(boxSel.x1 - boxSel.x0), height: Math.abs(boxSel.y1 - boxSel.y0), border: "1px solid rgba(34,211,238,0.75)", background: "rgba(34,211,238,0.08)", borderRadius: 4, pointerEvents: "none" }} />;
              })()}

              {/* Nodo inicial (disparo): tarjeta estilo n8n — espejo del trigger
                  del flow. Se ARRASTRA desde cualquier parte de la tarjeta para
                  ordenar el lienzo a voluntad (la posición se guarda en el
                  trigger) y se configura desde la sección Inicio de la paleta o
                  clic aquí. Cambiar de tipo NO la resetea ni desconecta. */}
              {(() => {
                const t = (trigger?.type ?? "manual") as "manual" | "webhook" | "schedule";
                const tmeta = TRIGGER_META[t] ?? TRIGGER_META.manual;
                const tSel = selected === "__trigger__";
                const tpos = (trigger?.position ?? triggerPos) as { x: number; y: number };
                const row = (k: string, v: string) => (
                  <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.55)", display: "flex", gap: 6, minWidth: 0 }}>
                    <span style={{ color: "rgba(255,255,255,0.32)", flexShrink: 0 }}>{k}</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
                  </div>
                );
                return (
                  <div onPointerDown={(e) => {
                    if (connecting) return;
                    setSelected("__trigger__"); setSelectedEdge(null); setEntrySel(false); setInspectorOpen(true);
                    // Arrastre desde toda la tarjeta (misma regla que los nodos);
                    // el puerto hace stopPropagation y no inicia drag.
                    const rect = canvasRef.current?.getBoundingClientRect();
                    if (!rect) return;
                    triggerDragRef.current = { dx: (e.clientX - rect.left + (canvasRef.current?.scrollLeft ?? 0)) / zoomRef.current - M_X - tpos.x, dy: (e.clientY - rect.top + (canvasRef.current?.scrollTop ?? 0)) / zoomRef.current - M_Y - tpos.y };
                  }}
                    style={{ position: "absolute", left: tpos.x + M_X, top: tpos.y + M_Y, width: NODE_W, cursor: "grab",
                      background: "#131318", border: `1px solid ${tSel ? tmeta.color : "rgba(255,255,255,0.12)"}`,
                      boxShadow: tSel ? `0 0 0 2px ${tmeta.color}44` : "none", borderRadius: 10, userSelect: "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid rgba(255,255,255,0.07)", cursor: "grab" }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: tmeta.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.9)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tmeta.label}</span>
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>Trigger</span>
                    </div>
                    <div style={{ padding: "7px 10px 9px", display: "grid", gap: 2 }}>
                      {t === "schedule" && <>{row("cron", trigger?.cron || "—")}{row("zona", trigger?.timezone || "—")}</>}
                      {t === "webhook" && row("run", "POST al webhook del flow")}
                      {t === "manual" && row("run", "▶ Ejecutar o tu IA (flow_run)")}
                    </div>
                    <div title={connecting?.from === "__trigger__" ? "Suelta sobre un nodo para marcar el arranque visual" : "Arrastra (o clic y luego clic en un nodo) para marcar el arranque visual"}
                      onPointerDown={(e) => { e.stopPropagation(); connectStartRef.current = { x: e.clientX, y: e.clientY }; setSelected("__trigger__"); setInspectorOpen(true); setConnecting({ from: "__trigger__" }); }}
                      onClick={(e) => { e.stopPropagation(); setConnecting({ from: "__trigger__" }); }}
                      style={{ position: "absolute", right: -8, top: 22, width: 16, height: 16, borderRadius: "50%",
                        background: connecting?.from === "__trigger__" ? "#22d3ee" : "#1c1c22",
                        border: `2px solid ${connecting?.from === "__trigger__" ? "#22d3ee" : "rgba(34,211,238,0.55)"}`,
                        cursor: "crosshair", touchAction: "none" }} />
                  </div>
                );
              })()}

              {nodes.map((node) => {
                // Grupo (plan A6): caja visual con título — arrastrarla MUEVE a
                // los nodos dentro de su bbox; colapsar la encoge; NO se conecta
                // ni se ejecuta (el engine la excluye, flow_save rechaza edges).
                if (node.type === "group") {
                  const gSel = selected === node.id;
                  const gw = Math.max(120, Math.min(4000, Number(node.config?.width) || 340));
                  const ghFull = Math.max(80, Math.min(4000, Number(node.config?.height) || 220));
                  const collapsed = node.config?.collapsed === true;
                  const gh = collapsed ? 36 : ghFull;
                  const members = () => nodes.filter((n) => n.id !== node.id && n.type !== "group"
                    && n.position.x >= node.position.x && n.position.x + NODE_W <= node.position.x + gw
                    && n.position.y >= node.position.y && n.position.y + 96 <= node.position.y + ghFull);
                  return (
                    <div key={node.id} onPointerDown={(e) => {
                      if (connecting) return;
                      if (e.shiftKey) { setSelIds((prev) => (prev.includes(node.id) ? prev.filter((x) => x !== node.id) : [...prev, node.id])); return; }
                      setSelIds([]); setSelected(node.id); setSelectedEdge(null); setEntrySel(false); setInspectorOpen(true);
                      const rect = canvasRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      const ids = [node.id, ...members().map((n) => n.id)];
                      const orig: Record<string, { x: number; y: number }> = {};
                      nodes.forEach((n) => { if (ids.includes(n.id)) orig[n.id] = { ...n.position }; });
                      dragRef.current = { id: node.id, ids, orig, dx: (e.clientX - rect.left + (canvasRef.current?.scrollLeft ?? 0)) / zoomRef.current - M_X - node.position.x, dy: (e.clientY - rect.top + (canvasRef.current?.scrollTop ?? 0)) / zoomRef.current - M_Y - node.position.y };
                    }}
                      style={{ position: "absolute", left: node.position.x + M_X, top: node.position.y + M_Y, width: gw, height: gh,
                        border: `1.5px dashed ${gSel ? "#cbd5e1" : "rgba(203,213,225,0.4)"}`,
                        boxShadow: gSel ? "0 0 0 2px rgba(203,213,225,0.28)" : "none",
                        background: collapsed ? "rgba(203,213,225,0.06)" : "rgba(203,213,225,0.035)",
                        borderRadius: 12, cursor: "grab", userSelect: "none" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px" }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: "#cbd5e1", flexShrink: 0 }} />
                        <span style={{ fontSize: 11.5, fontWeight: 600, color: "rgba(255,255,255,0.72)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(node.config?.title || "Grupo")}</span>
                        {!collapsed && <span style={{ fontSize: 9.5, color: "rgba(255,255,255,0.35)" }}>{members().length} nodo{members().length === 1 ? "" : "s"}</span>}
                        <button type="button" title={collapsed ? "Expandir grupo" : "Colapsar grupo"} aria-label={collapsed ? "Expandir grupo" : "Colapsar grupo"}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); patchConfig(node.id, { collapsed: !collapsed }); }}
                          style={{ ...btnBase, padding: "1px 6px", fontSize: 10, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)" }}>
                          {collapsed ? "▸" : "▾"}
                        </button>
                      </div>
                    </div>
                  );
                }
                const meta = NODE_META[node.type] ?? { label: node.type, color: "#888" };
                const isSel = selected === node.id;
                const target = connecting && connecting.from !== node.id;
                // REQ-042 feedback en vivo: ✓ verde al pasar, ✗ rojo donde falló
                // (queda hasta el próximo run), anillo verde en el que ejecuta.
                const st = liveRun?.steps?.[node.id];
                const isLive = !!liveRun?.active && liveNodeId() === node.id;
                return (
                  <div key={node.id} data-connect-node={node.id} onPointerDown={(e) => {
                    if (connecting) return;
                    // Shift+clic: alterna el nodo en la multi-selección (sin drag).
                    if (e.shiftKey) {
                      clickPosRef.current = null;
                      setSelIds((prev) => (prev.includes(node.id) ? prev.filter((x) => x !== node.id) : [...prev, node.id]));
                      return;
                    }
                    clickPosRef.current = { x: e.clientX, y: e.clientY }; // REQ-047: clic vs drag
                    setSelIds([]);
                    setSelected(node.id); setSelectedEdge(null); setEntrySel(false); setInspectorOpen(true);
                    // Arrastre desde TODO el nodo (grupal si apply), no solo el
                    // título: el switch y los puertos hacen stopPropagation.
                    const rect = canvasRef.current?.getBoundingClientRect();
                    if (!rect) return;
                    const ids = selIds.includes(node.id) && selIds.length > 1 ? selIds : [node.id];
                    const orig: Record<string, { x: number; y: number }> = {};
                    nodes.forEach((n) => { if (ids.includes(n.id)) orig[n.id] = { ...n.position }; });
                    dragRef.current = { id: node.id, ids, orig, dx: (e.clientX - rect.left + (canvasRef.current?.scrollLeft ?? 0)) / zoomRef.current - M_X - node.position.x, dy: (e.clientY - rect.top + (canvasRef.current?.scrollTop ?? 0)) / zoomRef.current - M_Y - node.position.y };
                  }}
                    onClick={(e) => {
                      if (connecting && connecting.from !== node.id) { completeConnection(node.id); return; }
                      // REQ-047: clic simple (no arrastre) abre el modal entrada|config|salida.
                      const p = clickPosRef.current;
                      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5) setNodeModal(node.id);
                    }}
                    style={{
                      position: "absolute", left: node.position.x + M_X, top: node.position.y + M_Y, width: NODE_W,
                      background: node.type === "note" ? "rgba(163,230,53,0.07)" : "#131318",
                      border: `1px solid ${isSel ? meta.color : isGrouped(node.id) ? "#38bdf8" : st ? (st.ok ? "rgba(74,222,128,0.75)" : "rgba(248,113,113,0.8)") : isLive ? "rgba(74,222,128,0.85)" : "rgba(255,255,255,0.12)"}`,
                      boxShadow: isSel ? `0 0 0 2px ${meta.color}44` : st ? (st.ok ? "0 0 0 2px rgba(74,222,128,0.35)" : "0 0 0 2px rgba(248,113,113,0.4)") : isLive ? "0 0 0 2px rgba(74,222,128,0.5), 0 0 14px rgba(74,222,128,0.35)" : isGrouped(node.id) ? "0 0 0 2px rgba(56,189,248,0.35)" : "none",
                      borderRadius: 10, cursor: "grab", userSelect: "none",
                      opacity: node.enabled === false ? 0.55 : 1,
                    }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid rgba(255,255,255,0.07)", cursor: "grab" }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: meta.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.9)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.label}</span>
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{meta.label}</span>
                      <Switch on={node.enabled !== false} onToggle={() => patchNode(node.id, { enabled: node.enabled === false })} title="Activar o desactivar nodo (los deshabilitados se ignoran en el run)" />
                    </div>
                    {(() => {
                      // REQ-047: badge verídico — sin paso en el último run TERMINADO
                      // muestra "—" en vez de un estado viejo (la ✗/✓ previa ya no
                      // representa este run; fuente #1 de confusión «parece seguir»).
                      const stFull = lastRunFull && Array.isArray(lastRunFull.steps)
                        ? lastRunFull.steps.find((s: any) => s?.nodeId === node.id)
                        : null;
                      // REQ-047: un paso waiting NO es éxito — badge ÁMBAR (reloj):
                      // la pausa ai_task es el estado más importante del canvas
                      // y antes se pintaba con el mismo verde que un ✓ logrado.
                      const stWaiting = st?.waiting === true || stFull?.output?.waiting === true;
                      if (!st && !isLive && lastRunFull && !stFull && node.type !== "note") {
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
                    })()}
                    {/* Preview del diseño elegido (nodo template): visible en el
                        lienzo sin clicar nada — además del preview del panel. */}
                    {node.type === "template" && node.config?.templateId && node.config?.frameId && (() => {
                      const pf = (frameCache[String(node.config.templateId)] ?? []).find((f) => f.id === node.config.frameId);
                      return pf ? (
                        <div style={{ padding: "6px 8px 0" }}>
                          <FramePreview html={pf.html} css={pf.css} width={pf.width} height={pf.height} maxW={190} />
                        </div>
                      ) : null;
                    })()}
                    {node.type === "note" ? (
                      // Nota adhesiva: se edita EN el lienzo (el pushUndo va en
                      // onFocus: un snapshot por sesión de edición, no por tecla).
                      <div style={{ padding: "0 10px 9px" }}>
                        <textarea value={String(node.config?.text ?? "")}
                          onPointerDown={(e) => e.stopPropagation()}
                          onFocus={() => pushUndo()}
                          onChange={(e) => patchConfig(node.id, { text: e.target.value })}
                          placeholder="Nota adhesiva (no se ejecuta)"
                          style={{ ...inputStyle, minHeight: 58, resize: "vertical", background: "rgba(163,230,53,0.06)" }} />
                      </div>
                    ) : (
                      <NodeBody node={node} runOutput={node.type === "preview" ? lastRunSteps?.[node.id] : undefined} flowInputs={(props.flow as any)?.inputs} />
                    )}
                    {/* puerto de entrada — las notas no participan del grafo */}
                    {node.type !== "note" && (
                      <div title={target ? "Soltar conexión aquí" : "Entrada"} onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => { if (connecting) completeConnection(node.id); }}
                        style={{ position: "absolute", left: -8, top: 22, width: 16, height: 16, borderRadius: "50%",
                          background: target ? "#60a5fa" : "#1c1c22", border: `2px solid ${target ? "#60a5fa" : "rgba(255,255,255,0.3)"}`, cursor: connecting ? "crosshair" : "default", touchAction: "none" }} />
                    )}
                    {/* puertos de salida: condition ✓/✗, switch reglas+fallback,
                        y TODOS los nodos tienen salida when:"error" (roja, plan B3) */}
                    {portsFor(node).map((port, pi) => {
                      const top = PORT_TOP0 + pi * PORT_STEP;
                      const active = connecting?.from === node.id && (connecting?.when ?? undefined) === (port.when ?? undefined);
                      return (
                        <div key={port.when ?? "out"} title={port.title}
                          onPointerDown={(e) => { e.stopPropagation(); connectStartRef.current = { x: e.clientX, y: e.clientY }; setConnecting({ from: node.id, when: port.when }); }}
                          onClick={(e) => { e.stopPropagation(); setConnecting({ from: node.id, when: port.when }); }}
                          style={{ position: "absolute", right: -8, top: top - 8, width: 16, height: 16, borderRadius: "50%",
                            background: active ? port.color : "#1c1c22",
                            border: `2px solid ${active ? port.color : port.color + "88"}`,
                            cursor: "crosshair", color: port.color, fontSize: 8, lineHeight: "10px", textAlign: "center", touchAction: "none" }}>
                          {port.glyph ?? ""}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              </div>
            </div>
          </div>
          {/* Chip de zoom: pinch del trackpad, ctrl+rueda o estos botones */}
          <div style={{ position: "absolute", left: 12, bottom: 12, display: "flex", alignItems: "center", gap: 2, background: "rgba(19,19,24,0.92)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: 2, zIndex: 5 }}>
            <button type="button" onClick={() => setZoomStep(-1)} title="Alejar" aria-label="Alejar" style={{ ...btnBase, border: "none", background: "transparent", padding: "2px 8px", fontSize: 14, lineHeight: 1 }}>−</button>
            <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.55)", minWidth: 36, textAlign: "center", userSelect: "none" }}>{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => setZoomStep(1)} title="Acercar" aria-label="Acercar" style={{ ...btnBase, border: "none", background: "transparent", padding: "2px 8px", fontSize: 14, lineHeight: 1 }}>+</button>
          </div>
          {/* Mini-mapa (plan A9): puntitos por nodo (trigger en cian) y marco
              del viewport; clic centra el lienzo en ese punto del contenido. */}
          {(() => {
            const MAP_W = 176;
            const MAP_H = 104;
            const tp = (trigger?.position ?? triggerPos) as { x: number; y: number };
            const el = canvasRef.current;
            const vw = el ? el.clientWidth / zoom : CANVAS_W;
            const vh = el ? el.clientHeight / zoom : CANVAS_H;
            const xs = [...nodes.map((n) => n.position.x), tp.x, tp.x + NODE_W, scrollPos.x / zoom - M_X, scrollPos.x / zoom - M_X + vw];
            const ys = [...nodes.map((n) => n.position.y), tp.y, tp.y + 96, scrollPos.y / zoom - M_Y, scrollPos.y / zoom - M_Y + vh];
            const pad = 60;
            const x0 = Math.min(...xs) - pad;
            const y0 = Math.min(...ys) - pad;
            const bw = Math.max(1, Math.max(...xs) + pad - x0);
            const bh = Math.max(1, Math.max(...ys) + pad - y0);
            const s = Math.min(MAP_W / bw, MAP_H / bh);
            const offX = (MAP_W - bw * s) / 2;
            const offY = (MAP_H - bh * s) / 2;
            const toMap = (x: number, y: number) => ({ x: (x - x0) * s + offX, y: (y - y0) * s + offY });
            const vpA = toMap(scrollPos.x / zoom - M_X, scrollPos.y / zoom - M_Y);
            return (
              <div role="img" aria-label="Mini-mapa del lienzo" title="Mini-mapa: clic para navegar"
                onPointerDown={(e) => {
                  const canvas = canvasRef.current;
                  if (!canvas) return;
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const cx = x0 + ((e.clientX - r.left) - offX) / s;
                  const cy = y0 + ((e.clientY - r.top) - offY) / s;
                  canvas.scrollLeft = (cx + M_X) * zoomRef.current - canvas.clientWidth / 2;
                  canvas.scrollTop = (cy + M_Y) * zoomRef.current - canvas.clientHeight / 2;
                }}
                style={{ position: "absolute", right: 12, bottom: 12, width: MAP_W, height: MAP_H, background: "rgba(19,19,24,0.92)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, overflow: "hidden", zIndex: 5, cursor: "pointer" }}>
                {nodes.map((n) => {
                  const p = toMap(n.position.x, n.position.y);
                  const gw = Math.max(120, Math.min(4000, Number(n.config?.width) || 340));
                  const ghFull = Math.max(80, Math.min(4000, Number(n.config?.height) || 220));
                  const isGroup = n.type === "group";
                  return <span key={n.id} style={{ position: "absolute", left: p.x, top: p.y,
                    width: isGroup ? Math.max(3, gw * s) : 5, height: isGroup ? Math.max(2, (n.config?.collapsed === true ? 36 : ghFull) * s) : 4,
                    background: isGroup ? "#cbd5e1" : NODE_META[n.type]?.color ?? "#94a3b8", opacity: n.enabled === false ? 0.35 : 0.8, borderRadius: 1.5 }} />;
                })}
                {(() => {
                  const p = toMap(tp.x, tp.y);
                  return <span style={{ position: "absolute", left: p.x, top: p.y, width: 6, height: 6, borderRadius: 4, background: "#22d3ee", boxShadow: "0 0 4px rgba(34,211,238,0.8)" }} />;
                })()}
                <span style={{ position: "absolute", left: vpA.x, top: vpA.y, width: Math.max(4, vw * s), height: Math.max(4, vh * s), border: "1px solid rgba(56,189,248,0.9)", background: "rgba(56,189,248,0.08)", borderRadius: 2, pointerEvents: "none" }} />
              </div>
            );
          })()}
        </div>

          {/* Inspector — acordeón: ancho 0 cerrado, se abre al clicar un nodo
              (el contenido vive en una columna fija para no refluir durante
              la transición). Clic en el vacío del canvas también lo esconde;
              los cambios del nodo se conservan porque escriben directo en el
              estado del flow, no en el panel. */}
          <div style={{ width: inspectorOpen ? 284 : 0, borderLeft: inspectorOpen ? "1px solid rgba(255,255,255,0.08)" : "none", overflow: "hidden", flexShrink: 0, transition: "width 0.18s ease" }}>
            <div style={{ width: 284, height: "100%", padding: 12, overflowY: "auto" }}>
            {selected === "__trigger__" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.92)", flex: 1 }}>Disparo (nodo inicial)</span>
                  <button type="button" onClick={() => setInspectorOpen(false)} title="Ocultar este panel"
                    style={{ ...btnBase, padding: "3px 7px" }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
                  </button>
                </div>
                <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                  {(["manual", "webhook", "schedule", "error"] as const).map((t) => {
                    const active = (trigger?.type ?? "manual") === t;
                    return (
                      <button key={t} type="button" title={TRIGGER_META[t].hint}
                        onClick={() => setTriggerType(t)}
                        style={{ ...btnBase, justifyContent: "flex-start", borderColor: active ? "rgba(34,211,238,0.6)" : "rgba(255,255,255,0.14)", background: active ? "rgba(34,211,238,0.14)" : "rgba(255,255,255,0.05)", color: active ? "#a5f3fc" : "rgba(255,255,255,0.85)" }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{TRIGGER_ICONS[t]}</svg>
                        {TRIGGER_META[t].label}
                      </button>
                    );
                  })}
                </div>
                {trigger?.type === "schedule" && (
                  <>
                    <Field label="Cron (5 campos)">
                      <input style={inputStyle} value={trigger.cron ?? ""} onChange={(e) => setTrigger({ ...trigger, cron: e.target.value })} placeholder="0 8 * * *"
                        title="Declarativo: los horarios los ejecuta tu IA — pídele que corra tu flow a esta hora (consulta flow_due_check y llama flow_run). Cron de 5 campos en la hora local del timezone." />
                    </Field>
                    <Field label="Zona horaria">
                      <input style={inputStyle} value={trigger.timezone ?? ""} onChange={(e) => setTrigger({ ...trigger, timezone: e.target.value })} placeholder="America/Lima" title="Zona horaria para interpretar el cron (ej. America/Lima)." />
                    </Field>
                  </>
                )}
                {trigger?.type === "webhook" && (
                  <Field label="Respuesta HTTP (F5)">
                    <select style={inputStyle} value={trigger.respond ?? "ack"} onChange={(e) => setTrigger({ ...trigger, respond: e.target.value === "lastNode" ? "lastNode" : undefined })}
                      title="ack: ok inmediato (default). lastNode: la respuesta HTTP espera el run y devuelve {data} con los outputs de los nodos terminales (fallo → HTTP 500; run en espera → 202 sin token).">
                      <option value="ack">ack inmediato</option>
                      <option value="lastNode">esperar y devolver última salida</option>
                    </select>
                  </Field>
                )}
                <div style={{ marginTop: 10, fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
                  Conecta el disparo a un nodo para marcar el arranque visual (la línea es organizativa: el run empieza siempre en tus nodos fuente). Con disparo webhook, la URL se muestra al guardar (Rotar webhook la regenera).
                </div>
              </div>
            )}
            {selectedNode && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.92)", flex: 1 }}>
                    {NODE_META[selectedNode.type]?.label ?? selectedNode.type}
                  </span>
                  <button type="button" onClick={() => setInspectorOpen(false)} title="Ocultar este panel (los cambios del nodo se conservan)"
                    style={{ ...btnBase, padding: "3px 7px" }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
                  </button>
                  <button type="button" onClick={() => deleteNode(selectedNode.id)} style={{ ...btnBase, borderColor: "rgba(248,113,113,0.5)", color: "#f87171", padding: "3px 8px", fontSize: 11 }}>Eliminar</button>
                </div>
                <Field label="Etiqueta">
                  <input style={inputStyle} value={selectedNode.label} onChange={(e) => patchNode(selectedNode.id, { label: e.target.value })} />
                </Field>
                {selectedNode.type !== "note" && selectedNode.type !== "group" && (
                  <>
                    <Field label="Al fallar">
                      <select style={inputStyle} value={selectedNode.onError ?? (selectedNode.type.startsWith("source") ? "continue" : "stop")} onChange={(e) => patchNode(selectedNode.id, { onError: e.target.value as "stop" | "continue" })}>
                        <option value="stop">detener el run</option>
                        <option value="continue">continuar con el resto</option>
                      </select>
                    </Field>
                    <Field label="Reintentos automáticos (0-5)">
                      <input type="number" min={0} max={5} style={inputStyle} value={Number(selectedNode.retry ?? 0)}
                        onChange={(e) => patchNode(selectedNode.id, { retry: Math.max(0, Math.min(5, Math.floor(Number(e.target.value) || 0))) })}
                        title="Backoff automático entre intentos (250ms × intento, tope 1s). La salida roja when:error se evalúa tras agotar los reintentos." />
                    </Field>
                  </>
                )}

                {(selectedNode.type === "source_rss" || selectedNode.type === "source_http" || selectedNode.type === "http") && (
                  <Field label="URL (https)">
                    <input style={inputStyle} value={String(selectedNode.config.url ?? "")} onChange={(e) => patchConfig(selectedNode.id, { url: e.target.value })} placeholder="https://…" />
                  </Field>
                )}
                {selectedNode.type === "source_rss" && (
                  <Field label="Límite (1-50)">
                    <input type="number" style={inputStyle} value={Number(selectedNode.config.limit ?? 10)} onChange={(e) => patchConfig(selectedNode.id, { limit: Number(e.target.value) })} />
                  </Field>
                )}
                {selectedNode.type === "source_nitter" && (
                  <>
                    <Field label="Usuario de X o URL RSS directa">
                      <input style={inputStyle} value={String(selectedNode.config.username ?? "")} onChange={(e) => patchConfig(selectedNode.id, { username: e.target.value, url: undefined })} placeholder="usuario" />
                    </Field>
                    <Field label="Instancia Nitter">
                      <input style={inputStyle} value={String(selectedNode.config.instanceUrl ?? "")} onChange={(e) => patchConfig(selectedNode.id, { instanceUrl: e.target.value })} />
                    </Field>
                    <Field label="Límite (1-100)">
                      <input type="number" style={inputStyle} value={Number(selectedNode.config.limit ?? 15)} onChange={(e) => patchConfig(selectedNode.id, { limit: Number(e.target.value) })} />
                    </Field>
                  </>
                )}
                {(selectedNode.type === "source_http" || selectedNode.type === "http") && (
                  <>
                    <Field label="Método">
                      <select style={inputStyle} value={String(selectedNode.config.method ?? "GET")} onChange={(e) => patchConfig(selectedNode.id, { method: e.target.value })}>
                        {(selectedNode.type === "http" ? ["GET", "POST", "PUT", "PATCH", "DELETE"] : ["GET", "POST"]).map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </Field>
                    <Field label='Headers JSON (sin secretos — usa credentialId)'>
                      <textarea style={{ ...inputStyle, minHeight: 54, fontFamily: "monospace" }}
                        value={JSON.stringify(selectedNode.config.headers ?? {}, null, 0)}
                        onChange={(e) => { try { patchConfig(selectedNode.id, { headers: e.target.value.trim() ? JSON.parse(e.target.value) : {} }); } catch { /* tolera edición parcial */ } }} />
                    </Field>
                    {selectedNode.config.method !== "GET" && (
                      <Field label="Body JSON">
                        <textarea style={{ ...inputStyle, minHeight: 54, fontFamily: "monospace" }}
                          value={typeof selectedNode.config.body === "string" ? selectedNode.config.body : JSON.stringify(selectedNode.config.body ?? "", null, 0)}
                          onChange={(e) => { try { patchConfig(selectedNode.id, { body: e.target.value.trim().startsWith("{") || e.target.value.trim().startsWith("[") ? JSON.parse(e.target.value) : e.target.value }); } catch { patchConfig(selectedNode.id, { body: e.target.value }); } }} />
                      </Field>
                    )}
                  </>
                )}
                {selectedNode.type === "source_http" && (
                  <>
                    <Field label="listPath (ruta al array, ej. data.items)">
                      <input style={inputStyle} value={String(selectedNode.config.listPath ?? "")} onChange={(e) => patchConfig(selectedNode.id, { listPath: e.target.value })} />
                    </Field>
                    <Field label="Límite (1-50)">
                      <input type="number" style={inputStyle} value={Number(selectedNode.config.limit ?? 10)} onChange={(e) => patchConfig(selectedNode.id, { limit: Number(e.target.value) })} />
                    </Field>
                  </>
                )}
                {(selectedNode.type === "source_http" || selectedNode.type === "http") && (
                  <Field label="Credencial (bearer/api_key/basic)">
                    <select style={inputStyle} value={String(selectedNode.config.credentialId ?? "")} onChange={(e) => patchConfig(selectedNode.id, { credentialId: e.target.value || undefined })}>
                      <option value="">— sin autenticación —</option>
                      {credentials.filter((c) => c.type !== "ai_provider").map((c) => <option key={c.id} value={c.id}>{c.name} ({c.type} ···{c.last4})</option>)}
                    </select>
                  </Field>
                )}

                {selectedNode.type === "ai" && (
                  <>
                    <Field label="Proveedor">
                      <select style={inputStyle} value={String(selectedNode.config.provider ?? "openrouter")} onChange={(e) => patchConfig(selectedNode.id, { provider: e.target.value })}>
                        {AI_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </Field>
                    <Field label="Modelo (vacío = default del proveedor)">
                      <input style={inputStyle} value={String(selectedNode.config.model ?? "")} onChange={(e) => patchConfig(selectedNode.id, { model: e.target.value })} placeholder="p.ej. deepseek/deepseek-chat" />
                    </Field>
                    <Field label="Credencial IA (flow_credentials_set)">
                      <select style={inputStyle} value={String(selectedNode.config.credentialId ?? "")} onChange={(e) => patchConfig(selectedNode.id, { credentialId: e.target.value })}>
                        <option value="">— elige una credencial —</option>
                        {credentials.filter((c) => c.type === "ai_provider").map((c) => <option key={c.id} value={c.id}>{c.name} ({c.provider} ···{c.last4})</option>)}
                      </select>
                    </Field>
                    <Field label="System prompt">
                      <textarea style={{ ...inputStyle, minHeight: 64 }} value={String(selectedNode.config.systemPrompt ?? "")} onChange={(e) => patchConfig(selectedNode.id, { systemPrompt: e.target.value })} />
                    </Field>
                    <Field label="Prompt (usa {{item.x}} / {{steps.id.y}})">
                      <textarea style={{ ...inputStyle, minHeight: 64 }} value={String(selectedNode.config.prompt ?? "")} onChange={(e) => patchConfig(selectedNode.id, { prompt: e.target.value })} />
                    </Field>
                    <Field label="Formato de salida">
                      <select style={inputStyle} value={String(selectedNode.config.responseFormat ?? "text")} onChange={(e) => patchConfig(selectedNode.id, { responseFormat: e.target.value })}
                        title="JSON: pide el JSON y lo parsea tolerante (con o sin fences); el output llega como {json} — si no se puede parsear, {text, jsonParseError}. Con schema valida y reintenta UNA vez; si sigue fallando el nodo truena con AI_SCHEMA.">
                        <option value="text">texto libre</option>
                        <option value="json">JSON estructurado</option>
                      </select>
                    </Field>
                    {String(selectedNode.config.responseFormat ?? "text") === "json" && (
                      <Field label="Schema JSON (opcional, F1)">
                        <textarea style={{ ...inputStyle, minHeight: 84, fontFamily: "monospace", fontSize: 11 }} placeholder='{"type":"object","required":["titulo"],"properties":{"titulo":{"type":"string"}}}'
                          value={String(selectedNode.config.schema ?? "")} onChange={(e) => patchConfig(selectedNode.id, { schema: e.target.value })}
                          title="JSON Schema acotado (type/enum/properties/required/items, máx 2KB): valida la respuesta y reintenta UNA vez con los errores; si vuelve a fallar, el nodo truena con AI_SCHEMA. Vacío = solo parsea tolerante." />
                      </Field>
                    )}
                    <Field label="Memoria de runs recientes">
                      <select style={inputStyle} value={Number(selectedNode.config.memory?.runs ?? 0)} onChange={(e) => patchConfig(selectedNode.id, { memory: Number(e.target.value) > 0 ? { runs: Number(e.target.value) } : undefined })}
                        title="Inyecta un digest de los últimos N runs de este flow en el systemPrompt (best-effort)">
                        <option value={0}>sin memoria</option>
                        <option value={3}>últimos 3 runs</option>
                        <option value={5}>últimos 5 runs</option>
                        <option value={10}>últimos 10 runs</option>
                      </select>
                    </Field>
                    <Field label="Máx tokens de salida">
                      <input type="number" style={inputStyle} value={Number(selectedNode.config.maxOutputTokens ?? 400)} onChange={(e) => patchConfig(selectedNode.id, { maxOutputTokens: Number(e.target.value) })} />
                    </Field>
                    <Field label="Máx items (1-5)">
                      <input type="number" style={inputStyle} value={Number(selectedNode.config.maxItems ?? 3)} onChange={(e) => patchConfig(selectedNode.id, { maxItems: Number(e.target.value) })} />
                    </Field>
                  </>
                )}

                {selectedNode.type === "agent" && (
                  <>
                    <Field label="Proveedor">
                      <select style={inputStyle} value={String(selectedNode.config.provider ?? "openrouter")} onChange={(e) => patchConfig(selectedNode.id, { provider: e.target.value })}>
                        {AI_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </Field>
                    <Field label="Modelo (vacío = default del proveedor)">
                      <input style={inputStyle} value={String(selectedNode.config.model ?? "")} onChange={(e) => patchConfig(selectedNode.id, { model: e.target.value })} />
                    </Field>
                    <Field label="Credencial IA (flow_credentials_set)">
                      <select style={inputStyle} value={String(selectedNode.config.credentialId ?? "")} onChange={(e) => patchConfig(selectedNode.id, { credentialId: e.target.value })}>
                        <option value="">— elige una credencial —</option>
                        {credentials.filter((c) => c.type === "ai_provider").map((c) => <option key={c.id} value={c.id}>{c.name} ({c.provider} ···{c.last4})</option>)}
                      </select>
                    </Field>
                    <Field label="System prompt">
                      <textarea style={{ ...inputStyle, minHeight: 56 }} value={String(selectedNode.config.systemPrompt ?? "")} onChange={(e) => patchConfig(selectedNode.id, { systemPrompt: e.target.value })} />
                    </Field>
                    <Field label="Objetivo (prompt)">
                      <textarea style={{ ...inputStyle, minHeight: 64 }} value={String(selectedNode.config.prompt ?? "")} onChange={(e) => patchConfig(selectedNode.id, { prompt: e.target.value })} />
                    </Field>
                    <Field label="Tools del agent (máx 8)">
                      {(() => {
                        const cur = Array.isArray(selectedNode.config.tools) ? selectedNode.config.tools : [];
                        const full = cur.length >= 8;
                        return (
                          <div style={{ maxHeight: 210, overflowY: "auto", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "4px 9px 6px", marginTop: 2 }}>
                            {CATEGORIES.map((cat) => {
                              const entries = FLOW_TOOLS.filter((t) => t.cat === cat.id && (t.tier ?? 1) < 2);
                              if (!entries.length) return null;
                              return (
                                <div key={cat.id}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: "rgba(255,255,255,0.5)", margin: "5px 0 2px" }}>
                                    <span style={{ width: 7, height: 7, borderRadius: 99, background: cat.color, display: "inline-block" }} />
                                    {cat.label}
                                  </div>
                                  {entries.map((t) => (
                                    <label key={t.tool} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "rgba(255,255,255,0.75)", cursor: full && !cur.includes(t.tool) ? "default" : "pointer", opacity: full && !cur.includes(t.tool) ? 0.4 : 1 }}>
                                      <input type="checkbox" checked={cur.includes(t.tool)} disabled={full && !cur.includes(t.tool)}
                                        onChange={() => patchConfig(selectedNode.id, { tools: cur.includes(t.tool) ? cur.filter((x) => x !== t.tool) : [...cur, t.tool].slice(0, 8) })} />
                                      <span title={`${t.tool} — ${t.hint}`}>{t.label}</span>
                                    </label>
                                  ))}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.5, marginTop: 4 }}>
                        Vacío = responde directo sin herramientas. flow_* y tools fuera del catálogo se rechazan siempre.
                      </div>
                    </Field>
                    <Field label="Tools extra (coma, máx 8)">
                      <input style={inputStyle} value={Array.isArray(selectedNode.config.tools) ? selectedNode.config.tools.join(", ") : ""}
                        onChange={(e) => patchConfig(selectedNode.id, { tools: e.target.value.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 8) })}
                        placeholder="ej. list_social_inbox, get_crm_overview" title="El agent SOLO puede llamar estas tools (protocolo JSON por turno) y deben existir en el catálogo de flows." />
                    </Field>
                    <Field label="Iteraciones máx (1-8)">
                      <input type="number" min={1} max={8} style={inputStyle} value={Number(selectedNode.config.maxIterations ?? 4)} onChange={(e) => patchConfig(selectedNode.id, { maxIterations: Math.max(1, Math.min(8, Math.floor(Number(e.target.value) || 4))) })} />
                    </Field>
                    <Field label="Memoria de runs recientes">
                      <select style={inputStyle} value={Number(selectedNode.config.memory?.runs ?? 0)} onChange={(e) => patchConfig(selectedNode.id, { memory: Number(e.target.value) > 0 ? { runs: Number(e.target.value) } : undefined })}
                        title="Inyecta un digest de los últimos N runs de este flow en cada turno (best-effort)">
                        <option value={0}>sin memoria</option>
                        <option value={3}>últimos 3 runs</option>
                        <option value={5}>últimos 5 runs</option>
                        <option value={10}>últimos 10 runs</option>
                      </select>
                    </Field>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
                      Por turno el agent decide: {"{\"tool\":\"…\"}"} usa una herramienta permitida o {"{\"final\":\"…\"}"} responde. Salida: {"{answer, iterations, toolCalls}"}. flow_* y el resto de tools fuera del catálogo se rechazan; todas comparten el presupuesto del run (máx 25).
                    </div>
                  </>
                )}

                {selectedNode.type === "template" && (
                  <>
                    <Field label="Archivo (template de Diseño)">
                      <select style={inputStyle} value={String(selectedNode.config.templateId ?? "")} onChange={(e) => patchConfig(selectedNode.id, { templateId: e.target.value, frameId: "" })}>
                        <option value="">— elige tu archivo —</option>
                        {templateOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Frame exacto">
                      <select style={inputStyle} value={String(selectedNode.config.frameId ?? "")} onChange={(e) => patchConfig(selectedNode.id, { frameId: e.target.value })} disabled={!selectedNode.config.templateId}>
                        <option value="">— elige el frame —</option>
                        {frameOptions.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.width}×{f.height})</option>)}
                      </select>
                    </Field>
                    {selectedNode.config.templateId && (() => {
                      const preview = frameOptions.find((f) => f.id === selectedNode.config.frameId);
                      return (
                        <Field label="Preview">
                          {preview
                            ? <FramePreview html={preview.html} css={preview.css} width={preview.width} height={preview.height} maxW={256} />
                            : <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", padding: "8px 10px", border: "1px dashed rgba(255,255,255,0.15)", borderRadius: 8 }}>Elige el frame para ver el preview del diseño.</div>}
                        </Field>
                      );
                    })()}
                    <Field label="Formato">
                      <select style={inputStyle} value={String(selectedNode.config.format ?? "post")} onChange={(e) => patchConfig(selectedNode.id, { format: e.target.value })}>
                        <option value="post">post</option><option value="story">story</option><option value="custom">custom</option>
                      </select>
                    </Field>
                    <Field label="Máx items (1-5)">
                      <input type="number" style={inputStyle} value={Number(selectedNode.config.maxItems ?? 3)} onChange={(e) => patchConfig(selectedNode.id, { maxItems: Number(e.target.value) })} />
                    </Field>
                  </>
                )}

                {selectedNode.type === "map" && (
                  <Field label="Valor JSON ({{steps.id.campo}})">
                    <textarea style={{ ...inputStyle, minHeight: 110, fontFamily: "monospace" }}
                      value={JSON.stringify(selectedNode.config.value ?? {}, null, 2)}
                      onChange={(e) => { try { patchConfig(selectedNode.id, { value: JSON.parse(e.target.value || "{}") }); } catch { /* tolera edición parcial */ } }} />
                  </Field>
                )}
                {selectedNode.type === "condition" && (
                  <>
                    <Field label='Ruta (input.x / steps.ID.y / item.x)'>
                      <input style={inputStyle} value={String(selectedNode.config.path ?? "")} onChange={(e) => patchConfig(selectedNode.id, { path: e.target.value })} />
                    </Field>
                    <Field label="Operador">
                      <select style={inputStyle} value={String(selectedNode.config.operator ?? "equals")} onChange={(e) => patchConfig(selectedNode.id, { operator: e.target.value })}>
                        {CONDITION_OPERATORS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </Field>
                    {!["exists", "not_empty"].includes(String(selectedNode.config.operator)) && (
                      <Field label="Valor">
                        <input style={inputStyle} value={String(selectedNode.config.value ?? "")} onChange={(e) => {
                          const raw = e.target.value;
                          const num = Number(raw);
                          patchConfig(selectedNode.id, { value: raw !== "" && Number.isFinite(num) ? num : raw });
                        }} />
                      </Field>
                    )}
                  </>
                )}
                {selectedNode.type === "switch" && (
                  <>
                    <Field label='Ruta (input.x / steps.ID.y / item.x)'>
                      <input style={inputStyle} value={String(selectedNode.config.path ?? "")} onChange={(e) => patchConfig(selectedNode.id, { path: e.target.value })} />
                    </Field>
                    {(Array.isArray(selectedNode.config.rules) ? selectedNode.config.rules : []).map((rule: any, ri: number) => (
                      <div key={ri} style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 9px", display: "grid", gap: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ ...labelStyle, margin: 0, flex: 1 }}>Regla {ri + 1}</span>
                          <button type="button" title="Quitar regla (y su ruta)" onClick={() => { const rules = [...(selectedNode.config.rules ?? [])]; rules.splice(ri, 1); patchConfig(selectedNode.id, { rules }); }}
                            style={{ ...btnBase, color: "#f87171", borderColor: "rgba(248,113,113,0.4)", padding: "2px 7px", fontSize: 10 }}>✕</button>
                        </div>
                        <input style={inputStyle} value={String(rule.label ?? "")} placeholder="etiqueta de ruta (ej. urgente)"
                          onChange={(e) => { const rules = [...(selectedNode.config.rules ?? [])]; rules[ri] = { ...rules[ri], label: e.target.value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) }; patchConfig(selectedNode.id, { rules }); }} />
                        <select style={inputStyle} value={String(rule.operator ?? "equals")} onChange={(e) => { const rules = [...(selectedNode.config.rules ?? [])]; rules[ri] = { ...rules[ri], operator: e.target.value }; patchConfig(selectedNode.id, { rules }); }}>
                          {SWITCH_OPERATORS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                        <input style={inputStyle} value={String(rule.value ?? "")} placeholder="valor a comparar"
                          onChange={(e) => { const rules = [...(selectedNode.config.rules ?? [])]; rules[ri] = { ...rules[ri], value: e.target.value }; patchConfig(selectedNode.id, { rules }); }} />
                      </div>
                    ))}
                    <button type="button" onClick={() => { const rules = [...(Array.isArray(selectedNode.config.rules) ? selectedNode.config.rules : [])]; if (rules.length >= 8) return; rules.push({ label: `ruta${rules.length + 1}`, operator: "equals", value: "" }); patchConfig(selectedNode.id, { rules }); }}
                      style={{ ...btnBase, justifyContent: "center", marginTop: 4 }}>+ Regla (máx 8)</button>
                    <label style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4, fontSize: 11.5, color: "rgba(255,255,255,0.75)", cursor: "pointer" }}>
                      <input type="checkbox" checked={selectedNode.config.fallback !== false} onChange={(e) => patchConfig(selectedNode.id, { fallback: e.target.checked })} />
                      Fallback si ninguna regla matchea
                    </label>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
                      Cada regla tiene su puerto amarillo; el fallback sale del naranja. La etiqueta DEBE coincidir con la conexión.
                    </div>
                  </>
                )}
                {selectedNode.type === "loop" && (
                  <>
                    <Field label="Items por lote (1-50)">
                      <input type="number" min={1} max={50} style={inputStyle} value={Number(selectedNode.config.batchSize ?? 5)} onChange={(e) => patchConfig(selectedNode.id, { batchSize: Math.max(1, Math.min(50, Math.floor(Number(e.target.value) || 5))) })} />
                    </Field>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
                      Al loop llega lo que produce items (fuente/IA/merge) y desde él sale la cadena a repetir: dentro de cada lote, los nodos leen {"{{item.x}}"} del lote. Un loop por rama (sin anidar).
                    </div>
                  </>
                )}
                {selectedNode.type === "merge" && (
                  <>
                    <Field label="Modo">
                      <select style={inputStyle} value={String(selectedNode.config.mode ?? "append")} onChange={(e) => patchConfig(selectedNode.id, { mode: e.target.value })}>
                        <option value="append">append (concatena items de todas las entradas)</option>
                        <option value="byKey">byKey (une por una clave)</option>
                        <option value="branch">branch (pasa solo una entrada)</option>
                      </select>
                    </Field>
                    {selectedNode.config.mode === "branch" && (
                      <Field label="Entrada a pasar (1-based)">
                        <input type="number" min={1} max={8} style={inputStyle} value={Number(selectedNode.config.branch ?? 1)} onChange={(e) => patchConfig(selectedNode.id, { branch: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
                      </Field>
                    )}
                    {selectedNode.config.mode === "byKey" && (
                      <Field label="Clave de unión (campo del item)">
                        <input style={inputStyle} value={String(selectedNode.config.key ?? "")} onChange={(e) => patchConfig(selectedNode.id, { key: e.target.value })} placeholder="ej. id" />
                      </Field>
                    )}
                  </>
                )}
                {selectedNode.type === "compare" && (
                  <>
                    <Field label="Claves de joineo (coma, máx 3)">
                      <input style={inputStyle} value={Array.isArray(selectedNode.config.keys) ? selectedNode.config.keys.join(", ") : ""}
                        onChange={(e) => patchConfig(selectedNode.id, { keys: e.target.value.split(",").map((k) => k.trim()).filter(Boolean).slice(0, 3) })}
                        placeholder="ej. id" title="Vacio = id. El joineo compara JSON de las claves." />
                    </Field>
                    <Field label="Qué alimenta items">
                      <select style={inputStyle} value={String(selectedNode.config.mode ?? "all")} onChange={(e) => patchConfig(selectedNode.id, { mode: e.target.value })}>
                        <option value="all">todo el diff (added+removed+changed)</option>
                        <option value="added">solo added (nuevos en B)</option>
                        <option value="removed">solo removed (solo en A)</option>
                        <option value="changed">solo changed (modificados)</option>
                      </select>
                    </Field>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
                      A = primera arista entrante, B = la segunda (orden declarado). Salida: items + added/removed/changed (arrays) y addedCount/removedCount/changedCount/unchanged/aCount/bCount.
                    </div>
                  </>
                )}
                {selectedNode.type === "wait" && (
                  <Field label="Segundos (1-20)">
                    <input type="number" min={1} max={20} style={inputStyle} value={Number(selectedNode.config.seconds ?? 5)} onChange={(e) => patchConfig(selectedNode.id, { seconds: Math.max(1, Math.min(20, Math.floor(Number(e.target.value) || 5))) })} title="Acotado al presupuesto de 25s por run." />
                  </Field>
                )}
                {(selectedNode.type === "wait_webhook" || selectedNode.type === "approval") && (
                  <>
                    <Field label="Mensaje de contexto (para quien reanuda)">
                      <input style={inputStyle} value={String(selectedNode.config.message ?? "")} onChange={(e) => patchConfig(selectedNode.id, { message: e.target.value })}
                        placeholder={selectedNode.type === "approval" ? "¿Publico la campaña?" : "Esperando callback de pago…"} />
                    </Field>
                    <Field label="Timeout (minutos 1-1440)">
                      <input type="number" min={1} max={1440} style={inputStyle} value={Number(selectedNode.config.timeoutMinutes ?? 60)} onChange={(e) => patchConfig(selectedNode.id, { timeoutMinutes: Math.max(1, Math.min(1440, Math.floor(Number(e.target.value) || 60))) })}
                        title="Al vencer, el resume se rechaza (WAIT_EXPIRED) y el run queda failed." />
                    </Field>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
                      {selectedNode.type === "approval"
                        ? "Pausa el run hasta flow_resume con {approved, note} — ramifica con un nodo Condition leyendo steps.ID.approved."
                        : "Pausa el run hasta flow_resume con el payload del callback — llega como salida del nodo (steps.ID.…)."}
                    </div>
                  </>
                )}
                {selectedNode.type === "subflow" && (
                  <>
                    <Field label="Flow a ejecutar">
                      <select style={inputStyle} value={String(selectedNode.config.flowId ?? "")} onChange={(e) => patchConfig(selectedNode.id, { flowId: e.target.value })}>
                        <option value="">— elige un flow del workspace —</option>
                        {(flowOptions ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}{f.id === props.flow.id ? " (este)" : ""}</option>)}
                      </select>
                    </Field>
                    <Field label='Inputs JSON (acepta {{input.x}} / {{steps.id.y}})'>
                      <textarea style={{ ...inputStyle, minHeight: 70, fontFamily: "monospace" }}
                        value={JSON.stringify(selectedNode.config.inputs ?? {}, null, 0)}
                        onChange={(e) => { try { patchConfig(selectedNode.id, { inputs: e.target.value.trim() ? JSON.parse(e.target.value) : {} }); } catch { /* tolera edición parcial */ } }} />
                    </Field>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
                      Corre el otro flow de tu workspace y trae {"{runId, status}"}. Un flow no puede llamarse a sí mismo.
                    </div>
                  </>
                )}
                {selectedNode.type === "code" && (
                  <>
                    <Field label="JavaScript (retorna items/item/array/objeto)">
                      <textarea style={{ ...inputStyle, minHeight: 130, fontFamily: "monospace", fontSize: 11 }}
                        value={String(selectedNode.config.js ?? "")} onChange={(e) => patchConfig(selectedNode.id, { js: e.target.value })} />
                    </Field>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
                      Variables: items (array), item (primero), input, steps. SIN fetch/require/red — cómputo puro, máx 8000 caracteres.
                    </div>
                  </>
                )}
                {selectedNode.type === "tool" && (() => {
                  const toolEntry = findFlowTool(String(selectedNode.config.tool ?? ""));
                  return (
                    <>
                      <Field label="Herramienta (catálogo de la paleta)">
                        <input style={inputStyle} value={String(selectedNode.config.tool ?? "")} onChange={(e) => patchConfig(selectedNode.id, { tool: e.target.value })} placeholder="ej. list_social_inbox, render_batch" />
                      </Field>
                      {toolEntry ? (
                        <div style={{ display: "grid", gap: 8, marginBottom: 8 }}>
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{toolEntry.hint}</div>
                          <ToolConfigForm entry={toolEntry} args={(selectedNode.config.args ?? {}) as Record<string, any>}
                            onChange={(patch) => patchConfig(selectedNode.id, { args: { ...(selectedNode.config.args ?? {}), ...patch } })}
                            inputStyle={inputStyle} />
                        </div>
                      ) : null}
                      <Field label='Args JSON completo (acepta {{input.x}} / {{steps.id.y}} / {{vars.v}})'>
                        <textarea style={{ ...inputStyle, minHeight: 70, fontFamily: "monospace" }}
                          value={JSON.stringify(selectedNode.config.args ?? {}, null, 0)}
                          onChange={(e) => { try { patchConfig(selectedNode.id, { args: e.target.value.trim() ? JSON.parse(e.target.value) : {} }); } catch { /* tolera edición parcial */ } }} />
                      </Field>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
                        Solo corren las tools del catálogo (allowlist por tiers); workspaceId lo fuerza el run y hay presupuesto de llamadas por run. Para otros flows usa el nodo Sub-flow.
                      </div>
                    </>
                  );
                })()}
                {selectedNode.type === "note" && (
                  <Field label="Texto de la nota">
                    <textarea style={{ ...inputStyle, minHeight: 80 }} value={String(selectedNode.config.text ?? "")} onChange={(e) => patchConfig(selectedNode.id, { text: e.target.value })} placeholder="Nota adhesiva — visible en el lienzo, ignorada por el run" />
                  </Field>
                )}
                {selectedNode.type === "text" && (
                  <Field label="Plantilla ({{…}})">
                    <textarea style={{ ...inputStyle, minHeight: 90 }} value={String(selectedNode.config.template ?? "")} onChange={(e) => patchConfig(selectedNode.id, { template: e.target.value })} />
                  </Field>
                )}
                {selectedNode.type === "report" && (
                  <Field label="Título">
                    <input style={inputStyle} value={String(selectedNode.config.title ?? "")} onChange={(e) => patchConfig(selectedNode.id, { title: e.target.value })} />
                  </Field>
                )}
{selectedNode.type === "preview" && (
                  <Field label="Título">
                    <input style={inputStyle} value={String(selectedNode.config.title ?? "")} onChange={(e) => patchConfig(selectedNode.id, { title: e.target.value })} />
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
Colócalo al final del flow: al correr, muestra aquí el resultado del nodo conectado (texto, imagen, items o JSON). La salida completa queda en Historial y sigue disponible para el nodo siguiente.
                    </div>
                  </Field>
                )}

                {selectedNode.type !== "note" && selectedNode.type !== "group" && (
                  <Field label="Datos pineados (debug: anulan este nodo en el próximo run)">
                    <textarea style={{ ...inputStyle, minHeight: 60, fontFamily: "monospace", fontSize: 11 }}
                      value={pins[selectedNode.id] ?? ""}
                      onChange={(e) => setPins((prev) => { const next = { ...prev }; if (e.target.value.trim()) next[selectedNode.id] = e.target.value; else delete next[selectedNode.id]; return next; })}
                      placeholder='{ "items": [ … ] } — pega la salida real del Historial' />
                    {pins[selectedNode.id] && (
                      <button type="button" onClick={() => setPins((prev) => { const next = { ...prev }; delete next[selectedNode.id]; return next; })}
                        style={{ ...btnBase, marginTop: 6, color: "#fbbf24", borderColor: "rgba(251,191,36,0.45)" }}>Quitar pin</button>
                    )}
                  </Field>
                )}

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
                  <span style={{ ...labelStyle, margin: 0 }}>Habilitado</span>
                  <Switch on={selectedNode.enabled !== false} onToggle={() => patchNode(selectedNode.id, { enabled: selectedNode.enabled === false })} title="Activar o desactivar nodo (los deshabilitados se ignoran en el run)" />
                </div>
                {selectedNode.type === "group" && (
                  <>
                    <Field label="Título">
                      <input style={inputStyle} value={String(selectedNode.config.title ?? "")} onChange={(e) => patchConfig(selectedNode.id, { title: e.target.value })} />
                    </Field>
                    <Field label="Ancho (120-4000)">
                      <input type="number" min={120} max={4000} style={inputStyle} value={Number(selectedNode.config.width ?? 340)} onChange={(e) => patchConfig(selectedNode.id, { width: Math.max(120, Math.min(4000, Math.floor(Number(e.target.value) || 340))) })} />
                    </Field>
                    <Field label="Alto (80-4000)">
                      <input type="number" min={80} max={4000} style={inputStyle} value={Number(selectedNode.config.height ?? 220)} onChange={(e) => patchConfig(selectedNode.id, { height: Math.max(80, Math.min(4000, Math.floor(Number(e.target.value) || 220))) })} />
                    </Field>
                    <label style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4, fontSize: 11.5, color: "rgba(255,255,255,0.75)", cursor: "pointer" }}>
                      <input type="checkbox" checked={selectedNode.config.collapsed === true} onChange={(e) => patchConfig(selectedNode.id, { collapsed: e.target.checked })} />
                      Colapsado
                    </label>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
                      Caja visual (A6): no se ejecuta ni se conecta. Arrástrala para mover los nodos dentro de su área; el botón ▸ la colapsa.
                    </div>
                  </>
                )}

                <div style={{ marginTop: 12, fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
                  Placeholders: <code>{"{{input.x}}"}</code>, <code>{"{{steps.ID.y}}"}</code>, <code>{"{{item.x}}"}</code>. Los secretos NUNCA van en la config: crea credenciales y referencia con credentialId.
                </div>
              </div>
            )}
            </div>
          </div>

          {/* Paleta — columna que se abre desde el borde derecho: el botón
              «+ Agregar nodo» de la barra o un doble clic en el vacío del
              lienzo la abren/cierran (mismo patrón acordeón del inspector;
              el contenido vive en una columna fija para no refluir durante
              la transición). */}
          <div style={{ width: paletteOpen ? 168 : 0, borderLeft: paletteOpen ? "1px solid rgba(255,255,255,0.08)" : "none", overflow: "hidden", flexShrink: 0, transition: "width 0.18s ease" }}>
            <div style={{ width: 168, height: "100%", padding: 10, boxSizing: "border-box", overflowY: "auto" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                <span style={{ ...labelStyle, margin: 0 }}>Nodos</span>
                {/* Flechita para ocultar la columna — misma gramática del
                    acordeón del inspector; «+ Agregar nodo» o el doble clic en
                    el vacío la reabren. */}
                <button type="button" onClick={() => setPaletteOpen(false)} title="Ocultar esta columna (doble clic en el vacío o «+ Agregar nodo» la reabren)"
                  aria-label="Ocultar columna de nodos" style={{ ...btnBase, padding: "3px 7px" }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
                </button>
              </div>
              <div style={labelStyle}>Inicio</div>
              <div style={{ display: "grid", gap: 6 }}>
                {(["manual", "webhook", "schedule", "error"] as const).map((t) => {
                  const active = (trigger?.type ?? "manual") === t;
                  return (
                    <button key={t} type="button" title={TRIGGER_META[t].hint}
                      onClick={() => { setTriggerType(t); setSelected("__trigger__"); setInspectorOpen(true); }}
                      style={{ ...btnBase, justifyContent: "flex-start", borderColor: active ? "rgba(34,211,238,0.6)" : "rgba(34,211,238,0.28)", background: active ? "rgba(34,211,238,0.14)" : "rgba(255,255,255,0.05)", color: active ? "#a5f3fc" : "rgba(255,255,255,0.85)" }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{TRIGGER_ICONS[t]}</svg>
                      {TRIGGER_META[t].label}
                    </button>
                  );
                })}
              </div>
              <div style={labelStyle}>Agregar nodo</div>
              <input ref={paletteInputRef} value={paletteQuery} onChange={(e) => { setPaletteQuery(e.target.value); setPaletteIndex(0); }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setPaletteIndex((i) => Math.min(i + 1, Math.max(0, paletteMatches.length - 1))); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setPaletteIndex((i) => Math.max(i - 1, 0)); }
                  else if (e.key === "Enter" && paletteMatches[paletteIndex]) { e.preventDefault(); addNode(paletteMatches[paletteIndex]); }
                  else if (e.key === "Escape") { setPaletteQuery(""); setPaletteIndex(0); }
                }}
                placeholder="Buscar nodo… (Tab)" aria-label="Buscar nodo en la paleta"
                style={{ ...inputStyle, marginBottom: 8 }} />
              {!paletteQuery.trim() && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                  {[{ id: "todas", label: "Todas", color: "#94a3b8" }, ...CATEGORIES].map((c) => {
                    const active = paletteCategory === c.id;
                    return (
                      <button key={c.id} type="button" onClick={() => { setPaletteCategory(c.id); setPaletteIndex(0); }}
                        style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, cursor: "pointer", border: `1px solid ${active ? c.color : `${c.color}44`}`, background: active ? `${c.color}22` : "transparent", color: active ? c.color : "rgba(255,255,255,0.6)" }}>
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              )}
              <div style={{ display: "grid", gap: 6 }}>
                {paletteQuery.trim() ? (
                  paletteMatches.map((p, i) => paletteRow(p, i, true))
                ) : (
                  <>
                    {recentEntries.length > 0 && paletteCategory === "todas" && (
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 0.5 }}>Recientes</div>
                        {recentEntries.map((p) => paletteRow(p, -1, false))}
                      </div>
                    )}
                    {paletteGroups.map(([cat, entries]) => (
                      <div key={cat} style={{ display: "grid", gap: 6 }}>
                        <button type="button" onClick={() => setCollapsedCats((prev) => { const next = { ...prev, [cat]: !prev[cat] }; try { localStorage.setItem("flows.paletteCollapsed", JSON.stringify(next)); } catch { /* noop */ } return next; })}
                          style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: catColor(cat), flexShrink: 0 }} />
                          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 0.5 }}>{catLabel(cat)}</span>
                          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{collapsedCats[cat] ? `+${entries.length}` : ""}</span>
                        </button>
                        {!collapsedCats[cat] && entries.map((p) => paletteRow(p, -1, false))}
                      </div>
                    ))}
                  </>
                )}
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "rgba(255,255,255,0.55)", marginTop: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={paletteAdvanced} onChange={(e) => { setPaletteAdvanced(e.target.checked); try { localStorage.setItem("flows.paletteAdvanced", e.target.checked ? "1" : "0"); } catch { /* noop */ } }} />
                Mostrar avanzadas (P2)
              </label>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 10, lineHeight: 1.5 }}>
                Tab abre esta paleta (buscador + categorías; ↑↓ y Enter agregan); doble clic en el vacío también. Shift+clic o shift+arrastrar en el vacío selecciona varios; Ctrl/Cmd+C/V/D copia/pega/duplica; Delete borra la selección; Ctrl/Cmd+Z (y Shift+Z / Y) deshace/rehace. Conecta del puerto de salida al nodo de entrada — cada regla del switch tiene su puerto y TODOS los nodos traen salida roja «!» de error. Las notas no se conectan ni se ejecutan. Los pines del inspector congelan un nodo para depurar («Con pines»).
              </div>
            </div>
          </div>
        </div>
        )}
        {/* ── REQ-047: modal de nodo estilo n8n — entrada | configuración | salida ── */}
        {nodeModal && (() => {
          const mNode = nodes.find((n) => n.id === nodeModal) ?? null;
          if (!mNode) return null;
          const mMeta = NODE_META[mNode.type] ?? { label: mNode.type, color: "#888" };
          const mStep = lastRunFull && Array.isArray(lastRunFull.steps) ? lastRunFull.steps.find((s: any) => s?.nodeId === nodeModal) : null;
          const mCount = (v: unknown) => { const n = countItemsOf(v); return n == null ? "" : `${n} ${n === 1 ? "item" : "items"}`; };
          const colHead = (txt: string, extra?: string) => (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)", fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color: "rgba(255,255,255,0.45)", flexShrink: 0 }}>
              {txt}
              {extra ? <span style={{ marginLeft: "auto", textTransform: "none", letterSpacing: 0, color: "rgba(255,255,255,0.6)" }}>{extra}</span> : null}
            </div>
          );
          return (
            <div role="dialog" aria-label={`Detalles del nodo ${mNode.label}`}
              onClick={() => setNodeModal(null)}
              style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(8,8,12,0.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
              <div onClick={(e) => e.stopPropagation()}
                style={{ width: "min(1120px, 96vw)", height: "min(660px, 88vh)", background: "#131318", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 14, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,0.55)" }}>
                {/* Header: nodo + meta del run + cerrar */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.1)", flexShrink: 0 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: mMeta.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.92)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mNode.label}</span>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 999, padding: "1px 8px", flexShrink: 0 }}>{mMeta.label}</span>
                  {lastRunFull ? (
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      run: <span style={{ color: runStatusInfo(String(lastRunFull.status ?? ""))?.color ?? "#f87171" }}>{runStatusInfo(String(lastRunFull.status ?? ""))?.label ?? String(lastRunFull.status ?? "?")}</span>
                      {lastRunFull.status === "waiting" && lastRunFull.expiresAt ? <span style={{ color: "#fbbf24" }}>{" · expira en "}{Math.max(0, Math.round((new Date(lastRunFull.expiresAt).getTime() - Date.now()) / 60000))}{" min"}</span> : null}
                      {" · "}{new Date(lastRunFull.startedAt).toLocaleString()}
                      {mStep ? ` · ${mStep.ms ?? 0}ms${mStep.pinned ? " · pineado" : ""}` : ""}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>este flow todavía no tiene runs</span>
                  )}
                  <button type="button" onClick={() => setNodeModal(null)} aria-label="Cerrar" title="Cerrar (clic fuera también cierra)"
                    style={{ ...btnBase, marginLeft: "auto", padding: "3px 9px", fontSize: 13, lineHeight: 1, flexShrink: 0 }}>✕</button>
                </div>
                {/* 3 columnas */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1.15fr 1fr", flex: 1, minHeight: 0 }}>
                  {/* ENTRADA */}
                  <div style={{ borderRight: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", minHeight: 0 }}>
                    {colHead("Entrada", mStep && mStep.input !== undefined ? mCount(mStep.input) : "")}
                    <div style={{ padding: "8px 12px", overflowY: "auto", flex: 1, minHeight: 0 }}>
                      {mStep && mStep.input !== undefined ? (
                        <JsonBox value={mStep.input} maxHeight={9999} />
                      ) : (
                        <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
                          {mStep ? "Este nodo no recibió datos de entrada (es una fuente: toma datos de afuera)." : "Sin ejecución: no hay entrada que mostrar."}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* CONFIGURACIÓN */}
                  <div style={{ borderRight: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", minHeight: 0 }}>
                    {colHead("Configuración")}
                    <div style={{ padding: "10px 12px", overflowY: "auto", flex: 1, minHeight: 0, display: "grid", gap: 6, alignContent: "start" }}>
                      {Object.entries(mNode.config ?? {}).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "").map(([k, v]) => (
                        <div key={k} style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 8, fontSize: 11.5, alignItems: "baseline" }}>
                          <span style={{ color: "rgba(255,255,255,0.4)", overflowWrap: "anywhere" }}>{k}</span>
                          <span style={{ color: "rgba(255,255,255,0.82)", fontFamily: "monospace", fontSize: 11, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
                            {typeof v === "string" ? v : JSON.stringify(v)}
                          </span>
                        </div>
                      ))}
                      <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 8, fontSize: 11.5 }}>
                        <span style={{ color: "rgba(255,255,255,0.4)" }}>al fallar</span>
                        <span style={{ color: "rgba(255,255,255,0.82)" }}>{mNode.onError ?? (String(mNode.type).startsWith("source") ? "continuar con el resto" : "detener el run")}</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 8, fontSize: 11.5 }}>
                        <span style={{ color: "rgba(255,255,255,0.4)" }}>reintentos</span>
                        <span style={{ color: "rgba(255,255,255,0.82)" }}>{Number(mNode.retry ?? 0)}</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 8, fontSize: 11.5 }}>
                        <span style={{ color: "rgba(255,255,255,0.4)" }}>habilitado</span>
                        <span style={{ color: mNode.enabled === false ? "#f87171" : "#4ade80" }}>{mNode.enabled === false ? "no" : "sí"}</span>
                      </div>
                      <button type="button" onClick={() => { setNodeModal(null); setSelected(mNode.id); setInspectorOpen(true); }}
                        style={{ ...btnBase, marginTop: 8, justifyContent: "center" }}
                        title="Cierra este modal y abre el panel de edición a la derecha">
                        Editar configuración →
                      </button>
                    </div>
                  </div>
                  {/* SALIDA */}
                  <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
                    {colHead("Salida", mStep && mStep.output !== undefined ? mCount(mStep.output) : "")}
                    <div style={{ padding: "8px 12px", overflowY: "auto", flex: 1, minHeight: 0, display: "grid", gap: 8, alignContent: "start" }}>
                      {!lastRunFull || !mStep ? (
                        <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
                          Este nodo <b>no se ejecutó</b> en el último run. Motivos típicos:
                          <ul style={{ margin: "6px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>
                            {lastRunFull?.status === "waiting" && (() => {
                              // REQ-047: la pausa ai_task NO es un fallo — primer
                              // motivo honesto cuando el run está esperando a la IA.
                              const wStep = (Array.isArray(lastRunFull.steps) ? lastRunFull.steps : []).find((s: any) => s?.output?.waiting === true);
                              const wNode = wStep ? nodes.find((n) => n.id === wStep.nodeId) : null;
                              return wNode ? (
                                <li key="espera-ia"><b style={{ color: "#fbbf24" }}>el run está EN ESPERA de tu IA en «{wNode.label}»</b> — no es un error: estos nodos correrán solos cuando tu IA entregue la tarea (flow_ai_complete);</li>
                              ) : null;
                            })()}
                            <li>un nodo anterior falló con «detener el run» y el flujo se paró antes de llegar aquí;</li>
                            <li>el nodo se agregó (o se habilitó) después de ese run;</li>
                            <li>está deshabilitado (interruptor apagado).</li>
                          </ul>
                        </div>
                      ) : (
                        <>
                          {mStep.output?.waiting === true ? (
                            // REQ-047: un paso en espera NO es "ejecutado sin errores"
                            // — el run está pausado aquí hasta que tu IA entregue.
                            <div style={{ border: "1px solid rgba(251,191,36,0.5)", background: "rgba(251,191,36,0.08)", borderRadius: 8, padding: "9px 11px", display: "grid", gap: 5 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, color: "#fcd34d" }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></svg>
                                En espera de tu IA
                              </div>
                              <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.8)", lineHeight: 1.55 }}>
                                El run está <b>pausado en este nodo</b>: dejó el encargo en la bandeja <code>flow_ai_tasks</code>. Cuando tu IA lo complete (<code>flow_ai_complete</code>), el run sigue solo — este lienzo se actualiza automáticamente.
                              </div>
                              {lastRunFull.expiresAt ? (
                                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
                                  Expira en {Math.max(0, Math.round((new Date(lastRunFull.expiresAt).getTime() - Date.now()) / 60000))} min: si nadie la atiende antes, el run termina WAIT_EXPIRED (sin costo) y se vuelve a lanzar.
                                </div>
                              ) : null}
                            </div>
                          ) : mStep.ok ? (
                            <div style={{ fontSize: 11, color: "#4ade80", display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ width: 8, height: 8, borderRadius: 8, background: "#4ade80", flexShrink: 0 }} /> Ejecutado sin errores
                            </div>
                          ) : (
                            <div style={{ border: "1px solid rgba(248,113,113,0.5)", background: "rgba(248,113,113,0.1)", borderRadius: 8, padding: "8px 10px", display: "grid", gap: 4 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "#fca5a5" }}>✗ Falló aquí — {String(mStep.error?.code ?? "ERROR")}</div>
                              <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.85)", overflowWrap: "anywhere" }}>{String(mStep.error?.message ?? "sin detalle")}</div>
                              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", lineHeight: 1.5 }}>
                                {RUN_ERROR_HINTS[String(mStep.error?.code ?? "")] ?? "Revisa el mensaje de arriba; el detalle completo quedó en la pestaña Historial."}
                              </div>
                            </div>
                          )}
                          {mStep.output !== undefined ? <JsonBox value={mStep.output} maxHeight={9999} /> : (
                            <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.45)" }}>Sin salida (el nodo falló antes de producir datos).</div>
                          )}
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {mStep.output !== undefined && (
                              <button type="button" title="Congela este nodo: en el próximo run NO se ejecuta y usa estos datos (debug)"
                                onClick={() => {
                                  setPins((prev) => ({ ...prev, [mNode.id]: JSON.stringify(mStep.output) }));
                                  onNotice("ok", `Salida pineada para «${mNode.label}»: el próximo run la usará sin ejecutar el nodo (Quitar pin en el inspector).`);
                                  setNodeModal(null);
                                }}
                                style={{ ...btnBase, fontSize: 10.5, padding: "3px 8px" }}>
                                Pinear esta salida
                              </button>
                            )}
                            {props.flow.id && lastRunFull && (
                              <button type="button" disabled={retrying != null || pinsRunning}
                                title="F8: pinea los ancestros con sus salidas de este run y ejecuta solo desde este nodo"
                                onClick={() => { void rerunFromStep(lastRunFull, mStep); setNodeModal(null); }}
                                style={{ ...btnBase, fontSize: 10.5, padding: "3px 8px", opacity: retrying != null ? 0.5 : 1 }}>
                                ▶ Re-ejecutar desde aquí
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
