// brain-ops.mjs — Segundo cerebro: cómo opera cada persona en Musa (migración 38).
//
// Todo pasa por el Worker: los datos de la web (/rest/v1), la API (/api) y el MCP (/mcp). Aquí se
// traduce cada acción a un evento legible (módulo, acción, ítem, marca, campos tocados) y se guarda
// en brain_events por persona, agrupando lo repetido (autoguardado) con un contador por tramo de
// tiempo. La web suma lo que el servidor no ve: qué pantallas abre, cuánto tiempo trabaja en cada
// una y qué botones usa (POST /api/brain/track). Con eso brain_operator arma el perfil de operación
// que leen las IAs, y brain_learn guarda lo que aprenden al coordinar con su humano.
//
// Nunca se guardan contenidos (textos, copys, archivos): solo nombres de ítems, campos tocados y
// valores cortos de estado (status, etapa, publicado, formato, canales, fecha).
import { getSupabaseAdmin } from "../../../api/src/services/supabase.js";

// ── vocabulario de módulos: las mismas pantallas de la maqueta (mod/sub) ──
export const MODULE_LABEL = {
  resumen: "Inicio · Resumen", "mi-trabajo": "Mi trabajo", cerebro: "Segundo cerebro", pendientes: "Pendientes",
  investigacion: "Investigación", calendario: "Calendario", contenidos: "Contenidos", briefs: "Briefs", playbooks: "Playbooks",
  marcas: "Marcas", disenos: "Diseños", plantillas: "Plantillas de marca", videos: "Video y motion", motion: "Motion", tomas: "Tomas",
  clones: "Clones IA", fotos: "Fotos", biblioteca: "Biblioteca", copys: "Copys", eventos: "Eventos", mailing: "Mailing",
  formularios: "Formularios", automatizaciones: "Automatizaciones", websites: "Websites", publicar: "Publicar en redes",
  bandeja: "Bandeja", comentarios: "Comentarios", campanas: "Campañas de ads", audiencias: "Audiencias de pauta",
  presupuesto: "Presupuesto de pauta", oportunidades: "Oportunidades", personas: "Personas", empresas: "Empresas",
  embudo: "Embudo", cotizaciones: "Cotizaciones", proyectos: "Proyectos", fees: "Fees y tarifario", loops: "Loops",
  agentes: "Agentes", "mis-agentes": "Agentes", chats: "Chats", computadoras: "Computadoras", tareas: "Tareas",
  skills: "Skills", reportes: "Reportes", embudos: "Embudos", ads: "Ads · pauta", areas: "Áreas", aprobaciones: "Aprobaciones",
  agencias: "Agencias externas", portal: "Portal del cliente", cuenta: "Cuenta", espacios: "Espacios y planes",
  integraciones: "Integraciones", equipo: "Equipo", conecta: "Conecta tu IA", apis: "API y webhooks", papelera: "Papelera",
  configuracion: "Configuración", novedades: "Novedades", mcp: "Herramientas IA",
};
const ROUTE_ALIAS = { "mis-agentes": "agentes", aprobar: "aprobaciones", copy: "copys" };

const TABLE_MODULE = {
  templates: "disenos", design_file_meta: "disenos", template_versions: "disenos", design_categories: "disenos", design_tags: "disenos",
  design_tag_aliases: "disenos", design_import_jobs: "disenos", custom_fonts: "disenos", components: "disenos", styles: "marcas", variables: "disenos",
  content_calendar: "calendario", briefs: "briefs", workspace_briefs: "briefs", workspace_playbooks: "playbooks",
  campaigns: "campanas", ad_campaigns: "campanas", ad_campaigns_ext: "campanas", ad_audiences: "audiencias", workspace_ad_accounts: "integraciones",
  workspace_events: "eventos", workspace_event_regs: "eventos", workspace_mailings: "mailing", workspace_email_sends: "mailing", workspace_email_settings: "integraciones",
  workspace_forms: "formularios", workspace_form_responses: "formularios", crm_quotes: "cotizaciones", crm_deals: "oportunidades",
  crm_deal_deliverables: "oportunidades", crm_contacts: "personas", crm_interactions: "personas", crm_signals: "personas",
  workspace_projects: "proyectos", workspace_project_tasks: "proyectos", workspace_fees: "fees", workspace_rates: "fees",
  musa_video_projects: "videos", musa_video_tracks: "videos", musa_video_segments: "videos", musa_video_materials: "videos",
  musa_video_takes: "tomas", musa_video_transcripts: "videos", musa_motion_specs: "motion", musa_scene_specs: "motion", workspace_take_scripts: "tomas",
  flows: "automatizaciones", flow_versions: "automatizaciones", flow_runs: "automatizaciones", flow_credentials: "automatizaciones",
  brain_notes: "cerebro", brands: "marcas", brand_guidelines: "marcas", brand_guests: "portal", brand_portal: "portal", content_comments: "comentarios",
  websites: "websites", website_pages: "websites", website_entries: "websites", website_collections: "websites", website_domains: "websites", website_refs: "websites",
  publish_jobs: "publicar", publish_targets: "publicar", publisher_accounts: "publicar", social_inbox: "bandeja",
  research_requests: "investigacion", research_items: "investigacion", research_sources: "investigacion",
  photo_documents: "fotos", photo_versions: "fotos", photo_compositions: "fotos", photo_catalog_items: "fotos",
  copy_recipes: "copys", recipes: "plantillas", workspace_skills: "skills", workspace_agents: "agentes", agent_skills: "agentes",
  agent_governance_rules: "agentes", agent_activity_log: "agentes", workspace_loops: "loops", workspace_approvals: "aprobaciones",
  workspace_areas: "areas", workspace_agencies: "agencias", workspace_clones: "clones", design_kanban_tasks: "tareas", kanban_board: "tareas",
  task_queue: "tareas", assets: "biblioteca", design_comments: "comentarios", comments: "comentarios",
  workspace_members: "equipo", workspace_invitations: "equipo", workspace_config: "configuracion", workspaces: "espacios",
  user_profiles: "cuenta", user_api_keys: "integraciones", user_provider_keys: "integraciones", workspace_api_keys: "apis",
  workspace_mcp_connections: "conecta", webhooks: "apis", onboarding_progress: "cuenta", chat_messages: "chats", subscriptions: "espacios",
};
// ruido o meta-datos: no dicen nada de cómo opera la persona
const SKIP_TABLES = new Set(["brain_events", "product_news_reads", "video_editor_state", "client_sessions", "ghost_presence", "section_locks",
  "mcp_token_calls", "harness_runtime_events", "workspace_usage", "render_logs", "workspace_move_rows", "workspace_move_patches"]);

