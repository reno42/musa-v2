/**
 * Mover cosas entre espacios (personal ↔ agencia ↔ agencia). Lo usan la pantalla (/api/workspace-move/*)
 * y el MCP (preview_move, move_items, undo_move, list_moves, list_move_targets) con el mismo código.
 *
 * El trabajo pesado (qué depende de qué, marcas, nombres repetidos, deshacer) vive en la base:
 * migración 32 (v2_move_preview / v2_move_apply / v2_move_undo), en una sola transacción.
 * Aquí solo se valida quién puede: editor en cada espacio de origen y en el destino.
 * Decisión del producto: cualquier editor puede sacar cosas de una agencia (p. ej. devolver a su
 * espacio personal algo que movió por error).
 */
import { getSupabaseAdmin } from "./supabase.js";
import { canAccessWorkspace, listAccessibleWorkspaceIds, getWorkspaceRole } from "./tenancy.js";
import type { RequestAuth } from "./requestContext.js";

export class MoveError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

/** Tipos que se pueden mover → tabla. Igual que v2__move_type_table en la base. */
export const MOVE_TYPES: Record<string, string> = {
  design: "templates", brand: "brands", piece: "content_calendar", video: "musa_video_projects", photo: "photo_documents",
  composition: "photo_compositions", asset: "assets", note: "brain_notes", flow: "flows", credential: "flow_credentials",
  contact: "crm_contacts", deal: "crm_deals", quote: "crm_quotes", task: "design_kanban_tasks", copy: "copy_recipes",
  recipe: "recipes", brief: "briefs", campaign: "campaigns", form: "workspace_forms", mailing: "workspace_mailings",
  event: "workspace_events", project: "workspace_projects", research: "research_sources", playbook: "workspace_playbooks",
  script: "workspace_take_scripts", take: "musa_video_takes", guideline: "brand_guidelines", audience: "ad_audiences", ad: "ad_campaigns",
};
const ALIASES: Record<string, string> = { template: "design", content: "piece", file: "asset" };

/** Nombres en castellano para los resúmenes. */
const TABLE_ES: Record<string, [string, string]> = {
  templates: ["diseño", "diseños"], template_versions: ["versión", "versiones"], design_file_meta: ["ficha de diseño", "fichas de diseño"],
  design_comments: ["comentario", "comentarios"], design_import_jobs: ["importación", "importaciones"], content_calendar: ["pieza", "piezas"],
  content_comments: ["comentario de pieza", "comentarios de piezas"], brands: ["marca", "marcas"], brand_guidelines: ["manual de marca", "manuales de marca"],
  brand_portal: ["portal de cliente", "portales de cliente"], brand_guests: ["acceso de cliente", "accesos de cliente"], campaigns: ["campaña", "campañas"],
  crm_contacts: ["contacto", "contactos"], crm_deals: ["oportunidad", "oportunidades"], crm_interactions: ["interacción", "interacciones"],
  crm_quotes: ["cotización", "cotizaciones"], crm_signals: ["señal", "señales"], crm_deal_deliverables: ["entregable", "entregables"],
  briefs: ["brief", "briefs"], ad_audiences: ["audiencia", "audiencias"], ad_campaigns: ["anuncio", "anuncios"], ad_campaigns_ext: ["anuncio externo", "anuncios externos"],
  workspace_events: ["evento", "eventos"], workspace_event_regs: ["inscripción", "inscripciones"], workspace_projects: ["proyecto", "proyectos"],
  workspace_project_tasks: ["tarea de proyecto", "tareas de proyecto"], workspace_take_scripts: ["guion", "guiones"], research_sources: ["fuente", "fuentes"],
  research_items: ["noticia", "noticias"], research_requests: ["pedido de investigación", "pedidos de investigación"], flows: ["flujo", "flujos"],
  flow_runs: ["ejecución", "ejecuciones"], flow_credentials: ["credencial", "credenciales"], copy_recipes: ["copy", "copys"], recipes: ["receta", "recetas"],
  musa_video_projects: ["video", "videos"], musa_motion_specs: ["animación", "animaciones"], musa_scene_specs: ["escena", "escenas"],
  musa_video_render_tickets: ["render", "renders"], musa_video_transcripts: ["transcripción", "transcripciones"], musa_video_takes: ["toma", "tomas"],
  design_kanban_tasks: ["tarea", "tareas"], publisher_accounts: ["cuenta de redes", "cuentas de redes"], workspace_fees: ["tarifa", "tarifas"],
  workspace_ad_accounts: ["cuenta de anuncios", "cuentas de anuncios"], workspace_clones: ["clon", "clones"], harness_cronjobs: ["tarea programada", "tareas programadas"],
  photo_documents: ["foto", "fotos"], photo_versions: ["versión de foto", "versiones de foto"], photo_compositions: ["composición", "composiciones"],
  photo_catalog_items: ["foto del catálogo", "fotos del catálogo"], assets: ["archivo", "archivos"], brain_notes: ["nota", "notas"],
  workspace_forms: ["formulario", "formularios"], workspace_form_responses: ["respuesta", "respuestas"], workspace_mailings: ["mailing", "mailings"],
  workspace_email_sends: ["envío de correo", "envíos de correo"], workspace_playbooks: ["playbook", "playbooks"],
};
export function tableLabel(t: string, n: number) {
  const x = TABLE_ES[t]; return x ? `${n} ${n === 1 ? x[0] : x[1]}` : `${n} ${t}`;
}

