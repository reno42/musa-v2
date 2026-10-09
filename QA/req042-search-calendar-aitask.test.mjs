// REQ-042 — A: webSearch nativo en los 8 proveedores (cada uno con SU clave y
// SU cuota). B: nodo ai_task (despierta la IA cliente conectada del usuario) +
// flow_ai_tasks/flow_ai_complete. C: tools de calendario en la paleta de flows
// + preset copys_lote. Sin migraciones (v64 ya persiste las pausas).
// Post-B (ronda picky): requiredKeys en ai_task, steps incrementales por nodo
// (feedback en vivo del canvas: verde/✓/✗) y la pausa visible en la UI.
//
// Estilo req040/req041: unit de engine + asserts de fuente para lo que no
// importa directo desde node:test (mcp.mjs, flowLibrary.ts, helpers privados).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { NODE_SCHEMA_DOC, validateFlowDefinition, executeFlow, resumeFlow } from "../netlify/functions/flows-core.mjs";
import { AI_PROVIDERS } from "../netlify/functions/flows-sources.mjs";
import { FLOW_TOOLS, FLOW_TOOL_TIERS, FLOW_TOOL_WRITE } from "../src/data/flowToolCatalog.ts";
import { FLOW_LIBRARY, findFlowPreset } from "../src/data/flowLibrary.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sources = readFileSync(join(root, "netlify", "functions", "flows-sources.mjs"), "utf8");
const core = readFileSync(join(root, "netlify", "functions", "flows-core.mjs"), "utf8");
const mcp = readFileSync(join(root, "netlify", "functions", "mcp.mjs"), "utf8");
const runtimeSource = readFileSync(join(root, "netlify", "functions", "flows-runtime.mjs"), "utf8");
const flowsTabSource = readFileSync(join(root, "src", "components", "FlowsTab.tsx"), "utf8");
const flowEditorSource = readFileSync(join(root, "src", "components", "flows", "FlowEditor.tsx"), "utf8");

// ── A: webSearch nativo en los 8 proveedores ────────────────────────────────

test("P042-1 openai/deepseek + webSearch van por Responses API con tool web_search", () => {
  assert.ok(sources.includes('(provider === "openai" || provider === "deepseek") && webSearch'), "branch compartido openai+deepseek");
  assert.ok(sources.includes("`${AI_BASES[provider]}/responses`"), "endpoint /responses");
  assert.ok(sources.includes("tools: [{ type: \"web_search\" }]"), "tool web_search server-side");
  assert.ok(sources.includes("input: prompt,"), "prompt viaja como input");
  assert.ok(sources.includes("...(systemPrompt ? { instructions: systemPrompt } : {})"), "system viaja como instructions");
  assert.ok(sources.includes("max_output_tokens: maxOutputTokens"), "cap de tokens Responses");
});

test("P042-2 Responses: extraccion de texto message→content + fallback output_text + usage input/output_tokens", () => {
  assert.ok(sources.includes("? responsesOutputText(data)"), "extraccion por shape output[]");
  assert.ok(sources.includes('if (item?.type !== "message") continue;'), "solo items message");
  assert.ok(sources.includes('typeof data?.output_text === "string" ? data.output_text : ""'), "fallback agregado");
  assert.ok(sources.includes("{ inputTokens: data.usage?.input_tokens ?? null, outputTokens: data.usage?.output_tokens ?? null }"), "usage Responses");
});

test("P042-3 glm: tool web_search nativa server-side en 1 request", () => {
  assert.ok(sources.includes('body.tools = [{ type: "web_search", web_search: { enable: true } }];'));
});

test("P042-4 qwen: enable_search + forced_search en compatible-mode", () => {
  assert.ok(sources.includes("body.enable_search = true;"));
  assert.ok(sources.includes("body.search_options = { forced_search: true };"));
});

test("P042-5 kimi: search-then-generate con /tools/search_pro ($web_search se retira 2026-10-20)", () => {
  assert.ok(sources.includes("`${AI_BASES.kimi}/tools/search_pro`"), "API REST standalone");
  assert.ok(sources.includes("text_query: prompt.slice(0, 400), limit: 5, timeout_seconds: 20"), "params del search");
  assert.ok(sources.includes("kimiSearchDigest(search)"), "digest inyectado al prompt");
  assert.ok(sources.includes('cita las fuentes [n]'), "pide citar fuentes");
  assert.ok(sources.includes('if (!results.length) return "(sin resultados de búsqueda)";'), "sin resultados degrada con gracia");
  assert.ok(!sources.includes('"$web_search"'), "el builtin deprecado NO se usa");
});