const API_MODULE = {
  templates: "disenos", "design-imports": "disenos", "design-meta": "disenos", fonts: "disenos", "video-projects": "videos", videos: "videos",
  assets: "biblioteca", websites: "websites", publisher: "publicar", keys: "integraciones", workspaces: "espacios", billing: "espacios",
  brands: "marcas", "brand-guidelines": "marcas", styles: "marcas", flows: "automatizaciones", photos: "fotos", calendar: "calendario",
  "content-calendar": "calendario", crm: "personas", email: "mailing", mailing: "mailing", ads: "campanas", events: "eventos", forms: "formularios",
  research: "investigacion", social: "publicar", inbox: "bandeja", kanban: "tareas", brain: "cerebro", "brain-notes": "cerebro", skills: "skills",
  agents: "agentes", takes: "tomas", motion: "motion", comments: "comentarios", profile: "cuenta", account: "cuenta", moves: "espacios",
};
// /api/workspaces/:id/<sub>: el módulo lo dice el tercer tramo
const SUB_MODULE = { "api-keys": "conecta", "mcp-connections": "conecta", members: "equipo", invitations: "equipo", invites: "equipo", integrations: "integraciones", config: "configuracion", skills: "skills", agents: "agentes" };
const API_VERBS =/^(publish|unpublish|send|test|duplicate|upload|upload-file|export|import|convert|restore|render|share|merge|sync|connect|disconnect|apply|clone|move|approve|reject|schedule|cancel|retry|generate|deploy|rollback|activate|archive|invite|accept|redeem|checkout|refund|html|zip|url|batch|run|resume|refresh|rotate)$/;

// estados y valores cortos que sí sirven para saber cómo opera la persona
const VALUE_FIELDS = new Set(["status", "stage", "published", "kind", "visual_type", "channels", "scheduled_date", "network", "objective", "visibility",
  "enabled", "is_public", "priority", "format", "ratio", "mode", "category", "type", "interaction_type", "relationship_status", "provider", "role"]);

const UUIDISH = /^[0-9a-f-]{20,}$|^[a-z]+_[\w-]{6,}$/i;
const now = () => Date.now();
const bucket = (mins, t) => Math.floor((t || now()) / (mins * 60000));

export function jwtSub(authHeader) {
  const tok = String(authHeader || "").replace(/^Bearer\s+/i, "");
  const p = tok.split(".");
  if (p.length !== 3) return null;
  try {
    const json = JSON.parse(atob(p[1].replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(p[1].length / 4) * 4, "=")));
    return json && json.role === "authenticated" && /^[0-9a-f-]{36}$/i.test(json.sub || "") ? json.sub : null;
  } catch { return null; }
}

export function routeModule(route) {
  const m = String(route || "").replace(/^#/, "").split(/[/?]/);
  const sub = ROUTE_ALIAS[m[1]] || m[1] || m[0] || "";
  if (MODULE_LABEL[sub]) return sub;
  if (MODULE_LABEL[m[0]]) return m[0];
  return sub || "otro";
}

function pickName(r) {
  if (!r || typeof r !== "object") return null;
  const n = r.name || r.title || r.topic || r.subject || r.label || r.display_name || r.piece_name || r.filename
    || (r.first_name || r.last_name ? `${r.first_name || ""} ${r.last_name || ""}`.trim() : null) || r.number || r.path || r.email || null;
  return n ? String(n).slice(0, 200) : null;
}
function pickBrand(r) {
  if (!r || typeof r !== "object") return null;
  return r.brand_id || r.brandId || r.data?.brandId || r.content?.brand_id || r.schema?.brand_id || null;
}
function shortValues(obj) {
  const out = {};
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (!VALUE_FIELDS.has(k) || v == null) continue;
    if (typeof v === "string" && v.length <= 60) out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (Array.isArray(v) && v.length <= 12 && v.every((x) => typeof x === "string" && x.length <= 30)) out[k] = v;
  }
  return out;
}
function queryEq(search, key) {
  const v = new URLSearchParams(search).get(key);
  return v && v.startsWith("eq.") ? decodeURIComponent(v.slice(3)) : null;
}
function safeJson(text) { try { return text ? JSON.parse(text) : null; } catch { return null; } }