export type MoveItem = { type: string; id: string };
type BrandMode = "copy" | "unlink";

function db() {
  const sb = getSupabaseAdmin();
  if (!sb) throw new MoveError("Supabase no está configurado", 503);
  return sb;
}
function normItems(raw: unknown): MoveItem[] {
  if (!Array.isArray(raw) || !raw.length) throw new MoveError("Elige al menos una cosa para mover");
  if (raw.length > 200) throw new MoveError("Máximo 200 cosas por movimiento");
  const out: MoveItem[] = []; const seen = new Set<string>();
  for (const r of raw as any[]) {
    let type = String(r?.type || "").toLowerCase().trim(); type = ALIASES[type] || type;
    const id = String(r?.id || "").trim();
    if (!MOVE_TYPES[type]) throw new MoveError(`Tipo que no se puede mover: ${r?.type || "(vacío)"}. Tipos: ${Object.keys(MOVE_TYPES).join(", ")}`);
    if (!id) throw new MoveError("Falta el id de un elemento");
    const k = type + ":" + id; if (seen.has(k)) continue; seen.add(k);
    out.push({ type, id });
  }
  return out;
}
/** Espacio actual de cada elemento (antes de mirar nada más). */
async function sourcesOf(items: MoveItem[]) {
  const sb = db(); const byTable: Record<string, string[]> = {};
  for (const it of items) (byTable[MOVE_TYPES[it.type]] ||= []).push(it.id);
  const ws = new Map<string, string>();
  for (const [t, ids] of Object.entries(byTable)) {
    const { data, error } = await sb.from(t).select("id, workspace_id").in("id", ids);
    if (error) throw new MoveError(error.message, 500);
    for (const r of data || []) ws.set(t + ":" + r.id, String(r.workspace_id || ""));
  }
  const missing = items.filter((it) => !ws.get(MOVE_TYPES[it.type] + ":" + it.id));
  if (missing.length) throw new MoveError(`No encontré: ${missing.map((m) => `${m.type} ${m.id}`).join(", ")}`, 404);
  return [...new Set(items.map((it) => ws.get(MOVE_TYPES[it.type] + ":" + it.id)!))];
}
async function needEditor(auth: RequestAuth, wsIds: string[], what: string) {
  for (const w of wsIds) {
    if (auth.authType === "workspace_key" && auth.workspaceId && w !== auth.workspaceId) {
      throw new MoveError("Esta llave de API solo llega a su propio espacio. Para mover entre espacios, conecta Musa con tu cuenta (OAuth) o hazlo desde la pantalla", 403);
    }
    if (!(await canAccessWorkspace(auth, w, "editor"))) throw new MoveError(`Necesitas ser editor en ${what} para mover`, 403);
  }
}
function mapDbError(e: any): MoveError {
  const msg = String(e?.message || e || "Error").replace(/^.*?ERROR:\s*/s, "");
  const code = e?.code;
  return new MoveError(msg, code === "P0002" ? 404 : code === "22023" ? 400 : 400);
}

/** Espacios a los que la persona puede mover cosas (editor o más), con su tipo. */
export async function listTargets(auth: RequestAuth) {
  const ids = await listAccessibleWorkspaceIds(auth);
  if (!ids.length) return [];
  const { data } = await db().from("workspaces").select("id, name, data, owner_id").in("id", ids);
  const out = [];
  for (const w of data || []) {
    const role = await getWorkspaceRole(auth, w.id);
    const kind = (w.data as any)?.kind === "agency" ? "agency" : (/^ws_user_/.test(w.id) ? "personal" : ((w.data as any)?.kind || "personal"));
    out.push({ id: w.id, name: kind === "personal" && /^Workspace de /.test(w.name || "") ? "Mi espacio personal" : w.name, kind, role, canMoveHere: ["owner", "admin", "editor"].includes(String(role)) });
  }
  return out.sort((a, b) => (a.kind === b.kind ? String(a.name).localeCompare(String(b.name)) : a.kind === "personal" ? -1 : 1));
}

