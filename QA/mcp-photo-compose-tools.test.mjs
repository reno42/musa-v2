#!/usr/bin/env node
/**
 * QA — REQ-PHOTO F4 MCP-first: suite compose (photo_compose_*).
 *
 * Verifica que las 8 tools MCP de composición por capas estén bien
 * registradas en worker/runtime/functions/mcp.mjs (defs + handlers + gating
 * viewer/editor + topes de la REST PUT /api/photos/composition) y que la
 * puerta de entrada compartida (normalizeCompositionLayers) se comporta
 * igual que la UI — el agente MCP y el humano deben producir el MISMO
 * JSONB (REQ §8.8).
 *
 * Run: node QA/mcp-photo-compose-tools.test.mjs
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const SRC = readFileSync(new URL("../worker/runtime/functions/mcp.mjs", import.meta.url), "utf8");
const CATALOG = JSON.parse(readFileSync(new URL("../tools_catalog.json", import.meta.url), "utf8"));

let pass = 0;
let fail = 0;
const t = (name, fn) => {
  try {
    fn();
    pass++;
    console.log("  ok", name);
  } catch (e) {
    fail++;
    console.error("FAIL", name, "-", e.message);
  }
};

console.log("\n=== REQ-PHOTO F4 MCP-first: photo_compose_* ===\n");

// ── 1. Registro de las 8 tools ──────────────────────────────────────────
const TOOLS = [
  "photo_compose_get",
  "photo_compose_add_layer",
  "photo_compose_update_layer",
  "photo_compose_delete_layer",
  "photo_compose_reorder_layers",
  "photo_compose_duplicate_layer",
  "photo_compose_set_layer_mask",
  "photo_compose_clear",
];

t("8 defs presentes en MCP_TOOLS", () => {
  for (const name of TOOLS) {
    assert.ok(SRC.includes(`name: "${name}"`), `falta def ${name}`);
  }
});

t("8 handlers case en el dispatch", () => {
  for (const name of TOOLS) {
    assert.ok(SRC.includes(`case "${name}":`), `falta handler ${name}`);
  }
});

t("tools_catalog.json regenerado incluye las 8", () => {
  const names = Array.isArray(CATALOG) ? CATALOG.map(x => x.name) : (CATALOG.tools || []).map(x => x.name);
  for (const name of TOOLS) {
    assert.ok(names.includes(name), `tools_catalog.json sin ${name} (correr npm run sync:skill)`);
  }
});

t("photo_compose_get es read-only (viewer) via PHOTO_READ_METHODS", () => {
  const m = SRC.match(/const PHOTO_READ_METHODS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, "PHOTO_READ_METHODS no encontrado");
  assert.ok(m[1].includes("photo_compose_get"), "photo_compose_get debe estar en PHOTO_READ_METHODS");
});

t("las 7 mutaciones NO caen en read-only", () => {
  const m = SRC.match(/const PHOTO_READ_METHODS = new Set\(\[([^\]]*)\]\)/);
  for (const name of TOOLS) {
    if (name === "photo_compose_get") continue;
    assert.ok(!m[1].includes(name), `${name} es mutación, no debe ser viewer`);
  }
});

// ── 2. Defs: schemas mínimos ────────────────────────────────────────────
t("add_layer: kind enum paint|text + required templateId,kind", () => {
  const block = SRC.match(/name: "photo_compose_add_layer",[\s\S]*?required: \["templateId", "kind"\]/);
  assert.ok(block, "bloque def no encontrado");
  assert.ok(block[0].includes('enum: ["paint", "text"]'), "enum paint|text");
  assert.ok(block[0].includes("vertical"), "text soporta vertical (F4.2e)");
});

t("update_layer: patch con transform/adjust/text/dataUrl", () => {
  const block = SRC.match(/name: "photo_compose_update_layer",[\s\S]*?required: \["templateId", "patch"\]/);
  assert.ok(block, "bloque def no encontrado");
  for (const k of ["transform", "adjust", "text", "dataUrl", "blend", "opacity", "visible"]) {
    assert.ok(block[0].includes(k), `patch sin ${k}`);
  }
});

t("get: includeDataUrls opt-in (metadata por defecto)", () => {
  const block = SRC.match(/name: "photo_compose_get",[\s\S]*?required: \["templateId"\]/);
  assert.ok(block, "bloque def no encontrado");
  assert.ok(block[0].includes("includeDataUrls"), "falta includeDataUrls");
});

t("set_layer_mask: maskDataUrl + clear", () => {
  const block = SRC.match(/name: "photo_compose_set_layer_mask",[\s\S]*?required: \["templateId"\]/);
  assert.ok(block, "bloque def no encontrado");
  assert.ok(block[0].includes("maskDataUrl") && block[0].includes("clear"), "faltan maskDataUrl/clear");
});

t("clear: confirm requerido", () => {
  const block = SRC.match(/name: "photo_compose_clear",[\s\S]*?required: \["templateId", "confirm"\]/);
  assert.ok(block, "bloque def no encontrado");
});

// ── 3. Handlers: mismas garantías que la REST PUT ───────────────────────
t("saveComposeStack usa normalizeCompositionLayers (misma puerta que la UI)", () => {
  assert.ok(/async function saveComposeStack[\s\S]{0,400}normalizeCompositionLayers\(rawLayers\)/.test(SRC),
    "saveComposeStack debe pasar por normalizeCompositionLayers");
});

t("topes espejo de la REST: 12 capas / 3MB dataUrl / 8MB total", () => {
  const block = SRC.match(/async function saveComposeStack[\s\S]*?return \{ layers, updatedAt/);
  assert.ok(block, "saveComposeStack no encontrado");
  assert.ok(block[0].includes("MAX_COMPOSITION_LAYERS"), "tope 12 capas");
  assert.ok(block[0].includes("MAX_LAYER_DATAURL_CHARS"), "tope 3MB por dataUrl");
  assert.ok(block[0].includes("8_000_000"), "tope 8MB total");
});

t("upsert service-role con onConflict workspace_id,source_url + id cmp_", () => {
  const block = SRC.match(/async function saveComposeStack[\s\S]*?ignoreDuplicates: false/);
  assert.ok(block, "upsert no encontrado");
  assert.ok(block[0].includes("photo_compositions"), "tabla photo_compositions");
  assert.ok(block[0].includes("cmp_"), "id cmp_<uuid>");
  assert.ok(block[0].includes('onConflict: "workspace_id,source_url"'),
    "onConflict workspace_id,source_url");
});

t("loadComposeStack: sin composición = stack vacío (no error)", () => {
  const block = SRC.match(/async function loadComposeStack[\s\S]*?updatedAt: comp\?\.updated_at/);
  assert.ok(block, "loadComposeStack no encontrado");
  assert.ok(block[0].includes("Array.isArray(comp?.layers_json) ? comp.layers_json : []"), "fallback []");
});

t("add text: value requerido + slice 5000 + default color/font", () => {
  const block = SRC.match(/case "photo_compose_add_layer":[\s\S]*?case "photo_compose_update_layer":/);
  assert.ok(block, "handler add no encontrado");
  assert.ok(block[0].includes("text.value es requerido"), "value obligatorio");
  assert.ok(block[0].includes("slice(0, 5000)"), "value cap 5000");
  assert.ok(block[0].includes("#e8e2d4"), "default color igual que shared");
  assert.ok(block[0].includes("Inter, system-ui, sans-serif"), "default font igual que shared");
});

t("blend inválido lanza con la lista válida (add y update)", () => {
  const block = SRC.match(/case "photo_compose_add_layer":[\s\S]*?case "photo_compose_update_layer":/);
  const count = (block[0].match(/blend desconocido/g) || []).length;
  assert.equal(count, 1, "add valida blend una vez");
  const upd = SRC.match(/case "photo_compose_update_layer":[\s\S]*?case "photo_compose_delete_layer":/);
  assert.ok(upd && upd[0].includes("blend desconocido"), "update valida blend");
});

t("update dataUrl: debe ser data:image/* y ≤3MB", () => {
  const upd = SRC.match(/case "photo_compose_update_layer":[\s\S]*?case "photo_compose_delete_layer":/);
  assert.ok(upd[0].includes('startsWith("data:image/")'), "guard data:image/");
  assert.ok(upd[0].includes("excede 3MB"), "guard 3MB");
});

t("update adjust: clamps espejo de shared (0.2..3 / 0..3 / -180..180)", () => {
  const upd = SRC.match(/case "photo_compose_update_layer":[\s\S]*?case "photo_compose_delete_layer":/);
  assert.ok(upd[0].includes("composeClampNum(a.brightness, 0.2, 3, 1)"), "brightness clamp");
  assert.ok(upd[0].includes("composeClampNum(a.saturation, 0, 3, 1)"), "saturation clamp");
  assert.ok(upd[0].includes("composeClampNum(a.hue, -180, 180, 0)"), "hue clamp");
});

t("update text en capa paint rechaza", () => {
  const upd = SRC.match(/case "photo_compose_update_layer":[\s\S]*?case "photo_compose_delete_layer":/);
  assert.ok(upd[0].includes("la capa no es de texto"), "guard kind text");
});

t("mask: data:image/* + ≤3MB o clear:true", () => {
  const blk = SRC.match(/case "photo_compose_set_layer_mask":[\s\S]*?case "photo_compose_clear":/);
  assert.ok(blk, "handler mask no encontrado");
  assert.ok(blk[0].includes('startsWith("data:image/")'), "guard data:image/");
  assert.ok(blk[0].includes("delete cur.mask"), "clear borra mask");
});

t("clear sin confirm:true rechaza", () => {
  const blk = SRC.match(/case "photo_compose_clear":[\s\S]*?_note: "Pila vaciada/);
  assert.ok(blk[0].includes("confirm:true es requerido"), "guard confirm");
});

t("duplicate: nombre ' copia' + offset 0.002 + encima del origen", () => {
  const blk = SRC.match(/case "photo_compose_duplicate_layer":[\s\S]*?case "photo_compose_set_layer_mask":/);
  assert.ok(blk[0].includes(" copia`"), "nombre copia");
  assert.ok(blk[0].includes("+ 0.002"), "offset transform");
  assert.ok(blk[0].includes("splice(idx + 1, 0, copy)"), "inserta encima");
});

t("tope 12 capas también en add y duplicate", () => {
  const add = SRC.match(/case "photo_compose_add_layer":[\s\S]*?case "photo_compose_update_layer":/);
  const dup = SRC.match(/case "photo_compose_duplicate_layer":[\s\S]*?case "photo_compose_set_layer_mask":/);
  assert.ok(add[0].includes("MAX_COMPOSITION_LAYERS"), "add valida tope");
  assert.ok(dup[0].includes("MAX_COMPOSITION_LAYERS"), "duplicate valida tope");
});

t("resolvePhotoContext en los 8 (mismo targeting que el resto de photo_*)", () => {
  for (const name of TOOLS) {
    const start = SRC.indexOf(`case "${name}":`);
    assert.ok(start > 0, `handler ${name} no encontrado`);
    const next = SRC.indexOf('case "', start + 10);
    const blk = SRC.slice(start, next > start ? next : start + 4000);
    assert.ok(blk.includes("resolvePhotoContext"), `${name} no usa resolvePhotoContext`);
  }
});

// ── 4. Anti-scope: MCP compose es pura data, sin raster server-side ────
t("mcp.mjs NO importa sharp/onnxruntime (CF-safe)", () => {
  assert.ok(!/from\s+"sharp"|require\("sharp"\)/.test(SRC), "sharp no permitido en mcp.mjs");
  assert.ok(!/from\s+"onnxruntime-web"/.test(SRC), "onnxruntime-web no permitido en mcp.mjs");
});

// ── 5. Funcional: normalizeCompositionLayers (compartida con la UI) ────
// Node 24 hace strip-types nativo de .ts erasable (igual que las suites req-photo).
const shared = await import("../shared/photoComposition.ts");

t("normalize: capa fresca sin dataUrl pasa (persisted flag decide el drop)", () => {
  const out = shared.normalizeCompositionLayers([{ id: "a", name: "A", kind: "paint", dataUrl: "" }]);
  assert.equal(out.length, 1, "capa nueva sin dataUrl NO se descarta");
  const dropped = shared.normalizeCompositionLayers([{ id: "a", persisted: true, dataUrl: "" }]);
  assert.equal(dropped.length, 0, "capa persistida sin dataUrl SÍ se descarta");
});

t("normalize: clamps de adjust + identidad se descarta", () => {
  const [l] = shared.normalizeCompositionLayers([
    { id: "a", kind: "paint", dataUrl: "data:image/png;base64,AA", adjust: { brightness: 99, contrast: -5, saturation: 2, hue: 999 } },
  ]);
  assert.equal(l.adjust.brightness, 3);
  assert.equal(l.adjust.contrast, 0.2);
  assert.equal(l.adjust.saturation, 2);
  assert.equal(l.adjust.hue, 180);
  const [ident] = shared.normalizeCompositionLayers([
    { id: "b", kind: "paint", dataUrl: "data:image/png;base64,AA", adjust: { brightness: 1, contrast: 1, saturation: 1, hue: 0 } },
  ]);
  assert.equal(ident.adjust, undefined, "identidad = adjust absent");
});

t("normalize: transform clamps y texto vertical (F4.2e)", () => {
  const [l] = shared.normalizeCompositionLayers([
    { id: "c", kind: "text", dataUrl: "", text: { value: "hola", size: 9999, x: 5, y: -9, vertical: true } },
  ]);
  assert.equal(l.kind, "text");
  assert.equal(l.text.size, 800);
  assert.equal(l.text.x, 2);
  assert.equal(l.text.y, -1);
  assert.equal(l.text.vertical, true, "vertical persiste dentro de text");
});

t("COMPOSITION_BLENDS: 16 modos, normal primero", () => {
  assert.equal(shared.COMPOSITION_BLENDS.length, 16);
  assert.equal(shared.COMPOSITION_BLENDS[0], "normal");
  assert.ok(shared.COMPOSITION_BLENDS.includes("multiply") && shared.COMPOSITION_BLENDS.includes("screen"));
});

// ── resumen ─────────────────────────────────────────────────────────────
console.log(`\n${pass} pass / ${fail} fail\n`);
process.exit(fail ? 1 : 0);
