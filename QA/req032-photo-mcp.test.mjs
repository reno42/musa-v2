// QA/req032-photo-mcp.test.mjs — REQ-32 Fase 2: familia photo_* (paridad MCP
// del Modo Foto, REQ §6.14 + §8.8 "una acción UI y su tool MCP producen el
// mismo resultado"). Las primitivas puras se testean de verdad importándolas;
// el despacho y el contrato de inmutabilidad de mcp.mjs se afirman sobre el
// source (convención del repo: req032-photo-platform / crm-inbox-capture).
// Corre con:
//   node --experimental-strip-types --test QA/req032-photo-mcp.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createDefaultRecipe, diffRecipes, normalizeRecipe, patchRecipeMask,
  resetRecipeOperation, setRecipeOperation, upsertRecipeMask,
} from "../shared/photoRecipe.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const mcpSource = readFileSync(ROOT + "netlify/functions/mcp.mjs", "utf8");
const catalog = JSON.parse(readFileSync(ROOT + "tools_catalog.json", "utf8"));

const PHOTO_TOOLS = [
  "photo_list_assets", "photo_open_session", "photo_create_variant",
  "photo_apply_operation", "photo_update_operation", "photo_remove_operation",
  "photo_create_mask", "photo_update_mask", "photo_apply_preset",
  "photo_restore_version", "photo_compare_versions",
];
const PHOTO_READ_METHODS = ["photo_list_assets", "photo_open_session", "photo_compare_versions"];
// REQ-PHOTO F4 MCP-first: la familia photo_* creció con la composición por
// capas (photo_compose_*). El conteo del catálogo es exacto: 11 revelado + 8
// composición = 19.
const COMPOSE_TOOLS = [
  "photo_compose_get", "photo_compose_add_layer", "photo_compose_update_layer",
  "photo_compose_delete_layer", "photo_compose_reorder_layers",
  "photo_compose_duplicate_layer", "photo_compose_set_layer_mask", "photo_compose_clear",
];

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

