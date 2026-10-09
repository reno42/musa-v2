# REQ-041 — Flows-brand: recetas de diseño, research con IA del nodo e inputs declarados

Fecha: 2026-10-09 · Estado: implementado (local) · Origen: Flows.md (ideas de plantillas de flows) + OK explícito de Ren: "implementa todas… en copys tenemos recetas, sería igual pero con diseños".

## 1. Objetivo

Que los flows de la biblioteca lleguen **vivos**: sin depender de que cada workspace tenga plantillas precargadas, con investigación de web hecha por la MISMA IA del nodo (sin keys de búsqueda nuevas) y con datos que el usuario entrega al correr (mini-form). Todo en Cloudflare Workers + Supabase **freemium**.

## 2. Contract changes (MCP-first)

- `ai.config.webSearch?: bool` — opt-in. El proveedor busca con SU capacidad nativa:
  gemini `google_search` · anthropic `web_search` (web_search_20250305) · openrouter `plugins:[{id:"web"}]`.
  En openai/deepseek/glm/kimi/qwen directo se rechaza con `AI_CONFIG` (usa openrouter, que los cubre con plugin web).
  Freemium: la cuota de búsqueda es la del propio usuario en SU proveedor; cero keys nuevas en Musa.
- `template.config.extraValues?: {token: valor} ≤16` — sustituye `{{token}}` ARBITRARIOS del frame
  (`{{colorPrimario}}`, `{{tipografiaTitulos}}`, …). Además, el item aporta extras: si la IA responde
  `responseFormat:"json"`, sus claves escalares pasan como tokens (aplánarlas con `map` si vienen en `json`).
  Precedencia: extraValues del nodo pisan los del item (el humano gana). Tokens sin valor quedan visibles.
- `template.config.recipe?: {width, height, html ≤64KB, css ≤16KB, background?}` — RECETA de diseño inline:
  el frame viaja en la definición (como las recetas de copy). El nodo queda CONFIGURADO sin templateId/frameId
  (válido incluso `enabled:true`); sin chequeo de workspace (muere `TEMPLATE_NOT_IN_WORKSPACE` para presets).
  El humano reemplaza la receta por SU `templateId+frameId` cuando diseña la pieza — el swap sigue siendo el camino feliz.
- `flow.inputs?: [{key, label?, type?: text|textarea|number|date, required?, default?} ≤12]` — inputs declarados.
  `executeFlow` aplica defaults y exige required sobre `{{input.x}}` ANTES de ejecutar (manual, schedule y webhook
  por igual); faltar un required → `INPUT_REQUIRED` con la lista de campos. `flow_get`/`flow_export` los devuelven;
  el editor los PRESERVA en cada save (no los edita aún).

## 3. Herramientas afectadas

| Tool | Cambio |
|---|---|
| `flow_save` | acepta `inputs` (schema + NODE_SCHEMA_DOC); valida y persiste |
| `flow_run` | `input` documentado: required/default; error `INPUT_REQUIRED` |
| `flow_get` | devuelve `flow.inputs` |
| `flow_export` / `flow_import` | `inputs` viaja en el shape portable |
| `flow_library_list` | expone `inputs` (conteo) por preset + nota de recetas vivas |
| `flow_library_instantiate` | pasa `preset.inputs` a la definición; presets con `recipe` llegan con pendingConfig vacío salvo credenciales |

## 4. Biblioteca (src/data/flowLibrary.ts — fuente única, la importa el Worker vía TS)

3 presets nuevos Flows-brand (13 en total):

1. `preset_manual_marca` — inputs (marca/rubro/público) → `ai` webSearch+JSON (paleta, tipografías, eslogan) → `map` aplana tokens → `template` RECETA 1080×1350 (swatches + muestras tipográficas) → reporte.
2. `preset_investigacion_web` — inputs (tema/enfoque) → `ai` webSearch brief ejecutivo con fuentes → reporte.
3. `preset_evento_recordatorio` — inputs (evento/fecha/ciudad) → `map` → `template` RECETA story 1080×1920.

## 5. UI (FlowsTab)

- ▶ del board: si el flow declara inputs (1 `flow_get`), abre mini-form portal (tipos text/textarea/number/date,
  defaults precargados) y corre `flow_run` con `input`. Sin inputs corre directo (cero fricción, cero regresión).

## 6. Storage (Supabase freemium)

- **v70**: `ALTER TABLE public.flows ADD COLUMN IF NOT EXISTS inputs jsonb NOT NULL DEFAULT '[]'::jsonb;`
  Idempotente. Sin la columna aplicada, el save degrada con gracia (`OPTIONAL_COLUMNS` reintenta sin ella —
  mismo patrón v63/v68). Worker/CF: sin cambios (jsonb viaja en la fila).

## 7. Decisiones

- **D1 webSearch en la IA del nodo** (no un tool `web_search` propio): petición explícita de Ren — "que tomen la
  posta en ese nodo". Menos superficie, cero keys nuevas, cuota del usuario.
- **D2 recipe inline** en vez de aprovisionar plantillas por cuenta: la receta ES el asset (analogía recetas de copy).
  Evita reimplementar `create_template` dentro de `flow_library_instantiate` y no necesita migración.
- **D3 precedencia extraValues > item**: el valor explícito del humano pisa el propuesto por la IA.
- **D4 webSearch directo openai/deepseek/glm/kimi/qwen → error claro**: la búsqueda nativa no es uniforme ahí;
  openrouter los cubre con plugin web. Fallar explícito > silencio sin búsqueda.
- **D5 editor sin UI de inputs en esta fase**: solo preserva. Definir inputs es trabajo de IA/MCP (`flow_save`).

## 8. Hallazgos (desviaciones)

1. **El editor no edita inputs todavía**: FlowEditor los preserva tal cual en el save (si no, cada guardado
   borraría el mini-form). Definirlos/ajustarlos hoy = `flow_save` (IA o MCP). Siguiente paso natural: inspector
   de inputs en el editor (lista clave/label/tipo/required/default).
2. **`flow_library_list` solo expone conteo de inputs** (no los campos): el agente que quiere prellenar hace
   `flow_get` del preset no aplica (presets no son flows) — lee los campos del mini-form en la UI o los declara
   en el `flow_run`. Aceptado para esta fase.
3. **Tokens faltantes quedan visibles en el render** (`{{faltante}}`): decisión deliberada para depurar
   plantillas; si un preset corre sin credencial IA configurada los tokens se ven crudos en el frame de salida.

## 9. QA

`QA/req041-flows-brand.test.mjs` — 16 tests (P041-1..16): normalización y límites de inputs, persistencia
(row/row-export), `INPUT_REQUIRED` antes de ejecutar, default vs payload, cero regresión sin inputs, webSearch
solo-true, receta válida/inválida, extraValues, render de tokens arbitrarios + escape + faltante visible,
extras de item, NODE_SCHEMA_DOC, contrato mcp.mjs, OPTIONAL_COLUMNS/precedencia, presets + migración v70.
