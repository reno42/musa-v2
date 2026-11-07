import { Router } from "express";
import { getSupabaseAdmin } from "../services/supabase.js";
import { getWorkspaceRole, listAccessibleWorkspaceIds } from "../services/tenancy.js";
import {
  actorUid, ensureAuthUser, ensureCrmContact, portalUrl, sanitizeProfile, setAuthPassword, upsertGuest,
} from "../services/clientAccess.js";
import { hasMinimumWorkspaceRole } from "../services/workspaceRoles.js";
import type { Request } from "express";
import type { RequestAuth, WorkspaceRole } from "../services/requestContext.js";

/**
 * Modo freelancer/agencia (migración 23): equipo + invitados por marca,
 * intranet de marca (brand_portal) y comentarios de contenido.
 *
 * Todos los handlers usan el cliente service-role (bypass de RLS), así que
 * CADA handler exige el acceso aquí en código. La misma regla vive en RLS
 * para el tráfico /rest/* directo del navegador — dos cerraduras, una llave:
 * miembro del workspace (workspace_members) o invitado activo de ESA marca
 * (brand_guests, ligado por user_id o email).
 */

export const teamRoutes = Router();
export const portalRoutes = Router();
export const contentCommentRoutes = Router();

type Access =
  | { kind: "member"; role: WorkspaceRole }
  | { kind: "guest"; brandIds: string[]; workspaceId: string }
  | { kind: "none" };

