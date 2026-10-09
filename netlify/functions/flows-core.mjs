// REQ-027 — flows-core: validación, storage y runtime determinista del flow
// builder de Musa. Port de flows-engine/src/automation-flow-engine.mjs con los
// cambios de Musa: sin cron server (trigger informativo), sin nodos webhook
// ejecutables, storage Supabase (no fs), nodos v1 (source_rss / source_nitter /
// source_http / ai / template / http / map / condition / text / report),
// límites 20 flows / 40 nodos / 60 edges, error codes estables para que las
// IAs se autocorrijan leyendo flow_history.
//
// Workers-safe: nada de fs, dns ni rss-parser. La crypto de secretos
// (encrypt/decrypt) se inyecta desde mcp.mjs (mismo esquema de keys.mjs).

import {
  fetchRssArticles, fetchNitterArticles, runAiText, validateAiConfig,
  renderTemplateFrame, templateValuesFromItem, guardedFetch, readLimited,
  AI_PROVIDERS, flowSourceError,
} from "./flows-sources.mjs";
// Catálogo de tools de Musa permitidas como nodo tool (plan FLOW_NODE_PICKER):
// única fuente de verdad — la paleta del editor consume el MISMO archivo.
import { FLOW_TOOL_TIERS, FLOW_TOOL_WRITE } from "../../src/data/flowToolCatalog.ts";

export const LIMITS = {
  flowsPerWorkspace: 20,
  nodesPerFlow: 40,
  edgesPerFlow: 60,
  inputBytes: 50_000,
  stepOutputChars: 4_000,
  maxItemsPerTemplateNode: 5,
  defaultItemsPerTemplateNode: 3,
  maxItemsTransform: 100, // F9: cap de items para sort/dedupe/aggregate/limit
  runTimeoutMs: 25_000,
  historyLimit: 100,
  maxRunningPerWorkspace: 3,
  webhookSecretBytes: 32,
  // Blindaje freemium: cap duro de runs por flow y hora (un webhook en loop
  // no quema la cuota del free tier). El evaluador cron alimenta flow_due_check
  // (consulta PASIVA de la IA desde su loop — el server NUNCA barre flows):
  // escanea slots hacia atrás con catch-up hasta 8h.
  runsPerFlowPerHour: 240,
  cronLookbackMs: 24 * 3_600_000,
  cronMaxSlotScan: 480,
  // Paridad n8n (plan FLOW_BUILDER_GAP_VS_N8N): wait acotado al presupuesto de
  // run (25s), versiones de edición por flow y tamaño del nodo code.
  maxWaitSeconds: 20,
  maxVersionsPerFlow: 10,
  codeMaxChars: 8_000,
  maxRetryPerNode: 5,
  // Nodo tool (plan picker): presupuesto de llamadas MCP por run. La allowlist
  // por tier vive en FLOW_TOOL_TIERS (src/data/flowToolCatalog.ts).
  maxToolCallsPerRun: 25,
  // B5 (wait_webhook/approval): tamaño máx del estado serializado de un run
  // pausado. La vida útil la clampa el nodo (timeoutMinutes 1..1440).
  pauseStateMaxChars: 262_144,
};

export const NODE_TYPES = ["source_rss", "source_nitter", "source_http", "ai", "agent", "template", "http", "map", "condition", "switch", "loop", "merge", "compare", "wait", "wait_webhook", "approval", "subflow", "code", "tool", "group", "text", "report", "preview", "note", "sort", "dedupe", "aggregate", "limit"];
const SOURCE_TYPES = new Set(["source_rss", "source_nitter", "source_http"]);
// Fan-in (varias aristas entrantes): nodos que AGREGAN streams. merge/loop/code
// se suman a ai/report (plan Fase 2).
const FAN_IN_TYPES = new Set(["ai", "report", "merge", "loop", "code", "compare", "sort", "dedupe", "aggregate", "limit"]);
const FLOW_ID = /^flow_[A-Za-z0-9_-]{1,64}$/;
const NODE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const CRON_RE = /^\S+\s+\S+\s+\S+\s+\S+\s+\S+(?:\s+\S+)?$/;

export function flowError(code, message) {
  return Object.assign(new Error(message), { flowCode: code });
}

// ── Scheduler: evaluador cron puro (fase 3) ──────────────────────────────

const CRON_FIELD_RANGES = [
  [0, 59], // minuto
  [0, 23], // hora
  [1, 31], // día del mes
  [1, 12], // mes
  [0, 7], // día de semana (0 y 7 = domingo)
];
const CRON_WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Expande un campo cron (asterisco puro, con paso "asterisco/5", rangos
 *  "1-5", listas "1,15,30", rango con paso "1-5/2") a sus valores.
 *  Lanza RangeError si el campo es inválido — parseCron lo traduce a VALIDATION. */
function cronFieldValues(field, [min, max]) {
  const values = new Set();
  for (const part of String(field).split(",")) {
    const match = /^(?:\*|(\d{1,2})(?:-(\d{1,2}))?)(?:\/(\d{1,2}))?$/.exec(part.trim());
    if (!match) throw new RangeError(`campo cron inválido: ${part}`);
    const start = match[1] != null ? Number(match[1]) : min;
    const end = match[2] != null ? Number(match[2]) : match[1] != null ? start : max;
    const step = match[3] != null ? Number(match[3]) : 1;
    if (start < min || end > max || start > end || step < 1) throw new RangeError(`campo cron fuera de rango: ${part}`);
    for (let value = start; value <= end; value += step) values.add(max === 7 && value === 7 ? 0 : value);
  }
  return values;
}

/** Parsea "m h dom mon dow" (5 campos; con 6 el primero son segundos y se
 *  ignora — el barrido corre cada 5 min). Exportado para tests. */
export function parseCron(expression) {
  const raw = String(expression ?? "").trim().split(/\s+/);
  if (raw.length === 6) raw.shift();
  if (raw.length !== 5) throw new RangeError("el cron debe tener 5-6 campos");
  return raw.map((field, index) => {
    const wildcard = field === "*" || field.startsWith("*/");
    return { wildcard, values: cronFieldValues(field, CRON_FIELD_RANGES[index]) };
  });
}

function cronMatches(fields, parts) {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  if (!minute.values.has(parts.minute) || !hour.values.has(parts.hour) || !month.values.has(parts.month)) return false;
  const domOk = dayOfMonth.values.has(parts.day);
  const dowOk = dayOfWeek.values.has(parts.dow);
  if (dayOfMonth.wildcard && dayOfWeek.wildcard) return true;
  if (dayOfMonth.wildcard) return dowOk;
  if (dayOfWeek.wildcard) return domOk;
  return domOk || dowOk; // semántica estándar cron: ambos restringidos → OR
}

function cronLocalParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return { minute: Number(get("minute")), hour: Number(get("hour")) % 24, day: Number(get("day")), month: Number(get("month")), dow: CRON_WEEKDAYS[get("weekday")] ?? 0 };
}

/** ¿Venció la ventana cron de este trigger schedule? Puro y Workers-safe
 *  (solo Intl). La consume flow_due_check: la IA del usuario pregunta DESDE
 *  SU PROPIO loop si el flow vence ahora — el server NUNCA barre flows.
 *  Busca el slot MÁS NUEVO que matchee, sea posterior al último run y no
 *  anterior al ancla (updated_at del flow): si la IA estuvo offline,
 *  catch-up UNA vez con ese slot como requestId — no N veces.
 *  Cap de escaneo: LIMITS.cronMaxSlotScan slots hacia atrás (~8h). */
export function flowCronDue(trigger, { lastRunAt = null, anchorAt = null, now = new Date() } = {}) {
  if (trigger?.type !== "schedule" || !trigger.cron) return { due: false };
  let fields;
  try {
    fields = parseCron(trigger.cron);
  } catch {
    return { due: false }; // trigger inválido guardado: el scheduler no explota
  }
  const timeZone = trigger.timezone || "America/Lima";
  const lastRunMs = Number.isFinite(Date.parse(lastRunAt)) ? Date.parse(lastRunAt) : null;
  const anchorMs = Number.isFinite(Date.parse(anchorAt)) ? Date.parse(anchorAt) : now.getTime() - LIMITS.cronLookbackMs;
  const minuteMs = 60_000;
  const nowSlot = Math.floor(now.getTime() / minuteMs) * minuteMs;
  const oldestSlot = Math.max(nowSlot - LIMITS.cronLookbackMs, anchorMs, lastRunMs != null ? lastRunMs + minuteMs : 0);
  const startSlot = Math.floor(Math.max(oldestSlot, 0) / minuteMs) * minuteMs;
  let scanned = 0;
  for (let slot = nowSlot; slot >= startSlot && scanned < LIMITS.cronMaxSlotScan; slot -= minuteMs, scanned++) {
    let parts;
    try {
      parts = cronLocalParts(new Date(slot), timeZone);
    } catch {
      return { due: false }; // timezone inválida: no explota
    }
    if (!cronMatches(fields, parts)) continue;
    if (lastRunMs != null && slot <= lastRunMs) break; // ese slot ya corrió; los más viejos también
    return { due: true, slot: new Date(slot).toISOString() };
  }
  return { due: false };
}

// ── deepResolve: {{input.x}}, {{steps.id.y}}, {{item.x}} ────────────────────

export function deepResolve(value, context) {
  if (Array.isArray(value)) return value.map((item) => deepResolve(item, context));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepResolve(item, context)]));
  }
  if (typeof value !== "string") return value;
  const exact = value.match(/^\{\{\s*(input|steps|item|vars|static)\.([A-Za-z0-9_.-]+)\s*\}\}$/);
  if (exact) return lookupPath(context[exact[1]], exact[2]);
  return value.replace(/\{\{\s*(input|steps|item|vars|static)\.([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, source, key) => {
    const resolved = lookupPath(context[source], key);
    return resolved == null ? "" : typeof resolved === "string" ? resolved : JSON.stringify(resolved);
  });
}

function lookupPath(source, key) {
  return String(key).split(".").reduce((item, part) => (item == null ? item : item[part]), source);
}

// ── Validación ──────────────────────────────────────────────────────────────

export function validateTrigger(raw, { enabled }) {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw flowError("VALIDATION", "El trigger debe ser un objeto.");
  const type = String(raw.type ?? "manual");
  if (!["manual", "webhook", "schedule", "error"].includes(type)) throw flowError("VALIDATION", `Trigger no válido: ${type} (manual|webhook|schedule|error).`);
  const trigger = { type };
  if (type === "webhook") {
    // F5: modo de respuesta — "ack" (default: ok inmediato) o "lastNode" (la
    // respuesta HTTP lleva los outputs de los nodos terminales del run).
    if (raw.respond != null) {
      if (!"ack lastNode".split(" ").includes(raw.respond)) throw flowError("VALIDATION", "trigger.respond debe ser 'ack' o 'lastNode'.");
      trigger.respond = raw.respond;
    }
  }
  if (type === "schedule") {
    // El trigger es declarativo (la IA agenda), pero el cron se valida con el
    // MISMO parser que usa flow_due_check — un cron guardado inválido jamás
    // vencería en silencio y la IA no podría agendar nada con él.
    const cron = String(raw.cron ?? "").trim();
    if (!cron || cron.length > 100 || !CRON_RE.test(cron)) throw flowError("VALIDATION", "El cron del trigger schedule no tiene formato válido (5-6 campos).");
    try {
      parseCron(cron);
    } catch (e) {
      throw flowError("VALIDATION", `Cron inválido: ${e?.message ?? cron} (usa "m h dom mon dow", p. ej. "0 8 * * *").`);
    }
    trigger.cron = cron;
    trigger.timezone = String(raw.timezone ?? "America/Lima").slice(0, 60);
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: trigger.timezone });
    } catch {
      throw flowError("VALIDATION", `timezone no válida: ${trigger.timezone} (usa una IANA, p. ej. America/Santiago).`);
    }
  }
  // Posición del nodo inicial en el canvas del editor (solo UI): se persiste
  // para que el usuario ordene sus flows a voluntad y al recargar no salte a
  // la esquina. clampPosition la acota al mismo rango de los nodos.
  if (raw.position != null && typeof raw.position === "object") {
    trigger.position = clampPosition(raw.position);
  }
  // Línea disparo→nodo (solo UI, organizativa): marca el arranque visual en
  // el canvas. El run empieza siempre en los nodos fuente; entry vive en el
  // trigger y no en edges para no alterar el contrato del engine.
  if (raw.entry != null && typeof raw.entry === "string" && raw.entry.trim()) {
    trigger.entry = raw.entry.trim().slice(0, 120);
  }
  return trigger;
}

function clampPosition(raw) {
  return { x: Math.max(-1_000_000, Math.min(1_000_000, Number(raw?.x) || 0)), y: Math.max(-1_000_000, Math.min(1_000_000, Number(raw?.y) || 0)) };
}

function httpsUrlOrThrow(value, what) {
  let url;
  try { url = new URL(String(value ?? "").trim()); } catch { throw flowError("VALIDATION", `${what} debe ser una URL válida.`); }
  if (url.protocol !== "https:" || url.username || url.password) throw flowError("VALIDATION", `${what} debe usar HTTPS sin credenciales en la URL.`);
  return url.toString();
}

