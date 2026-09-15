import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { initializeBrowserSupabase } from "../lib/supabaseClient";
import { sanitizeGoogleFontUrl } from "../lib/googleFonts";

/**
 * SharedDesignGate — the guest experience behind share links /c/:templateId.
 *
 * The invitee lands INSIDE a lookalike of the editor (same topbar, tool rail,
 * right panel): the real design is painted on the canvas but blurred, with a
 * modal on top — sign in or create an account (Google one-click, or email
 * inline). Nothing navigates: when the session lands (auth state change or
 * the OAuth redirect back to this same URL), the blur and the modal simply
 * disappear and the guest can pin comments, right where they "already were".
 *
 * Data: GET /api/comments-share/:templateId (public, gated by
 * templates.is_public) returns the full frame payloads (html/css); comments
 * go back through POST on the same endpoint (source mobile_pin), the same
 * rows the editor's comment layer and the Kanban read.
 */

type GateFrame = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  html: string;
  css: string;
  background: string | null;
};

type GateTemplate = {
  id: string;
  name: string;
  workspaceId: string | null;
  isBrandManual: boolean;
  thumbnail: string | null;
  width: number;
  height: number;
  background: string | null;
  frames: GateFrame[];
  framesTruncated: boolean;
};

type GateComment = {
  id: string;
  body: string;
  author_name: string;
  x_pct: number;
  y_pct: number;
  status: string;
  source: string;
  kanban_task_id: string | null;
  created_at: string;
};

const clampPct = (n: number): number => Math.max(0, Math.min(100, n));

function friendlyAuthError(message: string) {
  if (/provider/i.test(message)) return "Google todavía no está habilitado en el servidor de acceso. El dueño del workspace debe activarlo en Supabase → Authentication → Providers.";
  if (/invalid login credentials/i.test(message)) return "El correo o la contraseña no coinciden.";
  if (/email not confirmed/i.test(message)) return "Confirma tu correo (revisa tu bandeja) y esta pantalla se desbloqueará sola.";
  if (/user already registered/i.test(message)) return "Ya existe una cuenta con ese correo. Inicia sesión o usa Google con ese mismo correo.";
  if (/password should be/i.test(message)) return "La contraseña no cumple los requisitos: usa al menos 10 caracteres.";
  if (/rate limit|too many/i.test(message)) return "Demasiados intentos. Espera unos minutos y vuelve a probar.";
  if (/valid email/i.test(message)) return "Escribe un correo válido.";
  return message;
}

/** Remap html/body selectors to the shadow content id (same trick as the
 *  editor's frameCapture.mapBodySelectors, parameterized by scope). */
function mapBodySelectorsTo(css: string, scope: string): string {
  return css
    .replace(/([{}]\s*|,\s*|^\s*)html\b/gm, `$1${scope}`)
    .replace(/([{}]\s*|,\s*|^\s*)body\b/gm, `$1${scope}`)
    .replace(/(\s)html\b/g, `$1${scope}`)
    .replace(/(\s)body\b/g, `$1${scope}`);
}

function extractFontImports(css: string): string[] {
  const hrefs: string[] = [];
  const re = /@import\s+url\(['"]?(https?:\/\/[^'"]+)['"]?\)/g;
  let m;
  while ((m = re.exec(css)) !== null) hrefs.push(sanitizeGoogleFontUrl(m[1]));
  return hrefs;
}

/** One design frame rendered in its own shadow root — the static cousin of
 *  DesignFrame: fonts in, user CSS remapped, innerHTML dropped in, done. */
function StaticFrame({ frame, scopeId }: { frame: GateFrame; scopeId: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || host.shadowRoot) return;
    const shadow = host.attachShadow({ mode: "open" });
    for (const href of extractFontImports(frame.css)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      shadow.appendChild(link);
    }
    const style = document.createElement("style");
    style.textContent = `#${scopeId} { width: 100%; height: 100%; overflow: hidden; }\n${mapBodySelectorsTo(frame.css, `#${scopeId}`)}`;
    shadow.appendChild(style);
    const content = document.createElement("div");
    content.id = scopeId;
    content.innerHTML = frame.html;
    content.style.position = "relative";
    content.style.zIndex = "2";
    content.style.background = frame.background || "transparent";
    shadow.appendChild(content);
  }, [frame, scopeId]);

  return (
    <div
      ref={hostRef}
      title={frame.name}
      style={{
        position: "absolute",
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: frame.height,
        overflow: "hidden",
        boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
        borderRadius: 6,
      }}
    />
  );
}

