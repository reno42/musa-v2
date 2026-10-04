// REQ-027 — FlowsTab: tab "Flows" del Dashboard (board / biblioteca / historial).
// MCP-first: cada botón llama la MISMA tool flow_* que usa una IA o el webhook
// vía mcpCall — cero rutas privadas. El botón ▶ Ejecutar de cada card es el
// mismo flow_run que consume el webhook y cualquier cliente MCP.

import { useCallback, useEffect, useState } from "react";
import { mcpCall } from "../lib/mcpClient";
import { downloadBlob } from "../lib/download";
import { FLOW_LIBRARY } from "../data/flowLibrary";
import { FlowEditor } from "./flows/FlowEditor";
import { AI_PROVIDERS, triggerLabel, type FlowCredential, type FlowDef, type FlowRun, type FlowSummary } from "./flows/flowTypes";

type Notice = { kind: "ok" | "err" | "info"; text: string };
type RunResult = { flowId: string; runId: string; status: string; steps?: any[]; error?: { code?: string; message?: string } | null; _note?: string };

const cardStyle: React.CSSProperties = {
  background: "#131318", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "14px 16px",
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
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [credModal, setCredModal] = useState(false);
  const [importModal, setImportModal] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // id de la card en operación

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
    } catch (e: any) { say("err", `flow_get: ${e?.message ?? e}`); }
  }, [workspaceId, say]);

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
    if (!flows) return <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 12.5 }}>Cargando flows…</div>;
    if (!flows.length) {
      return (
        <div style={{ ...cardStyle, alignItems: "flex-start" }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>Todavía no hay flows en este workspace</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
            Instala un preset de la <button type="button" onClick={() => onPaneChange("library")} style={{ ...btnBase, padding: "2px 8px", fontSize: 11 }}>Biblioteca</button>,
            crea uno en blanco con ＋ Nuevo, o pídele a tu IA que lo haga vía MCP (<code>flow_library_instantiate</code> / <code>flow_save</code>).
          </div>
        </div>
      );
    }
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
        {flows.map((flow) => (
          <div key={flow.id} style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: "rgba(255,255,255,0.92)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{flow.name}</span>
              <EnabledBadge enabled={flow.enabled} />
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 11, color: "rgba(255,255,255,0.45)", flexWrap: "wrap" }}>
              <span>trigger: {triggerLabel(flow.trigger)}</span>
              <span>{flow.nodes} nodos</span>
              {flow.updatedAt && <span>act: {String(flow.updatedAt).slice(0, 16).replace("T", " ")}</span>}
              {flow.createdBy?.startsWith("ai:") && <span style={{ color: "#a78bfa" }}>creado por IA</span>}
            </div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 2 }}>
              <button type="button" disabled={runningId === flow.id || !!runningId}
                onClick={() => void runFlow(flow.id)}
                title="Ejecuta ahora con flow_run — la MISMA tool que usan tu IA y el webhook"
                style={{ ...btnBase, borderColor: "rgba(74,222,128,0.5)", color: "#4ade80", opacity: runningId ? 0.5 : 1 }}>
                {runningId === flow.id ? "Ejecutando…" : "▶ Ejecutar"}
              </button>
              <button type="button" onClick={() => void openEditor(flow.id)} style={btnBase}>Editar</button>
              <button type="button" disabled={busy === flow.id} onClick={() => void exportFlow(flow)} style={btnBase}>Exportar</button>
              <button type="button" disabled={busy === flow.id} onClick={() => void deleteFlow(flow)}
                style={{ ...btnBase, color: "#f87171", borderColor: "rgba(248,113,113,0.35)" }} title="flow_delete">🗑</button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── Biblioteca ──
  function renderLibrary() {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
        {FLOW_LIBRARY.map((preset) => (
          <div key={preset.id} style={cardStyle}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "rgba(255,255,255,0.92)" }}>{preset.name}</div>
            <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.5)", lineHeight: 1.55, flex: 1 }}>{preset.description}</div>
            <div style={{ display: "flex", gap: 12, fontSize: 11, color: "rgba(255,255,255,0.45)", flexWrap: "wrap" }}>
              <span>trigger: {triggerLabel(preset.trigger as any)}</span>
              <span>{preset.nodes.length} nodos · {preset.edges.length} conexiones</span>
            </div>
            <div style={{ fontSize: 10.5, color: "#fbbf24", lineHeight: 1.5 }}>
              Queda a tu cargo (o de tu IA): archivo+frame exacto de cada nodo template y credenciales de los nodos IA.
            </div>
            <button type="button" disabled={busy === preset.id} onClick={() => void installPreset(preset.id)}
              style={{ ...btnBase, alignSelf: "flex-start", background: "rgba(129,140,248,0.2)", borderColor: "rgba(129,140,248,0.5)", color: "#c7d2fe" }}>
              {busy === preset.id ? "Instalando…" : "Instalar en este workspace"}
            </button>
          </div>
        ))}
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
    return (
      <div onClick={() => setRunResult(null)} style={{ position: "fixed", inset: 0, zIndex: 95, background: "rgba(4,4,6,0.72)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
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
      </div>
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
    return (
      <div onClick={() => setImportModal(false)} style={{ position: "fixed", inset: 0, zIndex: 95, background: "rgba(4,4,6,0.72)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
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
              style={{ ...btnBase, background: "rgba(129,140,248,0.2)", borderColor: "rgba(129,140,248,0.5)", color: "#c7d2fe", opacity: importJson.trim() ? 1 : 0.5 }}>
              Importar
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!workspaceId) {
    return <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 13 }}>Abre un workspace para ver sus flows.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, height: "100%" }}>
      {/* Header: pane switcher + acciones */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 9, padding: 3 }}>
          {[["board", "Mis flows"], ["library", "Biblioteca"], ["runs", "Historial"]].map(([id, label]) => (
            <button key={id} type="button" onClick={() => onPaneChange(id)}
              style={{ ...btnBase, border: "none", background: pane === id ? "rgba(129,140,248,0.25)" : "transparent", color: pane === id ? "#c7d2fe" : "rgba(255,255,255,0.55)", fontWeight: pane === id ? 700 : 400 }}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => setCredModal(true)} title="Credenciales de flows (bearer / api_key / basic / IA) — secretos cifrados AES-256-GCM" style={btnBase}>
          Credenciales ({credentials.length})
        </button>
        <button type="button" onClick={() => setImportModal(true)} style={btnBase}>Importar JSON</button>
        <button type="button" onClick={() => setEditorFlow({ name: "", enabled: false, trigger: { type: "manual" }, nodes: [], edges: [] })}
          style={{ ...btnBase, background: "rgba(129,140,248,0.2)", borderColor: "rgba(129,140,248,0.5)", color: "#c7d2fe" }}>
          ＋ Nuevo
        </button>
      </div>

      {pane === "board" && renderBoard()}
      {pane === "library" && renderLibrary()}
      {pane === "runs" && renderRuns()}

      {/* Toast */}
      {notice && (
        <div style={{
          position: "fixed", bottom: 22, right: 22, zIndex: 99, maxWidth: 440,
          background: notice.kind === "err" ? "rgba(127,29,29,0.92)" : notice.kind === "ok" ? "rgba(20,83,45,0.92)" : "rgba(30,41,59,0.94)",
          border: `1px solid ${notice.kind === "err" ? "rgba(248,113,113,0.5)" : notice.kind === "ok" ? "rgba(74,222,128,0.5)" : "rgba(255,255,255,0.2)"}`,
          color: "#fff", borderRadius: 10, padding: "10px 14px", fontSize: 12, lineHeight: 1.5, boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
        }}>
          {notice.text}
        </div>
      )}

      {renderRunModal()}
      {renderCredModal()}
      {renderImportModal()}

      {editorFlow && (
        <FlowEditor
          workspaceId={workspaceId}
          flow={editorFlow}
          credentials={credentials}
          onClose={() => setEditorFlow(null)}
          onSaved={(flowId) => { void loadFlows(); if (flowId) setEditorFlow((prev) => (prev ? { ...prev, id: flowId } : prev)); }}
          onNotice={say}
          onRunFlow={(flowId) => void runFlow(flowId)}
          running={runningId === editorFlow.id}
        />
      )}
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

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 95, background: "rgba(4,4,6,0.72)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
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
              style={{ ...btnBase, background: "rgba(129,140,248,0.2)", borderColor: "rgba(129,140,248,0.5)", color: "#c7d2fe", opacity: saving || !name.trim() || secret.length < 8 ? 0.5 : 1 }}>
              {saving ? "Guardando…" : "Guardar credencial"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
