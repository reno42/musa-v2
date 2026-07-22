import { useEffect, useId, useState, type FormEvent } from "react";
import { getApiHeaders } from "../lib/apiKey";
import { useAuth } from "../lib/auth";
import { browserSupabase } from "../lib/supabaseClient";

export type InvitationPreview = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  maskedEmail: string;
  role: "admin" | "editor" | "viewer";
  invitedBy: string;
  expiresAt: string;
  accountExists: boolean;
  requiresAccountSetup: boolean;
};

type AuthMode = "signin" | "signup" | "forgot";

function friendlyAuthError(message: string) {
  if (/invalid login credentials/i.test(message)) return "El correo o la contraseña no coinciden.";
  if (/email not confirmed/i.test(message)) return "Confirma tu correo antes de iniciar sesión.";
  if (/user already registered/i.test(message)) return "Ya existe una cuenta con ese correo. Inicia sesión o recupera tu contraseña.";
  if (/password should be/i.test(message)) return "La contraseña no cumple los requisitos de seguridad.";
  if (/rate limit|too many/i.test(message)) return "Demasiados intentos. Espera unos minutos y vuelve a probar.";
  return message;
}

function authRedirectUrl(extra?: Record<string, string>) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(extra || {})) url.searchParams.set(key, value);
  return url.toString();
}

export function AuthConfigurationScreen({ onBack, error }: { onBack: () => void; error: string }) {
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-config-title">
        <button type="button" className="auth-back" onClick={onBack}>← Volver</button>
        <div className="auth-mark" aria-hidden="true">F</div>
        <h1 id="auth-config-title" className="auth-title">Falta conectar el acceso</h1>
        <p className="auth-copy">La base de datos está activa, pero el navegador todavía no recibió la clave pública de Supabase.</p>
        <p className="auth-error" role="alert">{error}</p>
        <div className="auth-setup-help">
          Copia la clave <strong>Publishable</strong> de Supabase en una variable llamada <code>SUPABASE_PUBLISHABLE_KEY</code> y vuelve a desplegar. No uses aquí la clave <code>Secret</code> ni <code>service_role</code>.
        </div>
      </section>
    </main>
  );
}

export function AuthScreen({ onBack, invitation }: { onBack: () => void; invitation?: InvitationPreview }) {
  const [mode, setMode] = useState<AuthMode>(() => invitation && !invitation.accountExists ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const errorId = useId();
  const messageId = useId();

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError("");
    setMessage("");
    setPassword("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!browserSupabase) return;
    setSubmitting(true);
    setError("");
    setMessage("");

    if (mode === "forgot") {
      const { error: resetError } = await browserSupabase.auth.resetPasswordForEmail(email, {
        redirectTo: authRedirectUrl({ reset: "1" }),
      });
      if (resetError) setError(friendlyAuthError(resetError.message));
      else setMessage("Si existe una cuenta con ese correo, recibirás un enlace para cambiar la contraseña.");
      setSubmitting(false);
      return;
    }

    const result = mode === "signin"
      ? await browserSupabase.auth.signInWithPassword({ email, password })
      : await browserSupabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name }, emailRedirectTo: authRedirectUrl() },
        });
    if (result.error) setError(friendlyAuthError(result.error.message));
    else if (mode === "signup" && !result.data.session) {
      setMessage("Cuenta creada. Revisa tu correo para confirmarla y entrar.");
    }
    setSubmitting(false);
  };

  const resendConfirmation = async () => {
    if (!browserSupabase || !email) return;
    setSubmitting(true);
    setError("");
    const { error: resendError } = await browserSupabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: authRedirectUrl() },
    });
    if (resendError) setError(friendlyAuthError(resendError.message));
    else setMessage("Enviamos un nuevo correo de confirmación.");
    setSubmitting(false);
  };

  const title = mode === "signin" ? "Entra a tu workspace" : mode === "signup" ? "Crea tu cuenta" : "Recupera tu contraseña";

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <button type="button" className="auth-back" onClick={onBack}>← Volver</button>
        <div className="auth-mark" aria-hidden="true">F</div>
        {invitation && (
          <div className="auth-invitation" role="status">
            <strong>{invitation.invitedBy} te invitó a {invitation.workspaceName}</strong>
            <span>Acceso {invitation.role} para {invitation.maskedEmail}</span>
          </div>
        )}
        <h1 id="auth-title" className="auth-title">{title}</h1>
        <p className="auth-copy">
          {mode === "forgot"
            ? "Te enviaremos un enlace seguro. El mensaje no revela si el correo está registrado."
            : invitation
              ? "Usa el mismo correo de la invitación. Después podrás aceptarla explícitamente."
              : "Tus diseños, contactos y agentes quedan aislados por workspace."}
        </p>
        <form onSubmit={submit} className="auth-form" aria-busy={submitting}>
          {mode === "signup" && (
            <label className="auth-field">
              <span>Nombre</span>
              <input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
          )}
          <label className="auth-field">
            <span>Correo</span>
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required aria-describedby={error ? errorId : message ? messageId : undefined} aria-invalid={Boolean(error)} />
          </label>
          {mode !== "forgot" && (
            <label className="auth-field">
              <span>Contraseña</span>
              <input type="password" minLength={10} autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} required aria-describedby={error ? errorId : undefined} aria-invalid={Boolean(error)} />
              {mode === "signup" && <small>Usa al menos 10 caracteres.</small>}
            </label>
          )}
          {error && <p id={errorId} className="auth-error" role="alert">{error}</p>}
          {message && <p id={messageId} className="auth-message" role="status">{message}</p>}
          <button className="auth-submit" type="submit" disabled={submitting}>
            {submitting ? "Procesando…" : mode === "signin" ? "Entrar" : mode === "signup" ? "Crear cuenta" : "Enviar enlace"}
          </button>
        </form>
        {mode === "signin" && <button type="button" className="auth-switch" onClick={() => switchMode("forgot")}>Olvidé mi contraseña</button>}
        {mode === "signup" && email && <button type="button" className="auth-switch" onClick={() => void resendConfirmation()} disabled={submitting}>Reenviar correo de confirmación</button>}
        <button type="button" className="auth-switch" onClick={() => switchMode(mode === "signin" ? "signup" : "signin")}>
          {mode === "signin" ? "¿Nuevo aquí? Crea una cuenta" : "¿Ya tienes cuenta? Inicia sesión"}
        </button>
      </section>
    </main>
  );
}

