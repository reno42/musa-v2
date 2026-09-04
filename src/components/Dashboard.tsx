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
import { readAppRoute, workspaceTabUrl, isWorkspaceTab, DEFAULT_WORKSPACE_TAB, type WorkspaceTab,
  DEFAULT_DESIGN_PANE, isDesignPane, type DesignPane,
  DEFAULT_AGENT_PANE, isAgentPane, type AgentPane,
} from "../lib/appRoute";
import { getApiHeaders } from "../lib/apiKey";
import { OnboardingTour, isOnboardingEnabled, setOnboardingEnabled, restartOnboarding, type TourAction } from "./OnboardingTour";
import { CHAT_PROVIDERS, getProvider, NANO_BANANA_MODELS } from "../lib/aiProviders";
import { fetchKeyStatuses, saveProviderKey, deleteProviderKey, type KeyStatusMap } from "../lib/userKeys";
import { saveUserPrefs } from "../lib/userPrefs";
import { WorkspaceConsole } from "./WorkspaceConsole";
import { FontsUsageCard } from "./FontsUsageCard";
import { useAuth } from "../lib/auth";
import { browserSupabase } from "../lib/supabaseClient";
import { planOptions, type PlanId } from "../lib/ndaContent";
import { SOCIAL_FORMATS, CUSTOM_FORMAT_ID, EMPTY_FORMAT_ID, clampFrameDimension } from "../lib/socialFormats";

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

type SocialProvider = "buffer" | "zernio";
type SocialAccount = { id: string; platform: string; username: string; displayName: string; isActive: boolean };
type SocialConnection = { id: string; provider: SocialProvider; hasCredentials: boolean; accounts: Record<string, string>; isDefault: boolean; webhookUrl?: string | null };

