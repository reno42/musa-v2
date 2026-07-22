import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";

export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";

export type RequestAuth = {
  userId: string;
  isAdmin?: boolean;
  authType: "user" | "workspace_key" | "admin" | "dev";
  accessToken?: string;
  workspaceId?: string;
  workspaceRole?: WorkspaceRole;
  keyId?: string;
  scopedClient?: SupabaseClient;
};

const REQUEST_CONTEXT_KEY = Symbol.for("futuraria.requestContext");
const requestContext = ((globalThis as any)[REQUEST_CONTEXT_KEY] ||= new AsyncLocalStorage<RequestAuth>()) as AsyncLocalStorage<RequestAuth>;

export function withRequestAuth<T>(auth: RequestAuth, callback: () => T): T {
  return requestContext.run(auth, callback);
}

export function getRequestAuth(): RequestAuth | undefined {
  return requestContext.getStore();
}
