# REQ-021 — Marca del panel Info como dropdown + alta in-place + sincronización total (CRM/grafo/panel)

**Fecha:** 2026-08-28 · **Estado:** implementado · **Migración:** ninguna (reutiliza `brands` existente)

## Problema

1. En el panel de información del editor, Marca era un input editable con datalist: el usuario quería un **dropdown cerrado** con todas las marcas actuales + una opción para **agregar** una nueva desde ahí.
2. Una marca agregada en el panel debía aparecer en el **CRM**.
3. Una marca agregada en el CRM debía aparecer en el **grafo**, en el **panel de información** y en todo lo sincronizado.

## Diagnóstico

Ya existe una única fuente de verdad: la tabla `brands`. El CRM (`GET /api/workspaces/:id/crm`), la taxonomía del panel (`GET /api/meta/:id/taxonomy`), el grafo (`GET /api/graph` — devuelve TODAS las marcas, tengan diseños o no, y `buildDesignHierarchy` crea un nodo por cada una) y el Red de Marcas (`/api/brand-graph`) leen de ahí. El único gap era el UX del panel y que sus marcas nuevas no pasaban por el endpoint del CRM (que además crea el archivo Design System de la marca).

## Solución

### Panel Info (FileInfoPanel.tsx)

- Marca pasa a ser un `<select>` con todas las marcas del workspace (resuelve por `brand_id`, con fallback por nombre para rows legacy) + opción final **«➕ Agregar marca nueva…»**.
- Elegir esa opción despliega un mini-form (input + Crear + cancelar; Enter crea). Al crear:
  - Dedupe local case-insensitive: si ya existe, solo la linkea (evita pisar campos CRM del endpoint).
  - Si es nueva: `POST /api/workspaces/:id/brands` — **el mismo endpoint que usa el CRM**, así la fila es idéntica: aparece en CRM, en el grafo (con su archivo Design System auto-creado, salvo `futuraria-auto-design-system=false`) y en todos los dropdowns.
  - La marca queda seleccionada para el archivo (`scheduleSave` con `brand_id` + nombre).
- La taxonomía se extrajo a `loadTaxonomy` (reutilizable) y ahora también devuelve/ataja el `workspaceId` del template.

### API (designMeta.ts)

- `GET /api/meta/:id/taxonomy` incluye `workspaceId` en la respuesta (el panel lo necesita para el POST del CRM).

### CRM → grafo/panel

Sin cambios: ya estaba sincronizado por la tabla única (el grafo lista todas las marcas; el panel y el CRM recargan al montarse).

## Archivos

| Archivo | Cambio |
|---|---|
| `src/components/FileInfoPanel.tsx` | select + alta in-place reusando el endpoint del CRM; `loadTaxonomy` extraída |
| `api/src/routes/designMeta.ts` | taxonomy devuelve `workspaceId` |
| `docs/requirements/REQ-021-brand-dropdown-y-sincronizacion.md` | este doc |

## Verificación

- `npm run build` ✓ (13.77s) · `api` `tsc --noEmit` ✓.
- En producción: panel Info → Marca muestra el dropdown; «➕ Agregar marca nueva…» → nombre → Enter crea la marca, la selecciona y aparece en Contactos → CRM y en el grafo (Red de Marcas) sin recargar nada más.
