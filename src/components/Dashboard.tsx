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
  const [activeTab, setActiveTab] = useState<"templates" | "recipes" | "data" | "settings">("templates");
  const [cardMode, setCardMode] = useState<"grid" | "flow">(() => {
    try { return localStorage.getItem("futuraria-card-mode") as "grid" | "flow" || "grid"; } catch { return "grid"; }
  });
  const [flowIndex, setFlowIndex] = useState(0);
  const flowScrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const CARD_WIDTH = 220;
  const CARD_GAP = 16;

  /* Scroll one card at a time to a specific index — no half-stops */
  const scrollToCard = useCallback((idx: number) => {
    const el = flowScrollRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(idx, templates.length - 1));
    const target = clamped * (CARD_WIDTH + CARD_GAP);
    el.scrollTo({ left: target, behavior: "smooth" });
  }, [templates.length]);

  /* Debounced scroll handler — prevents laggy state updates mid-scroll */
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleFlowScroll = useCallback(() => {
    const el = flowScrollRef.current;
    if (!el) return;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      const center = el.scrollLeft + el.clientWidth / 2;
      const idx = Math.round((center - CARD_WIDTH / 2) / (CARD_WIDTH + CARD_GAP));
      setFlowIndex(Math.max(0, Math.min(idx, templates.length - 1)));
    }, 60);
  }, [templates.length]);
  const handleCardModeChange = (mode: "grid" | "flow") => {
    setCardMode(mode);
    try { localStorage.setItem("futuraria-card-mode", mode); } catch {}
  };
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

  /* Global keyboard shortcuts: arrows for flow, Alt/Cmd+Space for search */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      /* Alt+Space (Windows) / Cmd+Space (Mac) → focus search */
      if ((e.altKey || e.metaKey) && e.code === "Space") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      /* Arrow keys → navigate flow (only when flow is active and search not focused) */
      if (cardMode === "flow" && activeTab === "templates" && document.activeElement?.tagName !== "INPUT") {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          scrollToCard(flowIndex - 1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          scrollToCard(flowIndex + 1);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cardMode, activeTab, flowIndex, scrollToCard]);

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

  const renderTemplateCard = (t: Template, i?: number) => {
    const hasHtml = t.engine === "html" && t.frames?.[0]?.html;
    const dist = i !== undefined ? i - flowIndex : 0;
    const absDist = Math.abs(dist);
    const isCenter = dist === 0;
    const isFlow = i !== undefined && cardMode === "flow";
    const rotY = isCenter ? 0 : dist > 0 ? -42 : 42;
    const scaleVal = isCenter ? 1.1 : Math.max(0.6, 1 - absDist * 0.12);
    const translateZ = isCenter ? 60 : -absDist * 50;
    const opacityVal = Math.max(0.2, 1 - absDist * 0.25);

    /* Shared iframe markup */
    const previewIframe = hasHtml ? (
      <iframe
        srcDoc={`<!DOCTYPE html><html><head><style>body{margin:0;overflow:hidden;width:${t.width}px;height:${t.height}px;transform:scale(0.22);transform-origin:top left;background:${t.frames?.[0]?.background || "#0d0d1a"}}${t.frames?.[0]?.css || ""}</style></head><body style="width:${t.width}px;height:${t.height}px">${t.frames?.[0]?.html || ""}</body></html>`}
        sandbox="allow-same-origin allow-scripts"
        className="card-preview"
        style={{ width: "100%", height: "100%", border: "none", pointerEvents: "none" }}
        title={t.name}
      />
    ) : (
      <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg, #e8e4df, #d5cfc8)" }} />
    );

    /* Shared metadata + actions block (rendered inside card for grid, below for flow) */
    const metaBlock = (
      <>
        {editingTplId === t.id ? (
          <input
            ref={editInputRef}
            value={editingTplName}
            onChange={e => setEditingTplName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditingTplId(null); }}
            onBlur={commitRename}
            style={{ width: "100%", fontSize: 12, padding: "2px 4px", border: "1px solid rgba(0,0,0,0.15)", borderRadius: 6, outline: "none", background: "rgba(255,255,255,0.05)", color: "#fff" }}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <div
            style={{ fontFamily: "'Instrument Serif', serif", fontSize: 15, fontWeight: 400, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(255,255,255,0.9)", letterSpacing: "-0.01em" }}
            onDoubleClick={e => { e.stopPropagation(); startRename(t.id, t.name); }}
            title="Double-click to rename"
          >{t.name}</div>
        )}
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 6 }}>Edited {new Date(t.metadata.updatedAt).toLocaleDateString()}</div>
        <div style={{ display: "flex", gap: 4 }}>
          <button type="button" onClick={e => { e.stopPropagation(); startRename(t.id, t.name); }} style={{ ...cardAction, borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)" }}>Rename</button>
          <button type="button" onClick={e => { e.stopPropagation(); handleDuplicate(t.id); }} style={{ ...cardAction, borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)" }}>Copy</button>
          <button type="button" onClick={e => { e.stopPropagation(); handleDelete(t.id); }} style={{ ...cardAction, borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", color: "#f87171" }}>Delete</button>
        </div>
      </>
    );

    /* ── FLOW MODE: card is pure preview, metadata below outside ── */
    if (isFlow) {
      return (
        <div
          key={t.id}
          style={{
            width: CARD_WIDTH, flexShrink: 0,
            transform: `rotateY(${rotY}deg) scale(${scaleVal}) translateZ(${translateZ}px)`,
            opacity: opacityVal,
            transition: "transform 0.4s ease, opacity 0.4s ease",
            scrollSnapAlign: "center" as any,
            transformStyle: "preserve-3d",
            zIndex: 100 - absDist,
            display: "flex", flexDirection: "column", alignItems: "center",
          }}
        >
          {/* The card itself — clean preview, no overlay, no info inside */}
          <div
            className="dash-card flow-card"
            style={{
              ...cardStyle,
              width: CARD_WIDTH, height: 300,
              borderRadius: 12,
              cursor: "pointer",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.2)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 12px 40px rgba(0,0,0,0.6)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 30px rgba(0,0,0,0.5)"; }}
            onClick={() => onSelectTemplate(t.id)}
          >
            <div style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: 12 }}>
              {previewIframe}
            </div>
          </div>

          {/* Metadata + actions — below the card, outside */}
          <div style={{ width: CARD_WIDTH, marginTop: 12, padding: "0 4px", textAlign: "center" }}>
            {metaBlock}
          </div>
        </div>
      );
    }

    /* ── GRID MODE: original layout with frosted info panel inside card */
    return (
    <div
      key={t.id}
      className="dash-card"
      style={{ ...cardStyle }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.2)"; (e.currentTarget as HTMLElement).style.boxShadow = "inset 0 1px 1px rgba(255,255,255,0.1), 0 4px 16px rgba(0,0,0,0.3)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)"; (e.currentTarget as HTMLElement).style.boxShadow = "inset 0 1px 1px rgba(255,255,255,0.1), 0 2px 8px rgba(0,0,0,0.2)"; }}
      onClick={() => onSelectTemplate(t.id)}
    >
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: 14 }}>
        {previewIframe}
        <div style={cardOverlay} />
      </div>
      <div style={cardContentStyle}>
        <div style={{ flex: 1 }} />
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
      <div className="dash-card-actions" style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 3, display: "flex", borderTop: "1px solid rgba(255, 255, 255, 0.02)", fontSize: 12 }}>
        <button type="button" onClick={e => { e.stopPropagation(); startRename(t.id, t.name); }} style={cardAction}>Rename</button>
        <button type="button" onClick={e => { e.stopPropagation(); handleDuplicate(t.id); }} style={cardAction}>Copy</button>
        <button type="button" onClick={e => { e.stopPropagation(); handleExport(t.id, t.name); }} style={cardAction}>Export</button>
        <button type="button" onClick={e => { e.stopPropagation(); handleDelete(t.id); }} style={{ ...cardAction, color: "#f87171" }} className="dash-card-action-danger">Delete</button>
      </div>
    </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      style={dashboardStyle}
      className="dash-atmosphere"
    >
      {/* ── Background video ── */}
      <video
        src="/animated-bg.mp4"
        muted
        autoPlay
        loop
        playsInline
        preload="auto"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "bottom",
          pointerEvents: "none",
          opacity: 1,
          zIndex: 0,
        }}
      />

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
              { id: "settings", label: "Settings", icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
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
                  fontWeight: 500, color: "rgba(255,255,255,0.7)",
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
                        color: !selectedWs ? "#ffffff" : "rgba(255,255,255,0.6)",
                        background: !selectedWs ? "rgba(255,255,255,0.06)" : "transparent",
                      }}
                    >
                      All Templates
                    </button>
                    <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "4px 8px" }} />
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
                            color: selectedWs === w.id ? "#ffffff" : "rgba(255,255,255,0.6)",
                            background: selectedWs === w.id ? "rgba(255,255,255,0.06)" : "transparent",
                          }}
                        >
                          {w.name}
                        </button>
                      )
                    ))}
                    <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "4px 8px" }} />
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
                          color: "rgba(255,255,255,0.4)",
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
              ref={searchInputRef}
              aria-label="Search templates"
              placeholder="Search… (Alt+Space)"
              value={searchDisplay}
              onChange={e => handleSearch(e.target.value)}
              className="liquid-glass"
              style={{
                borderRadius: 100, padding: "8px 20px", fontSize: 13,
                color: "#ffffff", outline: "none",
                width: 180,
                background: "rgba(255,255,255,0.01)",
                border: "none",
              }}
            />
          </div>
        </div>
      </div>

      {/* Template Grid */}
      {activeTab === "templates" && (
      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {loading ? (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", padding: 60 }}>Loading…</div>
        ) : templates.length === 0 ? (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}><IconFile size={40} color="rgba(255,255,255,0.3)" /></div>
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
        ) : cardMode === "flow" ? (
          <div style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%" }}>
            <div
              ref={flowScrollRef}
              onScroll={handleFlowScroll}
              className="flow-track"
              style={{
                display: "flex", gap: CARD_GAP, overflowX: "auto", overflowY: "hidden",
                scrollSnapType: "x mandatory", scrollBehavior: "smooth",
                perspective: "1200px", perspectiveOrigin: "center",
                padding: "60px 0 20px", alignItems: "center",
                WebkitOverflowScrolling: "touch",
                flex: 1,
              }}
            >
              {templates.map((t, i) => renderTemplateCard(t, i))}
            </div>
            {/* Arrow buttons — glassmorphic, positioned at metadata height with spacing */}
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "40%", padding: "12px 0 24px" }}>
              <button
                type="button"
                onClick={() => scrollToCard(flowIndex - 1)}
                disabled={flowIndex <= 0}
                className="liquid-glass"
                aria-label="Previous"
                style={{
                  borderRadius: "50%", width: 44, height: 44, border: "none", cursor: flowIndex <= 0 ? "default" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  opacity: flowIndex <= 0 ? 0.2 : 0.7,
                  transition: "all 0.2s ease", background: "rgba(255,255,255,0.03)",
                  color: "rgba(255,255,255,0.8)", flexShrink: 0,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <button
                type="button"
                onClick={() => scrollToCard(flowIndex + 1)}
                disabled={flowIndex >= templates.length - 1}
                className="liquid-glass"
                aria-label="Next"
                style={{
                  borderRadius: "50%", width: 44, height: 44, border: "none", cursor: flowIndex >= templates.length - 1 ? "default" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  opacity: flowIndex >= templates.length - 1 ? 0.2 : 0.7,
                  transition: "all 0.2s ease", background: "rgba(255,255,255,0.03)",
                  color: "rgba(255,255,255,0.8)", flexShrink: 0,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 28 }}>
            {templates.map(t => renderTemplateCard(t))}
          </div>
        )}
      </div>
      )}

      {/* Key Visuals / Recipes Grid */}
      {activeTab === "recipes" && (
      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {loadingRecipes ? (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", padding: 60 }}>Loading...</div>
        ) : recipes.length === 0 ? (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}><IconTag size={40} color="rgba(255,255,255,0.3)" /></div>
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
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.2)"; (e.currentTarget as HTMLElement).style.boxShadow = "inset 0 1px 1px rgba(255,255,255,0.1), 0 4px 16px rgba(0,0,0,0.3)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)"; (e.currentTarget as HTMLElement).style.boxShadow = "inset 0 1px 1px rgba(255,255,255,0.1), 0 2px 8px rgba(0,0,0,0.2)"; }}
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
                <div className="dash-card-actions" style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 3, display: "flex", borderTop: "1px solid rgba(255, 255, 255, 0.02)", fontSize: 12 }}>
                  <button type="button" onClick={e => { e.stopPropagation(); handleCreateFromRecipe(r.id, r.name); }} style={cardAction}>
                    Create
                  </button>
                  <button type="button" onClick={e => { e.stopPropagation(); handleDeleteRecipe(r.id); }} style={{ ...cardAction, color: "#f87171" }} className="dash-card-action-danger">
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

      {/* ── Settings Tab ── */}
      {activeTab === "settings" && (() => {
        const totalFrames = templates.reduce((sum, t) => sum + (t.frames?.length || 0), 0);
        const estimatedTokens = (templates.length * 2000) + (totalFrames * 500) + (recipes.length * 100);
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
        const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
        const supabaseConnected = !!(supabaseUrl && supabaseKey);
        const handleDownloadSkill = async () => {
          try {
            const res = await fetch("/SKILL.md");
            const text = await res.text();
            const blob = new Blob([text], { type: "text/markdown" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = "SKILL.md"; a.click();
            URL.revokeObjectURL(url);
          } catch { alert("Could not download SKILL.md"); }
        };

        return (
        <div style={{ flex: 1, overflowY: "auto", padding: 32, maxWidth: 900, margin: "0 auto", width: "100%" }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 24, display: "flex", alignItems: "center", gap: 10 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            Settings
          </h2>

          {/* ── Metrics ── */}
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>Usage</h3>
          <div className="dash-metrics-bar" style={{ marginBottom: 32 }}>
            <div className="dash-metric-card">
              <div className="dash-metric-value">{templates.length}</div>
              <div className="dash-metric-label">Templates</div>
              <div className="dash-metric-sub">{totalFrames} frames</div>
            </div>
            <div className="dash-metric-card">
              <div className="dash-metric-value">{recipes.length}</div>
              <div className="dash-metric-label">Key Visuals</div>
              <div className="dash-metric-sub">{recipes.reduce((sum, r) => sum + (r.usageCount || 0), 0)} executions</div>
            </div>
            <div className="dash-metric-card">
              <div className="dash-metric-value">{workspaces.length}</div>
              <div className="dash-metric-label">Workspaces</div>
              <div className="dash-metric-sub">{selectedWs ? "1 active" : "all shown"}</div>
            </div>
            <div className="dash-metric-card" style={{ justifyContent: "center" }}>
              <div className="dash-metric-label" style={{ marginBottom: 4 }}>Most Used</div>
              <div className="dash-metric-value" style={{ fontSize: 18, fontWeight: 600 }}>
                {(() => { const most = [...templates].sort((a, b) => (b.frames?.length || 0) - (a.frames?.length || 0))[0]; return most ? (most.name.length > 24 ? most.name.slice(0, 22) + "…" : most.name) : "—"; })()}
              </div>
              <div className="dash-metric-sub">Most frames</div>
            </div>
          </div>

          {/* ── Display Mode ── */}
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>Display</h3>
          <div className="liquid-glass" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderRadius: 14, marginBottom: 32 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 14 }}>🎴</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.8)" }}>Card View</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
                  {cardMode === "grid" ? "Grid layout (current)" : "Cover Flow (perspective slider)"}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,0.03)", borderRadius: 100, padding: 3 }}>
              <button
                type="button"
                onClick={() => handleCardModeChange("grid")}
                style={{
                  borderRadius: 100, padding: "6px 16px", fontSize: 12, fontWeight: 500,
                  border: "none", cursor: "pointer", transition: "all 0.2s ease",
                  background: cardMode === "grid" ? "rgba(255,255,255,0.08)" : "transparent",
                  color: cardMode === "grid" ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)",
                }}
              >Grid</button>
              <button
                type="button"
                onClick={() => handleCardModeChange("flow")}
                style={{
                  borderRadius: 100, padding: "6px 16px", fontSize: 12, fontWeight: 500,
                  border: "none", cursor: "pointer", transition: "all 0.2s ease",
                  background: cardMode === "flow" ? "rgba(255,255,255,0.08)" : "transparent",
                  color: cardMode === "flow" ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)",
                }}
              >Flow</button>
            </div>
          </div>

          {/* ── Connection ── */}
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>Connection</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 32 }}>
            <div className="liquid-glass" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderRadius: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14 }}>🗄️</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.8)" }}>Supabase</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
                    {supabaseConnected ? supabaseUrl : "Not configured"}
                  </div>
                </div>
              </div>
              <span style={{
                fontSize: 11, fontWeight: 600,
                padding: "4px 10px", borderRadius: 100,
                background: supabaseConnected ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.05)",
                color: supabaseConnected ? "#4ade80" : "rgba(255,255,255,0.35)",
              }}>
                {supabaseConnected ? "● Connected" : "○ Inactive"}
              </span>
            </div>
            <div className="liquid-glass" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderRadius: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14 }}>🤖</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.8)" }}>MCP API</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>/mcp — Model Context Protocol</div>
                </div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 100, background: "rgba(34,197,94,0.12)", color: "#4ade80" }}>● Active</span>
            </div>
          </div>

          {/* ── AI Configuration ── */}
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>AI Configuration</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 32 }}>
            <div className="liquid-glass" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderRadius: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14 }}>🧠</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.8)" }}>Model</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>Gemini (via MCP JSON-RPC)</div>
                </div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 100, background: "rgba(99,102,241,0.12)", color: "#818cf8" }}>AI-Ready</span>
            </div>
            <div className="liquid-glass" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderRadius: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14 }}>📊</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.8)" }}>Token Usage (est.)</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
                    {templates.length} templates × 2k + {totalFrames} frames × 500
                  </div>
                </div>
              </div>
              <span style={{ fontSize: 16, fontWeight: 700, fontFamily: "'Instrument Serif', serif", color: "rgba(255,255,255,0.9)" }}>
                ~{estimatedTokens.toLocaleString()} tokens
              </span>
            </div>
          </div>

          {/* ── Agent Onboarding ── */}
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>Agent Onboarding</h3>
          <div className="liquid-glass" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderRadius: 14, marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 14 }}>📄</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.8)" }}>SKILL.md</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>Agent capability manifest — download for your AI</div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleDownloadSkill}
              className="liquid-glass"
              style={{ borderRadius: 100, padding: "8px 18px", fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.7)", cursor: "pointer", border: "none", transition: "all 0.2s ease" }}
            >
              Download
            </button>
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", lineHeight: 1.6, marginTop: 4 }}>
            Give SKILL.md to any AI agent. It teaches them Futuraria's tools, project structure, and design conventions — so they can design alongside you.
          </div>
        </div>
        );
      })()}
    </motion.div>
  );
}

