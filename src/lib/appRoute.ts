/** Dashboard tabs that can appear in the URL as `#workspace/<tab>`.
 *  Keeping the tab in the URL (rather than in React state alone) is what
 *  makes a refresh land back on the same tab, and makes a tab linkable. */
export const WORKSPACE_TABS = [
  "templates", "kanban", "texts", "recipes", "storage", "settings", "graph", "workspace",
] as const;
export type WorkspaceTab = typeof WORKSPACE_TABS[number];

/** "templates" is the default, so it's the one tab left out of the URL. */
export const DEFAULT_WORKSPACE_TAB: WorkspaceTab = "templates";

export function isWorkspaceTab(value: string): value is WorkspaceTab {
  return (WORKSPACE_TABS as readonly string[]).includes(value);
}

/** Build the canonical URL for a dashboard tab. */
export function workspaceTabUrl(tab: WorkspaceTab): string {
  return tab === DEFAULT_WORKSPACE_TAB ? "/#workspace" : `/#workspace/${tab}`;
}

export type AppRoute =
  | { kind: "root" }
  | { kind: "workspace"; tab?: WorkspaceTab }
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

  // "#workspace" (default tab) or "#workspace/<tab>". An unrecognised tab
  // segment falls back to the workspace default rather than dropping the
  // user out to the landing page.
  const hash = location.hash.replace(/^#/, "");
  if (hash === "workspace") return { kind: "workspace" };
  if (hash.startsWith("workspace/")) {
    const tab = hash.slice("workspace/".length);
    return isWorkspaceTab(tab) ? { kind: "workspace", tab } : { kind: "workspace" };
  }
  return { kind: "root" };
}

export function routeRequiresAccount(route: AppRoute): boolean {
  return route.kind === "workspace"
    || route.kind === "template"
    || route.kind === "workspace-slug";
}
