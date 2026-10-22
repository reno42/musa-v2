import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const serviceSource = readFileSync(new URL("../api/src/services/brands.ts", import.meta.url), "utf8");
const pureHelperSource = serviceSource.slice(
  serviceSource.indexOf("export type BrandInput"),
  serviceSource.indexOf("function rowToBrand"),
);
const helperModule = await import(`data:text/javascript;base64,${Buffer.from(
  stripTypeScriptTypes(pureHelperSource, { mode: "transform" }),
).toString("base64")}`);
const {
  StyleInvariantError,
  cleanStyleName,
  hasSubstantiveStyleArtifacts,
  normalizeSourceTemplateIds,
  styleNameIdentity,
  templateHasStyleMaterial,
  validateBrandState,
} = helperModule;

const workspaceId = "ws_owner";
const materialTemplate = {
  id: "tpl_material",
  workspaceId,
  name: "Reference",
  frames: [{ id: "frame_1", name: "Frame", html: "<main>Reference</main>", css: ".root { color: red; }" }],
  canvas: null,
  styles: [], comments: [], versions: [], variables: {}, components: [],
  metadata: { createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
};

test("style name identity trims, collapses whitespace, and ignores case", () => {
  assert.equal(cleanStyleName("  Futuraria   Social\n Media  "), "Futuraria Social Media");
  assert.equal(styleNameIdentity("  FUTURARIA   Social Media "), "futuraria social media");
  assert.equal(styleNameIdentity("\tFuturaria\n\tSocial  "), styleNameIdentity("Futuraria Social"));
  assert.equal(styleNameIdentity("Futuraria"), "futuraria");
  assert.notEqual(styleNameIdentity("Futuraria"), styleNameIdentity("Futuraria_SocialMedia"));
});

test("source template IDs are trimmed, deduplicated, and empty IDs are removed", () => {
  assert.deepEqual(normalizeSourceTemplateIds([" tpl_a ", "tpl_a", "", null, "tpl_b"]), ["tpl_a", "tpl_b"]);
});

test("blank artifacts are not substantive", () => {
  assert.equal(hasSubstantiveStyleArtifacts({ tokensJson: "{}", designMd: "  ", sharedCss: "/* only comment */" }), false);
  assert.equal(hasSubstantiveStyleArtifacts({ sharedCss: ":root { --brand: #fff; }" }), true);
});

test("template material requires actual HTML, CSS, or canvas objects", () => {
  assert.equal(templateHasStyleMaterial(materialTemplate), true);
  assert.equal(templateHasStyleMaterial({ ...materialTemplate, frames: [{ id: "f", name: "Empty", html: "", css: "" }] }), false);
  assert.equal(templateHasStyleMaterial({ ...materialTemplate, frames: [], canvas: { objects: [{ type: "rect" }] } }), true);
});

test("valid final style state is normalized and preserves a real reference", async () => {
  const result = await validateBrandState({
    id: "brand_1",
    workspaceId,
    name: "  Futuraria   Social ",
    sharedCss: ":root { --brand: #fff; }",
    sourceTemplateIds: ["tpl_material", "tpl_material"],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  }, async id => id === materialTemplate.id ? materialTemplate : null);
  assert.equal(result.name, "Futuraria Social");
  assert.deepEqual(result.sourceTemplateIds, ["tpl_material"]);
});

for (const [name, value, resolver, expected] of [
  ["missing refs", { workspaceId, name: "Style", sharedCss: ".x{}", sourceTemplateIds: [] }, async () => materialTemplate, /at least one source template/],
  ["blank artifacts", { workspaceId, name: "Style", tokensJson: "{}", sourceTemplateIds: ["tpl_material"] }, async () => materialTemplate, /substantive/],
  ["missing source", { workspaceId, name: "Style", sharedCss: ".x{color:red}", sourceTemplateIds: ["tpl_missing"] }, async () => null, /not found/],
  ["cross-workspace source", { workspaceId, name: "Style", sharedCss: ".x{color:red}", sourceTemplateIds: ["tpl_other"] }, async () => ({ ...materialTemplate, id: "tpl_other", workspaceId: "ws_other" }), /another workspace/],
  ["empty source", { workspaceId, name: "Style", sharedCss: ".x{color:red}", sourceTemplateIds: ["tpl_empty"] }, async () => ({ ...materialTemplate, id: "tpl_empty", frames: [] }), /no usable design material/],
]) {
  test(`final state rejects ${name}`, async () => {
    await assert.rejects(validateBrandState(value, resolver), error => {
      assert.ok(error instanceof StyleInvariantError);
      assert.match(error.message, expected);
      return true;
    });
  });
}

const mcpSource = readFileSync(new URL("../worker/runtime/functions/mcp.mjs", import.meta.url), "utf8");
const chatSource = readFileSync(new URL("../src/components/ChatFAB.tsx", import.meta.url), "utf8");
const migrationSource = readFileSync(new URL("../supabase_migrations_v18.sql", import.meta.url), "utf8");

test("MCP schemas require workspace and non-empty style sources", () => {
  const createSchema = mcpSource.slice(mcpSource.indexOf('name: "create_brand_guideline"'), mcpSource.indexOf('name: "get_brand_guideline"'));
  // Creation no longer requires source templates (they are optional there and
  // normalized away when empty); the update path still enforces non-empty IDs.
  assert.match(createSchema, /required:\s*\["workspaceId",\s*"name"\]/);
  assert.match(createSchema, /sourceTemplateIds:\s*\{[^}]*uniqueItems:\s*true/s);
  const updateSchema = mcpSource.slice(mcpSource.indexOf('name: "update_brand_guideline"'), mcpSource.indexOf('name: "delete_brand_guideline"'));
  assert.match(updateSchema, /required:\s*\["workspaceId",\s*"brandId"\]/);
  assert.match(updateSchema, /sourceTemplateIds:\s*\{[^}]*minItems:\s*1/s);
});

test("brand-only MCP operations resolve brand tenancy before dispatch", () => {
  assert.match(mcpSource, /const STYLE_LIBRARY_METHODS = new Set/);
  assert.match(mcpSource, /targetBrandId/);
  assert.match(mcpSource, /sourceBrandIds/);
  assert.match(mcpSource, /Style belongs to another workspace/);
  assert.match(mcpSource, /requireStyleInWorkspace\(params\.brandId, workspaceId\)/);
});

test("service writes to Supabase before mutating the fallback cache", () => {
  const create = serviceSource.slice(serviceSource.indexOf("export async function createBrand"), serviceSource.indexOf("export async function getBrand"));
  assert.ok(create.indexOf('.insert(brandRow(candidate))') < create.indexOf("memoryStore.set(saved.id, saved)"));
  const update = serviceSource.slice(serviceSource.indexOf("export async function updateBrand"), serviceSource.indexOf("export async function deleteBrand"));
  assert.ok(update.indexOf('.update({ name: candidate.name') < update.indexOf("memoryStore.set(saved.id, saved)"));
  const remove = serviceSource.slice(serviceSource.indexOf("export async function deleteBrand"));
  // Deletion is a soft-delete now, so the cache mutation marks deletedAt instead
  // of dropping the entry; the ordering (Supabase first) is still the invariant.
  assert.ok(remove.indexOf('throw persistenceError("delete", error)') < remove.indexOf("memoryStore.set(cached.id, cached)"));
  assert.match(serviceSource, /error\?\.code === "23505"/);
});

test("ChatFAB exposes the real style fields and exact-match instructions", () => {
  const tools = chatSource.slice(chatSource.indexOf('name: "create_brand_guideline"'), chatSource.indexOf('name: "download_style_template"'));
  assert.match(tools, /sourceTemplateIds/);
  assert.match(tools, /tokensJson/);
  assert.doesNotMatch(tools, /colors:\s*\{ type: "object" \}/);
  assert.doesNotMatch(tools, /anyOf:/);
  assert.match(chatSource, /match EXACTO por identidad canónica/);
  assert.match(chatSource, /get_brand_guideline\(\{workspaceId, brandId\}\)/);
  assert.match(chatSource, /nunca crees un estilo solo con nombre/);
});

test("list_brand_guidelines is compact by default and artifacts are opt-in", () => {
  const listSchema = mcpSource.slice(mcpSource.indexOf('name: "list_brand_guidelines"'), mcpSource.indexOf('name: "update_brand_guideline"'));
  assert.match(listSchema, /includeArtifacts/);
  const listHandler = mcpSource.slice(mcpSource.indexOf('case "list_brand_guidelines"'), mcpSource.indexOf('case "update_brand_guideline"'));
  assert.match(listHandler, /params\.includeArtifacts === true/);
  assert.match(listHandler, /\.\.\.\(includeArtifacts \? \{/);
  assert.match(listHandler, /artifactPreview/);
});

test("v18 cleans legacy rows and enforces DB-level invariants and tenancy", () => {
  assert.match(migrationSource, /style_v18_duplicate_map/);
  assert.match(migrationSource, /style_v18_invalid_ids/);
  assert.match(migrationSource, /uq_brand_guidelines_workspace_normalized_name/);
  assert.match(migrationSource, /ALTER COLUMN workspace_id SET NOT NULL/);
  assert.match(migrationSource, /brand_guidelines_source_refs_nonempty/);
  assert.match(migrationSource, /brand_guidelines_artifact_nonempty/);
  assert.match(migrationSource, /CREATE TRIGGER trg_validate_brand_guideline/);
  assert.match(migrationSource, /CREATE TRIGGER trg_remove_template_style_reference/);
  assert.match(migrationSource, /CREATE TRIGGER trg_remove_soft_deleted_template_style_reference/);
  assert.match(migrationSource, /has_workspace_role\(workspace_id, 'viewer'\)/);
  assert.match(migrationSource, /has_workspace_role\(workspace_id, 'editor'\)/);
  assert.match(migrationSource, /template\.data->>'brandId' = duplicate_map\.id/);
});

test("v18 uses one SQL name identity for cleanup, partition, index, and trigger", () => {
  assert.match(migrationSource, /CREATE OR REPLACE FUNCTION style_clean_name/);
  assert.match(migrationSource, /btrim\(regexp_replace\(COALESCE\(input_name, ''\), '\[\[:space:\]\]\+'/);
  assert.match(migrationSource, /CREATE OR REPLACE FUNCTION style_canonical_name/);
  assert.match(migrationSource, /SET name = style_clean_name\(name\)/);
  assert.match(migrationSource, /PARTITION BY bg\.workspace_id, style_canonical_name\(bg\.name\)/);
  assert.match(migrationSource, /style_canonical_name\(name\)/);
  assert.match(migrationSource, /NEW\.name := style_clean_name\(NEW\.name\)/);
});

test("v18 rejects comment-only material and cleans brand links on delete", () => {
  assert.match(migrationSource, /CREATE OR REPLACE FUNCTION style_meaningful_text/);
  assert.match(migrationSource, /style_meaningful_text\(template_data->>'css'\)/);
  assert.match(migrationSource, /WHERE style_meaningful_text\(artifact\.value\)/);
  assert.match(migrationSource, /CREATE TRIGGER trg_cleanup_deleted_brand_guideline/);
  const cleanup = migrationSource.slice(migrationSource.indexOf("CREATE OR REPLACE FUNCTION cleanup_deleted_brand_guideline"), migrationSource.indexOf("CREATE TRIGGER trg_cleanup_deleted_brand_guideline"));
  assert.match(cleanup, /SET data = data - 'brandId'/);
  assert.doesNotMatch(cleanup, /designArtifacts/);
  assert.match(cleanup, /\{metadata,styleLocks\}/);
});

test("publish reports canonical name updates without calling them fingerprint merges", () => {
  const publish = mcpSource.slice(mcpSource.indexOf("var updatedExisting = false"), mcpSource.indexOf("// default: generate"));
  assert.match(publish, /updatedExisting: updatedExisting/);
  assert.match(publish, /autoMerged: updatedExisting/);
  assert.match(publish, /not a fingerprint merge/);
});
