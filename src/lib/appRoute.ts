/** Dashboard tabs that can appear in the URL as `#workspace/<tab>`.
 *  Keeping the tab in the URL (rather than in React state alone) is what
 *  makes a refresh land back on the same tab, and makes a tab linkable. */
export const WORKSPACE_TABS = [
  "diseno", "agentes", "copywriting", "recipes", "configuracion", "contactos", "workspace",
] as const;
export type WorkspaceTab = typeof WORKSPACE_TABS[number];

/** "diseno" is the default, so it's the one tab left out of the URL. */
export const DEFAULT_WORKSPACE_TAB: WorkspaceTab = "diseno";

export function isWorkspaceTab(value: string): value is WorkspaceTab {
  return (WORKSPACE_TABS as readonly string[]).includes(value);
}

/**
 * Panes inside the Red de Marcas tab: the four CRM views (Ventas kanban,
 * Personas table, Marcas accounts, Embudo funnel). These lived in React state
 * alone, so a refresh on the table or the CRM dropped back to the graph — and,
 * once the tab itself was lost, all the way back to Archivos. A pane is a
 * place the user navigated to; it belongs in the URL like any other.
 */
export const GRAPH_PANES = ["pipeline", "personas", "accounts", "embudo"] as const;
export type GraphPane = typeof GRAPH_PANES[number];
export const DEFAULT_GRAPH_PANE: GraphPane = "pipeline";

/**
 * Sub-tabs of Diseño. They were React state alone, so a refresh on the graph,
 * the table or the Papelera dropped back to Archivos — the same loss the pane
 * in the URL was introduced to stop, reappearing when the tabs were
 * restructured. Any pane is accepted in the URL; each tab validates its own.
 * "ds" is the Design Systems tab: one card per CRM brand with its container
 * (DS + Plantillas + Comunicación) — the only home of brand container files.
 */
export const DESIGN_PANES = ["files", "ds", "graph", "table", "trash"] as const;
export type DesignPane = typeof DESIGN_PANES[number];
export const DEFAULT_DESIGN_PANE: DesignPane = "files";

export function isDesignPane(value: string): value is DesignPane {
  return (DESIGN_PANES as readonly string[]).includes(value);
}

/** Sub-tabs of Agentes, in the URL for the same reason as Diseño's. */
export const AGENT_PANES = ["kanban", "table", "agents"] as const;
export type AgentPane = typeof AGENT_PANES[number];
export const DEFAULT_AGENT_PANE: AgentPane = "kanban";

export function isAgentPane(value: string): value is AgentPane {
  return (AGENT_PANES as readonly string[]).includes(value);
}

/** Sub-tabs of Copywriting, in the URL for the same reason as Diseño's: a
 *  refresh on the Bandeja dropped back to the Calendario. */
export const COPY_PANES = ["calendar", "sheet", "reports", "copies", "recipes", "inbox"] as const;
export type CopyPane = typeof COPY_PANES[number];
export const DEFAULT_COPY_PANE: CopyPane = "calendar";

export function isCopyPane(value: string): value is CopyPane {
  return (COPY_PANES as readonly string[]).includes(value);
}

/** Sub-tabs of Configuración — the WorkspaceConsole settings sections,
 *  in the URL for the same reason as the rest: a refresh on Invita IAs
 *  dropped back to Mi cuenta. "reports" is the bug-report queue;
 *  "docs" is the tools documentation table. */
export const SETTINGS_PANES = ["account", "integrations", "humans", "ais", "reports", "docs"] as const;
export type SettingsPane = typeof SETTINGS_PANES[number];
export const DEFAULT_SETTINGS_PANE: SettingsPane = "account";

export function isSettingsPane(value: string): value is SettingsPane {
  return (SETTINGS_PANES as readonly string[]).includes(value);
}

export function isGraphPane(value: string): value is GraphPane {
  return (GRAPH_PANES as readonly string[]).includes(value);
}

/** Each tab's own default pane — the one left out of the URL, the way the
 *  default TAB is left out. Compared against the graph's default regardless of
 *  tab, this wrote "files" into every Diseño URL and swallowed "pipeline". */
const DEFAULT_PANE_BY_TAB: Partial<Record<WorkspaceTab, string>> = {
  diseno: DEFAULT_DESIGN_PANE,
  agentes: DEFAULT_AGENT_PANE,
  copywriting: DEFAULT_COPY_PANE,
  configuracion: DEFAULT_SETTINGS_PANE,
  // Contactos is where the Red de Marcas graph lives, so it owns the
  // pipeline/accounts panes — not Agentes, which has its own three.
  contactos: DEFAULT_GRAPH_PANE,
};

/** Build the canonical URL for a dashboard tab, optionally with a pane. */
export function workspaceTabUrl(tab: WorkspaceTab, pane?: string): string {
  const base = tab === DEFAULT_WORKSPACE_TAB ? "/#workspace" : `/#workspace/${tab}`;
  return pane && pane !== DEFAULT_PANE_BY_TAB[tab] ? `${base}/${pane}` : base;
}

export type AppRoute =
  | { kind: "root" }
  | { kind: "agents" }
  | { kind: "workspace"; tab?: WorkspaceTab; pane?: string }
  | { kind: "template"; templateId: string }
  | { kind: "workspace-slug"; workspaceSlug: string; templateSlug?: string }
  | { kind: "invitation"; token: string }
  | { kind: "password-recovery" }
  | { kind: "comment-share"; templateId: string };

type LocationSnapshot = Pick<Location, "hash" | "pathname" | "search">;

export function readAppRoute(location: LocationSnapshot): AppRoute {
  const params = new URLSearchParams(location.search);
  const invitationToken = params.get("invite");
  if (invitationToken) return { kind: "invitation", token: invitationToken };
  if (params.get("reset") === "1") return { kind: "password-recovery" };

  const slugMatch = location.pathname.match(/^\/w\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (slugMatch) {
    return {
      kind: "workspace-slug",
      workspaceSlug: decodeURIComponent(slugMatch[1]),
      ...(slugMatch[2] ? { templateSlug: decodeURIComponent(slugMatch[2]) } : {}),
    };
  }

  // /c/:templateId — public share page for guest mobile comments. Deliberately
  // NOT in routeRequiresAccount: a phone from a share link has no session.
  const shareMatch = location.pathname.match(/^\/c\/([^/]+)\/?$/);
  if (shareMatch) {
    return { kind: "comment-share", templateId: decodeURIComponent(shareMatch[1]) };
  }

  const templateId = params.get("template");
  if (templateId) return { kind: "template", templateId };

  // "#agents" — la página para IAs (La Llamada). Pública: un agente sin
  // sesión debe poder leerla igual que un humano sin cuenta.
  const hash = location.hash.replace(/^#/, "");
  if (hash === "agents") return { kind: "agents" };
  // "#workspace" (default tab), "#workspace/<tab>", or "#workspace/<tab>/<pane>".
  // An unrecognised tab segment falls back to the workspace default rather
  // than dropping the user out to the landing page; an unrecognised pane is
  // dropped but keeps the tab, since the tab is the bigger loss.
  if (hash === "workspace") return { kind: "workspace" };
  if (hash.startsWith("workspace/")) {
    const [tab, pane] = hash.slice("workspace/".length).split("/");
    if (!isWorkspaceTab(tab)) return { kind: "workspace" };
    return pane ? { kind: "workspace", tab, pane } : { kind: "workspace", tab };
  }
  return { kind: "root" };
}

export function routeRequiresAccount(route: AppRoute): boolean {
  return route.kind === "workspace"
    || route.kind === "template"
    || route.kind === "workspace-slug";
}
