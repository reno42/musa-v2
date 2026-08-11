/** Dashboard tabs that can appear in the URL as `#workspace/<tab>`.
 *  Keeping the tab in the URL (rather than in React state alone) is what
 *  makes a refresh land back on the same tab, and makes a tab linkable. */
export const WORKSPACE_TABS = [
  "diseno", "agentes", "copywriting", "recipes", "storage", "configuracion", "contactos", "workspace",
] as const;
export type WorkspaceTab = typeof WORKSPACE_TABS[number];

/** "diseno" is the default, so it's the one tab left out of the URL. */
export const DEFAULT_WORKSPACE_TAB: WorkspaceTab = "diseno";

export function isWorkspaceTab(value: string): value is WorkspaceTab {
  return (WORKSPACE_TABS as readonly string[]).includes(value);
}

/**
 * Panes inside the Red de Marcas tab. These lived in React state alone, so a
 * refresh on the table or the CRM dropped back to the graph — and, once the
 * tab itself was lost, all the way back to Archivos. A pane is a place the
 * user navigated to; it belongs in the URL like any other.
 */
export const GRAPH_PANES = ["pipeline", "accounts", "storage"] as const;
export type GraphPane = typeof GRAPH_PANES[number];
export const DEFAULT_GRAPH_PANE: GraphPane = "pipeline";

export function isGraphPane(value: string): value is GraphPane {
  return (GRAPH_PANES as readonly string[]).includes(value);
}

/** Build the canonical URL for a dashboard tab, optionally with a pane. */
export function workspaceTabUrl(tab: WorkspaceTab, pane?: string): string {
  const base = tab === DEFAULT_WORKSPACE_TAB ? "/#workspace" : `/#workspace/${tab}`;
  return pane && pane !== DEFAULT_GRAPH_PANE ? `${base}/${pane}` : base;
}

export type AppRoute =
  | { kind: "root" }
  | { kind: "workspace"; tab?: WorkspaceTab; pane?: string }
  | { kind: "template"; templateId: string }
  | { kind: "workspace-slug"; workspaceSlug: string; templateSlug?: string }
  | { kind: "invitation"; token: string }
  | { kind: "password-recovery" };

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

  const templateId = params.get("template");
  if (templateId) return { kind: "template", templateId };

  // "#workspace" (default tab), "#workspace/<tab>", or "#workspace/<tab>/<pane>".
  // An unrecognised tab segment falls back to the workspace default rather
  // than dropping the user out to the landing page; an unrecognised pane is
  // dropped but keeps the tab, since the tab is the bigger loss.
  const hash = location.hash.replace(/^#/, "");
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
