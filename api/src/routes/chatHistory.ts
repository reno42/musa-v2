/**
 * Chat history — the agent's transcript, per user, server-side.
 *
 * GET    /api/chat/messages?limit=   the conversation, oldest first
 * POST   /api/chat/messages          append one or many turns
 * DELETE /api/chat/messages          clear the conversation
 * GET/PUT /api/chat/preferences      which model the user picked
 *
 * Keyed by the signed-in user, never by workspace or browser. The transcript
 * used to live in localStorage alone, which meant the same account on a phone
 * or a second browser met an agent with no memory — the storage was per
 * device, and the agent is per person.
 */

import { Router } from "express";
import { asyncRoute } from "../middleware/asyncRoute.js";
import { getSupabase } from "../services/supabase.js";

export const chatRoutes = Router();

/** Hard ceiling on what one request may append, so a runaway loop cannot
 *  write a million rows before anyone notices. */
const MAX_BATCH = 50;
const DEFAULT_LIMIT = 200;

function requireUser(req: any, res: any): string | null {
  const userId = req.auth?.userId;
  if (!userId || req.auth?.authType !== "user") {
    res.status(401).json({ success: false, error: "Necesitas iniciar sesión para tener historial" });
    return null;
  }
  return userId;
}

const dbOr503 = (res: any) => {
  const sb = getSupabase();
  if (!sb) { res.status(503).json({ success: false, error: "Supabase no está configurado" }); return null; }
  return sb;
};

/** v23 not run yet reads as setup, with the step, rather than a blank 500. */
function isMissingTable(error: unknown): boolean {
  const err = error as { code?: string; message?: string } | null;
  if (err?.code === "PGRST205" || err?.code === "42P01") return true;
  const message = String(err?.message ?? "").toLowerCase();
  return (message.includes("chat_messages") || message.includes("chat_preferences"))
    && (message.includes("schema cache") || message.includes("does not exist"));
}

const SETUP_MESSAGE =
  "Falta crear las tablas del chat. Ejecuta supabase_migrations_v23.sql y recarga "
  + "el esquema (Settings → API → Reload schema cache).";

function withSetupCheck(fn: (req: any, res: any) => Promise<unknown>) {
  return asyncRoute(async (req: any, res: any) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (isMissingTable(err)) {
        // 200 with an empty conversation on read: a first-run user should see
        // an empty chat, not an error bar. Writes say what to do.
        if (req.method === "GET") {
          return res.json({ success: true, data: [], setupRequired: true, error: SETUP_MESSAGE });
        }
        return res.status(503).json({ success: false, error: SETUP_MESSAGE, setupRequired: true });
      }
      throw err;
    }
  });
}

chatRoutes.get("/messages", withSetupCheck(async (req, res) => {
  const userId = requireUser(req, res); if (!userId) return;
  const sb = dbOr503(res); if (!sb) return;

  const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, 500);
  // Newest N, then flipped: the tail of a long conversation is the part worth
  // loading, and reading it oldest-first is how it is rendered.
  const { data, error } = await sb.from("chat_messages")
    .select("id, role, content, meta, ts, workspace_id")
    .eq("user_id", userId)
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw error;
  res.json({ success: true, data: (data || []).reverse() });
}));

chatRoutes.post("/messages", withSetupCheck(async (req, res) => {
  const userId = requireUser(req, res); if (!userId) return;
  const sb = dbOr503(res); if (!sb) return;

  const incoming = Array.isArray(req.body?.messages) ? req.body.messages : [req.body];
  const rows = incoming
    .filter((m: any) => m && typeof m.role === "string")
    .slice(0, MAX_BATCH)
    .map((m: any) => ({
      user_id: userId,
      workspace_id: m.workspaceId || req.body.workspaceId || null,
      role: String(m.role),
      content: String(m.content ?? ""),
      meta: m.meta && typeof m.meta === "object" ? m.meta : {},
      ts: Number(m.ts) || Date.now(),
    }));

  if (rows.length === 0) {
    return res.status(400).json({ success: false, error: "No hay mensajes que guardar" });
  }
  const { error } = await sb.from("chat_messages").insert(rows);
  if (error) throw error;
  res.status(201).json({ success: true, saved: rows.length });
}));

chatRoutes.delete("/messages", withSetupCheck(async (req, res) => {
  const userId = requireUser(req, res); if (!userId) return;
  const sb = dbOr503(res); if (!sb) return;
  const { error } = await sb.from("chat_messages").delete().eq("user_id", userId);
  if (error) throw error;
  res.json({ success: true });
}));

chatRoutes.get("/preferences", withSetupCheck(async (req, res) => {
  const userId = requireUser(req, res); if (!userId) return;
  const sb = dbOr503(res); if (!sb) return;
  const { data, error } = await sb.from("chat_preferences")
    .select("role_config").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  res.json({ success: true, data: data?.role_config || null });
}));

chatRoutes.put("/preferences", withSetupCheck(async (req, res) => {
  const userId = requireUser(req, res); if (!userId) return;
  const sb = dbOr503(res); if (!sb) return;
  const roleConfig = req.body?.roleConfig;
  if (!roleConfig || typeof roleConfig !== "object") {
    return res.status(400).json({ success: false, error: "roleConfig es requerido" });
  }
  // Provider and model only. An API key is a secret the user pasted into their
  // own browser; moving it into a shared database is their decision to make,
  // not a side effect of syncing which model they like.
  const { error } = await sb.from("chat_preferences").upsert({
    user_id: userId,
    role_config: roleConfig,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  res.json({ success: true });
}));
