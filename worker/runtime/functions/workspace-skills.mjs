// Skills del espacio (migración 34): las crea una persona (o su IA) desde un flujograma; el conversor
// determinista public/musa/skillflow.js (el MISMO que usa el editor visual) genera la skill, sin IA.
// Visibilidad: 'private' (solo quien la creó) o 'workspace' (todo el equipo). Nunca clientes de una agencia.
import "../../../public/musa/skillflow.js";
import { getSupabaseAdmin } from "../../../api/src/services/supabase.js";
import { canAccessWorkspace, listAccessibleWorkspaceIds } from "../../../api/src/services/tenancy.js";

const SF = globalThis.SkillFlow;
const COLS = "id, workspace_id, name, slug, description, meta, visibility, version, tools, issues, created_by, updated_by, created_at, updated_at";
const err = (code, message) => ({ code, message });

function db() {
  const sb = getSupabaseAdmin();
  if (!sb) throw err(-32000, "Supabase no está configurado");
  return sb;
}
const uidOf = (auth) => (/^[0-9a-f-]{36}$/i.test(String(auth?.userId || "")) ? auth.userId : null);
/** Lo mismo que la política RLS: la ve quien la creó, o todo el equipo si está compartida. */
function canSee(auth, row) { return row.visibility === "workspace" || (uidOf(auth) && row.created_by === uidOf(auth)); }

async function wsIdsFor(auth, workspaceId) {
  const all = await listAccessibleWorkspaceIds(auth);
  if (workspaceId) {
    if (!all.includes(workspaceId) && !(await canAccessWorkspace(auth, workspaceId, "viewer"))) throw err(-32003, "Sin acceso a ese espacio");
    return [workspaceId];
  }
  return all;
}
async function wsNames(ids) {
  if (!ids.length) return {};
  const { data } = await db().from("workspaces").select("id, name").in("id", ids);
  const m = {};
  for (const w of data || []) m[w.id] = /^ws_user_/.test(w.id) && /^Workspace de /.test(w.name || "") ? "Espacio personal" : w.name;
  return m;
}

/** Skills del espacio visibles para quien pregunta (en todos sus espacios si no se indica uno). */
export async function listWorkspaceSkills(auth, workspaceId) {
  const ids = await wsIdsFor(auth, workspaceId);
  if (!ids.length) return [];
  const { data, error } = await db().from("workspace_skills").select(COLS).in("workspace_id", ids).is("deleted_at", null).order("updated_at", { ascending: false }).limit(500);
  if (error) throw err(-32000, error.message);
  const names = await wsNames(ids);
  return (data || []).filter((r) => canSee(auth, r)).map((r) => ({
    name: r.slug, id: r.id, title: r.name, description: r.description, source: "workspace",
    workspaceId: r.workspace_id, workspace: names[r.workspace_id] || r.workspace_id,
    shared: r.visibility === "workspace", version: r.version, updatedAt: r.updated_at,
    tools: (r.tools || []).length, ready: !(r.issues || []).some((i) => i.level === "error"),
  }));
}

/** Una skill del espacio por id o por su nombre corto (slug). */
export async function getWorkspaceSkill(auth, ref, workspaceId, toolDesc) {
  const ids = await wsIdsFor(auth, workspaceId);
  if (!ids.length) return null;
  let q = db().from("workspace_skills").select("*").in("workspace_id", ids).is("deleted_at", null);
  q = /^skl_/.test(String(ref)) ? q.eq("id", ref) : q.eq("slug", String(ref || "").toLowerCase());
  const { data } = await q.order("updated_at", { ascending: false }).limit(5);
  const row = (data || []).find((r) => canSee(auth, r));
  if (!row) return null;
  const names = await wsNames([row.workspace_id]);
  return {
    name: row.slug, id: row.id, title: row.name, source: "workspace", description: row.description,
    workspaceId: row.workspace_id, workspace: names[row.workspace_id] || row.workspace_id, shared: row.visibility === "workspace",
    version: row.version, updatedAt: row.updated_at, content: row.markdown, steps: row.steps,
    tools: (row.tools || []).map((n) => ({ name: n, description: String((toolDesc && toolDesc(n)) || "").replace(/\s+/g, " ").slice(0, 220) })),
    issues: row.issues || [],
  };
}

/** El flujograma editable (modelo + Mermaid) de una skill del espacio. */
export async function getSkillFlow(auth, ref, workspaceId) {
  const ids = await wsIdsFor(auth, workspaceId);
  let q = db().from("workspace_skills").select("*").in("workspace_id", ids).is("deleted_at", null);
  q = /^skl_/.test(String(ref)) ? q.eq("id", ref) : q.eq("slug", String(ref || "").toLowerCase());
  const { data } = await q.limit(5);
  const row = (data || []).find((r) => canSee(auth, r));
  if (!row) throw err(-32004, "Skill no encontrada en tus espacios");
  return { id: row.id, name: row.slug, title: row.name, workspaceId: row.workspace_id, shared: row.visibility === "workspace", version: row.version, mermaid: row.mermaid, graph: row.graph, meta: row.meta, issues: row.issues || [] };
}