function normalizeNodeConfig(type, config, allowIncomplete = false) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    if (allowIncomplete && type === "template") return { templateId: "", frameId: "", format: "custom", maxItems: LIMITS.defaultItemsPerTemplateNode };
    throw flowError("VALIDATION", `El nodo de tipo ${type} necesita config.`);
  }
  const out = {};
  if (type === "source_rss") {
    out.url = httpsUrlOrThrow(config.url, "La URL del feed RSS");
    out.limit = clampInt(config.limit, 1, 50, 25);
  } else if (type === "source_nitter") {
    const direct = String(config.url ?? config.rssUrl ?? "").trim();
    const username = String(config.username ?? "").trim().replace(/^@/, "");
    const instanceUrl = String(config.instanceUrl ?? "").trim();
    if (!direct && !username) throw flowError("VALIDATION", "El nodo Nitter necesita usuario de X + instancia, o URL RSS directa.");
    if (direct) out.url = httpsUrlOrThrow(direct, "La URL RSS de Nitter");
    if (username) {
      if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) throw flowError("VALIDATION", "El usuario de X no es válido.");
      out.username = username;
      out.instanceUrl = httpsUrlOrThrow(instanceUrl, "La instancia de Nitter");
    }
    out.includeReposts = config.includeReposts !== false;
    out.limit = clampInt(config.limit, 1, 100, 25);
  } else if (type === "source_http") {
    out.url = httpsUrlOrThrow(config.url, "La URL del nodo HTTP");
    out.method = ["GET", "POST"].includes(String(config.method ?? "GET").toUpperCase()) ? String(config.method ?? "GET").toUpperCase() : "GET";
    out.headers = cleanHeaders(config.headers);
    if (config.body != null) out.body = config.body;
    out.listPath = String(config.listPath ?? "").slice(0, 120);
    out.credentialId = cleanId(config.credentialId, "credentialId");
    out.limit = clampInt(config.limit, 1, 50, 25);
    // Paginación (plan E5): sigue nextPath (ruta JSON a la siguiente URL)
    // hasta maxPages. Sin pagination el nodo queda igual que siempre.
    if (config.pagination && typeof config.pagination === "object" && !Array.isArray(config.pagination)) {
      const nextPath = String(config.pagination.nextPath ?? "").trim().slice(0, 120);
      if (nextPath) out.pagination = { maxPages: clampInt(config.pagination.maxPages, 1, 10, 1), nextPath };
    }
  } else if (type === "ai") {
    validateAiConfig({ ...config, prompt: typeof config.prompt === "string" ? config.prompt : "" });
    out.provider = config.provider;
    out.model = String(config.model ?? "").trim().slice(0, 120);
    out.systemPrompt = typeof config.systemPrompt === "string" ? config.systemPrompt.slice(0, 5_000) : "";
    out.prompt = String(config.prompt).slice(0, 20_000);
    out.maxOutputTokens = clampInt(config.maxOutputTokens, 1, 8192, 1024);
    out.credentialId = cleanId(config.credentialId, "credentialId");
    // Una IA sin credencial SOLO es válida en borradores: al activar se exige
    // (igual que el template con sus ids) — si no, fallaría siempre en runtime.
    if (!allowIncomplete && !out.credentialId) {
      throw flowError("VALIDATION", "El nodo IA necesita credentialId: crea una credencial con flow_credentials_set y selecciona su id.");
    }
    out.maxItems = clampInt(config.maxItems, 1, LIMITS.maxItemsPerTemplateNode, LIMITS.defaultItemsPerTemplateNode);
    // F1: structured output — responseFormat json y schema opcional (JSON Schema
    // acotado). ANTES responseFormat se perdía en el save; ahora persiste.
    if (config.responseFormat === "json") out.responseFormat = "json";
    // Research en el nodo IA (Flows-brand/REQ-042): opt-in — el proveedor
    // busca en la web con su capacidad nativa, los 8 cubiertos (gemini
    // google_search, anthropic web_search, openrouter plugin web, openai y
    // deepseek Responses API, glm web_search, qwen enable_search, kimi
    // search-then-generate). Cero keys de búsqueda propias.
    if (config.webSearch === true) out.webSearch = true;
    if (config.schema != null && config.schema !== "") {
      const schema = typeof config.schema === "string" ? safeJsonParse(config.schema) : config.schema;
      if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
        throw flowError("VALIDATION", "ai.config.schema debe ser un JSON Schema (objeto, o string JSON que parsee a objeto).");
      }
      let schemaSize = 0;
      try { schemaSize = JSON.stringify(schema).length; } catch { throw flowError("VALIDATION", "ai.config.schema no es serializable."); }
      if (schemaSize > 2_000) throw flowError("VALIDATION", "ai.config.schema demasiado grande (máx 2KB): schema acotado, los datos viajan por el flujo.");
      out.schema = typeof config.schema === "string" ? config.schema : JSON.stringify(schema);
    }
  } else if (type === "template") {
    const templateId = String(config.templateId ?? "");
    const frameId = String(config.frameId ?? "");
    // Flows-brand: receta inline — si trae recipe, el nodo YA está configurado
    // (el frame viaja en la definición), incluso en flows activos.
    const recipe = normalizeTemplateRecipe(config.recipe);
    if (recipe) {
      out.recipe = recipe;
      out.format = ["post", "story", "custom"].includes(config.format) ? config.format : "custom";
      out.maxItems = clampInt(config.maxItems, 1, LIMITS.maxItemsPerTemplateNode, LIMITS.defaultItemsPerTemplateNode);
      const recipeExtras = normalizeExtraValues(config.extraValues);
      if (recipeExtras) out.extraValues = recipeExtras;
      return out;
    }
    // Un template sin archivo+frame SOLO es válido en borradores: es el estado
    // "a configurar" de los presets de la biblioteca. Al activar se exige.
    if (!templateId && !frameId && allowIncomplete) {
      const draftExtras = normalizeExtraValues(config.extraValues);
      return { templateId: "", frameId: "", format: ["post", "story", "custom"].includes(config.format) ? config.format : "custom", maxItems: clampInt(config.maxItems, 1, LIMITS.maxItemsPerTemplateNode, LIMITS.defaultItemsPerTemplateNode), ...(draftExtras ? { extraValues: draftExtras } : {}) };
    }
    if (!NODE_ID.test(templateId)) throw flowError("VALIDATION", "El nodo template necesita templateId (el archivo de Diseño).");
    if (!NODE_ID.test(frameId)) throw flowError("VALIDATION", "El nodo template necesita frameId (elige archivo y frame exacto).");
    out.templateId = templateId;
    out.frameId = frameId;
    out.format = ["post", "story", "custom"].includes(config.format) ? config.format : "custom";
    out.maxItems = clampInt(config.maxItems, 1, LIMITS.maxItemsPerTemplateNode, LIMITS.defaultItemsPerTemplateNode);
    // Flows-brand: valores para tokens {{token}} arbitrarios del frame
    // ({{colorPrimario}}, {{tipografiaTitulos}}, …). deepResolve ya resuelve
    // {{input.x}}/{{vars.y}} dentro de estos valores antes del run.
    const extraValues = normalizeExtraValues(config.extraValues);
    if (extraValues) out.extraValues = extraValues;
  } else if (type === "http") {
    out.url = httpsUrlOrThrow(config.url, "La URL del nodo HTTP");
    out.method = ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(String(config.method ?? "GET").toUpperCase()) ? String(config.method ?? "GET").toUpperCase() : "GET";
    out.headers = cleanHeaders(config.headers);
    if (config.body != null) out.body = config.body;
    out.timeoutMs = clampInt(config.timeoutMs, 1_000, 15_000, 10_000);
    out.credentialId = cleanId(config.credentialId, "credentialId");
  } else if (type === "map") {
    // REQ-042 C: value admite objeto (un item), array literal o UN placeholder
    // {{steps.id.y}} que resuelva a array — el "split out" del builder. El
    // executor resuelve el placeholder (deepResolve de config) y envuelve el
    // array en { items } (igual que executeCodeNode) para que el downstream
    // itere item a item (copys en lote → N tools/frames).
    const raw = config.value;
    const isTemplateArray = typeof raw === "string" && /^\{\{\s*(steps|input|vars|static)\.[A-Za-z0-9_.-]+\s*\}\}$/.test(raw);
    if ((!raw || typeof raw !== "object") && !isTemplateArray) throw flowError("VALIDATION", "El nodo map necesita un objeto, array o placeholder {{steps.id.y}} en config.value.");
    out.value = raw;
  } else if (type === "condition") {
    if (!/^(input|steps|item)\.[A-Za-z0-9_.-]+$/.test(String(config.path ?? ""))) throw flowError("VALIDATION", "La condición necesita path con formato input.campo o steps.ID.campo.");
    out.path = String(config.path);
    if (!["equals", "not_equals", "contains", "exists", "not_empty", "greater_than", "less_than"].includes(config.operator ?? "equals")) {
      throw flowError("VALIDATION", "Operador de condición no válido.");
    }
    out.operator = config.operator ?? "equals";
    if (config.value !== undefined) out.value = config.value;
  } else if (type === "text") {
    if (typeof config.template !== "string" || !config.template.trim() || config.template.length > 20_000) {
      throw flowError("VALIDATION", "El nodo text necesita config.template (usa {{input.x}} / {{steps.id.y}}).");
    }
    out.template = config.template;
  } else if (type === "report") {
    if (config.title != null) out.title = String(config.title).slice(0, 120);
} else if (type === "preview") {
    // Vista previa: solo título decorativo — la config {} es válida.
    if (config.title != null) out.title = String(config.title).slice(0, 120);
  } else if (type === "switch") {
    if (!/^(input|steps|item)\.[A-Za-z0-9_.-]+$/.test(String(config.path ?? ""))) throw flowError("VALIDATION", "El switch necesita path con formato input.campo, steps.ID.campo o item.campo.");
    out.path = String(config.path);
    if (!Array.isArray(config.rules) || config.rules.length > 8) throw flowError("VALIDATION", "El switch admite hasta 8 reglas (config.rules).");
    const seen = new Set();
    out.rules = config.rules.map((rule) => {
      const label = String(rule?.label ?? "").trim();
      if (!label || label.length > 40 || !NODE_ID.test(label)) throw flowError("VALIDATION", "Cada regla del switch necesita label corto (letras/números/guiones).");
      if (label === "fallback" || seen.has(label)) throw flowError("VALIDATION", `Etiqueta de regla duplicada o reservada: ${label}.`);
      seen.add(label);
      const operator = ["equals", "contains", "greater_than", "less_than", "regex"].includes(rule?.operator) ? rule.operator : "equals";
      if (operator === "regex") { try { new RegExp(String(rule.value ?? "")); } catch { throw flowError("VALIDATION", `Regex inválida en la regla ${label}.`); } }
      return { label, operator, ...(rule?.value !== undefined ? { value: rule.value } : {}) };
    });
    out.fallback = config.fallback !== false;
  } else if (type === "loop") {
    out.batchSize = clampInt(config.batchSize, 1, 50, 5);
  } else if (type === "merge") {
    out.mode = config.mode === "byKey" ? "byKey" : "append";
    if (out.mode === "byKey") {
      const key = String(config.key ?? "").trim();
      if (!key || key.length > 60) throw flowError("VALIDATION", "El merge por clave necesita config.key (el campo compartido de los items).");
      out.key = key;
    }
  } else if (type === "wait") {
    out.seconds = clampInt(config.seconds, 1, LIMITS.maxWaitSeconds, 5);
  } else if (type === "subflow") {
    const flowId = String(config.flowId ?? "").trim();
    if (!FLOW_ID.test(flowId)) throw flowError("VALIDATION", "El nodo subflow necesita config.flowId con formato flow_... (flow_list para ver los ids).");
    out.flowId = flowId;
    if (config.inputs != null) {
      if (typeof config.inputs !== "object" || Array.isArray(config.inputs)) throw flowError("VALIDATION", "subflow.config.inputs debe ser un objeto.");
      if (Object.keys(config.inputs).length > 20) throw flowError("VALIDATION", "subflow admite hasta 20 inputs.");
      let inputsSize = 0;
      try { inputsSize = JSON.stringify(config.inputs).length; } catch { throw flowError("VALIDATION", "subflow.config.inputs no es serializable."); }
      if (inputsSize > 4_000) throw flowError("VALIDATION", "subflow.config.inputs demasiado grande (máx 4KB): usa placeholders {{input.x}}.");
      out.inputs = config.inputs;
    }
  } else if (type === "code") {
    const js = String(config.js ?? "");
    if (!js.trim() || js.length > LIMITS.codeMaxChars) throw flowError("VALIDATION", `El nodo code necesita config.js (máx ${LIMITS.codeMaxChars} caracteres). Variables: items, item, input, steps.`);
    out.js = js;
  } else if (type === "tool") {
    // Nodo tool (plan E2): llama cualquier tool MCP. El nombre se valida igual
    // que en ejecución; args admite placeholders {{input.x}} / {{steps.id}}.
    const toolName = String(config.tool ?? "").trim();
    if (!toolName && !allowIncomplete) throw flowError("VALIDATION", "El nodo tool necesita config.tool: nombre de una tool de la paleta (p. ej. list_social_inbox, get_html_frames).");
    if (toolName) {
      if (!/^[a-z0-9_]{1,60}$/.test(toolName)) throw flowError("VALIDATION", "El nombre del tool debe ser minúsculas, números o _ (máx 60).");
      if (toolName.startsWith("flow_")) throw flowError("VALIDATION", `Las tools flow_* no corren como nodo tool: usa el nodo Sub-flow (${toolName}).`);
      if (!(toolName in FLOW_TOOL_TIERS)) throw flowError("VALIDATION", `Tool no habilitada para flows: ${toolName}. Usa una tool de la paleta del editor (tiers P0-P2) o el nodo Sub-flow para otros flows.`);
      out.tool = toolName;
    }
    if (config.args != null) {
      if (typeof config.args !== "object" || Array.isArray(config.args)) throw flowError("VALIDATION", "El nodo tool necesita config.args como objeto (placeholders {{input.x}} / {{steps.id}}).");
      let argsSize = 0;
      try { argsSize = JSON.stringify(config.args).length; } catch { throw flowError("VALIDATION", "El nodo tool tiene config.args no serializable."); }
      if (argsSize > 4_000) throw flowError("VALIDATION", "El nodo tool tiene config.args demasiado grande (máx 4KB): usa placeholders {{item.x}}.");
      out.args = config.args;
    }
    // REQ-042 C: una llamada POR item del upstream (copys en lote → N
    // entradas de calendario). Máx maxItemsPerTemplateNode items por nodo.
    if (config.perItem === true) out.perItem = true;
  } else if (type === "wait_webhook" || type === "approval") {
    // Plan B5: pausan el run hasta flow_resume (callback webhook o aprobación
    // humana). El timeout caduca la espera; el message es el contexto para el
    // humano/agente que reanuda.
    if (config.message != null) out.message = String(config.message).slice(0, 500);
    out.timeoutMinutes = clampInt(config.timeoutMinutes, 1, 1440, 60);
  } else if (type === "compare") {
    // Plan C5: diff entre DOS fuentes (claves de joineo y qué lista alimenta
    // el output items). Los conteos viajan SIEMPRE en el output.
    const keys = Array.isArray(config.keys) ? config.keys.map((k) => String(k).trim()).filter(Boolean).slice(0, 3) : [];
    out.keys = keys.length ? keys : ["id"];
    out.mode = ["added", "removed", "changed", "all"].includes(config.mode) ? config.mode : "all";
  } else if (type === "sort" || type === "dedupe") {
    // F9: transformaciones de lista sin código. path opcional = campo del item.
    if (config.path != null) {
      const path = String(config.path).trim();
      if (path && !/^[A-Za-z0-9_.-]+$/.test(path)) throw flowError("VALIDATION", `${type}.config.path debe ser una ruta simple (p. ej. titulo o meta.autor).`);
      if (path) out.path = path;
    }
    if (type === "sort") out.dir = config.dir === "desc" ? "desc" : "asc";
  } else if (type === "limit") {
    out.max = clampInt(config.max, 1, LIMITS.maxItemsTransform, 10);
    out.keep = config.keep === "last" ? "last" : "first";
  } else if (type === "aggregate") {
    // fan-in puro: junta items de todas sus entradas (sin opciones).
  } else if (type === "agent") {
    // Plan E2: loop de tool-calling con nuestros tools MCP (protocolo JSON,
    // sin function-calling nativo). Misma credencial/proveedor que el nodo ai.
    const prompt = String(config.prompt ?? "");
    if (!prompt.trim() && !allowIncomplete) throw flowError("VALIDATION", "El nodo agent necesita config.prompt.");
    validateAiConfig({ ...config, prompt: prompt || "agent" });
    out.provider = config.provider;
    out.model = String(config.model ?? "").trim().slice(0, 120);
    out.prompt = prompt.slice(0, 8_000);
    if (config.systemPrompt != null) out.systemPrompt = String(config.systemPrompt).slice(0, 4_000);
    out.credentialId = cleanId(config.credentialId, "credentialId");
    if (!allowIncomplete && !out.credentialId) {
      throw flowError("VALIDATION", "El nodo agent necesita credentialId: crea una credencial con flow_credentials_set y selecciona su id.");
    }
    const tools = Array.isArray(config.tools) ? config.tools.map((t) => String(t).trim()).filter((t) => /^[a-z0-9_]{1,60}$/.test(t)).slice(0, 8) : [];
    if (tools.length) out.tools = tools;
    out.maxIterations = clampInt(config.maxIterations, 1, 8, 4);
    if (config.memory && typeof config.memory === "object" && config.memory.runs != null) out.memory = { runs: clampInt(config.memory.runs, 0, 10, 0) };
  } else if (type === "group") {
    // Plan A6: caja visual colapsable (como note, sin ejecución ni edges).
    // Los miembros son posicionales: nodos cuyo rect cae dentro del grupo.
    out.title = String(config.title ?? "Grupo").slice(0, 80);
    out.width = clampInt(config.width, 120, 4000, 420);
    out.height = clampInt(config.height, 80, 4000, 260);
    out.collapsed = config.collapsed === true;
  } else if (type === "note") {
    out.text = typeof config.text === "string" ? config.text.slice(0, 2_000) : "";
  }
  return out;
}

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function cleanId(value, what) {
  const id = String(value ?? "").trim();
  if (id && !NODE_ID.test(id)) throw flowError("VALIDATION", `${what} no es válido.`);
  return id || undefined;
}

