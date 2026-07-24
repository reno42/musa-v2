import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildDealProgress, buildOfferSuggestions } from "../api/src/services/crmInsights.ts";

test("deal progress only confirms explicitly linked files and proposes exact unused matches", () => {
  const deal = { id: "deal-1", brand_id: "brand-1", campaign_id: "campaign-1", stage: "in_production" };
  const deliverables = [
    { id: "deliverable-social", deal_id: "deal-1", asset_type: "social_media", label: "Posts", quantity: 2, sort_order: 0 },
    { id: "deliverable-web", deal_id: "deal-1", asset_type: "landing", label: "Landing", quantity: 1, sort_order: 1 },
  ];
  const links = [{ deliverable_id: "deliverable-social", template_id: "social-1" }];
  const designs = [
    { template_id: "social-1", brand_id: "brand-1", campaign_id: "campaign-1", asset_type: "social_media", name: "Post 1" },
    { template_id: "social-2", brand_id: "brand-1", campaign_id: "campaign-1", asset_type: "social_media", name: "Post 2" },
    { template_id: "wrong-campaign", brand_id: "brand-1", campaign_id: "campaign-2", asset_type: "landing" },
    { template_id: "wrong-brand", brand_id: "brand-2", campaign_id: "campaign-1", asset_type: "landing" },
  ];

  const progress = buildDealProgress(deal, deliverables, links, designs);

  assert.equal(progress.requested, 3);
  assert.equal(progress.completed, 1);
  assert.equal(progress.percentage, 33);
  assert.equal(progress.canReconcile, true);
  assert.deepEqual(progress.deliverables[0].candidateFiles.map((file) => file.template_id), ["social-2"]);
  assert.equal(progress.deliverables[1].candidateFiles.length, 0);
});

test("campaign-less deals stay visible but cannot be reconciled automatically", () => {
  const progress = buildDealProgress(
    { id: "deal-1", brand_id: "brand-1", campaign_id: null, stage: "proposal" },
    [{ id: "deliverable-1", deal_id: "deal-1", asset_type: "key_visual", label: "KV", quantity: 1 }],
    [],
    [{ template_id: "kv-1", brand_id: "brand-1", campaign_id: null, asset_type: "key_visual" }],
  );

  assert.equal(progress.canReconcile, false);
  assert.match(progress.warning, /campaña/i);
  assert.equal(progress.completed, 0);
  assert.deepEqual(progress.deliverables[0].candidateFiles.map((file) => file.template_id), ["kv-1"]);
});

test("offer suggestions distinguish leads, active clients and accounts in fuga", () => {
  const designs = [
    { template_id: "kv", brand_id: "client", asset_type: "key_visual" },
    { template_id: "social", brand_id: "client", asset_type: "social_media" },
  ];

  assert.equal(buildOfferSuggestions({ id: "lead", name: "Lead", relationship_status: "lead" }, designs)[0].title, "Paquete visual de entrada");
  assert.equal(buildOfferSuggestions({ id: "client", name: "Client", relationship_status: "client" }, designs)[0].assetType, "landing");
  assert.equal(buildOfferSuggestions({ id: "client", name: "Client", relationship_status: "client" }, designs, ["landing"])[0].assetType, "mailing");
  assert.match(buildOfferSuggestions({
    id: "churned",
    name: "Churned",
    relationship_status: "client",
    account_health: "churned",
  }, designs)[0].title, /relanzamiento/i);
});

test("v14 migration isolates deals, deliverables and file confirmation by workspace", () => {
  const sql = readFileSync(new URL("../supabase_migrations_v14.sql", import.meta.url), "utf8");
  for (const table of ["crm_deals", "crm_deal_deliverables", "crm_deliverable_files"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, "i"));
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, "i"));
  }
  assert.match(sql, /UNIQUE \(workspace_id, template_id\)/i);
  assert.match(sql, /has_workspace_role\(workspace_id, 'editor'\)/i);
  assert.match(sql, /account_health IN \('active', 'at_risk', 'churned'\)/i);
});

test("CRM stays focused while workspace administration lives in settings", () => {
  const dashboard = readFileSync(new URL("../src/components/Dashboard.tsx", import.meta.url), "utf8");
  const workspaceConsole = readFileSync(new URL("../src/components/WorkspaceConsole.tsx", import.meta.url), "utf8");
  const crmWorkspace = readFileSync(new URL("../src/components/CrmWorkspace.tsx", import.meta.url), "utf8");

  assert.match(dashboard, /<WorkspaceConsole[\s\S]*mode="settings"/);
  assert.match(dashboard, /activeTab === "workspace"[\s\S]*<WorkspaceConsole[\s\S]*mode="crm"/);
  assert.match(workspaceConsole, /SETTINGS_SECTIONS[\s\S]*\["general", "General"\][\s\S]*\["team", "Equipo"\][\s\S]*\["agents", "API MCP"\][\s\S]*\["account", "Cuenta"\]/);
  assert.doesNotMatch(workspaceConsole, /\['crm', 'CRM'\]/);
  assert.match(crmWorkspace, />Pipeline<\/button>/);
  assert.match(crmWorkspace, />Marcas y Personas<\/button>/);
});