type GuestRow = {
  id: string;
  workspace_id: string;
  brand_id: string;
  email: string;
  user_id: string | null;
  status: string;
  created_at: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COMMENT_MAX = 500;

function clampText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function nameFromEmail(email: string | null | undefined): string {
  const local = (email || "").split("@")[0] || "";
  return local ? local.replace(/[._-]+/g, " ").slice(0, 60) : "";
}

async function userEmail(sb: NonNullable<ReturnType<typeof getSupabaseAdmin>>, auth: RequestAuth): Promise<string | null> {
  if (auth.authType !== "user") return null;
  try {
    const { data, error } = await sb.auth.admin.getUserById(auth.userId);
    if (error || !data.user?.email) return null;
    return data.user.email.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Resuelve el acceso al workspace: primero como miembro (workspace_members /
 * owner / key), después como invitado activo de marca. Al encontrar filas de
 * invitado solo por email, escribe user_id (lazy link: el cliente se registró
 * con el correo invitado y a partir de aquí lo une su uid).
 */
async function accessFor(sb: NonNullable<ReturnType<typeof getSupabaseAdmin>>, auth: RequestAuth, workspaceId: string): Promise<Access> {
  const role = await getWorkspaceRole(auth, workspaceId);
  if (role) return { kind: "member", role };

  if (auth.authType !== "user") return { kind: "none" };
  const email = await userEmail(sb, auth);
  const { data: rows } = await sb.from("brand_guests")
    .select("id, workspace_id, brand_id, email, user_id, status")
    .eq("workspace_id", workspaceId)
    .eq("status", "activo")
    .or(`user_id.eq.${auth.userId}${email ? `,email.eq.${email}` : ""}`);
  const guests = (rows || []) as GuestRow[];
  if (guests.length === 0) return { kind: "none" };

  // Lazy link: la invitación se creó con el email antes de que existiera la cuenta.
  const unlinked = guests.filter((g) => !g.user_id && email);
  if (unlinked.length > 0) {
    await sb.from("brand_guests").update({ user_id: auth.userId }).in("id", unlinked.map((g) => g.id));
  }
  return { kind: "guest", brandIds: [...new Set(guests.map((g) => g.brand_id))], workspaceId };
}

/** workspaceId explícito o, con uno solo accesible, ese (patrón de tenancy). */
async function resolveWorkspaceId(sb: NonNullable<ReturnType<typeof getSupabaseAdmin>>, auth: RequestAuth, req: Request): Promise<string | null> {
  const explicit = String(req.query.workspaceId || req.body?.workspaceId || "").trim();
  if (explicit) return explicit;
  const accessible = await listAccessibleWorkspaceIds(auth);
  if (accessible.length === 1) return accessible[0];
  // Invitados: no son miembros; su workspace vive en brand_guests.
  if (auth.authType === "user") {
    const { data } = await sb.from("brand_guests").select("workspace_id").eq("user_id", auth.userId).eq("status", "activo");
    const ids = [...new Set((data || []).map((r: any) => r.workspace_id))];
    if (ids.length === 1) return ids[0];
  }
  return null;
}

// ── Visibilidad de entidades para invitados (espejo exacto de la migración 23) ──
// brandExpr: de dónde sale la marca de cada entidad; las demás tablas NO son
// visibles para invitados (conservador: el SQL tampoco les abre política).
type EntityBrand = { table: string; col: string; json?: string };
const GUEST_ENTITIES: Record<string, EntityBrand> = {
  templates: { table: "templates", col: "data", json: "brandId" },
  content_calendar: { table: "content_calendar", col: "brand_id" },
  briefs: { table: "briefs", col: "brand_id" },
  workspace_events: { table: "workspace_events", col: "brand_id" },
  workspace_projects: { table: "workspace_projects", col: "brand_id" },
  workspace_mailings: { table: "workspace_mailings", col: "content", json: "brand_id" },
  workspace_forms: { table: "workspace_forms", col: "schema", json: "brand_id" },
};

/**
 * Marca y visibilidad de una entidad. Invitado solo ve `visibility='shared'`
 * de SU marca — igual que la capa restrictive + política de invitados en SQL.
 * Sin la columna visibility (migración 23 sin correr) se asume 'shared' para
 * no romper el despliegue escalonado; la marca sí es obligatoria.
 */
async function guestEntityBrand(sb: NonNullable<ReturnType<typeof getSupabaseAdmin>>, entityType: string, entityId: string): Promise<{ brand: string | null; visibility: string }> {
  if (entityType === "brain_notes") {
    const { data } = await sb.from("brain_notes").select("entity_type, entity_id, visibility").eq("id", entityId).maybeSingle();
    if (!data) return { brand: null, visibility: "private" };
    return { brand: data.entity_type === "brand" ? data.entity_id : null, visibility: data.visibility || "shared" };
  }
  const def = GUEST_ENTITIES[entityType];
  if (!def) return { brand: null, visibility: "private" };
  let row: any = null;
  try {
    const { data } = await sb.from(def.table).select(`${def.col}, visibility`).eq("id", entityId).maybeSingle();
    row = data;
  } catch {
    // visibility aún no existe (migración pendiente): reintentar sin ella.
    const { data } = await sb.from(def.table).select(def.col).eq("id", entityId).maybeSingle();
    row = data ? { ...(data as Record<string, any>), visibility: "shared" } : null;
  }
  if (!row) return { brand: null, visibility: "private" };
  const raw = def.json ? (row[def.col] || {})[def.json] : row[def.col];
  return { brand: raw || null, visibility: row.visibility || "shared" };
}

async function guestCanSeeEntity(sb: NonNullable<ReturnType<typeof getSupabaseAdmin>>, access: Access & { kind: "guest" }, entityType: string, entityId: string): Promise<boolean> {
  const { brand, visibility } = await guestEntityBrand(sb, entityType, entityId);
  return visibility === "shared" && Boolean(brand) && access.brandIds.includes(brand!);
}

// ═══ /api/team — acceso, invitados por marca ═══

// GET /api/team/access — mapa de acceso del usuario logueado: workspaces con
// rol (miembros) + marcas donde es invitado activo. El front lo usa para
// habilitar modo agencia (invitados, portal, filtros «Mi negocio»).
teamRoutes.get("/access", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    if (!sb || !req.auth) return res.status(503).json({ success: false, error: "Supabase not configured" });

    const accessibleIds = await listAccessibleWorkspaceIds(req.auth);
    const workspaces: Array<{ id: string; role: WorkspaceRole | null }> = [];
    for (const id of accessibleIds) {
      workspaces.push({ id, role: await getWorkspaceRole(req.auth, id) });
    }

    let guestBrands: Array<{ workspaceId: string; brandId: string }> = [];
    const email = await userEmail(sb, req.auth);
    const { data: guestRows } = await sb.from("brand_guests")
      .select("id, workspace_id, brand_id, user_id, email, status")
      .eq("status", "activo")
      .or(`user_id.eq.${req.auth.userId}${email ? `,email.eq.${email}` : ""}`);
    if ((guestRows || []).length > 0) {
      const unlinked = (guestRows as any[]).filter((g) => !g.user_id && email);
      if (unlinked.length > 0) {
        await sb.from("brand_guests").update({ user_id: req.auth.userId }).in("id", unlinked.map((g) => g.id));
      }
      guestBrands = (guestRows as any[]).map((g) => ({ workspaceId: g.workspace_id, brandId: g.brand_id }));
    }

    return res.json({ success: true, data: { workspaces, guestBrands } });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || "Access lookup failed" });
  }
});