test("P042-6 el rechazo AI_CONFIG para los 5 directos DESAPARECIO (los 8 cubiertos)", () => {
  assert.ok(!sources.includes("webSearch no está disponible directo"), "el throw viejo se fue");
  assert.equal(AI_PROVIDERS.length, 8);
  assert.ok(NODE_SCHEMA_DOC.includes("los 8 cubiertos"), "NODE_SCHEMA_DOC documenta la cobertura");
  assert.ok(NODE_SCHEMA_DOC.includes("openai y deepseek vía Responses API"));
  assert.ok(NODE_SCHEMA_DOC.includes("kimi inyecta /tools/search_pro"));
});

// ── C: calendario en la paleta + perItem + preset copys_lote ────────────────

test("P042-7 las tools de calendario YA viven en la paleta con tier y flags correctos", () => {
  assert.equal(FLOW_TOOL_TIERS.list_calendar_entries, 0);
  assert.equal(FLOW_TOOL_TIERS.add_content_idea, 0);
  assert.equal(FLOW_TOOL_TIERS.publish_content, 0);
  assert.equal(FLOW_TOOL_TIERS.update_content, 1);
  assert.equal(FLOW_TOOL_TIERS.list_copy_recipes, 1);
  assert.ok(FLOW_TOOL_WRITE.has("add_content_idea"), "agregar idea ESCRIBE (dedupe aplica)");
  assert.ok(FLOW_TOOL_WRITE.has("update_content"));
  assert.ok(FLOW_TOOL_WRITE.has("publish_content"));
  assert.ok(!FLOW_TOOL_WRITE.has("list_calendar_entries"), "leer calendario no es escritura");
  // Curación corregida (REQ-042 C): el default args usaba un campo `text` que
  // NO existe en el schema real (scheduledDate+topic requeridos, copy opcional).
  const entry = FLOW_TOOLS.find((tool) => tool.tool === "add_content_idea");
  assert.deepEqual(entry.args, { scheduledDate: "{{item.fecha}}", topic: "{{item.gancho}}", copy: "{{item.cuerpo}}" });
});

test("P042-8 validación: tool perItem persiste y map acepta array/placeholder (split out)", () => {
  assert.ok(NODE_SCHEMA_DOC.includes("perItem?:bool"), "NODE_SCHEMA_DOC documenta perItem");
  assert.ok(NODE_SCHEMA_DOC.includes("split out"), "NODE_SCHEMA_DOC documenta el split out de map");
  const toolDef = validateFlowDefinition(
    { name: "t", trigger: { type: "manual" }, nodes: [{ id: "cal1", type: "tool", config: { tool: "add_content_idea", perItem: true, args: { topic: "{{item.gancho}}" } }, position: { x: 0, y: 0 } }], edges: [] },
    { enabled: false },
  );
  assert.equal(toolDef.nodes[0].config.perItem, true, "perItem sobrevive al save");
  const mapDef = validateFlowDefinition(
    { name: "t", trigger: { type: "manual" }, nodes: [
      { id: "m2", type: "map", config: { value: "{{steps.ai1.json}}" }, position: { x: 0, y: 0 } },
      { id: "m3", type: "map", config: { value: [{ a: 1 }] }, position: { x: 1, y: 0 } },
      { id: "m1", type: "map", config: { value: { x: "{{input.y}}" } }, position: { x: 2, y: 0 } },
    ], edges: [] },
    { enabled: false },
  );
  assert.equal(mapDef.nodes[0].config.value, "{{steps.ai1.json}}", "placeholder del split out se conserva");
  assert.deepEqual(mapDef.nodes[1].config.value, [{ a: 1 }], "array literal se conserva");
  assert.throws(
    () => validateFlowDefinition(
      { name: "t", trigger: { type: "manual" }, nodes: [{ id: "mX", type: "map", config: { value: "hola" }, position: { x: 0, y: 0 } }], edges: [] },
      { enabled: false },
    ),
    /config\.value/,
    "un escalar en value sigue rechazado",
  );
});

