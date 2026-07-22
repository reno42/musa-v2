import { useReducer, useEffect, useState } from "react";
import { Landing } from "./components/Landing";
import { Dashboard } from "./components/Dashboard";
import { EditorV2 } from "./pages/EditorV2";
import { useToast } from "./components/Toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { getApiHeaders } from "./lib/apiKey";
import { useAuth } from "./lib/auth";
import { AuthScreen } from "./components/AuthScreen";

type ViewMode = "landing" | "dashboard" | "editor-v2";

type AppState = {
  view: ViewMode;
  templateId: string | null;
};

type AppAction =
  | { type: "SET_VIEW"; view: ViewMode }
  | { type: "OPEN_TEMPLATE_V2"; id: string }
  | { type: "BACK_TO_DASHBOARD" }
  | { type: "ENTER_WORKSPACE" };

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_VIEW": return { ...state, view: action.view };
    case "OPEN_TEMPLATE_V2": return { ...state, view: "editor-v2", templateId: action.id };
    case "BACK_TO_DASHBOARD": return { ...state, view: "dashboard", templateId: null };
    case "ENTER_WORKSPACE": return { ...state, view: "dashboard" };
    default: return state;
  }
}

const initialAppState: AppState = {
  view: "landing",
  templateId: null,
};

function App() {
  const { configured: authConfigured, loading: authLoading, user } = useAuth();
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const { addToast } = useToast();
  const [resolving, setResolving] = useState(false);

  const { view, templateId } = state;

  // ── Slug → UUID resolution ──────────────────────────────
  // Resolves only inside the authenticated tenant boundary.
  const resolveSlug = async (wsSlug: string, tplSlug?: string) => {
    const url = tplSlug
      ? `/api/resolve/workspace/${wsSlug}/${tplSlug}`
      : `/api/resolve/workspace/${wsSlug}`;
    try {
      const res = await fetch(url, { headers: getApiHeaders() });
      const json = await res.json();
      return json.success ? json.data : null;
    } catch { return null; }
  };

  // Create HTML template and open in EditorV2
  const handleCreateHtmlTemplate = async (workspaceId: string, name: string) => {
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({ workspaceId, name, width: 1080, height: 1080, engine: "html" }),
      });
      const json = await res.json();
      if (json.success && json.data) {
        const id = json.data.id;
        dispatch({ type: "OPEN_TEMPLATE_V2", id });
        // Fall back to query-param URL until slug is available
        window.history.replaceState(null, '', `/?template=${id}&v=2`);
      } else {
        addToast("No se pudo crear la plantilla. Intenta de nuevo.", "error");
      }
    } catch {
      addToast("Error al crear la plantilla. Verifica tu conexión.", "error");
    }
  };

  // Open template — uses clean URL when slug info is available
  const handleSelectTemplate = (id: string, slugInfo?: { wsSlug?: string; tplSlug?: string }) => {
    dispatch({ type: "OPEN_TEMPLATE_V2", id });
    if (slugInfo?.wsSlug && slugInfo?.tplSlug) {
      window.history.replaceState(null, '', `/w/${slugInfo.wsSlug}/${slugInfo.tplSlug}`);
    } else {
      // Backward compat: query-param URL
      window.history.replaceState(null, '', `/?template=${id}&v=2`);
    }
  };

  // Check URL params for direct template/slug loading
  useEffect(() => {
    if (authConfigured && authLoading) return;
    const params = new URLSearchParams(window.location.search);
    const tplId = params.get("template");
    const hash = window.location.hash.replace("#", "");

    // ── Clean URL routing (/w/:wsSlug[/:tplSlug]) ──
    const path = window.location.pathname;
    const slugMatch = path.match(/^\/w\/([^/]+)(?:\/([^/]+))?$/);

    if (slugMatch) {
      const [, wsSlug, tplSlug] = slugMatch;
      setResolving(true);
      resolveSlug(wsSlug, tplSlug || undefined).then((data) => {
        if (!data) {
          // Slug not found — show dashboard
          dispatch({ type: "ENTER_WORKSPACE" });
          return;
        }
        if (data.templateId) {
          // Full resolve: workspace + template
          dispatch({ type: "OPEN_TEMPLATE_V2", id: data.templateId });
        } else {
          // Workspace-only resolve — go to dashboard
          dispatch({ type: "ENTER_WORKSPACE" });
        }
      }).catch(() => {
        dispatch({ type: "ENTER_WORKSPACE" });
      }).finally(() => {
        setResolving(false);
      });
      return;
    }

    // ── Backward compat: ?template=UUID&v=2 ──
    if (tplId) {
      dispatch({ type: "OPEN_TEMPLATE_V2", id: tplId });
    } else if (hash === "workspace") {
      dispatch({ type: "ENTER_WORKSPACE" });
    } else if (path === "/") {
      // Root URL with no params: go to dashboard (not landing) if user has been here before
      const hasVisited = localStorage.getItem("futuraria-api-key") !== null;
      if (hasVisited) {
        dispatch({ type: "ENTER_WORKSPACE" });
        window.history.replaceState(null, "", "/#workspace");
      }
      // else: first visit — stays on landing (default)
    }
    // else stays on landing (default)
  }, [authConfigured, authLoading]);

  if (authLoading && view !== "landing") {
    return <main className="auth-shell"><p className="auth-copy" role="status">Cargando sesión…</p></main>;
  }

  if (authConfigured && !user && view !== "landing") {
    return <AuthScreen onBack={() => dispatch({ type: "SET_VIEW", view: "landing" })} />;
  }

  // Landing view
  if (view === "landing") {
    if (resolving) {
      return (
        <ErrorBoundary>
        <Landing
          onEnter={() => {
            dispatch({ type: "ENTER_WORKSPACE" });
            window.history.replaceState(null, "", "/#workspace");
          }}
        />
        </ErrorBoundary>
      );
    }
    return (
      <ErrorBoundary>
      <Landing
        onEnter={() => {
          dispatch({ type: "ENTER_WORKSPACE" });
          window.history.replaceState(null, "", "/#workspace");
        }}
      />
      </ErrorBoundary>
    );
  }

  // Dashboard view
  if (view === "dashboard") {
    return (
      <ErrorBoundary>
      <Dashboard
        onSelectTemplate={handleSelectTemplate}
        onCreateHtmlTemplate={handleCreateHtmlTemplate}
      />
      </ErrorBoundary>
    );
  }

  // Editor V2 view (HTML/CSS)
  return (
    <ErrorBoundary>
    <EditorV2
      templateId={templateId!}
      onBack={() => { dispatch({ type: "BACK_TO_DASHBOARD" }); window.history.replaceState(null, '', '/#workspace'); }}
      onOpenTemplate={(id) => { dispatch({ type: "OPEN_TEMPLATE_V2", id }); window.history.replaceState(null, '', `/?template=${id}&v=2`); }}
    />
    </ErrorBoundary>
  );
}

export { App };