/** Evento a partir de una escritura a PostgREST (/rest/v1/<tabla>) que respondió bien. */
export function restEvent({ method, url, reqText, resText, user, ws, route, prefer }) {
  const parts = url.pathname.replace(/^\/rest\/v1\/?/, "").split("/");
  let table = parts[0];
  if (!table || SKIP_TABLES.has(table)) return null;
  if (table === "rpc") {
    const fn = parts[1] || "";
    if (!/save|create|update|delete|move|apply|redeem|set_|add|remove|publish|send|clone|restore|approve|invite|accept/.test(fn)) return null;
    return base({ user, ws: ws || safeJson(reqText)?.p_workspace_id || safeJson(reqText)?.ws, module: routeModule(route) || "otro", action: fn, entity_type: "rpc", route, meta: {}, dedupe: `rpc|${fn}|${bucket(10)}` });
  }
  const req = safeJson(reqText), res = safeJson(resText);
  const rows = Array.isArray(res) ? res : res && typeof res === "object" ? [res] : Array.isArray(req) ? req : req ? [req] : [];
  const row = rows[0] || {};
  const one = Array.isArray(req) ? req[0] : req;
  let action = method === "POST" ? (/merge-duplicates/.test(prefer || "") ? "guardar" : "crear") : method === "DELETE" ? "borrar" : "editar";
  if (method === "PATCH" && one && typeof one === "object") {
    if ("deleted_at" in one) action = one.deleted_at ? "papelera" : "restaurar";
    else if (one.published === true || one.status === "published" || one.status === "publicado") action = "publicar";
    else if ("status" in one || "stage" in one) action = "cambiar_estado";
  }
  const id = row.id != null ? String(row.id) : queryEq(url.search, "id");
  const workspace = row.workspace_id || one?.workspace_id || queryEq(url.search, "workspace_id") || ws;
  const fields = method === "PATCH" && one && typeof one === "object" ? Object.keys(one).filter((k) => k !== "updated_at").slice(0, 20) : undefined;
  const meta = { ...shortValues(one), ...(fields ? { campos: fields } : {}), ...(rows.length > 1 ? { filas: rows.length } : {}) };
  return base({
    user, ws: workspace, module: TABLE_MODULE[table] || routeModule(route), action, entity_type: table, entity_id: id,
    entity_name: pickName(row) || pickName(one), brand_id: pickBrand(row) || pickBrand(one), route, meta,
    dedupe: action === "editar" || action === "guardar" ? `rest|${user}|${table}|${id || "-"}|${action}|${bucket(30)}` : null,
  });
}

/** Evento a partir de una escritura a la API (/api/...) que respondió bien. */
export function apiEvent({ method, url, reqText, resText, user, ws, route }) {
  const seg = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  if (!seg.length || seg[0] === "brain" && seg[1] === "track") return null;
  const req = safeJson(reqText) || {}, res = safeJson(resText) || {};
  const data = res.data && typeof res.data === "object" ? res.data : res;
  const verb = [...seg].reverse().find((s) => API_VERBS.test(s));
  const action = verb || (method === "POST" ? "crear" : method === "DELETE" ? "borrar" : "editar");
  const idSeg = seg.slice(1).find((s) => UUIDISH.test(s) || /\d/.test(s) && s.length > 6);
  const workspace = req.workspaceId || req.workspace_id || data?.workspaceId || data?.workspace_id || new URLSearchParams(url.search).get("workspaceId")
    || (seg[0] === "workspaces" ? seg[1] : null) || ws;
  const fields = method !== "POST" && req && typeof req === "object" && !Array.isArray(req)
    ? Object.keys(req).filter((k) => !/^(workspaceId|html|css|data|thumbnail|frames|canvasObjects|content|body|image|file)$/.test(k)).slice(0, 20) : [];
  const meta = { ruta_api: "/" + seg.map((s) => (UUIDISH.test(s) || /\d/.test(s) && s.length > 6 ? ":id" : s)).join("/"), ...shortValues(req), ...(fields.length ? { campos: fields } : {}) };
  if (Array.isArray(req.frames)) meta.frames = req.frames.length;
  return base({
    user, ws: workspace, module: (seg[0] === "workspaces" && SUB_MODULE[seg[2]]) || API_MODULE[seg[0]] || routeModule(route), action, entity_type: seg[0], entity_id: idSeg || (data?.id != null ? String(data.id) : null),
    entity_name: pickName(data) || pickName(req), brand_id: req.brandId || pickBrand(data), route, meta,
    dedupe: action === "editar" ? `api|${user}|${seg[0]}|${idSeg || "-"}|${bucket(30)}` : null,
  });
}