test("P042-9 runtime perItem: N items → N llamadas resueltas por item con workspaceId forzado", async () => {
  const calls = [];
  const run = await executeFlow(
    {
      id: "flow_test", name: "copys", trigger: { type: "manual" },
      nodes: [
        { id: "m1", type: "map", config: { value: [{ gancho: "A" }, { gancho: "B" }] }, position: { x: 0, y: 0 } },
        { id: "cal1", type: "tool", config: { tool: "add_content_idea", perItem: true, args: { scheduledDate: "{{item.fecha}}", topic: "{{item.gancho}}" } }, position: { x: 1, y: 0 } },
      ],
      edges: [{ from: "m1", to: "cal1" }],
    },
    {},
    { workspaceId: "ws1", callTool: async (name, args) => { calls.push({ name, args }); return { id: `cc_${calls.length}` }; } },
  );
  assert.equal(run.status, "success");
  assert.equal(calls.length, 2, "una llamada por item");
  assert.equal(calls[0].name, "add_content_idea");
  assert.equal(calls[0].args.topic, "A");
  assert.equal(calls[1].args.topic, "B");
  assert.equal(calls[0].args.workspaceId, "ws1", "el tenant SIEMPRE es el workspace del run");
  const out = run.outputs.cal1;
  assert.equal(out.count, 2);
  assert.deepEqual(out.items, [{ id: "cc_1" }, { id: "cc_2" }]);
});

test("P042-10 runtime perItem: cap de 5, sin items 0 llamadas y args duplicados deduplican", async () => {
  const calls = [];
  const deps = { workspaceId: "ws1", callTool: async (name, args) => { calls.push({ name, args }); return { id: `cc_${calls.length}` }; } };
  const seven = await executeFlow(
    {
      id: "flow_test", name: "cap", trigger: { type: "manual" },
      nodes: [
        { id: "m1", type: "map", config: { value: Array.from({ length: 7 }, (_, i) => ({ gancho: `g${i}` })) }, position: { x: 0, y: 0 } },
        { id: "cal1", type: "tool", config: { tool: "add_content_idea", perItem: true, args: { topic: "{{item.gancho}}" } }, position: { x: 1, y: 0 } },
      ],
      edges: [{ from: "m1", to: "cal1" }],
    },
    {}, deps,
  );
  assert.equal(seven.status, "success");
  assert.equal(calls.length, 5, "maxItemsPerTemplateNode acota el lote");
  const empty = await executeFlow(
    {
      id: "flow_test", name: "vacio", trigger: { type: "manual" },
      nodes: [{ id: "cal1", type: "tool", config: { tool: "add_content_idea", perItem: true, args: { topic: "{{item.gancho}}" } }, position: { x: 0, y: 0 } }],
      edges: [],
    },
    {}, deps,
  );
  assert.equal(empty.status, "success");
  assert.equal(calls.length, 5, "sin items NO llama (0 llamadas)");
  assert.deepEqual(empty.outputs.cal1, { items: [], count: 0 });
  const dup = await executeFlow(
    {
      id: "flow_test", name: "dup", trigger: { type: "manual" },
      nodes: [
        { id: "m1", type: "map", config: { value: [{ gancho: "igual" }, { gancho: "igual" }] }, position: { x: 0, y: 0 } },
        { id: "cal1", type: "tool", config: { tool: "add_content_idea", perItem: true, args: { topic: "{{item.gancho}}" } }, position: { x: 1, y: 0 } },
      ],
      edges: [{ from: "m1", to: "cal1" }],
    },
    {}, deps,
  );
  assert.equal(dup.status, "failed", "dos items con args idénticos = doble publicación → dedupe frena");
  assert.match(dup.error, /MUSA_TOOL_RATE/);
  assert.match(dup.error, /dedupe/);
  const writes = calls.filter((call) => call.name === "add_content_idea");
  assert.equal(writes.length, 6, "solo la 1ª de las idénticas llegó a la tool (el flow_list del error-workflow va aparte)");
});

