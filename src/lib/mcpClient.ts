import { apiFetch } from "./supabase";

/**
 * JSON-RPC 2.0 helper: POST to /mcp, parse response, throw on error.
 * Reusable across all UI panels that call MCP tools.
 *
 * @example
 *   const result = await mcpCall("set_blur", { templateId: "tpl_...", blur: 6 });
 */
export async function mcpCall(method: string, params: Record<string, any>) {
  const res = await apiFetch("/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "MCP error");
  return json.result;
}
