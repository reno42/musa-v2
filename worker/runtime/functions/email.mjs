// Correo real — Musa v2. Cada espacio elige Resend o Postmark y usa la llave BYOK de quien lo configuró.
//   GET  /api/email/settings?workspaceId=          → configuración (sin secretos) y si hay llave
//   PUT  /api/email/settings                        { workspaceId, provider, fromEmail, fromName?, replyTo?, postmarkStream? }
//   POST /api/email/test                            { workspaceId, to?, subject?, html? }
//   POST /api/email/mailings/:id/send               { workspaceId, html?, dryRun?, offset? }   (campaña ahora)
//   POST /api/email/mailings/:id/schedule           { workspaceId, html?, at }                 (solo Resend, listas chicas)
//   POST /api/email/sequences/:id/activate          { workspaceId }                            (paso día 0 ahora; los demás programados en Resend)
// Sin crons: nada se envía solo salvo lo que el propio proveedor programa (scheduled_at de Resend).
import { getSupabaseAdmin } from "../../../api/src/services/supabase.js";
import { canAccessWorkspace } from "../../../api/src/services/tenancy.js";
import { getUserKey } from "./keys.mjs";
import { decodeHandlerBody, JSON_UTF8_CONTENT_TYPE } from "./http-encoding.mjs";

