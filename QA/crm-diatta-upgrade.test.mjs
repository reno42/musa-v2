/**
 * CRM DIATTA upgrade (v45) — the commercial-interaction layer.
 *
 * What the migration must provide (crm_interactions + deal outcome + health
 * override), what the api exposes (interactions routes, deal patch, /crm
 * enrichment), the MCP parity surface (log_interaction/list_interactions ride
 * the same workspace api the UI uses), and the DIATTA-layout UI wiring in
 * Musa tokens. Pure logic (computed health, per-contact stats) is tested
 * directly; file contents guard the integration seams.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BRAND_HEALTH_STALE_DAYS, buildContactDealStats, computeBrandHealth } from "../api/src/services/crmInsights.ts";

const readRepo = rel => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

const migration = readRepo("supabase_migrations_v45.sql");
const saas = readRepo("api/src/routes/saas.ts");
const mcp = readRepo("netlify/functions/mcp.mjs");
const chatFab = readRepo("src/components/ChatFAB.tsx");
const crm = readRepo("src/components/CrmWorkspace.tsx");
const css = readRepo("src/index.css");
const pkg = JSON.parse(readRepo("package.json"));

// ── Migration v45 ──

test("v45 creates crm_interactions with workspace-scoped RLS like the other crm tables", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS crm_interactions/);
  assert.match(migration, /interaction_type TEXT NOT NULL CHECK/);
  assert.match(migration, /'primer_contacto', 'reunion', 'llamada', 'email', 'whatsapp',/);
  assert.match(migration, /contact_id UUID REFERENCES crm_contacts\(id\) ON DELETE SET NULL/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_interactions_id_workspace/);
  assert.match(migration, /has_workspace_role\(workspace_id, 'viewer'\)/);
  assert.match(migration, /has_workspace_role\(workspace_id, 'editor'\)/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON crm_interactions TO authenticated/);
});

test("v45 adds deal outcome columns and the brand health override with audit", () => {
  assert.match(migration, /ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS final_value NUMERIC\(12, 2\)/);
  assert.match(migration, /ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS lost_reason TEXT/);
  assert.match(migration, /account_health_override TEXT/);
  assert.match(migration, /health_changed_at TIMESTAMPTZ/);
  assert.match(migration, /health_changed_by UUID/);
  assert.match(migration, /brands_account_health_override_check/);
});

// ── Pure logic: computed health + per-contact stats ──

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-09-03T12:00:00Z");

test("computeBrandHealth: override wins, churned is sticky, stale clients go at_risk", () => {
  const deals = [{ id: "d1", brand_id: "b1", stage: "proposal" }];
  // 1. Manual override always wins.
  assert.equal(
    computeBrandHealth({ id: "b1", relationship_status: "client", account_health: "active", account_health_override: "active" }, deals, now),
    "active",
  );
  // 2. churned sticks even with open deals.
  assert.equal(
    computeBrandHealth({ id: "b1", relationship_status: "client", account_health: "churned" }, deals, now),
    "churned",
  );
  // 3. Client, no open deals, contacted 40 days ago → at_risk.
  const staleBrand = { id: "b1", relationship_status: "client", account_health: "active", last_contacted_at: new Date(now.getTime() - 40 * DAY).toISOString() };
  assert.equal(computeBrandHealth(staleBrand, [], now), "at_risk");
  // 4. Recent contact keeps it active.
  assert.equal(
    computeBrandHealth({ ...staleBrand, last_contacted_at: new Date(now.getTime() - 5 * DAY).toISOString() }, [], now),
    "active",
  );
  // 5. A reopened deal clears the risk.
  assert.equal(computeBrandHealth(staleBrand, deals, now), "active");
  // 6. Leads never compute to at_risk.
  assert.equal(computeBrandHealth({ id: "b1", relationship_status: "lead", account_health: "active", last_contacted_at: null }, [], now), "active");
});

test("buildContactDealStats: open and won value per person, final_value wins on delivered", () => {
  const deals = [
    { id: "d1", brand_id: "b1", primary_contact_id: "c1", stage: "proposal", value: 1000, currency: "USD" },
    { id: "d2", brand_id: "b1", primary_contact_id: "c1", stage: "delivered", value: 500, final_value: 650, currency: "USD" },
    { id: "d3", brand_id: "b1", primary_contact_id: "c1", stage: "lost", value: 900, currency: "USD" },
    { id: "d4", brand_id: "b1", primary_contact_id: "c2", stage: "discovery", value: 42, currency: "USD" },
  ];
  const stats = buildContactDealStats("c1", deals);
  assert.equal(stats.dealCount, 3);
  assert.equal(stats.openDeals, 1);
  assert.equal(stats.openValue, 1000);
  assert.equal(stats.wonValue, 650); // final_value ?? value
  assert.equal(stats.currency, "USD");
  assert.deepEqual(buildContactDealStats("nobody", deals).dealCount, 0);
});

// ── Api surface ──

test("api: interactions routes validate tenancy and stamp brand last_contacted_at", () => {
  assert.match(saas, /workspaceSaasRoutes\.get\("\/:id\/interactions", requireWorkspaceRole\("viewer"\)/);
  assert.match(saas, /workspaceSaasRoutes\.post\("\/:id\/interactions", requireWorkspaceRole\("editor"\)/);
  assert.match(saas, /const crmInteractionTypeSchema = z\.enum\(/);
  assert.match(saas, /Brand does not belong to this workspace/);
  assert.match(saas, /Contact does not belong to this brand/);
  const postInteractions = saas.slice(saas.indexOf('workspaceSaasRoutes.post("/:id/interactions"'), saas.indexOf("const crmDealStageSchema"));
  assert.match(postInteractions, /last_contacted_at: data\.interaction_date/);
});

test("api: deal patch accepts finalValue/lostReason; /crm degrades gracefully without v45", () => {
  assert.match(saas, /finalValue: z\.coerce\.number\(\)/);
  assert.match(saas, /lostReason: z\.string\(\)\.max\(2000\)/);
  assert.match(saas, /finalValue: "final_value"/);
  assert.match(saas, /lostReason: "lost_reason"/);
  assert.match(saas, /v45 pending — CRM renders without interaction data/);
  assert.match(saas, /computed_health: computeBrandHealth\(brand, rawDeals\)/);
  assert.match(saas, /dealStats: buildContactDealStats\(contact\.id, rawDeals\)/);
  assert.match(saas, /atRiskAccounts/);
  // Existing behavior intact: approved..delivered still stamps the brand as active client.
  assert.match(saas, /relationship_status: "client",/);
});

// ── MCP parity ──

test("mcp: log_interaction and list_interactions are defs + loopback handlers", () => {
  for (const name of ["log_interaction", "list_interactions"]) {
    assert.ok(mcp.includes(`name: "${name}"`), `missing tool def: ${name}`);
    assert.ok(mcp.includes(`case "${name}"`), `missing handler case: ${name}`);
  }
  const logInteraction = mcp.slice(mcp.indexOf('case "log_interaction"'), mcp.indexOf('case "list_interactions"'));
  assert.match(logInteraction, /\/api\/workspaces\/\$\{encodeURIComponent\(params\.workspaceId\)\}\/interactions/);
  assert.match(logInteraction, /callWorkspaceApi\(auth/);
  const listInteractions = mcp.slice(mcp.indexOf('case "list_interactions"'), mcp.indexOf('case "list_copy_recipes"'));
  assert.match(listInteractions, /callWorkspaceApi\(auth/);
  assert.match(listInteractions, /brandId/);
});

test("mcp: ChatFAB exposes both tools and the leader can use them", () => {
  assert.match(chatFab, /name: "log_interaction"/);
  assert.match(chatFab, /name: "list_interactions"/);
  assert.match(chatFab, /"log_interaction", "list_interactions"/);
});

// ── MCP parity: full CRM core (v45) ──

test("mcp: the whole CRM core surface has defs + loopback handlers", () => {
  // Nothing in the v45 CRM may be UI-only: MCP is a must, not a nice to have.
  const core = [
    "get_crm_overview", "create_crm_deal", "update_crm_deal", "update_crm_deliverable",
    "create_crm_contact", "update_crm_contact", "update_crm_brand",
  ];
  for (const name of core) {
    assert.ok(mcp.includes(`name: "${name}"`), `missing tool def: ${name}`);
    assert.ok(mcp.includes(`case "${name}"`), `missing handler case: ${name}`);
    assert.ok(chatFab.includes(`name: "${name}"`), `ChatFAB missing schema: ${name}`);
  }
  // Every CRM write rides the same workspace api the UI uses.
  for (const path of ["/crm`", "/deals`", "/deals/${encodeURIComponent(params.dealId)}`", "/contacts`", "/brands/${encodeURIComponent(params.brandId)}`"]) {
    assert.ok(mcp.includes(path), `missing loopback path: ${path}`);
  }
  // Outcome bookkeeping rides update_crm_deal.
  const updateDeal = mcp.slice(mcp.indexOf('case "update_crm_deal"'), mcp.indexOf('case "update_crm_deliverable"'));
  assert.match(updateDeal, /finalValue/);
  assert.match(updateDeal, /lostReason/);
});

test("api: brand PATCH accepts the v45 health override with audit stamping", () => {
  assert.match(saas, /accountHealthOverride: z\.enum\(\["active", "at_risk", "churned"\]\)\.nullable\(\)\.optional\(\)/);
  const brandPatch = saas.slice(saas.indexOf('workspaceSaasRoutes.patch("/:id/brands/:brandId"'), saas.indexOf('workspaceSaasRoutes.delete("/:id/brands/:brandId"'));
  assert.match(brandPatch, /patch\.account_health_override = parsed\.accountHealthOverride/);
  assert.match(brandPatch, /patch\.health_changed_at = new Date\(\)\.toISOString\(\)/);
  assert.match(brandPatch, /patch\.health_changed_by = req\.auth!\.userId/);
});

test("ui: the health select writes the pin (Auto/manual) instead of the legacy field only", () => {
  assert.match(crm, /accountHealthOverride: healthMode === "auto" \? null : healthMode/);
  assert.match(crm, /brand\.account_health_override \|\| "auto"/);
  assert.match(crm, /🤖 Auto \(recomendado\)/);
});

// ── DIATTA layout in Musa tokens ──

test("ui: rich People table with inline estado, atención y paginación", () => {
  assert.match(crm, /crm-people-table/);
  assert.match(crm, /needs-attention/);
  assert.match(crm, /crm-row-select/);
  assert.match(crm, /crm-pagination/);
  assert.match(crm, /Ver en embudo/);
  assert.match(crm, /wa\.me/); // WhatsApp click-to-chat
});

test("ui: ficha 360 with commercial sidebar, timeline and personal funnel", () => {
  assert.match(crm, /crm-person-layout/);
  assert.match(crm, /Registrar interacción/);
  assert.match(crm, /Timeline comercial/);
  assert.match(crm, /crm-mini-funnel/);
  assert.match(crm, /← Actual/);
  assert.match(crm, /Embudo personal/);
});

test("ui: funnel descriptions, conversion badges and the cross-view focus banner", () => {
  assert.match(crm, /STAGE_DESCRIPTIONS/);
  assert.match(crm, /crm-conv-badge/);
  assert.match(crm, /crm-focus-banner/);
  assert.match(crm, /Quitar filtro/);
});

test("ui: computed health, KPI strips and deal outcome box", () => {
  assert.match(crm, /crm-health-note/);
  assert.match(crm, /En fuga \(computada\)/);
  assert.match(crm, /crm-outcome-box/);
  assert.match(crm, /Motivo de pérdida/);
  assert.match(crm, /Valor final facturado/);
  assert.match(css, /\.crm-people-table/);
  assert.match(css, /\.crm-mini-funnel/);
  assert.match(css, /\.crm-focus-banner/);
});

// ── Regression wiring ──

test("the suite is registered in test:regression", () => {
  assert.match(pkg.scripts["test:regression"], /QA\/crm-diatta-upgrade\.test\.mjs/);
});
