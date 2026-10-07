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
  // Render pages (PNG frame / video export): browser navigation carries no
  // headers. The page itself is data-free; the handler's internal template
  // fetch re-enters this middleware with the forwarded key/bearer, so data
  // only ever reaches an authorized caller.
  const publicRenderPage = req.method === "GET" && req.path.startsWith("/api/render/");
  // Guest mobile comments: the /c/:templateId share page has no account and
  // no API key. Writes stay protected by the global rateLimit plus the
  // route's own per-IP POST cap.
  const publicCommentShare = req.path.startsWith("/api/comments-share/");
  const signedZernioWebhook = isZernioWebhookRequest(req.method, req.path);
  // Internal webhook dispatch sweep — the secret IS the credential (the
  // route constant-time-compares it against WEBHOOK_DISPATCH_SECRET),
  // so the Cloudflare cron tick doesn't need a user session.
  const internalWebhookDispatch = req.method === "POST" && req.path === "/api/webhooks/dispatch";
  // The OpenAPI spec is public: Make/Zapier/Postman import it before any
  // account exists. It describes the API — it exposes no data.
  const publicOpenApi = req.path === "/api/openapi.json";
  // The webhook event catalog is public for the same reason: no-code
  // builders list it before any account exists. Static data, no user info.
  const publicWebhookEvents = req.method === "GET" && req.path === "/api/webhooks/events";
  // REQ-027 Flows webhook trigger: the secret IS the credential (the route
  // compares sha256(secret) against flows.trigger.secretHash — the raw secret
  // never lives in the DB). Same model as internalWebhookDispatch: no user
  // session; the global rateLimit still applies.
  const flowsWebhookTrigger = req.method === "POST" && req.path.startsWith("/api/flows/webhook/");
  // F6 OAuth2 callback: público por diseño — el navegador del proveedor llega
  // sin sesión; la única llave es el state cifrado (AES-256-GCM, 10 min) que
  // solo flow_oauth2_connect puede emitir. Global rateLimit sigue aplicando.
  const flowsOauth2Callback = req.method === "GET" && req.path === "/api/flows/oauth2/callback";
  // Vitrina de skills: catálogo de solo lectura de los SKILL.md — estático
  // de producto, sin datos de usuario (mismo criterio que fonts/catalog).
  const publicSkillsCatalog = req.method === "GET" && req.path === "/api/skills-catalog";
  if (req.method === "OPTIONS" || publicInvitationPreview || publicRenderPage || req.path === "/api/health" || req.path === "/api/health/storage" || req.path === "/api/auth/config" || req.path === "/api/fonts/catalog" || publicCommentShare || signedZernioWebhook || internalWebhookDispatch || publicOpenApi || publicWebhookEvents || flowsWebhookTrigger || flowsOauth2Callback || publicSkillsCatalog) {
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
