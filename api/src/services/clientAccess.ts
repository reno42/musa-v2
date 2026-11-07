/**
 * clientAccess — Gestión de accesos de cliente (brand_guests + auth, mig 23/24).
 * ─────────────────────────────────────────────────────────────────────────
 * Una capa, dos consumidores: las rutas REST de team.ts (sesión de usuario)
 * y las herramientas MCP de worker/runtime/functions/mcp.mjs (llave del
 * workspace). Reglas que ambos deben respetar y aquí se centralizan:
 *   · Solo admin del workspace toca accesos de cliente (assertWsAdmin).
 *   · La contraseña se GENERA, se devuelve UNA vez y nunca se guarda ni
 *     loguea en texto plano (Supabase la hashea) — mismo contrato show-once
 *     que las API keys del workspace.
 *   · La proyección visible del cliente (brand_guests.profile) es allowlist
 *     estricta: identidad básica; NADA comercial (eso vive en crm_contacts,
 *     tabla que los invitados jamás leen).
 *   · Crear el contacto de CRM es best-effort: si falla por drift de schema,
 *     el acceso del cliente sigue provisionándose (no se aborta por eso).
 */
import { randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "./supabase.js";
import type { RequestAuth } from "./requestContext.js";

export type Admin = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

export function clampText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function nameFromEmail(email: string | null | undefined): string {
  const local = (email || "").split("@")[0] || "";
  return local ? local.replace(/[._-]+/g, " ").slice(0, 60) : "";
}

/** 16 chars sin ambiguos (0/O/1/l/I fuera) — se muestra UNA vez. */
export function genPassword(): string {
  const ab = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const b = randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) out += ab[b[i] % ab.length];
  return out;
}

/** La URL del portal de cliente dentro de la app (ruta hash). */
export function portalUrl(origin: string): string {
  return String(origin || "").trim().replace(/\/+$/, "") + "/#clientes/portal";
}

/** Proyección allowlist: lo ÚNICO que el cliente ve de sí en su portal. */
export function sanitizeProfile(raw: any): Record<string, string> {
  const out: Record<string, string> = {};
  const dn = clampText(raw?.displayName, 80); if (dn) out.display_name = dn;
  const tt = clampText(raw?.title, 80); if (tt) out.title = tt;
  const co = clampText(raw?.company, 80); if (co) out.company = co;
  const ph = clampText(raw?.phone, 30); if (ph) out.phone = ph;
  return out;
}

/** Solo owner/admin del workspace (llave del workspace, sesión de usuario o admin). */
export async function assertWsAdmin(auth: RequestAuth | null, admin: Admin, workspaceId: string): Promise<void> {
  if (auth?.isAdmin) return;
  if (auth?.authType === "workspace_key") {
    if (auth.workspaceRole === "owner" || auth.workspaceRole === "admin") return;
    throw { code: -32000, message: "SOLO_ADMIN: gestionar clientes exige rol admin u owner del workspace" };
  }
  if (auth?.authType === "user" && typeof auth.userId === "string" && /^[0-9a-f-]{36}$/i.test(auth.userId)) {
    const { data: ws } = await admin.from("workspaces").select("owner_id").eq("id", workspaceId).maybeSingle();
    if (ws && ws.owner_id === auth.userId) return;
    const { data: m } = await admin.from("workspace_members").select("role")
      .eq("user_id", auth.userId).eq("workspace_id", workspaceId).in("role", ["owner", "admin"]).limit(1).maybeSingle();
    if (m) return;
  }
  throw { code: -32000, message: "SOLO_ADMIN: gestionar clientes exige rol admin u owner del workspace" };
}

/** uid para auditoría (invited_by / created_by): la sesión si es uuid, si no el owner del workspace. */
export async function actorUid(admin: Admin, auth: RequestAuth | null, workspaceId: string): Promise<string | null> {
  const uid = auth?.userId || "";
  if (/^[0-9a-f-]{36}$/i.test(uid)) return uid;
  try {
    const { data } = await admin.from("workspaces").select("owner_id").eq("id", workspaceId).maybeSingle();
    const owner = (data as any)?.owner_id || null;
    return owner && /^[0-9a-f-]{36}$/i.test(owner) ? owner : null;
  } catch { return null; }
}

/**
 * Cuenta auth del cliente: si existe la devuelve (password null — el caller
 * genera un reset); si no, la CREA confirmada (la agencia avala el correo)
 * con la contraseña generada que viaja UNA vez en el resultado.
 */
