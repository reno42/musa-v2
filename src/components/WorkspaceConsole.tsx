import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { getApiHeaders } from "../lib/apiKey";
import { useAuth } from "../lib/auth";

type Section = "team" | "agents" | "crm";
type Member = { id: string; email?: string; display_name?: string; role: "owner" | "admin" | "editor" | "viewer" };
type ApiKey = { id: string; label: string; key_prefix: string; role: string; last_used_at?: string; created_at: string };
type Connection = { id: string; name: string; kind: string; provider: string; endpointUrl: string; enabled: boolean; hasCredentials: boolean };
type Contact = { id: string; first_name: string; last_name?: string; email?: string; job_title?: string; company?: string; brand_name?: string; status: string; tags?: string[] };

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

export function WorkspaceConsole({ workspaceId, workspaceName }: { workspaceId: string | null; workspaceName?: string }) {
  const { user, signOut } = useAuth();
  const [section, setSection] = useState<Section>("team");
  const [members, setMembers] = useState<Member[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ title: string; body: string; label: string; run: () => void } | null>(null);
  const statusId = useId();

  const load = async () => {
    if (!workspaceId) return;
    setLoading(true); setError("");
    try {
      if (section === "team") {
        const result = await workspaceFetch<{ data: Member[] }>(`/api/workspaces/${workspaceId}/members`);
        setMembers(result.data || []);
      } else if (section === "agents") {
        const [keyResult, connectionResult] = await Promise.all([
          workspaceFetch<{ data: ApiKey[] }>(`/api/workspaces/${workspaceId}/api-keys`),
          workspaceFetch<{ data: Connection[] }>(`/api/workspaces/${workspaceId}/connections`),
        ]);
        setKeys(keyResult.data || []); setConnections(connectionResult.data || []);
      } else {
        const result = await workspaceFetch<{ data: Contact[] }>(`/api/workspaces/${workspaceId}/contacts`);
        setContacts(result.data || []);
      }
    } catch (cause: any) { setError(cause.message); }
    setLoading(false);
  };

  useEffect(() => { void load(); }, [workspaceId, section]);

  if (!workspaceId) {
    return <div className="workspace-console-empty"><h2>Selecciona un workspace</h2><p>El equipo, los MCPs y el CRM siempre pertenecen a un workspace concreto.</p></div>;
  }

  return (
    <section className="workspace-console" aria-labelledby="workspace-console-title" aria-busy={loading}>
      <header className="workspace-console-header">
        <div><p className="workspace-eyebrow">Administración SaaS</p><h2 id="workspace-console-title">{workspaceName || "Workspace"}</h2></div>
        <div className="workspace-account"><span>{user?.email}</span><button type="button" onClick={() => void signOut()}>Cerrar sesión</button></div>
      </header>
      <nav className="workspace-subnav" aria-label="Administración del workspace">
        {([['team', 'Equipo'], ['agents', 'APIs y MCPs'], ['crm', 'CRM']] as const).map(([id, label]) => (
          <button key={id} type="button" aria-current={section === id ? "page" : undefined} className={section === id ? "active" : ""} onClick={() => { setSection(id); setError(""); setNotice(""); }}>{label}</button>
        ))}
      </nav>
      {(error || notice) && <p id={statusId} className={error ? "workspace-status error" : "workspace-status success"} role={error ? "alert" : "status"}>{error || notice}</p>}
      {section === "team" && <TeamSection workspaceId={workspaceId} members={members} reload={load} setError={setError} setNotice={setNotice} setConfirmAction={setConfirmAction} />}
      {section === "agents" && <AgentsSection workspaceId={workspaceId} keys={keys} connections={connections} reload={load} setError={setError} setNotice={setNotice} setConfirmAction={setConfirmAction} />}
      {section === "crm" && <CrmSection workspaceId={workspaceId} contacts={contacts} reload={load} setError={setError} setNotice={setNotice} setConfirmAction={setConfirmAction} />}
      {confirmAction && <ConfirmDialog title={confirmAction.title} body={confirmAction.body} confirmLabel={confirmAction.label} onConfirm={confirmAction.run} onClose={() => setConfirmAction(null)} />}
    </section>
  );
}

