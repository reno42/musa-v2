// QA/flows-v2.test.mjs — Flows v2 (REQ-FLW1..8), aditivo sobre REQ-027.
// Lo puro se testea de verdad importándolo (flows-core.mjs: versiones de tipos,
// errorClass, pins, staticData, run de un nodo); el despacho MCP, el runtime y
// la migración se afirman sobre el source (convención del repo: req027/req032).
// Corre con:
//   node --experimental-strip-types --test QA/flows-v2.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  LIMITS, NODE_TYPES, classifyFlowError, executeFlow, executeSingleNode,
  nodeTypeMaxVersion, NODE_TYPE_VERSIONS, validateFlowDefinition, validatePins,
  validateStaticDataPatch, validateTrigger, versionDefinition,
} from "../netlify/functions/flows-core.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const mcpSource = readFileSync(ROOT + "netlify/functions/mcp.mjs", "utf8");
const runtimeSource = readFileSync(ROOT + "netlify/functions/flows-runtime.mjs", "utf8");
const coreSource = readFileSync(ROOT + "netlify/functions/flows-core.mjs", "utf8");
const migration = readFileSync(ROOT + "supabase_migrations_v74.sql", "utf8");
const catalog = JSON.parse(readFileSync(ROOT + "tools_catalog.json", "utf8"));
const apiSource = readFileSync(ROOT + "api/src/index.ts", "utf8");
const editorSource = readFileSync(ROOT + "src/components/flows/FlowEditor.tsx", "utf8");
const canvasSource = readFileSync(ROOT + "src/components/flows/FlowCanvas.tsx", "utf8");
const flowTypesSource = readFileSync(ROOT + "src/components/flows/flowTypes.ts", "utf8");

// Las 4 tools nuevas de Flows v2 (el total del server pasa 406 → 410).
const V2_TOOLS = ["flow_versions_list", "flow_rollback", "flow_run_node", "flow_unpin"];

const draft = {
  name: "QA v2 flow",
  trigger: { type: "manual" },
  nodes: [{ id: "m1", type: "map", config: { value: { a: 1 } }, position: { x: 0, y: 0 } }],
  edges: [],
};

// ── FLW2: versiones de TIPOS de nodo ────────────────────────────────────────

test("FLW2-CORE: catálogo NODE_TYPE_VERSIONS cubre los 29 tipos, todos v1 hoy", () => {
  assert.deepEqual(Object.keys(NODE_TYPE_VERSIONS).sort(), [...NODE_TYPES].sort(), "el catálogo cubre EXACTAMENTE los tipos del engine");
  for (const type of NODE_TYPES) assert.equal(NODE_TYPE_VERSIONS[type], 1, `${type} arranca en v1 (ningún flow existente cambia de semantics)`);
  assert.equal(nodeTypeMaxVersion("map"), 1);
  assert.equal(nodeTypeMaxVersion("nope"), null, "tipo desconocido → null (no 1)");
});

test("FLW2-CORE: version:1 declarada valida y NO se persiste; version futura o basura se rechaza citando el máximo conocido", () => {
  const withV1 = (version) => validateFlowDefinition(
    { ...draft, nodes: [{ id: "m1", type: "map", version, config: { value: { a: 1 } }, position: { x: 0, y: 0 } }] },
    { enabled: false },
  );
  assert.equal(withV1(1).nodes[0].version, undefined, "v1 es el default: no viaja en el JSON (JSON del nodo igual que siempre)");
  assert.throws(() => withV1(2), (e) => e.flowCode === "VALIDATION" && /solo conoce hasta v1/.test(e.message), "v2 sin publicar se rechaza nombrando el máximo");
  assert.throws(() => withV1(0), (e) => e.flowCode === "VALIDATION");
  assert.throws(() => withV1(1.5), (e) => e.flowCode === "VALIDATION");
  assert.throws(() => withV1("x"), (e) => e.flowCode === "VALIDATION");
});

