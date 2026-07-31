import { useState, useRef, useEffect, useCallback } from "react";
import { mcpCall } from "../lib/mcpClient";

/**
 * ChatFAB — global floating chat button + right-side panel.
 * Available everywhere: Dashboard, EditorV2, Kanban, Graph, Settings, Workspace.
 *
 * Click the 💬 FAB → right panel slides in with accordion sections.
 * Close it → content goes full-width. Responsive.
 *
 * Two modes (Qoder-style):
 *   agent — the AI acts as the Harness leader, orchestrating via MCP tools
 *   act   — the AI directly executes MCP tools (no orchestration, fire-and-apply)
 */

type Role = "user" | "assistant" | "system";
interface Message { role: Role; content: string; ts?: number }

/**
 * fetchWithRetry — wraps fetch with AbortController timeout AND exponential backoff retry.
 * Prevents UI freezes (timeout) and transient API failures (retry).
 * - Timeout: 90s per attempt (LLM calls can be slow with large tool schemas)
 * - Retries: 2 (3 total attempts), backoff: 1s, 2s
 * - Only retries on network errors and 429/500/502/503/504
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  opts: { timeoutMs?: number; maxRetries?: number } = {},
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const maxRetries = opts.maxRetries ?? 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      // Retry on server errors and rate limiting
      if (resp.status >= 500 || resp.status === 429) {
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
          continue;
        }
      }
      return resp;
    } catch (err: any) {
      clearTimeout(timeoutId);
      const isAbort = err?.name === "AbortError";
      const isNetwork = !isAbort;
      if (attempt < maxRetries && (isNetwork || isAbort)) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      throw err;
    }
  }
  throw new Error("fetchWithRetry: unreachable");
}

const PROVIDERS = [
  { id: "openai", label: "OpenAI", defaultModel: "gpt-4o-mini", endpoint: "https://api.openai.com/v1/chat/completions", keyPrefix: "sk-", keyEnv: "VITE_OPENAI_API_KEY" },
  { id: "anthropic", label: "Anthropic", defaultModel: "claude-3-5-sonnet-20241022", endpoint: "https://api.anthropic.com/v1/messages", keyPrefix: "sk-ant-", keyEnv: "VITE_ANTHROPIC_API_KEY" },
  { id: "deepseek", label: "DeepSeek", defaultModel: "deepseek-chat", endpoint: "https://api.deepseek.com/v1/chat/completions", keyPrefix: "sk-", keyEnv: "VITE_DEEPSEEK_API_KEY" },
  { id: "openrouter", label: "OpenRouter", defaultModel: "anthropic/claude-3.5-sonnet", endpoint: "https://openrouter.ai/api/v1/chat/completions", keyPrefix: "sk-or-", keyEnv: "VITE_OPENROUTER_API_KEY" },
] as const;

const LS_PROVIDER_KEY = "futuraria-chat-provider";
const LS_LLM_KEY_KEY = "futuraria-chat-llm-key";
const LS_MODEL_KEY = "futuraria-chat-model";
const LS_MESSAGES_KEY = "futuraria-chat-messages";
const MAX_STORED_MESSAGES = 50;

const HARNESS_SYSTEM_PROMPT = `Eres el Leader del Harness de Futuraria Design. NUNCA haces diseño tú mismo. Las únicas tools que tienes son de ORQUESTACIÓN — NO tienes set_html, set_css, create_frame ni ninguna tool de diseño. Esto es ESTRUCTURAL, no una sugerencia: simplemente no existen en tu ambiente.

REGLAS DE RESPUESTA:
- NO describas lo que vas a hacer. Simplemente hazlo llamando la tool.
- NO escribas nombres de tools en el chat. Ejecútalos directamente.
- Solo respondes con texto cuando: (a) saludas, (b) necesitas aclaración, (c) reportas resultado final.
- Tu respuesta final incluye el link del editor: "done → https://design.futuraria.com/#editor/<templateId>"

FLUJO OBLIGATORIO (NO TE LO SALTES):
0. (OPCIONAL, solo primera vez) harness_get_context({ agentType: "leader" }) → obtén convenciones del proyecto.
1. studio_create_card → crea la tarjeta en backlog
2. studio_move_card → mueve a "design"
3. harness_delegate_task({ role: "implementer", taskId: "<cardId>", instruction: "<QUÉ debe hacer el implementer: dimensiones, texto, colores, estilo, y si es crear nuevo o modificar existente con templateId>" })
   - El implementer tiene su propia sesión LLM aislada con tools de diseño únicamente.
   - No puedes predecir qué hará. Solo le das la instrucción y esperas.
   - El resultado incluye templateId si se creó un template.
4. Si el implementer devuelve "done" → studio_move_card → "review"
5. harness_delegate_task({ role: "reviewer", taskId: "<cardId>", instruction: "Verifica: <criterios>" })
   - El reviewer tiene tools de verificación únicamente (get_template, get_frame, lint_design, harness_evaluate_checkpoint).
   - El reviewer DEBE evaluar checkpoints C1-C5 con harness_evaluate_checkpoint.
   - No puede editar. Solo verifica.
6. Si el reviewer devuelve "APPROVED" → harness_complete_feature → studio_move_card → "done" → comparte link
7. Si el reviewer devuelve "CHANGES_REQUESTED" → studio_move_card → "feedback" → re-delega al implementer con las notas

INSTRUCCIONES PARA DELEGAR:
- Implementer: Sé ESPECÍFICO. Incluye dimensiones, texto exacto, colores hex, estilo visual.
  Si hay un templateId existente, pásalo en la instrucción: "Modifica el template tpl_xxx: ..."
  Ej crear: "Crea un post 1080x1080. Texto principal: 'Hola Ren'. Colores: fondo #0A0A1A, texto #F0F0FF, acento #7B2FF7."
  Ej modificar: "Modifica el template tpl_xxx. Cambia el texto a 'Nuevo texto' y el fondo a #FF0000."
- Reviewer: Lista los criterios a verificar y los checkpoints C1-C5.
  Ej: "Verifica C1 (dimensiones 1080x1080), C2 (texto legible), C3 (paleta consistente), C4 (estructura HTML válida), C5 (sin CSS roto)."

PROTOCOLO DE ERRORES:
- Si una tool falla, llama harness_report_error y informa al usuario en una línea.
- Nunca ocultes errores.

LINK DEL EDITOR:
- Cuando el implementer crea un template, el ID (tpl_xxx) viene en el resultado de harness_delegate_task.
- El link del editor es: https://design.futuraria.com/#editor/<templateId>
- Si necesitas encontrar el templateId, llama list_templates o studio_get_card.

PRINCIPIO CRÍTICO:
- Tú ORQUESTAS. No implementas. No diseñas. No escribes HTML/CSS.
- harness_delegate_task es tu tool principal. Úsala SIEMPRE para diseño y review.
- El implementer hace el trabajo. El reviewer verifica. Tú coordinas.`;

const HARNESS_TOOLS = [
  // ═══════════════════════════════════════════════
  //  Workspace & Template CRUD
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "list_workspaces", description: "Lista todos los workspaces del usuario.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "create_workspace", description: "Crea un nuevo workspace.", parameters: { type: "object", required: ["name"], properties: { name: { type: "string" }, description: { type: "string" } } } } },
  { type: "function", function: { name: "list_templates", description: "Lista templates de un workspace con filtros opcionales.", parameters: { type: "object", properties: { workspaceId: { type: "string" }, brandId: { type: "string" }, status: { type: "string" } } } } },
  { type: "function", function: { name: "create_template", description: "Crea un nuevo template (diseño) en un workspace.", parameters: { type: "object", required: ["workspaceId", "name"], properties: { workspaceId: { type: "string" }, name: { type: "string" }, format: { type: "string" }, width: { type: "number" }, height: { type: "number" }, brandId: { type: "string" } } } } },
  { type: "function", function: { name: "create_html_template", description: "Crea un template HTML con contenido inicial.", parameters: { type: "object", required: ["workspaceId", "name"], properties: { workspaceId: { type: "string" }, name: { type: "string" }, html: { type: "string" }, css: { type: "string" }, width: { type: "number" }, height: { type: "number" } } } } },
  { type: "function", function: { name: "create_deck", description: "Crea un deck (conjunto de slides/frames) desde datos estructurados.", parameters: { type: "object", required: ["workspaceId", "name"], properties: { workspaceId: { type: "string" }, name: { type: "string" }, slides: { type: "array" }, brandId: { type: "string" } } } } },
  { type: "function", function: { name: "update_template", description: "Actualiza metadata de un template.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" }, name: { type: "string" }, status: { type: "string" }, tags: { type: "array", items: { type: "string" } }, width: { type: "number" }, height: { type: "number" } } } } },
  { type: "function", function: { name: "delete_template", description: "Elimina un template permanentemente.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" } } } } },
  { type: "function", function: { name: "rename_template", description: "Renombra un template.", parameters: { type: "object", required: ["templateId", "name"], properties: { templateId: { type: "string" }, name: { type: "string" } } } } },
  { type: "function", function: { name: "tag_template", description: "Añade tags a un template.", parameters: { type: "object", required: ["templateId", "tags"], properties: { templateId: { type: "string" }, tags: { type: "array", items: { type: "string" } } } } } },
  { type: "function", function: { name: "untag_template", description: "Quita tags de un template.", parameters: { type: "object", required: ["templateId", "tags"], properties: { templateId: { type: "string" }, tags: { type: "array", items: { type: "string" } } } } } },
  { type: "function", function: { name: "find_templates", description: "Busca templates por nombre, tags o metadata.", parameters: { type: "object", properties: { query: { type: "string" }, workspaceId: { type: "string" }, brandId: { type: "string" }, tags: { type: "array", items: { type: "string" } } } } } },
  { type: "function", function: { name: "duplicate_template", description: "Duplica un template completo con todos sus frames.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" }, name: { type: "string" } } } } },
  // ═══════════════════════════════════════════════
  //  Template Inspection & Versioning
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "get_template", description: "Obtiene los datos completos de un template (frames, HTML, CSS, metadata).", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" } } } } },
  { type: "function", function: { name: "get_template_structure", description: "Obtiene la estructura jerárquica de frames de un template.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" } } } } },
  { type: "function", function: { name: "list_versions", description: "Lista el historial de versiones de un template.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" } } } } },
  { type: "function", function: { name: "save_version", description: "Guarda una versión del estado actual de un template.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" }, label: { type: "string" } } } } },
  { type: "function", function: { name: "restore_version", description: "Restaura un template a una versión anterior.", parameters: { type: "object", required: ["templateId", "versionId"], properties: { templateId: { type: "string" }, versionId: { type: "string" } } } } },
  { type: "function", function: { name: "diff_versions", description: "Compara dos versiones de un template. Muestra QUÉ cambió frame por frame, con HTML/CSS before/after. Omite toVersionId para comparar contra el estado actual.", parameters: { type: "object", required: ["templateId", "fromVersionId"], properties: { templateId: { type: "string" }, fromVersionId: { type: "string" }, toVersionId: { type: "string" }, frameId: { type: "string" }, includeUnchanged: { type: "boolean" } } } } },
  // ═══════════════════════════════════════════════
  //  Frame CRUD
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "create_frame", description: "Crea un nuevo frame dentro de un template.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" }, name: { type: "string" }, width: { type: "number" }, height: { type: "number" }, x: { type: "number" }, y: { type: "number" }, html: { type: "string" }, css: { type: "string" }, background: { type: "string" } } } } },
  { type: "function", function: { name: "create_html_frame", description: "Crea un frame con contenido HTML específico.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" }, name: { type: "string" }, html: { type: "string" }, css: { type: "string" }, width: { type: "number" }, height: { type: "number" } } } } },
  { type: "function", function: { name: "list_frames", description: "Lista todos los frames de un template.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" } } } } },
  { type: "function", function: { name: "get_frame", description: "Obtiene el detalle de un frame específico.", parameters: { type: "object", required: ["templateId", "frameId"], properties: { templateId: { type: "string" }, frameId: { type: "string" } } } } },
  { type: "function", function: { name: "get_html_frames", description: "Obtiene todos los frames HTML de un template.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" } } } } },
  { type: "function", function: { name: "delete_frame", description: "Elimina un frame de un template.", parameters: { type: "object", required: ["templateId", "frameId"], properties: { templateId: { type: "string" }, frameId: { type: "string" } } } } },
  { type: "function", function: { name: "duplicate_frame", description: "Duplica un frame dentro de un template.", parameters: { type: "object", required: ["templateId", "frameId"], properties: { templateId: { type: "string" }, frameId: { type: "string" } } } } },
  { type: "function", function: { name: "update_frame_content", description: "Actualiza propiedades de un frame (posición, tamaño, nombre, visibilidad).", parameters: { type: "object", required: ["templateId", "frameId"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, name: { type: "string" }, x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" }, visible: { type: "boolean" } } } } },
  { type: "function", function: { name: "update_html_frame", description: "Actualiza el contenido HTML de un frame HTML.", parameters: { type: "object", required: ["templateId", "frameId"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, html: { type: "string" }, css: { type: "string" } } } } },
  { type: "function", function: { name: "delete_html_frame", description: "Elimina un frame HTML.", parameters: { type: "object", required: ["templateId", "frameId"], properties: { templateId: { type: "string" }, frameId: { type: "string" } } } } },
  { type: "function", function: { name: "get_frame_changes", description: "Obtiene el diff de cambios de un frame.", parameters: { type: "object", required: ["templateId", "frameId"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, since: { type: "string" } } } } },
  // ═══════════════════════════════════════════════
  //  HTML / CSS Design
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "set_html", description: "Establece el HTML de un frame específico.", parameters: { type: "object", required: ["templateId", "frameId", "html"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, html: { type: "string" } } } } },
  { type: "function", function: { name: "set_css", description: "Establece el CSS de un frame específico.", parameters: { type: "object", required: ["templateId", "frameId", "css"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, css: { type: "string" } } } } },
  { type: "function", function: { name: "set_css_variable", description: "Define una variable CSS a nivel template (--primary, --font, etc).", parameters: { type: "object", required: ["templateId", "name", "value"], properties: { templateId: { type: "string" }, name: { type: "string" }, value: { type: "string" } } } } },
  { type: "function", function: { name: "get_css_variables", description: "Lee todas las variables CSS definidas en un template.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" } } } } },
  { type: "function", function: { name: "create_variable", description: "Crea una variable de diseño (color, typografía, etc) en el sistema.", parameters: { type: "object", required: ["name", "value"], properties: { name: { type: "string" }, value: { type: "string" }, type: { type: "string" }, templateId: { type: "string" } } } } },
  { type: "function", function: { name: "link_variable", description: "Vincula una propiedad de un elemento a una variable de diseño.", parameters: { type: "object", required: ["variableId"], properties: { variableId: { type: "string" }, elementSelector: { type: "string" }, property: { type: "string" }, templateId: { type: "string" } } } } },
  { type: "function", function: { name: "extract_variables", description: "Extrae todas las variables de diseño de un template.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" } } } } },
  { type: "function", function: { name: "apply_variables", description: "Aplica un conjunto de variables de diseño a un template.", parameters: { type: "object", required: ["templateId", "variables"], properties: { templateId: { type: "string" }, variables: { type: "object" } } } } },
  // ═══════════════════════════════════════════════
  //  Element Manipulation
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "select_element", description: "Selecciona un elemento DOM dentro de un frame por selector CSS.", parameters: { type: "object", required: ["templateId", "frameId", "selector"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, selector: { type: "string" } } } } },
  { type: "function", function: { name: "update_element", description: "Actualiza propiedades de un elemento (estilos, atributos, contenido).", parameters: { type: "object", required: ["templateId", "frameId", "selector"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, selector: { type: "string" }, styles: { type: "object" }, attributes: { type: "object" }, content: { type: "string" } } } } },
  { type: "function", function: { name: "add_element", description: "Añade un nuevo elemento HTML dentro de un frame.", parameters: { type: "object", required: ["templateId", "frameId", "tag"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, tag: { type: "string" }, parentSelector: { type: "string" }, html: { type: "string" }, styles: { type: "object" }, attributes: { type: "object" } } } } },
  { type: "function", function: { name: "add_primitive", description: "Añade una forma primitiva (rect, circle, ellipse, line, polygon).", parameters: { type: "object", required: ["templateId", "frameId", "type"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, type: { type: "string", enum: ["rect", "circle", "ellipse", "line", "polygon", "star", "triangle"] }, styles: { type: "object" }, attributes: { type: "object" } } } } },
  { type: "function", function: { name: "remove_element", description: "Elimina un elemento del DOM de un frame.", parameters: { type: "object", required: ["templateId", "frameId", "selector"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, selector: { type: "string" } } } } },
  { type: "function", function: { name: "reorder_element", description: "Cambia el orden (z-index) de un elemento en el DOM.", parameters: { type: "object", required: ["templateId", "frameId", "selector", "position"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, selector: { type: "string" }, position: { type: "string", enum: ["front", "back", "forward", "backward"] } } } } },
  { type: "function", function: { name: "change_element_tag", description: "Cambia el tag HTML de un elemento.", parameters: { type: "object", required: ["templateId", "frameId", "selector", "newTag"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, selector: { type: "string" }, newTag: { type: "string" } } } } },
  { type: "function", function: { name: "lock_element", description: "Bloquea/desbloquea un elemento para evitar ediciones.", parameters: { type: "object", required: ["templateId", "frameId", "selector", "locked"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, selector: { type: "string" }, locked: { type: "boolean" } } } } },
  { type: "function", function: { name: "hide_element", description: "Muestra/oculta un elemento.", parameters: { type: "object", required: ["templateId", "frameId", "selector", "hidden"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, selector: { type: "string" }, hidden: { type: "boolean" } } } } },
  { type: "function", function: { name: "set_frame_layers", description: "Define el orden de capas de los frames.", parameters: { type: "object", required: ["templateId", "layers"], properties: { templateId: { type: "string" }, layers: { type: "array", items: { type: "string" }, description: "Array ordenado de frameIds" } } } } },
  { type: "function", function: { name: "set_canvas_layers", description: "Define el orden de capas en el canvas del editor.", parameters: { type: "object", required: ["templateId", "layers"], properties: { templateId: { type: "string" }, layers: { type: "array", items: { type: "string" } } } } } },
  { type: "function", function: { name: "transform_element", description: "Aplica transformaciones CSS a un elemento (rotate, scale, skew, translate).", parameters: { type: "object", required: ["templateId", "frameId", "selector"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, selector: { type: "string" }, rotate: { type: "number" }, scale: { type: "number" }, scaleX: { type: "number" }, scaleY: { type: "number" }, translateX: { type: "number" }, translateY: { type: "number" }, skewX: { type: "number" }, skewY: { type: "number" } } } } },
  { type: "function", function: { name: "group_elements", description: "Agrupa múltiples elementos bajo un contenedor.", parameters: { type: "object", required: ["templateId", "frameId", "selectors"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, selectors: { type: "array", items: { type: "string" } }, groupName: { type: "string" } } } } },
  { type: "function", function: { name: "align_elements", description: "Alinea elementos entre sí dentro de un frame.", parameters: { type: "object", required: ["templateId", "frameId", "selectors", "alignment"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, selectors: { type: "array", items: { type: "string" } }, alignment: { type: "string", enum: ["left", "center", "right", "top", "middle", "bottom", "distribute-horizontal", "distribute-vertical"] } } } } },
  // ═══════════════════════════════════════════════
  //  Shape & Path Tools (Vector)
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "draw_shape", description: "Dibuja una forma geométrica (rect, circle, polygon, etc).", parameters: { type: "object", required: ["templateId", "frameId", "type"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, type: { type: "string" }, x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" }, styles: { type: "object" } } } } },
  { type: "function", function: { name: "draw_path", description: "Dibuja un path SVG desde comandos de path.", parameters: { type: "object", required: ["templateId", "frameId", "d"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, d: { type: "string", description: "SVG path data" }, styles: { type: "object" } } } } },
  { type: "function", function: { name: "draw_bezier", description: "Dibuja una curva Bézier con puntos de control.", parameters: { type: "object", required: ["templateId", "frameId"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, points: { type: "array", description: "Array de {x,y} para puntos de control" }, styles: { type: "object" } } } } },
  { type: "function", function: { name: "edit_path_points", description: "Edita los puntos de un path SVG.", parameters: { type: "object", required: ["templateId", "frameId", "selector"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, selector: { type: "string" }, points: { type: "array", description: "Array de puntos con coordenadas" } } } } },
  { type: "function", function: { name: "edit_path_point", description: "Edita un punto individual de un path.", parameters: { type: "object", required: ["templateId", "frameId", "selector", "pointIndex"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, selector: { type: "string" }, pointIndex: { type: "number" }, x: { type: "number" }, y: { type: "number" }, handleIn: { type: "object" }, handleOut: { type: "object" } } } } },
  { type: "function", function: { name: "shape_to_path", description: "Convierte una forma primitiva a path editable.", parameters: { type: "object", required: ["templateId", "frameId", "selector"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, selector: { type: "string" } } } } },
  { type: "function", function: { name: "pathfinder", description: "Operaciones booleanas entre formas (union, subtract, intersect, exclude).", parameters: { type: "object", required: ["templateId", "frameId", "operation"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, operation: { type: "string", enum: ["union", "subtract", "intersect", "exclude", "divide", "trim"] }, selectors: { type: "array", items: { type: "string" } } } } } },
  { type: "function", function: { name: "set_stroke_style", description: "Define el estilo de borde de un elemento (color, width, dash).", parameters: { type: "object", required: ["templateId", "frameId", "selector"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, selector: { type: "string" }, color: { type: "string" }, width: { type: "number" }, style: { type: "string", enum: ["solid", "dashed", "dotted", "double"] }, dashArray: { type: "string" }, position: { type: "string", enum: ["center", "inside", "outside"] } } } } },
  { type: "function", function: { name: "set_gradient", description: "Aplica un gradiente (linear o radial) a un elemento.", parameters: { type: "object", required: ["templateId", "frameId", "selector"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, selector: { type: "string" }, type: { type: "string", enum: ["linear", "radial", "conic"] }, angle: { type: "number" }, stops: { type: "array", description: "Array de {color, offset}" } } } } },
  { type: "function", function: { name: "set_blend_mode", description: "Cambia el blend mode de un elemento.", parameters: { type: "object", required: ["templateId", "frameId", "selector", "mode"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, selector: { type: "string" }, mode: { type: "string" } } } } },
  { type: "function", function: { name: "outline_stroke", description: "Convierte un stroke en un path relleno (outline).", parameters: { type: "object", required: ["templateId", "frameId", "selector"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, selector: { type: "string" } } } } },
  { type: "function", function: { name: "offset_path", description: "Crea un path desplazado (offset) del path original.", parameters: { type: "object", required: ["templateId", "frameId", "selector", "distance"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, selector: { type: "string" }, distance: { type: "number" }, joins: { type: "string", enum: ["miter", "round", "bevel"] } } } } },
  // ═══════════════════════════════════════════════
  //  Text Tools
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "edit_text_content", description: "Edita el contenido de texto de un elemento dentro de un frame.", parameters: { type: "object", required: ["templateId", "frameId", "selector", "text"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, selector: { type: "string" }, text: { type: "string" } } } } },
  { type: "function", function: { name: "list_all_texts", description: "Lista todos los elementos de texto editables en un template.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" }, frameId: { type: "string" } } } } },
  { type: "function", function: { name: "copy_style", description: "Copia los estilos de un elemento.", parameters: { type: "object", required: ["templateId", "frameId", "selector"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, selector: { type: "string" } } } } },
  { type: "function", function: { name: "paste_style", description: "Pega estilos previamente copiados a un elemento.", parameters: { type: "object", required: ["templateId", "frameId", "selector"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, selector: { type: "string" } } } } },
  { type: "function", function: { name: "set_pseudo_state", description: "Define los estilos de pseudo-estados (:hover, :active, :focus) de un elemento.", parameters: { type: "object", required: ["templateId", "frameId", "selector", "state"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, selector: { type: "string" }, state: { type: "string", enum: ["hover", "active", "focus", "visited", "disabled"] }, styles: { type: "object" } } } } },
  // ═══════════════════════════════════════════════
  //  AI Features
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "generate_from_prompt", description: "Genera HTML+CSS de diseño desde un prompt de texto usando IA.", parameters: { type: "object", required: ["templateId", "prompt"], properties: { templateId: { type: "string" }, prompt: { type: "string" }, frameId: { type: "string" }, width: { type: "number" }, height: { type: "number" } } } } },
  { type: "function", function: { name: "ai_generate_text", description: "Genera contenido de texto con IA (headlines, body copy, CTAs).", parameters: { type: "object", required: ["prompt"], properties: { prompt: { type: "string" }, templateId: { type: "string" }, style: { type: "string" }, count: { type: "number" } } } } },
  { type: "function", function: { name: "ai_generate_image", description: "Genera imágenes con IA y las inserta en el diseño.", parameters: { type: "object", required: ["prompt"], properties: { prompt: { type: "string" }, templateId: { type: "string" }, frameId: { type: "string" }, width: { type: "number" }, height: { type: "number" } } } } },
  { type: "function", function: { name: "ai_palette", description: "Genera una paleta de colores con IA basada en un prompt.", parameters: { type: "object", required: ["prompt"], properties: { prompt: { type: "string" }, count: { type: "number" } } } } },
  { type: "function", function: { name: "ai_suggest_layout", description: "Sugiere layouts basados en un prompt o tipo de diseño.", parameters: { type: "object", required: ["prompt"], properties: { prompt: { type: "string" }, templateId: { type: "string" }, format: { type: "string" } } } } },
  { type: "function", function: { name: "ai_translate", description: "Traduce textos dentro de un diseño usando IA.", parameters: { type: "object", required: ["templateId", "targetLang"], properties: { templateId: { type: "string" }, targetLang: { type: "string" }, sourceLang: { type: "string" }, frameId: { type: "string" } } } } },
  { type: "function", function: { name: "image_to_design", description: "Convierte una imagen a un diseño editable (HTML+CSS).", parameters: { type: "object", required: ["templateId", "imageUrl"], properties: { templateId: { type: "string" }, imageUrl: { type: "string" }, frameId: { type: "string" } } } } },
  { type: "function", function: { name: "enhance_template", description: "Mejora automáticamente un template con IA (espaciado, contraste, tipografía).", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" }, aspects: { type: "array", items: { type: "string" }, enum: ["spacing", "contrast", "typography", "alignment", "consistency"] } } } } },
  { type: "function", function: { name: "generate_ui_components", description: "Genera componentes UI reutilizables (botones, cards, navbars).", parameters: { type: "object", required: ["templateId", "components"], properties: { templateId: { type: "string" }, components: { type: "array", items: { type: "string" }, description: "Tipos: button, card, nav, hero, footer, form, modal" }, stylePrompt: { type: "string" } } } } },
  // ═══════════════════════════════════════════════
  //  Generation & Design Artifacts
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "generate_design_artifacts", description: "Genera assets de diseño (thumbnails, previews) para un template.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" } } } } },
  { type: "function", function: { name: "generate_brand_manual", description: "Genera un brand manual desde los tokens de diseño extraídos.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" }, workspaceId: { type: "string" } } } } },
  { type: "function", function: { name: "generate_csv_template", description: "Genera templates en lote desde un CSV con datos.", parameters: { type: "object", required: ["workspaceId", "csv"], properties: { workspaceId: { type: "string" }, csv: { type: "string", description: "Contenido CSV" }, templateId: { type: "string", description: "Template base" }, brandId: { type: "string" } } } } },
  { type: "function", function: { name: "suggest_color_palette", description: "Sugiere paletas de color basadas en una imagen o prompt.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" }, imageUrl: { type: "string" }, mood: { type: "string" } } } } },
  // ═══════════════════════════════════════════════
  //  Brand & Design System
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "register_brand", description: "Registra una nueva marca con sus assets.", parameters: { type: "object", required: ["name"], properties: { name: { type: "string" }, workspaceId: { type: "string" }, logo: { type: "string" }, colors: { type: "object" }, fonts: { type: "array", items: { type: "string" } } } } } },
  { type: "function", function: { name: "validate_brand", description: "Valida que un template cumpla con las reglas de marca.", parameters: { type: "object", required: ["templateId", "brandId"], properties: { templateId: { type: "string" }, brandId: { type: "string" } } } } },
  { type: "function", function: { name: "auto_fix_brand", description: "Corrige automáticamente inconsistencias de marca en un template.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" } } } } },
  { type: "function", function: { name: "check_contrast", description: "Verifica el contraste de color WCAG en un elemento o template.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, selector: { type: "string" } } } } },
  { type: "function", function: { name: "check_accessibility", description: "Audita accesibilidad del template (WCAG 2.1 AA).", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" }, frameId: { type: "string" } } } } },
  { type: "function", function: { name: "get_brands", description: "Lista todas las marcas registradas.", parameters: { type: "object", properties: { workspaceId: { type: "string" } } } } },
  { type: "function", function: { name: "apply_brand", description: "Aplica una marca a un template (colores, fuentes, logos).", parameters: { type: "object", required: ["templateId", "brandId"], properties: { templateId: { type: "string" }, brandId: { type: "string" } } } } },
  { type: "function", function: { name: "create_brand_guideline", description: "Crea una guía de marca (brand guideline).", parameters: { type: "object", required: ["name"], properties: { name: { type: "string" }, workspaceId: { type: "string" }, colors: { type: "object" }, typography: { type: "object" }, spacing: { type: "object" }, logo: { type: "string" } } } } },
  { type: "function", function: { name: "get_brand_guideline", description: "Obtiene una guía de marca por ID.", parameters: { type: "object", required: ["guidelineId"], properties: { guidelineId: { type: "string" } } } } },
  { type: "function", function: { name: "list_brand_guidelines", description: "Lista todas las guías de marca.", parameters: { type: "object", properties: { workspaceId: { type: "string" } } } } },
  { type: "function", function: { name: "update_brand_guideline", description: "Actualiza una guía de marca.", parameters: { type: "object", required: ["guidelineId"], properties: { guidelineId: { type: "string" }, colors: { type: "object" }, typography: { type: "object" }, spacing: { type: "object" } } } } },
  { type: "function", function: { name: "delete_brand_guideline", description: "Elimina una guía de marca.", parameters: { type: "object", required: ["guidelineId"], properties: { guidelineId: { type: "string" } } } } },
  { type: "function", function: { name: "apply_brand_to_template", description: "Aplica una guía de marca completa a un template.", parameters: { type: "object", required: ["templateId", "guidelineId"], properties: { templateId: { type: "string" }, guidelineId: { type: "string" } } } } },
  { type: "function", function: { name: "get_active_styles", description: "Obtiene los estilos activos aplicados a un template.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" }, frameId: { type: "string" } } } } },
  { type: "function", function: { name: "set_style_lock", description: "Bloquea/desbloquea estilos para prevenir cambios accidentales.", parameters: { type: "object", required: ["templateId", "styleId", "locked"], properties: { templateId: { type: "string" }, styleId: { type: "string" }, locked: { type: "boolean" } } } } },
  { type: "function", function: { name: "find_duplicate_styles", description: "Encuentra estilos duplicados en un template.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" } } } } },
  { type: "function", function: { name: "merge_brand_guidelines", description: "Combina dos guías de marca en una sola.", parameters: { type: "object", required: ["sourceId", "targetId"], properties: { sourceId: { type: "string" }, targetId: { type: "string" } } } } },
  { type: "function", function: { name: "download_style_template", description: "Descarga una plantilla de estilos para subir custom styles.", parameters: { type: "object", properties: { format: { type: "string", enum: ["json", "css", "dtcg"] } } } } },
  // ═══════════════════════════════════════════════
  //  Design System Analysis
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "get_design_system", description: "Obtiene el design system completo extraído de un template.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" } } } } },
  { type: "function", function: { name: "extract_design_system", description: "Extrae el design system de un template (tokens, variables, estilos).", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" } } } } },
  { type: "function", function: { name: "verify_design_system", description: "Verifica la consistencia del design system aplicado.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" } } } } },
  { type: "function", function: { name: "get_design_artifacts", description: "Obtiene todos los artifacts generados de un diseño.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" } } } } },
  { type: "function", function: { name: "lint_design", description: "Analiza un diseño y reporta problemas de consistencia, accesibilidad y buenas prácticas.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" }, frameId: { type: "string" } } } } },
  { type: "function", function: { name: "analyze_template_structure", description: "Analiza la estructura semántica de un template.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" } } } } },
  { type: "function", function: { name: "detect_structure", description: "Detecta automáticamente la estructura de un diseño (header, hero, sections, etc).", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" }, frameId: { type: "string" } } } } },
  { type: "function", function: { name: "export_design_tokens", description: "Exporta tokens de diseño (colores, tipografía, spacing) en formato DTCG.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" } } } } },
  // ═══════════════════════════════════════════════
  //  Export / Render
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "export_template", description: "Exporta un template como ZIP con HTML/CSS/imágenes.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" } } } } },
  { type: "function", function: { name: "export_frame", description: "Exporta un frame específico como PNG.", parameters: { type: "object", required: ["templateId", "frameId"], properties: { templateId: { type: "string" }, frameId: { type: "string" } } } } },
  { type: "function", function: { name: "export_batch", description: "Exporta múltiples templates/frames en lote.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" }, frameIds: { type: "array", items: { type: "string" } }, format: { type: "string", enum: ["png", "pdf", "html"] } } } } },
  { type: "function", function: { name: "export_pdf", description: "Exporta un template como PDF.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" }, frameId: { type: "string" } } } } },
  { type: "function", function: { name: "copy_as", description: "Copia un elemento o frame como PNG/SVG al portapapeles.", parameters: { type: "object", required: ["templateId", "frameId"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, selector: { type: "string" }, format: { type: "string", enum: ["png", "svg"] } } } } },
  { type: "function", function: { name: "render_batch", description: "Renderiza múltiples frames/templates en lote.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" }, frameIds: { type: "array", items: { type: "string" } } } } } },
  { type: "function", function: { name: "render_html_template", description: "Renderiza un template HTML completo a imagen/PDF.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" }, format: { type: "string", enum: ["png", "pdf", "jpeg"] }, width: { type: "number" }, height: { type: "number" } } } } },
  { type: "function", function: { name: "render_to_formats", description: "Renderiza un template a múltiples formatos de una vez.", parameters: { type: "object", required: ["templateId", "formats"], properties: { templateId: { type: "string" }, formats: { type: "array", items: { type: "string" }, description: "Ej: ['1080x1080', '1200x628', '1920x1080']" }, frameId: { type: "string" } } } } },
  { type: "function", function: { name: "batch_render_html", description: "Renderiza por lote templates HTML a imágenes.", parameters: { type: "object", required: ["templateIds"], properties: { templateIds: { type: "array", items: { type: "string" } }, format: { type: "string" } } } } },
  // ═══════════════════════════════════════════════
  //  Import
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "import_template", description: "Importa un template desde ZIP/JSON.", parameters: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" }, data: { type: "object" }, name: { type: "string" } } } } },
  { type: "function", function: { name: "import_design", description: "Importa un diseño desde DTCG JSON (design tokens).", parameters: { type: "object", required: ["workspaceId", "design"], properties: { workspaceId: { type: "string" }, design: { type: "object" } } } } },
  { type: "function", function: { name: "import_svg", description: "Importa un SVG como frame vectorial en un template.", parameters: { type: "object", required: ["templateId", "svg"], properties: { templateId: { type: "string" }, svg: { type: "string" }, name: { type: "string" } } } } },
  { type: "function", function: { name: "assemble_template", description: "Ensambla un template a partir de múltiples frames/fuentes.", parameters: { type: "object", required: ["workspaceId", "name"], properties: { workspaceId: { type: "string" }, name: { type: "string" }, templateIds: { type: "array", items: { type: "string" } }, brandId: { type: "string" } } } } },
  // ═══════════════════════════════════════════════
  //  Kanban
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "studio_create_card", description: "Crea una nueva tarjeta en el Kanban con tipo, prioridad, brief, acceptance criteria y deadline.", parameters: { type: "object", required: ["title"], properties: { title: { type: "string" }, type: { type: "string", enum: ["banner", "post", "deck", "template", "landing", "factura", "cotizacion", "other"] }, priority: { type: "number", description: "1=urgente, 2=normal, 3=baja" }, brief: { type: "string" }, acceptance: { type: "string", description: "Una línea por criterio, separadas por newline" }, deadline: { type: "string" }, format: { type: "string" }, templateId: { type: "string" }, tags: { type: "array", items: { type: "string" } } } } } },
  { type: "function", function: { name: "studio_list_cards", description: "Lista todas las tarjetas del Kanban con joins a workspace/brand/template.", parameters: { type: "object", properties: { status: { type: "string" } } } } },
  { type: "function", function: { name: "studio_move_card", description: "Mueve una tarjeta a otro estado del Kanban.", parameters: { type: "object", required: ["cardId", "status"], properties: { cardId: { type: "string" }, status: { type: "string", enum: ["backlog", "research", "draft", "design", "review", "feedback", "done"] } } } } },
  { type: "function", function: { name: "studio_get_card", description: "Obtiene el detalle completo de una tarjeta incluyendo actividad y checkpoints.", parameters: { type: "object", required: ["cardId"], properties: { cardId: { type: "string" } } } } },
  // ═══════════════════════════════════════════════
  //  Design Comments
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "comment_add", description: "Añade un comentario anclado a un diseño (x_pct, y_pct). Crea automáticamente una tarea Kanban.", parameters: { type: "object", required: ["templateId", "body"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, body: { type: "string" }, xPct: { type: "number" }, yPct: { type: "number" }, authorName: { type: "string" }, source: { type: "string", enum: ["editor_pin", "mobile_pin", "kanban", "ai_review", "chat"] }, createKanbanTask: { type: "boolean" } } } } },
  { type: "function", function: { name: "comment_list", description: "Lista comentarios de un template/frame.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, status: { type: "string", enum: ["open", "resolved", "archived"] } } } } },
  { type: "function", function: { name: "comment_resolve", description: "Marca un comentario como resuelto.", parameters: { type: "object", required: ["commentId"], properties: { commentId: { type: "string" } } } } },
  { type: "function", function: { name: "comment_reply", description: "Responde a un comentario (hilo).", parameters: { type: "object", required: ["parentId", "templateId", "body"], properties: { parentId: { type: "string" }, templateId: { type: "string" }, body: { type: "string" }, authorName: { type: "string" } } } } },
  // ═══════════════════════════════════════════════
  //  Harness Orchestration
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "harness_healthcheck", description: "Verifica que el entorno del harness está listo (MCP, Supabase, tablas, lint).", parameters: { type: "object", properties: { templateId: { type: "string", description: "Opcional: ID del template para verificar diseño" } } } } },
  { type: "function", function: { name: "harness_get_context", description: "Devuelve AGENTS.md, docs y contexto para un tipo de agente.", parameters: { type: "object", properties: { agentType: { type: "string", enum: ["leader", "implementer", "reviewer", "explorer"] } } } } },
  { type: "function", function: { name: "harness_list_features", description: "Lista las tareas del Kanban filtradas por estado. Cada una trae acceptance criteria.", parameters: { type: "object", properties: { status: { type: "string", enum: ["backlog", "draft", "design", "review", "done", "feedback"] } } } } },
  { type: "function", function: { name: "harness_claim_feature", description: "Toma una tarea del backlog. Falla si ya hay otra activa.", parameters: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" }, assignedTo: { type: "string" } } } } },
  { type: "function", function: { name: "harness_release_feature", description: "Libera una tarea (vuelve a backlog).", parameters: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" } } } } },
  { type: "function", function: { name: "harness_start_session", description: "Inicia una sesión de subagente con rol y plan. Devuelve sessionId y context_summary.", parameters: { type: "object", required: ["taskId", "role"], properties: { taskId: { type: "string" }, role: { type: "string", enum: ["leader", "implementer", "reviewer", "explorer"] }, plan: { type: "string" } } } } },
  { type: "function", function: { name: "harness_log_entry", description: "Anota un evento en la bitácora de la sesión (plan, progress, blocker, etc).", parameters: { type: "object", required: ["sessionId", "content"], properties: { sessionId: { type: "string" }, entryType: { type: "string", enum: ["plan", "progress", "blocker", "decision", "note", "dump"] }, content: { type: "string" } } } } },
  { type: "function", function: { name: "harness_dump_context", description: "Vuelca el contexto actual del agente a la BD para liberar memoria.", parameters: { type: "object", required: ["sessionId", "content"], properties: { sessionId: { type: "string" }, content: { type: "string" } } } } },
  { type: "function", function: { name: "harness_get_entries", description: "Lee la bitácora de una sesión (entries del implementer).", parameters: { type: "object", required: ["sessionId"], properties: { sessionId: { type: "string" } } } } },
  { type: "function", function: { name: "harness_submit_for_review", description: "Implementer pide review. Status de la tarea pasa a review.", parameters: { type: "object", required: ["sessionId"], properties: { sessionId: { type: "string" }, summary: { type: "string" } } } } },
  { type: "function", function: { name: "harness_evaluate_checkpoint", description: "Reviewer evalúa un checkpoint C1-C5 con passed true/false y notas.", parameters: { type: "object", required: ["taskId", "checkpointId", "passed"], properties: { taskId: { type: "string" }, checkpointId: { type: "string", description: "ej: C1, C2, C2_item_1" }, description: { type: "string" }, passed: { type: "boolean" }, notes: { type: "string" } } } } },
  { type: "function", function: { name: "harness_complete_feature", description: "Marca una tarea como done. Falla si hay checkpoints sin evaluar.", parameters: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" } } } } },
  { type: "function", function: { name: "harness_list_cronjobs", description: "Lista los cronjobs programados.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "harness_create_cronjob", description: "Crea un cronjob automático.", parameters: { type: "object", required: ["name", "schedule"], properties: { name: { type: "string" }, schedule: { type: "string", description: "cron expression" }, action: { type: "string" }, featureType: { type: "string" }, workspaceId: { type: "string" }, brandId: { type: "string" } } } } },
  { type: "function", function: { name: "harness_toggle_cronjob", description: "Activa/desactiva un cronjob.", parameters: { type: "object", required: ["cronjobId", "enabled"], properties: { cronjobId: { type: "string" }, enabled: { type: "boolean" } } } } },
  { type: "function", function: { name: "harness_report_error", description: "Registra un error en Supabase (harness_error_logs) para análisis interno. Usar cuando cualquier tool falle.", parameters: { type: "object", required: ["tool", "error_message"], properties: { tool: { type: "string", description: "Nombre de la tool que falló" }, args: { type: "object", description: "Argumentos con los que se llamó" }, error_message: { type: "string", description: "Mensaje de error o resultado" }, step: { type: "number" }, totalSteps: { type: "number" }, round: { type: "number" }, provider: { type: "string" }, source: { type: "string", description: "chatfab, mcp, manual" } } } } },
  { type: "function", function: { name: "harness_delegate_task", description: "DELEGA a un subagente real. Esto spawnea una llamada LLM SEPARADA con contexto aislado y tools restringidas al rol. El Leader NUNCA hace diseño directamente — SIEMPRE delega con esta tool. Retorna un resumen (done/blocked para implementer, APPROVED/CHANGES_REQUESTED para reviewer).", parameters: { type: "object", required: ["role", "instruction"], properties: { role: { type: "string", enum: ["implementer", "reviewer"], description: "implementer ejecuta diseño con tools de diseño, reviewer verifica con tools de solo lectura" }, taskId: { type: "string", description: "ID de la tarjeta Kanban (card_xxx)" }, instruction: { type: "string", description: "Instrucción específica para el subagente. Ej implementer: 'Crea frame 1080x1080 con texto Hola Ren en estilo Futuraria (morado #7B2FF7, Orbitron).' Ej reviewer: 'Verifica: dimensiones 1080x1080, tipografía legible, paleta consistente.'" }, templateId: { type: "string", description: "Template ID si ya existe (tpl_xxx)" } } } } },
  // ═══════════════════════════════════════════════
  //  Fonts
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "list_fonts", description: "Lista las fuentes disponibles en el sistema.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "search_google_fonts", description: "Busca fuentes en Google Fonts por nombre o categoría.", parameters: { type: "object", required: ["query"], properties: { query: { type: "string" }, category: { type: "string" } } } } },
  { type: "function", function: { name: "preview_font", description: "Previsualiza una fuente aplicada a un texto de muestra.", parameters: { type: "object", required: ["fontFamily", "text"], properties: { fontFamily: { type: "string" }, text: { type: "string" }, size: { type: "number" }, weight: { type: "number" } } } } },
  { type: "function", function: { name: "add_font_to_template", description: "Añade una Google Font a un template.", parameters: { type: "object", required: ["templateId", "fontFamily"], properties: { templateId: { type: "string" }, fontFamily: { type: "string" }, weights: { type: "array", items: { type: "string" } } } } } },
  { type: "function", function: { name: "get_font_details", description: "Obtiene detalles de una fuente (estilos disponibles, variantes).", parameters: { type: "object", required: ["fontFamily"], properties: { fontFamily: { type: "string" } } } } },
  // ═══════════════════════════════════════════════
  //  Images & Assets
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "optimize_image", description: "Optimiza una imagen (compresión, resize, formato).", parameters: { type: "object", required: ["assetId"], properties: { assetId: { type: "string" }, width: { type: "number" }, height: { type: "number" }, quality: { type: "number" }, format: { type: "string", enum: ["webp", "png", "jpeg", "avif"] } } } } },
  { type: "function", function: { name: "upload_image", description: "Sube una imagen a Supabase Storage y la registra como asset.", parameters: { type: "object", required: ["file"], properties: { file: { type: "string", description: "Base64 o URL de la imagen" }, workspaceId: { type: "string" }, templateId: { type: "string" }, frameId: { type: "string" } } } } },
  { type: "function", function: { name: "list_assets", description: "Lista los assets de un workspace.", parameters: { type: "object", properties: { workspaceId: { type: "string" }, templateId: { type: "string" }, type: { type: "string", enum: ["image", "video", "font", "icon", "other"] } } } } },
  { type: "function", function: { name: "delete_asset", description: "Elimina un asset del storage.", parameters: { type: "object", required: ["assetId"], properties: { assetId: { type: "string" } } } } },
  { type: "function", function: { name: "replace_asset", description: "Reemplaza un asset existente por uno nuevo.", parameters: { type: "object", required: ["assetId", "file"], properties: { assetId: { type: "string" }, file: { type: "string", description: "Base64 o URL de la nueva imagen" } } } } },
  { type: "function", function: { name: "search_stock_image", description: "Busca imágenes de stock por keyword.", parameters: { type: "object", required: ["query"], properties: { query: { type: "string" }, orientation: { type: "string" }, color: { type: "string" } } } } },
  { type: "function", function: { name: "upload_cover_image", description: "Sube/actualiza la imagen de portada de un template.", parameters: { type: "object", required: ["templateId", "image"], properties: { templateId: { type: "string" }, image: { type: "string", description: "Base64 o URL" } } } } },
  // ═══════════════════════════════════════════════
  //  Icons
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "search_icons", description: "Busca iconos por nombre o keyword.", parameters: { type: "object", required: ["query"], properties: { query: { type: "string" }, style: { type: "string", enum: ["regular", "fill", "duotone", "thin", "light", "bold"] }, limit: { type: "number" } } } } },
  { type: "function", function: { name: "insert_icon", description: "Inserta un icono SVG en un frame.", parameters: { type: "object", required: ["templateId", "frameId", "iconName"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, iconName: { type: "string" }, size: { type: "number" }, color: { type: "string" }, x: { type: "number" }, y: { type: "number" } } } } },
  // ═══════════════════════════════════════════════
  //  Format Adaptations
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "adapt_format", description: "Adapta un diseño a un formato diferente (ej: de 1080x1080 a 1200x628).", parameters: { type: "object", required: ["templateId", "targetFormat"], properties: { templateId: { type: "string" }, targetFormat: { type: "string", description: "Ej: '1200x628', '1920x1080'" }, frameId: { type: "string" } } } } },
  { type: "function", function: { name: "adapt_all_formats", description: "Adapta un diseño a todos los formatos predefinidos de una vez.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" }, frameId: { type: "string" } } } } },
  { type: "function", function: { name: "compare_adaptations", description: "Compara las adaptaciones de formato de un diseño.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" }, originalFrameId: { type: "string" } } } } },
  // ═══════════════════════════════════════════════
  //  Batch & CSV
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "profile_template_pool", description: "Analiza un pool de templates para extraer patrones comunes.", parameters: { type: "object", required: ["templateIds"], properties: { templateIds: { type: "array", items: { type: "string" } } } } } },
  { type: "function", function: { name: "apply_csv_to_frames", description: "Aplica datos CSV a frames de un template (mail merge visual).", parameters: { type: "object", required: ["templateId", "csv"], properties: { templateId: { type: "string" }, csv: { type: "string" }, frameId: { type: "string" }, mapping: { type: "object", description: "Mapeo columna CSV → selector CSS" } } } } },
  { type: "function", function: { name: "list_batch_templates", description: "Lista templates generados por lote desde un CSV.", parameters: { type: "object", properties: { workspaceId: { type: "string" }, batchId: { type: "string" } } } } },
  { type: "function", function: { name: "update_thumbnail", description: "Actualiza la thumbnail de un template.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" }, frameId: { type: "string" } } } } },
  // ═══════════════════════════════════════════════
  //  Recipes
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "save_recipe", description: "Guarda un template como receta reutilizable.", parameters: { type: "object", required: ["templateId", "name"], properties: { templateId: { type: "string" }, name: { type: "string" }, description: { type: "string" }, category: { type: "string" } } } } },
  { type: "function", function: { name: "list_recipes", description: "Lista todas las recetas guardadas.", parameters: { type: "object", properties: { workspaceId: { type: "string" }, category: { type: "string" } } } } },
  { type: "function", function: { name: "get_recipe", description: "Obtiene el detalle de una receta.", parameters: { type: "object", required: ["recipeId"], properties: { recipeId: { type: "string" } } } } },
  { type: "function", function: { name: "create_from_recipe", description: "Crea un nuevo template a partir de una receta.", parameters: { type: "object", required: ["recipeId", "workspaceId", "name"], properties: { recipeId: { type: "string" }, workspaceId: { type: "string" }, name: { type: "string" }, brandId: { type: "string" } } } } },
  // ═══════════════════════════════════════════════
  //  Real-time Collaboration
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "get_active_agents", description: "Lista los agentes activos en un workspace.", parameters: { type: "object", properties: { workspaceId: { type: "string" } } } } },
  { type: "function", function: { name: "subscribe_template", description: "Suscribe a un agente a cambios en tiempo real de un template.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" } } } } },
  { type: "function", function: { name: "unsubscribe_template", description: "Desuscribe a un agente de un template.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" } } } } },
  { type: "function", function: { name: "broadcast_section_change", description: "Notifica un cambio de sección a otros agentes.", parameters: { type: "object", required: ["templateId", "section"], properties: { templateId: { type: "string" }, section: { type: "string" }, change: { type: "object" } } } } },
  { type: "function", function: { name: "claim_section", description: "Toma ownership de una sección del template para edición exclusiva.", parameters: { type: "object", required: ["templateId", "section"], properties: { templateId: { type: "string" }, section: { type: "string" }, agentId: { type: "string" } } } } },
  { type: "function", function: { name: "release_section", description: "Libera una sección previamente reclamada.", parameters: { type: "object", required: ["templateId", "section"], properties: { templateId: { type: "string" }, section: { type: "string" } } } } },
  // ═══════════════════════════════════════════════
  //  API Keys & Auth
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "create_api_key", description: "Crea una nueva API key para acceso MCP.", parameters: { type: "object", properties: { name: { type: "string" }, permissions: { type: "array", items: { type: "string" } }, expiresAt: { type: "string" } } } } },
  { type: "function", function: { name: "revoke_api_key", description: "Revoca una API key existente.", parameters: { type: "object", required: ["keyId"], properties: { keyId: { type: "string" } } } } },
  { type: "function", function: { name: "list_api_keys", description: "Lista todas las API keys del workspace.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "verify_api_key", description: "Verifica si una API key es válida.", parameters: { type: "object", required: ["apiKey"], properties: { apiKey: { type: "string" } } } } },
  { type: "function", function: { name: "auth_token", description: "Genera un token de autenticación para el editor.", parameters: { type: "object", properties: { workspaceId: { type: "string" }, expiresIn: { type: "string" } } } } },
  // ═══════════════════════════════════════════════
  //  Workspace Integrations
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "list_workspace_integrations", description: "Lista las integraciones externas de un workspace.", parameters: { type: "object", properties: { workspaceId: { type: "string" } } } } },
  { type: "function", function: { name: "call_workspace_mcp", description: "Llama a un MCP externo configurado en el workspace.", parameters: { type: "object", required: ["integrationId", "method", "params"], properties: { integrationId: { type: "string" }, method: { type: "string" }, params: { type: "object" } } } } },
  // ═══════════════════════════════════════════════
  //  Graph & Metadata
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "query_design_graph", description: "Consulta el grafo de conocimiento de diseño (relaciones, dependencias).", parameters: { type: "object", required: ["query"], properties: { query: { type: "string" }, templateId: { type: "string" }, workspaceId: { type: "string" } } } } },
  { type: "function", function: { name: "get_file_meta", description: "Obtiene los metadatos de un archivo de diseño.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" } } } } },
  { type: "function", function: { name: "set_file_meta", description: "Establece metadatos personalizados en un archivo de diseño.", parameters: { type: "object", required: ["templateId", "meta"], properties: { templateId: { type: "string" }, meta: { type: "object" } } } } },
  { type: "function", function: { name: "get_metrics", description: "Obtiene métricas de uso del workspace.", parameters: { type: "object", properties: { workspaceId: { type: "string" } } } } },
  // ═══════════════════════════════════════════════
  //  Playbooks & Agent Guides
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "get_playbook", description: "Obtiene un playbook de acciones para un tipo de diseño.", parameters: { type: "object", required: ["type"], properties: { type: { type: "string", enum: ["banner", "post", "deck", "template", "landing", "factura", "cotizacion"] }, templateId: { type: "string" } } } } },
  { type: "function", function: { name: "get_agent_guide", description: "Obtiene la guía de uso para un agente (leader, implementer, etc).", parameters: { type: "object", required: ["agentType"], properties: { agentType: { type: "string", enum: ["leader", "implementer", "reviewer", "explorer"] } } } } },
  { type: "function", function: { name: "observe_session", description: "Observa una sesión activa de otro agente.", parameters: { type: "object", required: ["sessionId"], properties: { sessionId: { type: "string" } } } } },
  // ═══════════════════════════════════════════════
  //  Misc / Utilities
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "color_picker", description: "Analiza un color y devuelve variantes (complementario, análogo, etc).", parameters: { type: "object", required: ["color"], properties: { color: { type: "string" }, format: { type: "string", enum: ["hex", "rgb", "hsl"] } } } } },
  { type: "function", function: { name: "smart_layout", description: "Aplica un layout inteligente (grid, masonry, golden-ratio, etc) a elementos.", parameters: { type: "object", required: ["templateId", "frameId", "type"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, type: { type: "string", enum: ["grid", "masonry", "golden-ratio", "circular", "zigzag", "flex-wrap"] }, selectors: { type: "array", items: { type: "string" } } } } } },
  { type: "function", function: { name: "register_tool", description: "Registra una herramienta MCP externa en el workspace.", parameters: { type: "object", required: ["name", "endpoint"], properties: { name: { type: "string" }, endpoint: { type: "string" }, description: { type: "string" }, schema: { type: "object" } } } } },
  { type: "function", function: { name: "skill_clone", description: "Clona un SKILL.md de un agente para crear uno nuevo.", parameters: { type: "object", required: ["source", "target"], properties: { source: { type: "string", description: "Nombre del skill fuente" }, target: { type: "string", description: "Nombre del nuevo skill" }, overrides: { type: "object" } } } } },
];

// ═══════════════════════════════════════════════
// ROLE-SPECIFIC SYSTEM PROMPTS (for subagents)
// ═══════════════════════════════════════════════

const IMPLEMENTER_PROMPT = `Eres un Implementer del Harness de Futuraria Design. El Leader te delegó UNA tarea de diseño.

PRIMERO DETERMINA EL MODO leyendo el contexto:

MODO A — Crear diseño nuevo (si NO hay templateId en el contexto):
  PASO 1: Llama list_workspaces. Toma el ID del primer workspace.
  PASO 2: Llama create_html_template con workspaceId, name, width, height, html COMPLETO y css COMPLETO.
    ⚠️ CRÍTICO: El html y css deben estar COMPLETOS. No dejes placeholders ni vacíos.
    Escribe TODO el HTML con los textos exactos. Escribe TODO el CSS con colores, fuentes, layout.
  PASO 3: Llama harness_submit_for_review con tu sessionId y un resumen breve.

MODO B — Modificar diseño existente (si HAY templateId en el contexto):
  PASO 1: Llama get_template con el templateId para ver el estado actual.
  PASO 2: Llama list_frames para ver los frames del template.
  PASO 3: Llama set_html y/o set_css con los cambios solicitados para cada frame que necesite edición.
    ⚠️ CRÍTICO: No borres contenido existente vigente. Solo aplica los cambios pedidos.
  PASO 4: Llama harness_submit_for_review con tu sessionId y un resumen breve.

REGLAS GENERALES:
- NO expliques lo que vas a hacer. Ejecuta directamente con tools.
- NO pierdas rondas explorando. Identifica el modo y ejecuta los pasos.
- Si una tool falla, intenta de nuevo con datos corregidos.
- Tu respuesta final es UNA línea: "done -> implementado" o "blocked -> [razón]".

TU SESSION ID: {SESSION_ID}

CONTEXTO DE LA TAREA:
{TASK_CONTEXT}`;

const REVIEWER_PROMPT = `Eres un Reviewer del Harness de Futuraria Design. El Leader te pide verificar el trabajo de un Implementer.

WORKFLOW OBLIGATORIO (exactamente estos pasos):

PASO 1 — Obtén el template a verificar:
  Llama get_template con el templateId del contexto.
  Si no hay templateId, llama list_templates y busca el más reciente por created_at.

PASO 2 — Verifica contenido ACTIVAMENTE (no asumas, INSPECCIONA):
  - ¿El template tiene frames? Si tiene 0 frames → C2 falla.
  - ¿Los frames tienen HTML no vacío? Llama get_frame para cada frame y verifica que html no sea vacío ni un div sin contenido.
  - ¿Las dimensiones del template coinciden con lo solicitado? (ej: width=1080 height=1080)
  - ¿El texto solicitado aparece en el HTML del frame?
  - ¿El CSS tiene colores, fuentes y layout definidos (no está vacío)?

PASO 3 — Evalúa TODOS los checkpoints C1-C5 con harness_evaluate_checkpoint:
  Llama harness_evaluate_checkpoint UNA VEZ por cada checkpoint:
    - C1: Dimensiones correctas. passed=true si width y height coinciden con lo solicitado.
    - C2: Contenido HTML no vacío. passed=true si los frames tienen HTML con texto real.
    - C3: Paleta de colores aplicada. passed=true si el CSS contiene los colores solicitados.
    - C4: Estructura HTML válida. passed=true si las etiquetas están balanceadas.
    - C5: CSS funcional. passed=true si no hay propiedades rotas y el layout es coherente.
  Argumentos: harness_evaluate_checkpoint({ taskId: "<taskId>", checkpointId: "C1", description: "...", passed: true/false, notes: "..." })

PASO 4 — Emite veredicto:
  - Si TODOS los C1-C5 pasaron → responde: APPROVED
  - Si AL MENOS UNO falló → responde: CHANGES_REQUESTED -> [lista de checkpoints fallidos y qué corregir]

REGLAS:
- NO puedes editar ni crear nada. Solo leer y verificar.
- NO apruebes sin haber llamado get_template Y get_frame primero.
- Sé ESCÉPTICO. Un template vacío o con placeholder NUNCA pasa C2.

CONTEXTO DE LA TAREA:
{TASK_CONTEXT}`;

// ═══════════════════════════════════════════════
// TOOL SUBSETS POR ROL
// ═══════════════════════════════════════════════

// ═══════════════════════════════════════════════
// TOOL SUBSETS POR ROL — expanded to eliminate "dead ends".
// Every MCP tool with a real handler is now reachable by at least one agent role.
// Excluded: 6 in-memory tools (observe_session, register_tool, auth_token,
//   subscribe_template, unsubscribe_template, broadcast_section_change)
//   that need Supabase migration before agent exposure.
// ═══════════════════════════════════════════════

// Leader: orchestration + read-only inspection + management.
// NO design execution tools. Inspects state, delegates work, manages resources.
const LEADER_TOOL_NAMES = new Set([
  // ── Kanban ──
  "studio_create_card", "studio_list_cards", "studio_move_card", "studio_get_card",
  // ── Orchestration ──
  "harness_delegate_task", "harness_healthcheck", "harness_get_context", "harness_report_error",
  // ── Feature lifecycle ──
  "harness_list_features", "harness_claim_feature", "harness_release_feature", "harness_complete_feature",
  // ── Session ──
  "harness_get_entries", "harness_submit_for_review",
  // ── Cronjobs ──
  "harness_list_cronjobs", "harness_create_cronjob", "harness_toggle_cronjob",
  // ── Read-only inspection ──
  "list_workspaces", "list_templates", "find_templates",
  "get_template", "get_template_structure", "list_frames", "get_html_frames", "get_frame",
  "get_design_system", "get_design_artifacts", "get_file_meta",
  // ── Template management ──
  "delete_template", "duplicate_template",
  // ── Brand management ──
  "get_brands", "delete_brand_guideline",
  // ── API Keys ──
  "create_api_key", "list_api_keys", "revoke_api_key",
  // ── Monitoring ──
  "get_metrics", "list_workspace_integrations", "call_workspace_mcp", "get_active_agents",
  // ── Playbooks ──
  "get_playbook", "get_agent_guide",
  // ── Comments ──
  "comment_add", "comment_list", "comment_resolve", "comment_reply",
  // ── Batch & Recipes (visibility) ──
  "list_batch_templates", "list_recipes", "get_recipe",
  // ── Versions ──
  "list_versions",
]);

// Implementer: ALL design creation + modification tools.
// Full creative surface: HTML/CSS, elements, shapes, text, AI gen, fonts, assets, brand, export, import.
const IMPLEMENTER_TOOL_NAMES = new Set([
  // ── Workspace ──
  "list_workspaces",
  // ── Template CRUD ──
  "create_html_template", "create_template", "create_deck",
  "update_template", "rename_template", "tag_template", "untag_template",
  "duplicate_template", "delete_template",
  // ── Frame CRUD ──
  "create_frame", "create_html_frame", "list_frames", "get_frame", "get_html_frames",
  "delete_frame", "duplicate_frame", "update_frame_content", "update_html_frame", "delete_html_frame",
  // ── HTML / CSS ──
  "set_html", "set_css",
  "set_css_variable", "get_css_variables",
  "create_variable", "link_variable", "extract_variables", "apply_variables",
  // ── Element Manipulation ──
  "select_element", "update_element", "add_element", "add_primitive",
  "remove_element", "reorder_element", "change_element_tag",
  "lock_element", "hide_element", "set_frame_layers",
  "transform_element", "group_elements", "align_elements",
  // ── Shapes & Paths ──
  "draw_shape", "draw_path", "draw_bezier",
  "edit_path_points", "edit_path_point", "shape_to_path", "pathfinder",
  "set_stroke_style", "set_gradient", "set_blend_mode",
  "outline_stroke", "offset_path",
  // ── Text ──
  "edit_text_content", "list_all_texts", "copy_style", "paste_style", "set_pseudo_state",
  // ── AI Generation ──
  "generate_from_prompt", "ai_generate_text", "ai_generate_image",
  "ai_palette", "ai_suggest_layout", "ai_translate",
  "image_to_design", "enhance_template", "generate_ui_components",
  // ── Design Artifacts ──
  "generate_design_artifacts", "generate_brand_manual",
  "generate_csv_template", "suggest_color_palette",
  // ── Brand & Design System ──
  "register_brand", "apply_brand", "auto_fix_brand",
  "create_brand_guideline", "get_brand_guideline", "list_brand_guidelines", "update_brand_guideline",
  "apply_brand_to_template", "get_active_styles", "set_style_lock",
  "merge_brand_guidelines", "download_style_template", "get_brands",
  // ── Fonts ──
  "list_fonts", "search_google_fonts", "preview_font", "add_font_to_template", "get_font_details",
  // ── Images & Assets ──
  "upload_image", "optimize_image", "list_assets", "delete_asset", "replace_asset",
  "search_stock_image", "upload_cover_image",
  // ── Icons ──
  "search_icons", "insert_icon",
  // ── Format Adaptation ──
  "adapt_format", "adapt_all_formats",
  // ── Export / Render ──
  "export_template", "export_frame", "export_batch", "export_pdf",
  "copy_as", "render_batch", "render_html_template", "render_to_formats", "batch_render_html",
  // ── Import ──
  "import_template", "import_design", "import_svg", "assemble_template",
  // ── Batch / CSV ──
  "apply_csv_to_frames", "update_thumbnail",
  // ── Recipes ──
  "save_recipe", "list_recipes", "get_recipe", "create_from_recipe",
  // ── Versioning ──
  "save_version", "restore_version",
  // ── Inspection (for Mode B: modify existing) ──
  "get_template", "get_template_structure", "find_templates", "get_frame_changes",
  // ── Design Tokens ──
  "export_design_tokens",
  // ── Harness ──
  "harness_submit_for_review", "harness_log_entry", "harness_dump_context", "harness_report_error",
  // ── Collaboration ──
  "claim_section", "release_section",
  // ── Utilities ──
  "color_picker", "skill_clone", "get_file_meta", "set_file_meta",
  "get_playbook", "get_agent_guide",
]);

// Reviewer: ALL verification + inspection + analysis tools.
// Read-only except for comments. Validates, audits, diffs, reports.
const REVIEWER_TOOL_NAMES = new Set([
  // ── Core Inspection ──
  "get_template", "get_template_structure", "get_html_frames", "get_frame",
  "list_templates", "list_frames", "find_templates",
  // ── Lint & Quality ──
  "lint_design",
  // ── Design System Analysis ──
  "get_design_system", "extract_design_system", "verify_design_system",
  "get_design_artifacts", "analyze_template_structure", "detect_structure",
  "export_design_tokens",
  // ── Accessibility ──
  "check_contrast", "check_accessibility",
  // ── Brand Validation ──
  "validate_brand", "get_brands", "get_brand_guideline", "list_brand_guidelines",
  "get_active_styles", "find_duplicate_styles",
  // ── Versioning & Diffs ──
  "list_versions", "diff_versions", "get_frame_changes",
  // ── Visual Export (for verification) ──
  "export_frame", "export_template", "render_batch",
  // ── Format Comparison ──
  "compare_adaptations",
  // ── Profile Analysis ──
  "profile_template_pool",
  // ── CSS / Variables ──
  "get_css_variables", "extract_variables",
  // ── Text Audit ──
  "list_all_texts",
  // ── Asset Audit ──
  "list_assets",
  // ── Font Audit ──
  "list_fonts", "get_font_details",
  // ── Comments ──
  "comment_add", "comment_list",
  // ── Metadata ──
  "get_file_meta",
  // ── Metrics ──
  "get_metrics",
  // ── Playbooks ──
  "get_playbook", "get_agent_guide",
  // ── Batch Visibility ──
  "list_batch_templates",
  // ── Recipe Visibility ──
  "list_recipes", "get_recipe",
  // ── Harness ──
  "harness_get_entries", "harness_evaluate_checkpoint",
  "harness_healthcheck", "harness_log_entry", "harness_dump_context", "harness_report_error",
]);

const LEADER_TOOLS = HARNESS_TOOLS.filter(t => LEADER_TOOL_NAMES.has(t.function.name));
const IMPLEMENTER_TOOLS = HARNESS_TOOLS.filter(t => IMPLEMENTER_TOOL_NAMES.has(t.function.name));
const REVIEWER_TOOLS = HARNESS_TOOLS.filter(t => REVIEWER_TOOL_NAMES.has(t.function.name));

/** Convert OpenAI tool schema to Anthropic format */
const toolsForAnthropic = (tools = HARNESS_TOOLS) => tools.map(t => ({
  name: t.function.name,
  description: t.function.description,
  input_schema: t.function.parameters,
}));

