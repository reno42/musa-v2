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

/** Props que el shell inyecta a toda vista v2. */
export interface V2ViewProps {
  meta: V2RouteMeta;
  /** Abrir un diseño en el editor #template/<id> (intacto, REQ-068). */
  onOpenTemplate: (templateId: string) => void;
}

/**
 * Mapa routeId → vista. Cada entrada del prototipo está registrada; las
 * vistas reales se van sumando por oleadas (F1) sobre este mismo mapa.
 */
export const VIEWS: Record<string, ComponentType<V2ViewProps>> = {
  // ── Vistas con datos reales (F1 por oleadas) ──
  "inicio/resumen": InicioResumen, // apiV2/inicio.ts (loadInicio)

  // ── Pendientes de su módulo en apiV2 (ver shell-v2/NEEDS.md) ──
  "inicio/mi-trabajo": UnderConstruction,
  "inicio/cerebro": UnderConstruction,

  "organizacion/areas": UnderConstruction,
  "organizacion/aprobaciones": UnderConstruction,
  "organizacion/agencias": UnderConstruction,
  "organizacion/plantillas": UnderConstruction,

  "planear/investigacion": UnderConstruction,
  "planear/calendario": UnderConstruction,

  "crear/marcas": UnderConstruction,
  "crear/disenos": UnderConstruction,
  "crear/videos": UnderConstruction,
  "crear/tomas": UnderConstruction,
  "crear/clones": UnderConstruction,
  "crear/eventos": UnderConstruction,
  "crear/mailing": UnderConstruction,
  "crear/formularios": UnderConstruction,
  "crear/automatizaciones": UnderConstruction,

  "conversar/bandeja": UnderConstruction,
  "conversar/comentarios": UnderConstruction,

  "anunciar/campanas": UnderConstruction,
  "anunciar/audiencias": UnderConstruction,
  "anunciar/presupuesto": UnderConstruction,

  "vender/oportunidades": UnderConstruction,
  "vender/personas": UnderConstruction,
  "vender/empresas": UnderConstruction,
  "vender/embudo": UnderConstruction,
  "vender/loops": UnderConstruction,

  "agentes/chats": UnderConstruction,
  "agentes/computadoras": UnderConstruction,

  "medir/reportes": UnderConstruction,
  "medir/embudos": UnderConstruction,
  "medir/loops": UnderConstruction,
  "medir/ads": UnderConstruction,

  "configuracion/cuenta": UnderConstruction,
  "configuracion/espacios": UnderConstruction,
  "configuracion/integraciones": UnderConstruction,
  "configuracion/equipo": UnderConstruction,
  "configuracion/conecta": UnderConstruction,
  "configuracion/apis": UnderConstruction,
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
