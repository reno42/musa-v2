/**
 * Campaigns are optional, and the graph has to say so by its shape.
 *
 * The point is not tidiness: seeing that some files sit under a campaign and
 * others hang loose is what tells a person there is something to organise.
 * A manufactured "Sin campaña" node erases exactly that.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { groupByCampaign } from "../api/src/services/brandFiling.ts";

const files = [
  { id: "a", campaign: "Black Friday" },
  { id: "b", campaign: null },
  { id: "c", campaign: "Black Friday" },
  { id: "d", campaign: "" },
  { id: "e", campaign: "Verano" },
];
const group = (list = files) => groupByCampaign(list, f => f.campaign);

test("files with no campaign hang loose, never in an invented bucket", () => {
  const { campaigns, loose } = group();
  assert.deepEqual(loose.map(f => f.id), ["b", "d"]);
  assert.equal(campaigns.has("Sin campaña"), false);
});

test("files sharing a campaign are collected under it", () => {
  const { campaigns } = group();
  assert.deepEqual(campaigns.get("Black Friday").map(f => f.id), ["a", "c"]);
});

test("a campaign with a single file still gets its node", () => {
  // The campaign being visible is the point; being crowded is not.
  const { campaigns } = group();
  assert.deepEqual(campaigns.get("Verano").map(f => f.id), ["e"]);
});

test("whitespace is not a campaign", () => {
  const { campaigns, loose } = group([{ id: "x", campaign: "   " }]);
  assert.equal(campaigns.size, 0);
  assert.deepEqual(loose.map(f => f.id), ["x"]);
});

test("a campaign name is trimmed so one stray space is not a second campaign", () => {
  const { campaigns } = group([
    { id: "p", campaign: "Verano" },
    { id: "q", campaign: " Verano " },
  ]);
  assert.equal(campaigns.size, 1);
  assert.deepEqual(campaigns.get("Verano").map(f => f.id), ["p", "q"]);
});

test("campaign order follows first appearance, so the tree does not reshuffle", () => {
  const { campaigns } = group();
  assert.deepEqual([...campaigns.keys()], ["Black Friday", "Verano"]);
});

test("a brand with nothing filed produces nothing at all", () => {
  const { campaigns, loose } = group([]);
  assert.equal(campaigns.size, 0);
  assert.deepEqual(loose, []);
});

test("every file lands somewhere, exactly once", () => {
  const { campaigns, loose } = group();
  const seen = [...loose, ...[...campaigns.values()].flat()].map(f => f.id).sort();
  assert.deepEqual(seen, ["a", "b", "c", "d", "e"]);
});