test("P042-11 preset copys_lote: brief → IA json → split out → calendario por item + card por copy", () => {
  const preset = findFlowPreset("preset_copys_lote");
  assert.ok(preset, "preset presente en la biblioteca");
  assert.equal(preset.trigger.type, "manual");
  const keys = preset.inputs.map((field) => field.key);
  assert.deepEqual(keys, ["tema", "cantidad", "fechaInicio", "tono"]);
  assert.ok(preset.inputs.find((field) => field.key === "tema").required);
  assert.ok(preset.inputs.find((field) => field.key === "fechaInicio").required);
  const ai1 = preset.nodes.find((node) => node.id === "ai1");
  assert.equal(ai1.config.responseFormat, "json", "la IA responde JSON");
  assert.equal(ai1.config.schema.type, "array", "schema de array (cada item un copy)");
  assert.deepEqual(ai1.config.schema.items.required, ["fecha", "gancho", "cuerpo", "cta", "hashtags"]);
  const map2 = preset.nodes.find((node) => node.id === "map2");
  assert.equal(map2.config.value, "{{steps.ai1.json}}", "split out del array de copys");
  const cal1 = preset.nodes.find((node) => node.id === "cal1");
  assert.equal(cal1.config.tool, "add_content_idea");
  assert.equal(cal1.config.perItem, true, "UNA idea de calendario POR copy");
  assert.equal(cal1.config.args.scheduledDate, "{{item.fecha}}");
  assert.equal(cal1.config.args.topic, "{{item.gancho}}");
  const tpl1 = preset.nodes.find((node) => node.id === "tpl1");
  assert.equal(tpl1.config.maxItems, 5);
  for (const token of ["{{gancho}}", "{{cuerpo}}", "{{cta}}", "{{hashtags}}", "{{fecha}}"]) {
    assert.ok(tpl1.config.recipe.html.includes(token), `la receta viste ${token}`);
  }
  // El preset completo valida como borrador y la normalización PRESERVA perItem
  // + el placeholder del split out.
  const def = validateFlowDefinition(
    { name: preset.name, trigger: preset.trigger, nodes: preset.nodes, edges: preset.edges, inputs: preset.inputs },
    { enabled: false },
  );
  assert.equal(def.nodes.find((node) => node.id === "cal1").config.perItem, true);
  assert.equal(def.nodes.find((node) => node.id === "map2").config.value, "{{steps.ai1.json}}");
  assert.equal(def.inputs.length, 4, "inputs declarados viajan en el save");
});

test("P042-12 fix per-item del nodo ai: {{item.x}} ya no colapsa antes del run (bug REQ-027)", async () => {
  const prompts = [];
  const run = await executeFlow(
    {
      id: "flow_test", name: "peritem", trigger: { type: "manual" },
      nodes: [
        { id: "m1", type: "map", config: { value: [{ title: "A" }, { title: "B" }] }, position: { x: 0, y: 0 } },
        { id: "ai1", type: "ai", config: { provider: "openrouter", model: "m", credentialId: "cred_1", prompt: "Resumen: {{item.title}}", maxOutputTokens: 100 }, position: { x: 1, y: 0 } },
      ],
      edges: [{ from: "m1", to: "ai1" }],
    },
    {},
    {
      workspaceId: "ws1",
      getCredential: async () => ({ type: "ai_provider", provider: "openrouter", secret: "sk-qa" }),
      runAiText: async (cfg) => { prompts.push(cfg.prompt); return { text: `eco(${cfg.prompt})`, model: "m", provider: "openrouter", usage: { inputTokens: 1, outputTokens: 1 } }; },
    },
  );
  assert.equal(run.status, "success");
  assert.deepEqual(prompts, ["Resumen: A", "Resumen: B"], "UNA llamada POR item con el item resuelto (antes: 1 sola llamada con prompt truncado)");
  assert.deepEqual(run.outputs.ai1.items, [
    { title: "A", ai: "eco(Resumen: A)" },
    { title: "B", ai: "eco(Resumen: B)" },
  ]);
});

// ── B: ai_task — la pausa que despierta a la IA CLIENTE del usuario ─────────

