# NEEDS.md — Datos que el shell-v2 espera de apiV2 (carril IDE agent → carril Hermes)

Formato: `[vista] [dato que necesito] [formato esperado]`.
Regla REQ-070: una vista solo se conecta cuando su módulo existe en `src/lib/apiV2/`
(contrato en `src/lib/apiV2/README.md`). Mientras una vista no tiene módulo, queda en
placeholder "En construcción" y su necesidad vive aquí. PROHIBIDO mock data.

Estado F2: **21 vistas conectadas / 41 registradas** (20 esperan datos).

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
| `vender/oportunidades` ✅ | `vender.ts` (`fetchDeals` → PostgREST crm_deals, kanban por stage) |
| `vender/personas` ✅ | `vender.ts` (`fetchContacts` → PostgREST crm_contacts, tabla) |
| `vender/empresas` ✅ | `vender.ts` (`fetchBrands` → PostgREST brands, tabla CRM) |
| `vender/embudo` ✅ | `vender.ts` (`fetchDeals` + `buildFunnel`: valor/cantidad/probabilidad por stage) |
| `vender/loops` ✅ | `vender.ts` (`fetchDeals` + `buildLoops`: next_step_date/note, vencidos en rojo) |
| `anunciar/campanas` ✅ | `anunciar.ts` (`fetchCampaigns` + `fetchBrands` → PostgREST campaigns) |
| `anunciar/audiencias` ✅ | `anunciar.ts` (`fetchContacts` + `buildAudiences`, deriva de crm_contacts) |
| `anunciar/presupuesto` ✅ | `anunciar.ts` (`buildBudget` sobre campaigns + deals; asignado espera columna presupuesto_plan) |
| `crear/videos` ✅ | `crear.ts` (`fetchVideoProjects` → GET /api/video-projects, forma real `{projects}`) |

## Pendientes (por vista)

- [inicio/mi-trabajo] [tareas y piezas asignadas al usuario de la sesión] [array { id, titulo, vistaOrigen, refId, marca, venceAt, estado: "hoy"|"urgente"|"semana" }]
- [inicio/cerebro] [notas del segundo cerebro (brainNotes) con sus enlaces entre notas] [array { id, titulo, contenido, enlaces: string[], actualizadoAt }]
- [organizacion/areas] [áreas internas del workspace corporativo] [array { id, nombre, lider, integrantes: number }]
- [organizacion/aprobaciones] [piezas en cola de aprobación de Marketing] [array { id, piezaId, marca, solicitadoPor, estado: "pendiente"|"aprobado"|"rechazado", solicitadoAt }]
- [organizacion/agencias] [agencias externas y sus accesos] [array { id, nombre, plan, marcas: string[], miembros: number }]
- [organizacion/plantillas] [plantillas de marca bloqueadas por el corporativo] [array { id, nombre, marca, bloqueada: boolean }]
- [crear/marcas] [design systems / marcas del workspace] [array { id, nombre, tokens: number, actualizadoAt }]
- [crear/tomas] [tomas/grabaciones (photos.ts)] [array { id, nombre, duracionS, fecha }]
- [crear/clones] [clones IA del workspace] [array { id, nombre, estado: "activo"|"entrenando"|"error" }]
- [crear/eventos] [eventos del workspace] [array { id, nombre, fecha, lugar, inscritos: number }]
- [crear/mailing] [campañas de email] [array { id, asunto, estado: "borrador"|"programado"|"enviado", fecha }]
- [crear/formularios] [formularios y capturas (semilla captura.ts)] [array { id, nombre, publicada: boolean, respuestas: number, url }]
- [agentes/chats] [chats y sesiones conversacionales con agentes IA (hoy apiV2/agentes.ts solo expone jobs de ejecución, no chats)] [array { id, nombre, agente, mensajesHoy, ultimoMensajeAt, estado }]
- [medir/embudos] [embudos de conversión con pasos] [array { id, nombre, pasos: array { nombre, valor, conversionPct } }]
- [medir/loops] [loops de medición activos] [array { id, nombre, metrica, delta, estado }]
- [medir/ads] [reporte de pauta (resultado de campañas)] [array { id, campana, marca, canal, impresiones, clicks, ctrPct, gastoUsd, resultadoUsd }]
- [configuracion/cuenta] [perfil de la cuenta de la sesión] [objeto { nombre, email, workspaceId, creadoAt }]
- [configuracion/conecta] [proveedores de IA y sus keys configuradas (ais)] [array { id, proveedor, etiqueta, scopes: string[], estado: "ok"|"off", keyMask }]
- [configuracion/apis] [API keys y webhooks salientes del workspace] [objeto { keys: array { id, etiqueta, mascara, creadoAt }, webhooks: array { id, url, eventos: string[], activo } }]
- [configuracion/papelera] [elementos borrados restaurables (storage)] [array { id, tipo: "diseno"|"video"|"toma", nombre, borradoAt, diasParaPurgar }]

Nota de coordinación: cuando Hermes publique un módulo en `src/lib/apiV2/`, su vista
se conecta en `router.tsx` (mapa `VIEWS`) y su línea sube a la tabla "Conectadas".
Mientras el módulo no exista, la vista permanece en placeholder — PROHIBIDO mock data.
