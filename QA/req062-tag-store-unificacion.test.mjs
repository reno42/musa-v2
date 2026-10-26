/**
 * REQ-062 — Tags y filing de marca: un solo store + operaciones bulk.
 *
 * El bug de diseño: tag_template escribía el mirror templates.data.tags
 * (sin consumidores) mientras find_templates, get_file_meta y el design
 * graph leen design_file_meta — tags escritos por MCP invisibles y marcas
 * sin asignar. Más N archivos = N llamadas sin tools bulk.
 *
 * Cubre (slicing de fuente, patrón QA/req061 + puros compartidos):
 *   - F1: tag_template/untag_template operan sobre design_file_meta.tags;
 *     sin mirror al template, sin autoSnapshot, sin escritura de brand.
 *   - F2: scripts/backfill-design-file-meta-tags.sql idempotente, lee el
 *     mirror desde templates.data->'tags' (templates NO tiene columna tags).
 *   - F3: set_files_meta / tag_templates (cap 500, chunks, failed granular,
 *     set_file_meta refactorizado al mismo contrato).
 *
 * Run: node --experimental-strip-types --test QA/req062-tag-store-unificacion.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeTagList, normalizeTagInput, applyTagAliases } from "../shared/tagNormalize.ts";

const mcpSource = readFileSync(new URL("../worker/runtime/functions/mcp.mjs", import.meta.url), "utf8");
const backfillSource = readFileSync(new URL("../scripts/backfill-design-file-meta-tags.sql", import.meta.url), "utf8");

/** Cuerpo de un case del dispatch (del `case "x": {` al siguiente case). */
function caseSource(caseName) {
  const start = mcpSource.indexOf(`case "${caseName}": {`);
  assert.ok(start !== -1, `case ${caseName} no encontrado`);
  const next = mcpSource.indexOf("\n    case \"", start + 1);
  return mcpSource.slice(start, next === -1 ? mcpSource.length : next);
}

// ── F1: un store de tags ────────────────────────────────────

test("F1 tag_template: escribe design_file_meta (upsert onConflict template_id) con merge", () => {
  const src = caseSource("tag_template");
  assert.match(src, /from\("design_file_meta"\)/);
  assert.match(src, /\.upsert\(\{[\s\S]*template_id: params\.templateId[\s\S]*\}, \{ onConflict: "template_id" \}\)/);
  // Merge sin duplicados sobre los tags existentes del meta.
  assert.match(src, /Array\.isArray\(meta\?\.tags\)/);
  assert.match(src, /merged\.includes\(tag\)/);
  // Resuelve workspace como set_file_meta (select workspace_id del template).
  assert.match(src, /from\("templates"\)\.select\("workspace_id"\)/);
});