const BLOCKED_HEADERS = /^(host|content-length|connection|cookie|authorization)$/i;
function cleanHeaders(raw) {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw flowError("VALIDATION", "headers debe ser un objeto.");
  const entries = Object.entries(raw);
  if (entries.length > 30) throw flowError("VALIDATION", "Máximo 30 headers.");
  const out = {};
  for (const [key, value] of entries) {
    if (!/^[A-Za-z0-9-]{1,80}$/.test(key) || BLOCKED_HEADERS.test(key)) throw flowError("VALIDATION", `Header no permitido: ${key}. Para autenticación usa credentialId.`);
    if (typeof value !== "string" || value.length > 2_000) throw flowError("VALIDATION", `Valor de header inválido: ${key}.`);
    out[key] = value;
  }
  return out;
}

function checkSecretsInConfig(node) {
  // Un agente nunca debe meter secretos planos en el grafo: van cifrados en
  // flow_credentials y se referencian por credentialId.
  const headers = node.config?.headers;
  if (headers && typeof headers === "object") {
    for (const key of Object.keys(headers)) {
      if (/authorization|api[-_]?key|token|secret|password/i.test(key)) {
        throw flowError("SECRET_IN_CONFIG", `No incluyas secretos en headers (${key}); crea una credencial con flow_credentials_set y usa credentialId.`);
      }
    }
  }
  for (const key of ["apiKey", "api_key", "secret", "password", "bearer"]) {
    if (node.config && node.config[key] != null) {
      throw flowError("SECRET_IN_CONFIG", `No incluyas ${key} en la config del nodo; usa una credencial (flow_credentials_set) y credentialId.`);
    }
  }
}

/** Valida y normaliza la definición de un flow (nodos + edges + trigger).
 *  Es LA validación que usa flow_save y flow_import — y los tests. */
export function validateFlowDefinition(raw, { enabled } = {}) {
  const flowEnabled = enabled ?? raw?.enabled === true;
  const allowIncomplete = !flowEnabled;
  const name = String(raw?.name ?? "").trim();
  if (!name || name.length > 80) throw flowError("VALIDATION", "El nombre del flow debe tener entre 1 y 80 caracteres.");
  const trigger = validateTrigger(raw?.trigger, { enabled: flowEnabled });
  if (!Array.isArray(raw?.nodes)) throw flowError("VALIDATION", "nodes debe ser una lista.");
  if (raw.nodes.length > LIMITS.nodesPerFlow) throw flowError("VALIDATION", `El flow admite hasta ${LIMITS.nodesPerFlow} nodos.`);
  if (flowEnabled && raw.nodes.length === 0) throw flowError("VALIDATION", "Un flow activo necesita al menos un nodo.");

  const nodeIds = new Set();
  const nodes = raw.nodes.map((node) => {
    if (!node || !NODE_ID.test(String(node.id ?? "")) || nodeIds.has(node.id)) throw flowError("VALIDATION", `ID de nodo inválido o duplicado: ${node?.id}.`);
    nodeIds.add(node.id);
    const type = String(node.type ?? "");
    if (!NODE_TYPES.includes(type)) throw flowError("VALIDATION", `Tipo de nodo no admitido: ${type}. Válidos: ${NODE_TYPES.join(", ")}.`);
    const config = normalizeNodeConfig(type, node.config, allowIncomplete);
    const normalized = {
      id: String(node.id),
      type,
      label: String(node.label ?? type).slice(0, 80),
      enabled: node.enabled !== false,
      onError: node.onError === "continue" || (type.startsWith("source_") && node.onError !== "stop") ? "continue" : "stop",
      // Reintentos automáticos (plan B1): 0 = sin retry; el engine aplica backoff.
      ...(Number(node.retry) > 0 ? { retry: clampInt(node.retry, 0, LIMITS.maxRetryPerNode, 0) } : {}),
      config,
      position: clampPosition(node.position),
    };
    if (type === "ai" || type === "agent") {
      // Re-valida por nodo para incluir el id en el mensaje.
      try { validateAiConfig({ ...config, prompt: config.prompt || "agent" }, normalized.id); } catch (error) { throw flowError("VALIDATION", error.message); }
    }
    checkSecretsInConfig(normalized);
    return normalized;
  });

  if (!Array.isArray(raw?.edges)) throw flowError("VALIDATION", "edges debe ser una lista.");
  if (raw.edges.length > LIMITS.edgesPerFlow) throw flowError("VALIDATION", `El flow admite hasta ${LIMITS.edgesPerFlow} conexiones.`);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  const edgeKeys = new Set();
  const edges = raw.edges.map((edge) => {
    const from = String(edge?.from ?? "");
    const to = String(edge?.to ?? "");
    if (!byId.has(from) || !byId.has(to) || from === to) throw flowError("VALIDATION", `Conexión inválida: ${from} → ${to}.`);
    if (byId.get(from).type === "note" || byId.get(to).type === "note" || byId.get(from).type === "group" || byId.get(to).type === "group") {
      throw flowError("VALIDATION", "Las notas y los grupos son solo visuales: no se conectan a nodos.");
    }
    const source = byId.get(from);
    if (edge.when !== undefined) {
      const when = String(edge.when);
      if (when === "error") {
        // Rama de error (plan B3): válida desde CUALQUIER nodo ejecutable.
      } else if (source.type === "condition") {
        if (!["true", "false"].includes(when)) throw flowError("VALIDATION", "Las rutas de un condition deben ser when:\"true\" o \"false\".");
      } else if (source.type === "switch") {
        const labels = new Set((source.config?.rules ?? []).map((rule) => rule.label));
        if (!labels.has(when) && when !== "fallback") {
          throw flowError("VALIDATION", `El switch ${from} no tiene una regla "${when}". Reglas: ${[...labels].join(", ") || "(ninguna)"}${source.config?.fallback !== false ? " + fallback" : ""}.`);
        }
      } else {
        throw flowError("VALIDATION", `El nodo ${from} (${source.type}) no usa rutas when; solo condition/switch, o when:"error".`);
      }
    }
    if (source.type === "condition" && edge.when !== "error") {
      const branches = outgoing.get(from).filter((existing) => existing.when !== "error").map((existing) => existing.when);
      if (!["true", "false"].includes(String(edge.when))) throw flowError("VALIDATION", "Cada salida de un condition debe indicar when: true o false.");
      if (branches.includes(String(edge.when))) throw flowError("VALIDATION", `La condición ${from} ya tiene una ruta ${edge.when}.`);
    }
    const key = `${from}>${to}:${edge.when ?? ""}`;
    if (edgeKeys.has(key)) throw flowError("VALIDATION", `Conexión duplicada: ${from} → ${to}.`);
    edgeKeys.add(key);
    const normalized = { from, to, ...(edge.when !== undefined ? { when: String(edge.when) } : {}) };
    incoming.set(to, incoming.get(to) + 1);
    outgoing.get(from).push(normalized);
    return normalized;
  });

  for (const node of nodes) {
    // Fan-in permitido SOLO en nodos que agregan: ai combina los items de
    // todas sus fuentes; report resume el run; merge/loop/code/compare
    // procesan varias entradas (plan Fase 2 + C5).
    if (!FAN_IN_TYPES.has(node.type) && incoming.get(node.id) > 1) {
      throw flowError("VALIDATION", `El nodo ${node.id} tiene varias conexiones entrantes; solo los nodos ai, report, merge, loop, code y compare combinan varias fuentes.`);
    }
  }
  // Aciclico + conectividad: todo nodo alcanzable desde alguna raíz.
  const visiting = new Set(); const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) throw flowError("VALIDATION", `El flow contiene un ciclo en ${id}.`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const edge of outgoing.get(id)) visit(edge.to);
    visiting.delete(id); visited.add(id);
  };
  for (const node of nodes) visit(node.id);
  if (flowEnabled) {
    // Raíces legítimas: fuentes Y map (inyectar constantes/input es su trabajo —
    // preset Testimonio y SEO empiezan con map). Subflow también: sus inputs
    // vienen en config. Lo demás debe recibir datos. Las notas no se ejecutan.
    // Excepción trigger "error": su input LO INYECTA el evento (spawnErrorWorkflow
    // manda __fromError/flowId/failedNode); sus raíces no necesitan arista.
    const eventFed = trigger?.type === "error";
    for (const node of nodes) {
      if (node.type === "note") continue;
      if (!eventFed && !SOURCE_TYPES.has(node.type) && node.type !== "map" && node.type !== "subflow" && incoming.get(node.id) === 0) {
        throw flowError("VALIDATION", `El nodo ${node.id} no recibe nada: conecta una fuente o márcalo enabled:false.`);
      }
    }
  }

  // Tags (plan D1): etiquetas libres para filtrar en el board. Se llevan en la
  // definición para que flow_save las persista sin cambiar el contrato.
  const tags = Array.isArray(raw?.tags)
    ? raw.tags.map((tag) => String(tag).trim().slice(0, 24)).filter(Boolean).slice(0, 10)
    : [];
  // Variables del flow (plan B10): constantes que los nodos leen como
  // {{vars.nombre}} — mismas que $vars de n8n, pero por flow. Escalares
  // (string/number/boolean/null), máx 20, clave [A-Za-z0-9_]{1,40}.
  const varsIn = raw?.vars && typeof raw.vars === "object" && !Array.isArray(raw.vars) ? raw.vars : {};
  const varEntries = Object.entries(varsIn).slice(0, 20);
  for (const [key, value] of varEntries) {
    if (!/^[A-Za-z0-9_]{1,40}$/.test(key)) throw flowError("VALIDATION", `Variable inválida: ${key} (usa letras, números o _, máx 40).`);
    if (!["string", "number", "boolean"].includes(typeof value) && value !== null) throw flowError("VALIDATION", `El valor de la variable ${key} debe ser texto, número o booleano (los objetos van en nodos map).`);
  }
  const vars = Object.fromEntries(varEntries);
  // Inputs declarados (Flows-brand): el contrato del run — defaults + required
  // los aplica executeFlow sobre el payload {{input.x}}.
  const inputs = normalizeFlowInputs(raw?.inputs);

  return {
    name,
    enabled: flowEnabled,
    trigger: flowEnabled && !trigger ? { type: "manual" } : trigger,
    nodes,
    edges,
    tags,
    vars,
    inputs,
    // Plan D4-lite: bandera de edición congelada (solo admin edita/desbloquea).
    locked: raw?.locked === true ? true : raw?.locked === false ? false : undefined,
  };
}

/** Flows-brand: receta de diseño inline del nodo template — el frame viaja EN
 *  la definición (como las recetas de copy) en vez de vivir en un archivo.
 *  Así los presets de la biblioteca llegan VIVOS sin depender de que cada
 *  workspace tenga la plantilla, y el humano la reemplaza luego por SU
 *  templateId+frameId cuando diseña la pieza propia. */
function normalizeTemplateRecipe(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw flowError("VALIDATION", "template.config.recipe debe ser un objeto {width, height, html, css}.");
  const width = Math.round(Number(raw.width));
  const height = Math.round(Number(raw.height));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 320 || height < 320 || width > 8_000 || height > 8_000) {
    throw flowError("VALIDATION", "template.config.recipe necesita width y height válidos (320-8000 px).");
  }
  const html = String(raw.html ?? "");
  const css = String(raw.css ?? "");
  if (!html.trim()) throw flowError("VALIDATION", "template.config.recipe necesita html.");
  if (html.length > 64_000) throw flowError("VALIDATION", "template.config.recipe.html demasiado grande (máx 64KB).");
  if (css.length > 16_000) throw flowError("VALIDATION", "template.config.recipe.css demasiado grande (máx 16KB).");
  return { width, height, html, css, ...(typeof raw.background === "string" && raw.background.trim() ? { background: raw.background.slice(0, 200) } : {}) };
}

/** Flows-brand: normaliza config.extraValues del nodo template — record plano
 *  de escalares para tokens {{token}} del frame. Claves token-safe, máx 16,
 *  valores ≤2000 chars (deepResolve ya resolvió {{input.x}}/{{vars.y}}). */
function normalizeExtraValues(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw flowError("VALIDATION", "template.config.extraValues debe ser un objeto de valores escalares.");
  const out = {};
  for (const [key, value] of Object.entries(raw).slice(0, 16)) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_-]{0,39}$/.test(key)) throw flowError("VALIDATION", `template.config.extraValues: clave inválida "${key}" (usa letras, números, _ o -; máx 40).`);
    if (value == null || typeof value === "object") continue;
    const text = String(value).slice(0, 2_000);
    if (text.trim()) out[key] = text;
  }
  return Object.keys(out).length ? out : null;
}

/** Flows-brand: inputs declarados del flow — el mini-formulario que el editor
 *  muestra antes de correr. Máx 12 campos; key token-safe; type acotado;
 *  default escalar ≤500 chars. executeFlow aplica defaults y exige required. */
function normalizeFlowInputs(raw) {
  if (raw == null || raw === "") return [];
  if (!Array.isArray(raw)) throw flowError("VALIDATION", "flow.inputs debe ser una lista de campos {key, label?, type?, required?, default?}.");
  if (raw.length > 12) throw flowError("VALIDATION", "flow.inputs admite hasta 12 campos.");
  const out = [];
  for (const field of raw) {
    const key = String(field?.key ?? "").trim();
    if (!/^[a-zA-Z_][a-zA-Z0-9_-]{0,39}$/.test(key)) throw flowError("VALIDATION", `flow.inputs: key inválida "${key}" (letras, números, _ o -; máx 40).`);
    if (out.some((existing) => existing.key === key)) throw flowError("VALIDATION", `flow.inputs: key duplicada "${key}".`);
    const entry = {
      key,
      label: String(field?.label ?? key).trim().slice(0, 80),
      type: ["text", "textarea", "number", "date"].includes(field?.type) ? field.type : "text",
      required: field?.required === true,
    };
    if (field?.default != null && typeof field.default !== "object" && String(field.default).trim() !== "") entry.default = String(field.default).slice(0, 500);
    out.push(entry);
  }
  return out;
}

/** Validación para guardar: además de la definición, respeta el cap por
 *  workspace y produce la fila completa (id, created_by, timestamps). */
export function prepareFlowRow({ id, workspaceId, definition, previous, createdBy }) {
  if (id !== undefined && id !== null && !FLOW_ID.test(String(id))) throw flowError("VALIDATION", "El id del flow no es válido (flow_...).");
  // Versiones de edición (plan D2): snapshot del estado ANTERIOR en cada save,
  // acotado a LIMITS.maxVersionsPerFlow. La columna degrada con gracia si la
  // migración v63 aún no está aplicada (updateFlow/insertFlow la descartan).
  const versions = previous
    ? [...(Array.isArray(previous.versions) ? previous.versions : []), {
        at: previous.updated_at ?? new Date().toISOString(),
        name: previous.name,
        enabled: previous.enabled,
        trigger: previous.trigger,
        nodes: previous.nodes,
        edges: previous.edges,
      }].slice(-LIMITS.maxVersionsPerFlow)
    : [];
  const row = {
    id: id || `flow_${cryptoRandom12()}`,
    workspace_id: workspaceId,
    name: definition.name,
    enabled: definition.enabled,
    trigger: definition.trigger,
    nodes: definition.nodes,
    edges: definition.edges,
    tags: Array.isArray(definition.tags) ? definition.tags : [],
    vars: definition.vars && typeof definition.vars === "object" ? definition.vars : {},
    inputs: Array.isArray(definition.inputs) ? definition.inputs : [],
    locked: definition.locked != null ? definition.locked : previous?.locked === true,
    versions,
    created_by: createdBy ?? previous?.created_by ?? "user",
  };
  return row;
}