// GET /api/team/guests?workspaceId= — lista de invitados (viewer+), con el
// nombre de la marca resuelto para que la UI no necesite segunda llamada.
teamRoutes.get("/guests", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    if (!sb || !req.auth) return res.status(503).json({ success: false, error: "Supabase not configured" });
    const workspaceId = await resolveWorkspaceId(sb, req.auth, req);
    if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
    const access = await accessFor(sb, req.auth, workspaceId);
    if (access.kind !== "member" || !hasMinimumWorkspaceRole(access.role, "viewer")) {
      return res.status(403).json({ success: false, error: "You do not have access to this workspace" });
    }

    // profile viaja para que el CRM muestre la proyección visible actual
    // (migración 24 pendiente → reintento sin la columna, degradación grácil).
    const gq = (withProfile: boolean) => sb.from("brand_guests")
      .select(withProfile ? "id, brand_id, email, user_id, status, invited_by, profile, created_at" : "id, brand_id, email, user_id, status, invited_by, created_at")
      .eq("workspace_id", workspaceId).neq("status", "revocado").order("created_at", { ascending: false });
    const [{ data: guests, error: gerr }, { data: brands }] = await Promise.all([
      gq(true), sb.from("brands").select("id, name").eq("workspace_id", workspaceId),
    ]);
    const guestRows = gerr && /profile/i.test(gerr.message || "") ? (await gq(false)).data : guests;
    const brandName = new Map((brands || []).map((b: any) => [b.id, b.name]));
    const data = (guestRows || []).map((g: any) => ({ ...g, brandName: brandName.get(g.brand_id) || null }));
    return res.json({ success: true, data, total: data.length });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || "Guests load failed" });
  }
});

// POST /api/team/guests { workspaceId, brandId, email } — invita a un cliente
// a UNA marca (admin). Re-invitar un correo revocado lo reactiva.
teamRoutes.post("/guests", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    if (!sb || !req.auth) return res.status(503).json({ success: false, error: "Supabase not configured" });
    const workspaceId = await resolveWorkspaceId(sb, req.auth, req);
    if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
    const access = await accessFor(sb, req.auth, workspaceId);
    if (access.kind !== "member" || !hasMinimumWorkspaceRole(access.role, "admin")) {
      return res.status(403).json({ success: false, error: "Solo un admin puede invitar clientes" });
    }

    const brandId = clampText(req.body?.brandId, 120);
    const email = clampText(req.body?.email, 200).toLowerCase();
    if (!brandId) return res.status(400).json({ success: false, error: "brandId is required" });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ success: false, error: "Correo inválido" });

    const { data: brand } = await sb.from("brands").select("id").eq("id", brandId).eq("workspace_id", workspaceId).maybeSingle();
    if (!brand) return res.status(404).json({ success: false, error: "La marca no pertenece a este workspace" });

    const { data: existing } = await sb.from("brand_guests")
      .select("id, status").eq("workspace_id", workspaceId).eq("brand_id", brandId)
      .ilike("email", email).maybeSingle();

    if (existing) {
      const { data: updated, error } = await sb.from("brand_guests")
        .update({ status: "activo" })
        .eq("id", (existing as any).id).select().single();
      if (error) return res.status(500).json({ success: false, error: error.message });
      return res.json({ success: true, data: updated, reactivated: true });
    }

    const { data: guest, error } = await sb.from("brand_guests").insert({
      workspace_id: workspaceId,
      brand_id: brandId,
      email,
      status: "activo",
      invited_by: req.auth.userId,
    }).select().single();
    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.status(201).json({ success: true, data: guest });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || "Guest invite failed" });
  }
});

