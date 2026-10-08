// REQ045 — MCP surface for particles (REQ044), expressions (REQ043) and
// layer z-order (REQ042). The editor UI shipped in those REQs; this locks the
// MCP side: the same pure shared modules are imported (no logic duplication),
// the catalog tool lists them, the write tools exist with the house save
// pattern, and the prose/catalog ids can never drift from the modules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PARTICLE_FX } from "../shared/particleFx.ts";
import { EXPRESSION_RULES } from "../src/lib/expressionRules.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mcp = readFileSync(join(root, "netlify", "functions", "mcp.mjs"), "utf8");

// Slice a tool definition out of the MCP_TOOLS array (from its name line up
// to the next tool's name line) so assertions stay scoped to that def.
function toolDef(name) {
  const start = mcp.indexOf(`name: "${name}"`);
  assert.notEqual(start, -1, `tool def "${name}" must exist in MCP_TOOLS`);
  const next = mcp.indexOf('name: "', start + 1);
  return mcp.slice(start, next === -1 ? mcp.length : next);
}

test("P045-1 mcp.mjs imports the SAME pure modules the editor compiles with", () => {
  assert.match(mcp, /import \{ PARTICLE_FX \} from "\.\.\/\.\.\/shared\/particleFx\.ts"/);
  assert.match(mcp, /import \{ EXPRESSION_RULES, applyExpressionToSchema, defaultExpressionParams, expressionOfLayer, sanitizeExpressionParams, updateExpressionParams \} from "\.\.\/\.\.\/src\/lib\/expressionRules\.ts"/);
  assert.match(mcp, /import \{ removePresetInstance \} from "\.\.\/\.\.\/src\/lib\/presetInstances\.ts"/);
});

