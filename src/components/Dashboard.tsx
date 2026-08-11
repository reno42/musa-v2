import { useState, useEffect, useCallback, useMemo, useRef, useReducer } from "react";
import { motion } from "framer-motion";
import { rasterizeFrame } from "../lib/frameCapture";
import { downloadBlob } from "../lib/download";
import { IconFolder, IconFile, IconTag } from "../shared/icons";
import { GraphTab } from "./GraphTab";
import { CoverFlow } from "./CoverFlow";
import { StorageTab } from "./StorageTab";
import { ContentTab } from "./ContentTab";
import { KanbanTab } from "./KanbanTab";
import { KanbanTableView } from "./KanbanTableView";
import { AgentsPanel } from "./AgentsPanel";
import { BrandGraphCanvas } from "./BrandGraphCanvas";
import { BrandGraphDataTable } from "./BrandGraphDataTable";
import { mcpCall } from "../lib/mcpClient";
import { useToast } from "./Toast";
import { saveCurrentRoute } from "../lib/routePersistence";
import { readAppRoute, workspaceTabUrl, isWorkspaceTab, DEFAULT_WORKSPACE_TAB, type WorkspaceTab } from "../lib/appRoute";
import { getApiHeaders, getApiKey, setApiKey, clearApiKey, hasApiKey } from "../lib/apiKey";
import { OnboardingTour, isOnboardingEnabled, setOnboardingEnabled, restartOnboarding, type TourAction } from "./OnboardingTour";
import { AI_PROVIDERS, getProvider } from "../lib/aiProviders";
import { fetchKeyStatuses, saveProviderKey, deleteProviderKey, type KeyStatusMap } from "../lib/userKeys";
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
  isBrandManual?: boolean;
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
  const { user, workspaceId: personalWorkspaceId, configured: authConfigured, authRequired, signOut } = useAuth();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [authConfigChecked, setAuthConfigChecked] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [templates, setTemplates] = useState<Template[]>(() => readTemplateCache());
  const [selectedWs, setSelectedWs] = useState<string | null>(null);
  // Active workspace: explicit override (e.g. a newly created workspace) → the
  // signed-in user's personal workspace → the first accessible workspace.
  // Previously this was a hardcoded id (renzo's), which broke multi-tenancy:
  // every user landed in the same workspace and new accounts hit 403s.
  const activeWorkspaceId = selectedWs ?? personalWorkspaceId ?? workspaces[0]?.id ?? null;
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandCounts, setBrandCounts] = useState<Map<string, number>>(new Map());
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [showBrandManuals, setShowBrandManuals] = useState(false);
  const [searchDisplay, setSearchDisplay] = useState("");
  const [creatingWs, setCreatingWs] = useState(false);
  const [newWsName, setNewWsName] = useState("");
  const [editingWsId, setEditingWsId] = useState<string | null>(null);
  const [editingWsName, setEditingWsName] = useState("");
  const [editingTplId, setEditingTplId] = useState<string | null>(null);
  const [editingTplName, setEditingTplName] = useState("");
  const [creatingTpl, setCreatingTpl] = useState(false);
  const [newTplName, setNewTplName] = useState("");
  // The active tab lives in the URL hash (#workspace/<tab>), so a refresh
  // comes back to the same tab instead of resetting to Archivos — the editor
  // already survived a refresh because it carries ?template=<id>, and this
  // gives every dashboard tab the same property. Reading it here (rather
  // than defaulting to "templates" and correcting afterwards) avoids a
  // visible flash of the wrong tab on load.
  const [activeTab, setActiveTabState] = useState<WorkspaceTab>(() => {
    const route = readAppRoute(window.location);
    return route.kind === "workspace" && route.tab ? route.tab : DEFAULT_WORKSPACE_TAB;
  });

  // The pane within a tab (Red de Marcas: graph / table / pipeline / …).
  // Read straight from the URL on mount for the same reason as the tab.
  const [activePane, setActivePaneState] = useState<string | undefined>(() => {
    const route = readAppRoute(window.location);
    return route.kind === "workspace" ? route.pane : undefined;
  });

  /** Switch tabs and record it in the URL, so refresh/back behave. */
  const setActiveTab = useCallback((tab: WorkspaceTab) => {
    setActiveTabState(tab);
    // Panes belong to the tab that owns them; carrying one across would put a
    // stale segment in the URL of a tab that knows nothing about it.
    setActivePaneState(undefined);
    try {
      window.history.replaceState(null, "", workspaceTabUrl(tab));
      saveCurrentRoute();
    } catch { /* history may be unavailable in embedded contexts */ }
  }, []);

  /** Record the pane the active tab moved to, without touching the tab. */
  const setActivePane = useCallback((pane: string) => {
    setActivePaneState(pane);
    try {
      window.history.replaceState(null, "", workspaceTabUrl(activeTabRef.current, pane));
      saveCurrentRoute();
    } catch { /* history may be unavailable in embedded contexts */ }
  }, []);

  // Read inside setActivePane without making it depend on the tab, which would
  // rebuild the callback on every tab change and remount the pane below it.
  const activeTabRef = useRef<WorkspaceTab>(activeTab);
  activeTabRef.current = activeTab;

  // Keep up with browser back/forward, which changes the hash without
  // going through setActiveTab.
  useEffect(() => {
    const onHashChange = () => {
      const route = readAppRoute(window.location);
      if (route.kind === "workspace") {
        setActiveTabState(route.tab || DEFAULT_WORKSPACE_TAB);
        setActivePaneState(route.pane);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // A view like the editor can request landing on a specific tab (e.g. "go
  // manage your storage/trash") via sessionStorage. This has to run as an
  // effect (not a useState initializer) and specifically AFTER mount: the
  // child <OnboardingTour> below can force activeTab back to "templates" via
  // its own mount effect when a tour step is active, and child effects
  // always commit before the parent's — so this effect, running here in the
  // parent, reliably wins that race and applies last.
  useEffect(() => {
    const pending = sessionStorage.getItem("dashboardInitialTab");
    if (pending && isWorkspaceTab(pending)) {
      sessionStorage.removeItem("dashboardInitialTab");
      setActiveTab(pending);
    }
  }, [setActiveTab]);
  const [tourEnabled, setTourEnabled] = useState(() => isOnboardingEnabled());
  const [cardMode, setCardMode] = useState<"grid" | "flow">(() => {
    try { return localStorage.getItem("futuraria-card-mode") as "grid" | "flow" || "grid"; } catch { return "grid"; }
  });
  const [flowIndex, setFlowIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ── Card grid zoom (columns per row) ──
  const [cardColumns, setCardColumns] = useState(() => {
    try { const v = localStorage.getItem("futuraria-card-columns"); return v ? Number(v) : 4; } catch { return 4; }
  });
  // ── Date-range filter ──
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // ── Infinite scroll ──
  const PAGE_SIZE = 300;
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef(0); // tracks offset for the current workspace + brand combo
  // Ref bridge for observer callback — avoids stale closure over hasMore/loadingMore/wsId/brandId
  const obsRef = useRef({ hasMore: true, loadingMore: false, wsId: null as string | null, brandId: null as string | null });
  obsRef.current = { hasMore, loadingMore, wsId: activeWorkspaceId, brandId: selectedBrand };

  // Persist column count
  const handleColumnsChange = useCallback((cols: number) => {
    setCardColumns(cols);
    try { localStorage.setItem("futuraria-card-columns", String(cols)); } catch {}
  }, []);

  /* Check auth config once on mount */
  useEffect(() => {
    fetch("/api/auth/config", { headers: { Accept: "application/json" } })
      .then(r => r.json())
      .then(() => setAuthConfigChecked(true))
      .catch(() => setAuthConfigChecked(true));
  }, []);

  const handleSignOut = useCallback(async () => {
    saveCurrentRoute();
    await signOut();
    setUserMenuOpen(false);
    window.location.href = "/";
  }, [signOut]);

  /* Fetch storage health when Settings tab is active */
  useEffect(() => {
    if (activeTab !== "configuracion") return;
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
  const [autoDesignSystem, setAutoDesignSystem] = useState(() => {
    try { return localStorage.getItem("futuraria-auto-design-system") !== "false"; } catch { return true; }
  });
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteInputName, setDeleteInputName] = useState("");
  const [deleteSkipUntil, setDeleteSkipUntil] = useState(0);
  const [actionDropdownId, setActionDropdownId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  // Sub-tabs inside Diseño and Agentes.
  const [designSubTab, setDesignSubTab] = useState<"files" | "graph" | "table" | "trash">("files");
  const [agentSubTab, setAgentSubTab] = useState<"kanban" | "table" | "agents">("kanban");
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

  // ── Account profile + workspace access (Settings → "Tus datos") ──
  interface ProfileForm {
    display_name: string; first_name: string; last_name: string;
    phone: string; website: string; brand_name: string;
  }
  const EMPTY_PROFILE: ProfileForm = { display_name: "", first_name: "", last_name: "", phone: "", website: "", brand_name: "" };
  const [profile, setProfile] = useState<ProfileForm>(EMPTY_PROFILE);
  const [profileSaved, setProfileSaved] = useState<ProfileForm>(EMPTY_PROFILE);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState("");
  const [members, setMembers] = useState<Array<{ id: string; email?: string; display_name?: string; role?: string; joinedAt?: string }>>([]);
  const profileDirty = JSON.stringify(profile) !== JSON.stringify(profileSaved);

  const loadProfile = useCallback(async () => {
    try {
      const res = await apiFetch<any>("/account/me");
      const d = res?.data;
      if (!d) return;
      const form: ProfileForm = {
        display_name: d.display_name || "", first_name: d.first_name || "", last_name: d.last_name || "",
        phone: d.phone || "", website: d.website || "", brand_name: d.brand_name || "",
      };
      setProfile(form);
      setProfileSaved(form);
    } catch { /* signed out or server without Supabase — card just stays empty */ }
  }, []);

  const loadMembers = useCallback(async (wsId?: string) => {
    const id = wsId ?? activeWorkspaceId;
    if (!id) return;
    try {
      const res = await apiFetch<any>(`/workspaces/${id}/members`);
      setMembers(res?.data || []);
    } catch { setMembers([]); }
  }, [activeWorkspaceId]);

  useEffect(() => { void loadProfile(); }, [loadProfile]);
  useEffect(() => {
    const handler = () => { void loadProfile(); };
    window.addEventListener("futuraria:auth-token", handler);
    return () => window.removeEventListener("futuraria:auth-token", handler);
  }, [loadProfile]);

  const handleSaveProfile = async () => {
    setProfileSaving(true);
    setProfileMsg("");
    try {
      const res = await apiFetch<any>("/account/me", { method: "PATCH", body: JSON.stringify(profile) });
      if (res?.success === false) throw new Error(res.detail || res.error || "No se pudo guardar");
      setProfileSaved(profile);
      setProfileMsg("✓ Guardado");
      setTimeout(() => setProfileMsg(""), 2500);
    } catch (e: any) {
      setProfileMsg(e?.message?.includes("PROFILE_MIGRATION_REQUIRED") || e?.message?.includes("409")
        ? "Falta correr supabase_migrations_v16.sql en Supabase para habilitar estos campos."
        : (e?.message || "No se pudo guardar"));
    }
    setProfileSaving(false);
  };

  // ── Server-side BYOK key management (replaces localStorage) ──
  // Keys are encrypted server-side. The browser only knows whether a key
  // is configured and which model is selected — never the actual value.
  const geminiProvider = getProvider("google")!;
  const quiverProvider = getProvider("quiver")!;
  const [keyStatuses, setKeyStatuses] = useState<KeyStatusMap>({});
  const [geminiDraft, setGeminiDraft] = useState("");
  const [quiverDraft, setQuiverDraft] = useState("");
  const [editingGemini, setEditingGemini] = useState(false);
  const [editingQuiver, setEditingQuiver] = useState(false);
  const [keySaving, setKeySaving] = useState(false);

  const geminiConfigured = !!keyStatuses["google"]?.configured;
  const geminiModel = keyStatuses["google"]?.model || geminiProvider.models[0];
  const quiverConfigured = !!keyStatuses["quiver"]?.configured;
  const quiverModel = keyStatuses["quiver"]?.model || quiverProvider.models[0];

  const refreshKeyStatuses = useCallback(async () => {
    try {
      const statuses = await fetchKeyStatuses();
      setKeyStatuses(statuses);
    } catch { /* not signed in or server not configured */ }
  }, []);

  useEffect(() => { void refreshKeyStatuses(); }, [refreshKeyStatuses]);
  // Auth token is set asynchronously by AuthProvider — re-fetch key statuses
  // once it arrives so BYOK keys survive a page reload.
  useEffect(() => {
    const handler = () => { void refreshKeyStatuses(); };
    window.addEventListener("futuraria:auth-token", handler);
    return () => window.removeEventListener("futuraria:auth-token", handler);
  }, [refreshKeyStatuses]);

  const handleSaveGeminiKey = async (value: string) => {
    const v = value.trim();
    setKeySaving(true);
    try {
      if (v) {
        await saveProviderKey("google", v, geminiModel);
      } else {
        await deleteProviderKey("google");
      }
      await refreshKeyStatuses();
      setEditingGemini(false);
      setGeminiDraft("");
      addToast(v ? "Gemini key saved (encrypted server-side)." : "Gemini key removed.", v ? "success" : "info");
    } catch (err: any) {
      addToast(`Save failed: ${err.message}`, "error");
    }
    setKeySaving(false);
  };

  const handleSaveGeminiModel = async (m: string) => {
    setKeySaving(true);
    try {
      if (geminiConfigured) {
        await saveProviderKey("google", "", m);
      }
      await refreshKeyStatuses();
    } catch { /* model save is best-effort */ }
    setKeySaving(false);
  };

  const handleSaveQuiverKey = async (value: string) => {
    const v = value.trim();
    setKeySaving(true);
    try {
      if (v) {
        await saveProviderKey("quiver", v, quiverModel);
      } else {
        await deleteProviderKey("quiver");
      }
      await refreshKeyStatuses();
      setEditingQuiver(false);
      setQuiverDraft("");
      addToast(v ? "Quiver key saved (encrypted server-side)." : "Quiver key removed.", v ? "success" : "info");
    } catch (err: any) {
      addToast(`Save failed: ${err.message}`, "error");
    }
    setKeySaving(false);
  };
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
    if (!activeWorkspaceId) return;
    setApiKeyRotating(true);
    try {
      const res = await apiFetch<{ success: boolean; data: { key: string; label: string; key_prefix: string } }>(
        `/workspaces/${activeWorkspaceId}/api-keys`,
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
    if (!activeWorkspaceId) return;
    setApiKeyRotating(true);
    try {
      const res = await apiFetch<{ success: boolean; data: { key: string; label: string; key_prefix: string } }>(
        `/workspaces/${activeWorkspaceId}/api-keys`,
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

  const loadTemplates = useCallback(async (wsId?: string, brandId?: string, offset = 0) => {
    const isReset = offset === 0;
    const hasStaleData = loadingRef.current === false;
    if (!hasStaleData && isReset) setLoading(true);
    if (!isReset) setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      if (wsId) params.set("workspaceId", wsId);
      if (brandId) params.set("brandId", brandId);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      if (searchRef.current) params.set("search", searchRef.current);
      const qs = params.toString();
      const res = await apiFetch<{ success: boolean; data: Template[]; total: number }>(`/templates?${qs}`);
      const data = (res.data || []);
      // Sort by most recently updated first
      data.sort((a, b) =>
        new Date(b.metadata?.updatedAt || 0).getTime() - new Date(a.metadata?.updatedAt || 0).getTime()
      );
      if (isReset) {
        setTemplates(data);
        writeTemplateCache(data);
        pageRef.current = data.length;
        setHasMore(data.length >= PAGE_SIZE);
        loadMetaCovers(wsId);
      } else {
        setTemplates(prev => [...prev, ...data]);
        pageRef.current = offset + data.length;
        setHasMore(data.length >= PAGE_SIZE);
      }
    } catch {
      if (isReset && !hasStaleData) setTemplates([]);
      if (!isReset) setHasMore(false);
      addToast("Error al cargar las plantillas.", "error");
    }
    setLoading(false);
    setLoadingMore(false);
  }, [setLoading, addToast, PAGE_SIZE]);

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

  loadTemplatesRef.current = (wsId?: string, brandId?: string) => loadTemplates(wsId, brandId, 0);

  const loadRecipes = useCallback(async () => {
    setLoadingRecipes(true);
    try {
      const res = await apiFetch<{ success: boolean; data: Recipe[] }>("/api/recipes");
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
    if (activeWorkspaceId) loadTemplatesRef.current(activeWorkspaceId, selectedBrand ?? undefined);
  }, [selectedBrand, activeWorkspaceId]);

  const handleBrandChange = useCallback((brandId: string | null) => {
    setSelectedBrand(brandId);
    if (activeWorkspaceId) loadTemplatesRef.current(activeWorkspaceId, brandId ?? undefined);
  }, [activeWorkspaceId]);

  // ── Load the workspace list once on mount ──
  useEffect(() => {
    if (window.location.hash !== "#workspace") {
      window.history.replaceState(null, "", "/#workspace");
    }
    apiFetch<{ success: boolean; data: Workspace[] }>("/workspaces")
      .then(r => setWorkspaces(r.data || []))
      .catch(() => {
        addToast("Error al cargar los workspaces.", "error");
      });
  }, [addToast]);

  // ── Load templates, brands and members for the active (per-user) workspace ──
  useEffect(() => {
    if (!activeWorkspaceId) return;
    loadTemplatesRef.current(activeWorkspaceId);
    apiFetch<{ success: boolean; data: Brand[] }>(`/saas/workspaces/${activeWorkspaceId}/brands`)
      .then(r => setBrands(r.data || []))
      .catch(() => {});
    void loadMembers(activeWorkspaceId);
  }, [activeWorkspaceId, loadMembers]);

  // ── Infinite scroll observer ──
  // Uses obsRef.current to avoid stale closures — the observer callback always
  // reads the latest hasMore/loadingMore/wsId/brandId values.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(([entry]) => {
      const { hasMore: hm, loadingMore: lm, wsId, brandId } = obsRef.current;
      if (entry.isIntersecting && hm && !lm) {
        loadTemplates(wsId ?? undefined, brandId ?? undefined, pageRef.current);
      }
    }, { rootMargin: "300px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeTab, loadTemplates]);

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
      downloadBlob(blob, `${name}.futuraria.json`);
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
    if (!activeWorkspaceId) return;
    const name = newTplName.trim() || "Untitled";
    setCreatingTpl(false);
    setNewTplName("");
    onCreateHtmlTemplate(activeWorkspaceId, name);
  };

  /* Snapshot all templates: rasterize each frame (see frameCapture.ts — replaced
     html2canvas, which never supported CSS filters and dropped body/html rules
     scoped to the frame) → save as base64 thumbnail. */
  const [snapshotProgress, setSnapshotProgress] = useState({ running: false, done: 0, total: 0 });
  const handleSnapshotAll = useCallback(async () => {
    const htmlTemplates = templates.filter(t => t.frames?.[0]?.html);
    if (htmlTemplates.length === 0) { addToast("No templates with HTML content to snapshot.", "error"); return; }
    setSnapshotProgress({ running: true, done: 0, total: htmlTemplates.length });
    for (let i = 0; i < htmlTemplates.length; i++) {
      const t = htmlTemplates[i];
      const frame = t.frames![0];
      try {
        const canvas = await rasterizeFrame({
          html: frame.html || "", css: frame.css || "",
          width: t.width, height: t.height,
          background: frame.background || "#0d0d1a",
        }, 0.5);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        await mcpCall("update_thumbnail", { templateId: t.id, thumbnail: dataUrl });
      } catch { /* skip failures, continue */ }
      setSnapshotProgress(prev => ({ ...prev, done: i + 1 }));
    }
    setSnapshotProgress({ running: false, done: 0, total: 0 });
    addToast(`${htmlTemplates.length} thumbnails captured.`, "success");
    if (activeWorkspaceId) loadTemplatesRef.current(activeWorkspaceId);
  }, [templates, addToast, activeWorkspaceId]);

  const handleDeleteRecipe = async (id: string) => {
    try {
      await apiFetch(`/api/recipes/${id}`, { method: "DELETE" });
      setRecipes(prev => prev.filter(r => r.id !== id));
    } catch {
      addToast("Error al eliminar el Key Visual.", "error");
    }
  };

  const handleCreateFromRecipe = async (recipeId: string, recipeName: string) => {
    if (!activeWorkspaceId) return;
    try {
      const res = await apiFetch<{ success: boolean; data: { templateId: string } }>(`/api/recipes/${recipeId}/execute`, {
        method: "POST",
        body: JSON.stringify({ variables: {}, workspaceId: activeWorkspaceId }),
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
       handleSnapshotAll replaces them with real PNGs via rasterizeFrame.
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
              { id: "diseno", label: "Diseño", icon: <IconFile size={14} /> },
              { id: "agentes", label: "Agentes", icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="18" rx="1" />
                  <rect x="14" y="3" width="7" height="10" rx="1" />
                </svg>
              )},
{ id: "copywriting", label: "Copywriting", icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              )},
              { id: "contactos", label: "Contactos", icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="6" cy="6" r="2" />
                  <circle cx="18" cy="6" r="2" />
                  <circle cx="12" cy="18" r="2" />
                  <line x1="7.5" y1="7.5" x2="11" y2="16" />
                  <line x1="16.5" y1="7.5" x2="13" y2="16" />
                  <line x1="8" y1="6" x2="16" y2="6" />
                </svg>
              )},
              { id: "configuracion", label: "Configuración", icon: (
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
                        onClick={() => { setActiveTab("diseno"); setUserMenuOpen(false); }}
                        style={{ ...dropdownItemStyle, display: "flex", alignItems: "center", gap: 8 }}
                      >
                        <IconFile size={14} /> Diseño
                      </button>
                      <button
                        type="button"
                        onClick={() => { setActiveTab("agentes"); setUserMenuOpen(false); }}
                        style={{ ...dropdownItemStyle, display: "flex", alignItems: "center", gap: 8 }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="18" rx="1" /><rect x="14" y="3" width="7" height="10" rx="1" /></svg>
                        Agentes
                      </button>
                      <button
                        type="button"
                        onClick={() => { setActiveTab("copywriting"); setUserMenuOpen(false); }}
                        style={{ ...dropdownItemStyle, display: "flex", alignItems: "center", gap: 8 }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                        Copywriting
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
                        onClick={() => { setDesignSubTab("trash"); setActiveTab("diseno"); setUserMenuOpen(false); }}
                        style={{ ...dropdownItemStyle, display: "flex", alignItems: "center", gap: 8 }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                        Papelera
                      </button>
                      <button
                        type="button"
                        onClick={() => { setActiveTab("contactos"); setUserMenuOpen(false); }}
                        style={{ ...dropdownItemStyle, display: "flex", alignItems: "center", gap: 8 }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                        Contactos
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
                        onClick={() => { setActiveTab("configuracion"); setUserMenuOpen(false); }}
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
                onClick={() => setActiveTab("configuracion")}
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
              onClick={() => setActiveTab("configuracion")}
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

      {/* ── Diseño Tab (sub-tabs: Archivos / Grafo / Tablas) ── */}
      {activeTab === "diseno" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Sub-tab bar */}
          <div style={{ display: "flex", gap: 4, padding: "6px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(12,14,20,0.9)", flexShrink: 0 }}>
            <button type="button" onClick={() => setDesignSubTab("files")} style={{ padding: "5px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: designSubTab === "files" ? 600 : 400, color: designSubTab === "files" ? "#fff" : "rgba(255,255,255,0.45)", background: designSubTab === "files" ? "rgba(99,102,241,0.22)" : "transparent", border: designSubTab === "files" ? "1px solid rgba(99,102,241,0.5)" : "1px solid transparent", fontFamily: "inherit", transition: "all 0.15s" }}>Archivos</button>
            <button type="button" onClick={() => setDesignSubTab("graph")} style={{ padding: "5px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: designSubTab === "graph" ? 600 : 400, color: designSubTab === "graph" ? "#fff" : "rgba(255,255,255,0.45)", background: designSubTab === "graph" ? "rgba(99,102,241,0.22)" : "transparent", border: designSubTab === "graph" ? "1px solid rgba(99,102,241,0.5)" : "1px solid transparent", fontFamily: "inherit", transition: "all 0.15s" }}>Grafo</button>
            <button type="button" onClick={() => setDesignSubTab("table")} style={{ padding: "5px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: designSubTab === "table" ? 600 : 400, color: designSubTab === "table" ? "#fff" : "rgba(255,255,255,0.45)", background: designSubTab === "table" ? "rgba(99,102,241,0.22)" : "transparent", border: designSubTab === "table" ? "1px solid rgba(99,102,241,0.5)" : "1px solid transparent", fontFamily: "inherit", transition: "all 0.15s" }}>Tablas</button>
            <button type="button" onClick={() => setDesignSubTab("trash")} style={{ padding: "5px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: designSubTab === "trash" ? 600 : 400, color: designSubTab === "trash" ? "#fff" : "rgba(255,255,255,0.45)", background: designSubTab === "trash" ? "rgba(99,102,241,0.22)" : "transparent", border: designSubTab === "trash" ? "1px solid rgba(99,102,241,0.5)" : "1px solid transparent", fontFamily: "inherit", transition: "all 0.15s" }}>Papelera</button>
          </div>
          {/* Sub-tab content */}
          {designSubTab === "files" ? (
      <div data-tour="templates-grid" style={{
        flex: 1, overflowY: "auto", padding: "16px 20px 20px 20px",
        background: "#06080d",
      }}>
        {/* ── Filter bar: brand dropdown · date range · zoom slider ── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12, marginBottom: 18,
          flexWrap: "wrap", padding: "0 0 10px 0", borderBottom: "1px solid rgba(255,255,255,0.04)",
        }}>
          {/* Brand dropdown */}
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>
            Marca
            <select
              value={selectedBrand || ""}
              onChange={e => handleBrandChange(e.target.value || null)}
              style={{
                padding: "5px 10px", borderRadius: 8, fontSize: 12,
                background: "rgba(15, 18, 28, 0.9)", border: "1px solid rgba(255,255,255,0.1)",
                color: "rgba(255,255,255,0.85)", fontFamily: "inherit",
                cursor: "pointer", outline: "none",
              }}
            >
              <option value="">Todas las marcas ({brands.filter(b => (brandCounts.get(b.id) || 0) > 0).length} activas)</option>
              {brands.map(b => {
                const count = brandCounts.get(b.id) || 0;
                return (
                  <option key={b.id} value={b.id}>
                    {b.name}{count > 0 ? ` (${count})` : ""}
                  </option>
                );
              })}
            </select>
          </label>

          {/* Brand Manuals filter toggle */}
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: showBrandManuals ? "#c8b898" : "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap", cursor: "pointer", userSelect: "none" }}>
            <input
              type="checkbox"
              checked={showBrandManuals}
              onChange={e => { setShowBrandManuals(e.target.checked); if (activeWorkspaceId) loadTemplatesRef.current(activeWorkspaceId, selectedBrand ?? undefined); }}
              style={{ accentColor: "#c8b898", cursor: "pointer" }}
            />
            📖 Brand Manuals
          </label>

          {/* Date range */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              aria-label="Fecha desde"
              style={{
                padding: "4px 8px", borderRadius: 6, fontSize: 11,
                background: "rgba(15, 18, 28, 0.9)", border: "1px solid rgba(255,255,255,0.1)",
                color: "rgba(255,255,255,0.75)", fontFamily: "inherit",
                outline: "none", width: 120,
              }}
            />
            <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 11 }}>–</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              aria-label="Fecha hasta"
              style={{
                padding: "4px 8px", borderRadius: 6, fontSize: 11,
                background: "rgba(15, 18, 28, 0.9)", border: "1px solid rgba(255,255,255,0.1)",
                color: "rgba(255,255,255,0.75)", fontFamily: "inherit",
                outline: "none", width: 120,
              }}
            />
          </div>

          <div style={{ flex: 1 }} />

          {/* Zoom slider */}
          <label style={{
            display: "flex", alignItems: "center", gap: 8, fontSize: 11,
            color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap",
          }}>
            Vista: {cardColumns} col
            <input
              type="range"
              min={2} max={6} step={1}
              value={cardColumns}
              onChange={e => handleColumnsChange(parseInt(e.target.value))}
              title={`${cardColumns} columnas por fila`}
              style={{ accentColor: "#6366f1", width: 80 }}
            />
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", fontFamily: "'SF Mono', monospace" }}>
              {cardColumns <= 3 ? "🔍" : cardColumns >= 5 ? "🔎" : "▪"}
            </span>
          </label>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", padding: 60 }}>Loading…</div>
        ) : templates.length === 0 ? (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}><IconFile size={40} color="rgba(255,255,255,0.3)" /></div>
            <div>No templates yet. Create your first one!</div>
            <button
              type="button"
              onClick={() => activeWorkspaceId && onCreateHtmlTemplate(activeWorkspaceId, "Untitled")}
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
          <>
            <div className="dash-template-grid" style={{
              display: "grid",
              gridTemplateColumns: `repeat(auto-fill, minmax(${cardColumns <= 3 ? 380 : cardColumns <= 4 ? 280 : 190}px, 1fr))`,
              gap: 18,
            }}>
              {(dateFrom || dateTo || showBrandManuals
                ? templates.filter(t => {
                    if (showBrandManuals && !t.isBrandManual) return false;
                    if (dateFrom || dateTo) {
                      const d = new Date(t.metadata.updatedAt).getTime();
                      if (dateFrom && d < new Date(dateFrom).getTime()) return false;
                      if (dateTo && d > new Date(dateTo + "T23:59:59").getTime()) return false;
                    }
                    return true;
                  })
                : templates
              ).map(t => renderTemplateCard(t))}
            </div>
          </>
        )}
        {/* Infinite scroll sentinel — always rendered so observer can attach after loading */}
        <div ref={sentinelRef} style={{ height: 1 }} />
        {loadingMore && (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.25)", padding: "12px 0 20px", fontSize: 11 }}>
            Cargando más archivos…
          </div>
        )}
      </div>
      ) : designSubTab === "graph" ? (
            <div style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
              <BrandGraphCanvas workspaceId={activeWorkspaceId} onOpenTemplate={(id) => onSelectTemplate(id)} />
            </div>
          ) : designSubTab === "table" ? (
            <div style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
              <BrandGraphDataTable workspaceId={activeWorkspaceId} onOpenTemplate={(id) => onSelectTemplate(id)} />
            </div>
          ) : (
            <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              <StorageTab workspaceId={activeWorkspaceId} />
            </div>
          )}
        </div>
      )}

      {/* ── Copywriting Tab ── */}
      {activeTab === "copywriting" && (
        <ContentTab workspaceId={activeWorkspaceId} onOpenTemplate={(id) => window.open(`/?template=${id}&v=2`, "_blank")} />
      )}

      {/* ── Agentes Tab (sub-tabs: Kanban / Tabla / Agentes) ── */}
      {activeTab === "agentes" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Sub-tab bar */}
          <div style={{ display: "flex", gap: 4, padding: "6px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(12,14,20,0.9)", flexShrink: 0 }}>
            <button type="button" onClick={() => setAgentSubTab("kanban")} style={{ padding: "5px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: agentSubTab === "kanban" ? 600 : 400, color: agentSubTab === "kanban" ? "#fff" : "rgba(255,255,255,0.45)", background: agentSubTab === "kanban" ? "rgba(99,102,241,0.22)" : "transparent", border: agentSubTab === "kanban" ? "1px solid rgba(99,102,241,0.5)" : "1px solid transparent", fontFamily: "inherit", transition: "all 0.15s" }}>Kanban</button>
            <button type="button" onClick={() => setAgentSubTab("table")} style={{ padding: "5px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: agentSubTab === "table" ? 600 : 400, color: agentSubTab === "table" ? "#fff" : "rgba(255,255,255,0.45)", background: agentSubTab === "table" ? "rgba(99,102,241,0.22)" : "transparent", border: agentSubTab === "table" ? "1px solid rgba(99,102,241,0.5)" : "1px solid transparent", fontFamily: "inherit", transition: "all 0.15s" }}>Tabla</button>
            <button type="button" onClick={() => setAgentSubTab("agents")} style={{ padding: "5px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: agentSubTab === "agents" ? 600 : 400, color: agentSubTab === "agents" ? "#fff" : "rgba(255,255,255,0.45)", background: agentSubTab === "agents" ? "rgba(99,102,241,0.22)" : "transparent", border: agentSubTab === "agents" ? "1px solid rgba(99,102,241,0.5)" : "1px solid transparent", fontFamily: "inherit", transition: "all 0.15s" }}>Agentes</button>
          </div>
          {/* Sub-tab content */}
          {agentSubTab === "kanban" ? (
            <KanbanTab workspaceId={activeWorkspaceId ?? ""} />
          ) : agentSubTab === "table" ? (
            <KanbanTableView workspaceId={activeWorkspaceId ?? ""} />
          ) : (
            <AgentsPanel />
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

      {/* ── Settings Tab ── */}
      {activeTab === "configuracion" && (
        <WorkspaceConsole
          mode="settings"
          workspaceId={activeWorkspaceId}
          workspaceName={workspaces.find(workspace => workspace.id === activeWorkspaceId)?.name}
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
            downloadBlob(blob, "SKILL.md");
          } catch { alert("Could not download SKILL.md"); }
        };

        return (
        <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px", width: "100%" }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 22, display: "flex", alignItems: "center", gap: 10 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            Configuración
          </h2>

          {/* ═══════════ 1 · TUS DATOS ═══════════ */}
          <h3 className="bento-section-title">Tus datos</h3>
          <div className="bento-grid">

            {/* Perfil — editable */}
            <div className="bento-card bento-7">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div className="bento-title">👤 Tu perfil</div>
                {profileMsg && (
                  <span style={{ fontSize: 11, color: profileMsg.startsWith("✓") ? "#4ade80" : "#facc15", textAlign: "right", maxWidth: 260 }}>
                    {profileMsg}
                  </span>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                <div className="bento-field">
                  <label htmlFor="pf-first">Nombre</label>
                  <input id="pf-first" className="bento-input" value={profile.first_name}
                    onChange={e => setProfile(p => ({ ...p, first_name: e.target.value }))} placeholder="Renzo" />
                </div>
                <div className="bento-field">
                  <label htmlFor="pf-last">Apellidos</label>
                  <input id="pf-last" className="bento-input" value={profile.last_name}
                    onChange={e => setProfile(p => ({ ...p, last_name: e.target.value }))} placeholder="Pérez" />
                </div>
                <div className="bento-field">
                  <label htmlFor="pf-brand">Nombre de tu marca</label>
                  <input id="pf-brand" className="bento-input" value={profile.brand_name}
                    onChange={e => setProfile(p => ({ ...p, brand_name: e.target.value }))} placeholder="Futuraria" />
                </div>
                <div className="bento-field">
                  <label htmlFor="pf-web">Web</label>
                  <input id="pf-web" className="bento-input" value={profile.website}
                    onChange={e => setProfile(p => ({ ...p, website: e.target.value }))} placeholder="futuraria.com" />
                </div>
                <div className="bento-field">
                  <label htmlFor="pf-phone">Teléfono</label>
                  <input id="pf-phone" className="bento-input" value={profile.phone}
                    onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))} placeholder="+51 …" />
                </div>
                <div className="bento-field">
                  <label htmlFor="pf-email">Correo</label>
                  <input id="pf-email" className="bento-input" value={user?.email || ""} readOnly disabled
                    style={{ opacity: 0.65, cursor: "not-allowed" }} />
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="button" className="bento-btn bento-btn--primary"
                  onClick={handleSaveProfile} disabled={!profileDirty || profileSaving}>
                  {profileSaving ? "Guardando…" : profileDirty ? "Guardar cambios" : "Guardado"}
                </button>
              </div>
            </div>

            {/* Workspace */}
            <div className="bento-card bento-5">
              <div className="bento-title">🏢 Espacio de trabajo</div>
              <div>
                <div className="bento-row">
                  <span className="bento-row-label">Nombre</span>
                  <span className="bento-row-value">
                    {workspaces.find(w => w.id === activeWorkspaceId)?.name || "—"}
                  </span>
                </div>
                <div className="bento-row">
                  <span className="bento-row-label">ID</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <code style={{ fontSize: 11, color: "rgba(255,255,255,0.75)", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {activeWorkspaceId || "—"}
                    </code>
                    <button type="button" className="bento-btn" style={{ padding: "4px 10px", fontSize: 11 }}
                      onClick={() => { navigator.clipboard?.writeText(activeWorkspaceId || ""); addToast("ID copiado", "success"); }}>
                      Copiar
                    </button>
                  </span>
                </div>
                <div className="bento-row">
                  <span className="bento-row-label">Archivos</span>
                  <span className="bento-row-value">{templates.length} · {totalFrames} frames</span>
                </div>
                <div className="bento-row">
                  <span className="bento-row-label">Key Visuals · Marcas</span>
                  <span className="bento-row-value">{recipes.length} · {brands.length}</span>
                </div>
                <div className="bento-row">
                  <span className="bento-row-label">Tokens (est.)</span>
                  <span className="bento-row-value">~{estimatedTokens.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Quién tiene acceso */}
            <div className="bento-card bento-6">
              <div className="bento-title">👥 Quién tiene acceso</div>
              {members.length === 0 ? (
                <div className="bento-sub">
                  Solo vos. Cuando invites a alguien al espacio de trabajo, aparece acá con su rol.
                </div>
              ) : (
                <div>
                  {members.map(m => (
                    <div key={m.id} className="bento-row">
                      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                        <span className="bento-row-value">{m.display_name || m.email || m.id}</span>
                        {m.display_name && m.email && (
                          <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)" }}>{m.email}</span>
                        )}
                      </span>
                      <span className={`bento-pill ${m.role === "owner" ? "bento-pill--ok" : "bento-pill--off"}`}>
                        {m.role || "member"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Dispositivos / sesiones */}
            <div className="bento-card bento-6">
              <div className="bento-title">💻 Dispositivos y sesiones</div>
              {sessionsLoading ? (
                <div className="bento-sub">Cargando…</div>
              ) : sessions.length === 0 ? (
                <div className="bento-sub">
                  Todavía no hay registro de sesiones. Aparecen acá cuando un cliente MCP o un
                  navegador se conecta usando tu API key.
                </div>
              ) : (
                <div>
                  {sessions.map((s, i) => (
                    <div key={i} className="bento-row">
                      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                        <span className="bento-row-value" title={s.user_agent}>
                          {s.client_info || s.user_agent?.slice(0, 32) || "Desconocido"}
                        </span>
                        <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)" }}>
                          {new Date(s.last_seen).toLocaleString()} · {s.request_count} req
                        </span>
                      </span>
                      <span className="bento-pill bento-pill--off">{s.key_label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ═══════════ 2 · TUS LLAVES ═══════════ */}
          <h3 className="bento-section-title">Tus llaves</h3>
          <div className="bento-grid">

            {/* API key de Futuraria */}
            <div className="bento-card bento-4 bento-card--accent">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div className="bento-title">🔑 API de Futuraria</div>
                <span className={`bento-pill ${hasApiKey() ? "bento-pill--ok" : "bento-pill--warn"}`}>
                  {hasApiKey() ? "Activa" : "Falta"}
                </span>
              </div>
              <div className="bento-sub">
                Es la llave de <strong>esta</strong> app. La usan los clientes MCP (Claude Code, Hermes,
                OpenClaw) y las herramientas de diseño.
              </div>
              {showApiKeyInput || !hasApiKey() ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <input
                    className="bento-input" style={{ flex: 1, minWidth: 140 }}
                    value={apiKeyValue}
                    onChange={e => setApiKeyValue(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleSaveApiKey(); if (e.key === "Escape") setShowApiKeyInput(false); }}
                    placeholder="fdr_…"
                  />
                  <button type="button" className="bento-btn bento-btn--primary" onClick={handleSaveApiKey} disabled={!apiKeyValue.trim()}>Guardar</button>
                  {!hasApiKey() && (
                    <button type="button" className="bento-btn" onClick={handleGenerateKey} disabled={apiKeyRotating}>
                      {apiKeyRotating ? "Generando…" : "Generar"}
                    </button>
                  )}
                  {hasApiKey() && (
                    <button type="button" className="bento-btn" onClick={() => { setShowApiKeyInput(false); setApiKeyValue(getApiKey()); }}>Cancelar</button>
                  )}
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <code style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>
                    {getApiKey().slice(0, 6)}…{getApiKey().slice(-4)}
                  </code>
                  <div style={{ display: "flex", gap: 5 }}>
                    <button type="button" className="bento-btn" onClick={() => setShowApiKeyInput(true)}>Cambiar</button>
                    <button type="button" className="bento-btn" onClick={handleRotateKey} disabled={apiKeyRotating}>
                      {apiKeyRotating ? "Rotando…" : "Rotar"}
                    </button>
                    <button type="button" className="bento-btn bento-btn--danger" onClick={handleRemoveApiKey}>Borrar</button>
                  </div>
                </div>
              )}
            </div>

            {/* Gemini */}
            <div className="bento-card bento-4">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div className="bento-title">🧠 Google Gemini</div>
                <span className={`bento-pill ${geminiConfigured ? "bento-pill--ok" : "bento-pill--warn"}`}>
                  {geminiConfigured ? "Configurada" : "Falta"}
                </span>
              </div>
              <div className="bento-sub">
                Se usa en <strong>🪄 Convertir imagen a diseño</strong>. Cifrada en el servidor.
                No sirve una key de DeepSeek/OpenAI acá.
              </div>
              {editingGemini || !geminiConfigured ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <input
                    type="password" className="bento-input" style={{ flex: 1, minWidth: 140 }}
                    value={geminiDraft}
                    onChange={e => setGeminiDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && geminiDraft.trim()) handleSaveGeminiKey(geminiDraft);
                      if (e.key === "Escape") { setEditingGemini(false); setGeminiDraft(""); }
                    }}
                    placeholder="AIza…"
                  />
                  <button type="button" className="bento-btn bento-btn--primary"
                    onClick={() => handleSaveGeminiKey(geminiDraft)} disabled={!geminiDraft.trim() || keySaving}>Guardar</button>
                  {geminiConfigured && (
                    <button type="button" className="bento-btn" onClick={() => { setEditingGemini(false); setGeminiDraft(""); }}>Cancelar</button>
                  )}
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>🔒 Cifrada en el servidor</span>
                  <div style={{ display: "flex", gap: 5 }}>
                    <button type="button" className="bento-btn" onClick={() => { setGeminiDraft(""); setEditingGemini(true); }}>Cambiar</button>
                    <button type="button" className="bento-btn bento-btn--danger" onClick={() => handleSaveGeminiKey("")}>Borrar</button>
                  </div>
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", whiteSpace: "nowrap" }}>Modelo</span>
                <select className="bento-input" style={{ flex: 1, cursor: "pointer" }}
                  value={geminiModel} onChange={e => handleSaveGeminiModel(e.target.value)}>
                  {geminiProvider.models.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 11, color: "#818cf8", textDecoration: "none" }}>Obtener key gratis ↗</a>
            </div>

            {/* Quiver */}
            <div className="bento-card bento-4">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div className="bento-title">✦ Quiver AI</div>
                <span className={`bento-pill ${quiverConfigured ? "bento-pill--ok" : "bento-pill--warn"}`}>
                  {quiverConfigured ? "Configurada" : "Falta"}
                </span>
              </div>
              <div className="bento-sub">
                Se usa para <strong>vectorizar imagen a SVG</strong> y generar SVG desde texto
                (pestaña IA del panel de iconos). Cifrada en el servidor.
              </div>
              {editingQuiver || !quiverConfigured ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <input
                    type="password" className="bento-input" style={{ flex: 1, minWidth: 140 }}
                    value={quiverDraft}
                    onChange={e => setQuiverDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && quiverDraft.trim()) handleSaveQuiverKey(quiverDraft);
                      if (e.key === "Escape") { setEditingQuiver(false); setQuiverDraft(""); }
                    }}
                    placeholder="qv_…"
                  />
                  <button type="button" className="bento-btn bento-btn--primary"
                    onClick={() => handleSaveQuiverKey(quiverDraft)} disabled={!quiverDraft.trim() || keySaving}>Guardar</button>
                  {quiverConfigured && (
                    <button type="button" className="bento-btn" onClick={() => { setEditingQuiver(false); setQuiverDraft(""); }}>Cancelar</button>
                  )}
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>🔒 Cifrada en el servidor</span>
                  <div style={{ display: "flex", gap: 5 }}>
                    <button type="button" className="bento-btn" onClick={() => { setQuiverDraft(""); setEditingQuiver(true); }}>Cambiar</button>
                    <button type="button" className="bento-btn bento-btn--danger" onClick={() => handleSaveQuiverKey("")}>Borrar</button>
                  </div>
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", whiteSpace: "nowrap" }}>Modelo</span>
                <select className="bento-input" style={{ flex: 1, cursor: "pointer" }}
                  value={quiverModel}
                  onChange={e => { if (quiverConfigured) saveProviderKey("quiver", "", e.target.value).then(refreshKeyStatuses).catch(() => {}); }}>
                  {quiverProvider.models.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <a href="https://quiver.ai" target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 11, color: "#818cf8", textDecoration: "none" }}>Obtener key ↗</a>
            </div>

            {/* Dónde vive cada llave */}
            <div className="bento-card bento-12">
              <div className="bento-title">🗂 Dónde vive cada llave</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
                <div className="bento-sub">
                  <strong style={{ color: "rgba(255,255,255,0.8)" }}>Gemini · Quiver</strong><br />
                  Acá arriba. Cifradas en el servidor, nunca visibles en el navegador.
                </div>
                <div className="bento-sub">
                  <strong style={{ color: "rgba(255,255,255,0.8)" }}>Proveedor del chat</strong><br />
                  Dentro del propio chat (⚙ Configuración). Puede ser DeepSeek, OpenAI, Anthropic
                  u OpenRouter — cada uno con su modelo.
                </div>
                <div className="bento-sub">
                  <strong style={{ color: "rgba(255,255,255,0.8)" }}>Unsplash</strong><br />
                  En el panel de iconos → pestaña Fotos. Guardada en este navegador.
                </div>
                <div className="bento-sub">
                  <strong style={{ color: "rgba(255,255,255,0.8)" }}>MCP</strong><br />
                  Los clientes MCP se conectan a <code style={{ fontSize: 10.5 }}>/mcp</code> con la
                  API de Futuraria. No necesitan llave propia.
                </div>
              </div>
            </div>
          </div>

          {/* ═══════════ 3 · PREFERENCIAS ═══════════ */}
          <h3 className="bento-section-title">Preferencias</h3>
          <div className="bento-grid">

            {/* Vista */}
            <div className="bento-card bento-4">
              <div className="bento-title">🎴 Vista de archivos</div>
              <div className="bento-sub">
                {cardMode === "grid" ? "Cuadrícula" : "Cover Flow (slider en perspectiva)"}
              </div>
              <div className="bento-seg" style={{ alignSelf: "flex-start" }}>
                <button type="button" data-active={cardMode === "grid"} onClick={() => handleCardModeChange("grid")}>Cuadrícula</button>
                <button type="button" data-active={cardMode === "flow"} onClick={() => handleCardModeChange("flow")}>Flow</button>
              </div>
            </div>

            {/* Tour */}
            <div className="bento-card bento-4">
              <div className="bento-title">🧭 Tour guiado</div>
              <div className="bento-sub">Recorrido paso a paso: templates, editor, IA y grafo.</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <div className="bento-seg">
                  <button type="button" data-active={tourEnabled}
                    onClick={() => { setOnboardingEnabled(true); setTourEnabled(true); }}>Activado</button>
                  <button type="button" data-active={!tourEnabled}
                    onClick={() => { setOnboardingEnabled(false); setTourEnabled(false); }}>Desactivado</button>
                </div>
                <button type="button" className="bento-btn"
                  onClick={() => { restartOnboarding(); setTourEnabled(true); setActiveTab("diseno"); }}>Reiniciar</button>
              </div>
            </div>

            {/* Auto Design System */}
            <div className="bento-card bento-4">
              <div className="bento-title">🎨 Design System automático</div>
              <div className="bento-sub">
                {autoDesignSystem
                  ? "Cada marca nueva crea automáticamente un archivo DesignSystem_ y lo conecta al grafo."
                  : "Las marcas se crean sin Design System. Puedes crearlo manualmente desde la pestaña Tablas."}
              </div>
              <div className="bento-seg" style={{ alignSelf: "flex-start" }}>
                <button type="button" data-active={autoDesignSystem}
                  onClick={() => { setAutoDesignSystem(true); try { localStorage.setItem("futuraria-auto-design-system", "true"); } catch {} }}>Activado</button>
                <button type="button" data-active={!autoDesignSystem}
                  onClick={() => { setAutoDesignSystem(false); try { localStorage.setItem("futuraria-auto-design-system", "false"); } catch {} }}>Desactivado</button>
              </div>
            </div>

            {/* Borrado */}
            <div className="bento-card bento-4">
              <div className="bento-title">🗑 Al borrar</div>
              <div className="bento-sub">
                {deleteMode === "soft" ? "Va a la papelera, recuperable desde Storage." : "Se borra de la base de datos, sin vuelta atrás."}
              </div>
              <div className="bento-seg" style={{ alignSelf: "flex-start" }}>
                <button type="button" data-active={deleteMode === "soft"}
                  onClick={() => { setDeleteMode("soft"); try { localStorage.setItem("futuraria-delete-mode", "soft"); } catch {} }}>Papelera</button>
                <button type="button" data-active={deleteMode === "hard"}
                  onClick={() => { setDeleteMode("hard"); try { localStorage.setItem("futuraria-delete-mode", "hard"); } catch {} }}>Permanente</button>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 11.5, color: "rgba(255,255,255,0.6)" }}>
                <input
                  type="checkbox" checked={deleteConfirmEnabled}
                  onChange={e => { setDeleteConfirmEnabled(e.target.checked); try { localStorage.setItem("futuraria-delete-confirm", String(e.target.checked)); } catch {} }}
                  style={{ accentColor: "#818cf8" }}
                />
                Pedir confirmación escribiendo el nombre
              </label>
            </div>

            {/* Miniaturas */}
            <div className="bento-card bento-5">
              <div className="bento-title">📸 Miniaturas</div>
              <div className="bento-sub">
                {snapshotProgress.running
                  ? `Capturando ${snapshotProgress.done}/${snapshotProgress.total}…`
                  : `${templates.filter(t => t.thumbnail).length} de ${templates.length} archivos tienen miniatura.`}
              </div>
              {snapshotProgress.running && (
                <div style={{ height: 4, borderRadius: 100, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 100, background: "linear-gradient(90deg,#818cf8,#a78bfa)", width: `${Math.round((snapshotProgress.done / snapshotProgress.total) * 100)}%`, transition: "width 0.3s ease" }} />
                </div>
              )}
              <button type="button" className="bento-btn bento-btn--primary" style={{ alignSelf: "flex-start" }}
                onClick={handleSnapshotAll} disabled={snapshotProgress.running}>
                {snapshotProgress.running ? "Capturando…" : "Capturar todas"}
              </button>
            </div>

            {/* Estado de conexión */}
            <div className="bento-card bento-7">
              <div className="bento-title">🔌 Estado del sistema</div>
              <div>
                <div className="bento-row">
                  <span className="bento-row-label">
                    🗄️ Datos · {dataConnected ? "Supabase" : dataMode === "unknown" ? "verificando" : "sólo memoria"}
                  </span>
                  <span className={`bento-pill ${dataConnected ? "bento-pill--ok" : dataMode === "unknown" ? "bento-pill--off" : "bento-pill--warn"}`}>
                    {dataConnected ? "Conectado" : dataMode === "unknown" ? "…" : "Sin persistir"}
                  </span>
                </div>
                <div className="bento-row">
                  <span className="bento-row-label">🔄 Colaboración en tiempo real</span>
                  <span className={`bento-pill ${storageHealth?.realtime ? "bento-pill--ok" : "bento-pill--off"}`}>
                    {storageHealth?.realtime ? "Activa" : "Inactiva"}
                  </span>
                </div>
                <div className="bento-row">
                  <span className="bento-row-label">🤖 API MCP · /mcp</span>
                  <span className="bento-pill bento-pill--ok">Activa</span>
                </div>
              </div>
            </div>

            {/* SKILL.md */}
            <div className="bento-card bento-12">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div className="bento-title">📄 SKILL.md — onboarding para agentes</div>
                  <div className="bento-sub" style={{ marginTop: 4 }}>
                    Dáselo a cualquier agente de IA: le enseña las herramientas de Futuraria, la
                    estructura del proyecto y las convenciones de diseño, para que diseñe junto a vos.
                  </div>
                </div>
                <button type="button" className="bento-btn bento-btn--primary" onClick={handleDownloadSkill}>Descargar</button>
              </div>
            </div>
          </div>
        </div>
        );
      })()}
        </WorkspaceConsole>
      )}

      {/* ── Graph Tab ── */}
      {activeTab === "contactos" && (
        <div data-tour="graph-view" style={{ flex: 1, overflow: "hidden", padding: 20 }}>
          <GraphTab
            workspaceId={activeWorkspaceId}
            pane={activePane}
            onPaneChange={setActivePane}
            onOpenTemplate={(id) => {
              onSelectTemplate(id);
            }}
          />
        </div>
      )}

      {activeTab === "workspace" && (
        <WorkspaceConsole
          mode="crm"
          workspaceId={activeWorkspaceId}
          workspaceName={workspaces.find(workspace => workspace.id === activeWorkspaceId)?.name}
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
                ? "It will be moved to Trash and recoverable from the Papelera sub-tab for 30 days."
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
          if (action === "tab-templates") setActiveTab("diseno");
          else if (action === "tab-graph") setActiveTab("contactos");
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
  background: "rgba(255, 255, 255, 0.03)",
  backdropFilter: "blur(4px)",
  WebkitBackdropFilter: "blur(4px)",
  border: "1px solid rgba(255, 255, 255, 0.1)",
  boxShadow: "inset 0 1px 1px rgba(255,255,255,0.08), 0 2px 10px rgba(0,0,0,0.35)",
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
