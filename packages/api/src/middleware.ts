// packages/api/src/middleware.ts
// Authentication, rate limiting, and input validation middleware

import { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { z, ZodSchema } from "zod";
import { createHash } from "crypto";
import { getSupabase } from "./services/supabase";

// ── Auth Context ──
export interface AuthContext {
  apiKeyId: string;
  userId: string;
  permissions: string[];
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

// ── BOOTSTRAP CHECK ──
// Returns true if there are zero API keys in the database (first-time setup)
async function isFirstSetup(): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return true; // No Supabase = dev mode
  try {
    const { count, error } = await supabase
      .from("api_keys")
      .select("*", { count: "exact", head: true })
      .eq("active", true);
    if (error) return false;
    return count === 0;
  } catch {
    return false;
  }
}

// ── Authentication Middleware ──
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const supabase = getSupabase();

  // If no Supabase configured, skip auth (dev mode)
  if (!supabase) {
    req.auth = { apiKeyId: "dev", userId: "dev", permissions: ["*"] };
    return next();
  }

  // BOOTSTRAP: If zero keys exist, allow creating the first one without auth
  if (req.method === "POST" && req.path === "/" && req.baseUrl === "/api/api-keys") {
    const firstSetup = await isFirstSetup();
    if (firstSetup) {
      req.auth = { apiKeyId: "bootstrap", userId: "bootstrap", permissions: ["*"] };
      return next();
    }
  }

  // Extract API key from header
  let apiKey: string | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    apiKey = authHeader.slice(7);
  } else if (req.headers["x-api-key"]) {
    apiKey = req.headers["x-api-key"] as string;
  }

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: "Missing API key. Provide via Authorization: Bearer <key> or X-API-Key header.",
    });
  }

  // Hash the key and look up in Supabase
  const keyHash = createHash("sha256").update(apiKey).digest("hex");

  try {
    const { data, error } = await supabase
      .from("api_keys")
      .select("id, user_id, permissions, active, expires_at")
      .eq("key_hash", keyHash)
      .eq("active", true)
      .or("expires_at.is.null,expires_at.gt.now()")
      .single();

    if (error || !data) {
      return res.status(401).json({
        success: false,
        error: "Invalid or inactive API key.",
      });
    }

    // Update last_used_at (fire and forget)
    supabase
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", data.id)
      .then(() => {});

    req.auth = {
      apiKeyId: data.id,
      userId: data.user_id,
      permissions: data.permissions || [],
    };

    next();
  } catch (err: any) {
    console.error("[AUTH] Lookup error:", err.message);
    return res.status(500).json({
      success: false,
      error: "Authentication service error.",
    });
  }
}

// ── Rate Limiting ──
function rateLimitKey(req: Request): string {
  return req.auth?.apiKeyId || req.ip || "unknown";
}

// CRUD rate limit: 100 requests per minute
export const crudRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
  message: {
    success: false,
    error: "Rate limit exceeded. CRUD routes allow 100 requests per minute.",
  },
});

// Render rate limit: 10 requests per minute
export const renderRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
  message: {
    success: false,
    error: "Rate limit exceeded. Render route allows 10 requests per minute.",
  },
});

// ── Input Validation ──
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
      return res.status(400).json({
        success: false,
        error: "Validation failed",
        details: errors,
      });
    }
    req.body = result.data;
    next();
  };
}

// ── Validation Schemas ──
export const createTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  canvas: z.object({
    width: z.number().min(1).max(10000).default(1080),
    height: z.number().min(1).max(10000).default(1080),
    background: z.string().default("#ffffff"),
  }).optional(),
});

export const createLayerSchema = z.object({
  templateId: z.string().uuid(),
  type: z.string().min(1),
  name: z.string().min(1).max(500).optional(),
  properties: z.record(z.any()).default({}),
  order: z.number().int().min(0).optional(),
});

export const createComponentSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.string().min(1),
  properties: z.record(z.any()).default({}),
});

export const createStyleSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.string().min(1),
  value: z.record(z.any()),
});

// ── Update schemas (permissive partial updates) ──
export const updateTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  canvas: z.object({
    width: z.number().min(1).max(10000),
    height: z.number().min(1).max(10000),
    background: z.string(),
  }).optional().nullable(),
  layers: z.array(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
}).passthrough();

export const duplicateTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
});

export const createCommentSchema = z.object({
  templateId: z.string().min(1),
  frameId: z.string().optional().nullable(),
  x: z.number().optional().default(0),
  y: z.number().optional().default(0),
  author: z.string().min(1),
  text: z.string().min(1),
});

export const updateCommentSchema = z.object({
  resolved: z.boolean().optional(),
  text: z.string().min(1).optional(),
  thread: z.array(z.any()).optional(),
});

export const createReplySchema = z.object({
  author: z.string().min(1),
  text: z.string().min(1),
});

export const createVersionSchema = z.object({
  data: z.any().optional(),
  author: z.string().optional().nullable(),
  message: z.string().optional().nullable(),
});

export const updateStyleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: z.string().min(1).optional(),
  value: z.record(z.any()).optional(),
}).passthrough();

export const updateComponentSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: z.string().min(1).optional(),
  properties: z.record(z.any()).optional(),
  description: z.string().optional(),
  canvas: z.any().optional(),
  layers: z.array(z.any()).optional(),
  defaultValues: z.record(z.any()).optional(),
  tags: z.array(z.string()).optional(),
}).passthrough();
