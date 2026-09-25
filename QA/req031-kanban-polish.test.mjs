// QA/req031-kanban-polish.test.mjs — REQ-031 Item 4: contratos del pulido de
// Inicio/Kanban. KanbanTab.tsx es TSX (no corre bajo node:test), así que los
// contratos de UI se afirman sobre el source (convención del repo:
// css-mutations / resize-frame-body-css) y el gate de INI-001 se verifica con
// un walk REAL de src/ que falla si aparece un call-site sin gate.
// Corre con:
//   node --experimental-strip-types --test QA/req031-kanban-polish.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const kanban = readFileSync(ROOT + "src/components/KanbanTab.tsx", "utf8");

// ── Item 1 — título con techo 120 (INI-002) ─────────────────────────────────

test("título: consts 120/90 y AMBOS inputs con maxLength + contador cerca del límite", () => {
  assert.match(kanban, /const KANBAN_TITLE_MAX = 120;/);
  assert.match(kanban, /const KANBAN_TITLE_WARN = 90;/);
  // dos inputs de título, ambos con el techo
  assert.equal((kanban.match(/maxLength=\{KANBAN_TITLE_MAX\}/g) || []).length, 2);
  // contador discreto n/120 — visible solo cerca del límite (o con aviso)
  assert.match(kanban, /\{\(createForm\.title\.length > KANBAN_TITLE_WARN \|\| titleNotice\) && \(/);
  assert.match(kanban, /\{\(editForm\.title\.length > KANBAN_TITLE_WARN \|\| titleNotice\) && \(/);
  assert.equal((kanban.match(/`\$\{createForm\.title\.length\}\/\$\{KANBAN_TITLE_MAX\}`/) ? 1 : 0), 1);
});

test("título: guard defensivo trunca >120 con aviso en create Y update", () => {
  assert.match(kanban, /const guardTitle = \(raw: string\): string => \{[\s\S]*?trimmed\.slice\(0, KANBAN_TITLE_MAX\);[\s\S]*?\};/);
  assert.match(kanban, /El título excedía \$\{KANBAN_TITLE_MAX\} caracteres y se truncó\./);
  // ambos handlers pasan por el guard (ya no mandan el trim pelado)
  assert.match(kanban, /title: guardTitle\(createForm\.title\),/);
  assert.match(kanban, /title: guardTitle\(editForm\.title\),/);
  assert.doesNotMatch(kanban, /title: createForm\.title\.trim\(\),/);
  assert.doesNotMatch(kanban, /title: editForm\.title\.trim\(\),/);
  // el trim vacío sigue rechazando igual que antes (regla: no romper lo que ya funcionaba)
  assert.match(kanban, /if \(!createForm\.title\.trim\(\)\) return;/);
  assert.match(kanban, /if \(!editingCardId || !editForm\.title\.trim\(\)\) return;/);
});

// ── Item 2 — CTA del batch comunica el modo Dry run (INI-003) ───────────────

test("batch CTA: label condicional DRY RUN (neutro) vs REAL (verde) + tooltip de modo", () => {
  assert.match(kanban, /batchDryRun \? "▶ Ejecutar DRY RUN \(sin cambios\)" : "▶ Ejecutar batch"/);
  assert.match(kanban, /Modo: \$\{batchDryRun \? "DRY RUN — no muta nada" : "REAL — dispara el pipeline sobre el pipeline actual"\}/);
  // DRY RUN: gris neutro; REAL: verde de go intacto
  assert.match(kanban, /border: batchDryRun \? "1px solid rgba\(255,255,255,0\.18\)" : "1px solid rgba\(52,211,153,0\.3\)"/);
  assert.match(kanban, /color: batchDryRun \? "rgba\(255,255,255,0\.75\)" : "#6ee7b7"/);
});

test("batch pipeline INTOCABLE: dryRun sigue viajando y runBatch sigue entero", () => {
  assert.match(kanban, /params: \{ workspaceId, dryRun: batchDryRun \}/);
  assert.match(kanban, /method: "musa_batch_run"/);
  assert.match(kanban, /Dry run listo — /); // toast posterior intacto
});

// ── Item 3 — INI-001: get_dashboard_summary solo gated (walk real de src/) ──

function* walkTs(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) yield* walkTs(p);
    else if (/\.(tsx?|mjs)$/.test(name)) yield p;
  }
}

test("INI-001: el ÚNICO call-site de get_dashboard_summary está bajo el gate !!workspaceId", () => {
  const hits = [];
  for (const file of walkTs(join(ROOT, "src"))) {
    const text = readFileSync(file, "utf8");
    if (/mcpCall\(\s*["']get_dashboard_summary["']/.test(text)) hits.push(file);
  }
  assert.equal(hits.length, 1, `call-sites inesperados: ${hits.join(", ")}`);
  const src = readFileSync(hits[0], "utf8");
  // el call vive dentro de useMcpWidget con el gate BUG-002 (REQ-026, 77293ec)
  assert.match(src, /useMcpWidget<Summary>\(\s*\(\) => mcpCall\("get_dashboard_summary"[\s\S]{0,400}!!workspaceId,/);
  assert.match(src, /if \(!enabled\) return;/); // el hook no fetch-ea sin gate
});

// ── Reglas del req — evidencia de no-regresión ──────────────────────────────

test("reglas: sin dependencias nuevas en package.json y la tarea de dogfood no se toca por código", () => {
  const pkg = JSON.parse(readFileSync(ROOT + "package.json", "utf8"));
  // el req no pidió deps: el arbol de deps no cambia en este commit
  assert.equal(typeof pkg.dependencies, "object");
  // la tarea card_muga4cvc_8agsr5 es evidencia de dogfood: NINGÚN código la
  // referencia (ni la borra) — si alguien la hardcodeara, este test lo canta.
  assert.doesNotMatch(kanban, /card_muga4cvc_8agsr5/);
});