// Exportado: flows-runtime y flow_credentials_set generan ids con el mismo
// formato que los ids de flow/run.
export function cryptoRandom12() {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12);
}

// ── Export/import (portabilidad sin credenciales) ───────────────────────────

export function exportShape(flow) {
  return {
    version: 1,
    name: flow.name,
    trigger: flow.trigger ?? null,
    nodes: flow.nodes ?? [],
    edges: flow.edges ?? [],
    // Flows-brand: los inputs declarados viajan con el export (portales).
    inputs: Array.isArray(flow.inputs) ? flow.inputs : [],
  };
}

export function stripCredentialRefs(nodes) {
  return (nodes ?? []).map((node) => {
    if (node?.config && "credentialId" in node.config) {
      const { credentialId: _removed, ...config } = node.config;
      return { ...node, config, _note: "credentialId removido por export: asígnalo tras importar" };
    }
    return node;
  });
}

// ── Storage (Supabase; sb = cliente admin inyectado) ────────────────────────

export function createFlowsStore(sb) {
  if (!sb) throw flowError("CONFIG", "Supabase no está configurado.");
  const clean = (error, what) => { throw flowError("STORAGE", `${what}: ${error?.message ?? String(error)}`); };

  async function listFlows(workspaceId) {
    const { data, error } = await sb.from("flows").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false });
    if (error) clean(error, "flow_list");
    return data ?? [];
  }
  async function countFlows(workspaceId) {
    const { count, error } = await sb.from("flows").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
    if (error) clean(error, "flow_count");
    return count ?? 0;
  }
  async function getFlow(id, workspaceId) {
    let query = sb.from("flows").select("*").eq("id", id);
    if (workspaceId) query = query.eq("workspace_id", workspaceId);
    const { data, error } = await query.maybeSingle();
    if (error) clean(error, "flow_get");
    return data ?? null;
  }
  // Columnas opcionales (tags/versions/vars, migración v63): si aún no existen en
  // la tabla, el insert/update con ellas falla — se reintenta SIN ellas para
  // que guardar un flow jamás se rompa por la migración pendiente.
  const OPTIONAL_COLUMNS = ["tags", "versions", "vars", "locked", "inputs"];
  function stripOptionals(row) {
    const out = { ...row };
    for (const key of OPTIONAL_COLUMNS) delete out[key];
    return out;
  }
  async function insertFlow(row) {
    let result = await sb.from("flows").insert(row).select().single();
    if (result.error && OPTIONAL_COLUMNS.some((key) => row[key] != null)) {
      result = await sb.from("flows").insert(stripOptionals(row)).select().single();
    }
    const { data, error } = result;
    if (error) clean(error, "flow_save(insert)");
    return data;
  }
  async function updateFlow(id, workspaceId, patch) {
    let result = await sb.from("flows").update(patch).eq("id", id).eq("workspace_id", workspaceId).select().single();
    if (result.error && OPTIONAL_COLUMNS.some((key) => patch[key] != null)) {
      result = await sb.from("flows").update(stripOptionals(patch)).eq("id", id).eq("workspace_id", workspaceId).select().single();
    }
    const { data, error } = result;
    if (error) clean(error, "flow_save(update)");
    return data;
  }
  async function deleteFlow(id, workspaceId) {
    const { error } = await sb.from("flows").delete().eq("id", id).eq("workspace_id", workspaceId);
    if (error) clean(error, "flow_delete");
  }

  async function insertRun(row) {
    const { data, error } = await sb.from("flow_runs").insert(row).select().single();
    if (error) clean(error, "flow_run(insert)");
    return data;
  }
  async function updateRun(id, patch) {
    const { error } = await sb.from("flow_runs").update(patch).eq("id", id);
    if (error) clean(error, "flow_run(update)");
  }
  async function getRun(id) {
    const { data, error } = await sb.from("flow_runs").select("*").eq("id", id).maybeSingle();
    if (error) clean(error, "flow_run(get)");
    return data ?? null;
  }
  async function findRunByRequestId(flowId, requestId) {
    if (!requestId) return null;
    const { data, error } = await sb.from("flow_runs").select("*").eq("flow_id", flowId).eq("request_id", requestId).limit(1).maybeSingle();
    if (error) return null;
    return data ?? null;
  }
  // F2: static_data persistente entre runs (columna v66). Lectura directa;
  // escritura merge-superficial read-merge-write (freemium, sin RPC atómica).
  async function getStaticData(flowId, workspaceId) {
    const { data, error } = await sb.from("flows").select("static_data").eq("id", flowId).eq("workspace_id", workspaceId).maybeSingle();
    if (error) return {};
    return data?.static_data && typeof data.static_data === "object" && !Array.isArray(data.static_data) ? data.static_data : {};
  }
  async function mergeStaticData(flowId, workspaceId, patch) {
    const current = await getStaticData(flowId, workspaceId);
    const next = { ...current, ...patch };
    const { error } = await sb.from("flows").update({ static_data: next }).eq("id", flowId).eq("workspace_id", workspaceId);
    if (error) clean(error, "flow(static_data)");
    return next;
  }
  async function findRunByResumeToken(token, workspaceId) {
    // B5: lookup del run pausado por token (columna v64, indexada). El token es
    // la capability (rw_ + 12 aleatorios): workspaceId es OPCIONAL — si viene,
    // afina el scope; si no, el run row trae workspace_id para el resto.
    if (!token) return null;
    let query = sb.from("flow_runs").select("*").eq("resume_token", token).limit(1);
    if (workspaceId) query = query.eq("workspace_id", workspaceId);
    const { data, error } = await query.maybeSingle();
    if (error) return null;
    return data ?? null;
  }
  async function listRuns(workspaceId, { flowId, status, limit = 30 } = {}) {
    let query = sb.from("flow_runs").select("*").eq("workspace_id", workspaceId).order("started_at", { ascending: false }).limit(Math.max(1, Math.min(Number(limit) || 30, LIMITS.historyLimit)));
    if (flowId) query = query.eq("flow_id", flowId);
    // REQ-040: filtro por estado ("waiting" es el caso de uso — el fallback
    // barato del wake: 1 llamada lista solo los runs que piden acción).
    if (status) query = query.eq("status", String(status));
    const { data, error } = await query;
    if (error) clean(error, "flow_history");
    return data ?? [];
  }
  async function countRunningRuns(workspaceId) {
    const { count, error } = await sb.from("flow_runs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "running");
    if (error) return 0;
    return count ?? 0;
  }
  /** Runs "running" viejos = invocaciones que murieron (timeout de Worker).
   *  Se reconcilian perezosamente al leer/lanzar — sin cron. */
  async function reconcileStaleRuns(workspaceId, { staleMs = LIMITS.runTimeoutMs + 65_000 } = {}) {
    const cutoff = new Date(Date.now() - staleMs).toISOString();
    const { error } = await sb.from("flow_runs")
      .update({ status: "failed", error: "timeout: la ejecución no terminó dentro del presupuesto", finished_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId).eq("status", "running").lt("started_at", cutoff);
    return !error;
  }
  async function pruneRuns(flowId, keep = 200) {
    try {
      await sb.rpc("prune_flow_runs", { p_flow_id: flowId, p_keep: keep });
    } catch { /* best-effort: sin RPC instalado, el prune no bloquea */ }
  }

  // ── Rate cap + consultas del scheduler del agente (flow_due_check) ──
  async function countRunsSince(flowId, sinceIso) {
    const { count, error } = await sb.from("flow_runs").select("id", { count: "exact", head: true }).eq("flow_id", flowId).gte("started_at", sinceIso);
    if (error) return 0;
    return count ?? 0;
  }
  async function latestRun(flowId) {
    const { data, error } = await sb.from("flow_runs").select("id, status, started_at").eq("flow_id", flowId).order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (error) return null;
    return data ?? null;
  }

  async function listCredentials(workspaceId) {
    const { data, error } = await sb.from("flow_credentials").select("id, name, type, provider, model, header_name, username, last4, updated_at")
      .eq("workspace_id", workspaceId).order("updated_at", { ascending: false });
    if (error) clean(error, "flow_credentials(list)");
    return data ?? [];
  }
  async function getCredential(id, workspaceId) {
    // workspaceId null = lookup sin tenant (authorizeMcpCall resuelve el
    // workspace DESDE la credencial; el filtro entra después del resolve).
    let query = sb.from("flow_credentials").select("*").eq("id", id);
    if (workspaceId) query = query.eq("workspace_id", workspaceId);
    const { data, error } = await query.maybeSingle();
    if (error) clean(error, "flow_credentials(get)");
    return data ?? null;
  }
  async function upsertCredential(row) {
    const first = await sb.from("flow_credentials").upsert(row, { onConflict: "workspace_id,name" }).select().single();
    // F6: si la migración v67 (oauth_config/oauth_tokens) aún no se aplicó,
    // reintenta sin esas columnas en vez de romper el guardado de credenciales.
    if (first.error && /oauth_(config|tokens)/i.test(first.error.message || "")) {
      const { oauth_config: _oc, oauth_tokens: _ot, ...rest } = row;
      const retry = await sb.from("flow_credentials").upsert(rest, { onConflict: "workspace_id,name" }).select().single();
      if (retry.error) clean(retry.error, "flow_credentials(set)");
      return { ...retry.data, _oauthMigrationPending: true };
    }
    if (first.error) clean(first.error, "flow_credentials(set)");
    return first.data;
  }
  async function updateCredentialTokens(id, oauthTokensCrypted) {
    const { error } = await sb.from("flow_credentials").update({ oauth_tokens: oauthTokensCrypted }).eq("id", id);
    if (error) clean(error, "flow_credentials(tokens)");
  }
  async function deleteCredential(id, workspaceId) {
    const { data, error } = await sb.from("flow_credentials").delete().eq("id", id).eq("workspace_id", workspaceId).select("id").single();
    if (error) clean(error, "flow_credentials(delete)");
    return data;
  }

  return { listFlows, countFlows, getFlow, insertFlow, updateFlow, deleteFlow, insertRun, updateRun, getRun, findRunByRequestId, findRunByResumeToken, listRuns, countRunningRuns, reconcileStaleRuns, pruneRuns, countRunsSince, latestRun, listCredentials, getCredential, upsertCredential, deleteCredential, getStaticData, mergeStaticData, updateCredentialTokens };
}

// ── Runtime: executeFlow ────────────────────────────────────────────────────

function truncateOutput(value, max = LIMITS.stepOutputChars) {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text == null ? null : `${text.slice(0, max)}${text.length > max ? "…(truncado)" : ""}`;
  } catch {
    return null;
  }
}

/** Salida/entrada de step para el editor e historial: los valores chicos van
 *  TAL CUAL (objetos navegables en el visor JSON del Historial); solo los que
 *  no caben en el presupuesto se truncan a texto. */
/** F1: parsea el schema del nodo ai (string JSON u objeto) a objeto; null si
 *  ausente. La validación fuerte ocurre en flow_save; aquí es defensa. */
function parseSchemaConfig(raw) {
  if (raw == null || raw === "") return null;
  const schema = typeof raw === "string" ? safeJsonParse(raw) : raw;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw flowError("VALIDATION", "ai.config.schema debe ser un JSON Schema objeto.");
  }
  return schema;
}

/** F1: validador JSON Schema acotado (type/enum/properties/required/items).
 *  Devuelve errores legibles (estilo n8n Output Parser, sin dependencias). */
function validateAgainstSchema(value, schema, path = "raíz") {
  const errors = [];
  if (!schema || typeof schema !== "object") return errors;
  const typeOf = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);
  if (schema.type != null) {
    const wanted = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = wanted.some((t) => {
      if (t === "object") return typeOf(value) === "object" && !Array.isArray(value);
      if (t === "array") return Array.isArray(value);
      if (t === "integer") return Number.isInteger(value);
      return typeOf(value) === t;
    });
    if (!ok) { errors.push(`${path} debe ser ${wanted.join("|")} (es ${typeOf(value)})`); return errors; }
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((opt) => JSON.stringify(opt) === JSON.stringify(value))) {
    errors.push(`${path} debe ser uno de: ${schema.enum.slice(0, 5).map((o) => JSON.stringify(o)).join(", ")}`);
  }
  if (typeOf(value) === "object" && schema.properties && typeof schema.properties === "object") {
    for (const req of Array.isArray(schema.required) ? schema.required : []) {
      if (value[req] === undefined) errors.push(`${path}.${req} es requerido`);
    }
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (value[key] !== undefined && sub && typeof sub === "object") errors.push(...validateAgainstSchema(value[key], sub, `${path}.${key}`));
    }
  }
  if (Array.isArray(value) && schema.items && typeof schema.items === "object") {
    value.forEach((item, i) => errors.push(...validateAgainstSchema(item, schema.items, `${path}[${i}]`)));
  }
  return errors.slice(0, 20);
}

function stepOutputValue(value, max = LIMITS.stepOutputChars) {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (text != null && text.length <= max) return value;
  } catch { /* cae al truncado */ }
  return truncateOutput(value, max);
}

