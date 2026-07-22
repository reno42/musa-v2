import { Router, type Request } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { getSupabase, getSupabaseAdmin } from "../services/supabase.js";
import { encryptWorkspaceSecret } from "../services/secrets.js";
import { assertSafeIntegrationEndpoint } from "../services/workspaceIntegrations.js";
import { requireWorkspaceRole } from "../services/tenancy.js";
import { claimLegacyWorkspacesForInitialUser, ensurePersonalWorkspace } from "../services/legacyOwnership.js";
import { deliverWorkspaceInvitation, invitationUrl, maskEmail } from "../services/workspaceInvitations.js";

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

function invitationState(invitation: any) {
  if (invitation.accepted_at) return "accepted";
  if (invitation.declined_at) return "declined";
  if (invitation.revoked_at) return "revoked";
  if (new Date(invitation.expires_at) <= new Date()) return "expired";
  return "pending";
}

async function invitationDetails(sb: ReturnType<typeof dbOrThrow>, invitations: any[]) {
  const workspaceIds = [...new Set(invitations.map((item) => item.workspace_id).filter(Boolean))];
  const inviterIds = [...new Set(invitations.map((item) => item.invited_by).filter(Boolean))];
  const [{ data: workspaces }, { data: inviters }] = await Promise.all([
    workspaceIds.length ? sb.from("workspaces").select("id, name").in("id", workspaceIds) : Promise.resolve({ data: [] }),
    inviterIds.length ? sb.from("user_profiles").select("id, display_name, email").in("id", inviterIds) : Promise.resolve({ data: [] }),
  ]);
  const workspaceMap = new Map((workspaces || []).map((item: any) => [item.id, item]));
  const inviterMap = new Map((inviters || []).map((item: any) => [item.id, item]));
  return invitations.map((invitation) => ({
    id: invitation.id,
    workspaceId: invitation.workspace_id,
    workspaceName: (workspaceMap.get(invitation.workspace_id) as any)?.name || "Workspace",
    email: invitation.email,
    role: invitation.role,
    status: invitationState(invitation),
    expiresAt: invitation.expires_at,
    createdAt: invitation.created_at,
    lastSentAt: invitation.last_sent_at,
    deliveryMethod: invitation.delivery_method || "link",
    requiresAccountSetup: Boolean(invitation.requires_account_setup),
    invitedBy: (inviterMap.get(invitation.invited_by) as any)?.display_name
      || (inviterMap.get(invitation.invited_by) as any)?.email
      || "Un administrador",
  }));
}

function invitationRpcStatus(error: any) {
  if (error?.code === "P0002") return 404;
  if (error?.code === "42501") return 403;
  return 400;
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
      email: user.email?.toLowerCase(),
      display_name: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0],
      avatar_url: user.user_metadata?.avatar_url || null,
      updated_at: new Date().toISOString(),
    };
    const { error: profileError } = await sb.from("user_profiles").upsert(profile);
    if (profileError) throw profileError;
    const legacyWorkspacesClaimed = await claimLegacyWorkspacesForInitialUser(sb, user);
    const personalWorkspaceId = await ensurePersonalWorkspace(sb, user);

    res.json({ success: true, data: { profile, legacyWorkspacesClaimed, personalWorkspaceId } });
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

