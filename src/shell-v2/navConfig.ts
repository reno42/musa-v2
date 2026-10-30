/**
 * navConfig.ts — Registro de módulos, vistas y roles del shell v2.
 *
 * Fuente de verdad: el registro de módulos del prototipo publicado en
 * test.futuraria.com (spec vivo, REQ-069), extraído literal: 10 módulos ·
 * 41 vistas · 7 roles con nav personalizable (pin/ocultar/drag).
 *
 * Archivo de datos puro (sin React) para que QA/shell-v2-routes.test.mjs
 * pueda importarlo con node --experimental-strip-types y auditar el
 * inventario: 41 rutas navegables desde F0.
 */

export interface V2Sub {
  /** id del sub dentro del módulo (p. ej. "resumen"). */
  id: string;
  /** Etiqueta visible en el sidebar y en el header de la vista. */
  label: string;
  /** Tipo de vista según el prototipo (grid, table, kanban, funnel…). */
  kind: string;
}

export type V2IconEl =
  | { tag: "path"; d: string }
  | { tag: "rect"; x: number; y: number; width: number; height: number; rx?: number }
  | { tag: "circle"; cx: number; cy: number; r: number };

export interface V2Module {
  id: string;
  label: string;
  /** Acción primaria del módulo según el prototipo. */
  action: string;
  /** Descripción del módulo según el prototipo. */
  description: string;
  /** Icono del prototipo, como elementos SVG tipados (sin HTML crudo). */
  icon: V2IconEl[];
  subs: V2Sub[];
}

export interface V2Role {
  id: string;
  label: string;
  /** Ruta inicial al cambiar de rol. */
  home: string;
  /** Módulos anclados por defecto para este rol (además de "inicio"). */
  pin: string[];
}