function stepSummary(record) {
  return {
    nodeId: record.nodeId, label: record.label, type: record.type,
    ok: record.ok, ms: record.ms,
    ...(record.pinned ? { pinned: true } : {}),
    ...(record.input !== undefined ? { input: record.input } : {}),
    ...(record.output !== undefined ? { output: record.output } : {}),
    ...(record.error ? { error: record.error } : {}),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}

function ruleMatches(left, rule) {
  const right = rule?.value;
  switch (rule?.operator) {
    case "contains": return String(left ?? "").includes(String(right ?? ""));
    case "greater_than": return Number(left) > Number(right);
    case "less_than": return Number(left) < Number(right);
    case "regex": { try { return new RegExp(String(right ?? "")).test(String(left ?? "")); } catch { return false; } }
    default: return left === right;
  }
}

/** Items de las entradas del nodo. Fan-in (solo nodos ai): los items de TODAS
 *  las aristas entrantes se concatenan en orden de declaración. */
function upstreamOutput(nodeId, edges, steps) {
  const items = [];
  for (const edge of edges) {
    if (edge.to !== nodeId) continue;
    const output = steps[edge.from];
    if (output == null) continue;
    if (Array.isArray(output?.items)) items.push(...output.items);
    else items.push(output);
  }
  return { items };
}

function resolveItems(raw, max) {
  const items = Array.isArray(raw?.items) ? raw.items : raw != null ? [raw] : [];
  return items.slice(0, max);
}

// Nodo preview: acota la VISTA para la UI/Historial — el passthrough aguas
// abajo conserva la salida completa (mismos límites que cualquier nodo).
const PREVIEW_MAX_CHARS = 4_000;
const PREVIEW_MAX_ITEMS = 12;
function previewOutput(upstream, title) {
  const t = typeof title === "string" && title.trim() ? title.trim().slice(0, 120) : null;
  if (upstream == null) return { view: { kind: "empty" }, title: t };
  const base = typeof upstream.text === "string" ? { text: upstream.text }
    : Array.isArray(upstream.items) ? { items: upstream.items } : upstream;
  const view = typeof base.text === "string"
    ? { kind: "text", text: base.text.slice(0, PREVIEW_MAX_CHARS), truncated: base.text.length > PREVIEW_MAX_CHARS }
    : Array.isArray(base.items)
      ? { kind: "items", count: base.items.length, items: base.items.slice(0, PREVIEW_MAX_ITEMS) }
      : (() => {
          let json = "";
          try { json = JSON.stringify(base); } catch { json = String(base); }
          return { kind: "json", json: json.slice(0, PREVIEW_MAX_CHARS), truncated: json.length > PREVIEW_MAX_CHARS };
        })();
  return { ...base, view, title: t };
}

/** Ejecuta el flow (nodos habilitados). Deps inyectadas:
 *  - callTool(name, args): herramientas internas de Musa (template/subflow node)
 *  - getCredential(workspaceId, id): credencial descifrada o null
 *  - resolveTemplateWorkspace(templateId): workspace del template o null
 *  - resolveDns: opcional (Node dev); en Workers no se pasa
 *  - onStep(step): persistencia incremental del step
 *  Devuelve {status, steps, error, outputs}.
 *  Paridad n8n (FLOW_BUILDER_GAP_VS_N8N): input.__pins congela salidas
 *  (B7); retry por nodo (B1); rama when:"error" (B3); loop por lotes (C2). */
export async function executeFlow(flow, input, deps) {
  const { callTool, getCredential, resolveTemplateWorkspace, resolveDns, onStep, workspaceId, deadline = Date.now() + LIMITS.runTimeoutMs, now = () => new Date().toISOString(), resume = null, runAiText: aiText = null, oauth2Token = null } = deps;
  // Nodo tool (plan picker): presupuesto de llamadas y dedupe de escrituras por run.
  const toolState = { calls: 0, seen: new Set() };
  // Data pinning (B7): el editor manda flow_run con input.__pins = { nodeId: salida }.
  const pins = input && typeof input === "object" && !Array.isArray(input) ? (input.__pins ?? null) : null;
  // Las notas y los grupos son solo visuales: el run los ignora igual que los deshabilitados.
  const nodes = (flow.nodes ?? []).filter((node) => node.enabled !== false && node.type !== "note" && node.type !== "group");
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = flow.edges ?? [];
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (outgoing.has(edge.from)) outgoing.get(edge.from).push(edge);
  }
  const incomingCount = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    if (incomingCount.has(edge.to)) incomingCount.set(edge.to, incomingCount.get(edge.to) + 1);
  }
  // Inputs declarados (Flows-brand): defaults sobre el payload {{input.x}} y
  // required exigidos ANTES de ejecutar nada — mismo contrato para runs
  // manuales, schedule y webhook. El payload manda sobre el default.
  const declared = Array.isArray(flow.inputs) ? flow.inputs : [];
  if (declared.length) {
    const payload = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const missing = [];
    const defaults = {};
    for (const field of declared) {
      const value = payload[field.key] ?? field.default;
      if (field.required && (value == null || String(value).trim() === "")) missing.push(field.label || field.key);
      if (value != null && String(value) !== "") defaults[field.key] = value;
    }
    if (missing.length) throw flowError("INPUT_REQUIRED", `Faltan inputs del flow: ${missing.join(", ")}.`);
    input = { ...defaults, ...payload };
  }
  // F2: static_data del flow (storage persistente entre runs, migración v66)
  // expuesto a los templates como {{static.campo}} — el "static data" de n8n.
  const context = { input: input ?? {}, steps: {}, vars: flow.vars ?? {}, static: flow.static_data && typeof flow.static_data === "object" && !Array.isArray(flow.static_data) ? flow.static_data : {} };
  const steps = [];
  let failed = 0;

  /** Rama de un nodo según su salida (para filtrar edges con when). */
  const branchOf = (node, output) => node.type === "condition" ? String(output?.passed === true)
    : node.type === "switch" ? (output?.matched ?? undefined)
    : undefined;
  const errorEdgesOf = (id) => (outgoing.get(id) ?? []).filter((edge) => edge.when === "error");

  /** Ejecuta UN nodo con retry (B1) y pinning (B7). ctx permite contextos
   *  aislados (el loop corre sus lotes en sub-contextos). */
  async function execOne(node, ctx) {
    const startedAt = now();
    const record = { nodeId: node.id, label: node.label, type: node.type, ok: false, startedAt, ms: 0 };
    // Datos de entrada del nodo (B6): quedan en el step para depurar desde el editor.
    try { record.input = stepOutputValue(upstreamOutput(node.id, edges, ctx.steps)); } catch { /* noop */ }
    const attempts = 1 + (Number(node.retry) > 0 ? Math.min(LIMITS.maxRetryPerNode, Math.floor(Number(node.retry))) : 0);
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        if (Date.now() > deadline) throw flowError("TIMEOUT", `La ejecución superó el presupuesto de ${Math.round(LIMITS.runTimeoutMs / 1000)}s; divide el trabajo en varias flow_run (batches de ≤3).`);
        let output;
        const pin = pins && Object.prototype.hasOwnProperty.call(pins, node.id) ? pins[node.id] : undefined;
        if (pin !== undefined) {
          output = typeof pin === "string" ? (safeJsonParse(pin) ?? pin) : pin;
          record.pinned = true;
        } else {
          output = await executeNode(node, ctx, { callTool, getCredential, resolveTemplateWorkspace, resolveDns, oauth2Token, workspaceId, deadline, flowName: flow.name, flowId: flow.id, edges, runAiText: aiText, toolState });
        }
        // B5: los nodos de espera devuelven un marker __pause — NO se guardan
        // como salida; el walk corta y executeFlow devuelve status:"waiting".
        if (output && typeof output === "object" && output.__pause) {
          record.ok = true;
          record.ms = Date.now() - Date.parse(startedAt);
          record.paused = true;
          return { record, paused: true, pauseInfo: { kind: output.kind, timeoutMinutes: output.timeoutMinutes, message: output.message } };
        }
        ctx.steps[node.id] = output;
        record.raw = output;
        record.output = stepOutputValue(output);
        record.ok = true;
        record.ms = Date.now() - Date.parse(startedAt);
        return { record, branchWhen: branchOf(node, output) };
      } catch (error) {
        record.ok = false;
        record.ms = Date.now() - Date.parse(startedAt);
        record.error = { code: error?.flowCode ?? "NODE_ERROR", message: String(error?.message ?? error).slice(0, 1_000) };
        if (attempt < attempts && Date.now() < deadline) await sleep(Math.min(1_000, 250 * attempt));
      }
    }
    return { record, failed: true };
  }

  /** Sub-walk aislado (loop C2): corre la descendencia de un nodo con un
   *  contexto propio donde steps[loopId] = { items: lote }. Devuelve los
   *  outputs de los nodos terminales de la rama. */
  async function walkFrom(seedIds, items, loopNodeId) {
    const ctx = { input: context.input, steps: { [loopNodeId]: { items } } };
    const q = [...seedIds];
    const done = new Set();
    const terminal = [];
    while (q.length) {
      const id = q.shift();
      if (id == null || done.has(id) || !byId.has(id)) continue;
      done.add(id);
      const node = byId.get(id);
      if (node.type === "loop") throw flowError("NODE_ERROR", "No anides un loop directo bajo otro loop (un nivel por run).");
      const { record, branchWhen, failed: nodeFailed, paused } = await execOne(node, ctx);
      if (paused) {
        // B5 v1: pausar DENTRO de un loop requeriría persistir el sub-contexto
        // por lote; fuera de alcance — error claro en vez de estado corrupto.
        record.output = { waiting: true, kind: "loop", message: "no soportado dentro de loop" };
        steps.push(stepSummary(record));
        throw flowError("WAIT_IN_LOOP", "wait_webhook/approval dentro de un loop no está soportado (v1): sácalo del loop.");
      }
      steps.push(stepSummary(record));
      if (onStep) await onStep(steps[steps.length - 1]);
      if (nodeFailed) {
        const errEdges = errorEdgesOf(node.id);
        if (errEdges.length) { for (const e of errEdges) q.push(e.to); continue; }
        if (node.onError === "continue") {
          for (const e of outgoing.get(node.id) ?? []) { if (e.when !== "error") q.push(e.to); }
          continue;
        }
        throw flowError("BRANCH_FAILED", `el lote falló en ${node.id} (${record.error?.code}: ${record.error?.message})`);
      }
      const nexts = (outgoing.get(node.id) ?? []).filter((edge) => {
        if (edge.when === "error") return false;
        if (branchWhen !== undefined) return edge.when === branchWhen;
        return true;
      });
      if (!nexts.length) terminal.push({ nodeId: node.id, output: ctx.steps[node.id] });
      for (const e of nexts) q.push(e.to);
    }
    return terminal;
  }

  // Orden de ejecución (plan C6, contrato documentado): BFS con cola FIFO —
  // raíces ordenadas por posición (y, luego x); cada nodo encola sus hijos en
  // el orden declarado de las aristas. La primera rama declarada corre primero.
  const queue = [];
  const completed = new Set();
  if (resume?.state) {
    // B5: continúa un run pausado — restaura pasos/cola y ENCiende la salida
    // del nodo de espera con el payload recibido (webhook o aprobación).
    if (resume.expiresAt && Date.now() > Date.parse(resume.expiresAt)) throw flowError("WAIT_EXPIRED", "WAIT_EXPIRED: la espera venció; vuelve a lanzar el flow con flow_run.");
    Object.assign(context.steps, resume.state.steps ?? {});
    if (resume.state.input && typeof resume.state.input === "object") context.input = resume.state.input;
    for (const id of resume.state.completed ?? []) completed.add(id);
    queue.push(...(resume.state.queue ?? []));
    if (resume.state.waitingNodeId) {
      context.steps[resume.state.waitingNodeId] = waitOutput(resume.state.kind, resume.payload);
      // El paso de espera pertenece al MISMO run: síntetiza su step (no se
      // re-ejecuta; output = payload/decisión) para el historial reanudado.
      const waitNode = byId.get(resume.state.waitingNodeId);
      if (waitNode) {
        const restored = { nodeId: waitNode.id, label: waitNode.label, type: waitNode.type, ok: true, ms: 0, output: context.steps[waitNode.id] };
        steps.push(stepSummary(restored));
        if (onStep) await onStep(steps[steps.length - 1]);
      }
    }
  } else {
    const roots = nodes.filter((node) => incomingCount.get(node.id) === 0)
      .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0) || (a.position?.x ?? 0) - (b.position?.x ?? 0))
      .map((node) => node.id);
    queue.push(...roots);
  }

  while (queue.length) {
    const id = queue.shift();
    if (id == null || completed.has(id) || !byId.has(id)) continue;
    completed.add(id);
    const node = byId.get(id);

    // Loop (C2): parte los items en lotes y corre la descendencia aislada
    // por lote; agrega los outputs terminales de cada pasada.
    if (node.type === "loop") {
      const startedAt = now();
      const record = { nodeId: node.id, label: node.label, type: node.type, ok: false, startedAt, ms: 0 };
      try {
        if (Date.now() > deadline) throw flowError("TIMEOUT", `La ejecución superó el presupuesto de ${Math.round(LIMITS.runTimeoutMs / 1000)}s.`);
        const upstream = upstreamOutput(node.id, edges, context.steps);
        const items = Array.isArray(upstream.items) ? upstream.items : upstream.items != null ? [upstream.items] : [];
        const size = Math.max(1, Number(node.config?.batchSize) || 5);
        const batches = [];
        for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
        if (!batches.length) batches.push([]);
        const successors = (outgoing.get(node.id) ?? []).filter((e) => e.when !== "error").map((e) => e.to);
        const aggregate = [];
        for (const batch of batches) {
          if (Date.now() > deadline) throw flowError("TIMEOUT", "El run superó el presupuesto procesando los lotes del loop.");
          const terminal = await walkFrom(successors, batch, node.id);
          aggregate.push(...terminal.map((t) => t.output));
        }
        const output = { items: aggregate, batches: batches.length, processed: items.length };
        context.steps[node.id] = output;
        record.raw = output;
        record.output = stepOutputValue(output);
        record.ok = true;
        record.ms = Date.now() - Date.parse(startedAt);
        steps.push(stepSummary(record));
        if (onStep) await onStep(steps[steps.length - 1]);
        // Los sucesores ya corrieron DENTRO de walkFrom (una vez por lote):
        // re-encolarlos aquí duplicaría pasos; el agregado queda en este step.
      } catch (error) {
        record.ok = false;
        record.ms = Date.now() - Date.parse(startedAt);
        record.error = { code: error?.flowCode ?? "NODE_ERROR", message: String(error?.message ?? error).slice(0, 1_000) };
        steps.push(stepSummary(record));
        if (onStep) await onStep(steps[steps.length - 1]);
        failed += 1;
        const errEdges = errorEdgesOf(node.id);
        if (errEdges.length) { for (const e of errEdges) queue.push(e.to); continue; }
        if (node.onError === "continue") continue;
        return { status: "failed", steps, error: `${record.error.code}: ${record.error.message}`, outputs: context.steps };
      }
      continue;
    }

    const { record, branchWhen, failed: nodeFailed, paused, pauseInfo } = await execOne(node, context);
    if (paused) {
      // Plan B5: el run SE DETIENE aquí. El runtime persiste estado+token y
      // flow_resume lo continúa desde la misma cola con la salida ya puesta.
      record.output = { waiting: true, kind: pauseInfo.kind, ...(pauseInfo.message ? { message: pauseInfo.message } : {}) };
      steps.push(stepSummary(record));
      if (onStep) await onStep(steps[steps.length - 1]);
      const expiresAt = new Date(Date.now() + pauseInfo.timeoutMinutes * 60_000).toISOString();
      // La pausa ocurre ANTES de encolar sucesores: los congelamos aquí (mismas
      // reglas que el camino exitoso — sin aristas de error; el routing de
      // approved lo hacen nodos condition downstream) junto a lo ya en cola.
      const pending = (outgoing.get(node.id) ?? []).filter((edge) => edge.when !== "error").map((edge) => edge.to);
      const state = { flowId: flow.id, waitingNodeId: node.id, kind: pauseInfo.kind, queue: [...queue, ...pending], completed: [...completed], steps: context.steps, input: context.input, expiresAt };
      let stateJson = null;
      try { stateJson = JSON.stringify(state); } catch { stateJson = null; }
      if (!stateJson || stateJson.length > LIMITS.pauseStateMaxChars) {
        return { status: "failed", steps, error: `WAIT_STATE: el estado de espera supera ${Math.round(LIMITS.pauseStateMaxChars / 1024)}KB — coloca el nodo de espera antes de los pasos pesados o reduce maxItems.`, outputs: context.steps };
      }
      return {
        status: "waiting",
        steps,
        error: null,
        wait: { nodeId: node.id, kind: pauseInfo.kind, message: pauseInfo.message, resumeToken: `rw_${cryptoRandom12()}`, expiresAt, state },
        outputs: context.steps,
      };
    }
    steps.push(stepSummary(record));
    if (onStep) await onStep(steps[steps.length - 1]);
    if (nodeFailed) {
      failed += 1;
      // Rama de error (B3): si el nodo tiene salidas when:"error", el fallo
      // se enruta por ahí en vez de matar el run.
      const errEdges = errorEdgesOf(node.id);
      if (errEdges.length) { for (const e of errEdges) queue.push(e.to); continue; }
      // onError:continue = registra el fallo y sigue el resto del grafo;
      // onError:stop = el run termina aquí (y dispara el error workflow B4).
      // continue = el resto del grafo sigue: los sucesores normales corren
      // (ven la salida vacía del nodo fallido); solo las ramas rojas no.
      if (node.onError !== "continue") {
        await spawnErrorWorkflow(flow, input, record, { callTool, workspaceId });
        return { status: "failed", steps, error: `${record.error.code}: ${record.error.message}`, outputs: context.steps };
      }
      for (const edge of outgoing.get(node.id) ?? []) {
        if (edge.when === "error") continue;
        queue.push(edge.to);
      }
      continue;
    }
    for (const edge of outgoing.get(node.id) ?? []) {
      if (edge.when === "error") continue;
      if (branchWhen !== undefined && edge.when !== branchWhen) continue;
      queue.push(edge.to);
    }
  }
  return { status: "success", steps, failedSteps: failed, error: null, outputs: context.steps };
}