async function executeToolCall(name: string, args: Record<string, any>): Promise<string> {
  try {
    if (name === "harness_delegate_task") {
      return await spawnSubagent(args as any);
    }
    const result = await mcpCall(name, args);
    return JSON.stringify(result, null, 2).slice(0, 4000);
  } catch (e: any) {
    return JSON.stringify({ error: e?.message || "tool call failed" });
  }
}

/**
 * Spawn a subagent — a SEPARATE LLM call with role-specific system prompt
 * and restricted toolset. The subagent has its own tool loop.
 * Returns only a summary reference (not raw content).
 */
async function spawnSubagent(params: {
  role: "implementer" | "reviewer";
  taskId?: string;
  instruction: string;
  templateId?: string;
}): Promise<string> {
  const llmKey = localStorage.getItem(LS_LLM_KEY_KEY) || "";
  const providerId = localStorage.getItem(LS_PROVIDER_KEY) || "deepseek";
  const model = localStorage.getItem(LS_MODEL_KEY) || "";
  const prov = PROVIDERS.find(p => p.id === providerId) || PROVIDERS[0];
  const isAnthropic = providerId === "anthropic";

  if (!llmKey) {
    return JSON.stringify({ error: "No LLM API key found for subagent. Set your API key in chat settings." });
  }

  // 1. Start session in Supabase
  let sessionId = "sess_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  let taskContext = params.instruction;
  try {
    const sessResult = await mcpCall("harness_start_session", {
      taskId: params.taskId || "standalone",
      role: params.role,
      agentName: params.role,
      plan: params.instruction,
    });
    sessionId = sessResult?.session?.id || sessionId;
    if (sessResult?.session?.context_summary) {
      taskContext = sessResult.session.context_summary;
    }
  } catch { /* non-fatal */ }

  // 2. Pick role-specific prompt and tools (inject sessionId for implementer)
  let systemPrompt: string;
  let tools: any[];
  if (params.role === "implementer") {
    systemPrompt = IMPLEMENTER_PROMPT
      .replace("{SESSION_ID}", sessionId)
      .replace("{TASK_CONTEXT}", taskContext);
    tools = IMPLEMENTER_TOOLS;
  } else {
    systemPrompt = REVIEWER_PROMPT.replace("{TASK_CONTEXT}", taskContext);
    tools = REVIEWER_TOOLS;
  }

  // 3. Subagent conversation — fresh, no Leader history
  // Include sessionId in the first message so the subagent can use it immediately
  const subConv: any[] = [{ role: "user", content: `${params.instruction}\n\n[Tu sessionId: ${sessionId}]` }];
  const MAX_SUB_ROUNDS = 15;
  let capturedTemplateId: string | null = null;

  for (let round = 0; round <= MAX_SUB_ROUNDS; round++) {
    let data: any;

    if (isAnthropic) {
      const resp = await fetchWithRetry(prov.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": llmKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: model || prov.defaultModel, max_tokens: 4096, system: systemPrompt, messages: subConv, tools: toolsForAnthropic(tools) }),
      });
      if (!resp.ok) throw new Error(`Subagent ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
      data = await resp.json();
    } else {
      const resp = await fetchWithRetry(prov.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${llmKey}` },
        body: JSON.stringify({ model: model || prov.defaultModel, messages: [{ role: "system", content: systemPrompt }, ...subConv], max_tokens: 4096, tools }),
      });
      if (!resp.ok) throw new Error(`Subagent ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
      data = await resp.json();
    }

    let textContent = "";
    let toolCalls: { id: string; name: string; args: any }[] = [];

    if (isAnthropic) {
      for (const block of data?.content || []) {
        if (block.type === "text") textContent += block.text;
        else if (block.type === "tool_use") toolCalls.push({ id: block.id, name: block.name, args: block.input || {} });
      }
    } else {
      const msg = data?.choices?.[0]?.message;
      if (msg) {
        textContent = msg.content || "";
        for (const tc of msg.tool_calls || []) {
          try { toolCalls.push({ id: tc.id, name: tc.function.name, args: JSON.parse(tc.function.arguments || "{}") }); }
          catch { toolCalls.push({ id: tc.id, name: tc.function.name, args: {} }); }
        }
      }
    }

    // No more tool calls → subagent finished
    if (toolCalls.length === 0) {
      return JSON.stringify({
        delegated: true, role: params.role, sessionId,
        result: textContent.trim().slice(0, 500) || "(sin respuesta del subagente)",
        templateId: capturedTemplateId,
        rounds: round + 1,
      });
    }

    // Push assistant message into subagent conversation
    if (isAnthropic) { subConv.push(data.content); }
    else { subConv.push(data.choices[0].message); }

    // Execute each tool call within the subagent's own loop
    for (const tc of toolCalls) {
      const resultStr = await executeToolCall(tc.name, tc.args);
      // Gap 4: Robust templateId capture from any design tool
      if (!capturedTemplateId) {
        // From create_html_template / create_template result: { id: "tpl_xxx", ... }
        if (tc.name === "create_html_template" || tc.name === "create_template") {
          try {
            const parsed = JSON.parse(resultStr);
            if (parsed?.id) capturedTemplateId = parsed.id;
          } catch { /* non-fatal */ }
        }
        // From set_html / set_css result: { templateId: "tpl_xxx", ... }
        if (tc.name === "set_html" || tc.name === "set_css") {
          try {
            const parsed = JSON.parse(resultStr);
            if (parsed?.templateId) capturedTemplateId = parsed.templateId;
          } catch { /* non-fatal */ }
        }
        // From args of any tool that passes templateId (create_frame, create_html_frame, get_template, etc.)
        if (tc.args?.templateId) {
          capturedTemplateId = tc.args.templateId;
        }
      }
      if (isAnthropic) { subConv.push({ role: "user", content: [{ type: "tool_result", tool_use_id: tc.id, content: resultStr }] }); }
      else { subConv.push({ role: "tool", tool_call_id: tc.id, content: resultStr }); }
    }
  }

  // Max rounds reached
  return JSON.stringify({
    delegated: true, role: params.role, sessionId,
    result: "(subagente alcanzó límite de iteraciones)",
    templateId: capturedTemplateId,
    rounds: MAX_SUB_ROUNDS + 1,
  });
}

interface ToolEvent { tool: string; status: "running" | "done" | "error"; result?: string }

const inputBase: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#e0e0e0",
  outline: "none", fontFamily: "inherit", width: "100%", boxSizing: "border-box",
};

function loadMessages(): Message[] {
  try {
    const raw = localStorage.getItem(LS_MESSAGES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed.slice(-MAX_STORED_MESSAGES);
    }
  } catch {}
  return [{ role: "assistant", content: "Hola. Soy el Leader del Harness. ¿Qué diseño necesitas crear hoy?", ts: Date.now() }];
}

function saveMessages(msgs: Message[]) {
  try { localStorage.setItem(LS_MESSAGES_KEY, JSON.stringify(msgs.slice(-MAX_STORED_MESSAGES))); } catch {}
}

async function appendErrorReport(report: any) {
  // 1. Primary: send to Supabase via MCP
  try {
    await mcpCall("harness_report_error", {
      tool: report.tool,
      args: report.args || {},
      error_message: report.result || report.error_message || "unknown error",
      step: report.step,
      totalSteps: report.totalSteps,
      round: report.round,
      provider: report.provider,
      source: "chatfab",
    });
    return; // success — no need for fallback
  } catch (mcpErr) {
    console.warn("[appendErrorReport] Supabase unreachable, using localStorage fallback:", (mcpErr as any)?.message);
  }

  // 2. Fallback: localStorage if Supabase/MCP is unreachable
  try {
    const raw = localStorage.getItem("futuraria-error-log");
    const log = raw ? JSON.parse(raw) : [];
    log.push({ ...report, _fallback: true, _fallback_reason: "Supabase unreachable via MCP" });
    if (log.length > 100) log.splice(0, log.length - 100);
    localStorage.setItem("futuraria-error-log", JSON.stringify(log));
  } catch {}
}

export function ChatFAB() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(loadMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [provider, setProvider] = useState<string>(() => {
    try { return localStorage.getItem(LS_PROVIDER_KEY) || "openai"; } catch { return "openai"; }
  });
  const [llmKey, setLlmKey] = useState<string>(() => {
    try { return localStorage.getItem(LS_LLM_KEY_KEY) || ""; } catch { return ""; }
  });
  const [model, setModel] = useState<string>(() => {
    try { return localStorage.getItem(LS_MODEL_KEY) || PROVIDERS[0].defaultModel; } catch { return PROVIDERS[0].defaultModel; }
  });
  const [showSettings, setShowSettings] = useState(!llmKey);
  const [accordion, setAccordion] = useState<"config" | "chat" | "tools" | null>("chat");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Persist settings
  useEffect(() => { try { localStorage.setItem(LS_PROVIDER_KEY, provider); } catch {} }, [provider]);
  useEffect(() => { try { localStorage.setItem(LS_LLM_KEY_KEY, llmKey); } catch {} }, [llmKey]);
  useEffect(() => { try { localStorage.setItem(LS_MODEL_KEY, model); } catch {} }, [model]);

  // Persist messages
  useEffect(() => { saveMessages(messages); }, [messages]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, toolEvents]);

  const systemPrompt = HARNESS_SYSTEM_PROMPT;

  const send = useCallback(async () => {
    if (!input.trim() || sending) return;
    if (!llmKey) { setShowSettings(true); setAccordion("config"); return; }

    const userMsg: Message = { role: "user", content: input.trim(), ts: Date.now() };
    let conversation: any[] = [...messages.filter(m => m.role !== "system"), userMsg].map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setSending(true);
    setToolEvents([]);

    const prov = PROVIDERS.find(p => p.id === provider) || PROVIDERS[0];
    const isAnthropic = provider === "anthropic";
    const MAX_TOOL_ROUNDS = 12;

    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        let data: any;

        if (isAnthropic) {
          const resp = await fetchWithRetry(prov.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": llmKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
            body: JSON.stringify({ model: model || prov.defaultModel, max_tokens: 4096, system: systemPrompt, messages: conversation, tools: toolsForAnthropic(LEADER_TOOLS) }),
          });
          if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
          data = await resp.json();
        } else {
          const resp = await fetchWithRetry(prov.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${llmKey}` },
            body: JSON.stringify({ model: model || prov.defaultModel, messages: [{ role: "system", content: systemPrompt }, ...conversation], max_tokens: 4096, tools: LEADER_TOOLS }),
          });
          if (!resp.ok) throw new Error(`${prov.label} ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
          data = await resp.json();
        }

        let textContent = "";
        let toolCalls: { id: string; name: string; args: any }[] = [];

        if (isAnthropic) {
          for (const block of data?.content || []) {
            if (block.type === "text") textContent += block.text;
            else if (block.type === "tool_use") toolCalls.push({ id: block.id, name: block.name, args: block.input || {} });
          }
        } else {
          const msg = data?.choices?.[0]?.message;
          if (msg) {
            textContent = msg.content || "";
            for (const tc of msg.tool_calls || []) {
              try { toolCalls.push({ id: tc.id, name: tc.function.name, args: JSON.parse(tc.function.arguments || "{}") }); }
              catch { toolCalls.push({ id: tc.id, name: tc.function.name, args: {} }); }
            }
          }
        }

        if (toolCalls.length === 0) {
          if (textContent.trim()) setMessages(prev => [...prev, { role: "assistant", content: textContent.trim(), ts: Date.now() }]);
          break;
        }

        // Emit intermediate text BEFORE executing tools (multi-message UX)
        if (textContent.trim()) {
          setMessages(prev => [...prev, { role: "assistant", content: textContent.trim(), ts: Date.now() }]);
        }

        if (isAnthropic) { conversation.push(data.content); }
        else { conversation.push(data.choices[0].message); }

        const errorReports: any[] = [];

        for (let ti = 0; ti < toolCalls.length; ti++) {
          const tc = toolCalls[ti];
          setToolEvents(prev => [...prev, { tool: tc.name, status: "running" }]);
          setAccordion("tools");
          const resultStr = await executeToolCall(tc.name, tc.args);
          const isError = resultStr.includes('"error"') || resultStr.includes('"code":-');
          setToolEvents(prev => prev.map((e, i) => i === prev.length - 1 ? { ...e, status: isError ? "error" as const : "done" as const, result: resultStr.slice(0, 200) } : e));

          // Multi-message: brief tool result
          if (isError) {
            const errReport = {
              tool: tc.name, args: tc.args,
              result: resultStr.slice(0, 500),
              step: ti + 1, totalSteps: toolCalls.length,
              round, timestamp: new Date().toISOString(),
              provider,
            };
            errorReports.push(errReport);
            // Save to errors.json in localStorage for internal tracking
            appendErrorReport(errReport);
            const errSummary = `✕ ${tc.name} falló en paso ${ti + 1}/${toolCalls.length} (ronda ${round + 1})
→ ${resultStr.slice(0, 300)}`;
            setMessages(prev => [...prev, { role: "assistant", content: errSummary, ts: Date.now() }]);
          } else {
            // Brief success note
            const short = resultStr.slice(0, 120).replace(/\n/g, " ");
            setMessages(prev => [...prev, { role: "assistant", content: `✓ ${tc.name} → ${short || "ok"}`, ts: Date.now() }]);
          }

          // ── Post-delegate verification: confirm template exists in DB ──
          // If harness_delegate_task returned a templateId, verify it with get_template
          // before accepting the result. This prevents hallucinated "done" responses.
          let finalResultStr = resultStr;
          if (tc.name === "harness_delegate_task" && !isError) {
            try {
              const parsed = JSON.parse(resultStr);
              const delegateTemplateId = parsed?.templateId;
              const delegateRole = parsed?.role;
              // Only verify after implementer (not reviewer — reviewer doesn't create templates)
              if (delegateTemplateId && delegateRole === "implementer") {
                setToolEvents(prev => [...prev, { tool: "get_template (verify)", status: "running" }]);
                const verifyResult = await mcpCall("get_template", { templateId: delegateTemplateId });
                const verifyOk = verifyResult && !verifyResult.error && (verifyResult.id || verifyResult.template?.id);
                setToolEvents(prev => prev.map((e, i) => i === prev.length - 1 ? { ...e, status: verifyOk ? "done" as const : "error" as const, result: verifyOk ? "Template confirmed" : "Template NOT found" } : e));
                if (!verifyOk) {
                  // Template was NOT created — inject error into conversation for Leader to handle
                  const verifyErr = `⚠️ VERIFICATION FAILED: harness_delegate_task reported templateId "${delegateTemplateId}" but get_template could not find it in the database. The implementer may have returned "done" without actually creating the template. Do NOT move to review — re-delegate to the implementer with clearer instructions.`;
                  finalResultStr = JSON.stringify({ ...parsed, verification_failed: true, verification_error: verifyErr });
                  setMessages(prev => [...prev, { role: "assistant", content: verifyErr, ts: Date.now() }]);
                } else {
                  setMessages(prev => [...prev, { role: "assistant", content: `✓ get_template (verify) → Template confirmed: ${delegateTemplateId}`, ts: Date.now() }]);
                }
              }
            } catch { /* resultStr was not JSON — skip verification */ }
          }

          if (isAnthropic) { conversation.push({ role: "user", content: [{ type: "tool_result", tool_use_id: tc.id, content: finalResultStr }] }); }
          else { conversation.push({ role: "tool", tool_call_id: tc.id, content: finalResultStr }); }
        }

        // If errors occurred, emit a structured error summary to the user
        if (errorReports.length > 0) {
          const summary = `⚠️ Reporte de errores (ronda ${round + 1}):\n${errorReports.map((er, i) => `${i + 1}. ${er.tool} — paso ${er.step}/${er.totalSteps}\n   args: ${JSON.stringify(er.args).slice(0, 150)}\n   ${er.result.slice(0, 200)}`).join("\n")}\n\nEstos errores quedaron registrados en el sistema para análisis.`;
          setMessages(prev => [...prev, { role: "assistant", content: summary, ts: Date.now() }]);
        }

        if (round === MAX_TOOL_ROUNDS) {
          setMessages(prev => [...prev, { role: "assistant", content: textContent.trim() || "(límite de iteraciones alcanzado — revisa el Kanban)", ts: Date.now() }]);
        }
      }
    } catch (e: any) {
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${e?.message || "no se pudo contactar al proveedor"}. Verifica tu API key.`, ts: Date.now() }]);
    } finally {
      setSending(false);
      setToolEvents([]);
    }
  }, [input, sending, llmKey, messages, model, provider, systemPrompt]);

  const panelWidth = 420;

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Abrir chat (Leader)"
          style={{
            position: "fixed", bottom: 24, right: 88, zIndex: 9100,
            width: 52, height: 52, borderRadius: "50%",
            background: "linear-gradient(135deg, rgba(108,92,231,0.85), rgba(167,139,250,0.85))",
            border: "1px solid rgba(167,139,250,0.4)",
            boxShadow: "0 4px 24px rgba(108,92,231,0.35)",
            color: "#fff", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22, transition: "all 0.2s ease",
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.08)"; e.currentTarget.style.boxShadow = "0 6px 32px rgba(108,92,231,0.5)"; }}
          onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 4px 24px rgba(108,92,231,0.35)"; }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}

      {/* Slide-in panel */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 9050,
        width: open ? panelWidth : 0,
        background: "rgba(10,10,15,0.97)",
        borderLeft: open ? "1px solid rgba(255,255,255,0.08)" : "none",
        backdropFilter: "blur(16px)",
        display: "flex", flexDirection: "column",
        transition: "width 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)",
          flexShrink: 0,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#a78bfa" }}>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.75)", flex: 1 }}>Chat</span>

          <button type="button" onClick={() => setOpen(false)} style={{
            background: "rgba(255,255,255,0.05)", border: "none", color: "rgba(255,255,255,0.4)",
            cursor: "pointer", fontSize: 16, borderRadius: 8, padding: "4px 10px", fontFamily: "inherit",
          }}>✕</button>
        </div>

        {/* Accordion: Config */}
        <div style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", flexShrink: 0 }}>
          <button type="button" onClick={() => setAccordion(a => a === "config" ? null : "config")} style={{
            width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 18px",
            background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit",
            color: "rgba(255,255,255,0.4)", fontSize: 11, fontWeight: 600,
          }}>
            <span style={{ fontSize: 10, transition: "transform 0.2s", display: "inline-block", transform: accordion === "config" ? "rotate(0deg)" : "rotate(-90deg)" }}>▾</span>
            Configuración
            <span style={{ marginLeft: "auto", width: 8, height: 8, borderRadius: "50%", background: llmKey ? "#34d399" : "#f87171" }} />
          </button>
          {accordion === "config" && (
            <div style={{ padding: "0 18px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              <select value={provider} onChange={e => { setProvider(e.target.value); const p = PROVIDERS.find(x => x.id === e.target.value); if (p) setModel(p.defaultModel); }} style={{ ...inputBase, width: "100%", padding: "6px 12px", fontSize: 11 }}>
                {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <input value={model} onChange={e => setModel(e.target.value)} placeholder="modelo" style={{ ...inputBase, padding: "6px 12px", fontSize: 11 }} />
              <input type="password" value={llmKey} onChange={e => setLlmKey(e.target.value)} placeholder={`${PROVIDERS.find(p => p.id === provider)?.keyPrefix || "sk-"}... API key`} style={{ ...inputBase, padding: "6px 12px", fontSize: 11, fontFamily: "monospace" }} />
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>Guardado en tu navegador. Se envía directo al proveedor LLM.</span>
            </div>
          )}
        </div>

        {/* Messages */}
        <div ref={scrollRef} style={{
          flex: 1, overflowY: "auto", padding: "14px 18px",
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          {messages.map((m, i) => (
            <div key={i} style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              background: m.role === "user" ? "rgba(108,92,231,0.18)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${m.role === "user" ? "rgba(108,92,231,0.3)" : "rgba(255,255,255,0.06)"}`,
              borderRadius: 12, padding: "10px 14px",
              fontSize: 12.5, lineHeight: 1.5, color: "rgba(255,255,255,0.85)",
              whiteSpace: "pre-wrap", wordBreak: "break-word",
              userSelect: "text", cursor: "text",
            }}>{m.content}</div>
          ))}
          {sending && (
            <div style={{ alignSelf: "flex-start", fontSize: 12, color: "rgba(255,255,255,0.3)", fontStyle: "italic" }}>
              {toolEvents.length > 0 ? "ejecutando…" : "pensando…"}
            </div>
          )}
        </div>

        {/* Tool events (inline) */}
        {toolEvents.length > 0 && (
          <div style={{ padding: "8px 18px", borderTop: "1px solid rgba(255,255,255,0.04)", maxHeight: 120, overflowY: "auto", flexShrink: 0 }}>
            {toolEvents.map((ev, i) => (
              <div key={i} style={{ fontSize: 10, fontFamily: "monospace", color: ev.status === "done" ? "#6ee7b7" : ev.status === "error" ? "#fca5a5" : "rgba(255,255,255,0.4)", display: "flex", gap: 6, alignItems: "center", padding: "2px 0" }}>
                <span>{ev.status === "done" ? "✓" : ev.status === "error" ? "✕" : "⏳"}</span>
                <span style={{ fontWeight: 600 }}>{ev.tool}</span>
                {ev.result && <span style={{ color: "rgba(255,255,255,0.2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{ev.result}</span>}
              </div>
            ))}
          </div>
        )}

        {/* Input */}
        <div style={{ padding: "12px 18px", borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={llmKey ? "Pídele algo al Leader…" : "Configura tu API key ↑"}
              disabled={sending}
              style={{ ...inputBase, flex: 1, padding: "8px 12px", fontSize: 12.5 }}
            />
            <button type="button" onClick={send} disabled={!input.trim() || sending || !llmKey} style={{
              background: input.trim() && !sending && llmKey ? "rgba(108,92,231,0.25)" : "rgba(255,255,255,0.04)",
              color: input.trim() && !sending && llmKey ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.2)",
              border: `1px solid ${input.trim() && !sending && llmKey ? "rgba(108,92,231,0.4)" : "rgba(255,255,255,0.05)"}`,
              borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600,
              cursor: input.trim() && !sending && llmKey ? "pointer" : "not-allowed", fontFamily: "inherit",
            }}>Enviar</button>
          </div>
        </div>
      </div>
    </>
  );
}
