# NEEDS.md — Datos que el shell-v2 espera de apiV2 (carril IDE agent → carril Hermes)

Formato: `[vista] [dato que necesito] [formato esperado]`.
Regla REQ-070: una vista solo se conecta cuando su módulo existe en `src/lib/apiV2/`
(contrato en `src/lib/apiV2/README.md`). Mientras una vista no tiene módulo, queda en
placeholder "En construcción" y su necesidad vive aquí. PROHIBIDO mock data.

Estado F3: **38 vistas conectadas / 41 registradas** (3 esperan datos).

## Conectadas (consumen módulos existentes — no piden nada)

| Vista | Módulo apiV2 |
|---|---|
| `inicio/resumen` ✅ | `inicio.ts` (`loadInicio`: workspaces + templates + activity) |
| `crear/disenos` ✅ | `crear.ts` (`loadCrear` → GET /api/templates) |
| `crear/automatizaciones` ✅ | `crear.ts` (`loadCrear` → GET /api/recipes) |
| `planear/calendario` ✅ | `planear.ts` (`loadPlanear` → GET /api/content) |
| `planear/investigacion` ✅ | `planear.ts` (research sources + items) |
| `conversar/bandeja` ✅ | `conversar.ts` (`loadConversar`: integraciones + inbox) |
| `conversar/comentarios` ✅ | `vender.ts` (`fetchShares` → GET /api/comments-share) |
| `configuracion/espacios` ✅ | `organizacion.ts` (`loadOrganizacion`: workspaces) |
| `configuracion/equipo` ✅ | `organizacion.ts` (`loadOrganizacion`: members) |
| `configuracion/integraciones` ✅ | `conversar.ts` (`fetchSocialIntegrations`) |
| `medir/reportes` ✅ | `medir.ts` (`loadMedir`: activity + storage) |
| `agentes/computadoras` ✅ | `agentes.ts` (`loadAgentes`: GET /api/ghost/jobs + summary) |
| `agentes/chats` ✅ | `agentes.ts` (`fetchAgentChats` → GET /api/chat/messages, tabla chat_messages) |
| `vender/oportunidades` ✅ | `vender.ts` (`fetchDeals` → PostgREST crm_deals, kanban por stage) |
| `vender/personas` ✅ | `vender.ts` (`fetchContacts` → PostgREST crm_contacts, tabla) |
| `vender/empresas` ✅ | `vender.ts` (`fetchBrands` → PostgREST brands, tabla CRM) |
| `vender/embudo` ✅ | `vender.ts` (`fetchDeals` + `buildFunnel`: valor/cantidad/probabilidad por stage) |
| `vender/loops` ✅ | `vender.ts` (`fetchDeals` + `buildLoops`: next_step_date/note, vencidos en rojo) |
| `anunciar/campanas` ✅ | `anunciar.ts` (`fetchCampaigns` + `fetchBrands` → PostgREST campaigns) |
| `anunciar/audiencias` ✅ | `anunciar.ts` (`fetchContacts` + `buildAudiences`, deriva de crm_contacts) |
| `anunciar/presupuesto` ✅ | `anunciar.ts` (`buildBudget` sobre campaigns + deals; asignado espera columna presupuesto_plan) |
| `crear/videos` ✅ | `crear.ts` (`fetchVideoProjects` → GET /api/video-projects, forma real `{projects}`) |
| `crear/marcas` ✅ | `crear.ts` (`fetchBrandTokens` → PostgREST brands JSONB colors/fonts/spacing) |
| `crear/tomas` ✅ | `crear.ts` (`fetchPhotoCatalog` → GET /api/photos/catalog; /documents no lista sin sourceUrl) |
| `configuracion/cuenta` ✅ | `configuracion.ts` (`fetchAccount` → GET /api/account/me, user_profiles) |
| `configuracion/conecta` ✅ | `configuracion.ts` (`fetchLlmKeys` → GET /api/keys, mapa BYOK) + `conversar.ts` (social) |
| `configuracion/apis` ✅ | `configuracion.ts` (`fetchWebhooks` → GET /api/webhooks, hooks de la cuenta + resumen conexiones) |
| `inicio/mi-trabajo` ✅ | `inicio.ts` (`fetchMiTrabajo`: deals con next_step vía `buildLoops` de vender.ts + templates recientes) |
| `inicio/cerebro` ✅ | `inicio.ts` (`fetchCerebro`: GET /api/brain-notes/entity kind=archivo por pieza reciente) |
| `medir/embudos` ✅ | `medir.ts` (`buildFunnelTrends`: crm_deals por stage vía `buildFunnel` + /api/metrics/activity) |
| `medir/loops` ✅ | `medir.ts` (`loadLoops`: re-export de `buildLoops` de vender.ts sobre crm_deals) |
| `organizacion/areas` ✅ | `organizacion.ts` (`fetchAreas` → PostgREST workspace_areas, tablas aditivas F3 de Hermes) |
| `organizacion/aprobaciones` ✅ | `organizacion.ts` (`fetchApprovals` → PostgREST workspace_approvals) |
| `organizacion/agencias` ✅ | `organizacion.ts` (`fetchAgencies` → PostgREST workspace_agencies) |
| `crear/clones` ✅ | `crear.ts` (`fetchClones` → PostgREST workspace_clones) |
| `crear/eventos` ✅ | `crear.ts` (`fetchEvents` → PostgREST workspace_events) |
| `crear/mailing` ✅ | `crear.ts` (`fetchMailings` → PostgREST workspace_mailings) |
| `crear/formularios` ✅ | `crear.ts` (`fetchForms` → PostgREST workspace_forms) |

## Pendientes (por vista)

- [organizacion/plantillas] [plantillas de marca bloqueadas por el corporativo] [array { id, nombre, marca, bloqueada: boolean }]
- [medir/ads] [reporte de pauta (resultado de campañas)] [array { id, campana, marca, canal, impresiones, clicks, ctrPct, gastoUsd, resultadoUsd }]
- [configuracion/papelera] [elementos borrados restaurables (storage)] [array { id, tipo: "diseno"|"video"|"toma", nombre, borradoAt, diasParaPurgar }] — F3: PASS honesto. Lo único parecido es GET /api/templates/:id/versions (versions.ts), que es HISTORIAL de snapshots de un diseño VIVO (requiere templateId); no existe endpoint que LISTE elementos borrados del workspace. Papelera espera un endpoint real tipo GET /api/templates?deleted=1 o storage-trash. Placeholder intacto.

Nota de coordinación: cuando Hermes publique un módulo en `src/lib/apiV2/`, su vista
se conecta en `router.tsx` (mapa `VIEWS`) y su línea sube a la tabla "Conectadas".
Mientras el módulo no exista, la vista permanece en placeholder — PROHIBIDO mock data.
