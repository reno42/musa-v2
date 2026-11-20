/**
 * REQ-082 — Rutas REST del inbox unificado + personalidades + clientes intranet.
 * Montado en /api/inbox (requireUserSession + tenancy por workspace).
 * Los agentes usan las tools MCP equivalentes; los humanos esta UI.
 */
import { Router } from "express";
import { getSupabaseAdmin } from "../services/supabase.js";
import { canAccessWorkspace } from "../services/tenancy.js";
import { sweepInbox, replyInConversation, hashPin, newId } from "../../../worker/runtime/functions/inbox-core.mjs";

export const inboxRoutes = Router();

async function guard(req: any, res: any, minimum: "viewer" | "editor" = "editor") {
  const auth = req.auth;
  if (!auth?.valid) { res.status(401).json({ error: "No autenticado" }); return null; }
  const workspaceId = String(req.query.workspaceId || req.body?.workspaceId || "");
  if (!workspaceId) { res.status(400).json({ error: "workspaceId requerido" }); return null; }
  const ok = await canAccessWorkspace(auth, workspaceId, minimum);
  if (!ok) { res.status(403).json({ error: "Sin acceso" }); return null; }
  const sb = getSupabaseAdmin();
  if (!sb) { res.status(500).json({ error: "Supabase no configurado" }); return null; }
  return { sb, workspaceId };
}

// GET /api/inbox/conversations?workspaceId=&brandId=&status=&unreadOnly=1
inboxRoutes.get("/conversations", async (req: any, res: any) => {
  const g = await guard(req, res, "viewer");
  if (!g) return;
  let q = g.sb.from("inbox_conversations").select("*").eq("workspace_id", g.workspaceId);
  if (req.query.brandId) q = q.eq("brand_id", String(req.query.brandId));
  if (req.query.status) q = q.eq("status", String(req.query.status));
  if (req.query.unreadOnly === "1") q = q.gt("unread", 0);
  const { data, error } = await q.order("last_message_at", { ascending: false, nullsFirst: false }).limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ conversations: data || [] });
});

// GET /api/inbox/conversations/:id/messages?workspaceId=
inboxRoutes.get("/conversations/:id/messages", async (req: any, res: any) => {
  const g = await guard(req, res, "viewer");
  if (!g) return;
  const { data: conv } = await g.sb.from("inbox_conversations").select("id").eq("id", req.params.id).eq("workspace_id", g.workspaceId).maybeSingle();
  if (!conv) return res.status(404).json({ error: "No encontrada" });
  const { data, error } = await g.sb.from("inbox_messages").select("*").eq("conversation_id", req.params.id).order("sent_at").limit(200);
  if (error) return res.status(500).json({ error: error.message });
  // marcar leído
  await g.sb.from("inbox_conversations").update({ unread: 0 }).eq("id", req.params.id);
  res.json({ messages: data || [] });
});

// POST /api/inbox/reply {workspaceId, conversationId, body}
inboxRoutes.post("/reply", async (req: any, res: any) => {
  const g = await guard(req, res, "editor");
  if (!g) return;
  try {
    const delivery = await replyInConversation(g.sb, g.workspaceId, String(req.body.conversationId), String(req.body.body || ""), "human", null);
    res.json({ ok: true, delivery });
  } catch (e: any) { res.status(400).json({ error: e?.message || "fallo" }); }
});

// POST /api/inbox/sweep {workspaceId} — traer mensajes nuevos de las cuentas conectadas
inboxRoutes.post("/sweep", async (req: any, res: any) => {
  const g = await guard(req, res, "editor");
  if (!g) return;
  const summary = await sweepInbox(g.sb, g.workspaceId);
  res.json({ ok: true, summary });
});

// ── Personalidades ──
// GET /api/inbox/personalities?workspaceId=
inboxRoutes.get("/personalities", async (req: any, res: any) => {
  const g = await guard(req, res, "viewer");
  if (!g) return;
  const { data, error } = await g.sb.from("inbox_personalities").select("*").eq("workspace_id", g.workspaceId).order("created_at");
  if (error) return res.status(500).json({ error: error.message });
  res.json({ personalities: data || [] });
});

