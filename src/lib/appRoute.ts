/** Dashboard tabs that can appear in the URL as `#workspace/<tab>`.
 *  Keeping the tab in the URL (rather than in React state alone) is what
 *  makes a refresh land back on the same tab, and makes a tab linkable. */
import { V2_HASH_SOURCE } from "../shell-v2/navConfig.ts";

export const WORKSPACE_TABS = [
  "home", "diseno", "copywriting", "recipes", "configuracion", "contactos", "flows", "video", "workspace",
] as const;
export type WorkspaceTab = typeof WORKSPACE_TABS[number];

/** "home" (Inicio, Dashboard Ejecutivo) is the default, so it's the one tab
 *  left out of the URL. Pre-existing `/#workspace` bookmarks — which used to
 *  mean Diseño — land on Inicio (per REQ); `/#workspace/diseno` still works. */
export const DEFAULT_WORKSPACE_TAB: WorkspaceTab = "home";

export function isWorkspaceTab(value: string): value is WorkspaceTab {
  return (WORKSPACE_TABS as readonly string[]).includes(value);
}

/**
 * Panes inside the Red de Marcas tab: the five CRM views (Ventas kanban,
 * Personas table, Marcas accounts, Embudo funnel, Captura inbox — REQ-029
 * Item 2). These lived in React state alone, so a refresh on the table or the
 * CRM dropped back to the graph — and, once the tab itself was lost, all the
 * way back to Archivos. A pane is a place the user navigated to; it belongs
 * in the URL like any other.
 */
export const GRAPH_PANES = ["pipeline", "personas", "accounts", "embudo", "captura"] as const;
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

/** Sub-tabs of Inicio, in URL order: Dashboard (the initial view), Kanban
 *  and Tabla (v59: ex pestaña Agentes). In the URL for the same reason as
 *  Diseño's: a refresh on the Tabla must not drop back to the Kanban — or to
 *  the Dashboard. "Infraestructura de agentes" is NOT a pane: the view is
 *  hidden (its code stays in the repo — AgentsPanel and the "agents" entry
 *  in Dashboard's AGENT_VIEWS — for a future return), so a stale
 *  #workspace/agentes/agents link lands on the Dashboard, not the roster.
 *  The default pane is "dashboard": pane-less Inicio and Inicio+dashboard
 *  are the same place, and both stay out of the URL. */
export const HOME_PANES = ["dashboard", "kanban", "table"] as const;
export type HomePane = typeof HOME_PANES[number];
export const DEFAULT_HOME_PANE: HomePane = "dashboard";

