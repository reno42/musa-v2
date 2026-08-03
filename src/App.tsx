import { useEffect, useReducer, useState } from "react";
import { Landing } from "./components/Landing";
import { Dashboard, DEFAULT_WORKSPACE_ID } from "./components/Dashboard";
import { EditorV2 } from "./pages/EditorV2";
import { ChatFAB } from "./components/ChatFAB";
import { useToast } from "./components/Toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { getApiHeaders } from "./lib/apiKey";
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
        <span className="app-startup-mark">F</span>
        <span>Futuraria</span>
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
    passwordRecovery,
    needsPasswordSetup,
    completePasswordRecovery,
  } = useAuth();
  const [route, setRoute] = useState<AppRoute>(() => readAppRoute(window.location));
  const [state, dispatch] = useReducer(appReducer, route, stateForRoute);
  const { addToast } = useToast();
  const { view, templateId } = state;

  const showLanding = () => {
    window.history.replaceState(null, "", "/");
    setRoute({ kind: "root" });
    dispatch({ type: "SET_VIEW", view: "landing" });
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
        const lastRoute = getLastRoute();
        if (lastRoute && lastRoute !== "/#workspace" && lastRoute.includes("template=")) {
          // User was in the editor — restore that template
          window.history.replaceState(null, "", lastRoute);
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

  const handleCreateHtmlTemplate = async (workspaceId: string, name: string) => {
    try {
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({ workspaceId, name, width: 1080, height: 1080, engine: "html" }),
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
        <ChatFAB workspaceId={DEFAULT_WORKSPACE_ID} />
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
      <ChatFAB workspaceId={DEFAULT_WORKSPACE_ID} templateId={templateId!} />
    </>
  );
}

export { App };