interface DashboardProps {
  onSelectTemplate: (id: string, slugInfo?: { wsSlug?: string; tplSlug?: string }) => void;
  /** REQ-022: opts carries the first frame's dimensions, or initialFrame:false
   *  for a zero-frame file. Omitted opts keep the old 1080×1080 behavior. */
  onCreateHtmlTemplate: (
    workspaceId: string,
    name: string,
    opts?: { width?: number; height?: number; initialFrame?: boolean },
  ) => void;
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
  const [socialConnections, setSocialConnections] = useState<SocialConnection[]>([]);
  const [socialProvider, setSocialProvider] = useState<SocialProvider>("zernio");
  const [socialApiKey, setSocialApiKey] = useState("");
  const [socialWebhookSecret, setSocialWebhookSecret] = useState("");
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([]);
  const [socialSelected, setSocialSelected] = useState<Record<string, string>>({});
  const [socialBusy, setSocialBusy] = useState(false);
  const [socialMessage, setSocialMessage] = useState("");
  const [figmaConnected, setFigmaConnected] = useState(false);
  const [figmaAccount, setFigmaAccount] = useState<string>("");
  const [figmaToken, setFigmaToken] = useState("");
  const [figmaBusy, setFigmaBusy] = useState(false);
  const [figmaMessage, setFigmaMessage] = useState("");
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
  // REQ-022 — new-file popup: format preset, custom dimensions, or a zero-frame start.
  const [newTplFormat, setNewTplFormat] = useState(SOCIAL_FORMATS[0]?.id ?? CUSTOM_FORMAT_ID);
  const [newTplW, setNewTplW] = useState(String(SOCIAL_FORMATS[0]?.width ?? 1080));
  const [newTplH, setNewTplH] = useState(String(SOCIAL_FORMATS[0]?.height ?? 1080));
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
    if (!pending || !isWorkspaceTab(pending)) return;
    sessionStorage.removeItem("dashboardInitialTab");
    // A caller may also name the pane — "take me to the Papelera", not just
    // "take me to Diseño". Read before setActiveTab, which clears the pane.
    const pendingPane = sessionStorage.getItem("dashboardInitialPane");
    sessionStorage.removeItem("dashboardInitialPane");
    setActiveTab(pending);
    if (pendingPane) setActivePane(pendingPane);
  }, [setActiveTab, setActivePane]);
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
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [deleteSkipUntil, setDeleteSkipUntil] = useState(0);
  const deleteDialogRef = useRef<HTMLDivElement>(null);
  const deleteTriggerRef = useRef<HTMLElement | null>(null);
  const [actionDropdownId, setActionDropdownId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  // Sub-tabs inside Diseño and Agentes.
  // Read from the URL, written back to it: refreshing on the Grafo, the Tabla
  // or the Papelera must stay there. This lived in React state alone, which is
  // exactly the loss the pane segment exists to prevent.
  const designSubTab: DesignPane = activePane && isDesignPane(activePane) ? activePane : DEFAULT_DESIGN_PANE;
  const setDesignSubTab = useCallback((pane: DesignPane) => setActivePane(pane), [setActivePane]);
  // In the URL, like Diseño's: a refresh on the agents table or the roster
  // should not drop back to the Kanban.
  const agentSubTab: AgentPane = activePane && isAgentPane(activePane) ? activePane : DEFAULT_AGENT_PANE;
  const setAgentSubTab = useCallback((pane: AgentPane) => setActivePane(pane), [setActivePane]);
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

  // ── Team (Settings → Workspace card, absorbed from the old Equipo tab) ──
  interface TeamInvitation { id: string; email: string; role: string; status: string; workspaceName?: string; invitedBy?: string; }
  const [wsInvitations, setWsInvitations] = useState<TeamInvitation[]>([]);
  const [incomingInvites, setIncomingInvites] = useState<TeamInvitation[]>([]);
  const [teamEmail, setTeamEmail] = useState("");
  const [teamRole, setTeamRole] = useState("editor");
  const [teamMsg, setTeamMsg] = useState("");

  // ── Chat agent roles — server-persisted via user prefs (v36) so the
  // setup follows the account to any device. ChatFAB stays the quick
  // access; this card is the same data, one source of truth. ──
  const CHAT_ROLE_DEFAULTS: Record<string, { provider: string; model: string }> = {
    leader: { provider: "deepseek", model: "deepseek-v4-pro" },
    implementer: { provider: "deepseek", model: "deepseek-v4-pro" },
    reviewer: { provider: "deepseek", model: "deepseek-v4-pro" },
  };
  const [chatRoles, setChatRoles] = useState<Record<string, { provider: string; model: string }>>(CHAT_ROLE_DEFAULTS);
  const [chatRolesSaved, setChatRolesSaved] = useState<Record<string, { provider: string; model: string }>>(CHAT_ROLE_DEFAULTS);
  const [chatRolesMsg, setChatRolesMsg] = useState("");
  const chatRolesDirty = JSON.stringify(chatRoles) !== JSON.stringify(chatRolesSaved);
  // Default image-gen model — localStorage is the fast path the editor
  // reads; prefs mirrors it so a new device starts sensible.
  const [nbModel, setNbModel] = useState(() => {
    try { return localStorage.getItem("futuraria-nanobanana-model") || NANO_BANANA_MODELS[0].id; } catch { return NANO_BANANA_MODELS[0].id; }
  });

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
  // Read-only NDA/plan state — assigned on the wall, never editable here.
  const [accessPlan, setAccessPlan] = useState<PlanId>("friends_family");
  const [ndaAcceptedAt, setNdaAcceptedAt] = useState<string | null>(null);
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
      setAccessPlan(d.access_plan === "corporate" ? "corporate" : "friends_family");
      setNdaAcceptedAt(typeof d.nda_accepted_at === "string" ? d.nda_accepted_at : null);
      // prefs (v36) — non-secret preferences that follow the account.
      const prefs = d.prefs && typeof d.prefs === "object" && !Array.isArray(d.prefs) ? d.prefs as Record<string, any> : {};
      const roles = prefs.chatRoles && typeof prefs.chatRoles === "object"
        ? { ...CHAT_ROLE_DEFAULTS, ...(prefs.chatRoles as Record<string, any>) }
        : CHAT_ROLE_DEFAULTS;
      setChatRoles(roles);
      setChatRolesSaved(roles);
      try {
        if (typeof prefs.nanoBananaModel === "string" && prefs.nanoBananaModel && !localStorage.getItem("futuraria-nanobanana-model")) {
          localStorage.setItem("futuraria-nanobanana-model", prefs.nanoBananaModel);
          setNbModel(prefs.nanoBananaModel);
        }
      } catch { /* private mode */ }
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

  // ── Musa batch automation (Settings → Automatización) ──
  // The LLM key itself is NOT stored here: the batch resolves it per-user
  // via BYOK (Ajustes de IA → claves), falling back to BATCH_LLM_KEY.
  // No hour/timezone: the global tick (musa-batch-tick) dispatches the
  // musa-batch background function hourly and every enabled workspace is
  // processed on every run.
  const [autoConfig, setAutoConfig] = useState({
    enabled: false, maxItems: 50, tag: "auto", provider: "deepseek",
  });
  const [autoConfigSaving, setAutoConfigSaving] = useState(false);
  const [autoConfigMsg, setAutoConfigMsg] = useState("");
  // v27: every switch lives in Configuración (single place, per product rule) —
  // usage meter and platform switches join Automatización. (Kanban auto-refresh
  // was removed in REQ-024: the board never auto-refreshes anymore.)
  const [usageData, setUsageData] = useState<{ month: string; mcp_calls: number; items_generated: number; quota: number } | null>(null);
  const [platformStatus, setPlatformStatus] = useState<{ canManage: boolean; musa_tick_enabled: boolean; monthly_mcp_quota: number; env_musa_tick_enabled?: boolean; platform_usage?: { month: string; workspaces: number; mcp_calls: number; items_generated: number } | null; plan?: { netlify_monthly_invocations: number; cron_monthly_invocations: number; netlify_monthly_bandwidth_gb: number } } | null>(null);
  const [platformQuota, setPlatformQuota] = useState(5000);
  const [platformSaving, setPlatformSaving] = useState(false);
  const [platformMsg, setPlatformMsg] = useState("");

  // v28: proyección lineal a fin de mes (ritmo actual extrapolado, UTC) y
  // porcentaje acotado — alimentan el panel «Límites y consumo».
  const monthProjection = (month: string, used: number): number => {
    const [y, m] = month.split("-").map(Number);
    if (!y || !m) return used;
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const day = new Date().getUTCDate();
    return day > 0 ? Math.round((used / day) * days) : used;
  };
  const pct = (n: number, d: number): number => (d > 0 ? Math.min(999, Math.round((n / d) * 100)) : 0);

  const loadAutoConfig = useCallback(async (wsId?: string) => {
    const id = wsId ?? activeWorkspaceId;
    if (!id) return;
    try {
      const res = await mcpCall("task_queue_get_config", { workspaceId: id });
      const c = res?.config;
      if (c) {
        setAutoConfig({
          enabled: !!c.auto_process_enabled,
          maxItems: typeof c.auto_process_max_items === "number" ? c.auto_process_max_items : 50,
          tag: c.auto_process_tag || "auto",
          provider: c.batch_llm_provider || "deepseek",
        });
      }
      setUsageData(res?.usage ?? null);
    } catch { /* config not readable — keep defaults */ }
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (activeTab !== "configuracion") return;
    void loadAutoConfig();
    // Platform switches: only rendered when the caller can manage them.
    mcpCall("platform_get_status", {})
      .then((status: any) => {
        setPlatformStatus(status ?? null);
        if (status && typeof status.monthly_mcp_quota === "number") setPlatformQuota(status.monthly_mcp_quota);
      })
      .catch(() => setPlatformStatus(null));
  }, [activeTab, loadAutoConfig]);

  const handleSaveAutoConfig = async () => {
    if (!activeWorkspaceId) return;
    setAutoConfigSaving(true);
    setAutoConfigMsg("");
    try {
      const res = await mcpCall("task_queue_update_config", {
        workspaceId: activeWorkspaceId,
        autoProcessEnabled: autoConfig.enabled,
        autoProcessMaxItems: autoConfig.maxItems,
        autoProcessTag: autoConfig.tag,
        batchLlmProvider: autoConfig.provider,
      });
      if (!res?.success) throw new Error("Respuesta inesperada del servidor");
      setAutoConfigMsg("✓ Guardado");
      setTimeout(() => setAutoConfigMsg(""), 2500);
    } catch (e: any) {
      setAutoConfigMsg(e?.message || "No se pudo guardar");
    }
    setAutoConfigSaving(false);
  };

  const handleSavePlatform = async () => {
    if (!platformStatus) return;
    setPlatformSaving(true);
    setPlatformMsg("");
    try {
      const res = await mcpCall("platform_update_config", {
        musaTickEnabled: platformStatus.musa_tick_enabled,
        monthlyMcpQuota: platformQuota,
      });
      if (!res?.success) throw new Error("Respuesta inesperada del servidor");
      setPlatformMsg("✓ Guardado");
      setPlatformStatus(s => s ? { ...s, monthly_mcp_quota: platformQuota } : s);
      setTimeout(() => setPlatformMsg(""), 2500);
    } catch (e: any) {
      setPlatformMsg(e?.message || "No se pudo guardar");
    }
    setPlatformSaving(false);
  };

  // ── Server-side BYOK key management ──
  // Keys are encrypted server-side. The browser only knows whether a key
  // is configured and which model is selected — never the actual value.
  // Every provider (chat LLMs, image, video, layer split, photos) renders
  // through the same generic handlers below: one card per provider in the
  // Settings → Claves section, no duplicated key inputs anywhere else.
  const [keyStatuses, setKeyStatuses] = useState<KeyStatusMap>({});
  const [keySaving, setKeySaving] = useState(false);

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

  /** Save (or, with an empty value, delete) any provider's key. */
  const handleSaveProviderKey = async (providerId: string, value: string) => {
    const v = value.trim();
    setKeySaving(true);
    try {
      if (v) await saveProviderKey(providerId, v);
      else await deleteProviderKey(providerId);
      await refreshKeyStatuses();
      addToast(v ? "Clave guardada (cifrada en el servidor)." : "Clave eliminada.", v ? "success" : "info");
    } catch (err: any) {
      addToast(`Error: ${err.message}`, "error");
    }
    setKeySaving(false);
  };

  const loadSocialConnections = useCallback(async () => {
    if (!activeWorkspaceId) return;
    try {
      const res = await apiFetch<{ data?: SocialConnection[] }>(`/api/content/integrations/social?workspaceId=${encodeURIComponent(activeWorkspaceId)}`);
      const connections = res.data || [];
      setSocialConnections(connections);
      const current = connections.find(item => item.provider === socialProvider);
      setSocialSelected(current?.accounts || {});
    } catch { setSocialConnections([]); }
  }, [activeWorkspaceId, socialProvider]);

  useEffect(() => {
    if (activeTab === "configuracion") void loadSocialConnections();
  }, [activeTab, loadSocialConnections]);

  const loadFigmaConnection = useCallback(async () => {
    if (!activeWorkspaceId) return;
    try {
      const response = await apiFetch<{ data?: { connected?: boolean; account?: { handle?: string; id?: string } } }>(`/design-imports/integrations/figma?workspaceId=${encodeURIComponent(activeWorkspaceId)}`);
      setFigmaConnected(Boolean(response.data?.connected));
      setFigmaAccount(response.data?.account?.handle || response.data?.account?.id || "");
    } catch { setFigmaConnected(false); setFigmaAccount(""); }
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (activeTab === "configuracion") void loadFigmaConnection();
  }, [activeTab, loadFigmaConnection]);

  const saveFigmaConnection = async () => {
    if (!activeWorkspaceId || !figmaToken.trim()) return;
    setFigmaBusy(true); setFigmaMessage("");
    try {
      await apiFetch("/design-imports/integrations/figma", { method: "PUT", body: JSON.stringify({ workspaceId: activeWorkspaceId, apiToken: figmaToken.trim() }) });
      setFigmaToken("");
      setFigmaMessage("✓ Figma conectado; el token quedó cifrado para este workspace.");
      await loadFigmaConnection();
    } catch (error) { setFigmaMessage(error instanceof Error ? error.message : "No se pudo conectar Figma."); }
    finally { setFigmaBusy(false); }
  };

  const disconnectFigma = async () => {
    if (!activeWorkspaceId) return;
    setFigmaBusy(true); setFigmaMessage("");
    try {
      await apiFetch("/design-imports/integrations/figma", { method: "DELETE", body: JSON.stringify({ workspaceId: activeWorkspaceId }) });
      setFigmaConnected(false); setFigmaAccount(""); setFigmaToken("");
      setFigmaMessage("✓ Token de Figma eliminado de este workspace.");
    } catch (error) { setFigmaMessage(error instanceof Error ? error.message : "No se pudo desconectar Figma."); }
    finally { setFigmaBusy(false); }
  };

  useEffect(() => {
    const current = socialConnections.find(item => item.provider === socialProvider);
    setSocialSelected(current?.accounts || {});
    setSocialAccounts([]);
    setSocialApiKey("");
    setSocialWebhookSecret("");
    setSocialMessage("");
  }, [activeWorkspaceId, socialProvider, socialConnections]);

  const testSocialConnection = async () => {
    if (!activeWorkspaceId) return;
    setSocialBusy(true); setSocialMessage("");
    try {
      const res = await apiFetch<{ data?: { accounts?: SocialAccount[] } }>(`/api/content/integrations/social/${socialProvider}/test`, {
        method: "POST", body: JSON.stringify({ workspaceId: activeWorkspaceId, apiKey: socialApiKey.trim() }),
      });
      const accounts = res.data?.accounts || [];
      setSocialAccounts(accounts);
      setSocialMessage(accounts.length ? `✓ Conexión válida · ${accounts.length} ${accounts.length === 1 ? "cuenta" : "cuentas"}` : "✓ Conexión válida, sin cuentas conectadas");
    } catch (error) { setSocialMessage(error instanceof Error ? error.message : "No se pudo conectar"); }
    finally { setSocialBusy(false); }
  };

  const saveSocialConnection = async () => {
    if (!activeWorkspaceId) return;
    setSocialBusy(true); setSocialMessage("");
    try {
      await apiFetch(`/api/content/integrations/social/${socialProvider}`, {
        method: "PUT", body: JSON.stringify({
          workspaceId: activeWorkspaceId, apiKey: socialApiKey.trim(), webhookSecret: socialWebhookSecret.trim(),
          accounts: socialSelected, isDefault: true,
        }),
      });
      setSocialApiKey(""); setSocialWebhookSecret("");
      setSocialMessage("✓ Conexión guardada y cifrada para este workspace");
      await loadSocialConnections();
    } catch (error) { setSocialMessage(error instanceof Error ? error.message : "No se pudo guardar"); }
    finally { setSocialBusy(false); }
  };

  const disconnectSocialConnection = async () => {
    if (!activeWorkspaceId) return;
    setSocialBusy(true);
    setSocialMessage("");
    try {
      await apiFetch(`/api/content/integrations/social/${socialProvider}`, {
        method: "DELETE", body: JSON.stringify({ workspaceId: activeWorkspaceId }),
      });
      await loadSocialConnections();
      setSocialApiKey(""); setSocialWebhookSecret(""); setSocialAccounts([]); setSocialSelected({});
      setSocialMessage("✓ Credenciales eliminadas. Lo ya programado continúa en el proveedor; cancélalo allí si corresponde.");
    } catch (error) { setSocialMessage(error instanceof Error ? error.message : "No se pudo desconectar"); }
    finally { setSocialBusy(false); }
  };

  /** Model-only update — keeps the stored key untouched. */
  const handleProviderModel = async (providerId: string, model: string) => {
    try {
      await saveProviderKey(providerId, "", model);
      await refreshKeyStatuses();
    } catch { /* model save is best-effort */ }
  };

  const [sessions, setSessions] = useState<Array<{ key_label: string; client_info: string; user_agent: string; ip: string; first_seen: string; last_seen: string; request_count: number }>>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

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

  // ── Account: cambiar correo / contraseña (absorbed from AccountSection) ──
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountMsg, setAccountMsg] = useState("");

  const handleChangeEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!browserSupabase) return;
    setAccountBusy(true); setAccountMsg("");
    const { error } = await browserSupabase.auth.updateUser({ email: newEmail.trim() });
    if (error) setAccountMsg(error.message);
    else {
      setNewEmail("");
      setAccountMsg("✓ Revisa tu correo actual y el nuevo para confirmar el cambio.");
    }
    setAccountBusy(false);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!browserSupabase || !user?.email) return;
    if (newPassword !== passwordConfirmation) { setAccountMsg("Las contraseñas nuevas no coinciden."); return; }
    setAccountBusy(true); setAccountMsg("");
    const { error: signInError } = await browserSupabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
    if (signInError) {
      setAccountMsg("La contraseña actual no es correcta.");
      setAccountBusy(false);
      return;
    }
    const { error } = await browserSupabase.auth.updateUser({ password: newPassword });
    if (error) setAccountMsg(error.message);
    else {
      setCurrentPassword(""); setNewPassword(""); setPasswordConfirmation("");
      setAccountMsg("✓ Contraseña actualizada.");
    }
    setAccountBusy(false);
  };

  // ── Invitaciones: recibidas (cuenta) y emitidas (workspace, tarjeta Equipo) ──
  const loadIncomingInvites = useCallback(async () => {
    try {
      const res = await apiFetch<{ data?: TeamInvitation[] }>("/account/invitations");
      setIncomingInvites(res?.data || []);
    } catch { setIncomingInvites([]); }
  }, []);

  const loadInvitations = useCallback(async () => {
    if (!activeWorkspaceId) return;
    try {
      const res = await apiFetch<{ data?: TeamInvitation[] }>(`/workspaces/${activeWorkspaceId}/invitations`);
      setWsInvitations(res?.data || []);
    } catch { setWsInvitations([]); }
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (activeTab !== "configuracion") return;
    void loadIncomingInvites();
    void loadInvitations();
  }, [activeTab, loadIncomingInvites, loadInvitations]);

  const respondIncoming = async (inv: TeamInvitation, decision: "accept" | "decline") => {
    try {
      await apiFetch(`/account/invitations/${inv.id}/${decision}`, { method: "POST", body: "{}" });
      if (decision === "accept") { window.location.replace("/#workspace"); return; }
      setTeamMsg(`✓ Invitación a ${inv.workspaceName || "workspace"} rechazada`);
      void loadIncomingInvites();
    } catch (err: any) { setTeamMsg(err?.message || "No se pudo responder la invitación"); }
  };

  // ── Equipo: invitar, roles y revocar — solo owner/admin (same as the old Equipo tab) ──
  const canManageTeam = (() => {
    const r = members.find(m => m.id === user?.id)?.role;
    return r === "owner" || r === "admin";
  })();

  const inviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWorkspaceId) return;
    setTeamMsg("");
    try {
      const res = await apiFetch<any>(`/workspaces/${activeWorkspaceId}/invitations`, {
        method: "POST", body: JSON.stringify({ email: teamEmail, role: teamRole }),
      });
      const link: string | undefined = res?.data?.inviteLink;
      if (link && navigator.clipboard) { try { await navigator.clipboard.writeText(link); } catch { /* portapapeles bloqueado */ } }
      setTeamEmail("");
      setTeamMsg(res?.data?.emailSent ? "✓ Invitación enviada por correo" : "✓ Invitación creada — enlace copiado al portapapeles");
      await loadMembers(activeWorkspaceId);
      void loadInvitations();
    } catch (err: any) { setTeamMsg(err?.message || "No se pudo invitar"); }
  };

  const resendInvitation = async (inv: TeamInvitation) => {
    if (!activeWorkspaceId) return;
    setTeamMsg("");
    try {
      const res = await apiFetch<any>(`/workspaces/${activeWorkspaceId}/invitations/${inv.id}/resend`, { method: "POST", body: "{}" });
      const link: string | undefined = res?.data?.inviteLink;
      if (link && navigator.clipboard) { try { await navigator.clipboard.writeText(link); } catch { /* portapapeles bloqueado */ } }
      setTeamMsg(res?.data?.emailSent ? `✓ Reenviada a ${inv.email}` : "✓ Invitación renovada — enlace copiado");
      void loadInvitations();
    } catch (err: any) { setTeamMsg(err?.message || "No se pudo reenviar"); }
  };

  const revokeInvitation = async (inv: TeamInvitation) => {
    if (!activeWorkspaceId) return;
    setTeamMsg("");
    try {
      await apiFetch(`/workspaces/${activeWorkspaceId}/invitations/${inv.id}`, { method: "DELETE" });
      setTeamMsg(`✓ Invitación a ${inv.email} revocada`);
      void loadInvitations();
    } catch (err: any) { setTeamMsg(err?.message || "No se pudo revocar"); }
  };

  const updateMemberRole = async (userId: string, role: string) => {
    if (!activeWorkspaceId) return;
    try {
      await apiFetch(`/workspaces/${activeWorkspaceId}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) });
      await loadMembers(activeWorkspaceId);
    } catch (err: any) { setTeamMsg(err?.message || "No se pudo cambiar el rol"); }
  };

  const removeMember = async (m: { id: string; email?: string; display_name?: string }) => {
    if (!activeWorkspaceId) return;
    setTeamMsg("");
    try {
      await apiFetch(`/workspaces/${activeWorkspaceId}/members/${m.id}`, { method: "DELETE" });
      setTeamMsg("✓ Acceso quitado");
      await loadMembers(activeWorkspaceId);
    } catch (err: any) { setTeamMsg(err?.message || "No se pudo quitar"); }
  };

  // ── Roles de agentes del chat + modelo de imagen por defecto (prefs v36) ──
  const handleSaveChatRoles = async () => {
    setChatRolesMsg("");
    try {
      await saveUserPrefs({ chatRoles });
      setChatRolesSaved(chatRoles);
      setChatRolesMsg("✓ Guardado — te sigue a cualquier dispositivo");
    } catch (e: any) {
      setChatRolesMsg(e?.message?.includes("PROFILE_MIGRATION_REQUIRED") || e?.message?.includes("409")
        ? "Falta correr supabase_migrations_v36.sql (prefs) en Supabase."
        : (e?.message || "No se pudo guardar"));
    }
    setTimeout(() => setChatRolesMsg(""), 3500);
  };

  const handleNbModelChange = (model: string) => {
    setNbModel(model);
    try { localStorage.setItem("futuraria-nanobanana-model", model); } catch { /* modo privado */ }
    saveUserPrefs({ nanoBananaModel: model }).catch(() => { /* best-effort */ });
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
    deleteTriggerRef.current = document.getElementById(`template-actions-${id}`);
    setDeleteTarget({ id, name });
    setDeleteConfirmed(false);
  };

  const closeDeleteDialog = () => {
    setDeleteTarget(null);
    setDeleteConfirmed(false);
    requestAnimationFrame(() => deleteTriggerRef.current?.focus());
  };

  const executeDelete = () => {
    if (!deleteTarget || !deleteConfirmed) return;
    handleDelete(deleteTarget.id);
    closeDeleteDialog();
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

  const handleCreateWithName = () => {
    if (!activeWorkspaceId) return;
    const name = newTplName.trim() || "Untitled";
    const opts = newTplFormat === EMPTY_FORMAT_ID
      ? { initialFrame: false }
      : { width: clampFrameDimension(newTplW), height: clampFrameDimension(newTplH) };
    setCreatingTpl(false);
    setNewTplName("");
    onCreateHtmlTemplate(activeWorkspaceId, name, opts);
  };

  const resetNewTplForm = useCallback(() => {
    setNewTplFormat(SOCIAL_FORMATS[0]?.id ?? CUSTOM_FORMAT_ID);
    setNewTplW(String(SOCIAL_FORMATS[0]?.width ?? 1080));
    setNewTplH(String(SOCIAL_FORMATS[0]?.height ?? 1080));
    setNewTplName("");
  }, []);

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
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>Edited {new Date(t.metadata.updatedAt).toLocaleDateString()}</div>
        {/* Date + actions share one line so the meta block stays inside the
            viewport at any height — no scroll needed to reach the menu. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <div style={{ position: "relative", display: "inline-block" }}>
          <button
            id={`template-actions-${t.id}`}
            type="button"
            onClick={e => { e.stopPropagation(); setActionDropdownId(actionDropdownId === t.id ? null : t.id); }}
            style={{ background: "rgba(8,10,16,0.88)", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 6, padding: "4px 12px", color: "rgba(255,255,255,0.92)", fontSize: 12, fontWeight: 700, letterSpacing: 2, minWidth: 28, cursor: "pointer", fontFamily: "inherit" }}
            title="Acciones (duplicar, eliminar, info)"
            aria-label={`Acciones de ${t.name}`}
          >
            ···
          </button>
          {actionDropdownId === t.id && (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={e => { e.stopPropagation(); setActionDropdownId(null); }} />
              <div style={{
                position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%)",
                minWidth: 130, borderRadius: 10, padding: 4, zIndex: 100, marginBottom: 4,
                display: "flex", flexDirection: "column",
                background: "rgba(10,12,18,0.97)", border: "1px solid rgba(255,255,255,0.14)",
                boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
              }}>
                <button type="button" onClick={e => { e.stopPropagation(); handleDuplicate(t.id); setActionDropdownId(null); }} style={ddItemStyle}>📋 Duplicate</button>
                <button type="button" onClick={e => { e.stopPropagation(); confirmDelete(t.id, t.name); setActionDropdownId(null); }} style={{ ...ddItemStyle, color: "#f87171" }}>🗑 Delete</button>
                <button type="button" onClick={e => { e.stopPropagation(); onSelectTemplate(t.id, { wsSlug: wsSlugMap.get(t.workspaceId), tplSlug: t.slug }); setActionDropdownId(null); }} style={ddItemStyle}>ℹ️ Info</button>
              </div>
            </>
          )}
        </div>
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



    /* ── GRID MODE: original layout with frosted info panel inside card.
       `layout` makes reorders (a freshly saved file jumping to position 1)
       glide instead of teleporting, so the click target stays trackable
       while the list re-sorts after the background refresh. */
    return (
    <motion.div
      key={t.id}
      layout="position"
      transition={{ layout: { type: "spring", stiffness: 420, damping: 36 } }}
      className="dash-card"
      style={{ ...cardStyle }}
      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "rgba(255,255,255,0.2)"; el.style.boxShadow = "inset 0 1px 1px rgba(255,255,255,0.1), 0 16px 32px rgba(0,0,0,0.5)"; el.style.transform = "translateY(-4px)"; }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "rgba(255,255,255,0.1)"; el.style.boxShadow = "inset 0 1px 1px rgba(255,255,255,0.08), 0 2px 10px rgba(0,0,0,0.35)"; el.style.transform = ""; }}
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
      {/* Actions float in the top-right corner, above the cover */}
      <div className="dash-card-actions" style={{ position: "absolute", top: 8, right: 8, zIndex: 4 }}>
        <div style={{ position: "relative", display: "inline-block" }}>
          <button
            id={`template-actions-${t.id}`}
            type="button"
            onClick={e => { e.stopPropagation(); setActionDropdownId(actionDropdownId === t.id ? null : t.id); }}
            style={{ background: "rgba(8,10,16,0.88)", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 6, padding: "3px 10px", color: "rgba(255,255,255,0.92)", fontSize: 13, fontWeight: 700, letterSpacing: 2, lineHeight: 1.2, flex: "none", cursor: "pointer", fontFamily: "inherit" }}
            title="Acciones (duplicar, eliminar, info)"
            aria-label={`Acciones de ${t.name}`}
          >
            ···
          </button>
          {actionDropdownId === t.id && (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={e => { e.stopPropagation(); setActionDropdownId(null); }} />
              {/* Solid dark panel — liquid-glass over light covers left the
                  white menu text on a whitish surface. Opens downward from
                  the top-right anchor (the card clips nothing: it fits). */}
              <div style={{
                position: "absolute", top: "100%", right: 0,
                minWidth: 130, borderRadius: 10, padding: 4, zIndex: 100, marginTop: 4,
                display: "flex", flexDirection: "column",
                background: "rgba(10,12,18,0.97)", border: "1px solid rgba(255,255,255,0.14)",
                boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
              }}>
                <button type="button" onClick={e => { e.stopPropagation(); handleDuplicate(t.id); setActionDropdownId(null); }} style={ddItemStyle}>📋 Duplicate</button>
                <button type="button" onClick={e => { e.stopPropagation(); confirmDelete(t.id, t.name); setActionDropdownId(null); }} style={{ ...ddItemStyle, color: "#f87171" }}>🗑 Delete</button>
                <button type="button" onClick={e => { e.stopPropagation(); onSelectTemplate(t.id, { wsSlug: wsSlugMap.get(t.workspaceId), tplSlug: t.slug }); setActionDropdownId(null); }} style={ddItemStyle}>ℹ️ Info</button>
              </div>
            </>
          )}
        </div>
      </div>
    </motion.div>
    );
  };

  // v49.2 — Plan A (usabilidad): prefers-reduced-motion pausa el video; queda
  // como una foto difusa en vez de movimiento que compite con el contenido.
  const bgVideoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = bgVideoRef.current;
    if (!video) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      if (mq.matches) { video.pause(); } else { video.play().catch(() => {}); }
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      style={dashboardStyle}
      className="dash-atmosphere"
    >
      {/* ── Background video ── */}
      {/* v49.2/v49.5 — el desenfoque vive AQUÍ (filter sobre el video), no en
          un panel intermedio: un backdrop-filter en el panel formaría un
          "backdrop root" y las cards dejarían de muestrear el fondo real.
          contrast(0.78) aplana los picos de brillo del video — sin reflejo
          blanco central bajo la tabla — mientras brightness/saturate dejan
          ver la animación ligeramente en vez de un fondo negro plano.
          scale(1.12) esconde el halo transparente que blur deja en los bordes. */}
      <video
        ref={bgVideoRef}
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
          filter: "blur(26px) brightness(0.78) contrast(0.78) saturate(1.12)",
          transform: "scale(1.12)",
        }}
      />

      {/* Dark depth overlay — prevents bg video from competing with content */}
      <div
        style={{
          position: "absolute", inset: 0, zIndex: 1,
          /* v49.5 — velo más ligero: la animación se deja ver suave; el
             contraste del contenido lo garantizan el video aplanado
             (contrast 0.78) y el velo propio del panel CRM. */
          background: "linear-gradient(180deg, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0.26) 40%, rgba(0,0,0,0.34) 70%, rgba(0,0,0,0.52) 100%)",
          pointerEvents: "none",
        }}
      />

      {/* Header — matches landing navbar: brand left, tabs+dropdown centered, search right */}
      <div className="dash-header" style={dashHeaderStyle}>
        <div className="landing-nav-inner" style={{ maxWidth: 1200, width: "100%", position: "relative" }}>
          {/* Brand — identical to landing: "Musa by Futuraria" wordmark, no icon */}
          <div className="landing-brand" style={{ flexShrink: 0 }}>
            <span>Musa <span style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", opacity: 0.55, fontWeight: 500 }}>by Futuraria</span></span>
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
        // Flow mode: flex column so the cover stage sizes itself to the height
        // that actually remains after the filter bar — no overflow, no scroll.
        display: cardMode === "flow" ? "flex" : undefined,
        flexDirection: "column",
      }}>
        {/* ── Filter bar: brand dropdown · date range · zoom slider ── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12, marginBottom: 18,
          flexWrap: "wrap", padding: "0 0 10px 0", borderBottom: "1px solid rgba(255,255,255,0.04)",
          flexShrink: 0,
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

          {/* Date range — hidden for now per product call. State and the
              grid filtering logic stay intact; flip this condition to bring
              the inputs straight back. */}
          {false && (
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
          )}

          <div style={{ flex: 1 }} />

          {/* Perennial create (v27): this button is always here. The old
              "+ New Template" only lived inside the empty state, so once you
              had files there was NO human way to create another one. */}
          {/* REQ-022 — the inline name-only input became a popup: it asks for
              the first frame's format (social presets, custom, or zero frames)
              so the file is born with the right size instead of a surprise
              1080×1080 that the user must delete. Rendered as a fixed overlay;
              position in the tree is irrelevant. */}
          {creatingTpl && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Nuevo archivo de diseño"
              onKeyDown={e => { if (e.key === "Escape") { setCreatingTpl(false); resetNewTplForm(); } }}
              onClick={() => { setCreatingTpl(false); resetNewTplForm(); }}
              style={{
                position: "fixed", inset: 0, zIndex: 1000,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(5,7,12,0.66)", backdropFilter: "blur(6px)",
                fontFamily: "inherit",
              }}
            >
              <div
                onClick={e => e.stopPropagation()}
                style={{
                  width: "min(430px, calc(100vw - 48px))",
                  borderRadius: 16, padding: "22px 24px",
                  background: "rgba(15,18,28,0.98)",
                  border: "1px solid rgba(99,102,241,0.35)",
                  boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
                }}
              >
                <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 4 }}>Nuevo archivo</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", marginBottom: 16 }}>
                  Elige el formato del primer frame. Podrás agregar o borrar frames después, incluso dejar el archivo vacío.
                </div>

                <label style={{ display: "block", fontSize: 11, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                  Nombre
                </label>
                <input
                  ref={newTplInputRef}
                  value={newTplName}
                  onChange={e => setNewTplName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleCreateWithName(); }}
                  placeholder="Nombre del archivo… (Enter para crear)"
                  aria-label="Nombre del nuevo archivo"
                  autoFocus
                  style={{
                    width: "100%", boxSizing: "border-box", marginBottom: 14,
                    padding: "8px 12px", borderRadius: 8, fontSize: 13,
                    background: "rgba(9,11,18,0.95)", border: "1px solid rgba(99,102,241,0.5)",
                    color: "rgba(255,255,255,0.9)", fontFamily: "inherit", outline: "none",
                  }}
                />

                <label style={{ display: "block", fontSize: 11, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                  Formato del primer frame
                </label>
                <select
                  value={newTplFormat}
                  onChange={e => {
                    const id = e.target.value;
                    const preset = SOCIAL_FORMATS.find(f => f.id === id);
                    setNewTplFormat(id);
                    if (preset) {
                      setNewTplW(String(preset.width));
                      setNewTplH(String(preset.height));
                    }
                  }}
                  aria-label="Formato del primer frame"
                  style={{
                    width: "100%", boxSizing: "border-box", marginBottom: 14,
                    padding: "8px 12px", borderRadius: 8, fontSize: 13, cursor: "pointer",
                    background: "rgba(9,11,18,0.95)", border: "1px solid rgba(99,102,241,0.5)",
                    color: "rgba(255,255,255,0.9)", fontFamily: "inherit", outline: "none",
                  }}
                >
                  {SOCIAL_FORMATS.map(f => (
                    <option key={f.id} value={f.id}>{f.label} — {f.width}×{f.height}</option>
                  ))}
                  <option value={CUSTOM_FORMAT_ID}>Personalizado…</option>
                  <option value={EMPTY_FORMAT_ID}>Empezar en blanco (sin frames)</option>
                </select>

                {newTplFormat !== EMPTY_FORMAT_ID && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
                    <input
                      type="number" min={1} max={10000}
                      value={newTplW}
                      onChange={e => {
                        setNewTplW(e.target.value);
                        if (newTplFormat !== CUSTOM_FORMAT_ID) setNewTplFormat(CUSTOM_FORMAT_ID);
                      }}
                      aria-label="Ancho del primer frame en píxeles"
                      style={{
                        width: 90, padding: "8px 10px", borderRadius: 8, fontSize: 13,
                        background: "rgba(9,11,18,0.95)", border: "1px solid rgba(99,102,241,0.5)",
                        color: "rgba(255,255,255,0.9)", fontFamily: "inherit", outline: "none",
                      }}
                    />
                    <span aria-hidden="true" style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>×</span>
                    <input
                      type="number" min={1} max={10000}
                      value={newTplH}
                      onChange={e => {
                        setNewTplH(e.target.value);
                        if (newTplFormat !== CUSTOM_FORMAT_ID) setNewTplFormat(CUSTOM_FORMAT_ID);
                      }}
                      aria-label="Alto del primer frame en píxeles"
                      style={{
                        width: 90, padding: "8px 10px", borderRadius: 8, fontSize: 13,
                        background: "rgba(9,11,18,0.95)", border: "1px solid rgba(99,102,241,0.5)",
                        color: "rgba(255,255,255,0.9)", fontFamily: "inherit", outline: "none",
                      }}
                    />
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginLeft: 4 }}>px</span>
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" onClick={() => { setCreatingTpl(false); resetNewTplForm(); }}
                    style={{
                      padding: "8px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer",
                      background: "transparent", border: "1px solid rgba(255,255,255,0.12)",
                      color: "rgba(255,255,255,0.55)", fontFamily: "inherit", whiteSpace: "nowrap",
                    }}>
                    Cancelar
                  </button>
                  <button type="button" onClick={handleCreateWithName}
                    style={{
                      padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                      background: "rgba(99,102,241,0.35)", border: "1px solid rgba(99,102,241,0.6)",
                      color: "#fff", fontFamily: "inherit", whiteSpace: "nowrap",
                    }}>
                    Crear archivo
                  </button>
                </div>
              </div>
            </div>
          )}
          <button type="button" onClick={() => { resetNewTplForm(); setCreatingTpl(true); }}
            title="Crear un nuevo archivo de diseño"
            style={{
              display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
              padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
              background: "rgba(99,102,241,0.22)", border: "1px solid rgba(99,102,241,0.5)",
              color: "#fff", fontFamily: "inherit",
            }}>
            <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>+</span> Nuevo archivo
          </button>

          {/* Viewer switch — lives here now (same state and persistence as
              Configuración → Preferencias → Vista de archivos). */}
          <div role="group" aria-label="Modo de vista de archivos" style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,255,255,0.12)", flexShrink: 0 }}>
            <button type="button" onClick={() => handleCardModeChange("grid")} title="Tarjetas en cuadrícula"
              style={{ padding: "5px 12px", fontSize: 11, cursor: "pointer", fontFamily: "inherit", border: "none",
                background: cardMode === "grid" ? "rgba(99,102,241,0.35)" : "transparent",
                color: cardMode === "grid" ? "#fff" : "rgba(255,255,255,0.5)",
                fontWeight: cardMode === "grid" ? 600 : 400, transition: "all 0.15s" }}>
              Cuadrícula
            </button>
            <button type="button" onClick={() => handleCardModeChange("flow")} title="Visor iPod (Cover Flow)"
              style={{ padding: "5px 12px", fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                borderLeft: "1px solid rgba(255,255,255,0.12)",
                background: cardMode === "flow" ? "rgba(99,102,241,0.35)" : "transparent",
                color: cardMode === "flow" ? "#fff" : "rgba(255,255,255,0.5)",
                fontWeight: cardMode === "flow" ? 600 : 400, transition: "all 0.15s" }}>
              Flow
            </button>
          </div>

          {/* Column slider — only meaningful in the grid: CoverFlow has no
              rows, so the control disappears with it. */}
          {cardMode === "grid" && (
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
          )}
        </div>

        {loading ? (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", padding: 60 }}>Loading…</div>
        ) : templates.length === 0 ? (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}><IconFile size={40} color="rgba(255,255,255,0.3)" /></div>
            <div>No templates yet. Create your first one!</div>
            <button
              type="button"
              onClick={() => {
                // Opens the same named-create row in the filter bar above —
                // no more instant "Untitled" files from the empty state.
                setCreatingTpl(true);
                setTimeout(() => newTplInputRef.current?.focus(), 50);
              }}
              style={{ ...btnPrimary, marginTop: 16 }}
            >
              + New Template
            </button>
          </div>
        ) : cardMode === "flow" ? (
          <div style={{ position: "relative", display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
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
              flexible
            />
            {templates[Math.min(flowIndex, templates.length - 1)] && (
              <div style={{ width: 300, margin: "8px auto 4px", textAlign: "center", flexShrink: 0 }}>
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
        <ContentTab workspaceId={activeWorkspaceId} paneHint={activePane} onOpenTemplate={(id) => window.open(`/?template=${id}&v=2`, "_blank")} onOpenSettings={() => setActiveTab("configuracion")} />
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
                <div className="dash-card-actions" style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 3, display: "flex", gap: 4, justifyContent: "center", borderTop: "1px solid rgba(255, 255, 255, 0.02)", fontSize: 12, padding: "4px 0" }}>
                  <button type="button" onClick={e => { e.stopPropagation(); handleCreateFromRecipe(r.id, r.name); }} style={{ background: "rgba(8,10,16,0.88)", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 6, padding: "3px 12px", color: "rgba(255,255,255,0.92)", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
                    Crear
                  </button>
                  <button type="button" onClick={e => { e.stopPropagation(); handleDeleteRecipe(r.id); }} className="dash-card-action-danger" style={{ background: "rgba(8,10,16,0.88)", border: "1px solid rgba(248,113,113,0.35)", borderRadius: 6, padding: "3px 12px", color: "#f87171", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* ── Settings Tab ── */}
      {/* v53: los contenidos se reparten en slots — Mi cuenta (perfil +
          preferencias + uso), Invita humanos (workspace/equipo) y Mis
          integraciones (claves de IA). Invita IAs vive en el console. */}
      {activeTab === "configuracion" && (() => {
        const totalFrames = templates.reduce((sum, t) => sum + (t.frames?.length || 0), 0);
        const estimatedTokens = (templates.length * 2000) + (totalFrames * 500) + (recipes.length * 100);
        // Honest indicators: data persistence comes from the server (SUPABASE_URL/SERVICE_KEY),
        // realtime comes from browser-side VITE_* vars. Previous check only looked at VITE_*.
        const dataConnected = storageHealth?.supabase ?? false;
        const dataMode = storageHealth?.mode ?? "unknown";

        return (
        <WorkspaceConsole
          mode="settings"
          workspaceId={activeWorkspaceId}
          workspaceName={workspaces.find(workspace => workspace.id === activeWorkspaceId)?.name}
          account={(
            <>
          {/* ═══════════ 1 · TU CUENTA ═══════════ */}
          <h3 className="bento-section-title">👤 Tu cuenta</h3>
          <p style={{ margin: "-14px 0 14px", fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
            Tus datos personales y tu acceso. Te siguen a ti, no al workspace.
          </p>
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

            {/* Correo y contraseña — absorbed from the old AccountSection */}
            <div className="bento-card bento-6">
              <div className="bento-title">🔒 Correo y contraseña</div>
              <div className="bento-sub">Tu sesión y tu acceso. El correo se confirma desde tu bandeja.</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
                <form className="workspace-form-row" onSubmit={handleChangeEmail} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <div className="bento-field" style={{ flex: 1, minWidth: 150 }}>
                    <label htmlFor="acc-email">Cambiar correo</label>
                    <input id="acc-email" type="email" autoComplete="email" className="bento-input"
                      value={newEmail} onChange={e => setNewEmail(e.target.value)} required />
                  </div>
                  <button type="submit" className="bento-btn" disabled={accountBusy || !browserSupabase}>Solicitar cambio</button>
                </form>
                <form onSubmit={handleChangePassword} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <div className="bento-field" style={{ flex: 1, minWidth: 130 }}>
                    <label htmlFor="acc-cur">Contraseña actual</label>
                    <input id="acc-cur" type="password" autoComplete="current-password" className="bento-input"
                      value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required />
                  </div>
                  <div className="bento-field" style={{ flex: 1, minWidth: 130 }}>
                    <label htmlFor="acc-new">Nueva</label>
                    <input id="acc-new" type="password" minLength={10} autoComplete="new-password" className="bento-input"
                      value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
                  </div>
                  <div className="bento-field" style={{ flex: 1, minWidth: 130 }}>
                    <label htmlFor="acc-conf">Confirmar</label>
                    <input id="acc-conf" type="password" minLength={10} autoComplete="new-password" className="bento-input"
                      value={passwordConfirmation} onChange={e => setPasswordConfirmation(e.target.value)} required />
                  </div>
                  <button type="submit" className="bento-btn" disabled={accountBusy || !browserSupabase}>Actualizar</button>
                </form>
              </div>
              <div className="bento-sub" style={{ marginTop: 6, minHeight: 14 }}>
                {accountMsg.startsWith("✓") ?
                  <span style={{ color: "#4ade80" }}>{accountMsg}</span>
                  : <span style={{ color: "#facc15" }}>{accountMsg}</span>}
              </div>
            </div>

            {/* Plan de acceso — asignado al aceptar el Acuerdo Alfa, no editable */}
            <div className="bento-card bento-6">
              <div className="bento-title">🎟 Plan de acceso</div>
              <div className="bento-row" style={{ alignItems: "center" }}>
                <span className="bento-row-label">Plan</span>
                <span className="bento-pill bento-pill--ok">
                  {planOptions.find(o => o.value === accessPlan)?.label}
                </span>
              </div>
              <div className="bento-sub">{planOptions.find(o => o.value === accessPlan)?.detail}</div>
              <div className="bento-row">
                <span className="bento-row-label">Acuerdo Alfa</span>
                <span className="bento-row-value">
                  {ndaAcceptedAt ? `Aceptado · ${new Date(ndaAcceptedAt).toLocaleDateString()}` : "Pendiente"}
                </span>
              </div>
              <div className="bento-sub" style={{ fontSize: 10.5, opacity: 0.75 }}>
                Se asignó al aceptar el Acuerdo de Acceso Alfa. Solo Futuraria puede cambiarlo.
              </div>
            </div>

            {/* Invitaciones recibidas — absorbed from the old AccountSection.
                v53.1: ocultada de la UI a pedido del usuario; la lógica queda
                intacta (la data sigue cargando) — quitá el guard `false &&`
                para volver a mostrarla. */}
            {false && (
            <div className="bento-card bento-6">
              <div className="bento-title">📬 Invitaciones recibidas</div>
              {incomingInvites.length === 0 ? (
                <div className="bento-sub">No tienes invitaciones pendientes.</div>
              ) : (
                <div>
                  {incomingInvites.map(inv => (
                    <div key={inv.id} className="bento-row">
                      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                        <span className="bento-row-value">{inv.workspaceName || "Workspace"}</span>
                        <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)" }}>
                          {inv.invitedBy ? `${inv.invitedBy} · ` : ""}acceso {inv.role}
                        </span>
                      </span>
                      <span style={{ display: "flex", gap: 5 }}>
                        <button type="button" className="bento-btn" onClick={() => void respondIncoming(inv, "accept")}>Aceptar</button>
                        <button type="button" className="bento-btn bento-btn--danger" onClick={() => void respondIncoming(inv, "decline")}>Rechazar</button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {teamMsg && (
                <div className="bento-sub" style={{ color: teamMsg.startsWith("✓") ? "#4ade80" : "#facc15" }}>{teamMsg}</div>
              )}
            </div>
            )}

            {/* Dispositivos / sesiones — v53.1: ocultada (funcionalidad intacta). */}
            {false && (
            <div className="bento-card bento-6">
              <div className="bento-title">💻 Dispositivos y sesiones</div>
              {sessionsLoading ? (
                <div className="bento-sub">Cargando…</div>
              ) : sessions.length === 0 ? (
                <div className="bento-sub">
                  Todavía no hay registro de sesiones. Aparecen aquí cuando un cliente MCP o un
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
            )}

          </div>

          {/* ═══════════ 4 · PREFERENCIAS ═══════════ */}
          <h3 className="bento-section-title">⚙️ Preferencias</h3>
          <p style={{ margin: "-14px 0 14px", fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
            Cómo se comporta Futuraria en este navegador.
          </p>
          <div className="bento-grid">

            {/* Vista — v53.1: ocultada (funcionalidad intacta). */}
            {false && (
            <div className="bento-card bento-6">
              <div className="bento-title">🎴 Vista de archivos</div>
              <div className="bento-sub">
                {cardMode === "grid" ? "Cuadrícula" : "Cover Flow (slider en perspectiva)"} · {cardColumns} por fila
              </div>
              <div className="bento-seg" style={{ alignSelf: "flex-start" }}>
                <button type="button" data-active={cardMode === "grid"} onClick={() => handleCardModeChange("grid")}>Cuadrícula</button>
                <button type="button" data-active={cardMode === "flow"} onClick={() => handleCardModeChange("flow")}>Flow</button>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "rgba(255,255,255,0.6)" }}>
                Columnas
                <input type="range" min={2} max={6} value={cardColumns}
                  onChange={e => handleColumnsChange(Number(e.target.value))}
                  style={{ flex: 1, accentColor: "#818cf8" }} />
                <span style={{ minWidth: 14, textAlign: "right" }}>{cardColumns}</span>
              </label>
            </div>
            )}

            {/* Tour */}
            <div className="bento-card bento-6">
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
                Pedir confirmación antes de borrar
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

          </div>

          {/* ═══════════ 5 · USO Y ESTADO ═══════════ */}
          <h3 className="bento-section-title">📊 Uso y estado</h3>
          <p style={{ margin: "-14px 0 14px", fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
            Cuota del espacio, automatización de Musa y salud de la plataforma.
          </p>
          <div className="bento-grid">

            {/* Límites y consumo — contador v28 (tu espacio + plan de la plataforma) */}
            <div className="bento-card bento-7">
              <div className="bento-title">📊 Límites y consumo</div>
              {usageData ? (
                <>
                  <div className="bento-sub">
                    Tu espacio en {usageData.month} · cuota {usageData.quota === 0 ? "∞ (sin límite)" : `${usageData.quota.toLocaleString()}/mes`}
                    {usageData.quota > 0 && ` · a este ritmo cerrás el mes en ≈ ${monthProjection(usageData.month, usageData.mcp_calls).toLocaleString()} (${pct(monthProjection(usageData.month, usageData.mcp_calls), usageData.quota)}%)`}
                  </div>
                  <div style={{ height: 8, borderRadius: 100, background: "rgba(255,255,255,0.06)", overflow: "hidden", margin: "10px 0 8px" }}>
                    <div style={{
                      width: `${usageData.quota === 0 ? 4 : Math.min(100, (usageData.mcp_calls / usageData.quota) * 100)}%`,
                      height: "100%", borderRadius: 100,
                      background: usageData.quota > 0 && usageData.mcp_calls / usageData.quota > 0.85
                        ? "#f87171"
                        : usageData.quota > 0 && usageData.mcp_calls / usageData.quota > 0.6 ? "#fbbf24" : "#6366f1",
                      transition: "width 0.3s ease",
                    }} />
                  </div>
                  <div className="bento-row">
                    <span className="bento-row-label">Llamadas MCP (tu espacio)</span>
                    <span className="bento-row-value">
                      {usageData.mcp_calls.toLocaleString()}{usageData.quota > 0 ? ` / ${usageData.quota.toLocaleString()}` : ""}
                    </span>
                  </div>
                  <div className="bento-row">
                    <span className="bento-row-label">Items generados</span>
                    <span className="bento-row-value">{(usageData.items_generated || 0).toLocaleString()}</span>
                  </div>
                </>
              ) : (
                <div className="bento-sub">
                  Contador no disponible. Corré <code>supabase_migrations_v27.sql</code> en Supabase
                  para activar la telemetría de uso y la cuota mensual.
                </div>
              )}
            </div>

            {/* Automatización — Musa Daily Batch · v53.1: ocultada (funcionalidad intacta). */}
            {false && (
            <div className="bento-card bento-5">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div className="bento-title">🤖 Automatización</div>
                {autoConfigMsg && (
                  <span style={{ fontSize: 11, color: autoConfigMsg.startsWith("✓") ? "#4ade80" : "#facc15", textAlign: "right", maxWidth: 240 }}>
                    {autoConfigMsg}
                  </span>
                )}
              </div>
              <div className="bento-sub">
                Musa procesa tu Kanban de diseño cada hora (batch automático) y on demand desde el tablero Kanban.
                Usa tu API key de IA (Ajustes de IA → claves), sin guardar keys aquí.
              </div>
              <div className="bento-row" style={{ alignItems: "center" }}>
                <span className="bento-row-label">Procesar la cola</span>
                <div className="bento-seg">
                  <button type="button" data-active={!autoConfig.enabled}
                    onClick={() => setAutoConfig(c => ({ ...c, enabled: false }))}>Apagado</button>
                  <button type="button" data-active={autoConfig.enabled}
                    onClick={() => setAutoConfig(c => ({ ...c, enabled: true }))}>Activado</button>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginTop: 10 }}>
                <div className="bento-field">
                  <label htmlFor="auto-max">Máx. diseños por corrida</label>
                  <input id="auto-max" type="number" min={1} max={200} className="bento-input" value={autoConfig.maxItems}
                    onChange={e => setAutoConfig(c => ({ ...c, maxItems: Math.max(1, Number(e.target.value) || 1) }))} />
                </div>
                <div className="bento-field">
                  <label htmlFor="auto-provider">Proveedor LLM</label>
                  <select id="auto-provider" className="bento-input" value={autoConfig.provider}
                    onChange={e => setAutoConfig(c => ({ ...c, provider: e.target.value }))}>
                    <option value="deepseek">DeepSeek</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                  </select>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                <button type="button" className="bento-btn bento-btn--primary"
                  onClick={handleSaveAutoConfig} disabled={autoConfigSaving}>
                  {autoConfigSaving ? "Guardando…" : "Guardar automatización"}
                </button>
              </div>
            </div>
            )}

            {/* Fuentes personalizadas — uso contra límites del plan */}
            <FontsUsageCard />

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

            {/* Plataforma — switches globales, solo dueños (v27) · v53.1:
                ocultada de la UI (funcionalidad intacta) — el guard `false &&`
                la apaga sin borrar el bloque. El cast a boolean mantiene la
                narrowed de platformStatus viva para tsc. */}
            {(false as boolean) && platformStatus?.canManage && (
              <div className="bento-card bento-5">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div className="bento-title">🛠️ Plataforma</div>
                  {platformMsg && (
                    <span style={{ fontSize: 11, color: platformMsg.startsWith("✓") ? "4ade80" : "#facc15", textAlign: "right", maxWidth: 240 }}>
                      {platformMsg}
                    </span>
                  )}
                </div>
                <div className="bento-sub">
                  Switches globales (todas las cuentas). El batch horario de Musa se puede
                  apagar aquí; el env var MUSA_TICK_ENABLED=false{" "}
                  {platformStatus.env_musa_tick_enabled === false ? "está ACTIVO y gana sobre este switch." : "(si se activa) gana sobre este switch."}
                </div>
                <div className="bento-row" style={{ alignItems: "center" }}>
                  <span className="bento-row-label">Batch horario (Musa)</span>
                  <div className="bento-seg">
                    <button type="button" data-active={!platformStatus.musa_tick_enabled}
                      onClick={() => setPlatformStatus(s => s ? { ...s, musa_tick_enabled: false } : s)}>Apagado</button>
                    <button type="button" data-active={platformStatus.musa_tick_enabled}
                      onClick={() => setPlatformStatus(s => s ? { ...s, musa_tick_enabled: true } : s)}>Activado</button>
                  </div>
                </div>
                <div className="bento-field" style={{ marginTop: 10 }}>
                  <label htmlFor="plat-quota">Cuota mensual MCP por workspace (0 = sin límite)</label>
                  <input id="plat-quota" type="number" min={0} max={1000000} className="bento-input"
                    value={platformQuota}
                    onChange={e => setPlatformQuota(Math.max(0, Number(e.target.value) || 0))} />
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                  <button type="button" className="bento-btn bento-btn--primary"
                    onClick={handleSavePlatform} disabled={platformSaving}>
                    {platformSaving ? "Guardando…" : "Guardar plataforma"}
                  </button>
                </div>
              </div>
            )}
          </div>
            </>
          )}
          inviteHumans={(
            <>
          {/* ═══════════ 2 · WORKSPACE ═══════════ */}
          <h3 className="bento-section-title">🏢 Workspace</h3>
          <p style={{ margin: "-14px 0 14px", fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
            El espacio de trabajo activo: qué contiene y quién puede entrar.
          </p>
          <div className="bento-grid">

            {/* Espacio de trabajo — stats del workspace activo */}
            <div className="bento-card bento-6">
              <div className="bento-title">🗂 Espacio de trabajo</div>
              <div className="bento-row">
                <span className="bento-row-label">Archivos</span>
                <span className="bento-row-value">{templates.length}</span>
              </div>
              <div className="bento-row">
                <span className="bento-row-label">Frames</span>
                <span className="bento-row-value">{totalFrames}</span>
              </div>
              <div className="bento-row">
                <span className="bento-row-label">Recetas</span>
                <span className="bento-row-value">{recipes.length}</span>
              </div>
              <div className="bento-row">
                <span className="bento-row-label">Tokens estimados del grafo</span>
                <span className="bento-row-value">≈ {estimatedTokens.toLocaleString()}</span>
              </div>
              <div className="bento-sub">Lo que ven tus invitados depende del rol que les diste abajo.</div>
            </div>

            {/* Equipo — absorbed from the old Equipo tab */}
            <div className="bento-card bento-6">
              <div className="bento-title">👥 Equipo</div>
              {canManageTeam && (
                <form onSubmit={inviteMember} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
                  <div className="bento-field" style={{ flex: 1, minWidth: 150 }}>
                    <label htmlFor="team-email">Invitar por correo</label>
                    <input id="team-email" type="email" autoComplete="email" className="bento-input"
                      value={teamEmail} onChange={e => setTeamEmail(e.target.value)} placeholder="persona@estudio.com" required />
                  </div>
                  <div className="bento-field" style={{ minWidth: 110 }}>
                    <label htmlFor="team-role">Rol</label>
                    <select id="team-role" className="bento-input" value={teamRole} onChange={e => setTeamRole(e.target.value)}>
                      <option value="admin">Admin</option>
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </div>
                  <button type="submit" className="bento-btn bento-btn--primary">Invitar</button>
                </form>
              )}
              {members.length === 0 ? (
                <div className="bento-sub">Todavía no hay miembros en este workspace.</div>
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
                      {m.role === "owner" || !canManageTeam ? (
                        <span className={`bento-pill ${m.role === "owner" ? "bento-pill--ok" : "bento-pill--off"}`}>
                          {m.role || "member"}
                        </span>
                      ) : (
                        <span style={{ display: "flex", gap: 5, alignItems: "center" }}>
                          <select className="bento-input" style={{ padding: "3px 8px", fontSize: 11, cursor: "pointer" }}
                            aria-label={`Rol de ${m.display_name || m.email}`} value={m.role || "viewer"}
                            onChange={e => void updateMemberRole(m.id, e.target.value)}>
                            <option value="admin">admin</option>
                            <option value="editor">editor</option>
                            <option value="viewer">viewer</option>
                          </select>
                          <button type="button" className="bento-btn bento-btn--danger" onClick={() => void removeMember(m)}>Quitar</button>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {canManageTeam && (
                <div style={{ marginTop: 10 }}>
                  <div className="bento-row-label" style={{ marginBottom: 6 }}>Invitaciones pendientes</div>
                  {wsInvitations.length === 0 ? (
                    <div className="bento-sub">No hay invitaciones pendientes.</div>
                  ) : (
                    <div>
                      {wsInvitations.map(inv => (
                        <div key={inv.id} className="bento-row">
                          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                            <span className="bento-row-value">{inv.email}</span>
                            <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)" }}>{inv.role} · {inv.status}</span>
                          </span>
                          {inv.status === "pending" && (
                            <span style={{ display: "flex", gap: 5 }}>
                              <button type="button" className="bento-btn" onClick={() => void resendInvitation(inv)}>Reenviar</button>
                              <button type="button" className="bento-btn bento-btn--danger" onClick={() => void revokeInvitation(inv)}>Revocar</button>
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {teamMsg && (
                <div className="bento-sub" style={{ color: teamMsg.startsWith("✓") ? "#4ade80" : "#facc15" }}>{teamMsg}</div>
              )}
            </div>
          </div>
            </>
          )}
          integrations={(
            <>
          {/* ═══════════ 3 · CLAVES DE IA Y CONEXIONES ═══════════ */}
          <h3 className="bento-section-title">🔑 Claves de IA y conexiones</h3>
          <p style={{ margin: "-14px 0 14px", fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
            Una sola caja fuerte: todas tus claves van cifradas al servidor y se usan en el editor, el chat y los iconos. Nunca se vuelven a mostrar.
          </p>
          <div className="bento-grid">

            <div className="bento-card bento-12">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div className="bento-title">📣 Publicación social</div>
                <span className={`bento-pill ${socialConnections.some(item => item.provider === socialProvider && item.hasCredentials) ? "bento-pill--ok" : "bento-pill--warn"}`}>
                  {socialConnections.some(item => item.provider === socialProvider && item.hasCredentials) ? "Conectado" : "Sin conectar"}
                </span>
              </div>
              <div className="bento-sub">
                La clave pertenece solo a este workspace, se cifra en el servidor y nunca vuelve al navegador. El proveedor predeterminado se usa en Calendario y Contenidos.
              </div>
              <div className="bento-seg" style={{ alignSelf: "flex-start" }} aria-label="Proveedor de publicación">
                <button type="button" disabled={socialBusy} data-active={socialProvider === "zernio"} onClick={() => setSocialProvider("zernio")}>Zernio</button>
                <button type="button" disabled={socialBusy} data-active={socialProvider === "buffer"} onClick={() => setSocialProvider("buffer")}>Buffer</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                <div className="bento-field">
                  <label htmlFor="social-api-key">API key de {socialProvider === "zernio" ? "Zernio" : "Buffer"}</label>
                  <input id="social-api-key" type="password" autoComplete="off" className="bento-input" value={socialApiKey}
                    onChange={event => setSocialApiKey(event.target.value)}
                    placeholder={socialConnections.some(item => item.provider === socialProvider && item.hasCredentials) ? "Guardada · escribe para reemplazar" : "Pega tu API key"} />
                </div>
                {socialProvider === "zernio" && (
                  <div className="bento-field">
                    <label htmlFor="social-webhook-secret">Secreto del webhook</label>
                    <input id="social-webhook-secret" type="password" autoComplete="off" className="bento-input" value={socialWebhookSecret}
                      onChange={event => setSocialWebhookSecret(event.target.value)} placeholder="Opcional para estados en tiempo real" />
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" className="bento-btn" onClick={() => void testSocialConnection()} disabled={socialBusy || (!socialApiKey.trim() && !socialConnections.some(item => item.provider === socialProvider && item.hasCredentials))}>
                  {socialBusy ? "Probando…" : "Probar y listar cuentas"}
                </button>
                <button type="button" className="bento-btn bento-btn--primary" onClick={() => void saveSocialConnection()} disabled={socialBusy || (!socialApiKey.trim() && !socialConnections.some(item => item.provider === socialProvider && item.hasCredentials))}>
                  Guardar como predeterminado
                </button>
              </div>
              {socialMessage && <div role="status" className="bento-sub" style={{ color: socialMessage.startsWith("✓") ? "#4ade80" : "#fca5a5" }}>{socialMessage}</div>}
              {socialConnections.some(item => item.provider === socialProvider && item.hasCredentials) && (
                <details className="bento-sub">
                  <summary>Desconectar {socialProvider === "zernio" ? "Zernio" : "Buffer"}</summary>
                  <p>Se eliminará la clave de este workspace. Las publicaciones ya programadas no se cancelan; gestiónalas en el proveedor. Puedes volver a conectar tu cuenta.</p>
                  <button type="button" className="bento-btn" disabled={socialBusy} onClick={() => void disconnectSocialConnection()}>Confirmar desconexión</button>
                </details>
              )}
              {socialAccounts.length > 0 && (
                <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="bento-row-label" style={{ marginBottom: 6 }}>Cuentas que podrá usar Copywriting</legend>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 6 }}>
                    {socialAccounts.map(account => (
                      <label key={account.id} className="bento-row" style={{ justifyContent: "flex-start", gap: 8, cursor: "pointer" }}>
                        <input type="checkbox" checked={socialSelected[account.platform] === account.id}
                          onChange={event => setSocialSelected(current => {
                            const next = { ...current };
                            if (event.target.checked) next[account.platform] = account.id;
                            else if (next[account.platform] === account.id) delete next[account.platform];
                            return next;
                          })} />
                        <span><strong>{account.displayName}</strong><br /><span className="bento-sub">{account.platform} {account.username}</span></span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              {socialProvider === "zernio" && socialConnections.find(item => item.provider === "zernio")?.webhookUrl && (
                <div className="bento-sub">Webhook: <code>{window.location.origin}{socialConnections.find(item => item.provider === "zernio")?.webhookUrl}</code></div>
              )}
              <div className="bento-sub">
                {socialProvider === "zernio" ? "Zernio permite Posts, Stories y Reels según la red y el medio adjunto." : "Buffer usa su API GraphQL para Posts; Stories y Reels requieren Zernio."}
              </div>
            </div>

            <div className="bento-card bento-12">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div className="bento-title">🎨 Importar desde Figma</div>
                <span className={`bento-pill ${figmaConnected ? "bento-pill--ok" : "bento-pill--warn"}`}>{figmaConnected ? "Conectado" : "Sin conectar"}</span>
              </div>
              <div className="bento-sub">Conecta el token personal de este workspace una sola vez. Después basta pegar un enlace de archivo o frame en Importar diseño. La clave se cifra y nunca vuelve al navegador.</div>
              {figmaAccount && <div className="bento-row-value">Cuenta: {figmaAccount}</div>}
              <div className="bento-field">
                <label htmlFor="figma-personal-token">Token personal de Figma</label>
                <input id="figma-personal-token" type="password" autoComplete="off" className="bento-input" value={figmaToken} onChange={event => setFigmaToken(event.target.value)} placeholder={figmaConnected ? "Guardado · escribe para reemplazar" : "Pega tu token de Figma"} aria-describedby="figma-token-help" />
                <span id="figma-token-help" className="bento-sub">Necesita permiso de lectura de archivos. Futuraria sólo lo usa para los enlaces que importes.</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" className="bento-btn bento-btn--primary" onClick={() => void saveFigmaConnection()} disabled={figmaBusy || !figmaToken.trim()}>{figmaBusy ? "Verificando…" : figmaConnected ? "Reemplazar conexión" : "Conectar Figma"}</button>
                {figmaConnected && <button type="button" className="bento-btn" onClick={() => void disconnectFigma()} disabled={figmaBusy}>Desconectar</button>}
              </div>
              {figmaMessage && <div role="status" className="bento-sub" style={{ color: figmaMessage.startsWith("✓") ? "#4ade80" : "#fca5a5" }}>{figmaMessage}</div>}
            </div>

            {/* Chat — una fila por proveedor */}
            <div className="bento-card bento-7">
              <div className="bento-title">💬 Chat de IA</div>
              <div className="bento-sub">
                El chat (🤖) usa la clave del proveedor que tengas configurada. Con varias configuradas,
                cada agente elige modelo distinto en la tarjeta «Roles». Gemini también aparece abajo con sus usos de editor.
              </div>
              {CHAT_PROVIDERS.map(p => (
                <ProviderKeyRow key={p.id} providerId={p.id} label={p.label} statuses={keyStatuses} saving={keySaving}
                  onSave={handleSaveProviderKey} />
              ))}
            </div>

            {/* Roles de los agentes — prefs v36, sigue tu cuenta */}
            <div className="bento-card bento-5">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div className="bento-title">🎭 Roles de los agentes</div>
                {chatRolesMsg && (
                  <span style={{ fontSize: 11, color: chatRolesMsg.startsWith("✓") ? "#4ade80" : "#facc15", textAlign: "right", maxWidth: 200 }}>
                    {chatRolesMsg}
                  </span>
                )}
              </div>
              <div className="bento-sub">
                Qué modelo usa cada agente del chat. Se guarda en tu cuenta, no en este navegador.
              </div>
              {(["leader", "implementer", "reviewer"] as const).map(role => {
                const chosen = chatRoles[role] || CHAT_ROLE_DEFAULTS[role];
                const models = getProvider(chosen.provider)?.models || [];
                return (
                  <div key={role} style={{ display: "grid", gridTemplateColumns: "86px 1fr 1fr", gap: 6, alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.7)" }}>
                      {role === "leader" ? "Líder" : role === "implementer" ? "Hacedor" : "Revisor"}
                    </span>
                    <select className="bento-input" style={{ cursor: "pointer" }} value={chosen.provider}
                      onChange={e => setChatRoles(r => ({ ...r, [role]: { provider: e.target.value, model: getProvider(e.target.value)?.models[0] || "" } }))}>
                      {CHAT_PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                    <select className="bento-input" style={{ cursor: "pointer" }} value={chosen.model}
                      onChange={e => setChatRoles(r => ({ ...r, [role]: { ...chosen, model: e.target.value } }))}>
                      {models.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                );
              })}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="button" className="bento-btn bento-btn--primary"
                  onClick={handleSaveChatRoles} disabled={!chatRolesDirty}>
                  {chatRolesDirty ? "Guardar roles" : "Guardado"}
                </button>
              </div>
            </div>

            {/* Gemini — imagen a diseño + nano banana + chat con visión */}
            <div className="bento-card bento-6">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div className="bento-title">🧠 Google Gemini</div>
                <span className={`bento-pill ${keyStatuses.google?.configured ? "bento-pill--ok" : "bento-pill--warn"}`}>
                  {keyStatuses.google?.configured ? "Configurada" : "Falta"}
                </span>
              </div>
              <div className="bento-sub">
                La usan <strong>🪄 Convertir imagen a diseño</strong>, la generación 🍌 y el chat con visión.
                No sirve una key de DeepSeek/OpenAI aquí.
              </div>
              <ProviderKeyRow providerId="google" statuses={keyStatuses} saving={keySaving} onSave={handleSaveProviderKey} />
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", whiteSpace: "nowrap" }}>Modelo visión</span>
                <select className="bento-input" style={{ flex: 1, cursor: "pointer" }}
                  value={keyStatuses.google?.model || getProvider("google")!.models[0]}
                  onChange={e => void handleProviderModel("google", e.target.value)}>
                  {getProvider("google")!.models.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", whiteSpace: "nowrap" }}>Modelo 🍌 por defecto</span>
                <select className="bento-input" style={{ flex: 1, cursor: "pointer" }}
                  value={nbModel} onChange={e => handleNbModelChange(e.target.value)}>
                  {NANO_BANANA_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 11, color: "#818cf8", textDecoration: "none" }}>Obtener key gratis ↗</a>
            </div>

            {/* Quiver — vectorización SVG */}
            <div className="bento-card bento-6">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div className="bento-title">✦ Quiver AI</div>
                <span className={`bento-pill ${keyStatuses.quiver?.configured ? "bento-pill--ok" : "bento-pill--warn"}`}>
                  {keyStatuses.quiver?.configured ? "Configurada" : "Falta"}
                </span>
              </div>
              <div className="bento-sub">
                Vectoriza imagen a SVG y genera SVG desde texto (pestaña IA del panel de iconos).
              </div>
              <ProviderKeyRow providerId="quiver" statuses={keyStatuses} saving={keySaving} onSave={handleSaveProviderKey} />
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", whiteSpace: "nowrap" }}>Modelo</span>
                <select className="bento-input" style={{ flex: 1, cursor: "pointer" }}
                  value={keyStatuses.quiver?.model || getProvider("quiver")!.models[0]}
                  onChange={e => void handleProviderModel("quiver", e.target.value)}>
                  {getProvider("quiver")!.models.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <a href="https://quiver.ai" target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 11, color: "#818cf8", textDecoration: "none" }}>Obtener key ↗</a>
            </div>

            {/* Runway — imagen a video */}
            <div className="bento-card bento-6">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div className="bento-title">🎬 Video (RunwayML)</div>
                <span className={`bento-pill ${keyStatuses.runway?.configured ? "bento-pill--ok" : "bento-pill--warn"}`}>
                  {keyStatuses.runway?.configured ? "Configurada" : "Falta"}
                </span>
              </div>
              <div className="bento-sub">Genera video a partir de una imagen en el panel Video del editor.</div>
              <ProviderKeyRow providerId="runway" statuses={keyStatuses} saving={keySaving} onSave={handleSaveProviderKey} />
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", whiteSpace: "nowrap" }}>Modelo</span>
                <select className="bento-input" style={{ flex: 1, cursor: "pointer" }}
                  value={keyStatuses.runway?.model || getProvider("runway")!.models[0]}
                  onChange={e => void handleProviderModel("runway", e.target.value)}>
                  {getProvider("runway")!.models.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <a href="https://runwayml.com" target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 11, color: "#818cf8", textDecoration: "none" }}>Obtener key ↗</a>
            </div>

            {/* WaveSpeed — separación de capas */}
            <div className="bento-card bento-6">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div className="bento-title">🧅 Capas (WaveSpeedAI)</div>
                <span className={`bento-pill ${keyStatuses.wavespeed?.configured ? "bento-pill--ok" : "bento-pill--warn"}`}>
                  {keyStatuses.wavespeed?.configured ? "Configurada" : "Falta"}
                </span>
              </div>
              <div className="bento-sub">Separa una imagen en capas editables con 🧅 en el editor.</div>
              <ProviderKeyRow providerId="wavespeed" statuses={keyStatuses} saving={keySaving} onSave={handleSaveProviderKey} />
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", whiteSpace: "nowrap" }}>Modelo</span>
                <select className="bento-input" style={{ flex: 1, cursor: "pointer" }}
                  value={keyStatuses.wavespeed?.model || getProvider("wavespeed")!.models[0]}
                  onChange={e => void handleProviderModel("wavespeed", e.target.value)}>
                  {getProvider("wavespeed")!.models.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>

            {/* Unsplash — fotos de stock */}
            <div className="bento-card bento-6">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div className="bento-title">🖼 Fotos (Unsplash)</div>
                <span className={`bento-pill ${keyStatuses.unsplash?.configured ? "bento-pill--ok" : "bento-pill--warn"}`}>
                  {keyStatuses.unsplash?.configured ? "Configurada" : "Falta"}
                </span>
              </div>
              <div className="bento-sub">
                Fotos de stock en el panel de iconos (pestaña Fotos). Antes vivía en este navegador;
                ahora viaja cifrada con el resto y te sigue a cualquier dispositivo.
              </div>
              <ProviderKeyRow providerId="unsplash" statuses={keyStatuses} saving={keySaving} onSave={handleSaveProviderKey} />
              <a href="https://unsplash.com/developers" target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 11, color: "#818cf8", textDecoration: "none" }}>Obtener key gratis ↗</a>
            </div>

            {/* Dónde se usa cada clave — nota de orientación */}
            <div className="bento-card bento-12 bento-card--accent">
              <div className="bento-title">🧭 ¿Qué hace cada clave?</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
                <div className="bento-sub">
                  <strong style={{ color: "rgba(255,255,255,0.8)" }}>Chat y roles</strong><br />
                  El chat usa la clave del proveedor configurado; en «Roles» eliges modelo por agente.
                </div>
                <div className="bento-sub">
                  <strong style={{ color: "rgba(255,255,255,0.8)" }}>Editor</strong><br />
                  🪄 imagen a diseño y 🍌 usan Gemini; vectorizar usa Quiver; 🎬 video usa Runway; 🧅 capas usa WaveSpeed.
                </div>
                <div className="bento-sub">
                  <strong style={{ color: "rgba(255,255,255,0.8)" }}>Iconos</strong><br />
                  La pestaña Fotos busca en Unsplash; la pestaña IA vectoriza con Quiver.
                </div>
                <div className="bento-sub">
                  <strong style={{ color: "rgba(255,255,255,0.8)" }}>Agentes MCP</strong><br />
                  Los clientes MCP se conectan a <code style={{ fontSize: 10.5 }}>/mcp</code> con tu sesión.
                  Claves de agentes y SKILL.md viven en la pestaña «Invita IAs».
                </div>
              </div>
            </div>
          </div>

            </>
          )}
        />
        );
      })()}

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
        <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }} onClick={closeDeleteDialog}>
          <div
            ref={deleteDialogRef}
            className="liquid-glass"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-template-title"
            aria-describedby="delete-template-description"
            style={{ maxWidth: 420, width: "90%", borderRadius: 16, padding: 28 }}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => {
              if (e.key === "Escape") {
                closeDeleteDialog();
                return;
              }
              if (e.key !== "Tab") return;
              const controls = deleteDialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])");
              if (!controls?.length) return;
              const first = controls[0];
              const last = controls[controls.length - 1];
              if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
              }
            }}
          >
            <h3 id="delete-template-title" style={{ fontSize: 16, fontWeight: 600, margin: "0 0 8px", color: "#f87171" }}>Eliminar archivo</h3>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", margin: "0 0 4px", lineHeight: 1.5 }}>
              Estás a punto de eliminar <em>{deleteTarget.name}</em>.
            </p>
            <p id="delete-template-description" style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: "0 0 16px" }}>
              {deleteMode === "soft"
                ? "Se moverá a la Papelera y podrás recuperarlo durante 30 días."
                : "Esta acción no se puede deshacer. El archivo se eliminará definitivamente de la base de datos."}
            </p>

            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "rgba(255,255,255,0.65)", marginBottom: 16, cursor: "pointer" }}>
              <input
                type="checkbox"
                autoFocus
                checked={deleteConfirmed}
                onChange={e => setDeleteConfirmed(e.target.checked)}
                style={{ accentColor: "#dc2626", marginTop: 2 }}
              />
              Entiendo y quiero eliminar este archivo
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 16, cursor: "pointer" }}>
              <input
                type="checkbox"
                onChange={e => {
                  if (e.target.checked) setDeleteSkipUntil(Date.now() + 5 * 60 * 1000);
                  else setDeleteSkipUntil(0);
                }}
                style={{ accentColor: "#818cf8" }}
              />
              No mostrar esta confirmación durante los próximos 5 minutos
            </label>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={closeDeleteDialog}
                className="liquid-glass"
                style={{ borderRadius: 100, padding: "8px 20px", fontSize: 12, fontWeight: 500, border: "none", cursor: "pointer", color: "rgba(255,255,255,0.6)", background: "rgba(255,255,255,0.03)" }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={executeDelete}
                disabled={!deleteConfirmed}
                style={{
                  borderRadius: 100, padding: "8px 20px", fontSize: 12, fontWeight: 600, border: "none", cursor: deleteConfirmed ? "pointer" : "not-allowed",
                  color: "#fff", background: deleteConfirmed ? "#dc2626" : "rgba(220,38,38,0.3)",
                  transition: "all 0.2s ease",
                }}
              >
                Eliminar
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

/**
 * One password input row for a BYOK provider (Dashboard settings).
 * The browser never sees the stored value — only whether it is configured.
 * Saving with an empty value deletes the key.
 */
function ProviderKeyRow({ providerId, label, statuses, saving, onSave }: {
  providerId: string;
  label?: string;
  statuses: KeyStatusMap;
  saving: boolean;
  onSave: (providerId: string, value: string) => void;
}) {
  const provider = getProvider(providerId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  if (!provider) return null;
  const configured = !!statuses[providerId]?.configured;
  const showInput = editing || !configured;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
      {label && (
        <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.7)", minWidth: 96 }}>
          {label}
        </span>
      )}
      <span className={`bento-pill ${configured ? "bento-pill--ok" : "bento-pill--warn"}`} style={{ flexShrink: 0 }}>
        {configured ? "Configurada" : "Falta"}
      </span>
      {showInput ? (
        <>
          <input
            type="password" className="bento-input" style={{ flex: 1, minWidth: 140 }}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && draft.trim()) { onSave(providerId, draft); setEditing(false); setDraft(""); }
              if (e.key === "Escape") { setEditing(false); setDraft(""); }
            }}
            placeholder={provider.keyPrefix ? `${provider.keyPrefix}…` : "Pega tu key…"}
          />
          <button type="button" className="bento-btn bento-btn--primary"
            onClick={() => { onSave(providerId, draft); setEditing(false); setDraft(""); }}
            disabled={!draft.trim() || saving}>Guardar</button>
          {configured && (
            <button type="button" className="bento-btn"
              onClick={() => { setEditing(false); setDraft(""); }}>Cancelar</button>
          )}
        </>
      ) : (
        <>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>🔒 Cifrada en el servidor</span>
          <button type="button" className="bento-btn" onClick={() => setEditing(true)}>Cambiar</button>
          <button type="button" className="bento-btn bento-btn--danger" onClick={() => onSave(providerId, "")}>Borrar</button>
        </>
      )}
    </div>
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
  borderRadius: "0 0 10px 10px", padding: "8px 12px",
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
  color: "rgba(255,255,255,0.88)",
  cursor: "pointer", textAlign: "left" as const,
  fontFamily: "inherit", fontWeight: 400,
  transition: "all 0.15s ease",
};
