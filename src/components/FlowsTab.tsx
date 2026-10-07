// REQ-027 — FlowsTab: tab "Flows" del Dashboard (board / biblioteca / historial).
// MCP-first: cada botón llama la MISMA tool flow_* que usa una IA o el webhook
// vía mcpCall — cero rutas privadas. El botón ▶ Ejecutar de cada card es el
// mismo flow_run que consume el webhook y cualquier cliente MCP.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { mcpCall } from "../lib/mcpClient";
import { downloadBlob } from "../lib/download";
import { saveCurrentRoute } from "../lib/routePersistence";
import { readAppRoute } from "../lib/appRoute";
import { FLOW_LIBRARY } from "../data/flowLibrary";
import { FlowEditor } from "./flows/FlowEditor";
import { AI_PROVIDERS, triggerLabel, type FlowCredential, type FlowDef, type FlowRun, type FlowSummary } from "./flows/flowTypes";

type Notice = { kind: "ok" | "err" | "info"; text: string };
type RunResult = { flowId: string; runId: string; status: string; steps?: any[]; error?: { code?: string; message?: string } | null; _note?: string };

const cardStyle: React.CSSProperties = {
  // Vidrio de la casa (mismo trato que las cards del Inicio/CRM), no gris plano.
  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "14px 16px",
  boxShadow: "inset 0 1px 1px rgba(255,255,255,0.08), 0 2px 10px rgba(0,0,0,0.35)",
  display: "flex", flexDirection: "column", gap: 8,
};
const btnBase: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.05)",
  color: "rgba(255,255,255,0.85)", borderRadius: 7, padding: "5px 11px", fontSize: 12, cursor: "pointer",
};
const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 6, color: "#fff", padding: "6px 9px", fontSize: 12, outline: "none",
};

// ── Vocabulario visual de la casa ──
// Cards del board/biblioteca con el MISMO tamaño y comportamiento que las de
// Archivos (dash-card): 152px, cover con motivo, panel de info esmerilado y
// acciones flotando arriba a la derecha (.dash-card-actions da el hover).
const boardCardStyle: React.CSSProperties = {
  position: "relative", height: 152, borderRadius: 14, cursor: "pointer",
  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
  boxShadow: "inset 0 1px 1px rgba(255,255,255,0.08), 0 2px 10px rgba(0,0,0,0.35)",
  display: "flex", flexDirection: "column",
};
const boardCoverStyle: React.CSSProperties = {
  position: "absolute", inset: 0, overflow: "hidden", borderRadius: 14,
  display: "flex", alignItems: "center", justifyContent: "center",
  background: "linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.015) 55%, rgba(0,0,0,0.18))",
};
const boardPanelStyle: React.CSSProperties = {
  position: "relative", zIndex: 2, marginTop: "auto",
  borderRadius: "0 0 10px 10px", padding: "7px 10px",
  background: "rgba(0, 0, 0, 0.4)", border: "1px solid rgba(255, 255, 255, 0.06)",
};
const serifNameStyle: React.CSSProperties = {
  fontFamily: "'Instrument Serif', serif", fontSize: 14, fontWeight: 400, letterSpacing: "-0.01em",
  marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(255,255,255,0.9)",
};
const miniBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 26, height: 26, borderRadius: 7, padding: 0, cursor: "pointer",
  background: "rgba(8,10,16,0.82)", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.85)",
};
/** Hover de elevación — el MISMO contrato que las cards de Archivos. */
const cardHoverIn = (el: HTMLElement) => {
  el.style.borderColor = "rgba(255,255,255,0.2)";
  el.style.boxShadow = "inset 0 1px 1px rgba(255,255,255,0.1), 0 16px 32px rgba(0,0,0,0.5)";
  el.style.transform = "translateY(-4px)";
};
const cardHoverOut = (el: HTMLElement) => {
  el.style.borderColor = "rgba(255,255,255,0.1)";
  el.style.boxShadow = "inset 0 1px 1px rgba(255,255,255,0.08), 0 2px 10px rgba(0,0,0,0.35)";
  el.style.transform = "";
};

