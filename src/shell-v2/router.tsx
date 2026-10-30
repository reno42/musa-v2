/**
 * router.tsx — Registro de vistas del shell v2 (REQ-069 F0).
 *
 * Las 41 rutas del prototipo están registradas DESDE F0: cada una navega y
 * renderiza su vista. Las que aún no tienen módulo de datos en
 * src/lib/apiV2 muestran el placeholder "En construcción" (UnderConstruction);
 * la lista de datos pendientes vive en shell-v2/NEEDS.md.
 */
import type { ComponentType } from "react";
import { ROUTES, ROUTE_BY_ID, type V2RouteMeta } from "./navConfig";
import { UnderConstruction } from "../components/v2/ds";
import { InicioResumen } from "./views/InicioResumen";
import { CerebroView, MiTrabajoView } from "./views/InicioF3Views";
import { CrearAutomatizaciones, CrearDisenos } from "./views/CrearViews";
import { PlanearCalendario, PlanearInvestigacion } from "./views/PlanearViews";
import { ConversarBandeja, ConversarComentarios } from "./views/ConversarViews";
import { ConfiguracionApis, ConfiguracionCuenta, ConfiguracionConecta, ConfiguracionEquipo, ConfiguracionEspacios, ConfiguracionIntegraciones } from "./views/ConfiguracionViews";
import { MedirEmbudos, MedirLoops, MedirReportes } from "./views/MedirViews";
import { AgentesChats, AgentesComputadoras } from "./views/AgentesViews";
import { EmbudoVista, EmpresasTabla, LoopsVista, OportunidadesKanban, PersonasTabla } from "./views/VenderViews";
import { AudienciasView, CampanasView, PresupuestoView } from "./views/AnunciarViews";
import { MarcasView, TomasView, VideosView } from "./views/CrearF2Views";
import { AreasView } from "./views/OrganizacionF3Views";

/** Props que el shell inyecta a toda vista v2. */
export interface V2ViewProps {
  meta: V2RouteMeta;
  /** Workspace de la sesión actual (null hasta que la cuenta resuelve). */
  workspaceId: string | null;
  /** Abrir un diseño en el editor #template/<id> (intacto, REQ-068). */
  onOpenTemplate: (templateId: string) => void;
}

/**
 * Mapa routeId → vista. Cada entrada del prototipo está registrada; las
 * vistas reales se van sumando por oleadas (F1) sobre este mismo mapa.
 */
