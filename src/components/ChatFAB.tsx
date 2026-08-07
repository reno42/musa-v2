import { useState, useRef, useEffect, useCallback } from "react";
import { mcpCall } from "../lib/mcpClient";
import { CHAT_PROVIDERS as PROVIDERS } from "../lib/aiProviders";
import { GovernancePanel, type GovernanceSession } from "./GovernancePanel";
import {
  MAX_SUBAGENT_ROUNDS,
  LLM_MAX_TOKENS,
  MAX_CONTINUE_RETRIES,
  CREATOR_TOOL_NAMES,
  MUTATION_TOOL_NAMES,
  buildWorkManifest,
  captureArtifactIds,
  captureCreatedFrameCount,
  classifyHttpError,
  compactConversationAtomic,
  collectMutationStyleEvidence,
  createSerialPromiseQueue,
  estimateFullRequestTokens,
  evaluateCompleteness,
  extractStyleReferences,
  fetchWithRetry,
  formatDuration,
  formatTokens,
  normalizeToolResult as normalizeAgentToolResult,
  parseToolArguments,
  parseReviewerVerdict,
  readProviderUsage,
  responseStoppedIncomplete,
  sanitizeRuntimeText,
  selectProviderTools,
  serializeValidJson,
  validateConversationStructure,
  validateDesignToolPayload,
  validateWorkContract,
  type ArtifactSnapshot,
  type AgentRunStats,
  type SubagentProgress,
  type WorkContract,
} from "../lib/agentRuntime";

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
/** "step" messages are the leader narrating in-progress work ("voy a crear
 *  la tarjeta...", verification confirmations) — real, but not what a human
 *  wants scrolling through in full size. They render collapsed by default,
 *  muted, grouped between the actual conversational turns. */
interface Message { role: Role; content: string; ts?: number; kind?: "step" }

const LS_PROVIDER_KEY = "futuraria-chat-provider";
const LS_LLM_KEY_KEY = "futuraria-chat-llm-key";
const LS_MODEL_KEY = "futuraria-chat-model";
const LS_MESSAGES_KEY = "futuraria-chat-messages";
const MAX_STORED_MESSAGES = 50;

// ── Multi-model per role ──
// Each agent role (leader, implementer, reviewer) can use a different
// provider+model. API keys are stored per-provider so roles that share a
// provider reuse the same key.
const LS_ROLE_CONFIG_KEY = "futuraria-chat-role-config";
const LS_PROVIDER_KEYS_PREFIX = "futuraria-chat-key-";

type AgentRole = "leader" | "implementer" | "reviewer";
interface RoleConfig { provider: string; model: string }
type RoleConfigMap = Record<AgentRole, RoleConfig>;

const DEFAULT_ROLE_CONFIG: RoleConfigMap = {
  leader:       { provider: "deepseek", model: "deepseek-v4-pro" },
  implementer:  { provider: "deepseek", model: "deepseek-v4-pro" },
  reviewer:     { provider: "deepseek", model: "deepseek-v4-pro" },
};

