// v54 — Agentes tab hierarchy regression invariants.
//
// What this guards:
//   • the Agentes tab wears the shared CRM hierarchy (glass top card, serif
//     h1, per-sub-view descriptor + CTA, icon-only nav with hover labels)
//   • the three sub-views (Kanban / Tabla / Infraestructura) keep all their
//     functionality under the shared shell — only duplicate internal titles
//     were removed
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

test("Agentes tab wears the shared CRM hierarchy with three icon sub-tabs", () => {
  const dashboard = read("src/components/Dashboard.tsx");
  // The three sub-views with their own descriptor and CTA.
  assert.match(dashboard, /AGENT_VIEWS[\s\S]*id: "kanban"[\s\S]*id: "table"[\s\S]*id: "agents"/);
  assert.match(dashboard, /title: "Kanban de tareas"/);
  assert.match(dashboard, /title: "Tabla de tareas"/);
  assert.match(dashboard, /title: "Infraestructura de agentes"/);
  // Shared glass top card + icon-only nav (hover shows the label), the same
  // pattern as the CRM views and Configuración.
  assert.match(dashboard, /className="crm-table-card crm-contacts-top" style=\{\{ flexShrink: 0 \}\}/);
  assert.match(dashboard, /role="tablist" aria-label="Vistas de agentes"/);
  assert.match(dashboard, /title=\{view\.label\}/);
  assert.match(dashboard, /"crm-nav-tab active" : "crm-nav-tab"/);
  // CTAs cross-link the views (and Infra points at Configuración).
  assert.match(dashboard, /ctaLabel: "Ver como tabla",\s*\n\s*ctaTo: "table"/);
  assert.match(dashboard, /ctaLabel: "Abrir el tablero",\s*\n\s*ctaTo: "kanban"/);
  assert.match(dashboard, /ctaLabel: "Invita a tus IAs",\s*\n\s*ctaTo: "configuracion"/);
  // The old inline sub-tab buttons are gone (agent-specific style signature).
  assert.doesNotMatch(dashboard, /fontWeight: agentSubTab === "kanban" \? 600/);
});

test("the three agent sub-views keep their functionality under the shared shell", () => {
  const kanban = read("src/components/KanbanTab.tsx");
  const table = read("src/components/KanbanTableView.tsx");
  const panel = read("src/components/AgentsPanel.tsx");
  // Kanban: MCP source, create modal, batch runner and drag board stay; only
  // the duplicate h2 left (count stays inline with the controls).
  assert.match(kanban, /studio_list_cards/);
  assert.match(kanban, /setShowCreateModal\(true\)/);
  assert.match(kanban, /onClick=\{runBatch\}/);
  assert.match(kanban, /vía MCP \(studio_list_cards\)/);
  assert.doesNotMatch(kanban, /Design Kanban<\/h2>/);
  // Table: status filter, live count and sync stay.
  assert.match(table, /statusFilter/);
  assert.match(table, />Sincronizar<\/button>/);
  // Agents roster: role cards, lifecycle steps and the one-feature rule stay;
  // only the duplicate intro left.
  assert.match(panel, /const AGENTS: AgentCard\[\] = \[/);
  assert.match(panel, /const lifecycleSteps = \[/);
  assert.match(panel, /una feature a la vez/i);
  assert.doesNotMatch(panel, /Infraestructura de Agentes<\/h2>/);
});
