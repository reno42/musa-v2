import { useState, useEffect, useCallback, useMemo, useRef, useReducer } from "react";
import { motion } from "framer-motion";
import html2canvas from "html2canvas";
import { IconFolder, IconFile, IconTag } from "../shared/icons";
import { GraphTab } from "./GraphTab";
import { CoverFlow } from "./CoverFlow";
import { StorageTab } from "./StorageTab";
import { TextsTab } from "./TextsTab";
import { mcpCall } from "../lib/mcpClient";
import { useToast } from "./Toast";
import { getApiHeaders, getApiKey, setApiKey, clearApiKey, hasApiKey } from "../lib/apiKey";
import { OnboardingTour, isOnboardingEnabled, setOnboardingEnabled, restartOnboarding, type TourAction } from "./OnboardingTour";
import { WorkspaceConsole } from "./WorkspaceConsole";
import { useAuth } from "../lib/auth";
import { browserSupabase } from "../lib/supabaseClient";

interface Template {
  id: string;
  name: string;
  slug?: string;
  width: number;
  height: number;
  engine?: "html";
  workspaceId: string;
  thumbnail?: string;
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
  slug?: string;
}

interface Brand {
  id: string;
  name: string;
  relationship_status?: string;
}

const DEFAULT_WORKSPACE_ID = "ws_user_8e9f031817184e0ab205";

interface DashboardProps {
  onSelectTemplate: (id: string, slugInfo?: { wsSlug?: string; tplSlug?: string }) => void;
  onCreateHtmlTemplate: (workspaceId: string, name: string) => void;
}

const API_BASE = "/api";

async function apiFetch<T = any>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: getApiHeaders(),
    ...options,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

/* ── Stale-while-revalidate cache ──
   Shows cached templates instantly on dashboard return,
   then silently refreshes from the server in background. */
const TEMPLATE_CACHE_KEY = "futuraria-tpl-cache-v1";
const API_KEY_BANNER_DISMISSED_KEY = "futuraria-api-key-banner-dismissed";

function readTemplateCache(): Template[] {
  try {
    const raw = localStorage.getItem(TEMPLATE_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.data) ? parsed.data : [];
  } catch { return []; }
}

function writeTemplateCache(data: Template[]) {
  try {
    localStorage.setItem(TEMPLATE_CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
  } catch { /* quota exceeded — cache is best-effort */ }
}

/** Deterministic brand accent color — stable across sessions. */
const BRAND_PALETTE = [
  "#6366f1", "#a855f7", "#06b6d4", "#f59e0b", "#10b981",
  "#ec4899", "#f97316", "#8b5cf6", "#14b8a6", "#e11d48",
  "#3b82f6", "#d946ef", "#84cc16", "#64748b", "#f43f5e",
];
function brandAccent(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash) + id.charCodeAt(i) | 0;
  return BRAND_PALETTE[Math.abs(hash) % BRAND_PALETTE.length];
}