const dashboardStyle: React.CSSProperties = {
  height: "100vh", background: "#000000", color: "#ffffff",
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
  border: "1px solid rgba(255, 255, 255, 0.12)",
  color: "#ffffff",
  borderRadius: 100, padding: "8px 16px", fontSize: 13, outline: "none",
  transition: "border-color 0.2s ease",
};

const btnPrimary: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.06)",
  border: "1px solid rgba(255, 255, 255, 0.15)", color: "#ffffff",
  borderRadius: 100, padding: "8px 20px", fontSize: 13, cursor: "pointer", fontWeight: 500,
  transition: "all 0.2s ease",
};

const btnSecondary: React.CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(255, 255, 255, 0.08)", color: "rgba(255, 255, 255, 0.6)",
  borderRadius: 100, padding: "8px 16px", fontSize: 13, cursor: "pointer",
  transition: "all 0.2s ease",
};

const cardStyle: React.CSSProperties = {
  position: "relative", height: 200, borderRadius: 14,
  overflow: "hidden", cursor: "pointer",
  transition: "all 0.25s ease",
  background: "rgba(255, 255, 255, 0.01)",
  backdropFilter: "blur(4px)",
  WebkitBackdropFilter: "blur(4px)",
  border: "1px solid rgba(255, 255, 255, 0.06)",
  boxShadow: "inset 0 1px 1px rgba(255,255,255,0.1), 0 2px 8px rgba(0,0,0,0.2)",
};

