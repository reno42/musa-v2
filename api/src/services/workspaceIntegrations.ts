import dns from "node:dns/promises";
import net from "node:net";
import crypto from "node:crypto";
import { getSupabaseAdmin } from "./supabase.js";
import { decryptWorkspaceSecret } from "./secrets.js";

function isPrivateAddress(address: string) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return address === "::1" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:");
}

export async function assertSafeIntegrationEndpoint(rawUrl: string) {
  const url = new URL(rawUrl);
  const allowLocal = process.env.NODE_ENV !== "production" && process.env.ALLOW_LOCAL_MCP_ENDPOINTS === "true";
  if (url.protocol !== "https:" && !(allowLocal && url.protocol === "http:")) {
    throw new Error("Integration endpoints must use HTTPS");
  }
  if (!allowLocal) {
    const addresses = await dns.lookup(url.hostname, { all: true });
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
      throw new Error("Private or local integration endpoints are not allowed");
    }
  }
  return url;
}

function safeCredentialHeaders(credentials: Record<string, unknown> | undefined) {
  const source = credentials?.headers;
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const blocked = new Set(["host", "content-length", "connection", "cookie", "transfer-encoding"]);
  return Object.fromEntries(Object.entries(source as Record<string, unknown>)
    .filter(([key, value]) => !blocked.has(key.toLowerCase()) && typeof value === "string"));
}

export async function callWorkspaceMcp(
  workspaceId: string,
  connectionId: string,
  toolName: string,
  args: Record<string, unknown>,
) {
  const sb = getSupabaseAdmin();
  if (!sb) throw new Error("Supabase is required for workspace MCP connections");
  const { data, error } = await sb.from("workspace_mcp_connections")
    .select("id, endpoint_url, enabled, credentials_encrypted")
    .eq("id", connectionId)
    .eq("workspace_id", workspaceId)
    .eq("kind", "mcp")
    .maybeSingle();
  if (error || !data || !data.enabled) throw new Error("Enabled MCP connection not found");

  const endpoint = await assertSafeIntegrationEndpoint(data.endpoint_url);
  const credentials = data.credentials_encrypted
    ? decryptWorkspaceSecret<Record<string, unknown>>(data.credentials_encrypted)
    : undefined;
  const response = await fetch(endpoint, {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...safeCredentialHeaders(credentials),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Workspace MCP returned HTTP ${response.status}`);
  const payload = await response.json() as any;
  if (payload.error) throw new Error(payload.error.message || "Workspace MCP call failed");
  return payload.result;
}
