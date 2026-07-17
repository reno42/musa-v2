# PLAN_EDITOR_PRO — Lo que un editor profesional contempla y aún no tenemos

**Autor:** Claude (Fable 5) · **Fecha:** 2026-07-16
**Trilogía:** PLAN_EDITOR_CORE (estabilidad) → PLAN_EDITOR_PRO (este: paridad profesional) → PLAN_PRODUCTO (crecimiento)
**Verificado contra el código** — cada "falta" fue confirmada con grep/lectura, no asumida.

Prioridades: **P0** = un usuario de Figma/Illustrator lo espera el primer día ·
**P1** = lo espera la primera semana · **P2** = diferenciador nuestro (humano+IA).

---

## A. Selección y manipulación multi-objeto — P0

Hoy el marquee existe SOLO a nivel canvas (selecciona frames). Dentro del frame no hay
rubber-band, y el multi-select de capas (`multiSelectLayerIds`) es frágil.

- **A1. Marquee dentro del frame**: drag sobre área vacía en modo select = rectángulo que
  selecciona todas las capas top-level que interseca (Shift+marquee agrega). El scope de
  selección (PLAN_EDITOR_CORE §3.3) aplica: en scope raíz selecciona top-levels; dentro de
  un contenedor, sus hijos.
- **A2. Operaciones de grupo consistentes**: mover N seleccionados como uno (drag con
  bounding box combinada), resize proporcional del conjunto, Delete borra todos,
  alt+drag duplica el conjunto.
- **A3. UI de alinear/distribuir para la selección**: los MCP tools `align_objects` /
  `distribute_objects` ya existen — falta la botonera contextual (aparece cuando hay ≥2
  seleccionados: alinear izq/centro/der/arriba/medio/abajo, distribuir H/V).
- **A4. Atajos de sistema**: `Ctrl+A` (seleccionar todo el scope), `Tab`/`Shift+Tab`
  (ciclar objetos), `Esc` (deseleccionar/subir scope), `Ctrl+]`/`Ctrl+[` (adelante/atrás
  en Z; `reorder_element` ya existe en MCP, falta el atajo y el gesto).

## B. Menú contextual (click derecho) — P0

No existe (`onContextMenu` no aparece en el código). Los editores profesionales viven ahí.

- **B1**: menú sobre selección: Copiar / Pegar / Duplicar / Eliminar / Copiar estilo /
  Pegar estilo / Traer al frente / Enviar atrás / Agrupar / Desagrupar / Envolver en frame
  (Ctrl+Alt+G ya existe) / Convertir a path / Bloquear / Ocultar / Renombrar capa /
  Exportar selección. Sobre canvas vacío: Pegar / Pegar aquí / Seleccionar todo / Zoom.
- Todo reusa handlers existentes — es UI, no lógica nueva. (Bloquear/ocultar ya existen
  como overrides CSS en EditorV2:2076-2086; falta exponerlos aquí y en el panel de capas.)

## C. Vista: reglas, guías y grids — P0/P1

Nada de esto existe (solo hay un ícono de ruler en icons.tsx).

- **C1 (P0). Reglas + guías arrastrables**: reglas H/V en los bordes del viewport
  (unidades = px del frame activo, reaccionan al zoom); arrastrar desde la regla crea una
  guía; los objetos snapean a guías (el motor de snap ya existe — solo se agregan las guías
  como fuentes); doble click en guía la elimina; se persisten por frame (`frame.guides[]`).
- **C2 (P1). Layout grids por frame**: columnas/filas/cuadrícula configurables (count,
  gutter, margin) tipo Figma; se pintan en overlay; snap a columnas.
- **C3 (P1). Atajos de vista**: `Ctrl+0` fit, `Ctrl+1` 100%, `Shift+2` zoom a selección.
- **C4 (P1). Snap a píxel** (toggle): posiciones/dimensiones enteras al mover/redimensionar.

## D. Objetos que faltan — P0/P1

- **D1 (P0). Herramienta Línea/Flecha (L)**: SVG line/path con marker-end configurable
  (flecha, punto, diamante — los caps del spec bezier). Shift = ángulos de 45°.
- **D2 (P0). Imagen de primera clase**: herramienta imagen (I) + **pegar del portapapeles
  (Ctrl+V con imagen)** + drag&drop de archivos al canvas → crea capa imagen con
  object-fit cover/contain/fill conmutables, y "Reemplazar imagen" en el menú contextual
  (el placeholder del flujo replicación por fin se llena en un gesto).
- **D3 (P1). Radio por esquina**: UI de 4 valores en el panel (CSS ya lo soporta);
  el control circular de esquina en canvas (como el rect de Figma) puede esperar.
- **D4 (P1). Máscaras con forma**: clip-path de una capa usando otra capa como máscara
  (par "máscara + contenido" como hermanos, según el spec Figma que ya definimos).

## E. Color profesional — P0

- **E1. Eyedropper**: la API nativa `window.EyeDropper` existe en Chrome — integrarla en
  TODOS los color pickers del panel (fill, stroke, sombras, fondo de frame). 20 líneas.
- **E2. Swatches del documento**: fila de colores usados en el template (se derivan del
  CSS — el extractor ya sabe hacerlo) + últimos 8 usados, en cada picker.

## F. Backend de nivel profesional — P0 (carril paralelo, no toca el editor)

