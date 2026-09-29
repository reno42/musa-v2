import { useState, useRef, useEffect, useCallback } from "react";
import {
  appendRemoteHistory, fetchRemoteHistory, fetchProviderKeys, fetchDecryptedKey,
  saveProviderKeyRemote, deleteProviderKeyRemote, migrateLocalKeys, type StoredKey,
} from "../lib/chatHistory";
import { mcpCall } from "../lib/mcpClient";
import { chooseMusaModules, searchMusaTools } from "../lib/musaToolRouting";
import { routeIntent, warmRouter } from "../lib/intentRouter";
// TEMP-ROUTER-V2: RECIPES permanece cuando llegue el modelo v2 (el clasificador
// emitirá labels recipe_*); lo temporal es matchTempRecipe y su branch abajo.
import { RECIPES, RecipeStepError, matchTempRecipe, type RecipeEnv } from "../lib/recipes";
// FASE 2 ghost: teatro del cursor + observador de UI + decisor agéntico.
// ghostBrain queda AISLADO para intercambiarse por el router v3 cuando el
// modelo tenga las clases de acciones-UI (REPORTE_MIRA_fase2_ghost.md).
import { ghost, GhostAbortedError, type GhostMode } from "../lib/ghostCursor";
import { GHOST_MAX_STEPS, type GhostLlm } from "../lib/ghostBrain";
import { runGhostAgent } from "../lib/ghostAgent";
import { apiFetch } from "../lib/supabase";
import { CHAT_PROVIDERS as PROVIDERS, defaultModelFor } from "../lib/aiProviders";
// Sync del catálogo real: GET /models de cada proveedor con la key de la
// cuenta — un modelo nuevo del proveedor aparece sin deploy.
import { fetchProviderModels } from "../lib/modelSync";
import { beginCreation, endCreation, installCreationUnloadGuard } from "../lib/creationActivity";
// Shared viewport channel + the local gesture log (REQ Gesture Mode §7):
// both are session-local — nothing here ever reaches the MCP server.
import { dispatchEditorViewport, isEditorOpen } from "../lib/editorViewport";
import { getRecentGestureEvents } from "../lib/gesture/gestureStore";
import { fetchUserPrefs, saveUserPrefs } from "../lib/userPrefs";
import { getApiHeaders } from "../lib/apiKey";
import { GovernancePanel, type GovernanceSession } from "./GovernancePanel";
import {
  MAX_SUBAGENT_ROUNDS,
  LLM_MAX_TOKENS,
  GHOST_BRAIN_MAX_TOKENS,
  MAX_CONTINUE_RETRIES,
  CREATOR_TOOL_NAMES,
  MUTATION_TOOL_NAMES,
  buildWorkManifest,
  canParallelizeReadTools,
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
  readOpenAiChatStream,
  responseStoppedIncomplete,
  sanitizeRuntimeText,
  selectProviderTools,
  serializeValidJson,
  toolResultForModel,
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
// FASE 2 ghost: chips de creación (Parte 4) — datos planos persist-safe,
// nada de closures: recipeId + utterance viajan con el mensaje.
interface GhostChip { label: string; choice: "here" | "parallel"; recipeId: string; utterance: string }
interface Message { role: Role; content: string; ts?: number; kind?: "step"; chips?: GhostChip[] }

// ── TEMP-ROUTER-V3 (fase 2): intenciones que el modelo v3 clasificará —
// mientras tanto regex marcada, igual que las recetas (autorizado por el spec). ──
// Creación con intención explícita de paralelo: ejecuta directo, SIN chips.
const TEMP_PARALLEL_INTENT = /\b(?:aparte|en paralelo|paralelamente|en otro archivo|en segundo plano|m[aá]ndame el link|solo el link)\b/i;
// "Muéstrame cómo…" → loop agéntico del ghost en vez del turno normal del LLM.
const TEMP_GHOST_TEACH = /\b(?:mu[eé]strame|ens[eé][ñn]ame|d[eé]muestra)\b[^.?!]*\bc[óo]mo\b/i;
// Recetas que CREAN un archivo nuevo (Parte 4: a estas les toca preguntar).
const CREATION_RECIPES = new Set(["recipe_carrusel_content", "recipe_deck_from_template"]);
// Tools cuyo resultado trae un template nuevo → para extraer el link.
const CREATION_TOOLS = new Set(["create_html_carousel", "create_deck", "create_html_template", "create_template"]);

/** Teatro simbólico: mapa tool → zona REAL de la UI para el vuelo del cursor.
 *  Las recetas son llamadas API — el cursor enseña DÓNDE vive el resultado. */
function ghostTargetForTool(tool: string): HTMLElement | { x: number; y: number } | null {
  if (typeof document === "undefined") return null;
  if (CREATION_TOOLS.has(tool)) {
    const nuevo = document.querySelector<HTMLElement>('[data-testid="nuevo-archivo"]');
    if (nuevo) return nuevo;
  }
  const canvas = document.querySelector<HTMLElement>("#canvas-container");
  if (canvas) {
    const r = canvas.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: Math.max(120, r.y + r.height * 0.3) };
  }
  return { x: window.innerWidth / 2, y: 170 };
}

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

/**
 * In-memory cache of decrypted provider keys.
 *
 * Keys live here — never in localStorage — so they survive within a session
 * (allowing direct browser→provider calls) but are cleared on every reload.
 * They are re-fetched from the server on mount, which means the same key
 * follows the user to any device they sign in on without being persisted
 * to disk anywhere.
 */
const memoryKeyCache: Record<string, string> = {};

/** Prevents the Leader from accidentally delegating the same task to the
 *  implementer twice. Maps `${taskId}:${role}` → last successful result +
 *  timestamp. The entry expires after 10 minutes to allow legitimate re-work
 *  after moving the card to "feedback". */
const lastDelegationPerTask = new Map<string, { result: string; timestamp: number }>();

/** Panel open/closed and the half-typed draft, so a reload behind the chat
 *  leaves the chat exactly where it was. */
const LS_OPEN_KEY = "futuraria-chat-open";
const LS_DRAFT_KEY = "futuraria-chat-draft";
/** Set while a turn is in flight, cleared when it finishes. Still set at load
 *  time means the page went away mid-turn. */
const LS_INFLIGHT_KEY = "futuraria-chat-inflight";

type AgentRole = "leader" | "implementer" | "reviewer";
interface RoleConfig { provider: string; model: string }
type RoleConfigMap = Record<AgentRole, RoleConfig>;

// REQ-025.1 Item 1: default = primer modelo REAL del lineup (defaultModelFor)
// — el default anterior era un modelo fantasma (no existe en aiProviders.ts):
// con key válida igual pedía un modelo inexistente.
const DEFAULT_ROLE_CONFIG: RoleConfigMap = {
  leader:       { provider: "deepseek", model: defaultModelFor("deepseek") },
  implementer:  { provider: "deepseek", model: defaultModelFor("deepseek") },
  reviewer:     { provider: "deepseek", model: defaultModelFor("deepseek") },
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
      // REQ-025.1 Item 1: último recurso del migrate = primer modelo REAL del
      // lineup (antes: el fantasma hardcodeado que no existe en ningún lineup).
      const fallbackModel = PROVIDERS.find(p => p.id === oldProvider)?.defaultModel
        || defaultModelFor(oldProvider)
        || defaultModelFor("deepseek");
      const migrated: RoleConfigMap = {
        leader:       { provider: oldProvider, model: oldModel || fallbackModel },
        implementer:  { provider: oldProvider, model: oldModel || fallbackModel },
        reviewer:     { provider: oldProvider, model: oldModel || fallbackModel },
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
    // Read, never re-written: the migration below hands it to the server and
    // erases it. Copying it into a second local slot would only widen the
    // exposure this whole change exists to close.
    if (oldKey && oldProvider === providerId) return oldKey;
  } catch {}
  return "";
}

/**
 * Erases a provider key from this device.
 *
 * There is deliberately no local writer any more. A key is a password that
 * spends money, and localStorage is readable by any extension and any XSS on
 * the page — so keys go to the account, encrypted, and this only cleans up
 * what older versions left behind.
 */
function forgetLocalProviderKey(providerId: string) {
  try {
    localStorage.removeItem(LS_PROVIDER_KEYS_PREFIX + providerId);
    // The pre-multi-provider slots, so a migration does not leave a copy in
    // the one place nobody thinks to look.
    if (localStorage.getItem(LS_PROVIDER_KEY) === providerId) {
      localStorage.removeItem(LS_LLM_KEY_KEY);
      localStorage.removeItem(LS_PROVIDER_KEY);
    }
  } catch {}
}

/** Load all provider keys as a map. */
function loadAllProviderKeys(): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const p of PROVIDERS) {
    keys[p.id] = getProviderKey(p.id);
  }
  return keys;
}

/**
 * Resolve the LLM config for a role: which provider and model to ask for.
 *
 * Returns the actual decrypted key (from the in-memory cache) and the
 * provider's direct endpoint. The browser calls the provider directly —
 * a server-side proxy cannot survive Netlify freemium's 10s limit when
 * LLM completions take 15-60s.
 */
