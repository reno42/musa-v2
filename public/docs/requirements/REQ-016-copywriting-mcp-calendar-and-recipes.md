# REQ-016 — Copywriting por MCP: ideas en el calendario + recetas de escritura

- **Status:** Done (implementado 27 Ago 2026)
- **Priority:** P1 — flujo copywriting completo humano+IA sobre el calendario existente
- **Files:**
  - `supabase_migrations_v32.sql` — tabla `copy_recipes` (+ `.migration-version` → v32)
  - `api/src/routes/copyRecipes.ts` — REST CRUD `/api/copy-recipes` (+ registro en `api/src/index.ts`)
  - `netlify/functions/mcp.mjs` — 8 tools nuevas (catálogo 241 → 249)
  - `src/components/CopyRecipesTab.tsx` — panel "Recetas"
  - `src/components/ContentTab.tsx` — pestaña Recetas junto a Copys

---

## Problema

La sección de copywriting no tenía cobertura MCP: el calendario (`content_calendar`, v22) tenía REST CRUD completo y tres vistas UI (Calendario/Contenidos/Reportes) pero **cero tools** — una IA no podía poner ideas ni redactar copys. Y no existía biblioteca de escritura: las `recipes` existentes son de diseño (key visuals html/css), inadecuadas para hooks/tonos/frameworks.

## Solución

1. **Calendario vía MCP (4 tools):** `list_calendar_entries` (filtros fecha/estado/tipo), `add_content_idea` (fila status='idea', copy vacío — aparece en Calendario y Contenidos sin tener contenido, exactamente lo pedido), `update_content` (llena copy, mueve status idea→diseño→aprobación→programado→publicado, adjunta templateId), `delete_content`. La "sincronización" con la tabla de contenidos es gratis por arquitectura: son la misma tabla.
2. **Recetas de escritura (tabla nueva + 4 tools):** `copy_recipes` (hook|tono|framework|otro, name, content, tags, source humano|ia) separada de `recipes` de diseño porque la forma es distinta (texto instruccional vs markup). Tools: `list_copy_recipes` / `create_copy_recipe` / `update_copy_recipe` / `delete_copy_recipe` — CRUD idéntico para humano e IA, así el usuario puede mandar a su IA a buscar frameworks por internet y guardarlos.
3. **UI:** pestaña "Recetas" al lado de "Copys" en ContentTab, con CRUD optimista y lenguaje visual de tabla de marca (mismo criterio que Contenidos: es entrada de datos). El origen "ia" se distingue con badge.
4. **Docs/skills:** SKILL.md y tools_catalog.json regenerados (249), counts estáticos actualizados en mcp.json/README/INSTALL/ROADMAP/api-SKILL/Landing/AiConnectPrompts; corregida además una referencia vieja "Configuración → API Keys" → "API MCP" en mcp.json.

## Seguridad

- `authorizeMcpCall` inyecta el workspace de la API key; tools id-based releen la fila y comparan workspace (un id ajeno lee "not found", nunca la fila de otro).
- RLS en `copy_recipes`: viewer lee, editor escribe (`has_workspace_role`, mismo patrón que v22).
- Fechas validadas (YYYY-MM-DD), statuses/kinds/tipos normalizados contra listas cerradas.

## Verificación

1. `node --check netlify/functions/mcp.mjs` ✓ · `npm run sync:skill` → "Parsed 249 tools" ✓.
2. Ejecutar `supabase_migrations_v32.sql` en producción + Reload schema cache (`.migration-version` ya en v32).
3. `add_content_idea` → aparece en Calendario y Contenidos con copy vacío; `update_content` con copy → la celda se llena.
4. `create_copy_recipe` desde MCP → visible en la pestaña Recetas con badge "IA"; edición desde la pestaña → visible para `list_copy_recipes`.
