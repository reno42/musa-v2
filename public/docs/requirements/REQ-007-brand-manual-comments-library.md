# REQ-007: Brand Manual + Comment Types + Brand Library

**Status:** `backlog`
**Priority:** `P0`

---

## Resumen

Tres cambios conectados:

1. **Comentarios con tipo** — distinguir "feedback de diseño" de "documentación de uso"
2. **Brand Manual** — archivo único por marca que centraliza diseño, notas y assets
3. **Brand Library** — reemplazar "Style Library" por tarjetas de Design Systems

---

## 1. Comentarios con tipo (v18 migration)

### Problema
El sistema de comentarios tipo Figma no distingue entre:
- "Este botón debería ser más grande" (feedback de diseño)
- "Usar este layout solo para LinkedIn, mantener tono serio" (documentación de uso)

### Migración SQL
Archivo: `supabase_migrations_v18.sql`

```sql
-- Agregar comment_type: 'feedback' | 'documentation'
ALTER TABLE design_comments ADD COLUMN IF NOT EXISTS comment_type TEXT 
  NOT NULL DEFAULT 'feedback' CHECK (comment_type IN ('feedback','documentation'));

-- Agregar source 'documentation'  
ALTER TABLE design_comments DROP CONSTRAINT IF EXISTS design_comments_source_check;
ALTER TABLE design_comments ADD CONSTRAINT design_comments_source_check 
  CHECK (source IN ('editor_pin','mobile_pin','kanban','ai_review','chat','documentation'));

-- Agregar flag de Brand Manual en templates
ALTER TABLE templates ADD COLUMN IF NOT EXISTS is_brand_manual BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN templates.is_brand_manual IS 
  'When true, comments default to type=documentation. The AI reads these as instructions.';

CREATE INDEX IF NOT EXISTS idx_dc_type ON design_comments(comment_type, status, created_at DESC);
```

### Comportamiento esperado
- Template con `is_brand_manual = true` → comentarios se crean como `type='documentation'`
- Template normal → comentarios se crean como `type='feedback'`
- El botón de comentario en la UI funciona igual para ambos tipos
- La IA lee `comment_list(templateId)` y filtra por tipo según contexto

### Para el agente con IDE
1. Aplicar `supabase_migrations_v18.sql` en Supabase SQL Editor
2. Verificar que las columnas existen: `SELECT comment_type FROM design_comments LIMIT 1`
3. Modificar `comment_add` MCP handler para que detecte `is_brand_manual` y asigne el tipo
4. Agregar botón de comentario en la UI del editor (pin cliqueable tipo Figma)

---

## 2. Brand Manual — archivo único por marca

### Concepto
Un archivo (template) en el editor que centraliza TODO sobre una marca:

```
Archivo: "Futuraria — Brand Manual"
Tags: ["futuraria", "brand-manual"]
is_brand_manual: true

Frame 01 — "🎨 Paleta + Tipografía"     → CSS con :root variables
Frame 02 — "📝 Notas de Renzo"          → solo texto, sin CSS
Frame 03 — "Post IG - Agents Launch"    → diseño real con CSS
Frame 04 — "💬 Voz de marca"            → solo texto explicativo
Frame 05 — "Banner LinkedIn - Automation" → diseño real con CSS
Frame 06 — "⚠️ Restricciones"           → solo texto
```

### Cómo funciona
- **Frames con CSS** → la IA los analiza como diseño
- **Frames sin CSS** → la IA los lee como notas/documentación
- **Comentarios** → type='documentation' automáticamente
- **Tags** → la IA encuentra el manual con `find_templates(tags=["futuraria","brand-manual"])`

### Flujo del humano
1. Crea un template nuevo en el editor
2. Diseña frames normalmente (arrastrando elementos, eligiendo colores)
3. Para dejar notas: crea un frame, escribe texto, **no le pone estilos CSS**
4. Para marcar como brand manual: le pone tag "brand-manual"
5. Copia/pega diseños nuevos al mismo archivo cuando quiera

### Para el agente con IDE
1. Agregar lógica en `extract_design_system` para ignorar frames sin CSS
2. Agregar en `get_template` metadata `is_brand_manual` y `comment_type`
3. Opcional: botón "Create Brand Manual" que pre-popula frames de foundation

---

## 3. Brand Library — reemplazar Style Library

### Cambios en UI
- **Pestaña "Archivos":** agregar filtro "Brand Manuals" que muestre templates con `is_brand_manual = true`
- **Panel "Style Library":** renombrar a "Brand Library"
- **Tarjetas:** mostrar cada brand como tarjeta con:
  - Nombre del brand
  - Cantidad de templates asociados
  - Preview del frame 01 (miniatura)
  - Botón "Abrir Brand Manual"
  - Botón "Lock/Unlock" (el style lock actual)

```
┌──────────────────────────┐  ┌──────────────────────────┐
│ 🎨 Futuraria Infographic │  │ 🧩 Newform               │
│ ┌────────────────────┐   │  │ ┌────────────────────┐   │
│ │   [preview miniatura] │   │  │   [preview miniatura] │   │
│ └────────────────────┘   │  │ └────────────────────┘   │
│ 10 colores · 5 assets     │  │ 10 colores · 30 assets    │
│ 3 templates asociados     │  │ 1 template asociado       │
│ [🔒 Locked] [📖 Abrir]    │  │ [🔓 Unlocked] [📖 Abrir]  │
└──────────────────────────┘  └──────────────────────────┘
```

### Para el agente con IDE
1. Modificar `StyleLibraryPanel.tsx` → renombrar a Brand Library
2. Cambiar las tarjetas: mostrar preview + conteo de assets + botón de abrir
3. Agregar filtro "Brand Manuals" en la pestaña Archivos (`Dashboard.tsx`)
4. Mantener el botón "Publish Style" del editor (ya funciona con `generate_design_artifacts`)

---

## 4. Gemini Prompt

Archivo: `docs/prompts/gemini-design-system-prompt.md`

Prompt template para que Gemini genere diseños con design system auto-contenido (CSS variables + utility classes + componentes nombrados). Ya está documentado en el repo y en Obsidian.

---

## Orden de implementación

```
1. Ejecutar supabase_migrations_v18.sql en Supabase
2. Modificar MCP handlers (comment_add, extract_design_system)
3. UI: botón de comentarios en editor + filtro Brand Manuals
4. UI: Brand Library con tarjetas
5. Test: crear un Brand Manual, agregar comentarios, verificar filtros
```

## Verificación

1. Ejecutar migración → sin errores
2. Crear template con `is_brand_manual: true` → comentarios salen como `documentation`
3. Filtrar "Brand Manuals" en Archivos → aparece solo el template correcto
4. Brand Library muestra tarjetas con preview y conteo de assets
5. Gemini prompt produce CSS con `:root` variables → extractor lo lee correctamente

---

## Nota para el agente con IDE

> **REQ-007:** `docs/requirements/REQ-007-brand-manual-comments-library.md`
> 
> Orden: SQL primero → MCP handlers → UI.
> La migración v18 es segura para re-ejecutar (IF NOT EXISTS).
> El concepto de Brand Manual ya está probado: ver template `tpl_cba81f2e-938` 
> en el workspace de Renzo como referencia de cómo se ve un archivo multi-marca.
> 
> Cualquier duda sobre el comportamiento esperado, revisar los comentarios 
> en `design_comments` table y el flag `is_brand_manual` en `templates`.
