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
const graph = readRepo("src/components/GraphTab.tsx");
const dashboard = readRepo("src/components/Dashboard.tsx");
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

test("api+ui: /crm fans out in parallel and the CRM shell loads first (v54.2)", () => {
  // Serial round trips are gone: interactions + brand_guidelines joined the
  // same Promise.all as the other seven queries (latency = the slowest one).
  assert.match(saas, /const interactionsPromise = \(async \(\) => \{/);
  assert.match(saas, /const guidelinesPromise = listBrandsByWorkspace\(workspaceId\)\.catch\(\(\) => \[\]\);/);
  assert.match(saas, /interactionsPromise,\s*\n\s*guidelinesPromise,/);
  assert.doesNotMatch(saas, /let interactionRows: any\[\] = \[\];/);
  assert.doesNotMatch(saas, /let dsRows: Awaited<ReturnType<typeof listBrandsByWorkspace>> = \[\];/);
  // Shell-first: no full-screen gate — views render with EMPTY_CRM_DATA and
  // their own loading state while /crm travels.
  assert.doesNotMatch(crm, /if \(loading && !data\) return/);
  assert.match(crm, /const EMPTY_CRM_DATA: CrmData = \{/);
  assert.match(crm, /const data = rawData \?\? EMPTY_CRM_DATA;/);
  for (const label of ["Cargando marcas…", "Cargando personas…", "Cargando embudo…"]) {
    assert.ok(crm.includes(label), `missing loading state: ${label}`);
  }
  // Mutations reload silently — no blocking state once data exists.
  assert.match(crm, /dataRef\.current = result\.data;/);
  assert.doesNotMatch(crm, /setLoading\(/);
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
  assert.match(crm, />Auto \(recomendado\)</);
});

// ── DIATTA layout in Musa tokens ──

test("ui: rich People table with inline estado, atención y paginación", () => {
  assert.match(crm, /crm-people-grid/);
  assert.match(crm, /row-needs-attention/);
  assert.match(crm, /crm-pill-select/);
  assert.match(crm, /crm-pagination-section/);
  assert.match(crm, /Mostrando \{start\}-\{end\} de \{total\} resultados/);
  assert.match(crm, /Ver en embudo/);
  assert.match(crm, /wa\.me/); // WhatsApp click-to-chat
});

test("ui: Marcas mirrors the Personas hierarchy — top card, kit toolbar, table card", () => {
  // v51: misma estructura que Personas — tarjeta superior (título serif + nav
  // de íconos + toolbar del kit) y tabla en tarjeta propia. «Marcas recientes»
  // y los selects nativos del head quedaron fuera.
  assert.match(crm, /crm-brands-grid/);
  assert.match(crm, /<h1>Marcas<\/h1>/);
  assert.doesNotMatch(crm, /Marcas recientes/);
  assert.doesNotMatch(crm, /<select className="crm-inline-filter"/);
  assert.match(crm, /label="Filtrar por relación"/);
  assert.match(crm, /label="Filtrar por salud de cuenta"/);
  assert.match(crm, /Relación: Todas/);
  assert.match(crm, /Salud: Toda/);
  assert.match(crm, /crm-toolbar-add/);
  assert.match(crm, /crm-status-pill \$\{health\}/);
  // La nav de íconos vive dentro de la tarjeta superior: <h1>Marcas</h1> y
  // {navTabs} en la misma crm-contacts-head (ventana de 400 chars).
  assert.match(crm, /<h1>Marcas<\/h1>[\s\S]{0,400}\{navTabs\}/);
});

test("ui: Ventas mirrors the hierarchy — top card, KPI toolbar row, kanban below", () => {
  // v51.1: pipeline con la misma tarjeta superior (título serif + nav de
  // íconos); los KPI del resumen viven en la fila de toolbar y el alta usa el
  // patrón «+ Nuevo deal». El botón ya no vive en la fila externa del shell.
  assert.match(crm, /<h1>Ventas<\/h1>/);
  assert.match(crm, /<CrmSummary data=\{data\} \/>/);
  assert.match(crm, /\+ Nuevo deal/);
  assert.match(crm, /className="workspace-button crm-toolbar-add" onClick=\{\(\) => setShowDealForm/);
  assert.doesNotMatch(crm, /view === "pipeline" && <button/);
  // v52: descriptor con el punto de vista comercial (CTA); nav de íconos
  // dentro de la tarjeta superior, junto al <h1>Ventas</h1>.
  assert.match(crm, /Vista comercial: negocia y cierra deal por deal/);
  assert.match(crm, /<h1>Ventas<\/h1>[\s\S]{0,400}\{navTabs\}/);
});

test("ui: ficha 360 with commercial sidebar, timeline and personal funnel", () => {
  assert.match(crm, /crm-person-layout/);
  assert.match(crm, /Registrar interacción/);
  assert.match(crm, /Timeline comercial/);
  assert.match(crm, /crm-mini-funnel/);
  assert.match(crm, /← Actual/);
  assert.match(crm, /Embudo personal/);
});

test("ui: funnel wears the shared hierarchy — top card, brand chips, simulator layers", () => {
  assert.match(crm, /STAGE_DESCRIPTIONS/);
  // v52: tarjeta superior compartida (título serif + nav + chips de foco por
  // marca), simulador de capas trapecio con rampa beige, desglose de barras
  // con punto + descripción + drops, tarjetas de métricas. B2B puro: sin
  // modo «Por personas».
  assert.match(crm, /<h1>Embudo<\/h1>/);
  assert.match(crm, /Vista de marketing/);
  assert.match(crm, /FUNNEL_LAYER_SKINS/);
  assert.match(crm, /crm-funnel-layer/);
  assert.match(crm, /layerClip/);
  assert.match(crm, /FUNNEL_STAGE_DOTS/);
  assert.match(crm, /crm-funnel-dot/);
  assert.match(crm, /crm-funnel-bar-count/);
  assert.match(crm, /crm-funnel-drop/);
  assert.match(crm, /crm-stats-grid/);
  assert.match(crm, /Requieren atención/);
  assert.doesNotMatch(crm, /Por personas<\/button>/);
  assert.doesNotMatch(crm, /crm-funnel-hero/);
  assert.match(crm, /Todas las marcas/);
  assert.match(crm, /onFocusBrand\{?|\{ onFocusBrand/);
  assert.match(crm, /crm-focus-banner/);
  assert.match(crm, /Quitar foco/);
  assert.match(css, /\.crm-funnel-stage \{ display: grid; grid-template-columns: 250px minmax\(0, 1fr\) 96px/);
  assert.match(css, /\.crm-funnel-layer \{/);
  assert.match(css, /\.crm-funnel-layer-row \{/);
  assert.match(css, /\.crm-stat-card\.attention/);
  assert.match(css, /\.crm-person-chip/);
});

test("ui: funnel stat cards reuse the attention signal and success math", () => {
  assert.match(crm, /contactNeedsAttention\(brand\)\)\.length/);
  assert.match(crm, /deliveredCount \/ \(deliveredCount \+ funnel\.lost\.count\)/);
  assert.match(crm, /Discovery → Entregado/);
  assert.match(crm, /Entregado vs Perdido/);
});

test("ui: computed health, KPI strips and deal outcome box", () => {
  assert.match(crm, /crm-health-note/);
  assert.match(crm, /crm-outcome-box/);
  assert.match(crm, /Motivo de pérdida/);
  assert.match(crm, /Valor final facturado/);
  assert.match(css, /\.crm-people-grid/);
  assert.match(css, /\.crm-people-grid th:nth-child\(1\)/);
  assert.match(css, /\.crm-pagination-section/);
  assert.match(css, /\.crm-entity-avatar/);
  assert.match(css, /\.crm-mini-funnel/);
  assert.match(css, /\.crm-focus-banner/);
});

test("ui: contacts module wears the Diatta design system, scoped to crm-contacts", () => {
  // v49: wrapper que acota el DS del UI Kit al módulo Personas — las clases de
  // tabla se comparten con la vista Marcas y no deben cambiar.
  assert.match(crm, /<div className="crm-contacts">/);
  // Toolbar: búsqueda + dropdowns + agregar; «Personas recientes» sigue fuera.
  assert.match(crm, /crm-contacts-toolbar/);
  assert.match(crm, /crm-toolbar-add/);
  assert.doesNotMatch(crm, /Personas recientes/);
  // v56: la ficha abre en el InspectorDrawer (antes modal crm-modal-overlay) —
  // el tablero queda visible detrás; nada de detalle apilado bajo la tabla.
  assert.match(crm, /<InspectorDrawer/);
  assert.match(crm, /storageKey="crm-person-drawer-width"/);
  assert.doesNotMatch(crm, /<h3>Selecciona una persona<\/h3>/);
  // v50: la zona superior (título + nav + toolbar + alta) va en tarjeta, misma
  // receta glass que la tabla; el módulo sigue sin fondo propio — el ambiente
  // fluye alrededor de las tarjetas.
  assert.match(crm, /<div className="crm-table-card crm-contacts-top">/);
  assert.match(css, /\.crm-contacts-top \{ display: grid; gap: 14px; \}/);
  assert.match(css, /\.crm-contacts \{ display: grid; gap: 18px; \}/);
  assert.doesNotMatch(css, /\.crm-contacts \{[^}]*background/);
  assert.doesNotMatch(css, /\.crm-contacts::before/);
  // Título serif + descriptor CTA; la nav de íconos a la misma altura.
  assert.match(crm, /<header className="crm-contacts-head">/);
  assert.match(crm, /<h1>Personas<\/h1>/);
  assert.match(css, /\.crm-contacts-head h1 \{ margin: 0; color: #ffffff; font-family: 'Instrument Serif', serif;/);
  // Dropdowns y «Agregar» pegados al borde derecho.
  assert.match(crm, /crm-toolbar-push/);
  assert.match(css, /\.crm-contacts-toolbar \.crm-toolbar-push \{ margin-left: auto; \}/);
  // Regla interna: cero emojis en el módulo — toda iconografía es SVG (CrmIcon).
  assert.doesNotMatch(crm, /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u);
  assert.match(crm, /function CrmIcon/);
  assert.match(css, /\.crm-stat-icon \{ display: inline-grid; place-items: center; color: #737373; \}/);
  assert.doesNotMatch(css, /\.crm-contacts[^{}]*rgba\(192,132,252/);
  assert.doesNotMatch(css, /\.crm-contacts[^{}]*rgba\(244,114,182/);
  assert.doesNotMatch(css, /\.crm-contacts[^{}]*rgba\(245,158,11/);
  // Sin barras laterales en las filas (ni selección ni atención).
  assert.match(css, /\.crm-contacts \.crm-table tbody tr\.row-needs-attention \{ background: transparent; box-shadow: none; \}/);
  assert.match(css, /\.crm-contacts \.crm-table tbody tr\.selected \{ background: rgba\(255,255,255,\.06\); box-shadow: none; \}/);
  // Base legible 92% (la animación ambiente no compite bajo la tabla) + borde
  // degradado glass vía mask-composite (receta exacta).
  assert.match(css, /\.crm-contacts \.crm-table-card, \.crm-contacts \.crm-create-panel, \.crm-contacts \.crm-create-deal \{ position: relative; background: rgba\(13,15,20,\.92\); backdrop-filter: blur\(8px\)/);
  assert.match(css, /mask-composite: exclude;/);
  assert.match(css, /linear-gradient\(180deg, rgba\(255,255,255,\.34\) 0%, rgba\(255,255,255,0\) 50%, rgba\(255,255,255,\.34\) 100%\)/);
  // Form tokens del kit: white/5 con focus blanco white/40.
  assert.match(css, /\.crm-contacts \.workspace-field input:focus, \.crm-contacts \.workspace-field select:focus, \.crm-contacts \.workspace-field textarea:focus \{ outline: none; border-color: rgba\(255,255,255,\.40\)/);
  // Botones sin degradado, con medidas del kit; avatares neutral-800 + white/20.
  assert.match(css, /\.crm-contacts \.workspace-button \{ border-radius: 8px; background: #fff; color: #000; padding: 8px 14px; font-size: 12px; font-weight: 600/);
  assert.doesNotMatch(css, /\.crm-contacts[^{}]*gradient-glow-btn/);
  assert.match(css, /\.crm-contacts \.crm-entity-avatar \{ width: 32px; height: 32px; font-size: 11px; background: #262626; border: 1px solid rgba\(255,255,255,\.28\); \}/);
});

test("ui: CRM nav is icon-only tabs living in each view's toolbar row", () => {
  // El título "Red de Marcas" desapareció de la barra superior del grafo.
  assert.doesNotMatch(graph, />Red de Marcas<\/span>/);
  // Las pestañas Ventas/Personas/Marcas/Embudo son solo íconos (crm-nav-tabs)
  // y viajan al CRM como navTabs; la barra de texto propia quedó fuera.
  assert.match(graph, /function CrmNavTabs/);
  assert.match(graph, /navTabs=\{<CrmNavTabs view=\{brandView\} onSwitch=\{setBrandView\} \/\>/);
  assert.match(graph, /role="tablist" aria-label="Secciones del CRM"/);
  assert.match(graph, /title=\{tab\.label\}/);
  assert.match(graph, /<svg width="15" height="15" viewBox="0 0 24 24"/);
  assert.doesNotMatch(graph, /function TabBtn/);
  // v52: CrmWorkspace las integra las cuatro vistas en su tarjeta superior —
  // la fila condicional del shell desapareció.
  assert.match(crm, /export type CrmView = /);
  assert.match(crm, /navTabs\?: ReactNode/);
  // v52: las cuatro vistas la llevan en su tarjeta superior — 3 como prop de
  // componente (Personas/Marcas/Embudo) y la de Ventas inline (pinned arriba).
  assert.doesNotMatch(crm, /controlledView && navTabs && view !==/);
  assert.equal((crm.match(/navTabs=\{navTabs\}/g) || []).length, 3);
  // Segmento glass del kit con activo solid-white.
  assert.match(css, /\.crm-nav-tabs \{ display: inline-flex; align-items: center; gap: 2px; padding: 3px; background: rgba\(255,255,255,\.05\); border: 1px solid rgba\(255,255,255,\.10\); border-radius: 10px; \}/);
  assert.match(css, /\.crm-nav-tab\.active \{ background: #fff; color: #000; \}/);
});

test("ui: plan A — the ambient video blurs at the source and the CRM panel turns translucent", () => {
  // El panel del CRM deja de ser la caja opaca #080a10: velo translúcido sin
  // backdrop-filter propio (no debe formar backdrop root para las cards).
  assert.doesNotMatch(graph, /#080a10/);
  // v50: en las vistas CRM el velo se retira por completo (transparente, sin
  // borde) — las tarjetas near-opaque cargan el contraste y el fondo ambiente
  // corre fluido bajo la nav; el velo queda solo para el grafo.
  assert.match(graph, /background: view === "brands" \? "transparent" : "rgba\(9,11,16,0\.55\)"/);
  assert.match(graph, /border: view === "brands" \? "none" : "1px solid rgba\(255,255,255,0\.07\)"/);
  // El desenfoque se aplica al video en el origen (filter, no backdrop-filter);
  // contrast(0.78) aplana los picos — sin reflejo blanco bajo la tabla.
  assert.match(dashboard, /filter: "blur\(26px\) brightness\(0\.78\) contrast\(0\.78\) saturate\(1\.12\)"/);
  assert.match(dashboard, /transform: "scale\(1\.12\)"/);
  // Velo ligero: la animación se ve suave, el panel aporta el campo parejo.
  assert.match(dashboard, /rgba\(0,0,0,0\.38\) 0%, rgba\(0,0,0,0\.26\) 40%/);
  // Usabilidad: prefers-reduced-motion pausa el video de fondo.
  assert.match(dashboard, /prefers-reduced-motion: reduce/);
});

test("ui: native select popups go dark — never white-on-white or soft blue on white", () => {
  // Regla interna: la lista abierta del <select> no puede salir blanca con el
  // highlight azul del OS. color-scheme + option con colores explícitos.
  assert.match(css, /\.crm-inline-filter, \.crm-pill-select, \.crm-contacts select \{ color-scheme: dark; \}/);
  assert.match(css, /\.crm-inline-filter option, \.crm-pill-select option, \.crm-contacts select option \{ background-color: #101319; color: #fafafa; \}/);
  assert.match(css, /\.crm-inline-filter option:checked, \.crm-pill-select option:checked, \.crm-contacts select option:checked \{ background-color: #2e323c; color: #ffffff; \}/);
});

test("ui: contrast pass (medio) — CRM ladder +1 step with pure-white anchors", () => {
  // Diagnóstico: el 80% de la masa de UI vivía entre 32% y 63% de blanco sin
  // ancla al 100%. Medio = cada tier +1 paso; anclas fuertes intactas.
  assert.match(css, /\.crm-contacts-head h1 \{ margin: 0; color: #ffffff;/);
  assert.match(css, /\.crm-contacts-head p \{ margin: 4px 0 0; color: #c6cbd6;/);
  assert.match(css, /\.crm-contacts-toolbar \.crm-header-search::placeholder \{ color: #71717a; \}/);
  assert.match(css, /\.crm-contacts \.workspace-field > span \{ color: #c6cbd6;/);
  assert.match(css, /\.crm-contacts \.crm-table th \{ color: #8e939e;/);
  // Anclas que NO se tocan: botón solid-white y focus blanco white/40.
  assert.match(css, /\.crm-contacts \.workspace-button \{ border-radius: 8px; background: #fff; color: #000;/);
  assert.match(css, /border-color: rgba\(255,255,255,\.40\)/);
});

test("ui: toolbar filters wear the kit dropdown and the add button sits centered", () => {
  // El popup nativo no admite radius/estados: los filtros de Personas usan CrmSelect.
  assert.match(crm, /function CrmSelect/);
  assert.match(crm, /role="listbox" aria-label=\{label\}/);
  assert.match(crm, /aria-expanded=\{open\}/);
  assert.doesNotMatch(crm, /<select className="crm-inline-filter crm-toolbar-push"/);
  assert.doesNotMatch(crm, /<select className="crm-inline-filter" aria-label="Filtrar por marca"/);
  // Trigger y menú del kit: medidas del filtro, menú redondeado, opción activa.
  assert.match(css, /\.crm-select-trigger \{ display: inline-flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 132px;/);
  // El menú vive en un portal fixed (lo recortaba el overflow de la tabla).
  assert.match(crm, /createPortal/);
  assert.match(crm, /style=\{\{ top: menuPos\.top, left: menuPos\.left \}\}/);
  assert.match(css, /\.crm-select-menu \{ position: fixed; z-index: 200;/);
  assert.match(css, /\.crm-select-option\.active \{ background: rgba\(255,255,255,\.06\); color: #fff; font-weight: 600; \}/);
  // «Agregar» centrado en la fila (el kit base lo baja con align-self: end).
  assert.match(css, /\.crm-contacts-toolbar \.workspace-button \{ align-self: center; min-height: 34px; \}/);
  // La píldora de estado por fila también es kit: trigger compacto, sin azul.
  assert.match(crm, /className="crm-select-pill"/);
  assert.match(css, /\.crm-select-pill \.crm-select-trigger \{ min-width: 0; min-height: 27px;/);
  assert.doesNotMatch(css, /crm-pill-select\.lead/);
});

// ── Regression wiring ──

test("the suite is registered in test:regression", () => {
  assert.match(pkg.scripts["test:regression"], /QA\/crm-diatta-upgrade\.test\.mjs/);
});
