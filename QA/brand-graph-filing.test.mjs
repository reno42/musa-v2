/**
 * Filing rules behind the "Red de Marcas → Tabla" columns.
 *
 * Both functions used to be inline in buildBrandGraph, where the Supabase
 * dependency made them untestable, and both were why edits in the table did
 * nothing visible: the brand cell wrote loose text that ownership ignored, and
 * the category cell had no branch to move a file into.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveTemplateOwners,
  bucketByCategory,
  ARCHIVOS,
  DESIGN_SYSTEM,
  PLANTILLAS,
  ASSETS,
} from "../api/src/services/brandFiling.ts";

const brands = [
  { id: "brand_a", name: "Futuraria" },
  { id: "brand_b", name: "Acelera" },
];

test("brand_id decides ownership even when the free-text brand disagrees", () => {
  const meta = new Map([
    ["tpl_1", { brand_id: "brand_a", brand: "Acelera" }],
  ]);
  const owners = resolveTemplateOwners(["tpl_1"], brands, meta);
  assert.equal(owners.get("tpl_1"), "brand_a");
  // One owner, never two: a second entry is the duplicate `tpl:<id>` node that
  // collapsed the canvas and doubled the table's rows.
  assert.equal(owners.size, 1);
});

test("the free-text brand still files a row that has no brand_id", () => {
  const meta = new Map([
    ["tpl_2", { brand_id: null, brand: "  aCeLeRa " }],
  ]);
  assert.equal(resolveTemplateOwners(["tpl_2"], brands, meta).get("tpl_2"), "brand_b");
});

test("a brand nobody knows leaves the file unowned, so it orbits as an orphan", () => {
  const meta = new Map([
    ["tpl_3", { brand_id: null, brand: "Marca fantasma" }],
    ["tpl_4", { brand_id: "brand_borrado", brand: "" }],
  ]);
  const owners = resolveTemplateOwners(["tpl_3", "tpl_4", "tpl_sin_meta"], brands, meta);
  assert.equal(owners.size, 0);
});

test("files land in the category they were filed under", () => {
  const templates = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const meta = new Map([
    ["a", { category: DESIGN_SYSTEM }],
    ["b", { category: PLANTILLAS }],
    ["c", { category: ASSETS }],
    ["d", { category: ARCHIVOS }],
  ]);
  const filed = bucketByCategory(templates, meta);
  assert.deepEqual(filed.get(DESIGN_SYSTEM).map(t => t.id), ["a"]);
  assert.deepEqual(filed.get(PLANTILLAS).map(t => t.id), ["b"]);
  assert.deepEqual(filed.get(ASSETS).map(t => t.id), ["c"]);
  assert.deepEqual(filed.get(ARCHIVOS).map(t => t.id), ["d"]);
});

test("rows written before v21 — no category at all — stay Archivos", () => {
  const filed = bucketByCategory(
    [{ id: "legacy" }, { id: "null_cat" }, { id: "junk" }],
    new Map([["null_cat", { category: null }], ["junk", { category: "Inventada" }]]),
  );
  assert.deepEqual(filed.get(ARCHIVOS).map(t => t.id), ["legacy", "null_cat", "junk"]);
  assert.equal(filed.get(DESIGN_SYSTEM).length, 0);
});

test("every branch exists even when empty, so callers can index without guarding", () => {
  const filed = bucketByCategory([], new Map());
  for (const label of [DESIGN_SYSTEM, PLANTILLAS, ASSETS, ARCHIVOS]) {
    assert.deepEqual(filed.get(label), []);
  }
});
