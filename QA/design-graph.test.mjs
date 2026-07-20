import assert from "node:assert/strict";
import test from "node:test";
import { buildDesignGraphEdges } from "../api/src/services/designGraph.ts";
import { buildDesignHierarchy } from "../src/lib/designGraph.ts";

const design = (overrides) => ({
  id: overrides.id,
  name: overrides.name || overrides.id,
  brand: overrides.brand || "",
  campaign: overrides.campaign ?? null,
  tags: overrides.tags || [],
  theme: "",
  format: "social",
  file_type: "design",
  cover: null,
  obsidian_link: "",
});

test("builds brand → campaign → design branches with campaign-less designs directly under brand", () => {
  const hierarchy = buildDesignHierarchy([
    design({ id: "direct", name: "Diseño directo", brand: "Futuraria" }),
    design({ id: "launch-2", name: "Pieza 2", brand: " futuraria ", campaign: "Lanzamiento" }),
    design({ id: "launch-1", name: "Pieza 1", brand: "FUTURARIA", campaign: " lanzamiento " }),
    design({ id: "other", name: "Sin clasificar", brand: "" }),
  ]);

  assert.equal(hierarchy.length, 2);
  const futuraria = hierarchy.find((brand) => brand.name === "Futuraria");
  assert.ok(futuraria);
  assert.deepEqual(futuraria.directDesigns.map((item) => item.id), ["direct"]);
  assert.equal(futuraria.campaigns.length, 1);
  assert.equal(futuraria.campaigns[0].name, "Lanzamiento");
  assert.deepEqual(futuraria.campaigns[0].designs.map((item) => item.id), ["launch-1", "launch-2"]);
  assert.equal(futuraria.totalDesigns, 3);

  const unbranded = hierarchy.find((brand) => brand.name === "Sin marca");
  assert.deepEqual(unbranded.directDesigns.map((item) => item.id), ["other"]);
  assert.equal(unbranded.campaigns.length, 0);
});

test("creates graph connections for shared brands, brand-scoped campaigns, and tags", () => {
  const nodes = [
    design({ id: "a", brand: "Acme", campaign: "Launch", tags: ["premium", "premium"] }),
    design({ id: "b", brand: "acme", campaign: "launch", tags: ["premium"] }),
    design({ id: "c", brand: "Acme", campaign: "Always on" }),
    design({ id: "d", brand: "Other", campaign: "Launch", tags: ["premium"] }),
  ];
  const edges = buildDesignGraphEdges(nodes);

  assert.equal(edges.filter((edge) => edge.kind === "brand").length, 3);
  assert.deepEqual(edges.filter((edge) => edge.kind === "campaign"), [
    { source: "a", target: "b", kind: "campaign" },
  ]);
  assert.equal(edges.filter((edge) => edge.kind === "tag").length, 3);
  assert.equal(edges.some((edge) => edge.kind === "campaign" && edge.target === "d"), false);
});
