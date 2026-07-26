# 🚦 Futuraria MCP — Reporte de QA Sistemático

**Fecha:** 2026-07-25
**Agente QA:** Lara (OpenClaw)
**Endpoint:** https://design.futuraria.com/mcp
**Auth mode:** Workspace API key (`workspace_api_keys` table)
**Tools probados:** ~70 de 169

---

## 🔴 BLOQUEANTES (Impiden uso fluido del MCP)

### B1. `color_picker` — parámetro incorrecto
- **Tool:** `color_picker`
- **URL:** POST /mcp → `tools/call`
- **Input:** `{ hex: "#d5ff00" }` → ❌ devuelve `#000000` (negro, resultado incorrecto)
- **Input:** `{ color: "#d5ff00" }` → ✅ devuelve `#d5ff00` correctamente
- **Diagnóstico:** El tool expone el parámetro como `hex` en su schema pero internamente espera `color`. O el schema está mal, o la validación interna está mal.

<details>
<summary>Evidencia</summary>

```
color_picker({ hex: "#d5ff00" }) → {"hex":"#000000","rgba":"rgba(0,0,0,1.00)","r":0,"g":0,"b":0,"a":1}
color_picker({ color: "#d5ff00" }) → {"hex":"#d5ff00","rgba":"rgba(213,255,0,1.00)","r":213,"g":255,"b":0,"a":1}
```
</details>

### B2. `suggest_color_palette` — rechaza hex válidos
- **Tool:** `suggest_color_palette`
- **Input:** `{ base: "#e94560", type: "complementary" }` → ❌ `"baseColor must be a hex color (e.g. '#3b82f6')"`
- **Diagnóstico:** Espera `baseColor` como nombre de parámetro, no `base`. Schema dice una cosa, código espera otra.

<details>
<summary>Evidencia</summary>

```
suggest_color_palette({ base: "#e94560", type: "complementary" })
→ error: baseColor must be a hex color
```
</details>

### B3. `insert_icon` — crash interno JS
- **Tool:** `insert_icon`
- **Input:** `{ templateId, frameId, iconName: "rocket", size: 64, color: "#e94560" }`
- **Respuesta:** ❌ `"Cannot read properties of undefined (reading 'replace')"`
- **Diagnóstico:** Crash interno — el código intenta hacer `.replace()` en un valor `undefined`. Posiblemente el frameId no se resuelve correctamente o el parámetro `iconName` no existe en el schema real.

### B4. `get_template_structure` — siempre devuelve 0 elementos
- **Tool:** `get_template_structure`
- **Input:** Template con HTML `{ templateId }` (después de `set_html` y `set_css`)
- **Respuesta:** ⚠️ `{ "elements": [], "cssRules": [], "elementCount": 0, "cssRuleCount": 0 }`
- **Diagnóstico:** No detecta elementos del DOM ni reglas CSS, incluso después de inyectar HTML/CSS vía `set_html`/`set_css`/`add_element`. La función que parsea el HTML parece no leer el contenido del frame correctamente. Lee del template, no del frame.

### B5. `set_frame_layers` — respuesta vacía `{}`
- **Tool:** `set_frame_layers`
- **Input:** layers[] con 3 objetos válidos
- **Respuesta:** ⚠️ `{}` — objeto vacío
- **Diagnóstico:** Según el playbook debe devolver `{ success, layerIds[] }`. Devuelve `{}` vacío sin indicar éxito/fallo. El agente no puede confirmar que la operación funcionó.

### B6. `duplicate_frame` — parámetro frameId como `undefined`
- **Tool:** `duplicate_frame`
- **Input:** `{ templateId, frameId, newName }`
- **Respuesta:** ❌ `"Frame not found: undefined"`
- **Diagnóstico:** No está recibiendo el `frameId` que se le pasa. Posible bug de desestructuración de parámetros.

