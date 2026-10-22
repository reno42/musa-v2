# REQ-VID10..14 — Módulo Video standalone: modelo CapCut, drag & drop y mobile

- **Status:** VID10 Done (fase A) · VID11 Done (fase B) · VID12/13/14 Done
  (fases C–E, 13 Oct 2026). `video_render` sigue stub hasta VID1–VID5.
- **Source:** `REQ Video CapCut-Model - Drag Drop y Mobile.md` (ObsidianRen/1-Framework-Futuraria, Hermes 12-oct-2026) + doc de referencia `3-Proyectos/Musa - Video Editor y Templates - Modelo CapCut.md` (schema draft_content.json + gotchas)
- **Pre-requisito:** VID7 (REQ-014, `set_animation` no persistía por lost-update de `autoSnapshot`) — **ya resuelto** (27 Ago 2026): `autoSnapshot` es memory-only y `set_animation` chequea el retorno de `updateTemplate`.

---

## Qué es (y qué NO es)

El módulo Video **standalone**: tablas propias `musa_video_*` donde la IA (MCP
tools `video_*`) y el humano (UI drag & drop) escriben **LAS MISMAS tablas**.
Convive con el Video Mode de templates existente (`templates.data` JSONB, en
segundos, tomas = frames de diseño): ese NO se migra; un puente futuro podrá
exportar un reel de template → video project.

## Reglas duras (heredadas de los gotchas de CapCut)

1. TODO el tiempo en **microsegundos** (BIGINT). Prohibido guardar segundos.
2. Posiciones normalizadas **-1..1** (centro=0,0); scale 1.0 = tamaño source.
3. Segmento de **audio ⇒ `clip: null`** (un clip object en audio crashea CapCut).
4. Regla de oro: **`source_dur_us = round(target_dur_us × speed)`**.
5. **Companions por referencia**: efectos/velocidad/máscaras/fades viven en
   `materials` y se referencian via `extra_refs[]` (mismo project, integridad
   en el servicio — no FK).
6. **Trim clampado** al fin del source (nunca pasa el fin del material).
7. `tracks.z_order` **ascendente = de abajo hacia arriba**.
8. Texto estilado **por rangos de caracteres** (`payload.ranges`), nunca blob.

## Fase A — VID10: modelo de datos + MCP (DONE)

- **Migración v73** (`supabase_migrations_v73.sql`): `musa_video_projects` /
  `musa_video_tracks` / `musa_video_segments` / `musa_video_materials`. Ids
  TEXT prefijados (`vidproj_/vidtrk_/vidseg_/vidmat_`), µs BIGINT, CHECKs de
  formato, RLS viewer-read/editor-write (`has_workspace_role`, patrón v61).
  Las invariantes 3/4/5/6 las aplica el servicio (cruzan tablas).
- **Servicio compartido** `api/src/services/videoProjects.ts`: validadores
  puros (`validateUsInt`, `normalizeClipTransform`, `sourceDurForTarget`,
  `resolveEffectPayload`, `validateMaterialPayload`...) + store. Una sola
  implementación para MCP y REST (cero drift). Errores con **código estable**
  (`TIME_INVALID`, `SPEED_MISMATCH`, `AUDIO_CLIP_FORBIDDEN`,
  `REF_FOREIGN_PROJECT`, `TRIM_PAST_SOURCE`, `SLOTS_MISSING`...) para que la
  IA se autocorrija.
- **MCP tools** (mcp.mjs): `video_project_create/list/get/delete`,
  `video_track_add`, `video_material_add`,
  `video_segment_add/move/trim/transform/delete`, `video_effect_apply`,
  `video_template_register`, `video_template_instantiate`, `video_render`
  (stub honesto `RENDER_PENDING` hasta el pase de render, dependiente de
  VID1–VID5). Tenant de `projectId` resuelto en DB en `authorizeMcpCall`
  (mismo criterio que flows) — una workspace key no cruza tenants.
- **REST** `/api/video-projects` (`api/src/routes/videoProjects.ts`, montado
  con `requireUserSession`): lista/crea/árbol/borra + tracks/materials/
  segments (`PATCH` = move|trim|transform) + effects + register-template +
  instantiate. Gate por rol del ROW (viewer GET / editor escritura).
- **QA**: `QA/req-vid10-video-model.test.mjs` (unit de validadores + asserts
  de source/migración) + E2E desechable contra dev local en `.tmp/`.

## Fase B — VID11: drag & drop (DONE)