accountRoutes.get("/invitations", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const sb = dbOrThrow();
    const { data: userResult, error: userError } = await sb.auth.admin.getUserById(req.auth!.userId);
    if (userError || !userResult.user?.email || !userResult.user.email_confirmed_at) {
      return res.status(400).json({ success: false, error: "A verified email is required" });
    }
    const { data, error } = await sb.from("workspace_invitations")
      .select("id, workspace_id, email, role, invited_by, expires_at, accepted_at, declined_at, revoked_at, created_at, last_sent_at, delivery_method, requires_account_setup")
      .eq("email", userResult.user.email.trim().toLowerCase())
      .is("accepted_at", null)
      .is("declined_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ success: true, data: await invitationDetails(sb, data || []) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

async function respondToInvitation(req: any, res: any, response: "accept" | "decline") {
  try {
    const selector = z.object({ token: z.string().min(20).optional(), invitationId: z.string().uuid().optional() })
      .refine((value) => Boolean(value.token || value.invitationId), "Invitation token or id is required")
      .parse({ token: req.body?.token, invitationId: req.params?.invitationId });
    const sb = getSupabase();
    if (!sb) throw new Error("Supabase is required for workspace invitations");
    const functionName = response === "accept" ? "accept_workspace_invitation" : "decline_workspace_invitation";
    const { data, error } = await sb.rpc(functionName, {
      invitation_token_hash: selector.token ? hash(selector.token) : null,
      target_invitation_id: selector.invitationId || null,
    });
    if (error) return res.status(invitationRpcStatus(error)).json({ success: false, error: error.message });
    return res.json({ success: true, data: { workspaceId: data } });
  } catch (error: any) {
    const status = error instanceof z.ZodError ? 400 : 500;
    return res.status(status).json({ success: false, error: error.message });
  }
}

accountRoutes.post("/invitations/accept", async (req, res) => {
  return respondToInvitation(req, res, "accept");
});

accountRoutes.post("/invitations/decline", async (req, res) => respondToInvitation(req, res, "decline"));
accountRoutes.post("/invitations/:invitationId/accept", async (req, res) => respondToInvitation(req, res, "accept"));
accountRoutes.post("/invitations/:invitationId/decline", async (req, res) => respondToInvitation(req, res, "decline"));

export const invitationRoutes = Router();

invitationRoutes.get("/:token", async (req, res) => {
  try {
    const token = z.string().min(20).max(200).parse(req.params.token);
    const sb = dbOrThrow();
    const { data: invitation, error } = await sb.from("workspace_invitations")
      .select("id, workspace_id, email, role, invited_by, expires_at, accepted_at, declined_at, revoked_at, created_at, last_sent_at, delivery_method, requires_account_setup")
      .eq("token_hash", hash(token))
      .maybeSingle();
    if (error) throw error;
    if (!invitation || invitationState(invitation) !== "pending") {
      return res.status(404).json({ success: false, error: "Invitation not found or expired" });
    }
    const [details] = await invitationDetails(sb, [invitation]);
    const { data: profile } = await sb.from("user_profiles").select("id").eq("email", invitation.email).limit(1).maybeSingle();
    res.setHeader("Cache-Control", "no-store");
    res.json({
      success: true,
      data: {
        ...details,
        email: undefined,
        maskedEmail: maskEmail(invitation.email),
        accountExists: Boolean(profile),
      },
    });
  } catch (error: any) {
    const status = error instanceof z.ZodError ? 400 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

async function issueWorkspaceInvitation(
  req: Request,
  workspaceId: string,
  emailInput: string,
  role: z.infer<typeof roleSchema>,
  invitationId?: string,
) {
  const sb = dbOrThrow();
  const email = emailInput.trim().toLowerCase();
  const { data: recipientProfile } = await sb.from("user_profiles")
    .select("id, email")
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  if (recipientProfile?.id === req.auth!.userId) {
    throw Object.assign(new Error("You already have access to this workspace"), { statusCode: 409 });
  }
  if (recipientProfile?.id) {
    const { data: existingMember } = await sb.from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", recipientProfile.id)
      .maybeSingle();
    if (existingMember) {
      throw Object.assign(new Error("This person is already a workspace member"), { statusCode: 409 });
    }
  }

  const rawToken = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const now = new Date().toISOString();
  let invitation: any;

  if (invitationId) {
    const { data, error } = await sb.from("workspace_invitations").update({
      token_hash: hash(rawToken),
      role,
      expires_at: expiresAt,
      last_sent_at: now,
      accepted_at: null,
      accepted_by: null,
      declined_at: null,
      revoked_at: null,
      revoked_by: null,
    }).eq("workspace_id", workspaceId).eq("id", invitationId)
      .select("id, email, role, expires_at, created_at").single();
    if (error) throw error;
    invitation = data;
  } else {
    await sb.from("workspace_invitations").update({
      revoked_at: now,
      revoked_by: req.auth!.userId,
    }).eq("workspace_id", workspaceId)
      .eq("email", email)
      .is("accepted_at", null)
      .is("declined_at", null)
      .is("revoked_at", null);

    const { data, error } = await sb.from("workspace_invitations").insert({
      workspace_id: workspaceId,
      email,
      role,
      token_hash: hash(rawToken),
      invited_by: req.auth!.userId,
      expires_at: expiresAt,
      accepted_at: null,
      last_sent_at: now,
    }).select("id, email, role, expires_at, created_at").single();
    if (error) throw error;
    invitation = data;
  }

  const inviteLink = invitationUrl(req, rawToken);
  const delivery = await deliverWorkspaceInvitation(sb, email, inviteLink, Boolean(recipientProfile));
  const { error: deliveryUpdateError } = await sb.from("workspace_invitations").update({
    delivery_method: delivery.method,
    requires_account_setup: delivery.requiresAccountSetup,
    last_sent_at: now,
  }).eq("id", invitation.id);
  if (deliveryUpdateError) throw deliveryUpdateError;

  return {
    ...invitation,
    inviteLink,
    emailSent: delivery.emailSent,
    deliveryMethod: delivery.method,
    requiresAccountSetup: delivery.requiresAccountSetup,
    warning: delivery.warning,
  };
}

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
    res.setHeader("Cache-Control", "no-store");
    const parsed = z.object({ email: z.string().email(), role: roleSchema.default("editor") }).parse(req.body);
    const data = await issueWorkspaceInvitation(req, req.params.id, parsed.email, parsed.role);
    res.status(201).json({ success: true, data });
  } catch (error: any) {
    const status = error instanceof z.ZodError ? 400 : error.statusCode || 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

workspaceSaasRoutes.get("/:id/invitations", requireWorkspaceRole("admin"), async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const sb = dbOrThrow();
    const { data, error } = await sb.from("workspace_invitations")
      .select("id, workspace_id, email, role, invited_by, expires_at, accepted_at, declined_at, revoked_at, created_at, last_sent_at, delivery_method, requires_account_setup")
      .eq("workspace_id", req.params.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    res.json({ success: true, data: await invitationDetails(sb, data || []) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

workspaceSaasRoutes.post("/:id/invitations/:invitationId/resend", requireWorkspaceRole("admin"), async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const sb = dbOrThrow();
    const { data: invitation, error } = await sb.from("workspace_invitations")
      .select("id, email, role, accepted_at")
      .eq("workspace_id", req.params.id)
      .eq("id", req.params.invitationId)
      .maybeSingle();
    if (error) throw error;
    if (!invitation || invitation.accepted_at) {
      return res.status(404).json({ success: false, error: "Pending invitation not found" });
    }
    const role = roleSchema.parse(invitation.role);
    const data = await issueWorkspaceInvitation(req, req.params.id, invitation.email, role, invitation.id);
    res.json({ success: true, data });
  } catch (error: any) {
    const status = error instanceof z.ZodError ? 400 : error.statusCode || 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

workspaceSaasRoutes.delete("/:id/invitations/:invitationId", requireWorkspaceRole("admin"), async (req, res) => {
  try {
    const sb = dbOrThrow();
    const { error } = await sb.from("workspace_invitations").update({
      revoked_at: new Date().toISOString(),
      revoked_by: req.auth!.userId,
    }).eq("workspace_id", req.params.id)
      .eq("id", req.params.invitationId)
      .is("accepted_at", null);
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
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
  relationshipStatus: z.enum(["lead", "client"]).optional(),
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

const brandAccountSchema = z.object({
  name: z.string().trim().min(1).max(120),
  relationshipStatus: z.enum(["lead", "client"]).default("lead"),
});

workspaceSaasRoutes.get("/:id/brands", requireWorkspaceRole("viewer"), async (req, res) => {
  try {
    const sb = dbOrThrow();
    const { data, error } = await sb.from("brands").select("*")
      .eq("workspace_id", req.params.id).order("name");
    if (error) throw error;
    res.json({ success: true, data: (data || []).map((brand: any) => ({
      id: brand.id,
      name: brand.name,
      relationship_status: brand.relationship_status || "lead",
      created_at: brand.created_at,
      updated_at: brand.updated_at,
    })) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

workspaceSaasRoutes.post("/:id/brands", requireWorkspaceRole("editor"), async (req, res) => {
  try {
    const parsed = brandAccountSchema.parse(req.body);
    const sb = dbOrThrow();
    const { data: existing } = await sb.from("brands").select("*")
      .eq("workspace_id", req.params.id).ilike("name", parsed.name).limit(1).maybeSingle();
    if (existing) {
      const { data, error } = await sb.from("brands")
        .update({ relationship_status: parsed.relationshipStatus, updated_at: new Date().toISOString() })
        .eq("workspace_id", req.params.id).eq("id", existing.id).select("*").single();
      if (error) throw error;
      res.json({ success: true, data });
      return;
    }
    const { data, error } = await sb.from("brands").insert({
      id: `brand_${crypto.randomBytes(10).toString("hex")}`,
      workspace_id: req.params.id,
      name: parsed.name,
      relationship_status: parsed.relationshipStatus,
    }).select("*").single();
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (error: any) {
    res.status(error instanceof z.ZodError ? 400 : 500).json({ success: false, error: error.message });
  }
});

workspaceSaasRoutes.patch("/:id/brands/:brandId", requireWorkspaceRole("editor"), async (req, res) => {
  try {
    const parsed = brandAccountSchema.partial().parse(req.body);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.name !== undefined) patch.name = parsed.name;
    if (parsed.relationshipStatus !== undefined) patch.relationship_status = parsed.relationshipStatus;
    const sb = dbOrThrow();
    const { data, error } = await sb.from("brands").update(patch)
      .eq("workspace_id", req.params.id).eq("id", req.params.brandId).select("*").single();
    if (error) throw error;
    if (parsed.name !== undefined) {
      await sb.from("crm_contacts").update({ brand_name: parsed.name, updated_at: new Date().toISOString() })
        .eq("workspace_id", req.params.id).eq("brand_id", req.params.brandId);
      await sb.from("design_file_meta").update({ brand: parsed.name, updated_at: new Date().toISOString() })
        .eq("workspace_id", req.params.id).eq("brand_id", req.params.brandId);
    }
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(error instanceof z.ZodError ? 400 : 500).json({ success: false, error: error.message });
  }
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
    let brandId = parsed.brandId || null;
    let brandName = parsed.brandName?.trim() || null;
    if (brandId) {
      const { data: brand } = await sb.from("brands").select("id, name")
        .eq("workspace_id", req.params.id).eq("id", brandId).maybeSingle();
      if (!brand) return res.status(400).json({ success: false, error: "Brand does not belong to this workspace" });
      brandName = brand.name;
    } else if (brandName) {
      const { data: existingBrand } = await sb.from("brands").select("id, name")
        .eq("workspace_id", req.params.id).ilike("name", brandName).limit(1).maybeSingle();
      if (existingBrand) {
        brandId = existingBrand.id;
        brandName = existingBrand.name;
      } else {
        const { data: createdBrand, error: brandError } = await sb.from("brands").insert({
          id: `brand_${crypto.randomBytes(10).toString("hex")}`,
          workspace_id: req.params.id,
          name: brandName,
          relationship_status: parsed.relationshipStatus || (parsed.status === "lead" ? "lead" : "client"),
        }).select("id, name").single();
        if (brandError) throw brandError;
        brandId = createdBrand.id;
        brandName = createdBrand.name;
      }
    }
    const { data, error } = await sb.from("crm_contacts").insert({
      workspace_id: req.params.id,
      brand_id: brandId,
      brand_name: brandName,
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
    if (parsed.brandId) {
      const { data: brand } = await sb.from("brands").select("id, name")
        .eq("workspace_id", req.params.id).eq("id", parsed.brandId).maybeSingle();
      if (!brand) return res.status(400).json({ success: false, error: "Brand does not belong to this workspace" });
      patch.brand_id = brand.id;
      patch.brand_name = brand.name;
    }
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
