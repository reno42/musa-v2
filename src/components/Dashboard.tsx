import { useState, useEffect, useCallback, useRef, useReducer } from "react";
import { IconFolder, IconFile } from "../shared/icons";

interface Template {
  id: string;
  name: string;
  width: number;
  height: number;
  engine?: "fabric" | "html";
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
  onCreateHtmlTemplate: (workspaceId: string, name: string) => void;
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

export function Dashboard({ onSelectTemplate, onCreateTemplate, onCreateHtmlTemplate }: DashboardProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedWs, setSelectedWs] = useState<string | null>(null);
  const [searchDisplay, setSearchDisplay] = useState("");
  const [creatingWs, setCreatingWs] = useState(false);
  const [newWsName, setNewWsName] = useState("");
  const [editingTplId, setEditingTplId] = useState<string | null>(null);
  const [editingTplName, setEditingTplName] = useState("");
  const [creatingTpl, setCreatingTpl] = useState(false);
  const [newTplName, setNewTplName] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const newTplInputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef("");
  const loadingRef = useRef(true);
  const loadTemplatesRef = useRef<(wsId?: string) => void>(() => {});
  const newWsInputRef = useRef<HTMLInputElement>(null);
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
      .then(r => {
        const wsList = r.data || [];
        setWorkspaces(wsList);
        if (wsList[0]) {
          setSelectedWs(wsList[0].id);
          loadTemplatesRef.current(wsList[0].id);
        } else {
          loadTemplatesRef.current();
        }
      })
      .catch(() => loadTemplatesRef.current());
  }, []);

  const loading = loadingRef.current;

  const handleCreateWorkspace = async () => {
    const name = newWsName.trim();
    if (!name) return;
    try {
      const res = await apiFetch<{ success: boolean; data: Workspace }>("/workspaces", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      if (res.data) {
        setWorkspaces(prev => [...prev, res.data]);
        setSelectedWs(res.data.id);
        setNewWsName("");
        setCreatingWs(false);
        loadTemplatesRef.current(res.data.id);
      }
    } catch { /* ignore */ }
  };

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

  const startRename = (id: string, name: string) => {
    setEditingTplId(id);
    setEditingTplName(name);
    setTimeout(() => editInputRef.current?.focus(), 50);
  };

  const commitRename = async () => {
    const id = editingTplId;
    const name = editingTplName.trim();
    if (!id || !name) { setEditingTplId(null); return; }
    try {
      await apiFetch(`/templates/${id}`, { method: "PUT", body: JSON.stringify({ name }) });
      setTemplates(prev => prev.map(t => t.id === id ? { ...t, name } : t));
    } catch { /* ignore */ }
    setEditingTplId(null);
  };

  const handleCreateWithName = async () => {
    const name = newTplName.trim() || "Untitled";
    if (!selectedWs) return;
    try {
      const res = await apiFetch<{ success: boolean; data: Template }>("/templates", {
        method: "POST",
        body: JSON.stringify({ workspaceId: selectedWs, name, width: 1080, height: 1080 }),
      });
      if (res.data) {
        setCreatingTpl(false);
        setNewTplName("");
        onSelectTemplate(res.data.id);
      }
    } catch { /* ignore */ }
  };

  return (
    <div style={dashboardStyle}>
      {/* Header */}
      <div style={dashHeaderStyle}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: -0.5 }}>Futuraria</h1>
        <div style={{ flex: 1 }} />
        {creatingWs ? (
          <input
            ref={newWsInputRef}
            aria-label="New workspace name"
            placeholder="Workspace name…"
            value={newWsName}
            onChange={e => setNewWsName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleCreateWorkspace(); if (e.key === "Escape") { setCreatingWs(false); setNewWsName(""); } }}
            onBlur={() => { if (!newWsName.trim()) { setCreatingWs(false); } }}
            style={{ ...inputStyle, width: 160 }}
            autoFocus
          />
        ) : (
          <select
            aria-label="Select workspace"
            value={selectedWs || ""}
            onChange={e => handleWsChange(e.target.value || null)}
            style={selectStyle}
          >
            <option value=""><IconFolder size={14} style={{ marginRight: 4 }} />All Templates</option>
            {workspaces.length === 0 && <option value="" disabled>— No workspaces —</option>}
            {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        )}
        {!creatingWs && (
          <button type="button" onClick={() => { setCreatingWs(true); setTimeout(() => newWsInputRef.current?.focus(), 50); }} style={btnSecondary}>
            + Workspace
          </button>
        )}
        <input
          aria-label="Search templates"
          placeholder="Search templates…"
          value={searchDisplay}
          onChange={e => handleSearch(e.target.value)}
          style={{ ...inputStyle, width: 200 }}
        />
        {creatingTpl ? (
          <input
            ref={newTplInputRef}
            aria-label="New template name"
            placeholder="Template name…"
            value={newTplName}
            onChange={e => setNewTplName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleCreateWithName(); if (e.key === "Escape") { setCreatingTpl(false); setNewTplName(""); } }}
            onBlur={() => { if (!newTplName.trim()) { setCreatingTpl(false); } }}
            style={{ ...inputStyle, width: 140 }}
            autoFocus
          />
        ) : (
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={() => { setCreatingTpl(true); setTimeout(() => newTplInputRef.current?.focus(), 50); }}
              style={btnPrimary}
              disabled={!selectedWs}
            >
              + Fabric
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!selectedWs) return;
                const name = `HTML ${new Date().toLocaleDateString()}`;
                onCreateHtmlTemplate(selectedWs, name);
              }}
              style={{ ...btnPrimary, background: "#3B82F6" }}
              disabled={!selectedWs}
            >
              + HTML
            </button>
          </div>
        )}
      </div>

      {/* Template Grid */}
      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {loading ? (
          <div style={{ textAlign: "center", color: "#7a7668", padding: 60 }}>Loading…</div>
        ) : templates.length === 0 ? (
          <div style={{ textAlign: "center", color: "#7a7668", padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}><IconFile size={40} color="#7a7668" /></div>
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
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#c8b898"; (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 32px rgba(0, 0, 0, 0.5)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255, 255, 255, 0.05)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 24px rgba(0, 0, 0, 0.3)"; }}
              >
                <button
                  type="button"
                  aria-label={`Open template ${t.name}`}
                  onClick={() => onSelectTemplate(t.id)}
                  style={cardBtnStyle}
                >
                  {/* Thumbnail placeholder */}
                  <div style={thumbnailStyle}>
                    {t.engine === "html" ? (
                      <iframe
                        srcDoc={`<!DOCTYPE html><html><head><style>body{margin:0;overflow:hidden;width:${t.width}px;height:${t.height}px;transform:scale(0.15);transform-origin:top left}${/* css is not available in the list, show placeholder */""}</style></head><body style="background:#1a1a2e;display:flex;align-items:center;justify-content:center;width:${t.width}px;height:${t.height}px"><span style="color:#888;font-family:sans-serif;font-size:48px">HTML</span></body></html>`}
                        sandbox="allow-same-origin"
                        style={{ width: "100%", height: "100%", border: "none", pointerEvents: "none" }}
                        title={t.name}
                      />
                    ) : (
                      <>{t.width}x{t.height}</>
                    )}
                  </div>
                  <div style={{ padding: "8px 10px" }}>
                    {editingTplId === t.id ? (
                      <input
                        ref={editInputRef}
                        value={editingTplName}
                        onChange={e => setEditingTplName(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditingTplId(null); }}
                        onBlur={commitRename}
                        style={{ ...inputStyle, width: "100%", fontSize: 12 }}
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <div
                        style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "text" }}
                        onDoubleClick={e => { e.stopPropagation(); startRename(t.id, t.name); }}
                        title="Double-click to rename"
                      >{t.name}</div>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ fontSize: 12, color: "#7a7668" }}>{new Date(t.metadata.updatedAt).toLocaleDateString()}</div>
                      {t.engine === "html" && (
                        <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "#3B82F6", color: "#fff", fontWeight: 600 }}>HTML</span>
                      )}
                    </div>
                  </div>
                </button>
                <div style={{ display: "flex", borderTop: "1px solid rgba(255, 255, 255, 0.04)", fontSize: 12 }}>
                  <button type="button" onClick={e => { e.stopPropagation(); startRename(t.id, t.name); }} style={cardAction}>Rename</button>
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
  height: "100vh", background: "#080808", color: "#f0ebe0",
  fontFamily: "Inter, system-ui, sans-serif", display: "flex", flexDirection: "column",
  backgroundImage: "url(/bg-dashboard.jpg)",
  backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat",
  backgroundAttachment: "fixed",
};