export const VIEWS: Record<string, ComponentType<V2ViewProps>> = {
  // ── Vistas con datos reales (F1 por oleadas, SOLO vía src/lib/apiV2) ──
  "inicio/resumen": InicioResumen, // apiV2/inicio.ts (loadInicio)
  "inicio/mi-trabajo": MiTrabajoView, // apiV2/inicio.ts (fetchMiTrabajo: deals next_step + templates recientes)
  "inicio/cerebro": CerebroView, // apiV2/inicio.ts (fetchCerebro: brain-notes/entity kind=archivo por pieza)
  "crear/disenos": CrearDisenos, // apiV2/crear.ts (loadCrear → GET /api/templates)
  "crear/automatizaciones": CrearAutomatizaciones, // apiV2/crear.ts (loadCrear → GET /api/recipes)
  "planear/calendario": PlanearCalendario, // apiV2/planear.ts (loadPlanear → GET /api/content)
  "planear/investigacion": PlanearInvestigacion, // apiV2/planear.ts (research sources + items)
  "conversar/bandeja": ConversarBandeja, // apiV2/conversar.ts (loadConversar)
  "conversar/comentarios": ConversarComentarios, // apiV2/vender.ts (fetchShares → /api/comments-share)
  "configuracion/espacios": ConfiguracionEspacios, // apiV2/organizacion.ts (loadOrganizacion)
  "configuracion/equipo": ConfiguracionEquipo, // apiV2/organizacion.ts (loadOrganizacion → members)
  "configuracion/integraciones": ConfiguracionIntegraciones, // apiV2/conversar.ts (fetchSocialIntegrations)
  "medir/reportes": MedirReportes, // apiV2/medir.ts (loadMedir)
  "medir/embudos": MedirEmbudos, // apiV2/medir.ts (buildFunnelTrends: crm_deals + /api/metrics/activity)
  "medir/loops": MedirLoops, // apiV2/medir.ts (loadLoops: re-export buildLoops de vender.ts)
  "agentes/computadoras": AgentesComputadoras, // apiV2/agentes.ts (loadAgentes → /api/ghost/*)
  "agentes/chats": AgentesChats, // apiV2/agentes.ts (fetchAgentChats → GET /api/chat/messages)
  "vender/oportunidades": OportunidadesKanban, // apiV2/vender.ts (fetchDeals → PostgREST crm_deals)
  "vender/personas": PersonasTabla, // apiV2/vender.ts (fetchContacts → PostgREST crm_contacts)
  "vender/empresas": EmpresasTabla, // apiV2/vender.ts (fetchBrands → PostgREST brands)
  "vender/embudo": EmbudoVista, // apiV2/vender.ts (fetchDeals + buildFunnel por stage)
  "vender/loops": LoopsVista, // apiV2/vender.ts (fetchDeals + buildLoops: next_step_date/note)
  "anunciar/campanas": CampanasView, // apiV2/anunciar.ts (fetchCampaigns + fetchBrands → PostgREST)
  "anunciar/audiencias": AudienciasView, // apiV2/anunciar.ts (fetchContacts + buildAudiences)
  "anunciar/presupuesto": PresupuestoView, // apiV2/anunciar.ts (fetchCampaigns + fetchDeals + buildBudget)
  "crear/videos": VideosView, // apiV2/crear.ts (fetchVideoProjects → GET /api/video-projects)
  "crear/marcas": MarcasView, // apiV2/crear.ts (fetchBrandTokens → PostgREST brands JSONB)
  "crear/tomas": TomasView, // apiV2/crear.ts (fetchPhotoCatalog → GET /api/photos/catalog)
  "configuracion/cuenta": ConfiguracionCuenta, // apiV2/configuracion.ts (fetchAccount → GET /api/account/me)
  "configuracion/conecta": ConfiguracionConecta, // apiV2/configuracion.ts (fetchLlmKeys → GET /api/keys) + conversar.ts (social)
  "configuracion/apis": ConfiguracionApis, // apiV2/configuracion.ts (fetchWebhooks → GET /api/webhooks + llaves + social)
  "organizacion/areas": AreasView, // apiV2/organizacion.ts (fetchAreas → PostgREST workspace_areas)

  // ── Pendientes de sus datos (necesidades en shell-v2/NEEDS.md) ──

  "organizacion/aprobaciones": UnderConstruction,
  "organizacion/agencias": UnderConstruction,
  "organizacion/plantillas": UnderConstruction,

  "crear/clones": UnderConstruction,
  "crear/eventos": UnderConstruction,
  "crear/mailing": UnderConstruction,
  "crear/formularios": UnderConstruction,

  "medir/ads": UnderConstruction,

  "configuracion/papelera": UnderConstruction,
};

/**
 * Cobertura del registro: si una ruta del inventario del prototipo no tiene
 * entrada aquí, el nav ofrecería un enlace muerto. Este assert rompe el build
 * en desarrollo antes de que ocurra.
 */
const MISSING = ROUTES.filter(r => !VIEWS[r.id]);
if (MISSING.length > 0) {
  throw new Error(`[shell-v2] rutas sin vista registrada: ${MISSING.map(r => r.id).join(", ")}`);
}

/** Total de rutas navegables (debe ser 41 — QA/shell-v2-routes.test.mjs). */
export const ROUTE_COUNT = ROUTES.length;

/** Resuelve la vista de una ruta; ROUTE_BY_ID valida que exista en el inventario. */
export function viewForRoute(routeId: string): ComponentType<V2ViewProps> | null {
  if (!ROUTE_BY_ID.has(routeId)) return null;
  return VIEWS[routeId] ?? UnderConstruction;
}