/** Glifo de flows (el de la nav): dos nodos y un puente — watermark del cover. */
function FlowGlyph(props: { size?: number; stroke: string; strokeWidth?: number }) {
  return (
    <svg width={props.size ?? 24} height={props.size ?? 24} viewBox="0 0 24 24" fill="none"
      stroke={props.stroke} strokeWidth={props.strokeWidth ?? 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="5" cy="6" r="2.2" /><circle cx="5" cy="18" r="2.2" />
      <rect x="14" y="9" width="7" height="6" rx="1.5" />
      <path d="M7 6c4 0 3 5 7 5" /><path d="M7 18c4 0 3-5 7-5" />
    </svg>
  );
}

// Icon-only tabs de la tarjeta de entrada (mismo tablist que Inicio/CRM).
const FLOW_PANES: Array<{ id: string; label: string; icon: JSX.Element }> = [
  {
    id: "board", label: "Mis flows",
    icon: <FlowGlyph size={15} stroke="currentColor" />,
  },
  {
    id: "library", label: "Biblioteca",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  {
    id: "runs", label: "Historial",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
      </svg>
    ),
  },
];

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    success: ["success", "#4ade80"], failed: ["failed", "#f87171"], running: ["running", "#fbbf24"],
  };
  const [label, color] = map[status] ?? [status, "#94a3b8"];
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, color, border: `1px solid ${color}55`, borderRadius: 999, padding: "2px 9px", letterSpacing: 0.3 }}>
      {label}
    </span>
  );
}

function EnabledBadge({ enabled }: { enabled: boolean }) {
  return (
    <span title={enabled ? "Activo: flow_run corre validación completa" : "Borrador: ejecutable, pero activa cuando pendingConfig esté resuelto"}
      style={{ fontSize: 10.5, color: enabled ? "#4ade80" : "rgba(255,255,255,0.45)", fontWeight: 600 }}>
      {enabled ? "● Activo" : "○ Borrador"}
    </span>
  );
}

/** Paso de un run: fila con dot de estado; clic expande el output. */
function RunStepRow({ step }: { step: any }) {
  const [open, setOpen] = useState(false);
  const output = step?.output;
  const templateId = output && typeof output === "object" ? (output as any).templateId : null;
  return (
    <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "6px 0" }}>
      <div onClick={() => setOpen((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 11.5 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: step?.ok ? "#4ade80" : "#f87171" }} />
        <span style={{ color: "rgba(255,255,255,0.85)", fontWeight: 600 }}>{step?.label ?? step?.nodeId}</span>
        <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 10 }}>{step?.type}</span>
        <span style={{ flex: 1 }} />
        {typeof step?.ms === "number" && <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}>{step.ms}ms</span>}
        {templateId && (
          <button type="button" onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent("flows:open-template", { detail: String(templateId) })); }}
            style={{ ...btnBase, padding: "2px 8px", fontSize: 10.5 }}>Abrir template</button>
        )}
        {step?.error && <span style={{ color: "#f87171", fontSize: 10.5, fontWeight: 600 }}>{step.error.code}</span>}
      </div>
      {step?.error && <div style={{ fontSize: 10.5, color: "rgba(248,113,113,0.8)", marginTop: 3, paddingLeft: 15 }}>{step.error.message}</div>}
      {open && output != null && (
        <pre style={{ margin: "6px 0 0 15px", padding: 8, background: "rgba(255,255,255,0.04)", borderRadius: 6, fontSize: 10, color: "rgba(255,255,255,0.55)", overflowX: "auto", maxHeight: 160 }}>
          {JSON.stringify(output, null, 2).slice(0, 2000)}
        </pre>
      )}
    </div>
  );
}

