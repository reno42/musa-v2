// packages/api/src/routes/comments.ts
// Comments CRUD with threads (Sprint 5)

import { Router } from "express";
import { v4 as uuid } from "uuid";
import { getSupabase } from "../services/supabase";
import {
  validate,
  createCommentSchema,
  updateCommentSchema,
  createReplySchema,
} from "../middleware";

export const commentRoutes = Router();

const memoryStore = new Map<string, any>();

// Create comment
commentRoutes.post("/", validate(createCommentSchema), async (req, res) => {
  try {
    const comment = {
      id: `cmt_${uuid().slice(0, 8)}`,
      templateId: req.body.templateId,
      frameId: req.body.frameId || null,
      x: req.body.x || 0,
      y: req.body.y || 0,
      author: req.body.author,
      text: req.body.text,
      thread: [],
      resolved: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const db = getSupabase();
    if (db) {
      await db.from("comments").insert({
        id: comment.id,
        template_id: comment.templateId,
        frame_id: comment.frameId,
        x: comment.x,
        y: comment.y,
        author: comment.author,
        text: comment.text,
        thread: [],
        resolved: false,
      });
    } else {
      memoryStore.set(comment.id, comment);
    }

    res.status(201).json({ success: true, data: comment });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// List comments for a template
commentRoutes.get("/", async (req, res) => {
  try {
    const templateId = req.query.templateId as string;
    if (!templateId) {
      return res.status(400).json({ success: false, error: "templateId query param required" });
    }

    const resolvedFilter = req.query.resolved as string | undefined;
    const db = getSupabase();

    if (db) {
      let query = db
        .from("comments")
        .select("*")
        .eq("template_id", templateId)
        .order("created_at", { ascending: false });

      if (resolvedFilter !== undefined) {
        query = query.eq("resolved", resolvedFilter === "true");
      }

      const { data } = await query;
      const comments = (data || []).map((r: any) => ({
        id: r.id,
        templateId: r.template_id,
        frameId: r.frame_id,
        x: r.x,
        y: r.y,
        author: r.author,
        text: r.text,
        thread: r.thread || [],
        resolved: r.resolved,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
      res.json({ success: true, data: comments });
    } else {
      let comments = Array.from(memoryStore.values()).filter(
        (c) => c.templateId === templateId
      );
      if (resolvedFilter !== undefined) {
        comments = comments.filter((c) => c.resolved === (resolvedFilter === "true"));
      }
      res.json({ success: true, data: comments });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get single comment
commentRoutes.get("/:id", async (req, res) => {
  try {
    const db = getSupabase();
    let comment: any = null;

    if (db) {
      const { data } = await db.from("comments").select("*").eq("id", req.params.id).single();
      if (data) {
        comment = {
          id: data.id,
          templateId: data.template_id,
          frameId: data.frame_id,
          x: data.x,
          y: data.y,
          author: data.author,
          text: data.text,
          thread: data.thread || [],
          resolved: data.resolved,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        };
      }
    } else {
      comment = memoryStore.get(req.params.id) || null;
    }

    if (!comment) return res.status(404).json({ success: false, error: "Comment not found" });
    res.json({ success: true, data: comment });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update comment (resolve/reopen/edit text)
commentRoutes.patch("/:id", validate(updateCommentSchema), async (req, res) => {
  try {
    const db = getSupabase();
    let existing: any = null;

    if (db) {
      const { data } = await db.from("comments").select("*").eq("id", req.params.id).single();
      if (data) {
        existing = {
          id: data.id,
          templateId: data.template_id,
          frameId: data.frame_id,
          x: data.x,
          y: data.y,
          author: data.author,
          text: data.text,
          thread: data.thread || [],
          resolved: data.resolved,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        };
      }
    } else {
      existing = memoryStore.get(req.params.id) || null;
    }

    if (!existing) return res.status(404).json({ success: false, error: "Comment not found" });

    const updates: any = {};
    if (req.body.resolved !== undefined) updates.resolved = req.body.resolved;
    if (req.body.text !== undefined) updates.text = req.body.text;
    if (req.body.thread !== undefined) updates.thread = req.body.thread;

    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };

    if (db) {
      const dbUpdates: any = { updated_at: updated.updatedAt };
      if (updates.resolved !== undefined) dbUpdates.resolved = updates.resolved;
      if (updates.text !== undefined) dbUpdates.text = updates.text;
      if (updates.thread !== undefined) dbUpdates.thread = updates.thread;
      await db.from("comments").update(dbUpdates).eq("id", req.params.id);
    } else {
      memoryStore.set(req.params.id, updated);
    }

    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add reply to comment thread
commentRoutes.post("/:id/replies", validate(createReplySchema), async (req, res) => {
  try {
    const db = getSupabase();
    let existing: any = null;

    if (db) {
      const { data } = await db.from("comments").select("*").eq("id", req.params.id).single();
      if (data) {
        existing = {
          id: data.id,
          thread: data.thread || [],
        };
      }
    } else {
      existing = memoryStore.get(req.params.id) || null;
    }

    if (!existing) return res.status(404).json({ success: false, error: "Comment not found" });

    const reply = {
      id: `rpl_${uuid().slice(0, 8)}`,
      author: req.body.author,
      text: req.body.text,
      createdAt: new Date().toISOString(),
    };

    const thread = [...(existing.thread || []), reply];

    if (db) {
      await db
        .from("comments")
        .update({ thread, updated_at: new Date().toISOString() })
        .eq("id", req.params.id);
    } else {
      const comment = memoryStore.get(req.params.id);
      comment.thread = thread;
      comment.updatedAt = new Date().toISOString();
    }

    res.status(201).json({ success: true, data: reply });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete comment
commentRoutes.delete("/:id", async (req, res) => {
  try {
    const db = getSupabase();
    if (db) {
      const { error } = await db.from("comments").delete().eq("id", req.params.id);
      if (error) return res.status(500).json({ success: false, error: error.message });
    } else {
      if (!memoryStore.has(req.params.id)) {
        return res.status(404).json({ success: false, error: "Comment not found" });
      }
      memoryStore.delete(req.params.id);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
