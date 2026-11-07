---
name: musa-automatizaciones
description: Automatizaciones (flows) en Musa. Construir, probar, ejecutar y depurar flujos de nodos tipo n8n (fuentes RSS, X o HTTP, IA, diseño, condiciones, bucles, aprobaciones, encargos a tu IA, herramientas de Musa) y atender sus pausas. Úsala para cualquier proceso repetible de varios pasos.
module: crear/automatizaciones
---

# Automatizaciones · flows

Un **flow** es un grafo de nodos conectados: algo entra (fuente o input), se transforma (IA, código, mapeo, condiciones) y sale (diseños, entradas de calendario, reporte, HTTP). Se editan en Crear › Automatizaciones y por MCP con las mismas herramientas.

**Importante en esta versión:** los flows solo se disparan **manualmente** (botón Ejecutar o `flow_run`). No hay disparo por horario ni por webhook de entrada. Máximo 20 flows por espacio y unas 25 llamadas a herramientas por ejecución.

## Flujos

**Partir de un preset (recomendado)**
1. `flow_library_list()` → presets (noticias RSS → IA → carrusel, vigilancia de competencia, monitor de precios…).
2. `flow_library_instantiate({ presetId, name, workspaceId })` → queda como borrador.
3. `flow_get({ flowId })` → mira `pendingConfig`: lo que falta configurar (credenciales, plantilla, URL).
4. Completa con `flow_save` y prueba (abajo).

**Construir uno desde cero**
1. `flow_save({ workspaceId, name, nodes, edges, trigger: { type: "manual" } })`.
2. Cada nodo: `{ id, type, label, config, position: { x, y } }`. Tipos principales:
   - Fuentes: `source_rss`, `source_nitter` (X), `source_http`.
   - IA: `ai` (proveedor, modelo, prompt, `responseFormat: "json"` con `schema`), `agent` (con herramientas).
   - Diseño: `template` (rellena frames de una plantilla con los datos).
   - Herramientas de Musa: `tool` (`perItem: true` llama una vez por ítem, por ejemplo una entrada de calendario por copy).
   - Lógica: `map`, `condition`, `switch`, `loop`, `merge`, `sort`, `dedupe`, `aggregate`, `limit`, `compare`, `code` (JavaScript), `text`, `subflow`.
   - Pausas: `approval` (una persona aprueba), `ai_task` (encarga trabajo a tu IA), `wait`, `wait_webhook`.
   - Salida: `report`, `preview`, `http`.
3. Referencias entre nodos: `{{input.campo}}`, `{{steps.idDelNodo.campo}}`, `{{item.campo}}` dentro de `perItem`.
4. Credenciales de IA o HTTP: `flow_credentials_set({ name, type, secret, provider, model })` (cifradas). Sin credencial, los nodos de IA usan la llave BYOK del dueño del espacio.

**Probar y depurar**
1. `flow_run_node({ flowId, nodeId, input })` prueba un nodo suelto, sin crear ejecución (ojo: nodos `tool` y `template` sí escriben).
2. `flow_run({ flowId, input })` ejecuta el flow completo.
3. Si falla: `flow_history({ flowId })` → cada paso trae `error.code`; corrige con `flow_save` y vuelve a ejecutar.
4. Para no repetir pasos caros mientras depuras: fija salidas (pins) y corre con `mode: "dev"`; `flow_unpin` las limpia.
5. Si rompiste algo: `flow_versions_list` → `flow_rollback({ flowId, version })`.

**Atender pausas**
- `status: "waiting"` en una aprobación o espera: `flow_resume({ resumeToken, approved?, payload? })`.
- Encargos a tu IA (`ai_task`): `flow_ai_tasks({ workspaceId })` lista los pendientes con su briefing; haz el trabajo con las demás skills y entrega con `flow_ai_complete({ resumeToken, payload })`.

**Mover flows entre espacios**
- `flow_export({ flowId })` (sin credenciales) → `flow_import({ json, workspaceId })` entra como borrador.

## Herramientas

Construir
- `flow_list`, `flow_get`, `flow_save`, `flow_delete`.
- `flow_library_list`, `flow_library_instantiate`.
- `flow_export`, `flow_import`.
- `flow_versions_list`, `flow_rollback`.

Credenciales y datos
- `flow_credentials_list`, `flow_credentials_set`, `flow_credentials_delete`, `flow_oauth2_connect`.
- `flow_static_data_get`, `flow_static_data_set`: memoria que persiste entre ejecuciones (por ejemplo, lo último que se procesó).

Ejecutar y depurar
- `flow_run`, `flow_run_node`, `flow_history`, `flow_unpin`.
- `flow_resume`, `flow_ai_tasks`, `flow_ai_complete`.

## Reglas

- No configures disparos por horario ni webhooks: están desactivados a propósito.
- Cada ejecución tiene unos 25 s: para lotes grandes, varias ejecuciones con input parcial.
- `flow_delete` borra también su historial: solo si lo piden.
- Antes de ejecutar un flow que publica, envía o escribe en el CRM, confirma con la persona.

## Ejemplos

- "Crea un flow que lea el RSS de mi competencia, resuma con IA y me arme un carrusel"
- "El flow de noticias falló, revisa por qué y arréglalo"
- "Atiende las tareas que los flows dejaron para ti"
