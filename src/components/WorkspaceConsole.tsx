import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { getApiHeaders } from "../lib/apiKey";
import { downloadBlob } from "../lib/download";
import { useAuth } from "../lib/auth";
import { AiConnectPrompts } from "./AiConnectPrompts";
import { CrmWorkspace } from "./CrmWorkspace";

type Section = "general" | "agents";
type ConsoleMode = "crm" | "settings";
// v36: solo dos pestañas. Cuenta, Equipo e invitaciones viven como tarjetas
// dentro del General del Dashboard; aquí queda lo de agentes (claves de
// acceso, MCP BYOK, prompts y SKILL.md).
const SETTINGS_SECTIONS = [
  ["general", "General"],
  ["agents", "Agentes & MCP"],
] as const satisfies ReadonlyArray<readonly [Section, string]>;
type ApiKey = { id: string; label: string; key_prefix: string; role: string; last_used_at?: string; created_at: string };
type Connection = { id: string; name: string; kind: string; provider: string; endpointUrl: string; enabled: boolean; hasCredentials: boolean };

async function workspaceFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(getApiHeaders());
  new Headers(options?.headers).forEach((value, key) => headers.set(key, value));
  const response = await fetch(url, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="workspace-field"><span>{label}</span>{children}</label>;
}

function ConfirmDialog({ title, body, confirmLabel, onConfirm, onClose }: { title: string; body: string; confirmLabel: string; onConfirm: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="workspace-dialog" onClose={onClose}>
      <h3>{title}</h3><p>{body}</p>
      <div className="workspace-dialog-actions">
        <button type="button" className="workspace-button secondary" onClick={() => ref.current?.close()}>Cancelar</button>
        <button type="button" className="workspace-button danger" onClick={() => { onConfirm(); ref.current?.close(); }}>{confirmLabel}</button>
      </div>
    </dialog>
  );
}

type WorkspaceConsoleProps = {
  workspaceId: string | null;
  workspaceName?: string;
  mode: ConsoleMode;
  onOpenTemplate?: (templateId: string) => void;
  children?: ReactNode;
};

export function WorkspaceConsole({
  workspaceId,
  workspaceName,
  mode,
  onOpenTemplate,
  children,
}: WorkspaceConsoleProps): JSX.Element {
  const { user, signOut } = useAuth();
  const [section, setSection] = useState<Section>("general");
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ title: string; body: string; label: string; run: () => void } | null>(null);
  const statusId = useId();

  const load = useCallback(async () => {
    if (!workspaceId || mode === "crm" || section === "general") return;
    setLoading(true); setError("");
    try {
      const [keyResult, connectionResult] = await Promise.all([
        workspaceFetch<{ data: ApiKey[] }>(`/api/workspaces/${workspaceId}/api-keys`),
        workspaceFetch<{ data: Connection[] }>(`/api/workspaces/${workspaceId}/connections`),
      ]);
      setKeys(keyResult.data || []); setConnections(connectionResult.data || []);
    } catch (cause: any) { setError(cause.message); }
    setLoading(false);
  }, [mode, workspaceId, section]);

  useEffect(() => { void load(); }, [load]);

  if (!workspaceId) {
    return <div className="workspace-console-empty"><h2>Selecciona un workspace</h2><p>El CRM y la configuración siempre pertenecen a un workspace concreto.</p></div>;
  }

  return (
    <section className="workspace-console" aria-label={mode === "crm" ? "CRM" : undefined} aria-labelledby={mode === "settings" ? "workspace-console-title" : undefined} aria-busy={loading}>
      {mode === "settings" && <header className="workspace-console-header">
        <div><p className="workspace-eyebrow">Configuración del workspace</p><h2 id="workspace-console-title">{workspaceName || "Workspace"}</h2></div>
        <div className="workspace-account"><span>{user?.email}</span><button type="button" onClick={() => void signOut()}>Cerrar sesión</button></div>
      </header>}
      {mode === "settings" && <nav className="workspace-subnav" aria-label="Configuración del workspace">
        {SETTINGS_SECTIONS.map(([id, label]) => (
          <button key={id} type="button" aria-current={section === id ? "page" : undefined} className={section === id ? "active" : ""} onClick={() => { setSection(id); setError(""); setNotice(""); }}>{label}</button>
        ))}
      </nav>}
      {(error || notice) && <p id={statusId} className={error ? "workspace-status error" : "workspace-status success"} role={error ? "alert" : "status"}>{error || notice}</p>}
      {mode === "crm" && (
        <CrmWorkspace
          workspaceId={workspaceId}
          onOpenTemplate={onOpenTemplate}
          setError={(message) => { setNotice(""); setError(message); }}
          setNotice={(message) => { setError(""); setNotice(message); }}
        />
      )}
      {mode === "settings" && section === "general" && <>{children}</>}
      {mode === "settings" && section === "agents" && <AgentsSection workspaceId={workspaceId} keys={keys} connections={connections} reload={load} setError={setError} setNotice={setNotice} setConfirmAction={setConfirmAction} />}
      {confirmAction && <ConfirmDialog title={confirmAction.title} body={confirmAction.body} confirmLabel={confirmAction.label} onConfirm={confirmAction.run} onClose={() => setConfirmAction(null)} />}
    </section>
  );
}

