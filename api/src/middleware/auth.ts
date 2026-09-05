import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { getSupabaseAdmin, getSupabaseAuthClient } from "../services/supabase.js";
import { withRequestAuth, type RequestAuth } from "../services/requestContext.js";
import { isZernioWebhookRequest } from "../../../shared/socialPublishRequest.ts";
import { validateBearerToken } from "../services/bearerValidation.js";

declare global {
  namespace Express {
    interface Request {
      auth?: RequestAuth;
      /** Set by requireTemplateAccess so routes need not look it up again. */
      templateWorkspaceId?: string;
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
  const authClient = getSupabaseAuthClient() || sb;

  const proceed = (authData: RequestAuth) => {
    req.auth = authData;
    return withRequestAuth(authData, next);
  };

  const publicInvitationPreview = req.method === "GET" && req.path.startsWith("/api/invitations/");
  // Guest mobile comments: the /c/:templateId share page has no account and
  // no API key. Writes stay protected by the global rateLimit plus the
  // route's own per-IP POST cap.
  const publicCommentShare = req.path.startsWith("/api/comments-share/");
  const signedZernioWebhook = isZernioWebhookRequest(req.method, req.path);
  if (req.method === "OPTIONS" || publicInvitationPreview || req.path === "/api/health" || req.path === "/api/health/storage" || req.path === "/api/auth/config" || req.path === "/api/fonts/catalog" || publicCommentShare || signedZernioWebhook) {
    return proceed({ userId: "anonymous", authType: "dev" });
  }

  if (bearer && authClient) {
    try {
      const userId = await validateBearerToken(authClient, bearer);
      if (userId) {
        return proceed({ userId, authType: "user", accessToken: bearer });
      }
    } catch (error: any) {
      // A Supabase outage or timeout is not an invalid session. Tell the client
      // it can retry instead of converting infrastructure latency into a 401.
      res.setHeader("Retry-After", "1");
      return res.status(503).json({
        success: false,
        error: "Authentication service temporarily unavailable. Retry in a moment.",
        reason: "auth_service_unavailable",
      });
    }
  }

  // Preserve zero-config local development only when no database/auth service exists.
  if (!adminKey && !authClient) {
    if (apiKey) return proceed({ userId: apiKey, isAdmin: true, authType: "dev" });
    if (bearer) return proceed({ userId: bearer, authType: "dev" });
    return proceed({ userId: "dev_user_default", isAdmin: true, authType: "dev" });
  }

  if (adminKey && apiKey === adminKey) {
    return proceed({ userId: "admin", isAdmin: true, authType: "admin" });
  }

  if (apiKey && sb) {
    try {
      // Look up without filtering so we can return a specific failure reason
      const { data: rawRow } = await sb.from("workspace_api_keys")
        .select("id, created_by, workspace_id, role, label, revoked_at, expires_at")
        .eq("key_hash", keyHash(apiKey))
        .maybeSingle();
      if (rawRow) {
        if (rawRow.revoked_at) {
          return res.status(401).json({ success: false, error: `API key revoked at ${rawRow.revoked_at}. Generate a new key at Settings → API Keys.`, reason: "key_revoked" });
        }
        if (rawRow.expires_at && new Date(rawRow.expires_at) <= new Date()) {
          return res.status(401).json({ success: false, error: `API key expired at ${rawRow.expires_at}. Generate a new key at Settings → API Keys.`, reason: "key_expired" });
        }
        void sb.from("workspace_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", rawRow.id);
        return proceed({
          userId: rawRow.created_by,
          authType: "workspace_key",
          workspaceId: rawRow.workspace_id,
          workspaceRole: rawRow.role,
          keyId: rawRow.id,
        });
      }
      return res.status(401).json({ success: false, error: "API key not found in database. Verify the key or create a new one at Settings → API Keys. Use the MCP tool verify_api_key for full diagnostics.", reason: "key_not_found" });
    } catch (err: any) {
      return res.status(401).json({ success: false, error: `Database error during key validation: ${err?.message || err}. Retry in a moment.`, reason: "database_error" });
    }
  }

  res.status(401).json({ success: false, error: "Unauthorized: sign in or provide a valid workspace API key", reason: "no_credentials" });
}

export function requireUserSession(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.authType !== "user") {
    return res.status(403).json({ success: false, error: "A signed-in user session is required" });
  }
  next();
}
