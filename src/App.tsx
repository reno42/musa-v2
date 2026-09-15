import { lazy, Suspense, useCallback, useEffect, useReducer, useState } from "react";
import { Landing } from "./components/Landing";
import { AgentsLanding } from "./components/AgentsLanding";
import { Dashboard, NAV_SECTIONS, startupShellFor } from "./components/Dashboard";
// EditorV2 lazy: the whole editor (thousands of lines plus its glue) lived in
// the main chunk, so every dashboard refresh parsed it before first paint.
// pdf/pptx/onnx were already split into their own chunks — the editor itself
// was not. This moves it out; the dashboard's first paint parses far less JS.
const EditorV2 = lazy(() =>
  import("./pages/EditorV2").then(m => ({ default: m.EditorV2 })),
);
import { ChatFAB } from "./components/ChatFAB";
import { SharedDesignGate } from "./components/SharedDesignGate";
import { NdaAcceptance } from "./components/NdaAcceptance";
import { resolveAccountName } from "./lib/accountName";
import { MusaOnboarding } from "./components/MusaOnboarding";
import { PersonalizedOnboardingPlan } from "./components/PersonalizedOnboardingPlan";
import { restartOnboarding } from "./components/OnboardingTour";
import { useToast } from "./components/Toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { getApiHeaders } from "./lib/apiKey";
import { apiFetch } from "./lib/supabase";
import { readAccountCheckCache, writeAccountCheckCache } from "./lib/accountCheckCache";
import { type AppRoute, readAppRoute, routeRequiresAccount } from "./lib/appRoute";
import { useAuth } from "./lib/auth";
import { saveCurrentRoute, getLastRoute, setPendingRedirect, resolvePostLoginUrl } from "./lib/routePersistence";
import {
  AuthConfigurationScreen,
  AuthScreen,
  InvitationGate,
  PasswordUpdateScreen,
} from "./components/AuthScreen";

type ViewMode = "booting" | "landing" | "agents-landing" | "dashboard" | "editor-v2";

type AppState = {
  view: ViewMode;
  templateId: string | null;
};

type AppAction =
  | { type: "SET_VIEW"; view: ViewMode }
  | { type: "OPEN_TEMPLATE_V2"; id: string }
  | { type: "ENTER_WORKSPACE" };

type ResolvedSlug = {
  templateId?: string;
};

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_VIEW":
      return { ...state, view: action.view };
    case "OPEN_TEMPLATE_V2":
      return { ...state, view: "editor-v2", templateId: action.id };
    case "ENTER_WORKSPACE":
      return { ...state, view: "dashboard", templateId: null };
    default:
      return state;
  }
}

function stateForRoute(route: AppRoute): AppState {
  if (route.kind === "template") {
    return { view: "editor-v2", templateId: route.templateId };
  }
  if (route.kind === "workspace") {
    return { view: "dashboard", templateId: null };
  }
  if (route.kind === "agents") {
    return { view: "agents-landing", templateId: null };
  }
  return { view: "booting", templateId: null };
}

async function resolveWorkspaceSlug(
  route: Extract<AppRoute, { kind: "workspace-slug" }>,
): Promise<ResolvedSlug | null> {
  const workspaceSlug = encodeURIComponent(route.workspaceSlug);
  const url = route.templateSlug
    ? `/api/resolve/workspace/${workspaceSlug}/${encodeURIComponent(route.templateSlug)}`
    : `/api/resolve/workspace/${workspaceSlug}`;

  try {
    const response = await fetch(url, { headers: getApiHeaders() });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload.success ? payload.data as ResolvedSlug : null;
  } catch {
    return null;
  }
}

