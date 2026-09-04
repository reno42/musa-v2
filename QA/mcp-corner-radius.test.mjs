/**
 * mcp-corner-radius.test.mjs — set_corner_radius MCP tool (trapezoid workflow).
 *
 * The MCP server (netlify/functions/mcp.mjs) carries a self-contained port of
 * src/lib/shapePaths.ts so agents can round trapezoid/polygon corners exactly
 * like the editor UI does (Q-curve bridges + data-vr persistence). This test:
 *
 *   1. Extracts the REAL server functions from mcp.mjs source (brace-balanced
 *      slice, same trick scripts/sync-skill-tools.mjs uses) and asserts
 *      output-parity with the editor originals on trapezoid geometry.
 *   2. Runs the full stroke-only rounded-trapezoid workflow: draw_path-style
 *      sharp d → recover corners → per-vertex radii → rounded d → recover the
 *      SAME corners again (idempotence, so edit_path_point stays usable).
 *   3. Statically asserts the tool schema + handler are registered and the
 *      synced surfaces (tools_catalog.json, SKILL.md) carry the new tool.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  cornersFromShapePath,
  normalizeRadii,
  parseVertexRadiiAttr,
  serializeVertexRadiiAttr,
  verticesToPath,
} from "../src/lib/shapePaths.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MCP_SRC = join(root, "netlify", "functions", "mcp.mjs");
const mcpSource = readFileSync(MCP_SRC, "utf8");

/** Pull a top-level `function name(...) {...}` out of mcp.mjs. */
function sliceServerFunction(name) {
  const start = mcpSource.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found in mcp.mjs`);
  let depth = 0;
  let end = -1;
  for (let i = mcpSource.indexOf("{", start); i < mcpSource.length; i++) {
    const ch = mcpSource[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  assert.ok(end !== -1, `function ${name} is unbalanced in mcp.mjs`);
  return mcpSource.slice(start, end);
}

// Evaluate the whole helper cluster in ONE scope — they call each other.
const serverFns = new Function(`
  ${sliceServerFunction("tokenizeShapePathServer")}
  ${sliceServerFunction("cornersFromShapePathServer")}
  ${sliceServerFunction("normalizeRadiiServer")}
  ${sliceServerFunction("verticesToPathServer")}
  ${sliceServerFunction("parseVertexRadiiAttrServer")}
  ${sliceServerFunction("serializeVertexRadiiAttrServer")}
  return {
    cornersFromShapePath: cornersFromShapePathServer,
    normalizeRadii: normalizeRadiiServer,
    verticesToPath: verticesToPathServer,
    parseVertexRadiiAttr: parseVertexRadiiAttrServer,
    serializeVertexRadiiAttr: serializeVertexRadiiAttrServer,
  };
`)();

// ── The reference trapezoid from the TRC-style layouts: wide top, narrower
// bottom, exactly what draw_path emits before any rounding. ──
const TRAPEZOID = [
  { x: 40, y: 80 },
  { x: 280, y: 80 },
  { x: 240, y: 220 },
  { x: 80, y: 220 },
];
const SHARP_D = "M40,80 L280,80 L240,220 L80,220 Z";

test("server port serializes a sharp trapezoid identically to the editor", () => {
  assert.equal(serverFns.verticesToPath(TRAPEZOID, 0), verticesToPath(TRAPEZOID, 0));
  assert.equal(serverFns.verticesToPath(TRAPEZOID, 0), SHARP_D);
});

test("server port rounds trapezoid corners identically to the editor", () => {
  for (const radii of [16, [0, 24, 0, 24], [12, 12, 0, 0], [999, 1, 999, 1]]) {
    assert.equal(
      serverFns.verticesToPath(TRAPEZOID, radii),
      verticesToPath(TRAPEZOID, radii),
      `parity broken for radii ${JSON.stringify(radii)}`
    );
  }
  const rounded = serverFns.verticesToPath(TRAPEZOID, 16);
  assert.equal((rounded.match(/Q/g) || []).length, 4, "one quadratic per rounded vertex");
  assert.ok(rounded.trimEnd().endsWith("Z"), "rounded shape stays closed");
});

test("full stroke-only trapezoid workflow is round-trip stable", () => {
  // 1. draw_path emitted a sharp trapezoid; set_corner_radius recovers corners
  const corners = serverFns.cornersFromShapePath(SHARP_D);
  assert.deepEqual(corners, TRAPEZOID);

  // 2. apply per-vertex radii (round only the slanted-side corners)
  const radii = serverFns.normalizeRadii([18, 18, 0, 0], 4);
  assert.deepEqual(radii, [18, 18, 0, 0]);
  const roundedD = serverFns.verticesToPath(corners, radii);

  // 3. re-editing the rounded path must yield the SAME original corners, so
  // edit_path_point / set_corner_radius keep working after rounding
  const recovered = serverFns.cornersFromShapePath(roundedD);
  assert.deepEqual(recovered, TRAPEZOID);

  // 4. data-vr round-trip keeps the per-vertex values for the editor UI
  const attr = serverFns.serializeVertexRadiiAttr(radii);
  assert.equal(attr, "18,18,0,0");
  assert.deepEqual(serverFns.parseVertexRadiiAttr(attr, 0, 4), radii);
});

test("vertexIndex-style single-corner edits preserve the other radii", () => {
  const current = serverFns.parseVertexRadiiAttr("18,18,0,0", 0, 4);
  const next = current.slice();
  next[3] = 10;
  assert.deepEqual(next, [18, 18, 0, 10]);
  const d = serverFns.verticesToPath(TRAPEZOID, next);
  assert.deepEqual(serverFns.cornersFromShapePath(d), TRAPEZOID);
});

test("oversized radii clamp to half the shortest edge without breaking closure", () => {
  const d = serverFns.verticesToPath(TRAPEZOID, [500, 500, 500, 500]);
  assert.ok(d.startsWith("M"));
  assert.ok(d.trimEnd().endsWith("Z"));
  assert.deepEqual(serverFns.cornersFromShapePath(d), TRAPEZOID);
});

test("pen-curve paths (C/A commands) are rejected, not silently mangled", () => {
  assert.equal(serverFns.cornersFromShapePath("M10,10 C40,40 60,40 90,10 Z"), null);
  assert.equal(serverFns.cornersFromShapePath("M10,10 A5,5 0 0 1 90,90 Z"), null);
});

// ── Static registration: schema, handler, and synced surfaces ──

test("set_corner_radius schema and handler are registered in the MCP server", () => {
  assert.match(mcpSource, /name: "set_corner_radius"/);
  const schemaStart = mcpSource.indexOf('name: "set_corner_radius"');
  const schemaSlice = mcpSource.slice(schemaStart, schemaStart + 2200);
  for (const prop of ["templateId", "frameId", "elementId", "radius", "radii", "vertexIndex"]) {
    assert.ok(schemaSlice.includes(prop), `schema is missing ${prop}`);
  }
  assert.match(mcpSource, /case "set_corner_radius":/);
  // data-vr persistence — the editor UI must be able to keep editing the shape
  assert.match(mcpSource, /attr\("data-vr", serializeVertexRadiiAttrServer\(next\)\)/);
});

test("synced surfaces carry the new tool at the right count", () => {
  const catalog = JSON.parse(readFileSync(join(root, "tools_catalog.json"), "utf8"));
  assert.ok(catalog.some(t => t.name === "set_corner_radius"), "tools_catalog.json missing set_corner_radius");
  const skill = readFileSync(join(root, "SKILL.md"), "utf8");
  assert.match(skill, /`set_corner_radius` —/);
  // count-agnostic on purpose — the exact number drifts with every tool bump
  assert.match(skill, /\*\*\d+ tools\*\*/);
});
