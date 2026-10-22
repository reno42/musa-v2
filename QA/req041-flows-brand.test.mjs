// REQ-041 — Flows-brand: investigación con la IA del nodo (webSearch nativo),
// tokens arbitrarios de template (extraValues + extras del item), RECETA de
// diseño inline (recipe:{width,height,html,css}) e inputs declarados del flow
// (defaults + required sobre {{input.x}}). Migración v70 (flows.inputs).
//
// Estilo req040: unit de engine + asserts de fuente (mcp.mjs / flowLibrary.ts
// son TS+mcp y no importan directo desde node:test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  NODE_SCHEMA_DOC, executeFlow, exportShape, prepareFlowRow, validateFlowDefinition,
} from "../worker/runtime/functions/flows-core.mjs";
import { renderTemplateFrame, templateValuesFromItem } from "../worker/runtime/functions/flows-sources.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mcp = readFileSync(join(root, "netlify", "functions", "mcp.mjs"), "utf8");
const librarySrc = readFileSync(join(root, "src", "data", "flowLibrary.ts"), "utf8");

const deps = { onStep: async () => {}, callTool: async () => { throw new Error("callTool no debe llamarse en estos tests"); } };

test("P041-1 inputs declaradas: normaliza label/type/required/default", () => {
  const flow = validateFlowDefinition({
    name: "F", nodes: [], edges: [],
    inputs: [
      { key: "marca", required: true, type: "date", default: "2026-12-31" },
      { key: "nota" },
      { key: "raro", type: "password", required: "sí", label: "  Etiqueta larga que pasa de ochenta caracteres para probar el recorte del label en normalizeFlowInputs  " },
    ],
  }, { enabled: false });
  assert.deepEqual(flow.inputs[0], { key: "marca", label: "marca", type: "date", required: true, default: "2026-12-31" });
  assert.deepEqual(flow.inputs[1], { key: "nota", label: "nota", type: "text", required: false });
  assert.equal(flow.inputs[2].type, "text", "type desconocido → text");
  assert.equal(flow.inputs[2].required, false, "required no-booleano → false");
  assert.ok(flow.inputs[2].label.length <= 80);
});

test("P041-2 inputs: límites duros (13, duplicada, clave inválida, no-array)", () => {
  const base = { name: "F", nodes: [], edges: [] };
  assert.throws(() => validateFlowDefinition({ ...base, inputs: Array.from({ length: 13 }, (_, i) => ({ key: `k${i}` })) }), /hasta 12/);
  assert.throws(() => validateFlowDefinition({ ...base, inputs: [{ key: "a" }, { key: "a" }] }), /duplicada/);
  assert.throws(() => validateFlowDefinition({ ...base, inputs: [{ key: "1 mala" }] }), /key inválida/i);
  assert.throws(() => validateFlowDefinition({ ...base, inputs: { key: "a" } }), /debe ser una lista/);
  assert.deepEqual(validateFlowDefinition(base, { enabled: false }).inputs, [], "sin inputs → []");
});

test("P041-3 persistencia: prepareFlowRow y exportShape llevan inputs", () => {
  const definition = validateFlowDefinition({ name: "F", nodes: [], edges: [], inputs: [{ key: "a", required: true }] }, { enabled: false });
  const row = prepareFlowRow({ workspaceId: "ws_1", definition, createdBy: "user" });
  assert.deepEqual(row.inputs, definition.inputs);
  const shape = exportShape({ name: "F", nodes: [], edges: [], inputs: definition.inputs });
  assert.deepEqual(shape.inputs, definition.inputs);
  assert.deepEqual(exportShape({ name: "F" }).inputs, [], "flow viejo sin inputs → []");
});

const FLOW_INPUTS = {
  name: "Saludo", enabled: true, trigger: { type: "manual" },
  inputs: [{ key: "nombre", label: "Nombre", type: "text", required: true }, { key: "tono", label: "Tono", default: "neutro" }],
  nodes: [{ id: "map1", type: "map", label: "m", config: { value: { saludo: "Hola {{input.nombre}} ({{input.tono}})" } }, position: { x: 0, y: 0 } }],
  edges: [],
};

test("P041-4 executeFlow: required faltante → INPUT_REQUIRED ANTES de ejecutar", async () => {
  const flow = validateFlowDefinition(FLOW_INPUTS, { enabled: true });
  await assert.rejects(
    () => executeFlow(flow, {}, deps),
    (e) => e.flowCode === "INPUT_REQUIRED" && /Faltan inputs del flow: Nombre/.test(e.message),
  );
});

