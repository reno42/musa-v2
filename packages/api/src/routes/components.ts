// packages/api/src/routes/components.ts
// Components CRUD (Sprint 3)

import { Router } from "express";
import { v4 as uuid } from "uuid";
import { getSupabase } from "../services/supabase";
import { validate, createComponentSchema, updateComponentSchema } from "../middleware";

export const componentRoutes = Router();

const memoryStore = new Map<string, any>();

// Create component
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

// List components
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

// Get single component
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

// Update component
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

// Delete component
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