// POST /api/team/guests/provision { workspaceId, brandId, email, name?,
// title?, company?, phone?, createContact? } — crea el ACCESO COMPLETO del
// cliente (admin): cuenta auth (o rotación de su contraseña si ya existía),
// fila de invitado con su perfil visible y contacto de CRM best-effort.
// La contraseña viaja UNA vez en la respuesta — nunca se guarda ni loguea.
teamRoutes.post("/guests/provision", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    if (!sb || !req.auth) return res.status(503).json({ success: false, error: "Supabase not configured" });
    const workspaceId = await resolveWorkspaceId(sb, req.auth, req);
    if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
    const access = await accessFor(sb, req.auth, workspaceId);
    if (access.kind !== "member" || !hasMinimumWorkspaceRole(access.role, "admin")) {
      return res.status(403).json({ success: false, error: "Solo un admin puede crear accesos de cliente" });
    }

    const brandId = clampText(req.body?.brandId, 120);
    const email = clampText(req.body?.email, 200).toLowerCase();
    const displayName = clampText(req.body?.name || req.body?.displayName, 80);
    if (!brandId) return res.status(400).json({ success: false, error: "brandId is required" });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ success: false, error: "Correo inválido" });

    const { data: brand } = await sb.from("brands").select("id, name").eq("id", brandId).eq("workspace_id", workspaceId).maybeSingle();
    if (!brand) return res.status(404).json({ success: false, error: "La marca no pertenece a este workspace" });

    const profile = sanitizeProfile({
      displayName: displayName || undefined,
      title: req.body?.title, company: req.body?.company, phone: req.body?.phone,
    });

    // Cuenta auth: si ya existía, la contraseña se ROTA para que la agencia
    // siempre entregue credenciales válidas (mismo efecto que un reset).
    const ensured = await ensureAuthUser(sb, email, displayName);
    const password = ensured.created && ensured.password ? ensured.password : await setAuthPassword(sb, ensured.userId);

    const invitedBy = await actorUid(sb, req.auth, workspaceId);
    const { guest, reactivated } = await upsertGuest(sb, {
      workspaceId, brandId, email, userId: ensured.userId, profile, invitedBy,
    });

    // Contacto de CRM best-effort: no aborta el provisionamiento.
    const contactId = req.body?.createContact === false ? null : await ensureCrmContact(sb, {
      workspaceId, brandId, brandName: (brand as any)?.name || null, email, displayName,
      title: profile.title, company: profile.company, phone: profile.phone, actorUserId: invitedBy,
    });

    const origin = String(req.headers.origin || `${req.protocol}://${req.get("host") || ""}`);
    return res.status(201).json({
      success: true,
      data: {
        guest, contactId, authCreated: ensured.created, reactivated,
        credentials: { email, password },
        portalUrl: portalUrl(origin),
      },
    });
  } catch (err: any) {
    const status = typeof err?.code === "number" ? 400 : 500;
    return res.status(status).json({ success: false, error: err?.message || "Provision failed" });
  }
});

// POST /api/team/guests/:id/reset-password — nueva contraseña show-once
// (admin). Si el invitado aún no tiene cuenta auth, se le crea aquí mismo.
teamRoutes.post("/guests/:id/reset-password", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    if (!sb || !req.auth) return res.status(503).json({ success: false, error: "Supabase not configured" });
    const workspaceId = await resolveWorkspaceId(sb, req.auth, req);
    if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
    const access = await accessFor(sb, req.auth, workspaceId);
    if (access.kind !== "member" || !hasMinimumWorkspaceRole(access.role, "admin")) {
      return res.status(403).json({ success: false, error: "Solo un admin puede resetear contraseñas de clientes" });
    }

    const { data: guest } = await sb.from("brand_guests")
      .select("id, email, user_id, status").eq("id", req.params.id).eq("workspace_id", workspaceId).maybeSingle();
    if (!guest) return res.status(404).json({ success: false, error: "Invitado no encontrado" });
    const g = guest as any;
    if (g.status !== "activo") {
      return res.status(409).json({ success: false, error: "El acceso está revocado: reinvítalo antes de resetear" });
    }

    const ensured = await ensureAuthUser(sb, g.email);
    const password = ensured.created && ensured.password ? ensured.password : await setAuthPassword(sb, ensured.userId);
    if (!g.user_id && ensured.userId) {
      await sb.from("brand_guests").update({ user_id: ensured.userId, updated_at: new Date().toISOString() }).eq("id", g.id);
    }

    const origin = String(req.headers.origin || `${req.protocol}://${req.get("host") || ""}`);
    return res.json({
      success: true,
      data: { credentials: { email: g.email, password }, portalUrl: portalUrl(origin), authCreated: ensured.created },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || "Reset failed" });
  }
});

