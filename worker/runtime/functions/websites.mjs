// Websites de Musa (migración 35): landings y sitios con CMS propio, SEO/GEO/AEO, dominios, GitHub y Supabase.
//  · Público: /w/:slug/* (dirección de Musa) y, cuando se active, subdominios y dominios propios vía un proxy
//    que reenvía con X-Musa-Host + X-Musa-Proxy-Key (SITES_PROXY_SECRET). Sin proxy no se sirve ningún host ajeno.
//  · El HTML sale de public/musa/siterender.js: el MISMO motor que la vista previa del editor.
//  · Páginas y tema se sirven desde la copia PUBLICADA (websites.published); el CMS (colecciones y entradas)
//    se lee en vivo: una entrada publicada aparece al instante, sin volver a publicar el sitio.
//  · Herramientas MCP (paridad humano ↔ IA): la pantalla llama las mismas funciones vía RB.mcp.
import "../../../public/musa/siterender.js";
import { getSupabaseAdmin } from "../../../api/src/services/supabase.js";
import { canAccessWorkspace, listAccessibleWorkspaceIds } from "../../../api/src/services/tenancy.js";
import { encrypt, decrypt } from "./keys.mjs";
import { submitPublicForm } from "./public-pages.mjs";

const SR = globalThis.SiteRender;
const err = (code, message) => ({ code, message });
const APP_ORIGIN = () => (process.env.APP_ORIGIN || "https://musa-v2.renzo-08c.workers.dev").replace(/\/$/, "");
const ROOT_DOMAIN = () => (process.env.SITES_ROOT_DOMAIN || "").toLowerCase().replace(/^\.+|\.+$/g, "");
const HOST_RX = /^(?=.{4,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

function db() { const sb = getSupabaseAdmin(); if (!sb) throw err(-32000, "Supabase no está configurado"); return sb; }
const uidOf = (auth) => (/^[0-9a-f-]{36}$/i.test(String(auth?.userId || "")) ? auth.userId : null);
function friendly(e) {
  const m = String(e?.message || e || "");
  const lim = m.match(/LIMIT_[A-Z]+:\s*(.*)$/);
  if (lim) return lim[1];
  if (/websites_slug_u/.test(m)) return "Esa dirección ya la usa otro website. Elige otra.";
  if (/website_pages_path_u/.test(m)) return "Ya hay una página con esa ruta en este website.";
  if (/website_collections_slug_u/.test(m)) return "Ya hay una colección con ese nombre corto.";
  if (/website_entries_slug_u/.test(m)) return "Ya hay una entrada con esa URL en la colección.";
  if (/website_domains_host_u/.test(m)) return "Ese dominio ya está conectado a un website.";
  return m || "Error";
}
function chk(res) { if (res.error) throw err(-32000, friendly(res.error)); return res.data; }

async function wsIds(auth, workspaceId, role = "viewer") {
  if (workspaceId) {
    if (!(await canAccessWorkspace(auth, workspaceId, role))) throw err(-32003, role === "viewer" ? "Sin acceso a ese espacio" : "Necesitas permiso de edición en ese espacio");
    return [workspaceId];
  }
  return listAccessibleWorkspaceIds(auth);
}
/** Website por id o slug, verificando el rol mínimo en su espacio. */
async function siteFor(auth, ref, role = "viewer") {
  if (!ref) throw err(-32602, "Falta el website (siteId)");
  let q = db().from("websites").select("*").is("deleted_at", null);
  q = /^web_/.test(String(ref)) ? q.eq("id", ref) : q.ilike("slug", String(ref));
  const row = chk(await q.maybeSingle());
  if (!row) throw err(-32004, "No existe ese website");
  if (!(await canAccessWorkspace(auth, row.workspace_id, role))) throw err(-32003, role === "viewer" ? "Sin acceso a ese website" : "Necesitas permiso de edición en el espacio de este website");
  return row;
}
async function limitsOf(ws) { const r = await db().rpc("v2_site_limits", { p_workspace: ws }); return r.data || { badge: true, custom_domains: 0 }; }
function siteUrls(site, domains) {
  const out = { musa: APP_ORIGIN() + "/w/" + site.slug + "/" };
  if (ROOT_DOMAIN()) out.subdomain = "https://" + site.slug + "." + ROOT_DOMAIN() + "/";
  const act = (domains || []).filter((d) => d.status === "active");
  const prim = act.find((d) => d.is_primary) || act[0];
  if (prim) out.domain = "https://" + prim.hostname + "/";
  out.live = out.domain || out.subdomain || out.musa;
  return out;
}

/* ═════════════════════════ lectura ═════════════════════════ */
export async function listWebsites(auth, workspaceId) {
  const ids = await wsIds(auth, workspaceId);
  if (!ids.length) return [];
  const rows = chk(await db().from("websites").select("id,workspace_id,name,slug,status,brand_id,published_at,version,updated_at").in("workspace_id", ids).is("deleted_at", null).order("updated_at", { ascending: false }).limit(200));
  const siteIds = rows.map((r) => r.id);
  const doms = siteIds.length ? chk(await db().from("website_domains").select("website_id,hostname,status,is_primary").in("website_id", siteIds)) : [];
  return rows.map((r) => ({ ...r, urls: siteUrls(r, doms.filter((d) => d.website_id === r.id)), domains: doms.filter((d) => d.website_id === r.id).map((d) => ({ hostname: d.hostname, status: d.status })) }));
}

export async function getWebsite(auth, ref) {
  const s = await siteFor(auth, ref);
  const [pages, cols, doms, counts, lim] = await Promise.all([
    db().from("website_pages").select("id,path,title,seo,hidden,sort,updated_at").eq("website_id", s.id).order("sort"),
    db().from("website_collections").select("id,name,slug,fields,settings,sort").eq("website_id", s.id).order("sort"),
    db().from("website_domains").select("id,hostname,kind,status,is_primary,details,created_at").eq("website_id", s.id),
    db().from("website_entries").select("collection_id,status").eq("website_id", s.id).limit(5000),
    limitsOf(s.workspace_id),
  ]);
  const cnt = {}; for (const e of counts.data || []) { cnt[e.collection_id] = cnt[e.collection_id] || { total: 0, published: 0 }; cnt[e.collection_id].total++; if (e.status === "published") cnt[e.collection_id].published++; }
  const { published, ...rest } = s;
  return {
    ...rest, hasPublished: !!published, urls: siteUrls(s, doms.data || []), limits: lim,
    pages: pages.data || [], collections: (cols.data || []).map((c) => ({ ...c, entries: cnt[c.id] || { total: 0, published: 0 } })),
    domains: doms.data || [],
    editor: "Websites › " + s.name + " (en Musa: #websites/sitios)",
  };
}

export async function getWebsitePage(auth, siteRef, ref) {
  const s = await siteFor(auth, siteRef);
  let q = db().from("website_pages").select("*").eq("website_id", s.id);
  q = /^wpg_/.test(String(ref || "")) ? q.eq("id", ref) : q.ilike("path", SR.normPath(ref || "/"));
  const p = chk(await q.maybeSingle());
  if (!p) throw err(-32004, "No existe esa página");
  return p;
}

export function sectionTypes() {
  return {
    sections: Object.entries(SR.BLOCKS).map(([type, b]) => ({ type, label: b.label, desc: b.desc, props: b.props.map((p) => ({ key: p.k, label: p.label, type: p.type, options: p.opts ? p.opts.map((o) => o[0]) : undefined, item: p.fields ? p.fields.map((f) => ({ key: f.k, label: f.label, type: f.type })) : undefined, hint: p.hint })), example: { type, props: b.sample || {}, style: b.style || {} } })),
    style: SR.STYLE.map((p) => ({ key: p.k, label: p.label, options: p.opts ? p.opts.map((o) => o[0]) : undefined })),
    fieldTypes: SR.FIELD_TYPES.map((f) => f[0]),
    schemas: SR.SCHEMAS.map((s) => s[0]).filter(Boolean),
    themePresets: Object.keys(SR.PRESETS), fonts: SR.FONTS,
    notes: "Cada sección = { id, type, props, style }. Enlaces internos empiezan con / (ej. /contacto) o # (ancla). El formulario usa props.formId (id de Crear › Formularios). collection usa props.collection = slug de la colección.",
  };
}

/* ═════════════════════════ crear / editar ═════════════════════════ */
function cleanSections(list) {
  if (!Array.isArray(list)) throw err(-32602, "sections debe ser una lista");
  return list.slice(0, 80).map((s) => {
    if (!s || !SR.BLOCKS[s.type]) throw err(-32602, "Tipo de sección desconocido: " + (s && s.type) + ". Usa list_website_section_types.");
    const props = s.props && typeof s.props === "object" ? { ...s.props } : {};
    delete props._form; delete props._design;
    return { id: String(s.id || SR.newId("sec")).slice(0, 40), type: s.type, props, style: s.style && typeof s.style === "object" ? s.style : {} };
  });
}
function cleanSlug(raw, fallback) {
  const s = SR.slugify(raw || fallback || "").slice(0, 40).replace(/-+$/, "");
  if (!SR.validSlug(s)) throw err(-32602, "Dirección no válida: usa de 3 a 40 letras minúsculas, números o guiones (y no una reservada)");
  return s;
}

export async function createWebsite(auth, p) {
  if (!p.workspaceId) throw err(-32602, "workspaceId es obligatorio: pregunta a la persona en qué espacio crear el website (list_workspaces)");
  await wsIds(auth, p.workspaceId, "editor");
  const uid = uidOf(auth);
  const name = String(p.name || "").trim().slice(0, 80);
  if (!name) throw err(-32602, "name es obligatorio");
  let slug = cleanSlug(p.slug, name);
  if (!p.slug) { // si la dirección automática está ocupada, se le agrega un sufijo
    const taken = chk(await db().from("websites").select("slug").ilike("slug", slug + "%").is("deleted_at", null));
    if (taken.some((t) => t.slug === slug)) slug = slug.slice(0, 34) + "-" + Math.random().toString(36).slice(2, 6);
  }
  let brand = null;
  if (p.brandId) brand = chk(await db().from("brands").select("id,name,colors,fonts,logo,workspace_id").eq("id", p.brandId).maybeSingle());
  const st = SR.starter(SR.STARTERS[p.template] ? p.template : "landing", { name });
  if (p.preset && SR.PRESETS[p.preset]) st.theme.preset = p.preset;
  const logo = brand && brand.logo && (brand.logo.url || brand.logo.src || (typeof brand.logo === "string" ? brand.logo : ""));
  if (logo) st.settings.logo = logo;
  if (p.description) st.settings.description = String(p.description).slice(0, 300);
  const site = chk(await db().from("websites").insert({ workspace_id: p.workspaceId, brand_id: brand ? brand.id : null, name, slug, theme: st.theme, settings: st.settings, created_by: uid, updated_by: uid }).select("*").single());
  try {
    if (st.pages.length) chk(await db().from("website_pages").insert(st.pages.map((pg) => ({ website_id: site.id, path: pg.path, title: pg.title, sections: pg.sections, seo: pg.seo || {}, sort: pg.sort, updated_by: uid }))));
    const colIds = {};
    for (const c of st.collections) { const r = chk(await db().from("website_collections").insert({ website_id: site.id, name: c.name, slug: c.slug, fields: c.fields, settings: c.settings }).select("id").single()); colIds[c.slug] = r.id; }
    for (const e of st.entries) chk(await db().from("website_entries").insert({ collection_id: colIds[e.collection], website_id: site.id, title: e.title, slug: e.slug, data: e.data, status: e.status, created_by: uid, updated_by: uid }));
  } catch (e) { await db().from("websites").delete().eq("id", site.id); throw e; }
  return { ok: true, id: site.id, slug: site.slug, workspaceId: site.workspace_id, urls: siteUrls(site, []), next: "Edita las páginas (save_website_page) y publica con publish_website. Nada es público hasta publicar." };
}

export async function updateWebsite(auth, p) {
  const s = await siteFor(auth, p.id || p.siteId, "editor");
  const up = { updated_by: uidOf(auth) };
  if (p.name != null) { up.name = String(p.name).trim().slice(0, 80); if (!up.name) throw err(-32602, "El nombre no puede quedar vacío"); }
  if (p.slug != null && p.slug !== s.slug) up.slug = cleanSlug(p.slug);
  if (p.brandId !== undefined) up.brand_id = p.brandId || null;
  if (p.theme && typeof p.theme === "object") up.theme = { ...(s.theme || {}), ...p.theme };
  if (p.settings && typeof p.settings === "object") {
    const cur = s.settings || {}, n = { ...cur, ...p.settings };
    for (const k of ["ai", "org", "footer", "analytics", "cta"]) if (p.settings[k] && typeof p.settings[k] === "object" && !Array.isArray(p.settings[k])) n[k] = { ...(cur[k] || {}), ...p.settings[k] };
    up.settings = n;
  }
  const row = chk(await db().from("websites").update(up).eq("id", s.id).select("id,name,slug,theme,settings,brand_id,updated_at").single());
  return { ok: true, website: row, note: "Guardado en borrador: publica con publish_website para que se vea en la web." };
}

export async function deleteWebsite(auth, p) {
  const s = await siteFor(auth, p.id || p.siteId, "editor");
  if (p.confirm !== true) return { needsConfirm: true, message: `Esto despublica y borra «${s.name}» con sus páginas, CMS y dominios. Pide confirmación a la persona y vuelve a llamar con confirm:true.` };
  if (!(await canAccessWorkspace(auth, s.workspace_id, "admin")) && s.created_by !== uidOf(auth)) throw err(-32003, "Solo quien lo creó o un admin del espacio puede borrarlo");
  const doms = chk(await db().from("website_domains").select("id,cf_id").eq("website_id", s.id));
  for (const d of doms) if (d.cf_id) await cfSaas("DELETE", "/custom_hostnames/" + d.cf_id).catch(() => null);
  chk(await db().from("website_domains").delete().eq("website_id", s.id));
  chk(await db().from("websites").update({ deleted_at: new Date().toISOString(), slug: s.slug + "-borrado-" + Date.now().toString(36) }).eq("id", s.id));
  cacheDrop(s.slug);
  return { ok: true, deleted: s.id };
}

export async function saveWebsitePage(auth, p) {
  const s = await siteFor(auth, p.siteId, "editor");
  const uid = uidOf(auth), up = { updated_by: uid };
  if (p.path != null) up.path = SR.normPath(p.path);
  if (p.title != null) up.title = String(p.title).slice(0, 140);
  if (p.sections != null) up.sections = cleanSections(p.sections);
  if (p.seo && typeof p.seo === "object") up.seo = p.seo;
  if (p.hidden != null) up.hidden = !!p.hidden;
  if (p.sort != null) up.sort = parseInt(p.sort, 10) || 0;
  let row;
  if (p.id || (p.path && !p.create)) {
    let q = db().from("website_pages").select("id,seo").eq("website_id", s.id);
    q = p.id ? q.eq("id", p.id) : q.ilike("path", SR.normPath(p.path));
    const cur = chk(await q.maybeSingle());
    if (cur) {
      if (up.seo) up.seo = { ...(cur.seo || {}), ...up.seo };
      row = chk(await db().from("website_pages").update(up).eq("id", cur.id).select("id,path,title,hidden,sort,updated_at").single());
      return { ok: true, page: row, created: false };
    }
    if (p.id) throw err(-32004, "No existe esa página");
  }
  if (!up.path) throw err(-32602, "path es obligatorio para crear una página (ej. /servicios)");
  if (!up.title) up.title = up.path === "/" ? "Inicio" : up.path.split("/").pop().replace(/-/g, " ");
  if (!up.sections) up.sections = [SR.newSection("hero")];
  up.sections[0] && up.sections[0].type === "hero" && !up.sections[0].props.title && (up.sections[0].props.title = up.title);
  if (up.sort == null) { const n = chk(await db().from("website_pages").select("id").eq("website_id", s.id)); up.sort = n.length; }
  row = chk(await db().from("website_pages").insert({ website_id: s.id, ...up }).select("id,path,title,hidden,sort,updated_at").single());
  return { ok: true, page: row, created: true };
}

export async function deleteWebsitePage(auth, p) {
  const s = await siteFor(auth, p.siteId, "editor");
  const pg = chk(await db().from("website_pages").select("id,path").eq("website_id", s.id).eq("id", p.id).maybeSingle());
  if (!pg) throw err(-32004, "No existe esa página");
  if (pg.path === "/") throw err(-32602, "La portada (/) no se puede borrar: edítala");
  chk(await db().from("website_pages").delete().eq("id", pg.id));
  return { ok: true, deleted: pg.id, note: "Se quita de la web al volver a publicar." };
}

/* ═════════════════════════ CMS ═════════════════════════ */
function cleanFields(list) {
  const okT = new Set(SR.FIELD_TYPES.map((f) => f[0]));
  return (Array.isArray(list) ? list : []).slice(0, 40).map((f) => {
    const k = String(f.k || f.key || SR.slugify(f.label || "campo")).replace(/[^a-z0-9_]/gi, "_").toLowerCase().slice(0, 40);
    if (!okT.has(f.type)) throw err(-32602, "Tipo de campo no válido: " + f.type + " (usa " + [...okT].join(", ") + ")");
    return { k, label: String(f.label || k).slice(0, 60), type: f.type, ...(f.type === "select" ? { opts: (f.opts || f.options || []).map(String).slice(0, 40) } : {}), ...(f.required ? { required: true } : {}) };
  });
}
async function colFor(siteId, ref) {
  let q = db().from("website_collections").select("*").eq("website_id", siteId);
  q = /^wcl_/.test(String(ref || "")) ? q.eq("id", ref) : q.ilike("slug", String(ref || ""));
  const c = chk(await q.maybeSingle());
  if (!c) throw err(-32004, "No existe esa colección (list: get_website → collections)");
  return c;
}
export async function saveWebsiteCollection(auth, p) {
  const s = await siteFor(auth, p.siteId, "editor");
  const up = {};
  if (p.name != null) up.name = String(p.name).trim().slice(0, 60);
  if (p.slug != null) up.slug = SR.slugify(p.slug).slice(0, 40);
  if (p.fields != null) up.fields = cleanFields(p.fields);
  if (p.settings && typeof p.settings === "object") up.settings = p.settings;
  if (p.id) {
    const cur = await colFor(s.id, p.id);
    if (up.settings) up.settings = { ...(cur.settings || {}), ...up.settings };
    const row = chk(await db().from("website_collections").update(up).eq("id", cur.id).select("*").single());
    return { ok: true, collection: row };
  }
  if (!up.name) throw err(-32602, "name es obligatorio");
  up.slug = up.slug || SR.slugify(up.name).slice(0, 40);
  if (!up.fields || !up.fields.length) up.fields = SR.BLOG_FIELDS;
  up.settings = { path: "/" + up.slug, schema: "BlogPosting", detail: true, rss: true, title: up.name, ...(up.settings || {}) };
  if (up.settings.path) up.settings.path = SR.normPath(up.settings.path);
  const row = chk(await db().from("website_collections").insert({ website_id: s.id, ...up }).select("*").single());
  return { ok: true, collection: row, created: true };
}
export async function deleteWebsiteCollection(auth, p) {
  const s = await siteFor(auth, p.siteId, "editor");
  const c = await colFor(s.id, p.id || p.collection);
  if (p.confirm !== true) { const n = chk(await db().from("website_entries").select("id").eq("collection_id", c.id)); return { needsConfirm: true, message: `Borra la colección «${c.name}» y sus ${n.length} entradas. Pide confirmación y vuelve con confirm:true.` }; }
  chk(await db().from("website_collections").delete().eq("id", c.id));
  return { ok: true, deleted: c.id };
}
export async function listWebsiteEntries(auth, p) {
  const s = await siteFor(auth, p.siteId);
  const c = await colFor(s.id, p.collection);
  let q = db().from("website_entries").select("id,slug,title,status,publish_at,data,seo,created_at,updated_at").eq("collection_id", c.id).order("created_at", { ascending: false }).limit(Math.min(500, parseInt(p.limit, 10) || 100));
  if (p.status) q = q.eq("status", p.status);
  if (p.q) q = q.ilike("title", "%" + String(p.q).replace(/[%_]/g, "") + "%");
  const rows = chk(await q);
  const base = siteUrls(s, []).live.replace(/\/$/, "");
  return { collection: { id: c.id, name: c.name, slug: c.slug, fields: c.fields, settings: c.settings }, entries: rows.map((e) => ({ ...e, url: base + SR.entryUrl(c, e) })) };
}
export async function saveWebsiteEntry(auth, p) {
  const s = await siteFor(auth, p.siteId, "editor");
  const c = await colFor(s.id, p.collection);
  const uid = uidOf(auth), up = { updated_by: uid };
  if (p.title != null) up.title = String(p.title).trim().slice(0, 200);
  if (p.slug != null) up.slug = SR.slugify(p.slug).slice(0, 80);
  if (p.status != null) { if (!["draft", "published"].includes(p.status)) throw err(-32602, "status: draft | published"); up.status = p.status; }
  if (p.publishAt !== undefined) up.publish_at = p.publishAt ? new Date(p.publishAt).toISOString() : null;
  if (p.seo && typeof p.seo === "object") up.seo = p.seo;
  if (p.data && typeof p.data === "object") {
    const keys = new Set((c.fields || []).map((f) => f.k)), d = {};
    for (const [k, v] of Object.entries(p.data)) { if (!keys.has(k)) throw err(-32602, `Campo «${k}» no existe en ${c.name}. Campos: ${[...keys].join(", ")}`); d[k] = v; }
    up.data = d;
  }
  if (p.id) {
    const cur = chk(await db().from("website_entries").select("id,data,seo").eq("collection_id", c.id).eq("id", p.id).maybeSingle());
    if (!cur) throw err(-32004, "No existe esa entrada");
    if (up.data) up.data = { ...(cur.data || {}), ...up.data };
    if (up.seo) up.seo = { ...(cur.seo || {}), ...up.seo };
    const row = chk(await db().from("website_entries").update(up).eq("id", cur.id).select("id,slug,title,status,publish_at,updated_at").single());
    return { ok: true, entry: row, url: siteUrls(s, []).live.replace(/\/$/, "") + SR.entryUrl(c, row), live: row.status === "published" && s.status === "published" };
  }
  if (!up.title) throw err(-32602, "title es obligatorio");
  up.slug = up.slug || SR.slugify(up.title).slice(0, 80);
  up.status = up.status || "draft";
  const row = chk(await db().from("website_entries").insert({ collection_id: c.id, website_id: s.id, data: {}, created_by: uid, ...up }).select("id,slug,title,status,publish_at,updated_at").single());
  return { ok: true, entry: row, created: true, url: siteUrls(s, []).live.replace(/\/$/, "") + SR.entryUrl(c, row), live: row.status === "published" && s.status === "published", note: row.status === "published" ? "Las entradas publicadas se ven al instante en la web (si el website está publicado)." : "Quedó en borrador." };
}
export async function deleteWebsiteEntry(auth, p) {
  const s = await siteFor(auth, p.siteId, "editor");
  const e = chk(await db().from("website_entries").select("id,title").eq("website_id", s.id).eq("id", p.id).maybeSingle());
  if (!e) throw err(-32004, "No existe esa entrada");
  chk(await db().from("website_entries").delete().eq("id", e.id));
  return { ok: true, deleted: e.id };
}

/* ═════════════════════════ publicar ═════════════════════════ */
async function buildSnapshot(s) {
  const [pagesR, brandR] = await Promise.all([
    db().from("website_pages").select("id,path,title,sections,seo,hidden,sort,updated_at").eq("website_id", s.id).order("sort"),
    s.brand_id ? db().from("brands").select("name,colors,fonts").eq("id", s.brand_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const pages = (chk(pagesR) || []).filter((p) => !p.hidden);
  if (!pages.some((p) => SR.normPath(p.path) === "/")) throw err(-32602, "Falta la portada (/): crea una página con path «/»");
  const formIds = new Set(), tplIds = new Set();
  for (const p of pages) for (const x of p.sections || []) { if (x.type === "form" && x.props?.formId) formIds.add(x.props.formId); if (x.type === "design" && x.props?.templateId) tplIds.add(x.props.templateId); }
  const forms = {}, tpls = {};
  if (formIds.size) {
    const rows = chk(await db().from("workspace_forms").select("id,workspace_id,name,published,schema,public_token").in("id", [...formIds]));
    for (const f of rows) if (f.workspace_id === s.workspace_id && f.public_token) {
      if (!f.published) await db().from("workspace_forms").update({ published: true }).eq("id", f.id);
      forms[f.id] = { token: f.public_token, fields: (f.schema?.fields || []).slice(0, 30).map((x) => ({ name: x.name, label: x.label, type: x.type, required: !!x.required, options: x.options })) };
    }
  }
  if (tplIds.size) {
    const rows = chk(await db().from("templates").select("id,workspace_id,name,thumbnail,data").in("id", [...tplIds]));
    for (const t of rows) if (t.workspace_id === s.workspace_id) {
      const d = t.data || {};
      tpls[t.id] = { name: t.name, width: d.width, height: d.height, html: typeof d.html === "string" ? d.html.slice(0, 400000) : "", css: typeof d.css === "string" ? d.css.slice(0, 200000) : "", image: /^https?:/.test(t.thumbnail || "") ? t.thumbnail : "" };
    }
  }
  const missing = [];
  for (const p of pages) p.sections = (p.sections || []).map((x) => {
    const y = { ...x, props: { ...(x.props || {}) } };
    if (x.type === "form") { if (forms[x.props?.formId]) y.props._form = forms[x.props.formId]; else missing.push(`«${p.title}»: el formulario no está elegido o no es de este espacio`); }
    if (x.type === "design" && x.props?.templateId) { if (tpls[x.props.templateId]) y.props._design = tpls[x.props.templateId]; else missing.push(`«${p.title}»: el diseño no existe o no es de este espacio`); }
    return y;
  });
  const lim = await limitsOf(s.workspace_id);
  return { snapshot: { site: { id: s.id, name: s.name, slug: s.slug, theme: s.theme || {}, settings: s.settings || {} }, brand: brandR.data || null, pages, badge: !!lim.badge, builtAt: new Date().toISOString() }, warnings: missing };
}

export async function publishWebsite(auth, p) {
  const s = await siteFor(auth, p.id || p.siteId, "editor");
  const { snapshot, warnings } = await buildSnapshot(s);
  const version = (s.version || 0) + 1, uid = uidOf(auth);
  chk(await db().from("website_versions").insert({ website_id: s.id, version, label: String(p.label || "").slice(0, 120), snapshot, created_by: uid }));
  chk(await db().from("websites").update({ published: snapshot, published_at: new Date().toISOString(), published_by: uid, version, status: "published" }).eq("id", s.id));
  cacheDrop(s.slug);
  const doms = chk(await db().from("website_domains").select("hostname,status,is_primary").eq("website_id", s.id));
  // poda: se guardan las últimas 30 versiones
  const old = chk(await db().from("website_versions").select("id").eq("website_id", s.id).order("version", { ascending: false }).range(30, 200));
  if (old.length) await db().from("website_versions").delete().in("id", old.map((o) => o.id));
  return { ok: true, version, pages: snapshot.pages.length, urls: siteUrls(s, doms), warnings, note: "Publicado. Las entradas del CMS se actualizan solas; páginas, tema y menú requieren publicar de nuevo." };
}
export async function unpublishWebsite(auth, p) {
  const s = await siteFor(auth, p.id || p.siteId, "editor");
  chk(await db().from("websites").update({ published: null, status: "draft" }).eq("id", s.id));
  cacheDrop(s.slug);
  return { ok: true, note: "El website ya no es público. Su historial de versiones se mantiene." };
}
export async function listWebsiteVersions(auth, p) {
  const s = await siteFor(auth, p.id || p.siteId);
  const rows = chk(await db().from("website_versions").select("id,version,label,created_by,created_at").eq("website_id", s.id).order("version", { ascending: false }).limit(30));
  return { current: s.version, published: s.status === "published", versions: rows };
}
export async function restoreWebsiteVersion(auth, p) {
  const s = await siteFor(auth, p.siteId, "editor");
  const v = chk(await db().from("website_versions").select("*").eq("website_id", s.id).eq(/^wvr_/.test(String(p.version)) ? "id" : "version", p.version).maybeSingle());
  if (!v) throw err(-32004, "No existe esa versión");
  const snap = v.snapshot || {}, uid = uidOf(auth);
  // vuelve el BORRADOR a esa versión (páginas, tema y ajustes); luego se publica como una versión nueva
  chk(await db().from("websites").update({ theme: snap.site?.theme || {}, settings: snap.site?.settings || {}, updated_by: uid }).eq("id", s.id));
  const keep = new Set();
  for (const pg of snap.pages || []) {
    const sections = (pg.sections || []).map((x) => { const props = { ...(x.props || {}) }; delete props._form; delete props._design; return { ...x, props }; });
    const ex = chk(await db().from("website_pages").select("id").eq("website_id", s.id).ilike("path", pg.path).maybeSingle());
    if (ex) { chk(await db().from("website_pages").update({ title: pg.title, sections, seo: pg.seo || {}, hidden: false, sort: pg.sort || 0, updated_by: uid }).eq("id", ex.id)); keep.add(ex.id); }
    else { const r = chk(await db().from("website_pages").insert({ website_id: s.id, path: pg.path, title: pg.title, sections, seo: pg.seo || {}, sort: pg.sort || 0, updated_by: uid }).select("id").single()); keep.add(r.id); }
  }
  const all = chk(await db().from("website_pages").select("id").eq("website_id", s.id));
  const extra = all.filter((r) => !keep.has(r.id)).map((r) => r.id);
  if (extra.length) await db().from("website_pages").update({ hidden: true }).in("id", extra);
  const out = p.publish === false ? { ok: true, restored: v.version, note: "El borrador volvió a la versión " + v.version + ". Publica para que se vea." } : { restored: v.version, ...(await publishWebsite(auth, { id: s.id, label: "Vuelta a la versión " + v.version })) };
  return out;
}

/* ═════════════════════════ auditoría y visitas ═════════════════════════ */
async function liveCms(siteId, draft) {
  const [cols, ents] = await Promise.all([
    db().from("website_collections").select("id,name,slug,fields,settings,sort").eq("website_id", siteId).order("sort"),
    (() => { let q = db().from("website_entries").select("id,collection_id,slug,title,data,seo,status,publish_at,created_at,updated_at").eq("website_id", siteId); if (!draft) q = q.eq("status", "published").or("publish_at.is.null,publish_at.lte." + new Date().toISOString()); return q.order("publish_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(800); })(),
  ]);
  const collections = cols.data || [], byId = {}, entries = {};
  for (const c of collections) { byId[c.id] = c.slug; entries[c.slug] = []; }
  for (const e of ents.data || []) if (byId[e.collection_id]) entries[byId[e.collection_id]].push(e);
  return { collections, entries };
}
export async function auditWebsite(auth, p) {
  const s = await siteFor(auth, p.id || p.siteId);
  let pages = chk(await db().from("website_pages").select("id,path,title,sections,seo,hidden").eq("website_id", s.id).order("sort")).filter((x) => !x.hidden);
  if (p.path) pages = pages.filter((x) => SR.normPath(x.path) === SR.normPath(p.path));
  const cms = await liveCms(s.id, false);
  const ctx = { origin: APP_ORIGIN(), base: "/w/" + s.slug, collections: cms.collections, entries: cms.entries };
  const res = pages.map((pg) => { const a = SR.audit(s, pg, ctx); return { path: pg.path, title: pg.title, score: a.score, seo: a.seo, geo: a.geo, aeo: a.aeo, words: a.words, fix: a.checks.filter((c) => !c.ok).map((c) => ({ group: c.group, problem: c.text, fix: c.fix, section: c.section })) }; });
  const avg = (k) => (res.length ? Math.round(res.reduce((a, r) => a + r[k], 0) / res.length) : 0);
  return { website: s.name, score: avg("score"), seo: avg("seo"), geo: avg("geo"), aeo: avg("aeo"), pages: res, files: { sitemap: "/sitemap.xml", robots: "/robots.txt", llms: "/llms.txt", llmsFull: "/llms-full.txt" } };
}
export async function websiteStats(auth, p) {
  const s = await siteFor(auth, p.id || p.siteId);
  const days = Math.max(1, Math.min(365, parseInt(p.days, 10) || 30));
  const from = new Date(Date.now() - (days - 1) * 864e5).toISOString().slice(0, 10);
  const [st, rf] = await Promise.all([
    db().from("website_stats").select("day,path,views").eq("website_id", s.id).gte("day", from).limit(10000),
    db().from("website_refs").select("ref,views").eq("website_id", s.id).gte("day", from).limit(10000),
  ]);
  const byDay = {}, byPath = {}, byRef = {}; let total = 0;
  for (const r of st.data || []) { byDay[r.day] = (byDay[r.day] || 0) + r.views; byPath[r.path] = (byPath[r.path] || 0) + r.views; total += r.views; }
  for (const r of rf.data || []) byRef[r.ref] = (byRef[r.ref] || 0) + r.views;
  const series = []; for (let i = 0; i < days; i++) { const d = new Date(Date.parse(from) + i * 864e5).toISOString().slice(0, 10); series.push({ day: d, views: byDay[d] || 0 }); }
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => ({ key: k, views: v }));
  const leads = chk(await db().from("workspace_form_responses").select("id,created_at,form_id").eq("workspace_id", s.workspace_id).gte("created_at", from).limit(5000));
  const formIds = new Set(); for (const pg of s.published?.pages || []) for (const x of pg.sections || []) if (x.type === "form" && x.props?.formId) formIds.add(x.props.formId);
  return { days, total, series, pages: top(byPath), referrers: top(byRef), leads: leads.filter((l) => formIds.has(l.form_id)).length, note: "Visitas de personas (sin bots), contadas en el servidor: no usa cookies." };
}

/* ═════════════════════════ dominios ═════════════════════════ */
async function cfSaas(method, path, body) {
  const zone = process.env.SITES_CF_ZONE_ID, tok = process.env.SITES_CF_API_TOKEN;
  if (!zone || !tok) return null;
  const r = await fetch("https://api.cloudflare.com/client/v4/zones/" + zone + path, { method, headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!j.success) throw err(-32000, "Cloudflare: " + ((j.errors || []).map((e) => e.message).join("; ") || r.status));
  return j.result;
}
async function doh(name, type) {
  try {
    const r = await fetch("https://cloudflare-dns.com/dns-query?name=" + encodeURIComponent(name) + "&type=" + type, { headers: { accept: "application/dns-json" } });
    const j = await r.json(); return (j.Answer || []).map((a) => String(a.data || "").replace(/^"|"$/g, "").replace(/\.$/, "").toLowerCase());
  } catch { return []; }
}
function domainHelp(d) {
  const target = process.env.SITES_CNAME_TARGET || "";
  const apex = d.hostname.split(".").length === 2;
  return {
    steps: [
      { record: "TXT", name: "_musa." + d.hostname, value: "musa-verify=" + d.verify_token, why: "Prueba que el dominio es tuyo" },
      target ? { record: apex ? "CNAME (o ALIAS/ANAME en la raíz)" : "CNAME", name: d.hostname, value: target, why: "Apunta el dominio a Musa" } : null,
    ].filter(Boolean),
    ready: !!(process.env.SITES_CF_ZONE_ID && target),
    note: process.env.SITES_CF_ZONE_ID && target ? "Cuando el registro esté listo (minutos a 24 h), usa «Comprobar»." : "Ya puedes agregar el registro TXT para verificar el dominio. Musa está activando la conexión de dominios propios: el registro CNAME aparecerá aquí cuando esté disponible.",
  };
}
export async function connectWebsiteDomain(auth, p) {
  const s = await siteFor(auth, p.siteId, "editor");
  const host = String(p.hostname || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (!HOST_RX.test(host)) throw err(-32602, "Escribe un dominio válido, como www.tumarca.com");
  const root = ROOT_DOMAIN();
  if (/(^|\.)futuraria\.com$|(^|\.)musa\.app$|\.workers\.dev$|\.pages\.dev$|^localhost$/.test(host) || (root && (host === root || host.endsWith("." + root)))) throw err(-32602, "Ese dominio no se puede conectar");
  const lim = await limitsOf(s.workspace_id);
  if (lim.custom_domains === 0) throw err(-32003, "Tu plan gratis publica en la dirección de Musa. Para usar tu propio dominio, mejora tu plan (Creador o superior).");
  if (lim.custom_domains != null) {
    const owner = chk(await db().from("workspaces").select("owner_id").eq("id", s.workspace_id).single()).owner_id;
    const wss = chk(await db().from("workspaces").select("id").eq("owner_id", owner)).map((w) => w.id);
    const sites = chk(await db().from("websites").select("id").in("workspace_id", wss).is("deleted_at", null)).map((x) => x.id);
    const used = sites.length ? chk(await db().from("website_domains").select("id").in("website_id", sites).eq("kind", "custom")).length : 0;
    if (used >= lim.custom_domains) throw err(-32003, `Tu plan incluye ${lim.custom_domains} dominio(s) propio(s) y ya los usas. Mejora tu plan para conectar más.`);
  }
  const first = !chk(await db().from("website_domains").select("id").eq("website_id", s.id)).length;
  const d = chk(await db().from("website_domains").insert({ website_id: s.id, hostname: host, kind: "custom", status: "pending", is_primary: first, created_by: uidOf(auth) }).select("*").single());
  try {
    const cf = await cfSaas("POST", "/custom_hostnames", { hostname: host, ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } } });
    if (cf) await db().from("website_domains").update({ cf_id: cf.id, details: { cf_status: cf.status, ssl: cf.ssl?.status } }).eq("id", d.id);
  } catch (e) { await db().from("website_domains").update({ status: "error", details: { error: e.message } }).eq("id", d.id); }
  return { ok: true, domain: { id: d.id, hostname: host, status: d.status }, ...domainHelp(d) };
}
export async function checkWebsiteDomain(auth, p) {
  const d0 = chk(await db().from("website_domains").select("*").eq("id", p.id).maybeSingle());
  if (!d0) throw err(-32004, "No existe ese dominio");
  await siteFor(auth, d0.website_id, "viewer");
  const txt = await doh("_musa." + d0.hostname, "TXT");
  const owned = txt.some((t) => t.includes("musa-verify=" + d0.verify_token));
  const target = (process.env.SITES_CNAME_TARGET || "").toLowerCase();
  const cname = target ? await doh(d0.hostname, "CNAME") : [];
  const pointed = !!target && cname.some((c) => c === target);
  let cf = null; try { if (d0.cf_id) cf = await cfSaas("GET", "/custom_hostnames/" + d0.cf_id); } catch {}
  const active = owned && (cf ? cf.status === "active" && cf.ssl?.status === "active" : false);
  const status = active ? "active" : owned ? "verifying" : "pending";
  const details = { ...(d0.details || {}), owned, pointed, checked_at: new Date().toISOString(), cf_status: cf?.status, ssl: cf?.ssl?.status };
  await db().from("website_domains").update({ status, details }).eq("id", d0.id);
  const s = chk(await db().from("websites").select("slug").eq("id", d0.website_id).single()); cacheDrop(s.slug); hostCache.delete(d0.hostname);
  return { hostname: d0.hostname, status, owned, pointed, ssl: cf?.ssl?.status || null, ...domainHelp(d0), message: active ? "¡Listo! Tu website ya responde en " + d0.hostname : owned ? "Dominio verificado. Falta que apunte a Musa y se emita el certificado." : "Todavía no vemos el registro TXT. Puede tardar unos minutos." };
}
export async function removeWebsiteDomain(auth, p) {
  const d = chk(await db().from("website_domains").select("*").eq("id", p.id).maybeSingle());
  if (!d) throw err(-32004, "No existe ese dominio");
  await siteFor(auth, d.website_id, "editor");
  if (d.cf_id) await cfSaas("DELETE", "/custom_hostnames/" + d.cf_id).catch(() => null);
  chk(await db().from("website_domains").delete().eq("id", d.id));
  hostCache.delete(d.hostname);
  return { ok: true, removed: d.hostname };
}

/* ═════════════════════════ GitHub y Supabase propios ═════════════════════════ */
async function getSecret(siteId, provider) {
  const r = chk(await db().from("website_secrets").select("encrypted,meta").eq("website_id", siteId).eq("provider", provider).maybeSingle());
  if (!r) return null;
  return { value: decrypt(r.encrypted), meta: r.meta || {} };
}
async function putSecret(siteId, provider, value, meta, uid) {
  chk(await db().from("website_secrets").upsert({ website_id: siteId, provider, encrypted: encrypt(String(value)), meta, updated_by: uid, updated_at: new Date().toISOString() }, { onConflict: "website_id,provider" }));
}
export async function websiteIntegrations(auth, p) {
  const s = await siteFor(auth, p.siteId || p.id);
  const rows = chk(await db().from("website_secrets").select("provider,meta,updated_at").eq("website_id", s.id));
  const o = {}; for (const r of rows) o[r.provider] = { connected: true, ...r.meta, updatedAt: r.updated_at };
  return { github: o.github || { connected: false }, supabase: o.supabase || { connected: false }, supabaseSql: SUPABASE_SQL };
}
const gh = async (tok, method, path, body) => {
  const r = await fetch("https://api.github.com" + path, { method, headers: { Authorization: "Bearer " + tok, Accept: "application/vnd.github+json", "User-Agent": "Musa-Websites", "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, j };
};
export async function connectWebsiteGithub(auth, p) {
  const s = await siteFor(auth, p.siteId, "editor");
  const repo = String(p.repo || "").trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw err(-32602, "repo debe ser «usuario/repositorio»");
  const prev = await getSecret(s.id, "github");
  const tok = String(p.token || prev?.value || "").trim();
  if (!tok) throw err(-32602, "Falta el token de GitHub (fine-grained, con permiso Contents: Read and write sobre ese repositorio)");
  const r = await gh(tok, "GET", "/repos/" + repo);
  if (!r.ok) throw err(-32000, r.status === 404 ? "No encuentro ese repositorio con ese token (revisa el nombre y que el token tenga acceso)" : "GitHub respondió " + r.status + ": " + (r.j.message || ""));
  if (r.j.permissions && !r.j.permissions.push) throw err(-32003, "El token no tiene permiso de escritura en ese repositorio");
  const meta = { repo, branch: String(p.branch || r.j.default_branch || "main"), dir: String(p.dir || "").replace(/^\/+|\/+$/g, ""), siteUrl: String(p.siteUrl || "").replace(/\/$/, ""), private: !!r.j.private };
  await putSecret(s.id, "github", tok, meta, uidOf(auth));
  return { ok: true, github: meta, next: "Usa sync_website_github para subir el sitio publicado al repositorio." };
}
/** Todos los archivos estáticos del sitio publicado (para GitHub o para exportar). */
async function staticFiles(s, origin) {
  const snap = s.published; if (!snap) throw err(-32602, "Primero publica el website (publish_website)");
  const cms = await liveCms(s.id, false);
  const site = snap.site, files = {};
  const ctx = { origin, base: "", collections: cms.collections, entries: cms.entries, brand: snap.brand, badge: snap.badge, formAction: APP_ORIGIN() + "/w/" + s.slug + "/_form/", lang: site.settings?.lang };
  const at = (path) => (path === "/" ? "index.html" : path.replace(/^\//, "") + "/index.html");
  for (const pg of snap.pages) files[at(SR.normPath(pg.path))] = SR.renderPage(site, pg, ctx);
  for (const c of cms.collections) {
    const list = cms.entries[c.slug] || [], cp = SR.colPath(c);
    if (c.settings?.listPage !== false && !files[at(cp)]) files[at(cp)] = SR.renderList(site, c, list, ctx);
    if (c.settings?.detail !== false) for (const e of list) files[at(SR.entryUrl(c, e))] = SR.renderEntry(site, c, e, ctx);
    if (c.settings?.rss !== false) files[cp.replace(/^\//, "") + "/rss.xml"] = SR.rss(site, c, list, ctx);
  }
  files["sitemap.xml"] = SR.sitemap(site, snap.pages, cms.collections, cms.entries, ctx);
  files["robots.txt"] = SR.robots(site, ctx);
  if (site.settings?.ai?.llms !== false) { files["llms.txt"] = SR.llms(site, snap.pages, cms.collections, cms.entries, ctx, false); files["llms-full.txt"] = SR.llms(site, snap.pages, cms.collections, cms.entries, ctx, true); }
  files["404.html"] = SR.renderPage(site, { path: "/404", title: "No encontrado", seo: { noindex: true }, sections: [{ id: "nf", type: "hero", props: { title: "No encontramos esta página", subtitle: "Puede que se haya movido.", buttons: [{ label: "Ir al inicio", href: "/" }] }, style: { align: "c" } }] }, ctx);
  files[".nojekyll"] = "";
  return files;
}
export async function syncWebsiteGithub(auth, p) {
  const s = await siteFor(auth, p.siteId, "editor");
  const sec = await getSecret(s.id, "github");
  if (!sec) throw err(-32602, "Conecta GitHub primero (connect_website_github)");
  const { repo, branch, dir } = sec.meta, tok = sec.value;
  const doms = chk(await db().from("website_domains").select("hostname,status,is_primary").eq("website_id", s.id));
  const u = siteUrls(s, doms);
  const files = await staticFiles(s, String(sec.meta.siteUrl || u.domain || u.musa).replace(/\/$/, ""));
  const pre = dir ? dir + "/" : "";
  let ref = await gh(tok, "GET", `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  if (ref.status === 409 || ref.status === 404) { // repositorio vacío o rama nueva
    const init = await gh(tok, "PUT", `/repos/${repo}/contents/${pre}README.md`, { message: "Musa: inicio del sitio", content: Buffer.from("# " + s.name + "\n\nSitio publicado desde Musa Websites.\n").toString("base64"), branch });
    if (!init.ok && init.status !== 422) throw err(-32000, "GitHub: " + (init.j.message || init.status));
    ref = await gh(tok, "GET", `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  }
  if (!ref.ok) throw err(-32000, "GitHub: no pude leer la rama " + branch + " (" + (ref.j.message || ref.status) + ")");
  const head = ref.j.object.sha;
  const commit = await gh(tok, "GET", `/repos/${repo}/git/commits/${head}`);
  const tree = await gh(tok, "POST", `/repos/${repo}/git/trees`, { base_tree: commit.j.tree.sha, tree: Object.entries(files).map(([path, content]) => ({ path: pre + path, mode: "100644", type: "blob", content })) });
  if (!tree.ok) throw err(-32000, "GitHub (árbol): " + (tree.j.message || tree.status));
  const c2 = await gh(tok, "POST", `/repos/${repo}/git/commits`, { message: String(p.message || `Musa: ${s.name} v${s.version}`).slice(0, 200), tree: tree.j.sha, parents: [head] });
  if (!c2.ok) throw err(-32000, "GitHub (commit): " + (c2.j.message || c2.status));
  const up = await gh(tok, "PATCH", `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { sha: c2.j.sha });
  if (!up.ok) throw err(-32000, "GitHub (rama): " + (up.j.message || up.status));
  await db().from("website_secrets").update({ meta: { ...sec.meta, lastSync: new Date().toISOString(), lastCommit: c2.j.sha, files: Object.keys(files).length } }).eq("website_id", s.id).eq("provider", "github");
  return { ok: true, repo, branch, commit: c2.j.sha, url: `https://github.com/${repo}/commit/${c2.j.sha}`, files: Object.keys(files).length, note: "Es una foto del sitio publicado: los formularios siguen llegando a Musa. Vuelve a sincronizar después de publicar o de cambiar el CMS." };
}
export const SUPABASE_SQL = `-- Pégalo en el editor SQL de TU proyecto de Supabase (una sola vez)
create table if not exists public.musa_leads (
  id bigint generated always as identity primary key,
  site text not null, form text, email text, data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.musa_cms_entries (
  id text primary key, site text not null, collection text not null, slug text not null,
  title text, data jsonb not null default '{}'::jsonb, seo jsonb not null default '{}'::jsonb,
  status text, publish_at timestamptz, updated_at timestamptz
);
alter table public.musa_leads enable row level security;
alter table public.musa_cms_entries enable row level security;
-- Lectura pública del CMS publicado (para usarlo desde tu propio frontend):
drop policy if exists musa_cms_public on public.musa_cms_entries;
create policy musa_cms_public on public.musa_cms_entries for select using (status = 'published');`;
const sbFetch = (url, key, path, init = {}) => fetch(url.replace(/\/$/, "") + path, { ...init, headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", ...(init.headers || {}) } });
export async function connectWebsiteSupabase(auth, p) {
  const s = await siteFor(auth, p.siteId, "editor");
  const url = String(p.url || "").trim().replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) && !/^https:\/\//.test(url)) throw err(-32602, "url debe ser la URL de tu proyecto, como https://abcd.supabase.co");
  const prev = await getSecret(s.id, "supabase");
  const key = String(p.key || prev?.value || "").trim();
  if (!key) throw err(-32602, "Falta la llave secreta (service_role o secret) de tu proyecto de Supabase");
  const t = await sbFetch(url, key, "/rest/v1/musa_leads?select=id&limit=1");
  const t2 = await sbFetch(url, key, "/rest/v1/musa_cms_entries?select=id&limit=1");
  if (t.status === 401 || t.status === 403) throw err(-32003, "Supabase rechazó la llave");
  const tables = t.ok && t2.ok;
  const meta = { url, leads: p.leads !== false, cms: p.cms !== false, tables };
  await putSecret(s.id, "supabase", key, meta, uidOf(auth));
  return { ok: true, supabase: meta, ...(tables ? {} : { needsSql: true, sql: SUPABASE_SQL, note: "Conectado, pero faltan las tablas: corre este SQL en tu proyecto y vuelve a conectar." }) };
}
export async function syncWebsiteSupabase(auth, p) {
  const s = await siteFor(auth, p.siteId, "editor");
  const sec = await getSecret(s.id, "supabase");
  if (!sec) throw err(-32602, "Conecta Supabase primero (connect_website_supabase)");
  const cms = await liveCms(s.id, true);
  const rows = [];
  for (const c of cms.collections) for (const e of cms.entries[c.slug] || []) rows.push({ id: e.id, site: s.slug, collection: c.slug, slug: e.slug, title: e.title, data: e.data, seo: e.seo, status: e.status, publish_at: e.publish_at, updated_at: e.updated_at });
  for (let i = 0; i < rows.length; i += 400) {
    const r = await sbFetch(sec.meta.url, sec.value, "/rest/v1/musa_cms_entries?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 400)) });
    if (!r.ok) throw err(-32000, "Tu Supabase respondió " + r.status + ": " + (await r.text()).slice(0, 200) + (r.status === 404 ? " — corre el SQL de musa_cms_entries" : ""));
  }
  await db().from("website_secrets").update({ meta: { ...sec.meta, tables: true, lastSync: new Date().toISOString(), entries: rows.length } }).eq("website_id", s.id).eq("provider", "supabase");
  return { ok: true, entries: rows.length, table: "musa_cms_entries" };
}
export async function disconnectWebsiteIntegration(auth, p) {
  const s = await siteFor(auth, p.siteId, "editor");
  if (!["github", "supabase"].includes(p.provider)) throw err(-32602, "provider: github | supabase");
  chk(await db().from("website_secrets").delete().eq("website_id", s.id).eq("provider", p.provider));
  return { ok: true };
}

/* ═════════════════════════ servir el sitio público ═════════════════════════ */
const siteCache = new Map(), hostCache = new Map();
function cacheDrop(slug) { siteCache.delete(String(slug || "").toLowerCase()); }
async function loadPublic(slug) {
  slug = slug.toLowerCase();
  const c = siteCache.get(slug);
  if (c && Date.now() - c.t < 20000) return c.v;
  const r = await db().from("websites").select("id,workspace_id,slug,status,published,version").ilike("slug", slug).is("deleted_at", null).maybeSingle();
  const v = r.data && r.data.published ? r.data : null;
  let primary = null;
  if (v) { const d = await db().from("website_domains").select("hostname,is_primary").eq("website_id", v.id).eq("status", "active"); const a = d.data || []; primary = (a.find((x) => x.is_primary) || a[0] || {}).hostname || null; v.primary = primary; }
  siteCache.set(slug, { t: Date.now(), v });
  return v;
}
async function slugForHost(host) {
  const root = ROOT_DOMAIN();
  if (root && host.endsWith("." + root)) { const sub = host.slice(0, -root.length - 1); if (/^[a-z0-9-]+$/.test(sub)) return sub; }
  const c = hostCache.get(host);
  if (c && Date.now() - c.t < 60000) return c.v;
  const d = await db().from("website_domains").select("website_id,status").eq("hostname", host).maybeSingle();
  let v = null;
  if (d.data && d.data.status === "active") { const s = await db().from("websites").select("slug").eq("id", d.data.website_id).is("deleted_at", null).maybeSingle(); v = s.data?.slug || null; }
  hostCache.set(host, { t: Date.now(), v });
  return v;
}
const BOT_RX = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|pingdom|uptime|curl|wget|python|httpclient|axios|node-fetch/i;
function nonce() { const a = new Uint8Array(16); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/[^a-z0-9]/gi, ""); }
function csp(n, sandboxed) {
  return [
    "default-src 'self'", "img-src * data: blob:", "media-src * blob:", "font-src 'self' https://fonts.gstatic.com data:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    `script-src 'nonce-${n}' https://www.googletagmanager.com https://connect.facebook.net`,
    "connect-src 'self' " + APP_ORIGIN() + " https://www.google-analytics.com https://*.google-analytics.com https://www.facebook.com",
    "frame-src https://www.youtube-nocookie.com https://www.youtube.com https://player.vimeo.com https://www.google.com https://open.spotify.com https://calendly.com",
    "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'self'",
    // En la dirección de Musa (mismo origen que la app) el sitio corre en un origen opaco: aunque alguien
    // colara un script, no podría leer la sesión de Musa.
    sandboxed ? "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation" : "",
  ].filter(Boolean).join("; ");
}
function out(body, type, status, extra) {
  return new Response(body, { status: status || 200, headers: { "content-type": type, "cache-control": status && status >= 400 ? "no-store" : "public, max-age=60", "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin", ...(extra || {}) } });
}

/** /w/:slug/* (dirección de Musa) y /w/@host/* (lo que reenvía el proxy de dominios). */
export async function handleWebsitePublic(request, url, env, ctx) {
  const m = url.pathname.match(/^\/w\/(@?[a-z0-9.-]+)(\/.*)?$/i);
  if (!m) return null;
  let slug = m[1].toLowerCase(), rest = m[2] || "", host = null;
  if (slug.startsWith("@")) {
    const key = request.headers.get("x-musa-proxy-key");
    if (!process.env.SITES_PROXY_SECRET || key !== process.env.SITES_PROXY_SECRET) return new Response("No encontrado", { status: 404 });
    host = slug.slice(1);
    slug = await slugForHost(host);
    if (!slug) return out("<!doctype html><meta charset=utf-8><title>Dominio sin website</title><p style='font:16px system-ui;padding:40px'>Este dominio todavía no está conectado a un website de Musa.</p>", "text/html; charset=utf-8", 404);
  } else if (!rest) return new Response(null, { status: 301, headers: { location: "/w/" + slug + "/" + url.search } });
  const s = await loadPublic(slug);
  const isForm = /^\/_form\/[0-9a-f-]{36}$/i.test(rest);
  if (request.method === "OPTIONS" && isForm) return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" } });
  if (!s) return out("<!doctype html><meta charset=utf-8><meta name=robots content=noindex><title>No publicado</title><p style='font:16px system-ui;padding:40px'>Este website no existe o todavía no está publicado.</p>", "text/html; charset=utf-8", 404);
  const path = SR.normPath(rest || "/");
  // dominio principal activo → la dirección de Musa redirige allí (una sola URL para Google)
  if (!host && s.primary && !isForm && request.method === "GET") return new Response(null, { status: 301, headers: { location: "https://" + s.primary + (path === "/" ? "/" : path) + url.search } });
  if (isForm) {
    if (request.method !== "POST") return out("{}", "application/json", 405);
    const token = rest.split("/").pop().toLowerCase();
    if (!JSON.stringify(s.published.pages).includes(token)) return out(JSON.stringify({ error: "Formulario no disponible" }), "application/json", 404, { "access-control-allow-origin": "*" });
    let body; try { body = JSON.parse(await request.text()); } catch { return out(JSON.stringify({ error: "Datos inválidos" }), "application/json", 400, { "access-control-allow-origin": "*" }); }
    const r = await submitPublicForm(db(), token, body);
    if (r.status === 200 && !body.website) {
      const mirror = (async () => { const sec = await getSecret(s.id, "supabase").catch(() => null); if (sec && sec.meta.leads !== false) await sbFetch(sec.meta.url, sec.value, "/rest/v1/musa_leads", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ site: s.slug, form: token, email: r.email || null, data: r.data || {} }) }).catch(() => null); })();
      if (ctx && ctx.waitUntil) ctx.waitUntil(mirror); else await mirror;
    }
    return out(JSON.stringify(r.body), "application/json; charset=utf-8", r.status, { "access-control-allow-origin": "*", "cache-control": "no-store" });
  }
  if (!["GET", "HEAD"].includes(request.method)) return out("Método no permitido", "text/plain", 405);
  const snap = s.published, site = snap.site;
  const origin = host ? "https://" + host : url.origin, base = host ? "" : "/w/" + s.slug;
  const n = nonce();
  const cms = await liveCms(s.id, false);
  const rctx = { origin, base, collections: cms.collections, entries: cms.entries, brand: snap.brand, badge: snap.badge, nonce: n, formAction: base + "/_form/", lang: site.settings?.lang };
  const html = (h, st) => out(request.method === "HEAD" ? null : h, "text/html; charset=utf-8", st, { "content-security-policy": csp(n, !host) });
  const txt = (t, type) => out(t, type);
  if (path === "/robots.txt") return txt(SR.robots(site, rctx), "text/plain; charset=utf-8");
  if (path === "/sitemap.xml") return txt(SR.sitemap(site, snap.pages, cms.collections, cms.entries, rctx), "application/xml; charset=utf-8");
  if (path === "/llms.txt" || path === "/llms-full.txt") { if (site.settings?.ai?.llms === false) return out("No disponible", "text/plain", 404); return txt(SR.llms(site, snap.pages, cms.collections, cms.entries, rctx, path === "/llms-full.txt"), "text/markdown; charset=utf-8"); }
  const hit = (p) => {
    const ua = request.headers.get("user-agent") || "";
    if (request.method !== "GET" || BOT_RX.test(ua) || request.headers.get("purpose") === "prefetch" || request.headers.get("sec-purpose")) return;
    let ref = ""; try { const r = new URL(request.headers.get("referer") || ""); if (r.host !== url.host && r.host !== host) ref = r.host.replace(/^www\./, ""); } catch {}
    const job = db().rpc("v2_site_hit", { p_site: s.id, p_path: p, p_ref: ref }).then(() => null, () => null);
    if (ctx && ctx.waitUntil) ctx.waitUntil(job);
  };
  const page = snap.pages.find((p) => SR.normPath(p.path) === path);
  if (page) { hit(path); return html(SR.renderPage(site, page, rctx)); }
  for (const c of cms.collections) {
    const cp = SR.colPath(c), list = cms.entries[c.slug] || [];
    if (path === cp && c.settings?.listPage !== false) { hit(path); return html(SR.renderList(site, c, list, rctx)); }
    if (path === cp + "/rss.xml" && c.settings?.rss !== false) return txt(SR.rss(site, c, list, rctx), "application/rss+xml; charset=utf-8");
    if (path.startsWith(cp + "/") && c.settings?.detail !== false) {
      const e = list.find((x) => path === SR.entryUrl(c, x));
      if (e) { hit(path); return html(SR.renderEntry(site, c, e, rctx)); }
    }
  }
  return html(SR.renderPage(site, { path: "/404", title: "No encontrado", seo: { noindex: true }, sections: [{ id: "nf", type: "hero", props: { title: "No encontramos esta página", subtitle: "Puede que se haya movido o que el enlace tenga un error.", buttons: [{ label: "Ir al inicio", href: "/" }] }, style: { align: "c" } }] }, rctx), 404);
}

/* ═════════════════════════ herramientas MCP ═════════════════════════ */
const S = (props, required = []) => ({ type: "object", properties: props, required });
const site = { type: "string", description: "id (web_…) o dirección (slug) del website" };
export const WEBSITE_TOOLS = [
  { name: "list_websites", description: "Websites (landings y sitios con CMS) de la persona, en todos sus espacios o en uno. Cada uno con su estado (draft/published), versión y URLs (musa = dirección de Musa /w/slug, domain = dominio propio si está activo).", inputSchema: S({ workspaceId: { type: "string" } }) },
  { name: "get_website", description: "Un website completo: tema, ajustes (SEO, IA, menú, pie, organización), páginas (sin secciones), colecciones del CMS con conteo de entradas, dominios, límites del plan y URLs.", inputSchema: S({ id: site }, ["id"]) },
  { name: "create_website", description: "Crea un website (landing o sitio) desde una plantilla: landing (captación), servicios (inicio + servicios + blog), blog (CMS listo) o blank. PREGUNTA SIEMPRE a la persona en qué espacio va (workspaceId de list_workspaces) y, si tiene, con qué marca (brandId: toma colores, tipografías y logo). slug = su dirección /w/slug (se autogenera). Queda en borrador hasta publish_website.", inputSchema: S({ workspaceId: { type: "string" }, name: { type: "string" }, slug: { type: "string" }, template: { type: "string", enum: ["landing", "servicios", "blog", "blank"] }, brandId: { type: "string" }, preset: { type: "string", enum: ["claro", "oscuro", "editorial", "suave"] }, description: { type: "string" } }, ["workspaceId", "name"]) },
  { name: "update_website", description: "Cambia nombre, dirección (slug), marca, tema o ajustes de un website (se mezclan con lo actual). theme: { preset, accent, bg, fg, muted, surface, line, headingFont, bodyFont, radius, width }. settings: { lang, titleTemplate ('%s · Marca'), tagline, description, ogImage, favicon, logo, nav:[{label,href}], cta:{label,href}, footer:{text,links,legal}, org:{type,name,logo,sameAs[],email,phone,address}, ai:{summary (resumen para buscadores de IA), facts, llms, allowBots}, index, analytics:{ga:'G-…',pixel} }. Requiere publish_website para que se vea.", inputSchema: S({ id: site, name: { type: "string" }, slug: { type: "string" }, brandId: { type: "string" }, theme: { type: "object" }, settings: { type: "object" } }, ["id"]) },
  { name: "delete_website", description: "Borra un website (despublica, quita dominios). Pide confirmación a la persona y llama con confirm:true.", inputSchema: S({ id: site, confirm: { type: "boolean" } }, ["id"]) },
  { name: "list_website_section_types", description: "Tipos de sección disponibles para armar páginas (hero, features, split, logos, stats, testimonials, pricing, faq, cta, form, gallery, collection, text, video, design, html) con sus campos y un ejemplo de cada una; estilos de sección, tipos de campo del CMS, presets de tema y tipografías.", inputSchema: S({}) },
  { name: "get_website_page", description: "Una página con todas sus secciones ({id,type,props,style}) y su SEO, para editarla.", inputSchema: S({ siteId: site, page: { type: "string", description: "id (wpg_…) o ruta (/, /servicios)" } }, ["siteId", "page"]) },
  { name: "save_website_page", description: "Crea o actualiza una página. Para editar: id o path existente; sections REEMPLAZA la lista completa (trae primero get_website_page). Para crear: path nuevo (+ create:true si quieres forzarlo). seo: { title, description, ogImage, canonical, noindex }. hidden:true = no se publica. Enlaces internos con / o #. Guarda en borrador: publica con publish_website.", inputSchema: S({ siteId: site, id: { type: "string" }, path: { type: "string" }, title: { type: "string" }, sections: { type: "array", items: { type: "object" } }, seo: { type: "object" }, hidden: { type: "boolean" }, sort: { type: "number" }, create: { type: "boolean" } }, ["siteId"]) },
  { name: "delete_website_page", description: "Borra una página (no la portada). Se quita de la web al volver a publicar.", inputSchema: S({ siteId: site, id: { type: "string" } }, ["siteId", "id"]) },
  { name: "publish_website", description: "Publica el borrador: páginas, tema y menú pasan a la web pública y se guarda una versión. Devuelve las URLs y avisos (p. ej. formularios sin elegir). El CMS no necesita publicar: sus entradas publicadas salen solas.", inputSchema: S({ id: site, label: { type: "string", description: "Nota de la versión" } }, ["id"]) },
  { name: "unpublish_website", description: "Despublica un website (deja de ser público). No borra nada.", inputSchema: S({ id: site }, ["id"]) },
  { name: "list_website_versions", description: "Historial de publicaciones de un website (últimas 30).", inputSchema: S({ id: site }, ["id"]) },
  { name: "restore_website_version", description: "Vuelve el website a una versión anterior (borrador y, salvo publish:false, también lo publica como versión nueva).", inputSchema: S({ siteId: site, version: { type: ["number", "string"] }, publish: { type: "boolean" } }, ["siteId", "version"]) },
  { name: "save_website_collection", description: "Crea o edita una colección del CMS (blog, productos, casos, equipo…). fields: [{ k, label, type: text|textarea|richtext|image|date|number|url|bool|select|tags, opts? }]. settings: { path ('/blog'), schema (BlogPosting|Article|Product|Service|Event|CreativeWork|Person, para JSON-LD), detail (página por entrada), listPage, rss, title, description, layout }. Muéstrala en una página con una sección type:'collection'.", inputSchema: S({ siteId: site, id: { type: "string" }, name: { type: "string" }, slug: { type: "string" }, fields: { type: "array", items: { type: "object" } }, settings: { type: "object" } }, ["siteId"]) },
  { name: "delete_website_collection", description: "Borra una colección y sus entradas (confirm:true tras preguntar).", inputSchema: S({ siteId: site, id: { type: "string" }, confirm: { type: "boolean" } }, ["siteId", "id"]) },
  { name: "list_website_entries", description: "Entradas de una colección del CMS (con su URL pública). Filtros: status (draft|published), q (título).", inputSchema: S({ siteId: site, collection: { type: "string", description: "slug o id de la colección" }, status: { type: "string" }, q: { type: "string" }, limit: { type: "number" } }, ["siteId", "collection"]) },
  { name: "save_website_entry", description: "Crea o edita una entrada del CMS (contenido dinámico). data = valores por campo de la colección (richtext en markdown). status published = se ve AL INSTANTE en la web (si el website está publicado); publishAt (ISO) la oculta hasta esa fecha. seo: { title, description, ogImage, noindex }.", inputSchema: S({ siteId: site, collection: { type: "string" }, id: { type: "string" }, title: { type: "string" }, slug: { type: "string" }, data: { type: "object" }, status: { type: "string", enum: ["draft", "published"] }, publishAt: { type: "string" }, seo: { type: "object" } }, ["siteId", "collection"]) },
  { name: "delete_website_entry", description: "Borra una entrada del CMS.", inputSchema: S({ siteId: site, id: { type: "string" } }, ["siteId", "id"]) },
  { name: "audit_website", description: "Auditoría SEO / GEO (buscadores de IA) / AEO (respuestas directas) de cada página, sin IA: puntaje 0–100 por área y qué arreglar con su sección. Úsala antes de publicar y para proponer mejoras.", inputSchema: S({ id: site, path: { type: "string" } }, ["id"]) },
  { name: "website_stats", description: "Visitas de un website (personas, sin bots, sin cookies): serie diaria, páginas más vistas, de dónde llegan y leads de sus formularios.", inputSchema: S({ id: site, days: { type: "number" } }, ["id"]) },
  { name: "connect_website_domain", description: "Conecta un dominio propio (www.tumarca.com) a un website. Requiere plan Creador o superior. Devuelve los registros DNS a crear (TXT de verificación y CNAME). Luego check_website_domain.", inputSchema: S({ siteId: site, hostname: { type: "string" } }, ["siteId", "hostname"]) },
  { name: "check_website_domain", description: "Comprueba el DNS y el certificado de un dominio conectado y actualiza su estado (pending → verifying → active).", inputSchema: S({ id: { type: "string" } }, ["id"]) },
  { name: "remove_website_domain", description: "Desconecta un dominio de un website.", inputSchema: S({ id: { type: "string" } }, ["id"]) },
  { name: "website_integrations", description: "Estado de GitHub y Supabase propios de un website (sin mostrar llaves) y el SQL para preparar tu Supabase.", inputSchema: S({ siteId: site }, ["siteId"]) },
  { name: "connect_website_github", description: "Conecta un repositorio de GitHub para subir el sitio como HTML estático. token = fine-grained con Contents: Read and write (se guarda cifrado; si ya hay uno, puedes omitirlo). repo 'usuario/repo', branch, dir (carpeta, opcional), siteUrl (URL donde lo sirves, p. ej. GitHub Pages, para canonical y sitemap).", inputSchema: S({ siteId: site, repo: { type: "string" }, token: { type: "string" }, branch: { type: "string" }, dir: { type: "string" }, siteUrl: { type: "string" } }, ["siteId", "repo"]) },
  { name: "sync_website_github", description: "Sube el sitio publicado (páginas, CMS, sitemap, robots, llms.txt, RSS, 404) en un solo commit al repositorio conectado. Los formularios siguen llegando al CRM de Musa.", inputSchema: S({ siteId: site, message: { type: "string" } }, ["siteId"]) },
  { name: "connect_website_supabase", description: "Conecta TU proyecto de Supabase: los leads de los formularios se copian a musa_leads y el CMS se puede sincronizar a musa_cms_entries. key = llave secreta (service_role), se guarda cifrada. Si faltan las tablas devuelve el SQL a correr.", inputSchema: S({ siteId: site, url: { type: "string" }, key: { type: "string" }, leads: { type: "boolean" }, cms: { type: "boolean" } }, ["siteId", "url"]) },
  { name: "sync_website_supabase", description: "Copia todas las entradas del CMS del website a la tabla musa_cms_entries de tu Supabase (upsert por id).", inputSchema: S({ siteId: site }, ["siteId"]) },
  { name: "disconnect_website_integration", description: "Desconecta GitHub o Supabase de un website (borra la llave guardada).", inputSchema: S({ siteId: site, provider: { type: "string", enum: ["github", "supabase"] } }, ["siteId", "provider"]) },
];
const NEED = (p, k) => { if (p[k] == null || p[k] === "") throw err(-32602, k + " es obligatorio"); };
export async function callWebsiteTool(name, auth, p) {
  p = p || {};
  switch (name) {
    case "list_websites": return { websites: await listWebsites(auth, p.workspaceId || null) };
    case "get_website": NEED(p, "id"); return getWebsite(auth, p.id);
    case "create_website": return createWebsite(auth, p);
    case "update_website": NEED(p, "id"); return updateWebsite(auth, p);
    case "delete_website": NEED(p, "id"); return deleteWebsite(auth, p);
    case "list_website_section_types": return sectionTypes();
    case "get_website_page": NEED(p, "siteId"); return getWebsitePage(auth, p.siteId, p.page || p.path || p.id);
    case "save_website_page": NEED(p, "siteId"); return saveWebsitePage(auth, p);
    case "delete_website_page": NEED(p, "siteId"); NEED(p, "id"); return deleteWebsitePage(auth, p);
    case "publish_website": NEED(p, "id"); return publishWebsite(auth, p);
    case "unpublish_website": NEED(p, "id"); return unpublishWebsite(auth, p);
    case "list_website_versions": NEED(p, "id"); return listWebsiteVersions(auth, p);
    case "restore_website_version": NEED(p, "siteId"); NEED(p, "version"); return restoreWebsiteVersion(auth, p);
    case "save_website_collection": NEED(p, "siteId"); return saveWebsiteCollection(auth, p);
    case "delete_website_collection": NEED(p, "siteId"); return deleteWebsiteCollection(auth, p);
    case "list_website_entries": NEED(p, "siteId"); NEED(p, "collection"); return listWebsiteEntries(auth, p);
    case "save_website_entry": NEED(p, "siteId"); NEED(p, "collection"); return saveWebsiteEntry(auth, p);
    case "delete_website_entry": NEED(p, "siteId"); NEED(p, "id"); return deleteWebsiteEntry(auth, p);
    case "audit_website": NEED(p, "id"); return auditWebsite(auth, p);
    case "website_stats": NEED(p, "id"); return websiteStats(auth, p);
    case "connect_website_domain": NEED(p, "siteId"); return connectWebsiteDomain(auth, p);
    case "check_website_domain": NEED(p, "id"); return checkWebsiteDomain(auth, p);
    case "remove_website_domain": NEED(p, "id"); return removeWebsiteDomain(auth, p);
    case "website_integrations": NEED(p, "siteId"); return websiteIntegrations(auth, p);
    case "connect_website_github": NEED(p, "siteId"); return connectWebsiteGithub(auth, p);
    case "sync_website_github": NEED(p, "siteId"); return syncWebsiteGithub(auth, p);
    case "connect_website_supabase": NEED(p, "siteId"); return connectWebsiteSupabase(auth, p);
    case "sync_website_supabase": NEED(p, "siteId"); return syncWebsiteSupabase(auth, p);
    case "disconnect_website_integration": NEED(p, "siteId"); return disconnectWebsiteIntegration(auth, p);
    default: return undefined;
  }
}
export const WEBSITE_TOOL_NAMES = new Set(WEBSITE_TOOLS.map((t) => t.name));
