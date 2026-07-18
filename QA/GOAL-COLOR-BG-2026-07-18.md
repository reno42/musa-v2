# /goal — Fix color picker + background image upload (REVISADO por Lara, 2026-07-18)

Tus 2 fixes están APROBADOS (verificados contra el repo). Pero NO cubren el reporte original de Ren.
Cambia a agent mode y aplica los 4 puntos en este orden. No hagas build/push hasta completar los 4.

---

## PARTE 1 — Fix mcpClient.ts (doble .json) ✅ APROBADO
Tal como lo propusiste. Verificado: `apiFetch` en `src/lib/supabase.ts` ya retorna JSON parseado.
Afecta 12 call-sites (Dashboard 2, GhostPanel 5, EditorV2 5). Aplica tu fix.

## PARTE 2 — Fix composedPath() para backspace ✅ APROBADO
Tal como lo propusiste (`isEditingInShadowDOM` + reemplazo del guard). Aplica tu fix.

## PARTE 3 — Color picker/presets NO cambian color (EL BUG REAL DE REN) 🔴
**Diagnóstico de Lara:** el flujo de color NO pasa por MCP:
`ColorRow` (HtmlContextualPanel.tsx:236) → `update()` (línea 385) → `updateElementCssProperty()` → `onCssChange` → `handleContextualCssChange` (EditorV2). Todo local. Tu Fix 1 NO arregla esto.

**Sospechoso #1 (bug P0 documentado desde julio):** selector `body { }` no matchea dentro del Shadow DOM
(no hay `<body>`, el contenido vive en `<div id="__df_content">`). El CSS se actualiza bien en el
texto, pero el render lo ignora → sin cambio visual y sin errores en consola. Síntomas exactos de Ren.

**Qué hacer:**
1. Reproduce: selecciona el elemento raíz de un template cuyo CSS use `body { }` (la mayoría de
   templates generados usan `body` como root, ej. el que crea `addFrame` en EditorV2.tsx:657) y
   cambia color con el picker → verás que no se aplica.
2. Fix en la inyección de CSS del Shadow DOM (`DesignFrame.tsx`, donde se inyecta el CSS al Shadow
   Root): mapear `body` → `#__df_content` (regex sobre selectores, cuidado con `body.foo` y
   `body foo`). Este fix está pendiente desde julio: GAP_ANALYSIS_MINI_FIGMA.md lo tiene como P0.
3. Verifica también `getSelector()` / `element.selector`: si la selección del root devuelve `body`,
   las escrituras de `updateElementCssProperty` van a una regla que el editor nunca renderiza.
4. Criterio de aceptación: color picker + presets (HtmlContextualPanel Y los quick-props de
   ElementProperties.tsx:131) cambian el color EN VIVO en el canvas, en un template con `body {}`
   y en otro con selectores de clase. Los thumbnails del dashboard (iframe con body real) deben
   seguir funcionando.

## PARTE 4 — Foto de fondo → Supabase bucket 🔴 (Ren lo pidió, no lo abordaste)
Infraestructura que YA existe (reutilizar, no duplicar):
- Bucket `design-assets` (público, creado vía SQL en supabase_schema_complete.sql:135)
- MCP tool `upload_image` + tabla `assets` + `ImageUploadModal.tsx`

**Qué hacer:**
1. En HtmlContextualPanel, sección Fill: agregar "Background image" con botón que abre
   `ImageUploadModal` (o file input PNG/JPG).
2. Al subir: usar el endpoint/tool existente de assets (`upload_image`) → sube al bucket
   `design-assets` → retorna URL pública.
3. Aplicar `background-image: url(<public-url>)` + `background-size: cover` al selector del
   elemento vía `updateElementCssProperty` (mismo flujo que colores — por eso la PARTE 3 va primero,
   si no el background tampoco se verá con selectores body).
4. Debe funcionar por UI Y por MCP (`upload_image` + `set_css` ya lo permiten por MCP — verifica).
5. Criterio de aceptación: subir foto desde la UI → aparece como fondo en vivo → URL en Supabase
   Storage (no base64 en el CSS) → persiste tras reload.

---

## Orden y verificación
1. PARTE 1 (desbloquea thumbnails/snapshot que Lara necesita para QA)
2. PARTE 3 (el bug real de Ren)
3. PARTE 2
4. PARTE 4
5. Build + push. Lara hace deploy-verify y QA end-to-end después.

/goal
