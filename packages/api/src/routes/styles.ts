/**
 * Styles Routes
 * ──────────────────────────────────────────────────────────────
 * CRUD for reusable design styles (color palettes, text styles,
 * effect presets). Styles can be applied across templates.
 *
 * @module routes/styles
 *
 * Database (Supabase: styles table):
 *   - id TEXT PK          → style identifier (sty_xxxxxxxx)
 *   - name TEXT           → human-readable name
 *   - type TEXT           → 'color' | 'text' | 'effect' (CHECK constraint)
 *   - data JSONB          → style definition (palette, typography, etc.)
 *   - user_id UUID        → owner (FK → auth.users)
 *   - created_at / updated_at TIMESTAMPTZ
 *
 * @webhook Fires: style.created
 */

import { Router } from "express";
import { v4 as uuid } from "uuid";
import { getSupabase } from "../services/supabase";
import { validate, createStyleSchema, updateStyleSchema } from "../middleware";

export const styleRoutes = Router();

const memoryStore = new Map<string, any>();

/**
 * POST /api/styles
 * ──────────────────────────────────────────────────────────────
 * Create a new design style.
 *
 * @body {string} name   Human-readable name
 * @body {string} type   'color' | 'text' | 'effect'
 * @body {object} data   Style data (palette, font config, etc.)
 *
 * @returns {201} { success, data: Style }
 *
 * DB: INSERT INTO styles (id, name, type, data)
 * In-memory fallback when Supabase unavailable.
 */
styleRoutes.post("/", validate(createStyleSchema), async (req, res) => {
  try {
    const style = {
      id: `sty_${uuid().slice(0, 8)}`,
      ...req.body,
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };

    const db = getSupabase();
    if (db) {
      await db.from("styles").insert({
        id: style.id,
        name: style.name,
        type: style.type,
        data: style,
      });
    } else {
      memoryStore.set(style.id, style);
    }

    res.status(201).json({ success: true, data: style });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/styles
 * ──────────────────────────────────────────────────────────────
 * List all styles, optionally filtered by type.
 *
 * @query {string} [type]  'color' | 'text' | 'effect'
 *
 * @returns {200} { success, data: Style[] }
 *
 * DB: SELECT data FROM styles [WHERE type = :type] ORDER BY created_at DESC
 * In-memory fallback when Supabase unavailable.
 */
styleRoutes.get("/", async (req, res) => {
  try {
    const typeFilter = req.query.type as string | undefined;
    const db = getSupabase();

    if (db) {
      let query = db.from("styles").select("data").order("created_at", { ascending: false });
      if (typeFilter) query = query.eq("type", typeFilter);
      const { data } = await query;
      res.json({ success: true, data: (data || []).map((r: any) => r.data) });
    } else {
      let allStyles = Array.from(memoryStore.values());
      if (typeFilter) allStyles = allStyles.filter((s) => s.type === typeFilter);
      res.json({ success: true, data: allStyles });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/styles/:id
 * ──────────────────────────────────────────────────────────────
 * Get a single style by ID.
 *
 * @param {string} id  Style ID (sty_xxxxxxxx)
 *
 * @returns {200} { success, data: Style }
 * @returns {404} Style not found
 *
 * DB: SELECT data FROM styles WHERE id = :id
 */
styleRoutes.get("/:id", async (req, res) => {
  try {
    const db = getSupabase();
    let style: any = null;

    if (db) {
      const { data } = await db.from("styles").select("data").eq("id", req.params.id).single();
      style = data?.data || null;
    } else {
      style = memoryStore.get(req.params.id) || null;
    }

    if (!style) return res.status(404).json({ success: false, error: "Style not found" });
    res.json({ success: true, data: style });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /api/styles/:id
 * ──────────────────────────────────────────────────────────────
 * Partial update to a style.
 *
 * @param {string} id           Style ID
 * @body {string} [name]        New name
 * @body {string} [type]        New type
 * @body {object} [data]        Merged into existing data
 *
 * @returns {200} { success, data: Style }
 * @returns {404} Style not found
 *
 * DB: UPDATE styles SET data = :updated, name = :name WHERE id = :id
 */
styleRoutes.patch("/:id", validate(updateStyleSchema), async (req, res) => {
  try {
    const db = getSupabase();
    let existing: any = null;

    if (db) {
      const { data } = await db.from("styles").select("data").eq("id", req.params.id).single();
      existing = data?.data || null;
    } else {
      existing = memoryStore.get(req.params.id) || null;
    }

    if (!existing) return res.status(404).json({ success: false, error: "Style not found" });

    const updated = {
      ...existing,
      ...req.body,
      metadata: { ...existing.metadata, updatedAt: new Date().toISOString() },
    };

    if (db) {
      await db.from("styles").update({ data: updated, name: updated.name }).eq("id", req.params.id);
    } else {
      memoryStore.set(req.params.id, updated);
    }

    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/styles/:id
 * ──────────────────────────────────────────────────────────────
 * Permanently remove a style.
 *
 * @param {string} id  Style ID
 *
 * @returns {200} { success: true }
 * @returns {404} Style not found
 *
 * DB: DELETE FROM styles WHERE id = :id
 */
styleRoutes.delete("/:id", async (req, res) => {
  try {
    const db = getSupabase();
    if (db) {
      const { error } = await db.from("styles").delete().eq("id", req.params.id);
      if (error) return res.status(500).json({ success: false, error: error.message });
    } else {
      if (!memoryStore.has(req.params.id)) {
        return res.status(404).json({ success: false, error: "Style not found" });
      }
      memoryStore.delete(req.params.id);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
