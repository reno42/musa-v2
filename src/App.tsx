import { useCallback, useEffect, useReducer, useState } from "react";
import { Landing } from "./components/Landing";
import { Dashboard } from "./components/Dashboard";
import { EditorV2 } from "./pages/EditorV2";
import { ChatFAB } from "./components/ChatFAB";
import { MobileComments } from "./components/MobileComments";
import { NdaAcceptance } from "./components/NdaAcceptance";
import { MusaOnboarding } from "./components/MusaOnboarding";
import { restartOnboarding } from "./components/OnboardingTour";
import { useToast } from "./components/Toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { getApiHeaders } from "./lib/apiKey";
import { apiFetch } from "./lib/supabase";
import { type AppRoute, readAppRoute, routeRequiresAccount } from "./lib/appRoute";
import { useAuth } from "./lib/auth";
import { saveCurrentRoute, getLastRoute, setPendingRedirect, resolvePostLoginUrl } from "./lib/routePersistence";
import {
  AuthConfigurationScreen,
  AuthScreen,
  InvitationGate,
  PasswordUpdateScreen,
} from "./components/AuthScreen";

type ViewMode = "booting" | "landing" | "dashboard" | "editor-v2";

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
  return (
    <main className="app-startup" aria-busy="true">
      <div className="app-startup-brand" aria-hidden="true">
        <span className="app-startup-mark">M</span>
        <span>Musa <span style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", opacity: 0.55, fontWeight: 500 }}>by Futuraria</span></span>
      </div>
      <p className="app-startup-status" role="status">Abriendo tu espacio de trabajo…</p>
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

  // ── Check if this is a first-time user who needs Musa onboarding ──
  // The same /account/me call resolves the NDA wall: an account without
  // nda_accepted_at must accept the Alfa Access Agreement before any
  // workspace/editor view renders.
  const checkOnboarding = useCallback(async () => {
    if (!user) { setOnboardingNeeded(null); setNdaRequired(null); return; }
    // The shared apiFetch (lib/supabase) has an EMPTY base — unlike
    // Dashboard's local helper, the /api prefix must be part of the path.
    // A brand-new signup can also race /account/bootstrap (profile row not
    // created yet → data: null), so retry briefly before deciding.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await apiFetch<any>("/api/account/me");
        const d = res?.data;
        if (d) {
          // Wall only when the profile columns exist (v30 applied). Without
          // the migration the gate stays open — no lockouts on stale DBs.
          const ndaColumnsMissing = res?.profileFieldsAvailable === false;
          setNdaRequired(!ndaColumnsMissing && d.nda_accepted_at == null);
          setOnboardingNeeded(d.onboarding_completed === false);
          return;
        }
      } catch {
        // Network/server error — retry, then fall through to the default below.
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    // Account state unverifiable: keep the protective wall up ("no
    // acceptance → no platform") and skip the onboarding modal so a broken
    // check never stacks two blockers. The wall surfaces API errors itself.
    setNdaRequired(true);
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
  }, []);

  const showLanding = () => {
    window.history.replaceState(null, "", "/");
    setRoute({ kind: "root" });
    dispatch({ type: "SET_VIEW", view: "landing" });
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

  // ── Public comment share page: /c/:templateId ──
  // Guests land here from a share link (phone, client, teammate). No account
  // needed — render before every auth gate, like invitation/recovery.
  if (route.kind === "comment-share") {
    return (
      <ErrorBoundary>
        <MobileComments templateId={route.templateId} />
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
    if (ndaRequired === null) return <AppStartupScreen />;
    if (ndaRequired) {
      return (
        <ErrorBoundary>
          <NdaAcceptance
            fullName={user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || ""}
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
        <Landing onEnter={enterWorkspace} />
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
        {onboardingNeeded === true && (
          <MusaOnboarding onComplete={handleOnboardingComplete} />
        )}
      </>
    );
  }

  return (
    <>
      <ErrorBoundary>
        <EditorV2
          templateId={templateId!}
          onBack={enterWorkspace}
          onOpenTemplate={(id) => openTemplate(id, `/?template=${id}&v=2`)}
        />
      </ErrorBoundary>
      <ChatFAB workspaceId={workspaceId ?? undefined} templateId={templateId!} hideFab={onboardingNeeded === true} />
      {onboardingNeeded === true && (
        <MusaOnboarding onComplete={handleOnboardingComplete} />
      )}
    </>
  );
}

export { App };