/** Load role config from localStorage, migrating from old single-model keys. */
function loadRoleConfig(): RoleConfigMap {
  try {
    const raw = localStorage.getItem(LS_ROLE_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Ensure all three roles exist (forward-compat if we add roles later)
      return {
        leader:      parsed.leader      || DEFAULT_ROLE_CONFIG.leader,
        implementer: parsed.implementer || DEFAULT_ROLE_CONFIG.implementer,
        reviewer:    parsed.reviewer    || DEFAULT_ROLE_CONFIG.reviewer,
      };
    }
    // ── Migration from old global keys ──
    const oldProvider = localStorage.getItem(LS_PROVIDER_KEY) || "";
    const oldModel = localStorage.getItem(LS_MODEL_KEY) || "";
    if (oldProvider) {
      const migrated: RoleConfigMap = {
        leader:       { provider: oldProvider, model: oldModel || PROVIDERS.find(p => p.id === oldProvider)?.defaultModel || "deepseek-v4-pro" },
        implementer:  { provider: oldProvider, model: oldModel || PROVIDERS.find(p => p.id === oldProvider)?.defaultModel || "deepseek-v4-pro" },
        reviewer:     { provider: oldProvider, model: oldModel || PROVIDERS.find(p => p.id === oldProvider)?.defaultModel || "deepseek-v4-pro" },
      };
      localStorage.setItem(LS_ROLE_CONFIG_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch { /* fall through to default */ }
  return { ...DEFAULT_ROLE_CONFIG };
}

/** Persist role config. */
function saveRoleConfig(cfg: RoleConfigMap) {
  try { localStorage.setItem(LS_ROLE_CONFIG_KEY, JSON.stringify(cfg)); } catch {}
}

/** Get API key for a provider, migrating from old global key if needed. */
function getProviderKey(providerId: string): string {
  try {
    const key = localStorage.getItem(LS_PROVIDER_KEYS_PREFIX + providerId);
    if (key) return key;
    // Migration: if old global key exists and old provider matches, copy it
    const oldKey = localStorage.getItem(LS_LLM_KEY_KEY);
    const oldProvider = localStorage.getItem(LS_PROVIDER_KEY);
    if (oldKey && oldProvider === providerId) {
      localStorage.setItem(LS_PROVIDER_KEYS_PREFIX + providerId, oldKey);
      return oldKey;
    }
  } catch {}
  return "";
}

/** Set API key for a provider. */
function setProviderKey(providerId: string, key: string) {
  try { localStorage.setItem(LS_PROVIDER_KEYS_PREFIX + providerId, key); } catch {}
}

/** Load all provider keys as a map. */
function loadAllProviderKeys(): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const p of PROVIDERS) {
    keys[p.id] = getProviderKey(p.id);
  }
  return keys;
}

/** Resolve the LLM config (provider, model, key, endpoint) for a given role.
 *  Used by module-level spawnSubagent (reads localStorage directly). */
function resolveRoleLLM(role: AgentRole): {
  providerId: string; model: string; apiKey: string; endpoint: string; isAnthropic: boolean;
} | null {
  const cfg = loadRoleConfig()[role];
  const apiKey = getProviderKey(cfg.provider);
  if (!apiKey) return null;
  const prov = PROVIDERS.find(p => p.id === cfg.provider) || PROVIDERS[0];
  return {
    providerId: cfg.provider,
    model: cfg.model || prov.defaultModel,
    apiKey,
    endpoint: prov.endpoint,
    isAnthropic: cfg.provider === "anthropic",
  };
}

/**
 * Which workspace/template the human is actually looking at right now.
 * executeToolCall/spawnSubagent are module-level functions (not hooks), so
 * the component writes here via an effect instead of threading props
 * through every call. Without this, the model has to call list_workspaces
 * and guess — which silently lands created cards/templates in whichever
 * workspace happens to come back first, invisible to whoever's watching
 * the real Kanban/dashboard.
 */
let currentContext: { workspaceId?: string; templateId?: string; sessionId?: string } = {};

/** Auto-fill workspaceId when the model's tool call omits it but the tool
 *  schema accepts it and we know the current value. Only workspaceId — it's
 *  always safe (just affects where things get filed). templateId is NOT
 *  auto-filled: it means "edit this exact file", and silently attaching
 *  "whatever's open in the editor" to a tool call the model didn't intend
 *  to scope that way is how an unrelated frame got overwritten. templateId
 *  must always come from the model's own explicit choice. */
function resolveArgs(name: string, args: Record<string, any>): Record<string, any> {
  const def = HARNESS_TOOLS.find(t => t.function.name === name);
  const props = def?.function?.parameters?.properties || {};
  const resolved = { ...args };
  if (resolved.workspaceId === undefined && "workspaceId" in props && currentContext.workspaceId) {
    resolved.workspaceId = currentContext.workspaceId;
  }
  return resolved;
}

const HARNESS_SYSTEM_PROMPT = `Eres el Leader del Harness de Futuraria Design. NUNCA haces diseño tú mismo. Las únicas tools que tienes son de ORQUESTACIÓN — NO tienes set_html, set_css, create_frame ni ninguna tool de diseño. Esto es ESTRUCTURAL, no una sugerencia: simplemente no existen en tu ambiente.

{CURRENT_CONTEXT}

REGLA DE WORKSPACE (CRÍTICA):
- SIEMPRE usa el workspaceId del contexto actual arriba para studio_create_card, create_html_template, etc.
- NUNCA llames list_workspaces para "adivinar" cuál usar — el humano ya te dijo cuál está mirando. Si no hay workspaceId en el contexto, ahí sí llama list_workspaces.
- Si el usuario pide explícitamente trabajar en otro workspace, ahí sí ignora esta regla.

REGLAS DE RESPUESTA:
- NO describas lo que vas a hacer. Simplemente hazlo llamando la tool.
- NO escribas nombres de tools en el chat. Ejecútalos directamente.
- Solo respondes con texto cuando: (a) saludas, (b) necesitas aclaración, (c) reportas resultado final.
- Tu respuesta final incluye el link del editor: "done → https://design.futuraria.com/?template=<templateId>"

FLUJO OBLIGATORIO (NO TE LO SALTES):
0. (OBLIGATORIO) harness_get_context({ agentType: "leader" }) → carga memoria, estilos y sesiones previas antes de hacer cualquier cosa.
1. studio_create_card (con el workspaceId del contexto actual) → crea la tarjeta en backlog
2. studio_move_card → mueve a "design"
3. harness_delegate_task({ role: "implementer", taskId: "<cardId>", instruction: "<brief completo>", contract: { mode: "create"|"edit", expectedTemplateCount, expectedFrameCount, requiredWidth, requiredHeight, requiredTexts, requiredTextsByFrame, requiredStyle, brandId } })
   - "3 slides", "carrusel de 3" o "deck de 3" = expectedTemplateCount: 1 y expectedFrameCount: 3.
   - En create_deck, la portada se genera aparte: un deck de 3 frames lleva 2 entries en slides. En create_html_carousel, frames.length es el total exacto.
   - "3 posts/archivos separados" = expectedTemplateCount: 3 y expectedFrameCount: 3.
   - Siempre llena el contrato con cantidades, dimensiones, textos exactos y estilo pedido.
   - Si el humano pide estilo libre/sin estilo, usa requiredStyle: "__free_style__"; nunca lo omitas ni envíes vacío.
   - CRÍTICO — brandId: si en CONTEXTO ACTUAL > ESTILOS ACTIVOS aparece el estilo pedido con un ID exacto (ej: "brand_d414751c-366: Futuraria_Infographic"), pasa ESE brandId en el contrato. El implementer lo usará directo sin buscar, ahorrando tokens y rondas. Solo omite brandId si el estilo NO está en ESTILOS ACTIVOS o BRAND GUIDELINES.
   - El implementer tiene su propia sesión LLM aislada con tools de diseño únicamente.
   - No puedes predecir qué hará. Solo le das la instrucción y esperas.
   - El resultado incluye templateId (y templateIds si creó varios) si se creó algún template.
   - El sistema verifica automáticamente CADA templateId reportado (que exista Y que tenga
     contenido real, no vacío) antes de dejarte continuar. Si ves "verification_failed": true
     en el resultado, ESO ES DEFINITIVO — no lo cuestiones ni lo reinterpretes: no muevas la
     tarjeta a "review", no reportes nada como completado al humano. Lee "verification_error"
     y "failedTemplateIds" y decide entre re-delegar con instrucciones más claras o informar
     honestamente al humano que el diseño no se pudo generar. NUNCA repitas como hecho un
     templateId o una descripción de diseño que solo viste en el texto del implementer sin
     que el sistema lo haya confirmado — el texto del implementer no es fuente de verdad, la
     verificación sí.
4. Si el implementer devuelve "done" (SIN verification_failed) → studio_move_card → "review"
5. harness_delegate_task({ role: "reviewer", taskId: "<cardId>", instruction: "Verifica: <criterios>" })
   - Pasa también contract y templateIds con TODOS los IDs verificados del implementer; nunca solo el más reciente.
   - El reviewer tiene tools de verificación + render + text audit (get_template, get_frame, render_html_template, list_all_texts, lint_design, harness_evaluate_checkpoint).
   - ADEMÁS de C1-C5, el reviewer verifica visualmente (render PNG con render_html_template) y audita el texto extraído (list_all_texts) contra la instrucción original.
   - El reviewer DEBE evaluar checkpoints C1-C5 con harness_evaluate_checkpoint.
   - No puede editar. Solo verifica.
6. Si el reviewer devuelve "APPROVED" → harness_complete_feature → studio_move_card → "done" → comparte link
7. Si el reviewer devuelve "CHANGES_REQUESTED" → studio_move_card → "feedback" → re-delega al implementer con las notas

REGLA DE "NUNCA TOQUES TRABAJO AJENO" (CRÍTICA — el humano ya perdió trabajo por esto):
- Solo pasa un templateId a harness_delegate_task cuando el humano pidió explícitamente modificar/editar algo que YA EXISTE (dijo "esto", "el diseño actual", nombró un template/frame específico, o está claramente continuando una conversación sobre ese archivo).
- Si el humano pide algo NUEVO ("crea un archivo", "haz un nuevo post", "diseña X") — NUNCA pases templateId, aunque haya uno abierto en el editor. El implementer debe crear un template nuevo.
- El templateId "abierto en el editor ahora mismo" (ver CONTEXTO ACTUAL arriba) NO es lo mismo que "el humano quiere que edites esto". Es solo información de dónde está parado — la decisión de tocarlo es tuya, explícita, nunca automática.
- Si tienes dudas sobre si el humano quiere crear algo nuevo o modificar lo existente, PREGUNTA antes de delegar.

INSTRUCCIONES PARA DELEGAR:
- Implementer: Sé ESPECÍFICO. Incluye dimensiones, texto exacto, colores hex, estilo visual.
  Si hay un templateId existente Y el humano pidió modificarlo, pásalo en la instrucción: "Modifica el template tpl_xxx: ..."
  Ej crear: "Crea un post 1080x1080. Texto principal: 'Hola Ren'. Colores: fondo #0A0A1A, texto #F0F0FF, acento #7B2FF7."
  Ej modificar: "Modifica el template tpl_xxx. Cambia el texto a 'Nuevo texto' y el fondo a #FF0000."
- Si el humano menciona un estilo o marca por NOMBRE (ej: "estilo Futuraria"), no necesitas instruir nada
  especial — el implementer SIEMPRE busca por nombre antes de diseñar (biblioteca → archivos → marcas CRM)
  y nunca inventa un estilo con nombre que no existe. Solo menciona el nombre tal cual en la instrucción.
- Reviewer: Lista los criterios a verificar y los checkpoints C1-C5.
  Ej: "Verifica C1 (dimensiones 1080x1080), C2 (texto legible), C3 (paleta consistente), C4 (estructura HTML válida), C5 (sin CSS roto)."

CUANDO EL IMPLEMENTER DEVUELVE "blocked -> style_not_found: ...":
- Esto significa que buscó el estilo por nombre en la biblioteca, en los archivos y en las marcas del CRM,
  y no encontró nada seguro. Trae contigo lo que sí encontró (candidatos parciales) y una sugerencia.
- NO le devuelvas ese texto crudo al humano. Tradúcelo a una pregunta clara y breve, usando lo que el
  implementer encontró. Ej: "No tengo un estilo guardado como 'Futuraria'. Encontré un template llamado
  'Post Futuraria - Hola Ren 3' — ¿extraigo el estilo de ahí, o prefieres que lo cree desde cero con
  colores/tipografía que tú me des?"
- Espera la respuesta del humano. Con eso, re-delega al implementer con instrucciones concretas y explícitas
  (ej: "extrae el estilo del template tpl_xxx y guárdalo como Futuraria_SocialMedia" o "crea el estilo
  Futuraria_SocialMedia con estos colores: ...").
- Una vez creado, ese nombre queda en la biblioteca — no vuelve a pasar para pedidos futuros con el mismo nombre.

PROTOCOLO DE ERRORES:
- Si una tool falla, llama harness_report_error y informa al usuario en una línea.
- Nunca ocultes errores.

LINK DEL EDITOR:
- Cuando el implementer crea un template, el ID (tpl_xxx) viene en el resultado de harness_delegate_task.
- El link del editor es: https://design.futuraria.com/?template=<templateId>
- Si el humano pidió varios diseños, tu respuesta final debe incluir el link de CADA UNO de los
  templateIds verificados (verifiedTemplateIds) — nunca solo el primero.
- Si necesitas encontrar el templateId, llama list_templates o studio_get_card.

MUSA DAILY BATCH — Cola de diseño automatizada:
- Si el humano pide "prepará para mañana", "encolá esto", "procesá en batch" → usa task_queue_add.
- task_queue_add guarda la instrucción en la cola. Musa Batch procesa todo a las 6am (configurable por workspace).
- El humano puede ver el estado de la cola con task_queue_list.
- NO encolas si el humano quiere el diseño AHORA. En ese caso usa el flujo normal (delegar al implementer).
- Cuando encoles, sé específico en las instrucciones (dimensiones, texto exacto, colores hex, estilo) — el batch no puede pedir aclaraciones.

PRINCIPIO CRÍTICO:
- Tú ORQUESTAS. No implementas. No diseñas. No escribes HTML/CSS.
- harness_delegate_task es tu tool principal. Úsala SIEMPRE para diseño y review.
- El implementer hace el trabajo. El reviewer verifica. Tú coordinas.`;

// ═══════════════════════════════════════════════
// BOOTSTRAP CONTEXT — loaded ONCE when chat opens so the Leader starts
// every session with memory instead of from zero.
// ═══════════════════════════════════════════════
interface BootstrapContext {
  workspaceName: string;
  styles: Array<{ id: string; name: string; description?: string }>;
  brands: Array<{ id: string; name: string }>;
  recentTemplates: Array<{ id: string; name: string }>;
  previousSessions: Array<{ id: string; summary: string }>;
  skills: Array<{ name: string; trigger: string; steps: string }>;
  healthOk: boolean;
}

async function bootstrapSession(): Promise<BootstrapContext> {
  const ctx: BootstrapContext = { workspaceName: "", styles: [], brands: [], recentTemplates: [], previousSessions: [], skills: [], healthOk: false };
  try {
    const health = await mcpCall("harness_healthcheck", {}).catch(() => null);
    ctx.healthOk = health?.ok === true;
    if (currentContext.workspaceId) {
      // Fetch workspace name, styles (with IDs), brands, and templates in parallel
      const [wsData, context, activeStyles, brandsData, templates] = await Promise.all([
        mcpCall("list_workspaces", {}).catch(() => null),
        mcpCall("harness_get_context", { agentType: "leader", workspaceId: currentContext.workspaceId }).catch(() => null),
        mcpCall("get_active_styles", { workspaceId: currentContext.workspaceId }).catch(() => null),
        mcpCall("list_brand_guidelines", { workspaceId: currentContext.workspaceId }).catch(() => null),
        mcpCall("list_templates", { workspaceId: currentContext.workspaceId }).catch(() => null),
      ]);

      // Workspace name (agency identity)
      const wsItems = Array.isArray(wsData?.data) ? wsData.data : [];
      const ws = wsItems.find((w: any) => w.id === currentContext.workspaceId);
      ctx.workspaceName = ws?.name || ws?.data?.name || "";

      // Previous sessions
      if (context?.sessions) {
        ctx.previousSessions = context.sessions.slice(0, 3).map((s: any) => ({ id: s.id, summary: s.summary || s.task_title || "Sin resumen" }));
      }

      // Active styles WITH IDs so the leader can pass them directly
      const styleItems = Array.isArray(activeStyles) ? activeStyles : Array.isArray(activeStyles?.styles) ? activeStyles.styles : [];
      ctx.styles = styleItems.slice(0, 20).map((s: any) => ({ id: s.id || s.name || "", name: s.name || s.id || "", description: s.description || "" }));

      // All brand guidelines (names + IDs)
      const brandItems = Array.isArray(brandsData?.brands) ? brandsData.brands : Array.isArray(brandsData) ? brandsData : [];
      ctx.brands = brandItems.slice(0, 30).map((b: any) => ({ id: b.id || "", name: b.name || b.id || "" }));

      // Templates — raise from 5 to 20 so the leader knows what exists
      const templateItems = Array.isArray(templates?.data) ? templates.data : Array.isArray(templates?.templates) ? templates.templates : Array.isArray(templates) ? templates : [];
      ctx.recentTemplates = templateItems.slice(0, 20).map((t: any) => ({ id: t.id, name: t.name || "Sin nombre" }));

      try {
        const playbook = await mcpCall("get_playbook", { name: "multi-agent" }).catch(() => null);
        if (playbook?.content) {
          ctx.skills.push({ name: "multi-agent-playbook", trigger: "design tasks", steps: typeof playbook.content === "string" ? playbook.content.slice(0, 500) : JSON.stringify(playbook.content).slice(0, 500) });
        }
      } catch { /* playbook may not exist */ }
    }
  } catch { /* bootstrap is best-effort */ }
  return ctx;
}

/** Fills in the {CURRENT_CONTEXT} block with what the human is actually looking at. */
function buildSystemPrompt(bootstrap?: BootstrapContext): string {
  const ctxLines: string[] = [];
  if (currentContext.workspaceId) ctxLines.push(`- workspaceId actual: ${currentContext.workspaceId}`);
  if (currentContext.templateId) ctxLines.push(`- templateId actualmente abierto en el editor: ${currentContext.templateId} (si el pedido es sobre "esto"/"este diseño", es este)`);
  if (bootstrap) {
    if (bootstrap.workspaceName) ctxLines.push(`- Workspace/Agencia: ${bootstrap.workspaceName}`);
    if (!bootstrap.healthOk) ctxLines.push("⚠️ HEALTH CHECK FALLÓ. Verifica conexión con Supabase antes de continuar.");
    if (bootstrap.styles.length > 0) {
      ctxLines.push(`ESTILOS ACTIVOS (${bootstrap.styles.length}) — usa estos IDs directamente:`);
      bootstrap.styles.forEach(s => ctxLines.push(`  - ${s.id}: ${s.name}${s.description ? ": " + s.description : ""}`));
    }
    if (bootstrap.brands.length > 0) {
      ctxLines.push(`BRAND GUIDELINES (${bootstrap.brands.length}):`);
      bootstrap.brands.forEach(b => ctxLines.push(`  - ${b.id}: ${b.name}`));
    }
    if (bootstrap.recentTemplates.length > 0) {
      ctxLines.push(`ARCHIVOS DEL WORKSPACE (${bootstrap.recentTemplates.length}):`);
      bootstrap.recentTemplates.forEach(t => ctxLines.push(`  - ${t.id}: ${t.name}`));
    }
    if (bootstrap.previousSessions.length > 0) {
      ctxLines.push("SESIONES PREVIAS (resumen):");
      bootstrap.previousSessions.forEach(s => ctxLines.push(`  - ${s.id}: ${s.summary}`));
    }
    if (bootstrap.skills.length > 0) {
      ctxLines.push("SKILLS CARGADOS:");
      bootstrap.skills.forEach(s => ctxLines.push(`  - ${s.name}: ${s.trigger} → ${s.steps}`));
    }
  }
  const block = ctxLines.length > 0
    ? `CONTEXTO ACTUAL (lo que el humano está mirando ahora mismo):\n${ctxLines.join("\n")}`
    : `CONTEXTO ACTUAL: no se detectó un workspace específico. Llama list_workspaces si necesitas uno.`;
  return HARNESS_SYSTEM_PROMPT.replace("{CURRENT_CONTEXT}", block);
}

const HARNESS_TOOLS = [
  // ═══════════════════════════════════════════════
  //  Workspace & Template CRUD
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "list_workspaces", description: "Lista todos los workspaces del usuario.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "create_workspace", description: "Crea un nuevo workspace.", parameters: { type: "object", required: ["name"], properties: { name: { type: "string" }, description: { type: "string" } } } } },
  { type: "function", function: { name: "list_templates", description: "Lista templates de un workspace con filtros opcionales.", parameters: { type: "object", properties: { workspaceId: { type: "string" }, brandId: { type: "string" }, status: { type: "string" } } } } },
  { type: "function", function: { name: "create_template", description: "Crea un nuevo template (diseño) en un workspace.", parameters: { type: "object", required: ["workspaceId", "name"], properties: { workspaceId: { type: "string" }, name: { type: "string" }, format: { type: "string" }, width: { type: "number" }, height: { type: "number" }, brandId: { type: "string" } } } } },
  { type: "function", function: { name: "create_html_template", description: "Crea un template HTML con contenido inicial.", parameters: { type: "object", required: ["workspaceId", "name"], properties: { workspaceId: { type: "string" }, name: { type: "string" }, html: { type: "string" }, css: { type: "string" }, width: { type: "number" }, height: { type: "number" } } } } },
  { type: "function", function: { name: "create_html_carousel", description: "Crea un carrusel HTML multi-frame atómico con dimensiones personalizadas. Úsalo para carruseles sociales; todos los frames deben traer HTML/CSS finales.", parameters: { type: "object", required: ["workspaceId", "name", "width", "height", "frames"], properties: { workspaceId: { type: "string" }, name: { type: "string" }, width: { type: "number", minimum: 1, maximum: 10000 }, height: { type: "number", minimum: 1, maximum: 10000 }, brandId: { type: "string" }, frames: { type: "array", minItems: 2, maxItems: 40, items: { type: "object", required: ["name", "html", "css"], properties: { name: { type: "string" }, html: { type: "string" }, css: { type: "string" } } } } } } } },
  { type: "function", function: { name: "create_deck", description: "Crea una presentación fija 1920x1080. Siempre añade una portada; total frames = slides.length + 1. Para carrusel/social usa create_html_carousel.", parameters: { type: "object", required: ["workspaceId", "name", "brand", "slides"], properties: { workspaceId: { type: "string" }, name: { type: "string" }, brandId: { type: "string", description: "Brand guideline guardada; su sharedCss se aplica a cada frame." }, brand: { type: "object", required: ["color"], properties: { name: { type: "string" }, color: { type: "string" }, titleFont: { type: "string" }, bodyFont: { type: "string" }, background: { type: "string" } } }, cover: { type: "object", properties: { html: { type: "string" }, css: { type: "string" } } }, slides: { type: "array", description: "Slides de contenido después de la portada automática. Un deck de 3 frames requiere 2 entries.", items: { type: "object", required: ["html", "css"], properties: { title: { type: "string" }, html: { type: "string" }, css: { type: "string" } } } } } } } },
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
  { type: "function", function: { name: "create_brand_guideline", description: "Crea un estilo válido desde templates reales. Exige al menos un artifact sustantivo entre tokensJson, designMd o sharedCss; el backend lo valida. El nombre debe ser único en el workspace; preferí generate_design_artifacts(action='publish') para extraerlo de un diseño.", parameters: { type: "object", required: ["workspaceId", "name", "sourceTemplateIds"], properties: { workspaceId: { type: "string" }, name: { type: "string" }, description: { type: "string" }, tokensJson: { type: "string" }, designMd: { type: "string" }, sharedCss: { type: "string" }, sourceHash: { type: "string" }, styleFingerprint: { type: "string" }, sourceTemplateIds: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string" }, description: "Templates con material real del mismo workspace." } } } } },
  { type: "function", function: { name: "get_brand_guideline", description: "Obtiene una guía de marca por ID dentro de su workspace.", parameters: { type: "object", required: ["workspaceId", "brandId"], properties: { workspaceId: { type: "string" }, brandId: { type: "string", description: "Brand Guideline ID" } } } } },
  { type: "function", function: { name: "list_brand_guidelines", description: "Lista resúmenes compactos. Los artifacts completos se omiten por defecto; para usar un estilo descubierto llama get_brand_guideline por ID.", parameters: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" }, includeArtifacts: { type: "boolean", description: "Incluye documentos completos solo si son imprescindibles. Default false." } } } } },
  { type: "function", function: { name: "update_brand_guideline", description: "Actualiza un estilo sin permitir nombres duplicados ni dejarlo sin referencias o artifacts.", parameters: { type: "object", required: ["workspaceId", "brandId"], properties: { workspaceId: { type: "string" }, brandId: { type: "string", description: "Brand Guideline ID" }, name: { type: "string" }, description: { type: "string" }, tokensJson: { type: "string" }, designMd: { type: "string" }, sharedCss: { type: "string" }, sourceHash: { type: "string" }, styleFingerprint: { type: "string" }, sourceTemplateIds: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string" } }, mode: { type: "string", enum: ["replace", "append"] } } } } },
  { type: "function", function: { name: "delete_brand_guideline", description: "Elimina una guía de marca del workspace y limpia su lock.", parameters: { type: "object", required: ["workspaceId", "brandId"], properties: { workspaceId: { type: "string" }, brandId: { type: "string", description: "Brand Guideline ID" } } } } },
  { type: "function", function: { name: "apply_brand_to_template", description: "Aplica una guía de marca completa a un template.", parameters: { type: "object", required: ["templateId", "brandId"], properties: { templateId: { type: "string" }, brandId: { type: "string", description: "Brand Guideline ID" } } } } },
  { type: "function", function: { name: "get_active_styles", description: "Obtiene los estilos activos bloqueados en un workspace.", parameters: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" } } } } },
  { type: "function", function: { name: "set_style_lock", description: "Bloquea/desbloquea un estilo del workspace.", parameters: { type: "object", required: ["workspaceId", "brandId", "locked"], properties: { workspaceId: { type: "string" }, brandId: { type: "string" }, locked: { type: "boolean" } } } } },
  { type: "function", function: { name: "find_duplicate_styles", description: "Encuentra estilos visualmente duplicados en un workspace.", parameters: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" } } } } },
  { type: "function", function: { name: "merge_brand_guidelines", description: "Combina estilos del mismo workspace en uno canónico.", parameters: { type: "object", required: ["workspaceId", "targetBrandId", "sourceBrandIds"], properties: { workspaceId: { type: "string" }, targetBrandId: { type: "string" }, sourceBrandIds: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string" } } } } } },
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
  { type: "function", function: { name: "studio_create_card", description: "Crea una nueva tarjeta en el Kanban con tipo, prioridad, brief, acceptance criteria y deadline.", parameters: { type: "object", required: ["title"], properties: { title: { type: "string" }, workspaceId: { type: "string", description: "CRÍTICO: usa el workspaceId del contexto actual. Sin esto la tarjeta no aparecerá en el Kanban que el usuario está mirando." }, type: { type: "string", enum: ["banner", "post", "deck", "template", "landing", "factura", "cotizacion", "other"] }, priority: { type: "number", description: "1=urgente, 2=normal, 3=baja" }, brief: { type: "string" }, acceptance: { type: "string", description: "Una línea por criterio, separadas por newline" }, deadline: { type: "string" }, format: { type: "string" }, templateId: { type: "string" }, tags: { type: "array", items: { type: "string" } } } } } },
  { type: "function", function: { name: "studio_list_cards", description: "Lista todas las tarjetas del Kanban con joins a workspace/brand/template.", parameters: { type: "object", properties: { workspaceId: { type: "string", description: "Filtra por el workspace del contexto actual." }, status: { type: "string" } } } } },
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
  { type: "function", function: { name: "harness_log_entry", description: "Anota un evento en la bitácora de la sesión.", parameters: { type: "object", required: ["sessionId", "entryType", "content"], properties: { sessionId: { type: "string" }, entryType: { type: "string", enum: ["plan", "progress", "blocker", "review", "verdict", "summary", "exploration", "context_dump"] }, content: { type: "string" } } } } },
  { type: "function", function: { name: "harness_dump_context", description: "Vuelca el contexto actual del agente a la BD para liberar memoria.", parameters: { type: "object", required: ["sessionId", "content"], properties: { sessionId: { type: "string" }, content: { type: "string" } } } } },
  { type: "function", function: { name: "harness_get_entries", description: "Lee la bitácora de una sesión (entries del implementer).", parameters: { type: "object", required: ["sessionId"], properties: { sessionId: { type: "string" } } } } },
  { type: "function", function: { name: "harness_submit_for_review", description: "Implementer pide review, cierra su sesión e invalida checkpoints previos.", parameters: { type: "object", required: ["sessionId", "summary"], properties: { sessionId: { type: "string" }, summary: { type: "string" } } } } },
  { type: "function", function: { name: "harness_evaluate_checkpoint", description: "Reviewer evalúa exactamente un checkpoint C1-C5 en su sesión activa.", parameters: { type: "object", required: ["taskId", "sessionId", "checkpointId", "description", "passed"], properties: { taskId: { type: "string" }, sessionId: { type: "string" }, checkpointId: { type: "string", enum: ["C1", "C2", "C3", "C4", "C5"] }, description: { type: "string", description: "Criterio objetivo y evidencia evaluada" }, passed: { type: "boolean" }, notes: { type: "string" } } } } },
  { type: "function", function: { name: "harness_complete_feature", description: "Gate exclusivo del reviewer: exige marker real de harness_submit_for_review y C1-C5 frescos antes de completar.", parameters: { type: "object", required: ["taskId", "sessionId"], properties: { taskId: { type: "string" }, sessionId: { type: "string", description: "Sesión reviewer activa que evaluó C1-C5" } } } } },
  { type: "function", function: { name: "harness_record_runtime_event", description: "Registra una transición de runtime saneada e idempotente; nunca envíes prompts, argumentos ni HTML/CSS.", parameters: { type: "object", required: ["sessionId", "clientEventId", "eventType"], properties: { sessionId: { type: "string" }, clientEventId: { type: "string" }, eventType: { type: "string", enum: ["start", "request", "tool", "retry", "compaction", "done", "error", "cancelled"] }, round: { type: "number" }, maxRounds: { type: "number" }, attempt: { type: "number" }, provider: { type: "string" }, model: { type: "string" }, toolName: { type: "string" }, callId: { type: "string" }, elapsedMs: { type: "number" }, inputTokens: { type: "number" }, outputTokens: { type: "number" }, cumulativeTokens: { type: "number" }, tokenCountKind: { type: "string", enum: ["actual", "estimated"] }, contextChars: { type: "number" }, templateIds: { type: "array", items: { type: "string" } }, error: { type: "string" }, metadata: { type: "object" } } } } },
  { type: "function", function: { name: "harness_get_runtime_events", description: "Lee eventos de runtime saneados con cursor.", parameters: { type: "object", required: ["sessionId"], properties: { sessionId: { type: "string" }, afterId: { type: "number" }, limit: { type: "number" } } } } },
  { type: "function", function: { name: "harness_list_sessions", description: "Lista sesiones de una task autorizada.", parameters: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" }, status: { type: "string" }, limit: { type: "number" } } } } },
  { type: "function", function: { name: "harness_finish_session", description: "CAS-cierra una sesión. completed es solo para reviewer; implementer debe usar harness_submit_for_review.", parameters: { type: "object", required: ["sessionId", "status"], properties: { sessionId: { type: "string" }, status: { type: "string", enum: ["completed", "failed", "cancelled", "timed_out", "blocked"], description: "completed solo para reviewer" }, reason: { type: "string" }, summary: { type: "string" } } } } },
  { type: "function", function: { name: "harness_list_cronjobs", description: "Lista los cronjobs programados.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "harness_create_cronjob", description: "Crea un cronjob automático.", parameters: { type: "object", required: ["name", "schedule"], properties: { name: { type: "string" }, schedule: { type: "string", description: "cron expression" }, action: { type: "string" }, featureType: { type: "string" }, workspaceId: { type: "string" }, brandId: { type: "string" } } } } },
  { type: "function", function: { name: "harness_toggle_cronjob", description: "Activa/desactiva un cronjob.", parameters: { type: "object", required: ["cronjobId", "enabled"], properties: { cronjobId: { type: "string" }, enabled: { type: "boolean" } } } } },
  { type: "function", function: { name: "harness_report_error", description: "Registra un error en Supabase (harness_error_logs) para análisis interno. Usar cuando cualquier tool falle.", parameters: { type: "object", required: ["tool", "error_message"], properties: { tool: { type: "string", description: "Nombre de la tool que falló" }, args: { type: "object", description: "Argumentos con los que se llamó" }, error_message: { type: "string", description: "Mensaje de error o resultado" }, step: { type: "number" }, totalSteps: { type: "number" }, round: { type: "number" }, provider: { type: "string" }, source: { type: "string", description: "chatfab, mcp, manual" } } } } },
  { type: "function", function: { name: "harness_list_errors", description: "Lee errores recientes de harness_error_logs. Útil después de una cascada para ver qué falló y por qué.", parameters: { type: "object", properties: { limit: { type: "number", description: "Máximo de errores a retornar (default 20)" }, tool: { type: "string", description: "Filtrar por nombre de tool" } } } } },
  { type: "function", function: { name: "harness_delegate_task", description: "DELEGA a un subagente real. Esto spawnea una llamada LLM SEPARADA con contexto aislado y tools restringidas al rol. El Leader NUNCA hace diseño directamente — SIEMPRE delega con esta tool. Retorna un resultado verificable.", parameters: { type: "object", required: ["role", "instruction", "contract"], properties: { role: { type: "string", enum: ["implementer", "reviewer"], description: "implementer ejecuta diseño con tools de diseño, reviewer verifica con tools de solo lectura" }, taskId: { type: "string", description: "ID de la tarjeta Kanban (card_xxx)" }, instruction: { type: "string", description: "Instrucción específica para el subagente." }, contract: { type: "object", description: "Contrato verificable. mode=create exige dimensiones y un ID devuelto por una tool creadora de esta sesión. En multi-frame, requiredTextsByFrame tiene una entrada por frame.", required: ["mode", "expectedTemplateCount", "expectedFrameCount", "requiredWidth", "requiredHeight", "requiredTexts", "requiredTextsByFrame", "requiredStyle"], properties: { mode: { type: "string", enum: ["create", "edit"] }, expectedTemplateCount: { type: "number" }, expectedFrameCount: { type: "number" }, requiredWidth: { type: "number" }, requiredHeight: { type: "number" }, requiredTexts: { type: "array", items: { type: "string" } }, requiredTextsByFrame: { type: "array", items: { type: "array", items: { type: "string" } } }, requiredStyle: { type: "string" } } }, templateId: { type: "string", description: "Template ID si ya existe (tpl_xxx)" }, templateIds: { type: "array", items: { type: "string" }, description: "Todos los artifacts que el reviewer debe verificar." } } } } },
  // ═══════════════════════════════════════════════
  //  Musa Daily Batch — Queue items for automated processing
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "task_queue_add", description: "Encola un diseño para que Musa Batch lo procese automáticamente (a las 6am o cuando se dispare el batch). Útil cuando el humano pide 'prepará para mañana' o 'ponelo en cola'. El diseño se crea headless con LLM, sin navegador.", parameters: { type: "object", required: ["workspaceId", "instructions"], properties: { workspaceId: { type: "string", description: "ID del workspace donde crear el diseño" }, instructions: { type: "string", description: "Descripción del diseño: dimensiones, texto, colores, estilo" }, width: { type: "number", description: "Ancho en píxeles (default 1080)" }, height: { type: "number", description: "Alto en píxeles (default 1080)" }, style: { type: "string", description: "Nombre del estilo/marca (ej: Futuraria)" }, name: { type: "string", description: "Nombre del diseño" }, tag: { type: "string", description: "Tag para filtrar (default: 'auto')" }, priority: { type: "number", description: "Prioridad 0-10 (mayor = más urgente)" } } } } },
  { type: "function", function: { name: "task_queue_list", description: "Lista los items en cola de un workspace (pending, done, failed).", parameters: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" }, status: { type: "string", enum: ["pending", "processing", "done", "failed"] }, tag: { type: "string" } } } } },
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

PASO 0 — Si la instrucción menciona un estilo/marca POR NOMBRE (ej: "estilo Futuraria"), resuélvelo
ANTES de tocar ninguna tool de diseño. Tú NO hablas con el humano — el Leader sí.

  ⚡ ATAJO — Si el contrato incluye brandId (campo "brandId" en el JSON del contrato verificable),
     el Leader ya resolvió el estilo por ti. Llama get_brand_guideline({ workspaceId, brandId })
     UNA SOLA VEZ para cargar sus artifacts y salta directamente al modo de creación/edición.
     NO hagas la búsqueda en cascada. NO llames list_brand_guidelines ni get_active_styles.
     Confía en el brandId del Leader — él ya verificó que existe en el bootstrap.

  🔍 BÚSQUEDA EN CASCADA — Solo si NO hay brandId en el contrato. Tu trabajo es investigar
todo lo que puedas y devolverle hallazgos + tu mejor suposición, nunca inventar el estilo por tu cuenta:

  1. BIBLIOTECA — list_brand_guidelines({workspaceId}) y/o get_active_styles({workspaceId}).
     Haz match EXACTO por identidad canónica: trim, espacios consecutivos colapsados y minúsculas.
     "Futuraria Social" coincide con "  futuraria   social ", pero "Futuraria" NO coincide con
     "Futuraria_SocialMedia". list_brand_guidelines devuelve solo resúmenes: si hay match exacto, llama
     get_brand_guideline({workspaceId, brandId}) para cargar sus artifacts antes de usarlo y luego sigue.
  2. ARCHIVOS — si NO hubo match en la biblioteca, llama list_templates({workspaceId, search: "<nombre>"})
     por si existe un template/archivo con ese nombre del cual se pueda extraer un estilo.
  3. MARCAS CRM — si tampoco hubo match, llama get_brands({workspaceId}) por si el CRM tiene una marca
     registrada con ese nombre.
  4. Si NINGUNO de los tres dio match: reúne lo que sí encontraste (aunque sea parcial o ningún resultado
     en algún paso) y DETENTE — no inventes el estilo ni generes el diseño todavía. Tu respuesta final
     (una sola vez, en este formato exacto) debe ser:
     "blocked -> style_not_found: '<nombre>' | biblioteca: sin match | archivos: [<templates candidatos:
     id y nombre, o 'ninguno'>] | marcas CRM: [<marcas candidatas: id y nombre, o 'ninguna'>] | sugerencia:
     <tu mejor propuesta concreta — ej: crear desde cero con qué paleta, o usar tal candidato>"
  5. El Leader va a hablar con el humano usando tus hallazgos y te va a re-delegar con la resolución
     (crear nuevo, usar un candidato, o instrucciones directas). Cuando ese estilo quede guardado en la
     biblioteca con ese nombre, el PASO 1 de esta misma búsqueda lo encontrará directo la próxima vez —
     no vuelvas a preguntar por el mismo nombre.

Si en algún momento TÚ mismo crea o actualiza un estilo, usa generate_design_artifacts({ templateId,
action: "publish", brandName }) sobre un template real con material. create_brand_guideline es solo para
artifacts ya extraídos y exige workspaceId, nombre único, sourceTemplateIds no vacíos y al menos un artifact
sustantivo; nunca crees un estilo solo con nombre. Nómbralo como Marca_Propósito y resuelve el nombre por match
canónico exacto antes de crear; un conflicto se actualiza explícitamente por brandId, no se duplica.

DETERMINA EL MODO leyendo el contexto:

MODO A — Crear diseño nuevo (si el contexto dice "No se pasó templateId: esto es un diseño NUEVO"):
  PASO 1: Si el contexto incluye "workspaceId=...", úsalo directamente — NO llames list_workspaces.
    Solo si NO hay workspaceId en el contexto, llama list_workspaces y toma el primero.
    Si encontraste una brand guideline: para create_html_carousel pasa su brandId Y aplica sus tokensJson/sharedCss reales en el CSS de CADA frame; para create_deck pasa brandId y traduce esos tokens al objeto brand. Si no puedes mapear o aplicar el estilo solicitado, responde blocked; nunca done.
  PASO 2: Para una presentación 1920x1080 llama create_deck UNA VEZ; recuerda que crea portada automática, así que total frames = slides.length + 1. Para carrusel/social o dimensiones personalizadas llama create_html_carousel UNA VEZ con width, height y todos los frames completos. Para archivos/posts separados, llama create_html_template una vez por archivo con workspaceId, name, width, height, html COMPLETO y css COMPLETO.
    ⚠️ CRÍTICO: El html y css deben estar COMPLETOS. No dejes placeholders ni vacíos.
    Escribe TODO el HTML con los textos exactos. Escribe TODO el CSS con colores, fuentes, layout.
    ⚠️ El contenido debe caber DENTRO de width×height. Nada puede desbordar el frame.
  PASO 3: Llama harness_submit_for_review con tu sessionId y un resumen breve.
  ⚠️ SI LA INSTRUCCIÓN PIDE VARIOS ARCHIVOS SEPARADOS (ej: "crea 3 posts separados"): llama create_html_template
    UNA VEZ POR CADA diseño, cada llamada con su HTML/CSS COMPLETO propio — nunca un template
    vacío "de prueba" ni un placeholder que pienses borrar después. Tu resumen final DEBE
    mencionar el ID real de cada uno de los templates que creaste (todos, no solo el primero).

MODO B — Trabajar sobre un template existente (si el contexto incluye "templateId=..."):
  PASO 1: Llama get_template con el templateId para ver el estado actual, y list_frames para ver qué frames ya existen.
  PASO 2: ¿La instrucción nombra un frame específico a editar (por nombre o descripción inequívoca)?
    SÍ → Llama set_html y/o set_css SOLO sobre ese frame.
      ⚠️ CRÍTICO: No borres contenido existente vigente. Solo aplica los cambios pedidos.
    NO (la instrucción pide agregar/crear algo nuevo, sin nombrar un frame existente) →
      Llama create_frame/create_html_frame para un FRAME NUEVO dentro de este template.
      ⚠️ NUNCA sobrescribas un frame existente cuando lo que se pidió es agregar algo — el humano
      puede tener trabajo propio en esos frames que no es tuyo para reemplazar.
  PASO 3: Llama harness_submit_for_review con tu sessionId y un resumen breve.

REGLAS GENERALES:
- NO expliques lo que vas a hacer. Ejecuta directamente con tools.
- NO pierdas rondas explorando. Identifica el modo y ejecuta los pasos.
- Si una tool falla, intenta de nuevo con datos corregidos.
- Tu respuesta final es UNA línea: "done -> implementado", "blocked -> [razón]", o la pregunta del PASO 0.
- ICONOS: si el diseño necesita iconografía (flechas, checks, redes sociales, iconos de UI, bullets de
  infografía, etc.), NUNCA uses un emoji como sustituto. Llama search_icons para encontrar el nombre real
  y luego insert_icon para incrustarlo — insert_icon lo embebe como <svg> real (data-layer-kind="svg"),
  editable y sin dependencia de fuentes externas. No escribas tú mismo un <svg><path> de memoria.

TU SESSION ID: {SESSION_ID}

CONTEXTO DE LA TAREA:
{TASK_CONTEXT}`;

const REVIEWER_PROMPT = `Eres un Reviewer del Harness de Futuraria Design. El Leader te pide verificar el trabajo de un Implementer.

WORKFLOW OBLIGATORIO (exactamente estos pasos):

PASO 1 — Obtén TODOS los templates a verificar:
  Usa exclusivamente los templateIds explícitos del contexto y llama get_template para CADA uno.
  Si no hay templateIds explícitos, no adivines ni elijas el más reciente: devuelve CHANGES_REQUESTED.

PASO 2 — Verifica contenido ACTIVAMENTE (no asumas, INSPECCIONA):
  - Compara cantidad de templates y frames contra el contrato. Si falta uno solo, C2 falla.
  - ¿Cada template tiene frames? Si tiene 0 frames → C2 falla.
  - ¿Los frames tienen HTML no vacío? Llama get_frame para cada frame y verifica que html no sea vacío ni un div sin contenido.
  - ¿Las dimensiones del template coinciden con lo solicitado? (ej: width=1080 height=1080)
  - ¿El texto solicitado aparece en el HTML del frame?
  - ¿El CSS tiene colores, fuentes y layout definidos (no está vacío)?
  - ¿Hay elementos posicionados o dimensionados fuera de los límites del frame (left/top/width/height que
    excedan el width/height del frame), o overflow visible que corte contenido? Eso es un defecto real, no un detalle menor.
  - Si la instrucción original pedía un estilo/marca por NOMBRE: ¿el implementer reportó "blocked" porque no
    lo encontró, o dice haberlo usado? Si dice haberlo usado, llama list_brand_guidelines/get_active_styles y
    confirma que ese estilo con ESE nombre realmente existe y que el CSS del frame coincide con sus tokens
    (colores/fuentes). Si el implementer improvisó un estilo bajo un nombre que no existe en la biblioteca,
    eso es un FAIL — no es lo que se pidió, aunque el resultado se vea bien.
  - Llama lint_design si está disponible y trata sus errores como fallas reales, no sugerencias.

PASO 3 — Evalúa TODOS los checkpoints C1-C5 con harness_evaluate_checkpoint:
  Antes de evaluar, haz una verificación visual y de contenido:
    - Llama render_html_template({ templateId }) → obtén una imagen PNG del diseño renderizado.
      Si el render muestra overflow, texto cortado o desborde → C1 falla aunque las dimensiones sean correctas.
    - Llama list_all_texts({ templateId }) → obtén todo el texto extraído del diseño.
      Compara contra la instrucción original: ¿aparecen todas las palabras/frases solicitadas?
      ¿Hay texto placeholder ("lorem ipsum", "sample text", "contenido aquí")?
      Si falta texto solicitado o hay placeholder → C2 falla.
  Llama harness_evaluate_checkpoint UNA VEZ por cada checkpoint:
    - C1: Dimensiones correctas Y contenido dentro de los límites del frame (sin overflow/desborde). passed=true solo si ambas cosas se cumplen.
    - C2: Contenido HTML no vacío. passed=true si los frames tienen HTML con texto real.
    - C3: Paleta/estilo solicitado aplicado — y si se pidió un estilo con NOMBRE, que ese estilo exista de verdad en la biblioteca (ver PASO 2). passed=false si se improvisó un estilo que no está guardado bajo ese nombre.
    - C4: Estructura HTML válida. passed=true si las etiquetas están balanceadas.
    - C5: CSS funcional. passed=true si no hay propiedades rotas y el layout es coherente.
  Argumentos: harness_evaluate_checkpoint({ taskId: "<taskId>", sessionId: "<tu sessionId>", checkpointId: "C1", description: "...", passed: true/false, notes: "..." })

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
  "harness_delegate_task", "harness_healthcheck", "harness_get_context", "harness_report_error", "harness_list_errors",
  // ── Feature lifecycle ──
  "harness_list_features", "harness_claim_feature", "harness_release_feature", "harness_complete_feature",
  // ── Session ──
  "harness_get_entries", "harness_get_runtime_events", "harness_list_sessions",
  "harness_finish_session", "harness_submit_for_review",
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
  "create_html_template", "create_html_carousel", "create_template", "create_deck",
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
  // ── Quiver AI (vectorize + text-to-SVG) ──
  "vectorize_image", "generate_svg",
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
  "export_frame", "export_template", "render_batch", "render_html_template",
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

type SubagentProgressHandler = (progress: SubagentProgress) => void;

async function executeToolCall(
  name: string,
  args: Record<string, any>,
  signal?: AbortSignal,
  onProgress?: SubagentProgressHandler,
): Promise<string> {
  try {
    if (name === "harness_delegate_task") {
      return await spawnSubagent(args as any, signal, onProgress);
    }
    const result = await mcpCall(name, resolveArgs(name, args), signal);
    return serializeValidJson(result, 32_000);
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
  templateIds?: string[];
  contract?: WorkContract;
}, signal?: AbortSignal, onProgress?: SubagentProgressHandler): Promise<string> {
  const contractValidation = validateWorkContract(params.contract);
  if (!contractValidation.ok) {
    return serializeValidJson({ delegated: false, outcome: "error", verification_failed: true, error: contractValidation.error });
  }
  // ── Per-role LLM config: each subagent role can use a different provider+model ──
  const roleLLM = resolveRoleLLM(params.role);
  if (!roleLLM) {
    const cfg = loadRoleConfig()[params.role];
    const provLabel = PROVIDERS.find(p => p.id === cfg.provider)?.label || cfg.provider;
    return JSON.stringify({ error: `No API key set for ${provLabel} (used by ${params.role}). Set your key in chat settings (⚙️).` });
  }
  const { providerId, model, apiKey: llmKey, endpoint, isAnthropic } = roleLLM;
  const prov = PROVIDERS.find(p => p.id === providerId) || PROVIDERS[0];
  const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const startedAt = Date.now();
  const deadlineMs = params.role === "implementer" ? 5 * 60_000 : 3 * 60_000;
  const capturedTemplateIds: string[] = [];
  const createdArtifactIds: string[] = [];
  const createdFramesByArtifact = new Map<string, number>();
  const createdFrameCount = () => [...createdFramesByArtifact.values()].reduce((sum, count) => sum + count, 0);
  const addCapturedTemplateId = (id: string | undefined | null) => {
    if (id && !capturedTemplateIds.includes(id)) capturedTemplateIds.push(id);
  };
  let madeAnyToolCall = false;
  let madeMutationToolCall = false;
  const consultedStyleEvidence: string[] = [];
  const consultedStyles: Array<{ id?: string; name?: string }> = [];
  const styleEvidence: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let sawEstimatedUsage = false;
  let currentRound = 0;
  let eventSequence = 0;
  let hasDurableSession = false;
  onProgress?.({
    runId,
    state: "starting",
    role: params.role,
    round: 0,
    maxRounds: MAX_SUBAGENT_ROUNDS,
    elapsedMs: 0,
    provider: providerId,
    model: model || prov.defaultModel,
    inputTokens: 0,
    outputTokens: 0,
    cumulativeTokens: 0,
    tokenCountKind: "estimated",
    templateIds: [...(params.templateIds || [])],
    emittedAt: startedAt,
  });

  // Carry the known WORKSPACE into the delegated instruction so the subagent
  // doesn't have to blindly call list_workspaces and guess — same fix as
  // resolveArgs, but for the free-text instruction the leader writes.
  //
  // templateId is deliberately NOT auto-forwarded here. Unlike workspaceId
  // (always safe — it only affects where things get filed), silently
  // attaching "the template currently open in the editor" told the
  // implementer to treat unrelated, human-authored work as the thing to
  // edit — it overwrote an existing frame the user never asked to touch,
  // and it wasn't undoable (MCP edits don't go through the editor's local
  // undo stack). templateId only travels here when the Leader explicitly
  // decided to pass it — that's its one signal for "yes, edit THIS".
  const contextNote = [
    currentContext.workspaceId ? `[Contexto: workspaceId=${currentContext.workspaceId}]` : "",
    params.templateId
      ? `[templateId=${params.templateId} — el Leader decidió explícitamente que esto es sobre este template existente. Si tu tarea es agregar algo nuevo, crea un FRAME NUEVO dentro de él con create_frame/create_html_frame — nunca sobrescribas frames existentes salvo que la instrucción nombre ese frame específico.]`
      : `[No se pasó templateId: esto es un diseño NUEVO. Crea un template nuevo — nunca reutilices ni modifiques uno existente.]`,
    params.templateIds?.length ? `[Artifacts a verificar: ${params.templateIds.join(", ")}]` : "",
    params.contract ? `[Contrato verificable: ${serializeValidJson(params.contract, 4000)}]` : "",
  ].filter(Boolean).join("\n");
  const instruction = `${params.instruction}\n\n${contextNote}`;

  // 1. Start session in Supabase
  let sessionId = "sess_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  let taskContext = instruction;
  if (params.taskId) {
    try {
      const sessResult = await mcpCall("harness_start_session", {
        taskId: params.taskId,
        role: params.role,
        agentName: params.role,
        plan: instruction,
      });
      sessionId = sessResult?.session?.id || sessionId;
      hasDurableSession = true;
      if (sessResult?.session?.context_summary) {
        taskContext = `${sessResult.session.context_summary}\n\n${contextNote}`;
      }
    } catch (error: any) {
      return serializeValidJson({
        delegated: false,
        role: params.role,
        outcome: "error",
        verification_failed: true,
        error: `No se pudo iniciar la sesión real de la task ${params.taskId}: ${error?.message || "error desconocido"}`,
        templateIds: [],
      });
    }
  }

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
  tools = selectProviderTools(tools, providerId);

  // ── System prompt snapshot (Level 8) – log resolved prompt + tool list ──
  if (hasDurableSession) {
    try {
      await mcpCall("harness_log_entry", {
        sessionId,
        entryType: "diagnostic",
        content: JSON.stringify({
          type: "system_prompt",
          role: params.role,
          promptPreview: systemPrompt.slice(0, 3000),
          promptLen: systemPrompt.length,
          toolCount: tools.length,
          toolNames: tools.map((t: any) => t?.function?.name || t?.name).filter(Boolean).slice(0, 60),
        }),
      });
    } catch { /* best-effort */ }
  }

  const runController = new AbortController();
  let deadlineExpired = false;
  let continueRetries = 0;
  const forwardParentAbort = () => runController.abort(new DOMException("Stopped by user", "AbortError"));
  if (signal?.aborted) forwardParentAbort();
  else signal?.addEventListener("abort", forwardParentAbort, { once: true });
  const deadlineTimer = window.setTimeout(() => {
    deadlineExpired = true;
    runController.abort(new DOMException("Subagent deadline exceeded", "TimeoutError"));
  }, Math.max(1, deadlineMs - (Date.now() - startedAt)));
  const runSignal = runController.signal;
  const telemetryQueue = createSerialPromiseQueue();
  const enqueueTelemetry = (method: string, args: Record<string, unknown>) => {
    void telemetryQueue.enqueue(() => mcpCall(method, args)).catch(() => undefined);
  };

  const runStats = (rounds = currentRound): AgentRunStats => ({
    runId,
    role: params.role,
    elapsedMs: Date.now() - startedAt,
    rounds,
    maxRounds: MAX_SUBAGENT_ROUNDS,
    provider: providerId,
    model: model || prov.defaultModel,
    inputTokens,
    outputTokens,
    cumulativeTokens: inputTokens + outputTokens,
    tokenCountKind: inputTokens + outputTokens === 0 || sawEstimatedUsage ? "estimated" : "actual",
    templateIds: [...capturedTemplateIds],
    sessionId,
  });
  const emitProgress = (
    state: SubagentProgress["state"],
    details: Partial<SubagentProgress> = {},
  ) => {
    const stats = runStats(details.round ?? currentRound);
    const progress: SubagentProgress = {
      ...stats,
      state,
      round: stats.rounds,
      emittedAt: Date.now(),
      ...details,
      templateIds: [...capturedTemplateIds],
    };
    onProgress?.(progress);
    if (!hasDurableSession) return;
    const eventType = {
      starting: "start",
      thinking: "request",
      executing_tool: "tool",
      retrying: "retry",
      compacted: "compaction",
      done: "done",
      error: "error",
      cancelled: "cancelled",
    }[state];
    const clientEventId = `${runId}:${String(++eventSequence).padStart(4, "0")}`;
    enqueueTelemetry("harness_record_runtime_event", {
      sessionId,
      clientEventId,
      eventType,
      round: progress.round,
      maxRounds: progress.maxRounds,
      attempt: progress.attempt,
      provider: progress.provider,
      model: progress.model,
      toolName: progress.currentTool,
      callId: progress.callId,
      elapsedMs: progress.elapsedMs,
      inputTokens: progress.inputTokens,
      outputTokens: progress.outputTokens,
      cumulativeTokens: progress.cumulativeTokens,
      tokenCountKind: progress.tokenCountKind,
      contextChars: progress.contextChars,
      templateIds: progress.templateIds,
      error: progress.reason ? sanitizeRuntimeText(progress.reason, 500) : undefined,
      metadata: state === "retrying" ? { reason: progress.reason } : undefined,
    });
  };
  const finishSessionBestEffort = (status: "completed" | "failed" | "cancelled" | "timed_out", reason: string) => {
    if (!hasDurableSession) return;
    enqueueTelemetry("harness_finish_session", {
      sessionId,
      status,
      reason: sanitizeRuntimeText(reason, 500),
      summary: `${params.role} ${status} after ${currentRound}/${MAX_SUBAGENT_ROUNDS} rounds`,
    });
  };
  const finishResult = (
    payload: Record<string, unknown>,
    state: "done" | "error" | "cancelled",
    reason?: string,
    terminalStatus?: "failed" | "cancelled" | "timed_out",
    closeReviewerCompleted = false,
  ) => {
    emitProgress(state, reason ? { reason } : {});
    if (terminalStatus) finishSessionBestEffort(terminalStatus, reason || state);
    else if (closeReviewerCompleted) {
      finishSessionBestEffort("completed", "Reviewer requested changes; review session closed.");
    }
    window.clearTimeout(deadlineTimer);
    signal?.removeEventListener("abort", forwardParentAbort);
    return serializeValidJson({ ...payload, stats: runStats() });
  };
  emitProgress("starting");

  // 3. Subagent conversation — fresh, no Leader history
  // Include sessionId in the first message so the subagent can use it immediately
  let subConv: any[] = [{ role: "user", content: `${instruction}\n\n[Tu sessionId: ${sessionId}]` }];

  // ── Diagnostic: capture subConv structure + request body on errors (Levels 5+6) ──
  let lastRequestBody = "";
  const captureSubConvDiagnostic = async (errorMsg: string, roundIdx: number, requestBody?: string) => {
    if (!hasDurableSession) return;
    // Pre-flight validation result
    const validation = validateConversationStructure(subConv, isAnthropic);
    const structure = subConv.map((msg: any, i: number) => {
      const tc = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      return {
        i,
        role: msg.role,
        tcCount: tc.length,
        tcIds: tc.map((c: any) => c?.id).filter(Boolean).join(",") || undefined,
        tcId: msg.tool_call_id || undefined,
        contentPreview: typeof msg.content === "string" ? msg.content.slice(0, 100) : Array.isArray(msg.content) ? `[${msg.content.length} blocks]` : String(msg.content || "").slice(0, 100),
      };
    });
    const body = requestBody || lastRequestBody;
    try {
      await mcpCall("harness_log_entry", {
        sessionId,
        entryType: "diagnostic",
        content: JSON.stringify({
          error: errorMsg.slice(0, 300),
          round: roundIdx + 1,
          preflight: validation.ok ? "ok" : { orphanedAt: validation.orphanedAt, detail: validation.detail, pendingIds: validation.pendingIds },
          messages: structure,
          requestBodyPreview: body ? body.slice(0, 3000) : undefined,
          requestBodyLen: body ? body.length : 0,
        }),
      });
    } catch { /* best-effort diagnostic */ }
  };

  // Tracks every templateId the implementer actually CREATED or WROTE TO via
  // a real tool call — never from read-only calls (get_template, get_frame,
  // list_templates, etc.), so inspecting a reference/style template is never
  // mistaken for the implementer's own deliverable. Multi-artifact tasks
  // ("crea 3 posts") produce several ids; a single-id capture only ever kept
  // the FIRST one seen, so downstream verification silently checked (and the
  // Leader silently reported) whatever the implementer happened to touch
  // first — a throwaway scratch template, or just the style it read for
  // reference — while the real deliverables went completely unverified.
  try {
  for (let round = 0; round < MAX_SUBAGENT_ROUNDS; round++) {
    currentRound = round + 1;
    if (runSignal.aborted && !deadlineExpired) {
      const reason = "El subagente fue detenido antes de completar la verificación.";
      return finishResult({ delegated: true, role: params.role, sessionId, result: "(detenido por el usuario)", stopped: true, outcome: "partial", verification_failed: true, verification_error: reason, rounds: round }, "cancelled", reason, "cancelled");
    }
    const remainingDeadlineMs = deadlineMs - (Date.now() - startedAt);
    if (remainingDeadlineMs <= 0) {
      const reason = `El subagente superó el deadline de ${formatDuration(deadlineMs)}.`;
      return finishResult({ delegated: true, role: params.role, sessionId, outcome: "error", verification_failed: true, verification_error: reason, rounds: round }, "error", reason, "timed_out");
    }

    // Tool schemas and the system prompt are most of this request. Compact only
    // when the complete provider body approaches the model context budget.
    if (estimateFullRequestTokens(systemPrompt, subConv, isAnthropic ? toolsForAnthropic(tools) : tools) > 70_000) {
      const beforeLen = subConv.length;
      let compacted = compactConversationAtomic(subConv, {
        maxMessages: 40,
        preserveFirstMessages: 1,
        manifest: buildWorkManifest(params.contract || {}, capturedTemplateIds, createdFrameCount(), styleEvidence),
      }).messages;
      if (estimateFullRequestTokens(systemPrompt, compacted, isAnthropic ? toolsForAnthropic(tools) : tools) > 70_000) {
        compacted = compactConversationAtomic(compacted, {
          maxMessages: 24,
          preserveFirstMessages: 1,
          manifest: buildWorkManifest(params.contract || {}, capturedTemplateIds, createdFrameCount(), styleEvidence),
        }).messages;
      }
      subConv = compacted;
      // ── Compaction audit (Level 9) ──
      if (hasDurableSession) {
        const dropped = beforeLen - subConv.length;
        try {
          await mcpCall("harness_log_entry", {
            sessionId,
            entryType: "diagnostic",
            content: JSON.stringify({
              type: "compaction",
              role: params.role,
              round: round + 1,
              before: beforeLen,
              after: subConv.length,
              dropped,
              reason: estimateFullRequestTokens(systemPrompt, subConv, isAnthropic ? toolsForAnthropic(tools) : tools) > 70_000 ? "still_over_budget" : "ok",
            }),
          });
        } catch { /* best-effort */ }
      }
      emitProgress("compacted", {
        round: round + 1,
        reason: "context_budget",
        contextChars: JSON.stringify(subConv).length,
      });
    }

    let data: any;
    const providerTools = isAnthropic ? toolsForAnthropic(tools) : tools;
    const estimatedInputForRound = estimateFullRequestTokens(systemPrompt, subConv, providerTools);
    emitProgress("thinking", {
      round: round + 1,
      contextChars: systemPrompt.length + JSON.stringify(subConv).length + JSON.stringify(providerTools).length,
    });
    const retryOptions = {
      signal: runSignal,
      timeoutMs: 75_000,
      maxRetries: 2,
      maxTimeoutRetries: 1,
      totalDeadlineMs: remainingDeadlineMs,
      onRetry: (notice: { attempt: number; reason: "timeout" | "network" | "rate_limit" | "server_error"; delayMs: number }) => {
        emitProgress("retrying", { round: round + 1, attempt: notice.attempt, reason: notice.reason });
      },
    };

    if (isAnthropic) {
      // ── Pre-flight validation (Level 6) ──
      const preflight = validateConversationStructure(subConv, true);
      if (!preflight.ok) {
        await captureSubConvDiagnostic(`Pre-flight validation FAILED: ${preflight.detail}`, round);
        throw new Error(`Pre-flight conversation validation failed at round ${round + 1}: ${preflight.detail}`);
      }
      const reqBody = JSON.stringify({ model: model || prov.defaultModel, max_tokens: LLM_MAX_TOKENS, system: systemPrompt, messages: subConv, tools: toolsForAnthropic(tools), tool_choice: { type: "auto" } });
      lastRequestBody = reqBody;
      const resp = await fetchWithRetry(prov.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": llmKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: reqBody,
      }, retryOptions);
      if (!resp.ok) {
        const classified = classifyHttpError(resp.status, await resp.text());
        await captureSubConvDiagnostic(`Subagent ${classified.status} (${classified.category}): ${classified.body}`, round, reqBody);
        throw new Error(`Subagent ${classified.status} (${classified.category}): ${classified.body}`);
      }
      data = await resp.json();
    } else {
      // ── Pre-flight validation (Level 6) ──
      const preflight = validateConversationStructure(subConv, false);
      if (!preflight.ok) {
        await captureSubConvDiagnostic(`Pre-flight validation FAILED: ${preflight.detail}`, round);
        throw new Error(`Pre-flight conversation validation failed at round ${round + 1}: ${preflight.detail}`);
      }
      const reqBody = JSON.stringify({ model: model || prov.defaultModel, messages: [{ role: "system", content: systemPrompt }, ...subConv], max_tokens: LLM_MAX_TOKENS, tools, tool_choice: "auto" });
      lastRequestBody = reqBody;
      const resp = await fetchWithRetry(prov.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${llmKey}` },
        body: reqBody,
      }, retryOptions);
      if (!resp.ok) {
        const classified = classifyHttpError(resp.status, await resp.text());
        await captureSubConvDiagnostic(`Subagent ${classified.status} (${classified.category}): ${classified.body}`, round, reqBody);
        throw new Error(`Subagent ${classified.status} (${classified.category}): ${classified.body}`);
      }
      data = await resp.json();
    }
    const providerUsage = readProviderUsage(data, isAnthropic);
    if (providerUsage) {
      inputTokens += providerUsage.inputTokens;
      outputTokens += providerUsage.outputTokens;
    } else {
      sawEstimatedUsage = true;
      inputTokens += estimatedInputForRound;
      outputTokens += Math.max(1, Math.ceil(JSON.stringify(data).length / 4));
    }

    let textContent = "";
    let toolCalls: { id: string; name: string; args: any; argsError?: string }[] = [];

    if (isAnthropic) {
      for (const block of data?.content || []) {
        if (block.type === "text") textContent += block.text;
        else if (block.type === "tool_use") {
          const validInput = block.input && !Array.isArray(block.input) && typeof block.input === "object";
          toolCalls.push({ id: block.id, name: block.name, args: validInput ? block.input : null, argsError: validInput ? undefined : "Invalid Anthropic tool input." });
        }
      }
    } else {
      const msg = data?.choices?.[0]?.message;
      if (msg) {
        textContent = msg.content || "";
        for (const tc of msg.tool_calls || []) {
          const parsedArgs = parseToolArguments(tc.function.arguments);
          toolCalls.push(parsedArgs.ok
            ? { id: tc.id, name: tc.function.name, args: parsedArgs.value }
            : { id: tc.id, name: tc.function.name, args: null, argsError: parsedArgs.error });
        }
      }
    }

    // ── Finish reason (Level 10) – raw provider signal ──
    const roundFinishReason: string = isAnthropic
      ? (data?.stop_reason || "")
      : (data?.choices?.[0]?.finish_reason || "");

    if (responseStoppedIncomplete(data, isAnthropic)) {
      if (continueRetries < MAX_CONTINUE_RETRIES) {
        continueRetries++;
        emitProgress("retrying", { round: round + 1, attempt: continueRetries, reason: "truncated" });
        // Push the partial assistant response so the model sees where it
        // stopped, then ask it to resume. The model will re-emit the
        // truncated tool call (or complete it) instead of starting fresh.
        if (isAnthropic) {
          subConv.push({ role: "assistant", content: data.content || [] });
          subConv.push({ role: "user", content: "Your previous response was cut off by the token limit. Continue exactly from where you stopped — complete the tool call you were generating." });
        } else {
          // OpenAI API rejects assistant messages with tool_calls not
          // followed by tool results. Skip the truncated message and
          // embed any partial text context in the continue prompt.
          const partialText = data.choices?.[0]?.message?.content || "";
          const extra = partialText ? ` Context before cut-off: "${partialText.slice(-300)}"` : "";
          subConv.push({ role: "user", content: `Your previous response was cut off by the token limit. Continue exactly from where you stopped — complete the tool call you were generating.${extra}` });
        }
        continue;
      }
      const reason = `El proveedor truncó la respuesta por límite de tokens tras ${continueRetries} intento(s) de continuación; no se ejecutaron argumentos potencialmente incompletos.`;
      return finishResult({
        delegated: true, role: params.role, sessionId, outcome: "partial",
        verification_failed: true,
        verification_error: reason,
        templateId: capturedTemplateIds[0] || null,
        templateIds: capturedTemplateIds,
        createdArtifactIds,
        contract: params.contract || {},
        styleEvidence,
        consultedStyleEvidence,
        consultedStyles,
        madeMutationToolCall,
        rounds: round + 1,
      }, "error", reason, "failed");
    }

    // No more tool calls → subagent finished
    if (toolCalls.length === 0) {
      const unsuccessful = params.role === "implementer" && !madeMutationToolCall;
      const reason = unsuccessful ? "El implementer terminó sin ejecutar una mutación de diseño verificable." : undefined;
      const reviewerVerdict = params.role === "reviewer" ? parseReviewerVerdict(textContent) : "unknown";
      return finishResult({
        delegated: true, role: params.role, sessionId,
        result: textContent.trim().slice(0, 500) || "(sin respuesta del subagente)",
        templateId: capturedTemplateIds[0] || null,
        templateIds: capturedTemplateIds,
        createdArtifactIds,
        contract: params.contract || {},
        styleEvidence,
        consultedStyleEvidence,
        consultedStyles,
        madeMutationToolCall,
        outcome: unsuccessful ? "verification_failed" : "success",
        verification_failed: unsuccessful,
        // No design tool was ever called — the implementer's text is pure
        // prose with nothing behind it. This is the pattern that produces
        // fully fabricated templateIds/session summaries: a weak-tool-use
        // model writes out what a tool call transcript WOULD look like
        // instead of actually emitting tool_calls. The Leader must never
        // trust "done"-sounding text when this flag is set.
        noToolCallsMade: !madeAnyToolCall,
        reviewerVerdict,
        rounds: round + 1,
      }, unsuccessful ? "error" : "done", reason, unsuccessful ? "failed" : undefined, reviewerVerdict === "CHANGES_REQUESTED");
    }

    madeAnyToolCall = true;

    // Push assistant message into subagent conversation
    if (isAnthropic) { subConv.push({ role: "assistant", content: data.content || [] }); }
    else { subConv.push(data.choices[0].message); }

    // Execute each tool call within the subagent's own loop
    const anthropicResults: any[] = [];
    for (const tc of toolCalls) {
      if (runSignal.aborted) throw runSignal.reason || new DOMException("Subagent aborted", "AbortError");
      emitProgress("executing_tool", {
        round: round + 1,
        currentTool: tc.name,
        callId: tc.id,
        attempt: 1,
      });
      const payloadValidation = tc.argsError
        ? null
        : validateDesignToolPayload(tc.name, tc.args, params.contract || {});
      const rawResult = tc.argsError
        ? serializeValidJson({ error: tc.argsError, code: "invalid_tool_arguments", executed: false })
        : payloadValidation && !payloadValidation.ok
          ? serializeValidJson({ error: payloadValidation.error, code: "invalid_design_payload", executed: false })
        : await executeToolCall(tc.name, tc.args, runSignal);
      const resultStr = normalizeAgentToolResult(rawResult);
      const toolFailed = tc.argsError || (payloadValidation !== null && !payloadValidation.ok) || resultStr.includes('"error"') || resultStr.includes('"code":-');
      if (!toolFailed) {
        if (["get_active_styles", "list_brand_guidelines", "get_brand_guideline", "get_brands"].includes(tc.name)) {
          for (const candidate of extractStyleReferences(resultStr)) {
            if (candidate.name && !consultedStyleEvidence.includes(candidate.name)) consultedStyleEvidence.push(candidate.name);
            if (candidate.id && !consultedStyleEvidence.includes(candidate.id)) consultedStyleEvidence.push(candidate.id);
            if (!consultedStyles.some(style => style.id === candidate.id && style.name === candidate.name)) {
              consultedStyles.push(candidate);
            }
          }
        }
        const ids = captureArtifactIds(tc.name, tc.args, resultStr);
        ids.forEach(addCapturedTemplateId);
        if (CREATOR_TOOL_NAMES.has(tc.name)) {
          for (const id of ids) if (!createdArtifactIds.includes(id)) createdArtifactIds.push(id);
          const count = captureCreatedFrameCount(tc.name, resultStr);
          if (count > 0 && ids[0]) createdFramesByArtifact.set(ids[0], count);
        }
        if (ids.length > 0 || MUTATION_TOOL_NAMES.has(tc.name)) {
          madeMutationToolCall = true;
          for (const evidence of collectMutationStyleEvidence(tc.name, tc.args, consultedStyles)) {
            if (!styleEvidence.includes(evidence)) styleEvidence.push(evidence);
          }
        }
      }
      if (isAnthropic) { anthropicResults.push({ type: "tool_result", tool_use_id: tc.id, content: resultStr }); }
      else { subConv.push({ role: "tool", tool_call_id: tc.id, content: resultStr }); }
    }
    if (isAnthropic && anthropicResults.length > 0) subConv.push({ role: "user", content: anthropicResults });

    // ── Per-round trace for governance panel (Phase G) ──
    if (hasDurableSession) {
      const roundTokens = providerUsage
        ? { in: providerUsage.inputTokens, out: providerUsage.outputTokens }
        : { in: estimatedInputForRound, out: 0 };
      const traceEntry = {
        type: "round",
        round: round + 1,
        assistantText: textContent?.slice(0, 300) || null,
        toolCalls: toolCalls.map((tc: any) => ({ name: tc.name, id: tc.id, argsPreview: JSON.stringify(tc.args || {}).slice(0, 200) })),
        toolResults: toolCalls.map((tc: any, idx: number) => {
          const resultMsg = isAnthropic ? anthropicResults[idx] : subConv[subConv.length - toolCalls.length + idx];
          const rc = typeof resultMsg?.content === "string" ? resultMsg.content : "";
          return { tool_call_id: tc.id, len: rc.length, preview: rc.slice(0, 200) };
        }),
        tokens: { input: roundTokens.in, output: roundTokens.out, cumulative: inputTokens + outputTokens },
        truncated: responseStoppedIncomplete(data, isAnthropic),
        finishReason: roundFinishReason || undefined,
      };
      try {
        await mcpCall("harness_log_entry", {
          sessionId,
          entryType: "subagent_trace",
          content: JSON.stringify(traceEntry),
        });
      } catch { /* best-effort trace */ }
    }
  }

  // Max rounds reached
  const roundLimitReason = `El subagente alcanzó el límite exacto de ${MAX_SUBAGENT_ROUNDS} rondas sin demostrar completitud.`;
  return finishResult({
    delegated: true, role: params.role, sessionId,
    result: "(subagente alcanzó límite de iteraciones)",
    templateId: capturedTemplateIds[0] || null,
    templateIds: capturedTemplateIds,
    createdArtifactIds,
    contract: params.contract || {},
    styleEvidence,
    consultedStyleEvidence,
    consultedStyles,
    madeMutationToolCall,
    outcome: "verification_failed",
    verification_failed: true,
    verification_error: roundLimitReason,
    noToolCallsMade: !madeAnyToolCall,
    hitRoundLimit: true,
    rounds: MAX_SUBAGENT_ROUNDS,
  }, "error", roundLimitReason, "failed");
  } catch (error: any) {
    const isTimeout = deadlineExpired || error?.name === "TimeoutError";
    const isAbort = !isTimeout && (signal?.aborted || error?.name === "AbortError");
    const reason = sanitizeRuntimeText(error?.message || (isAbort ? "Stopped by user" : "Subagent failed"), 1000);
    return finishResult({
      delegated: true,
      role: params.role,
      sessionId,
      outcome: isAbort ? "partial" : "error",
      stopped: isAbort,
      verification_failed: true,
      verification_error: reason,
      templateId: capturedTemplateIds[0] || null,
      templateIds: capturedTemplateIds,
      createdArtifactIds,
      contract: params.contract || {},
      styleEvidence,
      consultedStyleEvidence,
      consultedStyles,
      madeMutationToolCall,
      rounds: currentRound,
    }, isAbort ? "cancelled" : "error", reason, isAbort ? "cancelled" : isTimeout ? "timed_out" : "failed");
  }
}

interface ToolEvent {
  id: string;
  tool: string;
  status: "running" | "done" | "error";
  result?: string;
  progress?: SubagentProgress;
}

const SUBAGENT_PROGRESS_LABELS: Record<SubagentProgress["state"], string> = {
  starting: "iniciando",
  thinking: "pensando",
  executing_tool: "ejecutando tool",
  retrying: "reintentando",
  compacted: "compactando contexto",
  done: "completado",
  error: "falló",
  cancelled: "cancelado",
};

const inputBase: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#e0e0e0",
  outline: "none", fontFamily: "inherit", width: "100%", boxSizing: "border-box",
};

/**
 * Does this assistant text look like the model *narrating* tool calls rather
 * than actually emitting them?
 *
 * Real tool activity never reaches the transcript as text — it renders in the
 * toolEvents strip — so any assistant message that names a tool alongside a
 * result marker is fabricated.
 *
 * The previous version of this check used `\b(studio_create|harness_delegate|…)\b`,
 * which silently never fired: `_` is a word character in JS regex, so
 * `\bstudio_create\b` does NOT match `studio_create_card`. The tools the model
 * actually fakes are precisely the suffixed ones, so the guard was dead code.
 * Matching the full snake_case token (and allowing any suffix) is what makes it
 * work.
 */
const FAKE_TOOL_CALL_RE =
  /(?:^|[\s`*✓✔√•\-])(studio_[a-z_]+|harness_[a-z_]+|create_(?:html_)?(?:template|frame)[a-z_]*|set_(?:html|css)|delete_frame[a-z_]*|render_html[a-z_]*|list_templates|get_active_styles)\s*(?:\(|→|->|:|=>)/i;

export function looksLikeNarratedToolCall(text: string): boolean {
  if (!text) return false;
  return FAKE_TOOL_CALL_RE.test(text) || /\{\s*"tool"\s*:/i.test(text);
}

function loadMessages(): Message[] {
  try {
    const raw = localStorage.getItem(LS_MESSAGES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Drop any previously-stored fabricated transcripts. They were saved
        // as ordinary assistant messages, so every later request replayed them
        // to the model as an example of "this is how I answer" — the pattern
        // reinforced itself and survived reloads. Healing here means an
        // already-poisoned session recovers without the user clearing chat.
        const clean = parsed.filter((m: Message) =>
          !(m.role === "assistant" && looksLikeNarratedToolCall(m.content)));
        if (clean.length > 0) return clean.slice(-MAX_STORED_MESSAGES);
      }
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

/** Turns bare https:// URLs in a message into clickable links — the leader's
 *  "done -> link" is only a trust signal if you can actually click through
 *  and verify it, instead of copy-pasting text out of a chat bubble. */
const URL_RE = /(https?:\/\/[^\s)]+)/g;
function renderWithLinks(content: string): React.ReactNode {
  const parts = content.split(URL_RE);
  if (parts.length === 1) return content;
  // .split() with a single capturing group interleaves [text, match, text, match, ...] —
  // odd indices are always the captured URLs.
  return parts.map((part, i) =>
    i % 2 === 1
      ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" style={{ color: "#93c5fd", textDecoration: "underline" }}>{part}</a>
      : <span key={i}>{part}</span>
  );
}

interface ChatFABProps {
  /** The workspace the human is currently looking at (dashboard or editor). */
  workspaceId?: string;
  /** The template currently open in the editor, if any. */
  templateId?: string;
  /** When provided, the parent controls the panel's open/close state
   *  (used by MusaOnboarding to force the chat open with an overlay). */
  externalOpen?: boolean;
  /** Called whenever the internal open state would change. */
  onOpenChange?: (open: boolean) => void;
  /** When true, hide the floating FAB button entirely (parent already
   *  controls the panel via externalOpen). */
  hideFab?: boolean;
}

export function ChatFAB({ workspaceId, templateId, externalOpen, onOpenChange, hideFab }: ChatFABProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen ?? internalOpen;
  const setOpen = useCallback((next: boolean) => {
    setInternalOpen(next);
    onOpenChange?.(next);
  }, [onOpenChange]);
  const [messages, setMessages] = useState<Message[]>(loadMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [clockNow, setClockNow] = useState(Date.now());
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [expandedStepGroups, setExpandedStepGroups] = useState<Set<number>>(new Set());
  // ── Multi-model per role: each role can use a different provider+model ──
  const [roleConfig, setRoleConfig] = useState<RoleConfigMap>(() => loadRoleConfig());
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>(() => loadAllProviderKeys());
  const leaderProvider = roleConfig.leader.provider;
  const leaderModel = roleConfig.leader.model;
  const leaderKey = providerKeys[leaderProvider] || "";
  const [showSettings, setShowSettings] = useState(!leaderKey);
  const [accordion, setAccordion] = useState<"config" | "chat" | "tools" | null>("chat");
  
  // ── Governance panel state ──
  const [governanceSessions, setGovernanceSessions] = useState<GovernanceSession[]>([]);
  const [showGovernance, setShowGovernance] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Persist settings
  useEffect(() => { saveRoleConfig(roleConfig); }, [roleConfig]);
  useEffect(() => {
    for (const [pid, key] of Object.entries(providerKeys)) {
      setProviderKey(pid, key);
    }
  }, [providerKeys]);

  // Persist messages
  useEffect(() => { saveMessages(messages); }, [messages]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);
  useEffect(() => {
    if (!sending) return;
    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [sending]);

  // Keep the module-level context in sync with what the human is actually
  // looking at, so tool calls and delegated subagents stop guessing.
  useEffect(() => { currentContext = { workspaceId, templateId }; }, [workspaceId, templateId]);

  // ── Reset chat history when workspace changes ──
  // The chat is workspace-scoped: switching workspace means switching user
  // (or project), so we must not show the previous conversation. Without
  // this, Victor could see Renzo's chat if they share a browser.
  const prevWorkspaceRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (prevWorkspaceRef.current !== undefined && prevWorkspaceRef.current !== workspaceId) {
      setMessages([{ role: "assistant", content: "Hola. Soy el Leader del Harness. ¿Qué diseño necesitas crear hoy?", ts: Date.now() }]);
      setToolEvents([]);
      setCopyStatus("idle");
      setExpandedTools(new Set());
      setExpandedStepGroups(new Set());
    }
    prevWorkspaceRef.current = workspaceId;
  }, [workspaceId]);

  // ── Bootstrap: load memory (styles, templates, sessions, skills) on mount ──
  const [bootstrapCtx, setBootstrapCtx] = useState<BootstrapContext | null>(null);
  useEffect(() => {
    if (workspaceId) {
      bootstrapSession().then(ctx => setBootstrapCtx(ctx)).catch(() => setBootstrapCtx(null));
    }
  }, [workspaceId]);

  const systemPrompt = buildSystemPrompt(bootstrapCtx ?? undefined);

  const send = useCallback(async () => {
    if (!input.trim() || sending) return;
    if (!leaderKey) { setShowSettings(true); setAccordion("config"); return; }

    const userMsg: Message = { role: "user", content: input.trim(), ts: Date.now() };
    // Past assistant turns that merely *described* tool calls are excluded:
    // feeding them back presents fabricated transcripts to the model as its
    // own prior behaviour, which is what made the narration self-reinforcing.
    let conversation: any[] = [
      ...messages.filter(m => m.role !== "system" && !(m.role === "assistant" && looksLikeNarratedToolCall(m.content))),
      userMsg,
    ].map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setSending(true);
    setToolEvents([]);
    setCopyStatus("idle");
    setExpandedTools(new Set());

    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    const prov = PROVIDERS.find(p => p.id === leaderProvider) || PROVIDERS[0];
    const isAnthropic = leaderProvider === "anthropic";
    const leaderTools = selectProviderTools(LEADER_TOOLS, leaderProvider);
    const MAX_TOOL_ROUNDS = 12;
    let contextDumped = false;
    let leaderHttpError: ReturnType<typeof classifyHttpError> | null = null;
    let leaderContinueRetries = 0;

    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        if (signal.aborted) {
          setMessages(prev => [...prev, { role: "assistant", content: "Detenido.", ts: Date.now() }]);
          break;
        }

        // ── Trim conversation to prevent context overflow ──
        if (estimateFullRequestTokens(systemPrompt, conversation, isAnthropic ? toolsForAnthropic(leaderTools) : leaderTools) > 70_000) {
          const leaderBeforeLen = conversation.length;
          let compacted = compactConversationAtomic(conversation, {
            maxMessages: 40,
            preserveFirstMessages: 2,
            manifest: buildWorkManifest(),
          }).messages;
          if (estimateFullRequestTokens(systemPrompt, compacted, isAnthropic ? toolsForAnthropic(leaderTools) : leaderTools) > 70_000) {
            compacted = compactConversationAtomic(compacted, {
              maxMessages: 24,
              preserveFirstMessages: 2,
              manifest: buildWorkManifest(),
            }).messages;
          }
          conversation = compacted;
          // ── Leader compaction audit (Level 9) ──
          if (currentContext.sessionId) {
            try {
              await mcpCall("harness_log_entry", {
                sessionId: currentContext.sessionId,
                entryType: "diagnostic",
                content: JSON.stringify({
                  type: "compaction",
                  role: "leader",
                  round: round + 1,
                  before: leaderBeforeLen,
                  after: conversation.length,
                  dropped: leaderBeforeLen - conversation.length,
                }),
              }).catch(() => {});
            } catch { /* best-effort */ }
          }
        }

        // ── Proactive context dump when conversation grows large ──
        // Only fires when we have an active harness session; without a
        // sessionId the dump is a no-op that pollutes the error log with
        // "Session not found: undefined".
        const estimatedTokens = JSON.stringify(conversation).length / 4;
        if (estimatedTokens > 4000 && !contextDumped && currentContext.sessionId) {
          try {
            await mcpCall("harness_dump_context", {
              sessionId: currentContext.sessionId,
              content: JSON.stringify(conversation.slice(-10)),
            }).catch(() => {});
            contextDumped = true;
          } catch { /* non-fatal */ }
        }

        let data: any;

        if (isAnthropic) {
          // ── Pre-flight validation (Level 6) ──
          const preflight = validateConversationStructure(conversation, true);
          if (!preflight.ok) {
            setMessages(prev => [...prev, { role: "assistant", content: `Error interno: conversación corrupta antes de enviar a Anthropic (ronda ${round + 1}). Detectado por pre-flight — se evitó un 400.`, ts: Date.now() }]);
            if (currentContext.sessionId) {
              await mcpCall("harness_log_entry", {
                sessionId: currentContext.sessionId, entryType: "diagnostic",
                content: JSON.stringify({ type: "preflight_failure", role: "leader", round: round + 1, detail: preflight.detail, orphanedAt: preflight.orphanedAt, pendingIds: preflight.pendingIds }),
              }).catch(() => {});
            }
            break;
          }
          const reqBody = JSON.stringify({ model: leaderModel || prov.defaultModel, max_tokens: LLM_MAX_TOKENS, system: systemPrompt, messages: conversation, tools: toolsForAnthropic(leaderTools), tool_choice: { type: "auto" } });
          const resp = await fetchWithRetry(prov.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": leaderKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
            body: reqBody,
          }, { signal });
          if (!resp.ok) {
            const body = (await resp.text()).slice(0, 500);
            if (resp.status === 400) {
              // ── Leader diagnostic on 400 (Level 5) ──
              if (currentContext.sessionId) {
                await mcpCall("harness_log_entry", {
                  sessionId: currentContext.sessionId, entryType: "diagnostic",
                  content: JSON.stringify({
                    type: "leader_400", round: round + 1,
                    messages: conversation.map((m: any, i: number) => ({ i, role: m.role, tcCount: Array.isArray(m.tool_calls) ? m.tool_calls.length : 0, tcId: m.tool_call_id || undefined, contentPreview: typeof m.content === "string" ? m.content.slice(0, 100) : `[${Array.isArray(m.content) ? m.content.length : 0} blocks]` })),
                    requestBodyPreview: reqBody.slice(0, 3000),
                    requestBodyLen: reqBody.length,
                  }),
                }).catch(() => {});
              }
              leaderHttpError = classifyHttpError(resp.status, body); break;
            }
            throw new Error(`Anthropic ${resp.status}: ${body}`);
          }
          data = await resp.json();
        } else {
          // ── Pre-flight validation (Level 6) ──
          const preflight = validateConversationStructure(conversation, false);
          if (!preflight.ok) {
            setMessages(prev => [...prev, { role: "assistant", content: `Error interno: conversación corrupta antes de enviar a ${prov.label} (ronda ${round + 1}). Detectado por pre-flight — se evitó un 400.`, ts: Date.now() }]);
            if (currentContext.sessionId) {
              await mcpCall("harness_log_entry", {
                sessionId: currentContext.sessionId, entryType: "diagnostic",
                content: JSON.stringify({ type: "preflight_failure", role: "leader", round: round + 1, detail: preflight.detail, orphanedAt: preflight.orphanedAt, pendingIds: preflight.pendingIds }),
              }).catch(() => {});
            }
            break;
          }
          const reqBody = JSON.stringify({ model: leaderModel || prov.defaultModel, messages: [{ role: "system", content: systemPrompt }, ...conversation], max_tokens: LLM_MAX_TOKENS, tools: leaderTools, tool_choice: "auto" });
          const resp = await fetchWithRetry(prov.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${leaderKey}` },
            body: reqBody,
          }, { signal });
          if (!resp.ok) {
            const body = (await resp.text()).slice(0, 500);
            if (resp.status === 400) {
              // ── Leader diagnostic on 400 (Level 5) ──
              if (currentContext.sessionId) {
                await mcpCall("harness_log_entry", {
                  sessionId: currentContext.sessionId, entryType: "diagnostic",
                  content: JSON.stringify({
                    type: "leader_400", round: round + 1,
                    messages: conversation.map((m: any, i: number) => ({ i, role: m.role, tcCount: Array.isArray(m.tool_calls) ? m.tool_calls.length : 0, tcId: m.tool_call_id || undefined, contentPreview: typeof m.content === "string" ? m.content.slice(0, 100) : `[${Array.isArray(m.content) ? m.content.length : 0} blocks]` })),
                    requestBodyPreview: reqBody.slice(0, 3000),
                    requestBodyLen: reqBody.length,
                  }),
                }).catch(() => {});
              }
              leaderHttpError = classifyHttpError(resp.status, body); break;
            }
            throw new Error(`${prov.label} ${resp.status}: ${body}`);
          }
          data = await resp.json();
        }

        let textContent = "";
        let toolCalls: { id: string; name: string; args: any; argsError?: string }[] = [];

        if (isAnthropic) {
          for (const block of data?.content || []) {
            if (block.type === "text") textContent += block.text;
            else if (block.type === "tool_use") {
              const validInput = block.input && !Array.isArray(block.input) && typeof block.input === "object";
              toolCalls.push({ id: block.id, name: block.name, args: validInput ? block.input : null, argsError: validInput ? undefined : "Invalid Anthropic tool input." });
            }
          }
        } else {
          const msg = data?.choices?.[0]?.message;
          if (msg) {
            textContent = msg.content || "";
            for (const tc of msg.tool_calls || []) {
              const parsedArgs = parseToolArguments(tc.function.arguments);
              toolCalls.push(parsedArgs.ok
                ? { id: tc.id, name: tc.function.name, args: parsedArgs.value }
                : { id: tc.id, name: tc.function.name, args: null, argsError: parsedArgs.error });
            }
          }
        }

        // ── Leader finish reason (Level 10) ──
        const leaderFinishReason: string = isAnthropic
          ? (data?.stop_reason || "")
          : (data?.choices?.[0]?.finish_reason || "");

        if (responseStoppedIncomplete(data, isAnthropic)) {
          if (leaderContinueRetries < MAX_CONTINUE_RETRIES) {
            leaderContinueRetries++;
            if (isAnthropic) {
              conversation.push({ role: "assistant", content: data.content || [] });
              conversation.push({ role: "user", content: "Your previous response was cut off by the token limit. Continue exactly from where you stopped." });
            } else {
              // OpenAI API rejects assistant messages with tool_calls not
              // followed by tool results. Skip the truncated message.
              const partialText = data.choices?.[0]?.message?.content || "";
              const extra = partialText ? ` Context before cut-off: "${partialText.slice(-300)}"` : "";
              conversation.push({ role: "user", content: `Your previous response was cut off by the token limit. Continue exactly from where you stopped.${extra}` });
            }
            continue;
          }
          setMessages(prev => [...prev, {
            role: "assistant",
            content: "Error: el proveedor truncó la respuesta por límite de tokens tras varios intentos de continuación.",
            ts: Date.now(),
          }]);
          break;
        }

        if (toolCalls.length === 0) {
          // ── Model wrote tool names as text instead of emitting tool_calls ──
          if (looksLikeNarratedToolCall(textContent)) {
            if (round < 3) {
              // Deliberately do NOT push the fabricated text into `conversation`
              // (or into `messages`): replaying it teaches the model that this
              // is an acceptable answer shape, which is how the behaviour used
              // to lock in permanently.
              conversation.push({
                role: "user",
                content: "⚠️ Escribiste nombres de herramientas como texto en lugar de ejecutarlas, y los resultados que inventaste no son reales. Ninguna tarjeta ni diseño fue creado. Usa function calling de verdad (tool_calls) — no escribas 'studio_create_card → {...}' ni JSON. Volvé a intentarlo ejecutando las tools.",
              });
              continue;
            }
            // Out of retries: never show the fabricated transcript as if it
            // were a result — the user would believe work happened.
            setMessages(prev => [...prev, {
              role: "assistant",
              ts: Date.now(),
              content: "No pude ejecutar las herramientas: el modelo escribió los comandos como texto en vez de llamarlos, así que **no se creó ninguna tarjeta ni diseño**. Probá con otro modelo para el rol Leader (⚙ Configuración del chat) — necesita soportar function calling.",
            }]);
            break;
          }
          if (textContent.trim()) setMessages(prev => [...prev, { role: "assistant", content: textContent.trim(), ts: Date.now() }]);
          break;
        }

        // Emit intermediate text BEFORE executing tools (multi-message UX) —
        // this is the leader narrating what it's about to do, not a real
        // conversational turn, so it's tagged as a collapsible step.
        if (textContent.trim()) {
          setMessages(prev => [...prev, { role: "assistant", content: textContent.trim(), ts: Date.now(), kind: "step" }]);
        }

        if (isAnthropic) { conversation.push({ role: "assistant", content: data.content || [] }); }
        else { conversation.push(data.choices[0].message); }

        // Tool activity (running/done/error, with a short result preview) lives
        // exclusively in the toolEvents strip between the transcript and the
        // input box — NOT as chat bubbles. The visible conversation is
        // reserved for the model's own natural-language turns, so it reads
        // like talking to the leader instead of watching raw JSON scroll by.
        const anthropicResults: any[] = [];
        for (let ti = 0; ti < toolCalls.length; ti++) {
          if (signal.aborted) break;
          const tc = toolCalls[ti];
          const eventId = `leader-${round}-${ti}-${tc.id || tc.name}`;
          setToolEvents(prev => [...prev, { id: eventId, tool: tc.name, status: "running" }]);
          const rawResult = tc.argsError
            ? serializeValidJson({ error: tc.argsError, code: "invalid_tool_arguments", executed: false })
            : await executeToolCall(tc.name, tc.args, signal, progress => {
                setToolEvents(prev => prev.map(event => event.id === eventId
                  ? {
                      ...event,
                      tool: tc.name === "harness_delegate_task" ? `${progress.role}: ${progress.state}` : event.tool,
                      status: progress.state === "error" || progress.state === "cancelled" ? "error" : progress.state === "done" ? "done" : "running",
                      progress,
                    }
                  : event));
              });
          const resultStr = normalizeAgentToolResult(rawResult);
          let parsedDelegateResult: any = null;
          if (tc.name === "harness_delegate_task") {
            try { parsedDelegateResult = JSON.parse(resultStr); } catch { /* handled as an opaque tool result */ }
          }
          const isError = resultStr.includes('"error"') || resultStr.includes('"code":-')
            || parsedDelegateResult?.verification_failed === true
            || ["error", "partial", "verification_failed"].includes(parsedDelegateResult?.outcome);
          setToolEvents(prev => prev.map(event => event.id === eventId
            ? { ...event, status: isError ? "error" as const : tc.name === "harness_delegate_task" ? "running" as const : "done" as const, result: sanitizeRuntimeText(resultStr, 4000) }
            : event));

          const stats = parsedDelegateResult?.stats as AgentRunStats | undefined;
          if (stats?.runId) {
            const approximate = stats.tokenCountKind === "estimated" ? "~" : "";
            const artifactSummary = Array.isArray(stats.templateIds) && stats.templateIds.length > 0
              ? ` · ${stats.templateIds.length} artifact${stats.templateIds.length === 1 ? "" : "s"}`
              : "";
            setMessages(prev => [...prev, {
              role: "assistant",
              kind: "step",
              ts: Date.now(),
              content: `${parsedDelegateResult?.role || stats.role} terminó · ${formatDuration(stats.elapsedMs)} · ${approximate}${formatTokens(stats.cumulativeTokens)} tokens · ${stats.rounds}/${stats.maxRounds} rondas${artifactSummary}`,
            }]);
          }

          if (isError) {
            appendErrorReport({
              tool: tc.name, args: tc.args,
              result: resultStr.slice(0, 500),
              step: ti + 1, totalSteps: toolCalls.length,
              round, timestamp: new Date().toISOString(),
              provider: leaderProvider,
            });
          }

          // ── Post-delegate verification: confirm EVERY reported template is
          // real and has actual content — not just that harness_delegate_task
          // returned SOME templateId. This closes two gaps a single-id
          // existence-only check left open: (1) multi-artifact tasks ("crea 3
          // posts") report several templateIds, and only verifying the first
          // let the other two go completely unverified; (2) an implementer
          // that never made a single real tool call (pure hallucinated prose)
          // has no templateId to check at all — that case must be caught
          // explicitly instead of silently skipping verification.
          let finalResultStr = resultStr;
          if (tc.name === "harness_delegate_task" && !isError) {
            try {
              const parsed = JSON.parse(resultStr);
              const delegateRole = parsed?.role;
              const delegateTemplateIds: string[] = Array.isArray(parsed?.templateIds) && parsed.templateIds.length > 0
                ? parsed.templateIds
                : (parsed?.templateId ? [parsed.templateId] : []);
              // Only verify after implementer — reviewer doesn't create templates.
              if (delegateRole === "implementer") {
                if (parsed?.verification_failed || parsed?.hitRoundLimit) {
                  const verifyErr = parsed?.verification_error || "El implementer terminó con resultado parcial o incompleto.";
                  finalResultStr = serializeValidJson({ ...parsed, outcome: "verification_failed", verification_failed: true, verification_error: verifyErr });
                  setToolEvents(prev => [...prev, { id: `${eventId}:verify:incomplete`, tool: "verify (subagent incomplete)", status: "error", result: verifyErr }]);
                  setMessages(prev => [...prev, { role: "assistant", content: `⚠️ VERIFICACIÓN FALLIDA: ${verifyErr}`, ts: Date.now() }]);
                } else if (parsed?.noToolCallsMade || delegateTemplateIds.length === 0) {
                  setToolEvents(prev => [...prev, { id: `${eventId}:verify:no-tools`, tool: "verify (no tool calls)", status: "error", result: "El implementer no ejecutó ninguna tool de diseño." }]);
                  const verifyErr = `⚠️ VERIFICACIÓN FALLIDA: el implementer no hizo ninguna llamada real a una tool de diseño (create_html_template/set_html/set_css/etc.) — no hay ningún templateId verificable respaldando su respuesta. NUNCA repitas ni des por buena ninguna descripción de diseño o templateId que haya mencionado solo en texto. No muevas a review — re-delega con instrucciones más concretas, o si vuelve a pasar informa honestamente al humano que no se pudo generar el diseño.`;
                  finalResultStr = JSON.stringify({ ...parsed, verification_failed: true, verification_error: verifyErr });
                  setMessages(prev => [...prev, { role: "assistant", content: verifyErr, ts: Date.now() }]);
                } else {
                  const artifacts: ArtifactSnapshot[] = [];
                  const fetchErrors: string[] = [];
                  for (let verifyIndex = 0; verifyIndex < delegateTemplateIds.length; verifyIndex++) {
                    const tid = delegateTemplateIds[verifyIndex];
                    const verifyEventId = `${eventId}:verify:${verifyIndex}:${tid}`;
                    setToolEvents(prev => [...prev, { id: verifyEventId, tool: `get_template (verify ${tid})`, status: "running" }]);
                    try {
                      const verifyResult = await mcpCall("get_template", { templateId: tid }, signal);
                      const t = verifyResult?.template || verifyResult;
                      if (!t || t.error || !t.id) throw new Error("vacío o no encontrado");
                      artifacts.push({
                        id: t.id,
                        brandId: t.brandId,
                        designArtifacts: t.designArtifacts,
                        width: t.width,
                        height: t.height,
                        html: t.html,
                        css: t.css,
                        styleEvidence: Array.isArray(parsed?.styleEvidence) ? parsed.styleEvidence : [],
                        styleReferences: Array.isArray(parsed?.consultedStyles) ? parsed.consultedStyles : [],
                        frames: Array.isArray(t.frames) ? t.frames.map((frame: any) => ({
                          width: frame?.width ?? t.width,
                          height: frame?.height ?? t.height,
                          html: frame?.html || "",
                          css: frame?.css ?? "",
                        })) : [],
                      });
                      setToolEvents(prev => prev.map(event => event.id === verifyEventId ? { ...event, status: "done" as const, result: "Artifact cargado para verificación contractual" } : event));
                    } catch (error: any) {
                      fetchErrors.push(`${tid}: ${error?.message || "no encontrado"}`);
                      setToolEvents(prev => prev.map(event => event.id === verifyEventId ? { ...event, status: "error" as const, result: "Vacío o no encontrado" } : event));
                    }
                  }
                  const contract: WorkContract = parsed?.contract || tc.args?.contract || { expectedTemplateCount: delegateTemplateIds.length };
                  const completion = evaluateCompleteness({
                    contract,
                    artifacts,
                    madeMutationToolCall: parsed?.madeMutationToolCall === true,
                    createdArtifactIds: Array.isArray(parsed?.createdArtifactIds) ? parsed.createdArtifactIds : [],
                    hitRoundLimit: parsed?.hitRoundLimit === true,
                    error: fetchErrors.length > 0 ? fetchErrors.join("; ") : undefined,
                  });
                  if (completion.verification_failed) {
                    const verifyErr = completion.errors.join(" ");
                    finalResultStr = serializeValidJson({ ...parsed, ...completion, verification_error: verifyErr });
                    setMessages(prev => [...prev, { role: "assistant", content: verifyErr, ts: Date.now() }]);
                  } else {
                    finalResultStr = serializeValidJson({ ...parsed, ...completion });
                    setMessages(prev => [...prev, { role: "assistant", content: `✓ Verificado: ${completion.verifiedTemplateIds.length} template(s) cumplen el contrato (${completion.verifiedTemplateIds.join(", ")})`, ts: Date.now(), kind: "step" }]);
                  }
                }
              }
            } catch { /* resultStr was not JSON — skip verification */ }
          }

          let parsedFinalResult: any = null;
          if (tc.name === "harness_delegate_task") {
            try { parsedFinalResult = JSON.parse(finalResultStr); } catch { /* opaque result */ }
            // Track session for governance panel
            if (parsedFinalResult?.sessionId) {
              setGovernanceSessions(prev => {
                if (prev.some(s => s.sessionId === parsedFinalResult.sessionId)) return prev;
                return [...prev.slice(-49), {
                  sessionId: parsedFinalResult.sessionId,
                  taskId: tc.args?.taskId,
                  role: parsedFinalResult.role || "unknown",
                  status: parsedFinalResult.verification_failed ? "failed" : parsedFinalResult.outcome || "unknown",
                  ts: Date.now(),
                }];
              });
            }
          }
          const finalIsError = finalResultStr.includes('"error"') || finalResultStr.includes('"code":-')
            || parsedFinalResult?.verification_failed === true
            || ["error", "partial", "verification_failed"].includes(parsedFinalResult?.outcome);
          setToolEvents(prev => prev.map(event => event.id === eventId
            ? {
                ...event,
                tool: tc.name === "harness_delegate_task" && finalIsError
                  ? `${parsedFinalResult?.role || "subagent"}: verification_failed`
                  : event.tool,
                status: finalIsError ? "error" as const : "done" as const,
                result: sanitizeRuntimeText(finalResultStr, 4000),
              }
            : event));
          if (finalIsError && !isError) {
            appendErrorReport({
              tool: `${tc.name}:post_verification`,
              args: {},
              result: sanitizeRuntimeText(finalResultStr, 500),
              step: ti + 1,
              totalSteps: toolCalls.length,
              round,
              timestamp: new Date().toISOString(),
              provider: leaderProvider,
            });
          }

          // Re-bootstrap after delegation so the next leader turn has fresh
          // workspace state (new templates, updated styles). Non-blocking.
          if (tc.name === "harness_delegate_task" && !finalIsError) {
            bootstrapSession().then(ctx => setBootstrapCtx(ctx)).catch(() => {});
          }

          if (isAnthropic) { anthropicResults.push({ type: "tool_result", tool_use_id: tc.id, content: finalResultStr }); }
          else { conversation.push({ role: "tool", tool_call_id: tc.id, content: finalResultStr }); }
        }
        if (isAnthropic && anthropicResults.length > 0) conversation.push({ role: "user", content: anthropicResults });

        // ── Leader per-round trace (Level 7) ──
        if (currentContext.sessionId && toolCalls.length > 0) {
          try {
            // Reconstruct results from conversation since the leader pushes
            // tool results directly (not via a separate tracking var)
            const leaderToolResults = toolCalls.map((tc) => {
              const resultMsg = isAnthropic
                ? anthropicResults.find((r: any) => r?.tool_use_id === tc.id)
                : conversation.find((m: any) => m?.role === "tool" && m?.tool_call_id === tc.id);
              const rc = typeof resultMsg?.content === "string" ? resultMsg.content : "";
              return { tool_call_id: tc.id, len: rc.length, preview: rc.slice(0, 200) };
            });
            const traceEntry = {
              type: "round",
              role: "leader",
              round: round + 1,
              assistantText: textContent?.slice(0, 300) || null,
              toolCalls: toolCalls.map((tc: any) => ({ name: tc.name, id: tc.id, argsPreview: JSON.stringify(tc.args || {}).slice(0, 200) })),
              toolResults: leaderToolResults,
              truncated: responseStoppedIncomplete(data, isAnthropic),
              finishReason: leaderFinishReason || undefined,
              conversationLen: conversation.length,
            };
            await mcpCall("harness_log_entry", {
              sessionId: currentContext.sessionId,
              entryType: "subagent_trace",
              content: JSON.stringify(traceEntry),
            }).catch(() => {});
          } catch { /* best-effort */ }
        }

        if (round === MAX_TOOL_ROUNDS) {
          setMessages(prev => [...prev, { role: "assistant", content: textContent.trim() || "(límite de iteraciones alcanzado — revisa el Kanban)", ts: Date.now() }]);
        }
      }

      if (leaderHttpError) {
        const providerError = leaderHttpError;
        const label = providerError.category === "context_limit" ? "límite de contexto" : "solicitud inválida";
        setMessages(prev => [...prev, {
          role: "assistant",
          content: `Error del proveedor (${label}, HTTP ${providerError.status}): ${providerError.body}. No asumiré que el trabajo terminó; solo cuentan los artifacts que el sistema haya verificado explícitamente.`,
          ts: Date.now(),
        }]);
      }
    } catch (e: any) {
      if (e?.name === "AbortError") {
        setMessages(prev => [...prev, { role: "assistant", content: "Detenido.", ts: Date.now() }]);
      } else {
        setMessages(prev => [...prev, { role: "assistant", content: `Error: ${e?.message || "no se pudo contactar al proveedor"}. Verifica tu API key.`, ts: Date.now() }]);
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }, [input, sending, leaderKey, messages, leaderModel, leaderProvider, systemPrompt]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Group consecutive "step" (narration/verification) messages so they
  // render as one collapsed "N pasos ▸" line instead of cluttering the
  // transcript — expand on click to see each one, muted, in place.
  type RenderItem = { type: "message"; message: Message; index: number } | { type: "stepGroup"; messages: Message[]; startIndex: number };
  const renderItems: RenderItem[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.kind === "step") {
      const last = renderItems[renderItems.length - 1];
      if (last && last.type === "stepGroup") {
        last.messages.push(m);
      } else {
        renderItems.push({ type: "stepGroup", messages: [m], startIndex: i });
      }
    } else {
      renderItems.push({ type: "message", message: m, index: i });
    }
  }

  const panelWidth = 420;
  const activeProgress = [...toolEvents].reverse().find(event => event.progress)?.progress;
  const activeElapsedMs = activeProgress
    ? activeProgress.elapsedMs + (sending ? Math.max(0, clockNow - activeProgress.emittedAt) : 0)
    : 0;
  return (
    <>
      {/* Floating button */}
      {!open && !hideFab && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Abrir chat (Leader)"
          style={{
            position: "fixed", bottom: 24, right: 88, zIndex: 9100,
            width: 52, height: 52, borderRadius: "50%",
            background: "#0c0c0c",
            border: "1px solid rgba(200,184,152,0.35)",
            boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
            color: "#c8b898", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22, transition: "transform 0.2s ease, box-shadow 0.2s ease",
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.08)"; e.currentTarget.style.boxShadow = "0 6px 32px rgba(0,0,0,0.6)"; }}
          onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 4px 24px rgba(0,0,0,0.5)"; }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}

      {/* Slide-in panel */}
      <div data-chat-fab-panel="true" style={{
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

          <button type="button" aria-label="Gobernanza" onClick={() => setShowGovernance(true)} title="Panel de Gobernanza — trazas de subagentes" style={{
            background: governanceSessions.length > 0 ? "rgba(167,139,250,0.15)" : "rgba(255,255,255,0.05)",
            border: "none", color: governanceSessions.length > 0 ? "#a78bfa" : "rgba(255,255,255,0.4)",
            cursor: "pointer", fontSize: 14, borderRadius: 8, padding: "4px 10px", fontFamily: "inherit",
            position: "relative",
          }}>
            🏛️
            {governanceSessions.length > 0 && (
              <span style={{ position: "absolute", top: -2, right: -4, fontSize: 8, background: "#a78bfa", color: "#fff", borderRadius: 8, padding: "0 4px", fontWeight: 700, lineHeight: "14px" }}>
                {governanceSessions.length}
              </span>
            )}
          </button>

          <button type="button" aria-label="Cerrar chat" onClick={() => setOpen(false)} style={{
            background: "rgba(255,255,255,0.05)", border: "none", color: "rgba(255,255,255,0.4)",
            cursor: "pointer", fontSize: 16, borderRadius: 8, padding: "4px 10px", fontFamily: "inherit",
          }}>✕</button>
        </div>

        {/* Accordion: Config */}
        <div style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", flexShrink: 0 }}>
          <button type="button" aria-expanded={accordion === "config"} aria-controls="chat-config-panel" onClick={() => setAccordion(a => a === "config" ? null : "config")} style={{
            width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 18px",
            background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit",
            color: "rgba(255,255,255,0.4)", fontSize: 11, fontWeight: 600,
          }}>
            <span style={{ fontSize: 10, transition: "transform 0.2s", display: "inline-block", transform: accordion === "config" ? "rotate(0deg)" : "rotate(-90deg)" }}>▾</span>
            Configuración
            <span style={{ marginLeft: "auto", width: 8, height: 8, borderRadius: "50%", background: leaderKey ? "#34d399" : "#f87171" }} />
          </button>
          {accordion === "config" && (
            <div id="chat-config-panel" style={{ padding: "0 18px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
              {/* ── API Keys per provider ── */}
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1 }}>API Keys</div>
              {PROVIDERS.map(p => (
                <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <label htmlFor={`provider-key-${p.id}`} style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{p.label}</label>
                  <input
                    id={`provider-key-${p.id}`}
                    type="password"
                    value={providerKeys[p.id] || ""}
                    onChange={e => setProviderKeys(prev => ({ ...prev, [p.id]: e.target.value }))}
                    placeholder={`${p.keyPrefix}... ${p.label} key`}
                    style={{ ...inputBase, padding: "5px 10px", fontSize: 11, fontFamily: "monospace" }}
                  />
                </div>
              ))}
          
              {/* ── Model per role ── */}
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1, marginTop: 4 }}>Modelos por Rol</div>
              {(["leader", "implementer", "reviewer"] as AgentRole[]).map(role => (
                <div key={role} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontWeight: 500 }}>
                    {role === "leader" ? "Leader" : role === "implementer" ? "Implementer" : "Reviewer"}
                    <span style={{ color: "rgba(255,255,255,0.2)", marginLeft: 4 }}>
                      {role === "leader" ? "(chat)" : role === "implementer" ? "(diseño)" : "(verificación)"}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <select
                      aria-label={`Provider para ${role}`}
                      value={roleConfig[role].provider}
                      onChange={e => {
                        const pid = e.target.value;
                        const def = PROVIDERS.find(x => x.id === pid)?.defaultModel || "";
                        setRoleConfig(prev => ({ ...prev, [role]: { provider: pid, model: def } }));
                      }}
                      style={{ ...inputBase, flex: 1, padding: "5px 8px", fontSize: 11 }}
                    >
                      {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                    <select
                      aria-label={`Modelo para ${role}`}
                      value={roleConfig[role].model}
                      onChange={e => setRoleConfig(prev => ({ ...prev, [role]: { ...prev[role], model: e.target.value } }))}
                      style={{ ...inputBase, flex: 1, padding: "5px 8px", fontSize: 11 }}
                    >
                      {(PROVIDERS.find(p => p.id === roleConfig[role].provider)?.models || []).map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </div>
              ))}
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>Keys guardadas en tu navegador. Se envían directo al proveedor LLM. Cada rol puede usar un proveedor y modelo distinto.</span>
            </div>
          )}
        </div>

        {/* Messages */}
        <div ref={scrollRef} style={{
          flex: 1, overflowY: "auto", padding: "14px 18px",
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          {renderItems.map(item => {
            if (item.type === "message") {
              const m = item.message;
              return (
                <div key={item.index} style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  background: m.role === "user" ? "rgba(200,184,152,0.15)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${m.role === "user" ? "rgba(200,184,152,0.3)" : "rgba(255,255,255,0.06)"}`,
                  borderRadius: 12, padding: "10px 14px",
                  fontSize: 12.5, lineHeight: 1.5, color: "rgba(255,255,255,0.85)",
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                  userSelect: "text", cursor: "text",
                }}>{renderWithLinks(m.content)}</div>
              );
            }
            // Collapsed step group — muted narration/verification trail,
            // like Claude Code's "ran a command, click for detail".
            const isExpanded = expandedStepGroups.has(item.startIndex);
            return (
              <div key={`steps-${item.startIndex}`} style={{ alignSelf: "flex-start", maxWidth: "85%" }}>
                <button
                  type="button"
                  onClick={() => setExpandedStepGroups(prev => {
                    const next = new Set(prev);
                    if (next.has(item.startIndex)) next.delete(item.startIndex); else next.add(item.startIndex);
                    return next;
                  })}
                  style={{
                    background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit",
                    color: "rgba(255,255,255,0.3)", fontSize: 11, padding: "2px 0",
                    display: "flex", alignItems: "center", gap: 5,
                  }}
                >
                  <span style={{ display: "inline-block", transition: "transform 0.15s", transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>▸</span>
                  {item.messages.length} paso{item.messages.length === 1 ? "" : "s"}
                </button>
                {isExpanded && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 2, paddingLeft: 14, borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
                    {item.messages.map((m, gi) => (
                      <div key={gi} style={{ fontSize: 11.5, lineHeight: 1.4, color: "rgba(255,255,255,0.4)", whiteSpace: "pre-wrap", wordBreak: "break-word", userSelect: "text" }}>
                        {renderWithLinks(m.content)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {sending && (
            <div style={{ alignSelf: "flex-start", fontSize: 12, color: "#a1a1aa", fontStyle: "italic" }}>
              <span aria-hidden="true">
                {activeProgress
                  ? `${activeProgress.role} · ${SUBAGENT_PROGRESS_LABELS[activeProgress.state]} · ${formatDuration(activeElapsedMs)} · ronda ${activeProgress.round}/${activeProgress.maxRounds} · ${activeProgress.tokenCountKind === "estimated" ? "~" : ""}${formatTokens(activeProgress.cumulativeTokens)} tokens${activeProgress.currentTool ? ` · ${activeProgress.currentTool}` : ""}`
                  : toolEvents.length > 0 ? "ejecutando…" : "pensando…"}
              </span>
              <span role="status" aria-live="polite" style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}>
                {activeProgress
                  ? `${activeProgress.role}: ${SUBAGENT_PROGRESS_LABELS[activeProgress.state]}, ronda ${activeProgress.round} de ${activeProgress.maxRounds}${activeProgress.currentTool ? `, herramienta ${activeProgress.currentTool}` : ""}`
                  : toolEvents.length > 0 ? "Ejecutando herramientas" : "Pensando"}
              </span>
            </div>
          )}
        </div>

        {/* Tool events — native disclosure buttons, stable IDs, selectable details. */}
        {toolEvents.length > 0 && (
          <section aria-label="Actividad de agentes y herramientas" style={{ padding: "8px 18px", borderTop: "1px solid rgba(255,255,255,0.08)", maxHeight: 240, overflowY: "auto", flexShrink: 0, userSelect: "text" }}>
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span id="tool-log-copy-status" role="status" aria-live="polite" style={{ fontSize: 10, color: copyStatus === "error" ? "#fca5a5" : "#a1a1aa" }}>
                {copyStatus === "copied" ? "Logs copiados" : copyStatus === "error" ? "No se pudieron copiar los logs" : ""}
              </span>
              <button
                type="button"
                aria-describedby="tool-log-copy-status"
                onClick={async () => {
                  const text = toolEvents.map(ev => {
                    const progress = ev.progress;
                    const details = progress
                      ? `\n  ${progress.role} ${progress.state}; ${formatDuration(progress.elapsedMs)}; round ${progress.round}/${progress.maxRounds}; ${progress.tokenCountKind === "estimated" ? "~" : ""}${formatTokens(progress.cumulativeTokens)} tokens${progress.currentTool ? `; tool ${progress.currentTool}` : ""}`
                      : "";
                    return `[${ev.status.toUpperCase()}] ${ev.tool}${details}${ev.result ? "\n  " + ev.result : ""}`;
                  }).join("\n\n");
                  try {
                    await navigator.clipboard.writeText(text);
                    setCopyStatus("copied");
                  } catch {
                    setCopyStatus("error");
                  }
                }}
                style={{ fontSize: 10, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 4, padding: "3px 8px", color: "#d4d4d8", cursor: "pointer", flexShrink: 0 }}
              >
                Copiar logs
              </button>
            </div>
            {toolEvents.map(ev => {
              const isExpanded = expandedTools.has(ev.id);
              const detailsId = `tool-event-${ev.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
              const progress = ev.progress;
              const elapsed = progress
                ? progress.elapsedMs + (ev.status === "running" ? Math.max(0, clockNow - progress.emittedAt) : 0)
                : 0;
              return (
                <div key={ev.id} style={{ fontSize: 10, fontFamily: "monospace", padding: "2px 0" }}>
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    aria-controls={detailsId}
                    onClick={() => setExpandedTools(prev => {
                      const next = new Set(prev);
                      if (next.has(ev.id)) next.delete(ev.id); else next.add(ev.id);
                      return next;
                    })}
                    style={{ width: "100%", background: "transparent", border: 0, padding: "3px 0", font: "inherit", color: ev.status === "done" ? "#6ee7b7" : ev.status === "error" ? "#fca5a5" : "#a1a1aa", display: "flex", gap: 6, alignItems: "flex-start", textAlign: "left", cursor: "pointer" }}
                  >
                    <span aria-hidden="true" style={{ flexShrink: 0 }}>{ev.status === "done" ? "✓" : ev.status === "error" ? "✕" : "⏳"}</span>
                    <span style={{ fontWeight: 600, flexShrink: 0 }}>{ev.tool}</span>
                    {progress && (
                      <span style={{ color: "#a1a1aa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {formatDuration(elapsed)} · {progress.round}/{progress.maxRounds} · {progress.tokenCountKind === "estimated" ? "~" : ""}{formatTokens(progress.cumulativeTokens)} tok
                      </span>
                    )}
                  </button>
                  <div id={detailsId} hidden={!isExpanded} style={{ padding: "3px 0 6px 20px", color: "#a1a1aa", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.45 }}>
                    {progress && `${progress.role} · ${SUBAGENT_PROGRESS_LABELS[progress.state]} · ${formatDuration(elapsed)} · ronda ${progress.round}/${progress.maxRounds} · ${progress.tokenCountKind === "estimated" ? "~" : ""}${formatTokens(progress.cumulativeTokens)} tokens${progress.currentTool ? `\nTool: ${progress.currentTool}` : ""}${progress.attempt ? `\nIntento: ${progress.attempt}` : ""}`}
                    {progress && ev.result ? "\n" : ""}
                    {ev.result || (!progress ? "Sin detalle adicional" : "")}
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {/* Input */}
        <div style={{ padding: "12px 18px", borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              aria-label="Mensaje para el Leader"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={leaderKey ? "Pídele algo al Leader…" : "Configura tu API key ↑"}
              disabled={sending}
              style={{ ...inputBase, flex: 1, padding: "8px 12px", fontSize: 12.5 }}
            />
            {sending ? (
              <button type="button" onClick={stop} aria-label="Detener al Leader" title="Detener al Leader" style={{
                background: "rgba(248,113,113,0.15)", color: "#fca5a5",
                border: "1px solid rgba(248,113,113,0.4)",
                borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit",
              }}>■ Detener</button>
            ) : (
              <button type="button" onClick={send} disabled={!input.trim() || !leaderKey} style={{
                background: input.trim() && leaderKey ? "rgba(200,184,152,0.2)" : "rgba(255,255,255,0.04)",
                color: input.trim() && leaderKey ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.2)",
                border: `1px solid ${input.trim() && leaderKey ? "rgba(200,184,152,0.35)" : "rgba(255,255,255,0.05)"}`,
                borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600,
                cursor: input.trim() && leaderKey ? "pointer" : "not-allowed", fontFamily: "inherit",
              }}>Enviar</button>
            )}
          </div>
        </div>
      </div>

      {/* Governance Panel */}
      {showGovernance && (
        <GovernancePanel
          sessions={governanceSessions}
          onClose={() => setShowGovernance(false)}
        />
      )}
    </>
  );
}
