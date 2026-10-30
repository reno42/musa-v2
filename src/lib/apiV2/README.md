# apiV2 — Capa de datos de Musa Platform v2 (carril Hermes, REQ-070)

Clientes de datos tipados para las vistas del shell-v2. **Sin UI, sin componentes:** solo
funciones async que las vistas importan. Todo pasa por `apiFetch` (src/lib/supabase.ts),
que ya resuelve auth, retries y timeouts. PROHIBIDO mock data: cada función habla con un
endpoint REAL del worker (api/src/routes/*).

## Convención

- Un archivo por vista del shell-v2: `src/lib/apiV2/<vista>.ts`
- Cada función exporta el type de retorno. Las vistas NO hacen fetch propio.
- Errores: las funciones devuelven datos o lanzan; el shell-v2 decide cómo mostrar el error.

## Mapa vista -> módulo -> endpoints reales que consume

| Vista (shell-v2)          | Módulo apiV2   | Endpoints reales usados                                   |
|---------------------------|----------------|------------------------------------------------------------|
| inicio (dashboard)        | inicio.ts      | GET /api/workspaces, GET /api/templates, GET /api/metrics/activity |
| crear (proyectos)         | crear.ts       | GET /api/templates, POST /api/templates, GET /api/templates/:id |
| crear (automatizaciones)  | crear.ts       | GET /api/recipes, POST /api/recipes, PATCH /api/recipes/:id |
| vender                    | vender.ts      | GET /api/content (calendar + attribution), GET /api/comments-share |
| configuracion             | configuracion.ts | GET /api/workspaces, PUT /api/workspaces/:id, GET /api/fonts/custom, GET /api/storage/usage |
| medir                     | medir.ts       | GET /api/metrics/activity, GET /api/storage/usage          |
| planear                   | planear.ts     | GET /api/content, GET /api/copy-recipes, GET /api/research/sources, GET /api/research/items |
| agentes                   | agentes.ts     | GET /api/ghost/jobs, /api/ghost/jobs/:id, /api/ghost/summary (router aditivo nuevo) |
| conversar                 | conversar.ts   | GET /api/content/inbox (integraciones sociales conectadas)  |
| organizacion              | organizacion.ts | GET /api/workspaces, POST /api/workspaces/:id/members      |

## Estado

- [x] client.ts (base: reenvío tipado sobre apiFetch)
- [x] inicio.ts / crear.ts / vender.ts / configuracion.ts / medir.ts / planear.ts /
      conversar.ts / organizacion.ts / agentes.ts
- [x] Router aditivo /api/ghost/* (ghostJobs.ts) para la vista agentes
- [ ] gaps anunciar (~15%): publicar/agendar ya existe en /api/content (POST, /:id/publish,
      /:id/sync) — el gap es de UI; NEEDS.md recogerá lo que pida el agent