test("P042-13 validación ai_task: prompt requerido, timeoutMinutes 1-1440 (default 240), title acotado", () => {
  // Un flow ACTIVO exige que todo nodo reciba datos (igual que ai): el ai_task
  // de los casos duros va alimentado por un map; el borrador puede ir suelto.
  const def = validateFlowDefinition(
    { name: "t", trigger: { type: "manual" }, nodes: [
      { id: "map1", type: "map", config: { value: { tema: "x" } }, position: { x: 0, y: 0 } },
      { id: "ai1", type: "ai_task", config: { prompt: "Brief {{input.tema}}", title: "Título", timeoutMinutes: 9999 }, position: { x: 1, y: 0 } },
    ], edges: [{ from: "map1", to: "ai1" }] },
    { enabled: true },
  );
  assert.equal(def.nodes[1].config.timeoutMinutes, 1440, "timeout clampeado al máximo de 1 día");
  assert.equal(def.nodes[1].config.title, "Título");
  const soft = validateFlowDefinition(
    { name: "t", trigger: { type: "manual" }, nodes: [{ id: "ai2", type: "ai_task", config: {}, position: { x: 0, y: 0 } }], edges: [] },
    { enabled: false },
  );
  assert.equal(soft.nodes[0].config.timeoutMinutes, 240, "borrador sin prompt pasa y el default es 240 (campo ausente)");
  assert.throws(
    () => validateFlowDefinition(
      { name: "t", trigger: { type: "manual" }, nodes: [
        { id: "map1", type: "map", config: { value: { tema: "x" } }, position: { x: 0, y: 0 } },
        { id: "aiX", type: "ai_task", config: {}, position: { x: 1, y: 0 } },
      ], edges: [{ from: "map1", to: "aiX" }] },
      { enabled: true },
    ),
    /config\.prompt/,
    "activo sin briefing → rechazo",
  );
  assert.ok(NODE_SCHEMA_DOC.includes("ai_task{prompt"), "NODE_SCHEMA_DOC documenta el nodo");
  assert.ok(NODE_SCHEMA_DOC.includes("flow_ai_complete"), "y el ciclo flow_ai_tasks/flow_ai_complete");
});

test("P042-14 runtime: ai_task pausa con kind:'ai', briefing RESUELTO en message/title y estado enriquecido", async () => {
  const run = await executeFlow(
    {
      id: "flow_ia", name: "Copys con IA cliente", trigger: { type: "manual" },
      nodes: [
        { id: "map1", type: "map", config: { value: { tema: "cafetería" } }, position: { x: 0, y: 0 } },
        { id: "aitask1", type: "ai_task", label: "Encargo", config: { title: "Redacta copys", prompt: "Redacta copys de {{steps.map1.tema}}" }, position: { x: 1, y: 0 } },
        { id: "rep1", type: "report", config: { title: "fin" }, position: { x: 2, y: 0 } },
      ],
      edges: [{ from: "map1", to: "aitask1" }, { from: "aitask1", to: "rep1" }],
    },
    {},
    { workspaceId: "ws1" },
  );
  assert.equal(run.status, "waiting");
  assert.equal(run.wait.kind, "ai");
  assert.equal(run.wait.nodeId, "aitask1");
  assert.equal(run.wait.title, "Redacta copys");
  assert.equal(run.wait.message, "Redacta copys de cafetería", "el briefing viaja RESUELTO (no la plantilla cruda)");
  assert.match(run.wait.resumeToken, /^rw_[A-Za-z0-9]{12}$/);
  assert.ok(run.wait.state.queue.includes("rep1"), "los sucesores quedan congelados en la cola");
  assert.equal(run.wait.state.nodeLabel, "Encargo");
  assert.equal(run.wait.state.flowName, "Copys con IA cliente");
  assert.ok(new Date(run.wait.expiresAt).getTime() - Date.now() > 200 * 60_000, "ventana default 240 min (freemium: una fila waiting no cuesta cómputo)");
});

