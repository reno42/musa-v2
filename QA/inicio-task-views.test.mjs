// v59 — Inicio task views regression invariants (ex pestaña Agentes).
//
// What this guards:
//   • the Agentes tab is GONE: no nav section, no route, no render branch —
//     Kanban/Tabla live as sub-tabs of Inicio (ex Agentes, v59)
//   • the hidden "Infraestructura de agentes" view stays in the repo
//     (AgentsPanel.tsx + its AGENT_VIEWS entry) but has no pane, no nav entry
//     and no import, so nothing renders it
//   • the two task views keep the shared CRM hierarchy (glass top card, serif
//     h1, per-view descriptor, icon-only nav with hover labels) — and the
//     card only presents: no CTA buttons in it (v55)
//   • the views keep all their functionality under the shared shell
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

test("the Agentes tab is gone; Inicio owns Kanban/Tabla as sub-tabs", () => {
  const dashboard = read("src/components/Dashboard.tsx");
  // No nav section, no route, no render branch for the dead tab.
  assert.doesNotMatch(dashboard, /id: "agentes", label: "Agentes"/);
  assert.doesNotMatch(dashboard, /navToTab\("agentes/);
  assert.doesNotMatch(dashboard, /activeTab === "agentes"/);
  // Inicio lists the three views in order: Dashboard (initial), Kanban, Tabla.
  assert.match(dashboard,
    /id: "home", label: "Inicio"[\s\S]*?subs: \[\s*\{ id: "dashboard", label: "Dashboard" \}, \{ id: "kanban", label: "Kanban" \}, \{ id: "table", label: "Tabla" \},\s*\]/);
});

test("Infraestructura de agentes stays in the repo but is unreachable", () => {
  const dashboard = read("src/components/Dashboard.tsx");
  // The hidden entry keeps its metadata for a future comeback...
  assert.match(dashboard, /id: "agents",\s*\n\s*label: "Agentes",\s*\n\s*title: "Infraestructura de agentes"/);
  // ...but the shell maps HOME_TASK_VIEWS only, and AgentsPanel is no longer
  // imported (so the bundler drops it until the view returns).
  assert.doesNotMatch(dashboard, /from "\.\/AgentsPanel"/);
  assert.doesNotMatch(dashboard, /<AgentsPanel \/>/);
  assert.match(dashboard, /const HOME_VIEWS[\s\S]*?id: "dashboard"[\s\S]*?id: "kanban"[\s\S]*?id: "table"[\s\S]*?\];/);
});

test("Inicio task views wear the shared CRM hierarchy with three icon sub-tabs", () => {
  const dashboard = read("src/components/Dashboard.tsx");
  // The three views with their own descriptor — Dashboard first.
  assert.match(dashboard, /title: "Dashboard ejecutivo"/);
  assert.match(dashboard, /title: "Kanban de tareas"/);
  assert.match(dashboard, /title: "Tabla de tareas"/);
  // Shared glass top card + icon-only nav (hover shows the label), the same
  // pattern as the CRM views and Configuración — one shared nav rendered both
  // in the greeting card (via headerNav) and the Kanban/Tabla card.
  assert.match(dashboard, /function HomeViewNav/);
  assert.match(dashboard, /headerNav=\{<HomeViewNav current=\{homeSubTab\} onChange=\{setHomeSubTab\} \/>\}/);
  assert.match(dashboard, /className="crm-table-card crm-contacts-top" style=\{\{ flexShrink: 0 \}\}/);
  assert.match(dashboard, /role="tablist" aria-label="Vistas de inicio"/);
  assert.match(dashboard, /title=\{view\.label\}/);
  assert.match(dashboard, /"crm-nav-tab active" : "crm-nav-tab"/);
  // v55: the presentation card carries no CTAs — the cross-view buttons
  // (Ver como tabla / Abrir el tablero / Invita a tus IAs) lived in the card
  // and are gone; the icon tabs navigate and Configuración is top-nav.
  assert.doesNotMatch(dashboard, /ctaLabel|ctaTo/);
  assert.doesNotMatch(dashboard, /Ver como tabla|Abrir el tablero|Invita a tus IAs/);
});

test("the task views keep their functionality under the shared shell", () => {
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
  // Hidden roster: role cards, lifecycle steps and the one-feature rule stay
  // intact for its comeback.
  assert.match(panel, /const AGENTS: AgentCard\[\] = \[/);
  assert.match(panel, /const lifecycleSteps = \[/);
  assert.match(panel, /una feature a la vez/i);
});
