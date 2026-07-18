/**
 * DocumentStore unit tests (pure, no DOM).
 * Run: node --test QA/documentStore.test.mjs
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const storePath = "file://" + resolve(__dirname, "..", "src", "lib", "documentStore.ts");

const { DocumentStore } = await import(storePath);

function makeFrame(id, overrides = {}) {
  return {
    id,
    name: `Frame ${id}`,
    x: 0, y: 0,
    width: 1080, height: 1080,
    html: `<div data-layer-id="a">Hello</div>`,
    css: `body { background: #fff; }`,
    background: "#ffffff",
    ...overrides,
  };
}

describe("DocumentStore", () => {
  /** @type {DocumentStore} */
  let store;

  before(() => {
    store = new DocumentStore([
      makeFrame("f1", { name: "A" }),
      makeFrame("f2", { name: "B" }),
      makeFrame("f3", { name: "C" }),
    ]);
  });

  it("returns initial snapshot", () => {
    assert.equal(store.frames.length, 3);
    assert.equal(store.frames[0].name, "A");
    assert.equal(store.frames[2].name, "C");
  });

  it("rejects apply() without begin()", () => {
    assert.throws(
      () => store.apply("f1", { name: "X" }),
      /No transaction in progress/,
    );
  });

  it("commits a single-patch transaction", () => {
    store.begin("rename");
    store.apply("f1", { name: "Alpha" });
    store.commit();

    assert.equal(store.frames[0].name, "Alpha");
    assert.equal(store.canUndo, true);
    assert.equal(store.undoLabel, "rename");
  });

  it("undo reverts the rename", () => {
    const didUndo = store.undo();
    assert.equal(didUndo, true);
    assert.equal(store.frames[0].name, "A");
    assert.equal(store.canRedo, true);
  });

  it("redo re-applies the rename", () => {
    const didRedo = store.redo();
    assert.equal(didRedo, true);
    assert.equal(store.frames[0].name, "Alpha");
    assert.equal(store.canUndo, true);
  });

  it("undo returns false when stack is empty", () => {
    // Undo the one tx we have
    store.undo();
    assert.equal(store.undo(), false);
  });

  it("rollback discards pending transaction", () => {
    const nameBefore = store.frames[1].name; // "B"
    store.begin("try-rename");
    store.apply("f2", { name: "Beta" });
    assert.equal(store.frames[1].name, "Beta");
    store.rollback();
    assert.equal(store.frames[1].name, nameBefore);
    assert.equal(store.isInTransaction, false);
  });

  it("multiple apply() calls within one transaction", () => {
    store.begin("multi");
    store.apply("f1", { x: 100 });
    store.apply("f1", { y: 200 });
    store.apply("f2", { name: "Two" });
    store.commit();

    assert.equal(store.frames[0].x, 100);
    assert.equal(store.frames[0].y, 200);
    assert.equal(store.frames[1].name, "Two");
    // One undo reverts ALL three changes
    store.undo();
    assert.equal(store.frames[0].x, 0);
    assert.equal(store.frames[0].y, 0);
    assert.equal(store.frames[0].name, "A");
    assert.equal(store.frames[1].name, "B");
  });

  it("max undo stack truncates oldest entries", () => {
    // Push 90 transactions (max is 80)
    for (let i = 0; i < 90; i++) {
      store.begin(`tx-${i}`);
      store.apply("f1", { name: `Iteration ${i}` });
      store.commit();
    }
    store.undo();
    assert.equal(store.frames[0].name.startsWith("Iteration"), true);
  });

  it("replaceAll resets undo stack", () => {
    store.replaceAll([makeFrame("fA"), makeFrame("fB")]);
    assert.equal(store.frames.length, 2);
    assert.equal(store.canUndo, false);
    assert.equal(store.canRedo, false);
  });

  it("addFrames adds with optional transaction", () => {
    store.replaceAll([]);
    store.addFrames([makeFrame("n1"), makeFrame("n2")], "add-two");
    assert.equal(store.frames.length, 2);
    assert.equal(store.canUndo, true);
    store.undo();
    assert.equal(store.frames.length, 0);
  });

  it("removeFrames with transaction", () => {
    store.replaceAll([makeFrame("r1"), makeFrame("r2"), makeFrame("r3")]);
    store.removeFrames(["r1", "r3"], "remove-two");
    assert.equal(store.frames.length, 1);
    assert.equal(store.frames[0].id, "r2");
    store.undo();
    assert.equal(store.frames.length, 3);
  });

  it("moveFrames with transaction", () => {
    store.replaceAll([makeFrame("m1", { x: 0, y: 0 }), makeFrame("m2", { x: 50, y: 50 })]);
    store.moveFrames([{ id: "m1", x: 100, y: 200 }], "move");
    assert.equal(store.frames[0].x, 100);
    assert.equal(store.frames[0].y, 200);
    store.undo();
    assert.equal(store.frames[0].x, 0);
  });

  it("subscribe notifies on commit, undo, redo", () => {
    let calls = 0;
    const unsub = store.subscribe(() => calls++);

    store.begin("sub-test");
    store.apply("m1", { name: "Sub1" });
    store.commit();
    assert.equal(calls, 1);

    store.undo();
    assert.equal(calls, 2);

    store.redo();
    assert.equal(calls, 3);

    unsub();
    store.undo();
    assert.equal(calls, 3); // no longer subscribed
  });

  it("undo/redo are idempotent (double undo = false)", () => {
    store.replaceAll([makeFrame("d1")]);
    store.begin("test");
    store.apply("d1", { name: "Changed" });
    store.commit();

    assert.equal(store.undo(), true);
    assert.equal(store.undo(), false); // stack empty
    assert.equal(store.redo(), true);
    assert.equal(store.redo(), false); // stack empty
  });

  it("clearHistory empties undo/redo", () => {
    store.begin("test");
    store.apply("d1", { name: "With history" });
    store.commit();
    assert.equal(store.canUndo, true);
    store.clearHistory();
    assert.equal(store.canUndo, false);
    assert.equal(store.canRedo, false);
  });
});