function resolveRoleLLM(role: AgentRole): {
  providerId: string; model: string; apiKey: string; endpoint: string; isAnthropic: boolean;
} | null {
  const cfg = loadRoleConfig()[role];
  const prov = PROVIDERS.find(p => p.id === cfg.provider) || PROVIDERS[0];
  const key = memoryKeyCache[cfg.provider] || "";
  if (!key) return null;
  return {
    providerId: cfg.provider,
    model: cfg.model || prov.defaultModel,
    apiKey: key,
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
// Id de conversación del ChatFAB para la telemetría chatfab_decisions
// (router v0): uno por carga de página, estable durante toda la sesión.
const chatfabSessionId = `cfab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
let currentContext: { workspaceId?: string; templateId?: string; sessionId?: string } = { sessionId: chatfabSessionId };
const discoveredToolSchemas = new Map<string, any>();

/** Auto-fill workspaceId when the model's tool call omits it but the tool
 *  schema accepts it and we know the current value. Only workspaceId — it's
 *  always safe (just affects where things get filed). templateId is NOT
 *  auto-filled: it means "edit this exact file", and silently attaching
 *  "whatever's open in the editor" to a tool call the model didn't intend
 *  to scope that way is how an unrelated frame got overwritten. templateId
 *  must always come from the model's own explicit choice. */
function resolveArgs(name: string, args: Record<string, any>): Record<string, any> {
  const def = HARNESS_TOOLS.find(t => t.function.name === name);
  const props = (def?.function?.parameters || discoveredToolSchemas.get(name))?.properties || {};
  const resolved = { ...args };
  if (resolved.workspaceId === undefined && "workspaceId" in props && currentContext.workspaceId) {
    resolved.workspaceId = currentContext.workspaceId;
  }
  return resolved;
}



// ═══════════════════════════════════════════════
// BOOTSTRAP CONTEXT — loaded ONCE when chat opens so the Leader starts
// every session with memory instead of from zero.
// ═══════════════════════════════════════════════
interface BootstrapContext {
  healthOk: boolean;
}

async function bootstrapSession(): Promise<BootstrapContext> {
  const ctx: BootstrapContext = { healthOk: false };
  try {
    const health = await mcpCall("harness_healthcheck", {}).catch(() => null);
    ctx.healthOk = health?.ok === true;
  } catch { /* bootstrap is best-effort */ }
  return ctx;
}

// Compact default: the model gets only the current workspace and the tools
// for the request. Detailed design procedure lives in the implementer, and
// playbooks are fetched only when a specific job needs one.
const MUSA_EFFICIENT_PROMPT = `Eres Musa, el asistente de Futuraria Design. Resuelve el pedido usando herramientas reales y responde con resultados comprobados.

{CURRENT_CONTEXT}

Decide qué trabajos pide el usuario. Puede haber varios módulos en orden (por ejemplo copywriting y después diseño). Para copywriting, CRM, configuración y motion, usa las herramientas pertinentes directamente y relee los datos que cambiaste. Para creación o edición de diseño estático, el runtime actual requiere una tarjeta, implementer y reviewer: crea la tarjeta con los datos disponibles y delega una sola vez con un contrato que precise crear o editar, cantidad de archivos y frames, dimensiones, textos exigidos y estilo. Verifica los IDs y resultados devueltos. Después delega la revisión y completa la tarea solo si pasan sus checks. No abras sesiones adicionales para consultas o cambios ajenos a ese flujo. Si falta una herramienta, usa musa_find_tools con una query concreta.

Para animación o video usa musa_find_tools({group:"motion"}) y comprueba el resultado con las herramientas disponibles; no lo trates como diseño estático. No supongas que el template abierto debe editarse: úsalo solo si el usuario se refiere a él. En trabajos de marca, consulta el contexto de marca cuando corresponda. Si un listado aparece compactado, repite la consulta con filtros o paginación antes de asumir que ya viste todo. Pide únicamente los datos indispensables que falten; si una herramienta falla, comunica el error concreto. No inventes resultados ni describas llamadas a herramientas como si las hubieras ejecutado. Conserva IDs de artefactos para continuar fases y reporta enlaces reales. Para trabajos largos, procesa lotes y deja estado recuperable. Nunca incluyas secretos en texto o bitácoras.`;

/** Fills in the {CURRENT_CONTEXT} block with what the human is actually looking at. */
function buildSystemPrompt(bootstrap?: BootstrapContext): string {
  const ctxLines: string[] = [];
  if (currentContext.workspaceId) ctxLines.push(`- workspaceId actual: ${currentContext.workspaceId}`);
  if (currentContext.templateId) ctxLines.push(`- templateId actualmente abierto en el editor: ${currentContext.templateId} (si el pedido es sobre "esto"/"este diseño", es este)`);
  if (bootstrap && !bootstrap.healthOk) ctxLines.push("⚠️ HEALTH CHECK FALLÓ. Verifica conexión con Supabase antes de continuar.");
  const block = ctxLines.length > 0
    ? `CONTEXTO ACTUAL (lo que el humano está mirando ahora mismo):\n${ctxLines.join("\n")}`
    : `CONTEXTO ACTUAL: no se detectó un workspace específico. Llama list_workspaces si necesitas uno.`;
  return MUSA_EFFICIENT_PROMPT.replace("{CURRENT_CONTEXT}", block);
}

/** Per-brand bundle served by GET /brands/context (saas.ts) — the compact
 *  style+strategy summary the leader gets injected when the human names the
 *  brand, instead of burning tool round-trips discovering it. */
interface BrandContextEntry {
  brandId: string;
  name: string;
  relationship: string;
  workspaceId: string;
  hasDesignSystem: boolean;
  dsTemplateId: string | null;
  plantillasTemplateId: string | null;
  colors: string[];
  fonts: string[];
  strategy: string;
  plantillas: string[];
  sharedCssPreview: string;
  designMdPreview: string;
}

function normalizeBrandName(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

/** System-prompt appendix: the full style bundle of the brands the human
 *  mentioned (≤2), so "anda ve usa el estilo de Futuraria y arma X" carries
 *  its own context. No mention → no injection (bootstrap already lists ids). */
function brandContextBlock(brands: BrandContextEntry[], userText: string): string {
  if (!brands.length || !userText) return "";
  const text = normalizeBrandName(userText);
  const mentioned = brands.filter(b => text.includes(normalizeBrandName(b.name))).slice(0, 2);
  if (!mentioned.length) return "";
  return "\n\n" + mentioned.map(b => [
    `CONTEXTO DE MARCA RESUELTO — ${b.name} (brandId: ${b.brandId}, workspaceId: ${b.workspaceId}, relación: ${b.relationship}):`,
    `- Design System: ${b.hasDesignSystem ? `listo (${b.dsTemplateId})` : "aún sin archivo"}`,
    b.colors.length ? `- Colores: ${b.colors.join(", ")}` : "",
    b.fonts.length ? `- Tipografías: ${b.fonts.join(", ")}` : "",
    `- Estrategia: ${b.strategy}`,
    b.plantillas.length ? `- Plantillas curadas: ${b.plantillas.join(" · ")}` : "",
    b.sharedCssPreview ? `- sharedCss (preview): ${b.sharedCssPreview}` : "",
    `Usa DIRECTAMENTE estos datos y ese brandId para pedidos de esta marca. NO llames list_brand_guidelines ni get_active_styles; get_brand_playbook solo si necesitas los artifacts completos; create_from_plantilla para producir series con este estilo.`,
  ].filter(Boolean).join("\n")).join("\n\n");
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
  //  Editor Viewport (LOCAL — corre en el navegador, nunca llega al MCP)
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "editor_zoom", description: "Zoom del editor abierto, igual que el gesto de pellizcar del trackpad del humano. in=acercar, out=alejar, fit=encuadrar todos los frames, set=nivel exacto. Requiere el EditorV2 abierto.", parameters: { type: "object", required: ["action"], properties: { action: { type: "string", enum: ["in", "out", "fit", "set"] }, zoom: { type: "number", description: "Solo con action=set: 0.5 = 50%, 1 = 100%" } } } } },
  { type: "function", function: { name: "editor_pan", description: "Mueve el lienzo del editor abierto, igual que el scroll de dos dedos del humano. dx/dy en píxeles; positivo mueve el contenido a la derecha/abajo (como arrastrar los dedos). Requiere el EditorV2 abierto.", parameters: { type: "object", required: ["dx", "dy"], properties: { dx: { type: "number" }, dy: { type: "number" } } } } },
  { type: "function", function: { name: "get_recent_gestures", description: "Lee los últimos gestos que hicieron las manos del humano en Musa Hands (modo gesto del editor): qué gesto disparó qué acción del editor (pan, zoom, mover capa, play/stop, scrub, swipe de frame) y cuándo. Úsalo para narrar el demo, entender por qué se movió el lienzo, o reportar qué manipuló el humano con las manos sin tocar el mouse.", parameters: { type: "object", properties: { limit: { type: "number", description: "Cuántos eventos devolver (1-40). Default 15, el más nuevo primero." } } } } },
  // ═══════════════════════════════════════════════
  //  Content Calendar & Social Publishing
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "list_calendar_entries", description: "Lista las filas del Calendario de Contenidos (una fila = una pieza). Filtra por ventana de fechas (from/to YYYY-MM-DD), status (idea|diseño|aprobación|programado|publicado), kind (organic|ad) y marca (brandId o varias con brandIds). Úsalo antes de proponer ideas para no duplicar.", parameters: { type: "object", properties: { workspaceId: { type: "string" }, from: { type: "string" }, to: { type: "string" }, status: { type: "string" }, kind: { type: "string" }, brandId: { type: "string" }, brandIds: { type: "array", items: { type: "string" } }, limit: { type: "number" } } } } },
  { type: "function", function: { name: "add_content_idea", description: "Agrega una IDEA al calendario: fila con status='idea' y copy vacío. Requiere scheduledDate (YYYY-MM-DD) y topic; channels/kind/campaign/brandId/notes opcionales.", parameters: { type: "object", required: ["scheduledDate", "topic"], properties: { workspaceId: { type: "string" }, scheduledDate: { type: "string" }, scheduledTime: { type: "string" }, topic: { type: "string" }, copy: { type: "string" }, channels: { type: "array", items: { type: "string" } }, kind: { type: "string" }, brandId: { type: "string" }, campaign: { type: "string" }, notes: { type: "string" } } } } },
  { type: "function", function: { name: "update_content", description: "Actualiza una fila del calendario: escribe el copy (sigue las recetas de list_copy_recipes), cambia topic/fecha/hora/canales/campaña, adjunta el diseño (templateId + frameId) o avanza el status idea → diseño → aprobación → programado → publicado.", parameters: { type: "object", required: ["id"], properties: { id: { type: "string" }, topic: { type: "string" }, copy: { type: "string" }, status: { type: "string" }, scheduledDate: { type: "string" }, scheduledTime: { type: "string" }, channels: { type: "array", items: { type: "string" } }, kind: { type: "string" }, brandId: { type: "string" }, campaign: { type: "string" }, templateId: { type: "string" }, frameId: { type: "string" }, externalUrl: { type: "string" }, notes: { type: "string" } } } } },
  { type: "function", function: { name: "delete_content", description: "Elimina una fila del calendario (idea o contenido) por id.", parameters: { type: "object", required: ["id"], properties: { id: { type: "string" } } } } },
  { type: "function", function: { name: "list_copy_recipes", description: "Lista las recetas de redacción del account: 10 frameworks de fábrica (AIDA, PAS, StoryBrand…) + las personales del usuario. Léelas ANTES de redactar un copy y menciona cuáles aplicaste.", parameters: { type: "object", properties: { workspaceId: { type: "string" }, type: { type: "string" }, search: { type: "string" }, limit: { type: "number" }, offset: { type: "number" } } } } },
  { type: "function", function: { name: "create_copy_recipe", description: "Crea una receta de redacción personal (type: hook | tono | framework | otro). Solo la ve este usuario.", parameters: { type: "object", required: ["type", "name"], properties: { workspaceId: { type: "string" }, type: { type: "string" }, name: { type: "string" }, content: { type: "string" } } } } },
  { type: "function", function: { name: "update_copy_recipe", description: "Actualiza una receta de redacción personal (las de fábrica son de solo lectura).", parameters: { type: "object", required: ["id"], properties: { id: { type: "string" }, name: { type: "string" }, content: { type: "string" }, type: { type: "string" } } } } },
  { type: "function", function: { name: "delete_copy_recipe", description: "Elimina una receta de redacción personal por id.", parameters: { type: "object", required: ["id"], properties: { id: { type: "string" } } } } },
  { type: "function", function: { name: "list_social_accounts", description: "Lista las conexiones sociales del workspace (Buffer, Zernio) con sus cuentas reales: id, platform y nombre de cada cuenta, más los defaults por workspace y por marca. Es la fuente de accountIds para publish_content y set_publish_defaults. refresh:true trae la lista en vivo del proveedor.", parameters: { type: "object", properties: { workspaceId: { type: "string" }, provider: { type: "string", enum: ["buffer", "zernio"] }, refresh: { type: "boolean" } } } } },
  { type: "function", function: { name: "set_publish_defaults", description: "Guarda destinos predeterminados de publicación: los del workspace completo, o con brandId los de UNA marca (el checkbox 'Guardar como destinos predeterminados' del diálogo). accountIds de list_social_accounts; [] con brandId limpia esa marca. Las otras marcas no se tocan.", parameters: { type: "object", required: ["provider", "accountIds"], properties: { workspaceId: { type: "string" }, provider: { type: "string", enum: ["buffer", "zernio"] }, brandId: { type: "string" }, accountIds: { type: "array", items: { type: "string" } }, isDefault: { type: "boolean" } } } } },
  { type: "function", function: { name: "publish_content", description: "Publica o programa una pieza del calendario en sus destinos sociales reales — el mismo pipeline del botón Publicar/Programar del humano. mode:now envía ya; mode:schedule pide scheduledFor 'YYYY-MM-DDTHH:MM:00' + timezone. accountIds (list_social_accounts) eligen las cuentas exactas — dos cuentas de Instagram = dos ids; omítelos para usar los defaults guardados. Stories/reels requieren Zernio y media. La pieza necesita copy.", parameters: { type: "object", required: ["contentId", "mode"], properties: { workspaceId: { type: "string" }, contentId: { type: "string" }, mode: { type: "string", enum: ["now", "schedule"] }, accountIds: { type: "array", items: { type: "string" } }, contentType: { type: "string", enum: ["post", "story", "reel"] }, provider: { type: "string", enum: ["buffer", "zernio"] }, scheduledFor: { type: "string" }, timezone: { type: "string" } } } } },
  // ═══════════════════════════════════════════════
  //  CRM interactions
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "log_interaction", description: "Registra un punto de contacto comercial con una marca en el timeline del CRM (reunión, llamada, propuesta enviada, pago, follow-up…). El mismo timeline que ve el humano en Personas → ficha 360. Actualiza last_contacted_at de la marca — alimenta la señal de salud at_risk. Loguéala después de cada reunión o llamada real con un cliente.", parameters: { type: "object", required: ["brandId", "interactionType"], properties: { workspaceId: { type: "string" }, brandId: { type: "string" }, contactId: { type: "string" }, interactionType: { type: "string", enum: ["primer_contacto", "reunion", "llamada", "email", "whatsapp", "propuesta_enviada", "revision", "aprobacion", "publicacion", "pago", "follow_up", "objecion", "otro"] }, notes: { type: "string" }, interactionDate: { type: "string" } } } } },
  { type: "function", function: { name: "list_interactions", description: "Lee el timeline de interacciones comerciales del CRM (filtrable por marca o persona, más reciente primero). Úsalo para ponerte al día antes de contactar a un cliente: últimas reuniones, propuestas enviadas, objeciones, pagos.", parameters: { type: "object", properties: { workspaceId: { type: "string" }, brandId: { type: "string" }, contactId: { type: "string" }, limit: { type: "number" } } } } },
  { type: "function", function: { name: "get_crm_overview", description: "Lee el CRM completo del workspace en una llamada: marcas (con salud computada — cliente sin deals abiertos y 30+ días sin contacto = en fuga; el pin manual gana), personas (con dealStats), deals con progreso y resumen (pipeline, valor ponderado, cuentas en fuga). Empieza aquí antes de cualquier acción CRM.", parameters: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" } } } } },
  { type: "function", function: { name: "create_crm_deal", description: "Crea un deal (oportunidad) para una marca: título, etapa, valor, moneda, probabilidad y deliverables (lo que compró el cliente). Recorre el mismo embudo que ve el humano: discovery → proposal → negotiation → approved → … → delivered / lost.", parameters: { type: "object", required: ["workspaceId", "brandId", "title"], properties: { workspaceId: { type: "string" }, brandId: { type: "string" }, title: { type: "string" }, primaryContactId: { type: "string" }, stage: { type: "string", enum: ["discovery", "proposal", "negotiation", "approved", "in_production", "review", "ready", "delivered", "lost"] }, value: { type: "number" }, currency: { type: "string" }, probability: { type: "number" }, expectedCloseDate: { type: "string" }, notes: { type: "string" }, deliverables: { type: "array", items: { type: "object", properties: { assetType: { type: "string" }, label: { type: "string" }, quantity: { type: "number" } }, required: ["assetType", "label"] } } } } } },
  { type: "function", function: { name: "update_crm_deal", description: "Actualiza un deal — mover stage ES el embudo: proposal → negotiation → approved → … → delivered (ganado) o lost. Contabilidad de outcome (v45): si se PERDIÓ registra lostReason; si se ENTREGÓ registra finalValue = lo finalmente facturado si difiere del estimado.", parameters: { type: "object", required: ["workspaceId", "dealId"], properties: { workspaceId: { type: "string" }, dealId: { type: "string" }, title: { type: "string" }, stage: { type: "string", enum: ["discovery", "proposal", "negotiation", "approved", "in_production", "review", "ready", "delivered", "lost"] }, value: { type: "number" }, probability: { type: "number" }, expectedCloseDate: { type: "string" }, notes: { type: "string" }, primaryContactId: { type: "string" }, finalValue: { type: "number" }, lostReason: { type: "string" } } } } },
  { type: "function", function: { name: "update_crm_deliverable", description: "Actualiza una línea de deliverable de un deal (tipo de asset, label, cantidad o notas). Los deliverables son el material de conciliación: definen el progreso de producción que el CRM muestra por deal.", parameters: { type: "object", required: ["workspaceId", "dealId", "deliverableId"], properties: { workspaceId: { type: "string" }, dealId: { type: "string" }, deliverableId: { type: "string" }, assetType: { type: "string" }, label: { type: "string" }, quantity: { type: "number" }, notes: { type: "string" } } } } },
  { type: "function", function: { name: "create_crm_contact", description: "Crea una persona en el CRM. Asígnala a una marca existente (brandId) o solo da brandName — si esa marca no existe se crea automáticamente CON su archivo Design System (una marca = un DS), para que un lead nuevo nunca quede huérfano. Después loguea un primer_contacto para arrancar el timeline.", parameters: { type: "object", required: ["workspaceId", "firstName"], properties: { workspaceId: { type: "string" }, firstName: { type: "string" }, lastName: { type: "string" }, brandId: { type: "string" }, brandName: { type: "string" }, relationshipStatus: { type: "string", enum: ["lead", "client"] }, email: { type: "string" }, phone: { type: "string" }, jobTitle: { type: "string" }, company: { type: "string" }, status: { type: "string", enum: ["lead", "active", "inactive"] }, tags: { type: "array", items: { type: "string" } }, notes: { type: "string" } } } } },
  { type: "function", function: { name: "update_crm_contact", description: "Actualiza una persona del CRM: datos de contacto (email, teléfono, cargo, empresa), estado del ciclo de vida (lead | active | inactive) o notas. Úsalo cuando una conversación cambia algo real de la persona.", parameters: { type: "object", required: ["workspaceId", "contactId"], properties: { workspaceId: { type: "string" }, contactId: { type: "string" }, firstName: { type: "string" }, lastName: { type: "string" }, brandId: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, jobTitle: { type: "string" }, company: { type: "string" }, status: { type: "string", enum: ["lead", "active", "inactive"] }, notes: { type: "string" } } } } },
  { type: "function", function: { name: "update_crm_brand", description: "Actualiza los ajustes comerciales de una marca: relación (lead/client), prioridad, notas CRM, próximo follow-up y salud. Salud: déjala automática (cliente sin deals abiertos y 30+ días sin contacto = en fuga) o fija un valor manual con accountHealthOverride — el pin manual SIEMPRE gana; null vuelve a automático.", parameters: { type: "object", required: ["workspaceId", "brandId"], properties: { workspaceId: { type: "string" }, brandId: { type: "string" }, relationshipStatus: { type: "string", enum: ["lead", "client"] }, priority: { type: "string", enum: ["low", "medium", "high", "urgent"] }, crmNotes: { type: "string" }, nextFollowUpAt: { type: "string" }, accountHealthOverride: { type: "string", enum: ["active", "at_risk", "churned"] } } } } },
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
  { type: "function", function: { name: "create_chart", description: "Genera un chart determinista (donut, vbars, hbars, timeline, line, statgrid, mindmap, journey, versus, matrix2x2, storyarc) y lo pinta dentro de un frame de un template existente. data es un array de objetos {label, value}. Respeta el presupuesto vertical (>=70% de la zona de contenido) y los pisos tipograficos.", parameters: { type: "object", required: ["templateId", "recipe", "data"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, recipe: { type: "string", enum: ["donut", "vbars", "hbars", "timeline", "line", "statgrid", "mindmap", "journey", "versus", "matrix2x2", "storyarc"] }, data: { type: "array", items: { type: "object" } }, palette: { type: "array", items: { type: "string" } }, valueFormat: { type: "string" }, placeholder: { type: "boolean" }, mode: { type: "string", enum: ["replace", "append"] }, highlightIndex: { type: "number" } } } } },
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
  { type: "function", function: { name: "get_brand_graph", description: "Devuelve el árbol jerárquico de marcas para el Second Brain (el grafo Red de Marcas del workspace → marcas → Design System / Plantillas / Assets / Archivos → items). Cada nodo tiene color, nivel, tipo, hijos, templateId y obsidianLink.", parameters: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" } } } } },
  { type: "function", function: { name: "get_brand_playbook", description: "Digest consultable de UNA marca (la contracara de datos del grafo visual): hasDesignSystem (false = la marca aún no tiene su archivo Design System — avísale al usuario y sigue nextAction), design system (colores, fuentes, styleFingerprint), inventario completo de archivos con categoría/campaña/tipo de contenido, subconjunto replicable y counts. Es LA tool para 'revisa toda la lógica que hicimos para la marca X' y OBLIGATORIA antes de diseñar para una marca.", parameters: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" }, brandId: { type: "string" }, brandName: { type: "string", description: "Nombre de la marca si no tienes el ID" } } } } },
  { type: "function", function: { name: "replicate_brand_strategy", description: "Clona la lógica de diseño de una marca A sobre una marca B: crea una tarjeta Kanban por cada archivo replicable de A (más una de extracción de Design System si B no lo tiene) para que el pipeline las procese. Idempotente: lo ya replicado se salta. dryRun:true previsualiza el plan sin crear nada.", parameters: { type: "object", required: ["workspaceId", "sourceBrandId", "targetBrandId"], properties: { workspaceId: { type: "string", description: "CRÍTICO: usa el workspaceId del contexto actual" }, sourceBrandId: { type: "string", description: "Marca origen (ID o nombre)" }, targetBrandId: { type: "string", description: "Marca destino (ID o nombre)" }, maxCards: { type: "number", description: "Máx. tarjetas (1-30, default 15)" }, dryRun: { type: "boolean" } } } } },
  { type: "function", function: { name: "apply_brand", description: "Aplica una marca a un template (colores, fuentes, logos).", parameters: { type: "object", required: ["templateId", "brandId"], properties: { templateId: { type: "string" }, brandId: { type: "string" } } } } },
  { type: "function", function: { name: "create_brand_guideline", description: "Crea una nueva marca con su archivo Design System. Para extraer estilos de un diseño usa generate_design_artifacts(action='publish'). sourceTemplateIds es opcional para crear marcas vacías.", parameters: { type: "object", required: ["workspaceId", "name"], properties: { workspaceId: { type: "string" }, name: { type: "string" }, description: { type: "string" }, tokensJson: { type: "string" }, designMd: { type: "string" }, sharedCss: { type: "string" }, sourceHash: { type: "string" }, styleFingerprint: { type: "string" }, sourceTemplateIds: { type: "array", uniqueItems: true, items: { type: "string" }, description: "Templates fuente (opcional al crear marca)." } } } } },
  { type: "function", function: { name: "get_brand_guideline", description: "Obtiene una guía de marca por ID dentro de su workspace.", parameters: { type: "object", required: ["workspaceId", "brandId"], properties: { workspaceId: { type: "string" }, brandId: { type: "string", description: "Brand Guideline ID" } } } } },
  { type: "function", function: { name: "list_brand_guidelines", description: "Lista resúmenes compactos. Usa includeDeleted=true para ver la papelera. Usa get_brand_guideline para cargar artifacts completos.", parameters: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" }, includeArtifacts: { type: "boolean", description: "Incluye documentos completos. Default false." }, includeDeleted: { type: "boolean", description: "Incluye marcas en papelera. Default false." } } } } },
  { type: "function", function: { name: "update_brand_guideline", description: "Actualiza un estilo sin permitir nombres duplicados ni dejarlo sin referencias o artifacts.", parameters: { type: "object", required: ["workspaceId", "brandId"], properties: { workspaceId: { type: "string" }, brandId: { type: "string", description: "Brand Guideline ID" }, name: { type: "string" }, description: { type: "string" }, tokensJson: { type: "string" }, designMd: { type: "string" }, sharedCss: { type: "string" }, sourceHash: { type: "string" }, styleFingerprint: { type: "string" }, sourceTemplateIds: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string" } }, mode: { type: "string", enum: ["replace", "append"] } } } } },
  { type: "function", function: { name: "delete_brand_guideline", description: "Envía una marca a la papelera (soft-delete). Usa cascadeDs=true para eliminar también su archivo Design System. Restaurable con restore_brand_guideline.", parameters: { type: "object", required: ["workspaceId", "brandId"], properties: { workspaceId: { type: "string" }, brandId: { type: "string", description: "Brand Guideline ID" }, cascadeDs: { type: "boolean", description: "Eliminar también el Design System. Default false." } } } } },
  { type: "function", function: { name: "restore_brand_guideline", description: "Restaura una marca desde la papelera. También restaura su archivo Design System.", parameters: { type: "object", required: ["workspaceId", "brandId"], properties: { workspaceId: { type: "string" }, brandId: { type: "string", description: "Brand Guideline ID a restaurar" } } } } },
  { type: "function", function: { name: "add_frame_to_brand", description: "Duplica un frame de un template fuente al archivo Design System de una marca. El template y frame original NO se modifican. Usa esto para agregar diseños a la Brand Library.", parameters: { type: "object", required: ["workspaceId", "brandId", "sourceTemplateId", "sourceFrameId"], properties: { workspaceId: { type: "string" }, brandId: { type: "string", description: "Brand Guideline ID destino" }, sourceTemplateId: { type: "string", description: "Template que contiene el frame a copiar" }, sourceFrameId: { type: "string", description: "Frame ID a duplicar" }, label: { type: "string", description: "Etiqueta opcional para el frame copiado" } } } } },
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
  { type: "function", function: { name: "create_design_upload", description: "Crea una URL privada para subir un archivo antes de convertirlo.", parameters: { type: "object", required: ["workspaceId", "name", "size", "sourceType"], properties: { workspaceId: { type: "string" }, name: { type: "string" }, size: { type: "integer" }, sourceType: { type: "string", enum: ["svg", "psd", "pdf", "ai", "image"] } } } } },
  { type: "function", function: { name: "convert_design_upload", description: "Convierte un archivo ya subido; después usa commit_design_import.", parameters: { type: "object", required: ["workspaceId", "jobId"], properties: { workspaceId: { type: "string" }, jobId: { type: "string" } } } } },
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "import_template", description: "Importa un template desde ZIP/JSON.", parameters: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" }, data: { type: "object" }, name: { type: "string" } } } } },
  { type: "function", function: { name: "import_design", description: "Importa un diseño desde DTCG JSON (design tokens).", parameters: { type: "object", required: ["workspaceId", "design"], properties: { workspaceId: { type: "string" }, design: { type: "object" } } } } },
  { type: "function", function: { name: "import_svg", description: "Importa un SVG como frame vectorial en un template.", parameters: { type: "object", required: ["templateId", "svg"], properties: { templateId: { type: "string" }, svg: { type: "string" }, name: { type: "string" } } } } },
  { type: "function", function: { name: "import_design_source", description: "Importa SVG con el conversor del editor y guarda sus imágenes antes de crear el frame.", parameters: { type: "object", required: ["templateId", "sourceType", "content"], properties: { templateId: { type: "string" }, sourceType: { type: "string", enum: ["svg"] }, content: { type: "string" }, name: { type: "string" } } } } },
  { type: "function", function: { name: "import_figma_design", description: "Convierte un enlace de Figma usando la conexión privada del workspace. Después consulta el estado y confirma la importación.", parameters: { type: "object", required: ["workspaceId", "url", "idempotencyKey"], properties: { workspaceId: { type: "string" }, url: { type: "string" }, idempotencyKey: { type: "string" } } } } },
  { type: "function", function: { name: "import_figma_file", description: "Importa un archivo .fig local (base64, máx 50 MB) totalmente editable: cada frame llega como mesa con capas por objeto y matching de fuentes. Después confirma con commit_design_import.", parameters: { type: "object", required: ["workspaceId", "name", "fileBase64", "idempotencyKey"], properties: { workspaceId: { type: "string" }, name: { type: "string" }, fileBase64: { type: "string" }, idempotencyKey: { type: "string" } } } } },
  { type: "function", function: { name: "get_design_import_status", description: "Consulta el resultado y las advertencias de una importación.", parameters: { type: "object", required: ["workspaceId", "jobId"], properties: { workspaceId: { type: "string" }, jobId: { type: "string" } } } } },
  { type: "function", function: { name: "retry_design_import", description: "Reintenta una conversión Figma fallida.", parameters: { type: "object", required: ["workspaceId", "jobId"], properties: { workspaceId: { type: "string" }, jobId: { type: "string" } } } } },
  { type: "function", function: { name: "commit_design_import", description: "Guarda las mesas de una importación lista en el template, sin duplicarlas al repetir.", parameters: { type: "object", required: ["workspaceId", "jobId", "templateId"], properties: { workspaceId: { type: "string" }, jobId: { type: "string" }, templateId: { type: "string" } } } } },
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
  { type: "function", function: { name: "comment_add", description: "Añade un comentario anclado a un diseño (x_pct, y_pct). Crea automáticamente una tarea Kanban. Si el template es un Brand Manual, commentType será 'documentation'.", parameters: { type: "object", required: ["templateId", "body"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, body: { type: "string" }, xPct: { type: "number" }, yPct: { type: "number" }, authorName: { type: "string" }, source: { type: "string", enum: ["editor_pin", "mobile_pin", "kanban", "ai_review", "chat", "documentation"] }, commentType: { type: "string", enum: ["feedback", "documentation"] }, createKanbanTask: { type: "boolean" } } } } },
  { type: "function", function: { name: "comment_list", description: "Lista comentarios de un template/frame.", parameters: { type: "object", required: ["templateId"], properties: { templateId: { type: "string" }, frameId: { type: "string" }, status: { type: "string", enum: ["open", "resolved", "archived"] } } } } },
  { type: "function", function: { name: "comment_resolve", description: "Marca un comentario como resuelto.", parameters: { type: "object", required: ["commentId"], properties: { commentId: { type: "string" } } } } },
  { type: "function", function: { name: "comment_reply", description: "Responde a un comentario (hilo).", parameters: { type: "object", required: ["parentId", "templateId", "body"], properties: { parentId: { type: "string" }, templateId: { type: "string" }, body: { type: "string" }, authorName: { type: "string" } } } } },
  // ═══════════════════════════════════════════════
  //  Harness Orchestration
  // ═══════════════════════════════════════════════
  { type: "function", function: { name: "harness_healthcheck", description: "Verifica que el entorno del harness está listo (MCP, Supabase, tablas, lint).", parameters: { type: "object", properties: { templateId: { type: "string", description: "Opcional: ID del template para verificar diseño" } } } } },
  { type: "function", function: { name: "harness_get_context", description: "Devuelve AGENTS.md, docs y contexto para un tipo de agente. Cuando workspaceId se provee, también devuelve estilos activos, marcas y templates recientes — todo lo necesario para validar el contexto (step 0.5).", parameters: { type: "object", properties: { agentType: { type: "string", enum: ["leader", "implementer", "reviewer", "explorer"] }, workspaceId: { type: "string", description: "Workspace ID — devuelve estilos activos, marcas y templates" } } } } },
  { type: "function", function: { name: "harness_list_features", description: "Lista las tareas del Kanban filtradas por estado. Cada una trae acceptance criteria.", parameters: { type: "object", properties: { status: { type: "string", enum: ["backlog", "draft", "design", "review", "done", "feedback"] } } } } },
  { type: "function", function: { name: "harness_claim_feature", description: "Toma una tarea del backlog. Falla si ya hay otra activa.", parameters: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" }, assignedTo: { type: "string" } } } } },
  { type: "function", function: { name: "harness_release_feature", description: "Libera una tarea (vuelve a backlog).", parameters: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" } } } } },
  { type: "function", function: { name: "harness_start_session", description: "Inicia una sesión de subagente con rol y plan. Devuelve sessionId y context_summary.", parameters: { type: "object", required: ["taskId", "role"], properties: { taskId: { type: "string" }, role: { type: "string", enum: ["leader", "implementer", "reviewer", "explorer"] }, plan: { type: "string" } } } } },
  { type: "function", function: { name: "harness_log_entry", description: "Anota un evento en la bitácora de la sesión.", parameters: { type: "object", required: ["sessionId", "entryType", "content"], properties: { sessionId: { type: "string" }, entryType: { type: "string", enum: ["plan", "progress", "blocker", "review", "verdict", "summary", "exploration", "context_dump"] }, content: { type: "string" } } } } },
  { type: "function", function: { name: "chatfab_log_decision", description: "Telemetría interna: registra el mensaje del usuario, la tool ejecutada y métricas de la ronda en chatfab_decisions (dataset del router). Nunca falla.", parameters: { type: "object", required: ["message"], properties: { session_id: { type: "string" }, message: { type: "string", description: "Último mensaje del usuario (se trunca a 500 chars server-side)" }, tool_used: { type: "string" }, latency_ms: { type: "integer" }, llm_tokens: { type: "integer" } } } } },
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
  { type: "function", function: { name: "get_playbook", description: "Lee solo el playbook requerido para este trabajo.", parameters: { type: "object", required: ["name"], properties: { name: { type: "string", enum: ["replicate-html", "create-from-scratch", "csv-batch", "design-system", "multi-agent", "content-calendar"] } } } } },
  { type: "function", function: { name: "get_agent_guide", description: "Obtiene la guía compacta de Musa; verbose=true solicita detalles completos.", parameters: { type: "object", properties: { verbose: { type: "boolean" } } } } },
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

const IMPLEMENTER_PROMPT = `Eres el ejecutor de UNA tarea de diseño de Musa. Trabaja solo sobre el workspace y los artefactos del contexto; no adivines IDs ni edites un template abierto que el usuario no señaló.

{TASK_CONTEXT}
TU SESSION ID: {SESSION_ID}

Marca: si el contrato trae brandId, carga una vez get_brand_guideline y aplica sus artifacts reales. Si solo trae un nombre, busca coincidencia canónica en list_brand_guidelines/get_active_styles; si no existe, busca candidatos en templates y marcas CRM y devuelve blocked -> style_not_found con IDs. No inventes un estilo con ese nombre ni crees una guideline vacía. Si debes publicar un estilo nuevo, extrae artifacts de un template real y sustantivo antes de guardarlo.

Crear: usa workspaceId del contexto. Para deck 1920x1080, create_deck agrega una portada (total frames = slides + 1). Para carrusel, create_html_carousel con todos los frames; para piezas separadas, create_html_template una vez por pieza. Envía HTML y CSS completos, textos exactos y dimensiones del contrato; sin placeholders ni contenido fuera del frame. Aplica el CSS de marca en cada frame si corresponde. No crees archivos vacíos de prueba.

Editar: lee get_template y list_frames. Cambia solo el frame o elemento indicado; si el pedido es agregar, crea un frame nuevo. Conserva el contenido existente ajeno al cambio.

Verifica cada ID creado o editado con get_template, frames y textos antes de terminar. Si necesitas iconos, usa search_icons/insert_icon en lugar de emojis. Si falta una herramienta, usa musa_find_tools con una query concreta. Si falla una herramienta, corrige la causa o informa el bloqueo; no simules éxito. Llama harness_submit_for_review({sessionId,summary}) al terminar y devuelve los IDs reales de todos los artefactos en un resumen breve.`;

const REVIEWER_PROMPT = `Verifica de forma independiente UNA tarea de diseño de Musa. Solo puedes leer y evaluar, nunca modificar.

{TASK_CONTEXT}

Lee cada templateId explícito del contexto; si falta uno, responde CHANGES_REQUESTED. Compara cantidad de archivos y frames, dimensiones, textos exigidos, HTML/CSS no vacíos y estilo de marca realmente aplicado. Usa get_template, get_frame, list_all_texts y lint_design. Un nombre de marca en texto no demuestra que sus tokens estén aplicados.

render_html_template entrega HTML/URL de exportación, no un PNG ya inspeccionado. Si hay una captura real disponible, revísala; si no, no afirmes que hiciste QA visual. Si falta una herramienta de lectura, usa musa_find_tools con una query concreta. Evalúa los checkpoints definidos en docs/harness/checkpoints.md: C1 salud del entorno; C2 cada criterio de aceptación con evidencia; C3 geometría y lint del diseño; C4 persistencia tras releer; C5 ciclo de sesión y entrega a review. Marca false cuando falte evidencia, especialmente en C2 o C3. Llama harness_evaluate_checkpoint una vez por C1-C5 con notas concretas. Responde APPROVED solo si los cinco pasan; de otro modo CHANGES_REQUESTED con fallas específicas.`;

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
  "chatfab_log_decision",
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
  "get_design_system", "get_design_artifacts", "get_brand_playbook", "get_file_meta",
  // ── Template management ──
  "delete_template", "duplicate_template",
  // ── Brand management ──
  "get_brands", "list_brand_guidelines", "get_brand_guideline", "delete_brand_guideline",
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
  // ── Content calendar & social publishing ──
  "list_calendar_entries", "add_content_idea", "update_content", "delete_content",
  "list_copy_recipes", "create_copy_recipe", "update_copy_recipe", "delete_copy_recipe",
  "list_social_accounts", "set_publish_defaults", "publish_content",
  // ── CRM interactions ──
  "log_interaction", "list_interactions",
  // ── CRM core (v45): overview + deals + contacts + brand settings ──
  "get_crm_overview", "create_crm_deal", "update_crm_deal", "update_crm_deliverable",
  "create_crm_contact", "update_crm_contact", "update_crm_brand",
  // ── Editor viewport (local, session-only) ──
  "editor_zoom", "editor_pan",
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
  "create_chart",
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
  "import_design_source", "import_figma_design", "import_figma_file", "get_design_import_status", "retry_design_import", "commit_design_import", "create_design_upload", "convert_design_upload",
  // ── Batch / CSV ──
  "apply_csv_to_frames", "update_thumbnail",
  // ── Recipes ──
  "save_recipe", "list_recipes", "get_recipe", "create_from_recipe",
  // ── Versioning ──
  "save_version", "restore_version",
  // ── Inspection (for Mode B: modify existing) ──
  "get_template", "get_template_structure", "find_templates", "list_templates", "get_frame_changes", "lint_design",
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

// Send the model only schemas related to this request. An explicit discovery
// tool remains available for unusual operations, so a profile is never a
// permanent capability boundary.
const MUSA_COMMON_TOOL_NAMES = new Set([
  "list_workspaces", "list_templates", "find_templates", "get_template",
  "get_brands", "get_active_styles", "harness_healthcheck",
]);
const MUSA_MODULE_TOOL_NAMES: Record<string, Set<string>> = {
  design: new Set([
    "studio_create_card", "studio_get_card", "studio_move_card", "harness_delegate_task",
    "harness_complete_feature", "harness_get_entries", "get_template_structure",
    "list_frames", "get_frame", "get_html_frames", "get_design_system",
    "get_design_artifacts", "get_playbook", "get_brand_playbook",
    "list_brand_guidelines", "get_brand_guideline",
  ]),
  motion: new Set(["get_template", "list_frames", "get_frame", "get_html_frames", "list_assets"]),
  copywriting: new Set([
    "list_calendar_entries", "add_content_idea", "update_content", "delete_content",
    "list_copy_recipes", "create_copy_recipe", "update_copy_recipe", "delete_copy_recipe",
    "list_social_accounts", "set_publish_defaults", "publish_content",
    "list_recipes", "get_recipe",
  ]),
  contacts: new Set([
    "get_crm_overview", "create_crm_deal", "update_crm_deal", "update_crm_deliverable",
    "create_crm_contact", "update_crm_contact", "update_crm_brand",
    "log_interaction", "list_interactions",
  ]),
  config: new Set([
    "create_api_key", "list_api_keys", "revoke_api_key", "list_workspace_integrations",
    "call_workspace_mcp", "harness_list_cronjobs", "harness_create_cronjob",
    "harness_toggle_cronjob", "get_active_agents",
  ]),
};
const MUSA_TOOL_DISCOVERY = {
  type: "function",
  function: {
    name: "musa_find_tools",
    description: "Busca o abre herramientas adicionales cuando el grupo actual no basta. No ejecuta cambios.",
    parameters: { type: "object", properties: {
      group: { type: "string", enum: ["design", "copywriting", "contacts", "config", "motion"] },
      query: { type: "string", description: "Nombre o acción concreta que necesitas." },
    } },
  },
};

const MUSA_IMPLEMENTER_CORE = new Set([
  "list_workspaces", "list_templates", "get_template", "list_frames", "get_frame", "get_html_frames",
  "create_html_template", "create_html_carousel", "create_deck", "create_html_frame", "create_chart",
  "set_html", "set_css", "list_brand_guidelines", "get_brand_guideline", "get_active_styles",
  "get_brands", "search_icons", "insert_icon", "list_assets", "search_stock_image",
  "render_html_template", "lint_design", "harness_submit_for_review", "harness_log_entry",
  "harness_report_error", "get_playbook",
]);
const MUSA_REVIEWER_CORE = new Set([
  "get_template", "get_template_structure", "list_frames", "get_frame", "get_html_frames",
  "list_all_texts", "lint_design", "render_html_template", "harness_healthcheck",
  "harness_evaluate_checkpoint", "harness_get_entries", "get_brand_guideline",
  "get_active_styles", "get_design_artifacts", "check_contrast", "check_accessibility",
]);

function roleToolsForTask(role: "implementer" | "reviewer") {
  const candidates = role === "implementer" ? IMPLEMENTER_TOOLS : REVIEWER_TOOLS;
  const names = role === "implementer" ? MUSA_IMPLEMENTER_CORE : MUSA_REVIEWER_CORE;
  return [...candidates.filter(tool => names.has(tool.function.name)), MUSA_TOOL_DISCOVERY];
}

function leaderToolsForRequest(request: string) {
  const modules = chooseMusaModules(request);
  // An unclear request gets common read tools and discovery, then the model
  // can clarify or open a specific capability without paying for every schema.
  const names = new Set(MUSA_COMMON_TOOL_NAMES);
  for (const module of modules) for (const name of MUSA_MODULE_TOOL_NAMES[module]) names.add(name);
  return [...LEADER_TOOLS.filter(t => names.has(t.function.name)), MUSA_TOOL_DISCOVERY];
}

let mcpCatalogPromise: Promise<any[]> | null = null;

async function loadMcpToolSchemas() {
  // Unknown and newly added capabilities are fetched only on discovery.
  if (!mcpCatalogPromise) {
    mcpCatalogPromise = mcpCall("tools/list", {}).then(result => Array.isArray(result?.tools) ? result.tools : [])
      .catch(error => { mcpCatalogPromise = null; throw error; });
  }
  const catalog = await mcpCatalogPromise;
  return catalog.map(tool => ({
    type: "function",
    function: {
      name: String(tool.name || ""),
      description: String(tool.description || ""),
      parameters: tool.inputSchema || { type: "object", properties: {} },
    },
  })).filter(tool => tool.function.name);
}

async function findLeaderTools(group?: string, query?: string) {
  if (group && MUSA_MODULE_TOOL_NAMES[group] && !query) {
    return LEADER_TOOLS.filter(t => MUSA_MODULE_TOOL_NAMES[group].has(t.function.name));
  }
  const search = group === "motion" ? `${query || ""} animation video motion preset`.trim() : String(query || "");
  const found = searchMusaTools(await loadMcpToolSchemas(), search);
  for (const tool of found) discoveredToolSchemas.set(tool.function.name, tool.function.parameters);
  return found;
}

async function findRoleTools(role: "implementer" | "reviewer", group?: string, query?: string) {
  const search = group === "motion" ? `${query || ""} animation video motion preset`.trim() : String(query || "");
  const permitted = role === "implementer" ? IMPLEMENTER_TOOLS : REVIEWER_TOOLS;
  const local = searchMusaTools(permitted, search);
  if (role === "reviewer" || local.length >= 3) return local;
  const localNames = new Set(local.map(tool => tool.function.name));
  const remote = searchMusaTools(await loadMcpToolSchemas(), search)
    .filter(tool => !localNames.has(tool.function.name));
  for (const tool of remote) discoveredToolSchemas.set(tool.function.name, tool.function.parameters);
  return [...local, ...remote].slice(0, 12);
}

/** Convert OpenAI tool schema to Anthropic format */
const toolsForAnthropic = (tools: Array<{ function: { name: string; description: string; parameters: any } }> = HARNESS_TOOLS) => tools.map(t => ({
  name: t.function.name,
  description: t.function.description,
  input_schema: t.function.parameters,
}));

type SubagentProgressHandler = (progress: SubagentProgress) => void;

/**
 * Zoom/pan the live editor exactly like the human's trackpad does. The
 * canvas exists only in this browser session — there is nothing for the MCP
 * server to steer — so these tools dispatch the SHARED viewport channel
 * (src/lib/editorViewport.ts) that EditorV2 and the Musa Hands gestures
 * consume, and report honestly when no editor is open.
 */
/**
 * Args mecánicos por defecto del gate del router: el clasificador solo
 * entrega el label, pero varias tools exigen argumentos que un mensaje
 * humano no trae en JSON — con {} la tool respondía error y el gate caía
 * al fallback silencioso (chip ✕ "args por defecto insuficientes").
 *  - editor_pan: schema exige dx/dy numéricos; 320px → pan visible y suave.
 *  - editor_zoom: action exigido; "in" = un paso de acercamiento.
 * (El templateId de las tools de contexto llega del contexto, ver CONTEXT_TOOLS.)
 */
const ROUTER_DEFAULT_ARGS: Record<string, Record<string, unknown>> = {
  editor_pan: { dx: 320, dy: 0 },
  editor_zoom: { action: "in" },
};

/**
 * Tools que operan sobre EL TEMPLATE ABIERTO en el editor: "crea un frame" o
 * "saca esta frame" dichos desde el dock del editor ES ese diseño ante el
 * humano, así que el gate les inyecta su id (la política de NO auto-fill de
 * resolveArgs aplica al LLM, no aquí). El clasificador solo emite el label —
 * sin esta inyección estas tools recibían {} y el fallback silencioso
 * escondía el error (los handlers aceptan templateId aunque el schema diga
 * `id`: get_template y duplicate_template son forgiving a propósito).
 */
const CONTEXT_TOOLS: ReadonlySet<string> = new Set([
  "create_frame", "duplicate_template", "list_frames", "get_template",
  "get_template_structure", "export_frame", "update_html_frame", "delete_frame",
]);

/**
 * Tools de LECTURA cuyo resultado el humano pidió VER: el chip verde mudo
 * ("✓ Hecho") no le enseña nada — "cuántos frames tengo" merece la respuesta
 * en el chat. El gate agrega su resultado como burbuja assistant compacta
 * (ver summarizeReadResult), además del chip.
 */
const READ_TOOLS: ReadonlySet<string> = new Set([
  "list_templates", "list_frames", "get_template_structure", "get_css_variables",
  "get_frame", "list_calendar_entries",
]);

/**
 * Respuesta compacta para una tool de lectura — lo que el humano preguntó,
 * no el JSON crudo. Formas según handler (mcp.mjs): list_frames →
 * {frames,total}; list_templates → {data,total}; get_template_structure →
 * frameResults[]; get_css_variables → {variables,count}; get_frame → frame;
 * list_calendar_entries → {entries,total}. Devuelve null si no hay nada
 * útil que mostrar (la burbuja simplemente no se agrega).
 */
function summarizeReadResult(toolName: string, parsed: any): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const p: any = parsed?.result ?? parsed; // wrappers que anidan {result}
  const listOf = (key: string): any[] | null =>
    Array.isArray(p?.[key]) ? p[key] : Array.isArray(p) ? p : null;
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  switch (toolName) {
    case "list_frames": {
      const frames = listOf("frames");
      if (!frames) return null;
      if (frames.length === 0) return "Este diseño no tiene frames.";
      const names = frames.slice(0, 8).map((f: any) =>
        `${f?.name || f?.id || "sin nombre"}${f?.width ? ` (${f.width}×${f.height})` : ""}`);
      const resto = frames.length > 8 ? ` y ${frames.length - 8} más` : "";
      return `Tienes ${frames.length} ${plural(frames.length, "frame", "frames")}: ${names.join(", ")}${resto}.`;
    }
    case "list_templates": {
      const data = listOf("data");
      if (!data) return null;
      if (data.length === 0) return "No encontré templates en tu workspace.";
      const names = data.slice(0, 8).map((t: any) => t?.name || t?.metadata?.name || t?.id || "sin nombre");
      const resto = data.length > 8 ? ` y ${data.length - 8} más` : "";
      return `Tienes ${data.length} ${plural(data.length, "template", "templates")}: ${names.join(", ")}${resto}.`;
    }
    case "get_template_structure": {
      const frames = listOf("frameResults");
      if (!frames) return null;
      if (frames.length === 0) return "El diseño no tiene frames con contenido.";
      const parts = frames.slice(0, 8).map((f: any) =>
        `${f?.frameName || f?.frameId || "frame"} (${f?.htmlLength ?? 0} chars HTML)`);
      return `Estructura: ${frames.length} ${plural(frames.length, "frame", "frames")} — ${parts.join(", ")}.`;
    }
    case "get_css_variables": {
      const vars = listOf("variables");
      if (!vars) return null;
      if (vars.length === 0) return "Este diseño no define variables CSS.";
      const items = vars.slice(0, 10).map((v: any) => `${v?.name}: ${v?.value}`);
      return `${vars.length} variables CSS: ${items.join("; ")}.`;
    }
    case "get_frame": {
      const name = p?.name || p?.id;
      if (!name && p?.width == null) return null;
      return `Frame "${name || "sin nombre"}": ${p?.width ?? "?"}×${p?.height ?? "?"}${Array.isArray(p?.objects) ? `, ${p.objects.length} objetos` : ""}.`;
    }
    case "list_calendar_entries": {
      const entries = listOf("entries");
      if (!entries) return null;
      if (entries.length === 0) return "No hay entradas de calendario con ese filtro.";
      const items = entries.slice(0, 8).map((e: any) =>
        `${e?.scheduledDate || e?.scheduled_date || "sin fecha"}${e?.brandName ? ` (${e.brandName})` : ""}`);
      return `${entries.length} ${plural(entries.length, "entrada", "entradas")} de calendario: ${items.join(", ")}.`;
    }
    default:
      return null;
  }
}

function runEditorViewportTool(name: string, args: Record<string, any>): string {
  if (!isEditorOpen()) {
    return JSON.stringify({ error: "No hay editor abierto — abre un diseño en el EditorV2 y reintenta" });
  }
  if (name === "editor_zoom") {
    const action = String(args.action || "");
    if (!["in", "out", "fit", "set"].includes(action)) {
      return JSON.stringify({ error: "action debe ser in | out | fit | set" });
    }
    if (action === "set" && typeof args.zoom !== "number") {
      return JSON.stringify({ error: "action=set requiere zoom numérico (0.1–1)" });
    }
    dispatchEditorViewport({ type: "zoom", action: action as "in" | "out" | "fit" | "set", zoom: args.zoom });
    return JSON.stringify({ ok: true, viewport: "zoom", action, ...(action === "set" ? { zoom: args.zoom } : {}) });
  }
  const dx = Number(args.dx) || 0;
  const dy = Number(args.dy) || 0;
  if (!dx && !dy) return JSON.stringify({ error: "dx y dy en 0 — nada que mover" });
  dispatchEditorViewport({ type: "pan", dx, dy });
  return JSON.stringify({ ok: true, viewport: "pan", dx, dy });
}

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
    // Editor viewport + gesture-log tools are session-local: the live canvas
    // and the gesture log only exist in this browser tab, so they never reach
    // the MCP server — they ride the same window channel / memory store the
    // trackpad gestures and Musa Hands feed.
    if (name === "editor_zoom" || name === "editor_pan") {
      return runEditorViewportTool(name, args);
    }
    if (name === "get_recent_gestures") {
      const limit = typeof args.limit === "number" ? Math.max(1, Math.min(40, Math.round(args.limit))) : 15;
      return JSON.stringify({ gestures: getRecentGestureEvents(limit) });
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

  // ── Dedup guard: if the same task was already delegated to an implementer
  //    successfully within the last 10 minutes, return the cached result
  //    instead of re-running. Prevents accidental double-delegation when the
  //    Leader loses track of what it already did (e.g. after context compaction
  //    or a truncated response that the Leader misreads as "not done yet").
  if (params.taskId && params.role === "implementer") {
    const dedupKey = `${params.taskId}:${params.role}`;
    const prev = lastDelegationPerTask.get(dedupKey);
    if (prev && (Date.now() - prev.timestamp) < 600_000) {
      const elapsed = Math.round((Date.now() - prev.timestamp) / 1000);
      try {
        const cached = JSON.parse(prev.result);
        return serializeValidJson({
          ...cached,
          _dedup_notice: `Esta task ya fue delegada hace ${elapsed}s. Devolviendo el resultado anterior en lugar de re-ejecutar. Avanza al siguiente paso del flujo (reviewer).`,
        });
      } catch { /* cache corrupt — fall through */ }
    }
  }

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
  let cachedInputTokens = 0;
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
    cachedInputTokens: 0,
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
    tools = roleToolsForTask("implementer");
  } else {
    systemPrompt = REVIEWER_PROMPT.replace("{TASK_CONTEXT}", taskContext);
    tools = roleToolsForTask("reviewer");
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
    cachedInputTokens,
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
    let metadata: Record<string, unknown> | undefined;
    if (state === "retrying") metadata = { reason: progress.reason };
    if (state === "done") metadata = { cachedInputTokens: progress.cachedInputTokens };
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
      metadata,
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
    const finalJson = serializeValidJson({ ...payload, stats: runStats() });
    // Cache successful implementer delegations for dedup (see guard at top of function)
    if (params.taskId && params.role === "implementer" && !payload.verification_failed) {
      lastDelegationPerTask.set(`${params.taskId}:${params.role}`, {
        result: finalJson,
        timestamp: Date.now(),
      });
    }
    return finalJson;
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
      const resp = await fetchWithRetry(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": llmKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
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
      const resp = await fetchWithRetry(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${llmKey}`,
        },
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
      cachedInputTokens += providerUsage.cachedInputTokens;
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

    // Only an all-read batch can start together; any write or discovery keeps
    // the original serial order and can pass IDs to later calls.
    const parallelReads = canParallelizeReadTools(toolCalls.map(tc => tc.name))
      && toolCalls.every(tc => !tc.argsError)
      ? toolCalls.map(tc => executeToolCall(tc.name, tc.args, runSignal))
      : null;
    // Execute each tool call within the subagent's own loop
    const anthropicResults: any[] = [];
    for (let toolIndex = 0; toolIndex < toolCalls.length; toolIndex++) {
      const tc = toolCalls[toolIndex];
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
        : tc.name === "musa_find_tools"
          ? await (async () => {
              const found = await findRoleTools(params.role, tc.args?.group, tc.args?.query);
              tools = selectProviderTools([
                ...tools,
                ...found.filter(tool => !tools.some(current => current.function.name === tool.function.name)),
              ], providerId);
              return serializeValidJson({ available: found.map(tool => tool.function.name) });
            })().catch(error => serializeValidJson({ error: error?.message || "tool discovery failed", available: [] }))
          : await (parallelReads?.[toolIndex] ?? executeToolCall(tc.name, tc.args, runSignal));
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
      const modelResult = toolResultForModel(tc.name, resultStr);
      if (isAnthropic) { anthropicResults.push({ type: "tool_result", tool_use_id: tc.id, content: modelResult }); }
      else { subConv.push({ role: "tool", tool_call_id: tc.id, content: modelResult }); }
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
      enqueueTelemetry("harness_log_entry", {
        sessionId,
        entryType: "subagent_trace",
        content: JSON.stringify(traceEntry),
      });
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

const readFlag = (key: string) => { try { return localStorage.getItem(key) === "1"; } catch { return false; } };
const writeFlag = (key: string, on: boolean) => {
  try { if (on) localStorage.setItem(key, "1"); else localStorage.removeItem(key); } catch {}
};

/**
 * A turn runs in this tab, against the model, from the browser. A reload tears
 * the connection down with the page and there is nothing on a server to resume
 * — so the honest thing is to say the turn was cut off rather than leave the
 * transcript looking like the answer is still coming.
 */
function interruptedTurnNotice(): Message | null {
  if (!readFlag(LS_INFLIGHT_KEY)) return null;
  writeFlag(LS_INFLIGHT_KEY, false);
  return {
    role: "assistant",
    content: "_(La página se recargó mientras yo respondía, así que ese turno se cortó. El historial está intacto — vuelve a enviarlo cuando quieras.)_",
    ts: Date.now(),
  };
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

/** Robotcito de Musa para los botones del dock — SVG inline, nunca emoji. */
function ChatDockIcon({ width = 16, height = 16 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2v3" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <rect x="4" y="7" width="16" height="12" rx="3" />
      <circle cx="9" cy="12.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12.5" r="1" fill="currentColor" stroke="none" />
      <path d="M9.5 16h5" />
    </svg>
  );
}

/**
 * Botón de la navbar (al lado de la zona de cuenta) que abre/cierra el dock
 * lateral de chat. Se comunica con el dock por eventos de window:
 * emite "chatfab:toggle" y se espeja con "chatfab:state" — sin props ni
 * stores, el dock vive montado a nivel App y la navbar en Dashboard.
 */
export function ChatDockToggle() {
  const [on, setOn] = useState(() => readFlag(LS_OPEN_KEY));
  useEffect(() => {
    const sync = (e: Event) => setOn(Boolean((e as CustomEvent).detail));
    window.addEventListener("chatfab:state", sync);
    return () => window.removeEventListener("chatfab:state", sync);
  }, []);
  return (
    <button
      type="button"
      className="liquid-glass"
      aria-label={on ? "Cerrar chat" : "Abrir chat"}
      aria-pressed={on}
      title="Chat (Musa)"
      onClick={() => window.dispatchEvent(new CustomEvent("chatfab:toggle", { detail: !on }))}
      style={{
        borderRadius: 100, padding: 8, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: on ? "#c8b898" : "rgba(255,255,255,0.8)",
        border: on ? "1px solid rgba(200,184,152,0.5)" : "1px solid transparent",
        transition: "all 0.25s ease",
      }}
    >
      <ChatDockIcon width={16} height={16} />
    </button>
  );
}

interface ChatFABProps {
  /** The workspace the human is currently looking at (dashboard or editor). */
  workspaceId?: string;
  /** The template currently open in the editor, if any. */
  templateId?: string;
  /** When provided, the parent controls the panel's open/close state
   *  (external host; nothing in the app passes it today). */
  externalOpen?: boolean;
  /** Called whenever the internal open state would change. */
  onOpenChange?: (open: boolean) => void;
  /** When true, hide every dock entry point (tab + navbar remains owner;
   *  parent already controls the panel via externalOpen). */
  hideFab?: boolean;
}

export function ChatFAB({ workspaceId, templateId, externalOpen, onOpenChange, hideFab }: ChatFABProps) {
  // Restored from the last visit: reloading the page behind the chat should
  // leave the chat itself untouched, panel open and draft intact.
  const [internalOpen, setInternalOpen] = useState(() => readFlag(LS_OPEN_KEY));
  const open = externalOpen ?? internalOpen;
  const setOpen = useCallback((next: boolean) => {
    setInternalOpen(next);
    writeFlag(LS_OPEN_KEY, next);
    onOpenChange?.(next);
    // Espeja el estado para el botón de la navbar (ChatDockToggle).
    try { window.dispatchEvent(new CustomEvent("chatfab:state", { detail: next })); } catch { /* SSR/tests */ }
  }, [onOpenChange]);
  const [messages, setMessages] = useState<Message[]>(() => {
    const restored = loadMessages();
    const notice = interruptedTurnNotice();
    return notice ? [...restored, notice] : restored;
  });
  const [input, setInput] = useState(() => {
    try { return localStorage.getItem(LS_DRAFT_KEY) || ""; } catch { return ""; }
  });
  const [sending, setSending] = useState(false);
  const [turnPhase, setTurnPhase] = useState("Preparando pedido");
  const [streamPreview, setStreamPreview] = useState("");
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [clockNow, setClockNow] = useState(Date.now());
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [expandedStepGroups, setExpandedStepGroups] = useState<Set<number>>(new Set());
  // ── Multi-model per role: each role can use a different provider+model ──
  const [roleConfig, setRoleConfig] = useState<RoleConfigMap>(() => loadRoleConfig());
  /** Flips true once account prefs arrive; gates the server write below. */
  const roleConfigHydratedRef = useRef(false);
  /** Which providers the account has a key for — last four only. */
  const [storedKeys, setStoredKeys] = useState<StoredKey[]>([]);
  /** What is being typed right now, before it is sent. Never persisted. */
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});
  const [keyStatus, setKeyStatus] = useState("");
  /** Kept only so the runtime can tell "configured" from "not". The value is
   *  never read for a request any more — the server holds it. */
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({});
  const leaderProvider = roleConfig.leader.provider;
  const leaderModel = roleConfig.leader.model;
  const leaderKey = providerKeys[leaderProvider] || "";
  // Starts closed and opens only once the account is known to have no key.
  // Opening on mount would flash the settings panel at every user on every
  // load, because the key list arrives from the server a moment later.
  const [showSettings, setShowSettings] = useState(false);
  // ── Router v1 ("Modo instantáneo"): portero ONNX pre-LLM. Default ON. ──
  const [instantMode, setInstantMode] = useState<boolean>(() => {
    try { return localStorage.getItem("chatfab_instant_mode") !== "off"; } catch { return true; }
  });
  // ── Fase 2 ghost: ritmo del teatro (switch del dock, default TEACHER).
  // Mismo cerebro y mismo resultado — SOLO cambia el ritmo (Parte 0). ──
  const [ghostMode, setGhostModeState] = useState<GhostMode>(() => ghost.getMode());
  const setGhostMode = (m: GhostMode) => { ghost.setMode(m); setGhostModeState(m); };
  // ── FASE 2 (Parte 6): jobs de ghost_perform ejecutados por el bridge
  // (ghostBridge.ts) cuando la tool llega por MCP. El resultado entra al
  // chat como burbuja — misma regla de la casa: el chat es LA interfaz. ──
  useEffect(() => {
    const onGhostJob = (e: Event) => {
      const d = (e as CustomEvent<{ status?: string; note?: string; steps?: number; task?: string }>).detail || {} as any;
      const mark = d.status === "done" ? "✓" : "✕";
      const what = d.note || d.task || "tarea del ghost";
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `${mark} Ghost (vía MCP): ${what}${typeof d.steps === "number" ? ` (${d.steps} paso${d.steps === 1 ? "" : "s"})` : ""}`,
        ts: Date.now(),
      }]);
    };
    window.addEventListener("futuraria:ghost-job", onGhostJob);
    return () => window.removeEventListener("futuraria:ghost-job", onGhostJob);
  }, []);
  // Gate de salida (Parte 6): con receta/ghost en vuelo, F5/cerrar pide
  // confirmación en vez de matar la demo. Una vez por pestaña.
  useEffect(() => { installCreationUnloadGuard(); }, []);
  const keysLoadedRef = useRef(false);
  // Precalienta el router ONNX al abrir el chat (fire-and-forget): cuando
  // llegue el primer mensaje, la clasificación ya está caliente.
  useEffect(() => {
    if (open && instantMode) warmRouter();
  }, [open, instantMode]);
  // ── Dock lateral: navbar toggle + panel de detalle ──
  // La navbar emite "chatfab:toggle" (ChatDockToggle); el dock obedece y
  // re-espeja estado vía "chatfab:state" (emitido en setOpen).
  useEffect(() => {
    const onToggle = (e: Event) => setOpen(Boolean((e as CustomEvent).detail));
    window.addEventListener("chatfab:toggle", onToggle);
    return () => window.removeEventListener("chatfab:toggle", onToggle);
  }, [setOpen]);
  // Panel de detalle abierto (convención existente: la var CSS --musa-fab-right
  // aparece en body cuando un módulo abre su panel derecho, p.ej. el editor) →
  // el dock se colapsa a la pestaña delgada del borde; la pestaña lo reabre.
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  useEffect(() => {
    const readVar = () => setDetailPanelOpen(Boolean(document.body.style.getPropertyValue("--musa-fab-right")));
    readVar();
    const obs = new MutationObserver(readVar);
    obs.observe(document.body, { attributes: true, attributeFilter: ["style"] });
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    if (detailPanelOpen && open) setOpen(false);
  }, [detailPanelOpen, open, setOpen]);
  const [accordion, setAccordion] = useState<"config" | "chat" | "tools" | null>("chat");
  
  // ── Governance panel state ──
  const [governanceSessions, setGovernanceSessions] = useState<GovernanceSession[]>([]);
  const cardTitleCache = useRef<Map<string, string>>(new Map());
  const [showGovernance, setShowGovernance] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Persist settings — localStorage is the fast path; account prefs (v36) are
  // the durable copy that follows the user across devices. The server write
  // only starts once hydration below has run, so the pre-hydration LS copy
  // can never clobber the account value.
  useEffect(() => {
    saveRoleConfig(roleConfig);
    if (!roleConfigHydratedRef.current) return;
    void saveUserPrefs({ chatRoles: roleConfig }).catch(() => { /* offline/guest */ });
  }, [roleConfig]);
  // ── Hydrate roleConfig from account prefs (same pref the Dashboard saves) ──
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const prefs = await fetchUserPrefs();
        if (cancelled) return;
        roleConfigHydratedRef.current = true;
        const server = prefs.chatRoles;
        if (!server || typeof server !== "object") return;
        const s = server as Partial<Record<AgentRole, Partial<RoleConfig>>>;
        setRoleConfig({
          leader: {
            provider: s.leader?.provider || DEFAULT_ROLE_CONFIG.leader.provider,
            model: s.leader?.model || DEFAULT_ROLE_CONFIG.leader.model,
          },
          implementer: {
            provider: s.implementer?.provider || DEFAULT_ROLE_CONFIG.implementer.provider,
            model: s.implementer?.model || DEFAULT_ROLE_CONFIG.implementer.model,
          },
          reviewer: {
            provider: s.reviewer?.provider || DEFAULT_ROLE_CONFIG.reviewer.provider,
            model: s.reviewer?.model || DEFAULT_ROLE_CONFIG.reviewer.model,
          },
        });
      } catch { /* guest or offline — the LS copy remains the source of truth */ }
    })();
    return () => { cancelled = true; };
  }, []);
  // ── Keys live on the server ──
  // Anything this browser is still holding is moved up and then erased. The
  // erase is the point: until the local copy is gone the key is still readable
  // by an extension or an XSS, so migrating without deleting would only add a
  // second copy of the same exposure.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const leftovers = loadAllProviderKeys();
      if (Object.keys(leftovers).length > 0) {
        const moved = await migrateLocalKeys(leftovers, forgetLocalProviderKey);
        if (!cancelled && moved.length) {
          setKeyStatus(`${moved.length} clave${moved.length === 1 ? "" : "s"} movida${moved.length === 1 ? "" : "s"} a tu cuenta y borrada${moved.length === 1 ? "" : "s"} de este navegador.`);
        }
      }
      const remote = await fetchProviderKeys();
      if (cancelled) return;
      keysLoadedRef.current = true;
      setStoredKeys(remote);
      setProviderKeys(Object.fromEntries(remote.map(k => [k.provider, "stored"])));
      // Fetch decrypted keys into memory for direct browser→provider calls.
      // The key never touches localStorage — it lives only in JS memory for
      // this session and is re-fetched from the server on every reload.
      await Promise.all(remote.map(async (k) => {
        const decKey = await fetchDecryptedKey(k.provider);
        if (decKey && !cancelled) memoryKeyCache[k.provider] = decKey;
      }));
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Sync de modelos (BYOK): al abrir Configuración, cada proveedor con key
  // responde su /models real y el dropdown lo uniona con el curated de
  // aiProviders.ts. Fallo de un proveedor nunca rompe el panel. ──
  const [dynamicModels, setDynamicModels] = useState<Record<string, string[]>>({});
  const syncingModelsRef = useRef(false);
  const syncProviderModels = useCallback(async () => {
    if (syncingModelsRef.current) return;
    syncingModelsRef.current = true;
    try {
      const results = await Promise.all(PROVIDERS
        .filter(p => memoryKeyCache[p.id])
        .map(async p => {
          try { return [p.id, await fetchProviderModels(p.id, memoryKeyCache[p.id])] as const; }
          catch { return null; } // sin catálogo remoto — quedan los curated
        }));
      const merged: Record<string, string[]> = {};
      for (const r of results) { if (r) merged[r[0]] = [...r[1]]; }
      if (Object.keys(merged).length) setDynamicModels(prev => ({ ...prev, ...merged }));
    } finally { syncingModelsRef.current = false; }
  }, []);
  useEffect(() => {
    if (accordion === "config") void syncProviderModels();
  }, [accordion, storedKeys, syncProviderModels]);
  /** Curated + sincronizado + el modelo ya elegido (si dejara de existir). */
  const modelsFor = (pid: string): string[] => {
    const curated = PROVIDERS.find(p => p.id === pid)?.models || [];
    const current = roleConfig.leader.provider === pid ? roleConfig.leader.model
      : roleConfig.implementer.provider === pid ? roleConfig.implementer.model
      : roleConfig.reviewer.provider === pid ? roleConfig.reviewer.model : "";
    return Array.from(new Set([...(current ? [current] : []), ...curated, ...(dynamicModels[pid] || [])]));
  };

  const submitKey = useCallback(async (provider: string) => {
    const value = (keyDraft[provider] || "").trim();
    if (value.length < 8) { setKeyStatus("Esa clave es demasiado corta."); return; }
    setKeyStatus("Guardando…");
    try {
      const last4 = await saveProviderKeyRemote(provider, value);
      setStoredKeys(prev => [...prev.filter(k => k.provider !== provider), { provider, last4 }]);
      setProviderKeys(prev => ({ ...prev, [provider]: "stored" }));
      setKeyDraft(prev => ({ ...prev, [provider]: "" }));
      // Fetch the key into memory for direct provider calls.
      const decKey = await fetchDecryptedKey(provider);
      if (decKey) memoryKeyCache[provider] = decKey;
      setKeyStatus(`Guardada en tu cuenta (····${last4}). Disponible desde cualquier dispositivo.`);
    } catch (e) {
      setKeyStatus(e instanceof Error ? e.message : "No se pudo guardar la clave");
    }
  }, [keyDraft]);

  const removeKey = useCallback(async (provider: string) => {
    try {
      await deleteProviderKeyRemote(provider);
      setStoredKeys(prev => prev.filter(k => k.provider !== provider));
      setProviderKeys(prev => { const next = { ...prev }; delete next[provider]; return next; });
      delete memoryKeyCache[provider];
      setKeyStatus("Clave eliminada de tu cuenta.");
    } catch (e) {
      setKeyStatus(e instanceof Error ? e.message : "No se pudo eliminar");
    }
  }, []);

  // Persist messages locally, for instant render and offline reading.
  useEffect(() => { saveMessages(messages); }, [messages]);

  // ── The conversation belongs to the account ──
  // The local copy paints immediately; the server's copy replaces it as soon
  // as it arrives, which is what makes the same conversation appear on a
  // phone, a second browser, or after clearing site data. Only replaced when
  // the server actually answered AND has something — a failed request must
  // never blank a real conversation.
  const syncedRef = useRef(false);
  useEffect(() => {
    if (syncedRef.current) return;
    syncedRef.current = true;
    let cancelled = false;
    void (async () => {
      const remote = await fetchRemoteHistory();
      if (cancelled || !remote || remote.length === 0) return;
      setMessages(remote as Message[]);
      // Already on the server by definition — without this the sync effect
      // would read them as "new" and write the whole conversation straight
      // back, doubling it on every load.
      syncedCountRef.current = remote.length;
      // Everything already on this device that the server has not seen is
      // pushed up, so a conversation started offline is not lost by syncing.
      const localOnly = loadMessages().filter(m =>
        !remote.some(r => r.ts === m.ts && r.content === m.content));
      // FASE 2: los chips son estado volátil del turno — no viajan al server,
      // así un chip ya consumido no resucita desde el historial remoto.
      const pushable = localOnly.map(m => ({ role: m.role, content: m.content, ts: m.ts, kind: m.kind }));
      if (pushable.length) void appendRemoteHistory(pushable as any, workspaceId);
    })();
    return () => { cancelled = true; };
  }, [workspaceId]);

  /**
   * Mirrors whatever is new up to the account, once the turn has settled.
   *
   * Driven off `sending` rather than hooked into each of the dozen places a
   * message is appended: a turn adds several as it runs, and pushing each one
   * as it lands would be a request per token-ish. Waiting for the turn to
   * finish sends them in one write, and the index of what has already been
   * persisted is the only bookkeeping needed.
   */
  const syncedCountRef = useRef(0);
  useEffect(() => {
    if (sending) return;
    const pending = messages.slice(syncedCountRef.current);
    if (pending.length === 0) return;
    syncedCountRef.current = messages.length;
    // FASE 2: los chips no viajan al server (mismo motivo que en el merge de carga).
    void appendRemoteHistory(pending.map(m => ({ role: m.role, content: m.content, ts: m.ts, kind: m.kind })) as any, workspaceId);
  }, [sending, messages, workspaceId]);
  // The draft is saved as it is typed, not on submit: the point is to survive
  // a reload that happens mid-sentence.
  useEffect(() => {
    try { if (input) localStorage.setItem(LS_DRAFT_KEY, input); else localStorage.removeItem(LS_DRAFT_KEY); } catch {}
  }, [input]);
  useEffect(() => { writeFlag(LS_INFLIGHT_KEY, sending); }, [sending]);

  // Newest-first list: new messages land at the top, so anchor the view there.
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }); }, [messages]);
  useEffect(() => {
    if (!sending) return;
    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [sending]);

  // Keep the module-level context in sync with what the human is actually
  // looking at, so tool calls and delegated subagents stop guessing.
  useEffect(() => { currentContext = { workspaceId, templateId, sessionId: chatfabSessionId }; }, [workspaceId, templateId]);

  // ── Reset chat history when workspace changes ──
  // Switching workspace clears the working state of the current turn, but no
  // longer wipes the conversation.
  //
  // This used to reset the transcript, because the transcript lived in
  // localStorage and two people sharing a browser would have shared it. That
  // is now handled where it belongs: history is stored per user and read back
  // under a row-level policy of `user_id = auth.uid()`, so Victor cannot see
  // Renzo's conversation even on the same machine. Wiping on workspace change
  // would only mean the agent forgets its own user for no reason — and this
  // agent is one per person, not one per project. The workspace each message
  // was said in travels with the message.
  const prevWorkspaceRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (prevWorkspaceRef.current !== undefined && prevWorkspaceRef.current !== workspaceId) {
      setToolEvents([]);
      setCopyStatus("idle");
      setExpandedTools(new Set());
      setExpandedStepGroups(new Set());
    }
    prevWorkspaceRef.current = workspaceId;
  }, [workspaceId]);

  // ── Bootstrap: load memory (styles, templates, sessions, skills) ──
  // v57: perezoso — las 6 llamadas MCP del arranque solo se disparan al
  // ABRIR el chat (o al cambiar de workspace con el chat abierto), no en cada
  // carga de la app: menos ráfaga autenticada contra una API saturada.
  const [bootstrapCtx, setBootstrapCtx] = useState<BootstrapContext | null>(null);
  const bootstrappedWsRef = useRef("");
  useEffect(() => {
    if (!workspaceId || !open) return;
    if (bootstrappedWsRef.current === workspaceId) return;
    bootstrappedWsRef.current = workspaceId;
    bootstrapSession().then(ctx => setBootstrapCtx(ctx)).catch(() => setBootstrapCtx(null));
  }, [workspaceId, open]);

  // Brand context (one fetch per session): send() injects the bundle of any
  // brand the human mentions straight into the system prompt — "usa el estilo
  // de Futuraria" resuelve en el primer turno sin round-trips de tools.
  const brandsCtxRef = useRef<BrandContextEntry[]>([]);
  useEffect(() => {
    if (!workspaceId || !open) return;
    brandsCtxRef.current = [];
    let cancelled = false;
    apiFetch<{ success: boolean; data?: BrandContextEntry[] }>(`/api/workspaces/${workspaceId}/brands/context`)
      .then(res => { if (!cancelled) brandsCtxRef.current = res.data || []; })
      .catch(() => { /* el chat sigue funcionando — el modelo cae a sus tools */ });
    return () => { cancelled = true; };
  }, [workspaceId, open]);

  const systemPrompt = buildSystemPrompt(bootstrapCtx ?? undefined);

  const send = useCallback(async () => {
    if (!input.trim() || sending) return;
    // Sin guard de API key: el chat es usable sin key — el router instantáneo
    // corre 100% local (ONNX) y los mensajes que necesiten LLM se explican
    // solos dentro del try de abajo.

    const userMsg: Message = { role: "user", content: input.trim(), ts: Date.now() };
    const turnStartedAt = Date.now();
    let leaderInputTokens = 0;
    let leaderOutputTokens = 0;
    let leaderCachedInputTokens = 0;
    let delegatedInputTokens = 0;
    let delegatedOutputTokens = 0;
    let delegatedCachedInputTokens = 0;
    let leaderRounds = 0;
    let leaderUsageRounds = 0;
    let toolCallsCount = 0;
    let delegatedRuns = 0;
    let delegatedUsageActual = true;
    let firstModelResponseMs: number | null = null;
    let firstTokenMs: number | null = null;
    let turnCompleted = true;
    // The brand bundle rides on THIS turn's system prompt only: it depends on
    // which brand (if any) the human just mentioned, so it can't be hoisted
    // into the render-time const.
    const turnSystemPrompt = systemPrompt + brandContextBlock(brandsCtxRef.current, userMsg.content);
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
    setTurnPhase("Seleccionando ruta");
    setStreamPreview("");
    setToolEvents([]);
    setCopyStatus("idle");
    setExpandedTools(new Set());

    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    const prov = PROVIDERS.find(p => p.id === leaderProvider) || PROVIDERS[0];
    const isAnthropic = leaderProvider === "anthropic";
    const recentUserText = messages.filter(m => m.role === "user").slice(-2).map(m => m.content).join(" ");
    const routingText = chooseMusaModules(userMsg.content).length > 0
      ? userMsg.content
      : `${recentUserText} ${userMsg.content}`;
    let leaderTools = selectProviderTools(leaderToolsForRequest(routingText), leaderProvider);
    const MAX_TOOL_ROUNDS = 12;
    let contextDumped = false;
    let directDone = false; // router v1 resolvió el turno completo sin LLM
    let leaderHttpError: ReturnType<typeof classifyHttpError> | null = null;
    let leaderContinueRetries = 0;

    // ── TEMP-ROUTER-V2: ejecución de recetas multi-tool ──
    // Corre la cadena de RECIPES[recipeId]: un chip por paso (encendido por
    // env.begin, apagado por env.call), burbuja final, y en fallo transparencia
    // total — chip rojo del paso exacto + burbuja con lo ya ejecutado + nota de
    // contexto en `conversation` para que el LLM retome SIN repetir pasos.
    // Devuelve resolved=true cuando la receta cerró el turno completa.
    const runRecipeChain = async (recipeId: string): Promise<{ resolved: boolean; summary?: string }> => {
      const recipe = RECIPES[recipeId];
      const steps: Array<{ index: number; total: number; tool: string; status: "running" | "done" | "error"; note?: string }> = [];
      let curId: string | null = null;
      const flipChip = (status: "done" | "error", note?: string) => {
        if (!curId) return;
        setToolEvents(prev => prev.map(ev => ev.id === curId
          ? { ...ev, status, ...(note ? { result: sanitizeRuntimeText(note, 300) } : {}) }
          : ev));
      };
      const env: RecipeEnv = {
        workspaceId: currentContext.workspaceId,
        templateId: currentContext.templateId,
        utterance: userMsg.content,
        begin: (index, total, tool) => {
          steps.push({ index, total, tool, status: "running" });
          curId = `recipe-${userMsg.ts}-${recipeId}-${index}`;
          setToolEvents(prev => [...prev, { id: curId!, tool: `${recipeId} · ${index}/${total}: ${tool}`, status: "running" as const }]);
        },
        call: async (tool, args) => {
          try {
            const raw = await executeToolCall(tool, args, signal);
            const resultStr = normalizeAgentToolResult(raw);
            const parsed: any = (() => { try { return JSON.parse(resultStr); } catch { return null; } })();
            const toolError = parsed?.error ?? parsed?.result?.error ?? null;
            if (toolError) throw new RecipeStepError(tool, String(toolError).slice(0, 200));
            flipChip("done");
            steps[steps.length - 1].status = "done";
            return parsed;
          } catch (e: any) {
            const msg = e instanceof RecipeStepError ? e.message : String(e?.message || e).slice(0, 200);
            if (steps.length) steps[steps.length - 1] = { ...steps[steps.length - 1], status: "error", note: msg };
            flipChip("error", msg);
            throw e instanceof RecipeStepError ? e : new RecipeStepError(tool, msg);
          }
        },
        say: (text) => setMessages(prev => [...prev, { role: "assistant", content: sanitizeRuntimeText(text, 800), ts: Date.now() }]),
      };
      try {
        const result = await recipe(env);
        env.say(result.summary);
        if (!result.ok) {
          conversation.push({
            role: "user",
            content: `[contexto del gate] La receta ${recipeId} se detuvo: ${result.summary} ${result.escalationContext || ""}`.trim(),
          });
          return { resolved: false };
        }
        return { resolved: true, summary: result.summary };
      } catch (e: any) {
        const doneList = steps.filter(s => s.status === "done").map(s => `${s.tool} ✓`).join(" → ") || "nada todavía";
        const failed = steps.find(s => s.status === "error");
        const donde = failed ? `paso ${failed.index}/${failed.total} (${failed.tool})` : "inicio";
        env.say(`✕ Receta detenida en el ${donde}: ${e?.message || "error"}. Ejecutado con éxito: ${doneList}. Escalo con este contexto para continuar tu pedido.`);
        conversation.push({
          role: "user",
          content: `[contexto del gate] La receta ${recipeId} falló en el ${donde} con: ${e?.message || "error"}. Pasos ya ejecutados con éxito: ${doneList}. Continúa la petición del humano desde ahí, sin repetir lo ya hecho.`,
        });
        return { resolved: false };
      }
    };

    // ── ROUTER v1: portero ONNX antes del LLM ──
    // Mensaje mecánico conocido con confianza ≥0.8 → tool directo sin gastar
    // tokens; cualquier otra cosa (o cualquier fallo del router) sigue al
    // flujo normal de abajo, intacto. El router NUNCA rompe ni frena el chat.
    if (instantMode && !TEMP_GHOST_TEACH.test(userMsg.content)) {
      // FASE 2: "muéstrame cómo…" es verbo de ENSEÑAR (Parte 6) — no pasa por
      // el router (una tool directa le robaría el turno al ghost); cae al hook
      // de teach de abajo. TEMP-ROUTER-V3: la clase vendrá del modelo v2.
      const routerT0 = Date.now();
      // TEMP-ROUTER-V2: las recetas se detectan por regex ANTES del router —
      // cuando el modelo v2 clasifique labels recipe_* este bloque desaparece
      // y el intent vendrá del ONNX con exactamente el mismo label.
      const tempRecipeId = matchTempRecipe(userMsg.content);
      const intent = tempRecipeId
        ? { label: tempRecipeId, confidence: 1, route: "direct" as const, nonRoutable: false }
        : await routeIntent(userMsg.content).catch(() => ({ label: null, confidence: 0, route: "llm" as const, nonRoutable: false }));
      // Bitácora SIEMPRE: una fila por mensaje con el veredicto pre-LLM. La
      // tool real que termine ejecutando el LLM queda en las filas por-tool
      // del loop de abajo (verdict default 'llm'). Los labels de tools
      // generativas (nonRoutable) también se registran aquí: son escalas
      // intencionales al LLM, huella que la v2 del router usará para aprender.
      mcpCall("chatfab_log_decision", {
        session_id: currentContext.sessionId,
        message: userMsg.content,
        tool_used: intent.route === "direct" || intent.nonRoutable ? intent.label || undefined : undefined,
        router_verdict: intent.route,
        resolved_by: intent.route === "direct" ? "heuristic" : "llm",
        latency_ms: Date.now() - routerT0,
        llm_tokens: intent.route === "direct" ? 0 : undefined,
      }).catch(() => {});

      if (intent.route === "direct" && intent.label) {
        const toolName = intent.label;
        const eventId = `router-${userMsg.ts}-${toolName}`;
        setToolEvents(prev => [...prev, { id: eventId, tool: toolName, status: "running" }]);
        if (RECIPES[toolName]) {
          // ── FASE 2 · Parte 4: CREACIÓN → 2 chips [aquí / paralelo], salvo
          // intención explícita en la frase (TEMP-ROUTER-V3). EDICIÓN → nunca
          // pregunta: corre directo como siempre (runRecipeChain de siempre).
          if (CREATION_RECIPES.has(toolName)) {
            if (TEMP_PARALLEL_INTENT.test(userMsg.content)) {
              // "arma un carrusel aparte" → directo headless, sin preguntar.
              setToolEvents(prev => prev.map(event => event.id === eventId
                ? { ...event, status: "done" as const, result: "creación en paralelo (intención explícita)" }
                : event));
              await runCreationChoice({ recipeId: toolName, utterance: userMsg.content, choice: "parallel" });
              directDone = true;
            } else {
              setMessages(prev => [...prev, {
                role: "assistant",
                content: `Puedo crear eso ahora. ¿Cómo lo lanzo?`,
                ts: Date.now(),
                chips: [
                  { label: "Aquí, viendo a Musa", choice: "here", recipeId: toolName, utterance: userMsg.content },
                  { label: "En paralelo, mándame el link", choice: "parallel", recipeId: toolName, utterance: userMsg.content },
                ],
              }]);
              setToolEvents(prev => prev.map(event => event.id === eventId
                ? { ...event, status: "done" as const, result: "esperando elección: aquí / paralelo" }
                : event));
              // resolved_by:"user" — el turno lo cierra el chip, no el modelo.
              mcpCall("chatfab_log_decision", {
                session_id: currentContext.sessionId,
                message: userMsg.content,
                tool_used: toolName,
                router_verdict: "direct",
                resolved_by: "user",
                latency_ms: Date.now() - routerT0,
              }).catch(() => {});
              directDone = true;
            }
          } else {
            // TEMP-ROUTER-V2: branch de receta — la cadena emite sus propios
            // chips por paso; este chip superior resume el turno completo.
            const outcome = await runRecipeChain(toolName);
            setToolEvents(prev => prev.map(event => event.id === eventId
              ? outcome.resolved
                ? { ...event, status: "done" as const, result: sanitizeRuntimeText(outcome.summary || "receta completa", 300) }
                : { ...event, status: "error" as const, result: "receta incompleta — escaleada al LLM con contexto" }
              : event));
            if (outcome.resolved) directDone = true;
          }
        } else if (CONTEXT_TOOLS.has(toolName) && !currentContext.templateId) {
          // Fix gate #1 (inyección de contexto generalizada): una tool de
          // contexto sin template abierto NO tiene nada que ejecutar — escalar
          // al LLM con motivo honesto, nunca el fallback mudo que escondía
          // exactamente este caso.
          setToolEvents(prev => prev.map(event => event.id === eventId
            ? { ...event, status: "error" as const, result: "sin template abierto: abre un diseño y vuelve a pedirlo" }
            : event));
        } else {
          try {
            // Args por defecto del router (ver ROUTER_DEFAULT_ARGS) + contexto:
            // "saca esta frame" dicho desde el dock del editor ES el template
            // abierto ante el humano, así que el gate sí inyecta su id (la
            // política de NO auto-fill de resolveArgs aplica al LLM, no aquí).
            const gateArgs: Record<string, any> = { ...(ROUTER_DEFAULT_ARGS[toolName] ?? {}) };
            if (CONTEXT_TOOLS.has(toolName)) {
              gateArgs.templateId = currentContext.templateId;
              if (toolName === "export_frame") gateArgs.format = gateArgs.format || "svg";
            }
            const raw = await executeToolCall(toolName, gateArgs, signal);
            const resultStr = normalizeAgentToolResult(raw);
            const parsedResult: any = (() => { try { return JSON.parse(resultStr); } catch { return null; } })();
            const toolError = parsedResult?.error ?? parsedResult?.result?.error ?? null;
            if (toolError) throw new Error(String(toolError).slice(0, 200));
            setToolEvents(prev => prev.map(event => event.id === eventId
              ? { ...event, status: "done" as const, result: sanitizeRuntimeText(resultStr, 4000) }
              : event));
            setMessages(prev => [...prev, { role: "assistant", content: `✓ Hecho: ${toolName} (instantáneo)`, ts: Date.now() }]);
            // Fix gate #2 (lectura visible): las tools de lectura contestan en
            // el chat, no solo en el chip — "cuántos frames tengo" sin burbuja
            // era un falso negativo (corrió bien y no enseñó nada).
            if (READ_TOOLS.has(toolName)) {
              const summary = summarizeReadResult(toolName, parsedResult);
              if (summary) {
                setMessages(prev => [...prev, { role: "assistant", content: sanitizeRuntimeText(summary, 800), ts: Date.now() + 1 }]);
              }
            }
            // Nada de `return` aquí: caería fuera del try/finally y dejaría
            // `sending` en true para siempre. Marcamos el turno como resuelto:
            // el finally del try de abajo hace la limpieza.
            directDone = true;
          } catch {
            // Fallback silencioso: la tool no supo ejecutarse con sus args por
            // defecto (p.ej. "no hay editor abierto") → el LLM normal se hace
            // cargo. Nunca un error visible para el usuario.
            setToolEvents(prev => prev.map(event => event.id === eventId
              ? { ...event, status: "error" as const, result: "fallback al LLM (args por defecto insuficientes)" }
              : event));
          }
        }
      }
    }

    try {
      // ── FASE 2: loop agéntico del ghost — "muéstrame cómo…" ──
      // TEMP-ROUTER-V3: el trigger es regex hasta que el v3 tenga la clase.
      // Requiere key de LLM (el brain decide por modelo); sin key cae al
      // aviso honesto de abajo, intacto.
      if (!directDone && leaderKey && TEMP_GHOST_TEACH.test(userMsg.content)) {
        // Gate de salida: la pestaña no se recarga/cierra sin confirmar
        // mientras el ghost muestra cómo (creationActivity).
        beginCreation();
        try { await runGhostAgentLoop(userMsg.content, prov, signal); } finally { endCreation(); }
        directDone = true;
      }
      // Mensaje que requiere LLM sin key: se avisa una vez, sin bloquear el
      // chat (el router ya resolvió arriba lo instantáneo). El return cae
      // dentro del try → el finally limpia sending/abort.
      if (!leaderKey && !directDone) {
        turnCompleted = false;
        setMessages(prev => [...prev, {
          role: "assistant",
          content: "Puedo ejecutar acciones instantáneas sin configurar nada, pero para responder con LLM necesito una API key: configúrala en ⚙️ Configuración de este panel.",
          ts: Date.now(),
        }]);
        return;
      }
      for (let round = 0; !directDone && round <= MAX_TOOL_ROUNDS; round++) {
        const roundStart = Date.now();
        leaderRounds++;
        setTurnPhase(round === 0 ? "Consultando modelo" : "Continuando trabajo");
        if (signal.aborted) {
          setMessages(prev => [...prev, { role: "assistant", content: "Detenido.", ts: Date.now() }]);
          break;
        }

        // ── Trim conversation to prevent context overflow ──
        if (estimateFullRequestTokens(turnSystemPrompt, conversation, isAnthropic ? toolsForAnthropic(leaderTools) : leaderTools) > 70_000) {
          const leaderBeforeLen = conversation.length;
          let compacted = compactConversationAtomic(conversation, {
            maxMessages: 40,
            preserveFirstMessages: 2,
            manifest: buildWorkManifest(),
          }).messages;
          if (estimateFullRequestTokens(turnSystemPrompt, compacted, isAnthropic ? toolsForAnthropic(leaderTools) : leaderTools) > 70_000) {
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
          // Mismo payload nativo de Anthropic, vía proxy same-origin /api/llm
          // (la key no viaja al browser y el destino lo decide el server).
          const reqPayload = { model: leaderModel || prov.defaultModel, max_tokens: LLM_MAX_TOKENS, system: turnSystemPrompt, messages: conversation, tools: toolsForAnthropic(leaderTools), tool_choice: { type: "auto" } };
          const reqBody = JSON.stringify({ provider: "anthropic", body: reqPayload });
          const resp = await fetchWithRetry("/api/llm", {
            method: "POST",
            headers: getApiHeaders(),
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
          // Mismo payload OpenAI-compat, vía proxy same-origin /api/llm
          // (zhipu/kimi/qwen/deepseek bloquean CORS de browser; el server
          // fuerza thinking-off para zhipu si el cliente no lo pidió).
          const useStream = leaderProvider === "deepseek";
          const reqPayload = {
            model: leaderModel || prov.defaultModel,
            messages: [{ role: "system", content: turnSystemPrompt }, ...conversation],
            max_tokens: LLM_MAX_TOKENS, tools: leaderTools, tool_choice: "auto",
            ...(useStream ? { stream: true, stream_options: { include_usage: true } } : {}),
          };
          const reqBody = JSON.stringify({ provider: leaderProvider, body: reqPayload });
          const resp = await fetchWithRetry("/api/llm", {
            method: "POST",
            headers: getApiHeaders(),
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
          if (useStream && resp.headers.get("content-type")?.includes("text/event-stream")) {
            let preview = "";
            let previewAt = 0;
            data = await readOpenAiChatStream(resp, delta => {
              firstTokenMs ??= Date.now() - turnStartedAt;
              preview += delta;
              if (Date.now() - previewAt >= 80) {
                setStreamPreview(preview.slice(-1_000));
                setTurnPhase("Escribiendo respuesta");
                previewAt = Date.now();
              }
            });
          } else {
            data = await resp.json();
          }
          setStreamPreview("");
        }

        // Usage de la ronda (si el proveedor la trae) — para la telemetría
        // chatfab_decisions. undefined cuando no hay usage: el campo se omite.
        const roundLlmTokens = isAnthropic
          ? (((data?.usage?.input_tokens || 0) + (data?.usage?.output_tokens || 0)) || undefined)
          : (data?.usage?.total_tokens || undefined);
        const leaderUsage = readProviderUsage(data, isAnthropic);
        if (leaderUsage) {
          leaderUsageRounds++;
          leaderInputTokens += leaderUsage.inputTokens;
          leaderOutputTokens += leaderUsage.outputTokens;
          leaderCachedInputTokens += leaderUsage.cachedInputTokens;
        }
        firstModelResponseMs ??= Date.now() - turnStartedAt;
        setTurnPhase("Procesando respuesta");

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
                content: "⚠️ Escribiste nombres de herramientas como texto en lugar de ejecutarlas, y los resultados que inventaste no son reales. Ninguna tarjeta ni diseño fue creado. Usa function calling de verdad (tool_calls) — no escribas 'studio_create_card → {...}' ni JSON. Vuelve a intentarlo ejecutando las tools.",
              });
              continue;
            }
            // Out of retries: never show the fabricated transcript as if it
            // were a result — the user would believe work happened.
            setMessages(prev => [...prev, {
              role: "assistant",
              ts: Date.now(),
              content: "No pude ejecutar las herramientas: el modelo escribió los comandos como texto en vez de llamarlos, así que **no se creó ninguna tarjeta ni diseño**. Prueba con otro modelo para el rol Leader (⚙ Configuración del chat) — necesita soportar function calling.",
            }]);
            break;
          }
          if (textContent.trim()) setMessages(prev => [...prev, { role: "assistant", content: textContent.trim(), ts: Date.now() }]);
          break;
        }
        toolCallsCount += toolCalls.length;

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
        const parallelReads = canParallelizeReadTools(toolCalls.map(tc => tc.name))
          && toolCalls.every(tc => !tc.argsError)
          ? toolCalls.map(tc => executeToolCall(tc.name, tc.args, signal))
          : null;
        setTurnPhase(toolCalls.length > 1 ? `Ejecutando ${toolCalls.length} pasos` : "Ejecutando paso");
        const anthropicResults: any[] = [];
        for (let ti = 0; ti < toolCalls.length; ti++) {
          if (signal.aborted) break;
          const tc = toolCalls[ti];
          const eventId = `leader-${round}-${ti}-${tc.id || tc.name}`;
          setToolEvents(prev => [...prev, { id: eventId, tool: tc.name, status: "running" }]);
          const rawResult = tc.argsError
            ? serializeValidJson({ error: tc.argsError, code: "invalid_tool_arguments", executed: false })
            : tc.name === "musa_find_tools"
              ? await (async () => {
                  const found = await findLeaderTools(tc.args?.group, tc.args?.query);
                  leaderTools = selectProviderTools([
                    ...leaderTools,
                    ...found.filter(tool => !leaderTools.some(current => current.function.name === tool.function.name)),
                  ], leaderProvider);
                  return serializeValidJson({ available: found.map(tool => tool.function.name) });
                })().catch(error => serializeValidJson({ error: error?.message || "tool discovery failed", available: [] }))
              : await (parallelReads?.[ti] ?? executeToolCall(tc.name, tc.args, signal, progress => {
                setToolEvents(prev => prev.map(event => event.id === eventId
                  ? {
                      ...event,
                      tool: tc.name === "harness_delegate_task" ? `${progress.role}: ${progress.state}` : event.tool,
                      status: progress.state === "error" || progress.state === "cancelled" ? "error" : progress.state === "done" ? "done" : "running",
                      progress,
                    }
                  : event));
              }));
          const resultStr = normalizeAgentToolResult(rawResult);

          // ── Telemetría fire-and-forget → chatfab_decisions (router v0).
          // Sin await y con .catch vacío: el log NUNCA rompe ni lentifica el
          // chat; si el MCP aún no tiene la tool (deploy en dos fases), esto
          // es un no-op silencioso. Solo mensaje del user + metadatos.
          mcpCall("chatfab_log_decision", {
            session_id: currentContext.sessionId,
            message: userMsg.content,
            tool_used: tc.name,
            latency_ms: Date.now() - roundStart,
            llm_tokens: roundLlmTokens,
          }).catch(() => {});

          // ── Cache cardId → title for governance panel ──
          if (tc.name === "studio_create_card" && tc.args?.title) {
            try {
              const cardResult = JSON.parse(resultStr);
              if (cardResult?.id) cardTitleCache.current.set(cardResult.id, tc.args.title);
            } catch { /* best-effort */ }
          }
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
            delegatedRuns++;
            if (stats.tokenCountKind !== "actual") delegatedUsageActual = false;
            delegatedInputTokens += stats.inputTokens;
            delegatedOutputTokens += stats.outputTokens;
            delegatedCachedInputTokens += stats.cachedInputTokens || 0;
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
                  const artifactsByIndex: Array<ArtifactSnapshot | undefined> = new Array(delegateTemplateIds.length);
                  setTurnPhase(`Verificando ${delegateTemplateIds.length} diseño(s)`);
                  const fetchErrors: string[] = [];
                  await Promise.all(delegateTemplateIds.map(async (tid, verifyIndex) => {
                    const verifyEventId = `${eventId}:verify:${verifyIndex}:${tid}`;
                    setToolEvents(prev => [...prev, { id: verifyEventId, tool: `get_template (verify ${tid})`, status: "running" }]);
                    try {
                      const verifyResult = await mcpCall("get_template", { templateId: tid }, signal);
                      const t = verifyResult?.template || verifyResult;
                      if (!t || t.error || !t.id) throw new Error("vacío o no encontrado");
                      artifactsByIndex[verifyIndex] = {
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
                      };
                      setToolEvents(prev => prev.map(event => event.id === verifyEventId ? { ...event, status: "done" as const, result: "Artifact cargado para verificación contractual" } : event));
                    } catch (error: any) {
                      fetchErrors.push(`${tid}: ${error?.message || "no encontrado"}`);
                      setToolEvents(prev => prev.map(event => event.id === verifyEventId ? { ...event, status: "error" as const, result: "Vacío o no encontrado" } : event));
                    }
                  }));
                  const artifacts = artifactsByIndex.filter((artifact): artifact is ArtifactSnapshot => artifact !== undefined);
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
              const taskTitle = tc.args?.taskId ? cardTitleCache.current.get(tc.args.taskId) : undefined;
              const label = taskTitle
                ? `${parsedFinalResult.role === "implementer" ? "🛠️" : parsedFinalResult.role === "reviewer" ? "🔍" : ""} ${taskTitle}`
                : undefined;
              setGovernanceSessions(prev => {
                if (prev.some(s => s.sessionId === parsedFinalResult.sessionId)) return prev;
                return [...prev.slice(-49), {
                  sessionId: parsedFinalResult.sessionId,
                  taskId: tc.args?.taskId,
                  role: parsedFinalResult.role || "unknown",
                  status: parsedFinalResult.verification_failed ? "failed" : parsedFinalResult.outcome || "unknown",
                  ts: Date.now(),
                  label,
                  taskTitle: taskTitle || undefined,
                  plan: parsedFinalResult?.plan || undefined,
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

          const modelResult = toolResultForModel(tc.name, finalResultStr);
          if (isAnthropic) { anthropicResults.push({ type: "tool_result", tool_use_id: tc.id, content: modelResult }); }
          else { conversation.push({ role: "tool", tool_call_id: tc.id, content: modelResult }); }
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
            void mcpCall("harness_log_entry", {
              sessionId: currentContext.sessionId,
              entryType: "subagent_trace",
              content: JSON.stringify(traceEntry),
            }).catch(() => {});
          } catch { /* best-effort */ }
        }

        if (round === MAX_TOOL_ROUNDS) {
          turnCompleted = false;
          setMessages(prev => [...prev, { role: "assistant", content: textContent.trim() || "(límite de iteraciones alcanzado — revisa el Kanban)", ts: Date.now() }]);
        }
      }

      if (leaderHttpError) {
        turnCompleted = false;
        const providerError = leaderHttpError;
        const label = providerError.category === "context_limit" ? "límite de contexto" : "solicitud inválida";
        setMessages(prev => [...prev, {
          role: "assistant",
          content: `Error del proveedor (${label}, HTTP ${providerError.status}): ${providerError.body}. No asumiré que el trabajo terminó; solo cuentan los artifacts que el sistema haya verificado explícitamente.`,
          ts: Date.now(),
        }]);
      }
    } catch (e: any) {
      turnCompleted = false;
      if (e?.name === "AbortError") {
        setMessages(prev => [...prev, { role: "assistant", content: "Detenido.", ts: Date.now() }]);
      } else {
        // Log to harness_error_logs so the governance panel can show it,
        // even when the Leader failed before creating a session (e.g. a
        // 504 timeout before any delegation could happen).
        try {
          await mcpCall("harness_report_error", {
            tool: "leader_llm_call",
            args: { provider: leaderProvider, model: leaderModel },
            error_message: e?.message || "no se pudo contactar al proveedor",
            provider: leaderProvider,
            source: "chatfab",
          }).catch(() => {});
        } catch { /* best-effort */ }
        setMessages(prev => [...prev, { role: "assistant", content: `Error: ${e?.message || "no se pudo contactar al proveedor"}. Verifica tu API key.`, ts: Date.now() }]);
      }
    } finally {
      // One aggregate record per turn. The sentinel is excluded from router
      // training; notes contain only numeric usage and routing metadata.
      mcpCall("chatfab_log_decision", {
        session_id: currentContext.sessionId,
        message: userMsg.content,
        tool_used: "__run_metrics__",
        latency_ms: Date.now() - turnStartedAt,
        llm_tokens: leaderInputTokens + leaderOutputTokens + delegatedInputTokens + delegatedOutputTokens,
        metrics: {
          modules: chooseMusaModules(userMsg.content),
          provider: leaderProvider,
          model: leaderModel,
          leaderRounds,
          toolCalls: toolCallsCount,
          delegatedRuns,
          inputTokens: leaderInputTokens + delegatedInputTokens,
          outputTokens: leaderOutputTokens + delegatedOutputTokens,
          cachedInputTokens: leaderCachedInputTokens + delegatedCachedInputTokens,
          tokenCountKind: leaderUsageRounds === leaderRounds && delegatedUsageActual ? "actual" : "partial",
          firstModelResponseMs,
          firstTokenMs,
          completed: turnCompleted && !signal.aborted,
        },
      }).catch(() => {});
      setSending(false);
      abortRef.current = null;
    }
  }, [input, sending, leaderKey, messages, leaderModel, leaderProvider, systemPrompt]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // ══ FASE 2 ghost: teatro sobre el gate + loop agéntico ════════════════════
  // El ghost es MODO DE PRESENTACIÓN del gate (Parte 0): mismas tools, misma
  // sesión, mismos logs — con cursor visible y badge abortable. Cada corrida
  // loguea a chatfab_decisions con session_id propio `ghost_<ts>` (trace del
  // estilo Jev+Muse sale gratis de ahí). NUNCA toca el router ni el ONNX.
  const creationRunningRef = useRef(false);

  /** Log fire-and-forget del ghost — mismo contrato que la telemetría del
   *  gate: si el MCP aún no tiene la tool, no-op silencioso. */
  const ghostLog = (sessionId: string, message: string, toolUsed?: string, latencyMs?: number) => {
    void mcpCall("chatfab_log_decision", {
      session_id: sessionId,
      message: message.slice(0, 500),
      tool_used: toolUsed,
      latency_ms: latencyMs,
      router_verdict: "direct",
      resolved_by: "heuristic",
    }).catch(() => {});
  };

  /** Link del editor para un template recién creado (formato de la casa). */
  const linkForTemplate = (templateId?: string) =>
    templateId ? `${window.location.origin}/?template=${templateId}&v=2` : null;

  /** Parte 4 — ejecuta una receta de CREACIÓN elegida por chips:
   *  "here" → la MISMA cadena con teatro (cursor + badge + ABORTAR);
   *  "parallel" → la MISMA cadena headless (sin teatro) + burbuja con link.
   *  Transparencia idéntica al gate: chip por paso, error honesto del paso. */
  const runCreationChoice = async (chip: { recipeId: string; utterance: string; choice: "here" | "parallel" }) => {
    const recipe = RECIPES[chip.recipeId];
    if (!recipe || creationRunningRef.current) return;
    creationRunningRef.current = true;
    beginCreation(); // gate de salida activo hasta el finally
    setSending(true);
    const withTheater = chip.choice === "here";
    const ghostSession = `ghost_${Date.now()}`;
    const t0 = Date.now();
    const eventId = `ghost-creation-${t0}`;
    const created: { templateId?: string } = {};
    let curId: string | null = null;
    let abortUnsub: (() => void) | null = null;
    let aborted = false;
    try {
      if (withTheater) {
        ghost.start();
        abortUnsub = ghost.onAbort(() => { aborted = true; });
      }
      setToolEvents(prev => [...prev, { id: eventId, tool: `${chip.recipeId} · ${withTheater ? "aquí, con ghost" : "en paralelo"}`, status: "running" }]);
      const steps: Array<{ index: number; total: number; tool: string }> = [];
      const flipChip = (status: "done" | "error", note?: string) => {
        if (!curId) return;
        setToolEvents(prev => prev.map(ev => ev.id === curId
          ? { ...ev, status, ...(note ? { result: sanitizeRuntimeText(note, 300) } : {}) }
          : ev));
      };
      const env: RecipeEnv = {
        workspaceId: currentContext.workspaceId,
        templateId: currentContext.templateId,
        utterance: chip.utterance,
        begin: (index, total, tool) => {
          steps.push({ index, total, tool });
          curId = `ghost-creation-${t0}-${index}`;
          setToolEvents(prev => [...prev, { id: curId!, tool: `${chip.recipeId} · ${index}/${total}: ${tool}`, status: "running" as const }]);
          ghostLog(ghostSession, `[ghost ${chip.choice}] paso ${index}/${total}: ${tool}`, tool);
        },
        call: async (tool, args) => {
          try {
            // Teatro simbólico (decisión B del plan): la tool es una llamada
            // API — el cursor vuela a la zona real de la UI donde vive el
            // resultado y pausa lectura según el modo.
            if (withTheater) {
              ghost.assertLive();
              await ghost.move(ghostTargetForTool(tool) ?? { x: window.innerWidth / 2, y: 170 });
              await ghost.pause();
              ghost.assertLive();
            }
            const raw = await executeToolCall(tool, args);
            const resultStr = normalizeAgentToolResult(raw);
            const parsed: any = (() => { try { return JSON.parse(resultStr); } catch { return null; } })();
            const toolError = parsed?.error ?? parsed?.result?.error ?? null;
            if (toolError) throw new RecipeStepError(tool, String(toolError).slice(0, 200));
            if (CREATION_TOOLS.has(tool)) {
              created.templateId = parsed?.templateId || parsed?.id || parsed?.template?.id || created.templateId;
            }
            flipChip("done");
            return parsed;
          } catch (e: any) {
            const msg = e instanceof RecipeStepError ? e.message : String(e?.message || e).slice(0, 200);
            flipChip("error", msg);
            throw e instanceof RecipeStepError ? e : new RecipeStepError(tool, msg);
          }
        },
        say: (text) => setMessages(prev => [...prev, { role: "assistant", content: sanitizeRuntimeText(text, 800), ts: Date.now() }]),
      };
      let result;
      try {
        result = await recipe(env);
      } catch (e: any) {
        if (e instanceof GhostAbortedError || aborted) {
          setToolEvents(prev => prev.map(ev => ev.id === eventId
            ? { ...ev, status: "error" as const, result: "abortado por el usuario" }
            : ev));
          const hechos = steps.length ? ` Pasos lanzados: ${steps.map(s => s.tool).join(" → ")}.` : "";
          setMessages(prev => [...prev, { role: "assistant", content: `✕ Abortado: la coreografía se canceló.${hechos}`, ts: Date.now() }]);
          ghostLog(ghostSession, "[ghost] abortado por el usuario", undefined, Date.now() - t0);
          return;
        }
        const failedTool = e instanceof RecipeStepError ? e.tool : "?";
        const msg = String(e?.message || e).slice(0, 200);
        setMessages(prev => [...prev, { role: "assistant", content: `✕ La receta se detuvo en ${failedTool}: ${msg}. Escala al LLM con este contexto si querés continuar.`, ts: Date.now() }]);
        ghostLog(ghostSession, `[ghost] fallo en ${failedTool}: ${msg}`, failedTool, Date.now() - t0);
        return;
      }
      const link = linkForTemplate(created.templateId);
      const full = result.summary + (link ? `\nÁbrelo: ${link}` : "");
      env.say(full);
      setToolEvents(prev => prev.map(ev => ev.id === eventId
        ? { ...ev, status: "done" as const, result: sanitizeRuntimeText(full, 300) }
        : ev));
      ghostLog(ghostSession, `[ghost fin] ${result.summary.slice(0, 300)}`, undefined, Date.now() - t0);
    } catch (e: any) {
      // Catch EXTERNO: sin él, un throw temprano (p.ej. ghost.start) muere en
      // el void del call site — sin burbuja ✕ la demo queda colgada sin
      // respuesta (hole silencioso visto en take 2 del dogfood).
      const msg = String(e?.message || e).slice(0, 200);
      setToolEvents(prev => prev.map(ev => ev.id === eventId
        ? { ...ev, status: "error" as const, result: sanitizeRuntimeText(msg, 300) }
        : ev));
      setMessages(prev => [...prev, { role: "assistant", content: `✕ La creación no arrancó: ${msg}.`, ts: Date.now() }]);
      ghostLog(ghostSession, `[ghost] fallo pre-receta: ${msg}`, undefined, Date.now() - t0);
    } finally {
      if (abortUnsub) abortUnsub();
      if (withTheater && !aborted) ghost.done();
      creationRunningRef.current = false;
      endCreation(); // gate de salida liberado SIEMPRE, incluso en throw
      setSending(false);
      setStreamPreview("");
    }
  };

  /** Click en un chip de creación: desactiva los chips del mensaje y corre. */
  const handleGhostChip = (m: Message, chip: GhostChip) => {
    if (creationRunningRef.current) return;
    setMessages(prev => prev.map(msg => (msg.ts === m.ts && msg.content === m.content ? { ...msg, chips: undefined } : msg)));
    void runCreationChoice(chip);
  };

  /** Parte 2 — loop agéntico: observar → decidir (ghostBrain) → actuar con
   *  teatro → log → repetir. Cap duro GHOST_MAX_STEPS; al agotar, reporte
   *  honesto con lo logrado + última observación como evidencia. */
  const runGhostAgentLoop = async (task: string, prov: { endpoint: string; defaultModel: string }, signal: AbortSignal): Promise<void> => {
    const eventId = `ghost-loop-${Date.now()}`;
    setToolEvents(prev => [...prev, { id: eventId, tool: "ghost · mostrando cómo", status: "running" }]);
    const finalEvent = (status: "done" | "error", result: string) =>
      setToolEvents(prev => prev.map(ev => ev.id === eventId ? { ...ev, status, result: sanitizeRuntimeText(result, 300) } : ev));
    // Capa LLM inyectada al brain: MISMO proveedor/modelo/key que el chat
    // (isAnthropic incluido) — el brain no sabe de proveedores.
    const provCfg = PROVIDERS.find(p => p.id === leaderProvider) || PROVIDERS[0];
    const isAnthropic = leaderProvider === "anthropic";
    const llmJson: GhostLlm = async (system, user) => {
      const model = leaderModel || prov.defaultModel || provCfg.defaultModel;
      // GLM-5.3 piensa por defecto y devora el presupuesto antes del JSON:
      // el brain es un decisor mecánico → thinking off solo para zhipu.
      const body = isAnthropic
        ? { model, max_tokens: GHOST_BRAIN_MAX_TOKENS, system, messages: [{ role: "user", content: user }] }
        : { model, max_tokens: GHOST_BRAIN_MAX_TOKENS, messages: [{ role: "system", content: system }, { role: "user", content: user }], ...(leaderProvider === "zhipu" ? { thinking: { type: "disabled" } } : {}) };
      // Proxy same-origin /api/llm: z.ai (y otros) no permiten fetch directo
      // del navegador (preflight sin Access-Control-Allow-Origin — verificado)
      // y así la key descifrada nunca baja al cliente: el server la lee con
      // getUserKey. El body sigue siendo el payload nativo del proveedor.
      const resp = await fetch("/api/llm", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({ provider: leaderProvider, body }),
        signal,
      });
      if (!resp.ok) throw new Error(`LLM ${resp.status}: ${(await resp.text()).slice(0, 140)}`);
      const data = await resp.json();
      return isAnthropic
        ? (data?.content || []).map((b: any) => b?.text || "").join("")
        : (data?.choices?.[0]?.message?.content || "");
    };
    // El loop vive en ghostAgent.ts: UNA implementación compartida con el
    // bridge de ghost_perform (jobs MCP). Aquí solo se presenta en chat.
    const r = await runGhostAgent({ task, llm: llmJson, signal });
    if (r.status === "done") {
      setMessages(prev => [...prev, { role: "assistant", content: `✓ Mostrado (${r.steps} paso${r.steps === 1 ? "" : "s"}): ${r.note}`, ts: Date.now() }]);
      finalEvent("done", r.note);
    } else if (r.status === "budget") {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `✕ ${r.note}\nÚltimos pasos logrados:\n${r.history.slice(-5).join("\n")}\n\nÚltima observación (evidencia):\n${r.lastObservation}`,
        ts: Date.now(),
      }]);
      finalEvent("error", `límite de ${GHOST_MAX_STEPS} pasos`);
    } else if (r.status === "aborted") {
      setMessages(prev => [...prev, { role: "assistant", content: `✕ Abortado: ${r.note} (${r.steps} paso${r.steps === 1 ? "" : "s"} completados).`, ts: Date.now() }]);
      finalEvent("error", "abortado");
    } else {
      setMessages(prev => [...prev, { role: "assistant", content: `✕ El ghost no pudo continuar: ${r.note}. Pasos completados: ${r.steps}.`, ts: Date.now() }]);
      finalEvent("error", r.note);
    }
  };

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

  const panelWidth = 380; // dock lateral (~360-400px, spec dock v1)
  const activeProgress = [...toolEvents].reverse().find(event => event.progress)?.progress;
  const activeElapsedMs = activeProgress
    ? activeProgress.elapsedMs + (sending ? Math.max(0, clockNow - activeProgress.emittedAt) : 0)
    : 0;
  return (
    <>
      {/* Pestaña delgada del borde: reabre el dock colapsado y queda como
          entrada única mientras un panel de detalle ocupa la derecha.
          Icono robotcito SVG — nunca emoji. */}
      {!open && !hideFab && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Abrir chat"
          aria-label="Abrir chat"
          style={{
            position: "fixed", top: "50%", right: 0, transform: "translateY(-50%)", zIndex: 9100,
            writingMode: "vertical-rl",
            background: "#0c0c0c",
            border: "1px solid rgba(200,184,152,0.35)", borderRight: "none",
            borderRadius: "10px 0 0 10px", padding: "14px 7px",
            color: "#c8b898", cursor: "pointer", fontSize: 11, fontWeight: 600,
            letterSpacing: 1.5, fontFamily: "inherit",
            display: "flex", alignItems: "center", gap: 6,
            boxShadow: "-4px 4px 16px rgba(0,0,0,0.4)",
          }}
        >
          <ChatDockIcon width={13} height={13} />
          Chat
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
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
                Se guardan cifradas en tu cuenta, no en este navegador, así que te siguen
                a cualquier dispositivo. Una vez guardadas no se pueden volver a leer.
              </div>
              {/* REQ-028 Item 4.1 — freemium honesto: sin llave TAMBIÉN hay Ghost. */}
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>
                Sin llave: el Ghost usa la IA de Musa gratis (30 runs/mes). Con tu llave: ilimitado.
              </div>
              {PROVIDERS.map(p => {
                const stored = storedKeys.find(k => k.provider === p.id);
                return (
                  <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <label htmlFor={`provider-key-${p.id}`} style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", display: "flex", gap: 6 }}>
                      <span>{p.label}</span>
                      {stored && (
                        <span style={{ color: "rgba(120,220,150,0.85)" }}>
                          guardada ····{stored.last4}
                        </span>
                      )}
                    </label>
                    <div style={{ display: "flex", gap: 4 }}>
                      <input
                        id={`provider-key-${p.id}`}
                        type="password"
                        autoComplete="off"
                        value={keyDraft[p.id] || ""}
                        onChange={e => setKeyDraft(prev => ({ ...prev, [p.id]: e.target.value }))}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void submitKey(p.id); } }}
                        placeholder={stored ? "Pega una nueva para rotarla" : `${p.keyPrefix}... ${p.label} key`}
                        style={{ ...inputBase, flex: 1, padding: "5px 10px", fontSize: 11, fontFamily: "monospace" }}
                      />
                      <button
                        type="button"
                        onClick={() => void submitKey(p.id)}
                        disabled={!(keyDraft[p.id] || "").trim()}
                        style={{
                          padding: "5px 10px", fontSize: 10, cursor: "pointer", fontFamily: "inherit",
                          background: "rgba(255,255,255,0.08)", color: "#fff",
                          border: "1px solid rgba(255,255,255,0.18)", borderRadius: 4,
                        }}
                      >{stored ? "Rotar" : "Guardar"}</button>
                      {stored && (
                        <button
                          type="button"
                          onClick={() => void removeKey(p.id)}
                          title="Eliminar de tu cuenta"
                          style={{
                            padding: "5px 8px", fontSize: 10, cursor: "pointer", fontFamily: "inherit",
                            background: "transparent", color: "rgba(255,255,255,0.5)",
                            border: "1px solid rgba(255,255,255,0.14)", borderRadius: 4,
                          }}
                        >×</button>
                      )}
                    </div>
                  </div>
                );
              })}
              {keyStatus && (
                <div role="status" style={{ fontSize: 10, color: "rgba(255,255,255,0.6)" }}>{keyStatus}</div>
              )}
          
              {/* ── Model per role ── */}
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1, marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
                <span>Modelos por Rol</span>
                <button
                  type="button"
                  title="Sincronizar modelos con cada proveedor"
                  aria-label="Sincronizar modelos"
                  onClick={() => void syncProviderModels()}
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 16, height: 16, background: "transparent", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 4, cursor: "pointer", padding: 0 }}
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                    <polyline points="21 3 21 9 15 9" />
                  </svg>
                </button>
              </div>
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
                      {modelsFor(roleConfig[role].provider).map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </div>
              ))}
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>Keys guardadas en tu navegador. Se envían directo al proveedor LLM. Cada rol puede usar un proveedor y modelo distinto.</span>

              {/* ── Router v1: "Modo instantáneo" (portero ONNX pre-LLM) ── */}
              <div
                role="switch"
                aria-checked={instantMode}
                aria-label="Modo instantáneo"
                tabIndex={0}
                onClick={() => setInstantMode(prev => {
                  const next = !prev;
                  try { localStorage.setItem("chatfab_instant_mode", next ? "on" : "off"); } catch { /* almacenamiento privado */ }
                  return next;
                })}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}
                style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 10, color: "rgba(255,255,255,0.6)", userSelect: "none" }}
              >
                <span aria-hidden="true" style={{ position: "relative", width: 34, height: 18, borderRadius: 9, background: instantMode ? "#34d399" : "rgba(255,255,255,0.15)", transition: "background 0.15s", flexShrink: 0 }}>
                  <span style={{ position: "absolute", top: 2, left: instantMode ? 18 : 2, width: 14, height: 14, borderRadius: 7, background: "#111524", transition: "left 0.15s" }} />
                </span>
                <span>Modo instantáneo — acciones mecánicas sin LLM</span>
              </div>

              {/* ── MCP API Key for external access (IDE agent debugging) ── */}
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1, marginTop: 6 }}>🔑 MCP Key para debug externo</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", wordBreak: "break-all" }}>
                Endpoint: <code style={{ fontSize: 9, background: "rgba(255,255,255,0.05)", padding: "2px 4px", borderRadius: 3 }}>https://design.futuraria.com/api/mcp</code>
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const result = await mcpCall("create_api_key", {
                      label: `debug_${new Date().toISOString().slice(0, 10)}`,
                      scope: "read",
                    });
                    const key = result?.key || result?.api_key || result?.data?.key || "";
                    if (key) {
                      await navigator.clipboard.writeText(key);
                      setCopyStatus("copied");
                      setTimeout(() => setCopyStatus("idle"), 2000);
                      setMessages(prev => [...prev, {
                        role: "assistant",
                        content: `🔑 **API Key creada y copiada.**\n\nEndpoint: \`https://design.futuraria.com/api/mcp\`\nKey: \`${key.slice(0, 12)}...${key.slice(-8)}\`\n\n⚠️ **Guárdala ahora** — no se puede recuperar después. Pásasela a tu agente IDE con scope read para que pueda auditar sesiones.`,
                        ts: Date.now(),
                      }]);
                    } else {
                      setMessages(prev => [...prev, {
                        role: "assistant",
                        content: `⚠️ No se pudo crear la key: ${JSON.stringify(result).slice(0, 300)}`,
                        ts: Date.now(),
                      }]);
                    }
                  } catch (err: any) {
                    setMessages(prev => [...prev, {
                      role: "assistant",
                      content: `⚠️ Error creando API key: ${err?.message || "desconocido"}. ¿Está activo el MCP?`,
                      ts: Date.now(),
                    }]);
                  }
                }}
                style={{
                  ...inputBase, padding: "6px 12px", fontSize: 11, cursor: "pointer",
                  background: "rgba(167,139,250,0.15)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.3)",
                  fontWeight: 600,
                }}
              >
                🔑 Crear API Key (solo lectura) y copiar
              </button>
            </div>
          )}
        </div>

        {/* Messages */}
        <div ref={scrollRef} style={{
          flex: 1, overflowY: "auto", padding: "14px 18px",
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          {sending && (
            <div style={{ alignSelf: "flex-start", fontSize: 12, color: "#a1a1aa", fontStyle: "italic" }}>
              <span aria-hidden="true">
                {activeProgress
                  ? `${activeProgress.role} · ${SUBAGENT_PROGRESS_LABELS[activeProgress.state]} · ${formatDuration(activeElapsedMs)} · ronda ${activeProgress.round}/${activeProgress.maxRounds} · ${activeProgress.tokenCountKind === "estimated" ? "~" : ""}${formatTokens(activeProgress.cumulativeTokens)} tokens${activeProgress.currentTool ? ` · ${activeProgress.currentTool}` : ""}`
                  : `${turnPhase}…`}
              </span>
              <span role="status" aria-live="polite" style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}>
                {activeProgress
                  ? `${activeProgress.role}: ${SUBAGENT_PROGRESS_LABELS[activeProgress.state]}, ronda ${activeProgress.round} de ${activeProgress.maxRounds}${activeProgress.currentTool ? `, herramienta ${activeProgress.currentTool}` : ""}`
                  : turnPhase}
              </span>
            </div>
          )}
          {sending && streamPreview && (
            <div aria-live="off" style={{ alignSelf: "flex-start", maxWidth: "85%", whiteSpace: "pre-wrap", fontSize: 12, color: "#d4d4d8" }}>
              {streamPreview}
            </div>
          )}
          {/* Newest first: the reply renders above the question (user request). */}
          {[...renderItems].reverse().map(item => {
            if (item.type === "message") {
              const m = item.message;
              return (
                <div key={item.index} style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  /* Fixed equal width so question and reply bubbles share the same size. */
                  width: "85%",
                  background: m.role === "user" ? "rgba(200,184,152,0.15)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${m.role === "user" ? "rgba(200,184,152,0.3)" : "rgba(255,255,255,0.06)"}`,
                  borderRadius: 12, padding: "10px 14px",
                  fontSize: 12.5, lineHeight: 1.5, color: "rgba(255,255,255,0.85)",
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                  userSelect: "text", cursor: "text",
                }}>{renderWithLinks(m.content)}
                  {/* FASE 2 · Parte 4: chips de creación [aquí / paralelo] */}
                  {m.chips && m.chips.length > 0 && (
                    <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                      {m.chips.map(c => (
                        <button
                          key={c.choice}
                          type="button"
                          data-testid={`ghost-chip-${c.choice}`}
                          disabled={sending || creationRunningRef.current}
                          onClick={() => handleGhostChip(m, c)}
                          style={{
                            fontSize: 11.5, fontWeight: 600, fontFamily: "inherit",
                            padding: "6px 12px", borderRadius: 999, cursor: sending ? "not-allowed" : "pointer",
                            background: c.choice === "here" ? "rgba(96,165,250,0.18)" : "rgba(255,255,255,0.06)",
                            color: c.choice === "here" ? "#93c5fd" : "rgba(255,255,255,0.8)",
                            border: c.choice === "here" ? "1px solid rgba(96,165,250,0.4)" : "1px solid rgba(255,255,255,0.15)",
                          }}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
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
          {/* FASE 2 · Parte 0: ritmo del ghost — mismo cerebro y resultado,
              SOLO cambia el ritmo. Persistido en localStorage. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: "#a1a1aa" }}>Ritmo del ghost</span>
            <div role="group" aria-label="Ritmo del ghost" style={{ display: "flex", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 999, overflow: "hidden" }}>
              {([["teacher", "Teacher"], ["full", "Full"]] as const).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  data-testid={`ghost-mode-${m}`}
                  aria-pressed={ghostMode === m}
                  onClick={() => setGhostMode(m)}
                  style={{
                    fontSize: 10.5, padding: "3px 12px", cursor: "pointer", fontFamily: "inherit", border: 0,
                    fontWeight: ghostMode === m ? 700 : 500,
                    background: ghostMode === m ? "rgba(96,165,250,0.25)" : "transparent",
                    color: ghostMode === m ? "#93c5fd" : "#a1a1aa",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              aria-label="Mensaje para el Leader"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Pídele algo al Leader…"
              disabled={sending}
              style={{ ...inputBase, flex: 1, padding: "8px 12px", fontSize: 12.5 }}
            />
            {sending ? (
              <button type="button" onClick={stop} aria-label="Detener al Leader" title="Detener al Leader" data-testid="chat-detener" style={{
                background: "rgba(248,113,113,0.15)", color: "#fca5a5",
                border: "1px solid rgba(248,113,113,0.4)",
                borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit",
              }}>■ Detener</button>
            ) : (
              <button type="button" onClick={send} disabled={!input.trim()} data-testid="chat-enviar" style={{
                background: input.trim() ? "rgba(200,184,152,0.2)" : "rgba(255,255,255,0.04)",
                color: input.trim() ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.2)",
                border: `1px solid ${input.trim() ? "rgba(200,184,152,0.35)" : "rgba(255,255,255,0.05)"}`,
                borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600,
                cursor: input.trim() ? "pointer" : "not-allowed", fontFamily: "inherit",
              }}>Enviar</button>
            )}
          </div>
        </div>
      </div>

      {/* Governance Panel */}
      {showGovernance && (
        <GovernancePanel
          sessions={governanceSessions}
          workspaceId={workspaceId}
          onClose={() => setShowGovernance(false)}
        />
      )}
    </>
  );
}