test("P041-5 executeFlow: default aplica y el payload pisa al default", async () => {
  const flow = validateFlowDefinition(FLOW_INPUTS, { enabled: true });
  const conDefault = await executeFlow(flow, { nombre: "Ren" }, deps);
  assert.equal(conDefault.status, "success");
  assert.ok(JSON.stringify(conDefault).includes("Hola Ren (neutro)"), "tono toma su default");
  const conPayload = await executeFlow(flow, { nombre: "Ren", tono: "fiestero" }, deps);
  assert.ok(JSON.stringify(conPayload).includes("Hola Ren (fiestero)"), "el payload gana al default");
});

test("P041-6 flows sin inputs corren igual (cero regresión)", async () => {
  const flow = validateFlowDefinition({ name: "S", enabled: true, trigger: { type: "manual" }, nodes: FLOW_INPUTS.nodes, edges: [] }, { enabled: true });
  const res = await executeFlow(flow, {}, deps);
  assert.equal(res.status, "success");
  assert.ok(JSON.stringify(res).includes("Hola  ()"), "input ausente resuelve vacío, nunca 'undefined'");
});

test("P041-7 webSearch: persiste SOLO cuando es true explícito", () => {
  const base = { name: "F", nodes: [], edges: [] };
  const con = validateFlowDefinition({ ...base, nodes: [{ id: "ai1", type: "ai", label: "a", config: { provider: "openrouter", model: "m", prompt: "p", credentialId: "c1", webSearch: true } }], edges: [] }, { enabled: false });
  assert.equal(con.nodes[0].config.webSearch, true);
  const sin = validateFlowDefinition({ ...base, nodes: [{ id: "ai1", type: "ai", label: "a", config: { provider: "openrouter", model: "m", prompt: "p", credentialId: "c1", webSearch: "yes" } }], edges: [] }, { enabled: false });
  assert.equal(sin.nodes[0].config.webSearch, undefined, "solo ===true pasa (falso positivo de string)");
});

const RECIPE = { width: 1080, height: 1350, background: "#101014", html: "<main><h1>{{marca}}</h1></main>", css: "h1{color:{{colorPrimario}}}" };

test("P041-8 receta inline: nodo template queda CONFIGURADO sin templateId (enabled:true)", () => {
  const flow = validateFlowDefinition({
    name: "Marca", enabled: true, trigger: { type: "manual" },
    nodes: [
      { id: "map1", type: "map", label: "m", config: { value: { marca: "Acme", colorPrimario: "#e63946" } }, position: { x: 0, y: 0 } },
      { id: "tpl1", type: "template", label: "t", config: { format: "post", recipe: RECIPE, extraValues: { rubro: "cafetería" } }, position: { x: 300, y: 0 } },
    ],
    edges: [{ from: "map1", to: "tpl1" }],
  }, { enabled: true });
  assert.equal(flow.nodes[1].config.recipe.width, 1080);
  assert.equal(flow.nodes[1].config.recipe.html, RECIPE.html);
  assert.equal(flow.nodes[1].config.extraValues.rubro, "cafetería");
  // y el run real llega a renderizar con la receta (sin get_html_frames):
});

test("P041-9 receta: receta inválida → VALIDATION (dims, html vacío, css enorme)", () => {
  const node = (recipe) => ({ name: "F", nodes: [{ id: "map1", type: "map", label: "m", config: { value: { a: 1 } } }, { id: "tpl1", type: "template", label: "t", config: { recipe } }], edges: [{ from: "map1", to: "tpl1" }] });
  assert.throws(() => validateFlowDefinition(node({ ...RECIPE, width: 100, height: 100 }), { enabled: false }), /320-8000/);
  assert.throws(() => validateFlowDefinition(node({ ...RECIPE, html: "   " }), { enabled: false }), /necesita html/);
  assert.throws(() => validateFlowDefinition(node({ ...RECIPE, css: "x".repeat(17_000) }), { enabled: false }), /16KB/);
  assert.throws(() => validateFlowDefinition(node("receta"), { enabled: false }), /debe ser un objeto/);
});

test("P041-10 extraValues: clave inválida y no-escalar → VALIDATION/limpieza", () => {
  const tpl = (extraValues) => ({ name: "F", nodes: [{ id: "map1", type: "map", label: "m", config: { value: { a: 1 } } }, { id: "tpl1", type: "template", label: "t", config: { recipe: RECIPE, extraValues } }], edges: [{ from: "map1", to: "tpl1" }] });
  assert.throws(() => validateFlowDefinition(tpl({ "1malo": "x" }), { enabled: false }), /clave inválida/i);
  const limpio = validateFlowDefinition(tpl({ ok: "sí", vacio: "", objeto: { a: 1 } }), { enabled: false });
  assert.equal(limpio.nodes[1].config.extraValues.ok, "sí");
  assert.equal(limpio.nodes[1].config.extraValues.vacio, undefined, "vacío se cae");
  assert.equal(limpio.nodes[1].config.extraValues.objeto, undefined, "no-escalar se cae");
});