function TeamSection({ workspaceId, members, reload, setError, setNotice, setConfirmAction }: any) {
  const [email, setEmail] = useState(""); const [role, setRole] = useState("editor"); const [submitting, setSubmitting] = useState(false);
  const invite = async (event: FormEvent) => {
    event.preventDefault(); setSubmitting(true); setError("");
    try {
      const result = await workspaceFetch<any>(`/api/workspaces/${workspaceId}/invitations`, { method: "POST", body: JSON.stringify({ email, role }) });
      await navigator.clipboard?.writeText(`${location.origin}/?invite=${encodeURIComponent(result.data.inviteToken)}#workspace`);
      setEmail(""); setNotice("Invitación creada. El enlace se copió al portapapeles.");
    } catch (cause: any) { setError(cause.message); }
    setSubmitting(false);
  };
  const updateRole = async (userId: string, nextRole: string) => {
    try { await workspaceFetch(`/api/workspaces/${workspaceId}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ role: nextRole }) }); await reload(); }
    catch (cause: any) { setError(cause.message); }
  };
  const remove = (member: Member) => setConfirmAction({ title: "Quitar acceso", body: `${member.display_name || member.email || "Este usuario"} dejará de ver el workspace.`, label: "Quitar", run: async () => {
    try { await workspaceFetch(`/api/workspaces/${workspaceId}/members/${member.id}`, { method: "DELETE" }); await reload(); }
    catch (cause: any) { setError(cause.message); }
  }});
  return <div className="workspace-grid"><article className="workspace-panel"><h3>Invitar persona</h3><form className="workspace-form-row" onSubmit={invite}><Field label="Correo"><input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></Field><Field label="Rol"><select value={role} onChange={e => setRole(e.target.value)}><option value="admin">Admin</option><option value="editor">Editor</option><option value="viewer">Viewer</option></select></Field><button className="workspace-button" disabled={submitting}>{submitting ? "Invitando…" : "Invitar"}</button></form></article><article className="workspace-panel span"><h3>Personas con acceso</h3><div className="workspace-list">{members.map((member: Member) => <div className="workspace-row" key={member.id}><div><strong>{member.display_name || member.email || member.id}</strong><span>{member.email}</span></div><div className="workspace-row-actions">{member.role === "owner" ? <span className="workspace-pill">Owner</span> : <><select aria-label={`Rol de ${member.display_name || member.email}`} value={member.role} onChange={e => void updateRole(member.id, e.target.value)}><option value="admin">Admin</option><option value="editor">Editor</option><option value="viewer">Viewer</option></select><button type="button" className="workspace-link danger" onClick={() => remove(member)}>Quitar</button></>}</div></div>)}</div></article></div>;
}

function AgentsSection({ workspaceId, keys, connections, reload, setError, setNotice, setConfirmAction }: any) {
  const [keyLabel, setKeyLabel] = useState(""); const [keyRole, setKeyRole] = useState("editor"); const [rawKey, setRawKey] = useState("");
  const [name, setName] = useState(""); const [provider, setProvider] = useState(""); const [endpointUrl, setEndpointUrl] = useState(""); const [credentialJson, setCredentialJson] = useState('{"headers":{"Authorization":"Bearer …"}}');
  const createKey = async (event: FormEvent) => { event.preventDefault(); try { const result = await workspaceFetch<any>(`/api/workspaces/${workspaceId}/api-keys`, { method: "POST", body: JSON.stringify({ label: keyLabel, role: keyRole }) }); setRawKey(result.data.key); setKeyLabel(""); await reload(); } catch (cause: any) { setError(cause.message); } };
  const addConnection = async (event: FormEvent) => { event.preventDefault(); try { const credentials = credentialJson.trim() ? JSON.parse(credentialJson) : undefined; await workspaceFetch(`/api/workspaces/${workspaceId}/connections`, { method: "POST", body: JSON.stringify({ name, provider, endpointUrl, kind: "mcp", enabled: true, credentials }) }); setName(""); setProvider(""); setEndpointUrl(""); setNotice("MCP conectado al workspace."); await reload(); } catch (cause: any) { setError(cause.message); } };
  const revoke = (key: ApiKey) => setConfirmAction({ title: "Revocar clave", body: `La clave ${key.label} dejará de funcionar inmediatamente.`, label: "Revocar", run: async () => { try { await workspaceFetch(`/api/workspaces/${workspaceId}/api-keys/${key.id}`, { method: "DELETE" }); await reload(); } catch (cause: any) { setError(cause.message); } } });
  const toggle = async (connection: Connection) => { try { await workspaceFetch(`/api/workspaces/${workspaceId}/connections/${connection.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !connection.enabled }) }); await reload(); } catch (cause: any) { setError(cause.message); } };
  return <div className="workspace-grid"><article className="workspace-panel"><h3>Nueva clave para agentes</h3><form className="workspace-form" onSubmit={createKey}><Field label="Nombre"><input value={keyLabel} onChange={e => setKeyLabel(e.target.value)} placeholder="Claude del equipo" required /></Field><Field label="Permiso"><select value={keyRole} onChange={e => setKeyRole(e.target.value)}><option value="editor">Puede diseñar</option><option value="viewer">Solo lectura</option></select></Field><button className="workspace-button">Crear clave</button></form>{rawKey && <div className="workspace-secret" role="status"><strong>Cópiala ahora; no volverá a mostrarse.</strong><code>{rawKey}</code><button type="button" className="workspace-link" onClick={() => void navigator.clipboard.writeText(rawKey)}>Copiar</button></div>}</article><article className="workspace-panel"><h3>Conectar MCP BYOK</h3><form className="workspace-form" onSubmit={addConnection}><Field label="Nombre"><input value={name} onChange={e => setName(e.target.value)} required /></Field><Field label="Proveedor"><input value={provider} onChange={e => setProvider(e.target.value)} placeholder="Notion, Slack, MCP propio…" required /></Field><Field label="Endpoint HTTPS"><input type="url" value={endpointUrl} onChange={e => setEndpointUrl(e.target.value)} required /></Field><Field label="Credenciales JSON"><textarea value={credentialJson} onChange={e => setCredentialJson(e.target.value)} rows={3} spellCheck={false} /></Field><button className="workspace-button">Conectar y cifrar</button></form></article><article className="workspace-panel span"><h3>Accesos de agentes</h3><div className="workspace-list">{keys.map((key: ApiKey) => <div className="workspace-row" key={key.id}><div><strong>{key.label}</strong><span>{key.key_prefix} · {key.role}</span></div><button type="button" className="workspace-link danger" onClick={() => revoke(key)}>Revocar</button></div>)}</div></article><article className="workspace-panel span"><h3>MCPs disponibles para el equipo</h3><div className="workspace-list">{connections.map((connection: Connection) => <div className="workspace-row" key={connection.id}><div><strong>{connection.name}</strong><span>{connection.provider} · {connection.endpointUrl} · secretos {connection.hasCredentials ? "cifrados" : "no configurados"}</span></div><button type="button" className="workspace-link" aria-pressed={connection.enabled} onClick={() => void toggle(connection)}>{connection.enabled ? "Desactivar" : "Activar"}</button></div>)}</div></article></div>;
}