test("P042-15 resume: la IA entrega payload:{copys:[...]} y el flow sigue solo (split out → calendario por item)", async () => {
  const flowDef = {
    id: "flow_ia", name: "Copys IA", trigger: { type: "manual" },
    nodes: [
      { id: "aitask1", type: "ai_task", config: { prompt: "Redacta 2 copys" }, position: { x: 0, y: 0 } },
      { id: "map2", type: "map", config: { value: "{{steps.aitask1.copys}}" }, position: { x: 1, y: 0 } },
      { id: "cal1", type: "tool", config: { tool: "add_content_idea", perItem: true, args: { scheduledDate: "{{item.fecha}}", topic: "{{item.gancho}}" } }, position: { x: 2, y: 0 } },
    ],
    edges: [{ from: "aitask1", to: "map2" }, { from: "map2", to: "cal1" }],
  };
  const callTool = (calls) => async (name, args) => { calls.push({ name, args }); return { id: `cc_${calls.length}` }; };
  const calls = [];
  const first = await executeFlow(flowDef, {}, { workspaceId: "ws1", callTool: callTool(calls) });
  assert.equal(first.status, "waiting");
  const copys = [
    { fecha: "2026-10-10", gancho: "G1" },
    { fecha: "2026-10-11", gancho: "G2" },
  ];
  const second = await resumeFlow(flowDef, { state: first.wait.state, payload: { copys }, expiresAt: first.wait.expiresAt }, { workspaceId: "ws1", callTool: callTool(calls) });
  assert.equal(second.status, "success");
  assert.deepEqual(second.outputs.aitask1, { copys }, "payload ES la salida del nodo ai_task");
  const ideas = calls.filter((call) => call.name === "add_content_idea");
  assert.equal(ideas.length, 2, "UNA idea por copy entregado");
  assert.equal(ideas[0].args.topic, "G1");
  assert.equal(ideas[1].args.topic, "G2");
});

test("P042-16 preset copys_lote_ia: encargo a la IA CLIENTE (sin key) y downstream idéntico al preset con key", () => {
  const preset = findFlowPreset("preset_copys_lote_ia");
  assert.ok(preset, "preset presente en la biblioteca");
  assert.equal(FLOW_LIBRARY.length, 30);
  const aitask1 = preset.nodes.find((node) => node.id === "aitask1");
  assert.equal(aitask1.type, "ai_task");
  assert.ok(aitask1.config.prompt.includes("flow_ai_complete"), "el briefing enseña CÓMO entregar");
  assert.ok(aitask1.config.prompt.includes("payload:{copys:"), "y la forma EXACTA del payload (objeto con el array anidado)");
  assert.ok(!JSON.stringify(preset.nodes).includes("credentialId"), "SIN key de IA: ese es el punto del preset");
  assert.equal(preset.nodes.find((node) => node.id === "map2").config.value, "{{steps.aitask1.copys}}");
  const cal1 = preset.nodes.find((node) => node.id === "cal1");
  assert.equal(cal1.config.tool, "add_content_idea");
  assert.equal(cal1.config.perItem, true);
  const def = validateFlowDefinition(
    { name: preset.name, trigger: preset.trigger, nodes: preset.nodes, edges: preset.edges, inputs: preset.inputs },
    { enabled: false },
  );
  assert.equal(def.nodes.find((node) => node.id === "aitask1").config.timeoutMinutes, 240);
  assert.equal(def.nodes.find((node) => node.id === "map2").config.value, "{{steps.aitask1.copys}}", "el placeholder del split out sobrevive al save");
  assert.equal(def.inputs.length, 4);
});

// ── Post-B: requiredKeys + feedback en vivo + pausa visible ─────────────────

test("P042-17 validación requiredKeys: array acotado (≤12, sin vacíos) y rechazo de no-array", () => {
  assert.ok(NODE_SCHEMA_DOC.includes("requiredKeys?:[..≤12]"), "NODE_SCHEMA_DOC documenta requiredKeys");
  assert.ok(NODE_SCHEMA_DOC.includes("el run SIGUE esperando con el MISMO token"), "y el contrato de reintento");
  const def = validateFlowDefinition(
    { name: "t", trigger: { type: "manual" }, nodes: [
      { id: "map1", type: "map", config: { value: { tema: "x" } }, position: { x: 0, y: 0 } },
      { id: "ai1", type: "ai_task", config: { prompt: "B", requiredKeys: ["copys", "", "   ", "fecha"] }, position: { x: 1, y: 0 } },
    ], edges: [{ from: "map1", to: "ai1" }] },
    { enabled: true },
  );
  assert.deepEqual(def.nodes[1].config.requiredKeys, ["copys", "fecha"], "vacíos filtrados");
  assert.throws(
    () => validateFlowDefinition(
      { name: "t", trigger: { type: "manual" }, nodes: [
        { id: "map1", type: "map", config: { value: { tema: "x" } }, position: { x: 0, y: 0 } },
        { id: "aiX", type: "ai_task", config: { prompt: "B", requiredKeys: "copys" }, position: { x: 1, y: 0 } },
      ], edges: [{ from: "map1", to: "aiX" }] },
      { enabled: true },
    ),
    /requiredKeys debe ser un array/,
    "un string NO es un array de claves",
  );
});