// ── módulo de una herramienta MCP ──
const TOOL_MODULE = [
  [/^video_|_video_|^generate_.*video|takes/, "videos"], [/^motion_|^scene_|animation|expression|transition|particle/, "motion"], [/^flow_/, "automatizaciones"],
  [/^photo_|remove_background|segment_|optimize_image|separate_image/, "fotos"], [/^brain_|_note$|^read_note|^search_notes/, "cerebro"],
  [/quote/, "cotizaciones"], [/deal|deliverable/, "oportunidades"], [/crm_|contact|interaction/, "personas"], [/calendar|content_idea|^publish_content|update_content|delete_content|batch/, "calendario"],
  [/website/, "websites"], [/social|publisher/, "publicar"], [/inbox/, "bandeja"], [/^research_/, "investigacion"], [/^studio_|^harness_|task_queue|kanban/, "tareas"],
  [/mail|email/, "mailing"], [/event/, "eventos"], [/form/, "formularios"], [/brief/, "briefs"], [/playbook/, "playbooks"], [/ads_|_ads|campaign|audience/, "campanas"],
  [/skill/, "skills"], [/agent|governance/, "agentes"], [/project/, "proyectos"], [/fee|rate/, "fees"], [/approval/, "aprobaciones"], [/area|agenc/, "areas"],
  [/clone/, "clones"], [/brand|strategy|design_system|token|palette/, "marcas"], [/copy_recipe|copy/, "copys"], [/asset|upload|font/, "biblioteca"],
  [/workspace|api_key|invite|profile|onboarding|byok|webhook/, "configuracion"],
  [/template|frame|element|layer|html|css|shape|path|text|render|export|design|svg|icon|illustration|mask|gradient|paint|stroke|align|distribut|group|bezier|knife|scissors|deck|chart|carousel|vector|trace|import|tag|comment|version|snapshot/, "disenos"],
];
export function toolModule(name) { for (const [re, m] of TOOL_MODULE) if (re.test(name)) return m; return "mcp"; }
const READ_TOOL = /^(get|list|find|inspect|analyze|validate|compare|export|assemble|check|measure|preview|search|whoami|verify|query|diff|profile|resolve|lint|detect|text_metrics|match)_?|_check$|_status$|^brain_(vault|digest|operator|timeline)$/;
const ENTITY_KEYS = ["templateId", "projectId", "flowId", "dealId", "contactId", "quoteId", "briefId", "eventId", "formId", "mailingId", "websiteId", "cardId", "noteId", "brandId", "id", "frameId"];

/** Evento de una herramienta MCP (lo llama mcp.mjs al terminar cada tools/call). */
export function mcpEvent({ name, params, auth, ok, error, ms, result }) {
  // herramientas que reciben solo un id (get_template({ id })): el espacio sale de la respuesta
  const rs = result && typeof result === "object" ? result : {};
  const ws = params?.workspaceId || auth?.workspaceId || rs.workspaceId || rs.workspace_id || rs.data?.workspaceId || rs.data?.workspace_id || rs.template?.workspaceId;
  const user = /^[0-9a-f-]{36}$/i.test(String(auth?.userId || "")) ? auth.userId : null;
  if (!ws || !user) return null;
  const human = auth?.keyLabel === "browser"; // la propia web llamando herramientas con la sesión de la persona
  const read = READ_TOOL.test(name);
  // la web cargando datos por MCP no es una acción de la persona (sus escrituras sí lo son)
  if (human && read) return null;
  const key = ENTITY_KEYS.find((k) => params && typeof params[k] === "string" && params[k]);
  const entityId = key ? params[key] : (result && typeof result === "object" && (result.id || result.templateId)) || null;
  const r = result && typeof result === "object" ? result : {};
  return base({
    user, ws, actor: human ? "human" : "agent", channel: human ? "web" : "mcp", agent: human ? null : String(auth?.keyLabel || auth?.authType || "IA").slice(0, 120),
    module: toolModule(name), action: name, entity_type: key ? key.replace(/Id$/, "") : null, entity_id: entityId ? String(entityId) : null,
    entity_name: pickName(r) || pickName(r.data) || (typeof params?.name === "string" ? params.name.slice(0, 200) : null) || (typeof params?.title === "string" ? params.title.slice(0, 200) : null),
    brand_id: params?.brandId || pickBrand(r), ok, error: error ? String(error).slice(0, 500) : null, duration_ms: Math.round(ms || 0),
    meta: { tool: name, lectura: read, args: Object.keys(params || {}).filter((k) => k !== "workspaceId").slice(0, 25) },
    dedupe: read ? `mcp|${user}|${name}|${ok ? 1 : 0}|${bucket(30)}` : `mcp|${user}|${name}|${entityId || "-"}|${ok ? 1 : 0}|${bucket(10)}`,
  });
}

function base(o) {
  if (!o.ws) return null;
  return {
    workspace_id: String(o.ws), user_id: o.user || null, actor: o.actor || "human", channel: o.channel || "web", agent: o.agent || null,
    module: o.module || "otro", action: o.action, entity_type: o.entity_type || null, entity_id: o.entity_id || null, entity_name: o.entity_name || null,
    brand_id: o.brand_id || null, route: o.route ? String(o.route).slice(0, 200) : null, ok: o.ok !== false, error: o.error || null,
    duration_ms: o.duration_ms ?? null, count: o.count || 1, meta: o.meta || {}, dedupe_key: o.dedupe ? `${o.ws}|${o.dedupe}` : null,
  };
}