// PUT /api/team/guests/:id/profile { displayName?, title?, company?, phone? }
// — la proyección que el cliente ve en «Mi información» (allowlist estricta;
// nada comercial vive aquí). Requiere la migración 24 (columna profile).
teamRoutes.put("/guests/:id/profile", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    if (!sb || !req.auth) return res.status(503).json({ success: false, error: "Supabase not configured" });
    const workspaceId = await resolveWorkspaceId(sb, req.auth, req);
    if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
    const access = await accessFor(sb, req.auth, workspaceId);
    if (access.kind !== "member" || !hasMinimumWorkspaceRole(access.role, "admin")) {
      return res.status(403).json({ success: false, error: "Solo un admin puede editar el perfil del cliente" });
    }

    const profile = sanitizeProfile({
      displayName: req.body?.displayName || req.body?.name,
      title: req.body?.title, company: req.body?.company, phone: req.body?.phone,
    });
    if (Object.keys(profile).length === 0) {
      return res.status(400).json({ success: false, error: "Nada que guardar: envía displayName, title, company o phone" });
    }

    const patch = { profile, updated_at: new Date().toISOString() };
    const { data, error } = await sb.from("brand_guests")
      .update(patch).eq("id", req.params.id).eq("workspace_id", workspaceId).select().single();
    if (error && /profile/i.test(error.message || "")) {
      return res.status(409).json({ success: false, error: "Corre la migración 24 (brand_guests.profile) para guardar perfiles" });
    }
    if (error || !data) return res.status(404).json({ success: false, error: "Invitado no encontrado" });
    return res.json({ success: true, data });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || "Profile update failed" });
  }
});

// DELETE /api/team/guests/:id — revoca el acceso (historia conservada).
teamRoutes.delete("/guests/:id", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    if (!sb || !req.auth) return res.status(503).json({ success: false, error: "Supabase not configured" });
    const workspaceId = await resolveWorkspaceId(sb, req.auth, req);
    if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
    const access = await accessFor(sb, req.auth, workspaceId);
    if (access.kind !== "member" || !hasMinimumWorkspaceRole(access.role, "admin")) {
      return res.status(403).json({ success: false, error: "Solo un admin puede revocar clientes" });
    }

    const { data, error } = await sb.from("brand_guests")
      .update({ status: "revocado" })
      .eq("id", req.params.id).eq("workspace_id", workspaceId).select().single();
    if (error || !data) return res.status(404).json({ success: false, error: "Invitado no encontrado" });
    return res.json({ success: true, data });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || "Guest revoke failed" });
  }
});

// ═══ /api/brand-portal — configuración de la intranet por marca ═══

// «crm» (REQ ManyChat): el módulo CRM del portal del cliente — data fija +
// timeline, sin deal values ni notas de agencia (la proyección la impone el
// server en las rutas crm/* de abajo).
const PORTAL_SECTIONS = ["resumen", "briefs", "disenos", "calendario", "campanas", "reportes", "notas", "crm"];

function sanitizeSections(raw: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  for (const key of PORTAL_SECTIONS) out[key] = input[key] !== false;
  return out;
}

// Marca con is_house tolerante: si la migración 23 aún no corrió, la columna
// falta y la llamada con is_house fallaría entera — reintento sin ella.
async function brandById(sb: NonNullable<ReturnType<typeof getSupabaseAdmin>>, workspaceId: string, brandId: string) {
  const cols = "id, name, colors, fonts, relationship_status, updated_at";
  const attempt = async (withHouse: boolean) => {
    const { data, error } = await sb.from("brands")
      .select(withHouse ? `${cols}, is_house` : cols)
      .eq("id", brandId).eq("workspace_id", workspaceId).maybeSingle();
    return error && withHouse ? null : data;
  };
  return (await attempt(true)) ?? (await attempt(false));
}

