import { useCallback, useEffect, useId, useRef, useState, type ComponentType, type FormEvent, type ReactNode } from "react";
import { getApiHeaders } from "../lib/apiKey";
import { downloadBlob } from "../lib/download";
import { AiConnectPrompts } from "./AiConnectPrompts";
import { CrmWorkspace } from "./CrmWorkspace";
import { ReportsSection } from "./ReportsSection";
import { ApiWebhooksSection } from "./ApiWebhooksSection";

type Section = "account" | "integrations" | "humans" | "ais" | "reports" | "apis" | "docs";
type ConsoleMode = "crm" | "settings";
// v53: cuatro secciones con la jerarquía compartida del CRM — tarjeta superior
// glass con título serif y nav de ÍCONOS a la altura del título (hover muestra
// la palabra, mismo patrón que la nav del CRM). Reparto: Mi cuenta (perfil,
// preferencias y uso — slot del Dashboard), Mis integraciones (claves de IA del
// Dashboard + MCPs BYOK), Invita colegas (equipo e invitaciones del Dashboard)
// e Invita IAs (claves para agentes, prompts listos y SKILL.md).
// v54: cada sección se presenta por su nombre — título y descriptor
// propios en la tarjeta (la tarjeta ya no dice siempre «Configuración»).
// v55: sin CTA en la tarjeta — la tarjeta solo presenta (título, descriptor
// y nav de íconos); la acción vive dentro de cada sección.
// v56: «Documentación» — el catálogo completo de herramientas (tool en código,
// MCP, UI, módulo, nombre humano) al lado de «Invita IAs», de donde salen las
// claves MCP.
// v57: «Documentación» es LOCAL-ONLY (regla explícita: la tabla de tools es el
// blueprint del producto y NUNCA sube al repo). Los dos archivos viven
// gitignoreados en disco; la pestaña solo existe en dev (import.meta.env.DEV)
// y el módulo se carga con spec computado + @vite-ignore para que ni rollup
// ni check-imports rastreen la importación.
// v58: «Reportes» — bugs de humanos y agentes en una sola cola con ESTADO
// (nuevo → en_progreso → corregido/descartado). MCP-first: el tool report_bug
// escribe la misma tabla; los reportes de IA traen pasos + hints de código.
const SETTINGS_SECTIONS: Array<{ id: Section; label: string; title: string; description: string; icon: ReactNode }> = [
  {
    id: "account",
    label: "Mi cuenta",
    title: "Mi cuenta",
    description: "Tu perfil, tus preferencias y el uso de tu espacio: todo te sigue a ti, no al workspace.",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5" /><path d="M5 19.5c1-3.5 3.6-5.2 7-5.2s6 1.7 7 5.2" /></svg>
    ),
  },
  {
    id: "integrations",
    label: "Mis integraciones",
    title: "Mis integraciones",
    description: "Una sola caja fuerte: claves de IA y MCPs cifrados que comparten el editor, el chat y los agentes de este workspace.",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 3v5M15 3v5" /><path d="M7 8h10v3a5 5 0 0 1-10 0V8z" /><path d="M12 16v5" /></svg>
    ),
  },
  {
    id: "humans",
    label: "Invita colegas",
    title: "Invita colegas",
    description: "Tu workspace gana con tu equipo: invita a quienes diseñan contigo y decide quién edita y quién solo mira.",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="10" cy="8.5" r="3.5" /><path d="M4 19.5c.8-3.2 3-4.8 6-4.8s5.2 1.6 6 4.8" /><path d="M18 6v6M15 9h6" /></svg>
    ),
  },
  {
    id: "ais",
    label: "Invita IAs",
    title: "Invita IAs",
    description: "Los agentes diseñan contigo: crea una clave, pega la guía en tu IA y dale acceso a este workspace.",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="9" width="14" height="10" rx="2" /><path d="M12 9V5M9.5 5h5" /><circle cx="9.5" cy="14" r="1" /><circle cx="14.5" cy="14" r="1" /></svg>
    ),
  },
  {
    id: "reports",
    label: "Reportes",
    title: "Reportes",
    description: "Bugs reportados por tu equipo y por las IAs, con su estado: Nuevo, En progreso, Corregido o Descartado. Los de IA traen pasos exactos para replicar.",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="8" y="7" width="8" height="11" rx="4" /><path d="M9 7a3 3 0 0 1 6 0" /><path d="M3 13h5M16 13h5M5 6l3 3M19 6l-3 3M5 20l3-3M19 20l-3-3" /></svg>
    ),
  },
  {
    // APIs/Webhooks (v60): la plataforma entera expuesta — claves REST,
    // REST documentada (OpenAPI) y webhooks salientes firmados para N8N,
    // Zapier y Make. v55: llaveros separados — las claves MCP se crean en
    // Invita IAs; las REST aquí.
    id: "apis",
    label: "APIs/Webhooks",
    title: "APIs/Webhooks",
    description: "Conecta Musa con lo que quieras: crea claves API, registra webhooks firmados y lee cómo funciona cada endpoint para N8N, Zapier o Make.",
    icon: (
      // Rayito (v60.1): el tacho de basura no decía «conexión» — el rayo
      // sí, y sin pisarle el enchufe a «Mis integraciones».
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg>
    ),
  },
  // LOCAL-ONLY: pestaña Documentación — dev solamente (ver v57 arriba).
  ...(import.meta.env.DEV ? [{
    id: "docs" as Section,
    label: "Documentación",
    title: "Documentación",
    description: "Las 100% de las herramientas del producto: qué hace cada una, si la usa la IA (MCP), si la usas tú (UI) y en qué módulo vive.",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
    ),
  }] : []),
];

