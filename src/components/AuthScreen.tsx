import { useId, useState, type FormEvent } from "react";
import { browserSupabase } from "../lib/supabaseClient";

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

export function AuthScreen({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const errorId = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!browserSupabase) return;
    setSubmitting(true);
    setError("");
    setMessage("");
    const result = mode === "signin"
      ? await browserSupabase.auth.signInWithPassword({ email, password })
      : await browserSupabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name }, emailRedirectTo: window.location.href },
        });
    if (result.error) setError(result.error.message);
    else if (mode === "signup" && !result.data.session) setMessage("Revisa tu correo para confirmar la cuenta.");
    setSubmitting(false);
  };

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <button type="button" className="auth-back" onClick={onBack}>← Volver</button>
        <div className="auth-mark" aria-hidden="true">F</div>
        <h1 id="auth-title" className="auth-title">{mode === "signin" ? "Entra a tu workspace" : "Crea tu cuenta"}</h1>
        <p className="auth-copy">Tus diseños, contactos y agentes quedan aislados por workspace.</p>
        <form onSubmit={submit} className="auth-form" aria-busy={submitting}>
          {mode === "signup" && (
            <label className="auth-field">
              <span>Nombre</span>
              <input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
          )}
          <label className="auth-field">
            <span>Correo</span>
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required aria-describedby={error ? errorId : undefined} aria-invalid={Boolean(error)} />
          </label>
          <label className="auth-field">
            <span>Contraseña</span>
            <input type="password" minLength={8} autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} required aria-describedby={error ? errorId : undefined} aria-invalid={Boolean(error)} />
          </label>
          {error && <p id={errorId} className="auth-error" role="alert">{error}</p>}
          {message && <p className="auth-message" role="status">{message}</p>}
          <button className="auth-submit" type="submit" disabled={submitting}>{submitting ? "Procesando…" : mode === "signin" ? "Entrar" : "Crear cuenta"}</button>
        </form>
        <button type="button" className="auth-switch" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); setMessage(""); }}>
          {mode === "signin" ? "¿Nuevo aquí? Crea una cuenta" : "¿Ya tienes cuenta? Inicia sesión"}
        </button>
      </section>
    </main>
  );
}
