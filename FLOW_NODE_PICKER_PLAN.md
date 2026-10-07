# Plan: Paleta de nodos por categorías (estilo n8n) + nodos por tool

- **Fecha**: 2026-10-07
- **Estado**: PROPUESTA (no implementado). Complementa `FLOW_MUSA_TOOLS_CATALOG.md` (qué tools exponer y en qué tier) y `FLOW_BUILDER_GAP_VS_N8N_V2.md`.
- **Pregunta que responde**: en n8n el panel de nodos tiene buscador + categorías, y dentro de una categoría hay VARIOS nodos específicos (Google Sheets no es un nodo: es Append, Read, Update, Delete...). ¿Qué actualizamos para lograr eso acá, por categoría y por tool?

---

## 0. Respuesta directa a las dos preguntas

**¿"Via API" o "pregúntale a tu IA" son dos nodos diferenciados?** Sí, y ya lo son:

| Nodo | Qué hace | Quién decide | Entrada en la paleta |
|---|---|---|---|
| **Tool MCP** (`type: "tool"`) | Llama UNA tool exacta con args fijos/templables (`{{...}}`) | Tú, al configurar | **Una entrada por tool** ("Bandeja: leer", "Responder mensaje"...), como los nodos de Google Sheets en n8n |
| **Agente IA** (`type: "agent"`) | Loop donde la IA elige tools de una allowlist | La IA, en cada run | **Una sola entrada** "Agente IA" con multi-select de tools agrupadas por categoría |

Son la misma distinción de n8n: nodos deterministas vs AI Agent. Nada se mezcla: si el usuario quiere "cada run responde la bandeja", usa el nodo Tool; si quiere "que la IA investigue y decida", usa el Agente.

**¿Por categoría y por tool?** Sí: categoría → tools específicas. El truco (igual que n8n) es que las entradas de la paleta NO son tipos de nodo nuevos: son **presets del mismo nodo `tool`** con `config.tool` ya fijado. Cientos de entradas visibles, un solo ejecutor.

## 1. Estado actual (verificado hoy)

- Paleta: `NODE_PALETTE` en [flowTypes.ts](src/components/flows/flowTypes.ts) — 28 entradas planas, con buscador ("Buscar nodo… (Tab)") pero **sin categorías**. Con 374 tools esto explota.
- `addNode(type)`: busca la entrada por `type` (relación 1:1 entrada↔tipo). Para presets necesita pasar a 1:N (entrada→tipo+preset).
- Motor: `case "tool"` en [flows-core.mjs](netlify/functions/flows-core.mjs) YA ejecuta cualquier tool MCP con args templables y anti-recursión (`flow_run` a sí mismo bloqueado). **Le faltan las 4 guardas** (sección 4).
- `tools_catalog.json` ya trae `inputSchema` por tool → materia prima para formularios automáticos (sección 5).

## 2. Modelo de datos (flowTypes.ts + nuevo src/data/flowToolCatalog.ts)

```ts
// Entrada de paleta (evolución de la actual):
type PaletteEntry = {
  key: string;          // único: "tool:reply_social", "condition", ...
  type: string;         // tipo de NODO real que ejecuta el engine
  label: string;        // español, orientado a la acción: "Responder mensaje"
  hint: string;         // qué devuelve / para qué sirve
  category: CategoryId; // ver sección 3
  keywords?: string;    // términos extra para el buscador ("dm, reply, instagram")
  config: () => Record<string, any>;  // preset (para tools: { tool, args: {...} })
  formOverride?: string; // id de formulario curado (opcional, sección 5)
};
```

- **Nodos propios** (condition, loop, template...): una entrada cada uno, igual que hoy, ahora con `category`.
- **Tools de Musa**: una entrada por tool en el tier habilitado, `type: "tool"`, preset `{ tool: "reply_social", args: {} }`. La curación (label ES, categoría, keywords, args skeleton) vive en `src/data/flowToolCatalog.ts` — derivada de las tablas del catálogo de tools; NO se shipean las 374 al bundle, solo las de tiers habilitados (~60 entradas iniciales).
- `addNode(entry)`: usa `entry.type` + `entry.config()`; el id generado ya lleva sufijo aleatorio (sin colisiones entre presets del mismo tipo).

