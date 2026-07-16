import { useState, useEffect, useCallback, useRef, useReducer } from "react";
import { motion } from "framer-motion";
import { IconFolder, IconFile, IconTag } from "../shared/icons";
import { mcpCall } from "../lib/mcpClient";
import { useToast } from "./Toast";

interface Template {
  id: string;
  name: string;
  width: number;
  height: number;
  engine?: "html";
  workspaceId: string;
  metadata: { createdAt: string; updatedAt: string };
  frames?: Array<{ html?: string; css?: string; background?: string }>;
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
  const { addToast } = useToast();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedWs, setSelectedWs] = useState<string | null>(null);
  const [searchDisplay, setSearchDisplay] = useState("");
  const [creatingWs, setCreatingWs] = useState(false);
  const [newWsName, setNewWsName] = useState("");
  const [editingWsId, setEditingWsId] = useState<string | null>(null);
  const [editingWsName, setEditingWsName] = useState("");
  const [editingTplId, setEditingTplId] = useState<string | null>(null);
  const [editingTplName, setEditingTplName] = useState("");
  const [creatingTpl, setCreatingTpl] = useState(false);
  const [newTplName, setNewTplName] = useState("");
  const [activeTab, setActiveTab] = useState<"templates" | "recipes" | "data">("templates");
  const [wsDropdownOpen, setWsDropdownOpen] = useState(false);
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
    } catch {
      setTemplates([]);
      addToast("Error al cargar las plantillas.", "error");
    }
    setLoading(false);
  }, [setLoading, addToast]);

  loadTemplatesRef.current = loadTemplates;

  const loadRecipes = useCallback(async () => {
    setLoadingRecipes(true);
    try {
      const res = await apiFetch<{ success: boolean; data: Recipe[] }>("/recipes");
      setRecipes(res.data || []);
    } catch {
      setRecipes([]);
      addToast("Error al cargar los Key Visuals.", "error");
    }
    setLoadingRecipes(false);
  }, [addToast]);

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
      .catch(() => {
        addToast("Error al cargar los workspaces.", "error");
        loadTemplatesRef.current();
      });
  }, [addToast]);

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
    } catch {
      addToast("Error al crear el workspace.", "error");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`${API_BASE}/templates/${id}`, { method: "DELETE", headers: { "x-api-key": "dev-key" } });
      setTemplates(prev => prev.filter(t => t.id !== id));
    } catch {
      addToast("Error al eliminar la plantilla.", "error");
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      const res = await apiFetch<{ success: boolean; data: Template }>(`/templates/${id}/duplicate`, { method: "POST", body: "{}" });
      if (res.data) setTemplates(prev => [res.data, ...prev]);
    } catch {
      addToast("Error al duplicar la plantilla.", "error");
    }
  };

  const handleExport = async (id: string, name: string) => {
    try {
      const res = await apiFetch<any>(`/templates/${id}/export`);
      const blob = new Blob([JSON.stringify(res, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${name}.futuraria.json`;
      a.click(); URL.revokeObjectURL(url);
    } catch {
      addToast("Error al exportar la plantilla.", "error");
    }
  };

  const startWsRename = (id: string, name: string) => {
    setEditingWsId(id);
    setEditingWsName(name);
    setTimeout(() => editInputRef.current?.focus(), 50);
  };

  const commitWsRename = async () => {
    const id = editingWsId;
    const name = editingWsName.trim();
    if (!id || !name) { setEditingWsId(null); return; }
    try {
      await apiFetch('/workspaces/' + id, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, name } : w));
    } catch {
      addToast("Error al renombrar el workspace.", "error");
    }
    setEditingWsId(null);
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
      await mcpCall("update_html_frame", { templateId: id, name });
      setTemplates(prev => prev.map(t => t.id === id ? { ...t, name } : t));
    } catch {
      addToast("Error al renombrar la plantilla.", "error");
    }
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
    } catch {
      addToast("Error al eliminar el Key Visual.", "error");
    }
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
    } catch {
      addToast(`Error al crear desde "${recipeName}". Intenta de nuevo.`, "error");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      style={dashboardStyle}
      className="dash-atmosphere"
    >
      {/* Header — matches landing navbar: brand left, tabs+dropdown centered, search right */}
      <div style={dashHeaderStyle}>
        <div className="landing-nav-inner" style={{ maxWidth: 1200, width: "100%", position: "relative" }}>
          {/* Brand — identical to landing */}
          <div className="landing-brand" style={{ flexShrink: 0 }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="4" />
              <circle cx="12" cy="12" r="4" />
            </svg>
            <span>Futuraria</span>
          </div>

          {/* Centered: tabs + workspace dropdown */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "center", flex: 1 }}>
            {([
              { id: "templates", label: "Templates", icon: <IconFile size={14} /> },
              { id: "recipes", label: "Key Visuals", icon: <IconTag size={14} /> },
              { id: "data", label: "Data", icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <ellipse cx="12" cy="5" rx="9" ry="3" />
                  <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                </svg>
              )},
            ] as const).map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={activeTab === tab.id ? "liquid-glass dash-tab-active" : "liquid-glass dash-tab"}
                style={{
                  borderRadius: 100, padding: "8px 18px", fontSize: 13, cursor: "pointer",
                  fontWeight: 500,
                  display: "flex", alignItems: "center", gap: 6,
                  transition: "all 0.25s ease",
                }}
              >
                {tab.icon} {tab.label}
              </button>
            ))}

            {/* ── Glassmorphic Workspace Dropdown ── */}
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className="liquid-glass"
                onClick={() => setWsDropdownOpen(!wsDropdownOpen)}
                style={{
                  borderRadius: 100, padding: "8px 14px", fontSize: 13, cursor: "pointer",
                  fontWeight: 500, color: "rgba(0,0,0,0.6)",
                  display: "flex", alignItems: "center", gap: 6,
                  transition: "all 0.25s ease",
                }}
              >
                {selectedWs ? (workspaces.find(w => w.id === selectedWs)?.name || "Workspace") : "All Templates"}
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M2 3l3 4 3-4" />
                </svg>
              </button>
              {wsDropdownOpen && (
                <>
                  {/* Backdrop to close */}
                  <div
                    style={{ position: "fixed", inset: 0, zIndex: 49 }}
                    onClick={() => setWsDropdownOpen(false)}
                  />
                  {/* Dropdown menu */}
                  <div
                    className="liquid-glass"
                    style={{
                      position: "absolute", top: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)",
                      minWidth: 180, borderRadius: 12, padding: 6, zIndex: 50,
                      display: "flex", flexDirection: "column",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => { handleWsChange(null); setWsDropdownOpen(false); }}
                      style={{
                        ...dropdownItemStyle,
                        color: !selectedWs ? "#1a1a1a" : "rgba(0,0,0,0.6)",
                        background: !selectedWs ? "rgba(0,0,0,0.04)" : "transparent",
                      }}
                    >
                      All Templates
                    </button>
                    <div style={{ height: 1, background: "rgba(0,0,0,0.06)", margin: "4px 8px" }} />
                    {workspaces.map(w => (
                      editingWsId === w.id ? (
                        <div key={w.id} style={{ padding: "4px 10px" }}>
                          <input
                            ref={editInputRef}
                            value={editingWsName}
                            onChange={e => setEditingWsName(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") { commitWsRename(); setWsDropdownOpen(false); } if (e.key === "Escape") setEditingWsId(null); }}
                            onBlur={() => { commitWsRename(); }}
                            style={{ ...inputStyle, width: "100%", fontSize: 12, padding: "4px 8px" }}
                            autoFocus
                          />
                        </div>
                      ) : (
                        <button
                          key={w.id}
                          type="button"
                          onClick={() => { handleWsChange(w.id); setWsDropdownOpen(false); }}
                          onDoubleClick={() => startWsRename(w.id, w.name)}
                          title="Double-click to rename"
                          style={{
                            ...dropdownItemStyle,
                            color: selectedWs === w.id ? "#1a1a1a" : "rgba(0,0,0,0.6)",
                            background: selectedWs === w.id ? "rgba(0,0,0,0.04)" : "transparent",
                          }}
                        >
                          {w.name}
                        </button>
                      )
                    ))}
                    <div style={{ height: 1, background: "rgba(0,0,0,0.06)", margin: "4px 8px" }} />
                    {creatingWs ? (
                      <div style={{ padding: "4px 10px" }}>
                        <input
                          ref={newWsInputRef}
                          aria-label="New workspace name"
                          placeholder="Workspace name…"
                          value={newWsName}
                          onChange={e => setNewWsName(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") { handleCreateWorkspace(); setWsDropdownOpen(false); } if (e.key === "Escape") { setCreatingWs(false); setNewWsName(""); } }}
                          onBlur={() => { if (!newWsName.trim()) { setCreatingWs(false); } }}
                          style={{ ...inputStyle, width: "100%", fontSize: 12, padding: "4px 8px" }}
                          autoFocus
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setCreatingWs(true); setTimeout(() => newWsInputRef.current?.focus(), 50); }}
                        style={{
                          ...dropdownItemStyle,
                          color: "rgba(0,0,0,0.35)",
                        }}
                      >
                        + New Workspace
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Right: Search — replaces Enter Workspace button position */}
          <div style={{ flexShrink: 0 }}>
            <input
              aria-label="Search templates"
              placeholder="Search…"
              value={searchDisplay}
              onChange={e => handleSearch(e.target.value)}
              className="liquid-glass"
              style={{
                borderRadius: 100, padding: "8px 20px", fontSize: 13,
                color: "#1a1a1a", outline: "none",
                width: 180,
                background: "rgba(255,255,255,0.6)",
                border: "none",
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Metrics Bar ── */}
      <div className="dash-metrics-bar">
        <div className="dash-metric-card">
          <div className="dash-metric-value">{templates.length}</div>
          <div className="dash-metric-label">Templates</div>
          <div className="dash-metric-sub">
            {templates.reduce((sum, t) => sum + (t.frames?.length || 0), 0)} frames
          </div>
        </div>
        <div className="dash-metric-card">
          <div className="dash-metric-value">{recipes.length}</div>
          <div className="dash-metric-label">Key Visuals</div>
          <div className="dash-metric-sub">
            {recipes.reduce((sum, r) => sum + (r.usageCount || 0), 0)} executions
          </div>
        </div>
        <div className="dash-metric-card">
          <div className="dash-metric-value">{workspaces.length}</div>
          <div className="dash-metric-label">Workspaces</div>
          <div className="dash-metric-sub">
            {selectedWs ? "1 active" : "all shown"}
          </div>
        </div>
        <div className="dash-metric-card" style={{ justifyContent: "center" }}>
          <div className="dash-metric-label" style={{ marginBottom: 4 }}>Most Used</div>
          <div className="dash-metric-value" style={{ fontSize: 18, fontWeight: 600 }}>
            {(() => {
              const most = [...templates].sort((a, b) => (b.frames?.length || 0) - (a.frames?.length || 0))[0];
              return most ? (most.name.length > 24 ? most.name.slice(0, 22) + "…" : most.name) : "—";
            })()}
          </div>
          <div className="dash-metric-sub">
            Most frames
          </div>
        </div>
      </div>

      {/* Template Grid */}
      {activeTab === "templates" && (
      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {loading ? (
          <div style={{ textAlign: "center", color: "rgba(0,0,0,0.3)", padding: 60 }}>Loading…</div>
        ) : templates.length === 0 ? (
          <div style={{ textAlign: "center", color: "rgba(0,0,0,0.3)", padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}><IconFile size={40} color="rgba(0,0,0,0.2)" /></div>
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 28 }}>
            {templates.map(t => {
              const hasHtml = t.engine === "html" && t.frames?.[0]?.html;
              return (
              <div
                key={t.id}
                className="dash-card"
                style={cardStyle}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,0,0,0.12)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 3px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.08)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,0,0,0.06)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 3px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.04)"; }}
                onClick={() => onSelectTemplate(t.id)}
              >
                {/* Full-bleed blurred design background */}
                <div style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: 14 }}>
                  {hasHtml ? (
                    <iframe
                      srcDoc={`<!DOCTYPE html><html><head><style>body{margin:0;overflow:hidden;width:${t.width}px;height:${t.height}px;transform:scale(0.22);transform-origin:top left;background:${t.frames?.[0]?.background || "#0d0d1a"}}${t.frames?.[0]?.css || ""}</style></head><body style="width:${t.width}px;height:${t.height}px">${t.frames?.[0]?.html || ""}</body></html>`}
                      sandbox="allow-same-origin allow-scripts"
                      className="card-preview"
                      style={{ width: "100%", height: "100%", border: "none", pointerEvents: "none" }}
                      title={t.name}
                    />
                  ) : (
                    <div style={{ width:"100%", height:"100%", background: "linear-gradient(135deg, #e8e4df, #d5cfc8)" }} />
                  )}
                  {/* Frosted overlay */}
                  <div style={cardOverlay} />
                </div>

                {/* Content overlay */}
                <div style={cardContentStyle}>
                  <div style={{ flex: 1 }} />
                  {/* Info panel — glass on top of blurred design */}
                  <div style={cardInfoPanel}>
                    {editingTplId === t.id ? (
                      <input
                        ref={editInputRef}
                        value={editingTplName}
                        onChange={e => setEditingTplName(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditingTplId(null); }}
                        onBlur={commitRename}
                        style={{ width: "100%", fontSize: 12, padding: "2px 4px", border: "1px solid rgba(0,0,0,0.15)", borderRadius: 6, outline: "none" }}
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <div
                        style={{ fontFamily: "'Instrument Serif', serif", fontSize: 16, fontWeight: 400, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(255,255,255,0.9)", textShadow: "0 0 6px rgba(0,0,0,0.6)", cursor: "text", letterSpacing: "-0.01em" }}
                        onDoubleClick={e => { e.stopPropagation(); startRename(t.id, t.name); }}
                        title="Double-click to rename"
                      >{t.name}</div>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textShadow: "0 0 4px rgba(0,0,0,0.5)" }}>{new Date(t.metadata.updatedAt).toLocaleDateString()}</div>
                      {t.engine === "html" && (
                        <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.6)", fontWeight: 500 }}>HTML</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Action buttons — visible on hover */}
                <div className="dash-card-actions" style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 3, display: "flex", borderTop: "1px solid rgba(0,0,0,0.04)", fontSize: 12 }}>
                  <button type="button" onClick={e => { e.stopPropagation(); startRename(t.id, t.name); }} style={cardAction}>Rename</button>
                  <button type="button" onClick={e => { e.stopPropagation(); handleDuplicate(t.id); }} style={cardAction}>Copy</button>
                  <button type="button" onClick={e => { e.stopPropagation(); handleExport(t.id, t.name); }} style={cardAction}>Export</button>
                  <button type="button" onClick={e => { e.stopPropagation(); handleDelete(t.id); }} style={{ ...cardAction, color: "#d32f2f" }} className="dash-card-action-danger">Delete</button>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* Key Visuals / Recipes Grid */}
      {activeTab === "recipes" && (
      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {loadingRecipes ? (
          <div style={{ textAlign: "center", color: "rgba(0,0,0,0.3)", padding: 60 }}>Loading...</div>
        ) : recipes.length === 0 ? (
          <div style={{ textAlign: "center", color: "rgba(0,0,0,0.3)", padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}><IconTag size={40} color="rgba(0,0,0,0.2)" /></div>
            <div>No Key Visuals saved yet.</div>
            <div style={{ fontSize: 11, marginTop: 4, opacity: 0.6 }}>
              Open a template in the editor and click the tag icon to save it as a Key Visual.
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 28 }}>
            {recipes.map(r => (
              <div
                key={r.id}
                className="dash-card"
                style={cardStyle}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,0,0,0.12)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 3px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.08)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,0,0,0.06)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 3px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.04)"; }}
                onClick={() => handleCreateFromRecipe(r.id, r.name)}
              >
                {/* Full-bleed background */}
                <div style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: 14, background: "linear-gradient(135deg, #f0ece6, #e2ddd5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <IconTag size={40} color="rgba(0,0,0,0.08)" />
                  <div style={cardOverlay} />
                </div>

                {/* Content overlay */}
                <div style={cardContentStyle}>
                  <div style={{ flex: 1 }} />
                  <div style={cardInfoPanel}>
                    <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 16, fontWeight: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(255,255,255,0.9)", textShadow: "0 0 6px rgba(0,0,0,0.6)", letterSpacing: "-0.01em" }}>{r.name}</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textShadow: "0 0 4px rgba(0,0,0,0.5)" }}>
                      {r.description || "No description"}
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 6, fontSize: 11, color: "rgba(255,255,255,0.4)", textShadow: "0 0 4px rgba(0,0,0,0.4)" }}>
                      <span>Used: {r.usageCount || 0}×</span>
                      <span>{new Date(r.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="dash-card-actions" style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 3, display: "flex", borderTop: "1px solid rgba(0,0,0,0.04)", fontSize: 12 }}>
                  <button type="button" onClick={e => { e.stopPropagation(); handleCreateFromRecipe(r.id, r.name); }} style={cardAction}>
                    Create
                  </button>
                  <button type="button" onClick={e => { e.stopPropagation(); handleDeleteRecipe(r.id); }} style={{ ...cardAction, color: "#d32f2f" }} className="dash-card-action-danger">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* ── Data Tab ── */}
      {activeTab === "data" && (
        <div style={{ flex: 1, overflowY: "auto", padding: 32, maxWidth: 800, margin: "0 auto", width: "100%" }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Your Data</h2>
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, marginBottom: 24 }}>
            What Futuraria stores in your Supabase database.
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Table</th>
                <th>Rows</th>
                <th>What it stores</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code style={{ color: "rgba(255,255,255,0.7)", fontSize: 11 }}>templates</code></td>
                <td>{templates.length}</td>
                <td>Your design files — frames, HTML, CSS, metadata</td>
              </tr>
              <tr>
                <td><code style={{ color: "rgba(255,255,255,0.7)", fontSize: 11 }}>recipes</code></td>
                <td>{recipes.length}</td>
                <td>Key Visuals — reusable design patterns with variables</td>
              </tr>
              <tr>
                <td><code style={{ color: "rgba(255,255,255,0.7)", fontSize: 11 }}>workspaces</code></td>
                <td>{workspaces.length}</td>
                <td>Organization folders for your projects</td>
              </tr>
              <tr>
                <td><code style={{ color: "rgba(255,255,255,0.7)", fontSize: 11 }}>design_assets</code></td>
                <td>—</td>
                <td>Extracted design tokens, styles, and artifacts</td>
              </tr>
            </tbody>
          </table>
          <div style={{ marginTop: 20, padding: 12, background: "rgba(255,255,255,0.02)", borderRadius: 10, fontSize: 12, color: "rgba(255,255,255,0.35)", lineHeight: 1.6 }}>
            <strong style={{ color: "rgba(255,255,255,0.6)" }}>Tip:</strong> Notice patterns in your designs by watching which Key Visuals get reused. The more you create, the more you can automate.
          </div>
        </div>
      )}
    </motion.div>
  );
}

const dashboardStyle: React.CSSProperties = {
  height: "100vh", background: "#f5f0eb", color: "#1a1a1a",
  fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  display: "flex", flexDirection: "column",
  overflow: "hidden",
};

const dashHeaderStyle: React.CSSProperties = {
  padding: "24px 24px 0",
  background: "transparent",
  zIndex: 10,
  position: "relative",
  width: "100%",
  display: "flex", justifyContent: "center",
};

const inputStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(0, 0, 0, 0.12)",
  color: "#1a1a1a",
  borderRadius: 100, padding: "8px 16px", fontSize: 13, outline: "none",
  transition: "border-color 0.2s ease",
};

const btnPrimary: React.CSSProperties = {
  background: "rgba(0, 0, 0, 0.05)",
  border: "1px solid rgba(0, 0, 0, 0.12)", color: "#1a1a1a",
  borderRadius: 100, padding: "8px 20px", fontSize: 13, cursor: "pointer", fontWeight: 500,
  transition: "all 0.2s ease",
};

const btnSecondary: React.CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(0, 0, 0, 0.08)", color: "rgba(0, 0, 0, 0.5)",
  borderRadius: 100, padding: "8px 16px", fontSize: 13, cursor: "pointer",
  transition: "all 0.2s ease",
};

const cardStyle: React.CSSProperties = {
  position: "relative", height: 200, borderRadius: 14,
  overflow: "hidden", cursor: "pointer",
  transition: "all 0.25s ease",
  border: "1px solid rgba(0,0,0,0.06)",
  boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.04)",
  background: "#ffffff",
};

const cardOverlay: React.CSSProperties = {
  position: "absolute", inset: 0, zIndex: 0,
  background: "rgba(255,255,255,0.15)",
  backdropFilter: "blur(3px) saturate(0.4)",
  WebkitBackdropFilter: "blur(3px) saturate(0.4)",
};

const cardContentStyle: React.CSSProperties = {
  position: "relative", zIndex: 2,
  display: "flex", flexDirection: "column",
  height: "100%", padding: 12,
};

const cardInfoPanel: React.CSSProperties = {
  marginTop: "auto",
  borderRadius: 10, padding: "10px 12px",
};

const cardAction: React.CSSProperties = {
  flex: 1, background: "none", border: "none", borderRight: "1px solid rgba(0,0,0,0.06)",
  color: "transparent", fontSize: 12, cursor: "pointer", padding: "6px 0",
  transition: "color 0.2s ease",
};

const dropdownItemStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  padding: "8px 12px", borderRadius: 8, fontSize: 13,
  background: "transparent", border: "none",
  color: "rgba(0,0,0,0.6)",
  cursor: "pointer", textAlign: "left" as const,
  fontFamily: "inherit", fontWeight: 400,
  transition: "all 0.15s ease",
};