test("FLW2-CORE: un flow guardado en v1 SIGUE validando cuando el catálogo publique v2 (evolución sin romper)", () => {
  const original = NODE_TYPE_VERSIONS.map;
  try {
    NODE_TYPE_VERSIONS.map = 2; // el server publica map v2
    const def = validateFlowDefinition(
      { ...draft, nodes: [{ id: "m1", type: "map", version: 1, config: { value: { a: 1 } }, position: { x: 0, y: 0 } }] },
      { enabled: false },
    );
    assert.equal(def.nodes[0].type, "map");
    assert.equal(def.nodes[0].config && def.nodes[0].config.value && def.nodes[0].config.value.a, 1, "la config v1 se normaliza igual (dispatch por type@version)");
    // v2 publicada pero SIN normalizador propio → error de CATÁLOGO explícito
    // (no de usuario): el server sabe que le falta código, no que el flow está mal.
    assert.throws(
      () => validateFlowDefinition(
        { ...draft, nodes: [{ id: "m1", type: "map", version: 2, config: { value: { a: 1 } }, position: { x: 0, y: 0 } }] },
        { enabled: false },
      ),
      (e) => e.flowCode === "VALIDATION" && /no tiene validador en este server/.test(e.message),
    );
  } finally {
    NODE_TYPE_VERSIONS.map = original; // el test no muta el catálogo global
  }
});

// ── FLW5: taxonomía de errores ──────────────────────────────────────────────

test("FLW5-CORE: classifyFlowError — matriz user|operational|internal", () => {
  const e = (flowCode, extra = {}) => Object.assign(new Error("x"), { flowCode }, extra);
  // user: lo corrige quien edita el flow — retry NUNCA aplica
  for (const code of ["VALIDATION", "INPUT_REQUIRED", "SECRET_IN_CONFIG", "AI_NO_CREDENTIAL", "AI_SCHEMA", "CREDENTIAL_MISSING", "MUSA_TOOL_DENIED", "WAIT_IN_LOOP"]) {
    assert.equal(classifyFlowError(e(code)), "user", code);
  }
  // operational: transitorio — retry SÍ aplica
  assert.equal(classifyFlowError(e("TIMEOUT")), "operational");
  assert.equal(classifyFlowError(e("HTTP_ERROR", { output: { status: 503 } })), "operational", "5xx transitorio");
  assert.equal(classifyFlowError(e("HTTP_ERROR", { output: { status: 429 } })), "operational", "429 transitorio");
  // HTTP_ERROR 4xx (≠429) = la API rechazó el request → user
  assert.equal(classifyFlowError(e("HTTP_ERROR", { output: { status: 404 } })), "user");
  // internal: bug del server/engine — reportar, no reintentar
  for (const code of ["RUNTIME_CONFIG", "STORAGE", "CONFIG"]) assert.equal(classifyFlowError(e(code)), "internal", code);
  assert.equal(classifyFlowError(new TypeError("fetch failed")), "operational", "red caída = operational (reintentable)");
  assert.equal(classifyFlowError(Object.assign(new Error("boom"), { name: "AbortError" })), "operational");
  assert.equal(classifyFlowError(new Error("desconocido")), "internal", "defecto conservador");
  assert.equal(classifyFlowError(null), "internal", "ni siquiera hay error → internal");
});

test("FLW5-ENGINE: execOne estampa errorClass en el step y el retry SOLO continúa si es operational", () => {
  assert.match(coreSource, /const errorClass = classifyFlowError\(error\);/, "el step lleva errorClass (viaja a flow_history/flow_run sin queries extra)");
  assert.match(coreSource, /record\.error = \{ code: [^}]*errorClass/, "el error del step incluye la clase");
  assert.match(coreSource, /attempt < attempts && errorClass === "operational" && Date\.now\(\) < deadline/, "REQ: el backoff solo sigue para operational — user/internal cortan el retry");
});

// ── FLW3: pins persistidos (debug de borradores) ────────────────────────────

test("FLW3-CORE: validatePins — objeto {nodeId: salida}, caps 10KB/pin y 40KB/flow, ids reales, vacío = null", () => {
  assert.equal(validatePins(null, new Set(["m1"])), null, "sin pins = null (guardar sin el parámetro limpia)");
  assert.deepEqual(validatePins({}, new Set(["m1"])), null);
  assert.deepEqual(validatePins({ m1: { items: [1] } }, new Set(["m1"])), { m1: { items: [1] } });
  assert.throws(() => validatePins({ ghost: {} }, new Set(["m1"])), (e) => e.flowCode === "VALIDATION" && /no existe/.test(e.message), "pinea ids de NODO");
  assert.throws(() => validatePins({ m1: "x".repeat(LIMITS.pinMaxCharsPerNode + 1) }, new Set(["m1"])), (e) => e.flowCode === "VALIDATION", "cap por pin");
  assert.throws(() => validatePins({ m1: "x".repeat(20_000), m2: "x".repeat(21_000) }, new Set(["m1", "m2"])), (e) => e.flowCode === "VALIDATION", "cap total por flow");
  assert.equal(LIMITS.pinMaxCharsPerNode, 10_000);
  assert.equal(LIMITS.pinMaxCharsTotal, 40_000);
});

