# REQ-069 — Musa Platform v2: la nueva UI como producto nativo, la infraestructura como motor

## Topología (decisión de Renzo, 2026-10-29)

- **Repo aparte:** `reno42/musa-v2` — copia completa de design-main en el punto
  de partida (baseline: origin/main con este REQ). Evolución independiente;
  design-main NO recibe el shell v2.
- **Cuenta Cloudflare aparte:** renzo@futuraria.com (ya existe). El Worker v2
  deploya ahí con su propio nombre (musa-v2) y su propio token de esa cuenta.
- **Mismo Supabase:** qqqcmtwzyaejlzffivri — mismo auth, mismas tablas, mismo
  realtime, mismas API keys (viven en la BD; ambas APIs las validan igual).
  La UI v2 es otra cara del mismo backend: migrar no significa perder nada.
- **Dominio:** subdominio nuevo de futuraria.com (propuesto: next.futuraria.com).
  La zona futuraria.com vive en la cuenta ACTUAL → el Worker v2 (otra cuenta)
  no puede registrar custom domain propio; el alta se hace por CNAME proxied
  `next.futuraria.com → musa-v2.<sub>.workers.dev` en la zona actual. Sin mover
  la zona.
- **MCP:** sigue en design.futuraria.com/mcp (opera sobre la BD, no la UI).
  Las keys existentes de agentes siguen funcionando sin cambios; v2 puede
  exponer /mcp propio más adelante copiando el handler.
- **CORS:** sin cambios — v2 sirve su API desde su propio origen (código de API
  copiado en el repo v2), same-origin. No se toca el allowlist del worker v1.
- **Regla de oro durante toda la migración:** design-main y v1 NO se tocan.
  Cambios de backend que pida v2 son SOLO aditivos (tablas/endpoints/columnas
  con default), nunca migraciones destructivas sobre lo que v1 lee.
- **Flag `v2_enabled` (BD):** papel ajustado — v1 nunca lo lee; sirve como
  allowlist de qué workspaces pueden entrar a v2 y para coordinar el cutover.

## Principio rector (decisión de Renzo, NO negociable)

La UI del prototipo `musa-plataforma-mticket.html` (desplegada como spec vivo en
test.futuraria.com) se convierte en **la única interfaz de Musa**. La
infraestructura existente (API con 41 rutas, MCP con 324 tools, realtime,
auth/RLS, motor del editor) es el motor que la alimenta.

**PROHIBIDO "re-etiquetar lo viejo"**: cada vista del prototipo se conecta a
datos reales; si una vista no tiene backend, SE CONSTRUYE el backend. La
dirección de integración es: nuevo UI → consume infra real. No es un reskin ni
un wrapper cosmético sobre las vistas actuales.

**Alcance intacto:** `#template/<id>` (editor), MCP, OAuth, keys, realtime —
todo lo que consume la infra por debajo de la UI no cambia.

## Fuente de verdad: registro de módulos (extraído del prototipo, literal)

10 módulos · 41 subs · 7 roles (global, diseñador, motion, video, copy,
community, automatizador) con nav personalizable por rol (pin/ocultar/drag).

- inicio: resumen(dash) · mi-trabajo(mywork) · cerebro(brain)
- organizacion: areas(orgAreas) · aprobaciones(orgApr) · agencias(orgAg) · plantillas(orgTpl)
- planear: investigacion(list) · calendario(calendar)
- crear: marcas · disenos · videos · tomas · clones · eventos · mailing · formularios · automatizaciones(kanban) — todos grid salvo indicados
- conversar: bandeja(list) · comentarios(comments)
- anunciar: campanas(adsCamp) · audiencias(adsAud) · presupuesto(adsBud)
- vender: oportunidades(kanban) · personas(table) · empresas(table) · embudo(funnel) · loops(loops)
- agentes: chats(agChats) · computadoras(agVMs)
- medir: reportes(report) · embudos(mFunnel) · loops(mLoops) · ads(adsReport)
- configuracion: cuenta(form) · espacios(spaces) · integraciones(grid) · equipo(table) · conecta(connect) · apis(list) · papelera(list)

Routing: `#<modulo>/<sub>` (hash-based, linkable, sobrevive refresh).
Los roles y nav por rol del prototipo se respetan tal cual (ver ROLES en el prototipo).

