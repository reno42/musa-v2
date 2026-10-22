import assert from "node:assert/strict";
import test from "node:test";
import {
  createInitializeResponse,
  createInitializedNotificationResponse,
  createToolsListResponse,
} from "../worker/runtime/functions/mcp-lifecycle.mjs";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json; charset=utf-8",
};

test("Streamable HTTP handshake accepts the initialized notification without a response body", () => {
  const initialize = createInitializeResponse(1, headers, {
    protocolVersion: "2024-11-05",
    capabilities: { tools: { listChanged: true } },
    serverInfo: { name: "futuraria-mcp", version: "1.0.0" },
  });
  assert.equal(initialize.statusCode, 200);
  assert.deepEqual(JSON.parse(initialize.body), {
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: "2024-11-05",
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: "futuraria-mcp", version: "1.0.0" },
    },
  });

  const initialized = createInitializedNotificationResponse(undefined, headers);
  assert.equal(initialized.statusCode, 202);
  assert.equal(initialized.body, "");
  assert.equal(initialized.headers["Content-Type"], undefined);

  const tools = [{ name: "list_workspaces" }, { name: "create_template" }];
  const toolsList = createToolsListResponse(2, headers, tools);
  assert.equal(toolsList.statusCode, 200);
  assert.deepEqual(JSON.parse(toolsList.body), {
    jsonrpc: "2.0",
    id: 2,
    result: { tools },
  });
});

test("a nonstandard initialized request carrying an id remains backward compatible", () => {
  const response = createInitializedNotificationResponse("legacy-client", headers);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    jsonrpc: "2.0",
    id: "legacy-client",
    result: {},
  });
});