/** Resumen legible (lo que la IA o el diálogo le muestran a la persona antes de confirmar). */
function describe(pv: any, names: Record<string, string>) {
  const counts = pv.counts || {};
  const main = Object.entries(counts).sort((a: any, b: any) => b[1] - a[1]).map(([t, n]) => tableLabel(t, Number(n)));
  const brandNotes = (pv.brands || []).map((b: any) =>
    b.action === "match" ? `La marca «${b.name}» se enlaza con la que ya existe en el destino.`
      : b.action === "copy" ? `La marca «${b.name}» no está en el destino: se crea una copia allá.`
        : `Se quita el enlace con la marca «${b.name}».`);
  const skip = (pv.skipped || []).map((s: any) => `${s.label || s.id}: ${s.reason}`);
  return {
    to: names[pv.target] || pv.target,
    from: (pv.sources || []).map((s: string) => names[s] || s),
    items: (pv.roots || []).map((r: any) => ({ type: Object.keys(MOVE_TYPES).find((k) => MOVE_TYPES[k] === r.t) || r.t, id: r.id, name: r.label, from: names[r.ws] || r.ws })),
    total: pv.total, includes: main, brands: brandNotes, skipped: skip,
    alreadyThere: pv.already_there || 0,
  };
}
async function wsNames(ids: string[]) {
  if (!ids.length) return {};
  const { data } = await db().from("workspaces").select("id, name").in("id", ids);
  const m: Record<string, string> = {};
  for (const w of data || []) m[w.id] = /^ws_user_/.test(w.id) && /^Workspace de /.test(w.name || "") ? "Mi espacio personal" : w.name;
  return m;
}

export async function previewMove(auth: RequestAuth, rawItems: unknown, target: string, brandMode: BrandMode = "copy") {
  const items = normItems(rawItems);
  if (!target) throw new MoveError("Falta el espacio de destino");
  const sources = await sourcesOf(items);
  await needEditor(auth, sources, "el espacio de origen");
  await needEditor(auth, [target], "el espacio de destino");
  const { data, error } = await db().rpc("v2_move_preview", { p_items: items, p_target: target, p_brand_mode: brandMode });
  if (error) throw mapDbError(error);
  const names = await wsNames([target, ...sources]);
  return { ...describe(data, names), raw: data };
}

export async function applyMove(auth: RequestAuth, rawItems: unknown, target: string, brandMode: BrandMode = "copy") {
  const items = normItems(rawItems);
  if (!target) throw new MoveError("Falta el espacio de destino");
  const sources = await sourcesOf(items);
  await needEditor(auth, sources, "el espacio de origen");
  await needEditor(auth, [target], "el espacio de destino");
  const actor = /^[0-9a-f-]{36}$/i.test(auth.userId || "") ? auth.userId : null;
  const { data, error } = await db().rpc("v2_move_apply", { p_items: items, p_target: target, p_actor: actor, p_brand_mode: brandMode });
  if (error) throw mapDbError(error);
  const names = await wsNames([target, ...sources]);
  return { moveId: data.move_id, ...describe(data, names), renamed: data.renamed || 0, linksCleared: data.links_cleared || 0, brandsCreated: data.brands_created || 0 };
}

export async function undoMove(auth: RequestAuth, moveId: string) {
  const { data: mv } = await db().from("workspace_moves").select("*").eq("id", moveId).maybeSingle();
  if (!mv) throw new MoveError("Movimiento no encontrado", 404);
  await needEditor(auth, [mv.target_ws, ...(mv.source_ws || [])], "los espacios de ese movimiento");
  if (mv.undone_at) throw new MoveError("Ese movimiento ya se deshizo");
  if (Date.now() - new Date(mv.created_at).getTime() > 30 * 86400000) throw new MoveError("Ese movimiento tiene más de 30 días: muévelo de vuelta en vez de deshacerlo");
  const actor = /^[0-9a-f-]{36}$/i.test(auth.userId || "") ? auth.userId : null;
  const { data, error } = await db().rpc("v2_move_undo", { p_move: moveId, p_actor: actor });
  if (error) throw mapDbError(error);
  return { moveId, movedBack: data.moved_back, notRestored: data.not_restored };
}