test("P042-18 requiredKeys en el runtime: rechazo ANTES de consumir la espera (misma fila, mismo token) y mcp lo enseña", () => {
  // El gate vive en resumeFlowRun ANTES del updateRun a "running": al rechazar
  // la fila NO se toca (cero escrituras, freemium) y el token NO cambia.
  const gateAt = runtimeSource.indexOf("payloadRejected: true");
  const runningAt = runtimeSource.lastIndexOf('status: "running"');
  assert.ok(gateAt > -1, "el gate de requiredKeys existe en resumeFlowRun");
  assert.ok(runningAt > gateAt, "el rechazo ocurre ANTES de marcar el run como running");
  assert.ok(runtimeSource.includes("missingKeys: missing"), "lista de claves que faltan");
  assert.ok(runtimeSource.includes("resumeToken: token, expiresAt: state.expiresAt ?? null"), "el MISMO token vuelve al agente");
  assert.ok(runtimeSource.includes("pendingNode?.config?.requiredKeys"), "las claves se leen del nodo EN ESPERA");
  // mcp: flow_ai_complete Y flow_resume exponen el rechazo con nota accionable.
  assert.equal((mcp.match(/result\.payloadRejected \? \{ payloadRejected: true, missingKeys: result\.missingKeys \}/g) || []).length, 2, "ambas tools de resume exponen payloadRejected/missingKeys");
  assert.ok(mcp.includes("Payload RECHAZADO: faltan claves requeridas por el nodo ai_task"), "nota con las claves exactas");
  assert.ok(mcp.includes("payloadRejected+missingKeys y el MISMO resumeToken"), "la descripción enseña el reintento");
});

test("P042-19 onStep (contrato del engine): un callback por nodo, en orden, con el paso de pausa incluido", async () => {
  const seen = [];
  const run = await executeFlow(
    {
      id: "flow_os", name: "onStep", trigger: { type: "manual" },
      nodes: [
        { id: "map1", type: "map", label: "Fuente", config: { value: { tema: "x" } }, position: { x: 0, y: 0 } },
        { id: "ai1", type: "ai_task", label: "Encargo", config: { prompt: "B" }, position: { x: 1, y: 0 } },
      ],
      edges: [{ from: "map1", to: "ai1" }],
    },
    {},
    { workspaceId: "ws1", onStep: (step) => { seen.push(step); } },
  );
  assert.equal(run.status, "waiting");
  assert.deepEqual(seen.map((s) => s.nodeId), ["map1", "ai1"], "un step por nodo en orden de ejecución");
  assert.ok(seen.every((s) => typeof s.ok === "boolean" && typeof s.ms === "number" && s.label && s.type), "shape stepSummary completo");
  assert.equal(seen[1].output.waiting, true);
  assert.equal(seen[1].output.kind, "ai", "la pausa también notifica (el canvas la pinta como paso actual)");
  // El runtime cablea onStep para PERSISTIR steps por nodo (flow_history los
  // expone al vuelo; no se importa flows-runtime.mjs aquí — cadena con esbuild).
  assert.equal((runtimeSource.match(/const onStep = \(step\)/g) || []).length, 2, "runFlow Y resumeFlowRun persisten steps incrementales");
  assert.equal((runtimeSource.match(/steps: \[\.\.\.liveSteps\]/g) || []).length, 2, "un updateRun chico por nodo (≤25/run)");
  assert.equal((runtimeSource.match(/\n {8}onStep,/g) || []).length, 2, "onStep llega al engine en ambas rutas");
});

