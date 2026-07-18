import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { getSupabase } from "../services/supabase.js";

declare global {
  namespace Express {
    interface Request {
      auth?: { userId: string; isAdmin?: boolean };
    }
  }
}

function keyHash(rawKey: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(rawKey);
  return hash.digest("hex");
}

export async function auth(req: Request, res: Response, next: NextFunction) {
  const adminKey = process.env.MCP_ADMIN_KEY;
  const apiKey = (req.headers["x-api-key"] as string) || "";
  const bearer = req.headers.authorization?.replace("Bearer ", "");

  // Dev mode: if MCP_ADMIN_KEY is not set, accept all (backward compat)
  if (!adminKey) {
    if (apiKey) {
      req.auth = { userId: apiKey, isAdmin: true };
    } else if (bearer) {
      req.auth = { userId: bearer };
    } else {
      req.auth = { userId: "dev_user_default", isAdmin: true };
    }
    return next();
  }

  // Admin key bypass
  if (apiKey === adminKey) {
    req.auth = { userId: "admin", isAdmin: true };
    return next();
  }

  // Check api_keys table for non-admin keys
  if (apiKey) {
    const sb = getSupabase();
    if (sb) {
      try {
        const { data } = await sb.from("api_keys")
          .select("id, user_id, label")
          .eq("key_hash", keyHash(apiKey))
          .is("revoked_at", null)
          .maybeSingle();
        if (data) {
          req.auth = { userId: data.user_id, isAdmin: false };
          return next();
        }
      } catch { /* fall through to reject */ }
    } else {
      // No Supabase — accept any non-empty key
      req.auth = { userId: apiKey, isAdmin: false };
      return next();
    }
  }

  // GET requests: allow public read access
  if (req.method === "GET" || req.method === "OPTIONS" || req.method === "HEAD") {
    req.auth = { userId: "anonymous" };
    return next();
  }

  // Write without valid auth → reject
  res.status(401).json({ success: false, error: "Unauthorized: valid x-api-key required" });
}