/** Los 10 módulos del prototipo, en su orden del sidebar. */
export const MODULES: V2Module[] = [
  {
    id: "inicio", label: "Inicio", action: "Nueva pieza",
    description: "Lo importante del día en un solo lugar.",
    icon: [{ tag: "path", d: "M3 10.5L12 3l9 7.5" }, { tag: "path", d: "M5 9.5V21h5v-6h4v6h5V9.5" }],
    subs: [
      { id: "resumen", label: "Resumen", kind: "dash" },
      { id: "mi-trabajo", label: "Mi trabajo", kind: "mywork" },
      { id: "cerebro", label: "Segundo cerebro", kind: "brain" },
    ],
  },
  {
    id: "organizacion", label: "Organización", action: "Nueva área",
    description: "Solo en planes Corporativos: áreas internas, aprobación de Marketing, agencias externas y plantillas bloqueadas.",
    icon: [
      { tag: "rect", x: 9, y: 3, width: 6, height: 5, rx: 1 },
      { tag: "rect", x: 3, y: 16, width: 6, height: 5, rx: 1 },
      { tag: "rect", x: 15, y: 16, width: 6, height: 5, rx: 1 },
      { tag: "path", d: "M12 8v4M6 16v-2h12v2" },
    ],
    subs: [
      { id: "areas", label: "Áreas", kind: "orgAreas" },
      { id: "aprobaciones", label: "Aprobaciones", kind: "orgApr" },
      { id: "agencias", label: "Agencias externas", kind: "orgAg" },
      { id: "plantillas", label: "Plantillas de marca", kind: "orgTpl" },
    ],
  },
  {
    id: "planear", label: "Planear", action: "Nueva pieza",
    description: "Investiga temas, organiza el calendario y sigue cada pieza de principio a fin.",
    icon: [{ tag: "rect", x: 3, y: 4, width: 18, height: 18, rx: 2 }, { tag: "path", d: "M16 2v4M8 2v4M3 10h18" }],
    subs: [
      { id: "investigacion", label: "Investigación", kind: "list" },
      { id: "calendario", label: "Calendario", kind: "calendar" },
    ],
  },
  {
    id: "crear", label: "Crear", action: "Crear",
    description: "Tus marcas y todo lo que produces con ellas. Cada sección trae sus plantillas.",
    icon: [{ tag: "path", d: "M12 20h9" }, { tag: "path", d: "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" }],
    subs: [
      { id: "marcas", label: "Marcas", kind: "grid" },
      { id: "disenos", label: "Diseños", kind: "grid" },
      { id: "videos", label: "Video y motion", kind: "grid" },
      { id: "tomas", label: "Tomas", kind: "grid" },
      { id: "clones", label: "Clones IA", kind: "grid" },
      { id: "eventos", label: "Eventos", kind: "events" },
      { id: "mailing", label: "Mailing", kind: "mailing" },
      { id: "formularios", label: "Formularios", kind: "forms" },
      { id: "automatizaciones", label: "Automatizaciones", kind: "kanban" },
    ],
  },
  {
    id: "conversar", label: "Conversar", action: "Nuevo mensaje",
    description: "Responde mensajes y comentarios de todos los canales desde una bandeja.",
    icon: [{ tag: "path", d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" }],
    subs: [
      { id: "bandeja", label: "Bandeja", kind: "list" },
      { id: "comentarios", label: "Comentarios", kind: "comments" },
    ],
  },
  {
    id: "anunciar", label: "Anunciar", action: "Nueva campaña de ads",
    description: "Pauta pagada (ads) en Meta, TikTok, LinkedIn y Google: campañas, audiencias y presupuesto por marca.",
    icon: [
      { tag: "path", d: "M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z" },
      { tag: "path", d: "M15 8.5a4.5 4.5 0 0 1 0 7M18 5.5a9 9 0 0 1 0 13" },
    ],
    subs: [
      { id: "campanas", label: "Campañas de ads", kind: "adsCamp" },
      { id: "audiencias", label: "Audiencias de pauta", kind: "adsAud" },
      { id: "presupuesto", label: "Presupuesto de pauta", kind: "adsBud" },
    ],
  },
  {
    id: "vender", label: "Vender", action: "Nueva oportunidad",
    description: "Tu CRM: oportunidades, personas, empresas y embudo comercial.",
    icon: [
      { tag: "circle", cx: 6, cy: 6, r: 2 },
      { tag: "circle", cx: 18, cy: 6, r: 2 },
      { tag: "circle", cx: 12, cy: 18, r: 2 },
      { tag: "path", d: "M7.5 7.5 11 16M16.5 7.5 13 16M8 6h8" },
    ],
    subs: [
      { id: "oportunidades", label: "Oportunidades", kind: "kanban" },
      { id: "personas", label: "Personas", kind: "table" },
      { id: "empresas", label: "Empresas", kind: "table" },
      { id: "embudo", label: "Embudo", kind: "funnel" },
      { id: "loops", label: "Loops", kind: "loops" },
    ],
  },
  {
    id: "agentes", label: "Agentes", action: "Nuevo agente",
    description: "Tus agentes de IA, cada uno con su computadora en Maritime, operando Musa con los permisos que les das.",
    icon: [
      { tag: "rect", x: 4, y: 7, width: 16, height: 12, rx: 3 },
      { tag: "path", d: "M12 3v4M9 12h.01M15 12h.01M9 16h6" },
    ],
    subs: [
      { id: "chats", label: "Chats", kind: "agChats" },
      { id: "computadoras", label: "Computadoras", kind: "agVMs" },
    ],
  },
  {
    id: "medir", label: "Medir", action: "Programar reporte",
    description: "Alcance, embudos, loops y resultados de cada una de tus marcas.",
    icon: [
      { tag: "path", d: "M3 21h18" },
      { tag: "rect", x: 5, y: 11, width: 3, height: 7 },
      { tag: "rect", x: 10.5, y: 6, width: 3, height: 12 },
      { tag: "rect", x: 16, y: 13, width: 3, height: 5 },
    ],
    subs: [
      { id: "reportes", label: "Reportes", kind: "report" },
      { id: "embudos", label: "Embudos", kind: "mFunnel" },
      { id: "loops", label: "Loops", kind: "mLoops" },
      { id: "ads", label: "Ads · pauta", kind: "adsReport" },
    ],
  },
  {
    id: "configuracion", label: "Configuración", action: "Guardar cambios",
    description: "Tu cuenta, integraciones, equipo y accesos por API.",
    icon: [
      { tag: "circle", cx: 12, cy: 12, r: 3 },
      { tag: "path", d: "M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" },
    ],
    subs: [
      { id: "cuenta", label: "Cuenta", kind: "form" },
      { id: "espacios", label: "Espacios y planes", kind: "spaces" },
      { id: "integraciones", label: "Integraciones", kind: "grid" },
      { id: "equipo", label: "Equipo", kind: "table" },
      { id: "conecta", label: "Conecta tu IA", kind: "connect" },
      { id: "apis", label: "API y webhooks", kind: "list" },
      { id: "papelera", label: "Papelera", kind: "list" },
    ],
  },
];

/** Los 7 roles del prototipo, con su home y sus módulos anclados por defecto. */
export const ROLES: V2Role[] = [
  { id: "global", label: "Global · uso todo", home: "inicio/resumen", pin: [] },
  { id: "disenador", label: "Diseñador", home: "crear/disenos", pin: ["crear", "planear"] },
  { id: "motion", label: "Motion designer", home: "crear/videos", pin: ["crear", "planear"] },
  { id: "video", label: "Editor de video", home: "crear/videos", pin: ["crear", "planear"] },
  { id: "copy", label: "Copywriter", home: "planear/calendario", pin: ["planear", "crear"] },
  { id: "community", label: "Community manager", home: "conversar/bandeja", pin: ["conversar", "planear", "medir"] },
  { id: "automatizador", label: "Automatizador", home: "crear/automatizaciones", pin: ["crear", "configuracion", "medir"] },
];

export interface V2RouteMeta {
  /** id canónico "mod/sub" (p. ej. "inicio/resumen"). */
  id: string;
  mod: string;
  sub: string;
  label: string;
  kind: string;
  module: V2Module;
}

function buildRoutes(): V2RouteMeta[] {
  const out: V2RouteMeta[] = [];
  for (const m of MODULES) {
    for (const s of m.subs) {
      out.push({ id: `${m.id}/${s.id}`, mod: m.id, sub: s.id, label: s.label, kind: s.kind, module: m });
    }
  }
  return out;
}

/** Las 41 rutas navegables del shell v2 (derivadas, 1:1 con el prototipo). */
export const ROUTES: V2RouteMeta[] = buildRoutes();

/** Mapa id → metadata para lookup O(1). */
export const ROUTE_BY_ID: ReadonlyMap<string, V2RouteMeta> = new Map(ROUTES.map(r => [r.id, r]));

export function moduleById(id: string): V2Module | undefined {
  return MODULES.find(m => m.id === id);
}

/** Primera ruta de un módulo (a dónde navega el header del módulo). */
export function firstRouteOf(mod: string): string {
  const m = moduleById(mod);
  return m ? `${m.id}/${m.subs[0].id}` : "inicio/resumen";
}

/** href canónico del shell v2. */
export function v2Href(routeId: string): string {
  return `#${routeId}`;
}

/**
 * Prefijo de hash que el shell v2 reclama como suyo. Las rutas v1
 * ("workspace", "agents", "connect", "video", "template") no colisionan con
 * ningún id de módulo v2 — verificado por QA/shell-v2-routes.test.mjs.
 */
export const V2_HASH_SOURCE = `^(?:${MODULES.map(m => m.id).join("|")})(?:/([a-z0-9-]+))?$`;

/** Estado de navegación de un módulo en el sidebar (pin/rest/hid, REQ-069). */
export type NavPlacement = "pin" | "rest" | "hid";

export interface NavPrefs {
  /** Módulos anclados, en su orden (drag incluido). */
  pin: string[];
  /** Módulos en "Más módulos", en su orden (drag incluido). */
  rest: string[];
  /** Módulos ocultos por el usuario. */
  hid: string[];
}

/**
 * Nav por defecto de un rol (semántica del prototipo): global ve todo anclado;
 * los demás roles anclan inicio + sus pins, el resto cae en "Más módulos".
 */
export function defaultNavPrefs(roleId: string): NavPrefs {
  const role = ROLES.find(r => r.id === roleId) ?? ROLES[0];
  const all = MODULES.map(m => m.id);
  if (role.id === "global") return { pin: [...all], rest: [], hid: [] };
  const pin = ["inicio", ...role.pin].filter(id => all.includes(id));
  return { pin, rest: all.filter(id => !pin.includes(id)), hid: [] };
}
