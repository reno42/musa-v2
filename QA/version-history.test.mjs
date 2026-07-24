/**
 * Version history — pure logic tests (no Supabase needed).
 *
 * Covers the two pieces agents and the History panel depend on:
 *  - hashFrameContent: the identity used to decide "did this frame change?"
 *  - compareFrameSets: the added/removed/modified/unchanged rule behind
 *    diff_versions, which is what tells an agent WHAT a human edited.
 *
 * Run: node --test QA/version-history.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const modPath = "file://" + resolve(__dirname, "..", "api", "src", "services", "versionDiff.ts");

const { hashFrameContent, compareFrameSets } = await import(modPath);

const frame = (id, html, css = "", name = undefined) => ({ id, html, css, name });

describe("hashFrameContent", () => {
  it("is stable for identical content", () => {
    assert.equal(hashFrameContent("<p>a</p>", "p{}"), hashFrameContent("<p>a</p>", "p{}"));
  });

  it("changes when the html changes", () => {
    assert.notEqual(hashFrameContent("<p>a</p>", ""), hashFrameContent("<p>b</p>", ""));
  });

  it("changes when only the css changes", () => {
    assert.notEqual(hashFrameContent("<p>a</p>", "p{color:red}"), hashFrameContent("<p>a</p>", "p{color:blue}"));
  });

  it("does not collide across the html/css boundary", () => {
    // "ab" + "" must not hash like "a" + "b"
    assert.notEqual(hashFrameContent("ab", ""), hashFrameContent("a", "b"));
  });
});

describe("compareFrameSets", () => {
  it("marks an edited frame as modified and carries both sides", () => {
    const before = [frame("f1", "<h1>Viejo</h1>", "h1{font-size:20px}", "Hero")];
    const after = [frame("f1", "<h1>Nuevo</h1>", "h1{font-size:20px}", "Hero")];
    const [diff] = compareFrameSets(before, after);
    assert.equal(diff.status, "modified");
    assert.equal(diff.frameId, "f1");
    assert.equal(diff.frameName, "Hero");
    assert.equal(diff.before.html, "<h1>Viejo</h1>");
    assert.equal(diff.after.html, "<h1>Nuevo</h1>");
  });

  it("marks untouched frames as unchanged", () => {
    const same = [frame("f1", "<p>igual</p>", "p{}")];
    const [diff] = compareFrameSets(same, [...same]);
    assert.equal(diff.status, "unchanged");
  });

  it("detects added and removed frames", () => {
    const before = [frame("f1", "a"), frame("f2", "b")];
    const after = [frame("f1", "a"), frame("f3", "c")];
    const byId = Object.fromEntries(compareFrameSets(before, after).map(d => [d.frameId, d]));
    assert.equal(byId.f1.status, "unchanged");
    assert.equal(byId.f2.status, "removed");
    assert.equal(byId.f3.status, "added");
    assert.equal(byId.f2.after, null);
    assert.equal(byId.f3.before, null);
  });

  it("narrows to a single frame when asked", () => {
    const before = [frame("f1", "a"), frame("f2", "b")];
    const after = [frame("f1", "A"), frame("f2", "B")];
    const diffs = compareFrameSets(before, after, "f2");
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].frameId, "f2");
    assert.equal(diffs[0].after.html, "B");
  });

  it("treats css-only edits as modified (a restyle is a change)", () => {
    const before = [frame("f1", "<p>x</p>", "p{color:red}")];
    const after = [frame("f1", "<p>x</p>", "p{color:blue}")];
    assert.equal(compareFrameSets(before, after)[0].status, "modified");
  });

  it("survives frames missing html or css", () => {
    const diffs = compareFrameSets([{ id: "f1" }], [{ id: "f1", html: "<p>now</p>" }]);
    assert.equal(diffs[0].status, "modified");
    assert.equal(diffs[0].before.html, "");
  });
});