test("FLW3-RUN: input.__pins congela el nodo (pinned:true) y su salida alimenta aguas abajo; sin pins el nodo corre de verdad", async () => {
  const flow = {
    id: "flow_v2pins", name: "pins", trigger: { type: "manual" },
    nodes: [
      { id: "m1", type: "map", config: { value: { title: "hola" } }, position: { x: 0, y: 0 } },
      { id: "t1", type: "text", config: { template: "{{steps.m1.title}}" }, position: { x: 10, y: 0 } },
    ],
    edges: [{ from: "m1", to: "t1" }],
  };
  // Producción (sin pins): el map ejecuta de verdad.
  const real = await executeFlow(flow, {}, {});
  assert.equal(real.status, "success");
  assert.ok(JSON.stringify(real.steps.find((s) => s.nodeId === "t1").output).includes("hola"));
  assert.ok(!real.steps.find((s) => s.nodeId === "m1").pinned, "sin pins no hay flag pinned");
  // Debug (con pins): el map NO se ejecuta — su salida congelada alimenta t1.
  const pinned = await executeFlow(flow, { __pins: { m1: { title: "congelado" } } }, {});
  assert.equal(pinned.status, "success");
  const m1Step = pinned.steps.find((s) => s.nodeId === "m1");
  assert.equal(m1Step.pinned, true, "el step queda marcado pinned (visible en Historial)");
  assert.ok(!JSON.stringify(pinned.steps.find((s) => s.nodeId === "t1").output).includes("hola"));
  assert.ok(JSON.stringify(pinned.steps.find((s) => s.nodeId === "t1").output).includes("congelado"), "la salida congelada reemplaza la ejecución");
});

