import { useReducer, useEffect } from "react";
import { Dashboard } from "./components/Dashboard";
import { EditorV2 } from "./pages/EditorV2";
import { useToast } from "./components/Toast";

type ViewMode = "dashboard" | "editor-v2";

type AppState = {
  view: ViewMode;
  templateId: string | null;
};

type AppAction =
  | { type: "SET_VIEW"; view: ViewMode }
  | { type: "OPEN_TEMPLATE_V2"; id: string }
  | { type: "BACK_TO_DASHBOARD" };

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_VIEW": return { ...state, view: action.view };
    case "OPEN_TEMPLATE_V2": return { ...state, view: "editor-v2", templateId: action.id };
    case "BACK_TO_DASHBOARD": return { ...state, view: "dashboard", templateId: null };
  }
}

const initialAppState: AppState = {
  view: "dashboard",
  templateId: null,
};

function App() {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const { addToast } = useToast();

  const { view, templateId } = state;

  // Create HTML template and open in EditorV2
  const handleCreateHtmlTemplate = async (workspaceId: string, name: string) => {
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": "dev-key" },
        body: JSON.stringify({ workspaceId, name, width: 1080, height: 1080, engine: "html" }),
      });
      const json = await res.json();
      if (json.success && json.data) {
        dispatch({ type: "OPEN_TEMPLATE_V2", id: json.data.id });
        window.history.replaceState(null, '', `/?template=${json.data.id}&v=2`);
      } else {
        addToast("No se pudo crear la plantilla. Intenta de nuevo.", "error");
      }
    } catch {
      addToast("Error al crear la plantilla. Verifica tu conexión.", "error");
    }
  };

  // Open template — always uses EditorV2
  const handleSelectTemplate = (id: string) => {
    dispatch({ type: "OPEN_TEMPLATE_V2", id });
    window.history.replaceState(null, '', `/?template=${id}&v=2`);
  };

  // Check URL params for direct template loading
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tplId = params.get("template");
    if (tplId) {
      dispatch({ type: "OPEN_TEMPLATE_V2", id: tplId });
    }
  }, []);

  // Dashboard view
  if (view === "dashboard") {
    return (
      <Dashboard
        onSelectTemplate={handleSelectTemplate}
        onCreateHtmlTemplate={handleCreateHtmlTemplate}
      />
    );
  }

  // Editor V2 view (HTML/CSS)
  return (
    <EditorV2
      templateId={templateId!}
      onBack={() => { dispatch({ type: "BACK_TO_DASHBOARD" }); window.history.replaceState(null, '', '/'); }}
      onOpenTemplate={(id) => { dispatch({ type: "OPEN_TEMPLATE_V2", id }); window.history.replaceState(null, '', `/?template=${id}&v=2`); }}
    />
  );
}

export { App };
