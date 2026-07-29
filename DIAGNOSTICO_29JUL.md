# 🔧 DIAGNÓSTICO Y CORRECCIONES — 29 Julio 2026

**Ejecutado por:** Mira (Hermes)

---

## 1. URL CORRECTA: design.futuraria.com ✅

### Descubrimiento
`design.futuraria.com/mcp` SÍ funciona. Responde JSON-RPC con 100+ tools.

### URL incorrecta propagada en:
| Archivo | Acción |
|---------|--------|
| `config.yaml` → `mcp_servers.design-tool.url` | ✅ Corregido a `design.futuraria.com/mcp` |
| `skills/domain/futuraria-workflow/SKILL.md` | ❌ Tiene `bejewelled-llama` |
| `skills/domain/futuraria-workspace/SKILL.md` | ❌ Tiene `bejewelled-llama` |
| `skills/futuraria/design-tool-mcp/SKILL.md` | ❌ Tiene `bejewelled-llama` |
| `skills/mira-workflow/references/design-tool-mcp.md` | ❌ Tiene `bejewelled-llama` |
| `skills/mira-workflow/SKILL.md` | ❌ Tiene `bejewelled-llama` |
| `skills/openclaw-imports/design-harness/SKILL.md` | ❌ Tiene `bejewelled-llama` |
| `skills/openclaw-imports/design-vision/SKILL.md` | ❌ Tiene `bejewelled-llama` |
| `skills/openclaw-imports/futuraria-onboarding/SKILL.md` | ❌ Tiene `bejewelled-llama` |

**Acción pendiente:** IDE Agent debe reemplazar `bejewelled-llama-a6719d.netlify.app` → `design.futuraria.com` en los 8 skills.

---

## 2. STYLE LIBRARY (Brand Guidelines en Supabase) ✅

### Lo que EXISTE
- Tabla `brand_guidelines` en Supabase ✅
- Herramientas: `create_brand_guideline`, `get_brand_guideline`, `list_brand_guidelines`, `update_brand_guideline`, `delete_brand_guideline` ✅
- `apply_brand_to_template` ✅
- `get_active_styles` + `set_style_lock` ✅

### Lo que FUNCIONA
- Extraer estilo → `generate_design_artifacts(action:"publish")`
- Guardar nuevo estilo → `create_brand_guideline`
- Leer estilo → `get_brand_guideline`
- Agregar contenido a estilo existente → `get_brand_guideline` + concatenar + `update_brand_guideline` ✅ (probado)

### Lo que FALTA
| Feature | Estado |
|---------|--------|
| Botón "Guardar estilo" en UI para humano | ❌ Debe implementarse |
| Botón "Extraer estilo" en UI | ❌ Debe implementarse |
| Append automático (sin concatenar manual) | ❌ `update_brand_guideline` reemplaza, no concatena |
| Menú kanban en la UI | ❌ No existe |
| Sincronización Kanban ↔ Brand Guidelines | ❌ No sincronizado |

---

## 3. KANBAN ↔ CRM — NO SINCRONIZADO ❌

### Estado actual
- **Kanban Hermes:** 1 tarea de diseño (Design Tool: 20 variantes Mundial)
- **Brand Guidelines Supabase:** 1 marca (Futuraria) — NO reflejada en Kanban
- **Templates:** 11 en workspace — NO reflejados en Kanban

### Lo que debería pasar
Cada vez que se crea/modifica una marca o template:
1. Se crea/actualiza tarjeta en Kanban
2. La tarjeta tiene: nombre, estado, prioridad, fecha
3. El humano puede mover/editar tarjetas desde la UI
4. Mira puede consultar el Kanban para saber qué está pendiente

### Gap
No hay webhook ni trigger que sincronice operaciones del MCP con el Kanban de Hermes. Son sistemas separados.

---

## 4. STYLE APPEND — Funciona con workaround ✅

**Flujo actual (manual):**
1. `get_brand_guideline` → leer contenido actual
2. Concatenar nuevo contenido al final
3. `update_brand_guideline` → guardar

**Ideal (falta implementar):**
1. `update_brand_guideline` con `mode: "append"`
2. El sistema concatena automáticamente sin que yo tenga que leer + concatenar + escribir

---

## 5. RESUMEN DE ACCIONES PARA IDE AGENT

### Críticas
1. **Reemplazar URL** en 8 skill files: `bejewelled-llama-a6719d.netlify.app` → `design.futuraria.com`
2. **Implementar botón "Guardar estilo"** en la UI del editor
3. **Implementar botón "Extraer estilo"** en la UI del editor

### Importantes
4. **Sincronizar Kanban ↔ Brand Guidelines** (webhook o trigger en Supabase)
5. **Implementar `mode: "append"`** en `update_brand_guideline`
6. **Agregar menú kanban** en la UI del editor para humanos

### Mejoras
7. Logo automático en `generate_brand_manual`
8. `data-slot` en templates para CSV columns significativas
9. `generate_design_artifacts` publish debería retornar `brandId`