Timeline del project standalone, una fila por track (z_order real), **pointer
events only** (`pointerdown/move/up` — nada de mouse-only ni HTML5 drag):
drag de bloque → `target_start_us`; drag de borde → trim (recalcula source
respetando speed, clamp al fin del source); snap magnético (tolerancia 8px, a
bordes de clips/playhead/marcas de 1s) con línea de alineación visible; scrub
continuo; click = selección → inspector con segment + companions; zoom visual
px/µs (slider + Ctrl+rueda); undo/redo con journal por operación semántica
(patrón `videoDocStore`); feedback continuo mientras se arrastra (duración en
el bloque + tooltip de timecode).

## Fase C — VID12: mobile (DONE)

Mismo código React, responsive ≤768px: tap = selección con handles gruesos
(≥44px targets en todo), paneles como **bottom sheets**, toolbar inferior
contextual (sin selección = agregar; clip de video = split/velocidad/efecto;
texto = estilo), pinch = zoom del timeline, drag vertical en zona vacía =
scroll de tracks, preview fullscreen con scrub nativo. Verificar en DevTools
390px + dispositivo real. QA en navegador (13 Oct 2026) detectó y corrigió la
persistencia de velocidad: `diffTreeOps` no emitía ops para `speed` → autosave
adoptaba el doc sin PATCH (badge "Guardado" mentiroso, cambio perdido al
recargar). Fix: diff emite `segment.patch {speed}`, PATCH gana rama `speed`
(service `setSegmentSpeed`: source físico con la speed vieja, target
re-derivado con la nueva) + 2 tests de regresión en vid12.

## Fase D — VID13: templates con slots (DONE)

Materiales marcados con `slot {key,label}` (video/text/audio) →
`video_template_register` → `video_template_instantiate(templateId, slots{})`
clona y llena (target se mantiene, source se recalcula al nuevo material con
clamp). Tools registradas en la fase A; flujo UI hecho en
`VideoProjectsTab.tsx` (badge Plantilla + botón Usar plantilla → diálogo con
formulario de slots, segundos→µs). Importador one-off hecho:
`scripts/import-capcut-draft.mjs` (µs passthrough, texto double-encoded,
`extra_material_refs` → companions effect/sticker, síntesis de textos overlay,
materials dict, warn de drafts cifrados; dry-run por defecto, `--apply` vía
PostgREST).

## Fase E — VID14: efectos como plugins (DONE)

Contrato manifest JSON estilo lumi `{name, type, zorder, scriptPath?,
resources{}}` guardado como material kind=effect (YA implementado en
`video_effect_apply`). Fase 1 sin shaders: `fx-overlay`, `fx-lut`,
`fx-text-anim`, `fx-sticker-kf` (catálogo builtin en
`api/src/services/videoProjects.ts`, espejado cero-drift en
`src/lib/videoEffects.ts`). Preview hecho en el player del project standalone
(`VideoPreview` monta companions: LUT = CSS filter, overlay = blend, caption =
clases `vp-fx-anim-*`, sticker = keyframes lerp). `EffectPicker` server-first
(POST /effects). Shaders quedan para una fase 2.

## Aceptación (REQ §8)

- [x] Crear project por MCP con 2 tracks + 3 segments + 1 efecto → persiste y
  se re-abre igual (E2E local, fase A).
- [x] UI: mover/trim/snap con drag → JSON refleja µs exactos; undo funciona
  (fase B; `QA/req-vid11-video-timeline.test.mjs`, 17 tests).
- [x] Vista móvil 390px: seleccionar, trim con handles, bottom sheet, scrub
  (fase C; `QA/req-vid12-video-mobile.test.mjs`, 15 tests; smoke visual en
  DevTools 390px + dispositivo real queda para revisión humana).
- [x] Template con 3 slots → instanciar con otros materiales (fase D;
  `QA/req-vid13-video-templates.test.mjs`, 14 tests).
- [x] Preview de efectos en el player (fase E; `QA/req-vid14-video-effects.test.mjs`,
  14 tests, cero-drift catálogo cliente≡servicio).
- [x] NINGÚN dato en segundos; ningún drag que no use pointer events
  (vid10/11/12 lo aseguran: `doesNotMatch(/\btouchstart\b|\btouchmove\b/)`,
  µs en todo el schema).

## Orden de implementación (dependencias reales)

1. ~~VID7 (REQ-014) — bloqueante~~ ✔ resuelto.
2. **VID10** ← esta fase (todo lo demás vive encima).
3. ✔ VID11 → 4. ✔ VID12 → 5. ✔ VID13/VID14 (fases B–E completadas; cadena
   QA vid10–vid14: 87 tests verdes vía `npm run test:regression`).
6. VID1–VID5 siguen siendo prerequisito del RENDER (`video_render` hoy es
   stub); el timeline se construye y prueba con preview antes.
