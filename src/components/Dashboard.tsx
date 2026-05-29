import { useState, useEffect, useCallback, useRef, useReducer } from "react";

interface Template {
  id: string;
  name: string;
  width: number;
  height: number;
  workspaceId: string;
  metadata: { createdAt: string; updatedAt: string };
}

interface Workspace {
  id: string;
  name: string;
}

interface DashboardProps {
  onSelectTemplate: (id: string) => void;
  onCreateTemplate: (workspaceId: string) => void;
}

const API_BASE = "/api";

async function apiFetch<T = any>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { "Content-Type": "application/json", "x-api-key": "dev-key" },
    ...options,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

export function Dashboard({ onSelectTemplate, onCreateTemplate }: DashboardProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedWs, setSelectedWs] = useState<string | null>(null);
  const [searchDisplay, setSearchDisplay] = useState("");
  const searchRef = useRef("");
  const loadingRef = useRef(true);
  const loadTemplatesRef = useRef<(wsId?: string) => void>(() => {});
  const [, forceRender] = useReducer((x: number) => x + 1, 0);

  const setLoading = useCallback((v: boolean) => {
    loadingRef.current = v;
    forceRender();
  }, []);

  const loadTemplates = useCallback(async (wsId?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (wsId) params.set("workspaceId", wsId);
      if (searchRef.current) params.set("search", searchRef.current);
      const qs = params.toString();
      const res = await apiFetch<{ success: boolean; data: Template[] }>(`/templates${qs ? `?${qs}` : ""}`);
      setTemplates(res.data || []);
    } catch { setTemplates([]); }
    setLoading(false);
  }, [setLoading]);

  loadTemplatesRef.current = loadTemplates;

  const handleSearch = useCallback((value: string) => {
    setSearchDisplay(value);
    searchRef.current = value;
    loadTemplatesRef.current(selectedWs ?? undefined);
  }, [selectedWs]);

  const handleWsChange = useCallback((wsId: string | null) => {
    setSelectedWs(wsId);
    loadTemplatesRef.current(wsId ?? undefined);
  }, []);

  useEffect(() => {
    apiFetch<{ success: boolean; data: Workspace[] }>("/workspaces")
      .then(r => { setWorkspaces(r.data || []); if (r.data?.[0]) { setSelectedWs(r.data[0].id); loadTemplatesRef.current(r.data[0].id); } })
      .catch(() => {});
  }, []);

  const loading = loadingRef.current;

  const handleDelete = async (id: string) => {
    try {
      await fetch(`${API_BASE}/templates/${id}`, { method: "DELETE", headers: { "x-api-key": "dev-key" } });
      setTemplates(prev => prev.filter(t => t.id !== id));
    } catch { /* ignore */ }
  };

  const handleDuplicate = async (id: string) => {
    try {
      const res = await apiFetch<{ success: boolean; data: Template }>(`/templates/${id}/duplicate`, { method: "POST", body: "{}" });
      if (res.data) setTemplates(prev => [res.data, ...prev]);
    } catch { /* ignore */ }
  };

  const handleExport = async (id: string, name: string) => {
    try {
      const res = await apiFetch<any>(`/templates/${id}/export`);
      const blob = new Blob([JSON.stringify(res, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${name}.futuraria.json`;
      a.click(); URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  };

  return (
    <div style={dashboardStyle}>
      {/* Header */}
      <div style={dashHeaderStyle}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: -0.5 }}>Futuraria</h1>
        <div style={{ flex: 1 }} />
        <select
          aria-label="Select workspace"
          value={selectedWs || ""}
          onChange={e => handleWsChange(e.target.value || null)}
          style={selectStyle}
        >
          {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <input
          aria-label="Search templates"
          placeholder="Search templates…"
          value={searchDisplay}
          onChange={e => handleSearch(e.target.value)}
          style={{ ...inputStyle, width: 200 }}
        />
        <button
          type="button"
          onClick={() => selectedWs && onCreateTemplate(selectedWs)}
          style={btnPrimary}
          disabled={!selectedWs}
        >
          + New Template
        </button>
      </div>

      {/* Template Grid */}
      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {loading ? (
          <div style={{ textAlign: "center", color: "#5a5a70", padding: 60 }}>Loading…</div>
        ) : templates.length === 0 ? (
          <div style={{ textAlign: "center", color: "#5a5a70", padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
            <div>No templates yet. Create your first one!</div>
            <button
              type="button"
              onClick={() => selectedWs && onCreateTemplate(selectedWs)}
              style={{ ...btnPrimary, marginTop: 16 }}
              disabled={!selectedWs}
            >
              + New Template
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
            {templates.map(t => (
              <div
                key={t.id}
                style={cardStyle}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#7c6fff"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "#1c1c26"; }}
              >
                <button
                  type="button"
                  aria-label={`Open template ${t.name}`}
                  onClick={() => onSelectTemplate(t.id)}
                  style={cardBtnStyle}
                >
                  {/* Thumbnail placeholder */}
                  <div style={thumbnailStyle}>
                    {t.width}x{t.height}
                  </div>
                  <div style={{ padding: "8px 10px" }}>
                    <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                    <div style={{ fontSize: 12, color: "#5a5a70" }}>{new Date(t.metadata.updatedAt).toLocaleDateString()}</div>
                  </div>
                </button>
                <div style={{ display: "flex", borderTop: "1px solid #1c1c26", fontSize: 12 }}>
                  <button type="button" onClick={e => { e.stopPropagation(); handleDuplicate(t.id); }} style={cardAction}>Copy</button>
                  <button type="button" onClick={e => { e.stopPropagation(); handleExport(t.id, t.name); }} style={cardAction}>Export</button>
                  <button type="button" onClick={e => { e.stopPropagation(); handleDelete(t.id); }} style={{ ...cardAction, color: "#f87171" }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const dashboardStyle: React.CSSProperties = {
  height: "100vh", background: "#0a0a0f", color: "#e4e4f0",
  fontFamily: "Inter, system-ui, sans-serif", display: "flex", flexDirection: "column",
};

const dashHeaderStyle: React.CSSProperties = {
  padding: "16px 20px", borderBottom: "1px solid #1c1c26",
  display: "flex", alignItems: "center", gap: 16,
};

const thumbnailStyle: React.CSSProperties = {
  background: "#111118", height: 140, borderRadius: "4px 4px 0 0",
  display: "flex", alignItems: "center", justifyContent: "center",
  color: "#2a2a3a", fontSize: 32,
};

const selectStyle: React.CSSProperties = {
  background: "#111118", border: "1px solid #1c1c26", color: "#e4e4f0",
  borderRadius: 6, padding: "5px 10px", fontSize: 12, outline: "none",
};

const inputStyle: React.CSSProperties = {
  background: "#111118", border: "1px solid #1c1c26", color: "#e4e4f0",
  borderRadius: 6, padding: "5px 10px", fontSize: 12, outline: "none",
};

const btnPrimary: React.CSSProperties = {
  background: "#7c6fff", border: "none", color: "#fff",
  borderRadius: 6, padding: "6px 16px", fontSize: 12, cursor: "pointer", fontWeight: 500,
};

const cardStyle: React.CSSProperties = {
  background: "#0e0e16", border: "1px solid #1c1c26", borderRadius: 6,
  cursor: "pointer", overflow: "hidden", transition: "border-color 0.15s",
  display: "flex", flexDirection: "column",
};

const cardBtnStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", width: "100%",
  background: "none", border: "none", color: "inherit",
  cursor: "pointer", padding: 0, textAlign: "left",
  fontFamily: "inherit", fontSize: "inherit",
};

const cardAction: React.CSSProperties = {
  flex: 1, background: "none", border: "none", borderRight: "1px solid #1c1c26",
  color: "#7a7a90", fontSize: 12, cursor: "pointer", padding: "4px 0",
};
