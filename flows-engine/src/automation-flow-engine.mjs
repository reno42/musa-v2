import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { Cron } from "croner";
import { workspaceDir } from "./config.mjs";
import { readJson, runtimePaths, writeJson } from "./runtime-store.mjs";
import { listAiModels, runAiText, validateAiConfig } from "./automation-ai.mjs";

const FLOW_LIMIT = 30;
const NODE_LIMIT = 24;
const EDGE_LIMIT = 60;
const RUN_LIMIT = 200;
const INPUT_LIMIT = 50_000;
const HTTP_RESPONSE_LIMIT = 256_000;
const RUN_TIMEOUT_MS = 55_000;
const TOOL_TIMEOUT_MS = 20_000;
const SECRET_FILE = path.join(workspaceDir, ".secrets", "automation-credentials.json");
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const FLOW_FILE = runtimePaths.automationFlows;
const RUN_FILE = runtimePaths.automationFlowRuns;

export const AUTOMATION_FLOW_OPERATIONS = ["flow_list", "flow_get", "flow_run", "flow_history"];
export const isSensitiveFlowHeader = (name) => /authorization|cookie|api[-_]?key|token|secret/i.test(name);

export function validateAutomationFlowStore(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.flows) || raw.flows.length > FLOW_LIMIT) throw new Error(`El builder admite hasta ${FLOW_LIMIT} flujos.`);
  const ids = new Set();
  const flows = raw.flows.map((flow) => {
    if (!flow || typeof flow !== "object" || !ID.test(flow.id ?? "")) throw new Error("Cada flujo debe tener un ID válido.");
    if (ids.has(flow.id)) throw new Error(`ID de flujo duplicado: ${flow.id}`);
    ids.add(flow.id);
    const name = String(flow.name ?? "").trim();
    if (!name || name.length > 80) throw new Error("El nombre del flujo debe tener entre 1 y 80 caracteres.");
    if (typeof flow.enabled !== "boolean") throw new Error(`El flujo ${name} debe indicar si está activo.`);
    const trigger = flow.trigger ?? null;
    if (trigger && !["manual", "webhook", "schedule"].includes(trigger.type)) throw new Error(`El flujo ${name} tiene un disparador no válido.`);
    if (!trigger && flow.enabled) throw new Error(`El flujo ${name} no puede activarse sin un disparador.`);
    const triggerX = Number(trigger?.position?.x); const triggerY = Number(trigger?.position?.y);
    const cleanTrigger = trigger ? { type: trigger.type, position: { x: Number.isFinite(triggerX) ? Math.max(-1_000_000, Math.min(1_000_000, triggerX)) : 28, y: Number.isFinite(triggerY) ? Math.max(-1_000_000, Math.min(1_000_000, triggerY)) : 30 } } : null;
    if (trigger?.type === "schedule") {
      const cron = String(trigger.cron ?? "").trim();
      const timezone = String(trigger.timezone ?? "America/Lima").trim();
      if (!cron || cron.length > 100) throw new Error(`El horario de ${name} no es válido.`);
      const test = new Cron(cron, { timezone }, () => {});
      const nextRun = test.nextRun(); test.stop();
      if (!nextRun) throw new Error(`El horario de ${name} no produce próximas ejecuciones.`);
      cleanTrigger.cron = cron; cleanTrigger.timezone = timezone;
      if (trigger.secretHash) cleanTrigger.secretHash = String(trigger.secretHash);
    } else if (trigger?.type === "webhook" && trigger.secretHash) cleanTrigger.secretHash = String(trigger.secretHash);

    if (!Array.isArray(flow.nodes) || flow.nodes.length > NODE_LIMIT) throw new Error(`El flujo ${name} admite hasta ${NODE_LIMIT} nodos.`);
    const nodeIds = new Set();
    const nodes = flow.nodes.map((node) => {
      if (!node || !ID.test(node.id ?? "") || nodeIds.has(node.id)) throw new Error(`ID de nodo inválido o duplicado en ${name}.`);
      nodeIds.add(node.id);
      if (!["http", "map", "condition", "tool", "ai"].includes(node.type)) throw new Error(`Tipo de nodo no admitido: ${node.type}`);
      if (!node.config || typeof node.config !== "object" || Array.isArray(node.config)) throw new Error(`El nodo ${node.id} necesita una configuración.`);
      let config = structuredClone(node.config);
      if (node.type === "http") {
        if (!/[A-Z]+/.test(String(config.method ?? "GET").toUpperCase())) throw new Error(`Método HTTP inválido en ${node.id}.`);
        if (config.headers != null && (!config.headers || typeof config.headers !== "object" || Array.isArray(config.headers) || Object.keys(config.headers).length > 30)) throw new Error(`Headers inválidos en ${node.id}.`);
        for (const [key, value] of Object.entries(config.headers ?? {})) if (!/^[A-Za-z0-9-]{1,80}$/.test(key) || typeof value !== "string" || value.length > 2000) throw new Error(`Header inválido en ${node.id}.`);
        if (config.credentialId && !ID.test(config.credentialId)) throw new Error(`Credencial inválida en ${node.id}.`);
      }
      if (node.type === "map" && (!config.value || typeof config.value !== "object" || Array.isArray(config.value))) throw new Error(`Map ${node.id} necesita un objeto.`);
      if (node.type === "condition" && (!String(config.path ?? "").match(/^(input|steps)\.[A-Za-z0-9_.-]+$/) || !["equals", "not_equals", "contains", "exists", "not_empty", "greater_than", "less_than"].includes(config.operator ?? "equals"))) throw new Error(`Condición inválida en ${node.id}.`);
      if (node.type === "tool" && (typeof config.toolName !== "string" || config.toolName.length > 200 || !config.arguments || typeof config.arguments !== "object" || Array.isArray(config.arguments))) throw new Error(`Tool node inválido en ${node.id}.`);
      if (node.type === "ai") {
        validateAiConfig(config, node.id);
        config = { provider: config.provider, model: String(config.model ?? "").trim(), systemPrompt: config.systemPrompt, prompt: config.prompt, maxOutputTokens: Number(config.maxOutputTokens ?? 1024), credentialId: config.credentialId };
      }
      const position = { x: Math.max(-1_000_000, Math.min(1_000_000, Number(node.position?.x) || 0)), y: Math.max(-1_000_000, Math.min(1_000_000, Number(node.position?.y) || 0)) };
      return { id: node.id, type: node.type, label: String(node.label ?? node.type).slice(0, 80), config, position };
    });
    if (!Array.isArray(flow.edges) || flow.edges.length > EDGE_LIMIT) throw new Error(`El flujo ${name} admite hasta ${EDGE_LIMIT} conexiones.`);
    const known = new Set([...(trigger ? ["trigger"] : []), ...nodeIds]);
    const edgeKeys = new Set();
    const incoming = new Map([...nodeIds].map((id) => [id, 0]));
    const outgoing = new Map([["trigger", []], ...[...nodeIds].map((id) => [id, []])]);
    const edges = flow.edges.map((edge) => {
      if (!known.has(edge.from) || !nodeIds.has(edge.to) || edge.from === edge.to) throw new Error(`Conexión inválida en ${name}.`);
      if (edge.from === "trigger" && !trigger) throw new Error(`El flujo ${name} tiene conexiones desde un disparador eliminado.`);
      if (edge.from === "trigger" && edge.when) throw new Error("El disparador no admite rutas condicionales.");
      const source = nodes.find((node) => node.id === edge.from);
      if (edge.when && (source?.type !== "condition" || !["true", "false"].includes(edge.when))) throw new Error("Las rutas true/false solo salen de nodos condición.");
      if (source?.type === "condition" && !["true", "false"].includes(edge.when)) throw new Error("Cada salida de una condición debe indicar true o false.");
      const key = `${edge.from}>${edge.to}:${edge.when ?? ""}`;
      if (edgeKeys.has(key)) throw new Error("Hay conexiones duplicadas.");
      edgeKeys.add(key);
      incoming.set(edge.to, incoming.get(edge.to) + 1);
      outgoing.get(edge.from).push(edge);
      return { from: edge.from, to: edge.to, ...(edge.when ? { when: edge.when } : {}) };
    });
    if ([...incoming.values()].some((count) => count > 1)) throw new Error("El MVP permite una sola conexión entrante por nodo; divide ramas en nodos separados.");
    const visiting = new Set(); const visited = new Set();
    function visit(id) {
      if (visiting.has(id)) throw new Error(`El flujo ${name} contiene un ciclo.`);
      if (visited.has(id)) return;
      visiting.add(id);
      for (const edge of outgoing.get(id) ?? []) visit(edge.to);
      visiting.delete(id); visited.add(id);
    }
    for (const id of known) visit(id);
    if (flow.enabled && nodes.length === 0) throw new Error(`El flujo ${name} necesita al menos un nodo antes de activarse.`);
    if (flow.enabled && nodes.some((node) => incoming.get(node.id) === 0) && outgoing.get("trigger").length === 0) throw new Error(`Conecta el disparador del flujo ${name} al primer nodo.`);
    const reachable = new Set(); const queue = outgoing.get("trigger").map((edge) => edge.to);
    while (queue.length) { const id = queue.shift(); if (reachable.has(id)) continue; reachable.add(id); for (const edge of outgoing.get(id) ?? []) queue.push(edge.to); }
    if (flow.enabled && trigger && nodes.some((node) => !reachable.has(node.id))) throw new Error(`Todos los nodos de ${name} deben poder alcanzarse desde el disparador.`);
    return {
      id: flow.id, name, enabled: flow.enabled, trigger: cleanTrigger, nodes, edges,
      createdAt: flow.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
  });
  return { version: 1, flows };
}

