# REQ-022 — Popup de formatos al crear archivo + archivos con 0 frames

Fecha: 2026-08-28

## Problema

1. Crear un archivo en Diseño → Archivos nacía siempre con un frame 1080×1080
   sorpresa. Si el usuario (o la IA) quería otra medida, había que crear un
   segundo frame y borrar el primero: pasos extra y, para las IAs, tokens
   quemados en un ciclo create→delete.
2. El editor bloqueaba borrar el último frame (`deleteFrames` devolvía false con
   `updated.length === 0`), y el usuario percibía una traba ("acá no puedo
   hacer más"). Peor: un archivo persistido con `frames: []` resucitaba un
   frame fantasma 1080×1080 al recargar porque el `load()` trataba el array
   vacío como "template legado" y fabricaba un frame con DEFAULT_HTML.

## Solución

### Humano (UI)

- **Popup de nuevo archivo** (Dashboard): el input inline de solo-nombre pasó a
  ser un modal con nombre + dropdown de 9 presets de social media
  (Instagram cuadrado/vertical, Story/Reel/TikTok, Facebook, X, LinkedIn,
  YouTube, Pinterest, Web HD) + Personalizado (ancho/alto libres, 1–10000) +
  "Empezar en blanco (sin frames)". Enter crea, Escape/backdrop cierra.
- **Estado vacío del editor**: con 0 frames el lienzo muestra una tarjeta
  "Este archivo está vacío" con el mismo selector de formatos y botón
  "+ Agregar frame" (reusa `handleCreateFrameAt`), además del hint de la
  herramienta Frame (F).
- **Borrar el último frame** ahora es válido: se quitó el guard de
  `deleteFrames`; el toast de corte dejó de mentir sobre "al menos un frame".
- **Load y polling**: `frames: []` se carga tal cual (solo los templates SIN la
  clave `frames` caen al camino legado de un solo frame), y el polling de
  fallback ya no "recupera" re-guardando frames locales contra un remoto
  legítimamente vacío; acepta el estado remoto (solo corre cuando no hay
  cambios sucios locales).

### API

- `POST /api/templates` acepta `initialFrame: boolean` (default true). Con
  `false` + `engine:"html"` el archivo se crea con 0 frames (el store ya
  inicializa `frames: []`). Zod: `createTemplateSchema.initialFrame`.

### MCP (todo sigue siendo MCP)

- `create_template` acepta `initialFrame` (default true). `false` → archivo con
  0 frames; la IA agrega el primer frame con `create_html_frame` (que ya acepte
  width/height) o `set_frame_layers`. Descripción del tool actualizada para que
  las IAs pasen width/height del formato objetivo desde el inicio.
- `delete_frame` ya permitía borrar el último (sin guard server-side); su
  descripción ahora lo documenta explícitamente.
- Catálogo re-sincronizado: 250 tools, live en acuerdo.

## Archivos

- `src/lib/socialFormats.ts` (nuevo) — presets compartidos + clamp 1–10000.
- `src/components/Dashboard.tsx` — popup modal, props con opts.
- `src/App.tsx` — `handleCreateHtmlTemplate` reenvía width/height/initialFrame.
- `src/pages/EditorV2.tsx` — load 0-frames, guard de borrado, polling, estado
  vacío.
- `api/src/middleware/validate.ts`, `api/src/routes/templates.ts` — initialFrame.
- `netlify/functions/mcp.mjs` — create_template (handler + schema) y
  delete_frame (descripción).
- `SKILL.md`, `tools_catalog.json` — regenerados.

## Verificación

- `npm run build` verde (21.13s), `api` `tsc --noEmit` limpio, `node --check`
  mcp.mjs OK, `sync:skill` 250/250 en acuerdo con producción.

### Prueba manual sugerida

1. Diseño → Archivos → "+ Nuevo archivo" → elegir "Story / Reel / TikTok" →
   Crear → el editor abre con UN frame 1080×1920.
2. Borrar ese frame (Supr con el frame seleccionado) → aparece la tarjeta
   "Este archivo está vacío" → recargar la página → sigue vacío (sin fantasma).
3. Agregar un frame desde la tarjeta con medida personalizada.
4. MCP: `create_template {initialFrame:false}` → `create_html_frame` con
   width/height exactos → `delete_frame` del único frame → `get_template`
   muestra `frameCount: 0`.
