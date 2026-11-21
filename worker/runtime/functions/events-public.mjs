// Eventos públicos (tipo Luma) — Musa v2.
//   GET  /e/:slug           → página pública del evento (solo si está publicado)
//   GET  /e/:slug.ics       → archivo de calendario (Google, Apple, Outlook)
//   POST /e/:slug/register  → inscripción { name, email, phone?, website(honeypot) }
// Sin sesión: lee/escribe con el cliente admin y SOLO expone campos públicos del evento.
import { getSupabaseAdmin } from "../../../api/src/services/supabase.js";
import { qrForCapture, recordQrCapture } from "./qr-capture.mjs";
import { sendEventEmails } from "./email.mjs";
import { rateLimited, tooFast, formTimingCookie } from "./antispam.mjs";

const PLAT = { meet: "Google Meet", zoom: "Zoom" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const html = (body, status = 200, extraHeaders = {}) => new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "SAMEORIGIN", ...extraHeaders } });
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

/**
 * REQ-085 — GET /api/events/slug-check?slug=&eventId=  → { available: bool }
 * Público (misma superficie que /e/:slug): la UI del editor consulta antes de
 * guardar. disponible = que no exista OTRO evento (incluidos borradores) con ese slug.
 */
export async function checkEventSlug(sb, url) {
  const slug = String(url.searchParams.get("slug") || "").trim().toLowerCase();
  const eventId = String(url.searchParams.get("eventId") || "");
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return { available: false, reason: "formato" };
  let q = sb.from("workspace_events").select("id", { count: "exact", head: true }).eq("slug", slug);
  if (eventId) q = q.neq("id", eventId);
  const { count, error } = await q;
  if (error) return { available: false, reason: error.message };
  return { available: (count || 0) === 0, slug };
}

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
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Musa//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:${ev.id}@musa.futuraria.com`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(ev.start)}`, `DTEND:${icsDate(ev.end)}`,
    `SUMMARY:${fold(ev.name)}`, `DESCRIPTION:${fold((ev.description || "") + "\n\n" + url)}`, `LOCATION:${fold(PLAT[ev.platform] || "Online")}`, `URL:${url}`,
    "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", "DESCRIPTION:Empieza en 1 hora", "END:VALARM", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}

