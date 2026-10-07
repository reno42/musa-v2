// REQ-027 — FlowEditor: canvas de nodos del flow builder.
// Toda operación de datos va por mcpCall a las tools flow_* (flow_save /
// flow_run / list_templates / get_html_frames) — la UI es solo otro cliente
// MCP; nada de rutas privadas. El botón Ejecutar llama la MISMA flow_run que
// usa una IA o el webhook.

import { useCallback, useEffect, useRef, useState } from "react";
import { mcpCall } from "../../lib/mcpClient";
import { downloadBlob } from "../../lib/download";
import {
  AI_PROVIDERS, CONDITION_OPERATORS, NODE_META, NODE_PALETTE,
  type FlowDef, type FlowEdge, type FlowCredential, type FlowNode, type FlowRun,
} from "./flowTypes";

const CANVAS_W = 2200;
const CANVAS_H = 1400;
const NODE_W = 208;

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
function NodeBody({ node }: { node: FlowNode }) {
  const c = node.config ?? {};
  const rows: [string, string][] = [];
  if (c.url != null) rows.push(["url", String(c.url || "—")]);
  if (c.username) rows.push(["usuario", `@${c.username}`]);
  if (c.instanceUrl) rows.push(["instancia", String(c.instanceUrl)]);
  if (node.type === "ai") rows.push(["modelo", `${c.provider ?? "—"}${c.model ? ` · ${c.model}` : ""}`]);
  if (node.type === "ai") rows.push(["credencial", c.credentialId ? String(c.credentialId) : "sin credencial"]);
  if (node.type === "template") rows.push(["archivo+frame", c.templateId && c.frameId ? `${String(c.frameId).slice(0, 14)}` : "a configurar"]);
  if (c.maxItems != null && ["ai", "template", "source_rss", "source_http", "source_nitter"].includes(node.type)) rows.push(["máx items", String(c.maxItems)]);
  if (node.type === "condition") rows.push(["si", `${c.path ?? "—"} ${c.operator ?? ""}${c.value !== undefined ? ` ${c.value}` : ""}`]);
  if (node.type === "text") rows.push(["texto", String(c.template || "—").slice(0, 80)]);
  if (node.type === "report") rows.push(["título", String(c.title || "Reporte")]);
  return (
    <div style={{ padding: "7px 10px 9px", display: "grid", gap: 2 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ fontSize: 10.5, color: "rgba(255,255,255,0.55)", display: "flex", gap: 6, minWidth: 0 }}>
          <span style={{ color: "rgba(255,255,255,0.32)", flexShrink: 0 }}>{k}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
        </div>
      ))}
      {node.enabled === false && <div style={{ fontSize: 10, color: "#fbbf24" }}>nodo deshabilitado</div>}
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