export function FlowsTab(props: {
  workspaceId: string;
  pane: string;
  onPaneChange: (pane: string) => void;
  onOpenTemplate: (templateId: string) => void;
}) {
  const { workspaceId, pane, onPaneChange, onOpenTemplate } = props;
  const [flows, setFlows] = useState<FlowSummary[] | null>(null);
  const [runs, setRuns] = useState<FlowRun[] | null>(null);
  const [credentials, setCredentials] = useState<FlowCredential[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [editorFlow, setEditorFlow] = useState<FlowDef | null>(null);
  // Deep-link del builder capturado SÍNCRONO al montar: el render entra en
  // modo página desde el primer paint (cargador → builder) y el board nunca
  // llega a montarse — refrescar carga el flow directo, no "primero el
  // módulo de flows". Consumir una vez: al cerrar, la URL pierde el id.
  const [openFlowId, setOpenFlowId] = useState<string | null>(() => {
    try {
      const route = readAppRoute(window.location);
      return route.kind === "workspace" && route.id ? route.id : null;
    } catch { return null; }
  });
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [credModal, setCredModal] = useState(false);
  const [importModal, setImportModal] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // id de la card en operación
  const [tagFilter, setTagFilter] = useState<string | null>(null); // filtro por tag del board (plan D1)

  const say = useCallback((kind: Notice["kind"], text: string) => setNotice({ kind, text }), []);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), notice.kind === "err" ? 9000 : 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const loadFlows = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await mcpCall("flow_list", { workspaceId });
      setFlows(res?.flows ?? []);
    } catch (e: any) { say("err", `flow_list: ${e?.message ?? e}`); }
  }, [workspaceId, say]);

  const loadRuns = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await mcpCall("flow_history", { workspaceId, limit: 30 });
      setRuns(res?.runs ?? []);
    } catch (e: any) { say("err", `flow_history: ${e?.message ?? e}`); }
  }, [workspaceId, say]);

  const loadCreds = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await mcpCall("flow_credentials_list", { workspaceId });
      setCredentials(res?.credentials ?? []);
    } catch (e: any) { say("err", `flow_credentials_list: ${e?.message ?? e}`); }
  }, [workspaceId, say]);

  useEffect(() => { void loadFlows(); }, [loadFlows]);
  useEffect(() => { if (pane === "runs") void loadRuns(); }, [pane, loadRuns]);
  useEffect(() => { void loadCreds(); }, [loadCreds]);

  // El paso "Abrir template" vive dentro de RunStepRow (sin props extra): este
  // listener lo conecta con onOpenTemplate del Dashboard.
  useEffect(() => {
    const open = (e: Event) => onOpenTemplate(String((e as CustomEvent).detail));
    window.addEventListener("flows:open-template", open);
    return () => window.removeEventListener("flows:open-template", open);
  }, [onOpenTemplate]);

  // ── Ejecutar: EL botón humano de un clic. Misma tool que webhook e IAs. ──
  const runFlow = useCallback(async (flowId: string) => {
    if (runningId) return;
    setRunningId(flowId);
    try {
      const res = await mcpCall("flow_run", { flowId, workspaceId });
      setRunResult(res as RunResult);
      void loadFlows();
      void loadRuns();
      return res; // el canvas del editor lo consume (nodo Vista previa)
    } catch (e: any) {
      say("err", `flow_run: ${e?.message ?? e}`);
    } finally {
      setRunningId(null);
    }
  }, [runningId, workspaceId, say, loadFlows, loadRuns]);

  const openEditor = useCallback(async (flowId: string) => {
    try {
      const res = await mcpCall("flow_get", { flowId, workspaceId });
      setEditorFlow(res?.flow as FlowDef);
    } catch (e: any) {
      say("err", `flow_get: ${e?.message ?? e}`);
      setOpenFlowId(null); // el deep-link no resolvió: el board vuelve
    }
  }, [workspaceId, say]);

  // El pane cambia por fuera (nav global, hash back/forward o las pestañas de
  // la tarjeta): el builder (página) debe cerrarse — si no queda montado
  // encima y "nada pasa" aunque board/biblioteca/historial ya cambió debajo.
  // El ref salta la PRIMERA corrida: al montar con deep-link, matar
  // openFlowId aquí rompería la carga antes de que flow_get resuelva.
  const paneRef = useRef(pane);
  useEffect(() => {
    if (paneRef.current === pane) return;
    paneRef.current = pane;
    setEditorFlow(null);
    setOpenFlowId(null);
  }, [pane]);

  // ── Deep-link del builder: #workspace/flows/<pane>/<flowId> abre el builder
  // como PÁGINA directo tras un refresh. El id ya se capturó síncrono arriba
  // (openFlowId); acá solo resuelve el contenido (flow_get, la misma tool del
  // botón Abrir). Al cerrar el builder (o cambiar de tab) la URL pierde el
  // id, así que volver al tab NO reabre nada que el usuario cerró. ──
  useEffect(() => {
    if (openFlowId) void openEditor(openFlowId);
  }, [openFlowId, openEditor]);

  // El builder abierto vive en la URL: refresh (o compartir el link) reabre
  // el builder con ese flow. Un flow NUEVO aún sin id no puede deep-link —
  // la URL queda a nivel de pane; flow_save completa el id vía onSaved y
  // este efecto lo recoge sin tocar nada más.
  useEffect(() => {
    try {
      const hash = editorFlow?.id
        ? `#workspace/flows/${pane}/${editorFlow.id}`
        : `#workspace/flows/${pane}`;
      window.history.replaceState(null, "", hash);
      saveCurrentRoute();
    } catch { /* history no disponible en embeds */ }
  }, [editorFlow, pane]);

  async function installPreset(presetId: string) {
    setBusy(presetId);
    try {
      const res = await mcpCall("flow_library_instantiate", { presetId, workspaceId });
      say("ok", `Preset instalado como borrador: ${res?.flowId}. Configura los nodos pendientes.`);
      void loadFlows();
      if (res?.flowId) await openEditor(String(res.flowId));
    } catch (e: any) { say("err", `flow_library_instantiate: ${e?.message ?? e}`); }
    finally { setBusy(null); }
  }

  async function deleteFlow(flow: FlowSummary) {
    if (!window.confirm(`¿Eliminar el flow "${flow.name}"? Su historial de runs se borra en cascada.`)) return;
    setBusy(flow.id);
    try {
      await mcpCall("flow_delete", { flowId: flow.id, workspaceId });
      say("ok", `Flow eliminado: ${flow.name}.`);
      void loadFlows();
    } catch (e: any) { say("err", `flow_delete: ${e?.message ?? e}`); }
    finally { setBusy(null); }
  }

  async function exportFlow(flow: FlowSummary) {
    setBusy(flow.id);
    try {
      const res = await mcpCall("flow_export", { flowId: flow.id, workspaceId });
      downloadBlob(new Blob([String(res?.json ?? JSON.stringify(res?.export, null, 2))], { type: "application/json" }), `${flow.name.replace(/[^\w-]+/g, "_") || "flow"}.json`);
      say("ok", "Exportado sin credenciales (credentialId removidos por diseño).");
    } catch (e: any) { say("err", `flow_export: ${e?.message ?? e}`); }
    finally { setBusy(null); }
  }

  // Duplicar (paridad n8n): flow_get → flow_save SIN id y desactivado — la
  // copia nace BORRADOR para que no haya webhooks/crones duplicados en caliente.
  async function duplicateFlow(flow: FlowSummary) {
    setBusy(flow.id);
    try {
      const res = await mcpCall("flow_get", { flowId: flow.id, workspaceId });
      const def = res?.flow;
      if (!def) throw new Error("flow_get no devolvió definición");
      const saved = await mcpCall("flow_save", {
        workspaceId,
        name: `${def.name ?? flow.name} (copia)`.slice(0, 80),
        enabled: false,
        trigger: def.trigger ?? { type: "manual" },
        nodes: def.nodes ?? [],
        edges: def.edges ?? [],
        ...(Array.isArray(def.tags) ? { tags: def.tags } : {}),
        ...(def.vars && typeof def.vars === "object" ? { vars: def.vars } : {}),
      });
      say("ok", `Copia creada como borrador: ${saved?.flowId ?? "ok"}. Actívala cuando la revises.`);
      void loadFlows();
    } catch (e: any) { say("err", `Duplicar: ${e?.message ?? e}`); }
    finally { setBusy(null); }
  }

  async function submitImport() {
    try {
      const res = await mcpCall("flow_import", { json: importJson, workspaceId });
      const pending: any[] = res?.pendingConfig ?? [];
      say(pending.length ? "info" : "ok", pending.length
        ? `Importado como borrador (${res?.flowId}). Pendiente: ${pending.map((p) => `${p.label} (${p.missing})`).join("; ")}.`
        : `Importado (${res?.flowId}).`);
      setImportModal(false);
      setImportJson("");
      void loadFlows();
      if (res?.flowId) await openEditor(String(res.flowId));
    } catch (e: any) { say("err", `flow_import: ${e?.message ?? e}`); }
  }

  // ── Board ──
  function renderBoard() {
    if (!flows) {
      // Shell-first: la grilla existe desde el primer frame con la silueta
      // exacta de las cards de Archivos.
      return (
        <div className="dash-template-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 28 }}>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} style={{ height: 152, borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.05)", animation: "shimmer 1.4s linear infinite" }} />
          ))}
        </div>
      );
    }
    if (!flows.length) {
      return (
        <div style={{ ...cardStyle, padding: 18, alignItems: "flex-start", gap: 10 }}>
          <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 18, color: "rgba(255,255,255,0.9)" }}>Todavía no hay flows en este workspace</div>
          <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.5)", lineHeight: 1.6, maxWidth: 560 }}>
            Instala un preset de la Biblioteca, crea uno en blanco con «+ Nuevo», o pídele a tu IA que lo haga vía MCP (flow_library_instantiate / flow_save).
          </div>
          <button type="button" onClick={() => onPaneChange("library")} style={{ ...btnBase, alignSelf: "flex-start" }}>Ver biblioteca</button>
        </div>
      );
    }
    const allTags = Array.from(new Set(flows.flatMap((f) => (Array.isArray(f.tags) ? f.tags : [])))).sort();
    const visible = tagFilter ? flows.filter((f) => Array.isArray(f.tags) && f.tags.includes(tagFilter)) : flows;
    return (
      <>
        {allTags.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
            <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 0.4 }}>Tags</span>
            {allTags.map((t) => (
              <button key={t} type="button" onClick={() => setTagFilter(tagFilter === t ? null : t)}
                style={{ ...btnBase, padding: "2px 9px", fontSize: 10.5, borderColor: tagFilter === t ? "rgba(56,189,248,0.6)" : "rgba(255,255,255,0.14)", background: tagFilter === t ? "rgba(56,189,248,0.14)" : "rgba(255,255,255,0.05)", color: tagFilter === t ? "#7dd3fc" : "rgba(255,255,255,0.7)" }}>
                #{t}
              </button>
            ))}
            {tagFilter !== null && (
              <button type="button" onClick={() => setTagFilter(null)} title="Quitar el filtro" style={{ ...btnBase, padding: "2px 9px", fontSize: 10.5, opacity: 0.75 }}>todas</button>
            )}
          </div>
        )}
      <div className="dash-template-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 28 }}>
        {visible.map((flow) => (
          <div
            key={flow.id}
            className="dash-card"
            style={boardCardStyle}
            onMouseEnter={e => cardHoverIn(e.currentTarget)}
            onMouseLeave={e => cardHoverOut(e.currentTarget)}
            onClick={() => void openEditor(flow.id)}
            title={`Abrir "${flow.name}" en el editor · act: ${flow.updatedAt ? String(flow.updatedAt).slice(0, 16).replace("T", " ") : "—"}`}
          >
            <div style={boardCoverStyle}>
              <FlowGlyph size={64} stroke="rgba(255,255,255,0.14)" strokeWidth={1.2} />
            </div>
            {/* Acciones flotantes — mismo patrón que las cards de Archivos */}
            <div className="dash-card-actions" style={{ position: "absolute", top: 8, right: 8, zIndex: 4, display: "flex", gap: 6 }}>
              <button type="button" disabled={!!runningId}
                onClick={(e) => { e.stopPropagation(); void runFlow(flow.id); }}
                title="Ejecutar ahora (flow_run — la MISMA tool que usan tu IA y el webhook)"
                aria-label={`Ejecutar ${flow.name}`}
                style={{ ...miniBtn, color: "#4ade80", borderColor: "rgba(74,222,128,0.45)", opacity: runningId ? 0.5 : 1 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>
              </button>
              <button type="button" onClick={(e) => { e.stopPropagation(); void openEditor(flow.id); }}
                title="Editar en el canvas" aria-label={`Editar ${flow.name}`} style={miniBtn}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
              </button>
              <button type="button" disabled={busy === flow.id}
                onClick={(e) => { e.stopPropagation(); void duplicateFlow(flow); }}
                title="Duplicar como borrador (flow_get + flow_save sin id)" aria-label={`Duplicar ${flow.name}`}
                style={{ ...miniBtn, opacity: busy === flow.id ? 0.5 : 1 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
              </button>
              <button type="button" disabled={busy === flow.id}
                onClick={(e) => { e.stopPropagation(); void exportFlow(flow); }}
                title="Exportar JSON (flow_export, sin credenciales)" aria-label={`Exportar ${flow.name}`}
                style={{ ...miniBtn, opacity: busy === flow.id ? 0.5 : 1 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
              </button>
              <button type="button" disabled={busy === flow.id}
                onClick={(e) => { e.stopPropagation(); void deleteFlow(flow); }}
                title="Eliminar (flow_delete)" aria-label={`Eliminar ${flow.name}`}
                style={{ ...miniBtn, color: "#f87171", borderColor: "rgba(248,113,113,0.35)", opacity: busy === flow.id ? 0.5 : 1 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
              </button>
            </div>
            <div style={boardPanelStyle}>
              <div style={serifNameStyle}>{flow.name}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, color: "rgba(255,255,255,0.45)", overflow: "hidden", whiteSpace: "nowrap" }}>
                <EnabledBadge enabled={flow.enabled} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{triggerLabel(flow.trigger)} · {flow.nodes} nodos</span>
                {flow.createdBy?.startsWith("ai:") && <span style={{ color: "#fb7185", flexShrink: 0 }}>IA</span>}
                {flow.locked === true && (
                  <span title="Flow bloqueado (D4): solo un admin puede editarlo o borrarlo — los runs siguen funcionando." style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#fcd34d", flexShrink: 0 }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                    Bloqueado
                  </span>
                )}
              </div>
              {Array.isArray(flow.tags) && flow.tags.length > 0 && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3 }}>
                  {flow.tags.slice(0, 3).map((t) => (
                    <span key={t} style={{ fontSize: 9, color: "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 999, padding: "1px 7px" }}>#{t}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      </>
    );
  }

  // ── Biblioteca ──
  function renderLibrary() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="dash-template-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 28 }}>
          {FLOW_LIBRARY.map((preset) => (
            <div
              key={preset.id}
              className="dash-card"
              style={{ ...boardCardStyle, cursor: "default" }}
              onMouseEnter={e => cardHoverIn(e.currentTarget)}
              onMouseLeave={e => cardHoverOut(e.currentTarget)}
              title={preset.description}
            >
              <div style={boardCoverStyle}>
                <FlowGlyph size={64} stroke="rgba(255,255,255,0.14)" strokeWidth={1.2} />
              </div>
              <div className="dash-card-actions" style={{ position: "absolute", top: 8, right: 8, zIndex: 4 }}>
                <button type="button" disabled={busy === preset.id}
                  onClick={() => void installPreset(preset.id)}
                  title="Instala el preset como borrador en este workspace (flow_library_instantiate)"
                  style={{ background: "rgba(8,10,16,0.88)", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 6, padding: "3px 10px", color: "#fff", fontSize: 11.5, fontWeight: 600, cursor: "pointer", opacity: busy === preset.id ? 0.5 : 1 }}>
                  {busy === preset.id ? "Instalando…" : "Instalar"}
                </button>
              </div>
              <div style={boardPanelStyle}>
                <div style={serifNameStyle}>{preset.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, color: "rgba(255,255,255,0.45)", overflow: "hidden", whiteSpace: "nowrap" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{triggerLabel(preset.trigger as any)} · {preset.nodes.length} nodos</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: "rgba(251,191,36,0.75)", lineHeight: 1.5 }}>
          Al instalar: el archivo/frame exacto de cada nodo template y las credenciales de los nodos IA quedan a tu cargo (o de tu IA).
        </div>
      </div>
    );
  }

  // ── Historial ──
  function renderRuns() {
    if (!runs) return <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 12.5 }}>Cargando historial…</div>;
    if (!runs.length) return <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 12.5 }}>Sin runs todavía. Ejecuta un flow desde Mis flows, desde el editor o vía MCP/webhook.</div>;
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" onClick={() => void loadRuns()} style={btnBase}>Refrescar</button>
        </div>
        {runs.map((run) => (
          <div key={run.runId} style={{ ...cardStyle, gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <StatusBadge status={run.status} />
              <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>{run.flowId}</span>
              <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)" }}>{run.runId}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)" }}>
                {String(run.startedAt).slice(0, 19).replace("T", " ")}{run.finishedAt ? ` → ${String(run.finishedAt).slice(11, 19)}` : ""}
              </span>
            </div>
            {run.error && <div style={{ fontSize: 11, color: "rgba(248,113,113,0.85)" }}>{run.error}</div>}
            {run.steps && run.steps.length > 0 && (
              <div style={{ marginTop: 2 }}>
                {run.steps.map((step: any, i: number) => <RunStepRow key={`${run.runId}:${step?.nodeId ?? i}:${i}`} step={step} />)}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  // ── Modal de resultado del run ──
  function renderRunModal() {
    if (!runResult) return null;
    const ok = runResult.status === "success";
    // Portal a body + capa dialogs (1000): el z-95 inline quedaba atrapado en
    // el stacking context z-1 del tab (`.dash-atmosphere > *`) y el nav
    // global (z 10) pintaba encima. Mismo trato que el editor (ver allá).
    return createPortal(
      <div onClick={() => setRunResult(null)} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(4,4,6,0.86)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: "min(620px, 94vw)", maxHeight: "84vh", overflowY: "auto", background: "#0e0e12", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 18, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <StatusBadge status={runResult.status} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.92)", flex: 1 }}>Run {runResult.runId}</span>
            <button type="button" onClick={() => setRunResult(null)} style={{ ...btnBase, padding: "4px 9px" }}>✕</button>
          </div>
          {runResult.error && <div style={{ fontSize: 12, color: "#f87171", lineHeight: 1.5 }}>{runResult.error.message ?? String(runResult.error)}</div>}
          {runResult._note && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>{runResult._note}</div>}
          {(runResult.steps ?? []).map((step: any, i: number) => <RunStepRow key={`${step?.nodeId ?? i}:${i}`} step={step} />)}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" onClick={() => { setRunResult(null); onPaneChange("runs"); }} style={btnBase}>Ver historial</button>
            {!ok && (
              <button type="button" onClick={() => { const f = runResult.flowId; setRunResult(null); void openEditor(f); }}
                style={{ ...btnBase, borderColor: "rgba(251,191,36,0.5)", color: "#fcd34d" }}>
                Corregir en el editor
              </button>
            )}
          </div>
        </div>
      </div>,
      document.body
    );
  }

  // ── Modal de credenciales ──
  function renderCredModal() {
    if (!credModal) return null;
    return <CredentialsModal workspaceId={workspaceId} credentials={credentials} onClose={() => setCredModal(false)} onSaved={() => void loadCreds()} say={say} />;
  }

  // ── Modal de importar ──
  function renderImportModal() {
    if (!importModal) return null;
    return createPortal(
      <div onClick={() => setImportModal(false)} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(4,4,6,0.86)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 94vw)", background: "#0e0e12", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 18, display: "grid", gap: 10 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "rgba(255,255,255,0.92)" }}>Importar flow (JSON de flow_export)</div>
          <textarea value={importJson} onChange={(e) => setImportJson(e.target.value)} rows={12} placeholder='{ "name": "...", "nodes": [...], "edges": [...] }'
            style={{ ...inputStyle, fontFamily: "monospace", fontSize: 11, resize: "vertical" }} />
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>
            Entra como borrador (nunca se auto-activa). Reasigna credentialId tras importar: los exports los removieron por diseño.
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" onClick={() => setImportModal(false)} style={btnBase}>Cancelar</button>
            <button type="button" disabled={!importJson.trim()} onClick={() => void submitImport()}
              style={{ ...btnBase, background: "rgba(96,165,250,0.2)", borderColor: "rgba(96,165,250,0.5)", color: "#93c5fd", opacity: importJson.trim() ? 1 : 0.5 }}>
              Importar
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  if (!workspaceId) {
    return <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 13 }}>Abre un workspace para ver sus flows.</div>;
  }

  // Toast a body con z 99999 (tope de la casa): dentro del tab quedaría
  // bajo "Tu plan" (z 8000) y bajo los modales ya portalados. Se computa una
  // vez y se monta en ambos retornos (board y builder-página).
  const toastPortal = notice ? createPortal(
    <div style={{
      position: "fixed", bottom: 22, right: 22, zIndex: 99999, maxWidth: 440,
      background: notice.kind === "err" ? "rgba(127,29,29,0.92)" : notice.kind === "ok" ? "rgba(20,83,45,0.92)" : "rgba(30,41,59,0.94)",
      border: `1px solid ${notice.kind === "err" ? "rgba(248,113,113,0.5)" : notice.kind === "ok" ? "rgba(74,222,128,0.5)" : "rgba(255,255,255,0.2)"}`,
      color: "#fff", borderRadius: 10, padding: "10px 14px", fontSize: 12, lineHeight: 1.5, boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
    }}>
      {notice.text}
    </div>,
    document.body
  ) : null;

  // ── Modo página: el builder (o su cargador mientras flow_get resuelve el
  // deep-link) ocupa el tab completo, DEBAJO de la navbar global. Refrescar
  // entra directo acá: el board ni se monta. ──
  if (editorFlow || openFlowId) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {editorFlow ? (
          <div style={{ flex: 1, minHeight: 0 }}>
            <FlowEditor
              workspaceId={workspaceId}
              flow={editorFlow}
              credentials={credentials}
              onClose={() => { setEditorFlow(null); setOpenFlowId(null); }}
              onSaved={(flowId) => { void loadFlows(); if (flowId) setEditorFlow((prev) => (prev ? { ...prev, id: flowId } : prev)); }}
              onNotice={say}
              onRunFlow={(flowId) => runFlow(flowId)}
              running={runningId === editorFlow.id}
            />
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "rgba(255,255,255,0.45)" }}>
            Abriendo flow…
          </div>
        )}
        {toastPortal}
      </div>
    );
  }

  return (
    <div className="crm-contacts" style={{ height: "100%", overflowY: "auto", alignContent: "start", paddingBottom: 20 }}>
      {/* Tarjeta de ENTRADA — el patrón de la casa (CRM/Inicio): título serif +
          nav de pestañas de solo íconos en la tarjeta glass; los controles de
          contenido (credenciales, importar, nuevo) viven en la toolbar. */}
      <div className="crm-table-card crm-contacts-top" style={{ flexShrink: 0 }}>
        <header className="crm-contacts-head">
          <div className="crm-contacts-head-title" style={{ minWidth: 0 }}>
            <h1>Flows</h1>
            <p>Cadena fuentes, IA y tus plantillas en flujos que corren solos — créalos aquí, impórtalos o pídeselos a tu IA vía MCP.</p>
          </div>
          <div className="crm-nav-tabs" role="tablist" aria-label="Secciones de flows">
            {FLOW_PANES.map(p => (
              <button key={p.id} type="button" role="tab" aria-selected={pane === p.id}
                title={p.label} className={pane === p.id ? "crm-nav-tab active" : "crm-nav-tab"}
                onClick={() => onPaneChange(p.id)}>
                {p.icon}
              </button>
            ))}
          </div>
        </header>
        <div className="crm-contacts-toolbar">
          <button type="button" className="workspace-button secondary" onClick={() => setCredModal(true)}
            title="Credenciales de flows (bearer / api_key / basic / IA) — secretos cifrados AES-256-GCM">
            Credenciales ({credentials.length})
          </button>
          <button type="button" className="workspace-button secondary" onClick={() => setImportModal(true)}>
            Importar JSON
          </button>
          <button type="button" className="workspace-button crm-toolbar-push" title="Crear un flow en blanco"
            onClick={() => setEditorFlow({ name: "", enabled: false, trigger: { type: "manual" }, nodes: [], edges: [] })}>
            + Nuevo
          </button>
        </div>
      </div>

      {pane === "board" && renderBoard()}
      {pane === "library" && renderLibrary()}
      {pane === "runs" && renderRuns()}

      {toastPortal}

      {renderRunModal()}
      {renderCredModal()}
      {renderImportModal()}
    </div>
  );
}

// ── Credenciales de flows ────────────────────────────────────────────────────
// Los secretos jamás se muestran: se mandan una vez por flow_credentials_set
// (cifrado AES-256-GCM server-side) y la lista solo devuelve metadata + last4.

function CredentialsModal(props: {
  workspaceId: string;
  credentials: FlowCredential[];
  onClose: () => void;
  onSaved: () => void;
  say: (kind: Notice["kind"], text: string) => void;
}) {
  const { workspaceId, credentials, onClose, onSaved, say } = props;
  const [type, setType] = useState<FlowCredential["type"]>("ai_provider");
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<string>(AI_PROVIDERS[0]);
  const [model, setModel] = useState("");
  const [headerName, setHeaderName] = useState("X-API-Key");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const params: Record<string, any> = { name, type, secret, provider, model, headerName, username };
      await mcpCall("flow_credentials_set", params);
      say("ok", `Credencial guardada: ${name}. Referénciala por credentialId en los nodos.`);
      setName(""); setModel(""); setSecret(""); setUsername("");
      onSaved();
    } catch (e: any) { say("err", `flow_credentials_set: ${e?.message ?? e}`); }
    finally { setSaving(false); }
  }

  async function remove(cred: FlowCredential) {
    if (!window.confirm(`¿Eliminar la credencial "${cred.name}"? Los nodos que la referencian fallarán con CREDENTIAL_NOT_FOUND.`)) return;
    try {
      await mcpCall("flow_credentials_delete", { credentialId: cred.id, workspaceId });
      say("ok", `Credencial eliminada: ${cred.name}.`);
      onSaved();
    } catch (e: any) { say("err", `flow_credentials_delete: ${e?.message ?? e}`); }
  }

  // Portal a body + capa dialogs (1000) — mismo motivo que el editor (ver allá).
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(4,4,6,0.86)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(640px, 94vw)", maxHeight: "86vh", overflowY: "auto", background: "#0e0e12", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 18, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "rgba(255,255,255,0.92)", flex: 1 }}>Credenciales de flows</span>
          <button type="button" onClick={onClose} style={{ ...btnBase, padding: "4px 9px" }}>✕</button>
        </div>

        {/* Lista */}
        <div style={{ display: "grid", gap: 6 }}>
          {!credentials.length && <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.4)" }}>Sin credenciales aún. Crea una para tus nodos IA o HTTP.</div>}
          {credentials.map((cred) => (
            <div key={cred.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "7px 11px", fontSize: 11.5 }}>
              <span style={{ fontWeight: 700, color: "rgba(255,255,255,0.88)" }}>{cred.name}</span>
              <span style={{ color: "rgba(255,255,255,0.4)" }}>{cred.type}{cred.provider ? ` · ${cred.provider}` : ""}{cred.model ? ` · ${cred.model}` : ""}{cred.header_name ? ` · ${cred.header_name}` : ""}{cred.username ? ` · ${cred.username}` : ""}</span>
              {cred.last4 && <span style={{ color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>···{cred.last4}</span>}
              <span style={{ flex: 1 }} />
              <button type="button" onClick={() => void remove(cred)} style={{ ...btnBase, color: "#f87171", borderColor: "rgba(248,113,113,0.35)", padding: "2px 8px", fontSize: 11 }}>Eliminar</button>
            </div>
          ))}
        </div>

        {/* Form */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 12, display: "grid", gap: 8 }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 0.5 }}>Nueva credencial</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (ej: openrouter-main)" style={inputStyle} />
            <select value={type} onChange={(e) => setType(e.target.value as FlowCredential["type"])} style={inputStyle}>
              <option value="ai_provider">ai_provider (nodos IA)</option>
              <option value="bearer">bearer (Authorization)</option>
              <option value="api_key">api_key (header custom)</option>
              <option value="basic">basic (usuario + contraseña)</option>
            </select>
          </div>
          {type === "ai_provider" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <select value={provider} onChange={(e) => setProvider(e.target.value)} style={inputStyle}>
                {AI_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Modelo por defecto (ej: deepseek/deepseek-chat)" style={inputStyle} />
            </div>
          )}
          {type === "api_key" && <input value={headerName} onChange={(e) => setHeaderName(e.target.value)} placeholder="Header (X-API-Key)" style={inputStyle} />}
          {type === "basic" && <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Usuario" style={inputStyle} />}
          <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Secreto (mínimo 8 caracteres — se cifra y jamás vuelve a salir)" style={inputStyle} />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button" disabled={saving || !name.trim() || secret.length < 8} onClick={() => void save()}
              style={{ ...btnBase, background: "rgba(96,165,250,0.2)", borderColor: "rgba(96,165,250,0.5)", color: "#93c5fd", opacity: saving || !name.trim() || secret.length < 8 ? 0.5 : 1 }}>
              {saving ? "Guardando…" : "Guardar credencial"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
