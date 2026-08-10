/**
 * Content calendar domain rules.
 *
 * The calendar maths and the Meta roll-up, which are the two places a wrong
 * answer is invisible: a post lands on the wrong day, or a rate is averaged
 * into a number that is not any real cost.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  isoDate, buildMonthGrid, groupByPlan, summarizeMetaRows, pacing, META_COLUMNS,
} from "../src/lib/contentCalendar.ts";

const row = (over = {}) => ({
  id: "c1", scheduled_date: "2026-03-10", kind: "organic", channels: [], status: "idea", ...over,
});

// ── Calendar ──

test("the month grid starts on Monday and covers whole weeks", () => {
  // 1 March 2026 is a Sunday, so the grid must lead with six February days.
  const cells = buildMonthGrid(2026, 2, [], new Date(2026, 2, 10));
  assert.equal(cells.length % 7, 0);
  assert.equal(cells[0].inMonth, false);
  assert.equal(cells.find(c => c.inMonth).date, "2026-03-01");
});

test("a post lands on its own date, in local time", () => {
  // toISOString() would move this to the 9th for anyone west of UTC.
  const cells = buildMonthGrid(2026, 2, [row({ scheduled_date: "2026-03-10" })], new Date(2026, 2, 1));
  const cell = cells.find(c => c.date === "2026-03-10");
  assert.equal(cell.items.length, 1);
  assert.equal(cells.filter(c => c.items.length).length, 1, "it must appear exactly once");
});

test("isoDate does not drift a day across timezones", () => {
  assert.equal(isoDate(new Date(2026, 0, 1)), "2026-01-01");
  assert.equal(isoDate(new Date(2026, 11, 31)), "2026-12-31");
});

test("same-day posts are ordered by time, unscheduled ones last", () => {
  const cells = buildMonthGrid(2026, 2, [
    row({ id: "tarde", scheduled_time: "18:00" }),
    row({ id: "sin hora", scheduled_time: null }),
    row({ id: "manana", scheduled_time: "09:00" }),
  ], new Date(2026, 2, 1));
  const cell = cells.find(c => c.date === "2026-03-10");
  assert.deepEqual(cell.items.map(i => i.id), ["manana", "tarde", "sin hora"]);
});

test("a date outside the month is not clamped into an edge cell", () => {
  const cells = buildMonthGrid(2026, 2, [row({ scheduled_date: "2026-07-04" })], new Date(2026, 2, 1));
  assert.equal(cells.some(c => c.items.length > 0), false);
});

test("today is marked, and only today", () => {
  const cells = buildMonthGrid(2026, 2, [], new Date(2026, 2, 17));
  assert.deepEqual(cells.filter(c => c.isToday).map(c => c.date), ["2026-03-17"]);
});

// ── Plan grouping ──

test("content with no campaign stays loose, matching the graph's rule", () => {
  const { campaigns, loose } = groupByPlan([
    row({ id: "a", campaign: "Escolar" }),
    row({ id: "b", campaign: null }),
    row({ id: "c", campaign: "  " }),
  ]);
  assert.deepEqual(loose.map(r => r.id), ["b", "c"]);
  assert.equal(campaigns.has("Sin campaña"), false);
  assert.deepEqual(campaigns.get("Escolar").map(r => r.id), ["a"]);
});

// ── Meta roll-up ──

const meta = (spend, impressions, reach, clicks, views = 0) => ({
  [META_COLUMNS.spend]: spend,
  [META_COLUMNS.impressions]: impressions,
  [META_COLUMNS.reach]: reach,
  [META_COLUMNS.linkClicks]: clicks,
  [META_COLUMNS.videoTo100]: views,
});

test("rates are recomputed from components, never averaged", () => {
  // A tiny ad with an absurd CPM must not drag the total: averaging the two
  // per-row CPMs gives ~505, which is not the cost of anything.
  const totals = summarizeMetaRows([meta(10, 10_000, 5000, 100), meta(10, 10, 10, 1)]);
  assert.equal(totals.spend, 20);
  assert.equal(totals.impressions, 10_010);
  assert.ok(Math.abs(totals.cpm - (20 / 10_010) * 1000) < 1e-9);
  assert.ok(totals.cpm < 3, "the weighted CPM stays near the real one");
});

test("CTR is a percentage of impressions, CPC a cost per click", () => {
  const totals = summarizeMetaRows([meta(50, 1000, 800, 20)]);
  assert.equal(totals.ctr, 2);
  assert.equal(totals.cpc, 2.5);
});

test("no divide-by-zero when a campaign spent nothing yet", () => {
  const totals = summarizeMetaRows([meta(0, 0, 0, 0)]);
  for (const key of ["cpm", "cpc", "ctr", "cpv", "frequency"]) {
    assert.equal(totals[key], 0, `${key} must be 0, not NaN or Infinity`);
  }
});

test("numbers arriving as strings from a spreadsheet still add up", () => {
  const totals = summarizeMetaRows([{
    [META_COLUMNS.spend]: "68.32", [META_COLUMNS.impressions]: "25,365",
    [META_COLUMNS.reach]: "15191", [META_COLUMNS.linkClicks]: "1804",
  }]);
  assert.equal(totals.spend, 68.32);
  assert.equal(totals.impressions, 25365);
});

test("an empty export summarises to zeros rather than throwing", () => {
  const totals = summarizeMetaRows([]);
  assert.equal(totals.spend, 0);
  assert.equal(totals.cpm, 0);
});

// ── Pacing ──

test("pacing is actual over planned", () => {
  assert.ok(Math.abs(pacing(34.22, 600) - 0.0570333) < 1e-6);
  assert.equal(pacing(600, 600), 1);
});

test("no plan means no pacing, not a fake zero", () => {
  assert.equal(pacing(100, 0), null);
  assert.equal(pacing(100, undefined), null);
});

test("spending nothing against a real plan is 0, not null", () => {
  assert.equal(pacing(0, 600), 0);
  assert.equal(pacing(undefined, 600), 0);
});