## 3. Categorías (11, fijas)

| Categoría | Color | Nodos propios | Tools Musa (entradas) |
|---|---|---|---|
| **Fuentes** | celeste | RSS, X (Nitter), API JSON | — |
| **IA** | rosa | IA, Agente IA | — |
| **Diseño** | magenta | Template | render_batch, batch_render_html, export_frame, render_frame_png, export_pdf, export_template, create_html_carousel, create_chart, apply_csv_to_frames, adapt_all_formats |
| **Social** | violeta | — | list_social_inbox, reply_social, capture_social_contact, publish_content, list_calendar_entries, add_content_idea, update_content, list_social_accounts |
| **CRM** | verde | — | create_crm_contact, create_crm_deal, update_crm_deal, log_interaction, get_crm_overview, list_crm_deals, list_interactions |
| **Marca** | ámbar | — | validate_brand, lint_design, check_contrast, check_accessibility, apply_brand, get_brands |
| **Foto y video** | naranja | — | photo_create_variant, photo_apply_preset, optimize_image, ai_generate_image, video_export |
| **Datos** | azul | map, condition, switch, loop, merge, compare, sort, dedupe, aggregate, limit, code | — |
| **Entrega** | amarillo | HTTP, Sub-flow, (futuro: Salida/result) | — |
| **Utilidades** | gris | wait, wait_webhook, approval, text, report, note, group | — |
| **Tool MCP** | — | entrada genérica "Cualquier tool (avanzado)" para P2/P3 escribiendo el nombre | — |

Reglas: ~11 categorías es el máximo sano (n8n usa ~10 raíces); una tool = exactamente una categoría; las entradas propias de datos/utilidades van completas porque hoy ya son 20.

## 4. Guardas del engine para el nodo `tool` (prerequisito de abrir la paleta)

Hoy el nodo llama cualquier tool sin límites y el bridge es admin sintético — antes de exponerlo con un clic:

1. **Allowlist server-side** (`FLOW_TOOL_ALLOWLIST` en flows-core, tiered): el `case "tool"` rechaza tools fuera del tier habilitado con `MUSA_TOOL_DENIED`. La paleta muestra lo mismo que el motor permite (una sola fuente de verdad: el tier vive en el catálogo y el engine lo importa).
2. **Tenant forzado**: `args.workspaceId` se SOBREESCRIBE con el workspace del run (hoy un arg malicioso podría tocar otro workspace porque el bridge es admin). Igual para `templateId` (validar con `resolveTemplateWorkspace`).
3. **Presupuesto**: `LIMITS.maxToolCallsPerRun` (sugerido 25) — contador por run en executeFlow; excedido → `MUSA_TOOL_RATE`.
4. **Idempotencia de escritura**: tools marcadas `write: true` en el catálogo (reply_social, publish_content, create_crm_*) deduplican por `(flowId, nodeId, runId, hash(args))` — los reintentos de webhook no publican dos veces.
5. **Errores accionables**: mapear rechazos MCP a `MUSA_TOOL_INVALID / MUSA_TOOL_DENIED / MUSA_TOOL_RATE` con mensaje que diga qué hacer.
6. **NODE_SCHEMA_DOC**: documentar el nodo `tool` para las IAs que crean flows (mismas reglas de tier, ejemplos de args templables).

## 5. Formularios por inputSchema (el 80% del ahorro de código)

Un solo componente `ToolConfigForm(toolName)` que genera el formulario desde `inputSchema` de `tools_catalog.json`:

| JSON Schema | Control | Notas |
|---|---|---|
| `type: string` | input de texto | placeholder = description; acepta `{{...}}` |
| `type: number/integer` | input numérico | min/max del schema |
| `type: boolean` | checkbox | |
| `enum` | select | labels ES si hay curación |
| `type: array/object` | textarea JSON con validación | |
| `required` | marca visible | validación antes de guardar |

