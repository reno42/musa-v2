import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { getSupabaseAdmin } from "../services/supabase.js";
import { encryptWorkspaceSecret } from "../services/secrets.js";
import { assertSafeIntegrationEndpoint } from "../services/workspaceIntegrations.js";
import { requireWorkspaceRole } from "../services/tenancy.js";
import { claimLegacyWorkspacesForInitialUser } from "../services/legacyOwnership.js";

const roleSchema = z.enum(["admin", "editor", "viewer"]);
const workspaceKeyRoleSchema = z.enum(["editor", "viewer"]);

function dbOrThrow() {
  const sb = getSupabaseAdmin();
  if (!sb) throw new Error("Supabase is required for SaaS workspace features");
  return sb;
}

function hash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export const accountRoutes = Router();

accountRoutes.post("/bootstrap", async (req, res) => {
  try {
    const sb = dbOrThrow();
    const { data: userResult, error } = await sb.auth.admin.getUserById(req.auth!.userId);
    if (error || !userResult.user) return res.status(401).json({ success: false, error: "User session not found" });
    const user = userResult.user;
    const profile = {
      id: user.id,
      email: user.email,
      display_name: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0],
      avatar_url: user.user_metadata?.avatar_url || null,
      updated_at: new Date().toISOString(),
    };
    await sb.from("user_profiles").upsert(profile);
    const legacyWorkspacesClaimed = await claimLegacyWorkspacesForInitialUser(sb, user);

    res.json({ success: true, data: { profile, legacyWorkspacesClaimed } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

accountRoutes.get("/me", async (req, res) => {
  try {
    const sb = dbOrThrow();
    const { data } = await sb.from("user_profiles").select("id, email, display_name, avatar_url").eq("id", req.auth!.userId).maybeSingle();
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

accountRoutes.post("/invitations/accept", async (req, res) => {
  try {
    const token = z.string().min(20).parse(req.body.token);
    const sb = dbOrThrow();
    const { data: userResult } = await sb.auth.admin.getUserById(req.auth!.userId);
    const email = userResult.user?.email?.toLowerCase();
    if (!email || !userResult.user?.email_confirmed_at) {
      return res.status(400).json({ success: false, error: "A verified email is required to accept an invitation" });
    }
    const { data: invitation } = await sb.from("workspace_invitations")
      .select("id, workspace_id, email, role, expires_at")
      .eq("token_hash", hash(token)).is("accepted_at", null).maybeSingle();
    if (!invitation || invitation.email.toLowerCase() !== email || new Date(invitation.expires_at) <= new Date()) {
      return res.status(404).json({ success: false, error: "Invitation not found or expired" });
    }
    await sb.from("workspace_members").upsert({ workspace_id: invitation.workspace_id, user_id: req.auth!.userId, role: invitation.role });
    await sb.from("workspace_invitations").update({ accepted_at: new Date().toISOString() }).eq("id", invitation.id);
    res.json({ success: true, data: { workspaceId: invitation.workspace_id } });
  } catch (error: any) {
    res.status(error instanceof z.ZodError ? 400 : 500).json({ success: false, error: error.message });
  }
});

export const workspaceSaasRoutes = Router();

workspaceSaasRoutes.get("/:id/members", requireWorkspaceRole("viewer"), async (req, res) => {
  try {
    const sb = dbOrThrow();
    const [{ data: members }, { data: workspace }] = await Promise.all([
      sb.from("workspace_members").select("user_id, role, joined_at").eq("workspace_id", req.params.id).order("joined_at"),
      sb.from("workspaces").select("owner_id").eq("id", req.params.id).single(),
    ]);
    const userIds = [...new Set([workspace?.owner_id, ...(members || []).map((m: any) => m.user_id)].filter(Boolean))];
    const { data: profiles } = userIds.length
      ? await sb.from("user_profiles").select("id, email, display_name, avatar_url").in("id", userIds)
      : { data: [] } as any;
    const profileMap = new Map((profiles || []).map((profile: any) => [profile.id, profile]));
    const result = userIds.map((userId) => ({
      ...(profileMap.get(userId) || { id: userId }),
      role: userId === workspace?.owner_id ? "owner" : members?.find((m: any) => m.user_id === userId)?.role,
      joinedAt: members?.find((m: any) => m.user_id === userId)?.joined_at,
    }));
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

workspaceSaasRoutes.post("/:id/invitations", requireWorkspaceRole("admin"), async (req, res) => {
  try {
    const parsed = z.object({ email: z.string().email(), role: roleSchema.default("editor") }).parse(req.body);
    const sb = dbOrThrow();
    const rawToken = crypto.randomBytes(24).toString("base64url");
    await sb.from("workspace_invitations").delete()
      .eq("workspace_id", req.params.id).ilike("email", parsed.email.trim()).is("accepted_at", null);
    const { data, error } = await sb.from("workspace_invitations").insert({
      workspace_id: req.params.id,
      email: parsed.email.trim().toLowerCase(),
      role: parsed.role,
      token_hash: hash(rawToken),
      invited_by: req.auth!.userId,
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      accepted_at: null,
    }).select("id, email, role, expires_at").single();
    if (error) throw error;
    res.status(201).json({ success: true, data: { ...data, inviteToken: rawToken } });
  } catch (error: any) {
    const status = error instanceof z.ZodError ? 400 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

workspaceSaasRoutes.patch("/:id/members/:userId", requireWorkspaceRole("admin"), async (req, res) => {
  try {
    const role = roleSchema.parse(req.body.role);
    const sb = dbOrThrow();
    const { data: member } = await sb.from("workspace_members").select("role").eq("workspace_id", req.params.id).eq("user_id", req.params.userId).maybeSingle();
    if (member?.role === "owner") return res.status(400).json({ success: false, error: "The workspace owner role cannot be changed" });
    const { error } = await sb.from("workspace_members").update({ role }).eq("workspace_id", req.params.id).eq("user_id", req.params.userId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(error instanceof z.ZodError ? 400 : 500).json({ success: false, error: error.message });
  }
});

workspaceSaasRoutes.delete("/:id/members/:userId", requireWorkspaceRole("admin"), async (req, res) => {
  try {
    const sb = dbOrThrow();
    const { data: workspace } = await sb.from("workspaces").select("owner_id").eq("id", req.params.id).single();
    if (workspace?.owner_id === req.params.userId) return res.status(400).json({ success: false, error: "The workspace owner cannot be removed" });
    await sb.from("workspace_members").delete().eq("workspace_id", req.params.id).eq("user_id", req.params.userId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

workspaceSaasRoutes.get("/:id/api-keys", requireWorkspaceRole("admin"), async (req, res) => {
  try {
    const sb = dbOrThrow();
    const { data, error } = await sb.from("workspace_api_keys")
      .select("id, label, key_prefix, role, last_used_at, expires_at, created_at")
      .eq("workspace_id", req.params.id).is("revoked_at", null).order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

workspaceSaasRoutes.post("/:id/api-keys", requireWorkspaceRole("admin"), async (req, res) => {
  try {
    const parsed = z.object({ label: z.string().min(1).max(80), role: workspaceKeyRoleSchema.default("editor") }).parse(req.body);
    const rawKey = `fdr_ws_${crypto.randomBytes(24).toString("base64url")}`;
    const sb = dbOrThrow();
    const { data, error } = await sb.from("workspace_api_keys").insert({
      workspace_id: req.params.id,
      created_by: req.auth!.userId,
      label: parsed.label,
      role: parsed.role,
      key_prefix: `${rawKey.slice(0, 12)}…${rawKey.slice(-4)}`,
      key_hash: hash(rawKey),
    }).select("id, label, key_prefix, role, created_at").single();
    if (error) throw error;
    res.status(201).json({ success: true, data: { ...data, key: rawKey } });
  } catch (error: any) {
    res.status(error instanceof z.ZodError ? 400 : 500).json({ success: false, error: error.message });
  }
});

workspaceSaasRoutes.delete("/:id/api-keys/:keyId", requireWorkspaceRole("admin"), async (req, res) => {
  try {
    const sb = dbOrThrow();
    await sb.from("workspace_api_keys").update({ revoked_at: new Date().toISOString() })
      .eq("workspace_id", req.params.id).eq("id", req.params.keyId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const connectionSchema = z.object({
  name: z.string().min(1).max(100),
  kind: z.enum(["mcp", "model_api"]).default("mcp"),
  provider: z.string().min(1).max(80),
  endpointUrl: z.string().url(),
  enabled: z.boolean().default(true),
  publicConfig: z.record(z.unknown()).default({}),
  credentials: z.record(z.unknown()).optional(),
});

workspaceSaasRoutes.get("/:id/connections", requireWorkspaceRole("viewer"), async (req, res) => {
  try {
    const sb = dbOrThrow();
    const { data, error } = await sb.from("workspace_mcp_connections")
      .select("id, name, kind, provider, endpoint_url, enabled, public_config, credentials_encrypted, created_at, updated_at")
      .eq("workspace_id", req.params.id).order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ success: true, data: (data || []).map(({ credentials_encrypted, ...row }: any) => ({
      ...row,
      endpointUrl: row.endpoint_url,
      publicConfig: row.public_config,
      hasCredentials: Boolean(credentials_encrypted),
    })) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

workspaceSaasRoutes.post("/:id/connections", requireWorkspaceRole("admin"), async (req, res) => {
  try {
    const parsed = connectionSchema.parse(req.body);
    await assertSafeIntegrationEndpoint(parsed.endpointUrl);
    const sb = dbOrThrow();
    const { data, error } = await sb.from("workspace_mcp_connections").insert({
      workspace_id: req.params.id,
      name: parsed.name,
      kind: parsed.kind,
      provider: parsed.provider,
      endpoint_url: parsed.endpointUrl,
      enabled: parsed.enabled,
      public_config: parsed.publicConfig,
      credentials_encrypted: parsed.credentials ? encryptWorkspaceSecret(parsed.credentials) : null,
      created_by: req.auth!.userId,
    }).select("id, name, kind, provider, endpoint_url, enabled, public_config, created_at").single();
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (error: any) {
    res.status(error instanceof z.ZodError ? 400 : 500).json({ success: false, error: error.message });
  }
});

workspaceSaasRoutes.patch("/:id/connections/:connectionId", requireWorkspaceRole("admin"), async (req, res) => {
  try {
    const parsed = connectionSchema.partial().parse(req.body);
    if (parsed.endpointUrl) await assertSafeIntegrationEndpoint(parsed.endpointUrl);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.name !== undefined) patch.name = parsed.name;
    if (parsed.kind !== undefined) patch.kind = parsed.kind;
    if (parsed.provider !== undefined) patch.provider = parsed.provider;
    if (parsed.endpointUrl !== undefined) patch.endpoint_url = parsed.endpointUrl;
    if (parsed.enabled !== undefined) patch.enabled = parsed.enabled;
    if (parsed.publicConfig !== undefined) patch.public_config = parsed.publicConfig;
    if (parsed.credentials !== undefined) patch.credentials_encrypted = encryptWorkspaceSecret(parsed.credentials);
    const sb = dbOrThrow();
    const { error } = await sb.from("workspace_mcp_connections").update(patch)
      .eq("workspace_id", req.params.id).eq("id", req.params.connectionId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(error instanceof z.ZodError ? 400 : 500).json({ success: false, error: error.message });
  }
});

workspaceSaasRoutes.delete("/:id/connections/:connectionId", requireWorkspaceRole("admin"), async (req, res) => {
  try {
    const sb = dbOrThrow();
    await sb.from("workspace_mcp_connections").delete().eq("workspace_id", req.params.id).eq("id", req.params.connectionId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const contactSchema = z.object({
  brandId: z.string().nullable().optional(),
  brandName: z.string().max(120).optional(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().max(100).optional(),
  email: z.string().email().or(z.literal("")).optional(),
  phone: z.string().max(50).optional(),
  jobTitle: z.string().max(120).optional(),
  company: z.string().max(120).optional(),
  status: z.enum(["lead", "active", "inactive"]).default("active"),
  tags: z.array(z.string().max(50)).max(30).default([]),
  notes: z.string().max(5000).optional(),
});

workspaceSaasRoutes.get("/:id/contacts", requireWorkspaceRole("viewer"), async (req, res) => {
  try {
    const sb = dbOrThrow();
    let query = sb.from("crm_contacts").select("*").eq("workspace_id", req.params.id).order("updated_at", { ascending: false });
    if (req.query.search) query = query.or(`first_name.ilike.%${req.query.search}%,last_name.ilike.%${req.query.search}%,company.ilike.%${req.query.search}%,brand_name.ilike.%${req.query.search}%`);
    const { data, error } = await query.limit(250);
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

workspaceSaasRoutes.post("/:id/contacts", requireWorkspaceRole("editor"), async (req, res) => {
  try {
    const parsed = contactSchema.parse(req.body);
    const sb = dbOrThrow();
    const { data, error } = await sb.from("crm_contacts").insert({
      workspace_id: req.params.id,
      brand_id: parsed.brandId || null,
      brand_name: parsed.brandName || null,
      first_name: parsed.firstName,
      last_name: parsed.lastName || null,
      email: parsed.email || null,
      phone: parsed.phone || null,
      job_title: parsed.jobTitle || null,
      company: parsed.company || null,
      status: parsed.status,
      tags: parsed.tags,
      notes: parsed.notes || null,
      created_by: req.auth!.userId,
    }).select("*").single();
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (error: any) {
    res.status(error instanceof z.ZodError ? 400 : 500).json({ success: false, error: error.message });
  }
});

workspaceSaasRoutes.patch("/:id/contacts/:contactId", requireWorkspaceRole("editor"), async (req, res) => {
  try {
    const parsed = contactSchema.partial().parse(req.body);
    const fields: Record<string, string> = {
      brandId: "brand_id", brandName: "brand_name", firstName: "first_name", lastName: "last_name",
      email: "email", phone: "phone", jobTitle: "job_title", company: "company", status: "status",
      tags: "tags", notes: "notes",
    };
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [clientKey, dbKey] of Object.entries(fields)) {
      if (clientKey in parsed) patch[dbKey] = (parsed as any)[clientKey] || null;
    }
    const sb = dbOrThrow();
    const { data, error } = await sb.from("crm_contacts").update(patch)
      .eq("workspace_id", req.params.id).eq("id", req.params.contactId).select("*").single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(error instanceof z.ZodError ? 400 : 500).json({ success: false, error: error.message });
  }
});

workspaceSaasRoutes.delete("/:id/contacts/:contactId", requireWorkspaceRole("editor"), async (req, res) => {
  try {
    const sb = dbOrThrow();
    await sb.from("crm_contacts").delete().eq("workspace_id", req.params.id).eq("id", req.params.contactId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});