/** Loader local-only de la Documentación. El spec se computa en runtime:
 *  un literal haría que check-imports exigiera commitear el archivo y que
 *  rollup lo incluyera en el bundle de producción — exactamente lo que la
 *  regla prohíbe. En un build de prod esta rama nunca se monta. */
function DocsSectionLazy() {
  const [Comp, setComp] = useState<ComponentType | null>(null);
  useEffect(() => {
    let alive = true;
    const spec = "./" + "ToolsDocsSection";
    import(/* @vite-ignore */ spec)
      .then(m => { if (alive) setComp(() => (m as { ToolsDocsSection: ComponentType }).ToolsDocsSection); })
      .catch(() => { /* archivo presente solo en local; en prod no llega aquí */ });
    return () => { alive = false; };
  }, []);
  return Comp ? <Comp /> : null;
}
type ApiKey = { id: string; label: string; key_prefix: string; role: string; kind?: string; last_used_at?: string; created_at: string };
type Connection = { id: string; name: string; kind: string; provider: string; endpointUrl: string; enabled: boolean; hasCredentials: boolean };

async function workspaceFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(getApiHeaders());
  new Headers(options?.headers).forEach((value, key) => headers.set(key, value));
  const response = await fetch(url, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

/** Onboarding para agentes — lo usa el panel de «Invita IAs» (no la tarjeta). */
async function downloadSkillMd(setError?: (message: string) => void) {
  try {
    const res = await fetch("/SKILL.md");
    downloadBlob(new Blob([await res.text()], { type: "text/markdown" }), "SKILL.md");
  } catch (cause: any) { setError?.(cause?.message || "Could not download SKILL.md"); }
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
  /** v53: slots del Dashboard — Mi cuenta (perfil + preferencias + uso),
      Mis integraciones (claves de IA) e Invita colegas (equipo/invitaciones). */
  account?: ReactNode;
  integrations?: ReactNode;
  inviteHumans?: ReactNode;
  /** Deep-link del nav: #workspace/configuracion/<pane> aterriza aquí. */
  initialSection?: Section;
  /** El usuario cambió de sección in-page — el Dashboard la sube al nav y a la URL. */
  onSectionChange?: (section: Section) => void;
};

export function WorkspaceConsole({
  workspaceId,
  workspaceName,
  mode,
  onOpenTemplate,
  initialSection,
  onSectionChange,
  account,
  integrations,
  inviteHumans,
}: WorkspaceConsoleProps): JSX.Element {
  const [section, setSection] = useState<Section>(initialSection ?? "account");
  // Deep-link: un salto desde el nav del Dashboard manda la sección nueva.
  useEffect(() => { if (initialSection) setSection(initialSection); }, [initialSection]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ title: string; body: string; label: string; run: () => void } | null>(null);
  const statusId = useId();

  const load = useCallback(async () => {
    // Mis integraciones e Invita IAs comparten claves y conexiones MCP.
    if (!workspaceId || mode === "crm" || (section !== "integrations" && section !== "ais")) return;
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

  // v54: la sección activa da título y descriptor a la tarjeta superior.
  const current = SETTINGS_SECTIONS.find(tab => tab.id === section) ?? SETTINGS_SECTIONS[0];
  const switchSection = (next: Section) => { setSection(next); setError(""); setNotice(""); onSectionChange?.(next); };

  return (
    <section className="workspace-console" aria-label={mode === "crm" ? "CRM" : undefined} aria-labelledby={mode === "settings" ? "workspace-console-title" : undefined} aria-busy={loading}>
      {mode === "settings" && (
        <div className="crm-contacts">
          <div className="crm-table-card crm-contacts-top">
            <header className="crm-contacts-head">
              <div>
                <h1 id="workspace-console-title">{current.title}</h1>
                <p>{current.description}</p>
              </div>
              {/* Nav de ÍCONOS a la misma altura del título — mismo patrón que
                  la nav del CRM; el hover muestra la palabra (title). */}
              <div className="crm-nav-tabs" role="tablist" aria-label="Secciones de configuración">
                {SETTINGS_SECTIONS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={section === tab.id}
                    title={tab.label}
                    className={section === tab.id ? "crm-nav-tab active" : "crm-nav-tab"}
                    onClick={() => switchSection(tab.id)}
                  >
                    {tab.icon}
                  </button>
                ))}
              </div>
            </header>
          </div>
          {(error || notice) && <p id={statusId} className={error ? "workspace-status error" : "workspace-status success"} role={error ? "alert" : "status"}>{error || notice}</p>}
          {section === "account" && account}
          {section === "integrations" && (
            <>
              {integrations}
              <IntegrationsSection workspaceId={workspaceId} connections={connections} reload={load} setError={setError} setNotice={setNotice} />
            </>
          )}
          {section === "humans" && inviteHumans}
          {section === "ais" && <AgentsSection workspaceId={workspaceId} keys={keys} reload={load} setError={setError} setNotice={setNotice} setConfirmAction={setConfirmAction} />}
          {section === "reports" && <ReportsSection workspaceId={workspaceId} />}
          {section === "apis" && <ApiWebhooksSection workspaceId={workspaceId} />}
          {section === "docs" && import.meta.env.DEV && <DocsSectionLazy />}
        </div>
      )}
      {mode === "crm" && (
        <CrmWorkspace
          workspaceId={workspaceId}
          onOpenTemplate={onOpenTemplate}
          setError={(message) => { setNotice(""); setError(message); }}
          setNotice={(message) => { setError(""); setNotice(message); }}
        />
      )}
      {confirmAction && <ConfirmDialog title={confirmAction.title} body={confirmAction.body} confirmLabel={confirmAction.label} onConfirm={confirmAction.run} onClose={() => setConfirmAction(null)} />}
    </section>
  );
}

// v53: los MCP BYOK viven en «Mis integraciones» — lo demás de agentes (claves,
// prompts y SKILL.md) es «Invita IAs».
function IntegrationsSection({ workspaceId, connections, reload, setError, setNotice }: any) {
  const [name, setName] = useState(""); const [provider, setProvider] = useState(""); const [endpointUrl, setEndpointUrl] = useState(""); const [credentialJson, setCredentialJson] = useState('{"headers":{"Authorization":"Bearer …"}}');
  const addConnection = async (event: FormEvent) => { event.preventDefault(); try { const credentials = credentialJson.trim() ? JSON.parse(credentialJson) : undefined; await workspaceFetch(`/api/workspaces/${workspaceId}/connections`, { method: "POST", body: JSON.stringify({ name, provider, endpointUrl, kind: "mcp", enabled: true, credentials }) }); setName(""); setProvider(""); setEndpointUrl(""); setNotice("MCP conectado al workspace."); await reload(); } catch (cause: any) { setError(cause.message); } };
  const toggle = async (connection: Connection) => { try { await workspaceFetch(`/api/workspaces/${workspaceId}/connections/${connection.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !connection.enabled }) }); await reload(); } catch (cause: any) { setError(cause.message); } };
  return <div className="workspace-grid"><article className="workspace-panel"><h3>Conectar MCP BYOK</h3><form className="workspace-form" onSubmit={addConnection}><Field label="Nombre"><input value={name} onChange={e => setName(e.target.value)} required /></Field><Field label="Proveedor"><input value={provider} onChange={e => setProvider(e.target.value)} placeholder="Notion, Slack, MCP propio…" required /></Field><Field label="Endpoint HTTPS"><input type="url" value={endpointUrl} onChange={e => setEndpointUrl(e.target.value)} required /></Field><Field label="Credenciales JSON"><textarea value={credentialJson} onChange={e => setCredentialJson(e.target.value)} rows={3} spellCheck={false} /></Field><button className="workspace-button">Conectar y cifrar</button></form></article><article className="workspace-panel span"><h3>MCPs disponibles para el equipo</h3><div className="workspace-list">{connections.map((connection: Connection) => <div className="workspace-row" key={connection.id}><div><strong>{connection.name}</strong><span>{connection.provider} · {connection.endpointUrl} · secretos {connection.hasCredentials ? "cifrados" : "no configurados"}</span></div><button type="button" className="workspace-link" aria-pressed={connection.enabled} onClick={() => void toggle(connection)}>{connection.enabled ? "Desactivar" : "Activar"}</button></div>)}</div></article></div>;
}

// v53: «Invita IAs» — crear claves, guías listas para pegar en tu IA, accesos y
// SKILL.md. El propio onboarding es la invitación.
function AgentsSection({ workspaceId, keys, reload, setError, setNotice, setConfirmAction }: any) {
  const [keyLabel, setKeyLabel] = useState(""); const [keyRole, setKeyRole] = useState("editor"); const [rawKey, setRawKey] = useState("");
  const createKey = async (event: FormEvent) => { event.preventDefault(); try { const result = await workspaceFetch<any>(`/api/workspaces/${workspaceId}/api-keys`, { method: "POST", body: JSON.stringify({ label: keyLabel, role: keyRole, kind: "mcp" }) }); setRawKey(result.data.key); setKeyLabel(""); await reload(); } catch (cause: any) { setError(cause.message); } };
  const revoke = (key: ApiKey) => setConfirmAction({ title: "Revocar clave", body: `La clave ${key.label} dejará de funcionar inmediatamente.`, label: "Revocar", run: async () => { try { await workspaceFetch(`/api/workspaces/${workspaceId}/api-keys/${key.id}`, { method: "DELETE" }); await reload(); } catch (cause: any) { setError(cause.message); } } });
  return <div className="workspace-grid"><article className="workspace-panel"><h3>Nueva clave para agentes</h3><p className="workspace-muted">Llaveros separados (v55): estas claves son para que tus IAs entren por MCP (Cursor, Claude…). Para scripts, N8N o Zapier crea claves REST en <strong>APIs/Webhooks</strong>.</p><form className="workspace-form" onSubmit={createKey}><Field label="Nombre"><input value={keyLabel} onChange={e => setKeyLabel(e.target.value)} placeholder="Claude del equipo" required /></Field><Field label="Permiso"><select value={keyRole} onChange={e => setKeyRole(e.target.value)}><option value="editor">Puede diseñar</option><option value="viewer">Solo lectura</option></select></Field><button className="workspace-button">Crear clave</button></form>{rawKey && <div className="workspace-secret" role="status"><strong>Cópiala ahora; no volverá a mostrarse.</strong><code>{rawKey}</code><button type="button" className="workspace-link" onClick={() => void navigator.clipboard.writeText(rawKey)}>Copiar</button></div>}</article><article className="workspace-panel span"><h3>Conecta tu IA — prompts listos</h3><p className="workspace-muted">Pega tu clave (o crea una arriba: se rellena sola) y copia la guía de tu IA. La guía unificada de ChatGPT Desktop y Codex incluye dos rutas completas: configuración manual, casilla por casilla, o instalación automática en config.toml. La conexión solo queda confirmada cuando el healthcheck MCP pasa después del reinicio.</p><AiConnectPrompts initialKey={rawKey} /></article><article className="workspace-panel span"><h3>Accesos de agentes</h3><div className="workspace-list">{keys.filter((key: ApiKey) => (key.kind ?? "mcp") === "mcp").map((key: ApiKey) => <div className="workspace-row" key={key.id}><div><strong>{key.label}</strong><span>{key.key_prefix} · {key.role}</span></div><button type="button" className="workspace-link danger" onClick={() => revoke(key)}>Revocar</button></div>)}</div></article><article className="workspace-panel span"><h3>📄 SKILL.md — onboarding para agentes</h3><p className="workspace-muted">Dáselo a cualquier agente de IA: le enseña las herramientas de Futuraria, la estructura del proyecto y las convenciones de diseño, para que diseñe junto a ti.</p><button type="button" className="workspace-button" onClick={() => void downloadSkillMd(setError)}>Descargar SKILL.md</button></article></div>;
}