### B7. `copy_as` — layer no encontrado
- **Tool:** `copy_as`
- **Input:** `{ templateId, frameId, format: "css" }`
- **Respuesta:** ❌ `"Layer not found: undefined"`
- **Diagnóstico:** Busca un `layerId` que no se le pasa. El schema probablemente requiere `layerId` como obligatorio pero no está documentado.

---

## 🟡 NO BLOQUEANTES (Afectan experiencia pero no bloquean)

### Y1. `export_template` — respuesta vacía `{}`
- **Tool:** `export_template`
- **Respuesta:** `{}` vacío. No devuelve el JSON exportado.

### Y2. `duplicate_template` — respuesta vacía `{}`
- **Tool:** `duplicate_template`
- **Respuesta:** `{}` vacío. No devuelve el nuevo templateId.

### Y3. `create_collection` — "Method not found"
- **Tool:** `create_collection`
- **Input:** `{ templateId, name: "Brand Colors" }`
- **Respuesta:** ❌ `"Method not found: create_collection"`
- **Diagnóstico:** El tool existe en tools/list pero no tiene handler implementado.

### Y4. `import_svg` — "Either svg or url parameter is required"
- **Tool:** `import_svg`
- **Input:** `{ templateId, svgContent: "<svg>..." }`
- **Respuesta:** ❌ El nombre del parámetro esperado es `svg` (no `svgContent`).

### Y5. `diff_versions` — "fromVersionId required"
- **Tool:** `diff_versions`
- **Input:** `{ templateId }`
- **Respuesta:** ❌ Requiere `fromVersionId` y opcionalmente `toVersionId`. Cuando hay solo 1 versión no puede comparar.

### Y6. `search_stock_image` — resultados vacíos
- **Tool:** `search_stock_image`
- **Input:** `{ query: "office", count: 3 }`
- **Respuesta:** ✅ Status 200 pero `results: []` — sin resultados. Posible API key de Unsplash/Pexels no configurada.

---

## ⚪ INFO (Errores esperados, documentar para claridad)

### I1. `lint_design` — warning "missing-position" en `set_html`
- **Tool:** `lint_design`
- **Output:** Score 95, warning: "Element div.slide has no explicit position" y "Position should be set (at least `left` + `top`)"
- **Nota:** `set_html` no asigna posición automática. El playbook de `set_frame_layers` sí lo hace. Es comportamiento esperado pero el agente debe saberlo.

### I2. AI tools sin OPENROUTER_API_KEY
- **Tools:** `ai_generate_text`, `ai_palette`, `ai_generate_image`, `ai_translate`, `ai_suggest_layout`
- **Respuesta:** ❌ `"OPENROUTER_API_KEY not configured"`
- **Nota:** No es bug, es configuración faltante. Documentar que Ren necesita setear OPENROUTER_API_KEY en Netlify.

### I3. `edit_text_content` — layerId incorrecto
- **Tool:** `edit_text_content`
- **Input:** `{ templateId, frameId, layerId: "body", text }`
- **Respuesta:** ❌ `"Element not found: body"`
- **Nota:** El layerId correcto es el `data-layer-id` del elemento (ej: `txt_ms0v3flxnfx24vj9`, obtenible vía `list_all_texts`).

---

## ✅ OK (Funcionaron correctamente)

