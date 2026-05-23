import type { Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { createHmac, randomUUID, createHash } from "node:crypto";

// ── Supabase (service role for server-side ops) ──
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";
const db = supabaseUrl && supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey, { realtime: { enabled: false } }) : null;

// In-memory fallbacks
const memTemplates = new Map<string, any>();
const memWebhooks = new Map<string, any>();
const memStyles = new Map<string, any>();
const memComponents = new Map<string, any>();
const memComments = new Map<string, any>();
const memVersions = new Map<string, any[]>();

// ── Helpers ──
function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-API-Key, Authorization",
    },
  });
}
function err(msg: string, status = 400) { return json({ success: false, error: msg }, status); }
async function body(req: Request) { try { return await req.json(); } catch { return {}; } }
function uid() { return randomUUID().slice(0, 8); }

// ── Auth: Validate API Key ──
async function validateApiKey(req: Request): Promise<{ userId: string } | null> {
  const apiKey = req.headers.get("X-API-Key");
  if (!apiKey) return null;

  if (!db) return null;

  const keyHash = createHash("sha256").update(apiKey).digest("hex");
  const { data } = await db
    .from("api_keys")
    .select("id, user_id, permissions, last_used_at")
    .eq("key_hash", keyHash)
    .eq("active", true)
    .or("expires_at.is.null,expires_at.gt.now()")
    .single();

  if (!data) return null;

  // Update last_used_at
  await db.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);

  return { userId: data.user_id };
}


// ── Auth: Validate Supabase Session ──
async function validateSupabaseSession(req: Request): Promise<{ userId: string } | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  if (!db) return null;

  const token = authHeader.slice(7);
  try {
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) return null;
    return { userId: data.user.id };
  } catch {
    return null;
  }
}

// ── Auth: Combined validation (API key or Supabase session) ──
async function authenticate(req: Request): Promise<{ userId: string } | null> {
  // Try API key first
  const apiKeyAuth = await validateApiKey(req);
  if (apiKeyAuth) return apiKeyAuth;

  // Fallback to Supabase session
  return validateSupabaseSession(req);
}

// ── Templates ──
async function createTemplate(name: string, w = 1080, h = 1080, canvasJson?: any, userId?: string) {
  const tpl = canvasJson
    ? { ...canvasJson, id: `tpl_${uid()}`, name, schemaVersion: 1, metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }
    : { id: `tpl_${uid()}`, name, schemaVersion: 1, canvas: { width: w, height: h, background: "#ffffff" }, layers: [], metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } };
  const row: any = { id: tpl.id, name: tpl.name, data: tpl };
  if (userId) row.user_id = userId;
  if (db) await db.from("templates").insert(row);
  else memTemplates.set(tpl.id, tpl);
  return tpl;
}
async function listTemplates(userId?: string) {
  if (db) {
    let query = db.from("templates").select("data").order("created_at", { ascending: false });
    if (userId) query = query.eq("user_id", userId);
    const { data } = await query;
    return (data || []).map((r: any) => r.data);
  }
  return Array.from(memTemplates.values());
}
async function getTemplate(id: string) {
  if (db) { const { data } = await db.from("templates").select("data").eq("id", id).single(); return data?.data || null; }
  return memTemplates.get(id) || null;
}
async function updateTemplate(id: string, updates: any) {
  const existing = await getTemplate(id);
  if (!existing) return null;
  const updated = { ...existing, ...updates, metadata: { ...existing.metadata, updatedAt: new Date().toISOString() } };
  if (db) await db.from("templates").update({ data: updated, name: updated.name }).eq("id", id);
  else memTemplates.set(id, updated);
  return updated;
}
async function deleteTemplate(id: string) {
  if (db) { const { error } = await db.from("templates").delete().eq("id", id); return !error; }
  return memTemplates.delete(id);
}
async function applyLayerOverrides(templateId: string, overrides: Record<string, any>) {
  const tpl = await getTemplate(templateId);
  if (!tpl) return null;
  const layerMap = new Map(tpl.layers.map((l: any) => [l.name, l]));
  for (const [name, override] of Object.entries(overrides)) {
    const layer = layerMap.get(name);
    if (!layer) continue;
    for (const [k, v] of Object.entries(override)) { layer[k] = v; }
  }
  return updateTemplate(templateId, tpl);
}

