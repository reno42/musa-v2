# 🏗️ ORDEN DE CONSTRUCCIÓN — Design Tool

**Para:** IDE Agent (Act)
**De:** Mira (Hermes)
**Fecha:** 29 Julio 2026
**Repo:** `design-main/`

---

## 🎯 PRIORIDAD 1: Studio Board (Kanban interno del editor)

### Qué es
Un panel kanban DENTRO de la UI del editor de diseño. Independiente del Ops Board de Hermes.

### Columnas
```
📥 Pendiente → 🎨 En progreso → 👀 En revisión → ✅ Listo
```

### Tarjeta de diseño
Cada tarjeta debe tener:
- Nombre del diseño
- Marca asignada (brandId)
- TemplateId vinculado (click → abre el diseño en el editor)
- Medidas (width x height)
- Fecha límite
- Prioridad (1/2/3)
- Notas

### API (herramientas MCP nuevas o extendidas)
| Herramienta | Qué hace |
|-------------|----------|
| `studio_create_card` | Crear tarjeta en el Studio Board |
| `studio_move_card` | Mover tarjeta entre columnas |
| `studio_list_cards` | Listar tarjetas por columna/estado |
| `studio_get_card` | Obtener detalle de una tarjeta |

### Persistencia
Tabla `studio_cards` en Supabase:
```sql
CREATE TABLE studio_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  brand_id UUID REFERENCES brand_guidelines(id),
  template_id UUID REFERENCES templates(id),
  width INTEGER DEFAULT 1080,
  height INTEGER DEFAULT 1080,
  status TEXT DEFAULT 'pending',  -- pending, in_progress, review, done
  priority INTEGER DEFAULT 2,
  deadline TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### UI
- Panel lateral derecho o inferior en el editor
- Drag & drop entre columnas
- Click en tarjeta → navega a `/?templateId=<id>`
- Botón "+" para crear tarjeta manualmente (para humanos)
- Las tarjetas creadas por Mira vía MCP aparecen automáticamente

---

## 🟡 PRIORIDAD 2: Correcciones MCP

### 2A. MCP timeout con Hermes
**Síntoma:** `tool_call` nativo de Hermes timeoutea 300s. Curl directo funciona.
**Diagnóstico:** Probablemente el handshake SSE no completa. El endpoint responde JSON-RPC correctamente por POST.
**Acción:** Revisar `mcp.mjs` — verificar que soporte tanto SSE como POST directo. Si solo soporta POST, documentarlo para que Hermes use modo POST en vez de SSE.

### 2B. `generate_design_artifacts` publish no retorna brandId
**Síntoma:** Al publicar con `action:"publish"`, la respuesta tiene `_published:true` pero no incluye el `brandId`.
**Workaround actual:** Hacer `list_brand_guidelines` después del publish para encontrar el ID.
**Acción:** Agregar `brandId` al response del publish.

### 2C. `update_brand_guideline` no tiene modo append
**Síntoma:** Solo reemplaza contenido. Para agregar hay que hacer get + concatenar + update.
**Acción:** Agregar `mode:"append"` como parámetro opcional.

### 2D. `extract_design_system` error confuso
**Síntoma:** Si pasas `templateId` (singular) en vez de `templateIds` (array), el error dice "At least one templateId required".
**Acción:** Cambiar mensaje a "Use templateIds (array), not templateId".

---

## 🟢 PRIORIDAD 3: Mejoras UX

### 3A. Style Library — Botones en UI
- **Botón "Extraer estilo":** Un clic → `generate_design_artifacts(action:"publish")` → guarda en brand_guidelines
- **Botón "Guardar estilo":** Abre modal con opción: crear nuevo o agregar a existente
- **Menú de estilos:** Lista de brand guidelines con previsualización de colores

### 3B. CSV batch — Columnas con nombres
- Cuando un template tiene `data-slot="titulo"` en el HTML, el CSV usa ese nombre como columna
- Sin data-slot, las columnas salen genéricas (content, content_2, text, text_2...)

### 3C. Logo en manual de marca
- `generate_brand_manual` no incluye imágenes del template
- Si el template tiene `<img>`, debería detectarlo y agregarlo al manual

### 3D. Style transfer — Reescribir CSS inline
- `apply_brand_to_template` aplica tokens al metadata pero no modifica el CSS del frame
- Idealmente debería buscar colores en el CSS y reemplazarlos con los tokens de la marca

---

## 🔗 Sincronización: Studio Board ↔ Ops Board (Hermes)

### Visión
Cuando Mira crea una tarjeta en el Studio Board, también se crea/actualiza en el Ops Board de Hermes. Y viceversa.

### Implementación sugerida
- Webhook en Supabase → `studio_cards` INSERT/UPDATE → dispara `hermes kanban create`
- O un cronjob en Hermes que cada hora sincronice: lee `studio_cards` y refleja en Kanban

---

## 📁 Archivos de referencia en design-main

| Archivo | Contenido |
|---------|-----------|
| `REPORTE_MIRA_DESIGN_TOOL_28JUL.md` | Diagnóstico inicial del MCP |
| `PLAYBOOK_MCP_MIRA.md` | Guía de uso de todas las herramientas |
| `PRUEBAS_MCP_28JUL.md` | Resultados de 8 pruebas funcionales |
| `DIAGNOSTICO_29JUL.md` | URL, style library, kanban sync |
| `BUG_MCP_API_CAIDO_28JUL.md` | Issue del MCP caído (resuelto) |

---

## 🚀 Orden de implementación sugerido

1. **Studio Board** — backend (tabla + API) → frontend (UI panel)
2. **Fix MCP timeout** — para que Mira pueda usar `tool_call` nativo
3. **Style buttons** — Extraer + Guardar en UI
4. **CSV column names** — soporte para data-slot
5. **Brand manual logo** — detección de imágenes
6. **Sync Studio ↔ Ops** — webhook o cronjob
