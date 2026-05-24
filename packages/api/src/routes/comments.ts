/**
 * Comments Routes
 * ──────────────────────────────────────────────────────────────
 * CRUD for design review comments including threaded replies.
 * Comments are pinned to specific canvas positions (x, y) and
 * support resolution workflow (open → resolved).
 *
 * @module routes/comments
 *
 * Database (Supabase: comments table):
 *   - id TEXT PK             → comment identifier (cmt_xxxxxxxx)
 *   - template_id TEXT FK    → parent template (references templates.id, CASCADE delete)
 *   - frame_id TEXT          → optional frame/page reference
 *   - x DOUBLE PRECISION     → canvas x coordinate of pin
 *   - y DOUBLE PRECISION     → canvas y coordinate of pin
 *   - author TEXT            → commenter name
 *   - text TEXT              → comment body
 *   - thread JSONB           → array of { id, author, text, createdAt } replies
 *   - resolved BOOLEAN       → resolution status
 *   - created_at / updated_at TIMESTAMPTZ
 *
 * @webhook Fires: comment.created
 */

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

/**
 * POST /api/comments
 * ──────────────────────────────────────────────────────────────
 * Create a comment pinned to a template at a specific position.
 *
 * @body {string}  templateId       Template to comment on
 * @body {string}  [frameId]        Optional frame/page ID
 * @body {number}  [x=0]            Canvas X coordinate
 * @body {number}  [y=0]            Canvas Y coordinate
 * @body {string}  author           Commenter display name
 * @body {string}  text             Comment content
 *
 * @returns {201} { success, data: Comment }
 *
 * DB: INSERT INTO comments (id, template_id, frame_id, x, y, author, text, thread, resolved)
 */
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

/**
 * GET /api/comments?templateId=:id
 * ──────────────────────────────────────────────────────────────
 * List all comments for a given template, newest first.
 * Optionally filter by resolution status.
 *
 * @query {string} templateId       Template ID (required)
 * @query {string} [resolved]       'true' | 'false' filter
 *
 * @returns {200} { success, data: Comment[] }
 * @returns {400} Missing templateId
 *
 * DB: SELECT * FROM comments WHERE template_id = :tid ORDER BY created_at DESC
 */
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

/**
 * GET /api/comments/:id
 * @param {string} id  Comment ID (cmt_xxxxxxxx)
 * @returns {200} { success, data: Comment } | {404}
 * DB: SELECT * FROM comments WHERE id = :id
 */
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

/**
 * PATCH /api/comments/:id
 * ──────────────────────────────────────────────────────────────
 * Update comment (resolve, reopen, edit text, or update thread).
 *
 * @param {string}  id          Comment ID
 * @body {boolean} [resolved]   Set resolution status
 * @body {string}  [text]       Edit comment body
 * @body {array}   [thread]     Replace entire thread
 *
 * @returns {200} { success, data: Comment } | {404}
 *
 * DB: UPDATE comments SET (resolved, text, thread, updated_at) WHERE id = :id
 */
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

/**
 * POST /api/comments/:id/replies
 * ──────────────────────────────────────────────────────────────
 * Append a reply to a comment's thread array.
 *
 * @param {string} id      Comment ID
 * @body {string} author   Reply author name
 * @body {string} text     Reply content
 *
 * @returns {201} { success, data: { id, author, text, createdAt } }
 * @returns {404} Comment not found
 *
 * DB: UPDATE comments SET thread = thread || :reply, updated_at = NOW() WHERE id = :id
 */
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

/**
 * DELETE /api/comments/:id
 * @param {string} id  Comment ID
 * @returns {200} { success: true } | {404}
 * DB: DELETE FROM comments WHERE id = :id
 */
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