/** Eventos que manda la web (pantallas, tiempo activo, botones). user ya verificado por el servidor. */
export function clientEvents(user, body) {
  const ws = body && body.workspaceId;
  if (!ws || !Array.isArray(body.events)) return [];
  const tz = Number(body.tz);
  return body.events.slice(0, 200).map((e) => {
    if (!e || typeof e !== "object") return null;
    const route = String(e.route || "").slice(0, 200);
    const module = routeModule(route);
    const at = Number(e.at) || now();
    if (e.t === "ver") {
      const ms = Math.max(0, Math.min(3600_000, Number(e.ms) || 0));
      const ent = (route.match(/(tpl:[\w-]+|vid:[\w-]+|e_[\w-]+)/) || [])[1] || null;
      return base({ user, ws, module, action: "ver", entity_type: ent ? "pantalla" : null, entity_id: ent, route: route.replace(/\?.*$/, ""), duration_ms: ms, meta: isFinite(tz) ? { tz } : {}, dedupe: `ver|${user}|${route.replace(/\?.*$/, "")}|${bucket(60, at)}` });
    }
    if (e.t === "clic") {
      const label = String(e.label || "").replace(/\s+/g, " ").trim().slice(0, 60);
      if (!label) return null;
      return base({ user, ws, module, action: "clic", entity_name: label, route: route.replace(/\?.*$/, ""), meta: {}, dedupe: `clic|${user}|${module}|${label}|${bucket(60, at)}` });
    }
    if (e.t === "accion" && e.action) {
      return base({ user, ws, module: e.module && MODULE_LABEL[e.module] ? e.module : module, action: String(e.action).slice(0, 80), entity_type: e.entity_type || null, entity_id: e.entity_id ? String(e.entity_id) : null, entity_name: e.entity_name ? String(e.entity_name).slice(0, 200) : null, route, meta: shortValues(e.meta || {}), dedupe: `acc|${user}|${e.action}|${e.entity_id || "-"}|${bucket(10, at)}` });
    }
    return null;
  }).filter(Boolean);
}

/** Guarda eventos con la llave de servicio (fetch directo: sirve en worker/index.js y en mcp.mjs). */
export async function saveEvents(env, events) {
  const list = (events || []).filter(Boolean);
  if (!list.length) return 0;
  const sbBase = String(env?.SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const sk = env?.SUPABASE_SECRET_KEY || env?.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!sbBase || !sk) return 0;
  // dos eventos con la misma dedupe_key en un mismo lote rompen el ON CONFLICT: se suman antes
  const seen = new Map(), out = [];
  for (const e of list) {
    if (e.dedupe_key && seen.has(e.dedupe_key)) { const p = seen.get(e.dedupe_key); p.count += e.count || 1; if (e.duration_ms != null) p.duration_ms = (p.duration_ms || 0) + e.duration_ms; continue; }
    if (e.dedupe_key) seen.set(e.dedupe_key, e);
    out.push(e);
  }
  try {
    const r = await fetch(`${sbBase}/rest/v1/rpc/brain_track`, {
      method: "POST", headers: { apikey: sk, Authorization: `Bearer ${sk}`, "Content-Type": "application/json" }, body: JSON.stringify({ evs: out }),
    });
    return r.ok ? Number(await r.text()) || 0 : 0;
  } catch { return 0; }
}

// ════════════════════ perfil de operación ════════════════════

const WEEKDAY = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const ACTION_LABEL = { ver: "abrir pantallas", clic: "botones", crear: "crear", editar: "editar", guardar: "guardar", borrar: "borrar", papelera: "mandar a la papelera",
  restaurar: "restaurar", publicar: "publicar", cambiar_estado: "cambiar estados", aprender: "aprendizajes",
  brain_learn: "guardar aprendizajes", brain_note_save: "guardar notas" };
const label = (m) => MODULE_LABEL[m] || m;
const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
const inc = (o, k, v) => { o[k] = (o[k] || 0) + (v == null ? 1 : v); };

async function loadEvents(sb, ws, userId, days, limit) {
  const since = new Date(now() - days * 864e5).toISOString();
  const { data } = await sb.from("brain_events").select("*").eq("workspace_id", ws).eq("user_id", userId).gte("last_at", since)
    .order("created_at", { ascending: true }).limit(limit);
  return data || [];
}

export function learningSlug(userId) { return `aprendizajes-${String(userId).replace(/-/g, "").slice(0, 12)}`; }

