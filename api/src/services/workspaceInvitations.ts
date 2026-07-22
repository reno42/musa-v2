import type { Request } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAuthClient } from "./supabase.js";

export type InvitationDelivery = {
  emailSent: boolean;
  method: "link" | "supabase_invite" | "supabase_magic_link";
  requiresAccountSetup: boolean;
  recipientUserId?: string;
  warning?: string;
};

function usableOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function applicationOrigin(req: Request): string {
  const configured = [
    process.env.SAAS_APP_URL,
    process.env.URL,
    process.env.DEPLOY_PRIME_URL,
  ].map(usableOrigin).find(Boolean);
  if (configured) return configured;

  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : req.protocol;
  const host = req.get("host");
  const fallback = host ? usableOrigin(`${protocol}://${host}`) : null;
  if (!fallback) throw new Error("Unable to determine the application URL for the invitation");
  return fallback;
}

export function invitationUrl(req: Request, rawToken: string): string {
  const url = new URL("/", applicationOrigin(req));
  url.searchParams.set("invite", rawToken);
  url.hash = "workspace";
  return url.toString();
}

export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.trim().toLowerCase().split("@");
  if (!local || !domain) return "correo invitado";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(2, Math.min(6, local.length - visible.length)))}@${domain}`;
}

export async function deliverWorkspaceInvitation(
  admin: SupabaseClient,
  email: string,
  redirectTo: string,
  accountExists: boolean,
): Promise<InvitationDelivery> {
  if (!accountExists) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { needs_password_setup: true, invitation_source: "workspace" },
    });
    if (!error) {
      return {
        emailSent: true,
        method: "supabase_invite",
        requiresAccountSetup: true,
        recipientUserId: data.user?.id,
      };
    }

    // A signup can race the invitation. In that case, fall through to the
    // existing-account magic link instead of discarding the workspace invite.
    if (!/already|registered|exists/i.test(error.message)) {
      return {
        emailSent: false,
        method: "link",
        requiresAccountSetup: false,
        warning: "La invitación quedó creada, pero Supabase no pudo enviar el correo.",
      };
    }
  }

  const authClient = getSupabaseAuthClient();
  if (!authClient) {
    return {
      emailSent: false,
      method: "link",
      requiresAccountSetup: false,
      warning: "La invitación quedó creada. Comparte el enlace porque el correo automático no está configurado.",
    };
  }

  const { error } = await authClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
  });
  if (error) {
    return {
      emailSent: false,
      method: "link",
      requiresAccountSetup: false,
      warning: "La invitación quedó creada, pero Supabase no pudo enviar el correo.",
    };
  }

  return {
    emailSent: true,
    method: "supabase_magic_link",
    requiresAccountSetup: false,
  };
}
