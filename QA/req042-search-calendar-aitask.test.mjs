// REQ-042 — A: webSearch nativo en los 8 proveedores (cada uno con SU clave y
// SU cuota). B: nodo ai_task (despierta la IA cliente conectada del usuario) +
// flow_ai_tasks/flow_ai_complete. C: tools de calendario en la paleta de flows
// + preset copys_lote. Sin migraciones (v64 ya persiste las pausas).
//
// Estilo req040/req041: unit de engine + asserts de fuente para lo que no
// importa directo desde node:test (mcp.mjs, flowLibrary.ts, helpers privados).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { NODE_SCHEMA_DOC, validateFlowDefinition } from "../netlify/functions/flows-core.mjs";
import { AI_PROVIDERS } from "../netlify/functions/flows-sources.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sources = readFileSync(join(root, "netlify", "functions", "flows-sources.mjs"), "utf8");
const core = readFileSync(join(root, "netlify", "functions", "flows-core.mjs"), "utf8");
const mcp = readFileSync(join(root, "netlify", "functions", "mcp.mjs"), "utf8");

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
