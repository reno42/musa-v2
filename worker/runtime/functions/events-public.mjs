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
    : `<form id="f"><b>Inscríbete${ev.capacity ? ` · quedan ${left} cupos` : ""}</b><input name="name" required maxlength="120" placeholder="Tu nombre" autocomplete="name"><input name="email" type="email" required maxlength="200" placeholder="Tu correo" autocomplete="email"><input name="phone" maxlength="40" placeholder="WhatsApp (opcional)" autocomplete="tel"><input name="website" class="hp" tabindex="-1" autocomplete="off"><button class="btn-p">Inscribirme</button><p class="er" id="er"></p></form>`;
  return `<!doctype html><html lang="es" data-tk="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(ev.name)} · ${esc(host)}</title><meta name="description" content="${esc((ev.description || "").slice(0, 160))}">
<meta property="og:title" content="${esc(ev.name)}"><meta property="og:description" content="${esc(`${when} · ${hour} · ${host}`)}">${ev.cover_url ? `<meta property="og:image" content="${esc(ev.cover_url)}">` : ""}<meta property="og:url" content="${esc(url)}"><meta name="twitter:card" content="summary_large_image">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#070707; --side:#070707; --panel:#111; --panel-2:#151515; --border:#1f1f1f; --border-2:#2e2e2e;
  --text:#bdbdbd; --muted:#7d7d7d; --bright:#fff;
  --accent:#ff5e00; --accent-dim:#2a1606; --on-accent:#fff;
  --pill-bg:#f4f3ea; --pill-fg:#111; --card-bg:#f4f3ea; --card-line:transparent; --card-2:#e9e8dd;
  --danger:#d7261e;
  --serif:"Anton",Impact,sans-serif; --sans:"Inter",-apple-system,"Segoe UI",Roboto,sans-serif;
  color-scheme:dark;
}
:root[data-tk="light"]{
  --bg:#f4f3ea; --side:#ebe9dd; --panel:#fff; --panel-2:#e2e0d3; --border:#d6d4c6; --border-2:#111;
  --text:#333; --muted:#6b6b6b; --bright:#111;
  --accent-dim:#ffe2cf;
  --pill-bg:#111; --pill-fg:#f4f3ea; --card-bg:#fff; --card-line:#111; --card-2:#f1f0e8;
  color-scheme:light;
}
html{background:var(--bg)}
body{font-family:var(--sans);font-size:13px;color:var(--text);background:var(--bg);-webkit-font-smoothing:antialiased;height:100vh;display:flex;flex-direction:column;overflow:hidden}
main{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center}
a{color:inherit}
.top{max-width:1060px;width:100%;margin:0 auto;padding:14px 24px 8px;display:flex;align-items:center;gap:12px;flex-shrink:0}
.top .brand{font-family:var(--serif);font-size:15px;color:var(--bright);text-transform:uppercase;letter-spacing:.5px}
.top .brand b{color:var(--accent);font-weight:400}
.top .icon-btn{margin-left:auto}
.w{width:100%;max-width:1060px;margin:0 auto;padding:0 24px;display:grid;grid-template-columns:minmax(0,1fr) minmax(330px,390px);gap:40px;align-items:center;flex:1;min-height:0}
.col-l{display:flex;flex-direction:column;min-width:0}
.col-r{min-width:0}
.cv,.ph{width:100%;height:clamp(140px,30vh,340px);object-fit:cover;border-radius:14px;display:block;border:1px solid var(--border)}
.ph{display:grid;place-items:center;color:#fff;font-family:var(--serif);font-size:30px;line-height:1.1;text-align:center;padding:24px;text-transform:uppercase}
.host{font-size:12px;color:var(--muted);margin-top:12px}.host b{color:var(--bright);font-weight:700}
.kick{font-family:var(--serif);font-size:12px;color:var(--accent);text-transform:uppercase;letter-spacing:1.5px;margin:0 0 8px}
h1{font-family:var(--serif);font-weight:400;font-size:clamp(26px,3.6vw,44px);line-height:1.02;color:var(--bright);letter-spacing:-.015em;margin:0 0 10px;text-transform:uppercase}
.when{display:flex;gap:14px;align-items:center;padding:10px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border);flex-wrap:wrap;margin-bottom:4px}
.when b{color:var(--bright);font-weight:700}.when b::first-letter{text-transform:uppercase}
.when span{color:var(--muted);font-size:13px}
.when .sep{width:4px;height:4px;border-radius:50%;background:var(--border-2)}
form,.ok{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:9px}
form b{font-family:var(--serif);font-weight:400;font-size:20px;color:var(--bright);text-transform:uppercase;letter-spacing:.3px}
input{border:1px solid var(--border-2);border-radius:9px;padding:9px 12px;font:inherit;background:var(--bg);color:var(--bright)}
input::placeholder{color:var(--muted)}
input:focus{outline:0;border-color:var(--accent)}
.hp{position:absolute;left:-9999px}
button.btn-p,.btn-p{background:var(--accent);color:#fff;font-family:var(--serif);text-transform:uppercase;letter-spacing:.5px;font-weight:400;font-size:17px;height:40px;padding:0 26px;border:0;cursor:pointer;
  border-radius:0;clip-path:polygon(2% 0,98% 6%,100% 94%,0 100%);transform:rotate(-2deg);transition:transform .1s;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}
button.btn-p:active,.btn-p:active{transform:rotate(-2deg) scale(.97)}
button.btn-p:disabled{opacity:.6}
.btn-g{height:34px;padding:0 14px;display:inline-flex;align-items:center;background:var(--pill-bg);color:var(--pill-fg);border:0;font-family:var(--serif);text-transform:uppercase;letter-spacing:.5px;font-weight:400;font-size:14px;border-radius:50px;cursor:pointer;text-decoration:none;transition:background-color .15s,color .15s}
.btn-g:hover{background:var(--accent);color:#fff}
.er{color:var(--danger);font-size:12px;margin:0;min-height:1em}
.desc{white-space:pre-wrap;color:var(--text);margin-top:14px;line-height:1.55;font-size:13px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.cal{display:flex;gap:8px;flex-wrap:wrap}
.n{font-size:12px;color:var(--muted);margin-top:10px}
.foot{max-width:1060px;width:100%;margin:0 auto;padding:10px 24px 14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;flex-shrink:0}
.foot .cal{margin-right:auto}
.foot .n{margin:0}
.foot .mk{font-size:12px;color:var(--muted)}.foot .mk a{color:var(--muted)}
@media(max-width:820px){
  html,body{height:auto}
  .w{grid-template-columns:1fr;gap:22px;min-height:0;padding-top:4px}
  .cv,.ph{height:auto;aspect-ratio:16/10}
  body{overflow-y:auto}
}
.icon-btn{position:relative;flex-shrink:0;width:34px;height:34px;border-radius:50%;border:1px solid var(--border-2);background:var(--panel);color:var(--bright);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:border-color .15s}
.icon-btn:hover{border-color:var(--accent)}
.icon-btn .sun{display:none}
:root[data-tk="light"] .icon-btn .sun{display:block}
:root[data-tk="light"] .icon-btn .moon{display:none}
#tkwrap{position:relative;width:100%;max-width:420px;margin:6px auto 0;aspect-ratio:420/588}
.ok{align-items:center}
.ok>b{font-size:22px}
.ok .sub{color:var(--muted);font-size:12px;text-align:center}
.ok .sub a{color:var(--accent)}
/* Overlay negro del ticket (Ren: pantalla negra con la entrada) */
.tkov{position:fixed;inset:0;z-index:200;background:#070707;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;overflow:auto}
.tkov .tkhead{font-family:var(--serif);color:#fff;font-size:15px;text-transform:uppercase;letter-spacing:.5px;text-align:center}
.tkov .tkhead b{color:var(--accent)}
.tkov .sub{color:#7d7d7d;font-size:12px;text-align:center;max-width:420px}
#tkwrap{position:relative;width:min(420px,92vw);margin:0}
#tkwrap canvas{display:block;width:100%;height:auto}
.tkactions{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
.tkactions .btn-p,.tkactions .btn-g{flex:0 1 auto}
.tkclose{position:fixed;top:14px;right:14px;z-index:210;background:#111;border:1px solid #2e2e2e;color:#e8e8e8;width:34px;height:34px;border-radius:50%;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.tkclose:hover{border-color:var(--accent);color:#fff}
.tksala{margin-top:2px}
.tksala .btn-p{font-size:20px;height:48px;padding:0 34px}
</style></head></head>
<body data-tk="dark"><header class="top"><span class="brand">Musa<b>.</b></span><button class="icon-btn" id="tkbtn" aria-label="Cambiar tema" title="Modo claro / oscuro"><svg class="moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg><svg class="sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></button></header><main class="w"><div class="col-l"><p class="kick">Evento en vivo</p><h1>${esc(ev.name)}</h1><div class="when"><b>${esc(when)}</b><span class="sep"></span><span>${esc(hour)} · ${ev.duration_min || 60} min</span><span class="sep"></span><span>${esc(PLAT[ev.platform] || "Videollamada")}</span></div>${cover}<div class="host">Organiza <b>${esc(host)}</b></div>${ev.description ? `<div class="desc">${esc(ev.description)}</div>` : ""}</div><div class="col-r"><div id="box">${form}</div></div></main><footer class="foot"><div class="cal"><a class="btn-g" href="${esc(gcal(ev, url))}" target="_blank" rel="noopener">+ Google Calendar</a><a class="btn-g" href="${esc(url)}.ics">+ Apple / Outlook (.ics)</a></div><span class="n">${ev.regs} ${ev.regs === 1 ? "persona inscrita" : "personas inscritas"}</span><span class="mk">Hecho con <a href="https://musa.app" target="_blank" rel="noopener">Musa</a></span></footer>
<script src="/musa/vendor/qrcode.min.js"></script><script src="/musa/vendor/jspdf.umd.min.js"></script><script src="/ticket-pub-5.js"></script>
<script>
/* switch light/dark estilo Musa (luna/sol chueco) */
var tbtn=document.getElementById("tkbtn");
function tkApply(m){document.documentElement.setAttribute("data-tk",m);document.body.setAttribute("data-tk",m);try{localStorage.setItem("ev-theme",m)}catch(e){}}
(function(){var saved=null;try{saved=localStorage.getItem("ev-theme")}catch(e){}
 tkApply(saved||"dark");
 tbtn.onclick=function(){tkApply(document.body.getAttribute("data-tk")==="dark"?"light":"dark");};
})();
var f=document.getElementById("f");if(f)f.onsubmit=function(e){e.preventDefault();var b=f.querySelector("button"),er=document.getElementById("er");b.disabled=true;b.textContent="Inscribiendo…";er.textContent="";
fetch(location.pathname.charAt(location.pathname.length - 1) === "/" ? location.pathname.slice(0, -1) : location.pathname+"/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify((function(){var o=Object.fromEntries(new FormData(f)),q=new URLSearchParams(location.search).get("qr");if(q)o.__qr=q;return o})())}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||"No se pudo inscribir");return j;});})
.then(function(j){
 var t=j.ticket||{};
 /* OVERLAY NEGRO: la pantalla se llena de negro y aparece tu entrada (Ren) */
 var ov=document.createElement("div");ov.className="tkov";
 var mins=Math.round((t.startsInSec||0)/60);
 var salaHtml=(j.link&&mins<=30)?'<div class="tksala"><button class="btn-p" id="tksala">Entrar a la sala</button></div>':"";
 ov.innerHTML='<button class="tkclose" id="tkx" aria-label="Cerrar">✕</button>'
  +'<div class="tkhead">Tu entrada · <b>'+String(t.event||document.title.split("·")[0].trim()).replace(/[<>&"]/g,"")+'</b></div>'
  +'<div id="tkwrap"></div>'
  +'<div class="sub">Entrada única — muéstrala el día del evento o descárgala.</div>'
  +'<div class="tkactions"><button class="btn-p" id="tkpdf">Descargar PDF</button><a class="btn-g" id="tkpng" download="entrada-'+String(j.code||"musa").toLowerCase()+'.png">Descargar imagen</a></div>'
  +salaHtml;
 document.body.appendChild(ov);
 document.body.style.overflow="hidden";
 document.getElementById("tkx").onclick=function(){ov.remove();document.body.style.overflow="";};
 if(salaHtml)document.getElementById("tksala").onclick=function(){window.open(j.link,"_blank","noopener");};
 /* el ticket se arma una vez y queda (sin desaparecer) */
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
     doorsValue:(t.hour?t.hour+" h · ":"")+"Presenta tu QR en la entrada",
     code:j.code||String(j.name||"INV"),
     qrText:t.verifyUrl||""
   });
   fx.start();
   /* PDF con jsPDF: el canvas del ticket a página A5 */
   document.getElementById("tkpdf").onclick=function(){
     var cv=wrap.querySelector("canvas");if(!cv)return;
     var w=window.jspdf?window.jspdf.jsPDF:window.jsPDF;if(!w)return;
     var pdf=new w({orientation:"portrait",unit:"pt",format:[420,640]});
     try{pdf.setFillColor(7,7,7);pdf.rect(0,0,420,640,"F");}catch(e){}
     pdf.addImage(cv.toDataURL("image/png"),"PNG",(420-360)/2,20,360,504);
     pdf.setFontSize(9);pdf.setTextColor(125,125,125);
     pdf.text("Entrada única · "+String(j.code||""),(420-360)/2,548);
     pdf.text("musaworks.com/e/"+String(location.pathname.split("/").pop()||""),(420-360)/2,560);
     pdf.save("entrada-"+String(j.code||"musa").toLowerCase()+".pdf");
   };
   /* PNG del canvas */
   var png=document.getElementById("tkpng");
   setTimeout(function(){var cv=wrap.querySelector("canvas");if(cv)png.href=cv.toDataURL("image/png");},2600);
 }
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
    const verifyUrl = url.origin + url.pathname + "?r=" + ticketCode;
    const startsInSec = Math.max(0, Math.floor((ev.start.getTime() - Date.now()) / 1000));
    return json({ ok: true, name, link: ev.link || null, code: ticketCode, startsInSec, ticket: { verifyUrl: verifyUrl, event: ev.name, host: ev.brand?.name || "Musa", date: ev.start.toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric", timeZone: ev.timezone || "America/Lima" }), hour: ev.start.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", timeZone: ev.timezone || "America/Lima" }), place: PLAT[ev.platform] || "Online" } });
  }
  if (request.method !== "GET") return html("Método no permitido", 405);
  return html(page(ev, pageUrl), 200, { "set-cookie": formTimingCookie() });
}
