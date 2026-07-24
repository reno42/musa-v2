import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { getApiHeaders } from "../lib/apiKey";
import { useAuth } from "../lib/auth";
import { browserSupabase } from "../lib/supabaseClient";
import { CrmWorkspace } from "./CrmWorkspace";

type Section = "general" | "team" | "agents" | "account";
type ConsoleMode = "crm" | "settings";
const SETTINGS_SECTIONS = [
  ["general", "General"],
  ["team", "Equipo"],
  ["agents", "API MCP"],
  ["account", "Cuenta"],
] as const satisfies ReadonlyArray<readonly [Section, string]>;
type Member = { id: string; email?: string; display_name?: string; role: "owner" | "admin" | "editor" | "viewer" };
type Invitation = { id: string; email: string; role: "admin" | "editor" | "viewer"; status: "pending" | "accepted" | "declined" | "revoked" | "expired"; expiresAt: string; createdAt: string; lastSentAt?: string; deliveryMethod: string; workspaceName?: string; invitedBy?: string };
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
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ title: string; body: string; label: string; run: () => void } | null>(null);
  const statusId = useId();

  const load = useCallback(async () => {
    if (!workspaceId || mode === "crm" || section === "general" || section === "account") return;
    setLoading(true); setError("");
    try {
      if (section === "team") {
        const result = await workspaceFetch<{ data: Member[] }>(`/api/workspaces/${workspaceId}/members`);
        const nextMembers = result.data || [];
        setMembers(nextMembers);
        const currentRole = nextMembers.find((member) => member.id === user?.id)?.role;
        if (currentRole === "owner" || currentRole === "admin") {
          const invitationResult = await workspaceFetch<{ data: Invitation[] }>(`/api/workspaces/${workspaceId}/invitations`);
          setInvitations(invitationResult.data || []);
        } else {
          setInvitations([]);
        }
      } else if (section === "agents") {
        const [keyResult, connectionResult] = await Promise.all([
          workspaceFetch<{ data: ApiKey[] }>(`/api/workspaces/${workspaceId}/api-keys`),
          workspaceFetch<{ data: Connection[] }>(`/api/workspaces/${workspaceId}/connections`),
        ]);
        setKeys(keyResult.data || []); setConnections(connectionResult.data || []);
      }
    } catch (cause: any) { setError(cause.message); }
    setLoading(false);
  }, [mode, workspaceId, section, user?.id]);

  useEffect(() => { void load(); }, [load]);

  if (!workspaceId) {
    return <div className="workspace-console-empty"><h2>Selecciona un workspace</h2><p>El CRM y la configuración siempre pertenecen a un workspace concreto.</p></div>;
  }

  return (
    <section className="workspace-console" aria-labelledby="workspace-console-title" aria-busy={loading}>
      <header className="workspace-console-header">
        <div><p className="workspace-eyebrow">{mode === "crm" ? "CRM" : "Configuración del workspace"}</p><h2 id="workspace-console-title">{workspaceName || "Workspace"}</h2></div>
        {mode === "settings" && <div className="workspace-account"><span>{user?.email}</span><button type="button" onClick={() => void signOut()}>Cerrar sesión</button></div>}
      </header>
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
      {mode === "settings" && section === "general" && children}
      {mode === "settings" && section === "team" && <TeamSection workspaceId={workspaceId} members={members} invitations={invitations} currentUserId={user?.id} reload={load} setError={setError} setNotice={setNotice} setConfirmAction={setConfirmAction} />}
      {mode === "settings" && section === "agents" && <AgentsSection workspaceId={workspaceId} keys={keys} connections={connections} reload={load} setError={setError} setNotice={setNotice} setConfirmAction={setConfirmAction} />}
      {mode === "settings" && section === "account" && <AccountSection setError={setError} setNotice={setNotice} />}
      {confirmAction && <ConfirmDialog title={confirmAction.title} body={confirmAction.body} confirmLabel={confirmAction.label} onConfirm={confirmAction.run} onClose={() => setConfirmAction(null)} />}
    </section>
  );
}