**Overrides curados** (formulario propio en vez del genérico) para los casos donde el campo lo pide: `credentialId` → el MISMO select de credenciales que ya usan los nodos IA/HTTP; `templateId`/`frameId` → pickers de archivo/frame (el nodo template ya los tiene); todo lo demás genérico. Si un tool no tiene override, cero código de UI.

## 6. UX del picker (FlowEditor)

- **Layout**: mismo panel/modal de hoy, con el buscador arriba (ya existe), debajo **chips de categoría** ("Todas" + las 11) y el listado **agrupado por sección** con headers colapsables (estado abierto/cerrado en localStorage).
- **Búsqueda**: al escribir, la vista pasa a resultados planos rankeados (match en label > keywords > hint), cada fila con badge chico de categoría. El filtro de hoy (`type label hint`) se extiende con `category keywords`.
- **Teclado**: Tab abre (hoy), Esc cierra (hoy), flechas + Enter para agregar sin mouse (P1).
- **Fila**: punto de color de categoría + label + hint truncado; badge de tier en tools ("nuevo" para P0 recién habilitadas).
- **"Mostrar avanzadas"**: toggle que suma las entradas P2 (y la entrada genérica "Cualquier tool") — la paleta default queda en ~90 filas, no 374.
- **Agente IA**: su config de `tools` (allowlist del loop) usa el MISMO browser por categorías en multi-select.

## 7. Mapeo P0 → entradas (labels ES propuestos)

| Categoría | Entrada (label) | Tool | Args skeleton |
|---|---|---|---|
| Social | Bandeja: leer | list_social_inbox | `{}` |
| Social | Responder mensaje | reply_social | `{ messageId: "{{item.id}}", text: "" }` |
| Social | Capturar contacto | capture_social_contact | `{}` |
| Social | Publicar contenido | publish_content | `{}` |
| Social | Calendario: leer | list_calendar_entries | `{}` |
| Social | Idea: crear | add_content_idea | `{ text: "{{item.text}}" }` |
| CRM | Contacto: crear | create_crm_contact | `{}` |
| CRM | Deal: crear | create_crm_deal | `{}` |
| CRM | Deal: actualizar | update_crm_deal | `{}` |
| CRM | Interacción: registrar | log_interaction | `{}` |
| CRM | Pipeline: resumen | get_crm_overview | `{}` |
| Marca | Validar marca | validate_brand | `{}` |
| Marca | Lint de diseño | lint_design | `{}` |
| Diseño | Render en lote | render_batch | `{}` |
| (Agente IA | una entrada, multi-select) | — | — |

## 8. Fases

- **F1 — Picker por categorías** (~0.5 día): `category` en las 28 entradas, chips + secciones agrupadas, búsqueda extendida, refactor `addNode(entry)`. Cero motor.
- **F2 — Guardas + P0** (~1 día): allowlist/tenant/presupuesto/idempotencia del nodo `tool`, NODE_SCHEMA_DOC, 14 entradas P0 con labels del punto 7 (formularios JSON-args simples primero).
- **F3 — Formularios por schema + P1** (~1-2 días): `ToolConfigForm` generator + overrides (credentialId, template/frame) + ~45 entradas P1.
- **F4 — Pulido**: teclado, favoritos/recientes (localStorage), "mostrar avanzadas" P2, iconos por categoría.

## 9. Riesgos y decisiones ya tomadas

- **No romper presets existentes**: `NODE_PALETTE` sigue existiendo (deriva de las entradas); flows guardados no cambian (el `type` del nodo es el mismo `tool`).
- **Bundle**: solo tiers habilitados van al bundle; el catálogo completo ya vive server-side en `tools_catalog.json`/SKILL.md.
- **Paridad UI↔motor**: el tier se define UNA vez (catálogo) y lo consumen paleta, engine y NODE_SCHEMA_DOC — cero drift, mismo principio que el bridge MCP.
- **El nodo genérico "Cualquier tool"** queda para avanzados detrás del toggle; el 95% de los usuarios nunca lo necesita (ese es justamente el punto de las entradas por tool).