// GET /api/brand-portal/:brandId?workspaceId= — portal + marca para la
// intranet. Miembro (viewer+) o invitado activo de ESA marca.
portalRoutes.get("/:brandId", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    if (!sb || !req.auth) return res.status(503).json({ success: false, error: "Supabase not configured" });
    const workspaceId = await resolveWorkspaceId(sb, req.auth, req);
    if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
    const access = await accessFor(sb, req.auth, workspaceId);
    if (access.kind === "none") return res.status(403).json({ success: false, error: "You do not have access to this workspace" });
    if (access.kind === "guest" && !access.brandIds.includes(req.params.brandId)) {
      return res.status(403).json({ success: false, error: "Esta marca no te está compartida" });
    }

    const [{ data: portal }, brand] = await Promise.all([
      sb.from("brand_portal").select("*").eq("workspace_id", workspaceId).eq("brand_id", req.params.brandId).maybeSingle(),
      brandById(sb, workspaceId, req.params.brandId),
    ]);
    if (!brand) return res.status(404).json({ success: false, error: "Marca no encontrada" });

    // «Mi información»: la ÚNICA proyección del cliente sobre sí mismo
    // (allowlist de brand_guests.profile — nada comercial viaja aquí).
    let me: Record<string, unknown> | null = null;
    if (access.kind === "guest") {
      const auth = req.auth;
      const email = await userEmail(sb, auth);
      const attempt = async (withProfile: boolean) => {
        const { data, error } = await sb.from("brand_guests")
          .select(withProfile ? "email, profile, created_at" : "email, created_at")
          .eq("workspace_id", workspaceId).eq("brand_id", req.params.brandId).eq("status", "activo")
          .or(`user_id.eq.${auth.userId}${email ? `,email.eq.${email}` : ""}`)
          .limit(1).maybeSingle();
        return error && withProfile ? null : data;
      };
      const row: any = (await attempt(true)) ?? (await attempt(false));
      if (row) {
        const p = (row.profile || {}) as Record<string, string>;
        me = {
          email: row.email,
          displayName: p.display_name || nameFromEmail(row.email),
          title: p.title || null,
          company: p.company || null,
          phone: p.phone || null,
          since: row.created_at,
        };
      }
    }

    return res.json({
      success: true,
      data: {
        portal: portal || null,
        brand,
        viewer: access.kind === "guest" ? "client" : access.role,
        me,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || "Portal load failed" });
  }
});

// ═══ CRM del portal (REQ ManyChat) — la ÚNICA proyección de contactos que ve
// el cliente: data fija + timeline de conversaciones. JAMÁS deal values ni
// notas de agencia: la allowlist de columnas la impone el server aquí.

// notes NO viaja (columna de la agencia). custom_fields/channel_ids con gracia
// si la migración 26 aún no corrió.
const PORTAL_CONTACT_COLS = "id, first_name, last_name, email, phone, job_title, company, status, tags, custom_fields, channel_ids, origin_source, created_at, updated_at";

function portalContactCols(withNew: boolean): string {
  return withNew ? PORTAL_CONTACT_COLS : PORTAL_CONTACT_COLS.replace(", custom_fields, channel_ids", "");
}

