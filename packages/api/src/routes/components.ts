/**
 * Components Routes
 * ──────────────────────────────────────────────────────────────
 * CRUD for reusable design components (templates with replaceable
 * properties). Components can be instantiated as layers within
 * design templates, with defaultValues populated from properties.
 *
 * @module routes/components
 *
 * Database (Supabase: components table):
 *   - id TEXT PK          → component identifier (cmp_xxxxxxxx)
 *   - name TEXT           → human-readable name
 *   - data JSONB          → full component definition (canvas, layers, properties, defaultValues)
 *   - user_id UUID        → owner (FK → auth.users)
 *   - created_at / updated_at TIMESTAMPTZ
 *
 * @webhook Fires: component.created
 */

import { Router } from "express";
import { v4 as uuid } from "uuid";
import { getSupabase } from "../services/supabase";
import { validate, createComponentSchema, updateComponentSchema } from "../middleware";

export const componentRoutes = Router();

const memoryStore = new Map<string, any>();

/**
 * POST /api/components
 * ──────────────────────────────────────────────────────────────
 * Create a new component. Builds defaultValues from property
 * definitions automatically.
 *
 * @body {string}   name               Component name
 * @body {string}   [description]      Human-readable description
 * @body {object[]} properties         [{ id, label, type, defaultValue }]
 * @body {object}   [canvas]           Fabric.js canvas JSON
 * @body {object[]} [layers]           Layer array
 * @body {string[]} [tags]             Categorization tags
 *
 * @returns {201} { success, data: Component }
 *
 * DB: INSERT INTO components (id, name, data)
 */
componentRoutes.post("/", validate(createComponentSchema), async (req, res) => {
  try {
    const component = {
      id: `cmp_${uuid().slice(0, 8)}`,
      name: req.body.name,
      description: req.body.description || "",
      properties: req.body.properties || [],
      defaultValues: {} as Record<string, any>,
      canvas: req.body.canvas,
      layers: req.body.layers,
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tags: req.body.tags || [],
      },
    };

    // Build defaultValues from properties
    for (const prop of component.properties) {
      component.defaultValues[prop.id] = prop.defaultValue;
    }

    const db = getSupabase();
    if (db) {
      await db.from("components").insert({
        id: component.id,
        name: component.name,
        data: component,
      });
    } else {
      memoryStore.set(component.id, component);
    }

    res.status(201).json({ success: true, data: component });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/components
 * ──────────────────────────────────────────────────────────────
 * List all components, newest first.
 *
 * @returns {200} { success, data: Component[] }
 *
 * DB: SELECT data FROM components ORDER BY created_at DESC
 */
componentRoutes.get("/", async (req, res) => {
  try {
    const db = getSupabase();
    if (db) {
      const { data } = await db
        .from("components")
        .select("data")
        .order("created_at", { ascending: false });
      res.json({ success: true, data: (data || []).map((r: any) => r.data) });
    } else {
      res.json({ success: true, data: Array.from(memoryStore.values()) });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/components/:id
 * @param {string} id  Component ID (cmp_xxxxxxxx)
 * @returns {200} { success, data: Component } | {404}
 * DB: SELECT data FROM components WHERE id = :id
 */
componentRoutes.get("/:id", async (req, res) => {
  try {
    const db = getSupabase();
    let component: any = null;

    if (db) {
      const { data } = await db
        .from("components")
        .select("data")
        .eq("id", req.params.id)
        .single();
      component = data?.data || null;
    } else {
      component = memoryStore.get(req.params.id) || null;
    }

    if (!component) return res.status(404).json({ success: false, error: "Component not found" });
    res.json({ success: true, data: component });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /api/components/:id
 * @param {string} id        Component ID
 * @body {object} partial    Fields to update (merged with existing)
 * @returns {200} { success, data: Component } | {404}
 * DB: UPDATE components SET data = :updated, name = :name WHERE id = :id
 */
componentRoutes.patch("/:id", validate(updateComponentSchema), async (req, res) => {
  try {
    const db = getSupabase();
    let existing: any = null;

    if (db) {
      const { data } = await db
        .from("components")
        .select("data")
        .eq("id", req.params.id)
        .single();
      existing = data?.data || null;
    } else {
      existing = memoryStore.get(req.params.id) || null;
    }

    if (!existing) return res.status(404).json({ success: false, error: "Component not found" });

    const updated = {
      ...existing,
      ...req.body,
      metadata: { ...existing.metadata, updatedAt: new Date().toISOString() },
    };

    if (db) {
      await db
        .from("components")
        .update({ data: updated, name: updated.name })
        .eq("id", req.params.id);
    } else {
      memoryStore.set(req.params.id, updated);
    }

    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/components/:id
 * @param {string} id  Component ID
 * @returns {200} { success: true } | {404}
 * DB: DELETE FROM components WHERE id = :id
 */
componentRoutes.delete("/:id", async (req, res) => {
  try {
    const db = getSupabase();
    if (db) {
      const { error } = await db.from("components").delete().eq("id", req.params.id);
      if (error) return res.status(500).json({ success: false, error: error.message });
    } else {
      if (!memoryStore.has(req.params.id)) {
        return res.status(404).json({ success: false, error: "Component not found" });
      }
      memoryStore.delete(req.params.id);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