/** Plan B5: continúa un run pausado (wait_webhook/approval). Es executeFlow
 *  con deps.resume = { state, payload, expiresAt } — el estado (cola, pasos,
 *  input) viene del run persistido (columnas v64); el payload entra como
 *  salida del nodo de espera y el walk sigue desde la cola congelada. */
export async function resumeFlow(flow, resume, deps) {
  return executeFlow(flow, resume?.state?.input ?? {}, { ...deps, resume });
}

/** Plan B4/D6: si el workspace tiene un flow ACTIVO con trigger type:"error",
 *  se dispara con el detalle del fallo (cubre también fallos de crons: el
 *  run fallado lleva su requestId cron:...). Guard anti-recursión: el error
 *  flow corre con __fromError y jamás dispara otro. Best-effort. */
async function spawnErrorWorkflow(flow, input, failedRecord, { callTool, workspaceId }) {
  if (!callTool || !workspaceId) return;
  if (input && typeof input === "object" && input.__fromError) return;
  try {
    const list = await callTool("flow_list", { workspaceId, limit: 100 });
    const flows = Array.isArray(list?.flows) ? list.flows : Array.isArray(list?.data) ? list.data : Array.isArray(list) ? list : [];
    const errorFlow = flows.find((candidate) => candidate?.enabled && candidate?.trigger?.type === "error" && candidate.id !== flow.id);
    if (!errorFlow) return;
    await callTool("flow_run", {
      flowId: errorFlow.id,
      workspaceId,
      input: {
        __fromError: true,
        flowId: flow.id,
        flowName: flow.name,
        failedNode: failedRecord ? { id: failedRecord.nodeId, type: failedRecord.type, label: failedRecord.label, error: failedRecord.error } : null,
        at: new Date().toISOString(),
      },
    });
  } catch { /* best-effort: el resultado del run original manda */ }
}

async function executeNode(node, context, { callTool, getCredential, resolveTemplateWorkspace, resolveDns, oauth2Token, workspaceId, deadline, flowName, flowId, edges, runAiText: aiText, toolState = { calls: 0, seen: new Set() } }) {
  const config = deepResolve(node.config, context);
  switch (node.type) {
    case "source_rss":
      return { items: await fetchRssArticles(config, { resolveDns }) };
    case "source_nitter":
      return { items: await fetchNitterArticles(config, { resolveDns }) };
    case "source_http":
    case "http":
      return executeHttp(node.type, config, { getCredential, resolveDns, oauth2Token, workspaceId });
    case "map":
      // Array → { items } (split out de REQ-042 C); objeto/escalar → un item.
      return Array.isArray(config.value) ? { items: config.value.slice(0, LIMITS.maxItemsTransform) } : config.value;
    case "condition": {
      const left = getPath(context, config.path);
      const right = config.value;
      const passed = config.operator === "exists" ? left !== undefined && left !== null
        : config.operator === "not_empty" ? Boolean(left)
        : config.operator === "contains" ? String(left ?? "").includes(String(right ?? ""))
        : config.operator === "not_equals" ? left !== right
        : config.operator === "greater_than" ? Number(left) > Number(right)
        : config.operator === "less_than" ? Number(left) < Number(right)
        : left === right;
      return { passed: Boolean(passed) };
    }
    case "text":
      return { text: String(config.template) };
    case "report": {
      const counts = Object.entries(context.steps).map(([nodeId, output]) => `${nodeId}: ${Array.isArray(output?.items) ? `${output.items.length} items` : "ok"}`);
      return { summary: `${config.title ?? "Reporte"} — nodos OK: ${counts.length}`, nodes: counts };
    }
case "preview": {
      // Visualiza el resultado: lee la salida REAL del nodo conectado (no el
      // upstream aplanado a items) — texto queda texto, items quedan items.
      let upstream = null;
      for (const edge of edges) {
        if (edge.to === node.id && context.steps[edge.from] != null) upstream = context.steps[edge.from];
      }
      return previewOutput(upstream, config.title);
    }
    case "ai":
      return executeAi(node, config, context, { getCredential, deadline, workspaceId, edges, callTool, flowId, runAiText: aiText });
    case "agent":
      return executeAgentNode(node, config, context, { getCredential, deadline, workspaceId, edges, callTool, flowId, resolveTemplateWorkspace, runAiText: aiText, toolState });
    case "template":
      return executeTemplateNode(node, config, context, { callTool, resolveTemplateWorkspace, workspaceId, flowName, edges });
    case "sort": {
      // F9: ordena items por campo (numérico o natural sort alfanumérico).
      const upstream = upstreamOutput(node.id, edges, context.steps);
      const items = [...resolveItems(upstream, LIMITS.maxItemsTransform)];
      const dir = config.dir === "desc" ? -1 : 1;
      const path = typeof config.path === "string" && config.path.trim() ? config.path.trim() : null;
      items.sort((a, b) => {
        const av = path ? lookupPath(a, path) : a;
        const bv = path ? lookupPath(b, path) : b;
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
        return String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true }) * dir;
      });
      return { items };
    }
    case "dedupe": {
      // F9: elimina duplicados (JSON del item o del campo path); conserva el 1º.
      const upstream = upstreamOutput(node.id, edges, context.steps);
      const path = typeof config.path === "string" && config.path.trim() ? config.path.trim() : null;
      const seen = new Set();
      const items = [];
      let removed = 0;
      for (const item of resolveItems(upstream, LIMITS.maxItemsTransform)) {
        const key = JSON.stringify(path ? lookupPath(item, path) : item);
        if (seen.has(key)) { removed++; continue; }
        seen.add(key);
        items.push(item);
      }
      return { items, removed };
    }
    case "aggregate": {
      // F9: fan-in — upstreamOutput ya concatena items de TODAS las entradas.
      const upstream = upstreamOutput(node.id, edges, context.steps);
      const items = resolveItems(upstream, LIMITS.maxItemsTransform);
      return { items, count: items.length };
    }
    case "limit": {
      // F9: recorta la lista a N (first/last) — como el Limit de n8n.
      const upstream = upstreamOutput(node.id, edges, context.steps);
      const items = resolveItems(upstream, LIMITS.maxItemsTransform);
      const max = Math.max(1, Math.min(LIMITS.maxItemsTransform, Math.floor(Number(config.max) || 10)));
      return { items: config.keep === "last" ? items.slice(-max) : items.slice(0, max), total: items.length };
    }
    case "switch": {
      const left = getPath(context, config.path);
      let matched;
      for (const rule of config.rules ?? []) {
        if (ruleMatches(left, rule)) { matched = rule.label; break; }
      }
      if (matched == null && config.fallback !== false) matched = "fallback";
      return { matched: matched ?? null, value: left ?? null };
    }
    case "merge": {
      const streams = (edges ?? [])
        .filter((edge) => edge.to === node.id)
        .map((edge) => context.steps[edge.from])
        .filter((out) => out != null)
        .map((out) => (Array.isArray(out.items) ? out.items : [out]));
      // "branch" (plan C1 "elegir rama"): pasa SOLO los items de la entrada N (1-based).
      if (config.mode === "branch") {
        const idx = Math.max(1, Math.floor(Number(config.branch) || 1)) - 1;
        return { items: streams[idx] ?? streams[0] ?? [] };
      }
      if (config.mode === "byKey") {
        const key = String(config.key ?? "");
        const base = streams[0] ?? [];
        const rest = streams.slice(1).flat();
        const joined = base.map((item) => {
          const other = rest.find((candidate) => candidate?.[key] != null && candidate[key] === item?.[key]);
          return other ? { ...(item && typeof item === "object" ? item : { value: item }), ...(typeof other === "object" ? other : { value: other }) } : item;
        });
        return { items: joined };
      }
      return { items: streams.flat() };
    }
    case "wait": {
      const seconds = Math.min(LIMITS.maxWaitSeconds, Math.max(1, Number(config.seconds) || 5));
      const until = Date.now() + seconds * 1000;
      while (Date.now() < until) {
        if (Date.now() > deadline) throw flowError("TIMEOUT", `El wait de ${seconds}s excedió el presupuesto del run (máx ${LIMITS.maxWaitSeconds}s).`);
        await sleep(Math.min(250, until - Date.now()));
      }
      // Paridad n8n: el wait ES transparente — los items que entran siguen
      // hacia el nodo siguiente junto con { waited }.
      return { waited: seconds, items: upstreamOutput(node.id, edges, context.steps).items };
    }
    case "wait_webhook":
    case "approval": {
      // Plan B5: pausan el run hasta flow_resume (callback webhook o aprobación
      // humana). executeFlow detecta el marker __pause y persiste el estado.
      return {
        __pause: true,
        kind: node.type === "approval" ? "approval" : "webhook",
        timeoutMinutes: Math.min(1440, Math.max(1, Number(config.timeoutMinutes) || 60)),
        message: String(config.message ?? ""),
      };
    }
    case "compare": {
      // Plan C5: diff A vs B entre DOS fuentes (orden declarado de aristas;
      // A = primera entrante). mode elige qué lista alimenta items.
      const streams = (edges ?? []).filter((edge) => edge.to === node.id).map((edge) => context.steps[edge.from]).filter((out) => out != null).map((out) => (Array.isArray(out.items) ? out.items : [out]));
      const keys = Array.isArray(config.keys) && config.keys.length ? config.keys : ["id"];
      const keyOf = (item) => keys.map((k) => JSON.stringify(item?.[k] ?? null)).join("|");
      const aItems = streams[0] ?? [];
      const bItems = streams[1] ?? [];
      const mapA = new Map(aItems.map((item) => [keyOf(item), item]));
      const bKeys = new Set(bItems.map(keyOf));
      const added = bItems.filter((item) => !mapA.has(keyOf(item)));
      const removed = aItems.filter((item) => !bKeys.has(keyOf(item)));
      const changed = bItems.filter((item) => { const previous = mapA.get(keyOf(item)); return previous != null && JSON.stringify(previous) !== JSON.stringify(item); });
      const counts = { addedCount: added.length, removedCount: removed.length, changedCount: changed.length, unchanged: bItems.length - added.length - changed.length, aCount: aItems.length, bCount: bItems.length };
      // added/removed/changed viajan como ARRAYS (los conteos, en *Count):
      // un nodo downstream puede encadenarse directo a la lista elegida.
      if (config.mode === "added") return { items: added, added, removed: [], changed: [], ...counts };
      if (config.mode === "removed") return { items: removed, removed, added: [], changed: [], ...counts };
      if (config.mode === "changed") return { items: changed, changed, added: [], removed: [], ...counts };
      return { items: [...added, ...removed, ...changed], added, removed, changed, ...counts };
    }
    case "tool": {
      // Nodo tool (E2 + plan FLOW_NODE_PICKER): llama tools de Musa con args
      // templables ({{input.x}} / {{steps.id.y}} / {{vars.v}}) y allowlist por
      // tier (única fuente: FLOW_TOOL_TIERS). El bridge es admin sintético:
      // el tenant SIEMPRE es el workspace del run (un workspaceId en args se
      // sobreescribe), el presupuesto por run acota el costo y las tools de
      // escritura deduplican (anti doble publicación en reintentos/loops).
      if (!callTool) throw flowError("RUNTIME_CONFIG", "El runtime no tiene herramientas internas conectadas.");
      const toolName = String(config.tool ?? "").trim();
      if (!/^[a-z0-9_]{1,60}$/.test(toolName)) throw flowError("NODE_ERROR", "El nodo tool necesita config.tool: nombre de una tool de la paleta (p. ej. list_social_inbox, render_batch).");
      if (toolName.startsWith("flow_")) throw flowError("MUSA_TOOL_DENIED", `Las tools flow_* no corren como nodo tool: usa el nodo Sub-flow (${toolName}).`);
      if (!(toolName in FLOW_TOOL_TIERS)) throw flowError("MUSA_TOOL_DENIED", `Tool no habilitada para flows: ${toolName}. Elige una tool de la paleta del editor (tiers P0-P2).`);
      const raw = config.args && typeof config.args === "object" && !Array.isArray(config.args) ? config.args : {};
      const callToolOnce = async (callArgs) => {
        if (toolState.calls >= LIMITS.maxToolCallsPerRun) throw flowError("MUSA_TOOL_RATE", `Presupuesto de tools agotado en este run (máx ${LIMITS.maxToolCallsPerRun}).`);
        const args = { ...callArgs, workspaceId };
        const templateId = typeof args.templateId === "string" ? args.templateId : "";
        if (templateId && typeof resolveTemplateWorkspace === "function") {
          const templateWorkspace = await resolveTemplateWorkspace(templateId);
          if (templateWorkspace && workspaceId && templateWorkspace !== workspaceId) throw flowError("MUSA_TOOL_DENIED", `El template ${templateId} pertenece a otro workspace.`);
        }
        toolState.calls++;
        if (FLOW_TOOL_WRITE.has(toolName) && flowId) {
          let signature = "";
          try { signature = `${flowId}|${node.id}|${JSON.stringify(args)}`; } catch { signature = `${flowId}|${node.id}|unserializable`; }
          if (toolState.seen.has(signature)) throw flowError("MUSA_TOOL_RATE", `La tool de escritura ${toolName} ya corre con estos args en este run (dedupe anti doble publicación).`);
          const result = await callTool(toolName, args);
          toolState.seen.add(signature);
          return result;
        }
        return await callTool(toolName, args);
      };
      // perItem (REQ-042 C): UNA llamada POR item del upstream — copys en
      // lote → N entradas de calendario con un solo nodo. Acotado por
      // maxItemsPerTemplateNode y el presupuesto del run; sin items NO llama
      // (devuelve {items:[], count:0}) y el dedupe de escritura aplica por
      // item (args distintos → firmas distintas). Los placeholders CRUDOS
      // viven en node.config.args: el deepResolve de entrada ya colapsó
      // config.args sin item ({{item.x}} → undefined) — bug heredado de
      // REQ-027, mismo fix que el per-item del nodo ai.
      if (config.perItem === true) {
        const templateArgs = node.config.args && typeof node.config.args === "object" && !Array.isArray(node.config.args) ? node.config.args : {};
        const upstream = upstreamOutput(node.id, edges, context.steps);
        const items = resolveItems(upstream, LIMITS.maxItemsPerTemplateNode);
        const results = [];
        for (let index = 0; index < items.length; index++) {
          const itemContext = { ...context, item: items[index], index };
          results.push(await callToolOnce(deepResolve(templateArgs, itemContext)));
        }
        return { items: results, count: results.length };
      }
      return await callToolOnce(raw);
    }
    case "subflow": {
      if (!callTool) throw flowError("RUNTIME_CONFIG", "El runtime no tiene herramientas internas conectadas.");
      if (config.flowId === flowId) throw flowError("NODE_ERROR", "El subflow no puede llamarse a sí mismo.");
      const res = await callTool("flow_run", { flowId: config.flowId, workspaceId, input: deepResolve(config.inputs ?? {}, context) });
      const run = res?.run ?? res ?? {};
      return { runId: run.runId ?? null, status: run.status ?? "unknown" };
    }
    case "code": {
      const upstream = upstreamOutput(node.id, edges, context.steps);
      const items = Array.isArray(upstream.items) ? upstream.items : upstream.items != null ? [upstream.items] : [];
      return executeCodeNode(config.js, { items, item: items[0] ?? null, input: context.input, steps: context.steps });
    }
    default:
      throw flowError("NODE_ERROR", `Tipo de nodo sin ejecutor: ${node.type}`);
  }
}

