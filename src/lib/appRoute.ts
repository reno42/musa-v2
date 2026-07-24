export type AppRoute =
  | { kind: "root" }
  | { kind: "workspace" }
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
  if (location.hash.replace(/^#/, "") === "workspace") return { kind: "workspace" };
  return { kind: "root" };
}

export function routeRequiresAccount(route: AppRoute): boolean {
  return route.kind === "workspace"
    || route.kind === "template"
    || route.kind === "workspace-slug";
}
