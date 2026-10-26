# REQ-051 — Research en Copywriting: noticias → tarjetas → encargo a la IA conectada

Fecha: 2026-02-06 · Estado: **implementado y verificado; migración v78 aplicada (2026-10-26); QA 20/20 + api tsc limpio** · Prioridad: P1 · Origen: solicitud de Ren — «un sub-módulo en copywriting que jale noticias y blogs automáticamente y que con un click las convierta en contenido para todas las redes».

## 1. Objetivo

Un pane «Research» dentro de Copywriting que ingiere noticias y posts (RSS y
cuentas de X vía Nitter) automáticamente, las muestra como tarjetas, y convierte
una tarjeta en contenido para varias redes —copy nativo por red, entradas de
calendario y diseños— con UN click. La generación NO depende de tokens de LLM
conectados por API: la ejecuta la IA del usuario conectada al harness MCP, con
SU suscripción (mismo contrato D1 de REQ-042: «la IA del usuario trabaja con SU
suscripción; Musa no paga tokens»).

## 2. Decisión

Tres tablas nuevas (v78) y doble puerta —REST para el pane, tools `research_*`
para las IAs— sobre las mismas filas, como copy_recipes (v32):

| Pieza | Archivo |
| --- | --- |
| Migración (3 tablas + RLS + índices) | `supabase_migrations_v78.sql` |
| Constantes compartidas redes/formatos | `shared/researchNetworks.ts` |
| Ingesta + briefing (librería única) | `worker/runtime/functions/research-ingest.mjs` |
| Sweep en el cron de 5 min | `worker/index.js` (kill switch `RESEARCH_INGEST_ENABLED`) |
| REST del pane | `api/src/routes/research.ts` → `/api/research` |
| 10 tools MCP | `worker/runtime/functions/mcp.mjs` |
| Pane | `src/components/ResearchTab.tsx` + `ContentTab.tsx` (pane `research`) |

### Tools MCP (todas en SKILL.md, regenerar con `npm run sync:skill`)

- `research_list_sources` / `research_add_source` / `research_update_source` /
  `research_delete_source` — CRUD de fuentes (RSS o Nitter, keywords, cadencia).
- `research_refresh_sources` — lectura inmediata; devuelve tarjetas nuevas.
- `research_list_items` / `research_update_item` — las tarjetas y su estado.
- `research_create_request` — el «un click»: crea el encargo con briefing
  resuelto y devuelve `{requestId, resumeToken, briefing}`.
- `research_ai_tasks` — la bandeja para la IA del usuario (espejo de
  `flow_ai_tasks`): pendientes con el briefing completo en `message`.
- `research_ai_complete` — la entrega (espejo de `flow_ai_complete`):
  `{resumeToken, payload:{entries:[…], notes}}`; payload sin `entries` →
  rechazo con `missingKeys` y el MISMO token (requiredKeys de REQ-042).

Las tools van auditadas (`AUDITED_METHODS`, v71) y con scopes (REQ-047):
bandeja = `flows:read`, entrega = `flows:resume`, CRUD = `assets:read/write` —
el preset «Atendedor de tareas» puede atender encargos sin poder administrar
fuentes.

## 3. Storage (v78)

- `research_sources` (`rsx_`): url https-only, tipo `rss|nitter`,
  `include_keywords`/`exclude_keywords` text[] (substring lowercase sobre
  título+resumen; include vacío pasa todo, exclude descarta), `refresh_minutes`
  30-1440 (default 60), diagnóstico del último sweep (`last_status/last_error`).
- `research_items` (`rin_`): tarjeta por noticia; `UNIQUE(workspace_id,
  link_hash)` = dedupe por link (sha256); status `new|used|dismissed`.
- `research_requests` (`rrq_`): redes[] × formatos[] × `include_design`,
  marca, notas, fecha sugerida; `briefing` NOT NULL resuelto al crear,
  `resume_token` UNIQUE (capability), `expires_at` (240 min, el default de las
  esperas), `result` jsonb `{entries:[{entryId,network,format,…}], notes}`.
- RLS idéntico a copy_recipes: lectura `viewer`, escritura `editor`.

## 4. Decisiones

- **D1 — Generación asíncrona vía bandeja IA**: el click NO llama a un LLM;
  encola el encargo. La IA conectada hace polling (`research_ai_tasks`) y
  completa (`research_ai_complete`). El pane muestra el estado (Encargado →
  Listo/Error) y ofrece «copiar briefing» como fallback manual. La expiración
  es informativa: un encargo vencido sigue visible y completable.
- **D2 — Ingesta automática**: el cron de 5 min ya barre webhooks y
  mantenimiento; se agrega un sweep de fuentes vencidas con kill switch
  `RESEARCH_INGEST_ENABLED`. Respeta la nota de producto (el server no agenda
  flows): esto es barrido de fuentes, análogo al dispatch de webhooks. La
  primera ingesta corre al crear la fuente (REST y MCP): una fuente muerta no
  rechaza el alta, queda con `last_status: 'error'` y el motivo.
- **D3 — Formatos v1**: fuente `rss` (noticias y blogs) y `nitter` (cuentas X),
  reutilizando el fetch protegido de `flows-sources.mjs` (HTTPS-only, SSRF
  guard). Redes: linkedin, x, instagram, facebook, tiktok. Formatos: post
  (1080×1350), carrusel (1080×1350), story (1080×1920) — lista extensible en
  `shared/researchNetworks.ts`, una sola fuente para UI, validación y briefing.
- **D4 — Diseños con estrategia master-template**: el briefing instruye clonar
  la plantilla maestra del workspace por formato (`duplicate_template`) y
  llenarla; si no hay maestra, crearla desde cero con el design system de la
  marca. Nada de variantes hardcoded.
- **D5 — Alcance v1**: un item por encargo (1 noticia → todas las redes +
  diseños). Fuera de alcance: publicación automática (sigue siendo
  `publish_content` manual), APIs JSON arbitrarias y selección múltiple de
  noticias por encargo. Batch multi-item queda para después.

## 5. El briefing (contrato de la tarea)

`buildResearchBriefing` (en la librería compartida; REST y MCP generan el
mismo texto) incluye: la noticia adjunta (título/resumen/link/imagen/fuente),
qué producir (red × formato con las medidas de la red), los pasos (leer brand
context y `list_copy_recipes` ANTES de redactar; un copy nativo por red; crear
la entrada con `add_content_idea` + `update_content`, campaign `research`,
status «diseño», sin publicar; diseñar clonando la maestra si `includeDesign`)
y el contrato de entrega: `research_ai_complete {resumeToken, payload:{entries:
[{entryId, network, format,…}], notes}}`. Al entregar, la tarjeta pasa a `used`.

## 6. Verificación

1. `node --test QA/req051-research.test.mjs` (ingesta, validación del encargo,
   scopes, registro MCP, REST, migración, cron, frontend, SKILL.md).
2. Suites vecinas: `QA/req042-search-calendar-aitask.test.mjs`,
   `QA/req047-connect-ai.test.mjs` (scopes), `QA/req048-*.test.mjs`.
3. `npm run build` local — sin push automático.
4. Migración v78: se entrega el SQL; aplicarlo a Supabase es paso de despliegue
   (`harness_healthcheck` antes de mutar remoto).
5. Smoke del Worker local (`wrangler dev`): fuente RSS real → tarjetas →
   encargo → `research_ai_tasks` con la key del workspace → completar →
   entradas en calendario + tarjetas «Usada».