const dashHeaderStyle: React.CSSProperties = {
  padding: "16px 20px",
  background: "rgba(8, 8, 8, 0.85)",
  backdropFilter: "blur(20px) saturate(180%)",
  WebkitBackdropFilter: "blur(20px) saturate(180%)",
  borderBottom: "1px solid rgba(200, 184, 152, 0.08)",
  display: "flex", alignItems: "center", gap: 16, position: "sticky", top: 0, zIndex: 10,
};

const thumbnailStyle: React.CSSProperties = {
  background: "rgba(15, 15, 15, 0.6)",
  backdropFilter: "blur(8px) saturate(150%)",
  WebkitBackdropFilter: "blur(8px) saturate(150%)",
  height: 140, borderRadius: "10px 10px 0 0",
  display: "flex", alignItems: "center", justifyContent: "center",
  color: "#2a2a2a", fontSize: 32,
};

const selectStyle: React.CSSProperties = {
  background: "rgba(15, 15, 15, 0.5)",
  backdropFilter: "blur(10px) saturate(160%)",
  WebkitBackdropFilter: "blur(10px) saturate(160%)",
  border: "1px solid rgba(255, 255, 255, 0.05)",
  color: "#f0ebe0",
  borderRadius: 8, padding: "5px 10px", fontSize: 12, outline: "none",
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  background: "rgba(15, 15, 15, 0.45)",
  backdropFilter: "blur(10px) saturate(160%)",
  WebkitBackdropFilter: "blur(10px) saturate(160%)",
  border: "1px solid rgba(255, 255, 255, 0.05)",
  color: "#f0ebe0",
  borderRadius: 8, padding: "5px 10px", fontSize: 12, outline: "none",
  transition: "border-color 0.2s ease",
};