export async function operatorProfile(sb, ws, userId, opts = {}) {
  const days = Math.min(180, Math.max(1, Number(opts.days) || 30));
  const [ev, { data: prof }, { data: brands }, { data: learn }] = await Promise.all([
    loadEvents(sb, ws, userId, days, 5000),
    sb.from("user_profiles").select("display_name,first_name,last_name,email").eq("id", userId).maybeSingle(),
    sb.from("brands").select("id,name").eq("workspace_id", ws).limit(300),
    sb.from("brain_notes").select("id,body_md,updated_at").eq("workspace_id", ws).eq("slug", learningSlug(userId)).maybeSingle(),
  ]);
  const name = (prof && (prof.display_name || [prof.first_name, prof.last_name].filter(Boolean).join(" ") || (prof.email || "").split("@")[0])) || "esta persona";
  const bname = Object.fromEntries((brands || []).map((b) => [b.id, b.name]));
  const tzs = {}; ev.forEach((e) => { if (e.meta && typeof e.meta.tz === "number") inc(tzs, e.meta.tz); });
  const tz = Number((top(tzs, 1)[0] || [-300])[0]); // minutos respecto de UTC (default Lima)
  const local = (iso) => new Date(new Date(iso).getTime() + tz * 60000);

  const human = ev.filter((e) => e.actor === "human"), agent = ev.filter((e) => e.actor === "agent");
  const days_ = new Set(), hours = Array(24).fill(0), wd = Array(7).fill(0);
  const mods = {}, modMin = {}, actions = {}, brandsUse = {}, entities = {}, clicks = {}, routes = {};
  for (const e of human) {
    const d = local(e.created_at); days_.add(d.toISOString().slice(0, 10)); hours[d.getUTCHours()] += e.count; wd[d.getUTCDay()] += e.count;
    if (e.action === "ver") { inc(modMin, e.module, (e.duration_ms || 0) / 60000); inc(routes, e.route || e.module, (e.duration_ms || 0) / 60000); continue; }
    if (e.action === "clic") { inc(clicks, `${label(e.module)} › ${e.entity_name}`, e.count); continue; }
    inc(mods, e.module, e.count); inc(actions, e.action, e.count);
    if (e.brand_id) inc(brandsUse, e.brand_id, e.count);
    if (e.entity_id && e.entity_name) inc(entities, `${e.module}|${e.entity_name}`, e.count);
  }
  // flujo: pasos entre módulos dentro de una misma sesión (pausa < 30 min)
  const trans = {}; let prev = null;
  for (const e of human) {
    const t = new Date(e.created_at).getTime();
    if (prev && t - prev.t < 30 * 60000 && prev.m !== e.module) inc(trans, `${label(prev.m)} → ${label(e.module)}`);
    prev = { m: e.module, t };
  }
  // sesiones
  let sessions = 0, last = 0; for (const e of human) { const t = new Date(e.created_at).getTime(); if (t - last > 30 * 60000) sessions++; last = Math.max(last, new Date(e.last_at).getTime()); }
  // IA: herramientas, errores, correcciones humanas después de una escritura de la IA
  const tools = {}, agents = {}, errs = {}, agentWrites = new Map();
  for (const e of agent) {
    inc(tools, e.action, e.count); if (e.agent) inc(agents, e.agent, e.count);
    if (!e.ok) { const k = `${e.action}: ${(e.error || "error").slice(0, 140)}`; inc(errs, k, e.count); }
    else if (!e.meta?.lectura && e.entity_id) agentWrites.set(e.entity_id, e);
  }
  const corrections = [];
  for (const e of human) {
    if (!e.entity_id || !/editar|guardar|cambiar_estado|borrar|papelera/.test(e.action)) continue;
    const a = agentWrites.get(e.entity_id) || agentWrites.get(String(e.entity_id).replace(/^tpl:/, ""));
    if (!a) continue;
    const gap = (new Date(e.created_at).getTime() - new Date(a.last_at).getTime()) / 60000;
    if (gap < 0 || gap > 24 * 60) continue;
    corrections.push({ item: e.entity_name || a.entity_name || e.entity_id, modulo: label(e.module), herramienta_ia: a.action, agente: a.agent, accion_humana: e.action, minutos_despues: Math.round(gap), campos: e.meta?.campos || [] });
    agentWrites.delete(a.entity_id);
  }
  const learnings = String(learn?.body_md || "").split("\n").filter((l) => /^- /.test(l)).map((l) => l.slice(2)).slice(-60);
  const minutes = Math.round(Object.values(modMin).reduce((s, x) => s + x, 0));
  const hourTop = hours.map((v, h) => [h, v]).filter((x) => x[1]).sort((a, b) => b[1] - a[1]).slice(0, 3).map((x) => `${x[0]}:00`);
  const wdTop = wd.map((v, i) => [i, v]).filter((x) => x[1]).sort((a, b) => b[1] - a[1]).slice(0, 3).map((x) => WEEKDAY[x[0]]);
  const sum = (arr) => arr.reduce((s, e) => s + (e.count || 1), 0);

  const profile = {
    persona: { id: userId, nombre: name }, espacio: ws, periodo_dias: days, zona_horaria_min: tz,
    resumen: { dias_activos: days_.size, sesiones: sessions, minutos_activos: minutes, acciones_humanas: sum(human.filter((e) => e.action !== "ver" && e.action !== "clic")), acciones_ia: sum(agent), primera: ev[0]?.created_at || null, ultima: ev.length ? ev[ev.length - 1].last_at : null },
    modulos: Object.keys({ ...mods, ...modMin }).map((m) => ({ modulo: m, nombre: label(m), acciones: mods[m] || 0, minutos: Math.round(modMin[m] || 0) })).sort((a, b) => b.minutos + b.acciones * 2 - (a.minutos + a.acciones * 2)).slice(0, 20),
    pantallas: top(routes, 10).map(([r, v]) => ({ pantalla: r, minutos: Math.round(v) })),
    horario: { horas_pico: hourTop, dias_pico: wdTop, por_hora: hours, por_dia: Object.fromEntries(WEEKDAY.map((d, i) => [d, wd[i]])) },
    acciones: top(actions, 15).map(([a, v]) => ({ accion: ACTION_LABEL[a] || a, veces: v })),
    marcas: top(brandsUse, 10).map(([b, v]) => ({ id: b, nombre: bname[b] || b, acciones: v })),
    items_frecuentes: top(entities, 15).map(([k, v]) => { const [m, n] = k.split("|"); return { modulo: label(m), item: n, veces: v }; }),
    flujo_tipico: top(trans, 10).map(([t, v]) => ({ paso: t, veces: v })),
    botones: top(clicks, 15).map(([b, v]) => ({ boton: b, veces: v })),
    ia: { agentes: top(agents, 6).map(([a, v]) => ({ agente: a, llamadas: v })), herramientas: top(tools, 15).map(([t, v]) => ({ herramienta: t, llamadas: v })), errores: top(errs, 8).map(([e, v]) => ({ error: e, veces: v })) },
    correcciones_humanas: corrections.slice(-20).reverse(),
    aprendizajes: learnings,
  };
  profile.markdown = operatorMarkdown(profile);
  if (opts.timeline) profile.recientes = ev.slice(-Math.min(200, Number(opts.timeline) || 40)).reverse().map(compactEvent);
  return profile;
}