function page(ev, url) {
  const color = (Array.isArray(ev.brand?.colors) && (ev.brand.colors[0]?.hex || ev.brand.colors[0])) || "#ff5e00";
  const host = ev.brand?.name || "Musa";
  const tz = ev.timezone || "America/Lima";
  const when = ev.start.toLocaleDateString("es-PE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: tz });
  const hour = ev.start.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  const past = ev.end.getTime() < Date.now(), left = Math.max(0, (ev.capacity || 100) - ev.regs);
  const cover = ev.cover_url ? `<img class="cv" src="${esc(ev.cover_url)}" alt="">` : `<div class="cv ph" style="background:${esc(color)}"><span>${esc(ev.name)}</span></div>`;
  const form = past ? `<div class="ok">Este evento ya pasó.</div>`
    : left <= 0 ? `<div class="ok">Cupos agotados.</div>`
    : `<form id="f"><b>Inscríbete${ev.capacity ? ` · quedan ${left} cupos` : ""}</b><input name="name" required maxlength="120" placeholder="Tu nombre" autocomplete="name"><input name="email" type="email" required maxlength="200" placeholder="Tu correo" autocomplete="email"><input name="phone" maxlength="40" placeholder="WhatsApp (opcional)" autocomplete="tel"><input name="website" class="hp" tabindex="-1" autocomplete="off"><button>Inscribirme</button><p class="er" id="er"></p></form>`;
  return `<!doctype html><html lang="es" data-tk="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(ev.name)} · ${esc(host)}</title><meta name="description" content="${esc((ev.description || "").slice(0, 160))}">
<meta property="og:title" content="${esc(ev.name)}"><meta property="og:description" content="${esc(`${when} · ${hour} · ${host}`)}">${ev.cover_url ? `<meta property="og:image" content="${esc(ev.cover_url)}">` : ""}<meta property="og:url" content="${esc(url)}"><meta name="twitter:card" content="summary_large_image">
<style>*{box-sizing:border-box}html{background:var(--tk-ground)}body{margin:0;color:var(--tk-text);background:var(--tk-ground);font:15px/1.5 Inter,system-ui,-apple-system,sans-serif}.w{max-width:980px;margin:0 auto;padding:32px 20px;display:grid;grid-template-columns:minmax(0,380px) 1fr;gap:36px}
.cv{width:100%;aspect-ratio:1;object-fit:cover;border-radius:18px;display:block}.ph{display:grid;place-items:center;color:#fff;font:800 30px/1.1 Inter,sans-serif;text-align:center;padding:24px}
.host{font-size:13px;color:var(--tk-faint);margin-top:14px}.host b{color:var(--tk-text)}h1{font:800 clamp(28px,4vw,42px)/1.08 Inter,sans-serif;margin:0 0 16px;color:var(--tk-text)}.when{display:flex;flex-direction:column;gap:2px;padding:14px 0;border-top:1px solid var(--tk-line);border-bottom:1px solid var(--tk-line);margin-bottom:18px}.when b::first-letter{text-transform:uppercase}.when span{color:var(--tk-faint);font-size:14px}
form,.ok{background:var(--tk-card);border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:10px;box-shadow:0 1px 0 var(--tk-line)}input{border:1.5px solid var(--tk-line);border-radius:10px;padding:11px 12px;font:inherit;background:var(--tk-card);color:var(--tk-text)}input:focus{outline:0;border-color:var(--tk-accent)}.hp{position:absolute;left:-9999px}
button,.btn{background:var(--tk-accent);color:#fff;border:0;border-radius:50px;padding:12px 18px;font:700 15px Inter,sans-serif;cursor:pointer;text-decoration:none;text-align:center;transform:rotate(-1.5deg);box-shadow:3px 3px 0 var(--tk-hard);transition:transform .15s,box-shadow .15s}
button:hover,.btn:hover{transform:rotate(-1.5deg) translate(-1px,-1px);box-shadow:5px 5px 0 var(--tk-hard)}
button:active,.btn:active{transform:rotate(-1.5deg) translate(1px,1px);box-shadow:1px 1px 0 var(--tk-hard)}
button:disabled{opacity:.6;transform:none;box-shadow:none}
.btn.g{background:var(--tk-card);color:var(--tk-text);border:1.5px solid var(--tk-line)}
.er{color:#c22;font-size:13px;margin:0;min-height:1em}.desc{white-space:pre-wrap;color:var(--tk-text);margin-top:22px}.cal{display:flex;gap:8px;flex-wrap:wrap}.n{font-size:12px;color:var(--tk-faint);margin-top:10px}
.foot{grid-column:1/-1;text-align:center;font-size:12px;color:var(--tk-faint);margin-top:20px}.foot a{color:var(--tk-faint)}@media(max-width:760px){.w{grid-template-columns:1fr;gap:20px}}
.themebtn{position:fixed;top:14px;right:14px;z-index:50;width:44px;height:44px;border-radius:12px;background:var(--tk-card);border:1.5px solid var(--tk-line);transform:rotate(3deg);box-shadow:2px 2px 0 var(--tk-hard);font-size:20px;display:grid;place-items:center;cursor:pointer;color:var(--tk-text)}
.themebtn:hover{transform:rotate(3deg) translate(-1px,-1px);box-shadow:3px 3px 0 var(--tk-hard)}
:root{--tk-ground:#f3f1e7;--tk-card:#ffffff;--tk-line:#d6d4c6;--tk-hard:rgba(17,17,17,.9);--tk-text:#111111;--tk-faint:#8e8e93;--tk-hot-tint:#fff0eb;--tk-hot-ink:#c23e1c;--tk-accent:#ff5e00;--tk-pass-shadow:drop-shadow(0 1px 1px rgba(20,20,30,.05)) drop-shadow(0 10px 14px rgba(20,20,30,.08))}
:root[data-tk="dark"]{--tk-ground:#131313;--tk-card:#1d1d1f;--tk-line:#333335;--tk-hard:rgba(0,0,0,.8);--tk-text:#f2f2f0;--tk-faint:#9a9a96;--tk-hot-tint:rgba(255,94,0,.16);--tk-hot-ink:#ffb38a;--tk-pass-shadow:drop-shadow(0 1px 1px rgba(0,0,0,.4)) drop-shadow(0 12px 18px rgba(0,0,0,.5))}
#tkwrap{position:relative;width:100%;max-width:420px;margin:6px auto 0;aspect-ratio:420/588}
.ok a{color:var(--tk-accent)}</style></head>
<body data-tk="dark"><button class="themebtn" id="tkbtn" title="Modo claro / oscuro">🌙</button><main class="w"><div>${cover}<div class="host">Organiza <b>${esc(host)}</b></div></div>
<div><h1>${esc(ev.name)}</h1><div class="when"><b>${esc(when)}</b><span>${esc(hour)} · ${ev.duration_min || 60} min · hora de ${esc(tz.split("/").pop().replace(/_/g, " "))}</span><span>Online · ${esc(PLAT[ev.platform] || "Videollamada")}</span></div>
<div id="box">${form}</div><p class="n">${ev.regs} ${ev.regs === 1 ? "persona inscrita" : "personas inscritas"}</p>
<div class="cal" style="margin-top:8px"><a class="btn g" href="${esc(gcal(ev, url))}" target="_blank" rel="noopener">+ Google Calendar</a><a class="btn g" href="${esc(url)}.ics">+ Apple / Outlook (.ics)</a></div>
${ev.description ? `<div class="desc">${esc(ev.description)}</div>` : ""}</div>
<div class="foot">Hecho con <a href="https://musa.app" target="_blank" rel="noopener">Musa</a></div></main>
<script src="/ticket-pub-2.js"></script>
<script>
/* switch light/dark estilo Musa (luna/sol chueco) */
var tbtn=document.getElementById("tkbtn");
function tkApply(m){document.documentElement.setAttribute("data-tk",m);document.body.setAttribute("data-tk",m);tbtn.textContent=m==="dark"?"🌙":"☀️";try{localStorage.setItem("ev-theme",m)}catch(e){}}
(function(){var saved=null;try{saved=localStorage.getItem("ev-theme")}catch(e){}
 tkApply(saved||"dark");
 tbtn.onclick=function(){tkApply(document.body.getAttribute("data-tk")==="dark"?"light":"dark");};
})();
var f=document.getElementById("f");if(f)f.onsubmit=function(e){e.preventDefault();var b=f.querySelector("button"),er=document.getElementById("er");b.disabled=true;b.textContent="Inscribiendo…";er.textContent="";
fetch(location.pathname.charAt(location.pathname.length - 1) === "/" ? location.pathname.slice(0, -1) : location.pathname+"/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify((function(){var o=Object.fromEntries(new FormData(f)),q=new URLSearchParams(location.search).get("qr");if(q)o.__qr=q;return o})())}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||"No se pudo inscribir");return j;});})
.then(function(j){
 var t=j.ticket||{};
 var box=document.getElementById("box");
 box.innerHTML='<div class="ok" style="padding:12px"><b>Tu entrada se está armando'+(j.already?" (ya estabas inscrito)":"")+'…</b><span>Es tu entrada única: guárdala o muéstrala el día del evento.</span><div id="tkwrap"></div>'+(j.link?'<span>Enlace de la sala: <a href="'+encodeURI(j.link)+'" target="_blank" rel="noopener">'+String(j.link).replace(/[<>&"]/g,"")+'</a></span>':'')+'</div>';
 /* el ticket se arma en tiles: nombre + evento + fecha + sala + QR único */
 function mountTk(){
   if(!window.musaTicketPub||!document.getElementById("tkwrap"))return;
   var wrap=document.getElementById("tkwrap");
   var fx=window.musaTicketPub.mount(wrap,{
     event:t.event||document.title.split("·")[0].trim(),
     host:t.host||"",
     seatLabel:"Entrada",
     holder:j.name||"Invitado",
     details:[{label:"Anfitrión",value:t.host||""},{label:"Fecha",value:t.date||""},{label:"Sala",value:t.place||""}],
     doorsLabel:"Empieza",
     doorsValue:(t.hour?t.hour+" · ":"")+"Presenta este QR",
     code:j.code||String(j.name||"INV")
   });
   fx.start();
 }
 if(window.musaTicketPub)mountTk();
 else{var chk=setInterval(function(){if(window.musaTicketPub){clearInterval(chk);mountTk();}},150);setTimeout(function(){clearInterval(chk);},6000);}
})
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

  /* HEAD = GET sin cuerpo: buscadores y verificadores de enlaces lo usan (antes 405 y la página parecía caída) */
  if (request.method === "HEAD") { const r = await handleEventsPublic(new Request(request.url, { method: "GET", headers: request.headers }), url); return new Response(null, { status: r.status, headers: r.headers }); }
  if (m[2] === ".ics" && request.method === "GET") {
    return new Response(ics(ev, pageUrl), { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="${m[1]}.ics"` } });
  }
  if (m[2] === "/register") {
    if (request.method !== "POST") return json({ error: "Método no permitido" }, 405);
    if (rateLimited(request)) return json({ error: "Demasiados envíos desde tu conexión. Espera un minuto." }, 429);
    let body; try { body = await request.json(); } catch { return json({ error: "Datos inválidos" }, 400); }
    if (body.website) return json({ ok: true, name: "" }); // honeypot: bots
    if (tooFast(request, body)) return json({ error: "Envío demasiado rápido. Recarga la página e intenta de nuevo." }, 429);
    const name = String(body.name || "").trim().slice(0, 120), email = String(body.email || "").trim().toLowerCase().slice(0, 200), phone = String(body.phone || "").trim().slice(0, 40) || null;
    if (!name) return json({ error: "Escribe tu nombre" }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Revisa tu correo" }, 400);
    if (ev.end.getTime() < Date.now()) return json({ error: "Este evento ya pasó" }, 409);
    if (ev.capacity && ev.regs >= ev.capacity) return json({ error: "Cupos agotados" }, 409);
    const { data: regRow, error } = await sb.from("workspace_event_regs").insert({ workspace_id: ev.workspace_id, event_id: ev.id, name, email, phone, status: "confirmado", source: "pagina_publica" }).select("id").single();
    if (error) {
      if (/duplicate|unique/i.test(error.message)) return json({ ok: true, name, already: true, link: ev.link || null, ticket: { event: ev.name, host: ev.brand?.name || "Musa", date: ev.start.toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric", timeZone: ev.timezone || "America/Lima" }), hour: ev.start.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", timeZone: ev.timezone || "America/Lima" }), place: PLAT[ev.platform] || "Online" } });
      console.error("[events-public] register:", error.message);
      return json({ error: "No se pudo inscribir, intenta otra vez" }, 500);
    }
    // confirmación y recordatorios por correo (si el espacio configuró Resend o Postmark)
    {
      const job = sendEventEmails(sb, ev, { name, email }, pageUrl).catch((e) => console.error("[events-public] correo:", e && e.message));
      if (globalThis.__musaWaitUntil) globalThis.__musaWaitUntil(job); else await job;
    }
    // también entra al CRM de la marca (si el evento tiene autor para firmar el alta)
    let contactId = null, isNew = false;
    if (ev.created_by) {
      const { data: exists } = await sb.from("crm_contacts").select("id").eq("workspace_id", ev.workspace_id).ilike("email", email).maybeSingle();
      if (exists) contactId = exists.id;
      if (!exists) {
        const [first, ...rest] = name.split(/\s+/);
        await sb.from("crm_contacts").insert({ workspace_id: ev.workspace_id, brand_id: ev.brand_id, brand_name: ev.brand?.name || null, first_name: first, last_name: rest.join(" ") || null, email, phone, status: "lead", tags: ["evento"], created_by: ev.created_by, origin_source: "evento", origin_post_ref: "evento:" + ev.id }).select("id").maybeSingle().then((r) => { contactId = (r && r.data && r.data.id) || null; isNew = !!contactId; }, () => {});
      }
    }
    /* llegó por un código QR de este espacio: queda anotado en el QR y en la persona (migración 41) */
    if (body.__qr) { const qr = await qrForCapture(sb, body.__qr, ev.workspace_id); if (qr) await recordQrCapture(sb, qr, { contactId, isNew, kind: "evento", name, email }); }
    const ticketCode = regRow && regRow.id ? String(regRow.id).replace(/-/g, "").slice(0, 12).toUpperCase() : "";
    return json({ ok: true, name, link: ev.link || null, code: ticketCode, ticket: { event: ev.name, host: ev.brand?.name || "Musa", date: ev.start.toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric", timeZone: ev.timezone || "America/Lima" }), hour: ev.start.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", timeZone: ev.timezone || "America/Lima" }), place: PLAT[ev.platform] || "Online" } });
  }
  if (request.method !== "GET") return html("Método no permitido", 405);
  return html(page(ev, pageUrl), 200, { "set-cookie": formTimingCookie() });
}
