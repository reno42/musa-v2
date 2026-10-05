// REQ-027 — FlowEditor: canvas de nodos del flow builder.
// Toda operación de datos va por mcpCall a las tools flow_* (flow_save /
// flow_run / list_templates / get_html_frames) — la UI es solo otro cliente
// MCP; nada de rutas privadas. El botón Ejecutar llama la MISMA flow_run que
// usa una IA o el webhook.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { mcpCall } from "../../lib/mcpClient";
import { downloadBlob } from "../../lib/download";
import {
  AI_PROVIDERS, CONDITION_OPERATORS, NODE_META, NODE_PALETTE,
  type FlowDef, type FlowEdge, type FlowCredential, type FlowNode,
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
  const [connecting, setConnecting] = useState<{ from: string; when?: "true" | "false" } | null>(null);
  const [connectPoint, setConnectPoint] = useState<{ x: number; y: number } | null>(null); // cursor en coords de canvas — guía de conexión
  const [saving, setSaving] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [templateOptions, setTemplateOptions] = useState<{ id: string; name: string }[]>([]);
  const [frameOptions, setFrameOptions] = useState<{ id: string; name: string; width: number; height: number }[]>([]);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const connectStartRef = useRef<{ x: number; y: number } | null>(null); // pointerdown del puerto — umbral clic vs arrastre
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const selectedNode = nodes.find((n) => n.id === selected) ?? null;

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

  useEffect(() => {
    const templateId = selectedNode?.config?.templateId;
    if (!templateId) { setFrameOptions([]); return; }
    let alive = true;
    mcpCall("get_html_frames", { templateId })
      .then((res: any) => { if (alive) setFrameOptions((res?.frames ?? []).map((f: any) => ({ id: f.id, name: f.name ?? f.id, width: f.width, height: f.height }))); })
      .catch((e) => { if (alive) { setFrameOptions([]); onNotice("err", `get_html_frames: ${e?.message ?? e}`); } });
    return () => { alive = false; };
  }, [selectedNode?.config?.templateId, onNotice]);

  // ── Drag de nodos ──
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const drag = dragRef.current;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!drag || !rect) return;
      const x = Math.max(0, Math.round((e.clientX - rect.left + (canvasRef.current?.scrollLeft ?? 0) - drag.dx) / 10) * 10);
      const y = Math.max(0, Math.round((e.clientY - rect.top + (canvasRef.current?.scrollTop ?? 0) - drag.dy) / 10) * 10);
      setNodes((prev) => prev.map((n) => (n.id === drag.id ? { ...n, position: { x, y } } : n)));
    };
    const up = () => { dragRef.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, []);

  // ── Conexión de nodos: arrastra del puerto de salida y suelta sobre el
  // nodo de entrada (o clic en salida → clic en entrada). Mientras conectas,
  // una guía punteada sigue al cursor; Esc o clic en el vacío cancela. ──
  useEffect(() => {
    if (!connecting) { setConnectPoint(null); return; }
    const toCanvas = (e: PointerEvent) => {
      const el = canvasRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left + el.scrollLeft, y: e.clientY - r.top + el.scrollTop };
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
  }

  function patchNode(id: string, patch: Partial<FlowNode>) {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }
  function patchConfig(id: string, patch: Record<string, any>) {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, config: { ...n.config, ...patch } } : n)));
  }

  function completeConnection(targetId: string) {
    if (!connecting || connecting.from === targetId) { setConnecting(null); setConnectPoint(null); return; }
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

  function deleteNode(id: string) {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.from !== id && e.to !== id));
    setSelected(null);
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

  const portPos = (node: FlowNode, when?: "true" | "false") => {
    const y = node.position.y + (when === "true" ? 16 : when === "false" ? 44 : 30);
    return { x: node.position.x + NODE_W, y };
  };
  const inPos = (node: FlowNode) => ({ x: node.position.x, y: node.position.y + 30 });

  // Portal a document.body: dentro del dashboard, `.dash-atmosphere > *` mete
  // este tab en un stacking context z-1 y el nav global (z 10) pintaba ENCIMA
  // de esta barra. Capa dialogs (1000) — la escala de la casa (nota de
  // PeekPanel en index.css; mismo patrón que ImportWizardModal).
  // Sin backdrop-filter: con display scaling fraccional (150% en Windows),
  // scrollear el canvas dentro de un subtree con backdrop-filter deja
  // artefactos de repintado ("peines" de líneas); un velo más opaco cumple
  // el mismo rol sin el glitch.
  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(4,4,6,0.86)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
      <div style={{ width: "min(1280px, 96vw)", height: "min(860px, 94vh)", background: "#0e0e12", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Barra superior */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)", flexWrap: "wrap" }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del flow"
            style={{ ...inputStyle, width: 220, fontSize: 13, fontWeight: 600, background: "rgba(255,255,255,0.05)" }} />
          <select value={trigger?.type ?? "manual"} onChange={(e) => setTrigger(e.target.value === "schedule" ? { type: "schedule", cron: trigger?.cron || "0 8 * * *", timezone: trigger?.timezone || "America/Lima" } : { type: e.target.value })}
            style={{ ...inputStyle, width: 130 }}>
            <option value="manual">Disparo: manual</option>
            <option value="webhook">Disparo: webhook</option>
            <option value="schedule">Disparo: horario</option>
          </select>
          {trigger?.type === "schedule" && (
            <>
              <input value={trigger.cron ?? ""} onChange={(e) => setTrigger({ ...trigger, cron: e.target.value })} placeholder="0 8 * * *"
                title="Declarativo: los horarios los ejecuta tu IA — pídele que corra tu flow a esta hora (consulta flow_due_check y llama flow_run). Cron de 5 campos en la hora local del timezone." style={{ ...inputStyle, width: 110 }} />
              <input value={trigger.timezone ?? ""} onChange={(e) => setTrigger({ ...trigger, timezone: e.target.value })} placeholder="America/Lima" title="Zona horaria para interpretar el cron (ej. America/Lima). Los horarios los ejecuta tu IA: pídele que corra tu flow a esta hora." style={{ ...inputStyle, width: 130 }} />
            </>
          )}
          <button type="button" onClick={() => setEnabled(!enabled)} title={enabled ? "Activo: flow_save validará TODO configurado" : "Borrador: admite nodos template sin archivo+frame"}
            style={{ ...btnBase, borderColor: enabled ? "rgba(74,222,128,0.5)" : "rgba(255,255,255,0.14)", color: enabled ? "#4ade80" : "rgba(255,255,255,0.6)" }}>
            {enabled ? "● Activo" : "○ Borrador"}
          </button>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={exportJson} style={btnBase}>Exportar</button>
          {trigger?.type === "webhook" && props.flow.id && (
            <button type="button" onClick={() => void rotateWebhook()} title="Invalida la URL actual y genera una nueva (se muestra solo esta vez)" style={btnBase}>Rotar webhook</button>
          )}
          {props.flow.id && (
            <button type="button" disabled={running} onClick={() => onRunFlow(props.flow.id!)}
              style={{ ...btnBase, borderColor: "rgba(74,222,128,0.5)", color: "#4ade80", opacity: running ? 0.5 : 1 }}>
              {running ? "Ejecutando…" : "▶ Ejecutar"}
            </button>
          )}
          <button type="button" onClick={save} disabled={saving}
            style={{ ...btnBase, background: "rgba(129,140,248,0.2)", borderColor: "rgba(129,140,248,0.5)", color: "#c7d2fe", opacity: saving ? 0.5 : 1 }}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
          <button type="button" onClick={onClose} style={{ ...btnBase, padding: "5px 9px" }} title="Cerrar">✕</button>
        </div>

        {webhookUrl && (
          <div style={{ margin: "8px 14px 0", padding: "8px 12px", borderRadius: 8, background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.4)", fontSize: 11.5, color: "#fcd34d", wordBreak: "break-all" }}>
            Webhook (cópiala AHORA — se muestra solo esta vez): <code style={{ userSelect: "all" }}>{webhookUrl}</code>
          </div>
        )}

        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* Paleta */}
          <div style={{ width: 148, borderRight: "1px solid rgba(255,255,255,0.08)", padding: 10, overflowY: "auto" }}>
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
              Arrastra el encabezado para mover. Conecta arrastrando del puerto de salida al nodo de entrada (o clic en salida → clic en entrada). Clic en una conexión para borrarla. Esc cancela la conexión. Clic en un nodo para abrir su panel de edición.
            </div>
          </div>

          {/* Canvas */}
          <div ref={canvasRef} style={{ flex: 1, overflow: "auto", background: "#0a0a0d", position: "relative", cursor: connecting ? "crosshair" : "auto" }}
            onPointerDown={(e) => { if (e.target === canvasRef.current || (e.target as HTMLElement).dataset.canvasBg) { setSelected(null); setConnecting(null); setInspectorOpen(false); }}}>
            <div data-canvas-bg="1" style={{ width: CANVAS_W, height: CANVAS_H, position: "relative",
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
                  return (
                    <g key={`${edge.from}>${edge.to}:${edge.when ?? ""}`}>
                      <path d={path} stroke={color} strokeWidth={1.6} fill="none" />
                      <path d={path} stroke="transparent" strokeWidth={14} fill="none" style={{ pointerEvents: "stroke", cursor: "pointer" }}
                        onClick={() => setEdges((prev) => prev.filter((_, idx) => idx !== i))} >
                        <title>Clic para eliminar conexión</title>
                      </path>
                    </g>
                  );
                })}
                {/* Guía de conexión: sigue al cursor mientras conectas */}
                {connecting && connectPoint && (() => {
                  const from = nodes.find((n) => n.id === connecting.from);
                  if (!from) return null;
                  const a = portPos(from, connecting.when as "true" | "false" | undefined);
                  const color = connecting.when === "true" ? "#4ade80" : connecting.when === "false" ? "#f87171" : String(NODE_META[from.type]?.color ?? "#818cf8");
                  const flip = connectPoint.x < a.x;
                  const dx = Math.max(40, Math.abs(connectPoint.x - a.x) / 2);
                  return (
                    <path d={`M ${a.x} ${a.y} C ${a.x + (flip ? -dx : dx)} ${a.y}, ${connectPoint.x + (flip ? dx : -dx)} ${connectPoint.y}, ${connectPoint.x} ${connectPoint.y}`}
                      stroke={color} strokeWidth={1.8} strokeDasharray="5 4" fill="none" opacity={0.9} />
                  );
                })()}
              </svg>

              {nodes.map((node) => {
                const meta = NODE_META[node.type] ?? { label: node.type, color: "#888" };
                const isSel = selected === node.id;
                const target = connecting && connecting.from !== node.id;
                return (
                  <div key={node.id} data-connect-node={node.id} onPointerDown={() => { if (!connecting) { setSelected(node.id); setInspectorOpen(true); } }}
                    onClick={() => { if (connecting && connecting.from !== node.id) completeConnection(node.id); }}
                    style={{
                      position: "absolute", left: node.position.x, top: node.position.y, width: NODE_W,
                      background: "#131318", border: `1px solid ${isSel ? meta.color : "rgba(255,255,255,0.12)"}`,
                      boxShadow: isSel ? `0 0 0 2px ${meta.color}44` : "none", borderRadius: 10, cursor: "grab", userSelect: "none",
                    }}>
                    <div onPointerDown={(e) => {
                      const rect = canvasRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      dragRef.current = { id: node.id, dx: e.clientX - rect.left + (canvasRef.current?.scrollLeft ?? 0) - node.position.x, dy: e.clientY - rect.top + (canvasRef.current?.scrollTop ?? 0) - node.position.y };
                    }}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid rgba(255,255,255,0.07)", cursor: "grab" }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: meta.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.9)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.label}</span>
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{meta.label}</span>
                    </div>
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

          {/* Inspector — acordeón: ancho 0 cerrado, se abre al clicar un nodo
              (el contenido vive en una columna fija para no refluir durante
              la transición). Clic en el vacío del canvas también lo esconde;
              los cambios del nodo se conservan porque escriben directo en el
              estado del flow, no en el panel. */}
          <div style={{ width: inspectorOpen ? 284 : 0, borderLeft: inspectorOpen ? "1px solid rgba(255,255,255,0.08)" : "none", overflow: "hidden", flexShrink: 0, transition: "width 0.18s ease" }}>
            <div style={{ width: 284, height: "100%", padding: 12, overflowY: "auto" }}>
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

                <Field label="Habilitado">
                  <select style={inputStyle} value={selectedNode.enabled === false ? "no" : "si"} onChange={(e) => patchNode(selectedNode.id, { enabled: e.target.value === "si" })}>
                    <option value="si">sí</option><option value="no">no (se ignora en el run)</option>
                  </select>
                </Field>

                <div style={{ marginTop: 12, fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
                  Placeholders: <code>{"{{input.x}}"}</code>, <code>{"{{steps.ID.y}}"}</code>, <code>{"{{item.x}}"}</code>. Los secretos NUNCA van en la config: crea credenciales y referencia con credentialId.
                </div>
              </div>
            )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
