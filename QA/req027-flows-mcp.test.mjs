// QA/req027-flows-mcp.test.mjs — REQ-027 Flows builder MCP-first.
// Lo puro se testea de verdad importándolo (flows-core.mjs y la biblioteca de
// presets); el despacho MCP, la migración y los contratos de seguridad se
// afirman sobre el source (convención del repo: req032-photo-mcp). Corre con:
//   node --experimental-strip-types --test QA/req027-flows-mcp.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  LIMITS, NODE_TYPES, cryptoRandom12, executeFlow, exportShape, flowCronDue, flowError,
  parseCron, prepareFlowRow, stripCredentialRefs, validateFlowDefinition,
  validateTrigger,
} from "../netlify/functions/flows-core.mjs";
import { auditEditableFrame, normalizeLayersFirstFrame } from "../netlify/functions/editable-layers.mjs";
import { AI_PROVIDERS, runAiText, validateAiConfig } from "../netlify/functions/flows-sources.mjs";
import { FLOW_LIBRARY, findFlowPreset } from "../src/data/flowLibrary.ts";
import { CATEGORIES, FLOW_TOOLS as FLOW_TOOL_CATALOG, FLOW_TOOL_TIERS, FLOW_TOOL_WRITE } from "../src/data/flowToolCatalog.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const mcpSource = readFileSync(ROOT + "netlify/functions/mcp.mjs", "utf8");
const runtimeSource = readFileSync(ROOT + "netlify/functions/flows-runtime.mjs", "utf8");
const coreSource = readFileSync(ROOT + "netlify/functions/flows-core.mjs", "utf8");
const migration = readFileSync(ROOT + "supabase_migrations_v61.sql", "utf8");
const migrationV62 = readFileSync(ROOT + "supabase_migrations_v62.sql", "utf8");
const migrationV66 = readFileSync(ROOT + "supabase_migrations_v66.sql", "utf8");
const migrationV67 = readFileSync(ROOT + "supabase_migrations_v67.sql", "utf8");
const workerSource = readFileSync(ROOT + "worker/index.js", "utf8");
const catalog = JSON.parse(readFileSync(ROOT + "tools_catalog.json", "utf8"));
const apiSource = readFileSync(ROOT + "api/src/index.ts", "utf8");
const authSource = readFileSync(ROOT + "api/src/middleware/auth.ts", "utf8");
const tabSource = readFileSync(ROOT + "src/components/FlowsTab.tsx", "utf8");
const editorSource = readFileSync(ROOT + "src/components/flows/FlowEditor.tsx", "utf8");
const dashboardSource = readFileSync(ROOT + "src/components/Dashboard.tsx", "utf8");

const FLOW_TOOLS = [
  "flow_save", "flow_list", "flow_get", "flow_delete", "flow_run", "flow_history",
  "flow_export", "flow_import", "flow_library_list", "flow_library_instantiate",
  "flow_credentials_list", "flow_credentials_set", "flow_credentials_delete",
  "flow_webhook_rotate", "flow_due_check", "flow_resume",
  "flow_static_data_get", "flow_static_data_set", "flow_oauth2_connect",
];
const FLOW_READ_TOOLS = ["flow_list", "flow_get", "flow_history", "flow_export", "flow_library_list", "flow_credentials_list", "flow_due_check", "flow_static_data_get"];

// ── Slices del source de mcp.mjs (mismo bracket-scan que sync-skill-tools) ──

