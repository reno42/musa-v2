/**
 * Regression guard for the HTML pattern-fill MCP capability.
 *
 * The MCP server is intentionally a single Netlify function, so this test
 * asserts the public contract and the safety/persistence path without needing
 * a live Supabase instance.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const mcp = readFileSync(new URL("../netlify/functions/mcp.mjs", import.meta.url), "utf8");
const catalog = mcp.slice(mcp.indexOf("const MCP_TOOLS = ["), mcp.indexOf("async function handleMethod"));
const handler = mcp.slice(mcp.indexOf('case "set_pattern_fill"'), mcp.indexOf('case "outline_stroke"'));

test("set_pattern_fill is advertised with a bounded pattern contract", () => {
  assert.match(catalog, /name: "set_pattern_fill"/);
  assert.match(catalog, /"dots", "grid", "diagonal-lines", "checkerboard", "none"/);
  assert.match(catalog, /size: \{ type: "number", minimum: 2, maximum: 512/);
  assert.match(catalog, /required: \["templateId", "frameId", "layerId", "pattern"\]/);
});

test("set_pattern_fill validates input and persists generated CSS", () => {
  assert.match(handler, /safeCssColor/);
  assert.match(handler, /color and backgroundColor must be a hex, named, rgb\(a\), or hsl\(a\) CSS color/);
  assert.match(handler, /set_pattern_fill supports HTML layers/);
  assert.match(handler, /radial-gradient/);
  assert.match(handler, /repeating-linear-gradient/);
  assert.match(handler, /conic-gradient/);
  assert.match(handler, /background-image/);
  assert.match(handler, /await templates\.updateTemplate/);
});