export function compactEvent(e) {
  return { cuando: e.last_at || e.created_at, quien: e.actor === "agent" ? (e.agent || "IA") : "persona", modulo: label(e.module), accion: e.action, item: e.entity_name || e.entity_id || null,
    marca: e.brand_id || null, veces: e.count,
    ...(e.action === "ver" ? { minutos: Math.round((e.duration_ms || 0) / 6000) / 10 } : e.duration_ms ? { ms: e.duration_ms } : {}), ...(e.ok === false ? { error: e.error } : {}),
    ...(e.meta?.campos ? { campos: e.meta.campos } : {}), ...(e.meta?.status ? { estado: e.meta.status } : {}) };
}

function operatorMarkdown(p) {
  const L = [];
  const r = p.resumen;
  L.push(`# Cómo opera ${p.persona.nombre}`, "", `Últimos ${p.periodo_dias} días en este espacio: ${r.dias_activos} días activos, ${r.sesiones} sesiones, ${r.minutos_activos} min de trabajo en pantalla, ${r.acciones_humanas} acciones propias y ${r.acciones_ia} hechas por su IA.`);
  if (p.horario.horas_pico.length) L.push(`Trabaja sobre todo a las ${p.horario.horas_pico.join(", ")} y los ${p.horario.dias_pico.join(", ")}.`);
  if (p.modulos.length) L.push("", "## Dónde trabaja", ...p.modulos.slice(0, 10).map((m) => `- ${m.nombre}: ${m.minutos} min, ${m.acciones} acciones`));
  if (p.marcas.length) L.push("", "## Marcas en las que más trabaja", ...p.marcas.map((m) => `- [[${m.nombre}]] (${m.acciones})`));
  if (p.flujo_tipico.length) L.push("", "## Flujo típico", ...p.flujo_tipico.slice(0, 6).map((f) => `- ${f.paso} (${f.veces})`));
  if (p.items_frecuentes.length) L.push("", "## Lo que más toca", ...p.items_frecuentes.slice(0, 8).map((i) => `- [[${i.item}]] · ${i.modulo} (${i.veces})`));
  if (p.botones.length) L.push("", "## Botones que más usa", ...p.botones.slice(0, 8).map((b) => `- ${b.boton} (${b.veces})`));
  if (p.ia.herramientas.length) L.push("", "## Lo que le pide a su IA", ...p.ia.herramientas.slice(0, 8).map((t) => `- ${t.herramienta} (${t.llamadas})`));
  if (p.ia.errores.length) L.push("", "## Dónde falló la IA", ...p.ia.errores.map((e) => `- ${e.error} (${e.veces})`));
  if (p.correcciones_humanas.length) L.push("", "## Lo que corrigió después de su IA", ...p.correcciones_humanas.slice(0, 8).map((c) => `- ${c.item} (${c.modulo}): la IA usó ${c.herramienta_ia} y ${c.minutos_despues} min después la persona hizo «${c.accion_humana}»${c.campos.length ? " en " + c.campos.join(", ") : ""}`));
  if (p.aprendizajes.length) L.push("", "## Aprendizajes guardados", ...p.aprendizajes.slice(-15).map((a) => `- ${a}`));
  return L.join("\n");
}

// ════════════════════ herramientas MCP ════════════════════

export const BRAIN_OPS_TOOLS = [
  {
    name: "brain_operator",
    description: "Musa v2 · Segundo cerebro · CÓMO OPERA TU HUMANO en este espacio: en qué módulos y pantallas trabaja (minutos y acciones), horario y días pico, marcas e ítems que más toca, su flujo típico entre módulos, los botones que más usa, qué herramientas te pide a ti (la IA) y dónde fallaste, lo que corrigió a mano después de tu trabajo (correcciones_humanas) y los aprendizajes guardados con brain_learn. Léelo al empezar a coordinar con la persona y antes de proponer cómo hacer algo. Incluye `markdown` listo para leer. timeline: N trae además los últimos N eventos.",
    inputSchema: { type: "object", properties: {
      workspaceId: { type: "string" }, days: { type: "number", description: "Ventana en días (default 30, máx 180)" },
      timeline: { type: "number", description: "Últimos N eventos además del perfil (máx 200)" },
    }, required: ["workspaceId"] },
  },
  {
    name: "brain_timeline",
    description: "Musa v2 · Segundo cerebro · Línea de tiempo de lo que pasó en el espacio para tu humano: cada acción (ver pantalla, crear, editar, publicar, borrar, botones, herramientas de IA) con módulo, ítem, marca, campos tocados, quién lo hizo (persona o IA) y cuántas veces. Filtra por módulo, ítem (entityId), marca, quién (persona | ia) o desde (ISO). Úsalo para saber qué hizo la persona desde tu última sesión o el historial de un ítem.",
    inputSchema: { type: "object", properties: {
      workspaceId: { type: "string" }, module: { type: "string", description: "disenos, calendario, websites, publicar, personas…" }, entityId: { type: "string" },
      brandId: { type: "string" }, who: { type: "string", enum: ["persona", "ia"] }, since: { type: "string", description: "ISO 8601" }, limit: { type: "number", description: "default 100, máx 500" },
    }, required: ["workspaceId"] },
  },
  {
    name: "brain_learn",
    description: "Musa v2 · Segundo cerebro · Guarda un APRENDIZAJE sobre cómo trabajar con tu humano, para que tú y las demás IAs del espacio lo usen la próxima vez: una preferencia («prefiere copys cortos sin emojis»), una corrección que hizo a tu trabajo, un paso de su proceso, algo que hay que evitar o contexto del negocio. Se suma a la nota «Aprendizajes · <persona>» del cerebro (la persona la ve y la puede editar) y aparece en brain_operator. Escribe una frase clara y accionable; no guardes datos sensibles.",
    inputSchema: { type: "object", properties: {
      workspaceId: { type: "string" }, lesson: { type: "string", description: "El aprendizaje, en una o dos frases" },
      kind: { type: "string", enum: ["preferencia", "correccion", "proceso", "evitar", "contexto"] },
      module: { type: "string", description: "Módulo al que aplica (disenos, calendario, copys…)" }, brandId: { type: "string" }, entityId: { type: "string" },
    }, required: ["workspaceId", "lesson"] },
  },
];
export const BRAIN_OPS_NAMES = new Set(BRAIN_OPS_TOOLS.map((t) => t.name));
export const BRAIN_OPS_READ = new Set(["brain_operator", "brain_timeline"]);

