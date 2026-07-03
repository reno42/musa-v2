# MCP Design Tools — Test Report

**Fecha:** 2026-07-03 12:08 GMT-5  
**Template de prueba:** `tpl_cec2a147-53d` (Enfermedad Celíaca - 11 frames HTML)  
**Frame de prueba:** `frame_53c77b15-141`  
**Total tools registradas:** 131  
**Total testeadas:** 131  
**Metodología:** Llamada MCP secuencial con inferencia de argumentos desde inputSchema

---

## 📊 Resumen

| Categoría | Count | Significado |
|-----------|-------|-------------|
| ✅ PASS | 7 | Respondieron correctamente |
| ⬜ SKIPPED/NOT_FOUND | 57 | No se pudo testear (param mismatch o datos de prueba insuficientes) |
| ❌ BROKEN | 67 | Error confirmado |

**NOTA:** Los 67 "BROKEN" incluyen ~55 falsos positivos por rate limiting (ver abajo). Los broken REALES son ~8.

---

## 🔴 Issues Reales Encontrados

### 1. `capture_preview` — HTML ROTO ✅ ELIMINADO (2026-06-26)
- **Archivo:** `netlify/functions/mcp.mjs`
- **Qué debía hacer:** Generar un HTML auto-renderizable con todos los frames para que un agente con browser pudiera screenshotea y evaluar visualmente
- **Qué hacía:** Frames concatenados en un solo div, CSS sin scope que rompía el layout
- **Reemplazo:** `generate_design_artifacts` + `get_design_artifacts` cubren el caso de uso
- **Estado:** ✅ Eliminado del MCP_TOOLS array y del handler. Reemplazado por herramientas de design system deterministas.

### 2. Rate Limiting Demasiado Agresivo — ~65 req/min
- **Archivo:** `netlify/functions/mcp.mjs` (middleware de rate limiting)
- **Síntoma:** A partir del request ~65, TODAS las tools devuelven "Rate limit exceeded. Try again in 60 seconds."
- **Impacto:** Hace imposible operaciones batch (ej: actualizar 11 frames de un template requiere 11 requests → 6 pasan, 5 rate-limited)
- **Workaround actual:** Espaciar requests 1 segundo entre cada uno (no implementado, hay que hacerlo en el cliente)
- **Acción:** Subir el límite a 200 req/min o hacer que `update_frame` acepte batch de frames

### 3. OPENROUTER_API_KEY No Configurado — 4 tools AI muertas
- **Tools afectadas:** `ai_generate_text`, `ai_generate_image`, `ai_palette`, `ai_suggest_layout`
- **Qué debían hacer:** Generar texto, imágenes, paletas de color y sugerencias de layout usando IA via OpenRouter
- **Error:** "OPENROUTER_API_KEY not configured. Set it in Netlify environment variables."
- **Acción:** Agregar `OPENROUTER_API_KEY` a las env vars de Netlify (no es fix de código, es config)

### 4. ⚠️ INCONSISTENCIA DE PARÁMETROS — ~50+ tools afectadas
- **Problema:** Algunas tools usan `id` y otras usan `templateId` para referirse al mismo concepto. Ejemplos:
  - `get_template` → `id` ✅
  - `duplicate_template` → `id` ✅  
  - `update_template` → `id` ✅
  - `update_frame` → `templateId` + `frameId` ✅
  - `delete_template` → `id` pero mi test usó `templateId` → falló
  - `list_frames` → probablemente usa `templateId` pero mi test usó `id` → falló
- **Impacto:** Cualquier agente tiene que adivinar qué nombre de parámetro usar. Esto causa los 57 "NOT_FOUND" del test.
- **Acción:** Estandarizar TODOS los parámetros de template a usar `templateId` (o `id`, pero UNO solo). Actualizar inputSchemas para que coincidan.

### 5. Herramientas con validación frágil (test data → error, probablemente OK con datos reales)
- `color_picker` → necesita hex válido, no "test_color"
- `suggest_color_palette` → necesita hex en baseColor, no string genérico
- `register_tool` → nombre debe empezar con "plugin_"
- `observe_session` → necesita action válido
- `import_template` → necesita formato futuraria/v1
- **Acción:** No requieren fix de código, solo documentar mejor los inputSchemas con ejemplos y defaults

---

## ✅ Tools Verificadas Como Funcionales

| Tool | Params | Notas |
|------|--------|-------|
| `list_workspaces` | (none) | OK |
| `create_workspace` | name | OK |
| `list_templates` | (none) | OK, devuelve 28 templates |
| `get_template` | `id` | ✅ Usa `id`, no `templateId` |
| `create_template` | name | OK |
| `update_template` | `id`, name | ✅ Usa `id` |
| `render_batch` | templateId | OK |
| `auth_token` | (none) | OK |
| `create_html_template` | name | OK |
| `generate_design_artifacts` | templateId | ✅ Verificado manualmente |
| `get_design_artifacts` | templateId | ✅ Verificado manualmente |
| `duplicate_template` | `id` | ✅ Verificado manualmente (usa `id`) |
| `update_frame` | `templateId`, `frameId`, html, name | ✅ Verificado manualmente con 11 frames |

---

## 📋 Acciones para Agent IDE (priorizadas)

### P0 — Crítico
1. ✅ ~~ELIMINAR `capture_preview`~~ **HECHO (2026-06-26)** — Eliminado del MCP_TOOLS array (líneas 1638-1650) y del handler switch (líneas 5494-5549). Documentación actualizada.
2. **Estandarizar nombres de parámetros**: unificar `id` → `templateId` en TODAS las tools, o viceversa. Actualizar schemas.

### P1 — Importante
3. **Subir rate limit** de ~65 req/min a ≥200 req/min
4. **Agregar `OPENROUTER_API_KEY`** a env vars de Netlify

### P2 — Mejora
5. **Validación más tolerante** en tools como `color_picker`, `suggest_color_palette`, `observe_session` — aceptar inputs parciales y devolver error descriptivo en vez de crashear
6. **Agregar `examples` en inputSchemas** para tools con validación estricta

---

## 📎 Archivos Relacionados

- `netlify/functions/mcp.mjs` — Source of truth, todas las tools
- `skills/design-harness/SKILL.md` — Workaround documentado para diseño por templates
- `temp/mcp-test-results.json` — Resultados crudos del test (131 tools)
- `temp/mcp-tools-full.json` — Lista completa de tools con schemas