// ── Webhooks ──
async function registerWebhook(url: string, events: string[], secret?: string, userId?: string) {
  const entry: any = { id: `wh_${uid()}`, url, events, secret: secret || `whsec_${randomUUID().replace(/-/g, "")}`, active: true, created_at: new Date().toISOString() };
  if (userId) entry.user_id = userId;
  if (db) await db.from("webhooks").insert(entry);
  else memWebhooks.set(entry.id, entry);
  return entry;
}
async function listWebhooks(userId?: string) {
  if (db) {
    let query = db.from("webhooks").select("*").eq("active", true);
    if (userId) query = query.eq("user_id", userId);
    const { data } = await query;
    return data || [];
  }
  return Array.from(memWebhooks.values());
}
async function deleteWebhook(id: string) {
  if (db) { const { error } = await db.from("webhooks").delete().eq("id", id); return !error; }
  return memWebhooks.delete(id);
}
async function fireWebhooks(event: string, payload: any) {
  const all = await listWebhooks();
  const matching = all.filter((w: any) => w.events?.includes(event) || w.events?.includes("*"));
  for (const wh of matching) {
    try {
      const b = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (wh.secret) headers["X-Futuraria-Signature"] = `sha256=${createHmac("sha256", wh.secret).update(b).digest("hex")}`;
      await fetch(wh.url, { method: "POST", headers, body: b, signal: AbortSignal.timeout(10000) });
    } catch (e: any) { console.error(`[WEBHOOK] ${wh.url}: ${e.message}`); }
  }
}

// ── API Key CRUD ──
async function listApiKeys(userId: string) {
  if (!db) return [];
  const { data } = await db.from("api_keys").select("id,name,key_prefix,permissions,last_used_at,active,created_at").eq("user_id", userId).eq("active", true).order("created_at", { ascending: false });
  return data || [];
}
async function createApiKeyDB(name: string, userId: string) {
  if (!db) return null;
  const rawKey = `fd_${randomUUID().replace(/-/g, "")}`;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const row = { id: `key_${uid()}`, user_id: userId, name, key_hash: keyHash, key_prefix: rawKey.slice(0, 11), permissions: ["templates:read","templates:write","render","webhooks"] };
  await db.from("api_keys").insert(row);
  return { ...row, fullKey: rawKey };
}
async function deleteApiKey(id: string, userId: string) {
  if (!db) return false;
  const { error } = await db.from("api_keys").update({ active: false }).eq("id", id).eq("user_id", userId);
  return !error;
}

// ── Styles CRUD (Sprint 3) ──
async function createStyle(data: any, userId?: string) {
  const id = `sty_${uid()}`;
  const now = new Date().toISOString();
  const style = {
    id, name: data.name, type: data.type,
    fills: data.fills || null, fontFamily: data.fontFamily || null,
    fontSize: data.fontSize || null, fontWeight: data.fontWeight || null,
    lineHeight: data.lineHeight || null, letterSpacing: data.letterSpacing || null,
    effects: data.effects || null,
    metadata: { createdAt: now, updatedAt: now },
  };
  if (db) {
    const row: any = { id: style.id, name: style.name, type: style.type, data: style };
    await db.from("styles").insert(row);
  } else { memStyles.set(id, style); }
  return style;
}
async function listStyles(userId?: string) {
  if (db) {
    let query = db.from("styles").select("data").order("created_at", { ascending: false });
    const { data } = await query;
    return (data || []).map((r: any) => r.data);
  }
  return Array.from(memStyles.values());
}
async function getStyle(id: string) {
  if (db) { const { data } = await db.from("styles").select("data").eq("id", id).single(); return data?.data || null; }
  return memStyles.get(id) || null;
}
async function updateStyle(id: string, updates: any) {
  const existing = await getStyle(id);
  if (!existing) return null;
  const updated = { ...existing, ...updates, id: existing.id, metadata: { ...existing.metadata, updatedAt: new Date().toISOString() } };
  if (db) await db.from("styles").update({ data: updated, name: updated.name }).eq("id", id);
  else memStyles.set(id, updated);
  return updated;
}
async function deleteStyle(id: string) {
  if (db) { const { error } = await db.from("styles").delete().eq("id", id); return !error; }
  return memStyles.delete(id);
}