export function Dashboard({ onSelectTemplate, onCreateHtmlTemplate }: DashboardProps) {
  const { addToast } = useToast();
  const { user, configured: authConfigured, authRequired, signOut } = useAuth();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [authConfigChecked, setAuthConfigChecked] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [templates, setTemplates] = useState<Template[]>(() => readTemplateCache());
  const [selectedWs, setSelectedWs] = useState<string | null>(DEFAULT_WORKSPACE_ID);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandCounts, setBrandCounts] = useState<Map<string, number>>(new Map());
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [searchDisplay, setSearchDisplay] = useState("");
  const [creatingWs, setCreatingWs] = useState(false);
  const [newWsName, setNewWsName] = useState("");
  const [editingWsId, setEditingWsId] = useState<string | null>(null);
  const [editingWsName, setEditingWsName] = useState("");
  const [editingTplId, setEditingTplId] = useState<string | null>(null);
  const [editingTplName, setEditingTplName] = useState("");
  const [creatingTpl, setCreatingTpl] = useState(false);
  const [newTplName, setNewTplName] = useState("");
  const [activeTab, setActiveTab] = useState<"templates" | "texts" | "recipes" | "storage" | "settings" | "graph" | "workspace">("templates");
  const [tourEnabled, setTourEnabled] = useState(() => isOnboardingEnabled());
  const [cardMode, setCardMode] = useState<"grid" | "flow">(() => {
    try { return localStorage.getItem("futuraria-card-mode") as "grid" | "flow" || "grid"; } catch { return "grid"; }
  });
  const [flowIndex, setFlowIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  /* Check auth config once on mount */
  useEffect(() => {
    fetch("/api/auth/config", { headers: { Accept: "application/json" } })
      .then(r => r.json())
      .then(() => setAuthConfigChecked(true))
      .catch(() => setAuthConfigChecked(true));
  }, []);

  const handleSignOut = useCallback(async () => {
    await signOut();
    setUserMenuOpen(false);
    window.location.href = "/";
  }, [signOut]);

  /* Fetch storage health when Settings tab is active */
  useEffect(() => {
    if (activeTab !== "settings") return;
    let cancelled = false;
    fetch("/api/health/storage")
      .then(r => r.json())
      .then(data => { if (!cancelled) setStorageHealth(data); })
      .catch(() => { if (!cancelled) setStorageHealth(null); });
    return () => { cancelled = true; };
  }, [activeTab]);

  const handleCardModeChange = (mode: "grid" | "flow") => {
    setCardMode(mode);
    try { localStorage.setItem("futuraria-card-mode", mode); } catch {}
  };
  const [wsDropdownOpen, setWsDropdownOpen] = useState(false);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loadingRecipes, setLoadingRecipes] = useState(false);
  const [storageHealth, setStorageHealth] = useState<{ supabase: boolean; mode: string; realtime: boolean } | null>(null);
  const [metaCovers, setMetaCovers] = useState<Map<string, string>>(new Map());
  const [deleteMode, setDeleteMode] = useState<"soft" | "hard">(() => {
    try { return localStorage.getItem("futuraria-delete-mode") as "soft" | "hard" || "soft"; } catch { return "soft"; }
  });
  const [deleteConfirmEnabled, setDeleteConfirmEnabled] = useState(() => {
    try { return localStorage.getItem("futuraria-delete-confirm") !== "false"; } catch { return true; }
  });
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteInputName, setDeleteInputName] = useState("");
  const [deleteSkipUntil, setDeleteSkipUntil] = useState(0);
  const [actionDropdownId, setActionDropdownId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const newTplInputRef = useRef<HTMLInputElement>(null);
  const renamingRef = useRef(false);
  const searchRef = useRef("");
  const loadingRef = useRef(readTemplateCache().length === 0);
  const loadTemplatesRef = useRef<(wsId?: string, brandId?: string) => void>(() => {});
  const newWsInputRef = useRef<HTMLInputElement>(null);
  const [, forceRender] = useReducer((x: number) => x + 1, 0);

  // workspace id → slug lookup for clean URL navigation
  const wsSlugMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of workspaces) if (w.slug) m.set(w.id, w.slug);
    return m;
  }, [workspaces]);

  // ── Security / API Key ──
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [apiKeyValue, setApiKeyValue] = useState(() => getApiKey());
  const [apiKeyRotating, setApiKeyRotating] = useState(false);
  const [apiKeyBannerDismissed, setApiKeyBannerDismissed] = useState(() => {
    try { return localStorage.getItem(API_KEY_BANNER_DISMISSED_KEY) === "true"; } catch { return false; }
  });
  const [sessions, setSessions] = useState<Array<{ key_label: string; client_info: string; user_agent: string; ip: string; first_seen: string; last_seen: string; request_count: number }>>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const handleSaveApiKey = () => {
    if (apiKeyValue.trim()) {
      setApiKey(apiKeyValue.trim());
      setShowApiKeyInput(false);
      addToast("API key saved.", "success");
    }
  };

  const handleRemoveApiKey = () => {
    clearApiKey();
    setApiKeyValue("");
    addToast("API key removed.", "info");
  };

  const dismissApiKeyBanner = () => {
    setApiKeyBannerDismissed(true);
    try { localStorage.setItem(API_KEY_BANNER_DISMISSED_KEY, "true"); } catch {}
  };

  const handleGenerateKey = async () => {
    setApiKeyRotating(true);
    try {
      const res = await apiFetch<{ success: boolean; data: { key: string; label: string; key_prefix: string } }>(
        `/workspaces/${DEFAULT_WORKSPACE_ID}/api-keys`,
        { method: "POST", body: JSON.stringify({ label: "ren-browser" }) },
      );
      if (res.success && res.data?.key) {
        setApiKey(res.data.key);
        setApiKeyValue(res.data.key);
        setShowApiKeyInput(false);
        addToast(`Key generated: ${res.data.key_prefix}`, "success");
      } else {
        throw new Error("No key in response");
      }
    } catch (err: any) {
      addToast(`Generate failed: ${err.message}. Sign in required.`, "info");
    }
    setApiKeyRotating(false);
  };

  const handleRotateKey = async () => {
    setApiKeyRotating(true);
    try {
      const res = await apiFetch<{ success: boolean; data: { key: string; label: string; key_prefix: string } }>(
        `/workspaces/${DEFAULT_WORKSPACE_ID}/api-keys`,
        { method: "POST", body: JSON.stringify({ label: "ren-browser" }) },
      );
      if (res.success && res.data?.key) {
        setApiKey(res.data.key);
        setApiKeyValue(res.data.key);
        addToast(`Key rotated: ${res.data.key_prefix}`, "success");
      } else {
        throw new Error("No key in response");
      }
    } catch (err: any) {
      addToast(`Rotate failed: ${err.message}. Sign in required.`, "info");
    }
    setApiKeyRotating(false);
  };

  const loadSessions = async () => {
    setSessionsLoading(true);
    try {
      const result = await mcpCall("list_api_keys", {});
      // list_api_keys returns key info; sessions would need a dedicated endpoint
      // For now show a placeholder; session tracking endpoint will be added later
      setSessions([]);
    } catch { setSessions([]); }
    setSessionsLoading(false);
  };

  const setLoading = useCallback((v: boolean) => {
    loadingRef.current = v;
    forceRender();
  }, []);

  const loadTemplates = useCallback(async (wsId?: string, brandId?: string) => {
    // Stale-while-revalidate: skip the loading spinner when we already have
    // data to show. The user sees their files instantly; the fetch updates
    // silently in the background.
    const hasStaleData = loadingRef.current === false;
    if (!hasStaleData) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (wsId) params.set("workspaceId", wsId);
      if (brandId) params.set("brandId", brandId);
      if (searchRef.current) params.set("search", searchRef.current);
      const qs = params.toString();
      const res = await apiFetch<{ success: boolean; data: Template[] }>(`/templates${qs ? `?${qs}` : ""}`);
      const data = res.data || [];
      // Sort by most recently updated first (server does this, but double-check client-side)
      data.sort((a, b) =>
        new Date(b.metadata?.updatedAt || 0).getTime() - new Date(a.metadata?.updatedAt || 0).getTime()
      );
      setTemplates(data);
      writeTemplateCache(data);
      loadMetaCovers(wsId);
    } catch {
      // Keep stale data visible on network error — don't blank the screen
      if (!hasStaleData) setTemplates([]);
      addToast("Error al cargar las plantillas.", "error");
    }
    setLoading(false);
  }, [setLoading, addToast]);

  // Fetch cover metadata AND brand template counts after template load (prefer cover_image_url over thumbnail)
  const loadMetaCovers = useCallback(async (wsId?: string) => {
    try {
      const params = new URLSearchParams();
      if (wsId) params.set("workspaceId", wsId);
      const res = await apiFetch<{ success: boolean; data: { nodes: Array<{ id: string; cover: string | null; brand_id: string | null; brand: string }> } }>(`/graph?${params.toString()}`);
      if (res.success) {
        const coverMap = new Map<string, string>();
        const counts = new Map<string, number>();
        for (const n of res.data.nodes) {
          if (n.cover) coverMap.set(n.id, n.cover);
          if (n.brand_id) counts.set(n.brand_id, (counts.get(n.brand_id) || 0) + 1);
        }
        setMetaCovers(coverMap);
        setBrandCounts(counts);
      }
    } catch { /* covers are optional; fail silently */ }
  }, []);

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
    loadTemplatesRef.current(DEFAULT_WORKSPACE_ID, selectedBrand ?? undefined);
  }, [selectedBrand]);

  const handleBrandChange = useCallback((brandId: string | null) => {
    setSelectedBrand(brandId);
    loadTemplatesRef.current(DEFAULT_WORKSPACE_ID, brandId ?? undefined);
  }, []);

  useEffect(() => {
    // Sync URL so reload lands back on dashboard
    if (window.location.hash !== "#workspace") {
      window.history.replaceState(null, "", "/#workspace");
    }
    // Fire all requests in PARALLEL — no sequential chaining.
    // Templates load independently of workspaces (workspaceId is already known).
    loadTemplatesRef.current(DEFAULT_WORKSPACE_ID);
    apiFetch<{ success: boolean; data: Brand[] }>(`/saas/workspaces/${DEFAULT_WORKSPACE_ID}/brands`)
      .then(r => setBrands(r.data || []))
      .catch(() => {});
    apiFetch<{ success: boolean; data: Workspace[] }>("/workspaces")
      .then(r => {
        setWorkspaces(r.data || []);
        setSelectedWs(DEFAULT_WORKSPACE_ID);
      })
      .catch(() => {
        addToast("Error al cargar los workspaces.", "error");
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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cardMode, activeTab]);

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
      if (deleteMode === "hard") {
        await fetch(`${API_BASE}/templates/${id}/permanent`, { method: "DELETE", headers: getApiHeaders() });
      } else {
        await fetch(`${API_BASE}/templates/${id}`, { method: "DELETE", headers: getApiHeaders() });
      }
      setTemplates(prev => prev.filter(t => t.id !== id));
    } catch {
      addToast("Error al eliminar la plantilla.", "error");
    }
  };

  const confirmDelete = (id: string, name: string) => {
    // Skip confirmation if disabled or within skip window
    if (!deleteConfirmEnabled || Date.now() < deleteSkipUntil) {
      handleDelete(id);
      return;
    }
    setDeleteTarget({ id, name });
    setDeleteInputName("");
  };

  const executeDelete = () => {
    if (!deleteTarget || deleteInputName !== deleteTarget.name) return;
    handleDelete(deleteTarget.id);
    setDeleteTarget(null);
    setDeleteInputName("");
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
    // Prevent double-invocation from Enter + blur firing together
    if (renamingRef.current) return;
    renamingRef.current = true;
    console.debug("[Dashboard] commitRename:", { id, name });
    try {
      const result = await mcpCall("rename_template", { templateId: id, name });
      console.debug("[Dashboard] commitRename result:", result);
      if (result?.success) {
        setTemplates(prev => prev.map(t => t.id === id ? { ...t, name } : t));
      } else {
        throw new Error(result?.error || "Unknown error");
      }
    } catch (err) {
      console.error("[Dashboard] Rename failed:", err);
      addToast("Error al renombrar la plantilla.", "error");
    }
    renamingRef.current = false;
    setEditingTplId(null);
  };

  const handleCreateWithName = async () => {
    const name = newTplName.trim() || "Untitled";
    setCreatingTpl(false);
    setNewTplName("");
    onCreateHtmlTemplate(DEFAULT_WORKSPACE_ID, name);
  };

  /* Snapshot all templates: capture each frame via html2canvas → save as base64 thumbnail */
  const [snapshotProgress, setSnapshotProgress] = useState({ running: false, done: 0, total: 0 });
  const handleSnapshotAll = useCallback(async () => {
    const htmlTemplates = templates.filter(t => t.frames?.[0]?.html);
    if (htmlTemplates.length === 0) { addToast("No templates with HTML content to snapshot.", "error"); return; }
    setSnapshotProgress({ running: true, done: 0, total: htmlTemplates.length });
    for (let i = 0; i < htmlTemplates.length; i++) {
      const t = htmlTemplates[i];
      const frame = t.frames![0];
      try {
        const container = document.createElement("div");
        container.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;";
        document.body.appendChild(container);
        const target = document.createElement("div");
        target.style.cssText = `width:${t.width}px;height:${t.height}px;overflow:hidden;position:relative;`;
        const style = document.createElement("style");
        style.textContent = frame.css || "";
        target.appendChild(style);
        const content = document.createElement("div");
        content.innerHTML = frame.html || "";
        target.appendChild(content);
        container.appendChild(target);
        const canvas = await html2canvas(target, { width: t.width, height: t.height, scale: 0.5, useCORS: true, allowTaint: true, backgroundColor: frame.background || "#0d0d1a" });
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        container.remove();
        await mcpCall("update_thumbnail", { templateId: t.id, thumbnail: dataUrl });
      } catch { /* skip failures, continue */ }
      setSnapshotProgress(prev => ({ ...prev, done: i + 1 }));
    }
    setSnapshotProgress({ running: false, done: 0, total: 0 });
    addToast(`${htmlTemplates.length} thumbnails captured.`, "success");
    loadTemplatesRef.current(DEFAULT_WORKSPACE_ID);
  }, [templates, addToast]);

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
        body: JSON.stringify({ variables: {}, workspaceId: DEFAULT_WORKSPACE_ID }),
      });
      if (res.data) {
        onSelectTemplate(res.data.templateId);
      }
    } catch {
      addToast(`Error al crear desde "${recipeName}". Intenta de nuevo.`, "error");
    }
  };

  /* Metadata + actions for the centered CoverFlow item (name, date, ··· menu) */
  const renderFlowMeta = (t: Template) => (
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
        {/* Dropdown actions: Duplicate / Delete / Info */}
        <div style={{ position: "relative", display: "inline-block" }}>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); setActionDropdownId(actionDropdownId === t.id ? null : t.id); }}
            style={{ ...cardAction, borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", padding: "4px 12px", color: "rgba(255,255,255,0.6)", fontSize: 12, minWidth: 28 }}
            title="Actions"
          >
            ···
          </button>
          {actionDropdownId === t.id && (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={e => { e.stopPropagation(); setActionDropdownId(null); }} />
              <div className="liquid-glass" style={{
                position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%)",
                minWidth: 130, borderRadius: 10, padding: 4, zIndex: 100, marginBottom: 4,
                display: "flex", flexDirection: "column",
              }}>
                <button type="button" onClick={e => { e.stopPropagation(); handleDuplicate(t.id); setActionDropdownId(null); }} style={ddItemStyle}>📋 Duplicate</button>
                <button type="button" onClick={e => { e.stopPropagation(); confirmDelete(t.id, t.name); setActionDropdownId(null); }} style={{ ...ddItemStyle, color: "#f87171" }}>🗑 Delete</button>
                <button type="button" onClick={e => { e.stopPropagation(); onSelectTemplate(t.id, { wsSlug: wsSlugMap.get(t.workspaceId), tplSlug: t.slug }); setActionDropdownId(null); }} style={ddItemStyle}>ℹ️ Info</button>
              </div>
            </>
          )}
        </div>
      </>
    );

  const renderTemplateCard = (t: Template, i?: number) => {
    /* Thumbnail preview: both flow and grid modes use static <img> thumbnails.
       Server-side pipeline generates SVG placeholders on commit; browser-side
       handleSnapshotAll replaces them with real PNGs via html2canvas.
       Prefer curated cover_image_url from design_file_meta over auto thumbnail. */
    const coverUrl = metaCovers.get(t.id) || t.thumbnail;
    const previewContent = coverUrl
      ? <img src={coverUrl} alt={t.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" />
      : <div style={{ width: "100%", height: "100%", background: t.frames?.[0]?.background || "#0d0d1a", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "rgba(255,255,255,0.15)", fontSize: 14, fontFamily: "'Instrument Serif', serif" }}>{t.name}</span>
        </div>;



    /* ── GRID MODE: original layout with frosted info panel inside card */
    return (
    <div
      key={t.id}
      className="dash-card"
      style={{ ...cardStyle }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.2)"; (e.currentTarget as HTMLElement).style.boxShadow = "inset 0 1px 1px rgba(255,255,255,0.1), 0 4px 16px rgba(0,0,0,0.3)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)"; (e.currentTarget as HTMLElement).style.boxShadow = "inset 0 1px 1px rgba(255,255,255,0.1), 0 2px 8px rgba(0,0,0,0.2)"; }}
      onClick={() => onSelectTemplate(t.id, { wsSlug: wsSlugMap.get(t.workspaceId), tplSlug: t.slug })}
    >
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: 14 }}>
        {previewContent}
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
      <div className="dash-card-actions" style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 3, display: "flex", borderTop: "1px solid rgba(255, 255, 255, 0.02)", fontSize: 12, justifyContent: "center", alignItems: "center", padding: "4px 0" }}>
        <div style={{ position: "relative", display: "inline-block" }}>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); setActionDropdownId(actionDropdownId === t.id ? null : t.id); }}
            style={{ ...cardAction, borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", padding: "3px 12px", color: "rgba(255,255,255,0.5)", fontSize: 11, flex: "none", borderRight: "1px solid rgba(255,255,255,0.08)" }}
            title="Actions"
          >
            ···
          </button>
          {actionDropdownId === t.id && (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={e => { e.stopPropagation(); setActionDropdownId(null); }} />
              <div className="liquid-glass" style={{
                position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%)",
                minWidth: 130, borderRadius: 10, padding: 4, zIndex: 100, marginBottom: 4,
                display: "flex", flexDirection: "column",
              }}>
                <button type="button" onClick={e => { e.stopPropagation(); handleDuplicate(t.id); setActionDropdownId(null); }} style={ddItemStyle}>📋 Duplicate</button>
                <button type="button" onClick={e => { e.stopPropagation(); confirmDelete(t.id, t.name); setActionDropdownId(null); }} style={{ ...ddItemStyle, color: "#f87171" }}>🗑 Delete</button>
                <button type="button" onClick={e => { e.stopPropagation(); onSelectTemplate(t.id, { wsSlug: wsSlugMap.get(t.workspaceId), tplSlug: t.slug }); setActionDropdownId(null); }} style={ddItemStyle}>ℹ️ Info</button>
              </div>
            </>
          )}
        </div>
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

      {/* Dark depth overlay — prevents bg video from competing with content */}
      <div
        style={{
          position: "absolute", inset: 0, zIndex: 1,
          background: "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.35) 40%, rgba(0,0,0,0.45) 70%, rgba(0,0,0,0.65) 100%)",
          pointerEvents: "none",
        }}
      />

      {/* Header — matches landing navbar: brand left, tabs+dropdown centered, search right */}
      <div className="dash-header" style={dashHeaderStyle}>
        <div className="landing-nav-inner" style={{ maxWidth: 1200, width: "100%", position: "relative" }}>
          {/* Brand — identical to landing */}
          <div className="landing-brand" style={{ flexShrink: 0 }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="4" />
              <circle cx="12" cy="12" r="4" />
            </svg>
            <span>Futuraria</span>
          </div>

          {/* Centered: fixed nav tabs */}
          <div className="dash-nav-tabs" style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "center", flex: 1 }}>
            {([
              { id: "templates", label: "Archivos", icon: <IconFile size={14} /> },
              { id: "texts", label: "Textos", icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 7 4 4 20 4 20 7" />
                  <line x1="9" y1="20" x2="15" y2="20" />
                  <line x1="12" y1="4" x2="12" y2="20" />
                </svg>
              )},
              { id: "graph", label: "Graph", icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="6" cy="6" r="2" />
                  <circle cx="18" cy="6" r="2" />
                  <circle cx="12" cy="18" r="2" />
                  <line x1="7.5" y1="7.5" x2="11" y2="16" />
                  <line x1="16.5" y1="7.5" x2="13" y2="16" />
                  <line x1="8" y1="6" x2="16" y2="6" />
                </svg>
              )},
              { id: "workspace", label: "CRM", icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2" /><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5" /><path d="M15 15c3 0 5 1.5 5 4" />
                </svg>
              )},
              { id: "storage", label: "Storage", icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>
              )},
              { id: "settings", label: "Configuración", icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
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
          </div>

          {/* Right: Search + User Account Menu */}
          <div className="dash-search-desktop" style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
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
                width: 160,
                background: "rgba(255,255,255,0.01)",
                border: "none",
              }}
            />

            {/* ── User Account Button ── */}
            {authConfigured && user ? (
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  className="liquid-glass"
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  aria-label="Account menu"
                  style={{
                    borderRadius: 100, padding: "8px 12px", fontSize: 12,
                    cursor: "pointer", fontWeight: 500,
                    display: "flex", alignItems: "center", gap: 6,
                    color: "rgba(255,255,255,0.8)",
                    transition: "all 0.25s ease",
                    maxWidth: 140,
                  }}
                >
                  <span style={{
                    width: 22, height: 22, borderRadius: "50%",
                    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 700, color: "#fff", flexShrink: 0,
                  }}>
                    {(user.email || "?")[0].toUpperCase()}
                  </span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {user.email?.split("@")[0] || "Account"}
                  </span>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M2 3l3 4 3-4" />
                  </svg>
                </button>
                {userMenuOpen && (
                  <>
                    <div style={{ position: "fixed", inset: 0, zIndex: 49 }} onClick={() => setUserMenuOpen(false)} />
                    <div
                      style={{
                        position: "absolute", top: "calc(100% + 6px)", right: 0,
                        minWidth: 200, borderRadius: 12, padding: 6, zIndex: 50,
                        background: "rgba(0, 0, 0, 0.72)",
                        backdropFilter: "blur(16px)",
                        WebkitBackdropFilter: "blur(16px)",
                        border: "1px solid rgba(255, 255, 255, 0.08)",
                        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5)",
                      }}
                    >
                      <div style={{ padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", marginBottom: 4 }}>
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 0.5 }}>Sesión activa</div>
                        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", marginTop: 2, wordBreak: "break-all" }}>{user.email}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setActiveTab("templates"); setUserMenuOpen(false); }}
                        style={{ ...dropdownItemStyle, display: "flex", alignItems: "center", gap: 8 }}
                      >
                        <IconFile size={14} /> Archivos
                      </button>
                      <button
                        type="button"
                        onClick={() => { setActiveTab("texts"); setUserMenuOpen(false); }}
                        style={{ ...dropdownItemStyle, display: "flex", alignItems: "center", gap: 8 }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" /></svg>
                        Textos
                      </button>
                      <button
                        type="button"
                        onClick={() => { setActiveTab("recipes"); setUserMenuOpen(false); }}
                        style={{ ...dropdownItemStyle, display: "flex", alignItems: "center", gap: 8 }}
                      >
                        <IconTag size={14} /> Key Visuals
                      </button>
                      <button
                        type="button"
                        onClick={() => { setActiveTab("storage"); setUserMenuOpen(false); }}
                        style={{ ...dropdownItemStyle, display: "flex", alignItems: "center", gap: 8 }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>
                        Storage
                      </button>
                      <button
                        type="button"
                        onClick={() => { setActiveTab("graph"); setUserMenuOpen(false); }}
                        style={{ ...dropdownItemStyle, display: "flex", alignItems: "center", gap: 8 }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="12" cy="18" r="2" /><line x1="7.5" y1="7.5" x2="11" y2="16" /><line x1="16.5" y1="7.5" x2="13" y2="16" /><line x1="8" y1="6" x2="16" y2="6" /></svg>
                        Graph
                      </button>
                      <button
                        type="button"
                        onClick={() => { setActiveTab("workspace"); setUserMenuOpen(false); }}
                        style={{ ...dropdownItemStyle, display: "flex", alignItems: "center", gap: 8 }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2" /><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5" /><path d="M15 15c3 0 5 1.5 5 4" /></svg>
                        CRM
                      </button>
                      <button
                        type="button"
                        onClick={() => { setActiveTab("settings"); setUserMenuOpen(false); }}
                        style={{ ...dropdownItemStyle, display: "flex", alignItems: "center", gap: 8 }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                        Configuración
                      </button>
                      <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "4px 8px" }} />
                      <button
                        type="button"
                        onClick={() => void handleSignOut()}
                        style={{ ...dropdownItemStyle, color: "#f87171", display: "flex", alignItems: "center", gap: 8 }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                        Cerrar sesión
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : authConfigured && !user ? (
              <button
                type="button"
                className="liquid-glass"
                onClick={() => window.location.reload()}
                style={{
                  borderRadius: 100, padding: "8px 16px", fontSize: 12,
                  cursor: "pointer", fontWeight: 500,
                  color: "#fff",
                  display: "flex", alignItems: "center", gap: 6,
                  background: "rgba(99,102,241,0.2)",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" /></svg>
                Iniciar sesión
              </button>
            ) : authConfigChecked && authRequired && !authConfigured ? (
              <button
                type="button"
                className="liquid-glass"
                onClick={() => setActiveTab("settings")}
                title="Falta SUPABASE_PUBLISHABLE_KEY en el servidor"
                style={{
                  borderRadius: 100, padding: "8px 12px", fontSize: 11,
                  cursor: "pointer", fontWeight: 500,
                  color: "#fbbf24",
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                Auth sin configurar
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Mobile Search (below header on small screens) ── */}
      <div className="dash-search-mobile">
        <input
          aria-label="Search templates"
          placeholder="Search…"
          value={searchDisplay}
          onChange={e => handleSearch(e.target.value)}
        />
      </div>

      {/* ── API Key Banner (shown when no key configured) ── */}
      {!hasApiKey() && !apiKeyBannerDismissed && (
        <aside aria-label="Aviso sobre la API key" style={{
          margin: "0 20px", padding: "12px 18px", borderRadius: 12,
          background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.2)",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }}>🔑</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.85)" }}>¿Usarás IA o MCP?</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>Esta API key es opcional para navegar el CRM. Solo la necesitas para herramientas MCP, generación con IA y acciones que usen tu clave.</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              onClick={() => setActiveTab("settings")}
              style={{
                borderRadius: 100, padding: "8px 18px", fontSize: 12, fontWeight: 500,
                border: "none", cursor: "pointer", whiteSpace: "nowrap",
                background: "rgba(234,179,8,0.15)", color: "#facc15",
              }}
            >
              Configurar
            </button>
            <button
              type="button"
              aria-label="Ocultar aviso de API key"
              title="Ocultar aviso"
              onClick={dismissApiKeyBanner}
              style={{
                width: 32, height: 32, borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)",
                background: "transparent", color: "rgba(255,255,255,0.7)", cursor: "pointer", fontSize: 18, lineHeight: 1,
              }}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </aside>
      )}

      {/* Template Grid */}
      {activeTab === "templates" && (
      <div data-tour="templates-grid" style={{ flex: 1, overflowY: "auto", padding: "20px 20px 20px 20px" }}>
        {/* ── Brand filter chips ── */}
        {brands.length > 0 && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, marginBottom: 20,
            flexWrap: "wrap", padding: "0 0 8px 0",
          }}>
            <span style={{
              fontSize: 11, color: "rgba(255,255,255,0.3)", textTransform: "uppercase",
              letterSpacing: "0.05em", marginRight: 4, whiteSpace: "nowrap",
            }}>
              Marcas ({brands.filter(b => (brandCounts.get(b.id) || 0) > 0).length} con diseños):
            </span>
            <button
              type="button"
              onClick={() => handleBrandChange(null)}
              className="liquid-glass"
              style={{
                borderRadius: 100, padding: "5px 14px", fontSize: 12, fontWeight: 500,
                cursor: "pointer", border: "none",
                background: !selectedBrand ? "rgba(108,92,231,0.25)" : "rgba(255,255,255,0.03)",
                color: !selectedBrand ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.5)",
                transition: "all 0.2s ease",
              }}
            >
              Todas
            </button>
            {brands.map(b => {
              const count = brandCounts.get(b.id) || 0;
              const hasDesigns = count > 0;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => { if (hasDesigns) handleBrandChange(b.id); }}
                  className="liquid-glass"
                  title={hasDesigns ? `${count} template${count > 1 ? "s" : ""}` : "Sin diseños aún"}
                  style={{
                    borderRadius: 100, padding: "5px 14px", fontSize: 12, fontWeight: 500,
                    cursor: hasDesigns ? "pointer" : "default",
                    border: "none",
                    background: selectedBrand === b.id
                      ? "rgba(108,92,231,0.25)"
                      : hasDesigns ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.015)",
                    color: selectedBrand === b.id
                      ? "rgba(255,255,255,0.95)"
                      : hasDesigns ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.25)",
                    opacity: hasDesigns ? 1 : 0.5,
                    transition: "all 0.2s ease",
                  }}
                >
                  <span style={{
                    display: "inline-block", width: 6, height: 6, borderRadius: "50%",
                    background: brandAccent(b.id), marginRight: 4, verticalAlign: "middle",
                    opacity: hasDesigns ? 1 : 0.4,
                  }} />
                  {b.name}
                  {hasDesigns && (
                    <span style={{
                      marginLeft: 4, fontSize: 10, fontWeight: 600,
                      color: "rgba(255,255,255,0.35)", background: "rgba(255,255,255,0.05)",
                      borderRadius: 100, padding: "1px 7px",
                    }}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {loading ? (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", padding: 60 }}>Loading…</div>
        ) : templates.length === 0 ? (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}><IconFile size={40} color="rgba(255,255,255,0.3)" /></div>
            <div>No templates yet. Create your first one!</div>
            <button
              type="button"
              onClick={() => onCreateHtmlTemplate(DEFAULT_WORKSPACE_ID, "Untitled")}
              style={{ ...btnPrimary, marginTop: 16 }}
            >
              + New Template
            </button>
          </div>
        ) : cardMode === "flow" ? (
          <div style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            <CoverFlow
              items={templates.map(t => ({
                id: t.id,
                name: t.name,
                cover: metaCovers.get(t.id) || t.thumbnail || null,
                background: t.frames?.[0]?.background || "#0d0d1a",
              }))}
              onOpen={(id) => {
                const t = templates.find(x => x.id === id);
                if (t) onSelectTemplate(t.id, { wsSlug: wsSlugMap.get(t.workspaceId), tplSlug: t.slug });
              }}
              onIndexChange={setFlowIndex}
              height={400}
            />
            {templates[Math.min(flowIndex, templates.length - 1)] && (
              <div style={{ width: 260, margin: "10px auto 0", textAlign: "center" }}>
                {renderFlowMeta(templates[Math.min(flowIndex, templates.length - 1)])}
              </div>
            )}
          </div>
        ) : (
          <div className="dash-template-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 28 }}>
            {templates.map(t => renderTemplateCard(t))}
          </div>
        )}
      </div>
      )}

      {/* ── Texts Tab ── */}
      {activeTab === "texts" && (
        <TextsTab workspaceId={DEFAULT_WORKSPACE_ID} onOpenTemplate={(id) => window.open(`/?template=${id}&v=2`, "_blank")} />
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
          <div className="dash-template-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 28 }}>
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

      {/* ── Storage Tab ── */}
      {activeTab === "storage" && <StorageTab workspaceId={DEFAULT_WORKSPACE_ID} />}

      {/* ── Settings Tab ── */}
      {activeTab === "settings" && (
        <WorkspaceConsole
          mode="settings"
          workspaceId={DEFAULT_WORKSPACE_ID}
          workspaceName={workspaces.find(workspace => workspace.id === DEFAULT_WORKSPACE_ID)?.name}
        >
      {(() => {
        const totalFrames = templates.reduce((sum, t) => sum + (t.frames?.length || 0), 0);
        const estimatedTokens = (templates.length * 2000) + (totalFrames * 500) + (recipes.length * 100);
        // Honest indicators: data persistence comes from the server (SUPABASE_URL/SERVICE_KEY),
        // realtime comes from browser-side VITE_* vars. Previous check only looked at VITE_*.
        const dataConnected = storageHealth?.supabase ?? false;
        const dataMode = storageHealth?.mode ?? "unknown";
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
            Configuración general
          </h2>

          {/* ── Metrics ── */}
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>Usage</h3>
          <div className="dash-metrics-bar" style={{ marginBottom: 32 }}>
            <div className="dash-metric-card">
              <div className="dash-metric-value">{templates.length}</div>
              <div className="dash-metric-label">Archivos</div>
              <div className="dash-metric-sub">{totalFrames} frames</div>
            </div>
            <div className="dash-metric-card">
              <div className="dash-metric-value">{recipes.length}</div>
              <div className="dash-metric-label">Key Visuals</div>
              <div className="dash-metric-sub">{recipes.reduce((sum, r) => sum + (r.usageCount || 0), 0)} executions</div>
            </div>
            <div className="dash-metric-card">
              <div className="dash-metric-value">{brands.length}</div>
              <div className="dash-metric-label">Marcas</div>
              <div className="dash-metric-sub">{selectedBrand ? "1 activa" : "todas"}</div>
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

          {/* ── Onboarding ── */}
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>Onboarding</h3>
          <div className="liquid-glass" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderRadius: 14, marginBottom: 32, gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 14 }}>🧭</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.8)" }}>Tour guiado</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
                  Recorrido paso a paso: templates, editor, IA y grafo
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                type="button"
                onClick={() => { setOnboardingEnabled(!tourEnabled); setTourEnabled(v => !v); }}
                style={{
                  borderRadius: 100, padding: "6px 16px", fontSize: 12, fontWeight: 500,
                  border: "none", cursor: "pointer", transition: "all 0.2s ease",
                  background: tourEnabled ? "rgba(139,92,246,0.25)" : "rgba(255,255,255,0.06)",
                  color: tourEnabled ? "#c4b5fd" : "rgba(255,255,255,0.4)",
                }}
              >{tourEnabled ? "Activado" : "Desactivado"}</button>
              <button
                type="button"
                onClick={() => { restartOnboarding(); setTourEnabled(true); setActiveTab("templates"); }}
                style={{
                  borderRadius: 100, padding: "6px 16px", fontSize: 12, fontWeight: 600,
                  border: "1px solid rgba(139,92,246,0.5)", cursor: "pointer",
                  background: "transparent", color: "#a78bfa",
                }}
              >Reiniciar tour</button>
            </div>
          </div>

          {/* ── Thumbnails ── */}
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>Thumbnails</h3>
          <div className="liquid-glass" style={{ padding: "14px 18px", borderRadius: 14, marginBottom: 32 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14 }}>📸</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.8)" }}>Preview Thumbnails</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
                    {snapshotProgress.running
                      ? `Capturing ${snapshotProgress.done}/${snapshotProgress.total}…`
                      : `${templates.filter(t => t.thumbnail).length} of ${templates.length} templates have thumbnails`}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleSnapshotAll}
                disabled={snapshotProgress.running}
                style={{
                  borderRadius: 100, padding: "8px 20px", fontSize: 12, fontWeight: 500,
                  border: "none", cursor: snapshotProgress.running ? "wait" : "pointer",
                  background: snapshotProgress.running ? "rgba(255,255,255,0.03)" : "rgba(99,102,241,0.15)",
                  color: snapshotProgress.running ? "rgba(255,255,255,0.3)" : "#a5b4fc",
                  transition: "all 0.2s ease",
                }}
              >
                {snapshotProgress.running ? "Capturing…" : "Snapshot All"}
              </button>
            </div>
            {snapshotProgress.running && (
              <div style={{ marginTop: 10, height: 4, borderRadius: 100, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 100, background: "linear-gradient(90deg, #818cf8, #a78bfa)", width: `${Math.round((snapshotProgress.done / snapshotProgress.total) * 100)}%`, transition: "width 0.3s ease" }} />
              </div>
            )}
          </div>

          {/* ── Delete Behavior ── */}
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>Delete Behavior</h3>
          <div className="liquid-glass" style={{ padding: "14px 18px", borderRadius: 14, marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14 }}>🗑️</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.8)" }}>Delete Mode</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
                    {deleteMode === "soft" ? "Move to Trash (recoverable from Storage tab)" : "Permanent delete from database"}
                  </div>
                </div>
              </div>
              <select
                value={deleteMode}
                onChange={e => { setDeleteMode(e.target.value as "soft" | "hard"); try { localStorage.setItem("futuraria-delete-mode", e.target.value); } catch {} }}
                style={{
                  padding: "6px 12px", fontSize: 12, borderRadius: 100,
                  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                  color: "#ccc", outline: "none", cursor: "pointer", fontFamily: "inherit",
                }}
              >
                <option value="soft">Move to Trash</option>
                <option value="hard">Permanent Delete</option>
              </select>
            </div>
          </div>
          <div className="liquid-glass" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderRadius: 14, marginBottom: 32 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 14 }}>⚠️</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.8)" }}>Delete Confirmation</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
                  {deleteConfirmEnabled ? "Requires typing template name to confirm" : "Deletes immediately without confirmation"}
                </div>
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={deleteConfirmEnabled}
                onChange={e => { setDeleteConfirmEnabled(e.target.checked); try { localStorage.setItem("futuraria-delete-confirm", String(e.target.checked)); } catch {} }}
                style={{ accentColor: "#818cf8" }}
              />
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Enabled</span>
            </label>
          </div>

          {/* ── Connection ── */}
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>Connection</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 32 }}>
            <div className="liquid-glass" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderRadius: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14 }}>🗄️</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.8)" }}>Data Persistence</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
                    {dataConnected ? "Supabase" : dataMode === "unknown" ? "Checking…" : "In-memory (data lost on restart)"}
                  </div>
                </div>
              </div>
              <span style={{
                fontSize: 11, fontWeight: 600,
                padding: "4px 10px", borderRadius: 100,
                background: dataConnected ? "rgba(34,197,94,0.12)" : dataMode === "unknown" ? "rgba(255,255,255,0.03)" : "rgba(234,179,8,0.12)",
                color: dataConnected ? "#4ade80" : dataMode === "unknown" ? "rgba(255,255,255,0.35)" : "#facc15",
              }}>
                {dataConnected ? "Connected" : dataMode === "unknown" ? "Checking…" : "Memory Only"}
              </span>
            </div>
            <div className="liquid-glass" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderRadius: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14 }}>🔄</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.8)" }}>Real-time Collaboration</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
                    {storageHealth?.realtime ? "Supabase browser key configured" : "Not configured (set SUPABASE_PUBLISHABLE_KEY)"}
                  </div>
                </div>
              </div>
              <span style={{
                fontSize: 11, fontWeight: 600,
                padding: "4px 10px", borderRadius: 100,
                background: storageHealth?.realtime ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.05)",
                color: storageHealth?.realtime ? "#4ade80" : "rgba(255,255,255,0.35)",
              }}>
                {storageHealth?.realtime ? "Enabled" : "Inactive"}
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

          {/* ── Security ── */}
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>Security</h3>

          {/* API Key Status */}
          <div className="liquid-glass" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderRadius: 14, marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 14 }}>🔑</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.8)" }}>API Key</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
                  {hasApiKey() ? `Configured · ${getApiKey().slice(0, 4)}…${getApiKey().slice(-4)}` : "Not configured — MCP tools and AI features require a key"}
                </div>
              </div>
            </div>
            <span style={{
              fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 100,
              background: hasApiKey() ? "rgba(34,197,94,0.12)" : "rgba(234,179,8,0.12)",
              color: hasApiKey() ? "#4ade80" : "#facc15",
            }}>
              {hasApiKey() ? "Active" : "Missing"}
            </span>
          </div>

          {/* API Key Input / Rotate */}
          <div className="liquid-glass" style={{ padding: "14px 18px", borderRadius: 14, marginBottom: 8 }}>
            {showApiKeyInput || !hasApiKey() ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  autoFocus
                  value={apiKeyValue}
                  onChange={e => setApiKeyValue(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleSaveApiKey(); if (e.key === "Escape") setShowApiKeyInput(false); }}
                  placeholder="Paste your API key (fdr_…)"
                  style={{
                    flex: 1, minWidth: 160, padding: "8px 14px", borderRadius: 8,
                    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)",
                    color: "#fff", fontSize: 12, outline: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={handleSaveApiKey}
                  disabled={!apiKeyValue.trim()}
                  style={{
                    borderRadius: 100, padding: "8px 16px", fontSize: 12, fontWeight: 500,
                    border: "none", cursor: apiKeyValue.trim() ? "pointer" : "not-allowed",
                    background: apiKeyValue.trim() ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.03)",
                    color: apiKeyValue.trim() ? "#a5b4fc" : "rgba(255,255,255,0.3)",
                    whiteSpace: "nowrap",
                  }}
                >
                  Save
                </button>
                {!hasApiKey() && (
                  <button
                    type="button"
                    onClick={handleGenerateKey}
                    disabled={apiKeyRotating}
                    style={{
                      borderRadius: 100, padding: "8px 16px", fontSize: 12, fontWeight: 500,
                      border: "none", cursor: apiKeyRotating ? "wait" : "pointer",
                      background: "rgba(34,197,94,0.12)", color: "#4ade80",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {apiKeyRotating ? "Generating…" : "Generate Key"}
                  </button>
                )}
                {hasApiKey() && (
                  <button
                    type="button"
                    onClick={() => { setShowApiKeyInput(false); setApiKeyValue(getApiKey()); }}
                    style={{
                      borderRadius: 100, padding: "8px 12px", fontSize: 12,
                      border: "none", cursor: "pointer",
                      background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.5)",
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, color: "rgba(255,255,255,0.6)" }}>Key saved in this browser</span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setShowApiKeyInput(true)}
                    style={{
                      borderRadius: 100, padding: "6px 14px", fontSize: 11, fontWeight: 500,
                      border: "none", cursor: "pointer",
                      background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.6)",
                    }}
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    onClick={handleRotateKey}
                    disabled={apiKeyRotating}
                    style={{
                      borderRadius: 100, padding: "6px 14px", fontSize: 11, fontWeight: 500,
                      border: "none", cursor: apiKeyRotating ? "wait" : "pointer",
                      background: "rgba(99,102,241,0.1)", color: "#a5b4fc",
                    }}
                  >
                    {apiKeyRotating ? "Rotating…" : "Rotate Key"}
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveApiKey}
                    style={{
                      borderRadius: 100, padding: "6px 14px", fontSize: 11, fontWeight: 500,
                      border: "none", cursor: "pointer",
                      background: "rgba(220,38,38,0.08)", color: "#f87171",
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* What the key unlocks */}
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", lineHeight: 1.6, marginBottom: 20, padding: "0 4px" }}>
            Your API key unlocks: MCP design tools · AI image generation · CSV batch processing · Template creation & editing.
            External APIs (Gemini, OpenAI, Brave, Quiver) use your own keys configured in Netlify environment variables.
          </div>

          {/* Sessions */}
          <h3 style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Active Sessions</h3>
          <div className="liquid-glass" style={{ padding: "14px 18px", borderRadius: 14, marginBottom: 32 }}>
            {sessionsLoading ? (
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", textAlign: "center", padding: 16 }}>Loading sessions…</div>
            ) : sessions.length === 0 ? (
              <div style={{ textAlign: "center", padding: 16 }}>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>No active sessions yet.</div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 4 }}>
                  Sessions appear here when MCP clients or browsers connect with your API key.
                </div>
              </div>
            ) : (
              <div className="dash-settings-table-wrap">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ color: "rgba(255,255,255,0.35)", textAlign: "left" }}>
                    <th style={{ padding: "4px 8px", fontWeight: 500 }}>Client</th>
                    <th style={{ padding: "4px 8px", fontWeight: 500 }}>Key</th>
                    <th style={{ padding: "4px 8px", fontWeight: 500 }}>Last Seen</th>
                    <th style={{ padding: "4px 8px", fontWeight: 500, textAlign: "right" }}>Requests</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s, i) => (
                    <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                      <td style={{ padding: "6px 8px", color: "rgba(255,255,255,0.7)" }} title={s.user_agent}>
                        {s.client_info || s.user_agent?.slice(0, 30) || "Unknown"}
                      </td>
                      <td style={{ padding: "6px 8px", color: "rgba(255,255,255,0.5)" }}>{s.key_label}</td>
                      <td style={{ padding: "6px 8px", color: "rgba(255,255,255,0.4)" }}>
                        {new Date(s.last_seen).toLocaleString()}
                      </td>
                      <td style={{ padding: "6px 8px", textAlign: "right", color: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}>
                        {s.request_count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
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
        </WorkspaceConsole>
      )}

      {/* ── Graph Tab ── */}
      {activeTab === "graph" && (
        <div data-tour="graph-view" style={{ flex: 1, overflow: "hidden", padding: 20 }}>
          <GraphTab
            workspaceId={DEFAULT_WORKSPACE_ID}
            onOpenTemplate={(id) => {
              onSelectTemplate(id);
            }}
          />
        </div>
      )}

      {activeTab === "workspace" && (
        <WorkspaceConsole
          mode="crm"
          workspaceId={DEFAULT_WORKSPACE_ID}
          workspaceName={workspaces.find(workspace => workspace.id === DEFAULT_WORKSPACE_ID)?.name}
          onOpenTemplate={(id) => onSelectTemplate(id)}
        />
      )}

      {/* ── Delete Confirmation Modal ── */}
      {deleteTarget && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }} onClick={() => { setDeleteTarget(null); setDeleteInputName(""); }}>
          <div className="liquid-glass" style={{ maxWidth: 420, width: "90%", borderRadius: 16, padding: 28 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 8px", color: "#f87171" }}>Delete Template</h3>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", margin: "0 0 4px", lineHeight: 1.5 }}>
              You are about to <strong style={{ color: "#f87171" }}>permanently delete</strong> <em>{deleteTarget.name}</em>.
            </p>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: "0 0 16px" }}>
              {deleteMode === "soft"
                ? "It will be moved to Trash and recoverable from the Storage tab for 30 days."
                : "This action cannot be undone. The template will be removed from the database."}
            </p>

            <label style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 4 }}>Type the template name to confirm:</label>
            <input
              autoFocus
              value={deleteInputName}
              onChange={e => setDeleteInputName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && deleteInputName === deleteTarget.name) executeDelete(); if (e.key === "Escape") { setDeleteTarget(null); setDeleteInputName(""); } }}
              placeholder={deleteTarget.name}
              style={{
                width: "100%", padding: "10px 14px", borderRadius: 8,
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)",
                color: "#fff", fontSize: 13, outline: "none", marginBottom: 12,
              }}
            />

            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 16, cursor: "pointer" }}>
              <input
                type="checkbox"
                onChange={e => {
                  if (e.target.checked) setDeleteSkipUntil(Date.now() + 5 * 60 * 1000);
                  else setDeleteSkipUntil(0);
                }}
                style={{ accentColor: "#818cf8" }}
              />
              Don't show this confirmation for the next 5 minutes
            </label>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => { setDeleteTarget(null); setDeleteInputName(""); }}
                className="liquid-glass"
                style={{ borderRadius: 100, padding: "8px 20px", fontSize: 12, fontWeight: 500, border: "none", cursor: "pointer", color: "rgba(255,255,255,0.6)", background: "rgba(255,255,255,0.03)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeDelete}
                disabled={deleteInputName !== deleteTarget.name}
                style={{
                  borderRadius: 100, padding: "8px 20px", fontSize: 12, fontWeight: 600, border: "none", cursor: deleteInputName === deleteTarget.name ? "pointer" : "not-allowed",
                  color: "#fff", background: deleteInputName === deleteTarget.name ? "#dc2626" : "rgba(220,38,38,0.3)",
                  transition: "all 0.2s ease",
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Guided onboarding tour ── */}
      <OnboardingTour
        page="dashboard"
        onAction={(action: TourAction) => {
          if (action === "tab-templates") setActiveTab("templates");
          else if (action === "tab-graph") setActiveTab("graph");
          else if (action === "open-first-template") {
            const t = templates[0];
            if (t) onSelectTemplate(t.id, { wsSlug: wsSlugMap.get(t.workspaceId), tplSlug: t.slug });
          }
        }}
      />
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
};

const cardContentStyle: React.CSSProperties = {
  position: "relative", zIndex: 2,
  display: "flex", flexDirection: "column",
  height: "100%", padding: 0,
};

const cardInfoPanel: React.CSSProperties = {
  marginTop: "auto",
  borderRadius: "0 0 10px 10px", padding: 0,
  background: "rgba(0, 0, 0, 0.4)",
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

const ddItemStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6,
  padding: "8px 12px", borderRadius: 6, fontSize: 12,
  background: "transparent", border: "none",
  color: "rgba(255,255,255,0.7)",
  cursor: "pointer", textAlign: "left" as const,
  fontFamily: "inherit", fontWeight: 400,
  transition: "all 0.15s ease",
};