// ── Disparo (nodo inicial, estilo n8n): vive en la paleta (sección Inicio) y
// en el lienzo como tarjeta arrastrable y CONECTABLE: su línea al primer nodo
// es organizativa (trigger.entry, no es una arista del graph) — el run sigue
// empezando en los nodos fuente y el engine no cambia. ──
const TRIGGER_META: Record<"manual" | "webhook" | "schedule", { label: string; color: string; hint: string }> = {
  manual: { label: "Disparo manual", color: "#22d3ee", hint: "Ejecútalo con ▶ Ejecutar o pídeselo a tu IA (flow_run)" },
  webhook: { label: "Disparo webhook", color: "#22d3ee", hint: "Un POST a la URL del webhook ejecuta el flow" },
  schedule: { label: "Disparo horario", color: "#22d3ee", hint: "Los horarios los ejecuta tu IA con flow_due_check + flow_run" },
};
const TRIGGER_ICONS: Record<"manual" | "webhook" | "schedule", React.ReactNode> = {
  manual: <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />,
  webhook: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>,
  schedule: <><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></>,
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
  onRunFlow: (flowId: string) => void;
  running: boolean;
}) {
  const { workspaceId, credentials, onClose, onSaved, onNotice, onRunFlow, running } = props;
  const [name, setName] = useState(props.flow.name);
  const [enabled, setEnabled] = useState(props.flow.enabled);
  const [trigger, setTrigger] = useState<any>(props.flow.trigger ?? { type: "manual" });
  const [nodes, setNodes] = useState<FlowNode[]>(props.flow.nodes);
  const [edges, setEdges] = useState<FlowEdge[]>(props.flow.edges);
  const [selected, setSelected] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false); // acordeón del inspector: solo abre al clicar un nodo
  const [paletteOpen, setPaletteOpen] = useState(false); // columna derecha de nodos: OCULTA por defecto — solo el botón «+ Agregar nodo» o el doble clic en el vacío la abren
  const [panning, setPanning] = useState(false); // arrastra el fondo del lienzo para desplazarlo (cursor manito)
  const [connecting, setConnecting] = useState<{ from: string; when?: "true" | "false" } | null>(null);
  const [connectPoint, setConnectPoint] = useState<{ x: number; y: number } | null>(null); // cursor en coords de canvas — guía de conexión
  const [saving, setSaving] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [templateOptions, setTemplateOptions] = useState<{ id: string; name: string }[]>([]);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const triggerDragRef = useRef<{ dx: number; dy: number } | null>(null); // arrastre del nodo inicial (disparo)
  const connectStartRef = useRef<{ x: number; y: number } | null>(null); // pointerdown del puerto — umbral clic vs arrastre
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(1); // espejo del zoom para handlers sin re-suscribir
  const panRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null); // origen del jalón del fondo
  const undoStackRef = useRef<{ nodes: FlowNode[]; edges: FlowEdge[]; entry: string | null }[]>([]); // snapshots de borrado para Ctrl/Cmd+Z
  const graphRef = useRef({ nodes, edges, entry: (trigger?.entry as string | undefined) ?? undefined });
  const [selectedEdge, setSelectedEdge] = useState<number | null>(null); // conexión seleccionada (índice) — Delete la borra
  const [editorTab, setEditorTab] = useState<"editor" | "historial">("editor"); // pestañas del builder, como en el resto de la web
  const [runs, setRuns] = useState<FlowRun[] | null>(null); // historial del flow actual (pestaña Historial)
  const [entrySel, setEntrySel] = useState(false); // línea disparo→nodo seleccionada (Delete la borra)
  const [zoom, setZoom] = useState(1); // zoom del lienzo: pinch del trackpad o ctrl+rueda (0.4–2)

  const selectedNode = nodes.find((n) => n.id === selected) ?? null;

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
  // la MISMA tool que la pestaña runs de FlowsTab. Recarga cada vez que entra.
  useEffect(() => {
    if (editorTab !== "historial" || !props.flow.id) return;
    let alive = true;
    setRuns(null);
    mcpCall("flow_history", { workspaceId, flowId: props.flow.id, limit: 30 })
      .then((res: any) => { if (alive) setRuns(res?.runs ?? []); })
      .catch((e: any) => { if (alive) { setRuns([]); onNotice("err", `flow_history: ${e?.message ?? e}`); } });
    return () => { alive = false; };
  }, [editorTab, props.flow.id, workspaceId, onNotice]);

  // ── Drag de nodos y del nodo inicial: mantén presionado sobre la cabecera
  // y jala — grid de 10px. La posición del disparo vive EN el trigger (flow_save
  // la persiste), así que al recargar queda donde el usuario la dejó. ──
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const tdrag = triggerDragRef.current;
      if (tdrag) {
        const x = Math.max(0, Math.round(((e.clientX - rect.left + (canvasRef.current?.scrollLeft ?? 0)) / zoomRef.current - tdrag.dx) / 10) * 10);
        const y = Math.max(0, Math.round(((e.clientY - rect.top + (canvasRef.current?.scrollTop ?? 0)) / zoomRef.current - tdrag.dy) / 10) * 10);
        setTrigger((prev: any) => ({ ...(prev ?? { type: "manual" }), position: { x, y } }));
        return;
      }
      const drag = dragRef.current;
      if (!drag) return;
      const x = Math.max(0, Math.round(((e.clientX - rect.left + (canvasRef.current?.scrollLeft ?? 0)) / zoomRef.current - drag.dx) / 10) * 10);
      const y = Math.max(0, Math.round(((e.clientY - rect.top + (canvasRef.current?.scrollTop ?? 0)) / zoomRef.current - drag.dy) / 10) * 10);
      setNodes((prev) => prev.map((n) => (n.id === drag.id ? { ...n, position: { x, y } } : n)));
    };
    const up = () => { dragRef.current = null; triggerDragRef.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, []);

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

  // ── Conexión de nodos: arrastra del puerto de salida y suelta sobre el
  // nodo de entrada (o clic en salida → clic en entrada). Mientras conectas,
  // una guía punteada sigue al cursor; Esc o clic en el vacío cancela. ──
  useEffect(() => {
    if (!connecting) { setConnectPoint(null); return; }
    const toCanvas = (e: PointerEvent) => {
      const el = canvasRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: (e.clientX - r.left + el.scrollLeft) / zoomRef.current, y: (e.clientY - r.top + el.scrollTop) / zoomRef.current };
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

  function addNode(type: string) {
    const meta = NODE_PALETTE.find((p) => p.type === type);
    if (!meta) return;
    const id = `${type.split("_")[0].replace("source", "src")}${nodes.length + 1}_${Math.random().toString(36).slice(2, 5)}`;
    const node: FlowNode = {
      id, type, label: meta.label, enabled: true, onError: type.startsWith("source") ? "continue" : "stop",
      config: meta.config(), position: { x: 40 + (nodes.length % 5) * 250, y: 40 + Math.floor(nodes.length / 5) * 150 },
    };
    setNodes((prev) => [...prev, node]);
    setSelected(id);
    setInspectorOpen(true); // el nodo nuevo nace con su panel abierto: se configura al instante
  }

  function patchNode(id: string, patch: Partial<FlowNode>) {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }
  function patchConfig(id: string, patch: Record<string, any>) {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, config: { ...n.config, ...patch } } : n)));
  }

  function completeConnection(targetId: string) {
    if (!connecting || connecting.from === targetId) { setConnecting(null); setConnectPoint(null); return; }
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
    const target = nodes.find((n) => n.id === targetId);
    const fanIn = target?.type === "ai" || target?.type === "report";
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

  // ── Undo de borrados: cada delete (nodo o conexión) apila un snapshot
  // {nodes, edges}; Ctrl/Cmd+Z reintegra el último. graphRef evita snapshots
  // con estado viejo del render. ──
  useEffect(() => { graphRef.current = { nodes, edges, entry: trigger?.entry }; });
  function pushUndo() {
    const g = graphRef.current;
    undoStackRef.current.push({ nodes: g.nodes.map((n) => ({ ...n })), edges: g.edges.map((e) => ({ ...e })), entry: g.entry ?? null });
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
  }

  function deleteNode(id: string) {
    pushUndo();
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.from !== id && e.to !== id));
    if (graphRef.current.entry === id) {
      // El nodo borrado era el destino de la línea del disparo: muere con él.
      setTrigger((prev: any) => { const next = { ...(prev ?? { type: "manual" }) }; delete next.entry; return next; });
      setEntrySel(false);
    }
    setSelected(null);
    setSelectedEdge(null);
    setEntrySel(false);
    setInspectorOpen(false);
  }

  async function save() {
    setSaving(true);
    try {
      const params: Record<string, any> = {
        workspaceId, name, enabled,
        trigger: trigger?.type ? trigger : { type: "manual" },
        nodes: nodes.map((n) => ({ id: n.id, type: n.type, label: n.label, enabled: n.enabled !== false, onError: n.onError, config: n.config, position: n.position })),
        edges,
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

  // ── Teclado del builder: Delete/Backspace borra la selección (conexión o
  // nodo, SIN confirmación) y Ctrl/Cmd+Z reintegra el último borrado. Ignora
  // teclas mientras se escribe en un campo y fuera de la pestaña Editor. ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editorTab !== "editor") return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === "z") {
        const snap = undoStackRef.current.pop();
        if (snap) {
          e.preventDefault(); e.stopPropagation();
          setNodes(snap.nodes); setEdges(snap.edges);
          setTrigger((prev: any) => ({ ...(prev ?? { type: "manual" }), ...(snap.entry ? { entry: snap.entry } : { entry: undefined }) }));
          setSelected(null); setSelectedEdge(null); setEntrySel(false); setInspectorOpen(false);
        }
        return;
      }
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (selectedEdge != null) {
        e.preventDefault();
        pushUndo();
        setEdges((prev) => prev.filter((_, idx) => idx !== selectedEdge));
        setSelectedEdge(null);
        return;
      }
      if (entrySel) {
        e.preventDefault();
        pushUndo();
        setTrigger((prev: any) => { const next = { ...(prev ?? { type: "manual" }) }; delete next.entry; return next; });
        setEntrySel(false);
        return;
      }
      if (selected && selected !== "__trigger__") { e.preventDefault(); deleteNode(selected); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editorTab, selected, selectedEdge, entrySel]);

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

  const portPos = (node: FlowNode, when?: "true" | "false") => {
    const y = node.position.y + (when === "true" ? 16 : when === "false" ? 44 : 30);
    return { x: node.position.x + NODE_W, y };
  };
  const inPos = (node: FlowNode) => ({ x: node.position.x, y: node.position.y + 30 });

  // ── Pestaña Historial: últimas ejecuciones de ESTE flow (flow_history). ──
  const statusColor = (s: string) => (s === "success" ? "#4ade80" : s === "failed" ? "#f87171" : "#fbbf24");
  function renderHistorial() {
    return (
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 10 }}>
          Últimas ejecuciones de este flow. ▶ Ejecutar usa la MISMA flow_run que tu IA o el webhook.
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
                  <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 11 }}>{new Date(r.startedAt).toLocaleString()}</span>
                  {r.finishedAt && <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 11 }}>→ {new Date(r.finishedAt).toLocaleTimeString()}</span>}
                  <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 11, marginLeft: "auto" }}>{r.steps?.length ?? 0} pasos</span>
                </summary>
                {r.error && <div style={{ marginTop: 8, fontSize: 11, color: "#fca5a5" }}>{r.error}</div>}
                {!!r.steps?.length && (
                  <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                    {r.steps.map((s, si) => (
                      <div key={`${r.runId}-${si}`} style={{ display: "flex", gap: 8, fontSize: 11, color: "rgba(255,255,255,0.6)", flexWrap: "wrap" }}>
                        <span style={{ color: s.ok ? "#4ade80" : "#f87171" }}>{s.ok ? "ok" : "fail"}</span>
                        <span style={{ color: "rgba(255,255,255,0.8)" }}>{s.label}</span>
                        <span style={{ color: "rgba(255,255,255,0.35)" }}>{s.type} · {s.ms}ms</span>
                        {s.error && <span style={{ color: "#fca5a5" }}>{s.error.message}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </details>
            ))}
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
          <button type="button" className="workspace-button secondary" onClick={exportJson}>Exportar</button>
          {trigger?.type === "webhook" && props.flow.id && (
            <button type="button" className="workspace-button secondary" onClick={() => void rotateWebhook()} title="Invalida la URL actual y genera una nueva (se muestra solo esta vez)">Rotar webhook</button>
          )}
          <div style={{ flex: 1 }} />
          {props.flow.id && (
            <button type="button" className="workspace-button" disabled={running} onClick={() => onRunFlow(props.flow.id!)} style={{ opacity: running ? 0.5 : 1 }}>
              {running ? "Ejecutando…" : "▶ Ejecutar"}
            </button>
          )}
          <button type="button" className="workspace-button" onClick={save} disabled={saving} style={{ opacity: saving ? 0.5 : 1 }}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
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
              setSelected(null); setSelectedEdge(null); setConnecting(null); setInspectorOpen(false);
              if (!connecting) {
                const el = canvasRef.current;
                if (el) { panRef.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop }; setPanning(true); }
              }
            }}
            onDoubleClick={(e) => { if (e.target === canvasRef.current || (e.target as HTMLElement).dataset.canvasBg) setPaletteOpen(true); }}>
            {/* El wrapper define la extensión scrollable escalada; el interior
                se transforma con scale(zoom) — las coords de contenido quedan
                intactas para drag, puertos y SVG. */}
            <div data-canvas-bg="1" style={{ width: CANVAS_W * zoom, height: CANVAS_H * zoom, position: "relative" }}>
              <div data-canvas-bg="1" style={{ width: CANVAS_W, height: CANVAS_H, position: "absolute", top: 0, left: 0, transform: `scale(${zoom})`, transformOrigin: "0 0",
              backgroundImage: "radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)", backgroundSize: "22px 22px" }} >
              <svg width={CANVAS_W} height={CANVAS_H} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                {edges.map((edge, i) => {
                  const from = nodes.find((n) => n.id === edge.from);
                  const to = nodes.find((n) => n.id === edge.to);
                  if (!from || !to) return null;
                  const a = portPos(from, edge.when as "true" | "false" | undefined);
                  const b = inPos(to);
                  const path = `M ${a.x} ${a.y} C ${a.x + 60} ${a.y}, ${b.x - 60} ${b.y}, ${b.x} ${b.y}`;
                  const color = edge.when === "true" ? "#4ade80" : edge.when === "false" ? "#f87171" : "rgba(255,255,255,0.35)";
                  const sel = selectedEdge === i;
                  return (
                    <g key={`${edge.from}>${edge.to}:${edge.when ?? ""}`}>
                      <path d={path} stroke={sel ? "#a5b4fc" : color} strokeWidth={sel ? 2.4 : 1.6} fill="none" />
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
                      <path d={path} stroke={entrySel ? "#a5b4fc" : "rgba(34,211,238,0.55)"} strokeWidth={entrySel ? 2.4 : 1.6} strokeDasharray="7 5" fill="none" />
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
                  const a = isTrigger ? { x: tp.x + NODE_W, y: tp.y + 30 } : portPos(from as FlowNode, connecting.when as "true" | "false" | undefined);
                  const color = isTrigger ? "#22d3ee" : connecting.when === "true" ? "#4ade80" : connecting.when === "false" ? "#f87171" : String(NODE_META[(from as FlowNode).type]?.color ?? "#818cf8");
                  const flip = connectPoint.x < a.x;
                  const dx = Math.max(40, Math.abs(connectPoint.x - a.x) / 2);
                  return (
                    <path d={`M ${a.x} ${a.y} C ${a.x + (flip ? -dx : dx)} ${a.y}, ${connectPoint.x + (flip ? dx : -dx)} ${connectPoint.y}, ${connectPoint.x} ${connectPoint.y}`}
                      stroke={color} strokeWidth={1.8} strokeDasharray="5 4" fill="none" opacity={0.9} />
                  );
                })()}
              </svg>

              {/* Nodo inicial (disparo): tarjeta estilo n8n — espejo del trigger
                  del flow. Se ARRASTRA con la cabecera para ordenar el lienzo a
                  voluntad (la posición se guarda en el trigger) y se configura
                  desde la sección Inicio de la paleta o clic aquí. No es parte
                  del graph. */}
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
                  <div onPointerDown={() => { setSelected("__trigger__"); setSelectedEdge(null); setEntrySel(false); setInspectorOpen(true); }}
                    style={{ position: "absolute", left: tpos.x, top: tpos.y, width: NODE_W,
                      background: "#131318", border: `1px solid ${tSel ? tmeta.color : "rgba(255,255,255,0.12)"}`,
                      boxShadow: tSel ? `0 0 0 2px ${tmeta.color}44` : "none", borderRadius: 10, userSelect: "none" }}>
                    <div onPointerDown={(e) => {
                      const rect = canvasRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      triggerDragRef.current = { dx: (e.clientX - rect.left + (canvasRef.current?.scrollLeft ?? 0)) / zoomRef.current - tpos.x, dy: (e.clientY - rect.top + (canvasRef.current?.scrollTop ?? 0)) / zoomRef.current - tpos.y };
                    }}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid rgba(255,255,255,0.07)", cursor: "grab" }}>
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
                const meta = NODE_META[node.type] ?? { label: node.type, color: "#888" };
                const isSel = selected === node.id;
                const target = connecting && connecting.from !== node.id;
                return (
                  <div key={node.id} data-connect-node={node.id} onPointerDown={() => { if (!connecting) { setSelected(node.id); setSelectedEdge(null); setEntrySel(false); setInspectorOpen(true); } }}
                    onClick={() => { if (connecting && connecting.from !== node.id) completeConnection(node.id); }}
                    style={{
                      position: "absolute", left: node.position.x, top: node.position.y, width: NODE_W,
                      background: "#131318", border: `1px solid ${isSel ? meta.color : "rgba(255,255,255,0.12)"}`,
                      boxShadow: isSel ? `0 0 0 2px ${meta.color}44` : "none", borderRadius: 10, cursor: "grab", userSelect: "none",
                      opacity: node.enabled === false ? 0.55 : 1,
                    }}>
                    <div onPointerDown={(e) => {
                      const rect = canvasRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      dragRef.current = { id: node.id, dx: (e.clientX - rect.left + (canvasRef.current?.scrollLeft ?? 0)) / zoomRef.current - node.position.x, dy: (e.clientY - rect.top + (canvasRef.current?.scrollTop ?? 0)) / zoomRef.current - node.position.y };
                    }}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid rgba(255,255,255,0.07)", cursor: "grab" }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: meta.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.9)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.label}</span>
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{meta.label}</span>
                      <Switch on={node.enabled !== false} onToggle={() => patchNode(node.id, { enabled: node.enabled === false })} title="Activar o desactivar nodo (los deshabilitados se ignoran en el run)" />
                    </div>
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
                    <NodeBody node={node} />
                    {/* puerto de entrada */}
                    <div title={target ? "Soltar conexión aquí" : "Entrada"} onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => { if (connecting) completeConnection(node.id); }}
                      style={{ position: "absolute", left: -8, top: 22, width: 16, height: 16, borderRadius: "50%",
                        background: target ? "#818cf8" : "#1c1c22", border: `2px solid ${target ? "#818cf8" : "rgba(255,255,255,0.3)"}`, cursor: connecting ? "crosshair" : "default", touchAction: "none" }} />
                    {/* puertos de salida (condition: ✓/✗) */}
                    {(node.type === "condition" ? [["true", "#4ade80", 16], ["false", "#f87171", 44]] : [[undefined, meta.color, 30]])
                      .map(([when, color, top]) => (
                        <div key={String(when)} title={when === "true" ? "Salida verdadero" : when === "false" ? "Salida falso" : "Salida"}
                          onPointerDown={(e) => { e.stopPropagation(); connectStartRef.current = { x: e.clientX, y: e.clientY }; setConnecting({ from: node.id, when: when as "true" | "false" | undefined }); }}
                          onClick={(e) => { e.stopPropagation(); setConnecting({ from: node.id, when: when as "true" | "false" | undefined }); }}
                          style={{ position: "absolute", right: -8, top: Number(top) - 8, width: 16, height: 16, borderRadius: "50%",
                            background: connecting?.from === node.id && connecting?.when === when ? String(color) : "#1c1c22",
                            border: `2px solid ${connecting?.from === node.id && connecting?.when === when ? String(color) : String(color) + "88"}`,
                            cursor: "crosshair", color: String(color), fontSize: 8, lineHeight: "10px", textAlign: "center", touchAction: "none" }}>
                          {when === "true" ? "✓" : when === "false" ? "✗" : ""}
                        </div>
                      ))}
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
                  {(["manual", "webhook", "schedule"] as const).map((t) => {
                    const active = (trigger?.type ?? "manual") === t;
                    return (
                      <button key={t} type="button" title={TRIGGER_META[t].hint}
                        onClick={() => setTrigger(t === "schedule" ? { type: "schedule", cron: trigger?.cron || "0 8 * * *", timezone: trigger?.timezone || "America/Lima" } : { type: t })}
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
                {selectedNode.type.startsWith("source") && (
                  <Field label="Al fallar">
                    <select style={inputStyle} value={selectedNode.onError ?? "continue"} onChange={(e) => patchNode(selectedNode.id, { onError: e.target.value as "stop" | "continue" })}>
                      <option value="continue">continuar (recomendado)</option>
                      <option value="stop">detener el run</option>
                    </select>
                  </Field>
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
                    <Field label="Máx tokens de salida">
                      <input type="number" style={inputStyle} value={Number(selectedNode.config.maxOutputTokens ?? 400)} onChange={(e) => patchConfig(selectedNode.id, { maxOutputTokens: Number(e.target.value) })} />
                    </Field>
                    <Field label="Máx items (1-5)">
                      <input type="number" style={inputStyle} value={Number(selectedNode.config.maxItems ?? 3)} onChange={(e) => patchConfig(selectedNode.id, { maxItems: Number(e.target.value) })} />
                    </Field>
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

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
                  <span style={{ ...labelStyle, margin: 0 }}>Habilitado</span>
                  <Switch on={selectedNode.enabled !== false} onToggle={() => patchNode(selectedNode.id, { enabled: selectedNode.enabled === false })} title="Activar o desactivar nodo (los deshabilitados se ignoran en el run)" />
                </div>

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
              <div style={labelStyle}>Inicio</div>
              <div style={{ display: "grid", gap: 6 }}>
                {(["manual", "webhook", "schedule"] as const).map((t) => {
                  const active = (trigger?.type ?? "manual") === t;
                  return (
                    <button key={t} type="button" title={TRIGGER_META[t].hint}
                      onClick={() => { setTrigger(t === "schedule" ? { type: "schedule", cron: trigger?.cron || "0 8 * * *", timezone: trigger?.timezone || "America/Lima" } : { type: t }); setSelected("__trigger__"); setInspectorOpen(true); }}
                      style={{ ...btnBase, justifyContent: "flex-start", borderColor: active ? "rgba(34,211,238,0.6)" : "rgba(34,211,238,0.28)", background: active ? "rgba(34,211,238,0.14)" : "rgba(255,255,255,0.05)", color: active ? "#a5f3fc" : "rgba(255,255,255,0.85)" }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{TRIGGER_ICONS[t]}</svg>
                      {TRIGGER_META[t].label}
                    </button>
                  );
                })}
              </div>
              <div style={labelStyle}>Agregar nodo</div>
              <div style={{ display: "grid", gap: 6 }}>
                {NODE_PALETTE.map((p) => (
                  <button key={p.type} type="button" onClick={() => addNode(p.type)} title={p.hint}
                    style={{ ...btnBase, justifyContent: "flex-start", borderColor: `${NODE_META[p.type]?.color ?? "#888"}55` }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: NODE_META[p.type]?.color ?? "#888", flexShrink: 0 }} />
                    {p.label}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 10, lineHeight: 1.5 }}>
                Doble clic en el vacío abre esta columna; jalar el fondo desplaza el lienzo. Pinch del trackpad o ctrl+rueda hace zoom (anclado al cursor); dos dedos lo desplaza. Arrastra el encabezado para mover (nodos y disparo). Conecta del puerto de salida al nodo de entrada (o clic → clic) — también desde el disparo. Clic en una conexión la selecciona; Delete borra la conexión, la línea del disparo o el nodo seleccionado, y Ctrl/Cmd+Z reintegra lo borrado. Esc cancela.
              </div>
            </div>
          </div>
        </div>
        )}
    </div>
  );
}
