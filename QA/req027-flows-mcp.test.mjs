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
  LIMITS, NODE_TYPES, cryptoRandom12, exportShape, flowCronDue, flowError,
  parseCron, prepareFlowRow, stripCredentialRefs, validateFlowDefinition,
  validateTrigger,
} from "../netlify/functions/flows-core.mjs";
import { auditEditableFrame, normalizeLayersFirstFrame } from "../netlify/functions/editable-layers.mjs";
import { FLOW_LIBRARY, findFlowPreset } from "../src/data/flowLibrary.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const mcpSource = readFileSync(ROOT + "netlify/functions/mcp.mjs", "utf8");
const runtimeSource = readFileSync(ROOT + "netlify/functions/flows-runtime.mjs", "utf8");
const coreSource = readFileSync(ROOT + "netlify/functions/flows-core.mjs", "utf8");
const migration = readFileSync(ROOT + "supabase_migrations_v61.sql", "utf8");
const migrationV62 = readFileSync(ROOT + "supabase_migrations_v62.sql", "utf8");
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
];
const FLOW_READ_TOOLS = ["flow_list", "flow_get", "flow_history", "flow_export", "flow_library_list", "flow_credentials_list", "flow_due_check"];

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

test("REQ027-MCP: las 16 tools flow_* están registradas en MCP_TOOLS con inputSchema", () => {
  const objects = toolObjects(mcpToolsBody(mcpSource));
  for (const name of FLOW_TOOLS) {
    const obj = objects.find((o) => o.includes(`name: "${name}"`));
    assert.ok(obj, `${name} no está registrado en MCP_TOOLS`);
    assert.match(obj, /inputSchema:\s*\{\s*type:\s*"object"/, `${name} debe declarar inputSchema`);
  }
  const flowSave = objects.find((o) => o.includes('name: "flow_save"'));
  assert.match(flowSave, /required:\s*\["name",\s*"nodes",\s*"edges"\]/, "flow_save debe requerir name/nodes/edges");
});

test("REQ027-MCP: las 16 tools tienen case de despacho y catálogo sincronizado", () => {
  for (const name of FLOW_TOOLS) {
    assert.ok(mcpSource.includes(`case "${name}":`), `falta el case de despacho para ${name}`);
  }
  const flowEntries = catalog.filter((t) => String(t.name || "").startsWith("flow_"));
  assert.equal(flowEntries.length, FLOW_TOOLS.length, "tools_catalog.json debe contener exactamente las 16 flow_*");
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
  assert.deepEqual([...NODE_TYPES].sort(), ["agent", "ai", "approval", "code", "compare", "condition", "group", "http", "loop", "map", "merge", "note", "report", "source_http", "source_nitter", "source_rss", "subflow", "switch", "template", "text", "tool", "wait", "wait_webhook"], "contrato estable de tipos (los 13 nuevos: plan FLOW_BUILDER_GAP_VS_N8N — 8 fase 2 + agent/compare/wait_webhook/approval/group paridad n8n)");
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