| Tool | Notas |
|------|-------|
| `initialize` | ✅ Sin auth requerido |
| `tools/list` | ✅ 169 tools listados |
| `get_agent_guide` | ✅ Sin auth |
| `get_playbook` | ✅ Sin auth |
| `list_workspaces` | ✅ Scoped a key workspace |
| `create_template` | ✅ engine:'html' funciona |
| `create_html_frame` | ✅ Auto-posiciona (x: 1180, y: 0) |
| `set_html` | ✅ Acepta HTML string |
| `set_css` | ✅ Acepta CSS string |
| `update_html_frame` | ✅ Renombra frames |
| `update_frame_content` | ✅ Selector CSS funciona |
| `get_frame_changes` | ✅ Detecta cambios por hash |
| `get_template` | ✅ Full template data |
| `get_html_frames` | ✅ Lista frames con contenido |
| `lint_design` | ✅ Score 95, detecta issues |
| `add_element` | ✅ Crea layer |
| `add_primitive` | ✅ Circle creado exitosamente |
| `save_version` | ✅ Crea versiones |
| `list_versions` | ✅ Lista historial |
| `register_brand` | ✅ Crea brand profile |
| `validate_brand` | ✅ Score 85 |
| `auto_fix_brand` | ✅ Correcciones aplicadas |
| `claim_section` | ✅ Lock 60s |
| `release_section` | ✅ Release |
| `adapt_format` | ✅ Crea template adaptado |
| `adapt_all_formats` | ✅ Multi-formato |
| `get_metrics` | ✅ Dashboard data |
| `get_design_system` | ✅ Tokens y frames |
| `get_design_artifacts` | ✅ Auto-genera tokens.json |
| `set_file_meta` | ✅ Metadatos |
| `get_file_meta` | ✅ Lectura consistente |
| `tag_template` | ✅ Tags funcionales |
| `find_templates` | ✅ Búsqueda por tag |
| `detect_structure` | ✅ Detecta regions |
| `render_html_template` | ✅ Render URL generada |
| `render_to_formats` | ✅ Multi-formato render |
| `profile_template_pool` | ✅ Profile slots |
| `generate_csv_template` | ✅ CSV generado |
| `set_css_variable` | ✅ CSS custom props |
| `get_css_variables` | ✅ Lee variables |
| `export_frame` | ✅ SVG export funciona |
| `rename_template` | ✅ Renombra |
| `list_api_keys` | ✅ Lista keys activas |
| `list_assets` | ✅ Lista vacía (esperado) |
| `get_font_details` | ✅ Inter: 400, 700 |
| `add_font_to_template` | ✅ @import inyectado |
| `add_primitive` | ✅ Circle añadido |
| `list_all_texts` | ✅ Extrae textos de frames |

---

## 🔧 Fixes Pendientes (Priorizados)

### P0 — Urgente
1. **color_picker**: alinear schema (`hex`) con implementación (`color`)
2. **suggest_color_palette**: alinear schema (`base`) con implementación (`baseColor`)
3. **get_template_structure**: hacer que lea HTML del frame, no del template root

### P1 — Alto
4. **set_frame_layers**: devolver `{ success, layerIds[] }` en lugar de `{}`
5. **duplicate_frame**: fixear desestructuración de frameId
6. **copy_as**: devolver error claro sobre parámetros requeridos
7. **insert_icon**: fix crash `.replace()` en undefined

### P2 — Medio
8. **export_template**: devolver JSON exportado
9. **duplicate_template**: devolver templateId del nuevo template
10. **create_collection**: implementar handler (existe en schema pero no en código)
11. **diff_versions**: devolver diff cuando hay 1+ versiones sin requerir fromVersionId explícito
12. **import_svg**: usar `svgContent` o documentar parámetro como `svg`

### P3 — Bajo
13. **search_stock_image**: conectar API key Unsplash/Pexels
14. **OpenRouter keys**: agregar OPENROUTER_API_KEY a Netlify env

---

## 📝 Notas para el Agente IDE

### Auth flow que FUNCIONA:
1. Crear key en `workspace_api_keys` via Supabase service_role
2. Formato: `fdr_ws_<base64url(16 bytes)>`
3. Enviar como `x-api-key` header en cada POST
4. El MCP valida contra `key_hash` (SHA-256)

### Legacy vs Nuevo:
- La tabla `api_keys` (formato `fd_*`) NO es usada por el MCP
- La tabla `workspace_api_keys` (formato `fdr_ws_*`) es la que valida
- El `MCP_ADMIN_KEY` env var es bypass total (no necesita tabla)

### Errores silenciosos (sin error code):
- `set_frame_layers` → `{}` (debería ser `{ success: true }`)
- `export_template` → `{}` (debería contener JSON)
- `duplicate_template` → `{}` (debería tener `id`)
