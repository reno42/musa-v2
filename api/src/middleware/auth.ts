import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { getSupabaseAdmin } from "../services/supabase.js";
import { withRequestAuth, type RequestAuth } from "../services/requestContext.js";

declare global {
  namespace Express {
    interface Request {
      auth?: RequestAuth;
    }
  }
}

function keyHash(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

export async function auth(req: Request, res: Response, next: NextFunction) {
  const adminKey = process.env.MCP_ADMIN_KEY;
  const apiKey = (req.headers["x-api-key"] as string) || "";
  const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const sb = getSupabaseAdmin();

  const proceed = (authData: RequestAuth) => {
    req.auth = authData;
    return withRequestAuth(authData, next);
  };

  if (req.method === "OPTIONS" || req.path === "/api/health" || req.path === "/api/health/storage" || req.path === "/api/fonts/catalog") {
    return proceed({ userId: "anonymous", authType: "dev" });
  }

  if (bearer && sb) {
    try {
      const { data, error } = await sb.auth.getUser(bearer);
      if (!error && data.user) {
        return proceed({ userId: data.user.id, authType: "user", accessToken: bearer });
      }
    } catch { /* reject below */ }
  }

  // Preserve zero-config local development only when no database/auth service exists.
  if (!adminKey && !sb) {
    if (apiKey) return proceed({ userId: apiKey, isAdmin: true, authType: "dev" });
    if (bearer) return proceed({ userId: bearer, authType: "dev" });
    return proceed({ userId: "dev_user_default", isAdmin: true, authType: "dev" });
  }

  if (adminKey && apiKey === adminKey) {
    return proceed({ userId: "admin", isAdmin: true, authType: "admin" });
  }

  if (apiKey && sb) {
    try {
      const { data } = await sb.from("workspace_api_keys")
        .select("id, created_by, workspace_id, role")
        .eq("key_hash", keyHash(apiKey))
        .is("revoked_at", null)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .maybeSingle();
      if (data) {
        void sb.from("workspace_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
        return proceed({
          userId: data.created_by,
          authType: "workspace_key",
          workspaceId: data.workspace_id,
          workspaceRole: data.role,
          keyId: data.id,
        });
      }
    } catch { /* reject below */ }
  }

  res.status(401).json({ success: false, error: "Unauthorized: sign in or provide a valid workspace API key" });
}

export function requireUserSession(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.authType !== "user") {
    return res.status(403).json({ success: false, error: "A signed-in user session is required" });
  }
  next();
}