function CrmSection({ workspaceId, contacts, reload, setError, setNotice, setConfirmAction }: any) {
  const [firstName, setFirstName] = useState(""); const [lastName, setLastName] = useState(""); const [email, setEmail] = useState(""); const [brandName, setBrandName] = useState(""); const [company, setCompany] = useState(""); const [jobTitle, setJobTitle] = useState(""); const [notes, setNotes] = useState("");
  const add = async (event: FormEvent) => { event.preventDefault(); try { await workspaceFetch(`/api/workspaces/${workspaceId}/contacts`, { method: "POST", body: JSON.stringify({ firstName, lastName, email, brandName, company, jobTitle, notes, status: "active", tags: [] }) }); setFirstName(""); setLastName(""); setEmail(""); setBrandName(""); setCompany(""); setJobTitle(""); setNotes(""); setNotice("Contacto agregado al CRM."); await reload(); } catch (cause: any) { setError(cause.message); } };
  const remove = (contact: Contact) => setConfirmAction({ title: "Eliminar contacto", body: `${contact.first_name} ${contact.last_name || ""} se eliminará del CRM.`, label: "Eliminar", run: async () => { try { await workspaceFetch(`/api/workspaces/${workspaceId}/contacts/${contact.id}`, { method: "DELETE" }); await reload(); } catch (cause: any) { setError(cause.message); } } });
  return <div className="workspace-grid"><article className="workspace-panel"><h3>Nuevo contacto de marca</h3><form className="workspace-form" onSubmit={add}><div className="workspace-form-row"><Field label="Nombre"><input value={firstName} onChange={e => setFirstName(e.target.value)} required /></Field><Field label="Apellido"><input value={lastName} onChange={e => setLastName(e.target.value)} /></Field></div><Field label="Correo"><input type="email" value={email} onChange={e => setEmail(e.target.value)} /></Field><div className="workspace-form-row"><Field label="Marca"><input value={brandName} onChange={e => setBrandName(e.target.value)} /></Field><Field label="Empresa"><input value={company} onChange={e => setCompany(e.target.value)} /></Field></div><Field label="Cargo"><input value={jobTitle} onChange={e => setJobTitle(e.target.value)} /></Field><Field label="Notas"><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} /></Field><button className="workspace-button">Agregar contacto</button></form></article><article className="workspace-panel span"><h3>Contactos</h3><div className="workspace-list">{contacts.length === 0 && <p className="workspace-muted">Aún no hay contactos. Agrega el primero para conectar personas con marcas.</p>}{contacts.map((contact: Contact) => <div className="workspace-row" key={contact.id}><div><strong>{contact.first_name} {contact.last_name}</strong><span>{[contact.job_title, contact.brand_name || contact.company, contact.email].filter(Boolean).join(" · ")}</span></div><button type="button" className="workspace-link danger" onClick={() => remove(contact)}>Eliminar</button></div>)}</div></article></div>;
}
