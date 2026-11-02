// Eventos públicos (tipo Luma) — Musa v2.
//   GET  /e/:slug           → página pública del evento (solo si está publicado)
//   GET  /e/:slug.ics       → archivo de calendario (Google, Apple, Outlook)
//   POST /e/:slug/register  → inscripción { name, email, phone?, website(honeypot) }
// Sin sesión: lee/escribe con el cliente admin y SOLO expone campos públicos del evento.
import { getSupabaseAdmin } from "../../../api/src/services/supabase.js";
import { sendEventEmails } from "./email.mjs";

const PLAT = { meet: "Google Meet", zoom: "Zoom" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const html = (body, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "SAMEORIGIN" } });
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

async function loadEvent(sb, slug) {
  const { data } = await sb.from("workspace_events")
    .select("id,workspace_id,name,date,starts_at,duration_min,platform,link,capacity,brand_id,description,cover_url,published,timezone,created_by")
    .eq("slug", slug).eq("published", true).maybeSingle();
  if (!data) return null;
  let brand = null;
  if (data.brand_id) {
    const { data: b } = await sb.from("brands").select("name,colors").eq("id", data.brand_id).maybeSingle();
    brand = b;
  }
  const { count } = await sb.from("workspace_event_regs").select("id", { count: "exact", head: true }).eq("event_id", data.id);
  const start = data.starts_at ? new Date(data.starts_at) : new Date(`${data.date}T19:00:00-05:00`);
  return { ...data, brand, regs: count || 0, start, end: new Date(start.getTime() + (data.duration_min || 60) * 60000) };
}

const icsDate = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
function gcal(ev, url) {
  const p = new URLSearchParams({ action: "TEMPLATE", text: ev.name, dates: `${icsDate(ev.start)}/${icsDate(ev.end)}`, details: `${ev.description || ""}\n\n${url}`.trim(), location: PLAT[ev.platform] || "Online" });
  return `https://calendar.google.com/calendar/render?${p}`;
}
function ics(ev, url) {
  const fold = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => "\\" + c);
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Futuraria//Musa//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:${ev.id}@musa.futuraria.com`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(ev.start)}`, `DTEND:${icsDate(ev.end)}`,
    `SUMMARY:${fold(ev.name)}`, `DESCRIPTION:${fold((ev.description || "") + "\n\n" + url)}`, `LOCATION:${fold(PLAT[ev.platform] || "Online")}`, `URL:${url}`,
    "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", "DESCRIPTION:Empieza en 1 hora", "END:VALARM", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}