test("P042-20 feedback en vivo en la UI: canvas ✓/✗ con polling honesto y la pausa visible", () => {
  // Editor: trackRun sondea flow_history mientras flow_run vuela; el resultado
  // final SIEMPRE gana al sondeo; la ✗ roja permanece hasta el próximo run.
  assert.ok(flowEditorSource.includes("function trackRun"), "trackRun envuelve flow_run");
  assert.ok((flowEditorSource.match(/trackRun\(/g) || []).length >= 5, "los 4 puntos de run (Ejecutar/pines/reintentar/desde paso) pasan por trackRun");
  assert.ok(flowEditorSource.includes('mcpCall("flow_history"'), "sondea flow_history mientras el run está en vuelo");
  assert.ok(flowEditorSource.includes('"✓" : "✗"'), "check/x por nodo en el canvas");
  assert.ok(flowEditorSource.includes("liveRun?.steps?.[node.id]"), "el nodo lee su estado del run vivo");
  assert.ok(flowEditorSource.includes("Falló aquí"), "tooltip con el error exacto del nodo");
  // Historial (tab + editor): chip del tipo de espera (IA/aprobación/webhook).
  assert.ok(flowsTabSource.includes("run.waitingKind"), "chip waiting en el historial del tab");
  assert.ok(flowEditorSource.includes("r.waitingKind"), "chip waiting en el historial del editor");
  // Modal del run: briefing + token + expiración visibles (antes: invisible).
  assert.ok(flowsTabSource.includes("runResult.wait.resumeToken"), "token visible en el modal");
  assert.ok(flowsTabSource.includes("Copiar token"), "token copiable");
  assert.ok(flowsTabSource.includes("flow_ai_tasks en Musa"), "la UI enseña CÓMO pedirle la tarea a la IA");
});

test("P042-21 catálogo de plantillas (Flows.md): 15 familias nuevas, TODAS terminan en preview y validan como borrador", () => {
  assert.equal(FLOW_LIBRARY.length, 30);
  const nuevas = [
    "preset_manual_marca_full", "preset_design_system", "preset_content_machine",
    "preset_animacion", "preset_eventos_kit", "preset_calendario_mes",
    "preset_carrito_abandonado", "preset_winback", "preset_newsletter_email",
    "preset_competitor_audit", "preset_propuesta_comercial", "preset_food_delivery",
    "preset_restaurante_fisica", "preset_campana_estacional", "preset_onboarding_rrhh",
  ];
  assert.equal(nuevas.length, 15);
  assert.equal(new Set(nuevas).size, 15, "ids únicos");
  for (const id of nuevas) {
    const preset = findFlowPreset(id);
    assert.ok(preset, `${id} presente en la biblioteca`);
    // Regla de Ren: TODAS terminan en preview — un único nodo terminal y es preview.
    const conSalida = new Set(preset.edges.map((edge) => edge.from));
    const terminales = preset.nodes.filter((node) => !conSalida.has(node.id));
    assert.equal(terminales.length, 1, `${id}: un solo nodo terminal`);
    assert.equal(terminales[0].type, "preview", `${id}: terminal = preview (el resultado generado queda a la vista)`);
    assert.equal(preset.edges.filter((edge) => edge.to === terminales[0].id).length, 1, `${id}: preview con UNA entrada (el fan-out pasa por merge)`);
    // Valida como borrador (mismo contrato que req027).
    validateFlowDefinition(
      { name: preset.name, trigger: preset.trigger, nodes: preset.nodes, edges: preset.edges, inputs: preset.inputs },
      { enabled: false },
    );
  }
  // Los 5 kits determinísticos corren SIN IA (cero key, cero esperas).
  for (const id of ["preset_eventos_kit", "preset_food_delivery", "preset_restaurante_fisica", "preset_campana_estacional", "preset_onboarding_rrhh"]) {
    const preset = findFlowPreset(id);
    assert.ok(!preset.nodes.some((node) => node.type === "ai" || node.type === "ai_task"), `${id}: determinístico (sin nodo ai/ai_task)`);
    assert.ok(preset.nodes.every((node) => node.type !== "template" || (node.config.recipe && !node.config.templateId)), `${id}: piezas con receta viva (sin templateId)`);
  }
});
