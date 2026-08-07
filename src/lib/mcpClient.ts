import { apiFetch } from "./supabase";

/**
 * JSON-RPC 2.0 helper: POST to /mcp, parse response, throw on error.
 * Reusable across all UI panels that call MCP tools.
 *
 * @example
 *   const result = await mcpCall("set_blur", { templateId: "tpl_...", blur: 6 });
 */
export async function mcpCall(method: string, params: Record<string, any>, signal?: AbortSignal) {
  console.debug("[mcpCall]", method, params);
  try {
    const json = await apiFetch<any>("/mcp", {
      method: "POST",
      signal,
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    });
    console.debug("[mcpCall] response:", { hasError: !!json.error, hasResult: !!json.result, keys: json ? Object.keys(json) : [] });
    if (json.error) {
      console.warn("[mcpCall] JSON-RPC error:", json.error);
      throw new Error(json.error.message || "MCP error");
    }
    // Unwrap MCP content wrapper if present
    if (json.result?.content?.[0]?.type === "text") {
      try {
        return JSON.parse(json.result.content[0].text);
      } catch {
        return json.result;
      }
    }
    return json.result;
  } catch (err: any) {
    console.error("[mcpCall] FAILED:", method, err?.message || err);
    throw err;
  }
}
