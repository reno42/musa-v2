/**
 * Variables / Design Tokens Routes
 * ──────────────────────────────────────────────────────────────
 * Design token management for templates. Stores collections,
 * variable definitions, and bindings (variable→layer property
 * mappings) in a single JSONB document per template.
 *
 * @module routes/variables
 *
 * Database (Supabase: variables table):
 *   - id TEXT PK          → auto-generated (var_...)
 *   - template_id TEXT FK → parent template (CASCADE delete)
 *   - data JSONB          → { collections[], variables[], bindings{} }
 *   - created_at / updated_at TIMESTAMPTZ
 *
 * Data structure:
 *   collections: [{ id, name }]                       — logical groups
 *   variables:   [{ id, name, type, value, collectionId }] — tokens
 *   bindings:    { [layerName]: [{ variableId, property }] } — property links
 */

import { Router } from "express";
import { getSupabase } from "../services/supabase";

export const variableRoutes = Router();

const memoryStore = new Map<string, any>();

/**
 * GET /api/variables?templateId=:id
 * ──────────────────────────────────────────────────────────────
 * Load all variables, collections, and bindings for a template.
 *
 * @query {string} templateId  Template ID (required)
 *
 * @returns {200} { success, data: { collections, variables, bindings } }
 * @returns {400} Missing templateId
 *
 * DB: SELECT data FROM variables WHERE template_id = :tid
 */
variableRoutes.get("/", async (req, res) => {
  try {
    const templateId = req.query.templateId as string;
    if (!templateId) {
      return res.status(400).json({ success: false, error: "templateId is required" });
    }

    const db = getSupabase();
    if (db) {
      const { data, error } = await db
        .from("variables")
        .select("data")
        .eq("template_id", templateId)
        .single();

      if (error && error.code !== "PGRST116") {
        return res.status(500).json({ success: false, error: error.message });
      }

      const variableData = data?.data || { collections: [], variables: [], bindings: {} };
      return res.json({ success: true, data: variableData });
    }

    // In-memory fallback
    const stored = memoryStore.get(templateId) || { collections: [], variables: [], bindings: {} };
    return res.json({ success: true, data: stored });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/variables
 * ──────────────────────────────────────────────────────────────
 * Save (upsert) all variables, collections, and bindings for
 * a template. Creates a new variables row or updates existing.
 *
 * @body {string}   templateId     Template ID (required)
 * @body {object[]} [collections]  Collection definitions
 * @body {object[]} [variables]    Variable definitions
 * @body {object}   [bindings]     Layer→variable property map
 *
 * @returns {200} { success, data: { collections, variables, bindings } }
 * @returns {400} Missing templateId
 *
 * DB: UPSERT (INSERT or UPDATE) variables data WHERE template_id = :tid
 */
variableRoutes.post("/", async (req, res) => {
  try {
    const { templateId, collections, variables, bindings } = req.body;
    if (!templateId) {
      return res.status(400).json({ success: false, error: "templateId is required" });
    }

    const variableData = {
      collections: collections || [],
      variables: variables || [],
      bindings: bindings || {},
    };

    const db = getSupabase();
    if (db) {
      // Upsert: check if exists first
      const { data: existing } = await db
        .from("variables")
        .select("id")
        .eq("template_id", templateId)
        .single();

      if (existing) {
        await db
          .from("variables")
          .update({ data: variableData, updated_at: new Date().toISOString() })
          .eq("template_id", templateId);
      } else {
        await db.from("variables").insert({
          template_id: templateId,
          data: variableData,
        });
      }
    } else {
      memoryStore.set(templateId, variableData);
    }

    return res.json({ success: true, data: variableData });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/variables/:templateId
 * ──────────────────────────────────────────────────────────────
 * Remove all variable data for a template.
 *
 * @param {string} templateId  Template ID
 *
 * @returns {200} { success: true }
 *
 * DB: DELETE FROM variables WHERE template_id = :tid
 */
variableRoutes.delete("/:templateId", async (req, res) => {
  try {
    const { templateId } = req.params;

    const db = getSupabase();
    if (db) {
      await db.from("variables").delete().eq("template_id", templateId);
    } else {
      memoryStore.delete(templateId);
    }

    return res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
