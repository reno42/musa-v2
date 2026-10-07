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

export const LIMITS = {
  flowsPerWorkspace: 20,
  nodesPerFlow: 40,
  edgesPerFlow: 60,
  inputBytes: 50_000,
  stepOutputChars: 4_000,
  maxItemsPerTemplateNode: 5,
  defaultItemsPerTemplateNode: 3,
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
};

export const NODE_TYPES = ["source_rss", "source_nitter", "source_http", "ai", "template", "http", "map", "condition", "switch", "loop", "merge", "wait", "subflow", "code", "tool", "text", "report", "note"];
const SOURCE_TYPES = new Set(["source_rss", "source_nitter", "source_http"]);
// Fan-in (varias aristas entrantes): nodos que AGREGAN streams. merge/loop/code
// se suman a ai/report (plan Fase 2).
const FAN_IN_TYPES = new Set(["ai", "report", "merge", "loop", "code"]);
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
  const exact = value.match(/^\{\{\s*(input|steps|item|vars)\.([A-Za-z0-9_.-]+)\s*\}\}$/);
  if (exact) return lookupPath(context[exact[1]], exact[2]);
  return value.replace(/\{\{\s*(input|steps|item|vars)\.([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, source, key) => {
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
  } else if (type === "template") {
    const templateId = String(config.templateId ?? "");
    const frameId = String(config.frameId ?? "");
    // Un template sin archivo+frame SOLO es válido en borradores: es el estado
    // "a configurar" de los presets de la biblioteca. Al activar se exige.
    if (!templateId && !frameId && allowIncomplete) {
      return { templateId: "", frameId: "", format: ["post", "story", "custom"].includes(config.format) ? config.format : "custom", maxItems: clampInt(config.maxItems, 1, LIMITS.maxItemsPerTemplateNode, LIMITS.defaultItemsPerTemplateNode) };
    }
    if (!NODE_ID.test(templateId)) throw flowError("VALIDATION", "El nodo template necesita templateId (el archivo de Diseño).");
    if (!NODE_ID.test(frameId)) throw flowError("VALIDATION", "El nodo template necesita frameId (elige archivo y frame exacto).");
    out.templateId = templateId;
    out.frameId = frameId;
    out.format = ["post", "story", "custom"].includes(config.format) ? config.format : "custom";
    out.maxItems = clampInt(config.maxItems, 1, LIMITS.maxItemsPerTemplateNode, LIMITS.defaultItemsPerTemplateNode);
  } else if (type === "http") {
    out.url = httpsUrlOrThrow(config.url, "La URL del nodo HTTP");
    out.method = ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(String(config.method ?? "GET").toUpperCase()) ? String(config.method ?? "GET").toUpperCase() : "GET";
    out.headers = cleanHeaders(config.headers);
    if (config.body != null) out.body = config.body;
    out.timeoutMs = clampInt(config.timeoutMs, 1_000, 15_000, 10_000);
    out.credentialId = cleanId(config.credentialId, "credentialId");
  } else if (type === "map") {
    if (!config.value || typeof config.value !== "object" || Array.isArray(config.value)) throw flowError("VALIDATION", "El nodo map necesita un objeto en config.value.");
    out.value = config.value;
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
    if (!toolName && !allowIncomplete) throw flowError("VALIDATION", "El nodo tool necesita config.tool: nombre de herramienta MCP (p. ej. flow_list, get_html_frames).");
    if (toolName) {
      if (!/^[a-z0-9_]{1,60}$/.test(toolName)) throw flowError("VALIDATION", "El nombre del tool debe ser minúsculas, números o _ (máx 60).");
      out.tool = toolName;
    }
    if (config.args != null) {
      if (typeof config.args !== "object" || Array.isArray(config.args)) throw flowError("VALIDATION", "El nodo tool necesita config.args como objeto (placeholders {{input.x}} / {{steps.id}}).");
      let argsSize = 0;
      try { argsSize = JSON.stringify(config.args).length; } catch { throw flowError("VALIDATION", "El nodo tool tiene config.args no serializable."); }
      if (argsSize > 4_000) throw flowError("VALIDATION", "El nodo tool tiene config.args demasiado grande (máx 4KB): usa placeholders {{input.x}}.");
      out.args = config.args;
    }
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
    if (type === "ai") {
      // Re-valida por nodo para incluir el id en el mensaje.
      try { validateAiConfig({ ...config, prompt: config.prompt }, normalized.id); } catch (error) { throw flowError("VALIDATION", error.message); }
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
    if (byId.get(from).type === "note" || byId.get(to).type === "note") {
      throw flowError("VALIDATION", "Las notas son solo visuales: no se conectan a nodos.");
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
    // todas sus fuentes; report resume el run; merge/loop/code procesan
    // varias entradas (plan Fase 2).
    if (!FAN_IN_TYPES.has(node.type) && incoming.get(node.id) > 1) {
      throw flowError("VALIDATION", `El nodo ${node.id} tiene varias conexiones entrantes; solo los nodos ai, report, merge, loop y code combinan varias fuentes.`);
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

  return {
    name,
    enabled: flowEnabled,
    trigger: flowEnabled && !trigger ? { type: "manual" } : trigger,
    nodes,
    edges,
    tags,
    vars,
  };
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
  const OPTIONAL_COLUMNS = ["tags", "versions", "vars"];
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
  async function listRuns(workspaceId, { flowId, limit = 30 } = {}) {
    let query = sb.from("flow_runs").select("*").eq("workspace_id", workspaceId).order("started_at", { ascending: false }).limit(Math.max(1, Math.min(Number(limit) || 30, LIMITS.historyLimit)));
    if (flowId) query = query.eq("flow_id", flowId);
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
    const { data, error } = await sb.from("flow_credentials").upsert(row, { onConflict: "workspace_id,name" }).select().single();
    if (error) clean(error, "flow_credentials(set)");
    return data;
  }
  async function deleteCredential(id, workspaceId) {
    const { data, error } = await sb.from("flow_credentials").delete().eq("id", id).eq("workspace_id", workspaceId).select("id").single();
    if (error) clean(error, "flow_credentials(delete)");
    return data;
  }

  return { listFlows, countFlows, getFlow, insertFlow, updateFlow, deleteFlow, insertRun, updateRun, getRun, findRunByRequestId, listRuns, countRunningRuns, reconcileStaleRuns, pruneRuns, countRunsSince, latestRun, listCredentials, getCredential, upsertCredential, deleteCredential };
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
  const { callTool, getCredential, resolveTemplateWorkspace, resolveDns, onStep, workspaceId, deadline = Date.now() + LIMITS.runTimeoutMs, now = () => new Date().toISOString() } = deps;
  // Data pinning (B7): el editor manda flow_run con input.__pins = { nodeId: salida }.
  const pins = input && typeof input === "object" && !Array.isArray(input) ? (input.__pins ?? null) : null;
  // Las notas son solo visuales: el run las ignora igual que los deshabilitados.
  const nodes = (flow.nodes ?? []).filter((node) => node.enabled !== false && node.type !== "note");
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
  const context = { input: input ?? {}, steps: {}, vars: flow.vars ?? {} };
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
          output = await executeNode(node, ctx, { callTool, getCredential, resolveTemplateWorkspace, resolveDns, workspaceId, deadline, flowName: flow.name, flowId: flow.id, edges });
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
      const { record, branchWhen, failed: nodeFailed } = await execOne(node, ctx);
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
  const roots = nodes.filter((node) => incomingCount.get(node.id) === 0)
    .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0) || (a.position?.x ?? 0) - (b.position?.x ?? 0))
    .map((node) => node.id);
  const queue = [...roots];
  const completed = new Set();

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

    const { record, branchWhen, failed: nodeFailed } = await execOne(node, context);
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

async function executeNode(node, context, { callTool, getCredential, resolveTemplateWorkspace, resolveDns, workspaceId, deadline, flowName, flowId, edges }) {
  const config = deepResolve(node.config, context);
  switch (node.type) {
    case "source_rss":
      return { items: await fetchRssArticles(config, { resolveDns }) };
    case "source_nitter":
      return { items: await fetchNitterArticles(config, { resolveDns }) };
    case "source_http":
    case "http":
      return executeHttp(node.type, config, { getCredential, resolveDns, workspaceId });
    case "map":
      return config.value;
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
    case "ai":
      return executeAi(node, config, context, { getCredential, deadline, workspaceId, edges, callTool, flowId });
    case "template":
      return executeTemplateNode(node, config, context, { callTool, resolveTemplateWorkspace, workspaceId, flowName, edges });
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
    case "tool": {
      // Nodo tool genérico (plan E2, base): llama CUALQUIER herramienta MCP con
      // args templables ({{input.x}} / {{steps.id.y}} / {{vars.v}}). flow_run
      // lleva el MISMO guard anti-recursión que el subflow.
      if (!callTool) throw flowError("RUNTIME_CONFIG", "El runtime no tiene herramientas internas conectadas.");
      const toolName = String(config.tool ?? "").trim();
      if (!/^[a-z0-9_]{1,60}$/.test(toolName)) throw flowError("NODE_ERROR", "El nodo tool necesita config.tool: nombre de herramienta MCP (p. ej. flow_list, get_html_frames).");
      if (toolName === "flow_run" && config.args?.flowId === flowId) throw flowError("NODE_ERROR", "El tool flow_run no puede llamarse a sí mismo (usa el nodo subflow con otro flow).");
      const args = config.args && typeof config.args === "object" && !Array.isArray(config.args) ? config.args : {};
      return await callTool(toolName, args);
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

async function executeHttp(type, config, { getCredential, resolveDns, workspaceId }) {
  const method = String(config.method ?? "GET").toUpperCase();
  const headers = { accept: "application/json, */*", ...(config.headers ?? {}) };
  if (config.credentialId) {
    const credential = await getCredential(workspaceId, config.credentialId);
    if (!credential) throw flowError("CREDENTIAL_MISSING", "La credencial seleccionada ya no existe (flow_credentials_list para ver las vigentes).");
    applyCredentialAuth(headers, credential);
  }
  const body = config.body == null || method === "GET" || method === "DELETE" ? undefined
    : typeof config.body === "string" ? config.body : JSON.stringify(config.body);
  if (body && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) headers["content-type"] = "application/json";
  const response = await guardedFetch(config.url, { method, headers, ...(body ? { body } : {}) }, { resolveDns, timeoutMs: Number(config.timeoutMs) || 10_000 });
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

async function executeAi(node, config, context, { getCredential, deadline, workspaceId, edges, callTool, flowId }) {
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
  const promptPerItem = /\{\{\s*item\./.test(config.prompt);
  const remainingMs = Math.max(1_000, deadline - Date.now());
  const items = resolveItems(upstream, config.maxItems ?? LIMITS.defaultItemsPerTemplateNode);
  if (promptPerItem && items.length) {
    const budgetPerItem = Math.max(5_000, Math.floor(remainingMs / Math.max(1, items.length)));
    const out = [];
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const itemContext = { ...context, item, index };
      const prompt = deepResolve(config.prompt, itemContext);
      const systemPrompt = deepResolve(config.systemPrompt ?? "", itemContext) + memoryDigest;
      const result = await runAiText({ ...config, prompt, systemPrompt }, credential, { timeoutMs: Math.min(40_000, budgetPerItem) });
      out.push({ ...item, ai: result.text });
    }
    return { items: out };
  }
  const prompt = deepResolve(config.prompt, context);
  const systemPrompt = deepResolve(config.systemPrompt ?? "", context) + memoryDigest;
  const result = await runAiText({ ...config, prompt, systemPrompt }, credential, { timeoutMs: Math.min(40_000, remainingMs) });
  // Salida estructurada (plan E1): responseFormat:"json" parsea la respuesta
  // (tolerando fences) y la entrega como objeto en output.json.
  if (config.responseFormat === "json") {
    const cleaned = String(result.text ?? "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    const parsed = safeJsonParse(cleaned);
    if (parsed === undefined) {
      return { text: result.text, jsonParseError: "la respuesta no fue JSON válido", model: result.model, usage: result.usage };
    }
    return { json: parsed, model: result.model, usage: result.usage };
  }
  return { text: result.text, model: result.model, usage: result.usage };
}

async function getCredentialFor(config, workspaceId, getCredential) {
  // Misma firma que executeHttp: getCredential(workspaceId, id).
  const credential = await getCredential(workspaceId, config.credentialId);
  if (!credential) throw flowError("CREDENTIAL_MISSING", "La credencial ya no existe; créala de nuevo (flow_credentials_set) o elige otra en el nodo.");
  return { type: credential.type, provider: credential.provider, model: credential.model, secret: credential.secret, name: credential.name };
}

async function executeTemplateNode(node, config, context, { callTool, resolveTemplateWorkspace, workspaceId, flowName, edges }) {
  if (!callTool) throw flowError("RUNTIME_CONFIG", "El runtime no tiene herramientas internas conectadas.");
  if (!config.templateId || !config.frameId) {
    throw flowError("TEMPLATE_NOT_CONFIGURED", `El nodo "${node.label}" no tiene archivo+frame: elige archivo y frame exacto en el editor (o pídele a tu IA que lo configure con flow_save).`);
  }
  const templateWorkspace = await resolveTemplateWorkspace(config.templateId);
  if (templateWorkspace && workspaceId && templateWorkspace !== workspaceId) {
    throw flowError("TEMPLATE_NOT_IN_WORKSPACE", `El template ${config.templateId} pertenece a otro workspace.`);
  }
  const source = await callTool("get_html_frames", { templateId: config.templateId });
  const frames = source?.frames ?? [];
  const frame = frames.find((candidate) => candidate.id === config.frameId);
  if (!frame) {
    throw flowError("FRAME_NOT_FOUND", `El frame ${config.frameId} no existe en ${config.templateId}. Frames: ${frames.map((candidate) => `${candidate.id} (${candidate.name})`).join(", ") || "(ninguno)"}.`);
  }
  const upstream = upstreamOutput(node.id, edges, context.steps);
  const items = resolveItems(upstream, config.maxItems ?? LIMITS.defaultItemsPerTemplateNode);
  if (!items.length) throw flowError("TEMPLATE_NO_INPUT", "El nodo template no recibió items del nodo anterior; conecta una fuente o un nodo ai antes.");
  const day = new Date().toISOString().slice(0, 10);
  // Fase 1 — render puro de TODOS los items ANTES de crear nada: si un item
  // falla (p. ej. TEMPLATE_NO_TITLE_SLOT) no queda template huérfano vacío.
  items.map((item) => renderTemplateFrame(frame, templateValuesFromItem(item)));
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
    const values = templateValuesFromItem(items[index]);
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
Tipos y config: source_rss{url, limit?} | source_nitter{username, instanceUrl | url(rss directa), includeReposts?, limit?} | source_http{url, method?, headers?, body?, listPath?, credentialId?, limit?} | ai{provider: gemini|deepseek|glm|openrouter, model, prompt, systemPrompt?, maxOutputTokens?, credentialId, maxItems?, responseFormat?:"json"} | template{templateId, frameId, format: post|story|custom, maxItems?} | http{url, method?, headers?, body?, timeoutMs?, credentialId?} | map{value} | condition{path, operator, value?} | switch{path, rules:[{label, operator: equals|contains|greater_than|less_than|regex, value}...≤8], fallback?:bool} | loop{batchSize:1-50} | merge{mode: append|byKey|branch, key?, branch?} | wait{seconds:1-20} | subflow{flowId, inputs?} | code{js} | tool{tool, args?} | text{template} | report{title?} | note{text} (solo visual, sin edges). ai acepta memory{runs:1-10} (digest de últimos runs en el systemPrompt) y responseFormat:"json". El flow puede llevar vars{...} — constantes leídas como {{vars.nombre}}.
Edges: [{from, to, when?}]; condition exige when:"true"/"false"; switch usa las etiquetas de sus reglas o "fallback"; CUALQUIER nodo puede tener when:"error" (la rama se recorre solo si el nodo falla). retry:N reintenta N veces con backoff; onError:"continue" sigue el grafo tras un fallo.
Fan-in (varias entradas): solo ai, report, merge, loop y code. Placeholders {{input.x}}, {{steps.ID.y}}, {{item.x}}. Secretos NUNCA en config: credentialId (flow_credentials_set).
Pinning (debug): flow_run acepta input.__pins = {nodeId: <salida congelada>} — el nodo NO se ejecuta y usa esa salida.
Error workflow: un flow activo con trigger {type:"error"} se dispara solo cuando OTRO flow falla (recibe input.flowId, flowName, failedNode). Trigger: {type:"manual"} | {type:"webhook"} | {type:"schedule", cron, timezone} declarativo (flow_due_check + flow_run con requestId "cron:<flowId>:<slot>") | {type:"error"}.
Tags: flow_save acepta tags:[..≤10] para filtrar en el board; cada save archiva la versión anterior (flow_get devuelve versions[]).`;