const btnPrimary: React.CSSProperties = {
  background: "rgba(200, 184, 152, 0.12)",
  backdropFilter: "blur(8px) saturate(150%)",
  WebkitBackdropFilter: "blur(8px) saturate(150%)",
  border: "1px solid #c8b898", color: "#c8b898",
  borderRadius: 8, padding: "6px 16px", fontSize: 12, cursor: "pointer", fontWeight: 500,
  transition: "all 0.2s ease",
};

const btnSecondary: React.CSSProperties = {
  background: "rgba(15, 15, 15, 0.5)",
  backdropFilter: "blur(8px) saturate(150%)",
  WebkitBackdropFilter: "blur(8px) saturate(150%)",
  border: "1px solid rgba(255, 255, 255, 0.05)", color: "#c4c0b4",
  borderRadius: 8, padding: "5px 10px", fontSize: 12, cursor: "pointer",
  transition: "all 0.2s ease",
};

const cardStyle: React.CSSProperties = {
  background: "rgba(12, 12, 12, 0.6)",
  backdropFilter: "blur(14px) saturate(160%)",
  WebkitBackdropFilter: "blur(14px) saturate(160%)",
  border: "1px solid rgba(255, 255, 255, 0.05)", borderRadius: 12,
  cursor: "pointer", overflow: "hidden", transition: "all 0.25s ease",
  display: "flex", flexDirection: "column",
  boxShadow: "0 4px 24px rgba(0, 0, 0, 0.3)",
};

const cardBtnStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", width: "100%",
  background: "none", border: "none", color: "inherit",
  cursor: "pointer", padding: 0, textAlign: "left",
  fontFamily: "inherit", fontSize: "inherit",
};

const cardAction: React.CSSProperties = {
  flex: 1, background: "none", border: "none", borderRight: "1px solid rgba(255, 255, 255, 0.04)",
  color: "#7a7668", fontSize: 12, cursor: "pointer", padding: "4px 0",
  transition: "all 0.15s ease",
};