test("REQ32-MCP: las 11 tools photo_* están registradas en MCP_TOOLS con templateId requerido", () => {
  const objects = toolObjects(mcpToolsBody(mcpSource));
  assert.ok(objects.length >= PHOTO_TOOLS.length, "MCP_TOOLS debería tener al menos las 11 photo_*");
  for (const name of PHOTO_TOOLS) {
    const obj = objects.find(o => o.includes(`name: "${name}"`));
    assert.ok(obj, `${name} no está registrado en MCP_TOOLS`);
    assert.match(obj, /required:\s*\["templateId"/, `${name} debe requerir templateId (el dispatch deriva el workspace de ahí)`);
    assert.match(obj, /inputSchema:\s*\{\s*type:\s*"object"/, `${name} debe declarar inputSchema`);
  }
});

test("REQ32-MCP: las 11 tools photo_* tienen case de despacho y llegan al catálogo generado", () => {
  for (const name of PHOTO_TOOLS) {
    assert.ok(mcpSource.includes(`case "${name}":`), `falta el case de despacho para ${name}`);
  }
  const photoEntries = catalog.filter(t => String(t.name || "").startsWith("photo_"));
  assert.equal(photoEntries.length, PHOTO_TOOLS.length + COMPOSE_TOOLS.length,
    "tools_catalog.json debe contener exactamente las 19 photo_* (11 revelado + 8 compose)");
  for (const name of COMPOSE_TOOLS) {
    assert.ok(photoEntries.some(t => t.name === name), `falta ${name} en tools_catalog.json`);
  }
  for (const entry of photoEntries) {
    assert.ok(entry.description, `${entry.name} sin description en tools_catalog.json`);
    assert.ok(entry.inputSchema, `${entry.name} sin inputSchema en tools_catalog.json`);
  }
});

test("REQ32-MCP: gate de roles — las photo_* read-only caen en viewer vía PHOTO_READ_METHODS", () => {
  for (const name of PHOTO_READ_METHODS) {
    assert.ok(mcpSource.includes(`"${name}"`), `${name} debe listar en PHOTO_READ_METHODS`);
  }
  // El nombre photo_* NO cae en el prefijo global de lectura: el gate lo
  // extiende explícitamente (los nombres los exige el REQ, no el regex).
  assert.doesNotMatch("photo_list_assets", /^(get|list|find|inspect|analyze|validate|compare|export|assemble|subscribe|unsubscribe|check|measure|preview|search)_/);
  assert.match(
    mcpSource,
    /MCP_READ_PREFIX\.test\(method\) \|\| PHOTO_READ_METHODS\.has\(method\) \? "viewer" : "editor"/,
    "el gate de authorizeMcpCall debe tratar PHOTO_READ_METHODS como viewer",
  );
  // Las de edición NO están en el set de lectura (quedan en editor).
  for (const name of ["photo_create_variant", "photo_apply_preset", "photo_restore_version"]) {
    const gateSet = mcpSource.match(/const PHOTO_READ_METHODS = new Set\(\[([^\]]*)\]\)/)?.[1] || "";
    assert.ok(!gateSet.includes(name), `${name} no debe ser viewer`);
  }
});

test("REQ32-MCP: contrato de inmutabilidad — photo_versions solo INSERT, nunca update", () => {
  assert.match(mcpSource, /\.from\("photo_versions"\)\.insert\(/, "las versiones se crean con INSERT");
  assert.match(mcpSource, /schema_version: RECIPE_SCHEMA_VERSION/, "cada versión lleva schema_version");
  assert.match(mcpSource, /parent_version_id: doc\.active_version_id \|\| null/, "parent = versión activa");
  // Nada puede encadenar .update() a 200 chars de un .from("photo_versions"):
  // la única escritura sobre documentos es el puntero active_version_id.
  assert.doesNotMatch(mcpSource, /\.from\("photo_versions"\)[\s\S]{0,200}?\.update\(/);
  assert.match(mcpSource, /\.update\(\{ active_version_id: version\.id, updated_at: new Date\(\)\.toISOString\(\) \}\)/);
});

test("REQ32-MCP: labels de versiones prefijados mcp: y helpers del worker presentes", () => {
  for (const label of [
    "mcp: variante", "mcp: apply operation", "mcp: update operation",
    "mcp: reset operation", "mcp: create mask", "mcp: update mask",
    "mcp: preset", "mcp: edición",
  ]) {
    assert.ok(mcpSource.includes(label), `label ausente: ${label}`);
  }
  assert.match(mcpSource, /from "\.\.\/\.\.\/shared\/photoRecipe\.ts"/);
  assert.match(mcpSource, /from "\.\.\/\.\.\/shared\/photoTargets\.ts"/);
  for (const fn of [
    "resolvePhotoContext", "upsertPhotoDocument", "commitPhotoVersion",
    "commitContextVersion", "requirePhotoDb", "requirePhotoTemplate",
    "photoAssetIdFromUrl", "photoCanvasObjects", "photoCreatedBy",
  ]) {
    assert.ok(
      mcpSource.includes(`function ${fn}`) || mcpSource.includes(`const ${fn} =`),
      `helper ausente: ${fn}`,
    );
  }
  // Misma derivación de assetId que la UI (PhotoModeOverlay): MCP y UI
  // escriben en la MISMA fila de photo_catalog_items.
  assert.match(mcpSource, /split\("\?"\)\[0\]\.split\("\/"\)\.pop\(\)/);
  // Prioridad de la receta activa igual que el overlay: attr → versión → default.
  assert.match(mcpSource, /attrRecipe\s*\|\|/);
  assert.match(mcpSource, /collectPhotoTargets\(tpl\.frames \|\| \[\], photoCanvasObjects\(tpl\)\)/);
});

// ── Primitivas puras compartidas con la UI (import REAL) ──

test("REQ32-MCP: setRecipeOperation — replace vuelve claves ausentes a default; merge conserva", () => {
  const r1 = setRecipeOperation(createDefaultRecipe(), "basic", { exposure: 150, contrast: 30 });
  assert.deepEqual(r1.ops.find(o => o.type === "basic").params, {
    exposure: 100, contrast: 30, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  });
  assert.equal(r1.ops.find(o => o.type === "basic").enabled, true);

  const r2 = setRecipeOperation(r1, "basic", { exposure: 20 }, { merge: true });
  assert.equal(r2.ops.find(o => o.type === "basic").params.exposure, 20);
  assert.equal(r2.ops.find(o => o.type === "basic").params.contrast, 30);

  const r3 = setRecipeOperation(r2, "bw", { enabled: true }, { enabled: false });
  assert.equal(r3.ops.find(o => o.type === "bw").enabled, false);

  assert.throws(() => setRecipeOperation(r1, "curva_inventada", {}), /Operación desconocida/);
});

test("REQ32-MCP: resetRecipeOperation — la op queda byte-idéntica a su default", () => {
  const edited = setRecipeOperation(createDefaultRecipe(), "color", { vibrance: 80, saturation: -50 });
  const reset = resetRecipeOperation(edited, "color");
  assert.deepEqual(
    reset.ops.find(o => o.type === "color").params,
    createDefaultRecipe().ops.find(o => o.type === "color").params,
  );
  assert.equal(reset.ops.find(o => o.type === "color").enabled, true);
  assert.throws(() => resetRecipeOperation(edited, "nope"), /Operación desconocida/);
});

test("REQ32-MCP: upsertRecipeMask — cap de 6, replace por id y normalización", () => {
  let r = createDefaultRecipe();
  for (let i = 0; i < 6; i++) r = upsertRecipeMask(r, { id: `m${i}`, kind: "radial", cx: 0.5 });
  assert.throws(() => upsertRecipeMask(r, { id: "m6", kind: "linear" }), /Límite de 6 máscaras/);
  // Reemplazar una existente por id NO crece: permitido incluso con 6.
  r = upsertRecipeMask(r, { id: "m0", kind: "linear", feather: 9, adjustments: { exposure: 10 } });
  assert.equal(r.masks.length, 6);
  assert.equal(r.masks[0].kind, "linear");
  assert.equal(r.masks[0].feather, 1, "feather se clampa a 0..1");
  assert.equal(r.masks[0].adjustments.exposure, 10);
  assert.throws(() => upsertRecipeMask(r, null), /Máscara inválida/);
});

test("REQ32-MCP: patchRecipeMask — id desconocido lanza y adjustments hacen MERGE", () => {
  let r = upsertRecipeMask(createDefaultRecipe(), { id: "k1", kind: "radial", adjustments: { exposure: 10 } });
  assert.throws(() => patchRecipeMask(r, "zzz", { feather: 0.2 }), /no encontrada/);
  r = patchRecipeMask(r, "k1", { adjustments: { contrast: -5 }, invert: true });
  assert.equal(r.masks[0].adjustments.exposure, 10, "el merge no borra exposure");
  assert.equal(r.masks[0].adjustments.contrast, -5);
  assert.equal(r.masks[0].invert, true);
});

test("REQ32-MCP: diffRecipes — from/to exactos, enabled-only y sets de máscaras", () => {
  const a = normalizeRecipe({ ops: [{ type: "basic", params: { exposure: 10 } }], masks: [{ id: "k1", kind: "radial" }] });
  const b = normalizeRecipe({
    ops: [{ type: "basic", params: { exposure: 40, contrast: 5 } }, { type: "color", enabled: false, params: {} }],
    masks: [{ id: "k2", kind: "linear", feather: 0.8 }],
    geometry: { rotate90: 1 },
  });
  const d = diffRecipes(a, b);
  assert.deepEqual(d.ops.find(o => o.type === "basic").keys, [
    { key: "exposure", from: 10, to: 40 },
    { key: "contrast", from: 0, to: 5 },
  ]);
  const colorDiff = d.ops.find(o => o.type === "color");
  assert.equal(colorDiff.changed, true, "apagar una op es un cambio");
  assert.deepEqual(colorDiff.keys, [], "sin keys si los params son iguales");
  assert.deepEqual(d.masksAdded, ["k2"]);
  assert.deepEqual(d.masksRemoved, ["k1"]);
  assert.deepEqual(d.masksChanged, []);
  assert.equal(d.geometryChanged, true);
  assert.equal(d.changed, true);

  const same = diffRecipes(a, normalizeRecipe(JSON.parse(JSON.stringify(a))));
  assert.equal(same.changed, false);
  assert.deepEqual(same.masksAdded, []);
  assert.equal(same.geometryChanged, false);
});