/**
 * Crea o actualiza una skill desde Mermaid o desde el modelo (graph). Convierte con skillflow (sin IA),
 * valida (herramientas de Musa que existan, subprocesos a skills que existan) y guarda.
 * Se guarda aunque tenga errores (borrador): `ready` dice si está lista para usarse.
 */
export async function saveWorkspaceSkill(auth, input, toolSet, toolDesc) {
  const sb = db();
  const uid = uidOf(auth);
  let row = null;
  if (input.id) {
    const { data } = await sb.from("workspace_skills").select("*").eq("id", input.id).is("deleted_at", null).maybeSingle();
    if (!data || !canSee(auth, data)) throw err(-32004, "Skill no encontrada");
    row = data;
  }
  const ws = row ? row.workspace_id : String(input.workspaceId || "");
  if (!ws) throw err(-32602, "workspaceId es obligatorio para crear una skill (pregúntale a la persona en qué espacio va)");
  if (!(await canAccessWorkspace(auth, ws, "editor"))) throw err(-32003, "Necesitas ser editor en ese espacio");

  let g;
  if (typeof input.mermaid === "string" && input.mermaid.trim()) g = SF.parse(input.mermaid);
  else if (input.graph && typeof input.graph === "object") { g = Object.assign(SF.blank(), input.graph); g.nodes = g.nodes || []; g.edges = g.edges || []; SF.layout(g, true); }
  else if (row) g = Object.assign(SF.blank(), row.graph);
  else throw err(-32602, "Manda el flujograma en `mermaid` (o el modelo en `graph`)");
  g.meta = Object.assign(SF.blank().meta, row ? row.meta : {}, g.meta && Object.values(g.meta).some(Boolean) ? g.meta : {}, input.meta || {});
  if (!String(g.meta.name || "").trim()) throw err(-32602, "La skill necesita un nombre (meta.name)");

  const { data: siblings } = await sb.from("workspace_skills").select("slug").eq("workspace_id", ws).is("deleted_at", null);
  const known = {}; (siblings || []).forEach((s) => { known[s.slug] = 1; });
  const issues = SF.validate(g, { tools: toolSet, skills: known });
  let slug = row ? row.slug : SF.slugify(g.meta.name);
  if (!row) { let s = slug, i = 2; while (known[s]) s = `${slug}-${i++}`; slug = s; }
  const descMap = {}; g.nodes.forEach((n) => { if (n.tool && toolSet[n.tool]) descMap[n.tool] = toolDesc ? toolDesc(n.tool) : ""; });
  const sk = SF.toSkill(g, { slug, tools: descMap });
  const mermaid = SF.toMermaid(g);
  const vis = input.visibility === "workspace" || input.visibility === "private" ? input.visibility : row ? row.visibility : "private";
  const body = {
    workspace_id: ws, name: sk.name, slug, description: sk.description, meta: g.meta, graph: g, mermaid, markdown: sk.markdown,
    steps: sk.steps, tools: sk.tools, issues, visibility: vis, fingerprint: SF.fingerprint(mermaid), updated_by: uid,
  };
  let saved;
  if (row) {
    const { data, error } = await sb.from("workspace_skills").update(body).eq("id", row.id).select(COLS).single();
    if (error) throw err(-32000, error.message); saved = data;
  } else {
    const { data, error } = await sb.from("workspace_skills").insert({ ...body, created_by: uid }).select(COLS).single();
    if (error) throw err(-32000, error.message); saved = data;
  }
  return {
    id: saved.id, name: saved.slug, title: saved.name, workspaceId: saved.workspace_id, shared: saved.visibility === "workspace",
    version: saved.version, tools: saved.tools, ready: !issues.some((i) => i.level === "error"), issues,
  };
}

export async function deleteWorkspaceSkill(auth, id) {
  const sb = db();
  const { data: row } = await sb.from("workspace_skills").select("id, workspace_id, created_by, visibility").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!row || !canSee(auth, row)) throw err(-32004, "Skill no encontrada");
  const mine = uidOf(auth) && row.created_by === uidOf(auth);
  if (!mine && !(await canAccessWorkspace(auth, row.workspace_id, "admin"))) throw err(-32003, "Solo quien la creó o un admin del espacio puede borrarla");
  const { error } = await sb.from("workspace_skills").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) throw err(-32000, error.message);
  return { deleted: true, id };
}