/** Nodo code (plan B9): JS inline con acceso a items/item/input/steps. El
 *  sandbox sombra fetch/require/process/globalThis/global (sin red ni módulos).
 *  En runtimes sin code-gen (CF Workers sin unsafe) falla con error claro. */
function executeCodeNode(js, { items, item, input, steps }) {
  let fn;
  try {
    fn = new Function("items", "item", "input", "steps", "fetch", "require", "process", "globalThis", "global", `"use strict"; return (async () => {\n${js}\n})();`);
  } catch (error) {
    throw flowError("NODE_ERROR", `Sintaxis inválida en el nodo code: ${String(error?.message ?? error).slice(0, 200)}`);
  }
  return fn(items, item, input, steps, undefined, undefined, undefined, undefined, undefined).then(
    (result) => {
      if (Array.isArray(result)) return { items: result.slice(0, 200) };
      if (result && typeof result === "object") return result;
      return { value: result ?? null };
    },
    (error) => {
      const message = String(error?.message ?? error);
      if (/code generation|eval|EvalError/i.test(message)) {
        throw flowError("NODE_ERROR", "Este runtime no permite evaluar código dinámico ( Workers sin unsafe-eval). Usa map o corre el flow desde Node.");
      }
      throw flowError("NODE_ERROR", `El nodo code falló: ${message.slice(0, 300)}`);
    },
  );
}

function getPath(source, expression) {
  const parts = String(expression ?? "").split(".");
  const root = parts.shift();
  if (root === "input") return parts.reduce((item, key) => item?.[key], source.input);
  if (root === "steps") {
    const id = parts.shift();
    return parts.reduce((item, key) => item?.[key], source.steps[id]);
  }
  if (root === "item") return parts.reduce((item, key) => item?.[key], source.item);
  return undefined;
}

async function executeHttp(type, config, { getCredential, resolveDns, workspaceId, oauth2Token }) {
  const method = String(config.method ?? "GET").toUpperCase();
  const headers = { accept: "application/json, */*", ...(config.headers ?? {}) };
  let oauthCredential = null;
  if (config.credentialId) {
    const credential = await getCredential(workspaceId, config.credentialId);
    if (!credential) throw flowError("CREDENTIAL_MISSING", "La credencial seleccionada ya no existe (flow_credentials_list para ver las vigentes).");
    if (credential.type === "oauth2") {
      // F6: OAuth2 (apps propias del usuario) — Bearer con el access_token
      // resuelto server-side; en 401 refresca UNA vez y reintenta.
      if (!oauth2Token) throw flowError("RUNTIME_CONFIG", "Este runtime no tiene soporte OAuth2 (falta el resolver de tokens).");
      oauthCredential = credential;
      headers.authorization = `Bearer ${await oauth2Token(credential)}`;
    } else {
      applyCredentialAuth(headers, credential);
    }
  }
  const body = config.body == null || method === "GET" || method === "DELETE" ? undefined
    : typeof config.body === "string" ? config.body : JSON.stringify(config.body);
  if (body && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) headers["content-type"] = "application/json";
  const doFetch = () => guardedFetch(config.url, { method, headers, ...(body ? { body } : {}) }, { resolveDns, timeoutMs: Number(config.timeoutMs) || 10_000 });
  let response = await doFetch();
  if (response.status === 401 && oauthCredential) {
    headers.authorization = `Bearer ${await oauth2Token(oauthCredential, { forceRefresh: true })}`;
    response = await doFetch();
  }
  const text = await readLimited(response);
  let responseBody = text;
  if (/json/i.test(response.headers.get("content-type") ?? "")) { try { responseBody = JSON.parse(text); } catch { /* cuerpo no-JSON: se devuelve crudo */ } }
  const output = { status: response.status, ok: response.ok, body: responseBody };
  if (!response.ok) throw Object.assign(flowError("HTTP_ERROR", `La API respondió HTTP ${response.status}.`), { output });
  if (type === "source_http") {
    let items = responseBody;
    if (config.listPath) items = config.listPath.split(".").reduce((item, key) => item?.[key], responseBody);
    if (!Array.isArray(items)) items = items != null ? [items] : [];
    if (items.length > Number(config.limit ?? 25)) items = items.slice(0, Number(config.limit ?? 25));
    return { items };
  }
  return output;
}

function applyCredentialAuth(headers, credential) {
  const secret = credential.secret;
  if (!secret) throw flowError("CREDENTIAL_MISSING", "La credencial no tiene secreto guardado.");
  if (credential.type === "bearer") headers.authorization = `Bearer ${secret}`;
  else if (credential.type === "api_key") headers[credential.header_name || "X-API-Key"] = secret;
  else if (credential.type === "basic") headers.authorization = `Basic ${btoa(`${credential.username ?? ""}:${secret}`)}`;
  else throw flowError("CREDENTIAL_TYPE", `La credencial ${credential.name} es de tipo ${credential.type}; los nodos HTTP usan bearer/api_key/basic.`);
}

async function executeAi(node, config, context, { getCredential, deadline, workspaceId, edges, callTool, flowId, runAiText: aiTextOverride }) {
  const callAi = aiTextOverride ?? runAiText;
  if (!config.credentialId) {
    throw flowError("AI_NO_CREDENTIAL", "Este nodo IA no tiene credencial: guarda una con flow_credentials_set (type ai_provider) y pon su id en credentialId.");
  }
  const credential = await getCredentialFor(config, workspaceId, getCredential);
  // Memoria de agente (plan E3): memory.runs inyecta un digest de los últimos
  // N runs de ESTE flow en el systemPrompt (best-effort; sin historial el nodo corre igual).
  let memoryDigest = "";
  const memoryRuns = Math.min(10, Math.max(0, Math.floor(Number(config.memory?.runs) || 0)));
  if (memoryRuns > 0 && callTool && flowId) {
    try {
      const hist = await callTool("flow_history", { workspaceId, flowId, limit: memoryRuns });
      const runs = Array.isArray(hist?.runs) ? hist.runs : [];
      const lines = runs.map((r) => `- ${String(r.startedAt ?? "")} ${r.status}${r?.error?.message ? ` — ${String(r.error.message).slice(0, 160)}` : ""}`);
      if (lines.length) memoryDigest = `\n\nRuns recientes de este flow (memoria, más nuevo primero):\n${lines.join("\n")}`;
    } catch { /* best-effort: sin memoria el nodo igual corre */ }
  }
  const upstream = upstreamOutput(node.id, edges, context.steps);
  // Bug REQ-027 → fix REQ-042 C: executeNode pre-resuelve node.config SIN
  // item — los placeholders {{item.x}} colapsaban ANTES de llegar aquí
  // (exact-match → undefined, texto mixto → interpolado vacío) y
  // promptPerItem jamás disparaba: cada "lote" corregía UNA sola llamada con
  // el prompt truncado. El per-item lee los templates CRUDOS de node.config
  // y resuelve UNA vez por item (deepResolve es puro: input/steps/vars
  // siguen resolviendo igual dentro del contexto del item).
  const promptTemplate = typeof node.config?.prompt === "string" ? node.config.prompt : String(config.prompt ?? "");
  const systemTemplate = typeof node.config?.systemPrompt === "string" ? node.config.systemPrompt : String(config.systemPrompt ?? "");
  const promptPerItem = /\{\{\s*item\./.test(promptTemplate);
  const remainingMs = Math.max(1_000, deadline - Date.now());
  const items = resolveItems(upstream, config.maxItems ?? LIMITS.defaultItemsPerTemplateNode);
  if (promptPerItem && items.length) {
    const budgetPerItem = Math.max(5_000, Math.floor(remainingMs / Math.max(1, items.length)));
    const out = [];
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const itemContext = { ...context, item, index };
      const prompt = deepResolve(promptTemplate, itemContext);
      const systemPrompt = deepResolve(systemTemplate, itemContext) + memoryDigest;
      const result = await callAi({ ...config, prompt, systemPrompt }, credential, { timeoutMs: Math.min(40_000, budgetPerItem) });
      out.push({ ...item, ai: result.text });
    }
    return { items: out };
  }
  const prompt = deepResolve(promptTemplate, context);
  const systemPrompt = deepResolve(systemTemplate, context) + memoryDigest;
  const result = await callAi({ ...config, prompt, systemPrompt }, credential, { timeoutMs: Math.min(40_000, remainingMs) });
  // F1 (era E1): salida estructurada. responseFormat:"json" parsea (tolerando
  // fences); CON schema además valida el JSON Schema acotado y hay UN retry de
  // corrección — si igual falla, el nodo FALLA con AI_SCHEMA (la rama de error
  // o el error workflow lo capturan). Sin schema el fallo de parseo sigue
  // siendo blando (jsonParseError): compatibilidad con los flows existentes.
  const schema = parseSchemaConfig(config.schema);
  const wantJson = config.responseFormat === "json" || schema != null;
  if (!wantJson) return { text: result.text, model: result.model, usage: result.usage };
  const cleaned = (t) => String(t ?? "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let parsed = safeJsonParse(cleaned(result.text));
  let errors = parsed === undefined ? ["la respuesta no fue JSON válido"] : schema ? validateAgainstSchema(parsed, schema) : [];
  let model = result.model;
  let usage = result.usage;
  if (errors.length && schema) {
    const fixPrompt = `${prompt}\n\nTu respuesta anterior NO cumplió el schema (${errors.slice(0, 5).join("; ")}). Responde de nuevo SOLO JSON válido, sin texto extra, cumpliendo EXACTAMENTE este schema:\n${JSON.stringify(schema).slice(0, 2_000)}`;
    const retry = await callAi({ ...config, prompt: fixPrompt, systemPrompt }, credential, { timeoutMs: Math.min(40_000, Math.max(5_000, deadline - Date.now())) });
    const reparsed = safeJsonParse(cleaned(retry.text));
    const reerrors = reparsed === undefined ? ["el reintento no fue JSON válido"] : validateAgainstSchema(reparsed, schema);
    if (!reerrors.length) {
      parsed = reparsed;
      model = retry.model;
      usage = retry.usage;
      errors = [];
    }
  }
  if (schema && errors.length) {
    throw flowError("AI_SCHEMA", `La respuesta IA no cumplió el schema tras el reintento: ${errors.slice(0, 5).join("; ")} @ ${node.id}.`);
  }
  if (parsed === undefined) {
    return { text: result.text, jsonParseError: "la respuesta no fue JSON válido", model, usage };
  }
  return { json: parsed, model, usage };
}

/** Plan E2: nodo agent — loop de tool-calling con NUESTROS tools MCP. El LLM
 *  responde por turno SOLO un JSON: {"tool","args"} para actuar o {"final"}
 *  para terminar. Funciona con cualquier proveedor de texto (sin function
 *  calling nativo). runAiText inyectable para tests. */
async function executeAgentNode(node, config, context, { getCredential, deadline, workspaceId, edges, callTool, flowId, resolveTemplateWorkspace, runAiText: aiTextOverride, toolState = { calls: 0, seen: new Set() } }) {
  const callAi = aiTextOverride ?? runAiText;
  if (!config.credentialId) {
    throw flowError("AI_NO_CREDENTIAL", "Este nodo agent no tiene credencial: guarda una con flow_credentials_set (type ai_provider) y pon su id en credentialId.");
  }
  if (!callTool) throw flowError("RUNTIME_CONFIG", "El runtime no tiene herramientas internas conectadas (el agent las usa en su loop).");
  const credential = await getCredentialFor(config, workspaceId, getCredential);
  const tools = (Array.isArray(config.tools) ? config.tools : []).map((t) => String(t).trim()).filter(Boolean).slice(0, 8);
  const maxIterations = Math.min(8, Math.max(1, Math.floor(Number(config.maxIterations) || 4)));
  let memoryDigest = "";
  const memoryRuns = Math.min(10, Math.max(0, Math.floor(Number(config.memory?.runs) || 0)));
  if (memoryRuns > 0 && flowId) {
    try {
      const hist = await callTool("flow_history", { workspaceId, flowId, limit: memoryRuns });
      const runs = Array.isArray(hist?.runs) ? hist.runs : [];
      const lines = runs.map((r) => `- ${String(r.startedAt ?? "")} ${r.status}`);
      if (lines.length) memoryDigest = `\nRuns recientes de este flow (memoria):\n${lines.join("\n")}`;
    } catch { /* best-effort: sin memoria el agent igual corre */ }
  }
  const upstream = upstreamOutput(node.id, edges, context.steps);
  const dataDigest = JSON.stringify(Array.isArray(upstream.items) ? upstream.items.slice(0, 10) : upstream).slice(0, 4_000);
  const toolLines = tools.length ? tools.map((t) => `- ${t}`).join("\n") : '- (ninguna: responde directo con {"final"})';
  const systemPrompt = `${String(config.systemPrompt ?? "") || "Eres un agente de Musa. Conciso y práctico, en el idioma del usuario."}${memoryDigest}\n\nPROTOCOLO: en CADA turno responde SOLO un JSON válido, sin texto extra: {"tool":"<nombre>","args":{...}} para usar una herramienta, o {"final":"<respuesta al usuario>"} cuando termines. Herramientas permitidas:\n${toolLines}`;
  const userPrompt = `${String(config.prompt ?? "")}\n\nDatos de entrada (recortados):\n${dataDigest}`;
  const toolCalls = [];
  let transcript = "";
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (Date.now() > deadline) throw flowError("TIMEOUT", "El agente superó el presupuesto del run.");
    const prompt = `${userPrompt}${transcript ? `

Historial del loop:
${transcript}

Tu siguiente turno (SOLO JSON):` : `

Tu primer turno (SOLO JSON):`}`;
    const result = await callAi({ ...config, prompt, systemPrompt }, credential, { timeoutMs: Math.min(40_000, Math.max(5_000, deadline - Date.now())) });
    const text = String(result?.text ?? "");
    const action = extractAgentAction(text);
    if (action?.final != null) return { answer: String(action.final), iterations: iteration, toolCalls, model: result?.model ?? null };
    if (action?.tool) {
      const name = String(action.tool);
      // Blindaje agent (mismo contrato que el nodo tool): sin lista configurada
      // NO hay tools aunque el modelo las proponga; allowlist ∩ catálogo;
      // flow_* siempre rechazado; tenant, presupuesto y dedupe los impone el run.
      const deny = (reason) => {
        toolCalls.push({ tool: name, ok: false });
        transcript += `\n[turno ${iteration}] ${name}: ERROR — ${reason}`;
      };
      if (!tools.length) { deny("este agent corre sin tools (lista vacía = responde directo). Configúralas en el inspector."); continue; }
      if (!tools.includes(name)) { deny(`herramienta no permitida. Permitidas: ${tools.join(", ")}.`); continue; }
      if (name === "flow_run" && action.args?.flowId === flowId) { deny("un agent no puede lanzar su propio flow."); continue; }
      if (name.startsWith("flow_")) { deny("las tools flow_* no corren dentro de un agent (usa el nodo Sub-flow)."); continue; }
      if (!(name in FLOW_TOOL_TIERS)) { deny(`tool fuera del catálogo de flows: ${name}. Elige una de la paleta del editor.`); continue; }
      if (toolState.calls >= LIMITS.maxToolCallsPerRun) { deny(`presupuesto de tools agotado en este run (máx ${LIMITS.maxToolCallsPerRun}).`); continue; }
      const raw = action.args && typeof action.args === "object" && !Array.isArray(action.args) ? action.args : {};
      const templateId = typeof raw.templateId === "string" ? raw.templateId : "";
      if (templateId && typeof resolveTemplateWorkspace === "function") {
        const templateWorkspace = await resolveTemplateWorkspace(templateId);
        if (templateWorkspace && workspaceId && templateWorkspace !== workspaceId) { deny(`el template ${templateId} pertenece a otro workspace.`); continue; }
      }
      toolState.calls++;
      const isWrite = FLOW_TOOL_WRITE.has(name);
      let signature = "";
      try { signature = `${flowId ?? ""}|${node.id}|${name}|${JSON.stringify(raw)}`; } catch { signature = `${flowId ?? ""}|${node.id}|${name}|unserializable`; }
      if (isWrite && toolState.seen.has(signature)) { deny(`la tool de escritura ${name} ya corrió con estos args en este run.`); continue; }
      try {
        const args = { ...raw, workspaceId };
        const out = await callTool(name, args);
        if (isWrite) toolState.seen.add(signature);
        toolCalls.push({ tool: name, ok: true });
        transcript += `\n[turno ${iteration}] ${name}(${JSON.stringify(args).slice(0, 300)}) → ${JSON.stringify(out ?? null).slice(0, 6_000)}`;
      } catch (error) {
        toolCalls.push({ tool: name, ok: false });
        transcript += `\n[turno ${iteration}] ${name}: ERROR — ${String(error?.message ?? error).slice(0, 300)}`;
      }
      continue;
    }
    return { answer: text, iterations: iteration, toolCalls, note: "la respuesta no fue acción JSON: se tomó como final" };
  }
  return { answer: "El agente agotó sus iteraciones sin respuesta final. Ajusta prompt/maxIterations.", iterations: maxIterations, toolCalls, exhausted: true };
}

/** Último objeto JSON balanceado del texto que lleve "tool" o "final". */
function extractAgentAction(text) {
  const source = String(text ?? "");
  for (let end = source.length - 1; end > 0; end--) {
    if (source[end] !== "}") continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let start = end; start >= 0; start--) {
      const ch = source[start];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "}") depth++;
      else if (ch === "{") {
        depth--;
        if (depth === 0) {
          const parsed = safeJsonParse(source.slice(start, end + 1));
          if (parsed && typeof parsed === "object" && (parsed.tool != null || parsed.final != null)) return parsed;
          break;
        }
      }
    }
  }
  return null;
}

