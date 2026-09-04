import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ALL_DEAL_STAGES, FUNNEL_STAGES, buildFunnel, contactName } from "../src/lib/crmFunnel.ts";

const brands = [
  { id: "br_nova", name: "Nova" },
  { id: "br_kim", name: "Kim" },
];
// Fixture: two brands — the funnel unit is the deal, broken down by brand (B2B).
const deals = [
  { id: "d1", brand_id: "br_nova", stage: "discovery", title: "Nova lanzamiento", value: 1000, primary_contact_id: "ct_ana" },
  { id: "d2", brand_id: "br_nova", stage: "discovery", title: "Nova landing", value: 500, primary_contact_id: "ct_luis" },
  { id: "d3", brand_id: "br_kim", stage: "discovery", title: "Kim social", value: 300, primary_contact_id: null },
  { id: "d4", brand_id: "br_nova", stage: "proposal", title: "Nova propuesta", value: 900, primary_contact_id: "ct_ana" },
  { id: "d5", brand_id: "br_nova", stage: "proposal", title: "Nova segunda", value: 400, primary_contact_id: "ct_luis" },
  { id: "d6", brand_id: "br_kim", stage: "delivered", title: "Kim entregado", value: 700, primary_contact_id: "ct_ana" },
  { id: "d7", brand_id: "br_kim", stage: "lost", title: "Kim perdido", value: 250, primary_contact_id: null },
];

test("the funnel mirrors the kanban: 8 open stages, lost stays outside", () => {
  assert.equal(FUNNEL_STAGES.length, 8);
  assert.equal(FUNNEL_STAGES[0].value, "discovery");
  assert.equal(FUNNEL_STAGES[FUNNEL_STAGES.length - 1].value, "delivered");
  assert.ok(!FUNNEL_STAGES.some((stage) => stage.value === "lost"));
  assert.equal(ALL_DEAL_STAGES.length, 9);
  assert.equal(ALL_DEAL_STAGES[ALL_DEAL_STAGES.length - 1].value, "lost");
});

test("brands mode counts deals per stage with per-brand breakdown sorted", () => {
  const funnel = buildFunnel(deals, brands);
  const discovery = funnel.rows[0];
  const proposal = funnel.rows[1];
  assert.equal(discovery.count, 3);
  assert.deepEqual(discovery.byBrand.map((entry) => [entry.brandId, entry.count]), [
    ["br_nova", 2],
    ["br_kim", 1],
  ]);
  assert.equal(proposal.count, 2);
  assert.equal(proposal.conversionFromPrev, 2 / 3);
  assert.equal(funnel.rows.find((row) => row.stage === "delivered")?.count, 1);
  assert.deepEqual(funnel.lost, { count: 1, value: 250 });
  assert.equal(funnel.endToEnd, 1 / 3);
});

test("conversion guards: empty stage yields null ratios and names resolve", () => {
  const funnel = buildFunnel(
    [{ id: "d1", brand_id: "br_nova", stage: "lost", title: "Solo perdido", value: 10, primary_contact_id: null }],
    brands,
  );
  assert.equal(funnel.rows[0].count, 0);
  assert.equal(funnel.rows[1].conversionFromPrev, null);
  assert.equal(funnel.endToEnd, null);
  assert.equal(funnel.lost.count, 1);
  assert.equal(contactName({ id: "x", first_name: "Ana", last_name: "Rojas" }), "Ana Rojas");
  assert.equal(contactName({ id: "x", first_name: "Luis", last_name: null }), "Luis");
});

test("unknown brand or contact ids fall back to generic labels", () => {
  const funnel = buildFunnel(
    [{ id: "d1", brand_id: "br_ghost", stage: "proposal", title: "Ghost", value: null, primary_contact_id: "ct_ghost" }],
    brands,
  );
  assert.equal(funnel.rows[1].byBrand[0]?.name, "Marca");
});

test("the four CRM views are wired: URL panes, tab bar and internal switch", () => {
  const appRoute = readFileSync(new URL("../src/lib/appRoute.ts", import.meta.url), "utf8");
  const graphTab = readFileSync(new URL("../src/components/GraphTab.tsx", import.meta.url), "utf8");
  const crmWorkspace = readFileSync(new URL("../src/components/CrmWorkspace.tsx", import.meta.url), "utf8");

  // The URL carries the four views so a refresh stays put.
  assert.match(appRoute, /GRAPH_PANES = \["pipeline", "personas", "accounts", "embudo"\]/);
  // Red de Marcas hosts the four tabs and passes the pane straight down.
  // v49: the tabs are icon-only (CrmNavTabs), injected into the CRM toolbar
  // rows via the navTabs prop — the old text sub-tab bar is gone.
  assert.match(graphTab, /function CrmNavTabs/);
  assert.match(graphTab, /navTabs=\{<CrmNavTabs view=\{brandView\} onSwitch=\{setBrandView\} \/\>/);
  assert.match(graphTab, /view=\{brandView\}/);
  // CrmWorkspace's own switch mirrors the same four views.
  assert.match(crmWorkspace, /view\?: CrmView/);
  assert.match(crmWorkspace, /useState<CrmView>\("pipeline"\)/);
  for (const label of ["Ventas", "Personas", "Marcas", "Embudo"]) {
    assert.match(crmWorkspace, new RegExp(`>${label}<\\/button>`));
  }
  assert.match(crmWorkspace, /function ContactsView/);
  assert.match(crmWorkspace, /function FunnelView/);
  assert.match(crmWorkspace, /function PersonDetail/);
});

test("the funnel stays aligned to the kanban and reads from the shared lib", () => {
  const crmWorkspace = readFileSync(new URL("../src/components/CrmWorkspace.tsx", import.meta.url), "utf8");
  // The component no longer defines its own stage list: it imports the shared one.
  assert.match(crmWorkspace, /ALL_DEAL_STAGES as DEAL_STAGES/);
  assert.doesNotMatch(crmWorkspace, /const DEAL_STAGES: Array/);
  // v52: brands-only (B2B) — the «Por personas» switch is gone and the
  // numbers come straight from buildFunnel(data.deals, data.brands).
  assert.doesNotMatch(crmWorkspace, /Por personas<\/button>/);
  assert.match(crmWorkspace, /buildFunnel\(data\.deals, data\.brands\)/);
});

test("the personas table keeps master-detail and the contact API surface", () => {
  const crmWorkspace = readFileSync(new URL("../src/components/CrmWorkspace.tsx", import.meta.url), "utf8");
  // v46 (DIATTA reference): the table follows the Contacts anatomy — page
  // header (title + search + primary button), card with inline filters
  // (crm-people-grid: avatar, 💬 WhatsApp, pill estado, monto, atención)
  // and the «Mostrando X-Y de Z resultados» pagination.
  assert.match(crmWorkspace, /crm-people-grid/);
  assert.match(crmWorkspace, /aria-label="Buscar personas"/);
  assert.match(crmWorkspace, /\/contacts\/\$\{contact\.id\}`,\s*\{\s*method: "PATCH"/);
  assert.match(crmWorkspace, /`\/api\/workspaces\/\$\{workspaceId\}\/contacts`/);
});