// ── Components CRUD (Sprint 3) ──
async function createComponent(data: any) {
  const id = `cmp_${uid()}`;
  const now = new Date().toISOString();
  const comp = {
    id, name: data.name, description: data.description || null,
    properties: data.properties || [],
    defaultValues: Object.fromEntries((data.properties || []).map((p: any) => [p.id, p.defaultValue])),
    canvas: data.canvas, layers: data.layers,
    metadata: { createdAt: now, updatedAt: now, tags: data.tags },
  };
  if (db) await db.from("components").insert({ id: comp.id, name: comp.name, data: comp });
  else memComponents.set(id, comp);
  return comp;
}
async function listComponents() {
  if (db) { const { data } = await db.from("components").select("data").order("created_at", { ascending: false }); return (data || []).map((r: any) => r.data); }
  return Array.from(memComponents.values());
}
async function getComponent(id: string) {
  if (db) { const { data } = await db.from("components").select("data").eq("id", id).single(); return data?.data || null; }
  return memComponents.get(id) || null;
}
async function updateComponent(id: string, updates: any) {
  const existing = await getComponent(id);
  if (!existing) return null;
  const updated = { ...existing, ...updates, metadata: { ...existing.metadata, updatedAt: new Date().toISOString() } };
  if (db) await db.from("components").update({ data: updated, name: updated.name }).eq("id", id);
  else memComponents.set(id, updated);
  return updated;
}
async function deleteComponent(id: string) {
  if (db) { const { error } = await db.from("components").delete().eq("id", id); return !error; }
  return memComponents.delete(id);
}

