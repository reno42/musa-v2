// Códigos QR por MCP (Musa v2): lo mismo que la persona hace en Crear › Códigos QR y con el botón «Código QR» de cada
// cosa, sobre la MISMA tabla (qr_codes) y con las MISMAS reglas (el trigger v2_qr_guard valida en la base: destino
// http(s), código único, tope por espacio). El dibujo sale de public/musa/qr-core.js, el mismo motor que la pantalla.
// El acceso al espacio (viewer para list/get/preview, editor para el resto) lo valida authorizeMcpCall antes.
import QRCore from "qrcode/lib/core/qrcode.js";
import "../../../public/musa/qr-core.js";
import { getSupabaseAdmin } from "../../../api/src/services/supabase.js";
import { canAccessWorkspace } from "../../../api/src/services/tenancy.js";

globalThis.QRCodeLib = globalThis.QRCodeLib || { create: QRCore.create };
const MQ = globalThis.MusaQR;

const STYLE = { type: "object", description: "Estilo (opcional): { fg, bg, eye: '#rrggbb', dots: 'square'|'rounded', eyes: 'square'|'rounded', margin: 0-8, transparent: bool, logo: true (logo de la marca) }" };
const TARGETS = ["design", "presentation", "website", "event", "form", "brief", "quote"];

export const QR_TOOLS = [
  { name: "list_qr_codes", description: "Musa v2 · Códigos QR del espacio (Crear › Códigos QR): nombre, tipo (url, whatsapp, wifi, email, phone, sms, text, vcard), si es dinámico (enlace corto /r/código que redirige y se puede cambiar) o fijo, destino, a qué cosa de Musa apunta (diseño, presentación, website, evento, formulario, brief, cotización), escaneos y estado.", inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, search: { type: "string" }, targetType: { type: "string", enum: TARGETS } }, required: ["workspaceId"] } },
  { name: "get_qr_code", description: "Musa v2 · Un código QR con su SVG listo para usar (para pegarlo en un diseño o entregarlo), su enlace corto, destino, escaneos por día (últimos 30) y países. svg:false para no traer la imagen.", inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, id: { type: "string" }, svg: { type: "boolean" }, style: STYLE }, required: ["workspaceId", "id"] } },
  { name: "qr_create", description: "Musa v2 · Crea un código QR. type url o whatsapp = DINÁMICO (lleva <musa>/r/código: el destino se cambia luego sin reimprimir, se pausa y cuenta escaneos). wifi, email, phone, sms, text, vcard = FIJO (el contenido va dentro del código). Campos por tipo en fields: url {url}; whatsapp {phone, message}; wifi {ssid, password, encryption: WPA|WEP|none, hidden}; email {to, subject, body}; phone {phone}; sms {phone, message}; text {text}; vcard {firstName, lastName, org, title, phone, email, web, address}. Para una cosa de Musa usa qr_for_item.", inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, name: { type: "string" }, type: { type: "string", enum: ["url", "whatsapp", "wifi", "email", "phone", "sms", "text", "vcard"] }, fields: { type: "object" }, brandId: { type: "string" }, style: STYLE }, required: ["workspaceId", "name", "type", "fields"] } },
  { name: "qr_for_item", description: "Musa v2 · El código QR de una cosa de Musa (lo mismo que el botón «Código QR» en su pantalla): design (página pública para ver y descargar el diseño), presentation (la misma página, abre en modo presentar), website (publicado), event (publicado), form, brief, quote. Si esa cosa ya tiene QR lo devuelve (uno por cosa). Un diseño privado necesita makePublic:true (queda compartido con enlace). Devuelve id, shortUrl y svg.", inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, targetType: { type: "string", enum: TARGETS }, targetId: { type: "string" }, makePublic: { type: "boolean" }, style: STYLE }, required: ["workspaceId", "targetType", "targetId"] } },
  { name: "qr_update", description: "Musa v2 · Cambia un código QR: name, url (nuevo destino de un QR dinámico: el impreso sigue sirviendo), active (false = pausado: quien lo escanee ve que está en pausa), style, brandId. Un QR fijo solo cambia nombre y estilo (su contenido va dentro del código: crea otro).", inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, id: { type: "string" }, name: { type: "string" }, url: { type: "string" }, active: { type: "boolean" }, style: STYLE, brandId: { type: "string" } }, required: ["workspaceId", "id"] } },
  { name: "qr_delete", description: "Musa v2 · Borra un código QR (lo puede borrar quien lo creó o un admin del espacio). Un QR dinámico borrado deja de llevar a su destino: quien lo escanee ve que ya no existe. Para dejarlo de usar por un tiempo, mejor qr_update({ active: false }). Pide confirm:true.", inputSchema: { type: "object", properties: { workspaceId: { type: "string" }, id: { type: "string" }, confirm: { type: "boolean" } }, required: ["workspaceId", "id", "confirm"] } },
  { name: "preview_qr", description: "Musa v2 · Dibuja un QR sin guardarlo (SVG): content (texto o enlace tal cual) o type+fields como en qr_create. Útil para un QR de un solo uso; uno impreso conviene que sea dinámico (qr_create) para poder cambiar el destino.", inputSchema: { type: "object", properties: { content: { type: "string" }, type: { type: "string" }, fields: { type: "object" }, style: STYLE }, required: [] } },
];
export const QR_TOOL_NAMES = new Set(QR_TOOLS.map((t) => t.name));