const cardOverlay: React.CSSProperties = {
  position: "absolute", inset: 0, zIndex: 0,
  background: "rgba(255,255,255,0.015)",
  backdropFilter: "blur(3px) saturate(0.4)",
  WebkitBackdropFilter: "blur(3px) saturate(0.4)",
};

const cardContentStyle: React.CSSProperties = {
  position: "relative", zIndex: 2,
  display: "flex", flexDirection: "column",
  height: "100%", padding: 0,
};

const cardInfoPanel: React.CSSProperties = {
  marginTop: "auto",
  borderRadius: "0 0 10px 10px", padding: 0,
  background: "rgba(255, 255, 255, 0.04)",
  backdropFilter: "blur(12px) saturate(1.2)",
  WebkitBackdropFilter: "blur(12px) saturate(1.2)",
  border: "1px solid rgba(255, 255, 255, 0.06)",
};

const cardAction: React.CSSProperties = {
  flex: 1, background: "none", border: "none", borderRight: "1px solid rgba(255, 255, 255, 0.04)",
  color: "transparent", fontSize: 12, cursor: "pointer", padding: "6px 0",
  transition: "color 0.2s ease",
};

const dropdownItemStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  padding: "8px 12px", borderRadius: 8, fontSize: 13,
  background: "transparent", border: "none",
  color: "rgba(255,255,255,0.6)",
  cursor: "pointer", textAlign: "left" as const,
  fontFamily: "inherit", fontWeight: 400,
  transition: "all 0.15s ease",
};