## Mapa de infraestructura por vista (existe / construir)

COBERTURA ALTA (conectar a endpoints existentes):
- inicio/resumen → dashboard actual + metrics
- inicio/cerebro → brainNotes.ts
- crear/marcas,disenos → templates + workspaces + designSystem
- crear/videos → video pipeline existente (REQ-059/063)
- crear/tomas → photos.ts
- crear/clones → clones existentes
- crear/automatizaciones → flows (flows-core.mjs, KanbanTab)
- crear/mailing → contentCalendar + templates de email
- crear/eventos → events existentes
- vender/* → CrmWorkspace + contactos/pipeline/embudo actuales
- configuracion/* → saas.ts, workspaces.ts, integrations, apis/webhooks, ais (conecta IA), storage (papelera), equipo
- planear/calendario → contentCalendar.ts
- planear/investigacion → research pane (REQ-051)
- agentes/chats → chats/Ghost existentes
- medir/reportes → metrics.ts + ReportsSection

COBERTURA PARCIAL (completar):
- medir/embudos, medir/loops → funnel actual + loops: levantar a vista dedicada con datos reales
- conversar/comentarios → designComments + commentShare: unificar en vista propia

NETO NUEVO (construir backend + vista):
- conversar/bandeja — bandeja unificada (comentarios + mentions + inbox de canales)
- anunciar/campanas,audiencias,presupuesto — capa de ads (Meta Marketing API; probablemente REQ aparte por alcance)
- organizacion/areas,aprobaciones,agencias,plantillas — corporativo (conecta con REQ-039 agency plans)
- crear/formularios — formularios + captura (existe captura.ts como semilla)
- agentes/computadoras — VMs/computadoras de agentes (hoy: Ghost sessions como base)

## Fases (una fase = serie de PRs; cada PR con build verde)

**F0 — Shell v2 real (R, W)**
1. Extraer del prototipo: nav lateral (pin/rest/hid + drag), routing `#mod/sub`,
   roles, flags — a componentes React reales en design-main (`src/shell-v2/`).
   El prototipo queda como spec visual congelado; el código vive en el repo.
2. Flag por WORKSPACE en BD (tabla `workspace_flags` o columna en workspaces —
   NO localStorage). `v2_enabled`.
3. Con v2 ON: el shell v2 envuelve la app; `#template/<id>` monta EditorV2 sin
   cambios. Con v2 OFF: app actual 100% intacta.
   DoD F0: ambos shells conviven; usuario sin flag no nota nada; nav v2
   navega las 41 rutas (aunque algunas muestren "en construcción" temporal).

**F1 — Conectar cobertura alta (R)**
Cada vista de la lista COBERTURA ALTA lee/escribe sus endpoints REALES.
Prohibido mock data. DoD por vista: lista datos del workspace en <3s, CRUD
funciona, realtime refleja cambios entre 2 pestañas, estados vacío/carga/error
diseñados. Fase entregable por lotes (crear, vender, configuracion, etc.).

**F2 — Cobertura parcial (R)**
medir/embudos+loops, conversar/comentarios.

**F3 — Neto nuevo (R, previa estimación de créditos por pieza)**
bandeja, ads (3 vistas — probablemente REQ-070 propio), organización (REQ-039),
formularios, computadoras.

**F4 — Cutover (R, decisión explícita de Renzo)**
Flag global ON → shell v1 deprecado → remover código muerto en PR aparte.

## Reglas de ejecución

- Un ítem = un commit. Sin dependencias nuevas sin justificar en el PR.
- `npx tsc --noEmit` verde en cada PR. El editor (EditorV2) NO se refactoriza —
  se monta como motor. Ningún cambio de schema de datos existente.
- Estable > clever. Desviaciones documentadas en el PR.
- Los 324 tools del MCP NO cambian (operan sobre la infra, no la UI). Verificar
  en cada fase: suite MCP pasa igual.
- Al activar v2 en un workspace: actualizar router de intents (dataset v3) con
  los nombres de módulos nuevos + MUSA_ROUTING.md.

## Presupuesto estimado (créditos IDE agent)

- F0: 1,500–2,500 | F1: por lotes, 300–800 c/u | F2: 500–1,000 | F3: 2,000–4,000
  (ads aparte) | F4: 200.
- NO despachar F1 completo sin verificar créditos disponibles (regla de las 500).