// GET /api/brand-portal/:brandId/crm/contacts?workspaceId=&q= — contactos de
// ESA marca. Miembro (viewer+) o invitado activo de la marca; el invitado solo
// ve marcas en su allowlist (accessFor + brandIds).
portalRoutes.get("/:brandId/crm/contacts", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    if (!sb || !req.auth) return res.status(503).json({ success: false, error: "Supabase not configured" });
    const workspaceId = await resolveWorkspaceId(sb, req.auth, req);
    if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
    const access = await accessFor(sb, req.auth, workspaceId);
    if (access.kind === "none") return res.status(403).json({ success: false, error: "You do not have access to this workspace" });
    if (access.kind === "guest" && !access.brandIds.includes(req.params.brandId)) {
      return res.status(403).json({ success: false, error: "Esta marca no te está compartida" });
    }
    // Comas/paréntesis fuera: romperían el filtro or() de PostgREST.
    const q = String(req.query.q || "").trim().replace(/[,()%]/g, " ").slice(0, 60);
    const attempt = async (withNew: boolean) => {
      let query = sb.from("crm_contacts").select(portalContactCols(withNew))
        .eq("workspace_id", workspaceId).eq("brand_id", req.params.brandId)
        .order("updated_at", { ascending: false }).limit(200);
      if (q) query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`);
      const { data, error } = await query;
      return error && withNew ? null : { data, error };
    };
    const result = (await attempt(true)) ?? (await attempt(false));
    if (result && result.error) throw result.error;
    return res.json({ success: true, data: { contacts: (result && result.data) || [] } });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || "CRM contacts failed" });
  }
});

// GET /api/brand-portal/:brandId/crm/contacts/:contactId?workspaceId= — ficha
// fija + timeline. El contacto tiene que pertenecer a ESA marca (sin sondar
// ids de otras) y el timeline excluye interacciones atadas a deals: ahí viven
// valores y negociación de la agencia.
portalRoutes.get("/:brandId/crm/contacts/:contactId", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    if (!sb || !req.auth) return res.status(503).json({ success: false, error: "Supabase not configured" });
    const workspaceId = await resolveWorkspaceId(sb, req.auth, req);
    if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
    const access = await accessFor(sb, req.auth, workspaceId);
    if (access.kind === "none") return res.status(403).json({ success: false, error: "You do not have access to this workspace" });
    if (access.kind === "guest" && !access.brandIds.includes(req.params.brandId)) {
      return res.status(403).json({ success: false, error: "Esta marca no te está compartida" });
    }
    const attempt = async (withNew: boolean) => {
      const { data, error } = await sb.from("crm_contacts").select(portalContactCols(withNew))
        .eq("workspace_id", workspaceId).eq("brand_id", req.params.brandId)
        .eq("id", req.params.contactId).maybeSingle();
      return error && withNew ? null : { data, error };
    };
    const result = (await attempt(true)) ?? (await attempt(false));
    if (result && result.error) throw result.error;
    if (!result || !result.data) return res.status(404).json({ success: false, error: "Contacto no encontrado" });
    const attemptTimeline = async (withDeal: boolean) => {
      let query = sb.from("crm_interactions")
        .select("id, interaction_type, notes, interaction_date, data")
        .eq("workspace_id", workspaceId).eq("contact_id", req.params.contactId)
        .order("interaction_date", { ascending: false }).limit(100);
      // Gracia con bases pre-v48: sin columna deal_id el filtro cae.
      if (withDeal) query = query.is("deal_id", null);
      const { data, error } = await query;
      return error && withDeal ? null : { data, error };
    };
    const timeline = (await attemptTimeline(true)) ?? (await attemptTimeline(false));
    if (timeline && timeline.error) throw timeline.error;
    return res.json({ success: true, data: { contact: result.data, timeline: (timeline && timeline.data) || [] } });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || "CRM contact failed" });
  }
});

// PUT /api/brand-portal/:brandId { workspaceId, displayName?, logoUrl?,
// accentColor?, welcomeMd?, sections?, enabled? } — personalización (admin).
portalRoutes.put("/:brandId", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    if (!sb || !req.auth) return res.status(503).json({ success: false, error: "Supabase not configured" });
    const workspaceId = await resolveWorkspaceId(sb, req.auth, req);
    if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
    const access = await accessFor(sb, req.auth, workspaceId);
    if (access.kind !== "member" || !hasMinimumWorkspaceRole(access.role, "admin")) {
      return res.status(403).json({ success: false, error: "Solo un admin puede editar el portal" });
    }
    const brand = await brandById(sb, workspaceId, req.params.brandId);
    if (!brand) return res.status(404).json({ success: false, error: "Marca no encontrada" });

    const patch: Record<string, unknown> = { workspace_id: workspaceId, brand_id: req.params.brandId };
    if (req.body?.displayName !== undefined) patch.display_name = clampText(req.body.displayName, 80) || null;
    if (req.body?.logoUrl !== undefined) patch.logo_url = clampText(req.body.logoUrl, 1000) || null;
    if (req.body?.accentColor !== undefined) patch.accent_color = clampText(req.body.accentColor, 9) || null;
    if (req.body?.welcomeMd !== undefined) patch.welcome_md = clampText(req.body.welcomeMd, 5000) || null;
    if (req.body?.sections !== undefined) patch.sections = sanitizeSections(req.body.sections);
    if (req.body?.enabled !== undefined) patch.enabled = Boolean(req.body.enabled);
    if (req.auth.authType === "user") patch.created_by = req.auth.userId;

    const { data: portal, error } = await sb.from("brand_portal").upsert(patch, { onConflict: "workspace_id,brand_id" }).select().single();
    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.json({ success: true, data: portal });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || "Portal save failed" });
  }
});

// ═══ /api/comments — comentarios de contenido (cualquier entidad compartida) ═══
// Complementa /api/comments-share (pins del editor /c/:id): aquí el hilo es
// por ENTIDAD (diseño, video, toma, brief…) y abierto a invitados-cliente.

function commentAuthorName(name: unknown, email: string | null, fallback: string): string {
  const clean = clampText(name, 60);
  if (clean) return clean;
  return nameFromEmail(email) || fallback;
}

// GET /api/comments?workspaceId=&entityType=&entityId=
contentCommentRoutes.get("/", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    if (!sb || !req.auth) return res.status(503).json({ success: false, error: "Supabase not configured" });
    const workspaceId = await resolveWorkspaceId(sb, req.auth, req);
    if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
    const entityType = clampText(req.query.entityType, 60);
    const entityId = clampText(req.query.entityId, 120);
    if (!entityType || !entityId) return res.status(400).json({ success: false, error: "entityType and entityId are required" });

    const access = await accessFor(sb, req.auth, workspaceId);
    if (access.kind === "none") return res.status(403).json({ success: false, error: "You do not have access to this workspace" });

    let query = sb.from("content_comments")
      .select("id, entity_type, entity_id, brand_id, body, author_name, author_role, parent_id, resolved, created_at")
      .eq("workspace_id", workspaceId).eq("entity_type", entityType).eq("entity_id", entityId)
      .order("created_at", { ascending: true }).limit(300);
    if (access.kind === "guest") {
      if (!(await guestCanSeeEntity(sb, access, entityType, entityId))) {
        return res.status(403).json({ success: false, error: "Esta pieza no te está compartida" });
      }
      query = query.or(`brand_id.in.(${access.brandIds.join(",")}),author_user_id.eq.${req.auth.userId}`);
    }
    const { data: comments, error } = await query;
    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.json({ success: true, data: comments || [], total: (comments || []).length });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || "Comments load failed" });
  }
});

// POST /api/comments { workspaceId, entityType, entityId, brandId?, body,
// parentId?, authorName? } — miembro editor+ comenta cualquier entidad;
// invitado-cliente solo entidades compartidas de su marca (author_role client).
contentCommentRoutes.post("/", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    if (!sb || !req.auth) return res.status(503).json({ success: false, error: "Supabase not configured" });
    const workspaceId = await resolveWorkspaceId(sb, req.auth, req);
    if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
    const entityType = clampText(req.body?.entityType, 60);
    const entityId = clampText(req.body?.entityId, 120);
    const body = clampText(req.body?.body, COMMENT_MAX);
    if (!entityType || !entityId) return res.status(400).json({ success: false, error: "entityType and entityId are required" });
    if (!body) return res.status(400).json({ success: false, error: `El comentario debe tener entre 1 y ${COMMENT_MAX} caracteres.` });

    const access = await accessFor(sb, req.auth, workspaceId);
    if (access.kind === "none") return res.status(403).json({ success: false, error: "You do not have access to this workspace" });

    const email = await userEmail(sb, req.auth);
    const row: Record<string, unknown> = {
      workspace_id: workspaceId,
      entity_type: entityType,
      entity_id: entityId,
      body,
      author_user_id: req.auth.userId,
      author_name: commentAuthorName(req.body?.authorName, email, access.kind === "guest" ? "Cliente" : "Miembro"),
      author_role: access.kind === "guest" ? "client" : "member",
    };

    if (access.kind === "guest") {
      const { brand } = await guestEntityBrand(sb, entityType, entityId);
      if (!brand || !access.brandIds.includes(brand)) {
        return res.status(403).json({ success: false, error: "Esta pieza no te está compartida" });
      }
      row.brand_id = brand;
    } else if (clampText(req.body?.brandId, 120)) {
      row.brand_id = clampText(req.body.brandId, 120);
    }

    const parentId = clampText(req.body?.parentId, 80);
    if (parentId) {
      const { data: parent } = await sb.from("content_comments").select("workspace_id, entity_type, entity_id")
        .eq("id", parentId).maybeSingle();
      if (!parent || (parent as any).workspace_id !== workspaceId || (parent as any).entity_type !== entityType || (parent as any).entity_id !== entityId) {
        return res.status(400).json({ success: false, error: "El comentario padre no pertenece a esta pieza" });
      }
      row.parent_id = parentId;
    }

    const { data: comment, error } = await sb.from("content_comments").insert(row).select().single();
    if (error) return res.status(500).json({ success: false, error: "Comment insert failed: " + error.message });
    return res.status(201).json({ success: true, data: comment });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || "Comment failed" });
  }
});

// PATCH /api/comments/:id { resolved } — quien lo escribió o un admin.
contentCommentRoutes.patch("/:id", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    if (!sb || !req.auth) return res.status(503).json({ success: false, error: "Supabase not configured" });
    const { data: existing } = await sb.from("content_comments").select("id, workspace_id, author_user_id").eq("id", req.params.id).maybeSingle();
    if (!existing) return res.status(404).json({ success: false, error: "Comentario no encontrado" });

    const access = await accessFor(sb, req.auth, (existing as any).workspace_id);
    const isAuthor = (existing as any).author_user_id === req.auth.userId;
    const isAdmin = access.kind === "member" && hasMinimumWorkspaceRole(access.role, "admin");
    if (access.kind === "none" || (!isAuthor && !isAdmin)) {
      return res.status(403).json({ success: false, error: "Solo el autor o un admin puede resolver" });
    }

    const { data, error } = await sb.from("content_comments")
      .update({ resolved: Boolean(req.body?.resolved) })
      .eq("id", req.params.id).select().single();
    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.json({ success: true, data });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || "Comment update failed" });
  }
});
