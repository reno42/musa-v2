# REQ-004: Fix capturedTemplateIds blind spot in spawnSubagent

**Status:** `backlog`
**Priority:** `P0 — critico`
**File:** `src/components/ChatFAB.tsx`
**Lines:** 1183-1195

---

## Problema

El sistema de verificacion post-delegate solo reconoce 8 tools para capturar
templateIds. Las otras ~30 tools de diseno que el implementer usa en la practica
(especialmente `import_design`, `set_frame_layers`, `generate_from_prompt`)
crean/modifican templates exitosamente pero el Leader nunca se entera.

Esto causa un bucle: Leader delega → implementer crea disenos (OK) → sistema no
captura IDs → Leader cree que fallo → re-delega → repite → DeepSeek 400.

## Tools que FALTAN en la captura (lineas 1183-1195)

### Creadoras (devuelven `id` en el resultado)

| Tool | Donde esta el ID |
|---|---|
| `create_deck` | `parsed?.id` |
| `import_template` | `parsed?.id` |
| `import_design` | `parsed?.templateId \|\| parsed?.id` |
| `assemble_template` | `parsed?.id` |
| `duplicate_template` | `parsed?.id` |
| `create_from_recipe` | `parsed?.id` |

### Modificadoras (tienen `templateId` en args)

| Tool |
|---|
| `set_frame_layers` |
| `generate_from_prompt` |
| `enhance_template` |
| `generate_ui_components` |
| `image_to_design` |
| `apply_csv_to_frames` |
| `apply_variables` |
| `apply_brand_to_template` |
| `auto_fix_brand` |
| `add_font_to_template` |
| `adapt_format` |
| `adapt_all_formats` |
| `save_version` |
| `restore_version` |
| `rename_template` |
| `tag_template` |
| `untag_template` |
| `duplicate_frame` |
| `replace_asset` |
| `set_css_variable` |
| `create_variable` |
| `link_variable` |
| `update_thumbnail` |

## Solucion propuesta

En lugar de mantener una lista manual (que siempre va a estar incompleta),
cambiar el enfoque a captura **generica**:

```typescript
// REQ-004: Captura generica de templateId para TODAS las tools
// En lugar del if/else rigido actual (lineas 1183-1195), usar:

// 1. Intentar capturar del RESULTADO (para tools creadoras)
try {
  const parsed = JSON.parse(resultStr);
  addCapturedTemplateId(parsed?.id);
  addCapturedTemplateId(parsed?.templateId);
  addCapturedTemplateId(parsed?.data?.id);
  addCapturedTemplateId(parsed?.data?.templateId);
} catch { /* non-fatal */ }

// 2. Intentar capturar de los ARGS (para tools modificadoras)
addCapturedTemplateId(tc.args?.templateId);
addCapturedTemplateId(tc.args?.template_id);
addCapturedTemplateId(tc.args?.id);
```

Esto cubre cualquier tool presente y futura sin necesidad de mantener una lista.

### Alternativa conservadora

Si se prefiere mantener la lista explicita, agregar TODAS las tools faltantes
(listadas arriba) al bloque if/else actual.

## Verificacion

1. Pedir al Leader un diseno que use `import_design`
2. Verificar que el Leader NO re-delegue
3. Verificar que los templateIds aparezcan en `toolEvents`
4. Verificar que no aparezca "El implementer no hizo ninguna llamada real"

## Relacionado

- Bug 1: `harness_report_error` missing de MCP_TOOLS (ya fixeado)
- Bug 2: `harness_dump_context` params incorrectos (ya fixeado)
- Bug 3: `get_brand_guideline` sin guard para undefined (ya fixeado)