- **F1. Assets a Storage, NUNCA base64 inline** ⚠️ la más importante del backend:
  hoy las imágenes se incrustan base64 en el HTML del frame → templates de MBs, el origen
  real del 502, renders lentos, diffs gigantes. Nuevo flujo: toda imagen (upload, paste,
  drag&drop, MCP `upload_image`) va a Supabase Storage (`design-assets/`), la capa
  referencia la URL; migración lazy: al abrir un template con base64 > 100KB se ofrece
  "optimizar" (extrae a Storage y reemplaza src). Fallback sin Supabase: `/api/assets`
  local a disco.
- **F2. Concurrencia multi-agente (tu OPC edita con 3 IAs a la vez)**: hoy es last-write-
  wins y se pisan. Mínimo viable: `revision` (int) por frame; `update_template`/
  `update_html_frame` aceptan `ifRevision` y devuelven `409 { current }` si no coincide →
  el agente re-lee y re-aplica. El editor humano manda su revision igual. `claim_section`
  figura en SKILL.md pero NO está implementado — implementarlo como lock suave con TTL
  (frameId + agente + 60s renovables) y pintarlo en la UI (borde de color + nombre del
  agente en el frame reclamado; `ActiveAgentsPanel` ya existe como base).
- **F3. Papelera**: soft-delete de templates (columna `deleted_at`); vista Trash con
  restaurar / eliminar definitivo a los 30 días. Un pro NUNCA pierde un archivo por un click.
- **F4. Límites y errores limpios en MCP**: payload > 5MB → error claro con consejo
  ("sube las imágenes con upload_image, no inline"); validación de html/css tamaño por
  frame; rate limit básico por API key.
- **F5. API keys reales**: reemplazar `dev-key` hardcodeado por keys generables/revocables
  en Settings (tabla `api_keys`); el frontend usa una key de sesión. (Multi-tenant
  completo NO es P0 — cada instalación es de un dueño — pero dejar de shippear una key
  universal sí.)

## G. Texto avanzado — P1

- **G1. Estilos de texto guardados**: crear estilo desde un texto (nombre + props),
  aplicar desde la mini-barra, editar el estilo actualiza todos sus usos (el tipo `Style[]`
  ya existe en el modelo; StyleLibraryModal es la base UI).
- **G2. Rich-text dentro del bloque**: negrita/itálica/color por tramo (contentEditable ya
  lo permite — falta la mini-barra al seleccionar texto dentro de la edición y
  sanitización consistente).

## H. Componentes e instancias — P1/P2

El tipo `Component` existe en `types.ts` y no está cableado a nada. Para el flujo de marcas
es oro: el logo/CTA/footer se define una vez y se instancia en 20 posts.

- **H1**: "Crear componente" desde selección → se guarda master (html+css) en el template
  (o biblioteca del workspace); las instancias referencian `data-component-id` y se
  sincronizan al editar el master; override de texto/imagen por instancia.
- Es la infraestructura que hace al batch más potente: CSV → instancias, no copias sueltas.

## I. Export profesional — P1

- **I1. Exportar selección** (no solo frames): cualquier capa/grupo → PNG/SVG con fondo
  transparente.
- **I2. Presets de export**: 1x/2x/3x, formatos por destino (el `render_batch` ya escala —
  falta UI por elemento y recordar presets por frame).

## J. Diferenciadores humano-IA — P2 (nuestra ventaja, nadie más lo tiene)

- **J1. Modo revisión**: la IA trabaja sobre un snapshot-borrador; el humano ve un diff
  visual (antes/después por frame, `diff_template` ya existe) y Acepta/Rechaza por cambio.
  El miedo a "la IA me rompió el diseño" desaparece — y con F2 es seguro.
- **J2. Presencia de agentes en canvas**: qué frame/capa está tocando cada IA en vivo
  (badge con nombre sobre el frame reclamado). Base: ActiveAgentsPanel + realtime.
- **J3. Comentarios anclados**: `Comment[]` ya existe en el modelo — UI de pin sobre
  frame/capa, hilo, resolver. La IA los lee por MCP y ejecuta ("cámbialo a azul" como
  comentario → la IA lo resuelve).

---

## Integración con los planes existentes

| Ítems | Dónde viven | Cuándo |
|---|---|---|
| A1-A4, B1, C1, D1-D2, E1-E2 | PLAN_EDITOR_CORE — nuevo **Sprint 5 "Paridad Pro"** (después del 3.5; requieren la selección/store nuevos) | tras Sprint 3 |
| F1-F5 | **Carril backend paralelo** — no toca DesignFrame/EditorV2, puede empezar HOY | ya |
| C2-C4, D3-D4, G1-G2, I1-I2 | PLAN_EDITOR_CORE — **Sprint 6 "Pro II"** | tras Sprint 5 |
| H1, J1-J3 | PLAN_PRODUCTO — después de thumbnails/métricas | post-core |

**Criterio de cierre del "editor profesional"** (la prueba del usuario exigente): replicar
el post de Superside completo usando SOLO el editor — marquee para alinear los textos,
click derecho para duplicar y reordenar, imagen pegada del portapapeles en el placeholder,
línea con flecha, eyedropper para robar el verde — sin abrir el panel de código ni una vez,
y con dos IAs trabajando en frames vecinos sin pisarse.
