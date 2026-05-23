// packages/api/src/routes/styles.ts
// Styles CRUD (Sprint 3)

import { Router } from "express";
import { v4 as uuid } from "uuid";
import { getSupabase } from "../services/supabase";
import { validate, createStyleSchema, updateStyleSchema } from "../middleware";

export const styleRoutes = Router();

const memoryStore = new Map<string, any>();

// Create style
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

// List styles
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
      let styles = Array.from(memoryStore.values());
      if (typeFilter) styles = styles.filter((s) => s.type === typeFilter);
      res.json({ success: true, data: styles });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get single style
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

// Update style
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

// Delete style
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
