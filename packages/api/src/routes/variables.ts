// packages/api/src/routes/variables.ts
// Variables / Design Tokens CRUD (Sprint 6)

import { Router } from "express";
import { getSupabase } from "../services/supabase";

export const variableRoutes = Router();

const memoryStore = new Map<string, any>();

// ─── GET /api/variables?templateId=... ──────────────────────────
// Load all variables, collections, and bindings for a template
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

// ─── POST /api/variables ────────────────────────────────────────
// Save all variables, collections, and bindings for a template
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

// ─── DELETE /api/variables/:templateId ──────────────────────────
// Delete all variables for a template
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
