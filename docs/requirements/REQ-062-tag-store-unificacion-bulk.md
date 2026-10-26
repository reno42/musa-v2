# REQ-062 — Tags y filing de marca: un solo store + operaciones bulk

- **Status:** Implementado (Fases 1-3 + QA, 2026-10-26). Deploy pendiente: Ren revisa los commits y corre el backfill. Fase 4 (opcional) descartada por ahora — el backfill elimina el caso que cubría.
- **Priority:** Alta (los agentes MCP pierden tiempo/tokens en workarounds; los tags escritos por `tag_template` son invisibles para las queries)
- **File:** `worker/runtime/functions/mcp.mjs` — cases `tag_template` (L22200-22227), `untag_template` (L22229-22244), `find_templates` (L22246-22366, query en L22253-22262), `set_file_meta` (L22392+)
- **Relacionado:** REQ-061 (taxonomía second brain), `api/src/services/brandFiling.ts` (`resolveTemplateOwners`), `api/src/services/brandGraph.ts` (L410-438, huérfanos)

## Problema (evidencia, sesión 26 Oct 2026)

Workspace `ws_user_8e9f031817184e0ab205`, 351 templates, 237 huérfanos. Un agente intentó asignar marca Futuraria a todos vía MCP y chocó con 3 defectos:

### 1. `tag_template` y `find_templates` leen stores DISTINTOS

- `tag_template` escribe el array `tags` en la **fila del template** (`templates.tags`, vía `updateTemplate`, L22224).
- `find_templates` (path Supabase-first, L22255) consulta `design_file_meta.tags` — **ignora** `templates.tags` salvo que la query a Supabase falle y caiga al fallback in-memory (L22314, donde sí lee `templates.tags`).
- El design graph (`get_brand_graph`) resuelve dueño vía `design_file_meta.brand_id/brand` (`resolveTemplateOwners`), no vía tags.

**Repro verificado en vivo:**
1. `tag_template {templateId:"tpl_a82ec5f8-808", tags:["brand:futuraria"]}` → `{added:["brand:futuraria"]}` OK.
2. `get_template` → `tags:["brand:futuraria"]` persistido.
3. `find_templates {brand:"futuraria"}` → `total: 0` (la fila no existe en `design_file_meta`).
4. `get_brand_graph` → el template sigue en `orphans`.

El agente que confía en la descripción de `tag_template` ("Tags enable the design graph and find_templates") llega a una conclusión falsa: cree que asignó la marca. La descripción es incorrecta HOY.

### 2. Sin operación bulk: N templates = N llamadas

`tag_template`, `untag_template`, `set_file_meta` procesan UN template por llamada. Caso real: 237 archivos → 237 llamadas. Por tool_call nativo el loop secuencial supera cualquier timeout razonable; el agente termina escapando a curl subprocess en paralelo (workaround documentado en skills, camino sucio: salta auth central, snapshots, rate limits del MCP).

### 3. Datos legacy huérfanos para find_templates

Templates taggeados antes de REQ-061 (solo `templates.tags`, sin fila en `design_file_meta`) son invisibles para `find_templates` Supabase-first para siempre. No hay backfill.

## Solución

### Fase 1 — Unificar el store de tags (core fix)

`tag_template` / `untag_template` dejan de escribir `templates.tags` como store primario y pasan a operar sobre `design_file_meta.tags` (upsert de la fila meta si no existe, merge/remoción sobre el array existente). Mantener la escritura espejo en `templates.tags` SOLO si algún consumidor legacy la lee — verificar consumidores; si no hay, dropear el espejo.

Cambios puntuales en `mcp.mjs`:

```js
// tag_template — reemplazar updateTemplate({tags}) por upsert de meta
const sbTag2 = getSupabase();
const { data: meta } = await sbTag2.from("design_file_meta")
  .select("tags").eq("template_id", params.templateId).maybeSingle();
const existing = meta?.tags || [];
const merged = [...new Set([...existing, ...incoming])];
await sbTag2.from("design_file_meta").upsert({
  template_id: params.templateId,
  workspace_id: wsId,               // resolver igual que set_file_meta L22396-22398
  tags: merged,
}, { onConflict: "template_id" });
```

- `untag_template`: mismo patrón con `filter`.
- Corregir la description de `tag_template`: los tags NO asignan marca en el graph — para eso es `set_file_meta({brand})`. Decirlo explícito para no inducir al error del Repro.
- `get_file_meta` sigue igual (ya lee la tabla canónica).

### Fase 2 — Backfill one-time (migración)

Llenar `design_file_meta` desde `templates.tags` donde no exista fila o tenga `tags` vacío (tipo de columna `templates.tags` a confirmar: jsonb o text[]):