export async function ensureAuthUser(admin: Admin, email: string, displayName?: string): Promise<{ userId: string; created: boolean; password: string | null }> {
  // user_profiles (sincronizada por el trigger on_auth_user_created) es el
  // índice de correos de esta base — esta versión de supabase-js no expone
  // getUserByEmail en el admin API.
  const { data: profile } = await admin.from("user_profiles")
    .select("id").ilike("email", email).limit(1).maybeSingle();
  if (profile?.id) return { userId: profile.id, created: false, password: null };
  const password = genPassword();
  const { data: created, error: err2 } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: displayName || nameFromEmail(email) },
  });
  if (err2 || !created?.user) throw { code: -32000, message: "AUTH_CREATE: no se pudo crear la cuenta del cliente: " + (err2?.message || "sin usuario") };
  return { userId: created.user.id, created: true, password };
}

/** Nueva contraseña (show-once) para un uid existente. */
export async function setAuthPassword(admin: Admin, userId: string): Promise<string> {
  const password = genPassword();
  const { error } = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
  if (error) throw { code: -32000, message: "RESET_FAIL: " + error.message };
  return password;
}

/**
 * Crea o reactiva la fila de invitado (única por workspace+marca+email) y
 * deja ligado el uid + la proyección. Si la columna profile aún no existe
 * (migración 24 pendiente) reintenta sin ella — el resto se guarda igual.
 */
export async function upsertGuest(
  admin: Admin,
  opts: { workspaceId: string; brandId: string; email: string; userId: string | null; profile?: Record<string, string>; invitedBy?: string | null },
): Promise<{ guest: any; reactivated: boolean }> {
  const { workspaceId, brandId, email, userId, profile, invitedBy } = opts;
  const { data: existing } = await admin.from("brand_guests")
    .select("id").eq("workspace_id", workspaceId).eq("brand_id", brandId).ilike("email", email).limit(1).maybeSingle();
  if (existing?.id) {
    const patch: Record<string, unknown> = { status: "activo", user_id: userId ?? null, updated_at: new Date().toISOString() };
    if (profile && Object.keys(profile).length) patch.profile = profile;
    let { data, error } = await admin.from("brand_guests").update(patch).eq("id", existing.id).select().single();
    if (error && /profile/i.test(error.message || "")) {
      delete patch.profile;
      ({ data, error } = await admin.from("brand_guests").update(patch).eq("id", existing.id).select().single());
    }
    if (error) throw { code: -32000, message: "GUEST_FAIL: " + error.message };
    return { guest: data, reactivated: true };
  }
  const row: Record<string, unknown> = {
    workspace_id: workspaceId, brand_id: brandId, email, status: "activo",
    user_id: userId ?? null, invited_by: invitedBy ?? null,
  };
  if (profile && Object.keys(profile).length) row.profile = profile;
  let { data, error } = await admin.from("brand_guests").insert(row).select().single();
  if (error && /profile/i.test(error.message || "")) {
    delete row.profile;
    ({ data, error } = await admin.from("brand_guests").insert(row).select().single());
  }
  if (error) throw { code: -32000, message: "GUEST_FAIL: " + error.message };
  return { guest: data, reactivated: false };
}

/**
 * Contacto de CRM best-effort: crea el registro si no hay ninguno con ese
 * correo en el workspace (identidad básica + marca). Si ya existe NO lo
 * toca — el perfilado comercial es cosa de la agencia, nunca del alta del
 * acceso. Devuelve el id del contacto o null (sin abortar el flujo).
 */
export async function ensureCrmContact(
  admin: Admin,
  opts: { workspaceId: string; brandId: string; brandName?: string | null; email: string; displayName?: string; title?: string; company?: string; phone?: string; actorUserId: string | null },
): Promise<string | null> {
  const { workspaceId, brandId, brandName, email, displayName, title, company, phone, actorUserId } = opts;
  try {
    const { data: existing } = await admin.from("crm_contacts")
      .select("id").eq("workspace_id", workspaceId).ilike("email", email).limit(1).maybeSingle();
    if (existing?.id) return existing.id;
    const parts = (displayName || nameFromEmail(email) || "Cliente").split(/\s+/);
    const row: Record<string, unknown> = {
      workspace_id: workspaceId, brand_id: brandId, brand_name: brandName || null,
      first_name: parts[0] || "Cliente", last_name: parts.slice(1).join(" ") || null,
      email, phone: phone || null, job_title: title || null, company: company || null,
      status: "active", created_by: actorUserId,
    };
    const attempt = (withOrigin: boolean) =>
      withOrigin
        ? admin.from("crm_contacts").insert({ ...row, origin_source: "portal" }).select("id").single()
        : admin.from("crm_contacts").insert(row).select("id").single();
    let { data, error } = await attempt(true);
    if (error) ({ data, error } = await attempt(false) as any);
    return (data as any)?.id || null;
  } catch {
    return null; /* CRM es accesorio: el acceso del cliente no depende de esto */
  }
}