function TeamSection({ workspaceId, members, invitations, currentUserId, reload, setError, setNotice, setConfirmAction }: any) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [submitting, setSubmitting] = useState(false);
  const currentRole = members.find((member: Member) => member.id === currentUserId)?.role;
  const canManage = currentRole === "owner" || currentRole === "admin";

  const copyLink = async (link: string) => {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(link);
    return true;
  };

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const result = await workspaceFetch<any>(`/api/workspaces/${workspaceId}/invitations`, {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      const copied = await copyLink(result.data.inviteLink).catch(() => false);
      setEmail("");
      setNotice(result.data.emailSent
        ? `Invitación enviada por correo${copied ? " y enlace copiado" : ""}.`
        : `${result.data.warning || "Invitación creada."}${copied ? " El enlace se copió al portapapeles." : ""}`);
      await reload();
    } catch (cause: any) { setError(cause.message); }
    setSubmitting(false);
  };

  const resend = async (invitation: Invitation) => {
    setError("");
    try {
      const result = await workspaceFetch<any>(`/api/workspaces/${workspaceId}/invitations/${invitation.id}/resend`, { method: "POST", body: "{}" });
      const copied = await copyLink(result.data.inviteLink).catch(() => false);
      setNotice(result.data.emailSent
        ? `Invitación reenviada a ${invitation.email}${copied ? " y enlace copiado" : ""}.`
        : `${result.data.warning || "Invitación renovada."}${copied ? " El enlace se copió." : ""}`);
      await reload();
    } catch (cause: any) { setError(cause.message); }
  };

  const revoke = (invitation: Invitation) => setConfirmAction({
    title: "Revocar invitación",
    body: `${invitation.email} ya no podrá usar este acceso.`,
    label: "Revocar",
    run: async () => {
      try {
        await workspaceFetch(`/api/workspaces/${workspaceId}/invitations/${invitation.id}`, { method: "DELETE" });
        await reload();
      } catch (cause: any) { setError(cause.message); }
    },
  });

  const updateRole = async (userId: string, nextRole: string) => {
    try {
      await workspaceFetch(`/api/workspaces/${workspaceId}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ role: nextRole }) });
      await reload();
    } catch (cause: any) { setError(cause.message); }
  };

  const remove = (member: Member) => setConfirmAction({
    title: "Quitar acceso",
    body: `${member.display_name || member.email || "Este usuario"} dejará de ver el workspace.`,
    label: "Quitar",
    run: async () => {
      try {
        await workspaceFetch(`/api/workspaces/${workspaceId}/members/${member.id}`, { method: "DELETE" });
        await reload();
      } catch (cause: any) { setError(cause.message); }
    },
  });

  return (
    <div className="workspace-grid">
      {canManage && (
        <article className="workspace-panel span">
          <h3>Invitar persona</h3>
          <p className="workspace-muted">Recibirá un correo seguro. El enlace también se copia para que puedas compartirlo directamente.</p>
          <form className="workspace-form-row" onSubmit={invite}>
            <Field label="Correo"><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></Field>
            <Field label="Rol"><select value={role} onChange={(event) => setRole(event.target.value)}><option value="admin">Admin</option><option value="editor">Editor</option><option value="viewer">Viewer</option></select></Field>
            <button className="workspace-button" disabled={submitting}>{submitting ? "Invitando…" : "Enviar invitación"}</button>
          </form>
        </article>
      )}
      <article className="workspace-panel span">
        <h3>Personas con acceso</h3>
        <div className="workspace-list">
          {members.length === 0 && <p className="workspace-muted">Todavía no hay miembros en este workspace.</p>}
          {members.map((member: Member) => (
            <div className="workspace-row" key={member.id}>
              <div><strong>{member.display_name || member.email || member.id}</strong><span>{member.email}</span></div>
              <div className="workspace-row-actions">
                {member.role === "owner" || !canManage
                  ? <span className="workspace-pill">{member.role}</span>
                  : <><select aria-label={`Rol de ${member.display_name || member.email}`} value={member.role} onChange={(event) => void updateRole(member.id, event.target.value)}><option value="admin">Admin</option><option value="editor">Editor</option><option value="viewer">Viewer</option></select><button type="button" className="workspace-link danger" onClick={() => remove(member)}>Quitar</button></>}
              </div>
            </div>
          ))}
        </div>
      </article>
      {canManage && (
        <article className="workspace-panel span">
          <h3>Invitaciones</h3>
          <div className="workspace-list">
            {invitations.length === 0 && <p className="workspace-muted">No hay invitaciones todavía.</p>}
            {invitations.map((invitation: Invitation) => (
              <div className="workspace-row" key={invitation.id}>
                <div><strong>{invitation.email}</strong><span>{invitation.role} · {invitation.status}</span></div>
                {invitation.status === "pending" && <div className="workspace-row-actions"><button type="button" className="workspace-link" onClick={() => void resend(invitation)}>Reenviar</button><button type="button" className="workspace-link danger" onClick={() => revoke(invitation)}>Revocar</button></div>}
              </div>
            ))}
          </div>
        </article>
      )}
    </div>
  );
}

function AccountSection({ setError, setNotice }: { setError: (value: string) => void; setNotice: (value: string) => void }) {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState(() => String(user?.user_metadata?.full_name || user?.user_metadata?.name || ""));
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [incoming, setIncoming] = useState<Invitation[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const loadIncoming = useCallback(async () => {
    try {
      const result = await workspaceFetch<{ data: Invitation[] }>("/api/account/invitations");
      setIncoming(result.data || []);
    } catch (cause: any) { setError(cause.message); }
  }, [setError]);

  useEffect(() => { void loadIncoming(); }, [loadIncoming]);

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!browserSupabase) return;
    setSubmitting(true); setError("");
    const { error } = await browserSupabase.auth.updateUser({
      data: { ...user?.user_metadata, full_name: displayName.trim() },
    });
    if (error) setError(error.message);
    else {
      await workspaceFetch("/api/account/bootstrap", { method: "POST", body: "{}" });
      setNotice("Perfil actualizado.");
    }
    setSubmitting(false);
  };

  const changeEmail = async (event: FormEvent) => {
    event.preventDefault();
    if (!browserSupabase) return;
    setSubmitting(true); setError("");
    const { error } = await browserSupabase.auth.updateUser({ email: newEmail.trim() });
    if (error) setError(error.message);
    else {
      setNewEmail("");
      setNotice("Revisa tu correo actual y el nuevo para confirmar el cambio.");
    }
    setSubmitting(false);
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!browserSupabase || !user?.email) return;
    if (newPassword !== passwordConfirmation) {
      setError("Las contraseñas nuevas no coinciden.");
      return;
    }
    setSubmitting(true); setError("");
    const { error: signInError } = await browserSupabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
    if (signInError) {
      setError("La contraseña actual no es correcta.");
      setSubmitting(false);
      return;
    }
    const { error } = await browserSupabase.auth.updateUser({ password: newPassword });
    if (error) setError(error.message);
    else {
      setCurrentPassword(""); setNewPassword(""); setPasswordConfirmation("");
      setNotice("Contraseña actualizada.");
    }
    setSubmitting(false);
  };

  const respond = async (invitation: Invitation, decision: "accept" | "decline") => {
    setError("");
    try {
      await workspaceFetch(`/api/account/invitations/${invitation.id}/${decision}`, { method: "POST", body: "{}" });
      if (decision === "accept") {
        window.location.replace("/#workspace");
        return;
      }
      setNotice(`Invitación a ${invitation.workspaceName || "workspace"} rechazada.`);
      await loadIncoming();
    } catch (cause: any) { setError(cause.message); }
  };

  return (
    <div className="workspace-grid">
      <article className="workspace-panel">
        <h3>Perfil</h3>
        <form className="workspace-form" onSubmit={saveProfile}>
          <Field label="Nombre"><input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></Field>
          <Field label="Correo actual"><input value={user?.email || ""} readOnly /></Field>
          <button className="workspace-button" disabled={submitting}>Guardar perfil</button>
        </form>
      </article>
      <article className="workspace-panel">
        <h3>Cambiar correo</h3>
        <p className="workspace-muted">Supabase solicitará confirmación antes de mover tu cuenta al correo nuevo.</p>
        <form className="workspace-form" onSubmit={changeEmail}>
          <Field label="Correo nuevo"><input type="email" autoComplete="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} required /></Field>
          <button className="workspace-button" disabled={submitting}>Solicitar cambio</button>
        </form>
      </article>
      <article className="workspace-panel span">
        <h3>Cambiar contraseña</h3>
        <form className="workspace-form-row" onSubmit={changePassword}>
          <Field label="Contraseña actual"><input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></Field>
          <Field label="Contraseña nueva"><input type="password" minLength={10} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></Field>
          <Field label="Confirmar"><input type="password" minLength={10} autoComplete="new-password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} required /></Field>
          <button className="workspace-button" disabled={submitting}>Actualizar</button>
        </form>
      </article>
      <article className="workspace-panel span">
        <h3>Invitaciones recibidas</h3>
        <div className="workspace-list">
          {incoming.length === 0 && <p className="workspace-muted">No tienes invitaciones pendientes.</p>}
          {incoming.map((invitation) => (
            <div className="workspace-row" key={invitation.id}>
              <div><strong>{invitation.workspaceName}</strong><span>{invitation.invitedBy} · acceso {invitation.role}</span></div>
              <div className="workspace-row-actions"><button type="button" className="workspace-link" onClick={() => void respond(invitation, "accept")}>Aceptar</button><button type="button" className="workspace-link danger" onClick={() => void respond(invitation, "decline")}>Rechazar</button></div>
            </div>
          ))}
        </div>
      </article>
    </div>
  );
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
