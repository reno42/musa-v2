// packages/api/src/routes/api-keys.ts
// API Keys CRUD (Management)

import { Router } from "express";
import { v4 as uuid } from "uuid";
import { createHash, randomBytes } from "crypto";
import { getSupabase } from "../services/supabase";

export const apiKeyRoutes = Router();

// ── List API keys for current user ──
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

// ── Create new API key ──
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

// ── Revoke (delete) API key ──
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