function hashSecret(secret) { return createHash("sha256").update(secret).digest("hex"); }
function secretMatches(secret, digest) {
  if (!secret || !digest) return false;
  const actual = Buffer.from(hashSecret(secret), "hex"); const expected = Buffer.from(digest, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function publicFlow(flow) {
  if (!flow.trigger) return flow;
  const { secretHash, ...trigger } = flow.trigger;
  return { ...flow, trigger };
}
function deepResolve(value, context) {
  if (Array.isArray(value)) return value.map((item) => deepResolve(item, context));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepResolve(item, context)]));
  if (typeof value !== "string") return value;
  const exact = value.match(/^\{\{\s*(input|steps)\.([A-Za-z0-9_.-]+)\s*\}\}$/);
  const lookupPath = (source, key) => key.split(".").reduce((item, part) => item?.[part], source);
  if (exact) return lookupPath(context[exact[1]], exact[2]);
  return value.replace(/\{\{\s*(input|steps)\.([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, source, key) => {
    const resolved = lookupPath(context[source], key);
    return resolved == null ? "" : typeof resolved === "string" ? resolved : JSON.stringify(resolved);
  });
}
function parseToolResult(result) {
  if (result?.isError) throw new Error(result.content?.find((item) => item.type === "text")?.text ?? "La herramienta conectada falló.");
  const text = result?.content?.find((item) => item.type === "text")?.text;
  if (!text) return result?.structuredContent ?? { ok: true };
  try { return JSON.parse(text); } catch { return { text: text.slice(0, 100_000) }; }
}
function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}

function blockedIp(address) {
  if (address.includes(":")) {
    const value = address.toLowerCase();
    return value === "::" || value === "::1" || /^f[cd]/.test(value) || /^fe[89ab]/.test(value) || value.startsWith("::ffff:127.");
  }
  const parts = address.split(".").map(Number); const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 2 && parts[2] === 0))) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19 || (b === 51 && parts[2] === 100))) || (a === 203 && b === 0 && parts[2] === 113) || a >= 224;
}
async function assertPublicHttps(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("La URL del nodo HTTP no es válida."); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Las llamadas HTTP deben usar HTTPS y no incluir credenciales en la URL.");
  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost") || isIP(url.hostname)) throw new Error("El nodo HTTP no puede llamar a direcciones locales o literales IP.");
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => blockedIp(address))) throw new Error("El nodo HTTP no puede llamar a dominios que resuelvan a una red privada o reservada.");
  return url;
}
async function readLimited(response, maxBytes = HTTP_RESPONSE_LIMIT) {
  const declared = Number(response.headers.get("content-length"));
  if (declared > maxBytes) throw new Error(`La respuesta HTTP supera el límite de ${maxBytes} bytes.`);
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = []; let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw new Error(`La respuesta HTTP supera el límite de ${maxBytes} bytes.`); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function createAutomationFlowEngine({
  filePath = FLOW_FILE,
  runFilePath = RUN_FILE,
  credentialFilePath = SECRET_FILE,
  getAvailableTools = () => [],
  callTool = async () => { throw new Error("No hay conexión de herramientas activa."); },
  fetchAi = fetch,
  logger = console,
  now = () => new Date(),
} = {}) {
  const loadedStore = await readJson(filePath, { version: 1, flows: [] });
  let store;
  try { store = validateAutomationFlowStore(loadedStore); }
  catch (error) { logger.error(`[automation-flow] saved flow data failed validation; keeping the file untouched: ${error.message}`); store = { version: 1, flows: [] }; }
  let runStore = await readJson(runFilePath, { runs: [] });
  runStore.runs ??= [];
  for (const run of runStore.runs) if (run.status === "running") { run.status = "interrupted"; run.finishedAt = now().toISOString(); }
  const schedules = new Map(); const inFlight = new Map(); const idempotency = new Map();
  let pendingFlowWrite = Promise.resolve();
  function serializeFlowWrite(operation) {
    const next = pendingFlowWrite.then(operation, operation);
    pendingFlowWrite = next.catch(() => {});
    return next;
  }

  async function persistFlows() { await writeJson(filePath, store); }
  async function persistRuns() { runStore.runs = runStore.runs.slice(-RUN_LIMIT); await writeJson(runFilePath, runStore); }
  async function loadCredentials() {
    try { return JSON.parse(await readFile(credentialFilePath, "utf8")); }
    catch (error) { if (error?.code === "ENOENT") return { credentials: [] }; throw error; }
  }
  async function saveCredentials(value) {
    await mkdir(path.dirname(credentialFilePath), { recursive: true });
    await writeFile(credentialFilePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }
  function scheduleFlow(flow) {
    schedules.get(flow.id)?.stop(); schedules.delete(flow.id);
    if (!flow.enabled || flow.trigger?.type !== "schedule") return;
    const job = new Cron(flow.trigger.cron, { timezone: flow.trigger.timezone, protect: true }, () => {
      runFlow(flow.id, { scheduledAt: now().toISOString() }, "schedule").catch((error) => logger.error(`[automation-flow] scheduled flow ${flow.id} failed: ${error.message}`));
    });
    schedules.set(flow.id, job);
  }
  function scheduleAll() { for (const flow of store.flows) scheduleFlow(flow); }
  scheduleAll();

  function snapshot() {
    return { version: store.version, flows: store.flows.map(publicFlow), total: store.flows.length, limits: { flows: FLOW_LIMIT, nodesPerFlow: NODE_LIMIT, edgesPerFlow: EDGE_LIMIT, maxRunMs: RUN_TIMEOUT_MS } };
  }
  function history({ flowId, limit = 30 } = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 30, 100));
    return runStore.runs.filter((run) => !flowId || run.flowId === flowId).slice(-safeLimit).reverse();
  }

  async function saveUnlocked(raw, { preserveOmitted = false, checkRevisions = false } = {}) {
    const previous = new Map(store.flows.map((flow) => [flow.id, flow]));
    if (checkRevisions) for (const incoming of raw.flows ?? []) {
      const old = previous.get(incoming.id);
      if (old && incoming.updatedAt !== old.updatedAt) throw new Error(`El flujo ${old.name} cambió en otra sesión. Recarga el editor antes de guardar.`);
    }
    const incomingIds = new Set(raw.flows?.map((flow) => flow.id));
    const incomingFlows = preserveOmitted
      ? [...raw.flows, ...store.flows.filter((flow) => !incomingIds.has(flow.id))]
      : raw.flows;
    const normalized = validateAutomationFlowStore({ ...raw, flows: incomingFlows });
    const revealedSecrets = {};
    for (const flow of normalized.flows) {
      const old = previous.get(flow.id);
      if (flow.trigger?.type === "webhook") {
        if (old?.trigger?.type === "webhook" && !incomingFlows.find((item) => item.id === flow.id)?.rotateSecret) flow.trigger.secretHash = old.trigger.secretHash;
        else {
          const secret = randomBytes(32).toString("base64url");
          flow.trigger.secretHash = hashSecret(secret); revealedSecrets[flow.id] = secret;
        }
      }
      flow.createdAt = old?.createdAt ?? flow.createdAt;
      const content = ({ name, enabled, trigger, nodes, edges }) => JSON.stringify({ name, enabled, trigger, nodes, edges });
      const previousTime = old ? Date.parse(old.updatedAt) : NaN;
      const nextTime = Math.max(now().getTime(), Number.isFinite(previousTime) ? previousTime + 1 : 0);
      flow.updatedAt = old && content(flow) === content(old) ? old.updatedAt : new Date(nextTime).toISOString();
    }
    store = normalized;
    await persistFlows(); scheduleAll();
    logger.info(`[automation-flow] saved ${store.flows.length} flows`);
    return { ...snapshot(), revealedSecrets };
  }
  function save(raw, options) { return serializeFlowWrite(() => saveUnlocked(raw, options)); }

  function validateDraft(raw) {
    if (raw?.enabled) throw new Error("Los agentes solo pueden preparar borradores; actívalo desde el editor local.");
    for (const node of raw?.nodes ?? []) {
      const headers = node?.type === "http" ? node.config?.headers : null;
      if (headers && typeof headers === "object" && Object.keys(headers).some(isSensitiveFlowHeader)) {
        throw new Error("No incluyas secretos en headers del grafo; crea una credencial en el editor local y usa credentialId.");
      }
    }
    const id = ID.test(raw?.id ?? "") ? raw.id : `flow_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const flow = { id, name: raw?.name, enabled: false, trigger: raw?.trigger ?? null, nodes: raw?.nodes ?? [], edges: raw?.edges ?? [] };
    return publicFlow(validateAutomationFlowStore({ version: 1, flows: [flow] }).flows[0]);
  }

  function createDraft(raw) {
    return serializeFlowWrite(async () => {
      const draft = validateDraft(raw);
      if (store.flows.some((flow) => flow.id === draft.id)) throw new Error(`El flujo ${draft.id} ya existe.`);
      const saved = await saveUnlocked({ version: 1, flows: [...store.flows, draft] });
      return { flow: saved.flows.find((flow) => flow.id === draft.id), webhookSecretNeedsRotation: draft.trigger?.type === "webhook" };
    });
  }

  function updateDraft(flowId, expectedUpdatedAt, raw) {
    return serializeFlowWrite(async () => {
      const old = store.flows.find((flow) => flow.id === flowId);
      if (!old) throw new Error(`No existe el flujo ${flowId}.`);
      if (old.enabled) throw new Error("Pausa este flujo desde el editor local antes de editarlo con un agente.");
      if (!expectedUpdatedAt || expectedUpdatedAt !== old.updatedAt) throw new Error("El flujo cambió en otra sesión. Consulta su versión actual antes de actualizarlo.");
      if (raw?.id && raw.id !== flowId) throw new Error("No se puede cambiar el ID del flujo.");
      const draft = validateDraft({ ...raw, id: flowId });
      const saved = await saveUnlocked({ version: 1, flows: store.flows.map((flow) => flow.id === flowId ? { ...draft, createdAt: old.createdAt } : flow) });
      return { flow: saved.flows.find((flow) => flow.id === flowId), webhookSecretNeedsRotation: draft.trigger?.type === "webhook" && old.trigger?.type !== "webhook" };
    });
  }

  function rotateSecret(flowId) {
    return serializeFlowWrite(async () => {
      const flow = store.flows.find((item) => item.id === flowId);
      if (!flow || flow.trigger?.type !== "webhook") throw new Error("Ese flujo no tiene disparador webhook.");
      const secret = randomBytes(32).toString("base64url");
      flow.trigger.secretHash = hashSecret(secret);
      flow.updatedAt = new Date(Math.max(now().getTime(), Date.parse(flow.updatedAt) + 1)).toISOString();
      await persistFlows();
      logger.info(`[automation-flow] rotated webhook secret for ${flowId}`);
      return { flowId, secret };
    });
  }

  async function credentialList() {
    const data = await loadCredentials();
    return data.credentials.map(({ id, name, type, provider, headerName, updatedAt }) => ({ id, name, type, ...(provider ? { provider } : {}), ...(headerName ? { headerName } : {}), updatedAt }));
  }
  async function saveCredential(raw) {
    const name = String(raw.name ?? "").trim().slice(0, 80);
    const type = String(raw.type ?? "");
    if (!name || !["bearer", "api_key", "basic"].includes(type)) throw new Error("Indica nombre y tipo de credencial válido.");
    const provider = String(raw.provider ?? "");
    if (provider && (!["gemini", "deepseek", "glm"].includes(provider) || (provider === "gemini" ? type !== "api_key" : type !== "bearer"))) throw new Error("Proveedor o tipo de credencial IA inválido.");
    const data = await loadCredentials(); data.credentials ??= [];
    let credential = data.credentials.find((item) => item.id === raw.id);
    if (raw.id && !credential) throw new Error("No se encontró la credencial que quieres actualizar.");
    const secret = String(raw.secret ?? "");
    if (!credential && !secret) throw new Error("La credencial necesita un secreto.");
    if (!credential) { credential = { id: `cred_${randomUUID().slice(0, 12)}`, createdAt: now().toISOString() }; data.credentials.push(credential); }
    credential.name = name; credential.type = type; credential.updatedAt = now().toISOString();
    if (provider) credential.provider = provider; else delete credential.provider;
    if (type === "api_key") {
      const headerName = String(raw.headerName ?? "").trim();
      if (!/^[A-Za-z0-9-]{1,80}$/.test(headerName) || /^(host|content-length|connection|cookie)$/i.test(headerName)) throw new Error("Nombre de header de API key no válido.");
      credential.headerName = headerName;
      if (provider === "gemini" && headerName.toLowerCase() !== "x-goog-api-key") throw new Error("Gemini requiere el header x-goog-api-key.");
    } else delete credential.headerName;
    if (secret) credential.secret = secret;
    if (type === "basic") {
      const username = String(raw.username ?? "");
      if (!username || username.length > 250) throw new Error("Usuario Basic inválido.");
      credential.username = username;
    } else delete credential.username;
    await saveCredentials(data);
    logger.info(`[automation-flow] saved credential metadata ${credential.id} (${type})`);
    return { id: credential.id, name: credential.name, type: credential.type, provider: credential.provider, headerName: credential.headerName, updatedAt: credential.updatedAt };
  }
  async function deleteCredential(id) {
    const data = await loadCredentials(); const before = data.credentials?.length ?? 0;
    data.credentials = (data.credentials ?? []).filter((item) => item.id !== id);
    if (data.credentials.length === before) throw new Error("Credencial no encontrada.");
    await saveCredentials(data); logger.info(`[automation-flow] deleted credential ${id}`); return { deleted: id };
  }

  async function availableAiModels(provider, credentialId) {
    if (provider === "glm") return listAiModels(provider, null, fetchAi);
    if (!ID.test(credentialId ?? "")) throw new Error("Selecciona una credencial IA para consultar modelos.");
    const data = await loadCredentials();
    return listAiModels(provider, data.credentials?.find((item) => item.id === credentialId), fetchAi);
  }

  function getAtPath(value, expression) {
    const parts = String(expression ?? "").split(".");
    const root = parts.shift();
    if (root === "input") return parts.reduce((item, key) => item?.[key], value.input);
    if (root === "steps") { const id = parts.shift(); return parts.reduce((item, key) => item?.[key], value.steps[id]); }
    throw new Error("Usa rutas input.campo o steps.ID.campo.");
  }

  async function executeNode(node, context, deadline) {
    const config = deepResolve(node.config, context);
    if (node.type === "map") {
      if (!config.value || typeof config.value !== "object" || Array.isArray(config.value)) throw new Error("El nodo Map necesita un objeto de salida.");
      return config.value;
    }
    if (node.type === "condition") {
      const left = getAtPath(context, config.path);
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
    if (node.type === "tool") {
      const name = String(config.toolName ?? "");
      const available = getAvailableTools().map((tool) => typeof tool === "string" ? tool : tool.name);
      if (!available.includes(name) || name === "assistant__automation") throw new Error(`La herramienta ${name || "(vacía)"} no está habilitada para nodos de flujo.`);
      const raw = await withTimeout(callTool(name, config.arguments ?? {}), TOOL_TIMEOUT_MS, `La herramienta ${name} excedió ${TOOL_TIMEOUT_MS / 1000}s.`);
      return parseToolResult(raw);
    }
    if (node.type === "ai") {
      const credentials = await loadCredentials();
      return runAiText(config, credentials.credentials?.find((item) => item.id === config.credentialId), fetchAi, Math.max(1, Math.min(40_000, deadline - Date.now())));
    }
    if (node.type === "http") {
      const method = String(config.method ?? "GET").toUpperCase();
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) throw new Error("Método HTTP no admitido.");
      const url = await assertPublicHttps(String(config.url ?? ""));
      const headers = { accept: "application/json", ...(config.headers ?? {}) };
      for (const key of Object.keys(headers)) if (/^(host|content-length|connection|cookie)$/i.test(key)) throw new Error(`El header ${key} no se puede configurar.`);
      if (config.credentialId) {
        const credentials = await loadCredentials();
        const credential = credentials.credentials?.find((item) => item.id === config.credentialId);
        if (!credential) throw new Error("La credencial HTTP seleccionada ya no existe.");
        if (credential.provider) throw new Error("Las credenciales IA están reservadas para su proveedor; usa una credencial HTTP separada.");
        if (credential.type === "bearer") headers.authorization = `Bearer ${credential.secret}`;
        else if (credential.type === "api_key") headers[credential.headerName] = credential.secret;
        else if (credential.type === "basic") headers.authorization = `Basic ${Buffer.from(`${credential.username}:${credential.secret}`).toString("base64")}`;
      }
      const body = config.body == null || method === "GET" || method === "DELETE" ? undefined : typeof config.body === "string" ? config.body : JSON.stringify(config.body);
      if (body && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) headers["content-type"] = "application/json";
      let target = url; let response;
      for (let redirects = 0; redirects <= 3; redirects++) {
        await assertPublicHttps(target.href);
        response = await fetch(target, { method, headers, ...(body ? { body } : {}), redirect: "manual", signal: AbortSignal.timeout(Math.min(15_000, Math.max(1_000, Number(config.timeoutMs) || 10_000))) });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get("location");
        if (!location || redirects === 3) throw new Error("La API excedió el límite de redirecciones seguras.");
        const nextTarget = new URL(location, target);
        if (nextTarget.hostname !== target.hostname) throw new Error("La API intentó redirigir la llamada a otro dominio; se bloqueó para proteger las credenciales.");
        target = nextTarget;
        if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) throw new Error("Redirección que cambia el método HTTP no admitida.");
      }
      const text = await readLimited(response);
      let responseBody = text;
      if (/json/i.test(response.headers.get("content-type") ?? "")) { try { responseBody = JSON.parse(text); } catch {} }
      const output = { status: response.status, ok: response.ok, headers: Object.fromEntries(["content-type", "retry-after", "x-request-id"].map((key) => [key, response.headers.get(key)]).filter(([, value]) => value != null)), body: responseBody };
      if (!response.ok) throw Object.assign(new Error(`La API respondió HTTP ${response.status}. Revisa el detalle de respuesta solo en el contexto de la ejecución.`), { httpStatus: response.status, output });
      return output;
    }
    throw new Error(`Tipo de nodo sin ejecutor: ${node.type}`);
  }

  async function runFlow(flowId, input = {}, triggerType = "manual", requestId = "") {
    const flow = store.flows.find((item) => item.id === flowId);
    if (!flow) throw new Error("Flujo no encontrado.");
    if (!flow.trigger) throw new Error("El flujo no tiene un disparador. Añade uno antes de ejecutarlo.");
    if (!flow.enabled) throw new Error("El flujo está pausado. Actívalo desde el builder antes de ejecutarlo.");
    if (!input || typeof input !== "object" || Array.isArray(input) || Buffer.byteLength(JSON.stringify(input), "utf8") > INPUT_LIMIT) throw new Error(`Los datos de entrada deben ser un objeto de hasta ${INPUT_LIMIT} bytes.`);
    const dedupeHash = requestId ? hashSecret(`${flowId}:${requestId}`) : "";
    if (dedupeHash) {
      const existing = runStore.runs.find((run) => run.dedupeHash === dedupeHash);
      if (existing) return { ...runSummary(existing), duplicate: true };
      if (idempotency.has(dedupeHash)) return idempotency.get(dedupeHash);
    }
    const runId = `run_${randomUUID()}`;
    const run = { id: runId, flowId, flowName: flow.name, trigger: triggerType, status: "running", startedAt: now().toISOString(), nodeRuns: [], dedupeHash: dedupeHash || undefined };
    runStore.runs.push(run); await persistRuns();
    const task = (async () => {
      const deadline = Date.now() + RUN_TIMEOUT_MS;
      const context = { input, steps: {} }; const aiOutputs = {};
      const nodes = new Map(flow.nodes.map((node) => [node.id, node]));
      const outgoing = new Map([["trigger", []], ...flow.nodes.map((node) => [node.id, []])]);
      for (const edge of flow.edges) outgoing.get(edge.from).push(edge);
      const queue = outgoing.get("trigger").map((edge) => edge.to); const completed = new Set();
      try {
        while (queue.length) {
          if (Date.now() > deadline) throw new Error("La ejecución superó el máximo de 55 segundos.");
          const id = queue.shift(); if (completed.has(id)) continue;
          const node = nodes.get(id); if (!node) continue; completed.add(id);
          const startedAt = now().toISOString();
          const record = { nodeId: id, label: node.label, type: node.type, status: "running", startedAt };
          run.nodeRuns.push(record); await persistRuns();
          try {
            const output = await executeNode(node, context, deadline);
            context.steps[id] = output;
            if (node.type === "ai") aiOutputs[id] = output.text.slice(0, 20_000);
            record.status = "success"; record.finishedAt = now().toISOString();
            if (node.type === "http") { record.httpStatus = output.status; record.host = new URL(deepResolve(node.config.url, context)).host; }
            await persistRuns();
            const condition = node.type === "condition" ? output.passed : null;
            for (const edge of outgoing.get(id)) if (condition === null || edge.when === String(condition)) queue.push(edge.to);
          } catch (error) {
            record.status = "error"; record.finishedAt = now().toISOString(); record.error = String(error.message ?? error).slice(0, 1500); record.httpStatus = error.httpStatus ?? undefined;
            await persistRuns(); throw error;
          }
        }
        run.status = "success"; run.finishedAt = now().toISOString(); run.elapsedMs = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
        await persistRuns(); logger.info(`[automation-flow] run ${runId} completed flow=${flowId} steps=${run.nodeRuns.length}`);
        return { ...runSummary(run), ...(Object.keys(aiOutputs).length ? { aiOutputs } : {}) };
      } catch (error) {
        run.status = "error"; run.finishedAt = now().toISOString(); run.elapsedMs = Date.parse(run.finishedAt) - Date.parse(run.startedAt); run.error = String(error.message ?? error).slice(0, 1500);
        await persistRuns(); logger.error(`[automation-flow] run ${runId} failed flow=${flowId}: ${run.error}`);
        return runSummary(run);
      }
    })();
    inFlight.set(runId, task);
    if (dedupeHash) idempotency.set(dedupeHash, task);
    try { return await task; }
    finally { inFlight.delete(runId); if (dedupeHash) idempotency.delete(dedupeHash); }
  }
  function runSummary(run) {
    return { id: run.id, flowId: run.flowId, flowName: run.flowName, trigger: run.trigger, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt, elapsedMs: run.elapsedMs, error: run.error, nodeRuns: run.nodeRuns.map(({ nodeId, label, type, status, startedAt, finishedAt, error, httpStatus }) => ({ nodeId, label, type, status, startedAt, finishedAt, ...(error ? { error } : {}), ...(httpStatus ? { httpStatus } : {}) })) };
  }

  async function handleWebhook(flowId, suppliedSecret, input, requestId = "") {
    const flow = store.flows.find((item) => item.id === flowId);
    if (!flow || flow.trigger?.type !== "webhook" || !flow.enabled) throw Object.assign(new Error("Webhook inexistente o desactivado."), { statusCode: 404 });
    if (!secretMatches(suppliedSecret, flow.trigger.secretHash)) throw Object.assign(new Error("Secreto del webhook inválido."), { statusCode: 401 });
    return runFlow(flowId, input, "webhook", requestId);
  }

  async function call(args = {}) {
    const operation = String(args.operation ?? "");
    try {
      if (operation === "flow_list") return { flows: snapshot().flows.map(({ id, name, enabled, trigger, nodes }) => ({ id, name, enabled, trigger: trigger?.type ?? null, steps: nodes.length })) };
      if (operation === "flow_get") {
        const flow = store.flows.find((item) => item.id === args.flowId);
        if (!flow) throw new Error("Flujo no encontrado.");
        return publicFlow(flow);
      }
      if (operation === "flow_history") return { runs: history({ flowId: args.flowId, limit: args.limit }) };
      if (operation === "flow_run") {
        const run = await runFlow(String(args.flowId ?? ""), args.input ?? {}, "manual");
        return run.status === "success" ? run : { ...run, isError: true };
      }
      throw new Error("Operación de flujo desconocida.");
    } catch (error) { return { error: error.message, isError: true }; }
  }

  async function close() { for (const task of schedules.values()) task.stop(); schedules.clear(); }
  return { snapshot, history, save, validateDraft, createDraft, updateDraft, rotateSecret, credentialList, saveCredential, deleteCredential, availableAiModels, run: runFlow, handleWebhook, call, close };
}
