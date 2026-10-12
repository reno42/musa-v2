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
import { FLOW_LIBRARY, type FlowPreset } from "../data/flowLibrary";
import { FlowEditor } from "./flows/FlowEditor";
import { FlowMiniDiagram, flowPresetMeta } from "./flows/FlowMiniDiagram";
import { AI_PROVIDERS, triggerLabel, type FlowCredential, type FlowDef, type FlowInputField, type FlowRun, type FlowSummary } from "./flows/flowTypes";

type Notice = { kind: "ok" | "err" | "info"; text: string };
type RunResult = { flowId: string; runId: string; status: string; steps?: any[]; error?: { code?: string; message?: string } | null; _note?: string; payloadRejected?: boolean; missingKeys?: string[]; wait?: { nodeId: string; kind: string; message?: string; title?: string; resumeToken: string; expiresAt?: string | null } };

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
    waiting: ["waiting", "#c4b5fd"], // REQ-040: run en pausa esperando el wake (violeta ≠ running ámbar)
  };
  const [label, color] = map[status] ?? [status, "#94a3b8"];
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, color, border: `1px solid ${color}55`, borderRadius: 999, padding: "2px 9px", letterSpacing: 0.3 }}>
      {label}
    </span>
  );
}

// REQ-040 — chips del filtro de status del historial. "waiting" es EL caso de
// uso (runs en pausa esperando el POST del wake): chip destacado en ámbar.
const RUN_STATUS_CHIPS: Array<{ id: string | null; label: string }> = [
  { id: null, label: "Todas" },
  { id: "waiting", label: "waiting" },
  { id: "running", label: "running" },
  { id: "success", label: "success" },
  { id: "failed", label: "failed" },
];

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
  // REQ-048: último error de flow_list — la card de error distingue "falló" de
  // "workspace vacío" (un arranque frío ya no parece pérdida de datos).
  const [flowsError, setFlowsError] = useState<string | null>(null);
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
  // Flows-brand — mini-form de inputs declarados: si el flow los pide, el ▶
  // abre este modal y ejecuta flow_run con input (misma tool, mismo contrato
  // que webhook e IA: defaults y required los aplica el server).
  const [inputModal, setInputModal] = useState<{ flowId: string; name: string; inputs: FlowInputField[] } | null>(null);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  // Content machine: opciones de los selects del brief — dinámicas del
  // workspace (marcas y plantillas), un fetch por apertura del modal.
  const [inputOptions, setInputOptions] = useState<Partial<Record<"brands" | "templates", { value: string; label: string }[]>>>({});
  useEffect(() => {
    if (!inputModal) return;
    const need = new Set(inputModal.inputs.filter((f) => f.type === "select" && f.optionsFrom).map((f) => f.optionsFrom as "brands" | "templates"));
    if (!need.size) return;
    let alive = true;
    void (async () => {
      const next: Partial<Record<"brands" | "templates", { value: string; label: string }[]>> = {};
      await Promise.all([...need].map(async (src) => {
        try {
          if (src === "brands") {
            const res = await mcpCall("get_brands", { workspaceId }) as any;
            const rows = res?.brands ?? res?.data ?? (Array.isArray(res) ? res : []);
            next.brands = rows.map((r: any) => ({ value: String(r?.id ?? r?.brandId ?? ""), label: String(r?.name ?? r?.title ?? "sin nombre") })).filter((o: any) => o.value);
          } else {
            const res = await mcpCall("list_templates", { workspaceId }) as any;
            const rows = res?.templates ?? res?.data ?? (Array.isArray(res) ? res : []);
            next.templates = rows.map((r: any) => ({ value: String(r?.id ?? ""), label: String(r?.name ?? r?.title ?? "sin nombre") })).filter((o: any) => o.value);
          }
        } catch { /* sin opciones: el select queda vacío y el run puede seguir */ }
      }));
      if (alive) setInputOptions(next);
    })();
    return () => { alive = false; };
  }, [inputModal, workspaceId]);
  // Biblioteca — popup de detalle del preset: diagrama con zoom/pan, descrip-
  // ción, qué usa y los datos demo (defaults de los inputs) visibles antes de
  // instalar. El objetivo: entender el flow SIN abrir nada.
  const [detailPreset, setDetailPreset] = useState<FlowPreset | null>(null);
  const [detailZoom, setDetailZoom] = useState(1);
  const [detailPan, setDetailPan] = useState({ x: 0, y: 0 });
  const detailDragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const openPresetDetail = useCallback((preset: FlowPreset) => {
    setDetailZoom(1);
    setDetailPan({ x: 0, y: 0 });
    setDetailPreset(preset);
  }, []);
  const [busy, setBusy] = useState<string | null>(null); // id de la card en operación
  const [tagFilter, setTagFilter] = useState<string | null>(null); // filtro por tag del board (plan D1)
  // REQ-040 — filtro de status del historial + config del despertar por agente.
  const [runStatusFilter, setRunStatusFilter] = useState<string | null>(null);
  const [wakeConfig, setWakeConfig] = useState<{ enabled: boolean; url: string | null; secretHint: string | null; createdAt: string | null } | null>(null);
  const [wakeUrl, setWakeUrl] = useState("");
  const [wakeEnabled, setWakeEnabled] = useState(true);
  const [wakeBusy, setWakeBusy] = useState<string | null>(null); // "save" | "test"
  const [wakeSecretOnce, setWakeSecretOnce] = useState<string | null>(null); // show-once: se pinta UNA vez

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
      setFlowsError(null);
    } catch (e: any) {
      setFlowsError(`flow_list: ${e?.message ?? e}`);
      say("err", `flow_list: ${e?.message ?? e}`);
    }
  }, [workspaceId, say]);

  const loadRuns = useCallback(async () => {
    if (!workspaceId) return;
    try {
      // REQ-040: filtro opcional por status (waiting = runs en pausa del wake).
      const res = await mcpCall("flow_history", { workspaceId, limit: 30, ...(runStatusFilter ? { status: runStatusFilter } : {}) });
      setRuns(res?.runs ?? []);
    } catch (e: any) { say("err", `flow_history: ${e?.message ?? e}`); }
  }, [workspaceId, say, runStatusFilter]);

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

  // REQ-040 — despertar por agente: la config se lee, guarda y prueba SOLO vía
  // MCP (flow_wake_get/set/test), cero lógica de red en la UI. El secret lo
  // genera el server: la UI lo pinta UNA vez y después solo el hint (•••+last4).
  const loadWakeConfig = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await mcpCall("flow_wake_get", { workspaceId });
      setWakeConfig({ enabled: !!res?.enabled, url: res?.url ?? null, secretHint: res?.secretHint ?? null, createdAt: res?.createdAt ?? null });
      setWakeUrl(res?.url ?? "");
      setWakeEnabled(res?.enabled !== false);
    } catch (e: any) { say("err", `flow_wake_get: ${e?.message ?? e}`); }
  }, [workspaceId, say]);

  const saveWakeConfig = useCallback(async () => {
    setWakeBusy("save");
    try {
      const res = await mcpCall("flow_wake_set", { workspaceId, url: wakeUrl.trim() || null, enabled: wakeEnabled });
      if (res?.secret) setWakeSecretOnce(String(res.secret)); // show-once
      else if (res?.cleared) { setWakeSecretOnce(null); say("ok", "Despertar desactivado: se borró la configuración."); }
      else say("ok", "Despertar guardado: los runs waiting le avisarán a tu URL con un POST firmado.");
      await loadWakeConfig();
    } catch (e: any) { say("err", `flow_wake_set: ${e?.message ?? e}`); }
    finally { setWakeBusy(null); }
  }, [workspaceId, wakeUrl, wakeEnabled, loadWakeConfig, say]);

  const testWake = useCallback(async () => {
    setWakeBusy("test");
    try {
      const res = await mcpCall("flow_wake_test", { workspaceId });
      if (res?.ok) say("ok", `Despertar OK: el endpoint respondió ${res.status} al POST firmado.`);
      else say("err", `flow_wake_test: sin 2xx tras los reintentos (status ${res?.status ?? "?"}). El run en espera NO se ve afectado.`);
    } catch (e: any) { say("err", `flow_wake_test: ${e?.message ?? e}`); }
    finally { setWakeBusy(null); }
  }, [workspaceId, say]);

  useEffect(() => { if (pane === "runs") void loadWakeConfig(); }, [pane, loadWakeConfig]);

  // El paso "Abrir template" vive dentro de RunStepRow (sin props extra): este
  // listener lo conecta con onOpenTemplate del Dashboard.
  useEffect(() => {
    const open = (e: Event) => onOpenTemplate(String((e as CustomEvent).detail));
    window.addEventListener("flows:open-template", open);
    return () => window.removeEventListener("flows:open-template", open);
  }, [onOpenTemplate]);

  // ── Ejecutar: EL botón humano de un clic. Misma tool que webhook e IAs. ──
  const runFlow = useCallback(async (flowId: string, input?: Record<string, string>) => {
    if (runningId) return;
    setRunningId(flowId);
    try {
      const res = await mcpCall("flow_run", { flowId, workspaceId, ...(input && Object.keys(input).length ? { input } : {}) });
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

  // ▶ del board (Flows-brand): si el flow declara inputs, abre el mini-form;
  // si no, corre directo. flow_list no trae la definición: 1 flow_get barato
  // solo cuando hace falta saberlo.
  const runFlowAsk = useCallback(async (flowId: string, name: string) => {
    if (runningId) return;
    try {
      const detail = await mcpCall("flow_get", { flowId, workspaceId }) as any;
      const inputs: FlowInputField[] = Array.isArray(detail?.flow?.inputs) ? detail.flow.inputs : [];
      if (inputs.length) {
        setInputValues(Object.fromEntries(inputs.map((field) => [field.key, field.default ?? ""])));
        setInputModal({ flowId, name, inputs });
        return;
      }
    } catch { /* sin detalle → corre directo igual */ }
    await runFlow(flowId);
  }, [runningId, workspaceId, runFlow]);

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
      const pending: any[] = Array.isArray(res?.pendingConfig) ? res.pendingConfig : [];
      say(pending.length ? "info" : "ok", pending.length
        ? `Preset instalado: ${res?.flowId}. Pendiente: ${pending.map((p) => `${p.label} (${p.missing})`).join("; ")}.`
        : `Preset instalado: ${res?.flowId}. Dale ▶ Ejecutar — la prueba corre con los datos demo.`);
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
    // REQ-048: fallo real ≠ workspace vacío — antes un flow_list caído dejaba
    // skeleton o caía en «Todavía no hay flows», que parecía pérdida de datos.
    if (flowsError && !flows.length) {
      return (
        <div style={{ ...cardStyle, padding: 18, alignItems: "flex-start", gap: 10 }}>
          <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 18, color: "rgba(255,255,255,0.9)" }}>No se pudieron cargar los flows</div>
          <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.5)", lineHeight: 1.6, maxWidth: 560, overflowWrap: "anywhere" }}>{flowsError}</div>
          <button type="button" onClick={() => { setFlows(null); setFlowsError(null); void loadFlows(); }} style={{ ...btnBase, alignSelf: "flex-start" }}>Reintentar</button>
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
                onClick={(e) => { e.stopPropagation(); void runFlowAsk(flow.id, flow.name); }}
                title="Ejecutar ahora (flow_run — la MISMA tool que usan tu IA y el webhook; si el flow pide inputs, abre el formulario)"
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
          {FLOW_LIBRARY.map((preset) => {
            const meta = flowPresetMeta(preset);
            return (
              <div
                key={preset.id}
                className="dash-card"
                style={boardCardStyle}
                onMouseEnter={e => cardHoverIn(e.currentTarget)}
                onMouseLeave={e => cardHoverOut(e.currentTarget)}
                onClick={() => openPresetDetail(preset)}
                title={`${preset.name} — clic para ver el detalle: ${preset.description}`}
              >
                <div style={{ ...boardCoverStyle, padding: "18px 10px 34px" }}>
                  <FlowMiniDiagram preset={preset} height={76} />
                </div>
                <div className="dash-card-actions" style={{ position: "absolute", top: 8, right: 8, zIndex: 4 }}>
                  <button type="button" disabled={busy === preset.id}
                    onClick={(e) => { e.stopPropagation(); void installPreset(preset.id); }}
                    title="Instala el preset listo para correr con sus datos demo (flow_library_instantiate)"
                    style={{ background: "rgba(8,10,16,0.88)", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 6, padding: "3px 10px", color: "#fff", fontSize: 11.5, fontWeight: 600, cursor: "pointer", opacity: busy === preset.id ? 0.5 : 1 }}>
                    {busy === preset.id ? "Instalando…" : "Instalar"}
                  </button>
                </div>
                <div style={boardPanelStyle}>
                  <div style={serifNameStyle}>{preset.name}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, color: "rgba(255,255,255,0.45)", overflow: "hidden", whiteSpace: "nowrap" }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{triggerLabel(preset.trigger as any)} · {preset.nodes.length} nodos</span>
                    {meta.usesAI
                      ? <span style={{ color: "#c4b5fd", flexShrink: 0 }}>Usa IA</span>
                      : <span style={{ color: "#4ade80", flexShrink: 0 }}>Instantáneo</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>
          Todos los presets traen datos demo: instala, dale ▶ Ejecutar y ves la prueba al toque. Los nodos IA usan tu credencial (si ya tienes una, se engancha sola); las recetas demo las reemplazas por tus frames cuando quieras.
        </div>
      </div>
    );
  }

  // ── REQ-040: configuración del despertar por agente ──
  // El REQ la ubicaba en "Configuración del workspace" (superficie que no
  // existe): vive acá, en Historial, justo donde se ven los runs waiting.
  function renderWakeCard() {
    const wc = wakeConfig;
    const configured = !!(wc?.url && wc?.secretHint);
    return (
      <div style={{ ...cardStyle, gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>Despertar por agente</span>
          <span title={configured ? (wc?.enabled ? "Los runs waiting avisan a tu URL" : "Configurado pero pausado") : "Sin configurar: los runs waiting esperan flow_resume, sin notificación"}
            style={{ fontSize: 10.5, fontWeight: 600, color: configured && wc?.enabled ? "#4ade80" : configured ? "#fbbf24" : "rgba(255,255,255,0.4)" }}>
            {configured ? (wc?.enabled ? "● Activo" : "○ Pausado") : "○ Sin configurar"}
          </span>
          <span style={{ flex: 1 }} />
          {configured && <span title="El secreto nunca vuelve a salir: solo estos últimos 4" style={{ fontSize: 10.5, color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>secreto {wc?.secretHint}</span>}
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>
          Cuando un run queda <span style={{ color: "rgba(196,181,253,0.9)" }}>waiting</span>, Musa manda a esta URL un POST firmado (X-Musa-Signature = hex(hmac_sha256(secreto, body))). Tu agente decide y responde con flow_resume + resumeToken. Sin URL no hay llamada: cero cambio de comportamiento.{" "}
          ¿Tu IA aún no está conectada? En <a href="/#connect" style={{ color: "#a5b4fc", fontWeight: 600 }}>Conecta tu IA</a> emitís el token con scopes y copiás el snippet de tu cliente.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input value={wakeUrl} onChange={(e) => setWakeUrl(e.target.value)} placeholder="https://tu-agente.ejemplo/musa/wake (HTTPS público)"
            style={{ ...inputStyle, flex: 1, minWidth: 220 }} />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "rgba(255,255,255,0.7)", cursor: "pointer" }}>
            <input type="checkbox" checked={wakeEnabled} onChange={(e) => setWakeEnabled(e.target.checked)} />
            Activo
          </label>
          <button type="button" disabled={wakeBusy !== null || (!wakeUrl.trim() && !wc?.url)} onClick={() => void saveWakeConfig()}
            title={wakeUrl.trim() ? "Guarda la URL (el secreto lo genera el server la primera vez)" : "URL vacía + guardar = borra la config del despertar"}
            style={{ ...btnBase, background: "rgba(96,165,250,0.2)", borderColor: "rgba(96,165,250,0.5)", color: "#93c5fd", opacity: wakeBusy !== null || (!wakeUrl.trim() && !wc?.url) ? 0.5 : 1 }}>
            {wakeBusy === "save" ? "Guardando…" : wakeUrl.trim() ? "Guardar" : "Quitar"}
          </button>
          <button type="button" disabled={wakeBusy !== null} onClick={() => void testWake()} style={btnBase}
            title="Envía un POST firmado de prueba a la URL guardada (no toca ningún run)">
            {wakeBusy === "test" ? "Probando…" : "Probar"}
          </button>
        </div>
        {wakeSecretOnce && (
          <div style={{ border: "1px solid rgba(251,191,36,0.45)", background: "rgba(251,191,36,0.08)", borderRadius: 8, padding: "9px 11px", display: "grid", gap: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#fcd34d" }}>Secreto generado — cópialo AHORA: no vuelve a mostrarse.</div>
            <code style={{ fontSize: 11, fontFamily: "monospace", color: "rgba(255,255,255,0.85)", wordBreak: "break-all" }}>{wakeSecretOnce}</code>
            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
              Verifícalo en tu receptor: X-Musa-Signature = hex(hmac_sha256(secreto, body)). Para rotarlo, manda otro secreto (mínimo 16 caracteres) por flow_wake_set.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setWakeSecretOnce(null)} style={{ ...btnBase, padding: "3px 9px", fontSize: 11 }}>Ya lo copié</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Historial ──
  function renderRuns() {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        {renderWakeCard()}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {RUN_STATUS_CHIPS.map((chip) => {
            const active = runStatusFilter === chip.id;
            const isWaiting = chip.id === "waiting"; // chip destacado del REQ §5
            return (
              <button key={chip.label} type="button" onClick={() => setRunStatusFilter(chip.id)}
                style={{
                  fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, cursor: "pointer", borderRadius: 999, padding: "3px 11px",
                  border: `1px solid ${active ? (isWaiting ? "rgba(251,191,36,0.75)" : "rgba(255,255,255,0.5)") : isWaiting ? "rgba(251,191,36,0.35)" : "rgba(255,255,255,0.12)"}`,
                  background: active ? (isWaiting ? "rgba(251,191,36,0.18)" : "rgba(255,255,255,0.12)") : "transparent",
                  color: active ? (isWaiting ? "#fcd34d" : "rgba(255,255,255,0.92)") : isWaiting ? "rgba(252,211,77,0.8)" : "rgba(255,255,255,0.45)",
                }}>
                {chip.label}
              </button>
            );
          })}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={() => void loadRuns()} style={btnBase}>Refrescar</button>
        </div>
        {!runs ? <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 12.5 }}>Cargando historial…</div>
          : !runs.length ? (
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 12.5 }}>
              {runStatusFilter
                ? `Sin runs con status "${runStatusFilter}". Cambia el filtro o ejecuta un flow.`
                : "Sin runs todavía. Ejecuta un flow desde Mis flows, desde el editor o vía MCP/webhook."}
            </div>
          ) : runs.map((run) => (
          <div key={run.runId} style={{ ...cardStyle, gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <StatusBadge status={run.status} />
              {run.waitingKind && (
                <span title={run.title ?? "Run en pausa"} style={{ fontSize: 10, color: "#c4b5fd", border: "1px solid rgba(196,181,253,0.45)", borderRadius: 999, padding: "1px 8px" }}>
                  {run.waitingKind === "ai" ? `IA${run.title ? `: ${run.title}` : ""}` : run.waitingKind === "approval" ? "aprobación" : "webhook"}
                </span>
              )}
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
          {runResult.status === "waiting" && runResult.wait && (
            <div style={{ border: "1px solid rgba(165,180,252,0.4)", background: "rgba(165,180,252,0.08)", borderRadius: 10, padding: "10px 12px", display: "grid", gap: 7 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "#a5b4fc" }}>
                ⏸ {runResult.wait.kind === "ai" ? "Tarea para tu IA" : runResult.wait.kind === "approval" ? "Esperando tu aprobación" : "Esperando webhook"}{runResult.wait.title ? ` — ${runResult.wait.title}` : ""}
              </div>
              {runResult.wait.message && <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.8)", whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{runResult.wait.message}</div>}
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <code style={{ fontSize: 10.5, color: "rgba(255,255,255,0.6)", background: "rgba(255,255,255,0.06)", padding: "3px 7px", borderRadius: 6 }}>{runResult.wait.resumeToken}</code>
                <button type="button" onClick={() => { void navigator.clipboard?.writeText(runResult.wait?.resumeToken ?? ""); }} style={{ ...btnBase, padding: "3px 8px", fontSize: 10.5 }}>Copiar token</button>
                {runResult.wait.expiresAt && <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.45)" }}>expira {new Date(runResult.wait.expiresAt).toLocaleString()}</span>}
              </div>
              {runResult.wait.kind === "ai" && (
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.52)", lineHeight: 1.5 }}>
                  {"Pídeselo a tu IA conectada: «revisa flow_ai_tasks en Musa y entrega el trabajo con flow_ai_complete»."}
                </div>
              )}
            </div>
          )}
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

  // ── Modal de inputs declarados (Flows-brand): el mini-form del ▶ ──
  function renderInputsModal() {
    if (!inputModal) return null;
    return createPortal(
      <div onClick={() => setInputModal(null)} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(4,4,6,0.86)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 94vw)", maxHeight: "84vh", overflowY: "auto", background: "#0e0e12", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 18, display: "grid", gap: 10 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "rgba(255,255,255,0.92)" }}>Ejecutar «{inputModal.name}»</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>
            {"Este flow pide datos de entrada ({{input.x}}): los vacíos toman su default; un requerido sin valor falla con INPUT_REQUIRED."}
          </div>
          {inputModal.inputs.map((field) => (
            <label key={field.key} style={{ display: "grid", gap: 4, fontSize: 11.5, color: "rgba(255,255,255,0.75)" }}>
              <span>{field.label}{field.required ? " *" : ""}</span>
              {field.type === "textarea" ? (
                <textarea value={inputValues[field.key] ?? ""} rows={3}
                  onChange={(e) => setInputValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  style={{ ...inputStyle, resize: "vertical" }} />
              ) : field.type === "select" ? (
                <select value={inputValues[field.key] ?? ""}
                  onChange={(e) => setInputValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  style={{ ...inputStyle, color: "#f5f5f7", background: "#18181e" }}>
                  {!field.required && <option value="">—</option>}
                  {(field.options ?? (field.optionsFrom ? inputOptions[field.optionsFrom] : undefined) ?? []).map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                  {!(field.options?.length) && !(field.optionsFrom && inputOptions[field.optionsFrom]?.length) && (
                    <option value="">{field.required ? "Cargando opciones…" : "—"}</option>
                  )}
                </select>
              ) : (
                <input type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                  value={inputValues[field.key] ?? ""}
                  onChange={(e) => setInputValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  style={inputStyle} />
              )}
            </label>
          ))}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" onClick={() => setInputModal(null)} style={btnBase}>Cancelar</button>
            <button type="button" disabled={!!runningId}
              onClick={() => { const modal = inputModal; setInputModal(null); void runFlow(modal.flowId, inputValues); }}
              style={{ ...btnBase, color: "#4ade80", borderColor: "rgba(74,222,128,0.45)", opacity: runningId ? 0.5 : 1 }}>
              Ejecutar
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // ── Popup de detalle de preset (Biblioteca): diagrama con zoom/pan, qué
  // hace, qué usa y los datos demo — entender el flow SIN abrirlo. ──
  function renderPresetDetailModal() {
    if (!detailPreset) return null;
    const preset = detailPreset;
    const meta = flowPresetMeta(preset);
    const zoomStep = (d: number) => setDetailZoom((z) => Math.min(4, Math.max(1, Math.round((z + d) * 10) / 10)));
    const chip = (color: string): React.CSSProperties => ({ fontSize: 10.5, fontWeight: 600, color, border: `1px solid ${color}55`, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" });
    return createPortal(
      <div onClick={() => setDetailPreset(null)} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(4,4,6,0.86)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: "min(760px, 94vw)", maxHeight: "88vh", overflowY: "auto", background: "#0e0e12", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 18, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontFamily: "'Instrument Serif', serif", fontSize: 19, color: "rgba(255,255,255,0.92)", flex: 1 }}>{preset.name}</span>
            <button type="button" onClick={() => setDetailPreset(null)} style={{ ...btnBase, padding: "4px 9px" }}>✕</button>
          </div>
          <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.75)", lineHeight: 1.6 }}>{preset.description}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={chip("#4ade80")}>{triggerLabel(preset.trigger as any)}</span>
            <span style={chip("#94a3b8")}>{preset.nodes.length} nodos</span>
            {meta.usesAI
              ? <span style={chip("#c4b5fd")}>Usa IA</span>
              : <span style={chip("#4ade80")}>Corre al instante</span>}
            {meta.webSearch && <span style={chip("#38bdf8")}>Busca en la web</span>}
            {meta.tools.map((t) => <span key={t} style={chip("#4ade80")}>Usa tool: {t}</span>)}
          </div>
          {/* Lienzo del diagrama: zoom con los botones, pan arrastrando. */}
          <div
            onMouseDown={(e) => { detailDragRef.current = { sx: e.clientX, sy: e.clientY, ox: detailPan.x, oy: detailPan.y }; e.currentTarget.style.cursor = "grabbing"; }}
            onMouseMove={(e) => {
              const d = detailDragRef.current;
              if (d) setDetailPan({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) });
            }}
            onMouseUp={(e) => { detailDragRef.current = null; e.currentTarget.style.cursor = "grab"; }}
            onMouseLeave={(e) => { detailDragRef.current = null; e.currentTarget.style.cursor = "grab"; }}
            style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, background: "radial-gradient(120% 100% at 50% 0%, rgba(255,255,255,0.05), rgba(0,0,0,0.25))", overflow: "hidden", height: 300, cursor: "grab", position: "relative", userSelect: "none" }}
          >
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", transform: `translate(${detailPan.x}px, ${detailPan.y}px) scale(${detailZoom})`, transformOrigin: "center", transition: detailDragRef.current ? "none" : "transform 0.15s ease-out" }}>
              <FlowMiniDiagram preset={preset} showLabels height={210} />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", flex: 1 }}>Arrastra el diagrama para moverlo · zoom para verlo de cerca</span>
            <button type="button" onClick={() => zoomStep(-0.5)} disabled={detailZoom <= 1} style={{ ...btnBase, padding: "3px 10px", opacity: detailZoom <= 1 ? 0.4 : 1 }}>−</button>
            <span style={{ fontSize: 11, fontFamily: "monospace", color: "rgba(255,255,255,0.7)", minWidth: 42, textAlign: "center" }}>{Math.round(detailZoom * 100)}%</span>
            <button type="button" onClick={() => zoomStep(0.5)} disabled={detailZoom >= 4} style={{ ...btnBase, padding: "3px 10px", opacity: detailZoom >= 4 ? 0.4 : 1 }}>+</button>
            <button type="button" onClick={() => { setDetailZoom(1); setDetailPan({ x: 0, y: 0 }); }} style={{ ...btnBase, padding: "3px 9px", fontSize: 11 }}>Reset</button>
          </div>
          {/* Datos demo: los defaults de los inputs — instalar y correr sin teclear. */}
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 0.5 }}>Datos demo con los que corre la prueba</div>
            {Array.isArray(preset.inputs) && preset.inputs.length ? preset.inputs.map((field) => (
              <div key={field.key} style={{ display: "flex", gap: 12, fontSize: 11.5, background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "6px 10px", alignItems: "baseline" }}>
                <span style={{ color: "rgba(255,255,255,0.7)", minWidth: 150, flexShrink: 0 }}>{field.label}{field.required ? " *" : ""}</span>
                <span style={{ fontFamily: "monospace", color: "#7dd3fc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(field.default ?? "")}</span>
              </div>
            )) : (
              <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.5)" }}>Este flow no pide datos: al instalarlo corre directo con ▶ Ejecutar.</div>
            )}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.5, flex: 1, minWidth: 220 }}>
              Instálalo y dale ▶ Ejecutar: la prueba corre con estos datos.{meta.usesAI ? " Si aún no tienes credencial de IA, te la pide una vez en Credenciales." : ""}
            </span>
            <button type="button" disabled={busy === preset.id}
              onClick={() => { const id = preset.id; setDetailPreset(null); void installPreset(id); }}
              style={{ ...btnBase, background: "rgba(96,165,250,0.2)", borderColor: "rgba(96,165,250,0.5)", color: "#93c5fd", opacity: busy === preset.id ? 0.5 : 1 }}>
              {busy === preset.id ? "Instalando…" : "Instalar este flow"}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
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
      {renderInputsModal()}
      {renderPresetDetailModal()}
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
