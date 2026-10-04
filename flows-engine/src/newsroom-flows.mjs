import { getNewsroomConfig, readJson, runtimePaths, writeJson } from "./runtime-store.mjs";

const MAX_FLOWS = 20;
const MAX_NODES = 100;
const MAX_EDGES = 300;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const WORKSPACE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SOURCE_TYPES = new Set(["rss", "nitter"]);
const NODE_TYPES = new Set(["schedule", "rss", "nitter", "filter", "design", "musa", "report"]);
const NEXT_TYPES = {
  schedule: new Set(["rss", "nitter"]),
  rss: new Set(["filter", "design"]),
  nitter: new Set(["filter", "design"]),
  filter: new Set(["filter", "design"]),
  design: new Set(["musa"]),
  musa: new Set(["report"]),
  report: new Set(),
};
const migrations = new Map();

function invalid(message) {
  throw Object.assign(new Error(message), { statusCode: 400 });
}

function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${name} debe ser un objeto.`);
  return value;
}

function string(value, name, max = 120, optional = false) {
  if (optional && (value == null || value === "")) return "";
  if (typeof value !== "string") invalid(`${name} debe ser texto.`);
  const result = value.trim();
  if (!result || result.length > max) invalid(`${name} debe tener entre 1 y ${max} caracteres.`);
  return result;
}

function identifier(value, name) {
  if (typeof value !== "string" || !ID.test(value)) invalid(`${name} no es válido.`);
  return value;
}

function workspaceIdentifier(value) {
  if (typeof value !== "string" || !WORKSPACE_ID.test(value)) invalid("El workspace de Musa no es válido.");
  return value;
}

function noExtraKeys(value, allowed, name) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) invalid(`${name}: campo no admitido «${key}».`);
  }
}

function httpsUrl(value, name, originOnly = false) {
  let parsed;
  try { parsed = new URL(string(value, name, 2048)); }
  catch { invalid(`${name} debe ser una URL HTTPS válida.`); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) invalid(`${name} debe usar HTTPS y no incluir credenciales.`);
  if ([...parsed.searchParams.keys()].some((key) => /^(?:api[_-]?key|access[_-]?token|token|secret|password|auth(?:orization)?)$/i.test(key))) {
    invalid(`${name} no debe incluir credenciales en la URL.`);
  }
  if (originOnly && (parsed.pathname !== "/" || parsed.search || parsed.hash)) invalid(`${name} debe contener solo el dominio de la instancia.`);
  parsed.hash = "";
  return originOnly ? parsed.origin : parsed.toString();
}

function clockTime(value, name) {
  const time = string(value, name, 5);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) invalid(`${name} debe tener formato HH:MM.`);
  return time;
}

function keywords(value, name) {
  if (!Array.isArray(value) || value.length > 30) invalid(`${name} debe ser una lista de hasta 30 palabras o frases.`);
  return value.map((item) => string(item, name, 80));
}

function normalizeConfig(type, value, allowIncomplete) {
  const config = object(value ?? {}, `Configuración de ${type}`);
  switch (type) {
    case "schedule": {
      noExtraKeys(config, ["buildTime", "reportTime"], type);
      const buildTime = allowIncomplete && !config.buildTime ? "" : clockTime(config.buildTime, "Hora de ejecución");
      const reportTime = allowIncomplete && !config.reportTime ? "" : clockTime(config.reportTime, "Hora del reporte");
      if (buildTime && reportTime && reportTime <= buildTime) invalid("La hora del reporte debe ser posterior a la ejecución.");
      return { buildTime, reportTime };
    }
    case "rss":
      noExtraKeys(config, ["url"], type);
      return { url: allowIncomplete && !config.url ? "" : httpsUrl(config.url, "URL del RSS") };
    case "nitter": {
      noExtraKeys(config, ["instanceUrl", "username", "includeReposts"], type);
      const username = allowIncomplete && !config.username ? "" : string(config.username, "Usuario de Nitter", 16).replace(/^@/, "");
      if ((!username && !allowIncomplete) || (username && !/^[A-Za-z0-9_]{1,15}$/.test(username))) invalid("El usuario de Nitter no es válido.");
      if (config.includeReposts != null && typeof config.includeReposts !== "boolean") invalid("Incluir compartidos debe ser verdadero o falso.");
      return { instanceUrl: allowIncomplete && !config.instanceUrl ? "" : httpsUrl(config.instanceUrl, "Instancia de Nitter", true), username, includeReposts: config.includeReposts === true };
    }
    case "filter": {
      noExtraKeys(config, ["includeKeywords", "excludeKeywords", "media", "kind"], type);
      const media = config.media ?? "any";
      if (!["any", "image", "video"].includes(media)) invalid("El filtro de medios debe ser any, image o video.");
      const kind = config.kind ?? "any";
      if (!["any", "repost", "original"].includes(kind)) invalid("El tipo de publicación debe ser any, repost u original.");
      return { includeKeywords: keywords(config.includeKeywords ?? [], "Palabras incluidas"), excludeKeywords: keywords(config.excludeKeywords ?? [], "Palabras excluidas"), media, kind };
    }
    case "design": {
      noExtraKeys(config, ["mode", "templateId", "postTemplateId", "postFrameId", "storyTemplateId", "storyFrameId"], type);
      const mode = config.mode === "musa" ? "musa" : config.mode === "builtin" ? "builtin" : null;
      if (!mode) invalid("El diseño debe ser builtin o musa.");
      const legacyTemplateId = config.templateId ?? "";
      const design = {
        mode,
        postTemplateId: string(config.postTemplateId ?? legacyTemplateId, "ID de plantilla de post", 128, true),
        postFrameId: string(config.postFrameId, "ID del post", 128, true),
        storyTemplateId: string(config.storyTemplateId ?? (config.storyFrameId ? legacyTemplateId : ""), "ID de plantilla de story", 128, true),
        storyFrameId: string(config.storyFrameId, "ID de la story", 128, true),
      };
      for (const key of ["postTemplateId", "postFrameId", "storyTemplateId", "storyFrameId"]) {
        if (design[key] && !/^[A-Za-z0-9_-]{1,128}$/.test(design[key])) invalid(`El ${key} no es válido.`);
      }
      if (!allowIncomplete && mode === "musa" && (!design.postTemplateId || !design.postFrameId)) invalid("Selecciona una plantilla de Musa y su frame de post.");
      if (!allowIncomplete && mode === "musa" && Boolean(design.storyTemplateId) !== Boolean(design.storyFrameId)) invalid("Selecciona la plantilla y el frame de story, o deja ambos vacíos.");
      if (design.storyTemplateId === design.postTemplateId && design.storyFrameId && design.storyFrameId === design.postFrameId) invalid("Post y story deben usar frames distintos en la misma plantilla.");
      return design;
    }
    case "musa":
    case "report":
      noExtraKeys(config, [], type);
      return {};
    default:
      invalid(`Tipo de bloque desconocido: ${type}.`);
  }
}

export function validateNewsroomSource(type, rawConfig) {
  if (!SOURCE_TYPES.has(type)) invalid("La fuente debe ser RSS o Nitter.");
  return normalizeConfig(type, rawConfig, false);
}

function normalizeNode(raw, flowName, allowIncomplete) {
  const node = object(raw, `Bloque de ${flowName}`);
  if (node.enabled != null && typeof node.enabled !== "boolean") invalid("El estado del bloque debe ser verdadero o falso.");
  const id = identifier(node.id, "ID del bloque");
  const type = string(node.type, "Tipo de bloque", 30);
  if (!NODE_TYPES.has(type)) invalid(`Tipo de bloque desconocido: ${type}.`);
  const position = object(node.position ?? { x: 0, y: 0 }, `Posición de ${id}`);
  if (![position.x, position.y].every((value) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 100_000)) {
    invalid(`La posición del bloque ${id} no es válida.`);
  }
  return {
    id,
    type,
    label: string(node.label ?? type, `Nombre del bloque ${id}`, 80),
    enabled: node.enabled !== false,
    config: normalizeConfig(type, node.config, allowIncomplete),
    position: { x: position.x, y: position.y },
  };
}

function normalizeFlow(raw) {
  const flow = object(raw, "Flujo");
  const id = identifier(flow.id, "ID del flujo");
  const name = string(flow.name, "Nombre del flujo", 80);
  const workspaceId = workspaceIdentifier(flow.workspaceId);
  if (flow.enabled != null && typeof flow.enabled !== "boolean") invalid(`El estado del flujo «${name}» debe ser verdadero o falso.`);
  const enabled = flow.enabled !== false;
  const maxItems = Number(flow.maxItems);
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 10) invalid(`El flujo «${name}» debe usar entre 1 y 10 noticias.`);
  if (!Array.isArray(flow.nodes) || flow.nodes.length > MAX_NODES) invalid(`El flujo «${name}» admite hasta ${MAX_NODES} bloques.`);
  if (!Array.isArray(flow.edges) || flow.edges.length > MAX_EDGES) invalid(`El flujo «${name}» admite hasta ${MAX_EDGES} conexiones.`);

  const nodes = flow.nodes.map((node) => normalizeNode(node, name, !enabled));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (byId.size !== nodes.length) invalid(`Hay IDs de bloques repetidos en «${name}».`);
  for (const type of ["schedule", "design", "musa", "report"]) {
    const count = nodes.filter((node) => node.type === type).length;
    if ((enabled && ["design", "musa"].includes(type) && count !== 1) || count > 1) invalid(`El flujo «${name}» requiere un bloque de diseño y uno de Musa; horario y reporte son opcionales y únicos.`);
  }
  if (enabled && !nodes.some((node) => SOURCE_TYPES.has(node.type))) invalid(`El flujo «${name}» necesita una fuente RSS o Nitter.`);

  const edgeKeys = new Set();
  const next = new Map(nodes.map((node) => [node.id, []]));
  const degrees = new Map(nodes.map((node) => [node.id, 0]));
  const edges = flow.edges.map((rawEdge) => {
    const edge = object(rawEdge, `Conexión de ${name}`);
    const from = identifier(edge.from, "Origen de conexión");
    const to = identifier(edge.to, "Destino de conexión");
    const source = byId.get(from);
    const destination = byId.get(to);
    if (!source || !destination) invalid(`La conexión ${from} → ${to} apunta a un bloque inexistente.`);
    if (!NEXT_TYPES[source.type].has(destination.type)) invalid(`No se puede conectar ${source.type} con ${destination.type}.`);
    const key = `${from}\0${to}`;
    if (edgeKeys.has(key)) invalid(`La conexión ${from} → ${to} está repetida.`);
    edgeKeys.add(key);
    next.get(from).push(to);
    degrees.set(to, degrees.get(to) + 1);
    return { from, to };
  });

  const queue = [...degrees].filter(([, degree]) => degree === 0).map(([nodeId]) => nodeId);
  let visited = 0;
  for (let index = 0; index < queue.length; index += 1) {
    visited += 1;
    for (const destination of next.get(queue[index])) {
      degrees.set(destination, degrees.get(destination) - 1);
      if (degrees.get(destination) === 0) queue.push(destination);
    }
  }
  if (visited !== nodes.length) invalid(`El flujo «${name}» contiene un ciclo.`);

  if (!enabled) return { id, name, enabled, workspaceId, maxItems, nodes, edges };

  const designNode = nodes.find((node) => node.type === "design");
  const musaNode = nodes.find((node) => node.type === "musa");
  if (!designNode.enabled || !musaNode.enabled) invalid(`Activa los bloques de diseño y Musa en «${name}».`);
  const designId = designNode.id;
  const musaId = musaNode.id;
  if (!next.get(designId).includes(musaId)) invalid(`Conecta el diseño con Musa en «${name}».`);
  const reachesDesign = (sourceId) => {
    const seen = new Set();
    const pending = [sourceId];
    while (pending.length) {
      const current = pending.pop();
      if (current === designId) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      if (byId.get(current)?.enabled) pending.push(...next.get(current).filter((destination) => byId.get(destination)?.enabled));
    }
    return false;
  };
  if (!nodes.some((node) => SOURCE_TYPES.has(node.type) && node.enabled && reachesDesign(node.id))) invalid(`Conecta al menos una fuente activa con el diseño en «${name}».`);
  return { id, name, enabled, workspaceId, maxItems, nodes, edges };
}

export function validateNewsroomFlowStore(raw) {
  const store = object(raw, "Colección de flujos");
  if (store.version !== 2) invalid("La versión de flujos debe ser 2.");
  if (!Array.isArray(store.flows) || store.flows.length > MAX_FLOWS) invalid(`Puedes guardar hasta ${MAX_FLOWS} flujos.`);
  const flows = store.flows.map(normalizeFlow);
  if (new Set(flows.map((flow) => flow.id)).size !== flows.length) invalid("Hay IDs de flujos repetidos.");
  const selectedFlowId = store.selectedFlowId == null && flows.length === 0 ? null : identifier(store.selectedFlowId, "Flujo seleccionado");
  if (selectedFlowId && !flows.some((flow) => flow.id === selectedFlowId)) invalid("El flujo seleccionado no existe.");
  return { version: 2, selectedFlowId, flows };
}

function legacyPosition(value, x, y) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? { x: value.x, y: value.y } : { x, y };
}

export function migrateLegacyNewsroomConfig(legacy) {
  const feeds = legacy.feeds ?? [];
  const positions = legacy.nodePositions ?? {};
  const rssPosition = legacyPosition(positions.rss, 260, 100);
  const sources = feeds.map((feed, index) => ({
    id: `rss_${index + 1}`,
    type: "rss",
    label: feed.name || `RSS ${index + 1}`,
    enabled: feed.enabled !== false,
    config: { url: feed.url },
    position: { x: rssPosition.x, y: rssPosition.y + index * 112 },
  }));
  const design = legacy.design ?? { mode: "builtin" };
  return validateNewsroomFlowStore({
    version: 2,
    selectedFlowId: "daily-news",
    flows: [{
      id: "daily-news",
      name: "Edición diaria",
      enabled: legacy.enabled !== false,
      workspaceId: legacy.workspaceId,
      maxItems: legacy.maxItems,
      nodes: [
        { id: "schedule", type: "schedule", label: "Horario", enabled: true, config: { buildTime: "08:00", reportTime: "09:00" }, position: legacyPosition(positions.cron8, 30, 100) },
        ...sources,
        { id: "design", type: "design", label: "Diseño", enabled: true, config: design, position: legacyPosition(positions.editor, 500, 180) },
        { id: "musa", type: "musa", label: "Musa", enabled: true, config: {}, position: legacyPosition(positions.musa, 740, 180) },
        { id: "report", type: "report", label: "Reporte", enabled: true, config: {}, position: legacyPosition(positions.report, 980, 180) },
      ],
      edges: [
        ...sources.flatMap((source) => [{ from: "schedule", to: source.id }, { from: source.id, to: "design" }]),
        { from: "design", to: "musa" },
        { from: "musa", to: "report" },
      ],
    }],
  });
}

export async function getNewsroomFlows({ filePath = runtimePaths.newsroomFlows, loadLegacy = getNewsroomConfig } = {}) {
  const saved = await readJson(filePath, null);
  if (saved) return validateNewsroomFlowStore(saved);
  if (!migrations.has(filePath)) {
    const task = (async () => {
      const existing = await readJson(filePath, null);
      if (existing) return validateNewsroomFlowStore(existing);
      const migrated = migrateLegacyNewsroomConfig(await loadLegacy());
      await writeJson(filePath, migrated);
      return migrated;
    })();
    migrations.set(filePath, task);
    task.then(() => migrations.delete(filePath), () => migrations.delete(filePath));
  }
  return migrations.get(filePath);
}

export async function saveNewsroomFlows(raw, { filePath = runtimePaths.newsroomFlows } = {}) {
  const store = validateNewsroomFlowStore(raw);
  await writeJson(filePath, store);
  return store;
}
