import { useState, useEffect, useCallback, useRef, useReducer } from "react";
import { IconFolder, IconFile, IconTag } from "../shared/icons";

interface Template {
  id: string;
  name: string;
  width: number;
  height: number;
  engine?: "html";
  workspaceId: string;
  metadata: { createdAt: string; updatedAt: string };
}

interface Recipe {
  id: string;
  name: string;
  description: string;
  workspaceId: string;
  templateWidth: number;
  templateHeight: number;
  structure: any;
  tags: string[];
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface Workspace {
  id: string;
  name: string;
}

interface DashboardProps {
  onSelectTemplate: (id: string) => void;
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

export function Dashboard({ onSelectTemplate, onCreateHtmlTemplate }: DashboardProps) {
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
  const [activeTab, setActiveTab] = useState<"templates" | "recipes">("templates");
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loadingRecipes, setLoadingRecipes] = useState(false);
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

  const loadRecipes = useCallback(async () => {
    setLoadingRecipes(true);
    try {
      const res = await apiFetch<{ success: boolean; data: Recipe[] }>("/recipes");
      setRecipes(res.data || []);
    } catch { setRecipes([]); }
    setLoadingRecipes(false);
  }, []);

  // Load recipes when tab switches to recipes
  useEffect(() => {
    if (activeTab === "recipes") loadRecipes();
  }, [activeTab, loadRecipes]);

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
    setCreatingTpl(false);
    setNewTplName("");
    onCreateHtmlTemplate(selectedWs, name);
  };

  const handleDeleteRecipe = async (id: string) => {
    try {
      await apiFetch(`/recipes/${id}`, { method: "DELETE" });
      setRecipes(prev => prev.filter(r => r.id !== id));
    } catch { /* ignore */ }
  };

  const handleCreateFromRecipe = async (recipeId: string, recipeName: string) => {
    try {
      const res = await apiFetch<{ success: boolean; data: { templateId: string } }>(`/recipes/${recipeId}/execute`, {
        method: "POST",
        body: JSON.stringify({ variables: {}, workspaceId: selectedWs || "default" }),
      });
      if (res.data) {
        onSelectTemplate(res.data.templateId);
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
          <button
            type="button"
            onClick={() => { setCreatingTpl(true); setTimeout(() => newTplInputRef.current?.focus(), 50); }}
            style={{ ...btnPrimary, background: "#3B82F6" }}
            disabled={!selectedWs}
          >
            + HTML
          </button>
        )}
      </div>

      {/* Tab Navigation */}
      <div style={{ display: "flex", gap: 0, padding: "0 20px", marginTop: 8 }}>
        <button
          type="button"
          onClick={() => setActiveTab("templates")}
          style={{
            ...btnSecondary,
            borderRadius: "8px 8px 0 0",
            borderBottom: activeTab === "templates" ? "2px solid #c8b898" : "2px solid transparent",
            background: activeTab === "templates" ? "rgba(200,184,152,0.08)" : "transparent",
            color: activeTab === "templates" ? "#c8b898" : "#7a7668",
            marginRight: 4,
          }}
        >
          <IconFile size={14} style={{ marginRight: 4 }} /> Templates
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("recipes")}
          style={{
            ...btnSecondary,
            borderRadius: "8px 8px 0 0",
            borderBottom: activeTab === "recipes" ? "2px solid #c8b898" : "2px solid transparent",
            background: activeTab === "recipes" ? "rgba(200,184,152,0.08)" : "transparent",
            color: activeTab === "recipes" ? "#c8b898" : "#7a7668",
          }}
        >
          <IconTag size={14} style={{ marginRight: 4 }} /> Key Visuals
        </button>
      </div>

      {/* Template Grid */}
      {activeTab === "templates" && (
      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {loading ? (
          <div style={{ textAlign: "center", color: "#7a7668", padding: 60 }}>Loading…</div>
        ) : templates.length === 0 ? (
          <div style={{ textAlign: "center", color: "#7a7668", padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}><IconFile size={40} color="#7a7668" /></div>
            <div>No templates yet. Create your first one!</div>
            <button
              type="button"
              onClick={() => selectedWs && onCreateHtmlTemplate(selectedWs, "Untitled")}
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
      )}

      {/* Key Visuals / Recipes Grid */}
      {activeTab === "recipes" && (
      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {loadingRecipes ? (
          <div style={{ textAlign: "center", color: "#7a7668", padding: 60 }}>Loading...</div>
        ) : recipes.length === 0 ? (
          <div style={{ textAlign: "center", color: "#7a7668", padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}><IconTag size={40} color="#7a7668" /></div>
            <div>No Key Visuals saved yet.</div>
            <div style={{ fontSize: 11, marginTop: 4, opacity: 0.6 }}>
              Open a template in the editor and click the tag icon to save it as a Key Visual.
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
            {recipes.map(r => (
              <div
                key={r.id}
                style={cardStyle}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#c8b898"; (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 32px rgba(0, 0, 0, 0.5)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255, 255, 255, 0.05)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 24px rgba(0, 0, 0, 0.3)"; }}
              >
                <button
                  type="button"
                  aria-label={`Create from recipe ${r.name}`}
                  onClick={() => handleCreateFromRecipe(r.id, r.name)}
                  style={cardBtnStyle}
                >
                  <div style={thumbnailStyle}>
                    <div style={{ textAlign: "center" }}>
                      <IconTag size={28} color="#7a7668" />
                      <div style={{ fontSize: 11, marginTop: 4, color: "#7a7668" }}>{r.templateWidth}×{r.templateHeight}</div>
                    </div>
                  </div>
                  <div style={{ padding: "8px 12px" }}>
                    <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                    <div style={{ fontSize: 11, color: "#7a7668", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.description || "No description"}
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 6, fontSize: 11, color: "#7a7668" }}>
                      <span>Used: {r.usageCount || 0}×</span>
                      <span>{new Date(r.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </button>
                <div style={{ display: "flex", borderTop: "1px solid rgba(255, 255, 255, 0.04)", fontSize: 12 }}>
                  <button type="button" onClick={e => { e.stopPropagation(); handleCreateFromRecipe(r.id, r.name); }} style={cardAction}>
                    Create
                  </button>
                  <button type="button" onClick={e => { e.stopPropagation(); handleDeleteRecipe(r.id); }} style={{ ...cardAction, color: "#f87171" }}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}
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