export function isHomePane(value: string): value is HomePane {
  return (HOME_PANES as readonly string[]).includes(value);
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
 *  "docs" is the tools documentation table; "apis" is APIs/Webhooks
 *  (claves + webhooks salientes para N8N/Zapier/Make). */
export const SETTINGS_PANES = ["account", "integrations", "humans", "ais", "reports", "apis", "docs"] as const;
export type SettingsPane = typeof SETTINGS_PANES[number];
export const DEFAULT_SETTINGS_PANE: SettingsPane = "account";

export function isSettingsPane(value: string): value is SettingsPane {
  return (SETTINGS_PANES as readonly string[]).includes(value);
}

export function isGraphPane(value: string): value is GraphPane {
  return (GRAPH_PANES as readonly string[]).includes(value);
}

/** Sub-tabs of Flows (REQ-027): Mis flows (board), Biblioteca (presets a
 *  clonar) e Historial (runs). En la URL por la misma razón que el resto:
 *  un refresh sobre la Biblioteca no te puede devolver al board. */
export const FLOWS_PANES = ["board", "library", "runs"] as const;
export type FlowsPane = typeof FLOWS_PANES[number];
export const DEFAULT_FLOWS_PANE: FlowsPane = "board";

export function isFlowsPane(value: string): value is FlowsPane {
  return (FLOWS_PANES as readonly string[]).includes(value);
}

/** Sub-tabs of Video (REQ-VID11): hoy solo "projects" (la lista). En la URL
 *  por la misma razón que el resto: un refresh sobre el tab no te bota a
 *  Inicio. */
export const VIDEO_PANES = ["projects"] as const;
export type VideoPane = typeof VIDEO_PANES[number];
export const DEFAULT_VIDEO_PANE: VideoPane = "projects";

export function isVideoPane(value: string): value is VideoPane {
  return (VIDEO_PANES as readonly string[]).includes(value);
}

/** Each tab's own default pane — the one left out of the URL, the way the
 *  default TAB is left out. Compared against the graph's default regardless of
 *  tab, this wrote "files" into every Diseño URL and swallowed "pipeline". */
const DEFAULT_PANE_BY_TAB: Partial<Record<WorkspaceTab, string>> = {
  home: DEFAULT_HOME_PANE,
  diseno: DEFAULT_DESIGN_PANE,
  copywriting: DEFAULT_COPY_PANE,
  configuracion: DEFAULT_SETTINGS_PANE,
  // Contactos is where the Red de Marcas graph lives, so it owns the
  // pipeline/accounts panes.
  contactos: DEFAULT_GRAPH_PANE,
  flows: DEFAULT_FLOWS_PANE,
  video: DEFAULT_VIDEO_PANE,
};

/** Build the canonical URL for a dashboard tab, optionally with a pane. */
export function workspaceTabUrl(tab: WorkspaceTab, pane?: string): string {
  // The default tab stays out of the URL — but only pane-less: writing a
  // pane straight after "#workspace" ("#workspace/kanban") would parse as
  // an unknown TAB, so a pane under Inicio spells the tab out. A tab's OWN
  // default pane is swallowed like the pane-less case: pane-less Inicio and
  // Inicio+dashboard are the same place.
  const isDefaultPane = !pane || pane === DEFAULT_PANE_BY_TAB[tab];
  const base = tab === DEFAULT_WORKSPACE_TAB && isDefaultPane ? "/#workspace" : `/#workspace/${tab}`;
  return pane && !isDefaultPane ? `${base}/${pane}` : base;
}

export type AppRoute =
  | { kind: "root" }
  | { kind: "agents" }
  | { kind: "connect" }
  | { kind: "workspace"; tab?: WorkspaceTab; pane?: string; id?: string }
  | { kind: "template"; templateId: string }
  | { kind: "video"; projectId: string }
  | { kind: "shell-v2"; mod: string; sub?: string }
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
  // "#connect" — REQ-047 «Conecta tu IA»: onboarding para agentes externos
  // (emitir token con scopes, snippets por cliente, probar conexión). Pública
  // por la misma razón que #agents: un agente recién invitado no tiene sesión.
  if (hash === "connect") return { kind: "connect" };
  // "#workspace" (default tab), "#workspace/<tab>", or "#workspace/<tab>/<pane>".
  // An unrecognised tab segment falls back to the workspace default rather
  // than dropping the user out to the landing page; an unrecognised pane is
  // dropped but keeps the tab, since the tab is the bigger loss.
  if (hash === "workspace") return { kind: "workspace" };
  // "#video/<projectId>" — editor de video standalone (REQ-VID11): el refresh
  // sobre el editor reabre ESE proyecto igual que el builder de flows.
  if (hash.startsWith("video/")) {
    const projectId = decodeURIComponent(hash.slice("video/".length));
    if (projectId) return { kind: "video", projectId };
  }
  if (hash.startsWith("workspace/")) {
    // Tercer segmento opcional = id profundo (p. ej. el flow abierto en el
    // builder: #workspace/flows/board/<flowId>). Un refresh sobre el builder
    // reabre ESE flow en vez de botarte al board. Cada tab valida el suyo.
    const [tab, pane, id] = hash.slice("workspace/".length).split("/");
    // v59: the Agentes tab was absorbed into Inicio (Kanban/Tabla are home
    // panes now). Old bookmarks and insight links keep working: they land on
    // the pane's new home instead of the default. The dashboard's own pane
    // validation drops what no longer exists ("agents").
    if (tab === "agentes") return { kind: "workspace", tab: "home", pane };
    if (!isWorkspaceTab(tab)) return { kind: "workspace" };
    const deepId = id ? decodeURIComponent(id) : undefined;
    return { kind: "workspace", tab, ...(pane ? { pane } : {}), ...(deepId ? { id: deepId } : {}) };
  }
  // "#<modulo>/<sub>" — shell v2 (REQ-069 F0): rutas `#inicio/resumen`,
  // `#crear/disenos`, etc. Los ids de módulo v2 no colisionan con los hashes
  // v1 de arriba (QA/shell-v2-routes.test.mjs lo audita). Se resuelve AL FINAL
  // para que un hash v1 nunca lo capture.
  const v2Match = hash.match(new RegExp(V2_HASH_SOURCE));
  if (v2Match) return { kind: "shell-v2", mod: v2Match[1], ...(v2Match[2] ? { sub: v2Match[2] } : {}) };
  return { kind: "root" };
}

export function routeRequiresAccount(route: AppRoute): boolean {
  return route.kind === "workspace"
    || route.kind === "template"
    || route.kind === "video"
    || route.kind === "workspace-slug"
    || route.kind === "shell-v2";
}
