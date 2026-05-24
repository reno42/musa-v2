/**
 * API Keys Management Routes
 * ──────────────────────────────────────────────────────────────
 * Secure API key generation with SHA-256 hashing. Keys are
 * generated server-side and shown only once. Supports listing
 * active keys, creating new ones, and soft-deletion (revoke).
 *
 * @module routes/api-keys
 *
 * Database (Supabase: api_keys table):
 *   - id TEXT PK            → key identifier (key_xxxxxxxx)
 *   - user_id UUID          → owner (FK → auth.users)
 *   - name TEXT             → human-readable label
 *   - key_hash TEXT UNIQUE  → SHA-256(raw_key)
 *   - key_prefix TEXT       → first 11 chars for UI display
 *   - permissions TEXT[]    → e.g. ['templates:read', 'render']
 *   - last_used_at          → last authentication timestamp
 *   - expires_at TIMESTAMPTZ → optional expiration
 *   - active BOOLEAN        → soft-delete flag
 *   - created_at TIMESTAMPTZ
 *
 * Authentication flow (middleware.ts):
 *   1. Extract X-API-Key from header
 *   2. SHA-256(raw key) → look up api_keys.key_hash
 *   3. Check active=true, expires_at not past
 *   4. Attach user_id + permissions to req.auth
 */

import { Router } from "express";
import { v4 as uuid } from "uuid";
import { createHash, randomBytes } from "crypto";
import { getSupabase } from "../services/supabase";

export const apiKeyRoutes = Router();

/**
 * GET /api/api-keys
 * ──────────────────────────────────────────────────────────────
 * List active API keys for the authenticated user. Never
 * returns the raw key (only prefix for identification).
 *
 * @returns {200} { success, data: { id, name, key_prefix, permissions, last_used_at, active, created_at }[] }
 * @returns {401} Not authenticated
 *
 * DB: SELECT id,name,key_prefix,permissions,last_used_at,active,created_at
 *     FROM api_keys WHERE user_id = :uid AND active = true
 */
apiKeyRoutes.get("/", async (req, res) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

    const db = getSupabase();
    if (db) {
      const { data, error } = await db
        .from("api_keys")
        .select("id, name, key_prefix, permissions, last_used_at, active, created_at")
        .eq("user_id", userId)
        .eq("active", true)
        .order("created_at", { ascending: false });

      if (error) return res.status(500).json({ success: false, error: error.message });
      return res.json({ success: true, data: data || [] });
    }

    // In-memory fallback
    return res.json({ success: true, data: [] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/api-keys
 * ──────────────────────────────────────────────────────────────
 * Generate a new API key. Returns the raw key ONLY ONCE in the
 * response. After this, only the SHA-256 hash is stored.
 *
 * @body {string} [name="Default Key"]   Label for this key
 *
 * @returns {201} { success, data: { id, name, key, key_prefix, message } }
 * @returns {401} Not authenticated
 *
 * DB: INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, permissions, active)
 *
 * ⚠️ The raw key is shown ONLY ONCE. The server only stores key_hash.
 */
apiKeyRoutes.post("/", async (req, res) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

    const name = req.body.name || "Default Key";

    // Generate a random API key
    const rawKey = `fd_${randomBytes(32).toString("hex")}`;
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const keyPrefix = rawKey.slice(0, 11);

    const keyId = `key_${uuid().slice(0, 8)}`;

    const db = getSupabase();
    if (db) {
      // Bootstrap creates keys with user_id=NULL (no real user yet).
      // Normal flow uses the authenticated user's UUID.
      const effectiveUserId = userId === "bootstrap" ? null : userId;
      const { error } = await db.from("api_keys").insert({
        id: keyId,
        user_id: effectiveUserId,
        name,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        permissions: ["templates:read", "templates:write", "render", "webhooks"],
        active: true,
      });

      if (error) return res.status(500).json({ success: false, error: error.message });
    }

    // Return the raw key ONLY ONCE — it won't be stored or shown again
    res.status(201).json({
      success: true,
      data: {
        id: keyId,
        name,
        key: rawKey,
        key_prefix: keyPrefix,
        message: "Copy this key now. It won't be shown again.",
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/api-keys/:id
 * ──────────────────────────────────────────────────────────────
 * Revoke an API key (soft-delete: sets active = false).
 *
 * @param {string} id  Key ID (key_xxxxxxxx)
 *
 * @returns {200} { success: true }
 * @returns {401} Not authenticated
 *
 * DB: UPDATE api_keys SET active = false WHERE id = :id AND user_id = :uid
 */
apiKeyRoutes.delete("/:id", async (req, res) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

    const db = getSupabase();
    if (db) {
      // Soft delete: set active = false
      const { error } = await db
        .from("api_keys")
        .update({ active: false })
        .eq("id", req.params.id)
        .eq("user_id", userId);

      if (error) return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