function mcpToolsBody(source) {
  const start = source.indexOf("const MCP_TOOLS = [");
  assert.ok(start !== -1, "MCP_TOOLS no encontrado en mcp.mjs");
  let depth = 0;
  let end = -1;
  for (let i = source.indexOf("[", start); i < source.length; i++) {
    const ch = source[i];
    if (ch === '"') {
      i++;
      while (i < source.length && source[i] !== '"') { if (source[i] === "\\") i++; i++; }
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") { depth--; if (depth === 0) { end = i; break; } }
  }
  assert.ok(end !== -1, "no se encontró el cierre de MCP_TOOLS");
  return source.slice(start, end + 1);
}

function toolObjects(body) {
  const out = [];
  let depth = 0;
  let objStart = -1;
  for (let j = 1; j < body.length - 1; j++) {
    const ch = body[j];
    if (ch === '"') {
      j++;
      while (j < body.length && body[j] !== '"') { if (body[j] === "\\") j++; j++; }
      continue;
    }
    if (ch === "{") { if (depth === 0) objStart = j; depth++; }
    else if (ch === "}") { depth--; if (depth === 0 && objStart !== -1) { out.push(body.slice(objStart, j + 1)); objStart = -1; } }
  }
  return out;
}

// ── 1. Catálogo MCP ──────────────────────────────────────────────────────────

test("REQ027-MCP: las 19 tools flow_* están registradas en MCP_TOOLS con inputSchema", () => {
  const objects = toolObjects(mcpToolsBody(mcpSource));
  for (const name of FLOW_TOOLS) {
    const obj = objects.find((o) => o.includes(`name: "${name}"`));
    assert.ok(obj, `${name} no está registrado en MCP_TOOLS`);
    assert.match(obj, /inputSchema:\s*\{\s*type:\s*"object"/, `${name} debe declarar inputSchema`);
  }
  const flowSave = objects.find((o) => o.includes('name: "flow_save"'));
  assert.match(flowSave, /required:\s*\["name",\s*"nodes",\s*"edges"\]/, "flow_save debe requerir name/nodes/edges");
});

test("REQ027-MCP: las 19 tools tienen case de despacho y catálogo sincronizado", () => {
  for (const name of FLOW_TOOLS) {
    assert.ok(mcpSource.includes(`case "${name}":`), `falta el case de despacho para ${name}`);
  }
  const flowEntries = catalog.filter((t) => String(t.name || "").startsWith("flow_"));
  assert.equal(flowEntries.length, FLOW_TOOLS.length, `tools_catalog.json debe contener exactamente las ${FLOW_TOOLS.length} flow_*`);
  for (const entry of flowEntries) {
    assert.ok(entry.description, `${entry.name} sin description en tools_catalog.json`);
    assert.ok(entry.inputSchema, `${entry.name} sin inputSchema en tools_catalog.json`);
    assert.ok(!String(entry.description).includes("${"), `${entry.name} dejó un placeholder sin resolver`);
  }
  const flowSave = flowEntries.find((t) => t.name === "flow_save");
  assert.ok(
    flowSave.description.includes("source_rss{url") && flowSave.description.includes("credentialId"),
    "flow_save debe embeber NODE_SCHEMA_DOC (el contrato del grafo viaja en la descripción)",
  );
});

// ── 2. MCP-first: auth, tenant y bridge interno ─────────────────────────────

test("REQ027-MCP: reads flow_* grant viewer y el tenant se resuelve en DB (workspace scoping)", () => {
  const readBlock = mcpSource.match(/const FLOW_READ_METHODS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(readBlock, "FLOW_READ_METHODS no encontrado");
  for (const name of FLOW_READ_TOOLS) {
    assert.ok(readBlock[1].includes(`"${name}"`), `${name} debería ser lectura (rol viewer)`);
  }
  assert.ok(mcpSource.includes("FLOW_TENANT_METHODS.has(method)"), "authorizeMcpCall debe resolver tenant de flows");
  assert.ok(mcpSource.includes("flowStore.getFlow(String(params.flowId), null)"), "el tenant lookup no debe acotar workspace a priori");
  assert.ok(mcpSource.includes("flowStore.getCredential(String(params.credentialId), null)"), "tenant lookup de credentials");
  assert.ok(mcpSource.includes("Flow belongs to another workspace"), "cross-tenant debe rechazarse con -32003");
});

test("REQ027-MCP: createFlowToolBridge despacha por el MISMO handleMethod (UI/webhook/IA = un camino)", () => {
  const bridge = mcpSource.match(/export function createFlowToolBridge\(\) \{[\s\S]*?\n\}/);
  assert.ok(bridge, "createFlowToolBridge no encontrado");
  assert.match(bridge[0], /withRequestAuth\(/, "el bridge debe pasar por withRequestAuth");
  assert.match(bridge[0], /handleMethod\(/, "el bridge debe despachar handleMethod (sin atajos privados)");
  assert.ok(mcpSource.includes("export async function handleMethod"), "handleMethod debe estar exportado (runtime + tests)");
});

// ── 3. Migración v61 ────────────────────────────────────────────────────────

test("REQ027-DB: migración v61 crea las 3 tablas con RLS por workspace", () => {
  for (const table of ["flows", "flow_runs", "flow_credentials"]) {
    assert.ok(migration.includes(`CREATE TABLE IF NOT EXISTS ${table} (`), `falta CREATE TABLE ${table}`);
    assert.ok(new RegExp(`ENABLE ROW LEVEL SECURITY[\\s\\S]*?${table}`).test(migration) || migration.includes(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`), `falta RLS en ${table}`);
    const policies = migration.split("CREATE POLICY").filter((chunk) => chunk.includes(`ON ${table}`));
    assert.ok(policies.length >= 2, `${table} necesita políticas RLS (al menos select/all + write)`);
    assert.ok(policies.some((chunk) => chunk.includes("has_workspace_role")), `${table} debe usar has_workspace_role`);
  }
  assert.ok(migration.includes("REFERENCES workspaces(id) ON DELETE CASCADE"), "workspace_id debe cascadear");
  assert.match(migration, /flow_credentials[\s\S]*UNIQUE\s*\(\s*workspace_id,\s*name\s*\)/, "credentials upsert por (workspace,name)");
});

test("REQ027-DB: webhook guarda solo sha256 y flow_runs tiene idempotencia", () => {
  // El hash viaja DENTRO de trigger JSONB ({secretHash}), nunca en una columna
  // propia ni en claro (comentario v61 línea trigger).
  assert.ok(migration.includes("secretHash"), "el trigger document secretHash (sha256) dentro del JSONB");
  assert.ok(!/webhook_secret\s+TEXT/i.test(migration), "NUNCA debe existir una columna de secreto webhook en claro");
  assert.ok(migration.includes("request_id"), "flow_runs.request_id para idempotencia");
  assert.match(migration, /status[\s\S]{0,200}CHECK\s*\(/i, "status debe tener CHECK");
  assert.ok(migration.includes("created_by"), "created_by para atribución user|ai:*");
  assert.match(migration, /created_by[\s\S]{0,200}CHECK/i, "created_by CHECK user|ai:%");
});

// ── 4. Runtime: webhook + orquestación ──────────────────────────────────────

test("REQ027-RUNTIME: webhook timing-safe, 404/401 estables y secreto nunca en claro", () => {
  assert.ok(runtimeSource.includes("export function webhookTriggerMatches"), "webhookTriggerMatches exportado");
  assert.ok(runtimeSource.includes("FLOW_NOT_WEBHOOK"), "código estable 404 para no-webhook");
  assert.ok(runtimeSource.includes("BAD_WEBHOOK_SECRET"), "código estable 401 para secreto malo");
  assert.ok(runtimeSource.includes("timingSafeHexEqual"), "comparación timing-safe");
  assert.ok(runtimeSource.includes("randomBytes"), "secreto via crypto.randomBytes");
  assert.match(runtimeSource, /webhookSecretBytes/, "usa LIMITS.webhookSecretBytes");
  const urlFn = runtimeSource.match(/export function flowWebhookUrl[\s\S]*?\n\}/);
  assert.ok(urlFn && urlFn[0].includes("throw"), "flowWebhookUrl lanza sin rawSecret (la URL solo existe en el momento)");
  assert.ok(runtimeSource.includes("sha256Hex(rawSecret)"), "solo se persiste el sha256");
});

test("REQ027-RUNTIME: orquestación con kill switch, idempotencia y concurrencia", () => {
  assert.ok(runtimeSource.includes("export function createFlowRuntime"), "createFlowRuntime exportado");
  assert.ok(runtimeSource.includes("FLOWS_DISABLED"), "kill switch FLOWS_DISABLED");
  assert.ok(runtimeSource.includes("findRunByRequestId"), "idempotencia por requestId");
  assert.ok(runtimeSource.includes("CONCURRENCY_LIMIT"), "código estable de concurrencia");
  assert.ok(runtimeSource.includes("LIMITS.maxRunningPerWorkspace"), "límite de runs simultáneos por workspace");
  assert.match(runtimeSource, /resolveTemplateWorkspaceSafe = resolveTemplateWorkspace \?\?/, "resolver de workspace con default seguro (el webhook no explota sin él)");
  assert.ok(runtimeSource.includes("resolveTemplateWorkspace: resolveTemplateWorkspaceSafe"), "executeFlow recibe el resolver con default");
  const insertBeforeExecute = runtimeSource.indexOf("insertRun");
  const executeCall = runtimeSource.indexOf("executeFlow(");
  assert.ok(insertBeforeExecute !== -1 && executeCall !== -1 && insertBeforeExecute < executeCall, "crash-safe: el run se inserta ANTES de ejecutar");
  assert.equal(LIMITS.maxRunningPerWorkspace, 3);
  assert.equal(LIMITS.inputBytes, 50_000);
});

test("REQ027-RUNTIME: endpoint webhook público, cap de input y mapeo de errores HTTP", () => {
  assert.ok(apiSource.includes("/api/flows/webhook/:flowId/:secret"), "ruta del webhook en api/src/index.ts");
  assert.ok(apiSource.includes("webhookTriggerMatches"), "el endpoint valida secreto con el runtime");
  assert.ok(apiSource.includes("INPUT_TOO_LARGE") || apiSource.includes("413"), "cap de input con 413");
  assert.ok(apiSource.includes("LIMITS.inputBytes"), "cap de input usa LIMITS.inputBytes (50KB, única fuente de verdad)");
  assert.ok(apiSource.includes("x-request-id"), "requestId desde header para idempotencia");
  assert.ok(apiSource.includes("429"), "CONCURRENCY_LIMIT → 429");
  assert.ok(authSource.includes("flowsWebhookTrigger"), "el webhook es ruta pública (el secreto ES la credencial)");
});

// ── 5. Validador (import real) ──────────────────────────────────────────────

const draftBase = {
  name: "QA flow",
  trigger: { type: "manual" },
  nodes: [{ id: "m1", type: "map", config: { value: { a: 1 } }, position: { x: 0, y: 0 } }],
  edges: [],
};

test("REQ027-CORE: borrador válido pasa y normaliza", () => {
  const def = validateFlowDefinition(draftBase, { enabled: false });
  assert.equal(def.name, "QA flow");
  assert.equal(def.enabled, false);
  assert.deepEqual(def.trigger, { type: "manual" });
  assert.equal(def.nodes[0].type, "map");
  assert.equal(def.edges.length, 0);
});

test("REQ027-CORE: activar exige todo configurado (template sin ids, IA sin credencial)", () => {
  assert.throws(() => validateFlowDefinition({ ...draftBase, nodes: [], edges: [] }, { enabled: true }),
    (e) => e.flowCode === "VALIDATION", "flow activo sin nodos");
  const tpl = (ids) => ({
    name: "t", trigger: { type: "manual" },
    nodes: [
      { id: "map1", type: "map", config: { value: { title: "x" } }, position: { x: 0, y: 0 } },
      { id: "t1", type: "template", config: { format: "post", maxItems: 1, ...ids }, position: { x: 100, y: 0 } },
    ],
    edges: [{ from: "map1", to: "t1" }],
  });
  assert.throws(() => validateFlowDefinition(tpl({}), { enabled: true }),
    (e) => e.flowCode === "VALIDATION", "template sin ids debe fallar al activar");
  assert.doesNotThrow(() => validateFlowDefinition(tpl({}), { enabled: false }), "como borrador sí se guarda");
  assert.doesNotThrow(() => validateFlowDefinition(tpl({ templateId: "tpl_x", frameId: "frm_y" }), { enabled: true }), "map→template configurado se activa (map es raíz legítima)");
  const ai = (cred) => ({
    name: "a", trigger: { type: "manual" },
    nodes: [
      { id: "map1", type: "map", config: { value: { title: "x" } }, position: { x: 0, y: 0 } },
      { id: "a1", type: "ai", config: { provider: "openrouter", model: "m", prompt: "p", credentialId: cred }, position: { x: 100, y: 0 } },
    ],
    edges: [{ from: "map1", to: "a1" }],
  });
  assert.throws(() => validateFlowDefinition(ai(null), { enabled: true }),
    (e) => e.flowCode === "VALIDATION", "IA sin credencial debe fallar al activar");
});

test("REQ027-CORE: grafo inválido se rechaza (tipos, aristas, ciclos, entradas dobles, secretos)", () => {
  const bad = (nodes, edges) => ({ ...draftBase, nodes, edges });
  const n = (id, type, config = {}) => ({ id, type, config, position: { x: 0, y: 0 } });
  assert.throws(() => validateFlowDefinition(bad([n("x1", "nope")], []), { enabled: false }), (e) => e.flowCode === "VALIDATION", "tipo desconocido");
  assert.throws(() => validateFlowDefinition(bad([n("a1", "map")], [{ from: "a1", to: "ghost" }]), { enabled: false }), (e) => e.flowCode === "VALIDATION", "edge a nodo inexistente");
  assert.throws(() => validateFlowDefinition(bad(
    [n("a1", "map"), n("b1", "text", { template: "x" })],
    [{ from: "a1", to: "b1" }, { from: "b1", to: "a1" }],
  ), { enabled: false }), (e) => e.flowCode === "VALIDATION", "ciclo");
  assert.throws(() => validateFlowDefinition(bad(
    [n("s1", "source_rss", { url: "https://x/feed" }), n("a1", "map"), n("b1", "text", { template: "x" })],
    [{ from: "s1", to: "a1" }, { from: "s1", to: "b1" }],
  ), { enabled: false }), (e) => e.flowCode === "VALIDATION", "un nodo = una entrada (no-ai)");
  assert.throws(() => validateFlowDefinition(bad(
    [n("c1", "condition", { path: "item.x", operator: "not_empty" }), n("t1", "text", { template: "x" })],
    [{ from: "c1", to: "t1" }],
  ), { enabled: false }), (e) => e.flowCode === "VALIDATION", "condition exige when:true/false");
  assert.throws(() => validateFlowDefinition(bad(
    [n("h1", "http", { url: "https://x", headers: { Authorization: "Bearer sk-123" } })], [],
  ), { enabled: false }),
    (e) => e.flowCode === "SECRET_IN_CONFIG" || e.flowCode === "VALIDATION",
    "secretos en headers prohibidos (cleanHeaders bloquea Authorization antes del scan de secretos)");
});

test("REQ027-CORE: límites declarados y estables", () => {
  assert.equal(LIMITS.flowsPerWorkspace, 20);
  assert.equal(LIMITS.nodesPerFlow, 40);
  assert.equal(LIMITS.runTimeoutMs, 25_000);
  assert.equal(LIMITS.webhookSecretBytes, 32);
  assert.deepEqual([...NODE_TYPES].sort(), ["agent", "aggregate", "ai", "approval", "code", "compare", "condition", "dedupe", "group", "http", "limit", "loop", "map", "merge", "note", "report", "sort", "source_http", "source_nitter", "source_rss", "subflow", "switch", "template", "text", "tool", "wait", "wait_webhook"], "contrato estable de tipos (27: 13 del plan original + agent/compare/wait_webhook/approval/group + sort/dedupe/aggregate/limit del gap V2 F9)");
});

test("REQ027-CORE: ids, filas y export sin credenciales", () => {
  assert.match(cryptoRandom12(), /^[0-9a-z]{12}$/);
  const row = prepareFlowRow({ workspaceId: "ws1", definition: validateFlowDefinition(draftBase, { enabled: false }), createdBy: "ai:gpt-x" });
  assert.match(row.id, /^flow_[0-9a-z]{12}$/);
  assert.equal(row.workspace_id, "ws1");
  assert.equal(row.created_by, "ai:gpt-x");
  const rowUser = prepareFlowRow({ workspaceId: "ws1", definition: validateFlowDefinition(draftBase, { enabled: false }) });
  assert.equal(rowUser.created_by, "user");
  const withCred = [{ id: "a1", type: "ai", config: { credentialId: "fcred_x", prompt: "p" } }];
  assert.deepEqual(stripCredentialRefs(withCred)[0].config, { prompt: "p" }, "el export remueve credentialId por diseño");
  const shape = exportShape({ name: "n", enabled: false, trigger: null, nodes: [], edges: [] });
  assert.deepEqual(Object.keys(shape).sort(), ["edges", "name", "nodes", "trigger", "version"], "exportShape versionado, sin workspace ni secretos (el import entra como borrador)");
});

test("REQ027-CORE: fan-in solo para ai y report (preset Noticias)", () => {
  const node = (id, type, config = {}) => ({ id, type, config, position: { x: 0, y: 0 } });
  const feedsToAi = {
    name: "fanin", trigger: { type: "manual" },
    nodes: [
      node("r1", "source_rss", { url: "https://a.example/feed" }),
      node("r2", "source_rss", { url: "https://b.example/feed" }),
      node("a1", "ai", { provider: "openrouter", model: "m", prompt: "p", credentialId: "fcred_x" }),
    ],
    edges: [{ from: "r1", to: "a1" }, { from: "r2", to: "a1" }],
  };
  assert.doesNotThrow(() => validateFlowDefinition(feedsToAi, { enabled: false }), "ai combina varias fuentes (fan-in)");
  const framesToReport = {
    name: "fanin-report", trigger: { type: "manual" },
    nodes: [
      node("p1", "template", { templateId: "t", frameId: "f", format: "post" }),
      node("s1", "template", { templateId: "t", frameId: "f2", format: "story" }),
      node("rep1", "report", { title: "Edición" }),
    ],
    edges: [{ from: "p1", to: "rep1" }, { from: "s1", to: "rep1" }],
  };
  assert.doesNotThrow(() => validateFlowDefinition(framesToReport, { enabled: false }), "report agrega post+story");
  const feedsToTemplate = { ...feedsToAi, nodes: [feedsToAi.nodes[0], feedsToAi.nodes[1], node("t1", "template", { templateId: "t", frameId: "f", format: "post" })], edges: [{ from: "r1", to: "t1" }, { from: "r2", to: "t1" }] };
  assert.throws(() => validateFlowDefinition(feedsToTemplate, { enabled: false }), (e) => e.flowCode === "VALIDATION", "template sigue siendo una-entrada");
});

// ── 5b. Gap V2: F1 (IA estructurada), F2 (static_data), F5 (webhook respond), F8 (re-run), F9 (micro-nodos) ──

test("REQ027-F9: sort/dedupe/aggregate/limit validan y normalizan (transformaciones sin código)", () => {
  const node = (id, type, config = {}) => ({ id, type, config, position: { x: 0, y: 0 } });
  const base = (nodes, edges) => ({ name: "f9", trigger: { type: "manual" }, nodes, edges });
  const chain = [
    node("r1", "source_rss", { url: "https://a.example/feed" }),
    node("s1", "sort", { path: "title", dir: "desc" }),
    node("d1", "dedupe", { path: "title" }),
    node("g1", "aggregate", {}),
    node("l1", "limit", { max: 500, keep: "last" }),
    node("t1", "text", { template: "{{item.title}}" }),
  ];
  const edges = chain.slice(0, -1).map((n, i) => ({ from: n.id, to: chain[i + 1].id }));
  const def = validateFlowDefinition(base(chain, edges), { enabled: false });
  assert.equal(def.nodes[1].config.dir, "desc");
  assert.deepEqual(def.nodes[3].config, {}, "aggregate no lleva opciones");
  assert.equal(def.nodes[4].config.max, 100, "limit.max se acota a LIMITS.maxItemsTransform (100)");
  assert.equal(def.nodes[4].config.keep, "last");
  assert.equal(validateFlowDefinition(base([node("l1", "limit", { keep: "middle" })], []), { enabled: false }).nodes[0].config.keep, "first", "keep inválido se normaliza a first (permisivo)");
  assert.throws(() => validateFlowDefinition(base([node("s1", "sort", { path: "a b; drop" })], []), { enabled: false }), (e) => e.flowCode === "VALIDATION", "path debe ser ruta simple");
  assert.equal(LIMITS.maxItemsTransform, 100);
  const feed = chain[0];
  const fanin = base([feed, node("r2", "source_rss", { url: "https://b.example/feed" }), node("g1", "aggregate", {})], [{ from: "r1", to: "g1" }, { from: "r2", to: "g1" }]);
  assert.doesNotThrow(() => validateFlowDefinition(fanin, { enabled: false }), "aggregate es fan-in (junta TODAS sus entradas)");
  const faninText = { ...fanin, nodes: [feed, fanin.nodes[1], node("t1", "text", { template: "x" })], edges: [{ from: "r1", to: "t1" }, { from: "r2", to: "t1" }] };
  assert.throws(() => validateFlowDefinition(faninText, { enabled: false }), (e) => e.flowCode === "VALIDATION", "text sigue siendo una-entrada");
});

test("REQ027-F1: ai admite schema (JSON Schema acotado) y responseFormat ya no se pierde en el save", () => {
  const aiNode = (config) => ({ id: "a1", type: "ai", config: { provider: "openrouter", model: "m", prompt: "p", credentialId: "fcred_x", ...config }, position: { x: 0, y: 0 } });
  const base = (config) => ({ name: "f1", trigger: { type: "manual" }, nodes: [aiNode(config)], edges: [] });
  const schemaStr = '{"type":"object","required":["titulo"],"properties":{"titulo":{"type":"string"}}}';
  const fromStr = validateFlowDefinition(base({ responseFormat: "json", schema: schemaStr }), { enabled: false });
  assert.equal(fromStr.nodes[0].config.responseFormat, "json", "responseFormat persiste (antes la normalización lo tiraba: dead code)");
  assert.equal(fromStr.nodes[0].config.schema, schemaStr, "schema string persiste tal cual");
  const fromObj = validateFlowDefinition(base({ schema: { type: "object" } }), { enabled: false });
  assert.equal(fromObj.nodes[0].config.schema, '{"type":"object"}', "schema objeto se serializa");
  assert.throws(() => validateFlowDefinition(base({ schema: "no json {" }), { enabled: false }), (e) => e.flowCode === "VALIDATION", "schema que no parsea se rechaza");
  assert.throws(() => validateFlowDefinition(base({ schema: JSON.stringify({ big: "x".repeat(2500) }) }), { enabled: false }), (e) => e.flowCode === "VALIDATION", "schema >2KB se rechaza");
  const doc = coreSource.slice(coreSource.indexOf("export const NODE_SCHEMA_DOC"));
  assert.ok(doc.includes("AI_SCHEMA"), "el contrato documenta el fallo duro AI_SCHEMA (valida y reintenta UNA vez)");
  assert.ok(doc.includes("Datos sin código (F9)"), "NODE_SCHEMA_DOC documenta sort/dedupe/aggregate/limit");
  assert.ok(doc.includes('respond:"ack"|"lastNode"'), "NODE_SCHEMA_DOC documenta el respond del webhook");
});

test("REQ027-F2: static_data — contexto {{static.x}}, store get/merge, tools MCP y migración v66", () => {
  assert.match(coreSource, /input\|steps\|item\|vars\|static/, "deepResolve acepta {{static.k}}");
  assert.match(coreSource, /static: flow\.static_data/, "executeFlow expone static_data en el contexto");
  assert.ok(coreSource.includes("async function getStaticData") && coreSource.includes("async function mergeStaticData"), "store lee/escribe static_data (merge superficial)");
  assert.match(migrationV66, /ADD COLUMN IF NOT EXISTS static_data jsonb NOT NULL DEFAULT '\{\}'::jsonb/, "v66 añade la columna");
  for (const tool of ["flow_static_data_get", "flow_static_data_set"]) {
    assert.ok(mcpSource.includes(`case "${tool}":`), `falta el case de despacho para ${tool}`);
    const caseBody = mcpSource.slice(mcpSource.indexOf(`case "${tool}":`));
    assert.match(caseBody, /flowsAssertEnabled\(\)/, `${tool} respeta el kill switch`);
  }
  const setCase = mcpSource.slice(mcpSource.indexOf('case "flow_static_data_set":'), mcpSource.indexOf('case "flow_webhook_rotate":'));
  assert.ok(setCase.includes("8_192"), "set acota el patch a 8KB");
  assert.match(mcpSource, /const FLOW_READ_METHODS = new Set\(\[[^\]]*"flow_static_data_get"/, "get es lectura (viewer)");
  assert.match(mcpSource, /const FLOW_TENANT_METHODS = new Set\(\[[^\]]*"flow_static_data_set"/, "set resuelve tenant en DB como flow_get");
});

test("REQ027-F5: webhook respond ack|lastNode — engine valida, API responde outputs, UI elige", () => {
  assert.deepEqual(validateTrigger({ type: "webhook", respond: "lastNode" }, { enabled: true }), { type: "webhook", respond: "lastNode" });
  assert.deepEqual(validateTrigger({ type: "webhook" }, { enabled: true }), { type: "webhook" }, "sin respond = ack (compatibilidad)");
  assert.throws(() => validateTrigger({ type: "webhook", respond: "bogus" }, { enabled: true }), (e) => e.flowCode === "VALIDATION");
  assert.match(apiSource, /triggerCfg\?\.respond === "lastNode"/, "la API ramifica por el modo de respuesta");
  assert.ok(apiSource.includes("data: result.outputs"), "lastNode devuelve los outputs terminales en {data}");
  assert.ok(apiSource.includes('status: "waiting"'), "run en espera responde 202 SIN resumeToken (la URL es pública)");
  assert.ok(editorSource.includes('value={trigger.respond ?? "ack"}'), "el inspector del trigger elige el modo");
});

test("REQ027-F8: re-run desde un paso del Historial (auto-pines de ancestros)", () => {
  assert.ok(editorSource.includes("async function rerunFromStep"), "función de re-run por paso");
  assert.ok(editorSource.includes("▶ desde aquí"), "botón por paso en el Historial");
  const start = editorSource.indexOf("async function rerunFromStep");
  const end = editorSource.indexOf("// Restaurar versión", start);
  const body = editorSource.slice(start, end);
  assert.ok(body.includes("__pins") && body.includes("ancestors"), "pinea los ancestros vía input.__pins (reusa el mecanismo B7)");
  assert.ok(body.includes("flow_run"), "misma flow_run que la IA y el webhook (MCP-first)");
});

// ── 5c. Gap V2: F6 (OAuth2 — apps propias del usuario) ──────────────────────

// Nota: NO se importa flows-runtime.mjs aquí — su cadena (keys.mjs →
// api/src/services/supabase.js) solo resuelve con esbuild/tsx; el
// comportamiento real lo cubre el smoke E2E contra la API local.

test("REQ027-F6: credencial oauth2 valida config HTTPS y guarda oauth_config (v67)", () => {
  const start = mcpSource.indexOf('case "flow_credentials_set":');
  const end = mcpSource.indexOf('case "flow_credentials_delete":', start);
  const body = mcpSource.slice(start, end);
  assert.ok(body.includes('"oauth2"'), "type oauth2 aceptado");
  assert.match(body, /authUrl y tokenUrl HTTPS/, "authUrl/tokenUrl deben ser HTTPS");
  assert.ok(body.includes("oauth_config"), "guarda oauth_config (clientId/authUrl/tokenUrl/scope)");
  assert.match(body, /client_secret/, "el secret de oauth2 es el client_secret");
  assert.match(migrationV67, /ADD COLUMN IF NOT EXISTS oauth_config jsonb NOT NULL DEFAULT '\{\}'::jsonb/, "v67 añade oauth_config");
  assert.match(migrationV67, /ADD COLUMN IF NOT EXISTS oauth_tokens text/, "v67 añade oauth_tokens");
  assert.match(coreSource, /oauth_\(config\|tokens\)\/i\.test\(first\.error/, "upsert degrada sin v67 (retry sin oauth_*)");
  assert.ok(coreSource.includes("async function updateCredentialTokens"), "store persiste oauth_tokens");
});

test("REQ027-F6: flow_oauth2_connect arma el consentimiento (state cifrado, Google offline)", () => {
  const start = mcpSource.indexOf('case "flow_oauth2_connect":');
  assert.ok(start !== -1, "case de despacho existe");
  const body = mcpSource.slice(start, mcpSource.indexOf('case "flow_static_data_get":', start));
  assert.ok(body.includes("oauth2StateEncode"), "state cifrado (AES-256-GCM)");
  assert.ok(body.includes("/api/flows/oauth2/callback"), "redirect por defecto al callback propio");
  assert.ok(body.includes("access_type") && body.includes('"offline"'), "Google: access_type=offline (sin esto no hay refresh_token)");
  assert.match(body, /response_type/, "authorization code flow");
  assert.match(mcpSource, /FLOW_TENANT_METHODS = new Set\(\[[^\]]*"flow_oauth2_connect"/s, "tenant resuelto por credentialId");
});

test("REQ027-F6: el engine firma Bearer y refresca UNA vez ante 401", () => {
  assert.match(coreSource, /credential\.type === "oauth2"/, "rama oauth2 en executeHttp");
  assert.match(coreSource, /\{ forceRefresh: true \}/, "401 → refresca y reintenta");
  assert.match(coreSource, /oauth2Token = null/, "executeFlow acepta el resolver inyectado");
  const rtStart = runtimeSource.indexOf("async function getOAuth2AccessToken");
  assert.ok(rtStart !== -1, "resolver real en flows-runtime");
  const rtBody = runtimeSource.slice(rtStart, runtimeSource.indexOf("/** Ejecuta un flow UNA vez", rtStart));
  assert.ok(rtBody.includes("grant_type") && rtBody.includes('"refresh_token"'), "refresh grant contra el token endpoint");
  assert.match(rtBody, /Date\.now\(\) \+ 60_000/, "usa el token cacheado con margen de 60s");
  assert.ok(rtBody.includes("updateCredentialTokens"), "persiste el token nuevo (fail-open)");
  assert.match(rtBody, /OAUTH2_NOT_CONNECTED/, "sin refresh_token → error accionable");
  assert.match(rtBody, /OAUTH2_REFRESH/, "refresh rechazado → reautoriza");
  assert.ok(coreSource.includes("flow_oauth2_connect"), "NODE_SCHEMA_DOC documenta el flujo");
});

test("REQ027-F6: callback público con el state como única llave (API + auth)", () => {
  assert.match(apiSource, /app\.get\("\/api\/flows\/oauth2\/callback"/, "ruta del callback");
  assert.match(apiSource, /oauth2StateDecode\(stateRaw\)/, "decodifica el state cifrado");
  assert.match(apiSource, /grant_type: "authorization_code"/, "exchange authorization_code");
  assert.match(apiSource, /updateCredentialTokens/, "persiste los tokens cifrados");
  assert.match(authSource, /flowsOauth2Callback = req\.method === "GET" && req\.path === "\/api\/flows\/oauth2\/callback"/, "ruta pública declarada en auth.ts");
});

// ── 6. Biblioteca de presets ────────────────────────────────────────────────

test("REQ027-LIBRARY: 10 presets únicos y todos válidos como borrador", () => {
  assert.equal(FLOW_LIBRARY.length, 10);
  assert.equal(new Set(FLOW_LIBRARY.map((p) => p.id)).size, 10);
  for (const preset of FLOW_LIBRARY) {
    const def = validateFlowDefinition(
      { name: preset.name, trigger: preset.trigger, nodes: preset.nodes, edges: preset.edges },
      { enabled: false },
    );
    assert.equal(def.nodes.length, preset.nodes.length, `${preset.id}: nodos`);
    assert.ok(findFlowPreset(preset.id), `${preset.id} encontrable`);
  }
});

test("REQ027-LIBRARY: los presets dejan a propósito lo humano (template+frame y credenciales)", () => {
  for (const preset of FLOW_LIBRARY) {
    for (const node of preset.nodes) {
      if (node.type === "template") {
        assert.ok(!node.config.templateId && !node.config.frameId, `${preset.id}/${node.id}: template sin archivo+frame (lo elige el usuario)`);
      }
      if (node.type === "ai") {
        assert.ok(node.config.credentialId == null, `${preset.id}/${node.id}: IA sin credentialId (la crea el usuario)`);
      }
      const json = JSON.stringify(node.config);
      assert.ok(!/sk-|Bearer\s|password/i.test(json), `${preset.id}/${node.id}: sin secretos en presets`);
    }
  }
});

// ── 7. UI MCP-first: botón humano y cero rutas privadas ─────────────────────

test("REQ027-UI: el humano ejecuta con un clic la MISMA flow_run (botón ▶ Ejecutar)", () => {
  assert.ok(tabSource.includes("▶ Ejecutar"), "card con botón ▶ Ejecutar");
  assert.match(tabSource, /mcpCall\("flow_run",\s*\{\s*flowId,\s*workspaceId\s*\}\)/, "el botón llama flow_run vía mcpCall");
  assert.ok(editorSource.includes('"▶ Ejecutar"') || editorSource.includes("▶ Ejecutar"), "el editor también tiene Ejecutar");
  assert.ok(editorSource.includes("onRunFlow"), "el editor delega el run al mismo camino");
  assert.ok(tabSource.includes('mcpCall("flow_history"'), "historial vía flow_history");
  assert.ok(tabSource.includes('mcpCall("flow_library_instantiate"'), "instalar preset vía tool");
});

test("REQ027-UI: la UI solo habla MCP (cero fetch privado) y el tab está cableado", () => {
  for (const [file, src] of [["FlowsTab.tsx", tabSource], ["FlowEditor.tsx", editorSource]]) {
    assert.ok(!src.includes("apiFetch("), `${file} no debe llamar rutas privadas`);
    assert.ok(!/fetch\(\s*[`"']\/api/.test(src), `${file} no debe hacer fetch directo a /api`);
  }
  for (const call of ["flow_save", "flow_list", "flow_get", "flow_export", "flow_webhook_rotate"]) {
    assert.ok(editorSource.includes(`"${call}"`) || tabSource.includes(`"${call}"`), `la UI usa ${call}`);
  }
  assert.ok(dashboardSource.includes('import { FlowsTab } from "./FlowsTab"'), "Dashboard importa FlowsTab");
  assert.ok(dashboardSource.includes('activeTab === "flows"'), "Dashboard renderiza el tab flows");
});

// ── 8. Contrato de editabilidad: brs legados no bloquean el render del flow ──

test("REQ027-CONTRACT: <br> con data-layer-* (frame legado) se normaliza y no bloquea create_html_frame", () => {
  // El audit solo: un br anidado (rich-text, nunca capa) NO es error.
  const solo = auditEditableFrame('<div data-layer-id="box" data-layer-name="Main" data-layer-kind="group" style="position:absolute;left:0;top:0;width:400px;height:300px;"><br data-layer-id="br1" data-layer-kind="text"></div>', "", { allowGroups: true });
  assert.ok(solo.valid, `br anidado no debe ser error de audit: ${solo.errors.join(" ")}`);
  // Pipeline real del nodo template: contenedor group con brs entre textos
  // (exactamente la forma que rompía el E2E con EDITABILITY_CONTRACT_ERROR).
  const html = [
    '<div data-layer-id="box" data-layer-name="Main" data-layer-kind="group" style="position:absolute;left:40px;top:40px;width:600px;height:400px;">',
    '<p data-layer-id="p1" data-layer-kind="text">Hola</p>',
    '<br data-layer-id="br1" data-layer-kind="text">',
    '<p data-layer-id="p2" data-layer-kind="text">mundo</p>',
    "</div>",
  ].join("");
  const norm = normalizeLayersFirstFrame(html, "", { width: 1080, height: 1080, background: "#ffffff" });
  assert.ok(!norm.html.includes("<br data-layer-id"), "la normalización remueve data-layer-* del br");
  assert.ok(norm.audit.valid, `el html normalizado pasa el audit: ${norm.audit.errors.join(" ")}`);
  assert.ok(/data-layer-name="p1"|data-layer-name="Hola"/.test(norm.html) || (norm.html.match(/data-layer-name/g) ?? []).length >= 3, "las capas reales conservan/añaden nombre");
});

// ── 9. Evaluador cron puro (alimento de flow_due_check — la IA agenda) ──────

test("REQ027-CRON: parseCron acepta 5-6 campos (segundos ignorados) y rechaza fuera de rango", () => {
  assert.doesNotThrow(() => parseCron("0 8 * * *"));
  assert.doesNotThrow(() => parseCron("*/15 8-18 * * 1-5"));
  assert.doesNotThrow(() => parseCron("0 30 9 * * *"), "6 campos: el primero son segundos y se ignora");
  assert.throws(() => parseCron("0 8 * *"), RangeError, "4 campos");
  assert.throws(() => parseCron("0 8 * * * * *"), RangeError, "7 campos");
  assert.throws(() => parseCron("99 * * * *"), RangeError, "minuto fuera de rango");
  assert.throws(() => parseCron("* 24 * * *"), RangeError, "hora fuera de rango");
  assert.throws(() => parseCron("* * * 13 *"), RangeError, "mes fuera de rango");
  assert.throws(() => parseCron("* * * * 8"), RangeError, "dow fuera de rango");
  assert.doesNotThrow(() => parseCron("* * * * 7"), "dow 7 = domingo");
});

test("REQ027-CRON: flowCronDue dispara el slot exacto y respeta el último run (idempotencia)", () => {
  const everyMinute = { type: "schedule", cron: "* * * * *", timezone: "America/Lima" };
  const now = new Date("2026-10-05T14:00:30Z"); // lunes (fixture fijo, sin reloj real)
  const v1 = flowCronDue(everyMinute, { now });
  assert.equal(v1.due, true);
  assert.equal(v1.slot, "2026-10-05T14:00:00.000Z", "slot = minuto actual truncado");
  const v2 = flowCronDue(everyMinute, { lastRunAt: "2026-10-05T14:00:00Z", now });
  assert.equal(v2.due, false, "el slot actual ya corrió → no re-dispara (reintento del mismo slot no duplica)");
  const v3 = flowCronDue(everyMinute, { lastRunAt: "2026-10-05T13:59:00Z", now });
  assert.equal(v3.due, true, "slot anterior corrido, actual no → dispara");
  assert.equal(v3.slot, "2026-10-05T14:00:00.000Z");
});

test("REQ027-CRON: diario 0 9 America/Lima y ventana laboral */15 8-18 * * 1-5", () => {
  const daily = { type: "schedule", cron: "0 9 * * *", timezone: "America/Lima" };
  const v = flowCronDue(daily, { lastRunAt: "2026-10-04T14:00:00Z", now: new Date("2026-10-05T14:00:20Z") });
  assert.equal(v.due, true, "lunes 14:00Z = 09:00 Lima (UTC-5) corresponde");
  assert.equal(v.slot, "2026-10-05T14:00:00.000Z");
  const v2 = flowCronDue(daily, { lastRunAt: "2026-10-05T14:00:00Z", now: new Date("2026-10-05T14:05:00Z") });
  assert.equal(v2.due, false, "ya corrió hoy 9am → la consulta de 9:05 no re-dispara");
  const v3 = flowCronDue(daily, { lastRunAt: "2026-10-04T14:00:00Z", now: new Date("2026-10-05T13:55:00Z") });
  assert.equal(v3.due, false, "08:55 Lima aún no toca");
  const work = { type: "schedule", cron: "*/15 8-18 * * 1-5", timezone: "America/Lima" };
  assert.equal(flowCronDue(work, { now: new Date("2026-10-05T14:00:00Z") }).due, true, "lunes 09:00 Lima en ventana");
  assert.equal(flowCronDue(work, { now: new Date("2026-10-04T14:00:00Z") }).due, false, "domingo fuera de 1-5");
});

test("REQ027-CRON: trigger inválido o no-schedule → due:false (flow_due_check nunca explota)", () => {
  assert.deepEqual(flowCronDue({ type: "schedule", cron: "99 * * * *", timezone: "America/Lima" }, {}), { due: false });
  assert.deepEqual(flowCronDue({ type: "schedule", cron: "0 8 * * *", timezone: "Marte/Olympus" }, {}), { due: false });
  assert.deepEqual(flowCronDue({ type: "manual" }, {}), { due: false });
  assert.deepEqual(flowCronDue({ type: "webhook" }, {}), { due: false });
  assert.deepEqual(flowCronDue(null, {}), { due: false });
});

test("REQ027-CRON: validateTrigger valida el cron con el parser REAL y timezone IANA", () => {
  assert.deepEqual(
    validateTrigger({ type: "schedule", cron: "0 8 * * *", timezone: "America/Santiago" }, { enabled: true }),
    { type: "schedule", cron: "0 8 * * *", timezone: "America/Santiago" },
  );
  assert.equal(validateTrigger({ type: "schedule", cron: "*/5 * * * *" }, { enabled: true }).timezone, "America/Lima", "timezone por defecto");
  assert.throws(() => validateTrigger({ type: "schedule", cron: "99 * * * *", timezone: "America/Lima" }, { enabled: true }),
    (e) => e.flowCode === "VALIDATION", "cron fuera de rango se rechaza AL GUARDAR (nunca dispara en silencio)");
  assert.throws(() => validateTrigger({ type: "schedule", cron: "0 8 * *", timezone: "America/Lima" }, { enabled: true }),
    (e) => e.flowCode === "VALIDATION", "4 campos");
  assert.throws(() => validateTrigger({ type: "schedule", cron: "0 8 * * *", timezone: "Lima inventado" }, { enabled: true }),
    (e) => e.flowCode === "VALIDATION", "timezone no IANA");
  assert.throws(() => validateTrigger({ type: "cron" }, { enabled: true }), (e) => e.flowCode === "VALIDATION");
});

// ── 10. Fase 3: rate cap freemium + mapeo 429 en el webhook API ───────

test("REQ027-RATE: 240 runs/flow/hora en runFlow (tras idempotencia, antes de concurrencia) → 429", () => {
  assert.equal(LIMITS.runsPerFlowPerHour, 240);
  // Anclas DENTRO del body de runFlow (los métodos del store se definen antes
  // y el indexOf global los encontraría primero).
  const runFlowBody = runtimeSource.slice(runtimeSource.indexOf("async function runFlow(flow, { input, requestId }"));
  const idemIdx = runFlowBody.indexOf("findRunByRequestId");
  const rateIdx = runFlowBody.indexOf("FLOW_RATE_LIMITED");
  const concIdx = runFlowBody.indexOf("countRunningRuns");
  assert.ok(idemIdx !== -1 && rateIdx !== -1 && concIdx !== -1, "los tres chequeos existen");
  assert.ok(idemIdx < rateIdx && rateIdx < concIdx, "orden: idempotencia (un retry del mismo requestId pasa) → rate cap → concurrencia");
  assert.match(runtimeSource, /countRunsSince\(flow\.id, new Date\(Date\.now\(\) - 3_600_000\)/, "ventana de 1 hora");
  assert.match(apiSource, /code === "CONCURRENCY_LIMIT" \|\| code === "FLOW_RATE_LIMITED" \? 429/, "webhook responde 429 (backoff), no 500");
});

// ── 11. Migración v62 (RPC prune real + índice metadata) ──────

test("REQ027-V62: prune_flow_runs existe de verdad (el engine ya la llamaba), blindada y con cap", () => {
  assert.match(migrationV62, /CREATE OR REPLACE FUNCTION prune_flow_runs\(p_flow_id text, p_keep int DEFAULT 200\)/, "misma firma que sb.rpc del engine");
  assert.match(migrationV62, /SECURITY DEFINER/);
  assert.match(migrationV62, /SET search_path = public/, "convención Supabase");
  assert.match(migrationV62, /REVOKE EXECUTE ON FUNCTION prune_flow_runs\(text, int\) FROM PUBLIC/, "sin acceso anónimo");
  assert.match(migrationV62, /GRANT EXECUTE ON FUNCTION prune_flow_runs\(text, int\) TO service_role/, "solo el rol del engine");
  assert.match(migrationV62, /LEAST\(GREATEST\(p_keep, 1\), 1000\)/, "keep acotado: ni 0 ni absurdo");
  assert.match(migrationV62, /ORDER BY started_at DESC, id DESC/, "conserva los runs MÁS RECIENTES");
  assert.match(coreSource, /sb\.rpc\("prune_flow_runs"/, "el engine usa exactamente esta RPC");
  assert.match(migrationV62, /NOTIFY pgrst, 'reload schema'/, "PostgREST la ve sin restart");
});

test("REQ027-V62: índice parcial de agendados queda como metadata (sin scanner server-side)", () => {
  assert.match(migrationV62, /CREATE INDEX IF NOT EXISTS idx_flows_schedule_enabled\s+ON flows \(updated_at\)\s+WHERE enabled AND trigger->>'type' = 'schedule'/);
  assert.ok(!coreSource.includes("listScheduledFlows"), "el store ya no lista flows agendados (el server no barre)");
});

// ── 12. Sin scheduler server-side: la IA agenda (flow_due_check + patrón) ───────

test("REQ027-CRON-WIRING: el worker NO barre flows — scheduled() queda solo para webhooks", () => {
  assert.ok(!workerSource.includes("runDueCronFlows"), "el worker no importa/ejecuta el scanner de flows");
  assert.ok(!workerSource.includes("FLOWS_CRON_ENABLED"), "kill switch del scheduler eliminado");
  assert.ok(!workerSource.includes("createFlowToolBridge"), "el worker ya no arma el bridge de flows");
  assert.ok(!workerSource.includes("flows-cron"), "sin logs del barrido de flows");
  assert.match(workerSource, /import \{ handler as mcpHandler \} from "\.\.\/netlify\/functions\/mcp\.mjs";/, "import de mcp sin bridge");
  const sched = workerSource.slice(workerSource.indexOf("async scheduled("));
  assert.match(sched, /sweepWebhookDeliveries/, "el cron del worker sigue entregando webhooks");
  assert.match(sched, /WEBHOOK_DISPATCH_SECRET/, "kill switch de webhooks intacto");
  assert.match(sched, /platform_webhook_deliveries/, "demand check de webhooks intacto");
  assert.ok(!sched.includes("trigger->>type"), "el scheduled() no consulta flows agendados");
  assert.ok(!runtimeSource.includes("runDueCronFlows"), "el runtime ya no exporta scanner");
  assert.match(runtimeSource, /NO existe scheduler server-side/, "la decisión de producto queda documentada en el runtime");
  assert.ok(!(LIMITS instanceof Object && "cronFlowsPerSweep" in LIMITS), "LIMITS ya no tiene presupuesto de barrido");
  assert.equal(LIMITS.cronLookbackMs, 86_400_000);
  assert.equal(LIMITS.cronMaxSlotScan, 480, "catch-up ~8h para la consulta de la IA");
});

test("REQ027-CRON-WIRING: flow_due_check es consulta pasiva con el patrón del agente", () => {
  const due = catalog.find((t) => t.name === "flow_due_check");
  assert.ok(due, "flow_due_check en catálogo");
  const d = String(due.description);
  assert.ok(d.includes("CONSULTA PASIVA") && d.includes("NUNCA ejecuta flows por horario"), "declara que el server no agenda");
  assert.ok(d.includes("TU PROPIO scheduler") && d.includes("flow_run"), "instruye: programa TÚ y dispara flow_run");
  assert.ok(d.includes("cron:<flowId>:<slot-de-5-min>"), "requestId idempotente en el patrón");
  assert.match(mcpSource, /const FLOW_READ_METHODS = new Set\(\[[^\]]*"flow_due_check"/, "granta viewer (read-only)");
  assert.match(mcpSource, /const FLOW_TENANT_METHODS = new Set\(\[[^\]]*"flow_due_check"/, "tenant resuelto en DB como flow_get");
  const dueCase = mcpSource.slice(mcpSource.indexOf('case "flow_due_check":'), mcpSource.indexOf('case "flow_export":'));
  assert.match(dueCase, /flowsAssertEnabled\(\)/, "respeta el kill switch del builder");
  assert.match(dueCase, /flowCronDue\(trigger/, "usa el MISMO evaluador puro de flows-core");
  assert.match(dueCase, /store\.latestRun\(flow\.id\)/, "lastRunAt decide el catch-up");
  assert.match(dueCase, /cron:\$\{flow\.id\}:\$\{verdict\.slot\}/, "sugiere el requestId idempotente flow+slot");
  assert.match(dueCase, /flowError\("VALIDATION"/, "rechaza flows sin trigger schedule");
  assert.ok(!dueCase.includes("runFlow"), "la consulta NUNCA ejecuta (pasiva)");
});

test("REQ027-CRON-WIRING: UI y catálogo enseñan 'los horarios los ejecuta tu IA'", () => {
  assert.ok(editorSource.includes("los horarios los ejecuta tu IA"), "tooltip del cron declara el patrón del agente");
  assert.ok(!editorSource.includes("Se ejecuta SOLO") && !editorSource.includes("granularidad 5 min"), "sin rastro del tooltip del barrido del worker");
  const flowSaveDoc = catalog.find((t) => t.name === "flow_save");
  const fsDoc = String(flowSaveDoc.description);
  assert.ok(fsDoc.includes("DECLARATIVO") && fsDoc.includes("programa TÚ"), "NODE_SCHEMA_DOC del Trigger enseña el patrón");
  assert.ok(fsDoc.includes("flow_due_check"), "flow_save apunta a flow_due_check");
  const runDoc = String(catalog.find((t) => t.name === "flow_run").description);
  assert.ok(runDoc.includes("TU scheduler") && runDoc.includes("cron:<flowId>:<slot-de-5-min>"), "flow_run documenta el requestId idempotente del scheduler");
  const histDoc = String(catalog.find((t) => t.name === "flow_history").description);
  assert.ok(histDoc.includes("TU scheduler"), "flow_history ayuda a verificar corridas del scheduler");
});

// ── 10. Proveedores IA (8): nativos Gemini/Anthropic + OpenAI-compatible ────

test("REQ027-PROVIDERS: catálogo de 8 proveedores y rechazo del desconocido", () => {
  assert.deepEqual([...AI_PROVIDERS], ["gemini", "openai", "anthropic", "deepseek", "glm", "kimi", "qwen", "openrouter"]);
  assert.throws(() => validateAiConfig({ provider: "chatgpt", prompt: "p" }), (e) => e.flowCode === "AI_CONFIG");
});

test("REQ027-PROVIDERS: Anthropic usa /v1/messages nativo (x-api-key, system top-level)", async () => {
  let captured = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), headers: init.headers, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ model: "claude-sonnet-4-5", content: [{ type: "text", text: "respuesta" }], usage: { input_tokens: 7, output_tokens: 3 } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const out = await runAiText(
      { provider: "anthropic", model: "claude-sonnet-4-5", prompt: "hola", systemPrompt: "sys", maxOutputTokens: 100 },
      { type: "ai_provider", provider: "anthropic", secret: "sk-ant-qa" },
    );
    assert.equal(captured.url, "https://api.anthropic.com/v1/messages");
    assert.equal(captured.headers["x-api-key"], "sk-ant-qa");
    assert.equal(captured.headers["anthropic-version"], "2023-06-01");
    assert.equal(captured.body.system, "sys");
    assert.equal(captured.body.max_tokens, 100);
    assert.deepEqual(captured.body.messages, [{ role: "user", content: "hola" }]);
    assert.equal(out.text, "respuesta");
    assert.deepEqual(out.usage, { inputTokens: 7, outputTokens: 3 });
  } finally { globalThis.fetch = realFetch; }
});

test("REQ027-PROVIDERS: openai/kimi/qwen van por chat/completions OpenAI-compatible", async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), auth: init.headers.authorization, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    for (const [provider, base] of [["openai", "https://api.openai.com/v1"], ["kimi", "https://api.moonshot.ai/v1"], ["qwen", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"]]) {
      const out = await runAiText({ provider, model: "m-1", prompt: "p", systemPrompt: "s" }, { type: "ai_provider", provider, secret: "sk-q" });
      const call = seen[seen.length - 1];
      assert.equal(call.url, `${base}/chat/completions`, provider);
      assert.equal(call.auth, "Bearer sk-q", provider);
      assert.equal(call.body.messages[0].role, "system", provider);
      assert.equal(out.text, "ok", provider);
    }
  } finally { globalThis.fetch = realFetch; }
});

// ── 11. Paleta por categorías + guardas del nodo tool (plan FLOW_NODE_PICKER) ──

const CATALOG_NAMES = new Set(catalog.map((t) => t.name));
const toolFlow = (tool, args = {}) => ({
  id: "flow_tooltest", name: "t", trigger: { type: "manual" },
  nodes: [
    { id: "m1", type: "map", config: { value: {} }, position: { x: 0, y: 0 } },
    { id: "t1", type: "tool", config: { tool, args }, position: { x: 10, y: 0 } },
  ],
  edges: [{ from: "m1", to: "t1" }],
});
const toolDeps = (calls) => ({
  workspaceId: "ws_run",
  callTool: async (name, args) => { calls.push({ name, args }); return { ok: true, tool: name }; },
});

test("REQ027-TOOL: catálogo curado — tools REALES, tiers sin flow_*, categorías estables", () => {
  assert.ok(FLOW_TOOL_CATALOG.length >= 80, `catálogo curado grande (${FLOW_TOOL_CATALOG.length})`);
  assert.equal(FLOW_TOOL_CATALOG.filter((t) => t.tier === 0).length, 14, "P0 = ciclo social→CRM→marca→render");
  assert.equal(CATEGORIES.length, 10, "11 filas en el plan menos Tool MCP (ahora es entrada genérica)");
  for (const t of FLOW_TOOL_CATALOG) {
    assert.match(t.tool, /^[a-z0-9_]{1,60}$/, `nombre válido: ${t.tool}`);
    assert.ok(!t.tool.startsWith("flow_"), `flow_* JAMÁS en la paleta: ${t.tool}`);
    assert.ok([0, 1, 2].includes(t.tier), `tier 0-2: ${t.tool}`);
    assert.ok(CATEGORIES.some((c) => c.id === t.cat), `categoría conocida: ${t.cat}`);
    assert.ok(CATALOG_NAMES.has(t.tool), `tool existe en tools_catalog.json: ${t.tool}`);
  }
  assert.ok(FLOW_TOOL_WRITE.has("reply_social") && FLOW_TOOL_WRITE.has("publish_content"), "escrituras marcadas para dedupe");
  assert.ok(!FLOW_TOOL_WRITE.has("list_social_inbox"), "lecturas no marcadas");
  assert.deepEqual(
    Object.fromEntries(Object.entries(FLOW_TOOL_TIERS).filter(([, tier]) => tier === 0).sort()),
    Object.fromEntries(FLOW_TOOL_CATALOG.filter((t) => t.tier === 0).map((t) => [t.tool, 0]).sort()),
    "FLOW_TOOL_TIERS deriva del catálogo (una sola fuente)",
  );
});

test("REQ027-TOOL: tool desconocida o flow_* se rechaza al GUARDAR", () => {
  assert.throws(() => validateFlowDefinition(toolFlow("make_coffee"), { enabled: false }),
    (e) => e.flowCode === "VALIDATION", "tool fuera del catálogo no se guarda");
  assert.throws(() => validateFlowDefinition(toolFlow("flow_get"), { enabled: false }),
    (e) => e.flowCode === "VALIDATION", "flow_* no se guarda como tool (usa Sub-flow)");
  assert.doesNotThrow(() => validateFlowDefinition(toolFlow("list_social_inbox"), { enabled: true }), "tool P0 configurada se guarda y activa");
  assert.match(coreSource, /SOLO tools del catálogo de la paleta/, "NODE_SCHEMA_DOC documenta la allowlist para las IAs");
});

test("REQ027-TOOL: runtime — MUSA_TOOL_DENIED para tools fuera de tiers y para flow_*", async () => {
  const calls = [];
  const denied = await executeFlow(toolFlow("make_coffee"), {}, toolDeps(calls));
  assert.equal(denied.status, "failed");
  assert.match(denied.error ?? "", /^MUSA_TOOL_DENIED:/);
  assert.equal(calls.filter((c) => c.name === "make_coffee").length, 0, "nada llegó al bridge (spawnErrorWorkflow sí lista flows: B3)");
  const self = await executeFlow(toolFlow("flow_list"), {}, toolDeps(calls));
  assert.match(self.error ?? "", /^MUSA_TOOL_DENIED:/, "flow_* apunta al nodo Sub-flow (el lookup flow_list restante es el B3)");
});

test("REQ027-TOOL: runtime — workspaceId SIEMPRE lo fuerza el run (bridge admin sintético)", async () => {
  const calls = [];
  const res = await executeFlow(toolFlow("list_social_inbox", { workspaceId: "ws_EVIL", limit: 5 }), {}, toolDeps(calls));
  assert.notEqual(res.status, "failed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.workspaceId, "ws_run", "un workspaceId malicioso en args se SOBREESCRIBE");
  assert.equal(calls[0].args.limit, 5, "los demás args pasan intactos (resueltos {{...}})");
});

test("REQ027-TOOL: runtime — presupuesto por run (MUSA_TOOL_RATE)", async () => {
  const original = LIMITS.maxToolCallsPerRun;
  LIMITS.maxToolCallsPerRun = 1;
  try {
    const calls = [];
    const flow = toolFlow("get_crm_overview");
    flow.nodes.push({ id: "t2", type: "tool", config: { tool: "get_crm_overview", args: {} }, position: { x: 20, y: 0 } });
    flow.edges.push({ from: "m1", to: "t2" });
    const res = await executeFlow(flow, {}, toolDeps(calls));
    assert.equal(res.status, "failed");
    assert.match(res.error ?? "", /^MUSA_TOOL_RATE:/, "la 2ª tool del run se bloquea por presupuesto");
    assert.equal(calls.filter((c) => c.name === "get_crm_overview").length, 1, "solo la 1ª llegó al bridge (el resto es lookup B3)");
  } finally { LIMITS.maxToolCallsPerRun = original; }
});

test("REQ027-TOOL: runtime — escritura deduplica en loop (anti doble publicación)", async () => {
  const calls = [];
  const flow = {
    id: "flow_dedupe", name: "t", trigger: { type: "manual" },
    nodes: [
      { id: "m1", type: "map", config: { value: {} }, position: { x: 0, y: 0 } },
      { id: "c1", type: "code", config: { js: "return { items: [1, 2] };" }, position: { x: 10, y: 0 } },
      { id: "l1", type: "loop", config: { batchSize: 1 }, position: { x: 20, y: 0 } },
      { id: "w1", type: "tool", config: { tool: "capture_social_contact", args: { source: "flowtest" } }, position: { x: 30, y: 0 } },
    ],
    edges: [{ from: "m1", to: "c1" }, { from: "c1", to: "l1" }, { from: "l1", to: "w1" }],
  };
  const res = await executeFlow(flow, {}, toolDeps(calls));
  assert.equal(res.status, "failed");
  assert.match(res.error ?? "", /MUSA_TOOL_RATE:/, "el 2º lote con args idénticos se bloquea (el loop lo envuelve en BRANCH_FAILED)");
  assert.equal(calls.filter((c) => c.name === "capture_social_contact").length, 1, "la tool de escritura corrió UNA sola vez");
});

// ── 12. Blindaje del nodo agent (mismo contrato que el nodo tool) ──

const agentFlow = (tools, maxIterations = 2) => ({
  id: "flow_agentguard", name: "ag", trigger: { type: "manual" },
  nodes: [{ id: "g1", type: "agent", config: { credentialId: "cred_x", tools, maxIterations, prompt: "p" }, position: { x: 0, y: 0 } }],
  edges: [],
});
const agentDeps = (calls, replies) => {
  let i = 0;
  return {
    workspaceId: "ws_run",
    getCredential: async () => ({ type: "ai_provider", provider: "stub", secret: "s", model: "m" }),
    callTool: async (name, args) => { calls.push({ name, args }); return { ok: true, tool: name }; },
    runAiText: async () => ({ text: replies[Math.min(i++, replies.length - 1)], model: "stub" }),
  };
};
const agentStep = (run) => run.steps.find((s) => s.nodeId === "g1");

test("REQ027-AGENT: lista vacía = responde directo (el engine SÍ lo impone)", async () => {
  const calls = [];
  const run = await executeFlow(agentFlow([]), {}, agentDeps(calls, ['{"tool":"flow_save","args":{"name":"robado"}}']));
  assert.equal(run.status, "success", "el agent no truena: los tool-calls se deniegan en el transcript");
  assert.equal(calls.length, 0, "ninguna tool llegó al bridge");
  const step = agentStep(run);
  assert.equal(step.output.toolCalls.length, 2, "cada intento queda registrado como rechazo");
  assert.equal(step.output.toolCalls[0].ok, false);
  assert.equal(step.output.exhausted, true, "agotó iteraciones sin final (comportamiento esperado)");
});

test("REQ027-AGENT: flow_* y tools fuera del catálogo se rechazan AUN listadas", async () => {
  const calls = [];
  const run = await executeFlow(agentFlow(["flow_delete", "made_up_tool"]), {}, agentDeps(calls, ['{"tool":"made_up_tool","args":{}}']));
  assert.equal(run.status, "success");
  assert.equal(calls.length, 0, "made_up_tool no existe en FLOW_TOOL_TIERS");
  const run2 = await executeFlow(agentFlow(["flow_delete", "made_up_tool"]), {}, agentDeps(calls, ['{"tool":"flow_delete","args":{"flowId":"x"}}']));
  assert.equal(run2.status, "success");
  assert.equal(calls.length, 0, "flow_delete tampoco corrió (spawnErrorWorkflow B3 sí lista flows, por eso no se compara con 0 global)");
});

test("REQ027-AGENT: tool del catálogo corre y el run FUERZA el workspaceId", async () => {
  const calls = [];
  const run = await executeFlow(agentFlow(["list_templates"]), {}, agentDeps(calls, ['{"tool":"list_templates","args":{"workspaceId":"ws_EVIL"}}']));
  assert.equal(run.status, "success");
  assert.equal(calls.filter((c) => c.name === "list_templates").length, 2, "las lecturas pueden repetirse entre turnos (el dedupe solo aplica a escrituras)");
  assert.ok(calls.filter((c) => c.name === "list_templates").every((c) => c.args.workspaceId === "ws_run"), "el workspaceId del modelo se SOBREESCRIBE en todas");
  assert.equal(agentStep(run).output.toolCalls[0].ok, true);
});

test("REQ027-AGENT: escritura deduplica entre turnos (anti doble publicación)", async () => {
  const calls = [];
  const run = await executeFlow(agentFlow(["capture_social_contact"], 3), {}, agentDeps(calls, ['{"tool":"capture_social_contact","args":{"source":"agenttest","text":"hola"}}']));
  assert.equal(run.status, "success");
  assert.equal(calls.filter((c) => c.name === "capture_social_contact").length, 1, "el 2º turno con args idénticos NO re-ejecuta la escritura");
  assert.deepEqual(agentStep(run).output.toolCalls.map((c) => c.ok), [true, false, false], "1ª ok, réplicas denegadas");
});

test("REQ027-AGENT: comparte el presupuesto de tools del run (MUSA_TOOL_RATE)", async () => {
  const original = LIMITS.maxToolCallsPerRun;
  LIMITS.maxToolCallsPerRun = 1;
  try {
    const calls = [];
    const replies = ['{"tool":"list_templates","args":{"q":"a"}}', '{"tool":"list_templates","args":{"q":"b"}}'];
    const run = await executeFlow(agentFlow(["list_templates"], 3), {}, agentDeps(calls, replies));
    assert.equal(run.status, "success", "los denegados no tumban el run");
    assert.equal(calls.filter((c) => c.name === "list_templates").length, 1, "la 2ª llamada del agent superó el presupuesto del run");
    assert.deepEqual(agentStep(run).output.toolCalls.map((c) => c.ok), [true, false, false], "turno 3 también denegado");
  } finally { LIMITS.maxToolCallsPerRun = original; }
});

test("REQ027-AGENT: contratos de source (engine + editor)", () => {
  assert.match(coreSource, /Blindaje agent \(mismo contrato que el nodo tool\)/, "el guard vive junto al loop del agent");
  assert.match(coreSource, /Agent: tools máx 8 — lista vacía = responde directo/, "NODE_SCHEMA_DOC documenta la imposición para las IAs");
  assert.doesNotMatch(editorSource, /flow_list, flow_get/, "el placeholder ya NO sugiere tools flow_*");
  assert.match(editorSource, /Tools del agent \(máx 8\)/, "el inspector ofrece el picker del catálogo");
});

test("REQ027-PALETA: filas de la paleta sin blanco-sobre-blanco (regla dura de accesibilidad)", () => {
  // En React, `background: <cond> : undefined` ELIMINA la propiedad inline: el 
  // botón cae al ButtonFace claro del navegador y con el color blanco de btnBase
  // el texto queda invisible. El fondo inactivo debe ser el cristal oscuro     
  // explícito (mismo valor de btnBase). Regla del usuario: nunca blanco sobre blanco.
  assert.doesNotMatch(editorSource, /background: [^,}]+\? [^:]+: undefined [}]/, "ningún background condicional puede caer en undefined");
  assert.match(editorSource, /background: active \? `\$\{color\}1f` : "rgba\(255,255,255,0\.05\)"/, "filas inactivas con cristal oscuro explícito");
});

test("REQ027-FITVIEW: al cargar, el lienzo encuadra el flow completo (feedback v60.2)", () => {
  // El viewport NUNCA queda en el origen del mundo: el efecto de montaje
  // calcula el bbox del grafo (trigger + nodos) y centra; si no cabe,
  // zoom out automático con los mismos límites de la rueda (0.4–1).
  assert.doesNotMatch(editorSource, /\(WORLD_W - el\.clientWidth\) \/ 2/, "el viejo centrado en el origen del mundo debe estar eliminado");
  assert.match(editorSource, /const tp = \(trigger\?\.position \?\? triggerPos\) as \{ x: number; y: number \};/, "el bbox incluye la posición del disparo");
  assert.match(editorSource, /Math\.min\(1, Math\.max\(0\.4, Math\.min\(\(el\.clientWidth - pad\) \/ bw, \(el\.clientHeight - pad\) \/ bh\)\)\)/, "zoom de encuadre clamp 0.4–1 (nunca zoom-in, nunca fuera de los límites de la rueda)");
  assert.match(editorSource, /fitPendingRef\.current = \{ cx, cy \};/, "el scroll del encuadre se aplica tras el commit del zoom (sin clamp del extent viejo)");
});