// ── Comments CRUD (Sprint 5) ──
async function createComment(data: any) {
  const id = `cmt_${uid()}`;
  const now = new Date().toISOString();
  const comment = {
    id, template_id: data.templateId, frame_id: data.frameId || null,
    x: data.x ?? 0, y: data.y ?? 0, author: data.author, text: data.text,
    thread: [], resolved: false, created_at: now, updated_at: now,
  };
  if (db) await db.from("comments").upsert(comment, { onConflict: "id" });
  else memComments.set(id, { ...comment, templateId: comment.template_id, frameId: comment.frame_id, createdAt: comment.created_at, updatedAt: comment.updated_at });
  return comment;
}
async function listComments(templateId: string) {
  if (db) {
    const { data } = await db.from("comments").select("*").eq("template_id", templateId).order("created_at", { ascending: false });
    return data || [];
  }
  return Array.from(memComments.values())
    .filter((c: any) => c.templateId === templateId)
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
async function updateComment(id: string, updates: any) {
  if (db) {
    const dbUpdates: any = { updated_at: new Date().toISOString() };
    if (updates.resolved !== undefined) dbUpdates.resolved = updates.resolved;
    if (updates.text !== undefined) dbUpdates.text = updates.text;
    if (updates.thread !== undefined) dbUpdates.thread = updates.thread;
    const { data, error } = await db.from("comments").update(dbUpdates).eq("id", id).select().single();
    if (error || !data) return null;
    return data;
  }
  const comment = memComments.get(id);
  if (!comment) return null;
  if (updates.resolved !== undefined) comment.resolved = updates.resolved;
  if (updates.text !== undefined) comment.text = updates.text;
  if (updates.thread !== undefined) comment.thread = updates.thread;
  comment.updatedAt = new Date().toISOString();
  memComments.set(id, comment);
  return comment;
}
async function deleteComment(id: string) {
  if (db) { const { error } = await db.from("comments").delete().eq("id", id); return !error; }
  return memComments.delete(id);
}
async function addReply(commentId: string, author: string, text: string) {
  const reply = { id: `rpl_${uid()}`, author, text, created_at: new Date().toISOString() };
  if (db) {
    const { data: existing } = await db.from("comments").select("thread").eq("id", commentId).single();
    if (!existing) return null;
    const thread = [...(existing.thread || []), reply];
    await db.from("comments").update({ thread, updated_at: new Date().toISOString() }).eq("id", commentId);
    return reply;
  }
  const comment = memComments.get(commentId);
  if (!comment) return null;
  comment.thread.push({ ...reply, createdAt: reply.created_at });
  comment.updatedAt = new Date().toISOString();
  memComments.set(commentId, comment);
  return reply;
}

// ── Version History (Sprint 5) ──
async function createVersion(templateId: string, data: any, author?: string, message?: string) {
  let versionNumber = 1;
  if (db) {
    const { data: latest } = await db.from("template_versions").select("version_number").eq("template_id", templateId).order("version_number", { ascending: false }).limit(1).single();
    if (latest) versionNumber = latest.version_number + 1;
  } else {
    const versions = memVersions.get(templateId) || [];
    if (versions.length > 0) versionNumber = Math.max(...versions.map((v: any) => v.versionNumber)) + 1;
  }
  const version = {
    id: `ver_${uid()}`, template_id: templateId, version_number: versionNumber,
    data, author: author || null, message: message || null,
    created_at: new Date().toISOString(),
  };
  if (db) {
    await db.from("template_versions").insert(version);
    // Prune old versions (keep last 50)
    const { data: allVersions } = await db.from("template_versions").select("id").eq("template_id", templateId).order("version_number", { ascending: false });
    if (allVersions && allVersions.length > 50) {
      const toDelete = allVersions.slice(50).map((v: any) => v.id);
      await db.from("template_versions").delete().in("id", toDelete);
    }
  } else {
    const versions = memVersions.get(templateId) || [];
    versions.unshift({ ...version, templateId: version.template_id, versionNumber: version.version_number, createdAt: version.created_at });
    if (versions.length > 50) versions.pop();
    memVersions.set(templateId, versions);
  }
  return version;
}
async function listVersions(templateId: string) {
  if (db) {
    const { data } = await db.from("template_versions").select("*").eq("template_id", templateId).order("version_number", { ascending: false }).limit(50);
    return data || [];
  }
  return (memVersions.get(templateId) || []).slice(0, 50);
}
async function restoreVersion(templateId: string, versionId: string) {
  if (db) {
    const { data } = await db.from("template_versions").select("data").eq("id", versionId).eq("template_id", templateId).single();
    if (!data) return null;
    await db.from("templates").update({ data: data.data, name: data.data?.name }).eq("id", templateId);
    return data.data;
  }
  const versions = memVersions.get(templateId) || [];
  const version = versions.find((v: any) => v.id === versionId);
  if (!version) return null;
  return version.data;
}

// ── Router ──
export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const method = req.method;
  const path = url.pathname.replace(/^\/\.netlify\/functions\/api/, "").replace(/^\/api/, "") || "/";

  if (method === "OPTIONS") return json(null);

  // Validate API key (optional — if present, use it for user context)
  const auth = await authenticate(req);
  const userId = auth?.userId;

  try {
    // ── Health ──
    if (path === "/health" || path === "/api/health") return json({ status: "ok", runtime: "netlify-functions", version: "3.0.0", authenticated: !!userId, timestamp: new Date().toISOString() });

    // ── Config (public) ──
    if (path === "/config" || path === "/api/config") {
      return json({ supabaseUrl, supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "" });
    }

    // ── API Keys (require auth) ──
    if ((path === "/api-keys" || path === "/api/api-keys") && method === "GET") {
      if (!userId) return err("Authentication required", 401);
      return json({ success: true, data: await listApiKeys(userId) });
    }
    if ((path === "/api-keys" || path === "/api/api-keys") && method === "POST") {
      if (!userId) return err("Authentication required", 401);
      const b = await body(req);
      const key = await createApiKeyDB(b.name || "Default Key", userId);
      return json({ success: true, data: key }, 201);
    }
    const keyMatch = path.match(/^\/api-keys\/([^/]+)$/);
    if (keyMatch && method === "DELETE") {
      if (!userId) return err("Authentication required", 401);
      return (await deleteApiKey(keyMatch[1], userId)) ? json({ success: true }) : err("Not found", 404);
    }

    // ── Templates CRUD ──
    if ((path === "/templates" || path === "/api/templates") && method === "GET") return json({ success: true, data: await listTemplates(userId) });
    if ((path === "/templates" || path === "/api/templates") && method === "POST") {
      const b = await body(req);
      if (!b.name) return err("name is required");
      const tpl = await createTemplate(b.name, b.width, b.height, b.canvas, userId);
      await fireWebhooks("template.created", tpl);
      return json({ success: true, data: tpl }, 201);
    }

    const tplMatch = path.match(/^\/templates\/([^/]+)$/);
    if (tplMatch) {
      const id = tplMatch[1];
      if (method === "GET") { const t = await getTemplate(id); return t ? json({ success: true, data: t }) : err("Not found", 404); }
      if (method === "PUT") { const t = await updateTemplate(id, await body(req)); return t ? json({ success: true, data: t }) : err("Not found", 404); }
      if (method === "DELETE") { return (await deleteTemplate(id)) ? json({ success: true }) : err("Not found", 404); }
    }

    const dupMatch = path.match(/^\/templates\/([^/]+)\/duplicate$/);
    if (dupMatch && method === "POST") {
      const b = await body(req);
      const t = await getTemplate(dupMatch[1]);
      if (!t) return err("Not found", 404);
      const dup = await createTemplate(b.name || `${t.name} (copy)`, t.canvas.width, t.canvas.height, { ...t, id: undefined }, userId);
      return json({ success: true, data: dup }, 201);
    }

    // ── Layers ──
    const layersMatch = path.match(/^\/templates\/([^/]+)\/layers$/);
    if (layersMatch) {
      const id = layersMatch[1];
      if (method === "GET") { const t = await getTemplate(id); return t ? json({ success: true, data: t.layers }) : err("Not found", 404); }
      if (method === "PATCH") { const t = await applyLayerOverrides(id, (await body(req)).layers || {}); return t ? json({ success: true, data: t.layers }) : err("Not found", 404); }
    }

    const layerMatch = path.match(/^\/templates\/([^/]+)\/layers\/([^/]+)$/);
    if (layerMatch) {
      const [, id, name] = layerMatch;
      const t = await getTemplate(id);
      if (!t) return err("Not found", 404);
      const layer = t.layers.find((l: any) => l.name === name);
      if (!layer) return err("Layer not found", 404);
      if (method === "GET") return json({ success: true, data: layer });
      if (method === "PATCH") {
        const b = await body(req);
        for (const [k, v] of Object.entries(b)) layer[k] = v;
        await updateTemplate(id, t);
        await fireWebhooks("layer.updated", { templateId: id, layer });
        return json({ success: true, data: layer });
      }
    }

    // ── Render ──
    const renderMatch = path.match(/^\/templates\/([^/]+)\/render$/);
    if (renderMatch && method === "POST") {
      const b = await body(req);
      let tpl = await getTemplate(renderMatch[1]);
      if (!tpl) return err("Not found", 404);
      if (b.overrides?.layers) tpl = await applyLayerOverrides(renderMatch[1], b.overrides.layers);
      const result = { id: `rnd_${uid()}`, status: "completed", templateId: renderMatch[1], format: b.format || "png", template: tpl, createdAt: new Date().toISOString() };
      await fireWebhooks("render.complete", result);
      if (b.webhookUrl) { try { await fetch(b.webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "render.complete", payload: result }) }); } catch {} }
      return json({ success: true, data: result });
    }

    // ── Template Versions (Sprint 5) ──
    const versionsMatch = path.match(/^\/templates\/([^/]+)\/versions$/);
    if (versionsMatch) {
      const templateId = versionsMatch[1];
      if (method === "GET") {
        return json({ success: true, data: await listVersions(templateId) });
      }
      if (method === "POST") {
        const b = await body(req);
        let versionData = b.data;
        if (!versionData) {
          versionData = await getTemplate(templateId);
          if (!versionData) return err("Template not found", 404);
        }
        const version = await createVersion(templateId, versionData, b.author, b.message);
        await fireWebhooks("version.created", version);
        return json({ success: true, data: version }, 201);
      }
    }

    const versionMatch = path.match(/^\/templates\/([^/]+)\/versions\/([^/]+)$/);
    if (versionMatch && method === "GET") {
      if (db) {
        const { data } = await db.from("template_versions").select("*").eq("id", versionMatch[2]).single();
        return data ? json({ success: true, data }) : err("Not found", 404);
      }
      return err("Not found", 404);
    }

    const restoreMatch = path.match(/^\/templates\/([^/]+)\/versions\/([^/]+)\/restore$/);
    if (restoreMatch && method === "POST") {
      const [, templateId, versionId] = restoreMatch;
      const restored = await restoreVersion(templateId, versionId);
      if (!restored) return err("Version not found", 404);
      await fireWebhooks("version.restored", { templateId, versionId });
      return json({ success: true, data: restored });
    }

    // ── Webhooks ──
    if ((path === "/webhooks" || path === "/api/webhooks") && method === "GET") return json({ success: true, data: await listWebhooks(userId) });
    if ((path === "/webhooks" || path === "/api/webhooks") && method === "POST") {
      const b = await body(req);
      if (!b.url) return err("url is required");
      if (!b.events?.length) return err("events array is required");
      return json({ success: true, data: await registerWebhook(b.url, b.events, b.secret, userId) }, 201);
    }
    const whMatch = path.match(/^\/webhooks\/([^/]+)$/);
    if (whMatch && method === "DELETE") return (await deleteWebhook(whMatch[1])) ? json({ success: true }) : err("Not found", 404);

    // ── Styles CRUD (Sprint 3) ──
    if ((path === "/styles" || path === "/api/styles") && method === "GET") {
      return json({ success: true, data: await listStyles(userId) });
    }
    if ((path === "/styles" || path === "/api/styles") && method === "POST") {
      const b = await body(req);
      if (!b.name) return err("name is required");
      if (!b.type || !["color", "text", "effect"].includes(b.type)) return err("type must be color, text, or effect");
      const style = await createStyle(b, userId);
      await fireWebhooks("style.created", style);
      return json({ success: true, data: style }, 201);
    }

    const styleMatch = path.match(/^\/styles\/([^/]+)$/);
    if (styleMatch) {
      const id = styleMatch[1];
      if (method === "GET") {
        const s = await getStyle(id);
        return s ? json({ success: true, data: s }) : err("Not found", 404);
      }
      if (method === "PUT") {
        const s = await updateStyle(id, await body(req));
        if (!s) return err("Not found", 404);
        await fireWebhooks("style.updated", s);
        return json({ success: true, data: s });
      }
      if (method === "DELETE") {
        return (await deleteStyle(id)) ? json({ success: true }) : err("Not found", 404);
      }
    }

    // ── Components CRUD (Sprint 3) ──
    if ((path === "/components" || path === "/api/components") && method === "GET") {
      return json({ success: true, data: await listComponents() });
    }
    if ((path === "/components" || path === "/api/components") && method === "POST") {
      const b = await body(req);
      if (!b.name) return err("name is required");
      if (!b.canvas) return err("canvas config is required");
      if (!b.layers || !Array.isArray(b.layers)) return err("layers array is required");
      const comp = await createComponent(b);
      await fireWebhooks("component.created", comp);
      return json({ success: true, data: comp }, 201);
    }

    const compMatch = path.match(/^\/components\/([^/]+)$/);
    if (compMatch) {
      const id = compMatch[1];
      if (method === "GET") {
        const c = await getComponent(id);
        return c ? json({ success: true, data: c }) : err("Not found", 404);
      }
      if (method === "PUT") {
        const c = await updateComponent(id, await body(req));
        if (!c) return err("Not found", 404);
        await fireWebhooks("component.updated", c);
        return json({ success: true, data: c });
      }
      if (method === "DELETE") {
        return (await deleteComponent(id)) ? json({ success: true }) : err("Not found", 404);
      }
    }

    // ── Comments CRUD (Sprint 5) ──
    if ((path === "/comments" || path === "/api/comments") && method === "GET") {
      const templateId = url.searchParams.get("templateId");
      if (!templateId) return err("templateId query param required");
      return json({ success: true, data: await listComments(templateId) });
    }
    if ((path === "/comments" || path === "/api/comments") && method === "POST") {
      const b = await body(req);
      if (!b.templateId || !b.text || !b.author) return err("templateId, text, and author are required");
      const comment = await createComment(b);
      await fireWebhooks("comment.created", comment);
      return json({ success: true, data: comment }, 201);
    }

    const commentMatch = path.match(/^\/comments\/([^/]+)$/);
    if (commentMatch) {
      const commentId = commentMatch[1];
      if (method === "PATCH") {
        const c = await updateComment(commentId, await body(req));
        if (!c) return err("Not found", 404);
        await fireWebhooks("comment.updated", c);
        return json({ success: true, data: c });
      }
      if (method === "DELETE") {
        return (await deleteComment(commentId)) ? json({ success: true }) : err("Not found", 404);
      }
    }

    const replyMatch = path.match(/^\/comments\/([^/]+)\/replies$/);
    if (replyMatch && method === "POST") {
      const b = await body(req);
      if (!b.author || !b.text) return err("author and text required");
      const reply = await addReply(replyMatch[1], b.author, b.text);
      if (!reply) return err("Comment not found", 404);
      await fireWebhooks("comment.reply", { commentId: replyMatch[1], reply });
      return json({ success: true, data: reply }, 201);
    }

    // ── Design Export ──────────────────────────────────────────────

    // Export template data (for client-side rendering)
    const exportMatch = path.match(/^\/templates\/([^/]+)\/export$/);
    if (exportMatch && method === "POST") {
      const tpl = await getTemplate(exportMatch[1]);
      if (!tpl) return err("Template not found", 404);
      const b = await body(req);
      const format = b.format || "png";
      const scale = b.scale || 2;

      // Return canvas data for client-side rendering
      const exportData = {
        id: `exp_${uid()}`,
        templateId: exportMatch[1],
        format,
        scale,
        canvas: tpl.canvas,
        layers: tpl.layers || [],
        metadata: tpl.metadata,
        exportedAt: new Date().toISOString(),
      };

      await fireWebhooks("export.requested", exportData);
      return json({ success: true, data: exportData }, 200);
    }

    // Upload rendered image (client renders and uploads result)
    const uploadMatch = path.match(/^\/templates\/([^/]+)\/export\/upload$/);
    if (uploadMatch && method === "POST") {
      const tpl = await getTemplate(uploadMatch[1]);
      if (!tpl) return err("Template not found", 404);
      const b = await body(req);

      if (!b.imageData) return err("imageData (base64) is required");
      if (!b.format) return err("format (png/svg/jpg) is required");

      const uploadResult = {
        id: `exp_${uid()}`,
        templateId: uploadMatch[1],
        templateName: tpl.name,
        format: b.format,
        imageData: b.imageData, // base64 data URL
        width: b.width || null,
        height: b.height || null,
        exportedAt: new Date().toISOString(),
      };

      await fireWebhooks("export.complete", uploadResult);

      // If webhookUrl provided, send the export to that URL
      if (b.webhookUrl) {
        try {
          await fetch(b.webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event: "export.complete", payload: uploadResult }),
          });
        } catch {}
      }

      return json({ success: true, data: uploadResult }, 200);
    }

    // Generate SVG from template data (server-side)
    const svgExportMatch = path.match(/^\/templates\/([^/]+)\/export\/svg$/);
    if (svgExportMatch && method === "GET") {
      const tpl = await getTemplate(svgExportMatch[1]);
      if (!tpl) return err("Template not found", 404);

      // Generate basic SVG from template data
      const w = tpl.canvas?.width || 1080;
      const h = tpl.canvas?.height || 1080;
      const layers = tpl.layers || [];

      let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
      svgContent += `<rect width="${w}" height="${h}" fill="${tpl.canvas?.background || '#ffffff'}"/>`;

      for (const layer of layers) {
        const x = layer.x || 0;
        const y = layer.y || 0;
        const lw = layer.width || 100;
        const lh = layer.height || 100;
        const fill = layer.fill || '#6366f1';
        const opacity = layer.opacity ?? 1;

        switch (layer.type) {
          case 'rect':
            svgContent += `<rect x="${x}" y="${y}" width="${lw}" height="${lh}" fill="${fill}" opacity="${opacity}" rx="${layer.cornerRadius || 0}"/>`;
            break;
          case 'ellipse':
            svgContent += `<ellipse cx="${x + lw/2}" cy="${y + lh/2}" rx="${lw/2}" ry="${lh/2}" fill="${fill}" opacity="${opacity}"/>`;
            break;
          case 'text':
          case 'textbox':
          case 'i-text':
            svgContent += `<text x="${x}" y="${y + (layer.fontSize || 32)}" font-family="${layer.fontFamily || 'sans-serif'}" font-size="${layer.fontSize || 32}" fill="${fill}" opacity="${opacity}">${layer.text || 'Text'}</text>`;
            break;
          case 'line':
            svgContent += `<line x1="${x}" y1="${y}" x2="${layer.x2 || x + lw}" y2="${layer.y2 || y}" stroke="${layer.stroke || fill}" stroke-width="${layer.strokeWidth || 2}" opacity="${opacity}"/>`;
            break;
        }
      }

      svgContent += '</svg>';

      return new Response(svgContent, {
        status: 200,
        headers: {
          'Content-Type': 'image/svg+xml',
          'Content-Disposition': `attachment; filename="${tpl.name || 'design'}.svg"`,
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // ── API Key Management (public endpoint for key creation) ──────
    const createKeyMatch = path.match(/^\/api-keys\/create$/);
    if (createKeyMatch && method === "POST") {
      if (!db) return err("Supabase not configured — API keys require database", 400);
      const b = await body(req);
      if (!b.name) return err("name is required");
      const auth = await authenticate(req);
      const userId = auth?.userId || b.userId;
      if (!userId) return err("userId or API key required", 401);
      const key = await createApiKeyDB(b.name, userId);
      return json({ success: true, data: key }, 201);
    }

    return err("Not found", 404);
  } catch (e: any) {
    console.error("[API ERROR]", e);
    return err(e.message || "Internal server error", 500);
  }
};

export const config = { path: "/api/*" };
