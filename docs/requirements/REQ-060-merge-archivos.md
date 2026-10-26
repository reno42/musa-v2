# REQ-060 — Merge de archivos (fusión de 2+ templates en uno)

**Estado:** Fase 1 implementada (MCP + REST + UI). · **Fecha:** 2026-10-26 · **Migración:** ninguna (opera sobre `templates.data` JSONB).

## 1. Problema

El usuario acumula archivos con frames relacionados (versiones, variantes, entregas por partes) y hoy los consolida a mano: duplicar frames uno a uno o pedirle a la IA que reescriba el contenido — costoso en tokens y destructivo. Se necesita una **función de harness**: fusionar N archivos en uno, sin sobrescribir nada, disponible igual para humanos (UI) e IAs (MCP).

## 2. Contrato (Fase 1)

* **Orden determinista**: los frames se agregan en el orden de `sources`; los frames del target (modo append) quedan intactos.
* **Remap de ids**: cada frame recibe id fresco (`f_mg*`); `manifest[sourceId]` lista `{from, to, dedupOf?}` por frame (`to: null` cuando fue deduplicado).
* **Transiciones**: `frame.animation.transitions[].toFrameId` se remapea si el frame referenciado viajó; si no, se descarta y se cuenta en `droppedTransitions`.
* **Estilos/variables**: unión first-wins con reporte de conflictos en `conflicts.{styles,variables}`.
* **Dedupe opcional** (`dedupe: "skip"`): hash de contenido (excluye id/name/layerId/timestamps); las copias se descartan con rastro en manifest.
* **videoTimeline**: default `keep-target` (avisa `VIDEOTIMELINE_DROPPED`); opt-in `concat` desplaza los clips de cada fuente por la duración efectiva acumulada.
* **No destructivo**: las fuentes no se tocan aquí; el snapshot pre-merge reusa el servicio de versiones (versión marcada snapshot antes del append).
* **Límite**: payload > 8 MB se rechaza con warning `PAYLOAD_TOO_LARGE` en el plan.

## 3. Implementación

* **Core compartido** `shared/templatesMerge.ts` — funciones puras, cero I/O: `normalizeMergeSources`, `collectSourceFrames`, `frameContentHash`, `effectiveDurationSec`, `planTemplateMerge`, `executeTemplateMerge`. Un solo implementation para ambos runtimes (el worker bundea `shared/*.ts`; la API lo importa directo).
* **MCP** (`worker/runtime/functions/mcp.mjs`): `templates_merge_plan` (dry-run: perSource, warnings, duplicados, conflicts, estimatedBytes, videoTimeline) y `templates_merge` (ejecuta y persiste; `mode: new|append`, `delete_sources` opcional).
* **REST** (`api/src/routes/templates.ts`): `POST /api/templates/merge-plan` y `POST /api/templates/merge` (schemas en `api/src/middleware/validate.ts`).
* **UI** (`src/components/Dashboard.tsx`): sub-tab Diseño → Archivos → botón «Seleccionar» → multi-selección en tarjetas → barra con contador y «⧉ Fusionar» → modal con plan preview (frames por fuente, duplicados, warnings), nombre, append/opciones y confirmación.

## 4. Fuera de alcance (Fase 2)

* Des-merge / revertir desde el manifest (la versión snapshot ya permite restore manual).
* Fusionar estilos con resolución de conflictos interactiva (hoy first-wins + reporte).
* Merge de video con transiciones entre archivos (hoy concat por pistas).
* Dedupe difuso (solo hash exacto).
