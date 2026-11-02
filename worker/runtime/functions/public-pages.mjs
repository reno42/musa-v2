// Páginas públicas sin cuenta — Musa v2.
//   /f/:token  formulario publicado → respuesta + lead en el CRM
//   /b/:token  brief para que el cliente lo complete
//   /q/:token  portal de la cotización: el cliente la aprueba (firma con su nombre) o pide cambios
//   /u/:token  baja de correos
// El token es aleatorio (public_token / unsubscribe_token); nunca se expone el id interno ni datos de otros clientes.
import { getSupabaseAdmin } from "../../../api/src/services/supabase.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const html = (b, status = 200) => new Response(b, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "SAMEORIGIN", "Referrer-Policy": "no-referrer" } });
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const EMAIL_RX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const money = (n, c) => (c === "USD" ? "US$ " : "S/ ") + Number(n || 0).toLocaleString("es-PE", { maximumFractionDigits: 2 });

async function brandOf(sb, id) {
  if (!id) return null;
  const { data } = await sb.from("brands").select("name,colors").eq("id", id).maybeSingle();
  return data;
}
const colorOf = (b) => (Array.isArray(b?.colors) && (b.colors[0]?.hex || (typeof b.colors[0] === "string" ? b.colors[0] : null))) || "#ff5e00";