```sql
insert into design_file_meta (template_id, workspace_id, tags)
select t.id, t.workspace_id, t.tags
from templates t
where coalesce(jsonb_array_length(t.tags), 0) > 0
on conflict (template_id) do nothing; -- no pisar meta existente
```

Script idempotente en `scripts/`, NO correr el set completo de migraciones contra prod (drift histórico).

### Fase 3 — Bulk (menos tokens, menos llamadas)

Dos tools nuevas (o params array en las existentes — preferimos tools explícitas):

- `set_files_meta {workspaceId, templateIds: string[], brand?, tags?, category?, ...}` — mismo contrato de `set_file_meta`, aplica el mismo patch a N ids (cap 500/call). Respuesta: `{applied: n, failed: [{templateId, error}]}`.
- `tag_templates {templateIds, tags, remove?: boolean}` — merge/remove sobre `design_file_meta.tags` en lote.

Esto convierte el caso de hoy (237 archivos → 1 marca) en UNA llamada en vez de 237 curl.

### Fase 4 (opcional) — find_templates defensivo

En el path Supabase-first, si `rows.length === 0` y NO se pasó ningún filtro, hacer merge con templates que tengan `templates.tags` y sin fila meta (o confiar en que Fase 2 elimina el caso). Solo si el equipo prefiere cinturón y tirantes además del backfill.

## Plan de implementación por fases (commit por fase, SIN push — Ren revisa)

1. Fase 1 + corrección de descriptions → commit `fix(mcp): tag_template operates on design_file_meta (single tag store)` → **b0f1891**.
2. Fase 2 backfill script (no ejecutar contra prod sin OK de Ren) → commit `chore(db): backfill design_file_meta.tags from legacy templates.tags` → **f2b51a3**.
3. Fase 3 bulk tools + schemas en el tools/list → commit `feat(mcp): bulk file-meta and tagging tools` → **7b1cdf1**.
4. QA tests: extender `QA/` con test del Repro (tag → find_templates lo encuentra; tag NO asigna marca en graph; bulk de 3 ids crea 3 filas) → **QA/req062-tag-store-unificacion.test.mjs, 16/16**.

## Notas de implementación (hallazgos del repo, 2026-10-26)

- `templates` **NO tiene columna `tags`**: el mirror vivía dentro del blob JSONB (`templates.data->'tags'`), escrito por el `updateTemplate` del tag_template viejo. El sketch SQL de la Fase 2 se corrigió a `jsonb_array_elements_text(t.data->'tags')` → `TEXT[]` (schema v4: `design_file_meta.tags TEXT[]`, `UNIQUE(template_id)`).
- El mirror no era solo inútil: cada tag pagaba un **upsert del blob completo del diseño** (varios MB, timeout 8s). Fase 1 lo elimina; también `autoSnapshot` (taggear es metadata, no contenido — `set_file_meta` nunca snapshotteó).
- `set_file_meta` se refactorizó a `resolveFileMetaPatch` — el MISMO contrato sirve a `set_files_meta` (un solo lugar donde derivarlo).
- Fix colateral detectado por el QA: `resolveTagAliasesForWrite` ahora deduplica **después** de sustituir alias — antes, un alias cuyo canónico ya estaba en la lista guardaba el tag duplicado en el path REPLACE.
- Bulk: cap 500/call, chunks de 100 con reintento por fila (`failed` granular), workspace de N ids resuelto en 1 query y registry/alias 1 vez por workspace.
- E2E real (checklist item 5) queda para post-deploy: template desechable → tag → find → bulk → untag → delete + purga.

Deploy: `npx wrangler deploy` tras confirmar que el working dir = lo que se quiere en prod (GitHub NO despliega). Backfill: SQL Editor, SOLO `scripts/backfill-design-file-meta-tags.sql` (dry-run → paso 1 → paso 2 → verificación con 0 pendientes).

## Verificación

1. Repro de arriba end-to-end: `tag_template` → `find_templates {tags:["brand:..."]}` devuelve el template → `get_file_meta` muestra el tag.
2. `tag_template` NO debe poner el archivo bajo una marca en `get_brand_graph` (tags ≠ brand) — semántica explícita.
3. `set_files_meta` de 3 ids con `brand:"Futuraria"` → 3 filas en `design_file_meta` con `brand_id` linkeado → `get_brand_graph` los muestra bajo Futuraria.
4. `untag_template` quita del meta y `find_templates` deja de devolverlo.
5. E2E real post-deploy: crear template desechable → tag → find → bulk → untag → delete_template. Limpiar los templates de QA (delete es SOFT: purgar row + versions).
