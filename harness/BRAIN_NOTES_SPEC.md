# BRAIN_NOTES_SPEC — el second brain del Grafo

> Spec v1 (2026-09-05). Cómo el sistema convierte eventos en notas MD con
> wikilinks (estilo Obsidian), cómo las leen las IAs y qué protege lo humano.

## 1. Modelo

Tabla `brain_notes` (migración v47): `slug` único por workspace, `body_md`,
`links[]` (slugs enlazados), `entity_type`/`entity_id` (anclaje a la entidad
viva: brand / template / campaign / deal / task), `source` (`system | human |
agent`).

- **El grafo no cambia de naturaleza:** las entidades (marcas, archivos,
  campañas) siguen siendo nodos DB-driven. Las notas son la **capa de
  conocimiento**: click en una entidad abre su nota (MD renderizado +
  backlinks). Notas sin entidad = nodos tenues.

## 2. Emisores (server-side, idempotentes)

Cada emisor es un upsert por `(workspace_id, slug)`:

| Evento | Nota (slug) | Links |
|---|---|---|
| Marca creada | `marca-{slug}` | `[[ds-{marca}]]`, `[[comunicacion-{marca}]]` |
| DS publicado/actualizado | `ds-{marca}` (desde DESIGN.md + tokens) | `[[marca-{marca}]]` |
| Plantilla curada | `plantillas-{marca}` | `[[marca-{marca}]]` |
| Estrategia actualizada | `comunicacion-{marca}` | `[[marca-{marca}]]` |
| Deal movido / interacción | append a `marca-{marca}` | — |
| Task Kanban completada | `task-{id}` | `[[marca-*]]` |
| Cron nocturno (Musa) | `patrones-{marca}` | `[[marca-{marca}]]`, tasks |

## 3. Bloques humanos protegidos

Las notas generadas distinguen dos zonas:

```markdown
<!-- generated -->
Datos CRM: 3 deals abiertos, último contacto hace 5 días…
<!-- /generated -->

<!-- human -->
Notas de Renzo: el cliente prefiere facturar por hitos…
<!-- /human -->
```

Regla: **regenerar actualiza solo `<!-- generated -->`**; los bloques
`<!-- human -->` (y `<!-- agent -->`) se preservan tal cual entre
regeneraciones. Sin bloques humanos previos, el upsert escribe toda la nota.

## 4. Acceso para IAs (nunca la DB directa)

- `read_note { workspaceId, slug }` → MD con `[[links]]` resueltos a títulos.
- `search_notes { workspaceId, query }` → top-k por trigram (índice gin de v47).
- `brain_digest { workspaceId, entityType, entityId }` → la nota de la entidad
  + backlinks, recortada a lo esencial.

Las escrituras SIEMPRE vía emisores o tools — nunca MD libre: el grafo se
degrada si las IAs improvisan notas.

## 5. Convenciones

- Slug: kebab-case, ASCII, prefijado por tipo (`marca-`, `ds-`, `task-`…).
- Wikilink: `[[slug]]`; el renderer resuelve a título; links muertos se
  muestran tenues (Obsidian style), nunca error.
- Notas de patrones: SOLO el cron las escribe (agregación LLM batch, nocturna);
  los emisores transaccionales nunca invocan LLM.