function shell(title, color, inner, script = "") {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f3f1e7;color:#111;font:15px/1.55 Inter,system-ui,-apple-system,sans-serif}.w{max-width:720px;margin:0 auto;padding:36px 20px 60px}
.k{display:inline-block;font:800 11px/1 Inter,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:${esc(color)};margin-bottom:8px}h1{font:800 clamp(26px,4vw,38px)/1.1 Inter,sans-serif;margin:0 0 10px}.sub{color:#555;margin:0 0 22px}
.card{background:#fff;border-radius:16px;padding:22px;box-shadow:0 1px 0 #e6e3d6;display:flex;flex-direction:column;gap:12px}label{display:flex;flex-direction:column;gap:5px;font-weight:600;font-size:13px}
input,textarea,select{border:1.5px solid #d6d4c6;border-radius:10px;padding:11px 12px;font:inherit;font-weight:400;background:#fff}input:focus,textarea:focus{outline:0;border-color:${esc(color)}}textarea{min-height:90px;resize:vertical}
button{background:${esc(color)};color:#fff;border:0;border-radius:50px;padding:12px 20px;font:700 15px Inter,sans-serif;cursor:pointer}button.g{background:#111}button:disabled{opacity:.6}.row{display:flex;gap:8px;flex-wrap:wrap}
.er{color:#c22;font-size:13px;margin:0;min-height:1em}.ok{background:#fff;border-radius:16px;padding:22px}.hp{position:absolute;left:-9999px}table{width:100%;border-collapse:collapse;font-size:14px}th{text-align:left;font-size:12px;color:#777;font-weight:600;padding:8px 0;border-bottom:1px solid #e6e3d6}td{padding:9px 0;border-bottom:1px solid #f0eee4}.r{text-align:right}.tot{font:800 22px Inter,sans-serif}
.pill{display:inline-block;padding:3px 10px;border-radius:50px;font-size:12px;font-weight:700;background:#eee}.foot{margin-top:28px;text-align:center;font-size:12px;color:#999}.foot a{color:#999}</style></head>
<body><main class="w">${inner}<div class="foot">Hecho con <a href="https://futuraria.com" target="_blank" rel="noopener">Musa · Futuraria</a></div></main>${script ? `<script>${script}</script>` : ""}</body></html>`;
}
const notFound = (what) => html(shell("No disponible", "#ff5e00", `<h1>${esc(what)} no disponible</h1><p class="sub">El enlace no existe o ya no está activo. Pide uno nuevo a quien te lo envió.</p>`), 404);
const postJS = (successHtml) => `var f=document.getElementById("f");f.onsubmit=function(e){e.preventDefault();var b=e.submitter||f.querySelector("button"),er=document.getElementById("er");var d=Object.fromEntries(new FormData(f));if(b&&b.name)d[b.name]=b.value;[].forEach.call(f.querySelectorAll("button"),function(x){x.disabled=true});er.textContent="";
fetch(location.pathname,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||"No se pudo enviar");return j;});})
.then(function(j){document.getElementById("box").innerHTML=${successHtml};}).catch(function(x){[].forEach.call(f.querySelectorAll("button"),function(y){y.disabled=false});er.textContent=x.message;});};`;

/* ───────── formularios ───────── */
const FIELD_TYPE = { Email: "email", Teléfono: "tel", Párrafo: "textarea", Número: "number", Fecha: "date" };
async function form(req, sb, token) {
  const { data: f } = await sb.from("workspace_forms").select("id,workspace_id,name,published,schema,response_count,created_by").eq("public_token", token).maybeSingle();
  if (!f || !f.published) return notFound("Formulario");
  const sch = f.schema || {}, fields = (sch.fields || []).slice(0, 40), brand = await brandOf(sb, sch.brand_id), color = colorOf(brand);
  if (req.method === "POST") {
    let b; try { b = await req.json(); } catch { return json({ error: "Datos inválidos" }, 400); }
    if (b.website) return json({ ok: true });
    const data = {};
    for (const x of fields) {
      const v = String(b[x.name] ?? "").trim().slice(0, 4000);
      if (x.required && !v) return json({ error: `Falta: ${x.label || x.name}` }, 400);
      if (v && (FIELD_TYPE[x.type] === "email") && !EMAIL_RX.test(v)) return json({ error: "Revisa el correo" }, 400);
      data[x.name] = v;
    }
    const email = Object.entries(data).find(([k]) => /mail/i.test(k))?.[1]?.toLowerCase() || null;
    let contactId = null;
    if (email && f.created_by) {
      const { data: ex } = await sb.from("crm_contacts").select("id").eq("workspace_id", f.workspace_id).ilike("email", email).maybeSingle();
      if (ex) contactId = ex.id;
      else {
        const name = String(data.nombre || data.name || "").trim(), [first, ...rest] = (name || email.split("@")[0]).split(/\s+/);
        const { data: c } = await sb.from("crm_contacts").insert({ workspace_id: f.workspace_id, brand_id: sch.brand_id || null, brand_name: brand?.name || null, first_name: first, last_name: rest.join(" ") || null, email, phone: data.telefono || data.phone || null, company: data.empresa || null, status: "lead", tags: ["formulario"], notes: data.mensaje || null, created_by: f.created_by, origin_source: "formulario", origin_post_ref: "form:" + f.id }).select("id").maybeSingle();
        contactId = c?.id || null;
      }
    }
    const { error } = await sb.from("workspace_form_responses").insert({ workspace_id: f.workspace_id, form_id: f.id, data, email, contact_id: contactId });
    if (error) return json({ error: "No se pudo enviar, intenta otra vez" }, 500);
    await sb.from("workspace_forms").update({ response_count: (f.response_count || 0) + 1 }).eq("id", f.id);
    return json({ ok: true });
  }
  const inputs = fields.map((x) => {
    const t = FIELD_TYPE[x.type] || "text", req = x.required ? " required" : "", lab = `${esc(x.label || x.name)}${x.required ? " *" : ""}`;
    return t === "textarea" ? `<label>${lab}<textarea name="${esc(x.name)}" maxlength="4000"${req}></textarea></label>` : `<label>${lab}<input type="${t}" name="${esc(x.name)}" maxlength="400"${req}></label>`;
  }).join("");
  return html(shell(f.name, color, `<span class="k">${esc(brand?.name || "Formulario")}</span><h1>${esc(f.name)}</h1><p class="sub">${esc(sch.description || (sch.type ? sch.type : "Déjanos tus datos y te contactamos."))}</p>
<div id="box"><form id="f" class="card">${inputs}<input name="website" class="hp" tabindex="-1" autocomplete="off"><button>Enviar</button><p class="er" id="er"></p></form></div>`,
    postJS(`'<div class="ok"><h2 style="margin:0 0 6px">¡Gracias!</h2><p style="margin:0">Recibimos tus datos. Te contactaremos pronto.</p></div>'`)));
}

/* ───────── brief del cliente ───────── */
const BRIEF_FIELDS = [["objective", "Objetivo", "¿Qué quieres lograr?", 1], ["audience", "Público", "¿A quién le hablamos?", 0], ["tone", "Tono", "Ej.: cercano, experto, divertido", 0], ["message", "Mensaje clave", "La idea que no puede faltar", 0], ["deliverables", "Entregables", "Ej.: 12 posts, 4 reels, 1 landing", 0], ["channels", "Canales", "Instagram, TikTok, web…", 0], ["dates", "Fechas", "Cuándo lo necesitas", 0], ["budget", "Presupuesto", "Monto aproximado", 0]];
async function brief(req, sb, token) {
  const { data: b } = await sb.from("briefs").select("id,workspace_id,brand_id,brand_name,title,status,objective,audience,tone,deliverables,content,due_date,budget").eq("public_token", token).maybeSingle();
  if (!b || b.status === "archivado") return notFound("Brief");
  const brand = await brandOf(sb, b.brand_id), color = colorOf(brand), c = b.content || {};
  const cur = { objective: b.objective, audience: b.audience, tone: b.tone, message: c.message, deliverables: (b.deliverables || []).join(", "), channels: c.channels, dates: c.dates || b.due_date, budget: c.budget || b.budget };
  const locked = b.status === "en_proyecto";
  if (req.method === "POST") {
    if (locked) return json({ error: "Este brief ya está en producción; escríbele a tu contacto para cambios." }, 409);
    let x; try { x = await req.json(); } catch { return json({ error: "Datos inválidos" }, 400); }
    if (x.website) return json({ ok: true });
    const v = (k) => String(x[k] ?? "").trim().slice(0, 4000) || null;
    if (!v("objective")) return json({ error: "Cuéntanos el objetivo" }, 400);
    const content = { ...c, message: v("message"), channels: v("channels"), dates: v("dates"), budget: v("budget"), client_name: v("client_name"), client_filled_at: new Date().toISOString(), from: "cliente" };
    const { error } = await sb.from("briefs").update({ objective: v("objective"), audience: v("audience"), tone: v("tone"), deliverables: (v("deliverables") || "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean), content, status: "borrador" }).eq("id", b.id);
    if (error) return json({ error: "No se pudo guardar, intenta otra vez" }, 500);
    return json({ ok: true });
  }
  const inputs = BRIEF_FIELDS.map(([k, l, ph, req]) => `<label>${l}${req ? " *" : ""}${["objective", "audience", "message"].includes(k) ? `<textarea name="${k}" placeholder="${esc(ph)}" ${req ? "required" : ""} ${locked ? "disabled" : ""}>${esc(cur[k] || "")}</textarea>` : `<input name="${k}" placeholder="${esc(ph)}" value="${esc(cur[k] || "")}" ${locked ? "disabled" : ""}>`}</label>`).join("");
  return html(shell(b.title, color, `<span class="k">${esc(brand?.name || b.brand_name || "Brief")}</span><h1>${esc(b.title)}</h1><p class="sub">${locked ? "Este brief ya está en producción." : "Completa lo que sepas: con esto armamos la propuesta. Puedes volver a este enlace y corregirlo."}</p>
<div id="box"><form id="f" class="card">${inputs}<label>Tu nombre<input name="client_name" value="${esc(c.client_name || "")}" ${locked ? "disabled" : ""}></label><input name="website" class="hp" tabindex="-1" autocomplete="off">${locked ? "" : "<button>Enviar brief</button>"}<p class="er" id="er"></p></form></div>`,
    locked ? "" : postJS(`'<div class="ok"><h2 style="margin:0 0 6px">¡Brief recibido!</h2><p style="margin:0">El equipo ya lo tiene. Si quieres cambiar algo, vuelve a abrir este enlace.</p></div>'`)));
}

/* ───────── portal de la cotización ───────── */
async function quote(req, sb, token) {
  const { data: q } = await sb.from("crm_quotes").select("id,workspace_id,number,brand_id,brand_name,title,status,items,currency,total,sent_at,signed_at,signed_by_name,client_comment").eq("public_token", token).maybeSingle();
  if (!q || q.status === "Borrador") return notFound("Cotización");
  const brand = await brandOf(sb, q.brand_id), color = colorOf(brand), items = Array.isArray(q.items) ? q.items : [];
  const total = Number(q.total) || items.reduce((s, x) => s + Number(x.price || 0) * Number(x.qty || 0), 0);
  if (req.method === "POST") {
    if (q.status === "Firmada") return json({ error: "Esta cotización ya fue aprobada" }, 409);
    let x; try { x = await req.json(); } catch { return json({ error: "Datos inválidos" }, 400); }
    const name = String(x.name || "").trim().slice(0, 120), comment = String(x.comment || "").trim().slice(0, 2000) || null;
    if (x.decision === "approve") {
      if (!name) return json({ error: "Escribe tu nombre para firmar" }, 400);
      const { error } = await sb.from("crm_quotes").update({ status: "Firmada", signed_at: new Date().toISOString(), signed_by_name: name, client_comment: comment, decided_at: new Date().toISOString() }).eq("id", q.id);
      if (error) return json({ error: "No se pudo registrar" }, 500);
      return json({ ok: true, decision: "approve" });
    }
    if (x.decision === "reject") {
      if (!comment) return json({ error: "Cuéntanos qué cambiar" }, 400);
      const { error } = await sb.from("crm_quotes").update({ status: "Rechazada", client_comment: comment, signed_by_name: name || null, decided_at: new Date().toISOString() }).eq("id", q.id);
      if (error) return json({ error: "No se pudo registrar" }, 500);
      return json({ ok: true, decision: "reject" });
    }
    return json({ error: "Decisión inválida" }, 400);
  }
  const rows = items.map((x) => `<tr><td>${esc(x.label)}</td><td class="r">${Number(x.qty || 0)}</td><td class="r">${money(x.price, q.currency)}</td><td class="r">${money(Number(x.price || 0) * Number(x.qty || 0), q.currency)}</td></tr>`).join("");
  const st = { Enviada: ["Por aprobar", "#f5a524"], Firmada: ["Aprobada", "#22a35a"], Rechazada: ["Con cambios pedidos", "#d7261e"], Vencida: ["Vencida", "#999"] }[q.status] || [q.status, "#999"];
  const decided = q.status === "Firmada" ? `<div class="ok"><b>Aprobada por ${esc(q.signed_by_name || "el cliente")}</b> el ${esc(new Date(q.signed_at).toLocaleDateString("es-PE", { day: "numeric", month: "long", year: "numeric" }))}.</div>`
    : q.status === "Vencida" ? `<div class="ok">Esta cotización venció. Pide una nueva a tu contacto.</div>`
    : `<form id="f" class="card"><label>Tu nombre (firma)<input name="name" maxlength="120" value="${esc(q.signed_by_name || "")}"></label><label>Comentario (opcional para aprobar, necesario para pedir cambios)<textarea name="comment" maxlength="2000">${esc(q.client_comment || "")}</textarea></label><div class="row"><button name="decision" value="approve">Aprobar cotización</button><button class="g" name="decision" value="reject">Pedir cambios</button></div><p class="er" id="er"></p></form>`;
  return html(shell(`${q.number} · ${q.title}`, color, `<span class="k">${esc(brand?.name || q.brand_name || "Cotización")} · ${esc(q.number)}</span><h1>${esc(q.title)}</h1><p class="sub"><span class="pill" style="background:${st[1]}22;color:${st[1]}">${esc(st[0])}</span></p>
<div class="card"><table><thead><tr><th>Servicio</th><th class="r">Cant.</th><th class="r">Precio</th><th class="r">Subtotal</th></tr></thead><tbody>${rows || '<tr><td colspan="4">Sin ítems</td></tr>'}</tbody></table><div class="row" style="justify-content:space-between;align-items:center"><span>Total</span><span class="tot">${money(total, q.currency)}</span></div></div>
<div id="box" style="margin-top:16px">${decided}</div>`,
    q.status === "Firmada" || q.status === "Vencida" ? "" : postJS(`'<div class="ok"><h2 style="margin:0 0 6px">'+(j.decision==="approve"?"¡Cotización aprobada!":"Enviamos tus comentarios")+'</h2><p style="margin:0">'+(j.decision==="approve"?"Gracias. El equipo ya empieza a coordinar.":"El equipo revisará los cambios y te enviará una versión nueva.")+'</p></div>'`)));
}

/* ───────── baja de correos ───────── */
async function unsubscribe(req, sb, token) {
  const { data: c } = await sb.from("crm_contacts").select("id,email,email_opt_out,brand_id").eq("unsubscribe_token", token).maybeSingle();
  if (!c) return notFound("Enlace");
  const brand = await brandOf(sb, c.brand_id), color = colorOf(brand);
  if (req.method === "POST") {
    await sb.from("crm_contacts").update({ email_opt_out: true }).eq("id", c.id);
    return json({ ok: true });
  }
  if (c.email_opt_out) return html(shell("Baja confirmada", color, `<h1>Ya estás dado de baja</h1><p class="sub">${esc(c.email)} no recibirá más correos${brand ? " de " + esc(brand.name) : ""}.</p>`));
  return html(shell("Darte de baja", color, `<span class="k">${esc(brand?.name || "Correos")}</span><h1>¿Dejar de recibir correos?</h1><p class="sub">${esc(c.email)}</p><div id="box"><form id="f" class="card"><button>Sí, darme de baja</button><p class="er" id="er"></p></form></div>`,
    postJS(`'<div class="ok"><h2 style="margin:0 0 6px">Listo</h2><p style="margin:0">No te enviaremos más correos.</p></div>'`)));
}

export async function handlePublicPages(request, url) {
  const m = url.pathname.match(/^\/([fbqu])\/([0-9a-f-]{36})\/?$/i);
  if (!m || !UUID_RX.test(m[2])) return notFound("Página");
  if (!["GET", "POST"].includes(request.method)) return html("Método no permitido", 405);
  const sb = getSupabaseAdmin();
  if (!sb) return html("Servicio no disponible", 503);
  const t = m[2].toLowerCase();
  if (m[1] === "f") return form(request, sb, t);
  if (m[1] === "b") return brief(request, sb, t);
  if (m[1] === "q") return quote(request, sb, t);
  return unsubscribe(request, sb, t);
}