/** Salida del nodo de espera al reanudar (B5): approval normaliza a
 *  {approved, note}; webhook entrega el payload crudo como salida. */
function waitOutput(kind, payload) {
  const data = payload != null && typeof payload === "object" && !Array.isArray(payload) ? payload : { value: payload ?? null };
  if (kind === "approval") {
    const decision = String(data.decision ?? "").toLowerCase();
    return { approved: data.approved === true || decision === "approved" || decision === "approve", note: typeof data.note === "string" ? data.note.slice(0, 500) : null, decidedAt: new Date().toISOString() };
  }
  return data;
}

async function getCredentialFor(config, workspaceId, getCredential) {
  // Misma firma que executeHttp: getCredential(workspaceId, id).
  const credential = await getCredential(workspaceId, config.credentialId);
  if (!credential) throw flowError("CREDENTIAL_MISSING", "La credencial ya no existe; créala de nuevo (flow_credentials_set) o elige otra en el nodo.");
  return { type: credential.type, provider: credential.provider, model: credential.model, secret: credential.secret, name: credential.name };
}

async function executeTemplateNode(node, config, context, { callTool, resolveTemplateWorkspace, workspaceId, flowName, edges }) {
  if (!callTool) throw flowError("RUNTIME_CONFIG", "El runtime no tiene herramientas internas conectadas.");
  let frame = null;
  if (config.recipe && typeof config.recipe === "object" && typeof config.recipe.html === "string" && config.recipe.html) {
    // Flows-brand: receta inline — el frame viaja en la definición (sin archivo
    // ni check de workspace). Misma forma que un frame de Musa; renderTemplate
    // Frame valida dimensiones/tipos igual que con un frame real.
    frame = { html: config.recipe.html, css: String(config.recipe.css ?? ""), width: Number(config.recipe.width), height: Number(config.recipe.height), background: config.recipe.background ?? null };
  } else {
    if (!config.templateId || !config.frameId) {
      throw flowError("TEMPLATE_NOT_CONFIGURED", `El nodo "${node.label}" no tiene archivo+frame ni receta: elige archivo y frame exacto en el editor, pídele a tu IA que lo configure con flow_save, o define config.recipe.`);
    }
    const templateWorkspace = await resolveTemplateWorkspace(config.templateId);
    if (templateWorkspace && workspaceId && templateWorkspace !== workspaceId) {
      throw flowError("TEMPLATE_NOT_IN_WORKSPACE", `El template ${config.templateId} pertenece a otro workspace.`);
    }
    const source = await callTool("get_html_frames", { templateId: config.templateId });
    const frames = source?.frames ?? [];
    frame = frames.find((candidate) => candidate.id === config.frameId);
    if (!frame) {
      throw flowError("FRAME_NOT_FOUND", `El frame ${config.frameId} no existe en ${config.templateId}. Frames: ${frames.map((candidate) => `${candidate.id} (${candidate.name})`).join(", ") || "(ninguno)"}.`);
    }
  }
  const upstream = upstreamOutput(node.id, edges, context.steps);
  const items = resolveItems(upstream, config.maxItems ?? LIMITS.defaultItemsPerTemplateNode);
  if (!items.length) throw flowError("TEMPLATE_NO_INPUT", "El nodo template no recibió items del nodo anterior; conecta una fuente o un nodo ai antes.");
  const day = new Date().toISOString().slice(0, 10);
  // Fase 1 — render puro de TODOS los items ANTES de crear nada: si un item
  // falla (p. ej. TEMPLATE_NO_TITLE_SLOT) no queda template huérfano vacío.
  // Flows-brand: los extraValues del nodo pisan los extras del item (el valor
  // explícito del humano gana sobre el que propuso la IA).
  items.map((item) => renderTemplateFrame(frame, { ...templateValuesFromItem(item), ...config.extraValues }));
  // Fase 2 — side effects: crear el archivo de salida y un frame por item.
  const created = await callTool("create_template", {
    name: `${flowName || "Flow"} · ${config.format} · ${day}`.slice(0, 80),
    workspaceId,
    width: frame.width, height: frame.height,
    engine: "html", initialFrame: false,
  });
  const outputTemplateId = created?.templateId ?? created?.id ?? null;
  if (!outputTemplateId) throw flowError("TEMPLATE_CREATE_FAILED", "Musa no devolvió el id del template de salida.");
  const outFrames = [];
  for (let index = 0; index < items.length; index++) {
    const values = { ...templateValuesFromItem(items[index]), ...config.extraValues };
    let imageUrl = "";
    if (values.imageUrl && /^https:\/\//i.test(values.imageUrl)) {
      try {
        const uploaded = await callTool("upload_image", {
          name: `${day}-${node.id}-${index + 1}`.slice(0, 80),
          url: values.imageUrl, workspaceId, tags: ["flow", node.id, day],
        });
        imageUrl = uploaded?.url ?? values.imageUrl;
      } catch { imageUrl = values.imageUrl; }
    }
    const design = renderTemplateFrame(frame, { ...values, imageUrl });
    const name = `${String(index + 1).padStart(2, "0")} · ${config.format} · ${String(values.title || values.text || "item").slice(0, 48)}`;
    const frameResult = await callTool("create_html_frame", {
      templateId: outputTemplateId, name,
      width: design.width, height: design.height,
      html: design.html, css: design.css,
      background: design.background || "#0c0c0e",
      frameStrategy: "multi",
    });
    outFrames.push({ frameId: frameResult?.id ?? frameResult?.frameId ?? null, title: values.title ?? "", imageUrl });
  }
  return { templateId: outputTemplateId, format: config.format, items: items.length, frames: outFrames };
}

// ── Documentación del schema para tool descriptions (prompt-friendly) ───────

export const NODE_SCHEMA_DOC = `Nodos: {id, type, label?, enabled?, onError?:"stop"|"continue", retry?:0-5, config, position:{x,y}}.
Tipos y config: source_rss{url, limit?} | source_nitter{username, instanceUrl | url(rss directa), includeReposts?, limit?} | source_http{url, method?, headers?, body?, listPath?, credentialId?, limit?, pagination?{maxPages:1-10, nextPath}} | ai{provider: gemini|anthropic|openai|deepseek|glm|kimi|qwen|openrouter, model, prompt, systemPrompt?, maxOutputTokens?, credentialId, maxItems?, responseFormat?:"json", schema?, webSearch?:bool} | template{templateId+frameId | recipe:{width, height, html≤64KB, css, background?}, format: post|story|custom, maxItems?, extraValues?:{token:valor}≤16} | http{url, method?, headers?, body?, timeoutMs?, credentialId?} | map{value: objeto (un item) | array | {{steps.id.y}} que resuelva a array — split out → {items}, máx 100} | condition{path, operator, value?} | switch{path, rules:[{label, operator: equals|contains|greater_than|less_than|regex, value}...≤8], fallback?:bool} | loop{batchSize:1-50} | merge{mode: append|byKey|branch, key?, branch?} | wait{seconds:1-20} | wait_webhook{timeoutMinutes?:1-1440, message?} | approval{message?, timeoutMinutes?} | compare{keys?:[..≤3], mode?:added|removed|changed|all} | agent{credentialId, prompt, systemPrompt?, tools?:[..≤8], maxIterations?:1-8, memory?{runs}} | group{title?, width?, height?, collapsed?} (visual, sin edges, como note) | subflow{flowId, inputs?} | code{js} | tool{tool, args?, perItem?:bool} — SOLO tools del catálogo de la paleta (tiers P0-P2, FLOW_TOOL_TIERS); flow_* rechazado (usa subflow); workspaceId lo fuerza el run; máx 25 llamadas/run; escrituras deduplican; perItem:true llama UNA vez POR item del upstream (placeholders {{item.x}} por item, máx 5, sin items = 0 llamadas — copys en lote → N entradas de calendario) | text{template} | report{title?} | preview{title?} (visualiza el resultado: pasa tal cual la salida del nodo conectado y añade view{kind: empty|text|items|json} acotada — colócalo al final para ver el output del run) | sort{path?, dir?: asc|desc} | dedupe{path?} | aggregate{} | limit{max?:1-100, keep?: first|last} | note{text} (solo visual, sin edges). ai acepta memory{runs:1-10} (digest de últimos runs en el systemPrompt), responseFormat:"json" y schema (JSON Schema acotado, máx 2KB). El flow puede llevar vars{...} — constantes leídas como {{vars.nombre}}. Inputs declarados (Flows-brand): flow_save acepta inputs:[{key, label?, type?: text|textarea|number|date, required?, default?} ≤12] — executeFlow aplica los defaults y exige los required sobre el payload {{input.x}} (manual, schedule y webhook por igual; faltar un required falla con INPUT_REQUIRED antes de ejecutar). ai admite webSearch:true — el proveedor busca en la web con SU capacidad nativa, los 8 cubiertos: gemini google_search, anthropic web_search, openrouter plugin web, openai y deepseek vía Responses API (tool web_search), glm tool web_search, qwen enable_search+forced_search, kimi inyecta /tools/search_pro al prompt — la búsqueda corre con la cuenta del propio proveedor. template admite extraValues:{token:valor} — sustituye {{token}} arbitrarios del frame ({{colorPrimario}}, {{tipografiaTitulos}}, …); además el item puede aportar extras si la IA responde responseFormat:"json" (aplánalo con un nodo map si vienen anidados en json); los extraValues del nodo pisan los del item; los tokens sin valor quedan visibles en el frame. El frame puede venir de un archivo (templateId+frameId) o de una RECETA inline (recipe:{width,height,html,css}) — la "receta de diseño" viaja en la definición: los presets de la biblioteca llegan VIVOS sin plantilla previa y el humano reemplaza la receta por SU templateId+frameId cuando diseña la pieza propia.
Edges: [{from, to, when?}]; condition exige when:"true"/"false"; switch usa las etiquetas de sus reglas o "fallback"; CUALQUIER nodo puede tener when:"error" (la rama se recorre solo si el nodo falla). retry:N reintenta N veces con backoff; onError:"continue" sigue el grafo tras un fallo.
Fan-in (varias entradas): solo ai, report, merge, loop, code, compare, sort, dedupe, aggregate y limit. Placeholders {{input.x}}, {{steps.ID.y}}, {{item.x}}, {{vars.v}} y {{static.k}} (storage persistente entre runs: flow_static_data_get/set). Secretos NUNCA en config: credentialId (flow_credentials_set; tipos bearer, api_key, basic, ai_provider y oauth2). OAuth2 (F6, apps propias del usuario): flow_credentials_set type:"oauth2" (clientId, authUrl/tokenUrl HTTPS, scope opcional; secret = client_secret) → flow_oauth2_connect { credentialId } → abre authUrl en el navegador y el callback guarda el refresh_token cifrado → los nodos http la firman como Bearer y refrescan solos (un reintento ante 401).
Pinning (debug): flow_run acepta input.__pins = {nodeId: <salida congelada>} — el nodo NO se ejecuta y usa esa salida.
Error workflow: un flow activo con trigger {type:"error"} se dispara solo cuando OTRO flow falla (recibe input.flowId, flowName, failedNode). Trigger: {type:"manual"} | {type:"webhook"} | {type:"schedule", cron, timezone} — DECLARATIVO: el server NUNCA barre, los horarios los ejecuta tu IA (programa TÚ el cron; flow_due_check dice si el slot vence y flow_run con requestId "cron:<flowId>:<slot>" ejecuta, idempotente) | {type:"error"}.
Tags: flow_save acepta tags:[..≤10] para filtrar en el board; cada save archiva la versión anterior (flow_get devuelve versions[]). flow_save acepta locked:true para congelar la edición de un flow (solo un admin puede editar o desbloquear; flow_run sigue permitido). Pausas (B5): wait_webhook/approval DETIENEN el run — flow_run responde status:"waiting" con wait.resumeToken y flow_resume {resumeToken, payload} continúa el MISMO run (workspaceId opcional: el token ya identifica el run; en approval usa approved:true/false + note; la salida del nodo es {approved, note} — ramifica con condition sobre steps.ID.approved). No dentro de loop. La espera expira a los timeoutMinutes y flow_resume la marca fallada (WAIT_EXPIRED).
Datos sin código (F9): sort{path?, dir asc|desc}, dedupe{path?}, aggregate{} (junta items de TODAS sus entradas), limit{max 1-100, keep first|last}. IA estructurada (F1): ai admite responseFormat:"json" + schema (JSON Schema acotado: type/enum/properties/required/items, máx 2KB) — valida y reintenta UNA vez; si sigue fallando el nodo truena con AI_SCHEMA. Webhook trigger admite respond:"ack"|"lastNode" (con lastNode, la respuesta HTTP lleva los outputs de los nodos terminales). Agent: tools máx 8 — lista vacía = responde directo (el engine rechaza cualquier tool-call del modelo); flow_* y tools fuera del catálogo (paleta/tiers) se rechazan SIEMPRE; el run fuerza workspaceId, deduplica escrituras idénticas y comparte con los nodos tool el presupuesto de 25 llamadas/run.`;