function page(ev, url) {
  const color = (Array.isArray(ev.brand?.colors) && (ev.brand.colors[0]?.hex || ev.brand.colors[0])) || "#ff5e00";
  const host = ev.brand?.name || "Futuraria";
  const tz = ev.timezone || "America/Lima";
  const when = ev.start.toLocaleDateString("es-PE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: tz });
  const hour = ev.start.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  const past = ev.end.getTime() < Date.now(), left = Math.max(0, (ev.capacity || 100) - ev.regs);
  const cover = ev.cover_url ? `<img class="cv" src="${esc(ev.cover_url)}" alt="">` : `<div class="cv ph" style="background:${esc(color)}"><span>${esc(ev.name)}</span></div>`;
  const form = past ? `<div class="ok">Este evento ya pasó.</div>`
    : left <= 0 ? `<div class="ok">Cupos agotados.</div>`
    : `<form id="f"><b>Inscríbete${ev.capacity ? ` · quedan ${left} cupos` : ""}</b><input name="name" required maxlength="120" placeholder="Tu nombre" autocomplete="name"><input name="email" type="email" required maxlength="200" placeholder="Tu correo" autocomplete="email"><input name="phone" maxlength="40" placeholder="WhatsApp (opcional)" autocomplete="tel"><input name="website" class="hp" tabindex="-1" autocomplete="off"><button>Inscribirme</button><p class="er" id="er"></p></form>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(ev.name)} · ${esc(host)}</title><meta name="description" content="${esc((ev.description || "").slice(0, 160))}">
<meta property="og:title" content="${esc(ev.name)}"><meta property="og:description" content="${esc(`${when} · ${hour} · ${host}`)}">${ev.cover_url ? `<meta property="og:image" content="${esc(ev.cover_url)}">` : ""}<meta property="og:url" content="${esc(url)}"><meta name="twitter:card" content="summary_large_image">
<style>*{box-sizing:border-box}body{margin:0;background:#f3f1e7;color:#111;font:15px/1.5 Inter,system-ui,-apple-system,sans-serif}.w{max-width:980px;margin:0 auto;padding:32px 20px;display:grid;grid-template-columns:minmax(0,380px) 1fr;gap:36px}
.cv{width:100%;aspect-ratio:1;object-fit:cover;border-radius:18px;display:block}.ph{display:grid;place-items:center;color:#fff;font:800 30px/1.1 Inter,sans-serif;text-align:center;padding:24px}
.host{font-size:13px;color:#666;margin-top:14px}h1{font:800 clamp(28px,4vw,42px)/1.08 Inter,sans-serif;margin:0 0 16px}.when{display:flex;flex-direction:column;gap:2px;padding:14px 0;border-top:1px solid #ddd9c8;border-bottom:1px solid #ddd9c8;margin-bottom:18px}.when b::first-letter{text-transform:uppercase}.when span{color:#555;font-size:14px}
form,.ok{background:#fff;border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:10px;box-shadow:0 1px 0 #e6e3d6}input{border:1.5px solid #d6d4c6;border-radius:10px;padding:11px 12px;font:inherit}input:focus{outline:0;border-color:${esc(color)}}.hp{position:absolute;left:-9999px}
button,.btn{background:${esc(color)};color:#fff;border:0;border-radius:50px;padding:12px 18px;font:700 15px Inter,sans-serif;cursor:pointer;text-decoration:none;text-align:center}.btn.g{background:#111}.er{color:#c22;font-size:13px;margin:0;min-height:1em}.desc{white-space:pre-wrap;color:#333;margin-top:22px}.cal{display:flex;gap:8px;flex-wrap:wrap}.n{font-size:12px;color:#888;margin-top:10px}
.foot{grid-column:1/-1;text-align:center;font-size:12px;color:#999;margin-top:20px}.foot a{color:#999}@media(max-width:760px){.w{grid-template-columns:1fr;gap:20px}}</style></head>
<body><main class="w"><div>${cover}<div class="host">Organiza <b>${esc(host)}</b></div></div>
<div><h1>${esc(ev.name)}</h1><div class="when"><b>${esc(when)}</b><span>${esc(hour)} · ${ev.duration_min || 60} min · hora de ${esc(tz.split("/").pop().replace(/_/g, " "))}</span><span>Online · ${esc(PLAT[ev.platform] || "Videollamada")}</span></div>
<div id="box">${form}</div><p class="n">${ev.regs} ${ev.regs === 1 ? "persona inscrita" : "personas inscritas"}</p>
<div class="cal" style="margin-top:8px"><a class="btn g" href="${esc(gcal(ev, url))}" target="_blank" rel="noopener">+ Google Calendar</a><a class="btn g" href="${esc(url)}.ics">+ Apple / Outlook (.ics)</a></div>
${ev.description ? `<div class="desc">${esc(ev.description)}</div>` : ""}</div>
<div class="foot">Hecho con <a href="https://futuraria.com" target="_blank" rel="noopener">Musa · Futuraria</a></div></main>
<script>
var f=document.getElementById("f");if(f)f.onsubmit=function(e){e.preventDefault();var b=f.querySelector("button"),er=document.getElementById("er");b.disabled=true;b.textContent="Inscribiendo…";er.textContent="";
fetch(location.pathname.replace(/\\/$/,"")+"/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(new FormData(f)))}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||"No se pudo inscribir");return j;});})
.then(function(j){document.getElementById("box").innerHTML='<div class="ok"><b>¡Listo, '+String(j.name).replace(/[<>&]/g,"")+'! Estás inscrito.</b><span>Guarda la fecha en tu calendario con los botones de abajo.</span>'+(j.link?'<span>Enlace de la sala: <a href="'+encodeURI(j.link)+'" target="_blank" rel="noopener">'+String(j.link).replace(/[<>&"]/g,"")+'</a></span>':'')+'</div>';})
.catch(function(x){b.disabled=false;b.textContent="Inscribirme";er.textContent=x.message;});};
</script></body></html>`;
}

export async function handleEventsPublic(request, url) {
  const m = url.pathname.match(/^\/e\/([a-z0-9][a-z0-9-]{2,79})(\.ics|\/register)?\/?$/);
  if (!m) return html("<h1>No encontrado</h1>", 404);
  const sb = getSupabaseAdmin();
  if (!sb) return html("<h1>Servicio no disponible</h1>", 503);
  const ev = await loadEvent(sb, m[1]);
  if (!ev) return m[2] === "/register" ? json({ error: "Este evento no existe o ya no está publicado." }, 404) : html(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font:16px Inter,sans-serif;display:grid;place-items:center;min-height:90vh;background:#f3f1e7"><div style="text-align:center"><h1>Evento no disponible</h1><p>El enlace no existe o el organizador lo despublicó.</p></div>`, 404);
  const pageUrl = `${String(process.env.EVENTS_PUBLIC_ORIGIN || url.origin).replace(/\/$/, "")}/e/${m[1]}`;

  if (m[2] === ".ics" && request.method === "GET") {
    return new Response(ics(ev, pageUrl), { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="${m[1]}.ics"` } });
  }
  if (m[2] === "/register") {
    if (request.method !== "POST") return json({ error: "Método no permitido" }, 405);
    let body; try { body = await request.json(); } catch { return json({ error: "Datos inválidos" }, 400); }
    if (body.website) return json({ ok: true, name: "" }); // honeypot: bots
    const name = String(body.name || "").trim().slice(0, 120), email = String(body.email || "").trim().toLowerCase().slice(0, 200), phone = String(body.phone || "").trim().slice(0, 40) || null;
    if (!name) return json({ error: "Escribe tu nombre" }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Revisa tu correo" }, 400);
    if (ev.end.getTime() < Date.now()) return json({ error: "Este evento ya pasó" }, 409);
    if (ev.capacity && ev.regs >= ev.capacity) return json({ error: "Cupos agotados" }, 409);
    const { error } = await sb.from("workspace_event_regs").insert({ workspace_id: ev.workspace_id, event_id: ev.id, name, email, phone, status: "confirmado", source: "pagina_publica" });
    if (error) {
      if (/duplicate|unique/i.test(error.message)) return json({ ok: true, name, already: true, link: ev.link || null });
      console.error("[events-public] register:", error.message);
      return json({ error: "No se pudo inscribir, intenta otra vez" }, 500);
    }
    // confirmación y recordatorios por correo (si el espacio configuró Resend o Postmark)
    {
      const job = sendEventEmails(sb, ev, { name, email }, pageUrl).catch((e) => console.error("[events-public] correo:", e && e.message));
      if (globalThis.__musaWaitUntil) globalThis.__musaWaitUntil(job); else await job;
    }
    // también entra al CRM de la marca (si el evento tiene autor para firmar el alta)
    if (ev.created_by) {
      const { data: exists } = await sb.from("crm_contacts").select("id").eq("workspace_id", ev.workspace_id).ilike("email", email).maybeSingle();
      if (!exists) {
        const [first, ...rest] = name.split(/\s+/);
        await sb.from("crm_contacts").insert({ workspace_id: ev.workspace_id, brand_id: ev.brand_id, brand_name: ev.brand?.name || null, first_name: first, last_name: rest.join(" ") || null, email, phone, status: "lead", tags: ["evento"], created_by: ev.created_by, origin_source: "evento", origin_post_ref: "evento:" + ev.id }).then(() => {}, () => {});
      }
    }
    return json({ ok: true, name, link: ev.link || null });
  }
  if (request.method !== "GET") return html("Método no permitido", 405);
  return html(page(ev, pageUrl));
}
