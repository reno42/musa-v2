import { Router, type Request } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { getSupabase, getSupabaseAdmin } from "../services/supabase.js";
import { encryptWorkspaceSecret } from "../services/secrets.js";
import { assertSafeIntegrationEndpoint } from "../services/workspaceIntegrations.js";
import { requireWorkspaceRole } from "../services/tenancy.js";
import { claimLegacyWorkspacesForInitialUser, ensurePersonalWorkspace } from "../services/legacyOwnership.js";
import { deliverWorkspaceInvitation, invitationUrl, maskEmail } from "../services/workspaceInvitations.js";
import { buildContactDealStats, buildDealProgress, buildOfferSuggestions, computeBrandHealth } from "../services/crmInsights.js";
import {
  createBrand, deleteBrand, ensureBrandDesignSystemTemplate, findBrandByName,
  getBrand, getBrandByCrmId, listBrandsByWorkspace, updateBrand,
} from "../services/brands.js";
import {
  combineCompleteness, computeDsCompleteness, computePlantillasCompleteness,
  computeStrategyCompleteness, ensureBrandContainerFiles, generateStrategyFrames,
  mergeStrategy, strategyDigest, summarizeTokens, validateStrategy,
} from "../services/brandContainer.js";
import { emitBrandVault } from "../services/brainNotes.js";
import { updateTemplate } from "../services/templates.js";

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
    // display_name NEVER falls back to the email local-part: a fabricated
    // "renzo" then masquerades as the user's name in the table, the account
    // chip and member lists. If Supabase metadata has no name, the column
    // stays null and every UI falls back honestly (profile first_name, or the
    // email in the session menu).
    const profile = {
      id: user.id,
      email: user.email?.toLowerCase(),
      display_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
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

/** Columns added by supabase_migrations_v16.sql (+ onboarding_completed from the
 *  same family) and v30 (NDA gate + locked access plan). Selected separately
 *  from the base ones so an un-migrated database still returns a usable
 *  profile instead of failing the whole request on an unknown column. */
// prefs (v36) is a JSONB object of non-secret user preferences that must
// follow the account across devices (chat role config, default models).
// Secrets never go here — those live encrypted in user_api_keys.
const PROFILE_EXTRA_COLUMNS = "first_name, last_name, phone, website, brand_name, onboarding_completed, personalized_onboarding_completed, nda_accepted_at, access_plan, prefs";
const PROFILE_BASE_COLUMNS = "id, email, display_name, avatar_url";

/** True when the Supabase error indicates a missing column (migration not run).
 *  PostgREST says "Could not find the 'foo' column …" (code PGRST204) while
 *  raw Postgres says "column foo does not exist" — catch both so the UI gets
 *  a clear 409 PROFILE_MIGRATION_REQUIRED instead of a opaque 500. */
function isMissingColumnError(error: any): boolean {
  return Boolean(
    error && (
      /column .* does not exist/i.test(error.message || "") ||
      /Could not find the .* column/i.test(error.message || "") ||
      error.code === "PGRST204"
    )
  );
}

accountRoutes.get("/me", async (req, res) => {
  try {
    const sb = dbOrThrow();
    const full = await sb
      .from("user_profiles")
      .select(`${PROFILE_BASE_COLUMNS}, ${PROFILE_EXTRA_COLUMNS}`)
      .eq("id", req.auth!.userId)
      .maybeSingle();
    if (!full.error) return res.json({ success: true, data: full.data });

    // v16 not applied yet — serve what exists rather than erroring out.
    const { data } = await sb.from("user_profiles").select(PROFILE_BASE_COLUMNS).eq("id", req.auth!.userId).maybeSingle();
    res.json({ success: true, data, profileFieldsAvailable: false });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** Update the signed-in user's own profile. Only ever touches their own row —
 *  the id comes from the verified token, never from the request body. */
accountRoutes.patch("/me", async (req, res) => {
  try {
    const sb = dbOrThrow();
    // NDA fields (nda_accepted_at, access_plan) are deliberately NOT in this
    // list: the plan is assigned once on the NDA wall and locked afterwards.
    // They only change through POST /account/nda-acceptance.
    const allowed = ["display_name", "first_name", "last_name", "phone", "website", "brand_name"] as const;
    const patch: Record<string, string | null | boolean | Record<string, unknown>> = {};
    for (const field of allowed) {
      if (field in req.body) {
        const raw = req.body[field];
        patch[field] = typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 200) : null;
      }
    }
    // onboarding_completed is boolean, handled separately from the text fields.
    if ("onboarding_completed" in req.body) {
      patch.onboarding_completed = Boolean(req.body.onboarding_completed);
    }
    if ("personalized_onboarding_completed" in req.body) {
      patch.personalized_onboarding_completed = Boolean(req.body.personalized_onboarding_completed);
    }
    // prefs (v36) merges shallowly: each top-level key replaces the whole
    // previous value, so a caller saving chatRoles can't half-overwrite
    // another caller's nanoBananaModel. Rejected shapes fail loudly instead
    // of silently storing junk.
    if ("prefs" in req.body) {
      const incoming = req.body.prefs;
      if (incoming === null || typeof incoming !== "object" || Array.isArray(incoming)) {
        return res.status(400).json({ success: false, error: "prefs must be a plain object" });
      }
      const { data: current } = await sb
        .from("user_profiles")
        .select("prefs")
        .eq("id", req.auth!.userId)
        .maybeSingle();
      const base = current?.prefs && typeof current.prefs === "object" && !Array.isArray(current.prefs)
        ? current.prefs as Record<string, unknown>
        : {};
      const merged = { ...base, ...(incoming as Record<string, unknown>) };
      if (JSON.stringify(merged).length > 16_384) {
        return res.status(400).json({ success: false, error: "prefs too large (16KB limit)" });
      }
      patch.prefs = merged;
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ success: false, error: "No recognised profile fields to update" });
    }

    // Self-heal: bootstrap seeds user_profiles on login, but an outage during
    // that call leaves the row missing — and `.update()` then matches ZERO
    // rows while still reporting success (the "Guardado que no graba nada"
    // lie). Detect the no-op via .select() and seed the row like bootstrap
    // would, then apply the patch on top.
    patch.updated_at = new Date().toISOString();
    const migration409 = (missing: "prefs" | "personalized_onboarding_completed" | null) => {
      const needsV36 = missing === "prefs";
      const needsPersonalizedOnboarding = missing === "personalized_onboarding_completed";
      return res.status(409).json({
        success: false,
        error: "PROFILE_MIGRATION_REQUIRED",
        detail: needsPersonalizedOnboarding
          ? "Ejecuta supabase_migrations_v38_personalized_onboarding.sql en el SQL editor de Supabase para habilitar el onboarding personalizado."
          : needsV36
          ? "Ejecuta supabase_migrations_v36.sql (preferencias) — y v16 si aún no corrió — en el SQL editor de Supabase."
          : "Ejecuta supabase_migrations_v16.sql en el SQL editor de Supabase para habilitar estos campos.",
      });
    };
    const missingField = () => ("prefs" in patch ? "prefs" as const : ("personalized_onboarding_completed" in patch ? "personalized_onboarding_completed" as const : null));
    const { data: updated, error } = await sb.from("user_profiles").update(patch).eq("id", req.auth!.userId).select("id");
    if (error) {
      if (isMissingColumnError(error)) return migration409(missingField());
      throw error;
    }
    if (!updated || updated.length === 0) {
      const { data: userResult, error: userErr } = await sb.auth.admin.getUserById(req.auth!.userId);
      if (userErr || !userResult.user) throw userErr || new Error("User session not found");
      const user = userResult.user;
      const { error: seedErr } = await sb.from("user_profiles").insert({
        id: user.id,
        email: user.email?.toLowerCase() ?? null,
        display_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
        avatar_url: user.user_metadata?.avatar_url || null,
        ...patch,
      });
      if (seedErr) {
        if (isMissingColumnError(seedErr)) return migration409(missingField());
        throw seedErr;
      }
    }

    // ── Auto-sync brand ──
    // When the user saves a brand_name in their profile, upsert a matching
    // brand row in their personal workspace so it immediately appears in
    // CRM, Graph, and FileInfoPanel without a separate manual step.
    if (typeof patch.brand_name === "string" && patch.brand_name.trim()) {
      try {
        const { data: userResult } = await sb.auth.admin.getUserById(req.auth!.userId);
        if (userResult?.user) {
          const wsId = await ensurePersonalWorkspace(sb, userResult.user);
          if (wsId) {
            const trimmedName = patch.brand_name.trim();
            const { data: existing } = await sb.from("brands").select("id")
              .eq("workspace_id", wsId).ilike("name", trimmedName).limit(1).maybeSingle();
            if (existing) {
              await sb.from("brands").update({
                name: trimmedName, updated_at: new Date().toISOString(),
              }).eq("workspace_id", wsId).eq("id", existing.id);
            } else {
              const { data: createdBrand } = await sb.from("brands").insert({
                id: `brand_${crypto.randomBytes(10).toString("hex")}`,
                workspace_id: wsId,
                name: trimmedName,
                relationship_status: "client",
              }).select("id").single();
              // One brand = one Design System: born here too.
              if (createdBrand?.id) {
                try {
                  await createBrand({ workspaceId: wsId, name: trimmedName, crmBrandId: createdBrand.id });
                } catch { /* best-effort — profile save must not fail */ }
              }
            }
          }
        }
      } catch { /* brand sync is best-effort — profile save must not fail */ }
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** Version of the Alfa Access Agreement the API stamps on every acceptance.
 *  Must match NDA_VERSION in src/lib/ndaContent.ts — bump both on a re-accept
 *  cycle (v30 schema keeps one row per user via upsert). */
const NDA_VERSION = "1.0";

const ndaPlanSchema = z.enum(["friends_family", "corporate"]);

/** Accept the Alfa Access Agreement (NDA wall): records the consent row and
 *  unlocks the app for this account. Idempotent — once nda_accepted_at is set
 *  a second call is a no-op that never rewrites the original acceptance. */
accountRoutes.post("/nda-acceptance", async (req, res) => {
  try {
    const plan = ndaPlanSchema.parse(req.body?.plan);
    const sb = dbOrThrow();
    const { data: userResult, error: userError } = await sb.auth.admin.getUserById(req.auth!.userId);
    if (userError || !userResult.user) return res.status(401).json({ success: false, error: "User session not found" });
    const user = userResult.user;

    const { data: profile, error: profileError } = await sb.from("user_profiles")
      .select("nda_accepted_at")
      .eq("id", req.auth!.userId)
      .maybeSingle();
    if (profileError && isMissingColumnError(profileError)) {
      return res.status(409).json({
        success: false,
        error: "NDA_MIGRATION_REQUIRED",
        detail: "Ejecuta supabase_migrations_v30.sql en el SQL editor de Supabase para habilitar el acuerdo de acceso.",
      });
    }
    if (profileError) throw profileError;
    if (profile?.nda_accepted_at) {
      return res.json({ success: true, data: { alreadyAccepted: true } });
    }

    // Real connection data beats the client's guess: Netlify exposes the
    // client IP in x-nf-client-connection-ip, proxies chain x-forwarded-for.
    const forwardedFor = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    const ip = (req.headers["x-nf-client-connection-ip"] as string) || forwardedFor || null;
    const userAgent = (req.headers["user-agent"] as string) || null;

    const { error: acceptanceError } = await sb.from("nda_acceptances").upsert({
      user_id: req.auth!.userId,
      // Legal record: only a real metadata name — never the email local-part.
      full_name: user.user_metadata?.full_name || user.user_metadata?.name || "Sin nombre",
      email: user.email?.toLowerCase() || null,
      plan,
      ip_address: ip,
      user_agent: userAgent,
      version: NDA_VERSION,
    }, { onConflict: "user_id" });
    if (acceptanceError) {
      if (isMissingColumnError(acceptanceError)) {
        return res.status(409).json({
          success: false,
          error: "NDA_MIGRATION_REQUIRED",
          detail: "Ejecuta supabase_migrations_v30.sql en el SQL editor de Supabase para habilitar el acuerdo de acceso.",
        });
      }
      throw acceptanceError;
    }

    // Upsert (not update): a signup that accepts the wall before
    // /account/bootstrap lands would otherwise update zero rows and the
    // wall would reappear on the next reload.
    const { error: updateError } = await sb.from("user_profiles")
      .upsert({ id: req.auth!.userId, nda_accepted_at: new Date().toISOString(), access_plan: plan });
    if (updateError) {
      if (isMissingColumnError(updateError)) {
        return res.status(409).json({
          success: false,
          error: "NDA_MIGRATION_REQUIRED",
          detail: "Ejecuta supabase_migrations_v30.sql en el SQL editor de Supabase para habilitar el acuerdo de acceso.",
        });
      }
      throw updateError;
    }

    res.json({ success: true, data: { plan, acceptedAt: new Date().toISOString() } });
  } catch (error: any) {
    const status = error instanceof z.ZodError ? 400 : 500;
    res.status(status).json({ success: false, error: error.message });
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
  accountHealth: z.enum(["active", "at_risk", "churned"]).default("active"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  crmNotes: z.string().max(10000).optional(),
  lastContactedAt: z.string().datetime().nullable().optional(),
  nextFollowUpAt: z.string().datetime().nullable().optional(),
  // v45: manual health override — when set it wins over the computed signal;
  // null clears it so the automatic rule governs again.
  accountHealthOverride: z.enum(["active", "at_risk", "churned"]).nullable().optional(),
});

workspaceSaasRoutes.get("/:id/brands", requireWorkspaceRole("viewer"), async (req, res) => {
  try {
    const sb = dbOrThrow();
    const { data, error } = await sb.from("brands").select("*")
      .eq("workspace_id", req.params.id).order("name");
    if (error) throw error;
    // One Design System per brand (v35): resolve each brand's DS via the
    // crm_brand_id link first, falling back to name matching for legacy rows
    // the backfill hasn't linked yet. has_design_system drives the badge and
    // the one-click "Crear Design System" affordance in CRM/editor/graph.
    let guidelines: Awaited<ReturnType<typeof listBrandsByWorkspace>> = [];
    try { guidelines = await listBrandsByWorkspace(req.params.id); }
    catch { /* brand_guidelines unavailable — every brand reports without DS */ }
    const byCrmId = new Map(guidelines.filter(g => g.crmBrandId).map(g => [g.crmBrandId as string, g]));
    const byDsName = new Map(guidelines.map(g => [g.name.trim().toLowerCase(), g]));
    // Containers + completeness: index the brand container files under BOTH
    // id spaces. createContainerFile tags them data.brandId =
    // brand_guidelines.id, while this listing walks the CRM brands table —
    // two different sequences. Looking containers up by CRM id alone is what
    // kept the Plantillas slots on "Generando…" forever with a console clean:
    // the files existed, the lookup just used the wrong key. Kind resolution:
    // v47 column first, data mirror second, is_brand_manual scan as last
    // resort for workspaces whose rows never got the column backfilled.
    let containersByBrand = new Map<string, any[]>();
    let plantillasCounts = new Map<string, number>();
    const loadContainers = async () => {
      const byBrand = new Map<string, any[]>();
      const counts = new Map<string, number>();
      let rows: any[] = [];
      try {
        const col = await sb.from("templates").select(
          "id, brand_container_kind, kindInData:data->>brandContainerKind, brandId:data->>brandId",
        )
          .eq("workspace_id", req.params.id)
          .in("brand_container_kind", ["ds", "plantillas", "communication"])
          .is("deleted_at", null);
        rows = (col.data || []) as any[];
      } catch { /* pre-v47 column: the is_brand_manual scan below covers it */ }
      if (!rows.length) {
        try {
          const scan = await sb.from("templates")
            .select("id, kindInData:data->>brandContainerKind, brandId:data->>brandId")
            .eq("workspace_id", req.params.id)
            .eq("data->>isBrandManual", "true")
            .is("deleted_at", null);
          rows = ((scan.data || []) as any[]).filter((row) => row.kindInData);
        } catch { /* degrade: container slots report empty */ }
      }
      for (const row of rows) {
        const kind = row.brand_container_kind || row.kindInData;
        const brandId = row.brandId;
        if (!kind || !brandId) continue;
        const list = byBrand.get(brandId) || [];
        list.push({ ...row, brand_container_kind: kind });
        byBrand.set(brandId, list);
      }
      // Alias guideline-space rows under their CRM brand id so this listing
      // (and any other CRM-keyed consumer) finds them on the first get().
      for (const g of guidelines) {
        if (!g.crmBrandId) continue;
        const list = byBrand.get(g.id);
        if (list) byBrand.set(g.crmBrandId, list);
      }
      const plantillasIds = rows
        .map((row) => ({ id: row.id, kind: row.brand_container_kind || row.kindInData }))
        .filter((row) => row.kind === "plantillas")
        .map((row) => row.id);
      if (plantillasIds.length) {
        try {
          const { data: plantillasRows } = await sb.from("templates")
            .select("id, frames:data->frames")
            .in("id", plantillasIds)
            .is("deleted_at", null);
          for (const row of plantillasRows || []) {
            counts.set((row as any).id, Array.isArray((row as any).frames) ? (row as any).frames.length : 0);
          }
        } catch { /* counts stay 0 */ }
      }
      return { byBrand, counts };
    };
    const loaded = await loadContainers().catch(() => null);
    if (loaded) { containersByBrand = loaded.byBrand; plantillasCounts = loaded.counts; }
    // Lazy self-heal: brands born before the auto-DS machinery (or whose
    // container creation failed once) reported "Sin archivo" forever — nothing
    // ever repaired them server-side. On read, link the brand_guidelines row
    // or create it with the empty skeleton, then make sure all three container
    // files exist. Every step is idempotent and best-effort: a failing brand
    // only skips its own heal, the listing itself never fails. Healthy brands
    // short-circuit, so this costs nothing after the first repaired load.
    const healedDs = new Map<string, (typeof guidelines)[number]>();
    if (data?.length) {
      for (const brand of data) {
        const nameKey = String(brand.name).trim().toLowerCase();
        if ((byCrmId.get(brand.id) || byDsName.get(nameKey))?.designSystemTemplateId) {
          continue; // healthy — nothing to heal
        }
        try {
          let row: (typeof guidelines)[number] | null =
            byCrmId.get(brand.id)
            || byDsName.get(nameKey)
            || await getBrandByCrmId(req.params.id, brand.id)
            || await findBrandByName(req.params.id, brand.name);
          if (!row) {
            // Legacy CRM brand with no style row at all: born as the empty
            // skeleton — the human (or their IAs via MCP) fill it in after.
            row = await createBrand({
              workspaceId: req.params.id, name: brand.name, crmBrandId: brand.id,
            });
          } else if (!row.designSystemTemplateId) {
            await ensureBrandDesignSystemTemplate(row.id);
            row = (await getBrand(row.id)) || row;
          }
          if (row?.designSystemTemplateId) {
            await ensureBrandContainerFiles(row).catch(() => null);
            healedDs.set(brand.id, row);
          }
        } catch (healErr) {
          console.warn("[saas] Brand container self-heal failed:", brand.name, (healErr as Error).message);
        }
      }
    }
    // Containers were indexed before healing: re-index once so files created
    // above already show up in this same response.
    if (healedDs.size) {
      const reloaded = await loadContainers().catch(() => null);
      if (reloaded) { containersByBrand = reloaded.byBrand; plantillasCounts = reloaded.counts; }
    }
    res.json({ success: true, data: (data || []).map((brand: any) => {
      const ds = healedDs.get(brand.id) || byCrmId.get(brand.id) || byDsName.get(String(brand.name).trim().toLowerCase());
      const containers = containersByBrand.get(brand.id)
        || (ds ? containersByBrand.get(ds.id) || [] : []);
      const plantillas = containers.find(c => c.brand_container_kind === "plantillas");
      const communication = containers.find(c => c.brand_container_kind === "communication");
      const plantillasCount = plantillas ? (plantillasCounts.get(plantillas.id) || 0) : 0;
      let completeness: { score: number; total: number } | null = null;
      if (ds) {
        const combined = combineCompleteness([
          computeDsCompleteness(ds),
          computeStrategyCompleteness(ds.strategyJson),
          computePlantillasCompleteness(plantillasCount),
        ]);
        completeness = { score: combined.score, total: combined.total };
      }
      return {
        id: brand.id,
        name: brand.name,
        relationship_status: brand.relationship_status || "lead",
        account_health: brand.account_health || "active",
        crm_priority: brand.crm_priority || "medium",
        crm_notes: brand.crm_notes || "",
        last_contacted_at: brand.last_contacted_at || null,
        next_follow_up_at: brand.next_follow_up_at || null,
        design_system_template_id: ds?.designSystemTemplateId || null,
        brand_guideline_id: ds?.id || null,
        has_design_system: Boolean(ds?.designSystemTemplateId),
        plantillas_template_id: plantillas?.id || null,
        plantillas_frame_count: plantillasCount,
        communication_template_id: communication?.id || null,
        has_strategy: Boolean(ds?.strategyJson && ds.strategyJson.trim()),
        completeness,
        created_at: brand.created_at,
        updated_at: brand.updated_at,
      };
    }) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /brands/context — compact per-brand bundle for the in-app chat: one
// fetch per session hands the model every brand's style tokens, strategy
// digest and plantillas index (~500 tokens per brand) with zero tool
// round-trips. "Ve usa el estilo de Futuraria" resuelve en el primer turno.
workspaceSaasRoutes.get("/:id/brands/context", requireWorkspaceRole("viewer"), async (req, res) => {
  try {
    const sb = dbOrThrow();
    const { data, error } = await sb.from("brands").select("*")
      .eq("workspace_id", req.params.id).order("name");
    if (error) throw error;
    let guidelines: Awaited<ReturnType<typeof listBrandsByWorkspace>> = [];
    try { guidelines = await listBrandsByWorkspace(req.params.id); }
    catch { /* degrade: tokens/strategy absent, ids still resolve below */ }
    const byCrmId = new Map(guidelines.filter(g => g.crmBrandId).map(g => [g.crmBrandId as string, g]));
    const byDsName = new Map(guidelines.map(g => [g.name.trim().toLowerCase(), g]));
    // Plantillas frame names: the model proposes create_from_plantilla with
    // real frame names instead of guessing what exists.
    const plantillasByBrand = new Map<string, { id: string; frames: string[] }>();
    try {
      let rows: any[] = [];
      try {
        const col = await sb.from("templates")
          .select("id, frames:data->frames, brand_container_kind, kindInData:data->>brandContainerKind, brandId:data->>brandId")
          .eq("workspace_id", req.params.id)
          .eq("brand_container_kind", "plantillas")
          .is("deleted_at", null);
        rows = (col.data || []) as any[];
      } catch { /* pre-v47 column: the is_brand_manual scan below covers it */ }
      if (!rows.length) {
        try {
          const scan = await sb.from("templates")
            .select("id, frames:data->frames, kindInData:data->>brandContainerKind, brandId:data->>brandId")
            .eq("workspace_id", req.params.id)
            .eq("data->>isBrandManual", "true")
            .is("deleted_at", null);
          rows = ((scan.data || []) as any[]).filter((row) => row.kindInData === "plantillas");
        } catch { /* plantillas index absent */ }
      }
      for (const row of rows) {
        const brandId = row.brandId;
        if (!brandId) continue;
        const frames = Array.isArray(row.frames) ? row.frames : [];
        plantillasByBrand.set(brandId, {
          id: row.id,
          frames: frames.map((f: any) => String(f?.name || "")).filter(Boolean).slice(0, 12),
        });
      }
      // Same dual id-space as GET /brands: data.brandId is the
      // brand_guidelines id, the brands table walks CRM ids.
      for (const g of guidelines) {
        if (!g.crmBrandId) continue;
        const p = plantillasByBrand.get(g.id);
        if (p) plantillasByBrand.set(g.crmBrandId, p);
      }
    } catch { /* pre-v47 schema: plantillas index absent */ }
    const preview = (value: string | null | undefined, max: number) => (value || "").trim().slice(0, max);
    res.json({ success: true, data: (data || []).map((brand: any) => {
      const ds = byCrmId.get(brand.id) || byDsName.get(String(brand.name).trim().toLowerCase());
      const tokens = ds ? summarizeTokens(ds.tokensJson) : null;
      const plantillas = plantillasByBrand.get(brand.id)
        || (ds ? plantillasByBrand.get(ds.id) : undefined);
      return {
        brandId: brand.id,
        name: brand.name,
        relationship: brand.relationship_status || "lead",
        workspaceId: req.params.id,
        hasDesignSystem: Boolean(ds?.designSystemTemplateId),
        dsTemplateId: ds?.designSystemTemplateId || null,
        plantillasTemplateId: plantillas?.id || null,
        colors: (tokens?.colors || []).slice(0, 12),
        fonts: (tokens?.fonts || []).slice(0, 6),
        strategy: ds ? strategyDigest(ds.strategyJson) : "Estrategia aún vacía",
        plantillas: plantillas?.frames || [],
        sharedCssPreview: preview(ds?.sharedCss, 800),
        designMdPreview: preview(ds?.designMd, 400),
      };
    }) });
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
        .update({
          relationship_status: parsed.relationshipStatus,
          account_health: parsed.accountHealth,
          crm_priority: parsed.priority,
          crm_notes: parsed.crmNotes || null,
          next_follow_up_at: parsed.nextFollowUpAt || null,
          updated_at: new Date().toISOString(),
        })
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
      account_health: parsed.accountHealth,
      crm_priority: parsed.priority,
      crm_notes: parsed.crmNotes || null,
      last_contacted_at: parsed.lastContactedAt || null,
      next_follow_up_at: parsed.nextFollowUpAt || null,
    }).select("*").single();
    if (error) throw error;

    // Auto-create the Design System file + brand_guidelines row for this brand.
    // The "one brand = one Design System file" rule (v35) is not optional: the
    // old skipDesignSystem opt-out (a localStorage flag per browser) created
    // brands that every AI later found empty, so every brand now gets its file.
    try {
      await createBrand({
        workspaceId: req.params.id,
        name: parsed.name,
        crmBrandId: data.id,
      });
    } catch (e) {
      // Best-effort: a name conflict means a brand_guidelines row already
      // exists for this name, which is fine. Other errors don't fail the
      // brand creation itself.
      console.warn("[saas] Auto-DS creation for brand failed:", (e as Error).message);
    }

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
    if (parsed.accountHealth !== undefined) patch.account_health = parsed.accountHealth;
    if (parsed.priority !== undefined) patch.crm_priority = parsed.priority;
    if (parsed.crmNotes !== undefined) patch.crm_notes = parsed.crmNotes || null;
    if (parsed.lastContactedAt !== undefined) patch.last_contacted_at = parsed.lastContactedAt;
    if (parsed.nextFollowUpAt !== undefined) patch.next_follow_up_at = parsed.nextFollowUpAt;
    if (parsed.accountHealthOverride !== undefined) {
      // v45: the manual override wins over the computed health. The audit
      // columns record the last writer of the pin.
      patch.account_health_override = parsed.accountHealthOverride;
      patch.health_changed_at = new Date().toISOString();
      patch.health_changed_by = req.auth!.userId;
    }
    const sb = dbOrThrow();
    const { data, error } = await sb.from("brands").update(patch)
      .eq("workspace_id", req.params.id).eq("id", req.params.brandId).select("*").single();
    if (error) throw error;
    if (parsed.name !== undefined) {
      await sb.from("crm_contacts").update({ brand_name: parsed.name, updated_at: new Date().toISOString() })
        .eq("workspace_id", req.params.id).eq("brand_id", req.params.brandId);
      await sb.from("design_file_meta").update({ brand: parsed.name, updated_at: new Date().toISOString() })
        .eq("workspace_id", req.params.id).eq("brand_id", req.params.brandId);
      // Keep the brand's Design System row in sync with the rename. The
      // crm_brand_id link (v35) doesn't depend on the name, but AI lookups
      // by name read better when they still match.
      try {
        const linked = await getBrandByCrmId(req.params.id, req.params.brandId).catch(() => null);
        if (linked && linked.name !== parsed.name) {
          await updateBrand(linked.id, { name: parsed.name });
        }
      } catch (dsErr) {
        console.warn("[saas] Failed to rename linked Design System:", (dsErr as Error).message);
      }
    }
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(error instanceof z.ZodError ? 400 : 500).json({ success: false, error: error.message });
  }
});

workspaceSaasRoutes.delete("/:id/brands/:brandId", requireWorkspaceRole("editor"), async (req, res) => {
  try {
    const sb = dbOrThrow();
    const { data: brandRow } = await sb.from("brands").select("id, name")
      .eq("workspace_id", req.params.id).eq("id", req.params.brandId).maybeSingle();
    // Null out brand references on contacts and design files (don't delete them).
    await sb.from("crm_contacts").update({
      brand_id: null, brand_name: null, updated_at: new Date().toISOString(),
    }).eq("workspace_id", req.params.id).eq("brand_id", req.params.brandId);
    await sb.from("design_file_meta").update({
      brand_id: null, brand: null, updated_at: new Date().toISOString(),
    }).eq("workspace_id", req.params.id).eq("brand_id", req.params.brandId);
    const { error } = await sb.from("brands").delete()
      .eq("workspace_id", req.params.id).eq("id", req.params.brandId);
    if (error) throw error;
    // One brand = one Design System: send the linked DS row + file to the
    // trash too, so no orphan guideline lingers claiming the brand's name.
    try {
      const linked = await getBrandByCrmId(req.params.id, req.params.brandId).catch(() => null)
        ?? (brandRow ? await findBrandByName(req.params.id, brandRow.name) : null);
      if (linked) await deleteBrand(linked.id, { cascadeDs: true });
    } catch (dsErr) {
      console.warn("[saas] Failed to cascade brand Design System:", (dsErr as Error).message);
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

workspaceSaasRoutes.post("/:id/brands/:brandId/design-system", requireWorkspaceRole("editor"), async (req, res) => {
  try {
    const sb = dbOrThrow();
    // Fetch the CRM brand row to get its name.
    const { data: brand, error } = await sb.from("brands")
      .select("*")
      .eq("workspace_id", req.params.id)
      .eq("id", req.params.brandId)
      .maybeSingle();
    if (error) throw error;
    if (!brand) {
      res.status(404).json({ success: false, error: "Marca no encontrada" });
      return;
    }

    // If a Design System row already exists, return it. Resolve by the CRM
    // link (v35) first, falling back to name matching for legacy rows.
    const existing = (await getBrandByCrmId(req.params.id, req.params.brandId).catch(() => null))
      || await findBrandByName(req.params.id, brand.name);
    if (existing?.designSystemTemplateId) {
      // Backfill (v47): legacy brands got their DS before the container law —
      // make sure Plantillas + Comunicación exist too before reporting done.
      await ensureBrandContainerFiles(existing).catch(() => null);
      res.json({
        success: true,
        message: "Ya existe un Design System para esta marca",
        templateId: existing.designSystemTemplateId,
      });
      return;
    }
    if (existing) {
      // The brand_guidelines row exists but its DS file doesn't (template
      // creation once failed, or the row predates v20). Create and link the
      // missing file instead of failing on the name conflict.
      const templateId = await ensureBrandDesignSystemTemplate(existing.id);
      res.status(201).json({ success: true, data: { ...existing, designSystemTemplateId: templateId } });
      return;
    }

    // Create the brand_guidelines row + Design System template.
    const ds = await createBrand({
      workspaceId: req.params.id,
      name: brand.name,
      crmBrandId: brand.id,
    });

    res.status(201).json({ success: true, data: ds });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Brand Strategy Canvas (BRAND_STRATEGY_V1) ───────────────────────────
// strategyJson lives on the brand_guidelines row; the Comunicación container
// file is its rendered form (V-frames, regenerated on every save).

function resolveGuidelineId(req: Request) {
  return getBrandByCrmId(req.params.id, req.params.brandId).catch(() => null);
}

workspaceSaasRoutes.get("/:id/brands/:brandId/strategy", requireWorkspaceRole("viewer"), async (req, res) => {
  try {
    const guideline = await resolveGuidelineId(req);
    if (!guideline) {
      res.status(404).json({ success: false, error: "Esta marca aún no tiene contenedor de comunicación (crea primero su Design System)" });
      return;
    }
    const strategy = guideline.strategyJson ? JSON.parse(guideline.strategyJson) : null;
    res.json({
      success: true,
      data: {
        strategy,
        completeness: computeStrategyCompleteness(guideline.strategyJson),
        digest: strategyDigest(guideline.strategyJson),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

workspaceSaasRoutes.put("/:id/brands/:brandId/strategy", requireWorkspaceRole("editor"), async (req, res) => {
  try {
    const validation = validateStrategy(req.body?.strategy);
    if (!validation.ok) {
      res.status(400).json({ success: false, error: "Estrategia inválida", issues: validation.issues });
      return;
    }
    const guideline = await resolveGuidelineId(req);
    if (!guideline) {
      res.status(404).json({ success: false, error: "Esta marca aún no tiene Design System — créalo primero" });
      return;
    }
    const merged = mergeStrategy(guideline.strategyJson, validation.value);
    const strategyJson = JSON.stringify(merged);
    const saved = await updateBrand(guideline.id, { strategyJson });
    if (!saved) {
      res.status(404).json({ success: false, error: "Marca no encontrada" });
      return;
    }
    // Re-render the V-frames so the Comunicación file always mirrors the
    // saved canvas (frames are the render, strategyJson the source of truth).
    const info = await ensureBrandContainerFiles(saved).catch(() => null);
    if (info?.communicationTemplateId) {
      await updateTemplate(info.communicationTemplateId, {
        frames: generateStrategyFrames(saved.name, strategyJson),
      });
    }
    // The whole brand vault regenerates (marca, crm, ds, plantillas, estrategia,
    // copywriting + personas) — idempotent, human blocks preserved.
    if (saved.crmBrandId) await emitBrandVault(saved.workspaceId, saved.crmBrandId).catch(() => { /* best-effort */ });
    res.json({
      success: true,
      data: {
        strategy: merged,
        completeness: computeStrategyCompleteness(strategyJson),
        digest: strategyDigest(strategyJson),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
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
        // Same rule as POST /:id/brands: a brand born anywhere (CRM contact
        // included) gets its Design System file immediately.
        try {
          await createBrand({ workspaceId: req.params.id, name: createdBrand.name, crmBrandId: createdBrand.id });
        } catch (dsErr) {
          console.warn("[saas] Auto-DS creation for contact brand failed:", (dsErr as Error).message);
        }
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

// CRM commercial interaction timeline (v45, DIATTA-inspired): every touchpoint
// with a brand/contact. The existing deals/contacts routes stay untouched.

const crmInteractionTypeSchema = z.enum([
  "primer_contacto",
  "reunion",
  "llamada",
  "email",
  "whatsapp",
  "propuesta_enviada",
  "revision",
  "aprobacion",
  "publicacion",
  "pago",
  "follow_up",
  "objecion",
  "otro",
]);

const crmInteractionCreateSchema = z.object({
  brandId: z.string().min(1),
  contactId: z.string().uuid().nullable().optional(),
  interactionType: crmInteractionTypeSchema,
  notes: z.string().max(10000).optional(),
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  interactionDate: z.string().datetime().nullable().optional(),
  // v48: touchpoint atado a UNA negociación — el timeline del deal filtra por
  // aquí y cada entrada conserva su atribución por persona (contact_id).
  dealId: z.string().uuid().nullable().optional(),
});

/** v48: cierto cuando esta base todavía no corrió supabase_migrations_v48.sql
 *  (crm_interactions.deal_id). PostgREST rechaza el write contra su schema
 *  cache con PGRST204; la lectura directa llega a Postgres y responde 42703. */
function isMissingDealIdColumn(error: unknown): boolean {
  const err = error as { code?: string; message?: string } | null;
  const code = String(err?.code ?? "");
  if (code === "PGRST204" || code === "42703") return /deal_id/i.test(err?.message ?? "");
  return /deal_id/i.test(err?.message ?? "") && (/does not exist|schema cache/i.test(err?.message ?? ""));
}

workspaceSaasRoutes.get("/:id/interactions", requireWorkspaceRole("viewer"), async (req, res) => {
  try {
    const sb = dbOrThrow();
    let query = sb.from("crm_interactions").select("*")
      .eq("workspace_id", req.params.id)
      .order("interaction_date", { ascending: false })
      .limit(Math.min(Number(req.query.limit) || 200, 500));
    if (req.query.brandId) query = query.eq("brand_id", String(req.query.brandId));
    if (req.query.contactId) query = query.eq("contact_id", String(req.query.contactId));
    const dealId = req.query.dealId ? String(req.query.dealId) : "";
    if (dealId) query = query.eq("deal_id", dealId);
    let data: any[] | null = null;
    const { data: rows, error } = await query;
    if (error && dealId && isMissingDealIdColumn(error)) {
      // v48 pendiente: sin deal_id el timeline del deal aproxima con la marca.
      console.warn("[crm] crm_interactions.deal_id missing — run supabase_migrations_v48.sql. Falling back to brand filter.");
      let fallback = sb.from("crm_interactions").select("*")
        .eq("workspace_id", req.params.id)
        .order("interaction_date", { ascending: false })
        .limit(Math.min(Number(req.query.limit) || 200, 500));
      if (req.query.brandId) fallback = fallback.eq("brand_id", String(req.query.brandId));
      if (req.query.contactId) fallback = fallback.eq("contact_id", String(req.query.contactId));
      const retry = await fallback;
      if (retry.error) throw retry.error;
      data = retry.data;
    } else if (error) throw error;
    else data = rows;
    res.json({ success: true, data: data || [] });
  } catch (error: any) {
    sendCrmError(res, error);
  }
});

workspaceSaasRoutes.post("/:id/interactions", requireWorkspaceRole("editor"), async (req, res) => {
  try {
    const parsed = crmInteractionCreateSchema.parse(req.body);
    const sb = dbOrThrow();
    const workspaceId = req.params.id;
    const { data: brand } = await sb.from("brands").select("id")
      .eq("workspace_id", workspaceId).eq("id", parsed.brandId).maybeSingle();
    if (!brand) return res.status(400).json({ success: false, error: "Brand does not belong to this workspace" });
    if (parsed.contactId) {
      const { data: contact } = await sb.from("crm_contacts").select("id")
        .eq("workspace_id", workspaceId).eq("brand_id", parsed.brandId)
        .eq("id", parsed.contactId).maybeSingle();
      if (!contact) return res.status(400).json({ success: false, error: "Contact does not belong to this brand" });
    }
    if (parsed.dealId) {
      const { data: deal } = await sb.from("crm_deals").select("id")
        .eq("workspace_id", workspaceId).eq("brand_id", parsed.brandId)
        .eq("id", parsed.dealId).maybeSingle();
      if (!deal) return res.status(400).json({ success: false, error: "Deal does not belong to this brand" });
    }
    const insertRow: Record<string, unknown> = {
      workspace_id: workspaceId,
      brand_id: parsed.brandId,
      contact_id: parsed.contactId || null,
      interaction_type: parsed.interactionType,
      notes: parsed.notes || null,
      data: parsed.data ?? null,
      interaction_date: parsed.interactionDate || new Date().toISOString(),
      created_by: req.auth!.userId,
      deal_id: parsed.dealId || null,
    };
    let insertResult = await sb.from("crm_interactions").insert(insertRow).select("*").single();
    if (insertResult.error && parsed.dealId && isMissingDealIdColumn(insertResult.error)) {
      // v48 pendiente: el touchpoint se registra igual, a nivel marca/persona.
      console.warn("[crm] crm_interactions.deal_id missing — run supabase_migrations_v48.sql. Logging without deal link.");
      delete insertRow.deal_id;
      insertResult = await sb.from("crm_interactions").insert(insertRow).select("*").single();
    }
    const { data, error } = insertResult;
    if (error) throw error;
    // Logging a touchpoint counts as contact with the brand, same as DIATTA
    // activation: it feeds the computed at_risk signal.
    await sb.from("brands").update({
      last_contacted_at: data.interaction_date,
      updated_at: new Date().toISOString(),
    }).eq("workspace_id", workspaceId).eq("id", parsed.brandId);
    res.status(201).json({ success: true, data });
  } catch (error: any) {
    sendCrmError(res, error);
  }
});

const crmDealStageSchema = z.enum([
  "discovery",
  "proposal",
  "negotiation",
  "approved",
  "in_production",
  "review",
  "ready",
  "delivered",
  "lost",
]);

const crmDeliverableInputSchema = z.object({
  assetType: z.string().trim().min(1).max(80).regex(/^[a-z0-9_]+$/),
  label: z.string().trim().min(1).max(160),
  quantity: z.coerce.number().int().min(1).max(10000),
  notes: z.string().max(5000).optional(),
});

const crmDealCreateSchema = z.object({
  brandId: z.string().min(1),
  campaignId: z.string().nullable().optional(),
  campaignName: z.string().trim().max(160).optional(),
  primaryContactId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(180),
  description: z.string().max(10000).optional(),
  stage: crmDealStageSchema.default("discovery"),
  value: z.coerce.number().min(0).max(9999999999).nullable().optional(),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).default("USD"),
  probability: z.coerce.number().int().min(0).max(100).default(10),
  expectedCloseDate: z.string().date().nullable().optional(),
  dueDate: z.string().date().nullable().optional(),
  notes: z.string().max(10000).optional(),
  deliverables: z.array(crmDeliverableInputSchema).min(1).max(100),
});

const crmDealPatchSchema = z.object({
  campaignId: z.string().nullable().optional(),
  primaryContactId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(180).optional(),
  description: z.string().max(10000).nullable().optional(),
  stage: crmDealStageSchema.optional(),
  value: z.coerce.number().min(0).max(9999999999).nullable().optional(),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).optional(),
  probability: z.coerce.number().int().min(0).max(100).optional(),
  expectedCloseDate: z.string().date().nullable().optional(),
  dueDate: z.string().date().nullable().optional(),
  notes: z.string().max(10000).nullable().optional(),
  // v45: outcome bookkeeping — invoiced amount and lost-deal reason.
  finalValue: z.coerce.number().min(0).max(9999999999).nullable().optional(),
  lostReason: z.string().max(2000).nullable().optional(),
  // v48: próximo paso declarado por el humano — el sistema nunca lo inventa,
  // solo lo muestra en la tarjeta y lo vence en rojo cuando pasa la fecha.
  nextStepNote: z.string().max(500).nullable().optional(),
  nextStepDate: z.string().date().nullable().optional(),
});

function isMissingCrmSchema(error: any) {
  return error?.code === "42P01" || error?.code === "42703" || /crm_deals|account_health|crm_priority/i.test(error?.message || "");
}

function sendCrmError(res: any, error: any) {
  if (isMissingCrmSchema(error)) {
    const needsV48 = /deal_id|next_step/i.test(error?.message || "");
    const needsV45 = /crm_interactions|final_value|lost_reason|account_health_override/i.test(error?.message || "");
    res.status(503).json({
      success: false,
      error: needsV48
        ? "El CRM necesita la migración supabase_migrations_v48.sql."
        : needsV45
        ? "El CRM necesita la migración supabase_migrations_v45.sql."
        : "El CRM necesita la migración supabase_migrations_v14.sql.",
    });
    return;
  }
  res.status(error instanceof z.ZodError ? 400 : 500).json({ success: false, error: error.message });
}

async function resolveDealCampaign(
  sb: ReturnType<typeof dbOrThrow>,
  workspaceId: string,
  brandId: string,
  campaignId?: string | null,
  campaignName?: string,
) {
  if (campaignId) {
    const { data } = await sb.from("campaigns").select("id, name")
      .eq("workspace_id", workspaceId).eq("brand_id", brandId).eq("id", campaignId).maybeSingle();
    if (!data) throw new Error("Campaign does not belong to this brand and workspace");
    return data;
  }
  const normalizedName = campaignName?.trim();
  if (!normalizedName) return null;
  const { data: existing } = await sb.from("campaigns").select("id, name")
    .eq("workspace_id", workspaceId).eq("brand_id", brandId).ilike("name", normalizedName).maybeSingle();
  if (existing) return existing;
  const { data, error } = await sb.from("campaigns").insert({
    workspace_id: workspaceId,
    brand_id: brandId,
    name: normalizedName,
  }).select("id, name").single();
  if (error) throw error;
  return data;
}

workspaceSaasRoutes.get("/:id/crm", requireWorkspaceRole("viewer"), async (req, res) => {
  try {
    const sb = dbOrThrow();
    const workspaceId = req.params.id;
    // v54.2: interactions y brand_guidelines antes viajaban en SERIE después
    // del Promise.all — dos round trips extra en cada /crm. Ahora arrancan
    // junto a las otras siete queries (9 en paralelo: latencia = la más lenta).
    const interactionsPromise = (async () => {
      try {
        const { data, error } = await sb.from("crm_interactions").select("*")
          .eq("workspace_id", workspaceId)
          .order("interaction_date", { ascending: false })
          .limit(500);
        if (error) throw error;
        return data || [];
      } catch { return [] as any[]; /* v45 pending — CRM renders without interaction data */ }
    })();
    const guidelinesPromise = listBrandsByWorkspace(workspaceId).catch(() => []); /* CRM still renders, just without DS state */
    const [brandResult, contactResult, campaignResult, dealResult, deliverableResult, linkResult, designResult, interactionRows, dsRows] = await Promise.all([
      sb.from("brands").select("*").eq("workspace_id", workspaceId).order("name"),
      sb.from("crm_contacts").select("*").eq("workspace_id", workspaceId).order("first_name"),
      sb.from("campaigns").select("id, brand_id, name, status").eq("workspace_id", workspaceId).order("name"),
      sb.from("crm_deals").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }),
      sb.from("crm_deal_deliverables").select("*").eq("workspace_id", workspaceId).order("sort_order"),
      sb.from("crm_deliverable_files").select("deliverable_id, template_id, linked_at").eq("workspace_id", workspaceId),
      sb.from("design_file_meta")
        .select("template_id, brand_id, campaign_id, asset_type, updated_at, templates(id, name, thumbnail)")
        .eq("workspace_id", workspaceId),
      interactionsPromise,
      guidelinesPromise,
    ]);
    const firstError = [
      brandResult.error,
      contactResult.error,
      campaignResult.error,
      dealResult.error,
      deliverableResult.error,
      linkResult.error,
      designResult.error,
    ].find(Boolean);
    if (firstError) throw firstError;

    const designs = (designResult.data || []).map((row: any) => {
      const template = Array.isArray(row.templates) ? row.templates[0] : row.templates;
      return {
        template_id: row.template_id,
        brand_id: row.brand_id || null,
        campaign_id: row.campaign_id || null,
        asset_type: row.asset_type || "other",
        updated_at: row.updated_at || null,
        name: template?.name || row.template_id,
        thumbnail: template?.thumbnail || null,
      };
    });
    const rawDeals = dealResult.data || [];
    const deliverables = deliverableResult.data || [];
    const links = linkResult.data || [];
    // One Design System per brand (v35): the CRM shows the "sin Design
    // System" badge and the one-click create for brands still missing it.
    const dsByCrmId = new Map(dsRows.filter(g => g.crmBrandId).map(g => [g.crmBrandId as string, g]));
    const dsByName = new Map(dsRows.map(g => [g.name.trim().toLowerCase(), g]));
    const deals = rawDeals.map((deal: any) => ({
      ...deal,
      progress: buildDealProgress(deal, deliverables, links, designs),
    }));
    const brands = (brandResult.data || []).map((brand: any) => {
      const ds = dsByCrmId.get(brand.id) || dsByName.get(String(brand.name).trim().toLowerCase());
      return {
        ...brand,
        relationship_status: brand.relationship_status || "lead",
        account_health: brand.account_health || "active",
        crm_priority: brand.crm_priority || "medium",
        crm_notes: brand.crm_notes || "",
        contact_count: (contactResult.data || []).filter((contact: any) => contact.brand_id === brand.id).length,
        design_count: designs.filter((design) => design.brand_id === brand.id).length,
        deal_count: rawDeals.filter((deal: any) => deal.brand_id === brand.id).length,
        design_system_template_id: ds?.designSystemTemplateId || null,
        brand_guideline_id: ds?.id || null,
        has_design_system: Boolean(ds?.designSystemTemplateId),
        suggestions: buildOfferSuggestions(
          brand,
          designs,
          deliverables
            .filter((deliverable: any) => rawDeals.some((deal: any) => deal.id === deliverable.deal_id && deal.brand_id === brand.id && deal.stage !== "lost"))
            .map((deliverable: any) => deliverable.asset_type),
        ),
        // v45 (DIATTA): computed health (manual override wins) + touchpoint count.
        computed_health: computeBrandHealth(brand, rawDeals),
        interaction_count: interactionRows.filter((interaction: any) => interaction.brand_id === brand.id).length,
      };
    });
    const contacts = (contactResult.data || []).map((contact: any) => ({
      ...contact,
      // v45 (DIATTA): per-person commercial stats for the rich People table.
      dealStats: buildContactDealStats(contact.id, rawDeals),
      interaction_count: interactionRows.filter((interaction: any) => interaction.contact_id === contact.id).length,
    }));
    const openDeals = deals.filter((deal: any) => !["delivered", "lost"].includes(deal.stage));
    const pipelineValue = openDeals.reduce((total: number, deal: any) => total + Number(deal.value || 0), 0);
    const weightedValue = openDeals.reduce(
      (total: number, deal: any) => total + (Number(deal.value || 0) * Number(deal.probability || 0) / 100),
      0,
    );

    res.setHeader("Cache-Control", "no-store");
    res.json({
      success: true,
      data: {
        brands,
        contacts,
        campaigns: campaignResult.data || [],
        deals,
        designs,
        summary: {
          pipelineValue,
          weightedValue,
          openDeals: openDeals.length,
          pendingDeliverables: deals.reduce(
            (total: number, deal: any) => total + Math.max(0, deal.progress.requested - deal.progress.completed),
            0,
          ),
          atRiskAccounts: brands.filter((brand: any) => brand.computed_health === "at_risk").length,
          interactions: interactionRows.length,
        },
      },
    });
  } catch (error: any) {
    sendCrmError(res, error);
  }
});

workspaceSaasRoutes.post("/:id/deals", requireWorkspaceRole("editor"), async (req, res) => {
  try {
    const parsed = crmDealCreateSchema.parse(req.body);
    const sb = dbOrThrow();
    const workspaceId = req.params.id;
    const { data: brand } = await sb.from("brands").select("id")
      .eq("workspace_id", workspaceId).eq("id", parsed.brandId).maybeSingle();
    if (!brand) return res.status(400).json({ success: false, error: "Brand does not belong to this workspace" });
    if (parsed.primaryContactId) {
      const { data: contact } = await sb.from("crm_contacts").select("id")
        .eq("workspace_id", workspaceId).eq("brand_id", parsed.brandId)
        .eq("id", parsed.primaryContactId).maybeSingle();
      if (!contact) return res.status(400).json({ success: false, error: "Contact does not belong to this brand" });
    }
    const campaign = await resolveDealCampaign(sb, workspaceId, parsed.brandId, parsed.campaignId, parsed.campaignName);
    const { data: deal, error: dealError } = await sb.from("crm_deals").insert({
      workspace_id: workspaceId,
      brand_id: parsed.brandId,
      campaign_id: campaign?.id || null,
      primary_contact_id: parsed.primaryContactId || null,
      title: parsed.title,
      description: parsed.description || null,
      stage: parsed.stage,
      value: parsed.value ?? null,
      currency: parsed.currency,
      probability: parsed.probability,
      expected_close_date: parsed.expectedCloseDate || null,
      due_date: parsed.dueDate || null,
      notes: parsed.notes || null,
      created_by: req.auth!.userId,
    }).select("*").single();
    if (dealError) throw dealError;
    const rows = parsed.deliverables.map((deliverable, index) => ({
      workspace_id: workspaceId,
      deal_id: deal.id,
      asset_type: deliverable.assetType,
      label: deliverable.label,
      quantity: deliverable.quantity,
      sort_order: index,
      notes: deliverable.notes || null,
      created_by: req.auth!.userId,
    }));
    const { error: deliverableError } = await sb.from("crm_deal_deliverables").insert(rows);
    if (deliverableError) {
      await sb.from("crm_deals").delete().eq("workspace_id", workspaceId).eq("id", deal.id);
      throw deliverableError;
    }
    res.status(201).json({ success: true, data: { ...deal, campaign, deliverables: rows } });
  } catch (error: any) {
    sendCrmError(res, error);
  }
});

workspaceSaasRoutes.patch("/:id/deals/:dealId", requireWorkspaceRole("editor"), async (req, res) => {
  try {
    const parsed = crmDealPatchSchema.parse(req.body);
    const sb = dbOrThrow();
    const workspaceId = req.params.id;
    const { data: current } = await sb.from("crm_deals").select("*")
      .eq("workspace_id", workspaceId).eq("id", req.params.dealId).maybeSingle();
    if (!current) return res.status(404).json({ success: false, error: "Deal not found" });
    if (parsed.primaryContactId) {
      const { data: contact } = await sb.from("crm_contacts").select("id")
        .eq("workspace_id", workspaceId).eq("brand_id", current.brand_id)
        .eq("id", parsed.primaryContactId).maybeSingle();
      if (!contact) return res.status(400).json({ success: false, error: "Contact does not belong to this brand" });
    }
    if (parsed.campaignId) {
      await resolveDealCampaign(sb, workspaceId, current.brand_id, parsed.campaignId);
    }
    const fields: Record<string, string> = {
      campaignId: "campaign_id",
      primaryContactId: "primary_contact_id",
      title: "title",
      description: "description",
      stage: "stage",
      value: "value",
      currency: "currency",
      probability: "probability",
      expectedCloseDate: "expected_close_date",
      dueDate: "due_date",
      notes: "notes",
      finalValue: "final_value",
      lostReason: "lost_reason",
      nextStepNote: "next_step_note",
      nextStepDate: "next_step_date",
    };
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [clientKey, dbKey] of Object.entries(fields)) {
      if (clientKey in parsed) patch[dbKey] = (parsed as any)[clientKey];
    }
    const { data, error } = await sb.from("crm_deals").update(patch)
      .eq("workspace_id", workspaceId).eq("id", req.params.dealId).select("*").single();
    if (error) throw error;
    if (parsed.stage && ["approved", "in_production", "review", "ready", "delivered"].includes(parsed.stage)) {
      await sb.from("brands").update({
        relationship_status: "client",
        account_health: "active",
        updated_at: new Date().toISOString(),
      }).eq("workspace_id", workspaceId).eq("id", current.brand_id);
    }
    res.json({ success: true, data });
  } catch (error: any) {
    sendCrmError(res, error);
  }
});

workspaceSaasRoutes.delete("/:id/deals/:dealId", requireWorkspaceRole("editor"), async (req, res) => {
  try {
    const sb = dbOrThrow();
    const { error } = await sb.from("crm_deals").delete()
      .eq("workspace_id", req.params.id).eq("id", req.params.dealId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    sendCrmError(res, error);
  }
});

workspaceSaasRoutes.post("/:id/deals/:dealId/deliverables", requireWorkspaceRole("editor"), async (req, res) => {
  try {
    const parsed = crmDeliverableInputSchema.parse(req.body);
    const sb = dbOrThrow();
    const workspaceId = req.params.id;
    const { data: deal } = await sb.from("crm_deals").select("id")
      .eq("workspace_id", workspaceId).eq("id", req.params.dealId).maybeSingle();
    if (!deal) return res.status(404).json({ success: false, error: "Deal not found" });
    const { count } = await sb.from("crm_deal_deliverables").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId).eq("deal_id", deal.id);
    const { data, error } = await sb.from("crm_deal_deliverables").insert({
      workspace_id: workspaceId,
      deal_id: deal.id,
      asset_type: parsed.assetType,
      label: parsed.label,
      quantity: parsed.quantity,
      sort_order: count || 0,
      notes: parsed.notes || null,
      created_by: req.auth!.userId,
    }).select("*").single();
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (error: any) {
    sendCrmError(res, error);
  }
});

workspaceSaasRoutes.patch("/:id/deals/:dealId/deliverables/:deliverableId", requireWorkspaceRole("editor"), async (req, res) => {
  try {
    const parsed = crmDeliverableInputSchema.partial().parse(req.body);
    const fields: Record<string, string> = {
      assetType: "asset_type",
      label: "label",
      quantity: "quantity",
      notes: "notes",
    };
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [clientKey, dbKey] of Object.entries(fields)) {
      if (clientKey in parsed) patch[dbKey] = (parsed as any)[clientKey];
    }
    const sb = dbOrThrow();
    const { data, error } = await sb.from("crm_deal_deliverables").update(patch)
      .eq("workspace_id", req.params.id).eq("deal_id", req.params.dealId)
      .eq("id", req.params.deliverableId).select("*").single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error: any) {
    sendCrmError(res, error);
  }
});

workspaceSaasRoutes.delete("/:id/deals/:dealId/deliverables/:deliverableId", requireWorkspaceRole("editor"), async (req, res) => {
  try {
    const sb = dbOrThrow();
    const { error } = await sb.from("crm_deal_deliverables").delete()
      .eq("workspace_id", req.params.id).eq("deal_id", req.params.dealId)
      .eq("id", req.params.deliverableId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    sendCrmError(res, error);
  }
});

workspaceSaasRoutes.post("/:id/deals/:dealId/reconcile", requireWorkspaceRole("editor"), async (req, res) => {
  try {
    const sb = dbOrThrow();
    const workspaceId = req.params.id;
    const { data: deal } = await sb.from("crm_deals").select("id, brand_id, campaign_id")
      .eq("workspace_id", workspaceId).eq("id", req.params.dealId).maybeSingle();
    if (!deal) return res.status(404).json({ success: false, error: "Deal not found" });
    if (!deal.campaign_id) {
      return res.status(400).json({
        success: false,
        error: "Asigna una campaña al deal antes de cruzar archivos automáticamente.",
      });
    }
    const [{ data: deliverables, error: deliverableError }, { data: designs, error: designError }, { data: links, error: linkError }] = await Promise.all([
      sb.from("crm_deal_deliverables").select("*").eq("workspace_id", workspaceId).eq("deal_id", deal.id).order("sort_order"),
      sb.from("design_file_meta").select("template_id, asset_type")
        .eq("workspace_id", workspaceId).eq("brand_id", deal.brand_id).eq("campaign_id", deal.campaign_id),
      sb.from("crm_deliverable_files").select("deliverable_id, template_id").eq("workspace_id", workspaceId),
    ]);
    if (deliverableError || designError || linkError) throw deliverableError || designError || linkError;
    const usedTemplateIds = new Set((links || []).map((link: any) => link.template_id));
    const existingPerDeliverable = new Map<string, number>();
    for (const link of links || []) {
      existingPerDeliverable.set(link.deliverable_id, (existingPerDeliverable.get(link.deliverable_id) || 0) + 1);
    }
    const assignments: Array<Record<string, unknown>> = [];
    for (const deliverable of deliverables || []) {
      const remaining = Math.max(0, deliverable.quantity - (existingPerDeliverable.get(deliverable.id) || 0));
      const matches = (designs || []).filter(
        (design: any) => design.asset_type === deliverable.asset_type && !usedTemplateIds.has(design.template_id),
      ).slice(0, remaining);
      for (const design of matches) {
        usedTemplateIds.add(design.template_id);
        assignments.push({
          workspace_id: workspaceId,
          deliverable_id: deliverable.id,
          template_id: design.template_id,
          linked_by: req.auth!.userId,
        });
      }
    }
    if (assignments.length) {
      const { error } = await sb.from("crm_deliverable_files").insert(assignments);
      if (error) throw error;
    }
    res.json({ success: true, data: { linked: assignments.length } });
  } catch (error: any) {
    sendCrmError(res, error);
  }
});

workspaceSaasRoutes.post("/:id/deals/:dealId/deliverables/:deliverableId/files", requireWorkspaceRole("editor"), async (req, res) => {
  try {
    const parsed = z.object({ templateId: z.string().min(1) }).parse(req.body);
    const sb = dbOrThrow();
    const workspaceId = req.params.id;
    const { data: deliverable } = await sb.from("crm_deal_deliverables")
      .select("id, asset_type, crm_deals!inner(id, brand_id, campaign_id)")
      .eq("workspace_id", workspaceId).eq("deal_id", req.params.dealId)
      .eq("id", req.params.deliverableId).maybeSingle();
    if (!deliverable) return res.status(404).json({ success: false, error: "Deliverable not found" });
    const joinedDeal = Array.isArray((deliverable as any).crm_deals)
      ? (deliverable as any).crm_deals[0]
      : (deliverable as any).crm_deals;
    const { data: design } = await sb.from("design_file_meta")
      .select("template_id, brand_id, campaign_id, asset_type")
      .eq("workspace_id", workspaceId).eq("template_id", parsed.templateId).maybeSingle();
    if (
      !design
      || design.brand_id !== joinedDeal.brand_id
      || design.asset_type !== deliverable.asset_type
      || (joinedDeal.campaign_id && design.campaign_id !== joinedDeal.campaign_id)
    ) {
      return res.status(400).json({ success: false, error: "El archivo no coincide con la marca, campaña y tipo del entregable." });
    }
    const { data, error } = await sb.from("crm_deliverable_files").insert({
      workspace_id: workspaceId,
      deliverable_id: deliverable.id,
      template_id: parsed.templateId,
      linked_by: req.auth!.userId,
    }).select("*").single();
    if (error?.code === "23505") {
      return res.status(409).json({ success: false, error: "Este archivo ya está vinculado a otro entregable." });
    }
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (error: any) {
    sendCrmError(res, error);
  }
});

workspaceSaasRoutes.delete("/:id/deals/:dealId/deliverables/:deliverableId/files/:templateId", requireWorkspaceRole("editor"), async (req, res) => {
  try {
    const sb = dbOrThrow();
    const { error } = await sb.from("crm_deliverable_files").delete()
      .eq("workspace_id", req.params.id)
      .eq("deliverable_id", req.params.deliverableId)
      .eq("template_id", req.params.templateId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    sendCrmError(res, error);
  }
});
