import assert from "node:assert/strict";
import test from "node:test";
import { buildDesignGraphEdges } from "../api/src/services/designGraph.ts";
import { buildDesignHierarchy, buildKnowledgeGraph, normalizeAssetType } from "../src/lib/designGraph.ts";

const design = (overrides) => ({
  id: overrides.id,
  name: overrides.name || overrides.id,
  brand: overrides.brand || "",
  campaign: overrides.campaign ?? null,
  tags: overrides.tags || [],
  theme: "",
  format: overrides.format || "social",
  file_type: "design",
  cover: null,
  obsidian_link: "",
  brand_id: overrides.brand_id || null,
  campaign_id: overrides.campaign_id || null,
  asset_type: overrides.asset_type || null,
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

test("builds commercial accounts with stakeholders and ordered asset branches", () => {
  const hierarchy = buildDesignHierarchy([
    design({ id: "web", brand_id: "brand-acme", brand: "Acme", campaign: "Launch", format: "web" }),
    design({ id: "kv", brand_id: "brand-acme", brand: "Acme", campaign: "Launch", asset_type: "key_visual" }),
    design({ id: "social", brand_id: "brand-acme", brand: "Acme", format: "social" }),
  ], [
    { id: "brand-acme", name: "Acme", relationship_status: "lead" },
    { id: "brand-client", name: "Cliente sin diseños", relationship_status: "client" },
  ], [
    { id: "person-1", brand_id: "brand-acme", first_name: "Ada", last_name: "Lovelace", status: "active" },
  ]);

  const acme = hierarchy.find((brand) => brand.id === "brand-acme");
  assert.equal(acme.relationshipStatus, "lead", "an explicit brand status wins over contact status");
  assert.equal(acme.people.length, 1);
  assert.deepEqual(acme.directAssetGroups.map((group) => group.type), ["social_media"]);
  assert.deepEqual(acme.campaigns[0].assetGroups.map((group) => group.type), ["key_visual", "web"]);
  assert.equal(hierarchy.some((brand) => brand.id === "brand-client" && brand.totalDesigns === 0), true);
});

test("builds workspace → relationship → brand → campaign → asset → file graph and optionally people", () => {
  const hierarchy = buildDesignHierarchy([
    design({ id: "file-1", brand_id: "brand-1", brand: "Acme", campaign: "Launch", asset_type: "mailing" }),
  ], [
    { id: "brand-1", name: "Acme", relationship_status: "client" },
  ], [
    { id: "person-1", brand_id: "brand-1", first_name: "Grace", last_name: "Hopper" },
  ]);

  const withPeople = buildKnowledgeGraph({ id: "ws-1", name: "Mi agencia" }, hierarchy, true);
  assert.equal(withPeople.nodes.some((node) => node.id === "workspace:ws-1" && node.name === "Mi agencia"), true);
  assert.equal(withPeople.nodes.some((node) => node.id === "status:client"), true);
  assert.equal(withPeople.nodes.some((node) => node.kind === "person"), true);
  assert.equal(withPeople.nodes.some((node) => node.kind === "asset_type" && node.name === "Mailing"), true);
  assert.equal(withPeople.nodes.some((node) => node.kind === "design" && node.templateId === "file-1"), true);

  const withoutPeople = buildKnowledgeGraph({ id: "ws-1", name: "Mi agencia" }, hierarchy, false);
  assert.equal(withoutPeople.nodes.some((node) => node.kind === "person"), false);
});

test("normalizes legacy formats into the four commercial asset categories", () => {
  assert.equal(normalizeAssetType(null, "social"), "social_media");
  assert.equal(normalizeAssetType(null, "email"), "mailing");
  assert.equal(normalizeAssetType(null, "mobile"), "web");
  assert.equal(normalizeAssetType("KV", ""), "key_visual");
});