export function SharedDesignGate({ templateId }: { templateId: string }): JSX.Element {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [template, setTemplate] = useState<GateTemplate | null>(null);
  const [comments, setComments] = useState<GateComment[]>([]);

  // Composer
  const [pin, setPin] = useState<{ x: number; y: number } | null>(null);
  const [body, setBody] = useState("");
  const [sendToKanban, setSendToKanban] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sentKind, setSentKind] = useState<"comment" | "kanban" | null>(null);

  // Auth modal
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);

  // Board fit
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });

  const displayName = useMemo(() => {
    const meta = (user?.user_metadata || {}) as Record<string, unknown>;
    const name = typeof meta.full_name === "string" ? meta.full_name.trim() : "";
    if (name) return name;
    const emailAddr = typeof user?.email === "string" ? user.email : "";
    return emailAddr ? emailAddr.split("@")[0] : "";
  }, [user]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setIsPrivate(false);
    try {
      const res = await fetch(`/api/comments-share/${encodeURIComponent(templateId)}`);
      const payload = await res.json();
      if (!res.ok || !payload.success || !payload.data) {
        if (payload?.code === "PRIVATE") {
          setIsPrivate(true);
        } else {
          setLoadError(res.status === 404 ? "Este diseño no existe o ya no está compartido." : (payload.error || "No se pudo cargar el diseño."));
        }
        return;
      }
      const data = payload.data as { template: GateTemplate; comments: GateComment[] };
      setTemplate(data.template);
      setComments(data.comments || []);
    } catch {
      setLoadError("Error de conexión. Revisa tu internet e intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => { void load(); }, [load]);

  // Track the canvas viewport so the board scales to fit whatever screen the
  // guest arrived from (phone, tablet, laptop). Measure directly on mount +
  // window resizes too: ResizeObserver alone reports 0 in prerender/hidden
  // contexts, and a 0 viewport must never scale the board to nothing.
  useEffect(() => {
    const measure = () => {
      const el = viewportRef.current;
      if (el && el.clientWidth > 0) setViewport({ w: el.clientWidth, h: el.clientHeight });
    };
    measure();
    window.addEventListener("resize", measure);
    const settle = window.setTimeout(measure, 250);
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined" && viewportRef.current) {
      observer = new ResizeObserver(entries => {
        const rect = entries[0]?.contentRect;
        if (rect && rect.width > 0) setViewport({ w: rect.width, h: rect.height });
      });
      observer.observe(viewportRef.current);
    }
    return () => {
      window.removeEventListener("resize", measure);
      window.clearTimeout(settle);
      observer?.disconnect();
    };
  }, []);

  // With the editor "already open" in front of them, the guest's one job is
  // to get past the gate. Google is the one-tap path: OAuth round-trips back
  // to this exact URL, so the page re-renders straight into the unblurred
  // editor — no dashboard, no onboarding, no other screen.
  const continueWithGoogle = async () => {
    setGoogleBusy(true);
    setAuthError(null);
    setAuthMessage(null);
    try {
      const { client } = await initializeBrowserSupabase();
      if (!client) {
        setAuthError("El acceso no está configurado en este servidor.");
        return;
      }
      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.href },
      });
      if (error) setAuthError(friendlyAuthError(error.message));
      // On success the browser leaves for Google; nothing else runs here.
    } finally {
      setGoogleBusy(false);
    }
  };

  const submitEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (authBusy) return;
    setAuthBusy(true);
    setAuthError(null);
    setAuthMessage(null);
    try {
      const { client } = await initializeBrowserSupabase();
      if (!client) {
        setAuthError("El acceso no está configurado en este servidor.");
        return;
      }
      const result = authMode === "signin"
        ? await client.auth.signInWithPassword({ email: email.trim(), password })
        : await client.auth.signUp({
            email: email.trim(),
            password,
            options: { data: { full_name: "" }, emailRedirectTo: window.location.href },
          });
      if (result.error) {
        setAuthError(friendlyAuthError(result.error.message));
      } else if (authMode === "signup" && !result.data.session) {
        setAuthMessage("Cuenta creada. Confirma tu correo y este editor se desbloqueará solo.");
      }
      // Sessions (password sign-in, confirmed signup, other tab) flow through
      // onAuthStateChange in AuthProvider: `user` flips and the gate lifts.
    } finally {
      setAuthBusy(false);
    }
  };

  const handleBoardTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!user) return; // the modal owns the screen until they are in
    const rect = e.currentTarget.getBoundingClientRect();
    setPin({
      x: clampPct(((e.clientX - rect.left) / rect.width) * 100),
      y: clampPct(((e.clientY - rect.top) / rect.height) * 100),
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !user) return;
    const text = body.trim();
    if (!text) { setFormError("Escribe un comentario antes de enviar."); return; }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/comments-share/${encodeURIComponent(templateId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: text,
          authorName: displayName || undefined,
          xPct: pin?.x ?? 50,
          yPct: pin?.y ?? 50,
          createKanbanTask: sendToKanban,
        }),
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) {
        setFormError(payload.error || "No se pudo guardar el comentario.");
        return;
      }
      const created = payload.data?.comment as GateComment | undefined;
      const kanbanTaskId = payload.data?.kanbanTask?.id as string | undefined;
      if (created) {
        const withTask = kanbanTaskId ? { ...created, kanban_task_id: kanbanTaskId } : created;
        setComments(prev => [withTask, ...prev.filter(c => c.id !== created.id)]);
      }
      setBody("");
      setPin(null);
      setSentKind(kanbanTaskId ? "kanban" : "comment");
      window.setTimeout(() => setSentKind(null), 5000);
    } catch {
      setFormError("Error de conexión. Tu comentario no se guardó — intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Board geometry: real frame positions, scaled to fit the viewport ──
  const bounds = useMemo(() => {
    const frames = template?.frames || [];
    if (!frames.length) return null;
    const minX = Math.min(...frames.map(f => f.x));
    const minY = Math.min(...frames.map(f => f.y));
    const maxX = Math.max(...frames.map(f => f.x + f.width));
    const maxY = Math.max(...frames.map(f => f.y + f.height));
    return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }, [template]);

  // No frames (e.g. legacy canvas-only designs) still deserves a board: fall
  // back to the template size and show the thumbnail instead.
  const boardSize = useMemo(() => {
    if (bounds) return { w: bounds.w, h: bounds.h };
    if (template) return { w: template.width, h: template.height };
    return null;
  }, [bounds, template]);

  const scale = useMemo(() => {
    if (!boardSize) return 0;
    // Window fallbacks keep the design visible when the canvas hasn't been
    // measured yet (hidden panel, first paint on slow phones).
    const availW = viewport.w || Math.max(320, window.innerWidth - 140);
    const availH = viewport.h || Math.max(320, window.innerHeight - 160);
    const fit = Math.min(availW / boardSize.w, availH / boardSize.h);
    return Math.max(0.02, Math.min(fit * 0.94, 1.5));
  }, [boardSize, viewport]);

  const signedIn = Boolean(user);

  return (
    <div className="editor-v2-root sg-root">
      {/* ── Top bar (editor lookalike) ── */}
      <header className="editor-v2-topbar">
        <div className="sg-brand" aria-hidden="true">
          <span className="sg-brand-mark">M</span>
          <span className="sg-brand-name">Musa <em>by Futuraria</em></span>
        </div>
        <span className="editor-v2-topbar-sep" />
        <span className="editor-v2-project-name">{template?.name || (loading ? "Cargando…" : "Diseño compartido")}</span>
        <span className="editor-v2-saving">solo lectura</span>
        <div style={{ flex: 1 }} />
        <div className="sg-topbar-tools" aria-hidden="true">
          <span className="editor-v2-topbar-icon-btn" style={{ cursor: "default" }}><SgIconCursor /></span>
          <span className="editor-v2-topbar-icon-btn" style={{ cursor: "default" }}><SgIconSquare /></span>
          <span className="editor-v2-topbar-icon-btn" style={{ cursor: "default" }}><SgIconText /></span>
          <span className="editor-v2-topbar-icon-btn" style={{ cursor: "default" }}><SgIconComment /></span>
        </div>
        <span className="editor-v2-topbar-sep" />
        {signedIn ? (
          <span className="sg-user-chip" title={user?.email || ""}>
            <span className="sg-user-dot" />
            Comentando como <strong>{displayName || "ti"}</strong>
          </span>
        ) : (
          <span className="sg-user-chip sg-user-chip-guest"><SgIconLock /> Invitado</span>
        )}
      </header>

      <div className="editor-v2-main">
        {/* ── Left tool rail (decoration: sells the editor illusion) ── */}
        <div className="sg-rail" aria-hidden="true">
          <span className="sg-rail-btn active"><SgIconCursor /></span>
          <span className="sg-rail-btn"><SgIconFrame /></span>
          <span className="sg-rail-btn"><SgIconSquare /></span>
          <span className="sg-rail-btn"><SgIconText /></span>
          <span className="sg-rail-btn"><SgIconComment /></span>
        </div>

        {/* ── Canvas: the real design, blurred behind the gate ── */}
        <div className="editor-v2-canvas-area" ref={viewportRef}>
          {loading && <p className="sg-center-note" role="status">Cargando diseño…</p>}

          {!loading && loadError && (
            <div className="sg-center-note sg-center-card">
              <p className="sg-error" role="alert">{loadError}</p>
              <button type="button" className="sg-btn-secondary" onClick={() => void load()}>Reintentar</button>
            </div>
          )}

          {!loading && !loadError && isPrivate && !signedIn && (
            // Private design, guest session: same gate, honest message —
            // signing in is still what an owner/team member would do here.
            <GateModal
              title="Este diseño es privado"
              copy="Pide a su autor que lo haga público para verlo. Si tú eres el autor, entra con tu cuenta para abrirlo en el editor."
            >
              {authFields(googleBusy, continueWithGoogle, authMode, setAuthMode, email, setEmail, password, setPassword, authBusy, submitEmailAuth, authError, authMessage)}
            </GateModal>
          )}

          {!loading && !loadError && isPrivate && signedIn && (
            <div className="sg-center-note sg-center-card">
              <p className="sg-error" role="alert">Este diseño es privado.</p>
              <p className="sg-muted">Tu cuenta no tiene acceso a este enlace.</p>
              <button
                type="button"
                className="sg-btn"
                onClick={() => { window.location.href = `/?template=${encodeURIComponent(templateId)}`; }}
              >
                Abrir en el editor
              </button>
            </div>
          )}

          {!loading && !loadError && !isPrivate && template && (
            <div
              className="sg-viewport"
              style={{ width: boardSize ? boardSize.w * scale : undefined, height: boardSize ? boardSize.h * scale : undefined }}
            >
              <div
                className={`sg-board${signedIn ? "" : " sg-board-locked"}`}
                style={{
                  width: boardSize ? boardSize.w : undefined,
                  height: boardSize ? boardSize.h : undefined,
                  transform: boardSize ? `scale(${scale})` : undefined,
                  background: template.background || "#101018",
                  cursor: signedIn ? "crosshair" : "default",
                }}
                onClick={handleBoardTap}
                role={signedIn ? "button" : undefined}
                aria-label={signedIn ? "Toca el diseño para colocar tu comentario" : undefined}
              >
                {template.frames.length > 0 && bounds
                  ? template.frames.map(frame => (
                      <StaticFrame key={frame.id} frame={{ ...frame, x: frame.x - bounds.x, y: frame.y - bounds.y }} scopeId={`sg_frame_${frame.id.replace(/[^a-zA-Z0-9_-]/g, "")}`} />
                    ))
                  : template.thumbnail && (
                      <img className="sg-thumbnail" src={template.thumbnail} alt={template.name} />
                    )}
                {signedIn && pin && (
                  <span className="mc-pin" style={{ left: `${pin.x}%`, top: `${pin.y}%` }}>
                    <span className="mc-pin-num">{comments.length + 1}</span>
                  </span>
                )}
              </div>
              {!signedIn && (
                <GateModal
                  title="Ingresa para ver este diseño"
                  copy="Este diseño es privado. Entra con tu cuenta — o créala en un toque con Google — para verlo y dejar tus comentarios."
                >
                  {authFields(googleBusy, continueWithGoogle, authMode, setAuthMode, email, setEmail, password, setPassword, authBusy, submitEmailAuth, authError, authMessage)}
                </GateModal>
              )}
            </div>
          )}
        </div>

        {/* ── Right panel: comments (live once inside) ── */}
        <aside className="editor-v2-layers-panel sg-panel">
          <div className="sg-panel-head">
            <strong>Comentarios</strong>
            {template && <span className="sg-panel-sub">{template.name}</span>}
          </div>

          {signedIn ? (
            <form className="sg-form" onSubmit={handleSubmit}>
              <p className="sg-hint">
                {pin ? `Pin en ${Math.round(pin.x)}% / ${Math.round(pin.y)}% — toca otro punto para moverlo.` : "Toca el diseño para marcar de qué parte hablas."}
              </p>
              <textarea
                className="sg-input"
                placeholder="¿Qué cambiarías o añadirías?"
                value={body}
                maxLength={500}
                rows={3}
                onChange={e => setBody(e.target.value)}
              />
              <label className="sg-check">
                <input type="checkbox" checked={sendToKanban} onChange={e => setSendToKanban(e.target.checked)} />
                <span>Añadir al Kanban<em>Tu IA aplicará este comentario como tarea.</em></span>
              </label>
              {formError && <p className="sg-error" role="alert">{formError}</p>}
              {sentKind && (
                <p className="sg-ok" role="status">
                  {sentKind === "kanban" ? "Comentario guardado y añadido al Kanban." : "Comentario guardado."}
                </p>
              )}
              <button type="submit" className="sg-btn" disabled={submitting}>{submitting ? "Enviando…" : "Enviar comentario"}</button>
            </form>
          ) : (
            <p className="sg-hint sg-panel-locked-note">Entra con tu cuenta para dejar comentarios.</p>
          )}

          <div className="sg-list" aria-label="Comentarios existentes">
            <h3 className="sg-list-title">
              {comments.length > 0 ? `${comments.length} comentario${comments.length === 1 ? "" : "s"}` : "Todavía no hay comentarios — sé el primero."}
            </h3>
            {comments.map(c => (
              <article key={c.id} className="sg-comment">
                <div className="sg-comment-head">
                  <span className="sg-comment-author">{c.author_name}</span>
                  {c.kanban_task_id && <span className="sg-badge">Kanban ✓</span>}
                  {c.status !== "open" && <span className="sg-badge sg-badge-muted">{c.status === "resolved" ? "Resuelto" : "Archivado"}</span>}
                  <time className="sg-comment-date">{new Date(c.created_at).toLocaleDateString("es", { day: "numeric", month: "short" })}</time>
                </div>
                <p className="sg-comment-body">{c.body}</p>
              </article>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** The auth modal body — Google first, email inline below. */
function authFields(
  googleBusy: boolean,
  onGoogle: () => void,
  authMode: "signin" | "signup",
  setAuthMode: (m: "signin" | "signup") => void,
  email: string,
  setEmail: (v: string) => void,
  password: string,
  setPassword: (v: string) => void,
  authBusy: boolean,
  onEmailSubmit: (e: React.FormEvent) => void,
  authError: string | null,
  authMessage: string | null,
): JSX.Element {
  return (
    <div className="sg-auth">
      <button type="button" className="sg-google" onClick={onGoogle} disabled={googleBusy}>
        <SgGoogleMark />
        {googleBusy ? "Abriendo Google…" : "Continuar con Google"}
      </button>
      <div className="sg-or"><span>o con tu correo</span></div>
      <form className="sg-email" onSubmit={onEmailSubmit}>
        <input
          className="sg-input"
          type="email"
          autoComplete="email"
          placeholder="tucorreo@ejemplo.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
        />
        <input
          className="sg-input"
          type="password"
          minLength={10}
          autoComplete={authMode === "signin" ? "current-password" : "new-password"}
          placeholder={authMode === "signin" ? "Tu contraseña" : "Crea una contraseña (10+ caracteres)"}
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
        />
        {authError && <p className="sg-error" role="alert">{authError}</p>}
        {authMessage && <p className="sg-ok" role="status">{authMessage}</p>}
        <button type="submit" className="sg-btn" disabled={authBusy}>
          {authBusy ? "Procesando…" : authMode === "signin" ? "Entrar" : "Crear cuenta"}
        </button>
      </form>
      <button
        type="button"
        className="sg-switch"
        onClick={() => setAuthMode(authMode === "signin" ? "signup" : "signin")}
      >
        {authMode === "signin" ? "¿Nuevo aquí? Crea tu cuenta" : "¿Ya tienes cuenta? Inicia sesión"}
      </button>
    </div>
  );
}

/** Modal shell — floats over the blurred canvas, never navigates away. */
function GateModal({ title, copy, children }: { title: string; copy: string; children: JSX.Element }): JSX.Element {
  return (
    <div className="sg-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sg-modal-card">
        <div className="sg-brand sg-modal-brand" aria-hidden="true">
          <span className="sg-brand-mark">M</span>
          <span className="sg-brand-name">Musa <em>by Futuraria</em></span>
        </div>
        <h1 className="sg-modal-title">{title}</h1>
        <p className="sg-modal-copy">{copy}</p>
        {children}
      </div>
    </div>
  );
}

// ── Tiny inline icon set (decoration only) ──
function SgIconCursor() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 3l7 17 2.5-7.5L21 10z" /></svg>;
}
function SgIconFrame() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 3v18M17 3v18M3 7h18M3 17h18" /></svg>;
}
function SgIconSquare() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>;
}
function SgIconText() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 5h14M12 5v14" /></svg>;
}
function SgIconComment() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z" /></svg>;
}
function SgIconLock() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;
}
function SgGoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.3 0 10.1-2 13.7-5.3l-6.3-5.4C29.3 34.9 26.8 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.6 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.3 5.4C36.9 40.4 44 35 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  );
}