test("P045-2 list_video_effects exposes particles + expressions and routes them", () => {
  assert.match(mcp, /particles: PARTICLE_FX\.map\(p => \(\{ id: p\.id, label: p\.label \}\)\)/);
  assert.match(mcp, /expressions: EXPRESSION_RULES\.map\(r => \(\{/);
  const note = mcp.match(/note: "[^"]*set_layer_z[^"]*"/);
  assert.ok(note, "routing note must mention set_layer_z");
  for (const tool of ["apply_transition", "set_take_effects", "apply_expression", "set_layer_effect", "set_video_text"]) {
    assert.ok(note[0].includes(tool), `routing note must point at ${tool}`);
  }
});

test("P045-3 set_take_effects: particles + density in schema, catalog lookup, null clears", () => {
  const def = toolDef("set_take_effects");
  assert.match(def, /particles: \{ type: "string", description: "Particle overlay id/);
  assert.match(def, /particleDensity: \{ type: "number", description: "0\.\.1/);
  assert.match(mcp, /const p = PARTICLE_FX\.find\(x => x\.id === params\.particles\)/);
  assert.match(mcp, /frame\.reelParticles = \{ id: p\.id, density: clamp01\(params\.particleDensity, 0\.7\) \}/);
  assert.match(mcp, /if \(params\.particles === null\) \{\s*delete frame\.reelParticles;/);
});

test("P045-4 apply_expression def: ruleId enum, retune via instanceId, clear", () => {
  const def = toolDef("apply_expression");
  assert.match(def, /ruleId: \{ type: "string", description: "Expression id from list_video_effects: exp-wiggle \| exp-loop \| exp-pulse"/);
  assert.match(def, /instanceId: \{ type: "string", description: "Retune path/);
  assert.match(def, /clear: \{ type: "boolean", description: "Remove the layer's expression instance AND its clip/);
  assert.match(def, /required: \["templateId", "frameId", "layerId"\]/);
});

test("P045-5 apply_expression handler: one-instance contract through presetInstances + save pattern", () => {
  const start = mcp.indexOf('case "apply_expression"');
  assert.notEqual(start, -1, "apply_expression handler case must exist");
  const body = mcp.slice(start, mcp.indexOf('case "', start + 10));
  // clear path removes the instance AND its owned clips
  assert.match(body, /expressionOfLayer\(/);
  assert.match(body, /removePresetInstance\(/);
  // retune path updates ONLY the owned clip of that instance
  assert.match(body, /updateExpressionParams\(/);
  // apply path sanitizes against the rule and compiles canonical keyframes
  assert.match(body, /sanitizeExpressionParams\(/);
  assert.match(body, /applyExpressionToSchema\(/);
  assert.match(body, /frame\.animation = normalizeAnimation\(schemaOut\)/);
  // house save pattern (REQ-014 + snapshot)
  assert.match(body, /agent:apply_expression/);
  assert.match(body, /SAVE_FAILED[^\n]*apply_expression/);
  assert.match(body, /autoSnapshot\(params\.templateId, "apply_expression"\)/);
});

test("P045-6 set_layer_z def: order / move / clear vocabulary", () => {
  const def = toolDef("set_layer_z");
  assert.match(def, /order: \{ type: "array", items: \{ type: "string" \}/);
  assert.match(def, /front", "back", "raise", "lower"/);
  assert.match(def, /clear: \{ type: "boolean"/);
  assert.match(def, /required: \["templateId", "frameId"\]/);
});

test("P045-7 set_layer_z handler: ROOT-layer doc order, full-map rule, z map write", () => {
  const start = mcp.indexOf('case "set_layer_z"');
  assert.notEqual(start, -1, "set_layer_z handler case must exist");
  const body = mcp.slice(start, mcp.indexOf("\n    case ", start + 10));
  // Document order = ROOT layers only (no data-layer-id ancestor)
  assert.match(body, /parents\("\[data-layer-id\]"\)\.length > 0\) return;/);
  // order must list every root layer exactly once
  assert.match(body, /order must list ALL/);
  assert.match(body, /Unknown layer ids: \$\{unknown\.join/, "unknown ids must echo the valid list");
  // move: nudge within the current effective order
  assert.match(body, /const zMap = frame\.layerZ && typeof frame\.layerZ === "object" \? frame\.layerZ : \{\}/);
  assert.match(body, /params\.move === "raise" \? 1 : -1/);
  // clear restores document order; write is a full back->front map
  assert.match(body, /if \(params\.clear\) \{\s*delete frame\.layerZ;/);
  assert.match(body, /order\.forEach\(\(id, i\) => \{ z\[id\] = i; \}\)/);
  assert.match(body, /agent:set_layer_z/);
  assert.match(body, /SAVE_FAILED[^\n]*set_layer_z/);
  assert.match(body, /autoSnapshot\(params\.templateId, "set_layer_z"\)/);
});

test("P045-8 video_export howTo routes the full WYSIWYG state including the new tools", () => {
  assert.match(mcp, /apply_transition, set_take_effects, set_layer_effect, apply_expression, set_layer_z, set_video_text/);
});

test("P045-9 tools_catalog.json carries the new tools and the catalog surfaces", () => {
  const catalog = JSON.parse(readFileSync(join(root, "tools_catalog.json"), "utf8"));
  const tools = Array.isArray(catalog) ? catalog : catalog.tools;
  const byName = new Map(tools.map(t => [t.name, t]));
  for (const name of ["list_video_effects", "set_take_effects", "apply_expression", "set_layer_z"]) {
    assert.ok(byName.has(name), `catalog must list ${name}`);
  }
  assert.ok(byName.get("set_take_effects").inputSchema.properties.particles, "set_take_effects schema must carry particles");
  assert.ok(byName.get("set_take_effects").inputSchema.properties.particleDensity, "set_take_effects schema must carry particleDensity");
});

test("P045-10 id parity: tool copy lists exactly what the shared modules export", () => {
  const catalog = JSON.parse(readFileSync(join(root, "tools_catalog.json"), "utf8"));
  const tools = Array.isArray(catalog) ? catalog : catalog.tools;
  const listDesc = tools.find(t => t.name === "list_video_effects").description;
  for (const p of PARTICLE_FX) {
    assert.ok(listDesc.includes(p.id), `list_video_effects copy must mention particle "${p.id}"`);
  }
  for (const r of EXPRESSION_RULES) {
    assert.ok(listDesc.includes(r.id), `list_video_effects copy must mention expression "${r.id}"`);
  }
  const setTakeDesc = tools.find(t => t.name === "set_take_effects").description;
  for (const p of PARTICLE_FX) {
    assert.ok(setTakeDesc.includes(p.id), `set_take_effects copy must mention particle "${p.id}"`);
  }
});