export function PasswordUpdateScreen({ kind, onComplete }: { kind: "recovery" | "invitation"; onComplete: () => void }) {
  const { user } = useAuth();
  const [name, setName] = useState(() => String(user?.user_metadata?.full_name || user?.user_metadata?.name || ""));
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const errorId = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!browserSupabase) return;
    if (password !== confirmation) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setSubmitting(true);
    setError("");
    const metadata = kind === "invitation"
      ? { ...user?.user_metadata, full_name: name.trim(), needs_password_setup: false }
      : user?.user_metadata?.needs_password_setup
        ? { ...user.user_metadata, needs_password_setup: false }
        : undefined;
    const { error: updateError } = await browserSupabase.auth.updateUser({ password, ...(metadata ? { data: metadata } : {}) });
    if (updateError) setError(friendlyAuthError(updateError.message));
    else onComplete();
    setSubmitting(false);
  };

  if (!user) {
    return (
      <main className="auth-shell">
        <section className="auth-card" aria-labelledby="password-link-title">
          <h1 id="password-link-title" className="auth-title">El enlace ya no es válido</h1>
          <p className="auth-copy">Solicita un nuevo correo de recuperación desde la pantalla de acceso.</p>
          <button type="button" className="auth-submit" onClick={onComplete}>Volver al acceso</button>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="password-update-title">
        <div className="auth-mark" aria-hidden="true">F</div>
        <h1 id="password-update-title" className="auth-title">{kind === "invitation" ? "Completa tu cuenta" : "Crea una contraseña nueva"}</h1>
        <p className="auth-copy">{kind === "invitation" ? "Define tu nombre y contraseña antes de aceptar el acceso al workspace." : "Al guardar, podrás continuar con tu sesión abierta."}</p>
        <form className="auth-form" onSubmit={submit} aria-busy={submitting}>
          {kind === "invitation" && (
            <label className="auth-field"><span>Nombre</span><input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required /></label>
          )}
          <label className="auth-field"><span>Nueva contraseña</span><input type="password" minLength={10} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required aria-describedby={error ? errorId : undefined} aria-invalid={Boolean(error)} /></label>
          <label className="auth-field"><span>Confirma la contraseña</span><input type="password" minLength={10} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required aria-describedby={error ? errorId : undefined} aria-invalid={Boolean(error)} /></label>
          {error && <p id={errorId} className="auth-error" role="alert">{error}</p>}
          <button type="submit" className="auth-submit" disabled={submitting}>{submitting ? "Guardando…" : "Guardar contraseña"}</button>
        </form>
      </section>
    </main>
  );
}

export function InvitationGate({ token, onBack }: { token: string; onBack: () => void }) {
  const { user, signOut } = useAuth();
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    void fetch(`/api/invitations/${encodeURIComponent(token)}`, { headers: { Accept: "application/json" } })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "La invitación no está disponible.");
        if (active) setInvitation(payload.data);
      })
      .catch((cause: Error) => { if (active) setError(cause.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  const respond = async (decision: "accept" | "decline") => {
    setSubmitting(true);
    setError("");
    const response = await fetch(`/api/account/invitations/${decision}`, {
      method: "POST",
      headers: getApiHeaders(),
      body: JSON.stringify({ token }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload.error || "No se pudo responder a la invitación.");
      setSubmitting(false);
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("invite");
    window.location.replace(`${url.pathname}${url.search}#workspace`);
  };

  if (loading) return <main className="auth-shell"><p className="auth-copy" role="status">Cargando invitación…</p></main>;
  if (!invitation) {
    return (
      <main className="auth-shell">
        <section className="auth-card" aria-labelledby="invite-error-title">
          <h1 id="invite-error-title" className="auth-title">La invitación no está disponible</h1>
          <p className="auth-error" role="alert">{error || "Puede haber vencido, sido revocada o utilizada."}</p>
          <button type="button" className="auth-submit" onClick={onBack}>Ir al inicio</button>
        </section>
      </main>
    );
  }
  if (!user) return <AuthScreen invitation={invitation} onBack={onBack} />;

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="invite-title">
        <div className="auth-mark" aria-hidden="true">F</div>
        <p className="auth-eyebrow">Invitación de workspace</p>
        <h1 id="invite-title" className="auth-title">Únete a {invitation.workspaceName}</h1>
        <p className="auth-copy">{invitation.invitedBy} te ofrece acceso <strong>{invitation.role}</strong>. La invitación fue enviada a {invitation.maskedEmail}.</p>
        <div className="auth-session-note">Sesión actual: <strong>{user.email}</strong></div>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <div className="auth-actions">
          <button type="button" className="auth-submit" disabled={submitting} onClick={() => void respond("accept")}>{submitting ? "Procesando…" : "Aceptar invitación"}</button>
          <button type="button" className="auth-secondary" disabled={submitting} onClick={() => void respond("decline")}>Rechazar</button>
        </div>
        <button type="button" className="auth-switch" onClick={() => void signOut()}>Usar otra cuenta</button>
      </section>
    </main>
  );
}
