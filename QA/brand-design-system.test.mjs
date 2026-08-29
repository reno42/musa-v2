import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

// ═══════════════════════════════════════════════════════════════
// One brand = ONE Design System file (v35): the CRM link rides on the
// normalized state (crmBrandId), the DB row maps crm_brand_id both ways,
// and the graph/playbook expose hasDesignSystem so any AI notices a brand
// still missing its DS file.
// ═══════════════════════════════════════════════════════════════

const serviceSource = readFileSync(new URL("../api/src/services/brands.ts", import.meta.url), "utf8");

function loadSlice(startMarker, endMarker, exportName) {
  const slice = serviceSource.slice(
    serviceSource.indexOf(startMarker),
    endMarker ? serviceSource.indexOf(endMarker) : undefined,
  );
  // Non-exported declarations need an explicit export to cross the module boundary.
  const source = exportName ? `${slice}\nexport { ${exportName} };` : slice;
  return import(`data:text/javascript;base64,${Buffer.from(
    stripTypeScriptTypes(source, { mode: "transform" }),
  ).toString("base64")}`);
}

const helpers = await loadSlice("export type BrandInput", "function rowToBrand");
const rowModule = await loadSlice("function rowToBrand", "function isUniqueViolation", "rowToBrand");
const { validateBrandState } = helpers;
const { rowToBrand } = rowModule;

test("normalized brand state carries the CRM link (crmBrandId)", async () => {
  const result = await validateBrandState({
    id: "brand_1",
    workspaceId: "ws_owner",
    name: "Acme",
    crmBrandId: "brand_crm_123",
    sourceTemplateIds: [],
  }, async () => null, { allowEmptySources: true });
  assert.equal(result.crmBrandId, "brand_crm_123");
});

test("crmBrandId is optional — legacy rows keep validating", async () => {
  const result = await validateBrandState({
    id: "brand_2",
    workspaceId: "ws_owner",
    name: "Acme",
    tokensJson: '{"color": {"accent": {"$value": "#7B2FF7"}}}',
  }, async () => null, { allowEmptySources: true });
  assert.equal(result.crmBrandId, undefined);
});

test("rowToBrand maps the crm_brand_id column and falls back to the JSONB copy", () => {
  const column = rowToBrand({
    id: "brand_1",
    workspace_id: "ws_owner",
    name: "Acme",
    data: { id: "brand_1", workspaceId: "ws_owner", name: "Acme" },
    crm_brand_id: "brand_crm_123",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  });
  assert.equal(column.crmBrandId, "brand_crm_123");

  const jsonb = rowToBrand({
    id: "brand_2",
    workspace_id: "ws_owner",
    name: "Beta",
    data: { id: "brand_2", workspaceId: "ws_owner", name: "Beta", crmBrandId: "brand_crm_456" },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  });
  assert.equal(jsonb.crmBrandId, "brand_crm_456");
});

test("rowToBrand keeps empty CRM links as null instead of undefined", () => {
  const row = rowToBrand({
    id: "brand_3",
    workspace_id: "ws_owner",
    name: "Gamma",
    data: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  });
  assert.equal(row.crmBrandId, null);
});

test("brandGraph exposes hasDesignSystem so a missing DS file is visible", () => {
  const graphSource = readFileSync(new URL("../api/src/services/brandGraph.ts", import.meta.url), "utf8");
  assert.match(graphSource, /hasDesignSystem/);
  // The playbook must tell the AI what to do when the DS is missing.
  assert.match(graphSource, /nextAction/);
  assert.match(graphSource, /create_brand_guideline/);
});