// POST /api/inbox/personalities {workspaceId, brandId, name, tone, systemPrompt, greeting}
inboxRoutes.post("/personalities", async (req: any, res: any) => {
  const g = await guard(req, res, "editor");
  if (!g) return;
  const id = newId("pers");
  const { data, error } = await g.sb.from("inbox_personalities").insert({
    id, workspace_id: g.workspaceId, brand_id: req.body.brandId || null,
    name: String(req.body.name || "Personalidad"), tone: String(req.body.tone || "cercano"),
    language: String(req.body.language || "es"),
    system_prompt: String(req.body.systemPrompt || ""), greeting: req.body.greeting || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ personality: data });
});

// PATCH /api/inbox/assign {workspaceId, conversationId, personalityId?, assignedKeyId?, status?}
inboxRoutes.patch("/assign", async (req: any, res: any) => {
  const g = await guard(req, res, "editor");
  if (!g) return;
  const patch: any = { updated_at: new Date().toISOString() };
  if (req.body.personalityId !== undefined) patch.personality_id = req.body.personalityId;
  if (req.body.assignedKeyId !== undefined) patch.assigned_key_id = req.body.assignedKeyId;
  if (req.body.status) patch.status = req.body.status;
  const { error } = await g.sb.from("inbox_conversations").update(patch)
    .eq("id", String(req.body.conversationId)).eq("workspace_id", g.workspaceId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── Clientes de intranet (login por email+PIN, scoped a SU marca) ──
// POST /api/inbox/clients {workspaceId, brandId, email, pin, name} — crear cliente
inboxRoutes.post("/clients", async (req: any, res: any) => {
  const g = await guard(req, res, "editor");
  if (!g) return;
  const email = String(req.body.email || "").toLowerCase().trim();
  const pin = String(req.body.pin || "");
  if (!email.includes("@") || pin.length < 4) return res.status(400).json({ error: "email y PIN (min 4) requeridos" });
  const salt = newId("s");
  const id = newId("icl");
  const { data, error } = await g.sb.from("intranet_clients").insert({
    id, workspace_id: g.workspaceId, brand_id: String(req.body.brandId || ""),
    email, pin_hash: `${salt}:${hashPin(pin, salt)}`, name: req.body.name || null,
  }).select("id, workspace_id, brand_id, email, name, status").single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ client: data });
});

// GET /api/inbox/clients?workspaceId=
inboxRoutes.get("/clients", async (req: any, res: any) => {
  const g = await guard(req, res, "viewer");
  if (!g) return;
  const { data, error } = await g.sb.from("intranet_clients").select("id, brand_id, email, name, status, last_login_at").eq("workspace_id", g.workspaceId).order("created_at");
  if (error) return res.status(500).json({ error: error.message });
  res.json({ clients: data || [] });
});

// POST /api/inbox/clients/login {workspaceId, email, pin} → token de marca (sin sesión de Musa)
inboxRoutes.post("/clients/login", async (req: any, res: any) => {
  const sb = getSupabaseAdmin();
  if (!sb) return res.status(500).json({ error: "Supabase no configurado" });
  const email = String(req.body.email || "").toLowerCase().trim();
  const workspaceId = String(req.body.workspaceId || "");
  const pin = String(req.body.pin || "");
  const { data: cl } = await sb.from("intranet_clients").select("*").eq("workspace_id", workspaceId).eq("email", email).eq("status", "active").maybeSingle();
  if (!cl) return res.status(401).json({ error: "Credenciales inválidas" });
  const [salt, hash] = String(cl.pin_hash).split(":");
  if (hashPin(pin, salt) !== hash) return res.status(401).json({ error: "Credenciales inválidas" });
  await sb.from("intranet_clients").update({ last_login_at: new Date().toISOString() }).eq("id", cl.id);
  // token efímero firmado simple (10 min para canjear en vistas de cliente)
  const token = newId("ctk");
  await sb.from("platform_config").upsert({
    key: `client_token:${token}`,
    value: { client_id: cl.id, workspace_id: cl.workspace_id, brand_id: cl.brand_id, exp: Date.now() + 10 * 60 * 1000 },
  }, { onConflict: "key" });
  res.json({ token, brandId: cl.brand_id, workspaceId: cl.workspace_id, name: cl.name });
});