function AppStartupScreen(): JSX.Element {
  const { user } = useAuth();
  // Resolve where the user is heading from the URL hash: a refresh inside a
  // sub-section paints THAT section's real card, so the wait reads as the app
  // already loaded in place (perceived speed, zero invented UI).
  const route = readAppRoute(window.location);
  const shell = route.kind === "workspace" ? startupShellFor(route.tab, route.pane) : null;
  const activeTabId = shell?.tab ?? "diseno";
  const activePaneId = shell?.pane ?? "";
  const accountName = resolveAccountName({ metadataName: user?.user_metadata?.full_name || user?.user_metadata?.name, email: user?.email }) || "Cuenta";
  const initial = accountName === "Cuenta" ? "?" : accountName[0].toUpperCase();
  return (
    // Real navbar, real classes (dash-header / landing-brand / dash-tab-pill /
    // liquid-glass / crm-table-card / crm-contacts-head): identical to the
    // Dashboard shell about to replace it. aria-hidden — it is a mirror, not
    // interactive: actions wait for the real dashboard behind the auth/NDA
    // gate. The solid background also covers ChatFAB while the lazy editor
    // chunk loads.
    <main className="app-startup" aria-busy="true" style={{ display: "block", padding: 0, overflowY: "auto", background: "radial-gradient(1200px 700px at 50% 35%, rgba(99,102,241,0.08), transparent 60%), #0b0b0e" }}>
      <style>{"@keyframes startupPulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }"}</style>
      <div className="dash-header" aria-hidden="true" style={{ padding: "24px 24px 0", background: "transparent", position: "relative", width: "100%", display: "flex", justifyContent: "center" }}>
        <div className="landing-nav-inner" style={{ maxWidth: 1200, width: "100%", position: "relative" }}>
          <div className="landing-brand" style={{ flexShrink: 0 }}>
            <span>Musa <span style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", opacity: 0.55, fontWeight: 500 }}>by Futuraria</span></span>
          </div>
          <div className="dash-nav-tabs" style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "center", flex: 1 }}>
            {NAV_SECTIONS.map(section => (
              <div key={section.id} className={section.id === activeTabId ? "dash-tab-pill dash-tab-active" : "dash-tab-pill dash-tab"} style={{ position: "relative", borderRadius: 100, display: "flex", alignItems: "center" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 500, padding: "8px 4px 8px 18px" }}>{section.icon} {section.label}</span>
                <span style={{ display: "flex", alignItems: "center", padding: "8px 14px 8px 2px", opacity: 0.75 }}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ display: "block" }}><path d="M2 3l3 4 3-4" /></svg>
                </span>
              </div>
            ))}
          </div>
          <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <div className="liquid-glass" style={{ borderRadius: 100, padding: "8px 12px", fontSize: 12, fontWeight: 500, display: "flex", alignItems: "center", gap: 6, color: "rgba(255,255,255,0.8)", maxWidth: 140 }}>
              <span style={{ width: 22, height: 22, borderRadius: "50%", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{initial}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{accountName}</span>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ display: "block" }}><path d="M2 3l3 4 3-4" /></svg>
            </div>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "20px 24px 0", height: "calc(100vh - 100px)" }}>
        {shell ? (
          <div className="crm-table-card crm-contacts-top" style={{ flexShrink: 0 }} aria-hidden="true">
            <header className="crm-contacts-head">
              <div>
                <h1>{shell.title}</h1>
                {shell.description ? <p>{shell.description}</p> : null}
              </div>
              {shell.panes.length > 0 && (
                <div className="crm-nav-tabs" role="presentation">
                  {shell.panes.map(p => (
                    <span key={p.id} title={p.label} className={p.id === activePaneId ? "crm-nav-tab active" : "crm-nav-tab"}>{p.icon}</span>
                  ))}
                </div>
              )}
            </header>
          </div>
        ) : (
          <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "8vh 0 0" }}>
            <div className="app-startup-brand" aria-hidden="true">
              <span className="app-startup-mark">M</span>
              <span>Musa <span style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", opacity: 0.55, fontWeight: 500 }}>by Futuraria</span></span>
            </div>
          </div>
        )}
        <div style={{ flex: 1, minHeight: 220, borderRadius: 16, border: "1px solid rgba(255,255,255,0.09)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24 }}>
          <p className="app-startup-status" role="status" style={{ margin: 0 }}>Abriendo tu espacio de trabajo…</p>
          <div style={{ display: "flex", gap: 10, width: "min(420px, 80%)" }}>
            {[0, 1, 2].map(i => (
              <span key={i} style={{ flex: 1, height: 10, borderRadius: 999, background: "rgba(255,255,255,0.10)", animation: `startupPulse 1.4s ease-in-out ${i * 0.18}s infinite` }} />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

function App(): JSX.Element {
  const {
    configured: authConfigured,
    authRequired,
    configurationError,
    loading: authLoading,
    user,
    workspaceId,
    passwordRecovery,
    needsPasswordSetup,
    completePasswordRecovery,
    signOut,
  } = useAuth();
  const [route, setRoute] = useState<AppRoute>(() => readAppRoute(window.location));
  const [state, dispatch] = useReducer(appReducer, route, stateForRoute);
  const { addToast } = useToast();
  const { view, templateId } = state;
  // null = not yet checked, true = needs onboarding, false = already done
  const [onboardingNeeded, setOnboardingNeeded] = useState<boolean | null>(null);
  // null = not yet checked, true = NDA wall pending, false = accepted
  const [ndaRequired, setNdaRequired] = useState<boolean | null>(null);
  // v-fix: /account/me inalcanzable tras los reintentos acotados. Distinto de
  // "pendiente": no hacemos pasar la pared NDA por un acuerdo que ya pudo
  // estar aceptado — pantalla honesta de verificación fallida + reintento.
  const [accountCheckFailed, setAccountCheckFailed] = useState(false);

  // ── Check if this is a first-time user who needs Musa onboarding ──
  // The same /account/me call resolves the NDA wall: an account without
  // nda_accepted_at must accept the Alfa Access Agreement before any
  // workspace/editor view renders.
  const checkOnboarding = useCallback(async () => {
    if (!user) { setOnboardingNeeded(null); setNdaRequired(null); setAccountCheckFailed(false); return; }
    // Stale-while-revalidate seed: this tab already got a CONFIRMED verdict
    // earlier in the session, so enter the app now and let the check below
    // correct us when the API answers. Only accepted-NDA verdicts seed — a
    // pending account always goes through the real check, never the cache.
    const cached = readAccountCheckCache(user.id);
    if (cached && !cached.ndaRequired) {
      setNdaRequired(false);
      setOnboardingNeeded(cached.onboardingNeeded);
    }
    // The shared apiFetch (lib/supabase) has an EMPTY base — unlike
    // Dashboard's local helper, the /api prefix must be part of the path.
    // A brand-new signup can race /account/bootstrap (profile row not created
    // yet), and Supabase can have a brief cold-start hiccup. The shared helper
    // deduplicates this read and performs only two bounded transport retries.
    // A successful response with no profile is a different case: wait briefly
    // for bootstrap and poll twice without multiplying infrastructure retries.
    try {
      for (let profileAttempt = 0; profileAttempt < 3; profileAttempt++) {
        const res = await apiFetch<any>("/api/account/me", { retries: profileAttempt === 0 ? 2 : 0 });
        const d = res?.data;
        if (d) {
          // Wall only when the profile columns exist (v30 applied). Without
          // the migration the gate stays open — no lockouts on stale DBs.
          const ndaColumnsMissing = res?.profileFieldsAvailable === false;
          const ndaPending = !ndaColumnsMissing && d.nda_accepted_at == null;
          const onboardingPending = !ndaColumnsMissing && d.personalized_onboarding_completed !== true;
          setNdaRequired(ndaPending);
          // The personalized plan is intentionally its own once-per-account
          // milestone. Existing accounts already completed the old welcome
          // flow, so tying this to onboarding_completed would hide it forever.
          setOnboardingNeeded(onboardingPending);
          // Confirmed verdict: a later refresh in this tab can enter directly
          // when the API blips (see the seed above).
          writeAccountCheckCache(user.id, { ndaRequired: ndaPending, onboardingNeeded: onboardingPending });
          return;
        }
        if (profileAttempt < 2) {
          await new Promise(resolve => setTimeout(resolve, profileAttempt === 0 ? 600 : 1_000));
        }
      }
    } catch {
      // Fall through to the protective default after bounded retries.
    }
    if (cached) {
      // Unverifiable right now, but this session already had a CONFIRMED
      // verdict: the seed stands and the user keeps working — a transient
      // API blip must not lock out a verified tab. accountCheckFailed was
      // never set, so there is nothing to roll back.
      return;
    }
    // Account state unverifiable after bounded retries: the platform stays
    // closed (ndaRequired never becomes false without a CONFIRMED profile),
    // but we no longer impersonate the NDA wall — an accepted agreement must
    // not look pending just because the API is down. Honest retry screen.
    setAccountCheckFailed(true);
    setOnboardingNeeded(false);
  }, [user]);

  useEffect(() => { void checkOnboarding(); }, [checkOnboarding]);

  const handleOnboardingComplete = useCallback((startTour: boolean) => {
    setOnboardingNeeded(false);
    if (startTour) {
      restartOnboarding();
    }
  }, []);

  const handleNdaAccepted = useCallback(() => {
    // Acceptance is already persisted server-side; just drop the wall.
    // Route state survives, so the user lands where they were going.
    setNdaRequired(false);
    // Refresh the session verdict so a reload seconds later enters directly
    // instead of facing the wall again on an API blip.
    if (user) writeAccountCheckCache(user.id, { ndaRequired: false, onboardingNeeded: onboardingNeeded === true });
  }, [user, onboardingNeeded]);

  const showLanding = () => {
    window.history.replaceState(null, "", "/");
    setRoute({ kind: "root" });
    dispatch({ type: "SET_VIEW", view: "landing" });
  };

  // La Llamada: la página para IAs vive en /#agents. Pública — se muestra con
  // o sin sesión; el toggle "Humanos" regresa via showLanding.
  const showAgentsLanding = () => {
    window.history.pushState(null, "", "/#agents");
    setRoute({ kind: "agents" });
    dispatch({ type: "SET_VIEW", view: "agents-landing" });
  };

  // Only way out of the NDA wall without accepting.
  const handleNdaSignOut = async () => {
    await signOut();
    showLanding();
  };

  const enterWorkspace = () => {
    window.history.replaceState(null, "", "/#workspace");
    saveCurrentRoute();
    setRoute({ kind: "workspace" });
    dispatch({ type: "ENTER_WORKSPACE" });
  };

  const openTemplate = (id: string, url: string) => {
    window.history.replaceState(null, "", url);
    saveCurrentRoute();
    setRoute({ kind: "template", templateId: id });
    dispatch({ type: "OPEN_TEMPLATE_V2", id });
  };

  // ── Persist route on every navigation ──
  useEffect(() => {
    saveCurrentRoute();
  }, [route]);

  useEffect(() => {
    if (authLoading) return;

    if (route.kind === "agents") {
      dispatch({ type: "SET_VIEW", view: "agents-landing" });
      return;
    }

    if (route.kind === "root") {
      if (user) {
        // ── Page persistence: restore last route instead of always going to dashboard ──
        // Covers both the editor (?template=…) and a dashboard tab
        // (#workspace/<tab>); previously only the editor was restored, so
        // landing on "/" always dropped the user back on Archivos.
        const lastRoute = getLastRoute();
        const restorable = !!lastRoute
          && lastRoute !== "/#workspace"
          && (lastRoute.includes("template=") || lastRoute.includes("#workspace/"));
        if (restorable) {
          window.history.replaceState(null, "", lastRoute!);
          const restored = readAppRoute(window.location);
          setRoute(restored);
          const ns = stateForRoute(restored);
          if (ns.view === "editor-v2" && ns.templateId) {
            dispatch({ type: "OPEN_TEMPLATE_V2", id: ns.templateId });
          } else {
            dispatch({ type: "ENTER_WORKSPACE" });
          }
        } else {
          window.history.replaceState(null, "", "/#workspace");
          setRoute({ kind: "workspace" });
          dispatch({ type: "ENTER_WORKSPACE" });
        }
      } else {
        dispatch({ type: "SET_VIEW", view: "landing" });
      }
      return;
    }

    if (route.kind !== "workspace-slug") return;
    if (authRequired && !authConfigured) return;
    if (authConfigured && !user) return;

    let active = true;
    void resolveWorkspaceSlug(route).then((resolved) => {
      if (!active) return;
      if (resolved?.templateId) {
        setRoute({ kind: "template", templateId: resolved.templateId });
        dispatch({ type: "OPEN_TEMPLATE_V2", id: resolved.templateId });
      } else {
        setRoute({ kind: "workspace" });
        dispatch({ type: "ENTER_WORKSPACE" });
      }
    });

    return () => {
      active = false;
    };
  }, [authConfigured, authLoading, authRequired, route, user]);

  const handleCreateHtmlTemplate = async (
    workspaceId: string,
    name: string,
    opts?: { width?: number; height?: number; initialFrame?: boolean },
  ) => {
    try {
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: getApiHeaders(),
        // REQ-022: forward the popup's choice — custom dimensions for the first
        // frame, or initialFrame:false for a zero-frame file.
        body: JSON.stringify({
          workspaceId,
          name,
          width: opts?.width ?? 1080,
          height: opts?.height ?? 1080,
          engine: "html",
          initialFrame: opts?.initialFrame !== false,
        }),
      });
      const payload = await response.json();
      if (payload.success && payload.data) {
        openTemplate(payload.data.id, `/?template=${payload.data.id}&v=2`);
      } else {
        addToast("No se pudo crear la plantilla. Intenta de nuevo.", "error");
      }
    } catch {
      addToast("Error al crear la plantilla. Verifica tu conexión.", "error");
    }
  };

  const handleSelectTemplate = (
    id: string,
    slugInfo?: { wsSlug?: string; tplSlug?: string },
  ) => {
    const url = slugInfo?.wsSlug && slugInfo.tplSlug
      ? `/w/${encodeURIComponent(slugInfo.wsSlug)}/${encodeURIComponent(slugInfo.tplSlug)}`
      : `/?template=${id}&v=2`;
    openTemplate(id, url);
  };

  if (authLoading) return <AppStartupScreen />;

  // ── Página para IAs (#agents): pública, igual que comment-share ──
  // Debe renderizarse ANTES de cualquier muro de auth/NDA: un agente sin
  // sesión — o un humano logueado con la API caída — tiene que poder leer
  // La Llamada siempre. No depende de ningún dato de cuenta.
  if (route.kind === "agents") {
    return (
      <ErrorBoundary>
        <AgentsLanding onEnter={enterWorkspace} onOpenHuman={showLanding} />
      </ErrorBoundary>
    );
  }

  // ── Public comment share page: /c/:templateId ──
  // Guests land here from a share link (phone, client, teammate). No account
  // needed to RENDER the gate — SharedDesignGate shows the editor lookalike
  // with the design blurred and lifts it in place once a session exists.
  if (route.kind === "comment-share") {
    return (
      <ErrorBoundary>
        <SharedDesignGate templateId={route.templateId} />
      </ErrorBoundary>
    );
  }

  const inviteToken = route.kind === "invitation" ? route.token : null;
  const authFlowRequiresConfiguration = Boolean(inviteToken) || passwordRecovery;
  const protectedRoute = routeRequiresAccount(route);

  if (
    authRequired
    && !authConfigured
    && (authFlowRequiresConfiguration || protectedRoute)
  ) {
    return (
      <AuthConfigurationScreen
        error={configurationError || "No se pudo configurar Supabase Auth."}
        onBack={showLanding}
      />
    );
  }

  if (passwordRecovery) {
    return (
      <PasswordUpdateScreen
        kind="recovery"
        onComplete={() => {
          completePasswordRecovery();
          const nextRoute = readAppRoute(window.location);
          setRoute(nextRoute);
          const nextState = stateForRoute(nextRoute);
          if (nextState.view === "editor-v2" && nextState.templateId) {
            dispatch({ type: "OPEN_TEMPLATE_V2", id: nextState.templateId });
          } else {
            dispatch({ type: "ENTER_WORKSPACE" });
          }
        }}
      />
    );
  }

  if (needsPasswordSetup) {
    return <PasswordUpdateScreen kind="invitation" onComplete={() => dispatch({ type: "ENTER_WORKSPACE" })} />;
  }

  if (inviteToken && authConfigured) {
    return <InvitationGate token={inviteToken} onBack={showLanding} />;
  }

  if (authConfigured && !user && protectedRoute) {
    // ── Deep-link redirect: save the URL the user wanted so we can return after login ──
    const currentUrl = window.location.pathname + window.location.search + window.location.hash;
    setPendingRedirect(currentUrl);
    return <AuthScreen onBack={showLanding} onAuthSuccess={() => {
      // After login, go to the saved URL, not the dashboard
      const targetUrl = resolvePostLoginUrl();
      window.history.replaceState(null, "", targetUrl);
      const nextRoute = readAppRoute(window.location);
      setRoute(nextRoute);
      const ns = stateForRoute(nextRoute);
      if (ns.view === "editor-v2" && ns.templateId) {
        dispatch({ type: "OPEN_TEMPLATE_V2", id: ns.templateId });
      } else {
        dispatch({ type: "ENTER_WORKSPACE" });
      }
    }} />;
  }

  // ── NDA wall: accounts without a recorded acceptance must accept the
  //    Alfa Access Agreement before any workspace/editor view renders.
  //    While the check is in flight keep the startup screen up so the
  //    dashboard never flashes behind the wall.
  if (authConfigured && user) {
    if (accountCheckFailed) {
      return (
        <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: "#0b0b0e", color: "#fff", textAlign: "center", padding: 24 }}>
          <strong style={{ fontSize: 18 }}>No pudimos verificar tu cuenta</strong>
          <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 13, maxWidth: 440, lineHeight: 1.5 }}>
            La API no respondió tras varios intentos (posible saturación temporal). Tu Acuerdo Alfa sigue
            aceptado — no perdiste acceso. Reintenta en unos segundos.
          </span>
          <button
            type="button"
            onClick={() => { setAccountCheckFailed(false); void checkOnboarding(); }}
            style={{ padding: "10px 22px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.18)", background: "#fff", color: "#000", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            Reintentar
          </button>
        </div>
      );
    }
    if (ndaRequired === null) return <AppStartupScreen />;
    if (ndaRequired) {
      return (
        <ErrorBoundary>
          <NdaAcceptance
            fullName={resolveAccountName({ metadataName: user.user_metadata?.full_name || user.user_metadata?.name, email: user.email })}
            email={user.email || ""}
            onAccepted={handleNdaAccepted}
            onSignOut={handleNdaSignOut}
          />
        </ErrorBoundary>
      );
    }
  }

  if (view === "booting") return <AppStartupScreen />;

  if (view === "landing") {
    return (
      <ErrorBoundary>
        <Landing onEnter={enterWorkspace} onOpenAgents={showAgentsLanding} />
      </ErrorBoundary>
    );
  }

  if (view === "dashboard") {
    return (
      <>
        <ErrorBoundary>
          <Dashboard
            onSelectTemplate={handleSelectTemplate}
            onCreateHtmlTemplate={handleCreateHtmlTemplate}
          />
        </ErrorBoundary>
        <ChatFAB workspaceId={workspaceId ?? undefined} hideFab={onboardingNeeded === true} />
        {onboardingNeeded === false && <PersonalizedOnboardingPlan />}
        {onboardingNeeded === true && (
          <MusaOnboarding onComplete={handleOnboardingComplete} />
        )}
      </>
    );
  }

  return (
    <>
      <ErrorBoundary>
        <Suspense fallback={<AppStartupScreen />}>
          <EditorV2
            templateId={templateId!}
            onBack={enterWorkspace}
            onOpenTemplate={(id) => openTemplate(id, `/?template=${id}&v=2`)}
          />
        </Suspense>
      </ErrorBoundary>
      <ChatFAB workspaceId={workspaceId ?? undefined} templateId={templateId!} hideFab={onboardingNeeded === true} />
      {/* "Tu plan" vive solo en el dashboard: sobre el editor su chip fixed
          z-8000 tapaba los controles bajos del panel derecho (dogfood BUG-1). */}
      {onboardingNeeded === true && (
        <MusaOnboarding onComplete={handleOnboardingComplete} />
      )}
    </>
  );
}

export { App };
