// REQ-026 Item 4 — tests de normalizeTask (guard compartido del Kanban).
// Run: node --experimental-strip-types --test QA/kanban-normalize.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { normalizeAcceptance, normalizeTask } = await import("../src/lib/kanbanNormalize.ts");

// ── Unit: normalizeAcceptance — los 7 casos del req ──
test("array pasa intacto", () => {
  assert.deepEqual(normalizeAcceptance(["a", "b"]), ["a", "b"]);
});

test("string multilínea → split + trim + sin vacíos (fila legacy real)", () => {
  const legacy = "  C1: compila sin errores  \n\nC2: acceptance verde en checkpoints\n   ";
  assert.deepEqual(
    normalizeAcceptance(legacy),
    ["C1: compila sin errores", "C2: acceptance verde en checkpoints"],
  );
});

test("string de 1 línea → array de 1", () => {
  assert.deepEqual(normalizeAcceptance("única línea"), ["única línea"]);
});

test("null → []", () => {
  assert.deepEqual(normalizeAcceptance(null), []);
});

test("undefined → []", () => {
  assert.deepEqual(normalizeAcceptance(undefined), []);
});

test("objeto {} → []", () => {
  assert.deepEqual(normalizeAcceptance({}), []);
});

test("número → []", () => {
  assert.deepEqual(normalizeAcceptance(42), []);
});

// ── Unit: normalizeTask preserva el resto de la tarjeta ──
test("normalizeTask normaliza acceptance y conserva los demás campos", () => {
  const card = {
    id: "card_ms7xkdc8_rqglyx",
    title: "Hola Ren",
    status: "backlog",
    priority: 2,
    acceptance: "paso 1\npaso 2",
  };
  const out = normalizeTask(card);
  assert.deepEqual(out.acceptance, ["paso 1", "paso 2"]);
  assert.equal(out.id, card.id);
  assert.equal(out.title, card.title);
  assert.equal(out.status, card.status);
  assert.equal(out.priority, card.priority);
});

test("normalizeTask con acceptance array no muta la entrada", () => {
  const card = { id: "x", acceptance: ["a"] };
  const out = normalizeTask(card);
  assert.deepEqual(out.acceptance, ["a"]);
  assert.deepEqual(card.acceptance, ["a"]);
  assert.notEqual(out, card);
});

// ── Contrato BUG-001: ninguna fila cruda llega al render de Tabla ──
// El req pide test de render del PeekPanel con fila acceptance-string;
// render real necesita jsdom/vitest (dependencia nueva — prohibida por
// el req). Este contrato fija el mismo invariante a nivel fuente: TODOS
// los setTasks de KanbanTableView pasan por normalizeTask (cache y
// fetch), y el único .acceptance.map se alimenta de ese estado.
const viewSrc = readFileSync(new URL("../src/components/KanbanTableView.tsx", import.meta.url), "utf8");

test("KanbanTableView importa el normalizador compartido", () => {
  assert.match(viewSrc, /import \{ normalizeTask \} from "\.\.\/lib\/kanbanNormalize"/);
});

test("KanbanTableView: todo setTasks pasa por normalizeTask (cache + fetch)", () => {
  const calls = [...viewSrc.matchAll(/setTasks\(([^;]*?)\);/g)].map(m => m[1]);
  assert.equal(calls.length, 2, `esperados 2 setTasks (cache y fetch), hay ${calls.length}`);
  for (const call of calls) {
    assert.ok(call.includes("normalizeTask"), `setTasks sin normalizeTask: setTasks(${call})`);
  }
});

test("KanbanTab consume el módulo compartido en cache y fetch", () => {
  const tabSrc = readFileSync(new URL("../src/components/KanbanTab.tsx", import.meta.url), "utf8");
  assert.match(tabSrc, /import \{ normalizeTask \} from "\.\.\/lib\/kanbanNormalize"/);
  assert.match(tabSrc, /setTasks\(cached\.cards\.map\(normalizeTask\)\)/);
  assert.match(tabSrc, /\(data\.cards \|\| \[\]\)\.map\(normalizeTask\)/);
});