function requireUser(auth) {
  const uid = auth?.userId;
  if (!/^[0-9a-f-]{36}$/i.test(String(uid || ""))) throw { code: -32003, message: "Esta herramienta necesita la sesión de una persona (OAuth, llave personal o la web): el perfil es de quien opera." };
  return uid;
}

export async function handleBrainOps(name, params, auth) {
  const sb = getSupabaseAdmin();
  if (!sb) throw { code: -32603, message: "Supabase no está configurado" };
  const ws = String(params.workspaceId || "");
  const uid = requireUser(auth);

  if (name === "brain_operator") return operatorProfile(sb, ws, uid, { days: params.days, timeline: params.timeline });

  if (name === "brain_timeline") {
    let q = sb.from("brain_events").select("*").eq("workspace_id", ws).eq("user_id", uid).order("last_at", { ascending: false }).limit(Math.min(500, Math.max(1, Number(params.limit) || 100)));
    if (params.module) q = q.eq("module", String(params.module));
    if (params.entityId) q = q.eq("entity_id", String(params.entityId));
    if (params.brandId) q = q.eq("brand_id", String(params.brandId));
    if (params.who) q = q.eq("actor", params.who === "ia" ? "agent" : "human");
    if (params.since) q = q.gte("last_at", String(params.since));
    const { data, error } = await q;
    if (error) throw { code: -32000, message: error.message };
    return { espacio: ws, eventos: (data || []).map(compactEvent), total: (data || []).length };
  }

  if (name === "brain_learn") {
    const lesson = String(params.lesson || "").replace(/\s+/g, " ").trim().slice(0, 600);
    if (!lesson) throw { code: -32602, message: "Falta lesson" };
    const human = auth?.keyLabel === "browser";
    const who = human ? "la persona" : String(auth?.keyLabel || "IA").slice(0, 60);
    const { data: prof } = await sb.from("user_profiles").select("display_name,first_name,email").eq("id", uid).maybeSingle();
    const pname = (prof && (prof.display_name || prof.first_name || (prof.email || "").split("@")[0])) || "persona";
    const slug = learningSlug(uid);
    const { data: ex } = await sb.from("brain_notes").select("id,body_md").eq("workspace_id", ws).eq("slug", slug).maybeSingle();
    const tags = [params.kind, params.module && (MODULE_LABEL[params.module] || params.module)].filter(Boolean).map((t) => `[${t}]`).join(" ");
    let brandName = null;
    if (params.brandId) { const { data: b } = await sb.from("brands").select("name").eq("id", params.brandId).eq("workspace_id", ws).maybeSingle(); brandName = b?.name || null; }
    const line = `- ${new Date().toISOString().slice(0, 10)} ${tags ? tags + " " : ""}${lesson}${brandName ? ` · [[${brandName}]]` : ""} — ${who}`;
    const head = `# Aprendizajes · ${pname}\n\nLo que las IAs del espacio aprendieron trabajando con ${pname} (preferencias, correcciones, proceso, qué evitar). Las IAs lo leen con brain_operator; puedes editar o borrar cualquier línea.\n`;
    const body = ex ? `${String(ex.body_md || "").replace(/\s+$/, "")}\n${line}` : `${head}\n${line}`;
    const row = { workspace_id: ws, slug, title: `Aprendizajes · ${pname}`, body_md: body.slice(-100000), entity_type: "learning", entity_id: uid, source: "human", updated_at: new Date().toISOString() };
    const { data, error } = ex ? await sb.from("brain_notes").update(row).eq("id", ex.id).select("id").single() : await sb.from("brain_notes").insert(row).select("id").single();
    if (error) throw { code: -32000, message: error.message };
    return { id: data.id, guardado: line.slice(2), nota: row.title };
  }
  throw { code: -32601, message: `Unknown brain tool ${name}` };
}