test("P041-11 renderTemplateFrame: {{token}} arbitrarios, escape y faltante intacto", () => {
  const frame = { width: 1080, height: 1350, html: `<h1>{{title}}</h1><b style="color:{{colorPrimario}}">{{colorPrimario}}</b><i>{{faltante}}</i>`, css: "" };
  const design = renderTemplateFrame(frame, { title: `Pan & "queso"`, colorPrimario: "#e63946" });
  assert.ok(design.html.includes(`<h1>Pan &amp; &quot;queso&quot;</h1>`), "slot fijo escapado");
  assert.ok(design.html.includes(`color:#e63946`), "extra en atributo");
  assert.ok(design.html.includes(">#e63946</b>"), "extra en texto");
  assert.ok(design.html.includes("{{faltante}}"), "token sin valor queda VISIBLE para depurar");
});

test("P041-12 templateValuesFromItem: extras del item (escalares token-safe, ≤16)", () => {
  const values = templateValuesFromItem({ title: "T", ai: "x", colorPrimario: "#fff", malo: { a: 1 }, "1mal": "y", url: "https://a.b" });
  assert.equal(values.title, "T");
  assert.equal(values.colorPrimario, "#fff");
  assert.equal(values.url, "https://a.b");
  assert.equal(values.malo, undefined, "objeto se cae");
  assert.equal(values["1mal"], undefined, "clave no-token-safe se cae");
});

test("P041-13 NODE_SCHEMA_DOC documenta las 4 piezas (contrato para IAs)", () => {
  assert.ok(NODE_SCHEMA_DOC.includes("webSearch?:bool"));
  assert.ok(NODE_SCHEMA_DOC.includes("recipe:{width, height, html≤64KB"));
  assert.ok(NODE_SCHEMA_DOC.includes("extraValues?:{token:valor}≤16"));
  assert.ok(NODE_SCHEMA_DOC.includes("inputs:[{key, label?, type?: text|textarea|number|date, required?, default?} ≤12]"));
  assert.ok(NODE_SCHEMA_DOC.includes("INPUT_REQUIRED"));
});

test("P041-14 mcp.mjs: flow_save/flow_run/flow_get/instantiate hablan inputs", () => {
  assert.ok(mcp.includes('inputs: { type: "array", description: "Flows-brand'), "flow_save schema");
  assert.ok(mcp.includes("un required faltante falla con INPUT_REQUIRED"), "flow_run description");
  assert.ok(mcp.includes("Array.isArray(flow.inputs) && flow.inputs.length ? { inputs: flow.inputs }"), "flow_get spread");
  assert.ok(mcp.includes("inputs: Array.isArray(preset.inputs) ? preset.inputs : []"), "instantiate passthrough");
  assert.ok(mcp.includes('["tags", "versions", "vars", "locked", "inputs"]') === false, "OPTIONAL_COLUMNS vive en flows-core, no en mcp");
});

test("P041-15 OPTIONAL_COLUMNS + executeFlow pisa config.extraValues sobre los del item", async () => {
  const core = readFileSync(join(root, "netlify", "functions", "flows-core.mjs"), "utf8");
  assert.ok(core.includes('["tags", "versions", "vars", "locked", "inputs"]'), "degradación con gracia v70");
  assert.ok(core.includes("...templateValuesFromItem(item), ...config.extraValues"), "fase 1: el humano pisa a la IA");
  assert.ok(core.includes("...templateValuesFromItem(items[index]), ...config.extraValues"), "fase 2: idem");
  assert.ok(core.includes("input = { ...payload, ...defaults }"), "payload gana al default con valores reales; blank cae al default (REQ-048 FL2)");
});

test("P041-16 biblioteca: 3 presets Flows-brand con receta viva + inputs", () => {
  for (const id of ["preset_manual_marca", "preset_investigacion_web", "preset_evento_recordatorio"]) {
    assert.ok(librarySrc.includes(`id: "${id}"`), id);
  }
  assert.ok(librarySrc.includes("webSearch: true"), "presets de research usan webSearch");
  assert.ok(librarySrc.includes("{{colorPrimario}}"), "la receta de marca consume tokens arbitrarios");
  assert.ok(librarySrc.includes('key: "marca", label: "Marca", type: "text", required: true'), "inputs del mini-form");
  assert.ok(existsSync(join(root, "supabase_migrations_v70.sql")), "migración v70 presente");
  assert.ok(readFileSync(join(root, "supabase_migrations_v70.sql"), "utf8").includes("ADD COLUMN IF NOT EXISTS inputs"), "columna flows.inputs");
});