const cors = () => ({ "Content-Type": JSON_UTF8_CONTENT_TYPE, "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS" });
const out = (statusCode, data) => ({ statusCode, headers: cors(), body: JSON.stringify(data) });
const EMAIL_RX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_BATCHES = 30; // plan Free: 50 subrequests por ejecución (las consultas a la base también cuentan)
const BATCH = { resend: 100, postmark: 500 };
const escHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export async function loadEmailConfig(sb, workspaceId) {
  const { data: st } = await sb.from("workspace_email_settings").select("*").eq("workspace_id", workspaceId).maybeSingle();
  if (st) {
    const { key } = await getUserKey(st.owner_user_id, st.provider).catch(() => ({ key: null }));
    if (key) return { st, key, from: st.from_name ? `${st.from_name.replace(/[<>"]/g, "")} <${st.from_email}>` : st.from_email };
  }
  // sin correo propio: el Resend de Musa, dentro del cupo mensual del plan (se registra como provider «musa»)
  const pk = process.env.RESEND_API_KEY, pf = process.env.RESEND_FROM_EMAIL;
  if (pk && pf) {
    const { data: q } = await sb.rpc("v2_email_quota", { p_workspace: workspaceId });
    const remaining = q?.limit == null ? Infinity : Math.max(0, q.limit - (q.used || 0));
    const name = String(st?.from_name || "Musa").replace(/[<>"]/g, "");
    return { st: { provider: "resend", reply_to: st?.reply_to || null }, key: pk, from: `${name} <${pf}>`, platform: true, remaining, logProvider: "musa" };
  }
  if (!st) return { error: "Este espacio todavía no tiene correo configurado: conecta Resend o Postmark en Configuración › Integraciones." };
  return { error: `Falta la llave de ${st.provider === "resend" ? "Resend" : "Postmark"} de quien configuró el correo.` };
}

function personalize(html, c) {
  return String(html || "").replace(/\{\{\s*(nombre|first_name)\s*\}\}/gi, escHtml(c.first_name || "")).replace(/\{\{\s*(apellido|last_name)\s*\}\}/gi, escHtml(c.last_name || "")).replace(/\{\{\s*email\s*\}\}/gi, escHtml(c.email || ""));
}
function withFooter(html, unsubUrl, brandName) {
  if (!unsubUrl) return html;
  const foot = `<div style="max-width:600px;margin:24px auto 0;padding:16px;font:12px/1.5 Arial,sans-serif;color:#888;text-align:center">${brandName ? escHtml(brandName) + " · " : ""}¿No quieres recibir más correos? <a href="${unsubUrl}" style="color:#888">Darte de baja</a></div>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, foot + "</body>") : html + foot;
}

/** Envía mensajes ya armados [{ to, subject, html, unsubUrl?, contactId?, scheduledAt? }]. Devuelve { sent, scheduled, failed, errors[], log[] } */
export async function sendMessages(cfg, messages, { stream } = {}) {
  const { st, key, from } = cfg, res = { sent: 0, scheduled: 0, failed: 0, errors: [], log: [] };
  if (cfg.platform && messages.length > cfg.remaining) {
    // cupo del plan: lo que no entra no se envía
    const over = messages.slice(cfg.remaining);
    messages = messages.slice(0, cfg.remaining);
    res.failed += over.length;
    res.errors.push(`Llegaste al límite de correos de tu plan este mes (${over.length} sin enviar). Mejora tu plan o conecta tu propio Resend.`);
    over.forEach((m) => res.log.push({ m, status: "error", error: "LIMIT_EMAILS" }));
  }
  const replyTo = st.reply_to || undefined;
  if (st.provider === "resend") {
    const now = messages.filter((m) => !m.scheduledAt), later = messages.filter((m) => m.scheduledAt);
    for (let i = 0; i < now.length; i += BATCH.resend) {
      const chunk = now.slice(i, i + BATCH.resend);
      const r = await fetch("https://api.resend.com/emails/batch", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(chunk.map((m) => ({ from, to: [m.to], subject: m.subject, html: m.html, ...(replyTo ? { reply_to: replyTo } : {}), ...(m.unsubUrl ? { headers: { "List-Unsubscribe": `<${m.unsubUrl}>` } } : {}) }))) });
      const j = await r.json().catch(() => null);
      if (!r.ok) { res.failed += chunk.length; res.errors.push(`Resend ${r.status}: ${j?.message || j?.name || "error"}`); chunk.forEach((m) => res.log.push({ m, status: "error", error: j?.message || String(r.status) })); continue; }
      const ids = (j?.data || []).map((x) => x.id);
      chunk.forEach((m, k) => res.log.push({ m, status: "enviado", id: ids[k] || null }));
      res.sent += chunk.length;
    }
    for (const m of later) {
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [m.to], subject: m.subject, html: m.html, scheduled_at: m.scheduledAt, ...(replyTo ? { reply_to: replyTo } : {}), ...(m.unsubUrl ? { headers: { "List-Unsubscribe": `<${m.unsubUrl}>` } } : {}) }) });
      const j = await r.json().catch(() => null);
      if (!r.ok) { res.failed++; res.errors.push(`Resend ${r.status}: ${j?.message || "no se pudo programar"}`); res.log.push({ m, status: "error", error: j?.message || String(r.status) }); continue; }
      res.scheduled++; res.log.push({ m, status: "programado", id: j?.id || null });
    }
    return res;
  }
  // Postmark
  const ms = stream || st.postmark_stream || "broadcast";
  if (messages.some((m) => m.scheduledAt)) { res.errors.push("Postmark no programa envíos: usa Resend para recordatorios y secuencias."); }
  const now = messages.filter((m) => !m.scheduledAt);
  for (let i = 0; i < now.length; i += BATCH.postmark) {
    const chunk = now.slice(i, i + BATCH.postmark);
    const r = await fetch("https://api.postmarkapp.com/email/batch", { method: "POST", headers: { "X-Postmark-Server-Token": key, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(chunk.map((m) => ({ From: from, To: m.to, Subject: m.subject, HtmlBody: m.html, MessageStream: ms, ...(replyTo ? { ReplyTo: replyTo } : {}), ...(m.unsubUrl ? { Headers: [{ Name: "List-Unsubscribe", Value: `<${m.unsubUrl}>` }] } : {}) }))) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(j)) { res.failed += chunk.length; res.errors.push(`Postmark ${r.status}: ${j?.Message || "error"}`); chunk.forEach((m) => res.log.push({ m, status: "error", error: j?.Message || String(r.status) })); continue; }
    j.forEach((x, k) => { const ok = x.ErrorCode === 0; ok ? res.sent++ : res.failed++; if (!ok) res.errors.push(`Postmark: ${x.Message}`); res.log.push({ m: chunk[k], status: ok ? "enviado" : "error", id: x.MessageID || null, error: ok ? null : x.Message }); });
  }
  return res;
}

export async function logSends(sb, workspaceId, provider, log, extra) {
  if (!log.length) return;
  const rows = log.map((x) => ({ workspace_id: workspaceId, to_email: x.m.to, contact_id: x.m.contactId || null, provider, provider_id: x.id || null, status: x.status, error: x.error ? String(x.error).slice(0, 500) : null, scheduled_at: x.m.scheduledAt || null, ...extra }));
  await sb.from("workspace_email_sends").insert(rows).then(() => {}, () => {});
}

/** Contactos de la audiencia de un mailing (sin bajas). */
async function audience(sb, ws, content) {
  const seg = String(content?.seg || "Todos").toLowerCase();
  const ev = seg.match(/inscritos\s*·\s*(.+)$/i);
  if (ev) {
    const { data: e } = await sb.from("workspace_events").select("id").eq("workspace_id", ws).ilike("name", ev[1].trim()).maybeSingle();
    if (!e) return [];
    const { data: regs } = await sb.from("workspace_event_regs").select("email,name").eq("event_id", e.id).limit(5000);
    const emails = [...new Set((regs || []).map((r) => (r.email || "").toLowerCase()).filter((x) => EMAIL_RX.test(x)))];
    if (!emails.length) return [];
    const { data: cs } = await sb.from("crm_contacts").select("id,first_name,last_name,email,unsubscribe_token,email_opt_out").eq("workspace_id", ws).in("email", emails);
    const by = {}; (cs || []).forEach((c) => { by[(c.email || "").toLowerCase()] = c; });
    return emails.map((em) => by[em] || { email: em, first_name: ((regs || []).find((r) => (r.email || "").toLowerCase() === em)?.name || "").split(" ")[0] }).filter((c) => !c.email_opt_out);
  }
  let q = sb.from("crm_contacts").select("id,first_name,last_name,email,unsubscribe_token").eq("workspace_id", ws).eq("email_opt_out", false).not("email", "is", null).limit(20000);
  if (content?.brand_id) q = q.eq("brand_id", content.brand_id);
  if (/lead|nuevo|prospect/.test(seg)) q = q.eq("status", "lead");
  else if (/inactiv/.test(seg)) q = q.eq("status", "inactive");
  else if (/client|activ/.test(seg)) q = q.eq("status", "active");
  const { data } = await q;
  const seen = {};
  return (data || []).filter((c) => { const e = (c.email || "").toLowerCase(); if (!EMAIL_RX.test(e) || seen[e]) return false; seen[e] = 1; return true; });
}
const unsubUrl = (origin, c) => (c.unsubscribe_token ? `${origin}/u/${c.unsubscribe_token}` : null);

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
  const sb = getSupabaseAdmin();
  if (!sb) return out(503, { error: "Base de datos no configurada" });
  const bearer = (event.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return out(401, { error: "Inicia sesión" });
  let userId;
  try { const { data, error } = await sb.auth.getUser(bearer); if (error || !data?.user) return out(401, { error: "Sesión inválida" }); userId = data.user.id; } catch { return out(401, { error: "Sesión inválida" }); }
  return emailCore(event, userId);
}

/** Núcleo del /api/email con el usuario ya autenticado. Lo usa también el
 *  servidor MCP (mismas reglas y permisos que la web: paridad humano ↔ IA). */
export async function emailCore(event, userId) {
  const sb = getSupabaseAdmin();
  if (!sb) return out(503, { error: "Base de datos no configurada" });
  const segs = (event.path || "").replace(/^\/+|\/+$/g, "").split("/"); // api, email, ...
  const sub = segs[2], id = segs[3], action = segs[4];
  let body = {};
  if (event.httpMethod !== "GET") { try { body = JSON.parse(decodeHandlerBody(event, "{}")); } catch { return out(400, { error: "JSON inválido" }); } }
  const ws = String((event.httpMethod === "GET" ? event.queryStringParameters?.workspaceId : body.workspaceId) || "");
  if (!ws) return out(400, { error: "Falta workspaceId" });
  const auth = { userId, isAdmin: false, authType: "user" };
  const need = async (role) => (await canAccessWorkspace(auth, ws, role)) ? null : out(403, { error: `Necesitas rol ${role} en este espacio` });
  const origin = String(process.env.EVENTS_PUBLIC_ORIGIN || process.env.URL || "").replace(/\/$/, "") || `https://${event.headers?.host || ""}`;

  if (sub === "settings" && event.httpMethod === "GET") {
    const deny = await need("viewer"); if (deny) return deny;
    const { data: st } = await sb.from("workspace_email_settings").select("provider,from_email,from_name,reply_to,postmark_stream,owner_user_id,updated_at").eq("workspace_id", ws).maybeSingle();
    const mine = {}; for (const p of ["resend", "postmark"]) { const { key } = await getUserKey(userId, p).catch(() => ({ key: null })); mine[p] = !!key; }
    return out(200, { settings: st ? { ...st, isOwner: st.owner_user_id === userId } : null, myKeys: mine });
  }
  if (sub === "settings" && event.httpMethod === "PUT") {
    const deny = await need("admin"); if (deny) return deny;
    const provider = body.provider === "postmark" ? "postmark" : body.provider === "resend" ? "resend" : null;
    if (!provider) return out(400, { error: "Elige Resend o Postmark" });
    const fromEmail = String(body.fromEmail || "").trim().toLowerCase();
    if (!EMAIL_RX.test(fromEmail)) return out(400, { error: "El remitente debe ser un correo válido de tu dominio verificado" });
    const { key } = await getUserKey(userId, provider).catch(() => ({ key: null }));
    if (!key) return out(400, { error: `Primero vincula tu llave de ${provider === "resend" ? "Resend" : "Postmark"}` });
    // validar la llave contra el proveedor
    const ok = provider === "resend"
      ? await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${key}` } }).then(async (r) => { if (r.ok) return true; const j = await r.json().catch(() => null); return j?.name === "restricted_api_key"; /* llave de solo envío: válida */ }, () => false)
      : await fetch("https://api.postmarkapp.com/server", { headers: { "X-Postmark-Server-Token": key, Accept: "application/json" } }).then((r) => r.ok, () => false);
    if (!ok) return out(400, { error: "La llave no fue aceptada por el proveedor" });
    const row = { workspace_id: ws, provider, from_email: fromEmail, from_name: String(body.fromName || "").trim().slice(0, 80) || null, reply_to: EMAIL_RX.test(String(body.replyTo || "")) ? String(body.replyTo).trim() : null, postmark_stream: String(body.postmarkStream || "broadcast").trim().slice(0, 60) || "broadcast", owner_user_id: userId, updated_at: new Date().toISOString() };
    const { error } = await sb.from("workspace_email_settings").upsert(row, { onConflict: "workspace_id" });
    if (error) return out(500, { error: error.message });
    return out(200, { ok: true, settings: row });
  }

  const deny = await need("editor"); if (deny) return deny;
  const cfg = await loadEmailConfig(sb, ws);
  if (cfg.error) return out(400, { error: cfg.error });

  if (sub === "test" && event.httpMethod === "POST") {
    const { data: u } = await sb.auth.admin.getUserById(userId);
    const to = EMAIL_RX.test(String(body.to || "")) ? String(body.to) : u?.user?.email;
    if (!to) return out(400, { error: "No hay correo de destino" });
    const html = body.html || `<div style="font:16px/1.5 Arial,sans-serif;max-width:560px;margin:auto"><h2>Prueba de correo</h2><p>Si lees esto, ${cfg.st.provider === "resend" ? "Resend" : "Postmark"} quedó bien conectado a tu espacio en Musa.</p></div>`;
    const r = await sendMessages(cfg, [{ to, subject: body.subject ? "[Prueba] " + String(body.subject).slice(0, 200) : "Prueba de correo · Musa", html }], { stream: "outbound" });
    await logSends(sb, ws, cfg.logProvider || cfg.st.provider, r.log, { kind: "prueba" });
    return r.sent ? out(200, { ok: true, to }) : out(502, { error: r.errors[0] || "No se pudo enviar" });
  }

  if (sub === "send" && event.httpMethod === "POST") {
    const to = String(body.to || "").trim().toLowerCase();
    if (!EMAIL_RX.test(to)) return out(400, { error: "Revisa el correo de destino" });
    if (!body.subject || !body.html) return out(400, { error: "Falta asunto o contenido" });
    const r = await sendMessages(cfg, [{ to, subject: String(body.subject).slice(0, 300), html: String(body.html).slice(0, 200000) }], { stream: "outbound" });
    await logSends(sb, ws, cfg.logProvider || cfg.st.provider, r.log, { kind: "enlace" });
    return r.sent ? out(200, { ok: true }) : out(502, { error: r.errors[0] || "No se pudo enviar" });
  }

  if (sub === "mailings" && id && (action === "send" || action === "schedule") && event.httpMethod === "POST") {
    const { data: m } = await sb.from("workspace_mailings").select("id,subject,status,kind,content").eq("id", id).eq("workspace_id", ws).maybeSingle();
    if (!m) return out(404, { error: "Mailing no encontrado" });
    const html = m.content?.html || body.html;
    if (!html) return out(400, { error: "El mailing no tiene cuerpo: ábrelo en el editor y guárdalo" });
    if (!m.subject) return out(400, { error: "Falta el asunto" });
    const { data: brand } = m.content?.brand_id ? await sb.from("brands").select("name").eq("id", m.content.brand_id).maybeSingle() : { data: null };
    const people = await audience(sb, ws, m.content);
    if (body.dryRun) return out(200, { recipients: people.length });
    if (!people.length) return out(400, { error: "La audiencia no tiene contactos con correo (o se dieron de baja)" });
    const offset = Math.max(0, Number(body.offset) || 0);
    const at = action === "schedule" ? new Date(body.at) : null;
    if (action === "schedule") {
      if (cfg.st.provider !== "resend") return out(400, { error: "Programar solo funciona con Resend. Con Postmark, envía en el momento." });
      if (!at || isNaN(at) || at.getTime() < Date.now() + 60000) return out(400, { error: "Elige una fecha futura" });
      if (people.length > 40) return out(400, { error: `Resend solo programa de a un correo y el plan actual permite ~40 por vez; esta audiencia tiene ${people.length}. Envíala en el momento.` });
    }
    const cap = (cfg.st.provider === "resend" ? BATCH.resend : BATCH.postmark) * MAX_BATCHES;
    const slice = people.slice(offset, offset + (at ? 40 : cap));
    const msgs = slice.map((c) => { const u = unsubUrl(origin, c); return { to: c.email, contactId: c.id || null, subject: m.subject, html: withFooter(personalize(html, c), u, brand?.name), unsubUrl: u, scheduledAt: at ? at.toISOString() : undefined }; });
    const r = await sendMessages(cfg, msgs);
    await logSends(sb, ws, cfg.logProvider || cfg.st.provider, r.log, { mailing_id: m.id, kind: "campana" });
    const done = offset + slice.length >= people.length;
    const content = { ...(m.content || {}), sent: (Number(m.content?.sent) || 0) + r.sent + r.scheduled, html };
    await sb.from("workspace_mailings").update({ status: at ? "programado" : done ? "enviada" : "enviando", send_at: at ? at.toISOString() : new Date().toISOString(), content }).eq("id", m.id);
    return out(200, { ok: r.sent + r.scheduled > 0, sent: r.sent, scheduled: r.scheduled, failed: r.failed, errors: r.errors.slice(0, 5), total: people.length, nextOffset: done ? null : offset + slice.length });
  }

  if (sub === "sequences" && id && action === "activate" && event.httpMethod === "POST") {
    const { data: m } = await sb.from("workspace_mailings").select("id,subject,content").eq("id", id).eq("workspace_id", ws).eq("kind", "secuencia").maybeSingle();
    if (!m) return out(404, { error: "Secuencia no encontrada" });
    const steps = (m.content?.steps || []).filter((s) => s.subject);
    if (!steps.length) return out(400, { error: "La secuencia no tiene correos" });
    const people = await audience(sb, ws, { ...m.content, seg: (m.content?.groups || [])[0] || m.content?.seg });
    if (!people.length) return out(400, { error: "Nadie en el grupo de entrada tiene correo" });
    const later = steps.filter((s) => Number(s.d) > 0);
    if (later.length && cfg.st.provider !== "resend") return out(400, { error: "Los correos de días posteriores necesitan Resend (programa los envíos). Con Postmark deja solo el paso del día 0." });
    const total = people.length * steps.length;
    if (total > 40 && later.length) return out(400, { error: `Programar ${total} correos supera lo que el plan actual permite por vez (~40). Reduce el grupo o los pasos.` });
    const base = Date.now();
    const msgs = [];
    people.forEach((c) => steps.forEach((s) => { const u = unsubUrl(origin, c); const body0 = s.html || `<div style="font:16px/1.5 Arial,sans-serif;max-width:560px;margin:auto"><p>Hola {{nombre}},</p><p>${escHtml(s.subject)}</p></div>`; msgs.push({ to: c.email, contactId: c.id || null, subject: s.subject, html: withFooter(personalize(body0, c), u), unsubUrl: u, scheduledAt: Number(s.d) > 0 ? new Date(base + Number(s.d) * 86400000).toISOString() : undefined }); }));
    const r = await sendMessages(cfg, msgs);
    await logSends(sb, ws, cfg.logProvider || cfg.st.provider, r.log, { mailing_id: m.id, kind: "secuencia" });
    await sb.from("workspace_mailings").update({ status: "activa", content: { ...m.content, inside: people.length } }).eq("id", m.id);
    return out(200, { ok: true, sent: r.sent, scheduled: r.scheduled, failed: r.failed, errors: r.errors.slice(0, 5), people: people.length });
  }
  return out(404, { error: "Ruta de correo no encontrada" });
}

/** Correos del evento al inscribirse: confirmación ya y recordatorios (1 día y 1 hora antes) si el proveedor es Resend. */
export async function sendEventEmails(sb, ev, reg, pageUrl) {
  const cfg = await loadEmailConfig(sb, ev.workspace_id);
  if (cfg.error) return { skipped: cfg.error };
  const tz = ev.timezone || "America/Lima";
  const when = ev.start.toLocaleString("es-PE", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: tz });
  const box = (title, txt) => `<div style="font:16px/1.55 Arial,sans-serif;max-width:560px;margin:auto;color:#111"><h2 style="margin:0 0 8px">${escHtml(title)}</h2><p>Hola ${escHtml((reg.name || "").split(" ")[0])},</p><p>${txt}</p><p><b>${escHtml(ev.name)}</b><br>${escHtml(when)} (hora de ${escHtml(tz.split("/").pop().replace(/_/g, " "))})</p>${ev.link ? `<p><a href="${escHtml(ev.link)}" style="display:inline-block;background:#ff5e00;color:#fff;padding:10px 18px;border-radius:50px;text-decoration:none;font-weight:700">Entrar a la sala</a></p>` : ""}<p style="font-size:13px;color:#666"><a href="${pageUrl}.ics">Agregar a mi calendario</a> · <a href="${pageUrl}">Ver el evento</a></p></div>`;
  const msgs = [{ to: reg.email, subject: `Estás dentro: ${ev.name}`, html: box("¡Inscripción confirmada!", "Te esperamos. Guarda la fecha:") }];
  if (cfg.st.provider === "resend") {
    const d1 = ev.start.getTime() - 86400000, h1 = ev.start.getTime() - 3600000;
    if (d1 > Date.now() + 120000) msgs.push({ to: reg.email, subject: `Mañana: ${ev.name}`, html: box("Es mañana", "Te recordamos que mañana es el evento."), scheduledAt: new Date(d1).toISOString() });
    if (h1 > Date.now() + 120000) msgs.push({ to: reg.email, subject: `En 1 hora: ${ev.name}`, html: box("Empezamos en 1 hora", "Ten a mano el enlace de la sala."), scheduledAt: new Date(h1).toISOString() });
  }
  const r = await sendMessages(cfg, msgs, { stream: "outbound" });
  await logSends(sb, ev.workspace_id, cfg.logProvider || cfg.st.provider, r.log, { event_id: ev.id, kind: "evento" });
  return r;
}