function AgentsSection({ workspaceId, keys, connections, reload, setError, setNotice, setConfirmAction }: any) {
  const [keyLabel, setKeyLabel] = useState(""); const [keyRole, setKeyRole] = useState("editor"); const [rawKey, setRawKey] = useState("");
  const [name, setName] = useState(""); const [provider, setProvider] = useState(""); const [endpointUrl, setEndpointUrl] = useState(""); const [credentialJson, setCredentialJson] = useState('{"headers":{"Authorization":"Bearer …"}}');
  const createKey = async (event: FormEvent) => { event.preventDefault(); try { const result = await workspaceFetch<any>(`/api/workspaces/${workspaceId}/api-keys`, { method: "POST", body: JSON.stringify({ label: keyLabel, role: keyRole }) }); setRawKey(result.data.key); setKeyLabel(""); await reload(); } catch (cause: any) { setError(cause.message); } };
  const addConnection = async (event: FormEvent) => { event.preventDefault(); try { const credentials = credentialJson.trim() ? JSON.parse(credentialJson) : undefined; await workspaceFetch(`/api/workspaces/${workspaceId}/connections`, { method: "POST", body: JSON.stringify({ name, provider, endpointUrl, kind: "mcp", enabled: true, credentials }) }); setName(""); setProvider(""); setEndpointUrl(""); setNotice("MCP conectado al workspace."); await reload(); } catch (cause: any) { setError(cause.message); } };
  const revoke = (key: ApiKey) => setConfirmAction({ title: "Revocar clave", body: `La clave ${key.label} dejará de funcionar inmediatamente.`, label: "Revocar", run: async () => { try { await workspaceFetch(`/api/workspaces/${workspaceId}/api-keys/${key.id}`, { method: "DELETE" }); await reload(); } catch (cause: any) { setError(cause.message); } } });
  const toggle = async (connection: Connection) => { try { await workspaceFetch(`/api/workspaces/${workspaceId}/connections/${connection.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !connection.enabled }) }); await reload(); } catch (cause: any) { setError(cause.message); } };
  const downloadSkill = async () => {
    try {
      const res = await fetch("/SKILL.md");
      const text = await res.text();
      downloadBlob(new Blob([text], { type: "text/markdown" }), "SKILL.md");
    } catch (cause: any) { setError(cause?.message || "Could not download SKILL.md"); }
  };
  return <div className="workspace-grid"><article className="workspace-panel"><h3>Nueva clave para agentes</h3><form className="workspace-form" onSubmit={createKey}><Field label="Nombre"><input value={keyLabel} onChange={e => setKeyLabel(e.target.value)} placeholder="Claude del equipo" required /></Field><Field label="Permiso"><select value={keyRole} onChange={e => setKeyRole(e.target.value)}><option value="editor">Puede diseñar</option><option value="viewer">Solo lectura</option></select></Field><button className="workspace-button">Crear clave</button></form>{rawKey && <div className="workspace-secret" role="status"><strong>Cópiala ahora; no volverá a mostrarse.</strong><code>{rawKey}</code><button type="button" className="workspace-link" onClick={() => void navigator.clipboard.writeText(rawKey)}>Copiar</button></div>}</article><article className="workspace-panel"><h3>Conectar MCP BYOK</h3><form className="workspace-form" onSubmit={addConnection}><Field label="Nombre"><input value={name} onChange={e => setName(e.target.value)} required /></Field><Field label="Proveedor"><input value={provider} onChange={e => setProvider(e.target.value)} placeholder="Notion, Slack, MCP propio…" required /></Field><Field label="Endpoint HTTPS"><input type="url" value={endpointUrl} onChange={e => setEndpointUrl(e.target.value)} required /></Field><Field label="Credenciales JSON"><textarea value={credentialJson} onChange={e => setCredentialJson(e.target.value)} rows={3} spellCheck={false} /></Field><button className="workspace-button">Conectar y cifrar</button></form></article><article className="workspace-panel span"><h3>Conecta tu IA — prompts listos</h3><p className="workspace-muted">Pega tu clave (o crea una arriba: se rellena sola) y copia la guía de tu IA. La guía unificada de ChatGPT Desktop y Codex incluye dos rutas completas: configuración manual, casilla por casilla, o instalación automática en config.toml. La conexión solo queda confirmada cuando el healthcheck MCP pasa después del reinicio.</p><AiConnectPrompts initialKey={rawKey} /></article><article className="workspace-panel span"><h3>Accesos de agentes</h3><div className="workspace-list">{keys.map((key: ApiKey) => <div className="workspace-row" key={key.id}><div><strong>{key.label}</strong><span>{key.key_prefix} · {key.role}</span></div><button type="button" className="workspace-link danger" onClick={() => revoke(key)}>Revocar</button></div>)}</div></article><article className="workspace-panel span"><h3>MCPs disponibles para el equipo</h3><div className="workspace-list">{connections.map((connection: Connection) => <div className="workspace-row" key={connection.id}><div><strong>{connection.name}</strong><span>{connection.provider} · {connection.endpointUrl} · secretos {connection.hasCredentials ? "cifrados" : "no configurados"}</span></div><button type="button" className="workspace-link" aria-pressed={connection.enabled} onClick={() => void toggle(connection)}>{connection.enabled ? "Desactivar" : "Activar"}</button></div>)}</div></article><article className="workspace-panel span"><h3>📄 SKILL.md — onboarding para agentes</h3><p className="workspace-muted">Dáselo a cualquier agente de IA: le enseña las herramientas de Futuraria, la estructura del proyecto y las convenciones de diseño, para que diseñe junto a ti.</p><button type="button" className="workspace-button" onClick={() => void downloadSkill()}>Descargar SKILL.md</button></article></div>;
}