test("F1 tag_template: sin mirror al template, sin autoSnapshot, sin brand", () => {
  const src = caseSource("tag_template");
  assert.ok(!/templates\.getTemplate|updateTemplate\(/.test(src), "no debe mutar la fila del template");
  assert.ok(!src.includes("autoSnapshot"), "taggear es metadata, no contenido — sin snapshot");
  // Semántica explícita: tags NO asignan marca en el graph.
  assert.ok(!/from\("brands"\)|brand_id/.test(src), "tags no escriben brand");
});

test("F1 untag_template: remueve del meta; find_templates deja de matchear", () => {
  const src = caseSource("untag_template");
  assert.match(src, /from\("design_file_meta"\)/);
  assert.match(src, /\.update\(\{ tags: kept/);
  assert.match(src, /existing\.filter\(t => !wanted\.has\(t\)\)/);
  assert.ok(!/templates\.getTemplate|updateTemplate\(|autoSnapshot/.test(src));
});

test("F1 repro: tag_template y find_templates leen el MISMO store", () => {
  // El bug: tag escribía templates.data.tags, find consultaba design_file_meta.
  const find = caseSource("find_templates");
  assert.match(find, /from\("design_file_meta"\)/);
  assert.match(find, /\.contains\("tags"/);
  const tag = caseSource("tag_template");
  assert.ok(tag.includes('from("design_file_meta")'));
});

test("F1 descriptions: dejan de inducir al error (tags ≠ brand filing)", () => {
  assert.match(mcpSource, /name: "tag_template",\s*\n\s*description: "[^"]*design_file_meta\.tags[^"]*NOT brand filing[^"]*set_file_meta\(\{brand\}\) or set_files_meta\(\{brand\}\)[^"]*"/);
  assert.match(mcpSource, /name: "untag_template",\s*\n\s*description: "[^"]*design_file_meta\.tags[^"]*find_templates\(\{tags:\[\.\.\.\]\}\)[^"]*"/);
});

// ── F2: backfill idempotente ────────────────────────────────

test("F2 backfill: lee el mirror desde data->'tags' (templates no tiene columna tags)", () => {
  assert.match(backfillSource, /jsonb_typeof\(t\.data -> 'tags'\) = 'array'/);
  assert.match(backfillSource, /jsonb_array_elements_text\(t\.data -> 'tags'\)/);
  // El sketch del REQ asumía t.tags columna — el repo demostró que vive en data.
  assert.ok(!/\bt\.tags\b/.test(backfillSource), "no debe referenciar una columna tags inexistente");
});

test("F2 backfill: idempotente, no pisa meta con tags, respeta soft-delete", () => {
  assert.match(backfillSource, /on conflict \(template_id\) do nothing/);
  // Paso 2 solo rellena filas con tags vacío.
  assert.match(backfillSource, /coalesce\(array_length\(m\.tags, 1\), 0\) = 0/);
  assert.match(backfillSource, /deleted_at is null/);
  // Verificación final esperada: 0 pendientes.
  assert.match(backfillSource, /count\(\*\) as pendientes/);
  // Dry-run antes de los pasos.
  assert.match(backfillSource, /count\(\*\) as templates_to_backfill/);
});

// ── F3: bulk ────────────────────────────────────────────────

test("F3 set_files_meta: cap 500, patch guard y pipeline bulk", () => {
  const src = caseSource("set_files_meta");
  assert.match(src, /PATCH_KEYS\.some\(k => params\[k\] !== undefined\)/);
  assert.match(src, /bulkResolveTemplates\(sbBulk, params\.templateIds, failed\)/);
  assert.match(src, /resolveFileMetaPatch\(sbBulk, wsId, params\)/);
  assert.match(src, /bulkUpsertFileMeta\(sbBulk, rows, failed\)/);
  assert.match(src, /success: failed\.length === 0, applied, failed, total: ids\.length/);
});

test("F3 tag_templates: merge/remove sobre meta con alias por workspace", () => {
  const src = caseSource("tag_templates");
  assert.match(src, /normalizeTagList\(params\.tags\)/);
  assert.match(src, /remove = params\.remove === true/);
  assert.match(src, /from\("design_file_meta"\)\.select\("template_id, tags"\)\.in\("template_id", allIds\)/);
  assert.match(src, /applyTagAliases\(wanted, aliasMap\)/);
  // Merge sin duplicados / remoción exacta; no-ops cuentan como unchanged.
  assert.match(src, /next\.includes\(t\)/);
  assert.match(src, /existing\.filter\(t => !effSet\.has\(t\)\)/);
  assert.match(src, /unchanged\+\+/);
  assert.match(src, /success: failed\.length === 0, applied, unchanged, failed, total: ids\.length/);
});

test("F3 bulkUpsertFileMeta: chunks de 100 con aislamiento por fila", () => {
  const start = mcpSource.indexOf("async function bulkUpsertFileMeta");
  const src = mcpSource.slice(start, mcpSource.indexOf("\n}", start));
  assert.match(src, /const CHUNK = 100/);
  assert.match(src, /\.upsert\(chunk, \{ onConflict: "template_id" \}\)/);
  // Fallo de chunk → reintento fila por fila para failed granular.
  assert.match(src, /failed\.push\(\{ templateId: row\.template_id, error: rowErr\.message \}\)/);
});

test("F3 bulkResolveTemplates: 1 query para N ids, dedupe, cap 500", () => {
  const start = mcpSource.indexOf("async function bulkResolveTemplates");
  const src = mcpSource.slice(start, mcpSource.indexOf("\n}", start));
  assert.match(src, /new Set\(\(Array\.isArray\(templateIds\)/);
  assert.match(src, /500-per-call cap/);
  assert.match(src, /\.in\("id", ids\)/);
  assert.match(src, /"Template not found"/);
  // Agrupa por workspace: registry/alias se resuelven UNA vez por workspace.
  assert.match(src, /groups\.set\(wsId, \[\]\)/);
});

test("F3 set_file_meta refactorizado al contrato compartido (no drift)", () => {
  const src = caseSource("set_file_meta");
  assert.match(src, /resolveFileMetaPatch\(sbSet, wsId, params\)/);
  // El insert/update conserva el upsert semántico sobre design_file_meta.
  assert.match(src, /from\("design_file_meta"\)/);
});

test("F3 defs en tools/list: set_files_meta y tag_templates documentadas", () => {
  assert.match(mcpSource, /name: "set_files_meta",\s*\n\s*description: "[^"]*cap 500[^"]*same per-file contract as set_file_meta[^"]*"/i);
  assert.match(mcpSource, /name: "set_files_meta"[\s\S]*?required: \["workspaceId", "templateIds"\]/);
  assert.match(mcpSource, /name: "tag_templates",\s*\n\s*description: "[^"]*design_file_meta\.tags[^"]*NOT brand filing[^"]*set_files_meta\(\{brand\}\)[^"]*"/);
  assert.match(mcpSource, /name: "tag_templates"[\s\S]*?required: \["templateIds", "tags"\]/);
});

// ── Semántica pura compartida (single y bulk usan lo mismo) ──

test("normalizeTagList: lowercase, trim, collapse, <=60 chars, dedupe, cap 50", () => {
  assert.deepEqual(
    normalizeTagList(["  TEMA:Navidad  ", "tema:navidad", "x".repeat(61), " ok "]),
    ["tema:navidad", "ok"],
  );
  assert.equal(normalizeTagList("no-array").length, 0);
  assert.equal(normalizeTagInput(null), null);
});

test("applyTagAliases: sustitución 1:1 sobre entrada ya normalizada", () => {
  // La sustitución no normaliza ni dedupe por sí sola: los helpers de
  // escritura llaman normalizeTagList PRIMERO y dedupe DESPUÉS de mapear.
  const map = { navidad: "tema:navidad", xmas: "tema:navidad" };
  assert.deepEqual(applyTagAliases(["navidad", "otro"], map), ["tema:navidad", "otro"]);
  assert.deepEqual(applyTagAliases(["navidad", "xmas"], map), ["tema:navidad", "tema:navidad"]);
});

test("resolveTagAliasesForWrite: dedupe DESPUÉS de sustituir alias (el REPLACE no puede guardar duplicados)", () => {
  assert.match(mcpSource, /return \[\.\.\.new Set\(applyTagAliases\(normalized, buildAliasMap\(/);
  assert.match(mcpSource, /if \(!sb \|\| !wsId \|\| !normalized\.length\) return \[\.\.\.new Set\(normalized\)\];/);
});
