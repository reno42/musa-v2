/**
 * El reporte de campañas (REQ-CW5.4/CW2/CW7) es UN cálculo compartido:
 * la tool MCP list_campaign_report, el widget del home y la vista Reportes
 * llaman al mismo buildCampaignReport — este suite fija sus reglas para que
 * ninguna de las tres vistas pueda divergir.
 *
 * Las reglas que duelen si se rompen:
 *  - las tasas (CPM/CTR) se derivan de SUMAS, nunca promediadas por pieza;
 *  - avance null sin plan — un 0 planificado es promesa de no gastar, no vacío;
 *  - ganadora de benchmark SOLO con ≥2 variantes e impresiones > 0, y en
 *    empate gana la primera por fecha (determinista, nunca aleatorio);
 *  - el CSV resumen lleva TOTAL con el avance recalculado sobre las sumas.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  BENCH_PREFIX, buildCampaignReport, campaignReportToCSV,
} from "../src/lib/contentCalendar.ts";

const row = (over = {}) => ({
  id: "p",
  scheduled_date: "2026-03-01",
  topic: "Tema",
  copy: "",
  status: "publicado",
  campaign: "Lanzamiento",
  channels: [],
  plan_spend: null,
  plan_impressions: null,
  actual_spend: null,
  actual_impressions: null,
  actual_clicks: null,
  ...over,
});

test("agrupa por campaña; sin campaña queda suelta, no en un balde inventado", () => {
  const report = buildCampaignReport([
    row({ id: "a", campaign: "Lanzamiento" }),
    row({ id: "b", campaign: null }),
    row({ id: "c", campaign: "  Retargeting  " }),
  ]);
  assert.deepEqual(report.campaigns.map(c => c.name), ["Lanzamiento", "Retargeting"]);
  assert.equal(report.campaigns[0].piezas, 1);
  assert.equal(report.looseCount, 1);
  assert.equal(report.total, 3);
});

test("sumas plan/real y tasas derivadas de las sumas — promediar un CPM no es el costo de nada", () => {
  const report = buildCampaignReport([
    row({ id: "a", campaign: "Ads", plan_spend: 100, plan_impressions: 10000, actual_spend: 50, actual_impressions: 5000, actual_clicks: 100 }),
    row({ id: "b", campaign: "Ads", plan_spend: 300, plan_impressions: 30000, actual_spend: 100, actual_impressions: 100000, actual_clicks: 200 }),
  ]);
  const c = report.campaigns[0];
  assert.equal(c.planSpend, 400);
  assert.equal(c.planImpr, 40000);
  assert.equal(c.realSpend, 150);
  assert.equal(c.realImpr, 105000);
  assert.equal(c.cpm, (150 / 105000) * 1000);
  assert.equal(c.ctr, (300 / 105000) * 100);
});

test("avance = real/plan; sin plan es null — 0 planificado es promesa de no gastar", () => {
  const report = buildCampaignReport([
    row({ id: "a", campaign: "Con plan", plan_spend: 1000, actual_spend: 500, plan_impressions: 0, actual_impressions: 200 }),
    row({ id: "b", campaign: "Sin plan", actual_spend: 500, actual_impressions: 200 }),
  ]);
  const [conPlan, sinPlan] = report.campaigns;
  assert.equal(conPlan.avanceSpend, 0.5);
  assert.equal(conPlan.avanceImpr, null);
  assert.equal(sinPlan.avanceSpend, null);
  assert.equal(sinPlan.avanceImpr, null);
});

test("ganadora de benchmark: más impresiones REALES; campaña normal nunca compite", () => {
  const report = buildCampaignReport([
    row({ id: "a", campaign: BENCH_PREFIX + "Hook navideño", scheduled_date: "2026-03-01", topic: "Hook A", actual_impressions: 1200 }),
    row({ id: "b", campaign: BENCH_PREFIX + "Hook navideño", scheduled_date: "2026-03-02", topic: "Hook B", actual_impressions: 3400 }),
    row({ id: "c", campaign: "Siempre", topic: "P1", actual_impressions: 900 }),
    row({ id: "d", campaign: "Siempre", topic: "P2", actual_impressions: 5000 }),
  ]);
  const bench = report.campaigns.find(c => c.isBenchmark);
  assert.equal(bench.winnerId, "b");
  assert.equal(bench.winnerTopic, "Hook B");
  // Las piezas se listan en orden de fecha, no de llegada.
  assert.deepEqual(bench.pieces.map(p => p.id), ["a", "b"]);
  const normal = report.campaigns.find(c => c.name === "Siempre");
  assert.equal(normal.isBenchmark, false);
  assert.equal(normal.winnerId, null);
});

test("sin datos no hay ganadora que inventar (0 impresiones o una sola variante)", () => {
  const sinDatos = buildCampaignReport([
    row({ id: "a", campaign: "bench:X", topic: "A", actual_impressions: 0 }),
    row({ id: "b", campaign: "bench:X", topic: "B", actual_impressions: 0 }),
  ]).campaigns[0];
  assert.equal(sinDatos.winnerId, null);
  const sola = buildCampaignReport([
    row({ id: "a", campaign: "bench:Y", topic: "A", actual_impressions: 5000 }),
  ]).campaigns[0];
  assert.equal(sola.winnerId, null);
});

test("empate: gana la primera por fecha — el reporte no puede ser aleatorio", () => {
  const empate = buildCampaignReport([
    row({ id: "b", campaign: "bench:T", scheduled_date: "2026-03-02", topic: "B", actual_impressions: 100 }),
    row({ id: "a", campaign: "bench:T", scheduled_date: "2026-03-01", topic: "A", actual_impressions: 100 }),
  ]).campaigns[0];
  assert.equal(empate.winnerId, "a");
});

test("CSV resumen: fila por campaña, TOTAL con avance recalculado y ganadora", () => {
  const report = buildCampaignReport([
    row({ id: "a", campaign: "Ads, Marzo", plan_spend: 1000, plan_impressions: 10000, actual_spend: 500, actual_impressions: 5000, actual_clicks: 50 }),
    row({ id: "b", campaign: "bench:Hook", topic: "A", scheduled_date: "2026-03-01", actual_impressions: 100 }),
    row({ id: "c", campaign: "bench:Hook", topic: "B", scheduled_date: "2026-03-02", actual_impressions: 300 }),
  ]);
  const csv = campaignReportToCSV(report);
  assert.ok(csv.endsWith("\n"));
  const lines = csv.trimEnd().split("\n");
  assert.equal(lines.length, 4);
  assert.match(lines[0], /Ganadora \(provisional\)/);
  // La campaña con coma viaja citada, no rota el CSV.
  assert.equal(lines[1], `"Ads, Marzo","1","1000","10000","500","5000","100","1.00%","50%","50%",""`);
  assert.equal(lines[2], `"bench:Hook","2","0","0","0","400","0","0.00%","","","B"`);
  // TOTAL: avance sobre las SUMAS (50% $, 54% impr), sin CPM/CTR propios.
  assert.equal(lines[3], `"TOTAL","3","1000","10000","500","5400","","","50%","54%",""`);
});

test("sin filas no hay reporte que romper — y el CSV sigue siendo un CSV", () => {
  const report = buildCampaignReport([]);
  assert.deepEqual(report, { campaigns: [], looseCount: 0, total: 0 });
  const csv = campaignReportToCSV(report);
  assert.match(csv, /"TOTAL","0","0","0","0","0"/);
});
