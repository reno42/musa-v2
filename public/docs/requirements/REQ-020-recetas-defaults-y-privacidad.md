# REQ-020 — Recetas: alta con solo el nombre + 10 frameworks default + privacidad por usuario

**Fecha:** 2026-08-28 · **Estado:** implementado · **Migración:** `supabase_migrations_v33.sql` (requiere ejecutar en producción + Reload schema cache)

## Problema

1. Agregar una receta exigía nombre **y** contenido: fricción innecesaria para capturar una idea rápida.
2. Toda cuenta nueva arrancaba con la biblioteca vacía — había que saber de copywriting o pedirle a la IA que trajera frameworks.
3. Las recetas eran visibles a nivel workspace; no existía la noción de "esto es mío".

## Solución

### 1) Alta mínima (humano)

- `CopyRecipesTab`: **Enter** en Nombre o Tags crea la receta de una (Ctrl/Cmd+Enter en el textarea). El botón `+ Agregar` se habilita con solo el nombre; el contenido queda opcional y se completa inline después.
- `POST /api/copy-recipes` y `create_copy_recipe` (MCP) aceptan `content` vacío (solo `name` obligatorio).

### 2) 10 frameworks default para TODAS las cuentas

Sembrados por la migración (id fijo `crx_def_*`, idempotentes con `ON CONFLICT DO NOTHING`):

AIDA · PAS · Antes–Después–Puente · Las 4 P · FAB · StoryBrand SB7 · PASTOR · Hook–Historia–Oferta · Las 4 U (hook) · ACCA.

Cada uno con estructura + ejemplo en español, tipo `framework` (9) + `hook` (1).

### 3) Privacidad por usuario (columnas nuevas en `copy_recipes`)

- `is_default BOOLEAN NOT NULL DEFAULT FALSE` — TRUE = default de fábrica, **solo lectura** para todos (editar uno cambiaría el de todas las cuentas).
- `owner_id UUID → auth.users(id) ON DELETE CASCADE` — dueño de la receta personal.
- **Backfill:** rows v32 sin owner → pasan al owner del workspace.
- **RLS v33:** SELECT = `is_default OR owner_id = auth.uid()`; escritura = `NOT is_default AND owner_id = auth.uid()`. Lo personal es exclusivo del usuario (ni compañeros de workspace lo ven).

## Archivos

| Archivo | Cambio |
|---|---|
| `supabase_migrations_v33.sql` | columnas, backfill, índices, RLS, 10 seeds |
| `api/src/routes/copyRecipes.ts` | GET = defaults+propias; POST estampa `owner_id` y acepta content vacío; PATCH/DELETE bloquean defaults y rows ajenas; `42703` → mensaje de setup v33 |
| `src/components/CopyRecipesTab.tsx` | Enter agrega; badge «Default» ámbar; rows default deshabilitadas y sin × |
| `netlify/functions/mcp.mjs` | list = defaults+propias (filtro owner explícito: API key viaja por cliente admin sin RLS); create estampa owner y acepta content vacío; update/delete bloquean defaults/ajenas; descripciones de los 4 tools |
| `SKILL.md`, `tools_catalog.json` | regenerados (250 tools) |
| `.migration-version` | v33 |

## Verificación

- `npm run build` ✓ (14.25s) · `api` `tsc --noEmit` ✓ · `node --check mcp.mjs` ✓ · `sync:skill` ✓ (250).
- En producción (tras correr v33): la tabla Recetas muestra las 10 defaults con badge ámbar y bloqueadas; una receta nueva con solo nombre aparece arriba editable; otra cuenta NO la ve; MCP `list_copy_recipes` devuelve defaults + propias.
