/**
 * Copy-recipes brand scope + the content calendar's CSV import.
 *
 * Two features where a silent wrong answer costs real work: the parser that
 * eats someone's prepared content, and the brand scope that could leak one
 * client's recipes onto another's posts. So: parser edge cases, the template
 * and export round-trips, and the presence of every wire the features need —
 * routes, UI and the v44 migration.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  IMPORT_COLUMNS, parseCsv, mapContentImport, toCSVExport, toImportTemplate,
} from "../src/lib/contentCalendar.ts";

const brands = [
  { id: "mi", name: "Mi marca" },
  { id: "musa", name: "Musa by Futuraria" },
  { id: "acme", name: "Acme" },
];

// ── parseCsv ──

test("parseCsv reads quoted fields, escaped quotes and CRLF", () => {
  const rows = parseCsv('a,"b""c",\r\n"d,\n e",f\r\n');
  assert.deepEqual(rows, [["a", 'b"c', ""], ["d,\n e", "f"]]);
});

test("parseCsv drops the Excel BOM and blank padding lines", () => {
  const rows = parseCsv("\uFEFFFecha,Hora\n\n2026-09-10,09:00\n");
  assert.deepEqual(rows, [["Fecha", "Hora"], ["2026-09-10", "09:00"]]);
});

// ── The template round-trips ──

test("the template's own headers parse back into IMPORT_COLUMNS", () => {
  const [header] = parseCsv(toImportTemplate());
  assert.deepEqual(header, [...IMPORT_COLUMNS]);
});

test("the template's worked example maps into a complete import body", () => {
  const parsed = mapContentImport(toImportTemplate(), brands);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.rows[0], {
    scheduled_date: "2026-09-10",
    scheduled_time: "09:00",
    kind: "organic",
    brand_id: "mi",
    campaign: "Lanzamiento",
    topic: "Idea del post",
    copy: "Aquí va el copy completo…",
    icp: "COO biotech",
    conversion_goal: "Agendar",
    visual_type: "timeline",
    channels: ["Instagram", "LinkedIn"],
    status: "idea",
  });
});

// ── mapContentImport judgment calls ──

test("matching is accent- and case-insensitive, times get zero-padded", () => {
  const csv = "Fecha,Hora,Tipo,Marca\n2026-09-10,9:05,Organico,MUSA BY FUTURARIA\n";
  const parsed = mapContentImport(csv, brands);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.rows[0].kind, "organic");
  assert.equal(parsed.rows[0].brand_id, "musa");
  assert.equal(parsed.rows[0].scheduled_time, "09:05");
});

test("an unknown brand warns and leaves the row brandless, never guessed", () => {
  const csv = "Fecha,Marca\n2026-09-10,Otra\n";
  const parsed = mapContentImport(csv, brands);
  assert.equal(parsed.rows[0].brand_id, undefined);
  assert.match(parsed.warnings[0], /«Otra» no existe/);
});

test("an unknown tipo warns and falls through to the organic default", () => {
  const csv = "Fecha,Tipo\n2026-09-10,Historia\n";
  const parsed = mapContentImport(csv, brands);
  assert.equal(parsed.rows[0].kind, undefined);
  assert.match(parsed.warnings[0], /«Historia» no reconocido/);
});

test("a row without a valid date is an error with its file line, not a silent drop", () => {
  const csv = "Fecha,Tema\n10/09/2026,Tarde\n";
  const parsed = mapContentImport(csv, brands);
  assert.deepEqual(parsed.rows, []);
  assert.match(parsed.errors[0], /Fila 2.*fecha inválida/);
});

test("unrecognizable headers point at the template instead of importing garbage", () => {
  const parsed = mapContentImport("Foo,Bar\n1,2\n", brands);
  assert.deepEqual(parsed.rows, []);
  assert.match(parsed.errors[0], /Encabezados no reconocidos/);
});

test("an empty file says so rather than importing nothing quietly", () => {
  assert.match(mapContentImport("", brands).errors[0], /vacío/);
});

// ── Export → edit → import round-trip ──

const exportedRow = (over = {}) => ({
  id: "c1", scheduled_date: "2026-09-10", kind: "ad", channels: ["Instagram"],
  status: "idea", brandName: "Acme", campaign: "Escolar", topic: "Lanzar",
  copy: "Copy con, comas", plan_spend: 600, ...over,
});

test("a real export re-imports through its own Spanish headers", () => {
  const parsed = mapContentImport(toCSVExport([exportedRow()]), brands);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.rows[0], {
    scheduled_date: "2026-09-10",
    kind: "ad",
    brand_id: "acme",
    campaign: "Escolar",
    topic: "Lanzar",
    copy: "Copy con, comas",
    channels: ["Instagram"],
    status: "idea",
    plan_spend: 600,
  });
});

test("report-only columns (AVANCE) are ignored on import, not misread", () => {
  const parsed = mapContentImport(toCSVExport([exportedRow({ actual_spend: 300 })]), brands);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows[0].avance_spend, undefined);
  assert.equal(parsed.rows[0].actual_spend, undefined);
});

// ── Presence: routes, UI and migration ──

test("the API exposes /import with the same validation as manual creates", () => {
  const routes = fs.readFileSync(new URL("../api/src/routes/contentCalendar.ts", import.meta.url), "utf8");
  assert.match(routes, /post\("\/import"/);
  assert.match(routes, /IMPORT_MAX_ROWS = 500/);
  assert.match(routes, /buildPatch\(row\)/, "imports go through the manual create's normalizer");
  assert.match(routes, /valid\.has\(item\.brand_id\)/, "brand ids re-verified against the workspace");
});

test("copy recipes take an optional brandId, scoped to the row's workspace", () => {
  const routes = fs.readFileSync(new URL("../api/src/routes/copyRecipes.ts", import.meta.url), "utf8");
  assert.ok((routes.match(/req\.body\.brandId/g) || []).length >= 2, "POST and PATCH both accept it");
  assert.match(routes, /from\("brands"\)/);
  assert.match(routes, /eq\("workspace_id", workspaceId\)/);
});

test("the sheet carries the template download, the import button and the merge", () => {
  const ui = fs.readFileSync(new URL("../src/components/ContentTab.tsx", import.meta.url), "utf8");
  assert.match(ui, />Plantilla<\/button>/);
  assert.match(ui, /⇧ Importar/);
  assert.match(ui, /toImportTemplate/);
  assert.match(ui, /mapContentImport/);
  assert.match(ui, /\/api\/content\/import/);
});

test("the recipes pane scopes by brand, General by default, defaults locked to General", () => {
  const ui = fs.readFileSync(new URL("../src/components/CopyRecipesTab.tsx", import.meta.url), "utf8");
  assert.match(ui, /Marca/);
  assert.match(ui, />General</);
  assert.match(ui, /workspaces\/\$\{workspaceId\}\/brands/);
  assert.match(ui, /brand_id\?/);
  assert.match(ui, /brandId: newBrandId \|\| null/);
});

test("v44 adds the brand scope plus the inert LRU columns to copy_recipes", () => {
  const sql = fs.readFileSync(new URL("../supabase_migrations_v44.sql", import.meta.url), "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS brand_id TEXT/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS usage_count INTEGER NOT NULL DEFAULT 0/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ/);
  assert.match(sql, /idx_copy_recipes_brand/);
});

test("every pane's control row carries the Conexiones gear via the actions slot", () => {
  const ui = fs.readFileSync(new URL("../src/components/ContentTab.tsx", import.meta.url), "utf8");
  assert.equal((ui.match(/actions=\{connControl\}/g) || []).length, 3,
    "biblioteca, recetas y bandeja montan el engrane en su propia fila, no en una fila suelta");
  const recipes = fs.readFileSync(new URL("../src/components/CopyRecipesTab.tsx", import.meta.url), "utf8");
  assert.match(recipes, /actions\?: React\.ReactNode/);
  assert.match(recipes, /className="ct-chip" onClick=\{load\}>⟳ Recargar/,
    "Recargar y el engrane comparten kit y altura");
  const texts = fs.readFileSync(new URL("../src/components/TextsTab.tsx", import.meta.url), "utf8");
  assert.match(texts, /actions\?: React\.ReactNode/);
  assert.ok(!texts.includes('lineHeight: "32px"'), "Expandir todo must share its row's height");
});