const E = (code, message) => ({ code, message });
const origin = () => String(process.env.URL || "https://musa-v2.renzo-08c.workers.dev").replace(/\/$/, "");
const short = (code) => (code ? `${origin()}/r/${code}` : null);
function db() { const sb = getSupabaseAdmin(); if (!sb) throw E(-32603, "Base de datos no configurada"); return sb; }
function must(r) { if (r.error) throw E(-32000, r.error.message); return r.data; }
const COLS = "id,workspace_id,kind,code,name,content_type,destination_url,content,fields,target_type,target_id,brand_id,style,active,scans,last_scan_at,created_by,created_at,updated_at";

function cleanStyle(s) {
  if (!s || typeof s !== "object") return {};
  const o = {};
  for (const k of ["fg", "bg", "eye"]) { const h = MQ.hex6(s[k]); if (h) o[k] = h; }
  if (s.dots === "rounded" || s.dots === "square") o.dots = s.dots;
  if (s.eyes === "rounded" || s.eyes === "square") o.eyes = s.eyes;
  if (s.margin != null && !isNaN(+s.margin)) o.margin = Math.max(0, Math.min(8, +s.margin));
  if (s.transparent === true) o.transparent = true;
  if (s.logo === true || s.logo === false) o.logo = s.logo;
  return o;
}
/** El logo de la marca como data URL (el SVG queda completo, sin depender de otra web). */
async function brandLogo(sb, ws, brandId) {
  if (!brandId) return null;
  const { data: b } = await sb.from("brands").select("logo").eq("id", brandId).eq("workspace_id", ws).maybeSingle();
  const raw = b && (typeof b.logo === "string" ? b.logo : b.logo && (b.logo.url || b.logo.src));
  if (!raw || !/^https:\/\//.test(raw)) return null;
  try {
    const r = await fetch(raw, { redirect: "follow" });
    const type = (r.headers.get("content-type") || "").split(";")[0];
    if (!r.ok || !/^image\//.test(type)) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > 150000) return null;
    let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return `data:${type};base64,${btoa(bin)}`;
  } catch { return null; }
}
async function render(sb, row, styleOverride) {
  const st = { ...(row.style || {}), ...cleanStyle(styleOverride) };
  const text = row.kind === "dynamic" ? short(row.code) : row.content;
  const logo = st.logo ? await brandLogo(sb, row.workspace_id, row.brand_id) : null;
  return MQ.svg(text, { ...st, logo, size: 1024, title: row.name });
}
function out(row) {
  return {
    id: row.id, name: row.name, type: row.content_type, dynamic: row.kind === "dynamic",
    shortUrl: short(row.code), destination: row.kind === "dynamic" ? row.destination_url : null, content: row.kind === "static" ? row.content : undefined,
    target: row.target_type ? { type: row.target_type, id: row.target_id } : null, brandId: row.brand_id || null,
    active: row.active, scans: row.scans, lastScanAt: row.last_scan_at, style: row.style || {}, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

/** Enlace público de una cosa de Musa (las mismas reglas que el botón de cada pantalla, bridge-qr.js). */
async function itemLink(sb, ws, type, id, makePublic) {
  const o = origin();
  const one = async (table, cols) => {
    const { data } = await sb.from(table).select(cols).eq("id", id).eq("workspace_id", ws).maybeSingle();
    if (!data) throw E(-32004, `No encontrado en este espacio: ${type} ${id}`);
    return data;
  };
  switch (type) {
    case "design": case "presentation": {
      const t = await one("templates", "id,name,is_public,deleted_at,data");
      if (t.deleted_at) throw E(-32004, "Ese diseño está en la papelera");
      if (t.is_public !== true) {
        if (!makePublic) throw E(-32602, "El diseño es privado: el QR lleva a una página pública para verlo y descargarlo. Pide permiso a la persona y llama de nuevo con makePublic:true.");
        must(await sb.from("templates").update({ is_public: true, visibility: "shared" }).eq("id", id).eq("workspace_id", ws));
      }
      return { url: `${o}/v/${id}${type === "presentation" ? "?present=1" : ""}`, name: t.name, brandId: (t.data && t.data.brandId) || null };
    }
    case "website": {
      const s = await one("websites", "id,name,slug,status,deleted_at,brand_id");
      if (s.deleted_at || s.status !== "published" || !s.slug) throw E(-32602, "El website no está publicado: publícalo primero (publish_website)");
      return { url: `${o}/w/${s.slug}/`, name: s.name, brandId: s.brand_id };
    }
    case "event": {
      const e = await one("workspace_events", "id,name,slug,published,brand_id");
      if (!e.published || !e.slug) throw E(-32602, "El evento no está publicado: publícalo primero para que tenga su página");
      return { url: `${o}/e/${e.slug}`, name: e.name, brandId: e.brand_id };
    }
    case "form": {
      const f = await one("workspace_forms", "id,name,public_token,published");
      if (!f.public_token) throw E(-32602, "El formulario todavía no tiene enlace público");
      return { url: `${o}/f/${f.public_token}`, name: f.name, brandId: null, warn: f.published === false ? "El formulario está pausado: quien escanee el QR no podrá responder hasta que lo actives." : null };
    }
    case "brief": {
      const b = await one("briefs", "id,title,public_token,brand_id");
      if (!b.public_token) throw E(-32602, "El brief todavía no tiene enlace público");
      return { url: `${o}/b/${b.public_token}`, name: b.title, brandId: b.brand_id };
    }
    case "quote": {
      const q = await one("crm_quotes", "id,number,title,public_token,brand_id");
      if (!q.public_token) throw E(-32602, "La cotización todavía no tiene enlace público");
      return { url: `${o}/q/${q.public_token}`, name: [q.number, q.title].filter(Boolean).join(" · "), brandId: q.brand_id };
    }
  }
  throw E(-32602, "targetType inválido");
}
const TYPE_ES = { design: "Diseño", presentation: "Presentación", website: "Website", event: "Evento", form: "Formulario", brief: "Brief", quote: "Cotización" };

export async function callQrTool(method, auth, params) {
  if (method === "preview_qr") {
    let content = params.content;
    if (!content) {
      const p = MQ.payload(params.type, params.fields || {});
      if (!p.ok) throw E(-32602, p.error);
      content = p.content;
    }
    try { return { content, svg: MQ.svg(String(content), { ...cleanStyle(params.style), size: 1024 }), warnings: MQ.warnings(cleanStyle(params.style)) }; }
    catch (e) { throw E(-32602, e.message); }
  }
  const ws = String(params.workspaceId || "");
  if (!ws) throw E(-32602, "Falta workspaceId (usa list_workspaces)");
  const sb = db();
  const uid = auth?.userId && /^[0-9a-f-]{36}$/i.test(String(auth.userId)) ? auth.userId : null;
  const get = async (id) => {
    const r = must(await sb.from("qr_codes").select(COLS).eq("id", String(id || "")).eq("workspace_id", ws).maybeSingle());
    if (!r) throw E(-32004, `Código QR no encontrado en este espacio: ${id}`);
    return r;
  };

  switch (method) {
    case "list_qr_codes": {
      let q = sb.from("qr_codes").select(COLS).eq("workspace_id", ws).order("created_at", { ascending: false }).limit(500);
      if (params.targetType) q = q.eq("target_type", params.targetType);
      let rows = must(await q) || [];
      const s = String(params.search || "").trim().toLowerCase();
      if (s) rows = rows.filter((r) => [r.name, r.destination_url, r.content, r.code].some((v) => String(v || "").toLowerCase().includes(s)));
      return { qrCodes: rows.map(out) };
    }
    case "get_qr_code": {
      const row = await get(params.id);
      const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const days = must(await sb.from("qr_scan_days").select("day,country,device,scans").eq("qr_id", row.id).gte("day", since)) || [];
      const byDay = {}, byCountry = {}, byDevice = {};
      for (const d of days) { byDay[d.day] = (byDay[d.day] || 0) + d.scans; if (d.country) byCountry[d.country] = (byCountry[d.country] || 0) + d.scans; if (d.device) byDevice[d.device] = (byDevice[d.device] || 0) + d.scans; }
      return { ...out(row), last30Days: { byDay, byCountry, byDevice }, svg: params.svg === false ? undefined : await render(sb, row, params.style) };
    }
    case "qr_create": {
      const type = String(params.type || "");
      const p = MQ.payload(type, params.fields || {});
      if (!p.ok) throw E(-32602, p.error);
      const dyn = !!(MQ.TYPES[type] && MQ.TYPES[type].dynamic);
      const row = { workspace_id: ws, kind: dyn ? "dynamic" : "static", name: String(params.name || "").trim() || MQ.TYPES[type].label, content_type: type,
        destination_url: dyn ? p.url : null, content: dyn ? null : p.content, fields: params.fields || {}, brand_id: params.brandId || null, style: cleanStyle(params.style), created_by: uid };
      const r = must(await sb.from("qr_codes").insert(row).select(COLS).single());
      return { ...out(r), svg: await render(sb, r) };
    }
    case "qr_for_item": {
      const type = String(params.targetType || ""), id = String(params.targetId || "");
      if (!TARGETS.includes(type) || !id) throw E(-32602, "targetType y targetId son obligatorios");
      const link = await itemLink(sb, ws, type, id, params.makePublic === true);
      const prev = must(await sb.from("qr_codes").select(COLS).eq("workspace_id", ws).eq("target_type", type).eq("target_id", id).maybeSingle());
      let r = prev;
      if (prev && prev.destination_url !== link.url) r = must(await sb.from("qr_codes").update({ destination_url: link.url }).eq("id", prev.id).select(COLS).single());
      if (!prev) {
        r = must(await sb.from("qr_codes").insert({ workspace_id: ws, kind: "dynamic", name: `${TYPE_ES[type]} · ${link.name || id}`.slice(0, 160), content_type: "url", destination_url: link.url,
          fields: { url: link.url }, target_type: type, target_id: id, brand_id: link.brandId || null, style: cleanStyle(params.style), created_by: uid }).select(COLS).single());
      }
      return { ...out(r), reused: !!prev, warning: link.warn || undefined, svg: await render(sb, r, params.style) };
    }
    case "qr_update": {
      const row = await get(params.id);
      const patch = {};
      if (params.name !== undefined) patch.name = String(params.name);
      if (params.style !== undefined) patch.style = { ...(row.style || {}), ...cleanStyle(params.style) };
      if (params.brandId !== undefined) patch.brand_id = params.brandId || null;
      if (params.url !== undefined) {
        if (row.kind !== "dynamic") throw E(-32602, "Este QR es fijo: su contenido va dentro del código. Crea uno nuevo (o uno dinámico).");
        const u = MQ.normalizeUrl(params.url);
        if (!u) throw E(-32602, "Escribe un enlace válido (https://…)");
        if (row.target_type) { patch.target_type = null; patch.target_id = null; }   /* ya no apunta a esa cosa de Musa */
        patch.destination_url = u; patch.fields = { ...(row.fields || {}), url: u };
      }
      if (params.active !== undefined) {
        if (row.kind !== "dynamic") throw E(-32602, "Un QR fijo no se puede pausar: no pasa por Musa");
        patch.active = !!params.active;
      }
      if (!Object.keys(patch).length) return out(row);
      return out(must(await sb.from("qr_codes").update(patch).eq("id", row.id).eq("workspace_id", ws).select(COLS).single()));
    }
    case "qr_delete": {
      if (params.confirm !== true) throw E(-32602, "Confirma con confirm:true (un QR impreso deja de funcionar)");
      const row = await get(params.id);
      const mine = uid && row.created_by === uid;
      if (!mine && !auth?.isAdmin && !(await canAccessWorkspace({ userId: auth?.userId, isAdmin: auth?.isAdmin, authType: auth?.authType || "user", workspaceId: auth?.workspaceId, workspaceRole: auth?.workspaceRole }, ws, "admin"))) {
        throw E(-32003, "Solo quien creó el QR o un admin del espacio lo puede borrar. Para dejarlo de usar: qr_update({ active: false }).");
      }
      must(await sb.from("qr_codes").delete().eq("id", row.id).eq("workspace_id", ws));
      return { id: row.id, deleted: true };
    }
  }
  throw E(-32601, `Herramienta desconocida: ${method}`);
}