test("FLW3-MCP: pins SOLO en borradores (enabled:true se rechaza), flow_unpin limpia, y mode:dev es la ÚNICA puerta en runtime", () => {
  // flow_save: validación + limpieza + persistencia
  const saveBody = mcpSource.slice(mcpSource.indexOf('case "flow_save":'), mcpSource.indexOf('case "flow_list":'));
  assert.match(saveBody, /params\.pins != null[\s\S]*?params\.enabled === true[\s\S]*?pins solo es válido en borradores/, "enabled:true con pins → -32602");
  assert.match(saveBody, /row\.pins = validatePins\(params\.pins/, "los pins se validan contra los ids del flow");
  assert.match(saveBody, /row\.pins = \{\};/, "guardar SIN el parámetro los limpia");
  // flow_unpin: reset explícito
  const unpinStart = mcpSource.indexOf('case "flow_unpin":');
  const unpinBody = mcpSource.slice(unpinStart, mcpSource.indexOf("default:", unpinStart));
  assert.match(unpinBody, /updateFlow\(flow\.id, wsId, \{ pins: \{\}/, "flow_unpin vacía el mapa");
  // flow_get: los pins son visibles para quien depura (solo si no están vacíos)
  const getBody = mcpSource.slice(mcpSource.indexOf('case "flow_get":'), mcpSource.indexOf('case "flow_delete":'));
  assert.match(getBody, /flow\.pins && typeof flow\.pins === "object"/, "flow_get expone los pins (observabilidad del debug)");
  // runtime: mode:"dev" es la ÚNICA puerta — producción NUNCA ejecuta pins
  assert.match(runtimeSource, /if \(mode === "dev" && flow\.pins[\s\S]*?__pins: \{ \.\.\.existingPins, \.\.\.flow\.pins \} \}/, "dev fusiona flow.pins en input.__pins (camino B7 existente)");
  assert.match(runtimeSource, /producción: pins NUNCA corren/, "la decisión queda documentada donde se decide");
});

// ── FLW1: versiones de flow + rollback ──────────────────────────────────────

test("FLW1-CORE: versionDefinition — snapshot EXACTO del contrato editable, sin columnas de infra", () => {
  assert.deepEqual(
    Object.keys(versionDefinition({})).sort(),
    ["edges", "enabled", "inputs", "name", "nodes", "tags", "trigger", "vars"],
    "name|enabled|trigger|nodes|edges|tags|vars|inputs",
  );
  const snap = versionDefinition({ name: "n", enabled: "yes", trigger: null, nodes: [{ id: "m1" }], edges: [{ from: "a", to: "b" }], tags: "no-array", vars: "no-object", inputs: [{ key: "k" }] });
  assert.equal(snap.enabled, false, "enabled se normaliza a boolean");
  assert.deepEqual(snap.tags, [], "tags no-array → []");
  assert.deepEqual(snap.vars, {}, "vars no-object → {}");
  assert.deepEqual(snap.inputs, [{ key: "k" }]);
  assert.equal(LIMITS.versionRowsPerFlow, 20, "se conservan las últimas 20");
});

test("FLW1-MCP: cada save archiva UNA versión (create = v1, prune 20) y degrada sin v74; rollback revalida con HOY y archiva como NUEVA", () => {
  // flow_save: archivar tras el save + degrade con gracia
  const saveBody = mcpSource.slice(mcpSource.indexOf('case "flow_save":'), mcpSource.indexOf('case "flow_list":'));
  assert.match(saveBody, /store\.nextFlowVersion\(saved\.id\)[\s\S]*?store\.insertFlowVersion\(\{ flowId: saved\.id, workspaceId: wsId, version: next\.next, definition: versionDefinition\(saved\)/, "create = v1, update = N+1");
  assert.match(saveBody, /store\.pruneFlowVersions\(saved\.id, LIMITS\.versionRowsPerFlow\)/, "prune automático (nunca DELETE manual)");
  assert.match(saveBody, /_versionsMigrationPending: true/, "sin la tabla de v74 el save IGUAL funciona (aviso en la respuesta)");
  // flow_rollback: revalida HOY + guarda como versión nueva (historial intacto)
  const rollbackBody = mcpSource.slice(mcpSource.indexOf('case "flow_rollback":'), mcpSource.indexOf('case "flow_run_node":'));
  assert.match(rollbackBody, /getFlowVersion\(flow\.id, targetVersion\)/, "carga la versión elegida");
  assert.match(rollbackBody, /validateFlowDefinition\(\{ \.\.\.versionRow\.definition, enabled: restoreEnabled \}/, "REVALIDA con el validador de hoy (nunca guarda algo inválido)");
  assert.match(rollbackBody, /restoredFrom: targetVersion/, "la respuesta dice de dónde vino");
  assert.match(rollbackBody, /nextFlowVersion\(flow\.id\)[\s\S]*?insertFlowVersion/, "archiva como versión NUEVA — la historia jamás se reescribe");
  // flow_versions_list: lectura viewer + shape por versión
  const listBody = mcpSource.slice(mcpSource.indexOf('case "flow_versions_list":'), mcpSource.indexOf('case "flow_rollback":'));
  assert.match(listBody, /flowsAssertEnabled\(\)/, "respeta el kill switch");
  assert.match(listBody, /version: row\.version, createdBy: row\.created_by, createdAt: row\.created_at/, "metadatos de la versión");
  assert.match(listBody, /triggerType: row\.definition\?\.trigger\?\.type/, "resumen del trigger");
  assert.match(mcpSource, /const FLOW_READ_METHODS = new Set\(\[[^\]]*"flow_versions_list"/, "flow_versions_list es lectura (rol viewer)");
});

test("FLW1-DB: migración v74 — flow_versions (PK compuesta, FK cascade, RLS viewer/editor), flows.pins y CHECK trigger con 'error'", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS flow_versions \(/, "la tabla existe");
  assert.match(migration, /PRIMARY KEY \(flow_id, version\)/, "PK compuesta: version es 1..N POR flow");
  assert.match(migration, /flow_id TEXT NOT NULL REFERENCES flows\(id\) ON DELETE CASCADE/, "borrar el flow borra su historial");
  assert.match(migration, /workspace_id TEXT NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE/);
  assert.match(migration, /definition JSONB NOT NULL/, "snapshot del contrato");
  assert.match(migration, /created_by TEXT NOT NULL DEFAULT 'user'[\s\S]*?CHECK \(created_by = 'user' OR created_by LIKE 'ai:%'\)/, "misma atribución que flows");
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_flow_versions_flow\s+ON flow_versions \(flow_id, version DESC\)/, "historial más nuevo primero + lookup exacto");
  const policies = migration.split("CREATE POLICY").filter((chunk) => chunk.includes("ON flow_versions"));
  assert.ok(policies.length >= 2 && policies.some((chunk) => chunk.includes("has_workspace_role")), "RLS mismo patrón viewer/editor que flows (v61)");
  // FLW3: columna de pins
  assert.match(migration, /ALTER TABLE flows ADD COLUMN IF NOT EXISTS pins JSONB NOT NULL DEFAULT '\{\}'::jsonb/, "pins con default: los flows existentes no cambian de forma");
  // FLW8: fix relajante del CHECK de v61 (type:"error" era rechazado)
  assert.match(migration, /DROP CONSTRAINT IF EXISTS flows_trigger_type/, "idempotente");
  assert.match(migration, /trigger->>'type' IN \('manual', 'webhook', 'schedule', 'error'\)/, "SOLO relaja: agrega 'error' al CHECK");
});

// ── FLW4: run de UN nodo ────────────────────────────────────────────────────

test("FLW4-CORE: executeSingleNode — un nodo aislado con {{input.*}}, salida completa; desconocido/deshabilitado se rechaza", async () => {
  const flow = {
    id: "flow_v2node", name: "nodo suelto", trigger: { type: "manual" },
    nodes: [
      { id: "t1", type: "text", config: { template: "directo {{input.q}}" }, position: { x: 0, y: 0 } },
      { id: "t2", type: "text", enabled: false, config: { template: "x" }, position: { x: 10, y: 0 } },
    ],
    edges: [],
  };
  const out = await executeSingleNode(flow, "t1", { q: "si" }, {});
  assert.equal(out.ok, true);
  assert.equal(out.nodeId, "t1");
  assert.equal(typeof out.ms, "number");
  assert.ok(JSON.stringify(out.output).includes("directo si"), "upstream vacío: {{input.*}} sí, {{steps.*}} no existen");
  await assert.rejects(() => executeSingleNode(flow, "ghost", {}, {}), (e) => e.flowCode === "VALIDATION");
  await assert.rejects(() => executeSingleNode(flow, "t2", {}, {}), (e) => e.flowCode === "VALIDATION", "deshabilitado no es ejecutable");
});

test("FLW4-MCP: flow_run_node — salida completa SIN run row y sin consumir el cap; el debug jamás mueve el cursor", () => {
  const body = mcpSource.slice(mcpSource.indexOf('case "flow_run_node":'), mcpSource.indexOf('case "flow_unpin":'));
  assert.match(body, /executeSingleNode\(flow, nodeId, params\.input \?\? \{\}/, "despacha por el engine puro");
  assert.ok(!body.includes("insertRun"), "SIN fila de run (debug puro)");
  assert.match(body, /output: outcome\.output/, "salida COMPLETA sin truncar");
  assert.match(body, /error\.errorClass dice quién corrige/, "el fallo de un nodo suelto también clasifica");
  // El sondeo pasa staticWrites:{} — las escrituras de cursor se DESCARTAN.
  assert.ok(coreSource.includes("un debug jamás mueve el cursor"), "FLW6: flow_run_node no avanza el cursor");
  assert.match(coreSource, /async function executeSingleNode[\s\S]*?staticWrites: \{\}/, "executeSingleNode aísla las escrituras");
});

// ── FLW6: staticData persistente + cursor incremental de source_http ────────

test("FLW6-CORE: validateStaticDataPatch — objeto ≤8KB, null = no tocar", () => {
  assert.equal(validateStaticDataPatch(null), null);
  assert.equal(validateStaticDataPatch(""), null);
  assert.deepEqual(validateStaticDataPatch({ cursor: 3 }), { cursor: 3 });
  assert.throws(() => validateStaticDataPatch("no"), (e) => e.flowCode === "VALIDATION");
  assert.throws(() => validateStaticDataPatch({ big: "x".repeat(LIMITS.staticDataMaxChars) }), (e) => e.flowCode === "VALIDATION" && /supera/.test(e.message), "estado chico, no datasets");
  assert.equal(LIMITS.staticDataMaxChars, 8_192);
});

test("FLW6-CURSOR: source_http incremental filtra repeats (>) y guarda el MÁXIMO; el runtime persiste end-of-run y pre-pausa", () => {
  // El nodo: cursor en static_data["cursor:<nodeId>"], filtro estricto >,
  // nuevo cursor = máximo de TODO lo traído (aunque se haya limitado).
  assert.match(coreSource, /cursor:\$\{nodeId\}/, "el cursor vive visible en static_data (editable con flow_static_data_get/set)");
  assert.match(coreSource, /isNum\(previous\) \? isNum\(value\) && value > previous : value > previous/, "filtro estricto: numérico o string (fechas ISO)");
  assert.match(coreSource, /staticWrites\[cursorKey\] = max/, "el nodo ESCRIBE el cursor en staticWrites, nunca en DB");
  assert.ok(coreSource.includes("aunque hoy se haya limitado"), "el máximo se calcula sobre TODO lo traído");
  assert.match(coreSource, /incremental: incrementalInfo/, "la salida reporta {cursorPath, previous, fetched, kept}");
  // El runtime persiste al cerrar el run: éxito terminal Y antes de pausar.
  const merges = runtimeSource.match(/store\.mergeStaticData\(flow\.id, result\.staticData\)/g) ?? [];
  assert.ok(merges.length >= 4, "runFlow + resume: éxito y pre-pausa (4 rutas de cierre)");
  assert.match(runtimeSource, /status === "success" && result\.staticData/, "solo el run EXITOSO persiste al cierre");
  assert.match(runtimeSource, /static-writes previos a la pausa/, "un run waiting no pierde la primera mitad");
  // flow_save puede sembrarlo (merge superficial, solo cuando el parámetro viene).
  const saveBody = mcpSource.slice(mcpSource.indexOf('case "flow_save":'), mcpSource.indexOf('case "flow_list":'));
  assert.match(saveBody, /validateStaticDataPatch\(params\.staticData\)[\s\S]*?mergeStaticData\(saved\.id, wsId, patch\)/, "siembra {{static.k}} desde el save");
});

// ── FLW8: webhook estable ───────────────────────────────────────────────────

test("FLW8-CORE: validateTrigger acepta mode single|stable + hmac y rechaza basura", () => {
  assert.deepEqual(validateTrigger({ type: "webhook", mode: "stable" }, { enabled: true }), { type: "webhook", mode: "stable" });
  assert.deepEqual(validateTrigger({ type: "webhook", mode: "stable", hmac: false }, { enabled: true }), { type: "webhook", mode: "stable", hmac: false }, "unsigned explícito");
  assert.deepEqual(validateTrigger({ type: "webhook" }, { enabled: true }), { type: "webhook" }, "default = single de siempre (compatibilidad)");
  assert.throws(() => validateTrigger({ type: "webhook", mode: "fixed" }, { enabled: true }), (e) => e.flowCode === "VALIDATION");
});

test("FLW8-RUNTIME: URL fija sin secreto, HMAC llave sha256(secreto), legacy rechazado y verificación timing-safe", () => {
  assert.match(runtimeSource, /export function flowStableWebhookUrl[\s\S]*?\/api\/flows\/webhook\/\$\{flow\.id\}/, "URL estable SIN secreto en la ruta");
  assert.match(runtimeSource, /createHmac\("sha256", String\(flow\?\.trigger\?\.secretHash \?\? ""\)\)/, "llave del HMAC = sha256(secreto) = lo que ya vive en DB (mismo modelo at rest)");
  assert.match(runtimeSource, /flow\.trigger\.mode !== "stable"[\s\S]*?FLOW_NOT_STABLE/, "un flow legacy NO se dispara por la URL estable (su puerta sigue siendo la ruta con secreto)");
  assert.match(runtimeSource, /flow\.trigger\.hmac !== false[\s\S]*?BAD_WEBHOOK_SIGNATURE/, "hmac default true; hmac:false = unsigned explícito");
  assert.match(runtimeSource, /timingSafeHexEqual\(stableWebhookSignature\(flow, rawBody\), provided\)/, "comparación timing-safe (paridad del webhook legacy)");
  assert.match(runtimeSource, /replace\(\/\^sha256\\s\+\/i/, "acepta el prefijo estándar 'sha256 ' del header");
});

test("FLW8-API: ruta estable con rawBody + stableWebhookMatches; la legacy con secreto sigue intacta", () => {
  assert.match(apiSource, /app\.post\("\/api\/flows\/webhook\/:flowId", async \(req, res\)/, "ruta ESTABLE (sin :secret)");
  assert.match(apiSource, /stableWebhookMatches\(flow, String\(\(req as any\)\.rawBody \?\? ""\)/, "firma sobre el body EXACTO del emisor");
  assert.match(apiSource, /x-musa-signature/, "header X-Musa-Signature");
  assert.match(apiSource, /originalUrl\?\.startsWith\("\/api\/flows\/webhook\/"\)[\s\S]*?rawBody = Buffer\.from\(buffer\)/, "el middleware captura rawBody para ambas rutas de flows");
  assert.match(apiSource, /app\.post\("\/api\/flows\/webhook\/:flowId\/:secret"/, "la ruta LEGACY no se toca");
  assert.match(apiSource, /stableWebhookMatches, oauth2StateDecode/, "import del match estable en el server");
});

// ── Catálogo MCP (410 tools) ────────────────────────────────────────────────

test("FLW-CATALOG: las 4 tools v2 están registradas con inputSchema, case de despacho y catálogo sincronizado (406 → 410)", () => {
  for (const name of V2_TOOLS) {
    assert.ok(mcpSource.includes(`name: "${name}"`), `${name} registrado en MCP_TOOLS`);
    assert.ok(mcpSource.includes(`case "${name}":`), `case de despacho para ${name}`);
    const entry = catalog.find((t) => t.name === name);
    assert.ok(entry, `${name} en tools_catalog.json`);
    assert.ok(entry.inputSchema && entry.description, `${name} con schema + description (sync:skill al día)`);
    assert.match(mcpSource, new RegExp(`const FLOW_TENANT_METHODS = new Set\\(\\[[^\\]]*"${name}"`), `${name} resuelve tenant en DB`);
  }
  const flowEntries = catalog.filter((t) => String(t.name || "").startsWith("flow_"));
  assert.ok(flowEntries.length >= 24 + V2_TOOLS.length, `las flow_* del catálogo (${flowEntries.length}) incluyen las 4 nuevas`);
  assert.match(mcpSource, /CADA save exitoso archiva UNA versión[\s\S]*?flow_versions_list \/ flow_rollback/, "flow_save documenta el archivo de versiones en su descripción");
});

// ── FLW7: canvas @xyflow/react ──────────────────────────────────────────────

test("FLW7-CANVAS: FlowCanvas sobre @xyflow/react — el editor conserva Delete/undo/guardar y el canvas aporta pan/zoom/fit/box-select", () => {
  // El editor importa el canvas y los componentes compartidos (sin dependencias circulares).
  assert.match(editorSource, /import \{ FlowCanvas, FramePreview, Switch, TRIGGER_ICONS, TRIGGER_META \} from "\.\/FlowCanvas";/);
  // Paridad de interacciones: Delete/Backspace los sigue gestionando deleteSelection
  // (con undo) — xyflow NUNCA borra por su cuenta.
  assert.match(canvasSource, /deleteKeyCode=\{null\}/);
  assert.match(editorSource, /e\.key !== "Delete" && e\.key !== "Backspace"[^\n]*\n\s*e\.preventDefault\(\);\s*\n\s*deleteSelection\(\);/, "el teclado del builder sigue en FlowEditor");
  // Paleta: arrastrar al lienzo crea el nodo en el punto soltado (n8n-style).
  assert.match(editorSource, /application\/musa-flow-node/, "la paleta publica el tipo de nodo en dataTransfer");
  assert.match(canvasSource, /application\/musa-flow-node/, "el canvas lo consume con screenToFlowPosition");
  // Encuadre al cargar con paridad v60.2 (margen 20%, zoom clamp 0.4–1).
  assert.match(canvasSource, /fitViewOptions=\{\{ padding: 0\.2, minZoom: 0\.4, maxZoom: 1 \}\}/);
  assert.match(canvasSource, /<MiniMap[\s\S]*?pannable[\s\S]*?zoomable/, "mini-mapa DENTRO del canvas");
  assert.match(canvasSource, /<Controls showInteractive=\{false\}/, "controles de zoom DENTRO del canvas");
});

test("FLW2-UI + FLW7: la versión del nodo viaja al server y se ve en la UI (badge inspector + chip de tarjeta)", () => {
  assert.match(flowTypesSource, /version\?: number;/, "FlowNode.version opcional (FLW2)");
  assert.match(editorSource, /version: n\.version \|\| undefined/, "flow_save recibe la versión declarada de cada nodo");
  assert.match(editorSource, /v\{selectedNode\.version \?\? 1\}/, "badge v{n} en el inspector");
  assert.match(canvasSource, /Number\(node\.version\) > 1 &&[\s\S]*?v\{node\.version\}/, "chip en la tarjeta solo cuando la versión supera v1");
});