/** Historial de movimientos que tocan un espacio (entraron o salieron). */
export async function listMoves(auth: RequestAuth, ws: string, limit = 20) {
  if (!(await canAccessWorkspace(auth, ws, "viewer"))) throw new MoveError("Sin acceso a este espacio", 403);
  const { data, error } = await db().from("workspace_moves").select("id, actor_id, target_ws, source_ws, roots, summary, created_at, undone_at")
    .or(`target_ws.eq.${ws.replace(/[^\w-]/g, "")},source_ws.cs.{${ws.replace(/[^\w-]/g, "")}}`).order("created_at", { ascending: false }).limit(Math.min(limit, 100));
  if (error) throw new MoveError(error.message, 500);
  const ids = new Set<string>(); (data || []).forEach((m: any) => { ids.add(m.target_ws); (m.source_ws || []).forEach((s: string) => ids.add(s)); });
  const names = await wsNames([...ids]);
  return (data || []).map((m: any) => ({
    id: m.id, at: m.created_at, undone: !!m.undone_at, by: m.actor_id,
    to: names[m.target_ws] || m.target_ws, from: (m.source_ws || []).map((s: string) => names[s] || s),
    items: (m.roots || []).map((r: any) => r.label || r.id), total: m.summary?.total || 0,
  }));
}

/** Cómo se lista cada tipo (columna de nombre y filtros de «no borrado»). */
const LIST_SPEC: Record<string, { label: string; filter?: (q: any) => any; name?: (r: any) => string }> = {
  design: { label: "name", filter: (q) => q.is("deleted_at", null).eq("is_brand_manual", false) },
  brand: { label: "name" },
  piece: { label: "topic" },
  video: { label: "name", filter: (q) => q.eq("is_template", false) },
  photo: { label: "source_url", name: (r) => decodeURIComponent(String(r.source_url || "").split("/").pop() || "Foto").slice(0, 80) },
  asset: { label: "name", filter: (q) => q.is("deleted_at", null) },
  note: { label: "title" },
  flow: { label: "name" },
  contact: { label: "first_name, last_name, email", name: (r) => [r.first_name, r.last_name].filter(Boolean).join(" ") || r.email || "Contacto" },
  deal: { label: "title" },
  quote: { label: "title" },
  task: { label: "title" },
  copy: { label: "name" },
  recipe: { label: "name", filter: (q) => q.is("deleted_at", null) },
  brief: { label: "title" },
  campaign: { label: "name" },
  form: { label: "name" },
  mailing: { label: "subject", name: (r) => r.subject || "Mailing" },
  event: { label: "name" },
  project: { label: "name" },
  research: { label: "name" },
  playbook: { label: "name" },
  script: { label: "title" },
  guideline: { label: "name", filter: (q) => q.is("deleted_at", null) },
  audience: { label: "name" },
  ad: { label: "name" },
};
export const LISTABLE_TYPES = Object.keys(LIST_SPEC);

/** Cosas de uno o varios espacios, con la etiqueta de su espacio (la vista «Todo» y el tablero para mover). */
export async function listItems(auth: RequestAuth, wsIdsIn: string[] | undefined, opts: { types?: string[]; query?: string; limit?: number } = {}) {
  const all = await listAccessibleWorkspaceIds(auth);
  const wsIds = (wsIdsIn && wsIdsIn.length ? wsIdsIn : all).filter((w) => all.includes(w));
  if (!wsIds.length) throw new MoveError("Sin acceso a esos espacios", 403);
  const types = (opts.types && opts.types.length ? opts.types : LISTABLE_TYPES).map((t) => ALIASES[t] || t).filter((t) => LIST_SPEC[t]);
  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 300);
  const needle = String(opts.query || "").trim().toLowerCase();
  const names = await wsNames(wsIds);
  const out: any[] = [];
  await Promise.all(types.map(async (type) => {
    const spec = LIST_SPEC[type];
    let q: any = db().from(MOVE_TYPES[type]).select(`id, workspace_id, ${spec.label}`).in("workspace_id", wsIds).limit(limit);
    if (spec.filter) q = spec.filter(q);
    const { data, error } = await q;
    if (error) return; // una tabla con otra forma no tumba la lista
    for (const r of data || []) {
      const name = spec.name ? spec.name(r) : String(r[spec.label] || "").trim() || "(sin nombre)";
      if (needle && !name.toLowerCase().includes(needle)) continue;
      out.push({ type, id: String(r.id), name, workspaceId: r.workspace_id, workspace: names[r.workspace_id] || r.workspace_id });
    }
  }));
  out.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type.localeCompare(b.type));
  return out;
}
